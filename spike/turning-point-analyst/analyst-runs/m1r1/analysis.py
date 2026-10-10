"""Match 1 (Northgate A v Harbour City B): why did momentum swing to team A around minute 50?

Standard library only. Reads the match_1 folder, prints the key numbers.
Windows: PRE = minutes 33-46 (before B6's yellow card), POST = minutes 47-66 (after it, covering the 50-minute shift).
"""
import csv
import math
from collections import defaultdict

DATA = "/private/tmp/claude-501/itg-blind/match_1"
PRE = (33, 47)
POST = (47, 67)


def load(name):
    with open(f"{DATA}/{name}", newline="") as fh:
        return list(csv.DictReader(fh))


def in_win(m, win):
    return win[0] <= m < win[1]


events = load("events.csv")
positions = load("positions.csv")
players = {p["player"]: p for p in load("players.csv")}
for e in events:
    e["m"] = float(e["minute"])

print("== Momentum (per minute net A-B) ==")
mom = load("momentum.csv")
for r in mom:
    if int(float(r["minute"])) in (44, 47, 49, 50, 51, 58, 63):
        print(f"min {r['minute']:>3}  net {float(r['net_A_minus_B']):+.3f}  rolling10 {float(r['rolling10_net']):+.3f}")

print("\n== Team B attacking output (completed passes/carries ending in B's attacking third, x<=35) ==")
def b_final_third(win):
    return sum(1 for e in events if e["team"] == "B" and e["type"] in ("pass", "carry")
               and e["outcome"] == "complete" and in_win(e["m"], win) and float(e["end_x"]) <= 35)

def a_final_third(win):
    return sum(1 for e in events if e["team"] == "A" and e["type"] in ("pass", "carry")
               and e["outcome"] == "complete" and in_win(e["m"], win) and float(e["end_x"]) >= 70)

print(f"B entries into attacking third: PRE {b_final_third(PRE)}  POST {b_final_third(POST)}")
print(f"A entries into attacking third: PRE {a_final_third(PRE)}  POST {a_final_third(POST)}")

def xg(team, win):
    return sum(float(e["xg"] or 0) for e in events if e["type"] == "shot" and e["team"] == team and in_win(e["m"], win))

print(f"B xG: PRE {xg('B', PRE):.2f}  POST {xg('B', POST):.2f}")
print(f"A xG: PRE {xg('A', PRE):.2f}  POST {xg('A', POST):.2f}")

print("\n== Team B defensive actions (tackles + interceptions + blocks) ==")
def team_def(team, win):
    return sum(1 for e in events if e["team"] == team and e["type"] in ("tackle", "interception", "block") and in_win(e["m"], win))
print(f"B total: PRE {team_def('B', PRE)}  POST {team_def('B', POST)}  (team volume did not fall; the drop is specific to B6)")

print("\n== Player B6 (Finn Stahl, DM, yellow card at 47) ==")
b6_def_pre = sum(1 for e in events if e["player"] == "B6" and e["type"] in ("tackle", "interception", "block") and in_win(e["m"], PRE))
b6_def_post = sum(1 for e in events if e["player"] == "B6" and e["type"] in ("tackle", "interception", "block") and in_win(e["m"], POST))
rate_pre = b6_def_pre / (PRE[1] - PRE[0])
expected_post = rate_pre * (POST[1] - POST[0])
p_zero = math.exp(-expected_post)
print(f"B6 defensive actions: PRE {b6_def_pre} ({rate_pre:.2f}/min)  POST {b6_def_post}  expected at PRE rate {expected_post:.1f}")
print(f"Poisson P(0 or fewer actions | PRE rate) = {p_zero:.4f}")

b6_events_pre = sum(1 for e in events if e["player"] == "B6" and in_win(e["m"], PRE))
b6_events_post = sum(1 for e in events if e["player"] == "B6" and in_win(e["m"], POST))
print(f"B6 on-ball events: PRE {b6_events_pre}  POST {b6_events_post}")

def mean_pos(player, win):
    ids = {e["event_id"]: e for e in events if e["m"] >= win[0] and e["m"] < win[1]}
    xs = [float(r["x"]) for r in positions if r["player"] == player and r["event_id"] in ids]
    sp = [float(r["speed_kmh"]) for r in positions if r["player"] == player and r["event_id"] in ids]
    return (sum(xs) / len(xs), sum(sp) / len(sp)) if xs else (float("nan"), float("nan"))

x_pre, sp_pre = mean_pos("B6", PRE)
x_post, sp_post = mean_pos("B6", POST)
print(f"B6 mean x (B attacks x=0, so higher = deeper): PRE {x_pre:.1f}  POST {x_post:.1f}")
print(f"B6 mean speed km/h: PRE {sp_pre:.1f}  POST {sp_post:.1f}  (no fatigue signal)")

print("\n== Alternatives ==")
for pid in ("B7", "B9", "B10"):
    s_pre = mean_pos(pid, PRE)[1]
    s_post = mean_pos(pid, POST)[1]
    print(f"{pid} mean speed km/h: PRE {s_pre:.1f}  POST {s_post:.1f}")
first_sub = [e for e in events if e["type"] == "substitution"]
for s in first_sub:
    print(f"substitution min {s['minute']}: {s['team']} {s['player']} {s['outcome']}")
print("shots by A after 49:", [(e["minute"], e["player"], e["xg"]) for e in events if e["team"] == "A" and e["type"] == "shot" and e["m"] >= 49])
pressured = defaultdict(lambda: [0, 0])
for e in events:
    k = "pre50" if e["m"] < 50 else "post50"
    pressured[k][0] += 1
    pressured[k][1] += int(e["under_pressure"] or 0)
for k, (n, p) in pressured.items():
    print(f"under_pressure share {k}: {p}/{n} = {p / n:.3f}  (flag vanishes for both teams at 50)")
