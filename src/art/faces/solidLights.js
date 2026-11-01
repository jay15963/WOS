// Camera rotation — solid pieces (art/faces/solid.js): lights, fire and production stations. Numbers read off each
// painter (art/buildings.js, stations.js, decor.js): x px from the art's centre column, v = ground row in tiles (anchor
// row V), h px above the ground. Every piece has its true depth at every angle (ramp: false); k only says how the art
// draws depth (art depth / true depth: a flat-front art is stretched over the tops). Flames, glows, halos and steam are
// camera-facing like particles on their 3D spots (fx); glows painted on the art (coals, lit glass, a furnace mouth) are
// laid on the faces (glow); the light pool / halo / smoke of fx/ambient.js come from `light`.
import { defineSolid } from './solid.js';
import { mountDepth } from './walls.js';
import { CAMV, KIT_ENV, ARCH_FACES as K } from '../archCompose.js';
import { torchFlame } from '../composeWorld.js';
import { TORCH_FLAME_LIFT } from '../buildings.js';

// ---------- shared ----------
// sprites of the flames / glow / smoke (per atlas)
const FXT = new WeakMap();
function fxt(A) {
  let T = FXT.get(A);
  if (T) return T;
  const KT = K.tables(A);
  T = { flames: KT.flames, glow: KT.glow, smoke: KT.opt('fx_smoke') || KT.opt('fx_soft'), KT };
  FXT.set(A, T);
  return T;
}
const lit = (o) => o.fire !== false && o.lit !== false;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// how much the piece's front faces the camera (1 = straight at it, ≤ 0 = turned away): fires inside an opening
const FV = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
function facing(o) { const f = FV[o.face || 's'] || FV.s; return -CAMV.s * f[0] + CAMV.c * f[1]; }
// flicker shared by the lit stations (composeWorld drawLit)
const flick = (o, t) => { const seed = o.x * 1.37 + o.y * 0.71; return 0.82 + 0.12 * Math.sin(t * 9.3 + seed) + 0.06 * Math.sin(t * 23.1 + seed * 2); };
// a sprite added at (x, y) moved dx tiles across the screen (flames spread left / right as the camera sees them)
const sx = (x, dx) => x + CAMV.c * dx, sy = (y, dx) => y + CAMV.s * dx;
// fire: flames of a fire bed (campfire, brazier, fireplace) — the painters' shapes around one point
function fireBed(B, T, x, y, lift, t, seed, n, spread, big, glowA, a) {
  for (let i = 0; i < n; i++) {
    const ph = t * (8.5 + i * 2.3) + i * 2.1 + seed, q = 0.86 + 0.16 * Math.sin(ph) + 0.08 * Math.sin(ph * 2.7 + 1), mid = i === (n >> 1);
    const dx = (i - (n - 1) / 2) * spread + 0.02 * Math.sin(ph * 1.3);
    const w = (mid ? big[0] : big[2]) * q, h = (mid ? big[1] : big[3]) * (0.85 + 0.15 * Math.sin(ph * 0.8 + i)) * q;
    if (T.flames[i]) B.emissive.add(T.flames[i], sx(x, dx), sy(y, dx), w, h, 1, 1, 1, 0.92 * a, 0, (i - (n - 1) / 2) * 0.22 + 0.08 * Math.sin(ph * 0.7), 0, 1, 0, lift);
  }
  if (T.glow && glowA > 0) B.emissive.add(T.glow, x, y, 1.4, 1.1, 1, 0.55, 0.25, glowA * a, 0, 0, 0, 1, 0, lift + 0.05);
}
// a candle / lantern flame (archCompose smallFlame)
const candle = (k) => (B, A, o, t, x, y, lift, a) => { if (a > 0.05) K.smallFlame(B, fxt(A).KT, x, y, lift, 1, t, k); };

