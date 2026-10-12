"""The ghost: where would an average defender be now, given where he stood two seconds ago and how the play has moved?
One small network and one step of two seconds, after Le, Carr, Yue and Lucey (2017) and NFL Ghosts (2024). It says who
is standing off the ball more than usual. It cannot say whether that mattered, so the reason rule only uses it beside
two other instruments.

    python3 -m tempo.ghost          fits it on the generated season and writes artifacts/ghost_model.pt and
                                    ghost_meta.json
"""

import json
import os

import numpy as np
import torch
import torch.nn as nn

from .constants import HZ, PX, PY
from .paths import ARTIFACTS

STEP = 12
H = 2 * HZ  # the ghost looks two seconds ahead
NA, NT = 4, 3  # nearest attackers and team-mates given to the network
MODEL, META = os.path.join(ARTIFACTS, "ghost_model.pt"), os.path.join(ARTIFACTS, "ghost_meta.json")


def network(n_in=13 + 4 * NA + 2 * NT):
    return nn.Sequential(
        nn.Linear(n_in, 192), nn.ReLU(), nn.Linear(192, 192), nn.ReLU(), nn.Linear(192, 96), nn.ReLU(), nn.Linear(96, 2)
    )


def features(seg, t, h=H, players=None):
    """Rows for every defending outfield player at frame t. `seg` holds xy (frames, players, 2), ball, live, poss, team,
    keeper and own (the x of each team's own goal). Reads nothing after frame t. Returns (X, Y, index, p0, flip) or
    None."""
    xy, ball = seg["xy"], seg["ball"]
    D = 1 - int(seg["poss"][t])
    flip = -1.0 if seg["own"][D] > 0 else 1.0  # turn the pitch so the defending team guards x = -52.5
    now, then, before = xy[t] * flip, xy[t - h] * flip, xy[t - h - 5] * flip
    b1, b0 = ball[t][:2] * flip, ball[t - h][:2] * flip
    ok = ~np.isnan(now[:, 0]) & ~np.isnan(then[:, 0]) & ~np.isnan(before[:, 0]) & ~seg["keeper"]
    dfn = np.flatnonzero(ok & (seg["team"] == D))
    att = np.flatnonzero(ok & (seg["team"] != D))
    if len(dfn) < NT + 1 or len(att) < NA:
        return None
    rows, ys, idx, p0s = [], [], [], []
    for i in dfn if players is None else [p for p in players if p in dfn]:
        p0 = then[i]
        v0 = (then[i] - before[i]) * (HZ / 5)
        a = att[np.argsort(np.linalg.norm(now[att] - p0, axis=1))[:NA]]
        mates = dfn[dfn != i]
        m = mates[np.argsort(np.linalg.norm(now[mates] - p0, axis=1))[:NT]]
        rows.append(
            np.concatenate(
                [
                    p0 / [PX, PY],
                    v0 / 8,
                    (b0 - p0) / 30,
                    (b1 - p0) / 30,
                    b1 / [PX, PY],
                    ((now[a] - p0) / 30).ravel(),
                    ((then[a] - p0) / 30).ravel(),
                    ((now[m] - p0) / 30).ravel(),
                    (now[mates].mean(0) - p0) / 30,
                    [now[mates][:, 0].min() / PX],
                ]
            )
        )
        ys.append(now[i] - p0)
        idx.append(i)
        p0s.append(p0)
    if not rows:
        return None
    return np.array(rows, np.float32), np.array(ys, np.float32), np.array(idx), np.array(p0s), flip


def mirror(X, Y):
    """The same play seen in a mirror, so the network does not learn a left or a right."""
    Xm, Ym = X.copy(), Y.copy()
    ycols = (
        [1, 3, 5, 7, 9]
        + list(range(11, 10 + 4 * NA, 2))
        + list(range(11 + 4 * NA, 10 + 4 * NA + 2 * NT, 2))
        + [11 + 4 * NA + 2 * NT]
    )
    Xm[:, ycols] *= -1
    Ym[:, 1] *= -1
    return np.concatenate([X, Xm]), np.concatenate([Y, Ym])


def dataset(segs, h=H, step=STEP):
    X, Y, V = [], [], []
    for seg in segs:
        live = seg["live"].astype(int)
        run = np.concatenate([[0], np.cumsum(live)])
        for t in range(h + 5, len(live), step):
            if run[t + 1] - run[t - h - 5] != h + 6 or seg["poss"][t] not in (
                0,
                1,
            ):  # play has to have been live for the whole stretch
                continue
            f = features(seg, t, h)
            if f is not None:
                X.append(f[0])
                Y.append(f[1])
                V.append(f[0][:, 2:4] * 8 * (h / HZ))  # V: where he would be had he kept his pace
    return np.concatenate(X), np.concatenate(Y), np.concatenate(V)


