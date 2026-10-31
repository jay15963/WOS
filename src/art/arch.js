// Architecture styles & details (agent K): style variants of the construction pieces (walls, fences, gates, doors,
// floors) and the detail overlays picked in "Detalhes" (corners, trims, windows, wall-mounted things, nature),
// plus roof props for agent J's roofs. Same visual language as structures.js (3/4 view, light from the top-left,
// dark outlines, tile-periodic textures so runs are seamless).
//
// Atlas budget: a style is baked per autotile mask (walls / fences: 16 + 9 soft-corner variants for walls), every
// DETAIL is ONE overlay sprite (or a few pieces mirrored at draw time) drawn over the base mask sprite, and tones are
// draw-time tints — never style × detail × mask combinations.
//
// Wall facades are modular per story: front painters paint a band `(top, h)`; today one story (WALL_H) is baked, a
// taller facade (agent L) repeats the band upward with the base course (plinth / foot grime) only at the bottom.
// Sprite names: wst_<style>_<mask> (+ wst_<style>_s<mask> soft corners), kd_* wall / door details, kf_* floors,
// kfe_* fences, kg_* gates, kdr_* door leaves, roof_* roof props. Geometry for archCompose.js: ARCH_GEOM.

import { spritePx, rng, OW, TAU, SS, canvas, lin, rad, circle, mixc, tone, clamp, hex, rgb } from './paint.js';
import { wallTop, wallFront, planks, STORY_PX } from './structures.js';
import { lazyDef } from './lazyDefs.js';

// FH = one story of facade (agent L: STORY_PX = one tile); courses keep their 26-px-era sizes (LOG_RH, brick rows)
const FH = STORY_PX, OV = 3, EXT = 12, BL = 2, PH = 36;
const LOG_RH = 26 / 3;
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const pick = (arr, a, b) => arr[Math.floor(hash(a, b) * arr.length)];

// ---------------- tile-periodic texture cache (like structures.js) ----------------
const TR = 18, TW = 64 + TR * 2, TH = 64 + FH + TR * 2;
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
function transposed(g, fn) { g.save(); g.transform(0, 1, 1, 0, 0, 0); fn(); g.restore(); }
const orientOf = (m) => { const h = m & 10, v = m & 5; return h && !v ? 'h' : v && !h ? 'v' : m ? 'x' : 'h'; };

// ---------------- palettes ----------------
const LOG = { bark: '#6b4527', mid: '#8c5f38', hi: '#b98a58', dark: '#3f2814', end: '#d9b680', ring: '#a57a48', chink: '#d8cbb0' };
const TIM = { beam: '#4a2f1c', beamHi: '#6e4a2e', beamLo: '#2e1c10', plaster: '#eadcbf', plaster2: '#ddcca8', top: ['#946842', '#8a603c', '#9c7048', '#83593a'] };
const DAUB = { a: '#b89a72', b: '#a98a62', c: '#c7ab82', wattle: '#7a5a36', stake: '#5d4128' };
const RSTONE = ['#9b958a', '#8d877c', '#a8a194', '#857f75', '#b0a89a', '#958f84', '#7d776d'];
const COB = ['#a49b8c', '#958d7f', '#b3aa9a', '#8b8476', '#bdb3a2', '#9e9485'];
const BRICK = ['#a65a3e', '#9a5038', '#b3654a', '#8f4a32', '#ab6046', '#975238'];

// stones on a jittered periodic grid (tile-periodic: copies for kx, ky in -1..1); cells per 64 px
function stoneField(g, x0, y0, x1, y1, cols, rows, pal, seed, { mortar = '#58534b', round = 0.5, hiA = 0.4, loA = 0.45, gap = 1.3 } = {}) {
  g.fillStyle = mortar; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  const cw = 64 / cols, chh = 64 / rows;
  for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const off = r & 1 ? cw * 0.5 : 0;
      const jx = (hash(c + seed, r * 7) - 0.5) * cw * 0.3, jy = (hash(r + seed * 3, c * 5) - 0.5) * chh * 0.25;
      const cx = kx * 64 + c * cw + cw / 2 + off + jx, cy = ky * 64 + r * chh + chh / 2 + jy;
      const w = cw * (0.86 + hash(c, r + seed) * 0.22) / 2 - gap, h = chh * (0.84 + hash(r, c + seed) * 0.2) / 2 - gap;
      if (cx + w < x0 - 2 || cx - w > x1 + 2 || cy + h < y0 - 2 || cy - h > y1 + 2) continue;
      const col = pick(pal, c * 13 + r, seed + 5);
      g.fillStyle = col;
      g.beginPath();
      if (round >= 0.99) g.ellipse(cx, cy, w, h, 0, 0, TAU);
      else {
        // irregular rounded polygon
        const n = 6, pts = [];
        for (let k = 0; k < n; k++) { const a = (k / n) * TAU + hash(k, c + r * 9 + seed) * 0.6; const q = 0.82 + hash(k + 3, c * 3 + r + seed) * 0.3; pts.push([cx + Math.cos(a) * w * q, cy + Math.sin(a) * h * q]); }
        const rr = round;
        for (let k = 0; k < n; k++) {
          const p0 = pts[k], p1 = pts[(k + 1) % n];
          const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
          if (!k) g.moveTo(mx, my);
          const p2 = pts[(k + 2) % n];
          g.quadraticCurveTo(p1[0] * (1 - rr * 0.3) + mx * rr * 0.3, p1[1] * (1 - rr * 0.3) + my * rr * 0.3, (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
        }
        g.closePath();
      }
      g.fill();
      // light from the top-left, shade bottom-right
      g.save(); g.clip();
      g.fillStyle = `rgba(255,250,236,${hiA})`; g.beginPath(); g.ellipse(cx - w * 0.3, cy - h * 0.38, w * 0.7, h * 0.45, -0.2, 0, TAU); g.fill();
      g.fillStyle = `rgba(30,26,20,${loA})`; g.beginPath(); g.ellipse(cx + w * 0.35, cy + h * 0.55, w * 0.9, h * 0.5, 0, 0, TAU); g.fill();
      g.restore();
      if (hash(c * 5, r + seed * 2) < 0.3) { g.fillStyle = 'rgba(40,36,30,0.3)'; g.fillRect(cx - w * 0.2, cy, 1.2, 1.2); }
    }
  }
}

// courses of stones / bricks along x for front faces, rows from `top`; widths periodic in 64
function courses(g, x0, x1, top, bot, rh, pal, seed, { mortar = '#3e3a35', round = 1.5, jitter = 0.4, minW = 10, maxW = 22, hi = 'rgba(240,236,220,0.34)', lo = 'rgba(20,18,14,0.5)', blob = false } = {}) {
  g.fillStyle = mortar; g.fillRect(x0, top - 40, x1 - x0, bot - top + 40);
  for (let r = -4; r * rh < bot - top; r++) {
    const py = top + r * rh;
    // a periodic row layout: widths summing to 64
    const ws = [];
    let sum = 0, k = 0;
    while (sum < 64 - minW) { const w = Math.round(minW + hash(k + seed, r * 11 + 3) * (maxW - minW)); ws.push(w); sum += w; k++; }
    ws[ws.length - 1] += 64 - sum;
    const off = Math.round(hash(r + seed, 77) * 64);
    for (let kk = Math.floor((x0 - off) / 64) - 1; kk * 64 + off < x1 + 64; kk++) {
      let x = kk * 64 + off;
      ws.forEach((w, i) => {
        const X = x + 0.8, Y = py + 0.8, Wd = w - 1.6, Hd = rh - 1.6 - hash(i, r + seed) * jitter * 2;
        x += w;
        if (X > x1 + 2 || X + Wd < x0 - 2) return;
        g.fillStyle = pick(pal, i + r * 5, seed + 3);
        g.beginPath();
        if (blob) g.ellipse(X + Wd / 2, Y + Hd / 2, Wd / 2, Hd / 2, 0, 0, TAU);
        else if (g.roundRect) g.roundRect(X, Y, Wd, Hd, round); else g.rect(X, Y, Wd, Hd);
        g.fill();
        g.fillStyle = hi; g.fillRect(X + 1, Y, Wd - 2, 1.1);
        g.fillStyle = lo; g.fillRect(X + 1, Y + Hd - 1.1, Wd - 1, 1.1);
      });
    }
  }
}

// ---------------- wall styles: top face + front band painters ----------------
// top(g, m, x0, y0, x1, y1): fills the (extended) top face; front(g, m, x0, x1, top, h, base): one story band
function logTopTex(g, x0, y0, x1, y1) {
  // three logs running along x seen from above
  for (let i = -1; i <= 3; i++) {
    const cy = i * 21.33 + 10.7, r = 10.4;
    g.fillStyle = lin(g, 0, cy - r, 0, cy + r, [[0, LOG.dark], [0.25, LOG.hi], [0.5, LOG.mid], [1, LOG.dark]]);
    g.fillRect(x0, cy - r, x1 - x0, r * 2);
    g.strokeStyle = 'rgba(50,30,14,0.45)'; g.lineWidth = 0.8;
    for (let k = Math.floor(x0 / 9) - 1; k * 9 < x1; k++) { const x = k * 9 + hash(k, i) * 4; g.beginPath(); g.moveTo(x, cy - r * 0.6); g.lineTo(x + 5, cy - r * 0.5 + hash(i, k) * 3); g.stroke(); }
    g.fillStyle = 'rgba(255,230,190,0.25)'; g.fillRect(x0, cy - r * 0.55, x1 - x0, 1.4);
    g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(x0, cy + r - 1, x1 - x0, 1.2);
  }
}
const WSTYLE = {
  plank: { round: true, top: (g, m, x0, y0, x1, y1) => wallTop(g, 'wood', m, x0, y0, x1, y1), front: null, a: 'wood' },
  cut: { round: false, top: (g, m, x0, y0, x1, y1) => wallTop(g, 'stone', m, x0, y0, x1, y1), front: null, a: 'stone' },
  log: {
    round: true,
    top(g, m) {
      const o = orientOf(m);
      if (o === 'v') cached(g, 'k_logt_v', (g, a, b, c, d) => transposed(g, () => logTopTex(g, b, a, d, c)));
      else cached(g, 'k_logt_h', logTopTex);
      if (o === 'x') { g.save(); g.beginPath(); g.rect(10, 0, 44, 64); g.clip(); cached(g, 'k_logt_v', (g, a, b, c, d) => transposed(g, () => logTopTex(g, b, a, d, c))); g.restore(); }
    },
    front(g, m, x0, x1, top, h) {
      cached(g, 'k_logf', (g, a, b, c) => {
        const rh = LOG_RH;
        for (let r = -6; r < Math.ceil(FH / rh) + 2; r++) {
          const y = 64 + r * rh;
          g.fillStyle = LOG.chink; g.fillRect(a, y - 0.8, c - a, rh + 1.6);
          g.fillStyle = lin(g, 0, y, 0, y + rh, [[0, LOG.hi], [0.35, LOG.mid], [1, LOG.dark]]);
          g.beginPath(); if (g.roundRect) g.roundRect(a, y + 0.6, c - a, rh - 1.2, 3); else g.rect(a, y + 0.6, c - a, rh - 1.2); g.fill();
          g.strokeStyle = 'rgba(40,24,12,0.4)'; g.lineWidth = 0.7;
          for (let k = Math.floor(a / 11); k * 11 < c; k++) { const x = k * 11 + hash(k, r) * 5; g.beginPath(); g.moveTo(x, y + rh * 0.35); g.lineTo(x + 6, y + rh * 0.42); g.stroke(); }
          g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(a, y + 1.4, c - a, 1);
        }
      });
      // crossed log ends at free ends (the cabin corner)
      const rh = LOG_RH;
      for (const side of [!(m & 8) ? 0 : -1, !(m & 2) ? 1 : -1]) {
        if (side < 0) continue;
        const cx = side ? 60 : 4;
        for (let r = 0; r < Math.round(FH / rh); r++) {
          const cy = top + r * rh + rh / 2;
          g.fillStyle = LOG.bark; g.beginPath(); g.ellipse(cx, cy, 5.4, rh / 2 - 0.2, 0, 0, TAU); g.fill();
          g.fillStyle = LOG.end; g.beginPath(); g.ellipse(cx, cy, 4.3, rh / 2 - 1.2, 0, 0, TAU); g.fill();
          g.strokeStyle = LOG.ring; g.lineWidth = 0.7; g.beginPath(); g.ellipse(cx, cy, 2.6, rh / 2 - 2.4, 0, 0, TAU); g.stroke();
          g.fillStyle = LOG.ring; g.beginPath(); circle(g, cx, cy, 0.8); g.fill();
        }
      }
    },
  },
  timber: {
    round: true,
    top: (g, m, x0, y0, x1, y1) => beamTop(g, m, x0, y0, x1, y1),
    front(g, m, x0, x1, top, h) { cached(g, 'k_timf', (g, a, b, c) => timberFront(g, a, c, false)); timberEnds(g, m, top, h); },
  },
  tbrick: {
    round: false,
    top: (g, m, x0, y0, x1, y1) => beamTop(g, m, x0, y0, x1, y1),
    front(g, m, x0, x1, top, h) { cached(g, 'k_tbrf', (g, a, b, c) => timberFront(g, a, c, true)); timberEnds(g, m, top, h); },
  },
  wattle: {
    round: true,
    top(g, m) {
      cached(g, 'k_watt', (g, a, b, c, d) => {
        g.fillStyle = DAUB.c; g.fillRect(a, b, c - a, d - b);
        for (let i = 0; i < 140; i++) {
          const x = hash(i, 1) * 64, y = hash(i, 2) * 64;
          for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
            const X = x + kx * 64, Y = y + ky * 64;
            if (X < a || X > c || Y < b || Y > d) continue;
            g.fillStyle = i % 3 ? 'rgba(120,92,58,0.35)' : 'rgba(255,240,200,0.35)';
            g.beginPath(); g.ellipse(X, Y, 1.5 + hash(i, 3) * 2.5, 0.8 + hash(i, 4), hash(i, 5) * 3, 0, TAU); g.fill();
          }
        }
        g.strokeStyle = 'rgba(210,180,110,0.55)'; g.lineWidth = 0.7; // straw bits
        for (let i = 0; i < 40; i++) { const x = hash(i, 8) * 64, y = hash(i, 9) * 64; for (const [kx, ky] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) { g.beginPath(); g.moveTo(x + kx * 64, y + ky * 64); g.lineTo(x + kx * 64 + 3, y + ky * 64 + (hash(i, 10) - 0.5) * 3); g.stroke(); } }
      });
    },
    front(g, m, x0, x1, top, h) {
      cached(g, 'k_wattf', (g, a, b, c) => {
        g.fillStyle = lin(g, 0, 40, 0, 64 + FH, [[0, DAUB.c], [0.6, DAUB.a], [1, DAUB.b]]); g.fillRect(a, 30, c - a, FH + 44);
        // stakes faintly showing through
        for (let k = Math.floor(a / 16) - 1; k * 16 < c; k++) { g.fillStyle = 'rgba(80,56,30,0.18)'; g.fillRect(k * 16 + 6, 30, 3, FH + 44); }
        // patches where the daub fell off: woven wattle
        for (const [px, py, pw, ph] of [[8, 64 + FH * 0.22, 16, 9], [40, 64 + FH * 0.48, 13, 7], [24, 64 + FH * 0.74, 10, 6], [26, 52, 10, 6]]) {
          for (const kx of [-64, 0, 64]) {
            const X = px + kx;
            if (X > c || X + pw < a) continue;
            g.save(); g.beginPath(); g.ellipse(X + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, TAU); g.clip();
            g.fillStyle = DAUB.stake; g.fillRect(X - 2, py - 2, pw + 4, ph + 4);
            g.strokeStyle = DAUB.wattle; g.lineWidth = 2.2;
            for (let y = py - 4; y < py + ph + 4; y += 3.2) { g.beginPath(); g.moveTo(X - 2, y); g.quadraticCurveTo(X + pw / 2, y + 1.6, X + pw + 2, y); g.stroke(); }
            g.restore();
            g.strokeStyle = 'rgba(90,64,36,0.6)'; g.lineWidth = 0.9; g.beginPath(); g.ellipse(X + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, TAU); g.stroke();
          }
        }
        for (let i = 0; i < 60 + FH; i++) { const x = hash(i, 21) * 64, y = 40 + hash(i, 22) * (FH + 24); for (const kx of [-64, 0, 64]) { g.fillStyle = i & 1 ? 'rgba(90,66,40,0.25)' : 'rgba(255,240,210,0.22)'; g.fillRect(x + kx, y, 1.6, 1.2); } }
      });
    },
  },
  rough: {
    round: false,
    top(g) { cached(g, 'k_rought', (g, a, b, c, d) => stoneField(g, a, b, c, d, 4, 4, RSTONE, 3, { mortar: '#5c574e', round: 0.6 })); },
    front(g, m, x0, x1, top, h) {
      cached(g, 'k_roughf', (g, a, b, c) => courses(g, a, c, 64, 64 + FH, 26 / 3, RSTONE.map((x) => tone(x, 0.78)), 7, { mortar: '#3c3832', round: 3.5, jitter: 1.2, minW: 9, maxW: 20 }));
    },
  },
  cobble: {
    round: false,
    top(g) { cached(g, 'k_cobt', (g, a, b, c, d) => stoneField(g, a, b, c, d, 5, 5, COB, 11, { mortar: '#cfc6b2', round: 1, hiA: 0.45, loA: 0.4, gap: 1.6 })); },
    front(g, m, x0, x1, top, h) {
      cached(g, 'k_cobf', (g, a, b, c) => courses(g, a, c, 64, 64 + FH, 26 / 4, COB.map((x) => tone(x, 0.82)), 13, { mortar: '#b8ae98', blob: true, minW: 7, maxW: 13, jitter: 0.6, lo: 'rgba(30,26,20,0.45)' }));
    },
  },
};
const STONE_STYLES = new Set(['cut', 'rough', 'cobble', 'tbrick']);
export const WALL_STYLES = Object.keys(WSTYLE);

