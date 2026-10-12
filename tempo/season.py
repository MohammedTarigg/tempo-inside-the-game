"""The season behind a match: what is usual, each team's habits, and the archive of earlier attacks that twin search looks through.

Built by running the generator. The default is a small sample so a laptop finishes in a couple of minutes; pass a larger n for more.
Every habit carries the number of matches it rests on."""

import json
import os
import numpy as np

from . import twin
from .contracts import TYPE
from .generator.export import match_data
from .generator.sim import AWAY, HOME, HZ, Sim
from .stake.model import ARTIFACTS

PATH = os.path.join(ARTIFACTS, "season.json")


def build(n=6, seed0=100, verbose=True):
    shot_speed, pass_dist, per_min, archive = [], [], [], []
    wide = {0: [0, 0], 1: [0, 0]}
    late_against = {0: [0, 0], 1: [0, 0]}
    challenges = {}
    for k in range(n):
        md = match_data(Sim(seed=seed0 + k, match_id=f"s_{k}").run())
        ids, team = md["meta"]["ids"], md["team"]
        view = dict(pos=md["pos"], ball=md["ball"], live=md["live"], poss=md["poss"], team=team)
        clock, period = md["clock"], md["period"]
        for e in md["events"]:
            q = {x["qualifierId"]: x["value"] for x in e["qualifier"]}
            p = ids.index(e["playerId"])
            if e["typeId"] in (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"]):
                shot_speed.append(q[322])
                t = int(team[p])
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
        live = md["live"]
        step = np.nan_to_num(np.linalg.norm(np.diff(md["pos"], axis=0), axis=2))
        mins = live.sum() / HZ / 60
        per_min += [float(step[live[1:], j].sum() / mins) for j in range(22) if j % 11]
        if verbose:
            print(f"  season match {k + 1}/{n}", flush=True)
    skoles = "p_har_6"
    wide_share = round(100 * wide[0][0] / max(wide[0][1], 1))
    zone = "wide" if wide_share >= 50 else "central"
    channel = dict(
        subject=HOME["id"],
        kind="shot_channel",
        value=max(wide_share, 100 - wide_share),
        unit=f"in 100 shots from {'the wide channels' if zone == 'wide' else 'the middle'}",
        sample=n,
        mark="channels",
        zone=zone,
        text=f"{HOME['name']} shoot from wide" if zone == "wide" else f"{HOME['name']} shoot through the middle",
    )
    habits = [
        channel,  # where the home side shoots from: whichever of the middle and the wide channels has most of its shots
        dict(
            subject=skoles,
            kind="challenges_per_match",
            value=round(challenges.get(skoles, 0) / n, 1),
            unit="challenges a match",
            sample=n,
            mark="zone",
            zone="front_of_back_four",
            text="If Skoles is booked, this space opens",
        ),
        dict(
            subject=AWAY["id"],
            kind="late_shots_against",
            value=round(100 * late_against[1][0] / max(late_against[1][1], 1)),
            unit="in 100 shots against come after minute 70",
            sample=n,
            mark="window",
            window=[70, 90],
            text=f"{AWAY['name']} give up chances late",
        ),
    ]
    out = dict(
        matches=n,
        shot_speed=shot_speed,
        pass_distance=pass_dist,
        distance_per_minute=per_min,
        habits=habits,
        archive=archive,
    )
    os.makedirs(ARTIFACTS, exist_ok=True)
    tmp = PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, default=float)
    os.replace(tmp, PATH)  # written whole or not at all
    return out


def load(n=6):
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
