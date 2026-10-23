// Graphics pinned to the pitch: small elements in #pins that follow a point in the picture.
import { stageEl } from '../shared/stage.ts';
import { $, el } from '../shared/util.ts';

export const pin = (cls: string) => el('div', `pin ${cls}`, $('pins'));

// A pinned graphic follows a point on the pitch. If it would run off the picture it is pulled back inside, and one that
// would hide under the scoreboard drops below its player instead.
// A point on the stage in pixels: x and y, then anything else the caller had with it.
export type ScreenPt = readonly [number, number, ...unknown[]];
export const place = (e: HTMLElement, xy: ScreenPt, on: number, ax = '-50%', ay = '-100%', dy = 0) => {
  // --on runs 0 to 1 as it comes on and back as it goes: each pinned graphic's sheet turns it into its own motion
  e.style.opacity = String(Math.min(1, on * 1.8));
  e.style.setProperty('--on', on.toFixed(3));
  if (on <= 0.01) return;
  const W = stageEl.clientWidth,
    H = stageEl.clientHeight,
    w = e.offsetWidth,
    h = e.offsetHeight,
    fx = parseFloat(ax) / 100,
    fy = parseFloat(ay) / 100;
  const [px, py] = xy;
  let x = px + fx * w,
    y = py + dy + fy * h;
  if (y < 64 && fy < 0) y = py - dy + 6;
  x = Math.min(W - w - 10, Math.max(10, x));
  y = Math.min(H - h - 10, Math.max(72, y)); // clear of the scoreboard row
  e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
};
