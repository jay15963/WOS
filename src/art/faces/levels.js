// Camera rotation — levels (docs/CAMERA-ROTATION.md, docs/LEVELS.md): stairs, upper floors, the rest of an upper story.
//   stairs     the real stair art (art/stairs.js) on computed faces: treads and risers from stairs_wood, the stringer
//              profile on the side faces from stairs_wood_e, the end face of the high end from stairs_wood_n; posts,
//              handrails and legs as thin boxes in the plank palette. Two parts, so whoever climbs it sorts between
//              them: the back (far stringer, steps) with the stair itself, the front (near stringer, its handrail and
//              legs, the end face) as a drawable of its own (game/levels.js collects it while the camera is turned and
//              sorts the people on a stair between both: Levels.zkRot).
//   floorUp    an upper floor: its own flat layers laid at its story's height, the slab beam (slab_edge) on the open
//              sides that face the camera, the blue plan grid of a blueprint.
//   upperSprite the rest of an upper story (furniture, decor…) stays a sprite (levels.drawUpper lifts it straight up
//              the screen): only its depth, just above the slab under it.
// Inside a stair the faces are sorted by a key built from height bands (one per step rise): at any pixel the higher
// of two surfaces is the nearer one (the view looks down at 45°), so a face that never crosses a band boundary can be
// ordered by the band it sits in; the stringer side faces, posts, legs and rails are clipped to the bands.
import { registerFaces, boxDepth } from './registry.js';
import { shade as faceShade } from './kit.js';
import { CAMV, KIT_ENV, archSprite } from '../archCompose.js';
import { STAIR_ART as SA } from '../stairs.js';
import { WALL_H } from '../structures.js';
import { drawStatic } from '../composeWorld.js';
import { BUILDINGS } from '../../game/content/buildings.js';

const STORY_H = WALL_H; // (= game/levels.js STORY_H; not imported from there: game/levels.js imports this module)
const PX = 1 / 64;
const LEN = SA.D * PX, RISE = SA.RISE * PX, NS = SA.N, SD = LEN / NS, RS = RISE / NS;
const KINK = 0.6 * SD, SBT = SA.SB * PX;
// underside of a stringer (stairsE: a diagonal beam from the entrance up to just under the high end)
const bot = (d) => (d <= KINK ? 0 : ((d - KINK) / (LEN - KINK)) * (RISE - SBT));
const topAt = (d) => Math.min(NS, Math.floor(d / SD + 1e-6) + 1) * RS; // a stringer's stepped top at d
const C = SA.col;

// ---------- state (the blueprint / ghost tint of the sprites: composeWorld / archCompose setState) ----------
let CR = 1, CG = 1, CB = 1, CA = 1;
function state(o) {
  const p = o.progress, bp = p != null && p < 1, a = o.alpha ?? 1;
  if (o._ghost) { if (o._ghost === 2) { CR = 1.6; CG = 0.42; CB = 0.36; } else { CR = 0.36; CG = 0.78; CB = 2.1; } CA = a * 0.72; }
  else if (bp) { CR = 0.34; CG = 0.72; CB = 2.0; CA = a * (0.62 + 0.3 * Math.max(0, Math.min(1, p))); }
  else { CR = CG = CB = 1; CA = a; }
}
const viewK = (nx, ny) => -CAMV.s * nx + CAMV.c * ny;          // > 0: a side whose outside faces the viewer
const shadeOf = (nx, ny) => faceShade(nx, ny); // (the walls' light, art/faces/kit.js)

// ---------- sprite pixel → atlas uv (a sprite painted W × H px, anchor ax, ay of that nominal box) ----------
function pxMap(s, W, H, ax = 0.5, ay = 1) {
  const du = s.u1 - s.u0, dv = s.v1 - s.v0;
  return { u: (px) => s.u0 + du * (s.ax + (px - W * ax) * PX / s.w), v: (py) => s.v0 + dv * (s.ay + (py - H * ay) * PX / s.h) };
}
const TEX = new WeakMap();
function tex(A) {
  let T = TEX.get(A);
  if (T === undefined) {
    T = null;
    if (A.has('stairs_wood') && A.has('stairs_wood_n') && A.has('stairs_wood_e') && A.has('fx_solid')) {
      const so = A.get('fx_solid'), su = (so.u0 + so.u1) / 2, sv = (so.v0 + so.v1) / 2;
      T = { S: pxMap(A.get('stairs_wood'), SA.W, SA.hS), N: pxMap(A.get('stairs_wood_n'), SA.W, SA.hN), E: pxMap(A.get('stairs_wood_e'), SA.D, SA.hE), su, sv,
        bp: A.has('bp_tile') ? A.get('bp_tile') : null, blob: A.has('fx_blob') ? A.get('fx_blob') : null };
    }
    TEX.set(A, T);
  }
  return T;
}

