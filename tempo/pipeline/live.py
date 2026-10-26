"""The live service: one match, played through the pipeline as its feed arrives. On Azure it is a Container App, one
replica per match, reading Event Hubs; locally the same code reads the in-process bus.

    tempo live m_demo          serve the match: read its feed and commentary, push cues, write the run at full time

It reads the match's `feed` topic from the start (the match sheet, then tracking a second at a time with the events ahead
of it) and its `commentary` topic (the listener service's lines), rebuilds the match frame by frame in the feeds' own
shapes (LiveMatch), and steps the pipeline over each frame as it lands. Cues leave as they are issued, through the bus
and, on Azure, Web PubSub to the screens.

Restarting is the recovery path: the service reads the feed again from the start to rebuild the match, takes the
pipeline's state from its last checkpoint in the ledger, and carries on from the frame after it. Cue ids are hashes of
what and when, so nothing already shown is shown again.

It also answers three HTTP paths, for the Container App's probes and the screens: /healthz; /cues, every cue issued so
far, for a screen that joins mid-match; and /negotiate, which gives a screen its Web PubSub URL for the cues after that."""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import numpy as np

from ..constants import HZ
from ..generator.export import MatchData, Meta, from_feed_frame
from ..paths import RUNS, WORK
from .export import screen_cue

CAPACITY = 2 * 60 * 60 * HZ  # frames held: two hours of tracking, more than any match


class LiveMatch:
    """A match built up from its feed. The arrays are sized once, so the pipeline can hold on to them, and filled as
    frames arrive; `n` is how many have. Nothing past `n` is ever read: the pipeline steps only frames that are in."""

    def __init__(self, meta: Meta):
        ids = meta["ids"]
        home = meta["home"]["id"]
        self.n, self.ids = 0, ids
        self.md: MatchData = MatchData(
            meta=meta,
            pos=np.full((CAPACITY, len(ids), 2), np.nan),
            ball=np.zeros((CAPACITY, 3)),
            live=np.zeros(CAPACITY, bool),
            poss=np.zeros(CAPACITY, np.int64),
            period=np.zeros(CAPACITY, np.int64),
            clock=np.zeros(CAPACITY),
            home_dir=np.zeros(CAPACITY),
            team=np.array([0 if meta["team_of"][p] == home else 1 for p in ids]),
            events=[],
            commentary=[],
            planted=[],
        )
        self.ended = False

    def take(self, msg):
        """One message from the feed topic."""
        kind, md = msg["kind"], self.md
        if kind == "tracking":
            for fr in msg["frames"]:
                i = self.n
                pos, ball, live, poss = from_feed_frame(fr, self.ids)
                md["pos"][i], md["ball"][i], md["live"][i], md["poss"][i] = pos, ball, live, poss
                md["period"][i], md["clock"][i] = fr["period"], fr["gameClock"]
                md["home_dir"][i] = 1.0 if fr["period"] == 1 else -1.0  # the home team attacks right, then left
                self.n += 1
        elif kind == "event":
            md["events"].append(msg["event"])
        elif kind == "end":
            self.ended = True

    def hear(self, line):
        """One line from the commentary topic. Lines are kept in the order they were said."""
        cm = self.md["commentary"]
        cm.append(line)
        if len(cm) > 1 and cm[-2]["matchTime"] > line["matchTime"]:
            cm.sort(key=lambda c: c["matchTime"])

    def frame_at(self, t):
        """The first frame that has come in at match time `t`, in the half that time belongs to."""
        clock, period = self.md["clock"][: self.n], self.md["period"][: self.n]
        half = np.flatnonzero((period == (2 if t >= 45 * 60 and (period == 2).any() else 1)) & (clock >= t))
        return int(half[0]) if len(half) else max(0, self.n - 1)

    def close(self, pipeline):
        """Full time: the arrays are cut to the frames that came, here and in the pipeline's view of them."""
        n = self.n
        for k in ("pos", "ball", "live", "poss", "period", "clock", "home_dir"):
            self.md[k] = self.md[k][:n]
        pipeline.view = dict(
            pos=self.md["pos"], ball=self.md["ball"], live=self.md["live"], poss=self.md["poss"], team=self.md["team"]
        )


class Feed:
    """This service's place in its two topics, and the reading of them into the match."""

    def __init__(self, bus, match: LiveMatch, batch=200, wait=1.0):
        self.bus, self.match, self.batch, self.wait = bus, match, batch, wait
        self.feed_at = self.said_at = 0

    def pull(self):
        """Takes what has arrived on both topics. Returns whether anything did."""
        got = self.bus.read("feed", self.feed_at, self.batch, wait=self.wait)
        for off, msg in got:
            if msg["kind"] != "meta":
                self.match.take(msg)
            self.feed_at = off + 1
        heard = self.bus.read("commentary", self.said_at, None, wait=0.0)
        for off, line in heard:
            self.match.hear(line)
            self.said_at = off + 1
        return bool(got or heard)


