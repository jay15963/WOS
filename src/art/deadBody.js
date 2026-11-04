// The bodies of the night's dead of the warm lands (docs/NIGHT-DEAD.md, game/undead.js): the Esqueleto, the Múmia,
// the Gigante Esqueleto and the Múmia Gigante. Made like the ice giant's (art/giantBody.js — its renderer: ellipsoids in
// body space ray-cast pixel by pixel with cel shading, an orthographic camera PHI above the horizon, the painters'
// outline): every part is a small 3D model, painted from 5 views (s, se, e, ne, n; sw / w / nw mirrored), placed every
// frame by a 3D skeleton (art/deadRig.js) — so every view is the same body seen from that side, at every camera angle.
//
//   skeleton   a big skull (the pawns' chibi proportions) with sockets, nose hole and teeth, a ribcage of thin ribs
//              around the spine (gaps you see through), clavicles, scapulae, a pelvis, thin limb bones; a tattered
//              loincloth; some wear a rusted kettle hat (headh). Weapons: a bone sword, a spear tipped with bone, a bow.
//   mummy      a hunched wrapped body: linen bands with seams, dirt and torn gaps showing the dried flesh, a scarab
//              amulet, loose strips; a wrapped head with a dark slit where the eyes glow; a bronze khopesh for some.
//   skeleton_giant  the bones of a giant, hunched like the ice giant: a horned skull with tusks, a great ribcage with a
//              ghost-fire burning inside, rusted spiked pauldrons, a leather loincloth with a skull trophy; a femur club
//              with iron spikes; it throws a giant bone (proj_giant_bone).
//   mummy_giant  a pharaoh: wrapped, a striped nemes headdress with the cobra and the false beard, a broad collar of
//              gold, lapis and carnelian, gold bracers, a pleated kilt and apron; a sandstone column for a club; it
//              throws the lid of its sarcophagus (proj_giant_slab).
// Parts (lazy sprites in the look texture; anchor = the part's joint): dd_<k>_<part>_<view> per view (torso, head, fist,
// foot, the giants' paulR / paulL), dd_<k>_<limb> painted along −z (uarm, farm, thigh, shin, weapons) — k: sk, mu, sg, mg.
// The small ones are modelled at their painted size (1 unit = 1 px), the giants GS times bigger (unit px like the ice
// giant: they share its skeleton SK, so its poses fit them).

import { spritePxFast as spritePx, hex, TAU, lin, rad, circle } from './paint.js';
import { lazyDef } from './lazyDefs.js';
import { render, boxOf, SK as GSK } from './giantBody.js';

export const VIEWS5 = ['s', 'se', 'e', 'ne', 'n'];
export const YAW5 = { e: 0, se: Math.PI / 4, s: Math.PI / 2, ne: -Math.PI / 4, n: -Math.PI / 2 };

// ---------- vectors ----------
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const col3 = (h) => { const c = hex(h); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
const mixv = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function axesAlong(u, up = [0, 0, 1]) {
  const x = nrm3(u);
  let y = cross3(up, x);
  if (len3(y) < 1e-4) y = cross3([0, 1, 0], x);
  y = nrm3(y);
  return [x, y, cross3(x, y)];
}
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf), l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
const fbm3 = (x, y, z) => vnoise(x, y, z) * 0.62 + vnoise(x * 2.1 + 7.3, y * 2.1 - 3.1, z * 2.1 + 1.7) * 0.38;

// ---------- the model helpers (BR: the default normal-blend radius of the model being built) ----------
let BR = 1.2;
function E(c, a, m, o = {}) { return { c, a, R: o.R || IDENT, m, g: o.g ?? 'body', br: o.br ?? BR, edge: o.edge ?? true, id: o.id }; }
function seg(p0, p1, r, m, o = {}) {
  const d = sub3(p1, p0), L = len3(d) / 2;
  return E(mul3(add3(p0, p1), 0.5), [L + r * (o.cap ?? 0.35), r * (o.wy ?? 1), r * (o.wz ?? 1)], m, { ...o, R: axesAlong(d, o.up) });
}
// a polyline of segments (radius r0 → r1 along it)
function chain(pts, r0, r1, m, o = {}) {
  const out = [];
  for (let i = 1; i < pts.length; i++) { const u = (i - 0.5) / (pts.length - 1); out.push(seg(pts[i - 1], pts[i], r0 + (r1 - r0) * u, m, o)); }
  return out;
}
// a rib: an elliptic hoop at height z (centre cx, half width hw, half depth hd), its back `drop` higher than its front,
// open in front (|θ| < gap: the sternum / the floating ribs)
function rib(cx, z, hw, hd, drop, r, m, g, gap, n = 14) {
  const out = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const th = -Math.PI + (i / n) * 2 * Math.PI;
    const p = [cx + hd * Math.cos(th), hw * Math.sin(th), z + drop * (1 - Math.cos(th)) / 2];
    if (prev && Math.abs(th) > gap && Math.abs(prev.th) > gap) out.push(seg(prev.p, p, r, m, { g, cap: 0.2 }));
    prev = { p, th };
  }
  return out;
}

// ---------- palette ----------
const C = {
  bone: col3('#e6dbc0'), boneD: col3('#a8997b'), boneW: col3('#f4ecd8'), crack: col3('#5a4b39'), socket: col3('#110c09'), teeth: col3('#f1e8d2'),
  horn: col3('#8e7e64'), hornD: col3('#5e5040'),
  cloth: col3('#5b3a2c'), clothD: col3('#36231a'), leather: col3('#5c4030'), leatherD: col3('#3a281d'),
  rust: col3('#73604f'), rustO: col3('#9a5228'), rustD: col3('#3f342c'),
  wood: col3('#5e4630'), woodD: col3('#3e2e1f'), string: col3('#d8cfb8'), feather: col3('#e8e2d2'),
  linen: col3('#d6c6a0'), linenD: col3('#9c8862'), dirt: col3('#7d6a49'), flesh: col3('#3a2c20'),
  gold: col3('#e5b440'), goldL: col3('#ffe08a'), goldD: col3('#9a6c1a'), lapis: col3('#28489a'), lapisL: col3('#4a72c8'), carn: col3('#b0442a'),
  bronze: col3('#c08a44'), patina: col3('#5f8c6a'), sand: col3('#d9b77e'), sandD: col3('#a8844f'), glyph: col3('#5c4426'),
  ghost: col3('#b4ffc8'), ghostD: col3('#4cd27e'),
};

