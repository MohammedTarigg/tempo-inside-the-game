"""The site and the pipeline agree: the demo run matches the schema, and the site's TypeScript is the schema's."""

import json
import os

from tempo.paths import RUNS
from tempo.pipeline import schema
from tempo.pipeline.typescript import OUT, mismatches, render

DEMO = os.path.join(RUNS, "m_demo")


def load(name):
    with open(os.path.join(DEMO, name)) as f:
        return json.load(f)


def test_match_json_matches_the_schema():
    assert mismatches(load("match.json"), schema.MatchView) == []


def test_scenes_json_matches_the_schema():
    scenes = load("scenes.json")
    assert scenes, "the demo match has a replay scene"
    assert [m for s in scenes for m in mismatches(s, schema.ReplayScene)] == []


def test_the_site_types_are_current():
    with open(OUT) as f:
        assert f.read() == render(), "run `uv run tempo types`"


def test_a_wrong_shape_is_caught():
    bad = load("match.json")
    bad["cues"][0]["payload"]["text"] = 7
    del bad["stake"]
    found = mismatches(bad, schema.MatchView)
    assert any("missing stake" in m for m in found)
    assert any(m.startswith("$.cues[0]") for m in found)
