"""The writing path and its checks.

Which facts belong to a moment is decided by code. A writer turns them into one sentence per language, and the Verifier holds
every sentence to the facts before it leaves. FactTools are the read-only tools an agent gets: nothing after the moment's own
match time, and scope taken from who is calling. The agents themselves (two investigators and a gate, for a turn nobody
scripted) are described in 01-architecture.md section 6 and are not in this build.

Model calls go through a Backend. LocalBackend writes from templates, so the whole pipeline runs with no cloud and serves as the
fallback when a model is slow or down. FoundryBackend is the seam for a model on Azure AI Foundry."""

import re
import time

from .contracts import fact


class ScopeError(Exception):
    pass


class FactTools:
    """Read-only tools over the fact ledger. Scope comes from the identity bound here, never from an argument."""

    def __init__(self, ledger, meta, role, team_id, as_of):
        self.ledger, self.meta, self.role, self.team_id, self.as_of = ledger, meta, role, team_id, as_of
        self.match_id = meta["match_id"]

    def _check_player(self, pid):
        if self.role in ("home", "away") and self.meta["team_of"].get(pid) != self.team_id:
            self.ledger.audit(self.as_of, "scope_refused", dict(role=self.role, asked_for=pid))
            raise ScopeError(f"{self.role} agent may not read {pid}")

    def _check_time(self, t):
        if t > self.as_of + 1e-6:
            self.ledger.audit(self.as_of, "time_refused", dict(role=self.role, asked_for=t))
            raise ScopeError("facts after the moment are not readable")

    def get_moment(self, fact_ids):
        return [f for f in (self.ledger.get_fact(i) for i in fact_ids) if f and f["match_time"] <= self.as_of + 1e-6]

    def get_player_ledger(self, pid, as_of=None):
        self._check_player(pid)
        self._check_time(as_of or self.as_of)
        return self.ledger.facts(self.match_id, as_of or self.as_of, subject=pid)

    def get_open_threads(self, as_of=None):
        self._check_time(as_of or self.as_of)
        t = as_of or self.as_of
        cards = [f for f in self.ledger.facts(self.match_id, t, kind="card") if f["value"] == "yellow"]
        if self.role in ("home", "away"):
            cards = [f for f in cards if self.meta["team_of"].get(f["subject"]) == self.team_id]
        duels = self.ledger.facts(self.match_id, t, kind="duel_count")
        return dict(booked=cards, duels=duels[-3:])

    def get_on_air_state(self, as_of=None):
        if self.role != "director":
            raise ScopeError("only the Director reads what is on air")
        self._check_time(as_of or self.as_of)
        return [c for c in self.ledger.cues(self.match_id) if c["match_time"] <= (as_of or self.as_of)][-8:]

    def get_season_habit(self, subject):
        return [f for f in self.ledger.facts(self.match_id, self.as_of, kind="habit") if f["subject"] == subject]


# ---------------- backends ----------------
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
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


