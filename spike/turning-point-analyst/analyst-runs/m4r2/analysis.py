#!/usr/bin/env python3
"""Momentum-shift analysis for match 4 (Northgate A v Harbour City B).

Stdlib only. Reads the match CSVs and prints the key before/after numbers.
Usage: python3 analysis.py
"""
import csv
import math
import os
from collections import defaultdict

DATA = '/private/tmp/claude-501/itg-blind/match_4'
PRE = (40, 57)     # 18 minutes before the flagged shift (~min 58)
POST = (58, 75)    # 18 minutes after the flag
LATE = (76, 999)   # rest of the match (momentum data ends at min 94)
MATCH_END = 94


def load(name):
    with open(os.path.join(DATA, name), newline='') as fh:
        return list(csv.DictReader(fh))


def fl(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float('nan')


def sd(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return float('nan')
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def welch_t(a, b):
    if len(a) < 2 or len(b) < 2:
        return float('nan')
    se = math.sqrt(sd(a) ** 2 / len(a) + sd(b) ** 2 / len(b))
    return (mean(b) - mean(a)) / se if se else float('nan')


def inwin(m, w):
    return m is not None and w[0] <= m <= w[1]


def wlen(w):
    return min(w[1], MATCH_END) - w[0] + 1


# ---------------------------------------------------------------- load data
events = load('events.csv')
for e in events:
    e['eid'] = int(e['event_id'])
    e['minute'] = int(e['minute'])
    for k in ('x', 'y', 'end_x', 'end_y'):
        e[k] = fl(e[k])
    e['xg'] = fl(e['xg']) or 0.0
    e['up'] = int(e['under_pressure'] or 0)
ev_by_id = {e['eid']: e for e in events}

players = {r['player']: r for r in load('players.csv')}

positions = []
for p in load('positions.csv'):
    eid = int(p['event_id'])
    if eid not in ev_by_id:
        continue
    p['eid'] = eid
    p['minute'] = ev_by_id[eid]['minute']
    p['x'] = fl(p['x'])
    p['y'] = fl(p['y'])
    p['speed'] = fl(p['speed_kmh'])
    p['team'] = players[p['player']]['team']
    p['role'] = players[p['player']]['role']
    positions.append(p)
pos_by_player = defaultdict(list)
for p in positions:
    pos_by_player[p['player']].append(p)
ev_by_player = defaultdict(list)
for e in events:
    ev_by_player[e['player']].append(e)

momentum = load('momentum.csv')
for m in momentum:
    m['minute'] = int(m['minute'])
    for k in ('threat_A', 'threat_B', 'net_A_minus_B', 'rolling10_net'):
        m[k] = fl(m[k])
net = {m['minute']: m['net_A_minus_B'] for m in momentum}

# ------------------------------------------------ 1. momentum series & chance
print('=== 1. Momentum series, minutes 44-70 ===')
print('min    thrA    thrB     net  roll10')
for m in momentum:
    if 44 <= m['minute'] <= 70:
        print(f"{m['minute']:3d} {m['threat_A']:7.3f} {m['threat_B']:7.3f} "
              f"{m['net_A_minus_B']:7.3f} {m['rolling10_net']:7.3f}")

print('\nWindow means of per-minute threat:')
for name, w in (('PRE', PRE), ('POST', POST), ('LATE', LATE)):
    rows = [m for m in momentum if inwin(m['minute'], w)]
    print(f"  {name:4s} thrA={mean([m['threat_A'] for m in rows]):.3f} "
          f"thrB={mean([m['threat_B'] for m in rows]):.3f} "
          f"net={mean([m['net_A_minus_B'] for m in rows]):+.3f}")

pre_net = [net[m] for m in range(PRE[0], PRE[1] + 1) if m in net]
post_net = [net[m] for m in range(POST[0], POST[1] + 1) if m in net]
print(f"Welch t on per-minute net, PRE vs POST: t={welch_t(pre_net, post_net):+.2f} "
      f"(n={len(pre_net)} vs {len(post_net)})")

# Changepoint scan: 20 minutes either side of each candidate split
print('\nChangepoint scan (20 min each side, Welch t on net):')
cands = []
for s in range(45, 71):
    a = [net[m] for m in range(s - 20, s) if m in net]
    b = [net[m] for m in range(s, s + 20) if m in net]
    cands.append((abs(welch_t(a, b)), s, welch_t(a, b)))
cands.sort(reverse=True)
for absT, s, t in cands[:5]:
    print(f"  split at min {s}: t={t:+.2f}")

# ------------------------------------------------------- 2. team metrics
def team_metrics(team, w):
    L = wlen(w)
    T = [e for e in events if e['team'] == team and inwin(e['minute'], w)]
    passes = [e for e in T if e['type'] == 'pass']
    comp = [e for e in passes if e['outcome'] == 'complete']
    shots = [e for e in T if e['type'] == 'shot']
    carries = [e for e in T if e['type'] == 'carry' and e['end_x'] is not None]
    tackles = [e for e in T if e['type'] == 'tackle']
    ints = [e for e in T if e['type'] == 'interception']
    sign = 1 if team == 'A' else -1
    prog = [e for e in comp if e['end_x'] is not None and (e['end_x'] - e['x']) * sign >= 10]
    final = [e for e in comp if e['end_x'] is not None and
             ((e['end_x'] >= 70) if team == 'A' else (e['end_x'] <= 35))]
    sh_xg = sum(e['xg'] for e in shots)
    return {
        'events/min': len(T) / L,
        'pass completion': len(comp) / len(passes) if passes else float('nan'),
        'progressive passes/min': len(prog) / L,
        'passes into final third/min': len(final) / L,
        'shots/min': len(shots) / L,
        'xG/min': sh_xg / L,
        'xG per shot': sh_xg / len(shots) if shots else float('nan'),
        'goals': float(sum(1 for e in shots if e['outcome'] == 'goal')),
        'carries/min': len(carries) / L,
        'carry forward (m)': mean([(e['end_x'] - e['x']) * sign for e in carries]),
        'tackle win rate': (sum(1 for e in tackles if e['outcome'] == 'won') / len(tackles))
        if tackles else float('nan'),
        'interceptions/min': len(ints) / L,
        'under-pressure share': mean([float(e['up']) for e in T]),
        'mean x of actions': mean([e['x'] for e in T]),
    }


print('\n=== 2. Team metrics: PRE (40-57) vs POST (58-75) ===')
for team in ('A', 'B'):
    pre = team_metrics(team, PRE)
    post = team_metrics(team, POST)
    print(f'-- Team {team}')
    for k in pre:
        print(f'   {k:28s} pre={pre[k]:8.3f}  post={post[k]:8.3f}  diff={post[k] - pre[k]:+8.3f}')

# ----------------------------------------------------- 3. shape & intensity
def shape(team, w):
    groups = defaultdict(list)
    for p in positions:
        if p['team'] == team and p['role'] != 'GK' and inwin(p['minute'], w):
            groups[p['eid']].append(p)
    lines = [mean([p['x'] for p in g]) for g in groups.values()]
    widths = [sd([p['y'] for p in g]) for g in groups.values()]
    speeds = [p['speed'] for g in groups.values() for p in g]
    return (mean(lines), mean(widths), mean(speeds),
            mean([1.0 if s >= 20 else 0.0 for s in speeds]))


print('\n=== 3. Team shape and speed (outfield players, from positions.csv) ===')
print('team  window   mean_x  width_sd  mean_kmh  share>=20kmh')
for team in ('A', 'B'):
    for name, w in (('PRE', PRE), ('POST', POST), ('LATE', LATE)):
        s = shape(team, w)
        print(f'{team:4s}  {name:5s}  {s[0]:8.2f} {s[1]:9.2f} {s[2]:9.2f} {s[3]:12.3f}')

# ------------------------------------------------- 4. shots and pitch areas
print('\n=== 4. All shots from minute 40 on ===')
print('min team player  type      x     y   xG  outcome')
for e in sorted([e for e in events if e['type'] == 'shot' and e['minute'] >= 40],
                key=lambda e: e['t_sec_f'] if 't_sec_f' in e else e['eid']):
    print(f"{e['minute']:3d}  {e['team']}   {e['player']:4s} "
          f"{'':1s}{'':0s}{'shot':8s} {e['x']:6.1f} {e['y']:5.1f} {e['xg']:4.2f}  {e['outcome']}")

print('\nGoal events:', [(e['minute'], e['team'], e['player']) for e in events
                         if e['outcome'] == 'goal'])

# third-of-pitch occupancy of actions (attacking third for each side)
def zone(team, x):
    if x is None:
        return None
    if team == 'A':
        return 'def' if x < 35 else ('mid' if x < 70 else 'att')
    return 'def' if x > 70 else ('mid' if x > 35 else 'att')


print('\nShare of team actions by own-attacking third (att = final third for that team):')
for team in ('A', 'B'):
    for name, w in (('PRE', PRE), ('POST', POST)):
        Ts = [e for e in events if e['team'] == team and inwin(e['minute'], w)]
        z = [zone(team, e['x']) for e in Ts]
        n = len(z)
        print(f"  {team} {name:4s} att={z.count('att') / n:.3f} mid={z.count('mid') / n:.3f} "
              f"def={z.count('def') / n:.3f}  (n={n})")

# ------------------------------------------------------- 5. player level
def player_metrics(pid, w):
    T = [e for e in ev_by_player[pid] if inwin(e['minute'], w)]
    passes = [e for e in T if e['type'] == 'pass']
    comp = [e for e in passes if e['outcome'] == 'complete']
    shots = [e for e in T if e['type'] == 'shot']
    spd = [p['speed'] for p in pos_by_player[pid] if inwin(p['minute'], w)]
    return {
        'n': len(T),
        'comp': len(comp) / len(passes) if passes else float('nan'),
        'xg': sum(e['xg'] for e in shots),
        'up': mean([float(e['up']) for e in T]),
        'spd': mean(spd),
    }


print('\n=== 5. Player level, PRE (40-57) vs POST (58-75) ===')
print('pid  role  name             n pre->post | comp pre->post | xG pre->post | press pre->post | kmh pre->post')
for team in ('A', 'B'):
    for pid, r in players.items():
        if r['team'] != team:
            continue
        a = player_metrics(pid, PRE)
        b = player_metrics(pid, POST)
        if a['n'] == 0 and b['n'] == 0 and pid not in pos_by_player:
            continue
        print(f"{pid:4s} {r['role']:4s} {r['name'][:16]:16s} "
              f"{a['n']:3d}->{b['n']:<3d} | {a['comp']:5.2f}->{b['comp']:<5.2f} | "
              f"{a['xg']:4.2f}->{b['xg']:<4.2f} | {a['up']:4.2f}->{b['up']:<4.2f} | "
              f"{a['spd']:5.1f}->{b['spd']:<5.1f}")

# ------------------------------------------------ 6. fatigue by time block
blocks = [(30, 39), (40, 49), (50, 57), (58, 67), (68, 77), (78, 999)]
print('\n=== 6. Mean speed (kmh) per player by time block (fatigue check) ===')
print('pid  ' + ' '.join(f'{b[0]:>3d}-{min(b[1], MATCH_END):<3d}' for b in blocks))
for team in ('A', 'B'):
    for pid, r in players.items():
        if r['team'] != team or r['role'] == 'GK':
            continue
        vals = [mean([p['speed'] for p in pos_by_player[pid] if inwin(p['minute'], b)])
                for b in blocks]
        if all(v != v for v in vals):
            continue
        print(f'{pid:4s} ' + ' '.join(f'{v:7.1f}' for v in vals))

# ------------------------------------ 7. substitutions and cards (timing)
print('\n=== 7. Substitutions and cards ===')
subs = [e for e in events if e['type'] == 'substitution']
for e in subs:
    print(f"  min {e['minute']} {e['team']} {e['player']} {e['outcome']}")
for e in events:
    if e['type'] == 'card':
        print(f"  min {e['minute']} {e['team']} {e['player']} {e['outcome']}")

print('\nSub A14 on at 56 (for A10): A10 in 40-55 vs A14 in 56-75 (and A14 on ~ 58-75 only)')
for pid, w in (('A10', (40, 55)), ('A14', (56, 75))):
    m = player_metrics(pid, w)
    print(f"  {pid} n={m['n']} comp={m['comp']:.2f} xG={m['xg']:.2f} press={m['up']:.2f} kmh={m['spd']:.1f}")
print('Team A actions per minute: 40-55 vs 56-75 with A14 on:')
for name, w in (('40-55', (40, 55)), ('56-75', (56, 75))):
    print(f"  {name}: {team_metrics('A', w)['events/min']:.2f} events/min, "
          f"xG/min={team_metrics('A', w)['xG/min']:.3f}, "
          f"pass completion={team_metrics('A', w)['pass completion']:.3f}")

print('\nSub B13 on at 63 (for B7); B12 on at 78 (for B10). Cards: A4 min 33, B8 min 69.')
for pid, w in (('B7', (40, 62)), ('B13', (63, 75))):
    m = player_metrics(pid, w)
    print(f"  {pid} n={m['n']} comp={m['comp']:.2f} xG={m['xg']:.2f} press={m['up']:.2f} kmh={m['spd']:.1f}")

# ------------------------------------- 8. press onset around the 56 sub
print('\n=== 8. Onset check around the minute 56 substitution (A14 on for A10) ===')
print('Team A defensive actions (tackles + interceptions), location on x axis:')
for name, w in (('PRE', PRE), ('POST', POST)):
    d = [e['x'] for e in events if e['team'] == 'A' and e['type'] in ('tackle', 'interception')
         and inwin(e['minute'], w) and e['x'] is not None]
    opp_half = sum(1 for x in d if x >= 52.5) / len(d)
    print(f"  {name}: n={len(d)} mean x={mean(d):.1f}  share in B's half (x>=52.5)={opp_half:.2f}")

print('Minute by minute, minutes 53-61:')
print('min  A def actions (x)          B actions in own-attacking third  A14 events')
for m in range(53, 62):
    da = [round(e['x'], 1) for e in events if e['team'] == 'A' and e['minute'] == m
          and e['type'] in ('tackle', 'interception') and e['x'] is not None]
    ba = sum(1 for e in events if e['team'] == 'B' and e['minute'] == m
             and e['x'] is not None and e['x'] <= 35)
    a14 = sum(1 for e in events if e['player'] == 'A14' and e['minute'] == m)
    print(f'{m:3d}  {str(da):30s}  {ba:3d}                              {a14}')

print('A14 first actions (minute, type, x):',
      [(e['minute'], e['type'], e['x']) for e in ev_by_player['A14'][:4]])

pos_by_eid = defaultdict(list)
for p in positions:
    pos_by_eid[p['eid']].append(p)


def nearest_opp_distance(team, w):
    ds = []
    for e in events:
        if e['team'] != team or e['type'] not in ('pass', 'carry') or not inwin(e['minute'], w):
            continue
        rows = pos_by_eid.get(e['eid'], [])
        me = [p for p in rows if p['player'] == e['player']]
        opp = [p for p in rows if p['team'] != team and p['role'] != 'GK']
        if me and opp:
            ds.append(min(math.hypot(me[0]['x'] - o['x'], me[0]['y'] - o['y']) for o in opp))
    return mean(ds), len(ds)


print('Distance from on-ball player to nearest opponent (m), passes and carries:')
for team in ('A', 'B'):
    for name, w in (('PRE', PRE), ('POST', POST)):
        dmean, n = nearest_opp_distance(team, w)
        print(f"  team {team} {name}: mean={dmean:.2f} m (n={n})")
