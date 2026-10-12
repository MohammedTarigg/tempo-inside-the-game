// The Tempo intro. The word appears, its last letter grows the halfway line above and below it, and an eye opens in it. The eye
// looks one way, then the other, and blinks once. Then the letters make way and the mark glides along the line to the front of
// the word, where it stays. Nothing jumps and nothing shakes.
// playIntro(host) draws into `host` (give it a black background and white text colour) and resolves when it has finished, with
// the drawing and the exact box of the finished logo inside it, so a page can carry that same drawing to wherever its logo lives.
const NS = 'http://www.w3.org/2000/svg',
  FONT = '"Hanken Grotesk", system-ui, sans-serif';
const W = 800,
  H = 300,
  FS = 150,
  BASE = 192; // the drawing's size, the type size and its baseline
const RO = 40,
  RW = 15.3,
  STUB = 23.5,
  SW = RW * 0.78,
  RP = 12.9,
  LOOK = 8.2; // the mark: ring, line and spot, in the logo's proportions
const END = 4.45;

const clamp = (x) => Math.min(1, Math.max(0, x)),
  seg = (t, a, b) => clamp((t - a) / (b - a)),
  lerp = (a, b, u) => a + (b - a) * u;
const outCubic = (u) => 1 - (1 - u) ** 3,
  inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const outBack = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;
const bump = (t, at, half) => Math.max(0, 1 - Math.abs(t - at) / half); // 0, up to 1 at `at`, back to 0
// where the eye looks, as a share of its full sideways travel: a calm look left, then right, where it rests
const glance = (t) => (t < 2.45 ? -inOut(seg(t, 1.95, 2.3)) : lerp(-1, 1, inOut(seg(t, 2.6, 3.0))));

// Pass `at` (seconds) to draw one still moment instead, for checking a frame.
export const MARK = { RO, RW, SW, STUB };

// The mark's two limbs as soft tails. Each is hinged where it leaves the ring and its tip is pulled towards straight by a
// spring, so when the mark moves the tips trail behind and curl back, and when it stops they come to rest exactly straight,
// which is the logo. `lean` tilts where "straight" is by a small angle, for a slow float. The tip keeps its distance from
// the ring, so a tail bends and never stretches. Call step() once a frame; a jump in time (or the first call) starts at rest.
export function softTails() {
  const tips = {},
    SPRING = { top: [120, 13], bot: [84, 10] },
    BEND = Math.tan(0.95); // the lower one is a little looser, so the two never move as one
  const one = (key, x, y, dir, len, dt, lean, settle) => {
    const reach = Math.max(0, len - SW / 2),
      py = y + dir * RO,
      rx = x + Math.sin(lean) * reach,
      ry = py + dir * Math.cos(lean) * reach;
    let q = tips[key];
    if (!q || !(dt > 0) || dt > 0.2) q = tips[key] = { x: rx, y: ry, vx: 0, vy: 0 };
    else {
      const [k, c] = SPRING[key],
        n = Math.max(1, Math.ceil(dt / 0.008)),
        h = dt / n;
      for (let i = 0; i < n; i++) {
        q.vx += ((rx - q.x) * k - q.vx * c) * h;
        q.vy += ((ry - q.y) * 260 - q.vy * 26) * h;
        q.x += q.vx * h;
        q.y += q.vy * h;
      }
    }
    const sx = x,
      sy = py + dir * reach; // dead straight
    let dx = q.x + (sx - q.x) * settle - x,
      dy = Math.max(1e-3, (q.y + (sy - q.y) * settle - py) * dir);
    dx = Math.max(-dy * BEND, Math.min(dy * BEND, dx));
    const d = Math.hypot(dx, dy) || 1;
    return `M${x.toFixed(2)} ${(py - (dir * RW) / 2).toFixed(2)} Q${x.toFixed(2)} ${(py + dir * reach * 0.55).toFixed(2)} ${(x + (dx / d) * reach).toFixed(2)} ${(py + ((dir * dy) / d) * reach).toFixed(2)}`;
  };
  return {
    step: (x, y, len, dt, { lean = [0, 0], settle = 0 } = {}) => [
      one('top', x, y, -1, len, dt, lean[0], settle),
      one('bot', x, y, 1, len, dt, lean[1], settle),
    ],
  };
}

