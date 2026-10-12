// The stage both views share: a pitch seen at a broadcast tilt, a marker for each player and the ball.
// Colour appears only where it carries meaning: the green of the pitch, a colour for each team, and the yellow of a card.
// Everything the system draws on top is white.
// A marker shows only what the tracking feed knows: where he is, which way he is going and how fast.
// Importing this file builds the pitch once and puts the canvas in the page's #stage element.
import * as THREE from 'three';

export const KITS = [
  { shirt: 0xFF8A3D, rim: 0x000000, number: 0x000000, line: 0xFF8A3D, keeper: 0xB9B9B9 },   // home
  { shirt: 0x7FD0F5, rim: 0x000000, number: 0x000000, line: 0x7FD0F5, keeper: 0x58C492 },   // away
];
export const SIGNAL = 0xFFD21F, CARD = 0xFFD21F, INK = 0x000000, PAPER = 0xFFFFFF;
export const FONT = '"Hanken Grotesk", system-ui, sans-serif';
export const R = 0.8;                       // a marker is a symbol, drawn larger than the man so his number reads

const stageEl = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stageEl.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07180F);
const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 700);

// ---------- the pitch: 105 by 68 m, markings to the laws of the game ----------
// The markings can be drawn on stroke by stroke: drawPitch(0) is bare turf, drawPitch(1) the finished pitch. They start at the
// centre circle and work outwards. Nothing is repainted while that happens. Three pictures are made once: the turf, the
// finished lines, and a map of when each bit of line appears (darker is sooner). The pitch's shader shows a bit of line once
// the drawing has reached its time, so moving the drawing on costs one number a frame.
let goalsShow = () => {};
const pitchArt = (() => {
  const S = 18, M = 8, W = (105 + 2 * M) * S, H = (68 + 2 * M) * S, X = (x) => (x + 52.5 + M) * S, Y = (y) => (34 - y + M) * S, TAKES = 0.34;
  const sheet = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')]; };
  const [turfC, tg] = sheet(), [lineC, lg] = sheet(), [whenC, wg] = sheet();
  tg.fillStyle = '#07180F'; tg.fillRect(0, 0, W, H); tg.fillStyle = '#12482F'; tg.fillRect(X(-52.5), Y(34), 105 * S, 68 * S);
  for (let i = 0; i < 18; i += 2) { tg.fillStyle = 'rgba(255, 255, 255, 0.03)'; tg.fillRect(X(-52.5 + i * 105 / 18), Y(34), 105 / 18 * S, 68 * S); }   // mown bands
  wg.fillStyle = '#000'; wg.fillRect(0, 0, W, H);
  // every stroke has a turn: `from` is when it starts, as a share of the whole drawing, and it takes a third of it
  const strokes = [], spots = [];
  const stroke = (from, metres, path) => strokes.push({ from, metres, path });
  const box = (from, x0, y0, x1, y1) => stroke(from, 2 * (x1 - x0 + y1 - y0), (g) => g.rect(X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S));
  const arc = (from, x, y, r, a0, a1) => stroke(from, r * Math.abs(a1 - a0), (g) => g.arc(X(x), Y(y), r * S, a0, a1));
  const spot = (from, x, y) => spots.push({ from, x, y });
  arc(0, 0, 0, 9.15, -Math.PI / 2, Math.PI * 1.5); spot(0.05, 0, 0);
  stroke(0.12, 34, (g) => { g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(34)); }); stroke(0.12, 34, (g) => { g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(-34)); });
  box(0.3, -52.5, -34, 52.5, 34);
  for (const s of [-1, 1]) {
    const gx = s * 52.5;
    box(0.5, Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
    box(0.58, Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
    spot(0.62, gx - s * 11, 0);
    const a = Math.acos(5.5 / 9.15);                                            // the arc outside the area
    arc(0.64, gx - s * 11, 0, 9.15, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a);
    for (const k of [-1, 1]) {                                                  // corner arcs: the quarter that lies on the pitch
      const a0 = s < 0 ? (k > 0 ? 0 : -Math.PI / 2) : (k > 0 ? Math.PI / 2 : Math.PI);
      arc(0.66, gx, k * 34, 1, a0, a0 + Math.PI / 2);
    }
  }
  lg.strokeStyle = lg.fillStyle = '#fff'; lg.lineWidth = 0.13 * S;
  for (const st of strokes) { lg.beginPath(); st.path(lg); lg.stroke(); }
  for (const sp of spots) { lg.beginPath(); lg.arc(X(sp.x), Y(sp.y), 0.2 * S, 0, 7); lg.fill(); }
  // the map of when: each stroke laid down again and again, shorter and darker each time, so its start is soonest. It is
  // drawn wider than the line so the line's soft edge never reads a wrong time, and the latest strokes go down first so that
  // where two meet the sooner one wins.
  const grey = (time) => { const v = Math.round(Math.min(1, time) * 255); return `rgb(${v},${v},${v})`; }, STEPS = 56;
  wg.lineWidth = 0.13 * S * 4;
  for (const st of [...strokes].sort((p, q) => q.from - p.from)) for (let j = STEPS; j >= 1; j--) {
    wg.strokeStyle = grey(st.from + TAKES * j / STEPS); wg.setLineDash(j === STEPS ? [] : [st.metres * S * j / STEPS, 1e6]); wg.beginPath(); st.path(wg); wg.stroke();
  }
  wg.setLineDash([]);
  for (const sp of spots) for (let j = 8; j >= 1; j--) { wg.fillStyle = grey(sp.from + TAKES * j / 8); wg.beginPath(); wg.arc(X(sp.x), Y(sp.y), 0.2 * S * (0.6 + j / 8 * 1.6), 0, 7); wg.fill(); }
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const material = new THREE.ShaderMaterial({
    uniforms: { turf: { value: tex(turfC) }, lines: { value: tex(lineC) }, when: { value: tex(whenC) }, p: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D turf, lines, when; uniform float p; varying vec2 vUv; void main() { vec3 c = texture2D(turf, vUv).rgb; float t = texture2D(when, vUv).r; float on = smoothstep(t - 0.008, t, p); gl_FragColor = vec4(mix(c, vec3(1.0), texture2D(lines, vUv).a * 0.72 * on), 1.0); }',
  });
  return { material, w: 105 + 2 * M, h: 68 + 2 * M, paint(p) { material.uniforms.p.value = p; goalsShow(Math.min(1, Math.max(0, (p - 0.62) / TAKES))); } };
})();
export const drawPitch = (p) => pitchArt.paint(p);
{
  const { material, w, h } = pitchArt;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material); pitch.rotation.x = -Math.PI / 2; scene.add(pitch);
  const mat = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.55 });
  goalsShow = (k) => { mat.opacity = 0.55 * k; };                              // the goals come up with the lines round them
  for (const s of [-1, 1]) {                                                    // goals: 7.32 m wide, 2.44 m high
    const x = s * 52.5, d = s * 2, P = (a, y, z) => new THREE.Vector3(a, y, z), z = 3.66, top = 2.44;
    const pts = [P(x, 0, -z), P(x, top, -z), P(x, top, -z), P(x, top, z), P(x, top, z), P(x, 0, z), P(x, top, -z), P(x + d, 0, -z), P(x, top, z), P(x + d, 0, z), P(x + d, 0, -z), P(x + d, 0, z)];
    const goal = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat); scene.add(goal);
  }
}

