// An overlay that comes and goes with its own motion. present(e, on) is called every frame with whether it should be up:
// coming on, it is shown and marked data-state="in", and its sheet plays its entrance; going off, it is marked "out" and
// stays until its exit has played, then it is hidden. What it shows is kept as it was, so it leaves as it looked. With
// reduced motion, or a sheet that gives it no exit, it simply goes.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function present(e: HTMLElement, on: boolean, display = 'block') {
  const state = e.dataset.state;
  if (on) {
    if (state !== 'in') {
      e.style.display = display;
      e.dataset.state = 'in';
    }
    return;
  }
  if (state !== 'in') return;
  const out = !still && getComputedStyle(e).getPropertyValue('--out').trim() !== '';
  if (!out) return hide(e);
  e.dataset.state = 'out';
  const done = (ev: AnimationEvent) => {
    if (ev.target !== e) return;
    e.removeEventListener('animationend', done);
    if (e.dataset.state === 'out') hide(e);
  };
  e.addEventListener('animationend', done);
}

function hide(e: HTMLElement) {
  e.style.display = 'none';
  delete e.dataset.state;
}
