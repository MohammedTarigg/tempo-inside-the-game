"""A narrower question for the ghost: among defenders near the ball, who is standing off it more than an average defender would?"""

import os

import numpy as np

from tempo.contracts import TYPE
from tempo.generator.export import match_data
from tempo.generator.sim import Sim
from tempo.instruments.ghost import HZ, dataset, features, fit, predict
from tempo.jsonio import write_json

from .demo_test import SHOTS, H
from .evaluate import segments_generated

RESULTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")


def standing_off(md, net, window_s=6.0, near=10.0):
    segs = segments_generated(md)
    ids = md["meta"]["ids"]
    out = []
    for e in md["events"]:
        if e["typeId"] not in SHOTS:
            continue
        seg = segs[e["periodId"] - 1]
        clock = md["clock"][md["period"] == e["periodId"]]
        t1 = int(np.searchsorted(clock, e["matchTime"]))
        best = {}
        for t in range(max(t1 - int(window_s * HZ), H + 6), t1, 5):
            if (
                seg["poss"][t] not in (0, 1)
                or not seg["live"][t - H - 5 : t + 1].all()
                or seg["team"][ids.index(e["playerId"])] != seg["poss"][t]
            ):
                continue
            f = features(seg, t, H)
            if f is None:
                continue
            X, Y, idx, p0, flip = f
            P = predict(net, X)
            ball = seg["ball"][t] * flip
            d_real, d_ghost = np.linalg.norm(Y + p0 - ball, axis=1), np.linalg.norm(P + p0 - ball, axis=1)
            for i, a, g in zip(idx, d_real, d_ghost, strict=True):
                if (
                    g < near and a - g > best.get(i, (-9,))[0]
                ):  # the ghost would be near the ball, and he is further away than it
                    best[i] = (float(a - g), (t1 - t) / HZ)
        if best:
            top = max(best, key=lambda i: best[i][0])
            out.append(
                dict(
                    minute=round(e["matchTime"] / 60, 1),
                    goal=e["typeId"] == TYPE["goal"],
                    top=ids[top],
                    off=round(best[top][0], 1),
                    s_before=best[top][1],
                )
            )
    return out


def main():
    train = [
        seg for k in range(100, 106) for seg in segments_generated(match_data(Sim(seed=k, match_id=f"s_{k}").run()))
    ]
    X, Y, _ = dataset(train, H)
    net = fit(X, Y)
    plain = [
        s for k in (31, 32, 33, 34, 35, 36) for s in standing_off(match_data(Sim(seed=k, match_id=f"p_{k}").run()), net)
    ]
    offs = np.array([s["off"] for s in plain])
    print(
        "plain shots",
        len(offs),
        "largest stand-off: median",
        round(float(np.median(offs)), 1),
        "p90",
        round(float(np.percentile(offs, 90)), 1),
        "p95",
        round(float(np.percentile(offs, 95)), 1),
        "max",
        round(float(offs.max()), 1),
    )
    print("plain goals", [(s["minute"], s["top"], s["off"]) for s in plain if s["goal"]])
    res = []
    for seed in (7, 8, 9, 10, 11):
        from tempo.generator.story import DemoStory

        story = DemoStory()
        md = match_data(Sim(seed=seed, match_id=f"d_{seed}", story=story).run())
        held = [p for p in story.planted if p.get("variant") == "hold"]
        rows = standing_off(md, net)
        for s in rows:
            s["beyond_plain_pct"] = round(float((offs < s["off"]).mean() * 100))
        goals = [s for s in rows if s["goal"]]
        near = [s for s in rows if held and abs(s["minute"] * 60 - held[0]["restart"]) < 30]
        print(
            "demo seed",
            seed,
            "planted hold at",
            round(held[0]["restart"] / 60, 1) if held else None,
            "| shot there:",
            near,
            "| other goals:",
            [(s["minute"], s["top"], s["off"], s["beyond_plain_pct"]) for s in goals if s not in near],
        )
        res.append(dict(seed=seed, planted=held, at_planted=near, goals=goals))
    write_json(
        os.path.join(RESULTS, "ghost_standoff.json"),
        dict(
            plain=dict(
                n=len(offs),
                median=float(np.median(offs)),
                p90=float(np.percentile(offs, 90)),
                p95=float(np.percentile(offs, 95)),
                max=float(offs.max()),
            ),
            demo=res,
        ),
        indent=1,
        default=float,
    )


if __name__ == "__main__":
    main()
