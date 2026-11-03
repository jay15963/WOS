// Diagonal views of the humanoid rig (camera rotation, 8 directions). The painted art has three views (s front,
// n back, e side; w = e mirrored); a 3/4 view ('se' front-side, 'ne' back-side; sw / nw mirrored) is PAINTED ANEW
// from them: every layer of a part is painted by the part's own painter in the front (or back) view AND in the side
// view (raw, before its outline), both drawings are laid on a simple 3D stand-in of the part (one ellipse per row:
// its width from the front drawing, its depth from the side one), the stand-in is turned 45° and seen by the
// camera — the front drawing covers the surfaces that face front, the side drawing the ones that face the side,
// blended over a narrow band — and the layer gets its outline afterwards (same width and colour as the original:
// the same artist's line). So a 3/4 torso is narrower with its side showing and the near arm on it (the side
// drawing's arm), the far arm folds behind the chest; a 3/4 head shows the near ear and cheek from the side
// drawing and the face from the front drawing, turned; hair, beards, hats, armour follow the same turn.
// Small face features (eyes, nose, mouth, brows, marks, paint…) come from the front drawing only, laid on a
// stand-in head (the two drawings do not agree on where an eye is in 3D): they turn with the face.
//
// Parts are painted lazily into the look texture (art/look/lazy.js, agent H's machinery: same eviction / reuse) the
// first time a turned camera shows them — nothing is baked, nothing is shared state. Painter sources: the look
// parts (look/index.js lookDefs) and the painters registered in art/lazyDefs.js PAINT_DEFS (armour, bandana, legacy
// masks, winter-walker overlays).
//   diagSprite(A, frontName, view) → look-texture record (ready later) or null
//   diagRig(A, LK, view) → { body, head, brows, beard, hair, hairBack, lids, feet, need } for a look rig (look/rig.js)
//   diagReady(D, A, urgent) → are all its parts painted?
//   diagPart(A, frontName, view, urgent) → one 3/4 part outside a look (null until painted)
//   turnX(x, ly, view) → where a point of the front head drawing lands (tiles from the axis; e.g. eye glows)
//   threeQuarter(defF, defS, kind, view) → padded canvas of one 3/4 part (tools / animals)

import { LAZY_DEFS, PAINT_DEFS } from '../lazyDefs.js';
import { lookAtlasOf, LOOK_CLOCK } from './lazy.js';
import { lookDefs } from './index.js';
import { SS, OW, OUT, canvas, spritePxFast } from '../paint.js';
import { armPath } from './body.js';
import { bodyPath, PAWN, NECK, FEET } from '../pawns.js';

// camera azimuth around the creature for a 3/4 view: 0 = its front, 90° = its right side, 180° = its back
const DEG = Math.PI / 180;
export const GAMMA = { se: 42 * DEG, ne: 138 * DEG, sl: 8 * DEG, nl: 66 * DEG }; // (sl / nl: a head turned toward the camera on a se / ne body: art/beast34.js)
// blend band (half width) between the front / back drawing and the side drawing, around the 45° normals
const BAND = 18 * DEG; // (wide: a detail drawn in one view only fades out over the turn instead of ending on a seam)
// the source drawing of a view and the way its content slides (+1: to the right); w: 3/4 width of the torso
export const VIEW = { se: { pd: 's', sg: 1 }, ne: { pd: 'n', sg: -1 } };
export const KIND = { body: { w: 0.88 }, head: { w: 1 } };
const PADQ = 14;
const OCC_TOL = 2 * SS; // (px: hair lying on the head is never hidden by it)
const SIDE_MAX = 108 * DEG; // a front-only part seen from behind: the surface up to this normal (its near side)
const RAGGED_FILL = 6 * SS; // px: the widest gap between two curls closed along a ragged hair's turned outline
// very irregular hair (curls, coils, locs, a wild mane): its turned outline follows the volume (projectLayer fillEdge);
// a crest (mohawk): its side drawing all round (the spikes in profile, foreshortened), not blended with the front one
const RAGGED = /^lk_hairx?_(\w+_)?(afro|curly|long_curly|wild|puff|twists|dreads|long_dreads)_[sn]$/, CREST = /^lk_hairx?_(\w+_)?mohawk_[sn]$/;
export const hairStyle = (name) => (RAGGED.test(name) ? 'ragged' : CREST.test(name) ? 'crest' : null);

// ---------------- recording painter: the raw layers of a part (no outline yet) ----------------
export class Rec {
  constructor(W, H, pad, keep = false, pixels = true) {
    this.W = W; this.H = H; this.pad = pad; this.keep = keep; this.pixels = pixels; // (keep: the layer canvases too)
    this.cw = (W + pad * 2) * SS; this.ch = (H + pad * 2) * SS;
    this.layers = [];
  }
  layer(fn, ow = OW, col = OUT, opacity = 1) {
    const c = canvas(this.cw, this.ch), g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.setTransform(SS, 0, 0, SS, this.pad * SS, this.pad * SS);
    fn(g);
    this.layers.push({ px: this.pixels ? g.getImageData(0, 0, this.cw, this.ch).data : null, c: this.keep ? c : null, ow, col, opacity });
  }
}
function record(def, pad) {
  if (!def) return null;
  const P = new Rec(def.W, def.H, pad);
  def.paint(P);
  return P;
}

