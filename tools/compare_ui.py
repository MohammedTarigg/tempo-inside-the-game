"""usage: python3 cmp_ui.py <dirA> <dirB>   compares two check_ui outputs: report.json fields, and how far each still differs"""

import json
import sys

a, b = sys.argv[1:3]
ra, rb = json.load(open(f"{a}/report.json")), json.load(open(f"{b}/report.json"))
print("film", "same" if ra.get("film") == rb.get("film") else f"DIFF {ra.get('film')} vs {rb.get('film')}")
for pa, pb in zip(ra["pages"], rb["pages"]):
    sa, sb = pa.get("states", pa.get("state")), pb.get("states", pb.get("state"))
    if sa != sb or pa["problems"] != pb["problems"]:
        print("DIFF", pa["page"])
        if isinstance(sa, list):
            for x, y in zip(sa, sb):
                if x != y:
                    print("   ", {k: (x[k], y[k]) for k in x if x[k] != y.get(k)})
        else:
            print("   ", sa, "|", sb)
        if pb["problems"]:
            print("    problems:", pb["problems"][:3])
print("pages", len(ra["pages"]), len(rb["pages"]), "fatal:", rb.get("fatal"))
