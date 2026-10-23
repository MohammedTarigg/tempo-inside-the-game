// The film's third feature, Speak of the devil: the commentator says a player's name, and his card answers.
import { crestUrl } from '../../shared/stage.ts';
import { portrait } from '../../brand/portrait.ts';
import { el, seg, svgEl } from '../../shared/util.ts';
import type { FormCardCue } from '../../types/run.ts';
import type { FilmCtx, Scene } from '../film.ts';

// The card's outline, from the notch card in the design canvas: a rounded card with a round cut out of its top right
// corner, where a disc sits. W and H are the card's size; a is how far the cut reaches in, R the corners and r the cut's
// own rounding. Drawn with the cut at the top left, then turned over.
const NOTCH = { a: 76, R: 20, r: 45, disc: 62 };
const notch = (W: number, H: number, a: number, R: number, r: number) =>
  `M0,${a + R} A${R},${R} 0 0 1 ${R},${a} L${a - r},${a} A${r},${r} 0 0 0 ${a},${a - r} L${a},${R} A${R},${R} 0 0 1 ${a + R},0` +
  ` L${W - R},0 A${R},${R} 0 0 1 ${W},${R} L${W},${H - R} A${R},${R} 0 0 1 ${W - R},${H} L${R},${H} A${R},${R} 0 0 1 0,${H - R} Z`;