// ---------------- per-row extents of a drawing (SS px from the axis), smoothed ----------------
// out: Float32Array [lo, hi] per row (NaN = empty)
export function extents(R, flipX = false) {
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS;
  const E = new Float32Array(H * 2).fill(NaN);
  for (let y = 0; y < H; y++) {
    let x0 = -1, x1 = -1;
    for (const L of R.layers) {
      const px = L.px;
      for (let x = 0, o = y * W * 4 + 3; x < W; x++, o += 4) if (px[o] > 12) { if (x0 < 0 || x < x0) x0 = x; break; }
      for (let x = W - 1, o = (y * W + W - 1) * 4 + 3; x >= 0; x--, o -= 4) if (px[o] > 12) { if (x > x1) x1 = x; break; }
    }
    if (x0 < 0) continue;
    let lo = x0 - ax, hi = x1 + 1 - ax;
    if (flipX) { const t = lo; lo = -hi; hi = -t; }
    E[y * 2] = lo; E[y * 2 + 1] = hi;
  }
  return E;
}
// union of two extents arrays (either may be null)
export function union(a, b) {
  if (!a) return b; if (!b) return a;
  const E = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 2) {
    const l0 = a[i], h0 = a[i + 1], l1 = b[i], h1 = b[i + 1];
    if (Number.isNaN(l0)) { E[i] = l1; E[i + 1] = h1; } else if (Number.isNaN(l1)) { E[i] = l0; E[i + 1] = h0; } else { E[i] = Math.min(l0, l1); E[i + 1] = Math.max(h0, h1); }
  }
  return E;
}
// rows of a drawing that are empty where the other view has content take the nearest row of the same drawing (the
// bottom of a round mass: the two views do not end on the same row — a jump to another stand-in would shift it)
export function stretch(a, other) {
  if (!other) return a;
  const n = a.length / 2, E = new Float32Array(a);
  for (let y = 0; y < n; y++) {
    if (!Number.isNaN(E[y * 2]) || Number.isNaN(other[y * 2])) continue;
    for (let k = 1; k < 16 * SS; k++) {
      const u = y - k, d = y + k;
      if (u >= 0 && !Number.isNaN(a[u * 2])) { E[y * 2] = a[u * 2]; E[y * 2 + 1] = a[u * 2 + 1]; break; }
      if (d < n && !Number.isNaN(a[d * 2])) { E[y * 2] = a[d * 2]; E[y * 2 + 1] = a[d * 2 + 1]; break; }
    }
  }
  return E;
}
// rows of a that are empty take b's
function fillE(a, b) {
  const E = new Float32Array(a);
  for (let i = 0; i < E.length; i += 2) if (Number.isNaN(E[i]) && !Number.isNaN(b[i])) { E[i] = b[i]; E[i + 1] = b[i + 1]; }
  return E;
}
// soften the row profile (ragged ends would make the stand-in jumpy): a short mean of the rows that have content
// (never wider than the drawing at the ends: a wider stand-in leaves holes at the seam)
export function smoothE(E, r = 2) {
  const n = E.length / 2, O = new Float32Array(E.length).fill(NaN);
  for (let y = 0; y < n; y++) {
    if (Number.isNaN(E[y * 2])) continue;
    let lo = 0, hi = 0, c = 0;
    for (let k = -r; k <= r; k++) { const q = y + k; if (q < 0 || q >= n || Number.isNaN(E[q * 2])) continue; lo += E[q * 2]; hi += E[q * 2 + 1]; c++; }
    O[y * 2] = Math.max(E[y * 2], lo / c); O[y * 2 + 1] = Math.min(E[y * 2 + 1], hi / c);
  }
  return O;
}

// ---------------- canonical stand-ins (the bare torso / head): decals and thin parts ride on them ----------------
const CANON = new Map();
const CANON_SRC = { body: 'lk_skin_', head: 'lk_head_round_' };
function canon(box, pd) {
  const key = box + pd;
  if (CANON.has(key)) return CANON.get(key);
  const D = lookDefs(), b = CANON_SRC[box];
  let C = null;
  if (b) {
    const F = record(D.get(b + pd), PADQ), S = record(D.get(b + 'e'), PADQ);
    if (F && S) C = { X: smoothE(extents(F, pd === 'n')), Z: smoothE(extents(S)) };
  }
  CANON.set(key, C);
  return C;
}
// what hides hair from the camera: the bare head, and under it the torso (the head box's neck sits PAWN.headLift
// above the feet: torso rows continue the head's)
const OCCL = new Map();
function occluder(pd) {
  if (OCCL.has(pd)) return OCCL.get(pd);
  const H = canon('head', pd), B = canon('body', pd);
  let O = H;
  if (H && B) {
    O = { X: new Float32Array(H.X), Z: new Float32Array(H.Z) };
    const dy = Math.round((NECK - (FEET - PAWN.headLift * 64)) * SS), n = O.X.length / 2;
    let last = -1;
    for (let y = 0; y < n; y++) if (!Number.isNaN(H.X[y * 2])) last = y;
    for (let y = last + 1; y < n; y++) {
      const yb = y - dy;
      if (yb < 0 || yb * 2 + 1 >= B.X.length || Number.isNaN(B.X[yb * 2])) continue;
      O.X[y * 2] = B.X[yb * 2]; O.X[y * 2 + 1] = B.X[yb * 2 + 1]; O.Z[y * 2] = B.Z[yb * 2]; O.Z[y * 2 + 1] = B.Z[yb * 2 + 1];
    }
  }
  OCCL.set(pd, O);
  return O;
}

