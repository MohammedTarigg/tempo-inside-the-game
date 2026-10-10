"""Match 1 (Northgate A v Harbour City B): why did momentum swing towards A around minute 50?

Standalone: standard library only. Reads the blind match folder (read-only) and prints key numbers.
"""
import csv
import math
import statistics as st
from collections import Counter, defaultdict

DATA = "/private/tmp/claude-501/itg-blind/match_1"
PRE = (35, 49)   # 15 minutes before the flagged shift
POST = (50, 64)  # 15 minutes after onset
TRIO = {"A": ["A9", "A10", "A11"], "B": ["B9", "B10", "B11"]}


def load(name):
    with open(f"{DATA}/{name}", newline="") as fh:
        return list(csv.DictReader(fh))


events = load("events.csv")
positions = load("positions.csv")
players = {r["player"]: r for r in load("players.csv")}
momentum = {int(r["minute"]): r for r in load("momentum.csv")}
ev_by_id = {e["event_id"]: e for e in events}
xy_events = [e for e in events if e["x"] != ""]


def in_win(minute, win):
    return win[0] <= int(minute) <= win[1]


def attack_x(e):
    """x measured in the direction the event's team attacks (100 = close to opponent goal)."""
    x = float(e["x"])
    return x if e["team"] == "A" else 105 - x


print("=== 1. Momentum detector (rolling 10 min net, A minus B)")
for m in (40, 45, 49, 50, 52, 55, 58, 60, 64, 66):
    print(f"  minute {m:2d}: net={float(momentum[m]['net_A_minus_B']):+.3f}  rolling10={float(momentum[m]['rolling10_net']):+.3f}")

print("\n=== 2. Attacking output, before vs after (15 min windows)")
for team in "AB":
    for name, win in (("pre 35-49", PRE), ("post 50-64", POST)):
        sh = [e for e in events if e["team"] == team and e["type"] == "shot" and in_win(e["minute"], win)]
        xg = sum(float(e["xg"] or 0) for e in sh)
        print(f"  team {team} {name}: shots={len(sh)} xG={xg:.2f} goals={sum(e['outcome']=='goal' for e in sh)}")

print("\n=== 3. Where the play was (mean event x, attack-adjusted, 100 = near opponent goal)")
for team in "AB":
    for name, win in (("pre", PRE), ("post", POST)):
        xs = [attack_x(e) for e in xy_events if e["team"] == team and in_win(e["minute"], win)]
        print(f"  team {team} {name}: mean attacking x={st.mean(xs):.1f} (n={len(xs)})")

print("\n=== 4. Pressure flags (under_pressure=1) per 10 minute block, all events")
for lo in range(0, 90, 10):
    es = [e for e in events if lo <= int(e["minute"]) < lo + 10]
    print(f"  {lo:2d}-{lo+9:2d}: {sum(e['under_pressure'] == '1' for e in es):2d} flagged of {len(es)}")
pre_up = [e for e in events if in_win(e["minute"], PRE) and e["under_pressure"] == "1"]
post_up = [e for e in events if in_win(e["minute"], POST) and e["under_pressure"] == "1"]
print(f"  flagged events pre={len(pre_up)} post={len(post_up)}")

print("\n=== 5. Player speed (km/h, from positions) pre 30-49 vs post 50-64, by team mean")
for team in "AB":
    pre, post = [], []
    for p in positions:
        if p["player"][0] != team or players[p["player"]]["role"] == "GK":
            continue
        m = int(ev_by_id[p["event_id"]]["minute"])
        if 30 <= m <= 49:
            pre.append(float(p["speed_kmh"]))
        elif 50 <= m <= 64:
            post.append(float(p["speed_kmh"]))
    print(f"  team {team}: pre={st.mean(pre):.2f} post={st.mean(post):.2f} change={st.mean(post)-st.mean(pre):+.2f}")

print("\n=== 6. Per-player speed change (post minus pre), outfield players")
changes = {}
for pl, row in players.items():
    if row["role"] == "GK":
        continue
    pre = [float(p["speed_kmh"]) for p in positions if p["player"] == pl and in_win(ev_by_id[p["event_id"]]["minute"], (30, 49))]
    post = [float(p["speed_kmh"]) for p in positions if p["player"] == pl and in_win(ev_by_id[p["event_id"]]["minute"], POST)]
    if pre and post:
        changes[pl] = st.mean(post) - st.mean(pre)
sd = st.pstdev(changes.values())
mu = st.mean(changes.values())
for pl, d in sorted(changes.items(), key=lambda kv: kv[1])[:5]:
    print(f"  {pl} {players[pl]['name']:<16} {d:+.2f} km/h  (z={(d-mu)/sd:+.2f})")
