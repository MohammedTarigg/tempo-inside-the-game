"""What the Verifier lets through: a record only with a season-best fact, and the templates pass their own check."""

from tempo.agents import LocalBackend, verify
from tempo.contracts import fact

SHOT = fact("m_test", 744.6, "shot_speed", "p_nor_7", 104.0, "km/h", percentile=98.7)
BEST = fact("m_test", 744.6, "season_best", "p_nor_7", 104.0, "km/h", before=98.0, sample=26)
NAMES = {"p_nor_7": ("Okoye", "أوكويه")}


def test_a_record_needs_its_fact():
    line = "Okoye hits it at 104 km/h, his fastest this season."
    assert not verify(line, [SHOT], NAMES)[0]
    assert verify(line, [SHOT, BEST], NAMES)[0]


def test_the_season_best_template_passes_its_own_check():
    ctx = dict(
        names={"p_nor_7": "Okoye"},
        names_ar={"p_nor_7": "أوكويه"},
        player="p_nor_7",
        best=dict(fact_id=BEST["fact_id"], value=104.0, before=98.0, sample=26),
    )
    for lang in ("en", "ar"):
        text = LocalBackend().narrate("season_best", ctx, lang)
        ok, why = verify(text, [SHOT, BEST], NAMES, expected=[104])
        assert ok, (lang, why)
