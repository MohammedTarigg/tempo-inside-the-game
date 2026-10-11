// The stage both views share: a dark pitch seen at a broadcast tilt, a marker for each player and a lit ball.
// A marker shows only what the tracking feed knows: where he is, which way he is going and how fast.
// Importing this file builds the pitch once and puts the canvas in the page's #stage element.
import * as THREE from 'three';

export const KITS = [
  { shirt: 0xF27A2C, trim: 0x18263A, keeper: 0x8A8F9E },   // home
  { shirt: 0x6FBCEB, trim: 0x1F3A5F, keeper: 0x4FC08A },   // away
];
export const CARD = 0xFFD21F;
const LINE = 'rgba(176, 240, 228, 0.9)', BACK = 0x05121A;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(BACK);
const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 700);
scene.add(new THREE.AmbientLight(0xffffff, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(10, 60, 40); scene.add(sun);

// ---------- the pitch: 105 by 68 m, markings to the laws of the game ----------
function pitchTexture() {
  const S = 18, M = 7, W = (105 + 2 * M) * S, H = (68 + 2 * M) * S, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), X = (x) => (x + 52.5 + M) * S, Y = (y) => (34 - y + M) * S;
  g.fillStyle = '#05121A'; g.fillRect(0, 0, W, H);
  const turf = g.createLinearGradient(X(-52.5), 0, X(52.5), 0);
  turf.addColorStop(0, '#07262B'); turf.addColorStop(0.5, '#0B3A35'); turf.addColorStop(1, '#07262B');
  g.fillStyle = turf; g.fillRect(X(-52.5), Y(34), 105 * S, 68 * S);
  for (let i = 0; i < 18; i += 2) { g.fillStyle = 'rgba(190, 255, 235, 0.035)'; g.fillRect(X(-52.5 + i * 105 / 18), Y(34), 105 / 18 * S, 68 * S); }   // mown bands
  const edge = g.createRadialGradient(W / 2, H / 2, 20 * S, W / 2, H / 2, 70 * S);
  edge.addColorStop(0, 'rgba(5,18,26,0)'); edge.addColorStop(1, 'rgba(5,18,26,0.55)'); g.fillStyle = edge; g.fillRect(0, 0, W, H);
  g.strokeStyle = LINE; g.fillStyle = LINE; g.lineWidth = 0.12 * S; g.shadowColor = 'rgba(120, 235, 220, 0.8)'; g.shadowBlur = 7;
  const box = (x0, y0, x1, y1) => g.strokeRect(X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S);
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(X(x), Y(y), r * S, a0, a1); g.stroke(); };
  const spot = (x, y) => { g.beginPath(); g.arc(X(x), Y(y), 0.2 * S, 0, 7); g.fill(); };
  box(-52.5, -34, 52.5, 34);
  g.beginPath(); g.moveTo(X(0), Y(34)); g.lineTo(X(0), Y(-34)); g.stroke();
  arc(0, 0, 9.15, 0, 7); spot(0, 0);
  for (const s of [-1, 1]) {
    const gx = s * 52.5;
    box(Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
    box(Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
    spot(gx - s * 11, 0);
    const a = Math.acos(5.5 / 9.15);                                            // the arc outside the area
    arc(gx - s * 11, 0, 9.15, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a);
    for (const t of [-1, 1]) arc(gx, t * 34, 1, 0, 7);
  }
  // the corner arcs were drawn as whole circles: wipe what falls outside the pitch
  g.shadowBlur = 0; g.fillStyle = '#05121A';
  g.fillRect(0, 0, W, Y(34) - 0.1 * S); g.fillRect(0, Y(-34) + 0.1 * S, W, H); g.fillRect(0, 0, X(-52.5) - 0.1 * S, H); g.fillRect(X(52.5) + 0.1 * S, 0, W, H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { t, w: 105 + 2 * M, h: 68 + 2 * M };
}
{
  const { t, w, h } = pitchTexture();
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); pitch.rotation.x = -Math.PI / 2; scene.add(pitch);
  const mat = new THREE.LineBasicMaterial({ color: 0xB0F0E4, transparent: true, opacity: 0.75 });
  for (const s of [-1, 1]) {                                                    // goals: 7.32 m wide, 2.44 m high
    const x = s * 52.5, d = s * 2, P = (a, y, z) => new THREE.Vector3(a, y, z), z = 3.66, top = 2.44;
    const pts = [P(x, 0, -z), P(x, top, -z), P(x, top, -z), P(x, top, z), P(x, top, z), P(x, 0, z), P(x, top, -z), P(x + d, 0, -z), P(x, top, z), P(x + d, 0, z), P(x + d, 0, -z), P(x + d, 0, z)];
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
}

// ---------- textures the markers share ----------
function canvasTexture(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const GLOW = canvasTexture(128, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.35, 'rgba(255,255,255,0.28)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, n, n); });
const STREAK = canvasTexture(64, (g, n) => { const r = g.createLinearGradient(0, 0, 0, n); r.addColorStop(0, 'rgba(255,255,255,0.75)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, n, n); });
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const flat = (geo, mat, y, order) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = order; return m; };
const R = 0.85;                                                                 // a marker is a symbol, drawn larger than the man so his number reads

// One player. `group` sits at his position and never turns, so the number stays upright; `turn` carries what points his way.
export class Marker {
  constructor({ number, kit, ghost = false }) {
    this.ghost = ghost; this.yaw = 0; this.group = new THREE.Group(); this.turn = new THREE.Group(); this.group.add(this.turn);
    const col = css(kit.shirt), dark = new THREE.Color(kit.shirt).getHSL({}).l < 0.45;
    const face = canvasTexture(128, (g, n) => {
      g.lineWidth = n * 0.07; g.strokeStyle = ghost ? col : 'rgba(255,255,255,0.92)';
      g.beginPath(); g.arc(n / 2, n / 2, n * 0.44, 0, 7);
      if (!ghost) { g.fillStyle = col; g.fill(); }
      g.stroke();
      g.fillStyle = ghost ? col : dark ? '#F3F1E7' : '#06150F'; g.font = `700 ${n * 0.5}px "Barlow Condensed", Barlow, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(number), n / 2, n * 0.54);
    });
    const basic = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o });
    this.mats = [];
    const add = (mesh, parent, base) => { mesh.userData.base = base; this.mats.push(mesh); parent.add(mesh); return mesh; };
    if (!ghost) add(flat(new THREE.PlaneGeometry(R * 5, R * 5), basic({ map: GLOW, color: kit.shirt, blending: THREE.AdditiveBlending, opacity: 0.5 }), 0.02, 1), this.group, 0.5);
    add(flat(new THREE.PlaneGeometry(R * 2.2, R * 2.2), basic({ map: face }), 0.06, 3), this.group, 1);
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.3, 0, R + 0.12), new THREE.Vector3(0.3, 0, R + 0.12), new THREE.Vector3(0, 0, R + 0.62)]); tri.setIndex([0, 1, 2]);
    const wedge = new THREE.Mesh(tri, basic({ color: ghost ? kit.shirt : 0xF3F1E7, side: THREE.DoubleSide })); wedge.position.y = 0.05; wedge.renderOrder = 3; add(wedge, this.turn, 1);
    this.trail = flat(new THREE.PlaneGeometry(R * 1.5, 1), basic({ map: STREAK, color: kit.shirt, opacity: 0 }), 0.03, 2); this.turn.add(this.trail);
    if (!ghost) {                                                               // the stake: a yellow ring round him, faint then lit
      this.ring = flat(new THREE.RingGeometry(R + 0.16, R + 0.34, 48), basic({ color: CARD, opacity: 0, side: THREE.DoubleSide }), 0.04, 2); this.group.add(this.ring);
      this.halo = flat(new THREE.PlaneGeometry(R * 7, R * 7), basic({ map: GLOW, color: CARD, blending: THREE.AdditiveBlending, opacity: 0 }), 0.025, 1); this.group.add(this.halo);
    }
    this.k = 1;
  }
  update(dt, speed, rate) {                                                     // a streak behind him once he is sprinting
    const len = Math.max(0, speed - 5.2) * 1.1, on = this.ghost || !rate ? 0 : Math.min(1, len / 1.5) * 0.55 * this.k;
    this.trail.material.opacity += (on - this.trail.material.opacity) * Math.min(1, dt * 8 + (rate ? 0 : 1));
    const L = Math.max(0.2, len); this.trail.scale.set(1, L, 1); this.trail.position.z = -(R + L / 2);
  }
  setOpacity(o) { this.k = o; this.group.visible = o > 0.004; for (const m of this.mats) m.material.opacity = m.userData.base * o; }
  setStake(k, full) { if (!this.ring) return; this.ring.material.opacity = k * (0.45 + 0.55 * full); this.halo.material.opacity = k * 0.75 * full; }
}

// The ball: lit, with a mark on the turf beneath it so its height reads.
export function makeBall(opacity = 1) {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xFFFFFF, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 * opacity })); glow.scale.setScalar(1.7);
  const mark = flat(new THREE.CircleGeometry(0.26, 24), new THREE.MeshBasicMaterial({ color: 0x02080C, transparent: true, depthWrite: false, opacity: 0.55 * opacity }), 0.07, 4);
  ball.renderOrder = 5; glow.renderOrder = 5; group.add(mark, ball, glow);
  return {
    group,
    set(x, h, z) { group.position.set(x, 0, z); ball.position.y = glow.position.y = Math.max(h, 0.11) + 0.13; mark.scale.setScalar(1 + Math.min(h, 8) * 0.12); },
    setOpacity(o) { ball.material.opacity = o; glow.material.opacity = 0.8 * o; mark.material.opacity = 0.55 * o; group.visible = o > 0.004; },
  };
}

// A ring that opens where someone plays or wins the ball. The views say where and how old; nothing is remembered here.
export function makePulses(n = 6) {
  const rings = Array.from({ length: n }, () => { const m = flat(new THREE.RingGeometry(0.9, 1.0, 40), new THREE.MeshBasicMaterial({ color: 0xF3F1E7, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide }), 0.035, 2); scene.add(m); return m; });
  return (list) => rings.forEach((m, i) => {
    const p = list[i]; if (!p) { m.material.opacity = 0; return; }
    const u = Math.min(1, p.age / 0.45); m.position.set(p.x, 0.035, p.z); m.scale.setScalar(1 + u * (p.strong ? 2.2 : 1.1)); m.material.opacity = (1 - u) * (p.strong ? 0.9 : 0.5);
  });
}

export { renderer, scene, camera };
