// The product film as a video file: bun tools/film_video.ts [port] (the dev server or the preview running on the port
// given, 4173 by default, and ffmpeg on the path). The film plays in a real browser window at its own speed, silent, while
// the browser's screencast keeps every frame it paints with the moment it was painted. ffmpeg lays the frames down at those
// moments and puts the film's own music under them, starting at the instant the film's clock reads zero, so picture and
// sound line up as they do on the page. Writes exports/tempo-film.mp4.
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = `http://localhost:${process.argv[2] ?? '4173'}`,
  OUT = 'exports',
  MUSIC = 'web/public/audio/tempo-theme.m4a';
mkdirSync(OUT, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'tempo-film-'));
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : 'chrome',
  headless: false,
  args: [
    '--mute-audio',
    '--window-size=1300,820',
    // keep painting at full rate even when the window is behind others
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
const frames: { file: string; at: number }[] = [];
cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
  const file = join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, at: f.metadata.timestamp ?? 0 });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); // the last ones may come as the window closes
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
await page.goto(`${BASE}/film/?mute=1`);
await page.waitForFunction(() => (window.__tour?.TOTAL ?? 0) > 0, null, { timeout: 60_000 });
const total = await page.evaluate(() => window.__tour!.TOTAL);
await page.waitForFunction((T) => window.__tour!.now() > T + 1.5, total, { timeout: 200_000, polling: 250 });
// the wall-clock moment the film's clock read zero, which is where its music starts
const zero = await page.evaluate(() => Date.now() / 1000 - window.__tour!.now());
await cdp.send('Page.stopScreencast');
await browser.close();

const first = frames[0]!.at,
  end = zero + total + 1.5;
const kept = frames.filter((f) => f.at <= end);
const list = kept
  .map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (kept[i + 1]?.at ?? f.at + 1 / 30) - f.at).toFixed(4)}`)
  .join('\n');
writeFileSync(join(dir, 'list.txt'), `${list}\nfile '${kept.at(-1)!.file}'\n`);
const lead = Math.max(0, zero - first); // how far into the recording the film's clock starts
const run = Bun.spawnSync([
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  join(dir, 'list.txt'),
  '-itsoffset',
  lead.toFixed(3),
  '-i',
  MUSIC,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-vf',
  'fps=30,format=yuv420p',
  '-c:v',
  'libx264',
  '-crf',
  '18',
  '-preset',
  'slow',
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
if (run.exitCode !== 0) throw new Error(`ffmpeg failed: ${run.stderr.toString()}`);
console.log(`wrote ${OUT}/tempo-film.mp4: ${kept.length} frames, music from ${lead.toFixed(2)} s`);
