"""Does the ghost find the reason for the demo match's goal without the twin? Fit on generated season matches (and separately on
the real ones), then score every shot in the demo match and in plain matches: who stood furthest from his ghost in the build-up."""
import json
import sys
import numpy as np
from tempo.contracts import TYPE
from tempo.generator.export import match_data
from tempo.generator.sim import Sim
from tempo.run_match import generate
from .ghost import HZ, dataset, features, fit, predict, segments_generated, segments_real

H = int(2.0 * HZ)
SHOTS = (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"])


def shot_scores(md, net, window_s=6.0):
    """For each shot: every defender's largest gap to his ghost in the seconds before it."""
    segs = segments_generated(md); ids = md["meta"]["ids"]; out = []
    for e in md["events"]:
        if e["typeId"] not in SHOTS:
            continue
        seg = segs[e["periodId"] - 1]
        clock = md["clock"][md["period"] == e["periodId"]]
        t1 = int(np.searchsorted(clock, e["matchTime"])); best = {}
        for t in range(max(t1 - int(window_s * HZ), H + 6), t1, 5):
            if seg["poss"][t] not in (0, 1) or not seg["live"][t - H - 5:t + 1].all():
                continue
            f = features(seg, t, H)
            if f is None:
                continue
            X, Y, idx, p0, flip = f
            P = predict(net, X); gap = np.linalg.norm(P - Y, axis=1)
            ball = seg["ball"][t] * flip
            off = np.linalg.norm(Y + p0 - ball, axis=1) - np.linalg.norm(P + p0 - ball, axis=1)      # positive: further from the ball than his ghost
            for i, g, o in zip(idx, gap, off):
                if seg["team"][i] != seg["team"][ids.index(e["playerId"])] and g > best.get(i, (0,))[0]:
                    best[i] = (float(g), float(o), (t1 - t) / HZ)
        if best:
            top = max(best, key=lambda i: best[i][0])
            out.append(dict(minute=round(e["matchTime"] / 60, 1), goal=e["typeId"] == TYPE["goal"], shooter=e["playerId"], top=ids[top], gap=round(best[top][0], 1), further_from_ball=round(best[top][1], 1),
                            s_before=best[top][2], all={ids[i]: round(v[0], 1) for i, v in best.items()}))
    return out


def run(kind):
    if kind == "generated":
        train = [seg for k in range(100, 106) for seg in segments_generated(match_data(Sim(seed=k, match_id=f"s_{k}").run()))]
    else:
        train = [seg for m in segments_real("data/dfl-cache") for seg in m["segs"]]
    X, Y, _ = dataset(train, H)
    net = fit(X, Y)
    res = dict(trained_on=kind, samples=len(X))
    # what is ordinary: the largest gap at shots in plain matches the network never saw
    plain = [s for k in (31, 32, 33, 34) for s in shot_scores(match_data(Sim(seed=k, match_id=f"p_{k}").run()), net)]
    gaps = np.array([s["gap"] for s in plain])
    res["plain_shots"] = len(gaps); res["plain_top_gap"] = dict(median=round(float(np.median(gaps)), 1), p90=round(float(np.percentile(gaps, 90)), 1), p95=round(float(np.percentile(gaps, 95)), 1), max=round(float(gaps.max()), 1))
    demo = shot_scores(generate(), net)
    for s in demo:
        s["beyond_plain_pct"] = round(float((gaps < s["gap"]).mean() * 100))
    res["demo"] = [{k: v for k, v in s.items() if k != "all"} for s in demo]
    res["skoles"] = [dict(minute=s["minute"], goal=s["goal"], skoles_gap=s["all"].get("p_har_6"), top=s["top"], top_gap=s["gap"]) for s in demo if "p_har_6" in s["all"]]
    return res


if __name__ == "__main__":
    out = [run(k) for k in sys.argv[1:]]
    json.dump(out, open("artifacts/ghost_demo.json", "w"), indent=1)
    for r in out:
        print(r["trained_on"], r["samples"], "plain shots", r["plain_shots"], r["plain_top_gap"])
        for s in r["demo"]:
            print("  ", s)
        print("   Skoles:", r["skoles"])
