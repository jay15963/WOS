// World art gallery (Art A): builds the atlas and renders world objects through composeWorld.js with a
// Canvas2D mock of the renderer batches (ground → sun shadows → blob → decor → y-sorted main → fx → night
// light → emissive). Structures are laid out from ASCII maps and autotile masks are computed like the game does.
// Serve the repo root and open /tools/gallery-world.html.
// Query: ?focus=<regex> (sprite listing filter) · ?only=structures|masks|props|nature|sprites|atlas · ?z=<zoom>

import { buildAtlas } from '../src/art/sprites.js';
import * as CW from '../src/art/composeWorld.js';

const { drawStatic, drawDecor } = CW;
const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const FOCUS = Q.get('focus') ? new RegExp(Q.get('focus')) : null;
const ONLY = Q.get('only');
if (ONLY) for (const id of ['structures', 'masks', 'props', 'nature', 'nature2', 'sprites', 'atlas']) if (id !== ONLY) $('#' + id).style.display = 'none';
if (Q.get('z')) $('#zoom').value = Q.get('z');
if (Q.get('hour')) $('#hour').value = Q.get('hour');
if (Q.get('night')) $('#night').checked = true;

const t0 = performance.now();
const A = buildAtlas();
const buildMs = performance.now() - t0;
$('#stats').textContent = `${A.list.length} sprites · atlas ${A.size}² · buildAtlas ${buildMs.toFixed(0)} ms`;
console.log('buildAtlas ms', buildMs, 'atlas', A.size, 'sprites', A.list.length);
window.galleryAtlas = A;

// ---------- mock batches ----------
class MockBatch {
  constructor() { this.list = []; this.n = 0; }
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0) {
    if (!s) throw new Error('null sprite');
    this.list.push({ s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift }); this.n++;
  }
  addRaw(x, y, w, h, r, g, b, a) { this.list.push({ raw: true, x, y, w, h, r, g, b, a }); this.n++; }
  clear() { this.list.length = 0; this.n = 0; }
}
const BATCHES = ['shadow', 'ground', 'blob', 'decor', 'main', 'fx', 'light', 'emissive'];
const mkBatches = () => Object.fromEntries(BATCHES.map((k) => [k, new MockBatch()]));

