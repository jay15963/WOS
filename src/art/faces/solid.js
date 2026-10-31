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
//
// Texturing is projective, as for the walls: a surface point gets the texel where the art of a view shows it.
//   - the piece's own facing view (the art drawn at 0°) textures the model: at 0° and as the yaw → 0 the faces are the
//     sprite pixel for pixel; tops always come from it, the front (and the front half of a lathe) too;
//   - each other side takes the art of the view that looks at it (<type>_n / _back, <type>_e / _side, w = e mirrored)
//     fitted part by part: views[letter].parts lists the same parts in that view's own art numbers (painters are not
//     always consistent between views); a view without its own list uses the main one. A view without art borrows
//     (spec.borrow): n 'mirror' (the front mirrored, default) · e / w 'front' (the front art as if that side were the
//     front, default: right for round / symmetric pieces) or 'edge' (the edge columns of the front stretched over the
//     side: boxes, crates).
//   - squashed art: some old art draws depth shorter than it is (chest lid, barrel top ellipse): k = art depth / true
//     depth of that view (default 1), piv = the ground row the squash is about (tiles from the anchor row; 0 = the
//     anchor = the front of the body; a lathe: its axis). The model has the true depth; near 0° it is squashed back
//     along the view by k, eased to k1 (default 1 = the true depth) over the first SQ_RAMP of yaw, so the 0° frame is
//     still the sprite. Round things keep the art's look at every angle with k1 = k (a squash along the view is the
//     same from all sides of a round thing).
// Other spec fields: V (anchor row, default 1), ow, foot (decor edge pieces: the art is drawn lower by its foot,
// archCompose.footOf), when(o) (false = not drawn by this kit, e.g. wall torches), state(o) → variant name and
// variants: { open: { s: sprite, only: true (no other views: they borrow it), k, parts… } }, fx: [{ at: [x, v, h],
// draw(B, A, o, t, x, y, lift, a) }] (flames / glows on their 3D spots, camera-facing like particles), light: [x, v, h]
// (the light pool, halo and smoke: default the first fx point), seat: [x, v, h] (where a sitter sits while turned),
// blob: false | [sx, sy, dy, a] (the contact shadow; default the painters' one). Points are in the 0° view's numbers
// (views[letter].fx / .light / .seat for a view drawn differently).
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
export const SQ_RAMP = 0.5; // yaw (radians) over which squashed art eases to the true depth
const OW = 2.6;             // the painters' outline (art/paint.js OW): px every part grows by (spec.ow)

const FI = { s: 0, w: 1, n: 2, e: 3 };             // view / facing index (= rot of a 'rotate' piece)
const VCX = [0, 1, 0, -1], VCY = [1, 0, -1, 0];  // local direction toward the camera of each view (r = (c.y, −c.x))

// ---------- the views of one object (scratch, rebuilt per build) ----------
// S sprite, m flip, c / r axes, a anchor (local), k / piv / V, spec (the art description: parts / fx), edge (borrow)
const FR = [0, 1, 2, 3].map(() => ({ S: null, m: 1, cx: 0, cy: 0, rx: 0, ry: 0, ax: 0, ay: 0, k: 1, k1: 1, piv: 0, V: 1, ow: 0, spec: null, own: false, edge: false }));
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
    const vs = from === 's' ? sp : (sp.views?.[from] || spec.views?.[from] || null);
    F.spec = vs && vs.parts ? vs : sp;
    F.k = vs?.k ?? sp.k ?? 1; F.piv = vs?.piv ?? sp.piv ?? 0; F.V = vs?.V ?? sp.V ?? 1; F.ow = vs?.ow ?? sp.ow ?? OW; F.k1 = vs?.k1 ?? sp.k1 ?? 1;
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
function artView(F, x, v, h) { VP.X = F.m * x / 64; VP.d = F.piv + (v - F.V - F.piv) / F.k; VP.h = h / 64; return VP; }

