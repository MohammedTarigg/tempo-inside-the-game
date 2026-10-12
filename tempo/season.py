"""The season behind a match: what is usual, each team's habits, and the archive of earlier attacks that twin search
looks through.

Built by running the generator: 40 matches, about eleven minutes on a laptop. Pass a larger n for more.

Habits are mined, not written in. For every club and every often-booked player the miner forms a candidate call, runs
the call's own full-time rule (habits.py) over each match of the season, and keeps a call only if it was put to the test
often enough and held in at least 7 of 10 of those matches. The best of each kind is said before kick-off; a kind with no
call that passes is not said at all. Each habit carries how often it held."""

import json
import os

import numpy as np

from . import habits as rules
from . import twin
from .contracts import Q_YELLOW, TYPE
from .generator.export import match_data
from .generator.sim import AWAY, HOME, HZ, Sim, squads
from .paths import ARTIFACTS

PATH = os.path.join(ARTIFACTS, "season.json")


HOLD_RATE, MIN_TESTED, MIN_TESTED_BOOKED = 0.7, 8, 4
WINDOW = [70, 90]


def build(n=40, seed0=100, verbose=True):
    shot_speed, pass_dist, per_min, archive = [], [], [], []
    wide = {0: [0, 0], 1: [0, 0]}
    late_against = {0: [0, 0], 1: [0, 0]}
    challenges = {}
    season = []  # one record a match, for the miner: each side's shots, each player's challenges, cards, the final whistle
    for k in range(n):
        md = match_data(Sim(seed=seed0 + k, match_id=f"s_{k}").run())
        ids, team = md["meta"]["ids"], md["team"]
        view = dict(pos=md["pos"], ball=md["ball"], live=md["live"], poss=md["poss"], team=team)
        clock, period = md["clock"], md["period"]
        rec = dict(shots={0: [], 1: []}, went={}, card={}, end=float(clock[-1]))
        season.append(rec)
        for e in md["events"]:
            q = {x["qualifierId"]: x["value"] for x in e["qualifier"]}
            p = ids.index(e["playerId"])
            if e["typeId"] in (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"]):
                shot_speed.append(q[322])
                t = int(team[p])
                rec["shots"][t].append((e["y"], e["matchTime"], e["typeId"] == TYPE["goal"]))
                wide[t][0] += abs(e["y"] - 50) > 18
                wide[t][1] += 1
                late_against[1 - t][0] += e["matchTime"] >= 70 * 60
                late_against[1 - t][1] += 1
                i = int(
                    np.searchsorted(
                        np.where(period == e["periodId"], clock, -1e9 if e["periodId"] == 1 else clock), e["matchTime"]
                    )
                )
                i = min(max(i, 0), len(clock) - 1)
                d = md["home_dir"][i] if t == 0 else -md["home_dir"][i]
                vec = twin.attack_vector(
                    view, twin.attack_start(md["live"], md["poss"], i), i, t, d, md["meta"]["keepers"]
                )
                if vec is not None:
                    archive.append(
                        dict(
                            match_id=f"s_{k}",
                            t=e["matchTime"],
                            team=t,
                            outcome="goal" if e["typeId"] == TYPE["goal"] else "no_goal",
                            vec={kk: (v.tolist() if hasattr(v, "tolist") else v) for kk, v in vec.items()},
                        )
                    )
            elif e["typeId"] == TYPE["pass"] and e["outcome"] == 1:
                pass_dist.append(q[212])
            elif e["typeId"] in (TYPE["tackle"], TYPE["challenge"]) or (
                e["typeId"] == TYPE["foul"] and e["outcome"] == 0
            ):
                challenges[e["playerId"]] = challenges.get(e["playerId"], 0) + 1
                rec["went"].setdefault(e["playerId"], []).append(e["matchTime"])
            elif e["typeId"] == TYPE["card"] and Q_YELLOW in q:
                rec["card"].setdefault(e["playerId"], e["matchTime"])
        live = md["live"]
        step = np.nan_to_num(np.linalg.norm(np.diff(md["pos"], axis=0), axis=2))
        mins = live.sum() / HZ / 60
        per_min += [float(step[live[1:], j].sum() / mins) for j in range(22) if j % 11]
        if verbose:
            print(f"  season match {k + 1}/{n}", flush=True)
    habits, considered = mine(season, wide, late_against, challenges, n)
    out = dict(
        matches=n,
        shot_speed=shot_speed,
        pass_distance=pass_dist,
        distance_per_minute=per_min,
        habits=habits,
        considered=considered,
        archive=archive,
    )
    os.makedirs(ARTIFACTS, exist_ok=True)
    tmp = PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, default=float)
    os.replace(tmp, PATH)  # written whole or not at all
    return out


