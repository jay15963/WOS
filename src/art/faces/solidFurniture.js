// Camera rotation — solid pieces: interior furniture and decoration (art/faces/solid.js: format, units and rules at the
// top of that file). Numbers are read off each painter (art/decor.js, art/stations.js): x px from the art's centre
// column, v = ground row in tiles (the anchor row is V), h px above the ground. A view whose art draws the piece
// differently lists the same parts again in its own numbers.
import { defineSolid } from './solid.js';
import { shade, shadowRect } from './kit.js';
import { CAMV, ARCH_FACES as K } from '../archCompose.js';
import { DECOR_GEOM } from '../decor.js';

// ---- helpers ----
// a sprite by name (baked or lazy), ready to draw, or null (asked for)
function sprite(A, n) {
  const s = A.has(n) ? A.get(n) : K.tables(A).opt(n);
  return s && K.ok(s) ? s : null;
}
// the plant of a pot as an upright sprite standing on the pot's axis (the pot is the solid; the painting with the pot's
// inside cut out, `<sprite>_leaf`): anchored on the axis point, lifted by (v of the axis − 1) so it sits on the pot as
// the art draws it, whatever the yaw (a round pot looks the same from every side)
const potPlant = (type, va) => {
  const NM = [0, 1, 2].map((i) => `${type}_${i}_leaf`); // (no string built per frame)
  return { at: [0, va, 0], always: true, draw(B, A, o, t, x, y, lift, a, fs) {
    const s = sprite(A, NM[(((o.v | 0) % 3) + 3) % 3]);
    if (s) B.main.add(s, x, y, 1, 1, fs.tr, fs.tg, fs.tb, a, 0, 0, fs.fl, 1, 0, lift + va - 1);
  } };
};

// ---- chairs and stools (a sitter sits on `seat`; the backrest hides the sitter's back from behind: cover) ----
// chair_fine (decor.js chairFine 's' / 'n' / 'e', mk(1, 40)): seat box (legs from the art) + upholstered backrest
defineSolid('chair_fine', {
  parts: [{ box: [-14, 14, 0.36, 0.8, 0, 17], open: true }, { card: [-13, 13, 0.36, 17, 48], cover: true }],
  seat: [0, 0.6, 17],
  views: {
    n: { parts: [{ box: [-14, 14, 0.38, 0.8, 0, 17], open: true }, { card: [-13, 13, 0.82, 17, 48] }], seat: [0, 0.6, 17] },
    e: { parts: [{ box: [-13, 13, 0.3, 0.8, 0, 17], open: true }, { box: [-13, -7, 0.3, 0.8, 17, 46] }], seat: [2, 0.55, 17] },
  },
});
// stool (decor.js stool, mk(1, 22)): a round seat (ellipse 11 × 5: squashed, kept at every angle like any round thing)
// on three legs (an open box: the legs come from the art)
defineSolid('stool', {
  foot: true, k: 5 / 11, k1: 5 / 11, piv: 0.56 - 1,
  parts: [{ box: [-10, 10, 0.48, 0.66, 0, 13], open: true, sh: false }, { lathe: [0, 0.56, [[13, 11], [15, 11]]], n: 12 }],
  seat: [0, 0.56, 15],
  decal: [0, 0.62, 12, 4],
});

// ---- tables ----
// table_round (decor.js tableRound, mk(1, 36)): pedestal + clothed round top (ellipse 25 × 12) + a candle; round: the
// art's squash at every angle
defineSolid('table_round', {
  k: 12 / 25, k1: 12 / 25, piv: 0.5 - 1,
  parts: [
    { lathe: [0, 0.5, [[0, 10], [2, 4], [2, 3], [24, 3]]], n: 10, sh: false },
    { lathe: [0, 0.5, [[14, 25], [26, 25]]], n: 12, z: 0.01 },
    { lathe: [0, 0.5, [[26, 2], [36, 2]]], n: 6, sh: false, z: 0.02 },
  ],
  pt: 1,
  decal: [0, 0.62, 20, 6],
});
// table_small (decor.js tableSmall, mk(1, 34)): an open box (legs and top slab from the art) + the vase with its flower
// (small things drawn flat on a plane are boxes with their front on that plane: a lathe would bend the flat art)
defineSolid('table_small', {
  foot: true,
  parts: [{ box: [-15, 15, 0.36, 0.78, 0, 22], open: true }, { box: [-7, 7, 0.5, 0.56, 22, 46], sh: false }],
});