class LocalBackend:
    """Deterministic writer. Every sentence is assembled from the facts it is given, so it passes the Verifier by construction.
    A sentence states facts side by side. It never says one caused another."""

    name = "local-templates"

    def narrate(self, kind, ctx, lang="en"):
        n = ctx["names_ar"] if lang == "ar" else ctx.get("names", {})
        if kind == "card":
            p = n[ctx["player"]]
            m = ctx["minute"]
            return {
                "en": f"{p} is booked in minute {m}. One more foul is a red card.",
                "ar": f"إنذار لـ{p} في الدقيقة {m}. مخالفة أخرى تعني بطاقة حمراء.",
            }[lang]
        if kind == "goal":
            p = n[ctx["player"]]
            a, b = ctx["score"]
            text = {
                "en": f"{p} scores in minute {ctx['minute']}. It is {a}-{b}.",
                "ar": f"{p} يسجل في الدقيقة {ctx['minute']}. النتيجة {a}-{b}.",
            }[lang]
            ca = ctx.get("closest")
            if not ca:
                return text
            d = n[ca["differing_player"]]
            if lang == "ar":
                text += f" أقرب محاولة سابقة كانت في الدقيقة {ca['earlier_minute']} ولم تنته بهدف."
                text += (
                    f" هذه المرة وقف {d} على بعد {ca['differing_by_m']} متر من موقعه حينها."
                    if ctx.get("booked_minute")
                    else f" أكبر فرق: وقف {d} على بعد {ca['differing_by_m']} متر من موقعه حينها."
                )
                if ctx.get("booked_minute"):
                    text += f" كان قد تلقى إنذارا في الدقيقة {ctx['booked_minute']}."
            else:
                text += f" The closest earlier attempt came in minute {ca['earlier_minute']} and did not go in."
                text += (
                    f" This time {d} stood {ca['differing_by_m']} m from where he was then."
                    if ctx.get("booked_minute")
                    else f" The biggest difference: {d} stood {ca['differing_by_m']} m from where he was then."
                )
                if ctx.get("booked_minute"):
                    text += f" He had been booked in minute {ctx['booked_minute']}."
            return text
        if kind == "pressure":
            pr = ctx["pressure"]
            if lang == "ar":
                return f"خلال آخر {pr['window_min']} دقائق كان {pr['now']} من كل 100 من اللعب في نصف ملعب {ctx['other_name_ar']}، مقابل {pr['before']} قبلها."
            return f"{ctx['team_name']} have had {pr['now']} in 100 of the play in {ctx['other_name']}'s half over the last {pr['window_min']} minutes, up from {pr['before']}."
        if kind == "form":
            p = n[ctx["player"]]
            return {
                "en": f"{p}: {ctx['per_minute']} m a minute in play, top speed {ctx['top_speed']} m/s.",
                "ar": f"{p}: {ctx['per_minute']} متر في الدقيقة، أقصى سرعة {ctx['top_speed']} م/ث.",
            }[lang]
        return ""

    @staticmethod
    def numbers(kind, ctx, lang="en"):
        """The numbers a sentence of this kind must contain, in order, taken from the facts. The Verifier holds the text to this
        list, so a number that is real but belongs to a different fact is still caught."""
        if kind == "card":
            return [ctx["minute"]]
        if kind == "pressure":
            pr = ctx["pressure"]
            return (
                [pr["window_min"], pr["now"], 100, pr["before"]]
                if lang == "ar"
                else [pr["now"], 100, pr["window_min"], pr["before"]]
            )
        if kind == "form":
            return [ctx["per_minute"], ctx["top_speed"]]
        if kind == "goal":
            out = [ctx["minute"], *ctx["score"]]
            ca = ctx.get("closest")
            if ca:
                out += [ca["earlier_minute"], ca["differing_by_m"]] + (
                    [ctx["booked_minute"]] if ctx.get("booked_minute") else []
                )
            return out
        return []

    @staticmethod
    def who(kind, ctx):
        """The players a sentence of this kind must name, in order. As with numbers, the Verifier holds the text to this list:
        a player who is in a cited fact but does not belong in this sentence is still caught."""
        if kind in ("card", "form"):
            return [ctx["player"]]
        if kind == "goal":
            return [ctx["player"]] + ([ctx["closest"]["differing_player"]] if ctx.get("closest") else [])
        return []

    @staticmethod
    def proof(kind, ctx, lang="en"):
        """What stands behind the line, as data and not prose: each item is one fact with its number. This is what a viewer who
        wants more gets, in place of a longer sentence."""
        ar = lang == "ar"
        n = ctx["names_ar"] if ar else ctx.get("names", {})
        m_unit = "م" if ar else "m"
        out = []
        if kind == "goal":
            ca = ctx.get("closest")
            if ca:
                d = n[ca["differing_player"]]
                out.append(
                    dict(
                        icon="attempt",
                        fact_id=ca["fact_id"],
                        title=f"الهجمة نفسها، الدقيقة {ca['earlier_minute']}"
                        if ar
                        else f"Same attack, minute {ca['earlier_minute']}",
                        value=f"{ca['differing_by_m']} {m_unit}",
                        note=f"بين موقع {d} حينها وموقعه الآن" if ar else f"between where {d} stood then and now",
                    )
                )
            g = ctx.get("ghost")
            if g and ctx.get("booked_minute"):
                d = n[g["player"]]
                out.append(
                    dict(
                        icon="ghost",
                        fact_id=g["fact_id"],
                        title="مدافع عادي" if ar else "An average defender",
                        value=f"{g['off_m']} {m_unit}",
                        note=f"أقرب إلى الكرة من موقع {d}" if ar else f"closer to the ball than {d} stood",
                    )
                )
                out.append(
                    dict(
                        icon="card",
                        fact_id=ctx["booked_fact"],
                        title=f"إنذار، الدقيقة {ctx['booked_minute']}"
                        if ar
                        else f"Booked, minute {ctx['booked_minute']}",
                        value="",
                        note="مخالفة أخرى تعني بطاقة حمراء" if ar else "One more foul is a red card",
                    )
                )
            sp = ctx.get("shot_speed")
            if sp and not ca:
                out.append(
                    dict(
                        icon="speed",
                        fact_id=sp["fact_id"],
                        title="سرعة التسديدة" if ar else "Shot speed",
                        value=f"{sp['value']:.0f} {'كم/س' if ar else 'km/h'}",
                        note=(
                            f"أسرع من {sp['percentile']:.0f} من كل 100 تسديدة هذا الموسم"
                            if ar
                            else f"faster than {sp['percentile']:.0f} in 100 shots this season"
                        )
                        if sp.get("percentile") is not None
                        else "",
                    )
                )
        elif kind == "pressure":
            pr = ctx["pressure"]
            out.append(
                dict(
                    icon="share",
                    fact_id=pr["fact_id"],
                    title=f"اللعب في نصف ملعب {ctx['other_name_ar']}" if ar else f"Play in {ctx['other_name']}'s half",
                    value=f"{pr['now']} من 100" if ar else f"{pr['now']} in 100",
                    note=f"مقابل {pr['before']} في الدقائق {pr['window_min']} السابقة"
                    if ar
                    else f"up from {pr['before']} in the {pr['window_min']} minutes before",
                )
            )
            if pr["won_high"] >= 2:
                out.append(
                    dict(
                        icon="won",
                        fact_id=pr["fact_id"],
                        title="استعادة الكرة هناك" if ar else "Ball won there",
                        value=str(pr["won_high"]),
                        note=f"مرات في {pr['window_min']} دقائق" if ar else f"times in {pr['window_min']} minutes",
                    )
                )
        elif kind == "card":
            out.append(
                dict(
                    icon="card",
                    fact_id=ctx["card_fact"],
                    title=f"إنذار، الدقيقة {ctx['minute']}" if ar else f"Booked, minute {ctx['minute']}",
                    value="",
                    note="مخالفة أخرى تعني بطاقة حمراء" if ar else "One more foul is a red card",
                )
            )
        return out

    def label(self, kind, ctx):
        n = ctx.get("names", {})
        if kind == "goal" and ctx.get("closest"):
            return f"Closest earlier attempt: {ctx['closest']['earlier_minute']}'"
        if kind == "goal":
            return f"{n[ctx['player']]} {ctx['score'][0]}-{ctx['score'][1]}"
        if kind == "card":
            return f"{n[ctx['player']]} booked"
        if kind == "pressure":
            return f"{ctx['team_name']} on top"
        return ""


