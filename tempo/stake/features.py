"""The one feature path for the stake model. Training and live scoring both call window_features, so they cannot drift
apart.

A window is the last HIST tracking frames. Nothing after the last frame is read."""

import numpy as np

from ..constants import HZ

LAGS = [0, 2, 4, 7, 10, 15, 20, 30, 40, 50]  # frames back from now: two seconds of history
STEP = 3  # the model is scored on every third frame, in training, in evaluation and live
HIST = 62  # frames a window must hold (longest lag + smoothing + velocity)
NEAR = 12.0  # a defender is scored only within this distance of a live ball
N_FEAT = 20


def _trail_mean(a, k):
    c = np.cumsum(np.nan_to_num(a), axis=-1)
    out = c.copy()
    out[..., k:] = c[..., k:] - c[..., :-k]
    return out / np.minimum(np.arange(a.shape[-1]) + 1, k)


def window_features(xy, ball, team, own_goal_x, poss, live):
    """Features for every player near a live ball at the last frame of the window.

    xy          (n, T, 2) player positions in metres from the centre spot, NaN when off the pitch
    ball        (T, 3) ball x, y, height
    team        (n,) 0 or 1
    own_goal_x  (2,) x of each team's own goal, plus or minus 52.5
    poss        (T,) team in possession per the feed: 0, 1, or -1 for none
    live        (T,) ball in play
    Returns (player indices, features (k, N_FEAT, len(LAGS)), distance to the ball (k,)).
    """
    _, T, _ = xy.shape
    assert T >= HIST, "window too short"
    now = T - 1
    if not live[now]:
        return np.zeros(0, int), np.zeros((0, N_FEAT, len(LAGS)), np.float32), np.zeros(0)
    xs = np.stack([_trail_mean(xy[..., 0], 5), _trail_mean(xy[..., 1], 5)], -1)
    absent = np.isnan(xy[..., 0])
    xs[absent] = np.nan
    vel = np.zeros_like(xs)
    vel[:, 5:] = (xs[:, 5:] - xs[:, :-5]) * (HZ / 5)
    vel = np.nan_to_num(vel)
    bs = np.stack([_trail_mean(ball[:, 0], 3), _trail_mean(ball[:, 1], 3)], -1)
    bv = np.zeros((T, 2))
    bv[5:] = (bs[5:] - bs[:-5]) * (HZ / 5)
    db = np.hypot(xy[..., 0] - ball[None, :, 0], xy[..., 1] - ball[None, :, 1])
    db = np.where(np.isnan(db), 1e9, db)  # (n, T)
    xs0 = np.nan_to_num(xs, nan=999.0)
    g = np.array([now - lag for lag in LAGS])
    idx_out, feats, dist = [], [], []
    for t in (0, 1):
        mates = np.flatnonzero(team == t)
        opp = np.flatnonzero(team != t)
        if len(mates) < 2 or len(opp) < 2:
            continue
        s = -np.sign(own_goal_x[t])
        dbm = db[mates]
        order_o = np.argsort(db[opp, now])
        o1, o2 = opp[order_o[0]], opp[order_o[1]]
        order_m = np.argsort(dbm[:, now])
        rank = np.argsort(np.argsort(dbm[:, g], axis=0), axis=0)  # (mates, lags)
        gdb = np.hypot(bs[g, 0] - own_goal_x[t], bs[g, 1])
        crowd = (dbm[:, g] < 6).sum(0)
        pflag = np.where(poss[g] < 0, 0.0, np.where(poss[g] == t, -1.0, 1.0)) * live[g]
        for j, pi in enumerate(mates):
            if dbm[j, now] >= NEAR or absent[pi, now]:
                continue
            mt = mates[order_m[1]] if order_m[0] == j else mates[order_m[0]]
            me = xs0[pi, g]
            f = np.stack(
                [
                    (bs[g, 0] - me[:, 0]) * s,
                    bs[g, 1] - me[:, 1],
                    ball[g, 2],
                    bv[g, 0] * s,
                    bv[g, 1],
                    vel[pi, g, 0] * s,
                    vel[pi, g, 1],
                    (xs0[o1, g, 0] - me[:, 0]) * s,
                    xs0[o1, g, 1] - me[:, 1],
                    vel[o1, g, 0] * s,
                    vel[o1, g, 1],
                    (xs0[o2, g, 0] - me[:, 0]) * s,
                    xs0[o2, g, 1] - me[:, 1],
                    (xs0[mt, g, 0] - me[:, 0]) * s,
                    xs0[mt, g, 1] - me[:, 1],
                    pflag,
                    rank[j],
                    gdb,
                    crowd,
                    live[g].astype(float),
                ]
            )
            idx_out.append(pi)
            feats.append(np.clip(np.nan_to_num(f), -60, 60))
            dist.append(dbm[j, now])
    if not idx_out:
        return np.zeros(0, int), np.zeros((0, N_FEAT, len(LAGS)), np.float32), np.zeros(0)
    return np.array(idx_out), np.stack(feats).astype(np.float32), np.array(dist)
