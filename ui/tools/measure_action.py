"""Measure a one-off football action (a pass, a tackle, a header) from a reference animation in Collada form.

Usage: python3 -I ui/tools/measure_action.py <reference.dae> <name> ui/replay/figure_data.json

Only numbers leave this script: for each frame, the angle of each limb from straight down (forwards and sideways), the lean of
the spine, and how far the hips rise or drop. They are written into figure_data.json under actions.<name>. No mesh, skeleton or
animation file is copied, and the reference file is deleted afterwards. Our figures replay these angles on their own bodies."""
import json
import sys
import xml.etree.ElementTree as ET
import numpy as np

src, name, dst = sys.argv[1], sys.argv[2], sys.argv[3]
NS = {"c": "http://www.collada.org/2005/11/COLLADASchema"}
root = ET.parse(src).getroot()
unit = float(root.find("c:asset/c:unit", NS).get("meter"))
mat = lambda text: np.array(text.split(), float).reshape(4, 4)

parent, bind = {}, {}
def walk(node, par):
    nid = node.get("id") or node.get("name")
    m = node.find("c:matrix", NS)
    bind[nid] = mat(m.text) if m is not None else np.eye(4)
    parent[nid] = par
    for ch in node.findall("c:node", NS):
        walk(ch, nid)
for top in root.find("c:library_visual_scenes/c:visual_scene", NS).findall("c:node", NS):
    walk(top, None)

anim, times = {}, None
for a in root.find("c:library_animations", NS).iter("{%s}animation" % NS["c"]):
    ch = a.find("c:channel", NS)
    if ch is None:
        continue
    target = ch.get("target").split("/")[0]
    arrays = {s.get("id"): np.array(s.find("c:float_array", NS).text.split(), float) for s in a.findall("c:source", NS) if s.find("c:float_array", NS) is not None}
    roles = {i.get("semantic"): i.get("source").lstrip("#") for i in a.find("c:sampler", NS).findall("c:input", NS)}      # which source is time, which is the matrices
    t, out = arrays[roles["INPUT"]], arrays[roles["OUTPUT"]]
    anim[target] = out.reshape(-1, 4, 4)
    times = t if times is None else times
n = len(times)


def positions(frame):
    cache = {}
    def W(j):
        if j not in cache:
            local = anim[j][frame] if (frame is not None and j in anim) else bind[j]
            cache[j] = (W(parent[j]) if parent[j] is not None else np.eye(4)) @ local
        return cache[j]
    return {j: W(j)[:3, 3] * unit for j in bind}


J = lambda s: next(k for k in bind if k.endswith(s))
SEG = {"thigh_l": ("LeftUpLeg", "LeftLeg"), "calf_l": ("LeftLeg", "LeftFoot"), "foot_l": ("LeftFoot", "LeftToeBase"), "thigh_r": ("RightUpLeg", "RightLeg"),
       "calf_r": ("RightLeg", "RightFoot"), "foot_r": ("RightFoot", "RightToeBase"), "upper_arm_l": ("LeftArm", "LeftForeArm"), "forearm_l": ("LeftForeArm", "LeftHand"),
       "upper_arm_r": ("RightArm", "RightForeArm"), "forearm_r": ("RightForeArm", "RightHand"), "spine": ("Hips", "Neck")}
up = np.array([0.0, 1.0, 0.0])
p0 = positions(0)
fwd = p0[J("LeftToeBase")] - p0[J("LeftFoot")] + p0[J("RightToeBase")] - p0[J("RightFoot")]; fwd[1] = 0; fwd /= np.linalg.norm(fwd)
lat = np.cross(up, fwd)                                    # the figure's left
leg = np.linalg.norm(p0[J("LeftLeg")] - p0[J("LeftUpLeg")]) + np.linalg.norm(p0[J("LeftFoot")] - p0[J("LeftLeg")])
swing = {k: [] for k in SEG}; out = {k: [] for k in SEG}; hips = []; travel = []
for f in range(n):
    p = positions(f)
    for k, (a, b) in SEG.items():
        d = p[J(b)] - p[J(a)]; d /= np.linalg.norm(d)
        if k == "spine":
            swing[k].append(np.arctan2(d @ fwd, d @ up)); out[k].append(np.arctan2(d @ lat, d @ up))
        else:
            swing[k].append(np.arctan2(d @ fwd, -(d @ up))); out[k].append(np.arcsin(np.clip(d @ lat, -1, 1)))
    hips.append((p[J("Hips")][1] - p0[J("Hips")][1]) / leg); travel.append(float((p[J("Hips")] - p0[J("Hips")]) @ fwd))
unwrap = lambda v: [round(float(x), 3) for x in np.unwrap(np.array(v))]
data = json.load(open(dst))
data.setdefault("actions", {})[name] = dict(duration=round(float(times[-1]), 3), frames=n, swing={k: unwrap(v) for k, v in swing.items()}, out={k: unwrap(v) for k, v in out.items()},
                                           hips=[round(float(x), 3) for x in hips])
json.dump(data, open(dst, "w"), indent=1)
deg = lambda v: (round(float(np.degrees(min(v)))), round(float(np.degrees(max(v)))))
kick = "r" if max(swing["thigh_r"]) > max(swing["thigh_l"]) else "l"
print(f"{name}: {n} frames, {times[-1]:.2f} s | kicking leg looks like the {'right' if kick == 'r' else 'left'}: thigh {deg(swing['thigh_' + kick])} deg, shin {deg(swing['calf_' + kick])} deg"
      f" | other thigh {deg(swing['thigh_' + ('l' if kick == 'r' else 'r')])} deg | spine lean {deg(swing['spine'])} deg | hips drop up to {abs(min(hips)) * leg * 100:.0f} cm | hips travel {max(travel) - min(travel):.2f} m")
