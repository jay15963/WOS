// Sprite gallery: builds the atlas, lists every sprite (1× and 2×) and renders composed pawns/animals and a
// small scene through a Canvas2D mock of the renderer batches (tint by multiply, flip, rotation, lift,
// sheared sun shadows, additive emissive). Serve the repo root and open /tools/gallery.html.
// Query params: ?focus=<regex>&scale=1,3 (only matching sprites, at those scales) · ?only=scene|pawns|armor|animals|iconsec|sprites|atlas
//               &rows=<regex> (pose rows) · &sp=<regex> (animal species) · &cols=<regex> (animal columns)
//               &pz=<px per tile for the pawn sheet> &az=<px per tile for the animal sheet>

import { buildAtlas } from '../src/art/sprites.js';
import { drawPawn, drawAnimal, drawStatic, drawDecor, animEnv } from '../src/art/compose.js';

const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const FOCUS = Q.get('focus') ? new RegExp(Q.get('focus')) : null;
const FSCALES = (Q.get('scale') || '1,2').split(',').map(Number);
const ONLY = Q.get('only'); // 'scene' | 'pawns' | 'animals'
const SECTIONS = ['scene', 'pawns', 'armor', 'animals', 'iconsec', 'sprites', 'atlas'];
if (FOCUS) for (const id of SECTIONS) if (id !== 'sprites') $('#' + id).style.display = 'none';
if (ONLY) for (const id of SECTIONS) if (id !== ONLY) $('#' + id).style.display = 'none';
const t0 = performance.now();
const A = buildAtlas();
A.lookSync = true; // look parts (agent H, art/look/lazy.js) are painted on first use, synchronously here
const buildMs = performance.now() - t0;
$('#stats').textContent = `${A.list.length} sprites · atlas ${A.size}×${A.size} · buildAtlas ${buildMs.toFixed(0)} ms`;
console.log('buildAtlas ms', buildMs, 'atlas', A.size);

// ---------- mock batches ----------
class MockBatch {
  constructor() { this.list = []; this.n = 0; }
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0) {
    this.list.push({ s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift });
    this.n++;
  }
  addRaw(x, y, w, h, r, g, b, a) { this.list.push({ raw: true, x, y, w, h, r, g, b, a }); this.n++; }
  clear() { this.list.length = 0; this.n = 0; }
}
const mkBatches = () => ({ shadow: new MockBatch(), blob: new MockBatch(), decor: new MockBatch(), main: new MockBatch(), fx: new MockBatch(), light: new MockBatch(), emissive: new MockBatch() });

// ---------- sprite sources (tinted / silhouettes cached) ----------
const AC = A.canvas, AS = A.size;
// lazily painted look parts carry their own canvas (u < 0 in the game's second texture)
const srcOf = (s) => s.canvas || AC;
const srcRect = (s) => (s.canvas ? [0, 0, s.pw, s.ph] : [s.u0 * AS, s.v0 * AS, s.pw, s.ph]);
const tintCache = new Map();
function tinted(s, r, g, b, mode = 'tint') {
  const key = s.name + '|' + mode + '|' + (r * 255 | 0) + ',' + (g * 255 | 0) + ',' + (b * 255 | 0);
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = s.pw; c.height = s.ph;
  const x = c.getContext('2d');
  const [sx, sy, sw, sh] = srcRect(s);
  x.drawImage(srcOf(s), sx, sy, sw, sh, 0, 0, sw, sh);
  if (mode === 'tint') {
    if (r !== 1 || g !== 1 || b !== 1) {
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
      x.fillRect(0, 0, sw, sh);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(srcOf(s), sx, sy, sw, sh, 0, 0, sw, sh);
    }
  } else {
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = mode;
    x.fillRect(0, 0, sw, sh);
  }
  tintCache.set(key, c);
  return c;
}

