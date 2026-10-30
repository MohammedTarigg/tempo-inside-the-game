// How we know: the claims worth weighing, each with its figure, a picture of what was measured, what it was measured on,
// and the command that measures it again. Every number and every mark is read from the files the evaluations wrote, so
// the page cannot say more than the last run found.
import '../styles/evidence.css';
import calls from '../../../results/calls.json';
import checks from '../../../results/checks.json';
import realism from '../../../results/realism.json';
import stake from '../../../models/stake_meta.json';
import summary from '../../public/runs/m_demo/summary.json';
import { LOGO } from '../match/markup.ts';
import { site, el } from '../shared/util.ts';

const n = (x: number) => x.toLocaleString('en');
const NS = 'http://www.w3.org/2000/svg';
// a small drawing: an svg of the given size, filled by the caller's markup
const svg = (w: number, h: number, body: string, label: string) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" xmlns="${NS}">${body}</svg>`;
const check = (part: string) => checks.results.find((r) => r.check.includes(part));
const counts = (part: string) => check(part)?.counts as Record<string, number> | undefined;

// ---- 1. the calls made before kick-off, on matches the season never saw: for each call one small square per match, in
// rows of fifty, filled where it held, outlined where it did not, a faint dot where the match never tested it ----
const callsPicture = () => {
  const rows: [keyof typeof calls.by_call, string][] = [
    ['channels', 'Where they shoot'],
    ['window', 'Late chances'],
    ['zone', 'The booked player'],
  ];
  const W = 560,
    x0 = 150,
    per = 50,
    s = (W - x0) / per,
    r0 = s * 0.36;
  let y = 0,
    body = '';
  for (const [mark, name] of rows) {
    const t = calls.by_call[mark],
      lines = Math.ceil(calls.per_match.length / per);
    body += `<text x="0" y="${y + 12}" class="lab">${name}</text>`;
    body += `<text x="0" y="${y + 30}" class="num">${t.held} of ${t.held + t.failed}</text>`;
    calls.per_match.forEach((m, j) => {
      const c = m.calls.find((k) => k.mark === mark),
        cx = x0 + (j % per) * s + s / 2,
        cy = y + Math.floor(j / per) * s + s / 2;
      body +=
        c?.came_true === true
          ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r0.toFixed(1)}" class="held"/>`
          : c?.came_true === false
            ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r0 - 0.6).toFixed(1)}" class="failed thin"/>`
            : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.1" class="none"/>`;
    });
    y += Math.max(40, lines * s) + 22;
  }
  return svg(W, y - 22, body, `${calls.held} of ${calls.tested} calls held across ${calls.per_match.length} matches`);
};
const key = (items: [string, string][]) =>
  `<p class="key">${items.map(([cls, words]) => `<span><i class="${cls}"></i>${words}</span>`).join('')}</p>`;

// ---- 2. every planted mistake, by kind, all caught ----
const caught = counts('rejects planted errors'),
  kinds = (() => {
    const m = /\{([^}]*)\}/.exec(check('rejects planted errors')?.detail ?? '');
    return m
      ? [...m[1]!.matchAll(/'([^']+)': (\d+)/g)].map((k) => [k[1]!, Number(k[2])] as [string, number])
      : ([] as [string, number][]);
  })();
const KIND: Record<string, string> = {
  number: 'Wrong numbers',
  name: 'Wrong names',
  overclaim: 'Claims beyond the facts',
  'arabic digit': 'Arabic digits',
};
const mistakesPicture = () => {
  const per = 10,
    s = 11;
  let x = 0,
    body = '';
  for (const [kind, count] of kinds) {
    const cols = Math.ceil(count / per);
    for (let i = 0; i < count; i++)
      body += `<rect x="${x + Math.floor(i / per) * s}" y="${(i % per) * s}" width="8" height="8" rx="2" class="held"/>`;
    body += `<text x="${x}" y="${per * s + 16}" class="lab">${KIND[kind] ?? kind}</text><text x="${x}" y="${per * s + 33}" class="num">${count}</text>`;
    x += Math.max(cols * s, (KIND[kind] ?? kind).length * 7.2) + 26; // each group as wide as its words need
  }
  return svg(560, per * s + 40, body, `${caught?.caught} of ${caught?.planted} planted mistakes caught`);
};

