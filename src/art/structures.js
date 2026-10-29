// Autotile structures: walls (wood / stone), fences, floors, farm plots, doors & gates, construction
// scaffold and damage cracks. Mask bits = neighbour of the same group: N=1, E=2, S=4, W=8.
//
// Walls are RimWorld-like solid blocks in 3/4 view: a top face covering the tile (shifted up by the wall
// height FH) and a front face (only when there is no neighbour to the south). The sprite anchor is the
// bottom of the front face, placed at the tile's bottom edge (o.y = ty + 1). Seamless runs: every part is
// painted with tile-periodic patterns, extended past connected sides, outlined, then cut OV px past the
// tile edge (overlap hides filtering seams); inner corners are cleared so neighbour outlines stay intact.
// Floors / farm plots are flat 1×1 tiles (+ BL px bleed on connected sides) for B.ground.

import { spritePx, rng, OW, TAU, SS, canvas, lin, rad, circle, mixc, tone, rgb, hex, clamp, leaf, taper } from './paint.js';

export const WALL_H = 26 / 64;   // front face height (tiles)
export const FENCE_H = 36 / 64;  // sprite extent above the tile for fences/gates (tiles)
const FH = 26, OV = 3, EXT = 12, BL = 2;
const PH = 36;                   // fence/gate sprite: px above the tile's north edge

const WOOD = { deep: '#3b2616', dark: '#5a3b22', mid: '#7d5532', light: '#9c6e43', high: '#b98a58' };
const WT = { // wall top (light, sun-bleached planks)
  base: ['#bf9161', '#b68857', '#c69a68', '#b08252', '#bd9164'], seam: '#5e3c20', grain: 'rgba(98,62,32,0.36)',
  hi: 'rgba(255,236,196,0.5)', knot: '#6a4426',
};
const WF = { // wall front (shaded boards)
  base: ['#7c5331', '#734b2c', '#835a36', '#6e4729', '#7a5434'], gap: '#2f1d10', grain: 'rgba(40,24,12,0.35)',
  rail: '#8e6339', railHi: '#b48555',
};
const ST = { // stone wall top (dressed blocks)
  mortar: '#6a645b', base: ['#b4ac9f', '#aaa295', '#bcb4a7', '#a59d90', '#b1a89a', '#c0b8aa'], hi: 'rgba(255,252,240,0.6)', lo: 'rgba(40,36,30,0.42)',
};
const SF = { // stone wall front (bricks)
  mortar: '#3e3a35', base: ['#7d766c', '#746d64', '#857e73', '#6f695f', '#7a7268'], hi: 'rgba(240,236,220,0.38)', lo: 'rgba(20,18,14,0.5)',
};

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const pick = (arr, a, b) => arr[Math.floor(hash(a, b) * arr.length)];

// ---------------- plank / block painters (tile-periodic, in "along-x" space) ----------------
// planks running along x, rows across y; covers [x0,x1]×[y0,y1]. rows: plank count per 64 px.
function planks(g, x0, y0, x1, y1, rows, pal, seed, opt = {}) {
  const ph = 64 / rows;
  const r0 = Math.floor(y0 / ph), r1 = Math.ceil(y1 / ph);
  for (let r = r0; r < r1; r++) {
    const rr = ((r % rows) + rows) % rows;
    const py = r * ph;
    const j = ((rr * 27 + 9 + seed * 13) % 64);
    const k0 = Math.floor((x0 - j) / 64) - 1, k1 = Math.ceil((x1 - j) / 64) + 1;
    for (let k = k0; k <= k1; k++) {
      const sx = j + k * 64, ex = sx + 64;
      if (ex < x0 || sx > x1) continue;
      const kk = ((k % 2) + 2) % 2;
      g.fillStyle = pick(pal.base, rr + seed * 7, kk);
      g.fillRect(sx, py, 64, ph);
      // grain (wavy lines along the plank)
      g.strokeStyle = pal.grain; g.lineWidth = 0.8;
      g.beginPath();
      for (let q = 0; q < 2; q++) {
        const gy = py + ph * (0.3 + q * 0.38) + (hash(rr, q + seed) - 0.5) * 2;
        g.moveTo(sx + 2, gy);
        for (let x = 8; x <= 64; x += 8) g.lineTo(sx + x, gy + Math.sin((x + rr * 11 + q * 5) * 0.21) * 0.8);
      }
      g.stroke();
      // knot
      if (hash(rr + seed, kk + 3) < 0.55) {
        const kx = sx + 10 + hash(rr, kk + 9) * 40, ky = py + ph * (0.35 + hash(kk, rr) * 0.3);
        g.fillStyle = pal.knot || pal.gap; g.beginPath(); g.ellipse(kx, ky, 2.4, 1.3, 0, 0, TAU); g.fill();
        g.strokeStyle = pal.grain; g.beginPath(); g.ellipse(kx, ky, 4, 2.2, 0, 0, TAU); g.stroke();
      }
      // butt joint + nails
      g.fillStyle = pal.seam || pal.gap; g.fillRect(sx - 0.6, py, 1.3, ph);
      if (opt.nails !== false) {
        g.fillStyle = 'rgba(40,36,34,0.85)';
        for (const nx of [sx - 3, sx + 3]) { g.beginPath(); circle(g, nx, py + ph * 0.5, 0.9); g.fill(); }
      }
    }
    // plank edges: light top, dark groove at the bottom
    g.fillStyle = pal.hi; g.fillRect(x0, py + 0.4, x1 - x0, 1);
    g.fillStyle = pal.seam || pal.gap; g.fillRect(x0, py + ph - 1.1, x1 - x0, 1.2);
  }
}

