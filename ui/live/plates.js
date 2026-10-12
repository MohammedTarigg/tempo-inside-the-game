// What the picture says about the play in front of it: the label in the lower left, the line under a player that shows how
// rare his shot or sprint was, the score of a duel between two players, and a player's form card.
import { project } from '#stage';
import { $, clamp } from '#util';
import { pin, place } from '#live/pins';

// Returns draw(F, shown, plain), called once a frame. shown is where each player is drawn, and plain is true when a director
// wants the players and the ball with none of these on them.
export function makePlates(match) {
  const { M, FPS, name, index, pos, active, fade } = match;
  const tagEl = pin('plate'),
    duelEl = pin('plate');
  tagEl.id = 'tag';
  duelEl.id = 'duel';
  tagEl.className = 'pin';
  tagEl.innerHTML = '<i class="line"></i><u class="usual"></u><u class="rare"></u><i class="dot"></i><b></b>';
  return (F, shown, plain) => {
    const lab = !plain && active('label', F);
    $('label').style.display = lab ? 'grid' : 'none';
    $('label').classList.toggle('on', !!lab);
    if (lab) {
      $('label').textContent = lab.payload.text;
      $('label').classList.toggle('booking', / booked$/.test(lab.payload.text));
    }
    const tg = !plain && active('tag', F),
      tp = tg && shown[index(tg.payload.player)];
    if (tp && tg.payload.rare) {
      const m = tg.payload,
        span = m.rare - m.usual,
        lo = Math.max(0, m.usual - 1.5 * span),
        top = Math.max(m.value, m.rare) + 0.2 * span,
        at = (x) => ((x - lo) / (top - lo)) * 100,
        go = 1 - (1 - clamp((F - tg.start) / (0.9 * FPS))) ** 3; // the line starts a little below the usual, so the usual sits near its middle; the dot runs out along it to his value
      if (tagEl.dataset.id !== tg.id) {
        tagEl.dataset.id = tg.id;
        tagEl.style.setProperty('--team', `var(--${M.team[index(m.player)] ? 'away' : 'home'})`);
        tagEl.style.setProperty('--usual', `${at(m.usual)}%`);
        tagEl.style.setProperty('--rare', `${at(m.rare)}%`);
        tagEl.querySelector('b').textContent = `${Math.round(m.value)} ${m.unit}`;
      }
      tagEl.style.setProperty('--at', `${at(m.value) * go}%`);
      tagEl.classList.toggle('past', at(m.value) * go >= at(m.rare));
      place(tagEl, project(tp[0], 0, -tp[1]), fade(tg, F), '-50%', '0', 26);
    } else tagEl.style.opacity = 0;
    const du = !plain && active('duel', F),
      da = du && pos(F, index(du.payload.defender)),
      db = du && pos(F, index(du.payload.attacker));
    if (da && db) {
      duelEl.replaceChildren(
        Object.assign(document.createElement('b'), {
          textContent: `${du.payload.defender_won} v ${du.payload.attacker_won}`,
        }),
        Object.assign(document.createElement('small'), {
          textContent: `${name(du.payload.defender)} against ${name(du.payload.attacker)}, duels won`,
        }),
      );
      place(duelEl, project((da[0] + db[0]) / 2, 0, -(da[1] + db[1]) / 2), fade(du, F), '-50%', '-100%', -30);
    } else duelEl.style.opacity = 0;
    const fc = !plain && active('form_card', F);
    $('form').style.display = fc ? 'grid' : 'none';
    $('form').classList.toggle('on', !!fc);
    if (fc) {
      const p = fc.payload,
        pc = p.usual_percentile;
      $('fname').textContent = `${name(p.player)} ${M.numbers[index(p.player)]}`;
      $('fval').textContent =
        `${Math.round(p.per_minute)} m a minute. ${pc > 60 ? 'Above his usual today' : pc < 40 ? 'Below his usual today' : 'Close to his usual today'}`;
      $('fdot').style.left = `${pc}%`;
      $('fheard').textContent = `Heard from the commentator: "${p.heard}"`;
    }
  };
}
