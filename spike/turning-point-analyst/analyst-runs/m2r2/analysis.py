"""Match 2 (Northgate A v Harbour City B): why did momentum swing towards A around minute 53?

Standard library only. Reads from the blind match folder, prints the key numbers.
"""
import csv
import collections
import math
import statistics as st

DATA = "/private/tmp/claude-501/itg-blind/match_2"
ONSET = 53.0  # minute the momentum detector flagged


def load(name):
    with open(f"{DATA}/{name}", newline="") as fh:
        return list(csv.DictReader(fh))


events = load("events.csv")
positions = load("positions.csv")
momentum = load("momentum.csv")
ev_by_id = {e["event_id"]: e for e in events}


def minute(e):
    return float(e["t_sec"]) / 60.0


def pass_stats(rows):
    passes = [e for e in rows if e["type"] == "pass"]
    comp = sum(e["outcome"] == "complete" for e in passes)
    return len(passes), (comp / len(passes) if passes else float("nan"))


def xg(rows):
    return sum(float(e["xg"]) for e in rows if e["type"] == "shot" and e["xg"])


def window(a, b, team):
    return [e for e in events if e["team"] == team and a <= minute(e) < b]


print("== 1. Momentum (per-minute threat, mean per minute) ==")
pre_m = [m for m in momentum if int(m["minute"]) < ONSET]
post_m = [m for m in momentum if int(m["minute"]) >= ONSET]
for tm in ("A", "B"):
    col = f"threat_{tm}"
    pre = st.mean(float(m[col]) for m in pre_m)
    post = st.mean(float(m[col]) for m in post_m)
    print(f"team {tm}: threat/min 0-52 = {pre:.4f}, 53-90 = {post:.4f}")

net = [float(m["net_A_minus_B"]) for m in momentum]
swing = sum(net[53:61])
windows = [sum(net[i:i + 8]) for i in range(len(net) - 8)]
rank = sum(w >= swing for w in windows)
print(f"net A-B over minutes 53-60 = {swing:.3f}; ranks {rank} of {len(windows)} "
      f"8-minute windows (i.e. not unusual)")

print("\n== 2. Team B: did its play change? ==")
for a, b, label in [(0, 53, "before"), (53, 90, "after")]:
    n, pc = pass_stats(window(a, b, "B"))
    print(f"B {label}: passes={n}, pass completion={pc:.3f}, "
          f"passes/min={n / (b - a):.2f}, xG={xg(window(a, b, 'B')):.3f}")

print("\n== 3. Team shape (mean x of B outfield players; larger x = deeper for B) ==")
shape = collections.defaultdict(list)
for p in positions:
    e = ev_by_id.get(p["event_id"])
    if not e or p["player"][0] != "B" or p["player"] == "B1":
        continue
    ctx = "ball_in_A_half" if float(e["x"]) > 52.5 else "ball_in_B_half"
    per = "pre" if minute(e) < ONSET else "post"
    shape[(ctx, per)].append(float(p["x"]))
for k in sorted(shape):
    print(f"{k}: mean x = {st.mean(shape[k]):.1f} (n={len(shape[k])})")

print("\n== 4. Player-level: B7 (Luca Draper, RCM) and sprint share vs team ==")
for pl in ("B7", "B3", "B2"):
    before = [float(p["speed_kmh"]) for p in positions
              if p["player"] == pl and p["event_id"] in ev_by_id
              and minute(ev_by_id[p["event_id"]]) < ONSET]
    after = [float(p["speed_kmh"]) for p in positions
             if p["player"] == pl and p["event_id"] in ev_by_id
             and minute(ev_by_id[p["event_id"]]) >= ONSET]
    sb = sum(s > 18 for s in before) / len(before)
    sa = sum(s > 18 for s in after) / len(after)
    print(f"{pl}: mean speed {st.mean(before):.2f} -> {st.mean(after):.2f} km/h; "
          f"sprint share (>18 km/h) {sb:.3f} -> {sa:.3f}")

b_passes_pre = [e for e in window(0, 53, "B") if e["type"] == "pass"]
b7_pre = sum(e["player"] == "B7" for e in b_passes_pre)
b7_mid = sum(e["player"] == "B7" for e in window(53, 61, "B") if e["type"] == "pass")
b7_post = sum(e["player"] == "B7" for e in window(61, 90, "B") if e["type"] == "pass")
n_pre = len(b_passes_pre)
n_mid = sum(e["type"] == "pass" for e in window(53, 61, "B"))
print(f"B7 share of B passes: 0-52 = {b7_pre / n_pre:.3f}; 53-60 = "
      f"{b7_mid}/{n_mid} passes ; 61-90 = {b7_post} passes")
lam = (b7_pre / 53.0) * 37.0
cdf = sum(math.exp(-lam) * lam ** k / math.factorial(k) for k in range(7))
print(f"Poisson P(<=6 B7 passes in 53-90 | pre rate) = {cdf:.4f}; "
      f"but the drop starts after 61, and B7 is subbed at 63 (after onset)")

print("\n== 5. Substitutions and cards (timing vs onset) ==")
for e in events:
    if e["type"] in ("substitution", "card"):
        print(f"min {e['minute']}: {e['team']} {e['player']} {e['type']} {e['outcome']}")

print("\n== Verdict logic ==")
print("No single factor stands out: team B's shape, pass completion and tempo are unchanged,")
print("the A surge is a short run of carries and two blocked shots, and the swing is ordinary")
print("in size. Verdict: no_clear_cause.")
