// Camera rotation — props (docs/CAMERA-ROTATION.md): furniture, stations, decoration, lights and world pieces built
// on a footprint, while the camera is turned. Two ways, both drawn by the pieces' own painters / art:
//
//  - billboard (1×1 pieces, round / upright things): the painter draws the piece as at 0° around its body centre and
//    every sprite it emits (art, contact shadow, sun shadow, flames, glows, smoke) is moved to the same place on the
//    screen relative to that centre (XB below): the piece stays where it stands, upright, its glows on its wicks.
//    A piece with a facing shows the side the camera sees (viewFacing: s / n / e / w art, mirrored like at 0°).
//  - folded art (multi-tile pieces: beds, tables, benches, stations, shelves, the ROT2 decor): the art of the side
//    the camera sees most is laid on the piece's own planes — a profile of the art's 3/4 view (PROF: back card,
//    top, front, ground, in the painter's own Y(v, h) numbers), so at the exact view it is the sprite pixel for
//    pixel and in between it turns as a solid piece (the top lies flat, the front stands); the side that shows is
//    the front of the art seen from that side. Flames / glows / smoke of the painter follow the same turn.
// Flat pieces (rugs, stepping stones, floors, farm plots) are not here: they lie on the ground and turn whole.
import { registerFaces, boxDepth } from './registry.js';
import { drawStatic } from '../composeWorld.js';
import { CAMV, KIT_ENV, archSprite } from '../archCompose.js';
import { BUILDINGS } from '../../game/content/buildings.js';
import { STORY_H } from '../../game/levels.js';

const FACE_I = { s: 0, w: 1, n: 2, e: 3 };            // facing index (= rot of a 'rotate' piece)
const FACE_N = ['s', 'w', 'n', 'e'];
const FV = [[0, 1], [-1, 0], [0, -1], [1, 0]];          // world vector of each facing
// edge pieces: [body depth along the facing, half width] (= game/mut/structures.js EDGE_GEOM, else def.eg)
const EDGE_GEOM = { chest: [0.56, 0.37], torch: [0.14, 0.08], chair_wood: [0.5, 0.26], flower_pot: [0.34, 0.2], banner: [0.3, 0.3], lamp_post: [0.3, 0.14] };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------- profiles of the art (folded art) ----------
// per sprite: p = [[v, h], …] from the top of the art down — v = ground row (tiles from the back edge of that view's
// footprint), h = height in px (the painter's Y(v, h) = E + 64v − h); above the first point the art is a card standing
// at its v, below the last one it lies on the ground. s = [xL, xR]: the box sides (tiles from the centre) — their
// faces get the front of the art seen from that side. Numbers read off the painters (art/stations.js, decor.js,
// buildings.js).
const P3 = (v0, v1, h, x0, x1, W = 128) => ({ p: [[v0, h], [v1, h], [v1, 0]], s: [(x0 - W / 2) / 64, (x1 - W / 2) / 64] });
const PE = (v0, v1, h, x0, x1) => P3(v0, v1, h, x0, x1, 64); // the 1-wide "_e" views
const CARD = (v) => ({ p: [[v, 0]] });
// a view whose art is a frame seen edge-on (rack / loom / drying rack from its end): kept upright (billboard) — on a
// card its depth-wise drawing would read as one tall pole
const BILL = null;
export const PROF = {
  // beds (buildings.js: bed 68 × 124 anchored on row 121 → Y = 64v − 7 − h; bed_e 132 wide)
  bed: { p: [[0.594, 9], [1.98, 9], [1.98, 0]], s: [-0.453, 0.453] },
  bed_n: { p: [[0.44, 9], [1.81, 9], [1.98, 20], [1.98, 0]], s: [-0.453, 0.453] },
  bed_e: { p: [[0.1, 13], [0.9, 13], [0.9, 0]], s: [-0.906, 0.9375] },
  // stations / furniture (stations.js)
  workbench: P3(0.2, 0.86, 30, 6, 122),
  workbench_n: { p: [[0.14, 30], [0.62, 30], [0.86, 46], [0.86, 0]], s: [-0.906, 0.906] },
  workbench_e: PE(0.1, 1.86, 30, 9, 55),
  stonecutter: P3(0.18, 0.86, 26, 6, 122),
  stonecutter_e: PE(0.12, 1.86, 26, 8, 56),
  loom: CARD(0.6), loom_n: CARD(0.6), loom_e: BILL,
  table_wood: P3(0.15, 0.85, 27, 8, 120),
  table_wood_e: PE(0.12, 1.86, 27, 10, 54),
  // decoration (decor.js)
  bookshelf: P3(0.55, 0.9, 68, 6, 122), bookshelf_e: PE(0.12, 1.88, 64, 18, 46),
  dresser: P3(0.5, 0.88, 30, 12, 116), dresser_e: PE(0.15, 1.85, 30, 14, 50),
  bench_wood: P3(0.32, 0.7, 16, 6, 122), bench_wood_e: PE(0.12, 1.88, 16, 20, 44),
  bench_stone: P3(0.32, 0.7, 16, 6, 122), bench_stone_e: PE(0.1, 1.9, 15, 18, 46),
  weapon_rack: CARD(0.55), weapon_rack_e: BILL,
  fireplace: { p: [[0.3, 60], [0.55, 60], [0.55, 30], [0.8, 30], [0.8, 0]], s: [-0.906, 0.906] },
  fireplace_e: PE(0.15, 1.85, 58, 10, 54),
  washtub: P3(0.5, 1.06, 22, 14, 114), washtub_e: PE(0.91, 2.29, 22, 12, 52),
  planter: P3(0.4, 0.8, 16, 8, 120), planter_e: PE(0.15, 1.85, 16, 18, 46),
  woodpile: P3(0.45, 0.75, 31, 8, 120), woodpile_e: PE(0.15, 1.85, 28, 16, 48),
  cart: P3(0.3, 0.7, 26, 10, 98), cart_e: PE(0.25, 1.6, 26, 14, 50),
  drying_rack: CARD(0.6), drying_rack_e: BILL,
};
// the front of a profile (its last standing segment): [v, h tiles] — what a side face shows of that view
function frontOf(P) {
  if (P._f !== undefined) return P._f;
  const p = P.p;
  let f = null;
  for (let i = p.length - 1; i > 0; i--) if (Math.abs(p[i][0] - p[i - 1][0]) < 1e-6 && p[i - 1][1] > p[i][1]) { f = [p[i][0], p[i - 1][1] / 64, p[i][1] / 64]; break; }
  P._f = f;
  return f;
}

