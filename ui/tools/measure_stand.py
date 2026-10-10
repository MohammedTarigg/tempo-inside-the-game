"""Measure a reference stadium as a cross-section, in metres. Only the outline is kept.

Usage: python3 -I ui/tools/measure_stand.py <stadium.glb> <out.json>

Finds the pitch (the big flat rectangle in the middle), then cuts a thin slice through the middle of a long side and of an end,
and records, for each metre out from the touchline, how high the seating is and where the roof sits above it."""
import json
import mmap
import struct
import sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
f = open(src, "rb"); mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
clen = struct.unpack("<I", mm[12:16])[0]; g = json.loads(mm[20:20 + clen]); bin0 = 20 + clen + 8
nodes = g["nodes"]; parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}


def local(i):
    n = nodes[i]
    if "matrix" in n:
        return np.array(n["matrix"], float).reshape(4, 4).T
    t = n.get("translation", [0, 0, 0]); x, y, z, w = n.get("rotation", [0, 0, 0, 1]); s = n.get("scale", [1, 1, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R @ np.diag(s); M[:3, 3] = t
    return M


_w = {}
def world(i):
    if i not in _w:
        _w[i] = (world(parent[i]) if i in parent else np.eye(4)) @ local(i)
    return _w[i]


chunks = []
for ni, node in enumerate(nodes):
    if "mesh" not in node:
        continue
    W = world(ni)
    for pr in g["meshes"][node["mesh"]]["primitives"]:
        a = g["accessors"][pr["attributes"]["POSITION"]]; v = g["bufferViews"][a["bufferView"]]
        off = bin0 + v.get("byteOffset", 0) + a.get("byteOffset", 0); stride = v.get("byteStride", 12) or 12
        raw = np.frombuffer(mm, np.uint8, stride * (a["count"] - 1) + 12, off)
        P = raw.reshape(-1)[(np.arange(a["count"])[:, None] * stride + np.arange(12)[None, :]).ravel()].view(np.float32).reshape(-1, 3) if stride != 12 else np.frombuffer(mm, np.float32, a["count"] * 3, off).reshape(-1, 3)
        P = P[::3].astype(np.float64)                                           # every third point is plenty for an outline
        chunks.append(P @ W[:3, :3].T + W[:3, 3])
P = np.concatenate(chunks)
lo, hi = np.percentile(P, 0.2, axis=0), np.percentile(P, 99.8, axis=0); size = hi - lo
upi = int(np.argmin(size)); a1, a2 = [i for i in range(3) if i != upi]
if size[a1] < size[a2]:
    a1, a2 = a2, a1                                                             # a1 runs along the stadium's length
# a real stadium is roughly 200 to 300 m long; pick the unit that makes it so
scale = min((1.0, 0.01, 0.0254, 0.001, 0.3048), key=lambda s: abs(size[a1] * s - 250))
P = P * scale; lo, hi, size = lo * scale, hi * scale, size * scale
ground = np.percentile(P[:, upi], 2)
h = P[:, upi] - ground; u = P[:, a1] - (lo[a1] + hi[a1]) / 2; v = P[:, a2] - (lo[a2] + hi[a2]) / 2
print(f"points used {len(P):,} | unit scale {scale} | overall {size[a1]:.0f} m long, {size[a2]:.0f} m wide, {np.percentile(h, 99.8):.0f} m high")
out = dict(source=src.split("/")[-1], length_m=round(float(size[a1])), width_m=round(float(size[a2])), height_m=round(float(np.percentile(h, 99.8)), 1), sections={})
for name, along, acrossv, half in (("long_side", u, v, size[a2] / 2), ("end", v, u, size[a1] / 2)):
    k = np.abs(along) < 3.0                                                     # a 6 m thick slice through the middle
    d = np.abs(acrossv[k]); hh = h[k]
    rows = []
    for m0 in range(0, int(half) + 2, 2):
        b = (d >= m0) & (d < m0 + 2)
        if b.sum() < 6:
            rows.append((m0, None, None)); continue
        hs = np.sort(hh[b])
        # seating: the top of the lower, dense body of points. roof: a separate layer well above it
        gaps = np.diff(hs); j = int(np.argmax(gaps)) if len(gaps) else 0
        if len(gaps) and gaps[j] > 4.0 and hs[j + 1] > 8:
            rows.append((m0, round(float(np.percentile(hs[:j + 1], 97)), 1), round(float(hs[j + 1]), 1)))
        else:
            rows.append((m0, round(float(np.percentile(hs, 97)), 1), None))
    out["sections"][name] = rows
    print(f"--- {name}: metres out from the centre line : top of what is there : roof underside")
    print("   ", "  ".join(f"{m0}:{a if a is not None else '-'}{('/' + str(r)) if r is not None else ''}" for m0, a, r in rows))
json.dump(out, open(dst, "w"), indent=1)
