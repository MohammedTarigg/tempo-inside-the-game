# Spike: can a model find why a match turned?

Throwaway code from 10 October 2026. It is a test of one idea and is separate from the real match engine.

- `sim.py`: a small seeded match simulator with events, positions and speeds, plus `replay_test`, which replays a match from a minute many times with one cause removed.
- `scenarios.py`: three planted causes (a tired full back, a pressing substitute, a booked midfielder who stops tackling) and a control with none. Every match also has routine substitutions and cards that change nothing.
- `truth.json`: which match had which cause. Analysts never saw this or the simulator.
- `analyst-prompt.txt`: the instructions given to each blind analyst (Claude Haiku). They received only the match data.
- `analyst-runs/`: each analyst's own analysis script and verdict.
- `verdicts.json`, `replay_results.json`: the scores.

The five matches were (kind, seed): booked 10, control 7, fatigue 9, sub 2, control 1. Build one with `scenarios.scenario(kind, seed)`, play it with `sim.Match(cfg).play()` and export it with `sim.write`.
