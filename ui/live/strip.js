// The strip under the picture: who is on top as a curve, the bookings and the goals, the late minutes named at kick-off, and
// the playhead, which can be dragged.
import { $, el, clamp } from '#util';

// Builds the strip for a match. `seek` moves the match to a frame and `getF` reads the frame it is on.
export function makeStrip(match, { seek, getF }) {
  const { M, FPS, LAST, index, frameAtClock, danger, moments } = match;
  // ---- the strip: momentum, bookings, goals, the danger window ----
  const track = $('track'),
    X = (f) => `${((f / LAST) * 100).toFixed(3)}%`;
  // The strip carries only what a fan reads without being told: who is on top, the bookings and the goals, with the two ends
  // and half time marked. Anything else comes on while it is being explained, with its words, and then goes.
  [0, 45, 90].forEach((m) => {
    const d = el('div', 'min', track);
    d.textContent = m;
    d.style.left = X(m === 45 && M.periods[1] ? M.periods[1].first : frameAtClock(m * 60));
  });
  M.cards.forEach((c) => {
    el('div', 'book', track).style.left = X(c.frame);
  });
  M.goals.forEach((g) => {
    const d = el('div', 'goal', track);
    d.style.left = X(g.frame);
    d.classList.add(M.team[index(g.player)] ? 'away' : 'home');
  });
  let lateSpan = null; // the late window said at kick-off: shown then, and again as the match enters it
  if (danger) {
    const a = frameAtClock(danger.from_minute * 60),
      b = Math.min(LAST, frameAtClock(danger.to_minute * 60));
    lateSpan = [a, b];
    $('dwin').style.left = X(a);
    $('dwin').style.width = `${(((b - a) / LAST) * 100).toFixed(3)}%`;
  } else $('dwin').style.display = 'none';
  function drawMomentum() {
    const c = $('mom'),
      w = c.clientWidth,
      h = c.clientHeight,
      r = Math.min(devicePixelRatio, 2);
    c.width = w * r;
    c.height = h * r;
    const g = c.getContext('2d');
    g.scale(r, r);
    g.clearRect(0, 0, w, h);
    const top = Math.max(0.05, ...M.momentum.map((p) => Math.abs(p[1]))),
      mid = h / 2,
      y = (v) => mid - (v / top) * (mid - 2),
      css = getComputedStyle(document.documentElement);
    for (const [sign, col] of [
      [1, css.getPropertyValue('--home')],
      [-1, css.getPropertyValue('--away')],
    ]) {
      g.beginPath();
      g.moveTo(0, mid);
      for (const [f, v] of M.momentum) g.lineTo((f / LAST) * w, y(sign > 0 ? Math.max(v, 0) : Math.min(v, 0)));
      g.lineTo(w, mid);
      g.closePath();
      g.fillStyle = col.trim();
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.fillRect(0, mid - 0.5, w, 1);
  }

  let shownMoment = '';
  const scrub = (e) => {
    const r = track.getBoundingClientRect();
    seek(clamp((e.clientX - r.left) / r.width) * LAST);
  };
  track.onpointerdown = (e) => {
    track.setPointerCapture(e.pointerId);
    scrub(e);
    track.onpointermove = scrub;
  };
  track.onpointerup = () => {
    track.onpointermove = null;
  };
  track.onkeydown = (e) => {
    if (e.key === 'ArrowRight') seek(getF() + 10 * FPS);
    else if (e.key === 'ArrowLeft') seek(getF() - 10 * FPS);
  };
  return {
    lateSpan,
    drawMomentum,
    // the bracket over the late minutes: on while they are being explained, and again while the match is inside them
    showWindow(kickoff, F) {
      $('dwin').classList.toggle('on', !!kickoff && kickoff.payload.mark === 'window');
      $('dwin').classList.toggle('now', !!lateSpan && F >= lateSpan[0] && F <= lateSpan[1]);
    },
    // the words for the latest moment, and the playhead. F is the frame being played and Fs the frame the picture shows
    show(F, Fs) {
      let mi = -1;
      for (let i = 0; i < moments.length; i++) if (moments[i].f <= F + 1) mi = i;
      const mt = mi >= 0 && F - moments[mi].f < 12 * FPS ? moments[mi].text : '';
      if (mt !== shownMoment) {
        shownMoment = mt;
        $('moment').textContent = mt;
      }
      $('head').style.left = X(Fs);
      track.setAttribute('aria-valuenow', Math.round((F / LAST) * 100));
    },
  };
}
