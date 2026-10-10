"""Measure the shape of a head from a reference figure, as proportions only.

Usage: python3 -I ui/tools/measure_head.py <figure.glb> <out.json>

The head is cut into level slices from under the chin to the crown. For each slice the script records the half-width, how far
the front reaches and how far the back reaches, all as fractions of the head's height, and the outline of the face seen from the
side. Nothing else is kept: no mesh, no texture, no likeness. Several references are averaged before use so that our figures'
heads follow general human proportions and resemble no one."""
import json
import struct
import sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
with open(src, "rb") as f:
    f.read(12); clen = struct.unpack("<I4s", f.read(8))[0]; g = json.loads(f.read(clen)); f.read(8); blob = f.read()
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def acc(i):
    a = g["accessors"][i]; v = g["bufferViews"][a["bufferView"]]; dt = np.dtype(CT[a["componentType"]]); n = NC[a["type"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0); stride = v.get("byteStride", 0)
    if stride and stride != dt.itemsize * n:
        raw = np.frombuffer(blob, np.uint8, stride * (a["count"] - 1) + dt.itemsize * n, off)
        idx = (np.arange(a["count"])[:, None] * stride + np.arange(dt.itemsize * n)[None, :]).ravel()
        out = raw[idx].view(dt).reshape(a["count"], n)
    else:
        out = np.frombuffer(blob, dt, a["count"] * n, off).reshape(a["count"], n)
    out = out.astype(float)
    if a.get("normalized"):
        out /= np.iinfo(CT[a["componentType"]]).max
    return out


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


skin = g["skins"][0]; joints = skin["joints"]; names = [nodes[j].get("name", "") for j in joints]
ibm = acc(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
JW = np.stack([world(j) for j in joints]); SK = JW @ ibm                      # joint world times inverse bind: rest-pose skinning
find = lambda *keys: next(k for k, n in enumerate(names) if all(s.lower() in n.lower() for s in keys) and "end" not in n.lower() and "top" not in n.lower())
head = find("head"); hips = next(k for k, n in enumerate(names) if "hips" in n.lower() or "pelvis" in n.lower())
arms = [k for k, n in enumerate(names) if "arm" in n.lower() and "fore" not in n.lower()]
left = next(k for k in arms if "left" in names[k].lower() or "___r" not in names[k].lower() and "right" not in names[k].lower())
right = next(k for k in arms if k != left and ("right" in names[k].lower() or "___r" in names[k].lower()))
pj = lambda k: JW[k][:3, 3]
up = pj(head) - pj(hips); up /= np.linalg.norm(up)
lr = pj(left) - pj(right); lr -= (lr @ up) * up; lr /= np.linalg.norm(lr)
fwd = np.cross(lr, up)

head_node = joints[head]
def under_head(i):
    while i in parent:
        i = parent[i]
        if i == head_node:
            return True
    return False
pts = []; used = []
for ni, node in enumerate(nodes):
    if "mesh" not in node:
        continue
    for pr in g["meshes"][node["mesh"]]["primitives"]:
        at = pr["attributes"]
        if "JOINTS_0" not in at or "skin" not in node:
            if under_head(ni):                                                 # a rigid piece hung on the head
                P = acc(at["POSITION"]); pts.append((np.c_[P, np.ones(len(P))] @ world(ni).T)[:, :3]); used.append(("rigid", g["meshes"][node["mesh"]].get("name"), len(P)))
            continue
        P = acc(at["POSITION"]); J = acc(at["JOINTS_0"]).astype(int); W = acc(at["WEIGHTS_0"])
        W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
        Ph = np.c_[P, np.ones(len(P))]
        V = np.zeros((len(P), 3))
        for c in range(4):
            V += W[:, c:c + 1] * np.einsum("nij,nj->ni", SK[J[:, c]], Ph)[:, :3]
        dom = J[np.arange(len(P)), W.argmax(1)]
        keep = np.isin(dom, [head] + [k for k, n in enumerate(names) if "head" in n.lower()])
        if keep.any():
            pts.append(V[keep]); used.append(("skinned", g["meshes"][node["mesh"]].get("name"), int(keep.sum())))
if not pts:
    sys.exit(f"{src.split('/')[-1]}: no head geometry found (joints: {[n for n in names if 'head' in n.lower() or 'neck' in n.lower()]})")
H = np.concatenate(pts)
h = (H - pj(head)) @ up; x = (H - pj(head)) @ lr; z = (H - pj(head)) @ fwd
crown = np.percentile(h, 99.8)
band = (h > np.percentile(h, 35)) & (h < np.percentile(h, 75))
zc = (np.percentile(z[band], 2) + np.percentile(z[band], 98)) / 2
if (z[band] > zc).sum() < (z[band] < zc).sum():                                # the face carries the detail; if it is behind us, turn round
    z = -z; x = -x; zc = -zc
    print("   (turned the head round: the detailed side was facing the other way)")
# the chin: the lowest point of the front of the face
front = z > np.percentile(z, 70)
chin = np.percentile(h[front], 0.5)
hh = crown - chin
body = np.linalg.norm(pj(head) - pj(hips))
print(f"{src.split('/')[-1]}: head points {len(H):,} | chin to crown is {hh / body:.3f} of hips-to-head-joint | head joint sits {(0 - chin) / hh:.2f} of the way up from the chin")
k0 = np.abs(h - (chin + 0.62 * hh)) < 0.05 * hh                                # depth is measured from the middle of the skull
z0 = (np.percentile(z[k0], 2) + np.percentile(z[k0], 98)) / 2 if k0.sum() > 8 else zc
print("   pieces used:", used)
rings = []
for fr in np.linspace(0.02, 0.98, 13):
    k = np.abs(h - (chin + fr * hh)) < 0.022 * hh
    if k.sum() < 12:
        rings.append(None); continue
    xs, zs = x[k], z[k] - z0
    rings.append(dict(at=round(float(fr), 3), half_width=round(float((np.percentile(xs, 98) - np.percentile(xs, 2)) / 2 / hh), 3),
                      front=round(float(np.percentile(zs, 98) / hh), 3), back=round(float(-np.percentile(zs, 2) / hh), 3)))
profile = []
mid = np.abs(x) < 0.06 * hh
for fr in np.linspace(0.0, 1.0, 26):
    k = mid & (np.abs(h - (chin + fr * hh)) < 0.02 * hh)
    profile.append(round(float(np.percentile(z[k] - z0, 97) / hh), 3) if k.sum() > 4 else None)
json.dump(dict(source=src.split("/")[-1], rings=rings, profile=profile, joint_height=round(float(-chin / hh), 3)), open(dst, "w"), indent=1)
for r in rings:
    if r: print(f"   at {r['at']:.2f} of the way up: half-width {r['half_width']:.3f}, front {r['front']:.3f}, back {r['back']:.3f}")
pr = [(round(i / 25, 2), p) for i, p in enumerate(profile) if p is not None]
tip = max(pr[6:18], key=lambda t: t[1]); print(f"   side outline: furthest forward (the nose tip) at {tip[0]:.2f} of the way up, reaching {tip[1]:.3f}")