function drawInst(ctx, it, Z, ox, oy, shadowDir) {
  const s = it.s;
  ctx.save();
  if (shadowDir) {
    ctx.translate(ox + (it.x + shadowDir[0] * it.lift) * Z, oy + (it.y + shadowDir[1] * it.lift) * Z);
    ctx.transform(1, 0, -shadowDir[0], -shadowDir[1], 0, 0);
  } else {
    ctx.translate(ox + it.x * Z, oy + (it.y - it.lift) * Z);
  }
  ctx.rotate(it.rot);
  ctx.scale(s.w * it.sx * Z, s.h * it.sy * Z);
  ctx.translate(-s.ax, -s.ay);
  if (it.flip < 0) { ctx.translate(1, 0); ctx.scale(-1, 1); }
  ctx.globalAlpha = Math.max(0, Math.min(1, it.a));
  const img = shadowDir ? tinted(s, 0, 0, 0, '#000') : tinted(s, it.r, it.g, it.b);
  ctx.drawImage(img, 0, 0, s.pw, s.ph, 0, 0, 1, 1);
  if (!shadowDir && it.flash > 0) {
    ctx.globalAlpha = Math.min(1, it.flash) * it.a;
    ctx.drawImage(tinted(s, 1, 1, 1, '#fff'), 0, 0, s.pw, s.ph, 0, 0, 1, 1);
  }
  ctx.restore();
}

const shadowCv = document.createElement('canvas');
function renderScene(ctx, B, cam, W, H, bg, night) {
  const Z = cam.zoom, ox = W / 2 - cam.x * Z, oy = H / 2 - cam.y * Z;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#6b5238'; ctx.fillRect(0, 0, W, H); }
  // sun shadows (union of silhouettes, then 35% black)
  if (B.shadow.list.length) {
    shadowCv.width = W; shadowCv.height = H;
    const sc = shadowCv.getContext('2d');
    for (const it of B.shadow.list) drawInst(sc, it, Z, ox, oy, [0.55, 0.32]);
    ctx.globalAlpha = 0.33;
    ctx.drawImage(shadowCv, 0, 0);
    ctx.globalAlpha = 1;
  }
  for (const k of ['blob', 'decor', 'main', 'fx']) for (const it of B[k].list) drawInst(ctx, it, Z, ox, oy);
  if (night) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#323a5c';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const L of B.light.list) {
      const x = ox + L.x * Z, y = oy + L.y * Z, r = (L.w / 2) * Z;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${L.r * 120 | 0},${L.g * 90 | 0},${L.b * 50 | 0},${Math.min(1, L.a)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const it of B.emissive.list) drawInst(ctx, it, Z, ox, oy);
  ctx.globalCompositeOperation = 'source-over';
}

// soil background (RimWorld-like brown with mottling)
function soil(W, H, seed = 1) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#6a5036'; x.fillRect(0, 0, W, H);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (W * H) / 900; i++) {
    const px = r() * W, py = r() * H, rr = 20 + r() * 70;
    const gr = x.createRadialGradient(px, py, 0, px, py, rr);
    const d = r() < 0.5;
    gr.addColorStop(0, d ? 'rgba(40,28,16,0.18)' : 'rgba(150,120,80,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  for (let i = 0; i < (W * H) / 60; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(30,20,10,0.25)' : 'rgba(170,140,100,0.2)';
    x.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  return c;
}

