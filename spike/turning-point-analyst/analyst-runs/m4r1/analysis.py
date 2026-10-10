"""Match 4 (Northgate A v Harbour City B): why did momentum swing to team A around minute 58?

Reads only /private/tmp/claude-501/itg-blind/match_4/ and prints the key numbers
behind the verdict in verdict.json. Standard library only.
"""
import csv
import statistics as st
from collections import Counter, defaultdict

D = "/private/tmp/claude-501/itg-blind/match_4/"
PRE = (40, 57)   # window before the flagged shift
POST = (58, 75)  # equal-length window after it
SUB_A14_MIN = 56

events = list(csv.DictReader(open(D + "events.csv")))
for e in events:
    e["minute"] = int(e["minute"])
positions = list(csv.DictReader(open(D + "positions.csv")))
players = {r["player"]: r for r in csv.DictReader(open(D + "players.csv"))}
momentum = list(csv.DictReader(open(D + "momentum.csv")))


def inwin(m, w):
    return w[0] <= m <= w[1]


def wins(team, w, pred=lambda e: True):
    return [e for e in events if e["team"] == team and e["type"] in ("tackle", "interception")
            and e["outcome"] == "won" and inwin(e["minute"], w) and pred(e)]


print("1. Momentum (sum of per-minute threat)")
for name, w in (("pre", PRE), ("post", POST)):
    rows = [r for r in momentum if inwin(int(r["minute"]), w)]
    a = sum(float(r["threat_A"]) for r in rows)
    b = sum(float(r["threat_B"]) for r in rows)
    print(f"   {name} {w}: threat A={a:.2f} B={b:.2f} net(A-B)={a - b:+.2f}")

print("\n2. Attacking output")
for name, w in (("pre", PRE), ("post", POST)):
    for t in "AB":
        shots = [e for e in events if e["team"] == t and e["type"] == "shot" and inwin(e["minute"], w)]
        xg = sum(float(e["xg"] or 0) for e in shots)
        print(f"   {name} team {t}: shots={len(shots)} xG={xg:.2f}")
bshots = [e["minute"] for e in events if e["team"] == "B" and e["type"] == "shot"]
rolling = [sum(1 for m in bshots if s <= m < s + 18) for s in range(0, 71)]
print(f"   B shots in any 18-min window over the match: median {st.median(rolling)}, max {max(rolling)}")
print(f"   B shots 40-57 = {sum(inwin(m, PRE) for m in bshots)}, 58-75 = {sum(inwin(m, POST) for m in bshots)}")

print("\n3. Where team A won the ball (tackles+interceptions)")
for name, w in (("pre", PRE), ("post", POST)):
    ws = wins("A", w)
    hi = wins("A", w, lambda e: float(e["x"]) >= 60)
    print(f"   {name}: total={len(ws)} in B half (x>=60)={len(hi)} mean x={st.mean(float(e['x']) for e in ws):.1f}")
    print(f"      B-half wins by player: {dict(Counter(e['player'] for e in hi))}")
print(f"   B won-ball actions: pre={len(wins('B', PRE))} post={len(wins('B', POST))}")

print("\n4. Substitution A14 (on) for A10 (off) at minute 56")
a14 = [e for e in events if e["player"] == "A14" and inwin(e["minute"], POST)]
print(f"   A14 events 58-75: {len(a14)}, won ball actions={len(wins('A', POST, lambda e: e['player']=='A14'))},"
      f" under pressure={sum(e['under_pressure']=='1' for e in a14)}")
print(f"   A10 events 40-55: {sum(1 for e in events if e['player']=='A10' and inwin(e['minute'], PRE))}")
print("   Minute-by-minute A won-ball actions 54-61:",
      {m: sum(1 for e in wins('A', (m, m)) ) for m in range(54, 62)})

print("\n5. Fatigue and shape checks")
spd = defaultdict(lambda: defaultdict(list))
for p in positions:
    pass
ev_min = {e["event_id"]: e["minute"] for e in events}
for p in positions:
    if p["event_id"] in ev_min:
        spd[p["player"]][ev_min[p["event_id"]]].append(float(p["speed_kmh"]))
for pl in ("B7", "A10", "A14", "B11"):
    vals = lambda w: [v for m, vs in spd[pl].items() if inwin(m, w) for v in vs]
    pre, post = vals((44, 57)), vals((58, 75))
    print(f"   {pl} speed pre(44-57)={st.mean(pre):.2f} km/h (only minutes 56-57 for A14)" if pre else f"   {pl} pre: none", end="")
    print(f"  post(58-75)={st.mean(post):.2f} km/h" if post else "  post: none")
print("   B7 (highest B winner pre) speed 50-54 vs 55-59:",
      round(st.mean([v for m in range(50, 55) for v in spd['B7'][m]]), 2),
      round(st.mean([v for m in range(55, 60) for v in spd['B7'][m]]), 2))

print("\n6. Pressure on B players")
for name, w in (("pre", PRE), ("post", POST)):
    print(f"   {name}: B under-pressure events = {sum(1 for e in events if e['team']=='B' and e['under_pressure']=='1' and inwin(e['minute'], w))}"
          f" of {sum(1 for e in events if e['team']=='B' and inwin(e['minute'], w))}")

print("\n7. Substitution timing vs momentum")
for r in momentum:
    m = int(r["minute"])
    if 54 <= m <= 60:
        print(f"   min {m}: rolling10 net={float(r['rolling10_net']):+.3f}")
