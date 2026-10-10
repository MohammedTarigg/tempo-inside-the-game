"""The checks behind the claims. Each one tests a property the design promises, on the demo match, and the result is written to
artifacts/checks.json.

Usage: python3 -m tempo.eval.checks"""
import copy
import json
import os
import shutil
import sys
import tempfile
import time
import numpy as np

from .. import season as seasonmod
from ..agents import FactTools, LocalBackend, ScopeError, verify
from ..contracts import TYPE, event, fact, stable_id
from ..generator.export import from_feed_frame, to_feed_frame
from ..ledger import Ledger
from ..run_match import Pipeline, generate
from ..stake.model import ARTIFACTS, StakeModel

INTERVAL = ("halftime_card", "fulltime_card")


def fresh(md, season, model, tag):
    d = tempfile.mkdtemp(prefix=f"tempo_{tag}_")
    s2, search = seasonmod.load()
    return Pipeline(md, d, model=model, season=season, search=search), d


def cue_ids(p, upto=None):
    return [c["cue_id"] for c in p.ledger.cues(p.meta["match_id"]) if (upto is None or c["match_time"] <= upto)]


def cut(md, n):
    out = dict(md)
    for k in ("pos", "ball", "live", "poss", "period", "clock", "home_dir"):
        out[k] = md[k][:n]
    t = float(md["clock"][n - 1]); per = int(md["period"][n - 1])
    out["events"] = [e for e in md["events"] if (e["periodId"] < per) or (e["periodId"] == per and e["matchTime"] <= t)]
    out["commentary"] = [c for c in md["commentary"] if c["matchTime"] <= t]
    return out


