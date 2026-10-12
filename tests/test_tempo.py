"""Quick checks that need no data and no run: every module imports, IDs are stable, and the paths point at the repository.

    python3 -m unittest discover -s tests

The checks that run the demo match are in tempo/eval/checks.py."""

import importlib
import os
import pkgutil
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)  # so the suite runs from any folder

import tempo  # noqa: E402
from tempo import constants, paths  # noqa: E402
from tempo.contracts import cue, event, fact, stable_id  # noqa: E402


class Imports(unittest.TestCase):
    def test_every_module_imports(self):
        names = [m.name for m in pkgutil.walk_packages(tempo.__path__, "tempo.")]
        self.assertIn("tempo.run_match", names)
        self.assertIn("tempo.eval.checks", names)
        for name in names:
            with self.subTest(module=name):
                importlib.import_module(name)

    def test_the_pipeline_keeps_its_names(self):
        # spike code and the checks import these three from run_match
        from tempo.outputs import RunOutputs
        from tempo.run_match import Pipeline, generate, main

        self.assertTrue(issubclass(Pipeline, RunOutputs))
        self.assertTrue(callable(generate) and callable(main))
        for method in ("run", "resume", "finish", "scenes", "match_view", "stake_counts"):
            self.assertTrue(callable(getattr(Pipeline, method)), method)


class StableIds(unittest.TestCase):
    """A replay after a failure must give every fact and cue the ID it had the first time, so these are written out."""

    def test_fact_id(self):
        f = fact("m_test", 2831.26, "card", "p_har_6", "yellow")
        self.assertEqual(f["fact_id"], "f_afc0d3abafab")
        self.assertEqual(f["fact_id"], stable_id("f", "m_test", "card", "p_har_6", 2831.3))
        self.assertEqual(f["match_time"], 2831.26)
        # the value is not part of the ID, and a tenth of a second is as fine as it looks
        self.assertEqual(fact("m_test", 2831.34, "card", "p_har_6", "red")["fact_id"], f["fact_id"])
        self.assertNotEqual(fact("m_test", 2831.26, "card", "p_har_7", "yellow")["fact_id"], f["fact_id"])

    def test_cue_id(self):
        en = cue("m_test", 2831.26, "sentence", "phone", dict(lang="en", text="x"), ["f_afc0d3abafab"])
        ar = cue("m_test", 2831.26, "sentence", "phone", dict(lang="ar", text="x"), ["f_afc0d3abafab"])
        self.assertEqual(en["cue_id"], "c_12c811e4eb5e")
        self.assertEqual(ar["cue_id"], "c_46e4e280cdc1")
        # the wording is not part of the ID, so the same cue written again is the same cue
        again = cue("m_test", 2831.26, "sentence", "phone", dict(lang="en", text="y"), ["f_afc0d3abafab"])
        self.assertEqual(again["cue_id"], en["cue_id"])
        self.assertEqual(en["status"], "live")

    def test_fact_order_does_not_change_a_cue_id(self):
        a = cue("m_test", 10.0, "stake_card", "tv", dict(player="p_har_6", level=1), ["f_b", "f_a"])
        b = cue("m_test", 10.0, "stake_card", "tv", dict(player="p_har_6", level=1), ["f_a", "f_b"])
        self.assertEqual(a["cue_id"], b["cue_id"])

    def test_event_id(self):
        e = event("m_test", 12, "pass", 1, 61.239, "t_nor", "p_nor_10", 50, 50)
        self.assertEqual(e["id"], "e_7466cc131927")
        self.assertEqual((e["typeId"], e["timeMin"], e["timeSec"], e["matchTime"]), (1, 1, 1, 61.24))


class Paths(unittest.TestCase):
    def test_paths_are_real_folders(self):
        self.assertEqual(paths.ROOT, ROOT)
        for folder in (paths.ROOT, paths.ARTIFACTS, paths.RUNS, os.path.join(paths.ROOT, "tempo")):
            self.assertTrue(os.path.isdir(folder), folder)
        self.assertTrue(os.path.isfile(os.path.join(paths.ROOT, "pyproject.toml")))

    def test_modules_share_the_one_definition(self):
        from tempo import ghost, season, twin
        from tempo.generator import sim
        from tempo.stake import dfl, features, model

        self.assertEqual(model.ARTIFACTS, paths.ARTIFACTS)
        self.assertEqual(season.PATH, os.path.join(paths.ARTIFACTS, "season.json"))
        for module in (sim, ghost, twin, dfl, features):
            self.assertEqual(module.HZ, constants.HZ)
        for module in (sim, ghost):
            self.assertEqual((module.PX, module.PY), (constants.PX, constants.PY))
        self.assertEqual((constants.HZ, constants.PX, constants.PY, features.STEP), (25, 52.5, 34.0, 3))


if __name__ == "__main__":
    unittest.main()
