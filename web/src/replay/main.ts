// Tempo replay: the closest earlier attempt and then the goal, one at a time, on the same dark pitch as the live view.
// Everything on screen comes from runs/<match>/scenes.json, which the pipeline writes. Nothing here invents a number.
// Solid markers are the attempt being shown. Outlined markers are where the earlier attempt ended, left behind while the goal plays.
//
// ?t= opens paused at a moment, ?from= starts playing from one, ?wait= holds the first picture still for that long (so the
// film can fade it in before it moves), ?turn=-1 turns the clips back to the way the match was played, and ?bare drops
// the controls and the caption for showing inside the product film.
import * as THREE from 'three';
import '../styles/replay.css';
import { renderer, scene, camera, KITS, crestUrl, FONT, mountStage } from '../shared/stage.ts';
import { Marker } from '../shared/marker.ts';
import { makeBall, makePulses } from '../shared/shapes.ts';
import { $, site, lerp, clamp, mmss } from '../shared/util.ts';
import { runnerCamera } from './start.ts';
import { sample, sampleBall, place } from './clip.ts';
import { makeShow, type ShowState } from './show.ts';
import type { Pt } from '../shared/stage.ts';
import type { ReplayScene } from '../types/run.ts';

const MARKUP = `
  <div id="stage"></div>
  <div id="top"><div id="score"><i style="background:var(--home)"></i><img id="hc" hidden width="26" height="26" alt=""><span id="sh"></span><span id="sn"></span><i style="background:var(--away)"></i><img id="ac" hidden width="26" height="26" alt=""><span id="sa"></span><span id="clock"></span></div></div>
  <div id="label"><h1 id="l1"></h1><p id="l2"></p></div>
  <div id="gap"></div>
  <div class="tag" id="tagA"></div><div class="tag" id="tagB"></div>
  <div id="bar"><button id="play">Pause</button><input id="scrub" type="range" min="0" max="1000" value="0" aria-label="Replay position"><span id="phase"></span></div>
  <div id="err"></div>`;

