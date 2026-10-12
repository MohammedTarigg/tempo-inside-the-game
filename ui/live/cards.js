// Half time and full time: the cards that cover the picture, one for each turning point the pipeline chose.
import { CRESTS } from '#stage';
import { $, el } from '#util';
import { cardIcon } from '#live/icons';

// Returns interval(card, score): shows that card's panel, or hides the panel when there is no card. It builds the panel only
// when the card changes.
export function makeInterval(M) {
  const crest = (club) => {
    const f = CRESTS[club.short.toLowerCase()];
    return f ? `<img src="../brand/${f}" alt="" width="34" height="34">` : '';
  };

  let intervalShown = null;
  function interval(c, sc) {
    if (c === intervalShown) return;
    intervalShown = c;
    $('interval').style.display = c ? 'flex' : 'none';
    if (!c) return;
    $('ih').textContent = c.form === 'halftime_card' ? 'Half time' : 'Turning points';
    $('ip').innerHTML = `${crest(M.home)}<span></span>${crest(M.away)}`;
    $('ip').querySelector('span').textContent =
      `${c.form === 'halftime_card' ? '' : 'Full time. '}${M.home.name} ${sc[0]}, ${M.away.name} ${sc[1]}`;
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