// ---------- materials (s: the model's scale — textures sized in its own units) ----------
const BONE = (s) => ({ col: C.bone, gloss: 0.1, tex: (P, p) => {
  const n = fbm3(P[0] / (5 * s), P[1] / (5 * s), P[2] / (6 * s));
  if (p.id === 'skull' && s > 1.5 && Math.abs(fbm3(P[0] / (3 * s), P[1] / (3 * s), P[2] / (3 * s)) - 0.6) < 0.01) return C.crack; // (cracks on a giant's skull)
  return n < 0.3 ? mixv(C.bone, C.boneD, smooth(0.3, 0.1, n) * 0.5) : n > 0.68 ? mixv(C.bone, C.boneW, 0.5) : null;
} });
const TEETH = (s) => ({ col: C.teeth, gloss: 0.2, tex: (P) => (Math.abs((((P[1] / s) * 1.0 + 40) % 2) - 1) > 0.72 ? C.crack : null) });
const HORN = (s) => ({ col: C.horn, gloss: 0.12, tex: (P) => (Math.abs((((P[2] + P[1] * 0.4) / s + 80) % 3) - 1.5) < 0.35 ? C.hornD : null) });
const CLOTH = (s) => ({ col: C.cloth, fur: 0.18, tex: (P) => (fbm3(P[0] / (2 * s), P[1] / (2 * s), P[2] / (2.6 * s)) < 0.38 ? C.clothD : null) });
const LEATHER = (s) => ({ col: C.leather, fur: 0.1, tex: (P) => (Math.abs((((P[2] * 0.55 + P[0] * 0.2) / s + 60) % 6) - 3) < 0.45 ? C.leatherD : null) });
const RUST = (s) => ({ col: C.rust, gloss: 0.25, tex: (P) => {
  const n = fbm3(P[0] / (2.4 * s), P[1] / (2.4 * s), P[2] / (2.4 * s));
  return n > 0.62 ? mixv(C.rust, C.rustO, smooth(0.62, 0.8, n)) : n < 0.28 ? C.rustD : null;
} });
const WOOD = (s) => ({ col: C.wood, fur: 0.1, tex: (P) => (Math.sin((P[2] / s) * 0.9 + fbm3(P[0] / s, P[1] / s, 0) * 5) > 0.8 ? C.woodD : null) });
const STRING = () => ({ col: C.string });
const FEATHER = () => ({ col: C.feather, fur: 0.2 });
// linen wraps: bands slanting around the body with dark seams, dirt, torn gaps that show the dried flesh beneath
const LINEN = (s, slant = 0.32) => ({ col: C.linen, fur: 0.16, tex: (P) => {
  const u = (P[2] + P[1] * slant + P[0] * 0.12) / s, f = ((u % 2.7) + 2.7) % 2.7;
  const n = fbm3(P[0] / (4.5 * s), P[1] / (4.5 * s), P[2] / (5 * s));
  if (n > 0.8) return C.flesh;
  if (f < 0.32) return C.linenD;
  return n < 0.32 ? mixv(C.linen, C.dirt, smooth(0.32, 0.12, n) * 0.7) : null;
} });
// the wrapped head: the same bands and a dark slit at the eyes (z ≈ eyeZ, in front)
const LINEN_HEAD = (s, eyeZ, front) => {
  const L = LINEN(s, 0.1);
  return { ...L, tex: (P) => (Math.abs(P[2] - eyeZ * s) < 1.25 * s && P[0] > front * s ? C.flesh : L.tex(P)) };
};
const GOLD = () => ({ col: C.gold, gloss: 0.55, tex: (P) => (fbm3(P[0] / 3, P[1] / 3, P[2] / 3) > 0.7 ? C.goldL : null) });
const LAPIS = () => ({ col: C.lapis, gloss: 0.35 });
// the broad collar: rings of gold, lapis, gold, carnelian around the neck point N
const COLLAR = (s, N) => ({ col: C.gold, gloss: 0.4, tex: (P) => {
  const d = Math.hypot(P[0] - N[0] * s, P[1] - N[1] * s, (P[2] - N[2] * s) * 0.6) / s, b = Math.floor(d / 2.6) % 4;
  return b === 1 ? C.lapis : b === 3 ? C.carn : null;
} });
// the nemes: horizontal stripes of lapis and gold
const NEMES = (s) => ({ col: C.gold, gloss: 0.3, tex: (P) => ((Math.floor((P[2] / s + 60) / 1.9) % 2) ? C.lapis : null) });
const KILT = (s) => ({ col: col3('#efe6cf'), fur: 0.08, tex: (P) => (Math.abs((((Math.atan2(P[1], P[0]) * 9) % 1) + 1) % 1 - 0.5) > 0.42 ? C.linenD : null) });
const APRON = (s) => ({ col: C.gold, gloss: 0.3, tex: (P) => ((Math.floor((P[1] / s + 40) / 2.2) % 2) ? C.lapis : null) });
const BRONZE = (s) => ({ col: C.bronze, gloss: 0.5, tex: (P) => (fbm3(P[0] / (2 * s), P[1] / (2 * s), P[2] / (2 * s)) > 0.68 ? C.patina : null) });
const SANDSTONE = (s) => ({ col: C.sand, fur: 0.14, tex: (P) => {
  const z = P[2] / s;
  if (Math.abs(((z + 200) % 9) - 4.5) < 0.5) return C.sandD; // carved rings
  const a = Math.atan2(P[1], P[0]), cell = Math.floor((z + 200) / 3) * 13 + Math.floor((a + 4) * 3);
  return hash3(cell, 3, 7) > 0.8 && Math.abs(((z + 200) % 3) - 1.5) < 0.8 ? C.glyph : null; // glyph marks
} });
const GHOST = () => ({ col: C.ghost, glow: true, tex: (P) => (fbm3(P[0] / 4, P[1] / 4, P[2] / 3) < 0.42 ? C.ghostD : null) });
const BEARD_G = (s) => ({ col: C.lapis, gloss: 0.3, tex: (P) => ((Math.floor((P[2] / s + 60) / 1.6) % 2) ? C.gold : null) });

