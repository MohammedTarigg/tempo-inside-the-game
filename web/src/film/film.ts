// The Tempo product film: 107 seconds, self-running. It drives the real match view through the real run, one feature at a
// time, so nothing in it is mocked. Open /film/ to play it. ?at=42 starts at a second, ?hold=1 stops there, ?mute plays
// it silent.
//
// The features are in match order, so the match clock only runs forward until the replay. Each one has the same shape: the
// picture travels to the moment without a cut, settles on one subject with everyone else dimmed, and one drawing builds.
// How long each lasts comes from the music. Play is at match speed or slower, never faster.
//
// This file is the way in: it loads what the film needs, builds the furniture, the bridge and the eight scenes (one file
// each in scenes/), plays the opening, starts the music, and then every frame hands the time to the scene that is on.
import '../styles/film.css';
import checks from '../../../results/checks.json';
import stakeMeta from '../../../models/stake_meta.json';
import { playIntro } from '../brand/intro.ts';
import { renderer, scene, camera } from '../shared/stage.ts';
import { $, site, el, clamp, seg, smooth, outBack } from '../shared/util.ts';
import type { MatchApi } from '../match/view.ts';
import type { Cue, ReplayScene } from '../types/run.ts';
import type { CueOf, Timed } from '../match/data.ts';
import { makeFurniture, type Furniture } from './furniture.ts';
import { makeBridge, type Bridge } from './bridge.ts';
import { makeMap, type PitchMap } from './map.ts';
import { headsUp } from './scenes/heads-up.ts';
import { thunderbolt } from './scenes/thunderbolt.ts';
import { speakOfTheDevil } from './scenes/speak-of-the-devil.ts';
import { onAYellow } from './scenes/on-a-yellow.ts';
import { yours } from './scenes/yours.ts';
import { dejaVu } from './scenes/deja-vu.ts';
import { calledIt } from './scenes/called-it.ts';
import { proof } from './scenes/proof.ts';
import { close } from './scenes/close.ts';

// One feature of the film: how long it lasts, what it does as it comes on, every frame (u runs 0 to 1), and as it goes.
export interface Scene {
  dur: number;
  // the scene starts with a cut to another moment, so the picture blinks shut just before it and opens on it
  cutIn?: boolean;
  enter(): void;
  update?(u: number): void;
  exit?(): void;
}
// The film's beat and how many beats each part lasts, written by tools/film_music.py beside the track.
interface Score {
  beat: number;
  open: number;
  parts: number[];
  strike: number;
  lit: number;
  // the commentator's line in the sound: when it starts, how long it lasts, and when each word is said, in seconds
  speech?: { at: number; len: number; words: number[] };
}
export type FilmCtx = ReturnType<typeof context>;

// What every scene is handed: the run and what was found in it, the furniture, and the bridge.
function context(
  api: MatchApi,
  furniture: Furniture,
  bridge: Bridge,
  map: PitchMap,
  found: ReturnType<typeof findMoments>,
  score: Score,
) {
  return {
    api,
    M: api.M,
    FPS: api.FPS,
    DIR: api.DIR,
    SCORE: score,
    D: score.parts.map((b) => b * score.beat),
    stakeMeta,
    check: (part: string) => checks.results.find((r) => r.check.includes(part)) ?? null,
    ...found,
    wrap: furniture.wrap,
    logo: furniture.logo,
    cap: furniture.cap,
    capLine: furniture.capLine,
    side: furniture.side,
    veil: furniture.veil,
    over: furniture.over,
    map,
    look: furniture.look,
    caption: furniture.caption,
    swapCall: furniture.swapCall,
    panel: furniture.panel,
    clearPanel: furniture.clearPanel,
    cut: bridge.cut,
    glide: bridge.glide,
    shut: furniture.shut,
    lids: furniture.lids,
    onPlayer: bridge.onPlayer,
    onBall: bridge.onBall,
    // The logo's parts do not exist until the opening has played, which is after the scenes are built. A scene reads them
    // from here at the moment it needs them.
    get eye() {
      return furniture.eye;
    },
    get eyeAt() {
      return furniture.eyeAt;
    },
    get art() {
      return furniture.art;
    },
  };
}