function beamTop(g, m) {
  const o = orientOf(m);
  const pal = { base: TIM.top, seam: '#24160c', grain: 'rgba(30,18,10,0.4)', hi: 'rgba(255,220,170,0.28)', knot: '#2e1c10' };
  if (o === 'v') cached(g, 'k_beamt_v', (g, a, b, c, d) => transposed(g, () => planks(g, b, a, d, c, 3, pal, 4, { nails: false })));
  else cached(g, 'k_beamt_h', (g, a, b, c, d) => planks(g, a, b, c, d, 3, pal, 2, { nails: false }));
  if (o === 'x') { // corner post cap where beams meet
    g.fillStyle = lin(g, 16, 16, 48, 48, [[0, '#7a5232'], [1, '#4a2f1c']]); g.fillRect(16, 16, 32, 32);
    g.strokeStyle = 'rgba(30,18,10,0.6)'; g.lineWidth = 1; g.strokeRect(19, 19, 26, 26);
    g.fillStyle = '#2a2a2e'; for (const [x, y] of [[21, 21], [43, 21], [21, 43], [43, 43]]) { g.beginPath(); circle(g, x, y, 1.4); g.fill(); }
  }
}
// timber frame band: plaster (or brick) panels between dark beams, braces alternating / and \ (period 64)
function timberFront(g, x0, x1, brick) {
  const top = 64, bot = 64 + FH;
  for (let r = -1; r <= 0; r++) { // also one band above (soft corner sweep)
    const T = top + r * FH, Bt = T + FH;
    if (brick) {
      g.fillStyle = '#5a4a3e'; g.fillRect(x0, T, x1 - x0, FH);
      for (let row = 0; row * 4.6 < FH; row++) for (let k = Math.floor(x0 / 9) - 1; k * 9 < x1; k++) {
        const X = k * 9 + (row & 1 ? 4.5 : 0), Y = T + row * 4.6;
        g.fillStyle = pick(BRICK, k + row * 7, 2); g.fillRect(X + 0.5, Y + 0.5, 8, 3.6);
        g.fillStyle = 'rgba(255,220,190,0.25)'; g.fillRect(X + 0.5, Y + 0.5, 8, 0.8);
      }
    } else {
      g.fillStyle = lin(g, 0, T, 0, Bt, [[0, TIM.plaster], [1, TIM.plaster2]]); g.fillRect(x0, T, x1 - x0, FH);
      for (let i = 0; i < 40; i++) { const x = hash(i, 31) * 64, y = T + 4 + hash(i, 32) * (FH - 8); for (const kx of [-64, 0, 64]) { g.fillStyle = i & 1 ? 'rgba(150,130,100,0.22)' : 'rgba(255,255,245,0.5)'; g.fillRect(x + kx, y, 1.8, 1.2); } }
    }
    const beam = (fn) => { g.fillStyle = TIM.beam; fn(); };
    // sill, top plate
    g.fillStyle = TIM.beam; g.fillRect(x0, Bt - 4.2, x1 - x0, 4.2); g.fillRect(x0, T, x1 - x0, 3.2);
    g.fillStyle = TIM.beamHi; g.fillRect(x0, Bt - 4.2, x1 - x0, 0.9); g.fillRect(x0, T, x1 - x0, 0.8);
    for (let k = Math.floor(x0 / 64) - 1; k * 64 < x1; k++) {
      const X = k * 64;
      // posts at 0 and 32
      for (const px of [0, 32]) { beam(() => g.fillRect(X + px - 2.8, T, 5.6, FH)); g.fillStyle = TIM.beamHi; g.fillRect(X + px - 2.8, T, 1.1, FH); }
      // braces
      g.strokeStyle = TIM.beam; g.lineWidth = 4.4; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(X + 3, Bt - 4); g.lineTo(X + 29, T + 3); g.moveTo(X + 35, T + 3); g.lineTo(X + 61, Bt - 4); g.stroke();
      g.strokeStyle = 'rgba(140,100,64,0.5)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(X + 3, Bt - 5.4); g.lineTo(X + 28, T + 2.6); g.moveTo(X + 36, T + 3.4); g.lineTo(X + 61, Bt - 5.4); g.stroke();
      // pegs
      g.fillStyle = '#2a1a0e'; for (const px of [0, 32]) { g.beginPath(); circle(g, X + px, T + 1.6, 0.8); g.fill(); g.beginPath(); circle(g, X + px, Bt - 2, 0.8); g.fill(); }
    }
    g.lineCap = 'round';
  }
}
function timberEnds(g, m, top, h) {
  // thicker corner posts at free ends
  for (const [free, x] of [[!(m & 8), 0], [!(m & 2), 58]]) {
    if (!free) continue;
    g.fillStyle = lin(g, x, 0, x + 6, 0, [[0, TIM.beamHi], [1, TIM.beamLo]]); g.fillRect(x, top - 1, 6, h + 1);
  }
}

// generic top-face bevel (lit N/W, shaded E/S) on unconnected edges
function bevel(g, m, x0, y0, x1, y1) {
  if (!(m & 1)) { g.fillStyle = 'rgba(255,245,220,0.26)'; g.fillRect(x0, 0, x1 - x0, 3); }
  if (!(m & 8)) { g.fillStyle = 'rgba(255,245,220,0.18)'; g.fillRect(0, y0, 3, y1 - y0); }
  if (!(m & 2)) { g.fillStyle = 'rgba(30,18,8,0.26)'; g.fillRect(61, y0, 3, y1 - y0); }
  if (!(m & 4)) { g.fillStyle = 'rgba(30,18,8,0.2)'; g.fillRect(x0, 61, x1 - x0, 3); }
}
function frontFinish(g, m, x0, x1, top) {
  const bot = top + FH;
  g.fillStyle = 'rgba(255,240,210,0.32)'; g.fillRect(x0, top, x1 - x0, 1.2);
  g.fillStyle = 'rgba(20,12,6,0.32)'; g.fillRect(x0, top + 1.2, x1 - x0, 2);
  g.fillStyle = lin(g, 0, bot - 10, 0, bot, [[0, 'rgba(15,10,6,0)'], [1, 'rgba(15,10,6,0.4)']]); g.fillRect(x0, bot - 10, x1 - x0, 10);
  if (!(m & 2)) { g.fillStyle = lin(g, 54, 0, 64, 0, [[0, 'rgba(15,10,6,0)'], [1, 'rgba(15,10,6,0.36)']]); g.fillRect(54, top - 14, 10, FH + 14); }
  if (!(m & 8)) { g.fillStyle = 'rgba(255,240,210,0.1)'; g.fillRect(0, top - 14, 3, FH + 14); }
}

// top outline of a wall tile: rect with rounded (r) or chamfered convex corners
function topPath(g, m, x0, y0, x1, y1, shape, dy = 0) {
  const R = shape === 'round' ? 10 : shape === 'cham' ? 10 : 0;
  const nw = R && !(m & 1) && !(m & 8), ne = R && !(m & 1) && !(m & 2), sw = R && !(m & 4) && !(m & 8), se = R && !(m & 4) && !(m & 2);
  const Y0 = y0 + dy, Y1 = y1 + dy;
  const corner = (on, cx, cy, ax, ay, bx, by) => {
    if (!on) { g.lineTo(cx, cy); return; }
    g.lineTo(ax, ay);
    if (shape === 'round') g.quadraticCurveTo(cx, cy, bx, by); else g.lineTo(bx, by);
  };
  g.moveTo(x0 + (nw ? R : 0), Y0);
  corner(ne, x1, Y0, x1 - R, Y0, x1, Y0 + R);
  corner(se, x1, Y1, x1, Y1 - R, x1 - R, Y1);
  corner(sw, x0, Y1, x0 + R, Y1, x0, Y1 - R);
  corner(nw, x0, Y0, x0, Y0 + R, x0 + R, Y0);
  g.closePath();
}
function cutSides(g, m) {
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8, big = 400;
  if (W) g.clearRect(-big, -big, big - OV, big * 2);
  if (E) g.clearRect(64 + OV, -big, big, big * 2);
  if (N) g.clearRect(-big, -big, big * 2, big - OV);
  if (S) g.clearRect(-big, 64 + OV, big * 2, big);
  if (N && E) g.clearRect(64, -big, big, big);
  if (N && W) g.clearRect(-big, -big, big, big);
  if (S && E) g.clearRect(64, 64, big, big);
  if (S && W) g.clearRect(-big, 64, big, big);
}

const COVER_BOARD = new Set(['plank', 'timber', 'tbrick']);
export function wallStyleSprite(style, m, soft = false) {
  const st = WSTYLE[style];
  const S = m & 4;
  const shape = soft ? (st.round ? 'round' : 'cham') : null;
  return spritePx(64, 64 + FH, (g, P) => {
    const x0 = m & 8 ? -EXT : 0, x1 = m & 2 ? 64 + EXT : 64, y0 = m & 1 ? -EXT : 0, y1 = S ? 64 + EXT : 64;
    P.layer((g) => {
      if (!S) {
        // front first, clipped to the top outline swept down by the wall height (rounded corners stay round)
        g.save(); g.beginPath(); topPath(g, m, x0, y0, x1, y1, shape, FH); g.clip();
        if (st.front) st.front(g, m, x0, x1, 64, FH);
        else { g.save(); g.translate(0, -FH); wallFront(g, st.a, m, x0, x1); g.restore(); wallFront(g, st.a, m, x0, x1); }
        if (st.front) frontFinish(g, m, x0, x1, 64);
        if (shape) { // curved corner shading on the swept part
          for (const [on, x, k] of [[!(m & 8), 0, 1], [!(m & 2), 64, -1]]) {
            if (!on) continue;
            g.fillStyle = lin(g, x, 0, x + k * 12, 0, [[0, k > 0 ? 'rgba(255,240,210,0.16)' : 'rgba(15,10,6,0.4)'], [1, 'rgba(0,0,0,0)']]);
            g.fillRect(Math.min(x, x + k * 12), 30, 12, FH + 44);
          }
          // wooden looks: a rounded cover board down each free front corner (never a grey shape on wood)
          if (COVER_BOARD.has(style)) { if (!(m & 8)) coverBoard(g, style, 0, false); if (!(m & 2)) coverBoard(g, style, 64, true); }
        }
        g.restore();
      }
      g.save(); g.beginPath(); topPath(g, m, x0, y0, x1, y1, shape, 0); g.clip();
      st.top(g, m, x0, y0, x1, y1);
      if (st.front) bevel(g, m, x0, y0, x1, y1);
      g.restore();
    }, OW);
    cutSides(g, m);
  }, { pad: 12 });
}
// masks with at least one convex corner (the only ones with a soft variant)
export const SOFT_MASKS = [];
for (let m = 0; m < 16; m++) if ((!(m & 1) && !(m & 8)) || (!(m & 1) && !(m & 2)) || (!(m & 4) && !(m & 8)) || (!(m & 4) && !(m & 2))) SOFT_MASKS.push(m);

// ---------------- wall detail overlays (64 × (64+FH) nominal box, anchor bottom-centre like the walls) ----------------
const wbox = (fn, ow = 2.4) => spritePx(64, 64 + FH, (g, P) => P.layer((g) => fn(g, P), ow), { pad: 14 });
const WOOD = { deep: '#3b2616', dark: '#5a3b22', mid: '#7d5532', light: '#9c6e43', high: '#b98a58' };
const IRON = { dark: '#2c2c31', mid: '#4a4a52', light: '#6e6e78', high: '#9a9aa6' };
const F0 = 64, F1 = 64 + FH; // front band rows
// mid-face details (windows, mounted things, door ornaments) were drawn for a 26-px face: centre them in the story
const FM = F0 + Math.round((FH - 26) * 0.45);
const WIN0 = F0 + Math.round(Math.max(3, FH * 0.2)), WIN1 = WIN0 + Math.round(Math.max(17, FH * 0.45));

