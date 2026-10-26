"""The writer on Microsoft Foundry: a model deployment writes the line a moment's facts allow, to the contract in
docs/architecture.md section 6. Its structured output has four fields in this order: the fact ids it cites, in the order
the sentence uses them; nothing_to_say; the line; the label. Citing first makes the model commit to its evidence before it
writes, and lets the ids be checked against the facts the moment was given before the text is read.

The Writer (tempo/agents/writer.py) calls narrate() through its breaker with the templates as the fallback, holds the
line to the Verifier, sends a failed line back once through repair() with the exact reasons, and uses the template after
a second failure. The numbers, names and proof a sentence must carry still come from the templates' backend: they are
data, not prose, so no model decides them."""

import json
from typing import Any

from ..agents.backends import LocalBackend
from .settings import AzureSettings, credential

# what the model returns, in the order it must write it
CONTRACT = {
    "name": "tempo_line",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["cites", "nothing_to_say", "line", "label"],
        "properties": {
            "cites": {"type": "array", "items": {"type": "string"}},
            "nothing_to_say": {"type": "boolean"},
            "line": {"type": "string"},
            "label": {"type": "string"},
        },
    },
}

SYSTEM = """You write one line for a football broadcast's second screen, from facts only.
Rules:
- First list the fact ids you will use, in the order the line uses them. Use no others.
- If the facts do not make a line worth a viewer's attention, set nothing_to_say to true and leave the line empty.
- Every number and every name in the line must come from a cited fact, in the order given under "must contain".
- State facts side by side. Never say one caused another: no "because", no "always", no prediction.
- No superlative unless a season_best fact is cited. No em dash.
- The label is at most six words, for the television picture.
- Write the line in the language asked for. Arabic is Modern Standard Arabic, with the player names as given."""

LANGS = {"en": "English", "ar": "Arabic"}


def _fact_lines(facts, names):
    """The facts as the model sees them: id, kind, who, value and unit, nothing else."""
    out = []
    for f in facts:
        who = names.get(f["subject"], f["subject"])
        out.append(f"- {f['fact_id']}: {f['kind']} of {who} = {f['value']} {f.get('unit') or ''}".rstrip())
    return "\n".join(out)


class FoundryBackend(LocalBackend):
    """narrate() and repair() are model calls; numbers(), who(), proof() and label() fall back to the templates'
    data unless the model wrote a label that passes."""

    name = "foundry"

    def __init__(self, cfg: AzureSettings, client: Any = None):
        if not cfg.foundry_endpoint and client is None:
            raise ValueError("TEMPO_AZURE_FOUNDRY_ENDPOINT is not set")
        self.deployment = cfg.foundry_deployment
        if client is None:
            from azure.identity import get_bearer_token_provider
            from openai import OpenAI

            token = get_bearer_token_provider(credential(), "https://cognitiveservices.azure.com/.default")
            client = OpenAI(
                base_url=f"{(cfg.foundry_endpoint or '').rstrip('/')}/openai/v1/",
                api_key=token,
                timeout=4.0,  # the Writer's own limit; past it the breaker counts a failure and the template goes out
                max_retries=0,
            )
        self.client = client
        self.labels: dict[tuple[str, int], str] = {}

    # ----- the calls -----
    def _ask(self, kind, ctx, lang, messages):
        r = self.client.chat.completions.create(
            model=self.deployment,
            messages=messages,
            response_format={"type": "json_schema", "json_schema": CONTRACT},
            temperature=0.2,
            max_completion_tokens=300,
        )
        out = json.loads(r.choices[0].message.content or "{}")
        given = {f["fact_id"] for f in ctx.get("facts", [])}
        if not set(out.get("cites", [])) <= given:
            raise ValueError(f"cited facts the moment was not given: {sorted(set(out['cites']) - given)}")
        if out.get("nothing_to_say"):
            return ""  # the screen stays clear; the Writer logs it as held
        label = (out.get("label") or "").strip()
        if lang == "en" and 0 < len(label.split()) <= 6 and "—" not in label:
            self.labels[(kind, ctx.get("minute", 0))] = label
        return out.get("line", "").strip()

    def _prompt(self, kind, ctx, lang):
        names = ctx["names_ar"] if lang == "ar" else ctx.get("names", {})
        return (
            f"Moment: {kind}, minute {ctx.get('minute')}.\n"
            f"Language: {LANGS[lang]}.\n"
            f"Facts:\n{_fact_lines(ctx.get('facts', []), names)}\n"
            f"The line must contain these numbers, in this order: {self.numbers(kind, ctx, lang)}\n"
            f"and name these players, in this order: {[names[p] for p in self.who(kind, ctx)]}"
        )

    def narrate(self, kind, ctx, lang="en"):
        return self._ask(
            kind,
            ctx,
            lang,
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": self._prompt(kind, ctx, lang)}],
        )

    def repair(self, kind, ctx, lang, line, reasons):
        """The one rewrite: the same question, the line it wrote, and exactly what the Verifier found wrong."""
        return self._ask(
            kind,
            ctx,
            lang,
            [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": self._prompt(kind, ctx, lang)},
                {"role": "assistant", "content": json.dumps({"line": line})},
                {
                    "role": "user",
                    "content": "The check rejected that line: "
                    + "; ".join(reasons)
                    + ". Fix the wording and keep the facts exactly.",
                },
            ],
        )

    def label(self, kind, ctx):
        return self.labels.get((kind, ctx.get("minute", 0))) or super().label(kind, ctx)
