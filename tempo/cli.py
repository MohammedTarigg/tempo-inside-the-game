"""The one command: `tempo <step>`. Each step is a thin call into the module that owns it."""

import argparse
import os
import sys

from .paths import DATA

DFL_OPEN, DFL_CACHE = os.path.join(DATA, "dfl-open"), os.path.join(DATA, "dfl-cache")


def run(a):
    from .pipeline.run import main

    main(["--plain", str(a.plain)] if a.plain is not None else [])


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
