// Camera rotation — solid pieces (docs/CAMERA-ROTATION.md "Peças sólidas"): furniture, stations, lights and garden
// pieces drawn while the camera is turned as real 3D objects fixed in the world, textured from their own art like the
// walls. Only vegetation and creatures stay upright sprites.
//
// A piece type is DATA: defineSolid(type, spec) (tables in faces/solid*.js). Its parts are written in the painter's
// own numbers of its art: x = px from the art's centre column, v = ground row in tiles (the painters' Y(v, h) =
// E + 64v − h; the anchor row is v = V), h = px above the ground.
//   box:   [x0, x1, v0, v1, h0, h1]   (+ open: true = see-through: the far sides are drawn from inside too, so legs and
//          gaps cut out of the art show the legs behind; top: 'strip' (the front's top rows stretched) | 'none')
//   card:  [x0, x1, v, h0, h1]        a thin upright board (t: thickness px, default 3)
//   lathe: [x, v, [[h, r], …]]        a round thing (N-gon, n sides, default 12): radius r px at height h px, cap on top
//   quad:  [[x, v, h] × 4]            one sloped face (corners TL, TR, BR, BL), textured from the 0° view
// Per part also: sh: false (no sun shadow), z: depth bias (tiles) for the order of the parts. Every part grows by the
// art's dark outline (ow px, default 2.6) sideways, at the back of its top and below the ground.
//   px: [x, v, h]  every face of the part filled with the colour of that one point of the model's art (surfaces the art
//                  never shows: roof slopes); tilt: true  the part leans by spec.tilt(o, t) radians (sideways on the
//                  screen) about spec.tiltAt [x, v, h] (a training dummy's wobble, a scarecrow's sway)
//
// Texturing is projective, as for the walls: a surface point gets the texel where the art of a view shows it.
//   - the piece's own facing view (the art drawn at 0°) textures the model: tops always come from it, the front too
//     (a lathe: each quarter from the view facing it);
//   - each other side takes the art of the view that looks at it (<type>_n / _back, <type>_e / _side, w = e mirrored)
//     fitted part by part: views[letter].parts lists the same parts in that view's own art numbers (painters are not
//     always consistent between views); a view without its own list uses the main one. A view without art borrows
//     (spec.borrow): n 'mirror' (the front mirrored, default) · e / w 'front' (the front art as if that side were the
//     front, default: right for round / symmetric pieces) or 'edge' (the edge columns of the front stretched over the
//     side: boxes, crates).
//   - squashed art: some old art draws depth shorter than it is (a barrel's top ellipse): k = art depth / true depth of
//     that view (default 1: texture rows = k × depth), piv = the ground row the squash is about (tiles from the anchor
//     row; 0 = the anchor = the front of the body; a lathe: its axis). The model has the true depth at every angle, 0°
//     included (the sprite look is retired); round things may keep the art's flat look with k1 = k (the model squashed
//     along the view at every angle: the same from all sides of a round thing).
//   - dedicated face art (uv): a part's faces from rects of a texture painted in true proportions (the chest, CHEST_UV).
// Other spec fields: V (anchor row, default 1), ow, foot (decor edge pieces: the art is drawn lower by its foot,
// archCompose.footOf), when(o) (false = not drawn by this kit, e.g. wall torches), state(o) → variant name and
// variants: { open: { s: sprite, only: true (no other views: they borrow it), k, parts… } }, fx: [{ at: [x, v, h],
// draw(B, A, o, t, x, y, lift, a) }] (flames / glows on their 3D spots, camera-facing like particles), light: [x, v, h]
// (the light pool, halo and smoke: default the first fx point), seat: [x, v, h] (where a sitter sits while turned),
// blob: false | [sx, sy, dy, a] (the contact shadow; default the painters' one). Points are in the 0° view's numbers
// (views[letter].fx / .light / .seat for a view drawn differently).
// Placing: align 'center' (default for edge pieces) | 'back' (against the back edge: shelves, cabinets): the model moved
// into its body (the art does not always draw a piece where its body is). Per part: geo (the true size when the art
// draws it shorter: a bed reaching the wall), uv, cover (may hide a sitter / sleeper from behind: drawn after them),
// solo (every side from its own art: a board, a mirror), sx (a lathe stretched along x: an oval tub), top 'open' + band.
// Per type: seat / rest (sitter / sleeper points), decal [x, v, rx, ry, a] (the painter's dirt patch kept on the ground),
// fixed (drawn facing south whatever its facing: the banner), scale + hang(o) (art drawn scaled, the model that high:
// things hung on a wall standing free), pt (the part whose fit places the points), fx.always (drawn on blueprints too).
// More (faces/solidLights.js uses them): model: 'front'
// (the model always from the front art's parts, whatever way the piece faces; the other views only texture it) ·
// lift: px the painter draws the art above the piece's ground (wall-hung art; per part: that part's texture in the
// model's art only) · lathe lean: [px of art x, px of ground row] per px of height (a leaning axis: a wall torch, legs)
// · glow: { s: sprite, a(o, t) → strength (0 = off), parts: [indices], all: also the sides borrowing that art } —
// the glow art laid over those parts' faces like the art, to the glow layer (coals, lit glass, a furnace mouth) ·
// depth(o, rc, rs, d) → d (its own view depth). Variants may set blob / fx / light of their own.
// world: [w, d] — a world object that is not a building (a raider camp's tent / crate) drawn by this kit: its body
// (tiles), anchored at the middle of its front (o.x, o.y); a world object of a building type (the camp's campfire)
// takes the building's size. views.n may list the parts of a back borrowed from the front mirrored.
//
// Performance: the model, its UVs (clipped to the sprite's image: never samples atlas neighbours) and its world
// positions depend only on the piece, so they are built once per object (WeakMap; rebuilt when its place, rotation,
// state, story or a lazy sprite's place changes). Per frame: visibility, part order, colours (copy into B.faces).
import { registerFaces, boxDepth } from './registry.js';
import { CAMV, ARCH_FACES as K, KIT_ENV } from '../archCompose.js';
import { LAZY_DEFS } from '../lazyDefs.js';
import { BUILDINGS } from '../../game/content/buildings.js';
import { STORY_H } from '../../game/levels.js';
import { EDGE_GEOM, tintOf, drawPropTurned, propLightAt } from './props.js';
import { shade, shadowRect, shadowArt, partsReset, part, partsSorted } from './kit.js';

export const SOLID = Object.create(null);
export function defineSolid(type, spec) { SOLID[type] = spec; return spec; }
const OW = 2.6;             // the painters' outline (art/paint.js OW): px every part grows by (spec.ow)

const FI = { s: 0, w: 1, n: 2, e: 3 };             // view / facing index (= rot of a 'rotate' piece)
const VCX = [0, 1, 0, -1], VCY = [1, 0, -1, 0];  // local direction toward the camera of each view (r = (c.y, −c.x))

// ---------- the views of one object (scratch, rebuilt per build) ----------
// S sprite, m flip, c / r axes, a anchor (local), k / piv / V, spec (the art description: parts / fx), edge (borrow)
const FR = [0, 1, 2, 3].map(() => ({ S: null, m: 1, cx: 0, cy: 0, rx: 0, ry: 0, ax: 0, ay: 0, k: 1, k1: 1, piv: 0, V: 1, ow: 0, sc: 1, L: 0, lift: 0, spec: null, own: false, edge: false }));
const has = (A, n) => A.has(n) || LAZY_DEFS.has(n);
function spriteNamed(A, n) {
  const s = A.has(n) ? A.get(n) : K.tables(A).opt(n);
  return s && K.ok(s) ? s : null;
}
function baseSprite(A, o, sp) {
  const s = sp.s ? (A.has(sp.s) ? A.get(sp.s) : K.tables(A).opt(sp.s)) : K.spriteOf(A, o.type, o.v);
  return s && K.ok(s) ? s : null;
}
// fill FR[i] for object o (spec sp = the variant), body W × D; false = some art is not drawable yet
function views(A, o, spec, sp, W, D) {
  const type = o.type;
  for (let i = 0; i < 4; i++) {
    const F = FR[i];
    F.cx = VCX[i]; F.cy = VCY[i]; F.rx = F.cy; F.ry = -F.cx;
    let name = null, from = 's';
    if (sp.only) { /* (a state drawn by one art only: the other sides borrow it) */ }
    else if (i === 2) { name = sp.n || (has(A, type + '_n') ? type + '_n' : has(A, type + '_back') ? type + '_back' : null); from = name ? 'n' : 's'; }
    else if (i & 1) { name = sp.e || (has(A, type + '_e') ? type + '_e' : has(A, type + '_side') ? type + '_side' : null); from = name ? 'e' : 's'; }
    F.S = name ? spriteNamed(A, name) : baseSprite(A, o, sp);
    if (!F.S) return false;
    F.m = (i === 1 || (i === 2 && !name)) ? -1 : 1;
    F.own = !!name || i === 0;
    F.edge = !name && i !== 0 && (i === 2 ? spec.borrow?.n : spec.borrow?.e) === 'edge';
    // (a back borrowed from the front mirrored may still list its parts: views.n, in the front's numbers)
    const vs = from === 's' ? (i === 2 && (sp.views?.n || spec.views?.n)) || sp : (sp.views?.[from] || spec.views?.[from] || null);
    F.spec = vs && vs.parts ? vs : sp;
    F.k = vs?.k ?? sp.k ?? 1; F.piv = vs?.piv ?? sp.piv ?? 0; F.V = vs?.V ?? sp.V ?? 1; F.ow = vs?.ow ?? sp.ow ?? OW; F.k1 = vs?.k1 ?? sp.k1 ?? 1;
    F.lift = (vs?.lift ?? sp.lift ?? 0) / 64; // (art drawn lifted: a point at height h shows at h − lift)
    F.sc = sp.scale || 1; F.L = sp.hang ? sp.hang(o) : 0; // (art drawn scaled and the model hung that high: things hung on a wall standing free)
    if (from !== 's' && vs && vs.k === undefined) F.k = 1;
    if (from !== 's' && vs && vs.piv === undefined) F.piv = 0;
    if (from !== 's' && vs && vs.V === undefined) F.V = 1;
    // the painter's anchor: the bottom of the body seen from that side (+ a decor edge piece's foot)
    const ext = Math.abs(F.cx) * W / 2 + Math.abs(F.cy) * D / 2 + (spec.foot ? K.footOf(A, F.S) : 0);
    F.ax = F.cx * ext; F.ay = F.cy * ext;
  }
  return true;
}
// art numbers (x px, v tiles, h px) of view F → its view coordinates (X across, d toward the camera, h; tiles)
const VP = { X: 0, d: 0, h: 0 };
function artView(F, x, v, h) { VP.X = F.sc * F.m * x / 64; VP.d = F.sc * (F.piv + (v - F.V - F.piv) / F.k); VP.h = F.L + F.sc * h / 64; return VP; }
// view coordinates (X, d, h tiles) → image px of view F's art (artView's inverse) → CR; tl: a part's own lift (tiles)
function artPx(F, X, d, h, tl) {
  const S = F.S, q = 1 / F.sc;
  CR.c = S.ax * S.pw + F.m * 64 * X * q;
  CR.r = S.ay * S.ph + 64 * (F.k * (d * q - F.piv) + F.piv - (h - F.L) * q + F.lift + tl);
  return CR;
}