// ashlar blocks (rows across y, block joints periodic in 64)
const ASHLAR = [[0, 22, 41], [11, 33, 52], [4, 27, 46]];
function ashlar(g, x0, y0, x1, y1, pal, rowsPer = 3, layout = ASHLAR, bevel = 1.6) {
  const rh = 64 / rowsPer;
  g.fillStyle = pal.mortar; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const r0 = Math.floor(y0 / rh), r1 = Math.ceil(y1 / rh);
  for (let r = r0; r < r1; r++) {
    const rr = ((r % rowsPer) + rowsPer) % rowsPer;
    const J = layout[rr % layout.length];
    const py = r * rh;
    const k0 = Math.floor(x0 / 64) - 1, k1 = Math.ceil(x1 / 64);
    for (let k = k0; k <= k1; k++) {
      for (let i = 0; i < J.length; i++) {
        const bx = k * 64 + J[i], bw = (i + 1 < J.length ? J[i + 1] : J[0] + 64) - J[i];
        if (bx + bw < x0 || bx > x1) continue;
        const X = bx + 1, Y = py + 1, Wd = bw - 2, Hd = rh - 2;
        g.fillStyle = pick(pal.base, rr * 5 + i, 17);
        g.beginPath(); g.roundRect ? g.roundRect(X, Y, Wd, Hd, 1.5) : g.rect(X, Y, Wd, Hd); g.fill();
        // bevel: lit top/left, shaded bottom/right
        g.fillStyle = pal.hi; g.fillRect(X + 1, Y, Wd - 2, bevel); g.fillRect(X, Y + 1, bevel * 0.8, Hd - 2);
        g.fillStyle = pal.lo; g.fillRect(X + 1, Y + Hd - bevel, Wd - 1, bevel); g.fillRect(X + Wd - bevel * 0.8, Y + 1, bevel * 0.8, Hd - 1);
        // chisel specks
        for (let s = 0; s < 4; s++) {
          const h1 = hash(rr * 31 + i, s), h2 = hash(s + 7, rr + i * 3);
          g.fillStyle = s & 1 ? 'rgba(255,255,245,0.25)' : 'rgba(30,26,20,0.28)';
          g.fillRect(X + 3 + h1 * (Wd - 6), Y + 3 + h2 * (Hd - 6), 1.2, 1.2);
        }
        if (hash(rr + i * 7, 5) < 0.3) { // hairline crack
          g.strokeStyle = 'rgba(40,36,30,0.45)'; g.lineWidth = 0.7;
          const cx0 = X + Wd * (0.2 + hash(i, rr) * 0.5);
          g.beginPath(); g.moveTo(cx0, Y + 1); g.lineTo(cx0 + 2, Y + Hd * 0.5); g.lineTo(cx0 + 0.5, Y + Hd - 1); g.stroke();
        }
      }
    }
  }
}

// Tile-periodic textures are painted once into a cache covering the nominal region [-TR, 64+TR] × [-TR, 64+FH+TR]
// (device-pixel aligned with every sprite painter, so blits are 1:1) and copied into each mask's sprite.
const TR = 16, TW = 64 + TR * 2, TH = 64 + FH + TR * 2;
const TEX = new Map();
function cached(g, key, fn) {
  let c = TEX.get(key);
  if (!c) {
    c = canvas(TW * SS, TH * SS);
    const tg = c.getContext('2d');
    tg.lineJoin = 'round'; tg.lineCap = 'round';
    tg.setTransform(SS, 0, 0, SS, TR * SS, TR * SS);
    fn(tg, -TR, -TR, 64 + TR, 64 + FH + TR);
    TEX.set(key, c);
  }
  g.drawImage(c, -TR, -TR, TW, TH);
}

// run a painter in transposed space (x↔y) so the same code draws vertical runs
function transposed(g, fn) { g.save(); g.transform(0, 1, 1, 0, 0, 0); fn(); g.restore(); }

// ---------------- walls ----------------
function orientOf(m) {
  const h = m & 10, v = m & 5;
  if (h && !v) return 'h';
  if (v && !h) return 'v';
  return m ? 'x' : 'h';
}

function wallTop(g, kind, m, x0, y0, x1, y1) {
  const o = orientOf(m);
  if (kind === 'wood') {
    if (o === 'v') cached(g, 'wt_v', (g, a, b, c, d) => transposed(g, () => planks(g, b, a, d, c, 5, WT, 1)));
    else cached(g, 'wt_h', (g, a, b, c, d) => planks(g, a, b, c, d, 5, WT, 0));
    if (o === 'x') {
      // junction post: a squared timber cap where runs cross
      const p0 = 14, p1 = 50;
      g.fillStyle = 'rgba(40,24,12,0.35)'; g.fillRect(p0 + 1, p0 + 2, p1 - p0, p1 - p0);
      g.fillStyle = lin(g, p0, p0, p1, p1, [[0, '#c49563'], [1, '#9a6c40']]); g.fillRect(p0, p0, p1 - p0, p1 - p0);
      g.strokeStyle = 'rgba(110,70,36,0.7)'; g.lineWidth = 1;
      for (const k of [0.78, 0.55, 0.32]) { const d = (p1 - p0) * k / 2, c = (p0 + p1) / 2; g.beginPath(); g.ellipse(c + 0.5, c + 0.5, d, d * 0.92, 0, 0, TAU); g.stroke(); }
      g.strokeStyle = 'rgba(70,40,18,0.8)'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(32, 32); g.lineTo(44, 38); g.stroke();
      g.fillStyle = 'rgba(255,236,200,0.45)'; g.fillRect(p0, p0, p1 - p0, 1.4); g.fillRect(p0, p0, 1.4, p1 - p0);
      g.fillStyle = 'rgba(40,24,10,0.5)'; g.fillRect(p0, p1 - 1.4, p1 - p0, 1.4); g.fillRect(p1 - 1.4, p0, 1.4, p1 - p0);
      g.fillStyle = '#3e3a38';
      for (const [bx, by] of [[p0 + 4, p0 + 4], [p1 - 4, p0 + 4], [p0 + 4, p1 - 4], [p1 - 4, p1 - 4]]) { g.beginPath(); circle(g, bx, by, 1.5); g.fill(); }
    }
  } else {
    if (o === 'v') cached(g, 'st_v', (g, a, b, c, d) => transposed(g, () => ashlar(g, b, a, d, c, ST)));
    else cached(g, 'st_h', (g, a, b, c, d) => ashlar(g, a, b, c, d, ST));
    if (o === 'x') {
      const p0 = 12, p1 = 52;
      g.fillStyle = ST.mortar; g.fillRect(p0 - 1, p0 - 1, p1 - p0 + 2, p1 - p0 + 2);
      g.fillStyle = lin(g, p0, p0, p1, p1, [[0, '#b9b2a6'], [1, '#948c80']]); g.fillRect(p0, p0, p1 - p0, p1 - p0);
      g.fillStyle = ST.hi; g.fillRect(p0, p0, p1 - p0, 2); g.fillRect(p0, p0, 2, p1 - p0);
      g.fillStyle = ST.lo; g.fillRect(p0, p1 - 2, p1 - p0, 2); g.fillRect(p1 - 2, p0, 2, p1 - p0);
      g.strokeStyle = 'rgba(60,56,50,0.35)'; g.lineWidth = 1;
      g.strokeRect(p0 + 6, p0 + 6, p1 - p0 - 12, p1 - p0 - 12);
    }
  }
  // soft bevel on unconnected edges (lit north/west, shaded east/south)
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8;
  if (!N) { g.fillStyle = 'rgba(255,245,220,0.28)'; g.fillRect(x0, 0, x1 - x0, 3); }
  if (!W) { g.fillStyle = 'rgba(255,245,220,0.2)'; g.fillRect(0, y0, 3, y1 - y0); }
  if (!E) { g.fillStyle = 'rgba(30,18,8,0.28)'; g.fillRect(61, y0, 3, y1 - y0); }
  if (!S) { g.fillStyle = 'rgba(30,18,8,0.22)'; g.fillRect(x0, 61, x1 - x0, 3); }
}

