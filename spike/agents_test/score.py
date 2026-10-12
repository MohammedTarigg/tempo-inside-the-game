"""Scores the investigator runs. A run names a cause when it gives a player and at least 0.5 confidence.
Planted case: right when it names the planted player. Control: right when it names nobody.
The gate takes a pair of independent runs and names a cause only when both name the same player."""
import json, os, sys
cases, runs = sys.argv[1], sys.argv[2]
truth = json.load(open(os.path.join(cases, "_truth.json"))); table = {}; rows = []
for c, t in truth.items():
    for k in ("raw", "inst"):
        named = []
        for r in (1, 2):
            d = os.path.join(runs, f"{c}_{k}_{r}")
            try:
                v = json.load(open(os.path.join(d, "verdict.json"))); o = json.load(open(os.path.join(d, "_out.json")))
            except Exception as e:
                rows.append(dict(case=c, kind=k, run=r, error=str(e)[:60])); named.append("ERROR"); continue
            p = v.get("player_id") if v.get("cause_type") != "no_clear_cause" and float(v.get("confidence") or 0) >= 0.5 else None
            named.append(p)
            rows.append(dict(case=c, kind=k, run=r, planted=t["planted"], cause=v.get("cause_type"), player=v.get("player_id"), conf=v.get("confidence"), named=p, right=(p == t["player"]),
                             turns=o.get("num_turns"), seconds=round(o.get("duration_ms", 0) / 1000), usd=round(o.get("total_cost_usd", 0), 2), sentence=v.get("one_sentence", "")[:150]))
        gate = named[0] if named[0] == named[1] else None
        table[(c, k)] = dict(planted=t["planted"], want=t["player"], runs=named, gate=gate)
for r in rows:
    print(r)
print()
for k in ("raw", "inst"):
    ok = [r for r in rows if r["kind"] == k and "error" not in r]
    P = [r for r in ok if r["planted"]]; C = [r for r in ok if not r["planted"]]
    gp = [v for (c, kk), v in table.items() if kk == k and v["planted"]]; gc = [v for (c, kk), v in table.items() if kk == k and not v["planted"]]
    print(k, "| single run: planted found", sum(r["right"] for r in P), "of", len(P), "| wrong player on planted", sum(1 for r in P if r["named"] and not r["right"]), "| false cause on controls", sum(1 for r in C if r["named"]), "of", len(C),
          "| mean turns", round(sum(r["turns"] for r in ok) / max(len(ok), 1), 1), "mean s", round(sum(r["seconds"] for r in ok) / max(len(ok), 1)), "mean usd", round(sum(r["usd"] for r in ok) / max(len(ok), 1), 2))
    print(k, "| pair with gate: planted found", sum(v["gate"] == v["want"] for v in gp), "of", len(gp), "| false cause on controls", sum(1 for v in gc if v["gate"]), "of", len(gc), "| pairs that disagreed", sum(1 for v in gp + gc if v["runs"][0] != v["runs"][1]))
json.dump(dict(rows=rows, pairs={f"{c}:{k}": v for (c, k), v in table.items()}), open("artifacts/agents_test.json", "w"), indent=1)
