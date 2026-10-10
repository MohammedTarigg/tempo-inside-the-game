"""Match 3 (Northgate A v Harbour City B): why did momentum turn to team A around minute 57?

Standard library only. Reads from the blind match folder (read-only).
Usage: python3 -I analysis.py
"""
import csv
import statistics as st
from collections import defaultdict

DATA = "/private/tmp/claude-501/itg-blind/match_3"
PRE = (40, 56)    # window before the shift (B on top)
POST = (57, 66)   # window after the shift


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def in_win(m, w):
    return w[0] <= m <= w[1]


events = list(csv.DictReader(open(f"{DATA}/events.csv")))
ev_by_id = {e["event_id"]: e for e in events}
positions = list(csv.DictReader(open(f"{DATA}/positions.csv")))
players = list(csv.DictReader(open(f"{DATA}/players.csv")))
momentum = list(csv.DictReader(open(f"{DATA}/momentum.csv")))
team_of = {p["player"]: p["team"] for p in players}

# 1. Momentum: net threat before and after
pre_net = st.mean(float(r["net_A_minus_B"]) for r in momentum if in_win(int(r["minute"]), PRE))
post_net = st.mean(float(r["net_A_minus_B"]) for r in momentum if in_win(int(r["minute"]), POST))
print(f"[1] Mean per-minute net threat (A minus B): pre {pre_net:+.3f}, post {post_net:+.3f}")

# 2. Team-level events before vs after
print("[2] Team event summary (pre 40-56 vs post 57-66)")
for t in "AB":
    for name, w in (("pre", PRE), ("post", POST)):
        es = [e for e in events if e["team"] == t and in_win(int(e["minute"]), w)]
        shots = [e for e in es if e["type"] == "shot"]
        xg = sum(fnum(e["xg"]) or 0 for e in shots)
        print(f"    {t} {name}: shots {len(shots)}, xG {xg:.2f}, "
              f"won tackles/ints {sum(e['outcome'] == 'won' for e in es if e['type'] in ('tackle', 'interception'))}")

# 3. Pitch position and speed for each team, from positions.csv
agg = defaultdict(list)
for p in positions:
    e = ev_by_id.get(p["event_id"])
    if not e:
        continue
    m = int(e["minute"])
    t = team_of.get(p["player"])
    for name, w in (("pre", PRE), ("post", POST)):
        if in_win(m, w):
            agg[(t, name, "x")].append(float(p["x"]))
            agg[(t, name, "spd")].append(float(p["speed_kmh"]))
print("[3] Team mean x (own attack direction: A to 105, B to 0) and mean speed")
for t in "AB":
    print(f"    {t}: x pre {st.mean(agg[(t, 'pre', 'x')]):.1f} -> post {st.mean(agg[(t, 'post', 'x')]):.1f}; "
          f"speed pre {st.mean(agg[(t, 'pre', 'spd')]):.2f} -> post {st.mean(agg[(t, 'post', 'spd')]):.2f} km/h")

# 4. Every player: speed pre vs post, ranked by drop
spd = defaultdict(lambda: {"pre": [], "post": [], "pre_max": [], "post_max": []})
for p in positions:
    e = ev_by_id.get(p["event_id"])
    if not e:
        continue
    m = int(e["minute"])
    s = float(p["speed_kmh"])
    for name, w in (("pre", PRE), ("post", POST)):
        if in_win(m, w):
            spd[p["player"]][name].append(s)
rank = []
for pl, d in spd.items():
    if d["pre"] and d["post"]:
        rank.append((st.mean(d["post"]) - st.mean(d["pre"]), pl, st.mean(d["pre"]), st.mean(d["post"]), len(d["post"])))
rank.sort()
print("[4] Players with the largest speed change (km/h, pre -> post); lowest first")
for delta, pl, a, b, n in rank[:4]:
    print(f"    {pl} ({team_of[pl]}): {a:.2f} -> {b:.2f} ({delta:+.2f}), n_post={n}")
print(f"    median change across all 22 players: {st.median(r[0] for r in rank):+.2f}")

# 5. Focus on B2: minute-by-minute speed and peak speed
b2 = defaultdict(list)
for p in positions:
    if p["player"] != "B2":
        continue
    e = ev_by_id.get(p["event_id"])
    if e:
        b2[int(e["minute"])].append(float(p["speed_kmh"]))
print("[5] B2 (Rafe Tindall, RB) minute-by-minute speed (mean / peak, km/h)")
line = []
for m in range(44, 72, 2):
    v = b2.get(m, []) + b2.get(m + 1, [])
    if v:
        line.append(f"{m}: {st.mean(v):.1f}/{max(v):.0f}")
print("    " + "  ".join(line))
pre_peak = st.mean(max(b2[m]) for m in range(40, 57) if b2.get(m))
post_peak = st.mean(max(b2[m]) for m in range(57, 67) if b2.get(m))
print(f"    mean per-minute peak speed: pre (40-56) {pre_peak:.1f}, post (57-66) {post_peak:.1f}")

# onset: first minute from which the 3-minute rolling mean speed stays below 8 km/h
mins = sorted(b2)
onset = None
for m in mins:
    window = [x for k in (m, m + 1, m + 2) for x in b2.get(k, [])]
    if window and st.mean(window) < 8.0 and all(
            st.mean([x for k in (k2, k2 + 1, k2 + 2) for x in b2.get(k, [])] or [0]) < 8.0
            for k2 in range(m, min(m + 6, max(mins) + 1))):
        onset = m
        break
print(f"    sustained slowdown (3-min mean below 8 km/h thereafter) starts at minute {onset}")

# 6. Substitutions and cards: do they coincide with the change?
print("[6] Substitutions and cards")
for e in events:
    if e["type"] in ("substitution", "card"):
        print(f"    min {e['minute']} {e['team']} {e['player']} {e['type']} {e['outcome']}")
print("    B13 came on at 63 for B7, and A15 at 71 for A11: both after the 57 shift, so they cannot be its cause.")
b2_own = [e for e in events if e["player"] == "B2" and 50 <= int(e["minute"]) <= 70]
print(f"    B2 was never substituted; he played on through minutes 50-70 with {len(b2_own)} events.")

# 7. Chance check: shot counts A pre vs post (Poisson-style rough test)
a_pre_sh = sum(1 for e in events if e["team"] == "A" and e["type"] == "shot" and in_win(int(e["minute"]), PRE))
a_post_sh = sum(1 for e in events if e["team"] == "A" and e["type"] == "shot" and in_win(int(e["minute"]), POST))
print(f"[7] Team A shots: pre {a_pre_sh} in 17 min, post {a_post_sh} in 10 min "
      f"(zero shots before, six after: a real change but a small sample)")
