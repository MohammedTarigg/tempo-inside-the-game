// Tempo's own figures and ball, built in code. No model file is loaded.
// Each player is one continuous skinned body, shaped ring by ring: torso, neck and head, arms to the fingertips, legs, boots,
// shorts, with a kit, a hairline, a nose and ears, and no drawn face. Proportions, gaits and football actions come from figure_data.json, a file
// of measurements (see ui/tools/measure_reference.py and measure_action.py).
import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0), XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
const SKIN = [0xEFC6A2, 0xD9A67C, 0xB98459, 0x8E5E3B, 0x6A432B];
const HAIR = [0x17120F, 0x2B1D15, 0x4A3322, 0x77532F, 0xB08D52, 0x3A3A3C];
const NATURAL = { idle: 0, walk: 1.5, jog: 3.4, sprint: 6.8 };          // metres a second each gait was measured at
const ORDER = ['idle', 'walk', 'jog', 'sprint'];
const LIMBS = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'upper_arm_l', 'forearm_l', 'upper_arm_r', 'forearm_r', 'spine'];
const B = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, upperarm_l: 5, forearm_l: 6, hand_l: 7, upperarm_r: 8, forearm_r: 9, hand_r: 10,
  thigh_l: 11, shin_l: 12, foot_l: 13, thigh_r: 14, shin_r: 15, foot_r: 16 };
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
const REST_FOOT = new THREE.Vector3(0, -0.073, 0.155).normalize();        // from the ankle to the ball of the foot, standing

function at(arr, f) {                                                     // a measured series, read between its frames
  const n = arr.length - 1, i = Math.min(n, Math.max(0, Math.floor(f))), j = Math.min(n, i + 1), t = Math.min(1, Math.max(0, f - i));
  return arr[i] + (arr[j] - arr[i]) * t;
}
function wave(c, ph) {                                                   // [mean, cos1, sin1, cos2, sin2, cos3, sin3]
  let y = c[0];
  for (let k = 1; k <= 3; k++) y += c[2 * k - 1] * Math.cos(k * ph) + c[2 * k] * Math.sin(k * ph);
  return y;
}

export function prepare(data) {
  // line the gaits up so the left thigh swings forward at the same point of each cycle; then they can be blended
  const ref = Math.atan2(data.gaits.jog.swing.thigh_l[2], data.gaits.jog.swing.thigh_l[1]);
  for (const g of ORDER) {
    const c = data.gaits[g].swing.thigh_l;
    data.gaits[g].shift = g === 'idle' ? 0 : Math.atan2(c[2], c[1]) - ref;
  }
  // for each measured action: the striking leg is the one whose thigh swings furthest forward, and the moment of contact
  // is where its shin is swinging forward fastest
  for (const a of Object.values(data.actions || {})) {
    const side = Math.max(...a.swing.thigh_r) > Math.max(...a.swing.thigh_l) ? 'r' : 'l', shin = a.swing[`calf_${side}`];
    let best = 1, top = -1e9;
    for (let k = 1; k < shin.length; k++) { const v = shin[k] - shin[k - 1]; if (v > top) { top = v; best = k; } }
    a.fps = (a.frames - 1) / a.duration; a.contact = best / a.fps; a.side = side;
  }
  return data;
}