// ---------- scene ----------
const sceneCv = $('#sceneCv');
const SW = Math.min(1400, innerWidth - 40), SH = ONLY === 'scene' ? Math.max(300, innerHeight - 110) : 620;
sceneCv.width = SW; sceneCv.height = SH;
const sceneBg = soil(SW, SH, 7);
let hs = 12345;
const hr = () => ((hs = (hs * 16807) % 2147483647) / 2147483647);
const decor = [];
for (let y = 0; y < 16; y++) for (let x = 0; x < 30; x++) {
  const n = Math.floor(1.6 + hr() * 1.6);
  for (let k = 0; k < n; k++) {
    const h3 = hr();
    let t = 'grass';
    if (h3 < 0.2) t = 'tallgrass';
    else if (h3 > 0.965) t = 'flower';
    else if (h3 > 0.95) t = 'mushroom';
    if (x > 24 && h3 < 0.5) t = 'reed';
    decor.push({ t, v: Math.floor(hr() * 997), x: x + hr(), y: y + hr(), s: 0.75 + hr() * 0.45, f: hr() < 0.5 ? -1 : 1 });
  }
}
const objects = [];
const O = (type, x, y, v = 0, extra = {}) => objects.push({ type, x, y, v, s: 1, f: v % 2 ? -1 : 1, ...extra });
for (let i = 0; i < 5; i++) O('tree_oak', 2 + i * 2.6, 3.2 + (i % 2) * 1.2, i, { s: 0.9 + (i % 3) * 0.1 });
for (let i = 0; i < 4; i++) O('tree_pine', 15 + i * 1.9, 3 + (i % 2) * 1.4, i);
for (let i = 0; i < 3; i++) O('tree_birch', 23 + i * 1.7, 3.4 + (i % 2), i);
O('tree_dead', 28.5, 4, 0); O('tree_dead', 27, 9.5, 1);
O('tree_oak', 6, 9, 2, { stump: true });
O('tree_oak', 9, 9.4, 3, { age: 0.3 });
for (let i = 0; i < 4; i++) O('bush', 2 + i * 1.3, 7 + (i % 2) * 0.6, i);
O('berrybush', 8, 7.4, 0); O('berrybush', 9.3, 7.2, 1); O('berrybush', 10.6, 7.6, 0, { empty: true });
for (let i = 0; i < 4; i++) O('boulder', 13 + i * 1.3, 8 + (i % 2) * 0.5, i, { s: 0.8 + i * 0.12 });
O('campfire', 17, 11.5, 0, { fire: true, light: { r: 1, g: 0.6, b: 0.3, radius: 4, intensity: 1, flicker: 0.2 } });
O('torch', 19.4, 11.2, 0, { fire: true, light: { r: 1, g: 0.6, b: 0.3, radius: 2.5, intensity: 0.8, flicker: 0.2, lift: 0.9 } });
for (let i = 0; i < 4; i++) O('wall_wood', 21 + i, 10.5);
O('chest', 22, 12.3); O('bed', 24, 12.5);
const items = ['item_wood', 'item_stone', 'item_berries', 'item_meat', 'item_cooked', 'item_leather', 'item_fiber', 'item_ore'];
items.forEach((it, i) => O(it, 2 + i * 0.8, 13.5));

const LOOKS = [
  { skin: [0.96, 0.80, 0.66], hair: 'short', hairColor: [0.36, 0.22, 0.12], shirt: [0.34, 0.47, 0.62] },
  { skin: [0.62, 0.45, 0.33], hair: 'long', hairColor: [0.12, 0.1, 0.09], shirt: [0.62, 0.32, 0.26] },
  { skin: [0.98, 0.86, 0.76], hair: 'bun', hairColor: [0.85, 0.68, 0.38], shirt: [0.44, 0.55, 0.32] },
  { skin: [0.82, 0.62, 0.48], hair: 'mohawk', hairColor: [0.6, 0.2, 0.12], shirt: [0.55, 0.5, 0.42], beard: true },
  { skin: [0.45, 0.32, 0.24], hair: 'curly', hairColor: [0.1, 0.08, 0.07], shirt: [0.8, 0.72, 0.5] },
  { skin: [0.9, 0.74, 0.6], hair: 'ponytail', hairColor: [0.55, 0.36, 0.2], shirt: [0.36, 0.36, 0.42] },
];
const ents = [];
const pawn = (x, y, look, extra = {}) => { const p = { isEntity: true, kind: 'pawn', x, y, facing: 's', moving: false, moveT: 0, action: null, flash: 0, look, weapon: 'sword', ...extra }; ents.push(p); return p; };
const animal = (species, x, y, extra = {}) => { const a = { isEntity: true, kind: 'animal', species, x, y, facing: 'e', moving: false, moveT: 0, action: null, flash: 0, scale: 1, ...extra }; ents.push(a); return a; };
pawn(5, 11, LOOKS[0], { moving: true, path: { cx: 6, cy: 11, r: 2, w: 0.5 } });
pawn(12, 11.5, LOOKS[1], { weapon: 'axe', act: 'chop' });
pawn(14.6, 11.6, LOOKS[2], { weapon: 'pickaxe', act: 'attack', facing: 'e' });
pawn(17.8, 12.4, LOOKS[3], { facing: 'n' });
pawn(16.2, 12.3, LOOKS[4], { facing: 'e', weapon: null });
animal('wolf', 26, 13, { moving: true, path: { cx: 25, cy: 13, r: 2.5, w: 0.4 } });
animal('deer', 20, 14.5, { moving: true, path: { cx: 15, cy: 14.6, r: 4, w: 0.25 } });
animal('boar', 10, 14.6, { facing: 's' });
animal('rabbit', 12, 13.5, { moving: true, path: { cx: 12, cy: 13.8, r: 1, w: 0.9 } });
animal('bear', 27, 7.5, { facing: 'w' });

const facingOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n');
const SB = mkBatches();
let time = 0, last = performance.now();
const cam = { x: 15, y: 8.5, zoom: 64 };
function sceneFrame(dt) {
  for (const e of ents) {
    if (e.path) {
      const P = e.path, a = time * P.w;
      const nx = P.cx + Math.cos(a) * P.r, ny = P.cy + Math.sin(a) * P.r * 0.6;
      e.facing = facingOf(nx - e.x, ny - e.y);
      e.x = nx; e.y = ny; e.moveT += dt * (e.species === 'rabbit' ? 0.7 : 1);
    }
    if (e.act) { const T = 1.1; const k = (time % T) / T; e.action = k < 0.75 ? { type: e.act, t: k / 0.75 } : null; }
  }
  for (const o of objects) if (o.type === 'tree_oak' && o.v === 1) { o.shake = Math.max(0, Math.sin(time * 2)) > 0.9 ? 1 : 0; }
  for (const k in SB) SB[k].clear();
  for (const d of decor) drawDecor(SB, A, d);
  const list = objects.concat(ents).sort((a, b) => a.y - b.y);
  for (const o of list) {
    if (!o.isEntity) { if (A.has(o.type) || o.type.includes('_') || ['bush', 'berrybush', 'boulder', 'campfire', 'torch'].includes(o.type)) drawStatic(SB, A, o, time); }
    else if (o.kind === 'pawn') drawPawn(SB, A, o, time);
    else drawAnimal(SB, A, o, time);
    if (o.light) SB.light.addRaw(o.x, o.y - (o.light.lift ?? 0.3), o.light.radius * 2, o.light.radius * 2, o.light.r, o.light.g, o.light.b, o.light.intensity);
  }
  cam.zoom = +$('#zoom').value;
  renderScene(sceneCv.getContext('2d'), SB, cam, SW, SH, sceneBg, $('#night').checked);
}