// The frames the features need, found in the run and not written in by hand.
function findMoments(api: MatchApi, REPLAY: ReplayScene | null) {
  const { M, FPS } = api;
  const name = (pid: string) => M.names[pid] ?? pid,
    index = (pid: string) => M.ids.indexOf(pid);
  const firstCue = <F extends Cue['form']>(form: F, pred: (c: Timed<CueOf<F>>) => boolean = () => true) =>
    api.timed.find((c): c is Timed<CueOf<F>> => c.form === form && pred(c as Timed<CueOf<F>>));
  const last = M.cards[M.cards.length - 1],
    booked = last ? index(last.player) : -1; // the storyline's player is the last one booked
  const lit = (() => {
    const s = booked >= 0 ? api.stake[booked] : null;
    if (!s) return null;
    const k = s.v.findIndex((v) => v[0] === 2);
    return k >= 0 ? s.f[k]! : (s.f.find((_, j) => s.v[j]![0] === 1) ?? null);
  })();
  const quiet = api.frameAtClock(7 * 60);
  const tag = firstCue('tag', (c) => c.start > quiet + 20 * FPS) ?? firstCue('tag'),
    form = firstCue('form_card'),
    scene = firstCue('scene', (c) => c.payload.type === 'closest_attempt');
  // a shot, if the match has a rare one
  const rare = firstCue('tag', (c) => c.payload.unit === 'km/h') ?? tag;
  const strike = rare
    ? [...M.actions]
        .reverse()
        .find((a) => a.kind === 'shot' && a.player === index(rare.payload.player) && a.frame <= rare.start)
    : undefined;
  const full = firstCue('fulltime_card');
  return { REPLAY, name, index, rare, strike, form, lit, booked, scene, full };
}

