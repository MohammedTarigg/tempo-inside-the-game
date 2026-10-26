"""The live path: a match played into the bus by the feeder and followed by the live service, frame by frame as it
lands, issues exactly what one pass over the same feed issues. And a live service stopped mid-match and started again
from its checkpoint ends with the same cues as one that never stopped: nothing missing, nothing shown twice."""

import os
import tempfile

import pytest

from tempo import season as seasonmod
from tempo.pipeline.bus import LocalBus
from tempo.pipeline.feeder import play
from tempo.pipeline.live import Feed, LiveMatch, follow, match_sheet
from tempo.pipeline.run import Pipeline, generate


def fed(md):
    """The match through the feeder into a bus, and the bus."""
    bus = LocalBus()
    play(md, bus, speed=0, log=lambda *_: None)
    return bus


def received(bus):
    """The whole match as the live service rebuilds it from the bus."""
    match = LiveMatch(match_sheet(bus)["meta"])
    feed = Feed(bus, match)
    while not match.ended:
        feed.pull()
    return match, feed


@pytest.mark.slow
def test_following_the_feed_issues_what_one_pass_issues():
    season, search = seasonmod.load()
    bus = fed(generate(None))
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        # live: frame by frame as the feed lands
        match = LiveMatch(match_sheet(bus)["meta"])
        p = Pipeline(match.md, a, season=season, search=seasonmod.load()[1])
        follow(Feed(bus, match), p, log=lambda *_: None)
        match.close(p)
        p.end()
        # one pass over the same feed
        whole, _ = received(bus)
        whole.close(q := Pipeline(whole.md, b, season=season, search=search))
        q.run()
        live = [(c["cue_id"], c["status"]) for c in p.ledger.cues(match.md["meta"]["match_id"])]
        once = [(c["cue_id"], c["status"]) for c in q.ledger.cues(whole.md["meta"]["match_id"])]
        assert live and live == once


@pytest.mark.slow
def test_a_restart_from_the_checkpoint_ends_as_if_never_stopped():
    season, _ = seasonmod.load()
    bus = fed(generate(None))
    with tempfile.TemporaryDirectory() as out:
        db = os.path.join(out, "ledger.sqlite")
        # the first process stops a third of the way in, after its last checkpoint
        match = LiveMatch(match_sheet(bus)["meta"])
        feed = Feed(bus, match)
        while match.n < 45_000:
            feed.pull()
        p = Pipeline(match.md, out, season=season, search=seasonmod.load()[1], db_path=db)
        p.begin(0)
        for i in range(match.n):
            p.step(i)
        p.ledger.commit()
        stopped = match.n
        # the second reads the feed again, takes the state from the checkpoint and plays on to full time
        match2, _ = received(bus)
        q = Pipeline(match2.md, out, season=season, search=seasonmod.load()[1], db_path=db)
        start = q.resume()
        assert 0 < start <= stopped
        q.begin(start)
        for i in range(start, match2.n):
            q.step(i)
        match2.close(q)
        q.end()
        restarted = [(c["cue_id"], c["status"]) for c in q.ledger.cues(match2.md["meta"]["match_id"])]
    # the same match, never stopped
    with tempfile.TemporaryDirectory() as out:
        whole, _ = received(bus)
        whole.close(r := Pipeline(whole.md, out, season=season, search=seasonmod.load()[1]))
        r.run()
        assert restarted == [(c["cue_id"], c["status"]) for c in r.ledger.cues(whole.md["meta"]["match_id"])]
