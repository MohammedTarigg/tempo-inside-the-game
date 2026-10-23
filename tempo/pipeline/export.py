"""What a finished run leaves behind. The pipeline decides what is shown and when; this module writes it down for a
front end: cues.jsonl and facts.jsonl as the run made them, scenes.json and match.json with match.bin for the pages,
and summary.json with the counts and timings. The audit goes to the run's working folder, with its ledger."""

import json
import os
from typing import TYPE_CHECKING

import numpy as np

from ..contracts import TYPE
from ..instruments import twin
from ..jsonio import write_json

if TYPE_CHECKING:
    from .run import Pipeline


def _with_gaps(pos):
    """Positions as nested lists, with None where a player is off the pitch."""
    out = pos.astype(object)
    out[np.isnan(pos)] = None
    return out.tolist()


class Export:
    """The exporters of a run. Given a finished run, they read its state (the match data, the ledger, the cue service,
    the reflex service and the writer) and write into its run folder."""

    def __init__(self, run: "Pipeline"):
        self.run = run

    def scenes(self, cues):
        """Full-rate positions for every replay scene, both attempts turned to run the same way, so a front end can lay
        one over the other."""
        md, out = self.run.md, []
        for c in cues:
            if c["form"] != "scene" or c["payload"]["type"] != "closest_attempt":
                continue
            if (
                c["payload"]["earlier_frame"] is None
            ):  # the closest attempt was in another match: nothing here to lay it over
                continue
            f = next(
                x for x in (self.run.ledger.get_fact(i) for i in c["fact_ids"]) if x and x["kind"] == "closest_attempt"
            )
            card = next(
                (x for x in (self.run.ledger.get_fact(i) for i in c["fact_ids"]) if x and x["kind"] == "card"), None
            )
            clips = {}
            for name, shot in (("goal", c["payload"]["goal_frame"]), ("earlier", c["payload"]["earlier_frame"])):
                start = twin.attack_start(md["live"], md["poss"], shot)
                a, b = max(start - 25, 0), min(shot + 75, len(md["clock"]) - 1)
                scorer = self.run.meta["ids"].index(c["payload"]["camera"]["behind"])
                sgn = (
                    md["home_dir"][shot] if md["team"][scorer] == 0 else -md["home_dir"][shot]
                )  # the attack runs towards +x in both clips
                pos = np.round(md["pos"][a : b + 1] * sgn, 2)
                ball = md["ball"][a : b + 1].copy()
                ball[:, :2] *= sgn
                per, t_a, t_b = int(md["period"][shot]), float(md["clock"][a]), float(md["clock"][b])
                kinds = {
                    TYPE["pass"]: "pass",
                    TYPE["goal"]: "shot",
                    TYPE["attempt_saved"]: "shot",
                    TYPE["miss"]: "shot",
                    TYPE["tackle"]: "tackle",
                    TYPE["challenge"]: "tackle",
                }
                acts = [
                    dict(
                        kind=kinds[e["typeId"]],
                        player=self.run.meta["ids"].index(e["playerId"]),
                        frame=round((e["matchTime"] - t_a) * 25),
                    )
                    for e in md["events"]
                    if e["periodId"] == per and t_a <= e["matchTime"] <= t_b and e["typeId"] in kinds
                ]  # who strikes the ball, and when
                clips[name] = dict(
                    start_offset=int(start - a),
                    shot_offset=int(shot - a),
                    minute=int(md["clock"][shot] // 60) + 1,
                    clock=float(md["clock"][start]),
                    pos=_with_gaps(pos),
                    ball=np.round(ball, 2).tolist(),
                    actions=acts,
                )
            out.append(
                dict(
                    cue_id=c["cue_id"],
                    fps=25,
                    label=c["payload"]["label"],
                    scorer=c["payload"]["camera"]["behind"],
                    differing_player=f["differing_player"],
                    differing_by_m=f["differing_by_m"],
                    parting_s=f["parting_s"],
                    gap_m=f["value"],
                    booked_minute=int(card["match_time"] // 60) + 1 if card else None,
                    ids=self.run.meta["ids"],
                    numbers=self.run.meta["numbers"],
                    names=self.run.meta["names"],
                    team=md["team"].tolist(),
                    home=self.run.meta["home"]["short"],
                    away=self.run.meta["away"]["short"],
                    home_name=self.run.meta["home"]["name"],
                    away_name=self.run.meta["away"]["name"],
                    clips=clips,
                )
            )
        return out

    def match_view(self, cues):
        """The whole match for a front end. Positions go to match.bin at full rate: one row a frame, 22 players' x and y
        then the ball's x, y and height, as whole centimetres (-32768 where a player is off). Everything else is
        returned for match.json: every cue with the frame it was issued on, who plays the ball and when, goals, bookings
        and the momentum record."""
        md, mid = self.run.md, self.run.meta["match_id"]
        n = len(md["clock"])
        period, clock = md["period"], md["clock"]
        q = np.full((n, 47), -32768, np.int16)
        xy = np.round(md["pos"].reshape(n, 44) * 100)
        ok = ~np.isnan(xy)
        q[:, :44][ok] = xy[ok].astype(np.int16)
        q[:, 44:] = np.round(md["ball"] * 100).astype(np.int16)
        q.tofile(os.path.join(self.run.out, "match.bin"))
        spans = []
        for p in sorted(set(period.tolist())):
            idx = np.flatnonzero(period == p)
            spans.append(
                dict(
                    period=int(p),
                    first=int(idx[0]),
                    last=int(idx[-1]),
                    clock0=float(clock[idx[0]]),
                    home_attacks=float(md["home_dir"][idx[0]]),
                )
            )

        def frame_of(per, t):
            sp = next(x for x in spans if x["period"] == per)
            return int(np.clip(sp["first"] + round((t - sp["clock0"]) * 25), sp["first"], sp["last"]))

        def guess(t):  # only for cues issued before a restart from a checkpoint
            return frame_of(2 if t >= 45 * 60 and len(spans) > 1 else 1, t)

        kinds = {
            TYPE["pass"]: "pass",
            TYPE["goal"]: "shot",
            TYPE["attempt_saved"]: "shot",
            TYPE["miss"]: "shot",
            TYPE["tackle"]: "tackle",
            TYPE["challenge"]: "tackle",
            TYPE["foul"]: "foul",
            TYPE["interception"]: "interception",
            TYPE["clearance"]: "clearance",
            TYPE["save"]: "save",
        }
        ix = self.run.meta["ids"].index
        acts = [
            dict(
                kind=kinds[e["typeId"]],
                player=ix(e["playerId"]),
                frame=frame_of(e["periodId"], e["matchTime"]),
                outcome=e["outcome"],
                **({"other": ix(e["other"])} if e.get("other") else {}),
            )
            for e in md["events"]
            if e["typeId"] in kinds and not (e["typeId"] == TYPE["foul"] and e["outcome"] == 1)
        ]
        acts += [
            dict(
                kind="down",
                player=ix(e["playerId"]),
                frame=frame_of(e["periodId"], e["matchTime"]),
                seconds=e["down_s"],
            )
            for e in md["events"]
            if e.get("down_s")
        ]  # a fouled player on the ground
        acts.sort(key=lambda a: a["frame"])
        live = md["live"].astype(bool)
        flips = (np.flatnonzero(live[1:] != live[:-1]) + 1).tolist()
        out_cues = [
            dict(
                id=c["cue_id"],
                frame=self.run.cues.frame_of.get(c["cue_id"], guess(c["match_time"])),
                t=c["match_time"],
                form=c["form"],
                screen=c["screen"],
                when=c["when"],
                valid_for=c["valid_for"],
                priority=c["priority"],
                payload=c["payload"],
                status=c["status"],
            )
            for c in cues
        ]
        desk = self.desk_rows(out_cues, guess)
        goals = [
            dict(
                frame=guess(f["match_time"]),
                score=f["value"],
                player=f["subject"],
                minute=int(f["match_time"] // 60) + 1,
            )
            for f in self.run.ledger.facts(mid, 1e9, kind="goal")
        ]
        cards = [
            dict(
                frame=guess(f["match_time"]),
                player=f["subject"],
                colour=f["value"],
                minute=int(f["match_time"] // 60) + 1,
            )
            for f in self.run.ledger.facts(mid, 1e9, kind="card")
        ]
        # what the reason rule saw at each goal: where each of its three instruments pointed, and whether they agreed
        F = lambda kind: self.run.ledger.facts(mid, 1e9, kind=kind)
        at = lambda fs, t: next((f for f in fs if abs(f["match_time"] - t) < 0.01), None)
        reasons = []
        for g in F("goal"):
            t = g["match_time"]
            gh, ca, rs = at(F("ghost_standoff"), t), at(F("closest_attempt"), t), at(F("reason"), t)
            card = lambda pid, t=t: next(
                (f for f in F("card") if f["subject"] == pid and f["value"] == "yellow" and f["match_time"] < t), None
            )
            who = (ca or {}).get("differing_player") or (gh or {}).get("subject")
            bk = card(who) if who else None
            reasons.append(
                dict(
                    frame=guess(t),
                    minute=int(t // 60) + 1,
                    scorer=g["subject"],
                    agreed=bool(rs),
                    earlier=dict(
                        player=ca["differing_player"],
                        by_m=ca["differing_by_m"],
                        minute=int(ca["earlier_time"] // 60) + 1,
                    )
                    if ca
                    else None,
                    ghost=dict(player=gh["subject"], off_m=gh["value"]) if gh else None,
                    booked=dict(player=who, minute=int(bk["match_time"] // 60) + 1) if bk else None,
                )
            )
        return dict(
            match_id=mid,
            fps=25,
            frames=n,
            row=47,
            unit="cm",
            periods=spans,
            reasons=reasons,
            live0=bool(live[0]),
            live_flips=flips,
            actions=acts,
            cues=out_cues,
            goals=goals,
            cards=cards,
            # each player's running numbers, a row a minute, for a viewer who follows one player
            ledgers=dict(
                frames=[h[0] for h in self.run.reflex.ledger_hist],
                dist=[h[1] for h in self.run.reflex.ledger_hist],
                top=[h[2] for h in self.run.reflex.ledger_hist],
                passes=[h[3] for h in self.run.reflex.ledger_hist],
            ),
            momentum=[[guess(float(t)), float(v)] for t, v in self.run.reflex.mom_hist],
            event_frames=[frame_of(e["periodId"], e["matchTime"]) for e in md["events"]],
            shown=self.run.cues.shown,
            held=self.run.cues.held,
            desk=desk,
            ids=self.run.meta["ids"],
            numbers=self.run.meta["numbers"],
            names=self.run.meta["names"],
            team=md["team"].tolist(),
            names_ar=self.run.meta["names_ar"],
            home=dict(
                short=self.run.meta["home"]["short"],
                name=self.run.meta["home"]["name"],
                name_ar=self.run.meta["home"]["name_ar"],
            ),
            away=dict(
                short=self.run.meta["away"]["short"],
                name=self.run.meta["away"]["name"],
                name_ar=self.run.meta["away"]["name_ar"],
            ),
            stake=dict(
                faint=self.run.reflex.model.faint,
                full=self.run.reflex.model.full,
            ),
        )

    def desk_rows(self, out_cues, guess):
        """What the producer's desk lists: every item the cue service considered, as it aired or with the short reason
        it was held, plus every line the verifier turned back. A stake card is listed when it goes full, and the Arabic
        twin of a line is left out, so a row is one decision a person would recognise."""
        names, teams = self.run.meta["names"], (self.run.meta["home"]["name"], self.run.meta["away"]["name"])
        by_id = {c["id"]: c for c in out_cues}
        nm = lambda pid: names.get(pid, "")

        def what(form, p):
            if form in ("stake_card", "form_card"):
                return nm(p.get("player"))
            if form == "tag":
                return f"{nm(p['player'])}, {p['text']}"
            if form == "duel":
                return f"{nm(p['defender'])} against {nm(p['attacker'])}"
            if form in ("label", "sentence", "kickoff_mark"):
                return p["text"]
            if form == "pressure":
                return f"{teams[p['team']]}, {p['now']} in 100"
            if form == "danger_window":
                return f"Minutes {p['from_minute']} to {p['to_minute']}"
            if form == "scene":
                return "The goal against the earlier attempt" if p["type"] == "closest_attempt" else "The goal"
            if form == "reason":
                return nm(p.get("ghost"))
            if form == "halftime_card":
                return f"{len(p['cards'])} things still open"
            if form == "fulltime_card":
                return f"{len(p['pins'])} turning points"
            return ""

        rows = []
        for t, kind, b in self.run.ledger.audit_rows():
            if kind == "shown":
                c = by_id.get(b["cue_id"])
                if not c or (c["form"] == "stake_card" and c["payload"].get("level") != 2):
                    continue
                if c["form"] == "sentence" and (c["screen"] != "phone" or c["payload"]["lang"] != "en"):
                    continue  # the Arabic twin, and the commentator's copy of the same line
                how = c["payload"].get("how", "")
                rows.append(
                    dict(
                        frame=c["frame"],
                        form=c["form"],
                        status="template" if how.startswith("template") else "shown",
                        what=what(c["form"], c["payload"]),
                    )
                )
            elif kind == "held_back":
                rows.append(
                    dict(
                        frame=guess(t),
                        form=b["form"],
                        status="held",
                        what=what(
                            b["form"], {**b.get("payload", {}), **({"ghost": b["ghost"]} if "ghost" in b else {})}
                        ),
                        why=b.get("short", ""),
                    )
                )
            elif kind == "withdrawn":
                c = by_id.get(b["cue_id"])
                rows.append(
                    dict(
                        frame=guess(t),
                        form=c["form"] if c else "",
                        status="withdrawn",
                        what=what(c["form"], c["payload"]) if c else "",
                        why="Its fact was withdrawn",
                    )
                )
            elif kind == "verifier_rejected" and b.get("lang") == "en":
                rows.append(
                    dict(frame=guess(t), form="sentence", status="rejected", what=b["text"], why="Failed the check")
                )
        rows.sort(key=lambda r: r["frame"])
        return rows

    @staticmethod
    def stake_counts(log):
        """Appearances are counted once: a card coming on from nothing. Full counts each rise to the full level."""
        prev, faint, full = {}, 0, 0
        for _, pid, lvl, _ in log:
            was = prev.get(pid, 0)
            faint += was == 0 and lvl >= 1
            full += lvl == 2 and was < 2
            prev[pid] = lvl
        return dict(appearances=faint, full=full, players=sorted({x[1] for x in log}))

    # ----- what the run leaves behind -----
    def finish(self, wall_s):
        mid = self.run.meta["match_id"]
        self.run.ledger.commit()
        cues = self.run.ledger.cues(mid)
        with open(os.path.join(self.run.out, "cues.jsonl"), "w") as f:
            for c in cues:
                f.write(json.dumps(c, default=float) + "\n")
        with open(os.path.join(self.run.out, "facts.jsonl"), "w") as f:
            for x in self.run.ledger.facts(mid, 1e9):
                f.write(json.dumps(x, default=float) + "\n")
        with open(os.path.join(self.run.work, "audit.jsonl"), "w") as f:
            for t, k, b in self.run.ledger.audit_rows():
                f.write(json.dumps(dict(match_time=t, kind=k, **b), default=float) + "\n")
        md = self.run.md
        write_json(os.path.join(self.run.out, "scenes.json"), self.scenes(cues), default=float)
        write_json(os.path.join(self.run.out, "match.json"), self.match_view(cues), default=float)
        forms = {}
        for c in cues:
            forms[c["form"]] = forms.get(c["form"], 0) + 1
        levels = list(self.run.reflex.stake_log)
        fm = np.array(self.run.frame_ms) if self.run.frame_ms else np.zeros(1)
        summary = dict(
            match_id=mid,
            final_score=self.run.reflex.score,
            frames=len(md["clock"]),
            events_read=len(md["events"]),
            cues_by_form=forms,
            things_shown=self.run.cues.shown,
            held_back=self.run.cues.held,
            facts=len(self.run.ledger.facts(mid, 1e9)),
            stake_cards=self.stake_counts(levels),
            verifier_rejections=len(self.run.ledger.audit_rows("verifier_rejected")),
            frame_ms=dict(
                p50=round(float(np.percentile(fm, 50)), 3),
                p95=round(float(np.percentile(fm, 95)), 3),
                p99=round(float(np.percentile(fm, 99)), 3),
                max=round(float(fm.max()), 1),
            ),
            writer_ms=[round(x * 1000, 2) for x in self.run.writer.timings],
            wall_seconds=round(wall_s, 1),
            writer_backend=self.run.writer.backend.name,
            stake_model=dict(
                faint=self.run.reflex.model.faint,
                full=self.run.reflex.model.full,
            ),
        )
        write_json(os.path.join(self.run.out, "summary.json"), summary, indent=1, default=float)
        return summary
