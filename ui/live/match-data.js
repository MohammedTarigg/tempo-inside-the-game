// The match as data, with nothing drawn: one run's positions and cues, and the questions the match view asks of them.
// Positions come from match.bin (25 frames a second, whole centimetres) and everything else from match.json.
import { lerp, clamp, upper } from '#util';

// Reads runs/<run>/ and returns the match laid out so that any moment can be shown directly, or null if the run cannot be
// fetched. The address is relative to the page, as every address a page fetches is.
export async function loadMatch(run) {
  const base = `../../runs/${run}/`;
  const [M, buf] = await Promise.all([
    fetch(base + 'match.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('run');
      return r.json();
    }),
    fetch(base + 'match.bin', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('run');
      return r.arrayBuffer();
    }),
  ]).catch(() => [null, null]);
  if (!M) return null;
  const D = new Int16Array(buf),
    ROW = M.row,
    N = M.ids.length,
    FPS = M.fps,
    LAST = M.frames - 1,
    OFF = -32768;
  const name = (pid) => M.names[pid],
    index = (pid) => M.ids.indexOf(pid),
    teamOf = (subject) => (subject === `t_${M.home.short.toLowerCase()}` ? 0 : 1);
  // ---- reading the match ----
  const pos = (f, i) => {
    const a = Math.min(LAST, Math.max(0, Math.floor(f))),
      b = Math.min(LAST, a + 1),
      t = clamp(f - a),
      o = 2 * i,
      ax = D[a * ROW + o],
      bx = D[b * ROW + o];
    if (ax === OFF || bx === OFF) return null;
    return [lerp(ax, bx, t) / 100, lerp(D[a * ROW + o + 1], D[b * ROW + o + 1], t) / 100];
  };
  const ballAt = (f) => {
    const a = Math.min(LAST, Math.max(0, Math.floor(f))),
      b = Math.min(LAST, a + 1),
      t = clamp(f - a);
    return [44, 45, 46].map((k) => lerp(D[a * ROW + k], D[b * ROW + k], t) / 100);
  };
  const span = (f) => M.periods.find((p) => f <= p.last) || M.periods[M.periods.length - 1];
  const clockAt = (f) => {
    const p = span(f);
    return p.clock0 + (f - p.first) / FPS;
  };
  const frameAtClock = (sec) => {
    const p = sec >= 2700 && M.periods[1] ? M.periods[1] : M.periods[0];
    return Math.min(p.last, Math.max(p.first, p.first + Math.round((sec - p.clock0) * FPS)));
  };
  const liveAt = (f) => (upper(M.live_flips, f) % 2 === 0) === M.live0;
  const nextDead = (f) => {
    if (!liveAt(f)) return f;
    const k = upper(M.live_flips, f);
    return k < M.live_flips.length ? M.live_flips[k] : f;
  };

  // ---- what the cues say, laid out by frame so any moment can be shown directly ----
  const stake = Array.from({ length: N }, () => ({ f: [], v: [] })); // per player: frames and [level, chance]
  const timed = [],
    said = [],
    marks = [],
    shownFrames = [];
  let danger = null;
  for (const c of M.cues) {
    if (c.status === 'withdrawn') continue;
    if (c.form !== 'stake_card' || c.payload.level > 0) shownFrames.push(c.frame);
    if (c.form === 'stake_card') {
      const s = stake[index(c.payload.player)];
      s.f.push(c.frame);
      s.v.push([c.payload.level, c.payload.chance]);
    } else if (c.form === 'sentence') {
      if (c.screen === 'phone') said.push(c);
    } else if (c.form === 'danger_window') danger = c.payload;
    else if (c.form === 'kickoff_mark') marks.push(c);
    else {
      const start =
        c.when === 'next_pause' ? nextDead(c.frame) : c.when === 'next_replay' ? c.frame + 2 * FPS : c.frame;
      timed.push({ ...c, start, end: start + c.valid_for * FPS });
    }
  }
  marks.forEach((c, i) => {
    c.start = i * 8 * FPS;
    c.end = c.start + 8 * FPS;
  }); // the three kick-off marks take turns
  const lateMark = marks.find((c) => c.payload.mark === 'window');
  shownFrames.sort((a, b) => a - b);
  const levelAt = (i, f) => {
    const k = upper(stake[i].f, f);
    return k ? stake[i].v[k - 1] : [0, 0];
  };
  const active = (form, f) => timed.find((c) => c.form === form && f >= c.start && f < c.end);
  const fade = (c, f, sec = 0.35) => Math.min(clamp((f - c.start) / (sec * FPS)), clamp((c.end - f) / (sec * FPS)));
  const acts = M.actions.filter((a) => a.kind === 'tackle' || a.kind === 'foul'),
    actFrames = acts.map((a) => a.frame);
  const downs = M.actions.filter((a) => a.kind === 'down'),
    downFrames = downs.map((a) => a.frame); // a fouled player on the ground

  // the moments worth jumping to, for the Next and Back buttons
  const moments = [{ f: 0, text: 'Before kick-off: three things to watch' }];
  for (const c of timed) {
    const p = c.payload;
    if (c.form === 'tag') moments.push({ f: c.start, text: `${name(p.player)}: ${p.text}` });
    else if (c.form === 'duel') moments.push({ f: c.start, text: `${name(p.defender)} against ${name(p.attacker)}` });
    else if (c.form === 'form_card') moments.push({ f: c.start, text: `${name(p.player)} against his own usual` });
    else if (c.form === 'label') moments.push({ f: c.start, text: p.text });
    else if (c.form === 'halftime_card') moments.push({ f: c.start, text: 'Half time' });
    else if (c.form === 'fulltime_card') moments.push({ f: c.start, text: 'Full time' });
  }
  stake.forEach((s, i) =>
    s.v.forEach((v, k) => {
      if (v[0] === 2 && (!k || s.v[k - 1][0] !== 2))
        moments.push({ f: s.f[k], text: `At stake: ${name(M.ids[i])}, a challenge is likely` });
    }),
  );
  moments.sort((a, b) => a.f - b.f);

  return {
    M,
    N,
    FPS,
    LAST,
    name,
    index,
    teamOf,
    pos,
    ballAt,
    span,
    clockAt,
    frameAtClock,
    stake,
    timed,
    said,
    marks,
    lateMark,
    danger,
    shownFrames,
    levelAt,
    active,
    fade,
    acts,
    actFrames,
    downs,
    downFrames,
    moments,
  };
}
