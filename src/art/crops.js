// Crops on farm plots (crop_<kind>_<stage>, stage 0 sprout → 3 ripe) and the plant painters shared with the
// wild versions (natural.js). A crop sprite covers one tile: plants stand on two furrow rows; anchor = the
// tile's bottom edge (o.x = tx + 0.5, o.y = ty + 1), like every 1-tile structure.

import { spritePx, rng, TAU, lin, rad, circle, mixc, leaf, taper } from './paint.js';

const E = 58; // headroom above the tile for tall stages (corn)
const LEAF = ['#4f7a2c', '#5f8c34', '#6f9c3e', '#86b04c'];
const OUTL = 'rgba(26,30,12,0.72)';

function stem(g, x0, y0, x1, y1, w, col = '#5a7a2e', bend = 0) {
  g.fillStyle = col; g.beginPath(); taper(g, x0, y0, (x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1, w, w * 0.55); g.fill();
}
function leafy(g, x, y, ang, len, w, rand, cols = LEAF, vein = true) {
  const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
  g.fillStyle = cols[Math.floor(rand() * cols.length)];
  g.beginPath(); leaf(g, x, y, x1, y1, w, (rand() - 0.5) * w); g.fill();
  if (vein) { g.strokeStyle = 'rgba(30,50,14,0.45)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x1 - x) * 0.8, y + (y1 - y) * 0.8); g.stroke(); }
  // lit edge
  g.fillStyle = 'rgba(230,255,180,0.25)'; g.beginPath(); leaf(g, x, y, x + (x1 - x) * 0.7, y + (y1 - y) * 0.7, w * 0.35, -w * 0.3); g.fill();
}
function mound(g, x, y, r, a = 0.55) {
  g.fillStyle = `rgba(36,24,14,${a})`; g.beginPath(); g.ellipse(x, y + 1, r * 1.2, r * 0.45, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(140,104,70,0.45)'; g.beginPath(); g.ellipse(x - r * 0.2, y - 0.4, r * 0.8, r * 0.25, 0, 0, TAU); g.fill();
}

// ---- plant painters: (g, x, footY, stage 0..3, rand, scale) ----
export function potatoPlant(g, x, y, st, rand, k = 1) {
  if (st === 0) { stem(g, x, y, x, y - 5 * k, 1.6); leafy(g, x, y - 4 * k, -2.4, 5 * k, 2.4 * k, rand); leafy(g, x, y - 4 * k, -0.7, 5 * k, 2.4 * k, rand); return; }
  const n = [0, 6, 9, 11][st];
  const R = [0, 8, 12, 14][st] * k;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i / (n - 1)) - 0.5) * 2.6 + (rand() - 0.5) * 0.3;
    const L = R * (0.7 + rand() * 0.4);
    const sx = x + Math.cos(a) * 2, sy = y - 2;
    stem(g, sx, sy, sx + Math.cos(a) * L * 0.5, sy + Math.sin(a) * L * 0.5, 1.3);
    // compound leaf: 3 leaflets
    const ex = sx + Math.cos(a) * L * 0.5, ey = sy + Math.sin(a) * L * 0.5;
    for (const da of [-0.6, 0, 0.6]) leafy(g, ex, ey, a + da, L * (da ? 0.42 : 0.55), 3 * k, rand);
  }
  if (st === 3) {
    for (let i = 0; i < 4; i++) { // flowers
      const fx = x + (rand() - 0.5) * R * 1.3, fy = y - R * (0.7 + rand() * 0.4);
      for (let p = 0; p < 5; p++) { const a = (p / 5) * TAU; g.fillStyle = i & 1 ? '#efe9f6' : '#c7a6e0'; g.beginPath(); g.ellipse(fx + Math.cos(a) * 1.5, fy + Math.sin(a) * 1.3, 1.3, 0.9, a, 0, TAU); g.fill(); }
      g.fillStyle = '#f2c531'; g.beginPath(); circle(g, fx, fy, 0.8); g.fill();
    }
    for (const dx of [-5, 4]) { // tubers peeking out of the soil
      g.fillStyle = '#b48a52'; g.beginPath(); g.ellipse(x + dx * k, y + 0.5, 3.2 * k, 2.2 * k, 0.2, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,236,190,0.45)'; g.beginPath(); g.ellipse(x + dx * k - 1, y - 0.4, 1.3 * k, 0.8 * k, 0.2, 0, TAU); g.fill();
    }
  }
}
export function cottonPlant(g, x, y, st, rand, k = 1) {
  if (st === 0) { stem(g, x, y, x, y - 6 * k, 1.5); leafy(g, x, y - 5 * k, -2.5, 5 * k, 2.6 * k, rand); leafy(g, x, y - 5.5 * k, -0.6, 5 * k, 2.6 * k, rand); return; }
  const H = [0, 14, 24, 28][st] * k;
  const stemCol = st === 3 ? '#7a5a3a' : '#5a7a2e';
  stem(g, x, y, x + (rand() - 0.5) * 2, y - H, 2.2, stemCol);
  const br = [];
  for (let i = 0; i < 2 + st; i++) {
    const t = 0.35 + (i / (1 + st)) * 0.6, s = i & 1 ? 1 : -1;
    const bx = x, by = y - H * t, ex = bx + s * (5 + rand() * 4) * k, ey = by - (4 + rand() * 4) * k;
    stem(g, bx, by, ex, ey, 1.3, stemCol);
    br.push([ex, ey]);
  }
  const leafCols = st === 3 ? ['#6a7a34', '#7d8a3c', '#8a7a3a'] : ['#4f7a2c', '#5f8c34', '#6f9c3e'];
  for (const [bx, by] of br) for (let j = 0; j < 2; j++) {
    // lobed (maple-like) leaves
    const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
    for (const da of [-0.5, 0, 0.5]) leafy(g, bx, by, a + da, (da ? 4 : 5.2) * k, 2.4 * k, rand, leafCols, false);
  }
  const tips = br.concat([[x, y - H]]);
  if (st === 2) for (const [bx, by] of tips) { // green bolls + cream flowers
    g.fillStyle = '#6e9a3c'; g.beginPath(); circle(g, bx, by - 1.5, 2.4 * k); g.fill();
    if (rand() < 0.5) { g.fillStyle = '#f2e6b8'; g.beginPath(); g.ellipse(bx + 1.5, by - 3.5, 2.2 * k, 1.6 * k, 0.4, 0, TAU); g.fill(); g.fillStyle = '#d97aa0'; g.beginPath(); circle(g, bx + 1.5, by - 3.5, 0.7); g.fill(); }
  }
  if (st === 3) for (const [bx, by] of tips) { // open bolls: brown bracts + fluffy white lint
    g.fillStyle = '#6a4a2a';
    for (let p = 0; p < 4; p++) { const a = (p / 4) * TAU + 0.4; g.beginPath(); g.ellipse(bx + Math.cos(a) * 2.6 * k, by - 2 + Math.sin(a) * 2.2 * k, 1.8 * k, 1 * k, a, 0, TAU); g.fill(); }
    for (let p = 0; p < 4; p++) { const a = (p / 4) * TAU; g.fillStyle = p & 1 ? '#f6f3ea' : '#e7e1d2'; g.beginPath(); circle(g, bx + Math.cos(a) * 1.8 * k, by - 3 + Math.sin(a) * 1.5 * k, 2.4 * k); g.fill(); }
    g.fillStyle = '#ffffff'; g.beginPath(); circle(g, bx - 0.8, by - 4, 1.4 * k); g.fill();
  }
}
export function cornPlant(g, x, y, st, rand, k = 1) {
  if (st === 0) { stem(g, x, y, x, y - 6 * k, 1.6); leafy(g, x, y - 3, -2.2, 7 * k, 2 * k, rand); leafy(g, x, y - 4, -0.9, 7 * k, 2 * k, rand); return; }
  const H = [0, 16, 46, 60][st] * k;
  const lean = (rand() - 0.5) * 4;
  const stalkCol = st === 3 ? '#8a9a44' : '#5f8a34';
  stem(g, x, y, x + lean, y - H, 3.4 * k, stalkCol);
  // long arching blade leaves
  const n = [0, 4, 7, 8][st];
  const cols = st === 3 ? ['#7d9a40', '#91a84c', '#a6b05a', '#6e8c38'] : ['#4f7a2c', '#5f8c34', '#6f9c3e', '#86b04c'];
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (i / n) * 0.75, s = i & 1 ? 1 : -1;
    const bx = x + lean * t, by = y - H * t;
    const L = (st === 1 ? 10 : 16) * k * (1 - t * 0.3);
    const x1 = bx + s * L, y1 = by - L * 0.25, x2 = bx + s * L * 1.25, y2 = by + L * 0.45;
    g.fillStyle = cols[i % cols.length];
    g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(x1, y1 - 3, x2, y2); g.quadraticCurveTo(x1 - s * 2, y1 + 2, bx, by + 2.4); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(230,250,180,0.35)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(bx, by + 0.6); g.quadraticCurveTo(x1, y1 - 1.5, x2, y2); g.stroke();
  }
  if (st >= 2) { // tassel
    const tx = x + lean, ty = y - H;
    g.strokeStyle = st === 3 ? '#d9b04a' : '#a8b058'; g.lineWidth = 1.1;
    g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.35; g.moveTo(tx, ty); g.quadraticCurveTo(tx + Math.cos(a) * 4, ty + Math.sin(a) * 5, tx + Math.cos(a) * 6, ty + Math.sin(a) * 4 + 4); } g.stroke();
  }
  if (st === 3) for (const [t, s] of [[0.42, 1], [0.55, -1]]) { // ears with husk + silk
    const bx = x + lean * t, by = y - H * t;
    const ex = bx + s * 5 * k, ey = by - 7 * k;
    g.fillStyle = '#9aa84c'; g.beginPath(); leaf(g, bx, by, ex, ey - 4, 3.6 * k, s * 1.2); g.fill();
    g.fillStyle = '#e8c24a'; g.beginPath(); g.ellipse((bx + ex) / 2 + s * 0.6, (by + ey) / 2 - 2, 2 * k, 4.4 * k, s * 0.5, 0, TAU); g.fill();
    g.fillStyle = 'rgba(180,120,20,0.55)'; for (let q = 0; q < 4; q++) { g.beginPath(); circle(g, (bx + ex) / 2 + s * 0.6 + (q & 1 ? 0.8 : -0.8), (by + ey) / 2 - 4.5 + q * 1.4, 0.5); g.fill(); }
    g.strokeStyle = '#c0703a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(ex, ey - 4); g.lineTo(ex + s * 2, ey - 7); g.moveTo(ex, ey - 4); g.lineTo(ex + s * 0.5, ey - 8); g.stroke();
  }
}
export const PLANTS = { potato: potatoPlant, cotton: cottonPlant, corn: cornPlant };

