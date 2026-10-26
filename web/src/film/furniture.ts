// The film's own furniture, laid over the match view: the logo in the corner, the caption, the side panel, the veil, and
// the overlay that features draw on. Also the small shapes more than one feature draws.
import { softTails, type Intro } from '../brand/intro.ts';
import { $, el, svgEl, inOutCubic } from '../shared/util.ts';
import { ICON } from './icons.ts';
import type { ScreenPt } from '../match/pins.ts';

// The caption's line when it is one of Tempo's calls: the words with a small mark in front, which is the same mark as the
// one on the pitch (an outline while the call is only something said, solid once it has happened), and then a tick.
export const callLine = (text: string) => {
  const sw = document.createElement('i');
  sw.className = 'tsw';
  const tk = document.createElement('i');
  tk.className = 'ttk';
  tk.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.8l5 5L19.5 7"/></svg>';
  return [sw, document.createTextNode(text), tk];
};

// the outline of a set of points on the screen
type XY = readonly [number, number, ...unknown[]];
export const hull = <P extends XY>(points: P[]): P[] => {
  const q = [...points].sort((m, n) => m[0] - n[0] || m[1] - n[1]),
    cross = (o: XY, m: XY, n: XY) => (m[0] - o[0]) * (n[1] - o[1]) - (m[1] - o[1]) * (n[0] - o[0]);
  const half = (pts: P[]) => {
    const h: P[] = [];
    for (const pt of pts) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, pt) <= 0) h.pop();
      h.push(pt);
    }
    h.pop();
    return h;
  };
  return [...half(q), ...half(q.reverse())];
};

// A goal as a box to be outlined: its frame on the goal line at x = gx (7.32 m wide, 2.44 m high) and its depth, gd metres
// behind and lower at the back. Each point is [x, y, height].
export const goalBox = (gx: number, gd: number): [number, number, number][] => [
  [gx, -3.66, 0],
  [gx, 3.66, 0],
  [gx, -3.66, 2.44],
  [gx, 3.66, 2.44],
  [gx + gd, -3.66, 0],
  [gx + gd, 3.66, 0],
  [gx + gd, -3.66, 1.6],
  [gx + gd, 3.66, 1.6],
];

// A chip under the caption: an icon and its words, saying where what is on screen comes from.
export type Chip = [icon: string, text: string];
// The corner logo's parts, kept for the close: the ring, the two limbs, the gradient that fades the word, the soft tails,
// the eye's radius, and where the word ends and its middle lies, in the drawing's own units.
interface LogoArt {
  ring: SVGEllipseElement;
  limbs: SVGPathElement[];
  fade: SVGLinearGradientElement;
  tails: ReturnType<typeof softTails>;
  rx: number;
  end: number;
  mid: number;
}
export type Furniture = ReturnType<typeof makeFurniture>;