// ---------- campfire (buildings.js campfire: 80 × 60, anchor row 40, no Y(v, h): v = 1 + (row − 40 + h) / 64) ----------
// a ring of 10 stones (radius 27 px drawn 13 px deep: k) around the ash bed and the crossed logs (a low mound)
const CF_V = 1 - 3 / 64; // the ring's centre (row 37)
const CF_STONES = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + 0.15;
  CF_STONES.push({ lathe: [27 * Math.cos(a), CF_V + (13 * Math.sin(a)) / 64, [[0, 7], [4, 3.5]]], n: 5, sh: false });
}
defineSolid('campfire', {
  k: 13 / 27, piv: CF_V - 1, ramp: false,
  parts: [{ lathe: [0, CF_V, [[0, 23], [2, 20], [7, 9], [9, 0]]], n: 10, sh: false }, ...CF_STONES],
  glow: { s: 'campfire_coals', parts: [0], a: (o, t) => { if (!lit(o)) return 0; const s = o.x * 1.7 + o.y; return 0.75 + 0.2 * Math.sin(t * 3.1 + s) * Math.sin(t * 7.7 + s); } },
  fx: [{ at: [0, CF_V, 3.4], draw(B, A, o, t, x, y, lift, a) {
    if (!lit(o)) return;
    const T = fxt(A), seed = o.x * 1.7 + o.y;
    fireBed(B, T, x, y, lift, t, seed, 3, 0.13, [0.92, 1.35, 0.68, 0.95], 0.22 + 0.05 * Math.sin(t * 9 + seed), a);
    const pop = Math.sin(t * 5.3 + seed) * 0.5 + 0.5, dx = Math.sin(t * 2.1 + seed) * 0.08;
    if (T.flames[0]) B.emissive.add(T.flames[(t * 3 | 0) % 3], sx(x, dx), sy(y, dx), 0.35, 0.6 * pop, 1, 1, 1, 0.7 * pop * a, 0, 0, 0, 1, 0, lift + 0.2);
  } }],
  light: [0, CF_V, 0],
  blob: [0.9, 0.5, 3 / 64, 0.35],
});

// ---------- brazier (stations.js brazier, mk(1, 40)): iron bowl on three splayed legs ----------
// the rim is drawn 15 × 4.2 (k); the legs' feet sit on the ring that k gives (the art draws them further apart in depth)
defineSolid('brazier', {
  k: 0.28, piv: 0.62 - 1, ramp: false,
  parts: [
    { lathe: [0, 0.62, [[36, 0], [40, 9], [45, 13], [50, 15]]], n: 12 },
    { lathe: [-16, 0.6603, [[0, 1.3], [40, 1.3]]], lean: [0.205, -0.033], n: 4, sh: false },
    { lathe: [16, 0.6603, [[0, 1.3], [40, 1.3]]], lean: [-0.205, -0.033], n: 4, sh: false },
    { lathe: [0, 0.539, [[0, 1.3], [40, 1.3]]], lean: [0, 0.0986], n: 4, sh: false },
  ],
  glow: { s: 'brazier_coals', parts: [0], a: (o, t) => (lit(o) ? flick(o, t) : 0) },
  fx: [{ at: [0, 0.62, 47.4], draw(B, A, o, t, x, y, lift, a) {
    if (!lit(o)) return;
    const T = fxt(A), seed = o.x * 1.37 + o.y * 0.71;
    for (let i = 0; i < 3; i++) {
      const ph = t * (8 + i * 2.6) + i * 2.4 + seed, q = 0.85 + 0.15 * Math.sin(ph) + 0.06 * Math.sin(ph * 2.2), dx = (i - 1) * 0.1 + 0.02 * Math.sin(ph);
      if (T.flames[i]) B.emissive.add(T.flames[i], sx(x, dx), sy(y, dx), (i === 1 ? 0.6 : 0.42) * q, (i === 1 ? 0.85 : 0.6) * q, 1, 1, 1, 0.9 * a, 0, (i - 1) * 0.2, 0, 1, 0, lift);
    }
    if (T.glow) B.emissive.add(T.glow, x, y, 1.4, 1.1, 1, 0.55, 0.25, 0.22 * flick(o, t) * a, 0, 0, 0, 1, 0, lift);
  } }],
  light: [0, 0.62, 0],
  blob: [0.85, 0.42, 0.38, 0.38],
});

