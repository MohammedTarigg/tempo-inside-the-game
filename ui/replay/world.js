// The world both views share: the renderer, the pitch, the stands, the goals and the floodlights.
// Importing this file builds it once and puts the canvas in the page's #stage element.
import * as THREE from 'three';

export const KITS = [
  { shirt: 0xF27A2C, shorts: 0x18263A, socks: 0xF27A2C, trim: 0x18263A, keeper: 0x3A3A46 },   // home
  { shirt: 0x6FBCEB, shorts: 0xF1EFE6, socks: 0x6FBCEB, trim: 0x1F3A5F, keeper: 0x2F8A57 },   // away
];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0B1220);                                   // evening sky above the stands
scene.fog = new THREE.Fog(0x0B1220, 190, 420);
const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 700);

// ---------- turf ----------
// A seeded generator, so the pitch is the same on every load.
function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// What the groundsman paints and what the players wear away: lines, worn goalmouths, the centre spot. The grass itself is drawn
// by the shader below, so it stays sharp at any distance.
function markingsTexture() {
  const S = 24, W = 105 * S, H = 68 * S, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), r = rand(7), m = (x) => x * S, cx = W / 2, cy = H / 2;
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);                                 // mid grey means "plain grass" to the shader
  const wear = (x, y, rx, ry, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rx); gr.addColorStop(0, `rgba(96,96,96,${a})`); gr.addColorStop(1, 'rgba(96,96,96,0)'); g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y); g.fillStyle = gr; g.fillRect(x - rx, y - rx, rx * 2, rx * 2); g.restore(); };
  wear(m(4), cy, m(8), m(6), 0.55); wear(W - m(4), cy, m(8), m(6), 0.55); wear(cx, cy, m(7), m(7), 0.25);
  for (let i = 0; i < 90; i++) wear(r() * W, r() * H, m(1 + r() * 3), m(1 + r() * 3), 0.10 + r() * 0.12);
  const line = (draw) => { for (const [w, a] of [[0.30, 0.20], [0.13, 0.96]]) { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = m(w); g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); draw(); g.stroke(); } };
  const e = m(0.5);
  line(() => g.rect(e, e, W - 2 * e, H - 2 * e));
  line(() => { g.moveTo(cx, e); g.lineTo(cx, H - e); });
  line(() => g.arc(cx, cy, m(9.15), 0, Math.PI * 2));
  for (const s of [0, 1]) {
    const x0 = s ? W - e : e, d = s ? -1 : 1;
    line(() => g.rect(Math.min(x0, x0 + d * m(16.5)), cy - m(20.16), m(16.5), m(40.32)));
    line(() => g.rect(Math.min(x0, x0 + d * m(5.5)), cy - m(9.16), m(5.5), m(18.32)));
    line(() => g.arc(x0 + d * m(11), cy, m(9.15), s ? Math.PI * 0.705 : -Math.PI * 0.295, s ? Math.PI * 1.295 : Math.PI * 0.295));
    g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(x0 + d * m(11), cy, m(0.2), 0, 7); g.fill();
    for (const yy of [e, H - e]) line(() => g.arc(x0, yy, m(1), 0, Math.PI * 2));
  }
  g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(cx, cy, m(0.22), 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.anisotropy = 16; t.generateMipmaps = true;
  return t;
}
// Grass, drawn per pixel: mown bands whose light and dark sides swap with the viewing angle (as real stripes do, because the
// blades lean one way or the other), patchy growth, and blade grain that fades with distance instead of shimmering.
function grassMaterial(markings, tone) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMarks = { value: markings }; sh.uniforms.uTone = { value: tone };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWorld; uniform sampler2D uMarks; uniform float uTone;
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 wp = vWorld.xz; float dist = length(cameraPosition - vWorld);
      vec3 toEye = normalize(cameraPosition - vWorld);
      float inside = step(abs(wp.x), 52.5) * step(abs(wp.y), 34.0);
      // mowing: bands 5.83 m wide along the pitch, crossed by bands across it. Each band's blades lean one way.
      float along = floor((wp.x + 52.5) / 5.8333), across = floor((wp.y + 34.0) / 5.6667);
      float leanX = mod(along, 2.0) * 2.0 - 1.0, leanZ = mod(across, 2.0) * 2.0 - 1.0;
      float sheen = (leanX * toEye.x * 0.62 + leanZ * toEye.z * 0.30) * inside;
      float ex = abs(fract((wp.x + 52.5) / 5.8333) - 0.5), ez = abs(fract((wp.y + 34.0) / 5.6667) - 0.5);
      sheen *= smoothstep(0.5, 0.485, ex) * 0.85 + 0.15; sheen *= smoothstep(0.5, 0.47, ez) * 0.4 + 0.6;
      float patchy = fbm(wp * 0.13) - 0.5, clump = fbm(wp * 1.7) - 0.5;
      float nearK = smoothstep(55.0, 6.0, dist), closeK = smoothstep(16.0, 2.5, dist);
      float blades = (vn(wp * vec2(38.0, 9.0) + vn(wp * 3.0) * 4.0) - 0.5) * nearK + (vn(wp * vec2(160.0, 44.0)) - 0.5) * closeK;
      vec3 deep = vec3(0.052, 0.185, 0.050), fresh = vec3(0.150, 0.385, 0.085), dry = vec3(0.330, 0.340, 0.130);
      float g = clamp(0.52 + sheen * 0.42 + patchy * 0.50 + clump * 0.22 + blades * 0.30, 0.0, 1.0);
      vec3 grass = mix(deep, fresh, g);
      vec4 mk = texture2D(uMarks, (wp + vec2(52.5, 34.0)) / vec2(105.0, 68.0));
      float worn = clamp((0.502 - mk.r) * 7.0, 0.0, 1.0) * inside;
      grass = mix(grass, mix(dry, grass, 0.45 + blades * 0.5), worn * 0.75);
      float paint = clamp((mk.r - 0.55) * 2.4, 0.0, 1.0) * inside;
      paint *= 0.80 + blades * 0.9 + clump * 0.35;                                  // paint sits on the blades, so it is never a flat white
      diffuseColor.rgb = mix(grass * uTone, vec3(0.90, 0.91, 0.86), clamp(paint, 0.0, 1.0));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(0.86 - sheen * 0.10 + blades * 0.10, 0.6, 1.0);`);
  };
  return mat;
}
const markings = markingsTexture();
const turf = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), grassMaterial(markings, 1.0));
turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true; scene.add(turf);
const apron = new THREE.Mesh(new THREE.PlaneGeometry(126, 82), grassMaterial(markings, 0.86));
apron.rotation.x = -Math.PI / 2; apron.position.y = -0.015; apron.receiveShadow = true; scene.add(apron);

// ---------- the ground around the pitch ----------
// A bowl of stands with a crowd, perimeter boards in plain colours (no brands), and four floodlights.
function crowdTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'), r = rand(31);
  g.fillStyle = '#0D1318'; g.fillRect(0, 0, 512, 256);
  const tones = ['#C9B8A6', '#8E6F58', '#D8D2C8', '#F27A2C', '#6FBCEB', '#2B3A4A', '#B33A3A', '#E9D36C', '#5B6470', '#F1EFE6'];
  for (let row = 0; row < 40; row++) for (let col = 0; col < 128; col++) {
    if (r() < 0.12) continue;
    const x = col * 4 + (row % 2) * 2 + r() * 1.2, y = row * 6.4 + 1;
    g.fillStyle = tones[(r() * tones.length) | 0]; g.globalAlpha = 0.55 + r() * 0.4; g.fillRect(x, y + 2.2, 2.8, 3.2);
    g.fillStyle = ['#E8C7A6', '#B98459', '#8E5E3B', '#D9A67C'][(r() * 4) | 0]; g.fillRect(x + 0.5, y, 1.8, 2.0);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
const crowd = crowdTexture();
// One stand, built to a measured cross-section: a low front wall, a single rake of seats, a back wall, and a roof that
// reaches forward over the seats with a strip of lights along its front edge.
// front: metres from the pitch centre to the first row. depth and rise: the run and height of the seating. roof: [front height, back height].
function stand(len, front, depth, rise, roof, wallTop, ry) {
  const pivot = new THREE.Group(); pivot.rotation.y = ry; scene.add(pivot);
  const slope = Math.hypot(depth, rise - 1.6), tex = crowd.clone(); tex.needsUpdate = true; tex.repeat.set(len / 24, slope / 14);
  const seats = new THREE.Mesh(new THREE.PlaneGeometry(len, slope), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: 0xC4C8CE }));
  seats.rotation.x = -(Math.PI / 2 - Math.atan2(rise - 1.6, depth)); seats.position.set(0, (rise + 1.6) / 2, -(front + depth / 2)); pivot.add(seats);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2A323C, roughness: 0.95 }), dark = new THREE.MeshStandardMaterial({ color: 0x141A21, roughness: 0.9 });
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); pivot.add(b); return b; };
  box(len, 1.6, 0.5, 0, 0.8, -front, concrete);                                             // front wall
  box(len, wallTop - rise, 1.2, 0, (wallTop + rise) / 2, -(front + depth + 0.6), dark);      // back wall, up to the roof
  box(len, rise, 0.6, 0, rise / 2, -(front + depth + 4.5), concrete);                       // the outside face
  const run = depth + 3, roofMesh = box(len, 0.7, run, 0, (roof[0] + roof[1]) / 2, -(front + 1 + run / 2), new THREE.MeshStandardMaterial({ color: 0x1B222B, roughness: 0.7, metalness: 0.2 }));
  roofMesh.rotation.x = -Math.atan2(roof[1] - roof[0], run);
  const strip = box(len * 0.94, 0.35, 0.5, 0, roof[0] - 0.45, -(front + 1.4), new THREE.MeshBasicMaterial({ color: 0xFFF4DC, fog: false }));
  strip.userData.light = true;
  for (let k = -3; k <= 3; k++) box(0.5, 0.5, run, k * (len / 7), (roof[0] + roof[1]) / 2 - 0.6, -(front + 1 + run / 2), dark).rotation.x = roofMesh.rotation.x;   // roof beams
}
stand(168, 40, 40, 20, [25, 27], 28, 0); stand(168, 40, 40, 20, [25, 27], 28, Math.PI);
stand(132, 62, 30, 16, [23.5, 24.5], 27, Math.PI / 2); stand(132, 62, 30, 16, [23.5, 24.5], 27, -Math.PI / 2);
const boardTones = [0x1F3A5F, 0x0F4C3A, 0x5A2A2A, 0x2B2F36, 0x4A3B12];
for (let i = 0; i < 16; i++) for (const zs of [-1, 1]) {
  const tone = boardTones[(i + (zs > 0 ? 2 : 0)) % 5];
  const b = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.95, 0.12), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, emissive: tone, emissiveIntensity: 0.4 }));
  b.position.set(-49.5 + i * 6.6, 0.48, zs * 37.4); scene.add(b);
}
for (let i = 0; i < 10; i++) for (const xs of [-1, 1]) {
  const tone = boardTones[(i + 1) % 5];
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 6.4), new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, emissive: tone, emissiveIntensity: 0.4 }));
  b.position.set(xs * 58.2, 0.48, -29.7 + i * 6.6); scene.add(b);
}
// goals: posts, bar and a net
for (const s of [-1, 1]) {
  const goal = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xF4F3EA, roughness: 0.5 });
  const tube = (ax, len, x, y, z) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 12), white); if (ax === 'z') t.rotation.x = Math.PI / 2; if (ax === 'x') t.rotation.z = Math.PI / 2; t.position.set(x, y, z); t.castShadow = true; goal.add(t); };
  tube('y', 2.44, 0, 1.22, -3.66); tube('y', 2.44, 0, 1.22, 3.66); tube('z', 7.44, 0, 2.44, 0);
  const nc = document.createElement('canvas'); nc.width = nc.height = 64; const ng = nc.getContext('2d');
  ng.strokeStyle = 'rgba(244,243,234,.75)'; ng.lineWidth = 2; ng.strokeRect(0, 0, 64, 64);
  const nt = new THREE.CanvasTexture(nc); nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
  const net = (w, h, rx, ry, x, y, z, u, v) => { const t = nt.clone(); t.needsUpdate = true; t.repeat.set(u, v); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false })); p.rotation.set(rx, ry, 0); p.position.set(x, y, z); goal.add(p); };
  net(7.32, 2.44, 0, Math.PI / 2, 1.9, 1.22, 0, 30, 10); net(1.9, 2.44, 0, 0, 0.95, 1.22, -3.66, 8, 10); net(1.9, 2.44, 0, 0, 0.95, 1.22, 3.66, 8, 10); net(1.9, 7.32, Math.PI / 2, 0, 0.95, 2.44, 0, 8, 30);
  goal.position.x = s * 52.5; goal.scale.x = s; scene.add(goal);
}
// floodlit evening: a cool sky fill and light from the roof edges, modelled as four lamps. Two cast shadows, which gives each
// player the doubled shadow you see under stadium lights.
scene.add(new THREE.HemisphereLight(0xB9D0E6, 0x1E3A22, 0.55));
const lamps = [[-48, 26, 41, 1.55, true], [48, 26, 41, 1.25, true], [-48, 26, -41, 0.6, false], [48, 26, -41, 0.6, false]];
for (const [x, y, z, power, shadow] of lamps) {
  const l = new THREE.DirectionalLight(0xFFF6E6, power); l.position.set(x, y, z); l.castShadow = shadow;
  if (shadow) { l.shadow.mapSize.set(4096, 4096); Object.assign(l.shadow.camera, { left: -70, right: 70, top: 48, bottom: -48, near: 10, far: 200 }); l.shadow.bias = -0.0003; l.shadow.normalBias = 0.02; l.shadow.radius = 3; }
  scene.add(l);
}

export { renderer, scene, camera };