export function makeFurniture() {
  const wrap = $('stagewrap');
  // The film is one 1280 by 720 frame, scaled to fit the window like a video, so it looks the same on any screen.
  const scale = () => document.body.style.setProperty('--k', String(Math.min(innerWidth / 1280, innerHeight / 720)));
  addEventListener('resize', scale);
  scale();
  el('div', 'tscrim', wrap);
  const logo = el('div', 'tlogo', wrap); // filled with the intro's own finished drawing, so the two can never differ
  const cap = el('div', 'tcap', wrap),
    capNo = el('span', '', el('div', 'tno', cap)),
    capBody = el('div', '', cap),
    capName = el('h2', '', capBody),
    capLine = el('p', '', capBody),
    capChips = el('div', 'tchips', capBody);
  // the eyelids: where the film has to cut, the picture closes like an eye, changes behind them, and opens on the new moment
  const lidT = el('i', 'tlid top', wrap),
    lidB = el('i', 'tlid bottom', wrap),
    lids = (shut: boolean) => [lidT, lidB].forEach((l) => l.classList.toggle('shut', shut)),
    shut = () => lidT.classList.contains('shut');
  const side = el('div', 'tside', wrap),
    veil = el('div', 'tveil', wrap),
    over = svgEl('svg', { class: 'tover', 'aria-hidden': 'true' }, wrap);
  let eye: SVGEllipseElement | null = null,
    eyeAt = [0, 0, 0],
    art: LogoArt | null = null;
  // The logo's eye looks straight out at the viewer, as the logo does. When something new is shown (a feature, or a call
  // within one) it glances at it for a moment and comes back. look(xy) is called every frame with what is being shown;
  // glance() marks that the next look is at something new.
  let glancedAt = -1;
  const glance = () => {
    glancedAt = -1;
  };
  const look = (xy?: ScreenPt | null) => {
    if (!eye) return;
    const [ex = 0, ey = 0, reach = 0] = eyeAt;
    let gx = 0,
      gy = 0;
    if (xy) {
      const now = performance.now();
      if (glancedAt < 0) glancedAt = now;
      const t = (now - glancedAt) / 1000,
        away = t < 0.28 ? inOutCubic(t / 0.28) : t < 0.95 ? 1 : 1 - inOutCubic(Math.min(1, (t - 0.95) / 0.4)),
        dx = xy[0] - (logo.offsetLeft + 18),
        dy = xy[1] - (logo.offsetTop + 18),
        L = Math.hypot(dx, dy) || 1;
      gx = (dx / L) * reach * away;
      gy = (dy / L) * reach * away;
    }
    eye.setAttribute('cx', String(ex + gx));
    eye.setAttribute('cy', String(ey + gy));
  };
  // The caption stays where it is from the first feature to the last. Between features its parts change in place, each in
  // its own way (film.css): the number rolls like a scoreboard digit, the title is wiped off and written on behind a white
  // rule, the line sinks and rises out of its baseline, and the pills undraw and draw themselves on.
  let capUp = false;
  function caption(no: string, title: string, line: string | Node[], chips: Chip[]) {
    const fill = () => {
      capNo.textContent = no;
      capName.textContent = title;
      capLine.className = typeof line === 'string' ? '' : 'tcall';
      if (typeof line === 'string') capLine.textContent = line;
      else capLine.replaceChildren(...line);
      capChips.replaceChildren(
        ...chips.map(([icon, text]) => {
          const c = document.createElement('span');
          c.innerHTML = ICON[icon] ?? '';
          el('b', '', c, text);
          return c;
        }),
      );
    };
    glance();
    const enter = () => {
      cap.classList.remove('chg', 'in');
      void cap.offsetWidth;
      cap.classList.add('on', 'in');
    };
    if (!capUp || !cap.classList.contains('on')) {
      capUp = true;
      fill();
      enter();
      return;
    }
    cap.classList.add('chg');
    setTimeout(() => {
      fill();
      enter();
    }, 300);
  }
  const panel = (html: string) => {
    side.innerHTML = html;
    side.classList.add('on');
  };
  const clearPanel = () => side.classList.remove('on');
  const swapCall = (text: string) => {
    glance();
    capLine.classList.add('out');
    setTimeout(() => {
      capLine.replaceChildren(...callLine(text));
      capLine.className = 'tcall';
      void capLine.offsetWidth;
      capLine.classList.add('write');
    }, 240);
  };
  // The corner logo is a copy of the intro's finished drawing, cut to the logo's own box, so the two can never differ. Takes
  // what playIntro resolved with and gives back the copy. It also keeps the logo's parts: the eye, for look(), and the rest
  // for the close, where the mark eats the word and is left alone.
  const adoptLogo = (fin: Intro) => {
    const copy = fin.svg.cloneNode(true) as SVGSVGElement,
      bx = fin.box;
    copy.setAttribute('viewBox', `${bx.x} ${bx.y} ${bx.w} ${bx.h}`);
    copy.removeAttribute('style');
    copy.style.opacity = '1';
    logo.replaceChildren(copy);
    eye = copy.querySelector<SVGEllipseElement>('[data-eye]');
    eyeAt = (fin.svg.dataset.eye ?? '0 0 0').split(' ').map(Number);
    {
      // the parts of the logo, kept for the close, where the mark eats the word and is left alone
      const ring = copy.querySelector('ellipse')!,
        limbs = [...copy.querySelectorAll<SVGPathElement>('[data-limb]')],
        texts = [...copy.querySelectorAll('text')];
      // the word fades out across the width of the mark as it passes, so no straight edge is ever seen, even on the tall letters
      const defs = svgEl('defs', {}, copy),
        fade = svgEl(
          'linearGradient',
          { id: 'twfade', gradientUnits: 'userSpaceOnUse', x1: -1e4, x2: -1e4 + 1, y1: 0, y2: 0 },
          defs,
        );
      svgEl('stop', { offset: 0, 'stop-color': '#000' }, fade);
      svgEl('stop', { offset: 1, 'stop-color': '#fff' }, fade);
      const mask = svgEl(
        'mask',
        {
          id: 'twipe',
          maskUnits: 'userSpaceOnUse',
          x: bx.x - 200,
          y: bx.y - 80,
          width: bx.w + 400,
          height: bx.h + 160,
        },
        defs,
      );
      svgEl('rect', { x: bx.x - 200, y: bx.y - 80, width: bx.w + 400, height: bx.h + 160, fill: 'url(#twfade)' }, mask);
      texts.forEach((t) => t.setAttribute('mask', 'url(#twipe)'));
      [ring, ...limbs, eye].forEach((n) => n && copy.appendChild(n));
      copy.style.overflow = 'visible'; // the mark is drawn over the word, so letters can go under it
      art = {
        ring,
        limbs,
        fade,
        tails: softTails(),
        rx: Number(eye?.getAttribute('rx') ?? 0),
        end: bx.x + bx.w,
        mid: bx.x + bx.w / 2,
      };
    }
    return copy;
  };
  return {
    wrap,
    logo,
    cap,
    capLine,
    side,
    veil,
    over,
    look,
    caption,
    swapCall,
    glance,
    lids,
    shut,
    panel,
    clearPanel,
    adoptLogo,
    // these three are set by adoptLogo, after the features have been built: read them when they are needed, not before
    get eye() {
      return eye;
    },
    get eyeAt() {
      return eyeAt;
    },
    get art() {
      return art;
    },
  };
}
