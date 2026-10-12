"""What stays the same about a club and a player from one match to the next.

Without this every generated match re-rolls each player's speed and aggression, and the two clubs are the same side in
different shirts: nothing a viewer is told before kick-off can be true more often than chance. Real clubs and players have
habits, and a league that is football-realistic has to have them too. These are the habits of this one. They are properties
of the generated world, written here once; the season miner (tempo/season.py) is not told them and has to find them.

    through_middle  how strongly a side's passes prefer a team-mate in the central channel going forward
    fades           how much of a side's running and tackling goes between minutes 65 and 80, and stays gone
    aggr            a player's appetite for a challenge, where 1.0 is average
    careful         what is left of that appetite once he is booked (0.85 for everyone not listed)
    SHOT_ROOM       how much more often an attack ends in a shot for each tenth the defending side's legs have gone
"""

import numpy as np

SEED = 2026  # the league's own stream: a player's speed and appetite are drawn once, for every match he plays
CLUB = {
    0: dict(through_middle=1.3, fades=0.0),  # Northgate
    1: dict(through_middle=0.0, fades=0.35),  # Harbour City
}
PLAYER = {
    "p_har_6": dict(aggr=1.55, careful=0.12),  # Skoles: first into every challenge, and a different player on a yellow
    "p_nor_9": dict(aggr=1.35),  # Marek
}
CAREFUL = 0.85
SHOT_ROOM = 0.2


def players(ids):
    """Top speed, appetite for a challenge and care when booked for all 22, the same in every match."""
    rng = np.random.default_rng(SEED)
    vmax = np.clip(rng.normal(8.7, 0.5, len(ids)), 7.6, 9.8)
    vmax[[0, 11]] = 7.0
    aggr = np.clip(rng.normal(1.0, 0.25, len(ids)), 0.5, 1.6)
    careful = np.full(len(ids), CAREFUL)
    for i, pid in enumerate(ids):
        t = PLAYER.get(pid, {})
        aggr[i] = t.get("aggr", aggr[i])
        careful[i] = t.get("careful", careful[i])
    return vmax, aggr, careful


def legs(team, clock):
    """What is left in each player's legs at this point of the match: 1.0, falling for a side that fades."""
    ramp = float(np.clip((clock / 60 - 65) / 15, 0, 1))
    return 1.0 - np.array([CLUB[int(t)]["fades"] for t in team]) * ramp