// ---------------- sampling ----------------
// premultiplied box-filtered horizontal sample of row y at x (px of the layer canvas), footprint fw ≥ 1
const ACC = [0, 0, 0, 0];
function sample(px, W, H, y, x, fw) {
  ACC[0] = ACC[1] = ACC[2] = ACC[3] = 0;
  if (y < 0 || y >= H) return;
  const n = fw <= 1.25 ? 1 : Math.min(8, Math.ceil(fw));
  for (let q = 0; q < n; q++) {
    const xx = n === 1 ? x : x + ((q + 0.5) / n - 0.5) * fw;
    const x0 = Math.floor(xx - 0.5), f = xx - 0.5 - x0;
    for (let e = 0; e < 2; e++) {
      const xi = x0 + e, wq = (e ? f : 1 - f) / n;
      if (xi < 0 || xi >= W || wq <= 0) continue;
      const i = (y * W + xi) * 4, al = px[i + 3] * wq;
      ACC[0] += px[i] * al; ACC[1] += px[i + 1] * al; ACC[2] += px[i + 2] * al; ACC[3] += al;
    }
  }
}
const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- the 3/4 projection of one layer ----------------
// the ellipse of a row (NaN-safe), as [cx, rx, cz, rz] or null
function rowEll(X, Z, y) {
  let lo = X[y * 2], hi = X[y * 2 + 1], zl = Z[y * 2], zh = Z[y * 2 + 1];
  const hasX = !Number.isNaN(lo), hasZ = !Number.isNaN(zl);
  if (!hasX && !hasZ) return null;
  if (!hasX) { const r = (zh - zl) / 2; lo = -r; hi = r; }
  if (!hasZ) { const r = (hi - lo) / 2; zl = -r; zh = r; }
  return [(lo + hi) / 2, Math.max(1, (hi - lo) / 2), (zl + zh) / 2, Math.max(1, (zh - zl) / 2)];
}
// depth toward the camera of the visible point of a row ellipse e = [cx, rx, cz, rz, C, M, t0] at screen x xq
// (−Infinity: the ray misses it)
function depthAt(e, xq, cg, sg) {
  const u = (xq - e[4]) / e[5];
  if (u <= -1 || u >= 1) return -Infinity;
  const a = Math.acos(u), t1 = e[6] + a, t2 = e[6] - a;
  return Math.max(-(e[0] + e[1] * Math.cos(t1)) * sg + (e[2] + e[3] * Math.sin(t1)) * cg, -(e[0] + e[1] * Math.cos(t2)) * sg + (e[2] + e[3] * Math.sin(t2)) * cg);
}
// rows of a drawing that have something
function rowsOf(px, W, H) {
  const R = new Uint8Array(H);
  if (px) for (let y = 0; y < H; y++) for (let x = 0, o = y * W * 4 + 3; x < W; x++, o += 4) if (px[o]) { R[y] = 1; break; }
  return R;
}
// The 3/4 projection of one layer. pxF: the front (or back) drawing, pxS: the side drawing (either may be null),
// X / Z: stand-in extents per row (front width / side depth). Returns an RGBA buffer the size of the layer canvas.
// occ: an occluder stand-in ({ X, Z }: the bare head) — what lies behind it on the camera's ray is not drawn (a hair
// strand on the far side of the face)
// fillEdge (px): ragged hair — gaps between curls along the stand-in's outline are filled with the hair next to them,
// so the turned edge follows the smooth volume instead of the curls cut off by it (a jagged edge)
export function projectLayer(R, pxF, pxS, X, Z, view, frontOnly, occ = null, sideOnly = false, fillEdge = 0) {
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS;
  const out = new Uint8ClampedArray(W * H * 4);
  const back = view === 'ne', g = GAMMA[view], cg = Math.cos(g), sg = Math.sin(g);
  const bX = -sg, bZ = cg; // toward the camera, in the creature's (X: its left, Z: its front) frame
  const seam = back ? 135 * DEG : 45 * DEG;
  const rF = rowsOf(pxF, W, H), rS = rowsOf(frontOnly ? null : pxS, W, H);
  for (let y = 0; y < H; y++) {
    if (!rF[y] && !rS[y]) continue; // (nothing to lay on this row)
    let lo = X[y * 2], hi = X[y * 2 + 1], zl = Z[y * 2], zh = Z[y * 2 + 1];
    const hasX = !Number.isNaN(lo), hasZ = !Number.isNaN(zl);
    if (!hasX && !hasZ) continue;
    if (!hasX) { const r = (zh - zl) / 2; lo = -r; hi = r; }
    if (!hasZ) { const r = (hi - lo) / 2; zl = -r; zh = r; }
    const cx = (lo + hi) / 2, rx = Math.max(1, (hi - lo) / 2), cz = (zl + zh) / 2, rz = Math.max(1, (zh - zl) / 2);
    const oe = occ ? rowEll(occ.X, occ.Z, y) : null;
    if (oe) oe.push(oe[0] * cg + oe[2] * sg, Math.hypot(oe[1] * cg, oe[3] * sg), Math.atan2(oe[3] * sg, oe[1] * cg));
    const thin = rx < 0.4 * rz; // (a crest seen from 45°: its profile)
    // x'(t) = C + M cos(t − t0) over the ellipse (cx + rx cos t, cz + rz sin t)
    const C = cx * cg + cz * sg, M = Math.hypot(rx * cg, rz * sg), t0 = Math.atan2(rz * sg, rx * cg);
    const i0 = Math.max(0, Math.floor(ax + C - M) - 1), i1 = Math.min(W - 1, Math.ceil(ax + C + M) + 1);
    for (let i = i0; i <= i1; i++) {
      const u = (i + 0.5 - ax - C) / M;
      if (u <= -1 || u >= 1) continue;
      const a = Math.acos(u);
      // the visible one of the two points with this screen x (its normal faces the camera)
      let t = t0 + a;
      const v1 = (Math.cos(t) / rx) * bX + (Math.sin(t) / rz) * bZ;
      const t2 = t0 - a, v2 = (Math.cos(t2) / rx) * bX + (Math.sin(t2) / rz) * bZ;
      if (v2 > v1) t = t2;
      const ct = Math.cos(t), st = Math.sin(t);
      const Xs = cx + rx * ct, Zs = cz + rz * st;
      if (oe && -Xs * sg + Zs * cg < depthAt(oe, i + 0.5 - ax, cg, sg) - OCC_TOL) continue;
      const nX = ct / rx, nZ = st / rz;
      let eta = Math.atan2(-nX, nZ); // normal: 0 front, 90° its right side, 180° back
      if (back && eta < 0) eta += Math.PI * 2;
      if (sideOnly === true && back && eta > SIDE_MAX) continue; // (a beard from behind: only its near side, not its back on the neck)
      // how much of the side drawing (wS) vs the front / back one (wF)
      let wS = back ? 1 - smoothstep(seam - BAND, seam + BAND, eta) : smoothstep(seam - BAND, seam + BAND, eta);
      if (thin || sideOnly) wS = 1;
      if (frontOnly || !pxS) wS = 0;
      const wF = pxF ? 1 - wS : 0;
      // footprints of one output px in the sources (squeezed near the folds)
      const ds = Math.abs(M * Math.sin(t - t0)) || 1e-3;
      const fpX = Math.min(8, Math.max(1, Math.abs(rx * st) / ds)), fpZ = Math.min(8, Math.max(1, Math.abs(rz * ct) / ds));
      // colour: the drawings weighted by what they cover there; alpha: the larger weighted coverage (inside the band
      // the drawings may disagree a little on the outline: the larger one wins, no holes)
      let r = 0, gg = 0, b = 0, cw = 0, am = 0;
      if (wF > 0.001) {
        sample(pxF, W, H, y, ax + (back ? -Xs : Xs), fpX);
        r += ACC[0] * wF; gg += ACC[1] * wF; b += ACC[2] * wF; cw += ACC[3] * wF; am = Math.max(am, ACC[3] * wF);
      }
      if (wS > 0.001) {
        sample(pxS, W, H, y, ax + Zs, fpZ);
        r += ACC[0] * wS; gg += ACC[1] * wS; b += ACC[2] * wS; cw += ACC[3] * wS; am = Math.max(am, ACC[3] * wS);
      }
      if (cw < 0.5) continue;
      const o = (y * W + i) * 4;
      out[o] = r / cw; out[o + 1] = gg / cw; out[o + 2] = b / cw; out[o + 3] = Math.min(255, am / Math.max(wF, wS));
    }
    if (fillEdge) edgeFill(out, W, y, i0, i1, ax + C, M, fillEdge);
  }
  return out;
}
// the outer part of a row (|u| > 0.55 of the turned ellipse): a see-through pixel with hair within `n` px further in
// takes that hair (a curl's gap closed); the face's hole in the middle of the row stays
function edgeFill(out, W, y, i0, i1, c, M, n) {
  for (let i = i0; i <= i1; i++) {
    const u = (i + 0.5 - c) / M, o = (y * W + i) * 4;
    if (Math.abs(u) < 0.55 || Math.abs(u) >= 1 || out[o + 3] > 150) continue;
    const step = u > 0 ? -1 : 1;
    for (let k = 1; k <= n; k++) {
      const j = i + step * k;
      if (j < i0 || j > i1) break;
      const q = (y * W + j) * 4;
      if (out[q + 3] > 200) { const a = out[o + 3] / 255, b = 1 - a; out[o] = out[o] * a + out[q] * b; out[o + 1] = out[o + 1] * a + out[q + 1] * b; out[o + 2] = out[o + 2] * a + out[q + 2] * b; out[o + 3] = 255; break; }
    }
  }
}

