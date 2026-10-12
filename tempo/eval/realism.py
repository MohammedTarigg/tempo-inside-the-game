"""Realism check for the generator. The same measurements on the seven real matches and on generated ones, side by side,
ending with the stake model (trained on real tracking only) scored on generated matches.

Usage: python3 -m tempo.eval.realism data/dfl-cache [seeds...]"""

import bisect
import json
import os
import sys
import numpy as np

from ..contracts import DEFENDING_CHALLENGE
from ..generator.export import match_data
from ..generator.sim import Sim
from ..stake import dfl
from ..stake.features import HIST, HZ, window_features
from ..stake.model import ARTIFACTS, CardState, StakeModel

STEP = 3


def halves_of_generated(md):
    """A generated match in the same per-half structure the real reader produces."""
    out = {}
    ids = md["meta"]["ids"]
    for per in (1, 2):
        k = md["period"] == per
        d = md["home_dir"][k][0]
        out[per] = dict(
            ids=ids,
            team=md["team"],
            xy=md["pos"][k].transpose(1, 0, 2),
            ball=md["ball"][k],
            live=md["live"][k],
            poss=md["poss"][k].astype(int),
            own=np.array([-d * 52.5, d * 52.5]),
            t0=float(md["clock"][k][0]),
            n=int(k.sum()),
            keepers=[0, 11],
        )
    labels = {}
    for e in md["events"]:
        if e["typeId"] in DEFENDING_CHALLENGE and not (e["typeId"] == 4 and e["outcome"] == 1):
            labels.setdefault(e["playerId"], []).append([e["matchTime"], e["typeId"] == 4])
    for v in labels.values():
        v.sort()
    return dict(halves=out, labels=labels, n_challenges=sum(len(v) for v in labels.values()))


def measure(match, model, keepers_by_pos=None):
    r = dict(
        per_min=[],
        fast=[],
        sprint=[],
        press=[],
        scores=[],
        y=[],
        near=0,
        live_s=0.0,
        cards_faint=0,
        cards_full=0,
        card_minutes=0.0,
    )
    for H in match["halves"].values():
        xy, ball, live = H["xy"], H["ball"], H["live"]
        n, T, _ = xy.shape
        gk = set(H.get("keepers", keepers_by_pos(H) if keepers_by_pos else []))
        step = np.linalg.norm(np.diff(xy, axis=1), axis=2)
        sp = step * HZ
        lv = live[1:]
        mins = lv.sum() / HZ / 60
        r["live_s"] += lv.sum() / HZ
        for j in range(n):
            if j in gk or np.isnan(xy[j, :, 0]).mean() > 0.5:
                continue
            ok = lv & ~np.isnan(sp[j]) & (sp[j] < 12)
            if ok.sum() < 5 * 60 * HZ:
                continue
            r["per_min"].append(step[j][ok].sum() / (ok.sum() / HZ / 60))
            r["fast"].append((sp[j][ok] > 5.5).mean())
            r["sprint"].append((sp[j][ok] > 7.0).mean())
        fr = np.arange(HIST - 1, T - 1, STEP)
        # pressure: from the ball to the nearest outfield player of the team without it
        db = np.hypot(xy[..., 0] - ball[None, :, 0], xy[..., 1] - ball[None, :, 1])
        db = np.where(np.isnan(db), 1e9, db)
        for f in fr[::8]:
            if live[f] and H["poss"][f] >= 0:
                dfn = [j for j in np.flatnonzero(H["team"] != H["poss"][f]) if j not in gk]
                r["press"].append(db[dfn, f].min())
        states = {}
        for f in fr:
            if not live[f]:
                continue
            sl = slice(f - HIST + 1, f + 1)
            idx, feats, dist = window_features(xy[:, sl], ball[sl], H["team"], H["own"], H["poss"][sl], live[sl])
            if not len(idx):
                continue
            s = model.score(feats)
            t = H["t0"] + f / HZ
            for k, pi in enumerate(idx):
                lab = match["labels"].get(H["ids"][pi], [])
                j = bisect.bisect_left([a for a, _ in lab], t - 0.05)
                r["y"].append(1.0 if j < len(lab) and lab[j][0] - t <= 1.5 else 0.0)
                st = states.setdefault(int(pi), [CardState(model.faint, model.full), 0])
                lvl = st[0].update(t, float(s[k]))
                r["cards_faint"] += lvl >= 1 and st[1] == 0
                r["cards_full"] += lvl == 2 and st[1] < 2
                st[1] = lvl
            r["scores"] += s.tolist()
            r["near"] += len(idx)
        r["card_minutes"] += (
            sum(1 for j in range(n) if j not in gk and np.isnan(xy[j, :, 0]).mean() < 0.5) * lv.sum() / HZ / 60
        )
    return r