// ---------- pawn pose sheet: every action pose × facing ----------
// row = [label, weapon, offhand, action type (or 'walk'|'idle'|'dead'|'block'), armor?]
const POSES = [
  ['idle', 'sword_iron', null, 'idle'], ['walk', 'axe_stone', null, 'walk'], ['punch (bare)', null, null, 'attack'],
  ['shove', null, null, 'shove'], ['slash sword', 'sword_steel', 'shield_iron', 'attack', { body: 'armor_iron', head: 'helmet_iron' }],
  ['stab knife', 'knife_copper', null, 'stab'], ['cleave axe', 'axe_iron', null, 'cleave', { body: 'armor_leather' }],
  ['smash mace', 'club_iron', 'shield_copper', 'smash', { body: 'armor_copper', head: 'helmet_copper' }], ['pierce spear', 'spear_steel', null, 'pierce'],
  ['sweep spear', 'spear_stone', null, 'sweep'], ['shoot bow', 'bow_wood', null, 'shoot', { head: 'hood_leather', body: 'armor_leather' }],
  ['aimed composite', 'bow_composite', null, 'aimed_shot'], ['throw spear', 'spear_iron', null, 'throw'],
  ['block shield', 'sword_copper', 'shield_wood', 'block'], ['shield bash', 'sword_iron', 'shield_iron', 'shield_bash', { body: 'armor_iron' }],
  ['torch swing', 'knife_stone', 'torch_hand', 'torch_swing'], ['walk torch', 'axe_primitive', 'torch_hand', 'walk'],
  ['chop', 'axe_copper', null, 'chop'], ['mine', 'pickaxe_steel', null, 'mine'], ['build', null, null, 'build', { head: 'hat_straw', body: 'tunic_cloth' }],
  ['gather', null, null, 'gather'], ['pick', null, null, 'pick'], ['bandage', null, null, 'bandage'],
  ['whirlwind', 'sword_steel', null, 'whirlwind'], ['charge', 'sword_iron', null, 'charge'], ['disengage', 'bow_wood', null, 'disengage'],
  ['dead', 'axe_iron', 'shield_wood', 'dead', { body: 'armor_leather', head: 'helmet_copper' }],
  // animation pass (D): run, look-at, flinch, respawn, work and rest poses
  ['run', 'sword_iron', 'shield_wood', 'run'], ['run bare', null, null, 'run'], ['look around', 'spear_iron', null, 'look'],
  ['hurt', 'sword_iron', null, 'hurt'], ['respawn', null, null, 'respawn'],
  ['heal (herbs)', null, null, 'heal'], ['eat', 'sword_iron', null, 'eat'], ['craft', null, null, 'craft'], ['cook', null, null, 'cook'],
  ['plant', null, null, 'plant'], ['harvest', null, null, 'harvest'], ['sit', 'axe_iron', 'torch_hand', 'sit'], ['sleep', null, null, 'sleep'],
  ['butcher knife', 'knife_iron', null, 'butcher'], ['butcher bare', null, null, 'butcher'], ['gather bones', null, null, 'gather_bones'],
];
const BANDIT = { skin: [0.78, 0.6, 0.46], hair: 'shaggy', hairColor: [0.2, 0.15, 0.1], shirt: [0.42, 0.36, 0.3], pants: [0.3, 0.26, 0.22], beard: true, hat: 'bandana', hatColor: [0.6, 0.14, 0.12], face: 'scar' };
const FACINGS = ['s', 'e', 'n', 'w'];
const PZ = +(Q.get('pz') || 64), PCW = 1.2, PRH = 1.55;
function sheet(id, rows, cols, cw, rh, z, make, labelsL, labelsT) {
  const cv = $('#' + id);
  cv.width = (cols * cw + 1.7) * z; cv.height = (rows.length * rh + 0.4) * z;
  const bg = soil(cv.width, cv.height, id.length);
  const B = mkBatches();
  const list = [];
  rows.forEach((r, ri) => { for (let c = 0; c < cols; c++) list.push(make(r, ri, c, 1.7 + c * cw + cw / 2, 0.4 + ri * rh + rh - 0.25)); });
  return { cv, bg, B, list, z, labelsL, labelsT, rows, rh, cw };
}
function drawSheet(S, dt, step) {
  if (S.cv.offsetParent === null) return; // hidden section
  for (const k in S.B) S.B[k].clear();
  for (const e of S.list) { step(e, dt); if (e.kind === 'pawn') drawPawn(S.B, A, e, time); else drawAnimal(S.B, A, e, time); }
  const ctx = S.cv.getContext('2d');
  renderScene(ctx, S.B, { x: S.cv.width / S.z / 2, y: S.cv.height / S.z / 2, zoom: S.z }, S.cv.width, S.cv.height, S.bg, $('#night').checked);
  ctx.fillStyle = '#f2e9d8'; ctx.font = '11px system-ui'; ctx.shadowColor = '#000'; ctx.shadowBlur = 2;
  S.rows.forEach((r, i) => ctx.fillText(S.labelsL(r), 4, (0.4 + i * S.rh + S.rh * 0.6) * S.z));
  if (S.labelsT) S.labelsT.forEach((c, i) => ctx.fillText(c, (1.7 + i * S.cw + 0.3) * S.z, 13));
  ctx.shadowBlur = 0;
}
const looks = (i) => (i % 5 === 4 ? BANDIT : LOOKS[i % LOOKS.length]);
const ROWS = Q.get('rows') ? new RegExp(Q.get('rows')) : null; // filter pose rows by label
const pawnSheet = sheet('pawnCv', ROWS ? POSES.filter((r) => ROWS.test(r[0])) : POSES, 4, PCW, PRH, PZ, (r, ri, c, x, y) => ({
  isEntity: true, kind: 'pawn', x, y, facing: FACINGS[c], moving: r[3] === 'walk', moveT: c * 0.2, action: null, flash: 0,
  look: looks(ri), weapon: r[1], offhand: r[2], armor: r[4] || null, act: r[3], dead: r[3] === 'dead', deadT: 0,
}), (r) => r[0], FACINGS);
function stepPawn(p, dt) {
  const a = p.act;
  if (a === 'run') p.moving = true;
  if (p.moving) p.moveT += dt * (a === 'run' ? 1.65 : 1);
  if (!a) return;
  if (a === 'run') return;
  if (a === 'dead') { p.deadT = time % 3; return; }
  if (a === 'look') { const L = ['s', 'e', 'n', 'w'], i = L.indexOf(p.facing); p.headFacing = L[(i + ((time % 4) < 2 ? 1 : 3)) % 4]; return; }
  if (a === 'hurt') { const u = time % 1.4; p.flash = u < 0.17 ? 1 - u / 0.17 : 0; return; }
  if (a === 'respawn') { const u = time % 3; p.dead = u < 1.4; if (p.dead) p.deadT = u; return; }
  if (a === 'sit') { p.pose = { type: 'sit' }; return; }
  if (a === 'sleep') { p.pose = { type: 'sleep', o: null }; return; }
  if (a === 'idle') { p.flash = (time % 3) < 0.15 ? 1 - (time % 3) / 0.15 : 0; return; }
  if (a === 'walk') return;
  if (a === 'block') { p.blocking = (time % 2.4) < 1.6; return; }
  const T = a === 'gather' || a === 'bandage' || a === 'build' || a === 'craft' || a === 'cook' || a === 'butcher' || a === 'gather_bones' ? 1.8 : a === 'eat' ? 2.4 : a === 'heal' ? 1.6 : a === 'shoot' || a === 'aimed_shot' || a === 'whirlwind' ? 1.4 : 1.0;
  const k = (time % T) / T;
  p.action = k < 0.82 ? { type: a, t: k / 0.82 } : null;
}