// ---- shelves and cabinets (against a wall: align 'back') ----
// shelf_wood (decor.js shelfWood 's' / 'side' / 'back', mk(1, 66)): back panel, three shelves, two front posts, the
// things on each shelf (cards where the art stands them, v 0.75)
const SHELF_H = [7, 29, 53];
defineSolid('shelf_wood', {
  foot: true, align: 'back',
  parts: [
    { card: [-19, 19, 0.56, 0, 77] },
    ...SHELF_H.map((h) => ({ box: [-19, 19, 0.56, 0.9, h - 3, h], sh: false })),
    { box: [-19.5, -15, 0.86, 0.92, 0, 74], sh: false }, { box: [15, 19.5, 0.86, 0.92, 0, 74], sh: false },
    ...[[7, 26], [29, 50], [53, 74]].map(([a, b]) => ({ card: [-17, 17, 0.75, a, b], sh: false, z: -0.01 })),
  ],
  views: {
    // seen from its side: the art's x runs along the shelf's depth (back panel left, posts right), v across its width
    e: { parts: [
      { box: [-13, -10, 0.2, 0.86, 0, 77] },
      ...SHELF_H.map((h) => ({ box: [-11, 11, 0.2, 0.86, h - 3, h] })),
      { box: [9, 13, 0.8, 0.86, 0, 74] }, { box: [9, 13, 0.8, 0.86, 0, 74] }, // (both posts: the near one the art shows)
      ...[[7, 26], [29, 50], [53, 74]].map(([a, b]) => ({ box: [-8, 8, 0.2, 0.86, a, b] })),
    ] },
    // from behind: the back panel nearest
    n: { parts: [
      { card: [-19, 19, 0.9, 0, 77] },
      ...SHELF_H.map((h) => ({ box: [-19, 19, 0.56, 0.9, h - 3, h] })),
      { box: [-19.5, -15, 0.56, 0.62, 0, 74] }, { box: [15, 19.5, 0.56, 0.62, 0, 74] },
      ...[[7, 26], [29, 50], [53, 74]].map(([a, b]) => ({ card: [-17, 17, 0.75, a, b] })),
    ] },
  },
});
// bookshelf (decor.js bookshelf / bookshelf_e / bookshelf_back, mk(2, 66)): back panel, side panels, middle post, top
// board, three shelves, the books on each (cards at v 0.78), a candle on top
const BOOK_H = [3, 23, 44];
const bookParts = (v0, v1, cardV, back) => [
  { card: [-56, 56, back ? v1 : v0, 0, 66] },
  { box: [-58, -55, v0, v1, 0, 66], sh: false }, { box: [55, 58, v0, v1, 0, 66], sh: false },
  { box: [-2, 2, v1 - 0.06, v1, 0, 66], sh: false },
  { box: [-58, 58, v0, v1, 66, 68] },
  ...BOOK_H.map((h) => ({ box: [-56, 56, v0, v1, h, h + 3], sh: false })),
  ...BOOK_H.map((h) => ({ card: [-54, 54, cardV, h + 3, h + 21], sh: false, z: -0.01 })),
  { box: [34, 41, 0.68, 0.72, 66, 80], sh: false },
];
defineSolid('bookshelf', {
  align: 'back',
  parts: bookParts(0.55, 0.9, 0.78, false),
  views: {
    // turned (front east): one box 0.12..1.88 × 28 px, 64 tall — its end shows on the sides
    e: { V: 2, parts: [
      { box: [-14, -11, 0.12, 1.88, 0, 64] }, { box: [-14, 14, 1.8, 1.88, 0, 64] }, { box: [-14, 14, 0.12, 0.2, 0, 64] },
      { box: [10, 14, 0.9, 1.1, 0, 64] }, { box: [-14, 14, 0.12, 1.88, 60, 64] },
      ...BOOK_H.map((h) => ({ box: [-14, 14, 0.12, 1.88, h, h + 3] })),
      ...BOOK_H.map((h) => ({ box: [-6, 6, 0.12, 1.88, h + 3, h + 21] })),
      { box: [-3, 3, 1.4, 1.6, 64, 76] },
    ] },
    n: { parts: bookParts(0.55, 0.9, 0.78, true) },
  },
});
// dresser (decor.js dresser / dresser_e / dresser_back, mk(2, 44)): the drawer box, the mirror standing on it, a candle;
// the basin is painted on the top. The mirror is a real frame — two stiles and two rails 7 px deep around the glass,
// their sides, tops and backs in the frame's wood (px), the front from the art; the glass's back is wood: seen edge-on
// it is a frame, not a sheet of paper
const DR_W = [7.2, 0.56, 45], DR_PX = { n: DR_W, e: DR_W, w: DR_W, t: DR_W }, DRD = 3.5 / 64, DRO = 2.6; // (DRO: the art's outline)
const drFrame = (x0, x1, h0, h1) => ({ box: [x0, x1, 0.56 - DRD, 0.56 + DRD, h0, h1], ow: 0, sh: false, px: DR_PX });
defineSolid('dresser', {
  align: 'back',
  parts: [
    { box: [-52, 52, 0.5, 0.88, 0, 30] },
    { card: [8.5, 21.5, 0.56, 32.5, 57.5], t: 2, ow: 0, sh: false, px: DR_PX },
    { box: [37, 46, 0.66, 0.7, 30, 41], sh: false },
    drFrame(6 - DRO, 8.5, 30, 60 + DRO), drFrame(21.5, 24 + DRO, 30, 60 + DRO), // (stiles)
    drFrame(8.5, 21.5, 57.5, 60 + DRO), drFrame(8.5, 21.5, 30, 32.5),           // (rails)
  ],
  views: {
    e: { V: 2, parts: [{ box: [-18, 18, 0.15, 1.85, 0, 30] }, { card: [-2, 2, 1.0, 30, 60] }, { box: [-3, 3, 1.3, 1.5, 30, 41] }] },
    n: { parts: [{ box: [-52, 52, 0.5, 0.88, 0, 30] }, { card: [6, 24, 0.56, 30, 60] }, { box: [37, 46, 0.66, 0.7, 30, 41] }] },
  },
});
// wardrobe (decor.js wardrobe 's' / 'side' / 'back', mk(1, 70)): one tall box
defineSolid('wardrobe', {
  foot: true, align: 'back',
  parts: [{ box: [-21, 21, 0.5, 0.92, 0, 68] }],
  views: { e: { parts: [{ box: [-13, 14, 0.24, 0.92, 0, 68] }] }, n: { parts: [{ box: [-21, 21, 0.5, 0.92, 0, 68] }] } },
});