class FoundryBackend:
    """Seam for Microsoft Agent Framework on Azure AI Foundry. Not wired in this local build: it needs the subscription."""

    name = "foundry"

    def __init__(self):
        raise NotImplementedError(
            "FoundryBackend needs an Azure subscription and is wired on day one; the local backend is the fallback path"
        )


class Breaker:
    """Three failures or timeouts inside 60 seconds open it for 120. While open no call is tried. Then one probe is let through."""

    def __init__(self, limit=3, window=60.0, cool=120.0):
        self.limit, self.window, self.cool, self.fails, self.open_until = limit, window, cool, [], 0.0

    def call(self, fn, fallback, timeout, now=None):
        now = time.monotonic() if now is None else now
        if now < self.open_until:
            return fallback(), "breaker_open"
        t0 = time.monotonic()
        try:
            out = fn()
            if time.monotonic() - t0 > timeout:
                raise TimeoutError
            return out, "ok"
        except Exception:
            self.fails = [x for x in self.fails if now - x < self.window] + [now]
            if len(self.fails) >= self.limit:
                self.open_until = now + self.cool
            return fallback(), "fallback"


# ---------------- verifier ----------------
def _numbers(text):
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text.translate(AR_DIGITS))]


def verify(text, facts, names, allowed_numbers=(), expected=None, expected_names=None):
    """Code check. Returns (ok, reasons).
    - Every number in the text must come from a cited fact.
    - When `expected` is given (the ordered numbers the facts dictate for this sentence), the text must contain exactly those,
      in that order. This catches a real number used in the wrong place.
    - Every player named must be in a cited fact. When `expected_names` is given (the players the facts dictate for this
      sentence, in order), the text must name exactly those, in that order. This catches a real player named in the wrong place.
    - No wording may claim more than a fact holds."""
    pool = set(float(x) for x in allowed_numbers)
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
        if len(found) != len(want) or any(abs(a - b) >= 0.051 for a, b in zip(found, want)):
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
    return not reasons, reasons


