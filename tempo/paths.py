"""Where things live on disk. Every module takes its folders from here, so nothing depends on the working directory."""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the repository
ARTIFACTS = os.path.join(ROOT, "artifacts")  # trained models, the season and the evaluation results
RUNS = os.path.join(ROOT, "runs")  # one folder for each match run through the pipeline
