// Tempo replay: the closest earlier attempt, laid over the goal, on the same dark pitch as the live view.
// Everything on screen comes from runs/<match>/scenes.json, which the pipeline writes. Nothing here invents a number.
// Solid markers are the goal. Outlined markers are the earlier attempt.
import * as THREE from 'three';
import { renderer, scene, camera, KITS, Marker, makeBall, makePulses, facing, CRESTS, FONT } from '../stage.js';

const Q = new URLSearchParams(location.search);
const RUN = Q.get('run') || 'm_demo', FIXED_T = Q.get('t'), FROM = Q.get('from');      // ?t= opens paused at a moment, ?from= starts playing from one
if (Q.get('bare')) document.documentElement.classList.add('bare');                       // no controls or caption, for showing inside the product film
const $ = (id) => document.getElementById(id);
const fail = (m) => { $('err').style.display = 'flex'; $('err').textContent = m; };

// ---------- reading a clip ----------
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const sat = (t) => Math.min(1, Math.max(0, t));
function sample(clip, f, i) {                       // player i at fractional frame f: position in metres, or null if he is off the pitch
  const n = clip.pos.length - 1, a = Math.min(n, Math.max(0, Math.floor(f))), b = Math.min(n, a + 1), t = Math.min(1, Math.max(0, f - a));
  const p = clip.pos[a][i], q = clip.pos[b][i];
  if (!p || !q || p[0] === null || q[0] === null) return null;
  return [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
}
function sampleBall(clip, f) {
  const n = clip.ball.length - 1, a = Math.min(n, Math.max(0, Math.floor(f))), b = Math.min(n, a + 1), t = Math.min(1, Math.max(0, f - a));
  return [lerp(clip.ball[a][0], clip.ball[b][0], t), lerp(clip.ball[a][1], clip.ball[b][1], t), lerp(clip.ball[a][2], clip.ball[b][2], t)];
}
function place(fig, clip, f, i, dt, rate) {
  const p = sample(clip, f, i);
  if (!p) { fig.group.visible = false; return null; }
  if (!fig.ghost) fig.group.visible = true;
  const a = sample(clip, f - 3, i) || p, b = sample(clip, f + 3, i) || p;
  const vx = (b[0] - a[0]) * 25 / 6, vy = (b[1] - a[1]) * 25 / 6, sp = Math.hypot(vx, vy);
  fig.group.position.set(p[0], 0, -p[1]);
  const bl = sampleBall(clip, f);                     // he watches the ball; his streak shows where he is running
  let d = facing(p[0], p[1], vx, vy, bl[0], bl[1]) - fig.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); fig.yaw += d * (rate ? 0.2 : 1);
  if (sp > 0.5) fig.motion.rotation.y = Math.atan2(vx, -vy);
  fig.turn.rotation.y = fig.yaw;
  fig.update(dt, sp, rate);
  return p;
}

