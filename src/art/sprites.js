// Procedural sprite art, drawn with Canvas2D at PPU pixels per tile, packed into one atlas.
// CONTRACT (used by worldgen/compose/game): sprite names listed in README_ART section of docs/ARCHITECTURE.md.
// PLACEHOLDER quality — to be replaced by the art pass.

import { Atlas } from '../engine/atlas.js';
import { mulberry32 } from '../engine/noise.js';

export const PPU = 64;
const OUT = '#1e1a16';

function mk(wTiles, hTiles) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(wTiles * PPU); c.height = Math.ceil(hTiles * PPU);
  const g = c.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  return [c, g];
}
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r * k)); gg = Math.max(0, Math.min(255, gg * k)); b = Math.max(0, Math.min(255, b * k));
  return `rgb(${r | 0},${gg | 0},${b | 0})`;
};
function blob(g, x, y, rx, ry, fill, stroke = OUT, lw = 3) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill; g.fill();
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}
function radial(g, x, y, r, inner, outer) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

function canopy(g, cx, cy, R, col, rand, lumps = 7) {
  // dark under-layer, mid, highlight lumps, then outline around union
  const pts = [];
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rand() * 0.5;
    const d = R * (0.45 + rand() * 0.25);
    pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, R * (0.42 + rand() * 0.18)]);
  }
  pts.push([cx, cy, R * 0.6]);
  g.save();
  g.lineWidth = 6; g.strokeStyle = OUT;
  for (const [x, y, r] of pts) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
  for (const [x, y, r] of pts) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = shade(col, 0.75); g.fill(); }
  for (const [x, y, r] of pts) { g.beginPath(); g.arc(x - r * 0.12, y - r * 0.15, r * 0.82, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
  for (const [x, y, r] of pts) { g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.38, 0, Math.PI * 2); g.fillStyle = shade(col, 1.22); g.fill(); }
  g.restore();
}

function drawTree(kind, seed) {
  const rand = mulberry32(seed);
  if (kind === 'pine') {
    const [c, g] = mk(2, 3);
    const cx = c.width / 2, base = c.height - 10;
    g.fillStyle = '#5a3d27'; g.strokeStyle = OUT; g.lineWidth = 3;
    g.fillRect(cx - 6, base - 30, 12, 30); g.strokeRect(cx - 6, base - 30, 12, 30);
    const col = ['#2f5a3a', '#355f3c', '#2b5236'][seed % 3];
    for (let k = 0; k < 4; k++) {
      const yb = base - 22 - k * 34, w = 52 - k * 10;
      g.beginPath(); g.moveTo(cx - w, yb); g.lineTo(cx, yb - 62); g.lineTo(cx + w, yb); g.closePath();
      g.fillStyle = shade(col, 0.85 + k * 0.08); g.fill(); g.lineWidth = 4; g.stroke();
    }
    return c;
  }
  const [c, g] = mk(2.4, 3);
  const cx = c.width / 2, base = c.height - 8;
  const trunk = kind === 'birch' ? '#d9d4c8' : '#5e4129';
  g.fillStyle = trunk; g.strokeStyle = OUT; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx - 8, base); g.lineTo(cx - 5, base - 70); g.lineTo(cx + 5, base - 70); g.lineTo(cx + 8, base); g.closePath(); g.fill(); g.stroke();
  if (kind === 'dead') {
    g.lineWidth = 7; g.strokeStyle = OUT;
    const br = [[-30, -110], [25, -120], [-10, -140], [35, -95]];
    for (const [dx, dy] of br) { g.beginPath(); g.moveTo(cx, base - 60); g.lineTo(cx + dx, base + dy); g.stroke(); }
    g.lineWidth = 4; g.strokeStyle = '#6b5440';
    for (const [dx, dy] of br) { g.beginPath(); g.moveTo(cx, base - 60); g.lineTo(cx + dx, base + dy); g.stroke(); }
    return c;
  }
  const col = kind === 'birch' ? ['#7a9a45', '#86a34b'][seed % 2] : ['#4f7a35', '#557f38', '#4a7032'][seed % 3];
  canopy(g, cx, base - 115, 58, col, rand, 8);
  return c;
}