// ---------- sprites by facing (the painters' rule: n = <type>_n else the base mirrored, e = <type>_e, w = e mirrored) ----------
let A0 = null;
const NAMES = new Map(); // type → [s, n, e] names that exist (null = none)
function sprite(A, n) { return n ? (A.has(n) ? A.get(n) : archSprite(A, n)) : null; }
function namesOf(A, type) {
  let L = NAMES.get(type);
  if (L && A0 === A) return L;
  if (A0 !== A) { NAMES.clear(); A0 = A; }
  const has = (n) => A.has(n) || !!archSprite(A, n) || PROF[n] !== undefined;
  L = [type, has(type + '_n') ? type + '_n' : null, has(type + '_e') ? type + '_e' : null];
  NAMES.set(type, L);
  return L;
}
// [name, flip] of the art for facing f
const VIEW = ['', 1];
function viewName(A, type, f) {
  const L = namesOf(A, type);
  if (f === 's') { VIEW[0] = L[0]; VIEW[1] = 1; }
  else if (f === 'n') { VIEW[0] = L[1] || L[0]; VIEW[1] = L[1] ? 1 : -1; }
  else { VIEW[0] = L[2] || L[0]; VIEW[1] = f === 'w' ? -1 : 1; }
  return VIEW;
}

// ---------- which pieces, and their frame ----------
function isProp(o, d) {
  if (!d || d.roof || d.connect || d.flat || d.layer === 'floor' || d.block === 'stairs') return false;
  if (d.mount && o._mount && (o.rot | 0) > 0) return false; // hung on a wall (faces/structures.js)
  return true;
}
const FR = { cx: 0, cy: 0, W: 1, D: 1, ev: 0.5, vf: 's', fi: 0, d: 0, ax: 0, ay: 0 };
// body centre, the facing the camera sees (vf) and the residual turn d (radians, −45°..45°: the art's view → the view)
function frame(o, def) {
  const rc = CAMV.c, rs = CAMV.s;
  const f = o.face || 's', fi = FACE_I[f] ?? 0, v = FV[fi];
  const vx = rc * v[0] + rs * v[1], vy = -rs * v[0] + rc * v[1];
  const vf = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'e' : 'w') : (vy > 0 ? 's' : 'n');
  const vi = FACE_I[vf], u = FV[vi];
  FR.vf = vf; FR.fi = fi;
  FR.d = Math.atan2(vy, vx) - Math.atan2(u[1], u[0]);
  if (FR.d > Math.PI) FR.d -= Math.PI * 2; else if (FR.d < -Math.PI) FR.d += Math.PI * 2;
  const side = vi & 1; // vf is e / w: the art's footprint is the piece's turned one
  if (def.edge) {
    const g = EDGE_GEOM[o.type] || def.eg || [0.5, 0.3];
    FR.cx = o.x; FR.cy = o.cy ?? o.y;
    // half extent down the screen of the body as the art of vf draws it: its depth seen from the front / back, its
    // half width seen from a side (= setGeom's anchor offsets at 0°)
    FR.ev = side ? g[1] : g[0] / 2;
    FR.W = 1; FR.D = 1;
  } else {
    const sz = def.size || [1, 1];
    const fw = o.fw || sz[0], fh = o.fh || sz[1];
    FR.cx = o.tx + fw / 2; FR.cy = o.ty + fh / 2;
    // the footprint as the art of vf draws it (a rotating piece's art for s / n is size w × h, for e / w h × w)
    if (def.rotate) { FR.W = side ? sz[1] : sz[0]; FR.D = side ? sz[0] : sz[1]; } else { FR.W = fw; FR.D = fh; }
    FR.ev = FR.D / 2;
  }
  return FR;
}

