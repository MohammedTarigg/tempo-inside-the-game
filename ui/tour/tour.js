// The Tempo product film: 100 seconds, self-running. It drives the real match view (ui/live) through the real run, one feature
// at a time, so nothing in it is mocked. Open ui/tour/ to play it. ?at=42 starts at a second, ?hold=1 stops there.
//
// It keeps one rhythm from start to finish. Every feature gets the same ten seconds and the same shape: the match clock runs
// forward to the moment (the features are in match order, so it never goes back), the picture settles on one subject with
// everyone else dimmed, one drawing builds, and the picture dips out. Play is at match speed or slower, never faster.
import { playIntro } from '../brand/intro.js';
import { CRESTS } from '../stage.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; (parent || document.body).appendChild(e); return e; };
const clamp = (x) => Math.min(1, Math.max(0, x)), seg = (t, a, b) => clamp((t - a) / (b - a)), lerp = (a, b, u) => a + (b - a) * u;
const upper = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; };
const ease = (u) => u * u * (3 - 2 * u), out = (u) => 1 - (1 - u) ** 3, back = (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;

// Our own icons, in the logo's language: rings, lines and dots at one weight.
const I = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  model: I('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.7 7.2 10.4 10.8M6.7 16.8 10.4 13.2M13.6 10.8 17.3 7.2M13.6 13.2 17.3 16.8"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>'),
  rules: I('<path d="M4 7h10M4 12h16M4 17h7"/><circle cx="18" cy="7" r="1.6" fill="currentColor"/><circle cx="15" cy="17" r="1.6" fill="currentColor"/>'),
  log: I('<path d="M6 4h9l4 4v12H6z"/><path d="M9.5 12h6M9.5 16h6"/>'),
  season: I('<circle cx="6" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>'),
  search: I('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  real: I('<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>'),
  speech: I('<path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4"/>'),
  twin: I('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" stroke-dasharray="3 3"/>'),
  ruler: I('<path d="M4 16 16 4l4 4L8 20z"/><path d="M8.5 11.5l2 2M11.5 8.5l2 2"/>'),
  shield: I('<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.700-7-5-7-9.5V6z"/><path d="M8.8 12.2l2.300 2.300 4.300-4.600"/>'),
  agents: I('<circle cx="12" cy="6.5" r="2.5"/><circle cx="6" cy="16.5" r="2.5"/><circle cx="18" cy="16.5" r="2.5"/><path d="M10.6 8.600 7.400 14.300M13.400 8.600l3.200 5.700M8.500 16.500h7"/>'),
  save: I('<path d="M5 4h11l3 3v13H5z"/><path d="M8.500 4v5h6V4M8.500 20v-6h7v6"/>'),
  lock: I('<rect x="5" y="10.500" width="14" height="9.500" rx="2"/><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500"/>'),
};

export async function run(api) {
  const { M, FPS, DIR } = api, Q = new URLSearchParams(location.search);
  const link = el('link', '', document.head); link.rel = 'stylesheet'; link.href = `../tour/tour.css?v=${Date.now()}`;
  await new Promise((r) => { link.onload = r; link.onerror = r; });           // nothing is measured or shown until the film's styles are in
  const [checks, summary, stakeMeta] = await Promise.all(['../../artifacts/checks.json', `${api.base}summary.json`, '../../artifacts/stake_meta.json'].map((u) => fetch(u).then((r) => r.json()).catch(() => null)));
  const check = (part) => (checks ? checks.results.find((r) => r.check.includes(part)) : null);
  const name = (pid) => M.names[pid], index = (pid) => M.ids.indexOf(pid);

  // ---- the furniture: the logo in the corner, the caption, the dip between features, and the place where drawings go ----
  const wrap = $('stagewrap');
  // The film is one 1280 by 720 frame, scaled to fit the window like a video, so it looks the same on any screen.
  const scale = () => document.body.style.setProperty('--k', Math.min(innerWidth / 1280, innerHeight / 720)); addEventListener('resize', scale); scale();
  el('div', 'tscrim', wrap);
  const logo = el('div', 'tlogo', wrap); logo.innerHTML = '<svg viewBox="0 0 120 120" width="40" height="40" aria-hidden="true"><circle cx="60" cy="60" r="27.5" fill="none" stroke="#fff" stroke-width="13"/><rect x="54.9" y="6" width="10.1" height="26.5" fill="#fff"/><rect x="54.9" y="87.5" width="10.1" height="26.5" fill="#fff"/><circle id="teye" cx="67" cy="60" r="11" fill="#fff"/></svg><b>tempo</b>';
  const cap = el('div', 'tcap', wrap), capNo = el('div', 'tno', cap), capBody = el('div', '', cap), capName = el('h2', '', capBody), capLine = el('p', '', capBody), capChips = el('div', 'tchips', capBody);
  const side = el('div', 'tside', wrap), veil = el('div', 'tveil', wrap), dip = el('div', 'tdip', wrap);
  const eye = $('teye');
  const look = (xy) => {                                                        // the logo's eye turns towards what is being shown
    if (!xy) { eye.setAttribute('cx', 67); eye.setAttribute('cy', 60); return; }
    const dx = xy[0] - (logo.offsetLeft + 20), dy = xy[1] - (logo.offsetTop + 20), L = Math.hypot(dx, dy) || 1;
    eye.setAttribute('cx', 60 + dx / L * 7.5); eye.setAttribute('cy', 60 + dy / L * 7.5);
  };
  function caption(no, title, line, chips) {
    cap.classList.remove('on'); void cap.offsetWidth;
    capNo.textContent = no; capName.textContent = title; capLine.textContent = line;
    capChips.replaceChildren(...chips.map(([icon, text, planned]) => { const c = document.createElement('span'); c.className = planned ? 'planned' : ''; c.innerHTML = ICON[icon]; el('b', '', c, text); if (planned) el('em', '', c, 'planned'); return c; }));
    cap.classList.add('on');
  }
  const panel = (html) => { side.innerHTML = html; side.classList.add('on'); };
  const clearPanel = () => side.classList.remove('on');
  // One way of framing a subject, used by every feature: high enough that markers stay round, the subject a little right of
  // centre so the caption has the lower left to itself.
  const frameOn = (get, height = 38, back2 = 30) => (wantPos, wantAim, b) => { const p = get(b); if (!p) return; wantPos.set(p[0] - 5, height, -p[1] + back2); wantAim.set(p[0] - 5, 0, -p[1] + 4); };
  const onPlayer = (i, h, d) => frameOn(() => api.pos(api.getF(), i), h, d), onBall = (h, d) => frameOn((b) => [b[0], b[1]], h, d);
  const cut = (frame, speed, cam, focus = null) => { api.seek(frame); api.setSpeed(speed); DIR.cam = cam; DIR.focus = focus; DIR.mark = null; api.snapCamera(); api.setPlaying(true); };
  const nearest = (i, n = 1) => { const p = api.pos(api.getF(), i); if (!p) return []; return M.ids.map((_, j) => j).filter((j) => j !== i && M.team[j] !== M.team[i]).map((j) => [j, api.pos(api.getF(), j)]).filter((x) => x[1]).sort((a, c) => Math.hypot(a[1][0] - p[0], a[1][1] - p[1]) - Math.hypot(c[1][0] - p[0], c[1][1] - p[1])).slice(0, n).map((x) => x[0]); };

  // frames the features need, found in the run and not written in by hand
  const firstCue = (form, pred = () => true) => api.timed.find((c) => c.form === form && pred(c));
  const booked = M.cards.length ? index(M.cards[M.cards.length - 1].player) : -1;           // the storyline's player is the last one booked
  const lit = (() => { const s = booked >= 0 ? api.stake[booked] : null; if (!s) return null; const k = s.v.findIndex((v) => v[0] === 2); return k >= 0 ? s.f[k] : s.f.find((_, j) => s.v[j][0] === 1) ?? null; })();
  const quiet = api.frameAtClock(7 * 60);
  const tag = firstCue('tag', (c) => c.start > quiet + 20 * FPS) || firstCue('tag'), form = firstCue('form_card'), scene = firstCue('scene', (c) => c.payload.type === 'closest_attempt');
  const said = scene ? M.cues.filter((c) => c.form === 'sentence' && c.screen === 'phone' && Math.abs(c.frame - scene.frame) < 30) : [];
  const sentence = (lang, depth) => (said.find((c) => c.payload.lang === lang && c.payload.depth === depth) || { payload: { text: '' } }).payload.text;
  const fm = stakeMeta ? stakeMeta.metrics : null, pct = fm ? Math.round(fm.faint_on_at_contact * 100) : null;

  // ---- what each feature draws ----
  const shownFrames = M.cues.filter((c) => c.status !== 'withdrawn' && (c.form !== 'stake_card' || c.payload.level > 0)).map((c) => c.frame).sort((a, b) => a - b);
  const shownAt = new Set(shownFrames.map((f) => upper(M.event_frames, f)));        // which event each shown thing came with
  const pins = $('pins'), gauge = el('div', 'pin tgauge', pins), bars = el('div', 'tbars', wrap), pause = el('div', 'tpause', wrap);
  gauge.innerHTML = '<i></i><u></u><u></u>'; bars.innerHTML = '<i></i><i></i><i></i><i></i><i></i>'; pause.innerHTML = '<i></i><i></i>';
  const TOP = 0.4, notch = gauge.querySelectorAll('u'); notch[0].style.bottom = `${M.stake.faint / TOP * 100}%`; notch[1].style.bottom = `${M.stake.full / TOP * 100}%`;
  const rare = api.timed.find((c) => c.form === 'tag' && c.payload.unit === 'km/h') || tag;          // a shot, if the match has a rare one
  const strike = rare ? [...M.actions].reverse().find((a) => a.kind === 'shot' && a.player === index(rare.payload.player) && a.frame <= rare.start) : null;
  let frame = null, chance = 0;

  // The commentator's line, spoken at the bottom of the picture, and the card Tempo answers with. Both belong to one feature.
  const speak = el('div', 'tspeak', wrap), speakBars = el('span', 'tsb', speak), speakText = el('q', '', speak); speakBars.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  const pcard = el('div', 'tplayer', wrap);
  function playerCard(c) {                                                      // who he is, then his numbers as marks on a scale. No logo: the card is the answer, not a signature
    const p = c.payload, i = index(p.player), team = M.team[i], club = team ? M.away : M.home, crest = CRESTS[club.short.toLowerCase()], pc = p.usual_percentile;
    pcard.replaceChildren(); pcard.style.setProperty('--team', `var(--${team ? 'away' : 'home'})`);
    const top = el('div', 'who', pcard), face = el('div', 'face', top);
    face.innerHTML = '<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="37" r="17"/><path d="M12,100 C12,72 29,61 48,61 C67,61 84,72 84,100 Z"/></svg>'; el('b', '', face, String(M.numbers[i]));
    const id = el('div', '', top); el('h3', '', id, name(p.player)); const t = el('p', '', id); if (crest) { const im = el('img', '', t); im.src = `../brand/${crest}`; im.alt = ''; } t.append(club.name);
    const row = (label, value, build) => { const r = el('div', 'stat', pcard); const h = el('div', '', r); el('span', '', h, label); el('b', '', h, value); build(el('div', 'scale', r)); };
    row('Distance a minute', `${Math.round(p.per_minute)} m`, (sc) => { el('i', 'usual', sc); const d = el('i', 'dot', sc); d.style.setProperty('--x', `${pc}%`); });
    row('Top speed', `${p.top_speed.toFixed(1)} m/s`, (sc) => { const f = el('i', 'fill', sc); f.style.setProperty('--x', `${Math.min(100, p.top_speed / 10 * 100)}%`); });
    el('small', '', pcard, pc > 60 ? 'Above his own usual today' : pc < 40 ? 'Below his own usual today' : 'Close to his own usual today');
  }
  // The match app on a phone. It is our own plain design: a score header, the live picture, and what the match has to say.
  const phone = el('div', 'tphone', wrap), stageBox = $('stage');
  let slot = null, sayEl = null, pills = [], moved = false;
  function buildPhone() {
    phone.replaceChildren(); const sc = M.goals.reduce((a, g) => (g.frame <= api.getF() ? g.score : a), [0, 0]), now = api.getF();
    el('i', 'notch', phone);
    const head = el('div', 'head', phone), side2 = (club) => { const d = el('div', '', head), f = CRESTS[club.short.toLowerCase()]; if (f) { const im = el('img', '', d); im.src = `../brand/${f}`; im.alt = ''; } el('span', '', d, club.name); };
    side2(M.home); const mid = el('div', 'score', head); el('b', '', mid, `${sc[0]} - ${sc[1]}`); el('em', '', mid, `${Math.floor((scene ? scene.frame : now) / FPS / 60) + 1}'`); side2(M.away);
    slot = el('div', 'slot', phone);
    const tabs = el('div', 'tabs', phone); ['Live', 'Line-ups', 'Stats'].forEach((t, k) => el('span', k ? '' : 'on', tabs, t));
    const say = el('div', 'say', phone), row = el('div', 'who', say); pills = ['Casual', 'Analyst', 'عربي'].map((t) => el('span', '', row, t)); sayEl = el('p', '', say);
    const list = el('div', 'events', phone);                                    // what has happened so far, newest first, from the run
    [...M.goals.map((g) => ({ f: g.frame, m: g.minute, who: name(g.player), kind: 'goal' })), ...M.cards.map((c) => ({ f: c.frame, m: c.minute, who: name(c.player), kind: 'card' }))]
      .filter((e) => e.f <= now + FPS).sort((a, b) => b.f - a.f).slice(0, 3).forEach((e) => { const r = el('div', '', list); el('em', '', r, `${e.m}'`); el('i', e.kind, r); el('span', '', r, e.who); });
  }
  const two = (t) => t.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.');
  function phoneSay(k) {                                                        // one sentence at a time; it changes, the phone does not
    if (!sayEl) return; pills.forEach((p, i) => p.classList.toggle('on', i === k));
    const text = k === 0 ? two(sentence('en', 'casual')) : k === 1 ? sentence('en', 'analyst').split('. ').slice(1, 3).join('. ').replace(/\.?$/, '.') : k === 2 ? two(sentence('ar', 'casual')) : '';
    sayEl.classList.remove('in'); setTimeout(() => { sayEl.textContent = text; sayEl.dir = k === 2 ? 'rtl' : 'ltr'; if (k >= 0) sayEl.classList.add('in'); }, k < 0 ? 0 : 180);
  }
  // The move into the phone is one camera pulling back, not two things animating. The phone starts so large that its
  // picture slot lies exactly over the full pitch, and then the phone and the pitch shrink together as one rigid piece, with
  // the same timing. Going back out is the same move reversed. Nothing fades in or pops.
  const MOVE = 'transform 1.25s cubic-bezier(.62,0,.18,1), border-radius 1.25s cubic-bezier(.62,0,.18,1)';
  let geo = null;
  function phoneMode(on) {
    if (on) {
      const k = slot.offsetWidth / wrap.clientWidth; slot.style.height = `${wrap.clientHeight * k}px`;
      const L = phone.offsetLeft, T = phone.offsetTop, px = L + slot.offsetLeft, py = T + slot.offsetTop;
      geo = { k, px, py, big: `translate(${-(px - L) / k - L}px, ${-(py - T) / k - T}px) scale(${1 / k})` };
      phone.style.transition = 'none'; stageBox.style.transition = 'none'; phone.style.transform = geo.big; phone.style.visibility = 'visible'; stageBox.style.zIndex = 4;
      void phone.offsetWidth;                                                   // start from here, then move
      phone.style.transition = MOVE; stageBox.style.transition = `${MOVE}, opacity .2s`;
      phone.style.transform = 'none'; stageBox.style.transform = `translate(${px}px, ${py}px) scale(${k})`; stageBox.style.borderRadius = `${12 / k}px`;
      wrap.classList.add('tphoneon');
    } else if (geo) {
      phone.style.transform = geo.big; stageBox.style.transform = 'none'; stageBox.style.borderRadius = '0px'; wrap.classList.remove('tphoneon');
      setTimeout(() => { phone.style.visibility = 'hidden'; stageBox.style.zIndex = ''; }, 1300); geo = null;
    }
  }
  const proofLine = (icon, big, text) => `<div>${ICON[icon]}<b>${big}</b><span>${text}</span></div>`;
  const full = firstCue('fulltime_card');
  const OUT = 0.5, IN = 0.7;                                                    // the bridge: half a second out, seven tenths in

  // Features are in match order. The two that nobody else has get the most time; the rest keep a short, even beat.
  const SCENES = [
    // 1. Before kick-off. Play is slowed right down and the three marks are held up one at a time.
    { dur: 10, enter() {
      cut(0, 0.3, (wantPos, wantAim) => { wantPos.set(0, 84, 86); wantAim.set(0, 0, 6); }); look(null);
      caption('1', 'Three things to watch', 'What the season says to look for', [['season', 'Season history'], ['search', 'Similar moments']]);
    }, update(u) { const k = Math.min(2, Math.floor(u * 3.15)), v = u * 3.15 - k; DIR.mark = { i: k, k: Math.min(seg(v, 0.04, 0.2), 1 - seg(v, 0.86, 1)), grow: seg(v, 0.08, 0.55) }; }, exit() { DIR.mark = null; } },

    // 2. A hard shot. Under the player, a short line: the season's usual, where rare begins, and a dot that runs out past both.
    //    In the demo match this is the attempt the replay comes back to later.
    { dur: 8, enter() {
      const i = rare ? index(rare.payload.player) : 0; this.i = i;
      cut((strike ? strike.frame : rare ? rare.start : api.frameAtClock(12 * 60)) - 2.4 * FPS, 0.6, onPlayer(i, 40, 32), new Set([i]));
      caption('2', 'How rare was that', 'His shot, against the season', [['season', 'Season history'], ['rules', 'Only when it is rare']]);
    }, update() { const p = api.pos(api.getF(), this.i); if (p) look(api.project(p[0], 0, -p[1])); } },

    // 3. The commentator speaks at the foot of the picture. Then Tempo's card answers with the player and his numbers.
    { dur: 11, enter() {
      const i = form ? index(form.payload.player) : 0; this.i = i; this.said = -1;
      cut((form ? form.start : api.frameAtClock(35 * 60)) - 2 * FPS, 0.5, onPlayer(i), new Set([i]));
      caption('3', 'Heard, then shown', 'The commentator names him. Tempo answers', [['speech', 'Commentary as the cue'], ['speech', 'Speech recognition', true]]);
      this.words = form ? form.payload.heard.split(' ') : []; speakText.textContent = ''; if (form) playerCard(form);
    }, update(u) {
      const n = Math.round(this.words.length * seg(u, 0.1, 0.42));              // the line arrives a word at a time, as speech does
      if (n !== this.said) { this.said = n; speakText.textContent = this.words.slice(0, n).join(' '); }
      speak.classList.toggle('on', u > 0.07 && u < 0.6); speak.classList.toggle('talking', u < 0.42);
      pcard.classList.toggle('on', u > 0.5 && u < 0.97);
      const p = api.pos(api.getF(), this.i); if (p) look(api.project(p[0], 0, -p[1]));
    }, exit() { speak.classList.remove('on'); pcard.classList.remove('on'); } },

    // 4. Beside the booked player, the model's score rises to the two lines where his card turns on and then lights.
    { dur: 14, enter() {
      const f = lit ?? api.frameAtClock(50 * 60); cut(f - 7 * FPS, 0.75, booked >= 0 ? onPlayer(booked) : onBall(), booked >= 0 ? new Set([booked]) : null); chance = 0;
      caption('4', 'The stake', 'His card lights before the tackle', [['model', 'Machine-learning model'], ['real', pct ? `${pct} in 100 on real matches` : 'Tested on real matches']]);
    }, update() {
      const p = booked >= 0 && api.pos(api.getF(), booked); if (!p) { gauge.style.opacity = 0; return; }
      DIR.focus = new Set([booked, ...nearest(booked, 1)]);                    // him and the man he is closing on
      const [, c] = api.levelAt(booked, api.getF()); chance += (c - chance) * 0.12;
      gauge.firstElementChild.style.height = `${Math.min(100, chance / TOP * 100)}%`;
      const xy = api.project(p[0] + 2.6, 0, -p[1]); gauge.style.opacity = 1; gauge.style.transform = `translate(${xy[0]}px, ${xy[1] - 34}px)`; look(xy);
    }, exit() { gauge.style.opacity = 0; } },

    // 5. The replay: back to the start, the earlier attempt laid over the goal, and where they part.
    { dur: 15, nodipOut: true, enter() {
      if (scene) api.seek(scene.frame); api.setPlaying(false); DIR.focus = null; look([wrap.clientWidth / 2, wrap.clientHeight / 2]);
      frame = el('iframe', 'tframe', wrap); frame.src = '../replay/index.html?from=11.7&bare=1'; frame.title = 'Replay of the closest earlier attempt'; requestAnimationFrame(() => frame.classList.add('on'));
      caption('5', 'The reason', 'The same move, earlier. One thing changed', [['twin', 'Twin search'], ['ruler', 'Measured from tracking']]);
    }, exit() { if (frame) { const f = frame; f.classList.remove('on'); setTimeout(() => f.remove(), 700); frame = null; } } },

    // 6. The picture pulls back and turns out to be playing on a phone, inside a match app. Under it, one sentence about the
    //    goal rewrites itself: plain, then in depth, then in Arabic. No cut on the way in or out: the pitch shrinks into the
    //    phone, and grows back out of it for the next feature.
    { dur: 11, nodipIn: true, nodipOut: true, enter() {
      DIR.focus = null; if (scene) cut(scene.frame + 6 * FPS, 0.35, onBall(46, 44)); look([wrap.clientWidth * 0.62, wrap.clientHeight * 0.5]);
      caption('6', 'In your own words', 'The same goal, the way you read it', [['agents', 'Template agents'], ['agents', 'Language model', true]]);
      buildPhone(); this.stage = -1; this.out = false; this.moved = false; moved = false;
      wrap.classList.add('tphoneon');                                           // the scoreboard steps aside before the picture moves
    }, update(u) {
      if (u > 0.09 && !this.out) { this.out = true; phoneMode(true); }         // the replay has finished fading into the pitch; now pull back
      const k = u < 0.24 ? -1 : u < 0.46 ? 0 : u < 0.67 ? 1 : u < 0.86 ? 2 : -1;
      if (k !== this.stage) { this.stage = k; phoneSay(k); }
      if (u > 0.88 && !this.moved) {                                            // while the picture is small, the app moves on to full time
        this.moved = true; stageBox.style.opacity = 0;
        setTimeout(() => { cut((full ? full.start : api.LAST - 8 * FPS) - 2 * FPS, 0.5, onBall(46, 44)); moved = true; const m = phone.querySelector('.score em'); if (m) m.textContent = 'Full time'; stageBox.style.opacity = 1; }, 230);
      }
    }, exit() { phoneSay(-1); } },

    // 7. Full time: the pipeline's own card of what moved the match.
    { dur: 8, nodipIn: true, enter() {
      DIR.focus = null; if (!moved) cut((full ? full.start : api.LAST - 8 * FPS) - 0.8 * FPS, 0.5, onBall(46, 44)); phoneMode(false);      // the match is already at full time; the pitch grows back out of the phone, then the card arrives look([wrap.clientWidth / 2, wrap.clientHeight * 0.4]);
      caption('7', 'What moved the match', 'At the whistle, the moments that decided it', [['log', 'Built from the match\'s own facts']]);
    } },

    // Proof: the properties, said once and plainly, with the numbers from the checks.
    { dur: 6, enter() {
      api.setPlaying(false); cap.classList.remove('on'); veil.classList.add('on', 'black'); look(null);
      const caught = check('rejects planted errors'), rec = check('recovery after a stop at 30%'), same = rec ? (/(\d+) cues against/.exec(rec.detail) || [])[1] : null;
      panel(`<div class="tproof">${caught ? proofLine('shield', caught.detail.split(' caught')[0], 'planted errors caught before the screen') : ''}${same ? proofLine('save', same, 'cues the same after a stop mid-match') : ''}${proofLine('rules', `${M.shown} of ${M.event_frames.length.toLocaleString('en')}`, 'things shown, of the events read')}${checks ? proofLine('real', `${checks.passed} of ${checks.total}`, 'checks pass') : ''}</div>`);
      side.classList.add('wide');
    }, exit() { clearPanel(); } },

    // The close: the logo alone.
    { dur: 7, enter() { side.classList.remove('on'); veil.classList.add('on', 'black'); logo.classList.add('centre'); look(null); } },
  ];

  // ---- the opening: the logo arrives, goes to its corner, and the page draws itself ----
  const OPEN = 10, starts = []; let acc = OPEN; for (const sc of SCENES) { starts.push(acc); acc += sc.dur; } const TOTAL = acc;
  const at = Q.get('at') !== null ? +Q.get('at') : 0, hold = Q.get('hold') !== null;
  api.setPlaying(false); api.seek(0); api.drawPitch(at < 6 ? 0 : 1); for (const f of api.figs) f.group.scale.setScalar(at < 8 ? 0.0001 : 1);
  document.body.classList.add('topen');
  const host = $('intro');
  if (at < 5) {
    await playIntro(host, { hold: 0.25 });
    // the finished logo shrinks into the corner, onto the place the small one will take
    const svg = host.firstElementChild, a = svg.getBoundingClientRect(), b = logo.getBoundingClientRect(), lockW = a.width * 0.6, lockLeft = a.left + a.width * 0.2, k = b.width / lockW;
    svg.style.transition = 'transform 1s cubic-bezier(.7,0,.2,1)'; svg.style.transformOrigin = `${lockLeft - a.left}px ${a.height * 0.5}px`;
    svg.style.transform = `translate(${b.left - lockLeft}px, ${b.top + b.height / 2 - (a.top + a.height * 0.5)}px) scale(${k})`;
    host.style.transition = 'background-color 1s'; host.style.backgroundColor = 'rgba(0,0,0,0)';
    await new Promise((r) => setTimeout(r, 1000));
  }
  host.remove(); logo.classList.add('on');
  const t0 = performance.now() - Math.max(at, 6) * 1000; let cur = -1, opened = false, leaving = -1;
  DIR.cam = (wantPos, wantAim) => { wantPos.set(0, 84, 86); wantAim.set(0, 0, 6); };
  api.snapCamera();

  // The bridge between features is always the same: the picture dips and the caption leaves over the last half second, the
  // match clock runs forward to the next moment, and the picture comes back over the first seven tenths.
  DIR.onFrame = () => {
    const t = hold && cur >= 0 ? Math.max(at, OPEN) + 2.5 : (performance.now() - t0) / 1000;
    if (t < OPEN) {                                                             // lines from the centre circle outwards, then the players, then the strip
      api.drawPitch(ease(seg(t, 6.1, 8.3)));
      api.figs.forEach((f, i) => f.group.scale.setScalar(Math.max(0.0001, back(seg(t, 7.9 + i * 0.045, 8.25 + i * 0.045)))));
      document.body.classList.toggle('tdrawn', t > 8.6); dip.style.opacity = seg(t, OPEN - OUT, OPEN) * 0.9;
      return;
    }
    if (!opened) { opened = true; api.drawPitch(1); for (const f of api.figs) f.group.scale.setScalar(1); document.body.classList.add('tdrawn'); document.body.classList.remove('topen'); }
    let i = starts.findIndex((st, k) => t < st + SCENES[k].dur); if (i < 0) i = SCENES.length - 1;
    const DUR = SCENES[i].dur, u = clamp((t - starts[i]) / DUR), local = t - starts[i];
    if (i !== cur) { if (cur >= 0 && SCENES[cur].exit) SCENES[cur].exit(); cur = i; SCENES[i].enter(); }
    if (SCENES[i].update) SCENES[i].update(u);
    const last = i === SCENES.length - 1, going = !last && !hold && local > DUR - OUT;
    dip.style.opacity = Math.max(SCENES[i].nodipIn ? 0 : 1 - seg(local, 0, IN), going && !SCENES[i].nodipOut ? seg(local, DUR - OUT, DUR) : 0) * 0.9;
    if (going && leaving !== i) { leaving = i; cap.classList.remove('on'); side.classList.remove('on'); }
  };
  window.__tour = { TOTAL, starts };
}
