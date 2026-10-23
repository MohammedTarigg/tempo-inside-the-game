// The three things said before kick-off, drawn on the pitch: a patch of grass, an arrow or two, and the words beside them.
import { project, stageEl, SIGNAL } from '../shared/stage.ts';
import { makeZone, makeArrow } from '../shared/shapes.ts';
import { $, clamp } from '../shared/util.ts';
import { pin, place, type ScreenPt } from './pins.ts';
import type { Match, ShownMark } from './data.ts';
import type { Period } from '../types/run.ts';
import { present } from './presence.ts';

type XY = [number, number];
// A director holding one mark up: which, how far it has faded in, and how far its arrows have grown.
export interface HeldMark {
  i: number;
  k: number;
  grow: number;
}

// a curved arrow's path: 41 points from a to b, bent towards c
const bez = (a: XY, c: XY, b: XY) =>
  Array.from({ length: 41 }, (_, i): XY => {
    const t = i / 40,
      u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });

// Returns draw(kickoff, F, P, markK, held), called once a frame. kickoff is the mark on show (or nothing), P the half being
// played, markK(c, sec) how far a mark has faded in, and held a director's own mark (DIR.mark) when it is holding one up.
// In the film, what Tempo says before kick-off is yellow, and comes back yellow at the end.
export function makeKickoffMarks(match: Match, tour: boolean) {
  const { M, FPS, index, teamOf, pos, danger } = match;
  const tint = tour ? SIGNAL : undefined,
    zones = [makeZone(tint), makeZone(tint)],
    arrows = [makeArrow(tint), makeArrow(tint)],
    kmEl = pin('plate chip');
  kmEl.id = 'kmtext';
  const still: XY[] = [
    [0, 0],
    [1, 0],
  ];
  return (
    kickoff: ShownMark | undefined,
    F: number,
    P: Period,
    markK: (c: ShownMark, sec: number) => number,
    held: HeldMark | null,
  ) => {
    // ---- kick-off marks, drawn on the pitch ----
    let kz = [0, 0],
      km: ScreenPt | null = null,
      kmUp = false;
    if (kickoff) {
      const k = markK(kickoff, 0.5),
        m = kickoff.payload,
        sweep = 1 - (1 - k) ** 3, // an area sweeps open from the goal line it belongs to, and folds back to it
        inner = (dir: number) => dir * 51 + (dir * 24 - dir * 51) * sweep,
        grow = held ? held.grow : clamp((F - kickoff.start) / (1.6 * FPS));
      if (m.mark === 'channels') {
        // the wide channels of the third that team attacks
        const dir = (teamOf(m.subject) === 0 ? 1 : -1) * P.home_attacks;
        if (m.zone === 'central') {
          // the middle of that third, and one straight run at goal
          zones[0]!.set(inner(dir), -12.2, dir * 51, 12.2, Math.min(1, k * 2), false);
          arrows[0]!.set(bez([dir * 12, 0], [dir * 28, 0], [dir * 45, 0]), grow, 0.6, k);
          arrows[1]!.set(still, 0);
          kz = [1, 0];
        } else {
          [1, -1].forEach((s, j) => {
            zones[j]!.set(inner(dir), -s * 21, dir * 51, -s * 33, Math.min(1, k * 2), false);
            arrows[j]!.set(bez([dir * 27, -s * 27], [dir * 44, -s * 28], [dir * 46, -s * 9]), grow, 0.6, k);
          });
          kz = [1, 1];
        }
        km = project(dir * 37.5, 0, 34.6); // the words sit under the near channel, off the pitch, clear of the players
      } else if (m.mark === 'zone') {
        // the space in front of the back four, round the man who guards it
        const p = pos(F, index(m.subject));
        if (p) {
          zones[0]!.set(p[0] - 8, -p[1] - 7, p[0] + 8, -p[1] + 7, k, true);
          kz = [1, 0];
          km = project(p[0], 0, -p[1] + 8.5);
        }
      } else if (m.mark === 'window' && tour) {
        // the film has no strip: the words sit by the goal the minutes are about, and the film marks the clock
        km = project((M.periods[1] || P).home_attacks * (teamOf(m.subject) === 0 ? -1 : 1) * 34, 0, 15);
      } else if (m.mark === 'window' && danger) {
        // the minutes it points at are on the strip, so the words sit over them there
        const r = $('dwin').getBoundingClientRect(),
          st = stageEl.getBoundingClientRect(),
          zoom = st.width / stageEl.clientWidth || 1;
        km = [(r.left + r.width / 2 - st.left) / zoom, (r.top - st.top) / zoom - 10];
        kmUp = true; // the page may be scaled to fit its window
      } else km = project(0, 0, 20);
      if (kmEl.textContent !== m.text) kmEl.textContent = m.text;
      if (km) place(kmEl, km, k, '-50%', kmUp ? '-100%' : '0', (1 - k) * (kmUp ? 6 : -6));
    } else kmEl.style.opacity = '0';
    zones.forEach((z, j) => {
      if (!kz[j]) z.set(0, 0, 0, 0, 0);
    });
    arrows.forEach((a) => {
      if (!kickoff || kickoff.payload.mark !== 'channels') a.set(still, 0);
    });
    present($('kmhead'), !!kickoff && !kickoff.again);
  };
}