// ---------- armor & gear combos (idle + walk) ----------
const ARMORS = [
  ['none', null, null, null], ['tunic + straw', { body: 'tunic_cloth', head: 'hat_straw' }, 'knife_primitive', null],
  ['leather + hood', { body: 'armor_leather', head: 'hood_leather' }, 'spear_stone', null],
  ['copper set', { body: 'armor_copper', head: 'helmet_copper' }, 'axe_copper', 'shield_copper'],
  ['iron set', { body: 'armor_iron', head: 'helmet_iron' }, 'sword_iron', 'shield_iron'],
  ['bandit', { body: 'armor_leather' }, 'club_wood', 'torch_hand', BANDIT],
  ['bandit chief', { body: 'armor_iron', head: 'helmet_iron' }, 'sword_steel', 'shield_wood', { ...BANDIT, face: 'eyepatch', hair: 'braid' }],
  ['masked archer', { body: 'tunic_cloth' }, 'bow_composite', null, { ...BANDIT, face: 'mask', hat: null, hair: 'long', beard: false }],
];
const armorSheet = sheet('armorCv', ARMORS, 8, PCW, PRH, PZ, (r, ri, c, x, y) => ({
  isEntity: true, kind: 'pawn', x, y, facing: FACINGS[c % 4], moving: c >= 4, moveT: c * 0.13, action: null, flash: 0,
  look: r[4] || LOOKS[ri % LOOKS.length], weapon: r[2], offhand: r[3], armor: r[1],
}), (r) => r[0], ['s', 'e', 'n', 'w', 's walk', 'e walk', 'n walk', 'w walk']);