// The commentator speaks at the foot of the picture. Then Tempo's card answers with the player and his numbers.
export function speakOfTheDevil(ctx: FilmCtx): Scene {
  const { api, M, FPS, SCORE, D, form, name, index, wrap, glide, onPlayer, caption, look } = ctx;
  // The commentator's line, spoken at the bottom of the picture, and the card Tempo answers with. Both belong to one feature.
  // The commentator, heard: one quiet bar like a dictation field. At its left a small ring holds six short bars that move
  // with his voice (a bump runs across them as he starts), and his words arrive as they are said: each comes in faint and
  // settles to white, the way a live transcript does. His name is the cue, so once heard it is ringed.
  const speak = el('div', 'tspeak', wrap),
    wave = el('span', 'twave', speak),
    line = el('span', 'tline', speak);
  wave.innerHTML = '<i></i>'.repeat(6);
  const waveBars = [...wave.children] as HTMLElement[],
    level = waveBars.map(() => 0),
    target = waveBars.map(() => 0);
  let spoken: { el: HTMLSpanElement; at: number }[] = [],
    started = -1,
    picked = 0,
    who = 0;
  function speakSet(text: string, cueName: string) {
    line.replaceChildren();
    spoken = text.split(' ').map((w) => {
      const s = el('span', w.replace(/[^\p{L}]/gu, '') === cueName ? 'name' : '', line, w);
      return { el: s, at: 0 };
    });
  }
  function speakDraw(n: number, talking: boolean) {
    const now = performance.now();
    spoken.forEach((w, i) => {
      if (i < n && !w.at) {
        w.at = now;
        w.el.classList.add('in');
      }
      if (w.at && now - w.at > 260) w.el.classList.add('set');
    });
    // the bars: while he talks each one is given a new height every 90 ms, the middle ones a little taller, and eases to it;
    // when he starts, a bump runs across them from left to right first. Silent, they rest as dots
    if (talking && started < 0) started = now;
    if (!talking) started = -1;
    if (now - picked > 90) {
      picked = now;
      target.forEach((_, k) => {
        const middle = 1 - Math.abs(k - 2.5) / 4;
        target[k] = talking ? Math.min(1, (0.25 + Math.random() * 0.75) * (0.6 + 0.4 * middle)) : 0;
      });
    }
    waveBars.forEach((b, k) => {
      level[k]! += (target[k]! - level[k]!) * 0.28;
      const t = started < 0 ? 1e9 : now - started,
        sweep = t < 420 ? Math.exp(-((k - (-1 + (t / 420) * 7.5)) ** 2) / 1.6) : -1,
        h = 3.5 + 16.5 * (sweep >= 0 ? sweep : level[k]!);
      b.style.height = `${h.toFixed(1)}px`;
    });
  }
  const cueSpoken = () => spoken.some((w) => w.el.classList.contains('name') && w.el.classList.contains('set'));
  const pcard = el('div', 'tplayer', wrap);
  function playerCard(c: FormCardCue) {
    // who he is, then his numbers as marks on a scale. No logo: the card is the answer, not a signature
    const p = c.payload,
      i = index(p.player),
      team = M.team[i],
      club = team ? M.away : M.home,
      crest = crestUrl(club.short),
      pc = p.usual_percentile;
    pcard.replaceChildren();
    pcard.style.setProperty('--team', `var(--${team ? 'away' : 'home'})`);
    const top = el('div', 'who', pcard),
      face = el('div', 'face', top);
    face.innerHTML = portrait(
      p.player,
      getComputedStyle(document.documentElement)
        .getPropertyValue(team ? '--away' : '--home')
        .trim(),
    );
    // a drawn face for a fictional player; his shirt number sits in the card's notch, as his marker is on the pitch
    el('b', 'tdisc', pcard, String(M.numbers[i]));
    const id = el('div', '', top);
    el('h3', '', id, name(p.player));
    const t = el('p', '', id);
    if (crest) {
      const im = el('img', '', t);
      im.src = crest;
      im.alt = '';
    }
    t.append(club.name);
    const row = (label: string, value: string, build: (scale: HTMLDivElement) => void) => {
      const r = el('div', 'stat', pcard);
      const h = el('div', '', r);
      el('span', '', h, label);
      el('b', '', h, value);
      build(el('div', 'scale', r));
    };
    row('Distance a minute', `${Math.round(p.per_minute)} m`, (sc) => {
      el('i', 'usual', sc);
      const d = el('i', 'dot', sc);
      d.style.setProperty('--x', `${pc}%`);
    });
    row('Top speed', `${p.top_speed.toFixed(1)} m/s`, (sc) => {
      const f = el('i', 'fill', sc);
      f.style.setProperty('--x', `${Math.min(100, (p.top_speed / 10) * 100)}%`);
    });
    el(
      'small',
      '',
      pcard,
      pc > 60 ? 'Above his own usual today' : pc < 40 ? 'Below his own usual today' : 'Close to his own usual today',
    );
    // the outline, once the card knows its size
    const W = pcard.offsetWidth,
      H = pcard.offsetHeight,
      shape = svgEl(
        'svg',
        { class: 'tnotch', width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
        pcard,
      );
    svgEl('path', { d: notch(W, H, NOTCH.a, NOTCH.R, NOTCH.r), transform: `translate(${W} 0) scale(-1 1)` }, shape);
    pcard.prepend(shape);
  }
  return {
    dur: D[2]!,
    enter() {
      const i = form ? index(form.payload.player) : 0;
      who = i;
      glide((form ? form.start : api.frameAtClock(35 * 60)) - 2 * FPS, 0.5, onPlayer(i), new Set([i]));
      caption('3', 'Speak of the devil', 'Say his name, see his numbers', [['speech', 'Speech recognition', true]]);
      speakSet(form ? form.payload.heard : '', name(M.ids[i]!));
      if (form) playerCard(form);
    },
    update(u) {
      const sp = SCORE.speech,
        local = u * D[2]!;
      if (sp && sp.words.length === spoken.length) {
        // the line is really spoken in the film's sound: each word appears as it is said
        const k = local - sp.at;
        speakDraw(sp.words.filter((w: number) => w <= k).length, k > -0.05 && k < sp.len);
      } else {
        const n = u < 0.25 ? 0 : Math.min(spoken.length, 1 + Math.floor((spoken.length - 1) * seg(u, 0.25, 0.5))); // no recording: the line arrives a word at a time, as speech does
        speakDraw(n, u > 0.24 && u < 0.53);
      }
      speak.classList.toggle('on', u > 0.1875 && u < 0.69);
      pcard.classList.toggle('on', cueSpoken() && u < 0.97); // the card answers the moment his name has been heard
      const p = api.pos(api.getF(), who);
      if (p) look(api.project(p[0], 0, -p[1]));
    },
    exit() {
      speak.classList.remove('on');
      pcard.classList.remove('on');
    },
  };
}
