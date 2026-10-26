// The stage both views share: a pitch seen at a broadcast tilt, a marker for each player and the ball.
// Colour appears only where it carries meaning: the green of the pitch, a colour for each team, and the yellow of a card.
// Everything the system draws on top is white.
// Importing this file builds the pitch once; mountStage puts the canvas in the page. The players' markers are in marker.ts
// and the ball and the shapes drawn on the turf in shapes.ts.
import * as THREE from 'three';

export interface Kit {
  shirt: number;
  rim: number;
  number: number;
  line: number;
  keeper: number;
}
// A point on the pitch in metres: x along the touchline, y across it.
export type Pt = [number, number];

export const KITS: [Kit, Kit] = [
  { shirt: 0xff8a3d, rim: 0x000000, number: 0x000000, line: 0xff8a3d, keeper: 0xb9b9b9 }, // home
  { shirt: 0x7fd0f5, rim: 0x000000, number: 0x000000, line: 0x7fd0f5, keeper: 0x58c492 }, // away
];
export const SIGNAL = 0xffd21f,
  INK = 0x000000,
  PAPER = 0xffffff;
export const FONT = '"Hanken Grotesk", system-ui, sans-serif';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// The element the canvas lives in, set once by mountStage.
let stageEl: HTMLElement = document.createElement('div');
export function mountStage(host: HTMLElement) {
  stageEl = host;
  host.appendChild(renderer.domElement);
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07180f);
const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 700);

// ---------- the pitch: 105 by 68 m, markings to the laws of the game ----------
// The markings can be drawn on stroke by stroke: drawPitch(0) is bare turf, drawPitch(1) the finished pitch. They start at the
// centre circle and work outwards. Nothing is repainted while that happens. Three pictures are made once: the turf, the
// finished lines, and a map of when each bit of line appears (darker is sooner). The pitch's shader shows a bit of line once
// the drawing has reached its time, so moving the drawing on costs one number a frame.
let goalsShow: (k: number) => void = () => {};
const pitchArt = (() => {
  const S = 18,
    M = 8,
    W = (105 + 2 * M) * S,
    H = (68 + 2 * M) * S,
    X = (x: number) => (x + 52.5 + M) * S,
    Y = (y: number) => (34 - y + M) * S,
    TAKES = 0.34;
  const sheet = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return [c, c.getContext('2d')!];
  };
  const [turfC, tg] = sheet(),
    [lineC, lg] = sheet(),
    [whenC, wg] = sheet();
  tg.fillStyle = '#07180F';
  tg.fillRect(0, 0, W, H);
  tg.fillStyle = '#12482F';
  tg.fillRect(X(-52.5), Y(34), 105 * S, 68 * S);
  for (let i = 0; i < 18; i += 2) {
    tg.fillStyle = 'rgba(255, 255, 255, 0.03)';
    tg.fillRect(X(-52.5 + (i * 105) / 18), Y(34), (105 / 18) * S, 68 * S);
  } // mown bands
  wg.fillStyle = '#000';
  wg.fillRect(0, 0, W, H);
  // every stroke has a turn: `from` is when it starts, as a share of the whole drawing, and it takes a third of it
  type Path = (g: CanvasRenderingContext2D) => void;
  const strokes: { from: number; metres: number; path: Path }[] = [],
    spots: { from: number; x: number; y: number }[] = [];
  const stroke = (from: number, metres: number, path: Path) => strokes.push({ from, metres, path });
  const box = (from: number, x0: number, y0: number, x1: number, y1: number) =>
    stroke(from, 2 * (x1 - x0 + y1 - y0), (g) => g.rect(X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S));
  const arc = (from: number, x: number, y: number, r: number, a0: number, a1: number) =>
    stroke(from, r * Math.abs(a1 - a0), (g) => g.arc(X(x), Y(y), r * S, a0, a1));
  const spot = (from: number, x: number, y: number) => spots.push({ from, x, y });
  arc(0, 0, 0, 9.15, -Math.PI / 2, Math.PI * 1.5);
  spot(0.05, 0, 0);
  stroke(0.12, 34, (g) => {
    g.moveTo(X(0), Y(0));
    g.lineTo(X(0), Y(34));
  });
  stroke(0.12, 34, (g) => {
    g.moveTo(X(0), Y(0));
    g.lineTo(X(0), Y(-34));
  });
  box(0.3, -52.5, -34, 52.5, 34);
  for (const s of [-1, 1]) {
    const gx = s * 52.5;
    box(0.5, Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
    box(0.58, Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
    spot(0.62, gx - s * 11, 0);
    const a = Math.acos(5.5 / 9.15); // the arc outside the area
    arc(0.64, gx - s * 11, 0, 9.15, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a);
    for (const k of [-1, 1]) {
      // corner arcs: the quarter that lies on the pitch
      const a0 = s < 0 ? (k > 0 ? 0 : -Math.PI / 2) : k > 0 ? Math.PI / 2 : Math.PI;
      arc(0.66, gx, k * 34, 1, a0, a0 + Math.PI / 2);
    }
  }
  lg.strokeStyle = lg.fillStyle = '#fff';
  lg.lineWidth = 0.13 * S;
  for (const st of strokes) {
    lg.beginPath();
    st.path(lg);
    lg.stroke();
  }
  for (const sp of spots) {
    lg.beginPath();
    lg.arc(X(sp.x), Y(sp.y), 0.2 * S, 0, 7);
    lg.fill();
  }
  // the map of when: each stroke laid down again and again, shorter and darker each time, so its start is soonest. It is
  // drawn wider than the line so the line's soft edge never reads a wrong time, and the latest strokes go down first so that
  // where two meet the sooner one wins.
  const grey = (time: number) => {
      const v = Math.round(Math.min(1, time) * 255);
      return `rgb(${v},${v},${v})`;
    },
    STEPS = 56;
  wg.lineWidth = 0.13 * S * 4;
  for (const st of [...strokes].sort((p, q) => q.from - p.from))
    for (let j = STEPS; j >= 1; j--) {
      wg.strokeStyle = grey(st.from + (TAKES * j) / STEPS);
      wg.setLineDash(j === STEPS ? [] : [(st.metres * S * j) / STEPS, 1e6]);
      wg.beginPath();
      st.path(wg);
      wg.stroke();
    }
  wg.setLineDash([]);
  for (const sp of spots)
    for (let j = 8; j >= 1; j--) {
      wg.fillStyle = grey(sp.from + (TAKES * j) / 8);
      wg.beginPath();
      wg.arc(X(sp.x), Y(sp.y), 0.2 * S * (0.6 + (j / 8) * 1.6), 0, 7);
      wg.fill();
    }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      turf: { value: tex(turfC) },
      lines: { value: tex(lineC) },
      when: { value: tex(whenC) },
      p: { value: 1 },
    },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform sampler2D turf, lines, when; uniform float p; varying vec2 vUv; void main() { vec3 c = texture2D(turf, vUv).rgb; float t = texture2D(when, vUv).r; float on = smoothstep(t - 0.008, t, p); gl_FragColor = vec4(mix(c, vec3(1.0), texture2D(lines, vUv).a * 0.72 * on), 1.0); }',
  });
  return {
    material,
    w: 105 + 2 * M,
    h: 68 + 2 * M,
    paint(p: number) {
      material.uniforms.p!.value = p;
      goalsShow(Math.min(1, Math.max(0, (p - 0.62) / TAKES)));
    },
  };
})();
export const drawPitch = (p: number) => pitchArt.paint(p);
{
  const { material, w, h } = pitchArt;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  pitch.rotation.x = -Math.PI / 2;
  scene.add(pitch);
  const mat = new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.55 });
  goalsShow = (k) => {
    mat.opacity = 0.55 * k;
  }; // the goals come up with the lines round them
  for (const s of [-1, 1]) {
    // goals: 7.32 m wide, 2.44 m high
    const x = s * 52.5,
      d = s * 2,
      P = (a: number, y: number, z: number) => new THREE.Vector3(a, y, z),
      z = 3.66,
      top = 2.44;
    const pts = [
      P(x, 0, -z),
      P(x, top, -z),
      P(x, top, -z),
      P(x, top, z),
      P(x, top, z),
      P(x, 0, z),
      P(x, top, -z),
      P(x + d, 0, -z),
      P(x, top, z),
      P(x + d, 0, z),
      P(x + d, 0, -z),
      P(x + d, 0, z),
    ];
    const goal = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat);
    scene.add(goal);
  }
}

