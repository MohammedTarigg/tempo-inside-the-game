// The film's sixth feature, Called it: the three things said at kick-off come back as pictures and turn solid.
import { svgEl, seg, lerp, smooth, outCubic } from '../../shared/util.ts';
import { callLine, hull, goalBox } from '../furniture.ts';
import { setOff } from '../../replay/start.ts';
import type { Pt } from '../../shared/stage.ts';
import type { Cam } from '../bridge.ts';
import type { Call, Clip } from '../../types/run.ts';
import type { FilmCtx, Scene } from '../film.ts';

type XY = [number, number];
// player i in frame j of a replay clip, in metres; a man off the pitch reads as the centre spot
const inClip = (C: Clip, j: number, i: number): Pt => {
  const q = C.pos[j]?.[i];
  return [q?.[0] ?? 0, q?.[1] ?? 0];
};

// a value read off a line drawn through [at, value] points
const keyed = (v: number, keys: XY[]) => {
  let i = 0;
  while (i < keys.length - 2 && v > keys[i + 1]![0]) i++;
  const [a, x] = keys[i]!,
    [b2, y] = keys[i + 1]!;
  return lerp(x, y, seg(v, a, b2));
};

// Called it. Before kick-off the film told the viewer three things to watch. Each comes back as a picture, on the
// pitch, with no words on it: the words are the caption's line and nothing else. One rule runs through all three. What
// Tempo said is a yellow outline, what Northgate did is orange, and the outline turns solid at the moment the two meet.
//   1. Where they shoot from: the zone from kick-off, and every shot landing on the spot it was taken from.
//   2. The space round the booked player: first the same run in the earlier attempt, which he stepped in and stopped
//      (outlined markers, as in the replay), then his card, then the run for the goal, which goes straight through.
//   3. Late: the scoreboard is the picture. The clock winds back, runs up, takes the outline at the minute named with
//      the goal it is about, and both turn solid when the ball goes in.
// Every position is the match's own; the two runs are the replay's two clips.
export function calledIt(ctx: FilmCtx): Scene {
  const { api, M, FPS, DIR, D, REPLAY, full, index, wrap, cut, look, caption, swapCall, capLine, over } = ctx;
  // the three calls, which picture is on, and how far that picture has got
  let where: Call | undefined,
    man: Call | undefined,
    late: Call | undefined,
    shown = -1,
    stage = 0,
    c0 = 0;
  // picture 1: the bands of the zone, their outlines and every shot
  let bands: XY[] = [],
    zones: SVGPolygonElement[] = [],
    lanes: SVGLineElement[] = [],
    dots: SVGCircleElement[] = [],
    shots: SVGLineElement[] = [];
  // picture 2 and 3: the frames and positions they are built from, and what they draw
  let R: ReturnType<typeof runs> = null,
    els: ReturnType<typeof drawings> | null = null;
  const drawings = () => ({
    space: svgEl('polygon', { class: 'zone' }, over),
    ghostPath: svgEl('line', { class: 'ghost' }, over),
    stop: svgEl('line', { class: 'stop' }, over),
    trail: svgEl('polyline', { class: 'trail' }, over),
    ghostA: svgEl('circle', { class: 'gring home' }, over),
    ghostB: svgEl('circle', { class: 'gring away' }, over),
    card: svgEl('rect', { class: 'tbook', width: 13, height: 18, rx: 2.5 }, over),
    goal: svgEl('polygon', { class: 'zone' }, over),
    trail3: svgEl('polyline', { class: 'trail' }, over),
  });
  // the two runs from the replay's clips, turned back onto the pitch as it was played
  const runs = () => {
    const G = REPLAY?.clips.goal,
      E = REPLAY?.clips.earlier;
    if (!REPLAY || !G || !E || !man) return null;
    const sc = REPLAY.ids.indexOf(REPLAY.scorer),
      dp = REPLAY.ids.indexOf(REPLAY.differing_player),
      si = index(REPLAY.scorer),
      di = index(REPLAY.differing_player);
    // where the runner sets off
    const moved = (C: Clip) => setOff(C, sc);
    const base = api.frameAtClock(G.clock),
      A = base + moved(G),
      S = base + G.shot_offset,
      at: Pt = api.pos(S, si) ?? [1, 0];
    const sgn = Math.sign(at[0] * inClip(G, G.shot_offset, sc)[0]) || 1,
      dir = Math.sign(at[0]) || 1; // the clips are turned to run one way; this turns them back onto the pitch
    const j0 = moved(E);
    let j1 = j0,
      best = 1e9; // the earlier run ends where the two of them meet
    for (let j = j0; j < Math.min(E.pos.length, j0 + 150); j++) {
      const a = inClip(E, j, sc),
        b = inClip(E, j, dp),
        d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d < best) {
        best = d;
        j1 = j;
      }
    }
    const c = api.pos(A, di) ?? [0, 0],
      card = M.cards.find((k) => k.player === REPLAY.differing_player || index(k.player) === di),
      goal = M.goals[M.goals.length - 1],
      from = late?.window?.[0];
    return {
      A,
      S,
      si,
      di,
      sc,
      dp,
      sgn,
      dir,
      E,
      j0,
      j1,
      box: [c[0] - 8, c[1] - 7, c[0] + 8, c[1] + 7] as const,
      from: api.pos(A, si) ?? at,
      shot: at,
      e0: E.clock + j0 / 25,
      e1: E.clock + j1 / 25,
      cardT: card ? api.clockAt(card.frame) : (REPLAY.booked_minute ?? 0) * 60,
      aT: api.clockAt(A),
      f60: api.frameAtClock((from !== undefined ? from - 10 : 60) * 60),
      f70: api.frameAtClock((from ?? 70) * 60),
      goalF: goal ? goal.frame : S,
    };
  };
  // When a call comes true its outline fills, from the side the attack came from to the far side, in half a second. Each
  // area gets its own gradient whose edge is moved along; leftToRight is the attack's way across the screen.
  const sweeps = new Map<SVGPolygonElement, { a: SVGStopElement; b: SVGStopElement; t0: number }>();
  let defs: SVGDefsElement | null = null;
  const fillFrom = (poly: SVGPolygonElement, on: boolean, leftToRight: boolean) => {
    let s = sweeps.get(poly);
    if (!s) {
      defs ??= svgEl('defs', {}, over);
      const id = `tsweep${sweeps.size}`,
        g = svgEl('linearGradient', { id, x1: leftToRight ? 0 : 1, x2: leftToRight ? 1 : 0, y1: 0, y2: 0 }, defs);
      s = {
        a: svgEl('stop', { offset: 0, 'stop-opacity': 0.5 }, g),
        b: svgEl('stop', { offset: 0, 'stop-opacity': 0 }, g),
        t0: -1,
      };
      s.a.style.stopColor = s.b.style.stopColor = 'var(--card)';
      sweeps.set(poly, s);
      poly.style.fill = `url(#${id})`; // over the sheet's plain fill
    }
    if (on && s.t0 < 0) s.t0 = performance.now();
    if (!on) s.t0 = -1;
    const p = s.t0 < 0 ? 0 : outCubic(Math.min(1, (performance.now() - s.t0) / 520));
    s.a.setAttribute('offset', p.toFixed(3));
    s.b.setAttribute('offset', p.toFixed(3));
  };
  return {
    dur: D[6]!,
    cutIn: true, // from the replay to the whole pitch at full time: the one real cut in the film
    enter() {
      cut(api.LAST - 3 * FPS, 0.25, (wantPos, wantAim) => {
        wantPos.set(0, 94, 96.5);
        wantAim.set(0, 0, 6);
      });
      DIR.focus = new Set([-1]);
      look(null);
      const calls = full?.payload.calls ?? [],
        by = (m: Call['mark']) => calls.find((c) => c.mark === m);
      where = by('channels');
      man = by('zone');
      late = by('window');
      shown = -1;
      stage = 0;
      DIR.plain = true; // the pictures are the only marks on the pitch
      caption('7', 'Called it', callLine(where ? where.said : 'Three calls from kick-off'), [
        ['log', 'From the match record'],
      ]);
      over.replaceChildren();
      sweeps.clear();
      defs = null;
      zones = [];
      lanes = [];
      dots = [];
      shots = [];
      if (where) {
        // the zone, as it was drawn at kick-off, and every shot on the spot it was taken from
        bands =
          where.zone === 'wide'
            ? [
                [12.2, 33],
                [-33, -12.2],
              ]
            : [[-12.2, 12.2]];
        zones = bands.map(() => svgEl('polygon', { class: 'zone lane' }, over));
        lanes = bands.flatMap(() => [
          svgEl('line', { class: 'laneline' }, over),
          svgEl('line', { class: 'laneline' }, over),
        ]);
        shots = where.points.map((q) => svgEl('line', { class: q.inside ? 'shotline in' : 'shotline' }, over));
        dots = where.points.map((q) => svgEl('circle', { class: q.inside ? 'shot in' : 'shot', r: 0 }, over));
      }
      R = runs();
      els = R ? drawings() : null;
    },
    update(u) {
      const CUTS = [0, 0.245, 0.69, 1] as const,
        k = u < CUTS[1] ? 0 : u < CUTS[2] ? 1 : 2,
        v = (u - CUTS[k]) / (CUTS[k + 1] - CUTS[k]);
      const xy = (x: number, y: number, h = 0): XY => {
          const q = api.project(x, h, -y);
          return [q[0], q[1]];
        },
        pts = (a: XY[]) => a.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '); // placed afresh each frame: the camera moves
      const halfCam =
        (x: number, height: number, back2: number): Cam =>
        (wantPos, wantAim) => {
          wantPos.set(x, height, back2);
          wantAim.set(x, 0, 5);
        };
      if (k !== shown) {
        // each picture sets its own stage
        const first = shown < 0;
        shown = k;
        stage = 0;
        DIR.clock = null;
        document.body.classList.remove('tbig', 'tlate', 'tgoal');
        if (k === 1 && R) {
          c0 = api.clockAt(api.getF());
          DIR.blend = { from: api.getF(), k: 0 };
          api.seek(R.A, true);
          api.setPlaying(false);
          DIR.focus = new Set([R.si, R.di]);
          DIR.cam = halfCam(R.dir * 25, 56, 60);
        }
        if (k === 2 && R) {
          DIR.blend = { from: api.getF(), k: 0 };
          api.seek(R.f60, true);
          api.setPlaying(false);
          DIR.focus = new Set([-1]);
          DIR.cam = halfCam(R.dir * 40, 50, 56);
          document.body.classList.add('tbig');
        }
        const said = [where, man, late][k];
        if (said && !(first && k === 0)) {
          if (first) {
            capLine.replaceChildren(...callLine(said.said));
            capLine.className = 'tcall';
          } else swapCall(said.said);
        }
        if (first && k > 0) api.snapCamera();
      }
      let done = false;
      const W = where,
        fade = Math.min(seg(v, 0.02, 0.14), 1 - seg(v, 0.9, 0.99)),
        onPitch = k === 0 ? fade : 0;
      if (W) {
        let landed = 0;
        dots.forEach((d, i) => {
          const q = W.points[i]!,
            [x, y] = xy(q.x ?? 0, q.y ?? 0),
            a = k === 0 ? outCubic(seg(v, 0.14 + i * 0.03, 0.26 + i * 0.03)) : 1;
          d.setAttribute('cx', x.toFixed(1));
          d.setAttribute('cy', y.toFixed(1));
          d.setAttribute('r', String((q.inside ? 5 : 4) * Math.min(1, a * 3)));
          d.style.opacity = String(onPitch);
          // the shot itself, drawn from where it was struck towards the goal mouth
          const [gx, gy] = xy(52.5, Math.max(-3, Math.min(3, (q.y ?? 0) * 0.2))),
            ln = shots[i]!;
          ln.setAttribute('x1', x.toFixed(1));
          ln.setAttribute('y1', y.toFixed(1));
          ln.setAttribute('x2', (x + (gx - x) * a).toFixed(1));
          ln.setAttribute('y2', (y + (gy - y) * a).toFixed(1));
          ln.style.opacity = String(onPitch * Math.min(1, a * 4));
          if (a > 0.5) landed++;
        });
        done = k === 0 && landed === W.points.length && W.came_true === true && v < 0.96;
        zones.forEach((z, j) => {
          const [a, b] = bands[j]!,
            corners: XY[] = [
              [24, a],
              [51, a],
              [51, b],
              [24, b],
            ];
          z.setAttribute('points', pts(corners.map(([x, y]) => xy(x, y))));
          z.style.opacity = String(onPitch);
          // the channel's two edges, drawn from halfway towards goal as the picture opens
          const grow = outCubic(seg(v, 0.02, 0.14));
          [a, b].forEach((edge, e) => {
            const ln = lanes[2 * j + e]!,
              [x1, y1] = xy(24, edge),
              [x2, y2] = xy(24 + 27 * grow, edge);
            ln.setAttribute('x1', x1.toFixed(1));
            ln.setAttribute('y1', y1.toFixed(1));
            ln.setAttribute('x2', x2.toFixed(1));
            ln.setAttribute('y2', y2.toFixed(1));
            ln.style.opacity = String(onPitch);
          });
          z.classList.toggle('solid', done);
          fillFrom(z, done, true);
        });
      }
      if (R && els) {
        // ---- 2. the space, the run that was stopped, the card, the run that went through ----
        const RUN = [0.55, 0.75],
          on2 = k === 1;
        if (on2) {
          if (stage === 0) {
            if (DIR.blend) DIR.blend.k = smooth(seg(v, 0, 0.1));
            if (v >= 0.1) {
              DIR.blend = null;
              stage = 1;
            }
          }
          if (stage === 1 && v >= RUN[0]) {
            DIR.blend = { from: R.A, k: 0 };
            api.seek(R.S, true);
            stage = 2;
          }
          if (stage === 2) {
            if (DIR.blend) DIR.blend.k = smooth(seg(v, RUN[0], RUN[1]));
            if (v >= RUN[1]) {
              DIR.blend = null;
              api.setSpeed(1);
              api.setPlaying(true);
              stage = 3;
            }
          }
          // the scoreboard says which minute is being shown: the earlier attempt, the booking, then the goal
          DIR.clock =
            v < RUN[0]
              ? keyed(v, [
                  [0, c0],
                  [0.09, R.e0],
                  [0.3, R.e1],
                  [0.37, R.e1],
                  [0.4, R.cardT],
                  [0.51, R.cardT],
                  [RUN[0], R.aT],
                ])
              : null;
        }
        const show = on2 ? Math.min(seg(v, 0.04, 0.13), 1 - seg(v, 0.93, 0.99)) : 0,
          [x0, y0, x1, y1] = R.box,
          sgn = R.sgn,
          T = (q: readonly number[]) => xy(q[0]! * sgn, q[1]! * sgn),
          square: XY[] = [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ];
        els.space.setAttribute('points', pts(square.map(([x, y]) => xy(x, y))));
        els.space.style.opacity = String(show);
        const g = smooth(seg(v, 0.12, 0.3)),
          j = Math.round(R.j0 + g * (R.j1 - R.j0)),
          ga = T(inClip(R.E, j, R.sc)),
          gb = T(inClip(R.E, j, R.dp)),
          g0 = T(inClip(R.E, R.j0, R.sc));
        const ms = inClip(R.E, R.j1, R.sc),
          md = inClip(R.E, R.j1, R.dp),
          mid = [(ms[0] + md[0]) / 2, (ms[1] + md[1]) / 2] as const,
          s0 = T([mid[0], mid[1] - 1.9]),
          s1 = T([mid[0], mid[1] + 1.9]);
        const here = api.drawn(R.di) || [0, 0],
          hxy = xy(here[0], here[1]),
          ppm = Math.hypot(xy(here[0] + 1, here[1])[0] - hxy[0], xy(here[0] + 1, here[1])[1] - hxy[1]);
        const ghosts = show * seg(v, 0.1, 0.14),
          past = seg(v, 0.37, 0.44); // the earlier attempt leaves its line and its stop behind, fainter
        const rings: [SVGCircleElement, XY][] = [
          [els.ghostA, ga],
          [els.ghostB, gb],
        ];
        for (const [ring] of rings) ring.style.opacity = '0'; // the run's line says it: no rings
        const lines: [SVGLineElement, XY, XY][] = [
          [els.ghostPath, g0, ga],
          [els.stop, s0, s1],
        ];
        for (const [ln, a, b] of lines) {
          ln.setAttribute('x1', a[0].toFixed(1));
          ln.setAttribute('y1', a[1].toFixed(1));
          ln.setAttribute('x2', b[0].toFixed(1));
          ln.setAttribute('y2', b[1].toFixed(1));
        }
        els.ghostPath.style.opacity = String(ghosts * (1 - 0.5 * past));
        els.stop.style.opacity = String(show * seg(v, 0.28, 0.31) * (1 - 0.5 * past));
        const c = outCubic(seg(v, 0.4, 0.46));
        els.card.setAttribute('x', (hxy[0] + ppm * 0.7).toFixed(1));
        els.card.setAttribute('y', (hxy[1] - ppm * 1.2 - 22 - (1 - c) * 26).toFixed(1));
        els.card.style.opacity = '0';
        void c;
        // the run for the goal as he really ran it, frame by frame, up to where he is now and no further
        const runner = stage >= 3 ? R.shot : (api.drawn(R.si) ?? R.from),
          upto = stage >= 3 ? R.S : Math.min(R.S, Math.round(api.getF())),
          line2: XY[] = [];
        for (let f = Math.max(R.A, upto - 2.5 * FPS); f <= upto; f += 5) {
          const q = api.pos(f, R.si);
          if (q) line2.push(xy(q[0], q[1]));
        } // only the last two and a half seconds behind him: a short tail, not a line across the pitch
        if (stage < 3 && line2.length) line2.push(xy(runner[0], runner[1]));
        if (!line2.length) line2.push(xy(R.from[0], R.from[1]));
        if (on2 && stage >= 3 && Math.abs(api.ballAt(api.getF())[0]) >= 52.2) api.setSpeed(0.15); // once it is in, the picture all but stops
        els.trail.setAttribute('points', pts(line2));
        els.trail.style.opacity = String(on2 && v >= RUN[0] ? show : 0);
        if (on2) {
          done = v >= RUN[0] && v < 0.96 && (runner[0] - (x0 + x1) / 2) * R.dir > 8;
          els.space.classList.toggle('solid', done);
          fillFrom(els.space, done, R.dir > 0);
          look(line2[line2.length - 1]!);
        }

        // ---- 3. the clock winds back, runs up, and the goal lands inside the minutes named ----
        const on3 = k === 2;
        if (on3) {
          if (stage === 0) {
            if (DIR.blend) DIR.blend.k = smooth(seg(v, 0, 0.12));
            if (v >= 0.12) {
              DIR.blend = { from: R.f60, k: 0 };
              api.seek(R.S, true);
              stage = 1;
            }
          }
          if (stage === 1) {
            if (DIR.blend) DIR.blend.k = 1 - (1 - seg(v, 0.12, 0.56)) ** 2;
            if (v >= 0.56) {
              DIR.blend = null;
              api.setSpeed(1);
              api.setPlaying(true);
              DIR.focus = new Set([R.si]);
              stage = 2;
            }
          }
          api.ball.setOpacity(stage === 2 ? 1 : 1 - seg(v, 0, 0.06)); // the ball is not part of this picture until it is struck
        }
        const Fs = DIR.blend ? lerp(DIR.blend.from, api.getF(), DIR.blend.k) : api.getF(),
          bb = api.ballAt(api.getF());
        const isLate = on3 && stage >= 1 && Fs >= R.f70,
          hit = on3 && stage === 2 && Math.abs(bb[0]) >= 52.2,
          show3 = on3 ? 1 - seg(v, 0.94, 0.99) : 0;
        document.body.classList.toggle('tlate', isLate && !hit && v < 0.96);
        document.body.classList.toggle('tgoal', hit && v < 0.96);
        const gx = R.dir * 52.5,
          gd = R.dir * 2; // the goal as it is seen from here: its frame and its depth
        els.goal.setAttribute('points', pts(hull(goalBox(gx, gd).map(([x, y, h]) => xy(x, y, h)))));
        els.goal.style.opacity = String(isLate ? show3 : 0);
        els.goal.classList.toggle('solid', hit);
        fillFrom(els.goal, hit, R.dir > 0);
        els.trail3.setAttribute('points', pts([xy(R.shot[0], R.shot[1]), xy(bb[0], bb[1], bb[2])]));
        els.trail3.style.opacity = '0'; // the goal box filling says it
        if (on3) {
          if (hit) api.setSpeed(0.15);
          done = hit && v < 0.96;
          look([wrap.clientWidth - 150, 50]);
        }
      }
      capLine.classList.toggle('done', done);
    },
    exit() {
      DIR.focus = null;
      DIR.blend = null;
      DIR.clock = null;
      DIR.plain = false;
      api.ball.setOpacity(1);
      document.body.classList.remove('tbig', 'tlate', 'tgoal');
      capLine.className = '';
      over.replaceChildren();
    },
  };
}