def fit(X, Y, epochs=8, seed=0):
    torch.manual_seed(seed)
    X, Y = mirror(X, Y)
    net = network(X.shape[1])
    opt = torch.optim.Adam(net.parameters(), 1e-3)
    Xt, Yt = torch.tensor(X), torch.tensor(Y)
    for ep in range(epochs):
        perm = torch.randperm(len(Xt))
        for k in range(0, len(Xt), 2048):
            b = perm[k : k + 2048]
            loss = ((net(Xt[b]) - Yt[b]) ** 2).sum(1).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
        if ep == epochs - 3:
            for g in opt.param_groups:
                g["lr"] = 3e-4
    return net


def predict(net, X):
    with torch.no_grad():
        return net(torch.tensor(X)).numpy()


def segment(view, keepers, lo, hi, home_dir):
    """A stretch of one match in the shape `features` reads. Frames lo to hi inclusive, so nothing later can be seen."""
    keeper = np.zeros(len(view["team"]), bool)
    keeper[keepers] = True
    return dict(
        xy=view["pos"][lo : hi + 1],
        ball=view["ball"][lo : hi + 1],
        live=np.asarray(view["live"][lo : hi + 1]).astype(bool),
        poss=view["poss"][lo : hi + 1],
        team=view["team"],
        keeper=keeper,
        own=np.array([-home_dir * PX, home_dir * PX]),
    )


def standing_off(net, seg, t1, attacking_team, window_s=6.0, near=10.0):
    """For the seconds before frame t1 of `seg`: each defender the ghost would have within `near` metres of the ball,
    with how much further from the ball he really was at the worst moment. Positive means he stood off. Returns {player
    index: metres}."""
    best = {}
    for t in range(max(t1 - int(window_s * HZ), H + 6), t1, 5):
        if seg["poss"][t] != attacking_team or not seg["live"][t - H - 5 : t + 1].all():
            continue
        f = features(seg, t)
        if f is None:
            continue
        X, Y, idx, p0, flip = f
        P = predict(net, X)
        ball = seg["ball"][t][:2] * flip
        real, ghost = np.linalg.norm(Y + p0 - ball, axis=1), np.linalg.norm(P + p0 - ball, axis=1)
        for i, a, g in zip(idx, real, ghost):
            if g < near and a - g > best.get(int(i), -9.0):
                best[int(i)] = float(a - g)
    return best


class Ghost:
    def __init__(self):
        self.meta = json.load(open(META))
        self.net = network()
        self.net.load_state_dict(torch.load(MODEL))
        self.net.eval()

    @staticmethod
    def available():
        return os.path.exists(MODEL) and os.path.exists(META)

    def at_shot(self, view, keepers, shot_frame, attacking_team, home_dir):
        lo = max(0, shot_frame - 8 * HZ - H - 10)
        return standing_off(self.net, segment(view, keepers, lo, shot_frame, home_dir), shot_frame - lo, attacking_team)


def train(seeds=range(100, 106), plain=(31, 32, 33, 34, 35, 36)):
    from .contracts import TYPE
    from .generator.export import match_data
    from .generator.sim import Sim

    shots = (TYPE["goal"], TYPE["attempt_saved"], TYPE["miss"])

    def segs(md):
        out = []
        for per in sorted(set(md["period"].tolist())):
            k = np.flatnonzero(md["period"] == per)
            s = segment(
                dict(pos=md["pos"], ball=md["ball"], live=md["live"], poss=md["poss"], team=md["team"]),
                md["meta"]["keepers"],
                int(k[0]),
                int(k[-1]),
                float(md["home_dir"][k[0]]),
            )
            s["first"] = int(k[0])
            out.append(s)
        return out

    X, Y, V = dataset([s for k in seeds for s in segs(match_data(Sim(seed=k, match_id=f"s_{k}").run()))])
    net = fit(X, Y)
    err = lambda P: round(float(np.median(np.linalg.norm(P - Y, axis=1))), 2)
    tops = []
    for k in plain:  # what is ordinary: the largest stand-off at shots in matches it never saw
        md = match_data(Sim(seed=k, match_id=f"p_{k}").run())
        ids = md["meta"]["ids"]
        for e in md["events"]:
            if e["typeId"] in shots:
                seg = segs(md)[e["periodId"] - 1]
                t1 = int(np.searchsorted(md["clock"][md["period"] == e["periodId"]], e["matchTime"]))
                off = standing_off(net, seg, t1, int(md["team"][ids.index(e["playerId"])]))
                if off:
                    tops.append(max(off.values()))
    torch.save(net.state_dict(), MODEL)
    meta = dict(
        horizon_s=H / HZ,
        fitted_on=f"{len(list(seeds))} generated matches",
        samples=int(len(X)),
        median_error_m=dict(ghost=err(predict(net, X)), keep_pace=err(V), stand_still=err(np.zeros_like(Y))),
        ordinary_shots=len(tops),
        ordinary_top_standoff_m=dict(
            median=round(float(np.median(tops)), 1), p90=round(float(np.percentile(tops, 90)), 1)
        ),
        real_football="leave-one-match-out on the seven DFL matches: artifacts/ghost_real.json",
    )
    json.dump(meta, open(META, "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    train()
