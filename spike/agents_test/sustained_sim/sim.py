#!/usr/bin/env python3
"""Throwaway spike simulator: zone-based football match with planted causes.
Not the real engine. Seeded and replayable, with interventions that can be neutralised."""
import random, math, csv, json, os, copy

ROLES = ['GK','RB','RCB','LCB','LB','DM','RCM','LCM','RW','ST','LW']
NOM = {'GK':(6,34),'RB':(28,12),'RCB':(24,26),'LCB':(24,42),'LB':(28,56),'DM':(40,34),
       'RCM':(50,22),'LCM':(50,46),'RW':(70,10),'ST':(76,34),'LW':(70,58)}
LANE_Y = [11,34,57]              # lane 0 = attacker's right, 2 = attacker's left
COL_X = [8.75+17.5*c for c in range(6)]
VAL = [0.002,0.005,0.012,0.03,0.08,0.2]
# defenders responsible for attacker zone (band, lane): (role, weight, attr)
RESP = {
 (0,0):[('LW',1.0,'press'),('ST',0.4,'press')], (0,1):[('ST',1.0,'press'),('LW',0.2,'press'),('RW',0.2,'press')], (0,2):[('RW',1.0,'press'),('ST',0.4,'press')],
 (1,0):[('LCM',1.0,'defend'),('LW',0.4,'defend'),('DM',0.3,'defend')], (1,1):[('DM',1.0,'defend'),('RCM',0.5,'defend'),('LCM',0.5,'defend')], (1,2):[('RCM',1.0,'defend'),('RW',0.4,'defend'),('DM',0.3,'defend')],
 (2,0):[('LB',1.0,'defend'),('LCB',0.5,'defend'),('LCM',0.2,'defend')], (2,1):[('RCB',0.7,'defend'),('LCB',0.7,'defend'),('DM',0.8,'defend')], (2,2):[('RB',1.0,'defend'),('RCB',0.5,'defend'),('RCM',0.2,'defend')],
}
CARRIER = {
 (0,0):['RCB'],(0,1):['GK','RCB','LCB'],(0,2):['LCB'],
 (1,0):['RB'],(1,1):['DM','RCB','LCB'],(1,2):['LB'],
 (2,0):['RB','RCM'],(2,1):['DM','RCM','LCM'],(2,2):['LB','LCM'],
 (3,0):['RCM','RW'],(3,1):['RCM','LCM','ST'],(3,2):['LCM','LW'],
 (4,0):['RW','RB'],(4,1):['ST','RCM','LCM'],(4,2):['LW','LB'],
 (5,0):['RW'],(5,1):['ST','ST','RW','LW'],(5,2):['LW'],
}

def base_config(seed):
    r = random.Random(seed*7919+1)
    teams = {}
    for t, d, p in (('A',0.80,0.99),('B',0.90,1.01)):
        pl = {}
        for i, role in enumerate(ROLES):
            pl[f'{t}{i+1}'] = dict(role=role, defend=round(d+r.uniform(-.05,.05),3), press=round(0.75+r.uniform(-.1,.1),3),
                                   passing=round(p+r.uniform(-.02,.02),3), pace=round(0.88+r.uniform(-.08,.08),3))
        teams[t] = pl
    return dict(seed=seed, teams=teams, fatigue={}, subs=[], cards=[])

def energy(cfg, pid, minute, on_since):
    f = cfg['fatigue'].get(pid)
    played = minute - on_since
    e = 1 - 0.10*(played/95)
    if f:
        s, en, floor = f
        if minute >= s:
            e = min(e, 1 - (1-floor)*min(1,(minute-s)/max(1,en-s)))
    return max(0.2, e)

