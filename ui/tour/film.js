// The Tempo product film: 100 seconds, self-running. It drives the real match view (ui/live) through the real run, one feature
// at a time, so nothing in it is mocked. Open ui/tour/ to play it. ?at=42 starts at a second, ?hold=1 stops there.
//
// The features are in match order, so the match clock only runs forward until the replay. Each one has the same shape: the
// picture travels to the moment without a cut, settles on one subject with everyone else dimmed, and one drawing builds.
// How long each lasts comes from the music. Play is at match speed or slower, never faster.
//
// This file is the way in: it loads what the film needs, builds the furniture, the bridge and the eight scenes (one file
// each in scenes/), plays the opening, starts the music, and then every frame hands the time to the scene that is on.
import { playIntro } from '#intro';
import { $, el, clamp, seg, smooth, outBack } from '#util';
import { makeFurniture } from '#tour/furniture';
import { makeBridge } from '#tour/bridge';
import { headsUp } from '#tour/scenes/heads-up';
import { thunderbolt } from '#tour/scenes/thunderbolt';
import { speakOfTheDevil } from '#tour/scenes/speak-of-the-devil';
import { onAYellow } from '#tour/scenes/on-a-yellow';
import { dejaVu } from '#tour/scenes/deja-vu';
import { calledIt } from '#tour/scenes/called-it';
import { proof } from '#tour/scenes/proof';
import { close } from '#tour/scenes/close';

export async function run(api) {
  const { M, FPS, DIR } = api,
    Q = new URLSearchParams(location.search);
  // The film's timings come from the music. tools/film_music.py cuts a track to the film and writes, beside it, the length of its
  // beat and how many beats each part lasts, so every feature starts on a beat of whichever track is playing.
  const THEME = `../tour/tempo-theme${/^[a-z-]+$/.test(Q.get('music') || '') ? `-${Q.get('music')}` : ''}`;
  const SCORE = (await fetch(`${THEME}.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) || { beat: 0.6, open: 16, parts: [16, 12, 16, 24, 28, 24, 18, 12], strike: 4, lit: 16 };
  const D = SCORE.parts.map((b) => b * SCORE.beat);
  // The replay's own data: the film has to arrive on the exact frame and framing the replay opens with.
  const REPLAY = await fetch(`../../runs/${Q.get('run') || 'm_demo'}/scenes.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((a) => a[0] || null)
    .catch(() => null);
  const link = el('link', '', document.head);
  link.rel = 'stylesheet';
  link.href = `../tour/tour.css?v=${Date.now()}`;
  await new Promise((r) => {
    link.onload = r;
    link.onerror = r;
  }); // nothing is measured or shown until the film's styles are in
  const [checks, stakeMeta] = await Promise.all(
    ['../../artifacts/checks.json', '../../artifacts/stake_meta.json'].map((u) =>
      fetch(u, { cache: 'no-cache' })
        .then((r) => r.json())
        .catch(() => null),
    ),
  );
  const check = (part) => (checks ? checks.results.find((r) => r.check.includes(part)) : null);
  const name = (pid) => M.names[pid],
    index = (pid) => M.ids.indexOf(pid);

  // frames the features need, found in the run and not written in by hand
  const firstCue = (form, pred = () => true) => api.timed.find((c) => c.form === form && pred(c));
  const booked = M.cards.length ? index(M.cards[M.cards.length - 1].player) : -1; // the storyline's player is the last one booked
  const lit = (() => {
    const s = booked >= 0 ? api.stake[booked] : null;
    if (!s) return null;
    const k = s.v.findIndex((v) => v[0] === 2);
    return k >= 0 ? s.f[k] : (s.f.find((_, j) => s.v[j][0] === 1) ?? null);
  })();
  const quiet = api.frameAtClock(7 * 60);
  const tag = firstCue('tag', (c) => c.start > quiet + 20 * FPS) || firstCue('tag'),
    form = firstCue('form_card'),
    scene = firstCue('scene', (c) => c.payload.type === 'closest_attempt');
  // a shot, if the match has a rare one
  const rare = api.timed.find((c) => c.form === 'tag' && c.payload.unit === 'km/h') || tag;
  const strike = rare
    ? [...M.actions]
        .reverse()
        .find((a) => a.kind === 'shot' && a.player === index(rare.payload.player) && a.frame <= rare.start)
    : null;
  const full = firstCue('fulltime_card');

  // ---- what every scene is handed: the run and what was found in it, the furniture, and the bridge ----
  const furniture = makeFurniture(),
    bridge = makeBridge(api),
    { logo, side } = furniture;
  const ctx = {
    api,
    M,
    FPS,
    DIR,
    SCORE,
    D,
    REPLAY,
    stakeMeta,
    check,
    name,
    index,
    rare,
    strike,
    form,
    lit,
    booked,
    scene,
    full,
    wrap: furniture.wrap,
    logo,
    cap: furniture.cap,
    capLine: furniture.capLine,
    side,
    veil: furniture.veil,
    over: furniture.over,
    look: furniture.look,
    caption: furniture.caption,
    swapCall: furniture.swapCall,
    panel: furniture.panel,
    clearPanel: furniture.clearPanel,
    cut: bridge.cut,
    glide: bridge.glide,
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
  // Features are in match order. The two that nobody else has get the most time; the rest keep a short, even beat.
  const SCENES = [headsUp, thunderbolt, speakOfTheDevil, onAYellow, dejaVu, calledIt, proof, close].map((make) =>
    make(ctx),
  );

  // ---- the opening: the logo arrives, goes to its corner, and the page draws itself ----
  const OPEN = SCORE.open * SCORE.beat,
    starts = [];
  let acc = OPEN;
  for (const sc of SCENES) {
    starts.push(acc);
    acc += sc.dur;
  }
  const TOTAL = acc;
  const at = Q.get('at') !== null ? +Q.get('at') : 0,
    hold = Q.get('hold') !== null;
  api.setPlaying(false);
  api.seek(0);
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
      await new Promise((r) => {
        plate.onclick = r;
        const key = (e) => {
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
  // The corner logo is a copy of the intro's finished drawing (furniture.js makes it). The intro's drawing is then moved and
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
  DIR.cam = (wantPos, wantAim) => {
    wantPos.set(0, 94, 96.5);
    wantAim.set(0, 0, 6);
  };
  api.snapCamera();

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
    let i = starts.findIndex((st, k) => t < st + SCENES[k].dur);
    if (i < 0) i = SCENES.length - 1;
    const DUR = SCENES[i].dur,
      u = clamp((t - starts[i]) / DUR),
      local = t - starts[i];
    if (i !== cur) {
      if (cur >= 0 && SCENES[cur].exit) SCENES[cur].exit();
      cur = i;
      SCENES[i].enter();
      // jumped into the middle of a feature: no ride
      if (bridge.riding() && local > 0.4) {
        bridge.ending();
        api.snapCamera();
      }
    }
    bridge.advance(local);
    if (SCENES[i].update) SCENES[i].update(u);
    if (!hold && i < SCENES.length - 1 && local > DUR - 0.5 && leaving !== i) {
      leaving = i;
      side.classList.remove('on');
    }
  };
  window.__tour = {
    TOTAL,
    starts,
    music,
    now: () => (performance.now() - t0) / 1000,
    frame: () => api.getF(),
    marks: { strike: strike ? strike.frame : null, lit },
  }; // for checking the film against the score
}
