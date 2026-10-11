# Tempo, local build

The whole pipeline, running on one machine with no cloud. The front end is not part of this build.

## Run it

```bash
python3 -m tempo.run_match
```

Generates the demo match (Northgate v Harbour City), runs it through the pipeline and writes `runs/m_demo/`. About 30 seconds.

```bash
python3 -m tempo.server m_demo 8765
```

Serves that run to a front end: `/meta`, `/replay`, `/cues`, `/facts/<id>` and `/stream?speed=20` (cues as server-sent events, released by match time).

```bash
python3 -m tempo.eval.checks
```

Runs the 14 checks and writes `artifacts/checks.json`. About 3 minutes.

```bash
python3 -m tempo.eval.realism data/dfl-cache 31 32
```

Compares generated matches with the seven real ones and writes `artifacts/realism.json`.

```bash
python3 -m tempo.eval.physics demo
```

Scans the demo match for motion that cannot happen (ball or player jumps, passes that do not slow) and writes `artifacts/physics.json`.

```bash
python3 -u -m tempo.stake.train data/dfl-cache
```

Trains the stake model with the fair (nested) evaluation and writes the artefacts. Hours on a laptop.

Needs Python 3 with numpy and torch. Nothing else is installed.

## The views

Serve the project folder:

```bash
python3 -m http.server 8771
```

Then open `http://localhost:8771/ui/live/index.html` or `http://localhost:8771/ui/replay/index.html`. Both need a connection for three.js and the fonts.

Both draw the same stage (`ui/stage.js`): a dark pitch at a broadcast tilt, 105 by 68 m with markings to the laws of the game, a numbered marker for each player and a lit ball. A marker shows only what the tracking feed knows: where the player is, which way he is going (a wedge; standing still, he watches the ball) and how fast (a streak once he sprints). A ring opens where someone plays the ball, and a stronger one where a challenge is made.

The live view plays three minutes around a booking from `runs/m_demo/live.json`. The picture stays clear until a booked player is drawn into the play. Then his marker gets a yellow ring and a card on a pin: faint at the lower threshold, solid and lit at the higher one. Around the picture are the scoreboard and clock, the list of booked players, a label at the next stoppage ("Stahl booked"), and a phone panel that says the same moment in words: who is at stake, why, and the chance of a challenge. The page decides nothing. It shows each cue when the match clock reaches it.

The replay plays the closest-earlier-attempt scene from `runs/m_demo/scenes.json`: the goal, back to the start, both attempts laid over each other (the earlier one as outlined markers), slow motion where they part with the gap between the differing player's two positions measured, and the finish.

Add `?t=20` to open paused at a moment, or `?run=<match_id>` for another run. Add `?bench=1` to time the drawing itself; the result is in `window.__tempo.bench`. On the development laptop the live view drew a frame in 5.5 ms at the median.

An earlier 3D version with figures built in code is on the `3d-figures` branch.

## What a run leaves in `runs/<match_id>/`

| File | What it is |
|---|---|
| `cues.jsonl` | Every cue, stamped with match time: form, screen, when to show, payload, the fact IDs behind it |
| `facts.jsonl` | The fact ledger |
| `audit.jsonl` | Everything shown, held back (with the reason), rejected or withdrawn |
| `replay.npz` | Positions at 5 frames a second, for drawing the match |
| `meta.json` | Squads, IDs, score |
| `summary.json` | Counts, timings, which model was used |
| `scenes.json` | Both attempts of each replay scene at 25 frames a second, turned to run the same way |
| `live.json` | Three minutes of live play at 12.5 frames a second with every cue and ball strike inside it |
| `planted.json` | What the storyline planted, for checking |

## Cue forms a front end will receive

| Form | Screen | Payload |
|---|---|---|
| `kickoff_mark` | tv | `mark` (channels, zone, window), `zone`, `subject`, `text` |
| `danger_window` | tv | `from_minute`, `to_minute`, `subject` |
| `stake_card` | tv | `player`, `level` (0 off, 1 faint, 2 full), `chance`, `stake` |
| `tag` | tv | `player`, `text`, `note` |
| `duel` | tv | `defender`, `attacker`, `defender_won`, `attacker_won` |
| `form_card` | tv | `player`, `per_minute`, `usual_percentile`, `top_speed`, `heard` |
| `label` | tv | `text`, six words or fewer |
| `scene` | tv | `type` (closest_attempt or plain), `camera.behind`, `goal_frame`, `earlier_frame`, `light`, `label` |
| `sentence` | phone | `lang` (en, ar), `depth` (casual, analyst), `text`, `numbers` |
| `sentence` | desk | `text`, `proposals` from each team agent, `took` |
| `halftime_card`, `fulltime_card` | tv | `cards`: up to three of `title`, `text`, `mark` |

`when` is `now`, `next_pause` or `next_replay`. A cue with `status: withdrawn` must be removed from the screen.

## Where each part lives

| Part | File | In production |
|---|---|---|
| Data contracts | `contracts.py` | Opta event feed, Second Spectrum tracking feed |
| Match generator | `generator/sim.py`, `story.py`, `export.py` | Replaced by the real feeds through the same shapes |
| Stake model | `stake/features.py`, `model.py`, `train.py`, `dfl.py` | The same |
| Reflex service | `reflex.py` | Azure Container Apps |
| Closest earlier attempt | `twin.py` | Archive in Azure AI Search |
| Fact ledger, cues, checkpoints | `ledger.py` | Azure Cosmos DB |
| Bus | `bus.py` | Azure Event Hubs |
| Cue service | `cues.py` | Container Apps, out through Azure Web PubSub |
| Agents, Verifier | `agents.py` | Microsoft Agent Framework on Foundry, through `FoundryBackend` |
| Listener | `listener.py` | Azure AI Speech |
| Season | `season.py` | The league archive |
| Runner | `run_match.py` | |
| Checks | `eval/checks.py`, `eval/realism.py` | GitHub Actions gate |

## Not in this build

- Any Azure service. Each has a local stand-in behind the same interface.
- A language model. Sentences come from templates, which is also the fallback path when a model is slow or down. `FoundryBackend` is the seam.
- The decision model. The Director's choices are rules.
- The front end.
- A 380-match season. The season is a six-match sample; `season.build(n)` takes any size.

## Data credit

The stake model is trained on the DFL open tracking set: Bassek et al. 2025, CC BY 4.0, https://doi.org/10.6084/m9.figshare.28196177. The product ingests and shows generated data only.
