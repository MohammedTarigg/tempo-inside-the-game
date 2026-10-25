// The product film as video files: bun tools/film_video.ts [port] (the dev server or the preview running on the port
// given, 4173 by default, and ffmpeg on the path). Writes exports/tempo-film.mp4, with the film's music, and
// exports/tempo-film-silent.mp4, without it, both 1920 by 1080 at 30 frames a second.
//
// The film is not filmed in real time, where a frame that takes long to draw is a frame dropped. The page's clock is taken
// over from the first moment: performance.now, requestAnimationFrame, setTimeout and every CSS and web animation (the
// browser's own animation clock is stopped and each animation is moved on by hand), in the page and in the replay's frame.
// Each picture moves that clock on by exactly a thirtieth of a second and is then captured, so the video plays every frame
// at its time however slowly it was drawn. The music is laid under it from the moment the film's clock reads zero, which
// is where it starts on the page.
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = `http://localhost:${process.argv[2] ?? '4173'}`,
  OUT = 'exports',
  MUSIC = 'web/public/audio/tempo-theme.m4a',
  FPS = 30,
  DPR = 1.5; // a 1280 by 720 page recorded at 1920 by 1080

// The page's clock, held from the start: it moves only when __step is called, and then runs the frame callbacks, the
// timers that have come due, and every animation by the same amount. A frame inside the page (the replay) is stepped with it.
const CLOCK = () => {
  const real = performance.now.bind(performance),
    rawTimeout = setTimeout.bind(window),
    rawClear = clearTimeout.bind(window);
  let t = real(),
    id = 1e9,
    frames: [number, FrameRequestCallback][] = [],
    timers: { id: number; at: number; fn: () => void }[] = [];
  performance.now = () => t;
  window.requestAnimationFrame = (cb) => (frames.push([++id, cb]), id);
  window.cancelAnimationFrame = (n) => void (frames = frames.filter(([k]) => k !== n));
  window.setTimeout = ((fn: TimerHandler, ms = 0, ...args: unknown[]) => {
    if (typeof fn !== 'function') return rawTimeout(fn, ms);
    timers.push({ id: ++id, at: t + Math.max(0, ms), fn: () => fn(...args) });
    return id;
  }) as typeof setTimeout;
  window.clearTimeout = ((n?: number) => {
    if (n !== undefined && n > 1e9) timers = timers.filter((x) => x.id !== n);
    else rawClear(n);
  }) as typeof clearTimeout;
  Object.assign(window, {
    __step: (ms: number) => {
      t += ms;
      for (const a of document.getAnimations())
        if (a.playState === 'running') a.currentTime = Number(a.currentTime ?? 0) + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at);
        if (!due.length) break;
        timers = timers.filter((x) => x.at > t);
        for (const x of due) x.fn();
      }
      const run = frames;
      frames = [];
      for (const [, cb] of run) cb(t);
      for (const f of document.querySelectorAll('iframe'))
        (f.contentWindow as unknown as { __step?: (ms: number) => void } | null)?.__step?.(ms);
    },
  });
};

mkdirSync(OUT, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'tempo-film-'));
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR });
const cdp = await page.context().newCDPSession(page);
await page.addInitScript(CLOCK);
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 }); // the browser's animation clock stands still; __step moves each animation
await page.goto(`${BASE}/film/?mute=1`);
await page.waitForTimeout(2000); // the run and the music's timings load while the clock stands at zero

let i = 0,
  lead = NaN, // how far into the video the film's clock reads zero
  total = Infinity;
for (; i < 200 * FPS; i++) {
  const now = await page.evaluate((ms) => {
    const w = window as unknown as { __step: (ms: number) => void; __tour?: { TOTAL: number; now: () => number } };
    w.__step(ms);
    return w.__tour ? [w.__tour.now(), w.__tour.TOTAL] : null;
  }, 1000 / FPS);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
  writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
  if (now) {
    if (Number.isNaN(lead)) lead = i / FPS - now[0]!;
    total = now[1]!;
    if (now[0]! > total + 1.5) break;
  }
  if (i % (10 * FPS) === 0) console.log(`${(i / FPS).toFixed(0)} s`);
}
await browser.close();

const ff = (args: string[]) => {
  const run = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', ...args]);
  if (run.exitCode !== 0) throw new Error(`ffmpeg failed: ${run.stderr.toString()}`);
};
ff([
  '-framerate',
  String(FPS),
  '-i',
  join(dir, '%05d.jpg'),
  '-vf',
  'format=yuv420p',
  '-c:v',
  'libx264',
  '-crf',
  '17',
  '-preset',
  'slow',
  '-movflags',
  '+faststart',
  `${OUT}/tempo-film-silent.mp4`,
]);
ff([
  '-i',
  `${OUT}/tempo-film-silent.mp4`,
  '-itsoffset',
  Math.max(0, lead).toFixed(3),
  '-i',
  MUSIC,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-c:v',
  'copy',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-shortest',
  '-movflags',
  '+faststart',
  `${OUT}/tempo-film.mp4`,
]);
rmSync(dir, { recursive: true });
console.log(
  `wrote ${OUT}/tempo-film.mp4 and ${OUT}/tempo-film-silent.mp4: ${i} frames, music from ${lead.toFixed(2)} s`,
);
