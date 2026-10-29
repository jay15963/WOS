// Character creator (agent H): the player's character standing on the main menu + the appearance editor.
//   mountMenuAvatar(el, { name, onName, nameField? }) → { refresh(look), destroy() }
//   openCharEditor({ look?, game?, name?, onSave?, onCancel? }) → Promise<look | null>
// Everything is drawn by the game's own pawn pipeline (art/look/preview.js → compose.drawPawn) with the look
// parts painted at k× resolution, so what the player sees here is exactly their in-game character.
// The look is saved per player profile (src/game/look.js saveLook) and, in a running game, sent to the others.

import { PreviewAtlas, drawPawn2D, previewPawn } from '../art/look/preview.js';
import { CATALOG, PALETTES, RARITY } from '../art/look/catalog.js';
import { cleanLook, loadLook, saveLook, randomLook, applyLook, packLook, GROUPS, DEFAULT_LOOK, hexOf, rgbOf } from '../game/look.js';
import { playerName, setPlayerName } from '../net/session.js';

// ---------------- shared bits ----------------
let cssDone = false;
function ensureCss() {
  if (cssDone) return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./charcreator.css', import.meta.url).href;
  document.head.appendChild(l);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DPR = () => Math.min(2.5, window.devicePixelRatio || 1);
let audioMod = null;
import('../fx/audio.js').then((m) => { audioMod = m; }).catch(() => {});
function sfx(name, game) {
  try { (game?.audio || window.game?.audio || audioMod?.getAudio?.())?.play?.(name); } catch { /* sound is optional */ }
}
const ATLAS = new Map();
const atlasFor = (k) => { k = Math.max(1, Math.min(6, Math.round(k))); let A = ATLAS.get(k); if (!A) { A = new PreviewAtlas(k); ATLAS.set(k, A); } return A; };
const randSeed = () => (Math.random() * 2 ** 31) >>> 0;
const LOOK_EVENT = 'wos:look';

// soft stage behind the character (warm spotlight, grassy disc)
function stage(ctx, w, h, cx, cy, s) {
  const g = ctx.createRadialGradient(cx, cy - s * 0.7, s * 0.1, cx, cy - s * 0.5, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255,222,160,0.20)'); g.addColorStop(0.5, 'rgba(255,200,130,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.34);
  const d = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.95);
  d.addColorStop(0, 'rgba(120,150,80,0.55)'); d.addColorStop(0.62, 'rgba(70,96,52,0.38)'); d.addColorStop(1, 'rgba(40,52,30,0)');
  ctx.fillStyle = d; ctx.beginPath(); ctx.arc(0, 0, s * 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------- icons ----------------
const I = {
  body: '<path d="M12 3.2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-4.6 8h9.2c1.2 0 2 1 1.9 2.2l-.8 6.4H6.3l-.8-6.4c-.1-1.2.7-2.2 1.9-2.2Z"/>',
  face: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9.1" cy="10.6" r="1.3"/><circle cx="14.9" cy="10.6" r="1.3"/><path d="M8.6 14.6c1.8 2 5 2 6.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  marks: '<path d="M12 2.6l1.9 5.6 5.6 1.9-5.6 1.9L12 17.6l-1.9-5.6-5.6-1.9 5.6-1.9Z"/><circle cx="18.6" cy="17.8" r="1.8"/><circle cx="5.6" cy="18.6" r="1.2"/>',
  hair: '<path d="M4.4 14.4C3.4 7.6 7.4 3.4 12.4 3.4c5.2 0 8.6 4.4 7.4 11.6-.6-3-2-5-3.6-6 .2 2.2-.8 3.8-2.8 4.6.6-1.6.4-3.2-.6-4.4-1.6 2-4.6 3.2-8.4 5.2Z"/><path d="M5 15.6c.4 2.6 1 4.4 2 5.6M19.2 15.8c-.4 2.4-1 4.2-2 5.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  beard: '<path d="M4.6 8.4c0 7.6 3.4 12.4 7.4 12.4s7.4-4.8 7.4-12.4c-1.4 2.6-3.4 3.4-5 3.4-.8-1-1.6-1.4-2.4-1.4s-1.6.4-2.4 1.4c-1.6 0-3.6-.8-5-3.4Zm5.4 6.4c1.2.8 2.8.8 4 0" />',
  clothes: '<path d="M8.6 3.4 4 5.8 2.4 10.4l3.2 1.4.6-1.6V20.6h11.6V10.2l.6 1.6 3.2-1.4L20 5.8l-4.6-2.4c-.4 1.8-1.8 3-3.4 3s-3-1.2-3.4-3Z"/>',
  dice: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.4" cy="8.4" r="1.5"/><circle cx="15.6" cy="15.6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="15.6" cy="8.4" r="1.5"/><circle cx="8.4" cy="15.6" r="1.5"/>',
  undo: '<path d="M9 5 4 10l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 10H14a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  redo: '<path d="m15 5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 10H10a6 6 0 0 0 0 12h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  reset: '<path d="M4.6 12a7.4 7.4 0 1 0 2.2-5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4.4 3.6v4.6H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="M14.6 5.6 8.2 12l6.4 6.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="m9.4 5.6 6.4 6.4-6.4 6.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  walk: '<circle cx="13.4" cy="4.4" r="2"/><path d="m10.6 8.2 3.4.4 2 3.8 3 1M10.6 8.2 9 13.2l3.2 2.6.8 5.4M9 13.2l-2 2.6-2.8.6M10.6 8.2 7.2 10l-.8 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  stand: '<circle cx="12" cy="4.4" r="2"/><path d="M12 8v7.4M12 15.4l-2.4 5.4M12 15.4l2.4 5.4M8 11h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  zoomIn: '<circle cx="10.6" cy="10.6" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.4 15.4 5 5M10.6 7.8v5.6M7.8 10.6h5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  zoomOut: '<circle cx="10.6" cy="10.6" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m15.4 15.4 5 5M7.8 10.6h5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  pen: '<path d="M4 20l1-4.6L15.6 4.8a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.6 19 4 20Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m13.6 6.8 3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  lock: '<rect x="5" y="10.4" width="14" height="10" rx="2"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" fill="none" stroke="currentColor" stroke-width="2"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  check: '<path d="m5 12.6 4.4 4.4L19 7.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};
const icon = (n, cls = '') => `<svg class="cc-i ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${I[n]}</svg>`;

// ---------------- skin tone model (tone × undertone grid of natural skins) ----------------
const SKIN_GRID = [
  ['f8e2d6', 'efc6b0', 'd8a088', 'b07462', '7c4c3e', '4e2e26'], // rosado
  ['f4dcc2', 'e4b892', 'c99068', '9c6642', '6e442c', '45281a'], // neutro
  ['f3d8b2', 'e6b47c', 'c99056', 'a06a34', '704622', '462a16'], // dourado
  ['ecd8b6', 'd6b688', 'b89460', '8a6a40', '604a2a', '3c2c1a'], // oliva
];
const lerp = (a, b, t) => a + (b - a) * t;
function skinAt(t, u) {
  const c = (row, tt) => { const x = tt * 5, i = Math.min(4, Math.floor(x)), f = x - i; const A = rgbOf(SKIN_GRID[row][i]), B = rgbOf(SKIN_GRID[row][i + 1]); return A.map((v, k) => lerp(v, B[k], f)); };
  const y = u * 3, j = Math.min(2, Math.floor(y)), f = y - j;
  const a = c(j, t), b = c(j + 1, t);
  return hexOf(a.map((v, k) => lerp(v, b[k], f)));
}
function skinFind(hex) {
  const T = rgbOf(hex);
  let best = [0.4, 0.4], bd = 1e9;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 12; j++) {
    const c = rgbOf(skinAt(i / 40, j / 12)), d = (c[0] - T[0]) ** 2 + (c[1] - T[1]) ** 2 + (c[2] - T[2]) ** 2;
    if (d < bd) { bd = d; best = [i / 40, j / 12]; }
  }
  return best;
}

// ---------------- HSV colour picker ----------------
function hsv2rgb(h, s, v) { const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
function rgb2hsv([r, g, b]) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx ? d / mx : 0, mx]; }

function picker(host, hex, onChange) {
  host.innerHTML = `<div class="cc-pick"><canvas class="cc-sv"></canvas><div class="cc-pick-side"><input type="range" class="cc-hue" min="0" max="360" step="1" aria-label="Matiz"><label class="cc-hex"><span>#</span><input maxlength="6" spellcheck="false" autocomplete="off" aria-label="Cor em hexadecimal"></label></div></div>`;
  const sv = host.querySelector('.cc-sv'), hue = host.querySelector('.cc-hue'), hx = host.querySelector('.cc-hex input');
  let [h, s, v] = rgb2hsv(rgbOf(hex));
  const draw = () => {
    const w = sv.clientWidth || 180, ht = sv.clientHeight || 110, d = DPR();
    sv.width = Math.round(w * d); sv.height = Math.round(ht * d);
    const g = sv.getContext('2d');
    const base = hsv2rgb(h, 1, 1).map((x) => Math.round(x * 255));
    g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, sv.width, sv.height);
    const wg = g.createLinearGradient(0, 0, sv.width, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = wg; g.fillRect(0, 0, sv.width, sv.height);
    const bg = g.createLinearGradient(0, 0, 0, sv.height); bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, '#000');
    g.fillStyle = bg; g.fillRect(0, 0, sv.width, sv.height);
    const x = s * sv.width, y = (1 - v) * sv.height;
    g.lineWidth = 2.2 * d; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 6 * d, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1 * d; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(x, y, 7.4 * d, 0, Math.PI * 2); g.stroke();
    hue.value = String(Math.round(h * 360));
    hue.style.setProperty('--thumb', `rgb(${base})`);
  };
  const emit = (fromHex) => { const out = hexOf(hsv2rgb(h, s, v)); if (!fromHex) hx.value = out; onChange(out); draw(); };
  const at = (e) => { const r = sv.getBoundingClientRect(); s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); emit(); };
  sv.addEventListener('pointerdown', (e) => { sv.setPointerCapture(e.pointerId); at(e); });
  sv.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure > 0) at(e); });
  hue.addEventListener('input', () => { h = +hue.value / 360; emit(); });
  hx.addEventListener('input', () => { const c = hexOf(hx.value); if (c) { [h, s, v] = rgb2hsv(rgbOf(c)); emit(true); } });
  hx.addEventListener('keydown', (e) => e.stopPropagation());
  hx.value = hex;
  requestAnimationFrame(draw);
  return { set(c) { [h, s, v] = rgb2hsv(rgbOf(c)); hx.value = c; draw(); } };
}