// =====================================================================================================
// Skeleton (1 unit = 1 px; the pawn's proportions: a big skull on a small body)
export const SK_SKEL = { pelvis: 17.5, hip: [0, 4.2, -1.2], shoulder: [0.5, 8.6, 16.5], neck: [1.2, 0, 18.5], uarm: 9.5, farm: 8.5, fist: 2.2, thigh: 8.8, shin: 8.4, ankle: 1.6 };
export const EYES_SKEL = [[8.9, 3.7, 11.6], [8.9, -3.7, 11.6]];
function skTorso() {
  BR = 1.0;
  const P = [], B = BONE(1);
  // spine: vertebrae (lumbar forward, thoracic back) with their spinous processes
  for (let k = 0; k < 9; k++) {
    const z = 1 + k * 2.1, x = -2.4 - 0.9 * Math.sin((z / 19) * Math.PI);
    P.push(E([x, 0, z], [1.4, 1.6, 0.85], B, { g: 'spine' }), E([x - 1.3, 0, z - 0.3], [0.8, 0.45, 0.6], B, { g: 'spine' }));
  }
  P.push(seg([0.6, 0, 16.6], [1.2, 0, 19.4], 1.05, B, { g: 'neck' }));
  // ribs: four hoops, the lowest open wide in front (floating ribs)
  const RIB = [[8.4, 5.3, 3.5, 0.95], [10.6, 6.5, 4.3, 0.55], [12.8, 7.1, 4.7, 0.42], [14.9, 6.8, 4.4, 0.42]];
  RIB.forEach(([z, hw, hd, gap], i) => P.push(...rib(0.4, z, hw, hd, 1.5, 0.82, B, 'rib' + i, gap)));
  P.push(E([4.9, 0, 12.5], [0.85, 1.25, 3.3], B, { g: 'stern' }));                       // sternum
  for (const s of [1, -1]) {
    P.push(seg([4.2, 1.4 * s, 16.9], [0.6, 8.3 * s, 16.6], 0.8, B, { g: 'clav' }));      // clavicles
    P.push(E([-4.3, 4.7 * s, 13.8], [0.8, 2.4, 3.0], B, { g: 'scap' + s }));            // scapulae
    P.push(E([-0.4, 4.0 * s, 1.9], [2.3, 1.1, 2.7], B, { g: 'pelvis', R: axesAlong([0.25, 0.95 * s, 0.2]) })); // iliac wings
    P.push(E([1.5, 2.5 * s, -0.7], [1.5, 1.15, 1.25], B, { g: 'pelvis' }));
  }
  P.push(E([-2.2, 0, 0.6], [1.25, 2.1, 2.4], B, { g: 'pelvis' }));                       // sacrum
  P.push(seg([2.3, -2.6, -1.4], [2.3, 2.6, -1.4], 0.95, B, { g: 'pelvis' }));             // pubic bar
  // a tattered loincloth on a cord
  const CL = CLOTH(1);
  P.push(...rib(0.2, -0.1, 5.0, 3.9, 0, 0.55, CL, 'cord', -1, 12));
  P.push(E([3.7, 0, -4.4], [0.85, 3.1, 3.7], CL, { g: 'cloth' }), E([-3.9, 0, -4.1], [0.85, 3.4, 3.4], CL, { g: 'cloth' }));
  return [P, []];
}
function skHead(helm) {
  BR = 1.0;
  const P = [], B = BONE(1);
  P.push(E([0.6, 0, 13.4], [9.4, 9.6, 9.4], B, { id: 'skull' }));                        // cranium
  P.push(E([6.8, 0, 6.2], [4.2, 7.0, 3.4], B, { id: 'face' }));                          // face, upper jaw
  for (const s of [1, -1]) P.push(E([7.4, 5.8 * s, 8.0], [2.4, 2.2, 1.8], B, { g: 'cheek' })); // cheekbones
  P.push(E([9.6, 0, 4.4], [1.7, 4.6, 1.3], TEETH(1), { g: 'teeth' }));                   // upper teeth
  P.push(E([8.9, 0, 3.25], [1.6, 4.3, 0.55], { col: C.socket }, { g: 'mouth', edge: false })); // the dark of the mouth
  P.push(E([6.6, 0, 1.6], [4.0, 5.4, 1.5], B, { g: 'jaw' }), E([9.3, 0, 2.3], [1.7, 4.1, 1.05], TEETH(1), { g: 'jaw' })); // jaw, lower teeth
  for (const s of [1, -1]) P.push(seg([3.4, 5.1 * s, 2.0], [1.2, 6.4 * s, 7.2], 1.0, B, { g: 'jaw' }));
  if (helm) {
    const R = RUST(1);
    P.push(E([0.4, 0, 18], [10.2, 10.4, 6], R, { g: 'helm' }), E([0.4, 0, 14.6], [11.6, 11.8, 0.85], R, { g: 'brim' }));
    P.push(E([0.8, 0, 23.6], [2.0, 1.5, 1.5], R, { g: 'helm' }));
  }
  const F = [{ c: [9.2, 3.7, 11.6], r: 2.85, col: C.socket, on: 'skull' }, { c: [9.2, -3.7, 11.6], r: 2.85, col: C.socket, on: 'skull' }, { c: [10.6, 0, 7.6], r: 1.4, col: C.socket, on: 'face' }];
  return [P, F];
}
function skUarm() { BR = 1.0; const B = BONE(1); return [[seg([0, 0, 0], [0, 0, -9.5], 1.1, B), E([0, 0, -0.6], [1.8, 1.8, 1.8], B), E([0.2, 0, -9.2], [1.3, 1.9, 1.25], B)], []]; }
function skFarm() {
  BR = 0.8; const B = BONE(1);
  return [[seg([0, 0.75, -0.4], [0, 0.85, -8.3], 0.72, B, { g: 'r' }), seg([0, -0.75, -0.4], [0, -0.5, -8.3], 0.66, B, { g: 'u' }), E([0, 0, -0.5], [1.2, 1.7, 1.0], B, { g: 'r' }), E([0, 0, -8.4], [1.1, 1.8, 0.85], B, { g: 'u' })], []];
}
function skFist() {
  BR = 0.6; const B = BONE(1), P = [E([0, 0, -0.4], [1.5, 1.8, 1.4], B)];
  for (const y of [-1.25, -0.42, 0.42, 1.25]) P.push(seg([1.0, y, -1.2], [2.0, y * 1.05, -2.5], 0.42, B, { g: 'f' + y }), seg([2.0, y * 1.05, -2.5], [1.2, y, -3.3], 0.38, B, { g: 'f' + y }));
  P.push(seg([0.5, 1.7, -0.4], [1.7, 2.1, -1.4], 0.48, B, { g: 'thumb' }));
  return [P, []];
}
function skThigh() { BR = 1.0; const B = BONE(1); return [[seg([0, 0, 0], [0, 0, -8.8], 1.3, B), E([0, 0, -0.3], [1.7, 1.8, 1.7], B), E([0.5, 0, -8.6], [1.5, 2.2, 1.35], B)], []]; }
function skShin() {
  BR = 0.8; const B = BONE(1);
  return [[seg([0, 0.35, 0], [0, 0.3, -8.4], 1.05, B), seg([-0.6, -0.85, -0.6], [-0.5, -0.7, -8], 0.55, B, { g: 'fib' }), E([0.3, 0, -0.4], [1.5, 1.9, 1.1], B), E([0, 0, -8.2], [1.2, 1.5, 0.95], B)], []];
}
function skFoot() {
  BR = 0.7; const B = BONE(1), P = [E([0.9, 0, -0.4], [2.1, 1.55, 0.95], B), E([-0.9, 0, -0.6], [1.15, 1.15, 0.85], B)];
  for (const y of [-1.2, -0.4, 0.4, 1.2]) P.push(seg([2.2, y, -0.7], [4.6, y * 1.15, -1.25], 0.42, B, { g: 't' + y }));
  return [P, []];
}
// weapons (painted along −z from the grip: the rig turns them)
function skSword() {
  BR = 0.6; const B = BONE(1);
  return [[E([0, 0, 3.2], [1.0, 1.0, 1.0], B), seg([0, 0, 2.6], [0, 0, -1.2], 0.78, CLOTH(1), { g: 'grip' }), E([0, 0, -1.6], [3.3, 0.95, 0.8], B, { g: 'guard' }),
    E([0, 0, -11.2], [1.75, 0.5, 9.8], { ...B, tex: (P, p) => (Math.abs(P[0]) > 1.25 && ((Math.floor(P[2] + 40) % 3) === 0) ? C.boneD : B.tex(P, p)) }, { g: 'blade' })], []];
}
function skSpear() {
  BR = 0.6;
  return [[seg([0, 0, 12.5], [0, 0, -16], 0.62, WOOD(1)), E([0, 0, -15.7], [0.95, 0.95, 1.2], CLOTH(1), { g: 'bind' }), E([0, 0, -20.6], [1.5, 0.42, 4.6], BONE(1), { g: 'tip' })], []];
}
// one limb of the bow, grip (0) to tip (−13), bending toward +x (the rig mirrors it for the other limb)
function skBowLimb() {
  BR = 0.6;
  return [[E([0, 0, -0.6], [1.25, 1.25, 1.9], CLOTH(1), { g: 'grip' }), ...chain([[0, 0, 0], [0.5, 0, -4], [1.5, 0, -8], [2.7, 0, -11.4], [3.3, 0, -13]], 1.15, 0.6, { ...WOOD(1), col: col3('#4a3422') }, { g: 'limb' }),
    E([3.4, 0, -13.1], [0.6, 0.6, 0.6], BONE(1), { g: 'nock' })], []];
}
function skString() { BR = 0.4; return [[seg([0, 0, 0], [0, 0, -10], 0.26, STRING(), { cap: 0 })], []]; }
function skArrow() {
  BR = 0.5;
  return [[seg([0, 0, 0], [0, 0, -13.2], 0.32, WOOD(1)), E([0, 0, -14], [0.85, 0.28, 1.35], BONE(1), { g: 'head' }), E([0, 0, -1.6], [1.0, 0.18, 1.8], FEATHER(), { g: 'fl' })], []];
}

