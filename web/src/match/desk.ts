// The producer's desk, at /desk/: in place of the phone's words, every item the cue service considered, newest first, as it
// aired or with the short reason it was held. It reads the run's own audit (desk in match.json). The picture does not change.
import { $, el, upper } from '../shared/util.ts';
import type { Match } from './data.ts';
import type { DeskRow } from '../types/run.ts';

const KIND: Record<string, string> = {
  stake_card: 'Stake',
  tag: 'Number',
  duel: 'Duel',
  label: 'Label',
  sentence: 'Line',
  form_card: 'Form',
  pressure: 'Pressure',
  kickoff_mark: 'Kick-off call',
  danger_window: 'Late minutes',
  halftime_card: 'Half time',
  fulltime_card: 'Full time',
  scene: 'Replay',
  reason: 'Reason',
};
const STATUS: Record<DeskRow['status'], string> = {
  shown: 'Shown',
  template: 'Template',
  held: 'Held',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
};

// Returns draw(F), called once a frame. The desk is a line that starts at now, beside the play button, and runs back
// through the match: each item considered is a stop on it, newest first, with its minute, a pill for what kind of item it
// was and one for what became of it (solid when it aired, an outline when it was held), and the reason under them. Older
// stops fade as they run off. When an item arrives it comes in at the now end and the line slides along to make room.
export function makeDesk(match: Match) {
  const { M, clockAt, shownFrames } = match,
    rows = M.desk || [],
    at = rows.map((r) => r.frame),
    heldAt = rows.filter((r) => r.status === 'held').map((r) => r.frame),
    list = $('drows'),
    nowEl = $('dnow');
  let upto = -1,
    minute = -1;
  const stop = (r: DeskRow, i: number) => {
    const li = document.createElement('li');
    li.className = r.status;
    li.dataset.i = String(i);
    el('i', 'node', li);
    const top = el('div', 'top', li);
    el('span', 'mn', top, `${Math.floor(clockAt(r.frame) / 60) + 1}'`);
    el('span', 'pill kind', top, KIND[r.form] || r.form);
    el('span', `pill st`, top, STATUS[r.status]);
    el('small', '', li, r.why ?? r.what);
    return li;
  };
  return (F: number) => {
    const m = Math.floor(clockAt(F) / 60) + 1;
    if (m !== minute) {
      minute = m;
      nowEl.dataset.m = `${m}'`;
    }
    $('dshown').textContent = String(upper(shownFrames, F));
    $('dheld').textContent = String(upper(heldAt, F));
    const n = upper(at, F);
    if (n === upto) return;
    // where each stop stood, so the ones that stay slide to their new places rather than jump
    const was = new Map(
      [...list.children].map((li) => [(li as HTMLElement).dataset.i, li.getBoundingClientRect().left]),
    );
    const forward = upto >= 0 && n > upto && n - upto <= 3;
    upto = n;
    list.replaceChildren(
      ...rows
        .slice(Math.max(0, n - 14), n)
        .map((r, k, a) => stop(r, n - a.length + k))
        .reverse(),
    );
    const box = list.getBoundingClientRect();
    [...list.children].forEach((node, k) => {
      const li = node as HTMLElement,
        r = li.getBoundingClientRect();
      li.style.setProperty('--age', String(k));
      const from = was.get(li.dataset.i);
      if (forward && from !== undefined && from !== r.left)
        li.animate([{ transform: `translateX(${from - r.left}px)` }, { transform: 'none' }], {
          duration: 520,
          easing: 'cubic-bezier(0.2, 0.75, 0.2, 1)',
        });
      else if (forward && from === undefined) li.classList.add('new');
      if (r.left > box.right) li.remove(); // past the end of the line: gone
    });
  };
}
