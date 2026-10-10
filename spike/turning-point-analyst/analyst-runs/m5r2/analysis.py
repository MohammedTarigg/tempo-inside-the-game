"""Match 5 (Northgate A v Harbour City B): why did momentum swing towards A around minute 52?

Standard library only. Compares minutes 40-51 (before) with 52-60 (after).
Run: python3 -I analysis.py
"""
import csv
import math
import collections
import random
import statistics as st

DATA = "/private/tmp/claude-501/itg-blind/match_5"
BEFORE = (40, 51)
AFTER = (52, 60)


def load(name):
    with open(f"{DATA}/{name}", newline="") as fh:
        return list(csv.DictReader(fh))


def in_win(m, win):
    return win[0] <= m <= win[1]


events = load("events.csv")
positions = load("positions.csv")
players = {r["player"]: r for r in load("players.csv")}
ev_by_id = {e["event_id"]: e for e in events}

shots = [(int(e["minute"]), e["team"], float(e["xg"] or 0)) for e in events if e["type"] == "shot"]


def xg_diff(win, shot_list):
    a = sum(x for m, t, x in shot_list if in_win(m, win) and t == "A")
    b = sum(x for m, t, x in shot_list if in_win(m, win) and t == "B")
    return a - b


print("== 1. Size of the swing (xG for A minus B) ==")
pre_d = xg_diff(BEFORE, shots)
post_d = xg_diff(AFTER, shots)
obs_swing = post_d - pre_d
print(f"xG A-B 40-51: {pre_d:+.3f}   52-60: {post_d:+.3f}   swing: {obs_swing:+.3f}")

all_swings = [xg_diff((s + 12, s + 20), shots) - xg_diff((s, s + 11), shots) for s in range(0, 70)]
print(f"largest adjacent-window swing in match: {max(all_swings):+.3f} (this window is the max: {obs_swing >= max(all_swings) - 1e-9})")

random.seed(1)
teams = [t for _, t, _ in shots]
mins = [m for m, _, _ in shots]
xgs = [x for _, _, x in shots]
N = 5000
hits = 0
for _ in range(N):
    random.shuffle(teams)
    sh = list(zip(mins, teams, xgs))
    if xg_diff(AFTER, sh) - xg_diff(BEFORE, sh) >= obs_swing:
        hits += 1
print(f"permutation p (team labels shuffled, n={N}): {hits / N:.3f}")

print("\n== 2. Where the shots came from ==")
for win, label in [(BEFORE, "40-51"), (AFTER, "52-60")]:
    for t in "AB":
        s = [x for m, tt, x in shots if in_win(m, win) and tt == t]
        print(f"{label} team {t}: shots {len(s)}  xG {sum(s):.3f}  xG/shot {(sum(s) / len(s)) if s else 0:.3f}")

print("\n== 3. Territory, pressure and event rates ==")
for win, label in [(BEFORE, "40-51"), (AFTER, "52-60")]:
    for t in "AB":
        rows = [e for e in events if in_win(int(e["minute"]), win) and e["team"] == t]
        final = sum(1 for e in rows if ((float(e["x"] or 0) >= 70) if t == "A" else (float(e["x"] or 0) <= 35)))
        pressed = sum(1 for e in rows if e["under_pressure"] == "1")
        print(f"{label} team {t}: events {len(rows)}  final-third actions {final}  under pressure {pressed}")

print("\n== 4. Team shape (mean x of all players, from positions) ==")
pos_win = collections.defaultdict(list)
for p in positions:
    e = ev_by_id.get(p["event_id"])
    if not e:
        continue
    m = int(e["minute"])
    for win, label in [(BEFORE, "pre"), (AFTER, "post")]:
        if in_win(m, win):
            pos_win[(p["player"], label)].append((float(p["x"]), float(p["speed_kmh"])))
for t in "AB":
    row = []
    for label in ["pre", "post"]:
        xs = [st.mean(x for x, _ in pos_win[(pid, label)]) for pid in players if players[pid]["team"] == t and pos_win[(pid, label)]]
        row.append(f"{label} {st.mean(xs):.1f}")
    print(f"team {t} mean player x: " + "  ".join(row))

print("\n== 5. Substitutions and cards ==")
for e in events:
    if e["type"] in ("substitution", "card"):
        print(f"min {e['minute']:>2} team {e['team']} {e['type']:<12} {e['player']} {e['outcome']}")

print("\n== 6. Player-level activity change (events, 40-51 vs 52-60) ==")
rows = []
for pid in players:
    pre = sum(1 for e in events if e["player"] == pid and in_win(int(e["minute"]), BEFORE))
    post = sum(1 for e in events if e["player"] == pid and in_win(int(e["minute"]), AFTER))
    if pre + post < 3:
        continue
    lam = (pre + post) / 21 * 9
    z = (post - lam) / math.sqrt(lam) if lam > 0 else 0.0
    rows.append((round(z, 2), pid, pre, post))
rows.sort()
print("largest drops (z):", rows[:3])
print("largest rises (z):", rows[-3:])

print("\n== 7. Speed: fatigue check (0-30 vs 61-95 min) and B6 ==")
for pid in ["B6", "A10", "A11", "B8", "B9"]:
    a = [float(p["speed_kmh"]) for p in positions if p["player"] == pid and ev_by_id.get(p["event_id"]) and int(ev_by_id[p["event_id"]]["minute"]) <= 30]
    b = [float(p["speed_kmh"]) for p in positions if p["player"] == pid and ev_by_id.get(p["event_id"]) and int(ev_by_id[p["event_id"]]["minute"]) >= 61]
    print(f"{pid}: 0-30 {st.mean(a):.2f} km/h   61-95 {st.mean(b):.2f} km/h")

print("\n== 8. Pressure difference, B team (Fisher-style count) ==")
b_pre = [e for e in events if in_win(int(e["minute"]), BEFORE) and e["team"] == "B"]
b_post = [e for e in events if in_win(int(e["minute"]), AFTER) and e["team"] == "B"]
print(f"B under pressure: pre {sum(e['under_pressure'] == '1' for e in b_pre)}/{len(b_pre)}  post {sum(e['under_pressure'] == '1' for e in b_post)}/{len(b_post)}")
