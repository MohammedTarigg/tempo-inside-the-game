// Tempo match: the whole match on the stage, with everything the pipeline decided to show, where and when it decided it.
// Positions come from runs/<match>/match.bin (25 frames a second) and everything else from match.json. This page decides
// nothing: it draws each cue when the match reaches the frame the cue was issued on.
import * as THREE from 'three';
import { playIntro } from '#intro';
import { renderer, scene, camera, KITS, Marker, makeBall, makePulses, makeZone, makeArrow, SIGNAL, project, fit, watchSize, spread, stageEl, facing, CRESTS, FONT, drawPitch } from '#stage';

const Q = new URLSearchParams(location.search), RUN = Q.get('run') || 'm_demo';
const $ = (id) => document.getElementById(id);
const fail = (m) => { $('err').style.display = 'flex'; $('err').textContent = m; };
const lerp = (a, b, t) => a + (b - a) * t, sat = (t) => Math.min(1, Math.max(0, t));
const upper = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };   // how many are <= x
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; (parent || document.body).appendChild(e); return e; };

async function main() {
  // The intro plays over the picture while the match loads, unless the page was opened at a particular moment.
  const TOUR = Q.get('tour') !== null;                                         // the product film drives this page itself (ui/tour/tour.js)
  const wantIntro = !TOUR && Q.get('intro') !== '0' && !['f', 't', 'm', 'bench'].some((k) => Q.get(k) !== null);
  const intro = wantIntro ? playIntro($('intro')) : Promise.resolve(); if (!wantIntro && !TOUR) $('intro').remove();
  await Promise.all([document.fonts.load(`700 20px ${FONT}`), document.fonts.load(`600 20px ${FONT}`)]).catch(() => {});      // the numbers on the markers are drawn once, so the face must be in
  const base = `../../runs/${RUN}/`;
  const [M, buf] = await Promise.all([
    fetch(base + 'match.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('run'); return r.json(); }),
    fetch(base + 'match.bin', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('run'); return r.arrayBuffer(); }),
  ]).catch(() => [null, null]);
  if (!M) return fail('Could not load the run. Run python3 -m tempo.run_match, then serve the project folder.');
  const D = new Int16Array(buf), ROW = M.row, N = M.ids.length, FPS = M.fps, LAST = M.frames - 1, OFF = -32768;
  const name = (pid) => M.names[pid], index = (pid) => M.ids.indexOf(pid), teamOf = (subject) => (subject === `t_${M.home.short.toLowerCase()}` ? 0 : 1);
  $('hs').textContent = M.home.short; $('as').textContent = M.away.short;
  for (const [id, club] of [['hc', M.home], ['ac', M.away]]) { const f = CRESTS[club.short.toLowerCase()]; if (f) { $(id).src = `../brand/${f}`; $(id).alt = `${club.name} crest`; $(id).hidden = false; $(id).previousElementSibling.hidden = true; } }
  const crest = (club) => { const f = CRESTS[club.short.toLowerCase()]; return f ? `<img src="../brand/${f}" alt="" width="34" height="34">` : ''; };

  // ---- reading the match ----
  const pos = (f, i) => {
    const a = Math.min(LAST, Math.max(0, Math.floor(f))), b = Math.min(LAST, a + 1), t = sat(f - a), o = 2 * i, ax = D[a * ROW + o], bx = D[b * ROW + o];
    if (ax === OFF || bx === OFF) return null;
    return [lerp(ax, bx, t) / 100, lerp(D[a * ROW + o + 1], D[b * ROW + o + 1], t) / 100];
  };
  const ballAt = (f) => { const a = Math.min(LAST, Math.max(0, Math.floor(f))), b = Math.min(LAST, a + 1), t = sat(f - a); return [44, 45, 46].map((k) => lerp(D[a * ROW + k], D[b * ROW + k], t) / 100); };
  const span = (f) => M.periods.find((p) => f <= p.last) || M.periods[M.periods.length - 1];
  const clockAt = (f) => { const p = span(f); return p.clock0 + (f - p.first) / FPS; };
  const frameAtClock = (sec) => { const p = sec >= 2700 && M.periods[1] ? M.periods[1] : M.periods[0]; return Math.min(p.last, Math.max(p.first, p.first + Math.round((sec - p.clock0) * FPS))); };
  const liveAt = (f) => (upper(M.live_flips, f) % 2 === 0) === M.live0;
  const nextDead = (f) => { if (!liveAt(f)) return f; const k = upper(M.live_flips, f); return k < M.live_flips.length ? M.live_flips[k] : f; };

  // ---- what the cues say, laid out by frame so any moment can be shown directly ----
  const stake = Array.from({ length: N }, () => ({ f: [], v: [] }));               // per player: frames and [level, chance]
  const timed = [], said = [], marks = [], shownFrames = [];
  let danger = null;
  for (const c of M.cues) {
    if (c.status === 'withdrawn') continue;
    if (c.form !== 'stake_card' || c.payload.level > 0) shownFrames.push(c.frame);
    if (c.form === 'stake_card') { const s = stake[index(c.payload.player)]; s.f.push(c.frame); s.v.push([c.payload.level, c.payload.chance]); }
    else if (c.form === 'sentence') { if (c.screen === 'phone') said.push(c); }
    else if (c.form === 'danger_window') danger = c.payload;
    else if (c.form === 'kickoff_mark') marks.push(c);
    else {
      const start = c.when === 'next_pause' ? nextDead(c.frame) : c.when === 'next_replay' ? c.frame + 2 * FPS : c.frame;
      timed.push({ ...c, start, end: start + c.valid_for * FPS });
    }
  }
  marks.forEach((c, i) => { c.start = i * 8 * FPS; c.end = c.start + 8 * FPS; });         // the three kick-off marks take turns
  const lateMark = marks.find((c) => c.payload.mark === 'window');
  shownFrames.sort((a, b) => a - b);
  const levelAt = (i, f) => { const k = upper(stake[i].f, f); return k ? stake[i].v[k - 1] : [0, 0]; };
  const active = (form, f) => timed.find((c) => c.form === form && f >= c.start && f < c.end);
  const fade = (c, f, sec = 0.35) => Math.min(sat((f - c.start) / (sec * FPS)), sat((c.end - f) / (sec * FPS)));
  const acts = M.actions.filter((a) => a.kind === 'tackle' || a.kind === 'foul'), actFrames = acts.map((a) => a.frame);
  const downs = M.actions.filter((a) => a.kind === 'down'), downFrames = downs.map((a) => a.frame);       // a fouled player on the ground

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
  stake.forEach((s, i) => s.v.forEach((v, k) => { if (v[0] === 2 && (!k || s.v[k - 1][0] !== 2)) moments.push({ f: s.f[k], text: `At stake: ${name(M.ids[i])}, a challenge is likely` }); }));
  moments.sort((a, b) => a.f - b.f);

  // ---- the players, the ball, and the shapes drawn on the pitch ----
  const figs = [];
  for (let i = 0; i < N; i++) { const kit = { ...KITS[M.team[i]] }; if (M.numbers[i] === 1) kit.shirt = kit.keeper; figs.push(new Marker({ number: M.numbers[i], kit })); scene.add(figs[i].group); }
  const ball = makeBall(), pulses = makePulses(), tint = TOUR ? SIGNAL : undefined, zones = [makeZone(tint), makeZone(tint)], arrows = [makeArrow(tint), makeArrow(tint)]; scene.add(ball.group);      // tint: in the film, what Tempo says before kick-off is yellow, and comes back yellow at the end
  const state = stake.map((s) => (s.f.length ? { k: 0, full: 0 } : null));
  const pins = $('pins'), pin = (cls) => el('div', `pin ${cls}`, pins);
  const names = state.map((s, i) => (s ? Object.assign(pin('name'), { textContent: `${name(M.ids[i])} ${M.numbers[i]}` }) : null));
  const tagEl = pin('plate'), duelEl = pin('plate'), kmEl = pin('plate chip'); tagEl.id = 'tag'; duelEl.id = 'duel'; kmEl.id = 'kmtext'; tagEl.className = 'pin'; tagEl.innerHTML = '<i class="line"></i><u class="usual"></u><u class="rare"></u><i class="dot"></i><b></b>';
  // A pinned graphic follows a point on the pitch. If it would run off the picture it is pulled back inside, and one that
  // would hide under the scoreboard drops below its player instead.
  const place = (e, xy, on, ax = '-50%', ay = '-100%', dy = 0) => {
    e.style.opacity = on; if (on <= 0.01) return;
    const W = stageEl.clientWidth, H = stageEl.clientHeight, w = e.offsetWidth, h = e.offsetHeight, fx = parseFloat(ax) / 100, fy = parseFloat(ay) / 100;
    let x = xy[0] + fx * w, y = xy[1] + dy + fy * h;
    if (y < 64 && fy < 0) y = xy[1] - dy + 6;
    x = Math.min(W - w - 10, Math.max(10, x)); y = Math.min(H - h - 10, Math.max(72, y));      // clear of the scoreboard row
    e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };
  const bez = (a, c, b) => Array.from({ length: 41 }, (_, i) => { const t = i / 40, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; });

  // ---- the strip: momentum, bookings, goals, the danger window ----
  const track = $('track'), X = (f) => `${(f / LAST * 100).toFixed(3)}%`;
  // The strip carries only what a fan reads without being told: who is on top, the bookings and the goals, with the two ends
  // and half time marked. Anything else comes on while it is being explained, with its words, and then goes.
  [0, 45, 90].forEach((m) => { const d = el('div', 'min', track); d.textContent = m; d.style.left = X(m === 45 && M.periods[1] ? M.periods[1].first : frameAtClock(m * 60)); });
  M.cards.forEach((c) => { el('div', 'book', track).style.left = X(c.frame); });
  M.goals.forEach((g) => { const d = el('div', 'goal', track); d.style.left = X(g.frame); d.classList.add(M.team[index(g.player)] ? 'away' : 'home'); });
  let lateSpan = null;                                                         // the late window said at kick-off: shown then, and again as the match enters it
  if (danger) { const a = frameAtClock(danger.from_minute * 60), b = Math.min(LAST, frameAtClock(danger.to_minute * 60)); lateSpan = [a, b]; $('dwin').style.left = X(a); $('dwin').style.width = `${((b - a) / LAST * 100).toFixed(3)}%`; } else $('dwin').style.display = 'none';
  function drawMomentum() {
    const c = $('mom'), w = c.clientWidth, h = c.clientHeight, r = Math.min(devicePixelRatio, 2); c.width = w * r; c.height = h * r;
    const g = c.getContext('2d'); g.scale(r, r); g.clearRect(0, 0, w, h);
    const top = Math.max(0.05, ...M.momentum.map((p) => Math.abs(p[1]))), mid = h / 2, y = (v) => mid - v / top * (mid - 2), css = getComputedStyle(document.documentElement);
    for (const [sign, col] of [[1, css.getPropertyValue('--home')], [-1, css.getPropertyValue('--away')]]) {
      g.beginPath(); g.moveTo(0, mid);
      for (const [f, v] of M.momentum) g.lineTo(f / LAST * w, y(sign > 0 ? Math.max(v, 0) : Math.min(v, 0)));
      g.lineTo(w, mid); g.closePath(); g.fillStyle = col.trim(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(0, mid - 0.5, w, 1);
  }

  const proofIcon = (k) => ({
    attempt: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5" stroke-dasharray="3 2.6"/></svg>',
    ghost: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="6.5" cy="12" r="3.5" fill="#fff"/><circle cx="17.5" cy="12" r="3.5" stroke-dasharray="2.6 2.2"/><path d="M11 12h2.5"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="7.5" y="4" width="9" height="13" rx="2" fill="#FFD21F" transform="rotate(8 12 12)"/></svg>',
    speed: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M3 12h9M6 7.5h8M6 16.5h8"/><circle cx="18" cy="12" r="3" fill="#fff"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><path d="M12 5h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6z" fill="#fff"/><rect x="4" y="5" width="16" height="14" rx="2"/></svg>',
    won: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="#fff"/><path d="M4 12h3M17 12h3M12 4v3M12 17v3"/></svg>',
  }[k] || '');
  let shownProof = null;
  // ---- half time and full time ----
  const icon = (mark) => {
    const y = '#FFD21F', b = '#FFFFFF', t = '#7FD0F5';
    if (mark === 'card') return `<svg width="120" height="64" viewBox="0 0 120 64"><circle cx="34" cy="38" r="20" fill="${t}" stroke="${y}" stroke-width="4"/><rect x="60" y="6" width="20" height="28" rx="3" fill="none" stroke="#FFD21F" stroke-width="3.5"/></svg>`;
    if (mark === 'window') return `<svg width="120" height="64" viewBox="0 0 120 64"><path d="M6,44 H114" stroke="rgba(243,246,239,.35)" stroke-width="3"/><path d="M70,30 V20 H114 V30" fill="none" stroke="${b}" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/></svg>`;
    if (mark === 'goal') return `<svg width="120" height="64" viewBox="0 0 120 64"><path d="M28,56 V14 H92 V56" fill="none" stroke="${b}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="60" cy="42" r="9" fill="${b}"/></svg>`;
    if (mark === 'pressure') return `<svg width="120" height="64" viewBox="0 0 120 64"><path d="M60,10 H104 a4,4 0 0 1 4,4 V52 a4,4 0 0 1 -4,4 H60 Z" fill="${b}"/><rect x="12" y="10" width="96" height="46" rx="4" fill="none" stroke="${b}" stroke-width="3"/></svg>`;
    return `<svg width="120" height="64" viewBox="0 0 120 64"><circle cx="30" cy="38" r="18" fill="${t}"/><circle cx="62" cy="38" r="18" fill="none" stroke="${t}" stroke-width="3.5" stroke-dasharray="7 6"/><path d="M26,10 H66" stroke="${b}" stroke-width="4" stroke-linecap="round"/></svg>`;
  };
  let intervalShown = null;
  function interval(c, sc) {
    if (c === intervalShown) return; intervalShown = c;
    $('interval').style.display = c ? 'flex' : 'none'; if (!c) return;
    $('ih').textContent = c.form === 'halftime_card' ? 'Half time' : 'Turning points';
    $('ip').innerHTML = `${crest(M.home)}<span></span>${crest(M.away)}`; $('ip').querySelector('span').textContent = `${c.form === 'halftime_card' ? '' : 'Full time. '}${M.home.name} ${sc[0]}, ${M.away.name} ${sc[1]}`;
    $('cards').replaceChildren(...c.payload.cards.map((k) => { const a = document.createElement('article'); a.innerHTML = icon(k.mark); const h = el('h3', '', a), p = el('p', '', a); h.textContent = k.title; p.textContent = k.text; return a; }));
  }

  // ---- playback ----
  camera.fov = 30;
  const camPos = new THREE.Vector3(0, 46, 52), camAim = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantAim = new THREE.Vector3();
  const start = Q.get('f') !== null ? +Q.get('f') : Q.get('t') !== null ? +Q.get('t') * FPS : Q.get('m') !== null ? frameAtClock(+Q.get('m') * 60) : null;
  let F = start !== null ? Math.min(Math.max(0, start), LAST) : 0, playing = start === null && !wantIntro && !TOUR, speed = 1, last = performance.now(), snap = true, mode = 'en', shownMoment = '';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DIR = { cam: null, onFrame: null, focus: null, mark: null, blend: null, clock: null, score: null, plain: false };          // hooks for a director: its own camera, a call every frame, the players to keep bright, a kick-off mark to hold up, a time and a score for the scoreboard to show in place of its own, and `plain` to draw the players and the ball with none of the match view's own marks, tags or labels                                      // hooks for a director: its own camera, and a call every frame
  const seek = (f, soft) => { F = Math.min(LAST, Math.max(0, f)); snap = !soft; for (const s of state) if (s) { s.k = 0; s.full = 0; } };       // soft: the camera travels there
  // A director can carry the picture from one moment of the match to another without a cut: while DIR.blend is set, every marker
  // and the ball are drawn part of the way between where they stood at `from` and where they stand now, and the clock rolls with them.
  const mixed = (now, was, k) => (now && was ? now.map((v, j) => lerp(was[j], v, k)) : k > 0.5 ? now : was);
  const drawn = (i) => (DIR.blend ? mixed(pos(F, i), pos(DIR.blend.from, i), DIR.blend.k) : pos(F, i));

  function frame(now, once) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) { F += dt * FPS * speed; if (F >= LAST) { F = LAST; playing = false; $('play').textContent = 'Replay'; } }
    const rate = playing ? speed : 0, b = DIR.blend ? mixed(ballAt(F), ballAt(DIR.blend.from), DIR.blend.k) : ballAt(F), Fs = DIR.blend ? lerp(DIR.blend.from, F, DIR.blend.k) : F, T = F / FPS, P = span(F), kickoff = DIR.mark ? marks[DIR.mark.i] : marks.find((c) => F >= c.start && F < c.end) || (lateSpan && lateMark && F >= lateSpan[0] && F < lateSpan[0] + 8 * FPS ? { ...lateMark, start: lateSpan[0], end: lateSpan[0] + 8 * FPS, again: true } : undefined), markK = (c, sec) => (DIR.mark ? DIR.mark.k : fade(c, F, sec));
    let top = null;
    const shown = spread(figs.map((_, i) => drawn(i)));                         // players in contact overlap, as bodies do; they are only kept from hiding each other completely
    // what contact is doing to each body right now: a quick give at the instant of a challenge, and a spell on the ground after a foul
    const hit = new Float32Array(N), down = new Float32Array(N);
    for (let k = upper(actFrames, F - 0.5 * FPS); k < upper(actFrames, F); k++) { const a = acts[k], age = (F - a.frame) / FPS, v = Math.exp(-7 * age) * Math.cos(20 * age); hit[a.player] = v; if (a.other !== undefined) hit[a.other] = v; }
    for (let k = upper(downFrames, F - 4 * FPS); k < upper(downFrames, F); k++) { const a = downs[k], age = (F - a.frame) / FPS; if (age < a.seconds + 0.4) down[a.player] = Math.min(1, age / 0.18, (a.seconds + 0.4 - age) / 0.4); }
    for (let i = 0; i < N; i++) {
      const fig = figs[i], p = shown[i];
      if (!p) { fig.group.visible = false; if (names[i]) names[i].style.opacity = 0; continue; }
      fig.group.visible = true;
      { const want = DIR.focus && !DIR.focus.has(i) ? 0.28 : 1; fig.dim = (fig.dim ?? 1) + (want - (fig.dim ?? 1)) * (snap ? 1 : 0.1); if (DIR.focus || fig.dim < 0.995) fig.setOpacity(fig.dim); }      // a director can dim everyone but its subject
      const a = pos(F - 3, i) || p, c = pos(F + 3, i) || p, vx = (c[0] - a[0]) * FPS / 6, vy = (c[1] - a[1]) * FPS / 6, sp = Math.hypot(vx, vy);
      fig.group.position.set(p[0], 0, -p[1]);
      fig.setBody(hit[i], down[i]); { const layer = (40 - p[1]) / 800; if (Math.abs(layer - (fig.layerNow || 0)) > 0.002) fig.order(layer); }      // the nearer man is drawn over the further one
      let d = facing(p[0], p[1], vx, vy, b[0], b[1]) - fig.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));        // he watches the ball
      fig.yaw += d * (rate && !snap ? Math.min(1, 0.2 * speed) : 1); fig.turn.rotation.y = fig.yaw;
      if (sp > 0.5) fig.motion.rotation.y = Math.atan2(vx, -vy);
      fig.update(dt, sp, rate);
      const u = state[i];
      if (u) {
        let [lvl, chance] = levelAt(i, F);
        const ifBooked = kickoff && kickoff.payload.mark === 'zone' && kickoff.payload.subject === M.ids[i] ? markK(kickoff, 0.35) : 0;       // "if he is booked": the outline, before anything has happened
        const step = reduce || !playing || snap ? 1 : 1 - Math.exp(-dt * 9);
        u.k += ((lvl > 0 ? 1 : 0) - u.k) * step; u.full += ((lvl === 2 ? 1 : 0) - u.full) * step;
        fig.setStake(DIR.plain ? 0 : Math.max(u.k, ifBooked), u.full, 0.5 + 0.5 * Math.sin(now / 160));
        place(names[i], project(p[0] + 1.6, 0, -p[1]), !DIR.plain && (u.k * u.full > 0.3 || ifBooked > 0.3) ? 1 : 0, '0', '-50%');
        if (lvl > 0 && (!top || lvl > top.lvl || (lvl === top.lvl && chance > top.chance))) top = { i, lvl, chance };
      }
    }
    ball.set(b[0], b[2], -b[1]);
    const k0 = upper(actFrames, F - 0.5 * FPS), k1 = upper(actFrames, F);                 // a thin ring where a challenge has just been made
    pulses(acts.slice(k0, k1).map((a) => { const q = pos(a.frame, a.player); return q && { x: q[0], z: -q[1], age: (F - a.frame) / FPS }; }).filter(Boolean));

    // ---- kick-off marks, drawn on the pitch ----
    let kz = [0, 0], km = null, kmUp = false;
    if (kickoff) {
      const k = markK(kickoff, 0.5), m = kickoff.payload, grow = DIR.mark ? DIR.mark.grow : sat((F - kickoff.start) / (1.6 * FPS));
      if (m.mark === 'channels') {                                              // the wide channels of the third that team attacks
        const dir = (teamOf(m.subject) === 0 ? 1 : -1) * P.home_attacks;
        if (m.zone === 'central') {                                              // the middle of that third, and one straight run at goal
          zones[0].set(dir * 24, -12.2, dir * 51, 12.2, k, false); arrows[0].set(bez([dir * 12, 0], [dir * 28, 0], [dir * 45, 0]), grow, 0.6, k); arrows[1].set([[0, 0], [1, 0]], 0); kz = [1, 0];
        } else {
          [1, -1].forEach((s, j) => { zones[j].set(dir * 24, -s * 21, dir * 51, -s * 33, k, false); arrows[j].set(bez([dir * 27, -s * 27], [dir * 44, -s * 28], [dir * 46, -s * 9]), grow, 0.6, k); });
          kz = [1, 1];
        }
        km = project(dir * 37.5, 0, 34.6);                    // the words sit under the near channel, off the pitch, clear of the players
      } else if (m.mark === 'zone') {                                           // the space in front of the back four, round the man who guards it
        const p = pos(F, index(m.subject));
        if (p) { zones[0].set(p[0] - 8, -p[1] - 7, p[0] + 8, -p[1] + 7, k, true); kz = [1, 0]; km = project(p[0], 0, -p[1] + 8.5); }
      } else if (m.mark === 'window' && TOUR) {                                  // the film has no strip: the words sit by the goal the minutes are about, and the film marks the clock
        km = project((M.periods[1] || P).home_attacks * (teamOf(m.subject) === 0 ? -1 : 1) * 34, 0, 15);
      } else if (m.mark === 'window' && danger) {                                // the minutes it points at are on the strip, so the words sit over them there
          const r = $('dwin').getBoundingClientRect(), st = stageEl.getBoundingClientRect(), zoom = st.width / stageEl.clientWidth || 1; km = [(r.left + r.width / 2 - st.left) / zoom, (r.top - st.top) / zoom - 10]; kmUp = true;      // the page may be scaled to fit its window
        } else km = project(0, 0, 20);
      if (kmEl.textContent !== m.text) kmEl.textContent = m.text; place(kmEl, km, k, '-50%', kmUp ? '-100%' : '0', (1 - k) * (kmUp ? 6 : -6));
    } else kmEl.style.opacity = 0;
    zones.forEach((z, j) => { if (!kz[j]) z.set(0, 0, 0, 0, 0); }); arrows.forEach((a, j) => { if (!kickoff || kickoff.payload.mark !== 'channels') a.set([[0, 0], [1, 0]], 0); });
    $('kmhead').style.display = kickoff && !kickoff.again ? 'block' : 'none'; $('kmhead').classList.toggle('on', !!kickoff && !kickoff.again);
    $('dwin').classList.toggle('on', !!kickoff && kickoff.payload.mark === 'window'); $('dwin').classList.toggle('now', !!lateSpan && F >= lateSpan[0] && F <= lateSpan[1]);

    // ---- the camera: high on the main-stand side, following the ball without chasing every touch; wide before kick-off ----
    if (kickoff) { wantPos.set(0, 84, 86); wantAim.set(0, 0, 6); } else { wantPos.set(b[0] * 0.45, 46, 52); wantAim.set(b[0] * 0.8, 0, -b[1] * 0.3 + 4); }
    if (DIR.cam) DIR.cam(wantPos, wantAim, b);
    const kk = snap || (!playing && !DIR.cam) || reduce ? 1 : 1 - Math.exp(-dt * 2.4 * Math.min(4, Math.max(1, speed)));
    camPos.lerp(wantPos, kk); camAim.lerp(wantAim, kk); camera.position.copy(camPos); camera.lookAt(camAim); camera.updateMatrixWorld();

    // ---- the picture's graphics ----
    const clk = DIR.clock ?? clockAt(Fs), sc = DIR.score || M.goals.reduce((s, g) => (g.frame <= Fs ? g.score : s), [0, 0]);
    $('hg').textContent = sc[0]; $('ag').textContent = sc[1];
    $('clock').textContent = `${String(Math.floor(clk / 60)).padStart(2, '0')}:${String(Math.floor(clk % 60)).padStart(2, '0')}`;
    $('seen').textContent = upper(M.event_frames, Fs).toLocaleString('en'); $('shown').textContent = upper(shownFrames, Fs);
    const lab = !DIR.plain && active('label', F); $('label').style.display = lab ? 'grid' : 'none'; $('label').classList.toggle('on', !!lab); if (lab) { $('label').textContent = lab.payload.text; $('label').classList.toggle('booking', / booked$/.test(lab.payload.text)); }
    const tg = !DIR.plain && active('tag', F), tp = tg && shown[index(tg.payload.player)];
    if (tp && tg.payload.rare) {
      const m = tg.payload, span = m.rare - m.usual, lo = Math.max(0, m.usual - 1.5 * span), top = Math.max(m.value, m.rare) + 0.2 * span, at = (x) => (x - lo) / (top - lo) * 100, go = 1 - (1 - sat((F - tg.start) / (0.9 * FPS))) ** 3;      // the line starts a little below the usual, so the usual sits near its middle; the dot runs out along it to his value
      if (tagEl.dataset.id !== tg.id) { tagEl.dataset.id = tg.id; tagEl.style.setProperty('--team', `var(--${M.team[index(m.player)] ? 'away' : 'home'})`); tagEl.style.setProperty('--usual', `${at(m.usual)}%`); tagEl.style.setProperty('--rare', `${at(m.rare)}%`); tagEl.querySelector('b').textContent = `${Math.round(m.value)} ${m.unit}`; }
      tagEl.style.setProperty('--at', `${at(m.value) * go}%`); tagEl.classList.toggle('past', at(m.value) * go >= at(m.rare));
      place(tagEl, project(tp[0], 0, -tp[1]), fade(tg, F), '-50%', '0', 26);
    } else tagEl.style.opacity = 0;
    const du = !DIR.plain && active('duel', F), da = du && pos(F, index(du.payload.defender)), db = du && pos(F, index(du.payload.attacker));
    if (da && db) { duelEl.replaceChildren(Object.assign(document.createElement('b'), { textContent: `${du.payload.defender_won} v ${du.payload.attacker_won}` }), Object.assign(document.createElement('small'), { textContent: `${name(du.payload.defender)} against ${name(du.payload.attacker)}, duels won` })); place(duelEl, project((da[0] + db[0]) / 2, 0, -(da[1] + db[1]) / 2), fade(du, F), '-50%', '-100%', -30); } else duelEl.style.opacity = 0;
    const fc = !DIR.plain && active('form_card', F); $('form').style.display = fc ? 'grid' : 'none'; $('form').classList.toggle('on', !!fc);
    if (fc) {
      const p = fc.payload, pc = p.usual_percentile;
      $('fname').textContent = `${name(p.player)} ${M.numbers[index(p.player)]}`; $('fval').textContent = `${Math.round(p.per_minute)} m a minute. ${pc > 60 ? 'Above his usual today' : pc < 40 ? 'Below his usual today' : 'Close to his usual today'}`;
      $('fdot').style.left = `${pc}%`; $('fheard').textContent = `Heard from the commentator: "${p.heard}"`;
    }
    const iv = active('halftime_card', F) || active('fulltime_card', F); interval(iv || null, sc);
    const scn = active('scene', F); $('replaytag').style.display = scn ? 'flex' : 'none'; if (scn) $('replaylink').style.display = scn.payload.type === 'closest_attempt' ? 'block' : 'none';

    // ---- the phone: the same moment in words ----
    $('psc').textContent = `${M.home.name} ${sc[0]}, ${M.away.name} ${sc[1]}. Minute ${Math.floor(clk / 60) + 1}`;
    $('pstake').style.display = top ? 'block' : 'none'; $('eye').setAttribute('cx', top ? 67 : 60);
    if (top) {
      $('pname').textContent = name(M.ids[top.i]); $('pcard').className = top.lvl === 2 ? 'full' : '';
      $('ptext').textContent = top.lvl === 2 ? `One foul from a red card. A challenge is likely: about ${Math.round(top.chance * 100)} in 100` : 'One foul from a red card, and he is in the play';
      $('meter').firstElementChild.style.width = `${Math.min(100, Math.round(top.chance * 100))}%`;
    }
    const want = (c) => c.payload.lang === mode;
    let line = null; for (const c of said) { if (c.frame > F) break; if (want(c)) line = c; }
    const fresh = line && F - line.frame < 40 * FPS;
    $('pbig').textContent = fresh ? line.payload.text : ''; $('pbig').dir = mode === 'ar' ? 'rtl' : 'ltr';
    const pk = fresh ? line.id : '';                                            // what stands behind the line: each item is one fact with its number
    if (pk !== shownProof) { shownProof = pk; $('proof').dir = mode === 'ar' ? 'rtl' : 'ltr'; $('proof').replaceChildren(...(fresh ? line.payload.proof || [] : []).map((it) => { const d = document.createElement('div'); d.innerHTML = proofIcon(it.icon); const w = el('span', '', d); el('b', '', w).textContent = it.title; el('small', '', w).textContent = it.note; el('em', '', d).textContent = it.value; return d; })); }
    $('pquiet').textContent = fresh || top ? '' : 'Nothing to add right now. The screen stays clear until there is something worth saying';
    $('note').textContent = M.stake.provisional ? 'Provisional stake model' : `Stake card levels at ${M.stake.faint} and ${M.stake.full}`;
    let mi = -1; for (let i = 0; i < moments.length; i++) if (moments[i].f <= F + 1) mi = i;
    const mt = mi >= 0 && F - moments[mi].f < 12 * FPS ? moments[mi].text : '';
    if (mt !== shownMoment) { shownMoment = mt; $('moment').textContent = mt; }
    $('head').style.left = X(Fs); track.setAttribute('aria-valuenow', Math.round(F / LAST * 100));
    snap = false;
    if (DIR.onFrame) DIR.onFrame(F, now);
    renderer.render(scene, camera);
    if (!once) requestAnimationFrame(frame);
  }

  // ---- controls ----
  $('play').onclick = () => { if (F >= LAST) seek(0); playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; last = performance.now(); };
  $('speed').onclick = () => { speed = speed === 1 ? 4 : speed === 4 ? 16 : 1; $('speed').textContent = `${speed}x`; };
  $('next').onclick = () => { const m = moments.find((x) => x.f - 3 * FPS > F + 1); if (m) seek(m.f - 3 * FPS); };
  $('prev').onclick = () => { const m = [...moments].reverse().find((x) => x.f - 3 * FPS < F - 4 * FPS); seek(m ? m.f - 3 * FPS : 0); };
  const scrub = (e) => { const r = track.getBoundingClientRect(); seek(sat((e.clientX - r.left) / r.width) * LAST); };
  track.onpointerdown = (e) => { track.setPointerCapture(e.pointerId); scrub(e); track.onpointermove = scrub; };
  track.onpointerup = () => { track.onpointermove = null; };
  track.onkeydown = (e) => { if (e.key === 'ArrowRight') seek(F + 10 * FPS); else if (e.key === 'ArrowLeft') seek(F - 10 * FPS); };
  addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); $('play').click(); } });
  document.querySelectorAll('#modes button').forEach((b) => { b.onclick = () => { mode = b.dataset.m; document.querySelectorAll('#modes button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }; });
  if (!playing) $('play').textContent = 'Play';
  watchSize(drawMomentum);
  window.__tempo = { frames: M.frames, moments, seek };
  const api = { M, FPS, LAST, DIR, seek, pos, drawn, ballAt, project, levelAt, stake, timed, marks, frameAtClock, clockAt, figs, ball, drawPitch, stageEl, base, getF: () => F, setPlaying: (v) => { playing = v; last = performance.now(); }, setSpeed: (v) => { speed = v; }, snapCamera: () => { snap = true; } };
  if (Q.get('bench')) {                                                       // times the drawing itself, so it works in a hidden or throttled tab
    const gl = renderer.getContext(), px = new Uint8Array(4), ms = []; playing = true; seek(frameAtClock(49 * 60));
    for (let i = 0; i < 46; i++) { const t0 = performance.now(); frame(last + 33.3, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (i >= 6) ms.push(performance.now() - t0); }
    ms.sort((a, b) => a - b); window.__tempo.bench = { median_ms: +ms[20].toFixed(1), p95_ms: +ms[37].toFixed(1), draw_calls: renderer.info.render.calls }; playing = false; $('play').textContent = 'Play';
  }
  requestAnimationFrame(frame);
  // the film is loaded with a fresh address each time, so the browser never plays a cached copy of it
  if (TOUR) { document.body.classList.add('tour'); (await import(`../tour/tour.js?v=${Date.now()}`)).run(api); }
  if (wantIntro) intro.then(() => { const o = $('intro'); o.style.opacity = 0; setTimeout(() => o.remove(), 600); playing = true; last = performance.now(); $('play').textContent = 'Pause'; });
}
main().catch((e) => fail(`Something went wrong while building the scene: ${e.message}`));
