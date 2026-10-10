import csv, statistics as st
from collections import defaultdict, Counter
D = "/private/tmp/claude-501/itg-blind/match_5/"
ev = list(csv.DictReader(open(D + "events.csv")))
pos = list(csv.DictReader(open(D + "positions.csv")))
players = {r["player"]: r for r in csv.DictReader(open(D + "players.csv"))}
for e in ev:
    e["minute"] = int(float(e["minute"])); e["x"] = float(e["x"] or 0); e["y"] = float(e["y"] or 0)
    e["xg"] = float(e["xg"]) if e["xg"] not in ("", None) else 0.0
    e["under_pressure"] = int(float(e["under_pressure"] or 0))
PRE = (30, 51); POST = (52, 65)   # shift flagged at 52
def win(lo, hi): return [e for e in ev if lo <= e["minute"] <= hi]
def team_summary(es, team):
    ps = [e for e in es if e["team"] == team]
    passes = [e for e in ps if e["type"] == "pass"]
    comp = sum(e["outcome"] == "complete" for e in passes)
    shots = [e for e in ps if e["type"] == "shot"]
    return dict(n=len(ps), passes=len(passes), pass_pct=round(100*comp/max(1,len(passes)),1),
                shots=len(shots), xg=round(sum(e["xg"] for e in shots),2),
                goals=sum(e["outcome"] == "goal" for e in shots),
                def_actions=sum(e["type"] in ("tackle","interception","block") for e in ps),
                pressured=sum(e["under_pressure"] for e in ps),
                fouls=sum(e["type"] == "foul" for e in ps))
print("== Team summary, pre", PRE, "post", POST, "minutes ==")
for lab, (lo, hi) in (("pre", PRE), ("post", POST)):
    es = win(lo, hi)
    for t in "AB":
        print(lab, t, team_summary(es, t))
print("\n== Shots 40-70 ==")
for e in ev:
    if e["type"] in ("shot","card","substitution") and 40 <= e["minute"] <= 70:
        print(e["minute"], e["team"], e["player"], e["type"], e["outcome"], round(e["xg"],3), round(e["x"],1), round(e["y"],1))
print("\n== Events 46-58 (team B/A key actions) ==")
for e in ev:
    if 46 <= e["minute"] <= 58 and e["type"] in ("pass","carry","tackle","interception","shot","block","foul"):
        if e["type"]=="pass" and e["outcome"]=="complete" and e["minute"] < 52: continue
        print(e["minute"], e["team"], e["player"], e["type"], e["outcome"], round(e["x"],1), round(e["y"],1), e["under_pressure"])

# ---------- part 2: positions, speeds, per-player behaviour ----------
evmin = {e["event_id"]: e["minute"] for e in ev}
evteam = {e["event_id"]: e for e in ev}
for p in pos:
    p["minute"] = evmin.get(p["event_id"], -1)
    p["x"] = float(p["x"]); p["y"] = float(p["y"]); p["speed_kmh"] = float(p["speed_kmh"])
    p["team"] = players[p["player"]]["team"] if p["player"] in players else "?"
def bucket_mean(rows, lo, hi, key):
    v = [r[key] for r in rows if lo <= r["minute"] <= hi]
    return round(st.mean(v), 2) if v else None
print("\n== Mean speed (km/h) per player by 10-min bucket, 0-75 ==")
bins = [(0,9),(10,19),(20,29),(30,39),(40,49),(50,59),(60,69),(70,79)]
print("player", [f"{a}-{b}" for a,b in bins])
for pl in sorted(players, key=lambda k:(players[k]['team'], int(k[1:]))):
    rows = [p for p in pos if p["player"] == pl]
    if not rows: continue
    print(pl, players[pl]['name'][:12].ljust(12), [bucket_mean(rows,a,b,"speed_kmh") for a,b in bins])
print("\n== Per-player mean x, y, speed: pre 30-51 vs post 52-65 ==")
for pl in sorted(players, key=lambda k:(players[k]['team'], int(k[1:]))):
    rows = [p for p in pos if p["player"] == pl]
    pre = [r for r in rows if 30 <= r["minute"] <= 51]; post = [r for r in rows if 52 <= r["minute"] <= 65]
    if not pre or not post: continue
    f = lambda rs,k: round(st.mean(r[k] for r in rs),1)
    print(pl, "pre x/y/spd", f(pre,"x"), f(pre,"y"), f(pre,"speed_kmh"), "| post", f(post,"x"), f(post,"y"), f(post,"speed_kmh"),
          "| dx", round(f(post,"x")-f(pre,"x"),1), "dspd", round(f(post,"speed_kmh")-f(pre,"speed_kmh"),2))
