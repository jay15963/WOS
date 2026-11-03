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
import { ANVIL_Z } from '../stations.js';
import { capArt } from '../caps.js';

// top art (art/caps.js) of the parts drawn only from the front: stone footings, post tops, lantern caps
const CAP_FOOT = capArt('slab', '#8f897e', false), CAP_POST = capArt('wood', '#b98a58'), CAP_IRON = capArt('iron', '#3a3a42');

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
// The art's ring is wider than a tile: the model's ring (radius 22) fits the tile, centred on it; each stone takes the
// colour of its stone in the art (px)
const CF_V = 1 - 3 / 64, CFK = 13 / 27; // the ring's centre (row 37)
const CF_STONES = [];
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + 0.15, c = Math.cos(a), s = Math.sin(a);
  CF_STONES.push({ lathe: [22 * c, CF_V + (22 * CFK * s) / 64, [[0, 6], [2.5, 5.2], [4.5, 2.6]]], n: 6, sh: false, px: [27 * c - 1.5, CF_V + (13 * s) / 64, 1.5] });
}
defineSolid('campfire', {
  k: CFK, piv: CF_V - 1, align: CF_V,
  parts: [{ lathe: [0, CF_V, [[0, 19], [2, 16.5], [6, 8], [8, 0]]], n: 10, sh: false }, ...CF_STONES],
  glow: { s: 'campfire_coals', parts: [0], a: (o, t) => { if (!lit(o)) return 0; const s = o.x * 1.7 + o.y; return 0.75 + 0.2 * Math.sin(t * 3.1 + s) * Math.sin(t * 7.7 + s); } },
  fx: [{ at: [0, CF_V, 3.4], draw(B, A, o, t, x, y, lift, a) {
    if (!lit(o)) return;
    const T = fxt(A), seed = o.x * 1.7 + o.y;
    fireBed(B, T, x, y, lift, t, seed, 3, 0.13, [0.92, 1.35, 0.68, 0.95], 0.22 + 0.05 * Math.sin(t * 9 + seed), a);
    const pop = Math.sin(t * 5.3 + seed) * 0.5 + 0.5, dx = Math.sin(t * 2.1 + seed) * 0.08;
    if (T.flames[0]) B.emissive.add(T.flames[(t * 3 | 0) % 3], sx(x, dx), sy(y, dx), 0.35, 0.6 * pop, 1, 1, 1, 0.7 * pop * a, 0, 0, 0, 1, 0, lift + 0.2);
  } }],
  light: [0, CF_V, 0],
  blob: [0.95, 0.95, 0.5, 0.35],
});

