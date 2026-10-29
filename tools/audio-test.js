// Localhost-only listening / measuring page for the procedural audio (tools/audio-test.html).
// window.audioTest: { analyze(), soak(), playAll() } — results also in window.audioReport.

import { getAudio, renderOffline, DEFAULT_LEVELS } from '../src/fx/audio.js';
import { SFX } from '../src/fx/sfxBank.js';
import { MOODS } from '../src/fx/music.js';
import { audioSettings } from '../src/fx/audioSettings.js';

const $ = (s) => document.querySelector(s);
if (!/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  document.body.innerHTML = '<p style="padding:20px">Página de teste disponível somente em localhost.</p>';
  throw new Error('localhost only');
}

const a = getAudio();
a.director = { update() {}, onOp() {} }; // no automatic moods on this page
audioSettings($('[data-audio-settings]'));

// ---------- a tiny fake world for the soundscape scenes ----------
function fakeWorld({ room = false, cave = false, lake = false, fire = false } = {}) {
  const W = 64, H = 64, N = W * H;
  const w = {
    W, H, water: new Uint8Array(N), ground: new Uint8Array(N), rock: new Uint8Array(N), solid: new Uint8Array(N),
    lush: new Float32Array(N).fill(0.65), flowX: new Float32Array(N), flowY: new Float32Array(N), objById: new Map(),
    inBounds: (x, y) => x >= 0 && y >= 0 && x < W && y < H, idx: (x, y) => y * W + x,
    caveDark: () => (cave ? 1 : 0), isCave: () => cave,
  };
  if (room) for (let k = 28; k <= 36; k++) for (const [x, y] of [[k, 28], [k, 36], [28, k], [36, k]]) { w.rock[y * W + x] = 1; w.solid[y * W + x] = 1; }
  if (lake) for (let y = 24; y < 31; y++) for (let x = 34; x < 44; x++) w.water[y * W + x] = 1;
  const objs = [];
  for (let k = 0; k < 18; k++) objs.push({ type: 'tree_oak', x: 20 + ((k * 37) % 24), y: 20 + ((k * 53) % 24) });
  if (fire) objs.push({ type: 'campfire', fire: true, x: 34, y: 33 });
  w.query = () => objs;
  return w;
}
const env = { wind: 0.25, gust: 0, rain: 0, night: 0, day: 1, hour: 10 };
const G = {
  env: { env, strikes: [], strikeId: 0 }, world: fakeWorld(), player: { x: 32.5, y: 32.5 }, cam: { x: 32.5, y: 32.5, zoom: 40 }, R: { cssW: 1200 },
  entities: [], build: { grid: { main: new Map(), floor: new Map(), rug: new Map() }, structures: [], doors: [] }, events: { on() {}, h: new Map() }, ui: {},
};
G.entities.push(G.player);
a.attach(G);
let scene = null, stormT = 0;
const SCENES = {
  'Campo de dia': { hour: 10, day: 1, night: 0, wind: 0.25, rain: 0 },
  'Amanhecer': { hour: 6.2, day: 0.6, night: 0, wind: 0.12, rain: 0 },
  'Noite': { hour: 23, day: 0, night: 1, wind: 0.15, rain: 0 },
  'Fogueira à noite': { hour: 22, day: 0, night: 1, wind: 0.1, rain: 0, world: { fire: true } },
  'Lago': { hour: 15, day: 1, night: 0, wind: 0.2, rain: 0, world: { lake: true } },
  'Chuva (fora)': { hour: 14, day: 0.6, night: 0, wind: 0.55, rain: 0.8 },
  'Chuva (dentro de casa)': { hour: 14, day: 0.6, night: 0, wind: 0.55, rain: 0.8, world: { room: true } },
  'Tempestade': { hour: 16, day: 0.4, night: 0, wind: 0.92, rain: 1, storm: true },
  'Caverna': { hour: 12, day: 1, night: 0, wind: 0.2, rain: 0, world: { cave: true } },
  'Silêncio': { hour: 12, day: 0, night: 0, wind: 0, rain: 0, silent: true },
};
for (const name in SCENES) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => {
    a.unlock();
    scene = SCENES[name];
    Object.assign(env, { hour: scene.hour, day: scene.day, night: scene.night, wind: scene.wind, rain: scene.rain, gust: 0 });
    G.world = fakeWorld(scene.world || {});
    document.querySelectorAll('#scenes button').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#scenes').appendChild(b);
}
setInterval(() => {
  if (!a.ctx || a.ctx.state !== 'running') return;
  if (scene?.storm) {
    stormT -= 0.1;
    env.gust = Math.max(0, Math.sin(performance.now() / 2300)) * 0.9;
    if (stormT <= 0) { stormT = 5 + Math.random() * 6; G.env.strikes.push({ dist: Math.random() }); G.env.strikeId++; }
  }
  if (scene) a.update(G, 0.1);
}, 100);