// ---- racks and stands ----
// weapon_rack (decor.js weaponRack, mk(2, 64) / mkv(1, 2, 64)): the frame (legs, two bars) as a board, the spears
// leaning on it (a sloped face, bottoms forward), the sword and the shield hung in front
defineSolid('weapon_rack', {
  align: 'back',
  parts: [
    { card: [-52, 52, 0.55, 0, 42], t: 4 },
    { quad: [[-41, 0.55, 64], [-1, 0.55, 64], [-1, 0.7, 0], [-41, 0.7, 0]], sh: false },
    { card: [16, 28, 0.6, 18, 52], sh: false, solo: true },
    { card: [28, 50, 0.72, 4, 32], sh: false, solo: true },
  ],
  views: {
    // from its end: legs at v 0.2 / 1.8, the bar along it, the spears in a row
    e: { V: 2, parts: [
      { box: [-3, 3, 0.2, 1.8, 0, 42] },
      { quad: [[3, 0.4, 62], [3, 1.5, 62], [5, 1.5, 0], [5, 0.4, 0]] },
      { card: [-2, 2, 1.2, 18, 52] }, { card: [-2, 2, 1.55, 4, 32] },
    ] },
  },
});
// armor_stand (decor.js armorStand, mk(1, 66)): base board, pole, the armour (a box: the art's chainmail on its front,
// its top the shoulders' rows stretched), the helmet
defineSolid('armor_stand', {
  foot: true,
  parts: [
    { box: [-12, 12, 0.52, 0.68, 0, 4], sh: false },
    { lathe: [0, 0.6, [[3, 2], [54, 2]]], n: 6, sh: false },
    { box: [-18, 18, 0.48, 0.6, 18, 49], top: 'strip' },
    { box: [-8.5, 8.5, 0.5, 0.6, 49, 59], top: 'strip', sh: false },
  ],
  decal: [0, 0.6, 14, 4],
});
// washtub (decor.js washtub, mk(2, 30) / mkv(1, 2, 30)): an oval tub (a lathe stretched along its length), the water
// on its rim; the art draws the oval 50 × 18: squashed (k) as it is seen from the front
// (the same tub whichever way it faces: model 'front'; the _e art draws it 40 × 100, its fit only textures)
defineSolid('washtub', {
  model: 'front', k: 18 / 30, piv: 0.78 - 1,
  parts: [{ lathe: [0, 0.78, [[0, 29], [3, 30], [22, 31]]], sx: 50 / 31, n: 12 }],
  views: { e: { V: 2, k: 44 / 50, piv: 1.6 - 2, parts: [{ lathe: [0, 1.6, [[0, 19], [3, 20], [22, 20.5]]], sx: 50 / 20.5 }] } },
});

