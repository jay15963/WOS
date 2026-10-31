// Headless Chrome step runner (screenshots / probes of the running game).
// usage: node tools/headless/steps.mjs "http://localhost:<port>/?seed=4242&dev=1&fresh=1" <cdpPort> <steps.json> [WxH]
// steps: [{ "js": "expr", "print": true } | { "wait": ms } | { "shot": "out.png" } | { "log": "expr" }]
// The page must have a seed in the URL to boot straight into a world. Camera yaw: game.cam.rot / game.cam.rotTo (radians).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
const [url, port, stepsFile, size = '915x412'] = [process.argv[2], +process.argv[3], process.argv[4], process.argv[5]];
const [VW, VH] = size.split('x').map(Number);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const prof = join(tmpdir(), 'wos-shot-prof-' + port);
try { rmSync(prof, { recursive: true, force: true }); } catch {}
mkdirSync(prof, { recursive: true });
const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', `--window-size=${VW},${VH}`, '--force-device-scale-factor=1', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let k = 0; k < 40 && !t; k++) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(500); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' ')); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url });
for (let k = 0; k < 90; k++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: '!!(window.game&&window.game.net&&window.game.player)', returnByValue: true }); if (r.result?.result?.value) break; }
await sleep(2500);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'EXC ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) : r.result?.result?.value; };
for (const s of steps) {
  if (s.js) { const v = await ev(s.js); if (s.print) console.log('js:', JSON.stringify(v)); }
  if (s.log) console.log('log:', JSON.stringify(await ev(s.log)));
  if (s.wait) await sleep(s.wait);
  if (s.shot) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(s.shot, Buffer.from(shot.result.data, 'base64')); console.log('saved', s.shot); }
}
if (logs.length) console.log('console:\n' + logs.slice(0, 20).join('\n'));
proc.kill(); process.exit(0);