function wallFront(g, kind, m, x0, x1) {
  cached(g, 'wf_' + kind, (g, a, b, c) => wallFrontTex(g, kind, a, c));
  const top = 64;
  // corner shading where the wall ends (unconnected sides)
  if (!(m & 2)) { g.fillStyle = lin(g, 56, 0, 64, 0, [[0, 'rgba(15,10,6,0)'], [1, 'rgba(15,10,6,0.35)']]); g.fillRect(56, top, 8, FH); }
  if (!(m & 8)) { g.fillStyle = 'rgba(255,240,210,0.1)'; g.fillRect(0, top, 3, FH); }
}
function wallFrontTex(g, kind, x0, x1) {
  const top = 64, bot = 64 + FH;
  if (kind === 'wood') {
    // vertical boards (5 per tile), periodic
    const bw = 64 / 5;
    for (let i = Math.floor(x0 / bw) - 1; i * bw < x1; i++) {
      const ii = ((i % 5) + 5) % 5;
      const bx = i * bw;
      g.fillStyle = lin(g, bx, 0, bx + bw, 0, [[0, pick(WF.base, ii, 1)], [1, tone(pick(WF.base, ii, 2), 0.86)]]);
      g.fillRect(bx, top, bw, FH);
      g.strokeStyle = WF.grain; g.lineWidth = 0.8;
      g.beginPath(); const gx = bx + 3 + hash(ii, 4) * (bw - 6); g.moveTo(gx, top + 4); g.lineTo(gx + (hash(ii, 5) - 0.5) * 2, bot - 3); g.stroke();
      g.fillStyle = WF.gap; g.fillRect(bx + bw - 0.8, top, 1.4, FH);
      g.fillStyle = 'rgba(255,220,170,0.12)'; g.fillRect(bx + 0.6, top, 1, FH);
    }
    // rails (top & bottom) with nails
    for (const [ry, rh] of [[top + 4, 5], [bot - 8, 5]]) {
      g.fillStyle = lin(g, 0, ry, 0, ry + rh, [[0, WF.railHi], [1, WF.rail]]); g.fillRect(x0, ry, x1 - x0, rh);
      g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(x0, ry + rh, x1 - x0, 1.2);
      g.fillStyle = '#3c3a3a';
      for (let i = Math.floor(x0 / bw); i * bw < x1; i++) { g.beginPath(); circle(g, i * bw + bw / 2, ry + rh / 2, 0.85); g.fill(); }
    }
  } else {
    // brick courses
    const rows = 3, rh = FH / rows, bwk = 16;
    g.fillStyle = SF.mortar; g.fillRect(x0, top, x1 - x0, FH);
    for (let r = 0; r < rows; r++) {
      const py = top + r * rh, off = r & 1 ? 8 : 0;
      for (let i = Math.floor((x0 - off) / bwk) - 1; i * bwk + off < x1; i++) {
        const bx = i * bwk + off, ii = ((i % 4) + 4) % 4;
        const X = bx + 0.8, Y = py + 0.8, Wd = bwk - 1.6, Hd = rh - 1.6;
        g.fillStyle = pick(SF.base, ii + r * 4, 3); g.fillRect(X, Y, Wd, Hd);
        g.fillStyle = SF.hi; g.fillRect(X, Y, Wd, 1.2);
        g.fillStyle = SF.lo; g.fillRect(X, Y + Hd - 1.2, Wd, 1.2); g.fillRect(X + Wd - 1, Y, 1, Hd);
        if (hash(ii, r + 11) < 0.25) { g.fillStyle = 'rgba(30,26,20,0.25)'; g.fillRect(X + 3, Y + 2, 2, 1.4); }
      }
    }
    // moss & grime at the foot (periodic)
    for (let k = Math.floor(x0 / 64) - 1; k * 64 < x1; k++) {
      for (const [mx, mw] of [[6, 9], [29, 6], [47, 11]]) {
        g.fillStyle = 'rgba(86,110,52,0.55)';
        g.beginPath(); g.ellipse(k * 64 + mx, bot - 1, mw * 0.5, 2.6, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(120,142,70,0.45)';
        g.beginPath(); g.ellipse(k * 64 + mx - 1, bot - 2, mw * 0.3, 1.4, 0, 0, TAU); g.fill();
      }
    }
  }
  // lip highlight (edge of the top face) + shadow below it, ground occlusion at the foot
  g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(x0, top, x1 - x0, 1.2);
  g.fillStyle = 'rgba(20,12,6,0.35)'; g.fillRect(x0, top + 1.2, x1 - x0, 2);
  g.fillStyle = lin(g, 0, bot - 10, 0, bot, [[0, 'rgba(15,10,6,0)'], [1, 'rgba(15,10,6,0.42)']]);
  g.fillRect(x0, bot - 10, x1 - x0, 10);
}

// cut the extended parts on connected sides (keep OV overlap) and clear inner corners
function cutSides(g, m, H) {
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8;
  const big = 400;
  if (W) g.clearRect(-big, -big, big - OV, big * 2);
  if (E) g.clearRect(64 + OV, -big, big, big * 2);
  if (N) g.clearRect(-big, -big, big * 2, big - OV);
  if (S) g.clearRect(-big, 64 + OV, big * 2, big);
  if (N && E) g.clearRect(64, -big, big, big);
  if (N && W) g.clearRect(-big, -big, big, big);
  if (S && E) g.clearRect(64, 64, big, big);
  if (S && W) g.clearRect(-big, 64, big, big);
}

function wallSprite(kind, m) {
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8;
  return spritePx(64, 64 + FH, (g, P) => {
    const x0 = W ? -EXT : 0, x1 = E ? 64 + EXT : 64;
    const y0 = N ? -EXT : 0, y1 = S ? 64 + EXT : 64;
    P.layer((g) => {
      g.save();
      g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); if (!S) g.rect(x0, 64, x1 - x0, FH); g.clip();
      wallTop(g, kind, m, x0, y0, x1, y1);
      if (!S) wallFront(g, kind, m, x0, x1);
      g.restore();
    }, OW);
    cutSides(g, m, 64 + FH);
  }, { pad: 12 });
}

// legacy single wall (pre-autotile saves / icons): an isolated block
function wallLegacy(kind) { return wallSprite(kind, 0); }

