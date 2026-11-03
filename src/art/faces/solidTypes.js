// Camera rotation — the solid pieces' table (art/faces/solid.js: format, units and rules at the top of that file).
// Numbers are read off each painter: x px from the art's centre column, v = ground row in tiles (the anchor row is V),
// h px above the ground. A view whose art draws the piece differently lists the same parts again in its own numbers.
import { defineSolid } from './solid.js';
import { CHEST_UV } from '../buildings.js';
import { ARCH_FACES as K } from '../archCompose.js';

// ---- chest: a real box with its own face art (art/buildings.js chestUV, CHEST_UV: each face in true proportions) —
// body 16 px and lid 9 px flush over the whole footprint (EDGE_GEOM 0.56 deep), the bands over front / lid / back, the
// lock only on the front; open (o._lid, any facing): dark inside walls, the contents on the bottom, the lid standing up
// on the back edge ----
const U = CHEST_UV, B0 = 1 - 0.56;
const CHEST_BODY = { box: [-23, 23, B0, 1, 0, 16], uv: { s: U.fb, n: U.bb, e: U.sb, w: U.sb } };
defineSolid('chest', {
  ow: 0, uvS: 'chest_uv',
  parts: [CHEST_BODY, { box: [-23, 23, B0, 1, 16, 25], uv: { s: U.fl, n: U.bl, e: U.sl, w: U.sl, t: U.top } }],
  state: (o) => (o._lid ? 'open' : ''),
  variants: {
    open: {
      parts: [
        { box: [-22.5, 22.5, B0 + 0.008, 0.992, 5, 16], open: true, uv: { i: U.inner }, z: -0.03, sh: false },
        { quad: [[-22.5, B0 + 0.008, 5], [22.5, B0 + 0.008, 5], [22.5, 0.992, 5], [-22.5, 0.992, 5]], uv: { q: U.con }, z: -0.02, sh: false },
        CHEST_BODY,
        { box: [-23, 23, B0, B0 + 9 / 64, 16, 52], uv: { s: U.lin, n: [U.top[2], U.top[3], U.top[0], U.top[1]], e: [...U.sl, 1], w: [...U.sl, 1], t: U.fl } },
      ],
    },
  },
});

// ---- barrel (art/decor.js barrel, mk(1, 38)): a lathe; its top ellipse is squashed (ry 4.6 for r 13) ----
defineSolid('barrel', {
  foot: true, k: 4.6 / 13, k1: 4.6 / 13, piv: 0.6 - 1, // (decor edge piece: drawn lower by its foot; squashed about its axis,
  // at every angle: a round thing looks the same from all sides, so it keeps the art's flat top)
  parts: [{ lathe: [0, 0.6, [[0, 13], [18, 15], [36, 13]]], n: 12 }],
  decal: [0, 0.62, 16, 5], // (its painted dirt patch, kept on the ground)
});

// ---- table (art/stations.js table / table_wood_e): one see-through box (legs and gaps come from the art), and what
// stands on it: the mug and the candle in its dish (the art draws them over the top's back; the plate and bread lie
// painted on the top), the candle's flame on its wick ----
const TBL_FLAME = (B, A, o, t, x, y, lift, a) => { if (a > 0.05) K.smallFlame(B, K.tables(A), x, y, lift, 1, t, 0.5); };
const TBL_MUG = [25.5, 0.4, 27], TBL_CV = 0.384 - 2 / 64;
defineSolid('table_wood', {
  model: 'front',
  parts: [
    { box: [-56, 56, 0.15, 0.85, 0, 27], open: true },
    { lathe: [25.5, 0.478 - 3.5 / 64, [[27, 3.4], [36, 3.4]]], n: 8, ow: 1.2, sh: false, px: { s: TBL_MUG, e: TBL_MUG, n: TBL_MUG, w: TBL_MUG, t: [25.5, 0.3375, 27] } }, // mug
    { lathe: [0, TBL_CV, [[27, 4.6], [28.2, 4.6]]], n: 8, ow: 0.8, sh: false, px: [3.5, 0.384, 27] }, // the candle's dish
    { lathe: [0, TBL_CV, [[28, 1.9], [36.5, 1.9]]], n: 6, ow: 0.8, sh: false, px: [0, 0.306, 27] },    // the candle
  ],
  fx: [{ at: [0, 0.384 - 2 / 64, 38], draw: TBL_FLAME }],
  views: { e: { V: 2, parts: [{ box: [-22, 22, 0.12, 1.86, 0, 27], open: true }] } },
});

// ---- chair (stations.js chair / chair_wood_n / chair_wood_e): seat box + backrest board ----
defineSolid('chair_wood', {
  parts: [{ box: [-14, 14, 0.35, 0.8, 0, 17], open: true }, { card: [-13, 13, 0.35, 17, 46], cover: true }],
  seat: [0, 0.6, 17], // (where a sitter sits while turned: art/compose.js)
  views: {
    n: { parts: [{ box: [-14, 14, 0.25, 0.7, 0, 17], open: true }, { card: [-13, 13, 0.75, 17, 46] }], seat: [0, 0.45, 17] },
    e: { parts: [{ box: [-10, 12, 0.3, 0.72, 0, 17], open: true }, { box: [-13, -8, 0.3, 0.72, 17, 46] }], seat: [2, 0.51, 17] },
  },
});

// ---- bed (buildings.js bed / bed_n / bed_e, Y(v, h) = 64v − 7 − h: anchor row v = 2): frame + headboard. The art
// draws the mattress from v 0.594; the model fills the two tiles (geo: the headboard at the tile edge, a bed against a
// wall touches it), its art stretched along. rest: the pillow (art numbers) where a sleeper's head lies ----
defineSolid('bed', {
  V: 2, model: 'front', // (the same bed whichever way it faces: the _n / _e art only textures it)
  parts: [
    { box: [-29, 29, 0.594, 1.98, 0, 9], geo: [-30, 30, 0.004, 1.996, 0, 9] },
    { card: [-30, 30, 0.594 - 2 / 64, 9, 31], t: 4, gt: 6, geo: [-28, 28, 0.05, 9, 31], cover: true },
    // the headboard's two posts with their knobs (seen from the side the head end stands up, not a thin line)
    ...[-29, 29].map((x) => ({ lathe: [x, 0.5627, [[0, 3], [33, 3], [33, 3.7], [36, 3.4], [37.5, 0]]], geo: [x, 0.05, [[0, 3], [33, 3], [33, 3.7], [36, 3.4], [37.5, 0]]], n: 8, sh: false, cover: true, px: [-28, 0.5627, 15] })),
  ],
  rest: [0, 0.766, 9],
  views: {
    n: { V: 2, parts: [{ box: [-29, 29, 0.3, 1.98, 0, 9] }, { card: [-30, 30, 1.98 - 2 / 64, 9, 22], t: 4 }] },
    e: { parts: [{ box: [-58, 60, 0.1, 0.9, 0, 13] }, { box: [-62, -54, 0.1, 0.9, 13, 32] }] },
  },
});

// (torch: faces/solidLights.js, with the wall torches)

// ---- stack of crates (decor.js crates, mk(1, 46)): three boxes; no side art: each side shows the front of its crate ----
defineSolid('crates', {
  foot: true, // (borrow: { e: 'edge' } would stretch the fronts' edge columns over the sides instead)
  parts: [{ box: [-24, 6, 0.5, 0.9, 0, 22] }, { box: [2, 26, 0.42, 0.72, 0, 18] }, { box: [-20, 4, 0.55, 0.85, 22, 42] }],
});
