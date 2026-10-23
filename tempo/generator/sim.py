"""Match generator. Simulates 22 players and a ball at 25 frames a second and logs events as a data provider would.

It is a behaviour model, written to be checked against real football: tempo/eval/realism.py runs the stake model,
trained on real tracking, over its output. Everything it emits is synthetic. Clubs and players are fictional."""

import math
from typing import TYPE_CHECKING, Any

import numpy as np

from ..constants import HZ, PX, PY
from ..contracts import Q_SECOND_YELLOW, Q_YELLOW, event
from . import league as league_mod

if TYPE_CHECKING:
    from .story import Attack

DT = 1.0 / HZ
G = 9.81
# 4-3-3 anchors: x from own goal (0) to most advanced (1), y from the team's right (-0.5) to left (0.5)
ANCHOR = np.array(
    [
        [0.03, 0],
        [0.25, -0.38],
        [0.20, -0.13],
        [0.20, 0.13],
        [0.25, 0.38],
        [0.42, 0],
        [0.52, -0.2],
        [0.52, 0.2],
        [0.78, -0.36],
        [0.85, 0],
        [0.78, 0.36],
    ]
)
NUMBERS = [1, 2, 5, 4, 3, 6, 8, 10, 7, 9, 11]
HOME: dict[str, Any] = dict(
    id="t_nor",
    name="Northgate",
    short="NOR",
    names=["Pell", "Adeyemi", "Brandt", "Soto", "Ferrand", "Hale", "Kessler", "Roonay", "Okoye", "Marek", "Ilves"],
    name_ar="نورثغيت",
    names_ar=["بيل", "أديمي", "برانت", "سوتو", "فيران", "هيل", "كيسلر", "روناي", "أوكويي", "ماريك", "إلفيس"],
)
AWAY: dict[str, Any] = dict(
    id="t_har",
    name="Harbour City",
    short="HAR",
    names=["Quist", "Renner", "Baro", "Novak", "Varga", "Skoles", "Dorn", "Ashby", "Tully", "Lund", "Maro"],
    name_ar="هاربر سيتي",
    names_ar=["كويست", "رينر", "بارو", "نوفاك", "فارغا", "سكولز", "دورن", "آشبي", "تولي", "لوند", "مارو"],
)


def squads():
    out = []
    for team in (HOME, AWAY):
        out.append(
            [
                dict(playerId=f"p_{team['short'].lower()}_{n}", number=n, name=nm, name_ar=ar, team=team["id"])
                for n, nm, ar in zip(NUMBERS, team["names"], team["names_ar"], strict=True)
            ]
        )
    return out


BODY = 0.7  # metres between two players' centres when they are in contact


