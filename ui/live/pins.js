// Graphics pinned to the pitch: small elements in #pins that follow a point in the picture.
import { stageEl } from '#stage';
import { $, el } from '#util';

export const pin = (cls) => el('div', `pin ${cls}`, $('pins'));

// A pinned graphic follows a point on the pitch. If it would run off the picture it is pulled back inside, and one that
// would hide under the scoreboard drops below its player instead.
export const place = (e, xy, on, ax = '-50%', ay = '-100%', dy = 0) => {
  e.style.opacity = on;
  if (on <= 0.01) return;
  const W = stageEl.clientWidth,
    H = stageEl.clientHeight,
    w = e.offsetWidth,
    h = e.offsetHeight,
    fx = parseFloat(ax) / 100,
    fy = parseFloat(ay) / 100;
  let x = xy[0] + fx * w,
    y = xy[1] + dy + fy * h;
  if (y < 64 && fy < 0) y = xy[1] - dy + 6;
  x = Math.min(W - w - 10, Math.max(10, x));
  y = Math.min(H - h - 10, Math.max(72, y)); // clear of the scoreboard row
  e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
};