// ---------- sculpting ----------
// A body part is a tube: a stack of rings, each an ellipse with its own width, front depth and back depth, colour and bone weights.
class Sculpt {
  constructor() { this.pos = []; this.col = []; this.si = []; this.sw = []; this.idx = []; this.c = new THREE.Color(); }
  vertex(p, hex, w) {
    this.pos.push(p[0], p[1], p[2]); this.c.setHex(hex); this.col.push(this.c.r, this.c.g, this.c.b);
    const a = [0, 0, 0, 0], b = [0, 0, 0, 0]; w.slice(0, 4).forEach(([bone, wt], k) => { a[k] = bone; b[k] = wt; });
    this.si.push(...a); this.sw.push(...b);
    return this.pos.length / 3 - 1;
  }
  // rings: [{ c:[x,y,z], ru, rv | [rvFront, rvBack], col: hex | (k,N)=>hex, w:[[bone,weight]], push: (k,N)=>metres }]
  tube(rings, N, u = [1, 0, 0], v = [0, 0, 1]) {
    const starts = [];
    for (const r of rings) {
      const [vf, vb] = Array.isArray(r.rv) ? r.rv : [r.rv, r.rv];
      starts.push(this.pos.length / 3);
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), ex = r.push ? r.push(k, N) : 0;
        const pu = (r.ru + ex) * ca, pv = ((sa >= 0 ? vf : vb) + ex) * sa;
        this.vertex([r.c[0] + u[0] * pu + v[0] * pv, r.c[1] + u[1] * pu + v[1] * pv, r.c[2] + u[2] * pu + v[2] * pv], typeof r.col === 'function' ? r.col(k, N) : r.col, r.w);
      }
    }
    // which way is out? Wind the faces so their normals point away from the tube's axis.
    const f = rings[0].c, l = rings[rings.length - 1].c, w = [l[0] - f[0], l[1] - f[1], l[2] - f[2]];
    const cx = v[1] * w[2] - v[2] * w[1], cy = v[2] * w[0] - v[0] * w[2], cz = v[0] * w[1] - v[1] * w[0];
    const out = cx * u[0] + cy * u[1] + cz * u[2] > 0;
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < N; k++) {
      const a = starts[i] + k, b = starts[i] + (k + 1) % N, c = starts[i + 1] + (k + 1) % N, d = starts[i + 1] + k;
      if (out) this.idx.push(a, b, c, a, c, d); else this.idx.push(a, c, b, a, d, c);
    }
    for (const [ri, end] of [[0, false], [rings.length - 1, true]]) {                       // close both ends
      const r = rings[ri], centre = this.vertex(r.c, typeof r.col === 'function' ? r.col(0, N) : r.col, r.w);
      for (let k = 0; k < N; k++) { const a = starts[ri] + k, b = starts[ri] + (k + 1) % N; if (out === end) this.idx.push(centre, a, b); else this.idx.push(centre, b, a); }
    }
  }
  // a shell made of rows that need not be level: fn(k, j) gives the point of column k (round the head) in row j (bottom to top)
  shell(rows, N, fn, w) {
    const start = this.pos.length / 3;
    for (let j = 0; j < rows; j++) for (let k = 0; k < N; k++) { const q = fn(k, j); this.vertex(q.p, q.col, w); }
    for (let j = 0; j < rows - 1; j++) for (let k = 0; k < N; k++) {
      const a = start + j * N + k, b = start + j * N + (k + 1) % N, c = start + (j + 1) * N + (k + 1) % N, d = start + (j + 1) * N + k;
      this.idx.push(a, c, b, a, d, c);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}

const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const cache = new Map();
function body(P, kit, skin, hair, style) {
  const key = [kit.shirt, kit.shorts, kit.socks, kit.trim, skin, hair, style].join('|');
  if (cache.has(key)) return cache.get(key);
  const S = new Sculpt(), H = P.hip_height, NK = P.neck_height, SH = P.shoulder_height, SW = P.shoulder_half_width, HW = P.hip_half_width;
  const one = (b) => [[b, 1]], mix = (a, b, t) => [[a, 1 - t], [b, t]];
  const side = (base, trim) => (k, N) => (k === 0 || k === N / 2 ? trim : base);            // a stripe down each side seam
  // --- torso, neck and head: one tube from the crotch to the crown ---
  const hairline = (a) => 1.700 + (Math.sin(a) > 0 ? 0.052 : -0.058) * Math.sin(a) ** 2;      // high on the forehead, low at the nape
  const lift = style === 1 ? 0.013 : style === 2 ? 0.0025 : 0.007, hairHex = style === 2 ? mixHex(skin, hair, 0.55) : hair;
  const headRing = (y, rx, zf, zb) => ({ c: [0, y, 0.004], ru: rx, rv: [zf, zb], w: one(B.head), col: skin });
  // the head: a few key levels (height, half-width, front depth, back depth) joined by a smooth curve, so it has no flat bands
  const keys = [[1.560, 0.047, 0.050, 0.049], [1.583, 0.057, 0.079, 0.053], [1.604, 0.067, 0.091, 0.062], [1.630, 0.073, 0.094, 0.076], [1.655, 0.076, 0.095, 0.086],
    [1.675, 0.0775, 0.094, 0.091], [1.695, 0.078, 0.092, 0.095], [1.715, 0.078, 0.090, 0.098], [1.740, 0.076, 0.087, 0.097], [1.765, 0.071, 0.080, 0.093], [1.786, 0.062, 0.069, 0.082], [1.802, 0.047, 0.052, 0.062], [1.812, 0.026, 0.029, 0.035]];
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const headRings = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[Math.max(i - 1, 0)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(i + 2, keys.length - 1)];
    for (let j = 0; j < 3; j++) headRings.push([0, 1, 2, 3].map((q) => cr(k0[q], k1[q], k2[q], k3[q], j / 3)));
  }
  headRings.push(keys[keys.length - 1]);
  S.tube([
    { c: [0, H - 0.105, 0], ru: 0.060, rv: 0.070, col: kit.shorts, w: one(B.hips) },
    { c: [0, H - 0.04, 0], ru: 0.162, rv: [0.108, 0.118], col: side(kit.shorts, kit.trim), w: one(B.hips) },
    { c: [0, H + 0.05, 0], ru: 0.160, rv: [0.106, 0.110], col: side(kit.shorts, kit.trim), w: mix(B.hips, B.spine, 0.2) },
    { c: [0, H + 0.052, 0], ru: 0.169, rv: [0.114, 0.116], col: kit.shirt, w: mix(B.hips, B.spine, 0.25) },         // the shirt hangs over the shorts
    { c: [0, H + 0.16, 0], ru: 0.152, rv: [0.104, 0.098], col: side(kit.shirt, kit.trim), w: mix(B.hips, B.spine, 0.7) },
    { c: [0, H + 0.28, 0], ru: 0.166, rv: [0.118, 0.106], col: side(kit.shirt, kit.trim), w: mix(B.spine, B.chest, 0.6) },
    { c: [0, H + 0.40, 0], ru: 0.184, rv: [0.128, 0.112], col: kit.shirt, w: one(B.chest) },
    { c: [0, SH - 0.035, 0], ru: 0.184, rv: [0.116, 0.108], col: kit.shirt, w: one(B.chest) },
    { c: [0, SH + 0.006, 0], ru: 0.156, rv: [0.100, 0.098], col: kit.shirt, w: one(B.chest) },
    { c: [0, SH + 0.034, 0], ru: 0.104, rv: [0.080, 0.084], col: kit.shirt, w: one(B.chest) },
    { c: [0, NK - 0.004, 0], ru: 0.066, rv: [0.064, 0.066], col: kit.trim, w: mix(B.chest, B.neck, 0.4) },           // collar
    { c: [0, NK + 0.006, 0.002], ru: 0.052, rv: [0.052, 0.054], col: skin, w: one(B.neck) },
    { c: [0, 1.535, 0.004], ru: 0.050, rv: [0.050, 0.051], col: skin, w: mix(B.neck, B.head, 0.5) },
    ...headRings.map((r) => headRing(r[0], r[1], r[2], r[3])),
  ], 28);
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    const x = sg * SW, UA = B[`upperarm_${s}`], FA = B[`forearm_${s}`], HN = B[`hand_${s}`], el = SH - P.upper_arm, wr = el - P.forearm;
    // --- arm: shoulder cap, sleeve with a hem, elbow, forearm, wrist, hand ---
    S.tube([
      { c: [x - sg * 0.040, SH + 0.022, 0], ru: 0.030, rv: 0.040, col: kit.shirt, w: mix(B.chest, UA, 0.3) },
      { c: [x - sg * 0.014, SH + 0.002, 0], ru: 0.050, rv: 0.056, col: kit.shirt, w: mix(B.chest, UA, 0.6) },
      { c: [x - sg * 0.004, SH - 0.07, 0], ru: 0.054, rv: 0.057, col: kit.shirt, w: one(UA) },
      { c: [x, SH - 0.150, 0], ru: 0.056, rv: 0.058, col: kit.shirt, w: one(UA) },
      { c: [x, SH - 0.158, 0], ru: 0.057, rv: 0.059, col: kit.trim, w: one(UA) },                                    // sleeve hem
      { c: [x, SH - 0.160, 0], ru: 0.044, rv: 0.047, col: skin, w: one(UA) },
      { c: [x, SH - 0.22, 0], ru: 0.041, rv: 0.044, col: skin, w: mix(UA, FA, 0.2) },
      { c: [x, el, 0], ru: 0.038, rv: 0.041, col: skin, w: mix(UA, FA, 0.5) },
      { c: [x, el - 0.05, 0], ru: 0.041, rv: 0.041, col: skin, w: mix(UA, FA, 0.85) },
      { c: [x, el - 0.15, 0], ru: 0.035, rv: 0.034, col: skin, w: one(FA) },
      { c: [x, wr + 0.01, 0], ru: 0.026, rv: 0.023, col: skin, w: mix(FA, HN, 0.4) },
      { c: [x, wr - 0.04, 0.004], ru: 0.018, rv: 0.040, col: skin, w: one(HN) },
      { c: [x, wr - 0.09, 0.008], ru: 0.015, rv: 0.036, col: skin, w: one(HN) },
      { c: [x, wr - 0.125, 0.010], ru: 0.009, rv: 0.020, col: skin, w: one(HN) },
    ], 12);
    // --- leg: thigh, knee, a sock with a band at the top, calf, ankle ---
    const lx = sg * HW, T = B[`thigh_${s}`], SN = B[`shin_${s}`], FT = B[`foot_${s}`], kn = H - P.thigh, an = kn - P.calf;
    S.tube([
      { c: [lx, H + 0.01, 0], ru: 0.080, rv: 0.088, col: kit.shorts, w: mix(B.hips, T, 0.4) },
      { c: [lx, H - 0.09, 0], ru: 0.088, rv: [0.092, 0.098], col: skin, w: mix(B.hips, T, 0.85) },
      { c: [lx, H - 0.20, 0.004], ru: 0.079, rv: [0.088, 0.084], col: skin, w: one(T) },
      { c: [lx, H - 0.31, 0.004], ru: 0.064, rv: [0.072, 0.066], col: skin, w: mix(T, SN, 0.15) },
      { c: [lx, kn, 0.004], ru: 0.055, rv: [0.062, 0.054], col: skin, w: mix(T, SN, 0.5) },
      { c: [lx, kn - 0.055, 0], ru: 0.050, rv: [0.050, 0.054], col: skin, w: mix(T, SN, 0.9) },
      { c: [lx, kn - 0.058, 0], ru: 0.053, rv: [0.053, 0.057], col: kit.trim, w: one(SN) },                           // sock band
      { c: [lx, kn - 0.085, 0], ru: 0.053, rv: [0.053, 0.060], col: kit.socks, w: one(SN) },
      { c: [lx, kn - 0.16, -0.004], ru: 0.053, rv: [0.050, 0.066], col: kit.socks, w: one(SN) },                       // the calf
      { c: [lx, kn - 0.29, 0], ru: 0.042, rv: [0.044, 0.046], col: kit.socks, w: one(SN) },
      { c: [lx, an + 0.02, 0], ru: 0.035, rv: [0.038, 0.040], col: kit.socks, w: mix(SN, FT, 0.4) },
      { c: [lx, an - 0.03, 0.006], ru: 0.036, rv: [0.042, 0.038], col: kit.socks, w: one(FT) },
    ], 14);
    // --- the leg of the shorts: a loose shell over the thigh, with a hem ---
    S.tube([
      { c: [lx, H + 0.03, 0], ru: 0.090, rv: [0.100, 0.108], col: kit.shorts, w: mix(B.hips, T, 0.3) },
      { c: [lx, H - 0.07, 0], ru: 0.100, rv: [0.106, 0.112], col: (k, N) => (k === (sg > 0 ? 0 : N / 2) ? kit.trim : kit.shorts), w: mix(B.hips, T, 0.6) },
      { c: [lx, H - 0.19, 0.003], ru: 0.099, rv: [0.106, 0.104], col: (k, N) => (k === (sg > 0 ? 0 : N / 2) ? kit.trim : kit.shorts), w: mix(B.hips, T, 0.9) },
      { c: [lx, H - 0.215, 0.003], ru: 0.098, rv: [0.105, 0.103], col: kit.trim, w: one(T) },
      { c: [lx, H - 0.212, 0.003], ru: 0.080, rv: [0.088, 0.084], col: mixHex(kit.shorts, 0x000000, 0.5), w: one(T) },
    ], 14);
    // --- boot: heel to toe, flat on its sole, a pale sole edge ---
    const boot = 0x121416, sole = (k, N) => (k > N / 2 + 1 && k < N - 1 ? 0xE8E6DE : boot), by = an - 0.052;
    S.tube([
      { c: [lx, by + 0.004, -0.066], ru: 0.020, rv: [0.026, 0.020], col: boot, w: one(FT) },
      { c: [lx, by + 0.004, -0.050], ru: 0.036, rv: [0.050, 0.044], col: sole, w: one(FT) },
      { c: [lx, by + 0.006, 0.000], ru: 0.041, rv: [0.060, 0.046], col: sole, w: one(FT) },
      { c: [lx, by, 0.060], ru: 0.046, rv: [0.044, 0.040], col: sole, w: one(FT) },
      { c: [lx, by - 0.004, 0.125], ru: 0.046, rv: [0.030, 0.036], col: sole, w: one(FT) },
      { c: [lx, by - 0.008, 0.178], ru: 0.038, rv: [0.022, 0.032], col: sole, w: one(FT) },
      { c: [lx, by - 0.012, 0.205], ru: 0.022, rv: [0.014, 0.026], col: boot, w: one(FT) },
    ], 12, [1, 0, 0], [0, 1, 0]);
  }
  // --- hair: a cap over the skull whose lower edge is the hairline, so the edge is clean ---
  const prof = (y) => {                                                       // the head's half-width and depths at any height
    let i = 0; while (i < headRings.length - 2 && headRings[i + 1][0] < y) i++;
    const a = headRings[i], b = headRings[i + 1], t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  };
  const HN = 32, rowsT = [0, 0.10, 0.28, 0.5, 0.72, 0.88, 0.97, 1];
  S.shell(rowsT.length, HN, (k, j) => {
    const a = (k / HN) * Math.PI * 2, y = hairline(a) + (1.812 - hairline(a)) * rowsT[j], [rx, zf, zb] = prof(Math.min(y, 1.812));
    const out = lift * (0.55 + 0.9 * Math.sin(Math.PI * Math.min(1, rowsT[j] * 1.15))), fade = 1;                 // the skull's own outline rounds the top
    const top = rowsT[j] === 1;                                               // the last row closes the crown, rounded and never pointed
    return { p: [top ? 0 : (rx + out) * Math.cos(a) * fade, top ? 1.8155 + lift * 0.5 : y, top ? 0.004 : ((Math.sin(a) >= 0 ? zf : zb) + out) * Math.sin(a) * fade + 0.004], col: hairHex };
  }, one(B.head));
  // --- the head's own shapes: ears and a nose. No eyes, brows or mouth: at match distance they are not seen, and up close
  // simple ones looked wrong. ---
  const hd = one(B.head), blob = (c, ru, rv, depth, col, u, v, n = 8) => {
    const ax = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];      // the way the shape faces
    S.tube([-0.5, -0.2, 0.25, 0.5].map((t, k) => ({ c: [c[0] + ax[0] * depth * t, c[1] + ax[1] * depth * t, c[2] + ax[2] * depth * t], ru: ru * [0.55, 1, 0.9, 0.35][k], rv: rv * [0.55, 1, 0.9, 0.35][k], col, w: hd })), n, u, v);
  };
  for (const sg of [1, -1]) blob([sg * 0.0795, 1.692, 0.004], 0.0085, 0.0260, 0.020, skin, [0, 0, 1], [0, 1, 0], 10);      // ears
  S.tube([                                                                                         // nose: bridge to tip, then the base
    { c: [0, 1.712, 0.086], ru: 0.0085, rv: [0.006, 0.004], col: skin, w: hd },
    { c: [0, 1.690, 0.094], ru: 0.0105, rv: [0.011, 0.004], col: skin, w: hd },
    { c: [0, 1.670, 0.100], ru: 0.0150, rv: [0.016, 0.004], col: skin, w: hd },
    { c: [0, 1.661, 0.094], ru: 0.0165, rv: [0.009, 0.004], col: skin, w: hd },
  ], 8);
  const g = S.geometry();
  cache.set(key, g);
  return g;
}