class Match:
    def __init__(self, cfg, switch_minute=None, run=0, record=True):
        self.cfg = cfg; self.rng = random.Random(cfg['seed']); self.prng = random.Random(cfg['seed']+99)
        self.switch = switch_minute; self.run = run; self.switched = False; self.record = record
        self.on = {t:{p['role']:pid for pid,p in cfg['teams'][t].items() if int(pid[1:])<=11} for t in 'AB'}
        self.on_since = {pid:0 for t in 'AB' for pid in self.on[t].values()}
        self.engage = {}
        self.events=[]; self.pos=[]; self.t=0.0; self.eid=0
        self.threat = {'A':[0.0]*100,'B':[0.0]*100}; self.score={'A':0,'B':0}
        self.pending = sorted([('sub',)+tuple(s) for s in cfg['subs']]+[('card',)+tuple(c) for c in cfg['cards']], key=lambda x:x[1])

    def minute(self): return self.t/60.0
    def attr(self, pid): return self.cfg['teams'][pid[0]][pid]
    def eff(self, pid, kind):
        return self.attr(pid)[kind]*energy(self.cfg,pid,self.minute(),self.on_since[pid])*self.engage.get(pid,1.0)
    def pressure(self, deft, c, l):
        band = 0 if c<=1 else (1 if c<=3 else 2)
        ws = [(self.on[deft][role], w*self.eff(self.on[deft][role],kind)) for role,w,kind in RESP[(band,l)]]
        return sum(w for _,w in ws)/1.7, ws
    def xy(self, team, c, l, jitter=True):
        x, y = COL_X[c], LANE_Y[l]
        if jitter: x += self.prng.uniform(-6,6); y += self.prng.uniform(-7,7)
        if team=='B': x, y = 105-x, 68-y
        return round(min(105,max(0,x)),1), round(min(68,max(0,y)),1)

    def snapshot(self, eid, team, bx, by, c):
        m = self.minute()
        for t in 'AB':
            defending = (t != team)
            for role, pid in self.on[t].items():
                nx, ny = NOM[role]
                if t=='B': nx, ny = 105-nx, 68-ny
                x = nx + 0.45*(bx-52.5); y = ny + 0.25*(by-34)
                e = energy(self.cfg,pid,m,self.on_since[pid]); sign = 1 if t=='A' else -1
                if defending and role!='GK':
                    x -= sign*(c*2.2)                      # retreat as opponents advance
                    x += sign*(1-e)*26                     # tired players are caught upfield
                    if c<=1 and role in ('ST','RW','LW'): x += sign*(self.attr(pid)['press']-0.75)*14*self.engage.get(pid,1.0)
                x += self.prng.gauss(0,1.5); y += self.prng.gauss(0,1.5)
                sp = 33*self.attr(pid)['pace']*e*self.prng.betavariate(2,3) if role!='GK' else self.prng.uniform(2,9)
                self.pos.append((eid,pid,round(min(105,max(0,x)),1),round(min(68,max(0,y)),1),round(sp,1)))

    def emit(self, team, pid, typ, c, l, c2=None, l2=None, outcome='', xg='', recv='', press=None, snap=True):
        self.eid += 1
        x,y = self.xy(team,c,l); x2,y2 = self.xy(team,c2,l2) if c2 is not None else ('','')
        if self.record:
            self.events.append(dict(event_id=self.eid, t_sec=round(self.t,1), minute=int(self.minute()), team=team, player=pid, type=typ,
                x=x,y=y,end_x=x2,end_y=y2,outcome=outcome,xg=xg,receiver=recv,under_pressure='' if press is None else int(press>0.95)))
            if snap: self.snapshot(self.eid, team if typ not in ('tackle','interception','block','foul','card') else ('B' if team=='A' else 'A'), x, y, c)
        return self.eid

    def scripted(self):
        while self.pending and self.pending[0][1] <= self.minute():
            ev = self.pending.pop(0)
            if ev[0]=='sub':
                _, m, team, off, on = ev
                role = self.attr(off)['role']
                if self.on[team].get(role)!=off: continue
                self.on[team][role]=on; self.on_since[on]=self.minute()
                self.eid+=1
                if self.record: self.events.append(dict(event_id=self.eid,t_sec=round(self.t,1),minute=int(self.minute()),team=team,player=on,type='substitution',x='',y='',end_x='',end_y='',outcome=f'replaces {off}',xg='',receiver='',under_pressure=''))
                self.t += 30
            else:
                _, m, pid, eng = ev
                if pid not in self.on[pid[0]].values(): continue
                self.engage[pid]=eng; self.eid+=1
                if self.record:
                    for typ in ('foul','card'):
                        self.events.append(dict(event_id=self.eid,t_sec=round(self.t,1),minute=int(self.minute()),team=pid[0],player=pid,type=typ,x='',y='',end_x='',end_y='',outcome='yellow' if typ=='card' else '',xg='',receiver='',under_pressure='')); self.eid+=1
                self.t += 25

    def play(self):
        team, c, l = 'A', 2, 1
        while self.minute() < 95:
            if self.switch is not None and not self.switched and self.minute() >= self.switch:
                self.rng = random.Random(self.cfg['seed']*1000003 + self.run*101 + 17); self.switched = True
            self.scripted()
            r = self.rng; deft = 'B' if team=='A' else 'A'
            carrier = self.on[team][r.choice(CARRIER[(c,l)])]
            P, ws = self.pressure(deft, c, l)
            self.t += r.uniform(2,7)
            mi = min(99,int(self.minute()))
            def turnover(to_c=None, to_l=None):
                nonlocal team, c, l
                team = deft; c = 5-c if to_c is None else to_c; l = 2-l if to_l is None else to_l
            def pick(ws):
                tot = sum(w for _,w in ws); x = r.uniform(0,tot)
                for pid,w in ws:
                    x -= w
                    if x<=0: return pid
                return ws[-1][0]
            # tackle attempt
            if r.random() < 0.09*P:
                tk = pick(ws)
                if r.random() < 0.16:
                    self.emit(deft, tk, 'foul', 5-c, 2-l, snap=False); self.t += 20
                else:
                    self.emit(deft, tk, 'tackle', 5-c, 2-l, outcome='won'); turnover(); continue
            # shot
            pshot = 0.30 if c==5 else (0.07 if c==4 else 0)
            if r.random() < pshot:
                base = (0.16 if l==1 else 0.07) if c==5 else 0.035
                xg = round(max(0.01, base*(1.7-0.8*P)*r.uniform(0.6,1.5)),3)
                u = r.random()
                if u < xg: out='goal'
                else: out = r.choices(['saved','off_target','blocked'],[4,4,2])[0]
                self.emit(team, carrier, 'shot', c, l, outcome=out, xg=xg, press=P)
                self.threat[team][mi] += xg
                if out=='goal': self.score[team]+=1; self.t += 55; turnover(2,1)
                else:
                    if out=='blocked': self.emit(deft, pick(ws), 'block', 5-c, 2-l, snap=False)
                    self.t += 18; turnover(0,1)
                continue
            u = r.random()
            if u < 0.56: kind, c2 = ('pass' if u<0.46 else 'carry'), min(5,c+1)
            elif u < 0.84: kind, c2 = 'pass', c
            else: kind, c2 = 'pass', max(0,c-1)
            cands = [x for x in (l-1,l,l+1) if 0<=x<=2]
            if c2==c: cands = [x for x in cands if x!=l]
            wts = [(0.6 if x==l else 0.25)*math.exp(-2.0*self.pressure(deft,c2,x)[0]) for x in cands]
            l2 = r.choices(cands,wts)[0]
            P2, ws2 = self.pressure(deft, c2, l2)
            ps = (1.08 - 0.36*P2 - 0.022*c2 - (0.05 if kind=='carry' else 0) + (0.05 if c2<c else 0))*self.attr(carrier)['passing']
            if r.random() < ps:
                recv = self.on[team][r.choice(CARRIER[(c2,l2)])] if kind=='pass' else ''
                self.emit(team, carrier, kind, c, l, c2, l2, outcome='complete', recv=recv, press=P)
                self.threat[team][mi] += VAL[c2]*0.25
                c, l = c2, l2
            else:
                self.emit(team, carrier, kind, c, l, c2, l2, outcome='incomplete', press=P)
                c, l = c2, l2
                self.emit(deft, pick(ws2), 'interception', 5-c, 2-l, outcome='won')
                turnover()
        return self