export async function startReplay(Q = new URLSearchParams(location.search)) {
  document.body.innerHTML = MARKUP;
  mountStage($('stage'));
  const RUN = Q.get('run') || 'm_demo',
    FIXED_T = Q.get('t'),
    FROM = Q.get('from'),
    WAIT = parseFloat(Q.get('wait') || '0');
  if (Q.get('bare')) document.documentElement.classList.add('bare');
  await Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.load(`600 20px ${FONT}`)]).catch(() => {}); // the numbers on the markers are drawn once, so the face must be in
  const scenes = await fetch(site(`runs/${RUN}/scenes.json`), { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error('run');
      return r.json() as Promise<ReplayScene[]>;
    })
    .catch(() => null);
  if (!scenes) throw new Error('Could not load the match. Run `uv run tempo run` to write it, then reload.');
  if (!scenes.length) throw new Error('This match has no replay scene: no goal had a close enough earlier attempt.');
  const S = scenes[0]!,
    G = S.clips.goal,
    E = S.clips.earlier,
    N = S.ids.length;
  $('sh').textContent = S.home;
  $('sa').textContent = S.away;
  for (const [id, short] of [
    ['hc', S.home],
    ['ac', S.away],
  ] as const) {
    const url = crestUrl(short),
      img = $<HTMLImageElement>(id);
    if (url) {
      img.src = url;
      img.hidden = false;
      (img.previousElementSibling as HTMLElement).hidden = true;
    }
  }

  const live: Marker[] = [],
    ghosts: Marker[] = [];
  for (let i = 0; i < N; i++) {
    const kit = { ...KITS[S.team[i] ? 1 : 0] };
    if (S.numbers[i] === 1) kit.shirt = kit.keeper;
    const fig = new Marker({ number: S.numbers[i]!, kit }),
      ghost = new Marker({ number: S.numbers[i]!, kit, ghost: true });
    live.push(fig);
    ghosts.push(ghost);
    scene.add(fig.group, ghost.group);
  }
  const ball = makeBall(),
    pulses = makePulses();
  scene.add(ball.group);

  // the measured gap between where he stood then and where he stands now
  const gapGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const gapLine = new THREE.Line(
    gapGeo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false }),
  );
  gapLine.renderOrder = 6;
  scene.add(gapLine);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const rings = [0, 1].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 48), ringMat);
    r.rotation.x = -Math.PI / 2;
    r.position.y = 0.03;
    r.renderOrder = 6;
    scene.add(r);
    return r;
  });

  // The film shows the pitch the way the match was played; the clips are stored turned to run one way. ?turn=-1 turns them back.
  if (Q.get('turn') === '-1')
    for (const C of [G, E]) {
      for (const row of C.pos)
        for (const q of row)
          if (q && q[0] != null && q[1] != null) {
            q[0] = -q[0];
            q[1] = -q[1];
          }
      for (const q of C.ball) {
        q[0] = -q[0]!;
        q[1] = -q[1]!;
      }
    }

  const { TOTAL, marks, at, COPY, PHASE, who, scorer, es, em, dirx } = makeShow(S);

  // What the earlier attempt came to: the runner's path as dots on the grass, and (drawn with the outlined markers) where the runner and the man who stepped in stood at the end.
  const dotMat = new THREE.MeshBasicMaterial({
    color: KITS[S.team[scorer] ? 1 : 0].line,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  {
    let lastP: Pt | null = null;
    for (let f = es; f <= em; f++) {
      const q = sample(E, f, scorer);
      if (!q || (lastP && Math.hypot(q[0] - lastP[0], q[1] - lastP[1]) < 0.9)) continue;
      lastP = q;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), dotMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(q[0], 0.025, -q[1]);
      d.renderOrder = 1;
      scene.add(d);
    }
  }
  const endOf = [scorer, who].map((i) => sample(E, em, i));

  const camPos = new THREE.Vector3(0, 40, 80),
    camAim = new THREE.Vector3(),
    wantPos = new THREE.Vector3(),
    wantAim = new THREE.Vector3(),
    v = new THREE.Vector3();
  let T =
      FIXED_T !== null
        ? Math.min(parseFloat(FIXED_T), TOTAL - 0.01)
        : FROM !== null
          ? Math.min(parseFloat(FROM), TOTAL - 0.01)
          : 0,
    playing = FIXED_T === null,
    last = performance.now(),
    firstFrame = true,
    began: number | null = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stand = (fig: Marker, src: ShowState, i: number, dt: number, rate: number): Pt | null => {
    // one marker, on a clip or part of the way between two
    const p = place(fig, src.a[0], src.a[1], i, dt, rate);
    if (!src.b || !p) return p;
    const q = sample(src.b[0], src.b[1], i);
    if (!q) return p;
    const m: Pt = [lerp(p[0], q[0], src.u), lerp(p[1], q[1], src.u)];
    fig.group.position.set(m[0], 0, -m[1]);
    return m;
  };

  function frame(now: number, once = false) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (began === null) began = now;
    if (playing && now - began >= WAIT * 1000) {
      T += dt;
      if (T >= TOTAL) {
        T = TOTAL - 0.001;
        playing = false;
        $('play').textContent = 'Replay';
      }
    }
    const s = at(T),
      run = playing ? s.rate : 0;
    let pw: Pt | null = null,
      ps: Pt | null = null;
    for (let i = 0; i < N; i++) {
      const p = stand(live[i]!, s, i, dt, run);
      if (i === who) pw = p;
      if (i === scorer) ps = p;
      const g = ghosts[i]!,
        k = [scorer, who].indexOf(i),
        q = k >= 0 ? endOf[k] : null; // only two outlines are ever drawn
      if (!q || s.ghost <= 0.001) {
        g.setOpacity(0);
        continue;
      }
      g.group.visible = true;
      g.group.position.set(q[0], 0, -q[1]);
      g.update(dt, 0, 0);
      g.setOpacity(s.ghost * (p ? clamp((Math.hypot(p[0] - q[0], p[1] - q[1]) - 0.5) / 1.0) : 1)); // an outline lying on its own man would only blur him
    }
    // while the one distance is measured, the runner steps back so the man and his outline can be seen
    live[scorer]!.setOpacity(1 - 0.7 * (s.gap ?? 0));
    const ba = sampleBall(s.a[0], s.a[1]),
      bq = s.b ? sampleBall(s.b[0], s.b[1]) : ba,
      b = ba.map((x, j) => lerp(x, bq[j]!, s.u)) as [number, number, number];
    ball.set(b[0], b[2], -b[1]);
    dotMat.opacity = 0.9 * s.ghost;
    live[who]!.setStake(s.card, s.card); // his card is the thing that is there the second time
    const C = s.a[0],
      cf = s.a[1];
    pulses(
      s.b
        ? []
        : C.actions
            .filter((a) => cf >= a.frame && cf < a.frame + 11)
            .map((a) => {
              const q = sample(C, a.frame, a.player);
              return q && { x: q[0], z: -q[1], age: (cf - a.frame) / 25 };
            }),
    );
    // the gap: where he stood at this moment the first time, and where he stands now
    const pg = endOf[1] ?? null,
      on = pw && pg && s.gap ? s.gap : 0;
    gapLine.material.opacity = on;
    ringMat.opacity = on * 0.9;
    if (pw && pg) {
      gapGeo.setFromPoints([new THREE.Vector3(pw[0], 0.05, -pw[1]), new THREE.Vector3(pg[0], 0.05, -pg[1])]);
      rings[0]!.position.set(pw[0], 0.03, -pw[1]);
      rings[1]!.position.set(pg[0], 0.03, -pg[1]);
    }
    // camera: always from the main-stand side and high enough that every marker and number reads
    if (s.ph === 'diff' && pw && pg) {
      const mx = (pw[0] + pg[0]) / 2,
        mz = -(pw[1] + pg[1]) / 2;
      wantPos.set(mx, 31, mz + 29);
      wantAim.set(mx, 0, mz + 3);
    } else if (s.ph === 'finish' || s.ph === 'hold') {
      wantPos.set(b[0] - 3 * dirx, 32, 34 - b[1] * 0.3);
      wantAim.set(dirx > 0 ? Math.min(b[0] + 2, 47) : Math.max(b[0] - 2, -47), 0, -b[1] * 0.5 + 7);
    } else {
      runnerCamera(wantPos, wantAim, ps || [0, 0], dirx);
    }
    const kk = firstFrame || !playing || reduce ? 1 : 1 - Math.exp(-dt * 2.1);
    camPos.lerp(wantPos, kk);
    camAim.lerp(wantAim, kk);
    firstFrame = false;
    camera.position.copy(camPos);
    camera.lookAt(camAim);
    // words: every number here is read from the run
    const [h, p2] = COPY[s.ph]();
    if ($('l1').textContent !== h) $('l1').textContent = h;
    if ($('l2').textContent !== p2) $('l2').textContent = p2;
    $('phase').textContent = PHASE[s.ph];
    $('clock').textContent = mmss(s.clock);
    if (parent !== window)
      parent.postMessage(
        { tempoReplay: { clock: s.clock, phase: s.ph, scored: s.a[0] === G && s.a[1] >= G.shot_offset + 19 } },
        location.origin,
      ); // inside the film, the film's own scoreboard shows which minute this is
    const proj = (x: number, y: number, z: number, el: HTMLElement, txt: string | null, show: number) => {
      v.set(x, y, z).project(camera);
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      el.style.opacity = String(show);
      if (txt !== null) el.textContent = txt;
    };
    if (pw && pg) {
      proj((pw[0] + pg[0]) / 2, 0.1, -(pw[1] + pg[1]) / 2 - 2.4, $('gap'), `${S.differing_by_m.toFixed(1)} m`, on);
      proj(pg[0], 0.1, -pg[1] + 2.6, $('tagA'), `Minute ${E.minute}`, on);
      proj(pw[0], 0.1, -pw[1] + 2.6, $('tagB'), `Minute ${G.minute}`, on);
    } else {
      $('gap').style.opacity = '0';
      $('tagA').style.opacity = '0';
      $('tagB').style.opacity = '0';
    }
    const scrub = $<HTMLInputElement>('scrub');
    if (document.activeElement !== scrub) scrub.value = String(Math.round((T / TOTAL) * 1000));
    renderer.render(scene, camera);
    if (!once) requestAnimationFrame(frame);
  }
  $('play').onclick = () => {
    if (T >= TOTAL - 0.01) T = 0;
    playing = !playing;
    $('play').textContent = playing ? 'Pause' : 'Play';
    last = performance.now();
  };
  $<HTMLInputElement>('scrub').oninput = (e) => {
    T = (Number((e.target as HTMLInputElement).value) / 1000) * TOTAL;
    playing = false;
    $('play').textContent = 'Play';
  };
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      $('play').click();
    }
  });
  if (!playing) $('play').textContent = 'Play';
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', fit);
  fit();
  window.__replay = { TOTAL, marks };
  // ?bench=1 times the drawing itself: 40 frames back to back, each forced to finish on the graphics card by reading a pixel.
  // It does not depend on how often the browser offers a frame, so it works in a hidden or throttled tab.
  if (Q.get('bench')) {
    const gl = renderer.getContext(),
      px = new Uint8Array(4),
      ms: number[] = [];
    playing = true;
    T = Math.min(14, TOTAL - 2);
    for (let i = 0; i < 46; i++) {
      const t0 = performance.now();
      frame(last + 33.3, true);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i >= 6) ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const r = renderer.info.render;
    window.__replay.bench = { median_ms: +ms[20]!.toFixed(1), p95_ms: +ms[37]!.toFixed(1), draw_calls: r.calls };
    playing = false;
  }
  requestAnimationFrame((now) => frame(now));
}
