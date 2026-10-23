// The match as data, with nothing drawn: one run's positions and cues, and the questions the match view asks of them.
// Positions come from match.bin (25 frames a second, whole centimetres) and everything else from match.json.
import { lerp, clamp, upper } from '../shared/util.ts';
import type { Pt } from '../shared/stage.ts';
import type { Action, Cue, DangerWindowPayload, KickoffMarkCue, MatchView, PhoneSentenceCue } from '../types/run.ts';

// A cue the picture shows for a stretch of frames: from `start`, when it goes on, to `end`.
export type Timed<C extends Cue = Cue> = C & { start: number; end: number };
export type CueOf<F extends Cue['form']> = Extract<Cue, { form: F }>;
export interface Moment {
  f: number;
  text: string;
}
export type Match = NonNullable<Awaited<ReturnType<typeof loadMatch>>>;
// A kick-off mark on show. `again` is the late-minutes mark coming back as the match enters those minutes.
export type ShownMark = Timed<KickoffMarkCue> & { again?: boolean };

// Reads runs/<run>/ and returns the match laid out so that any moment can be shown directly, or null if the run cannot be
// fetched. The address is relative to the page, as every address a page fetches is.
export async function loadMatch(run: string) {
  const base = `/runs/${run}/`;
  const [M, buf] = await Promise.all([
    fetch(base + 'match.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('run');
      return r.json() as Promise<MatchView>;
    }),
    fetch(base + 'match.bin', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error('run');
      return r.arrayBuffer();
    }),
  ]).catch((): [null, null] => [null, null]);
  if (!M || !buf) return null;
  const D = new Int16Array(buf),
    ROW = M.row,
    N = M.ids.length,
    FPS = M.fps,
    LAST = M.frames - 1,
    OFF = -32768;
  const name = (pid: string) => M.names[pid] ?? pid,
    index = (pid: string) => M.ids.indexOf(pid),
    teamOf = (subject: string) => (subject === `t_${M.home.short.toLowerCase()}` ? 0 : 1);
  const at = (i: number) => D[i]!;
  // ---- reading the match ----
  const pos = (f: number, i: number): Pt | null => {
    const a = Math.min(LAST, Math.max(0, Math.floor(f))),
      b = Math.min(LAST, a + 1),
      t = clamp(f - a),
      o = 2 * i,
      ax = at(a * ROW + o),
      bx = at(b * ROW + o);
    if (ax === OFF || bx === OFF) return null;
    return [lerp(ax, bx, t) / 100, lerp(at(a * ROW + o + 1), at(b * ROW + o + 1), t) / 100];
  };
  const ballAt = (f: number): [number, number, number] => {
    const a = Math.min(LAST, Math.max(0, Math.floor(f))),
      b = Math.min(LAST, a + 1),
      t = clamp(f - a);
    const v = (k: number) => lerp(at(a * ROW + k), at(b * ROW + k), t) / 100;
    return [v(44), v(45), v(46)];
  };
  const span = (f: number) => M.periods.find((p) => f <= p.last) ?? M.periods[M.periods.length - 1]!;
  const clockAt = (f: number) => {
    const p = span(f);
    return p.clock0 + (f - p.first) / FPS;
  };
  const frameAtClock = (sec: number) => {
    const p = sec >= 2700 && M.periods[1] ? M.periods[1] : M.periods[0]!;
    return Math.min(p.last, Math.max(p.first, p.first + Math.round((sec - p.clock0) * FPS)));
  };
  const liveAt = (f: number) => (upper(M.live_flips, f) % 2 === 0) === M.live0;
  const nextDead = (f: number) => {
    if (!liveAt(f)) return f;
    const k = upper(M.live_flips, f);
    return M.live_flips[k] ?? f;
  };

  // ---- what the cues say, laid out by frame so any moment can be shown directly ----
  // per player: the frames his stake card changed on, and [level, chance] from each
  const stake = Array.from({ length: N }, () => ({ f: [] as number[], v: [] as [number, number][] }));
  const timed: Timed[] = [],
    said: PhoneSentenceCue[] = [],
    marks: Timed<KickoffMarkCue>[] = [],
    shownFrames: number[] = [];
  let danger: DangerWindowPayload | null = null;
  for (const c of M.cues) {
    if (c.status === 'withdrawn') continue;
    if (c.form !== 'stake_card' || c.payload.level > 0) shownFrames.push(c.frame);
    if (c.form === 'stake_card') {
      const s = stake[index(c.payload.player)]!;
      s.f.push(c.frame);
      s.v.push([c.payload.level, c.payload.chance]);
    } else if (c.form === 'sentence') {
      if (c.screen === 'phone') said.push(c);
    } else if (c.form === 'danger_window') danger = c.payload;
    else if (c.form === 'kickoff_mark') marks.push({ ...c, start: 0, end: 0 });
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
  const levelAt = (i: number, f: number): [number, number] => {
    const s = stake[i]!,
      k = upper(s.f, f);
    return k ? s.v[k - 1]! : [0, 0];
  };
  // the cue of this form on the picture at frame f, if any
  const active = <F extends Cue['form']>(form: F, f: number) =>
    timed.find((c): c is Timed<CueOf<F>> => c.form === form && f >= c.start && f < c.end);
  const fade = (c: { start: number; end: number }, f: number, sec = 0.35) =>
    Math.min(clamp((f - c.start) / (sec * FPS)), clamp((c.end - f) / (sec * FPS)));
  const acts: Action[] = M.actions.filter((a) => a.kind === 'tackle' || a.kind === 'foul'),
    actFrames = acts.map((a) => a.frame);
  const downs = M.actions.filter((a) => a.kind === 'down'),
    downFrames = downs.map((a) => a.frame); // a fouled player on the ground

  // the moments worth jumping to, for the Next and Back buttons
  const moments: Moment[] = [{ f: 0, text: 'Before kick-off: three things to watch' }];
  for (const c of timed) {
    if (c.form === 'tag') moments.push({ f: c.start, text: `${name(c.payload.player)}: ${c.payload.text}` });
    else if (c.form === 'duel')
      moments.push({ f: c.start, text: `${name(c.payload.defender)} against ${name(c.payload.attacker)}` });
    else if (c.form === 'form_card')
      moments.push({ f: c.start, text: `${name(c.payload.player)} against his own usual` });
    else if (c.form === 'label') moments.push({ f: c.start, text: c.payload.text });
    else if (c.form === 'halftime_card') moments.push({ f: c.start, text: 'Half time' });
    else if (c.form === 'fulltime_card') moments.push({ f: c.start, text: 'Full time' });
  }
  stake.forEach((s, i) =>
    s.v.forEach((v, k) => {
      if (v[0] === 2 && (!k || s.v[k - 1]![0] !== 2))
        moments.push({ f: s.f[k]!, text: `At stake: ${name(M.ids[i]!)}, a challenge is likely` });
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