// ---------- the batch that moves what a painter draws (0° frame around the centre → the turned view) ----------
const X = { cx: 0, cy: 0, c: 1, s: 0, lift: 0, drop: null, rotAdd: 0, lx: 0, ly: 0 };
class XBatch {
  constructor(k) { this.k = k; this.t = null; }
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0, sc = 0) {
    if (!s || !this.t) return;
    if (X.drop && s === X.drop && this.k === 'main') return; // (the faces replace it; its sun shadow stays)
    const dx = x - X.cx, dy = y - X.cy;
    this.t.add(s, X.cx + X.c * dx - X.s * dy, X.cy + X.s * dx + X.c * dy, sx, sy, r, g, b, a, sway, this.k === 'blob' ? rot + X.rotAdd : rot, flash, flip, recv, lift + X.lift, sc);
  }
  addRaw(x, y, w, h, r, g, b, a) {
    if (!this.t) return;
    const dx = x - X.cx, dy = y - X.cy;
    this.t.addRaw(X.cx + X.c * dx - X.s * dy + X.lx, X.cy + X.s * dx + X.c * dy + X.ly, w, h, r, g, b, a);
  }
}
const KEYS = ['main', 'shadow', 'blob', 'emissive', 'fx', 'ground', 'decor', 'light'];
const XB = {};
for (const k of KEYS) XB[k] = new XBatch(k);
const SAVE = { x: 0, y: 0, face: '', tx: 0, ty: 0, fw: 0, fh: 0, cy: 0 };
// draw o with its painter as if it faced vf at 0°, centred on (cx, cy), everything turned by angle `ang` about the
// centre (the camera yaw: upright sprites keep facing the screen; + the residual turn for folded pieces)
function paint(B, A, o, t, fr, ang, h0, drop) {
  for (const k of KEYS) XB[k].t = B[k] || null;
  X.cx = fr.cx; X.cy = fr.cy; X.c = Math.cos(ang); X.s = Math.sin(ang); X.lift = h0; X.drop = drop;
  X.rotAdd = ang - Math.atan2(CAMV.s, CAMV.c); X.lx = CAMV.s * h0; X.ly = -CAMV.c * h0;
  const S = SAVE;
  S.x = o.x; S.y = o.y; S.face = o.face; S.tx = o.tx; S.ty = o.ty; S.fw = o.fw; S.fh = o.fh; S.cy = o.cy;
  const def = o.building ? true : false;
  try {
    // as at 0° facing vf: anchor at the bottom-centre of the body seen from vf (cosmetic, restored right below)
    o.x = fr.cx; o.y = fr.cy + fr.ev; o.cy = fr.cy;
    if (S.face) o.face = fr.vf;
    if (def && S.fw != null && fr.W != null) { o.fw = fr.W; o.fh = fr.D; o.tx = fr.cx - fr.W / 2; o.ty = fr.cy - fr.D / 2; }
    drawStatic(XB, A, o, t);
  } finally {
    o.x = S.x; o.y = S.y; o.face = S.face; o.tx = S.tx; o.ty = S.ty; o.fw = S.fw; o.fh = S.fh; o.cy = S.cy;
    for (const k of KEYS) XB[k].t = null;
  }
}