// ---------- the model (local tiles: origin = body centre on the ground, +y = the piece's front) ----------
// part: { t: 0 box / 1 lathe / 2 quad, x0 x1 y0 y1 h0 h1 (bbox), ax ay (lathe axis), pr (lathe profile: h, r pairs),
//         n (sides), q (quad corners), open, top, sh, z, fit: 4 views × 6 (sX oX sd od sh oh) }
function mkPart() { return { t: 0, x0: 0, x1: 0, y0: 0, y1: 0, h0: 0, h1: 0, ax: 0, ay: 0, lx: 0, ly: 0, tl: 0, pr: [], n: 12, q: [], open: false, top: '', band: 0, sh: true, z: 0, card: false, cover: false, uv: null, sx: 1, solo: false, px: null, tilt: false, fit: new Float32Array(24) }; }
// the art's dark outline (ow px around the silhouette) belongs to the solid: each part grows by it — sideways, its top's
// back edge, and below the ground for parts standing on it (a card's thin top covers the outline above it)
const GROWN = new WeakMap();
function grown(ps, ow) {
  if (!ow || ps.quad) return ps;
  let g = GROWN.get(ps);
  if (g && g.ow === ow) return g;
  const low = (h) => (h <= 0.5 ? h - ow : h);
  if (ps.box) { const b = ps.box; g = { box: [b[0] - ow, b[1] + ow, b[2] - ow / 64, b[3], low(b[4]), b[5]] }; }
  else if (ps.card) { const c = ps.card; g = { card: [c[0] - ow, c[1] + ow, c[2], low(c[3]), c[4]], t: ps.t }; }
  else { const [x, v, pr] = ps.lathe, q = pr.map(([h, r]) => [h, r + ow]); if (pr[0][0] <= 0.5) q.unshift([pr[0][0] - ow, pr[0][1] + ow]); g = { lathe: [x, v, q], lean: ps.lean, sx: ps.sx }; }
  g.ow = ow;
  GROWN.set(ps, g);
  return g;
}
const GEO = new WeakMap();
function geoOf(ps) {
  let g = GEO.get(ps);
  if (!g) { g = ps.box ? { box: ps.geo } : ps.card ? { card: ps.geo, t: ps.gt ?? ps.t } : ps.quad ? { quad: ps.geo } : { lathe: ps.geo }; GEO.set(ps, g); }
  return g;
}
// a part spec's bbox in view F's coordinates: [X0, X1, d0, d1, h0, h1]
const BB = new Float32Array(6);
function specBox(F, ps) {
  ps = grown(ps, F.ow);
  let X0 = 1e9, X1 = -1e9, d0 = 1e9, d1 = -1e9, h0 = 1e9, h1 = -1e9;
  const pt = (x, v, h) => { artView(F, x, v, h); if (VP.X < X0) X0 = VP.X; if (VP.X > X1) X1 = VP.X; if (VP.d < d0) d0 = VP.d; if (VP.d > d1) d1 = VP.d; if (VP.h < h0) h0 = VP.h; if (VP.h > h1) h1 = VP.h; };
  if (ps.box) { const b = ps.box; pt(b[0], b[2], b[4]); pt(b[1], b[3], b[5]); }
  else if (ps.card) { const c = ps.card, t = (ps.t ?? 3) / 128; pt(c[0], c[2] - t, c[3]); pt(c[1], c[2] + t, c[4]); }
  else if (ps.lathe) {
    const [x, v, pr] = ps.lathe, ln = ps.lean; let rm = 0, ha = 1e9, hb = -1e9;
    for (const [h, r] of pr) { if (r > rm) rm = r; if (h < ha) ha = h; if (h > hb) hb = h; }
    const R = rm / 64 * F.sc, RX = R * (ps.sx || 1);
    // (a leaning axis: its ends at the lowest and highest heights)
    for (const hh of ln ? [ha, hb] : [0]) {
      artView(F, ln ? x + ln[0] * hh : x, ln ? v + (ln[1] * hh) / 64 : v, 0);
      if (VP.X - RX < X0) X0 = VP.X - RX; if (VP.X + RX > X1) X1 = VP.X + RX; if (VP.d - R < d0) d0 = VP.d - R; if (VP.d + R > d1) d1 = VP.d + R;
    }
    h0 = F.L + F.sc * ha / 64; h1 = F.L + F.sc * hb / 64;
  } else if (ps.quad) for (const p of ps.quad) pt(p[0], p[1], p[2]);
  BB[0] = X0; BB[1] = X1; BB[2] = d0; BB[3] = d1; BB[4] = h0; BB[5] = h1;
  return BB;
}
// the model from the art of view F (the view the camera sees at 0°)
function buildModel(F, list, P) {
  P.length = list.length;
  for (let j = 0; j < list.length; j++) {
    const p = P[j] || (P[j] = mkPart());
    let ps = list[j];
    p.open = !!ps.open; p.top = ps.top || ''; p.band = ps.band || 6; p.sh = ps.sh !== false; p.z = ps.z || 0; p.card = !!ps.card; p.cover = !!ps.cover;
    p.n = ps.n || 12; p.tl = (ps.lift || 0) / 64; p.uv = ps.uv || null; p.solo = !!ps.solo; p.sx = ps.sx || 1;
    p.px = ps.px || null; p.tilt = !!ps.tilt;
    // geo: the part's true size (same format, these art numbers) when the art draws it shorter / smaller than the
    // footprint (a bed reaching the wall): the model is the geo, the art box only says where its texture is
    ps = ps.geo ? geoOf(ps) : p.uv ? ps : grown(ps, F.ow);
    const L = (x, v, h) => { artView(F, x, v, h); LP.x = F.ax + F.rx * VP.X + F.cx * VP.d; LP.y = F.ay + F.ry * VP.X + F.cy * VP.d; LP.h = VP.h; return LP; };
    p.lx = p.ly = 0;
    if (ps.lathe) {
      const [x, v, pr] = ps.lathe, ln = ps.lean;
      p.t = 1; L(x, v, 0); p.ax = LP.x; p.ay = LP.y;
      // lean [px of art x, px of ground row] per px of height → the axis's local shift per tile of height
      if (ln) { L(x + 64 * ln[0], v + ln[1], 0); p.lx = LP.x - p.ax; p.ly = LP.y - p.ay; }
      p.pr.length = 0; let rm = 0;
      for (const [h, r] of pr) { p.pr.push(h / 64, r / 64); if (r > rm) rm = r; }
      rm /= 64; p.h0 = p.pr[0]; p.h1 = p.pr[p.pr.length - 2];
      const xa = p.ax + p.lx * p.h0, xb = p.ax + p.lx * p.h1, ya = p.ay + p.ly * p.h0, yb = p.ay + p.ly * p.h1;
      p.x0 = Math.min(xa, xb) - rm * p.sx; p.x1 = Math.max(xa, xb) + rm * p.sx; p.y0 = Math.min(ya, yb) - rm; p.y1 = Math.max(ya, yb) + rm;
    } else if (ps.quad) {
      p.t = 2; p.q.length = 0; p.x0 = p.y0 = p.h0 = 1e9; p.x1 = p.y1 = p.h1 = -1e9;
      for (const c of ps.quad) { L(c[0], c[1], c[2]); p.q.push(LP.x, LP.y, LP.h); bbAdd(p, LP.x, LP.y, LP.h); }
    } else {
      const b = ps.box || null, c = ps.card || null, t = (ps.t ?? 3) / 128;
      p.t = 0; p.x0 = p.y0 = p.h0 = 1e9; p.x1 = p.y1 = p.h1 = -1e9;
      if (b) { L(b[0], b[2], b[4]); bbAdd(p, LP.x, LP.y, LP.h); L(b[1], b[3], b[5]); bbAdd(p, LP.x, LP.y, LP.h); }
      else { L(c[0], c[2] - t, c[3]); bbAdd(p, LP.x, LP.y, LP.h); L(c[1], c[2] + t, c[4]); bbAdd(p, LP.x, LP.y, LP.h); }
    }
  }
}
const LP = { x: 0, y: 0, h: 0 };
function bbAdd(p, x, y, h) { if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x; if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y; if (h < p.h0) p.h0 = h; if (h > p.h1) p.h1 = h; }
// an art point (x px, v, h px) of view F (index vi: the model's view) → a local model point (LP), through part j's fit
// (identity unless the part has a geo or the model was placed in its body)
function artLocal(e, F, vi, j, x, v, h) {
  artView(F, x, v, h);
  const f = e.P[j].fit, o = vi * 6;
  const X = (VP.X - f[o + 1]) / f[o], d = (VP.d - f[o + 3]) / f[o + 2], hh = (VP.h - f[o + 5]) / f[o + 4];
  LP.x = F.ax + F.rx * X + F.cx * d; LP.y = F.ay + F.ry * X + F.cy * d; LP.h = hh;
  return LP;
}
// view coordinates of a local point in view F
const VQ = { X: 0, d: 0, h: 0 };
function toView(F, x, y, h) { const dx = x - F.ax, dy = y - F.ay; VQ.X = dx * F.rx + dy * F.ry; VQ.d = dx * F.cx + dy * F.cy; VQ.h = h; return VQ; }
// fit part p (model) to its description in view i's art: per axis scale / offset (identity for the 0° view)
function fitPart(p, j, i) {
  const F = FR[i], ps = F.spec.parts[j], f = p.fit, o = i * 6;
  f[o] = 1; f[o + 1] = 0; f[o + 2] = 1; f[o + 3] = 0; f[o + 4] = 1; f[o + 5] = 0;
  if (!ps) return;
  const a = specBox(F, ps), A0 = a[0], A1 = a[1], D0 = a[2], D1 = a[3], H0 = a[4], H1 = a[5];
  // the model's bbox in this view
  let X0 = 1e9, X1 = -1e9, d0 = 1e9, d1 = -1e9;
  for (let c = 0; c < 4; c++) {
    toView(F, c & 1 ? p.x1 : p.x0, c & 2 ? p.y1 : p.y0, 0);
    if (VQ.X < X0) X0 = VQ.X; if (VQ.X > X1) X1 = VQ.X; if (VQ.d < d0) d0 = VQ.d; if (VQ.d > d1) d1 = VQ.d;
  }
  const lin = (m0, m1, t0, t1, k) => { const s = m1 - m0 > 1e-5 ? (t1 - t0) / (m1 - m0) : 1; f[o + k] = s; f[o + k + 1] = t0 - s * m0; };
  lin(X0, X1, A0, A1, 0); lin(d0, d1, D0, D1, 2); lin(p.h0, p.h1, H0, H1, 4);
}

