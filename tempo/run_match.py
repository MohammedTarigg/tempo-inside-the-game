"""Runs one match through the whole pipeline on this machine.

    python3 -m tempo.run_match                 the demo match, start to finish
    python3 -m tempo.run_match --plain 21      an unscripted match with seed 21

Feeds go in at the front in the providers' shapes; cues come out at the back, stamped with match time. Everything lands
in runs/<match_id>/: cues.jsonl, facts.jsonl, audit.jsonl, replay.npz for a front end, and summary.json."""

import json
import os
import sys
import time

import numpy as np

from . import habits as rules
from . import season as seasonmod
from . import twin
from .agents import Writer, verify
from .bus import LocalBus
from .contracts import TYPE, fact
from .cues import CueService
from .generator.export import match_data
from .generator.sim import Sim
from .generator.story import DEMO_SEED, DemoStory
from .ledger import Ledger
from .listener import Listener
from .outputs import RunOutputs
from .paths import RUNS
from .reflex import Reflex, win_chance
from .stake.model import StakeModel


class Pipeline(RunOutputs):
    def __init__(self, md, out_dir, model=None, season=None, search=None, rules=None, db_path=None):
        self.md, self.meta, self.out = md, md["meta"], out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.ledger = Ledger(db_path or os.path.join(out_dir, "tempo.sqlite"))
        self.bus = LocalBus(out_dir)
        self.cues = CueService(self.meta["match_id"], self.ledger, self.bus, rules)
        self.season = season or {}
        self.reflex = Reflex(
            self.meta, md["team"], self.ledger, self.cues, model or StakeModel(), baselines=self.season, search=search
        )
        self.writer = Writer(self.ledger, self.cues, self.meta)
        self.listener = Listener(self.meta)
        self.view = dict(pos=md["pos"], ball=md["ball"], live=md["live"], poss=md["poss"], team=md["team"])
        self.ev_i = self.cm_i = 0
        self.frame_ms, self.swings, self.pressures, self.halftime_done = [], [], [], False

    # ----- recovery -----
    def checkpoint(self, i):
        self.ledger.save_checkpoint(
            "pipeline",
            dict(
                frame=i,
                ev_i=self.ev_i,
                cm_i=self.cm_i,
                reflex=self.reflex.snapshot(),
                cues=self.cues.state(),
                halftime_done=self.halftime_done,
                swings=self.swings,
                pressures=self.pressures,
                shots=[
                    (a["t"], a["meta"].get("frame"))
                    for a in self.reflex.search.archive
                    if a["match_id"] == self.meta["match_id"]
                ],
            ),
        )
        self.ledger.commit()

    def resume(self):
        cp = self.ledger.load_checkpoint("pipeline")
        if not cp:
            return 0
        self.ev_i, self.cm_i, self.halftime_done, self.swings, self.pressures = (
            cp["ev_i"],
            cp["cm_i"],
            cp["halftime_done"],
            cp["swings"],
            cp["pressures"],
        )
        self.cues.restore(cp["cues"])
        self.reflex.restore(cp["reflex"], self.md, cp["frame"])
        for e in self.md["events"][: self.ev_i]:  # rebuild this match's part of the attack archive
            if e["typeId"] in (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"]):
                fr = next((f for t, f in cp["shots"] if abs(t - e["matchTime"]) < 1e-6), None)
                if fr is not None:
                    p = self.meta["ids"].index(e["playerId"])
                    team = int(self.md["team"][p])
                    d = self.md["home_dir"][fr] if team == 0 else -self.md["home_dir"][fr]
                    vec = twin.attack_vector(
                        self.view,
                        twin.attack_start(self.view["live"], self.view["poss"], fr),
                        fr,
                        team,
                        d,
                        self.meta["keepers"],
                    )
                    if vec is not None:
                        self.reflex.search.add(
                            vec,
                            team,
                            self.meta["match_id"],
                            e["matchTime"],
                            "goal" if e["typeId"] == TYPE["goal"] else "no_goal",
                            meta=dict(player=e["playerId"], frame=fr),
                        )
        return cp["frame"] + 1

    # ----- the run -----
    def run(self, start=0, stop_at=None, checkpoint_every_s=30):
        md, R = self.md, self.reflex
        n = len(md["clock"])
        if start == 0:
            self.kickoff()
        last_cp = md["clock"][start] if start < n else 0
        for i in range(start, n):
            if stop_at is not None and i >= stop_at:
                return False  # a simulated crash: nothing after the last checkpoint is saved
            t, period = float(md["clock"][i]), int(md["period"][i])
            self.cues.frame = i
            if period == 2 and not self.halftime_done:
                self.halftime(45 * 60.0)
                self.halftime_done = True
            t0 = time.perf_counter()
            while (
                self.ev_i < len(md["events"])
                and md["events"][self.ev_i]["periodId"] <= period
                and md["events"][self.ev_i]["matchTime"] <= t
            ):
                e = md["events"][self.ev_i]
                self.ev_i += 1
                before = win_chance(R.score, 90 - t / 60)
                for m in R.on_event(e, self.view, i, md["home_dir"][i]):
                    if m["kind"] == "goal":
                        after = win_chance(R.score, 90 - t / 60)
                        f = self.ledger.put_fact(
                            fact(self.meta["match_id"], t, "win_chance", "match", after, "home, draw, away")
                        )
                        self.swings.append(
                            dict(
                                t=t,
                                swing=round(abs(after[0] - before[0]) + abs(after[2] - before[2]), 3),
                                moment=m,
                                fact_id=f["fact_id"],
                            )
                        )
                    self.writer.write_moment(m)
            while self.cm_i < len(md["commentary"]) and md["commentary"][self.cm_i]["matchTime"] <= t:
                self.on_commentary(md["commentary"][self.cm_i])
                self.cm_i += 1
            for m in R.on_frame(
                i, t, period, md["pos"][i], md["ball"][i], bool(md["live"][i]), int(md["poss"][i]), md["home_dir"][i]
            ):
                if m["kind"] == "pressure":
                    self.pressures.append(m)
                self.writer.write_moment(m)
            self.frame_ms.append((time.perf_counter() - t0) * 1000)
            if t - last_cp >= checkpoint_every_s:
                self.checkpoint(i)
                last_cp = t
        self.fulltime(float(md["clock"][-1]))
        self.checkpoint(n - 1)
        return True

    def kickoff(self):
        habits = []
        for h in self.season.get("habits", []):
            f = self.ledger.put_fact(
                fact(
                    self.meta["match_id"],
                    0.0,
                    "habit",
                    h["subject"],
                    h["value"],
                    h["unit"],
                    sample_matches=h["sample"],
                    habit=h["kind"],
                )
            )
            habits.append(dict(h, fact_id=f["fact_id"]))
        self.writer.kickoff(habits)

    def on_commentary(self, line):
        t = line["matchTime"]
        self.bus.publish("commentary", line)
        for pid in self.listener.mentions(line["text"]):
            facts = [f for f in self.reflex.running_facts(t) if f["subject"] == pid]
            if not facts:
                continue
            f = facts[0]
            ctx = dict(
                names=self.meta["names"],
                names_ar=self.meta["names_ar"],
                player=pid,
                per_minute=f["value"],
                top_speed=f["top_speed"],
            )
            text = self.writer.fallback.narrate("form", ctx)
            if (
                self.listener.already_said(line["text"], [f["value"]])
                or not verify(text, [f], self.meta["names"], expected=self.writer.fallback.numbers("form", ctx))[0]
            ):
                self.ledger.audit(
                    t,
                    "held_back",
                    dict(form="form_card", reason="the commentator has just said it, or the line failed the check"),
                )
                continue
            self.cues.propose(
                t,
                "form_card",
                "tv",
                dict(
                    player=pid,
                    per_minute=f["value"],
                    usual_percentile=f["percentile"],
                    top_speed=f["top_speed"],
                    heard=line["text"],
                ),
                [f["fact_id"]],
                valid_for=4.5,
                priority=5,
            )

    def halftime(self, t):
        names = self.meta["names"]
        items = []
        booked = [f for f in self.ledger.facts(self.meta["match_id"], t, kind="card") if f["value"] == "yellow"]
        if booked:
            items.append(
                dict(
                    title="On a yellow",
                    text=", ".join(names[f["subject"]] for f in booked[:3]) + ": one foul from a red card",
                    fact_ids=[f["fact_id"] for f in booked[:3]],
                    mark="card",
                )
            )
        for h in self.ledger.facts(self.meta["match_id"], t, kind="habit"):
            if h.get("habit") == "late_shots_against":
                items.append(
                    dict(
                        title="Still to come", text=f"{h['value']} {h['unit']}", fact_ids=[h["fact_id"]], mark="window"
                    )
                )
        duels = self.ledger.facts(self.meta["match_id"], t, kind="duel_count")
        if duels:
            d = duels[-1]
            a, b = d["subject"].split("|")
            items.append(
                dict(
                    title="A running duel",
                    text=f"{names[a]} against {names[b]}: {d['value'][0]} to {d['value'][1]}",
                    fact_ids=[d["fact_id"]],
                    mark="duel",
                )
            )
        self.reflex.running_facts(t)
        if items:
            self.writer.interval_card(t, "halftime_card", items)

    def fulltime(self, t):
        names = self.meta["names"]
        items = []
        for s in sorted(self.swings, key=lambda s: -s["swing"])[:3]:
            m = s["moment"]
            minute = int(m["t"] // 60) + 1
            ca = m.get("closest_attempt")
            text = f"{names[m['player']]} scores in minute {minute}" + (
                f". Closest earlier attempt: minute {int(ca['earlier_time'] // 60) + 1}" if ca else ""
            )
            items.append(
                dict(
                    title=f"Minute {minute}",
                    text=text,
                    fact_ids=m["fact_ids"] + [s["fact_id"]],
                    mark="closest_attempt" if ca else "goal",
                )
            )
        teams = (self.meta["home"]["name"], self.meta["away"]["name"])
        # goals first, then the clearest changes of pressure
        for m in sorted(self.pressures, key=lambda m: m["before"] - m["now"])[: 3 - len(items)]:
            minute = int(m["t"] // 60) + 1
            items.append(
                dict(
                    title=f"Minute {minute}",
                    text=(
                        f"{teams[m['team']]} took the play: "
                        f"{m['now']} in 100 in {teams[1 - m['team']]}'s half, up from {m['before']}"
                    ),
                    fact_ids=m["fact_ids"],
                    mark="pressure",
                )
            )
        if items:
            self.writer.interval_card(t, "fulltime_card", items, calls=self.calls(t))

    def calls(self, t):
        """What became of the things said before kick-off. Each kind of call has one rule, fixed in habits.py before any
        match is seen, and every outcome is written with its numbers and with the points a picture of it needs, so a
        call that failed, or that the match never tested, is reported as plainly as one that held."""
        ids, team, names, mid = self.meta["ids"], self.md["team"], self.meta["names"], self.meta["match_id"]
        clock, period, hd = self.md["clock"], self.md["period"], self.md["home_dir"]
        side = lambda e: int(team[ids.index(e["playerId"])])

        def frame_of(e):
            idx = np.nonzero(period == e["periodId"])[0]
            return int(idx[min(int(np.searchsorted(clock[idx], e["matchTime"])), len(idx) - 1)])

        ev = [e for e in self.md["events"] if e["matchTime"] <= t]
        shots = [e for e in ev if e["typeId"] in (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"])]
        facts = {(f["subject"], f.get("habit")): f for f in self.ledger.facts(mid, t, kind="habit")}
        out = []
        for h in self.season.get("habits", [])[:3]:
            kind, subj, came, line, detail, value, extra = h["kind"], h["subject"], None, "", "", None, {}
            tix = 0 if subj == self.meta["home"]["id"] else 1
            if kind == "shot_channel":
                mine = [e for e in shots if side(e) == tix]
                came, k, n, inside = rules.shot_channel([e["y"] for e in mine], h["zone"])
                value = [k, n]
                line, detail = f"{k} of {n} shots", f"Their usual is {h['value']} in 100"
                if came is None:
                    detail = "Too few shots to judge"
                pts = []
                # every shot, turned to attack the same end, so one picture holds both halves
                for e, ins in zip(mine, inside):
                    fr = frame_of(e)
                    d = float(hd[fr]) * (1 if tix == 0 else -1)
                    xy = self.md["pos"][fr][ids.index(e["playerId"])]
                    pts.append(
                        dict(frame=fr, x=round(float(xy[0]) * d, 1), y=round(float(xy[1]) * d, 1), inside=bool(ins))
                    )
                extra = dict(zone=h["zone"], points=pts)
            elif kind == "late_shots_against":
                w0 = h["window"][0]
                against = [e for e in shots if side(e) != tix]
                late = [e for e in against if e["matchTime"] >= w0 * 60]
                goal = next((e for e in late if e["typeId"] == TYPE["goal"]), None)
                came, k, n, _ = rules.late_shots_against(
                    [(e["matchTime"], e["typeId"] == TYPE["goal"]) for e in against], h["window"]
                )
                value = [k, n]
                share = f"{k} of {n} shots against came after minute {w0}"
                line, detail = (
                    (f"Goal, minute {int(goal['matchTime'] // 60) + 1}", share)
                    if goal
                    else (share, "Too few shots to judge" if came is None else f"The usual is {h['value']} in 100")
                )
                extra = dict(
                    window=h["window"],
                    points=[
                        dict(frame=frame_of(e), inside=e["matchTime"] >= w0 * 60, goal=e["typeId"] == TYPE["goal"])
                        for e in against
                    ],
                )
            elif kind == "challenges_per_match":
                card = next((f for f in self.ledger.facts(mid, t, kind="card") if f["subject"] == subj), None)
                if card is None:
                    line, detail = f"{names[subj]} was not booked", "So this one was never tested"
                else:
                    tc = card["match_time"]
                    went = [
                        e
                        for e in ev
                        if e["playerId"] == subj
                        and (
                            e["typeId"] in (TYPE["tackle"], TYPE["challenge"])
                            or (e["typeId"] == TYPE["foul"] and e["outcome"] == 0)
                        )
                    ]
                    kept = []  # one challenge is often written as two or three events; count it once
                    for e in went:
                        if not kept or e["matchTime"] - kept[-1]["matchTime"] > rules.SAME_CHALLENGE_S:
                            kept.append(e)
                    went = kept
                    came, b, a, _ = rules.booked_challenges([e["matchTime"] for e in went], tc, t)
                    value = [b, a]
                    line, detail = f"{b} challenges before his card, {a} after", f"Booked in minute {int(tc // 60) + 1}"
                    extra = dict(
                        before=b,
                        after=a,
                        player=subj,
                        points=[dict(frame=frame_of(e), inside=e["matchTime"] >= tc) for e in went],
                    )
            else:
                continue
            f = self.ledger.put_fact(
                fact(
                    mid,
                    t,
                    "call_outcome",
                    subj,
                    value,
                    "what became of a call made before kick-off",
                    habit=kind,
                    came_true=came,
                )
            )
            out.append(
                dict(
                    mark=h["mark"],
                    said=h["text"],
                    came_true=came,
                    line=line,
                    detail=detail,
                    value=value,
                    **extra,
                    fact_ids=[f["fact_id"]] + ([facts[(subj, kind)]["fact_id"]] if (subj, kind) in facts else []),
                )
            )
        return out


def generate(plain_seed=None):
    if plain_seed is None:
        story = DemoStory()
        sim = Sim(seed=DEMO_SEED, match_id="m_demo", story=story).run()
        md = match_data(sim)
        md["planted"] = story.planted
    else:
        md = match_data(Sim(seed=plain_seed, match_id=f"m_{plain_seed}").run())
        md["planted"] = []
    return md


def main(argv):
    plain = int(argv[argv.index("--plain") + 1]) if "--plain" in argv else None
    t0 = time.time()
    season, search = seasonmod.load()
    md = generate(plain)
    out = os.path.join(RUNS, md["meta"]["match_id"])
    if os.path.exists(os.path.join(out, "tempo.sqlite")):
        os.remove(os.path.join(out, "tempo.sqlite"))
    p = Pipeline(md, out, season=season, search=search)
    p.run()
    s = p.finish(time.time() - t0)
    json.dump(md["planted"], open(os.path.join(out, "planted.json"), "w"), indent=1)
    print(json.dumps(s, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