// ---------------- corner pieces (per material family) ----------------
// Every wall style has a corner FAMILY (CORNER_FAM): its corner pieces, buttresses and trims are painted in that
// material and colour, so a wooden wall never shows grey stone unless the option is a stone one ("de pedra").
// Four sprites per corner piece (nw, ne, sw, se): the light stays top-left on both sides (no mirroring at draw time).
// North corners show only what rises above the wall top or stands out beside it; south corners run the whole story
// (FH) down the front. Projection: a point at plan y (0..64 in the tile, 64 = south edge) and height h (px) is drawn at
// screen y = plan y + FH - h, so the top face (h = FH) is the 64×64 square and the front runs from 64 to 64 + FH.
export const CORNER_FAM = { plank: 'plank', log: 'log', timber: 'timber', tbrick: 'timber', wattle: 'wattle', cut: 'cut', rough: 'rough', cobble: 'cobble' };
export const WOOD_FAMS = ['plank', 'log', 'timber', 'wattle'], STONE_FAMS = ['cut', 'rough', 'cobble'], QUOIN_FAMS = ['lime', ...STONE_FAMS];
export const CORNERS = ['nw', 'ne', 'sw', 'se'];
const WP = { // wood families: lit / mid / shade = a vertical face lit from the left; end0 / end1 = end grain
  plank: { lit: '#9c6e43', mid: '#7c5331', shade: '#553620', hi: 'rgba(255,226,180,0.42)', lo: 'rgba(30,16,6,0.5)', end0: '#a8794a', end1: '#7a5130', ring: 'rgba(78,46,20,0.55)', grain: 'rgba(40,22,10,0.38)', top0: '#c49563', top1: '#9a6c40' },
  log: { lit: '#c29464', mid: '#946640', shade: '#5e3e22', hi: 'rgba(255,230,190,0.4)', lo: 'rgba(30,16,6,0.5)', end0: '#dfbf8a', end1: '#b68c5a', ring: 'rgba(140,96,52,0.8)', grain: 'rgba(60,36,16,0.4)', bark: '#6b4527', top0: '#b98a58', top1: '#8c5f38' },
  timber: { lit: '#6e4a2e', mid: '#4a2f1c', shade: '#2e1c10', hi: 'rgba(255,214,160,0.26)', lo: 'rgba(10,6,2,0.5)', end0: '#7c5434', end1: '#4e321e', ring: 'rgba(24,14,6,0.6)', grain: 'rgba(16,10,4,0.42)', top0: '#7a5232', top1: '#4a2f1c' },
  wattle: { lit: '#94714c', mid: '#6e5032', shade: '#4a3420', hi: 'rgba(255,230,190,0.32)', lo: 'rgba(30,16,6,0.5)', end0: '#c9a678', end1: '#9c7a50', ring: 'rgba(110,80,44,0.7)', grain: 'rgba(40,26,12,0.4)', bark: '#5d4128', top0: '#a8855a', top1: '#7a5a36' },
};
const SP = { // stone families (+ lime: the dressed stone used for "de pedra" pieces on wooden walls)
  cut: { lit: '#d2cbbd', mid: '#aaa295', shade: '#7c756a', top0: '#e0d9cc', top1: '#b2aa9d', mortar: '#57524a', rough: 0 },
  rough: { lit: '#c2baab', mid: '#9a9285', shade: '#6e685e', top0: '#cec6b7', top1: '#a29a8c', mortar: '#45413a', rough: 1 },
  cobble: { lit: '#d6ccb8', mid: '#afa591', shade: '#847b6a', top0: '#e2d9c6', top1: '#b9af9b', mortar: '#8a816d', rough: 0 },
  lime: { lit: '#dcd3bf', mid: '#b8ae99', shade: '#8a8170', top0: '#e8e1cf', top1: '#c0b7a2', mortar: '#6a6252', rough: 0 },
};
const CAPW = { lit: '#8e623a', mid: '#6e4a2c', front: '#5e3d22', shade: '#3a2414', line: 'rgba(30,16,6,0.55)', hi: 'rgba(255,220,170,0.35)', knob: '#4a2f1c' };
const CAPT = { lit: '#6a4630', mid: '#4e3220', front: '#40281a', shade: '#24160a', line: 'rgba(10,6,2,0.55)', hi: 'rgba(255,214,160,0.25)', knob: '#2e1c10' };
const THATCH = { lit: '#c4a45e', mid: '#a4873f', front: '#93773a', shade: '#665126', line: 'rgba(70,52,18,0.65)', hi: 'rgba(255,236,180,0.35)', knob: '#6e5424' };
const scr = (planY, h) => planY + FH - h;
const cbox = (fn, pad = 24) => spritePx(64, 64 + FH, (g, P) => fn(P), { pad });
const rampH = (g, x, w, p) => lin(g, x, 0, x + w, 0, [[0, p.lit], [0.42, p.mid], [1, p.shade]]);
const rampCyl = (g, x, w, p) => lin(g, x, 0, x + w, 0, [[0, p.mid], [0.27, p.lit], [0.62, p.mid], [1, p.shade]]);
function grainV(g, x, y0, y1, w, p, seed) {
  g.strokeStyle = p.grain; g.lineWidth = 0.7;
  for (let k = 0; k < 2; k++) {
    const gx = x + w * (0.3 + k * 0.38) + (hash(seed, k) - 0.5) * 1.5;
    g.beginPath(); g.moveTo(gx, y0 + 2);
    for (let y = y0 + 6; y < y1 - 1; y += 6) g.lineTo(gx + Math.sin((y + seed * 13 + k * 7) * 0.23) * 0.7, y);
    g.stroke();
  }
}
// end of a post seen from above: rings, a check, a chamfered rim (squared) or the bark ring (round)
function endGrain(g, x, y, w, h, p, round) {
  const cx = x + w / 2, cy = y + h / 2;
  g.fillStyle = lin(g, x, y, x + w, y + h, [[0, p.end0], [1, p.end1]]);
  g.beginPath(); if (round) g.ellipse(cx, cy, w / 2, h / 2, 0, 0, TAU); else g.rect(x, y, w, h); g.fill();
  g.strokeStyle = p.ring; g.lineWidth = 0.7;
  for (const k of [0.72, 0.46, 0.22]) { g.beginPath(); g.ellipse(cx + 0.4, cy + 0.3, (w / 2) * k, (h / 2) * k, 0, 0, TAU); g.stroke(); }
  g.beginPath(); g.moveTo(cx + 0.4, cy + 0.3); g.lineTo(cx + w * 0.34, cy + h * 0.2); g.stroke();
  if (round) { g.strokeStyle = p.bark || p.shade; g.lineWidth = 1.3; g.beginPath(); g.ellipse(cx, cy, w / 2 - 0.6, h / 2 - 0.6, 0, 0, TAU); g.stroke(); return; }
  g.fillStyle = 'rgba(255,236,200,0.42)'; g.fillRect(x, y, w, 1.1); g.fillRect(x, y, 1.1, h);
  g.fillStyle = 'rgba(30,16,6,0.42)'; g.fillRect(x, y + h - 1.1, w, 1.1); g.fillRect(x + w - 1.1, y, 1.1, h);
}
function pin(g, kind, x, y) {
  if (kind === 'nail') {
    g.fillStyle = '#26221f'; g.beginPath(); circle(g, x, y, 1.15); g.fill();
    g.fillStyle = 'rgba(210,210,220,0.6)'; g.beginPath(); circle(g, x - 0.35, y - 0.35, 0.42); g.fill();
  } else {
    g.fillStyle = '#24160b'; g.beginPath(); circle(g, x, y, 1.55); g.fill();
    g.fillStyle = '#93684a'; g.beginPath(); circle(g, x - 0.25, y - 0.25, 1); g.fill();
  }
}
function lash(g, x, w, y) { // rope binding round a pole
  g.fillStyle = '#9c8350'; g.fillRect(x - 0.6, y, w + 1.2, 4.2);
  g.strokeStyle = '#dcc68e'; g.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x - 0.6, y + 0.5 + k * 1.35); g.lineTo(x + w + 0.6, y + 1.5 + k * 1.35); g.stroke(); }
}
function footShade(g, x, w, y1, k = 10) {
  g.fillStyle = lin(g, 0, y1 - k, 0, y1, [[0, 'rgba(15,10,6,0)'], [1, 'rgba(15,10,6,0.45)']]); g.fillRect(x, y1 - k, w, k);
}
// a dressed stone face (lit top-left), rough families get a hand-knapped outline
function stoneFace(g, x, y, w, h, p, seed) {
  g.fillStyle = lin(g, x, y, x + w * 0.8, y + h, [[0, p.lit], [0.55, p.mid], [1, p.shade]]);
  if (p.rough) {
    const j = (k) => (hash(seed * 7 + k, k * 3) - 0.5) * 1.6;
    g.beginPath(); g.moveTo(x + 1 + j(1), y + j(2)); g.lineTo(x + w - 1 + j(3), y + j(4)); g.lineTo(x + w + j(5) * 0.5, y + h * 0.5); g.lineTo(x + w - 1 + j(6), y + h + j(7) * 0.5);
    g.lineTo(x + 1 + j(8), y + h + j(9) * 0.5); g.lineTo(x + j(10) * 0.5, y + h * 0.5); g.closePath(); g.fill();
  } else g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,252,240,0.5)'; g.fillRect(x + 0.4, y, w - 0.8, 1); g.fillRect(x, y + 0.4, 1, h - 0.8);
  g.fillStyle = 'rgba(30,26,20,0.42)'; g.fillRect(x + 0.4, y + h - 1, w - 0.8, 1); g.fillRect(x + w - 1, y + 0.4, 1, h - 0.8);
  g.fillStyle = 'rgba(40,36,30,0.22)';
  for (let i = 0; i < 2 + (w * h) / 80; i++) g.fillRect(x + 1.6 + hash(i, seed) * (w - 3.2), y + 1.6 + hash(seed, i + 9) * (h - 3.2), 0.9, 0.9);
}
// a slab seen from above (x, y, w, h) with its south face t px below it
function slab(g, x, y, w, h, t, p) {
  if (t > 0) { g.fillStyle = lin(g, 0, y + h, 0, y + h + t, [[0, p.mid], [1, p.shade]]); g.fillRect(x, y + h, w, t); }
  g.fillStyle = lin(g, x, y, x + w, y + h, [[0, p.top0], [1, p.top1]]); g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,252,240,0.5)'; g.fillRect(x, y, w, 1.1); g.fillRect(x, y, 1.1, h);
  g.fillStyle = 'rgba(30,26,20,0.35)'; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
}
// a box standing on plan (cx, cy): half-width hw, half-depth hd, heights h0..h1 → [top y0, top y1, front bottom]
function box(g, cx, cy, hw, hd, h0, h1, p, top = true) {
  const yt = scr(cy - hd, h1), yb = scr(cy + hd, h1), yf = scr(cy + hd, h0);
  g.fillStyle = rampH(g, cx - hw, 2 * hw, p); g.fillRect(cx - hw, yb, 2 * hw, yf - yb);
  if (top) { g.fillStyle = lin(g, cx - hw, yt, cx + hw, yb, [[0, p.top0], [1, p.top1]]); g.fillRect(cx - hw, yt, 2 * hw, yb - yt); }
  return [yt, yb, yf];
}
// an upright cylinder on plan (cx, cy), radius r, heights h0..h1 (its top circle is left to the caller)
function cylinder(g, cx, cy, r, h0, h1, p, top = false) {
  const y1 = scr(cy, h1), y0 = scr(cy, h0);
  g.fillStyle = rampCyl(g, cx - r, 2 * r, p);
  g.beginPath(); g.moveTo(cx - r, y1); g.lineTo(cx + r, y1); g.lineTo(cx + r, y0); g.ellipse(cx, y0, r, r, 0, 0, Math.PI); g.closePath(); g.fill();
  if (top) { g.fillStyle = lin(g, cx - r, y1 - r, cx + r, y1 + r, [[0, p.top0], [1, p.top1]]); g.beginPath(); g.ellipse(cx, y1, r, r, 0, 0, TAU); g.fill(); }
  return [y1, y0 + r];
}
// only the part outside the wall shows beside a north corner (below the wall top)
function besideOnly(g, e, s, fn) {
  if (s) { fn(); return; }
  g.save(); g.beginPath(); g.rect(e ? 64 : -60, -60, 60, 400); g.clip(); fn(); g.restore();
}

// ---- wooden posts (squared timber; wattle: a round pole; endcap: taller, with a little roof cap) ----
function woodPost(fam, c, capped = false) {
  if (fam === 'log' && !capped) return logNotch(c);
  return cbox((P) => {
    const p = WP[fam], e = c[1] === 'e', s = c[0] === 's';
    const round = fam === 'wattle' || fam === 'log';
    const w = fam === 'timber' ? 13 : round ? 13 : 15, rise = capped ? 9 : round ? 5 : 4;
    const x = e ? 66 - w : -2, ty = (s ? 64 - w : 0) - rise; // 2 px proud of both faces
    const fy0 = ty + w, fy1 = s ? F1 : ty + w + rise;
    P.layer((g) => {
      g.fillStyle = round ? rampCyl(g, x, w, p) : rampH(g, x, w, p);
      g.fillRect(x, fy0, w, fy1 - fy0);
      if (round) {
        g.strokeStyle = 'rgba(30,18,8,0.35)'; g.lineWidth = 0.8;
        for (let k = 0; k < 3; k++) { const gx = x + 2.2 + (k * (w - 4.4)) / 2; g.beginPath(); g.moveTo(gx, fy0 + 2); g.lineTo(gx + (hash(k, w) - 0.5) * 2, fy1 - 2); g.stroke(); }
        if (s) for (const ky of [0.3, 0.7]) { g.fillStyle = p.shade; g.beginPath(); g.ellipse(x + w * 0.62, fy0 + (fy1 - fy0) * ky, 1.7, 1.1, 0, 0, TAU); g.fill(); }
      } else {
        grainV(g, x, fy0, fy1, w, p, w + (e ? 3 : 1));
        g.fillStyle = p.hi; g.fillRect(x + 1.3, fy0, 1, fy1 - fy0); // chamfered arrises: lit left, shaded right
        g.fillStyle = p.lo; g.fillRect(x + w - 2.3, fy0, 1, fy1 - fy0);
      }
      if (s) {
        if (fam === 'plank') for (const y of [F0 + 6.5, F0 + Math.round(FH / 2) - 0.5, F1 - 5.5]) { pin(g, 'nail', x + w * 0.34, y); pin(g, 'nail', x + w * 0.68, y); }
        else if (fam === 'timber') for (const y of [F0 + 1.8, F0 + FH / 2, F1 - 2.2]) pin(g, 'peg', x + w / 2, y);
        else { lash(g, x, w, F0 + 9); lash(g, x, w, F1 - 16); }
        footShade(g, x, w, F1);
      }
      endGrain(g, x, ty, w, w, p, round);
      if (capped) postCap(g, x, ty, w, fam === 'wattle' ? THATCH : fam === 'timber' ? CAPT : CAPW);
    }, 2.4);
    if (fam === 'timber' && s) P.layer((g) => { // the frame's brace runs into the post: pegged joint
      const d = w + 2.6, jx = e ? 64 - d : d, jy = F1 - 4 - (d - 3) * ((FH - 7) / 26);
      pin(g, 'peg', jx, jy);
    }, 0.6);
  });
}
// a small pyramid roof on a post top (x, y, w)
function postCap(g, x, y, w, C) {
  const o = 2.4, x0 = x - o, x1 = x + w + o, y0 = y - o - 1, y1 = y + w + o - 1, ax = (x0 + x1) / 2, ay = (y0 + y1) / 2 - 8;
  g.fillStyle = C.shade; g.fillRect(x0, y1 - 0.6, x1 - x0, 2.6);
  const tri = (a, b, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(ax, ay); g.closePath(); g.fill(); };
  tri([x0, y0], [x1, y0], C.mid);
  tri([x1, y0], [x1, y1], C.shade);
  tri([x0, y1], [x1, y1], C.front);
  tri([x0, y0], [x0, y1], C.lit);
  g.strokeStyle = C.line; g.lineWidth = 0.7;
  for (let k = 1; k < 3; k++) { const t = k / 3; g.beginPath(); g.moveTo(x0 + (ax - x0) * t, y1 + (ay - y1) * t); g.lineTo(x1 + (ax - x1) * t, y1 + (ay - y1) * t); g.stroke(); }
  g.strokeStyle = C.hi; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x0, y1); g.lineTo(ax, ay); g.stroke();
  g.fillStyle = C.knob; g.beginPath(); circle(g, ax, ay - 1.3, 1.8); g.fill();
  g.fillStyle = C.hi; g.beginPath(); circle(g, ax - 0.5, ay - 1.8, 0.6); g.fill();
}
// log cabin corner: saddle-notched crossings. Down the front, course by course: the side wall's log ends in a round
// sawn end (half of it past the corner), and between them the run's own log runs on past the corner and ends there.
// North corners only show the two top logs poking out (the rest is behind the wall).
function logNotch(c) {
  return cbox((P) => P.layer((g) => {
    const e = c[1] === 'e', s = c[0] === 's', rh = LOG_RH, OUT = 9;
    const X = (x) => (e ? 64 - x : x), R = (x0, w) => (e ? 64 - x0 - w : x0);
    const run = (y0, y1) => { // the run's log continuing past the corner, rounded where it ends
      const h = y1 - y0, x = R(-OUT, OUT + 8);
      g.fillStyle = lin(g, 0, y0, 0, y1, [[0, LOG.hi], [0.35, LOG.mid], [1, LOG.dark]]);
      g.beginPath(); if (g.roundRect) g.roundRect(x, y0, OUT + 8, h, e ? [0, h / 2, h / 2, 0] : [h / 2, 0, 0, h / 2]); else g.rect(x, y0, OUT + 8, h); g.fill();
      g.fillStyle = 'rgba(255,232,196,0.32)'; g.fillRect(x + 2, y0 + 1, OUT + 4, 0.9);
      g.strokeStyle = 'rgba(40,24,12,0.38)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(X(-OUT + 3), y0 + h * 0.55); g.lineTo(X(5), y0 + h * 0.5); g.stroke();
      // sawn end, seen edge-on at the tip
      g.fillStyle = LOG.end; g.beginPath(); g.ellipse(X(-OUT + 1.6), (y0 + y1) / 2, 1.3, h / 2 - 1.2, 0, 0, TAU); g.fill();
    };
    const end = (cy, ry) => { // the side wall's log end facing the viewer
      const cx = X(0.5), rx = 8.2;
      g.fillStyle = LOG.bark; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = lin(g, cx - rx, cy - ry, cx + rx, cy + ry, [[0, '#ead09c'], [0.6, '#cfa66e'], [1, '#b0864f']]);
      g.beginPath(); g.ellipse(cx, cy, rx - 1.3, ry - 1.2, 0, 0, TAU); g.fill();
      g.strokeStyle = LOG.ring; g.lineWidth = 0.65;
      for (const k of [0.7, 0.42, 0.18]) { g.beginPath(); g.ellipse(cx + 0.3, cy + 0.2, (rx - 1.3) * k, (ry - 1.2) * k, 0, 0, TAU); g.stroke(); }
      g.beginPath(); g.moveTo(cx + 0.3, cy + 0.2); g.lineTo(cx + (e ? -1 : 1) * 5, cy - ry * 0.5); g.stroke(); // drying check
      g.fillStyle = 'rgba(255,244,214,0.45)'; g.beginPath(); g.ellipse(cx - 2.4, cy - ry * 0.45, 2.6, 0.9, 0, 0, TAU); g.fill();
    };
    const topLog = (x, y, w, h, alongX) => { // a log end seen from above
      g.fillStyle = alongX ? lin(g, 0, y, 0, y + h, [[0, LOG.hi], [0.5, LOG.mid], [1, LOG.dark]]) : lin(g, x, 0, x + w, 0, [[0, LOG.hi], [0.5, LOG.mid], [1, LOG.dark]]);
      g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.min(w, h) / 2); else g.rect(x, y, w, h); g.fill();
      g.strokeStyle = 'rgba(40,24,12,0.4)'; g.lineWidth = 0.6; g.beginPath();
      if (alongX) { g.moveTo(x + 2, y + h * 0.45); g.lineTo(x + w - 2, y + h * 0.5); } else { g.moveTo(x + w * 0.45, y + 2); g.lineTo(x + w * 0.5, y + h - 2); }
      g.stroke();
    };
    if (s) {
      const n = Math.ceil(FH / rh);
      topLog(R(-OUT, OUT + 10), 64 - rh + 0.4, OUT + 10, rh - 0.8, true); // the run's top log, from above
      for (let r = 1; r < n; r += 2) { const y0 = F0 + r * rh; if (F1 - y0 > 2) run(y0 + 0.3, Math.min(F1, y0 + rh) - 0.3); }
      for (let r = 0; r < n; r += 2) {
        const y0 = F0 + r * rh, y1 = Math.min(F1, y0 + rh);
        if (y1 - y0 > 2.5) end((y0 + y1) / 2, (y1 - y0) / 2 + 0.9);
      }
    } else {
      topLog(R(-OUT, OUT + 10), 0.4, OUT + 10, rh - 0.8, true);  // the back run's top log past the side
      topLog(R(0.4, rh - 0.8), -OUT, rh - 0.8, OUT + 10, false); // the side wall's top log past the back
    }
  }, 2.2));
}