// ---------- texels ----------
// image px (col, row) of local point (x, y, h) of part p seen in view i → CR
const CR = { c: 0, r: 0 };
function texel(p, i, x, y, h) {
  const F = FR[i], f = p.fit, o = i * 6;
  toView(F, x, y, h);
  return artPx(F, f[o] * VQ.X + f[o + 1], f[o + 2] * VQ.d + f[o + 3], f[o + 4] * VQ.h + f[o + 5], F.S === FR[MV].S ? p.tl : 0);
}

// ---------- faces → clipped quads ----------
// polygon scratch: (x, y, h, col, row) per vertex
const PA = new Float64Array(16 * 5), PB = new Float64Array(16 * 5);
let PN = 0;
function clipAxis(src, n, dst, k, lim, keepLess) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 5, b = ((i + 1) % n) * 5;
    const va = src[a + k], vb = src[b + k];
    const ina = keepLess ? va <= lim : va >= lim, inb = keepLess ? vb <= lim : vb >= lim;
    if (ina) { for (let q = 0; q < 5; q++) dst[m * 5 + q] = src[a + q]; m++; }
    if (ina !== inb) {
      const t = (lim - va) / (vb - va);
      for (let q = 0; q < 5; q++) dst[m * 5 + q] = src[a + q] + (src[b + q] - src[a + q]) * t;
      m++;
    }
  }
  return m;
}
// the entry being built, its quads / per-quad flags, and the world transform
let E = null, CA = 1, SA = 0, WX = 0, WY = 0, H0 = 0;
let GL = null; // (glow pass: the glow art the faces of the 0° view are drawn with)
let MV = 0;    // (the view the model is built from: a part's own lift moves its texture in that view only)
function pushQuad(i0, i1, i2, i3, S, flag, nx, ny) {
  const e = E;
  if (e.nq * 20 + 20 > e.q.length) {
    const g = new Float32Array(Math.max(e.q.length * 2, 400)); g.set(e.q); e.q = g;
    const gn = new Float32Array(g.length / 10); gn.set(e.qn); e.qn = gn;
    const gf = new Uint8Array(g.length / 20); gf.set(e.qf); e.qf = gf;
    const gm = new Uint8Array(g.length / 20); gm.set(e.qm); e.qm = gm;
    const gb = new Float32Array(g.length / 20 * 4); gb.set(e.qb); e.qb = gb;
  }
  e.qm[e.nq] = 0;
  const q = e.q, du = (S.u1 - S.u0) / S.pw, dv = (S.v1 - S.v0) / S.ph;
  let o = e.nq * 20;
  for (const i of [i0, i1, i2, i3]) {
    const s = i * 5, lx = PA[s], ly = PA[s + 1];
    q[o] = WX + CA * lx - SA * ly; q[o + 1] = WY + SA * lx + CA * ly; q[o + 2] = H0 + PA[s + 2];
    q[o + 3] = S.u0 + du * PA[s + 3]; q[o + 4] = S.v0 + dv * PA[s + 4];
    o += 5;
  }
  e.qn[e.nq * 2] = CA * nx - SA * ny; e.qn[e.nq * 2 + 1] = SA * nx + CA * ny; e.qf[e.nq] = flag;
  e.nq++;
}
// a part filled with one texel (part.px): its sprite and texel (null = off)
let PXS = null, PXC = 0, PXR = 0;
// one planar face: corners PA[0..3] (local x, y, h) with their texels, clipped to the sprite's image → quads
function emitFace(S, flag, nx, ny) {
  if (GL && S !== GL) return; // (glow pass: only the faces textured by the glow art)
  if (PXS) { S = PXS; for (let k = 0; k < PN; k++) { PA[k * 5 + 3] = PXC; PA[k * 5 + 4] = PXR; } }
  const W = S.pw - 0.5, Hh = S.ph - 0.5;
  let n = clipAxis(PA, PN, PB, 3, 0.5, false);
  n = clipAxis(PB, n, PA, 3, W, true);
  n = clipAxis(PA, n, PB, 4, 0.5, false);
  n = clipAxis(PB, n, PA, 4, Hh, true);
  if (n < 3) return;
  for (let k = 1; k + 1 < n; k += 2) pushQuad(0, k, k + 1, k + 2 < n ? k + 2 : k + 1, S, flag, nx, ny);
}
function corner(k, x, y, h) { const s = k * 5; PA[s] = x; PA[s + 1] = y; PA[s + 2] = h; }
// texels of the corners from view i (part p); edge: the side strip borrowed from the 0° view
function texCorners(p, i, n) {
  for (let k = 0; k < n; k++) { const s = k * 5; texel(p, i, PA[s], PA[s + 1], PA[s + 2]); PA[s + 3] = CR.c; PA[s + 4] = CR.r; }
}
// a side whose view has no art, borrowed as 'edge': the front's edge columns (view f) stretched along the side
function texEdge(p, f, nx, ny, n) {
  const F = FR[f], o = f * 6, fi = p.fit;
  // the part's front plane and its edge column in view f
  let X0 = 1e9, X1 = -1e9, dF = -1e9, dB = 1e9;
  for (let c = 0; c < 4; c++) { toView(F, c & 1 ? p.x1 : p.x0, c & 2 ? p.y1 : p.y0, 0); if (VQ.X < X0) X0 = VQ.X; if (VQ.X > X1) X1 = VQ.X; if (VQ.d > dF) dF = VQ.d; if (VQ.d < dB) dB = VQ.d; }
  const right = nx * F.rx + ny * F.ry > 0, Xe = right ? X1 : X0, inw = (right ? -3 : 3) / 64;
  for (let k = 0; k < n; k++) {
    const s = k * 5;
    toView(F, PA[s], PA[s + 1], PA[s + 2]);
    const t = dF - dB > 1e-5 ? (dF - VQ.d) / (dF - dB) : 0;
    const X = fi[o] * (Xe + inw * t) + fi[o + 1], d = fi[o + 2] * dF + fi[o + 3], hh = fi[o + 4] * VQ.h + fi[o + 5];
    artPx(F, X, d, hh, 0);
    PA[s + 3] = CR.c; PA[s + 4] = CR.r;
  }
}
// a top / card top as a strip: the front face's top rows (view f) stretched over it
function texStrip(p, f, n) {
  const F = FR[f];
  let dF = -1e9, dB = 1e9;
  for (let c = 0; c < 4; c++) { toView(F, c & 1 ? p.x1 : p.x0, c & 2 ? p.y1 : p.y0, 0); if (VQ.d > dF) dF = VQ.d; if (VQ.d < dB) dB = VQ.d; }
  for (let k = 0; k < n; k++) {
    const s = k * 5;
    toView(F, PA[s], PA[s + 1], PA[s + 2]);
    const t = dF - dB > 1e-5 ? (dF - VQ.d) / (dF - dB) : 0;
    // the point on the front plane, 0..2 px under the top edge
    const x = F.ax + F.rx * VQ.X + F.cx * dF, y = F.ay + F.ry * VQ.X + F.cy * dF;
    texel(p, f, x, y, p.h1 - (0.5 + 1.5 * t) / 64);
    PA[s + 3] = CR.c; PA[s + 4] = CR.r;
  }
}
// the view a vertical face with local normal (nx, ny) takes its art from
function viewOf(nx, ny) { return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 1 : 3) : (ny > 0 ? 0 : 2); }
// box sides: [nx, ny, corner selectors TL TR BR BL as (x1?, y1?)]
const SIDES = [[0, 1, 0, 1, 1, 1, 1, 1, 0, 1], [0, -1, 1, 0, 0, 0, 0, 0, 1, 0], [1, 0, 1, 1, 1, 0, 1, 0, 1, 1], [-1, 0, 0, 0, 0, 1, 0, 1, 0, 0]];
function boxFaces(p, f, flagPass) {
  for (const sd of SIDES) {
    const nx = sd[0], ny = sd[1];
    PN = 4;
    corner(0, sd[2] ? p.x1 : p.x0, sd[3] ? p.y1 : p.y0, p.h1); corner(1, sd[4] ? p.x1 : p.x0, sd[5] ? p.y1 : p.y0, p.h1);
    corner(2, sd[6] ? p.x1 : p.x0, sd[7] ? p.y1 : p.y0, p.h0); corner(3, sd[8] ? p.x1 : p.x0, sd[9] ? p.y1 : p.y0, p.h0);
    const i = p.solo ? f : viewOf(nx, ny); // (solo: a board / mirror / picture: every side from its own art)
    if (GL && FR[i].edge) continue;
    if (FR[i].edge) texEdge(p, f, nx, ny, 4); else texCorners(p, i, 4);
    emitFace(FR[FR[i].edge ? f : i].S, flagPass, nx, ny);
  }
}
function boxTop(p, f) {
  if (p.top === 'none') return;
  if (p.top === 'open') { openTop(p, f); return; }
  PN = 4;
  corner(0, p.x0, p.y0, p.h1); corner(1, p.x1, p.y0, p.h1); corner(2, p.x1, p.y1, p.h1); corner(3, p.x0, p.y1, p.h1);
  if (p.top === 'strip') texStrip(p, f, 4); else texCorners(p, f, 4);
  emitFace(FR[f].S, 1, 0, 0);
}
// ---------- dedicated face art (uv: a texture painted with each face in its true proportions, e.g. CHEST_UV) ----------
// part.uv = { s | n | e | w (sides: front +y, back, +x, −x local), t (top), i (inside walls of an open box), q (a quad):
// [c0, r0, c1, r1] px of the uv sprite, top-left → bottom-right as the face is seen from outside (reversed numbers
// mirror it; a 5th element 1 turns it a quarter: its width runs down the face) }
function uvCorners(S, r) {
  // (half a texel inside the rect: never the neighbour's border)
  const ia = r[0] < r[2] ? 0.5 : -0.5, ib = r[1] < r[3] ? 0.5 : -0.5;
  const c0 = r[0] + ia, c1 = r[2] - ia, r0 = r[1] + ib, r1 = r[3] - ib;
  if (r[4]) { PA[3] = c0; PA[4] = r1; PA[8] = c0; PA[9] = r0; PA[13] = c1; PA[14] = r0; PA[18] = c1; PA[19] = r1; }
  else { PA[3] = c0; PA[4] = r0; PA[8] = c1; PA[9] = r0; PA[13] = c1; PA[14] = r1; PA[18] = c0; PA[19] = r1; }
}
function uvBox(p, S, pass) {
  for (const sd of SIDES) {
    const r = pass === 2 ? p.uv.i : p.uv[sd[1] > 0 ? 's' : sd[1] < 0 ? 'n' : sd[0] > 0 ? 'e' : 'w'];
    if (!r) continue;
    PN = 4;
    corner(0, sd[2] ? p.x1 : p.x0, sd[3] ? p.y1 : p.y0, p.h1); corner(1, sd[4] ? p.x1 : p.x0, sd[5] ? p.y1 : p.y0, p.h1);
    corner(2, sd[6] ? p.x1 : p.x0, sd[7] ? p.y1 : p.y0, p.h0); corner(3, sd[8] ? p.x1 : p.x0, sd[9] ? p.y1 : p.y0, p.h0);
    uvCorners(S, r);
    pushQuad(0, 1, 2, 3, S, pass, sd[0], sd[1]);
  }
  if (pass === 0 && p.uv.t && p.top !== 'none') {
    PN = 4;
    corner(0, p.x0, p.y0, p.h1); corner(1, p.x1, p.y0, p.h1); corner(2, p.x1, p.y1, p.h1); corner(3, p.x0, p.y1, p.h1);
    uvCorners(S, p.uv.t);
    pushQuad(0, 1, 2, 3, S, 1, 0, 0);
  }
}
function uvQuad(p, S) {
  PN = 4;
  for (let k = 0; k < 4; k++) corner(k, p.q[k * 3], p.q[k * 3 + 1], p.q[k * 3 + 2]);
  uvCorners(S, p.uv.q);
  const ux = p.q[3] - p.q[0], uy = p.q[4] - p.q[1], uh = p.q[5] - p.q[2], vx = p.q[9] - p.q[0], vy = p.q[10] - p.q[1], vh = p.q[11] - p.q[2];
  let nx = uy * vh - uh * vy, ny = uh * vx - ux * vh;
  const nh = ux * vy - uy * vx, L = Math.hypot(nx, ny);
  if (L < Math.abs(nh) * 0.35) pushQuad(0, 1, 2, 3, S, 1, 0, 0);
  else { nx /= L; ny /= L; pushQuad(0, 1, 2, 3, S, 0, nx, ny); }
}