// =====================================================================================================
// Mummy (1 unit = 1 px; a little bulkier than the skeleton, hunched)
export const SK_MUMMY = { pelvis: 17.5, hip: [0, 4.4, -1.2], shoulder: [0.4, 9.2, 16], neck: [1.6, 0, 18.4], uarm: 9.2, farm: 8.4, fist: 2.5, thigh: 8.8, shin: 8.4, ankle: 2 };
export const EYES_MUMMY = [[9.6, 3.1, 11.3], [9.6, -3.1, 11.3]];
function muTorso() {
  BR = 1.6;
  const L = LINEN(1), P = [];
  P.push(E([1.2, 0, 12.2], [5.3, 8.2, 6.3], L), E([1.4, 0, 5.4], [4.5, 6.7, 5.0], L), E([0, 0, 0.6], [4.6, 7.0, 3.6], L));
  P.push(E([-2.2, 0, 13.4], [4.2, 7.0, 5.2], L), E([0.6, 0, 17], [3.1, 5.4, 2.1], L));
  for (const s of [1, -1]) P.push(E([0.4, 8.6 * s, 15.6], [3.3, 3.1, 3.3], L));
  P.push(seg([0.8, 0, 16], [1.5, 0, 19.6], 2.3, L, { g: 'neck' }));
  P.push(E([6.1, 0, 14.3], [0.9, 2.0, 2.4], GOLD(), { g: 'amulet' }), E([6.8, 0, 14.3], [0.5, 1.1, 1.4], LAPIS(), { g: 'amulet' })); // scarab
  P.push(seg([-0.6, 7.2, 2.6], [-2.3, 8.4, -5.6], 0.85, L, { g: 'strip' }), seg([-3.4, -2, 7], [-5, -3.6, -1], 0.8, L, { g: 'strip2' })); // loose strips
  return [P, []];
}
function muHead() {
  BR = 1.6;
  const H = LINEN_HEAD(1, 11.3, 4), P = [];
  P.push(E([1.8, 0, 11.2], [8.6, 8.2, 9.8], H, { id: 'skull' }), E([5.4, 0, 5.4], [4.8, 6.0, 3.9], LINEN(1, 0.1), { g: 'jaw' }));
  P.push(seg([-2.8, 6.4, 8.4], [-5.4, 8.4, -1.4], 0.95, LINEN(1), { g: 'strip' }));
  return [P, []];
}
function muUarm() { BR = 1.6; const L = LINEN(1, 0.6); return [[seg([0, 0, 0], [0, 0, -9.2], 2.25, L), E([0.4, 0, -4], [2.5, 2.4, 3], L)], []]; }
function muFarm() { BR = 1.4; const L = LINEN(1, 0.6); return [[seg([0, 0, 0], [0, 0, -8.4], 2.0, L), seg([-1.6, 0.6, -3], [-2.6, 1.2, -9.5], 0.6, L, { g: 'strip' })], []]; }
function muFist() {
  BR = 1.0; const L = LINEN(1, 0.6), P = [E([0.2, 0, -0.5], [2.3, 2.1, 2.3], L)];
  for (const y of [-1.3, 0, 1.3]) P.push(seg([1.6, y, -1.4], [3.0, y, -2.8], 0.6, L, { g: 'f' + y }));
  return [P, []];
}
function muThigh() { BR = 1.6; const L = LINEN(1, 0.5); return [[seg([0, 0, 0], [0, 0, -8.8], 2.6, L)], []]; }
function muShin() { BR = 1.4; const L = LINEN(1, 0.5); return [[seg([0, 0, 0], [0, 0, -8.4], 2.15, L), seg([-1.8, 0.4, -3], [-2.6, 1, -8], 0.55, L, { g: 'strip' })], []]; }
function muFoot() { BR = 1.2; const L = LINEN(1, 0.3); return [[E([1.2, 0, -0.5], [3.1, 2.0, 1.5], L), E([-0.5, 0, -0.2], [1.8, 1.8, 1.6], L)], []]; }
// the khopesh: a bronze sickle-sword (grip, a straight neck, the great curve)
function muKhopesh() {
  BR = 0.6; const Bz = BRONZE(1);
  return [[E([0, 0, 2.9], [0.9, 0.9, 0.9], Bz, { g: 'pom' }), seg([0, 0, 2.4], [0, 0, -2.2], 0.72, LEATHER(1), { g: 'grip' }),
    ...chain([[0, 0, -2.4], [0.2, 0, -7], [1.6, 0, -11], [4.2, 0, -13.6], [7, 0, -13.2], [8.6, 0, -10.8]], 0.82, 0.6, Bz, { g: 'blade', up: [0, 1, 0], wy: 2.1, wz: 0.42 })], []];
}