// ---------- cooking pot (stations.js cookingPot, mk(1, 40)): fire ring, tripod, chain and cauldron ----------
const CP_STONES = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  CP_STONES.push({ lathe: [21 * Math.cos(a), 0.62 + (8.5 * Math.sin(a)) / 64, [[0, 6.5], [3.5, 2.5]]], n: 5, sh: false });
}
defineSolid('cooking_pot', {
  k: 0.4, piv: 0.62 - 1, ramp: false,
  parts: [
    { lathe: [0, 0.62, [[0, 20], [2, 18], [5, 10], [7, 0]]], n: 10, sh: false },
    { lathe: [0, 0.62, [[12, 6], [16, 13], [22, 16], [28, 16], [32, 15.5]]], n: 12 },
    { lathe: [-24, 0.7069, [[0, 1.5], [64.5, 1.5]]], lean: [0.372, -0.0862], n: 4, sh: false },
    { lathe: [24, 0.7069, [[0, 1.5], [64.5, 1.5]]], lean: [-0.372, -0.0862], n: 4, sh: false },
    { lathe: [3, 0.4469, [[0, 1.5], [64.5, 1.5]]], lean: [-0.0465, 0.1718], n: 4, sh: false },
    { lathe: [0, 0.62, [[34, 0.6], [62, 0.6]]], n: 4, sh: false },
    { card: [-13, 13, 0.62, 32, 50], t: 0.4, sh: false, z: 0.01 },
    { card: [3, 15, 0.62, 30, 46], t: 0.4, sh: false, z: 0.01 },
    ...CP_STONES,
  ],
  glow: { s: 'cooking_pot_coals', parts: [0], a: (o, t) => (lit(o) ? flick(o, t) : 0) },
  fx: [{ at: [0, 0.62, 1.3], draw(B, A, o, t, x, y, lift, a) {
    const T = fxt(A), seed = o.x * 1.37 + o.y * 0.71;
    if (lit(o)) {
      for (let i = 0; i < 2; i++) {
        const ph = t * (9 + i * 3) + i * 2 + seed, q = 0.85 + 0.15 * Math.sin(ph), dx = (i - 0.5) * 0.14;
        if (T.flames[i]) B.emissive.add(T.flames[i], sx(x, dx), sy(y, dx), 0.34 * q, 0.38 * q, 1, 1, 1, 0.85 * a, 0, (i - 0.5) * 0.3, 0, 1, 0, lift);
      }
      if (T.glow) B.emissive.add(T.glow, x, y, 1.0, 0.7, 1, 0.55, 0.25, 0.18 * flick(o, t) * a, 0, 0, 0, 1, 0, lift - 0.02);
    }
    // steam over the rim while it cooks
    if (o.working && T.smoke) {
      for (let i = 0; i < 3; i++) {
        const u = (t * 0.45 + i / 3 + seed * 0.1) % 1, dx = Math.sin(u * 6 + i * 2 + t) * 0.07, s = 0.28 + u * 0.4;
        B.fx.add(T.smoke, sx(x, dx), sy(y, dx), s, s, 0.95, 0.95, 0.95, Math.sin(u * Math.PI) * 0.42 * a, 0, u * 2 + i, 0, 1, 0, lift + 0.48 + u * 0.75);
      }
    }
  } }],
  light: [0, 0.62, 0],
  blob: [0.85, 0.42, 0.38, 0.38],
});

