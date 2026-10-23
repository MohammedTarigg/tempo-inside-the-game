"""From the schema in schema.py to the site: the TypeScript types (`tempo types`), and a check that a real file matches
the schema, used by the tests on the demo run."""

import os
import types
import typing
from typing import Literal, NotRequired, Required, get_args, get_origin, get_type_hints, is_typeddict

from ..paths import ROOT
from . import schema

OUT = os.path.join(ROOT, "web", "src", "types", "run.ts")


def _ts(tp):
    origin, args = get_origin(tp), get_args(tp)
    if origin in (NotRequired, Required):
        return _ts(args[0])
    if tp is type(None):
        return "null"
    if tp is str:
        return "string"
    if tp in (int, float):
        return "number"
    if tp is bool:
        return "boolean"
    if origin is Literal:
        return " | ".join(f"'{a}'" if isinstance(a, str) else str(a) for a in args)
    if origin in (types.UnionType, typing.Union):
        return " | ".join(_ts(a) for a in args)
    if origin is list:
        inner = _ts(args[0])
        return f"({inner})[]" if "|" in inner else f"{inner}[]"
    if origin is dict:
        return f"Record<string, {_ts(args[1])}>"
    if is_typeddict(tp):
        return tp.__name__
    raise TypeError(f"no TypeScript for {tp!r}")


def render():
    out = [
        "// Written by `tempo types` from tempo/pipeline/schema.py. Do not edit: change the schema and run it again.",
        "",
    ]
    for name, obj in vars(schema).items():
        if is_typeddict(obj) and obj.__module__ == schema.__name__:
            hints = get_type_hints(obj, include_extras=True)
            out.append(f"export interface {name} {{")
            for key, tp in hints.items():
                optional = key not in obj.__required_keys__
                out.append(f"  {key}{'?' if optional else ''}: {_ts(tp)};")
            out += ["}", ""]
        elif get_origin(obj) in (types.UnionType, typing.Union):
            out += [f"export type {name} =", *(f"  | {_ts(a)}" for a in get_args(obj))]
            out[-1] += ";"
            out.append("")
    return "\n".join(out)


def write(check=False):
    text = render()
    current = None
    if os.path.exists(OUT):
        with open(OUT) as f:
            current = f.read()
    if check:
        if current != text:
            raise SystemExit(f"{os.path.relpath(OUT, ROOT)} is out of date: run tempo types")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(text)
    print("wrote", os.path.relpath(OUT, ROOT))


def mismatches(value, tp, path="$"):
    """Every place where `value` does not have the shape `tp` says, as readable paths. Empty means it matches."""
    origin, args = get_origin(tp), get_args(tp)
    if origin in (NotRequired, Required):
        return mismatches(value, args[0], path)
    if tp is type(None):
        return [] if value is None else [f"{path}: expected null"]
    if tp is str:
        return [] if isinstance(value, str) else [f"{path}: expected a string"]
    if tp is bool:
        return [] if isinstance(value, bool) else [f"{path}: expected true or false"]
    if tp is int:
        return [] if isinstance(value, int) and not isinstance(value, bool) else [f"{path}: expected a whole number"]
    if tp is float:
        return [] if isinstance(value, int | float) and not isinstance(value, bool) else [f"{path}: expected a number"]
    if origin is Literal:
        return [] if value in args else [f"{path}: {value!r} is not one of {args}"]
    if origin in (types.UnionType, typing.Union):
        tries = [mismatches(value, a, path) for a in args]
        return [] if any(not t for t in tries) else min(tries, key=len)
    if origin is list:
        if not isinstance(value, list):
            return [f"{path}: expected a list"]
        return [m for i, v in enumerate(value) for m in mismatches(v, args[0], f"{path}[{i}]")]
    if origin is dict:
        if not isinstance(value, dict):
            return [f"{path}: expected an object"]
        return [m for k, v in value.items() for m in mismatches(v, args[1], f"{path}.{k}")]
    if is_typeddict(tp):
        if not isinstance(value, dict):
            return [f"{path}: expected an object"]
        hints = get_type_hints(tp, include_extras=True)
        out = [f"{path}: missing {k}" for k in tp.__required_keys__ if k not in value]
        out += [f"{path}: unexpected {k}" for k in value if k not in hints]
        out += [m for k, v in value.items() if k in hints for m in mismatches(v, hints[k], f"{path}.{k}")]
        return out
    raise TypeError(f"cannot check {tp!r}")
