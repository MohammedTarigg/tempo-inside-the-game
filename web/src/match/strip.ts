// The strip under the picture: who is on top as a bar a minute (up for the home side, down for the away side, in their
// colours; the minutes still to come faint), the bookings and the goals, the late minutes named at kick-off, and
// the playhead, which can be dragged. At full time it rises into the turning points chart: the same curve with up to three
// pins, each a moment that plays again when it is tapped.
import { $, el, clamp } from '../shared/util.ts';
import type { Match, ShownMark } from './data.ts';
import { crestUrl } from '../shared/stage.ts';
import type { Pin } from '../types/run.ts';

export type Strip = ReturnType<typeof makeStrip>;

// A football for a goal: a white ball with its black centre panel, seams out to five panels cut by the rim, and a ring in the
// colour of the side that scored (from the goal's class)
const BALL = (() => {
  const at = (r: number, a: number) => [10 + r * Math.cos(a), 10 + r * Math.sin(a)] as const,
    ang = (k: number, off = 0) => -Math.PI / 2 + (k * 2 * Math.PI) / 5 + off,
    pent = (cx: number, cy: number, r: number, turn: number) =>
      [0, 1, 2, 3, 4]
        .map((k) => {
          const a = ang(k) + turn;
          return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
        })
        .join(' ');
  const seams = [0, 1, 2, 3, 4]
      .map((k) => {
        const [x1, y1] = at(3.1, ang(k)),
          [x2, y2] = at(6.2, ang(k));
        return `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
      })
      .join(''),
    rim = [0, 1, 2, 3, 4]
      .map((k) => {
        const [x, y] = at(8.6, ang(k));
        return `<polygon points="${pent(x, y, 2.9, Math.PI)}"/>`;
      })
      .join('');
  return `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><defs><clipPath id="ballrim"><circle cx="10" cy="10" r="8"/></clipPath></defs><circle cx="10" cy="10" r="8" fill="#fff"/><g fill="#111" clip-path="url(#ballrim)"><polygon points="${pent(10, 10, 3.1, 0)}"/>${rim}<path d="${seams}" stroke="#111" stroke-width="1.1"/></g><circle class="ring" cx="10" cy="10" r="8.6" fill="none" stroke-width="2.2"/></svg>`;
})();

// Builds the strip for a match. `seek` moves the match to a frame, `getF` reads the frame it is on, and `replay(pin)` plays
// one turning point again.
export function makeStrip(
  match: Match,
  { seek, getF, replay }: { seek: (f: number) => void; getF: () => number; replay: (pin: Pin) => void },
) {
  const { M, FPS, LAST, index, name, frameAtClock, danger, moments, timed } = match;
  // ---- the strip: momentum, bookings, goals, the danger window ----
  const track = $('track'),
    X = (f: number) => `${((f / LAST) * 100).toFixed(3)}%`;
  // The strip carries only what a fan reads without being told: who is on top, the bookings and the goals, with the two ends
  // and half time marked. Anything else comes on while it is being explained, with its words, and then goes.
  [0, 45, 90].forEach((m) => {
    const d = el('div', 'min', track);
    d.textContent = String(m);
    d.style.left = X(m === 45 && M.periods[1] ? M.periods[1].first : frameAtClock(m * 60));
  });
  const marks = new Map<object, HTMLElement>(); // each booking's and goal's mark, so a pin can stand in for it at full time
  M.cards.forEach((c) => {
    const d = el('div', 'book', track);
    d.style.left = X(c.frame);
    marks.set(c, d);
  });
  M.goals.forEach((g) => {
    const d = el('div', 'goal', track);
    d.style.left = X(g.frame);
    d.classList.add(M.team[index(g.player)] ? 'away' : 'home');
    d.innerHTML = BALL;
    marks.set(g, d);
  });
  let lateSpan: [number, number] | null = null; // the late window said at kick-off: shown then, and again as the match enters it
  if (danger) {
    const a = frameAtClock(danger.from_minute * 60),
      b = Math.min(LAST, frameAtClock(danger.to_minute * 60));
    lateSpan = [a, b];
    $('dwin').style.left = X(a);
    $('dwin').style.width = `${(((b - a) / LAST) * 100).toFixed(3)}%`;
  } else $('dwin').style.display = 'none';
  // the turning points, from the full-time cue: labels take turns above and below the curve so neighbours never collide
  const full = timed.find((c) => c.form === 'fulltime_card'),
    pins = full?.form === 'fulltime_card' ? full.payload.pins : [];
  // Each pin as a game would show it: a player's moment with his disc as it is on the pitch (number in his side's colour),
  // his name and the card or the ball; a side's moment with its crest and the words. The minute follows in grey. The disc
  // or crest sits on the stalk, so it stands right over its moment.
  const clubs = [M.home, M.away],
    side = (i: number) => (M.team[i] ? 'away' : 'home'),
    nearest = <T extends { frame: number }>(list: T[], f: number) =>
      list.reduce((a, b) => (Math.abs(b.frame - f) < Math.abs(a.frame - f) ? b : a));
  const pinEls = pins.map((p, k) => {
    const b = el('button', `tp ${k % 2 ? 'down' : 'up'}`, track),
      f = frameAtClock(p.t),
      event = p.kind === 'booking' ? nearest(M.cards, f) : p.kind === 'goal' ? nearest(M.goals, f) : null;
    b.style.left = X(f);
    b.tabIndex = -1;
    if (event) {
      marks.get(event)?.classList.add('pinned');
      const i = index(event.player);
      el('span', `disc ${side(i)}`, b, String(M.numbers[i]));
      el('span', '', b, name(event.player));
      if (p.kind === 'booking') el('i', 'card', b);
      else el('span', `ball ${side(i)}`, b).innerHTML = BALL;
    } else {
      const c = Math.max(
          0,
          clubs.findIndex((x) => p.text.startsWith(x.name)),
        ),
        url = crestUrl(clubs[c].short);
      if (url) Object.assign(el('img', 'crest', b), { src: url, alt: '', width: 22, height: 22 });
      else el('span', `disc ${c ? 'away' : 'home'}`, b);
      el('span', '', b, p.text);
    }
    el('span', 'mn', b, `${p.minute}'`);
    b.setAttribute('aria-label', `Play minute ${p.minute} again, ${p.text}`);
    b.onpointerdown = (e) => e.stopPropagation(); // a tap on a pin is not a drag of the playhead
    b.onclick = () => replay(p);
    return b;
  });
  // a pin that would run past the strip's right end opens to the left of its stalk instead
  const fit = () =>
    pinEls.forEach((b) => {
      b.classList.remove('flip');
      if (b.getBoundingClientRect().right > track.getBoundingClientRect().right) b.classList.add('flip');
    });
  let risen = false,
    lit: Pin | null = null;

  // a minute of play per bar, by frames so the bars sit under the playhead: each bar the mean of the minute's samples
  const MIN = 60 * FPS,
    bars = Array.from({ length: Math.ceil(LAST / MIN) }, (_, k) => {
      const vs = M.momentum.filter(([f = 0]) => f >= k * MIN && f < (k + 1) * MIN).map(([, v = 0]) => v);
      return vs.length ? vs.reduce((a, v) => a + v, 0) / vs.length : 0;
    }),
    peak = Math.max(0.03, ...bars.map(Math.abs));
  let played = -1; // the bar the playhead is in: those after it are faint

  function drawMomentum() {
    const c = $<HTMLCanvasElement>('mom'),
      w = c.clientWidth,
      h = c.clientHeight,
      r = Math.min(devicePixelRatio, 2);
    c.width = w * r;
    c.height = h * r;
    const g = c.getContext('2d')!;
    g.scale(r, r);
    g.clearRect(0, 0, w, h);
    const mid = h / 2,
      css = getComputedStyle(document.documentElement),
      home = css.getPropertyValue('--home').trim(),
      away = css.getPropertyValue('--away').trim(),
      step = (MIN / LAST) * w,
      gap = Math.min(1.4, step * 0.25);
    bars.forEach((v, k) => {
      const len = Math.max(1.5, Math.sqrt(Math.abs(v) / peak) * (mid - 1)), // square root, so a quiet minute still shows
        x = k * step + gap / 2,
        bw = Math.max(1, Math.min(step, w - k * step) - gap);
      g.globalAlpha = risen || k <= played ? 1 : 0.22;
      g.fillStyle = v >= 0 ? home : away;
      g.beginPath();
      g.roundRect(x, v >= 0 ? mid - len - 0.5 : mid + 0.5, bw, len, Math.min(1.5, bw / 2));
      g.fill();
    });
    g.globalAlpha = 1;
  }

  let shownMoment = '';
  const scrub = (e: PointerEvent) => {
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
  $('screen').addEventListener('transitionend', (e) => {
    if (e.target === $('screen')) drawMomentum();
  });
  return {
    lateSpan,
    drawMomentum,
    pins,
    // up: the strip stands as the full-time chart. on: the pin being played again, if any
    rise(up: boolean, on: Pin | null) {
      if (up !== risen) {
        risen = up;
        $('screen').classList.toggle('ft', up);
        pinEls.forEach((b) => (b.tabIndex = up ? 0 : -1));
        if (up) fit();
        drawMomentum();
      }
      if (on !== lit) {
        lit = on;
        track.classList.toggle('replaying', !!on);
        pinEls.forEach((b, k) => b.classList.toggle('on', pins[k] === on));
      }
    },
    // the bracket over the late minutes: on while they are being explained, and again while the match is inside them
    showWindow(kickoff: ShownMark | undefined, F: number) {
      $('dwin').classList.toggle('on', !!kickoff && kickoff.payload.mark === 'window');
      $('dwin').classList.toggle('now', !!lateSpan && F >= lateSpan[0] && F <= lateSpan[1]);
    },
    // the words for the latest moment, and the playhead. F is the frame being played and Fs the frame the picture shows
    show(F: number, Fs: number) {
      let last: (typeof moments)[number] | undefined;
      for (const m of moments) if (m.f <= F + 1) last = m;
      const mt = last && F - last.f < 12 * FPS ? last.text : '';
      if (mt !== shownMoment) {
        shownMoment = mt;
        $('moment').textContent = mt;
        $('moment').classList.remove('in');
        void $('moment').offsetWidth; // restart its entrance for the new words
        $('moment').classList.add('in');
      }
      $('head').style.left = X(Fs);
      const k = Math.floor(Fs / MIN);
      if (k !== played) {
        played = k;
        drawMomentum();
      }
      track.setAttribute('aria-valuenow', String(Math.round((F / LAST) * 100)));
    },
  };
}