// ---------------- arms (torso box) ----------------
// The arms hang beside the torso, not on it: the torso stand-in leaves them out; the near arm (its right arm: the
// side drawing's arm) is laid over the turned torso at its own place and the far arm (the front / back drawing's
// other arm) behind it, where only its edge shows past the chest / back.
const MASKS = new Map();
const ARM_Y0 = 16.5, ARM_Y1 = 20.5; // (box px: from the shoulder to the armpit)
const ARM_OVER = false, ARM_K = 0.8;  // the side arm laid again at its own width over the turned torso (off)
function maskOf(R, fn, grow = 0) {
  const c = canvas(R.cw, R.ch), g = c.getContext('2d');
  g.setTransform(SS, 0, 0, SS, R.pad * SS, R.pad * SS);
  g.beginPath(); fn(g); g.fillStyle = '#fff'; g.fill();
  if (grow) { g.strokeStyle = '#fff'; g.lineWidth = grow * 2; g.lineJoin = 'round'; g.stroke(); } // (strokes on the edge)
  const d = g.getImageData(0, 0, R.cw, R.ch).data, m = new Float32Array(R.cw * R.ch);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] / 255;
  return m;
}
// near / far arm masks of the front (s) or back (n) drawing for a view, the side drawing's arm, and per row the arms'
// centres (SS px from the axis; X: + = its left, Z: + = its front)
function armMasks(R, pd, view) {
  const key = `${R.cw}x${R.ch}:${R.pad}:${pd}:${view}`;
  let M = MASKS.get(key);
  if (M) return M;
  const nearSide = view === 'ne' ? 1 : -1; // (front: its right arm is on the screen's left; back: on the right)
  M = { near: maskOf(R, (g) => armPath(g, pd, nearSide), 1.2), far: maskOf(R, (g) => armPath(g, pd, -nearSide), 1.2), side: maskOf(R, (g) => armPath(g, 'e'), 1.2), body: maskOf(R, (g) => bodyPath(g, pd)) };
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS, flip = pd === 'n' ? -1 : 1;
  // the shoulders stay with the torso (the arm hangs from the armpit down: a soft start)
  for (let y = 0; y < H; y++) {
    const by = y / SS - R.pad, k = by < ARM_Y0 ? 0 : by > ARM_Y1 ? 1 : (by - ARM_Y0) / (ARM_Y1 - ARM_Y0);
    if (k < 1) for (const m of [M.near, M.far, M.side]) for (let x = 0; x < W; x++) m[y * W + x] *= k;
  }
  const centre = (m, f) => {
    const C = new Float32Array(H).fill(NaN);
    for (let y = 0; y < H; y++) { let a = 0, n = 0; for (let x = 0; x < W; x++) if (m[y * W + x] > 0.5) { a += x + 0.5 - ax; n++; } if (n) C[y] = (a / n) * f; }
    return C;
  };
  M.nearC = centre(M.near, flip); M.farC = centre(M.far, flip); M.sideC = centre(M.side, 1);
  // the near arm hangs straight from its shoulder: one X for every row (the mean over the arm)
  let sx = 0, n = 0;
  for (let y = 0; y < H; y++) if (!Number.isNaN(M.nearC[y]) && !Number.isNaN(M.sideC[y])) { sx += M.nearC[y]; n++; }
  M.nearX = new Float32Array(H).fill(NaN);
  for (let y = 0; y < H; y++) if (!Number.isNaN(M.sideC[y])) M.nearX[y] = n ? sx / n : 0;
  MASKS.set(key, M);
  return M;
}
// a copy of a layer without the masked pixels (keep) / with only them (only)
function keep(px, a, b) { const o = new Uint8ClampedArray(px); for (let i = 0, n = a.length; i < n; i++) { const k = 1 - Math.min(1, a[i] + (b ? b[i] : 0)); if (k < 1) o[i * 4 + 3] *= k; } return o; }
function only(px, m) { const o = new Uint8ClampedArray(px); for (let i = 0, n = m.length; i < n; i++) o[i * 4 + 3] *= m[i]; return o; }
// fill an arm hole with the torso next to it (a few px in from the edge: the crease line along the arm stays out)
// (cover: the torso's outline — under a bare arm the clothes go on)
function fillHole(px, m, src, cover, W, H) {
  const IN = 3 * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (m[i] < 0.02 || (src[i * 4 + 3] < 8 && cover[i] < 0.5)) continue;
      // mirrored across the arm's edge (the torso's shading goes on), else the pixel next to it
      let from = -1;
      let doneF = false, doneB = false;
      for (let k = 1; k < 48 && from < 0 && !(doneF && doneB); k++) {
        const xf = x + k, xb = x - k;
        if (!doneF && xf + IN < W && m[y * W + xf] < 0.02) {
          doneF = true; // (only the torso right next to the arm: a layer that has nothing there leaves the hole)
          if (px[(y * W + xf + IN) * 4 + 3] > 200) { const xm = xf + IN + k; from = y * W + (xm < W && m[y * W + xm] < 0.02 && px[(y * W + xm) * 4 + 3] > 200 ? xm : xf + IN); }
        }
        if (from < 0 && !doneB && xb - IN >= 0 && m[y * W + xb] < 0.02) {
          doneB = true;
          if (px[(y * W + xb - IN) * 4 + 3] > 200) { const xm = xb - IN - k; from = y * W + (xm >= 0 && m[y * W + xm] < 0.02 && px[(y * W + xm) * 4 + 3] > 200 ? xm : xb - IN); }
        }
      }
      if (from < 0) continue;
      const a = Math.max(src[i * 4 + 3], cover[i] * 255);
      px[i * 4] = px[from * 4]; px[i * 4 + 1] = px[from * 4 + 1]; px[i * 4 + 2] = px[from * 4 + 2]; px[i * 4 + 3] = a;
    }
  }
}
// an arm laid at its place in the 3/4 view, over `out`: srcSide: the side drawing (source x = its depth Z) or the
// front / back one (source x = its X); k = width kept from the source drawing; dark: shade (an arm behind the body)
function projectArm(R, px, Xc, Zc, view, srcSide, k, dark, out) {
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS, g = GAMMA[view], cg = Math.cos(g), sg = Math.sin(g);
  const back = view === 'ne';
  for (let y = 0; y < H; y++) {
    const xc = Xc[y];
    if (Number.isNaN(xc)) continue;
    const zc = Number.isNaN(Zc[y]) ? 0 : Zc[y];
    const base = srcSide ? xc * cg : xc * cg + zc * sg; // (the arm's axis on screen)
    const slope = srcSide ? k : k * (cg < 0 ? -1 : 1);
    for (let i = 0; i < W; i++) {
      const q = (i + 0.5 - ax - base) / slope; // Z (side) or X − xc (front / back)
      const sx = srcSide ? ax + q : ax + (back ? -(xc + q) : xc + q);
      if (sx < -1 || sx > W + 1) continue;
      sample(px, W, H, y, sx, Math.max(1, 1 / k));
      if (ACC[3] < 1) continue;
      const o = (y * W + i) * 4, a = Math.min(1, ACC[3] / 255), inv = 1 - a;
      const r = (ACC[0] / ACC[3]) * dark, gg = (ACC[1] / ACC[3]) * dark, b = (ACC[2] / ACC[3]) * dark;
      const da = out[o + 3] / 255, na = a + da * inv;
      if (na <= 0) continue;
      out[o] = (r * a + out[o] * da * inv) / na; out[o + 1] = (gg * a + out[o + 1] * da * inv) / na; out[o + 2] = (b * a + out[o + 2] * da * inv) / na; out[o + 3] = na * 255;
    }
  }
}
// b over a (straight RGBA buffers, in place in a)
function over(a, b) {
  for (let o = 0; o < a.length; o += 4) {
    const ba = b[o + 3] / 255;
    if (ba <= 0) continue;
    const aa = a[o + 3] / 255, inv = 1 - ba, na = ba + aa * inv;
    a[o] = (b[o] * ba + a[o] * aa * inv) / na; a[o + 1] = (b[o + 1] * ba + a[o + 1] * aa * inv) / na; a[o + 2] = (b[o + 2] * ba + a[o + 2] * aa * inv) / na; a[o + 3] = na * 255;
  }
  return a;
}

