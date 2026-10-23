# Tempo

Before the moment, the stake. After it, the reason. The rest of the time, a clear screen.

Tempo is a layer over a Premier League broadcast. A booked defender lights up with a card above his shoulder when he is one challenge from a red. A goal comes back as a replay laid over the closest earlier attempt, with the one thing that changed measured. Three things to watch are said before kick-off, and at full time Tempo shows what became of each. Every number, name and minute on screen is checked against the match record before it is shown, and anything the screen held back is listed, with its reason, on a producer's desk.

Built for the Microsoft and Premier League "Inside the Game" hackathon. The match on screen is generated: Northgate against Harbour City, two invented clubs, in the shapes the real Opta and Second Spectrum feeds use. The one model trained on real football, the stake model, learned from seven open Bundesliga matches.

## See it

```bash
bun install
bun run dev
```

Then open http://localhost:5173. The home page is the logo's halfway line, and scrolling moves the eye along it to four ways in, each opening a window on its page:

- **The film**, 107 seconds on the real match view: the seven features in match order, then the evidence.
- **The match**, the whole demo match with everything Tempo chose to show, the phone beside it in English or Arabic, and a follow control for one club or one player. At full time the strip rises into the turning points, and each one plays again when tapped.
- **The producer's desk**, the same match with every item Tempo considered, as it aired or with the short reason it was held.
- **How we know**, every figure Tempo claims, what it was measured on, and the command that measures it again.

Pages take a moment in the match: `/match/?m=72` opens at minute 72, `/match/?follow=p_har_6` follows one player, `/film/?at=40` starts the film at second 40.

## Run the pipeline

The pipeline is Python, run with [uv](https://docs.astral.sh/uv/):

```bash
uv sync
uv run tempo run
```

`tempo run` generates the demo match, plays it through the pipeline and writes it to `web/public/runs/m_demo/`, where the site reads it. The other steps:

| Command | What it does |
|---|---|
| `uv run tempo check` | The pipeline's 14 checks: no reading ahead, recovery after a stop, the planted story found, the verifier |
| `uv run tempo calls` | Measures the calls made before kick-off on 20 matches the season never saw |
| `uv run tempo season` | Builds the 40-match generated season and mines the calls from it |
| `uv run tempo physics --demo` | Scans the demo match for motion that cannot happen |
| `uv run tempo data` | Downloads the seven DFL open matches and converts them |
| `uv run tempo realism` | Compares generated football with the real matches |
| `uv run tempo train` | Trains and evaluates the stake model on the real matches |
| `uv run tempo ghost` | Fits the ghost defender on generated matches |
| `uv run tempo types` | Writes the site's TypeScript types from the pipeline's schema |

## How it is built

Two feeds go in at the front: events in the Opta shape and tracking in the Second Spectrum shape, 25 frames a second. A reflex service keeps a running record of every player: his card, his duels, his running, the stake model's score for his next challenge, and at a goal where an average defender would have stood. Moments that need words go to a writer, and a verifier holds every sentence to the facts it cites, by position, before it leaves. A cue service applies the producer's rules and stamps each item with the match time it belongs to, so every screen shows it when its own picture reaches that moment.

Today each cloud part has a local stand-in behind the same interface: SQLite for Cosmos DB, an in-process bus for Event Hubs and Web PubSub, templates for the Foundry model. [docs/architecture.md](docs/architecture.md) has the whole design, the evaluations and what is built once on Azure.

## In this repository

| Folder | What is in it |
|---|---|
| `tempo/` | The pipeline: `generator/` (the match), `pipeline/` (ledger, reflex service, cue service, the run and its files), `agents/` (writer, backends, verifier), `instruments/` (ghost, earlier attempt, call rules), `stake/` (the stake model), `eval/` (the checks) |
| `web/` | The site: six pages on one stage, in TypeScript with Vite and three.js. `web/public/runs/m_demo/` is the demo match |
| `models/` | The trained stake model and ghost, each with its metrics, and the generated season |
| `results/` | What each evaluation measured. The evidence page reads these |
| `experiments/` | The tests behind design decisions, with their results |
| `tests/`, `web/e2e/` | Unit tests, the contract between pipeline and site, the demo match reproduced byte for byte, and every page opened in a browser |
| `tools/` | The film's sound, the logo files, and the moving previews on the home page |
| `assets/audio/` | The recordings the film's sound is cut from, with their licences |

## Checks

Every push runs the same gates ([.github/workflows/ci.yml](.github/workflows/ci.yml)):

```bash
uv run ruff check . && uv run ruff format --check . && uv run pyright
uv run pytest
uv run tempo check
bun run lint && bun run typecheck && bun test web/src
bun run e2e
```

## Data and credits

The match data on screen is generated. The stake model is trained on the DFL open tracking dataset (Bassek et al. 2025, CC BY 4.0). The film's music, crowd and commentator voice are public domain or made for it. All sources and licences are in [CREDITS.md](CREDITS.md).