// ---------- animal sheet ----------
const SPECIES = ['wolf', 'fox', 'boar', 'deer', 'deer_doe', 'rabbit', 'bear', 'spider'].filter((s) => !Q.get('sp') || new RegExp(Q.get('sp')).test(s)); // ?sp=<regex>
const ACOLS = ['s', 'e', 'n', 'w', 'e-idle', 's-idle', 'n-idle', 'e-attack', 's-attack', 'n-attack', 'dead'].filter((c) => !Q.get('cols') || new RegExp(Q.get('cols')).test(c)); // ?cols=<regex>
const AZ = +(Q.get('az') || 56), ACW = 2.0, ARH = 2.0;
const animalSheet = sheet('animalCv', SPECIES, ACOLS.length, ACW, ARH, AZ, (sp, r, c, x, y) => {
  const [f, st] = ACOLS[c].split('-');
  const doe = sp === 'deer_doe';
  return { isEntity: true, kind: 'animal', species: doe ? 'deer' : sp, variant: sp === 'deer' ? 0 : doe ? 1 : undefined, x, y, facing: f === 'dead' ? 'e' : f, moving: !st && f !== 'dead', moveT: c * 0.3, action: null, flash: 0, scale: sp === 'bear' ? 1.2 : 1, st: st || (f === 'dead' ? 'dead' : 'walk'), dead: f === 'dead', deadT: 0 };
}, (sp) => sp, ACOLS);
function stepAnimal(a, dt) {
  if (a.moving) a.moveT += dt * (a.species === 'rabbit' ? 0.7 : 1);
  if (a.st === 'attack') { const k = (time % 1.2) / 1.2; a.action = k < 0.7 ? { type: 'attack', t: k / 0.7 } : null; }
  if (a.dead) a.deadT = time % 3;
}

// ---------- icon sheet (64 px and HUD size 40 px) ----------
{
  const host = $('#icons');
  for (const s of A.list) {
    if (!/^icon_/.test(s.name)) continue;
    const cell = document.createElement('div'); cell.className = 'cell';
    const pics = document.createElement('div'); pics.className = 'pics';
    for (const k of [64, 40]) {
      const c = document.createElement('canvas'); c.width = c.height = k;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(tinted(s, 1, 1, 1), 0, 0, s.pw, s.ph, 0, 0, k, k);
      pics.appendChild(c);
    }
    cell.appendChild(pics);
    const lab = document.createElement('span'); lab.textContent = s.name.slice(5); cell.appendChild(lab);
    host.appendChild(cell);
  }
}

// ---------- sprite listing ----------
const CATS = [
  ['Trees', /^tree_/], ['Plants', /^(bush|berrybush|grass|tallgrass|reed|flower|mushroom)/], ['Rocks', /^boulder/],
  ['Pawn parts', /^(pawn_|hair_|beard_|brows_)/], ['Apparel', /^(wear_|hat_|face_)/], ['Held gear', /^(held_|weapon_|tool_|proj_)/], ['Animals', /^(wolf|boar|deer|rabbit|bear|fox|spider)_/],
  ['Buildings', /^(campfire|torch|wall_|chest|bed)/], ['Items', /^item_/], ['Icons', /^icon_/], ['FX', /^fx_/],
];
const sec = $('#sprites');
const groups = new Map(CATS.map(([n]) => [n, []]));
groups.set('Other', []);
for (const s of A.list) {
  if (FOCUS && !FOCUS.test(s.name)) continue;
  const c = CATS.find(([, re]) => re.test(s.name));
  groups.get(c ? c[0] : 'Other').push(s);
}
for (const [name, list] of groups) {
  if (!list.length) continue;
  const h = document.createElement('h2'); h.textContent = `${name} (${list.length})`; sec.appendChild(h);
  const grid = document.createElement('div'); grid.className = 'grid'; sec.appendChild(grid);
  for (const s of list) {
    const cell = document.createElement('div'); cell.className = 'cell';
    const pics = document.createElement('div'); pics.className = 'pics';
    for (const k of (FOCUS ? FSCALES : [1, 2])) {
      const c = document.createElement('canvas');
      c.width = s.pw * k; c.height = s.ph * k;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      const tint = /^(pawn_body)/.test(s.name) ? [0.34, 0.47, 0.62] : /^pawn_legs/.test(s.name) ? [0.42, 0.35, 0.28] : /^(pawn_head|pawn_hand)/.test(s.name) ? [0.96, 0.8, 0.66] : /^(hair_|beard_|brows_)/.test(s.name) ? [0.45, 0.28, 0.15] : /^(hat_|face_mask)/.test(s.name) ? [0.6, 0.14, 0.12] : null;
      x.drawImage(tint ? tinted(s, ...tint) : tinted(s, 1, 1, 1), 0, 0, s.pw * k, s.ph * k);
      // anchor marker
      x.fillStyle = 'rgba(255,60,60,0.9)'; x.fillRect(s.ax * s.pw * k - 1, s.ay * s.ph * k - 1, 3, 3);
      pics.appendChild(c);
    }
    cell.appendChild(pics);
    const lab = document.createElement('span'); lab.textContent = `${s.name} ${s.pw}×${s.ph}`; cell.appendChild(lab);
    grid.appendChild(cell);
  }
}