// ragged hair: the turned outline smoothed — an opening (thin spikes, one-pixel jags off) then a closing (notches
// between curls filled with the hair next to them), radius r px; the curls bigger than that stay
function smoothOutline(px, W, H, r = 2 * SS) {
  const n = W * H, A = new Uint8Array(n);
  for (let i = 0; i < n; i++) A[i] = px[i * 4 + 3] > 110 ? 1 : 0;
  const morph = (src, grow) => {
    const t = new Uint8Array(n), o = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 1;
      for (let k = -r; k <= r; k++) { const xx = x + k; const q = xx < 0 || xx >= W ? 0 : src[y * W + xx]; if (grow ? q : !q) { v = grow ? 1 : 0; break; } }
      t[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = grow ? 0 : 1;
      for (let k = -r; k <= r; k++) { const yy = y + k; const q = yy < 0 || yy >= H ? 0 : t[yy * W + x]; if (grow ? q : !q) { v = grow ? 1 : 0; break; } }
      o[y * W + x] = v;
    }
    return o;
  };
  const opened = morph(morph(A, false), true), M = morph(morph(opened, true), false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (A[i] && !M[i]) { px[i * 4 + 3] = 0; continue; } // (a spike / jag cut off)
    if (!A[i] && M[i]) { // (a notch filled: the nearest hair's colour)
      let best = -1;
      for (let d = 1; d <= r + 2 && best < 0; d++) for (let dy = -d; dy <= d && best < 0; dy++) for (let dx = -d; dx <= d; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && A[yy * W + xx] && M[yy * W + xx]) { best = yy * W + xx; break; }
      }
      if (best >= 0) { px[i * 4] = px[best * 4]; px[i * 4 + 1] = px[best * 4 + 1]; px[i * 4 + 2] = px[best * 4 + 2]; px[i * 4 + 3] = 255; }
    }
  }
}