// ---------- the model (local tiles: origin = body centre on the ground, +y = the piece's front) ----------
// part: { t: 0 box / 1 lathe / 2 quad, x0 x1 y0 y1 h0 h1 (bbox), ax ay (lathe axis), pr (lathe profile: h, r pairs),
//         n (sides), q (quad corners), open, top, sh, z, fit: 4 views × 6 (sX oX sd od sh oh) }
function mkPart() { return { t: 0, x0: 0, x1: 0, y0: 0, y1: 0, h0: 0, h1: 0, ax: 0, ay: 0, pr: [], n: 12, q: [], open: false, top: '', sh: true, z: 0, card: false, fit: new Float32Array(24) }; }
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
  else { const [x, v, pr] = ps.lathe, q = pr.map(([h, r]) => [h, r + ow]); if (pr[0][0] <= 0.5) q.unshift([pr[0][0] - ow, pr[0][1] + ow]); g = { lathe: [x, v, q] }; }
  g.ow = ow;
  GROWN.set(ps, g);
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
    const [x, v, pr] = ps.lathe; let rm = 0, ha = 1e9, hb = -1e9;
    for (const [h, r] of pr) { if (r > rm) rm = r; if (h < ha) ha = h; if (h > hb) hb = h; }
    artView(F, x, v, 0); const R = rm / 64;
    X0 = VP.X - R; X1 = VP.X + R; d0 = VP.d - R; d1 = VP.d + R; h0 = ha / 64; h1 = hb / 64;
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
    p.open = !!ps.open; p.top = ps.top || ''; p.sh = ps.sh !== false; p.z = ps.z || 0; p.card = !!ps.card;
    ps = grown(ps, F.ow);
    const L = (x, v, h) => { artView(F, x, v, h); LP.x = F.ax + F.rx * VP.X + F.cx * VP.d; LP.y = F.ay + F.ry * VP.X + F.cy * VP.d; LP.h = VP.h; return LP; };
    if (ps.lathe) {
      const [x, v, pr] = ps.lathe;
      p.t = 1; L(x, v, 0); p.ax = LP.x; p.ay = LP.y; p.n = ps.n || 12;
      p.pr.length = 0; let rm = 0;
      for (const [h, r] of pr) { p.pr.push(h / 64, r / 64); if (r > rm) rm = r; }
      rm /= 64; p.x0 = p.ax - rm; p.x1 = p.ax + rm; p.y0 = p.ay - rm; p.y1 = p.ay + rm; p.h0 = p.pr[0]; p.h1 = p.pr[p.pr.length - 2];
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
  const F = FR[i], f = p.fit, o = i * 6, S = F.S;
  toView(F, x, y, h);
  const X = f[o] * VQ.X + f[o + 1], d = f[o + 2] * VQ.d + f[o + 3], hh = f[o + 4] * VQ.h + f[o + 5];
  CR.c = S.ax * S.pw + F.m * 64 * X;
  CR.r = S.ay * S.ph + 64 * (F.k * (d - F.piv) + F.piv - hh);
  return CR;
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
function pushQuad(i0, i1, i2, i3, S, flag, nx, ny) {
  const e = E;
  if (e.nq * 20 + 20 > e.q.length) { const g = new Float32Array(Math.max(e.q.length * 2, 400)); g.set(e.q); e.q = g; const gn = new Float32Array(g.length / 10); gn.set(e.qn); e.qn = gn; const gf = new Uint8Array(g.length / 20); gf.set(e.qf); e.qf = gf; }
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
// one planar face: corners PA[0..3] (local x, y, h) with their texels, clipped to the sprite's image → quads
function emitFace(S, flag, nx, ny) {
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
    PA[s + 3] = F.S.ax * F.S.pw + F.m * 64 * X;
    PA[s + 4] = F.S.ay * F.S.ph + 64 * (F.k * (d - F.piv) + F.piv - hh);
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
    const i = viewOf(nx, ny);
    if (FR[i].edge) texEdge(p, f, nx, ny, 4); else texCorners(p, i, 4);
    emitFace(FR[FR[i].edge ? f : i].S, flagPass, nx, ny);
  }
}
function boxTop(p, f) {
  if (p.top === 'none') return;
  PN = 4;
  corner(0, p.x0, p.y0, p.h1); corner(1, p.x1, p.y0, p.h1); corner(2, p.x1, p.y1, p.h1); corner(3, p.x0, p.y1, p.h1);
  if (p.top === 'strip') texStrip(p, f, 4); else texCorners(p, f, 4);
  emitFace(FR[f].S, 1, 0, 0);
}
function latheFaces(p, f) {
  const n = p.n, pr = p.pr, b = (f + 2) & 3, cfx = VCX[f], cfy = VCY[f];
  for (let j = 0; j < n; j++) {
    const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1), nx = Math.sin(am), ny = Math.cos(am);
    const i = nx * cfx + ny * cfy >= 0 ? f : b; // front half from the 0° view, back half from the opposite one
    for (let k = 0; k + 3 < pr.length; k += 2) {
      const ha = pr[k], ra = pr[k + 1], hb = pr[k + 2], rb = pr[k + 3];
      if (hb - ha < 1e-5) continue;
      PN = 4;
      corner(0, p.ax + rb * s0, p.ay + rb * c0, hb); corner(1, p.ax + rb * s1, p.ay + rb * c1, hb);
      corner(2, p.ax + ra * s1, p.ay + ra * c1, ha); corner(3, p.ax + ra * s0, p.ay + ra * c0, ha);
      texCorners(p, i, 4);
      emitFace(FR[i].S, 0, nx, ny);
    }
  }
  // the cap (an n-gon as a fan of quads), from the 0° view
  const ht = pr[pr.length - 2], rt = pr[pr.length - 1];
  if (rt <= 0) return;
  for (let j = 1; j + 1 < n; j += 2) {
    PN = 4;
    const ang = (q) => (q / n) * Math.PI * 2;
    const k3 = Math.min(j + 2, n - 1);
    corner(0, p.ax + rt * Math.sin(0), p.ay + rt * Math.cos(0), ht);
    corner(1, p.ax + rt * Math.sin(ang(j)), p.ay + rt * Math.cos(ang(j)), ht);
    corner(2, p.ax + rt * Math.sin(ang(j + 1)), p.ay + rt * Math.cos(ang(j + 1)), ht);
    corner(3, p.ax + rt * Math.sin(ang(k3)), p.ay + rt * Math.cos(ang(k3)), ht);
    texCorners(p, f, 4);
    emitFace(FR[f].S, 1, 0, 0);
  }
}
function quadFace(p, f) {
  PN = 4;
  for (let k = 0; k < 4; k++) corner(k, p.q[k * 3], p.q[k * 3 + 1], p.q[k * 3 + 2]);
  texCorners(p, f, 4);
  // its normal on the ground plane (a vertical-ish quad faces that way; a flat one is a top)
  const ux = p.q[3] - p.q[0], uy = p.q[4] - p.q[1], uh = p.q[5] - p.q[2], vx = p.q[9] - p.q[0], vy = p.q[10] - p.q[1], vh = p.q[11] - p.q[2];
  let nx = uy * vh - uh * vy, ny = uh * vx - ux * vh;
  const nh = ux * vy - uy * vx, L = Math.hypot(nx, ny);
  if (L < Math.abs(nh) * 0.35) emitFace(FR[f].S, 1, 0, 0);
  else { nx /= L; ny /= L; if (nx * VCX[f] + ny * VCY[f] < 0) { nx = -nx; ny = -ny; } emitFace(FR[f].S, 3, nx, ny); }
}