// ---------------- fences ----------------
// post at the tile centre, rails toward connected neighbours (E/W rails seen from the front; N/S rails seen
// from above as a vertical bar). Ground row v (0..1 across the tile) maps to sprite y = PH + v*64.
const FR = { h1: 11, h2: 23, post: 31 };
function fenceRailsH(g, xa, xb, foot) {
  for (const h of [FR.h1, FR.h2]) {
    const y = foot - h;
    g.fillStyle = lin(g, 0, y - 2.6, 0, y + 2.6, [[0, '#b0844f'], [0.5, '#8c6238'], [1, '#5f3f22']]);
    g.fillRect(xa, y - 2.6, xb - xa, 5.2);
    g.strokeStyle = 'rgba(50,30,14,0.45)'; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(xa, y + 0.3); g.lineTo(xb, y - 0.2); g.stroke();
  }
}
function fenceRailsV(g, ya, yb, foot) {
  // both rails project onto the same column; draw them as one weathered top-view bar with a highlight
  g.fillStyle = lin(g, 29, 0, 35, 0, [[0, '#b08450'], [0.5, '#8a6037'], [1, '#5e3f22']]);
  g.fillRect(29.2, ya - FR.h2, 5.6, yb - ya + (FR.h2 - FR.h1));
  g.strokeStyle = 'rgba(50,30,14,0.4)'; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(32, ya - FR.h2); g.lineTo(32.4, yb - FR.h1); g.stroke();
}
function fencePost(g, x, foot, h, w, rand) {
  // round log post with a cut top
  g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, '#a57a4c'], [0.4, '#86603a'], [1, '#4e331c']]);
  g.beginPath(); g.moveTo(x - w, foot); g.lineTo(x - w * 0.92, foot - h); g.lineTo(x + w * 0.92, foot - h); g.lineTo(x + w, foot); g.ellipse(x, foot, w, w * 0.4, 0, 0, Math.PI); g.fill();
  g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 0.8;
  for (let i = 0; i < 2; i++) { const gx = x - w * 0.4 + i * w * 0.8; g.beginPath(); g.moveTo(gx, foot - h + 3); g.lineTo(gx + (rand() - 0.5), foot - 2); g.stroke(); }
  g.fillStyle = '#c9a26c'; g.beginPath(); g.ellipse(x, foot - h, w * 0.92, w * 0.42, 0, 0, TAU); g.fill();
  g.strokeStyle = '#8f6a3e'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(x, foot - h, w * 0.5, w * 0.22, 0, 0, TAU); g.stroke();
}
function fenceSprite(m) {
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8;
  const rand = rng(300 + m);
  return spritePx(64, 64 + PH, (g, P) => {
    const foot = PH + 32;
    // N/S rails first (behind the post), then the post, then E/W rails in front
    if (N || S) P.layer((g) => fenceRailsV(g, N ? PH - EXT : foot, S ? PH + 64 + EXT : foot, foot), 2.4);
    if (E || W) P.layer((g) => fenceRailsH(g, W ? -EXT : 32, E ? 64 + EXT : 32, foot), 2.4);
    P.layer((g) => {
      // tuft of grass & dirt at the foot
      g.fillStyle = 'rgba(60,44,26,0.6)'; g.beginPath(); g.ellipse(32, foot + 1, 7, 2.4, 0, 0, TAU); g.fill();
      fencePost(g, 32, foot, FR.post, 4.6, rand);
      g.fillStyle = '#3c3a3a'; // nails where rails meet
      if (E || W) for (const h of [FR.h1, FR.h2]) { g.beginPath(); circle(g, 32, foot - h, 0.9); g.fill(); }
      g.strokeStyle = '#55753a'; g.lineWidth = 1.1;
      g.beginPath();
      for (let i = 0; i < 5; i++) { const x = 27 + i * 2.6; g.moveTo(x, foot + 1.5); g.lineTo(x + (i - 2) * 1.2, foot - 3 - rand() * 3); }
      g.stroke();
    }, 2.4);
    // rail ends past the tile edge: cut with overlap (vertical: relative to the shifted ground rows)
    const big = 400;
    if (W) g.clearRect(-big, -big, big - OV, big * 2);
    if (E) g.clearRect(64 + OV, -big, big, big * 2);
    if (N) g.clearRect(28, -big, 8, big + PH - FR.h2 - OV);
    if (S) g.clearRect(28, PH + 64 - FR.h1 + OV, 8, big);
  }, { pad: 12 });
}

// ---------------- gates ----------------
// h: posts at both tile edges, double leaf; v: posts at N/S ends, leaf seen from above.
function gateLeafH(g, xa, xb, foot, rand) {
  // one leaf spanning xa..xb (hinge at xa): pickets + 2 rails + diagonal brace
  const top = foot - 32, bot = foot - 3;
  const dir = Math.sign(xb - xa);
  const n = 4, w = Math.abs(xb - xa) / n;
  for (let i = 0; i < n; i++) {
    const x = Math.min(xa, xb) + i * w;
    g.fillStyle = lin(g, x, 0, x + w, 0, [[0, '#c99c64'], [1, '#97693c']]);
    g.beginPath(); g.moveTo(x + 0.5, bot); g.lineTo(x + 0.5, top + 2); g.lineTo(x + w / 2, top - 1.5); g.lineTo(x + w - 0.5, top + 2); g.lineTo(x + w - 0.5, bot); g.closePath(); g.fill();
    g.fillStyle = 'rgba(40,24,12,0.6)'; g.fillRect(x + w - 1, top + 2, 1, bot - top - 2);
  }
  for (const y of [top + 6, bot - 6]) {
    g.fillStyle = lin(g, 0, y - 2.4, 0, y + 2.4, [[0, '#b58a56'], [1, '#6e4b2c']]);
    g.fillRect(Math.min(xa, xb), y - 2.4, Math.abs(xb - xa), 4.8);
  }
  g.strokeStyle = '#8a6038'; g.lineWidth = 3.4;
  g.beginPath(); g.moveTo(xa + dir * 2, bot - 7); g.lineTo(xb - dir * 2, top + 7); g.stroke();
  g.strokeStyle = 'rgba(255,230,190,0.35)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(xa + dir * 2, bot - 8.5); g.lineTo(xb - dir * 2, top + 5.5); g.stroke();
  // iron hinges
  g.fillStyle = '#4a4a50';
  for (const y of [top + 6, bot - 6]) g.fillRect(xa - (dir < 0 ? 5 : 0), y - 1.6, 5, 3.2);
}
function gateH(part) {
  const rand = rng(911);
  return spritePx(64, 64 + PH, (g, P) => {
    const foot = PH + 32;
    if (part !== 'leaf') {
      P.layer((g) => fenceRailsH(g, -EXT, 64 + EXT, foot), 2.4); // stubs to the neighbours (hidden under the posts)
      g.clearRect(9, 0, 46, 200);
      P.layer((g) => { fencePost(g, 5.5, foot, FR.post + 9, 5.4, rand); fencePost(g, 58.5, foot, FR.post + 9, 5.4, rand); }, 2.4);
      const big = 400; g.clearRect(-big, -big, big - OV, big * 2); g.clearRect(64 + OV, -big, big, big * 2);
    }
    if (part !== 'frame') {
      if (part === 'leaf') P.layer((g) => gateLeafH(g, 10, 32, foot, rand), 2.2);
      else P.layer((g) => { gateLeafH(g, 10, 32, foot, rand); gateLeafH(g, 54, 32, foot, rand); }, 2.2);
    }
  }, { pad: 12 });
}
function gateV(part) {
  const rand = rng(912);
  return spritePx(64, 64 + PH, (g, P) => {
    const footN = PH + 5, footS = PH + 60;
    if (part === 'frame' || part === 'full') {
      P.layer((g) => fenceRailsV(g, PH - EXT, PH + 64 + EXT, footN), 2.4);
      g.clearRect(0, footN - FR.h2 + 3, 64, footS - footN - 6);
      const big = 400; g.clearRect(28, -big, 8, big + PH - FR.h2 - OV); g.clearRect(28, PH + 64 - FR.h1 + OV, 8, big);
      P.layer((g) => fencePost(g, 32, footN, FR.post + 9, 5.4, rand), 2.4);
    }
    if (part === 'leaf' || part === 'full') {
      P.layer((g) => {
        // leaf seen from above: picket tops along the run with the rails as darker bands
        const ya = footN - 24, yb = footS - 24;
        const L = (yb - ya) * (part === 'leaf' ? 0.5 : 1);
        g.fillStyle = lin(g, 27, 0, 37, 0, [[0, '#d2a46a'], [0.5, '#a87a46'], [1, '#6e4a28']]);
        g.fillRect(27.5, ya, 9, L);
        g.fillStyle = 'rgba(40,24,12,0.6)';
        for (let y = ya + 4.5; y < ya + L - 1; y += 4.5) g.fillRect(27.5, y, 9, 1);
        g.fillStyle = 'rgba(255,236,200,0.4)'; g.fillRect(27.5, ya, 1.2, L);
        g.fillStyle = '#4a4a50'; g.fillRect(26.5, ya + 2, 11, 2.6); if (part === 'full') g.fillRect(26.5, ya + L / 2 - 1.3, 11, 2.6);
      }, 2.2);
    }
    if (part === 'post' || part === 'full') P.layer((g) => fencePost(g, 32, footS, FR.post + 9, 5.4, rand), 2.4);
  }, { pad: 12 });
}