// ---------- drawing helpers the marker and the shapes share ----------
export const basic = (o: THREE.MeshBasicMaterialParameters) =>
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o });
export const flat = <M extends THREE.Material>(geo: THREE.BufferGeometry, mat: M, y: number, order: number) => {
  const m = new THREE.Mesh<THREE.BufferGeometry, M>(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = order;
  return m;
};

// Where a point in the world falls on the stage, in CSS pixels from the stage's top left.
const _v = new THREE.Vector3();
export function project(x: number, y: number, z: number): [number, number, boolean] {
  _v.set(x, y, z).project(camera);
  return [(_v.x * 0.5 + 0.5) * stageEl.clientWidth, (-_v.y * 0.5 + 0.5) * stageEl.clientHeight, _v.z < 1];
}
function fit() {
  const w = stageEl.clientWidth,
    h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
// Keep the drawing the size of the stage, whatever changes it: the window, the layout, or a page that rearranges itself.
export function watchSize(after?: () => void) {
  new ResizeObserver(() => {
    fit();
    if (after) after();
  }).observe(stageEl);
  fit();
  if (after) after();
}
// Two markers drawn on the same spot hide each other. Where players are closer than a marker is wide, the drawing moves them
// apart by the least it can. The data is not changed.
export function spread(points: (Pt | null)[], gap = 1.05) {
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i],
        b = points[j];
      if (!a || !b) continue;
      let dx = b[0] - a[0],
        dy = b[1] - a[1];
      const d = Math.hypot(dx, dy);
      if (d >= gap) continue;
      if (d < 1e-3) {
        dx = 1;
        dy = 0;
      } else {
        dx /= d;
        dy /= d;
      }
      const push = (gap - d) / 2;
      a[0] -= dx * push;
      a[1] -= dy * push;
      b[0] += dx * push;
      b[1] += dy * push;
    }
  return points;
}

// Which way a player's body faces. He watches the ball. The faster he runs, the more his body has to turn the way he is going,
// and at a sprint it points there. Angles are about the vertical axis, 0 towards the camera side.
export function facing(px: number, py: number, vx: number, vy: number, bx: number, by: number) {
  const sp = Math.hypot(vx, vy),
    toBall = Math.atan2(bx - px, -(by - py));
  if (sp < 0.3) return toBall;
  let off = Math.atan2(vx, -vy) - toBall;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  return toBall + off * Math.min(1, Math.max(0, (sp - 2.5) / 4.5));
}
// The crest for a club, by its short name. Clubs without one keep their colour bar.
const CRESTS: Record<string, string> = { nor: 'northgate.svg', har: 'harbour-city.svg' };
// The address of a club's crest, or null for a club without one.
export const crestUrl = (short: string) => {
  const f = CRESTS[short.toLowerCase()];
  return f ? `/brand/${f}` : null;
};

export { renderer, scene, camera, stageEl };
