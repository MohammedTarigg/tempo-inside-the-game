"""Ghost tests. The model is in tempo/ghost.py; this file measures it. For one defender: given where he stood H seconds ago and how the play has moved since, where would an average
defender be now? The gap between that and where he really is says how far out of the ordinary he is standing.
After Le, Carr, Yue and Lucey (2017) and NFL Ghosts (2024), in a much smaller form: one network, one step of H seconds.

    python3 -m spike.ghost.ghost real data/dfl-cache      leave-one-match-out error on the seven real matches
    python3 -m spike.ghost.ghost demo                     fit on generated matches, then look at the demo match's goals
"""
import json
import sys
import numpy as np
from tempo.ghost import HZ, PX, PY, dataset, features, fit, predict      # the model itself lives in the product code


def segments_real(cache):
    from tempo.stake.dfl import load
    out = []
    for m in load(cache):
        segs = []
        for H in m["halves"].values():
            keeper = np.array([m["players"][p]["pos"] == "TW" for p in H["ids"]])
            segs.append(dict(xy=np.transpose(H["xy"], (1, 0, 2)), ball=H["ball"][:, :2], live=H["live"], poss=H["poss"], team=H["team"], own=H["own"], keeper=keeper, ids=H["ids"]))
        out.append(dict(title=m["title"], segs=segs, booked=m["booked"], halves=m["halves"]))
    return out


def segments_generated(md):
    segs = []
    for per in sorted(set(md["period"].tolist())):
        k = md["period"] == per
        d = float(md["home_dir"][k][0])
        keeper = np.zeros(len(md["team"]), bool); keeper[md["meta"]["keepers"]] = True
        segs.append(dict(xy=md["pos"][k], ball=md["ball"][k][:, :2], live=md["live"][k].astype(bool), poss=md["poss"][k], team=md["team"], own=np.array([-d * PX, d * PX]),
                         keeper=keeper, ids=md["meta"]["ids"], first=int(np.flatnonzero(k)[0])))
    return segs


def err(P, Y):
    e = np.linalg.norm(P - Y, axis=1)
    return dict(median=round(float(np.median(e)), 2), mean=round(float(e.mean()), 2), p90=round(float(np.percentile(e, 90)), 2))


def real(cache, h_s=2.0):
    h = int(h_s * HZ)
    ms = segments_real(cache)
    data = [dataset(m["segs"], h) for m in ms]
    out = []
    for k, m in enumerate(ms):
        Xtr = np.concatenate([d[0] for j, d in enumerate(data) if j != k]); Ytr = np.concatenate([d[1] for j, d in enumerate(data) if j != k])
        net = fit(Xtr, Ytr)
        X, Y, V = data[k]
        r = dict(match=m["title"], samples=len(X), stay=err(np.zeros_like(Y), Y), keep_pace=err(V, Y), ghost=err(predict(net, X), Y))
        print(r, flush=True); out.append(r)
    tot = {k: round(float(np.mean([r[k]["median"] for r in out])), 2) for k in ("stay", "keep_pace", "ghost")}
    print("mean of medians, metres:", tot)
    return dict(horizon_s=h_s, matches=out, mean_of_medians=tot)


if __name__ == "__main__":
    if sys.argv[1] == "real":
        res = [real(sys.argv[2], h) for h in (2.0, 3.0)]
        json.dump(res, open("artifacts/ghost_real.json", "w"), indent=1)