// the top of an open box (top: 'open', the chest with its lid up): art that draws the opening squashed (a few rows for
// the whole depth) would be stretched over the true depth once turned. Two quads (a front band `band` px deep, the
// rest): near 0° their rows are the projective ones (the sprite); turned, the front band shows those rows unstretched
// and the rest the darkest row behind them (drawSolid blends the rows with the squash: e.qm / e.qb)
function openTop(p, f) {
  const F = FR[f], S = F.S, cx = VCX[f], cy = VCY[f];
  const fa = cx ? (cx > 0 ? p.x1 : p.x0) : (cy > 0 ? p.y1 : p.y0), fz = cx ? (cx > 0 ? p.x0 : p.x1) : (cy > 0 ? p.y0 : p.y1);
  const L = Math.abs(fa - fz), sg = Math.sign(fa - fz) || 1, s0 = Math.min(L, p.band / 64), cut = fa - sg * s0;
  texel(p, f, cx ? fa : (p.x0 + p.x1) / 2, cy ? fa : (p.y0 + p.y1) / 2, p.h1);
  const rF = CR.r;
  texel(p, f, cx ? fz : (p.x0 + p.x1) / 2, cy ? fz : (p.y0 + p.y1) / 2, p.h1);
  const rM = Math.max(rF - p.band, CR.r + 0.5), dv = (S.v1 - S.v0) / S.ph;
  const clampC = (c) => (c < 0.5 ? 0.5 : c > S.pw - 0.5 ? S.pw - 0.5 : c), clampR = (r) => (r < 0.5 ? 0.5 : r > S.ph - 0.5 ? S.ph - 0.5 : r);
  for (let k = 0; k < 2; k++) {
    const a = k ? cut : fa, b = k ? fz : cut;
    if (Math.abs(a - b) < 1e-5) continue;
    PN = 4;
    if (cx) { corner(0, b, p.y0, p.h1); corner(1, b, p.y1, p.h1); corner(2, a, p.y1, p.h1); corner(3, a, p.y0, p.h1); }
    else { corner(0, p.x0, b, p.h1); corner(1, p.x1, b, p.h1); corner(2, p.x1, a, p.h1); corner(3, p.x0, a, p.h1); }
    texCorners(p, f, 4);
    for (let q = 0; q < 4; q++) { PA[q * 5 + 3] = clampC(PA[q * 5 + 3]); PA[q * 5 + 4] = clampR(PA[q * 5 + 4]); }
    pushQuad(0, 1, 2, 3, S, 1, 0, 0);
    const n = E.nq - 1;
    E.qm[n] = 1;
    // turned: rows by the distance from the front (1:1) down to rM, then rM
    for (let q = 0; q < 4; q++) {
      const s = Math.abs(fa - (cx ? PA[q * 5] : PA[q * 5 + 1]));
      E.qb[n * 4 + q] = S.v0 + dv * clampR(Math.max(rM, rF - 64 * s));
    }
  }
}
function latheFaces(p, f) {
  const n = p.n, pr = p.pr, lx = p.lx, ly = p.ly, X = p.sx; // (sx: an oval, stretched along local x)
  for (let j = 0; j < n; j++) {
    const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const s0 = Math.sin(a0) * X, c0 = Math.cos(a0), s1 = Math.sin(a1) * X, c1 = Math.cos(a1), nl = Math.hypot(Math.sin(am) / X, Math.cos(am)), nx = Math.sin(am) / X / nl, ny = Math.cos(am) / nl;
    const i = viewOf(nx, ny); // (each quarter from the view that looks at it, as a box's sides)
    for (let k = 0; k + 3 < pr.length; k += 2) {
      const ha = pr[k], ra = pr[k + 1], hb = pr[k + 2], rb = pr[k + 3];
      if (hb - ha < 1e-5) continue;
      PN = 4;
      const xa = p.ax + lx * ha, ya = p.ay + ly * ha, xb = p.ax + lx * hb, yb = p.ay + ly * hb; // (the axis at both heights)
      corner(0, xb + rb * s0, yb + rb * c0, hb); corner(1, xb + rb * s1, yb + rb * c1, hb);
      corner(2, xa + ra * s1, ya + ra * c1, ha); corner(3, xa + ra * s0, ya + ra * c0, ha);
      texCorners(p, i, 4);
      emitFace(FR[i].S, 0, nx, ny);
    }
  }
  // the cap (an n-gon as a fan of quads), from the 0° view
  const ht = pr[pr.length - 2], rt = pr[pr.length - 1], cx = p.ax + lx * ht, cy = p.ay + ly * ht;
  if (rt <= 0) return;
  for (let j = 1; j + 1 < n; j += 2) {
    PN = 4;
    const ang = (q) => (q / n) * Math.PI * 2;
    const k3 = Math.min(j + 2, n - 1);
    corner(0, cx, cy + rt, ht);
    corner(1, cx + rt * X * Math.sin(ang(j)), cy + rt * Math.cos(ang(j)), ht);
    corner(2, cx + rt * X * Math.sin(ang(j + 1)), cy + rt * Math.cos(ang(j + 1)), ht);
    corner(3, cx + rt * X * Math.sin(ang(k3)), cy + rt * Math.cos(ang(k3)), ht);
    texCorners(p, f, 4);
    emitFace(FR[f].S, 1, 0, 0);
  }
}
function quadFace(p, f) {
  PN = 4;
  for (let k = 0; k < 4; k++) corner(k, p.q[k * 3], p.q[k * 3 + 1], p.q[k * 3 + 2]);
  texCorners(p, f, 4);
  // its normal: a sloped quad faces up (outward = its upper side), a vertical one toward the 0° view; a slope under 45°
  // is seen from every side (the camera looks down at 45°): a top, else a side facing that way
  const ux = p.q[3] - p.q[0], uy = p.q[4] - p.q[1], uh = p.q[5] - p.q[2], vx = p.q[9] - p.q[0], vy = p.q[10] - p.q[1], vh = p.q[11] - p.q[2];
  let nx = uy * vh - uh * vy, ny = uh * vx - ux * vh, nh = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny);
  if (Math.abs(nh) > L * 0.02 ? nh < 0 : nx * VCX[f] + ny * VCY[f] < 0) { nx = -nx; ny = -ny; nh = -nh; }
  if (L < nh) emitFace(FR[f].S, 1, 0, 0);
  else if (nh > L * 0.02) emitFace(FR[f].S, 4, nx / nh, ny / nh); // (a steep slope: its normal × tan(slope); seen while v > −1)
  else { nx /= L; ny /= L; emitFace(FR[f].S, 3, nx, ny); }
}