def net_series(m):
    return [m.threat['A'][i]-m.threat['B'][i] for i in range(95)]
def turning_minute(net, lo=40, hi=75, w=18):
    best, bt = -1e9, None
    for t in range(lo,hi):
        d = sum(net[t:t+w])/w - sum(net[t-w:t])/w
        if d>best: best, bt = d, t
    return bt, best
def share_after(m, T, w=25):
    a = sum(m.threat['A'][T:T+w]); b = sum(m.threat['B'][T:T+w]); return a/(a+b) if a+b else 0.5

def neutralise(cfg, hyp):
    """hyp: dict(cause_type, player_id, onset_minute). Returns config with that one thing removed."""
    c = copy.deepcopy(cfg); pid = hyp.get('player_id'); ct = hyp.get('cause_type')
    if ct=='player_fatigue' and pid: c['fatigue'][pid] = (0, 1, 0.999)
    elif ct=='substitution' and pid: c['subs'] = [s for s in c['subs'] if pid not in (s[2], s[3])]
    elif ct=='player_behaviour_change' and pid: c['cards'] = [(m,p,1.0) if p==pid else (m,p,e) for m,p,e in c['cards']]
    return c

def replay_test(cfg, hyp, T, runs=300):
    """Share of threat for A in the 25 minutes after T, with the match as played vs with the hypothesised cause removed."""
    alt = neutralise(cfg, hyp)
    start = max(1, min(T, int(hyp.get('onset_minute') or T)) - 3)
    f = [share_after(Match(cfg, start, k, record=False).play(), T) for k in range(runs)]
    g = [share_after(Match(alt, start, k, record=False).play(), T) for k in range(runs)]
    mf, mg = sum(f)/runs, sum(g)/runs
    sd = math.sqrt((sum((x-mf)**2 for x in f)+sum((x-mg)**2 for x in g))/(2*runs-2))
    return dict(as_played=round(mf,3), cause_removed=round(mg,3), effect=round(mf-mg,3), z=round((mf-mg)/(sd*math.sqrt(2/runs)),1))

def write(m, outdir, names):
    os.makedirs(outdir, exist_ok=True)
    with open(f'{outdir}/events.csv','w',newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(m.events[0].keys())); w.writeheader(); w.writerows(m.events)
    with open(f'{outdir}/positions.csv','w',newline='') as f:
        w = csv.writer(f); w.writerow(['event_id','player','x','y','speed_kmh']); w.writerows(m.pos)
    with open(f'{outdir}/players.csv','w',newline='') as f:
        w = csv.writer(f); w.writerow(['player','team','role','name','starter'])
        for t in 'AB':
            for pid,p in m.cfg['teams'][t].items(): w.writerow([pid,t,p['role'],names[pid],int(int(pid[1:])<=11)])
    net = net_series(m)
    with open(f'{outdir}/momentum.csv','w',newline='') as f:
        w = csv.writer(f); w.writerow(['minute','threat_A','threat_B','net_A_minus_B','rolling10_net'])
        for i in range(95): w.writerow([i, round(m.threat['A'][i],4), round(m.threat['B'][i],4), round(net[i],4), round(sum(net[max(0,i-9):i+1]),4)])