// ---- banner (stations.js bannerPole + bannerCloth, composeWorld drawBanner): the pole and its crossbar; the cloth hangs
// from the bar as a board in the banner's plane and swings in it as at 0° (the art faces south whatever the facing:
// fixed) ----
const PG_X = 3, PG_H = 105.4; // the cloth's top attachment (stations.js PROP_GEOM.bannerX / bannerLift on the pole's row)
const CUV = [0, 0, 0, 0], CLOTH = ['banner_cloth_0', 'banner_cloth_1', 'banner_cloth_2'], BFO = new Float32Array(5); // (BFO: the folds' offsets)
function bannerCloth(B, A, o, t, x, y, lift, a, fs) {
  const F = B.faces, s = sprite(A, CLOTH[(((o.v | 0) % 3) + 3) % 3]);
  if (!F || !s) return;
  const seed = o.x * 0.93 + o.y * 1.31;
  const w = Math.sin(t * 1.7 + seed) * 0.6 + Math.sin(t * 3.9 + seed * 2) * 0.3 + 0.35;
  const th = -0.07 * w, cs = Math.cos(th), sn = Math.sin(th), k = (0.94 + 0.06 * Math.sin(t * 4.3 + seed)) * (o.f || 1);
  const L = -s.ax * s.w * k, R = (1 - s.ax) * s.w * k, T = -s.ay * s.h, D = (1 - s.ay) * s.h;
  // (u right, v down the cloth) turned by th in its plane → world (along x) and height
  const px = (u, v) => x + u * cs - v * sn, ph = (u, v) => lift - (u * sn + v * cs);
  // the cloth hangs in soft folds (four strips in a shallow zigzag across its plane): seen from the side it is never a
  // bare line; the folds breathe with the wind
  const fd = 0.065 + 0.012 * Math.sin(t * 2.3 + seed); // (an S across its width, either side of the bar: from the side it shows round the pole)
  BFO[1] = fd; BFO[3] = -fd;
  for (let k = 0; k < 4; k++) {
    const ua = L + ((R - L) * k) / 4, ub = L + ((R - L) * (k + 1)) / 4, ya = y + BFO[k], yb = y + BFO[k + 1];
    let nx = -(yb - ya), ny = ub - ua;
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (-CAMV.s * nx + CAMV.c * ny < 0) { nx = -nx; ny = -ny; } // (two-sided: the side facing the camera)
    const z = shade(nx, ny);
    CUV[0] = s.u0 + ((s.u1 - s.u0) * k) / 4; CUV[2] = s.u0 + ((s.u1 - s.u0) * (k + 1)) / 4; CUV[1] = s.v0; CUV[3] = s.v1;
    F.quad(px(ua, T), ya, ph(ua, T), px(ub, T), yb, ph(ub, T), px(ub, D), yb, ph(ub, D), px(ua, D), ya, ph(ua, D), CUV, fs.tr * z, fs.tg * z, fs.tb * z, fs.a);
  }
  if (!fs.bp && B.shadow) shadowRect(B, K.tables(A), x, y - 0.015, 0, s.w, 0.03, s.h, a, lift - s.h);
}
defineSolid('banner', {
  fixed: true, s: 'banner_pole',
  parts: [
    { lathe: [-10, 0.85, [[0, 3.2], [2, 2.6], [104, 2.6], [104, 3], [109, 3], [117, 0.6]]], n: 6 },
    { box: [-12, 18, 0.82, 0.88, 104, 108], sh: false },
  ],
  fx: [{ at: [PG_X, 0.85, PG_H], always: true, draw: bannerCloth }],
  blob: [0.5, 0.3, 0, 0.4],
  decal: [-10, 0.85, 10, 3, 0.35],
});