export async function playIntro(host, { hold = 0.8, at = null } = {}) {
  await Promise.all([document.fonts.load(`600 ${FS}px ${FONT}`)]).catch(() => {});
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  const svg = el(
    'svg',
    {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': 'Tempo',
      style: 'display:block;width:min(86vw, 880px);height:auto;overflow:visible',
    },
    host,
  );
  const type = {
    'font-family': FONT,
    'font-weight': 600,
    'font-size': FS,
    'letter-spacing': -6,
    fill: 'currentColor',
    y: BASE,
  };
  const temp = el('text', type, svg),
    oh = el('text', { ...type, opacity: 0 }, svg);
  temp.textContent = 'temp';
  oh.textContent = 'o';
  const ring = el('ellipse', { fill: 'none', stroke: 'currentColor', 'stroke-width': RW }, svg);
  const soft = { fill: 'none', stroke: 'currentColor', 'stroke-width': SW, 'stroke-linecap': 'round' },
    top = el('path', { ...soft, 'data-limb': 'top' }, svg),
    bot = el('path', { ...soft, 'data-limb': 'bot' }, svg),
    spot = el('ellipse', { fill: 'currentColor' }, svg);
  const tails = softTails();
  let before = null;
  const L4 = temp.getComputedTextLength(),
    L1 = oh.getComputedTextLength();
  // two layouts: the word with the mark as its last letter, and the mark in front of the whole word
  const xA = (W - (L4 + 2 + 2 * RO)) / 2,
    markA = xA + L4 + 2 + RO,
    GAP = 26,
    xB = (W - (2 * RO + GAP + L4 + L1)) / 2,
    markB = xB + RO,
    wordB = xB + 2 * RO + GAP,
    CY = BASE - RO + 1.5;

  // the finished logo's own box inside the drawing: the mark with its two stubs, the word, and room for the p's tail
  const box = { x: markB - RO, y: CY - RO - STUB - 6, w: wordB + L4 + L1 - (markB - RO), h: 2 * (RO + STUB) + 22 };
  spot.setAttribute('data-eye', '');
  svg.dataset.eye = `${markB} ${CY} ${LOOK}`;

  function draw(t) {
    const appear = outCubic(seg(t, 0.15, 0.8)),
      limb = Math.max(0, outBack(seg(t, 0.95, 1.4))),
      open = Math.max(0, outBack(seg(t, 1.45, 1.72)));
    const move = inOut(seg(t, 3.56, 4.18)),
      blink = bump(t, 3.22, 0.09);
    const x = lerp(markA, markB, move),
      y = CY + (1 - appear) * 14,
      ry = RO - RW / 2;
    svg.style.opacity = appear;
    // the letters make way: "temp" fades where it stands, and the whole word returns to the right of the mark
    const leaving = t < 3.82,
      word = leaving ? 1 - seg(t, 3.38, 3.66) : seg(t, 3.9, 4.3);
    temp.setAttribute('x', leaving ? xA : wordB);
    temp.setAttribute('y', BASE + (1 - appear) * 14);
    temp.setAttribute('opacity', word);
    oh.setAttribute('x', wordB + L4);
    oh.setAttribute('opacity', leaving ? 0 : word);
    ring.setAttribute('cx', x);
    ring.setAttribute('cy', y);
    ring.setAttribute('rx', ry);
    ring.setAttribute('ry', ry);
    const len = STUB * limb;
    // soft tails with round ends: upright whenever the mark is still, trailing behind when it glides to the front of the
    // word, and dead straight again by the last frame, which is the logo the page keeps
    const dt = before === null ? 0 : t - before;
    before = t;
    const [dTop, dBot] = tails.step(x, y, len, dt, { settle: inOut(seg(t, END - 0.2, END)) });
    top.setAttribute('d', dTop);
    bot.setAttribute('d', dBot);
    spot.setAttribute('cx', x + glance(t) * LOOK);
    spot.setAttribute('cy', y);
    spot.setAttribute('rx', RP * open);
    spot.setAttribute('ry', RP * open * (1 - 0.92 * blink)); // a blink: the spot shuts to a line, the ring does not move
  }
  const done = { svg, box };
  if (at !== null) {
    draw(at);
    return done;
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(END);
    return new Promise((r) => setTimeout(() => r(done), 1200));
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function tick(now) {
      const t = (now - t0) / 1000;
      draw(Math.min(t, END));
      if (t < END + hold) requestAnimationFrame(tick);
      else {
        draw(END);
        resolve(done);
      }
    })(t0);
  });
}