// ---------- furnace (stations.js furnace, mk(1, 60)): stone dome with its mouth, chimney behind ----------
// the art draws the dome flat (front only): k stretches its upper rows over the dome's top; the back is furnace_back
// (stations.js, painted only for the turned camera)
const FU = { k: 0.2, piv: 0.872 - 1 };
const FU_DOME = { lathe: [0, 0.872, [[0, 25], [26, 25], [33, 20], [37, 12], [39, 0]]], n: 12 };
const FU_CHIM = [[0, 6], [64, 6], [64, 7], [66, 7]];
defineSolid('furnace', {
  ...FU, ramp: false,
  parts: [
    FU_DOME,
    { lathe: [9, 0.847, FU_CHIM], n: 8, sh: false, lift: -19 }, // (out of the dome's back; the art draws it 19 px higher)
    { lathe: [-28, 0.95, [[0, 0.8], [36, 0.8]]], lean: [0.216, 0], n: 4, sh: false },
    { box: [16, 30, 0.95 - 1 / 64, 0.95 + 1 / 64, 0, 12], sh: false },
  ],
  views: { n: { ...FU, parts: [FU_DOME, { lathe: [-9, 0.897, FU_CHIM], n: 8 }, { lathe: [28, 0.95, [[0, 0.8], [36, 0.8]]], n: 4 }, { box: [-30, -16, 0.95 - 1 / 64, 0.95 + 1 / 64, 0, 12] }] } },
  glow: { s: 'furnace_glow', parts: [0, 1], a: (o, t) => (o.working || o.fire === true || o.lit === true ? flick(o, t) : 0) },
  fx: [{ at: [0, 0.945, 9.6], draw(B, A, o, t, x, y, lift, a) {
    if (!(o.working || o.fire === true || o.lit === true)) return;
    const k = clamp01((facing(o) - 0.15) / 0.45) * a; // (the mouth only shows from the front)
    if (k <= 0) return;
    const T = fxt(A), f1 = flick(o, t);
    if (T.flames[0]) B.emissive.add(T.flames[(t * 4 | 0) % 3], sx(x, 0.01 * Math.sin(t * 7)), sy(y, 0.01 * Math.sin(t * 7)), 0.26, 0.26 * f1, 1, 1, 1, 0.8 * k, 0, 0, 0, 1, 0, lift);
    if (T.glow) B.emissive.add(T.glow, x, y, 1.1, 0.8, 1, 0.5, 0.2, 0.2 * f1 * k, 0, 0, 0, 1, 0, lift);
  } }],
  light: [0, 0.95, 0],
  blob: [0.85, 0.42, 0.13, 0.38],
});

// ---------- anvil (stations.js anvil, mk(1, 26)): stump, waist, face with the horn, the hammer lying on it ----------
const AV = 0.9;
defineSolid('anvil', {
  k: 4 / 11.5, piv: AV - 1, ramp: false,
  parts: [
    { lathe: [0, AV, [[0, 13], [18, 11]]], n: 10 },
    { box: [-7, 7, AV - 2 / 64, AV + 2 / 64, 21, 30], sh: false },
    { box: [-23, 12, AV - 1.5 / 64, AV + 1.5 / 64, 30, 36], sh: false },
    { box: [-3, 15, AV - 1.5 / 64, AV + 1.5 / 64, 35, 42], sh: false, z: 0.01 },
  ],
});

// ---------- workbench (stations.js workbench / _n / _e): the bench (legs and shelf from the art) + the tool board ----------
defineSolid('workbench', {
  model: 'front',
  parts: [{ box: [-58, 58, 0.2, 0.86, 0, 30], open: true }, { card: [-52, 52, 0.16, 30, 62], t: 4 }],
  views: {
    n: { parts: [{ box: [-58, 58, 0.14, 0.8, 0, 30], open: true }, { card: [-52, 52, 0.86, 14, 48], t: 4 }] },
    e: { V: 2, parts: [{ box: [-23, 23, 0.1, 1.86, 0, 30], open: true }, { box: [-27, -23, 0.15, 1.85, 30, 62] }] },
  },
});