// ---------------- thumbnails ----------------
// framing: where to look on the pawn and how big (tiles of view height), and facing
const FRAMES = {
  head: { cy: 0.86, view: 0.92, dir: 's' }, face: { cy: 0.84, view: 0.7, dir: 's' }, bust: { cy: 0.66, view: 1.2, dir: 's' },
  body: { cy: 0.62, view: 1.6, dir: 's' }, legs: { cy: 0.22, view: 0.85, dir: 's' }, side: { cy: 0.84, view: 0.95, dir: 'e' },
  torso: { cy: 0.44, view: 1.0, dir: 's' },
};
class Thumbs {
  constructor() { this.queue = []; this.raf = 0; this.io = new IntersectionObserver((es) => { for (const e of es) { e.target._vis = e.isIntersecting; if (e.isIntersecting && e.target._dirty) this.push(e.target); } }, { rootMargin: '120px' }); }
  add(c, lookFn, frame) { c._look = lookFn; c._frame = frame; c._dirty = true; this.io.observe(c); }
  refresh(root) { for (const c of root.querySelectorAll('canvas.cc-th')) { c._dirty = true; if (c._vis) this.push(c); } }
  push(c) { if (!this.queue.includes(c)) this.queue.push(c); if (!this.raf) this.raf = requestAnimationFrame(() => this.run()); }
  run() {
    this.raf = 0;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 9) { const c = this.queue.shift(); if (c.isConnected) this.draw(c); }
    if (this.queue.length) this.raf = requestAnimationFrame(() => this.run());
  }
  draw(c) {
    c._dirty = false;
    const F = FRAMES[c._frame] || FRAMES.body, d = DPR();
    const w = c.clientWidth || 64, h = c.clientHeight || 64;
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    const ctx = c.getContext('2d');
    const scale = (c.height / F.view);
    const A = atlasFor(scale / 64 + 0.25);
    const p = previewPawn(c._look()); p.facing = F.dir;
    drawPawn2D(ctx, A, p, 0.6, c.width / 2, c.height / 2 + F.cy * scale, scale, { shadow: F.cy < 0.7 });
  }
  destroy() { this.io.disconnect(); cancelAnimationFrame(this.raf); this.queue.length = 0; }
}