// ---------- brazier (stations.js brazier, mk(1, 40)): iron bowl on three splayed legs ----------
// the rim is drawn 15 × 4.2 (k); the legs' feet sit on the ring that k gives (the art draws them further apart in depth)
const BZ_LEG = [-13.6, 0.75, 8.3]; // (the legs' iron)
defineSolid('brazier', {
  k: 0.28, piv: 0.62 - 1, align: 0.62,
  parts: [
    { lathe: [0, 0.62, [[36, 0], [40, 9], [45, 13], [50, 15]]], n: 12 },
    { lathe: [-16, 0.6603, [[0, 1.6], [40, 1.3]]], lean: [0.205, -0.033], n: 5, ow: 0.8, sh: false, px: BZ_LEG },
    { lathe: [16, 0.6603, [[0, 1.6], [40, 1.3]]], lean: [-0.205, -0.033], n: 5, ow: 0.8, sh: false, px: BZ_LEG },
    { lathe: [0, 0.539, [[0, 1.6], [40, 1.3]]], lean: [0, 0.0986], n: 5, ow: 0.8, sh: false, px: BZ_LEG },
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
  blob: [0.75, 0.75, 0.5, 0.38],
});

// ---------- cooking pot (stations.js cookingPot, mk(1, 40)): fire ring, tripod, chain and cauldron ----------
// (seen from behind: cooking_pot_back, the ladle on the other side, no front stones painted on the ash bed)
// The ring and the cauldron keep the art's look (projective, k); thin or hidden things take their own colour (px): the
// tripod's three legs stand on a circle outside the stones (30 px) and meet right over the cauldron (the art draws the
// apex behind it), the chain hangs straight down, the stones are each one stone colour, the stew fills the rim.
const CP_STONES = [], CPK = 0.4, cpv = (dy) => 0.62 + (dy / 64) * CPK; // (a true depth offset, px → art row)
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  CP_STONES.push({ lathe: [21 * Math.cos(a), 0.62 + (8.5 * Math.sin(a)) / 64, [[0, 6.5], [2.5, 5.5], [4.5, 2.5]]], n: 6, sh: false, px: [0, 0.753, 2] });
}
const CP_LEG = (fx, fy) => ({ lathe: [fx, cpv(fy), [[0, 2.2], [62, 1.7]]], lean: [-fx / 62, ((0.62 - cpv(fy)) * 64) / 62], n: 5, ow: 0.8, px: [-7.2, 0.85, 55.4] });
defineSolid('cooking_pot', {
  k: CPK, piv: 0.62 - 1, align: 0.62,
  parts: [
    { lathe: [0, 0.62, [[0, 20], [2, 18], [5, 10], [7, 0]]], n: 10, sh: false },
    { lathe: [0, 0.62, [[16, 5], [19, 12], [24, 15.5], [29, 16], [32, 15.5], [32.6, 13]]], n: 12, px: { t: [-4, 0.62, 31.6] } },
    CP_LEG(-26, 15), CP_LEG(26, 15), CP_LEG(0, -30),
    { lathe: [0, 0.62, [[58, 3], [62.5, 2.6]]], n: 6, ow: 0, sh: false, px: [0, 0.55, 58.5] }, // (the lashing)
    { lathe: [0, 0.62, [[33, 0.7], [59, 0.7]]], n: 4, ow: 0.5, sh: false, px: [0, 0.62, 45] },  // (the chain)
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
  blob: [0.95, 0.95, 0.5, 0.38],
});

// ---------- furnace (stations.js furnace, mk(1, 60)): stone dome with its mouth, chimney behind ----------
// the art draws the dome flat (a front elevation): k stretches its upper rows over the dome's top. The model stands
// in the middle of the tile (align: the dome's axis); the chimney rises out of the dome's back, the poker leans on it,
// the bellows lie at its foot (their own colours). The sides and the back show furnace_back (stations.js, painted only
// for the turned camera): no second mouth on the sides.
const FU = { k: 0.2, piv: 0.872 - 1 };
const FU_DOME = { lathe: [0, 0.872, [[0, 25], [26, 25], [33, 20], [37, 12], [39, 0]]], n: 14, cap: capArt('stone', '#a08e78') }; // (its top: fieldstones seen from above)
const FU_CHIM = [[0, 6], [64, 6], [64, 7], [66, 7], [66.5, 5.5]];
const FU_BACK = { ...FU, parts: [FU_DOME, { lathe: [-9, 0.897, FU_CHIM], n: 8 }, { lathe: [28, 0.95, [[0, 0.8], [36, 0.8]]], n: 4 }, { box: [-30, -16, 0.95 - 1 / 64, 0.95 + 1 / 64, 0, 12] }] };
const FU_BEL = [23, 0.95, 5];
defineSolid('furnace', {
  ...FU, e: 'furnace_back', align: 0.872,
  parts: [
    FU_DOME,
    { lathe: [9, 0.847, FU_CHIM], n: 8, sh: false, lift: -19, px: { t: [9, 0.55, 64] } }, // (out of the dome's back; the art draws it 19 px higher; its sooty mouth)
    { lathe: [-28, 0.95, [[0, 1.2], [36, 1]]], lean: [0.216, 0], n: 5, ow: 0.6, sh: false, px: [-25.6, 0.95, 11.5] },
    { box: [16, 30, 0.95 - 1 / 64, 0.95 + 1 / 64, 0, 9], sh: false, px: { n: FU_BEL, e: FU_BEL, w: FU_BEL, t: FU_BEL } },
  ],
  views: { n: FU_BACK, e: FU_BACK },
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
  blob: [0.95, 0.95, 0.5, 0.4],
});

// ---------- anvil (stations.js anvil_big: the anvil art ANVIL_Z× bigger about its foot, mk(1, 26)): stump, foot, waist,
// face with the heel and the horn, the hammer ----------
// The art draws the iron seen from the front only (its top a 1 px highlight) and 3 px above the stump's top: the model
// stands on the stump (geo: 3 px lower), each block with its true depth (ad: true px → art rows), the front from the
// art, tops and ends in the iron's own colours (px). The horn tapers in three steps to its tip; the hammer lies on the face.
// Numbers are the 1× painter's (z: scaled about the foot, as anvil_big is painted): a proper anvil for its tile.
const AV = 0.9, AK = 4 / 11.5, AZ = ANVIL_Z, ad = (px) => (px / 2) * AK / 64 * AZ;
const zp = ([x, v, h]) => [x * AZ, v, h * AZ];
const AVB = (x0, x1, d, h0, h1, o) => ({ box: [x0 * AZ, x1 * AZ, AV - ad(d), AV + ad(d), h0 * AZ, h1 * AZ], geo: [x0 * AZ, x1 * AZ, AV - ad(d), AV + ad(d), (h0 - 3) * AZ, (h1 - 3) * AZ], sh: false, ...o });
const A_HI = zp([-15, AV, 34]), A_MID = zp([2, AV, 31]), A_DK = zp([0, AV, 25]), A_SIDE = { n: A_MID, e: A_MID, w: A_MID, t: A_HI };
defineSolid('anvil', {
  s: 'anvil_big', k: AK, piv: AV - 1, align: AV,
  parts: [
    { lathe: [0, AV, [[0, 13 * AZ], [18 * AZ, 11 * AZ]]], n: 12, cap: capArt('wood', '#c49a64') },
    AVB(-9, 9, 14, 21, 24, { px: { n: A_MID, e: A_MID, w: A_MID, t: A_MID } }),        // foot
    AVB(-6, 6, 8, 23.5, 30.5, { px: { n: A_DK, e: A_DK, w: A_DK, t: A_DK } }),          // waist
    AVB(-9, 12, 12, 30, 36, { px: A_SIDE, sh: true }),                                   // face and heel
    AVB(-14, -9, 9, 30.5, 36, { px: A_SIDE }),                                           // the horn, three steps
    AVB(-19, -14, 6, 31.5, 35.8, { px: A_SIDE }),
    AVB(-23.5, -19, 3, 33, 35.4, { px: A_SIDE }),
    { box: [3 * AZ, 15 * AZ, AV - ad(2.5), AV + ad(2.5), 33 * AZ, 35.4 * AZ], px: zp([6, AV, 38.6]), sh: false, z: 0.01 },  // hammer: handle
    { box: [-2.5 * AZ, 3 * AZ, AV - ad(6), AV + ad(6), 33 * AZ, 37.5 * AZ], px: zp([0, AV, 39]), sh: false, z: 0.01 },     // and head
  ],
  blob: [0.62 * AZ, 0.5 * AZ, 0.5, 0.42],
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
// the dressed blocks are three blocks (two side by side, one on them) as the art draws them; the rough stones on the
// ground are round stones inside the footprint
const SC_ST = [[0, 6.5], [3, 5.6], [6, 2.5]];
defineSolid('stonecutter', {
  model: 'front',
  parts: [
    { box: [-58, 58, 0.18, 0.86, 0, 26], open: true },
    { box: [-36, -10, 0.43, 0.555, 26, 40], sh: false },
    { box: [28, 41, 0.522, 0.6, 26, 35], sh: false }, { box: [42, 55, 0.522, 0.6, 26, 35], sh: false },
    { box: [35, 48, 0.508, 0.586, 35, 44], sh: false, z: 0.01 },
    { lathe: [-48, 0.9, SC_ST], n: 7, sh: false, px: [-48, 1, 2.5] }, { lathe: [-37, 0.93, [[0, 5], [2.5, 4.2], [4.5, 1.8]]], n: 6, sh: false, px: [-38, 1, 1.5] },
  ],
  views: {
    e: { V: 2, parts: [
      { box: [-24, 24, 0.12, 1.86, 0, 26], open: true },
      { box: [-14, 12, 0.964, 1.089, 26, 40] },
      { box: [-22, -9, 0.43, 0.51, 26, 35] }, { box: [-8, 5, 0.43, 0.51, 26, 35] }, { box: [-15, -2, 0.417, 0.495, 35, 44] },
      { lathe: [22, 1.92, SC_ST] }, { lathe: [22, 1.92, SC_ST] },
    ] },
  },
});

// ---------- loom (stations.js loom / _n / _e): the frame, the weaver's bench, the cotton basket ----------
// The frame is solid wood, not a board: two square uprights on long feet (they keep it standing, seen from the side),
// the top beam, the cloth beam and the warp with the cloth between them. Front from loom, back from loom_n; the
// wood's ends and tops in their own colours (loom_e draws the frame skewed: only the bench and basket take it).
const BASKET = [[0, 7], [12, 9], [17, 6]];
const LM = 0.6, lmd = (px) => px / 64; // (the frame's plane; true px → rows)
const LM_W = [-50, LM, 35], LM_D = [-50, LM, 2], LM_T = [0, LM, 69], LM_C = [0, LM, 18];
const LOOM = (bench, basket) => [
  bench, basket,
  { box: [-53, -47, LM - lmd(3), LM + lmd(3), 0, 70], px: { e: LM_W, w: LM_W, t: LM_T } },
  { box: [47, 53, LM - lmd(3), LM + lmd(3), 0, 70], px: { e: LM_W, w: LM_W, t: LM_T } },
  { box: [-56, -44, LM - lmd(15), LM + lmd(15), 0, 4.5], sh: false, px: { n: LM_D, e: LM_D, w: LM_D, t: LM_D } },
  { box: [44, 56, LM - lmd(15), LM + lmd(15), 0, 4.5], sh: false, px: { n: LM_D, e: LM_D, w: LM_D, t: LM_D } },
  { box: [-54, 54, LM - lmd(3.5), LM + lmd(3.5), 64, 70], sh: false, px: { e: LM_T, w: LM_T, t: LM_T } },
  { box: [-52, 52, LM - lmd(3.5), LM + lmd(3.5), 15, 22], sh: false, px: { e: LM_C, w: LM_C, t: LM_C } },
  { card: [-47, 47, LM, 22, 64], t: 1.5, sh: false, z: -0.005 },
];
defineSolid('loom', {
  model: 'front',
  parts: LOOM({ box: [-22, 22, 0.95 - 8 / 64, 0.95, 0, 17], open: true }, { lathe: [52, 0.9 - 9 / 64, BASKET], n: 8, sh: false }),
  views: {
    n: { parts: LOOM({ box: [-22, 22, 0.22 - 8 / 64, 0.22, 0, 17], open: true }, { lathe: [-52, 0.95 - 9 / 64, BASKET], n: 8 }) },
    e: { V: 2, parts: [{ box: [8, 24, 0.6, 1.5, 0, 19], open: true }, { lathe: [14, 0.3 - 8 / 64, [[0, 6], [11, 8], [16, 6]]], n: 8 }] },
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
    { box: [-11, 11, 0.5, 0.6, 0, 6], sh: false, cap: capArt('slab', '#9a9386', false) },
    { box: [-5, 5, LS - ls(5), LS + ls(5), 6, 30], sh: false },
    { box: [-10, 10, LS - ls(10), LS + ls(10), 29, 33], sh: false, cap: capArt('slab', '#a9a194', false) },
    { box: [-8.5, 8.5, LS - ls(8.5), LS + ls(8.5), 33, 49], sh: false },
    { lathe: [0, LS, [[49, 13], [54.5, 3], [56, 2.2], [58, 0]]], n: 8, cap: capArt('slab', '#b3ab9d') }, // (the roof seen from above)
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
    { box: [-14, -2, LW - (6 * LWK) / 64, LW + (6 * LWK) / 64, 0, 6], sh: false, cap: CAP_FOOT },
    { lathe: [-8, LW, [[5, 3], [85, 3], [85, 4], [88, 4]]], n: 8, cap: CAP_POST },
    { box: [-11, 11, LW - (2 * LWK) / 64, LW + (2 * LWK) / 64, 77, 81], sh: false, cap: capArt('plank', '#7d5532', false) },
    { card: [-8, 14, LW, 66, 82], t: 0.3, sh: false },
    { lathe: [7, LW, [[57.6, 5.5], [60, 5.5], [60, 5], [71, 5], [71, 6], [76, 0]]], n: 8, sh: false, cap: CAP_IRON },
  ],
  glow: { s: 'lamp_wood_glow', all: true, parts: [4], a: () => 0.55 + 0.4 * KIT_ENV.night },
  light: [7, LW, 0],
});

// ---------- lamp post (stations.js lampPost, mk(1, 72)): stone footing, tall post, iron arm, hanging lantern ----------
const LP = 0.85, LPK = 0.1;
defineSolid('lamp_post', {
  k: LPK, piv: LP - 1, ramp: false,
  parts: [
    { box: [-13, 1, LP - (7 * LPK) / 64, LP + (7 * LPK) / 64, 0, 8], sh: false, cap: CAP_FOOT },
    { lathe: [-6, LP, [[7, 2.75], [115, 2.75], [115, 4], [118, 4]]], n: 8, cap: CAP_POST },
    { card: [-6, 14, LP, 96, 116], t: 0.2, sh: false },
    { lathe: [10.24, LP, [[78.4, 6.5], [81.4, 6.5], [81.4, 5.5], [93.4, 5.5], [93.4, 7], [98.4, 0]]], n: 8, sh: false, cap: CAP_IRON },
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
