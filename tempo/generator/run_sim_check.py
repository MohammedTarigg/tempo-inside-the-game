import sys, time
import numpy as np
from collections import Counter
from .sim import Sim
from ..contracts import TYPE_NAME

t = time.time()
s = Sim(seed=int(sys.argv[1]) if len(sys.argv) > 1 else 7).run()
F = s.frames
live = np.array([f[2] for f in F])
pos = np.stack([f[7] for f in F])
print(f"frames {len(F):,} in {time.time() - t:.0f} s; score {s.score}; ball in play {live.mean():.0%}")
print("events:", dict(Counter(TYPE_NAME[e["typeId"]] for e in s.events)))
sp = np.linalg.norm(np.diff(pos, axis=0), axis=2) * 25
print(
    f"distance per outfield player {np.nanmean(np.nansum(sp, 0)[[i for i in range(22) if i % 11]]) / 25 / 1000:.1f} km; top speed p99.9 {np.nanpercentile(sp, 99.9):.1f} m/s; share of time above 5.5 m/s {np.nanmean(sp > 5.5):.1%}"
)
fast = sp > 7.0
print(
    f"sprints above 7 m/s per outfield player: {np.mean([(np.diff(fast[:, i].astype(int)) == 1).sum() for i in range(22) if i % 11]):.0f}"
)
if len(sys.argv) > 2:
    from .story import DemoStory

    st = DemoStory()
    s2 = Sim(seed=7, story=st).run()
    print(
        "demo match score",
        s2.score,
        "| planted:",
        st.planted,
        "| cards:",
        [(e["playerId"], e["timeMin"]) for e in s2.events if e["typeId"] == 17],
    )
    print(
        "goals:",
        [(e["playerId"], e["timeMin"]) for e in s2.events if e["typeId"] == 16],
        "| commentary:",
        s2.commentary[:4],
    )
