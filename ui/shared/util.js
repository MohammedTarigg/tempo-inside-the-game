// Small helpers every page uses: finding and making elements, the error plate, a few sums, and the easing curves.
// Each curve has its own name, so a caller always gets the one it asked for.

export const $ = (id) => document.getElementById(id);

// A new element with a class, added to `parent` (the page's body if none is given), with text if there is any.
export const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  (parent || document.body).appendChild(e);
  return e;
};

// The same for a drawing: an SVG element with its attributes, added to `parent`.
export const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
};

// The page's error plate, for when a run cannot be loaded or the scene cannot be built.
export const fail = (m) => {
  $('err').style.display = 'flex';
  $('err').textContent = m;
};

export const lerp = (a, b, u) => a + (b - a) * u;
// held between 0 and 1
export const clamp = (x) => Math.min(1, Math.max(0, x));
// how far t is from a to b, held between 0 and 1
export const seg = (t, a, b) => clamp((t - a) / (b - a));

// How many entries of a sorted list are at or below x.
export const upper = (arr, x) => {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
};

// A match clock in seconds as 07:05.
export const mmss = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// Easing, each from 0 to 1. smooth: slow at both ends. outCubic: quick, then settling. inOutCubic: slow at both ends with
// a sharper middle than smooth. outBack: runs a little past the end and comes back.
export const smooth = (u) => u * u * (3 - 2 * u);
export const outCubic = (u) => 1 - (1 - u) ** 3;
export const inOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
export const outBack = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;