// ---------- stonecutter (stations.js stonecutter / _e): slab table, the block being dressed, dressed blocks, stones ----------
defineSolid('stonecutter', {
  model: 'front',
  parts: [
    { box: [-58, 58, 0.18, 0.86, 0, 26], open: true },
    { box: [-36, -10, 0.43, 0.555, 26, 40], sh: false },
    { box: [28, 55, 0.52, 0.6, 26, 44], sh: false },
    { box: [-57, -31, 0.93, 1, 0, 7], sh: false },
  ],
  views: {
    e: { V: 2, parts: [
      { box: [-24, 24, 0.12, 1.86, 0, 26], open: true },
      { box: [-14, 12, 0.964, 1.089, 26, 40] },
      { box: [-22, 5, 0.43, 0.51, 26, 44] },
      { box: [14, 30, 1.9, 1.98, 0, 7] },
    ] },
  },
});

// ---------- loom (stations.js loom / _n / _e): the frame (a thick card), the weaver's bench, the cotton basket ----------
const BASKET = [[0, 7], [12, 9], [17, 6]];
defineSolid('loom', {
  model: 'front',
  parts: [
    { card: [-54, 54, 0.6, 0, 70], t: 6 },
    { box: [-22, 22, 0.95 - 8 / 64, 0.95, 0, 17], open: true },
    { lathe: [52, 0.9 - 9 / 64, BASKET], n: 8, sh: false },
  ],
  views: {
    n: { parts: [{ card: [-54, 54, 0.6, 0, 70], t: 6 }, { box: [-22, 22, 0.22 - 8 / 64, 0.22, 0, 17], open: true }, { lathe: [-52, 0.95 - 9 / 64, BASKET], n: 8 }] },
    e: { V: 2, parts: [{ box: [-24, 4, 0.25, 1.7, 0, 72] }, { box: [8, 24, 0.6, 1.5, 0, 19], open: true }, { lathe: [14, 0.3 - 8 / 64, [[0, 6], [11, 8], [16, 6]]], n: 8 }] },
  },
});