// ---- stone corner pieces ----
// dressed corner pier: three tall stones and a cap stone (north corners: the cap only)
function stonePost(fam, c) {
  return cbox((P) => P.layer((g) => {
    const p = SP[fam], e = c[1] === 'e', s = c[0] === 's';
    const w = 15, rise = 4, o = 1.6, x = e ? 65 - w : -1, ty = (s ? 64 - w : 0) - rise;
    if (s) {
      const top = ty + w, hh = (F1 - top) / 3;
      for (let k = 0; k < 3; k++) {
        const y0 = top + k * hh;
        g.fillStyle = p.mortar; g.fillRect(x, y0, w, hh);
        stoneFace(g, x + 0.6, y0 + 0.7, w - 1.2, hh - 1.4, p, k + (e ? 7 : 0));
      }
      footShade(g, x, w, F1, 8);
    } else { g.fillStyle = lin(g, 0, ty + w, 0, ty + w + rise, [[0, p.mid], [1, p.shade]]); g.fillRect(x, ty + w, w, rise + 1); }
    slab(g, x - o, ty - o, w + 2 * o, w + 2 * o, 3, p);
  }, 2.2));
}
// quoins: long and short dressed blocks alternating up the corner, a little proud of the wall
function quoinPiece(qf, c) {
  return cbox((P) => P.layer((g) => {
    const p = SP[qf], e = c[1] === 'e', s = c[0] === 's', L = 22, S = 13;
    const R = (w) => (e ? 65 - w : -1);
    if (s) {
      const rows = 6, rh = FH / rows;
      for (let r = 0; r < rows; r++) {
        const w = r % 2 ? S : L, x = R(w), y = F0 + r * rh;
        if (!e) { g.fillStyle = 'rgba(20,14,8,0.32)'; g.fillRect(x + w, y + 1.2, 1.8, rh - 0.8); }
        g.fillStyle = p.mortar; g.fillRect(x, y, w, rh);
        stoneFace(g, x + 0.6, y + 0.7, w - 1.2, rh - 1.4, p, r * 3 + (e ? 11 : 0));
      }
      footShade(g, R(L), L, F1, 7);
      slab(g, R(L), 64 - 14, L, 14, 0, p);
    } else slab(g, R(14), 0, 14, 22, 0, p);
  }, 2));
}
// columns with a base and a capital, standing on the corner point (half outside the wall)
function stonePillar(fam, c) {
  return cbox((P) => P.layer((g) => {
    const p = SP[fam], e = c[1] === 'e', s = c[0] === 's';
    const cx = e ? 64 : 0, cy = s ? 64 : 0;
    besideOnly(g, e, s, () => {
      box(g, cx, cy, 11, 11, 0, 6, p);                       // plinth
      const [ty0] = cylinder(g, cx, cy, 9, 6, 9, p, true);       // torus
      g.fillStyle = 'rgba(255,252,240,0.35)'; g.fillRect(cx - 8, ty0 + 0.5, 16, 1);
      cylinder(g, cx, cy, 7, 9, FH - 5, p);                    // shaft
      g.strokeStyle = 'rgba(40,36,30,0.28)'; g.lineWidth = 0.8;
      for (const dx of [-3.5, 0, 3.5]) { g.beginPath(); g.moveTo(cx + dx, scr(cy + 7, FH - 6)); g.lineTo(cx + dx, scr(cy + 7, 11)); g.stroke(); }
      cylinder(g, cx, cy, 9, FH - 5, FH, { ...p, lit: p.top0 }, true); // echinus
    });
    const [yt, yb] = box(g, cx, cy, 11, 11, FH, FH + 6, p);        // abacus, above the wall top
    g.fillStyle = 'rgba(255,252,240,0.5)'; g.fillRect(cx - 11, yt, 22, 1.1); g.fillRect(cx - 11, yt, 1.1, yb - yt);
    g.fillStyle = 'rgba(30,26,20,0.3)'; g.fillRect(cx - 11, yb - 1, 22, 1);
    g.strokeStyle = 'rgba(60,56,50,0.3)'; g.lineWidth = 0.8; g.strokeRect(cx - 7, yt + 4, 14, yb - yt - 8);
  }, 2.2));
}
// rounded ends: a bullnose of rounded stones wrapping the corner + a rounded coping stone on top
function stoneEnd(fam, c) {
  return cbox((P) => P.layer((g) => {
    const p = SP[fam], e = c[1] === 'e', s = c[0] === 's', w = 16, x = e ? 66 - w : -2;
    if (s) {
      const rows = 6, rh = FH / rows;
      for (let r = 0; r < rows; r++) {
        const y = F0 + r * rh;
        g.fillStyle = p.mortar; g.fillRect(x, y, w, rh);
        g.fillStyle = e ? lin(g, x, 0, x + w, 0, [[0, p.mid], [0.55, p.mid], [1, p.shade]]) : lin(g, x, 0, x + w, 0, [[0, p.lit], [0.3, p.lit], [1, p.mid]]);
        g.beginPath();
        const rr = 4;
        if (g.roundRect) g.roundRect(x + 0.6, y + 0.7, w - 1.2, rh - 1.4, e ? [0, rr, rr, 0] : [rr, 0, 0, rr]); else g.rect(x + 0.6, y + 0.7, w - 1.2, rh - 1.4);
        g.fill();
        g.fillStyle = 'rgba(255,252,240,0.45)'; g.fillRect(x + 1.5, y + 0.7, w - 3, 1);
        g.fillStyle = 'rgba(30,26,20,0.35)'; g.fillRect(x + 1.5, y + rh - 1.7, w - 3, 1);
        if (!e) { g.fillStyle = 'rgba(255,252,240,0.25)'; g.fillRect(x + 3, y + 1.5, 1.6, rh - 3); }
      }
      footShade(g, x, w, F1, 8);
    }
    // coping stone with the outer corner rounded (its south face is the same shape 3 px lower)
    const cw = 20, ch = 20, cx0 = e ? 66 - cw : -2, cy0 = (s ? 66 - ch : -2) - 3, rad = 14;
    const corner = e ? (s ? [0, 0, rad, 0] : [0, rad, 0, 0]) : (s ? [0, 0, 0, rad] : [rad, 0, 0, 0]);
    const shape = (dy) => { g.beginPath(); if (g.roundRect) g.roundRect(cx0, cy0 + dy, cw, ch, corner); else g.rect(cx0, cy0 + dy, cw, ch); };
    shape(3); g.fillStyle = lin(g, 0, cy0 + ch, 0, cy0 + ch + 3, [[0, p.mid], [1, p.shade]]); g.fill();
    shape(0); g.fillStyle = lin(g, cx0, cy0, cx0 + cw, cy0 + ch, [[0, p.top0], [1, p.top1]]); g.fill();
    g.strokeStyle = 'rgba(255,252,240,0.5)'; g.lineWidth = 1; shape(0.6); g.stroke();
  }, 2.2));
}

// ---- wooden pillars: a squared (or round) column on a sole block, a bolster capital and an end-grain cap ----
function woodPillar(fam, c) {
  return cbox((P) => P.layer((g) => {
    const p = WP[fam], e = c[1] === 'e', s = c[0] === 's', round = fam === 'log' || fam === 'wattle';
    const cx = e ? 64 : 0, cy = s ? 64 : 0;
    besideOnly(g, e, s, () => {
      box(g, cx, cy, 9.5, 9.5, 0, 7, p);
      if (round) {
        cylinder(g, cx, cy, 6.5, 7, FH - 6, p);
        g.strokeStyle = 'rgba(30,18,8,0.3)'; g.lineWidth = 0.8;
        for (const dx of [-3, 1.5]) { g.beginPath(); g.moveTo(cx + dx, scr(cy + 6.5, FH - 7)); g.lineTo(cx + dx + 0.8, scr(cy + 6.5, 9)); g.stroke(); }
        if (fam === 'wattle') { lash(g, cx - 6.5, 13, scr(cy + 6.5, FH - 14)); lash(g, cx - 6.5, 13, scr(cy + 6.5, 16)); }
      } else {
        const [, yb, yf] = box(g, cx, cy, 6.5, 6.5, 7, FH - 6, p, false);
        grainV(g, cx - 6.5, yb, yf, 13, p, 5 + (e ? 2 : 0));
        g.fillStyle = p.hi; g.fillRect(cx - 5.4, yb + 3, 1, yf - yb - 6);
        g.fillStyle = p.lo; g.fillRect(cx + 4.4, yb + 3, 1, yf - yb - 6);
        // chamfer stops near both ends
        g.fillStyle = p.lo; for (const yy of [yb + 3, yf - 4]) { g.beginPath(); g.moveTo(cx - 6.5, yy); g.lineTo(cx - 4.5, yy + 1); g.lineTo(cx - 6.5, yy + 2); g.fill(); }
        if (fam === 'timber') for (const yy of [yb + 6, yf - 8]) pin(g, 'peg', cx, yy);
      }
      box(g, cx, cy, 10, 8.5, FH - 6, FH, p, false); // bolster capital
    });
    const [yt] = box(g, cx, cy, 8, 8, FH, FH + 5, p, false);
    endGrain(g, cx - 8, yt, 16, 16, p, round);
  }, 2.4));
}

// ---- buttresses ----
// stone: a pier tapering in two stages, sloped weathering on top, courses matching the wall rows
function stoneButtress(fam) {
  return cbox((P) => P.layer((g) => {
    const p = SP[fam], cx = 32;
    const stage = (hw, d, h0, h1, slopeTo, seed) => {
      const yb = scr(64 + d, h1), yf = scr(64 + d, h0);
      // face
      g.fillStyle = rampH(g, cx - hw, 2 * hw, p); g.fillRect(cx - hw, yb, 2 * hw, yf - yb);
      const rows = Math.max(1, Math.round((h1 - h0) / 10.6)), rh = (yf - yb) / rows;
      g.fillStyle = 'rgba(40,36,30,0.42)';
      for (let r = 1; r < rows; r++) g.fillRect(cx - hw, yb + r * rh - 0.5, 2 * hw, 1);
      for (let r = 0; r < rows; r++) { const jx = cx + (hash(r, seed) - 0.5) * hw; g.fillRect(jx, yb + r * rh, 1, rh); }
      g.fillStyle = 'rgba(255,252,240,0.4)'; g.fillRect(cx - hw, yb, 1.1, yf - yb);
      // sloped weathering back to the stage above (or the wall)
      const ys = scr(64 + slopeTo, h1 + (d - slopeTo) * 0.9);
      g.fillStyle = lin(g, 0, ys, 0, yb, [[0, p.top0], [1, p.top1]]);
      g.beginPath(); g.moveTo(cx - hw, yb); g.lineTo(cx + hw, yb); g.lineTo(cx + hw - 1.5, ys); g.lineTo(cx - hw + 1.5, ys); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,252,240,0.45)'; g.fillRect(cx - hw + 1.5, ys, 2 * hw - 3, 1);
    };
    stage(8, 6, FH * 0.42, FH * 0.8, 0, 3);      // upper stage, sloping back into the wall
    stage(12, 11, 0, FH * 0.42, 6, 7);           // lower, wider stage, a set-off ledge onto the upper one
    footShade(g, cx - 12, 24, scr(64 + 11, 0), 8);
  }, 2.2));
}
// wood: a post against the wall propped by two raking struts on sole blocks
function woodButtress(fam) {
  return cbox((P) => {
    const p = WP[fam], cx = 32, round = fam === 'log' || fam === 'wattle';
    const top = F0 + 5, cleat = F0 + 22, foot = F1 + 6;
    P.layer((g) => { // struts (behind the post)
      for (const k of [-1, 1]) {
        const x0 = cx + k * 3, x1 = cx + k * 18;
        g.lineCap = round ? 'round' : 'butt';
        g.strokeStyle = p.mid; g.lineWidth = round ? 5.4 : 5; g.beginPath(); g.moveTo(x0, cleat + 2); g.lineTo(x1, foot - 2); g.stroke();
        g.strokeStyle = p.lit; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0 - 1.4, cleat + 1); g.lineTo(x1 - 1.6, foot - 3); g.stroke();
        g.strokeStyle = p.shade; g.lineWidth = 1.1; g.beginPath(); g.moveTo(x0 + 1.6, cleat + 3); g.lineTo(x1 + 1.4, foot - 1.5); g.stroke();
        g.lineCap = 'round';
        // sole block at the foot
        g.fillStyle = rampH(g, x1 - 5, 10, p); g.fillRect(x1 - 5, foot - 3, 10, 5);
        g.fillStyle = lin(g, 0, foot - 6, 0, foot - 3, [[0, p.top0], [1, p.top1]]); g.fillRect(x1 - 5, foot - 6, 10, 3);
      }
    }, 2.2);
    P.layer((g) => { // the post and the cleat
      const w = round ? 8 : 9;
      g.fillStyle = round ? rampCyl(g, cx - w / 2, w, p) : rampH(g, cx - w / 2, w, p); g.fillRect(cx - w / 2, top, w, F1 - top);
      if (!round) { grainV(g, cx - w / 2, top, F1, w, p, 9); g.fillStyle = p.hi; g.fillRect(cx - w / 2 + 1.1, top, 0.9, F1 - top); }
      endGrain(g, cx - w / 2, top - 4, w, 4, p, false);
      g.fillStyle = rampH(g, cx - 8, 16, p); g.fillRect(cx - 8, cleat - 3, 16, 6);
      g.fillStyle = p.hi; g.fillRect(cx - 8, cleat - 3, 16, 0.9);
      if (fam === 'plank') { pin(g, 'nail', cx - 5, cleat); pin(g, 'nail', cx + 5, cleat); pin(g, 'nail', cx, F0 + 10); }
      else if (fam === 'timber') { pin(g, 'peg', cx - 5, cleat); pin(g, 'peg', cx + 5, cleat); }
      else lash(g, cx - 8, 16, cleat - 2);
      footShade(g, cx - w / 2, w, F1, 8);
    }, 2.2);
  });
}

