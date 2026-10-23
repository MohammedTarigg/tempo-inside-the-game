# Experiments

The tests behind two design decisions in [docs/architecture.md](../docs/architecture.md) section 6. Each keeps its results beside it, so a figure in the docs can be traced to the run that produced it.

## The ghost (`ghost/`)

Can a model of where an average defender would stand say who stood off the ball at a goal, and can it say whether that was unusual?

- `evaluate.py real data/dfl-cache` fits the ghost on six real matches and scores the seventh, in turn (after `uv run tempo data`). Results: `results/ghost_real.json`.
- `demo_test.py` and `standoff_test.py` fit it on generated matches and look at the demo match's goals against ordinary shots. Results: `results/ghost_demo.json`, `results/ghost_standoff.json`.

Run each with `uv run python -m experiments.ghost.<name>`. Finding: the ghost says who, not whether, so it is one of three instruments in the reason rule and never names a reason alone.

## The investigators (`agents/`)

Can language agents, working alone on the match record, find why a goal went in or why a match turned?

- `build_cases.py <work>/cases` writes blind cases: eight goals, four with a planted cause and four without, each with the feed only (`raw`) and with the player layer's instruments (`inst`), plus the answers kept apart in `_truth.json`.
- `run_one.sh <work> <case> <raw|inst> <run>` gives one case to a headless Claude Code session in its own folder, with no sight of anything outside it.
- `score.py <work>/cases <work>/runs` scores the runs and the pair-with-agreement gate. Results: `results/test.json`, with the cases' answers in `results/test_truth.json`.
- `code_rule.py <work>/cases` scores the no-agent baseline, one fixed rule over the three instruments. Results: `results/code_rule.json`.
- `sustained_sim/` is a simpler simulator with causes that last (a full back who fades, a substitute who presses, a booked midfielder who stops tackling), and `run_sustained.sh` runs a case from it. Results: `results/test_sustained.json`.

Finding: a fixed rule over three instruments named the planted reason in 8 of 8 goals and nobody at the ordinary ones, while the investigators found none of the planted single-event causes. So the reason at a goal is rules, and the investigators are kept for slow, unscripted turns, behind an agreement gate.