// ---------------- doors ----------------
// h (in an E-W wall): timber jambs at both tile edges (full wall blocks) + a double door leaf standing in the
// middle of the tile; v (N-S wall): north/south jamb blocks + the leaf seen from above as a strip.
const DH = 25; // door leaf height
const DV0 = 0.22, DV1 = 0.7; // door leaf footprint rows (h door)
const JAMB = { top: ['#8a5f38', '#835a34'], topHi: 'rgba(255,230,190,0.4)' };
function jambBlock(g, x0, x1, v0, v1, front) {
  // timber block occupying x0..x1 and ground rows v0..v1 (0..1) at wall height
  const ty0 = v0 * 64, ty1 = v1 * 64;
  g.fillStyle = lin(g, x0, ty0, x1, ty1, [[0, '#a5774a'], [1, '#7c5432']]);
  g.fillRect(x0, ty0, x1 - x0, ty1 - ty0);
  g.strokeStyle = 'rgba(60,36,18,0.5)'; g.lineWidth = 0.8;
  if (x1 - x0 < ty1 - ty0) { for (let x = x0 + 3; x < x1 - 1; x += 3.2) { g.beginPath(); g.moveTo(x, ty0 + 2); g.lineTo(x + 0.4, ty1 - 2); g.stroke(); } }
  else { for (let y = ty0 + 3; y < ty1 - 1; y += 3.2) { g.beginPath(); g.moveTo(x0 + 2, y); g.lineTo(x1 - 2, y + 0.4); g.stroke(); } }
  g.fillStyle = JAMB.topHi; g.fillRect(x0, ty0, x1 - x0, 1.3);
  if (front) {
    const fy = ty1, fb = ty1 + FH;
    g.fillStyle = lin(g, 0, fy, 0, fb, [[0, '#6e4a2b'], [1, '#4a301a']]);
    g.fillRect(x0, fy, x1 - x0, FH);
    g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(x0, fy, x1 - x0, 1.1);
    g.fillStyle = 'rgba(20,12,6,0.4)'; g.fillRect(x0, fy + 1.1, x1 - x0, 1.6);
    g.fillStyle = '#3c3a3a';
    for (const yy of [fy + 6, fb - 6]) { g.beginPath(); circle(g, (x0 + x1) / 2, yy, 1); g.fill(); }
  }
}
function doorLeafH(g, xa, xb) {
  // half leaf from xa (jamb side) to xb (meeting edge); top strip + front boards
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
  const vy0 = DV0 * 64 + (FH - DH), vy1 = DV1 * 64 + (FH - DH); // top face rows
  const fb = vy1 + DH;
  g.fillStyle = lin(g, 0, vy0, 0, vy1, [[0, '#a8754a'], [1, '#8a5c36']]);
  g.fillRect(x0, vy0, x1 - x0, vy1 - vy0);
  g.strokeStyle = 'rgba(60,34,16,0.6)'; g.lineWidth = 0.9;
  for (let y = vy0 + 5; y < vy1 - 2; y += 5.6) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  g.fillStyle = 'rgba(255,225,180,0.35)'; g.fillRect(x0, vy0, x1 - x0, 1.2);
  g.fillStyle = '#45444a'; // iron edge bands seen from above
  g.fillRect(x0, vy0 + 3, x1 - x0, 2); g.fillRect(x0, vy1 - 5, x1 - x0, 2);
  // front boards
  const n = 3, w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * w;
    g.fillStyle = lin(g, x, 0, x + w, 0, [[0, '#7e4e2c'], [1, '#633b20']]);
    g.fillRect(x, vy1, w, DH);
    g.fillStyle = 'rgba(30,18,8,0.7)'; g.fillRect(x + w - 0.7, vy1, 1.2, DH);
  }
  g.fillStyle = 'rgba(255,230,190,0.35)'; g.fillRect(x0, vy1, x1 - x0, 1.1);
  // iron straps with rivets, ring handle at the meeting edge
  for (const y of [vy1 + 5, fb - 7]) {
    g.fillStyle = '#45444a'; g.fillRect(x0, y, x1 - x0, 2.6);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0, y, x1 - x0, 0.8);
    g.fillStyle = '#2a292d'; for (let x = x0 + 3; x < x1 - 1; x += 6) { g.beginPath(); circle(g, x, y + 1.3, 0.8); g.fill(); }
  }
  const hx = xb + (xa < xb ? -4 : 4);
  g.strokeStyle = '#c9a24a'; g.lineWidth = 1.3; g.beginPath(); g.arc(hx, vy1 + DH * 0.5 + 1, 2.2, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(15,10,6,0.35)'; g.fillRect(x0, fb - 4, x1 - x0, 4);
}
function doorH(part) {
  return spritePx(64, 64 + FH, (g, P) => {
    if (part !== 'leaf') {
      P.layer((g) => {
        jambBlock(g, -EXT, 9, 0, 1, true);
        jambBlock(g, 55, 64 + EXT, 0, 1, true);
      }, OW);
      const big = 400; g.clearRect(-big, -big, big - OV, big * 2); g.clearRect(64 + OV, -big, big, big * 2);
    }
    if (part !== 'frame') {
      if (part === 'leaf') P.layer((g) => doorLeafH(g, 9, 32.5), 2.6);
      else P.layer((g) => { doorLeafH(g, 9, 32.5); doorLeafH(g, 55, 31.5); }, 2.6);
    }
  }, { pad: 12 });
}
function doorV(part) {
  return spritePx(64, 64 + FH, (g, P) => {
    const jn = 0.15, js = 0.85;
    if (part === 'frame' || part === 'full') {
      P.layer((g) => jambBlock(g, 0, 64, -EXT / 64, jn, true), OW);
      g.clearRect(-400, -400, 900, 400 - OV);
    }
    if (part === 'leaf' || part === 'full') {
      P.layer((g) => {
        const ya = jn * 64 + (FH - DH), yb = js * 64 + (FH - DH);
        const L = part === 'leaf' ? (yb - ya) / 2 : yb - ya;
        g.fillStyle = lin(g, 22, 0, 42, 0, [[0, '#b07c4f'], [0.5, '#93613a'], [1, '#6c4226']]);
        g.fillRect(22, ya, 20, L);
        g.strokeStyle = 'rgba(60,34,16,0.6)'; g.lineWidth = 0.9;
        for (let x = 27; x < 41; x += 5) { g.beginPath(); g.moveTo(x, ya + 1); g.lineTo(x, ya + L - 1); g.stroke(); }
        g.fillStyle = 'rgba(255,225,180,0.3)'; g.fillRect(22, ya, 1.2, L);
        g.fillStyle = '#45444a';
        for (const y of [ya + 5, ya + L - 8]) if (y > ya && y < ya + L - 2) { g.fillRect(22, y, 20, 2.6); g.fillStyle = '#2a292d'; for (let x = 25; x < 41; x += 5) { g.beginPath(); circle(g, x, y + 1.3, 0.8); g.fill(); } g.fillStyle = '#45444a'; }
        if (part === 'full') { g.fillStyle = 'rgba(30,18,8,0.75)'; g.fillRect(22, ya + L / 2 - 0.7, 20, 1.4); }
        g.strokeStyle = '#c9a24a'; g.lineWidth = 1.3; g.beginPath(); g.arc(32, ya + L - (part === 'full' ? L / 2 + 4 : 4), 2.2, 0, TAU); g.stroke();
      }, 2.6);
    }
    if (part === 'post' || part === 'full') P.layer((g) => jambBlock(g, 0, 64, js, 1, true), OW);
  }, { pad: 12 });
}
// threshold board under a door (flat, B.ground)
function doorSill(v) {
  return spritePx(64, 64, (g, P) => {
    P.layer((g) => {
      if (v) { g.fillStyle = lin(g, 20, 0, 44, 0, [[0, '#8f6a42'], [1, '#6a4a2c']]); g.fillRect(21, 6, 22, 52); }
      else { g.fillStyle = lin(g, 0, 20, 0, 44, [[0, '#8f6a42'], [1, '#6a4a2c']]); g.fillRect(6, 21, 52, 22); }
      g.strokeStyle = 'rgba(50,30,14,0.5)'; g.lineWidth = 0.8;
      g.beginPath();
      if (v) { g.moveTo(32, 7); g.lineTo(32, 57); } else { g.moveTo(7, 32); g.lineTo(57, 32); }
      g.stroke();
    }, 1.4, 'rgba(30,20,12,0.6)');
  }, { crop: false });
}

