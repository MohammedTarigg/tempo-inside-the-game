"""Reading and writing JSON files, closed when done and written whole or not at all."""

import json
import os


def read_json(path):
    with open(path) as f:
        return json.load(f)


def write_json(path, obj, **kw):
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, **kw)
    os.replace(tmp, path)
