"""Data contracts. Events follow the Opta feed's shape, tracking follows the Second Spectrum shape, and facts and cues are ours.
IDs are deterministic: the same stretch of match always yields the same IDs, so a replay after a failure cannot show anything twice."""
import hashlib
import json

# Opta type ids used by the generator and understood by the pipeline
TYPE = {"pass": 1, "take_on": 3, "foul": 4, "out": 5, "corner": 6, "tackle": 7, "interception": 8, "save": 10, "clearance": 12, "miss": 13,
        "attempt_saved": 15, "goal": 16, "card": 17, "end": 30, "start": 32, "deleted": 43, "challenge": 45, "ball_recovery": 49}
TYPE_NAME = {v: k for k, v in TYPE.items()}
Q_YELLOW, Q_SECOND_YELLOW, Q_RED = 31, 32, 33
DEFENDING_CHALLENGE = {TYPE["tackle"], TYPE["challenge"], TYPE["foul"]}


def stable_id(prefix, *parts):
    return prefix + "_" + hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:12]


def event(match_id, seq, type_name, period, t, team, player, x, y, outcome=1, qualifiers=None, **extra):
    """One event in the Opta shape. x and y run 0 to 100 in the attacking direction of the event's team."""
    e = dict(id=stable_id("e", match_id, seq), eventId=seq, typeId=TYPE[type_name], periodId=period, timeMin=int(t // 60), timeSec=int(t % 60),
             matchTime=round(float(t), 2), contestantId=team, playerId=player, x=round(float(x), 1), y=round(float(y), 1), outcome=int(outcome),
             qualifier=[dict(qualifierId=q, value=v) for q, v in (qualifiers or {}).items()])
    e.update(extra)
    return e


def tracking_frame(idx, period, clock, live, last_touch, ball, home, away):
    """One frame in the Second Spectrum shape. home and away are lists of (playerId, number, x, y, speed)."""
    def side(rows):
        return [dict(playerId=p, number=n, xyz=[round(float(x), 2), round(float(y), 2), 0.0], speed=round(float(s), 2)) for p, n, x, y, s in rows]
    return dict(frameIdx=idx, period=period, gameClock=round(float(clock), 2), live=bool(live), lastTouch=last_touch,
                ball=dict(xyz=[round(float(ball[0]), 2), round(float(ball[1]), 2), round(float(ball[2]), 2)], speed=round(float(ball[3]), 2)),
                homePlayers=side(home), awayPlayers=side(away))


def fact(match_id, match_time, kind, subject, value, unit="", percentile=None, sources=(), version=1, **extra):
    f = dict(fact_id=stable_id("f", match_id, kind, subject, round(float(match_time), 1)), match_id=match_id, match_time=round(float(match_time), 2),
             kind=kind, subject=subject, value=value, unit=unit, percentile=percentile, source_event_ids=list(sources), version=version)
    f.update(extra)
    return f


VARIANT_KEYS = ("lang", "depth", "player", "level", "defender", "attacker", "mark", "subject", "type")


def cue(match_id, match_time, form, screen, payload, fact_ids, valid_for=2.0, priority=5, when="now"):
    # the ID covers what makes this cue this cue: two languages of one sentence are two cues, a replay of the same one is not
    variant = [str(payload.get(k)) for k in VARIANT_KEYS if k in payload]
    return dict(cue_id=stable_id("c", match_id, form, screen, sorted(fact_ids), round(float(match_time), 1), variant), match_id=match_id,
                match_time=round(float(match_time), 2), valid_for=valid_for, screen=screen, form=form, when=when, priority=priority,
                payload=payload, fact_ids=list(fact_ids), status="live")