// =====================================================================================================
// menu avatar
// =====================================================================================================
export function mountMenuAvatar(el, { name, onName, nameField } = {}) {
  ensureCss();
  // B's menu may already show its own name field next to this slot
  if (nameField == null) nameField = !el.closest?.('.menu-char')?.querySelector?.('input[data-k=pname]');
  const root = document.createElement('div');
  root.className = 'cc-avatar';
  root.innerHTML = `
    ${nameField ? `<label class="cc-name"><span>Seu nome</span><input maxlength="18" autocomplete="off" spellcheck="false" enterkeyhint="done" value="${esc(name ?? playerName())}" aria-label="Seu nome"></label>` : ''}
    <div class="cc-stage" title="Toque para girar"><canvas></canvas></div>
    <button class="cc-edit" type="button">${icon('pen')}<span>Editar aparência</span></button>`;
  el.appendChild(root);
  const cv = root.querySelector('canvas'), stageEl = root.querySelector('.cc-stage'), plate = null;
  let look = loadLook(), pawn = previewPawn(look), alive = true, raf = 0, visible = true, last = performance.now();
  const setPlate = (n) => { if (plate) plate.textContent = n || 'Sobrevivente'; };
  setPlate(name ?? playerName());
  const inp = root.querySelector('.cc-name input');
  if (inp) {
    const commit = () => { setPlayerName(inp.value); inp.value = playerName(); setPlate(inp.value); onName?.(inp.value); };
    inp.addEventListener('change', commit);
    inp.addEventListener('input', () => setPlate(inp.value.trim() || 'Sobrevivente'));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
  }
  // gentle idle life: look around now and then, a little spin on tap
  const DIR = ['s', 'e', 'n', 'w'];
  let turnAt = 4 + Math.random() * 4, spin = null;
  const tick = (now) => {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    if (spin) { spin.t -= dt; if (spin.t <= 0) { spin.i++; spin.t = 0.16; if (spin.i >= 4) spin = null; } pawn.facing = spin ? DIR[spin.i] : 's'; }
    else { turnAt -= dt; if (turnAt <= 0) { pawn.facing = pawn.facing === 's' ? (Math.random() < 0.5 ? 'e' : 'w') : 's'; turnAt = pawn.facing === 's' ? 5 + Math.random() * 6 : 1.2 + Math.random(); } }
    const d = DPR(), w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (w > 4 && h > 4) {
      if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      const scale = Math.min(cv.width / 1.15, cv.height / 1.55);
      const cx = cv.width / 2, cy = cv.height - scale * 0.14;
      stage(ctx, cv.width, cv.height, cx, cy, scale * 0.62);
      drawPawn2D(ctx, atlasFor(scale / 64 + 0.3), pawn, t, cx, cy, scale);
      if (plate) plate.style.bottom = `${(cv.height - (cy - scale * 1.22)) / d}px`;
    }
    if (visible && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && alive && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } };
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); kick(); });
  io.observe(stageEl);
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);
  stageEl.addEventListener('click', () => { if (!spin) { spin = { i: 0, t: 0.16 }; sfx('ui_click'); } });
  root.querySelector('.cc-edit').addEventListener('click', async () => {
    sfx('ui_open');
    const out = await openCharEditor({ look, name: inp ? inp.value : (name ?? playerName()) });
    if (out) refresh(out);
  });
  const refresh = (l) => { look = cleanLook(l || loadLook()); pawn.look = look; };
  const onLook = (e) => refresh(e.detail);
  addEventListener(LOOK_EVENT, onLook);
  kick();
  return {
    el: root, refresh,
    destroy() { alive = false; io.disconnect(); cancelAnimationFrame(raf); removeEventListener(LOOK_EVENT, onLook); document.removeEventListener('visibilitychange', onVis); root.remove(); },
  };
}

