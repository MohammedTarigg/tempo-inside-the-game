"""The package is whole: every module imports, and the folders and shared numbers are defined once."""

import importlib
import os
import pkgutil

import tempo
from tempo import constants, paths


def test_every_module_imports():
    names = [m.name for m in pkgutil.walk_packages(tempo.__path__, "tempo.")]
    assert {"tempo.pipeline.run", "tempo.eval.checks", "tempo.cli"} <= set(names)
    for name in names:
        if name != "tempo.__main__":  # that one runs the command line
            importlib.import_module(name)


def test_the_pipeline_keeps_its_names():
    from tempo.pipeline.export import Export
    from tempo.pipeline.run import Pipeline, generate, main

    assert callable(generate) and callable(main)
    for method in ("run", "resume", "finish"):
        assert callable(getattr(Pipeline, method)), method
    for method in ("finish", "scenes", "match_view", "desk_rows", "stake_counts"):
        assert callable(getattr(Export, method)), method


def test_paths_are_real_folders():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assert root == paths.ROOT
    for folder in (paths.MODELS, paths.RESULTS, paths.RUNS, os.path.join(root, "tempo")):
        assert os.path.isdir(folder), folder
    assert os.path.isfile(os.path.join(root, "pyproject.toml"))


def test_modules_share_the_one_definition():
    from tempo import season
    from tempo.generator import sim
    from tempo.instruments import ghost, twin
    from tempo.stake import dfl, features, model

    assert model.MODELS == paths.MODELS
    assert os.path.join(paths.MODELS, "season.json") == season.PATH
    for module in (sim, ghost, twin, dfl, features):
        assert module.HZ == constants.HZ
    for module in (sim, ghost):
        assert (module.PX, module.PY) == (constants.PX, constants.PY)
    assert (constants.HZ, constants.PX, constants.PY, features.STEP) == (25, 52.5, 34.0, 3)