// ---------------- floors & farm plots (flat) ----------------
function flatTile(m, fn, edgeFn) {
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8;
  return spritePx(64 + BL * 2, 64 + BL * 2, (g) => {
    g.translate(BL, BL);
    const x0 = W ? -BL : 0, x1 = E ? 64 + BL : 64, y0 = N ? -BL : 0, y1 = S ? 64 + BL : 64;
    g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    fn(g, x0, y0, x1, y1);
    edgeFn(g, N, E, S, W);
    g.restore();
  }, { crop: false });
}
const FW = { base: ['#87613d', '#7e5a37', '#8d6641', '#785534', '#84603c', '#805c39'], seam: '#3e2814', grain: 'rgba(60,38,18,0.3)', hi: 'rgba(255,226,180,0.2)', knot: '#5a3c22' };
function floorWood(m) {
  return flatTile(m, (g) => cached(g, 'fw', (g, a, b, c, d) => planks(g, a, b, c, d, 6, FW, 3)), (g, N, E, S, W) => {
    // trim board on open edges
    const t = 4;
    g.fillStyle = '#6e4b2c';
    if (!N) g.fillRect(0, 0, 64, t);
    if (!S) g.fillRect(0, 64 - t, 64, t);
    if (!W) g.fillRect(0, 0, t, 64);
    if (!E) g.fillRect(64 - t, 0, t, 64);
    g.fillStyle = 'rgba(255,230,190,0.3)';
    if (!N) g.fillRect(0, 0.5, 64, 1);
    if (!W) g.fillRect(0.5, 0, 1, 64);
    g.fillStyle = 'rgba(30,18,8,0.55)';
    if (!N) g.fillRect(0, t, 64, 1); if (!W) g.fillRect(t, 0, 1, 64);
    if (!S) g.fillRect(0, 64 - t - 1, 64, 1); if (!E) g.fillRect(64 - t - 1, 0, 1, 64);
    outerEdge(g, N, E, S, W, 'rgba(28,18,10,0.85)');
  });
}
// flagstones: fixed periodic layout (x, y, w, h) per tile
const FLAGS = [[0, 0, 34, 30], [34, 0, 30, 20], [34, 20, 30, 20], [0, 30, 22, 34], [22, 30, 42, 14], [22, 44, 24, 20], [46, 40, 18, 24]];
const FS = ['#8b8479', '#938b7f', '#837d73', '#988f82', '#868075', '#8f877b', '#7f796f'];
function floorStone(m) {
  return flatTile(m, (g) => cached(g, 'fs', floorStoneTex), (g, N, E, S, W) => stoneEdges(g, N, E, S, W));
}
function floorStoneTex(g, x0, y0, x1, y1) {
  {
    g.fillStyle = '#54504a'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      FLAGS.forEach(([x, y, w, h], i) => {
        const X = kx * 64 + x + 1, Y = ky * 64 + y + 1, Wd = w - 2, Hd = h - 2;
        if (X > x1 || Y > y1 || X + Wd < x0 || Y + Hd < y0) return;
        g.fillStyle = FS[i]; g.beginPath(); g.roundRect ? g.roundRect(X, Y, Wd, Hd, 2.5) : g.rect(X, Y, Wd, Hd); g.fill();
        g.fillStyle = 'rgba(255,252,240,0.3)'; g.fillRect(X + 2, Y, Wd - 4, 1.1); g.fillRect(X, Y + 2, 1.1, Hd - 4);
        g.fillStyle = 'rgba(30,28,24,0.3)'; g.fillRect(X + 2, Y + Hd - 1.1, Wd - 4, 1.1); g.fillRect(X + Wd - 1.1, Y + 2, 1.1, Hd - 4);
        for (let s = 0; s < 5; s++) {
          g.fillStyle = s & 1 ? 'rgba(255,255,245,0.18)' : 'rgba(40,36,30,0.2)';
          g.beginPath(); circle(g, X + 3 + hash(i, s) * (Wd - 6), Y + 3 + hash(s, i + 9) * (Hd - 6), 0.6 + hash(i + s, 2) * 0.9); g.fill();
        }
      });
    }
  }
}
function stoneEdges(g, N, E, S, W) {
  {
    // curb stones on open edges
    g.fillStyle = 'rgba(70,66,60,0.9)';
    if (!N) g.fillRect(0, 0, 64, 3); if (!S) g.fillRect(0, 61, 64, 3);
    if (!W) g.fillRect(0, 0, 3, 64); if (!E) g.fillRect(61, 0, 3, 64);
    g.fillStyle = 'rgba(255,250,235,0.22)';
    if (!N) g.fillRect(0, 0.4, 64, 1); if (!W) g.fillRect(0.4, 0, 1, 64);
    outerEdge(g, N, E, S, W, 'rgba(32,30,26,0.85)');
  }
}
function outerEdge(g, N, E, S, W, col) {
  g.fillStyle = col;
  if (!N) g.fillRect(0, 0, 64, 0.9);
  if (!S) g.fillRect(0, 63.1, 64, 0.9);
  if (!W) g.fillRect(0, 0, 0.9, 64);
  if (!E) g.fillRect(63.1, 0, 0.9, 64);
}
function farmPlot(m) {
  return flatTile(m, (g) => cached(g, 'fp', farmTex), farmEdges);
}
function farmTex(g, x0, y0, x1, y1) {
  {
    g.fillStyle = '#4a3322'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // furrows: 4 ridges per tile (light crest, dark groove)
    for (let r = Math.floor(y0 / 16) - 1; r * 16 < y1; r++) {
      const y = r * 16;
      g.fillStyle = lin(g, 0, y, 0, y + 16, [[0, '#3a2718'], [0.25, '#5a3f29'], [0.5, '#6b4c32'], [0.75, '#563c27'], [1, '#3a2718']]);
      g.fillRect(x0, y, x1 - x0, 16);
      g.fillStyle = 'rgba(255,220,170,0.12)'; g.fillRect(x0, y + 6, x1 - x0, 1.4);
      g.fillStyle = 'rgba(20,12,6,0.4)'; g.fillRect(x0, y + 15, x1 - x0, 1.5);
    }
    // clods & pebbles (periodic)
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) for (let i = 0; i < 26; i++) {
      const x = kx * 64 + hash(i, 1) * 64, y = ky * 64 + hash(i, 2) * 64;
      if (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 2) continue;
      const k = hash(i, 3);
      g.fillStyle = k < 0.45 ? 'rgba(30,18,10,0.45)' : k < 0.85 ? 'rgba(140,104,70,0.45)' : 'rgba(150,145,135,0.6)';
      g.beginPath(); g.ellipse(x, y, 0.9 + hash(i, 4) * 1.6, 0.7 + hash(i, 5) * 0.9, 0, 0, TAU); g.fill();
    }
  }
}
function farmEdges(g, N, E, S, W) {
  {
    // raised soil border on open edges
    const b = 5;
    const ridge = (x, y, w, h, vert) => {
      g.fillStyle = vert ? lin(g, x, 0, x + w, 0, [[0, '#3a2718'], [0.45, '#6e5034'], [1, '#4e3624']]) : lin(g, 0, y, 0, y + h, [[0, '#3a2718'], [0.45, '#6e5034'], [1, '#4e3624']]);
      g.fillRect(x, y, w, h);
    };
    if (!N) ridge(0, 0, 64, b, false);
    if (!S) ridge(0, 64 - b, 64, b, false);
    if (!W) ridge(0, 0, b, 64, true);
    if (!E) ridge(64 - b, 0, b, 64, true);
    outerEdge(g, N, E, S, W, 'rgba(30,20,10,0.6)');
  }
}

