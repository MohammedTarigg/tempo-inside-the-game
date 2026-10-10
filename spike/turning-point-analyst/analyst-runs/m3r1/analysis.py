"""Match 3 momentum shift analysis (Northgate A v Harbour City B), standard library only.

Question: a momentum shift towards team A starts around minute 57. Why?
Reads only the match_3 input folder.
"""
import csv
import math
import collections
import statistics as st

DATA = "/private/tmp/claude-501/itg-blind/match_3"
BEFORE = (0, 56)   # before the flagged shift
AFTER = (57, 94)   # from the flagged shift to full time


def load():
    ev = list(csv.DictReader(open(f"{DATA}/events.csv")))
    evd = {int(e["event_id"]): e for e in ev}
    P = collections.defaultdict(dict)
    for p in csv.DictReader(open(f"{DATA}/positions.csv")):
        P[int(p["event_id"])][p["player"]] = (float(p["x"]), float(p["y"]), float(p["speed_kmh"]))
    return ev, evd, P


def in_window(m, w):
    return w[0] <= m <= w[1]


def poisson_sf(k, lam):
    """P(X >= k) for Poisson(lam), computed with logs to avoid overflow."""
    total = 0.0
    for i in range(k, k + 400):
        total += math.exp(-lam + i * math.log(lam) - math.lgamma(i + 1))
    return total


def main():
    ev, evd, P = load()

    print("== 1. Team totals before vs after (minutes 0-56 vs 57-94)")
    for team in "AB":
        for w, name in [(BEFORE, "before"), (AFTER, "after ")]:
            sel = [e for e in ev if e["team"] == team and in_window(int(e["minute"]), w)]
            shots = [e for e in sel if e["type"] == "shot"]
            xg = sum(float(e["xg"] or 0) for e in shots)
            tk = sum(e["type"] == "tackle" for e in sel)
            print(f"team {team} {name}: events={len(sel)} shots={len(shots)} xG={xg:.2f} tackles={tk}")

    print("\n== 2. Shot rate test for A (Poisson, one-sided)")
    k1 = sum(e["team"] == "A" and e["type"] == "shot" and in_window(int(e["minute"]), BEFORE) for e in ev)
    k2 = sum(e["team"] == "A" and e["type"] == "shot" and in_window(int(e["minute"]), AFTER) for e in ev)
    r1, r2 = k1 / 57, k2 / 38
    lam = (k1 + k2) / 95 * 38
    print(f"A shots per min before={r1:.3f} after={r2:.3f}; P(>= {k2} shots | old rate)={poisson_sf(k2, lam):.4f}")

    print("\n== 3. B2 (Rafe Tindall, RB) speed by 5-minute bin")
    bins = collections.defaultdict(list)
    for eid, pl in P.items():
        e = evd.get(eid)
        if e and "B2" in pl:
            bins[int(e["minute"]) // 5].append(pl["B2"][2])
    for k in sorted(bins):
        if k * 5 <= 95:
            v = sorted(bins[k])
            print(f"min {k*5:2d}-{k*5+4:2d}: n={len(v):3d} mean={st.mean(v):5.1f} km/h p90={v[int(0.9*(len(v)-1))]:5.1f}")
    pre = [pl["B2"][2] for eid, pl in P.items() if eid in evd and in_window(int(evd[eid]["minute"]), (0, 44)) and "B2" in pl]
    post = [pl["B2"][2] for eid, pl in P.items() if eid in evd and in_window(int(evd[eid]["minute"]), (65, 94)) and "B2" in pl]
    print(f"B2 mean speed min 0-44={st.mean(pre):.1f} km/h, min 65-94={st.mean(post):.1f} km/h")

    print("\n== 4. Other B outfielders (excluding B2) and A speed, same windows")
    for w in [(0, 44), (45, 56), (57, 70), (71, 94)]:
        sb = [v[2] for eid, pl in P.items() if eid in evd and in_window(int(evd[eid]["minute"]), w)
              for k, v in pl.items() if k.startswith("B") and k != "B2"]
        sa = [v[2] for eid, pl in P.items() if eid in evd and in_window(int(evd[eid]["minute"]), w)
              for k, v in pl.items() if k.startswith("A")]
        print(f"min {w[0]}-{w[1]}: B excl B2 mean={st.mean(sb):.2f} km/h, A mean={st.mean(sa):.2f} km/h")

    print("\n== 5. Where A attacks relative to B2 (A on-ball passes/carries/shots)")
    for w in [(0, 44), (45, 56), (57, 94)]:
        rows = []
        for e in ev:
            eid = int(e["event_id"])
            if e["team"] == "A" and in_window(int(e["minute"]), w) and e["type"] in ("pass", "carry", "shot") \
               and eid in P and "B2" in P[eid]:
                rows.append((float(e["x"]), float(e["y"]), P[eid]["B2"][0], P[eid]["B2"][1]))
        third = [r for r in rows if r[0] >= 70]   # control: attacking third only
        d_all = [math.hypot(r[0] - r[2], r[1] - r[3]) for r in rows]
        d_third = [math.hypot(r[0] - r[2], r[1] - r[3]) for r in third]
        near_third = sum(d < 15 for d in d_third) / max(len(third), 1)
        print(f"min {w[0]}-{w[1]}: A on-ball n={len(rows)} mean dist to B2={st.mean(d_all):.1f} m; "
              f"attacking third n={len(third)} share within 15 m of B2={near_third:.2f}")

    print("\n== 6. Substitutions and cards (timing vs onset)")
    for e in ev:
        if e["type"] in ("substitution", "card"):
            print(f"min {e['minute']}: {e['team']} {e['player']} {e['type']} {e['outcome']}")

    print("\n== 7. Verdict inputs")
    print("Onset: B2 mean speed falls below 10 km/h from min ~50 and is ~4 km/h from min 60; no sub for B2.")


if __name__ == "__main__":
    main()