// ---- pots: the pot is the solid (round: squashed like the art at every angle), the plant an upright sprite on it ----
// flower_pot (stations.js flowerPot, mk(0.6, 18)): terracotta pot on v 0.85, rim 20 px, soil ellipse 8 × 1.4
defineSolid('flower_pot', {
  k: 0.2, k1: 0.2, piv: 0.85 - 1,
  parts: [{ lathe: [0, 0.85, [[0, 6.5], [13, 8.6], [13, 10], [17, 10]]], n: 10 }],
  fx: [potPlant('flower_pot', 0.85)],
  blob: [0.42, 0.28],
});
// plant_pot (decor.js plantPot, mk(1, 40 / 64)): pot on v 0.6, rim 22 px
defineSolid('plant_pot', {
  foot: true, k: 0.2, k1: 0.2, piv: 0.6 - 1,
  parts: [{ lathe: [0, 0.6, [[0, 7], [13, 9.6], [13, 11], [17, 11]]], n: 10 }],
  fx: [potPlant('plant_pot', 0.6)],
  decal: [0, 0.62, 13, 4],
});

// ---- clusters of round things (jars, sacks): lathes, squashed like the art at every angle; one casts the shadow (the
// art's silhouette) ----
// jars (decor.js jars, mk(1, 30)): jar(x, v, h, w) — mouth 0.4 w, belly 0.85 w at 0.45 h, foot 0.6 w
const jar = ([x, v, h, w], sh) => ({ lathe: [x, v, [[0, 0.6 * w], [0.45 * h, 0.9 * w], [h, 0.42 * w]]], n: 7, sh });
defineSolid('jars', {
  foot: true, k: 0.45, k1: 0.45, piv: 0.82 - 1,
  parts: [jar([-14, 0.7, 20, 8], false), jar([2, 0.86, 26, 10], true), jar([15, 0.74, 14, 7], false), jar([-6, 0.94, 12, 6], false)],
  pt: 1,
});
// sacks (decor.js sacks, mk(1, 30)): sack(x, v, h, w) — a soft bag, its tied neck on top
const sack = ([x, v, h, w], sh) => ({ lathe: [x, v, [[0, w], [0.6 * h, w + 1], [h + 3, 0.35 * w]]], n: 7, sh });
defineSolid('sacks', {
  foot: true, k: 0.4, k1: 0.4, piv: 0.84 - 1,
  parts: [sack([-12, 0.8, 22, 10], false), sack([11, 0.78, 20, 9.5], false), sack([0, 0.92, 18, 10], true)],
  pt: 2,
});

// ---- things hung on a wall standing free (no wall behind: o._mount false; on a wall: faces/structures.js mount) ----
// decor.js wallBox art (64 × 44, anchor bottom-centre: row r = height 44 − r on the board's plane), drawn at 0.66 scale
// and the height it would hang on a wall (DECOR_GEOM.mount + the mount lift): a thin board facing its way
const hung = (type, card) => defineSolid(type, {
  scale: 0.66, hang: () => (DECOR_GEOM.mount[type] ?? 0.04) + K.MOUNT_UP,
  parts: [{ card, t: 2, solo: true }],
  blob: false,
});
hung('painting', [-17, 17, 1, 6, 33]);
hung('trophy', [-20, 20, 1, 2, 41]);
hung('curtain', [-23, 23, 1, 3, 40]);
hung('herbs_hang', [-18, 18, 1, 4, 35]);
hung('pot_hooks', [-23, 23, 1, 10, 37]);
