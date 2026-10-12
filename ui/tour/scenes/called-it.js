// The film's sixth feature, Called it: the three things said at kick-off come back as pictures and turn solid.
import { svgEl, seg, lerp, smooth, outCubic } from '#util';
import { callLine, hull, goalBox } from '#tour/furniture';
import { setOff } from '#replay/start';

// a value read off a line drawn through [at, value] points
const keyed = (v, keys) => {
  let i = 0;
  while (i < keys.length - 2 && v > keys[i + 1][0]) i++;
  const [a, x] = keys[i],
    [b2, y] = keys[i + 1];
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
export function calledIt(ctx) {
  const { api, M, FPS, DIR, D, REPLAY, full, index, wrap, cut, look, caption, swapCall, capLine, over } = ctx;
  return {
    dur: D[5],
    enter() {
      cut(api.LAST - 3 * FPS, 0.25, (wantPos, wantAim) => {
        wantPos.set(0, 94, 96.5);
        wantAim.set(0, 0, 6);
      });
      DIR.focus = new Set([-1]);
      look(null);
      const calls = (full && full.payload.calls) || [],
        by = (m) => calls.find((c) => c.mark === m);
      this.where = by('channels');
      this.man = by('zone');
      this.late = by('window');
      this.k = -1;
      this.stage = 0;
      DIR.plain = true; // the pictures are the only marks on the pitch
      caption('6', 'Called it', callLine(this.where ? this.where.said : 'Three calls from kick-off'), [
        ['log', 'From the match record'],
      ]);
      over.replaceChildren();
      const W = this.where;
      if (W) {
        // the zone, as it was drawn at kick-off, and every shot on the spot it was taken from
        this.bands =
          W.zone === 'wide'
            ? [
                [12.2, 33],
                [-33, -12.2],
              ]
            : [[-12.2, 12.2]];
        this.zones = this.bands.map(() => svgEl('polygon', { class: 'zone' }, over));
        this.dots = W.points.map((q) => svgEl('circle', { class: q.inside ? 'shot in' : 'shot', r: 0 }, over));
      }
      const G = REPLAY && REPLAY.clips.goal,
        E = REPLAY && REPLAY.clips.earlier;
      this.R = null;
      if (G && E && this.man) {
        const sc = REPLAY.ids.indexOf(REPLAY.scorer),
          dp = REPLAY.ids.indexOf(REPLAY.differing_player),
          si = index(REPLAY.scorer),
          di = index(REPLAY.differing_player);
        // where the runner sets off
        const moved = (C) => setOff(C, sc);
        const base = api.frameAtClock(G.clock),
          A = base + moved(G),
          S = base + G.shot_offset,
          at = api.pos(S, si) || [1, 0];
        const sgn = Math.sign(at[0] * G.pos[G.shot_offset][sc][0]) || 1,
          dir = Math.sign(at[0]) || 1; // the clips are turned to run one way; this turns them back onto the pitch
        const j0 = moved(E);
        let j1 = j0,
          best = 1e9; // the earlier run ends where the two of them meet
        for (let j = j0; j < Math.min(E.pos.length, j0 + 150); j++) {
          const d = Math.hypot(E.pos[j][sc][0] - E.pos[j][dp][0], E.pos[j][sc][1] - E.pos[j][dp][1]);
          if (d < best) {
            best = d;
            j1 = j;
          }
        }
        const c = api.pos(A, di) || [0, 0],
          card = M.cards.find((k) => k.player === REPLAY.differing_player || index(k.player) === di),
          goal = M.goals[M.goals.length - 1];
        this.R = {
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
          box: [c[0] - 8, c[1] - 7, c[0] + 8, c[1] + 7],
          from: api.pos(A, si),
          shot: at,
          e0: E.clock + j0 / 25,
          e1: E.clock + j1 / 25,
          cardT: card ? api.clockAt(card.frame) : REPLAY.booked_minute * 60,
          aT: api.clockAt(A),
          f60: api.frameAtClock((this.late ? this.late.window[0] - 10 : 60) * 60),
          f70: api.frameAtClock((this.late ? this.late.window[0] : 70) * 60),
          goalF: goal ? goal.frame : S,
        };
        this.space = svgEl('polygon', { class: 'zone' }, over);
        this.ghostPath = svgEl('line', { class: 'ghost' }, over);
        this.stop = svgEl('line', { class: 'stop' }, over);
        this.trail = svgEl('polyline', { class: 'trail' }, over);
        this.ghostA = svgEl('circle', { class: 'gring home' }, over);
        this.ghostB = svgEl('circle', { class: 'gring away' }, over);
        this.card = svgEl('rect', { class: 'tbook', width: 13, height: 18, rx: 2.5 }, over);
        this.goal = svgEl('polygon', { class: 'zone' }, over);
        this.trail3 = svgEl('polyline', { class: 'trail' }, over);
      }
    },
    update(u) {
      const CUTS = [0, 0.245, 0.69, 1],
        k = u < CUTS[1] ? 0 : u < CUTS[2] ? 1 : 2,
        v = (u - CUTS[k]) / (CUTS[k + 1] - CUTS[k]),
        R = this.R;
      const xy = (x, y, h = 0) => {
          const q = api.project(x, h, -y);
          return [q[0], q[1]];
        },
        pts = (a) => a.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '); // placed afresh each frame: the camera moves
      const halfCam = (x, height, back2) => (wantPos, wantAim) => {
        wantPos.set(x, height, back2);
        wantAim.set(x, 0, 5);
      };
      if (k !== this.k) {
        // each picture sets its own stage
        const first = this.k < 0;
        this.k = k;
        this.stage = 0;
        DIR.clock = null;
        document.body.classList.remove('tbig', 'tlate', 'tgoal');
        if (k === 1 && R) {
          this.c0 = api.clockAt(api.getF());
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
        const said = [this.where, this.man, this.late][k];
        if (said && !(first && k === 0)) {
          if (first) {
            capLine.replaceChildren(...callLine(said.said));
            capLine.className = 'tcall';
          } else swapCall(said.said);
        }
        if (first && k > 0) api.snapCamera();
      }
      let done = false;
      const W = this.where,
        fade = Math.min(seg(v, 0.02, 0.14), 1 - seg(v, 0.9, 0.99)),
        onPitch = k === 0 ? fade : 0;
      if (W) {
        let landed = 0;
        this.dots.forEach((d, i) => {
          const q = W.points[i],
            [x, y] = xy(q.x, q.y),
            a = k === 0 ? outCubic(seg(v, 0.14 + i * 0.03, 0.26 + i * 0.03)) : 1;
          d.setAttribute('cx', x.toFixed(1));
          d.setAttribute('cy', y.toFixed(1));
          d.setAttribute('r', (q.inside ? 9 : 6) * a);
          d.style.opacity = onPitch;
          if (a > 0.5) landed++;
        });
        done = k === 0 && landed === W.points.length && W.came_true && v < 0.96;
        this.zones.forEach((z, j) => {
          const [a, b] = this.bands[j];
          z.setAttribute(
            'points',
            pts(
              [
                [24, a],
                [51, a],
                [51, b],
                [24, b],
              ].map(([x, y]) => xy(x, y)),
            ),
          );
          z.style.opacity = onPitch;
          z.classList.toggle('solid', done);
        });
      }
      if (R) {
        // ---- 2. the space, the run that was stopped, the card, the run that went through ----
        const RUN = [0.55, 0.75],
          on2 = k === 1;
        if (on2) {
          if (this.stage === 0) {
            DIR.blend.k = smooth(seg(v, 0, 0.1));
            if (v >= 0.1) {
              DIR.blend = null;
              this.stage = 1;
            }
          }
          if (this.stage === 1 && v >= RUN[0]) {
            DIR.blend = { from: R.A, k: 0 };
            api.seek(R.S, true);
            this.stage = 2;
          }
          if (this.stage === 2) {
            DIR.blend.k = smooth(seg(v, RUN[0], RUN[1]));
            if (v >= RUN[1]) {
              DIR.blend = null;
              api.setSpeed(1);
              api.setPlaying(true);
              this.stage = 3;
            }
          }
          // the scoreboard says which minute is being shown: the earlier attempt, the booking, then the goal
          DIR.clock =
            v < RUN[0]
              ? keyed(v, [
                  [0, this.c0],
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
          T = (q) => xy(q[0] * R.sgn, q[1] * R.sgn);
        this.space.setAttribute(
          'points',
          pts(
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ].map(([x, y]) => xy(x, y)),
          ),
        );
        this.space.style.opacity = show;
        const g = smooth(seg(v, 0.12, 0.3)),
          j = Math.round(R.j0 + g * (R.j1 - R.j0)),
          ga = T(R.E.pos[j][R.sc]),
          gb = T(R.E.pos[j][R.dp]),
          g0 = T(R.E.pos[R.j0][R.sc]);
        const m1 = R.E.pos[R.j1],
          mid = [(m1[R.sc][0] + m1[R.dp][0]) / 2, (m1[R.sc][1] + m1[R.dp][1]) / 2],
          s0 = T([mid[0], mid[1] - 1.9]),
          s1 = T([mid[0], mid[1] + 1.9]);
        const here = api.drawn(R.di) || [0, 0],
          hxy = xy(here[0], here[1]),
          ppm = Math.hypot(xy(here[0] + 1, here[1])[0] - hxy[0], xy(here[0] + 1, here[1])[1] - hxy[1]);
        const ghosts = show * seg(v, 0.1, 0.14),
          past = seg(v, 0.37, 0.44); // the earlier attempt leaves its line and its stop behind, fainter
        for (const [ring, q] of [
          [this.ghostA, ga],
          [this.ghostB, gb],
        ]) {
          ring.setAttribute('cx', q[0].toFixed(1));
          ring.setAttribute('cy', q[1].toFixed(1));
          ring.setAttribute('r', Math.max(8, ppm * 0.95).toFixed(1));
          ring.style.opacity = ghosts * (1 - past);
        }
        for (const [ln, a, b] of [
          [this.ghostPath, g0, ga],
          [this.stop, s0, s1],
        ]) {
          ln.setAttribute('x1', a[0].toFixed(1));
          ln.setAttribute('y1', a[1].toFixed(1));
          ln.setAttribute('x2', b[0].toFixed(1));
          ln.setAttribute('y2', b[1].toFixed(1));
        }
        this.ghostPath.style.opacity = ghosts * (1 - 0.5 * past);
        this.stop.style.opacity = show * seg(v, 0.28, 0.31) * (1 - 0.5 * past);
        const c = outCubic(seg(v, 0.4, 0.46));
        this.card.setAttribute('x', (hxy[0] + ppm * 0.7).toFixed(1));
        this.card.setAttribute('y', (hxy[1] - ppm * 1.2 - 22 - (1 - c) * 26).toFixed(1));
        this.card.style.opacity = show * seg(v, 0.4, 0.43);
        const runner = this.stage >= 3 ? R.shot : api.drawn(R.si) || R.from,
          line2 = [xy(R.from[0], R.from[1]), xy(runner[0], runner[1])];
        if (on2 && this.stage >= 3) {
          const bb = api.ballAt(api.getF());
          line2.push(xy(bb[0], bb[1], bb[2]));
          if (Math.abs(bb[0]) >= 52.2) api.setSpeed(0.15);
        } // once it is in, the picture all but stops, to be looked at
        this.trail.setAttribute('points', pts(line2));
        this.trail.style.opacity = on2 && v >= RUN[0] ? show : 0;
        if (on2) {
          done = v >= RUN[0] && v < 0.96 && (runner[0] - (x0 + x1) / 2) * R.dir > 8;
          this.space.classList.toggle('solid', done);
          look(line2[1]);
        }

        // ---- 3. the clock winds back, runs up, and the goal lands inside the minutes named ----
        const on3 = k === 2;
        if (on3) {
          if (this.stage === 0) {
            DIR.blend.k = smooth(seg(v, 0, 0.12));
            if (v >= 0.12) {
              DIR.blend = { from: R.f60, k: 0 };
              api.seek(R.S, true);
              this.stage = 1;
            }
          }
          if (this.stage === 1) {
            DIR.blend.k = 1 - (1 - seg(v, 0.12, 0.56)) ** 2;
            if (v >= 0.56) {
              DIR.blend = null;
              api.setSpeed(1);
              api.setPlaying(true);
              DIR.focus = new Set([R.si]);
              this.stage = 2;
            }
          }
          api.ball.setOpacity(this.stage === 2 ? 1 : 1 - seg(v, 0, 0.06)); // the ball is not part of this picture until it is struck
        }
        const Fs = DIR.blend ? lerp(DIR.blend.from, api.getF(), DIR.blend.k) : api.getF(),
          bb = api.ballAt(api.getF());
        const late = on3 && this.stage >= 1 && Fs >= R.f70,
          hit = on3 && this.stage === 2 && Math.abs(bb[0]) >= 52.2,
          show3 = on3 ? 1 - seg(v, 0.94, 0.99) : 0;
        document.body.classList.toggle('tlate', late && !hit && v < 0.96);
        document.body.classList.toggle('tgoal', hit && v < 0.96);
        const gx = R.dir * 52.5,
          gd = R.dir * 2; // the goal as it is seen from here: its frame and its depth
        this.goal.setAttribute('points', pts(hull(goalBox(gx, gd).map(([x, y, h]) => xy(x, y, h)))));
        this.goal.style.opacity = late ? show3 : 0;
        this.goal.classList.toggle('solid', hit);
        this.trail3.setAttribute('points', pts([xy(R.shot[0], R.shot[1]), xy(bb[0], bb[1], bb[2])]));
        this.trail3.style.opacity = on3 && this.stage === 2 ? show3 : 0;
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