// ---------- the show ----------
async function main() {
  await Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.load(`600 20px ${FONT}`)]).catch(() => {});      // the numbers on the markers are drawn once, so the face must be in
  const scenes = await fetch(`../../runs/${RUN}/scenes.json`).then((r) => { if (!r.ok) throw new Error('run'); return r.json(); }).catch(() => null);
  if (!scenes) return fail('Could not load the run. Run python3 -m tempo.run_match, then serve the project folder.');
  if (!scenes.length) return fail('This run has no replay scene: no goal had a close enough earlier attempt.');
  const S = scenes[0], G = S.clips.goal, E = S.clips.earlier, N = S.ids.length;
  const who = S.ids.indexOf(S.differing_player), scorer = S.ids.indexOf(S.scorer), nm = (i) => S.names[S.ids[i]];
  $('sh').textContent = S.home; $('sa').textContent = S.away;
  for (const [id, short] of [['hc', S.home], ['ac', S.away]]) { const f = CRESTS[short.toLowerCase()]; if (f) { $(id).src = `../brand/${f}`; $(id).hidden = false; $(id).previousElementSibling.hidden = true; } }

  const live = [], ghosts = [];
  for (let i = 0; i < N; i++) {
    const team = S.team[i], kit = { ...KITS[team] };
    if (S.numbers[i] === 1) kit.shirt = kit.keeper;
    live.push(new Marker({ number: S.numbers[i], kit })); scene.add(live[i].group);
    ghosts.push(new Marker({ number: S.numbers[i], kit, ghost: true })); scene.add(ghosts[i].group);
  }
  const ball = makeBall(), ghostBall = makeBall(0), pulses = makePulses(); scene.add(ball.group, ghostBall.group);

  // the measured gap between where he stood then and where he stands now
  const gapGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const gapLine = new THREE.Line(gapGeo, new THREE.LineBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthTest: false })); gapLine.renderOrder = 6; scene.add(gapLine);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide });
  const rings = [0, 1].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 48), ringMat); r.rotation.x = -Math.PI / 2; r.position.y = 0.03; r.renderOrder = 6; scene.add(r); return r; });

  // timeline, in seconds of show time. Clip positions are in frames.
  const part = S.parting_s * 25, gEnd = G.pos.length - 1, eEnd = E.pos.length - 1;
  const A = (gEnd - 0) / 25, B = 1.8, c0 = G.start_offset, c1 = c0 + part + 6, C = (c1 - c0) / 25;      // slow motion starts just after they part
  const d1 = c0 + part + 62, SLOW = 0.3, D = (d1 - c1) / 25 / SLOW, Ee = (gEnd - d1) / 25, HOLD = 3.0;  // and runs until two and a half seconds after
  const marks = [A, A + B, A + B + C, A + B + C + D, A + B + C + D + Ee, A + B + C + D + Ee + HOLD], TOTAL = marks[5];
  function at(T) {
    if (T < marks[0]) return { ph: 'goal', fg: T * 25, fe: null, ghost: 0, rate: 1 };
    if (T < marks[1]) { const u = ease((T - marks[0]) / B); return { ph: 'rewind', fg: lerp(gEnd, c0, u), fe: E.start_offset, ghost: sat((u - 0.55) / 0.45), rate: 3 }; }
    if (T < marks[2]) { const k = (T - marks[1]) * 25; return { ph: 'together', fg: c0 + k, fe: E.start_offset + k, ghost: 1, rate: 1 }; }
    if (T < marks[3]) { const k = (c1 - c0) + (T - marks[2]) * 25 * SLOW; return { ph: 'part', fg: c0 + k, fe: E.start_offset + k, ghost: 1, rate: SLOW }; }
    const k = (d1 - c0) + Math.min(T - marks[3], Ee) * 25;
    return { ph: T < marks[4] ? 'finish' : 'hold', fg: Math.min(c0 + k, gEnd), fe: Math.min(E.start_offset + k, eEnd), ghost: T < marks[4] ? 1 : sat(1 - (T - marks[4]) / 1.2), rate: T < marks[4] ? 1 : 0.0001 };
  }
  const COPY = {
    goal: () => [`Minute ${G.minute}`, `${nm(scorer)} scores for ${S.team[scorer] ? 'Harbour City' : 'Northgate'}`],
    rewind: () => [`Closest earlier attempt, minute ${E.minute}`, `The two attacks start ${S.gap_m} m apart on average`],
    together: () => [`Closest earlier attempt, minute ${E.minute}`, `Outlined markers are minute ${E.minute}, laid over the goal`],
    part: () => [`${nm(who)} backs off`, S.booked_minute ? `In minute ${E.minute} he stepped in. Booked in minute ${S.booked_minute}, he does not` : `In minute ${E.minute} he stepped in`],
    finish: () => [`${nm(who)} backs off`, `Two seconds after they part he is ${S.differing_by_m} m from where he was in minute ${E.minute}`],
    hold: () => [`Closest earlier attempt, minute ${E.minute}`, `${nm(scorer)} scores. Two seconds after the attacks part, ${nm(who)}${S.booked_minute ? `, booked in minute ${S.booked_minute},` : ''} is ${S.differing_by_m} m from where he was then`],
  };
  const PHASE = { goal: 'The goal', rewind: 'Back to the start', together: 'Both attempts', part: 'Where they part', finish: 'To the finish', hold: 'The reason' };

  const camPos = new THREE.Vector3(0, 40, 80), camAim = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantAim = new THREE.Vector3(), v = new THREE.Vector3();
  let T = FIXED_T !== null ? Math.min(parseFloat(FIXED_T), TOTAL - 0.01) : FROM !== null ? Math.min(parseFloat(FROM), TOTAL - 0.01) : 0, playing = FIXED_T === null, last = performance.now(), firstFrame = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now, once) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) { T += dt; if (T >= TOTAL) { T = TOTAL - 0.001; playing = false; $('play').textContent = 'Replay'; } }
    const s = at(T), run = playing ? s.rate : 0;
    let pw = null, pg = null, ps = null;
    for (let i = 0; i < N; i++) {
      const p = place(live[i], G, s.fg, i, dt, run);
      if (i === who) pw = p; if (i === scorer) ps = p;
      const g = ghosts[i];
      if (s.fe === null || s.ghost <= 0.001) { g.setOpacity(0); continue; }
      const q = place(g, E, s.fe, i, dt, run);
      if (i === who) pg = q;
      const near = p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : 9;
      g.setOpacity(q ? s.ghost * (i === who ? 1 : 0.5) * sat((near - 0.6) / 1.2) : 0);        // an outline lying on its own man would only blur him
    }
    const b = sampleBall(G, s.fg); ball.set(b[0], b[2], -b[1]);
    if (s.fe !== null) { const e = sampleBall(E, s.fe); ghostBall.set(e[0], e[2], -e[1]); ghostBall.setOpacity(0.45 * s.ghost * sat(Math.hypot(e[0] - b[0], e[1] - b[1]) - 0.5)); } else ghostBall.setOpacity(0);
    live[who].setStake(S.booked_minute !== null ? 1 : 0, S.booked_minute !== null ? 1 : 0);          // he was booked before this goal
    pulses((G.actions || []).filter((a) => s.fg >= a.frame && s.fg < a.frame + 11).map((a) => { const q = sample(G, a.frame, a.player); return q && { x: q[0], z: -q[1], age: (s.fg - a.frame) / 25, strong: a.kind !== 'pass' }; }).filter(Boolean));
    // the gap
    const showGap = pw && pg && (s.ph === 'part' || s.ph === 'finish' || s.ph === 'hold');
    const d = pw && pg ? Math.hypot(pw[0] - pg[0], pw[1] - pg[1]) : 0, on = showGap && d > 1.2 ? sat((d - 1.2) / 1.2) * s.ghost : 0;
    gapLine.material.opacity = on; ringMat.opacity = on * 0.9;
    if (pw && pg) {
      gapGeo.setFromPoints([new THREE.Vector3(pw[0], 0.05, -pw[1]), new THREE.Vector3(pg[0], 0.05, -pg[1])]);
      rings[0].position.set(pw[0], 0.03, -pw[1]); rings[1].position.set(pg[0], 0.03, -pg[1]);
    }
    // camera
    // always from the main-stand side and high enough that every marker and number reads
    if (s.ph === 'goal') { wantPos.set(b[0] * 0.6, 40, 48); wantAim.set(b[0] * 0.85, 0, -b[1] * 0.3 + 8); }
    else if (s.ph === 'rewind') { const p = ps || [0, 0]; wantPos.set(p[0] * 0.7, 44, 50); wantAim.set(p[0] * 0.8, 0, -p[1] * 0.3 + 8); }
    else if (s.ph === 'together') { const p = ps || [0, 0]; wantPos.set(p[0] + 2, 30, -p[1] + 30); wantAim.set(p[0] + 4, 0, -p[1] + 5); }
    else if (s.ph === 'part' && pw && pg) { const mx = (pw[0] + pg[0]) / 2, mz = -(pw[1] + pg[1]) / 2, sp = Math.max(6, d * 0.9); wantPos.set(mx, 24 + sp * 1.2, mz + 22 + sp * 1.2); wantAim.set(mx, 0, mz + 3); }
    else { wantPos.set(b[0] - 3, 32, 34 - b[1] * 0.3); wantAim.set(Math.min(b[0] + 2, 47), 0, -b[1] * 0.5 + 7); }
    const kk = firstFrame || !playing || reduce ? 1 : 1 - Math.exp(-dt * (s.ph === 'goal' ? 3.2 : 2.1));
    camPos.lerp(wantPos, kk); camAim.lerp(wantAim, kk); firstFrame = false;
    camera.position.copy(camPos); camera.lookAt(camAim);
    // words: every number here is read from the run
    const [h, p2] = COPY[s.ph]();
    if ($('l1').textContent !== h) $('l1').textContent = h;
    if ($('l2').textContent !== p2) $('l2').textContent = p2;
    $('phase').textContent = PHASE[s.ph];
    const clk = G.clock + (s.fg - G.start_offset) / 25; $('clock').textContent = `${String(Math.floor(clk / 60)).padStart(2, '0')}:${String(Math.floor(clk % 60)).padStart(2, '0')}`;
    const proj = (x, y, z, el, txt, show) => {
      v.set(x, y, z).project(camera);
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; el.style.opacity = show; if (txt !== null) el.textContent = txt;
    };
    if (pw && pg) {
      proj((pw[0] + pg[0]) / 2, 0.1, -(pw[1] + pg[1]) / 2 - 2.4, $('gap'), `${(s.fg >= c0 + part + 50 ? S.differing_by_m : d).toFixed(1)} m`, on);      // once measured, two seconds after they part, the number holds
      proj(pg[0], 0.1, -pg[1] + 2.6, $('tagA'), `Minute ${E.minute}`, on); proj(pw[0], 0.1, -pw[1] + 2.6, $('tagB'), `Minute ${G.minute}`, on);
    } else { $('gap').style.opacity = 0; $('tagA').style.opacity = 0; $('tagB').style.opacity = 0; }
    if (document.activeElement !== $('scrub')) $('scrub').value = Math.round(T / TOTAL * 1000);
    renderer.render(scene, camera);
    if (!once) requestAnimationFrame(frame);
  }
  $('play').onclick = () => { if (T >= TOTAL - 0.01) T = 0; playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; last = performance.now(); };
  $('scrub').oninput = (e) => { T = e.target.value / 1000 * TOTAL; playing = false; $('play').textContent = 'Play'; };
  addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); $('play').click(); } });
  if (!playing) $('play').textContent = 'Play';
  const fit = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', fit); fit();
  window.__tempo = { TOTAL, marks };
  // ?bench=1 times the drawing itself: 40 frames back to back, each forced to finish on the graphics card by reading a pixel.
  // It does not depend on how often the browser offers a frame, so it works in a hidden or throttled tab.
  if (Q.get('bench')) {
    const gl = renderer.getContext(), px = new Uint8Array(4), ms = [];
    playing = true; T = 14;
    for (let i = 0; i < 46; i++) {
      const t0 = performance.now(); frame(last + 33.3, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 6) ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b); const r = renderer.info.render;
    window.__tempo.bench = { median_ms: +ms[20].toFixed(1), p95_ms: +ms[37].toFixed(1), draw_calls: r.calls, triangles: r.triangles, canvas: [renderer.domElement.width, renderer.domElement.height] };
    playing = false;
  }
  requestAnimationFrame(frame);
}
main().catch((e) => fail(`Something went wrong while building the scene: ${e.message}`));
