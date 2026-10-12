// usage: node tools/check_ui.mjs <outdir> [port]   (the static server must be serving the repo root on port 8771)
// Opens the film, the match view and the replay in a headless Chrome of its own, takes a fixed set of stills, and writes report.json
// with console errors, failed requests and the numbers each page exposes. Compare two outdirs to see whether a change altered anything.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [outdir, portArg] = process.argv.slice(2), PORT = +(portArg || 9400), BASE = 'http://localhost:8771';
mkdirSync(outdir, { recursive: true });
const profile = `${outdir}/.chrome`; rmSync(profile, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,720', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }
const report = { pages: [] };
async function open(url) {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(), problems = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    if (d.method === 'Network.responseReceived' && d.params.response.status >= 400 && !/favicon/.test(d.params.response.url)) problems.push(`http ${d.params.response.status}: ${d.params.response.url.replace(/[?&]v=\d+/, '')}`);
    if (d.method === 'Network.loadingFailed' && !d.params.canceled) problems.push('failed: ' + d.params.errorText);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { let r; for (let k = 0; k < 40; k++) { r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result && !(r.result.exceptionDetails && /context|navigat/i.test(JSON.stringify(r.result.exceptionDetails)))) break; await sleep(250); } if (!r.result) throw new Error(JSON.stringify(r.error)); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url }); await sleep(600);
  const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); writeFileSync(`${outdir}/${name}.jpg`, Buffer.from(s.result.data, 'base64')); };
  const close = async () => { await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); ws.close(); return problems; };
  return { ev, shot, close, problems };
}
// the film: for each scene, a few moments after its start
const FILM = { 0: [1.9, 4.9, 7.9], 1: [3.5, 6.0], 2: [3.5, 6.5], 3: [5.0, 10.5], 4: [3.6, 8.6, 12.5, 15.9], 5: [3.0, 5.9, 9.7, 12.3, 14.0], 6: [2.0, 5.0, 8.0], 7: [2.5, 6.8] };
try {
  let starts = null, total = null;
  for (const [scene, secs] of Object.entries(FILM)) {
    const at = starts ? Math.max(0, starts[scene] - 2.5) : 7;
    const p = await open(`${BASE}/ui/tour/?at=${at.toFixed(2)}&mute=1`);
    await p.ev(`new Promise((r, j) => { let n = 0; const w = () => window.__tour ? r(1) : (++n > 300 ? j('no film') : setTimeout(w, 100)); w(); })`);
    if (!starts) { starts = await p.ev('window.__tour.starts'); total = await p.ev('window.__tour.TOTAL'); report.film = { starts: starts.map((x) => +x.toFixed(3)), total: +total.toFixed(3), marks: await p.ev('window.__tour.marks') }; }
    const states = [];
    for (const sec of secs) {
      await p.ev(`new Promise((r, j) => { const lim = performance.now() + 60000, T = window.__tour, w = () => T.now() >= ${starts[scene] + sec} ? r(1) : (performance.now() > lim ? j('slow') : requestAnimationFrame(w)); w(); })`);
      await p.shot(`film_s${scene}_${sec.toFixed(1).replace('.', '_')}`);
      states.push(await p.ev(`JSON.stringify({ t: ${sec}, clock: document.getElementById('clock').textContent, score: document.getElementById('hg').textContent + '-' + document.getElementById('ag').textContent, body: document.body.className, title: document.querySelector('.tcap h2')?.textContent, line: document.querySelector('.tcap p')?.textContent })`));
    }
    report.pages.push({ page: `film scene ${scene}`, states: states.map((s) => JSON.parse(s)), problems: await p.close() });
  }
  for (const [name, url, expr] of [
    ['live_f20000', '/ui/live/index.html?f=20000', `JSON.stringify({ frames: window.__tempo?.frames, moments: window.__tempo?.moments?.length, clock: document.getElementById('clock').textContent, moment: document.getElementById('moment')?.textContent })`],
    ['live_m47', '/ui/live/index.html?m=47.2', `JSON.stringify({ clock: document.getElementById('clock').textContent, score: document.getElementById('hg').textContent + '-' + document.getElementById('ag').textContent, label: document.getElementById('label')?.textContent })`],
    ['live_m72', '/ui/live/index.html?m=71.35', `JSON.stringify({ clock: document.getElementById('clock').textContent, score: document.getElementById('hg').textContent + '-' + document.getElementById('ag').textContent })`],
    ['live_bench', '/ui/live/index.html?f=20000&bench=1', `JSON.stringify({ draw_calls: window.__tempo?.bench?.draw_calls })`],
    ['replay_t3', '/ui/replay/index.html?t=3', `JSON.stringify({ total: window.__tempo?.TOTAL, marks: window.__tempo?.marks, l1: document.getElementById('l1').textContent, l2: document.getElementById('l2').textContent, clock: document.getElementById('clock').textContent })`],
    ['replay_t8_2', '/ui/replay/index.html?t=8.2', `JSON.stringify({ l1: document.getElementById('l1').textContent, l2: document.getElementById('l2').textContent, gap: document.getElementById('gap').textContent, clock: document.getElementById('clock').textContent })`],
    ['replay_bench', '/ui/replay/index.html?t=8.2&bench=1', `JSON.stringify({ draw_calls: window.__tempo?.bench?.draw_calls, triangles: window.__tempo?.bench?.triangles })`],
    ['brand_intro', '/ui/brand/intro.html', `'loaded'`], ['brand_preview', '/ui/brand/preview.html', `'loaded'`], ['brand_portraits', '/ui/brand/portraits.html', `'loaded'`],
  ]) {
    const p = await open(BASE + url);
    await p.ev(`new Promise((r) => { let n = 0; const w = () => (window.__tempo || ++n > 60 ? setTimeout(r, 1500) : setTimeout(w, 100)); w(); })`);
    let state; try { state = JSON.parse(await p.ev(expr)); } catch (e) { state = String(e.message).slice(0, 200); }
    await p.shot(name);
    report.pages.push({ page: name, state, problems: await p.close() });
  }
} catch (e) { report.fatal = String(e.stack || e).slice(0, 600); }
writeFileSync(`${outdir}/report.json`, JSON.stringify(report, null, 1));
chrome.kill(); await sleep(1200); try { rmSync(profile, { recursive: true, force: true }); } catch {}
const bad = report.pages.filter((p) => p.problems.length); console.log(report.fatal ? 'FATAL ' + report.fatal : `ok: ${report.pages.length} pages, ${bad.length} with problems`); for (const p of bad) console.log(' ', p.page, p.problems.slice(0, 4));