// ---------- music ----------
for (const m of MOODS) {
  const b = document.createElement('button');
  b.textContent = m;
  b.onclick = () => {
    a.unlock();
    const M = a.music;
    M.mood = null;
    if (M.cur) M.stopAll(1.2);
    M.setMood(m);
    M.nextAt = a.ctx.currentTime + 0.3;
    document.querySelectorAll('#moods button').forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#moods').appendChild(b);
}
$('#stop').onclick = () => { a.music.stopAll(2); a.music.nextAt = 1e9; };
$('#next').onclick = () => { a.unlock(); a.music.stopAll(1.5); a.music.nextAt = a.ctx.currentTime + 0.5; };
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
setInterval(() => {
  const M = a.music, p = M.cur, t = a.ctx ? a.ctx.currentTime : 0;
  const lines = [`humor: ${M.mood || '—'} · contexto: ${a.ctx?.state || 'bloqueado (toque para ativar)'}`];
  if (p) {
    const A = p.arr ? Object.entries(p.arr).filter(([k, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`).join(' ') : p.S.gen;
    lines.push(`peça: ${NOTE[p.tonic % 12]} ${p.mode} · ${Math.round(p.bpm)} bpm · frase ${p.idx} (faltam ${p.ending ? 0 : p.phrasesLeft})`, `arranjo: ${A}`);
  } else if (M.nextAt < 1e8) lines.push(`silêncio · próxima peça em ${Math.max(0, M.nextAt - t).toFixed(0)} s`);
  lines.push(`notas tocando: ${M.stats.live} · efeitos: ${a.voices} · cache de notas: ${M.bank ? (M.bank.total * 4 / 1e6).toFixed(1) : 0} MB · efeitos: ${a.bank ? (a.bank.samples * 4 / 1e6).toFixed(1) : 0} MB`);
  $('#info').textContent = lines.join('\n');
}, 500);

// ---------- effects ----------
const GROUPS = [
  ['Passos', (n) => n.startsWith('step_')],
  ['Combate', (n) => /^(hit|crit|hit_metal|block|shield_up|swing_|bow|arrow_|death)/.test(n)],
  ['Corpo e natação', (n) => /^(swim_|splash_in|splash_out|heartbeat|shiver|breath_cold|stomach|drip_body|queasy)/.test(n)],
  ['Coleta e comida', (n) => /^(chop|mine|pickup|herb_pick|heal|eat|splash|plop|drip|ignite|crackle|tree_)/.test(n)],
  ['Construção', (n) => /^(blueprint|build|decon|raze|rotate|door_|chest_|craft_done|equip)/.test(n)],
  ['Interface', (n) => /^(ui_|hotbar|zoom|error|levelup|sleep|respawn)/.test(n)],
  ['Natureza', (n) => /^(bird_|woodpecker|wings|cricket|owl|frog|duck|bee|squirrel|water_blub|rain_drop|roof_drop|cave_rumble|thunder_|wolf_howl)/.test(n)],
  ['Criaturas', (n) => /_(aggro|hurt|idle|death)$/.test(n)],
];
const used = new Set();
for (const [title, test] of GROUPS) {
  const names = Object.keys(SFX).filter((n) => test(n) && !used.has(n));
  names.forEach((n) => used.add(n));
  const h = document.createElement('h3'); h.textContent = title;
  const row = document.createElement('div'); row.className = 'row';
  for (const n of names) {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => { a.unlock(); a.play(n, { force: true }); };
    row.appendChild(b);
  }
  if (title === 'Interface') {
    for (let k = 0; k < 10; k++) { const b = document.createElement('button'); b.textContent = 'hotbar ' + ((k + 1) % 10); b.onclick = () => a.play('hotbar', { slot: k, force: true }); row.appendChild(b); }
  }
  $('#sfx').append(h, row);
}
const rest = Object.keys(SFX).filter((n) => !used.has(n));
if (rest.length) { const h = document.createElement('h3'); h.textContent = 'Outros'; const row = document.createElement('div'); row.className = 'row'; for (const n of rest) { const b = document.createElement('button'); b.textContent = n; b.onclick = () => a.play(n, { force: true }); row.appendChild(b); } $('#sfx').append(h, row); }

// ---------- spatial ----------
const SP = [
  ['Machado à esquerda', 26.5, 32.5], ['Machado à direita', 38.5, 32.5], ['Longe (18 tiles)', 50.5, 32.5],
  ['Atrás da parede', 40.5, 32.5, true], ['Perto, sem parede', 34.5, 32.5],
];
for (const [label, x, y, wall] of SP) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    a.unlock();
    const keep = G.world;
    G.world = fakeWorld({ room: !!wall });
    a._world = G.world; a.lx = 32.5; a.ly = 32.5; a.viewW = 30;
    a.play('chop', { x, y, force: true });
    a.play('step', { x, y, surface: 'stone', force: true, delay: 0.4 });
    G.world = keep; a._world = keep;
  };
  $('#spatial').appendChild(b);
}

// ---------- offline analysis ----------
const fmt = (s) => `pico ${s.peakDb.toString().padStart(6)} dB · rms ${s.rmsDb.toString().padStart(6)} dB · NaN ${s.nan}`;
async function analyze() {
  const lines = ['Níveis no volume padrão (geral 85, música 70, efeitos 90, ambiente 80). Pico < -0.5 dB = sem clipping.', ''];
  const res = { moods: {}, sfx: {} };
  for (const m of MOODS) {
    const sec = 48;
    const r = await renderOffline((A) => { A.music.setMood(m); A.music.nextAt = 0; }, sec, { sr: 44100, levels: DEFAULT_LEVELS, onStep: (A, t) => { if (t < sec - 6) A.music.tick(t); else A.music.stopAll(4); } });
    const M = r.audio.music;
    res.moods[m] = { ...r.stats, scheduleMs: r.scheduleMs, renderMs: r.renderMs, notes: M.stats.notes, maxLive: M.stats.maxLive, genMs: +M.stats.genMs.toFixed(1), noteRenderMs: Math.round(M.bank.renderMs), realtimeX: +(sec / (r.renderMs / 1000)).toFixed(1) };
    lines.push(`música ${m.padEnd(7)} ${fmt(r.stats)} · notas ${M.stats.notes} (máx. simultâneas ${M.stats.maxLive}) · JS ${r.scheduleMs} ms · render ${r.renderMs} ms (${res.moods[m].realtimeX}× tempo real)`);
    $('#report').textContent = lines.join('\n');
  }
  lines.push('');
  for (const n of Object.keys(SFX)) {
    const sec = Math.min(7, (SFX[n].sec || 1) + 1.2);
    const r = await renderOffline((A) => { A.play(n, { force: true, at: 0.02 }); }, sec, { sr: 44100, levels: DEFAULT_LEVELS });
    res.sfx[n] = r.stats;
    lines.push(`${n.padEnd(15)} ${fmt(r.stats)}`);
  }
  $('#report').textContent = lines.join('\n');
  window.audioReport = res;
  return res;
}
// ten minutes of music through every mood change (incl. danger in and out): nodes must all be released
async function soak() {
  const sec = 600;
  const plan = [[0, 'day'], [75, 'danger'], [95, 'day'], [180, 'night'], [250, 'cave'], [320, 'danger'], [335, 'rain'], [420, 'home'], [500, 'dawn'], [560, 'menu']];
  const t0 = performance.now(), samples = [];
  let k = 0;
  const r = await renderOffline(() => {}, sec, { sr: 8000, levels: DEFAULT_LEVELS, onStep: (A, t) => {
    const M = A.music;
    while (k < plan.length && plan[k][0] <= t) { M.setMood(plan[k][1]); if (k === 0) M.nextAt = 0; k++; }
    if (t < sec - 10) M.tick(t); else M.stopAll(3);
    if (Math.round(t * 4) % 4 === 0) for (let j = 0; j < 3; j++) A.play(['step', 'chop', 'pickup'][j], { x: 2, y: 1, force: true, delay: j * 0.03 });
    if (Math.round(t * 4) % 40 === 0) samples.push([Math.round(t), M.stats.live, A.voices]);
  } });
  await new Promise((res) => setTimeout(res, 300));
  const A = r.audio, M = A.music;
  const out = {
    ...r.stats, wallMs: Math.round(performance.now() - t0), scheduleMs: r.scheduleMs, renderMs: r.renderMs,
    pieces: M.stats.pieces, phrases: M.stats.phrases, notes: M.stats.notes, liveNotesAfter: M.stats.live, maxLive: M.stats.maxLive,
    fadingPieces: M.fading.length, sfxCreated: A.stats.created, sfxEnded: A.stats.ended, noteCacheMB: +(M.bank.total * 4 / 1e6).toFixed(2), noteRenders: M.bank.renders,
    genMsPerPhrase: +(M.stats.genMs / Math.max(1, M.stats.phrases)).toFixed(2), liveOverTime: samples.map((x) => x.join('/')).join(' '),
  };
  $('#report').textContent = 'Teste longo (10 min, todas as trocas de humor):\n' + JSON.stringify(out, null, 1);
  window.audioReport = { soak: out };
  return out;
}
$('#analyze').onclick = () => analyze();
$('#soak').onclick = () => soak();
window.audioTest = { analyze, soak, audio: a };