// ---------- folded art ----------
// blueprint / ghost / fade tint (the painters' setState)
const TN = [1, 1, 1, 1];
function tintOf(o) {
  const p = o.progress, bp = p != null && p < 1, a = o.alpha ?? 1;
  if (o._ghost) { if (o._ghost === 2) { TN[0] = 1.6; TN[1] = 0.42; TN[2] = 0.36; } else { TN[0] = 0.36; TN[1] = 0.78; TN[2] = 2.1; } TN[3] = a * 0.72; }
  else if (bp) { TN[0] = 0.34 * 1.15; TN[1] = 0.72 * 1.15; TN[2] = 2.0 * 1.15; TN[3] = a * (0.62 + 0.3 * clamp01(p)); }
  else { TN[0] = TN[1] = TN[2] = 1; TN[3] = a; }
  return TN;
}
const UV = [0, 0, 0, 0];
// atlas uv of a point of sprite s: dx tiles right of its anchor, up tiles above it (fl: mirrored)
const uOf = (s, dx, fl) => s.u0 + (s.u1 - s.u0) * (fl < 0 ? s.ax - dx / s.w : s.ax + dx / s.w);
const vOf = (s, up) => s.v0 + (s.v1 - s.v0) * (s.ay - up / s.h);
// local point of the art's frame (X right, V down the art's depth from the footprint centre) → world
let RC = 1, RS = 0, CX = 0, CY = 0;
const wx = (X, V) => CX + RC * X - RS * V;
const wy = (X, V) => CY + RS * X + RC * V;
// one strip of the art between two profile points (A above, B below on the art), across the whole sprite width
function strip(F, s, fl, D, va, ha, vb, hb, col, h0) {
  const xl = -s.ax * s.w, xr = (1 - s.ax) * s.w;
  const ua = uOf(s, xl, fl), ub = uOf(s, xr, fl);
  UV[0] = ua; UV[2] = ub; UV[1] = vOf(s, D - va + ha); UV[3] = vOf(s, D - vb + hb);
  const Va = va - D / 2, Vb = vb - D / 2;
  F.quad(wx(xl, Va), wy(xl, Va), h0 + ha, wx(xr, Va), wy(xr, Va), h0 + ha, wx(xr, Vb), wy(xr, Vb), h0 + hb, wx(xl, Vb), wy(xl, Vb), h0 + hb, UV, col[0], col[1], col[2], col[3]);
}
const SIDE_K = 0.82;
function drawFold(B, A, o, t, fr, h0) {
  const F = B.faces;
  if (!F) return false;
  const [name, fl] = viewName(A, o.type, fr.vf);
  const P = PROF[name], s = sprite(A, name);
  if (!P || !s) return false;
  const col = tintOf(o);
  const D = fr.D, ang = Math.atan2(CAMV.s, CAMV.c) + fr.d;
  RC = Math.cos(ang); RS = Math.sin(ang);
  const shk = o.shake > 0 ? Math.sin(t * 57) * 0.025 * o.shake : 0;
  CX = fr.cx + shk * CAMV.c; CY = fr.cy + shk * CAMV.s;
  const p = P.p, top = s.ay * s.h, bot = -(1 - s.ay) * s.h;
  // the sides that show (the art of the piece seen from that side: its front, stretched over the box side)
  const sd = P.s, fv = frontOf(P);
  if (sd && fv && p.length > 1) {
    const vi = FACE_I[fr.vf], fxL = fl < 0 ? -sd[1] : sd[0], fxR = fl < 0 ? -sd[0] : sd[1];
    const v0 = p[0][0], v1 = fv[0], hh = fv[1];
    for (const e of [1, -1]) { // +1: the art's right side (x = xR), −1: its left
      const nx = e * RC, ny = e * RS; // its outward normal in the world
      if (-CAMV.s * nx + CAMV.c * ny <= 0.02) continue;
      const [pn, pf] = viewName(A, o.type, FACE_N[(vi + (e > 0 ? 1 : 3)) % 4]);
      const Pp = PROF[pn], sp = sprite(A, pn), ff = Pp && frontOf(Pp);
      if (!sp || !ff || !Pp.s) continue;
      const Dp = fr.W; // that view's footprint depth = this one's width
      // its front: across its box, from its top down to the ground (left on the art = the near end of this side)
      let ua = uOf(sp, Pp.s[0], pf), ub = uOf(sp, Pp.s[1], pf);
      if (pf < 0) { ua = uOf(sp, -Pp.s[1], pf); ub = uOf(sp, -Pp.s[0], pf); }
      UV[0] = ua; UV[2] = ub; UV[1] = vOf(sp, Dp - ff[0] + ff[1]); UV[3] = vOf(sp, Dp - ff[0] + ff[2]);
      const xs = e > 0 ? fxR : fxL, Va = (e > 0 ? v1 : v0) - D / 2, Vb = (e > 0 ? v0 : v1) - D / 2, k = SIDE_K;
      F.quad(wx(xs, Va), wy(xs, Va), h0 + hh, wx(xs, Vb), wy(xs, Vb), h0 + hh, wx(xs, Vb), wy(xs, Vb), h0, wx(xs, Va), wy(xs, Va), h0, UV, col[0] * k, col[1] * k, col[2] * k, col[3]);
    }
  }
  // the art from the top down: the card above the first point, the profile's segments, the ground below the last
  {
    const [v, hp] = p[0], h = hp / 64, up = D - v + h;
    if (top > up + 1e-4) strip(F, s, fl, D, v, h + (top - up), v, h, col, h0);
  }
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i], b = p[i + 1], ha = a[1] / 64, hb = b[1] / 64;
    if ((D - a[0] + ha) - (D - b[0] + hb) > 1e-4) strip(F, s, fl, D, a[0], ha, b[0], hb, col, h0);
  }
  {
    const [v, hp] = p[p.length - 1], h = hp / 64, up = D - v + h;
    if (up > bot + 1e-4) strip(F, s, fl, D, v, h, v + (up - bot), h, col, h0);
  }
  // what else the painter draws (contact shadow, sun shadow, flames, glows, smoke, cracks…) turned the same way
  paint(B, A, o, t, fr, ang, h0, s);
  return true;
}