// tiny islands left by the projection (a strand's tip past what hides it): dropped from every layer
export function dropCrumbs(layers, W, H, minA = 14 * SS * SS) {
  const n = W * H, lab = new Int32Array(n), on = new Uint8Array(n), stack = new Int32Array(n);
  for (const L of layers) for (let i = 0; i < n; i++) if (L.px[i * 4 + 3] > 40) on[i] = 1;
  let id = 0;
  const small = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (!on[s0] || lab[s0]) continue;
    id++; let sp = 0, area = 0; stack[sp++] = s0; lab[s0] = id;
    while (sp) {
      const i = stack[--sp]; area++;
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && on[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && on[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && on[i - W] && !lab[i - W]) { lab[i - W] = id; stack[sp++] = i - W; }
      if (y < H - 1 && on[i + W] && !lab[i + W]) { lab[i + W] = id; stack[sp++] = i + W; }
    }
    if (area < minA) small.push(id);
  }
  if (!small.length || id === small.length) return; // (nothing to drop / everything is small: keep it)
  const drop = new Uint8Array(id + 1);
  for (const k of small) drop[k] = 1;
  for (const L of layers) for (let i = 0; i < n; i++) if (drop[lab[i]] || (!lab[i] && L.px[i * 4 + 3] > 0 && near(lab, drop, i, W, H))) L.px[i * 4 + 3] = 0;
}
// a faint pixel next to a dropped island goes with it
function near(lab, drop, i, W, H) {
  const x = i % W, y = (i / W) | 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < W && yy >= 0 && yy < H && drop[lab[yy * W + xx]]) return true; }
  return false;
}

// ---------------- part kinds ----------------
// body: on the torso stand-in (∪ its own outline: skirts, ponchos, armour) · head: the skull · hair: own ∪ skull
// (hair, beards, hats, helmets) · decal: front drawing only on the head (eyes, nose, mouth, brows, marks, masks) ·
// ears: the side drawing's near ear only · back: front drawing only on its own outline (long hair behind the back)
// · foot: own outlines (a boot turned 45°)
export function kindOf(name) {
  if (/^lk_over_(poncho|shawl)_/.test(name)) return 'cape';
  if (/^lk_over_apron_/.test(name)) return 'panel'; // (a flat front panel: the side drawing shows its edge)
  if (/^lk_(skin|top|trim|neck|pat|over|bot|shoe)_|^wear_(tunic|armor|coat)|^wk_(armor|ice)_/.test(name)) return 'body';
  if (/^lk_head_/.test(name)) return 'head';
  if (/^lk_ears_/.test(name)) return 'ears';
  if (/^lk_hairb/.test(name)) return 'back';
  if (/^lk_(hair|hairx|beard)_|^wear_|^hat_/.test(name)) return 'hair';
  if (/^lk_foot_/.test(name)) return 'foot';
  if (/^lk_nose_/.test(name)) return 'nose';
  return 'decal';
}
const BOX = { body: 'body', cape: 'body', panel: 'body', head: 'head', hair: 'head', decal: 'head', nose: 'head', ears: 'head', back: null, foot: null };

