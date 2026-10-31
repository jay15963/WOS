// Runs tools/mp-test.html (multiplayer suite) in a private headless Chrome and writes the report.
// usage: node tools/headless/runsuite.mjs "http://localhost:<port>/tools/mp-test.html?run=all&soak=60" <outFile> [cdpPort]
// (use your own dev server port and a cdpPort no other run uses; the Chrome profile goes to the OS temp folder)
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3];
const port = +(process.argv[4] || 9341);
const prof = join(tmpdir(), 'wos-chrome-prof-' + port);
mkdirSync(prof, { recursive: true });
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args = [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1700,950', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--enable-unsafe-swiftshader', 'about:blank',
];
const proc = spawn(chrome, args, { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result?.result?.value; };
try {
  let target = null;
  for (let k = 0; k < 60 && !target; k++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = list.find((t) => t.type === 'page'); } catch { /* not up yet */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  await send('Page.enable');
  await send('Page.navigate', { url });
  const t0 = Date.now();
  let last = '';
  for (;;) {
    await sleep(15000);
    const done = await evalJs('!!window.mpDone');
    const txt = (await evalJs("(document.querySelector('main')||document.body).innerText")) || '';
    const status = txt.split('\n').find((l) => l.startsWith('Totals')) || '';
    if (status !== last) { last = status; console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${status}`); }
    writeFileSync(out, txt);
    if (done || Date.now() - t0 > 3 * 3600e3) break;
  }
  console.log('DONE');
} catch (e) {
  console.error('runner error', e);
} finally {
  try { proc.kill(); } catch { /* ignore */ }
  process.exit(0);
}
