// The Tempo product film: 100 seconds, self-running. It drives the real match view (ui/live) through the real run, one feature
// at a time, so nothing in it is mocked. Open ui/tour/ to play it. ?at=42 starts at a second, ?hold=1 stops there.
//
// It keeps one rhythm from start to finish. Every feature gets the same ten seconds and the same shape: the match clock runs
// forward to the moment (the features are in match order, so it never goes back), the picture settles on one subject with
// everyone else dimmed, one drawing builds, and the picture dips out. Play is at match speed or slower, never faster.
import { playIntro, softTails, MARK } from '#intro';
import { CRESTS } from '#stage';
import { portrait } from '#portrait';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  (parent || document.body).appendChild(e);
  return e;
};
const clamp = (x) => Math.min(1, Math.max(0, x)),
  seg = (t, a, b) => clamp((t - a) / (b - a)),
  lerp = (a, b, u) => a + (b - a) * u;
const upper = (arr, x) => {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
};
const ease = (u) => u * u * (3 - 2 * u),
  out = (u) => 1 - (1 - u) ** 3,
  back = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;

// Our own icons, in the logo's language: rings, lines and dots at one weight.
const I = (d) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  // a small network read left to right: two inputs, two hidden, one answer
  model: I(
    '<path d="M5 7h7M5 7l7 10M5 17h7M5 17 12 7M12 7l7 5M12 17l7-5" stroke-width="1.4"/><circle cx="5" cy="7" r="2.1" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="2.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="2.1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="2.1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  ),
  target: I(
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>'),
  rules: I(
    '<path d="M4 7h10M4 12h16M4 17h7"/><circle cx="18" cy="7" r="1.6" fill="currentColor"/><circle cx="15" cy="17" r="1.6" fill="currentColor"/>',
  ),
  log: I('<path d="M6 4h9l4 4v12H6z"/><path d="M9.5 12h6M9.5 16h6"/>'),
  season: I(
    '<circle cx="6" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
  ),
  search: I('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  real: I('<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>'),
  speech: I('<path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4"/>'),
  twin: I('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" stroke-dasharray="3 3"/>'),
  ruler: I('<path d="M4 16 16 4l4 4L8 20z"/><path d="M8.5 11.5l2 2M11.5 8.5l2 2"/>'),
  shield: I(
    '<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.700-7-5-7-9.5V6z"/><path d="M8.8 12.2l2.300 2.300 4.300-4.600"/>',
  ),
  ghost: I(
    '<circle cx="6.5" cy="12" r="3.5" fill="currentColor"/><circle cx="17.5" cy="12" r="3.5" stroke-dasharray="2.6 2.2"/><path d="M11 12h2.5"/>',
  ),
  agents: I(
    '<circle cx="12" cy="6.5" r="2.5"/><circle cx="6" cy="16.5" r="2.5"/><circle cx="18" cy="16.5" r="2.5"/><path d="M10.6 8.600 7.400 14.300M13.400 8.600l3.200 5.700M8.500 16.500h7"/>',
  ),
  save: I('<path d="M5 4h11l3 3v13H5z"/><path d="M8.500 4v5h6V4M8.500 20v-6h7v6"/>'),
  lock: I(
    '<rect x="5" y="10.500" width="14" height="9.500" rx="2"/><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500"/>',
  ),
};

export async function run(api) {
  const { M, FPS, DIR } = api,
    Q = new URLSearchParams(location.search);
  // The film's timings come from the music. ui/tour/music.py cuts a track to the film and writes, beside it, the length of its
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
  const [checks, summary, stakeMeta] = await Promise.all(
    ['../../artifacts/checks.json', `${api.base}summary.json`, '../../artifacts/stake_meta.json'].map((u) =>
      fetch(u, { cache: 'no-cache' })
        .then((r) => r.json())
        .catch(() => null),
    ),
  );
  const check = (part) => (checks ? checks.results.find((r) => r.check.includes(part)) : null);
  const name = (pid) => M.names[pid],
    index = (pid) => M.ids.indexOf(pid);

  // ---- the furniture: the logo in the corner, the caption, the dip between features, and the place where drawings go ----
  const wrap = $('stagewrap');
  // The film is one 1280 by 720 frame, scaled to fit the window like a video, so it looks the same on any screen.
  const scale = () => document.body.style.setProperty('--k', Math.min(innerWidth / 1280, innerHeight / 720));
  addEventListener('resize', scale);
  scale();
  el('div', 'tscrim', wrap);
  const logo = el('div', 'tlogo', wrap); // filled with the intro's own finished drawing, so the two can never differ
  const cap = el('div', 'tcap', wrap),
    capNo = el('div', 'tno', cap),
    capBody = el('div', '', cap),
    capName = el('h2', '', capBody),
    capLine = el('p', '', capBody),
    capChips = el('div', 'tchips', capBody);
  const side = el('div', 'tside', wrap),
    veil = el('div', 'tveil', wrap),
    dip = el('div', 'tdip', wrap);
  let eye = null,
    eyeAt = [0, 0, 0],
    art = null;
  const look = (xy) => {
    // the logo's eye turns towards what is being shown
    if (!eye) return;
    const [ex, ey, reach] = eyeAt;
    if (!xy) {
      eye.setAttribute('cx', ex + reach);
      eye.setAttribute('cy', ey);
      return;
    }
    const dx = xy[0] - (logo.offsetLeft + 18),
      dy = xy[1] - (logo.offsetTop + 18),
      L = Math.hypot(dx, dy) || 1;
    eye.setAttribute('cx', ex + (dx / L) * reach);
    eye.setAttribute('cy', ey + (dy / L) * reach);
  };
  // The caption stays where it is from the first feature to the last. Between features its number, title and line change in
  // place: they dip out, the words are swapped, and they come back.
  let capUp = false;
  function caption(no, title, line, chips) {
    const fill = () => {
      capNo.textContent = no;
      capName.textContent = title;
      capLine.className = typeof line === 'string' ? '' : 'tcall';
      if (typeof line === 'string') capLine.textContent = line;
      else capLine.replaceChildren(...line);
      capChips.replaceChildren(
        ...chips.map(([icon, text, planned]) => {
          const c = document.createElement('span');
          c.className = planned ? 'planned' : '';
          c.innerHTML = ICON[icon];
          el('b', '', c, text);
          if (planned) el('em', '', c, 'planned');
          return c;
        }),
      );
    };
    if (!capUp || !cap.classList.contains('on')) {
      capUp = true;
      fill();
      cap.classList.remove('chg');
      void cap.offsetWidth;
      cap.classList.add('on');
      return;
    }
    cap.classList.add('chg');
    setTimeout(() => {
      fill();
      cap.classList.remove('chg');
    }, 250);
  }
  const panel = (html) => {
    side.innerHTML = html;
    side.classList.add('on');
  };
  const clearPanel = () => side.classList.remove('on');
  // One way of framing a subject, used by every feature: high enough that markers stay round, the subject a little right of
  // centre so the caption has the lower left to itself.
  const frameOn =
    (get, height = 38, back2 = 30) =>
    (wantPos, wantAim, b) => {
      const p = get(b);
      if (!p) return;
      wantPos.set(p[0] - 5, height, -p[1] + back2);
      wantAim.set(p[0] - 5, 0, -p[1] + 4);
    };
  const onPlayer = (i, h, d) => frameOn(() => api.drawn(i), h, d),
    onBall = (h, d) => frameOn((b) => [b[0], b[1]], h, d); // where he is drawn, so the camera stays with him while the picture travels
  const cut = (frame, speed, cam, focus = null) => {
    ride = null;
    DIR.blend = null;
    api.seek(frame);
    api.setSpeed(speed);
    DIR.cam = cam;
    DIR.focus = focus;
    DIR.mark = null;
    api.snapCamera();
    api.setPlaying(true);
  };
  // The bridge between two features. Nothing goes black and nothing jumps: the camera lifts away from its subject, all 22 markers
  // and the ball glide from where they stand to where they stand at the next moment, the clock and the playhead run forward with
  // them, and the camera comes down on the next subject. Then play resumes. `lift` is how far the camera pulls away on the way:
  // 1 between two different subjects, less when the next feature is about the same player and the camera can stay with him.
  const GL = 1.2;
  let ride = null; // two beats of the music
  const glide = (frame, speed, cam, focus = null, lift = 1) => {
    const from = api.getF(),
      to = Math.min(api.LAST, frame + GL * FPS * speed); // land where play would have reached, so each feature keeps its timing
    DIR.blend = { from, k: 0 };
    api.seek(to, true);
    api.setSpeed(speed);
    api.setPlaying(false);
    DIR.focus = focus;
    DIR.mark = null;
    ride = { cam, speed, g: 0 };
    DIR.cam = (wantPos, wantAim, b) => {
      cam(wantPos, wantAim, b);
      const up = ride ? Math.sin(Math.PI * ride.g) * lift : 0;
      wantPos.y += 30 * up;
      wantPos.z += 24 * up;
    };
  };
  const ending = () => {
    if (!ride) return;
    DIR.blend = null;
    DIR.cam = ride.cam;
    api.setPlaying(true);
    ride = null;
  };
  const nearest = (i, n = 1) => {
    const p = api.pos(api.getF(), i);
    if (!p) return [];
    return M.ids
      .map((_, j) => j)
      .filter((j) => j !== i && M.team[j] !== M.team[i])
      .map((j) => [j, api.pos(api.getF(), j)])
      .filter((x) => x[1])
      .sort((a, c) => Math.hypot(a[1][0] - p[0], a[1][1] - p[1]) - Math.hypot(c[1][0] - p[0], c[1][1] - p[1]))
      .slice(0, n)
      .map((x) => x[0]);
  };

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
  const fm = stakeMeta ? stakeMeta.metrics : null,
    pct = fm ? Math.round(fm.faint_on_at_contact * 100) : null;

  // ---- what each feature draws ----
  const shownFrames = M.cues
    .filter((c) => c.status !== 'withdrawn' && (c.form !== 'stake_card' || c.payload.level > 0))
    .map((c) => c.frame)
    .sort((a, b) => a - b);
  const shownAt = new Set(shownFrames.map((f) => upper(M.event_frames, f))); // which event each shown thing came with
  const pins = $('pins'),
    gauge = el('div', 'pin tgauge', pins),
    bars = el('div', 'tbars', wrap),
    pause = el('div', 'tpause', wrap);
  gauge.innerHTML = '<i></i><u></u><u></u>';
  bars.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  pause.innerHTML = '<i></i><i></i>';
  const TOP = 0.4,
    notch = gauge.querySelectorAll('u');
  notch[0].style.bottom = `${(M.stake.faint / TOP) * 100}%`;
  notch[1].style.bottom = `${(M.stake.full / TOP) * 100}%`;
  const rare = api.timed.find((c) => c.form === 'tag' && c.payload.unit === 'km/h') || tag; // a shot, if the match has a rare one
  const strike = rare
    ? [...M.actions]
        .reverse()
        .find((a) => a.kind === 'shot' && a.player === index(rare.payload.player) && a.frame <= rare.start)
    : null;
  let frame = null,
    chance = 0;

  // The commentator's line, spoken at the bottom of the picture, and the card Tempo answers with. Both belong to one feature.
  // The commentator, heard: a small live waveform and his words arriving as they are spoken. A word comes in grey and firms to
  // white a moment later, the way a live transcript settles. The player's name is the cue, so it is the one word that is marked.
  const speak = el('div', 'tspeak', wrap),
    wave = el('span', 'twave', speak),
    line = el('span', 'tline', speak);
  wave.innerHTML = '<i></i>'.repeat(9);
  const waveBars = [...wave.children];
  let spoken = [],
    pulse = 0;
  function speakSet(text, cueName) {
    line.replaceChildren();
    spoken = text.split(' ').map((w) => {
      const s = el('span', w.replace(/[^\p{L}]/gu, '') === cueName ? 'name' : '', line, w);
      return { el: s, at: 0 };
    });
  }
  function speakDraw(n, talking) {
    const now = performance.now();
    spoken.forEach((w, i) => {
      if (i < n && !w.at) {
        w.at = now;
        w.el.classList.add('in');
        pulse = now;
      }
      if (w.at && now - w.at > 260) w.el.classList.add('set');
    });
    const t = now / 1000,
      kick = Math.exp(-(now - pulse) / 160); // each word gives the wave a push, then it settles
    waveBars.forEach((b, k) => {
      const shape = 1 - Math.abs(k - 4) / 6.5,
        level = talking
          ? 0.28 + 0.5 * Math.abs(Math.sin(t * 7.3 + k * 1.7) * Math.sin(t * 3.1 + k * 0.9)) + 0.35 * kick
          : 0;
      b.style.transform = `scaleY(${(0.1 + 0.9 * Math.min(1, level) * shape).toFixed(3)})`;
    });
  }
  const cueSpoken = () => spoken.some((w) => w.el.classList.contains('name') && w.el.classList.contains('set'));
  const pcard = el('div', 'tplayer', wrap);
  function playerCard(c) {
    // who he is, then his numbers as marks on a scale. No logo: the card is the answer, not a signature
    const p = c.payload,
      i = index(p.player),
      team = M.team[i],
      club = team ? M.away : M.home,
      crest = CRESTS[club.short.toLowerCase()],
      pc = p.usual_percentile;
    pcard.replaceChildren();
    pcard.style.setProperty('--team', `var(--${team ? 'away' : 'home'})`);
    const top = el('div', 'who', pcard),
      face = el('div', 'face', top);
    face.innerHTML = portrait(
      p.player,
      getComputedStyle(document.documentElement)
        .getPropertyValue(team ? '--away' : '--home')
        .trim(),
    );
    el('b', '', face, String(M.numbers[i])); // a drawn face for a fictional player
    const id = el('div', '', top);
    el('h3', '', id, name(p.player));
    const t = el('p', '', id);
    if (crest) {
      const im = el('img', '', t);
      im.src = `../brand/${crest}`;
      im.alt = '';
    }
    t.append(club.name);
    const row = (label, value, build) => {
      const r = el('div', 'stat', pcard);
      const h = el('div', '', r);
      el('span', '', h, label);
      el('b', '', h, value);
      build(el('div', 'scale', r));
    };
    row('Distance a minute', `${Math.round(p.per_minute)} m`, (sc) => {
      el('i', 'usual', sc);
      const d = el('i', 'dot', sc);
      d.style.setProperty('--x', `${pc}%`);
    });
    row('Top speed', `${p.top_speed.toFixed(1)} m/s`, (sc) => {
      const f = el('i', 'fill', sc);
      f.style.setProperty('--x', `${Math.min(100, (p.top_speed / 10) * 100)}%`);
    });
    el(
      'small',
      '',
      pcard,
      pc > 60 ? 'Above his own usual today' : pc < 40 ? 'Below his own usual today' : 'Close to his own usual today',
    );
  }
  // Called it: the things for the last feature. An overlay drawn in the picture's own space, and the caption's line, which
  // carries the call's words with a small mark in front that is the same mark as the one on the pitch: an outline while the
  // call is only something said, solid once it has happened, and then a tick.
  const SVGNS = 'http://www.w3.org/2000/svg',
    svgEl = (tag, attrs, parent) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      parent.appendChild(e);
      return e;
    };
  const over = svgEl('svg', { class: 'tover', 'aria-hidden': 'true' }, wrap);
  const callLine = (text) => {
    const sw = document.createElement('i');
    sw.className = 'tsw';
    const tk = document.createElement('i');
    tk.className = 'ttk';
    tk.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.8l5 5L19.5 7"/></svg>';
    return [sw, document.createTextNode(text), tk];
  };
  const swapCall = (text) => {
    capLine.classList.add('out');
    setTimeout(() => {
      capLine.replaceChildren(...callLine(text));
      capLine.className = 'tcall';
    }, 240);
  };
  const keyed = (v, keys) => {
    let i = 0;
    while (i < keys.length - 2 && v > keys[i + 1][0]) i++;
    const [a, x] = keys[i],
      [b2, y] = keys[i + 1];
    return lerp(x, y, seg(v, a, b2));
  };
  const hull = (P) => {
    // the outline of a set of points on the screen
    const q = [...P].sort((m, n) => m[0] - n[0] || m[1] - n[1]),
      cross = (o, m, n) => (m[0] - o[0]) * (n[1] - o[1]) - (m[1] - o[1]) * (n[0] - o[0]);
    const half = (pts) => {
      const h = [];
      for (const pt of pts) {
        while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], pt) <= 0) h.pop();
        h.push(pt);
      }
      h.pop();
      return h;
    };
    return [...half(q), ...half(q.reverse())];
  };
  const full = firstCue('fulltime_card');
  const OUT = 0.5,
    IN = 0.7; // the bridge: half a second out, seven tenths in

  // Features are in match order. The two that nobody else has get the most time; the rest keep a short, even beat.
  const SCENES = [
    // 1. Before kick-off. Play is slowed right down and the three marks are held up one at a time.
    //    Each mark eases in, its arrows run out and slow, and all of it leaves together.
    {
      dur: D[0],
      enter() {
        cut(0, 0.3, (wantPos, wantAim) => {
          wantPos.set(0, 94, 96.5);
          wantAim.set(0, 0, 6);
        });
        look(null);
        this.k = 0;
        document.body.classList.add('theads'); // no words on the pitch: each call's words are the caption's line, with the mark's own yellow square in front
        caption('1', 'Heads up', callLine(api.marks[0] ? api.marks[0].payload.text : 'Three things to watch'), [
          ['season', 'From the season so far'],
        ]);
        // The third mark is about minutes, so it is drawn on the clock: the scoreboard grows, the clock runs to the minute named and
        // takes the outline, with the goal those minutes are about. Called it brings the same two back and turns them solid.
        const w = api.marks.find((c) => c.payload.mark === 'window'),
          said = full && (full.payload.calls || []).find((c) => c.mark === 'window'),
          p2 = M.periods[1] || M.periods[0];
        this.wi = api.marks.indexOf(w);
        this.from = said && said.window ? said.window[0] : 70;
        this.gx = p2.home_attacks * (w && w.payload.subject === `t_${M.home.short.toLowerCase()}` ? -1 : 1) * 52.5; // the goal that side defends in the half the minutes fall in
        over.replaceChildren();
        this.goal = svgEl('polygon', { class: 'zone' }, over);
      },
      update(u) {
        const k = Math.min(2, Math.floor(u * 3)),
          v = u * 3 - k,
          on = ease(Math.min(seg(v, 0.03, 0.2), 1 - seg(v, 0.84, 0.99)));
        DIR.mark = { i: k, k: on, grow: out(seg(v, 0.1, 0.62)) };
        if (k !== this.k) {
          this.k = k;
          if (api.marks[k]) swapCall(api.marks[k].payload.text);
        }
        const mine = k === this.wi,
          late = mine && v > 0.04 && v < 0.93,
          lit = late && v > 0.34,
          gx = this.gx,
          gd = Math.sign(gx) * 2;
        document.body.classList.toggle('tbig', late);
        document.body.classList.toggle('tlate', lit);
        DIR.clock = mine ? this.from * 60 * ease(seg(v, 0.08, 0.34)) * (1 - seg(v, 0.93, 1)) : null;
        this.goal.setAttribute(
          'points',
          hull(
            [
              [gx, -3.66, 0],
              [gx, 3.66, 0],
              [gx, -3.66, 2.44],
              [gx, 3.66, 2.44],
              [gx + gd, -3.66, 0],
              [gx + gd, 3.66, 0],
              [gx + gd, -3.66, 1.6],
              [gx + gd, 3.66, 1.6],
            ]
              .map(([x, y, h]) => {
                const q = api.project(x, h, -y);
                return `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
              })
              .map((s) => s.split(',').map(Number)),
          )
            .map((q) => q.join(','))
            .join(' '),
        );
        this.goal.style.opacity = lit ? on : 0;
      },
      exit() {
        DIR.mark = null;
        DIR.clock = null;
        document.body.classList.remove('tbig', 'tlate', 'theads');
        capLine.className = '';
        over.replaceChildren();
      },
    },

    // 2. A hard shot. Under the player, a short line: the season's usual, where rare begins, and a dot that runs out past both.
    //    In the demo match this is the attempt the replay comes back to later.
    //    The shot is struck SCORE.strike beats in, where the music comes back after its rest.
    {
      dur: D[1],
      enter() {
        const i = rare ? index(rare.payload.player) : 0;
        this.i = i;
        glide(
          (strike ? strike.frame : rare ? rare.start : api.frameAtClock(12 * 60)) -
            SCORE.strike * SCORE.beat * 0.6 * FPS,
          0.6,
          onPlayer(i, 40, 32),
          new Set([i]),
        );
        caption('2', 'Thunderbolt', 'Faster than almost every shot', [['rules', 'Shown only when rare']]);
      },
      update() {
        const p = api.pos(api.getF(), this.i);
        if (p) look(api.project(p[0], 0, -p[1]));
      },
    },

    // 3. The commentator speaks at the foot of the picture. Then Tempo's card answers with the player and his numbers.
    {
      dur: D[2],
      enter() {
        const i = form ? index(form.payload.player) : 0;
        this.i = i;
        this.said = -1;
        glide((form ? form.start : api.frameAtClock(35 * 60)) - 2 * FPS, 0.5, onPlayer(i), new Set([i]));
        caption('3', 'Speak of the devil', 'Say his name, see his numbers', [['speech', 'Speech recognition', true]]);
        speakSet(form ? form.payload.heard : '', name(M.ids[i]));
        if (form) playerCard(form);
      },
      update(u) {
        const sp = SCORE.speech,
          local = u * D[2];
        if (sp && sp.words.length === spoken.length) {
          // the line is really spoken in the film's sound: each word appears as it is said
          const k = local - sp.at;
          speakDraw(sp.words.filter((w) => w <= k).length, k > -0.05 && k < sp.len);
        } else {
          const n = u < 0.25 ? 0 : Math.min(spoken.length, 1 + Math.floor((spoken.length - 1) * seg(u, 0.25, 0.5))); // no recording: the line arrives a word at a time, as speech does
          speakDraw(n, u > 0.24 && u < 0.53);
        }
        speak.classList.toggle('on', u > 0.1875 && u < 0.69);
        pcard.classList.toggle('on', cueSpoken() && u < 0.97); // the card answers the moment his name has been heard
        const p = api.pos(api.getF(), this.i);
        if (p) look(api.project(p[0], 0, -p[1]));
      },
      exit() {
        speak.classList.remove('on');
        pcard.classList.remove('on');
      },
    },

    // 4. Beside the booked player, the model's score rises to the two lines where his card turns on and then lights.
    //    The card lights SCORE.lit beats in, where the music comes back after two beats of nothing.
    {
      dur: D[3],
      enter() {
        const f = lit ?? api.frameAtClock(50 * 60);
        this.popped = false;
        glide(
          f - SCORE.lit * SCORE.beat * 0.75 * FPS,
          0.75,
          booked >= 0 ? onPlayer(booked) : onBall(),
          booked >= 0 ? new Set([booked]) : null,
          0.3,
        );
        chance = 0; // the same player as the feature before, so the camera stays with him
        {
          // how often the card was already on a booked player at the moment he made a challenge, on real matches the model had never seen
          const hit = stakeMeta && stakeMeta.metrics ? Math.round(stakeMeta.metrics.faint_on_at_contact * 100) : null;
          caption('4', 'On a yellow', 'His card lights before the tackle', [
            ['model', 'Machine learning model'],
            ...(hit ? [['target', `Caught ${hit} in 100 tackles in real matches`]] : []),
          ]);
        }
      },
      update() {
        if (DIR.blend) {
          // on the way here the playhead passes his booking: the card on the strip answers
          const fs = DIR.blend.from + (api.getF() - DIR.blend.from) * DIR.blend.k,
            c = M.cards[M.cards.length - 1];
          if (c && fs >= c.frame && !this.popped) {
            this.popped = true;
            const marks2 = document.querySelectorAll('#track .book'),
              m = marks2[M.cards.length - 1];
            if (m) {
              m.classList.remove('pop');
              void m.offsetWidth;
              m.classList.add('pop');
            }
          }
          gauge.style.opacity = 0;
          return;
        }
        const p = booked >= 0 && api.pos(api.getF(), booked);
        if (!p) {
          gauge.style.opacity = 0;
          return;
        }
        DIR.focus = new Set([booked, ...nearest(booked, 1)]); // him and the man he is closing on
        const [, c] = api.levelAt(booked, api.getF());
        chance += (c - chance) * 0.12;
        gauge.firstElementChild.style.height = `${Math.min(100, (chance / TOP) * 100)}%`;
        const xy = api.project(p[0] + 2.6, 0, -p[1]);
        gauge.style.opacity = 1;
        gauge.style.transform = `translate(${xy[0]}px, ${xy[1] - 34}px)`;
        look(xy);
      },
      exit() {
        gauge.style.opacity = 0;
      },
    },

    // 5. The replay. One attempt at a time: the picture stops at the start of the goal, the clock winds back and the earlier
    //    attempt plays alone, then it rewinds and the goal plays alone, past two outlined markers left where the earlier one
    //    ended. Both at once was too much to follow. The film's own scoreboard shows which minute is on screen.
    {
      dur: D[4],
      nodipOut: true,
      enter() {
        // The bridge. The replay opens on the moment the scorer sets off, framed on him. The film goes to that same frame and
        // that same framing in one move, holds, and the replay fades in over a picture that is already identical.
        const G = REPLAY && REPLAY.clips.goal,
          E = REPLAY && REPLAY.clips.earlier;
        let turn = 1;
        if (G && E) {
          const sc = REPLAY.ids.indexOf(REPLAY.scorer),
            si = index(REPLAY.scorer),
            base = api.frameAtClock(G.clock);
          const moved = (C) =>
            Math.max(
              0,
              C.pos.findIndex((q) => Math.hypot(q[sc][0] - C.pos[0][sc][0], q[sc][1] - C.pos[0][sc][1]) > 0.4),
            );
          const lead = Math.max(0, Math.min(moved(G) - G.start_offset, moved(E) - E.start_offset) - 6),
            f = base + G.start_offset + lead; // the same sums as the replay's own
          const shot = api.pos(base + G.shot_offset, si) || [1, 0],
            q = api.pos(f, si) || [0, 0],
            dir = Math.sign(shot[0] - q[0]) || 1;
          turn = Math.sign((shot[0] - q[0]) * (G.pos[G.shot_offset][sc][0] - G.pos[G.start_offset][sc][0])) || 1; // the clips are stored turned one way; the film shows the pitch as it was played
          glide(
            f,
            0,
            (wantPos, wantAim) => {
              wantPos.set(q[0] + 2 * dir, 30, -q[1] + 30);
              wantAim.set(q[0] + 4 * dir, 0, -q[1] + 5);
            },
            null,
            0,
          );
        } else if (scene) glide(scene.frame, 0, onBall(46, 44), null, 0);
        look([wrap.clientWidth / 2, wrap.clientHeight / 2]);
        frame = el('iframe', 'tframe', wrap);
        frame.src = `../replay/index.html?turn=${turn}&wait=0.7&bare=1`;
        frame.title = 'Replay of the closest earlier attempt';
        {
          const f = frame,
            t1 = performance.now();
          f.addEventListener('load', () =>
            setTimeout(
              () => {
                if (frame === f) {
                  f.classList.add('on');
                  document.body.classList.add('treplay');
                }
              },
              Math.max(350, 1250 - (performance.now() - t1)),
            ),
          );
        } // once it has drawn, and not before the film has arrived
        this.heard = (e) => {
          if (e.origin === location.origin && e.data && e.data.tempoReplay && frame && frame.classList.contains('on')) {
            DIR.clock = e.data.tempoReplay.clock;
            const g = M.goals[M.goals.length - 1];
            DIR.score = e.data.tempoReplay.scored && g ? g.score : null;
          }
        };
        addEventListener('message', this.heard);
        caption('5', 'Déjà vu', 'Same move. One thing changed', [['twin', 'Found in this match']]);
      },
      exit() {
        removeEventListener('message', this.heard);
        DIR.clock = null;
        DIR.score = null;
        document.body.classList.remove('treplay');
        if (frame) {
          const f = frame;
          f.classList.remove('on');
          setTimeout(() => f.remove(), 700);
          frame = null;
        }
      },
    },

    // 6. Called it. Before kick-off the film told the viewer three things to watch. Each comes back as a picture, on the
    //    pitch, with no words on it: the words are the caption's line and nothing else. One rule runs through all three. What
    //    Tempo said is a yellow outline, what Northgate did is orange, and the outline turns solid at the moment the two meet.
    //      1. Where they shoot from: the zone from kick-off, and every shot landing on the spot it was taken from.
    //      2. The space round the booked player: first the same run in the earlier attempt, which he stepped in and stopped
    //         (outlined markers, as in the replay), then his card, then the run for the goal, which goes straight through.
    //      3. Late: the scoreboard is the picture. The clock winds back, runs up, takes the outline at the minute named with
    //         the goal it is about, and both turn solid when the ball goes in.
    //    The strip stays where it is. Every position is the match's own; the two runs are the replay's two clips.
    {
      dur: D[5],
      enter() {
        cut(api.LAST - 3 * FPS, 0.25, (wantPos, wantAim) => {
          wantPos.set(0, 94, 96.5);
          wantAim.set(0, 0, 6);
        });
        DIR.focus = new Set([-1]);
        look(null);
        const calls = (full && full.payload.calls) || [],
          by = (m) => calls.find((c) => c.mark === m);
        this.where = by('channels');
        this.man = by('zone');
        this.late = by('window');
        this.k = -1;
        this.stage = 0;
        DIR.plain = true; // the pictures are the only marks on the pitch
        caption('6', 'Called it', callLine(this.where ? this.where.said : 'Three calls from kick-off'), [
          ['log', 'From the match record'],
        ]);
        over.replaceChildren();
        const W = this.where;
        if (W) {
          // the zone, as it was drawn at kick-off, and every shot on the spot it was taken from
          this.bands =
            W.zone === 'wide'
              ? [
                  [12.2, 33],
                  [-33, -12.2],
                ]
              : [[-12.2, 12.2]];
          this.zones = this.bands.map(() => svgEl('polygon', { class: 'zone' }, over));
          this.dots = W.points.map((q) => svgEl('circle', { class: q.inside ? 'shot in' : 'shot', r: 0 }, over));
        }
        const G = REPLAY && REPLAY.clips.goal,
          E = REPLAY && REPLAY.clips.earlier;
        this.R = null;
        if (G && E && this.man) {
          const sc = REPLAY.ids.indexOf(REPLAY.scorer),
            dp = REPLAY.ids.indexOf(REPLAY.differing_player),
            si = index(REPLAY.scorer),
            di = index(REPLAY.differing_player);
          const moved = (C) =>
            Math.max(
              0,
              C.pos.findIndex((q) => Math.hypot(q[sc][0] - C.pos[0][sc][0], q[sc][1] - C.pos[0][sc][1]) > 0.4),
            ); // where the runner sets off
          const base = api.frameAtClock(G.clock),
            A = base + moved(G),
            S = base + G.shot_offset,
            at = api.pos(S, si) || [1, 0];
          const sgn = Math.sign(at[0] * G.pos[G.shot_offset][sc][0]) || 1,
            dir = Math.sign(at[0]) || 1; // the clips are turned to run one way; this turns them back onto the pitch
          const j0 = moved(E);
          let j1 = j0,
            best = 1e9; // the earlier run ends where the two of them meet
          for (let j = j0; j < Math.min(E.pos.length, j0 + 150); j++) {
            const d = Math.hypot(E.pos[j][sc][0] - E.pos[j][dp][0], E.pos[j][sc][1] - E.pos[j][dp][1]);
            if (d < best) {
              best = d;
              j1 = j;
            }
          }
          const c = api.pos(A, di) || [0, 0],
            card = M.cards.find((k) => k.player === REPLAY.differing_player || index(k.player) === di),
            goal = M.goals[M.goals.length - 1];
          this.R = {
            A,
            S,
            si,
            di,
            sc,
            dp,
            sgn,
            dir,
            E,
            j0,
            j1,
            box: [c[0] - 8, c[1] - 7, c[0] + 8, c[1] + 7],
            from: api.pos(A, si),
            shot: at,
            e0: E.clock + j0 / 25,
            e1: E.clock + j1 / 25,
            cardT: card ? api.clockAt(card.frame) : REPLAY.booked_minute * 60,
            aT: api.clockAt(A),
            f60: api.frameAtClock((this.late ? this.late.window[0] - 10 : 60) * 60),
            f70: api.frameAtClock((this.late ? this.late.window[0] : 70) * 60),
            goalF: goal ? goal.frame : S,
          };
          this.space = svgEl('polygon', { class: 'zone' }, over);
          this.ghostPath = svgEl('line', { class: 'ghost' }, over);
          this.stop = svgEl('line', { class: 'stop' }, over);
          this.trail = svgEl('polyline', { class: 'trail' }, over);
          this.ghostA = svgEl('circle', { class: 'gring home' }, over);
          this.ghostB = svgEl('circle', { class: 'gring away' }, over);
          this.card = svgEl('rect', { class: 'tbook', width: 13, height: 18, rx: 2.5 }, over);
          this.goal = svgEl('polygon', { class: 'zone' }, over);
          this.trail3 = svgEl('polyline', { class: 'trail' }, over);
        }
      },
      update(u) {
        const CUTS = [0, 0.245, 0.69, 1],
          k = u < CUTS[1] ? 0 : u < CUTS[2] ? 1 : 2,
          v = (u - CUTS[k]) / (CUTS[k + 1] - CUTS[k]),
          R = this.R;
        const xy = (x, y, h = 0) => {
            const q = api.project(x, h, -y);
            return [q[0], q[1]];
          },
          pts = (a) => a.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '); // placed afresh each frame: the camera moves
        const halfCam = (x, height, back2) => (wantPos, wantAim) => {
          wantPos.set(x, height, back2);
          wantAim.set(x, 0, 5);
        };
        if (k !== this.k) {
          // each picture sets its own stage
          const first = this.k < 0;
          this.k = k;
          this.stage = 0;
          DIR.clock = null;
          document.body.classList.remove('tbig', 'tlate', 'tgoal');
          if (k === 1 && R) {
            this.c0 = api.clockAt(api.getF());
            DIR.blend = { from: api.getF(), k: 0 };
            api.seek(R.A, true);
            api.setPlaying(false);
            DIR.focus = new Set([R.si, R.di]);
            DIR.cam = halfCam(R.dir * 25, 56, 60);
          }
          if (k === 2 && R) {
            DIR.blend = { from: api.getF(), k: 0 };
            api.seek(R.f60, true);
            api.setPlaying(false);
            DIR.focus = new Set([-1]);
            DIR.cam = halfCam(R.dir * 40, 50, 56);
            document.body.classList.add('tbig');
          }
          const said = [this.where, this.man, this.late][k];
          if (said && !(first && k === 0)) {
            if (first) {
              capLine.replaceChildren(...callLine(said.said));
              capLine.className = 'tcall';
            } else swapCall(said.said);
          }
          if (first && k > 0) api.snapCamera();
        }
        let done = false;
        const W = this.where,
          fade = Math.min(seg(v, 0.02, 0.14), 1 - seg(v, 0.9, 0.99)),
          onPitch = k === 0 ? fade : 0;
        if (W) {
          let landed = 0,
            inside = 0;
          this.dots.forEach((d, i) => {
            const q = W.points[i],
              [x, y] = xy(q.x, q.y),
              a = k === 0 ? out(seg(v, 0.14 + i * 0.03, 0.26 + i * 0.03)) : 1;
            d.setAttribute('cx', x.toFixed(1));
            d.setAttribute('cy', y.toFixed(1));
            d.setAttribute('r', (q.inside ? 9 : 6) * a);
            d.style.opacity = onPitch;
            if (a > 0.5) {
              landed++;
              inside += q.inside;
            }
          });
          done = k === 0 && landed === W.points.length && W.came_true && v < 0.96;
          this.zones.forEach((z, j) => {
            const [a, b] = this.bands[j];
            z.setAttribute(
              'points',
              pts(
                [
                  [24, a],
                  [51, a],
                  [51, b],
                  [24, b],
                ].map(([x, y]) => xy(x, y)),
              ),
            );
            z.style.opacity = onPitch;
            z.classList.toggle('solid', done);
          });
        }
        if (R) {
          // ---- 2. the space, the run that was stopped, the card, the run that went through ----
          const RUN = [0.55, 0.75],
            on2 = k === 1;
          if (on2) {
            if (this.stage === 0) {
              DIR.blend.k = ease(seg(v, 0, 0.1));
              if (v >= 0.1) {
                DIR.blend = null;
                this.stage = 1;
              }
            }
            if (this.stage === 1 && v >= RUN[0]) {
              DIR.blend = { from: R.A, k: 0 };
              api.seek(R.S, true);
              this.stage = 2;
            }
            if (this.stage === 2) {
              DIR.blend.k = ease(seg(v, RUN[0], RUN[1]));
              if (v >= RUN[1]) {
                DIR.blend = null;
                api.setSpeed(1);
                api.setPlaying(true);
                this.stage = 3;
              }
            }
            // the scoreboard says which minute is being shown: the earlier attempt, the booking, then the goal
            DIR.clock =
              v < RUN[0]
                ? keyed(v, [
                    [0, this.c0],
                    [0.09, R.e0],
                    [0.3, R.e1],
                    [0.37, R.e1],
                    [0.4, R.cardT],
                    [0.51, R.cardT],
                    [RUN[0], R.aT],
                  ])
                : null;
          }
          const show = on2 ? Math.min(seg(v, 0.04, 0.13), 1 - seg(v, 0.93, 0.99)) : 0,
            [x0, y0, x1, y1] = R.box,
            T = (q) => xy(q[0] * R.sgn, q[1] * R.sgn);
          this.space.setAttribute(
            'points',
            pts(
              [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
              ].map(([x, y]) => xy(x, y)),
            ),
          );
          this.space.style.opacity = show;
          const g = ease(seg(v, 0.12, 0.3)),
            j = Math.round(R.j0 + g * (R.j1 - R.j0)),
            ga = T(R.E.pos[j][R.sc]),
            gb = T(R.E.pos[j][R.dp]),
            g0 = T(R.E.pos[R.j0][R.sc]);
          const m1 = R.E.pos[R.j1],
            mid = [(m1[R.sc][0] + m1[R.dp][0]) / 2, (m1[R.sc][1] + m1[R.dp][1]) / 2],
            s0 = T([mid[0], mid[1] - 1.9]),
            s1 = T([mid[0], mid[1] + 1.9]);
          const here = api.drawn(R.di) || [0, 0],
            hxy = xy(here[0], here[1]),
            ppm = Math.hypot(xy(here[0] + 1, here[1])[0] - hxy[0], xy(here[0] + 1, here[1])[1] - hxy[1]);
          const ghosts = show * seg(v, 0.1, 0.14),
            past = seg(v, 0.37, 0.44); // the earlier attempt leaves its line and its stop behind, fainter
          for (const [ring, q] of [
            [this.ghostA, ga],
            [this.ghostB, gb],
          ]) {
            ring.setAttribute('cx', q[0].toFixed(1));
            ring.setAttribute('cy', q[1].toFixed(1));
            ring.setAttribute('r', Math.max(8, ppm * 0.95).toFixed(1));
            ring.style.opacity = ghosts * (1 - past);
          }
          for (const [ln, a, b] of [
            [this.ghostPath, g0, ga],
            [this.stop, s0, s1],
          ]) {
            ln.setAttribute('x1', a[0].toFixed(1));
            ln.setAttribute('y1', a[1].toFixed(1));
            ln.setAttribute('x2', b[0].toFixed(1));
            ln.setAttribute('y2', b[1].toFixed(1));
          }
          this.ghostPath.style.opacity = ghosts * (1 - 0.5 * past);
          this.stop.style.opacity = show * seg(v, 0.28, 0.31) * (1 - 0.5 * past);
          const c = out(seg(v, 0.4, 0.46));
          this.card.setAttribute('x', (hxy[0] + ppm * 0.7).toFixed(1));
          this.card.setAttribute('y', (hxy[1] - ppm * 1.2 - 22 - (1 - c) * 26).toFixed(1));
          this.card.style.opacity = show * seg(v, 0.4, 0.43);
          const runner = this.stage >= 3 ? R.shot : api.drawn(R.si) || R.from,
            line2 = [xy(R.from[0], R.from[1]), xy(runner[0], runner[1])];
          if (on2 && this.stage >= 3) {
            const bb = api.ballAt(api.getF());
            line2.push(xy(bb[0], bb[1], bb[2]));
            if (Math.abs(bb[0]) >= 52.2) api.setSpeed(0.15);
          } // once it is in, the picture all but stops, to be looked at
          this.trail.setAttribute('points', pts(line2));
          this.trail.style.opacity = on2 && v >= RUN[0] ? show : 0;
          if (on2) {
            done = v >= RUN[0] && v < 0.96 && (runner[0] - (x0 + x1) / 2) * R.dir > 8;
            this.space.classList.toggle('solid', done);
            look(line2[1]);
          }

          // ---- 3. the clock winds back, runs up, and the goal lands inside the minutes named ----
          const on3 = k === 2;
          if (on3) {
            if (this.stage === 0) {
              DIR.blend.k = ease(seg(v, 0, 0.12));
              if (v >= 0.12) {
                DIR.blend = { from: R.f60, k: 0 };
                api.seek(R.S, true);
                this.stage = 1;
              }
            }
            if (this.stage === 1) {
              DIR.blend.k = 1 - (1 - seg(v, 0.12, 0.56)) ** 2;
              if (v >= 0.56) {
                DIR.blend = null;
                api.setSpeed(1);
                api.setPlaying(true);
                DIR.focus = new Set([R.si]);
                this.stage = 2;
              }
            }
            api.ball.setOpacity(this.stage === 2 ? 1 : 1 - seg(v, 0, 0.06)); // the ball is not part of this picture until it is struck
          }
          const Fs = DIR.blend ? lerp(DIR.blend.from, api.getF(), DIR.blend.k) : api.getF(),
            bb = api.ballAt(api.getF());
          const late = on3 && this.stage >= 1 && Fs >= R.f70,
            hit = on3 && this.stage === 2 && Math.abs(bb[0]) >= 52.2,
            show3 = on3 ? 1 - seg(v, 0.94, 0.99) : 0;
          document.body.classList.toggle('tlate', late && !hit && v < 0.96);
          document.body.classList.toggle('tgoal', hit && v < 0.96);
          const gx = R.dir * 52.5,
            gd = R.dir * 2; // the goal as it is seen from here: its frame and its depth
          this.goal.setAttribute(
            'points',
            pts(
              hull(
                [
                  [gx, -3.66, 0],
                  [gx, 3.66, 0],
                  [gx, -3.66, 2.44],
                  [gx, 3.66, 2.44],
                  [gx + gd, -3.66, 0],
                  [gx + gd, 3.66, 0],
                  [gx + gd, -3.66, 1.6],
                  [gx + gd, 3.66, 1.6],
                ].map(([x, y, h]) => xy(x, y, h)),
              ),
            ),
          );
          this.goal.style.opacity = late ? show3 : 0;
          this.goal.classList.toggle('solid', hit);
          this.trail3.setAttribute('points', pts([xy(R.shot[0], R.shot[1]), xy(bb[0], bb[1], bb[2])]));
          this.trail3.style.opacity = on3 && this.stage === 2 ? show3 : 0;
          if (on3) {
            if (hit) api.setSpeed(0.15);
            done = hit && v < 0.96;
            look([wrap.clientWidth - 150, 50]);
          }
        }
        capLine.classList.toggle('done', done);
      },
      exit() {
        DIR.focus = null;
        DIR.blend = null;
        DIR.clock = null;
        DIR.plain = false;
        api.ball.setOpacity(1);
        document.body.classList.remove('tbig', 'tlate', 'tgoal');
        capLine.className = '';
        over.replaceChildren();
      },
    },

    // Proof: four cards, one at a time, on black. Each is one claim, one large number and one small motion that shows the
    // claim happening. All four at once was about 70 words in 7 seconds, more than twice what anyone can read, with nothing
    // large on the page and nothing shown. Every figure is read from this run and its checks.
    {
      dur: D[6],
      enter() {
        api.setPlaying(false);
        cap.classList.remove('on');
        veil.classList.remove('deep');
        veil.classList.add('on', 'black');
        document.body.classList.add('tproofon');
        look(null); // full black: with the pitch showing through, the cards had to compete with it
        const caught = check('rejects planted errors'),
          rec = check('recovery after a stop at 30%');
        const hits = caught ? (/(\d+) of (\d+)/.exec(caught.detail) || []).slice(1).map(Number) : null,
          same = rec ? +((/(\d+) cues against/.exec(rec.detail) || [])[1] || 0) : 0;
        const g = M.goals[M.goals.length - 1],
          right = g ? g.minute : 72,
          wrong =
            +String(right).split('').reverse().join('') !== right && +String(right).split('').reverse().join('') > 0
              ? +String(right).split('').reverse().join('')
              : right + 9;
        const read = M.event_frames.length,
          fmt = (n) => Math.round(n).toLocaleString('en');
        const card = (claim, viz, cap2) =>
          `<div class="tcard"><h4>${claim}</h4><div class="viz">${viz}</div><b class="num"></b><span>${cap2}</span></div>`;
        const arc = (k) =>
          `<circle r="26" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="46 117.4" transform="rotate(${k * 120 - 90})"/>`;
        side.style.setProperty('--u', `${wrap.clientWidth / 100}px`);
        panel(
          `<div class="tcards">${[
            hits
              ? card(
                  'Every word is checked',
                  `<p class="line">${g ? name(g.player) : 'He'} scores in minute <i><s>${wrong}</s><u>${right}</u></i></p>`,
                  'planted mistakes caught',
                )
              : '',
            card('The screen stays clear', '<canvas></canvas>', 'events made it to the screen'),
            same
              ? card(
                  'It survives a crash',
                  `<div class="bars">${[38, 62, 24, 50, 30, 70, 44, 26, 56, 34].map((w) => `<i style="width:${w / 10}em"></i>`).join('')}</div>`,
                  'items identical after a restart',
                )
              : '',
            card(
              'Silent unless sure',
              `<svg viewBox="-70 -40 140 80">${[0, 1, 2].map((k) => `<g>${arc(k)}</g>`).join('')}<circle r="9" fill="#fff"/></svg>`,
              'checks must agree to give a reason',
            ),
          ].join('')}</div>`,
        );
        side.classList.add('wide');
        const order = [...Array(read).keys()].sort((a, b) => ((a * 2654435761) % 4093) - ((b * 2654435761) % 4093)),
          keep = new Set(order.slice(0, M.shown));
        this.cards = [...side.querySelectorAll('.tcard')].map((el2) => ({ el: el2, num: el2.querySelector('.num') }));
        this.draw = [
          hits &&
            ((c, v) => {
              // a wrong number is struck out and the right one takes its place
              const k = seg(v, 0.3, 0.5);
              c.el.querySelector('s').style.setProperty('--k', k);
              c.el.querySelector('.line i').classList.toggle('fixed', v > 0.56);
              c.num.textContent = `${fmt(hits[0] * ease(seg(v, 0.12, 0.6)))} of ${fmt(hits[1])}`;
            }),
          (c, v) => {
            // every event read is a dot; all but the ones shown fall away
            const cv = c.el.querySelector('canvas'),
              r = Math.min(devicePixelRatio, 2),
              w = cv.clientWidth,
              h = cv.clientHeight,
              cols = Math.ceil(Math.sqrt((read * w) / h)),
              step = w / cols,
              k = ease(seg(v, 0.22, 0.7));
            if (cv.width !== Math.round(w * r)) {
              cv.width = Math.round(w * r);
              cv.height = Math.round(h * r);
            }
            const x = cv.getContext('2d');
            x.setTransform(r, 0, 0, r, 0, 0);
            x.clearRect(0, 0, w, h);
            for (let n = 0; n < read; n++) {
              x.globalAlpha = keep.has(n) ? 1 : Math.max(0.05, 1 - k * 1.25);
              x.fillStyle = '#fff';
              x.beginPath();
              x.arc(
                ((n % cols) + 0.5) * step,
                (Math.floor(n / cols) + 0.5) * step,
                step * (keep.has(n) ? 0.3 : 0.22),
                0,
                6.283,
              );
              x.fill();
            }
            c.num.textContent = `${fmt(read + (M.shown - read) * k)} of ${fmt(read)}`;
          },
          same &&
            ((c, v) => {
              // what is on screen goes dark, and comes back exactly as it was
              const off = v > 0.3 && v < 0.54,
                bars = c.el.querySelector('.bars');
              bars.style.opacity = off ? 0 : 1;
              bars.classList.toggle('back', v >= 0.54);
              c.num.style.opacity = off ? 0.12 : 1;
              c.num.textContent = `${fmt(same)} of ${fmt(same)}`;
            }),
          (c, v) => {
            // three separate marks close into one ring, and only then is there a centre
            const gs = c.el.querySelectorAll('svg g');
            let n = 0;
            gs.forEach((gg, k) => {
              const a = ease(seg(v, 0.14 + k * 0.16, 0.3 + k * 0.16)),
                from = [
                  [-46, -10],
                  [44, -18],
                  [6, 30],
                ][k];
              gg.setAttribute('transform', `translate(${from[0] * (1 - a)} ${from[1] * (1 - a)})`);
              gg.style.opacity = 0.25 + 0.75 * a;
              n += a >= 1;
            });
            c.el.querySelector('svg > circle').style.opacity = seg(v, 0.64, 0.74);
            c.num.textContent = `${n} of 3`;
          },
        ].filter(Boolean);
      },
      update(u) {
        const n = this.cards.length,
          k = Math.min(n - 1, Math.floor(u * n)),
          v = u * n - k;
        this.cards.forEach((c, i) => {
          const on = i === k;
          c.el.style.opacity = on ? Math.min(seg(v, 0, 0.1), 1 - seg(v, 0.93, 1)) : 0;
          c.el.style.transform = on ? `translateY(${(1 - out(seg(v, 0, 0.14))) * 14}px)` : 'none';
          if (on) this.draw[i](c, v);
        });
      },
      exit() {
        clearPanel();
      },
    },

    // The close: the logo alone.
    // The logo comes to the centre. The eye turns to the word, the mark slides across it and the letters are gone behind it. It
    // looks back at where they were, comes to the middle alone, and then looks straight out, blinks once, slowly, and stays.
    // The word is erased by the mark itself and by nothing else. The ring is filled black for this scene, so each letter
    // goes under it as its leading edge arrives, and what has gone under does not come out the other side: the word fades
    // out across the mark's own width. Before, a straight invisible edge ran ahead of the mark and wiped the letters like
    // a block. The limbs are soft tails here (intro.js): they trail as it crosses the word and whip back when it stops.
    {
      dur: D[7],
      enter() {
        side.classList.remove('on');
        veil.classList.remove('deep');
        veil.classList.add('on', 'black');
        logo.classList.add('centre');
        look(null);
        if (art) art.ring.setAttribute('fill', '#000');
      },
      update(u) {
        if (!art) return;
        const t = u * 7.5,
          [x0, y0, reach] = eyeAt,
          ease = (v) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);
        const over = ease(seg(t, 1.7, 3.1)),
          home = ease(seg(t, 3.9, 4.9));
        const far = art.end + MARK.RO,
          x = x0 + (far - x0) * over + (art.mid - far) * home; // out along the word and a ring's width past its last letter, so nothing of it is left, then back to the middle
        // alone at the end it floats a little, straight up and down. At rest the tails stay upright: they bend only when it moves
        const alone = ease(seg(t, 4.7, 5.6)),
          y = y0 + alone * 2.2 * Math.sin(t * 2.1),
          dt = this.was === undefined ? 0 : ((t - this.was) * D[7]) / 7.5;
        this.was = t;
        const [dTop, dBot] = art.tails.step(x, y, MARK.STUB, dt);
        art.ring.setAttribute('cx', x);
        art.ring.setAttribute('cy', y);
        art.limbs[0].setAttribute('d', dTop);
        art.limbs[1].setAttribute('d', dBot);
        const gone = over > 0 ? x0 + (far - x0) * over : -1e4;
        art.fade.setAttribute('x1', gone - MARK.RO * 0.9);
        art.fade.setAttribute('x2', gone + MARK.RO * 0.15); // the word is gone behind the mark, and stays gone when the mark comes back
        // the eye: on the word, back at the gap it left, then dead ahead, wider, with one slow blink and a small start at the end
        const side2 = t < 3.25 ? 1 : t < 4.0 ? 1 - 2 * ease(seg(t, 3.25, 3.6)) : -1 + ease(seg(t, 4.0, 4.9));
        const wide = 1 + 0.2 * ease(seg(t, 4.9, 5.5)),
          blink = Math.max(0, 1 - Math.abs(t - 5.95) / 0.22),
          start = t > 6.5 && t < 6.62 ? 2.2 : 0;
        eye.setAttribute('cx', x + side2 * reach + start);
        eye.setAttribute('cy', y);
        eye.setAttribute('rx', art.rx * wide);
        eye.setAttribute('ry', art.rx * wide * (1 - 0.94 * blink));
      },
    },
  ];

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
  // ---- the music. It is written by ui/tour/music.py and is the film's clock while it plays, so picture and sound cannot drift.
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
  // The corner logo is a copy of the intro's finished drawing, cut to the logo's own box. The intro's drawing is then moved and
  // scaled so that box lands exactly on the copy, and only then is one swapped for the other. Same shapes, same place, same size.
  const fin = await playIntro(host, at < 5 ? { hold: 0.3 } : { at: 99 });
  const copy = fin.svg.cloneNode(true),
    bx = fin.box;
  copy.setAttribute('viewBox', `${bx.x} ${bx.y} ${bx.w} ${bx.h}`);
  copy.removeAttribute('style');
  copy.style.opacity = 1;
  logo.replaceChildren(copy);
  eye = copy.querySelector('[data-eye]');
  eyeAt = fin.svg.dataset.eye.split(' ').map(Number);
  {
    // the parts of the logo, kept for the close, where the mark eats the word and is left alone
    const [ring] = copy.querySelectorAll('ellipse'),
      limbs = [...copy.querySelectorAll('[data-limb]')],
      texts = [...copy.querySelectorAll('text')];
    // the word fades out across the width of the mark as it passes, so no straight edge is ever seen, even on the tall letters
    const svgEl = (tag, attrs, parent) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      parent.appendChild(e);
      return e;
    };
    const defs = svgEl('defs', {}, copy),
      fade = svgEl(
        'linearGradient',
        { id: 'twfade', gradientUnits: 'userSpaceOnUse', x1: -1e4, x2: -1e4 + 1, y1: 0, y2: 0 },
        defs,
      );
    svgEl('stop', { offset: 0, 'stop-color': '#000' }, fade);
    svgEl('stop', { offset: 1, 'stop-color': '#fff' }, fade);
    const mask = svgEl(
      'mask',
      { id: 'twipe', maskUnits: 'userSpaceOnUse', x: bx.x - 200, y: bx.y - 80, width: bx.w + 400, height: bx.h + 160 },
      defs,
    );
    svgEl('rect', { x: bx.x - 200, y: bx.y - 80, width: bx.w + 400, height: bx.h + 160, fill: 'url(#twfade)' }, mask);
    texts.forEach((t) => t.setAttribute('mask', 'url(#twipe)'));
    [ring, ...limbs, eye].forEach((n) => copy.appendChild(n));
    copy.style.overflow = 'visible'; // the mark is drawn over the word, so letters can go under it
    art = {
      ring,
      limbs,
      fade,
      tails: softTails(),
      rx: +eye.getAttribute('rx'),
      end: bx.x + bx.w,
      mid: bx.x + bx.w / 2,
    };
  }
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
      // lines from the centre circle outwards, then the players, then the strip
      api.drawPitch(ease(seg(t, 6.1, 8.3)));
      api.ball.setOpacity(seg(t, 8.75, 9.1)); // the ball last, once the players are standing
      api.figs.forEach((f, i) =>
        f.group.scale.setScalar(Math.max(0.0001, back(seg(t, 7.9 + i * 0.045, 8.25 + i * 0.045)))),
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
      if (ride && local > 0.4) {
        ending();
        api.snapCamera();
      }
    } // jumped into the middle of a feature: no ride
    if (ride) {
      ride.g = seg(local, 0, GL);
      if (DIR.blend) DIR.blend.k = ease(ride.g);
      if (ride.g >= 1) ending();
    }
    if (SCENES[i].update) SCENES[i].update(u);
    dip.style.opacity = 0; // no feature is entered or left through black
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
