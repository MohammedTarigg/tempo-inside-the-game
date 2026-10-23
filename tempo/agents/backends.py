"""Where sentences come from. Model calls go through a backend. LocalBackend writes from templates, so the whole
pipeline runs with no cloud and serves as the fallback when a model is slow or down. FoundryBackend is the seam for a
model on Azure AI Foundry, built to the contract in docs/architecture.md section 6."""


class LocalBackend:
    """Deterministic writer. Every sentence is assembled from the facts it is given, so it passes the Verifier by
    construction. A sentence states facts side by side. It never says one caused another."""

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
                return (
                    f"خلال آخر {pr['window_min']} دقائق كان {pr['now']} من كل 100 من اللعب"
                    f" في نصف ملعب {ctx['other_name_ar']}"
                    f"، مقابل {pr['before']} قبلها."
                )
            return (
                f"{ctx['team_name']} have had {pr['now']} in 100 of the play in {ctx['other_name']}'s half"
                f" over the last {pr['window_min']} minutes, up from {pr['before']}."
            )
        if kind == "season_best":
            p, v = n[ctx["player"]], round(ctx["best"]["value"])
            return {
                "en": f"{p} hits it at {v} km/h, his fastest this season.",
                "ar": f"{p} يسدد بسرعة {v} كم/س، أسرع تسديدة له هذا الموسم.",
            }[lang]
        if kind == "form":
            p = n[ctx["player"]]
            return {
                "en": f"{p}: {ctx['per_minute']} m a minute in play, top speed {ctx['top_speed']} m/s.",
                "ar": f"{p}: {ctx['per_minute']} متر في الدقيقة، أقصى سرعة {ctx['top_speed']} م/ث.",
            }[lang]
        return ""

    @staticmethod
    def numbers(kind, ctx, lang="en"):
        """The numbers a sentence of this kind must contain, in order, taken from the facts. The Verifier holds the text
        to this list, so a number that is real but belongs to a different fact is still caught."""
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
        if kind == "season_best":
            return [round(ctx["best"]["value"])]
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
        """The players a sentence of this kind must name, in order. As with numbers, the Verifier holds the text to this
        list: a player who is in a cited fact but does not belong in this sentence is still caught."""
        if kind in ("card", "form", "season_best"):
            return [ctx["player"]]
        if kind == "goal":
            return [ctx["player"]] + ([ctx["closest"]["differing_player"]] if ctx.get("closest") else [])
        return []

    @staticmethod
    def proof(kind, ctx, lang="en"):
        """What stands behind the line, as data and not prose: each item is one fact with its number. This is what a
        viewer who wants more gets, in place of a longer sentence."""
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
        elif kind == "season_best":
            b = ctx["best"]
            out.append(
                dict(
                    icon="speed",
                    fact_id=b["fact_id"],
                    title="أفضل تسديدة له قبلها" if ar else "His best before",
                    value=f"{b['before']:.0f} {'كم/س' if ar else 'km/h'}",
                    note=f"من {b['sample']} تسديدة هذا الموسم" if ar else f"from {b['sample']} shots this season",
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
        if kind == "season_best":
            return f"{n[ctx['player']]}, fastest this season"
        return ""


class FoundryBackend:
    """Seam for Microsoft Agent Framework on Azure AI Foundry. Not wired in this local build: it needs the
    subscription."""

    name = "foundry"

    def __init__(self):
        raise NotImplementedError(
            "FoundryBackend needs an Azure subscription and is wired on day one; the local backend is the fallback path"
        )
