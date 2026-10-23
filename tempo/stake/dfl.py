"""The DFL open tracking set (Bassek et al. 2025, CC BY 4.0): seven Bundesliga matches with positions at 25 frames a
second and the official event log. Used only to train and evaluate the stake model and to check the generator. The
product never ingests it.

    tempo data          downloads the 21 files listed in dfl_sources.tsv into data/dfl-open, checks each one against
                        its MD5, and converts every match once into the compact cache in data/dfl-cache"""

import glob
import hashlib
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any

import numpy as np

from ..constants import HZ
from ..jsonio import read_json, write_json


def load(cache):
    matches = []
    for path in sorted(glob.glob(os.path.join(cache, "*.json"))):
        meta = read_json(path)
        z = np.load(path.replace(".json", ".npz"))
        players = meta["players"]
        team_ids = sorted({p["team"] for p in players.values()})
        halves = {}
        for h, hm in meta["halves"].items():
            keep = [i for i, p in enumerate(hm["ids"]) if p in players]  # drops the referee
            ids = [hm["ids"][i] for i in keep]
            xy = z[h + "_xy"][keep].astype(np.float64)
            b = z[h + "_ball"].astype(np.float64)
            team = np.array([team_ids.index(players[p]["team"]) for p in ids])
            live = b[:, 4] == 1
            own = np.zeros(2)
            for t in (0, 1):
                gk = [
                    i
                    for i in np.flatnonzero(team == t)
                    if players[ids[i]]["pos"] == "TW" and not np.all(np.isnan(xy[i, :, 0]))
                ]
                own[t] = np.sign(np.nanmean([np.nanmean(xy[i, :, 0]) for i in gk])) * 52.5
            d = np.hypot(xy[..., 0] - b[None, :, 0], xy[..., 1] - b[None, :, 1])
            nearest_team = team[np.argmin(np.where(np.isnan(d), 1e9, d), 0)]
            poss = np.full(len(b), -1)
            for code in (1, 2):  # the feed's possession code, mapped to a team
                k = (b[:, 3] == code) & live
                if k.any():
                    poss[b[:, 3] == code] = int(np.mean(nearest_team[k] == 1) > 0.5)
            halves[h] = dict(
                ids=ids, team=team, xy=xy, ball=b[:, :3], live=live, poss=poss, own=own, t0=hm["t0"], n=hm["frames"]
            )
        booked = {
            e["Player"]: e["t"] for e in meta["events"] if e["kind"] == "Caution" and e.get("CardColor") == "yellow"
        }
        matches.append(
            dict(
                title=meta["title"],
                players=players,
                events=meta["events"],
                halves=halves,
                booked=booked,
                labels=_labels(meta, halves),
            )
        )
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


SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dfl_sources.tsv")


def fetch(into):
    """Download every listed file not already present and intact."""
    os.makedirs(into, exist_ok=True)
    with open(SOURCES) as f:
        sources = [line.split() for line in f if line.strip()]
    for url, name, md5 in sources:
        path = os.path.join(into, name)
        if os.path.exists(path) and _md5(path) == md5:
            continue
        print("downloading", name, flush=True)
        urllib.request.urlretrieve(url, path + ".part")
        if _md5(path + ".part") != md5:
            raise RuntimeError(f"{name} does not match its checksum")
        os.replace(path + ".part", path)


def _md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def convert(src, out):
    """Each match once, into <match>.npz (ball and player positions per half) and <match>.json (squads, events, the
    first frame's time of each half). A match already in the cache is skipped."""
    os.makedirs(out, exist_ok=True)
    stamp = lambda s: datetime.fromisoformat(s).timestamp()
    for info in sorted(glob.glob(os.path.join(src, "DFL_02_01_*.xml"))):
        found = re.search(r"(DFL-MAT-\w+)\.xml", info)
        if found is None:
            continue
        mid = found.group(1)
        if os.path.exists(os.path.join(out, mid + ".json")):
            continue
        pos = glob.glob(os.path.join(src, f"DFL_04_03_*{mid}.xml"))
        ev = glob.glob(os.path.join(src, f"DFL_03_02_*{mid}.xml"))
        if not pos or not ev:
            print("incomplete", mid)
            continue
        root = ET.parse(info).getroot()
        general = root.find(".//General")
        if general is None:
            raise ValueError(f"{info} has no General block")
        players = {
            p.get("PersonId"): dict(team=t.get("TeamId"), name=p.get("Shortname"), pos=p.get("PlayingPosition"))
            for t in root.iter("Team")
            for p in t.iter("Player")
        }
        events = [
            dict(t=stamp(e.get("EventTime")), kind=c.tag, x=e.get("X-Position"), y=e.get("Y-Position"), **c.attrib)
            for e in ET.parse(ev[0]).getroot().iter("Event")
            for c in _descendants(e)
        ]
        halves: dict[str, list[Any]] = {}
        cur: list[Any] = []  # the frame set being read: section, person, team, its frames, its first frame and time
        for kind, el in ET.iterparse(pos[0], events=("start", "end")):
            if kind == "start" and el.tag == "FrameSet":
                cur = [el.get("GameSection"), el.get("PersonId"), el.get("TeamId"), [], None]
            elif kind == "end" and el.tag == "Frame":
                a = el.attrib
                if cur[4] is None:
                    cur[4] = (int(a["N"]), stamp(a["T"]))
                cur[3].append(
                    (
                        int(a["N"]),
                        float(a["X"]),
                        float(a["Y"]),
                        float(a.get("Z", 0)),
                        float(a.get("BallPossession", 0)),
                        float(a.get("BallStatus", 0)),
                    )
                )
                el.clear()
            elif kind == "end" and el.tag == "FrameSet":
                halves.setdefault(cur[0], []).append((cur[1], cur[2], np.array(cur[3]), cur[4]))
                el.clear()
        arrays = {}
        meta = dict(
            match=mid, title=general.get("MatchTitle"), result=general.get("Result"), players=players, events=events
        )
        meta["halves"] = {}
        for h, sets in halves.items():
            ball = next(s for s in sets if s[1].upper() == "BALL")
            n0, n1 = int(ball[2][0, 0]), int(ball[2][-1, 0])
            n = n1 - n0 + 1
            b = np.full((n, 5), np.nan, np.float32)
            b[ball[2][:, 0].astype(int) - n0] = ball[2][:, 1:6]
            people = [s for s in sets if s[1].upper() != "BALL"]
            xy = np.full((len(people), n, 2), np.nan, np.float32)
            for i, s in enumerate(people):
                f = s[2][:, 0].astype(int)
                keep = (f >= n0) & (f <= n1)
                xy[i, f[keep] - n0] = s[2][keep, 1:3]
            arrays[h + "_ball"], arrays[h + "_xy"] = b, xy
            meta["halves"][h] = dict(ids=[s[0] for s in people], t0=ball[3][1] - (ball[3][0] - n0) / HZ, frames=n)
        np.savez_compressed(os.path.join(out, mid + ".npz"), **arrays)
        write_json(os.path.join(out, mid + ".json"), meta)
        print("converted", mid, meta["title"], meta["result"])


def _descendants(node):
    """Every element under an event, parents before their children, as the feed nests them."""
    for c in node:
        yield c
        yield from _descendants(c)
