// The film's map: the whole pitch seen flat from above, small and see-through at the foot of the picture. It is used only
// while the camera is down among the players and can show one part of the pitch, so the map can show all of it: the 22
// players and the ball where they are drawn, and the shapes a feature puts on it. It works in the pitch's own metres (x along
// the touchline, z across it towards the near side, as the marks on the turf are placed), so a shape drawn on the turf and
// on the map is the same shape.
import { svgEl, el } from '../shared/util.ts';
import type { MatchApi } from '../match/view.ts';

export type PitchMap = ReturnType<typeof makeMap>;

const NS = 'http://www.w3.org/2000/svg';

export function makeMap(host: HTMLElement, api: MatchApi) {
  const { M, figs } = api;
  const root = el('div', 'tmap', host),
    svg = document.createElementNS(NS, 'svg');
  root.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '-55.5 -37 111 74');
  root.appendChild(svg);
  // an arrow's head, sized in metres
  const head = svgEl(
    'marker',
    {
      id: 'tmaphead',
      viewBox: '0 0 10 10',
      refX: 6,
      refY: 5,
      markerWidth: 4,
      markerHeight: 4,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    },
    svgEl('defs', {}, svg),
  );
  svgEl('path', { d: 'M0 0L10 5L0 10Z' }, head);
  // what a feature draws, under the markings, so a filled area never hides a line of the pitch
  const marks = svgEl('g', { class: 'marks' }, svg);
  // the markings to the laws of the game, each a path that draws itself on when the map opens
  const lines = svgEl('g', { class: 'lines' }, svg),
    line = (d: string) => svgEl('path', { d, pathLength: 1 }, lines);
  line('M-52.5 -34H52.5V34H-52.5Z');
  line('M0 -34V34');
  line('M0 -9.15A9.15 9.15 0 1 1 0 9.15A9.15 9.15 0 1 1 0 -9.15');
  for (const s of [-1, 1]) {
    line(`M${s * 52.5} -20.16H${s * 36}V20.16H${s * 52.5}`);
    line(`M${s * 52.5} -9.16H${s * 47}V9.16H${s * 52.5}`);
  }
  const people = svgEl('g', { class: 'people' }, svg),
    dots = figs.map((_, i) =>
      svgEl('circle', { r: 1.5, class: M.team[i] ? 'away' : 'home', style: `--k:${i}` }, people),
    ),
    ball = svgEl('circle', { r: 0.8, class: 'ball' }, people);
  let shown = false;
  return {
    marks,
    // opens from its halfway line, the markings drawing on and then the players arriving; folds back to it as it goes
    show(on: boolean) {
      if (on === shown) return;
      shown = on;
      root.classList.toggle('on', on);
    },
    // every frame while it is open: the players and the ball where the picture has them, everyone but `focus` faint
    update(focus: Set<number> | null = api.DIR.focus) {
      if (!shown) return;
      dots.forEach((d, i) => {
        const p = api.drawn(i);
        d.style.visibility = p ? '' : 'hidden';
        if (!p) return;
        d.setAttribute('cx', p[0].toFixed(2));
        d.setAttribute('cy', (-p[1]).toFixed(2));
        d.classList.toggle('faint', !!focus && !focus.has(i));
      });
      const b = api.ballAt(api.getF());
      ball.setAttribute('cx', b[0].toFixed(2));
      ball.setAttribute('cy', (-b[1]).toFixed(2));
    },
    clear() {
      marks.replaceChildren();
    },
  };
}