// ---------- faces of one stair, sorted by key, then emitted ----------
const POOL = [];
let NF = 0;
const ORD = [];
// 4 corners: local (u across, d along, h up) + texture (s, t); colour; key
function put(k, u0, d0, h0, s0, t0, u1, d1, h1, s1, t1, u2, d2, h2, s2, t2, u3, d3, h3, s3, t3, r, g, b) {
  const f = POOL[NF] || (POOL[NF] = { k: 0, n: 0, p: new Float32Array(20), r: 0, g: 0, b: 0 });
  f.k = k; f.n = NF++;
  const p = f.p;
  p[0] = u0; p[1] = d0; p[2] = h0; p[3] = s0; p[4] = t0;
  p[5] = u1; p[6] = d1; p[7] = h1; p[8] = s1; p[9] = t1;
  p[10] = u2; p[11] = d2; p[12] = h2; p[13] = s2; p[14] = t2;
  p[15] = u3; p[16] = d3; p[17] = h3; p[18] = s3; p[19] = t3;
  f.r = r; f.g = g; f.b = b;
}
// the stair's frame: world = O + u·b + d·a (a = the way up, b = a turned 90° clockwise), h0 = its story
let OX = 0, OY = 0, AX = 0, AY = -1, BX = 1, BY = 0, H0 = 0;
function frameOf(o) {
  const r = (o.rot | 0) & 3, tx = o.tx, ty = o.ty;
  if (r === 0) { OX = tx; OY = ty + 2; AX = 0; AY = -1; BX = 1; BY = 0; }
  else if (r === 2) { OX = tx + 1; OY = ty; AX = 0; AY = 1; BX = -1; BY = 0; }
  else if (r === 1) { OX = tx; OY = ty; AX = 1; AY = 0; BX = 0; BY = 1; }
  else { OX = tx + 2; OY = ty + 1; AX = -1; AY = 0; BX = 0; BY = -1; }
}
function emit(F, a) {
  ORD.length = 0;
  for (let i = 0; i < NF; i++) ORD.push(POOL[i]);
  ORD.sort((x, y) => x.k - y.k || x.n - y.n);
  for (const f of ORD) {
    const p = f.p, X = (i) => OX + p[i] * BX + p[i + 1] * AX, Y = (i) => OY + p[i] * BY + p[i + 1] * AY;
    F.quad4(X(0), Y(0), H0 + p[2], p[3], p[4], X(5), Y(5), H0 + p[7], p[8], p[9], X(10), Y(10), H0 + p[12], p[13], p[14], X(15), Y(15), H0 + p[17], p[18], p[19], f.r * CR, f.g * CG, f.b * CB, a);
  }
  NF = 0;
}

// keys inside a stair (see the header): band of a height, and the order inside a band
const band = (h) => Math.max(0, Math.floor(h / RS + 1e-6));
const K_TOP = -0.0002, K_TREAD = -0.0001, K_THIN = 0.00002, K_FACE = 0.0001;

