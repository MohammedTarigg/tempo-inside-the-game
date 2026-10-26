"""The one command: `tempo <step>`. Each step is a thin call into the module that owns it."""

import argparse
import os
import sys

from .paths import DATA

DFL_OPEN, DFL_CACHE = os.path.join(DATA, "dfl-open"), os.path.join(DATA, "dfl-cache")


def run(a):
    from .pipeline.run import main

    main(["--plain", str(a.plain)] if a.plain is not None else [])


def feed(a):
    from .azure import settings, wire
    from .pipeline.feeder import play
    from .pipeline.run import generate

    md = generate(a.plain)
    mid = md["meta"]["match_id"]
    if not settings().eventhubs_namespace:
        sys.exit("tempo feed plays into Event Hubs: set TEMPO_AZURE_EVENTHUBS_NAMESPACE, or run `tempo live --feed`")
    print(f"{mid}: {play(md, wire(mid, os.path.join('.work', mid)).bus, a.speed, not a.no_commentary)} messages")


def live(a):
    from .pipeline.live import serve
    from .pipeline.run import generate

    md = generate(a.plain) if a.feed else None
    match_id = md["meta"]["match_id"] if md else a.match
    serve(match_id, a.port, feed_md=md, speed=a.speed, out=a.out)


def listen(a):
    from .azure.speech import serve
    from .jsonio import write_json
    from .paths import RESULTS

    lines = serve(a.match, a.audio, a.at, live=not a.fast)
    write_json(
        os.path.join(RESULTS, "speech.json"), dict(match_id=a.match, audio=a.audio, at=a.at, lines=lines), indent=1
    )
    print(f"{len(lines)} lines; results/speech.json")


def index(a):
    from . import season as seasonmod
    from .azure import settings
    from .azure.search import upload_season

    cfg = settings()
    if not cfg.search_endpoint:
        sys.exit("set TEMPO_AZURE_SEARCH_ENDPOINT")
    print(f"{upload_season(cfg, seasonmod.load()[1])} attacks in the {cfg.search_index} index")


def season(a):
    from .season import build

    build(a.matches)


def check(a):
    from .eval.checks import main

    main()


def calls(a):
    from .eval.calls import main

    main([str(a.matches), str(a.workers)])


def realism(a):
    from .eval.realism import main

    main([DFL_CACHE])


def physics(a):
    from .eval.physics import main

    main(a.demo)


def ghost(a):
    from .instruments.ghost import train

    train()


def data(a):
    from .stake import dfl

    dfl.fetch(DFL_OPEN)
    dfl.convert(DFL_OPEN, DFL_CACHE)


def train(a):
    from .stake.train import main

    main(DFL_CACHE)


def types(a):
    from .pipeline.typescript import write

    write(check=a.check)


STEPS = [
    ("run", run, "run the demo match (or a plain one) through the pipeline and write it for the site"),
    ("feed", feed, "play a match into Event Hubs as the providers deliver it, at real-time speed"),
    ("live", live, "the live service: play a match through the pipeline from the bus as it arrives"),
    ("listen", listen, "the listener service: commentary audio through AI Speech, one line per thing said"),
    ("index", index, "put the season's attacks in AI Search for the closest earlier attempt"),
    ("season", season, "build the generated season: what is usual, the mined habits, the archive of attacks"),
    ("check", check, "the pipeline checks: no reading ahead, recovery, the planted story, the verifier"),
    ("calls", calls, "measure the kick-off calls on matches the season never saw"),
    ("realism", realism, "compare generated football with the seven real matches (needs tempo data)"),
    ("physics", physics, "scan a generated match for motion that cannot happen"),
    ("ghost", ghost, "fit the ghost defender on the generated season"),
    ("data", data, "download and convert the DFL open matches into data/"),
    ("train", train, "train and evaluate the stake model on the DFL matches (needs tempo data)"),
    ("types", types, "write the site's TypeScript types from the pipeline's contracts"),
]


def main(argv=None):
    p = argparse.ArgumentParser(prog="tempo", description="Tempo: before the moment, the stake; after it, the reason.")
    sub = p.add_subparsers(dest="step", required=True)
    for name, fn, help_ in STEPS:
        s = sub.add_parser(name, help=help_, description=help_)
        s.set_defaults(fn=fn)
        if name == "run":
            s.add_argument("--plain", type=int, metavar="SEED", help="an unscripted match with this seed")
        if name in ("feed", "live"):
            s.add_argument("--plain", type=int, metavar="SEED", help="an unscripted match with this seed")
            s.add_argument("--speed", type=float, default=1.0, help="times real time; 0 is as fast as the bus takes it")
        if name == "feed":
            s.add_argument("--no-commentary", action="store_true", help="leave the commentary to the listener service")
        if name == "live":
            s.add_argument("match", nargs="?", default="m_demo", help="the match to serve")
            s.add_argument("--feed", action="store_true", help="play the match into the bus from this process too")
            s.add_argument("--port", type=int, help="for /healthz, /cues and /negotiate; PORT or 8080 by default")
            s.add_argument("--out", help="where the run's files go at full time; web/public/runs/<match> by default")
        if name == "listen":
            s.add_argument("--match", default="m_demo")
            s.add_argument(
                "--audio", default=os.path.join("assets", "audio", "commentator.wav"), help="a file or stream"
            )
            s.add_argument("--at", type=float, default=0.0, help="the match time, in seconds, the audio starts at")
            s.add_argument("--fast", action="store_true", help="as fast as the service takes it, not at speaking speed")
        if name == "season":
            s.add_argument("--matches", type=int, default=40)
        if name == "calls":
            s.add_argument("--matches", type=int, default=300)
            s.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
        if name == "physics":
            s.add_argument("--demo", action="store_true", help="scan the demo match rather than a plain one")
        if name == "types":
            s.add_argument("--check", action="store_true", help="fail if the written types are out of date")
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