// =====================================================================================================
// The giants: unit px on the ice giant's skeleton (art/giantBody.js SK), painted GS times bigger
export const GS = 1.8;
export const SMALL = 1.3; // (the skeleton / mummy models are painted this much bigger: a pawn's height)
export const EYES_SG = [[14.4, 5.0, 14], [14.4, -5.0, 14]];
export const EYES_MG = [[15.8, 4.6, 13.6], [15.8, -4.6, 13.6]];
export const CORE_SG = [-1, 0, 25]; // the ghost-fire in the chest (from the pelvis; the rig adds its light)
function sgTorso() {
  BR = 3.0;
  const P = [], B = BONE(GS);
  const SP = [[-6, 0, 2], [-9, 0, 12], [-12, 0, 22], [-12.5, 0, 31], [-7, 0, 39], [3, 0, 43.5], [12, 0, 45]];
  for (let i = 1; i < SP.length; i++) for (let k = 0; k < 3; k++) {
    const u = k / 3, a = SP[i - 1], b = SP[i], p = [a[0] + (b[0] - a[0]) * u, 0, a[2] + (b[2] - a[2]) * u];
    P.push(E(p, [3.0, 3.4, 1.8], B, { g: 'spine' }), E([p[0] - 3.2, 0, p[2] - 0.6], [2.2, 1.1, 1.5], B, { g: 'spine' }));
  }
  const RIB = [[15.5, 19.5, 13, 0.95], [21.5, 25, 16.5, 0.6], [27.5, 26.5, 17.5, 0.45], [33.5, 23.5, 15, 0.42]];
  RIB.forEach(([z, hw, hd, gap], i) => P.push(...rib(-1.5, z, hw, hd, 4.5, 1.55, B, 'rib' + i, gap, 18)));
  P.push(E([14.5, 0, 26], [2.2, 3.4, 8.5], B, { g: 'stern' }));
  P.push(E(CORE_SG, [7, 9, 9], GHOST(), { g: 'core', edge: false })); // a ghost-fire burning in the ribcage
  for (const s of [1, -1]) {
    P.push(seg([12, 3 * s, 37.5], [2, 30 * s, 37], 2.4, B, { g: 'clav' }));
    P.push(E([-12, 14 * s, 33], [2.2, 8.5, 10], B, { g: 'scap' + s }));
    P.push(E([-1, 12 * s, 4.5], [6.5, 3.0, 8.5], B, { g: 'pelvis', R: axesAlong([0.3, 0.9 * s, 0.3]) }));
    P.push(E([5, 9 * s, -3], [4, 3.2, 3.6], B, { g: 'pelvis' }));
  }
  P.push(E([-6, 0, 1], [3.8, 6, 7.5], B, { g: 'pelvis' }), seg([7, -8, -5], [7, 8, -5], 3, B, { g: 'pelvis' }));
  const LE = LEATHER(GS);
  P.push(E([1, 0, -3], [14, 20, 5.5], LE, { g: 'cloth' }), E([12, 0, -14], [3.4, 10, 11], LE, { g: 'flap' }), E([-11, 0, -13], [3.4, 11, 11], LE, { g: 'flap' }));
  P.push(E([9, -15, -1.5], [4.6, 4.2, 5], B, { id: 'trophy', g: 'trophy' })); // a skull hanging at the belt
  return [P, [{ c: [12.9, -13.3, -0.5], r: 1.4, col: C.socket, on: 'trophy' }, { c: [12.9, -16.7, -0.5], r: 1.4, col: C.socket, on: 'trophy' }]];
}
function sgHead() {
  BR = 3.0;
  const P = [], B = BONE(GS);
  P.push(E([3, 0, 15], [13, 12, 13.5], B, { id: 'skull' }), E([12.5, 0, 17.5], [3.4, 11, 2.8], B, { g: 'brow' }));
  P.push(E([10, 0, 7.5], [6, 9.5, 5.2], B, { id: 'face' }));
  for (const s of [1, -1]) P.push(E([11, 8 * s, 9.5], [3.4, 3, 2.6], B));
  P.push(E([15, 0, 4.8], [2.4, 7, 2], TEETH(GS), { g: 'teeth' }));
  P.push(E([10, 0, 1], [6, 9, 3.2], B, { g: 'jaw' }), E([15, 0, 0.6], [2.6, 5, 2.6], B, { g: 'jaw' }), E([14.4, 0, 3], [2.2, 6.4, 1.6], TEETH(GS), { g: 'jaw' }));
  const HO = HORN(GS);
  for (const s of [1, -1]) {
    P.push(seg([15, 5.5 * s, 2], [17.2, 7.6 * s, 10.5], 1.6, B, { g: 'tusk' + s }));
    P.push(...chain([[1, 10 * s, 22], [-2, 17 * s, 26.5], [1, 22 * s, 32.5], [7, 23.5 * s, 36]], 3.2, 1.2, HO, { g: 'horn' + s }));
  }
  const F = [{ c: [14.7, 5, 14], r: 3.7, col: C.socket, on: 'skull' }, { c: [14.7, -5, 14], r: 3.7, col: C.socket, on: 'skull' }, { c: [16.1, 0, 9.6], r: 2.2, col: C.socket, on: 'face' }];
  return [P, F];
}
function sgUarm() { BR = 3; const B = BONE(GS); return [[seg([0, 0, 0], [0, 0, -GSK.uarm], 4.6, B), E([0, 0, -1.5], [6.4, 6.4, 6.4], B), E([1, 0, -GSK.uarm + 1], [5, 6.5, 4.4], B)], []]; }
function sgFarm() {
  BR = 2.4; const B = BONE(GS), L = GSK.farm;
  return [[seg([0, 2.6, -1], [0, 2.8, -L], 3.1, B, { g: 'r' }), seg([0, -2.6, -1], [0, -2, -L], 2.6, B, { g: 'u' }), E([0, 0, -1.5], [4.4, 6, 3.6], B, { g: 'r' }), E([0, 0, -L + 1], [4, 6.2, 3.2], B, { g: 'u' })], []];
}
function sgFist() {
  BR = 2; const B = BONE(GS), P = [E([0, 0, -1], [6.5, 7, 5.6], B)];
  for (const y of [-5, -1.7, 1.7, 5]) P.push(seg([4.5, y, -3.5], [8.5, y * 1.05, -8], 1.8, B, { g: 'f' + y }), seg([8.5, y * 1.05, -8], [5, y, -11], 1.6, B, { g: 'f' + y }));
  P.push(seg([2, 6.4, -1], [6.5, 8.2, -4.5], 1.9, B, { g: 'thumb' }));
  return [P, []];
}
function sgThigh() { BR = 3; const B = BONE(GS); return [[seg([0, 0, 0], [0, 0, -GSK.thigh], 5.4, B), E([0, 0, -1], [6.5, 6.8, 6.5], B), E([2, 0, -GSK.thigh + 1], [6, 8, 5], B)], []]; }
function sgShin() {
  BR = 2.6; const B = BONE(GS), L = GSK.shin;
  return [[seg([0, 1, 0], [0, 1, -L], 4.4, B), seg([-2, -3.2, -2], [-1.8, -2.8, -L + 1.5], 2.2, B, { g: 'fib' }), E([1, 0, -1.5], [5.5, 7, 4], B), E([0, 0, -L + 2], [4.5, 5.5, 3.5], B)], []];
}
function sgFoot() {
  BR = 2.2; const B = BONE(GS), P = [E([3, 0, -2.5], [7.5, 6, 3.8], B), E([-4, 0, -3], [4.5, 4.5, 3.4], B)];
  for (const y of [-4.5, -1.5, 1.5, 4.5]) P.push(seg([8, y, -3.5], [17, y * 1.15, -5.5], 1.7, B, { g: 't' + y }));
  return [P, []];
}
// the femur club: a giant's thigh bone, iron spikes through its knob
function sgClub() {
  BR = 2.6; const B = BONE(GS), R = RUST(GS);
  const P = [E([0, 0, 1], [5, 5, 7], LEATHER(GS), { g: 'grip' }), seg([0, 0, 8], [0, 0, -40], 4.1, B), E([0, 0, 9], [5.6, 6.4, 4.8], B, { g: 'end' }),
    E([1, 0, -46], [8.5, 9, 7.4], B, { g: 'knob' }), E([-1.5, 4.2, -50], [5, 4.6, 5], B, { g: 'knob' }), E([-1.5, -4.2, -50], [5, 4.6, 5], B, { g: 'knob' })];
  for (const [a, b] of [[[4, 6, -44], [10, 12, -42]], [[-4, -7, -45], [-9, -13, -43]], [[6, -3, -49], [13, -5, -51]], [[-5, 3, -52], [-10, 6, -57]], [[1, 0, -53], [2, 0, -62]]]) P.push(seg(a, b, 1.9, R, { g: 'spike' }));
  return [P, []];
}
// a shoulder plate of bone (a great beast's scapula) with horn spikes
function sgPauldron(s) {
  BR = 2.6; const B = BONE(GS), HO = HORN(GS);
  return [[E([0, 2.5 * s, 2.5], [10.5, 10.5, 4.6], B), E([-1, 4 * s, 0.5], [8.5, 7.5, 3.6], B, { g: 'rim' }),
    ...chain([[-2, 5 * s, 5], [-5, 10 * s, 11], [-4, 13 * s, 16]], 2.2, 0.8, HO, { g: 'spike' }), ...chain([[4, 6 * s, 5], [5, 11 * s, 10], [7, 12 * s, 14]], 1.9, 0.7, HO, { g: 'spike2' })], []];
}

