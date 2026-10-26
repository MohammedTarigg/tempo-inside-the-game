"""The closest earlier attempt. For a goal or a big chance, find the earlier attack by the same team that looked most
alike and ended differently, and say where the two differed most.

Tested on real football (docs/architecture.md section 8): true twins are rare, so this never claims "the same move". It
reports the average gap in metres and only passes when the gap is under both a percentile of all pairs and an absolute
limit."""

import itertools
from typing import Any

import numpy as np

from ..constants import HZ

OFFS = list(range(0, 126, 5))  # from the start of the attack: 0 to 5 seconds, every 0.2 s
ALIKE = 9  # the first 1.6 seconds decide whether two attacks start alike
K = 4  # players a side, nearest the ball when the attack starts
PERMS = np.array(list(itertools.permutations(range(K))))
LIMIT_M = 4.0  # absolute limit on the average gap over the alike part
DIFF_M = 3.0  # a player "stood differently" beyond this
MAX_BACK = 12 * HZ
NEAR_BALL_M = 12.0  # a differing defender only counts if he is this close to the ball


def attack_start(live, poss, shot_frame):
    """The frame this attack began: the last restart or change of possession before the shot, at most 12 seconds
    back."""
    lo = max(shot_frame - MAX_BACK, 1)
    for i in range(shot_frame, lo, -1):
        if not live[i - 1] or poss[i] != poss[i - 1]:
            return i
    return lo


def attack_vector(frames, start, shot_frame, team, dir_of_team, keepers) -> dict[str, Any] | None:
    """The ball and the K nearest players a side, from the start of the attack. Moments after the shot repeat the shot
    frame. Returns None when the attack is shorter than the alike part. Reads nothing after the shot."""
    if shot_frame - start < OFFS[ALIKE - 1]:
        return None
    fr = np.minimum(start + np.array(OFFS), shot_frame)
    sgn = dir_of_team
    pos = frames["pos"][fr]
    ball = frames["ball"][fr, :2] * sgn
    ball[:, 0] -= 52.5
    flip = -1.0 if ball[0, 1] < 0 else 1.0
    ball[:, 1] *= flip
    teams = frames["team"]
    out: dict[str, Any] = dict(ball=ball, n_real=int((start + np.array(OFFS) <= shot_frame).sum()))
    d = np.hypot(*(frames["pos"][start] - frames["ball"][start, :2]).T)
    for key, sel in (("A", teams == team), ("D", teams != team)):
        idx = [j for j in np.flatnonzero(sel) if j not in keepers and not np.isnan(pos[:, j, 0]).any()]
        if len(idx) < K:
            return None
        idx = sorted(idx, key=lambda j: d[j])[:K]
        v = pos[:, idx].transpose(1, 0, 2) * sgn
        v[..., 0] -= 52.5
        v[..., 1] *= flip
        out[key] = v
        out[key + "_idx"] = [int(x) for x in idx]
    return out


def compare(a, b):
    """Average gap in metres over the first moments of two attacks, with the best one-to-one pairing of players."""
    gap = np.linalg.norm(a["ball"][:ALIKE] - b["ball"][:ALIKE], axis=-1).mean()
    res = dict()
    for key in ("A", "D"):
        C = np.linalg.norm(a[key][:, None, :ALIKE] - b[key][None, :, :ALIKE], axis=-1).mean(-1)
        cost = C[np.arange(K), PERMS].sum(1)
        k = cost.argmin()
        gap += cost[k] / K
        res[key] = dict(perm=PERMS[k], per=np.linalg.norm(a[key] - b[key][PERMS[k]], axis=-1))  # (K, moments)
    res["gap_m"] = float(gap / 3)
    return res


class TwinSearch:
    def __init__(self):
        self.archive = []  # dict(vec, team, match_id, t, outcome, meta)
        self._pairs = []

    def add(self, vec, team, match_id, t, outcome, meta=None):
        for o in self.archive[-400:]:
            self._pairs.append(compare(vec, o["vec"])["gap_m"])
        self.archive.append(dict(vec=vec, team=team, match_id=match_id, t=t, outcome=outcome, meta=meta or {}))

    def candidates(self, vec, team, match_id, t, outcome):
        """The earlier attacks this one may be compared with: same team, a different result, and from this match only
        if it came at least 20 seconds before. Here every attack in the archive is a candidate; on Azure, AI Search
        retrieves the nearest ones across the season (tempo/azure/search.py)."""
        return [
            o
            for o in self.archive
            if o["team"] == team and o["outcome"] != outcome and (o["match_id"] != match_id or o["t"] < t - 20)
        ]

    def closest_earlier(self, vec, team, match_id, t, outcome) -> dict[str, Any] | None:
        """The nearest earlier attack by the same team with a different result. Returns None when nothing is close
        enough."""
        cands = self.candidates(vec, team, match_id, t, outcome)
        if not cands or len(self._pairs) < 30:
            return None
        scored = [(compare(vec, o["vec"]), o) for o in cands]
        res, o = min(scored, key=lambda x: x[0]["gap_m"])
        pct = float(np.mean(np.array(self._pairs) < res["gap_m"]))
        if res["gap_m"] > LIMIT_M or pct > 0.05:
            return dict(found=False, gap_m=res["gap_m"], closer_than=1 - pct)
        last = min(vec["n_real"], o["vec"]["n_real"]) - 1  # the last moment both attacks were still running
        per = res["D"]["per"][:, : last + 1]  # defenders of the new attack against their pairs
        # the first defender to stand differently, counting only one who is near the ball in either attack at that
        # moment: a striker drifting on the far side is a difference, and it explains nothing
        pb = o["vec"]["D"][res["D"]["perm"]]
        near = (np.linalg.norm(vec["D"][:, : last + 1] - vec["ball"][None, : last + 1], axis=-1) < NEAR_BALL_M) | (
            np.linalg.norm(pb[:, : last + 1] - o["vec"]["ball"][None, : last + 1], axis=-1) < NEAR_BALL_M
        )
        hit = (per > DIFF_M) & near
        k_part = next((k for k in range(per.shape[1]) if hit[:, k].any()), None)
        if k_part is None:  # no relevant difference: nothing to point at
            return dict(found=False, gap_m=res["gap_m"], closer_than=1 - pct)
        worst = int(np.where(hit[:, k_part], per[:, k_part], -1).argmax())
        differing = [int(j) for j in np.flatnonzero(hit[:, k_part])]
        part = OFFS[k_part] / HZ
        return dict(
            found=True,
            gap_m=res["gap_m"],
            closer_than=1 - pct,
            earlier=o,
            biggest_difference=vec["D_idx"][worst],
            biggest_difference_m=float(per[worst, min(k_part + 10, per.shape[1] - 1)]),  # two seconds after they part
            earlier_player=o["vec"]["D_idx"][int(res["D"]["perm"][worst])],
            n_differing=len(differing),
            parting_s=part,
        )
