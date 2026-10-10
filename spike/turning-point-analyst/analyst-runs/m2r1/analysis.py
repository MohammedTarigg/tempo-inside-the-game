"""Match 2 (Northgate A v Harbour City B): why did momentum swing to A around minute 53?

Standard library only. Reads from the match folder, prints key numbers.
"""
import csv
import collections
import random
import statistics as st

DATA = "/private/tmp/claude-501/itg-blind/match_2"
PRE = (40, 52)
POST = (53, 59)
POST_WIDE = (53, 65)


def mean(xs):
    return st.mean(xs) if xs else float("nan")


def load():
    events = list(csv.DictReader(open(f"{DATA}/events.csv")))
    positions = list(csv.DictReader(open(f"{DATA}/positions.csv")))
    momentum = {int(r["minute"]): r for r in csv.DictReader(open(f"{DATA}/momentum.csv"))}
    return events, positions, momentum


def in_win(minute, win):
    return win[0] <= minute <= win[1]


def main():
    events, positions, momentum = load()
    ev = {e["event_id"]: e for e in events}

    print("== Momentum (per minute, A minus B)")
    net = {m: float(r["net_A_minus_B"]) for m, r in momentum.items()}
    for label, win in [("pre 40-52", PRE), ("post 53-59", POST), ("post 53-65", POST_WIDE)]:
        a = mean([float(momentum[m]["threat_A"]) for m in range(win[0], win[1] + 1)])
        b = mean([float(momentum[m]["threat_B"]) for m in range(win[0], win[1] + 1)])
        print(f"{label}: threat A/min {a:.4f}  B/min {b:.4f}  net {a - b:+.4f}")

    obs = mean([net[m] for m in range(POST[0], POST[1] + 1)])
    rng = random.Random(1)
    lo, hi = min(net), max(net)
    hits, n = 0, 20000
    for _ in range(n):
        s = rng.randint(lo, hi - 6)
        w = [net[m] for m in range(s, s + 7) if m in net]
        if len(w) == 7 and mean(w) >= obs:
            hits += 1
    print(f"Permutation: share of random 7-minute windows with net >= {obs:+.4f}: {hits / n:.3f}")

    print("\n== Team event stats, pre vs post")
    for label, win in [("pre", PRE), ("post", POST_WIDE)]:
        for t in "AB":
            pas = [e for e in events if e["team"] == t and e["type"] == "pass" and in_win(int(e["minute"]), win)]
            comp = sum(e["outcome"] == "complete" for e in pas)
            shots = [e for e in events if e["team"] == t and e["type"] == "shot" and in_win(int(e["minute"]), win)]
            xg = sum(float(e["xg"] or 0) for e in shots)
            print(f"{label} {t}: passes {len(pas)} completion {100 * comp / max(1, len(pas)):.1f}%  "
                  f"shots {len(shots)} xG {xg:.3f}")

    print("\n== Substitutions and cards (minute)")
    for e in events:
        if e["type"] in ("substitution", "card"):
            print(f"min {e['minute']} {e['team']} {e['player']} {e['type']} {e['outcome']}")

    print("\n== Speed by 6-minute block (km/h, mean of positions)")
    speeds = collections.defaultdict(lambda: collections.defaultdict(list))
    for p in positions:
        e = ev.get(p["event_id"])
        if e is None:
            continue
        speeds[p["player"]][int(e["minute"]) // 6 * 6].append(float(p["speed_kmh"]))
    for pl in ["A4", "A7", "A9", "A10", "B7", "B8", "B11"]:
        blocks = speeds[pl]
        pre = mean([v for b in blocks if 42 <= b <= 48 for v in blocks[b]])
        post = mean([v for b in blocks if 54 <= b <= 60 for v in blocks[b]])
        print(f"{pl}: 42-48 {pre:.1f}  54-60 {post:.1f}")

    print("\n== Team shape (mean x, metres, attacking towards x=105 for A)")
    for t in "AB":
        for label, win in [("pre", PRE), ("post", POST_WIDE)]:
            xs = []
            for p in positions:
                e = ev.get(p["event_id"])
                if e is None or p["player"][0] != t or not in_win(int(e["minute"]), win):
                    continue
                xs.append(float(p["x"]))
            print(f"{t} {label}: mean x {mean(xs):.1f}")


if __name__ == "__main__":
    main()
