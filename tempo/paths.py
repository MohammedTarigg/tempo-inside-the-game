"""Where things live on disk. Every module takes its folders from here, so nothing depends on the working directory."""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the repository
MODELS = os.path.join(ROOT, "models")  # the trained stake model and ghost, and the season the pipeline reads
DATA = os.path.join(ROOT, "data")  # the real DFL matches, downloaded by `tempo data`; never committed
RESULTS = os.path.join(ROOT, "results")  # what each evaluation measured; the evidence page reads these
RUNS = os.path.join(ROOT, "web", "public", "runs")  # one folder for each match run; the site serves the demo match
WORK = os.path.join(ROOT, ".work")  # a run's working files: its ledger, its bus and its audit. Never served
