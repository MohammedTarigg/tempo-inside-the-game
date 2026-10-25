// The film's first feature, Heads up: the three things Tempo says before kick-off, held up one at a time.
import { svgEl, seg, smooth, outCubic, inOutCubic, lerp } from '../../shared/util.ts';
import { markShapes } from '../../match/marks.ts';
import { callLine } from '../furniture.ts';
import type { FilmCtx, Scene } from '../film.ts';

// Before kick-off. Play is slowed right down and the camera comes down among the players, at the height a broadcast films
// from. It can only show the middle of the pitch, so the three marks are held up on the map at the foot of the picture, one
// at a time: each eases in, its arrows run out and slow, and all of it leaves together. They are the same shapes the pitch
// would draw (markShapes), so the map and the turf can never disagree.
export function headsUp(ctx: FilmCtx): Scene {
  const { api, M, DIR, D, full, map, look, caption, swapCall, capLine } = ctx;
  // which mark is held up, how far the camera has come down, which of the three is about minutes, the minute it names, and the goal those minutes are about
  let shown = 0,
    down = 0,
    wi = -1,
    from = 70,
    gx = 52.5;
  // what the map draws: up to two areas and two arrows, and the goal the minutes are about
  let zones: SVGPolygonElement[] = [],
    arrows: SVGPolylineElement[] = [],
    goal: SVGRectElement | null = null;
  return {
    dur: D[0]!,
    enter() {
      api.seek(0, true); // soft: the camera is not snapped, it comes down
      api.setSpeed(0.3);
      DIR.blend = null;
      DIR.focus = null;
      // from the opening's view of the whole pitch the camera comes down to the players over the first beats; nothing cuts
      down = 0;
      DIR.cam = (wantPos, wantAim) => {
        wantPos.set(0, lerp(94, 15, down), lerp(96.5, 40, down));
        wantAim.set(0, down, lerp(6, 4, down));
      };
      api.setPlaying(true);
      look(null);
      shown = 0;
      document.body.classList.add('theads'); // no words on the pitch: each call's words are the caption's line, with the mark's own yellow square in front
      caption('1', 'Heads up', callLine(api.marks[0] ? api.marks[0].payload.text : 'Three things to watch'), [
        ['season', 'From the season so far'],
      ]);
      // The third mark is about minutes, so it is drawn on the clock: the scoreboard grows, the clock runs to the minute named and
      // takes the outline, and the map lights the goal those minutes are about. Called it brings the same two back.
      const w = api.marks.find((c) => c.payload.mark === 'window'),
        said = full?.payload.calls.find((c) => c.mark === 'window'),
        p2 = M.periods[1] ?? M.periods[0]!;
      wi = w ? api.marks.indexOf(w) : -1;
      from = said?.window?.[0] ?? 70;
      gx = p2.home_attacks * (w && w.payload.subject === `t_${M.home.short.toLowerCase()}` ? -1 : 1) * 52.5; // the goal that side defends in the half the minutes fall in
      map.clear();
      zones = [0, 1].map(() => svgEl('polygon', { class: 'zone' }, map.marks));
      arrows = [0, 1].map(() => svgEl('polyline', { class: 'arrow' }, map.marks));
      goal = svgEl('rect', { class: 'zone', x: gx > 0 ? 52.5 : -54.5, y: -3.66, width: 2, height: 7.32 }, map.marks);
      map.show(true);
    },
    update(u) {
      down = inOutCubic(seg(u, 0, 0.15));
      const k = Math.min(2, Math.floor(u * 3)),
        v = u * 3 - k,
        on = smooth(Math.min(seg(v, 0.03, 0.2), 1 - seg(v, 0.84, 0.99))),
        grow = outCubic(seg(v, 0.1, 0.62));
      // the mark is held, so the match view does not show one of its own, but at nothing: the map carries it
      DIR.mark = { i: k, k: 0, grow };
      if (k !== shown) {
        shown = k;
        const m = api.marks[k];
        if (m) swapCall(m.payload.text);
      }
      const mine = k === wi,
        late = mine && v > 0.04 && v < 0.93,
        lit = late && v > 0.34;
      document.body.classList.toggle('tbig', late);
      document.body.classList.toggle('tlate', lit);
      DIR.clock = mine ? from * 60 * smooth(seg(v, 0.08, 0.34)) * (1 - seg(v, 0.93, 1)) : null;
      // ---- the map ----
      const m = api.marks[k],
        shapes = m
          ? markShapes(api.match, m.payload, api.getF(), M.periods[0]!, 1 - (1 - on) ** 3)
          : { zones: [], arrows: [] };
      zones.forEach((z, j) => {
        const r = shapes.zones[j]?.r;
        z.style.opacity = r ? String(on) : '0';
        if (r) z.setAttribute('points', `${r[0]},${r[1]} ${r[2]},${r[1]} ${r[2]},${r[3]} ${r[0]},${r[3]}`);
      });
      arrows.forEach((a, j) => {
        const path = shapes.arrows[j];
        a.style.opacity = path ? String(on) : '0';
        if (path)
          a.setAttribute(
            'points',
            path
              .slice(0, Math.max(2, Math.round(grow * path.length)))
              .map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`)
              .join(' '),
          );
      });
      if (goal) goal.style.opacity = String(lit ? on : 0);
      map.update();
    },
    exit() {
      DIR.mark = null;
      DIR.clock = null;
      document.body.classList.remove('tbig', 'tlate', 'theads');
      capLine.className = '';
      map.show(false);
    },
  };
}
