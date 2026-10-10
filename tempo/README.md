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

## The live view

Serve the project folder (`python3 -m http.server 8770`) and open `http://localhost:8770/ui/live/index.html`. It plays three minutes of the match around the booking the replay scene turns on, as the television picture, from `runs/m_demo/live.json`.

- **The two-level card.** A booked player gets a faint card (an outline with a pale fill) while the model has him in the play, and a full card (solid and lit) when it puts a challenge at about one in five or more. The card is a television graphic, so it keeps a readable size and is never larger than the player.
- **The picture's other graphics:** scoreboard and clock, the list of booked players, a label at the next stoppage ("Stahl booked"), and number tags.
- **The phone panel** says the same moment in words: who is at stake, why, and the chance of a challenge.

The page decides nothing. It shows each cue when the match clock reaches it. Add `?t=65` to open paused at a moment and `?bench=1` to time the drawing. Both views share the pitch, stands and lights in `ui/replay/world.js`.

## The 3D replay

Serve the project folder and open the replay page:

```bash
python3 -m http.server 8770
```

Then go to `http://localhost:8770/ui/replay/index.html`. It plays the closest-earlier-attempt scene from `runs/m_demo/scenes.json`: the goal, back to the start, both attempts laid over each other, slow motion where they part, and the finish. Add `?t=20` to open paused at a moment, or `?run=<match_id>` for another run. It needs a connection for three.js and the fonts.

The figures and the ball are ours, built in code in `ui/replay/figure.js`. No model or animation file is loaded or shipped. Each player is one continuous skinned body shaped ring by ring (torso, neck and head, arms to the fingertips, legs, boots, shorts) with a kit, hems and trim, a hairline, a nose and ears. Their proportions, the way their limbs swing when walking, jogging and sprinting, and four football actions (pass, shot, slide tackle, header) come from `ui/replay/figure_data.json`, a file of measurements only: joint heights, limb lengths and limb angles over time. The measurements were taken from reference figures with `ui/tools/measure_reference.py` and `ui/tools/measure_action.py`, and every reference file was deleted afterwards. The pass and the shot are played when the pipeline says a player strikes the ball. Sizes are true: players 1.8 m, ball 22 cm, pitch 105 by 68 m.

The grass is drawn per pixel by a shader in `ui/replay/main.js`: mown bands whose light and dark sides swap with the viewing angle, patchy growth, blade grain that fades with distance, worn goalmouths, and painted lines that sit on the blades. Around the pitch are stands with a crowd, perimeter boards in plain colours with no brands, and four floodlights.

Players have a nose and ears and hair as a separate cap with a clean hairline, and no drawn face: eyes, brows and a mouth were tried and removed because simple ones looked wrong up close. Add `?face=1` for a close look at one player (`?face=35&dist=3.4` turns the camera 35 degrees and stands 3.4 m back).

The stands follow a measured cross-section: seating starts 6 m beyond the touchline and 9.5 m behind the goal line, rises at about 25 degrees to 20 m on the long sides and 16 m at the ends, under a roof at 25 m with a strip of lights along its front edge.

Three reference files were measured for this and are not in the project: two player figures (Sketchfab, CC BY 4.0, by "Bendy y Boris Gamers" and "iszadine") and a stadium (Sketchfab Standard licence, by "Razny"). The player figures depict real footballers, so nothing of their faces was used; they only confirmed general head proportions. The stadium's licence does not allow redistribution, so only the outline of its stands, in metres, was taken (`ui/tools/measure_head.py`, `ui/tools/measure_stand.py`).

Add `?bench=1` to time the drawing itself; the result is in `window.__tempo.bench`. On the development laptop it drew a frame in 16 ms at the median and 22 ms at the 95th percentile, at 1046 by 1700 pixels with 76 draw calls.

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
