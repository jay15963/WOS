// Item icons (Art B): item_<id> for every item in docs/CONTENT.md §2 that buildings.js doesn't already paint
// (legacy item_wood/stone/berries/meat/cooked/leather/fiber/ore stay there). Same framing as the legacy icons:
// fixed 36×36 box, uncropped, anchor (0.5, 0.82), content scaled 0.9 around the center, ~2.3 px outline.
// Tools, weapons, shields and apparel reuse the exact held/wear painters (gear.js, apparel.js).

import { spritePxFast as spritePx, rng, TAU, lin, rad, circle, mixc, rgb, hex, smoothClosed, blobPts, leaf } from './paint.js';
import { spline, rrect } from './kit.js';
import { GEAR, MAT } from './gear.js';
import { WEAR } from './apparel.js';
import { HX, HY } from './pawns.js';

const A = (c, a) => rgb(hex(c), a);
const OWI = 2.3;

// box painter: layers = [fn(g, rand)...] each outlined separately
function box(layers, ow = OWI, seed = 1) {
  return spritePx(36, 36, (g, P) => {
    const rand = rng(seed);
    for (const fn of layers) P.layer((g) => { g.translate(18, 18); g.scale(0.9, 0.9); g.translate(-18, -18); fn(g, rand); }, ow);
  }, { crop: false });
}