// =====================================================================================================
// editor
// =====================================================================================================
// tabs → sections: { k: field, t: title, kind: 'grid'|'colors'|'chips'|'skin', frame, pal, note, follow }
const TABS = [
  { id: 'body', name: 'Corpo', icon: 'body', group: 'body', sections: [
    { kind: 'skin', k: 'skin', t: 'Tom de pele' },
    { kind: 'grid', k: 'build', t: 'Tipo de corpo', frame: 'body' },
    { kind: 'grid', k: 'height', t: 'Altura', frame: 'body' },
  ] },
  { id: 'face', name: 'Rosto', icon: 'face', group: 'face', sections: [
    { kind: 'grid', k: 'head', t: 'Formato da cabeça', frame: 'head' },
    { kind: 'grid', k: 'eyes', t: 'Olhos', frame: 'face' },
    { kind: 'colors', k: 'eyeC', t: 'Cor dos olhos', pal: 'eyes' },
    { kind: 'grid', k: 'brows', t: 'Sobrancelhas', frame: 'face' },
    { kind: 'grid', k: 'nose', t: 'Nariz', frame: 'side' },
    { kind: 'grid', k: 'mouth', t: 'Boca', frame: 'face' },
    { kind: 'grid', k: 'ears', t: 'Orelhas', frame: 'head', bald: 1 },
  ] },
  { id: 'marks', name: 'Marcas', icon: 'marks', group: 'marks', sections: [
    { kind: 'grid', k: 'cheeks', t: 'Bochechas', frame: 'face' },
    { kind: 'grid', k: 'marks', t: 'Sardas e pintas', frame: 'face' },
    { kind: 'grid', k: 'scar', t: 'Cicatrizes', frame: 'face' },
    { kind: 'grid', k: 'age', t: 'Idade', frame: 'face' },
    { kind: 'grid', k: 'paint', t: 'Pintura facial', frame: 'face' },
    { kind: 'colors', k: 'paintC', t: 'Cor da pintura', pal: 'paint', when: (L) => L.paint !== 'none' },
  ] },
  { id: 'hair', name: 'Cabelo', icon: 'hair', group: 'hair', sections: [
    { kind: 'grid', k: 'hair', t: 'Estilo', frame: 'head', big: 1 },
    { kind: 'colors', k: 'hairC', t: 'Cor', pal: ['hair', 'dye'], labels: ['Naturais', 'Tinturas'] },
    { kind: 'chips', k: 'hairFx', t: 'Efeito de cor', when: (L) => L.hair !== 'bald' },
    { kind: 'colors', k: 'hairC2', t: 'Cor do efeito', pal: ['hair', 'dye'], labels: ['Naturais', 'Tinturas'], when: (L) => L.hairFx !== 'none' && L.hair !== 'bald' },
  ] },
  { id: 'beard', name: 'Barba', icon: 'beard', group: 'beard', sections: [
    { kind: 'grid', k: 'beard', t: 'Estilo', frame: 'face' },
    { kind: 'colors', k: 'beardC', t: 'Cor da barba e sobrancelhas', pal: ['hair', 'dye'], labels: ['Naturais', 'Tinturas'], follow: 'Igual ao cabelo' },
  ] },
  { id: 'clothes', name: 'Roupas', icon: 'clothes', group: 'clothes', sections: [
    { kind: 'grid', k: 'top', t: 'Parte de cima', frame: 'torso' },
    { kind: 'colors', k: 'topC', t: 'Cor principal', pal: 'cloth' },
    { kind: 'colors', k: 'topC2', t: 'Cor secundária (detalhes e estampa)', pal: 'cloth' },
    { kind: 'grid', k: 'pattern', t: 'Estampa', frame: 'torso' },
    { kind: 'grid', k: 'over', t: 'Por cima', frame: 'torso' },
    { kind: 'colors', k: 'overC', t: 'Cor (por cima)', pal: ['leather', 'cloth'], labels: ['Couro', 'Tecido'], when: (L) => L.over !== 'none' },
    { kind: 'grid', k: 'bottom', t: 'Parte de baixo', frame: 'legs' },
    { kind: 'colors', k: 'botC', t: 'Cor (parte de baixo)', pal: ['cloth', 'leather'], labels: ['Tecido', 'Couro'] },
    { kind: 'grid', k: 'shoes', t: 'Calçados', frame: 'legs' },
    { kind: 'colors', k: 'shoeC', t: 'Cor dos calçados', pal: ['leather', 'cloth'], labels: ['Couro', 'Tecido'], when: (L) => L.shoes !== 'barefoot' },
  ] },
];
let openNow = null;

