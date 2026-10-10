"""Reader for the DFL open tracking set (Bassek et al. 2025, CC BY 4.0), from the compact cache made by spike/real-data/convert.py.
Used only to train and evaluate the stake model and to check the generator. The product never ingests it."""
import glob
import json
import os
import numpy as np

HZ = 25


def load(cache):
    matches = []
    for path in sorted(glob.glob(os.path.join(cache, "*.json"))):
        meta = json.load(open(path))
        z = np.load(path.replace(".json", ".npz"))
        players = meta["players"]
        team_ids = sorted({p["team"] for p in players.values()})
        halves = {}
        for h, hm in meta["halves"].items():
            keep = [i for i, p in enumerate(hm["ids"]) if p in players]          # drops the referee
            ids = [hm["ids"][i] for i in keep]
            xy = z[h + "_xy"][keep].astype(np.float64)
            b = z[h + "_ball"].astype(np.float64)
            team = np.array([team_ids.index(players[p]["team"]) for p in ids])
            live = b[:, 4] == 1
            own = np.zeros(2)
            for t in (0, 1):
                gk = [i for i in np.flatnonzero(team == t) if players[ids[i]]["pos"] == "TW" and not np.all(np.isnan(xy[i, :, 0]))]
                own[t] = np.sign(np.nanmean([np.nanmean(xy[i, :, 0]) for i in gk])) * 52.5
            d = np.hypot(xy[..., 0] - b[None, :, 0], xy[..., 1] - b[None, :, 1])
            nearest_team = team[np.argmin(np.where(np.isnan(d), 1e9, d), 0)]
            poss = np.full(len(b), -1)
            for code in (1, 2):                                                    # the feed's possession code, mapped to a team
                k = (b[:, 3] == code) & live
                if k.any():
                    poss[b[:, 3] == code] = int(np.mean(nearest_team[k] == 1) > 0.5)
            halves[h] = dict(ids=ids, team=team, xy=xy, ball=b[:, :3], live=live, poss=poss, own=own, t0=hm["t0"], n=hm["frames"])
        booked = {e["Player"]: e["t"] for e in meta["events"] if e["kind"] == "Caution" and e.get("CardColor") == "yellow"}
        matches.append(dict(title=meta["title"], players=players, events=meta["events"], halves=halves, booked=booked, labels=_labels(meta, halves)))
    return matches


def _labels(meta, halves):
    """Defending ground duels and fouls per player, with the contact time taken from tracking."""
    raw = []
    for e in meta["events"]:
        if e["kind"] == "TacklingGame" and e.get("Type") in ("ground", "atTheFoot"):
            for k, o in (("Winner", "Loser"), ("Loser", "Winner")):
                if e.get(k + "Role") == "withoutBallControl":
                    raw.append((e["t"], e.get(k), e.get(o), e.get("WinnerResult") == "fouled"))
        elif e["kind"] == "Foul" and e.get("Fouler") and e.get("Fouled"):
            raw.append((e["t"], e["Fouler"], e["Fouled"], True))
    out = {}
    for t, p, o, foul in raw:
        for H in halves.values():
            if p in H["ids"] and o in H["ids"] and H["t0"] <= t <= H["t0"] + H["n"] / HZ:
                a = max(int((t - 3 - H["t0"]) * HZ), 0)
                b = int((t + 2 - H["t0"]) * HZ)
                dd = np.hypot(*(H["xy"][H["ids"].index(p), a:b] - H["xy"][H["ids"].index(o), a:b]).T)
                if len(dd) == 0 or np.all(np.isnan(dd)):
                    continue
                near = np.flatnonzero(dd < 1.0)
                i = near[0] if len(near) else int(np.nanargmin(dd))
                out.setdefault(p, []).append([H["t0"] + (a + i) / HZ, foul])
    for p, v in out.items():
        v.sort()
        merged = []
        for t, foul in v:
            if merged and t - merged[-1][0] < 3:
                merged[-1][1] |= foul
            else:
                merged.append([t, foul])
        out[p] = merged
    return out