// ---------- shared shapes ----------
function rock(g, x, y, rx, ry, rand, col, dark) {
  const pts = blobPts(x, y, rx, ry, rand, 8, 0.16);
  g.beginPath(); smoothClosed(g, pts); g.fillStyle = dark || mixc(col, '#2e2a26', 0.4); g.fill();
  g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
  g.fillStyle = col; g.beginPath(); g.ellipse(x - rx * 0.15, y - ry * 0.2, rx * 0.85, ry * 0.75, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,250,235,0.35)'; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.42, ry * 0.26, -0.3, 0, TAU); g.fill();
  g.restore();
  return pts;
}
function nugget(g, x, y, r, c0, c1, c2) {
  g.fillStyle = c0; g.beginPath(); g.moveTo(x - r, y); g.lineTo(x - r * 0.3, y - r * 0.95); g.lineTo(x + r * 0.8, y - r * 0.5); g.lineTo(x + r, y + r * 0.4); g.lineTo(x + r * 0.1, y + r); g.lineTo(x - r * 0.8, y + r * 0.6); g.closePath(); g.fill();
  g.fillStyle = c1; g.beginPath(); g.moveTo(x - r * 0.8, y - r * 0.1); g.lineTo(x - r * 0.25, y - r * 0.8); g.lineTo(x + r * 0.5, y - r * 0.4); g.lineTo(x, y + r * 0.1); g.closePath(); g.fill();
  g.fillStyle = c2; g.beginPath(); circle(g, x - r * 0.35, y - r * 0.45, r * 0.25); g.fill();
}
function ingot(g, x, y, w, h, M, shine) {
  // trapezoid bar in 3/4 view: top face, front face, end face
  const t = h * 0.55;
  g.fillStyle = lin(g, x, y - t, x, y, [[0, M.light], [1, M.base]]);
  g.beginPath(); g.moveTo(x - w / 2 + 3, y - t); g.lineTo(x + w / 2 - 3, y - t); g.lineTo(x + w / 2, y); g.lineTo(x - w / 2, y); g.closePath(); g.fill();
  g.fillStyle = lin(g, x, y, x, y + h, [[0, M.base], [1, M.dark]]);
  g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x + w / 2, y); g.lineTo(x + w / 2 - 1.5, y + h); g.lineTo(x - w / 2 + 1.5, y + h); g.closePath(); g.fill();
  g.strokeStyle = A(M.edge || '#fff', 0.8); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - w / 2 + 3.4, y - t + 0.6); g.lineTo(x + w / 2 - 3.4, y - t + 0.6); g.stroke();
  g.strokeStyle = A(M.dark, 0.7); g.lineWidth = 0.6; g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x + w / 2, y); g.stroke();
  if (shine) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.moveTo(x - 2, y - t + 1); g.lineTo(x + 1, y - t + 1); g.lineTo(x - 3, y - 0.6); g.lineTo(x - 6, y - 0.6); g.closePath(); g.fill(); }
  if (M.patina) { g.fillStyle = A(M.patina, 0.6); g.beginPath(); circle(g, x + w * 0.3, y + h * 0.6, 0.9); circle(g, x - w * 0.25, y + h * 0.35, 0.7); g.fill(); }
}
function steam(g, x, y) {
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.2; g.lineCap = 'round';
  for (const dx of [-3, 2]) { g.beginPath(); g.moveTo(x + dx, y); g.bezierCurveTo(x + dx - 2, y - 3, x + dx + 2, y - 5, x + dx, y - 8); g.stroke(); }
}
function potatoShape(g, x, y, rx, ry, rot, col, rand) {
  g.save(); g.translate(x, y); g.rotate(rot);
  const pts = blobPts(0, 0, rx, ry, rand, 9, 0.1);
  g.beginPath(); smoothClosed(g, pts); g.fillStyle = col; g.fill();
  g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
  g.fillStyle = 'rgba(70,40,18,0.35)'; g.beginPath(); g.ellipse(rx * 0.3, ry * 0.4, rx * 0.9, ry * 0.6, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,240,200,0.35)'; g.beginPath(); g.ellipse(-rx * 0.35, -ry * 0.4, rx * 0.4, ry * 0.25, -0.3, 0, TAU); g.fill();
  g.fillStyle = 'rgba(70,40,18,0.7)'; for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse((rand() - 0.5) * rx * 1.3, (rand() - 0.5) * ry * 1.2, 0.8, 0.5, rand() * 3, 0, TAU); g.fill(); }
  g.restore(); g.restore();
}
function sack(g, col, colD) {
  g.fillStyle = lin(g, 8, 10, 28, 32, [[0, mixc(col, '#fff', 0.2)], [1, colD]]);
  g.beginPath(); spline(g, [[11, 14], [18, 12], [25, 14], [28, 22], [27, 30], [18, 32], [9, 30], [8, 22]]); g.fill();
  g.fillStyle = mixc(col, '#fff', 0.1); g.beginPath(); spline(g, [[13, 14], [15, 8], [18, 10.5], [21, 8], [23, 14]]); g.fill();
  g.strokeStyle = '#7a3a26'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(12, 14.2); g.quadraticCurveTo(18, 16, 24, 14.2); g.stroke();
  g.strokeStyle = A(colD, 0.6); g.lineWidth = 0.7; g.beginPath(); g.moveTo(13, 20); g.quadraticCurveTo(16, 26, 14, 30); g.moveTo(22, 19); g.quadraticCurveTo(24, 25, 23, 30); g.stroke();
}