// rows of plants inside one tile (u = 0..1 across, ground row v)
const LAYOUT = { potato: [[0.28, 0.36], [0.72, 0.4], [0.3, 0.86], [0.74, 0.88]], cotton: [[0.3, 0.38], [0.72, 0.36], [0.28, 0.88], [0.7, 0.86]], corn: [[0.3, 0.38], [0.72, 0.4], [0.28, 0.88], [0.7, 0.87]] };

function cropSprite(kind, st) {
  const rand = rng(6000 + st * 31 + kind.length * 7);
  return spritePx(64, 64 + E, (g, P) => {
    const L = LAYOUT[kind];
    const Y = (v) => E + v * 64;
    for (const [u, v] of L) mound(g, u * 64, Y(v), st === 0 ? 3.5 : 5 + st);
    for (const row of [[L[0], L[1]], [L[2], L[3]]]) {
      P.layer((g) => { for (const [u, v] of row) PLANTS[kind](g, u * 64 + (rand() - 0.5) * 3, Y(v), st, rand, kind === 'corn' ? 1 : kind === 'potato' ? 1.25 : 0.95); }, st === 0 ? 1.4 : 1.8, OUTL);
    }
  });
}

export function addCrops(add) {
  for (const kind of ['potato', 'cotton', 'corn']) for (let st = 0; st < 4; st++) add(`crop_${kind}_${st}`, cropSprite(kind, st), 0.5, 1);
}
