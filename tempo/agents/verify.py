"""The Verifier: code that holds every sentence to the facts it cites, by position, before it leaves."""

import re

OVERCLAIM = [
    "because",
    "always",
    "never fails",
    "will score",
    "will be sent",
    "guarantee",
    "certain to",
    "لأن",
    "دائما",
    "سوف",
]
# Words that claim a record. A sentence may use one only when it cites a season-best fact.
SUPERLATIVE = ["fastest", "longest", "the most", "record", "season best", "best ever", "أسرع تسديدة", "رقم قياسي"]
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _numbers(text):
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text.translate(AR_DIGITS))]


def verify(text, facts, names, allowed_numbers=(), expected=None, expected_names=None):
    """Code check. Returns (ok, reasons).
    - Every number in the text must come from a cited fact.
    - When `expected` is given (the ordered numbers the facts dictate for this sentence), the text must contain exactly
      those, in that order. This catches a real number used in the wrong place.
    - Every player named must be in a cited fact. When `expected_names` is given (the players the facts dictate for this
      sentence, in order), the text must name exactly those, in that order. This catches a real player named in the
      wrong place.
    - No wording may claim more than a fact holds."""
    pool = {float(x) for x in allowed_numbers}
    people = set()
    for f in facts:
        people.add(f["subject"])
        people.update(str(f.get(k)) for k in ("differing_player", "earlier_player") if f.get(k))
        vals = [
            f["value"],
            f.get("percentile"),
            f.get("differing_by_m"),
            f.get("gap_m"),
            f["match_time"] // 60 + 1,
            f.get("top_speed"),
        ]
        if f.get("earlier_time") is not None:
            vals.append(f["earlier_time"] // 60 + 1)
        for v in vals:
            for x in v if isinstance(v, (list, tuple)) else [v]:
                if isinstance(x, (int, float)):
                    pool.update({float(x), round(float(x), 1), float(round(x))})
    reasons = []
    found = _numbers(text)
    for x in found:
        if not any(abs(x - p) < 0.051 for p in pool):
            reasons.append(f"number {x:g} is not in the cited facts")
    if expected is not None:
        want = [float(x) for x in expected]
        if len(found) != len(want) or any(abs(a - b) >= 0.051 for a, b in zip(found, want, strict=True)):
            reasons.append(f"the numbers {found} are not the ones the facts give for this sentence, in order: {want}")
    for pid, nms in names.items():
        for nm in [nms] if isinstance(nms, str) else nms:
            if nm in text and not any(pid in s.split("|") for s in people):
                reasons.append(f"{nm} is named but no cited fact is about him")
    if expected_names is not None:
        hits = sorted(
            (m.start(), pid)
            for pid, nms in names.items()
            for nm in ([nms] if isinstance(nms, str) else nms)
            for m in re.finditer(re.escape(nm), text)
        )
        if [pid for _, pid in hits] != list(expected_names):
            reasons.append(
                f"the players named are not the ones the facts give for this sentence, in order: {list(expected_names)}"
            )
    low = text.lower()
    reasons += [f"claims more than the facts hold: '{w}'" for w in OVERCLAIM if w in low]
    if not any(f["kind"] == "season_best" for f in facts):
        reasons += [f"claims a record no cited fact holds: '{w}'" for w in SUPERLATIVE if w in low]
    return not reasons, reasons
