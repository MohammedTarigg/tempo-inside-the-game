// The match view: the whole match on the stage, with everything the pipeline decided to show, where and when it decided it.
// Positions come from runs/<match>/match.bin (25 frames a second) and everything else from match.json. The view decides
// nothing: it draws each cue when the match reaches the frame the cue was issued on.
//
// startMatch(mode) builds the page and starts playing. `fan` is the match as a viewer sees it, `desk` the same match with
// the producer's desk in place of the phone, and `film` hands the picture to the product film, which directs it through the
// returned API and the Director hooks.
import * as THREE from 'three';
import '../styles/match.css';
import { playIntro } from '../brand/intro.ts';
import {
  renderer,
  scene,
  camera,
  KITS,
  project,
  watchSize,
  spread,
  facing,
  FONT,
  drawPitch,
  mountStage,
} from '../shared/stage.ts';
import { Marker } from '../shared/marker.ts';
import { makeBall, makePulses } from '../shared/shapes.ts';
import { $, lerp, upper, mmss } from '../shared/util.ts';
import { loadMatch, type ShownMark } from './data.ts';
import { cuesSoFar, liveService, subscribe } from './live.ts';
import { mountMatchPage, ICONS } from './markup.ts';
import { pin, place } from './pins.ts';
import { makeKickoffMarks, type HeldMark } from './marks.ts';
import { makePlates } from './plates.ts';
import { makeStrip } from './strip.ts';
import { makePhone, type TopStake } from './phone.ts';
import { makeFollow } from './follow.ts';
import { makeInterval } from './cards.ts';
import { makeDesk } from './desk.ts';
import { present } from './presence.ts';
import type { Pin } from '../types/run.ts';

// the play button shows what pressing it does now: play, pause, or play the match again from the start
function setPlay(s: 'Play' | 'Pause' | 'Replay') {
  const b = $('play');
  b.innerHTML = ICONS[s];
  b.setAttribute('aria-label', s);
}

export type Mode = 'fan' | 'desk' | 'film';
type Ball = [number, number, number];

// Hooks for a director: its own camera, a call every frame, the players to keep bright, a kick-off mark to hold up, a
// blend from an earlier moment, a time and a score for the scoreboard to show in place of its own, and `plain` to draw the
// players and the ball with none of the match view's own marks, tags or labels.
export interface Director {
  cam: ((wantPos: THREE.Vector3, wantAim: THREE.Vector3, ball: Ball) => void) | null;
  onFrame: ((F: number, now: number) => void) | null;
  focus: Set<number> | null;
  mark: HeldMark | null;
  blend: { from: number; k: number } | null;
  clock: number | null;
  score: number[] | null;
  plain: boolean;
}

export type MatchApi = Awaited<ReturnType<typeof startMatch>>;

