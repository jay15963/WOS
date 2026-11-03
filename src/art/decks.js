// Piers and bridges (game/decks.js) — atlas art: the build-menu icons (pier_wood, bridge_wood) and the textures the
// procedural 3D pieces sample (art/faces/deck.js), all at 64 px per tile so a face shows them at the game's pixel size:
//   deck_planks_0..2  top of a deck, 64 × 64: six boards running along u (across the way you walk), gaps, nails over the
//                     two stringers (u 10 / 54), butt joints, knots
//   deck_wood         64 × 64 side grain (beams, rails, posts, fascia, ladder)
//   deck_log          32 × 64 bark (piles), the grain along v
//   deck_stone        64 × 64 dressed stone courses (bridge abutments, parapets)
//   deck_rope         32 × 8 twisted rope (mooring posts)
//   deck_snow         64 × 64 snow lying on the tops (drawn over them by the season)
// Seeded painters only (no Math.random): every client paints the same atlas.

import { spritePx, rng, lin, TAU, canvas } from './paint.js';

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
// a pixel canvas painted by fn(x, y) → [r, g, b, a?]
function tex(W, H, fn) {
  const c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = fn(x, y), o = (y * W + x) * 4;
    d[o] = clamp(p[0]); d[o + 1] = clamp(p[1]); d[o + 2] = clamp(p[2]); d[o + 3] = clamp(p[3] ?? 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}
// smooth value noise (seeded lattice)
function noise2(seed, sx, sy) {
  const r = rng(seed), G = new Float32Array(17 * 17);
  for (let i = 0; i < G.length; i++) G[i] = r();
  return (x, y) => {
    const fx = (x / sx) % 16, fy = (y / sy) % 16, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
    const a = G[y0 * 17 + x0], b = G[y0 * 17 + x0 + 1], c = G[(y0 + 1) * 17 + x0], d = G[(y0 + 1) * 17 + x0 + 1];
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv;
  };
}

const WOOD = [[118, 86, 54], [138, 102, 64], [156, 120, 78]];
const mixA = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// deck boards seen from above
function planks(seed) {
  const r = rng(seed), N = 6, BH = 64 / N, nz = noise2(seed + 3, 9, 3), fine = noise2(seed + 7, 2.2, 0.8);
  const B = [];
  for (let i = 0; i < N; i++) B.push({ t: 0.84 + r() * 0.26, w: r(), ph: r() * 50, j: r() < 0.5 ? 6 + Math.floor(r() * 52) : -9, kx: 6 + r() * 52, ky: 2 + r() * (BH - 4), k: r() < 0.45 });
  return tex(64, 64, (x, y) => {
    const b = Math.min(N - 1, Math.floor(y / BH)), yb = y - b * BH, P = B[b];
    if (yb < 1) return [44, 31, 20]; // the gap between boards
    let c = mixA(WOOD[0], WOOD[2], 0.25 + P.w * 0.6);
    let k = P.t * (0.9 + 0.2 * nz(x + b * 37, y));
    k *= 0.94 + 0.12 * fine(x + P.ph * 3, y * 3 + b * 11); // grain streaks along the board
    if (yb < 2) k *= 1.12; // lit top edge of the board
    if (yb > BH - 2) k *= 0.8; // its shadowed lower edge
    if (Math.abs(x - P.j) < 1) return [52, 37, 24]; // butt joint
    if (Math.abs(x - P.j) < 2) k *= 0.85;
    if (P.k) { const dx = (x - P.kx) / 2.6, dy = (yb - P.ky) / 1.4, q = dx * dx + dy * dy; if (q < 1) k *= 0.62 + 0.3 * q; } // a knot
    // nails over the stringers
    for (const nx of [10, 54]) for (const ny of [BH * 0.3, BH * 0.72]) {
      const q = (x - nx) ** 2 + (yb - ny) ** 2;
      if (q < 0.8) return [70, 66, 62];
      if (q < 2.2) k *= 0.82;
    }
    return [c[0] * k, c[1] * k, c[2] * k];
  });
}

// side grain (beams, rails, posts): long streaks along u
function sideWood(seed) {
  const r = rng(seed), nz = noise2(seed + 1, 14, 2.2), fine = noise2(seed + 2, 3, 0.7);
  const bands = []; for (let i = 0; i < 10; i++) bands.push(r());
  return tex(64, 64, (x, y) => {
    const w = bands[Math.floor(y / 6.4) % 10];
    const c = mixA(WOOD[0], WOOD[1], 0.2 + 0.6 * w);
    let k = 0.86 + 0.22 * nz(x, y) + 0.1 * (fine(x, y * 2) - 0.5);
    if (y % 13 === 0) k *= 0.82;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
}

// bark of a pile: grooves along v (the pile's length)
function logBark(seed) {
  const nz = noise2(seed, 2.5, 10), n2 = noise2(seed + 5, 1.2, 3);
  return tex(32, 64, (x, y) => {
    const groove = nz(x * 1.6, y);
    let k = 0.72 + 0.4 * groove + 0.12 * (n2(x, y) - 0.5);
    const c = mixA([88, 70, 52], [112, 92, 68], groove);
    if (groove < 0.25) k *= 0.75;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
}

// dressed stone courses with mortar
function stone(seed) {
  const r = rng(seed), rows = [];
  let y = 0;
  while (y < 64) { const h = 12 + Math.floor(r() * 6); const cuts = [], off = r() * 20; for (let x = -off; x < 70; x += 14 + r() * 16) cuts.push(x); rows.push({ y0: y, y1: Math.min(64, y + h), cuts, t: [] }); y += h; }
  for (const R of rows) for (let i = 0; i <= R.cuts.length; i++) R.t.push(0.86 + r() * 0.26);
  const nz = noise2(seed + 9, 3, 3), sp = noise2(seed + 11, 1, 1);
  return tex(64, 64, (x, yy) => {
    const R = rows.find((q) => yy >= q.y0 && yy < q.y1) || rows[rows.length - 1];
    let bi = 0; while (bi < R.cuts.length && x >= R.cuts[bi]) bi++;
    const a = bi > 0 ? R.cuts[bi - 1] : -99, b = bi < R.cuts.length ? R.cuts[bi] : 999;
    const mort = yy - R.y0 < 1.2 || x - a < 1.2 || b - x < 0.8;
    if (mort) return [92, 86, 76];
    let k = R.t[bi] * (0.9 + 0.2 * nz(x, yy));
    if (yy - R.y0 < 2.6) k *= 1.12; // the lit top of each block
    if (R.y1 - yy < 2) k *= 0.84;
    const s = sp(x * 3.1, yy * 2.7);
    if (s > 0.86) k *= 1.12; else if (s < 0.1) k *= 0.85;
    return [158 * k, 150 * k, 136 * k];
  });
}

function rope() {
  return tex(32, 8, (x, y) => {
    const t = ((x + y * 1.4) % 5) / 5;
    const k = 0.75 + 0.35 * Math.sin(t * Math.PI);
    const e = y === 0 || y === 7 ? 0.7 : 1;
    return [182 * k * e, 152 * k * e, 104 * k * e];
  });
}

// patchy: drifts with thin spots where the boards show through
function snow(seed) {
  const nz = noise2(seed, 7, 7), n2 = noise2(seed + 2, 3, 3), sp = noise2(seed + 4, 1, 1);
  return tex(64, 64, (x, y) => {
    const n = nz(x, y), m = n2(x, y), s = sp(x * 2.3, y * 1.9);
    const k = 0.9 + 0.12 * n + (s > 0.93 ? 0.08 : 0);
    const c = Math.max(0, Math.min(1, (n * 0.7 + m * 0.5 - 0.3) / 0.45));
    return [232 * k, 238 * k, 248 * k, 70 + 185 * c * c * (3 - 2 * c)];
  });
}

// ---------- build-menu icons ----------
const mk = (wt, E, fn) => spritePx(Math.round(wt * 64), 64 + E, (g, P) => fn(g, P, (v, h) => E + v * 64 - h, Math.round(wt * 64)), { pad: 12 });
const W1 = { deep: '#3e2a18', dark: '#5d4128', mid: '#80603e', light: '#a17c52', high: '#c29c6c' };

function pierIcon() {
  return mk(1, 22, (g, P, Y, W) => {
    const cx = W / 2;
    // water
    g.fillStyle = lin(g, 0, Y(0.55, 0), 0, Y(1, 0), [[0, '#3f7f96'], [1, '#2d6178']]);
    g.beginPath(); g.ellipse(cx, Y(0.8, 0), 34, 15, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(220,240,250,0.5)'; g.lineWidth = 1;
    for (const [x, y, w] of [[-20, 0.86, 9], [14, 0.9, 11], [-4, 0.98, 8]]) { g.beginPath(); g.moveTo(cx + x, Y(y, 0)); g.lineTo(cx + x + w, Y(y, 0)); g.stroke(); }
    P.layer((g) => {
      // piles
      for (const [x, v] of [[-17, 0.5], [17, 0.5], [-17, 0.95], [17, 0.95]]) {
        g.fillStyle = lin(g, cx + x - 3, 0, cx + x + 3, 0, [[0, W1.light], [1, W1.deep]]);
        g.fillRect(cx + x - 3, Y(v, 26), 6, 26 + 2);
      }
      // deck going away: planks across
      const y0 = Y(0.3, 12), y1 = Y(1.0, 12);
      g.fillStyle = W1.mid; g.beginPath(); g.moveTo(cx - 16, y0); g.lineTo(cx + 16, y0); g.lineTo(cx + 22, y1); g.lineTo(cx - 22, y1); g.closePath(); g.fill();
      for (let i = 0; i < 7; i++) {
        const t = i / 7, ya = y0 + (y1 - y0) * t, hw = 16 + 6 * t;
        g.fillStyle = i & 1 ? W1.light : W1.high; g.fillRect(cx - hw, ya + 1, hw * 2, (y1 - y0) / 7 - 1.4);
      }
      // front fascia
      g.fillStyle = W1.dark; g.fillRect(cx - 22, y1, 44, 5);
      // bollards at the far end with rope
      for (const x of [-15, 15]) {
        g.fillStyle = lin(g, cx + x - 3, 0, cx + x + 3, 0, [[0, W1.high], [1, W1.dark]]); g.fillRect(cx + x - 3, y0 - 13, 6, 14);
        g.fillStyle = '#c9a76c'; g.fillRect(cx + x - 3.5, y0 - 9, 7, 3);
      }
    }, 2.4);
  });
}

function bridgeIcon() {
  return mk(1.25, 18, (g, P, Y, W) => {
    const cx = W / 2;
    g.fillStyle = lin(g, 0, Y(0.6, 0), 0, Y(1, 0), [[0, '#3f7f96'], [1, '#2a5a70']]);
    g.beginPath(); g.ellipse(cx, Y(0.84, 0), 30, 11, 0, 0, TAU); g.fill();
    P.layer((g) => {
      const arc = (t) => Y(0.78, 22 + 12 * Math.sin(Math.PI * t));
      const xa = cx - 38, xb = cx + 38;
      // stone abutments
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? xa - 4 : xb - 12, x1 = s < 0 ? xa + 12 : xb + 4;
        g.fillStyle = '#9d9585'; g.fillRect(x0, Y(0.78, 24), x1 - x0, 24);
        g.strokeStyle = 'rgba(70,64,56,0.7)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x0, Y(0.78, 12)); g.lineTo(x1, Y(0.78, 12)); g.moveTo((x0 + x1) / 2, Y(0.78, 24)); g.lineTo((x0 + x1) / 2, Y(0.78, 12)); g.stroke();
      }
      // piles of the middle bent
      g.fillStyle = W1.dark; g.fillRect(cx - 2.5, arc(0.5) + 4, 5, Y(0.84, 0) - arc(0.5) - 4);
      // the deck (arched) with its fascia
      g.beginPath(); for (let i = 0; i <= 16; i++) { const t = i / 16, x = xa + (xb - xa) * t; i ? g.lineTo(x, arc(t)) : g.moveTo(x, arc(t)); }
      for (let i = 16; i >= 0; i--) { const t = i / 16, x = xa + (xb - xa) * t; g.lineTo(x, arc(t) + 6); }
      g.closePath(); g.fillStyle = W1.mid; g.fill();
      g.strokeStyle = W1.high; g.lineWidth = 1.4; g.beginPath(); for (let i = 0; i <= 16; i++) { const t = i / 16, x = xa + (xb - xa) * t; i ? g.lineTo(x, arc(t)) : g.moveTo(x, arc(t)); } g.stroke();
      // railing: posts and the handrail
      g.fillStyle = W1.light;
      for (let i = 0; i <= 6; i++) { const t = i / 6, x = xa + (xb - xa) * t; g.fillRect(x - 1.6, arc(t) - 15, 3.2, 15); }
      g.strokeStyle = W1.high; g.lineWidth = 2.6;
      g.beginPath(); for (let i = 0; i <= 16; i++) { const t = i / 16, x = xa + (xb - xa) * t; i ? g.lineTo(x, arc(t) - 15) : g.moveTo(x, arc(t) - 15); } g.stroke();
      g.strokeStyle = W1.mid; g.lineWidth = 1.4;
      g.beginPath(); for (let i = 0; i <= 16; i++) { const t = i / 16, x = xa + (xb - xa) * t; i ? g.lineTo(x, arc(t) - 7) : g.moveTo(x, arc(t) - 7); } g.stroke();
    }, 2.4);
  });
}

export function addDeckArt(add) {
  add('pier_wood', pierIcon(), 0.5, 1);
  add('bridge_wood', bridgeIcon(), 0.5, 1);
  for (let i = 0; i < 3; i++) add('deck_planks_' + i, planks(4101 + i * 17), 0, 0);
  add('deck_wood', sideWood(4211), 0, 0);
  add('deck_log', logBark(4307), 0, 0);
  add('deck_stone', stone(4409), 0, 0);
  add('deck_rope', rope(), 0, 0);
  add('deck_snow', snow(4513), 0, 0);
}