class Sim:
    def __init__(self, seed=7, match_id="m_demo", story=None, minutes=90, league=True):
        self.rng = np.random.default_rng(seed)
        self.match_id, self.story, self.minutes = match_id, story, minutes
        self.squads = squads()
        self.ids = [p["playerId"] for s in self.squads for p in s]
        self.team = np.array([0] * 11 + [1] * 11)
        self.vmax = np.clip(self.rng.normal(8.7, 0.5, 22), 7.6, 9.8)
        self.vmax[[0, 11]] = 7.0
        self.aggr = np.clip(self.rng.normal(1.0, 0.25, 22), 0.5, 1.6)
        self.careful = np.full(22, league_mod.CAREFUL)
        self.league = league
        if league:  # the same players every match, with their club's habits (league.py)
            self.vmax, self.aggr, self.careful = league_mod.players(self.ids)
        self.booked = np.zeros(22, bool)
        self.off = np.zeros(22, bool)  # sent off
        self.score = [0, 0]
        self.events, self.commentary, self.seq = [], [], 0
        self.frames = []  # (period, clock, live, poss, ball x y z, positions 22x2) as arrays
        self.noise = np.zeros((22, 2))
        self.pos = np.zeros((22, 2))
        self.vel = np.zeros((22, 2))
        self.stun = np.zeros(22)  # seconds a player who has just lost a challenge is slow to react
        self.down = np.zeros(22)  # seconds a fouled player stays on the ground
        self.fx = np.random.default_rng(
            seed + 7919
        )  # its own stream, so what a body does after contact never shifts the match's decisions
        self.script: Attack | None = None  # the attack a storyline is staging, while it runs
        self.bvz = 0.0  # the ball's vertical speed
        self.controlled = False  # the man on the ball has it at his feet
        self.ctl = []  # per frame: (state, player on the ball or about to receive it)
        self.force_presser = None  # a defender the storyline sends into the next challenge

    def wary(self, p):
        """A player who turns careful on a yellow card (league.py): he stands off and stays out of challenges."""
        return bool(self.league and self.booked[p] and self.careful[p] < 0.5)

    # ---------- geometry ----------
    def own_goal(self, t):
        return np.array([-self.dir[t] * PX, 0.0])

    def opp_goal(self, t):
        return np.array([self.dir[t] * PX, 0.0])

    def shape(self, t, in_poss):
        d = self.dir[t]
        bxm = self.ball[0] * d + PX  # ball distance from own goal line
        c = np.clip(0.62 * bxm + 14, 22, 72) if in_poss else np.clip(0.55 * bxm + 8, 16, 60)
        span, width, shift = (58, 56, 0.3) if in_poss else (40, 36, 0.62)
        idx = np.flatnonzero(self.team == t)
        a = ANCHOR
        xm = c + (a[:, 0] - 0.5) * span
        ym = a[:, 1] * width + shift * (self.ball[1] * d)
        xm[0] = np.clip(5 + 0.08 * bxm, 4, 16)
        ym[0] = 0.15 * self.ball[1] * d
        tgt = np.stack([(-PX + xm) * d, ym * d], 1)
        return idx, np.clip(tgt, [-PX + 1, -PY + 1], [PX - 1, PY - 1])

    def nearest(self, point, team=None, exclude=()):
        d = np.hypot(*(self.pos - point).T)
        d[self.off] = 1e9
        if team is not None:
            d[self.team != team] = 1e9
        for e in exclude:
            d[e] = 1e9
        return int(np.argmin(d)), float(np.min(d))

    # ---------- logging ----------
    def log(self, kind, player, outcome=1, qualifiers=None, **extra):
        t = int(self.team[player])
        d = self.dir[t]
        x = (self.pos[player, 0] * d + PX) / 105 * 100
        y = (self.pos[player, 1] * d + PY) / 68 * 100
        self.seq += 1
        e = event(
            self.match_id,
            self.seq,
            kind,
            self.period,
            self.clock,
            (HOME, AWAY)[t]["id"],
            self.ids[player],
            x,
            y,
            outcome,
            qualifiers,
            **extra,
        )
        self.events.append(e)
        return e

    # ---------- the ball as an object ----------
    def roll(self):
        """One frame of a free ball. In the air it falls under gravity and bounces, losing height and pace each time.
        On the turf it rolls and slows: a pass loses about a quarter of its speed each second, then stops."""
        if getattr(self, "_rolled", None) == self.clock:  # once a frame, whatever state changes in it
            return
        self._rolled = self.clock
        b = self.ball
        if b[2] > 0.115 or self.bvz > 0.4:
            self.bvz -= G * DT
            b[:2] += self.bvel * DT
            b[2] += self.bvz * DT
            self.bvel *= 1 - 0.05 * DT
            if b[2] <= 0.11:
                b[2] = 0.11
                if self.bvz < -1.5:
                    self.bvz = -self.bvz * 0.55
                    self.bvel *= 0.8
                else:
                    self.bvz = 0.0
        else:
            b[2] = 0.11
            self.bvz = 0.0
            v = float(np.linalg.norm(self.bvel))
            if v > 0:
                self.bvel *= max(0.0, v - (0.25 * v + 0.9) * DT) / v
            b[:2] += self.bvel * DT

    @staticmethod
    def ground_kick(d, arrive):
        """How hard to strike a ball along the ground so that it covers d metres and is still doing `arrive` m/s when it
        gets there. Returns the speed off the boot and the time it takes."""
        lo, hi = arrive, 42.0
        for _ in range(16):
            v0 = (lo + hi) / 2
            v, run, t = v0, 0.0, 0.0
            while run < d and v > 0.05 and t < 9:
                v -= (0.25 * v + 0.9) * DT
                run += v * DT
                t += DT
            if run < d or v < arrive:
                lo = v0
            else:
                hi = v0
        v, run, t = hi, 0.0, 0.0
        while run < d and v > 0.05 and t < 9:
            v -= (0.25 * v + 0.9) * DT
            run += v * DT
            t += DT
        return hi, t

    # ---------- ball states ----------
    def give(self, p, timer=None):
        self.state, self.carrier, self.poss = "carried", p, int(self.team[p])
        self.timer = timer if timer is not None else self.rng.uniform(0.6, 2.2)
        self.heading = self.opp_goal(self.team[p]) - self.pos[p]
        self.heading /= np.linalg.norm(self.heading) + 1e-9
        self.dribble_speed = self.rng.uniform(2.5, 5.5)
        self.committed = None
        self.bvel = self.vel[p] + 0.2 * (self.bvel - self.vel[p])
        self.bvz = 0.0  # a first touch takes most of the pace off it

    def dead(self, kind, spot, team, seconds, taker=None, has=False):
        """Play stops. The ball is not moved: it carries on rolling, and the taker fetches it and brings it to the
        spot."""
        self.state = "dead"
        self.restart = dict(
            kind=kind,
            team=team,
            taker=taker,
            spot=np.clip(np.asarray(spot, float), [-PX, -PY], [PX, PY]),
            since=self.clock,
            has=has,
        )
        self.resume_at = self.clock + seconds
        self.committed = None

    def pass_to(self, p, q, forced=False):
        dist = np.linalg.norm(self.pos[q] - self.pos[p])
        lofted = dist > 28 and not forced  # a long ball is chipped; the rest go along the ground
        pace = float(np.clip(5.5 + 0.12 * dist, 6, 10))  # how fast it should still be moving when it gets there
        if lofted:
            th = math.radians(self.rng.uniform(20, 28))
            v0 = math.sqrt(dist * G / math.sin(2 * th)) * 1.02
            hs, vz, tof = v0 * math.cos(th), v0 * math.sin(th), 2 * v0 * math.sin(th) / G
        else:
            hs, tof = self.ground_kick(dist, pace)
            vz = 0.0
        lead = self.pos[q] + self.vel[q] * tof * 0.6
        vec = lead - self.ball[:2]
        if not forced:
            vec += self.rng.normal(0, 0.035 * dist + 0.25, 2)  # execution error grows with distance
        L = float(np.linalg.norm(vec)) + 1e-9
        if not lofted:
            hs, tof = self.ground_kick(L, pace)
        self.state, self.receiver, self.passer = "pass", q, p
        self.bvel = vec / L * hs
        self.bvz = vz
        self.arrive_at = self.clock + tof
        self.loft = 1.0 if lofted else 0.0
        self.t_pass, self.tof = self.clock, tof
        self.interceptor = None
        if not forced:  # can an opponent get to the lane first?
            opp = np.flatnonzero((self.team != self.team[p]) & ~self.off)
            a = self.ball[:2]
            ab = vec
            L2 = ab @ ab + 1e-9
            s = np.clip(((self.pos[opp] - a) @ ab) / L2, 0.15, 0.95)
            foot = a + s[:, None] * ab
            reach = np.hypot(*(self.pos[opp] - foot).T) / 6.5 + 0.35
            ok = reach < s * tof
            if ok.any() and self.loft == 0 and self.rng.random() < 0.55:
                k = int(np.argmin(np.where(ok, reach, 1e9)))
                self.interceptor, self.intercept_at = int(opp[k]), foot[k]
        self.log("pass", p, outcome=0 if self.interceptor is not None else 1, qualifiers={212: round(float(dist), 1)})

    def shoot(self, p, forced=None, power=None):
        goal = self.opp_goal(self.team[p])
        dist = np.linalg.norm(goal - self.pos[p])
        ang = abs(math.atan2(abs(self.pos[p, 1]), max(PX - abs(self.pos[p, 0]), 0.5)))
        xg = 0.62 * math.exp(-dist / 8.5) * (1 - 0.55 * min(ang / 1.2, 1))
        _, press = self.nearest(self.pos[p], team=1 - self.team[p])
        if press < 2.0:
            xg *= 0.6
        r = self.rng.random()
        outcome = forced or (
            "goal"
            if r < xg
            else "saved"
            if r < xg + (1 - xg) * 0.45
            else "wide"
            if r < xg + (1 - xg) * 0.8
            else "blocked"
        )
        t = int(self.team[p])
        gk = 11 * (1 - t)
        if outcome == "goal":  # inside the posts, away from the keeper
            side = -np.sign(self.pos[gk, 1]) or self.rng.choice([-1, 1])
            aim, h = goal + np.array([0, side * self.rng.uniform(1.6, 3.2)]), self.rng.uniform(0.3, 1.9)
        elif outcome == "saved":  # at the keeper, or near enough for him to reach
            aim, h = self.pos[gk] + np.array([0.0, self.rng.uniform(-0.5, 0.5)]), self.rng.uniform(0.4, 1.5)
        elif outcome == "wide":  # past a post or over the bar
            over = self.rng.random() < 0.35
            aim = goal + np.array(
                [0, self.rng.uniform(-3, 3) if over else self.rng.uniform(4.6, 9) * self.rng.choice([-1, 1])]
            )
            h = self.rng.uniform(3.0, 5.5) if over else self.rng.uniform(0.3, 2.2)
        else:  # into the nearest defender in its path
            self.blocker = self.nearest(self.pos[p] + (goal - self.pos[p]) * 0.3, team=1 - t, exclude=[gk])[0]
            aim, h = self.pos[self.blocker].copy(), self.rng.uniform(0.3, 1.1)
        vec = aim - self.ball[:2]
        L = float(np.linalg.norm(vec)) + 1e-9
        speed = self.rng.uniform(22, 29)
        if power:  # a story may say how hard this one is struck
            speed = power
        tof = L / speed
        self.state, self.shooter, self.shot_outcome = "shot", p, outcome
        self.bvel = vec / L * speed
        self.bvz = (h - self.ball[2] + 0.5 * G * tof * tof) / tof  # struck to be at height h when it gets there
        self.arrive_at = self.clock + tof
        self.loft = 0.8
        self.t_pass, self.tof = self.clock, tof
        kind = {"goal": "goal", "saved": "attempt_saved", "wide": "miss", "blocked": "attempt_saved"}[outcome]
        self.log(
            kind,
            p,
            qualifiers={
                321: round(float(xg), 3),
                322: round(float(np.linalg.norm(self.bvel) * 3.6), 1),
                **({82: 1} if outcome == "blocked" else {}),
            },
        )

    # ---------- decisions ----------
    def decide(self):
        p = self.carrier
        t = int(self.team[p])
        if self.script and self.script.carrier_decision(self, p):
            return
        goal = self.opp_goal(t)
        dist_goal = np.linalg.norm(goal - self.pos[p])
        _, press = self.nearest(self.pos[p], team=1 - t)
        if dist_goal < 30 and abs(self.pos[p, 1]) < 24:
            xg = 0.62 * math.exp(-dist_goal / 8.5)
            room = 1.0
            if self.league:  # tired legs do not get out to the man on the ball: more attacks end in a shot
                gone = 1 - float(league_mod.legs(self.team, self.clock)[self.team == 1 - t].mean())
                room += league_mod.SHOT_ROOM * gone * 10
            if self.rng.random() < np.clip((3.4 * xg + 0.06) * room, 0, 0.9):
                return self.shoot(p)
        d = self.dir[t]
        deep = (self.pos[p, 0] - self.own_goal(t)[0]) * d < 38
        if not self.script and press < 3.0 and self.rng.random() < (0.30 if deep else 0.10):
            # under pressure he puts his foot through it, up the line; it often runs out of play
            side = np.sign(self.pos[p, 1]) or self.rng.choice([-1, 1])
            v = np.array([d * self.rng.uniform(0.5, 1.0), side * self.rng.uniform(0.5, 1.1)])
            v /= np.linalg.norm(v)
            self.log("clearance", p)
            self.bvel = v * self.rng.uniform(16, 24)
            self.bvz = self.rng.uniform(5, 9)
            self.state = "loose"
            self.committed = None
            return
        mates = [q for q in np.flatnonzero((self.team == t) & ~self.off) if q != p]
        best, scores = [], []
        for q in mates:
            v = self.pos[q] - self.pos[p]
            L = np.linalg.norm(v)
            if L < 4 or L > 45:
                continue
            _, open_ = self.nearest(self.pos[q], team=1 - t)
            prog = v[0] * d
            middle = 0.0
            if (
                self.league and prog > 0
            ):  # a side that plays through the middle looks for the man in the central channel
                middle = league_mod.CLUB[int(t)]["through_middle"] * max(0.0, 1 - abs(self.pos[q, 1]) / 18)
            scores.append(
                0.045 * prog
                + 0.16 * min(open_, 8)
                - 0.02 * L
                + (0.0 if q % 11 else -1.5)
                + middle
                + self.rng.gumbel() * 0.55
            )
            best.append(q)
        p_pass = 0.86 if press < 3.0 else 0.62
        if best and self.rng.random() < p_pass:
            return self.pass_to(p, best[int(np.argmax(scores))])
        ang = self.rng.normal(0, 0.5)  # carry it
        g = goal - self.pos[p]
        g /= np.linalg.norm(g) + 1e-9
        c, s = math.cos(ang), math.sin(ang)
        self.heading = np.array([g[0] * c - g[1] * s, g[0] * s + g[1] * c])
        self.dribble_speed = self.rng.uniform(3.0, 6.2)
        self.timer = self.rng.uniform(0.7, 1.8)

    def duel(self, dfn, car, kind="ground"):
        """Contact between a defender and the man on the ball. Logged the way a data provider logs it."""
        forced = self.story.duel_override(self, dfn, car) if self.story else None
        closing = float(np.linalg.norm(self.vel[dfn] - self.vel[car]))
        p_foul = 0.12 + (0.05 if closing > 5 else 0)
        r = self.rng.random()
        won = 0.36 * (league_mod.legs(self.team, self.clock)[dfn] ** 2 if self.league else 1.0)  # tired legs win fewer
        out = forced or (
            "foul" if r < p_foul else "won" if r < p_foul + won else "kept" if r < p_foul + won + 0.32 else "out"
        )
        force_card = {"foul_yellow": Q_YELLOW, "foul_second": Q_SECOND_YELLOW}.get(out)
        if force_card or out == "foul_plain":
            out = "foul"
        self.committed = None
        away = self.pos[car] - self.pos[dfn]
        away /= np.linalg.norm(away) + 1e-9  # from the defender towards the man he has met
        if out == "foul":
            self.down[car] = self.fx.uniform(1.8, 3.0)  # he goes down and stays down for a moment
            self.vel[car] = away * 1.6
            self.stun[dfn] = 1.0
            self.vel[dfn] *= 0.4
            e = self.log("foul", dfn, outcome=0, qualifiers={13: 1}, other=self.ids[car])
            self.log("foul", car, outcome=1, down_s=round(float(self.down[car]), 2))
            card = None
            if force_card:
                card = force_card
            elif forced is None:
                if self.booked[dfn]:
                    card = Q_SECOND_YELLOW if self.rng.random() < 0.10 else None
                elif self.rng.random() < 0.18 and (self.story is None or self.story.allow_booking(self, dfn)):
                    card = Q_YELLOW
            if card:
                self.log("card", dfn, qualifiers={card: 1}, related=e["id"])
                if card == Q_YELLOW:
                    self.booked[dfn] = True
                else:
                    self.off[dfn] = True
                    self.pos[dfn] = np.nan
            self.dead(
                "free_kick",
                self.pos[car].copy(),
                int(self.team[car]),
                self.rng.uniform(16, 36) + (20 if card else 0),
                taker=car,
            )
        elif out == "won":
            self.log("tackle", dfn, outcome=1, other=self.ids[car])
            self.log("take_on", car, outcome=0)
            self.stun[car] = self.fx.uniform(0.7, 1.3)
            self.vel[car] = self.vel[car] * 0.3 + away * 1.2  # knocked off the ball and off his stride
            self.give(dfn, timer=self.rng.uniform(0.4, 1.0))
        elif out == "kept":
            self.log("challenge", dfn, outcome=0, other=self.ids[car])
            self.log("take_on", car, outcome=1)
            self.stun[dfn] = self.rng.uniform(0.8, 1.6)
            self.vel[dfn] *= 0.3  # beaten: he is left standing
            self.timer = min(self.timer, self.rng.uniform(0.5, 1.2))
        else:
            self.log("tackle", dfn, outcome=1, other=self.ids[car])
            self.log("out", dfn, outcome=0)
            self.vel[car] *= 0.4
            self.vel[dfn] *= 0.5
            side = np.sign(self.pos[car, 1]) or 1.0  # he pokes it towards the touchline and it runs out
            self.bvel = np.array([self.rng.uniform(-3, 3), side * self.rng.uniform(13, 18)])
            self.bvz = 0.0
            self.poss = int(self.team[dfn])
            self.state = "loose"

    # ---------- one frame ----------
    def step(self):
        rng = self.script.rng if self.script else self.rng
        self.clock += DT
        if self.story:
            self.story.on_frame(self)
        # where everyone wants to be
        tgt = np.zeros((22, 2))
        urgent = np.zeros(22, bool)
        for t in (0, 1):
            idx, sh = self.shape(t, self.poss == t)
            tgt[idx] = sh
        self.noise += (-self.noise / 6.0) * DT + rng.normal(0, 0.4, (22, 2)) * math.sqrt(DT)
        tgt += self.noise
        if self.state == "dead":
            r = self.restart
            spot = r["spot"]
            if self.script and self.script.phase == "setup":  # a staged attack: everyone runs to his mark
                for i in range(22):
                    if not self.off[i]:
                        tgt[i] = self.script.spot(i)
                        urgent[i] = True
            if r["taker"] is None or self.off[r["taker"]]:
                r["taker"] = self.nearest(
                    spot, team=r["team"], exclude=[] if r["kind"] in ("goal_kick", "keeper") else [0, 11]
                )[0]
            taker = r["taker"]
            if r["kind"] == "kick_off" and not (self.script and self.script.phase == "setup"):
                self.kickoff_marks(tgt, r["team"], taker)
            if not r["has"]:
                self.roll()
                if abs(self.ball[0]) > PX + 3.5 or abs(self.ball[1]) > PY + 3:  # it has reached the boards
                    self.ball[0] = np.clip(self.ball[0], -PX - 3.5, PX + 3.5)
                    self.ball[1] = np.clip(self.ball[1], -PY - 3, PY + 3)
                    self.bvel *= 0.0
                    self.bvz = min(self.bvz, 0.0)
                gap = float(np.linalg.norm(self.ball[:2] - spot))
                still = np.linalg.norm(self.bvel) < 1.0 and self.ball[2] < 0.3
                far = gap > 14
                if far and still:
                    # too far for the taker: whoever is nearest goes to it and knocks it back towards the spot
                    f = int(np.argmin(np.where(self.off, 1e9, np.hypot(*(self.pos - self.ball[:2]).T))))
                    tgt[f] = self.ball[:2]
                    urgent[f] = True
                    if np.linalg.norm(self.pos[f] - self.ball[:2]) < 1.0:
                        if gap > 30:
                            th = 0.45
                            v0 = math.sqrt(gap * 0.8 * G / math.sin(2 * th))
                            hs, self.bvz = v0 * math.cos(th), v0 * math.sin(th)
                        else:
                            hs, _ = self.ground_kick(gap, 1.2)
                            self.bvz = 0.0
                        self.bvel = (spot - self.ball[:2]) / gap * hs
                tgt[taker] = spot if far else self.ball[:2]
                urgent[taker] = True
                if np.linalg.norm(self.pos[taker] - self.ball[:2]) < 1.0 and self.ball[2] < 1.7:
                    r["has"] = True
                    self.bvel[:] = 0
                    self.bvz = 0.0
            else:  # he has it: he walks it to the spot
                d = spot - self.pos[taker]
                L = float(np.linalg.norm(d))
                tgt[taker] = spot
                urgent[taker] = L > 6
                self.ball[:2] = self.pos[taker] + d / (L + 1e-9) * 0.35
                hold = 1.0 if r["kind"] in ("throw_in", "keeper") else 0.11
                self.ball[2] += float(np.clip(hold - self.ball[2], -0.1, 0.1))  # picked up or put down, never snapped
                if L < 0.9 and self.clock >= self.resume_at:
                    self.give(taker, timer=0.05 if self.script else 0.35)
                    if self.script:
                        self.script.on_restart(self, taker)
            if self.state == "dead" and self.clock > self.resume_at + 15:  # never wait for ever
                self.timeouts = getattr(self, "timeouts", 0) + 1
                self.pos[taker] = spot
                self.ball[:2] = spot
                self.ball[2] = 0.11
                self.bvel[:] = 0
                self.bvz = 0.0
                self.give(taker, timer=0.2)
                if self.script:
                    self.script.on_restart(self, taker)
        elif self.state == "carried":
            p = self.carrier
            t = int(self.team[p])
            # The ball only changes pace when it is at someone's feet. Within a metre he has it under control and keeps
            # it just ahead of him, the way a dribbler does with small touches. Further away he has to run to it first.
            reach = float(np.linalg.norm(self.ball[:2] - self.pos[p]))
            self.controlled = reach <= 1.0 and self.ball[2] < 0.6
            if self.controlled:
                corr = (self.pos[p] + self.heading * 0.6 - self.ball[:2]) * 7.0
                n = float(np.linalg.norm(corr))
                if n > 5.0:
                    corr *= 5.0 / n
                self.bvel = self.vel[p] + corr
                self.bvz = 0.0
                self.ball[:2] += self.bvel * DT
                self.ball[2] = 0.11
                tgt[p] = self.pos[p] + self.heading * 8.0
            else:
                self.roll()
                tgt[p] = self.ball[:2] + self.bvel * 0.2
                urgent[p] = True
                if reach > 4.0:  # it has got away from him
                    self.state = "loose"
            # pressing: the nearest outfield defender closes to a jockeying distance, and sometimes goes in
            dfn, dist = self.nearest(self.pos[p], team=1 - t, exclude=[0, 11])
            forced_presser = (
                self.script.presser if self.script and self.script.presser is not None else self.force_presser
            )
            if forced_presser is not None and self.team[forced_presser] != t and not self.off[forced_presser]:
                dfn = forced_presser
                dist = float(np.linalg.norm(self.pos[dfn] - self.pos[p]))
                if self.force_presser == dfn and dist < 7:
                    self.committed = dfn
            og = self.own_goal(1 - t) - self.pos[p]
            og /= np.linalg.norm(og) + 1e-9
            mode = self.script.press_mode(self, dfn) if self.script else None
            if self.committed == dfn or mode == "step":
                tgt[dfn] = self.ball[:2]
                urgent[dfn] = True
                self.committed = dfn
            elif mode == "hold":
                tgt[dfn] = self.pos[p] + og * 8.0  # he backs off and keeps his distance
                urgent[dfn] = True
            else:
                # a player who turns careful on a yellow card jockeys from further off, which is how his space opens
                tgt[dfn] = self.pos[p] + og * (5.0 if self.wary(dfn) else 2.1)
                urgent[dfn] = dist > 4
                if dist < 3.5 and self.stun[dfn] <= 0:
                    zone = 1.25 if abs(self.pos[p, 0] - self.own_goal(1 - t)[0]) < 40 else 0.85
                    hazard = 0.42 * zone * self.aggr[dfn] * (self.careful[dfn] if self.booked[dfn] else 1.0)
                    if self.league:
                        hazard *= league_mod.legs(self.team, self.clock)[dfn]
                    # while a planted attack is running, only the defender it is about goes in: the two runs of it
                    # must differ in him and in nothing else
                    planted = self.script is not None and getattr(self.script, "phase", "done") != "done"
                    if rng.random() < hazard * DT and not planted:
                        self.committed = dfn
            if self.committed is not None and np.linalg.norm(self.pos[self.committed] - self.pos[p]) < 1.0:
                self.duel(self.committed, p)
            elif self.state == "carried" and self.controlled:
                second, d2 = self.nearest(self.pos[p], team=1 - t, exclude=[0, 11, dfn])
                if abs(self.pos[p, 0] - self.own_goal(1 - t)[0]) < 38 and d2 < 14:
                    tgt[second] = self.pos[p] + og * 5.0
                self.timer -= DT * (1.6 if dist < 2.5 else 1.0)
                if self.timer <= 0:
                    self.decide()
        elif self.state in ("pass", "shot"):
            self.roll()
            if self.state == "pass":
                q = self.interceptor if self.interceptor is not None else self.receiver
                tgt[q] = (
                    self.intercept_at
                    if self.interceptor is not None
                    else self.ball[:2] + self.bvel * max(self.arrive_at - self.clock, 0)
                )
                if np.linalg.norm(self.ball[:2] - self.pos[q]) < 4.0:  # the last few metres: he goes to the ball itself
                    tgt[q] = self.ball[:2] + self.bvel * 0.12
                urgent[q] = True
                if self.interceptor is None:  # the nearest defender closes on the receiver
                    dfn, dist = self.nearest(self.pos[q], team=1 - self.team[q], exclude=[0, 11])
                    script = self.script
                    presser = script.presser if script is not None else None
                    if (
                        script is not None
                        and presser is not None
                        and script.press_mode(self, presser, receiving=True) == "hold"
                    ):  # the storyline's defender backs off instead of closing
                        dfn = presser
                        og = self.own_goal(self.team[dfn]) - self.pos[q]
                        og /= np.linalg.norm(og) + 1e-9
                        tgt[dfn] = self.pos[q] + og * 8.0
                        urgent[dfn] = True
                    elif dist < 9:
                        og = self.own_goal(self.team[dfn]) - self.pos[q]
                        og /= np.linalg.norm(og) + 1e-9
                        tgt[dfn] = self.pos[q] + og * (5.0 if self.wary(dfn) else 1.6)
                        urgent[dfn] = True
                if np.linalg.norm(self.ball[:2] - self.pos[q]) < 0.9 and self.ball[2] < 1.4:
                    if self.interceptor is not None:
                        self.log("interception", q)
                    else:
                        dfn, dist = self.nearest(self.pos[q], team=1 - self.team[q], exclude=[0, 11])
                        if dist < 1.3 and rng.random() < 0.45 and not self.script and not self.wary(dfn):
                            self.give(q, timer=1.0)
                            self.duel(dfn, q)
                            q = None
                    if q is not None:
                        self.give(q)
                elif self.clock > self.arrive_at + 0.6 or (np.linalg.norm(self.bvel) < 0.6 and self.ball[2] < 0.2):
                    self.state = "loose"
            else:
                if self.clock >= self.arrive_at:
                    self.finish_shot()
        if self.state == "loose":
            self.roll()
            order = np.argsort(np.where(self.off, 1e9, np.hypot(*(self.pos - self.ball[:2]).T)))
            for q in order[:2]:
                tgt[q] = self.ball[:2]
                urgent[q] = True
            a, b = int(order[0]), int(order[1])
            if np.linalg.norm(self.pos[a] - self.ball[:2]) < 0.9 and self.ball[2] < 1.4:
                if (
                    self.team[a] != self.team[b]
                    and np.linalg.norm(self.pos[b] - self.ball[:2]) < 1.6
                    and rng.random() < 0.6
                    and not self.wary(b)
                ):
                    self.give(a, timer=0.8)
                    self.log("ball_recovery", a)
                    self.duel(b, a)
                else:
                    self.log("ball_recovery", a)
                    self.give(a)
        # out of play
        if self.state not in ("dead", "shot") and (abs(self.ball[0]) > PX or abs(self.ball[1]) > PY):
            last = self.poss
            if abs(self.ball[1]) > PY and abs(self.ball[0]) <= PX:
                self.dead("throw_in", self.ball[:2].copy(), 1 - last, self.rng.uniform(9, 20))
            else:
                end_team = 0 if np.sign(self.ball[0]) == -self.dir[0] else 1  # whose goal line it crossed
                if last == end_team:
                    self.log("corner", self.nearest(self.ball[:2], team=1 - end_team)[0])
                    self.dead(
                        "corner",
                        np.array([np.sign(self.ball[0]) * PX, np.sign(self.ball[1] or 1) * PY]),
                        1 - end_team,
                        self.rng.uniform(22, 40),
                    )
                else:
                    self.dead(
                        "goal_kick",
                        np.array([np.sign(self.ball[0]) * (PX - 5.5), 0.0]),
                        end_team,
                        self.rng.uniform(17, 32),
                        taker=11 * end_team,
                    )
        # move
        self.stun = np.maximum(self.stun - DT, 0)
        self.down = np.maximum(self.down - DT, 0)
        d = tgt - self.pos
        dist = np.linalg.norm(d, axis=1) + 1e-9
        far = dist > 9  # out of shape after a turnover: run back into it
        vmax = self.vmax * league_mod.legs(self.team, self.clock) if self.league else self.vmax
        want = np.where(
            urgent,
            np.minimum(vmax, dist * 2.2),
            np.where(far, np.minimum(vmax * 0.66, dist * 0.45), np.minimum(vmax * 0.29, dist * 0.7)),
        )
        if self.state == "carried" and self.controlled:
            want[self.carrier] = self.dribble_speed
        want = np.where(self.stun > 0, want * 0.35, want)
        want = np.where(self.down > 0, 0.0, want)  # on the ground
        dv = d / dist[:, None] * want[:, None] - self.vel
        n = np.linalg.norm(dv, axis=1) + 1e-9
        self.vel += dv / n[:, None] * np.minimum(n, 4.8 * DT)[:, None]
        on = ~self.off
        self.pos[on] += self.vel[on] * DT
        self.bodies()
        self.pos[on] = np.clip(self.pos[on], [-PX - 4, -PY - 3.5], [PX + 4, PY + 3.5])
        self.frames.append((self.period, self.clock, self.state != "dead", self.poss, *self.ball, self.pos.copy()))
        self.ctl.append(
            (
                self.state,
                getattr(self, "carrier", -1)
                if self.state == "carried"
                else getattr(self, "receiver", -1)
                if self.state == "pass"
                else -1,
            )
        )

    def bodies(self):
        """Two players cannot stand in the same place. Where two bodies overlap they are moved apart along the line
        between them and lose the speed they were closing at, so a man runs into another and not through him."""
        on = np.flatnonzero(~self.off)
        P = self.pos[on]
        D = P[:, None, :] - P[None, :, :]
        dist = np.linalg.norm(D, axis=2)
        ii, jj = np.nonzero(np.triu(dist < BODY, 1))
        for a, b in zip(ii, jj, strict=True):
            i, j = on[a], on[b]
            d = self.pos[i] - self.pos[j]
            L = float(np.linalg.norm(d))
            n = d / L if L > 1e-6 else np.array([1.0, 0.0])
            push = (BODY - L) / 2
            self.pos[i] += n * push
            self.pos[j] -= n * push
            closing = float((self.vel[i] - self.vel[j]) @ n)
            if closing < 0:
                self.vel[i] -= n * closing / 2
                self.vel[j] += n * closing / 2

    def finish_shot(self):
        """The shot has reached the goal, the keeper or a defender. Nothing is moved by hand: the ball keeps its own
        motion."""
        p, out = self.shooter, self.shot_outcome
        t = int(self.team[p])
        gk = 11 * (1 - t)
        if out == "goal":
            self.score[t] += 1
            self.bvel *= 0.05
            self.bvz = min(self.bvz, 0.0)  # it hits the net and drops
            self.dead("kick_off", np.zeros(2), 1 - t, self.rng.uniform(48, 68))
        elif out == "saved":
            self.log("save", gk)
            if self.rng.random() < 0.35:  # pushed round the post: it runs out for a corner
                self.log("corner", p)
                self.poss = 1 - t
                self.state = "loose"
                self.bvel = np.array(
                    [self.dir[t] * self.rng.uniform(5, 8), (np.sign(self.ball[1]) or 1.0) * self.rng.uniform(6, 9)]
                )
                self.bvz = self.rng.uniform(1, 3)
            else:  # held
                self.bvel[:] = 0
                self.bvz = 0.0
                self.dead("keeper", self.pos[gk].copy(), 1 - t, self.rng.uniform(6, 12), taker=gk)
        elif out == "wide":
            self.poss = t
            self.state = "loose"  # it flies on and out; the goal kick follows from that
        else:  # blocked: it comes off the defender
            self.poss = 1 - t
            self.state = "loose"
            if self.rng.random() < 0.5:
                self.log("corner", p)
                self.bvel = np.array([self.dir[t] * self.rng.uniform(6, 10), self.rng.uniform(-5, 5)])
                self.bvz = self.rng.uniform(1, 4)
            else:
                ang = self.rng.uniform(0, 2 * math.pi)
                self.bvel = np.array([math.cos(ang), math.sin(ang)]) * self.rng.uniform(4, 8)
                self.bvz = self.rng.uniform(0.5, 3)

    def kickoff_marks(self, where, team, taker, mate=None):
        """Where everyone may stand for a kick-off, written into `where` (22 by 2). The two men at the ball are both
        from the side taking it. Everyone is in his own half, and the other side stays out of the centre circle until
        the ball is played."""
        for i in range(22):
            if self.off[i]:
                continue
            d = self.dir[int(self.team[i])]
            if where[i, 0] * d > -0.6:  # his own half is the one his side defends
                where[i, 0] = -0.6 * d
            if int(self.team[i]) != team and np.hypot(*where[i]) < 9.8:  # 9.15 m, with a little to spare
                y = where[i, 1] if abs(where[i, 1]) > 0.5 else (1.0 if i % 2 else -1.0)
                where[i] = (
                    np.array([-d * math.sqrt(max(9.8**2 - min(abs(y), 9.8) ** 2, 0.36)), y])
                    if abs(y) < 9.8
                    else where[i]
                )
        d = self.dir[team]
        if mate is None:
            own = [i for i in range(22) if int(self.team[i]) == team and not self.off[i] and i not in (taker, 0, 11)]
            mate = min(own, key=lambda i: float(np.hypot(*where[i]))) if own else None
        where[taker] = np.array([-0.4 * d, 0.0])
        if mate is not None:
            where[mate] = np.array([-0.7 * d, 2.2])
        return mate

    # ---------- a whole match ----------
    def run(self):
        for period in (1, 2):
            self.period = period
            self.dir = {0: 1.0, 1: -1.0} if period == 1 else {0: -1.0, 1: 1.0}
            self.clock = 0.0 if period == 1 else 45 * 60.0
            self.ball = np.array([0.0, 0.0, 0.11])
            self.bvel = np.zeros(2)
            self.bvz = 0.0
            self.poss = 0 if period == 1 else 1
            for t in (0, 1):
                idx, sh = self.shape(t, False)
                self.pos[idx] = np.where(np.isnan(self.pos[idx]) & False, self.pos[idx], sh)
            self.kickoff_marks(self.pos, self.poss, 9 if period == 1 else 20, 7 if period == 1 else 18)
            self.pos[self.off] = np.nan
            self.vel[:] = 0
            self.log("start", 9 if period == 1 else 20)
            self.give(9 if period == 1 else 20, timer=0.3)
            half = self.minutes / 2 * 60
            end = self.clock + half + self.rng.uniform(60, 240) * (self.minutes / 90)
            while self.clock < end or self.state in ("shot",):
                self.step()
            self.log("end", 0)
        return self