const AC = A.canvas, AS = A.size;
const tintCache = new Map();
function tinted(s, r, g, b, mode = 'tint') {
  const key = s.name + '|' + mode + '|' + (r * 255 | 0) + ',' + (g * 255 | 0) + ',' + (b * 255 | 0);
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = s.pw; c.height = s.ph;
  const x = c.getContext('2d');
  const sx = s.u0 * AS, sy = s.v0 * AS;
  x.drawImage(AC, sx, sy, s.pw, s.ph, 0, 0, s.pw, s.ph);
  if (mode === 'tint') {
    if (r !== 1 || g !== 1 || b !== 1) {
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${Math.min(255, r * 255) | 0},${Math.min(255, g * 255) | 0},${Math.min(255, b * 255) | 0})`;
      x.fillRect(0, 0, s.pw, s.ph);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(AC, sx, sy, s.pw, s.ph, 0, 0, s.pw, s.ph);
    }
  } else { x.globalCompositeOperation = 'source-in'; x.fillStyle = mode; x.fillRect(0, 0, s.pw, s.ph); }
  tintCache.set(key, c);
  return c;
}
let TIME = 0;
function drawInst(ctx, it, Z, ox, oy, shadowDir) {
  const s = it.s;
  ctx.save();
  if (shadowDir) {
    // like SHADOW_VS: above the anchor → projected along the sun by height; below (negative sy) → kept on
    // the ground ×0.6; every pixel additionally offset by lift
    ctx.translate(ox + (it.x + shadowDir[0] * it.lift) * Z, oy + (it.y + shadowDir[1] * it.lift) * Z);
    if (it.sy < 0) ctx.transform(1, 0, 0, 0.6, 0, 0);
    else ctx.transform(1, 0, -shadowDir[0], -shadowDir[1], 0, 0);
  } else ctx.translate(ox + it.x * Z, oy + (it.y - it.lift) * Z);
  ctx.rotate(it.rot);
  if (it.sway && !shadowDir) { // approximate shader sway: shear proportional to height
    const k = (Math.sin(TIME * 1.5 + it.x * 0.63 + it.y * 0.37) * 0.55 + 0.3) * it.sway * 0.8;
    ctx.transform(1, 0, -k, 1, 0, 0);
  }
  ctx.scale(s.w * it.sx * Z, s.h * it.sy * Z);
  ctx.translate(-s.ax, -s.ay);
  if (it.flip < 0) { ctx.translate(1, 0); ctx.scale(-1, 1); }
  ctx.globalAlpha = Math.max(0, Math.min(1, it.a));
  const img = shadowDir ? tinted(s, 0, 0, 0, '#000') : tinted(s, it.r, it.g, it.b);
  ctx.drawImage(img, 0, 0, s.pw, s.ph, 0, 0, 1, 1);
  if (!shadowDir && it.flash > 0) { ctx.globalAlpha = Math.min(1, it.flash) * it.a; ctx.drawImage(tinted(s, 1, 1, 1, '#fff'), 0, 0, s.pw, s.ph, 0, 0, 1, 1); }
  ctx.restore();
}
function sunDir(h) {
  const dayK = (h - 6) / 12, ang = dayK * Math.PI;
  const sx = Math.cos(ang), sy = 0.42, sz = Math.sin(ang) * 0.95 + 0.06;
  const hl = Math.hypot(sx, sy), len = Math.min(2, Math.max(0.42, hl / Math.max(sz, 0.22)));
  return [(-sx / hl) * len, (-sy / hl) * len];
}
const shadowCv = document.createElement('canvas');
function renderScene(ctx, B, cam, W, H, bg) {
  const Z = cam.zoom, ox = W / 2 - cam.x * Z, oy = H / 2 - cam.y * Z;
  const night = $('#night').checked;
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#6b5238'; ctx.fillRect(0, 0, W, H); }
  if (B.water) { const [x, y, w, h] = B.water; ctx.fillStyle = '#2e5a64'; ctx.fillRect(ox + x * Z, oy + y * Z, w * Z, h * Z); }
  for (const it of B.ground.list) drawInst(ctx, it, Z, ox, oy);
  if (B.shadow.list.length && !night) {
    shadowCv.width = W; shadowCv.height = H;
    const sc = shadowCv.getContext('2d');
    const dir = sunDir(+$('#hour').value);
    for (const it of B.shadow.list) drawInst(sc, it, Z, ox, oy, dir);
    ctx.globalAlpha = 0.4; ctx.drawImage(shadowCv, 0, 0); ctx.globalAlpha = 1;
  }
  for (const k of ['blob', 'decor', 'main', 'fx']) for (const it of B[k].list) drawInst(ctx, it, Z, ox, oy);
  if (night) {
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#2a3050'; ctx.fillRect(0, 0, W, H);
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
  if ($('#grid').checked) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(-ox / Z); x * Z + ox < W; x++) { ctx.moveTo(x * Z + ox + 0.5, 0); ctx.lineTo(x * Z + ox + 0.5, H); }
    for (let y = Math.floor(-oy / Z); y * Z + oy < H; y++) { ctx.moveTo(0, y * Z + oy + 0.5); ctx.lineTo(W, y * Z + oy + 0.5); }
    ctx.stroke();
  }
}
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
let hs = 12345;
const hr = () => ((hs = (hs * 16807) % 2147483647) / 2147483647);
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };

// ---------- scenes ----------
const SCENES = [];
function scene(cvId, wTiles, hTiles, build, opts = {}) {
  const cv = $('#' + cvId);
  const S = { cv, wTiles, hTiles, objects: [], decor: [], B: mkBatches(), opts, anim: [] };
  build(S);
  S.resize = () => {
    const Z = +$('#zoom').value;
    const W = Q.get('full') ? Math.round(wTiles * Z) : Math.min(Math.round(wTiles * Z), Math.max(400, innerWidth - 40)), H = Math.round(hTiles * Z);
    if (cv.width !== W || cv.height !== H || !S.bg) { cv.width = W; cv.height = H; S.bg = soil(W, H, 7 + SCENES.length); }
    S.cam = { x: Q.get('cx') ? +Q.get('cx') : Math.min(wTiles / 2, W / Z / 2), y: Q.get('cy') ? +Q.get('cy') : hTiles / 2, zoom: Z }; // ?cx= / ?cy= pan
  };
  SCENES.push(S);
  return S;
}
function frameScene(S, t) {
  S.resize();
  const B = S.B;
  for (const k in B) B[k].clear?.();
  for (const f of S.anim) f(t);
  B.water = S.water || null;
  for (const d of S.decor) drawDecor(B, A, d);
  S.objects.sort((a, b) => a.y - b.y);
  for (const o of S.objects) {
    drawStatic(B, A, o, t);
    const L = o.light;
    if (L) B.light.addRaw(o.x, o.y - (L.lift ?? 0.3), L.radius * 2, L.radius * 2, L.r, L.g, L.b, L.intensity);
  }
  renderScene(S.cv.getContext('2d'), B, S.cam, S.cv.width, S.cv.height, S.bg);
  if (S.labels) {
    const ctx = S.cv.getContext('2d'), Z = S.cam.zoom, ox = S.cv.width / 2 - S.cam.x * Z, oy = S.cv.height / 2 - S.cam.y * Z;
    ctx.font = '11px system-ui'; ctx.fillStyle = '#f2e9d8'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    for (const [txt, x, y] of S.labels) ctx.fillText(txt, ox + x * Z, oy + y * Z);
    ctx.shadowBlur = 0;
  }
}
function grassAround(S, density = 1.6, avoid = null) {
  for (let y = 0; y < S.hTiles; y++) for (let x = 0; x < S.wTiles; x++) {
    if (avoid && avoid(x, y)) continue;
    const n = Math.floor(density * hr() * 2);
    for (let k = 0; k < n; k++) {
      const h3 = hr();
      const t = h3 < 0.2 ? 'tallgrass' : h3 > 0.97 ? 'flower' : 'grass';
      S.decor.push({ t, v: Math.floor(hr() * 997), x: x + hr(), y: y + hr(), s: 0.75 + hr() * 0.45, f: hr() < 0.5 ? -1 : 1 });
    }
  }
}

// ASCII structure maps → objects with autotile masks (same rules as the game: N=1 E=2 S=4 W=8)
const CH = {
  '#': 'wall_wood', 'S': 'wall_stone', 'D': 'door_wood', 'f': 'fence_wood', 'g': 'gate_wood',
  ',': 'floor_wood', ';': 'floor_stone', 'p': 'farm_plot',
};
const GROUP = { wall_wood: 'wall', wall_stone: 'wall', door_wood: 'wall', fence_wood: 'fence', gate_wood: 'fence', floor_wood: 'floor_wood', floor_stone: 'floor_stone', farm_plot: 'farm_plot' };
function fromMap(S, rows, ox = 0, oy = 0, extra = null) {
  const at = (x, y) => (rows[y] && CH[rows[y][x]]) || null;
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
    const type = at(x, y);
    if (!type) continue;
    const g = GROUP[type];
    const same = (dx, dy) => { const t = at(x + dx, y + dy); return t && GROUP[t] === g; };
    const mask = (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0);
    const o = { type, tx: x + ox, ty: y + oy, x: x + ox + 0.5, y: y + oy + 1, v: hash(x, y) % 97, s: 1, f: 1, mask, id: S.objects.length };
    if (type === 'door_wood' || type === 'gate_wood') {
      o.orient = mask & 10 ? 'h' : 'v';
      o.open = 0;
      S.anim.push((t) => { o.open = $('#anim').checked ? Math.max(0, Math.min(1, Math.sin(t * 1.3 + x) * 0.9 + 0.5)) : +$('#open').value; });
    }
    if (extra) extra(o, x, y);
    S.objects.push(o);
  }
}

// --- structures scene ---
const STRUCT_MAP = [
  '..................................................',
  '.#########......SSSSSSSSS.......fffffgffffff......',
  '.#,,,,,,,#......S;;;;;;;S.......f..........f......',
  '.#,,,,,,,#......S;;;;;;;D.......f..ppppppp.f......',
  '.#,,,,,,,D......S;;;;;;;S.......g..ppppppp.f......',
  '.#,,,,,,,#......SSSSDSSSS.......f..ppppppp.f......',
  '.####D####......................f..........f......',
  '................................ffffffffffff......',
  '.##..#..###..#....#.....SS.....##.....f..fff..f...',
  '.##..#....#..#...###...SSS.....##....fff.f.f.fgf..',
  '.....#....#.###...#....S.S....##......f..fff..f...',
  '.#####....#..#...........................f........',
  '..........................#S#S#.......ffff.p..pp..',
  '.,,,,..;;;;..pp.p.........#,,,#.......f....pp.pp..',
  '.,,,,..;;;;..pp...........#S#S#.......f.......p...',
  '..................................................',
];
const structS = scene('structCv', 50, 16.5, (S) => {
  fromMap(S, STRUCT_MAP, 0, 0, (o, x, y) => {
    if (o.type === 'farm_plot') {
      // crops on the big plot: one kind per row, stages across
      if (y >= 3 && y <= 5 && x >= 36 && x <= 42) {
        const kind = ['potato', 'cotton', 'corn'][y - 3];
        const st = Math.min(3, x - 36 - (x > 39 ? 1 : 0));
        S.objects.push(y === 5 ? { type: 'crop_' + kind, stage: st, x: x + 0.5, y: y + 1.002, v: x, s: 1, f: 1 } : { type: 'crop', kind, stage: st, x: x + 0.5, y: y + 1.002, v: x, s: 1, f: 1 });
      }
    }
    // blueprints and damage
    if (y === 8 && x <= 2) o.progress = 0.35;
    if (y === 9 && x === 2) o.progress = 0.35;
    if (y === 8 && (x === 8 || x === 9 || x === 10)) { o.hp = x === 8 ? 70 : x === 9 ? 40 : 12; o.maxHp = 100; }
  });
  grassAround(S, 1.2, (x, y) => STRUCT_MAP[y] && STRUCT_MAP[y][x] !== '.');
  S.labels = [['blueprint', 1, 8.4], ['damaged', 8, 8.4]];
});

// --- masks sheet ---
const MASK_TYPES = ['wall_wood', 'wall_stone', 'fence_wood', 'floor_wood', 'floor_stone', 'farm_plot'];
const maskS = scene('maskCv', 16 * 1.7 + 2.2, MASK_TYPES.length * 2 + 0.6, (S) => {
  MASK_TYPES.forEach((type, r) => {
    for (let m = 0; m < 16; m++) S.objects.push({ type, mask: m, x: 2.2 + m * 1.7 + 0.5, y: r * 2 + 2, v: m, s: 1, f: 1, id: m });
  });
  S.labels = MASK_TYPES.map((t, r) => [t, 0.1, r * 2 + 1.6]);
  for (let m = 0; m < 16; m++) S.labels.push([String(m), 2.2 + m * 1.7 + 0.35, 0.45]);
});

// --- props scene ---
const propS = scene('propCv', 30, 13, (S) => {
  const O = (type, x, y, extra = {}) => { const o = { type, x, y, v: 0, s: 1, f: 1, id: S.objects.length, ...extra }; S.objects.push(o); return o; };
  const L = (r, g, b, radius, intensity, lift) => ({ r, g, b, radius, intensity, flicker: 0.25, lift });
  // stations row (footprint anchors: x = tx + w/2, y = ty + h)
  O('workbench', 2, 3); O('stonecutter', 5, 3); O('furnace', 7.5, 3, { working: true, light: L(1, 0.55, 0.25, 3, 0.9, 0.4) });
  O('furnace', 9, 3); O('anvil', 10.5, 3); O('loom', 13, 3); O('cooking_pot', 15.5, 3, { working: true, fire: true, light: L(1, 0.6, 0.3, 2.5, 0.8, 0.2) });
  O('cooking_pot', 17, 3, { fire: false });
  O('workbench', 20, 3, { progress: 0.5 }); O('campfire', 22.5, 3, { fire: true, light: L(1, 0.62, 0.3, 5, 1.2, 0.3) });
  O('campfire', 24, 3, { fire: false });
  O('torch', 25.5, 3, { fire: true, light: L(1, 0.7, 0.38, 3.6, 1.0, 0.75) });
  O('chest', 27, 3); O('crate', 28.5, 3);
  // furniture
  O('rug', 3, 7); O('table_wood', 3, 6.6); O('chair_wood', 1.5, 6.6, { f: 1 }); O('chair_wood', 4.5, 6.6, { f: -1 });
  O('chair_wood', 3, 5.6, { dir: 'n' });
  O('bed', 7, 7); O('flower_pot', 8.5, 6.5); O('flower_pot', 9.3, 6.5, { v: 1 }); O('flower_pot', 10.1, 6.5, { v: 2 });
  O('banner', 11.5, 7); O('banner', 12.7, 7, { v: 1 });
  O('brazier', 14.5, 7, { fire: true, light: L(1, 0.6, 0.3, 4, 1.1, 0.6) }); O('brazier', 16, 7, { fire: false });
  O('lamp_post', 17.5, 7, { lit: true, light: L(1, 0.8, 0.5, 4.5, 1.0, 1.4) }); O('lamp_post', 19, 7, { lit: false });
  O('rug', 21, 7, { v: 1 });
  O('wall_wood', 25.5, 6, { mask: 0 });
  // bandit camp
  O('tent', 3, 12, { v: 0 }); O('tent', 7.5, 12, { v: 1 }); O('crate', 10, 11.2); O('crate', 10.7, 11.9, { v: 1 }); O('crate', 9.6, 12.2, { v: 2 });
  O('campfire', 12.5, 11.5, { fire: true, light: L(1, 0.62, 0.3, 5, 1.2, 0.3) }); O('banner', 14.5, 11.5, { v: 2 });
  O('torch', 15.5, 12, { fire: true, light: L(1, 0.7, 0.38, 3.6, 1.0, 0.75) });
  grassAround(S, 1.0);
  S.labels = [['stations · lights', 0.3, 0.6], ['furniture', 0.3, 4.6], ['camp', 0.3, 8.8]];
});

// --- nature scene ---
const natS = scene('natCv', 34, 15, (S) => {
  const O = (type, x, y, v = 0, extra = {}) => { const o = { type, x, y, v, s: 1, f: v % 2 ? -1 : 1, id: S.objects.length, ...extra }; S.objects.push(o); return o; };
  for (let i = 0; i < 5; i++) O('tree_oak', 2 + i * 2.7, 3.6 + (i % 2) * 0.5, i);
  for (let i = 0; i < 4; i++) O('tree_pine', 16 + i * 2.1, 3.8 + (i % 2) * 0.4, i);
  for (let i = 0; i < 3; i++) O('tree_birch', 25.5 + i * 2, 3.6 + (i % 2) * 0.5, i);
  // pine forest cluster
  for (let i = 0; i < 9; i++) O('tree_pine', 2 + (i % 5) * 1.5 + (i > 4 ? 0.75 : 0), 8 + (i > 4 ? 1.1 : 0), i, { s: 0.85 + (i % 3) * 0.1 });
  O('tree_dead', 11, 8.6, 0); O('tree_dead', 13, 8.8, 1);
  O('tree_oak', 15, 8.2, 2, { stump: true }); O('tree_pine', 16.3, 8.2, 1, { stump: true }); O('tree_oak', 17.6, 8.2, 3, { age: 0.3 });
  for (let i = 0; i < 4; i++) O('bush', 19.5 + i * 1.4, 7.6 + (i % 2) * 0.4, i);
  O('berrybush', 25.5, 7.8, 0); O('berrybush', 27, 7.6, 1); O('berrybush', 28.5, 7.9, 0, { empty: true });
  for (let i = 0; i < 4; i++) O('boulder', 19.5 + i * 1.5, 9.6 + (i % 2) * 0.3, i, { s: 0.85 + i * 0.1 });
  // pickups
  for (let i = 0; i < 4; i++) O('pebble', 2 + i * 0.9, 12, i);
  for (let i = 0; i < 3; i++) O('stick', 6 + i * 1.1, 12, i);
  for (let i = 0; i < 3; i++) O('fibergrass', 10 + i * 1.1, 12, i);
  O('wild_potato', 14, 12); O('wild_cotton', 15.4, 12); O('wild_corn', 16.8, 12);
  // decor samples
  const D = (t, x, y, v) => S.decor.push({ t, v, x, y, s: 1, f: 1 });
  for (let i = 0; i < 8; i++) D('grass', 2 + i * 0.9, 14, i);
  for (let i = 0; i < 4; i++) D('tallgrass', 10 + i * 1, 14, i);
  for (let i = 0; i < 3; i++) D('reed', 14.5 + i * 0.9, 14, i);
  for (let i = 0; i < 6; i++) D('flower', 18 + i * 0.8, 14, i);
  for (let i = 0; i < 3; i++) D('mushroom', 23.5 + i * 0.8, 14, i);
  grassAround(S, 0.8, (x, y) => y >= 11);
  S.labels = [['pickups: pebble · stick · fibergrass · wild potato / cotton / corn', 2, 11]];
});

// --- nature+ (species, undergrowth, ground details, water edge) ---
const nat2S = scene('nat2Cv', 34, 17, (S) => {
  const O = (type, x, y, v = 0, extra = {}) => { const o = { type, x, y, v, s: 1, f: v % 2 ? -1 : 1, id: S.objects.length, ...extra }; S.objects.push(o); return o; };
  const D = (t, x, y, v, s = 1) => S.decor.push({ t, v, x, y, s, f: v % 2 ? -1 : 1 });
  // tree species: v = species * 16 + variant
  for (let i = 0; i < 3; i++) O('tree_oak', 2 + i * 2.6, 3.8 + (i % 2) * 0.4, 16 + i);       // maples
  for (let i = 0; i < 2; i++) O('tree_oak', 10.6 + i * 3.3, 3.9, 32 + i);                      // willows
  for (let i = 0; i < 2; i++) O('tree_pine', 17.8 + i * 2.4, 4, 16 + i);                       // scots pines
  for (let i = 0; i < 2; i++) O('tree_pine', 22.6 + i * 2.1, 4, 32 + i);                       // junipers
  for (let i = 0; i < 2; i++) O('tree_birch', 26.6 + i * 1.6, 4, 16 + i);                      // aspens
  O('tree_dead', 30.4, 4, 16); O('tree_pine', 32.3, 4, 1);
  // bushes, herbs, mossy boulders
  for (let i = 0; i < 3; i++) O('herbbush', 2 + i * 1.4, 7.2, i);
  for (let i = 0; i < 2; i++) O('bush', 6.6 + i * 1.4, 7.2, 1000 + i);
  for (let i = 0; i < 2; i++) O('bush', 9.6 + i * 1.4, 7.2, 2000 + i);
  for (let i = 0; i < 3; i++) O('boulder', 13 + i * 1.4, 7.2, 8000 + i);
  // upright undergrowth
  for (let i = 0; i < 4; i++) D('fern', 17.5 + i * 1.0, 7.2, i);
  for (let i = 0; i < 6; i++) D('bloom', 21.8 + i * 0.95, 7.2, i);
  for (let i = 0; i < 2; i++) D('heather', 2 + i * 1, 9.6, i);
  for (let i = 0; i < 2; i++) D('drygrass', 4.2 + i * 1, 9.6, i);
  for (let i = 0; i < 2; i++) D('thistle', 6.4 + i * 0.8, 9.6, i);
  for (let i = 0; i < 5; i++) D('mushroom', 8.4 + i * 0.7, 9.6, i);
  // flat details
  const flat = [['litter', 5], ['needles', 2], ['twigs', 2], ['petals', 2], ['moss', 3], ['scree', 2], ['shell', 2], ['driftwood', 1]];
  let fx = 12.5;
  for (const [t, n] of flat) for (let i = 0; i < n; i++) { D(t, fx, 9.6, i); fx += 1.15; }
  // a pond corner with lily pads, river stones, reeds
  S.labels = [['maples · willows · scots pines · junipers · aspens · snag', 1.5, 0.8], ['herb bushes · rose · juniper shrub · mossy boulders · ferns · flower clusters (meadow warm/cool, forest, marsh, shore, rocky)', 1.5, 5.6],
    ['heather · dry grass · thistle · mushrooms · litter (oak/maple/birch) · needles · twigs · petals · moss · scree · shells · driftwood', 1.5, 8.6], ['water edge: lily pads · river stones · reeds', 1.5, 11.4]];
  S.water = [1, 12, 33, 4.5];
  for (let i = 0; i < 4; i++) D('lily', 3 + i * 1.6, 13.6 + (i % 2) * 0.6, i);
  for (let i = 0; i < 3; i++) D('riverstone', 11 + i * 1.3, 13.8, i);
  for (let i = 0; i < 3; i++) D('reed', 16 + i * 0.8, 13.4, i);
  grassAround(S, 0.6, (x, y) => y >= 11);
});

// ---------- sprite listing ----------
const MINE = /^(tree_|bush|berrybush|herbbush|fern|bloom|heather|drygrass|thistle|litter|needles|twigs|petals|moss|lily|riverstone|scree|shell|driftwood|grass|tallgrass|reed|flower|mushroom|boulder|pebble|stick|fibergrass|wild_|campfire|torch|wall_|chest|bed|fence_|floor_|farm_|door_|gate_|workbench|stonecutter|furnace|anvil|loom|cooking_pot|table_|chair_|rug|flower_pot|banner|brazier|lamp_post|tent|crate|crop_|scaffold|crack|struct_)/;
{
  const sec = $('#sprites');
  const list = A.list.filter((s) => MINE.test(s.name) && (!FOCUS || FOCUS.test(s.name)));
  const h = document.createElement('h2'); h.textContent = `World sprites (${list.length})`; sec.appendChild(h);
  const grid = document.createElement('div'); grid.className = 'grid'; sec.appendChild(grid);
  for (const s of list) {
    const cell = document.createElement('div'); cell.className = 'cell';
    const pics = document.createElement('div'); pics.className = 'pics';
    for (const k of FOCUS ? [1, 2] : [1]) {
      const c = document.createElement('canvas');
      c.width = s.pw * k; c.height = s.ph * k;
      const x = c.getContext('2d');
      x.drawImage(tinted(s, 1, 1, 1), 0, 0, s.pw * k, s.ph * k);
      x.fillStyle = 'rgba(255,60,60,0.9)'; x.fillRect(s.ax * s.pw * k - 1, s.ay * s.ph * k - 1, 3, 3);
      pics.appendChild(c);
    }
    cell.appendChild(pics);
    const lab = document.createElement('span'); lab.textContent = `${s.name} ${s.pw}×${s.ph}`; cell.appendChild(lab);
    grid.appendChild(cell);
  }
}
{
  const c = $('#atlasCv');
  const k = Math.min(1, 1400 / A.size);
  c.width = A.size * k; c.height = A.size * k;
  const x = c.getContext('2d');
  x.fillStyle = '#6b5238'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(AC, 0, 0, c.width, c.height);
}

// ---------- loop (also steppable manually: background tabs get no rAF) ----------
let last = performance.now();
function step(dt = 1 / 30) {
  TIME += dt;
  for (const S of SCENES) {
    if (S.cv.closest('section').style.display === 'none') continue;
    try { frameScene(S, TIME); } catch (e) { console.error(e); $('#stats').textContent += ' · ERROR ' + e.message; throw e; }
  }
}
window.step = step;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try { step(dt); } catch (e) { return; }
  requestAnimationFrame(loop);
}
step(0);
requestAnimationFrame(loop);
for (const id of ['zoom', 'night', 'hour', 'open', 'grid', 'anim']) $('#' + id).addEventListener('input', () => step(0));

// snapshot helper for iteration with a dev server that accepts POST /__save (harmless elsewhere)
window.snap = async (cvId, name, crop) => {
  let c = typeof cvId === 'string' ? $('#' + cvId) : cvId;
  if (crop) {
    const [x, y, w, h] = crop;
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    t.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h); c = t;
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return (await fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body: blob })).status;
};