// ---- 3. the stake card on real matches: how many challenges by a booked player found his card already on ----
const M = stake.metrics;
const stakePicture = () => {
  const pts: [string, number][] = [
      ['1 s before', M.faint_one_second_before],
      ['½ s before', M.faint_half_second_before],
      ['At contact', M.faint_on_at_contact],
    ],
    W = 560,
    H = 150,
    bw = 96;
  let body = `<line x1="0" x2="${W}" y1="${H - 24}" y2="${H - 24}" class="axis"/>`;
  pts.forEach(([when, v], i) => {
    const x = 10 + i * (bw + 80),
      h = v * (H - 44);
    body += `<rect x="${x}" y="${H - 24 - h}" width="${bw}" height="${h}" rx="4" class="${i === 2 ? 'card' : 'held'}"/>`;
    body += `<text x="${x + bw / 2}" y="${H - 30 - h}" class="num" text-anchor="middle">${Math.round(v * 100)}</text>`;
    body += `<text x="${x + bw / 2}" y="${H - 6}" class="lab" text-anchor="middle">${when}</text>`;
  });
  return svg(W, H, body, `${Math.round(M.faint_on_at_contact * 100)} in 100 challenges with the card on at contact`);
};

// ---- 4. the demo match: every event read is a dot, the ones that reached the screen are lit ----
const screenPicture = () => {
  const read = summary.events_read,
    shown = summary.things_shown,
    cols = 61,
    s = 9,
    order = [...Array(read).keys()].sort((a, b) => ((a * 2654435761) % 4093) - ((b * 2654435761) % 4093)),
    lit = new Set(order.slice(0, shown));
  let body = '';
  for (let i = 0; i < read; i++)
    body += `<circle cx="${(i % cols) * s + 4}" cy="${Math.floor(i / cols) * s + 4}" r="${lit.has(i) ? 3 : 1.6}" class="${lit.has(i) ? 'held' : 'none'}"/>`;
  return svg(cols * s, Math.ceil(read / cols) * s, body, `${shown} of ${read} events reached the screen`);
};

// ---- 5. the demo match stopped twice and resumed from its checkpoint: what was on screen came back item for item ----
const restarts = checks.results.filter((r) => r.check.startsWith('recovery after a stop')),
  same = counts('recovery after a stop at 30%');
const crashPicture = () => {
  const W = 560,
    y = 40;
  let body = `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="track"/>`;
  for (const r of restarts) {
    const at = Number(/at (\d+)%/.exec(r.check)?.[1] ?? 0) / 100,
      x = at * W;
    body += `<line x1="${x}" x2="${x}" y1="${y - 16}" y2="${y + 16}" class="stop"/>`;
    body += `<text x="${x}" y="${y - 24}" class="lab" text-anchor="middle">Stopped at ${Math.round(at * 100)}%</text>`;
    body += `<text x="${x}" y="${y + 36}" class="num" text-anchor="middle">${r.passed ? 'Identical' : 'Different'}</text>`;
  }
  body += `<text x="0" y="${y + 36}" class="lab">Kick-off</text><text x="${W}" y="${y + 36}" class="lab" text-anchor="end">Full time</text>`;
  return svg(W, 86, body, `${same?.identical} of ${same?.cues} items identical after a restart`);
};

