"""The storyline of the demo match. A generated match is otherwise unscripted; this layer plants the few things the demo is built on
and records each one, so the evaluation can check the pipeline finds what was planted.

Planted: Stahl (Harbour City 6) is booked at 47 minutes. The same Northgate attack is run at 12 and at 71 minutes: at 12 Stahl steps
in and the move ends in a saved shot from wide; at 71, on a yellow, he holds off and Draper scores."""
import numpy as np

from .sim import PX

DRAPER, KESSLER, OKOYE = 7, 6, 8          # Northgate 10, 8, 7 (indices into the 22)
STAHL = 11 + 5                            # Harbour City 6
# starting spots for the planted attack, in metres, written for Northgate attacking towards +x
TEMPLATE = {0: (-44, 0), 1: (-20, -22), 2: (-26, -7), 3: (-26, 7), 4: (-20, 22), 5: (-14, 0), KESSLER: (-8, 2), DRAPER: (0, 0), OKOYE: (14, -20), 9: (22, 4), 10: (14, 18),
            11: (48, 0), 12: (20, 24), 13: (25, 7), 14: (25, -6), 15: (20, -24), STAHL: (10, 0), 17: (8, 11), 18: (8, -10), 19: (2, 22), 20: (-14, 0), 21: (2, -22)}


class Attack:
    """One run of the planted attack. variant 'step': Stahl goes in. variant 'hold': he stands off."""

    def __init__(self, sim, variant, seed=99):
        self.variant, self.rng, self.presser, self.phase = variant, np.random.default_rng(seed), STAHL, "setup"
        self.d = sim.dir[0]

    def spot(self, i):
        x, y = TEMPLATE[i]
        return np.array([x * self.d, y * self.d])

    def on_restart(self, sim, taker):
        self.phase = "kessler"

    def press_mode(self, sim, dfn, receiving=False):
        if dfn != STAHL:
            return None
        if receiving:                                    # while the ball travels to Draper: only the holding variant behaves differently
            return "hold" if self.variant == "hold" and self.phase == "to_draper" else None
        if self.phase not in ("to_draper", "draper"):      # from the moment the ball is on its way to Draper, his part is scripted
            return None
        return "step" if self.variant == "step" else "hold"

    def carrier_decision(self, sim, p):
        if self.phase == "kessler" and p == KESSLER:
            sim.pass_to(KESSLER, DRAPER, forced=True); self.phase = "to_draper"; return True
        if p == DRAPER and self.phase in ("to_draper", "draper"):
            self.phase = "draper"
            sim.heading = np.array([self.d, 0.0]); sim.dribble_speed = 5.6; sim.timer = 0.2
            gap = np.linalg.norm(sim.pos[STAHL] - sim.pos[DRAPER])
            if self.variant == "step" and gap < 3.4:
                sim.pass_to(DRAPER, OKOYE, forced=True); self.phase = "okoye"
            elif self.variant == "hold" and sim.pos[DRAPER, 0] * self.d > 30:
                sim.shoot(DRAPER, forced="goal"); self.phase = "done"
            return True
        if p == OKOYE and self.phase == "okoye":
            sim.heading = np.array([self.d, 0.25 * self.d]); sim.dribble_speed = 5.0
            if sim.pos[OKOYE, 0] * self.d > 34:
                sim.shoot(OKOYE, forced="saved"); self.phase = "done"
            else:
                sim.timer = 0.2
            return True
        return False


class DemoStory:
    def __init__(self):
        self.planted = []                 # what was planted and when, for the evaluation
        self.pending = [("attack", 12 * 60.0, "step"), ("book", 46.6 * 60.0, None), ("attack", 71 * 60.0, "hold")]
        self.commentary = [(35 * 60 + 10.0, "Stahl is everywhere for Harbour City today"), (56 * 60 + 5.0, "Stahl has gone very quiet since that booking")]
        self.book_armed = False

    def on_frame(self, sim):
        while self.commentary and sim.clock >= self.commentary[0][0]:
            t, text = self.commentary.pop(0); sim.commentary.append(dict(matchTime=t, text=text))
        if sim.script and sim.script.phase == "done" and sim.state in ("dead", "carried", "loose") :
            sim.script = None
        if not self.pending or sim.clock < self.pending[0][1]:
            return
        kind, t, arg = self.pending[0]
        if kind == "book":
            self.book_armed = True; sim.force_presser = STAHL; self.pending.pop(0)
        elif kind == "attack" and sim.state in ("carried", "loose") and sim.script is None:
            self.pending.pop(0)
            sim.script = Attack(sim, arg)
            sim.dead("free_kick", sim.script.spot(KESSLER), 0, 14.0, taker=KESSLER)
            self.planted.append(dict(kind="attack", variant=arg, restart=round(sim.clock + 14.0, 1)))

    def allow_booking(self, sim, dfn):
        """The demo match is about one booked player. Chance gives at most one other yellow, so the card on screen means something."""
        return dfn != STAHL and int(sim.booked.sum()) - int(sim.booked[STAHL]) < 1

    def duel_override(self, sim, dfn, car):
        """Stahl's cards are the story's to give: none before 47 minutes, one then, and never a second."""
        if dfn != STAHL:
            if sim.booked[dfn]:                                              # the demo match keeps eleven against eleven
                r = sim.rng.random()
                return "foul_plain" if r < 0.12 else "won" if r < 0.48 else "kept" if r < 0.80 else "out"
            return None
        if self.book_armed and not sim.booked[STAHL]:
            self.book_armed = False; sim.force_presser = None
            self.planted.append(dict(kind="booking", player=sim.ids[STAHL], matchTime=round(sim.clock, 1)))
            return "foul_yellow"
        r = sim.rng.random()
        return "foul_plain" if r < 0.12 else "won" if r < 0.48 else "kept" if r < 0.80 else "out"
