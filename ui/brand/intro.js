// The Tempo intro. The word appears, its last letter grows the halfway line above and below it, an eye opens in it, looks
// about, blinks, and then jumps over the word to the front of it, where it stays as the mark.
// playIntro(host) draws into `host` (give it a black background and white text colour) and resolves when it has finished.
const NS = 'http://www.w3.org/2000/svg', FONT = '"Hanken Grotesk", system-ui, sans-serif';
const W = 800, H = 300, FS = 150, BASE = 192;                                   // the drawing's size, the type size and its baseline
const RO = 40, RW = 15.3, STUB = 23.5, SW = RW * 0.78, RP = 12.9, LOOK = 8.2;   // the mark: ring, line and spot, in the logo's proportions
const END = 4.75;

const clamp = (x) => Math.min(1, Math.max(0, x)), seg = (t, a, b) => clamp((t - a) / (b - a)), lerp = (a, b, u) => a + (b - a) * u;
const outCubic = (u) => 1 - (1 - u) ** 3, inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const outBack = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;
const bump = (t, at, half) => Math.max(0, 1 - Math.abs(t - at) / half);          // 0, up to 1 at `at`, back to 0
// where the eye looks, as a share of its full sideways travel, at each moment of the twitch
const GLANCE = [[1.9, 0], [1.97, 1], [2.24, 1], [2.31, -0.85], [2.5, -0.85], [2.56, -0.6], [2.6, -0.85], [2.72, 1], [2.78, 0.8], [2.83, 1], [3.4, 1], [3.5, -1], [4.25, -1], [4.4, 1]];
const glance = (t) => { if (t <= GLANCE[0][0]) return 0; for (let i = 1; i < GLANCE.length; i++) if (t < GLANCE[i][0]) return lerp(GLANCE[i - 1][1], GLANCE[i][1], seg(t, GLANCE[i - 1][0], GLANCE[i][0])); return 1; };

// Pass `at` (seconds) to draw one still moment instead, for checking a frame.
export async function playIntro(host, { hold = 0.8, at = null } = {}) {
  await Promise.all([document.fonts.load(`600 ${FS}px ${FONT}`)]).catch(() => {});
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Tempo', style: 'display:block;width:min(86vw, 880px);height:auto;overflow:visible' }, host);
  const type = { 'font-family': FONT, 'font-weight': 600, 'font-size': FS, 'letter-spacing': -6, fill: 'currentColor', y: BASE };
  const temp = el('text', type, svg), oh = el('text', { ...type, opacity: 0 }, svg); temp.textContent = 'temp'; oh.textContent = 'o';
  const ring = el('ellipse', { fill: 'none', stroke: 'currentColor', 'stroke-width': RW }, svg);
  const top = el('rect', { fill: 'currentColor', width: SW }, svg), bot = el('rect', { fill: 'currentColor', width: SW }, svg), spot = el('ellipse', { fill: 'currentColor' }, svg);
  const L4 = temp.getComputedTextLength(), L1 = oh.getComputedTextLength();
  // two layouts: the word with the mark as its last letter, and the mark in front of the whole word
  const xA = (W - (L4 + 2 + 2 * RO)) / 2, markA = xA + L4 + 2 + RO, GAP = 26, xB = (W - (2 * RO + GAP + L4 + L1)) / 2, markB = xB + RO, wordB = xB + 2 * RO + GAP, CY = BASE - RO + 1.5;

  function draw(t) {
    const appear = outCubic(seg(t, 0.15, 0.8)), limb = Math.max(0, outBack(seg(t, 0.95, 1.4))), open = Math.max(0, outBack(seg(t, 1.45, 1.72)));
    const walk = inOut(seg(t, 3.5, 4.3)), blink = Math.max(bump(t, 2.98, 0.08), bump(t, 3.16, 0.07), bump(t, 4.62, 0.08));
    const x = lerp(markA, markB, walk), y = CY + (1 - appear) * 14 - 128 * Math.sin(Math.PI * walk), ry = RO - RW / 2, wx = lerp(xA, wordB, walk);
    svg.style.opacity = appear;
    temp.setAttribute('x', wx); temp.setAttribute('y', BASE + (1 - appear) * 14); oh.setAttribute('x', wx + L4); oh.setAttribute('opacity', seg(t, 3.85, 4.2));
    ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('rx', RO - RW / 2); ring.setAttribute('ry', ry);
    const edge = ry + RW / 2, len = STUB * limb, sway = 5 * Math.sin(Math.PI * walk * 2) * (walk > 0 && walk < 1 ? 1 : 0);      // the limbs swing as it walks
    top.setAttribute('x', x - SW / 2 + sway); top.setAttribute('y', y - edge - len); top.setAttribute('height', len + RW / 2);
    bot.setAttribute('x', x - SW / 2 - sway); bot.setAttribute('y', y + edge - RW / 2); bot.setAttribute('height', len + RW / 2);
    spot.setAttribute('cx', x + glance(t) * LOOK); spot.setAttribute('cy', y); spot.setAttribute('rx', RP * open); spot.setAttribute('ry', RP * open * (1 - 0.92 * blink));      // a blink: the spot shuts to a line, the ring does not move
  }
  if (at !== null) { draw(at); return undefined; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(END); return new Promise((r) => setTimeout(r, 1200)); }
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function tick(now) { const t = (now - t0) / 1000; draw(Math.min(t, END)); if (t < END + hold) requestAnimationFrame(tick); else resolve(); })(t0);
  });
}