// ---- 6. speed: the time each frame takes, against what a frame may take ----
const speed = (() => {
  const d = check('reflex path under 10 ms')?.detail ?? '',
    get = (k: string) => Number(new RegExp(`${k} ([\\d.]+) ms`).exec(d)?.[1] ?? 0);
  return { p50: get('p50'), p95: get('p95'), p99: get('p99'), slow: get('slowest') };
})();
const ms1 = (ms: number) => (ms < 1 ? ms : Math.round(ms * 10) / 10);
const speedPicture = () => {
  const W = 560,
    y = 44,
    max = 40, // a frame of the feed lasts 40 ms at 25 a second
    x = (ms: number) => (Math.log10(ms * 100 + 1) / Math.log10(max * 100 + 1)) * W;
  let body = `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="track"/>`;
  body += `<rect x="0" y="${y - 4}" width="${x(speed.p99)}" height="8" rx="4" class="held"/>`;
  const marks: [string, number, boolean, 'middle' | 'end'][] = [
    [`Typical ${speed.p50} ms`, speed.p50, true, 'middle'],
    [`99 in 100 ${ms1(speed.p99)} ms`, speed.p99, true, 'middle'],
    ['Limit 10 ms', 10, false, 'middle'],
    [`A frame ${max} ms`, max, false, 'end'],
  ];
  marks.forEach(([words, ms, ours, anchor], i) => {
    const xx = x(ms);
    body += `<line x1="${xx}" x2="${xx}" y1="${y - 12}" y2="${y + 12}" class="${ours ? 'tick' : 'stop'}"/>`;
    body += `<text x="${xx}" y="${i % 2 ? y + 32 : y - 20}" class="lab" text-anchor="${anchor}">${words}</text>`;
  });
  return svg(W, 84, body, `99 in 100 frames within ${speed.p99} ms`);
};

const MEASURE: [RegExp, string][] = [
  [/metres a minute/, 'Running a minute'],
  [/above 5\.5/, 'Time above 5.5 m/s'],
  [/above 7 m/, 'Time above 7 m/s'],
  [/nearest defender/, 'Nearest defender to the ball'],
  [/ball in play/, 'Ball in play'],
  [/defender-moments/, 'Defenders near a live ball'],
  [/logged defending/, 'Challenges'],
  [/followed by a challenge/, 'Moments that become a challenge'],
  [/score: mean/, 'Stake score, average'],
  [/faint threshold/, 'Stake score above faint'],
  [/full threshold/, 'Stake score above full'],
  [/ROC AUC/, 'Stake model, AUC'],
  [/^faint cards/, 'Faint cards if everyone carried one'],
  [/^full cards/, 'Full cards if everyone carried one'],
];
const said = (m: string) => MEASURE.find(([re]) => re.test(m))?.[1] ?? m;
// ---- 7. generated football against seven real matches: each measure as generated over real, with the 25% band ----
const realismPicture = () => {
  const rows = realism.rows.map((r) => {
      const a = Array.isArray(r.real) ? r.real[1]! : r.real,
        b = Array.isArray(r.generated) ? r.generated[1]! : r.generated;
      return { name: r.measure, ratio: b / a, ok: r.within_25_percent };
    }),
    W = 560,
    x0 = 250,
    span = W - x0 - 10,
    lo = Math.log(0.5),
    hi = Math.log(2),
    x = (v: number) => x0 + ((Math.log(Math.min(2, Math.max(0.5, v))) - lo) / (hi - lo)) * span,
    rh = 22;
  let body = `<rect x="${x(0.75)}" y="0" width="${x(1.25) - x(0.75)}" height="${rows.length * rh}" class="band"/>`;
  body += `<line x1="${x(1)}" x2="${x(1)}" y1="0" y2="${rows.length * rh}" class="axis"/>`;
  rows.forEach((r, i) => {
    const y = i * rh + rh / 2;
    body += `<text x="0" y="${y + 4}" class="lab small">${said(r.name)}</text>`;
    body += `<line x1="${x(1)}" x2="${x(r.ratio)}" y1="${y}" y2="${y}" class="stem"/>`;
    body += `<circle cx="${x(r.ratio)}" cy="${y}" r="5" class="${r.ok ? 'held' : 'failed'}"/>`;
  });
  body += `<text x="${x(1)}" y="${rows.length * rh + 16}" class="lab" text-anchor="middle">As real</text>`;
  body += `<text x="${x(0.5)}" y="${rows.length * rh + 16}" class="lab">Half</text><text x="${x(2)}" y="${rows.length * rh + 16}" class="lab" text-anchor="end">Double</text>`;
  return svg(W, rows.length * rh + 22, body, `${realism.within} of ${realism.total} measures within 25% of real`);
};