export function buildAtlas() {
  const A = new Atlas();
  const add = (name, c, ax = 0.5, ay = 1) => A.add(name, c, ax, ay, PPU);

  // ---------- fx ----------
  { const [c, g] = mk(1, 0.5); radial(g, c.width / 2, c.height / 2, c.width / 2, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
    // squash to ellipse
    const [c2, g2] = mk(1, 0.5); g2.drawImage(c, 0, 0); add('fx_blob', c2, 0.5, 0.5); }
  { const [c, g] = mk(0.5, 0.5); radial(g, 16, 16, 16, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'); add('fx_soft', c, 0.5, 0.5); }
  { const [c, g] = mk(0.25, 0.25); radial(g, 8, 8, 8, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'); add('fx_spark', c, 0.5, 0.5); }
  { const [c, g] = mk(1, 1); radial(g, 32, 32, 32, 'rgba(200,200,200,0.7)', 'rgba(200,200,200,0)'); add('fx_smoke', c, 0.5, 0.5); }
  { const [c, g] = mk(0.25, 0.25); blob(g, 8, 8, 6, 3.5, '#7a9a3a', null); add('fx_leaf', c, 0.5, 0.5); }
  { const [c, g] = mk(0.0625, 0.5); g.fillStyle = 'rgba(200,220,255,0.8)'; g.fillRect(1, 0, 2, 32); add('fx_drop', c, 0.5, 1); }
  { const [c, g] = mk(1, 1); g.strokeStyle = 'white'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.stroke(); add('fx_ring', c, 0.5, 0.5); }
  { const [c, g] = mk(0.5, 0.75);
    const gr = g.createRadialGradient(16, 34, 2, 16, 30, 22);
    gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.4, 'rgba(255,150,40,0.9)'); gr.addColorStop(1, 'rgba(200,40,0,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(16, 0); g.quadraticCurveTo(32, 30, 16, 48); g.quadraticCurveTo(0, 30, 16, 0); g.fill();
    add('fx_flame', c, 0.5, 1); }

  // ---------- vegetation ----------
  for (let i = 0; i < 3; i++) add('tree_oak_' + i, drawTree('oak', i), 0.5, 0.97);
  for (let i = 0; i < 3; i++) add('tree_pine_' + i, drawTree('pine', i), 0.5, 0.97);
  for (let i = 0; i < 2; i++) add('tree_birch_' + i, drawTree('birch', i), 0.5, 0.97);
  add('tree_dead_0', drawTree('dead', 0), 0.5, 0.97);
  { const [c, g] = mk(0.7, 0.5); blob(g, 22, 18, 16, 9, '#6b4a2e'); blob(g, 22, 15, 12, 6, '#a07a52', OUT, 2); add('tree_stump_0', c, 0.5, 0.8); }
  for (let i = 0; i < 3; i++) {
    const [c, g] = mk(1.1, 0.9); const rand = mulberry32(50 + i);
    canopy(g, c.width / 2, c.height / 2 + 6, 24, ['#4d7334', '#567a3a', '#46682f'][i], rand, 6);
    add('bush_' + i, c, 0.5, 0.9);
  }
  for (const empty of [false, true]) {
    const [c, g] = mk(1.1, 0.9); const rand = mulberry32(77);
    canopy(g, c.width / 2, c.height / 2 + 6, 24, '#4a6e35', rand, 6);
    if (!empty) for (let k = 0; k < 9; k++) blob(g, 18 + rand() * 34, 18 + rand() * 26, 3.5, 3.5, '#c0283a', OUT, 1.5);
    add(empty ? 'berrybush_empty_0' : 'berrybush_0', c, 0.5, 0.9);
  }
  for (let i = 0; i < 6; i++) {
    const [c, g] = mk(0.6, 0.5); const rand = mulberry32(100 + i);
    const cols = ['#6f8f3a', '#7a9a40', '#647f35', '#86a24a'];
    for (let k = 0; k < 7; k++) {
      const x = 8 + rand() * 22, h = 12 + rand() * 16;
      g.strokeStyle = OUT; g.lineWidth = 4; g.beginPath(); g.moveTo(x, 30); g.quadraticCurveTo(x + (rand() - 0.5) * 10, 30 - h * 0.6, x + (rand() - 0.5) * 14, 30 - h); g.stroke();
    }
    const rand2 = mulberry32(100 + i);
    for (let k = 0; k < 7; k++) {
      const x = 8 + rand2() * 22, h = 12 + rand2() * 16;
      g.strokeStyle = cols[k % 4]; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, 30); g.quadraticCurveTo(x + (rand2() - 0.5) * 10, 30 - h * 0.6, x + (rand2() - 0.5) * 14, 30 - h); g.stroke();
    }
    add('grass_' + i, c, 0.5, 0.95);
  }
  for (let i = 0; i < 3; i++) {
    const [c, g] = mk(0.8, 0.9); const rand = mulberry32(200 + i);
    for (const pass of [0, 1]) {
      const r2 = mulberry32(200 + i);
      for (let k = 0; k < 10; k++) {
        const x = 10 + r2() * 30, h = 26 + r2() * 28;
        g.strokeStyle = pass ? ['#7d9a42', '#8aa64c', '#6e8a3a'][k % 3] : OUT; g.lineWidth = pass ? 2.4 : 4.4;
        g.beginPath(); g.moveTo(x, 56); g.quadraticCurveTo(x + (r2() - 0.5) * 12, 56 - h * 0.6, x + (r2() - 0.5) * 18, 56 - h); g.stroke();
      }
    }
    void rand;
    add('tallgrass_' + i, c, 0.5, 0.95);
  }
  for (let i = 0; i < 3; i++) {
    const [c, g] = mk(0.6, 0.9);
    for (const pass of [0, 1]) {
      const r2 = mulberry32(300 + i);
      for (let k = 0; k < 6; k++) {
        const x = 10 + r2() * 18, h = 30 + r2() * 22;
        g.strokeStyle = pass ? '#8a8a4a' : OUT; g.lineWidth = pass ? 2.2 : 4;
        g.beginPath(); g.moveTo(x, 56); g.lineTo(x + (r2() - 0.5) * 8, 56 - h); g.stroke();
      }
    }
    add('reed_' + i, c, 0.5, 0.95);
  }
  const petal = ['#f0d040', '#e8e8f0', '#c070c8', '#e06040'];
  for (let i = 0; i < 4; i++) {
    const [c, g] = mk(0.5, 0.6);
    g.strokeStyle = '#4f7030'; g.lineWidth = 2; g.beginPath(); g.moveTo(16, 38); g.lineTo(16, 16); g.stroke();
    blob(g, 16, 14, 6, 6, petal[i], OUT, 2); blob(g, 16, 14, 2, 2, '#704020', null);
    add('flower_' + i, c, 0.5, 0.95);
  }
  for (let i = 0; i < 2; i++) {
    const [c, g] = mk(0.4, 0.4);
    g.fillStyle = '#e8dcc8'; g.fillRect(11, 12, 4, 10);
    blob(g, 13, 12, 9, 6, i ? '#b04030' : '#a07850', OUT, 2);
    add('mushroom_' + i, c, 0.5, 0.95);
  }
  for (let i = 0; i < 3; i++) {
    const [c, g] = mk(1.0, 0.8); const rand = mulberry32(400 + i);
    g.beginPath();
    const n = 9, cx = 32, cy = 30;
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const r = 20 + rand() * 7; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.75; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fillStyle = '#7d7871'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = OUT; g.stroke();
    blob(g, cx - 6, cy - 7, 10, 6, '#9b968e', null);
    add('boulder_' + i, c, 0.5, 0.85);
  }

  // ---------- pawn (tinted at runtime: body by shirt color, head by skin, hair by hair color) ----------
  for (const dir of ['s', 'n', 'e']) {
    const [c, g] = mk(0.9, 0.9);
    const cx = c.width / 2;
    g.beginPath();
    if (dir === 'e') g.ellipse(cx, 36, 13, 19, 0, 0, Math.PI * 2);
    else g.ellipse(cx, 36, 18, 19, 0, 0, Math.PI * 2);
    g.fillStyle = '#e6e6e6'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = OUT; g.stroke();
    blob(g, cx - 4, 30, 8, 8, 'rgba(255,255,255,0.5)', null);
    add('pawn_body_' + dir, c, 0.5, 0.95);

    const [h, hg] = mk(0.7, 0.7);
    const hx = h.width / 2;
    blob(hg, hx, 24, dir === 'e' ? 14 : 15, 16, '#f0f0f0', OUT, 3.5);
    if (dir === 's') { blob(hg, hx - 5, 26, 1.8, 2.2, '#2a2220', null); blob(hg, hx + 5, 26, 1.8, 2.2, '#2a2220', null); }
    if (dir === 'e') blob(hg, hx + 7, 26, 1.8, 2.2, '#2a2220', null);
    add('pawn_head_' + dir, h, 0.5, 0.85);

    const [hr, hrg] = mk(0.7, 0.7);
    hrg.beginPath();
    if (dir === 'n') hrg.ellipse(hx, 22, 16, 15, 0, 0, Math.PI * 2);
    else if (dir === 's') { hrg.ellipse(hx, 15, 16, 10, 0, Math.PI, Math.PI * 2); }
    else { hrg.ellipse(hx - 3, 18, 15, 12, -0.3, Math.PI * 0.8, Math.PI * 2.1); }
    hrg.fillStyle = '#e0e0e0'; hrg.fill(); hrg.lineWidth = 3; hrg.strokeStyle = OUT; hrg.stroke();
    add('hair_short_' + dir, hr, 0.5, 0.85);
  }
  // weapons/tools: drawn pointing UP, anchor at grip
  { const [c, g] = mk(0.25, 0.9); g.fillStyle = '#c8ccd4'; g.strokeStyle = OUT; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(8, 2); g.lineTo(12, 10); g.lineTo(12, 44); g.lineTo(4, 44); g.lineTo(4, 10); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6b4a2e'; g.fillRect(2, 44, 12, 4); g.strokeRect(2, 44, 12, 4); g.fillRect(6, 48, 4, 8);
    add('weapon_sword', c, 0.5, 0.85); }
  { const [c, g] = mk(0.5, 0.9); g.fillStyle = '#6b4a2e'; g.strokeStyle = OUT; g.lineWidth = 2.5;
    g.fillRect(14, 6, 5, 50); g.strokeRect(14, 6, 5, 50);
    g.fillStyle = '#b8bcc4'; g.beginPath(); g.moveTo(18, 6); g.quadraticCurveTo(32, 10, 30, 24); g.lineTo(18, 20); g.closePath(); g.fill(); g.stroke();
    add('weapon_axe', c, 0.35, 0.85); }
  { const [c, g] = mk(0.6, 0.9); g.fillStyle = '#6b4a2e'; g.strokeStyle = OUT; g.lineWidth = 2.5;
    g.fillRect(17, 8, 5, 48); g.strokeRect(17, 8, 5, 48);
    g.fillStyle = '#9ea2aa'; g.beginPath(); g.moveTo(2, 14); g.quadraticCurveTo(20, 0, 37, 14); g.quadraticCurveTo(20, 6, 2, 14); g.fill(); g.stroke();
    add('tool_pickaxe', c, 0.5, 0.85); }

  // ---------- animals ----------
  const animal = (name, col, len, hgt) => {
    for (const dir of ['s', 'n', 'e']) {
      const [c, g] = mk(len + 0.3, hgt + 0.3);
      const cx = c.width / 2, cy = c.height * 0.6;
      if (dir === 'e') {
        blob(g, cx - 4, cy, len * PPU * 0.38, hgt * PPU * 0.3, col);
        blob(g, cx + len * PPU * 0.33, cy - hgt * PPU * 0.18, hgt * PPU * 0.22, hgt * PPU * 0.2, shade(col, 1.08));
        blob(g, cx + len * PPU * 0.42, cy - hgt * PPU * 0.1, 3, 3, '#201814', null);
      } else {
        blob(g, cx, cy, hgt * PPU * 0.28, len * PPU * 0.33, col);
        if (dir === 's') blob(g, cx, cy + len * PPU * 0.2, hgt * PPU * 0.22, hgt * PPU * 0.2, shade(col, 1.08));
      }
      add(`${name}_${dir}`, c, 0.5, 0.85);
    }
  };
  animal('wolf', '#8a8580', 1.1, 0.7);
  animal('boar', '#6e5444', 1.0, 0.65);
  animal('deer', '#a87a4e', 1.2, 0.8);
  animal('rabbit', '#b5a48e', 0.5, 0.4);

  // ---------- buildings & items ----------
  { const [c, g] = mk(1, 0.7);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; blob(g, 32 + Math.cos(a) * 20, 28 + Math.sin(a) * 12, 7, 5, '#7f7a72', OUT, 2.5); }
    g.strokeStyle = OUT; g.lineWidth = 6; g.beginPath(); g.moveTo(18, 34); g.lineTo(46, 22); g.moveTo(18, 22); g.lineTo(46, 34); g.stroke();
    g.strokeStyle = '#5e4129'; g.lineWidth = 4; g.beginPath(); g.moveTo(18, 34); g.lineTo(46, 22); g.moveTo(18, 22); g.lineTo(46, 34); g.stroke();
    add('campfire', c, 0.5, 0.65); }
  { const [c, g] = mk(0.3, 0.9); g.fillStyle = '#5e4129'; g.strokeStyle = OUT; g.lineWidth = 2.5; g.fillRect(7, 14, 5, 42); g.strokeRect(7, 14, 5, 42);
    blob(g, 9.5, 14, 5, 4, '#3a2a1c', OUT, 2); add('torch', c, 0.5, 0.95); }
  { const [c, g] = mk(1, 1.4); g.fillStyle = '#8a6440'; g.strokeStyle = OUT; g.lineWidth = 3; g.fillRect(2, 20, 60, 66); g.strokeRect(2, 20, 60, 66);
    g.fillStyle = '#a57a50'; g.fillRect(2, 20, 60, 14); g.strokeRect(2, 20, 60, 14);
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(2 + k * 15, 34); g.lineTo(2 + k * 15, 86); g.stroke(); }
    add('wall_wood', c, 0.5, 0.97); }
  const item = (name, fn) => { const [c, g] = mk(0.5, 0.5); fn(g); add(name, c, 0.5, 0.8); };
  item('item_wood', (g) => { for (let k = 0; k < 3; k++) { g.fillStyle = '#7a5434'; g.strokeStyle = OUT; g.lineWidth = 2; g.fillRect(4, 8 + k * 7, 24, 6); g.strokeRect(4, 8 + k * 7, 24, 6); } });
  item('item_stone', (g) => { blob(g, 12, 20, 8, 6, '#8a857e'); blob(g, 21, 17, 7, 6, '#7a756e'); });
  item('item_berries', (g) => { for (let k = 0; k < 5; k++) blob(g, 10 + (k % 3) * 6, 14 + Math.floor(k / 3) * 7, 4, 4, '#c0283a', OUT, 1.5); });
  item('item_meat', (g) => { blob(g, 16, 18, 11, 8, '#b04848'); blob(g, 13, 15, 4, 3, '#e8b0a0', null); });
  item('item_cooked', (g) => { blob(g, 16, 18, 11, 8, '#8a4a28'); });
  item('item_leather', (g) => { blob(g, 16, 18, 12, 8, '#8a6444'); });

  A.pack();
  return A;
}
