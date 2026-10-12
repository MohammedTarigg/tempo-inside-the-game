"""Train the stake model on the DFL open matches, estimate its quality fairly, and write the artefacts the product loads.

Usage: python3 -u -m tempo.stake.train data/dfl-cache

Fair estimate (nested): each match is scored by a model trained on the other six, and the two card thresholds used on that
match are chosen on those six only, from scores they got from models that had not seen them. Input scaling comes from training
matches only. Threshold rules, fixed in advance:
  faint = the highest grid value that puts the card on at contact for 85 in 100 of challenges by any defender
  full  = the score at which a challenge follows one time in five
The shipped model is then trained on all seven, with thresholds chosen by the same rules from the outer scores."""

import bisect
import json
import os
import sys
import time
import numpy as np
import torch

from . import dfl
from .features import HIST, HZ, window_features
from .model import ARTIFACTS, CardState, Net

STEP = 3
GRID = [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.10]


def build(matches):
    X, Y, M, PID, T, D = [], [], [], [], [], []
    for mi, m in enumerate(matches):
        for H in m["halves"].values():
            for f in range(HIST - 1, H["n"] - 1, STEP):
                if not H["live"][f]:
                    continue
                sl = slice(f - HIST + 1, f + 1)
                idx, feats, dist = window_features(
                    H["xy"][:, sl], H["ball"][sl], H["team"], H["own"], H["poss"][sl], H["live"][sl]
                )
                if not len(idx):
                    continue
                t = H["t0"] + f / HZ
                for k, pi in enumerate(idx):
                    pid = H["ids"][pi]
                    lab = m["labels"].get(pid, [])
                    j = bisect.bisect_left([a for a, _ in lab], t - 0.05)
                    Y.append(1.0 if j < len(lab) and lab[j][0] - t <= 1.5 else 0.0)
                    PID.append(pid)
                X.append(feats)
                M += [mi] * len(idx)
                T += [t] * len(idx)
                D.append(dist)
        print(f"  features: match {mi + 1}/{len(matches)} done", flush=True)
    return np.concatenate(X), np.array(Y, np.float32), np.array(M), np.array(PID), np.array(T), np.concatenate(D)


def fit(X, Y, train_idx, epochs=4, seed=0):
    mu = X[train_idx].mean((0, 2), keepdims=True)
    sd = X[train_idx].std((0, 2), keepdims=True) + 1e-6
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    net = Net()
    opt = torch.optim.Adam(net.parameters(), 1e-3, weight_decay=1e-5)
    yt = torch.from_numpy(Y)
    idx = train_idx.copy()
    for _ in range(epochs):
        rng.shuffle(idx)
        for k in range(0, len(idx), 4096):
            b = idx[k : k + 4096]
            opt.zero_grad()
            torch.nn.functional.binary_cross_entropy_with_logits(
                net(torch.from_numpy((X[b] - mu) / sd)), yt[torch.from_numpy(b)]
            ).backward()
            opt.step()
    net.eval()
    return net, mu, sd


def predict(net, mu, sd, X, idx):
    out = np.zeros(len(idx), np.float32)
    with torch.no_grad():
        for k in range(0, len(idx), 20000):
            out[k : k + 20000] = torch.sigmoid(net(torch.from_numpy((X[idx[k : k + 20000]] - mu) / sd))).numpy()
    return out


def cards(S, order, M, PID, T, faint, full):
    """Run the card logic over time-ordered samples. Returns {(match, player): [(start, end, full_start or None)]}."""
    out, cur, state = {}, None, None
    for a in order:
        k = (M[a], PID[a])
        if k != cur:
            if state is not None and state.level:
                out.setdefault(cur, []).append((state.since, last_t + 0.3, fs))
            cur, state, fs, was = k, CardState(faint, full), None, 0
        lvl = state.update(T[a], float(S[a]))
        if was and not lvl:
            out.setdefault(k, []).append((since, last_t + 0.3, fs))
            fs = None
        if lvl == 2 and fs is None:
            fs = T[a]
        if lvl:
            since = state.since
        was, last_t = lvl, T[a]
    if state is not None and state.level:
        out.setdefault(cur, []).append((state.since, last_t + 0.3, fs))
    return out


def lead(sp, key, a, full=False):
    best = -1.0
    for s, e, fs in sp.get(key, []):
        s0 = fs if full else s
        if s0 is not None and s0 <= a <= e + 0.3:
            best = max(best, a - s0)
    return best


