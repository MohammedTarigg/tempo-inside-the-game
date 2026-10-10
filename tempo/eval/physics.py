"""Does the generated match move like a real one? Scans the ball and the players frame by frame for motion that cannot happen."""
import sys, json
import numpy as np
from ..generator.sim import Sim, PX, PY
from ..generator.story import DemoStory

def scan(s):
    F = s.frames; DT = 1 / 25
    live = np.array([f[2] for f in F]); ball = np.array([f[4:7] for f in F], float); pos = np.stack([f[7] for f in F])
    per = np.array([f[0] for f in F]); same = per[1:] == per[:-1]
    d = np.diff(ball, axis=0); step = np.linalg.norm(d[:, :2], axis=1); v = step / DT
    acc = np.abs(np.diff(v)) / DT
    out = {}
    out["ball jumps over 2 m in one frame"] = int(((step > 2.0) & same).sum())
    stop = np.where(live[:-1] & ~live[1:])[0]
    out["stoppages"] = int(len(stop))
    out["median ball jump in the first second of a stoppage (m)"] = float(np.median([step[i:i + 25].max() for i in stop])) if len(stop) else 0.0
    out["fastest fall (m/s)"] = float(-(d[:, 2][same] / DT).min())
    out["highest ball (m)"] = float(ball[:, 2].max())
    # free ground balls: do they slow?
    z = ball[:, 2]; free = (z[:-1] < 0.13) & (v > 6) & same
    runs = []; i = 0; n = len(free)
    while i < n:
        if free[i]:
            j = i
            while j < n and free[j]: j += 1
            if j - i >= 12: runs.append((v[i + 1], v[j - 1], (j - i) * DT))
            i = j
        else: i += 1
    if runs:
        r = np.array(runs)
        out["ground balls over half a second"] = len(runs)
        out["their median speed, start then end (m/s)"] = [float(np.median(r[:, 0])), float(np.median(r[:, 1]))]
        out["share that lost pace"] = float((r[:, 1] < r[:, 0]).mean())
    pstep = np.linalg.norm(np.diff(pos, axis=0), axis=2)
    out["player jumps over 1 m in one frame"] = int((pstep[same] > 1.0).sum())
    pv = pstep / DT; pa = np.abs(np.diff(pv, axis=0)) / DT
    out["player acceleration p99.9 (m/s2)"] = float(np.nanpercentile(pa, 99.9))
    out["ball in play"] = float(live.mean())
    out["restarts that had to be forced"] = int(getattr(s, "timeouts", 0))
    dead = np.diff(np.concatenate([[0], (~live).astype(int), [0]])); spells = (np.where(dead == -1)[0] - np.where(dead == 1)[0]) / 25
    out["stoppage length, median and longest (s)"] = [float(np.median(spells)), float(spells.max())]
    return out

if __name__ == "__main__":
    demo = len(sys.argv) > 1 and sys.argv[1] == "demo"
    s = Sim(seed=7, story=DemoStory() if demo else None).run()
    r = scan(s)
    for k, v in r.items(): print(f"  {k}: {v if not isinstance(v, float) else round(v, 2)}")
    json.dump(r, open("artifacts/physics.json", "w"), indent=1)
