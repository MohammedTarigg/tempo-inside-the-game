// The film's third feature, Speak of the devil: the commentator says a player's name, and his card answers.
import { CRESTS } from '#stage';
import { portrait } from '#portrait';
import { el, seg } from '#util';

// The commentator speaks at the foot of the picture. Then Tempo's card answers with the player and his numbers.
export function speakOfTheDevil(ctx) {
  const { api, M, FPS, SCORE, D, form, name, index, wrap, glide, onPlayer, caption, look } = ctx;
  // The commentator's line, spoken at the bottom of the picture, and the card Tempo answers with. Both belong to one feature.
  // The commentator, heard: a small live waveform and his words arriving as they are spoken. A word comes in grey and firms to
  // white a moment later, the way a live transcript settles. The player's name is the cue, so it is the one word that is marked.
  const speak = el('div', 'tspeak', wrap),
    wave = el('span', 'twave', speak),
    line = el('span', 'tline', speak);
  wave.innerHTML = '<i></i>'.repeat(9);
  const waveBars = [...wave.children];
  let spoken = [],
    pulse = 0;
  function speakSet(text, cueName) {
    line.replaceChildren();
    spoken = text.split(' ').map((w) => {
      const s = el('span', w.replace(/[^\p{L}]/gu, '') === cueName ? 'name' : '', line, w);
      return { el: s, at: 0 };
    });
  }
  function speakDraw(n, talking) {
    const now = performance.now();
    spoken.forEach((w, i) => {
      if (i < n && !w.at) {
        w.at = now;
        w.el.classList.add('in');
        pulse = now;
      }
      if (w.at && now - w.at > 260) w.el.classList.add('set');
    });
    const t = now / 1000,
      kick = Math.exp(-(now - pulse) / 160); // each word gives the wave a push, then it settles
    waveBars.forEach((b, k) => {
      const shape = 1 - Math.abs(k - 4) / 6.5,
        level = talking
          ? 0.28 + 0.5 * Math.abs(Math.sin(t * 7.3 + k * 1.7) * Math.sin(t * 3.1 + k * 0.9)) + 0.35 * kick
          : 0;
      b.style.transform = `scaleY(${(0.1 + 0.9 * Math.min(1, level) * shape).toFixed(3)})`;
    });
  }
  const cueSpoken = () => spoken.some((w) => w.el.classList.contains('name') && w.el.classList.contains('set'));
  const pcard = el('div', 'tplayer', wrap);
  function playerCard(c) {
    // who he is, then his numbers as marks on a scale. No logo: the card is the answer, not a signature
    const p = c.payload,
      i = index(p.player),
      team = M.team[i],
      club = team ? M.away : M.home,
      crest = CRESTS[club.short.toLowerCase()],
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
    el('b', '', face, String(M.numbers[i])); // a drawn face for a fictional player
    const id = el('div', '', top);
    el('h3', '', id, name(p.player));
    const t = el('p', '', id);
    if (crest) {
      const im = el('img', '', t);
      im.src = `../brand/${crest}`;
      im.alt = '';
    }
    t.append(club.name);
    const row = (label, value, build) => {
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
  }
  return {
    dur: D[2],
    enter() {
      const i = form ? index(form.payload.player) : 0;
      this.i = i;
      this.said = -1;
      glide((form ? form.start : api.frameAtClock(35 * 60)) - 2 * FPS, 0.5, onPlayer(i), new Set([i]));
      caption('3', 'Speak of the devil', 'Say his name, see his numbers', [['speech', 'Speech recognition', true]]);
      speakSet(form ? form.payload.heard : '', name(M.ids[i]));
      if (form) playerCard(form);
    },
    update(u) {
      const sp = SCORE.speech,
        local = u * D[2];
      if (sp && sp.words.length === spoken.length) {
        // the line is really spoken in the film's sound: each word appears as it is said
        const k = local - sp.at;
        speakDraw(sp.words.filter((w) => w <= k).length, k > -0.05 && k < sp.len);
      } else {
        const n = u < 0.25 ? 0 : Math.min(spoken.length, 1 + Math.floor((spoken.length - 1) * seg(u, 0.25, 0.5))); // no recording: the line arrives a word at a time, as speech does
        speakDraw(n, u > 0.24 && u < 0.53);
      }
      speak.classList.toggle('on', u > 0.1875 && u < 0.69);
      pcard.classList.toggle('on', cueSpoken() && u < 0.97); // the card answers the moment his name has been heard
      const p = api.pos(api.getF(), this.i);
      if (p) look(api.project(p[0], 0, -p[1]));
    },
    exit() {
      speak.classList.remove('on');
      pcard.classList.remove('on');
    },
  };
}
