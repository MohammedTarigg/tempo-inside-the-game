// Following: the viewer picks a club or one player and how much detail they want, and the picture, the camera and the phone
// take that side. The same match and the same checked lines reach an analyst and a casual fan as two different things.
// Every number on the followed player's card is the pipeline's: his running ledger, a row a minute.
import { $, el, upper } from '#util';

// Returns what the match view asks each frame: how bright to draw a player, where the camera should sit, whether a line on the
// phone is for this viewer, and a draw(F) for the card. `asked` is the page's query string: ?follow=nor, ?follow=p_har_6, ?view=fan.
export function makeFollow(match, asked) {
  const { M, name, index } = match;
  const clubs = [M.home, M.away],
    L = M.ledgers || { frames: [], dist: [], top: [] };
  let club = -1,
    player = -1;

  const row = $('follow'),
    squad = $('squad'),
    press = (box, on) => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', on(b)));
  function choose(c, p = -1) {
    club = c;
    player = p;
    press(row, (b) => +b.dataset.c === club);
    squad.replaceChildren();
    if (club >= 0) {
      M.ids
        .map((_, i) => i)
        .filter((i) => M.team[i] === club)
        .sort((a, b) => M.numbers[a] - M.numbers[b])
        .forEach((i) => {
          const b = el('button', '', squad, String(M.numbers[i]));
          b.title = name(M.ids[i]);
          b.setAttribute('aria-label', `Follow ${name(M.ids[i])}`);
          b.setAttribute('aria-pressed', i === player);
          b.onclick = () => choose(club, i === player ? -1 : i);
        });
    }
    $('pfollow').style.display = player >= 0 ? 'block' : 'none';
    if (player >= 0) {
      $('wnum').textContent = M.numbers[player];
      $('wwho').textContent = name(M.ids[player]);
      $('wclub').textContent = clubs[club].name;
    }
  }
  row.querySelectorAll('button').forEach((b, k) => {
    if (k > 0) b.textContent = clubs[k - 1].name;
    b.onclick = () => choose(+b.dataset.c);
  });
  $('depth')
    .querySelectorAll('button')
    .forEach((b) => {
      b.onclick = () => {
        document.body.classList.toggle('fan', b.dataset.d === 'fan');
        press($('depth'), (x) => x === b);
      };
    });

  // what the address asked for
  const want = (asked.get('follow') || '').toLowerCase(),
    c0 = clubs.findIndex((c) => c.short.toLowerCase() === want),
    p0 = index(want);
  if (p0 >= 0) choose(M.team[p0], p0);
  else if (c0 >= 0) choose(c0);
  if (asked.get('view') === 'fan') $('depth').querySelector('[data-d="fan"]').click();

  return {
    get player() {
      return player;
    },
    // the followed player at full strength, his club behind him, everyone else further back
    dim: (i) =>
      club < 0 ? 1 : player >= 0 ? (i === player ? 1 : M.team[i] === club ? 0.6 : 0.4) : M.team[i] === club ? 1 : 0.45,
    // a line is for this viewer if it names the followed player, or anyone from the followed club, or names nobody
    wants: (c) => {
      const who = c.payload.names || [];
      if (club < 0 || !who.length) return true;
      return player >= 0 ? who.includes(M.ids[player]) : who.some((pid) => M.team[index(pid)] === club);
    },
    quiet: () =>
      player >= 0
        ? `Nothing about ${name(M.ids[player])} right now`
        : club >= 0
          ? `Nothing about ${clubs[club].name} right now`
          : null,
    draw(F) {
      if (player < 0) return;
      const k = Math.max(0, upper(L.frames, F) - 1),
        booked = M.cards.some((c) => index(c.player) === player && c.frame <= F);
      $('wdist').textContent = L.dist.length ? `${(L.dist[k][player] / 1000).toFixed(1)} km` : '';
      $('wtop').textContent = L.top.length ? `${(L.top[k][player] * 3.6).toFixed(1)} km/h` : '';
      $('wbook').style.display = booked ? 'block' : 'none';
    },
  };
}