// a thin box (post, cap, leg), cut into height bands; top face on the last band
function box(T, u0, u1, d0, d1, hb, ht, col, top, ka, kb) {
  const { su, sv } = T;
  for (let k = band(hb); k * RS < ht - 1e-6; k++) {
    const lo = Math.max(hb, k * RS), hi = Math.min(ht, (k + 1) * RS), key = k * RS + K_THIN;
    if (ka > 0.02) { const z = shadeOf(AX, AY); put(key, u1, d1, hi, su, sv, u0, d1, hi, su, sv, u0, d1, lo, su, sv, u1, d1, lo, su, sv, col[0] * z, col[1] * z, col[2] * z); }
    else if (ka < -0.02) { const z = shadeOf(-AX, -AY); put(key, u0, d0, hi, su, sv, u1, d0, hi, su, sv, u1, d0, lo, su, sv, u0, d0, lo, su, sv, col[0] * z, col[1] * z, col[2] * z); }
    if (kb > 0.02) { const z = shadeOf(BX, BY); put(key, u1, d0, hi, su, sv, u1, d1, hi, su, sv, u1, d1, lo, su, sv, u1, d0, lo, su, sv, col[0] * z, col[1] * z, col[2] * z); }
    else if (kb < -0.02) { const z = shadeOf(-BX, -BY); put(key, u0, d1, hi, su, sv, u0, d0, hi, su, sv, u0, d0, lo, su, sv, u0, d1, lo, su, sv, col[0] * z, col[1] * z, col[2] * z); }
    if (top && hi >= ht - 1e-6) put(key, u0, d0, ht, su, sv, u1, d0, ht, su, sv, u1, d1, ht, su, sv, u0, d1, ht, su, sv, top[0], top[1], top[2]);
  }
}
// Sutherland–Hodgman: keep s·(h − c) ≥ 0 of a convex polygon [d, h, d, h, …]
function clipH(P, c, s) {
  const out = [], n = P.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ad = P[2 * i], ah = P[2 * i + 1], bd = P[2 * j], bh = P[2 * j + 1];
    const ia = s * (ah - c) >= -1e-9, ib = s * (bh - c) >= -1e-9;
    if (ia) out.push(ad, ah);
    if (ia !== ib) { const t = (c - ah) / (bh - ah); out.push(ad + (bd - ad) * t, c); }
  }
  return out;
}
// one stringer (u0..u1): its legs, the side face that shows (the stairsE profile, cut into bands), its stepped top and
// step faces, its posts and handrail
function stringer(T, u0, u1, ka, kb) {
  const { E, su, sv } = T, uc = (u0 + u1) / 2;
  // legs: posts from the beam down to the ground
  for (const dl of SA.legsD) {
    const d = dl * PX, w = SA.legW * PX * 0.5, wu = Math.min(w, (u1 - u0) * 0.45);
    box(T, uc - wu, uc + wu, d - w, d + w, 0, bot(d) + PX, C.sgMid, null, ka, kb);
  }
  // the side face toward the camera: the profile per step, clipped to the bands
  if (Math.abs(kb) > 0.02) {
    const U = kb > 0 ? u1 : u0, z = kb > 0 ? shadeOf(BX, BY) : shadeOf(-BX, -BY);
    for (let i = 0; i < NS; i++) {
      const da = i * SD, db = (i + 1) * SD, top = (i + 1) * RS;
      const P = i === 0 && KINK > da && KINK < db ? [da, top, db, top, db, bot(db), KINK, 0, da, 0] : [da, top, db, top, db, bot(db), da, bot(da)];
      for (let k = band(bot(db) < bot(da) ? bot(db) : bot(da)); k <= i; k++) {
        const Q = clipH(clipH(P, k * RS, 1), (k + 1) * RS, -1);
        const n = Q.length >> 1;
        if (n < 3) continue;
        const S = (j) => E.u(SA.D - Q[2 * j] / PX), V = (j) => E.v(SA.hE - Q[2 * j + 1] / PX);
        for (let j = 1; j + 1 < n; j++) put(k * RS + K_FACE, U, Q[0], Q[1], S(0), V(0), U, Q[2 * j], Q[2 * j + 1], S(j), V(j), U, Q[2 * j + 2], Q[2 * j + 3], S(j + 1), V(j + 1), U, Q[2 * j + 2], Q[2 * j + 3], S(j + 1), V(j + 1), z, z, z);
      }
    }
  }
  // stepped top, and the step faces toward the entrance
  const zt = 1.04, zs = ka < -0.02 ? shadeOf(-AX, -AY) : 0;
  for (let i = 0; i < NS; i++) {
    const da = i * SD, db = (i + 1) * SD, h = (i + 1) * RS;
    put(h + K_TOP, u0, da, h, su, sv, u1, da, h, su, sv, u1, db, h, su, sv, u0, db, h, su, sv, C.sgTop[0] * zt, C.sgTop[1] * zt, C.sgTop[2] * zt);
    if (zs) { const lo = i ? i * RS : 0; put(i * RS + K_FACE, u0, da, h, su, sv, u1, da, h, su, sv, u1, da, lo, su, sv, u0, da, lo, su, sv, C.sgMid[0] * zs, C.sgMid[1] * zs, C.sgMid[2] * zs); }
  }
  // handrail: posts on the stepped top (cap on each), a rail over their tops
  const pc = uc, pw = SA.postW * PX * 0.5, cw = SA.capW * PX * 0.5, PH = SA.POST * PX, CH = SA.capH * PX;
  const tops = [];
  for (const dp of SA.postD) {
    const d = dp * PX, foot = topAt(d), t = foot + PH;
    box(T, pc - pw, pc + pw, d - pw, d + pw, foot, t, C.railB, null, ka, kb);
    box(T, pc - cw, pc + cw, d - cw, d + cw, t, t + CH, C.cap, C.cap, ka, kb);
    tops.push(d, t + CH * 0.5);
  }
  const rw = SA.railW * PX * 0.5, rh = SA.railW * PX * 0.5, dA = tops[0], hA = tops[1], dB = tops[tops.length - 2], hB = tops[tops.length - 1];
  const sl = (hB - hA) / (dB - dA), hr = (d) => hA + (d - dA) * sl;
  // segments where the rail's underside crosses a band boundary
  const cuts = [dA];
  for (let k = band(hr(dA) - rh) + 1; k * RS < hr(dB) - rh; k++) cuts.push(dA + (k * RS + rh - hA) / sl);
  cuts.push(dB);
  const zr = Math.abs(kb) > 0.02 ? (kb > 0 ? shadeOf(BX, BY) : shadeOf(-BX, -BY)) : 0, U = kb > 0 ? pc + rw : pc - rw;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], key = band(hr(a) - rh) * RS + K_THIN + 0.00001;
    put(key, pc - rw, a, hr(a) + rh, su, sv, pc + rw, a, hr(a) + rh, su, sv, pc + rw, b, hr(b) + rh, su, sv, pc - rw, b, hr(b) + rh, su, sv, C.railA[0], C.railA[1], C.railA[2]);
    if (zr) put(key, U, a, hr(a) + rh, su, sv, U, b, hr(b) + rh, su, sv, U, b, hr(b) - rh, su, sv, U, a, hr(a) - rh, su, sv, C.railB[0] * zr, C.railB[1] * zr, C.railB[2] * zr);
  }
}
// treads (stairs_wood) and, seen from the entrance side, risers (stairs_wood)
function steps(T, ka) {
  const { S } = T, x0 = SA.tread[0], x1 = SA.tread[1], ua = x0 * PX, ub = x1 * PX;
  const zr = ka < -0.02 ? Math.min(1.15, shadeOf(-AX, -AY) / 0.8) : 0;
  for (let i = 0; i < NS; i++) {
    const da = i * SD, db = (i + 1) * SD, h = (i + 1) * RS, hp = h / PX;
    const sa = S.u(x0 + 0.5), sb = S.u(x1 - 0.5), tn = S.v(SA.hS - da / PX - hp - 0.5), tf = S.v(SA.hS - db / PX - hp + 0.5);
    put(h + K_TREAD, ua, da, h, sa, tn, ub, da, h, sb, tn, ub, db, h, sb, tf, ua, db, h, sa, tf, 1, 1, 1);
    if (zr) {
      const lo = i * RS, rt = S.v(SA.hS - da / PX - hp + 0.3), rb = S.v(SA.hS - da / PX - lo / PX - 0.3);
      put(lo + K_FACE, ua, da, h, sa, rt, ub, da, h, sb, rt, ub, da, lo, sb, rb, ua, da, lo, sa, rb, zr, zr, zr);
    }
  }
}

