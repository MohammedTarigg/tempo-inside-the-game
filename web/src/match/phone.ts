// The phone, in the row under the picture: the same moment in words, in English or Arabic, with the facts that stand behind each line.
import { $, el } from '../shared/util.ts';
import { proofIcon } from './icons.ts';
import type { Match } from './data.ts';
import type { Follow } from './follow.ts';
import type { PhoneSentenceCue, Proof } from '../types/run.ts';
import { present } from './presence.ts';

// The player whose stake card is highest right now: his index, its level and the chance of a challenge.
export interface TopStake {
  i: number;
  lvl: number;
  chance: number;
}

// Returns draw(F, sc, clk, top), called once a frame: the frame, the score, the clock in seconds, and the player whose stake
// card is highest right now, if anyone's is on.
export function makePhone(match: Match, follow: Follow) {
  const { M, FPS, name, said } = match;
  let mode = 'en',
    shownProof: string | null = null;
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.m ?? 'en';
      document.querySelectorAll('#modes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  return (F: number, sc: number[], clk: number, top: TopStake | null) => {
    // ---- the phone: the same moment in words ----
    $('psc').textContent = `${M.home.name} ${sc[0]}, ${M.away.name} ${sc[1]}. Minute ${Math.floor(clk / 60) + 1}`;
    present($('pstake'), !!top);
    document.getElementById('eye')?.setAttribute('cx', String(top ? 66 : 60));
    if (top) {
      $('pname').textContent = name(M.ids[top.i]);
      $('pcard').className = top.lvl === 2 ? 'full' : '';
      $('ptext').textContent =
        top.lvl === 2
          ? `One foul from a red card. A challenge is likely: about ${Math.round(top.chance * 100)} in 100`
          : 'One foul from a red card, and he is in the play';
      $('meter').querySelector('i')!.style.width = `${Math.min(100, Math.round(top.chance * 100))}%`;
    }
    const want = (c: PhoneSentenceCue) => c.payload.lang === mode && follow.wants(c);
    let line: PhoneSentenceCue | null = null;
    for (const c of said) {
      if (c.frame > F) break;
      if (want(c)) line = c;
    }
    const fresh: PhoneSentenceCue | null = line && F - line.frame < 40 * FPS ? line : null;
    present($('pline'), !!fresh);
    if (fresh) {
      $('pbig').textContent = fresh.payload.text;
      $('pbig').dir = mode === 'ar' ? 'rtl' : 'ltr';
    }
    const pk = fresh ? fresh.id : ''; // what stands behind the line: each item is one fact with its number, kept as it leaves
    if (fresh && pk !== shownProof) {
      shownProof = pk;
      $('proof').dir = mode === 'ar' ? 'rtl' : 'ltr';
      $('proof').replaceChildren(
        ...fresh.payload.proof.map((it: Proof, k) => {
          const d = document.createElement('div');
          d.style.setProperty('--k', String(k));
          d.innerHTML = proofIcon(it.icon);
          const w = el('span', '', d);
          el('b', '', w).textContent = it.title;
          el('small', '', w).textContent = it.note;
          el('em', '', d).textContent = it.value;
          return d;
        }),
      );
    }
    follow.draw(F);
  };
}