// ---------- fireplace (decor.js fireplace / _e / _back, mk(2, 60)): one stone fireplace on its whole footprint ----------
// the art draws its depth half as deep as the tile (k 0.5: the breast's back on the wall behind, the hearth's front on
// the tile's front edge). Hearth with a real firebox (two jambs, the lintel, the back wall: the fire burns inside), the
// mantel shelf, the chimney breast up the wall, the two mantel candles. The same shape whichever way it faces
// (model: 'front'); the back / side art only textures it.
const FP_CANDLE = [[30, 3.5], [35, 3.5], [35, 1.5], [44, 1.5]];
defineSolid('fireplace', {
  model: 'front', k: 0.5, piv: -0.4, ramp: false,
  parts: [
    { box: [-44, 44, 0.3, 0.55, 0, 60] },              // chimney breast
    { box: [-58, -26, 0.48, 0.8, 0, 30] },             // jambs
    { box: [26, 58, 0.48, 0.8, 0, 30] },
    { box: [-26, 26, 0.48, 0.8, 22, 30], sh: false },  // lintel over the opening
    { box: [-26, 26, 0.6, 0.7, 0, 22], sh: false },    // the firebox's back wall
    { box: [-60, 60, 0.8, 0.8 + 3 / 64, 28, 34], sh: false, z: 0.01 }, // mantel shelf
    { lathe: [-46.5, 0.6, FP_CANDLE], n: 6, sh: false },
    { lathe: [46.5, 0.6, FP_CANDLE], n: 6, sh: false },
  ],
  views: {
    n: { parts: [
      { box: [-44, 44, 0.3, 0.55, 0, 60] }, { box: [-58, -26, 0.48, 0.8, 0, 30] }, { box: [26, 58, 0.48, 0.8, 0, 30] },
      { box: [-26, 26, 0.48, 0.8, 22, 30] }, { box: [-26, 26, 0.48, 0.8, 0, 22] }, { box: [-58, 58, 0.48, 0.8, 24, 30] },
      { lathe: [46.5, 0.6, FP_CANDLE] }, { lathe: [-46.5, 0.6, FP_CANDLE] },
    ] },
    e: { V: 2, parts: [
      { box: [-22, 0, 0.15, 1.85, 0, 58] }, { box: [0, 22, 1.35, 1.85, 0, 30] }, { box: [0, 22, 0.15, 0.65, 0, 30] },
      { box: [0, 22, 0.65, 1.35, 22, 30] }, { box: [-6, 6, 0.65, 1.35, 0, 22] }, { box: [16, 24, 0.5, 1.5, 28, 34] },
      { lathe: [6, 1.6, FP_CANDLE] }, { lathe: [6, 0.4, FP_CANDLE] },
    ] },
  },
  fx: [{ at: [0, 0.74, 0], draw(B, A, o, t, x, y, lift, a) {
    if (!lit(o)) return;
    const k = clamp01((facing(o) - 0.1) / 0.4) * a; // (inside the firebox: seen from the front only)
    if (k <= 0) return;
    const seed = o.x * 1.7 + o.y;
    fireBed(B, fxt(A), x, y, lift + 0.02, t, seed, 3, 0.16, [0.6, 0.62, 0.44, 0.46], 0.22 + 0.05 * Math.sin(t * 9 + seed), k);
  } }],
  light: [0, 0.74, 0],
});

// ---------- candles (decor.js candles, mk(1, 18)): a plate and three candles ----------
defineSolid('candles', {
  foot: true, k: 4.5 / 12, piv: 0.55 - 1, ramp: false, ow: 2,
  parts: [
    { lathe: [0, 0.55, [[0, 12], [1, 12], [2, 10]]], n: 12 },
    { lathe: [-7.68, 0.55, [[2, 1.6], [10.8, 1.6]]], n: 6, sh: false },
    { lathe: [1.28, 0.55, [[2, 1.6], [14.64, 1.6]]], n: 6, sh: false },
    { lathe: [8.32, 0.55, [[2, 1.6], [9.52, 1.6]]], n: 6, sh: false },
  ],
  fx: [[-7.68, 10.8], [1.28, 14.64], [8.32, 9.52]].map(([x, h]) => ({ at: [x, 0.55, h - 1], draw: candle(0.55) })),
  light: [0, 0.55, 0],
});

// ---------- candelabra (decor.js candelabra, mk(1, 62)): tripod foot, stem, the arms and five candles in their cups ----------
const CB = [[-14, 48], [-7, 52], [0, 56], [7, 52], [14, 48]];
defineSolid('candelabra', {
  foot: true, ramp: false, ow: 2.2,
  parts: [
    { lathe: [0, 0.55, [[0, 9], [6, 1.5]]], n: 6, sh: false },
    { lathe: [0, 0.55, [[4, 1.5], [50, 1.5]]], n: 6 },
    { card: [-17, 17, 0.55, 33, 47], t: 2, sh: false },
    ...CB.map(([x, h]) => ({ lathe: [x, 0.55, [[h - 10, 3], [h - 8, 3], [h - 8, 1.5], [h, 1.5]]], n: 6, sh: false, z: 0.01 })),
  ],
  fx: CB.map(([x, h]) => ({ at: [x, 0.55, h - 1], draw: candle(0.55) })),
  light: [0, 0.55, 0],
});

