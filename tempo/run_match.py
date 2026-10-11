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
            self.cues.frame = i
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

    def match_view(self, cues):
        """The whole match for a front end. Positions go to match.bin at full rate: one row a frame, 22 players' x and y then the
        ball's x, y and height, as whole centimetres (-32768 where a player is off). Everything else is returned for match.json:
        every cue with the frame it was issued on, who plays the ball and when, goals, bookings and the momentum record."""
        md, mid = self.md, self.meta["match_id"]
        n = len(md["clock"]); period, clock = md["period"], md["clock"]
        q = np.full((n, 47), -32768, np.int16)
        xy = np.round(md["pos"].reshape(n, 44) * 100); ok = ~np.isnan(xy); q[:, :44][ok] = xy[ok].astype(np.int16)
        q[:, 44:] = np.round(md["ball"] * 100).astype(np.int16)
        q.tofile(os.path.join(self.out, "match.bin"))
        spans = []
        for p in sorted(set(period.tolist())):
            idx = np.flatnonzero(period == p)
            spans.append(dict(period=int(p), first=int(idx[0]), last=int(idx[-1]), clock0=float(clock[idx[0]]), home_attacks=float(md["home_dir"][idx[0]])))

        def frame_of(per, t):
            sp = next(x for x in spans if x["period"] == per)
            return int(np.clip(sp["first"] + round((t - sp["clock0"]) * 25), sp["first"], sp["last"]))

        def guess(t):                                                           # only for cues issued before a restart from a checkpoint
            return frame_of(2 if t >= 45 * 60 and len(spans) > 1 else 1, t)
        kinds = {TYPE["pass"]: "pass", TYPE["goal"]: "shot", TYPE["attempt_saved"]: "shot", TYPE["miss"]: "shot", TYPE["tackle"]: "tackle", TYPE["challenge"]: "tackle",
                 TYPE["foul"]: "foul", TYPE["interception"]: "interception", TYPE["clearance"]: "clearance", TYPE["save"]: "save"}
        acts = [dict(kind=kinds[e["typeId"]], player=self.meta["ids"].index(e["playerId"]), frame=frame_of(e["periodId"], e["matchTime"]), outcome=e["outcome"])
                for e in md["events"] if e["typeId"] in kinds and not (e["typeId"] == TYPE["foul"] and e["outcome"] == 1)]
        live = md["live"].astype(bool)
        flips = (np.flatnonzero(live[1:] != live[:-1]) + 1).tolist()
        out_cues = [dict(id=c["cue_id"], frame=self.cues.frame_of.get(c["cue_id"], guess(c["match_time"])), t=c["match_time"], form=c["form"], screen=c["screen"], when=c["when"],
                         valid_for=c["valid_for"], priority=c["priority"], payload=c["payload"], status=c["status"]) for c in cues]
        goals = [dict(frame=guess(f["match_time"]), score=f["value"], player=f["subject"], minute=int(f["match_time"] // 60) + 1) for f in self.ledger.facts(mid, 1e9, kind="goal")]
        cards = [dict(frame=guess(f["match_time"]), player=f["subject"], colour=f["value"], minute=int(f["match_time"] // 60) + 1) for f in self.ledger.facts(mid, 1e9, kind="card")]
        return dict(match_id=mid, fps=25, frames=n, row=47, unit="cm", periods=spans, live0=bool(live[0]), live_flips=flips, actions=acts, cues=out_cues, goals=goals, cards=cards,
                    momentum=[[guess(float(t)), float(v)] for t, v in self.reflex.mom_hist], event_frames=[frame_of(e["periodId"], e["matchTime"]) for e in md["events"]],
                    shown=self.cues.shown, held=self.cues.held,
                    ids=self.meta["ids"], numbers=self.meta["numbers"], names=self.meta["names"], team=md["team"].tolist(),
                    home=dict(short=self.meta["home"]["short"], name=self.meta["home"]["name"]), away=dict(short=self.meta["away"]["short"], name=self.meta["away"]["name"]),
                    stake=dict(faint=self.reflex.model.faint, full=self.reflex.model.full, provisional=bool(self.reflex.model.meta.get("provisional"))))

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
        json.dump(self.match_view(cues), open(os.path.join(self.out, "match.json"), "w"), default=float)
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