print(f"  mean change across outfield players {mu:+.2f}, sd {sd:.2f}")

print("\n=== 7. Territory: outfield players' mean x shift (pre 35-46 vs post 50-59), raw pitch x")
shift = {}
for pl in players:
    if players[pl]["role"] == "GK":
        continue
    a = [float(p["x"]) for p in positions if p["player"] == pl and in_win(ev_by_id[p["event_id"]]["minute"], (35, 46))]
    b = [float(p["x"]) for p in positions if p["player"] == pl and in_win(ev_by_id[p["event_id"]]["minute"], (50, 59))]
    if a and b:
        shift[pl] = st.mean(b) - st.mean(a)
print(f"  A players: mean shift {st.mean(v for k, v in shift.items() if k[0]=='A'):+.1f} m, range "
      f"{min(v for k, v in shift.items() if k[0]=='A'):+.1f} to {max(v for k, v in shift.items() if k[0]=='A'):+.1f}")
print(f"  B players: mean shift {st.mean(v for k, v in shift.items() if k[0]=='B'):+.1f} m, range "
      f"{min(v for k, v in shift.items() if k[0]=='B'):+.1f} to {max(v for k, v in shift.items() if k[0]=='B'):+.1f}")
print("  (same direction and size for all 20 outfield players: the whole pitch moved, not one team or player)")

print("\n=== 8. Harbour City forward trio (B9, B10, B11) involvement")
for name, win in (("pre 25-49", (25, 49)), ("post 50-64", POST)):
    n = sum(1 for e in events if e["player"] in TRIO["B"] and in_win(e["minute"], win))
    print(f"  {name}: touches={n} ({n/(win[1]-win[0]+1):.2f} per min)")
pre_rate = sum(1 for e in events if e["player"] in TRIO["B"] and in_win(e["minute"], (25, 49))) / 25
expected = pre_rate * 15
observed = sum(1 for e in events if e["player"] in TRIO["B"] and in_win(e["minute"], POST))
p_low = sum(math.exp(-expected) * expected ** k / math.factorial(k) for k in range(observed + 1))
print(f"  Poisson P(<= {observed} touches | expected {expected:.1f}) = {p_low:.2e}")
bp = [e for e in events if e["team"] == "B" and e["type"] == "pass" and e["outcome"] == "complete" and e["receiver"] in TRIO["B"]]
for name, win in (("pre 25-42", (25, 42)), ("43-49", (43, 49)), ("post 50-64", POST)):
    comp = [e for e in events if e["team"] == "B" and e["type"] == "pass" and e["outcome"] == "complete" and in_win(e["minute"], win)]
    share = sum(e["receiver"] in TRIO["B"] for e in comp) / max(len(comp), 1)
    print(f"  B completed passes to trio, {name}: {share:.2f}")

print("\n=== 9. Substitutions and cards vs onset")
for e in events:
    if e["type"] in ("substitution", "card"):
        print(f"  minute {e['minute']:>2}: {e['type']:<12} {e['team']} {e['player']} {e['outcome']}")
print("  onset of the shift (pressure flags, pitch position step, minute-level team x): minute 50")

print("\n=== 10. Is a 15 minute swing this large unusual? Sliding 15-min windows, mean attacking x difference (A minus B)")
def window_gap(start):
    a = [attack_x(e) for e in xy_events if e["team"] == "A" and start <= int(e["minute"]) < start + 15]
    b = [attack_x(e) for e in xy_events if e["team"] == "B" and start <= int(e["minute"]) < start + 15]
    return st.mean(a) - st.mean(b)
gaps = {s: window_gap(s) for s in range(0, 76)}
target = gaps[35]
print(f"  window 35-49 gap={gaps[35]:+.1f}, window 50-64 gap={gaps[50]:+.1f}")
ranked = sorted(gaps.values())
rank_from_top = sum(v >= gaps[50] for v in gaps.values())
print(f"  window 50-64 is the {rank_from_top}-th most A-favourable of {len(gaps)} sliding windows (1 = most A-favourable)")
print(f"  most B-favourable window gap={min(gaps.values()):+.1f}, most A-favourable gap={max(gaps.values()):+.1f}")

print("\n=== 11. Shots from close range after 50 (A10)")
for e in events:
    if e["player"] == "A10" and e["type"] == "shot" and int(e["minute"]) >= 45:
        print(f"  minute {e['minute']}: x={e['x']} xG={e['xg']} {e['outcome']}")
a10_pre = sum(1 for e in events if e["player"] == "A10" and in_win(e["minute"], PRE))
a10_post = sum(1 for e in events if e["player"] == "A10" and in_win(e["minute"], POST))
print(f"  A10 touches pre={a10_pre} post={a10_post}")
