// Half time: the card that covers the picture, one panel for each thing still open. Full time is the strip's own chart.
import { crestUrl } from '../shared/stage.ts';
import { $, el } from '../shared/util.ts';
import { cardIcon } from './icons.ts';
import type { Club, HalftimeCue, MatchView } from '../types/run.ts';
import { present } from './presence.ts';

// Returns interval(card, score): shows that card's panel, or hides the panel when there is no card. It builds the panel only
// when the card changes.
export function makeInterval(M: MatchView) {
  const crest = (club: Club) => {
    const url = crestUrl(club.short);
    return url ? `<img src="${url}" alt="" width="34" height="34">` : '';
  };

  let intervalShown: HalftimeCue | null = null;
  function interval(c: HalftimeCue | null, sc: number[]) {
    if (c === intervalShown) return;
    intervalShown = c;
    present($('interval'), !!c, 'flex');
    if (!c) return;
    $('ih').textContent = 'Half time';
    $('ip').innerHTML = `${crest(M.home)}<span></span>${crest(M.away)}`;
    $('ip').querySelector('span')!.textContent = `${M.home.name} ${sc[0]}, ${M.away.name} ${sc[1]}`;
    $('cards').replaceChildren(
      ...c.payload.cards.map((k) => {
        const a = document.createElement('article');
        a.innerHTML = cardIcon(k.mark);
        const h = el('h3', '', a),
          p = el('p', '', a);
        h.textContent = k.title;
        p.textContent = k.text;
        return a;
      }),
    );
  }

  return interval;
}