def choose_thresholds(S, Y, mask, M, PID, T, matches, match_ids):
    order = np.lexsort((T, PID, M))
    order = order[mask[order]]
    ch = [(mi, p, a) for mi in match_ids for p, v in matches[mi]["labels"].items() for a, _ in v]
    faint = GRID[0]
    for g in GRID:
        sp = cards(S, order, M, PID, T, g, 9.0)
        if np.mean([lead(sp, (mi, p), a) >= 0 for mi, p, a in ch]) >= 0.85:
            faint = g
    full = 0.5
    for g in np.arange(0.10, 0.45, 0.01):
        k = mask & (S >= g) & (S < g + 0.04)
        if k.sum() > 200 and Y[k].mean() >= 0.20:
            full = float(round(g, 2))
            break
    return faint, full


def auc(p, y):
    o = np.argsort(p, kind="stable")
    r = np.empty(len(p))
    r[o] = np.arange(len(p))
    n1 = y.sum()
    n0 = len(y) - n1
    return float((r[y > 0].sum() - n1 * (n1 - 1) / 2) / (n1 * n0))


def avg_precision(p, y):
    o = np.argsort(-p, kind="stable")
    yy = y[o]
    return float((np.cumsum(yy) / np.arange(1, len(yy) + 1))[yy > 0].mean())


def main(cache):
    t_start = time.time()
    torch.set_num_threads(8)
    matches = dfl.load(cache)
    NM = len(matches)
    print(f"loaded {NM} matches; building features with the shared path", flush=True)
    X, Y, M, PID, T, D = build(matches)
    print(f"samples {len(X):,}, positives {int(Y.sum()):,} ({Y.mean():.2%}), {time.time() - t_start:.0f} s", flush=True)
    booked = np.array(
        [PID[i] in matches[M[i]]["booked"] and T[i] > matches[M[i]]["booked"][PID[i]] for i in range(len(M))]
    )
    S_out = np.zeros(len(X), np.float32)
    chosen, rows, load_rows = [], [], []
    for i in range(NM):
        train = [j for j in range(NM) if j != i]
        S_in = np.zeros(len(X), np.float32)
        for j in train:  # inner loop: fair scores for the six training matches
            tr = np.flatnonzero(np.isin(M, [k for k in train if k != j]))
            te = np.flatnonzero(M == j)
            net, mu, sd = fit(X, Y, tr, epochs=3)
            S_in[te] = predict(net, mu, sd, X, te)
        tr_mask = np.isin(M, train)
        faint, full = choose_thresholds(S_in, Y, tr_mask, M, PID, T, matches, train)
        tr = np.flatnonzero(tr_mask)
        te = np.flatnonzero(M == i)
        net, mu, sd = fit(X, Y, tr)
        S_out[te] = predict(net, mu, sd, X, te)
        chosen.append((faint, full))
        order = np.lexsort((T, PID, M))
        order = order[(M[order] == i) & booked[order]]
        sp = cards(S_out, order, M, PID, T, faint, full)
        for p, v in matches[i]["labels"].items():
            if p in matches[i]["booked"]:
                for a, foul in v:
                    if a > matches[i]["booked"][p]:
                        rows.append((lead(sp, (i, p), a), lead(sp, (i, p), a, full=True), foul))
        nf = sum(len(v) for v in sp.values())
        nF = sum(1 for v in sp.values() for s in v if s[2] is not None)
        load_rows.append((nf, nF, sum(e - s for v in sp.values() for s, e, _ in v)))
        print(
            f"outer match {i + 1}/{NM}: thresholds faint {faint}, full {full}; faint cards {nf}, full {nF}; {time.time() - t_start:.0f} s",
            flush=True,
        )
    lf = np.array([r[0] for r in rows])
    lF = np.array([r[1] for r in rows])
    fl = np.array([r[2] for r in rows])
    rng = np.random.default_rng(0)

    def ci(x):
        b = [rng.choice(x, len(x)).mean() for _ in range(4000)]
        return [float(np.percentile(b, 2.5)), float(np.percentile(b, 97.5))]

    edges = [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1.01]
    ece = sum(
        ((S_out >= a) & (S_out < b)).mean()
        * abs(S_out[(S_out >= a) & (S_out < b)].mean() - Y[(S_out >= a) & (S_out < b)].mean())
        for a, b in zip(edges[:-1], edges[1:])
        if ((S_out >= a) & (S_out < b)).any()
    )
    metrics = dict(
        method="nested: thresholds and scaling chosen on training matches only",
        matches=NM,
        samples=int(len(X)),
        positives=int(Y.sum()),
        roc_auc=auc(S_out, Y),
        average_precision=avg_precision(S_out, Y),
        base_rate=float(Y.mean()),
        calibration_error=float(ece),
        thresholds_per_outer_match=chosen,
        challenges_by_booked=int(len(rows)),
        faint_on_at_contact=float(np.mean(lf >= 0)),
        faint_ci=ci((lf >= 0).astype(float)),
        faint_half_second_before=float(np.mean(lf >= 0.5)),
        faint_one_second_before=float(np.mean(lf >= 1.0)),
        faint_median_lead=float(np.median(lf[lf >= 0])) if (lf >= 0).any() else None,
        full_on_at_contact=float(np.mean(lF >= 0)),
        full_ci=ci((lF >= 0).astype(float)),
        full_median_lead=float(np.median(lF[lF >= 0])) if (lF >= 0).any() else None,
        fouls_faint=int((fl & (lf >= 0)).sum()),
        fouls_full=int((fl & (lF >= 0)).sum()),
        fouls=int(fl.sum()),
        faint_per_match=[r[0] for r in load_rows],
        full_per_match=[r[1] for r in load_rows],
        faint_seconds_per_match=[round(r[2]) for r in load_rows],
    )
    print(json.dumps(metrics, indent=1), flush=True)
    # the shipped model: all seven matches, thresholds by the same rules from the outer scores
    faint, full = choose_thresholds(S_out, Y, np.ones(len(X), bool), M, PID, T, matches, list(range(NM)))
    net, mu, sd = fit(X, Y, np.arange(len(X)))
    os.makedirs(ARTIFACTS, exist_ok=True)
    torch.save(net.state_dict(), os.path.join(ARTIFACTS, "stake_model.pt"))
    json.dump(
        dict(
            mu=mu.ravel().tolist(),
            sd=sd.ravel().tolist(),
            faint_threshold=faint,
            full_threshold=full,
            sample_step_frames=STEP,
            metrics=metrics,
            trained_on="DFL open tracking set, Bassek et al. 2025, CC BY 4.0, https://doi.org/10.6084/m9.figshare.28196177",
            score_quantiles={str(q): float(np.quantile(S_out, q)) for q in (0.5, 0.9, 0.95, 0.99, 0.999)},
        ),
        open(os.path.join(ARTIFACTS, "stake_meta.json"), "w"),
        indent=1,
    )
    print(f"shipped model saved: faint {faint}, full {full}; total {time.time() - t_start:.0f} s", flush=True)


