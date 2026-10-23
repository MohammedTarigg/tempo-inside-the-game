"""The demo match in the repository is what the code makes: running it again gives the same files, byte for byte."""

import os
import tempfile

import pytest

from tempo import season as seasonmod
from tempo.paths import RUNS
from tempo.pipeline.run import Pipeline, generate

SAME = ["match.json", "match.bin", "scenes.json", "cues.jsonl", "facts.jsonl"]


@pytest.mark.slow
def test_the_demo_run_is_reproduced_exactly():
    season, search = seasonmod.load()
    with tempfile.TemporaryDirectory() as out:
        p = Pipeline(generate(None), out, season=season, search=search)
        p.run()
        p.finish(0.0)
        for name in SAME:
            with open(os.path.join(out, name), "rb") as a, open(os.path.join(RUNS, "m_demo", name), "rb") as b:
                assert a.read() == b.read(), f"{name} differs from the committed demo run: run `uv run tempo run`"