// the glow art laid over part p like its art (spec.glow: a lit window, coals, a furnace mouth): the faces textured by the
// 0° view again with the glow sprite G (all: also the sides borrowing that art), flagged 8 (drawn to the glow layer)
const GSV = [null, null, null, null];
function glowPart(p, f, G, all) {
  const S0 = FR[f].S, n0 = E.nq;
  for (let i = 0; i < 4; i++) { GSV[i] = FR[i].S; if (i === f || (all && FR[i].S === S0 && !FR[i].edge)) FR[i].S = G; }
  GL = G;
  if (p.t === 0) { boxFaces(p, f, 0); boxTop(p, f); } else if (p.t === 1) latheFaces(p, f); else quadFace(p, f);
  GL = null;
  for (let i = 0; i < 4; i++) FR[i].S = GSV[i];
  for (let n = n0; n < E.nq; n++) E.qf[n] |= 8;
}

// ---------- per object ----------
const ENT = new WeakMap();
function mkEntry() {
  return { type: '', tx: NaN, ty: 0, rot: 0, x: 0, y: 0, cy: 0, lv: 0, st: '', S: [null, null, null, null], su: new Float32Array(8), ok: false,
    q: new Float32Array(400), qn: new Float32Array(40), qf: new Uint8Array(20), qm: new Uint8Array(20), qb: new Float32Array(80), nq: 0, P: [], pq: [], pcx: [], pcy: [], pz: [],
    fpx: new Float32Array(4), fpy: new Float32Array(4), k0: 1, k1: 1, pvx: 0, pvy: 0, A: 0, fi: 0, h0: 0, sh: [], fx: [], lp: null, seat: null, rest: null, f: 0, Sf: null, mf: 1, ga: null,
    // who sits / lies on it: parts flagged `cover` that are nearer the camera than this point (refx, refy) are drawn by
    // a drawable of their own right after the sitter (fd: game.js pushes it when fdOn); pf = per part, this frame
    nCover: 0, refx: 0, refy: 0, pf: new Uint8Array(8), fdOn: false, pend: false, fd: null,
    dc: null, // ground decal: [x, y, sx, sy, a] (art/faces/solid.js decal)
    US: null, uu: 0, uv0: 0, // dedicated face art of uv parts and its atlas place
    tpx: 0, tpy: 0, tph: null, // the lean pivot (spec.tilt)
  };
}
// the variant (state) of o
function stateOf(o, spec) { return spec.state ? spec.state(o) || '' : ''; }
function bodyOf(o, def, fixed) {
  if (def.edge) {
    const g = EDGE_GEOM[o.type] || def.eg || [0.5, 0.3];
    BODY[0] = 2 * g[1]; BODY[1] = g[0]; BODY[2] = o.x; BODY[3] = o.cy ?? o.y;
    if (fixed) BODY[1] = 2 * (o.y - BODY[3]); // (drawn facing south whatever its facing: anchored on o.y)
  }
  else if (o.tx == null) { const sz = def.size || [1, 1]; BODY[0] = sz[0]; BODY[1] = sz[1]; BODY[2] = o.x; BODY[3] = o.y - sz[1] / 2; } // (a world object: anchored at its front)
  else { const sz = def.size || [1, 1], fw = o.fw || sz[0], fh = o.fh || sz[1]; BODY[0] = sz[0]; BODY[1] = sz[1]; BODY[2] = o.tx + fw / 2; BODY[3] = o.ty + fh / 2; }
  return BODY;
}
const BODY = [1, 1, 0, 0];
// the body of a world object type that is not a building (spec.world = its size [w, d] in tiles)
const worldDef = (spec) => (spec && spec.world ? spec._wd || (spec._wd = { size: spec.world }) : null);
function valid(e, o, st) {
  if (e.type !== o.type || e.tx !== o.tx || e.ty !== o.ty || e.rot !== (o.rot | 0) || e.x !== o.x || e.y !== o.y || e.lv !== (o.lv | 0) || e.st !== st || e.face !== o.face) return false;
  // lazy art moved / evicted (look atlas): rebuild; drawing them keeps them alive (K.ok stamps their last use)
  for (let i = 0; i < 4; i++) { const S = e.S[i]; if (!S || !K.ok(S) || S.u0 !== e.su[i * 2] || S.v0 !== e.su[i * 2 + 1]) return false; }
  const U = e.US;
  if (U && (!K.ok(U) || U.u0 !== e.uu || U.v0 !== e.uv0)) return false;
  return true;
}
function build(A, o, def, spec, st, e) {
  e.type = o.type; e.tx = o.tx; e.ty = o.ty; e.rot = o.rot | 0; e.x = o.x; e.y = o.y; e.lv = o.lv | 0; e.st = st; e.face = o.face; e.nq = 0; e.ok = false;
  const sp = st && spec.variants?.[st] ? { ...spec, ...spec.variants[st] } : spec;
  const [W, D, bx, by] = bodyOf(o, def, spec.fixed);
  if (!views(A, o, spec, sp, W, D)) return e;
  const f = spec.fixed ? 0 : FI[o.face || 's'] ?? 0, Ff = FR[f];
  // the view the model is built from: the 0° one, or always the front (model: 'front' — the same shape whatever way the
  // piece faces; the other views' art only textures it, part by part)
  const Fm = sp.model === 'front' ? FR[0] : Ff;
  MV = Fm === Ff ? f : 0;
  const gs = sp.glow, G = gs ? spriteNamed(A, gs.s) : null;
  if (gs && !G) return e;
  e.ga = gs ? gs.a : null;
  for (let i = 0; i < 4; i++) { e.S[i] = FR[i].S; e.su[i * 2] = FR[i].S.u0; e.su[i * 2 + 1] = FR[i].S.v0; }
  e.f = f; e.Sf = Ff.S; e.mf = Ff.m;
  // the dedicated face art of uv parts (spec.uvS)
  const un = sp.uvS || spec.uvS;
  e.US = un ? spriteNamed(A, un) : null;
  if (un && !e.US) return e;
  if (e.US) { e.uu = e.US.u0; e.uv0 = e.US.v0; }
  e.A = f * Math.PI / 2; CA = Math.cos(e.A); SA = Math.sin(e.A); WX = bx; WY = by; e.h0 = H0 = (o.lv | 0) * STORY_H;
  const list = Fm.spec.parts;
  buildModel(Fm, list, e.P);
  // placed in its body (spec.align 'center', default for edge pieces, or 'back': against the back edge — shelves,
  // cabinets, racks): the art does not always draw a piece where its body is (a chair 0.2 tiles behind its front, a
  // bookshelf in the middle of its tile); against a wall it then reaches it without going through (the fits keep the art on it)
  const al = spec.align ?? (def.edge ? 'center' : null);
  if (al) {
    let a = 1e9, b = -1e9;
    for (const p of e.P) { if (p.y0 < a) a = p.y0; if (p.y1 > b) b = p.y1; }
    const sh = al === 'back' ? -D / 2 + 0.015 - a : -(a + b) / 2;
    if (Math.abs(sh) > 1e-4) for (const p of e.P) { p.y0 += sh; p.y1 += sh; p.ay += sh; for (let k = 1; k < p.q.length; k += 3) p.q[k] += sh; }
    // a model built from a side view's art (a chair facing east / west): that art's depth runs ACROSS the piece (local
    // x), drawn as off-centre there (a chair 0.23 tiles north of its body, its seat too): centred across as well
    if (MV & 1) {
      let c = 1e9, d = -1e9;
      for (const p of e.P) { if (p.x0 < c) c = p.x0; if (p.x1 > d) d = p.x1; }
      const sx = -(c + d) / 2;
      if (Math.abs(sx) > 1e-4) for (const p of e.P) { p.x0 += sx; p.x1 += sx; p.ax += sx; for (let k = 0; k < p.q.length; k += 3) p.q[k] += sx; }
    }
  }
  for (let j = 0; j < e.P.length; j++) for (let i = 0; i < 4; i++) fitPart(e.P[j], j, i);
  // faces, part by part: far sides from inside (open), sides, tops
  E = e;
  e.pq.length = e.P.length + 1; e.pcx.length = e.pcy.length = e.pz.length = e.P.length;
  let gx0 = 1e9, gx1 = -1e9, gy0 = 1e9, gy1 = -1e9;
  for (let j = 0; j < e.P.length; j++) {
    const p = e.P[j];
    e.pq[j] = e.nq;
    // (a part filled with one texel of the model's art)
    if (p.px) { const S0 = Fm.S; PXS = S0; PXC = S0.ax * S0.pw + Fm.m * p.px[0]; PXR = S0.ay * S0.ph + 64 * (p.px[1] - Fm.V + Fm.lift + p.tl) - p.px[2]; }
    if (p.t === 0 && p.uv) { if (p.open) uvBox(p, e.US, 2); uvBox(p, e.US, 0); }
    else if (p.t === 0) { if (p.open) boxFaces(p, f, 2); boxFaces(p, f, 0); boxTop(p, f); }
    else if (p.t === 1) latheFaces(p, f);
    else if (p.uv) uvQuad(p, e.US);
    else quadFace(p, f);
    PXS = null;
    if (G && (!gs.parts || gs.parts.includes(j))) glowPart(p, Fm === Ff ? f : 0, G, gs.all);
    const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
    e.pcx[j] = WX + CA * cx - SA * cy; e.pcy[j] = WY + SA * cx + CA * cy; e.pz[j] = p.h0 * 1e-3 + p.z;
    if (p.x0 < gx0) gx0 = p.x0; if (p.x1 > gx1) gx1 = p.x1; if (p.y0 < gy0) gy0 = p.y0; if (p.y1 > gy1) gy1 = p.y1;
  }
  e.pq[e.P.length] = e.nq;
  E = null;
  // footprint corners (depth), the squash pivot (0° view), shadows, fx points
  for (let c = 0; c < 4; c++) { const lx = c & 1 ? gx1 : gx0, ly = c & 2 ? gy1 : gy0; e.fpx[c] = WX + CA * lx - SA * ly; e.fpy[c] = WY + SA * lx + CA * ly; }
  // (the true depth at every angle, 0° included: k1 < 1 only for round things that keep the art's flat look everywhere)
  e.k0 = e.k1 = Ff.k1;
  // (points of the model view's art → the model, through part pt's fit: a geo stretch, the placing in the body → world)
  const pj = Math.min(spec.pt ?? 0, e.P.length - 1);
  { artLocal(e, Fm, MV, pj, 0, Fm.V + Fm.piv, 0); e.pvx = WX + CA * LP.x - SA * LP.y; e.pvy = WY + SA * LP.x + CA * LP.y; } // (the squash pivot)
  const tp = sp.tiltAt; // (the lean pivot of the tilt parts)
  if (tp) { artLocal(e, Fm, MV, pj, tp[0], tp[1], tp[2]); e.tpx = WX + CA * LP.x - SA * LP.y; e.tpy = WY + SA * LP.x + CA * LP.y; e.tph = H0 + LP.h; } else e.tph = null;
  e.sh.length = 0;
  for (const p of e.P) {
    if (!p.sh || p.h1 - p.h0 < 2 / 64) continue;
    if (p.t === 0) {
      // shadowRect: start of the footprint (middle of its back edge along local y), direction, width, length
      const cx = (p.x0 + p.x1) / 2, sx = WX + CA * cx - SA * p.y0, sy = WY + SA * cx + CA * p.y0;
      e.sh.push(0, sx, sy, e.A, p.x1 - p.x0, p.y1 - p.y0, p.h1 - Math.max(0, p.h0), H0 + Math.max(0, p.h0));
    } else if (p.t === 1) {
      // a round thing: the 0° art's silhouette across the sun, standing on its axis (lift: the art's ground above its anchor)
      const wx = WX + CA * p.ax - SA * p.ay, wy = WY + SA * p.ax + CA * p.ay;
      toView(Ff, p.ax, p.ay, 0);
      const da = p.fit[e.f * 6 + 2] * VQ.d + p.fit[e.f * 6 + 3]; // (the axis in the art: before a centring shift)
      e.sh.push(1, wx, wy, 0, 0, 0, 0, H0 + Ff.k * (da - Ff.piv) + Ff.piv);
    }
  }
  e.fx.length = 0;
  for (const fx of Fm.spec.fx || sp.fx || []) {
    artLocal(e, Fm, MV, pj, fx.at[0], fx.at[1], fx.at[2]);
    e.fx.push(fx, WX + CA * LP.x - SA * LP.y, WY + SA * LP.x + CA * LP.y, H0 + LP.h);
  }
  const seat = Fm.spec.seat || sp.seat;
  if (seat) { artLocal(e, Fm, MV, pj, seat[0], seat[1], seat[2]); e.seat = [WX + CA * LP.x - SA * LP.y, WY + SA * LP.x + CA * LP.y, LP.h]; }
  else e.seat = null;
  // where a sleeper's head lies (rest: the pillow): [x, y, h]
  const rs = Fm.spec.rest || sp.rest;
  if (rs) { artLocal(e, Fm, MV, pj, rs[0], rs[1], rs[2]); e.rest = [WX + CA * LP.x - SA * LP.y, WY + SA * LP.x + CA * LP.y, H0 + LP.h]; }
  else e.rest = null;
  // parts that may hide a sitter / sleeper (cover), compared with the seat, else the body centre
  e.nCover = 0;
  for (const p of e.P) if (p.cover) e.nCover++;
  if (e.pf.length < e.P.length) e.pf = new Uint8Array(e.P.length + 4);
  e.refx = e.seat ? e.seat[0] : WX; e.refy = e.seat ? e.seat[1] : WY;
  // a dirt patch the painter drew on the ground around the foot (ground(): kept on the ground, screen-aligned like
  // the art's round patch): [x px, v, rx px, ry px, alpha]
  const dc = Fm.spec.decal || sp.decal;
  if (dc) {
    artLocal(e, Fm, MV, pj, dc[0], dc[1], 0);
    e.dc = e.dc || new Float32Array(5);
    e.dc[0] = WX + CA * LP.x - SA * LP.y; e.dc[1] = WY + SA * LP.x + CA * LP.y; e.dc[2] = dc[2] / 32; e.dc[3] = dc[3] / 32; e.dc[4] = dc[4] ?? 0.3;
  } else e.dc = null;
  const la = Fm.spec.light || sp.light;
  if (la) { artLocal(e, Fm, MV, pj, la[0], la[1], la[2]); e.lp = [WX + CA * LP.x - SA * LP.y, WY + SA * LP.x + CA * LP.y]; }
  else e.lp = e.fx.length ? [e.fx[1], e.fx[2]] : null;
  e.bl = sp.blob; // (a variant's own contact shadow: a wall torch has none)
  e.ok = true;
  return e;
}
function entryOf(A, o) {
  const spec = SOLID[o.type], def = BUILDINGS[o.type] || worldDef(spec);
  if (!def || !spec) return null;
  const st = stateOf(o, spec);
  let e = ENT.get(o);
  if (e && e.ok && valid(e, o, st)) return e;
  if (!e) { e = mkEntry(); ENT.set(o, e); }
  build(A, o, def, spec, st, e);
  return e.ok ? e : null;
}