// the giant mummy (a pharaoh)
const MG_NECK = [13, 0, 45];
function mgTorso() {
  BR = 3.4;
  const L = LINEN(GS, 0.25), P = [];
  P.push(E([5, 0, 13], [16.5, 18.5, 15], L), E([9, 0, 9], [12, 15, 11], L), E([8, 0, 29], [18, 26, 13.5], L));
  for (const s of [1, -1]) P.push(E([15.5, 10.5 * s, 30], [7, 11, 7.5], L, { br: 4 }));
  P.push(E([-8, 0, 34], [15, 24, 14.5], L), E([5, 0, 41], [11, 18, 8.5], L));
  for (const s of [1, -1]) P.push(E([2, 31 * s, 37], [13, 12.5, 13], L), E([-1, 21 * s, 22], [14, 10, 14], L));
  P.push(E([7, 0, 39.5], [15.5, 25.5, 5.6], COLLAR(GS, MG_NECK), { g: 'collar' }));            // the broad collar
  P.push(E([2, 0, 3], [17.5, 23, 4.2], GOLD(), { g: 'belt' }));
  P.push(E([1, 0, -6], [16, 22.5, 9], KILT(GS), { g: 'kilt' }), E([13.5, 0, -13], [3.5, 8.5, 12], APRON(GS), { g: 'apron' }));
  for (const s of [1, -1]) P.push(seg([-4, 21 * s, -2], [-8, 24 * s, -24], 1.8, L, { g: 'strip' + s }));
  return [P, []];
}
function mgHead() {
  BR = 3.0;
  const H = LINEN_HEAD(GS, 13.6, 9), NE = NEMES(GS), G = GOLD(), P = [];
  P.push(E([5, 0, 13], [12.4, 11.8, 12.6], H, { id: 'skull' }), E([11, 0, 6.8], [6.6, 9, 5.4], LINEN(GS, 0.1), { g: 'jaw' }));
  P.push(E([2, 0, 19.5], [13.6, 13.4, 9.4], NE, { g: 'nemes' }));
  for (const s of [1, -1]) P.push(E([4, 14.2 * s, 6], [4.6, 2.6, 12], NE, { g: 'lap' + s }), E([2, 12.5 * s, 14], [6, 3, 6], NE, { g: 'lap' + s }));
  P.push(E([-8, 0, 5], [4.5, 6, 12.5], NE, { g: 'tail' }));
  P.push(E([10.5, 0, 17.6], [3.8, 12.6, 1.8], G, { g: 'band' }));
  P.push(seg([15.8, 0, 17], [17.2, 0, 22.5], 1.4, G, { g: 'uraeus' }), E([17.4, 0, 23], [1.6, 2, 1.6], G, { g: 'uraeus' }));
  P.push(seg([14.5, 0, 2.2], [15.4, 0, -6.4], 2.4, BEARD_G(GS), { g: 'beard' }));
  return [P, []];
}
function mgUarm() { BR = 3.4; const L = LINEN(GS, 0.6); return [[seg([0, 0, 0], [0, 0, -GSK.uarm], 10.2, L), E([3, 0, -13], [9.5, 9.5, 11], L), E([0, 0, -9], [10.8, 10.8, 2.6], GOLD(), { g: 'band' })], []]; }
function mgFarm() { BR = 3; const L = LINEN(GS, 0.6), K = GSK.farm; return [[seg([0, 0, 0], [0, 0, -K], 9.4, L), E([0, 0, -K + 8], [10.4, 10.4, 6.2], GOLD(), { g: 'bracer' }), E([0, 0, -K + 8], [10.6, 10.6, 1.6], LAPIS(), { g: 'bracer2' })], []]; }
function mgFist() { BR = 3; const L = LINEN(GS, 0.6); return [[E([0, 0, 0], [10, 9.5, 9.5], L), E([6, 0, 3], [4.6, 9, 4.4], L)], []]; }
function mgThigh() { BR = 3.4; const L = LINEN(GS, 0.5); return [[seg([0, 0, 0], [0, 0, -GSK.thigh], 12.2, L), E([2, 0, -10], [12.8, 12.3, 11], L)], []]; }
function mgShin() { BR = 3; const L = LINEN(GS, 0.5), K = GSK.shin; return [[seg([0, 0, 0], [0, 0, -K], 10.3, L), E([0, 0, -K + 6], [11.2, 11.2, 2.2], GOLD(), { g: 'anklet' })], []]; }
function mgFoot() { BR = 3; const L = LINEN(GS, 0.3); return [[E([5, 0, -3], [12.5, 9.5, 5], L), E([14, 0, -4.6], [5, 9.5, 3.6], L), E([0, 0, 0.5], [9.5, 9.5, 4.6], L)], []]; }
// a broken sandstone column: carved rings, glyphs, a lotus capital at the far end, a gold band
function mgClub() {
  BR = 2.6; const S = SANDSTONE(GS);
  return [[E([0, 0, 8], [8, 8, 3], S, { g: 'base' }), seg([0, 0, 9], [0, 0, -50], 6.8, S), E([0, 0, -8], [7.4, 7.4, 2.2], GOLD(), { g: 'band' }),
    E([0, 0, -50], [10.6, 10.6, 6], S, { g: 'cap' }), E([0, 0, -56], [8.6, 8.6, 3.8], S, { g: 'cap2' })], []];
}
function mgPauldron(s) { BR = 2.6; return [[E([0, 2.5 * s, 2.5], [10, 10.5, 5.2], GOLD()), E([-1, 4 * s, -0.5], [10.6, 9.4, 3.4], LAPIS(), { g: 'rim' })], []]; }