// ---- wooden trims (the stone ones stay: capPiece / crenel / band) ----
function capWood(fam, edge) {
  return wbox((g) => {
    const p = WP[fam];
    const board = (x, y, w, h, alongX) => {
      g.fillStyle = alongX ? lin(g, 0, y, 0, y + h, [[0, p.top0], [1, p.top1]]) : lin(g, x, 0, x + w, 0, [[0, p.top0], [1, p.top1]]); g.fillRect(x, y, w, h);
      g.strokeStyle = p.grain; g.lineWidth = 0.7; g.beginPath();
      if (alongX) { g.moveTo(x, y + h * 0.45); g.lineTo(x + w, y + h * 0.5); } else { g.moveTo(x + w * 0.45, y); g.lineTo(x + w * 0.5, y + h); }
      g.stroke();
      g.fillStyle = 'rgba(255,236,200,0.4)'; if (alongX) g.fillRect(x, y, w, 1); else g.fillRect(x, y, 1, h);
      for (let k = 0; k < 4; k++) pin(g, 'nail', alongX ? x + 8 + k * 16 : x + w / 2, alongX ? y + h / 2 : y + 8 + k * 16);
    };
    if (edge === 'n') board(-1, -3, 66, 8, true);
    else if (edge === 'w') board(-3, -1, 8, 66, false);
    else {
      board(-1, 57, 66, 7, true);
      g.fillStyle = lin(g, 0, 64, 0, 69, [[0, p.mid], [1, p.shade]]); g.fillRect(-1, 64, 66, 5); // fascia
      g.fillStyle = 'rgba(20,12,6,0.35)'; g.fillRect(-1, 69, 66, 2.2);
    }
  }, 1.8);
}
function crenWood(fam, edge) {
  return wbox((g) => {
    const p = WP[fam];
    const M = (x, y, w, h) => { // a squared timber merlon: end grain on top, its south face below
      g.fillStyle = rampH(g, x, w, p); g.fillRect(x, y - 10 + h, w, 10);
      grainV(g, x, y - 10 + h, y + h, w, p, x);
      endGrain(g, x, y - 10, w, h, p, false);
    };
    if (edge === 'n') { M(2, 2, 14, 9); M(34, 2, 14, 9); }
    else if (edge === 's') { M(2, 56, 14, 8); M(34, 56, 14, 8); }
    else { M(0, 8, 9, 14); M(0, 40, 9, 14); }
  }, 2);
}
function bandWood(fam) {
  return wbox((g) => {
    const p = WP[fam], y = FM + 9;
    g.fillStyle = lin(g, 0, y, 0, y + 5.5, [[0, p.lit], [1, p.shade]]); g.fillRect(-2, y, 68, 5.5);
    g.fillStyle = p.hi; g.fillRect(-2, y, 68, 0.9);
    g.fillStyle = 'rgba(20,12,6,0.35)'; g.fillRect(-2, y + 5.5, 68, 1.6);
    for (let k = 0; k < 4; k++) pin(g, fam === 'timber' ? 'peg' : 'nail', 8 + k * 16, y + 2.8);
  }, 1.6);
}
// soft corners on wooden looks: a rounded cover board down each free front corner (drawn into the wall sprite)
function coverBoard(g, style, x, east) {
  const p = WP[CORNER_FAM[style]] || WP.plank, w = 7, X = east ? x - w : x;
  g.fillStyle = east ? lin(g, X, 0, X + w, 0, [[0, p.mid], [0.5, p.shade], [1, tone(p.shade, 0.75)]]) : lin(g, X, 0, X + w, 0, [[0, p.lit], [0.45, p.lit], [1, p.mid]]);
  g.fillRect(X, F0, w, FH);
  g.fillStyle = east ? 'rgba(255,226,180,0.18)' : 'rgba(255,236,200,0.42)'; g.fillRect(east ? X + 0.8 : X + 1.4, F0, 1, FH);
  g.fillStyle = 'rgba(20,12,6,0.4)'; g.fillRect(east ? X - 0.6 : X + w - 0.4, F0, 1, FH);
  for (const y of [F0 + 6.5, F0 + Math.round(FH / 2) - 0.5, F1 - 5.5]) pin(g, CORNER_FAM[style] === 'timber' ? 'peg' : 'nail', X + w / 2, y);
}
function plinth() {
  return wbox((g) => {
    const y = F1 - 8;
    g.fillStyle = '#5e5850'; g.fillRect(-2, y, 68, 8.5);
    for (let k = 0; k < 4; k++) {
      const X = -2 + k * 17;
      g.fillStyle = lin(g, 0, y, 0, y + 8, [[0, '#a59d90'], [1, '#7e776c']]); g.fillRect(X + 0.6, y + 0.6, 16, 7.2);
      g.fillStyle = 'rgba(255,250,235,0.4)'; g.fillRect(X + 0.6, y + 0.6, 16, 1);
    }
  }, 1.8);
}
// cap pieces along open edges of the top face: n, s (with a front lip), w (mirror for e)
function capPiece(edge) {
  return wbox((g) => {
    const c0 = '#bdb5a6', c1 = '#8d8579';
    if (edge === 'n') { g.fillStyle = lin(g, 0, -3, 0, 5, [[0, c0], [1, c1]]); g.fillRect(-1, -3, 66, 8); }
    else if (edge === 'w') { g.fillStyle = lin(g, -3, 0, 5, 0, [[0, c0], [1, c1]]); g.fillRect(-3, -1, 8, 66); }
    else {
      g.fillStyle = lin(g, 0, 58, 0, 64, [[0, c0], [1, c1]]); g.fillRect(-1, 58, 66, 7);
      g.fillStyle = lin(g, 0, 64, 0, 69, [[0, '#8f887b'], [1, '#6e675e']]); g.fillRect(-1, 64.5, 66, 4.5);
      g.fillStyle = 'rgba(20,16,12,0.35)'; g.fillRect(-1, 69, 66, 2.2);
    }
    g.fillStyle = 'rgba(255,255,245,0.45)';
    if (edge === 'n') g.fillRect(-1, -3, 66, 1.2); else if (edge === 'w') g.fillRect(-3, -1, 1.2, 66); else g.fillRect(-1, 58, 66, 1.2);
  }, 1.8);
}
function crenel(edge) {
  return wbox((g) => {
    const M = (x, y, w, h) => {
      g.fillStyle = lin(g, x, y - 10, x + w, y + h, [[0, '#bab2a3'], [1, '#8e8679']]); g.fillRect(x, y - 10, w, h);
      g.fillStyle = lin(g, 0, y - 10 + h, 0, y + h, [[0, '#7a7368'], [1, '#5e584f']]); g.fillRect(x, y - 10 + h, w, 10);
      g.fillStyle = 'rgba(40,36,30,0.45)'; g.fillRect(x, y - 10 + h + 4.5, w, 0.9); g.fillRect(x + w / 2, y - 10 + h, 0.9, 4.5);
      g.fillStyle = 'rgba(255,255,245,0.4)'; g.fillRect(x, y - 10, w, 1.2);
    };
    if (edge === 'n') { M(2, 2, 14, 9); M(34, 2, 14, 9); }
    else if (edge === 's') { M(2, 56, 14, 8); M(34, 56, 14, 8); }
    else { M(0, 8, 9, 14); M(0, 40, 9, 14); }
  }, 2);
}
function beams() {
  return wbox((g) => {
    g.fillStyle = '#4e3220'; g.fillRect(-2, F0 + 8, 68, 4);
    g.fillStyle = '#6e4a2e'; g.fillRect(-2, F0 + 8, 68, 1);
    for (const x of [6, 58]) { g.fillStyle = '#4e3220'; g.fillRect(x - 2.5, F0 + 1, 5, FH - 2); g.fillStyle = '#6e4a2e'; g.fillRect(x - 2.5, F0 + 1, 1, FH - 2); }
    g.fillStyle = '#5a3b24'; for (const x of [6, 58]) { g.fillRect(x - 3.5, F0 + 6, 7, 4); } // beam ends
  }, 1.6);
}
function band() {
  return wbox((g) => {
    g.fillStyle = lin(g, 0, FM + 9, 0, FM + 14, [[0, '#d6cfc0'], [1, '#9e9688']]); g.fillRect(-2, FM + 9, 68, 5);
    g.fillStyle = 'rgba(20,16,12,0.35)'; g.fillRect(-2, FM + 14, 68, 1.6);
  }, 1.6);
}
// windows: frame + cross mullions (+ glow sprite for the emissive layer at night)
function windowArt(kind, glow) {
  return spritePx(64, 64 + FH, (g, P) => {
    const x0 = 20, x1 = 44, y0 = WIN0, y1 = WIN1;
    if (glow) {
      g.fillStyle = 'rgba(255,196,110,0.95)';
      if (kind === 'oculus') { g.beginPath(); g.ellipse(32, FM + 11, 7, 7, 0, 0, TAU); g.fill(); }
      else {
        g.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
        g.fillStyle = 'rgba(255,150,60,0.55)'; g.fillRect(x0 - 3, y1 + 1, x1 - x0 + 6, 3); // light spilling on the sill
      }
      return;
    }
    P.layer((g) => {
      if (kind === 'slit') {
        g.fillStyle = lin(g, 0, WIN0 - 1, 0, WIN1 + 2, [[0, '#a8a092'], [1, '#7d766c']]); g.fillRect(27, WIN0 - 1, 10, WIN1 - WIN0 + 3);
        g.fillStyle = '#16120e'; g.fillRect(30.4, WIN0 + 1, 3.2, WIN1 - WIN0 - 1); g.fillRect(28.3, (WIN0 + WIN1) / 2 - 1.4, 7.4, 2.8);
        g.fillStyle = 'rgba(255,255,245,0.35)'; g.fillRect(27, WIN0 - 1, 10, 1);
        return;
      }
      if (kind === 'oculus') {
        g.fillStyle = '#b9b1a2'; g.beginPath(); g.ellipse(32, FM + 11, 10.5, 10.5, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(60,56,50,0.55)'; g.lineWidth = 0.8; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.moveTo(32 + Math.cos(a) * 7.5, FM + 11 + Math.sin(a) * 7.5); g.lineTo(32 + Math.cos(a) * 10.5, FM + 11 + Math.sin(a) * 10.5); g.stroke(); }
        g.fillStyle = '#5a3b24'; g.beginPath(); g.ellipse(32, FM + 11, 7.6, 7.6, 0, 0, TAU); g.fill();
        g.fillStyle = lin(g, 0, FM + 4, 0, FM + 18, [[0, '#8fb4d0'], [0.5, '#3a4c60'], [1, '#26303c']]); g.beginPath(); g.ellipse(32, FM + 11, 6, 6, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(220,240,255,0.5)'; g.beginPath(); g.ellipse(29.6, FM + 8.6, 2.6, 1.6, -0.6, 0, TAU); g.fill();
        g.strokeStyle = '#5a3b24'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(26, FM + 11); g.lineTo(38, FM + 11); g.moveTo(32, FM + 5); g.lineTo(32, FM + 17); g.stroke();
        return;
      }
      // frame (light timber), lintel, sill
      g.fillStyle = '#7a5434'; g.fillRect(x0 - 2.5, y0 - 2.5, x1 - x0 + 5, y1 - y0 + 5);
      g.fillStyle = 'rgba(255,230,190,0.35)'; g.fillRect(x0 - 2.5, y0 - 2.5, x1 - x0 + 5, 1.1);
      g.fillStyle = lin(g, 0, y0 - 5, 0, y0 - 2, [[0, '#8a6038'], [1, '#4a2f1c']]); g.fillRect(x0 - 5, y0 - 5, x1 - x0 + 10, 3.2); // lintel
      g.fillStyle = lin(g, 0, y1 + 2, 0, y1 + 5.5, [[0, '#c49a64'], [1, '#6e4a2c']]); g.fillRect(x0 - 5, y1 + 2, x1 - x0 + 10, 3.5); // sill
      // glass: sky reflection on top, dark room below
      g.fillStyle = lin(g, 0, y0, 0, y1, [[0, '#9cc2dc'], [0.42, '#4a6278'], [1, '#232c36']]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (kind === 'curtains') {
        g.fillStyle = '#b23a30';
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + 8, y0); g.quadraticCurveTo(x0 + 4, y0 + 8, x0 + 4.5, y1); g.lineTo(x0, y1); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x1, y0); g.lineTo(x1 - 8, y0); g.quadraticCurveTo(x1 - 4, y0 + 8, x1 - 4.5, y1); g.lineTo(x1, y1); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,200,180,0.3)'; g.fillRect(x0 + 1.5, y0, 1.2, y1 - y0); g.fillRect(x1 - 5, y0, 1.2, y1 - y0);
        g.fillStyle = '#e6c56a'; g.fillRect(x0, y0 + 9, 5, 1.4); g.fillRect(x1 - 5, y0 + 9, 5, 1.4);
      }
      g.fillStyle = 'rgba(230,245,255,0.5)'; g.beginPath(); g.moveTo(x0 + 2, y1 - 3); g.lineTo(x0 + 9, y0 + 1); g.lineTo(x0 + 12.5, y0 + 1); g.lineTo(x0 + 5.5, y1 - 3); g.closePath(); g.fill();
      // cross mullions
      g.fillStyle = '#6a4a2c'; g.fillRect(31, y0, 2.2, y1 - y0); g.fillRect(x0, (y0 + y1) / 2 - 1.1, x1 - x0, 2.2);
      g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(31, y0, 0.8, y1 - y0);
      if (kind === 'shutters') {
        for (const [sx, d] of [[x0 - 13, 1], [x1 + 3, -1]]) {
          g.fillStyle = lin(g, sx, 0, sx + 10, 0, [[0, '#4f8a5c'], [1, '#2f5a3a']]); g.fillRect(sx, y0 - 2, 10, y1 - y0 + 4);
          g.fillStyle = 'rgba(16,36,22,0.55)'; for (let y = y0; y < y1 + 1; y += 2.6) g.fillRect(sx + 1.2, y, 7.6, 1);
          g.fillStyle = 'rgba(220,255,220,0.22)'; g.fillRect(sx, y0 - 2, 10, 1);
          g.fillStyle = '#2a2a2e'; g.fillRect(d > 0 ? sx + 8.6 : sx, y0 + 1, 1.6, 2.4); g.fillRect(d > 0 ? sx + 8.6 : sx, y1 - 4, 1.6, 2.4);
        }
      }
    }, 2);
  }, { pad: 14 });
}
function winbox() {
  return wbox((g) => {
    const y = WIN1 + 2, rand = rng(71);
    g.fillStyle = lin(g, 0, y, 0, y + 5, [[0, '#8c5f38'], [1, '#5a3b22']]); g.fillRect(19, y, 26, 5);
    const cols = ['#e8504a', '#f2c94c', '#f08fb0', '#ffffff', '#9b6bd8'];
    for (let i = 0; i < 9; i++) {
      const x = 21 + i * 2.7, h = 3 + rand() * 3;
      g.fillStyle = '#4a7a34'; g.beginPath(); g.ellipse(x, y - h * 0.4, 2, h * 0.6, 0, 0, TAU); g.fill();
      g.fillStyle = cols[i % cols.length]; g.beginPath(); circle(g, x + (rand() - 0.5), y - h, 1.4); g.fill();
    }
  }, 1.6);
}
function mount(kind) {
  return wbox((g) => {
    const cy = FM + 11;
    switch (kind) {
      case 'shelf': {
        g.fillStyle = lin(g, 0, cy + 2, 0, cy + 5, [[0, '#a87a48'], [1, '#6e4a2c']]); g.fillRect(16, cy + 2, 32, 3);
        g.fillStyle = '#5a3b22'; g.beginPath(); g.moveTo(19, cy + 5); g.lineTo(22, cy + 5); g.lineTo(19, cy + 9); g.closePath(); g.fill(); g.beginPath(); g.moveTo(45, cy + 5); g.lineTo(42, cy + 5); g.lineTo(45, cy + 9); g.closePath(); g.fill();
        g.fillStyle = '#b8703e'; g.fillRect(19, cy - 5, 6, 7); g.fillStyle = '#7d8c9a'; g.beginPath(); g.ellipse(31, cy - 1, 3.6, 3.4, 0, 0, TAU); g.fill();
        g.fillStyle = '#c9a86a'; g.fillRect(36, cy - 3, 9, 5); g.fillStyle = '#e8d7a8'; g.fillRect(37, cy - 4, 7, 1.4);
        break;
      }
      case 'hooks': {
        g.fillStyle = '#6e4a2c'; g.fillRect(16, cy - 6, 32, 3);
        for (const x of [21, 32, 43]) { g.strokeStyle = IRON.mid; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, cy - 3); g.quadraticCurveTo(x + 2.5, cy - 1, x, cy + 1); g.stroke(); }
        g.fillStyle = '#c8a46a'; g.beginPath(); g.ellipse(21, cy + 4, 3.5, 4, 0, 0, TAU); g.fill(); g.fillStyle = '#a07a46'; g.beginPath(); g.ellipse(21, cy + 4, 1.8, 2.2, 0, 0, TAU); g.fill(); // rope coil
        g.fillStyle = '#8a5a30'; g.fillRect(31, cy, 2, 10); g.fillStyle = IRON.light; g.fillRect(29, cy + 7, 6, 4); // shovel
        g.fillStyle = '#7d5a3a'; g.fillRect(42, cy, 2.6, 7); g.fillStyle = '#5e5e66'; g.beginPath(); g.ellipse(43.3, cy + 7, 3.4, 1.6, 0, 0, TAU); g.fill(); // pail
        break;
      }
      case 'antlers': {
        g.fillStyle = lin(g, 26, cy - 4, 38, cy + 8, [[0, '#9a6a40'], [1, '#5a3a20']]); g.beginPath(); g.moveTo(26, cy - 3); g.lineTo(38, cy - 3); g.lineTo(36, cy + 7); g.lineTo(32, cy + 9); g.lineTo(28, cy + 7); g.closePath(); g.fill();
        g.strokeStyle = '#efe2c4'; g.lineWidth = 1.6;
        for (const d of [-1, 1]) {
          g.beginPath(); g.moveTo(32 + d * 2, cy - 2); g.quadraticCurveTo(32 + d * 10, cy - 6, 32 + d * 13, cy - 12);
          g.moveTo(32 + d * 7, cy - 5); g.lineTo(32 + d * 7, cy - 11); g.moveTo(32 + d * 11, cy - 8); g.lineTo(32 + d * 15, cy - 9); g.stroke();
        }
        break;
      }
      case 'pennant': {
        g.fillStyle = '#5a3b22'; g.fillRect(22, cy - 8, 20, 2);
        g.fillStyle = lin(g, 24, 0, 40, 0, [[0, '#3a6aa0'], [1, '#24466e']]); g.beginPath(); g.moveTo(24, cy - 6); g.lineTo(40, cy - 6); g.lineTo(40, cy + 6); g.lineTo(32, cy + 11); g.lineTo(24, cy + 6); g.closePath(); g.fill();
        g.fillStyle = '#e6c56a'; g.beginPath(); circle(g, 32, cy + 1, 3); g.fill(); g.fillRect(24, cy - 4, 16, 1.4);
        break;
      }
      case 'painting': {
        g.fillStyle = lin(g, 0, cy - 7, 0, cy + 8, [[0, '#d0a24a'], [1, '#8a6224']]); g.fillRect(20, cy - 7, 24, 16);
        g.fillStyle = lin(g, 0, cy - 5, 0, cy + 6, [[0, '#9cc8e8'], [0.55, '#e8d29a'], [0.56, '#6a9a4c'], [1, '#3f6e34']]); g.fillRect(22.5, cy - 4.5, 19, 11);
        g.fillStyle = '#4e7a3a'; g.beginPath(); g.moveTo(22.5, cy + 3); g.lineTo(29, cy - 2); g.lineTo(34, cy + 2); g.lineTo(41.5, cy - 3); g.lineTo(41.5, cy + 6.5); g.lineTo(22.5, cy + 6.5); g.closePath(); g.fill();
        g.fillStyle = '#fff0b0'; g.beginPath(); circle(g, 37, cy - 2, 1.6); g.fill();
        break;
      }
      case 'shield': {
        g.fillStyle = lin(g, 24, 0, 40, 0, [[0, '#b23a30'], [1, '#6e1e18']]); g.beginPath(); g.moveTo(24, cy - 7); g.lineTo(40, cy - 7); g.lineTo(40, cy + 1); g.quadraticCurveTo(40, cy + 8, 32, cy + 11); g.quadraticCurveTo(24, cy + 8, 24, cy + 1); g.closePath(); g.fill();
        g.fillStyle = '#e6c56a'; g.fillRect(31, cy - 7, 2, 17); g.fillRect(24, cy - 1, 16, 2);
        g.strokeStyle = '#8a8a90'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(20, cy - 10); g.lineTo(44, cy + 10); g.moveTo(44, cy - 10); g.lineTo(20, cy + 10); g.stroke(); // crossed swords behind
        break;
      }
      case 'sconce': {
        g.fillStyle = IRON.mid; g.fillRect(30, cy - 1, 4, 9); g.fillRect(28, cy + 6, 8, 2.4);
        g.strokeStyle = IRON.mid; g.lineWidth = 1.4; g.beginPath(); g.moveTo(32, cy + 4); g.quadraticCurveTo(37, cy + 3, 36, cy - 2); g.stroke();
        g.fillStyle = '#efe6cf'; g.fillRect(34.4, cy - 7, 3.2, 6); // candle
        break;
      }
    }
  }, 1.8);
}
function ivy(v) {
  const rand = rng(900 + v);
  return wbox((g) => {
    const greens = ['#3f6e2e', '#4e8238', '#5f9442', '#36602a'];
    const vine = (x, y0, y1) => {
      g.strokeStyle = '#4a3a22'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, y1);
      let xx = x;
      for (let y = y1; y > y0; y -= 4) { xx += (rand() - 0.5) * 4; g.lineTo(xx, y); }
      g.stroke();
      for (let y = y1; y > y0; y -= 2.6) {
        const lx = x + (rand() - 0.5) * 10, ly = y + (rand() - 0.5) * 2;
        g.fillStyle = greens[(rand() * 4) | 0];
        g.beginPath(); g.ellipse(lx, ly, 2.4 + rand(), 1.8, rand() * 3, 0, TAU); g.fill();
      }
    };
    // it climbs the front face only (rows F0..F1): nothing grows over the wall's top
    const n = 2 + (v % 2);
    for (let i = 0; i < n; i++) vine(10 + rand() * 44, F0 + 3 + rand() * FH * 0.3, F1 - 1);
    // a few leaves just at the top edge of the face
    for (let i = 0; i < 8; i++) { g.fillStyle = greens[i & 3]; g.beginPath(); g.ellipse(6 + rand() * 52, F0 + 2 + rand() * 4, 2.4, 1.7, rand() * 3, 0, TAU); g.fill(); }
  }, 1.2);
}
function moss(v) {
  const rand = rng(950 + v);
  return wbox((g) => {
    for (let i = 0; i < 12; i++) {
      const x = 4 + rand() * 56, top = rand() < 0.4;
      const y = top ? 2 + rand() * 58 : F1 - 1 - rand() * 6;
      g.fillStyle = rand() < 0.5 ? 'rgba(86,118,52,0.8)' : 'rgba(118,146,70,0.75)';
      g.beginPath(); g.ellipse(x, y, 3 + rand() * 4, 1.6 + rand() * 1.6, 0, 0, TAU); g.fill();
    }
  }, 0);
}
function cracksArt(v) {
  const rand = rng(990 + v);
  return wbox((g) => {
    for (let i = 0; i < 2 + v; i++) {
      let x = 10 + rand() * 44, y = rand() < 0.5 ? F0 + 3 + rand() * (FH - 18) : 10 + rand() * 40;
      g.strokeStyle = 'rgba(26,18,12,0.75)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 7; y += 2 + rand() * 4; g.lineTo(x, y); }
      g.stroke();
    }
  }, 0);
}
// siege cracks (winter walkers hitting a wall / door / fence: fx/rockfx.js): stage 0..3 grows from the middle of the
// top face (and of the front face when `front`) out to the edges, thicker and branching, a dark hole at the end —
// the same look as a rock being mined
export function siegeCrackArt(stage, front) {
  return wbox((g) => {
    const crack = (cx, cy, sy, seed) => {
      const rand = rng(7700 + seed * 13 + stage * 101);
      const n = 3 + stage, L = 9 + stage * 7.5, wdt = 1.1 + stage * 0.45;
      const lines = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.9;
        let x = cx, y = cy, dx = Math.cos(a), dy = Math.sin(a) * sy;
        const pts = [[x, y]];
        const steps = Math.max(2, Math.round(L * (0.7 + rand() * 0.5) / 4));
        for (let k = 0; k < steps; k++) { x += dx * 4 + (rand() - 0.5) * 3; y += dy * 4 + (rand() - 0.5) * 3 * sy; pts.push([x, y]); }
        lines.push([pts, wdt]);
        if (stage >= 2) { // branches off the middle
          const m = pts[(pts.length / 2) | 0], b = a + (rand() < 0.5 ? 0.9 : -0.9);
          let bx = m[0], by = m[1];
          const bp = [[bx, by]];
          for (let k = 0; k < 2 + stage - 2; k++) { bx += Math.cos(b) * 3.5 + (rand() - 0.5) * 2; by += Math.sin(b) * 3.5 * sy + (rand() - 0.5) * 2; bp.push([bx, by]); }
          lines.push([bp, wdt * 0.6]);
        }
      }
      const path = (pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]); };
      g.lineCap = 'round'; g.lineJoin = 'round';
      // a lit lip along each crack, then the dark gap
      for (const [pts, wd] of lines) { g.save(); g.translate(0.8, 0.9); path(pts); g.strokeStyle = 'rgba(255,236,200,0.22)'; g.lineWidth = wd; g.stroke(); g.restore(); }
      for (const [pts, wd] of lines) { path(pts); g.strokeStyle = 'rgba(16,9,4,0.88)'; g.lineWidth = wd; g.stroke(); }
      if (stage >= 3) { // the middle is caving in
        g.beginPath();
        for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, r = 3.5 + rand() * 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy); }
        g.closePath(); g.fillStyle = 'rgba(12,7,3,0.9)'; g.fill();
      }
    };
    crack(32, 30, 1, 1);
    if (front) crack(32, F0 + FH * 0.48, 1.25, 2);
  }, 0);
}
function weatherArt() {
  return wbox((g) => {
    for (let i = 0; i < 7; i++) {
      const x = 4 + hash(i, 61) * 56, w = 2 + hash(i, 62) * 4;
      g.fillStyle = lin(g, 0, F0, 0, F1, [[0, 'rgba(40,34,26,0.32)'], [1, 'rgba(40,34,26,0)']]); g.fillRect(x, F0 + 1, w, FH * (0.4 + hash(i, 63) * 0.6));
    }
    g.fillStyle = 'rgba(60,70,40,0.28)'; g.fillRect(0, F1 - 4, 64, 4);
  }, 0);
}
function flowersArt() {
  const rand = rng(1010);
  return wbox((g) => {
    const cols = ['#f4d35e', '#ee6c4d', '#f7f7f2', '#c58fe0', '#f29bc0'];
    for (let i = 0; i < 16; i++) {
      const x = 2 + rand() * 60, y = F1 - 1 - rand() * 3, h = 3 + rand() * 6;
      g.strokeStyle = '#4b7a32'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 1); g.lineTo(x + (rand() - 0.5) * 2, y - h); g.stroke();
      g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(x - 1.5, y - h * 0.4, 1.8, 0.9, -0.5, 0, TAU); g.fill();
      g.fillStyle = cols[(rand() * cols.length) | 0]; g.beginPath(); circle(g, x, y - h, 1.5 + rand() * 0.6); g.fill();
    }
  }, 1);
}