def match_sheet(bus, wait=5.0, patience=3600.0):
    """The feed's first message, waited for: who is playing."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < patience:
        got = bus.read("feed", 0, 1, wait=wait)
        if got:
            return got[0][1]
    raise TimeoutError("no match sheet on the feed")


def follow(feed: Feed, pipeline, start=0, log=print):
    """Steps the pipeline over every frame from `start` as it lands, until the feed's end marker. Returns the number
    of frames stepped."""
    from ..azure.telemetry import span

    match, stepped = feed.match, start
    while match.n <= start and not match.ended:  # the first frame this process plays
        feed.pull()
    pipeline.begin(start)
    while True:
        if match.n > stepped:
            with span("pipeline.frames", match_id=match.md["meta"]["match_id"], first=stepped, last=match.n - 1):
                for i in range(stepped, match.n):
                    pipeline.step(i)
            if stepped // (HZ * 300) != match.n // (HZ * 300):
                log(f"{match.md['meta']['match_id']}: minute {int(match.md['clock'][match.n - 1] // 60)}")
            stepped = match.n
        if match.ended:
            return stepped - start
        if not feed.pull():
            time.sleep(0.05)  # nothing yet: the feed is at real-time speed


class Issued:
    """A bus that also keeps every cue issued, in the shape the screens read, for a screen that joins mid-match
    (/cues). Kept apart from the ledger so the HTTP thread never touches the pipeline's own connections."""

    def __init__(self, inner, frame):
        self.inner, self.frame, self.lock, self.cues = inner, frame, threading.Lock(), {}

    def note(self, cue, frame):
        with self.lock:
            self.cues[cue["cue_id"]] = screen_cue(cue, frame)

    def publish(self, topic, msg):
        out = self.inner.publish(topic, msg)
        if topic == "cues":
            if "form" in msg:
                self.note(msg, self.frame())
            else:
                with self.lock:
                    if msg["cue_id"] in self.cues:
                        self.cues[msg["cue_id"]]["status"] = msg["status"]
        return out

    def snapshot(self):
        with self.lock:
            return [c for c in self.cues.values() if c["status"] != "withdrawn"]

    def read(self, topic, offset=0, limit=None, wait=0.0):
        return self.inner.read(topic, offset, limit, wait=wait)

    def size(self, topic):
        return self.inner.size(topic)

    def dump(self, topic):
        return self.inner.dump(topic)


class _Http(BaseHTTPRequestHandler):
    push: Any = None
    issued: Issued | None = None
    origin = os.environ.get("TEMPO_SITE_ORIGIN", "*")

    def do_GET(self):
        if self.path.startswith("/healthz"):
            return self._send(200, dict(ok=True))
        if self.path.startswith("/negotiate") and self.push:
            return self._send(200, dict(url=self.push.client_url()))
        if self.path.startswith("/cues") and self.issued:
            return self._send(200, self.issued.snapshot())
        return self._send(404, dict(error="not found"))

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self.origin)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # the platform's own access log is enough
        pass


def serve(
    match_id: str,
    port: int | None = None,
    feed_md: MatchData | None = None,
    speed=1.0,
    out: str | None = None,
    log=print,
):
    """The service's whole life: wire it, answer HTTP, wait for the match sheet, play the match, write the run.
    feed_md plays a match into the same bus from this process, which is how the live path runs on one machine."""
    from .. import season as seasonmod
    from ..azure import settings, wire
    from ..azure.telemetry import start as tracing
    from .run import Pipeline

    cfg = settings()
    tracing(cfg, "tempo-live")
    t0 = time.time()
    season, search = seasonmod.load()
    # its own working folder: a batch run of the same match must never look like a checkpoint to resume from
    out, work = out or os.path.join(RUNS, match_id), os.path.join(WORK, match_id, "live")
    w = wire(match_id, work, search, cfg)
    log(f"{match_id}: " + (", ".join(w.on_azure) or "every part local"))
    _Http.push = w.push
    server = ThreadingHTTPServer(("0.0.0.0", port or int(os.environ.get("PORT", "8080"))), _Http)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    if feed_md is not None:
        from .feeder import play

        threading.Thread(target=play, args=(feed_md, w.bus, speed), kwargs=dict(log=log), daemon=True).start()

    match = LiveMatch(match_sheet(w.bus)["meta"])
    feed = Feed(w.bus, match)
    holder: dict[str, Any] = {}
    issued = _Http.issued = Issued(w.bus, lambda: holder["p"].cues.frame)
    w.bus = issued
    p = holder["p"] = Pipeline(match.md, out, season=season, work_dir=work, wiring=w)
    cp = p.ledger.load_checkpoint("pipeline")
    if cp:  # a restart: rebuild the match up to the checkpoint from the feed, then take the pipeline's state from it
        while match.n <= cp["frame"] and not match.ended:
            feed.pull()
        for c in p.ledger.cues(match_id):
            issued.note(c, match.frame_at(c["match_time"]))
        log(f"{match_id}: resuming after frame {cp['frame']}")
    frames = follow(feed, p, p.resume(), log=log)
    match.close(p)
    p.end()
    summary = p.finish(time.time() - t0)
    log(f"{match_id}: full time, {frames} frames played here, {summary['things_shown']} things shown")
    if cfg.blob_endpoint:
        from ..azure.blob import upload_run

        log(f"{match_id}: {len(upload_run(cfg, out, match_id))} files to Blob Storage")
    server.shutdown()
    return summary