def main():
    results = []
    def record(name, ok, detail):
        results.append(dict(check=name, passed=bool(ok), detail=detail)); print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}", flush=True)
    model = StakeModel()
    season, _ = seasonmod.load()
    md = generate()
    planted = md["planted"]
    t0 = time.time()
    full, d_full = fresh(md, season, model, "full"); full.run(); summary = full.finish(time.time() - t0)
    ids_full = cue_ids(full); cues_full = full.ledger.cues(md["meta"]["match_id"])

    # 1. no reading ahead: a run that never receives the rest of the match makes the same cues up to that point
    for frac in (0.35, 0.8):
        n = int(len(md["clock"]) * frac); t_cut = float(md["clock"][n - 1])
        part, d = fresh(cut(md, n), season, model, "cut"); part.run()
        a = [c["cue_id"] for c in part.ledger.cues(md["meta"]["match_id"]) if c["form"] not in INTERVAL or c["match_time"] < t_cut - 1]
        b = [c["cue_id"] for c in cues_full if c["match_time"] <= t_cut and (c["form"] not in INTERVAL or c["match_time"] < t_cut - 1)]
        record(f"no reading ahead, match cut at {frac:.0%}", a == b, f"{len(a)} cues with the future removed, {len(b)} in the full run up to minute {t_cut / 60:.0f}, identical: {a == b}")
        shutil.rmtree(d, ignore_errors=True)

    # 2. recovery: stop the process mid-match, start a new one on the same store, and finish
    for frac in (0.3, 0.77):
        stop = int(len(md["clock"]) * frac)
        first, d = fresh(md, season, model, "crash"); first.run(stop_at=stop); first.ledger.db.close()
        s2, search = seasonmod.load()
        second = Pipeline(md, d, model=model, season=season, search=search)
        start = second.resume(); second.run(start=start)
        ids = cue_ids(second)
        record(f"recovery after a stop at {frac:.0%}", ids == ids_full, f"resumed from frame {start:,} of {len(md['clock']):,}; {len(ids)} cues against {len(ids_full)} uninterrupted; same IDs in the same order: {ids == ids_full}")
        shutil.rmtree(d, ignore_errors=True)

    # 3. the storyline that was planted is what the pipeline reports
    facts = full.ledger.facts(md["meta"]["match_id"], 1e9)
    ca = [f for f in facts if f["kind"] == "closest_attempt"]
    booking = next(p for p in planted if p["kind"] == "booking")
    step = next(p for p in planted if p["kind"] == "attack" and p["variant"] == "step")
    card = [f for f in facts if f["kind"] == "card" and f["subject"] == booking["player"]]
    ok = bool(ca) and ca[0]["differing_player"] == booking["player"] and 0 <= ca[0]["earlier_time"] - step["restart"] <= 15 and bool(card) and abs(card[0]["match_time"] - booking["matchTime"]) < 1
    record("the planted story is found", ok, f"booking at {card[0]['match_time'] / 60:.1f}' (planted {booking['matchTime'] / 60:.1f}'); closest earlier attempt at {ca[0]['earlier_time'] / 60:.1f}' (planted {step['restart'] / 60:.1f}'); first relevant difference {ca[0]['differing_player']} by {ca[0]['differing_by_m']} m" if ca and card else "missing")
    stahl_cards = [c for c in cues_full if c["form"] == "stake_card" and c["payload"]["player"] == booking["player"] and c["payload"]["level"] > 0]
    record("no stake card before the booking", all(c["match_time"] >= booking["matchTime"] for c in stahl_cards) and len(stahl_cards) > 0, f"{len(stahl_cards)} card changes for the booked player, the first at {min(c['match_time'] for c in stahl_cards) / 60:.1f}'")

    # 4. the verifier against planted errors
    names = md["meta"]["names"]
    sents = [(c["payload"]["text"], [full.ledger.get_fact(i) for i in c["fact_ids"]], c["payload"]["lang"], c["payload"]["numbers"]) for c in cues_full if c["form"] == "sentence" and c["screen"] == "phone"]
    rng = np.random.default_rng(0)
    clean_ok = sum(verify(t, [f for f in fs if f], names, allowed_numbers=want, expected=want)[0] for t, fs, _, want in sents)
    caught = total = 0
    kinds = {"number": 0, "name": 0, "overclaim": 0, "arabic digit": 0}
    import re
    for text, fs, lang, want in sents * 12:
        fs = [f for f in fs if f]
        nums = re.findall(r"\d+(?:\.\d+)?", text)
        mode = rng.choice(["number", "name", "overclaim", "arabic digit"] if lang == "ar" else ["number", "name", "overclaim"])
        if mode == "number" and nums:
            x = rng.choice(nums); bad = text.replace(x, str(int(float(x)) + int(rng.integers(3, 40))), 1)
        elif mode == "name":
            present = [n for n in names.values() if n in text]
            other = [n for n in names.values() if n not in text]
            if not present:
                continue
            bad = text.replace(present[0], str(rng.choice(other)))
        elif mode == "overclaim":
            bad = text + (" لأن الفريق متعب دائما." if lang == "ar" else " He will score again because he always does.")
        elif mode == "arabic digit" and nums:
            x = rng.choice(nums); bad = text.replace(x, str(int(float(x)) + 7).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")), 1)
        else:
            continue
        total += 1; hit = not verify(bad, fs, names, allowed_numbers=want, expected=want)[0]; caught += hit; kinds[mode] += 1
    record("verifier accepts what the pipeline wrote", clean_ok == len(sents), f"{clean_ok} of {len(sents)} sentences pass")
    record("verifier rejects planted errors", caught == total and total >= 100, f"{caught} of {total} caught ({kinds})")

    # 5. agent scoping, enforced by identity
    L = full.ledger; t_end = float(md["clock"][-1])
    home = FactTools(L, md["meta"], "home", md["meta"]["home"]["id"], t_end)
    refused = 0
    try:
        home.get_player_ledger(md["meta"]["away"]["players"][5]["playerId"])
    except ScopeError:
        refused += 1
    early = FactTools(L, md["meta"], "home", md["meta"]["home"]["id"], 600.0)
    try:
        early.get_player_ledger(md["meta"]["home"]["players"][5]["playerId"], as_of=601.0)
    except ScopeError:
        refused += 1
    try:
        home.get_on_air_state()
    except ScopeError:
        refused += 1
    leak = [f for f in early.get_player_ledger(md["meta"]["home"]["players"][8]["playerId"]) if f["match_time"] > 600]
    record("agent tools refuse out-of-scope reads", refused == 3 and not leak, f"{refused} of 3 refused (other team's player, one second after the moment, the Director's tool); facts leaked from after the moment: {len(leak)}")

    # 6. a yellow card taken back by the feed 40 seconds later
    md2 = copy.copy(md); ev = list(md["events"])
    k = next(i for i, e in enumerate(ev) if e["typeId"] == TYPE["card"] and e["playerId"] == booking["player"])
    c_ev = ev[k]; fid = stable_id("f", md["meta"]["match_id"], "card", c_ev["playerId"], round(float(c_ev["matchTime"]), 1))
    dele = event(md["meta"]["match_id"], 900000, "deleted", c_ev["periodId"], c_ev["matchTime"] + 40, c_ev["contestantId"], c_ev["playerId"], 0, 0, deletes_fact_ids=[fid])
    j = next(i for i, e in enumerate(ev) if e["periodId"] == c_ev["periodId"] and e["matchTime"] > dele["matchTime"])
    ev.insert(j, dele); md2["events"] = ev
    corr, d = fresh(md2, season, model, "corr"); corr.run()
    cc = corr.ledger.cues(md["meta"]["match_id"])
    after = [c for c in cc if c["form"] == "stake_card" and c["payload"]["player"] == c_ev["playerId"] and c["payload"]["level"] > 0 and c["match_time"] > dele["matchTime"]]
    before = [c for c in cc if fid in c["fact_ids"] and c["match_time"] <= dele["matchTime"]]
    goal_sent = [c["payload"]["text"] for c in cc if c["form"] == "sentence" and c["screen"] == "phone" and c["payload"].get("lang") == "en" and "closest earlier attempt" in c["payload"]["text"]]
    clean = bool(goal_sent) and not any("had been booked" in t for t in goal_sent)
    record("a withdrawn booking withdraws its cards", not after and all(c["status"] == "withdrawn" for c in before) and len(before) > 0 and clean,
           f"{len(before)} cues resting on the card were withdrawn; cards on him afterwards: {len(after)}; the goal's sentence no longer says he had been booked: {clean} ({len(goal_sent)} sentences checked)")
    shutil.rmtree(d, ignore_errors=True)

    # 7. feed contract: a frame survives the trip through the provider's shape
    ok = True
    for i in rng.integers(0, len(md["clock"]), 200):
        pos, ball, live, poss = from_feed_frame(to_feed_frame(md, int(i)), md["meta"]["ids"])
        ok &= np.allclose(np.nan_to_num(pos), np.nan_to_num(md["pos"][i]), atol=0.006) and np.allclose(ball, md["ball"][i], atol=0.006) and live == bool(md["live"][i]) and poss == int(md["poss"][i])
    record("tracking survives the feed shape", ok, "200 random frames written in the Second Spectrum shape and read back")

    # 8. speed
    fm = summary["frame_ms"]; wm = summary["writer_ms"]
    record("reflex path under 10 ms a frame", fm["p99"] < 10, f"p50 {fm['p50']} ms, p95 {fm['p95']} ms, p99 {fm['p99']} ms, slowest {fm['max']} ms, features and network included")
    record("writing path well inside the replay window", max(wm) < 10000, f"{len(wm)} moments, slowest {max(wm):.1f} ms with the local backend (a cloud model will be slower; the limit is 10 s)")

    # 9. load and counts
    sc = summary["stake_cards"]
    issued_full = sum(1 for c in cues_full if c["form"] == "stake_card" and c["payload"]["level"] == 2)
    cap = full.cues.rules["stake_full_cap_per_match"]
    record("full stake cards issued stay within the match cap", issued_full <= cap, f"{issued_full} full cards issued against a cap of {cap}. The model wanted {sc['full']} across {len(sc['players'])} booked players, with {sc['appearances']} card appearances in all, which is above the real rate (see the realism check)")
    shutil.rmtree(d_full, ignore_errors=True)
    out = dict(ran_at=time.strftime("%Y-%m-%d %H:%M"), stake_model_provisional=bool(model.meta.get("provisional")), passed=sum(r["passed"] for r in results), total=len(results), results=results, demo_summary=summary)
    json.dump(out, open(os.path.join(ARTIFACTS, "checks.json"), "w"), indent=1, default=float)
    print(f"\n{out['passed']} of {out['total']} checks passed")
    return out


if __name__ == "__main__":
    main()