// ---- 8. the pipeline's own checks ----
const checksList = () =>
  `<ul class="checks">${checks.results.map((r) => `<li class="${r.passed ? 'ok' : 'no'}">${r.check[0]!.toUpperCase()}${r.check.slice(1)}</li>`).join('')}</ul>`;

const CLAIMS = [
  {
    figure: `${calls.held} of ${calls.tested}`,
    claim: 'Calls made before kick-off that held',
    picture:
      callsPicture() +
      key([
        ['held', 'Held'],
        ['failed', 'Did not'],
        ['none', 'Not tested: the booked-player call needs him booked'],
      ]),
    on: `${calls.per_match.length} generated matches the season never saw`,
    run: 'uv run tempo calls',
  },
  caught && {
    figure: `${n(caught.caught!)} of ${n(caught.planted!)}`,
    claim: 'Planted mistakes the checker caught before air',
    picture: mistakesPicture(),
    on: 'Every sentence the writer could produce, with one mistake planted in each',
    run: 'uv run tempo check',
  },
  {
    figure: `${Math.round(M.faint_on_at_contact * 100)} in 100`,
    claim: 'Challenges by a booked player that found his card already on',
    picture: stakePicture(),
    on: `${M.challenges_by_booked} challenges in ${M.matches} real Bundesliga matches, each scored by a model that never saw that match`,
    run: 'uv run tempo data && uv run tempo train',
  },
  {
    figure: `${n(summary.things_shown)} of ${n(summary.events_read)}`,
    claim: 'Events that reached the screen',
    picture: screenPicture(),
    on: 'The demo match, every event the feed sent',
    run: 'uv run tempo run',
  },
  same && {
    figure: `${n(same.identical!)} of ${n(same.cues!)}`,
    claim: 'Items on screen identical after a crash',
    picture: crashPicture(),
    on: 'The demo match, stopped twice and resumed each time from its last checkpoint',
    run: 'uv run tempo check',
  },
  {
    figure: `${ms1(speed.p99)} ms`,
    claim: 'Time to handle a frame, 99 times in 100',
    picture: speedPicture(),
    on: `The demo match, every frame, the model included. The slowest single frame took ${Math.round(speed.slow)} ms`,
    run: 'uv run tempo check',
  },
  {
    figure: `${realism.within} of ${realism.total}`,
    claim: 'Measures of generated football within 25% of real',
    picture:
      realismPicture() +
      key([
        ['held', 'Within 25%'],
        ['failed', 'Outside'],
      ]),
    on: 'Two generated matches against seven real Bundesliga matches',
    run: 'uv run tempo realism',
  },
  {
    figure: `${checks.passed} of ${checks.total}`,
    claim: 'Pipeline checks that pass',
    picture: checksList(),
    on: `Last run ${checks.ran_at}`,
    run: 'uv run tempo check',
  },
].filter((c) => !!c);

const page = el('main', 'evidence');
const head = el('a', 'brand', page);
head.href = site('');
head.innerHTML = `${LOGO}<b>tempo</b>`;
el('h1', '', page, 'How we know');
const list = el('ol', 'claims', page);
for (const c of CLAIMS) {
  const li = el('li', '', list);
  const words = el('div', 'words', li);
  el('b', 'figure', words, c.figure);
  el('h2', '', words, c.claim);
  el('p', '', words, c.on);
  el('code', '', words, c.run);
  el('div', 'picture', li).innerHTML = c.picture;
}