// part 0: the back (far stringer, steps); 1: the front (near stringer, end face); 2: both (blueprints, previews)
export function drawStairFaces(F, A, o, h0 = 0, part = 2) {
  if (!F) return false;
  const T = tex(A);
  if (!T) return false;
  state(o);
  if (CA <= 0.01) return true;
  frameOf(o);
  H0 = h0;
  const ka = viewK(AX, AY), kb = viewK(BX, BY);
  const [s0, s1] = SA.stringers, lo = kb >= 0 ? s0 : s1, hi = kb >= 0 ? s1 : s0; // (far, near)
  NF = 0;
  if (part !== 1) {
    stringer(T, lo[0] * PX, lo[1] * PX, ka, kb);
    steps(T, ka);
    if (part === 0) { emit(F, CA); return true; }
  }
  stringer(T, hi[0] * PX, hi[1] * PX, ka, kb);
  if (ka > 0.02) {
    // the end face under the top step (stairs_wood_n), last
    const N = T.N, z = shadeOf(AX, AY), ua = SA.stringers[0][0], ub = SA.stringers[1][1], top = N.v(SA.hN - SA.RISE + 0.3), bt = N.v(SA.hN - 0.3);
    put(99, ua * PX, LEN, RISE, N.u(SA.W - ua), top, ub * PX, LEN, RISE, N.u(SA.W - ub), top, ub * PX, LEN, 0, N.u(SA.W - ub), bt, ua * PX, LEN, 0, N.u(SA.W - ua), bt, z, z, z);
  }
  emit(F, CA);
  return true;
}
// a stair's depth (the front-most point of its footprint, as every box); its front part and whoever climbs it sort
// right after it (game/levels.js)
export const stairZk = (o, rc, rs) => boxDepth(o, rc, rs);
// contact shadow under a stair (as the sprite's blob)
export function stairBlob(B, A, o) {
  const T = tex(A);
  if (!T?.blob || o.blueprint || o._ghost || o.lv > 0) return;
  const r = (o.rot | 0) & 1, cx = o.tx + (r ? 1 : 0.5), cy = o.ty + (r ? 0.5 : 1);
  B.blob.add(T.blob, cx - CAMV.s * 0.25, cy + CAMV.c * 0.25, 1.25, 0.95, 1, 1, 1, 0.32 * (o.alpha ?? 1)); // (a little down the screen)
}