def provisional(cache):
    """A stand-in artefact so the pipeline can be built while the nested run is still going. Same network and data, thresholds
    from the earlier evaluation, no metrics. The nested run overwrites it."""
    torch.set_num_threads(4)
    matches = dfl.load(cache)
    X, Y, M, PID, T, D = build(matches)
    net, mu, sd = fit(X, Y, np.arange(len(X)))
    os.makedirs(ARTIFACTS, exist_ok=True)
    if os.path.exists(os.path.join(ARTIFACTS, "stake_meta.json")) and not json.load(
        open(os.path.join(ARTIFACTS, "stake_meta.json"))
    ).get("provisional"):
        print("a final artefact already exists; leaving it alone")
        return
    torch.save(net.state_dict(), os.path.join(ARTIFACTS, "stake_model.pt"))
    json.dump(
        dict(
            provisional=True,
            mu=mu.ravel().tolist(),
            sd=sd.ravel().tolist(),
            faint_threshold=0.05,
            full_threshold=0.20,
            sample_step_frames=STEP,
            trained_on="DFL open tracking set, Bassek et al. 2025, CC BY 4.0, https://doi.org/10.6084/m9.figshare.28196177",
        ),
        open(os.path.join(ARTIFACTS, "stake_meta.json"), "w"),
        indent=1,
    )
    print("provisional model saved", flush=True)


if __name__ == "__main__":
    provisional(sys.argv[2]) if sys.argv[1] == "--provisional" else main(sys.argv[1])