function numberTexture(n, ink) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = ink; g.font = '700 104px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Figure {
  constructor(data, { team, number, seed = 0, ghost = false, kit }) {
    this.data = data; this.P = data.proportions; this.ghost = ghost; this.phase = ((seed * 0.61803) % 1) * Math.PI * 2; this.yaw = 0;
    const P = this.P, H = P.hip_height, SH = P.shoulder_height, SW = P.shoulder_half_width, HW = P.hip_half_width, el = SH - P.upper_arm, kn = H - P.thigh;
    const rest = [[0, H, 0], [0, H + 0.13, 0], [0, H + 0.30, 0], [0, P.neck_height, 0], [0, P.head_joint_height, 0],
      [SW, SH, 0], [SW, el, 0], [SW, el - P.forearm, 0], [-SW, SH, 0], [-SW, el, 0], [-SW, el - P.forearm, 0],
      [HW, H, 0], [HW, kn, 0], [HW, kn - P.calf, 0], [-HW, H, 0], [-HW, kn, 0], [-HW, kn - P.calf, 0]];
    this.bones = rest.map(() => new THREE.Bone());
    rest.forEach((p, i) => { const q = PARENT[i] < 0 ? [0, 0, 0] : rest[PARENT[i]]; this.bones[i].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (PARENT[i] >= 0) this.bones[PARENT[i]].add(this.bones[i]); });
    this.material = ghost
      ? new THREE.MeshBasicMaterial({ color: team ? 0xD5EEFB : 0xFFDEC6, transparent: true, opacity: 0, depthWrite: false })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
    const geo = body(P, kit, SKIN[seed % SKIN.length], HAIR[(seed * 3) % HAIR.length], seed % 3);
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.add(this.bones[0]); this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = !ghost; this.mesh.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    if (!ghost) {
      const ink = new THREE.Color(kit.shirt).getHSL({}).l > 0.6 ? '#10202E' : '#F6F4EC', tex = numberTexture(number, ink);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.21), mat); back.position.set(0, 0.10, -0.116); back.rotation.y = Math.PI; this.bones[B.chest].add(back);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.085), mat); front.position.set(0.075, 0.15, 0.127); this.bones[B.chest].add(front);
    }
    this.qw = rest.map(() => new THREE.Quaternion()); this.tmp = new THREE.Quaternion(); this.d = new THREE.Vector3();
  }

  setOpacity(o) { if (this.ghost) { this.material.opacity = o; this.group.visible = o > 0.01; } }

  // speed in metres a second; rate is how fast time is running (1 real time, 0.3 slow motion, 0 paused).
  // act, when given, is a measured action to lay over the gait: { name, t: seconds into it, w: 0 to 1 }.
  update(dt, speed, rate, act) {
    const w = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    if (speed < 0.4) w.idle = 1;
    else if (speed < 1.8) { const t = (speed - 0.4) / 1.4; w.idle = 1 - t; w.walk = t; }
    else if (speed < 3.6) { const t = (speed - 1.8) / 1.8; w.walk = 1 - t; w.jog = t; }
    else if (speed < 6.5) { const t = (speed - 3.6) / 2.9; w.jog = 1 - t; w.sprint = t; }
    else w.sprint = 1;
    let cycle = 0, pace = 0;
    for (const g of ORDER) { cycle += w[g] * this.data.gaits[g].duration; pace += w[g] * NATURAL[g]; }
    const tempo = pace > 0.2 ? Math.min(1.5, Math.max(0.6, speed / pace)) : 1;      // feet keep pace with the ground
    this.phase += dt * rate * tempo * Math.PI * 2 / cycle;
    const A = {}; let bob = 0, armOut = 0, foreOut = 0;
    for (const k of LIMBS) A[k] = 0;
    for (const g of ORDER) {
      if (!w[g]) continue;
      const gt = this.data.gaits[g], ph = this.phase + gt.shift;
      for (const k of LIMBS) A[k] += w[g] * wave(gt.swing[k], ph);
      bob += w[g] * (wave(gt.bob, ph) - gt.bob[0]) * 0.35;
      armOut += w[g] * Math.abs(gt.out.upper_arm_l); foreOut += w[g] * Math.abs(gt.out.forearm_l);
    }
    // sideways lean of each limb, positive towards the figure's left. Arms sit a little out from the body; legs run straight.
    const O = {}; for (const k of LIMBS) O[k] = 0;
    O.upper_arm_l = armOut * 0.42; O.upper_arm_r = -armOut * 0.42; O.forearm_l = foreOut * 0.25; O.forearm_r = -foreOut * 0.25;
    if (act && act.w > 0 && this.data.actions && this.data.actions[act.name]) {
      const a = this.data.actions[act.name], f = act.t * a.fps, k2 = act.w, legLen = this.P.thigh + this.P.calf;
      for (const k of LIMBS) { A[k] += (at(a.swing[k], f) - A[k]) * k2; O[k] += (at(a.out[k], f) * (k.includes('arm') ? 0.6 : 1) - O[k]) * k2; }      // arms a little closer in than measured
      bob += (at(a.hips, f) * legLen - bob) * k2;
    }
    this.pose(A, bob, O);
  }

  pose(A, bob, O) {
    const P = this.P, q = this.qw, d = this.d, L = A.spine, Ls = O.spine;
    const lean = (i, k) => { q[i].setFromAxisAngle(XA, L * k); this.tmp.setFromAxisAngle(ZA, -Ls * k); q[i].multiply(this.tmp); };
    lean(B.hips, 0.3); lean(B.spine, 0.65); lean(B.chest, 1.0); lean(B.neck, 0.5); lean(B.head, 0.22);      // the head stays nearer level than the chest
    const aim = (i, k, from = DOWN) => { const t = A[k], o = O[k]; d.set(Math.sin(o), -Math.cos(t) * Math.cos(o), Math.sin(t) * Math.cos(o)); q[i].setFromUnitVectors(from, d); };
    let low = 9;
    for (const s of ['l', 'r']) {
      aim(B[`upperarm_${s}`], `upper_arm_${s}`); aim(B[`forearm_${s}`], `forearm_${s}`); q[B[`hand_${s}`]].copy(q[B[`forearm_${s}`]]);
      aim(B[`thigh_${s}`], `thigh_${s}`); aim(B[`shin_${s}`], `calf_${s}`); aim(B[`foot_${s}`], `foot_${s}`, REST_FOOT);
      const drop = P.thigh * Math.cos(A[`thigh_${s}`]) * Math.cos(O[`thigh_${s}`]) + P.calf * Math.cos(A[`calf_${s}`]) * Math.cos(O[`calf_${s}`]);
      low = Math.min(low, P.hip_height + bob - drop);
    }
    // keep the lower foot on the turf: lift the hips if it would sink, and settle them most of the way if it would float
    const gap = P.ankle_height - low;
    this.bones[0].position.y = P.hip_height + bob + (gap > 0 ? gap : gap * 0.7);
    for (let i = 0; i < q.length; i++) {
      if (PARENT[i] < 0) this.bones[i].quaternion.copy(q[i]);
      else this.bones[i].quaternion.copy(this.tmp.copy(q[PARENT[i]]).invert().multiply(q[i]));
    }
  }
}

// our own match ball: true size, white with three curved bands
export function makeBall() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#F6F5EF'; g.fillRect(0, 0, 512, 256);
  const band = (col, phase, amp, w) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath();
    for (let x = -10; x <= 522; x += 4) { const y = 128 + amp * Math.sin((x / 512) * Math.PI * 2 + phase); x === -10 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  };
  band('#0B2A20', 0, 62, 20); band('#FFD21F', 2.1, 62, 11); band('#0B2A20', 4.2, 62, 20);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 28, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 }));
  ball.castShadow = true;
  return ball;
}