// ---------- flat records → faces (upper floors, rugs, flat ghosts at a story's height) ----------
// lay a flat sprite record (as batch.add would draw it on the ground, uFlat) at height h; (dx, dy) moves it back
export function layFlat(F, s, x, y, sx, sy, r, g, b, a, rot, flip, h) {
  if (!s) return;
  const W = s.w * sx, H = s.h * sy, cs = Math.cos(rot || 0), sn = Math.sin(rot || 0);
  const X = (cx, cy) => x + ((cx - s.ax) * W) * cs - ((cy - s.ay) * H) * sn, Y = (cx, cy) => y + ((cx - s.ax) * W) * sn + ((cy - s.ay) * H) * cs;
  const ua = flip < 0 ? s.u1 : s.u0, ub = flip < 0 ? s.u0 : s.u1;
  F.quad4(X(0, 0), Y(0, 0), h, ua, s.v0, X(1, 0), Y(1, 0), h, ub, s.v0, X(1, 1), Y(1, 1), h, ub, s.v1, X(0, 1), Y(0, 1), h, ua, s.v1, r, g, b, a);
}
const REC = [];
const NB = { add() {}, addRaw() {} };
class FlatRec { add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1) { if (s) REC.push(s, x, y, sx, sy, r, g, b, a, rot || 0, flip || 1); } addRaw() {} }
const RB = { ground: new FlatRec(), decor: new FlatRec(), main: NB, blob: NB, shadow: NB, emissive: NB, fx: NB, light: NB };