// ---------- open frames (pergola, garden arch): posts, beams and lattice at their own places ----------
// Pieces that are mostly air: a billboard would face the screen whole and a fold would lay the posts behind the
// lattice down flat. Their art is cut in parts (painter px / rows of the base sprite, frame W px wide, E px of headroom,
// D tiles deep): 'post' = a column of the art standing at each [x px, v] of `at`, always facing the camera (round
// enough); 'flat' = rows lying at height h (px) from ground row v0 to v1; 'card' = rows standing at ground row v.
const PARTS = {
  pergola: { W: 128, E: 70, D: 2, p: [
    { k: 'post', x0: 2, x1: 18, r0: Y0(70, 1.86, 74), r1: Y0(70, 1.86, 0), at: [[10, 0.18], [118, 0.18], [10, 1.86], [118, 1.86]] },
    { k: 'flat', x0: 0, x1: 128, r0: Y0(70, 0.04, 78), r1: Y0(70, 2.0, 78), v0: 0.04, v1: 2.0, h: 78 },
  ] },
  garden_arch: { W: 64, E: 92, D: 1, p: [
    { k: 'post', x0: 0, x1: 12, r0: Y0(92, 0.7, 72), r1: Y0(92, 0.7, -2), at: [[6, 0.7]] },
    { k: 'post', x0: 52, x1: 64, r0: Y0(92, 0.7, 72), r1: Y0(92, 0.7, -2), at: [[58, 0.7]] },
    { k: 'card', x0: 0, x1: 64, r0: 0, r1: Y0(92, 0.7, 72), v: 0.7 },
  ] },
};
function Y0(E, v, h) { return E + v * 64 - h; }
const PTS = [];
function drawParts(B, A, o, fr, h0) {
  const F = B.faces, Pt = PARTS[o.type];
  const s = F && Pt ? sprite(A, o.type) : null;
  if (!s) return false;
  const col = tintOf(o), c = CAMV.c, sn = CAMV.s, D = Pt.D;
  const mx = fr.cx, oy = fr.cy - D / 2; // (these pieces do not rotate: the art's frame is the world's; mx = its middle)
  const du = (x) => (x - Pt.W / 2) / 64, up = (r) => (Pt.E + 64 * D - r) / 64; // art px → tiles from the anchor
  const wxOf = (x) => mx + du(x);
  PTS.length = 0;
  for (const q of Pt.p) {
    if (q.k === 'post') for (const [x, v] of q.at) PTS.push([-sn * wxOf(x) + c * (oy + v) - 1e-3, q, x, v]);
    else PTS.push([-sn * mx + c * (oy + (q.k === 'flat' ? (q.v0 + q.v1) / 2 : q.v)), q, 0, 0]);
  }
  PTS.sort((a, b) => a[0] - b[0]); // farther first
  for (const [, q, x, v] of PTS) {
    UV[0] = uOf(s, du(q.x0), 1); UV[2] = uOf(s, du(q.x1), 1); UV[1] = vOf(s, up(q.r0)); UV[3] = vOf(s, up(q.r1));
    if (q.k === 'post') {
      const px = wxOf(x), py = oy + v, hw = (q.x1 - q.x0) / 128, ht = h0 + (Y0(Pt.E, v, 0) - q.r0) / 64, hb = h0 + (Y0(Pt.E, v, 0) - q.r1) / 64;
      F.quad(px - c * hw, py - sn * hw, ht, px + c * hw, py + sn * hw, ht, px + c * hw, py + sn * hw, hb, px - c * hw, py - sn * hw, hb, UV, col[0], col[1], col[2], col[3]);
    } else if (q.k === 'flat') {
      const x0 = wxOf(q.x0), x1 = wxOf(q.x1), y0 = oy + q.v0, y1 = oy + q.v1, h = h0 + q.h / 64;
      F.quad(x0, y0, h, x1, y0, h, x1, y1, h, x0, y1, h, UV, col[0], col[1], col[2], col[3]);
    } else {
      const x0 = wxOf(q.x0), x1 = wxOf(q.x1), y = oy + q.v, ht = h0 + (Y0(Pt.E, q.v, 0) - q.r0) / 64, hb = h0 + (Y0(Pt.E, q.v, 0) - q.r1) / 64;
      F.quad(x0, y, ht, x1, y, ht, x1, y, hb, x0, y, hb, UV, col[0], col[1], col[2], col[3]);
    }
  }
  // its contact shadow / sun shadow / sway from the painter, without the art itself
  paint(B, A, o, NOW, fr, Math.atan2(sn, c), h0, s);
  return true;
}
let NOW = 0;