def mine(season, wide, late_against, challenges, n):
    """The calls worth making: each kind's best candidate, if it held often enough when the season put it to the test."""
    clubs, names = (HOME, AWAY), {p["playerId"]: p["name"] for side in squads() for p in side}

    def backtest(results):
        tested = [r for r in results if r is not None]
        return sum(tested), len(tested)

    def passes(held, tested, least):
        return tested >= least and held / tested >= HOLD_RATE

    found, considered = (
        [],
        [],
    )  # considered: every candidate with how it fared, kept or not, so the choice can be audited
    channel, late, booked = [], [], []
    for t, club in enumerate(clubs):
        share = round(100 * wide[t][0] / max(wide[t][1], 1))
        zone = "wide" if share >= 50 else "central"
        held, tested = backtest([rules.shot_channel([y for y, _, _ in m["shots"][t]], zone)[0] for m in season])
        considered.append(dict(kind="shot_channel", subject=club["id"], held=held, tested=tested))
        if passes(held, tested, MIN_TESTED):
            channel.append(
                dict(
                    subject=club["id"],
                    kind="shot_channel",
                    value=max(share, 100 - share),
                    unit=f"in 100 shots from {'the wide channels' if zone == 'wide' else 'the middle'}",
                    mark="channels",
                    zone=zone,
                    text=f"{club['name']} shoot from wide"
                    if zone == "wide"
                    else f"{club['name']} shoot through the middle",
                    backtest=[held, tested],
                )
            )
        faced = [[(tt, g) for _, tt, g in m["shots"][1 - t]] for m in season]
        held, tested = backtest([rules.late_shots_against(f, WINDOW)[0] for f in faced])
        considered.append(dict(kind="late_shots_against", subject=club["id"], held=held, tested=tested))
        if passes(held, tested, MIN_TESTED):
            late.append(
                dict(
                    subject=club["id"],
                    kind="late_shots_against",
                    value=round(100 * late_against[t][0] / max(late_against[t][1], 1)),
                    unit=f"in 100 shots against come after minute {WINDOW[0]}",
                    mark="window",
                    window=WINDOW,
                    text=f"{club['name']} give up chances late",
                    backtest=[held, tested],
                )
            )
    for pid in sorted(challenges):
        results = [rules.booked_challenges(m["went"].get(pid, []), m["card"].get(pid), m["end"])[0] for m in season]
        held, tested = backtest(results)
        if tested:
            considered.append(dict(kind="challenges_per_match", subject=pid, held=held, tested=tested))
        if passes(held, tested, MIN_TESTED_BOOKED):
            booked.append(
                dict(
                    subject=pid,
                    kind="challenges_per_match",
                    value=round(challenges[pid] / n, 1),
                    unit="challenges a match",
                    mark="zone",
                    zone="front_of_back_four",
                    text=f"If {names[pid]} is booked, this space opens",
                    backtest=[held, tested],
                )
            )
    for kind in (channel, booked, late):  # the best of each kind: how often it held, then how often it was tested
        if kind:
            best = max(kind, key=lambda h: (h["backtest"][0] / h["backtest"][1], h["backtest"][1]))
            found.append(dict(best, sample=n))
    return found, considered


def load(n=40):
    if not os.path.exists(PATH):
        build(n)
    s = json.load(open(PATH))
    search = twin.TwinSearch()
    for a in s["archive"]:
        vec = {k: (np.array(v) if k in ("ball", "A", "D") else v) for k, v in a["vec"].items()}
        search.add(vec, a["team"], a["match_id"], a["t"], a["outcome"])
    return s, search


if __name__ == "__main__":
    build()
