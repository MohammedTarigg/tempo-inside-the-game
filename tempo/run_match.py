"""Runs one match through the whole pipeline on this machine.

    python3 -m tempo.run_match                 the demo match, start to finish
    python3 -m tempo.run_match --plain 21      an unscripted match with seed 21

Feeds go in at the front in the providers' shapes; cues come out at the back, stamped with match time. Everything lands in
runs/<match_id>/: cues.jsonl, facts.jsonl, audit.jsonl, replay.npz for a front end, and summary.json."""
import json
import os
import sys
import time
import numpy as np

from . import season as seasonmod
from .agents import Writer, verify
from .bus import LocalBus
from .contracts import TYPE, fact
from .cues import CueService
from .generator.export import match_data
from .generator.sim import HZ, Sim
from .generator.story import DemoStory
from .ledger import Ledger
from .listener import Listener
from .reflex import Reflex, win_chance
from .stake.model import StakeModel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Pipeline:
    def __init__(self, md, out_dir, model=None, season=None, search=None, rules=None, db_path=None):
        self.md, self.meta, self.out = md, md["meta"], out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.ledger = Ledger(db_path or os.path.join(out_dir, "tempo.sqlite"))
        self.bus = LocalBus(out_dir)
        self.cues = CueService(self.meta["match_id"], self.ledger, self.bus, rules)
        self.season = season or {}
        self.reflex = Reflex(self.meta, md["team"], self.ledger, self.cues, model or StakeModel(), baselines=self.season, search=search)
        self.writer = Writer(self.ledger, self.cues, self.meta)
        self.listener = Listener(self.meta)
        self.view = dict(pos=md["pos"], ball=md["ball"], live=md["live"], poss=md["poss"], team=md["team"])
        self.ev_i = self.cm_i = 0
        self.frame_ms, self.swings, self.halftime_done = [], [], False

    # ----- recovery -----
    def checkpoint(self, i):
        self.ledger.save_checkpoint("pipeline", dict(frame=i, ev_i=self.ev_i, cm_i=self.cm_i, reflex=self.reflex.snapshot(), cues=self.cues.state(),
                                                     halftime_done=self.halftime_done, swings=self.swings, shots=[(a["t"], a["meta"].get("frame")) for a in self.reflex.search.archive if a["match_id"] == self.meta["match_id"]]))
        self.ledger.commit()

    def resume(self):
        cp = self.ledger.load_checkpoint("pipeline")
        if not cp:
            return 0
        self.ev_i, self.cm_i, self.halftime_done, self.swings = cp["ev_i"], cp["cm_i"], cp["halftime_done"], cp["swings"]
        self.cues.restore(cp["cues"])
        self.reflex.restore(cp["reflex"], self.md, cp["frame"])
        from . import twin
        for e in self.md["events"][:self.ev_i]:                                # rebuild this match's part of the attack archive
            if e["typeId"] in (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"]):
                fr = next((f for t, f in cp["shots"] if abs(t - e["matchTime"]) < 1e-6), None)
                if fr is not None:
                    p = self.meta["ids"].index(e["playerId"]); team = int(self.md["team"][p]); d = self.md["home_dir"][fr] if team == 0 else -self.md["home_dir"][fr]
                    vec = twin.attack_vector(self.view, twin.attack_start(self.view["live"], self.view["poss"], fr), fr, team, d, self.meta["keepers"])
                    if vec is not None:
                        self.reflex.search.add(vec, team, self.meta["match_id"], e["matchTime"], "goal" if e["typeId"] == TYPE["goal"] else "no_goal", meta=dict(player=e["playerId"], frame=fr))
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
                return False                                                    # a simulated crash: nothing after the last checkpoint is saved
            t, period = float(md["clock"][i]), int(md["period"][i])
            if period == 2 and not self.halftime_done:
                self.halftime(45 * 60.0); self.halftime_done = True
            t0 = time.perf_counter()
            while self.ev_i < len(md["events"]) and md["events"][self.ev_i]["periodId"] <= period and md["events"][self.ev_i]["matchTime"] <= t:
                e = md["events"][self.ev_i]; self.ev_i += 1
                before = win_chance(R.score, 90 - t / 60)
                for m in R.on_event(e, self.view, i, md["home_dir"][i]):
                    if m["kind"] == "goal":
                        after = win_chance(R.score, 90 - t / 60)
                        f = self.ledger.put_fact(fact(self.meta["match_id"], t, "win_chance", "match", after, "home, draw, away"))
                        self.swings.append(dict(t=t, swing=round(abs(after[0] - before[0]) + abs(after[2] - before[2]), 3), moment=m, fact_id=f["fact_id"]))
                    self.writer.write_moment(m)
            while self.cm_i < len(md["commentary"]) and md["commentary"][self.cm_i]["matchTime"] <= t:
                self.on_commentary(md["commentary"][self.cm_i]); self.cm_i += 1
            for m in R.on_frame(i, t, period, md["pos"][i], md["ball"][i], bool(md["live"][i]), int(md["poss"][i]), md["home_dir"][i]):
                self.writer.write_moment(m)
            self.frame_ms.append((time.perf_counter() - t0) * 1000)
            if t - last_cp >= checkpoint_every_s:
                self.checkpoint(i); last_cp = t
        self.fulltime(float(md["clock"][-1]))
        self.checkpoint(n - 1)
        return True

    def kickoff(self):
        habits = []
        for h in self.season.get("habits", []):
            f = self.ledger.put_fact(fact(self.meta["match_id"], 0.0, "habit", h["subject"], h["value"], h["unit"], sample_matches=h["sample"], habit=h["kind"]))
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
            ctx = dict(names=self.meta["names"], player=pid, per_minute=f["value"], top_speed=f["top_speed"])
            text = self.writer.fallback.narrate("form", ctx)
            if self.listener.already_said(line["text"], [f["value"]]) or not verify(text, [f], self.meta["names"], expected=self.writer.fallback.numbers("form", ctx))[0]:
                self.ledger.audit(t, "held_back", dict(form="form_card", reason="the commentator has just said it, or the line failed the check")); continue
            self.cues.propose(t, "form_card", "tv", dict(player=pid, per_minute=f["value"], usual_percentile=f["percentile"], top_speed=f["top_speed"], heard=line["text"]), [f["fact_id"]], valid_for=4.5, priority=5)

    def halftime(self, t):
        names = self.meta["names"]
        items = []
        booked = [f for f in self.ledger.facts(self.meta["match_id"], t, kind="card") if f["value"] == "yellow"]
        if booked:
            items.append(dict(title="On a yellow", text=", ".join(names[f["subject"]] for f in booked[:3]) + ": one foul from a red card", fact_ids=[f["fact_id"] for f in booked[:3]], mark="card"))
        for h in self.ledger.facts(self.meta["match_id"], t, kind="habit"):
            if h.get("habit") == "late_shots_against":
                items.append(dict(title="Still to come", text=f"{h['value']} {h['unit']}", fact_ids=[h["fact_id"]], mark="window"))
        duels = self.ledger.facts(self.meta["match_id"], t, kind="duel_count")
        if duels:
            d = duels[-1]; a, b = d["subject"].split("|")
            items.append(dict(title="A running duel", text=f"{names[a]} against {names[b]}: {d['value'][0]} to {d['value'][1]}", fact_ids=[d["fact_id"]], mark="duel"))
        self.reflex.running_facts(t)
        if items:
            self.writer.interval_card(t, "halftime_card", items)

    def fulltime(self, t):
        names = self.meta["names"]
        items = []
        for s in sorted(self.swings, key=lambda s: -s["swing"])[:3]:
            m = s["moment"]; minute = int(m["t"] // 60) + 1
            ca = m.get("closest_attempt")
            text = f"{names[m['player']]} scores in minute {minute}" + (f". Closest earlier attempt: minute {int(ca['earlier_time'] // 60) + 1}" if ca else "")
            items.append(dict(title=f"Minute {minute}", text=text, fact_ids=m["fact_ids"] + [s["fact_id"]], mark="closest_attempt" if ca else "goal"))
        if items:
            self.writer.interval_card(t, "fulltime_card", items)

    def scenes(self, cues):
        """Full-rate positions for every replay scene, both attempts turned to run the same way, so a front end can lay one over the other."""
        from . import twin
        md, out = self.md, []
        for c in cues:
            if c["form"] != "scene" or c["payload"]["type"] != "closest_attempt":
                continue
            f = next(x for x in (self.ledger.get_fact(i) for i in c["fact_ids"]) if x and x["kind"] == "closest_attempt")
            card = next((x for x in (self.ledger.get_fact(i) for i in c["fact_ids"]) if x and x["kind"] == "card"), None)
            clips = {}
            for name, shot in (("goal", c["payload"]["goal_frame"]), ("earlier", c["payload"]["earlier_frame"])):
                start = twin.attack_start(md["live"], md["poss"], shot)
                a, b = max(start - 25, 0), min(shot + 75, len(md["clock"]) - 1)
                scorer = self.meta["ids"].index(c["payload"]["camera"]["behind"])
                sgn = md["home_dir"][shot] if md["team"][scorer] == 0 else -md["home_dir"][shot]      # the attack runs towards +x in both clips
                pos = np.round(md["pos"][a:b + 1] * sgn, 2)
                ball = md["ball"][a:b + 1].copy(); ball[:, :2] *= sgn
                per, t_a, t_b = int(md["period"][shot]), float(md["clock"][a]), float(md["clock"][b])
                kinds = {TYPE["pass"]: "pass", TYPE["goal"]: "shot", TYPE["attempt_saved"]: "shot", TYPE["miss"]: "shot", TYPE["tackle"]: "tackle", TYPE["challenge"]: "tackle"}
                acts = [dict(kind=kinds[e["typeId"]], player=self.meta["ids"].index(e["playerId"]), frame=int(round((e["matchTime"] - t_a) * 25)))
                        for e in md["events"] if e["periodId"] == per and t_a <= e["matchTime"] <= t_b and e["typeId"] in kinds]      # who strikes the ball, and when
                clips[name] = dict(start_offset=int(start - a), shot_offset=int(shot - a), minute=int(md["clock"][shot] // 60) + 1, clock=float(md["clock"][start]),
                                   pos=np.where(np.isnan(pos), None, pos).tolist(), ball=np.round(ball, 2).tolist(), actions=acts)
            out.append(dict(cue_id=c["cue_id"], fps=25, label=c["payload"]["label"], scorer=c["payload"]["camera"]["behind"], differing_player=f["differing_player"],
                            differing_by_m=f["differing_by_m"], parting_s=f["parting_s"], gap_m=f["value"], booked_minute=int(card["match_time"] // 60) + 1 if card else None,
                            ids=self.meta["ids"], numbers=self.meta["numbers"], names=self.meta["names"], team=md["team"].tolist(),
                            home=self.meta["home"]["short"], away=self.meta["away"]["short"], clips=clips))
        return out

    def live_window(self, cues, before=20.0, after=170.0):
        """A stretch of live play for a front end: positions at 12.5 frames a second, with every cue and ball strike inside it.
        It is the three minutes that follow the booking the match's replay scene turns on, or failing that the first booking."""
        md, mid = self.md, self.meta["match_id"]
        cards = [f for f in self.ledger.facts(mid, 1e9, kind="card") if f["value"] == "yellow"]
        ca = self.ledger.facts(mid, 1e9, kind="closest_attempt")
        focus = next((c for c in cards if ca and c["subject"] == ca[0]["differing_player"]), cards[0] if cards else None)
        if focus is None:
            return dict(frames=0)
        t_card = focus["match_time"]
        per = 2 if t_card >= 45 * 60 else 1
        idx = np.flatnonzero((md["period"] == per) & (md["clock"] >= t_card - before) & (md["clock"] <= t_card + after))[::2]
        t0, t1 = float(md["clock"][idx[0]]), float(md["clock"][idx[-1]])
        pos = np.round(md["pos"][idx], 2)
        kinds = {TYPE["pass"]: "pass", TYPE["goal"]: "shot", TYPE["attempt_saved"]: "shot", TYPE["miss"]: "shot", TYPE["tackle"]: "tackle", TYPE["challenge"]: "tackle", TYPE["foul"]: "foul"}
        acts = [dict(kind=kinds[e["typeId"]], player=self.meta["ids"].index(e["playerId"]), t=round(e["matchTime"] - t0, 2), outcome=e["outcome"])
                for e in md["events"] if e["periodId"] == per and t0 <= e["matchTime"] <= t1 and e["typeId"] in kinds]
        inside = [c for c in cues if t0 <= c["match_time"] <= t1 and c["form"] in ("stake_card", "label", "tag", "duel", "form_card", "sentence")]
        goals = [f for f in self.ledger.facts(mid, 1e9, kind="goal")]
        score0 = [0, 0]
        for f in goals:
            if f["match_time"] < t0:
                score0 = f["value"]
        booked0 = [dict(player=c["subject"], minute=int(c["match_time"] // 60) + 1) for c in cards if c["match_time"] < t0]
        return dict(fps=12.5, t0=t0, t1=t1, period=per, frames=len(idx), clock=np.round(md["clock"][idx], 2).tolist(), live=md["live"][idx].tolist(),
                    pos=np.where(np.isnan(pos), None, pos).tolist(), ball=np.round(md["ball"][idx], 2).tolist(), actions=acts,
                    cues=[dict(t=round(c["match_time"] - t0, 2), form=c["form"], screen=c["screen"], when=c["when"], valid_for=c["valid_for"], payload=c["payload"], status=c["status"]) for c in inside],
                    goals=[dict(t=round(f["match_time"] - t0, 2), score=f["value"], player=f["subject"]) for f in goals if t0 <= f["match_time"] <= t1],
                    score_at_start=score0, booked_before=booked0, focus=focus["subject"], focus_booked_at=round(t_card - t0, 2),
                    ids=self.meta["ids"], numbers=self.meta["numbers"], names=self.meta["names"], team=md["team"].tolist(),
                    home=dict(short=self.meta["home"]["short"], name=self.meta["home"]["name"]), away=dict(short=self.meta["away"]["short"], name=self.meta["away"]["name"]),
                    home_attacks=float(md["home_dir"][idx[0]]), stake=dict(faint=self.reflex.model.faint, full=self.reflex.model.full, provisional=bool(self.reflex.model.meta.get("provisional"))))

    @staticmethod
    def stake_counts(log):
        """Appearances are counted once: a card coming on from nothing. Full counts each rise to the full level."""
        prev, faint, full = {}, 0, 0
        for t, pid, lvl, _ in log:
            was = prev.get(pid, 0)
            faint += was == 0 and lvl >= 1
            full += lvl == 2 and was < 2
            prev[pid] = lvl
        return dict(appearances=faint, full=full, players=sorted({x[1] for x in log}))

    # ----- what the run leaves behind -----
    def finish(self, wall_s):
        mid = self.meta["match_id"]
        self.ledger.commit()
        cues = self.ledger.cues(mid)
        with open(os.path.join(self.out, "cues.jsonl"), "w") as f:
            for c in cues:
                f.write(json.dumps(c, default=float) + "\n")
        with open(os.path.join(self.out, "facts.jsonl"), "w") as f:
            for x in self.ledger.facts(mid, 1e9):
                f.write(json.dumps(x, default=float) + "\n")
        with open(os.path.join(self.out, "audit.jsonl"), "w") as f:
            for t, k, b in self.ledger.audit_rows():
                f.write(json.dumps(dict(match_time=t, kind=k, **b), default=float) + "\n")
        md = self.md
        np.savez_compressed(os.path.join(self.out, "replay.npz"), pos=md["pos"][::5].astype(np.float32), ball=md["ball"][::5].astype(np.float32), clock=md["clock"][::5],
                            period=md["period"][::5], live=md["live"][::5], momentum=np.array(self.reflex.mom_hist))
        json.dump(dict(self.meta, events=len(md["events"])), open(os.path.join(self.out, "meta.json"), "w"), default=float, indent=1)
        json.dump(self.scenes(cues), open(os.path.join(self.out, "scenes.json"), "w"), default=float)
        json.dump(self.live_window(cues), open(os.path.join(self.out, "live.json"), "w"), default=float)
        forms = {}
        for c in cues:
            forms[c["form"]] = forms.get(c["form"], 0) + 1
        levels = [x for x in self.reflex.stake_log]
        fm = np.array(self.frame_ms) if self.frame_ms else np.zeros(1)
        summary = dict(match_id=mid, final_score=self.reflex.score, frames=len(md["clock"]), events_read=len(md["events"]), cues_by_form=forms,
                       things_shown=self.cues.shown, held_back=self.cues.held, facts=len(self.ledger.facts(mid, 1e9)),
                       stake_cards=self.stake_counts(levels),
                       verifier_rejections=len(self.ledger.audit_rows("verifier_rejected")),
                       frame_ms=dict(p50=round(float(np.percentile(fm, 50)), 3), p95=round(float(np.percentile(fm, 95)), 3), p99=round(float(np.percentile(fm, 99)), 3), max=round(float(fm.max()), 1)),
                       writer_ms=[round(x * 1000, 2) for x in self.writer.timings], wall_seconds=round(wall_s, 1), writer_backend=self.writer.backend.name,
                       stake_model=dict(provisional=bool(self.reflex.model.meta.get("provisional")), faint=self.reflex.model.faint, full=self.reflex.model.full))
        json.dump(summary, open(os.path.join(self.out, "summary.json"), "w"), indent=1, default=float)
        return summary


def generate(plain_seed=None):
    if plain_seed is None:
        story = DemoStory()
        sim = Sim(seed=7, match_id="m_demo", story=story).run()
        md = match_data(sim); md["planted"] = story.planted
    else:
        md = match_data(Sim(seed=plain_seed, match_id=f"m_{plain_seed}").run()); md["planted"] = []
    return md


def main(argv):
    plain = int(argv[argv.index("--plain") + 1]) if "--plain" in argv else None
    t0 = time.time()
    season, search = seasonmod.load()
    md = generate(plain)
    out = os.path.join(ROOT, "runs", md["meta"]["match_id"])
    if os.path.exists(os.path.join(out, "tempo.sqlite")):
        os.remove(os.path.join(out, "tempo.sqlite"))
    p = Pipeline(md, out, season=season, search=search)
    p.run()
    s = p.finish(time.time() - t0)
    json.dump(md["planted"], open(os.path.join(out, "planted.json"), "w"), indent=1)
    print(json.dumps(s, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
