"""The rules that say whether something Tempo said before kick-off came true.

One rule for each kind of call, fixed here before any match is seen. The season miner (season.py) runs each rule over
past matches and only makes a call that has held in most of them; the pipeline (pipeline/run.py) runs the same rule at full
time. A rule answers True, False, or None when the match never put the call to the test.

    shot_channel        most of the side's shots came from the channel named. Untested with fewer than 3 shots
    late_shots_against  the side conceded in the window, or more of the shots it faced came in the window than the
                        window's share of the match. Untested with fewer than 3 shots faced and no goal in the window
    booked_challenges   ("if he is booked, this space opens") he made challenges less often after his card than before
                        it. Untested if he was not booked, or was booked with under 20 minutes played or under 20
                        left, when one side of the comparison is too short to mean anything
"""

MIN_SHOTS = 3
SAME_CHALLENGE_S = 2.0  # one challenge is often written as two or three events: the challenge, the tackle, the foul
MATCH_MINUTES = 90
MIN_EITHER_SIDE_S = 20 * 60  # with less play than this before the card, or after it, there is too little to compare


def shot_channel(ys, zone):
    """ys: the pitch-width position (0 to 100) of each of the side's shots. Returns (held, in the channel, shots, flags)."""
    wide = [abs(y - 50) > 18 for y in ys]
    inside = wide if zone == "wide" else [not w for w in wide]
    k, n = sum(inside), len(ys)
    return (None if n < MIN_SHOTS else k / n > 0.5), k, n, inside


def late_shots_against(shots, window):
    """shots: (match time in seconds, was it a goal) for each shot the side faced. Returns (held, late, shots, late goal)."""
    w0, w1 = window
    late = [(t, g) for t, g in shots if t >= w0 * 60]
    goal = next((t for t, g in late if g), None)
    k, n = len(late), len(shots)
    if goal is not None:
        return True, k, n, goal
    return (None if n < MIN_SHOTS else k / n > (w1 - w0) / MATCH_MINUTES), k, n, None


def once_each(times):
    """Challenge times with the extra events of one challenge taken out."""
    out = []
    for t in sorted(times):
        if not out or t - out[-1] > SAME_CHALLENGE_S:
            out.append(t)
    return out


def booked_challenges(times, card_time, end_time):
    """times: when he went into a challenge. Returns (held, before his card, after it, the times counted)."""
    went = once_each(times)
    if card_time is None:
        return None, len(went), 0, went
    if card_time < MIN_EITHER_SIDE_S or end_time - card_time < MIN_EITHER_SIDE_S:
        return None, sum(t < card_time for t in went), sum(t >= card_time for t in went), went
    b = sum(t < card_time for t in went)
    a = len(went) - b
    return a / max(end_time - card_time, 1.0) < b / max(card_time, 1.0), b, a, went