// ---------- stone lantern (decor.js lampStone, mk(1, 52)): base, shaft, collar, the lit head (a window each side), roof ----
// a square pillar drawn from the front only: k from the base's top (22 px deep drawn 6.4 px)
const LS = 0.55, LK = 0.29, ls = (w) => (w * LK) / 64; // (half depth of a square part w px wide, in art rows)
defineSolid('lamp_stone', {
  foot: true, k: LK, piv: LS - 1, ramp: false,
  parts: [
    { box: [-11, 11, 0.5, 0.6, 0, 6], sh: false },
    { box: [-5, 5, LS - ls(5), LS + ls(5), 6, 30], sh: false },
    { box: [-10, 10, LS - ls(10), LS + ls(10), 29, 33], sh: false },
    { box: [-8.5, 8.5, LS - ls(8.5), LS + ls(8.5), 33, 49], sh: false },
    { lathe: [0, LS, [[49, 13], [54.5, 3], [56, 2.2], [58, 0]]], n: 8 },
  ],
  glow: { s: 'lamp_stone_glow', all: true, parts: [2, 3], a: () => 0.55 + 0.4 * KIT_ENV.night },
  fx: [{ at: [0, LS, 36], draw: candle(0.6) }],
  light: [0, LS, 0],
});

// ---------- wooden lantern post (decor.js lampWood, mk(1, 86)): footing, post, arm with its brace, hanging lantern ----------
const LW = 0.6, LWK = 0.15;
defineSolid('lamp_wood', {
  foot: true, k: LWK, piv: LW - 1, ramp: false,
  parts: [
    { box: [-14, -2, LW - (6 * LWK) / 64, LW + (6 * LWK) / 64, 0, 6], sh: false },
    { lathe: [-8, LW, [[5, 3], [85, 3], [85, 4], [88, 4]]], n: 8 },
    { box: [-11, 11, LW - (2 * LWK) / 64, LW + (2 * LWK) / 64, 77, 81], sh: false },
    { card: [-8, 14, LW, 66, 82], t: 0.3, sh: false },
    { lathe: [7, LW, [[57.6, 5.5], [60, 5.5], [60, 5], [71, 5], [71, 6], [76, 0]]], n: 8, sh: false },
  ],
  glow: { s: 'lamp_wood_glow', all: true, parts: [4], a: () => 0.55 + 0.4 * KIT_ENV.night },
  light: [7, LW, 0],
});

// ---------- lamp post (stations.js lampPost, mk(1, 72)): stone footing, tall post, iron arm, hanging lantern ----------
const LP = 0.85, LPK = 0.1;
defineSolid('lamp_post', {
  k: LPK, piv: LP - 1, ramp: false,
  parts: [
    { box: [-13, 1, LP - (7 * LPK) / 64, LP + (7 * LPK) / 64, 0, 8], sh: false },
    { lathe: [-6, LP, [[7, 2.75], [115, 2.75], [115, 4], [118, 4]]], n: 8 },
    { card: [-6, 14, LP, 96, 116], t: 0.2, sh: false },
    { lathe: [10.24, LP, [[78.4, 6.5], [81.4, 6.5], [81.4, 5.5], [93.4, 5.5], [93.4, 7], [98.4, 0]]], n: 8, sh: false },
  ],
  glow: { s: 'lamp_post_glow', all: true, parts: [3], a: (o, t) => { if (!lit(o)) return 0; const s = o.x * 1.37 + o.y * 0.71; return 0.9 + 0.1 * Math.sin(t * 13 + s) * Math.sin(t * 5.1 + s); } },
  fx: [{ at: [10.24, LP, 86.4], draw(B, A, o, t, x, y, lift, a) {
    if (!lit(o)) return;
    const T = fxt(A), s = o.x * 1.37 + o.y * 0.71, k = 0.9 + 0.1 * Math.sin(t * 13 + s) * Math.sin(t * 5.1 + s);
    if (T.glow) B.emissive.add(T.glow, x, y, 0.9, 0.9, 1, 0.75, 0.42, 0.28 * k * a, 0, 0, 0, 1, 0, lift);
  } }],
  light: [10.24, LP, 0],
  blob: [0.85, 0.42, 0.15, 0.38],
});