// ---------------- construction scaffold & damage cracks ----------------
function scaffold() {
  return spritePx(64, 64 + FH + 10, (g, P) => {
    P.layer((g) => {
      const bot = 64 + FH + 10;
      g.lineCap = 'round';
      const pole = (x0, y0, x1, y1, w = 3) => { g.strokeStyle = '#c49a62'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = 'rgba(80,50,24,0.6)'; g.lineWidth = w * 0.35; g.beginPath(); g.moveTo(x0 + w * 0.3, y0); g.lineTo(x1 + w * 0.3, y1); g.stroke(); };
      pole(6, bot, 6, 6); pole(58, bot, 58, 6);
      pole(4, 30, 60, 30, 2.6); pole(4, 64, 60, 64, 2.6);
      pole(8, bot - 4, 56, 34, 2.2);
      g.fillStyle = '#d8c7a0'; // rope lashings
      for (const [x, y] of [[6, 30], [58, 30], [6, 64], [58, 64]]) { g.beginPath(); g.ellipse(x, y, 3, 2, 0, 0, TAU); g.fill(); }
      // plank across the top
      g.fillStyle = lin(g, 0, 22, 0, 28, [[0, '#c9a06a'], [1, '#8f6a40']]); g.fillRect(2, 22, 60, 5);
    }, 2.2);
  }, { pad: 12 });
}
function cracks(v) {
  const rand = rng(77 + v * 19);
  return spritePx(64, 64 + FH, (g) => {
    const n = 2 + v * 2;
    for (let i = 0; i < n; i++) {
      let x = 8 + rand() * 48, y = 6 + rand() * (52 + FH);
      g.strokeStyle = 'rgba(24,16,10,0.85)'; g.lineWidth = 1.3 + v * 0.2;
      g.beginPath(); g.moveTo(x, y);
      const pts = [[x, y]];
      for (let k = 0; k < 4 + v; k++) { x += (rand() - 0.5) * 12; y += (rand() - 0.3) * 9; g.lineTo(x, y); pts.push([x, y]); }
      g.stroke();
      g.strokeStyle = 'rgba(255,240,215,0.25)'; g.lineWidth = 0.7;
      g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px + 0.9, py + 0.9) : g.moveTo(px + 0.9, py + 0.9))); g.stroke();
      if (v > 0) for (let k = 0; k < 2; k++) { // chips
        const [px, py] = pts[1 + Math.floor(rand() * (pts.length - 1))];
        g.fillStyle = 'rgba(30,20,12,0.6)'; g.beginPath(); g.ellipse(px, py, 2 + rand() * 2, 1.2 + rand(), rand() * 3, 0, TAU); g.fill();
      }
    }
  }, { crop: false });
}