print("\n== Per-player touches & pass% pre vs post (per 10 min) ==")
for pl in sorted(players, key=lambda k:(players[k]['team'], int(k[1:]))):
    def stats(lo,hi):
        es=[e for e in ev if e["player"]==pl and lo<=e["minute"]<=hi and e["type"] in ("pass","carry","tackle","interception","shot","block")]
        ps=[e for e in es if e["type"]=="pass"]
        c=sum(e["outcome"]=="complete" for e in ps)
        return len(es), round(100*c/max(1,len(ps)))
    a=stats(30,51); b=stats(52,65)
    print(pl, "pre n/pass%", a, "post", b)

# ---------- part 3: significance checks ----------
import random
random.seed(1)
print("\n== Team mean speed by window (all outfield, per player-sample) ==")
def team_speed(team, lo, hi):
    v=[p["speed_kmh"] for p in pos if p["team"]==team and p["player"]!="" and lo<=p["minute"]<=hi and not players[p["player"]]["role"]=="GK"]
    return round(st.mean(v),3), len(v)
for t in "AB":
    print(t, "0-29", team_speed(t,0,29), "30-51", team_speed(t,30,51), "52-65", team_speed(t,52,65), "66-79", team_speed(t,66,79))
# Change-point check: B outfield speed, mean before/after 52 vs random 14-min windows
def window_mean(team, lo, hi):
    v=[p["speed_kmh"] for p in pos if p["team"]==team and lo<=p["minute"]<=hi and players[p["player"]]["role"]!="GK"]
    return st.mean(v) if v else None
for t in "AB":
    obs = window_mean(t,30,51) - window_mean(t,52,65)
    null=[]
    for _ in range(2000):
        s=random.randint(0,75-35); a=window_mean(t,s,s+21); b=window_mean(t,s+22,s+35)
        if a is not None and b is not None: null.append(a-b)
    p = sum(n>=obs for n in null)/len(null)
    print(f"Team {t} speed drop 30-51 minus 52-65 = {obs:.2f} km/h; permutation p(drop>=obs)={p:.3f}")
# Momentum series: shift size vs random 14-min windows
mom=[]
for r in csv.DictReader(open(D+"momentum.csv")):
    mom.append((int(float(r["minute"])), float(r["net_A_minus_B"])))
mom=dict(mom)
obs_shift = st.mean(mom[m] for m in range(52,66)) - st.mean(mom[m] for m in range(38,52))
null=[]
for s in range(30,60):
    null.append(st.mean(mom[m] for m in range(s,s+14)) - st.mean(mom[m] for m in range(s-14,s)))
print(f"Net momentum mean 52-65 minus 38-51 = {obs_shift:.3f}; null from other 14-min windows range [{min(null):.3f}, {max(null):.3f}]")
# Per-player fatigue: slope of speed vs minute within 0-75 for each outfield player
print("\n== Speed slope (km/h per 10 min) over 0-79 and post-pre change z ==")
for pl in sorted(players, key=lambda k:(players[k]['team'], int(k[1:]))):
    rows=[p for p in pos if p["player"]==pl and p["minute"]>=0]
    if len(rows)<30 or players[pl]["role"]=="GK": continue
    xs=[r["minute"] for r in rows]; ys=[r["speed_kmh"] for r in rows]
    mx,my=st.mean(xs),st.mean(ys)
    slope=sum((x-mx)*(y-my) for x,y in zip(xs,ys))/sum((x-mx)**2 for x in xs)*10
    pre=[r["speed_kmh"] for r in rows if 30<=r["minute"]<=51]; post=[r["speed_kmh"] for r in rows if 52<=r["minute"]<=65]
    if len(pre)<5 or len(post)<5: continue
    sd=st.pstdev(ys); se=sd*((1/len(pre))+(1/len(post)))**0.5
    z=(st.mean(post)-st.mean(pre))/se
    print(pl, "slope/10min", round(slope,3), "post-pre", round(st.mean(post)-st.mean(pre),2), "z", round(z,2))
# Event rate by team per minute
print("\n== Events per minute by team ==")
for t in "AB":
    a=len([e for e in ev if e["team"]==t and 30<=e["minute"]<=51])/22
    b=len([e for e in ev if e["team"]==t and 52<=e["minute"]<=65])/14
    print(t, "pre/min", round(a,2), "post/min", round(b,2))

# ---------- part 4: pressure flag timing and counter-attack check ----------
print("\n== under_pressure flags by team, 10-min bins ==")
for t in "AB":
    row=[]
    for lo in range(0,80,10):
        es=[e for e in ev if e["team"]==t and lo<=e["minute"]<lo+10]
        row.append((sum(e["under_pressure"] for e in es), len(es)))
    print(t, row)
print("\n== Pressure minutes for B (all flagged events) ==")
print(sorted(e["minute"] for e in ev if e["team"]=="B" and e["under_pressure"]))
print("\n== Sequence 51-53 (ball chain) ==")
for e in ev:
    if 51 <= e["minute"] <= 53 and e["type"] in ("pass","carry","interception","tackle","shot"):
        print(e["t_sec"], e["minute"], e["team"], e["player"], e["type"], e["outcome"], round(e["x"],1), e.get("end_x",""), e["xg"])