// ---------------- the nose in 3/4 ----------------
// The front drawing (shading, nostrils) lies on the turned face like the other face marks; under it, the nose's
// profile: the side drawing's nose (what sticks out past the face) put at the face's midline, its depth stretched
// so the tip just breaks the cheek's outline on the turned side (a 3/4 nose reads, a long one more than a button).
// Only what reaches the cheek's outline is kept (inside the face the front drawing is the nose: the profile's bridge
// line there was a dark slash across the cheek)
const NOSE_OUT = (OW + 1.2) * SS, NOSE_IN = 1.5 * SS, NOSE_EDGE = (OW + 1.5) * SS; // (OW: past the head's own outline)
function noseBump(R, pxS, C, view) {
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS, g = GAMMA[view], cg = Math.cos(g), sg = Math.sin(g);
  const out = new Uint8ClampedArray(W * H * 4);
  if (!pxS || !C || view !== 'se') return out;
  // the tip: the side drawing's furthest pixel past the face line
  let tipY = -1, protr = 0;
  for (let y = 0; y < H; y++) {
    const zf = C.Z[y * 2 + 1];
    if (Number.isNaN(zf)) continue;
    for (let x = W - 1, o = (y * W + W - 1) * 4 + 3; x >= 0; x--, o -= 4) if (pxS[o] > 60) { const d = x + 0.5 - ax - zf; if (d > protr) { protr = d; tipY = y; } break; }
  }
  if (tipY < 0 || protr < SS) return out;
  const e = rowEll(C.X, C.Z, tipY);
  const gap = e[0] * cg + e[2] * sg + Math.hypot(e[1] * cg, e[3] * sg) - (e[0] * cg + C.Z[tipY * 2 + 1] * sg);
  const E = Math.min(2.6, Math.max(1, (gap + NOSE_OUT + 0.15 * (protr - 5 * SS)) / (protr * sg)));
  for (let y = 0; y < H; y++) {
    const zf = C.Z[y * 2 + 1], r = rowEll(C.X, C.Z, y);
    if (Number.isNaN(zf) || !r) continue;
    const mid = r[0] * cg + zf * sg, rim = r[0] * cg + r[2] * sg + Math.hypot(r[1] * cg, r[3] * sg);
    for (let i = 0; i < W; i++) {
      const xs = i + 0.5 - ax, Zs = zf + (xs - mid) / (sg * E);
      if (Zs < zf - NOSE_IN || xs < rim - NOSE_EDGE) continue;
      sample(pxS, W, H, y, ax + Zs, 1 / E);
      if (ACC[3] < 1) continue;
      const k = smoothstep(zf - NOSE_IN, zf + 0.5 * SS, Zs) * smoothstep(rim - NOSE_EDGE, rim - NOSE_EDGE * 0.4, xs), o = (y * W + i) * 4;
      out[o] = ACC[0] / ACC[3]; out[o + 1] = ACC[1] / ACC[3]; out[o + 2] = ACC[2] / ACC[3]; out[o + 3] = Math.min(255, ACC[3]) * k;
    }
  }
  return out;
}

const defOf = (name) => lookDefs().get(name) || PAINT_DEFS.get(name) || null;
const sideName = (name) => name.replace(/_[sn]$/, '_e');

// the padded 3/4 canvas of a part (sources: front / back def, side def). behind: a part drawn in the front view only
// (a beard) seen from the back-side: its front drawing gives the volume, the side drawing the pixels, and the head
// hides the rest (the edge along the near jaw shows)
export function threeQuarter(dF, dS, kind, view, behind = false, style = null) {
  const ragged = style === 'ragged', crest = style === 'crest';
  const pd = view === 'ne' ? 'n' : 's', box = BOX[kind];
  const pad = Math.max(PADQ, dF?.pad ?? 0);
  const F = kind === 'ears' ? null : record(dF, pad);
  const S = kind === 'decal' || kind === 'back' || kind === 'panel' ? null : record(dS, pad);
  const R = F || S;
  if (!R) return null;
  const C = box ? canon(box, pd) : null;
  // the front / back drawing's near arm is not on the torso: the torso goes on under it (the side drawing brings the
  // near arm); the far arm folds into the far edge with the torso
  let M = null, armsS = null;
  if (kind === 'body' && F && S) {
    M = armMasks(R, pd, view);
    for (const L of F.layers) { const src = L.px; L.px = keep(src, M.near); fillHole(L.px, M.near, src, M.body, R.cw, R.ch); }
    if (ARM_OVER) armsS = S.layers.map((L) => only(L.px, M.side));
  }
  // hair, beards, hats: their own outline (fall back on the head's where a drawing has nothing), hidden behind the head;
  // the volume from the outlined layers only (a mohawk's crest, not the faint stubble of its shaved sides: that lies on
  // the bare head)
  const own = kind === 'hair';
  const main = (Rr) => (Rr && own && Rr.layers.some((L) => L.ow > 0) ? { cw: Rr.cw, ch: Rr.ch, pad: Rr.pad, W: Rr.W, layers: Rr.layers.filter((L) => L.ow > 0) } : Rr);
  let X = F ? extents(main(F), pd === 'n') : null, Z = S ? extents(main(S)) : null;
  if (C && own) { const X1 = X ? fillE(stretch(X, Z), C.X) : C.X; Z = Z ? fillE(stretch(Z, X), C.Z) : C.Z; X = X1; }
  else if (C) { X = union(C.X, X); Z = kind === 'nose' ? C.Z : union(C.Z, Z); } // (the nose: on the bare head; its profile: noseBump)
  X = X && smoothE(X, own ? 6 : 2); Z = Z && smoothE(Z, own ? 6 : 2);
  // hair volumes are roundish: a row the side drawing shows thin (a cut-out in front of the ear) gets depth toward the face
  if (own && X && Z) for (let i = 0; i < X.length; i += 2) {
    if (Number.isNaN(X[i]) || Number.isNaN(Z[i])) continue;
    const rx = (X[i + 1] - X[i]) / 2, d = 1.2 * rx - (Z[i + 1] - Z[i]);
    if (d > 0) Z[i + 1] += d;
  }
  if (!X) X = new Float32Array(R.ch * 2).fill(NaN);
  if (!Z) Z = new Float32Array(R.ch * 2).fill(NaN);
  const n = Math.max(F ? F.layers.length : 0, S ? S.layers.length : 0);
  const layers = [];
  for (let i = 0; i < n; i++) {
    const lf = F?.layers[i], ls = S?.layers[i], L = lf || ls;
    if (kind === 'nose') layers.push({ px: noseBump(R, ls?.px || null, C, view), ow: L.ow, col: L.col, opacity: L.opacity }); // (under the face marks)
    const faint = own && C && L.ow === 0 && (F || S).layers.some((Q) => Q.ow > 0); // (stubble: on the bare head)
    let px = projectLayer(R, behind ? null : lf?.px || null, kind === 'nose' ? null : ls?.px || null, faint ? C.X : X, faint ? C.Z : Z, view, kind === 'decal' || kind === 'nose' || kind === 'back' || kind === 'panel', own && !(crest && !faint) ? occluder(pd) : null, crest && !faint ? 2 : behind, ragged && !faint ? RAGGED_FILL : 0); // (a crest: its profile all round, standing on the head)
    if (armsS && armsS[i]) projectArm(R, armsS[i], M.nearX, M.sideC, view, true, ARM_K, 1, px);
    layers.push({ px, ow: L.ow, col: L.col, opacity: L.opacity });
  }
  if (own) dropCrumbs(layers, R.cw, R.ch);
  if (ragged) for (const L of layers) if (L.ow > 0) smoothOutline(L.px, R.cw, R.ch);
  // composite with the layers' own outlines (paint.js FastPainter: same dilation, same crop / anchor handling)
  const tmp = canvas(R.cw, R.ch), tg = tmp.getContext('2d');
  return spritePxFast(R.W, R.H, (g, P) => {
    for (const L of layers) {
      tg.putImageData(new ImageData(L.px, R.cw, R.ch), 0, 0);
      P.layer((lg) => { lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(tmp, 0, 0); }, L.ow, L.col, L.opacity);
    }
  }, { pad });
}

