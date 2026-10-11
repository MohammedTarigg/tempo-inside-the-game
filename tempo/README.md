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

Both draw the same stage (`ui/stage.js`): a green pitch at a broadcast tilt, 105 by 68 m with markings to the laws of the game, a numbered marker for each player and the ball. Colour appears only where it carries meaning: the green of the pitch, a colour for each team and the yellow of a card. Panels, type and everything the system draws on the pitch are black, white or grey. A marker shows only what the tracking feed knows: where the player is, which way his body faces (a wedge that watches the ball and turns towards his run as he speeds up) and how fast he is going (a streak once he sprints).

The Tempo mark, the app icon and the two club crests are drawn by `ui/brand/make.py`; `ui/brand/preview.html` shows them. `ui/brand/intro.html` plays the intro, which also runs over the match view when it loads (`?intro=0` skips it).

The match view (`ui/live/`) plays the whole match. Positions come from `runs/m_demo/match.bin` (25 frames a second, whole centimetres) and everything else from `runs/m_demo/match.json`, where each cue carries the frame it was issued on. The page decides nothing. It draws:

- **Before kick-off:** the three marks from the season so far, one after another, on a wide view of the pitch: the channels a team shoots from with arrows, the space one player guards with the outline of a card, and the late window on the strip.
- **The stake mark:** a yellow ring round a booked player and a small card above his shoulder. Faint, the ring is thin and the card an outline. Lit, the ring is whole, the card solid, and his name appears.
- **A tag** over a player for an unusual number, with what is normal beneath it, and **a duel count** between two players.
- **The label** at the next stoppage, **the form card** when the commentator names a player, and **the half-time and full-time cards.**
- **At a goal,** a Replay tag, with a link to the replay view when a close earlier attempt exists.
- **The strip under the picture:** momentum for each side, bookings, goals, the danger window and the playhead. Click or drag it to move through the match. Next moment and Back jump between the things worth seeing; the speed button plays at 1, 4 or 16 times.
- **The phone** says the same moment in words, in casual, analyst or Arabic.

The replay view (`ui/replay/`) plays the closest-earlier-attempt scene from `runs/m_demo/scenes.json`: the goal, back to the start, both attempts laid over each other (the earlier one as outlined markers), slow motion where they part with the gap between the differing player's two positions measured, and the finish.

In the match view add `?m=49` to open paused at a minute, `?f=` for a frame, or `?run=<match_id>` for another run. In the replay add `?t=20`. Add `?bench=1` to either to time the drawing itself; the result is in `window.__tempo.bench`. On the development laptop the match view drew a frame in 4.6 ms at the median.

**The product film** is at `http://localhost:8771/ui/tour/`. It runs for 100 seconds on its own: the intro, the logo settling into a corner, the pitch drawing itself, then eight features one at a time, each with a number, a sentence and small chips saying what powers it. It is the match view above driven by a director script (`ui/tour/tour.js`), playing the real run. A dashed chip marks something that is planned and not built. Add `?at=42` to start at a second and `?hold=1` to stay on that feature.

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