def auc(p, y):
    p, y = np.asarray(p), np.asarray(y)
    o = np.argsort(p, kind="stable")
    rk = np.empty(len(p))
    rk[o] = np.arange(len(p))
    n1 = y.sum()
    n0 = len(y) - n1
    return float((rk[y > 0].sum() - n1 * (n1 - 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def summarise(rows, n_matches, n_chal):
    S = np.concatenate([np.asarray(r["scores"]) for r in rows])
    Y = np.concatenate([np.asarray(r["y"]) for r in rows])
    cm = sum(r["card_minutes"] for r in rows)
    return {
        "in-play metres a minute, outfield": round(float(np.mean(np.concatenate([r["per_min"] for r in rows]))), 1),
        "share of in-play time above 5.5 m/s": round(float(np.mean(np.concatenate([r["fast"] for r in rows]))), 4),
        "share of in-play time above 7 m/s": round(float(np.mean(np.concatenate([r["sprint"] for r in rows]))), 4),
        "ball to nearest defender, metres: p25, median, p75": [
            round(float(np.percentile(np.concatenate([r["press"] for r in rows]), q)), 1) for q in (25, 50, 75)
        ],
        "ball in play, minutes a match": round(sum(r["live_s"] for r in rows) / 60 / n_matches, 1),
        "defender-moments near a live ball, a match": round(sum(r["near"] for r in rows) / n_matches),
        "logged defending challenges a match": round(n_chal / n_matches, 1),
        "share of those moments followed by a challenge": round(float(Y.mean()), 4),
        "stake score: mean": round(float(S.mean()), 4),
        "stake score: share above the faint threshold": round(float((S >= 0.05).mean()), 4),
        "stake score: share above the full threshold": round(float((S >= 0.20).mean()), 4),
        "stake model ROC AUC on these matches": round(auc(S, Y), 3),
        "faint cards per 100 player-minutes in play, if everyone carried a card": round(
            100 * sum(r["cards_faint"] for r in rows) / cm, 1
        ),
        "full cards per 100 player-minutes in play, if everyone carried a card": round(
            100 * sum(r["cards_full"] for r in rows) / cm, 1
        ),
    }


def real_reference(cache, model):
    path = os.path.join(ARTIFACTS, "real_reference.json")
    if os.path.exists(path):
        return json.load(open(path))
    matches = dfl.load(cache)
    rows = []
    for m in matches:
        kp = lambda H, m=m: [i for i, p in enumerate(H["ids"]) if m["players"][p]["pos"] == "TW"]
        rows.append(measure(dict(halves=m["halves"], labels=m["labels"]), model, keepers_by_pos=kp))
    ref = summarise(rows, len(matches), sum(len(v) for m in matches for v in m["labels"].values()))
    json.dump(ref, open(path, "w"), indent=1)
    return ref


def generated(seeds, model):
    rows, n_chal = [], 0
    for sd in seeds:
        g = halves_of_generated(match_data(Sim(seed=sd, match_id=f"r_{sd}").run()))
        rows.append(measure(g, model))
        n_chal += g["n_challenges"]
    return summarise(rows, len(seeds), n_chal)


def main(argv):
    model = StakeModel()
    ref = real_reference(argv[0], model)
    gen = generated([int(x) for x in argv[1:]] or [31, 32], model)
    rows = []
    print(f"{'measure':72s} {'real':>22s} {'generated':>22s} {'within 25%':>11s}")
    for k in ref:
        a, b = ref[k], gen[k]
        if isinstance(a, list):
            ok = all(abs(y - x) <= 0.25 * abs(x) for x, y in zip(a, b))
        else:
            ok = abs(b - a) <= 0.25 * abs(a)
        rows.append(dict(measure=k, real=a, generated=b, within_25_percent=bool(ok)))
        print(f"{k:72s} {str(a):>22s} {str(b):>22s} {'yes' if ok else 'NO':>11s}")
    out = dict(
        seeds=[int(x) for x in argv[1:]] or [31, 32],
        provisional_model=bool(model.meta.get("provisional")),
        rows=rows,
        within=sum(r["within_25_percent"] for r in rows),
        total=len(rows),
    )
    json.dump(out, open(os.path.join(ARTIFACTS, "realism.json"), "w"), indent=1)
    print(f"\n{out['within']} of {out['total']} measures within 25% of real football")
    return ref, gen


if __name__ == "__main__":
    main(sys.argv[1:])