# ---------------- the workflow ----------------
class Writer:
    """The writing path for a moment whose kind is known: which facts belong together is decided by code, the sentence is one
    writer call per language, and every sentence is checked before it leaves. A checkpoint after each step lets a restart resume."""

    def __init__(self, ledger, cues, meta, backend=None):
        self.ledger, self.cues, self.meta = ledger, cues, meta
        self.backend, self.fallback, self.breaker = backend or LocalBackend(), LocalBackend(), Breaker()
        self.names = {
            pid: (nm, meta["names_ar"][pid]) for pid, nm in meta["names"].items()
        }  # the Verifier knows a player by either spelling
        self.timings = []

    @staticmethod
    def _claims(moment):
        """What this moment lets us say, each with the facts it rests on. Nothing here is a cause: a reason is three instruments
        pointing at one player, and it is worded as facts side by side."""
        kind = moment["kind"]
        if kind == "goal":
            out = (
                ["goal"]
                + (["closest_earlier_attempt"] if moment.get("closest_attempt") else [])
                + (["three_instruments_agree"] if moment.get("reason") else [])
            )
        else:
            out = [dict(card="booked", pressure="pressure_change").get(kind, kind)]
        return out

    def write_moment(self, moment):
        t0 = time.perf_counter()
        t = moment["t"]
        key = f"moment:{moment['kind']}:{round(t, 1)}"
        cp = self.ledger.load_checkpoint(key) or {}
        if cp.get("done"):
            return cp
        if "decision" not in cp:
            cp["decision"] = dict(
                show=True,
                fact_ids=sorted(set(moment["fact_ids"])),
                claims=self._claims(moment),
                when="next_replay" if moment["kind"] == "goal" else "next_pause",
            )
            self.ledger.save_checkpoint(key, cp)
        facts = [f for f in (self.ledger.get_fact(i) for i in cp["decision"]["fact_ids"]) if f]
        ctx = self._context(moment, facts)
        if "texts" not in cp:
            texts = {}
            for lang in ("en", "ar"):
                text, how = self.breaker.call(
                    lambda: self.backend.narrate(moment["kind"], ctx, lang),
                    lambda: self.fallback.narrate(moment["kind"], ctx, lang),
                    timeout=4.0,
                )
                want = self.fallback.numbers(moment["kind"], ctx, lang)
                who = self.fallback.who(moment["kind"], ctx)
                ok, why = verify(
                    text, facts, self.names, allowed_numbers=ctx.get("allowed", ()), expected=want, expected_names=who
                )
                if not ok:  # one rewrite, then the template
                    self.ledger.audit(t, "verifier_rejected", dict(text=text, reasons=why, lang=lang))
                    text = self.fallback.narrate(moment["kind"], ctx, lang)
                    ok, why = verify(
                        text,
                        facts,
                        self.names,
                        allowed_numbers=ctx.get("allowed", ()),
                        expected=want,
                        expected_names=who,
                    )
                    how = "template_after_rejection"
                if ok and text:
                    texts[lang] = dict(
                        text=text,
                        how=how,
                        numbers=want,
                        names=who,
                        proof=self.fallback.proof(moment["kind"], ctx, lang),
                    )
            cp["texts"] = texts
            cp["label"] = self.fallback.label(moment["kind"], ctx)
            self.ledger.save_checkpoint(key, cp)
        ids = cp["decision"]["fact_ids"]
        for lang, v in cp["texts"].items():
            self.cues.propose(
                t,
                "sentence",
                "phone",
                dict(lang=lang, text=v["text"], how=v["how"], numbers=v["numbers"], names=v["names"], proof=v["proof"]),
                ids,
                valid_for=20,
                priority=5,
                when="now",
            )
        if cp["label"] and len(cp["label"].split()) <= 6:
            self.cues.propose(
                t, "label", "tv", dict(text=cp["label"]), ids, valid_for=5, priority=6, when=cp["decision"]["when"]
            )
        if moment["kind"] == "goal":
            ca = moment.get("closest_attempt")
            scene = dict(
                type="closest_attempt" if ca else "plain",
                camera=dict(behind=moment["player"]),
                goal_frame=moment.get("frame"),
                light=[ca["differing_player"]] if ca else [],
                earlier_frame=ca.get("earlier_frame") if ca else None,
                label=cp["label"],
            )
            self.cues.propose(t, "scene", "tv", scene, ids, valid_for=11, priority=8, when="next_replay")
        if "en" in cp["texts"]:
            self.cues.propose(
                t,
                "sentence",
                "desk",
                dict(text=cp["texts"]["en"]["text"], claims=cp["decision"]["claims"]),
                ids,
                valid_for=30,
                when="now",
            )
        cp["done"] = True
        self.ledger.save_checkpoint(key, cp)
        self.timings.append(time.perf_counter() - t0)
        return cp

    def _context(self, moment, facts):
        minute = int(moment["t"] // 60) + 1
        ctx = dict(
            names=self.meta["names"],
            names_ar=self.meta["names_ar"],
            minute=minute,
            player=moment.get("player"),
            allowed=[minute],
        )
        by = {}
        for f in facts:
            if f["kind"] != "card" or f["match_time"] < moment["t"] - 0.01 or moment["kind"] == "card":
                by[f["kind"]] = f
        if "goal" in by:
            ctx["score"] = by["goal"]["value"]
        if "shot_speed" in by:
            ctx["shot_speed"] = dict(
                fact_id=by["shot_speed"]["fact_id"],
                value=by["shot_speed"]["value"],
                percentile=by["shot_speed"].get("percentile"),
            )
        if "closest_attempt" in by:
            f = by["closest_attempt"]
            ctx["closest"] = dict(
                fact_id=f["fact_id"],
                differing_player=f["differing_player"],
                differing_by_m=f["differing_by_m"],
                gap_m=f["value"],
                earlier_minute=int(f["earlier_time"] // 60) + 1,
            )
        if "ghost_standoff" in by:
            ctx["ghost"] = dict(
                fact_id=by["ghost_standoff"]["fact_id"],
                player=by["ghost_standoff"]["subject"],
                off_m=by["ghost_standoff"]["value"],
            )
        if (
            "reason" in by and "card" in by and moment["kind"] == "goal"
        ):  # only then is the booking put beside the other two
            ctx["booked_minute"] = int(by["card"]["match_time"] // 60) + 1
            ctx["booked_fact"] = by["card"]["fact_id"]
        if moment["kind"] == "card":
            ctx["card_fact"] = by["card"]["fact_id"]
        if moment["kind"] == "pressure":
            f = by["pressure"]
            teams = (self.meta["home"], self.meta["away"])
            me, other = teams[moment["team"]], teams[1 - moment["team"]]
            ctx["team_name"], ctx["other_name"], ctx["other_name_ar"] = me["name"], other["name"], other["name_ar"]
            ctx["pressure"] = dict(
                fact_id=f["fact_id"],
                now=f["value"],
                before=f["before"],
                window_min=f["window_min"],
                won_high=f["won_high"],
            )
            ctx["allowed"] = [100, f["before"], f["window_min"]]
        return ctx

    # ----- fixed-time cards -----
    def kickoff(self, habits):
        """Three things to watch, drawn on the pitch as marks before the whistle. Each is a season habit with its sample size."""
        out = []
        for h in habits[:3]:
            c = self.cues.propose(
                0.0,
                "kickoff_mark",
                "tv",
                dict(mark=h["mark"], zone=h.get("zone"), subject=h["subject"], text=h["text"]),
                [h["fact_id"]],
                valid_for=8,
                priority=6,
            )
            if h.get("window"):
                self.cues.propose(
                    0.0,
                    "danger_window",
                    "tv",
                    dict(from_minute=h["window"][0], to_minute=h["window"][1], subject=h["subject"]),
                    [h["fact_id"]],
                    valid_for=5400,
                    priority=2,
                )
            out.append(c)
        return out

    def interval_card(self, t, form, items, calls=None):
        """Half time: three things still open. Full time: the three moments that moved the match most, and what became of
        the calls made before kick-off."""
        ids = [i for it in items for i in it["fact_ids"]] + [i for c in (calls or []) for i in c["fact_ids"]]
        payload = dict(cards=[dict(title=it["title"], text=it["text"], mark=it.get("mark")) for it in items[:3]])
        if calls:
            payload["calls"] = [{k: v for k, v in c.items() if k != "fact_ids"} for c in calls]
        return self.cues.propose(t, form, "tv", payload, ids, valid_for=9, priority=8, when="now")