// ---------- atlas ----------
{
  const c = $('#atlasCv');
  const k = Math.min(1, 1024 / A.size);
  c.width = A.size * k; c.height = A.size * k;
  const x = c.getContext('2d');
  x.fillStyle = '#6b5238'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(AC, 0, 0, c.width, c.height);
}

// ---------- frozen animation strip: ?strip=<walk|run|action type>&sdir=<s|e|n|w>&n=10&weapon=<id>&off=<id>&species=<sp> ----------
// renders N phases of one pose side by side (walk/run: one gait cycle; actions: t = 0..1) for frame-by-frame review
if (Q.get('strip')) {
  for (const id of SECTIONS) $('#' + id).style.display = 'none';
  $('#strip').style.display = '';
  const kinds = Q.get('strip').split(','), d = Q.get('sdir') || 'e', N = +(Q.get('n') || 10), Z = +(Q.get('z') || 110);
  const sp = Q.get('species');
  const cv = $('#stripCv'); const CW = sp ? 2.0 : 1.15, RH = sp ? 1.9 : 1.6;
  cv.width = (N * CW + 0.3) * Z; cv.height = (RH * kinds.length + 0.2) * Z;
  const bg = soil(cv.width, cv.height, 7);
  const draw = () => {
    const B = mkBatches();
    for (let j = 0; j < kinds.length; j++) for (let i = 0; i < N; i++) {
      const u = i / N, kind = kinds[j];
      const e = sp
        ? { isEntity: true, kind: 'animal', species: sp === 'deer_doe' ? 'deer' : sp, variant: sp === 'deer_doe' ? 1 : 0, x: 0.15 + CW / 2 + i * CW, y: RH * (j + 1), facing: d, moving: kind !== 'idle' && kind !== 'attack', flash: 0, scale: 1, id: 7 }
        : { isEntity: true, kind: 'pawn', x: 0.15 + CW / 2 + i * CW, y: RH * (j + 1) - 0.1, facing: d, moving: kind === 'walk' || kind === 'run', look: LOOKS[1], weapon: Q.get('weapon') || null, offhand: Q.get('off') || null, armor: null, flash: 0 };
      e._ph = 1.3; e._ft = 1; e._mk = e.moving ? 1 : 0;
      if (sp) { e._gs = kind === 'run' ? 5.5 : 1.6; e._gph = u * Math.PI * 2; e.moveT = 1; if (kind === 'attack') e.action = { type: 'attack', t: u }; if (kind === 'idle') e.nid = 'm' + j; }
      else if (kind === 'swim') { e._swim = 1; e.moving = true; e._mk = 1; e._gs = 0.5; e.moveT = (u * Math.PI * 2) / 4; }
      else if (kind === 'wet') { e._wet = 1; }
      else if (e.moving) { e._gs = kind === 'run' ? 6.6 : 4; e.moveT = (u * Math.PI * 2) / 9.5; }
      else if (kind === 'sit' || kind === 'sleep') e.pose = { type: kind };
      else if (kind !== 'idle') e.action = { type: kind, t: u };
      if (sp && kind === 'idle') animEnv.wt = u * 12; // idle life schedule over 12 s
      if (sp) drawAnimal(B, A, e, 1); else drawPawn(B, A, e, 1);
    }
    renderScene(cv.getContext('2d'), B, { x: cv.width / Z / 2, y: cv.height / Z / 2, zoom: Z }, cv.width, cv.height, bg, false);
  };
  draw();
  window.redrawStrip = draw;
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
  try { if (ONLY !== 'pawns' && ONLY !== 'armor' && ONLY !== 'animals') sceneFrame(dt); if (ONLY !== 'scene') { drawSheet(pawnSheet, dt, stepPawn); drawSheet(armorSheet, dt, stepPawn); drawSheet(animalSheet, dt, stepAnimal); } } catch (e) { console.error(e); $('#stats').textContent += ' · ERROR ' + e.message; return; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.galleryAtlas = A;
