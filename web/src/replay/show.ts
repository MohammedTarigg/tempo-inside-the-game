// The replay as a show: its phases and how long each lasts, what is on the pitch at any second of it, and the words that
// go with each phase. Every number comes from the scene the pipeline wrote.
import { lerp, clamp, smooth } from '../shared/util.ts';
import { startLead } from './start.ts';
import type { Clip, ReplayScene } from '../types/run.ts';

export type Phase = 'stop' | 'back' | 'then' | 'thenhold' | 'rewind' | 'now' | 'diff' | 'finish' | 'hold';
// What is on the pitch at one second of the show. a: what the solid markers show, as a clip and a frame of it. b: what
// they are on the way to, u of the way there. ghost: how strongly the earlier attempt's end is drawn. gap: how far the
// measured distance is drawn in.
export interface ShowState {
  ph: Phase;
  a: [Clip, number];
  b?: [Clip, number];
  u: number;
  ghost: number;
  rate: number;
  clock: number;
  card: number;
  gap?: number;
}

// Lays the show out for one scene. Call it after the clips have been turned to the way the pitch is shown.
export function makeShow(S: ReplayScene) {
  const G = S.clips.goal,
    E = S.clips.earlier;
  const who = S.ids.indexOf(S.differing_player),
    scorer = S.ids.indexOf(S.scorer),
    nm = (i: number) => S.names[S.ids[i]!] ?? '';
  // The show, in seconds. One attempt is on the pitch at a time. First the earlier one, alone: the clock winds back to it and
  // it plays until two seconds after the attacks part. Then the picture rewinds to the start of the goal, and what the earlier
  // attempt came to stays behind as two outlined markers and a dotted trail. The goal plays alone, in full, past them. It stops
  // once, two seconds after the attacks part, and the one distance that differs is drawn.
  const part = S.parting_s * 25,
    shown = part + 50,
    c0 = G.start_offset,
    e0 = E.start_offset;
  // the wait before the runner sets off is skipped
  const lead = startLead(G, E, scorer);
  const gs = c0 + lead,
    es = e0 + lead,
    gm = c0 + shown,
    em = Math.min(E.pos.length - 1, e0 + shown),
    gEnd = Math.min(G.pos.length - 1, G.shot_offset + 26);
  const dirx = Math.sign((G.pos[G.shot_offset]?.[scorer]?.[0] ?? 0) - (G.pos[c0]?.[scorer]?.[0] ?? 0)) || 1;
  const LEN: [Phase, number][] = [
    ['stop', 0.4],
    ['back', 0.7],
    ['then', (em - es) / 25],
    ['thenhold', 0.6],
    ['rewind', 1.2],
    ['now', (gm - gs) / 25],
    ['diff', 1.4],
    ['finish', (gEnd - gm) / 25],
    ['hold', 0.4],
  ];
  const marks: number[] = [];
  LEN.reduce((t, [, d]) => {
    marks.push(t + d);
    return t + d;
  }, 0);
  const TOTAL = marks[marks.length - 1]!;
  const gClock = (f: number) => G.clock + f / 25,
    eClock = (f: number) => E.clock + f / 25,
    booked = S.booked_minute !== null ? 1 : 0;
  // a: what the solid markers show. b: what they are on the way to, u of the way there. ghost: how strongly the earlier attempt's end is drawn.
  function at(T: number): ShowState {
    const i = Math.max(
        0,
        marks.findIndex((m) => T < m),
      ),
      [ph, len] = LEN[i]!,
      t = T - (i ? marks[i - 1]! : 0),
      u = clamp(t / len);
    if (ph === 'stop') return { ph, a: [G, gs], u: 0, ghost: 0, rate: 0, clock: gClock(gs), card: booked };
    if (ph === 'back')
      return {
        ph,
        a: [G, gs],
        b: [E, es],
        u: smooth(u),
        ghost: 0,
        rate: 0,
        clock: lerp(gClock(gs), eClock(es), smooth(u)),
        card: booked * (1 - smooth(u)),
      };
    if (ph === 'then') return { ph, a: [E, es + t * 25], u: 0, ghost: 0, rate: 1, clock: eClock(es + t * 25), card: 0 };
    if (ph === 'thenhold') return { ph, a: [E, em], u: 0, ghost: 0, rate: 0, clock: eClock(em), card: 0 };
    if (ph === 'rewind')
      return {
        ph,
        a: [E, em],
        b: [G, gs],
        u: smooth(u),
        ghost: clamp(u / 0.35),
        rate: 0,
        clock: lerp(eClock(em), gClock(gs), smooth(u)),
        card: booked * clamp((u - 0.6) / 0.4),
      };
    if (ph === 'now')
      return { ph, a: [G, gs + t * 25], u: 0, ghost: 1, rate: 1, clock: gClock(gs + t * 25), card: booked };
    if (ph === 'diff')
      return {
        ph,
        a: [G, gm],
        u: 0,
        ghost: 1,
        rate: 0,
        clock: gClock(gm),
        card: booked,
        gap: Math.min(clamp(t / 0.3), clamp((len - t) / 0.3)),
      };
    if (ph === 'finish')
      return {
        ph,
        a: [G, gm + t * 25],
        u: 0,
        ghost: 1 - 0.6 * clamp(t / 0.8),
        rate: 1,
        clock: gClock(gm + t * 25),
        card: booked,
      };
    return { ph, a: [G, gEnd], u: 0, ghost: 0.4, rate: 0, clock: gClock(gEnd), card: booked };
  }
  const side = S.team[scorer] ? S.away : S.home;
  const COPY: Record<Phase, () => [string, string]> = {
    stop: () => [`Minute ${G.minute}`, `${nm(scorer)} is about to run at goal`],
    back: () => [`Back to minute ${E.minute}`, 'The closest earlier attempt in this match'],
    then: () => [`Minute ${E.minute}`, `The same run. ${nm(who)} steps in`],
    thenhold: () => [`Minute ${E.minute}`, `The same run. ${nm(who)} steps in`],
    rewind: () => [`Now minute ${G.minute}`, `The outlines are where minute ${E.minute} ended`],
    now: () => [
      `Minute ${G.minute}`,
      booked ? `${nm(who)} is on a yellow card from minute ${S.booked_minute}` : 'The same run again',
    ],
    diff: () => [
      'One thing changed',
      `Two seconds after the attacks part ${nm(who)} is ${S.differing_by_m} m from where he was in minute ${E.minute}`,
    ], // what differs, and the card. Not a verdict on the man: nobody can see what he was told to do
    finish: () => [
      `Minute ${G.minute}`,
      `${nm(scorer)} scores for ${side === S.home ? S.home_name || S.home : S.away_name || S.away}`,
    ],
    hold: () => [
      `Minute ${G.minute}`,
      `${nm(scorer)} scores for ${side === S.home ? S.home_name || S.home : S.away_name || S.away}`,
    ],
  };
  const PHASE: Record<Phase, string> = {
    stop: 'The goal, about to start',
    back: 'Back to the earlier attempt',
    then: 'The earlier attempt',
    thenhold: 'The earlier attempt',
    rewind: 'Back to the goal',
    now: 'The goal',
    diff: 'What changed',
    finish: 'The goal',
    hold: 'The goal',
  };
  return { TOTAL, marks, at, COPY, PHASE, who, scorer, es, em, dirx };
}
