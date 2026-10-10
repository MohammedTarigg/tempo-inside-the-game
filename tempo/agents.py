"""The writing path: two team agents, a Director, a Narrator, a Verifier and a Localizer, run as one checkpointed workflow per moment.

Agents never see raw feeds and never write to the ledger. They read facts through FactTools, which enforces two things by who is
calling: nothing after the moment's own match time, and a team agent only sees its own team's players.

Model calls go through a Backend. LocalBackend writes from templates, so the whole pipeline runs with no cloud and serves as the
fallback when a model is slow or down. FoundryBackend is the seam for Microsoft Agent Framework on Azure and is wired on day one."""
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
        self._check_player(pid); self._check_time(as_of or self.as_of)
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
OVERCLAIM = ["because", "always", "never fails", "will score", "will be sent", "guarantee", "certain to", "لأن", "دائما", "سوف"]
AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


class LocalBackend:
    """Deterministic writer. Every sentence is assembled from the facts it is given, so it passes the Verifier by construction."""
    name = "local-templates"

    def narrate(self, kind, ctx, lang="en", depth="casual"):
        n = ctx.get("names", {})
        if kind == "card":
            p = n[ctx["player"]]; m = ctx["minute"]
            return {"en": f"{p} is booked in minute {m}. One more foul is a red card.", "ar": f"إنذار لـ{p} في الدقيقة {m}. مخالفة أخرى تعني بطاقة حمراء."}[lang]
        if kind == "goal":
            p = n[ctx["player"]]; a, b = ctx["score"]
            base = {"en": f"{p} scores in minute {ctx['minute']}. It is {a}-{b}.", "ar": f"{p} يسجل في الدقيقة {ctx['minute']}. النتيجة {a}-{b}."}[lang]
            ca = ctx.get("closest")
            if not ca:
                return base
            d = n[ca["differing_player"]]
            if lang == "ar":
                extra = f" أقرب محاولة سابقة كانت في الدقيقة {ca['earlier_minute']} ولم تنته بهدف. أكبر فرق: بعد ثانيتين من افتراق الهجمتين كان {d} على بعد {ca['differing_by_m']} متر من موقعه السابق."
                if ctx.get("differing_booked_minute"):
                    extra += f" كان قد تلقى إنذارا في الدقيقة {ctx['differing_booked_minute']}."
            else:
                extra = f" The closest earlier attempt came in minute {ca['earlier_minute']} and did not go in. The biggest difference: two seconds after the attacks part, {d} is {ca['differing_by_m']} m from where he was then."
                if ctx.get("differing_booked_minute"):
                    extra += f" He had been booked in minute {ctx['differing_booked_minute']}."
                if depth == "analyst":
                    extra += f" Average gap between the two attacks: {ca['gap_m']} m."
            return base + extra
        if kind == "turning_point":
            return {"en": f"The play has tilted towards {ctx['team_name']} since minute {ctx['minute']}.", "ar": f"اللعب يميل لصالح {ctx['team_name']} منذ الدقيقة {ctx['minute']}."}[lang]
        if kind == "form":
            p = n[ctx["player"]]
            return {"en": f"{p}: {ctx['per_minute']} m a minute in play, top speed {ctx['top_speed']} m/s.", "ar": f"{p}: {ctx['per_minute']} متر في الدقيقة، أقصى سرعة {ctx['top_speed']} م/ث."}[lang]
        return ""

    @staticmethod
    def numbers(kind, ctx, lang="en", depth="casual"):
        """The numbers a sentence of this kind must contain, in order, taken from the facts. The Verifier holds the text to this
        list, so a number that is real but belongs to a different fact is still caught."""
        if kind in ("card", "turning_point"):
            return [ctx["minute"]]
        if kind == "form":
            return [ctx["per_minute"], ctx["top_speed"]]
        if kind == "goal":
            out = [ctx["minute"], *ctx["score"]]
            ca = ctx.get("closest")
            if ca:
                out += [ca["earlier_minute"], ca["differing_by_m"]]
                if ctx.get("differing_booked_minute"):
                    out.append(ctx["differing_booked_minute"])
                if lang == "en" and depth == "analyst":
                    out.append(ca["gap_m"])
            return out
        return []

    def label(self, kind, ctx):
        n = ctx.get("names", {})
        if kind == "goal" and ctx.get("closest"):
            return f"Closest earlier attempt: {ctx['closest']['earlier_minute']}'"
        if kind == "goal":
            return f"{n[ctx['player']]} {ctx['score'][0]}-{ctx['score'][1]}"
        if kind == "card":
            return f"{n[ctx['player']]} booked"
        return ""


class FoundryBackend:
    """Seam for Microsoft Agent Framework on Azure AI Foundry. Not wired in this local build: it needs the subscription."""
    name = "foundry"

    def __init__(self):
        raise NotImplementedError("FoundryBackend needs an Azure subscription and is wired on day one; the local backend is the fallback path")


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


