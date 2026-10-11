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
// centre circle and work outwards.
const pitchArt = (() => {
  const S = 18, M = 8, W = (105 + 2 * M) * S, H = (68 + 2 * M) * S, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), X = (x) => (x + 52.5 + M) * S, Y = (y) => (34 - y + M) * S;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  function paint(p) {
    g.setLineDash([]); g.fillStyle = '#07180F'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#12482F'; g.fillRect(X(-52.5), Y(34), 105 * S, 68 * S);
    for (let i = 0; i < 18; i += 2) { g.fillStyle = 'rgba(255, 255, 255, 0.03)'; g.fillRect(X(-52.5 + i * 105 / 18), Y(34), 105 / 18 * S, 68 * S); }   // mown bands
    g.strokeStyle = g.fillStyle = 'rgba(255, 255, 255, 0.72)'; g.lineWidth = 0.13 * S;
    // each stroke has a turn: `from` is when it starts, as a share of the whole drawing, and it takes a third of it
    const part = (from) => Math.min(1, Math.max(0, (p - from) / 0.34));
    const stroke = (from, metres, path) => { const q = part(from); if (q <= 0) return; g.setLineDash(q >= 1 ? [] : [metres * S * q, 1e6]); g.beginPath(); path(); g.stroke(); };
    const box = (from, x0, y0, x1, y1) => stroke(from, 2 * (x1 - x0 + y1 - y0), () => g.rect(X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S));
    const arc = (from, x, y, r, a0, a1) => stroke(from, r * Math.abs(a1 - a0), () => g.arc(X(x), Y(y), r * S, a0, a1));
    const spot = (from, x, y) => { const q = part(from); if (q <= 0) return; g.beginPath(); g.arc(X(x), Y(y), 0.2 * S * q, 0, 7); g.fill(); };
    arc(0, 0, 0, 9.15, -Math.PI / 2, Math.PI * 1.5); spot(0.05, 0, 0);
    stroke(0.12, 34, () => { g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(34)); }); stroke(0.12, 34, () => { g.moveTo(X(0), Y(0)); g.lineTo(X(0), Y(-34)); });
    box(0.3, -52.5, -34, 52.5, 34);
    for (const s of [-1, 1]) {
      const gx = s * 52.5;
      box(0.5, Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
      box(0.58, Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
      spot(0.62, gx - s * 11, 0);
      const a = Math.acos(5.5 / 9.15);                                          // the arc outside the area
      arc(0.64, gx - s * 11, 0, 9.15, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a);
      for (const k of [-1, 1]) {                                                // corner arcs: the quarter that lies on the pitch
        const a0 = s < 0 ? (k > 0 ? 0 : -Math.PI / 2) : (k > 0 ? Math.PI / 2 : Math.PI);
        arc(0.66, gx, k * 34, 1, a0, a0 + Math.PI / 2);
      }
    }
    t.needsUpdate = true;
  }
  paint(1);
  return { t, w: 105 + 2 * M, h: 68 + 2 * M, paint };
})();
export const drawPitch = (p) => pitchArt.paint(p);
{
  const { t, w, h } = pitchArt;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); pitch.rotation.x = -Math.PI / 2; scene.add(pitch);
  const mat = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.55 });
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
      g.beginPath(); g.arc(n / 2, n / 2, n * 0.44, 0, 7);
      if (ghost) { g.lineWidth = n * 0.05; g.strokeStyle = css(kit.line); g.setLineDash([n * 0.1, n * 0.07]); g.stroke(); } else { g.fillStyle = css(kit.shirt); g.fill(); g.lineWidth = n * 0.055; g.strokeStyle = css(kit.rim); g.stroke(); }
      g.fillStyle = css(ghost ? kit.line : kit.number); g.font = `700 ${n * 0.46}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(number), n / 2, n * 0.53);
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
  setOpacity(o) { this.k = o; this.group.visible = o > 0.004; for (const m of this.mats) m.material.opacity = m.userData.base * o; }
  // k: how far the mark has faded in. full: 0 faint, 1 lit. beat: a slow pulse for the lit ring, 0 to 1.
  setStake(k, full, beat = 1) {
    if (!this.ring) return;
    const up = k > 0.05 ? 10 : 0;                                               // a marked player is drawn over his neighbours
    if (up !== this.lifted) { this.lifted = up; this.group.traverse((o) => { if (o.isMesh) { o.userData.order ??= o.renderOrder; o.renderOrder = o.userData.order + up; } }); }
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

// A patch of pitch the system points at: a pale fill with a dashed edge.
export function makeZone() {
  const group = new THREE.Group();
  const fill = flat(new THREE.PlaneGeometry(1, 1), basic({ color: PAPER, opacity: 0 }), 0.02, 1);
  const edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: PAPER, dashSize: 1.1, gapSize: 0.9, transparent: true, opacity: 0, depthWrite: false })); edge.renderOrder = 2;
  group.add(fill, edge); scene.add(group); group.visible = false;
  return {
    set(x0, z0, x1, z1, k, dashed = true) {
      group.visible = k > 0.004; if (!group.visible) return;
      fill.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2); fill.scale.set(Math.abs(x1 - x0), Math.abs(z1 - z0), 1); fill.material.opacity = k * (dashed ? 0.08 : 0.14);
      edge.geometry.setFromPoints([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, 0.03, z))); edge.computeLineDistances();
      edge.material.opacity = dashed ? k : 0;
    },
  };
}

// An arrow lying on the pitch, drawn from its tail as `k` goes from 0 to 1.
export function makeArrow() {
  const mat = basic({ color: PAPER, opacity: 0, side: THREE.DoubleSide }), mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.renderOrder = 2; scene.add(mesh);
  return {
    set(pts, k, width = 0.45) {                                                 // pts: [[x, z], ...] along the arrow
      mesh.visible = k > 0.004; if (!mesh.visible) return;
      const n = Math.max(2, Math.round((pts.length - 1) * Math.min(1, k)) + 1), v = [], idx = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * width / 2, nz = dx / L * width / 2;
        v.push(pts[i][0] + nx, 0.03, pts[i][1] + nz, pts[i][0] - nx, 0.03, pts[i][1] - nz);
        if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
      }
      const e = pts[n - 1], p = pts[n - 2], dx = e[0] - p[0], dz = e[1] - p[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, h = width * 2.2, o = v.length / 3;
      v.push(e[0] - uz * h / 2, 0.03, e[1] + ux * h / 2, e[0] + uz * h / 2, 0.03, e[1] - ux * h / 2, e[0] + ux * h, 0.03, e[1] + uz * h); idx.push(o, o + 1, o + 2);
      mesh.geometry.dispose(); mesh.geometry = new THREE.BufferGeometry(); mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); mesh.geometry.setIndex(idx);
      mat.opacity = Math.min(1, k * 3);
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
export function spread(points, gap = 1.75) {
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
