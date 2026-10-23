"""The no-agent baseline: one fixed rule over the three instruments. A cause is named only when the earlier attempt's differing
player is also the defender standing furthest off his ghost at the goal and he carries a yellow card from before it."""

import csv
import os
import sys

from tempo.jsonio import read_json, write_json

RESULTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")


def _rows(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def main(root):
    truth = read_json(os.path.join(root, "_truth.json"))
    out = {}
    for c, t in truth.items():
        d = os.path.join(root, c, "inst")
        g = t["goal_t"]
        ea = read_json(os.path.join(d, "instruments", "earlier_attempt.json"))
        gh = [
            r
            for r in _rows(os.path.join(d, "instruments", "ghost_standoff.csv"))
            if abs(float(r["shot_time_s"]) - g) < 1
        ]
        top = gh[0]["defender"] if gh and float(gh[0]["further_from_ball_than_ghost_m"]) > 0 else None
        cards = {
            r["player"]: int(r["yellow_card_minute"])
            for r in _rows(os.path.join(d, "instruments", "ledger.csv"))
            if r["yellow_card_minute"]
        }
        p = ea.get("differing_player") if ea["found"] else None
        named = p if p and p == top and cards.get(p, 999) * 60 < g else None
        out[c] = dict(planted=t["planted"], named=named, right=(named == t["player"]))
        print(c, out[c])
    print("right:", sum(v["right"] for v in out.values()), "of", len(out))
    write_json(os.path.join(RESULTS, "code_rule.json"), out, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
