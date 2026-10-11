// Tempo live: a stretch of play on a dark pitch, a marker for each player, with the two-level stake card.
// Everything shown comes from runs/<match>/live.json, which the pipeline writes: positions, who strikes the ball, and every cue
// with its match time. This page decides nothing. It shows each cue when the match clock reaches it.
import * as THREE from 'three';
import { renderer, scene, camera, KITS, CARD, Marker, makeBall, makePulses } from '../stage.js';

const Q = new URLSearchParams(location.search), RUN = Q.get('run') || 'm_demo', FIXED_T = Q.get('t');
const $ = (id) => document.getElementById(id);
const fail = (m) => { $('err').style.display = 'flex'; $('err').textContent = m; };
const lerp = (a, b, t) => a + (b - a) * t, sat = (t) => Math.min(1, Math.max(0, t));

async function main() {
  const L = await fetch(`../../runs/${RUN}/live.json`).then((r) => { if (!r.ok) throw new Error('run'); return r.json(); }).catch(() => null);
  if (!L) return fail('Could not load the run. Run python3 -m tempo.run_match, then serve the project folder.');
  if (!L.frames) return fail('This run has no booking, so there is no stake card to show.');
  const N = L.ids.length, FPS = L.fps, TOTAL = (L.frames - 1) / FPS, name = (pid) => L.names[pid], index = (pid) => L.ids.indexOf(pid);
  $('hs').textContent = L.home.short; $('as').textContent = L.away.short;

  // ---- what the cues say, laid out by time so any moment can be shown directly ----
  const stake = Array.from({ length: N }, () => []);                           // per player: [t, level, chance]
  const labels = [], tags = [], said = [];
  for (const c of L.cues) {
    if (c.status === 'withdrawn') continue;
    if (c.form === 'stake_card') stake[index(c.payload.player)].push([c.t, c.payload.level, c.payload.chance]);
    else if (c.form === 'label') labels.push(c);
    else if (c.form === 'tag') tags.push(c);
    else if (c.form === 'sentence' && c.screen === 'phone' && c.payload.lang === 'en' && c.payload.depth === 'casual') said.push(c);
  }
  // a label marked for the next pause waits for the ball to go dead
  for (const c of labels) {
    let f = Math.ceil(c.t * FPS);
    if (c.when === 'next_pause') while (f < L.frames - 1 && L.live[f]) f++;
    c.show = f / FPS;
  }
  const bookings = [...L.booked_before.map((b) => ({ t: -1, pid: b.player, minute: b.minute }))];
  for (const c of labels) { const m = /^(.+) booked$/.exec(c.payload.text); if (m) { const pid = L.ids.find((p) => name(p) === m[1]); if (pid) bookings.push({ t: c.t, pid, minute: Math.floor((L.t0 + c.t) / 60) + 1 }); } }
  const levelAt = (i, T) => { let out = [0, 0]; for (const s of stake[i]) { if (s[0] > T) break; out = [s[1], s[2]]; } return out; };

  // ---- the players, the ball, and a card for anyone who can carry one ----
  const figs = [];
  for (let i = 0; i < N; i++) {
    const team = L.team[i], kit = { ...KITS[team] };
    if (L.numbers[i] === 1) kit.shirt = kit.keeper;
    figs.push(new Marker({ number: L.numbers[i], kit })); scene.add(figs[i].group);
  }
  const ball = makeBall(), pulses = makePulses(); scene.add(ball.group);
  // The card has two levels. Faint: an outline with a pale fill and a thin ring round his marker, saying he is in the play on
  // a yellow. Full: solid and lit, when the model puts a challenge at one in five or more.
  const cards = stake.map((s) => {
    if (!s.length) return null;
    const g = new THREE.Group(), geo = new THREE.BoxGeometry(0.34, 0.48, 0.03);
    const fill = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: CARD, emissive: 0x7A5C00, emissiveIntensity: 0, roughness: 0.35, transparent: true, opacity: 0, depthWrite: false }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: CARD, transparent: true, opacity: 0 }));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), new THREE.MeshBasicMaterial({ color: CARD, transparent: true, opacity: 0 })); pin.position.y = -0.41;
    g.add(fill, edge, pin); g.userData = { fill, edge, pin, k: 0, full: 0 }; g.visible = false; g.renderOrder = 4; scene.add(g);
    return g;
  });

  const pos = (f, i) => {
    const n = L.frames - 1, a = Math.min(n, Math.max(0, Math.floor(f))), b = Math.min(n, a + 1), t = sat(f - a), p = L.pos[a][i], q = L.pos[b][i];
    if (!p || !q || p[0] === null || q[0] === null) return null;
    return [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
  };
  const ballAt = (f) => { const n = L.frames - 1, a = Math.min(n, Math.max(0, Math.floor(f))), b = Math.min(n, a + 1), t = sat(f - a); return [0, 1, 2].map((k) => lerp(L.ball[a][k], L.ball[b][k], t)); };
  camera.fov = 30; camera.updateProjectionMatrix();
  const camPos = new THREE.Vector3(0, 52, 60), camAim = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantAim = new THREE.Vector3(), v = new THREE.Vector3();
  let T = FIXED_T !== null ? Math.min(parseFloat(FIXED_T), TOTAL - 0.01) : 0, playing = FIXED_T === null, last = performance.now(), first = true, shownBookings = -1;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now, once) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) { T += dt; if (T >= TOTAL) { T = TOTAL - 0.001; playing = false; $('play').textContent = 'Replay'; } }
    const f = T * FPS, rate = playing ? 1 : 0, b = ballAt(f);
    let top = null;                                                             // the player whose card matters most right now
    for (let i = 0; i < N; i++) {
      const fig = figs[i], p = pos(f, i);
      if (!p) { fig.group.visible = false; if (cards[i]) cards[i].visible = false; continue; }
      fig.group.visible = true;
      const a = pos(f - 2, i) || p, b = pos(f + 2, i) || p, vx = (b[0] - a[0]) * FPS / 4, vy = (b[1] - a[1]) * FPS / 4, sp = Math.hypot(vx, vy);
      fig.group.position.set(p[0], 0, -p[1]);
      // he points where he is going; standing or walking slowly, he watches the ball
      { let d = (sp > 0.9 ? Math.atan2(vx, -vy) : Math.atan2(b[0] - p[0], -(b[1] - p[1]))) - fig.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); fig.yaw += d * (rate ? (sp > 0.9 ? 0.25 : 0.08) : 1); }
      fig.turn.rotation.y = fig.yaw;
      fig.update(dt, sp, rate);
      const c = cards[i];
      if (c) {
        const [lvl, chance] = levelAt(i, T), u = c.userData, step = reduce || !playing ? 1 : 1 - Math.exp(-dt * 9);
        u.k += ((lvl > 0 ? 1 : 0) - u.k) * step; u.full += ((lvl === 2 ? 1 : 0) - u.full) * step;
        c.visible = u.k > 0.02; fig.setStake(u.k, u.full);
        if (c.visible) {
          const dist = camera.position.distanceTo(fig.group.position), size = Math.max(1, dist / 20) * (1 + 0.3 * u.full);
          c.position.set(p[0], 0.12 + 0.58 * size, -p[1]); c.scale.setScalar(size);      // the pin stands on his marker
          c.rotation.y = Math.atan2(camera.position.x - p[0], camera.position.z + p[1]);
          u.fill.material.opacity = u.k * lerp(0.3, 1, u.full); u.fill.material.emissiveIntensity = lerp(0.5, 1.1, u.full);
          u.edge.material.opacity = u.k; u.pin.material.opacity = u.k * lerp(0.55, 1, u.full);
        }
        if (lvl > 0 && (!top || lvl > top.lvl || (lvl === top.lvl && chance > top.chance))) top = { i, lvl, chance };
      }
    }
    ball.set(b[0], b[2], -b[1]);
    // a ring opens where someone plays the ball; a stronger one where a challenge is made
    pulses(L.actions.filter((a) => T >= a.t && T < a.t + 0.45).map((a) => { const q = pos(a.t * FPS, a.player); return q && { x: q[0], z: -q[1], age: T - a.t, strong: a.kind !== 'pass' }; }).filter(Boolean));
    // the camera sits high on the main-stand side and follows the ball without chasing every touch
    wantPos.set(b[0] * 0.45, 52, 60); wantAim.set(b[0] * 0.8, 0, -b[1] * 0.3 + 4);
    const kk = first || !playing || reduce ? 1 : 1 - Math.exp(-dt * 2.4);
    camPos.lerp(wantPos, kk); camAim.lerp(wantAim, kk); first = false;
    camera.position.copy(camPos); camera.lookAt(camAim);

    // ---- the picture's graphics ----
    const clk = L.t0 + T, sc = L.goals.reduce((s, g) => (g.t <= T ? g.score : s), L.score_at_start);
    $('hg').textContent = sc[0]; $('ag').textContent = sc[1];
    $('clock').textContent = `${String(Math.floor(clk / 60)).padStart(2, '0')}:${String(Math.floor(clk % 60)).padStart(2, '0')}`;
    const nb = bookings.filter((k) => k.t <= T).length;
    if (nb !== shownBookings) { shownBookings = nb; $('booked').replaceChildren(...bookings.filter((k) => k.t <= T).map((k) => { const d = document.createElement('div'); d.append(document.createElement('b'), `${name(k.pid)} ${k.minute}'`); return d; })); }
    const lab = labels.find((c) => T >= c.show && T <= c.show + c.valid_for);
    $('lower').classList.toggle('on', !!lab); if (lab) $('lower').textContent = lab.payload.text;
    const tg = tags.find((c) => T >= c.t && T <= c.t + c.valid_for), tp = tg ? pos(f, index(tg.payload.player)) : null;
    if (tg && tp) { v.set(tp[0], 1.4, -tp[1]).project(camera); const el = $('tag'); el.textContent = tg.payload.text; el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; el.style.opacity = 1; } else $('tag').style.opacity = 0;
    // ---- the phone: the same moment in words ----
    if (top) {
      const pid = L.ids[top.i];
      $('ph0').textContent = 'At stake'; $('ph1').textContent = name(pid);
      $('ph2').textContent = top.lvl === 2 ? `One foul from a red card. A challenge is likely: about ${Math.round(top.chance * 100)} in 100` : 'One foul from a red card, and he is in the play';
      $('meter').firstElementChild.style.width = `${Math.min(100, Math.round(top.chance * 100))}%`;
    } else {
      $('ph0').textContent = `${L.home.name} v ${L.away.name}`; $('ph1').textContent = 'Nothing at stake'; $('ph2').textContent = 'The picture stays clear until a booked player is drawn into the play';
      $('meter').firstElementChild.style.width = '0%';
    }
    const line = [...said].reverse().find((c) => c.t <= T); $('said').textContent = line ? line.payload.text : '';
    $('note').textContent = L.stake.provisional ? 'Provisional model' : `Card levels at ${L.stake.faint} and ${L.stake.full}`;
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
  window.__tempo = { TOTAL, stakeTimes: stake.map((s, i) => [L.names[L.ids[i]], s.length]).filter((x) => x[1]) };
  if (Q.get('bench')) {                                                       // times the drawing itself, as in the replay
    const gl = renderer.getContext(), px = new Uint8Array(4), ms = []; playing = true; T = 60;
    for (let i = 0; i < 46; i++) { const t0 = performance.now(); frame(last + 33.3, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (i >= 6) ms.push(performance.now() - t0); }
    ms.sort((a, b) => a - b); window.__tempo.bench = { median_ms: +ms[20].toFixed(1), p95_ms: +ms[37].toFixed(1), draw_calls: renderer.info.render.calls }; playing = false;
  }
  requestAnimationFrame(frame);
}
main().catch((e) => fail(`Something went wrong while building the scene: ${e.message}`));