export async function runFilm(api: MatchApi, Q = new URLSearchParams(location.search)) {
  const { DIR } = api;
  // The film's timings come from the music. tools/film_music.py cuts a track to the film and writes, beside it, the length of its
  // beat and how many beats each part lasts, so every feature starts on a beat of whichever track is playing.
  const THEME = site(`audio/tempo-theme${/^[a-z-]+$/.test(Q.get('music') || '') ? `-${Q.get('music')}` : ''}`);
  const SCORE: Score = (await fetch(`${THEME}.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Score>) : null))
    .catch(() => null)) ?? { beat: 0.6, open: 16, parts: [16, 12, 16, 24, 12, 28, 24, 18, 12], strike: 4, lit: 16 };
  // The replay's own data: the film has to arrive on the exact frame and framing the replay opens with.
  const REPLAY = await fetch(site(`runs/${Q.get('run') || 'm_demo'}/scenes.json`), { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<ReplayScene[]>) : []))
    .then((a) => a[0] ?? null)
    .catch(() => null);
  const furniture = makeFurniture(),
    bridge = makeBridge(api),
    { logo, side } = furniture;
  const ctx = context(api, furniture, bridge, makeMap(furniture.wrap, api), findMoments(api, REPLAY), SCORE);
  // Features are in match order. The two that nobody else has get the most time; the rest keep a short, even beat.
  const SCENES: Scene[] = [headsUp, thunderbolt, speakOfTheDevil, onAYellow, yours, dejaVu, calledIt, proof, close].map(
    (make) => make(ctx),
  );

  // ---- the opening: the logo arrives, goes to its corner, and the page draws itself ----
  const OPEN = SCORE.open * SCORE.beat,
    starts: number[] = [];
  let acc = OPEN;
  for (const sc of SCENES) {
    starts.push(acc);
    acc += sc.dur;
  }
  const TOTAL = acc;
  const at = Number(Q.get('at') ?? 0),
    hold = Q.get('hold') !== null;
  api.setPlaying(false);
  api.seek(0);
  // the film's own camera from the first frame, so the field that shows through the fading intro is already framed as it
  // will stay, and nothing changes under the logo when the intro is taken away
  DIR.cam = (wantPos, wantAim) => {
    wantPos.set(0, 94, 96.5);
    wantAim.set(0, 0, 6);
  };
  api.snapCamera();
  // every material the film will draw is prepared now, behind the intro, so the first frame of the players or the lines
  // never waits on the graphics card
  renderer.compile(scene, camera);
  api.drawPitch(at < 6 ? 0 : 1);
  api.ball.setOpacity(at < 8 ? 0 : 1);
  for (const f of api.figs) f.group.scale.setScalar(at < 8 ? 0.0001 : 1);
  // Until the film's own clock takes over, the match view redraws the players at full size on every frame. So while the
  // logo plays and travels to its corner they are held hidden here, or they show through the fading black before their cue.
  if (at < 8)
    DIR.onFrame = () => {
      for (const f of api.figs) f.group.scale.setScalar(0.0001);
    };
  document.body.classList.add('topen');
  const host = $('intro');
  // ---- the music. It is written by tools/film_music.py and is the film's clock while it plays, so picture and sound cannot drift.
  //      A browser only lets a page make sound after a click or a key, so if it refuses, the film waits behind one Play button. ----
  // The track is fetched whole and played from memory, so it can be started at any second on any server.
  const track =
    Q.get('mute') !== null || hold
      ? null
      : await fetch(`${THEME}.m4a?v=${Date.now()}`)
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => null);
  const music = track ? new Audio(URL.createObjectURL(track)) : null;
  if (music) {
    music.preload = 'auto';
    music.volume = 0.9;
    let free = await music
      .play()
      .then(() => true)
      .catch(() => false);
    if (!free) {
      const plate = el('button', 'tstart', document.body);
      plate.setAttribute('aria-label', 'Play the film with sound');
      el('span', '', plate, 'Play');
      el('small', '', plate, 'with sound');
      await new Promise<void>((r) => {
        plate.onclick = () => r();
        const key = (e: KeyboardEvent) => {
          if (e.code === 'Space' || e.code === 'Enter') {
            removeEventListener('keydown', key);
            r();
          }
        };
        addEventListener('keydown', key);
      });
      plate.remove();
      free = await music
        .play()
        .then(() => true)
        .catch(() => false);
    }
    music.pause();
    if (music.readyState < 1)
      await new Promise((r) => {
        music.addEventListener('loadedmetadata', r, { once: true });
        setTimeout(r, 4000);
      }); // it cannot be moved to a time before it knows its own length
    music.currentTime = at < 5 ? 0 : Math.max(at, 6);
    if (free && at < 5) music.play().catch(() => {}); // from the top, with the intro
  }
  // The corner logo is a copy of the intro's finished drawing (furniture.ts makes it). The intro's drawing is then moved and
  // scaled so that its logo lands exactly on the copy, and only then is one swapped for the other. Same shapes, same place,
  // same size.
  const fin = await playIntro(host, at < 5 ? { hold: 0.3 } : { at: 99 });
  const copy = furniture.adoptLogo(fin),
    bx = fin.box;
  if (at < 5) {
    const a = fin.svg.getBoundingClientRect(),
      b = copy.getBoundingClientRect(),
      s = a.width / 800,
      k = b.width / (bx.w * s);
    fin.svg.style.transformOrigin = `${bx.x * s}px ${bx.y * s}px`;
    fin.svg.style.transition = 'transform 1.05s cubic-bezier(.65,0,.2,1)';
    fin.svg.style.transform = `translate(${b.left - (a.left + bx.x * s)}px, ${b.top - (a.top + bx.y * s)}px) scale(${k})`;
    host.style.transition = 'background-color 1.05s';
    host.style.backgroundColor = 'rgba(0,0,0,0)';
    await new Promise((r) => {
      fin.svg.addEventListener('transitionend', r, { once: true });
      setTimeout(r, 1300);
    });
  }
  host.remove();
  logo.classList.add('on');
  if (music && at >= 5) music.play().catch(() => {});
  let t0 = performance.now() - Math.max(at, 6) * 1000,
    cur = -1,
    opened = false,
    leaving = -1;
  DIR.onFrame = () => {
    if (music && !music.paused && !music.ended) t0 = performance.now() - music.currentTime * 1000; // the music keeps the time
    const t = hold && cur >= 0 ? Math.max(at, OPEN) + 2.5 : (performance.now() - t0) / 1000;
    if (t < OPEN) {
      // lines from the centre circle outwards, then the players, then the ball and the scoreboard
      api.drawPitch(smooth(seg(t, 6.1, 8.3)));
      api.ball.setOpacity(seg(t, 8.75, 9.1)); // the ball last, once the players are standing
      api.figs.forEach((f, i) =>
        f.group.scale.setScalar(Math.max(0.0001, outBack(seg(t, 7.9 + i * 0.045, 8.25 + i * 0.045)))),
      );
      document.body.classList.toggle('tdrawn', t > 8.6);
      return;
    }
    if (!opened) {
      opened = true;
      api.drawPitch(1);
      api.ball.setOpacity(1);
      for (const f of api.figs) f.group.scale.setScalar(1);
      document.body.classList.add('tdrawn');
      document.body.classList.remove('topen');
    }
    let i = starts.findIndex((st, k) => t < st + SCENES[k]!.dur);
    if (i < 0) i = SCENES.length - 1;
    const sc = SCENES[i]!,
      DUR = sc.dur,
      local = t - starts[i]!,
      u = clamp(local / DUR);
    if (i !== cur) {
      SCENES[cur]?.exit?.();
      cur = i;
      sc.enter();
      if (sc.cutIn) setTimeout(() => furniture.lids(false), 90);
      // jumped into the middle of a feature: no ride
      if (bridge.riding() && local > 0.4) {
        bridge.ending();
        api.snapCamera();
      }
    }
    bridge.advance(local);
    sc.update?.(u);
    if (!hold && SCENES[i + 1]?.cutIn && local > DUR - 0.24) furniture.lids(true);
    if (!hold && i < SCENES.length - 1 && local > DUR - 0.5 && leaving !== i) {
      leaving = i;
      side.classList.remove('on');
    }
  };
  window.__tour = {
    TOTAL,
    starts,
    now: () => (performance.now() - t0) / 1000,
    marks: { strike: ctx.strike?.frame ?? -1, lit: ctx.lit ?? -1 },
  }; // for checking the film against the score
}