// ---------- rendering & registration ----------
const OUTL = { bone: 'rgba(28,20,14,0.95)', sand: 'rgba(31,22,12,0.95)' };
const INK = { bone: [30, 22, 15], sand: [34, 24, 14] };
function scaled([parts, feats], k) {
  if (k === 1) return [parts, feats];
  for (const p of parts) { p.c = mul3(p.c, k); p.a = mul3(p.a, k); p.br *= k; }
  return [parts, feats.map((f) => ({ ...f, c: mul3(f.c, k), r: f.r * k }))];
}
// LIGHT: the body upper left; the limbs from the front (the rig turns them)
const LIGHT_BODY = [-0.55, 0.72, 0.42], LIGHT_LIMB = [-0.18, 0.42, 0.89];
function def(name, fn, yaw, limb, k, ow, fam, list) {
  const model = scaled(fn(), k);
  const [W, H, hw, top] = boxOf(model[0], yaw);
  lazyDef(name, () => spritePx(W, H, (g, P) => P.layer((lg) => render(lg, P, model[0], model[1], yaw, hw, top, { light: limb ? LIGHT_LIMB : LIGHT_BODY, limb, th: k > 1.5 ? 5 : 2.6, ink: INK[fam] }), ow, OUTL[fam])), hw / W, top / H);
  list.push(name);
}

// kind → { views: { part: model fn }, limbs: { part: model fn }, k (scale), ow (outline px), fam }
const KINDS = {
  sk: { k: SMALL, ow: 1.6, fam: 'bone', views: { torso: skTorso, head: () => skHead(false), headh: () => skHead(true), fist: skFist, foot: skFoot },
    limbs: { uarm: skUarm, farm: skFarm, thigh: skThigh, shin: skShin, sword: skSword, spear: skSpear, bow: skBowLimb, string: skString, arrow: skArrow } },
  mu: { k: SMALL, ow: 1.8, fam: 'sand', views: { torso: muTorso, head: muHead, fist: muFist, foot: muFoot },
    limbs: { uarm: muUarm, farm: muFarm, thigh: muThigh, shin: muShin, khopesh: muKhopesh } },
  sg: { k: GS, ow: 2.3, fam: 'bone', views: { torso: sgTorso, head: sgHead, fist: sgFist, foot: sgFoot, paulR: () => sgPauldron(-1), paulL: () => sgPauldron(1) },
    limbs: { uarm: sgUarm, farm: sgFarm, thigh: sgThigh, shin: sgShin, club: sgClub } },
  mg: { k: GS, ow: 2.4, fam: 'sand', views: { torso: mgTorso, head: mgHead, fist: mgFist, foot: mgFoot, paulR: () => mgPauldron(-1), paulL: () => mgPauldron(1) },
    limbs: { uarm: mgUarm, farm: mgFarm, thigh: mgThigh, shin: mgShin, club: mgClub } },
};
// every part name of a kind (the rig asks for them all once one is on screen)
export const DEAD_PARTS = {};
for (const [kn, K] of Object.entries(KINDS)) {
  const list = (DEAD_PARTS[kn] = []);
  for (const v of VIEWS5) for (const [pn, fn] of Object.entries(K.views)) def(`dd_${kn}_${pn}_${v}`, fn, YAW5[v], false, K.k, K.ow, K.fam, list);
  for (const [pn, fn] of Object.entries(K.limbs)) def(`dd_${kn}_${pn}`, fn, 0, true, K.k, K.ow, K.fam, list);
}