// ---------- the kind ----------
const folded = (o, def) => (!!def.rotate && PROF[o.type] !== undefined) || PARTS[o.type] !== undefined;
export function drawPropTurned(B, A, o, t) {
  const def = BUILDINGS[o.type];
  if (!def) return false;
  const g = KIT_ENV.game, LV = g?.levels?.hasUpper ? g.levels : null;
  const lv = o.lv | 0;
  if (LV && !lv && !o._ghost && LV.culled(o)) return true; // (under a slab: hidden, as for the sprites)
  if (lv && (o.alpha ?? 1) <= 0.02) return true;
  const fr = frame(o, def), h0 = lv * STORY_H;
  NOW = t;
  if (PARTS[o.type] && drawParts(B, A, o, fr, h0)) return true;
  if (folded(o, def) && drawFold(B, A, o, t, fr, h0)) return true;
  paint(B, A, o, t, fr, Math.atan2(CAMV.s, CAMV.c), h0, null);
  return true;
}
// where a piece's light pool sits while turned (game.js adds the light's lift up the screen): its 0° anchor kept at
// the same place on the screen relative to the body centre, + its story
export function propLightAt(o) {
  const def = BUILDINGS[o.type];
  if (!def) return null;
  const fr = frame(o, def), c = CAMV.c, s = CAMV.s, dx = o.x - fr.cx, dy = o.y - fr.cy, h0 = (o.lv | 0) * STORY_H;
  LP[0] = fr.cx + c * dx - s * dy + s * h0; LP[1] = fr.cy + s * dx + c * dy - c * h0;
  return LP;
}
const LP = [0, 0];
// depth: a folded piece by the front-most point of its footprint; a billboard by its front as the camera sees it
export function propDepth(o, rc, rs) {
  const def = BUILDINGS[o.type];
  if (!def) return -rs * o.x + rc * o.y;
  if (folded(o, def)) return boxDepth(o, rc, rs);
  const fr = frame(o, def);
  return -rs * fr.cx + rc * fr.cy + fr.ev + (o.lv | 0) * 0.001;
}
export const PROP_KIND = registerFaces({
  id: 'prop',
  test: (o, d) => !!o.building && isProp(o, d),
  draw: drawPropTurned,
  depth: propDepth,
  lightAt: propLightAt,
});
