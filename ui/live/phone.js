// The phone beside the picture: the same moment in words, in English or Arabic, with the facts that stand behind each line.
import { $, el } from '#util';
import { proofIcon } from '#live/icons';

// Returns draw(F, sc, clk, top), called once a frame: the frame, the score, the clock in seconds, and the player whose stake
// card is highest right now, if anyone's is on.
export function makePhone(match) {
  const { M, FPS, name, said } = match;
  let mode = 'en',
    shownProof = null;
  document.querySelectorAll('#modes button').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.m;
      document.querySelectorAll('#modes button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    };
  });
  return (F, sc, clk, top) => {
    // ---- the phone: the same moment in words ----
    $('psc').textContent = `${M.home.name} ${sc[0]}, ${M.away.name} ${sc[1]}. Minute ${Math.floor(clk / 60) + 1}`;
    $('pstake').style.display = top ? 'block' : 'none';
    $('eye').setAttribute('cx', top ? 67 : 60);
    if (top) {
      $('pname').textContent = name(M.ids[top.i]);
      $('pcard').className = top.lvl === 2 ? 'full' : '';
      $('ptext').textContent =
        top.lvl === 2
          ? `One foul from a red card. A challenge is likely: about ${Math.round(top.chance * 100)} in 100`
          : 'One foul from a red card, and he is in the play';
      $('meter').firstElementChild.style.width = `${Math.min(100, Math.round(top.chance * 100))}%`;
    }
    const want = (c) => c.payload.lang === mode;
    let line = null;
    for (const c of said) {
      if (c.frame > F) break;
      if (want(c)) line = c;
    }
    const fresh = line && F - line.frame < 40 * FPS;
    $('pbig').textContent = fresh ? line.payload.text : '';
    $('pbig').dir = mode === 'ar' ? 'rtl' : 'ltr';
    const pk = fresh ? line.id : ''; // what stands behind the line: each item is one fact with its number
    if (pk !== shownProof) {
      shownProof = pk;
      $('proof').dir = mode === 'ar' ? 'rtl' : 'ltr';
      $('proof').replaceChildren(
        ...(fresh ? line.payload.proof || [] : []).map((it) => {
          const d = document.createElement('div');
          d.innerHTML = proofIcon(it.icon);
          const w = el('span', '', d);
          el('b', '', w).textContent = it.title;
          el('small', '', w).textContent = it.note;
          el('em', '', d).textContent = it.value;
          return d;
        }),
      );
    }
    $('pquiet').textContent =
      fresh || top ? '' : 'Nothing to add right now. The screen stays clear until there is something worth saying';
    $('note').textContent = M.stake.provisional
      ? 'Provisional stake model'
      : `Stake card levels at ${M.stake.faint} and ${M.stake.full}`;
  };
}
