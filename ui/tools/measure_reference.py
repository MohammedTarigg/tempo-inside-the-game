"""Measure a reference figure: its proportions and how its limbs swing when it walks, jogs and sprints.

Usage: python3 -I ui/tools/measure_reference.py <reference.glb> ui/replay/figure_data.json

Only numbers leave this script: joint heights and limb lengths, and for each gait a few sine-wave terms per limb angle. No mesh,
skeleton or animation file is copied. Our figures are then built in code from these numbers (ui/replay/figure.js), and the reference
file is deleted."""
import json
import struct
import sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
b = open(src, "rb").read()
jl = struct.unpack("<I", b[12:16])[0]
g = json.loads(b[20:20 + jl])
bin0 = b[20 + jl + 8:]
NC = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def acc(i):
    a = g["accessors"][i]; v = g["bufferViews"][a["bufferView"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0); n = NC[a["type"]]
    return np.frombuffer(bin0, np.float32, a["count"] * n, off).reshape(a["count"], n).astype(float)


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


nodes = g["nodes"]
parent = {}
for i, n in enumerate(nodes):
    for c in n.get("children", []):
        parent[c] = i
name = {n.get("name"): i for i, n in enumerate(nodes)}


def local(i, pose):
    n = nodes[i]
    t = pose.get((i, "translation"), n.get("translation", [0, 0, 0]))
    r = pose.get((i, "rotation"), n.get("rotation", [0, 0, 0, 1]))
    s = pose.get((i, "scale"), n.get("scale", [1, 1, 1]))
    M = np.eye(4); M[:3, :3] = qmat(r) @ np.diag(s); M[:3, 3] = t
    return M


def world_positions(pose):
    cache = {}
    def W(i):
        if i not in cache:
            cache[i] = (W(parent[i]) if i in parent else np.eye(4)) @ local(i, pose)
        return cache[i]
    return {nm: W(i)[:3, 3] for nm, i in name.items() if nm}


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        q = a + t * (b - a)
    else:
        th = np.arccos(d); q = (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)
    return q / np.linalg.norm(q)


rest = world_positions({})
up = np.array([0.0, 1.0, 0.0])
fwd = rest["ball_l"] - rest["foot_l"]; fwd[1] = 0; fwd /= np.linalg.norm(fwd)
lat = np.cross(up, fwd)
H = rest["Head"][1]
P = lambda k: rest[k]
prop = dict(
    hip_height=float(P("thigh_l")[1]), hip_half_width=float(abs(P("thigh_l") @ lat)), thigh=float(np.linalg.norm(P("calf_l") - P("thigh_l"))),
    calf=float(np.linalg.norm(P("foot_l") - P("calf_l"))), ankle_height=float(P("foot_l")[1]), foot=float(np.linalg.norm(P("ball_l") - P("foot_l"))),
    shoulder_height=float(P("upperarm_l")[1]), shoulder_half_width=float(abs(P("upperarm_l") @ lat)), upper_arm=float(np.linalg.norm(P("lowerarm_l") - P("upperarm_l"))),
    forearm=float(np.linalg.norm(P("hand_l") - P("lowerarm_l"))), neck_height=float(P("neck_01")[1]), head_joint_height=float(H), pelvis_height=float(P("pelvis")[1]))
print("proportions (metres):", {k: round(v, 3) for k, v in prop.items()})

SEG = {"thigh_l": ("thigh_l", "calf_l"), "calf_l": ("calf_l", "foot_l"), "foot_l": ("foot_l", "ball_l"), "thigh_r": ("thigh_r", "calf_r"), "calf_r": ("calf_r", "foot_r"),
       "foot_r": ("foot_r", "ball_r"), "upper_arm_l": ("upperarm_l", "lowerarm_l"), "forearm_l": ("lowerarm_l", "hand_l"), "upper_arm_r": ("upperarm_r", "lowerarm_r"),
       "forearm_r": ("lowerarm_r", "hand_r"), "spine": ("pelvis", "neck_01")}
NPH, K = 48, 3
gaits = {}
for label, clip in (("idle", "Idle_Loop"), ("walk", "Walk_Loop"), ("jog", "Jog_Fwd_Loop"), ("sprint", "Sprint_Loop")):
    an = next(a for a in g["animations"] if a["name"] == clip)
    tracks = []
    for ch in an["channels"]:
        s = an["samplers"][ch["sampler"]]
        tracks.append((ch["target"]["node"], ch["target"]["path"], acc(s["input"])[:, 0], acc(s["output"])))
    dur = max(t[2][-1] for t in tracks)
    sag = {k: [] for k in SEG}; side = {k: [] for k in SEG}; bob = []
    for ph in range(NPH):
        tt = dur * ph / NPH; pose = {}
        for node, path, times, vals in tracks:
            j = int(np.clip(np.searchsorted(times, tt) - 1, 0, len(times) - 2)); u = float(np.clip((tt - times[j]) / max(times[j + 1] - times[j], 1e-9), 0, 1))
            pose[(node, path)] = slerp(vals[j], vals[j + 1], u) if path == "rotation" else vals[j] + u * (vals[j + 1] - vals[j])
        w = world_positions(pose)
        for k, (a, c) in SEG.items():
            d = w[c] - w[a]; d /= np.linalg.norm(d)
            if k == "spine":
                sag[k].append(np.arctan2(d @ fwd, d @ up)); side[k].append(np.arctan2(d @ lat, d @ up))
            else:
                sag[k].append(np.arctan2(d @ fwd, -(d @ up))); side[k].append(np.arcsin(np.clip(d @ lat, -1, 1)))
        bob.append(w["pelvis"][1] - rest["pelvis"][1])
    def fit(y):
        y = np.unwrap(np.array(y)); ph = 2 * np.pi * np.arange(NPH) / NPH
        A = np.stack([np.ones(NPH)] + [f(k * ph) for k in range(1, K + 1) for f in (np.cos, np.sin)], 1)
        return [round(float(c), 4) for c in np.linalg.lstsq(A, y, rcond=None)[0]]
    gaits[label] = dict(duration=round(float(dur), 3), swing={k: fit(v) for k, v in sag.items()}, out={k: round(float(np.mean(v)), 4) for k, v in side.items()}, bob=fit(bob))
    th = np.degrees(np.array(sag["thigh_l"])); kn = np.degrees(np.array(sag["calf_l"]) - np.array(sag["thigh_l"])); ar = np.degrees(np.array(sag["upper_arm_l"]))
    print(f"{label:6s} cycle {dur:.2f} s | thigh swing {th.min():.0f} to {th.max():.0f} deg | knee bend up to {abs(kn.min()):.0f} deg | upper arm {ar.min():.0f} to {ar.max():.0f} deg | arms held out {np.degrees(np.mean(side['upper_arm_l'])):.0f} deg | hips bob {1000 * (max(bob) - min(bob)):.0f} mm")
json.dump(dict(note="Measurements only: proportions in metres, limb angles as sine-wave terms [mean, cos1, sin1, cos2, sin2, cos3, sin3] in radians over one gait cycle.",
               proportions={k: round(v, 4) for k, v in prop.items()}, gaits=gaits), open(dst, "w"), indent=1)
print("written", dst)