// ---------------- doors: styled leaves + entrance details ----------------
const DH = FH - 1, DV0 = 0.22, DV1 = 0.7;
const DOOR_PAL = {
  plank: ['#7e4e2c', '#633b20', '#a8754a'], panel: ['#8a5a34', '#6a4226', '#b08050'], iron: ['#5e3c22', '#4a2e1a', '#8a6038'],
  arched: ['#7a4c2a', '#5e3820', '#a47048'], rustic: ['#8f7048', '#6e5434', '#b8986a'],
};
function doorLeafK(style, half, xa, xb) {
  const [c0, c1, ct] = DOOR_PAL[style];
  return (g) => {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    const vy0 = DV0 * 64 + (FH - DH), vy1 = DV1 * 64 + (FH - DH), fb = vy1 + DH;
    g.fillStyle = lin(g, 0, vy0, 0, vy1, [[0, ct], [1, tone(ct, 0.8)]]); g.fillRect(x0, vy0, x1 - x0, vy1 - vy0);
    g.fillStyle = 'rgba(255,225,180,0.3)'; g.fillRect(x0, vy0, x1 - x0, 1.2);
    const n = style === 'rustic' ? 2 : 3, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * w;
      g.fillStyle = lin(g, x, 0, x + w, 0, [[0, c0], [1, c1]]); g.fillRect(x, vy1, w, DH);
      g.fillStyle = 'rgba(30,18,8,0.7)'; g.fillRect(x + w - 0.7, vy1, 1.2, DH);
    }
    if (style === 'panel') {
      for (const [y, h] of [[vy1 + DH * 0.12, DH * 0.32], [vy1 + DH * 0.52, DH * 0.36]]) {
        g.fillStyle = tone(c0, 0.82); g.fillRect(x0 + 2.5, y, x1 - x0 - 5, h);
        g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(x0 + 2.5, y + h - 1, x1 - x0 - 5, 1); g.fillStyle = 'rgba(20,10,4,0.45)'; g.fillRect(x0 + 2.5, y, x1 - x0 - 5, 1);
      }
    } else if (style === 'iron') {
      for (const y of [vy1 + 3, vy1 + DH / 2 - 1, fb - 6]) {
        g.fillStyle = '#3e3e44'; g.fillRect(x0, y, x1 - x0, 3.2); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x0, y, x1 - x0, 0.8);
        g.fillStyle = '#26262a'; for (let x = x0 + 2.5; x < x1 - 1; x += 4.5) { g.beginPath(); circle(g, x, y + 1.6, 0.9); g.fill(); }
      }
      g.fillStyle = '#3e3e44'; g.beginPath(); g.moveTo(x0, fb - 4); g.lineTo(x1, vy1 + 4); g.lineTo(x1, vy1 + 7); g.lineTo(x0, fb - 1); g.closePath(); g.fill();
    } else if (style === 'rustic') {
      g.strokeStyle = '#c8b27a'; g.lineWidth = 1.4; for (const y of [vy1 + 6, fb - 7]) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y + 0.5); g.stroke(); }
      g.fillStyle = 'rgba(40,24,10,0.35)'; g.beginPath(); g.moveTo(x0 + 2, fb - 3); g.lineTo(x1 - 2, vy1 + 3); g.lineTo(x1 - 2, vy1 + 5.5); g.lineTo(x0 + 2, fb - 0.5); g.closePath(); g.fill();
    } else {
      for (const y of [vy1 + 5, fb - 7]) {
        g.fillStyle = '#45444a'; g.fillRect(x0, y, x1 - x0, 2.6); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0, y, x1 - x0, 0.8);
        g.fillStyle = '#2a292d'; for (let x = x0 + 3; x < x1 - 1; x += 6) { g.beginPath(); circle(g, x, y + 1.3, 0.8); g.fill(); }
      }
    }
    if (style === 'arched') { g.fillStyle = 'rgba(20,10,4,0.4)'; g.fillRect(x0, vy1, x1 - x0, 2); }
    const hx = xb + (xa < xb ? -4 : 4);
    g.strokeStyle = style === 'iron' ? '#8a8a92' : '#c9a24a'; g.lineWidth = 1.3; g.beginPath(); g.arc(hx, vy1 + DH * 0.5 + 1, 2.2, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(15,10,6,0.35)'; g.fillRect(x0, fb - 4, x1 - x0, 4);
    if (half) return;
  };
}
function doorLeafSprite(style) { return spritePx(64, 64 + FH, (g, P) => P.layer(doorLeafK(style, true, 9, 32.5), 2.6), { pad: 12 }); }
function doorLeafV(style) {
  const [c0, c1, ct] = DOOR_PAL[style];
  return spritePx(64, 64 + FH, (g, P) => {
    P.layer((g) => {
      const jn = 0.15, js = 0.85;
      const ya = jn * 64 + (FH - DH), yb = js * 64 + (FH - DH), L = (yb - ya) / 2;
      g.fillStyle = lin(g, 22, 0, 42, 0, [[0, ct], [0.5, c0], [1, c1]]); g.fillRect(22, ya, 20, L);
      g.strokeStyle = 'rgba(60,34,16,0.6)'; g.lineWidth = 0.9;
      for (let x = 27; x < 41; x += 5) { g.beginPath(); g.moveTo(x, ya + 1); g.lineTo(x, ya + L - 1); g.stroke(); }
      g.fillStyle = style === 'iron' ? '#3e3e44' : '#45444a';
      for (const y of style === 'iron' ? [ya + 3, ya + L / 2, ya + L - 6] : [ya + 5, ya + L - 8]) g.fillRect(22, y, 20, style === 'rustic' ? 1.4 : 2.6);
      g.strokeStyle = '#c9a24a'; g.lineWidth = 1.3; g.beginPath(); g.arc(32, ya + L - 4, 2.2, 0, TAU); g.stroke();
    }, 2.6);
  }, { pad: 12 });
}
// stone arch over an E-W door (on the jambs and the lintel)
function doorArch() {
  return wbox((g) => {
    const top = 64 - 4;
    g.fillStyle = lin(g, 0, top - 6, 0, top + 12, [[0, '#cfc7b8'], [1, '#948c7e']]);
    g.beginPath(); g.moveTo(2, top + 14); g.lineTo(2, top + 2); g.quadraticCurveTo(32, top - 12, 62, top + 2); g.lineTo(62, top + 14); g.lineTo(55, top + 14); g.lineTo(55, top + 7); g.quadraticCurveTo(32, top - 3, 9, top + 7); g.lineTo(9, top + 14); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(50,46,40,0.55)'; g.lineWidth = 0.9;
    for (let k = 0; k <= 6; k++) { const a = Math.PI * (1 - k / 6); const cx = 32 + Math.cos(a) * 26, cy = top + 6 - Math.sin(a) * 11; g.beginPath(); g.moveTo(cx, cy); g.lineTo(32 + Math.cos(a) * 33, top + 6 - Math.sin(a) * 16); g.stroke(); }
    g.fillStyle = '#e2dccf'; g.beginPath(); g.moveTo(28, top - 7); g.lineTo(36, top - 7); g.lineTo(35, top + 1); g.lineTo(29, top + 1); g.closePath(); g.fill(); // keystone
  }, 2);
}
function awning() {
  return wbox((g) => {
    // little wooden canopy over the door: shingled slope + two brackets
    const y0 = 50, y1 = 66;
    g.fillStyle = '#4a2f1c'; for (const x of [10, 54]) { g.beginPath(); g.moveTo(x, y1 - 2); g.lineTo(x + (x < 32 ? 3 : -3), y1 + 8); g.lineTo(x + (x < 32 ? 5 : -5), y1 + 8); g.lineTo(x + (x < 32 ? 2 : -2), y1 - 2); g.closePath(); g.fill(); }
    g.fillStyle = lin(g, 0, y0, 0, y1, [[0, '#9a6a40'], [1, '#6a4428']]);
    g.beginPath(); g.moveTo(6, y0 + 4); g.lineTo(58, y0 + 4); g.lineTo(62, y1); g.lineTo(2, y1); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,22,10,0.55)'; g.lineWidth = 0.8;
    for (let r = 0; r < 3; r++) { const y = y0 + 6 + r * 3.5; g.beginPath(); g.moveTo(5 - r, y); g.lineTo(59 + r, y); g.stroke(); for (let x = 8 + (r & 1) * 4; x < 58; x += 8) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 3.5); g.stroke(); } }
    g.fillStyle = '#5a3a22'; g.fillRect(1, y1 - 1, 62, 3);
    g.fillStyle = 'rgba(255,230,190,0.35)'; g.fillRect(6, y0 + 4, 52, 1);
  }, 2);
}
function doorLantern() {
  return wbox((g) => {
    const x = 58, y = FM + 6;
    g.strokeStyle = IRON.mid; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - 3, y - 4); g.lineTo(x + 2, y - 4); g.lineTo(x + 2, y - 1); g.stroke();
    g.fillStyle = IRON.dark; g.beginPath(); g.moveTo(x - 2.5, y); g.lineTo(x + 2, y - 3); g.lineTo(x + 6.5, y); g.closePath(); g.fill();
    g.fillStyle = '#5a5a52'; g.fillRect(x - 1.5, y, 7, 8); g.fillStyle = '#e8c070'; g.fillRect(x - 0.4, y + 1.2, 4.8, 5.6);
    g.fillStyle = IRON.dark; g.fillRect(x - 2, y + 8, 8, 1.8);
  }, 1.6);
}
function knocker() { return wbox((g) => { g.strokeStyle = '#c9a24a'; g.lineWidth = 1.6; g.beginPath(); g.arc(32, FM + 9, 3, 0, TAU); g.stroke(); g.fillStyle = '#a07a2a'; g.beginPath(); circle(g, 32, FM + 6, 1.6); g.fill(); }, 1.2); }
function wreath() {
  const rand = rng(1101);
  return wbox((g) => {
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; g.fillStyle = i & 1 ? '#3f6e2e' : '#4e8238'; g.beginPath(); g.ellipse(32 + Math.cos(a) * 5, FM + 8 + Math.sin(a) * 5, 2.4, 1.6, a, 0, TAU); g.fill(); }
    for (let i = 0; i < 5; i++) { const a = rand() * TAU; g.fillStyle = '#c8302a'; g.beginPath(); circle(g, 32 + Math.cos(a) * 5, FM + 8 + Math.sin(a) * 5, 1.1); g.fill(); }
    g.fillStyle = '#b02a24'; g.beginPath(); g.moveTo(30, FM + 13); g.lineTo(34, FM + 13); g.lineTo(35, FM + 17); g.lineTo(32, FM + 15); g.lineTo(29, FM + 17); g.closePath(); g.fill();
  }, 1.2);
}
function doorStep() {
  return spritePx(64, 64, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 0, 56, 0, 64, [[0, '#b9b1a2'], [1, '#8d867a']]); g.beginPath(); if (g.roundRect) g.roundRect(10, 55, 44, 10, 2.5); else g.rect(10, 55, 44, 10); g.fill();
    g.fillStyle = 'rgba(255,255,245,0.4)'; g.fillRect(12, 55.5, 40, 1.2);
  }, 1.4), { pad: 10 });
}

