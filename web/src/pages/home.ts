// The front door is the mark itself, on one screen. Its halfway line runs the height of the screen and the eye rides it,
// following the pointer up and down and looking at it. Beside the line are the four ways in. Over one, the eye goes to
// it and its spot opens into a window on that page, playing a loop recorded from it (tools/previews.ts), or for the
// evidence its headline figure, read from the results the evaluation wrote. Clicking opens the window over the whole
// screen and the page comes up under it. On a touch screen the first tap on a name opens its window and the second goes in.
import '../styles/home.css';
import calls from '../../../results/calls.json';
import summary from '../../public/runs/m_demo/summary.json';
import { site, el, svgEl, seg, lerp, inOutCubic, outBack } from '../shared/util.ts';

const [home, away] = summary.final_score;
const STOPS = [
  { href: site('film/'), name: 'Watch the film', line: '107 seconds, seven features', loop: site('previews/film.mp4') },
  {
    href: site('match/?intro=0'),
    name: 'Watch the match',
    line: `Northgate ${home}, Harbour City ${away}`,
    loop: site('previews/match.mp4'),
  },
  { href: site('desk/'), name: 'Producer desk', line: 'What aired and what was held', loop: site('previews/desk.mp4') },
  {
    href: site('evidence/'),
    name: 'How we know',
    line: 'Every figure, with its check',
    figure: `${calls.held} of ${calls.tested}`,
  },
];
const N = STOPS.length;
// the mark in the logo's units (a 120 box): the ring's width, the line's width, the open spot, and the gap between them
const RW = 13,
  LW = 10.14,
  SPOT = 13.2,
  GAP = 7.8;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const page = el('main', 'door', document.body);
el('b', 'word', page, 'tempo');
const svg = svgEl('svg', { class: 'mark', 'aria-hidden': 'true' }, page);
const limb = { stroke: '#fff', 'stroke-linecap': 'round', fill: 'none' },
  top = svgEl('line', limb, svg),
  bot = svgEl('line', limb, svg),
  ring = svgEl('circle', { fill: '#000', stroke: '#fff' }, svg);

// the spot: white while the eye looks, a window when it opens. One layer per stop, shown when its stop is the one open
const spot = el('a', 'spot', page);
spot.tabIndex = -1;
spot.setAttribute('aria-hidden', 'true');
const white = el('i', 'white', spot);
const panes = STOPS.map((s) => {
  const pane = el('div', 'pane', spot);
  if (s.loop) {
    const v = el('video', '', pane);
    Object.assign(v, { src: s.loop, muted: true, loop: true, playsInline: true, preload: 'auto' });
    return { pane, v };
  }
  el('b', 'figure', pane, s.figure);
  return { pane, v: null };
});

// the ways in, beside the line. Pointing at one, or tabbing to it, opens its window
const names = el('nav', 'names', page);
names.setAttribute('aria-label', 'Tempo');
let over: number | null = null,
  focused: number | null = null,
  tapped: number | null = null,
  touch = false;
const links = STOPS.map((s, k) => {
  const a = el('a', '', names);
  a.href = s.href;
  el('b', '', a, s.name);
  el('span', '', a, s.line);
  a.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'touch') over = k;
  });
  a.addEventListener('pointerleave', () => {
    if (over === k) over = null;
  });
  a.addEventListener('focus', () => (focused = k));
  a.addEventListener('blur', () => focused === k && (focused = null));
  return a;
});

let W = 0,
  H = 0,
  s = 1,
  narrow = false;
const size = () => {
  W = innerWidth;
  H = innerHeight;
  narrow = W < 760;
  s = Math.min(1.35, Math.max(0.95, Math.min(W, H) / 560));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  top.setAttribute('stroke-width', String(LW * s));
  bot.setAttribute('stroke-width', String(LW * s));
  ring.setAttribute('stroke-width', String(RW * s));
};
size();
addEventListener('resize', size);

// where the ways in sit, how wide a window opens, and where its middle can be so that all of it stays on the screen. On a
// narrow screen the names take the lower part and the window opens above them
const wide = () => Math.min((narrow ? 0.27 : 0.36) * H, (narrow ? 0.4 : 0.22) * W, 320);
const room = () => wide() + (GAP + RW) * s + 16;
const high = () => room() + 48; // a narrow screen's window, clear of the word
const stopY = (k: number) => {
  const from = narrow ? high() + room() + 40 : 0.2 * H,
    to = narrow ? H - 48 : 0.8 * H;
  return from + ((to - from) * k) / (N - 1);
};
const windowY = (k: number) => (narrow ? high() : Math.min(H - room(), Math.max(room(), stopY(k))));

let px = 0,
  py = 0,
  seen = false;
addEventListener('pointermove', (e: PointerEvent) => {
  px = e.clientX;
  py = e.clientY;
  seen = e.pointerType !== 'touch';
});

const t0 = performance.now();
let shown = -1,
  open = 0,
  ey = 0,
  leaving: { k: number; t0: number } | null = null,
  last = t0,
  gaze = [0, 0],
  born = still ? -10 : 0;

