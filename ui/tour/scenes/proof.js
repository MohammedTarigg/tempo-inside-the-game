// After the features, the proof: four claims, each with one large number read from this run and its checks.
import { seg, smooth, outCubic } from '#util';

// Proof: four cards, one at a time, on black. Each is one claim, one large number and one small motion that shows the
// claim happening. All four at once was about 70 words in 7 seconds, more than twice what anyone can read, with nothing
// large on the page and nothing shown. Every figure is read from this run and its checks.
export function proof(ctx) {
  const { api, M, D, check, name, wrap, cap, veil, side, panel, clearPanel, look } = ctx;
  return {
    dur: D[6],
    enter() {
      api.setPlaying(false);
      cap.classList.remove('on');
      veil.classList.add('on', 'black');
      document.body.classList.add('tproofon');
      look(null); // full black: with the pitch showing through, the cards had to compete with it
      const caught = check('rejects planted errors'),
        rec = check('recovery after a stop at 30%');
      const hits = caught ? (/(\d+) of (\d+)/.exec(caught.detail) || []).slice(1).map(Number) : null,
        same = rec ? +((/(\d+) cues against/.exec(rec.detail) || [])[1] || 0) : 0;
      const g = M.goals[M.goals.length - 1],
        right = g ? g.minute : 72,
        wrong =
          +String(right).split('').reverse().join('') !== right && +String(right).split('').reverse().join('') > 0
            ? +String(right).split('').reverse().join('')
            : right + 9;
      const read = M.event_frames.length,
        fmt = (n) => Math.round(n).toLocaleString('en');
      const card = (claim, viz, cap2) =>
        `<div class="tcard"><h4>${claim}</h4><div class="viz">${viz}</div><b class="num"></b><span>${cap2}</span></div>`;
      const arc = (k) =>
        `<circle r="26" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="46 117.4" transform="rotate(${k * 120 - 90})"/>`;
      side.style.setProperty('--u', `${wrap.clientWidth / 100}px`);
      panel(
        `<div class="tcards">${[
          hits
            ? card(
                'Every word is checked',
                `<p class="line">${g ? name(g.player) : 'He'} scores in minute <i><s>${wrong}</s><u>${right}</u></i></p>`,
                'planted mistakes caught',
              )
            : '',
          card('The screen stays clear', '<canvas></canvas>', 'events made it to the screen'),
          same
            ? card(
                'It survives a crash',
                `<div class="bars">${[38, 62, 24, 50, 30, 70, 44, 26, 56, 34].map((w) => `<i style="width:${w / 10}em"></i>`).join('')}</div>`,
                'items identical after a restart',
              )
            : '',
          card(
            'Silent unless sure',
            `<svg viewBox="-70 -40 140 80">${[0, 1, 2].map((k) => `<g>${arc(k)}</g>`).join('')}<circle r="9" fill="#fff"/></svg>`,
            'checks must agree to give a reason',
          ),
        ].join('')}</div>`,
      );
      side.classList.add('wide');
      const order = [...Array(read).keys()].sort((a, b) => ((a * 2654435761) % 4093) - ((b * 2654435761) % 4093)),
        keep = new Set(order.slice(0, M.shown));
      this.cards = [...side.querySelectorAll('.tcard')].map((el2) => ({ el: el2, num: el2.querySelector('.num') }));
      this.draw = [
        hits &&
          ((c, v) => {
            // a wrong number is struck out and the right one takes its place
            const k = seg(v, 0.3, 0.5);
            c.el.querySelector('s').style.setProperty('--k', k);
            c.el.querySelector('.line i').classList.toggle('fixed', v > 0.56);
            c.num.textContent = `${fmt(hits[0] * smooth(seg(v, 0.12, 0.6)))} of ${fmt(hits[1])}`;
          }),
        (c, v) => {
          // every event read is a dot; all but the ones shown fall away
          const cv = c.el.querySelector('canvas'),
            r = Math.min(devicePixelRatio, 2),
            w = cv.clientWidth,
            h = cv.clientHeight,
            cols = Math.ceil(Math.sqrt((read * w) / h)),
            step = w / cols,
            k = smooth(seg(v, 0.22, 0.7));
          if (cv.width !== Math.round(w * r)) {
            cv.width = Math.round(w * r);
            cv.height = Math.round(h * r);
          }
          const x = cv.getContext('2d');
          x.setTransform(r, 0, 0, r, 0, 0);
          x.clearRect(0, 0, w, h);
          for (let n = 0; n < read; n++) {
            x.globalAlpha = keep.has(n) ? 1 : Math.max(0.05, 1 - k * 1.25);
            x.fillStyle = '#fff';
            x.beginPath();
            x.arc(
              ((n % cols) + 0.5) * step,
              (Math.floor(n / cols) + 0.5) * step,
              step * (keep.has(n) ? 0.3 : 0.22),
              0,
              6.283,
            );
            x.fill();
          }
          c.num.textContent = `${fmt(read + (M.shown - read) * k)} of ${fmt(read)}`;
        },
        same &&
          ((c, v) => {
            // what is on screen goes dark, and comes back exactly as it was
            const off = v > 0.3 && v < 0.54,
              bars = c.el.querySelector('.bars');
            bars.style.opacity = off ? 0 : 1;
            bars.classList.toggle('back', v >= 0.54);
            c.num.style.opacity = off ? 0.12 : 1;
            c.num.textContent = `${fmt(same)} of ${fmt(same)}`;
          }),
        (c, v) => {
          // three separate marks close into one ring, and only then is there a centre
          const gs = c.el.querySelectorAll('svg g');
          let n = 0;
          gs.forEach((gg, k) => {
            const a = smooth(seg(v, 0.14 + k * 0.16, 0.3 + k * 0.16)),
              from = [
                [-46, -10],
                [44, -18],
                [6, 30],
              ][k];
            gg.setAttribute('transform', `translate(${from[0] * (1 - a)} ${from[1] * (1 - a)})`);
            gg.style.opacity = 0.25 + 0.75 * a;
            n += a >= 1;
          });
          c.el.querySelector('svg > circle').style.opacity = seg(v, 0.64, 0.74);
          c.num.textContent = `${n} of 3`;
        },
      ].filter(Boolean);
    },
    update(u) {
      const n = this.cards.length,
        k = Math.min(n - 1, Math.floor(u * n)),
        v = u * n - k;
      this.cards.forEach((c, i) => {
        const on = i === k;
        c.el.style.opacity = on ? Math.min(seg(v, 0, 0.1), 1 - seg(v, 0.93, 1)) : 0;
        c.el.style.transform = on ? `translateY(${(1 - outCubic(seg(v, 0, 0.14))) * 14}px)` : 'none';
        if (on) this.draw[i](c, v);
      });
    },
    exit() {
      clearPanel();
    },
  };
}