export function openCharEditor(opts = {}) {
  ensureCss();
  if (openNow) return openNow.promise;
  const game = opts.game || null;
  const initial = cleanLook(opts.look || (game?.player?.look) || loadLook());
  let L = { ...initial };
  const hist = [packLook(L)]; let hi = 0;
  let tab = 'body';
  try { tab = sessionStorage.getItem('wos.cc.tab') || 'body'; } catch { /* ignore */ }
  if (!TABS.some((t) => t.id === tab)) tab = 'body';

  const root = document.createElement('div');
  root.className = 'cc-editor';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Editar aparência');
  root.innerHTML = `
    <div class="cc-backdrop"></div>
    <div class="cc-shell">
      <header class="cc-head">
        <div class="cc-title"><b>Aparência</b><small>${esc(opts.name ?? playerName())}</small></div>
        <div class="cc-tools">
          <button class="cc-tool" data-a="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer">${icon('undo')}</button>
          <button class="cc-tool" data-a="redo" title="Refazer (Ctrl+Y)" aria-label="Refazer">${icon('redo')}</button>
          <button class="cc-tool wide" data-a="random" title="Aparência aleatória">${icon('dice')}<span>Aleatório</span></button>
          <button class="cc-tool" data-a="reset" title="Restaurar como estava" aria-label="Restaurar">${icon('reset')}</button>
        </div>
      </header>
      <section class="cc-preview">
        <canvas class="cc-pv"></canvas>
        <div class="cc-pv-top"><span class="cc-pv-name"></span></div>
        <div class="cc-pv-ctrl">
          <button class="cc-round" data-a="rotl" aria-label="Girar para a esquerda">${icon('left')}</button>
          <button class="cc-round cc-mode" data-a="walk" aria-label="Parado / andando">${icon('walk')}</button>
          <button class="cc-round" data-a="zoom" aria-label="Aproximar">${icon('zoomIn')}</button>
          <button class="cc-round" data-a="rotr" aria-label="Girar para a direita">${icon('right')}</button>
        </div>
      </section>
      <section class="cc-panel">
        <nav class="cc-tabs" role="tablist">${TABS.map((t) => `<button role="tab" class="cc-tab" data-t="${t.id}">${icon(t.icon)}<span>${t.name}</span></button>`).join('')}</nav>
        <div class="cc-body"></div>
      </section>
      <footer class="cc-foot">
        <button class="cc-btn ghost" data-a="cancel">${icon('x')}<span>Cancelar</span></button>
        <button class="cc-btn primary" data-a="save">${icon('check')}<span>Salvar</span></button>
      </footer>
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('in'));
  // in a running game: modal (single player pauses, like the in-game menu)
  const ui0 = game?.ui ? { pause: game.ui.pause, modal: game.ui.modal } : null;
  if (ui0) { game.ui.pause = true; game.ui.modal = true; }
  const Q = (s) => root.querySelector(s);
  const body = Q('.cc-body');
  const thumbs = new Thumbs();
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  openNow = { promise };

  // ---------------- preview ----------------
  const pv = Q('.cc-pv'), pvBox = Q('.cc-preview');
  const pawn = previewPawn(L);
  const DIRS = ['s', 'e', 'n', 'w'];
  let di = 0, walking = false, zoomed = false, zk = 1, zTarget = 1, turnK = 0, dragX = null, raf = 0, last = performance.now(), alive = true;
  Q('.cc-pv-name').textContent = opts.name ?? playerName();
  const frameP = (now) => {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    zk += (zTarget - zk) * Math.min(1, dt * 9);
    if (walking) pawn.moveT = (pawn.moveT || 0) + dt * 0.9;
    pawn.moving = walking; pawn.facing = DIRS[di];
    const d = DPR(), w = pvBox.clientWidth, h = pvBox.clientHeight;
    if (w > 4 && h > 4) {
      if (pv.width !== Math.round(w * d) || pv.height !== Math.round(h * d)) { pv.width = Math.round(w * d); pv.height = Math.round(h * d); }
      const ctx = pv.getContext('2d');
      ctx.clearRect(0, 0, pv.width, pv.height);
      const base = Math.min(pv.width / 1.75, (pv.height - 70 * d) / 1.95);
      const scale = base * zk;
      // zoom toward the face
      const fy = pv.height - 46 * d - base * 0.1;
      const cy = fy + (zk - 1) * scale * 0.5;
      const cx = pv.width / 2;
      stage(ctx, pv.width, pv.height, cx, cy, scale * 0.62);
      drawPawn2D(ctx, atlasFor(scale / 64 + 0.4), pawn, now / 1000, cx, cy, scale);
    }
    raf = requestAnimationFrame(frameP);
  };
  raf = requestAnimationFrame(frameP);
  const rot = (k) => { di = (di + k + 4) % 4; sfx('ui_click', game); };
  Q('[data-a=rotl]').onclick = () => rot(1);
  Q('[data-a=rotr]').onclick = () => rot(-1);
  const walkBtn = Q('[data-a=walk]');
  walkBtn.onclick = () => { walking = !walking; walkBtn.innerHTML = icon(walking ? 'stand' : 'walk'); walkBtn.classList.toggle('on', walking); sfx('ui_click', game); };
  const zoomBtn = Q('[data-a=zoom]');
  const setZoom = (z) => { zoomed = z; zTarget = z ? 2 : 1; zoomBtn.innerHTML = icon(z ? 'zoomOut' : 'zoomIn'); zoomBtn.classList.toggle('on', z); };
  zoomBtn.onclick = () => { setZoom(!zoomed); sfx('ui_click', game); };
  // drag / swipe to rotate, wheel / pinch to zoom
  const pts = new Map();
  let pinch0 = 0;
  pv.addEventListener('pointerdown', (e) => { pv.setPointerCapture(e.pointerId); pts.set(e.pointerId, e.clientX); if (pts.size === 1) { dragX = e.clientX; turnK = 0; } else if (pts.size === 2) { const v = [...pts.values()]; pinch0 = Math.abs(v[0] - v[1]); dragX = null; } });
  pv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e.clientX);
    if (pts.size === 2 && pinch0 > 10) { const v = [...pts.values()], dd = Math.abs(v[0] - v[1]); if (dd > pinch0 * 1.25 && !zoomed) setZoom(true); if (dd < pinch0 * 0.8 && zoomed) setZoom(false); return; }
    if (dragX == null) return;
    turnK += e.clientX - dragX; dragX = e.clientX;
    if (Math.abs(turnK) > 46) { rot(turnK > 0 ? -1 : 1); turnK = 0; }
  });
  const up = (e) => { pts.delete(e.pointerId); if (!pts.size) { dragX = null; pinch0 = 0; } };
  pv.addEventListener('pointerup', up); pv.addEventListener('pointercancel', up);
  pv.addEventListener('wheel', (e) => { e.preventDefault(); if (e.deltaY < 0 && !zoomed) setZoom(true); else if (e.deltaY > 0 && zoomed) setZoom(false); }, { passive: false });

  // ---------------- state ----------------
  const tools = { undo: Q('[data-a=undo]'), redo: Q('[data-a=redo]') };
  const syncTools = () => { tools.undo.disabled = hi <= 0; tools.redo.disabled = hi >= hist.length - 1; root.classList.toggle('dirty', packLook(L) !== packLook(initial)); };
  let refreshQueued = false;
  const set = (patch, { record = true, rerender = false } = {}) => {
    L = cleanLook({ ...L, ...patch });
    pawn.look = L;
    if (record) { const s = packLook(L); if (s !== hist[hi]) { hist.length = hi + 1; hist.push(s); hi = hist.length - 1; if (hist.length > 120) { hist.shift(); hi--; } } }
    syncTools();
    if (rerender) renderTab(); else if (!refreshQueued) { refreshQueued = true; requestAnimationFrame(() => { refreshQueued = false; updateSelection(); thumbs.refresh(body); }); }
  };
  const jump = (i) => { if (i < 0 || i >= hist.length) return; hi = i; L = cleanLook(hist[hi]); pawn.look = L; syncTools(); renderTab(); sfx('ui_click', game); };
  tools.undo.onclick = () => jump(hi - 1);
  tools.redo.onclick = () => jump(hi + 1);
  Q('[data-a=random]').onclick = () => { set(randomLook(randSeed()), { rerender: true }); sfx('ui_click', game); bump(); };
  Q('[data-a=reset]').onclick = () => { set(initial, { rerender: true }); sfx('ui_click', game); };
  const bump = () => { pvBox.classList.remove('pop'); void pvBox.offsetWidth; pvBox.classList.add('pop'); };

  // ---------------- tabs & sections ----------------
  const tabBtns = [...root.querySelectorAll('.cc-tab')];
  for (const b of tabBtns) b.onclick = () => { if (tab !== b.dataset.t) { tab = b.dataset.t; try { sessionStorage.setItem('wos.cc.tab', tab); } catch { /* ignore */ } renderTab(); body.scrollTop = 0; sfx('ui_click', game); } };
  const lookWith = (k, v) => () => cleanLook({ ...L, [k]: v, ...(k === 'ears' ? { hair: 'bald' } : {}) });
  function gridSection(S) {
    const list = CATALOG[S.k];
    const el = document.createElement('div');
    el.className = 'cc-grid' + (S.big ? ' big' : '');
    for (const e of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cc-opt' + (e.unlocked ? '' : ' locked'); b.dataset.k = S.k; b.dataset.v = e.id;
      b.style.setProperty('--rar', RARITY[e.rarity]?.color || RARITY.common.color);
      b.title = `${e.name} · ${RARITY[e.rarity]?.name || ''}`;
      b.innerHTML = `<canvas class="cc-th"></canvas><span class="cc-lbl">${esc(e.name)}</span>${e.rarity !== 'common' ? `<i class="cc-rar" aria-hidden="true"></i>` : ''}${e.unlocked ? '' : `<span class="cc-lock">${icon('lock')}</span>`}`;
      thumbs.add(b.querySelector('canvas'), lookWith(S.k, e.id), S.frame);
      b.onclick = () => { if (!e.unlocked) { sfx('error', game); return; } if (L[S.k] !== e.id) { set({ [S.k]: e.id }); sfx('ui_click', game); } };
      b.onpointerenter = (ev) => { if (ev.pointerType === 'mouse') sfx('ui_hover', game); };
      el.appendChild(b);
    }
    return el;
  }
  function chipsSection(S) {
    const el = document.createElement('div'); el.className = 'cc-chips';
    for (const e of CATALOG[S.k]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-chip'; b.dataset.k = S.k; b.dataset.v = e.id;
      b.style.setProperty('--rar', RARITY[e.rarity]?.color);
      b.innerHTML = `${esc(e.name)}${e.rarity !== 'common' ? '<i class="cc-rar"></i>' : ''}`;
      b.onclick = () => { set({ [S.k]: e.id }, { rerender: true }); sfx('ui_click', game); };
      el.appendChild(b);
    }
    return el;
  }
  function colorsSection(S) {
    const el = document.createElement('div'); el.className = 'cc-colors';
    const pals = Array.isArray(S.pal) ? S.pal : [S.pal];
    if (S.follow) {
      const f = document.createElement('button'); f.type = 'button'; f.className = 'cc-chip cc-follow'; f.dataset.k = S.k; f.dataset.v = '';
      f.textContent = S.follow; f.onclick = () => { set({ [S.k]: '' }); sfx('ui_click', game); };
      el.appendChild(f);
    }
    pals.forEach((pk, i) => {
      if (S.labels) { const h = document.createElement('div'); h.className = 'cc-sub'; h.textContent = S.labels[i]; el.appendChild(h); }
      const row = document.createElement('div'); row.className = 'cc-sw-row';
      for (const c of PALETTES[pk]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-sw'; b.dataset.k = S.k; b.dataset.v = c.hex;
        b.style.setProperty('--c', '#' + c.hex); b.style.setProperty('--rar', RARITY[c.rarity]?.color);
        b.title = c.name + (c.rarity !== 'common' ? ` · ${RARITY[c.rarity].name}` : ''); b.setAttribute('aria-label', c.name);
        if (c.rarity !== 'common') b.classList.add('rare');
        b.onclick = () => { set({ [S.k]: c.hex }); pk2?.set(c.hex); sfx('ui_click', game); };
        row.appendChild(b);
      }
      if (i === pals.length - 1) {
        const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'cc-sw cc-sw-plus'; plus.title = 'Escolher qualquer cor'; plus.setAttribute('aria-label', 'Escolher qualquer cor');
        plus.innerHTML = icon('plus');
        plus.onclick = () => { const open = pickHost.classList.toggle('open'); plus.classList.toggle('on', open); if (open && !pk2) pk2 = picker(pickHost, L[S.k] || L.hairC, (hex) => set({ [S.k]: hex })); sfx('ui_click', game); };
        row.appendChild(plus);
      }
      el.appendChild(row);
    });
    const pickHost = document.createElement('div'); pickHost.className = 'cc-pickhost';
    let pk2 = null;
    el.appendChild(pickHost);
    return el;
  }
  function skinSection(S) {
    const el = colorsSection({ ...S, pal: 'skin' });
    const [t0, u0] = skinFind(L.skin);
    const sl = document.createElement('div'); sl.className = 'cc-sliders';
    sl.innerHTML = `
      <label class="cc-slider"><span>Tom</span><input type="range" min="0" max="1000" value="${Math.round(t0 * 1000)}" data-s="t" class="cc-tone"></label>
      <label class="cc-slider"><span>Subtom</span><input type="range" min="0" max="1000" value="${Math.round(u0 * 1000)}" data-s="u" class="cc-under"></label>`;
    const [ti, ui] = sl.querySelectorAll('input');
    const paint = () => {
      const u = +ui.value / 1000, t = +ti.value / 1000;
      ti.style.background = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((x) => '#' + skinAt(x, u)).join(',')})`;
      ui.style.background = `linear-gradient(90deg, ${[0, 0.33, 0.66, 1].map((x) => '#' + skinAt(t, x)).join(',')})`;
    };
    const onIn = () => { set({ skin: skinAt(+ti.value / 1000, +ui.value / 1000) }, { record: false }); paint(); };
    ti.oninput = onIn; ui.oninput = onIn;
    ti.onchange = ui.onchange = () => set({}, { record: true });
    paint();
    el.prepend(sl);
    el._sync = () => { const [t, u] = skinFind(L.skin); ti.value = Math.round(t * 1000); ui.value = Math.round(u * 1000); paint(); };
    return el;
  }
  const SECTIONS = [];
  function renderTab() {
    for (const b of tabBtns) { const on = b.dataset.t === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    const T = TABS.find((x) => x.id === tab);
    body.innerHTML = '';
    SECTIONS.length = 0;
    const head = document.createElement('div'); head.className = 'cc-tabhead';
    head.innerHTML = `<h3>${T.name}</h3><button class="cc-mini" type="button">${icon('dice')}<span>Sortear ${T.name.toLowerCase()}</span></button>`;
    head.querySelector('button').onclick = () => { set(randomLook(randSeed(), L, GROUPS[T.group]), { rerender: true }); sfx('ui_click', game); bump(); };
    body.appendChild(head);
    for (const S of T.sections) {
      if (S.when && !S.when(L)) continue;
      const sec = document.createElement('section'); sec.className = 'cc-sec';
      const h = document.createElement('h4'); h.innerHTML = `<span>${S.t}</span><em class="cc-cur" data-k="${S.k}"></em>`; sec.appendChild(h);
      const el = S.kind === 'grid' ? gridSection(S) : S.kind === 'chips' ? chipsSection(S) : S.kind === 'skin' ? skinSection(S) : colorsSection(S);
      sec.appendChild(el); body.appendChild(sec);
      SECTIONS.push({ S, el });
    }
    updateSelection();
    // zoom on the face for face tabs (the player sees the detail being edited)
    if (tab === 'face' || tab === 'marks' || tab === 'beard') { if (!zoomed) setZoom(true); } else if (zoomed && tab !== 'hair') setZoom(false);
  }
  function updateSelection() {
    for (const b of body.querySelectorAll('[data-k][data-v]')) {
      const k = b.dataset.k, v = b.dataset.v;
      b.classList.toggle('sel', (L[k] ?? '') === v);
    }
    for (const em of body.querySelectorAll('.cc-cur')) {
      const k = em.dataset.k, v = L[k];
      const e = CATALOG[k] ? CATALOG[k].find((x) => x.id === v) : null;
      em.textContent = e ? e.name : '';
      if (!e && typeof v === 'string') { em.textContent = v ? '' : 'igual ao cabelo'; em.style.setProperty('--c', v ? '#' + v : 'transparent'); em.classList.toggle('dot', !!v); }
    }
    for (const { S, el } of SECTIONS) {
      if (el._sync) el._sync();
      // re-show conditional sections when their condition flips
      if (S.kind === 'grid' && (S.k === 'paint' || S.k === 'over' || S.k === 'shoes' || S.k === 'hair')) { /* handled by rerender on chips */ }
    }
    const want = TABS.find((x) => x.id === tab).sections.filter((S) => !S.when || S.when(L)).length;
    if (want !== SECTIONS.length) renderTab();
  }
  renderTab();
  syncTools();

  // ---------------- close ----------------
  const cancelBtn = Q('[data-a=cancel]');
  let armed = 0;
  const close = (out) => {
    alive = false; cancelAnimationFrame(raf); thumbs.destroy();
    for (const [k, A] of ATLAS) if (k >= 4) { A.clear(); ATLAS.delete(k); } // big preview parts are only for the editor
    removeEventListener('keydown', onKey, true);
    if (ui0) { game.ui.pause = ui0.pause; game.ui.modal = ui0.modal; }
    root.classList.remove('in'); root.classList.add('out');
    setTimeout(() => root.remove(), 220);
    openNow = null;
    resolve(out);
  };
  const save = () => {
    const l = game ? applyLook(game, L) : saveLook(L);
    dispatchEvent(new CustomEvent(LOOK_EVENT, { detail: l }));
    sfx('ui_close', game);
    opts.onSave?.(l);
    close(l);
  };
  const cancel = () => {
    if (packLook(L) !== packLook(initial) && Date.now() - armed > 2600) {
      armed = Date.now(); cancelBtn.classList.add('arm'); cancelBtn.querySelector('span').textContent = 'Descartar?';
      setTimeout(() => { cancelBtn.classList.remove('arm'); cancelBtn.querySelector('span').textContent = 'Cancelar'; }, 2600);
      return;
    }
    sfx('ui_close', game); opts.onCancel?.(); close(null);
  };
  Q('[data-a=save]').onclick = save;
  cancelBtn.onclick = cancel;
  const onKey = (e) => {
    if (!root.isConnected) return;
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'range';
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.stopPropagation(); jump(e.shiftKey ? hi + 1 : hi - 1); }
    else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); e.stopPropagation(); jump(hi + 1); }
    else if (e.key === 'ArrowLeft') { e.stopPropagation(); rot(1); }
    else if (e.key === 'ArrowRight') { e.stopPropagation(); rot(-1); }
    else if (e.key === 'Enter' && mod) { e.preventDefault(); save(); }
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  return promise;
}

export { DEFAULT_LOOK };