// ---------- draw ----------
const SCR = new Float32Array(20);
const BP_FLASH = 0.14; // (composeWorld: a blueprint's darks lifted a little, as its sprite)
// alpha with a hit flash for FACE_FS: 2 + 2·level + 0.25 + alpha / 2 (16 levels; robust to mediump varyings)
export function encA(a, fl) {
  if (!(fl > 0.03)) return a;
  const L = Math.min(15, Math.max(0, Math.round(fl * 16) - 1));
  return 2 + 2 * L + 0.25 + 0.5 * (a < 0 ? 0 : a > 1 ? 1 : a);
}
// the look of a piece this frame (shared by its two drawables): yaw, squash easing, shake, tint, flash
export const FS = { C: 1, S: 0, yaw: 0, R: 0, kk: 1, sq: false, shk: 0, mv: false, tr: 1, tg: 1, tb: 1, ta: 1, a: 1, fl: 0, bp: false, ga: 0, th: 0, tc: 1, ts: 0 };
function frameState(o, e, t) {
  // (faces at every angle, 0° included: no easing toward the sprite any more — the true depth, side shading and open
  // tops always; k1 < 1 only for round things that keep the art's flat look at every angle)
  const C = CAMV.c, S = CAMV.s, yaw = Math.atan2(S, C), R = 1;
  const tn = tintOf(o), bp = (o.progress != null && o.progress < 1) || !!o._ghost;
  FS.C = C; FS.S = S; FS.yaw = yaw; FS.R = R; FS.bp = bp;
  FS.tr = tn[0]; FS.tg = tn[1]; FS.tb = tn[2]; FS.ta = tn[3];
  FS.fl = bp ? BP_FLASH : o.flash || 0; FS.a = encA(tn[3], FS.fl);
  FS.ga = !bp && e.ga ? e.ga(o, t) : 0; // (glow art over the faces: its strength now, 0 = off)
  // squash of the 0° view easing out, hit shake (sideways on the screen)
  FS.kk = e.k1; FS.sq = Math.abs(FS.kk - 1) > 1e-4;
  FS.shk = o.shake > 0 ? Math.sin(t * 57) * 0.025 * o.shake : 0;
  FS.mv = FS.sq || FS.shk !== 0;
  // the lean of the tilt parts (spec.tilt: a dummy's wobble, a scarecrow's sway)
  const sp = SOLID[o.type], th = sp.tilt && e.tph != null ? sp.tilt(o, t) || 0 : 0;
  FS.th = th; FS.tc = Math.cos(th); FS.ts = Math.sin(th);
}
// the parts of e back to front: sel 0 = all, 1 = all but the covering parts in front (e.pf), 2 = only those
function emitParts(F, e, sel) {
  const C = FS.C, S = FS.S, R = FS.R, kk = FS.kk, sq = FS.sq, shk = FS.shk, ccx = -S, ccy = C;
  const tr = FS.tr, tg = FS.tg, tb = FS.tb, ta = FS.a;
  const np = e.P.length, one = np === 1;
  if (!one) { partsReset(); for (let j = 0; j < np; j++) part(-S * e.pcx[j] + C * e.pcy[j] + e.pz[j], j); }
  const q = e.q, qn = e.qn, qf = e.qf, qm = e.qm, PS = one ? null : partsSorted();
  const ga = FS.ga; // (glow art over the faces: its strength now, 0 = off)
  const th = FS.th, tc = FS.tc, ts = FS.ts;
  for (let pi = 0; pi < np; pi++) {
    const j = one ? 0 : PS[pi].k, tl = th !== 0 && e.P[j].tilt;
    if (sel && (sel === 2) !== (e.pf[j] === 1)) continue;
    for (let n = e.pq[j]; n < e.pq[j + 1]; n++) {
      const fl = qf[n] & 7, gw = qf[n] & 8;
      if (gw && ga <= 0) continue;
      let z = 1;
      if (fl !== 1) {
        const v = -S * qn[n * 2] + C * qn[n * 2 + 1];
        if (fl === 2 ? v > -0.02 : fl === 4 ? v <= -1 : v <= 0.02) continue;
        if (!gw) {
          const u = fl === 4 ? Math.hypot(qn[n * 2], qn[n * 2 + 1]) : 1; // (a steep slope: its unit normal)
          z = 1 + (shade(qn[n * 2] / u, qn[n * 2 + 1] / u) - 1) * R; if (fl === 2) z *= 0.72;
        }
      }
      const m = qm[n], ca = gw ? -ga * FS.ta : ta; // (a < 0: to the glow layer, FACE_FS; never on a blueprint, so untinted)
      if (!FS.mv && !m && !tl) { F.quadF(q, n * 20, tr * z, tg * z, tb * z, ca); continue; }
      for (let k = 0; k < 20; k += 5) {
        let x = q[n * 20 + k], y = q[n * 20 + k + 1], h = q[n * 20 + k + 2];
        if (sq) { const d = (kk - 1) * ((x - e.pvx) * ccx + (y - e.pvy) * ccy); x += d * ccx; y += d * ccy; }
        if (tl) { const u = (x - e.tpx) * C + (y - e.tpy) * S, w = h - e.tph, du = u * tc + w * ts - u; x += du * C; y += du * S; h = e.tph - u * ts + w * tc; }
        SCR[k] = x + shk * C; SCR[k + 1] = y + shk * S; SCR[k + 2] = h; SCR[k + 3] = q[n * 20 + k + 3];
        const v0 = q[n * 20 + k + 4];
        SCR[k + 4] = m ? v0 + R * (e.qb[n * 4 + k / 5] - v0) : v0; // (an open top: its rows once turned)
      }
      F.quadF(SCR, 0, tr * z, tg * z, tb * z, ca);
    }
  }
}
export function drawSolid(B, A, o, t) {
  const F = B.faces;
  if (!F) return false;
  const g = KIT_ENV.game, LV = g?.levels?.hasUpper ? g.levels : null, lv = o.lv | 0;
  if (LV && !lv && !o._ghost && LV.culled(o)) return true; // (under a slab: hidden, as for the sprites)
  if (lv && (o.alpha ?? 1) <= 0.02) return true;
  K.prep(A);
  const e = entryOf(A, o);
  if (!e) return drawPropTurned(B, A, o, t); // (art not painted yet: the old way meanwhile)
  frameState(o, e, t);
  const C = FS.C, S = FS.S, yaw = FS.yaw, kk = FS.kk, sq = FS.sq, ccx = -S, ccy = C, ta = FS.ta, bp = FS.bp;
  // someone may sit / lie on it: the covering parts nearer the camera than the seat wait for the drawable drawn right
  // after the sitter (game.js pushed it this frame: fdOn)
  let sel = 0;
  if (e.fdOn) {
    e.fdOn = false;
    const dr = -S * e.refx + C * e.refy + 0.04;
    let any = 0;
    for (let j = 0; j < e.P.length; j++) { const f = e.P[j].cover && -S * e.pcx[j] + C * e.pcy[j] > dr ? 1 : 0; e.pf[j] = f; any |= f; }
    if (any) { sel = 1; e.pend = true; }
  }
  const T0 = K.tables(A);
  // the painter's dirt patch around the foot: on the ground, squashed along the view like the model
  if (e.dc && B.ground && !lv) {
    const DS = decalSprite(T0);
    if (DS) {
      let x = e.dc[0], y = e.dc[1];
      if (sq) { const d = (kk - 1) * ((x - e.pvx) * ccx + (y - e.pvy) * ccy); x += d * ccx; y += d * ccy; }
      B.ground.add(DS, x, y, e.dc[2], e.dc[3], 1, 1, 1, e.dc[4] * ta, 0, -yaw, 0, 1, 1);
    }
  }
  emitParts(F, e, sel);
  // contact shadow (as the painters: under the front of the footprint, fixed in the world) and sun shadows
  const bl = e.bl;
  if (!lv && T0.blob && B.blob && bl !== false) {
    const w = o.fw || 1, h = o.fh || 1;
    if (bl) B.blob.add(T0.blob, o.x, o.y - (bl[2] || 0), bl[0], bl[1], 1, 1, 1, (bl[3] ?? 0.5) * ta, 0, -yaw);
    else B.blob.add(T0.blob, o.x, o.y - 0.06 - (h - 1) * 0.5, 0.62 + 0.38 * w, 0.4 + 0.6 * (h - 1), 1, 1, 1, 0.38 * ta, 0, -yaw);
  }
  if (!bp && B.shadow) {
    const sh = e.sh;
    for (let k = 0; k < sh.length; k += 8) {
      if (sh[k] === 0) {
        let px = sh[k + 1], py = sh[k + 2], W = sh[k + 4], L = sh[k + 5];
        if (sq) {
          // squashed with the model near 0°: its centre along the view, its side closest to the view shortened
          const a = sh[k + 3], ax = -Math.sin(a), ay = Math.cos(a), cx = px + ax * L / 2, cy = py + ay * L / 2;
          const d = (kk - 1) * ((cx - e.pvx) * ccx + (cy - e.pvy) * ccy), ux = cx + d * ccx, uy = cy + d * ccy;
          if (Math.abs(ax * ccx + ay * ccy) > 0.7) L *= kk; else W *= kk;
          px = ux - ax * L / 2; py = uy - ay * L / 2;
        }
        shadowRect(B, T0, px, py, sh[k + 3], W, L, sh[k + 6], ta, sh[k + 7]);
      }
      else shadowArt(B, e.Sf, sh[k + 1], sh[k + 2], Math.atan2(CAMV.lx, -CAMV.ly), e.mf < 0, ta, sh[k + 7]);
    }
  }
  // flames / glows / plants on their 3D spots (camera-facing like particles, anchored to the world point); `always`:
  // drawn on a blueprint / ghost too (tint and flash in FS)
  for (let k = 0; k < e.fx.length; k += 4) { const fx = e.fx[k]; if (!bp || fx.always) fx.draw(B, A, o, t, e.fx[k + 1], e.fx[k + 2], e.fx[k + 3], ta, FS); }
  // damage cracks (o.hp, as composeWorld's overlays) on the faces that show
  if (o.hp != null && o.maxHp > 0 && o.hp < o.maxHp * 0.75) {
    const r = o.hp / o.maxHp, cs = T0.opt('crack_' + (r < 0.25 ? 2 : r < 0.5 ? 1 : 0));
    if (cs) solidCracks(B, A, o, cs, 0.85 * ta, false, 0);
  }
  // (the scaffold while it is being built: a 3D frame around it, faces/scaffold.js via game.js)
  return true;
}
// the covering parts in front of whoever sits / lies on it (game.js: a drawable right after the sitter)
function drawFront(B, A, t) {
  const o = this.o, e = ENT.get(o);
  if (!e || !e.pend || !B.faces) return;
  e.pend = false;
  frameState(o, e, t);
  emitParts(B.faces, e, 2);
}
function frontZ() { return (this.o._zk ?? 0) + 0.03; }
// game.js (camera turned): the extra drawable of a piece with covering parts, or null
export function solidFront(o) {
  const e = ENT.get(o);
  if (!e || !e.ok || !e.nCover) return null;
  e.fdOn = true;
  const d = e.fd || (e.fd = { o, draw: drawFront, zkRot: frontZ, x: 0, y: 0, _zk: 0 });
  d.x = o.x; d.y = o.y;
  return d;
}
// the generic dirt patch (art/decor.js ground(): a radial brown fade) as a 64 px sprite, drawn scaled to rx × ry
function decalSprite(T) {
  const s = T.opt ? T.opt('decal_dirt') : null;
  return s && K.ok(s) ? s : null;
}
// cracks on a damaged piece (o.hp; fx/rockfx.js siege damage): the crack sprite over each box side that shows and its
// top; a round part: a card through its axis facing the camera
const CUV = [0, 0, 0, 0];
export function solidCracks(B, A, o, s, alpha, flip, sh) {
  const F = B.faces, e = ENT.get(o);
  if (!F || !s || !e || !e.ok || !K.ok(s)) return;
  CUV[0] = flip ? s.u1 : s.u0; CUV[2] = flip ? s.u0 : s.u1; CUV[1] = s.v0; CUV[3] = s.v1;
  const C = CAMV.c, S = CAMV.s, ca = Math.cos(e.A), sa = Math.sin(e.A);
  const [, , bx, by] = bodyOf(o, BUILDINGS[o.type] || worldDef(SOLID[o.type]), SOLID[o.type]?.fixed);
  const ox = bx + sh * C, oy = by + sh * S;
  const wx = (lx, ly) => ox + ca * lx - sa * ly, wy = (lx, ly) => oy + sa * lx + ca * ly;
  for (const p of e.P) {
    if (p.h1 - p.h0 < 6 / 64) continue;
    const h0 = e.h0 + Math.max(0, p.h0), h1 = e.h0 + p.h1;
    if (p.t === 1) {
      const px = wx(p.ax, p.ay), py = wy(p.ax, p.ay), r = (p.x1 - p.x0) / 2;
      F.quad(px - C * r, py - S * r, h1, px + C * r, py + S * r, h1, px + C * r, py + S * r, h0, px - C * r, py - S * r, h0, CUV, 1, 1, 1, alpha);
      continue;
    }
    for (const sd of SIDES) {
      const nx = ca * sd[0] - sa * sd[1], ny = sa * sd[0] + ca * sd[1];
      if (-S * nx + C * ny <= 0.02) continue;
      const ax = sd[2] ? p.x1 : p.x0, ay = sd[3] ? p.y1 : p.y0, bx2 = sd[4] ? p.x1 : p.x0, by2 = sd[5] ? p.y1 : p.y0, z = shade(nx, ny);
      F.quad(wx(ax, ay), wy(ax, ay), h1, wx(bx2, by2), wy(bx2, by2), h1, wx(bx2, by2), wy(bx2, by2), h0, wx(ax, ay), wy(ax, ay), h0, CUV, z, z, z, alpha);
    }
    if (p.top !== 'none') F.quad(wx(p.x0, p.y0), wy(p.x0, p.y0), h1, wx(p.x1, p.y0), wy(p.x1, p.y0), h1, wx(p.x1, p.y1), wy(p.x1, p.y1), h1, wx(p.x0, p.y1), wy(p.x0, p.y1), h1, CUV, 1, 1, 1, alpha);
  }
}
// depth: the front-most point of the model's footprint as the camera sees it (+ a bit per story)
export function solidDepth(o, rc, rs) {
  const e = ENT.get(o);
  let d = -1e9;
  if (e && e.ok && e.tx === o.tx && e.ty === o.ty && e.rot === (o.rot | 0) && e.type === o.type) {
    // (squashed along the view like the model)
    const kk = e.k1, dp = -rs * e.pvx + rc * e.pvy;
    for (let c = 0; c < 4; c++) { const v = dp + kk * (-rs * e.fpx[c] + rc * e.fpy[c] - dp); if (v > d) d = v; }
  } else {
    const def = BUILDINGS[o.type] || worldDef(SOLID[o.type]);
    const [W, D, bx, by] = def ? bodyOf(o, def) : [1, 1, o.x, o.y];
    const fi = FI[o.face || 's'] ?? 0, a = (fi * Math.PI) / 2, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const ex = (ca * W + sa * D) / 2, ey = (sa * W + ca * D) / 2;
    d = -rs * bx + rc * by + Math.abs(rs) * ex + Math.abs(rc) * ey;
  }
  const sp = SOLID[o.type];
  if (sp && sp.depth) d = sp.depth(o, rc, rs, d); // (e.g. a wall torch: right after the face of the wall it hangs on)
  // (on an upper story: never before the floor tiles it stands on — levels.js floorUp sorts by its tile's front)
  return (o.lv | 0) > 0 ? Math.max(d + (o.lv | 0) * 0.001, boxDepth(o, rc, rs)) : d;
}
// where its light pool / halo / smoke sit while turned (the ground point under its light; + its story up the screen)
const LQ = [0, 0];
export function solidLightAt(o) {
  const e = ENT.get(o);
  if (!e || !e.ok || !e.lp) return propLightAt(o);
  const h0 = e.h0;
  LQ[0] = e.lp[0] + CAMV.s * h0; LQ[1] = e.lp[1] - CAMV.c * h0;
  return LQ;
}