// the look-texture record of a 3/4 part (painted later; null when there is nothing to make it from)
export function diagSprite(A, name, view) {
  if (!name) return null;
  const key = `~${view}:${name}`;
  if (!LAZY_DEFS.has(key)) {
    const dF = defOf(name);
    if (!dF) return null;
    const dS = defOf(sideName(name)), kind = kindOf(name), behind = view === 'ne' && /_s$/.test(name); // (a beard seen from behind)
    LAZY_DEFS.set(key, { ax: dF.ax ?? 0.5, ay: dF.ay ?? 1, canvas: () => threeQuarter(dF, dS, kind, view, behind && kind === 'hair', hairStyle(name)) || emptyCanvas() });
  }
  return lookAtlasOf(A).get(key);
}
function emptyCanvas() { const c = canvas(1, 1); c.origW = c.origH = 1; c.origin = { x: 0, y: 0 }; return c; }

// ---- a look rig's 3/4 stacks (cached on the rig) ----
function stackOf(A, D, list, view) {
  const res = [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i], s = diagSprite(A, l.s.name, view);
    if (!s) continue;
    D.need.push(s);
    res.push({ s, r: l.r, g: l.g, b: l.b, legs: l.legs });
  }
  return res;
}
export function diagRig(A, LK, view) {
  const C = LK.diag || (LK.diag = {});
  if (C[view]) return C[view];
  const pd = VIEW[view].pd;
  const D = { view, need: [], ready: false, epoch: -1, body: [], head: [], brows: [], beard: [], hair: [], hairBack: [], lids: null, foot: null };
  D.body = stackOf(A, D, LK.body[pd], view);
  D.head = stackOf(A, D, LK.head[pd], view);
  D.hair = stackOf(A, D, LK.hair[pd], view);
  D.brows = stackOf(A, D, LK.brows[pd], view);
  D.beard = stackOf(A, D, view === 'ne' ? LK.beard.s : LK.beard[pd], view); // (no back drawing: from behind, its edge)
  D.hairBack = stackOf(A, D, LK.hairBack[pd], view);
  const ls = LK.lids[pd];
  if (ls) { D.lids = diagSprite(A, ls.name, view); if (D.lids) D.need.push(D.lids); }
  const ft = LK.feet.s;
  if (ft) { D.foot = diagSprite(A, ft.name, view); if (D.foot) D.need.push(D.foot); }
  C[view] = D;
  return D;
}
// are all parts of a 3/4 rig painted and placed? urgent: paint the missing ones now (the local player; at most
// URGENT_MS per frame — a whole new rig is ~15 parts of a few ms: the rest the next frames, the nearest side meanwhile)
const URGENT_MS = 12;
export function diagReady(D, A, urgent = false) {
  const LA = lookAtlasOf(A);
  if (D.ready && D.epoch === LA.epoch) return true;
  let ok = true;
  const t0 = urgent ? performance.now() : 0;
  for (const r of D.need) {
    if (r.ready || r.failed) continue;
    if (urgent && performance.now() - t0 < URGENT_MS) LA.paintNow(r); else LA.want(r);
    if (!r.ready && !r.failed) ok = false;
  }
  D.ready = ok; D.epoch = LA.epoch;
  return ok;
}
// one 3/4 part outside a look (armour, bandana, masks, walker overlays): the record when painted, else asks for it
export function diagPart(A, name, view, urgent = false) {
  const r = diagSprite(A, name, view);
  if (!r || r.failed) return null;
  if (r.ready) { r.lu = LOOK_CLOCK.f; return r; }
  const LA = lookAtlasOf(A);
  if (urgent) LA.paintNow(r); else LA.want(r);
  return r.ready ? r : null;
}

// where a point of the front head drawing lands in the 3/4 head (tiles from the axis; ly: tiles above the neck)
export function turnX(x, ly, view) {
  const C = canon('head', VIEW[view].pd), H = lookDefs().get('lk_head_round_s');
  if (!C || !H) return x;
  const y = Math.round((PADQ + H.ay * H.H - ly * 64) * SS), X0 = (view === 'ne' ? -x : x) * 64 * SS;
  let lo = C.X[y * 2], hi = C.X[y * 2 + 1], zl = C.Z[y * 2], zh = C.Z[y * 2 + 1];
  if (Number.isNaN(lo) || Number.isNaN(zl)) return x * Math.cos(GAMMA[view]);
  const cx = (lo + hi) / 2, rx = (hi - lo) / 2, cz = (zl + zh) / 2, rz = (zh - zl) / 2;
  const q = Math.max(-1, Math.min(1, (X0 - cx) / rx)), sgn = view === 'ne' ? -1 : 1;
  const Zs = cz + sgn * rz * Math.sqrt(1 - q * q), g = GAMMA[view];
  return (X0 * Math.cos(g) + Zs * Math.sin(g)) / (64 * SS);
}