const isWallTop = (d) => !!d && d.connect === 'wall' && (d.block === 'tile' || d.block === 'door');
// an upper floor: its flat layers at height h, the slab beam on the open sides toward the camera, the plan grid
export function drawFloorFaces(F, A, o, h = 1, t = 0) {
  if (!F) return false;
  if ((o.alpha ?? 1) <= 0.02) return true; // (faded out by the reveal)
  REC.length = 0;
  drawStatic(RB, A, o, t);
  if (!REC.length) return false;
  for (let i = 0; i < REC.length; i += 11) layFlat(F, REC[i], REC[i + 1], REC[i + 2], REC[i + 3], REC[i + 4], REC[i + 5], REC[i + 6], REC[i + 7], REC[i + 8], REC[i + 9], REC[i + 10], h);
  REC.length = 0;
  state(o);
  const T = tex(A);
  if (o.blueprint && T?.bp) { const s = T.bp; F.quad4(o.tx, o.ty, h, s.u0, s.v0, o.tx + 1, o.ty, h, s.u1, s.v0, o.tx + 1, o.ty + 1, h, s.u1, s.v1, o.tx, o.ty + 1, h, s.u0, s.v1, 0.42, 0.7, 1, 0.5 * (o.alpha ?? 1)); }
  // the slab's beam: open sides (no surface of this story beyond) that face the camera, not over a wall below
  const g = KIT_ENV.game, w = g?.world, L = g?.levels, lv = o.lv | 0;
  if (!w || !L || o.blueprint || CA <= 0.01) return true;
  const N = w.W * w.H, i = o.ty * w.W + o.tx, below = g.build.grid.main.get(i + (lv - 1) * N);
  if (below && isWallTop(BUILDINGS[below.type]) && !below.blueprint) return true;
  const se = archSprite(A, 'slab_edge'), x0 = o.tx, y0 = o.ty, x1 = x0 + 1, y1 = y0 + 1, hb = h - 11 * PX;
  const su = T ? T.su : 0, sv = T ? T.sv : 0;
  const side = (ax, ay, bx, by, nx, ny, nxT, nyT) => {
    if (viewK(nx, ny) <= 0.02 || !w.inBounds(nxT, nyT) || L.isSurface(lv, nyT * w.W + nxT)) return;
    const z = shadeOf(nx, ny);
    if (se) { const m = pxMap(se, 64, 11, 0.5, 0); F.quad4(ax, ay, h, m.u(0.5), m.v(0.5), bx, by, h, m.u(63.5), m.v(0.5), bx, by, hb, m.u(63.5), m.v(10.5), ax, ay, hb, m.u(0.5), m.v(10.5), z * CR, z * CG, z * CB, CA); }
    else if (T) F.quad4(ax, ay, h, su, sv, bx, by, h, su, sv, bx, by, hb, su, sv, ax, ay, hb, su, sv, 0.42 * z * CR, 0.29 * z * CG, 0.18 * z * CB, CA);
  };
  side(x0, y1, x1, y1, 0, 1, o.tx, o.ty + 1);
  side(x1, y0, x0, y0, 0, -1, o.tx, o.ty - 1);
  side(x1, y1, x1, y0, 1, 0, o.tx + 1, o.ty);
  side(x0, y0, x0, y1, -1, 0, o.tx - 1, o.ty);
  return true;
}

// ---------- registry ----------
registerFaces({
  id: 'stairs',
  test: (o, d) => !!d && d.block === 'stairs',
  // finished stairs: the back part here, the front part as its own drawable (game/levels.js collect); blueprints whole
  draw: (B, A, o) => { stairBlob(B, A, o); return drawStairFaces(B.faces, A, o, (o.lv | 0) * STORY_H, o.blueprint ? 2 : 0); },
  depth: stairZk,
});
registerFaces({
  id: 'floorUp',
  test: (o, d) => !!d && d.layer === 'floor' && o.lv > 0,
  draw: (B, A, o, t) => drawFloorFaces(B.faces, A, o, (o.lv | 0) * STORY_H, t),
  // after the walls of the story below (their tops are under it), before anything of its own story (walls, people)
  depth: (o, rc, rs) => boxDepth(o, rc, rs) - 0.0005,
});
registerFaces({
  id: 'upperSprite',
  prio: -1, // (a catch-all for upper pieces: after every other kind, whatever the import order)
  test: (o, d) => !!d && o.lv > 0 && !d.roof,
  draw: () => false, // (a sprite: levels.drawUpper)
  depth: (o, rc, rs) => boxDepth(o, rc, rs) - (BUILDINGS[o.type]?.layer === 'rug' ? 0.0003 : 0),
});