// ---------- the giants' throws (2D, spinning in flight: fx/giantfx.js) ----------
// a giant's bone: a long femur with knobby ends, ivory with dark cracks
function giantBone() {
  return spritePx(64, 26, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 0, 7, 0, 19, [[0, '#f4ecd8'], [0.55, '#e0d3b4'], [1, '#a8997b']]);
    g.beginPath(); g.moveTo(12, 10); g.quadraticCurveTo(32, 8.5, 52, 10); g.lineTo(52, 16); g.quadraticCurveTo(32, 17.5, 12, 16); g.closePath(); g.fill();
    for (const [x, s] of [[9, -1], [55, 1]]) {
      for (const dy of [-4.2, 4.2]) { g.beginPath(); circle(g, x, 13 + dy, 5.4); g.fill(); }
      g.beginPath(); circle(g, x + s * 2.2, 13, 4.2); g.fill();
    }
    g.strokeStyle = 'rgba(90,75,57,0.8)'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(24, 11); g.lineTo(28, 13); g.lineTo(26, 15.5); g.moveTo(40, 15.5); g.lineTo(43, 13); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(32, 10.6, 14, 1.2, 0, 0, TAU); g.fill();
  }, 2.4, OUTL.bone), { crop: false });
}
// the lid of a sarcophagus: gold and lapis, a painted face, crossed arms
function giantSlab() {
  return spritePx(40, 68, (g, P) => P.layer((g) => {
    const path = () => { g.beginPath(); g.moveTo(20, 3); g.bezierCurveTo(33, 3, 34, 14, 33, 22); g.lineTo(31, 58); g.quadraticCurveTo(20, 66, 9, 58); g.lineTo(7, 22); g.bezierCurveTo(6, 14, 7, 3, 20, 3); g.closePath(); };
    path(); g.fillStyle = '#d9a83a'; g.fill();
    g.save(); path(); g.clip();
    for (let y = 6; y < 66; y += 4.2) { g.fillStyle = (Math.floor(y / 4.2) % 2) ? '#2a4c9a' : '#e5b440'; g.fillRect(0, y, 7.5, 2.4); g.fillRect(32.5, y, 7.5, 2.4); }
    g.fillStyle = rad(g, 20, 15, 1, 8, [[0, '#f0c070'], [1, '#b8862a']]); g.beginPath(); g.ellipse(20, 15, 6.5, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#1c2a52'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(20 + s * 2.6, 13.5, 1.6, 0.9, 0, 0, TAU); g.fill(); }
    g.strokeStyle = '#1c2a52'; g.lineWidth = 1; g.beginPath(); g.moveTo(17, 19); g.lineTo(23, 19); g.stroke();
    for (let i = 3; i >= 0; i--) { g.fillStyle = ['#2a4c9a', '#e5b440', '#b0442a', '#e5b440'][i]; g.beginPath(); g.ellipse(20, 23 + i * 1.7, 12.5 - i * 0.6, 3.6, 0, 0, Math.PI); g.fill(); }
    g.restore();
    g.strokeStyle = 'rgba(70,45,10,0.7)'; g.lineWidth = 0.8;
    for (let y = 36; y < 56; y += 3.5) { g.beginPath(); g.moveTo(12, y); g.lineTo(28, y); g.stroke(); }
    g.fillStyle = '#2a4c9a'; for (let y = 37.5; y < 55; y += 3.5) for (let x = 13; x < 28; x += 4) g.fillRect(x, y, 1.6, 1.2);
  }, 2.4, OUTL.sand), { crop: false });
}
// the heap of sand a mummy pours into (art/deadRig.js): a low mound with ripples and grains, scraps of linen in it
function sandHeap() {
  return spritePx(52, 24, (g, P) => P.layer((g) => {
    const mound = () => { g.beginPath(); g.moveTo(3, 21); g.bezierCurveTo(9, 11, 18, 5.5, 26, 5.5); g.bezierCurveTo(34, 5.5, 42, 11, 49, 21); g.quadraticCurveTo(26, 23.5, 3, 21); g.closePath(); };
    mound(); g.fillStyle = lin(g, 0, 5, 0, 22, [[0, '#f0d9a4'], [0.55, '#d6b170'], [1, '#a9854f']]); g.fill();
    g.save(); mound(); g.clip();
    g.strokeStyle = 'rgba(150,112,62,0.55)'; g.lineWidth = 0.8;
    for (const [y, w] of [[10, 9], [13.5, 15], [17, 20]]) { g.beginPath(); g.moveTo(26 - w, y + 1.5); g.quadraticCurveTo(26, y - 1.2, 26 + w, y + 1.5); g.stroke(); }
    g.fillStyle = 'rgba(255,246,220,0.6)'; g.beginPath(); g.ellipse(21, 9, 7, 2.2, -0.15, 0, TAU); g.fill();
    for (let i = 0; i < 26; i++) { const x = 6 + ((i * 37) % 41), y = 9 + ((i * 53) % 12); g.fillStyle = i % 3 ? 'rgba(120,88,46,0.55)' : 'rgba(255,240,205,0.8)'; g.fillRect(x, y, 0.9, 0.9); }
    g.fillStyle = '#d9c9a2'; g.beginPath(); g.moveTo(31, 13); g.lineTo(40, 15.5); g.lineTo(39, 17.2); g.lineTo(30.5, 14.8); g.closePath(); g.fill(); // a scrap of linen
    g.strokeStyle = 'rgba(140,120,85,0.8)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(32, 14.2); g.lineTo(39.2, 16.3); g.stroke();
    g.restore();
  }, 1.6, OUTL.sand), { crop: false });
}
lazyDef('fx_sand_heap', sandHeap, 0.5, 0.88);
// (painted with the kind's parts: the heap a mummy pours into, the giants' throws)
DEAD_PARTS.mu.push('fx_sand_heap'); DEAD_PARTS.mg.push('fx_sand_heap', 'proj_giant_slab'); DEAD_PARTS.sg.push('proj_giant_bone');
lazyDef('proj_giant_bone', giantBone, 0.5, 0.5);
lazyDef('proj_giant_slab', giantSlab, 0.5, 0.5);
