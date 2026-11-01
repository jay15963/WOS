// Camera rotation — the solid pieces' table (art/faces/solid.js: format, units and rules at the top of that file).
// Numbers are read off each painter: x px from the art's centre column, v = ground row in tiles (the anchor row is V),
// h px above the ground. A view whose art draws the piece differently lists the same parts again in its own numbers.
import { defineSolid } from './solid.js';

// ---- chest (art/buildings.js chest / chest_n / chest_e): a box; the old art draws its depth short (k) ----
// chest 58×52 anchored on row 49 (no Y(v, h)): a pixel row r at height h is ground row v = 1 + (r − 49 + h) / 64
const CHEST = { box: [-23, 23, 1 - 19 / 64, 1 - 2 / 64, 0, 25] }; // lid rows 5..22 (its arc included), front 22..47
defineSolid('chest', {
  k: (17 / 64) / 0.56, piv: -2 / 64, // the lid's 17 px are the body's 0.56 tiles; squashed about the front
  parts: [CHEST],
  views: {
    n: { k: (17 / 64) / 0.56, piv: -2 / 64, parts: [CHEST] },
    // chest_e 46×82 anchored on row 79: end panel rows 52..78, lid 22..52 (the body's 0.74 tiles)
    e: { k: (30 / 64) / 0.74, piv: -1 / 64, parts: [{ box: [-18, 18, 1 - 31 / 64, 1 - 1 / 64, 0, 26] }] },
  },
  // open while the local player uses it (o._lid; the art exists for the front only): chest_open 58×60 on row 57 —
  // body front rows 34..55, the opening 28..34 (drawn very flat), the lid standing behind it (rows 1..30)
  state: (o) => (o._lid && (o.face || 's') === 's' ? 'open' : ''),
  variants: {
    open: { s: 'chest_open', only: true, k: (6 / 64) / 0.56, piv: -2 / 64,
      parts: [{ box: [-23, 23, 1 - 8 / 64, 1 - 2 / 64, 0, 21] }, { card: [-23, 23, 1 - 9.5 / 64, 21, 48] }] },
  },
});

// ---- barrel (art/decor.js barrel, mk(1, 38)): a lathe; its top ellipse is squashed (ry 4.6 for r 13) ----
defineSolid('barrel', {
  foot: true, k: 4.6 / 13, k1: 4.6 / 13, piv: 0.6 - 1, // (decor edge piece: drawn lower by its foot; squashed about its axis,
  // at every angle: a round thing looks the same from all sides, so it keeps the art's flat top)
  parts: [{ lathe: [0, 0.6, [[0, 13], [18, 15], [36, 13]]], n: 12 }],
});

// ---- table (art/stations.js table / table_wood_e): one see-through box (legs and gaps come from the art) ----
defineSolid('table_wood', {
  parts: [{ box: [-56, 56, 0.15, 0.85, 0, 27], open: true }],
  views: { e: { V: 2, parts: [{ box: [-22, 22, 0.12, 1.86, 0, 27], open: true }] } },
});

// ---- chair (stations.js chair / chair_wood_n / chair_wood_e): seat box + backrest board ----
defineSolid('chair_wood', {
  parts: [{ box: [-14, 14, 0.35, 0.8, 0, 17], open: true }, { card: [-13, 13, 0.35, 17, 46] }],
  seat: [0, 0.6, 17], // (where a sitter sits while turned: art/compose.js)
  views: {
    n: { parts: [{ box: [-14, 14, 0.25, 0.7, 0, 17], open: true }, { card: [-13, 13, 0.75, 17, 46] }], seat: [0, 0.45, 17] },
    e: { parts: [{ box: [-10, 12, 0.3, 0.72, 0, 17], open: true }, { box: [-13, -8, 0.3, 0.72, 17, 46] }], seat: [2, 0.51, 17] },
  },
});

// ---- bed (buildings.js bed / bed_n / bed_e, Y(v, h) = 64v − 7 − h: anchor row v = 2): frame + headboard ----
defineSolid('bed', {
  V: 2,
  parts: [{ box: [-29, 29, 0.594, 1.98, 0, 9] }, { card: [-30, 30, 0.594 - 2 / 64, 9, 31], t: 4 }],
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