function frame(now: number) {
  const t = (now - t0) / 1000,
    dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  // born: the eye opens in the middle, then its stubs grow into the whole halfway line
  const grow = still ? 1 : Math.max(0, outBack(seg(t - born, 0.35, 1.15))),
    awake = still ? 1 : seg(t - born, 0, 0.35),
    ready = still || t - born > 1.1;
  // which way in the eye is on: the name under the pointer, or the window it is already inside, or the name tabbed to
  const R = lerp(SPOT * s, wide(), inOutCubic(open)),
    inside = shown >= 0 && open > 0.5 && Math.hypot(px - W / 2, py - ey) < R;
  const aim = leaving ? leaving.k : ready ? (over ?? (inside ? shown : null) ?? focused ?? tapped) : null;
  // the window shuts before it shows another way in, so each one opens fresh
  const want = aim !== null && aim === shown ? 1 : 0;
  open = still ? want : open + (want - open) * (1 - Math.exp(-dt * (want ? 7 : 11)));
  if (aim !== null && aim !== shown && open < 0.04) show(aim);
  // the eye: on a way in, at its window; otherwise wherever the pointer is up or down the screen
  const margin = (RW + 26.5) * s + 24,
    idle = seen ? Math.min(H - margin, Math.max(margin, py)) : H / 2,
    toY = aim !== null ? windowY(aim) : idle,
    was = ey;
  ey = still || !was ? toY : ey + (toY - ey) * (1 - Math.exp(-dt * 9));
  const out = leaving ? inOutCubic(seg((now - leaving.t0) / 1000, 0, 0.55)) : 0,
    cx = W / 2,
    cy = ey,
    win = lerp(lerp(SPOT * s, wide(), inOutCubic(open)), Math.hypot(W, H) / 2 + 40, out),
    rr = win + (GAP + RW / 2) * s * (1 - out); // shut, this is the logo's ring: the spot, the gap and half the ring's width
  // the line: from the ring out past both edges, its ends round. Before it has grown it is the logo's two stubs
  const stub = 26.5 * s,
    edge = rr + (RW / 2) * s;
  top.setAttribute('x1', String(cx));
  top.setAttribute('x2', String(cx));
  top.setAttribute('y1', String(lerp(cy - edge - stub, -LW * s, grow)));
  top.setAttribute('y2', String(cy - edge + (RW / 2) * s));
  bot.setAttribute('x1', String(cx));
  bot.setAttribute('x2', String(cx));
  bot.setAttribute('y1', String(cy + edge - (RW / 2) * s));
  bot.setAttribute('y2', String(lerp(cy + edge + stub, H + LW * s, grow)));
  ring.setAttribute('cx', String(cx));
  ring.setAttribute('cy', String(cy));
  ring.setAttribute('r', String(rr));
  svg.style.opacity = String(awake);
  // the gaze: at the pointer, and a little ahead of itself while it moves; a blink now and then
  const v = dt ? (ey - was) / dt : 0;
  let gx = 0,
    gy = Math.max(-1, Math.min(1, v / 600)) * 4 * s;
  if (seen) {
    const dx = px - cx,
      dy = py - cy,
      d = Math.hypot(dx, dy) || 1,
      m = Math.min(5.5 * s, d * 0.02);
    gx = (dx / d) * m;
    gy += (dy / d) * m * 0.5;
  }
  gaze = still ? [0, 0] : [gaze[0]! + (gx - gaze[0]!) * 0.15, gaze[1]! + (gy - gaze[1]!) * 0.15];
  const blink = still ? 0 : Math.max(0, 1 - Math.abs(((t + 1.2) % 5.6) - 5.3) / 0.12) * (1 - open);
  const g = 1 - open;
  spot.style.transform = `translate(${cx + gaze[0]! * g}px, ${cy + gaze[1]! * g}px) scale(${win / 300}, ${(win / 300) * (1 - 0.94 * blink)})`;
  spot.style.opacity = String(awake);
  spot.style.cursor = open > 0.5 ? 'pointer' : 'default';
  white.style.opacity = String(1 - Math.min(1, open * 1.6));
  // the names: set by their stops, beside the window's edge on a wide screen, and the one the eye is on in white
  const nx = narrow ? cx + 30 : cx + wide() + (GAP + RW) * s + 48;
  names.style.transform = `translateX(${nx}px)`;
  names.style.opacity = String(still ? 1 : seg(t - born, 1.0, 1.5) * (1 - out));
  links.forEach((a, j) => {
    a.style.transform = `translateY(${stopY(j)}px)`;
    a.style.maxWidth = `${W - nx - 16}px`;
    a.classList.toggle('here', j === aim);
  });
  if (leaving && out >= 1) {
    location.assign(STOPS[leaving.k]!.href);
    return;
  }
  requestAnimationFrame(frame);
}

function show(k: number) {
  shown = k;
  panes.forEach((p, j) => {
    p.pane.classList.toggle('on', j === k);
    if (p.v && j === k) {
      p.v.currentTime = 0;
      void p.v.play().catch(() => {});
    } else p.v?.pause();
  });
  spot.href = STOPS[k]!.href;
}
requestAnimationFrame(frame);

// any way in plays the same exit: the window grows over the screen, then the page opens. On touch, the first tap on a
// name only opens its window
addEventListener('pointerdown', (e: PointerEvent) => {
  touch = e.pointerType === 'touch';
  if (touch && !(e.target as Element).closest('.names a, .spot')) tapped = null;
});
const leave = (e: MouseEvent, k: number) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  if (touch && tapped !== k) {
    tapped = k;
    return;
  }
  if (still) return location.assign(STOPS[k]!.href);
  leaving ??= { k, t0: performance.now() };
};
spot.addEventListener('click', (e) => shown >= 0 && open > 0.5 && leave(e, shown));
links.forEach((a, k) => a.addEventListener('click', (e) => leave(e, k)));
// back from a page: the door as it was left, the window shut
addEventListener('pageshow', (e: PageTransitionEvent) => {
  if (!e.persisted) return;
  leaving = null;
  over = tapped = null;
  open = 0;
  born = -10;
  last = performance.now();
  requestAnimationFrame(frame);
});
