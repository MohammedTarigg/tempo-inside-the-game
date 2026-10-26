"""The feeder: plays a match into the bus as the data providers would deliver it, at the speed it was played.

It stands where the league's real feeds stand. Everything goes to the `feed` topic of this match, in order: first the
match sheet (who is playing), then the match itself, each second of tracking in the Second Spectrum frame shape
(generator/export.py: to_feed_frame) with the Opta-shaped events that happened by then ahead of it, and last an end
marker. The commentary goes to its own topic, `commentary`, as the listener service publishes it on Azure: here the
generator's commentary lines stand in for what AI Speech would have heard.

    tempo feed                 the demo match into the bus, in real time
    tempo feed --speed 0       as fast as the bus takes it
"""

import time
from collections.abc import Iterator
from typing import Any

from ..constants import HZ
from ..generator.export import MatchData, to_feed_frame

BATCH = HZ  # tracking frames a message: one second


def messages(md: MatchData, commentary=True) -> Iterator[tuple[int, str, dict[str, Any]]]:
    """(frame, topic, message) in the order a live feed delivers them. The frame is when the message is due: the first
    frame of the second of tracking it travels with."""
    meta = md["meta"]
    yield 0, "feed", dict(kind="meta", meta=meta)
    n, ev, cm = len(md["clock"]), 0, 0
    events, lines = md["events"], md["commentary"] if commentary else []
    for a in range(0, n, BATCH):
        b = min(n, a + BATCH)
        t, period = float(md["clock"][b - 1]), int(md["period"][b - 1])
        while ev < len(events) and events[ev]["periodId"] <= period and events[ev]["matchTime"] <= t:
            yield a, "feed", dict(kind="event", event=events[ev])
            ev += 1
        while cm < len(lines) and lines[cm]["matchTime"] <= t:
            yield a, "commentary", lines[cm]
            cm += 1
        yield a, "feed", dict(kind="tracking", frames=[to_feed_frame(md, i) for i in range(a, b)])
    for e in events[ev:]:
        yield n, "feed", dict(kind="event", event=e)
    yield n, "feed", dict(kind="end")


def play(md: MatchData, bus, speed=1.0, commentary=True, log=print):
    """Publishes the match, each message when its frame comes round at `speed` times real time (the tracking is 25
    frames a second, and has no frames for the half-time break). At speed 0 it all goes out at once."""
    t0, count = time.monotonic(), 0
    for frame, topic, msg in messages(md, commentary):
        if speed > 0:
            time.sleep(max(0.0, t0 + frame / (HZ * speed) - time.monotonic()))
        bus.publish(topic, msg)
        count += 1
        if msg.get("kind") == "tracking" and frame % (HZ * 300) == 0:
            log(f"{md['meta']['match_id']}: frame {frame}, minute {int(md['clock'][frame] // 60)}, {count} messages")
    return count
