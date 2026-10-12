"""Does the generated match move like a real one? Scans the ball and the players frame by frame for motion that cannot
happen."""

import json
import os
import sys

import numpy as np

from ..generator.sim import PX, PY, Sim
from ..generator.story import DEMO_SEED, DemoStory
from ..paths import ARTIFACTS


def scan(s):
    F = s.frames
    DT = 1 / 25
    live = np.array([f[2] for f in F])
    ball = np.array([f[4:7] for f in F], float)
    pos = np.stack([f[7] for f in F])
    per = np.array([f[0] for f in F])
    same = per[1:] == per[:-1]
    d = np.diff(ball, axis=0)
    step = np.linalg.norm(d[:, :2], axis=1)
    v = step / DT
    out = {}
    out["ball jumps over 2 m in one frame"] = int(((step > 2.0) & same).sum())
    stop = np.where(live[:-1] & ~live[1:])[0]
    out["stoppages"] = int(len(stop))
    out["median ball jump in the first second of a stoppage (m)"] = (
        float(np.median([step[i : i + 25].max() for i in stop])) if len(stop) else 0.0
    )
    out["fastest fall (m/s)"] = float(-(d[:, 2][same] / DT).min())
    out["highest ball (m)"] = float(ball[:, 2].max())
    # free ground balls: do they slow?
    z = ball[:, 2]
    free = (z[:-1] < 0.13) & (v > 6) & same
    runs = []
    i = 0
    n = len(free)
    while i < n:
        if free[i]:
            j = i
            while j < n and free[j]:
                j += 1
            if j - i >= 12:
                runs.append((v[i + 1], v[j - 1], (j - i) * DT))
            i = j
        else:
            i += 1
    if runs:
        r = np.array(runs)
        out["ground balls over half a second"] = len(runs)
        out["their median speed, start then end (m/s)"] = [float(np.median(r[:, 0])), float(np.median(r[:, 1]))]
        out["share that lost pace"] = float((r[:, 1] < r[:, 0]).mean())
    pstep = np.linalg.norm(np.diff(pos, axis=0), axis=2)
    out["player jumps over 1 m in one frame"] = int((pstep[same] > 1.0).sum())
    pv = pstep / DT
    pa = np.abs(np.diff(pv, axis=0)) / DT
    out["player acceleration p99.9 (m/s2)"] = float(np.nanpercentile(pa, 99.9))
    out["ball in play"] = float(live.mean())
    # Is the ball with the player who has it? A kick or a touch can only happen at someone's feet.
    st = np.array([c[0] for c in s.ctl])
    who = np.array([c[1] for c in s.ctl])
    k = np.where(st == "carried")[0]
    dc = np.linalg.norm(ball[k, :2] - pos[k, who[k]], axis=1)
    out["dribbling: ball to the man on it, median, p90, p99 (m)"] = [
        float(x) for x in np.nanpercentile(dc, [50, 90, 99])
    ]
    kick = np.where((st[1:] == "pass") & (st[:-1] == "carried"))[0]
    out["at the kick: ball to the passer, median, p90, furthest (m)"] = [
        float(x) for x in np.percentile(np.linalg.norm(ball[kick, :2] - pos[kick, who[kick]], axis=1), [50, 90, 100])
    ]
    rec = np.where((st[1:] == "carried") & (st[:-1] == "pass"))[0] + 1
    out["at the first touch: ball to the receiver, median, furthest (m)"] = [
        float(x) for x in np.percentile(np.linalg.norm(ball[rec, :2] - pos[rec, who[rec]], axis=1), [50, 100])
    ]
    vel = d[:, :2] / DT
    jump = np.linalg.norm(np.diff(vel, axis=0), axis=1)  # change of velocity in one frame, m/s
    near = np.nanmin(np.linalg.norm(pos[1:-1] - ball[1:-1, None, :2], axis=2), axis=1)
    vz = d[:, 2] / DT
    flat = (ball[1:-1, 2] < 0.3) & (np.abs(vz[:-1]) < 1.2) & (np.abs(vz[1:]) < 1.2)  # a bounce is allowed to slow it
    onpitch = (np.abs(ball[1:-1, 0]) < PX) & (np.abs(ball[1:-1, 1]) < PY)  # so are the boards
    out["ball changes pace by over 3 m/s on the turf with nobody within 1.5 m"] = int(
        ((jump > 3) & (near > 1.5) & flat & onpitch & same[1:] & same[:-1]).sum()
    )
    out["passes"] = int(len(kick))
    out["passes that reach a team-mate's feet"] = float(len(rec) / max(len(kick), 1))
    out["restarts that had to be forced"] = int(getattr(s, "timeouts", 0))
    # bodies: nobody stands inside anybody, and a challenge does something to the man who loses it
    iu = np.triu_indices(pos.shape[1], 1)
    closest = np.inf
    inside = 0
    for k in range(0, len(pos), 20000):
        dd = np.nanmin(np.linalg.norm(pos[k : k + 20000][:, iu[0]] - pos[k : k + 20000][:, iu[1]], axis=2), axis=1)
        closest = min(closest, float(np.nanmin(dd)))
        inside += int((dd < 0.5).sum())
    out["closest two players ever get (m)"] = closest
    out["frames with two players under 0.5 m apart"] = inside
    sp = np.linalg.norm(np.diff(pos, axis=0), axis=2) / DT
    clock = np.array([f[1] for f in F])
    res = {"tackle": [], "challenge": [], "foul": []}
    from ..contracts import TYPE_NAME

    for e in s.events:
        if e.get("other"):
            idx = np.flatnonzero(per == e["periodId"])
            f = int(idx[0] + np.searchsorted(clock[idx], e["matchTime"]))
            if 30 < f < len(pos) - 30:
                loser = s.ids.index(
                    e["playerId"] if TYPE_NAME[e["typeId"]] == "challenge" else e["other"]
                )  # the beaten defender, or the man who was tackled or fouled
                res[TYPE_NAME[e["typeId"]]].append(
                    (float(sp[f - 8 : f - 1, loser].mean()), float(sp[f + 3 : f + 15, loser].mean()))
                )
    for k, name in (("tackle", "tackled"), ("challenge", "beaten"), ("foul", "fouled")):
        if res[k]:
            r2 = np.array(res[k])
            out[f"the man {name}: speed before, then after (m/s)"] = [
                float(np.median(r2[:, 0])),
                float(np.median(r2[:, 1])),
            ]
    dead = np.diff(np.concatenate([[0], (~live).astype(int), [0]]))
    spells = (np.where(dead == -1)[0] - np.where(dead == 1)[0]) / 25
    out["stoppage length, median and longest (s)"] = [float(np.median(spells)), float(spells.max())]
    return out


if __name__ == "__main__":
    demo = len(sys.argv) > 1 and sys.argv[1] == "demo"
    s = Sim(seed=DEMO_SEED, story=DemoStory() if demo else None).run()
    r = scan(s)
    for k, v in r.items():
        print(f"  {k}: {v if not isinstance(v, float) else round(v, 2)}")
    json.dump(r, open(os.path.join(ARTIFACTS, "physics.json"), "w"), indent=1)
