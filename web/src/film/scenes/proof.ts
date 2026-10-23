// After the features, the proof: four claims, each with one large number read from this run and its checks.
import { seg, smooth, outCubic } from '../../shared/util.ts';
import type { FilmCtx, Scene } from '../film.ts';

interface Card {
  el: HTMLElement;
  num: HTMLElement;
}
type Draw = (c: Card, v: number) => void;

// Proof: four cards, one at a time, on black. Each is one claim, one large number and one small motion that shows the
// claim happening. All four at once was about 70 words in 7 seconds, more than twice what anyone can read, with nothing
// large on the page and nothing shown. Every figure is read from this run and its checks.
export function proof(ctx: FilmCtx): Scene {
  const { api, M, D, check, name, wrap, cap, veil, side, logo, panel, clearPanel, look } = ctx;
  let cards: Card[] = [],
    draw: Draw[] = [];
  return {
    dur: D[6]!,
    enter() {
      api.setPlaying(false);
      cap.classList.remove('on');
      veil.classList.add('on', 'black');
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
        fmt = (n: number) => Math.round(n).toLocaleString('en');
      const card = (claim: string, viz: string, cap2: string) =>
        `<div class="tcard"><h4>${claim}</h4><div class="viz">${viz}</div><b class="num"><span></span></b><span class="say">${cap2}</span></div>`;
      const arc = (k: number) =>
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
      cards = [...side.querySelectorAll<HTMLElement>('.tcard')].map((el2) => ({
        el: el2,
        num: el2.querySelector<HTMLElement>('.num span')!,
      }));
      const drawn: (Draw | false)[] = [
        hits !== null &&
          ((c, v) => {
            // a wrong number is struck out and the right one takes its place
            const k = seg(v, 0.3, 0.5);
            c.el.querySelector('s')!.style.setProperty('--k', String(k));
            c.el.querySelector('.line i')!.classList.toggle('fixed', v > 0.56);
            c.num.textContent = `${fmt(hits[0]! * smooth(seg(v, 0.12, 0.6)))} of ${fmt(hits[1]!)}`;
          }),
        (c, v) => {
          // every event read is a dot; all but the ones shown fall away
          const cv = c.el.querySelector('canvas')!,
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
          const x = cv.getContext('2d')!;
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
        same > 0 &&
          ((c, v) => {
            // what is on screen goes dark, and comes back exactly as it was
            const off = v > 0.3 && v < 0.54,
              bars = c.el.querySelector<HTMLElement>('.bars')!;
            bars.style.opacity = off ? '0' : '1';
            bars.classList.toggle('back', v >= 0.54);
            c.num.style.opacity = off ? '0.12' : '1';
            c.num.textContent = `${fmt(same)} of ${fmt(same)}`;
          }),
        (c, v) => {
          // three separate marks close into one ring, and only then is there a centre
          const gs = c.el.querySelectorAll<SVGGElement>('svg g');
          let n = 0;
          gs.forEach((gg, k) => {
            const a = smooth(seg(v, 0.14 + k * 0.16, 0.3 + k * 0.16)),
              from = (
                [
                  [-46, -10],
                  [44, -18],
                  [6, 30],
                ] as const
              )[k] ?? [0, 0];
            gg.setAttribute('transform', `translate(${from[0] * (1 - a)} ${from[1] * (1 - a)})`);
            gg.style.opacity = String(0.25 + 0.75 * a);
            n += a >= 1 ? 1 : 0;
          });
          c.el.querySelector<SVGCircleElement>('svg > circle')!.style.opacity = String(seg(v, 0.64, 0.74));
          c.num.textContent = `${n} of 3`;
        },
      ];
      draw = drawn.filter((d): d is Draw => !!d);
    },
    update(u) {
      const n = cards.length;
      // each part of the card comes and goes in its own way (film.css): the claim is written on and wiped off, the
      // picture rises and sinks, the number rolls up into its box and on up out of it, the line is written on. They run
      // from the film's clock, so the film can be stopped or started anywhere and still be right
      cards.forEach((c, i) => {
        // each card's own clock, running a little past both ends of its turn. Over the change from one card to the next
        // only the numbers meet: the old one rolls up out of its box as the new one rolls up into it, like a scoreboard
        // digit. The claim, the picture and the line hand over one after the other
        const w = u * n - i,
          first = i === 0,
          last = i === n - 1,
          on = w > (first ? 0 : -0.06) && w < (last ? 0.96 : 1.06);
        c.el.style.opacity = on ? '1' : '0';
        if (!on) return;
        c.el.style.setProperty('--in', outCubic(seg(w, 0.02, 0.13)).toFixed(3));
        c.el.style.setProperty('--in2', outCubic(seg(w, 0.08, 0.22)).toFixed(3));
        c.el.style.setProperty('--out', (seg(w, last ? 0.82 : 0.9, last ? 0.95 : 0.99) ** 2).toFixed(3));
        c.el.style.setProperty('--nin', outCubic(seg(w, first ? 0 : -0.06, 0.06)).toFixed(3));
        c.el.style.setProperty('--nout', (last ? seg(w, 0.82, 0.95) : seg(w, 0.94, 1.06)).toFixed(3));
        draw[i]?.(c, Math.min(1, Math.max(0, w)));
      });
      // as the last card leaves, the logo is already on its way from the corner to the middle for the close
      if (u > 0.95) logo.classList.add('centre');
    },
    exit() {
      clearPanel();
    },
  };
}