// ---------- materials, food, seeds ----------
const ITEMS = {
  item_pebble: [(g, r) => { rock(g, 12, 23, 5.5, 4.2, r, '#9a948b'); rock(g, 23, 24, 6.5, 4.6, r, '#8c857b'); rock(g, 18, 16, 4.4, 3.4, r, '#a9a399'); }],
  item_stick: [(g, r) => {
    const twig = (x0, y0, x1, y1, w) => { g.strokeStyle = '#5a3c22'; g.lineWidth = w + 1.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = '#9a7048'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = 'rgba(255,230,190,0.5)'; g.lineWidth = w * 0.3; g.beginPath(); g.moveTo(x0 - 0.5, y0 - 0.5); g.lineTo(x1 - 0.5, y1 - 0.5); g.stroke(); };
    twig(7, 29, 29, 8, 3.2); twig(20, 17, 27, 20, 2); twig(13, 24, 11, 15, 1.8);
    g.fillStyle = '#6f9a3c'; g.beginPath(); leaf(g, 27, 20, 32, 15, 2.6, 0.5); g.fill();
    g.fillStyle = '#d8bf8f'; g.beginPath(); g.ellipse(29, 8, 1.6, 1.4, 0.7, 0, TAU); g.fill();
  }],
  item_stone_block: [(g) => {
    g.fillStyle = lin(g, 0, 9, 0, 17, [[0, '#d6d1c8'], [1, '#b7b1a6']]);
    g.beginPath(); g.moveTo(8, 15); g.lineTo(14, 9); g.lineTo(30, 9); g.lineTo(26, 15); g.closePath(); g.fill();
    g.fillStyle = lin(g, 8, 15, 8, 30, [[0, '#a8a296'], [1, '#7d776d']]); g.fillRect(8, 15, 18, 14);
    g.fillStyle = lin(g, 26, 15, 30, 15, [[0, '#8d877c'], [1, '#6a645b']]); g.beginPath(); g.moveTo(26, 15); g.lineTo(30, 9); g.lineTo(30, 23); g.lineTo(26, 29); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,55,48,0.5)'; g.lineWidth = 0.7;
    for (const [x, y] of [[11, 18], [15, 22], [20, 19], [12, 26], [22, 25]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2.4, y + 0.8); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(9, 15); g.lineTo(26, 15); g.stroke();
  }],
  item_rope: [(g) => {
    g.lineCap = 'round';
    const coil = (r, w) => { g.strokeStyle = '#6e5228'; g.lineWidth = w + 1.4; g.beginPath(); g.ellipse(18, 20, r, r * 0.72, 0, 0, TAU); g.stroke(); g.strokeStyle = '#c9a466'; g.lineWidth = w; g.beginPath(); g.ellipse(18, 20, r, r * 0.72, 0, 0, TAU); g.stroke(); g.strokeStyle = 'rgba(90,64,28,0.7)'; g.lineWidth = 0.7; for (let a = 0; a < TAU; a += 0.42) { const x = 18 + Math.cos(a) * r, y = 20 + Math.sin(a) * r * 0.72; g.beginPath(); g.moveTo(x - 1, y - 1); g.lineTo(x + 1, y + 1); g.stroke(); } };
    coil(12, 3.2); coil(8, 3.2); coil(4, 3);
    g.strokeStyle = '#c9a466'; g.lineWidth = 3; g.beginPath(); g.moveTo(28, 24); g.quadraticCurveTo(32, 30, 27, 32); g.stroke();
    g.fillStyle = '#e0c48a'; g.beginPath(); circle(g, 27, 32, 1.8); g.fill();
  }],
  item_cotton: [(g) => {
    for (const [x, y, s] of [[12, 19, 1], [23, 17, 1.05], [18, 25, 0.95]]) {
      g.fillStyle = '#7a5030'; g.beginPath(); for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; g.moveTo(x, y + 2); g.lineTo(x + Math.cos(a) * 6 * s, y + 2 + Math.sin(a) * 4 * s); g.lineTo(x + Math.cos(a + 0.6) * 4 * s, y + 2 + Math.sin(a + 0.6) * 3 * s); g.closePath(); } g.fill();
      for (const [dx, dy, r] of [[-2.4, 0, 3.4], [2.4, 0, 3.4], [0, -2.4, 3.6], [0, 1.6, 3.2]]) { g.fillStyle = '#e8e4da'; g.beginPath(); circle(g, x + dx * s, y + dy * s, r * s); g.fill(); }
      g.fillStyle = '#ffffff'; g.beginPath(); circle(g, x - 1.4 * s, y - 2.6 * s, 1.6 * s); g.fill();
    }
  }],
  item_cloth: [(g) => {
    for (let i = 0; i < 3; i++) {
      const y = 25 - i * 5.5;
      g.fillStyle = lin(g, 0, y - 4, 0, y + 4, [[0, i === 2 ? '#efe5cf' : '#e0d3b4'], [1, '#b7a57e']]);
      g.beginPath(); rrect(g, 7 + i * 0.8, y - 4, 22 - i * 1.6, 7, 2.4); g.fill();
      g.strokeStyle = 'rgba(120,100,70,0.6)'; g.lineWidth = 0.7; g.setLineDash([1.2, 1.2]); g.beginPath(); g.moveTo(9 + i, y + 1.5); g.lineTo(27 - i, y + 1.5); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = '#8a3a2a'; g.fillRect(16.5, 8, 3, 21);
  }],
  item_copper_ore: [(g, r) => { rock(g, 18, 20, 12, 9.5, r, '#6c665f'); for (const [x, y, s] of [[13, 18, 3], [21, 15.5, 2.6], [20, 24, 2.8], [26, 21, 1.8]]) nugget(g, x, y, s, '#a4532a', '#e88e4e', '#ffd2a0'); g.strokeStyle = 'rgba(70,170,140,0.85)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(9, 22); g.quadraticCurveTo(13, 25, 16, 23.5); g.moveTo(23, 12.5); g.quadraticCurveTo(26, 15, 28, 15); g.stroke(); }],
  item_iron_ore: [(g, r) => { rock(g, 18, 20, 12, 9.5, r, '#8a5a40', '#4e3022'); for (const [x, y, s] of [[13, 19, 2.6], [21, 16, 2.2], [19, 24, 2.4], [25, 21, 1.7]]) nugget(g, x, y, s, '#3e3c3c', '#77777c', '#c8ccd2'); g.fillStyle = 'rgba(190,90,50,0.6)'; g.beginPath(); circle(g, 26, 16, 1.4); circle(g, 11, 24, 1.2); g.fill(); }],
  item_coal: [(g, r) => {
    for (const [x, y, rx, ry] of [[13, 22, 7, 5.5], [23, 21, 6.5, 5.5], [18, 15, 6, 4.6]]) {
      const pts = blobPts(x, y, rx, ry, r, 6, 0.2);
      g.fillStyle = '#17161a'; g.beginPath(); smoothClosed(g, pts); g.fill();
      g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
      g.fillStyle = '#2c2b33'; g.beginPath(); g.moveTo(x - rx, y); g.lineTo(x - rx * 0.2, y - ry); g.lineTo(x + rx * 0.3, y - ry * 0.2); g.lineTo(x - rx * 0.1, y + ry * 0.4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(200,215,255,0.85)'; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.3, ry * 0.12, -0.5, 0, TAU); g.fill();
      g.fillStyle = 'rgba(140,160,220,0.35)'; g.beginPath(); g.ellipse(x + rx * 0.2, y + ry * 0.1, rx * 0.4, ry * 0.15, 0.3, 0, TAU); g.fill();
      g.restore();
    }
  }],
  item_gold_ore: [(g, r) => { rock(g, 18, 20, 12, 9.5, r, '#7a756d'); for (const [x, y, s] of [[13, 18.5, 2.8], [21, 16, 2.4], [20, 24, 2.6], [25.5, 21, 1.8]]) nugget(g, x, y, s, '#b8861c', '#ffd84a', '#fffbe0'); g.fillStyle = '#ffffff'; g.beginPath(); for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; g.moveTo(12, 14.5); g.lineTo(12 + Math.cos(a) * 3, 14.5 + Math.sin(a) * 3); } g.lineWidth = 0.9; g.strokeStyle = '#fff'; g.stroke(); }],
  item_jade: [(g) => {
    const pts = [[11, 21], [14, 12], [22, 9], [28, 15], [27, 24], [19, 30], [12, 27]];
    g.fillStyle = '#2f7a4e'; g.beginPath(); spline(g, pts, true, 0.4); g.fill();
    g.save(); g.beginPath(); spline(g, pts, true, 0.4); g.clip();
    g.fillStyle = rad(g, 16, 15, 1, 16, [[0, '#a8f0c0'], [0.5, '#4fb37a'], [1, '#1e5a38']]); g.fillRect(0, 0, 36, 36);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(14, 12.5); g.lineTo(22, 9.5); g.lineTo(19, 15); g.lineTo(13, 19); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(20,70,40,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(19, 15); g.lineTo(27, 24); g.moveTo(19, 15); g.lineTo(18, 29.5); g.stroke();
    g.restore();
    g.fillStyle = '#ffffff'; g.beginPath(); circle(g, 15.5, 13.2, 1.1); g.fill();
  }],
  item_copper_bar: [(g) => { ingot(g, 18, 22, 20, 6, MAT.copper, false); ingot(g, 18, 15, 18, 5.5, MAT.copper, true); }],
  item_iron_bar: [(g) => { ingot(g, 18, 22, 20, 6, MAT.iron, false); ingot(g, 18, 15, 18, 5.5, MAT.iron, true); }],
  item_steel_bar: [(g) => { ingot(g, 18, 22, 20, 6, MAT.steel, true); ingot(g, 18, 15, 18, 5.5, MAT.steel, true); }],
  item_gold_bar: [(g) => { const G = { base: '#e0a92a', light: '#fff0a0', dark: '#8a5a10', edge: '#fffbe0' }; ingot(g, 18, 22, 20, 6, G, false); ingot(g, 18, 15, 18, 5.5, G, true); }],
  item_arrow: [(g) => {
    for (const [dy, c] of [[-4, '#b8402e'], [0, '#3a6ab0'], [4, '#e8e2d6']]) {
      g.save(); g.translate(18, 18 + dy); g.rotate(-0.78);
      g.fillStyle = '#c49a62'; g.fillRect(-13, -0.8, 24, 1.6);
      g.fillStyle = '#7a7d82'; g.beginPath(); g.moveTo(11, -2.6); g.lineTo(16, 0); g.lineTo(11, 2.6); g.closePath(); g.fill();
      g.fillStyle = c; g.beginPath(); g.moveTo(-14, 0); g.lineTo(-9, -3.2); g.lineTo(-6, -0.6); g.lineTo(-6, 0.6); g.lineTo(-9, 3.2); g.closePath(); g.fill();
      g.restore();
    }
  }],
  item_bandage: [(g) => {
    g.fillStyle = lin(g, 8, 20, 30, 30, [[0, '#ffffff'], [1, '#cfc7b4']]);
    g.beginPath(); g.moveTo(17, 24); g.bezierCurveTo(22, 28, 27, 27, 32, 31); g.lineTo(30, 34); g.bezierCurveTo(25, 30, 20, 31, 15, 28); g.closePath(); g.fill();
    g.fillStyle = lin(g, 6, 8, 26, 30, [[0, '#ffffff'], [0.6, '#e6dfcf'], [1, '#b0a790']]);
    g.beginPath(); g.ellipse(16, 18, 9.5, 10.5, 0, 0, TAU); g.fill();
    g.fillStyle = '#d8d0bd'; g.beginPath(); g.ellipse(16, 18, 4.2, 4.8, 0, 0, TAU); g.fill();
    g.fillStyle = '#b5ab94'; g.beginPath(); g.ellipse(16, 18, 1.8, 2.1, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,140,120,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(16, 18, 7, 8, 0, 0, TAU); g.stroke();
    g.fillStyle = '#d0302a'; g.fillRect(25, 5, 4, 11); g.fillRect(21.5, 8.5, 11, 4);
  }],
  item_seed_potato: [(g) => sack(g, '#b8986a', '#7a5a34'), (g, r) => { potatoShape(g, 25, 27, 4.6, 3.6, 0.3, '#b98a52', r); g.fillStyle = '#7fae46'; g.beginPath(); leaf(g, 25, 24, 28, 19, 1.6, 0.3); g.fill(); }],
  item_seed_cotton: [(g) => sack(g, '#c9b79a', '#8a7556'), (g) => { for (const [x, y] of [[24, 27], [28, 29], [21, 30]]) { g.fillStyle = '#5a3a22'; g.beginPath(); g.ellipse(x, y, 2, 1.4, 0.4, 0, TAU); g.fill(); g.fillStyle = '#f2efe8'; g.beginPath(); circle(g, x - 0.6, y - 1.4, 1.6); g.fill(); } }],
  item_seed_corn: [(g) => sack(g, '#a8a070', '#6e6838'), (g) => { for (const [x, y] of [[23, 28], [27, 26.5], [26, 30.5], [21, 31]]) { g.fillStyle = '#e8b830'; g.beginPath(); g.moveTo(x - 1.6, y - 1.2); g.lineTo(x + 1.6, y - 1.2); g.lineTo(x + 1, y + 1.8); g.lineTo(x - 1, y + 1.8); g.closePath(); g.fill(); g.fillStyle = '#fff0a0'; g.fillRect(x - 0.9, y - 0.9, 1, 1); } }],
  item_potato: [(g, r) => { potatoShape(g, 14, 21, 7.5, 5.8, -0.3, '#b98a52', r); potatoShape(g, 23.5, 20, 6, 4.8, 0.5, '#a97a46', r); }],
  item_baked_potato: [(g, r) => {
    potatoShape(g, 18, 22, 11, 7, 0, '#8a5a30', r);
    g.fillStyle = '#f2d98a'; g.beginPath(); g.ellipse(18, 20, 7, 3.4, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffe9a6'; g.beginPath(); g.ellipse(16.5, 19.4, 3.6, 1.6, 0, 0, TAU); g.fill();
    g.fillStyle = '#fff6c8'; g.beginPath(); rrect(g, 17, 16.5, 4.5, 3, 0.8); g.fill();
  }, (g) => steam(g, 18, 14)],
  item_corn: [(g) => {
    g.save(); g.translate(18, 18); g.rotate(0.6);
    g.fillStyle = '#5f8a34'; g.beginPath(); leaf(g, 0, 12, -7, -10, 4, -1); g.fill(); g.beginPath(); leaf(g, 0, 12, 7, -9, 4, 1); g.fill();
    g.fillStyle = '#e8b830'; g.beginPath(); g.ellipse(0, -1, 5, 11, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffe070';
    for (let y = -10; y < 9; y += 2.6) for (let x = -3.4; x <= 3.4; x += 2.3) { if (Math.hypot(x / 5, (y + 1) / 11) < 0.92) { g.beginPath(); g.ellipse(x, y, 0.9, 1.1, 0, 0, TAU); g.fill(); } }
    g.fillStyle = '#7fae46'; g.beginPath(); leaf(g, 0, 12, -2, 0, 3, -0.5); g.fill();
    g.restore();
  }],
  item_roast_corn: [(g) => {
    g.save(); g.translate(18, 19); g.rotate(0.6);
    g.fillStyle = '#c9952e'; g.beginPath(); g.ellipse(0, -1, 5, 11, 0, 0, TAU); g.fill();
    for (let y = -10; y < 9; y += 2.6) for (let x = -3.4; x <= 3.4; x += 2.3) { if (Math.hypot(x / 5, (y + 1) / 11) < 0.92) { g.fillStyle = (x * 7 + y * 3) % 5 > 2.5 ? '#5a3214' : '#f0c050'; g.beginPath(); g.ellipse(x, y, 0.9, 1.1, 0, 0, TAU); g.fill(); } }
    g.fillStyle = '#8a6a3a'; g.fillRect(-1.2, 9, 2.4, 6);
    g.restore();
  }, (g) => steam(g, 13, 10)],
  item_stew: [(g) => {
    g.fillStyle = lin(g, 6, 18, 30, 30, [[0, '#a06a3a'], [1, '#5a3418']]);
    g.beginPath(); g.moveTo(5, 18); g.quadraticCurveTo(6, 31, 18, 31); g.quadraticCurveTo(30, 31, 31, 18); g.closePath(); g.fill();
    g.fillStyle = '#8a4a22'; g.beginPath(); g.ellipse(18, 18, 13, 4, 0, 0, TAU); g.fill();
    g.fillStyle = '#c26a2a'; g.beginPath(); g.ellipse(18, 18.4, 11.2, 3, 0, 0, TAU); g.fill();
    for (const [x, y, c] of [[13, 18, '#e8b830'], [18, 17.4, '#d84a2a'], [22, 18.6, '#7fae46'], [16, 19.2, '#f0d8b0']]) { g.fillStyle = c; g.beginPath(); circle(g, x, y, 1.4); g.fill(); }
    g.strokeStyle = 'rgba(255,230,190,0.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(8, 21); g.quadraticCurveTo(9, 27, 14, 29); g.stroke();
    g.strokeStyle = '#d8b07a'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(24, 17); g.lineTo(31, 7); g.stroke();
  }, (g) => steam(g, 16, 13)],
};

// gear icons: the held sprite painters, laid diagonally (tip up-right) and fitted to the box
function gearIcon(id) {
  const D = GEAR[id];
  const len = Math.max(D.W, D.H);
  const k = D.type === 'shield' ? 31 / Math.max(D.W, D.H) : Math.min(1.05, 44 / len);
  const rot = D.type === 'shield' ? 0 : D.type === 'bow' ? -Math.PI / 4 : Math.PI / 4;
  return box(D.layers.map((fn) => (g) => {
    g.translate(18, 18); g.rotate(rot); g.scale(k, k); g.translate(-D.W / 2, -D.H / 2);
    fn(g);
    if (D.type === 'torch' && fn === D.layers[D.layers.length - 1]) {
      // painted flame on the tip
      g.fillStyle = 'rgba(255,140,40,0.95)'; g.beginPath(); g.moveTo(D.gx - 5, 6); g.quadraticCurveTo(D.gx - 6, -4, D.gx, -12); g.quadraticCurveTo(D.gx + 6, -4, D.gx + 5, 6); g.closePath(); g.fill();
      g.fillStyle = '#ffe27a'; g.beginPath(); g.moveTo(D.gx - 2.6, 5); g.quadraticCurveTo(D.gx - 3, -1, D.gx, -5); g.quadraticCurveTo(D.gx + 3, -1, D.gx + 2.6, 5); g.closePath(); g.fill();
    }
  }), D.type === 'shield' ? 2.2 : 2);
}
// apparel icons: the wear painters (front view) fitted to the box
function wearIcon(kind, id) {
  const paint = WEAR[kind][id];
  const rand = rng(id.length * 13);
  if (kind === 'body') {
    return box([(g) => {
      g.translate(18, 18); g.scale(0.66, 0.66); g.translate(-28, -30);
      paint(g, 's', rand);
      // neck opening so it reads as a garment
      g.fillStyle = '#2a1e16'; g.beginPath(); g.ellipse(28, 12.5, 7, 3.4, 0, 0, TAU); g.fill();
    }], 2.2);
  }
  return box([(g) => {
    g.translate(18, 18); g.scale(0.64, 0.64); g.translate(-HX, -HY + 2);
    if (id !== 'hat_straw') { g.fillStyle = '#2a1e16'; g.beginPath(); g.ellipse(HX, HY + 4, 13, 14, 0, 0, TAU); g.fill(); }
    paint(g, 's', rand, true);
  }], 2.2);
}

export function addItems(add) {
  let seed = 1;
  for (const k of Object.keys(ITEMS)) add(k, box(ITEMS[k], OWI, seed++), 0.5, 0.82);
  for (const id of Object.keys(GEAR)) {
    if (/_(e|n|draw1?)$/.test(id) || id === 'hammer') continue;
    add('item_' + id, gearIcon(id), 0.5, 0.82);
  }
  for (const id of Object.keys(WEAR.body)) add('item_' + id, wearIcon('body', id), 0.5, 0.82);
  for (const id of Object.keys(WEAR.head)) add('item_' + id, wearIcon('head', id), 0.5, 0.82);
}