// ---------------- fences: styles per mask (post at the tile centre, like structures.js) ----------------
const FR = { h1: 11, h2: 23, post: 31 };
function postChunky(g, x, foot, h, w, col = ['#a57a4c', '#86603a', '#4e331c']) {
  g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, col[0]], [0.45, col[1]], [1, col[2]]]);
  g.fillRect(x - w, foot - h, w * 2, h);
  g.beginPath(); g.ellipse(x, foot, w, w * 0.35, 0, 0, Math.PI); g.fill();
  g.fillStyle = mixc(col[0], '#fff', 0.2); g.fillRect(x - w, foot - h, w * 2, 2.6);
  g.fillStyle = 'rgba(30,18,8,0.4)'; g.fillRect(x - w, foot - h + 2.6, w * 2, 1);
  g.strokeStyle = 'rgba(40,24,12,0.45)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - w * 0.3, foot - h + 5); g.lineTo(x - w * 0.25, foot - 2); g.stroke();
}
function picketRow(g, xa, xb, foot, col = '#cfa772') {
  const n = Math.max(1, Math.round(Math.abs(xb - xa) / 7.2));
  const w = (xb - xa) / n;
  for (let i = 0; i < n; i++) {
    const x = xa + i * w + w / 2, top = foot - 30 - (i & 1) * 1.2;
    g.fillStyle = lin(g, x - 2.6, 0, x + 2.6, 0, [[0, mixc(col, '#fff', 0.2)], [1, mixc(col, '#3a2414', 0.4)]]);
    g.beginPath(); g.moveTo(x - 2.5, foot - 1); g.lineTo(x - 2.5, top + 3); g.lineTo(x, top); g.lineTo(x + 2.5, top + 3); g.lineTo(x + 2.5, foot - 1); g.closePath(); g.fill();
  }
  for (const h of [9, 22]) { g.fillStyle = lin(g, 0, foot - h - 2, 0, foot - h + 2, [[0, '#9c7244'], [1, '#5e3f22']]); g.fillRect(Math.min(xa, xb), foot - h - 2, Math.abs(xb - xa), 3.6); }
}
function boardRow(g, xa, xb, foot) {
  const y0 = foot - 27, y1 = foot - 3;
  for (let r = 0; r < 3; r++) {
    const y = y0 + r * 8;
    g.fillStyle = lin(g, 0, y, 0, y + 7, [[0, '#b88a56'], [1, '#7e5832']]); g.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), 7);
    g.fillStyle = 'rgba(40,24,12,0.5)'; g.fillRect(Math.min(xa, xb), y + 7, Math.abs(xb - xa), 1);
    g.fillStyle = 'rgba(255,230,190,0.25)'; g.fillRect(Math.min(xa, xb), y + 0.5, Math.abs(xb - xa), 0.9);
  }
  g.fillStyle = 'rgba(20,12,6,0.3)'; g.fillRect(Math.min(xa, xb), y1 - 2, Math.abs(xb - xa), 2);
}
function wattleRow(g, xa, xb, foot) {
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = foot - 26;
  g.fillStyle = '#6a4a2a'; g.fillRect(x0, y0, x1 - x0, 25);
  g.strokeStyle = '#9a7446'; g.lineWidth = 2.2;
  for (let y = y0 + 2; y < foot - 1; y += 3.3) { g.beginPath(); g.moveTo(x0, y); for (let x = x0; x <= x1; x += 8) g.quadraticCurveTo(x + 4, y + (((x / 8) | 0) & 1 ? 1.6 : -1.6), x + 8, y); g.stroke(); }
  g.strokeStyle = 'rgba(40,24,10,0.5)'; g.lineWidth = 0.7;
  for (let y = y0 + 3.4; y < foot - 1; y += 3.3) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  for (let x = Math.ceil(x0 / 10) * 10; x < x1; x += 10) { g.fillStyle = '#5a3c20'; g.fillRect(x - 1, y0 - 3, 2.2, 28); }
}
function stoneWallRow(g, xa, xb, foot, seed = 1) {
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), top = foot - 20;
  g.save(); g.beginPath(); g.rect(x0, top - 1, x1 - x0, 21); g.clip();
  courses(g, x0, x1, top, foot, 6.7, RSTONE.map((c) => tone(c, 0.92)), 17 + seed, { mortar: '#4a453e', round: 3, jitter: 1, minW: 7, maxW: 14 });
  g.restore();
  // coping stones on top
  g.fillStyle = lin(g, 0, top - 5, 0, top + 1, [[0, '#cbc3b4'], [1, '#9c9486']]); g.fillRect(x0, top - 4, x1 - x0, 5);
  g.fillStyle = 'rgba(40,36,30,0.45)'; for (let x = Math.ceil(x0 / 9) * 9; x < x1; x += 9) g.fillRect(x, top - 4, 0.8, 5);
}
function hedgeBlob(g, x0, x1, foot, seed) {
  const rand = rng(seed);
  const greens = ['#3f6e2e', '#4a7d34', '#57903c', '#366028'];
  g.fillStyle = '#2f5424';
  g.beginPath(); g.rect(x0, foot - 30, x1 - x0, 30); g.fill();
  for (let i = 0; i < Math.max(8, (x1 - x0) * 0.9); i++) {
    const x = x0 + rand() * (x1 - x0), y = foot - 4 - rand() * 28;
    g.fillStyle = greens[(rand() * 4) | 0]; g.beginPath(); g.ellipse(x, y, 3 + rand() * 3, 2.4 + rand() * 2, rand() * 3, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(200,240,160,0.18)'; for (let i = 0; i < 10; i++) { g.beginPath(); g.ellipse(x0 + rand() * (x1 - x0), foot - 22 - rand() * 7, 2.2, 1.2, 0, 0, TAU); g.fill(); }
}
// a fence style sprite for mask m: rows toward connected neighbours, post (or pier / bush) at the centre
export function fenceStyleSprite(style, m) {
  const N = m & 1, E = m & 2, S = m & 4, W = m & 8;
  return spritePx(64, 64 + PH, (g, P) => {
    const foot = PH + 32;
    const xa = W ? -EXT : 32, xb = E ? 64 + EXT : 32;
    if (style === 'hedge') {
      P.layer((g) => {
        if (N || S) { const ya = N ? PH - EXT : foot, yb = S ? PH + 64 + EXT : foot; for (let y = ya; y <= yb; y += 9) hedgeBlob(g, 21, 43, y, 50 + y + m); }
        hedgeBlob(g, Math.min(xa, 22), Math.max(xb, 42), foot, 70 + m);
      }, 2.2);
    } else if (style === 'stone') {
      P.layer((g) => {
        if (N || S) {
          const ya = N ? PH - EXT : foot, yb = S ? PH + 64 + EXT : foot;
          g.save(); g.beginPath(); g.rect(22, ya - 24, 20, yb - ya + 24); g.clip();
          stoneField(g, 22, ya - 24, 42, yb, 3, 9, RSTONE, 23, { mortar: '#4a453e', round: 0.7 });
          g.restore();
        }
        stoneWallRow(g, Math.min(xa, 22), Math.max(xb, 42), foot, m);
        g.fillStyle = 'rgba(40,30,20,0.35)'; g.beginPath(); g.ellipse(32, foot + 1, 14, 2.4, 0, 0, TAU); g.fill();
      }, 2.4);
    } else {
      if (N || S) P.layer((g) => {
        const ya = N ? PH - EXT : foot, yb = S ? PH + 64 + EXT : foot;
        const col = style === 'picket' ? '#cfa772' : style === 'wattle' ? '#8a6a40' : '#a87a48';
        g.fillStyle = lin(g, 27, 0, 37, 0, [[0, mixc(col, '#fff', 0.2)], [0.5, col], [1, mixc(col, '#000', 0.4)]]);
        g.fillRect(27.5, ya - 28, 9, yb - ya + 22);
        g.fillStyle = 'rgba(40,24,12,0.45)';
        if (style === 'picket') for (let y = ya - 26; y < yb - 6; y += 6) g.fillRect(27.5, y, 9, 1);
        else if (style === 'wattle') for (let y = ya - 26; y < yb - 6; y += 3.3) g.fillRect(27.5, y, 9, 0.8);
        else for (let y = ya - 26; y < yb - 6; y += 8) g.fillRect(27.5, y, 9, 1);
      }, 2.4);
      if (E || W) P.layer((g) => {
        if (style === 'picket') picketRow(g, xa, xb, foot);
        else if (style === 'wattle') wattleRow(g, xa, xb, foot);
        else boardRow(g, xa, xb, foot);
      }, 2.4);
      P.layer((g) => {
        g.fillStyle = 'rgba(60,44,26,0.6)'; g.beginPath(); g.ellipse(32, foot + 1, 8, 2.6, 0, 0, TAU); g.fill();
        const w = style === 'wattle' ? 3.6 : 5.4;
        postChunky(g, 32, foot, FR.post + (style === 'board' ? 4 : 2), w, style === 'wattle' ? ['#8a6a44', '#6a4c2c', '#3c2814'] : undefined);
      }, 2.4);
    }
    const big = 400;
    if (W) g.clearRect(-big, -big, big - OV, big * 2);
    if (E) g.clearRect(64 + OV, -big, big, big * 2);
    if (N) g.clearRect(16, -big, 32, big + PH - FR.h2 - OV - 6);
    if (S) g.clearRect(16, PH + 64 - FR.h1 + OV, 32, big);
  }, { pad: 12 });
}
// post caps / lanterns / flowers / vines / bird (fence box 64 × (64+PH), post top at foot - post)
const fbox = (fn, ow = 2) => spritePx(64, 64 + PH, (g, P) => P.layer((g) => fn(g, PH + 32), ow), { pad: 12 });
function fenceCap(kind) {
  return fbox((g, foot) => {
    const top = foot - FR.post - 3;
    if (kind === 'flat') { g.fillStyle = lin(g, 0, top - 3, 0, top + 2, [[0, '#c49a64'], [1, '#7e5832']]); g.fillRect(25, top - 3, 14, 4.5); g.fillStyle = 'rgba(255,240,200,0.4)'; g.fillRect(25, top - 3, 14, 1); }
    else if (kind === 'ball') { g.fillStyle = '#7e5832'; g.fillRect(29, top - 3, 6, 3); g.fillStyle = rad(g, 30.5, top - 8, 1, 6, [[0, '#d8b27a'], [1, '#8a5f36']]); g.beginPath(); circle(g, 32, top - 6.5, 4.6); g.fill(); }
    else { g.fillStyle = lin(g, 27, 0, 37, 0, [[0, '#c49a64'], [1, '#6e4a2a']]); g.beginPath(); g.moveTo(26.6, top + 1); g.lineTo(32, top - 9); g.lineTo(37.4, top + 1); g.closePath(); g.fill(); }
  });
}
function fenceLantern() {
  return fbox((g, foot) => {
    const top = foot - FR.post - 2;
    g.strokeStyle = IRON.mid; g.lineWidth = 1.6; g.beginPath(); g.moveTo(32, top - 1); g.lineTo(32, top - 12); g.lineTo(39, top - 12); g.stroke();
    const lx = 39, ly = top - 9;
    g.fillStyle = IRON.dark; g.beginPath(); g.moveTo(lx - 4, ly); g.lineTo(lx, ly - 3); g.lineTo(lx + 4, ly); g.closePath(); g.fill();
    g.fillStyle = '#5a5a52'; g.fillRect(lx - 3.2, ly, 6.4, 8); g.fillStyle = '#e8c070'; g.fillRect(lx - 2.2, ly + 1.2, 4.4, 5.4);
    g.fillStyle = IRON.dark; g.fillRect(lx - 3.6, ly + 8, 7.2, 1.6);
  }, 1.6);
}
function fenceFlowers() {
  const rand = rng(1201);
  return fbox((g, foot) => {
    const cols = ['#f4d35e', '#ee6c4d', '#f7f7f2', '#c58fe0', '#f29bc0'];
    for (let i = 0; i < 12; i++) {
      const x = 6 + rand() * 52, y = foot + 4 + rand() * 6, h = 3 + rand() * 6;
      g.strokeStyle = '#4b7a32'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
      g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(x + 1.5, y - h * 0.4, 1.8, 0.9, 0.5, 0, TAU); g.fill();
      g.fillStyle = cols[(rand() * 5) | 0]; g.beginPath(); circle(g, x, y - h, 1.6); g.fill();
    }
  }, 1);
}
function fenceVines(v) {
  const rand = rng(1250 + v);
  return fbox((g, foot) => {
    const greens = ['#3f6e2e', '#4e8238', '#5f9442'];
    if (v === 0) for (let i = 0; i < 16; i++) { const x = 2 + rand() * 60, y = foot - 8 - rand() * 18; g.fillStyle = greens[i % 3]; g.beginPath(); g.ellipse(x, y, 2.4, 1.6, rand() * 3, 0, TAU); g.fill(); if (i % 4 === 0) { g.fillStyle = '#f29bc0'; g.beginPath(); circle(g, x, y - 1, 1.3); g.fill(); } }
    else for (let i = 0; i < 12; i++) { const y = PH - 8 + rand() * 60, x = 28 + rand() * 8; g.fillStyle = greens[i % 3]; g.beginPath(); g.ellipse(x, y - 20, 2.4, 1.6, rand() * 3, 0, TAU); g.fill(); }
  }, 1);
}
function bird() {
  return fbox((g, foot) => {
    const top = foot - FR.post - 4;
    g.fillStyle = '#8a5a36'; g.beginPath(); g.ellipse(32, top - 3, 4.2, 3, 0, 0, TAU); g.fill();
    g.fillStyle = '#d86a3a'; g.beginPath(); g.ellipse(33.4, top - 2.4, 2.4, 2, 0, 0, TAU); g.fill();
    g.fillStyle = '#6e4428'; g.beginPath(); circle(g, 35.5, top - 6, 2.4); g.fill();
    g.fillStyle = '#e0a040'; g.beginPath(); g.moveTo(37.6, top - 6.2); g.lineTo(40, top - 5.6); g.lineTo(37.6, top - 5); g.closePath(); g.fill();
    g.fillStyle = '#5a3a22'; g.beginPath(); g.moveTo(28, top - 3); g.lineTo(24, top - 1); g.lineTo(28.5, top - 1.2); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.beginPath(); circle(g, 36, top - 6.4, 0.6); g.fill();
  }, 1.4);
}

// ---------------- gates: styled leaves (h: hinge at the left post) ----------------
function gateLeafStyled(style, part) {
  return spritePx(64, 64 + PH, (g, P) => {
    const foot = PH + 32;
    const leaf = (xa, xb) => {
      if (style === 'picket') picketRow(g, Math.min(xa, xb), Math.max(xa, xb), foot);
      else boardRow(g, Math.min(xa, xb), Math.max(xa, xb), foot);
      g.strokeStyle = '#7a5434'; g.lineWidth = 2.8; g.beginPath(); g.moveTo(xa, foot - 6); g.lineTo(xb, foot - 24); g.stroke();
      g.fillStyle = '#4a4a50'; for (const y of [foot - 22, foot - 9]) g.fillRect(Math.min(xa, xb) - (xa > xb ? 0 : 0), y - 1.4, 4, 2.8);
    };
    if (part === 'leaf') P.layer(() => leaf(10, 32), 2.2);
    else P.layer(() => { leaf(10, 32); leaf(54, 32); }, 2.2);
  }, { pad: 12 });
}
function gateLeafStyledV(style) {
  return spritePx(64, 64 + PH, (g, P) => {
    P.layer((g) => {
      const footN = PH + 5, footS = PH + 60;
      const ya = footN - 24, yb = footS - 24, L = (yb - ya) * 0.5;
      const col = style === 'picket' ? '#d8ae74' : '#b88a56';
      g.fillStyle = lin(g, 27, 0, 37, 0, [[0, mixc(col, '#fff', 0.15)], [0.5, col], [1, mixc(col, '#000', 0.4)]]); g.fillRect(27.5, ya, 9, L);
      g.fillStyle = 'rgba(40,24,12,0.6)'; for (let y = ya + 4; y < ya + L - 1; y += style === 'picket' ? 4 : 7.5) g.fillRect(27.5, y, 9, 1);
      g.fillStyle = '#4a4a50'; g.fillRect(26.5, ya + 2, 11, 2.6);
    }, 2.2);
  }, { pad: 12 });
}
function gateArch() {
  const rand = rng(1301);
  return spritePx(64, 64 + PH + 40, (g, P) => {
    const foot = PH + 40 + 32;
    P.layer((g) => {
      for (const x of [4, 60]) { g.fillStyle = lin(g, x - 3, 0, x + 3, 0, [[0, '#a57a4c'], [1, '#5a3c20']]); g.fillRect(x - 3, foot - 64, 6, 64); }
      g.strokeStyle = '#7a5434'; g.lineWidth = 5; g.beginPath(); g.moveTo(4, foot - 62); g.quadraticCurveTo(32, foot - 92, 60, foot - 62); g.stroke();
      g.strokeStyle = '#a07448'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(4, foot - 64); g.quadraticCurveTo(32, foot - 94, 60, foot - 64); g.stroke();
    }, 2.4);
    P.layer((g) => {
      const greens = ['#3f6e2e', '#4e8238', '#5f9442', '#36602a'], roses = ['#e0506a', '#f2a0b4', '#fff2f0'];
      for (let i = 0; i < 46; i++) {
        const u = rand(), a = Math.PI * (1 - u);
        let x, y;
        if (i < 28) { x = 32 - Math.cos(a) * 28 + (rand() - 0.5) * 6; y = foot - 62 - Math.sin(a) * 28 + (rand() - 0.5) * 6; }
        else { const side = i & 1 ? 4 : 60; x = side + (rand() - 0.5) * 7; y = foot - 8 - rand() * 54; }
        g.fillStyle = greens[(rand() * 4) | 0]; g.beginPath(); g.ellipse(x, y, 2.8, 2, rand() * 3, 0, TAU); g.fill();
        if (rand() < 0.3) { g.fillStyle = roses[(rand() * 3) | 0]; g.beginPath(); circle(g, x, y, 1.7); g.fill(); }
      }
    }, 1.2);
  }, { pad: 12 });
}
function gateSign() {
  return fbox((g, foot) => {
    g.fillStyle = lin(g, 0, foot - 30, 0, foot - 20, [[0, '#c49a64'], [1, '#8a6038']]); g.fillRect(20, foot - 31, 24, 9);
    g.strokeStyle = '#5a3a20'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(24, foot - 27); g.lineTo(40, foot - 27); g.moveTo(24, foot - 24.5); g.lineTo(36, foot - 24.5); g.stroke();
    g.strokeStyle = '#c8b27a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(22, foot - 31); g.lineTo(20, foot - 36); g.moveTo(42, foot - 31); g.lineTo(44, foot - 36); g.stroke();
  }, 1.6);
}

// ---------------- floors: base patterns (one tile, bleed all sides) + edge / carpet / inlay overlays ----------------
const FLB = 2;
function floorTex(style) {
  return spritePx(64 + FLB * 2, 64 + FLB * 2, (g) => {
    g.translate(FLB, FLB);
    cached(g, 'kf_' + style, (g, a, b, c, d) => {
      switch (style) {
        case 'herring': {
          g.fillStyle = '#4a3018'; g.fillRect(a, b, c - a, d - b);
          const pal = ['#9a6e44', '#8c6340', '#a7784a', '#835c3a', '#956a42'];
          for (let ky = -2; ky <= 2; ky++) for (let kx = -2; kx <= 2; kx++) for (let i = 0; i < 4; i++) {
            const x = kx * 32 + i * 8, y = ky * 32 + i * 8;
            g.save(); g.translate(x, y);
            g.fillStyle = pick(pal, kx * 7 + i, ky + 9); g.fillRect(0.5, 0.5, 23, 7);
            g.fillStyle = pick(pal, ky * 5 + i, kx + 3); g.fillRect(0.5, 8.5, 7, 23);
            g.fillStyle = 'rgba(255,230,190,0.2)'; g.fillRect(0.5, 0.5, 23, 1); g.fillRect(0.5, 8.5, 1, 23);
            g.restore();
          }
          break;
        }
        case 'parquet': {
          g.fillStyle = '#3e2814'; g.fillRect(a, b, c - a, d - b);
          for (let ky = -1; ky <= 2; ky++) for (let kx = -1; kx <= 2; kx++) {
            const X = kx * 32, Y = ky * 32, vert = (kx + ky) & 1;
            for (let i = 0; i < 4; i++) {
              g.fillStyle = vert ? ['#a6784a', '#9a6e44', '#b0814f', '#93693f'][i] : ['#7e5634', '#8a5f3a', '#765030', '#845a36'][i];
              if (vert) g.fillRect(X + i * 8 + 0.5, Y + 0.5, 7, 31); else g.fillRect(X + 0.5, Y + i * 8 + 0.5, 31, 7);
            }
          }
          break;
        }
        case 'wide': {
          const pal = { base: ['#9a7048', '#8e6642', '#a2774c', '#875f3c'], seam: '#3a2412', grain: 'rgba(60,38,18,0.3)', hi: 'rgba(255,226,180,0.18)', knot: '#5a3c22' };
          planks(g, a, b, c, d, 3, pal, 7);
          break;
        }
        case 'cobble': stoneField(g, a, b, c, d, 6, 6, COB, 31, { mortar: '#6e675b', round: 1, gap: 1.2, hiA: 0.35, loA: 0.4 }); break;
        case 'tiles': {
          g.fillStyle = '#5a554d'; g.fillRect(a, b, c - a, d - b);
          for (let ky = -1; ky <= 2; ky++) for (let kx = -1; kx <= 2; kx++) {
            const X = kx * 32 + 1, Y = ky * 32 + 1;
            g.fillStyle = ['#b8a88e', '#ad9d84', '#c1b196', '#a69780'][(kx * 3 + ky * 5 + 8) & 3]; g.fillRect(X, Y, 30, 30);
            g.fillStyle = 'rgba(255,250,235,0.3)'; g.fillRect(X, Y, 30, 1.2); g.fillStyle = 'rgba(30,26,20,0.25)'; g.fillRect(X, Y + 28.8, 30, 1.2);
          }
          break;
        }
        case 'checker': {
          for (let ky = -1; ky <= 2; ky++) for (let kx = -1; kx <= 2; kx++) {
            const X = kx * 32, Y = ky * 32, dark = (kx + ky) & 1;
            g.fillStyle = dark ? '#5e5a54' : '#d4ccbc'; g.fillRect(X, Y, 32, 32);
            g.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.3)'; g.fillRect(X + 1, Y + 1, 30, 1.2);
            g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(X, Y + 31, 32, 1);
          }
          break;
        }
      }
    });
  }, { crop: false });
}
// edge strips (N side; S = mirrored, W / E = rotated at draw time): 'wood' trim, 'stone' curb, 'inlay' band, 'carpet'
// border + fringe (white: tinted). Anchor = tile centre. Carpet body: one full white tile.
function floorStrip(kind) {
  return spritePx(64 + FLB * 2, 64 + FLB * 2, (g) => {
    g.translate(FLB, FLB);
    if (kind === 'wood') {
      g.fillStyle = '#6e4b2c'; g.fillRect(-1, 0, 66, 4);
      g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(-1, 0.5, 66, 1);
      g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(-1, 4, 66, 1);
      g.fillStyle = 'rgba(28,18,10,0.85)'; g.fillRect(-FLB, -FLB, 64 + FLB * 2, FLB + 0.9);
    } else if (kind === 'stone') {
      g.fillStyle = '#8a8478'; g.fillRect(-1, 0, 66, 5);
      g.fillStyle = 'rgba(40,36,30,0.55)'; for (let k = 1; k < 4; k++) g.fillRect(k * 16, 0, 0.9, 5);
      g.fillStyle = 'rgba(255,250,235,0.3)'; g.fillRect(-1, 0.4, 66, 1);
      g.fillStyle = 'rgba(20,16,12,0.35)'; g.fillRect(-1, 5, 66, 1);
      g.fillStyle = 'rgba(32,30,26,0.85)'; g.fillRect(-FLB, -FLB, 64 + FLB * 2, FLB + 0.9);
    } else if (kind === 'inlay') {
      g.fillStyle = '#c9a24a'; g.fillRect(-1, 6, 66, 4);
      g.fillStyle = '#7a3a2a'; for (let x = 2; x < 64; x += 8) g.fillRect(x, 7, 3, 2);
    } else if (kind === 'carpet') {
      g.fillStyle = 'rgba(30,14,8,0.55)'; g.fillRect(-1, 0, 66, 7.5);
      g.fillStyle = '#f2d98a'; g.fillRect(-1, 1.6, 66, 2.4); g.fillRect(-1, 5.2, 66, 1);
      g.fillStyle = 'rgba(40,20,10,0.7)'; g.fillRect(-1, 0, 66, 0.9);
      g.strokeStyle = '#efe6d2'; g.lineWidth = 0.8;
      for (let x = 0; x < 64; x += 2.2) { g.beginPath(); g.moveTo(x, 0.4); g.lineTo(x, -FLB + 0.2); g.stroke(); }
    } else { // carpet body
      g.fillStyle = '#ddd6ca'; g.fillRect(-FLB, -FLB, 64 + FLB * 2, 64 + FLB * 2);
      g.fillStyle = 'rgba(0,0,0,0.1)'; for (let k = 0; k < 64; k += 4) g.fillRect(-FLB, k, 64 + FLB * 2, 0.8);
      // diamond lattice (periodic in 32) with little crosses
      g.strokeStyle = 'rgba(40,24,12,0.32)'; g.lineWidth = 1.4;
      for (let k = -64; k <= 64; k += 32) { g.beginPath(); g.moveTo(k, -FLB); g.lineTo(k + 64 + FLB * 2, 64 + FLB); g.moveTo(k + 64, -FLB); g.lineTo(k - FLB, 64 + FLB); g.stroke(); }
      g.fillStyle = 'rgba(255,240,200,0.55)'; for (const [x, y] of [[16, 0], [48, 0], [0, 16], [32, 16], [64, 16], [16, 32], [48, 32], [0, 48], [32, 48], [64, 48], [16, 64], [48, 64]]) { g.fillRect(x - 2.5, y - 0.6, 5, 1.2); g.fillRect(x - 0.6, y - 2.5, 1.2, 5); }
      g.fillStyle = 'rgba(20,10,4,0.22)'; for (const [x, y] of [[0, 0], [32, 0], [64, 0], [16, 16], [48, 16], [0, 32], [32, 32], [64, 32], [16, 48], [48, 48], [0, 64], [32, 64], [64, 64]]) { g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + 3, y); g.lineTo(x, y + 3); g.lineTo(x - 3, y); g.closePath(); g.fill(); }
    }
  }, { pad: 2 });
}
function floorInlay() {
  return spritePx(64, 64, (g) => {
    g.fillStyle = '#c9a24a'; g.beginPath(); g.ellipse(32, 32, 14, 14, 0, 0, TAU); g.fill();
    g.fillStyle = '#7a3a2a'; g.beginPath(); g.ellipse(32, 32, 11, 11, 0, 0, TAU); g.fill();
    g.fillStyle = '#e8d6a0';
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a - 0.22) * 10, 32 + Math.sin(a - 0.22) * 10); g.lineTo(32 + Math.cos(a) * 12.5, 32 + Math.sin(a) * 12.5); g.lineTo(32 + Math.cos(a + 0.22) * 10, 32 + Math.sin(a + 0.22) * 10); g.closePath(); g.fill(); }
    g.fillStyle = '#2f5a86'; g.beginPath(); circle(g, 32, 32, 3); g.fill();
    g.strokeStyle = 'rgba(40,20,10,0.6)'; g.lineWidth = 0.9; g.beginPath(); g.ellipse(32, 32, 14, 14, 0, 0, TAU); g.stroke();
  }, { pad: 2 });
}
function floorScatter(kind, v) {
  const rand = rng(1400 + v * 7 + (kind === 'straw' ? 0 : kind === 'leaves' ? 50 : 90));
  return spritePx(64, 64, (g) => {
    const n = kind === 'moss' ? 14 : 18;
    for (let i = 0; i < n; i++) {
      const x = 4 + rand() * 56, y = 4 + rand() * 56;
      if (kind === 'straw') { g.strokeStyle = rand() < 0.5 ? 'rgba(222,190,110,0.85)' : 'rgba(190,156,80,0.85)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 9, y + (rand() - 0.5) * 4); g.stroke(); }
      else if (kind === 'leaves') { g.fillStyle = ['rgba(196,110,40,0.85)', 'rgba(222,160,60,0.85)', 'rgba(150,80,40,0.85)'][(rand() * 3) | 0]; g.beginPath(); g.ellipse(x, y, 2.4, 1.4, rand() * 3, 0, TAU); g.fill(); }
      else { g.fillStyle = rand() < 0.5 ? 'rgba(86,118,52,0.6)' : 'rgba(110,140,66,0.55)'; g.beginPath(); g.ellipse(x, y, 2 + rand() * 3, 0.8 + rand(), rand() * 3, 0, TAU); g.fill(); }
    }
  }, { pad: 2 });
}

// ---------------- registration ----------------
export const FLOOR_STYLES = ['herring', 'parquet', 'wide', 'cobble', 'tiles', 'checker'];
export const FENCE_STYLES = { picket: 'fence_wood', board: 'fence_wood', wattle: 'fence_wood', stone: 'fence_stone', hedge: 'hedge' };
// every sprite of this module: S(name, paint, ax, ay, baked). Baked = the default look of K's own pieces (stone wall,
// hedge) and the emissive glows; everything else is painted lazily on demand (art/lazyDefs.js → shared lazy texture).
function archSprites(S) {
  for (const st of WALL_STYLES) {
    if (st !== 'plank' && st !== 'cut') for (let m = 0; m < 16; m++) S(`wst_${st}_${m}`, () => wallStyleSprite(st, m), 0.5, 1);
    for (const m of SOFT_MASKS) S(`wst_${st}_s${m}`, () => wallStyleSprite(st, m, true), 0.5, 1);
  }
  const A = (n, f, baked = false) => S(n, f, 0.5, 1, baked);
  // corner pieces per material family and corner (nw, ne, sw, se); buttresses and wooden trims per family
  for (const c of CORNERS) {
    for (const f of WOOD_FAMS) { A(`kd_post_${f}_${c}`, () => woodPost(f, c)); A(`kd_pillar_${f}_${c}`, () => woodPillar(f, c)); A(`kd_endp_${f}_${c}`, () => woodPost(f, c, true)); }
    for (const f of STONE_FAMS) { A(`kd_post_${f}_${c}`, () => stonePost(f, c)); A(`kd_pillar_${f}_${c}`, () => stonePillar(f, c)); A(`kd_endp_${f}_${c}`, () => stoneEnd(f, c)); }
    for (const f of QUOIN_FAMS) A(`kd_quoin_${f}_${c}`, () => quoinPiece(f, c));
  }
  for (const f of WOOD_FAMS) {
    A(`kd_bt_${f}`, () => woodButtress(f)); A(`kd_bandw_${f}`, () => bandWood(f));
    for (const e of ['n', 's', 'w']) { A(`kd_capw_${f}_${e}`, () => capWood(f, e)); A(`kd_crenw_${f}_${e}`, () => crenWood(f, e)); }
  }
  for (const f of STONE_FAMS) A(`kd_bt_${f}`, () => stoneButtress(f));
  A('kd_plinth', plinth);
  A('kd_cap_n', () => capPiece('n')); A('kd_cap_s', () => capPiece('s')); A('kd_cap_w', () => capPiece('w'));
  A('kd_cren_n', () => crenel('n')); A('kd_cren_s', () => crenel('s')); A('kd_cren_w', () => crenel('w'));
  A('kd_beams', beams); A('kd_band', band);
  for (const k of ['window', 'shutters', 'curtains', 'oculus', 'slit']) A('kd_' + k, () => windowArt(k, false));
  A('kd_win_glow', () => windowArt('window', true), true); A('kd_oculus_glow', () => windowArt('oculus', true), true);
  A('kd_winbox', winbox);
  for (const k of ['shelf', 'hooks', 'antlers', 'pennant', 'painting', 'shield', 'sconce']) A('kd_' + k, () => mount(k));
  for (let v = 0; v < 3; v++) A('kd_ivy_' + v, () => ivy(v));
  for (let v = 0; v < 2; v++) A('kd_moss_' + v, () => moss(v));
  for (let v = 0; v < 2; v++) A('kd_cracks_' + v, () => cracksArt(v));
  for (let k = 0; k < 4; k++) { A('siege_crack_t' + k, () => siegeCrackArt(k, false)); A('siege_crack_f' + k, () => siegeCrackArt(k, true)); }
  A('kd_weather', weatherArt); A('kd_flowers', flowersArt);
  // doors
  for (const st of ['panel', 'iron', 'arched', 'rustic']) {
    S(`kdr_${st}_h_leaf`, () => doorLeafSprite(st), 9 / 64, 1);
    S(`kdr_${st}_v_leaf`, () => doorLeafV(st), 0.5, (0.15 * 64 + (FH - DH)) / (64 + FH));
  }
  A('kd_door_arch', doorArch); A('kd_awning', awning); A('kd_dlantern', doorLantern); A('kd_knocker', knocker); A('kd_wreath', wreath);
  A('kd_step', doorStep);
  // fences (stone wall / hedge masks: baked, they are those pieces' own default look)
  for (const st in FENCE_STYLES) for (let m = 0; m < 16; m++) S(`kfe_${st}_${m}`, () => fenceStyleSprite(st, m), 0.5, 1, st === 'stone' || st === 'hedge');
  S('fence_stone', () => fenceStyleSprite('stone', 0), 0.5, 1, true); S('hedge', () => fenceStyleSprite('hedge', 0), 0.5, 1, true);
  for (const k of ['flat', 'ball', 'point']) A('kfe_cap_' + k, () => fenceCap(k));
  A('kfe_lantern', fenceLantern); A('kfe_flowers', fenceFlowers); A('kfe_vines_h', () => fenceVines(0)); A('kfe_vines_v', () => fenceVines(1)); A('kfe_bird', bird);
  // gates
  for (const st of ['picket', 'board']) { S(`kg_${st}_h_leaf`, () => gateLeafStyled(st, 'leaf'), 10 / 64, 1); S(`kg_${st}_v_leaf`, () => gateLeafStyledV(st), 0.5, (PH + 5 - 24) / (64 + PH)); }
  A('kg_arch', gateArch); A('kg_sign', gateSign);
  // floors
  const flAy = (64 + FLB) / (64 + FLB * 2);
  for (const st of FLOOR_STYLES) S('kf_' + st, () => floorTex(st), 0.5, flAy);
  for (const k of ['wood', 'stone', 'inlay', 'carpet', 'body']) S('kfx_' + k, () => floorStrip(k), 0.5, 0.5);
  S('kf_inlay', floorInlay, 0.5, 1);
  for (const k of ['straw', 'leaves', 'moss']) for (let v = 0; v < 2; v++) S(`kf_${k}_${v}`, () => floorScatter(k, v), 0.5, 1);
}
export function addArch(add) {
  archSprites((n, f, ax, ay, baked) => { if (baked) add(n, f(), ax, ay); });
  TEX.clear();
}
// lazy registration happens at import (the baked atlas may come from the cache: addArch then never runs); the
// tile texture cache is shared by the masks of a style while they are painted, then dropped once painting goes idle
let texTimer = 0;
const lazyPaint = (f) => () => {
  const c = f();
  clearTimeout(texTimer);
  texTimer = setTimeout(() => TEX.clear(), 3000);
  return c;
};
archSprites((n, f, ax, ay, baked) => { if (!baked) lazyDef(n, lazyPaint(f), ax, ay); });

// geometry for archCompose.js (tiles)
export const ARCH_GEOM = { FH: FH / 64, PH: PH / 64, dlanternLift: (F1 - (FM + 6 + 4)) / 64, sconceLift: (F1 - (FM + 11 - 7)) / 64, postTop: (FR.post + 3) / 64, lanternFlame: { x: 7 / 64, lift: (FR.post + 2 + 5) / 64 } };