// ---------- torch (buildings.js torch / torch_wall_s / torch_wall_e) ----------
// on the floor: a thin pole, the flame on top. On a wall (edge piece leaning on a wall: o._mount): the iron plate on the
// wall face, the arm, the torch leaning out of it — the same model on every wall (model: 'front'), drawn right after
// the face of the wall it hangs on while that face shows (depth)
const wallTorch = (o) => !!o._mount && (o.rot | 0) >= 1 && (o.rot | 0) <= 4;
// the wall art drawn lifted 24 px here (the bracket at mid wall, the head just under the wall top): row r of torch_wall_s
// at ground row v and height h ⇔ h = 72 + 64 (v − 1) − r; the wall face is 0.18 behind the anchor (v 0.82). k: the art
// draws the torch flat on the wall — it really leans 15 px out of it
const TW_PR = [[28, 2.8], [33.2, 2.7], [33.2, 3.6], [36.6, 3.6], [36.6, 2.6], [48.5, 2.5], [48.5, 3.8], [58.2, 4.6]];
const TW_PE = [[32.2, 2.8], [35.7, 2.75], [35.7, 3.6], [38.7, 3.6], [38.7, 2.6], [53.6, 2.4], [53.6, 3.8], [61.9, 4.6]];
defineSolid('torch', {
  k: 0.44, piv: -1 / 64, ramp: false,
  parts: [{ lathe: [0, 1 - 1 / 64, [[0, 3.6], [3, 3.2], [44, 2.8], [45, 4.6], [56, 5]]], n: 8 }],
  fx: [{ at: [0, 1, TORCH_FLAME_LIFT * 64], draw: (B, A, o, t, x, y, lift, a) => { if (lit(o) && a > 0.05) torchFlame(B, A, x, y, lift, 1, t, 1); } }],
  light: [0, 1, 0],
  blob: [0.35, 0.25],
  state: (o) => (wallTorch(o) ? 'wall' : ''),
  variants: {
    wall: {
      s: 'torch_wall_s', e: 'torch_wall_e', model: 'front', k: 0.25, piv: -0.18, lift: 24, ow: 2.4, blob: false,
      parts: [
        { box: [-6, 6, 0.82, 0.82 + 0.75 / 64, 15.5, 30.5], sh: false },        // plate on the wall
        { box: [-1.2, 1.2, 0.82, 0.82 + 1.5 / 64, 24, 33], sh: false },         // arm
        { lathe: [0, 0.82 + 1.5 / 64, TW_PR], lean: [0, 0.0746], n: 6, sh: false }, // the torch, leaning out
      ],
      // torch_wall_e (the plate on the west wall, the torch leaning east) textures the sides
      views: { e: { parts: [
        { box: [-13, -8, 0.92 - 6 / 64, 0.92 + 6 / 64, 28.9, 48.9] },
        { box: [-9, -1, 0.903, 0.937, 32, 38] },
        { lathe: [-1.5, 0.92, TW_PE], lean: [0.4, 0] },
      ] } },
      fx: [{ at: [0, 0.8786, 56.5], draw: (B, A, o, t, x, y, lift, a) => { if (lit(o) && a > 0.05) torchFlame(B, A, x, y, lift, 1, t, 0.9); } }],
      light: [0, 0.8786, 0],
    },
  },
  depth: (o, rc, rs, d) => {
    if (!wallTorch(o)) return d;
    const r = o.rot | 0, nx = r === 2 ? -1 : r === 4 ? 1 : 0, ny = r === 1 ? 1 : r === 3 ? -1 : 0;
    return -rs * nx + rc * ny > 0.02 ? Math.max(d, mountDepth(o, rc, rs)) : d; // (its wall face turned away: the wall hides it)
  },
});
