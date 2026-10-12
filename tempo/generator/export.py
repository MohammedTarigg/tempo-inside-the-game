"""Turns a finished simulation into what a data provider would deliver: a tracking stream in the Second Spectrum shape and an event
stream in the Opta shape, joined on player IDs, plus match metadata. Also the reverse adapter the pipeline uses to read tracking."""
import numpy as np

from ..contracts import tracking_frame
from .sim import AWAY, HOME, HZ


def match_data(sim):
    F = sim.frames
    pos = np.stack([f[7] for f in F])
    ball = np.array([[f[4], f[5], f[6]] for f in F])
    period = np.array([f[0] for f in F]); clock = np.array([f[1] for f in F])
    dirs = np.where(period == 1, 1.0, -1.0)                                   # the home team's attacking direction
    meta = dict(match_id=sim.match_id, fps=HZ, pitchLength=105.0, pitchWidth=68.0, home=dict(HOME, players=sim.squads[0]), away=dict(AWAY, players=sim.squads[1]),
                ids=sim.ids, numbers=[p["number"] for s in sim.squads for p in s], names={p["playerId"]: p["name"] for s in sim.squads for p in s}, names_ar={p["playerId"]: p["name_ar"] for s in sim.squads for p in s},
                team_of={p["playerId"]: p["team"] for s in sim.squads for p in s}, keepers=[0, 11], final_score=list(sim.score))
    return dict(meta=meta, pos=pos, ball=ball, live=np.array([f[2] for f in F]), poss=np.array([f[3] for f in F]), period=period, clock=clock,
                home_dir=dirs, team=sim.team.copy(), events=sim.events, commentary=sorted(sim.commentary, key=lambda c: c["matchTime"]))


def to_feed_frame(md, i):
    """Frame i as the tracking feed would send it."""
    sp = np.zeros(22) if i == 0 else np.linalg.norm(md["pos"][i] - md["pos"][i - 1], axis=1) * HZ
    bs = 0.0 if i == 0 else float(np.linalg.norm(md["ball"][i, :2] - md["ball"][i - 1, :2]) * HZ)
    rows = [(md["meta"]["ids"][j], md["meta"]["numbers"][j], md["pos"][i, j, 0], md["pos"][i, j, 1], sp[j]) for j in range(22) if not np.isnan(md["pos"][i, j, 0])]
    return tracking_frame(i, int(md["period"][i]), md["clock"][i], md["live"][i], "home" if md["poss"][i] == 0 else "away",
                          (*md["ball"][i], bs), [r for r in rows if r[0] in {p["playerId"] for p in md["meta"]["home"]["players"]}],
                          [r for r in rows if r[0] in {p["playerId"] for p in md["meta"]["away"]["players"]}])


def from_feed_frame(frame, ids):
    """A feed frame back to arrays: positions in the order of `ids` (NaN when a player is absent), ball, live, possession."""
    pos = np.full((len(ids), 2), np.nan)
    where = {p: k for k, p in enumerate(ids)}
    for side in ("homePlayers", "awayPlayers"):
        for p in frame[side]:
            pos[where[p["playerId"]]] = p["xyz"][:2]
    return pos, np.array(frame["ball"]["xyz"]), frame["live"], 0 if frame["lastTouch"] == "home" else 1