// where someone sitting on it sits (art/compose.js): [x, y, lift added] — on the seat of the model (spec.seat), the
// sitting body's bottom on the seat's height: the rig adds 0.13 to its base and its bottom is PELVIS above that base
// (measured on the wooden chair, whose 0° sprite showed the sitter right on the seat)
const SQ = [0, 0, 0], PELVIS = 0.476;
export function solidSeatAt(o) {
  const e = ENT.get(o);
  if (!e || !e.ok || !e.seat) return null;
  SQ[0] = e.seat[0]; SQ[1] = e.seat[1]; SQ[2] = e.h0 + e.seat[2] - PELVIS - 0.13; // (a story up: this replaces the lifted spot game.js gave the pawn)
  return SQ;
}
// where a sleeper's head lies (art/compose.js): [x, y, h] on the pillow of the model, and the bed's world angle
const RQ = [0, 0, 0, 0];
export function solidRestAt(o) {
  const e = ENT.get(o);
  if (!e || !e.ok || !e.rest) return null;
  RQ[0] = e.rest[0]; RQ[1] = e.rest[1]; RQ[2] = e.rest[2]; RQ[3] = e.A;
  return RQ;
}
// (dev / tests: the cached model of a piece, or null)
export function solidEntry(o) { return ENT.get(o) || null; }

export const SOLID_KIND = registerFaces({
  id: 'solid',
  prio: 1, // (before props.js: a type in the table leaves the billboards / folded art)
  test: (o, d) => {
    const sp = SOLID[o.type];
    if (!sp || (sp.when && !sp.when(o))) return false;
    // (a world object — a raider camp's tent, crate, campfire — of a type in the table: drawn the same way)
    if (!o.building) return !!(sp.world || BUILDINGS[o.type]);
    if (!d) return false;
    return !(d.mount && o._mount && (o.rot | 0) > 0);
  },
  draw: drawSolid,
  depth: solidDepth,
  lightAt: solidLightAt,
  seatAt: solidSeatAt,
  restAt: solidRestAt,
  front: solidFront,   // (game.js: the covering parts drawn after a sitter / sleeper)
  cracks: solidCracks, // (fx/rockfx.js: siege cracks on the faces)
});
