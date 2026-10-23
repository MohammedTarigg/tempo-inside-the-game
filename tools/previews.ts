// The moving pictures in the home page's centre circle, recorded from the real pages: bun tools/previews.ts (with the dev
// server or the preview running on the port given, 4173 by default, and ffmpeg on the path). Each page plays for a few
// seconds at twice its size in pixels. Once it is going, its clock is taken over (performance.now and
// requestAnimationFrame) and moved on by exactly a thirtieth of a second for each picture of the square that matters, so
// every loop is a steady 30 a second however long a picture takes. ffmpeg folds the last second over the first, so the
// loop has no seam. Run it again whenever a view changes.
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = `http://localhost:${process.argv[2] ?? '4173'}`;
const OUT = 'web/public/previews',
  DPR = 2, // the page is recorded at twice its size in pixels, so a loop is sharp on a high-density screen
  LONG = 7, // seconds recorded; the loop is one second shorter, that second folded over its start
  FOLD = 1;
type Shot = {
  name: string;
  path: string;
  ready: () => boolean;
  clicks?: string[];
  settle: number;
  crop: [number, number, number];
};
// crop: the square's left edge, top edge and side, in the 1280 by 720 page
const SHOTS: Shot[] = [
  {
    name: 'film',
    path: '/film/?at=69.5&mute=1',
    ready: () => (window.__tour?.TOTAL ?? 0) > 0,
    settle: 500,
    crop: [600, 20, 560],
  },
  // the goal in minute 72, from four seconds before it
  {
    name: 'match',
    path: '/match/?f=110884',
    ready: () => window.__tempo !== undefined,
    clicks: ['#play'],
    settle: 300,
    crop: [280, 10, 460],
  },
  // at 16 times the speed, so the rows arrive while it plays
  {
    name: 'desk',
    path: '/desk/?m=64.4',
    ready: () => window.__tempo !== undefined,
    clicks: ['#play', '#speed', '#speed'],
    settle: 300,
    crop: [300, 240, 480],
  },
];

// the page's clock, real until frozen; then it moves only when told, and the frame callbacks run when it does
const CLOCK = () => {
  const real = performance.now.bind(performance),
    raf = requestAnimationFrame.bind(window),
    caf = cancelAnimationFrame.bind(window);
  let frozen = false,
    t = 0,
    id = 1e9,
    queue: [number, FrameRequestCallback][] = [];
  performance.now = () => (frozen ? t : real());
  window.requestAnimationFrame = (cb) => (frozen ? (queue.push([++id, cb]), id) : raf(() => cb(performance.now())));
  window.cancelAnimationFrame = (n) => (n > 1e9 ? (queue = queue.filter(([k]) => k !== n)) : caf(n), undefined);
  Object.assign(window, {
    __freeze: () => ((t = real()), (frozen = true)),
    __step: (ms: number) => {
      t += ms;
      const due = queue;
      queue = [];
      for (const [, cb] of due) cb(t);
    },
  });
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR });
const cdp = await page.context().newCDPSession(page);
await page.addInitScript(CLOCK);
for (const s of SHOTS) {
  const dir = mkdtempSync(join(tmpdir(), `tempo-${s.name}-`));
  await page.goto(BASE + s.path);
  await page.waitForFunction(s.ready, null, { timeout: 30_000 });
  for (const c of s.clicks ?? []) await page.click(c);
  await page.waitForTimeout(s.settle);
  const [x, y, side] = s.crop,
    count = LONG * 30;
  await page.evaluate(() => (window as unknown as { __freeze: () => void }).__freeze());
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => (window as unknown as { __step: (ms: number) => void }).__step(1000 / 30));
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 94,
      clip: { x, y, width: side, height: side, scale: DPR },
    });
    writeFileSync(join(dir, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
  }
  const cut = `fps=30,trim=0:${LONG},setpts=PTS-STARTPTS`,
    fold = `[v]split[a][b];[a]trim=${FOLD}:${LONG},setpts=PTS-STARTPTS[body];[b]trim=0:${FOLD},setpts=PTS-STARTPTS[head];[body][head]xfade=transition=fade:duration=${FOLD}:offset=${LONG - 2 * FOLD},format=yuv420p`;
  const run = Bun.spawnSync([
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '30',
    '-i',
    join(dir, '%04d.jpg'),
    '-filter_complex',
    `[0:v]${cut}[v];${fold}`,
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'slow',
    '-movflags',
    '+faststart',
    `${OUT}/${s.name}.mp4`,
  ]);
  if (run.exitCode !== 0) throw new Error(`ffmpeg failed on ${s.name}: ${run.stderr.toString()}`);
  rmSync(dir, { recursive: true });
  console.log('wrote', s.name);
}
await browser.close();
