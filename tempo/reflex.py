"""Reflex service: everything that must be decided inside a tracking frame, in plain code plus one small network.

It keeps a ledger for each player, scores the stake model for players near the ball, runs the two-level card for anyone
carrying a booking, turns events into facts, and reports the moments the slower writing path should look at. It reads
frames strictly in order and never looks ahead."""

import math

import numpy as np

from . import twin as twinmod
from .contracts import Q_SECOND_YELLOW, Q_YELLOW, TYPE, fact
from .ghost import Ghost
from .stake.features import HIST, HZ, STEP, window_features
from .stake.model import CardState

PRESS_S = 300  # a pressure change compares the last five minutes with the five before


def win_chance(score, minutes_left, rate=1.35 / 90):
    """Home win, draw, away win from the score and the time left, with independent Poisson goals."""
    lam = max(minutes_left, 0) * rate
    p = [math.exp(-lam) * lam**k / math.factorial(k) for k in range(8)]
    out = [0.0, 0.0, 0.0]
    for a in range(8):
        for b in range(8):
            d = score[0] + a - score[1] - b
            out[0 if d > 0 else 1 if d == 0 else 2] += p[a] * p[b]
    return [round(x, 3) for x in out]


class Reflex:
    def __init__(self, md_meta, team, ledger, cues, model, baselines=None, search=None):
        self.meta, self.team, self.ledger, self.cues, self.model = md_meta, team, ledger, cues, model
        self.match_id, self.ids = md_meta["match_id"], md_meta["ids"]
        self.base = baselines or {}
        self.search = search or twinmod.TwinSearch()
        self.ghost = Ghost() if Ghost.available() else None
        n = len(self.ids)
        self.buf_pos = np.full((n, HIST, 2), np.nan)
        self.buf_ball = np.zeros((HIST, 3))
        self.buf_live = np.zeros(HIST, bool)
        self.buf_poss = np.full(HIST, -1)
        self.filled = 0
        self.frame_no = -1
        self.cards = {}  # player index -> CardState, for players carrying a booking
        self.card_fact = {}  # player index -> fact id of the booking
        self.level = {}
        self.dist = np.zeros(n)
        self.fast = np.zeros(n)
        self.top = np.zeros(n)
        self.minutes = np.zeros(n)
        self.prev = None
        self.score = [0, 0]
        self.mom = 0.0
        self.last_turn = -1e9
        self.mom_hist = []
        # one entry a second for the last ten minutes: 0 ball dead, 1 in the away half, 2 in the home half
        self.terr = []
        self.high_wins = []  # (time, team) for each ball won in the other team's half
        self.duels = {}  # (defender, attacker) -> [defender wins, attacker wins]
        self.pending_duel = None
        self.shots = []  # frames kept for twin search
        self.last_event_time = -1.0
        self.stake_log = []  # (time, player, level, chance): for evaluation

    # ----- recovery -----
    def snapshot(self):
        return dict(
            frame_no=self.frame_no,
            score=self.score,
            dist=self.dist.tolist(),
            fast=self.fast.tolist(),
            top=self.top.tolist(),
            minutes=self.minutes.tolist(),
            mom=self.mom,
            last_turn=self.last_turn,
            terr=self.terr,
            high_wins=self.high_wins,
            duels={f"{a}|{b}": v for (a, b), v in self.duels.items()},
            card_fact={str(k): v for k, v in self.card_fact.items()},
            level={str(k): v for k, v in self.level.items()},
            cards={
                str(k): dict(
                    level=c.level,
                    since=c.since,
                    below=c._below,
                    last=c._last_t,
                    prev_hi=c._prev_hi,
                    full_since=c._full_since,
                )
                for k, c in self.cards.items()
            },
        )

    def restore(self, s, frames, upto):
        """Reload a snapshot and refill the frame window from the feed log, which is how a restarted replica catches
        up."""
        self.frame_no, self.score = s["frame_no"], list(s["score"])
        self.dist, self.fast, self.top, self.minutes = (np.array(s[k]) for k in ("dist", "fast", "top", "minutes"))
        self.mom, self.last_turn = s["mom"], s["last_turn"]
        self.terr, self.high_wins = list(s["terr"]), [tuple(x) for x in s["high_wins"]]
        self.duels = {tuple(int(x) for x in k.split("|")): v for k, v in s["duels"].items()}
        self.card_fact = {int(k): v for k, v in s["card_fact"].items()}
        self.level = {int(k): v for k, v in s["level"].items()}
        for k, c in s["cards"].items():
            st = CardState(self.model.faint, self.model.full)
            st.level, st.since, st._below, st._last_t, st._prev_hi, st._full_since = (
                c["level"],
                c["since"],
                c["below"],
                c["last"],
                c["prev_hi"],
                c["full_since"],
            )
            self.cards[int(k)] = st
        lo = max(upto - HIST + 1, 0)
        for i in range(lo, upto + 1):
            self._push(frames["pos"][i], frames["ball"][i], frames["live"][i], frames["poss"][i])
        self.prev = frames["pos"][upto].copy()

    def _push(self, pos, ball, live, poss):
        self.buf_pos[:, :-1] = self.buf_pos[:, 1:]
        self.buf_pos[:, -1] = pos
        self.buf_ball[:-1] = self.buf_ball[1:]
        self.buf_ball[-1] = ball
        self.buf_live[:-1] = self.buf_live[1:]
        self.buf_live[-1] = live
        self.buf_poss[:-1] = self.buf_poss[1:]
        self.buf_poss[-1] = poss
        self.filled = min(self.filled + 1, HIST)

    # ----- one tracking frame -----
    def on_frame(self, i, t, period, pos, ball, live, poss, home_dir):
        self.frame_no = i
        self._push(pos, ball, live, poss)
        moments = []
        if self.prev is not None and live:
            step = np.nan_to_num(np.linalg.norm(pos - self.prev, axis=1))
            sp = step * HZ
            ok = sp < 12  # a jump in the feed is not a sprint
            self.dist += np.where(ok, step, 0)
            self.fast += np.where(ok & (sp > 5.5), step, 0)
            self.top = np.maximum(self.top, np.where(ok, sp, 0))
            self.minutes += (~np.isnan(pos[:, 0])) / HZ / 60
        self.prev = pos.copy()
        if i % HZ == 0:  # momentum, once a second
            if live:
                self.mom += ((ball[0] * home_dir) / 52.5 - self.mom) / 240.0
            self.terr.append(0 if not live else 1 if ball[0] * home_dir > 0 else 2)
            del self.terr[: -2 * PRESS_S]
            if i % (HZ * 15) == 0:
                self.mom_hist.append((round(t, 1), round(self.mom, 3)))
            if i % (HZ * 15) == 0 and t - self.last_turn > 600:  # a change of pressure, looked for four times a minute
                m = self._pressure(t, 0) or self._pressure(t, 1)
                if m:
                    moments.append(m)
                    self.last_turn = t
        if self.cards and i % STEP == 0 and self.filled == HIST:
            own = np.array([-home_dir * 52.5, home_dir * 52.5])
            idx, feats, dist = window_features(
                self.buf_pos, self.buf_ball, self.team, own, self.buf_poss, self.buf_live
            )
            scores = dict(zip(idx.tolist(), self.model.score(feats).tolist())) if len(idx) else {}
            for p, st in self.cards.items():
                if np.isnan(pos[p, 0]):
                    continue
                s = scores.get(p)
                lvl = st.update(t, s)
                if lvl != self.level.get(p, 0):
                    self._card_change(t, p, lvl, s)
        return moments

    def _pressure(self, t, team):
        """A change of pressure towards `team`: at least 70 in 100 of the play in the other team's half over the last
        five minutes, and at least 30 more than in the five before. Everything here is behind `t`, so nothing is read
        ahead."""
        want = 1 if team == 0 else 2  # the code for the half this team attacks
        now, before = self.terr[-PRESS_S:], self.terr[-2 * PRESS_S : -PRESS_S]
        live_now, live_before = sum(1 for x in now if x), sum(1 for x in before if x)
        if (
            len(before) < PRESS_S or live_now < 120 or live_before < 120
        ):  # too little play in one of the two windows to compare
            return None
        a, b = (
            round(100 * sum(1 for x in now if x == want) / live_now),
            round(100 * sum(1 for x in before if x == want) / live_before),
        )
        if a < 70 or a - b < 30:
            return None
        won = sum(1 for wt, wteam in self.high_wins if wteam == team and t - wt <= PRESS_S)
        tid = (self.meta["home"], self.meta["away"])[team]["id"]
        f = self.ledger.put_fact(
            fact(
                self.match_id,
                t,
                "pressure",
                tid,
                a,
                "in 100 of play in the other half",
                before=b,
                window_min=PRESS_S // 60,
                won_high=won,
            )
        )
        self.cues.propose(
            t,
            "pressure",
            "tv",
            dict(team=team, now=a, before=b, window_min=PRESS_S // 60, won_high=won),
            [f["fact_id"]],
            valid_for=6.0,
            priority=3,
        )
        return dict(kind="pressure", t=t, fact_ids=[f["fact_id"]], team=team, now=a, before=b, won_high=won)

    def _reason(self, t, m, frames_view, shot_frame, team, home_dir):
        """The reason rule. Three instruments that do not share a method have to point at the same defender: the earlier
        attempt (he stood differently then), the ghost (he is further off the ball than an average defender), and the
        ledger (a yellow card from before the goal). The ghost says who and cannot say whether, so it never names a
        reason alone."""
        if self.ghost is None or frames_view is None or shot_frame is None:
            return
        off = self.ghost.at_shot(frames_view, self.meta["keepers"], shot_frame, team, home_dir)
        off = {i: v for i, v in off.items() if v > 0}
        if not off:
            return
        top = max(off, key=off.get)
        o = self.ghost.meta["ordinary_top_standoff_m"]
        g = self.ledger.put_fact(
            fact(
                self.match_id,
                t,
                "ghost_standoff",
                self.ids[top],
                round(off[top], 1),
                "m further from the ball than an average defender",
                ordinary_median=o["median"],
                ordinary_p90=o["p90"],
            )
        )
        m["fact_ids"] = m["fact_ids"] + [g["fact_id"]]
        m["ghost"] = g
        ca = m.get("closest_attempt")
        if ca and ca["differing_player"] == self.ids[top] and top in self.card_fact:
            r = self.ledger.put_fact(
                fact(
                    self.match_id,
                    t,
                    "reason",
                    self.ids[top],
                    3,
                    "instruments agree",
                    instruments=[ca["fact_id"], g["fact_id"], self.card_fact[top]],
                )
            )
            m["fact_ids"] = m["fact_ids"] + [r["fact_id"], self.card_fact[top]]
            m["reason"] = r
        else:
            self.ledger.audit(
                t,
                "held_back",
                dict(
                    form="reason",
                    reason="the three instruments do not point at one player",
                    ghost=self.ids[top],
                    earlier_attempt=ca["differing_player"] if ca else None,
                    booked=top in self.card_fact,
                ),
            )

    def _card_change(self, t, p, lvl, s):
        self.level[p] = lvl
        ids = [self.card_fact[p]]
        if lvl:
            f = self.ledger.put_fact(
                fact(
                    self.match_id,
                    t,
                    "challenge_chance",
                    self.ids[p],
                    round(float(s or 0), 3),
                    "chance in the next 1.5 s",
                )
            )
            ids.append(f["fact_id"])
        self.cues.propose(
            t,
            "stake_card",
            "tv",
            dict(player=self.ids[p], level=lvl, chance=round(float(s or 0), 3), stake="one foul from a red card"),
            ids,
            valid_for=3.0,
            priority=7,
        )
        self.stake_log.append((t, self.ids[p], lvl, float(s or 0)))

    # ----- one event -----
    def on_event(self, e, frames_view=None, shot_frame=None, home_dir=1.0):
        t, typ = e["matchTime"], e["typeId"]
        moments = []
        pid = e["playerId"]
        p = self.ids.index(pid) if pid in self.ids else None
        q = {x["qualifierId"]: x["value"] for x in e.get("qualifier", [])}
        if typ == TYPE["deleted"]:  # the feed takes an event back
            for fid in e.get("deletes_fact_ids", []):
                self.cues.withdraw(t, fid)
                for k, v in list(self.card_fact.items()):
                    if v == fid:
                        self.cards.pop(k, None)
                        self.card_fact.pop(k, None)
                        if self.level.pop(k, 0):
                            self.cues.propose(
                                t,
                                "stake_card",
                                "tv",
                                dict(player=self.ids[k], level=0, chance=0.0, stake="withdrawn"),
                                [],
                                priority=9,
                            )
            return moments
        if (
            typ in (TYPE["tackle"], TYPE["interception"], TYPE["ball_recovery"])
            and e["outcome"] == 1
            and e["x"] > 50
            and p is not None
        ):
            self.high_wins.append((t, int(self.team[p])))
            self.high_wins = [w for w in self.high_wins if t - w[0] <= 2 * PRESS_S]
        if typ == TYPE["card"]:
            colour = "yellow" if Q_YELLOW in q else "second_yellow" if Q_SECOND_YELLOW in q else "red"
            f = self.ledger.put_fact(fact(self.match_id, t, "card", pid, colour, "", sources=[e["id"]]))
            if colour == "yellow":
                self.cards[p] = CardState(self.model.faint, self.model.full)
                self.card_fact[p] = f["fact_id"]
            else:
                self.cards.pop(p, None)
            moments.append(dict(kind="card", t=t, fact_ids=[f["fact_id"]], player=pid, team=int(self.team[p])))
        elif typ in (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"]):
            speed = q.get(322)
            ids = []
            if speed is not None:
                pct = self._percentile("shot_speed", speed)
                f = self.ledger.put_fact(
                    fact(self.match_id, t, "shot_speed", pid, speed, "km/h", percentile=pct, sources=[e["id"]])
                )
                ids.append(f["fact_id"])
                if pct is not None and pct >= 95:
                    self.cues.propose(
                        t + 1.0,
                        "tag",
                        "tv",
                        dict(
                            player=pid,
                            text=f"{speed:.0f} km/h",
                            note=f"faster than {min(pct, 99):.0f} in 100 shots this season",
                            value=round(float(speed), 1),
                            unit="km/h",
                            **self._scale("shot_speed", 95),
                        ),
                        [f["fact_id"]],
                        valid_for=3.0,
                        priority=4,
                    )
            outcome = "goal" if typ == TYPE["goal"] else "no_goal"
            tw = None
            if frames_view is not None and shot_frame is not None:
                team = int(self.team[p])
                d = home_dir if team == 0 else -home_dir
                start = twinmod.attack_start(frames_view["live"], frames_view["poss"], shot_frame)
                vec = twinmod.attack_vector(frames_view, start, shot_frame, team, d, self.meta["keepers"])
                if vec is not None:
                    if typ == TYPE["goal"]:
                        tw = self.search.closest_earlier(vec, team, self.match_id, t, outcome)
                    self.search.add(vec, team, self.match_id, t, outcome, meta=dict(player=pid, frame=shot_frame))
            if typ == TYPE["goal"]:
                team = int(self.team[p])
                self.score[team] += 1
                f = self.ledger.put_fact(
                    fact(self.match_id, t, "goal", pid, list(self.score), "score", sources=[e["id"]])
                )
                ids.append(f["fact_id"])
                m = dict(kind="goal", t=t, fact_ids=ids, player=pid, team=team, frame=shot_frame)
                if tw and tw.get("found"):
                    o = tw["earlier"]
                    f2 = self.ledger.put_fact(
                        fact(
                            self.match_id,
                            t,
                            "closest_attempt",
                            pid,
                            round(tw["gap_m"], 1),
                            "m average gap",
                            earlier_time=o["t"],
                            earlier_match=o["match_id"],
                            earlier_frame=o["meta"].get("frame"),
                            differing_player=self.ids[tw["biggest_difference"]],
                            differing_by_m=round(tw["biggest_difference_m"], 1),
                            earlier_player=self.ids[tw["earlier_player"]],
                            n_differing=tw["n_differing"],
                            parting_s=tw["parting_s"],
                            closer_than=round(tw["closer_than"], 3),
                        )
                    )
                    m["fact_ids"] = ids + [f2["fact_id"]]
                    m["closest_attempt"] = f2
                elif tw:
                    self.ledger.audit(
                        t, "no_twin", dict(gap_m=round(tw["gap_m"], 1), closer_than=round(tw["closer_than"], 3))
                    )
                self._reason(t, m, frames_view, shot_frame, team, home_dir)
                moments.append(m)
        elif typ == TYPE["pass"]:
            d = q.get(212)
            if d is not None and e["outcome"] == 1:
                pct = self._percentile("pass_distance", d)
                if pct is not None and pct >= 99.5:
                    f = self.ledger.put_fact(
                        fact(self.match_id, t, "pass_distance", pid, d, "m", percentile=pct, sources=[e["id"]])
                    )
                    self.cues.propose(
                        t + 1.0,
                        "tag",
                        "tv",
                        dict(
                            player=pid,
                            text=f"{d:.0f} m pass",
                            note=f"longer than {min(pct, 99):.0f} in 100 completed passes",
                            value=round(float(d), 1),
                            unit="m",
                            **self._scale("pass_distance", 99.5),
                        ),
                        [f["fact_id"]],
                        valid_for=3.0,
                        priority=3,
                    )
        elif typ in (TYPE["tackle"], TYPE["challenge"]):
            self.pending_duel = (t, p, typ == TYPE["tackle"] and e["outcome"] == 1, e["id"])
        elif typ == TYPE["take_on"] and self.pending_duel and abs(self.pending_duel[0] - t) < 0.05 and p is not None:
            _, dfn, won, src = self.pending_duel
            self.pending_duel = None
            rec = self.duels.setdefault((dfn, p), [0, 0])
            rec[0 if won else 1] += 1
            if sum(rec) in (4, 8, 12):  # worth a mention when two players keep meeting, and not every time
                f = self.ledger.put_fact(
                    fact(
                        self.match_id,
                        t,
                        "duel_count",
                        f"{self.ids[dfn]}|{self.ids[p]}",
                        list(rec),
                        "defender wins, attacker wins",
                        sources=[src, e["id"]],
                    )
                )
                self.cues.propose(
                    t + 1.5,
                    "duel",
                    "tv",
                    dict(defender=self.ids[dfn], attacker=self.ids[p], defender_won=rec[0], attacker_won=rec[1]),
                    [f["fact_id"]],
                    valid_for=3.0,
                    priority=3,
                )
        return moments

    def _percentile(self, kind, value):
        ref = self.base.get(kind)
        return None if ref is None else float(np.mean(np.asarray(ref) <= value) * 100)

    def _scale(self, kind, rare_pct):
        """What is usual for this measure in the season so far, and the value at which it counts as rare. A front end
        draws the new value against these two marks, so nobody has to read a percentile."""
        ref = np.asarray(self.base[kind], float)
        return dict(usual=round(float(np.median(ref)), 1), rare=round(float(np.percentile(ref, rare_pct)), 1))

    def running_facts(self, t):
        """Each player's running so far, against the season's usual for his position. Plain numbers, no claim about
        tiredness."""
        out = []
        usual = self.base.get("distance_per_minute")
        for p, pid in enumerate(self.ids):
            if self.minutes[p] < 5:
                continue
            per = self.dist[p] / self.minutes[p]
            pct = None if usual is None else float(np.mean(np.asarray(usual) <= per) * 100)
            out.append(
                self.ledger.put_fact(
                    fact(
                        self.match_id,
                        t,
                        "running",
                        pid,
                        round(per, 1),
                        "m per minute in play",
                        percentile=pct,
                        fast_m=round(float(self.fast[p])),
                        top_speed=round(float(self.top[p]), 1),
                    )
                )
            )
        return out