// ---------------- blueprint overlays (tinted at draw time) ----------------
// footprint grid tile: light fill + crisp border, like RimWorld's blueprint cells
function bpTile() {
  return spritePx(64, 64, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(1, 1, 62, 62);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.2; g.strokeRect(2.2, 2.2, 59.6, 59.6);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 58); g.moveTo(6, 32); g.lineTo(58, 32); g.stroke(); g.setLineDash([]);
  }, { crop: false });
}
// progress bar (64 px = 1 tile wide; scaled by the caller)
function bpBar() {
  return spritePx(64, 8, (g) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect ? g.roundRect(0.5, 0.5, 63, 7, 3.5) : g.rect(0.5, 0.5, 63, 7); g.fill();
  }, { crop: false });
}
// "falta material" badge: orange disc with a plank and an exclamation mark
function bpNoMat() {
  return spritePx(30, 30, (g, P) => {
    P.layer((g) => {
      g.fillStyle = rad(g, 13, 12, 2, 13, [[0, '#ffb35a'], [1, '#d4581e']]); g.beginPath(); circle(g, 15, 15, 12.5); g.fill();
      g.strokeStyle = 'rgba(255,240,220,0.9)'; g.lineWidth = 1.6; g.beginPath(); circle(g, 15, 15, 11); g.stroke();
      g.fillStyle = '#fff6e8'; g.fillRect(13.4, 7, 3.2, 10); g.beginPath(); circle(g, 15, 21.2, 1.9); g.fill();
    }, 2, 'rgba(40,20,10,0.9)');
  }, { pad: 4 });
}

// ---------------- registration ----------------
export function addStructures(add) {
  const wallAy = () => 1; // anchor = bottom of the nominal box (foot of the front face = tile bottom edge)
  for (const kind of ['wood', 'stone']) {
    for (let m = 0; m < 16; m++) { const c = wallSprite(kind, m); add(`wall_${kind}_${m}`, c, 0.5, wallAy(c)); }
  }
  // legacy single-sprite names (old saves, icons)
  { const c = wallLegacy('wood'); add('wall_wood', c, 0.5, wallAy(c)); }
  { const c = wallLegacy('stone'); add('wall_stone', c, 0.5, wallAy(c)); }
  for (let m = 0; m < 16; m++) { const c = fenceSprite(m); add('fence_wood_' + m, c, 0.5, 1); }
  { const c = fenceSprite(0); add('fence_wood', c, 0.5, 1); }
  const flatAy = (64 + BL) / (64 + BL * 2);
  for (let m = 0; m < 16; m++) {
    add('floor_wood_' + m, floorWood(m), 0.5, flatAy);
    add('floor_stone_' + m, floorStone(m), 0.5, flatAy);
    add('farm_plot_' + m, farmPlot(m), 0.5, flatAy);
  }
  add('floor_wood', floorWood(0), 0.5, flatAy);
  add('floor_stone', floorStone(0), 0.5, flatAy);
  add('farm_plot', farmPlot(0), 0.5, flatAy);
  // doors: closed composite (ghost / fallback) + parts for the opening animation
  add('door_wood_h', doorH('full'), 0.5, 1);
  add('door_wood_h_frame', doorH('frame'), 0.5, 1);
  add('door_wood_h_leaf', doorH('leaf'), 9 / 64, 1); // anchored at the hinge (left jamb); right leaf = sx < 0
  add('door_wood_v', doorV('full'), 0.5, 1);
  add('door_wood_v_frame', doorV('frame'), 0.5, 1);
  add('door_wood_v_post', doorV('post'), 0.5, 1);
  add('door_wood_v_leaf', doorV('leaf'), 0.5, (0.15 * 64 + (FH - DH)) / (64 + FH)); // anchored at the north jamb; south half = sy < 0
  add('door_wood_sill_h', doorSill(false), 0.5, 1);
  add('door_wood_sill_v', doorSill(true), 0.5, 1);
  add('door_wood', doorH('full'), 0.5, 1);
  add('gate_wood_h', gateH('full'), 0.5, 1);
  add('gate_wood_h_frame', gateH('frame'), 0.5, 1);
  add('gate_wood_h_leaf', gateH('leaf'), 10 / 64, 1);
  add('gate_wood_v', gateV('full'), 0.5, 1);
  add('gate_wood_v_frame', gateV('frame'), 0.5, 1);
  add('gate_wood_v_post', gateV('post'), 0.5, 1);
  add('gate_wood_v_leaf', gateV('leaf'), 0.5, (PH + 5 - 24) / (64 + PH));
  add('gate_wood', gateH('full'), 0.5, 1);
  add('scaffold_0', scaffold(), 0.5, 1);
  add('bp_tile', bpTile(), 0.5, 1);
  add('bp_bar', bpBar(), 0, 0.5);
  add('bp_nomat', bpNoMat(), 0.5, 1);
  for (let v = 0; v < 3; v++) add('crack_' + v, cracks(v), 0.5, 1);
  TEX.clear();
}

// geometry shared with composeWorld (px at 64 PPU → tiles)
// (y values = distance above the tile's bottom edge, i.e. o.y - y_world)
export const STRUCT_GEOM = {
  FH: FH / 64, PH: PH / 64,
  DOOR_H: { l: 9 / 64, r: 55 / 64 },
  DOOR_V: { a: (64 + FH - (0.15 * 64 + (FH - DH))) / 64, b: (64 + FH - (0.85 * 64 + (FH - DH))) / 64 },
  GATE_H: { l: 10 / 64, r: 54 / 64 },
  GATE_V: { a: (64 + PH - (PH + 5 - 24)) / 64, b: (64 + PH - (PH + 60 - 24)) / 64 },
};
