// The film's first feature, Heads up: the three things Tempo says before kick-off, held up one at a time.
import { svgEl, seg, smooth, outCubic } from '../../shared/util.ts';
import { callLine, hull, goalBox } from '../furniture.ts';
import type { FilmCtx, Scene } from '../film.ts';

// Before kick-off. Play is slowed right down and the three marks are held up one at a time.
// Each mark eases in, its arrows run out and slow, and all of it leaves together.
export function headsUp(ctx: FilmCtx): Scene {
  const { api, M, DIR, D, full, cut, look, caption, swapCall, capLine, over } = ctx;
  // which mark is held up, which of the three is about minutes, the minute it names, and the goal those minutes are about
  let shown = 0,
    wi = -1,
    from = 70,
    gx = 52.5,
    goal: SVGPolygonElement | null = null;
  return {
    dur: D[0]!,
    enter() {
      cut(0, 0.3, (wantPos, wantAim) => {
        wantPos.set(0, 94, 96.5);
        wantAim.set(0, 0, 6);
      });
      look(null);
      shown = 0;
      document.body.classList.add('theads'); // no words on the pitch: each call's words are the caption's line, with the mark's own yellow square in front
      caption('1', 'Heads up', callLine(api.marks[0] ? api.marks[0].payload.text : 'Three things to watch'), [
        ['season', 'From the season so far'],
      ]);
      // The third mark is about minutes, so it is drawn on the clock: the scoreboard grows, the clock runs to the minute named and
      // takes the outline, with the goal those minutes are about. Called it brings the same two back and turns them solid.
      const w = api.marks.find((c) => c.payload.mark === 'window'),
        said = full?.payload.calls.find((c) => c.mark === 'window'),
        p2 = M.periods[1] ?? M.periods[0]!;
      wi = w ? api.marks.indexOf(w) : -1;
      from = said?.window?.[0] ?? 70;
      gx = p2.home_attacks * (w && w.payload.subject === `t_${M.home.short.toLowerCase()}` ? -1 : 1) * 52.5; // the goal that side defends in the half the minutes fall in
      over.replaceChildren();
      goal = svgEl('polygon', { class: 'zone' }, over);
    },
    update(u) {
      const k = Math.min(2, Math.floor(u * 3)),
        v = u * 3 - k,
        on = smooth(Math.min(seg(v, 0.03, 0.2), 1 - seg(v, 0.84, 0.99)));
      DIR.mark = { i: k, k: on, grow: outCubic(seg(v, 0.1, 0.62)) };
      if (k !== shown) {
        shown = k;
        const m = api.marks[k];
        if (m) swapCall(m.payload.text);
      }
      const mine = k === wi,
        late = mine && v > 0.04 && v < 0.93,
        lit = late && v > 0.34,
        gd = Math.sign(gx) * 2;
      document.body.classList.toggle('tbig', late);
      document.body.classList.toggle('tlate', lit);
      DIR.clock = mine ? from * 60 * smooth(seg(v, 0.08, 0.34)) * (1 - seg(v, 0.93, 1)) : null;
      if (!goal) return;
      goal.setAttribute(
        'points',
        hull(goalBox(gx, gd).map(([x, y, h]) => api.project(x, h, -y)))
          .map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`)
          .join(' '),
      );
      goal.style.opacity = String(lit ? on : 0);
    },
    exit() {
      DIR.mark = null;
      DIR.clock = null;
      document.body.classList.remove('tbig', 'tlate', 'theads');
      capLine.className = '';
      over.replaceChildren();
    },
  };
}
