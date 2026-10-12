"""How often do the things said before kick-off come true?

    python3 -m tempo.eval.calls [matches]

The demo match is written so that its story plays out, and in it all three kick-off calls hold. That proves the picture, not
the calls. This runs the same pipeline over plain generated matches that no story steers and that the season baselines never
saw (the season is seeds 100 to 139; these start at 400, and seeds 200 to 319 were used while the league's habits and the
rules were being designed, so they are not used here), and counts what became of each call by the rule fixed in
Pipeline.calls: held, failed, or never tested (the booked-player call needs him to be booked). The result is written to
artifacts/calls.json. A call that often fails is reported as plainly as one that holds.
"""

import json
import os
import sys
import tempfile
import time

from .. import season as seasonmod
from ..generator.export import match_data
from ..generator.sim import Sim
from ..paths import ARTIFACTS
from ..run_match import Pipeline

FIRST_SEED = 400


def outcomes(seed, season, search):
    """One plain match through the pipeline, in a scratch folder. Returns what became of each kick-off call."""
    md = match_data(Sim(seed=seed, match_id=f"m_{seed}").run())
    md["planted"] = []
    with tempfile.TemporaryDirectory() as out:
        p = Pipeline(md, out, season=season, search=search)
        p.run()
        return [
            dict(mark=c["mark"], said=c["said"], came_true=c["came_true"], line=c["line"], value=c["value"])
            for c in p.calls(float(md["clock"][-1]))
        ]


def main(argv):
    n = int(argv[0]) if argv else 20
    season, search = seasonmod.load()
    t0, matches, tally = time.time(), [], {}
    for seed in range(FIRST_SEED, FIRST_SEED + n):
        calls = outcomes(seed, season, search)
        matches.append(dict(seed=seed, calls=calls))
        for c in calls:
            row = tally.setdefault(c["mark"], dict(said=c["said"], held=0, failed=0, untested=0))
            row["held" if c["came_true"] else "untested" if c["came_true"] is None else "failed"] += 1
        print(f"  seed {seed}: " + ", ".join(f"{c['mark']} {c['came_true']}" for c in calls), flush=True)
    tested = sum(r["held"] + r["failed"] for r in tally.values())
    held = sum(r["held"] for r in tally.values())
    out = dict(
        matches=n,
        first_seed=FIRST_SEED,
        season_seeds="100 to 139",
        held=held,
        tested=tested,
        by_call=tally,
        per_match=matches,
        seconds=round(time.time() - t0, 1),
    )
    json.dump(out, open(os.path.join(ARTIFACTS, "calls.json"), "w"), indent=1)
    print(f"{held} of {tested} tested calls held across {n} unseen matches")
    for mark, r in tally.items():
        print(f"  {r['said']}: held {r['held']}, failed {r['failed']}, never tested {r['untested']}")


if __name__ == "__main__":
    main(sys.argv[1:])