def verify(text, facts, names, allowed_numbers=(), expected=None):
    """Code check. Returns (ok, reasons).
    - Every number in the text must come from a cited fact.
    - When `expected` is given (the ordered numbers the facts dictate for this sentence), the text must contain exactly those,
      in that order. This catches a real number used in the wrong place.
    - Every player named must be in a cited fact.
    - No wording may claim more than a fact holds."""
    pool = set(float(x) for x in allowed_numbers)
    people = set()
    for f in facts:
        people.add(f["subject"]); people.update(str(f.get(k)) for k in ("differing_player", "earlier_player") if f.get(k))
        vals = [f["value"], f.get("percentile"), f.get("differing_by_m"), f.get("gap_m"), f["match_time"] // 60 + 1, f.get("top_speed")]
        if f.get("earlier_time") is not None:
            vals.append(f["earlier_time"] // 60 + 1)
        for v in vals:
            for x in (v if isinstance(v, (list, tuple)) else [v]):
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
    for pid, nm in names.items():
        if nm in text and not any(pid in s.split("|") for s in people):
            reasons.append(f"{nm} is named but no cited fact is about him")
    low = text.lower()
    reasons += [f"claims more than the facts hold: '{w}'" for w in OVERCLAIM if w in low]
    return not reasons, reasons


# ---------------- the workflow ----------------
class Writer:
    def __init__(self, ledger, cues, meta, backend=None):
        self.ledger, self.cues, self.meta = ledger, cues, meta
        self.backend, self.fallback, self.breaker = backend or LocalBackend(), LocalBackend(), Breaker()
        self.names = meta["names"]
        self.timings = []

    def _tools(self, role, t):
        team = {"home": self.meta["home"]["id"], "away": self.meta["away"]["id"]}.get(role)
        return FactTools(self.ledger, self.meta, role, team, t)

    def _propose(self, role, moment, t):
        """A team agent: what does this moment mean from our side? Returns typed proposals or 'nothing from us'."""
        tools = self._tools(role, t)
        team_id = tools.team_id
        facts = tools.get_moment(moment["fact_ids"])
        out = []
        if moment["kind"] == "goal":
            ca = moment.get("closest_attempt")
            scorer_team = self.meta["team_of"][moment["player"]]
            if scorer_team == team_id:
                out.append(dict(claim="goal", kind="result", fact_ids=[f["fact_id"] for f in facts if f["kind"] in ("goal", "shot_speed")], confidence=1.0))
                if ca:
                    out.append(dict(claim="closest_earlier_attempt", kind="reason", fact_ids=[ca["fact_id"]], confidence=round(ca["closer_than"], 2)))
            elif ca and self.meta["team_of"].get(ca["differing_player"]) == team_id:
                mine = tools.get_player_ledger(ca["differing_player"])
                card = [f for f in mine if f["kind"] == "card" and f["value"] == "yellow"]
                if card:
                    out.append(dict(claim="held_off_on_a_yellow", kind="stake_paid", fact_ids=[ca["fact_id"], card[-1]["fact_id"]], confidence=0.8))
        elif moment["kind"] == "card" and self.meta["team_of"][moment["player"]] == team_id:
            out.append(dict(claim="booked", kind="stake_opened", fact_ids=moment["fact_ids"], confidence=1.0))
        elif moment["kind"] == "turning_point":
            out.append(dict(claim="momentum", kind="state", fact_ids=moment["fact_ids"], confidence=0.6))
        return out

    def write_moment(self, moment):
        """Runs the workflow for one moment, saving a checkpoint after each step so a restart resumes where it stopped."""
        t0 = time.perf_counter()
        t = moment["t"]; key = f"moment:{moment['kind']}:{round(t, 1)}"
        cp = self.ledger.load_checkpoint(key) or {}
        if cp.get("done"):
            return cp
        if "proposals" not in cp:
            cp["proposals"] = {r: self._propose(r, moment, t) for r in ("home", "away")}
            self.ledger.save_checkpoint(key, cp)
        if "decision" not in cp:
            props = [p for r in ("home", "away") for p in cp["proposals"][r]]
            if not props:
                cp.update(done=True, decision=dict(show=False, reason="nothing from either team")); self.ledger.save_checkpoint(key, cp)
                self.ledger.audit(t, "held_back", dict(form="sentence", reason="neither team agent found anything worth saying", moment=moment["kind"]))
                return cp
            ids = sorted({i for p in props for i in p["fact_ids"]})
            cp["decision"] = dict(show=True, fact_ids=ids, took=[p["claim"] for p in props], when="next_replay" if moment["kind"] == "goal" else "next_pause")
            self.ledger.save_checkpoint(key, cp)
        facts = [f for f in (self.ledger.get_fact(i) for i in cp["decision"]["fact_ids"]) if f]
        ctx = self._context(moment, facts)
        if "texts" not in cp:
            texts = {}
            for lang in ("en", "ar"):
                for depth in ("casual", "analyst"):
                    text, how = self.breaker.call(lambda: self.backend.narrate(moment["kind"], ctx, lang, depth), lambda: self.fallback.narrate(moment["kind"], ctx, lang, depth), timeout=4.0)
                    want = self.fallback.numbers(moment["kind"], ctx, lang, depth)
                    ok, why = verify(text, facts, self.names, allowed_numbers=ctx.get("allowed", ()), expected=want)
                    if not ok:                                              # one rewrite, then the template
                        self.ledger.audit(t, "verifier_rejected", dict(text=text, reasons=why, lang=lang))
                        text = self.fallback.narrate(moment["kind"], ctx, lang, depth)
                        ok, why = verify(text, facts, self.names, allowed_numbers=ctx.get("allowed", ()), expected=want)
                        how = "template_after_rejection"
                    if ok and text:
                        texts[f"{lang}:{depth}"] = dict(text=text, how=how, numbers=want)
            cp["texts"] = texts; cp["label"] = self.fallback.label(moment["kind"], ctx)
            self.ledger.save_checkpoint(key, cp)
        ids = cp["decision"]["fact_ids"]
        for k, v in cp["texts"].items():
            lang, depth = k.split(":")
            self.cues.propose(t, "sentence", "phone", dict(lang=lang, depth=depth, text=v["text"], how=v["how"], numbers=v["numbers"]), ids, valid_for=20, priority=5, when="now")
        if cp["label"] and len(cp["label"].split()) <= 6:
            self.cues.propose(t, "label", "tv", dict(text=cp["label"]), ids, valid_for=5, priority=6, when=cp["decision"]["when"])
        if moment["kind"] == "goal":
            ca = moment.get("closest_attempt")
            scene = dict(type="closest_attempt" if ca else "plain", camera=dict(behind=moment["player"]), goal_frame=moment.get("frame"),
                         light=[ca["differing_player"]] if ca else [], earlier_frame=ca.get("earlier_frame") if ca else None, label=cp["label"])
            self.cues.propose(t, "scene", "tv", scene, ids, valid_for=11, priority=8, when="next_replay")
        if "en:casual" in cp["texts"]:
            self.cues.propose(t, "sentence", "desk", dict(text=cp["texts"]["en:casual"]["text"], proposals=cp["proposals"], took=cp["decision"]["took"]), ids, valid_for=30, when="now")
        cp["done"] = True
        self.ledger.save_checkpoint(key, cp)
        self.timings.append(time.perf_counter() - t0)
        return cp

    def _context(self, moment, facts):
        minute = int(moment["t"] // 60) + 1
        ctx = dict(names=self.names, minute=minute, player=moment.get("player"), allowed=[minute])
        by = {f["kind"]: f for f in facts}
        if "goal" in by:
            ctx["score"] = by["goal"]["value"]
        if "closest_attempt" in by:
            f = by["closest_attempt"]
            ctx["closest"] = dict(differing_player=f["differing_player"], differing_by_m=f["differing_by_m"], gap_m=f["value"], earlier_minute=int(f["earlier_time"] // 60) + 1)
        if "card" in by and moment["kind"] == "goal":
            ctx["differing_booked_minute"] = int(by["card"]["match_time"] // 60) + 1
        if moment["kind"] == "turning_point":
            ctx["team_name"] = (self.meta["home"], self.meta["away"])[moment["team"]]["name"]
        return ctx

    # ----- fixed-time cards -----
    def kickoff(self, habits):
        """Three things to watch, drawn on the pitch as marks before the whistle. Each is a season habit with its sample size."""
        out = []
        for h in habits[:3]:
            c = self.cues.propose(0.0, "kickoff_mark", "tv", dict(mark=h["mark"], zone=h.get("zone"), subject=h["subject"], text=h["text"]), [h["fact_id"]], valid_for=8, priority=6)
            if h.get("window"):
                self.cues.propose(0.0, "danger_window", "tv", dict(from_minute=h["window"][0], to_minute=h["window"][1], subject=h["subject"]), [h["fact_id"]], valid_for=5400, priority=2)
            out.append(c)
        return out

    def interval_card(self, t, form, items):
        """Half time: three things still open. Full time: the three moments that moved the match most."""
        ids = [i for it in items for i in it["fact_ids"]]
        return self.cues.propose(t, form, "tv", dict(cards=[dict(title=it["title"], text=it["text"], mark=it.get("mark")) for it in items[:3]]), ids, valid_for=9, priority=8, when="now")