// ---------- per object ----------
const ENT = new WeakMap();
function mkEntry() {
  return { type: '', tx: NaN, ty: 0, rot: 0, x: 0, y: 0, cy: 0, lv: 0, st: '', S: [null, null, null, null], su: new Float32Array(8), ok: false,
    q: new Float32Array(400), qn: new Float32Array(40), qf: new Uint8Array(20), nq: 0, P: [], pq: [], pcx: [], pcy: [], pz: [],
    fpx: new Float32Array(4), fpy: new Float32Array(4), k0: 1, k1: 1, pvx: 0, pvy: 0, A: 0, fi: 0, h0: 0, sh: [], fx: [], lp: null, seat: null, f: 0, Sf: null, mf: 1 };
}
// the variant (state) of o
function stateOf(o, spec) { return spec.state ? spec.state(o) || '' : ''; }
function bodyOf(o, def) {
  if (def.edge) { const g = EDGE_GEOM[o.type] || def.eg || [0.5, 0.3]; BODY[0] = 2 * g[1]; BODY[1] = g[0]; BODY[2] = o.x; BODY[3] = o.cy ?? o.y; }
  else { const sz = def.size || [1, 1], fw = o.fw || sz[0], fh = o.fh || sz[1]; BODY[0] = sz[0]; BODY[1] = sz[1]; BODY[2] = o.tx + fw / 2; BODY[3] = o.ty + fh / 2; }
  return BODY;
}
const BODY = [1, 1, 0, 0];
function valid(e, o, st) {
  if (e.type !== o.type || e.tx !== o.tx || e.ty !== o.ty || e.rot !== (o.rot | 0) || e.x !== o.x || e.y !== o.y || e.lv !== (o.lv | 0) || e.st !== st || e.face !== o.face) return false;
  // lazy art moved / evicted (look atlas): rebuild; drawing them keeps them alive (K.ok stamps their last use)
  for (let i = 0; i < 4; i++) { const S = e.S[i]; if (!S || !K.ok(S) || S.u0 !== e.su[i * 2] || S.v0 !== e.su[i * 2 + 1]) return false; }
  return true;
}
function build(A, o, def, spec, st, e) {
  e.type = o.type; e.tx = o.tx; e.ty = o.ty; e.rot = o.rot | 0; e.x = o.x; e.y = o.y; e.lv = o.lv | 0; e.st = st; e.face = o.face; e.nq = 0; e.ok = false;
  const sp = st && spec.variants?.[st] ? { ...spec, ...spec.variants[st] } : spec;
  const [W, D, bx, by] = bodyOf(o, def);
  if (!views(A, o, spec, sp, W, D)) return e;
  const f = FI[o.face || 's'] ?? 0, Ff = FR[f];
  for (let i = 0; i < 4; i++) { e.S[i] = FR[i].S; e.su[i * 2] = FR[i].S.u0; e.su[i * 2 + 1] = FR[i].S.v0; }
  e.f = f; e.Sf = Ff.S; e.mf = Ff.m;
  e.A = f * Math.PI / 2; CA = Math.cos(e.A); SA = Math.sin(e.A); WX = bx; WY = by; e.h0 = H0 = (o.lv | 0) * STORY_H;
  const list = Ff.spec.parts;
  buildModel(Ff, list, e.P);
  for (let j = 0; j < e.P.length; j++) for (let i = 0; i < 4; i++) fitPart(e.P[j], j, i);
  // faces, part by part: far sides from inside (open), sides, tops
  E = e;
  e.pq.length = e.P.length + 1; e.pcx.length = e.pcy.length = e.pz.length = e.P.length;
  let gx0 = 1e9, gx1 = -1e9, gy0 = 1e9, gy1 = -1e9;
  for (let j = 0; j < e.P.length; j++) {
    const p = e.P[j];
    e.pq[j] = e.nq;
    if (p.t === 0) { if (p.open) boxFaces(p, f, 2); boxFaces(p, f, 0); boxTop(p, f); }
    else if (p.t === 1) latheFaces(p, f);
    else quadFace(p, f);
    const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
    e.pcx[j] = WX + CA * cx - SA * cy; e.pcy[j] = WY + SA * cx + CA * cy; e.pz[j] = p.h0 * 1e-3 + p.z;
    if (p.x0 < gx0) gx0 = p.x0; if (p.x1 > gx1) gx1 = p.x1; if (p.y0 < gy0) gy0 = p.y0; if (p.y1 > gy1) gy1 = p.y1;
  }
  e.pq[e.P.length] = e.nq;
  E = null;
  // footprint corners (depth), the squash pivot (0° view), shadows, fx points
  for (let c = 0; c < 4; c++) { const lx = c & 1 ? gx1 : gx0, ly = c & 2 ? gy1 : gy0; e.fpx[c] = WX + CA * lx - SA * ly; e.fpy[c] = WY + SA * lx + CA * ly; }
  e.k0 = Ff.k; e.k1 = Ff.k1;
  { const lx = Ff.ax + Ff.cx * Ff.piv, ly = Ff.ay + Ff.cy * Ff.piv; e.pvx = WX + CA * lx - SA * ly; e.pvy = WY + SA * lx + CA * ly; }
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
      e.sh.push(1, wx, wy, 0, 0, 0, 0, H0 + Ff.k * (VQ.d - Ff.piv) + Ff.piv);
    }
  }
  e.fx.length = 0;
  for (const fx of Ff.spec.fx || spec.fx || []) {
    artView(Ff, fx.at[0], fx.at[1], fx.at[2]);
    const lx = Ff.ax + Ff.rx * VP.X + Ff.cx * VP.d, ly = Ff.ay + Ff.ry * VP.X + Ff.cy * VP.d;
    e.fx.push(fx, WX + CA * lx - SA * ly, WY + SA * lx + CA * ly, H0 + VP.h);
  }
  const seat = Ff.spec.seat || sp.seat;
  if (seat) { artView(Ff, seat[0], seat[1], seat[2]); const lx = Ff.ax + Ff.rx * VP.X + Ff.cx * VP.d, ly = Ff.ay + Ff.ry * VP.X + Ff.cy * VP.d; e.seat = [WX + CA * lx - SA * ly, WY + SA * lx + CA * ly]; }
  else e.seat = null;
  const la = Ff.spec.light || spec.light;
  if (la) { artView(Ff, la[0], la[1], la[2]); const lx = Ff.ax + Ff.rx * VP.X + Ff.cx * VP.d, ly = Ff.ay + Ff.ry * VP.X + Ff.cy * VP.d; e.lp = [WX + CA * lx - SA * ly, WY + SA * lx + CA * ly]; }
  else e.lp = e.fx.length ? [e.fx[1], e.fx[2]] : null;
  e.ok = true;
  return e;
}
function entryOf(A, o) {
  const def = BUILDINGS[o.type], spec = SOLID[o.type];
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
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export function drawSolid(B, A, o, t) {
  const F = B.faces;
  if (!F) return false;
  const g = KIT_ENV.game, LV = g?.levels?.hasUpper ? g.levels : null, lv = o.lv | 0;
  if (LV && !lv && !o._ghost && LV.culled(o)) return true; // (under a slab: hidden, as for the sprites)
  if (lv && (o.alpha ?? 1) <= 0.02) return true;
  K.prep(A);
  const e = entryOf(A, o);
  if (!e) return drawPropTurned(B, A, o, t); // (art not painted yet: the old way meanwhile)
  const C = CAMV.c, S = CAMV.s, yaw = Math.atan2(S, C), R = smooth(Math.abs(yaw) / SQ_RAMP);
  const tn = tintOf(o), tr = tn[0], tg = tn[1], tb = tn[2], ta = tn[3];
  const bp = (o.progress != null && o.progress < 1) || !!o._ghost;
  // squash of the 0° view easing out, hit shake (sideways on the screen)
  const kk = e.k0 + (e.k1 - e.k0) * R, sq = Math.abs(kk - 1) > 1e-4, shk = o.shake > 0 ? Math.sin(t * 57) * 0.025 * o.shake : 0;
  const ccx = -S, ccy = C, mv = sq || shk !== 0;
  // parts back to front
  const np = e.P.length, one = np === 1;
  if (!one) { partsReset(); for (let j = 0; j < np; j++) part(-S * e.pcx[j] + C * e.pcy[j] + e.pz[j], j); }
  const q = e.q, qn = e.qn, qf = e.qf, PS = one ? null : partsSorted();
  for (let pi = 0; pi < np; pi++) {
    const j = one ? 0 : PS[pi].k;
    for (let n = e.pq[j]; n < e.pq[j + 1]; n++) {
      const fl = qf[n];
      let z = 1;
      if (fl !== 1) {
        const v = -S * qn[n * 2] + C * qn[n * 2 + 1];
        if (fl === 2 ? v > -0.02 : v <= 0.02) continue;
        z = 1 + (shade(qn[n * 2], qn[n * 2 + 1]) - 1) * R;
        if (fl === 2) z *= 0.72;
      }
      if (!mv) { F.quadF(q, n * 20, tr * z, tg * z, tb * z, ta); continue; }
      for (let k = 0; k < 20; k += 5) {
        let x = q[n * 20 + k], y = q[n * 20 + k + 1];
        if (sq) { const d = (kk - 1) * ((x - e.pvx) * ccx + (y - e.pvy) * ccy); x += d * ccx; y += d * ccy; }
        SCR[k] = x + shk * C; SCR[k + 1] = y + shk * S; SCR[k + 2] = q[n * 20 + k + 2]; SCR[k + 3] = q[n * 20 + k + 3]; SCR[k + 4] = q[n * 20 + k + 4];
      }
      F.quadF(SCR, 0, tr * z, tg * z, tb * z, ta);
    }
  }
  const T0 = K.tables(A);
  // contact shadow (as the painters: under the front of the footprint, fixed in the world) and sun shadows
  const bl = SOLID[o.type].blob;
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
  // flames / glows on their 3D spots (camera-facing like particles, anchored to the world point)
  if (!bp) for (let k = 0; k < e.fx.length; k += 4) e.fx[k].draw(B, A, o, t, e.fx[k + 1], e.fx[k + 2], e.fx[k + 3], ta);
  // (the scaffold while it is being built: a 3D frame around it, faces/scaffold.js via game.js)
  return true;
}
// depth: the front-most point of the model's footprint as the camera sees it (+ a bit per story)
export function solidDepth(o, rc, rs) {
  const e = ENT.get(o);
  let d = -1e9;
  if (e && e.ok && e.tx === o.tx && e.ty === o.ty && e.rot === (o.rot | 0) && e.type === o.type) {
    // (squashed along the view like the model)
    const yaw = Math.atan2(rs, rc), kk = e.k0 + (e.k1 - e.k0) * smooth(Math.abs(yaw) / SQ_RAMP), dp = -rs * e.pvx + rc * e.pvy;
    for (let c = 0; c < 4; c++) { const v = dp + kk * (-rs * e.fpx[c] + rc * e.fpy[c] - dp); if (v > d) d = v; }
  } else {
    const def = BUILDINGS[o.type];
    const [W, D, bx, by] = def ? bodyOf(o, def) : [1, 1, o.x, o.y];
    const fi = FI[o.face || 's'] ?? 0, a = (fi * Math.PI) / 2, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const ex = (ca * W + sa * D) / 2, ey = (sa * W + ca * D) / 2;
    d = -rs * bx + rc * by + Math.abs(rs) * ex + Math.abs(rc) * ey;
  }
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

// where someone sitting on it sits while turned (art/compose.js): [x, y, lift added]. At 0° the painters put the sitter
// at the anchor (o.y − 0.06, lifted 0.13) where the art shows the seat; turned, the seat of the model (spec.seat), with
// the lift that keeps the 0° look (eased in like the squash)
const SQ = [0, 0, 0];
export function solidSeatAt(o) {
  const e = ENT.get(o);
  if (!e || !e.ok || !e.seat) return null;
  const R = smooth(Math.abs(Math.atan2(CAMV.s, CAMV.c)) / SQ_RAMP), zx = o.x, zy = o.y - 0.06;
  SQ[0] = zx + R * (e.seat[0] - zx); SQ[1] = zy + R * (e.seat[1] - zy); SQ[2] = -R * (zy - e.seat[1]);
  return SQ;
}
// (dev / tests: the cached model of a piece, or null)
export function solidEntry(o) { return ENT.get(o) || null; }

export const SOLID_KIND = registerFaces({
  id: 'solid',
  prio: 1, // (before props.js: a type in the table leaves the billboards / folded art)
  test: (o, d) => {
    if (!d || !o.building) return false;
    const sp = SOLID[o.type];
    if (!sp || (sp.when && !sp.when(o))) return false;
    return !(d.mount && o._mount && (o.rot | 0) > 0);
  },
  draw: drawSolid,
  depth: solidDepth,
  lightAt: solidLightAt,
  seatAt: solidSeatAt,
});