export async function startMatch(mode: Mode, Q = new URLSearchParams(location.search)) {
  mountMatchPage(document.body);
  mountStage($('stage'));
  const FILM = mode === 'film';
  if (mode === 'desk') document.body.classList.add('desk');
  // The intro plays over the picture while the match loads, unless the page was opened at a particular moment.
  const wantIntro =
    mode === 'fan' && Q.get('intro') !== '0' && !['f', 't', 'm', 'bench'].some((k) => Q.get(k) !== null);
  const intro = wantIntro ? playIntro($('intro')) : Promise.resolve(null);
  if (!wantIntro && !FILM) $('intro').remove();
  await Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.load(`600 20px ${FONT}`)]).catch(() => {}); // the numbers on the markers are drawn once, so the face must be in
  // a live screen: cues from the live service, the picture from the run (live.ts)
  const service = liveService(Q.get('live')),
    push = service ? subscribe(service) : null;
  const match = await loadMatch(Q.get('run') || 'm_demo', service ? await cuesSoFar(service) : undefined);
  if (match && push) push.attach(match);
  if (!match) throw new Error('Could not load the match. Run `uv run tempo run` to write it, then reload.');
  const {
    M,
    N,
    FPS,
    LAST,
    name,
    index,
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
  // the scorebug names each club by its code, with the club's colour as that end of the bar
  for (const [id, club] of [
    ['hs', M.home],
    ['as', M.away],
  ] as const) {
    $(id).textContent = club.short;
    $(id).title = club.name;
  }
  // ---- the players, the ball, and the shapes drawn on the pitch ----
  const figs = M.ids.map((_, i) => {
    const kit = { ...KITS[M.team[i] ? 1 : 0] };
    if (M.numbers[i] === 1) kit.shirt = kit.keeper;
    const fig = new Marker({ number: M.numbers[i]!, kit });
    scene.add(fig.group);
    return fig;
  });
  const ball = makeBall(),
    pulses = makePulses();
  scene.add(ball.group);
  const state = stake.map((s) => (s.f.length ? { k: 0, full: 0 } : null));
  const names = state.map((s, i) =>
    s ? Object.assign(pin('name'), { textContent: `${name(M.ids[i]!)} ${M.numbers[i]}` }) : null,
  );
  // The scorebug's eye. It looks straight out; when something about the match as a whole happens it turns to the side
  // it is about and the words are written on under that half: a side on top, a booking, a goal (the eye blinks as the
  // score rolls over, in the scorer's colour). What it says comes from the run's own label cues and the match record.
  const bugSay = $('bsay'),
    bugSpot = $('bspot');
  let bugKey = '';
  const sideOf = (text: string) => {
    if (text.startsWith(M.home.name)) return 0;
    if (text.startsWith(M.away.name)) return 1;
    const i = M.ids.findIndex((pid) => text.startsWith(name(pid)));
    return i >= 0 ? M.team[i]! : -1;
  };
  function bug(F: number) {
    const g = M.goals.find((x) => F >= x.frame && F < x.frame + 4 * FPS),
      lab = DIR.plain ? undefined : active('label', F);
    let side = -1,
      words = '',
      card = false,
      blink = false;
    if (g) {
      side = M.team[index(g.player)]!;
      words = name(g.player);
      blink = F < g.frame + 0.5 * FPS;
    } else if (lab) {
      side = sideOf(lab.payload.text);
      words = side >= 0 ? lab.payload.text : '';
      card = / booked$/.test(words);
      if (card) words = words.replace(/ booked$/, ''); // the card says it
    }
    $('board').classList.toggle('scored', !!g);
    $('board').dataset.side = String(side);
    bugSpot.style.transform = `translateX(${side < 0 ? 0 : side ? 4.5 : -4.5}px) scaleY(${blink ? 0.12 : 1})`;
    const key = words ? `${side}|${words}` : '';
    if (key !== bugKey) {
      bugKey = key;
      bugSay.classList.remove('on');
      if (words) {
        bugSay.querySelector('span')!.textContent = words;
        bugSay.classList.toggle('card', card);
        void bugSay.offsetWidth;
        bugSay.classList.add('on');
      }
    }
  }
  const drawPlates = makePlates(match),
    drawMarks = makeKickoffMarks(match, FILM);
  // A turning point played again from the full-time chart: from its first frame to its last at normal speed, then back to
  // full time. Moving the playhead any other way ends it.
  let recap: { pin: Pin; end: number } | null = null;
  const replay = (p: Pin) => {
    const [from = p.t, to = p.t] = p.play;
    seek(frameAtClock(from));
    recap = { pin: p, end: frameAtClock(to) };
    playing = true;
    speed = 1;
    $('speed').textContent = '1x';
    setPlay('Pause');
    last = performance.now();
  };
  const strip = makeStrip(match, {
      seek: (f) => {
        recap = null;
        seek(f);
      },
      getF: () => F,
      replay,
    }),
    lateSpan = strip.lateSpan,
    interval = makeInterval(M),
    follow = makeFollow(match, Q),
    phone = makePhone(match, follow),
    desk = mode === 'desk' ? makeDesk(match) : null,
    fullAt = timed.find((c) => c.form === 'fulltime_card')?.start ?? Infinity;

  // ---- playback ----
  camera.fov = 30;
  const camPos = new THREE.Vector3(0, 46, 52),
    camAim = new THREE.Vector3(),
    wantPos = new THREE.Vector3(),
    wantAim = new THREE.Vector3();
  // where to open: ?f= a frame, ?t= seconds of footage, ?m= the match clock in minutes
  const asked = (k: string) => (Q.get(k) === null ? null : Number(Q.get(k)));
  const f0 = asked('f'),
    t0 = asked('t'),
    m0 = asked('m');
  const start = f0 ?? (t0 !== null ? t0 * FPS : m0 !== null ? frameAtClock(m0 * 60) : null);
  let F = start !== null ? Math.min(Math.max(0, start), LAST) : 0,
    playing = start === null && !wantIntro && !FILM,
    speed = 1,
    last = performance.now(),
    snap = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Hooks for a director: its own camera, a call every frame, the players to keep bright, a kick-off mark to hold up, a
  // blend from an earlier moment, a time and a score for the scoreboard to show in place of its own, and `plain` to draw the
  // players and the ball with none of the match view's own marks, tags or labels.
  const DIR: Director = {
    cam: null,
    onFrame: null,
    focus: null,
    mark: null,
    blend: null,
    clock: null,
    score: null,
    plain: false,
  };
  const seek = (f: number, soft = false) => {
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
  const mixed = <T extends number[]>(now: T | null, was: T | null, k: number): T | null =>
    now && was ? (now.map((v, j) => lerp(was[j]!, v, k)) as T) : k > 0.5 ? now : was;
  const drawn = (i: number) => (DIR.blend ? mixed(pos(F, i), pos(DIR.blend.from, i), DIR.blend.k) : pos(F, i));

  function frame(now: number, once = false) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      F += dt * FPS * speed;
      if (recap && F >= recap.end) {
        recap = null;
        seek(LAST);
        playing = false;
        setPlay('Replay');
      } else if (F >= LAST) {
        F = LAST;
        playing = false;
        setPlay('Replay');
      }
    }
    const rate = playing ? speed : 0,
      b: Ball = DIR.blend ? mixed(ballAt(F), ballAt(DIR.blend.from), DIR.blend.k)! : ballAt(F),
      Fs = DIR.blend ? lerp(DIR.blend.from, F, DIR.blend.k) : F,
      P = span(F),
      kickoff: ShownMark | undefined = DIR.mark
        ? marks[DIR.mark.i]
        : marks.find((c) => F >= c.start && F < c.end) ||
          (lateSpan && lateMark && F >= lateSpan[0] && F < lateSpan[0] + 8 * FPS
            ? { ...lateMark, start: lateSpan[0], end: lateSpan[0] + 8 * FPS, again: true }
            : undefined),
      markK = (c: ShownMark, sec: number) => (DIR.mark ? DIR.mark.k : fade(c, F, sec));
    let top: TopStake | null = null;
    const shown = spread(figs.map((_, i) => drawn(i))); // players in contact overlap, as bodies do; they are only kept from hiding each other completely
    // what contact is doing to each body right now: a quick give at the instant of a challenge, and a spell on the ground after a foul
    const hit = new Float32Array(N),
      down = new Float32Array(N);
    for (let k = upper(actFrames, F - 0.5 * FPS); k < upper(actFrames, F); k++) {
      const a = acts[k]!,
        age = (F - a.frame) / FPS,
        v = Math.exp(-7 * age) * Math.cos(20 * age);
      hit[a.player] = v;
      if (a.other !== undefined) hit[a.other] = v;
    }
    for (let k = upper(downFrames, F - 4 * FPS); k < upper(downFrames, F); k++) {
      const a = downs[k]!,
        age = (F - a.frame) / FPS,
        lie = a.seconds ?? 0;
      if (age < lie + 0.4) down[a.player] = Math.min(1, age / 0.18, (lie + 0.4 - age) / 0.4);
    }
    for (let i = 0; i < N; i++) {
      const fig = figs[i]!,
        p = shown[i],
        tagged = names[i];
      if (!p) {
        fig.group.visible = false;
        if (tagged) tagged.style.opacity = '0';
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
      fig.setBody(hit[i]!, down[i]!);
      {
        const layer = (40 - p[1]) / 800;
        if (Math.abs(layer - fig.layerNow) > 0.002) fig.order(layer);
      } // the nearer man is drawn over the further one
      let d = facing(p[0], p[1], vx, vy, b[0], b[1]) - fig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // he watches the ball
      fig.yaw += d * (rate && !snap ? Math.min(1, 0.2 * speed) : 1);
      fig.turn.rotation.y = fig.yaw;
      if (sp > 0.5) fig.motion.rotation.y = Math.atan2(vx, -vy);
      fig.update(dt, sp, rate);
      const u = state[i];
      if (u && tagged) {
        const [lvl, chance] = levelAt(i, F);
        const ifBooked =
          kickoff && kickoff.payload.mark === 'zone' && kickoff.payload.subject === M.ids[i] ? markK(kickoff, 0.35) : 0; // "if he is booked": the outline, before anything has happened
        const step = reduce || !playing || snap ? 1 : 1 - Math.exp(-dt * 9);
        u.k += ((lvl > 0 ? 1 : 0) - u.k) * step;
        u.full += ((lvl === 2 ? 1 : 0) - u.full) * step;
        fig.setStake(DIR.plain ? 0 : Math.max(u.k, ifBooked), u.full, 0.5 + 0.5 * Math.sin(now / 160));
        place(
          tagged,
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
      acts.slice(k0, k1).map((a) => {
        const q = pos(a.frame, a.player);
        return q && { x: q[0], z: -q[1], age: (F - a.frame) / FPS };
      }),
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
      sc = DIR.score ?? M.goals.reduce((s: number[], g) => (g.frame <= Fs ? g.score : s), [0, 0]);
    $('hg').textContent = String(sc[0]);
    $('ag').textContent = String(sc[1]);
    bug(F);
    $('clock').textContent = mmss(clk);
    $('seen').textContent = upper(M.event_frames, Fs).toLocaleString('en');
    $('shown').textContent = String(upper(shownFrames, Fs));
    // the producer's funnel: the whole line is everything the feed sent, the white sliver what reached the screen
    $('sieve').style.width = `${(100 * upper(shownFrames, Fs)) / Math.max(1, upper(M.event_frames, Fs))}%`;
    drawPlates(F, shown, DIR.plain);
    interval(active('halftime_card', F) || null, sc);
    strip.rise(!DIR.plain && (recap !== null || F >= fullAt), recap ? recap.pin : null);
    const scn = active('scene', F);
    present($('replaytag'), !!scn, 'flex');
    if (scn) $('replaylink').style.display = scn.payload.type === 'closest_attempt' ? 'block' : 'none';

    phone(F, sc, clk, top);
    if (desk) desk(Fs);
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
    setPlay(playing ? 'Pause' : 'Play');
    last = performance.now();
  };
  $('speed').onclick = () => {
    speed = speed === 1 ? 4 : speed === 4 ? 16 : 1;
    $('speed').textContent = `${speed}x`;
  };
  $('next').onclick = () => {
    recap = null;
    const m = moments.find((x) => x.f - 3 * FPS > F + 1);
    if (m) seek(m.f - 3 * FPS);
  };
  $('prev').onclick = () => {
    recap = null;
    const m = [...moments].reverse().find((x) => x.f - 3 * FPS < F - 4 * FPS);
    seek(m ? m.f - 3 * FPS : 0);
  };
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      $('play').click();
    }
  });
  if (!playing) setPlay('Play');
  watchSize(strip.drawMomentum);
  window.__tempo = { frames: M.frames, moments, seek };
  const api = {
    match,
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
    setPlaying: (v: boolean) => {
      playing = v;
      last = performance.now();
    },
    setSpeed: (v: number) => {
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
      ms: number[] = [];
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
      median_ms: +ms[20]!.toFixed(1),
      p95_ms: +ms[37]!.toFixed(1),
      draw_calls: renderer.info.render.calls,
    };
    playing = false;
    setPlay('Play');
  }
  requestAnimationFrame((now) => frame(now));
  if (FILM) document.body.classList.add('tour');
  if (wantIntro)
    void intro.then(() => {
      const o = $('intro');
      o.style.opacity = '0';
      setTimeout(() => o.remove(), 600);
      playing = true;
      last = performance.now();
      setPlay('Pause');
    });
  return api;
}
