import random
from sim import *
def add_bench(cfg):
    r = random.Random(cfg['seed']+5)
    for t in 'AB':
        for n, role in ((12,'ST'),(13,'RCM'),(14,'ST'),(15,'LW'),(16,'DM')):
            src = next(p for p in cfg['teams'][t].values() if p['role']==role)
            cfg['teams'][t][f'{t}{n}'] = dict(src, press=round(src['press']+r.uniform(-.03,.03),3))
def scenario(kind, seed):
    cfg = base_config(seed); add_bench(cfg)
    # distractors present in every match: routine subs and cards with no effect
    cfg['subs'] = [(63,'B','B7','B13'),(71,'A','A11','A15'),(78,'B','B10','B12')]
    cfg['cards'] = [(33,'A4',1.0),(69,'B8',1.0)]
    truth = dict(cause_type='no_clear_cause', player_id=None, onset_minute=None)
    if kind=='fatigue':
        cfg['fatigue']['B2'] = (50, 64, 0.30); truth = dict(cause_type='player_fatigue', player_id='B2', onset_minute=50)
    elif kind=='sub':
        cfg['teams']['A']['A14']['press'] = 1.75
        cfg['subs'].append((56,'A','A10','A14')); truth = dict(cause_type='substitution', player_id='A14', onset_minute=56)
    elif kind=='booked':
        cfg['cards'].append((47,'B6',0.15)); truth = dict(cause_type='player_behaviour_change', player_id='B6', onset_minute=47)
    return cfg, truth
