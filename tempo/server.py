"""A small local server for a front end. It serves one finished run and replays its cues in match time.

    python3 -m tempo.server m_demo 8765

    GET /meta                 squads, ids, score
    GET /replay               positions at 5 frames a second, as JSON
    GET /cues                 every cue, in match-time order
    GET /facts/<fact_id>      one fact, for the evidence drawer
    GET /stream?speed=20      server-sent events: each cue when the match clock reaches it, `speed` times faster than real time

In production the cues arrive over Azure Web PubSub and each screen releases them by its own picture's match time. The payloads are the same."""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_handler(run_dir):
    cues = [json.loads(l) for l in open(os.path.join(run_dir, "cues.jsonl"))]
    facts = {json.loads(l)["fact_id"]: json.loads(l) for l in open(os.path.join(run_dir, "facts.jsonl"))}
    meta = json.load(open(os.path.join(run_dir, "meta.json")))
    z = np.load(os.path.join(run_dir, "replay.npz"))
    replay = dict(clock=z["clock"].round(2).tolist(), period=z["period"].tolist(), live=z["live"].tolist(),
                  ball=np.nan_to_num(z["ball"]).round(2).tolist(), pos=np.where(np.isnan(z["pos"]), None, z["pos"].round(2)).tolist(), momentum=z["momentum"].tolist())

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, obj, code=200):
            body = json.dumps(obj, default=float).encode()
            self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == "/meta":
                return self._json(meta)
            if u.path == "/cues":
                return self._json(cues)
            if u.path == "/replay":
                return self._json(replay)
            if u.path.startswith("/facts/"):
                f = facts.get(u.path.split("/")[-1])
                return self._json(f or dict(error="unknown fact"), 200 if f else 404)
            if u.path == "/stream":
                speed = float(parse_qs(u.query).get("speed", ["20"])[0])
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers()
                t0, m0 = time.time(), cues[0]["match_time"] if cues else 0.0
                try:
                    for c in cues:
                        wait = (c["match_time"] - m0) / speed - (time.time() - t0)
                        if wait > 0:
                            time.sleep(wait)
                        self.wfile.write(f"event: cue\ndata: {json.dumps(c, default=float)}\n\n".encode()); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            self._json(dict(error="not found"), 404)
    return H


def main(argv):
    run = argv[0] if argv else "m_demo"
    port = int(argv[1]) if len(argv) > 1 else 8765
    srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler(os.path.join(ROOT, "runs", run)))
    print(f"serving runs/{run} on http://127.0.0.1:{port}  (meta, replay, cues, facts/<id>, stream?speed=20)")
    srv.serve_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
