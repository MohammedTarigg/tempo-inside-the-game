// Following: the viewer picks a club or one player, and the picture, the camera and the phone take that side. The same
// match and the same checked lines reach two viewers as two different things. There is no casual and analyst switch: that
// was tried and dropped, because the two versions barely differed and every line already carries its proof.
// Every number on the followed player's card is the pipeline's: his running ledger, a row a minute.
import { $, el, upper } from '../shared/util.ts';
import type { Match } from './data.ts';
import type { PhoneSentenceCue } from '../types/run.ts';
import { present } from './presence.ts';

export type Follow = ReturnType<typeof makeFollow>;

// Returns what the match view asks each frame: how bright to draw a player, where the camera should sit, whether a line on the
// phone is for this viewer, and a draw(F) for the card. `asked` is the page's query string: ?follow=nor or ?follow=p_har_6.
export function makeFollow(match: Match, asked: URLSearchParams) {
  const { M, name, index } = match;
  const clubs = [M.home, M.away],
    L = M.ledgers;
  let club = -1,
    player = -1;

  const row = $('follow'),
    squad = $('squad'),
    press = (box: HTMLElement, on: (b: HTMLButtonElement) => boolean) =>
      box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(on(b))));
  function choose(c: number, p = -1) {
    club = c;
    player = p;
    press(row, (b) => Number(b.dataset.c) === club);
    squad.replaceChildren();
    $('prefs').classList.toggle('open', club >= 0);
    if (club >= 0) {
      M.ids
        .map((_, i) => i)
        .filter((i) => M.team[i] === club)
        .sort((a, b) => M.numbers[a]! - M.numbers[b]!)
        .forEach((i, k) => {
          const b = el('button', '', squad, String(M.numbers[i]));
          b.style.setProperty('--k', String(k));
          b.title = name(M.ids[i]);
          b.setAttribute('aria-label', `Follow ${name(M.ids[i])}`);
          b.setAttribute('aria-pressed', String(i === player));
          b.onclick = () => choose(club, i === player ? -1 : i);
        });
    }
    present($('pfollow'), player >= 0);
    if (player >= 0) {
      $('wnum').textContent = String(M.numbers[player]);
      $('wwho').textContent = name(M.ids[player]);
      $('wclub').textContent = clubs[club].name;
    }
  }
  row.querySelectorAll('button').forEach((b, k) => {
    if (k > 0) b.textContent = clubs[k - 1].name;
    b.onclick = () => choose(Number(b.dataset.c));
  });
  // what the address asked for
  const want = (asked.get('follow') || '').toLowerCase(),
    c0 = clubs.findIndex((c) => c.short.toLowerCase() === want),
    p0 = index(want);
  if (p0 >= 0) choose(M.team[p0], p0);
  else if (c0 >= 0) choose(c0);

  return {
    get player() {
      return player;
    },
    // the followed player at full strength, his club behind him, everyone else further back
    dim: (i: number) =>
      club < 0 ? 1 : player >= 0 ? (i === player ? 1 : M.team[i] === club ? 0.6 : 0.4) : M.team[i] === club ? 1 : 0.45,
    // a line is for this viewer if it names the followed player, or anyone from the followed club, or names nobody
    wants: (c: PhoneSentenceCue) => {
      const who = c.payload.names;
      if (club < 0 || !who.length) return true;
      return player >= 0 ? who.includes(M.ids[player]) : who.some((pid) => M.team[index(pid)] === club);
    },
    draw(F: number) {
      if (player < 0) return;
      const k = Math.max(0, upper(L.frames, F) - 1),
        booked = M.cards.some((c) => index(c.player) === player && c.frame <= F);
      $('wdist').textContent = L.dist.length ? `${(L.dist[k][player] / 1000).toFixed(1)} km` : '';
      $('wtop').textContent = L.top.length ? `${(L.top[k][player] * 3.6).toFixed(1)} km/h` : '';
      const [made, tried] = L.passes[k]?.[player] ?? [0, 0];
      $('wpass').textContent = tried ? `${made} of ${tried}` : 'None yet';
      $('wbook').style.display = booked ? 'block' : 'none';
    },
  };
}