// ---------- shared drawing helpers ----------
function canvasTexture(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const basic = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o });
const flat = (geo, mat, y, order) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = order; return m; };
const STREAK = canvasTexture(8, 64, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
// the referee's card, upright, as an outline and as a solid
const cardTexture = (solid) => canvasTexture(80, 112, (g, w, h) => {
  g.beginPath(); g.roundRect(8, 8, w - 16, h - 16, 10);
  if (solid) { g.fillStyle = css(CARD); g.fill(); g.lineWidth = 5; g.strokeStyle = css(INK); g.stroke(); } else { g.fillStyle = 'rgba(0, 0, 0, 0.6)'; g.fill(); g.lineWidth = 9; g.strokeStyle = css(CARD); g.stroke(); }
});
const CARD_OUTLINE = cardTexture(false), CARD_SOLID = cardTexture(true);

// One player. `group` sits at his position and never turns, so the number stays upright. `turn` carries the wedge that shows
// which way his body faces, and `motion` the streak that shows which way he is running. The two differ: a player watches the
// ball while he moves.
export class Marker {
  constructor({ number, kit, ghost = false }) {
    this.ghost = ghost; this.yaw = 0; this.k = 1; this.group = new THREE.Group(); this.turn = new THREE.Group(); this.motion = new THREE.Group(); this.group.add(this.turn, this.motion);
    const face = canvasTexture(192, 192, (g, n) => {
      // a ghost is where someone was: a pale disc inside a dashed ring, with no number
      g.beginPath(); g.arc(n / 2, n / 2, n * 0.44, 0, 7);
      if (ghost) { g.globalAlpha = 0.22; g.fillStyle = css(kit.line); g.fill(); g.globalAlpha = 1; g.lineWidth = n * 0.075; g.strokeStyle = css(kit.line); g.setLineDash([n * 0.11, n * 0.08]); g.stroke(); } else { g.fillStyle = css(kit.shirt); g.fill(); g.lineWidth = n * 0.055; g.strokeStyle = css(kit.rim); g.stroke(); }
      g.fillStyle = css(ghost ? kit.line : kit.number); g.font = `700 ${n * 0.46}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!ghost) g.fillText(String(number), n / 2, n * 0.53);      // an outline is where someone was, not a second player: no number
    });
    this.mats = [];
    const add = (mesh, parent, base) => { mesh.userData.base = base; this.mats.push(mesh); parent.add(mesh); return mesh; };
    add(flat(new THREE.PlaneGeometry(R * 2.27, R * 2.27), basic({ map: face }), 0.06, 3), this.group, 1);
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.22, 0, R + 0.1), new THREE.Vector3(0.22, 0, R + 0.1), new THREE.Vector3(0, 0, R + 0.46)]); tri.setIndex([0, 1, 2]);
    const wedge = new THREE.Mesh(tri, basic({ color: ghost ? kit.line : PAPER, side: THREE.DoubleSide })); wedge.position.y = 0.05; wedge.renderOrder = 3; add(wedge, this.turn, ghost ? 1 : 0.85);
    this.trail = flat(new THREE.PlaneGeometry(R * 1.2, 1), basic({ map: STREAK, color: kit.shirt, opacity: 0 }), 0.03, 2); this.motion.add(this.trail);
    if (!ghost) {
      // The stake, as in the mock-up: a yellow ring round him and a small card above his right shoulder.
      // Faint, the ring is thin and the card an outline. Lit, the ring is whole and the card solid.
      this.ring = flat(new THREE.RingGeometry(R + 0.14, R + 0.27, 64), basic({ color: SIGNAL, opacity: 0, side: THREE.DoubleSide }), 0.04, 2); this.group.add(this.ring);
      const badge = (tex) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })); sp.center.set(0.5, 0); sp.position.set(R * 1.15, 0.55, -R * 0.35); sp.renderOrder = 6; this.group.add(sp); return sp; };
      this.cardFaint = badge(CARD_OUTLINE); this.cardFull = badge(CARD_SOLID);
    }
  }
  update(dt, speed, rate) {                                                     // a streak behind him once he is sprinting
    const len = Math.max(0, speed - 5.5) * 1.1, on = this.ghost || !rate ? 0 : Math.min(1, len / 1.5) * 0.5 * this.k;
    this.trail.material.opacity += (on - this.trail.material.opacity) * Math.min(1, dt * 8 + (rate ? 0 : 1));
    const L = Math.max(0.2, len); this.trail.scale.set(1, L, 1); this.trail.position.z = -(R + L / 2);
  }
  // Which marker lies on top where two overlap. `layer` is a small number that grows towards the camera, so the nearer man covers
  // the further one, as bodies do. A marked player is lifted over everyone.
  order(layer = this.layerNow || 0) {
    this.layerNow = layer;
    this.group.traverse((o) => { if (o.isMesh) { o.userData.order ??= o.renderOrder; o.renderOrder = o.userData.order + (this.lifted || 0) + layer; } });
  }
  // What contact does to him. hit: the instant of a challenge, a quick give and spring back. down: 0 to 1, on the ground.
  setBody(hit, down) {
    const s = (1 - 0.18 * hit) * (1 - 0.26 * down); this.group.scale.set(s, 1, s); this.turn.visible = down < 0.5;
  }
  setOpacity(o) { this.k = o; this.group.visible = o > 0.004; for (const m of this.mats) m.material.opacity = m.userData.base * o; }
  // k: how far the mark has faded in. full: 0 faint, 1 lit. beat: a slow pulse for the lit ring, 0 to 1.
  setStake(k, full, beat = 1) {
    if (!this.ring) return;
    const up = k > 0.05 ? 10 : 0;                                               // a marked player is drawn over his neighbours
    if (up !== this.lifted) { this.lifted = up; this.order(); }
    this.ring.material.opacity = k * (0.5 + 0.5 * full) * (1 - 0.35 * full * (1 - beat));
    this.ring.scale.setScalar(1 - 0.06 * (1 - full));
    const s = 0.62 + 0.14 * full;                                               // metres wide; the card is 20 by 28
    this.cardFaint.scale.set(s, s * 1.4, 1); this.cardFull.scale.set(s, s * 1.4, 1);
    this.cardFaint.material.opacity = k * (1 - full); this.cardFull.material.opacity = k * full;
  }
}

// The ball, with a mark on the turf beneath it so its height reads.
export function makeBall(opacity = 1) {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity }));
  const rim = new THREE.Mesh(new THREE.SphereGeometry(0.255, 20, 14), new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, transparent: true, opacity }));
  const mark = flat(new THREE.CircleGeometry(0.22, 24), basic({ color: 0x000000, opacity: 0.6 * opacity }), 0.07, 4);
  ball.renderOrder = 5; rim.renderOrder = 5; group.add(mark, rim, ball);
  return {
    group,
    set(x, h, z) { group.position.set(x, 0, z); ball.position.y = rim.position.y = Math.max(h, 0.11) + 0.1; mark.scale.setScalar(1 + Math.min(h, 8) * 0.14); },
    setOpacity(o) { ball.material.opacity = o; rim.material.opacity = o; mark.material.opacity = 0.5 * o; group.visible = o > 0.004; },
  };
}

// A thin ring that opens where a challenge is made. The views say where and how old; nothing is remembered here.
export function makePulses(n = 4) {
  const rings = Array.from({ length: n }, () => { const m = flat(new THREE.RingGeometry(0.92, 1.0, 40), basic({ color: PAPER, opacity: 0, side: THREE.DoubleSide }), 0.035, 2); scene.add(m); return m; });
  return (list) => rings.forEach((m, i) => {
    const p = list[i]; if (!p) { m.material.opacity = 0; return; }
    const u = Math.min(1, p.age / 0.5); m.position.set(p.x, 0.035, p.z); m.scale.setScalar(1 + u * 1.6); m.material.opacity = (1 - u) * 0.7;
  });
}

// A patch of pitch the system points at: a pale fill that opens from its centre. A patch that follows a player is held by
// four corner brackets, which are drawn as solid shapes so they stay crisp and steady while it moves.
export function makeZone(color = PAPER) {
  const group = new THREE.Group();
  const fill = flat(new THREE.PlaneGeometry(1, 1), basic({ color, opacity: 0 }), 0.02, 1);
  const cg = new THREE.BufferGeometry(), cv = new Float32Array(8 * 4 * 3), ci = []; cg.setAttribute('position', new THREE.BufferAttribute(cv, 3));
  for (let q = 0; q < 8; q++) ci.push(4 * q, 4 * q + 1, 4 * q + 2, 4 * q, 4 * q + 2, 4 * q + 3); cg.setIndex(ci);
  const corners = new THREE.Mesh(cg, basic({ color, opacity: 0, side: THREE.DoubleSide })); corners.renderOrder = 2; corners.frustumCulled = false;
  group.add(fill, corners); scene.add(group); group.visible = false;
  return {
    set(x0, z0, x1, z1, k, bracket = true) {
      group.visible = k > 0.004; if (!group.visible) return;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, open = 0.86 + 0.14 * k, hx = Math.abs(x1 - x0) / 2 * open, hz = Math.abs(z1 - z0) / 2 * open;
      fill.position.set(cx, 0.02, cz); fill.scale.set(2 * hx, 2 * hz, 1); fill.material.opacity = k * (bracket ? 0.08 : 0.15);
      corners.visible = bracket; if (!bracket) return;
      const t = 0.22, L = Math.min(hx, hz) * 0.42; let o = 0;
      const quad = (ax, az, bx, bz) => { for (const [x, z] of [[ax, az], [bx, az], [bx, bz], [ax, bz]]) { cv[o++] = x; cv[o++] = 0.03; cv[o++] = z; } };
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = cx + sx * hx, z = cz + sz * hz;
        quad(x, z, x - sx * L, z - sz * t); quad(x, z - sz * t, x - sx * t, z - sz * L);      // one arm along each side, meeting at the corner
      }
      cg.attributes.position.needsUpdate = true; corners.material.opacity = k * 0.9;
    },
  };
}

// An arrow lying on the pitch. It grows from its tail as `k` goes from 0 to 1, by length and not point by point, so it moves
// evenly. The shaft is thin at the tail and full at the head, the head is there from the first moment, and `show` fades the
// whole arrow with whatever it belongs to.
export function makeArrow(color = PAPER) {
  const N = 48, geo = new THREE.BufferGeometry(), v = new Float32Array((2 * N + 3) * 3), idx = []; geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  for (let i = 1; i < N; i++) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  idx.push(2 * N, 2 * N + 1, 2 * N + 2); geo.setIndex(idx);
  const mat = basic({ color, opacity: 0, side: THREE.DoubleSide }), mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
  return {
    set(pts, k, width = 0.6, show = 1) {                                        // pts: [[x, z], ...] along the arrow
      mesh.visible = k > 0.004 && show > 0.004; if (!mesh.visible) return;
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1];
      const at = (d) => {                                                       // the point a distance d along it, and the way it is heading there
        let i = 1; while (i < pts.length - 1 && cum[i] < d) i++;
        const a = pts[i - 1], b = pts[i], L = cum[i] - cum[i - 1] || 1, f = Math.min(1, Math.max(0, (d - cum[i - 1]) / L));
        const p = pts[Math.max(0, i - 2)], n = pts[Math.min(pts.length - 1, i + 1)];      // heading turns smoothly from one piece to the next
        let tx = (b[0] - p[0]) * (1 - f) + (n[0] - a[0]) * f, tz = (b[1] - p[1]) * (1 - f) + (n[1] - a[1]) * f; const T = Math.hypot(tx, tz) || 1;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, tx / T, tz / T];
      };
      const tip = total * Math.min(1, k), headL = Math.min(width * 3.4, tip), headW = width * 2.9 * (headL / (width * 3.4)), shaft = tip - headL;
      let o = 0;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1), [x, z, tx, tz] = at(shaft * u), w = width / 2 * (0.3 + 0.7 * u * u * (3 - 2 * u));
        v[o++] = x - tz * w; v[o++] = 0.03; v[o++] = z + tx * w; v[o++] = x + tz * w; v[o++] = 0.03; v[o++] = z - tx * w;
      }
      const [bx, bz, tx, tz] = at(shaft), [ex, ez] = at(tip);
      v[o++] = bx - tz * headW / 2; v[o++] = 0.03; v[o++] = bz + tx * headW / 2; v[o++] = bx + tz * headW / 2; v[o++] = 0.03; v[o++] = bz - tx * headW / 2; v[o++] = ex; v[o++] = 0.03; v[o++] = ez;
      geo.attributes.position.needsUpdate = true; mat.opacity = show * 0.95;
    },
  };
}

// Where a point in the world falls on the stage, in CSS pixels from the stage's top left.
const _v = new THREE.Vector3();
export function project(x, y, z) { _v.set(x, y, z).project(camera); return [(_v.x * 0.5 + 0.5) * stageEl.clientWidth, (-_v.y * 0.5 + 0.5) * stageEl.clientHeight, _v.z < 1]; }
export function fit() { const w = stageEl.clientWidth, h = stageEl.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
// Keep the drawing the size of the stage, whatever changes it: the window, the layout, or a page that rearranges itself.
export function watchSize(after) { new ResizeObserver(() => { fit(); if (after) after(); }).observe(stageEl); fit(); if (after) after(); }
// Two markers drawn on the same spot hide each other. Where players are closer than a marker is wide, the drawing moves them
// apart by the least it can. The data is not changed.
export function spread(points, gap = 1.05) {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i], b = points[j]; if (!a || !b) continue;
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy); if (d >= gap) continue;
    if (d < 1e-3) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const push = (gap - d) / 2; a[0] -= dx * push; a[1] -= dy * push; b[0] += dx * push; b[1] += dy * push;
  }
  return points;
}

// Which way a player's body faces. He watches the ball. The faster he runs, the more his body has to turn the way he is going,
// and at a sprint it points there. Angles are about the vertical axis, 0 towards the camera side.
export function facing(px, py, vx, vy, bx, by) {
  const sp = Math.hypot(vx, vy), toBall = Math.atan2(bx - px, -(by - py));
  if (sp < 0.3) return toBall;
  let off = Math.atan2(vx, -vy) - toBall; off = Math.atan2(Math.sin(off), Math.cos(off));
  return toBall + off * Math.min(1, Math.max(0, (sp - 2.5) / 4.5));
}
// The crest for a club, by its short name. Clubs without one keep their colour bar.
export const CRESTS = { nor: 'northgate.svg', har: 'harbour-city.svg' };

export { renderer, scene, camera, stageEl };
