// Tempo match: the whole match on the stage, with everything the pipeline decided to show, where and when it decided it.
// Positions come from runs/<match>/match.bin (25 frames a second) and everything else from match.json. This page decides
// nothing: it draws each cue when the match reaches the frame the cue was issued on.
import * as THREE from 'three';
import { playIntro } from '#intro';
import { renderer, scene, camera, KITS, project, watchSize, spread, facing, CRESTS, FONT, drawPitch } from '#stage';
import { Marker } from '#marker';
import { makeBall, makePulses } from '#shapes';
import { $, fail, lerp, upper, mmss } from '#util';
import { loadMatch } from '#live/match-data';
import { pin, place } from '#live/pins';
import { makeKickoffMarks } from '#live/marks';
import { makePlates } from '#live/plates';
import { makeStrip } from '#live/strip';
import { makePhone } from '#live/phone';
import { makeFollow } from '#live/follow';
import { makeInterval } from '#live/cards';

const Q = new URLSearchParams(location.search),
  RUN = Q.get('run') || 'm_demo';

async function main() {
  // The intro plays over the picture while the match loads, unless the page was opened at a particular moment.
  const TOUR = Q.get('tour') !== null; // the product film drives this page itself (ui/tour/film.js)
  const wantIntro = !TOUR && Q.get('intro') !== '0' && !['f', 't', 'm', 'bench'].some((k) => Q.get(k) !== null);
  const intro = wantIntro ? playIntro($('intro')) : Promise.resolve();
  if (!wantIntro && !TOUR) $('intro').remove();
  await Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.load(`600 20px ${FONT}`)]).catch(() => {}); // the numbers on the markers are drawn once, so the face must be in
  const match = await loadMatch(RUN);
  if (!match) return fail('Could not load the run. Run python3 -m tempo.run_match, then serve the project folder.');
  const {
    M,
    N,
    FPS,
    LAST,
    name,
    pos,
    ballAt,
    span,
    clockAt,
    frameAtClock,
    stake,
    timed,
    marks,
    lateMark,
    shownFrames,
    levelAt,
    active,
    fade,
    acts,
    actFrames,
    downs,
    downFrames,
    moments,
  } = match;
  $('hs').textContent = M.home.short;
  $('as').textContent = M.away.short;
  for (const [id, club] of [
    ['hc', M.home],
    ['ac', M.away],
  ]) {
    const f = CRESTS[club.short.toLowerCase()];
    if (f) {
      $(id).src = `../brand/${f}`;
      $(id).alt = `${club.name} crest`;
      $(id).hidden = false;
      $(id).previousElementSibling.hidden = true;
    }
  }
  // ---- the players, the ball, and the shapes drawn on the pitch ----
  const figs = [];
  for (let i = 0; i < N; i++) {
    const kit = { ...KITS[M.team[i]] };
    if (M.numbers[i] === 1) kit.shirt = kit.keeper;
    figs.push(new Marker({ number: M.numbers[i], kit }));
    scene.add(figs[i].group);
  }
  const ball = makeBall(),
    pulses = makePulses();
  scene.add(ball.group);
  const state = stake.map((s) => (s.f.length ? { k: 0, full: 0 } : null));
  const names = state.map((s, i) =>
    s ? Object.assign(pin('name'), { textContent: `${name(M.ids[i])} ${M.numbers[i]}` }) : null,
  );
  const drawPlates = makePlates(match),
    drawMarks = makeKickoffMarks(match, TOUR);
  const strip = makeStrip(match, { seek: (f) => seek(f), getF: () => F }),
    lateSpan = strip.lateSpan,
    interval = makeInterval(M),
    follow = makeFollow(match, Q),
    phone = makePhone(match, follow);

  // ---- playback ----
  camera.fov = 30;
  const camPos = new THREE.Vector3(0, 46, 52),
    camAim = new THREE.Vector3(),
    wantPos = new THREE.Vector3(),
    wantAim = new THREE.Vector3();
  const start =
    Q.get('f') !== null
      ? +Q.get('f')
      : Q.get('t') !== null
        ? +Q.get('t') * FPS
        : Q.get('m') !== null
          ? frameAtClock(+Q.get('m') * 60)
          : null;
  let F = start !== null ? Math.min(Math.max(0, start), LAST) : 0,
    playing = start === null && !wantIntro && !TOUR,
    speed = 1,
    last = performance.now(),
    snap = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Hooks for a director: its own camera, a call every frame, the players to keep bright, a kick-off mark to hold up, a
  // blend from an earlier moment, a time and a score for the scoreboard to show in place of its own, and `plain` to draw the
  // players and the ball with none of the match view's own marks, tags or labels.
  const DIR = {
    cam: null,
    onFrame: null,
    focus: null,
    mark: null,
    blend: null,
    clock: null,
    score: null,
    plain: false,
  };
  const seek = (f, soft) => {
    F = Math.min(LAST, Math.max(0, f));
    snap = !soft;
    for (const s of state)
      if (s) {
        s.k = 0;
        s.full = 0;
      }
  }; // soft: the camera travels there
  // A director can carry the picture from one moment of the match to another without a cut: while DIR.blend is set, every marker
  // and the ball are drawn part of the way between where they stood at `from` and where they stand now, and the clock rolls with them.
  const mixed = (now, was, k) => (now && was ? now.map((v, j) => lerp(was[j], v, k)) : k > 0.5 ? now : was);
  const drawn = (i) => (DIR.blend ? mixed(pos(F, i), pos(DIR.blend.from, i), DIR.blend.k) : pos(F, i));

  function frame(now, once) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      F += dt * FPS * speed;
      if (F >= LAST) {
        F = LAST;
        playing = false;
        $('play').textContent = 'Replay';
      }
    }
    const rate = playing ? speed : 0,
      b = DIR.blend ? mixed(ballAt(F), ballAt(DIR.blend.from), DIR.blend.k) : ballAt(F),
      Fs = DIR.blend ? lerp(DIR.blend.from, F, DIR.blend.k) : F,
      P = span(F),
      kickoff = DIR.mark
        ? marks[DIR.mark.i]
        : marks.find((c) => F >= c.start && F < c.end) ||
          (lateSpan && lateMark && F >= lateSpan[0] && F < lateSpan[0] + 8 * FPS
            ? { ...lateMark, start: lateSpan[0], end: lateSpan[0] + 8 * FPS, again: true }
            : undefined),
      markK = (c, sec) => (DIR.mark ? DIR.mark.k : fade(c, F, sec));
    let top = null;
    const shown = spread(figs.map((_, i) => drawn(i))); // players in contact overlap, as bodies do; they are only kept from hiding each other completely
    // what contact is doing to each body right now: a quick give at the instant of a challenge, and a spell on the ground after a foul
    const hit = new Float32Array(N),
      down = new Float32Array(N);
    for (let k = upper(actFrames, F - 0.5 * FPS); k < upper(actFrames, F); k++) {
      const a = acts[k],
        age = (F - a.frame) / FPS,
        v = Math.exp(-7 * age) * Math.cos(20 * age);
      hit[a.player] = v;
      if (a.other !== undefined) hit[a.other] = v;
    }
    for (let k = upper(downFrames, F - 4 * FPS); k < upper(downFrames, F); k++) {
      const a = downs[k],
        age = (F - a.frame) / FPS;
      if (age < a.seconds + 0.4) down[a.player] = Math.min(1, age / 0.18, (a.seconds + 0.4 - age) / 0.4);
    }
    for (let i = 0; i < N; i++) {
      const fig = figs[i],
        p = shown[i];
      if (!p) {
        fig.group.visible = false;
        if (names[i]) names[i].style.opacity = 0;
        continue;
      }
      fig.group.visible = true;
      {
        const want = DIR.focus ? (DIR.focus.has(i) ? 1 : 0.28) : follow.dim(i);
        fig.dim = (fig.dim ?? 1) + (want - (fig.dim ?? 1)) * (snap ? 1 : 0.1);
        if (DIR.focus || fig.dim < 0.995 || want < 1) fig.setOpacity(fig.dim);
      } // a director can dim everyone but its subject
      const a = pos(F - 3, i) || p,
        c = pos(F + 3, i) || p,
        vx = ((c[0] - a[0]) * FPS) / 6,
        vy = ((c[1] - a[1]) * FPS) / 6,
        sp = Math.hypot(vx, vy);
      fig.group.position.set(p[0], 0, -p[1]);
      fig.setBody(hit[i], down[i]);
      {
        const layer = (40 - p[1]) / 800;
        if (Math.abs(layer - (fig.layerNow || 0)) > 0.002) fig.order(layer);
      } // the nearer man is drawn over the further one
      let d = facing(p[0], p[1], vx, vy, b[0], b[1]) - fig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // he watches the ball
      fig.yaw += d * (rate && !snap ? Math.min(1, 0.2 * speed) : 1);
      fig.turn.rotation.y = fig.yaw;
      if (sp > 0.5) fig.motion.rotation.y = Math.atan2(vx, -vy);
      fig.update(dt, sp, rate);
      const u = state[i];
      if (u) {
        let [lvl, chance] = levelAt(i, F);
        const ifBooked =
          kickoff && kickoff.payload.mark === 'zone' && kickoff.payload.subject === M.ids[i] ? markK(kickoff, 0.35) : 0; // "if he is booked": the outline, before anything has happened
        const step = reduce || !playing || snap ? 1 : 1 - Math.exp(-dt * 9);
        u.k += ((lvl > 0 ? 1 : 0) - u.k) * step;
        u.full += ((lvl === 2 ? 1 : 0) - u.full) * step;
        fig.setStake(DIR.plain ? 0 : Math.max(u.k, ifBooked), u.full, 0.5 + 0.5 * Math.sin(now / 160));
        place(
          names[i],
          project(p[0] + 1.6, 0, -p[1]),
          !DIR.plain && (u.k * u.full > 0.3 || ifBooked > 0.3) ? 1 : 0,
          '0',
          '-50%',
        );
        if (lvl > 0 && (!top || lvl > top.lvl || (lvl === top.lvl && chance > top.chance))) top = { i, lvl, chance };
      }
    }
    ball.set(b[0], b[2], -b[1]);
    const k0 = upper(actFrames, F - 0.5 * FPS),
      k1 = upper(actFrames, F); // a thin ring where a challenge has just been made
    pulses(
      acts
        .slice(k0, k1)
        .map((a) => {
          const q = pos(a.frame, a.player);
          return q && { x: q[0], z: -q[1], age: (F - a.frame) / FPS };
        })
        .filter(Boolean),
    );

    drawMarks(kickoff, F, P, markK, DIR.mark);
    strip.showWindow(kickoff, F);

    // ---- the camera: high on the main-stand side, following the ball without chasing every touch; wide before kick-off ----
    if (kickoff) {
      wantPos.set(0, 84, 86);
      wantAim.set(0, 0, 6);
    } else {
      wantPos.set(b[0] * 0.45, 46, 52);
      wantAim.set(b[0] * 0.8, 0, -b[1] * 0.3 + 4);
    }
    // a viewer following one player keeps him in the picture
    const mine = !kickoff && follow.player >= 0 ? drawn(follow.player) : null;
    if (mine) {
      wantPos.set(mine[0], 40, -mine[1] + 34);
      wantAim.set(mine[0], 0, -mine[1] + 4);
    }
    if (DIR.cam) DIR.cam(wantPos, wantAim, b);
    const kk = snap || (!playing && !DIR.cam) || reduce ? 1 : 1 - Math.exp(-dt * 2.4 * Math.min(4, Math.max(1, speed)));
    camPos.lerp(wantPos, kk);
    camAim.lerp(wantAim, kk);
    camera.position.copy(camPos);
    camera.lookAt(camAim);
    camera.updateMatrixWorld();

    // ---- the picture's graphics ----
    const clk = DIR.clock ?? clockAt(Fs),
      sc = DIR.score || M.goals.reduce((s, g) => (g.frame <= Fs ? g.score : s), [0, 0]);
    $('hg').textContent = sc[0];
    $('ag').textContent = sc[1];
    $('clock').textContent = mmss(clk);
    $('seen').textContent = upper(M.event_frames, Fs).toLocaleString('en');
    $('shown').textContent = upper(shownFrames, Fs);
    drawPlates(F, shown, DIR.plain);
    const iv = active('halftime_card', F) || active('fulltime_card', F);
    interval(iv || null, sc);
    const scn = active('scene', F);
    $('replaytag').style.display = scn ? 'flex' : 'none';
    if (scn) $('replaylink').style.display = scn.payload.type === 'closest_attempt' ? 'block' : 'none';

    phone(F, sc, clk, top);
    strip.show(F, Fs);
    snap = false;
    if (DIR.onFrame) DIR.onFrame(F, now);
    renderer.render(scene, camera);
    if (!once) requestAnimationFrame(frame);
  }

  // ---- controls ----
  $('play').onclick = () => {
    if (F >= LAST) seek(0);
    playing = !playing;
    $('play').textContent = playing ? 'Pause' : 'Play';
    last = performance.now();
  };
  $('speed').onclick = () => {
    speed = speed === 1 ? 4 : speed === 4 ? 16 : 1;
    $('speed').textContent = `${speed}x`;
  };
  $('next').onclick = () => {
    const m = moments.find((x) => x.f - 3 * FPS > F + 1);
    if (m) seek(m.f - 3 * FPS);
  };
  $('prev').onclick = () => {
    const m = [...moments].reverse().find((x) => x.f - 3 * FPS < F - 4 * FPS);
    seek(m ? m.f - 3 * FPS : 0);
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      $('play').click();
    }
  });
  if (!playing) $('play').textContent = 'Play';
  watchSize(strip.drawMomentum);
  window.__tempo = { frames: M.frames, moments, seek };
  const api = {
    M,
    FPS,
    LAST,
    DIR,
    seek,
    pos,
    drawn,
    ballAt,
    project,
    levelAt,
    stake,
    timed,
    marks,
    frameAtClock,
    clockAt,
    figs,
    ball,
    drawPitch,
    getF: () => F,
    setPlaying: (v) => {
      playing = v;
      last = performance.now();
    },
    setSpeed: (v) => {
      speed = v;
    },
    snapCamera: () => {
      snap = true;
    },
  };
  if (Q.get('bench')) {
    // times the drawing itself, so it works in a hidden or throttled tab
    const gl = renderer.getContext(),
      px = new Uint8Array(4),
      ms = [];
    playing = true;
    seek(frameAtClock(49 * 60));
    for (let i = 0; i < 46; i++) {
      const t0 = performance.now();
      frame(last + 33.3, true);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 6) ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    window.__tempo.bench = {
      median_ms: +ms[20].toFixed(1),
      p95_ms: +ms[37].toFixed(1),
      draw_calls: renderer.info.render.calls,
    };
    playing = false;
    $('play').textContent = 'Play';
  }
  requestAnimationFrame(frame);
  // the film is fetched only when it is asked for, through the page's module lists like everything else (see index.html)
  if (TOUR) {
    document.body.classList.add('tour');
    (await window.loadModules('film')).run(api);
  }
  if (wantIntro)
    intro.then(() => {
      const o = $('intro');
      o.style.opacity = 0;
      setTimeout(() => o.remove(), 600);
      playing = true;
      last = performance.now();
      $('play').textContent = 'Pause';
    });
}
main().catch((e) => fail(`Something went wrong while building the scene: ${e.message}`));
