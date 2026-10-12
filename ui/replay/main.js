// Tempo replay: the closest earlier attempt and then the goal, one at a time, on the same dark pitch as the live view.
// Everything on screen comes from runs/<match>/scenes.json, which the pipeline writes. Nothing here invents a number.
// Solid markers are the attempt being shown. Outlined markers are where the earlier attempt ended, left behind while the goal plays.
import * as THREE from 'three';
import { renderer, scene, camera, KITS, Marker, makeBall, makePulses, facing, CRESTS, FONT } from '#stage';

const Q = new URLSearchParams(location.search);
const RUN = Q.get('run') || 'm_demo', FIXED_T = Q.get('t'), FROM = Q.get('from'), WAIT = parseFloat(Q.get('wait') || 0);      // ?wait= holds the first picture still for that long, so the film can fade it in before it moves      // ?t= opens paused at a moment, ?from= starts playing from one
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
  const scenes = await fetch(`../../runs/${RUN}/scenes.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('run'); return r.json(); }).catch(() => null);
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

  // The film shows the pitch the way the match was played; the clips are stored turned to run one way. ?turn=-1 turns them back.
  if (Q.get('turn') === '-1') for (const C of [G, E]) { for (const row of C.pos) for (const q of row) if (q && q[0] !== null) { q[0] = -q[0]; q[1] = -q[1]; } for (const q of C.ball) { q[0] = -q[0]; q[1] = -q[1]; } }

  // The show, in seconds. One attempt is on the pitch at a time. First the earlier one, alone: the clock winds back to it and
  // it plays until two seconds after the attacks part. Then the picture rewinds to the start of the goal, and what the earlier
  // attempt came to stays behind as two outlined markers and a dotted trail. The goal plays alone, in full, past them. It stops
  // once, two seconds after the attacks part, and the one distance that differs is drawn.
  const part = S.parting_s * 25, shown = part + 50, c0 = G.start_offset, e0 = E.start_offset;
  const moved = (C) => Math.max(0, C.pos.findIndex((q) => q[scorer] && C.pos[0][scorer] && Math.hypot(q[scorer][0] - C.pos[0][scorer][0], q[scorer][1] - C.pos[0][scorer][1]) > 0.4));
  const lead = Math.max(0, Math.min(moved(G) - c0, moved(E) - e0) - 6);                 // the wait before the runner sets off is skipped
  const gs = c0 + lead, es = e0 + lead, gm = c0 + shown, em = Math.min(E.pos.length - 1, e0 + shown), gEnd = Math.min(G.pos.length - 1, G.shot_offset + 26);
  const dirx = Math.sign(G.pos[G.shot_offset][scorer][0] - G.pos[c0][scorer][0]) || 1;
  const LEN = [['stop', 0.4], ['back', 0.7], ['then', (em - es) / 25], ['thenhold', 0.6], ['rewind', 1.2], ['now', (gm - gs) / 25], ['diff', 1.4], ['finish', (gEnd - gm) / 25], ['hold', 0.4]];
  const marks = []; LEN.reduce((t, [, d]) => { marks.push(t + d); return t + d; }, 0); const TOTAL = marks[marks.length - 1];
  const gClock = (f) => G.clock + f / 25, eClock = (f) => E.clock + f / 25, booked = S.booked_minute !== null ? 1 : 0;
  // a: what the solid markers show. b: what they are on the way to, u of the way there. ghost: how strongly the earlier attempt's end is drawn.
  function at(T) {
    const i = Math.max(0, marks.findIndex((m) => T < m)), ph = LEN[i][0], t = T - (i ? marks[i - 1] : 0), u = sat(t / LEN[i][1]);
    if (ph === 'stop') return { ph, a: [G, gs], u: 0, ghost: 0, rate: 0, clock: gClock(gs), card: booked };
    if (ph === 'back') return { ph, a: [G, gs], b: [E, es], u: ease(u), ghost: 0, rate: 0, clock: lerp(gClock(gs), eClock(es), ease(u)), card: booked * (1 - ease(u)) };
    if (ph === 'then') return { ph, a: [E, es + t * 25], u: 0, ghost: 0, rate: 1, clock: eClock(es + t * 25), card: 0 };
    if (ph === 'thenhold') return { ph, a: [E, em], u: 0, ghost: 0, rate: 0, clock: eClock(em), card: 0 };
    if (ph === 'rewind') return { ph, a: [E, em], b: [G, gs], u: ease(u), ghost: sat(u / 0.35), rate: 0, clock: lerp(eClock(em), gClock(gs), ease(u)), card: booked * sat((u - 0.6) / 0.4) };
    if (ph === 'now') return { ph, a: [G, gs + t * 25], u: 0, ghost: 1, rate: 1, clock: gClock(gs + t * 25), card: booked };
    if (ph === 'diff') return { ph, a: [G, gm], u: 0, ghost: 1, rate: 0, clock: gClock(gm), card: booked, gap: Math.min(sat(t / 0.3), sat((LEN[i][1] - t) / 0.3)) };
    if (ph === 'finish') return { ph, a: [G, gm + t * 25], u: 0, ghost: 1 - 0.6 * sat(t / 0.8), rate: 1, clock: gClock(gm + t * 25), card: booked };
    return { ph, a: [G, gEnd], u: 0, ghost: 0.4, rate: 0, clock: gClock(gEnd), card: booked };
  }
  const side = S.team[scorer] ? S.away : S.home;
  const COPY = {
    stop: () => [`Minute ${G.minute}`, `${nm(scorer)} is about to run at goal`],
    back: () => [`Back to minute ${E.minute}`, 'The closest earlier attempt in this match'],
    then: () => [`Minute ${E.minute}`, `The same run. ${nm(who)} steps in`],
    thenhold: () => [`Minute ${E.minute}`, `The same run. ${nm(who)} steps in`],
    rewind: () => [`Now minute ${G.minute}`, `The outlines are where minute ${E.minute} ended`],
    now: () => [`Minute ${G.minute}`, booked ? `${nm(who)} is on a yellow card from minute ${S.booked_minute}` : 'The same run again'],
    diff: () => ['One thing changed', `Two seconds after the attacks part ${nm(who)} is ${S.differing_by_m} m from where he was in minute ${E.minute}`],      // what differs, and the card. Not a verdict on the man: nobody can see what he was told to do
    finish: () => [`Minute ${G.minute}`, `${nm(scorer)} scores for ${side === S.home ? 'Northgate' : 'Harbour City'}`],
    hold: () => [`Minute ${G.minute}`, `${nm(scorer)} scores for ${side === S.home ? 'Northgate' : 'Harbour City'}`],
  };
  const PHASE = { stop: 'The goal, about to start', back: 'Back to the earlier attempt', then: 'The earlier attempt', thenhold: 'The earlier attempt', rewind: 'Back to the goal', now: 'The goal', diff: 'What changed', finish: 'The goal', hold: 'The goal' };

  // What the earlier attempt came to: the runner's path as dots on the grass, and (drawn with the outlined markers) where the runner and the man who stepped in stood at the end.
  const dotMat = new THREE.MeshBasicMaterial({ color: KITS[S.team[scorer]].line, transparent: true, opacity: 0, depthTest: false });
  { let lastP = null; for (let f = es; f <= em; f++) { const q = sample(E, f, scorer); if (!q || (lastP && Math.hypot(q[0] - lastP[0], q[1] - lastP[1]) < 0.9)) continue; lastP = q; const d = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), dotMat); d.rotation.x = -Math.PI / 2; d.position.set(q[0], 0.025, -q[1]); d.renderOrder = 1; scene.add(d); } }
  const endOf = [scorer, who].map((i) => sample(E, em, i));

  const camPos = new THREE.Vector3(0, 40, 80), camAim = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantAim = new THREE.Vector3(), v = new THREE.Vector3();
  let T = FIXED_T !== null ? Math.min(parseFloat(FIXED_T), TOTAL - 0.01) : FROM !== null ? Math.min(parseFloat(FROM), TOTAL - 0.01) : 0, playing = FIXED_T === null, last = performance.now(), firstFrame = true, began = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stand = (fig, src, i, dt, rate) => {                                    // one marker, on a clip or part of the way between two
    const p = place(fig, src.a[0], src.a[1], i, dt, rate); if (!src.b || !p) return p;
    const q = sample(src.b[0], src.b[1], i); if (!q) return p;
    const m = [lerp(p[0], q[0], src.u), lerp(p[1], q[1], src.u)]; fig.group.position.set(m[0], 0, -m[1]); return m;
  };

  function frame(now, once) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (began === null) began = now;
    if (playing && now - began >= WAIT * 1000) { T += dt; if (T >= TOTAL) { T = TOTAL - 0.001; playing = false; $('play').textContent = 'Replay'; } }
    const s = at(T), run = playing ? s.rate : 0;
    let pw = null, ps = null;
    for (let i = 0; i < N; i++) {
      const p = stand(live[i], s, i, dt, run);
      if (i === who) pw = p; if (i === scorer) ps = p;
      const g = ghosts[i], k = [scorer, who].indexOf(i), q = k >= 0 ? endOf[k] : null;      // only two outlines are ever drawn
      if (!q || s.ghost <= 0.001) { g.setOpacity(0); continue; }
      g.group.visible = true; g.group.position.set(q[0], 0, -q[1]); g.update(dt, 0, 0);
      g.setOpacity(s.ghost * (p ? sat((Math.hypot(p[0] - q[0], p[1] - q[1]) - 0.5) / 1.0) : 1));        // an outline lying on its own man would only blur him
    }
    const ba = sampleBall(s.a[0], s.a[1]), bq = s.b ? sampleBall(s.b[0], s.b[1]) : ba, b = ba.map((x, j) => lerp(x, bq[j], s.u)); ball.set(b[0], b[2], -b[1]);
    ghostBall.setOpacity(0); dotMat.opacity = 0.9 * s.ghost;
    live[who].setStake(s.card, s.card);                                          // his card is the thing that is there the second time
    const C = s.a[0], cf = s.a[1];
    pulses(s.b ? [] : (C.actions || []).filter((a) => cf >= a.frame && cf < a.frame + 11).map((a) => { const q = sample(C, a.frame, a.player); return q && { x: q[0], z: -q[1], age: (cf - a.frame) / 25, strong: a.kind !== 'pass' }; }).filter(Boolean));
    // the gap: where he stood at this moment the first time, and where he stands now
    const pg = endOf[1], on = pw && pg && s.gap ? s.gap : 0;
    gapLine.material.opacity = on; ringMat.opacity = on * 0.9;
    if (pw && pg) {
      gapGeo.setFromPoints([new THREE.Vector3(pw[0], 0.05, -pw[1]), new THREE.Vector3(pg[0], 0.05, -pg[1])]);
      rings[0].position.set(pw[0], 0.03, -pw[1]); rings[1].position.set(pg[0], 0.03, -pg[1]);
    }
    // camera: always from the main-stand side and high enough that every marker and number reads
    if (s.ph === 'diff' && pw && pg) { const mx = (pw[0] + pg[0]) / 2, mz = -(pw[1] + pg[1]) / 2; wantPos.set(mx, 31, mz + 29); wantAim.set(mx, 0, mz + 3); }
    else if (s.ph === 'finish' || s.ph === 'hold') { wantPos.set(b[0] - 3 * dirx, 32, 34 - b[1] * 0.3); wantAim.set(dirx > 0 ? Math.min(b[0] + 2, 47) : Math.max(b[0] - 2, -47), 0, -b[1] * 0.5 + 7); }
    else { const p = ps || [0, 0]; wantPos.set(p[0] + 2 * dirx, 30, -p[1] + 30); wantAim.set(p[0] + 4 * dirx, 0, -p[1] + 5); }
    const kk = firstFrame || !playing || reduce ? 1 : 1 - Math.exp(-dt * 2.1);
    camPos.lerp(wantPos, kk); camAim.lerp(wantAim, kk); firstFrame = false;
    camera.position.copy(camPos); camera.lookAt(camAim);
    // words: every number here is read from the run
    const [h, p2] = COPY[s.ph]();
    if ($('l1').textContent !== h) $('l1').textContent = h;
    if ($('l2').textContent !== p2) $('l2').textContent = p2;
    $('phase').textContent = PHASE[s.ph];
    $('clock').textContent = `${String(Math.floor(s.clock / 60)).padStart(2, '0')}:${String(Math.floor(s.clock % 60)).padStart(2, '0')}`;
    if (parent !== window) parent.postMessage({ tempoReplay: { clock: s.clock, phase: s.ph, scored: s.a[0] === G && s.a[1] >= G.shot_offset + 19 } }, location.origin);      // inside the film, the film's own scoreboard shows which minute this is
    const proj = (x, y, z, el, txt, show) => {
      v.set(x, y, z).project(camera);
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; el.style.opacity = show; if (txt !== null) el.textContent = txt;
    };
    if (pw && pg) {
      proj((pw[0] + pg[0]) / 2, 0.1, -(pw[1] + pg[1]) / 2 - 2.4, $('gap'), `${S.differing_by_m.toFixed(1)} m`, on);
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
    playing = true; T = Math.min(14, TOTAL - 2);
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
