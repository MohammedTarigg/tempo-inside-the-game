"""Builds blind test cases for the investigator designs. Each case is one goal in a generated match and one question: is there
a checkable reason this goal went in? Four cases carry the planted cause (a booked player holds off), four carry none.
Each case is written twice: `raw` has the feed only; `inst` adds what the player layer would publish (ghost, earlier attempt, ledger).

    python -m experiments.agents.build_cases <work>/cases
"""

import csv
import os
import shutil
import sys
from pathlib import Path

import numpy as np

from experiments.ghost.evaluate import segments_generated
from tempo import season as seasonmod
from tempo.contracts import DEFENDING_CHALLENGE, TYPE, TYPE_NAME
from tempo.generator.export import match_data
from tempo.generator.sim import Sim
from tempo.generator.story import DemoStory
from tempo.instruments.ghost import HZ, dataset, features, fit, predict
from tempo.jsonio import write_json
from tempo.pipeline.run import Pipeline

H = 2 * HZ
SHOTS = (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"])


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
            a, g = np.linalg.norm(Y + p0 - ball, axis=1), np.linalg.norm(P + p0 - ball, axis=1)
            for i, x, y in zip(idx, a, g, strict=True):
                if y < near and x - y > best.get(i, -9):
                    best[i] = float(x - y)
        out.append(
            dict(
                t=e["matchTime"],
                shooter=e["playerId"],
                goal=e["typeId"] == TYPE["goal"],
                off={ids[i]: round(v, 1) for i, v in best.items()},
            )
        )
    return out


def write_case(root, name, md, goal_t, net, season, search, ordinary):
    meta = md["meta"]
    ids = meta["ids"]
    for kind in ("raw", "inst"):
        d = os.path.join(root, name, kind)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "events.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "time_s",
                    "minute",
                    "period",
                    "team",
                    "player",
                    "type",
                    "outcome",
                    "x",
                    "y",
                    "card",
                    "shot_kmh",
                    "pass_m",
                ]
            )
            for e in md["events"]:
                q = {x["qualifierId"]: x["value"] for x in e["qualifier"]}
                card = "yellow" if 31 in q else "second_yellow" if 32 in q else "red" if 33 in q else ""
                w.writerow(
                    [
                        e["matchTime"],
                        int(e["matchTime"] // 60) + 1,
                        e["periodId"],
                        e["contestantId"],
                        e["playerId"],
                        TYPE_NAME[e["typeId"]],
                        e["outcome"],
                        e["x"],
                        e["y"],
                        card,
                        q.get(322, ""),
                        q.get(212, ""),
                    ]
                )
        np.savez_compressed(
            os.path.join(d, "tracking.npz"),
            pos=md["pos"][::5].astype(np.float32),
            ball=md["ball"][::5].astype(np.float32),
            clock=md["clock"][::5],
            period=md["period"][::5],
            live=md["live"][::5],
            poss=md["poss"][::5],
            home_dir=md["home_dir"][::5],
        )
        write_json(
            os.path.join(d, "meta.json"),
            dict(
                player_ids=ids,
                names=meta["names"],
                numbers=meta["numbers"],
                team_index=md["team"].tolist(),
                keepers=meta["keepers"],
                home=meta["home"]["id"],
                away=meta["away"]["id"],
                goal_time_s=goal_t,
                goal_minute=int(goal_t // 60) + 1,
            ),
            indent=1,
        )
        readme = (
            Path(__file__)
            .with_name("brief.md")
            .read_text()
            .replace("{MIN}", str(int(goal_t // 60) + 1))
            .replace("{T}", f"{goal_t:.1f}")
        )
        if kind == "inst":
            readme += (
                Path(__file__)
                .with_name("brief_instruments.md")
                .read_text()
                .replace("{MED}", str(ordinary[0]))
                .replace("{P90}", str(ordinary[1]))
            )
        Path(d, "README.md").write_text(readme)
    d = os.path.join(root, name, "inst", "instruments")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "ghost_standoff.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["shot_time_s", "minute", "shooter", "goal", "defender", "further_from_ball_than_ghost_m"])
        for s in standing_off(md, net):
            for p, v in sorted(s["off"].items(), key=lambda x: -x[1]):
                w.writerow([s["t"], int(s["t"] // 60) + 1, s["shooter"], int(s["goal"]), p, v])
    # the pipeline's own search for the closest earlier attempt, and the ledger
    tmp = os.path.join(root, "_run_" + name)
    shutil.rmtree(tmp, ignore_errors=True)
    p = Pipeline(md, tmp, season=season, search=search)
    p.run()
    ca = [f for f in p.ledger.facts(meta["match_id"], 1e9, kind="closest_attempt") if abs(f["match_time"] - goal_t) < 2]
    write_json(
        os.path.join(d, "earlier_attempt.json"),
        dict(
            found=bool(ca),
            **(
                {
                    k: ca[0][k]
                    for k in ("earlier_time", "differing_player", "differing_by_m", "value", "unit", "n_differing")
                }
                if ca
                else {}
            ),
            note="Compared over the first 1.6 seconds of each attack. differing_player is the first defender standing 3 m or more differently while within 12 m of the ball."
            if ca
            else "No earlier attack in this match started closely enough like this one.",
        ),
        indent=1,
    )
    with open(os.path.join(d, "ledger.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "player",
                "team",
                "yellow_card_minute",
                "defending_challenges_before_card_per_10min",
                "after_card_per_10min",
                "defending_challenges_whole_match",
            ]
        )
        end = float(md["clock"][-1])
        for pid in ids:
            ch = [
                e["matchTime"]
                for e in md["events"]
                if e["playerId"] == pid
                and e["typeId"] in DEFENDING_CHALLENGE
                and not (e["typeId"] == TYPE["foul"] and e["outcome"] == 1)
            ]
            card = next(
                (e["matchTime"] for e in md["events"] if e["playerId"] == pid and e["typeId"] == TYPE["card"]), None
            )
            if card:
                b, a = (
                    sum(t < card for t in ch) / (card / 600),
                    sum(t >= card for t in ch) / max((end - card) / 600, 0.1),
                )
                w.writerow([pid, meta["team_of"][pid], int(card // 60) + 1, round(b, 2), round(a, 2), len(ch)])
            else:
                w.writerow([pid, meta["team_of"][pid], "", "", "", len(ch)])
    shutil.rmtree(tmp, ignore_errors=True)


def goals(md):
    return [e["matchTime"] for e in md["events"] if e["typeId"] == TYPE["goal"]]


if __name__ == "__main__":
    root = sys.argv[1]
    os.makedirs(root, exist_ok=True)
    season, search = seasonmod.load()
    train = [
        seg for k in range(100, 106) for seg in segments_generated(match_data(Sim(seed=k, match_id=f"s_{k}").run()))
    ]
    X, Y, _ = dataset(train, H)
    net = fit(X, Y)
    plain = {k: match_data(Sim(seed=k, match_id=f"p_{k}").run()) for k in (31, 32, 33, 34, 35, 36)}
    offs = [max(s["off"].values()) for md in plain.values() for s in standing_off(md, net) if s["off"]]
    ordinary = (round(float(np.median(offs)), 1), round(float(np.percentile(offs, 90)), 1))
    truth = {}
    n = 0
    for seed in (7, 8, 9, 10):
        story = DemoStory()
        md = match_data(Sim(seed=seed, match_id=f"d_{seed}", story=story).run())
        hold = next(p for p in story.planted if p.get("variant") == "hold")["restart"]
        book = next(p for p in story.planted if p["kind"] == "booking")
        for g in goals(md):
            planted = 0 < g - hold < 30
            if planted or (seed in (7, 8) and not planted and len([v for v in truth.values() if not v["planted"]]) < 2):
                n += 1
                name = f"case{n:02d}"
                write_case(root, name, md, g, net, season, search, ordinary)
                truth[name] = dict(
                    seed=seed,
                    story=True,
                    goal_t=g,
                    planted=planted,
                    player="p_har_6" if planted else None,
                    booked_at=book["matchTime"],
                )
                print(name, truth[name], flush=True)
    for k, md in plain.items():
        for g in goals(md)[:1]:
            if len([v for v in truth.values() if not v["planted"]]) < 4:
                n += 1
                name = f"case{n:02d}"
                write_case(root, name, md, g, net, season, search, ordinary)
                truth[name] = dict(seed=k, story=False, goal_t=g, planted=False, player=None)
                print(name, truth[name], flush=True)
    write_json(os.path.join(root, "_truth.json"), truth, indent=1)
    print("ordinary stand-off: median", ordinary[0], "p90", ordinary[1])
