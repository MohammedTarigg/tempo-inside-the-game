"""The writing path. Which facts belong to a moment is decided by code; a backend turns them into one sentence per
language, and the Verifier holds every sentence to the facts before it leaves. A checkpoint after each step lets a
restart resume. The agents themselves (two investigators and a gate, for a turn nobody scripted) are described in
docs/architecture.md section 6 and are not in this build."""

import time
from typing import Any

from .backends import LocalBackend
from .verify import verify


class Breaker:
    """Three failures or timeouts inside 60 seconds open it for 120. While open no call is tried. Then one probe is let
    through."""

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


class Writer:
    """The writing path for a moment whose kind is known: which facts belong together is decided by code, the sentence
    is one writer call per language, and every sentence is checked before it leaves. A checkpoint after each step lets a
    restart resume."""

    def __init__(self, ledger, cues, meta, backend=None):
        self.ledger, self.cues, self.meta = ledger, cues, meta
        self.backend, self.fallback, self.breaker = backend or LocalBackend(), LocalBackend(), Breaker()
        self.names = {
            pid: (nm, meta["names_ar"][pid]) for pid, nm in meta["names"].items()
        }  # the Verifier knows a player by either spelling
        self.timings = []

    @staticmethod
    def _claims(moment):
        """What this moment lets us say, each with the facts it rests on. Nothing here is a cause: a reason is three
        instruments pointing at one player, and it is worded as facts side by side."""
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
                    lambda lang=lang: self.backend.narrate(moment["kind"], ctx, lang),
                    lambda lang=lang: self.fallback.narrate(moment["kind"], ctx, lang),
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
        ctx: dict[str, Any] = dict(
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
        if "season_best" in by:
            f = by["season_best"]
            ctx["best"] = dict(fact_id=f["fact_id"], value=f["value"], before=f["before"], sample=f["sample"])
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
        """Three things to watch, drawn on the pitch as marks before the whistle. Each is a season habit with its sample
        size."""
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
        """Half time: three things still open. Full time: up to three pins for the turning points, and what became of
        the calls made before kick-off."""
        ids = [i for it in items for i in it["fact_ids"]] + [i for c in (calls or []) for i in c["fact_ids"]]
        payload = (
            dict(pins=[{k: v for k, v in it.items() if k != "fact_ids"} for it in items[:3]])
            if form == "fulltime_card"
            else dict(cards=[dict(title=it["title"], text=it["text"], mark=it.get("mark")) for it in items[:3]])
        )
        if calls:
            payload["calls"] = [{k: v for k, v in c.items() if k != "fact_ids"} for c in calls]
        return self.cues.propose(t, form, "tv", payload, ids, valid_for=9, priority=8, when="now")
