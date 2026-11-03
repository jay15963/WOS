// Piers (trapiche) and bridges (ponte) as procedural 3D pieces (game/decks.js gives each piece its shape, o._dk).
// Like the roofs: the geometry is computed from the neighbours once per change (o._dk.sig) and cached on the piece in
// world coordinates (o._dg: QF floats per quad); a frame only culls the sides turned away, shades and copies the quads
// (FaceBatch.quadF — no allocation). Textures are atlas sprites painted at 64 px per tile (art/decks.js).
//
// Pier piece: the deck of boards (across the way out) at PIER_H, a fascia on the open sides, round piles on the tile
// corners (each corner drawn once: stubs over the deck on the outline, every other one under a platform, tall bollards
// with rope at the far end, short ones on the bank side), X braces under the open sides, boards ramping onto the bank
// on a log sill, a ladder down to the water at the far end.
// Bridge piece over the water: the deck (arched over a finished crossing: two segments per tile), fascia, stringers,
// posts at every tile edge, handrail + mid rail with a zig-zag of balusters, support bents (two piles, cap beam, X brace)
// at inner edges, an end board where the bridge stops. Abutment (on the bank): a stone body with parapets and newel
// pillars, the boards ramping up between them (an island between two runs: a flat stone pier).
// Stages while it is being built (blueprint progress): piles / stone ≥ 0.25, frame (beams, braces, fascia) ≥ 0.55, the
// deck and rails ≥ 0.85 — the rest stays the blue plan. Snow lies on the tops (season.snow), sun shadows on the water.
import { registerFaces } from './registry.js';
import { seen, shade, shadowRect } from './kit.js';
import { tintOf } from './props.js';
import { KIT_ENV } from '../archCompose.js';
import { PIER_H, LOW_H, RAMP, ghostShapes } from '../../game/decks.js';
import { BUILDINGS } from '../../game/content/buildings.js';

const QF = 28; // per quad: 4 corners × (x, y, h, u, v), r g b, nx ny, flags, stage, (spare)
const TWO = 1, SNOW = 2; // flags: two-sided board (never culled) · snow cap (drawn with the season's snow only)
const STAGE = [0.25, 0.55, 0.85];
const PAR = 0.2; // bridge parapet height over the ramp

// ---------- textures ----------
let SA = null, SS = null;
function sprites(A) {
  if (SA === A && SS) return SS;
  const g = (n) => (A.has(n) ? A.get(n) : null);
  const s = { planks: [g('deck_planks_0'), g('deck_planks_1'), g('deck_planks_2')], wood: g('deck_wood'), log: g('deck_log'), stone: g('deck_stone'), rope: g('deck_rope'), snow: g('deck_snow') };
  if (!s.planks[0] || !s.planks[1] || !s.planks[2] || !s.wood || !s.log || !s.stone || !s.rope || !s.snow) return null;
  SA = A; SS = s; s.key = (SS_KEY = (SS_KEY + 1) | 0);
  return s;
}
let SS_KEY = 0;

// ---------- geometry builder (scratch, grown on demand) ----------
let GA = new Float32Array(QF * 512), GN = 0;
const CR = new Float64Array(12), UV = new Float64Array(8); // corners a b c d (x, y, h) · their texture px (u, v)
function emit(s, r, g, b, nx, ny, fl, st) {
  if ((GN + 1) * QF > GA.length) { const n = new Float32Array(GA.length * 2); n.set(GA); GA = n; }
  const o = GN++ * QF, W = s.w * 64, H = s.h * 64, du = s.u1 - s.u0, dv = s.v1 - s.v0;
  for (let k = 0; k < 4; k++) {
    let pu = UV[k * 2], pv = UV[k * 2 + 1];
    pu = pu < 0.5 ? 0.5 : pu > W - 0.5 ? W - 0.5 : pu; pv = pv < 0.5 ? 0.5 : pv > H - 0.5 ? H - 0.5 : pv;
    const q = o + k * 5;
    GA[q] = CR[k * 3]; GA[q + 1] = CR[k * 3 + 1]; GA[q + 2] = CR[k * 3 + 2];
    GA[q + 3] = s.u0 + du * pu / W; GA[q + 4] = s.v0 + dv * pv / H;
  }
  GA[o + 20] = r; GA[o + 21] = g; GA[o + 22] = b; GA[o + 23] = nx; GA[o + 24] = ny; GA[o + 25] = fl; GA[o + 26] = st; GA[o + 27] = 0;
}
const cor = (k, x, y, h) => { CR[k * 3] = x; CR[k * 3 + 1] = y; CR[k * 3 + 2] = h; };
// texture window [u0, u1] × [v0, v1] (px): a → (u0, v0), b → (u1, v0), c → (u1, v1), d → (u0, v1); rot: the window turned
// a quarter (a face's width runs along v: the grain of a post standing up)
function win(u0, v0, u1, v1, rot = false) {
  if (!rot) { UV[0] = u0; UV[1] = v0; UV[2] = u1; UV[3] = v0; UV[4] = u1; UV[5] = v1; UV[6] = u0; UV[7] = v1; }
  else { UV[0] = u0; UV[1] = v0; UV[2] = u0; UV[3] = v1; UV[4] = u1; UV[5] = v1; UV[6] = u1; UV[7] = v0; }
}
// a deterministic window offset for variety
const off = (seed, span, room) => (room > span ? ((seed * 97.31) % 1 + 1) % 1 * (room - span) : 0);

// axis-aligned box [x0, x1] × [y0, y1] × [h0, h1]; sides: bits N 1 E 2 S 4 W 8 (default all); rot: the grain stands up
function box(s, x0, y0, x1, y1, h0, h1, r, g, b, st, seed = 0, sides = 15, top = true, rot = false, snow = null) {
  const hp = (h1 - h0) * 64, sw = s.w * 64, sh = s.h * 64;
  if (top) {
    const wu = (x1 - x0) * 64, wv = (y1 - y0) * 64, ou = off(seed, wu, sw), ov = off(seed + 0.37, wv, sh);
    cor(0, x0, y0, h1); cor(1, x1, y0, h1); cor(2, x1, y1, h1); cor(3, x0, y1, h1);
    win(ou, ov, ou + wu, ov + wv); emit(s, r, g, b, 0, 0, 0, st);
    if (snow) { win(x0 * 64 % 48, y0 * 64 % 48, x0 * 64 % 48 + wu, y0 * 64 % 48 + wv); emit(snow, 1, 1, 1, 0, 0, SNOW, st); }
  }
  const side = (ax, ay, bx, by, nx, ny, len, k) => {
    const L = len * 64, ou = off(seed + k * 0.21, rot ? hp : L, rot ? sw : sw), ov = off(seed + k * 0.53, rot ? L : hp, sh);
    cor(0, ax, ay, h1); cor(1, bx, by, h1); cor(2, bx, by, h0); cor(3, ax, ay, h0);
    if (rot) win(ou, ov, ou + hp, ov + L, true); else win(ou, ov, ou + L, ov + hp);
    emit(s, r, g, b, nx, ny, 0, st);
  };
  if (sides & 4) side(x0, y1, x1, y1, 0, 1, x1 - x0, 1);
  if (sides & 1) side(x1, y0, x0, y0, 0, -1, x1 - x0, 2);
  if (sides & 2) side(x1, y1, x1, y0, 1, 0, y1 - y0, 3);
  if (sides & 8) side(x0, y0, x0, y1, -1, 0, y1 - y0, 4);
}

// round pile: n sides around (cx, cy), radius rr, h0..h1 (grain along the pile); cap: its top
function pile(S, cx, cy, rr, h0, h1, st, cap = true, seed = 0) {
  const n = 6, s = S.log, sw = s.w * 64, step = (Math.PI * 2) / n, a0 = seed * 1.3;
  const wet = Math.min(h1, 0.05);
  for (let k = 0; k < n; k++) {
    const a = a0 + k * step, b = a + step, m = a + step / 2;
    const px = cx + rr * Math.cos(a), py = cy + rr * Math.sin(a), qx = cx + rr * Math.cos(b), qy = cy + rr * Math.sin(b);
    const fw = 2 * rr * Math.sin(step / 2) * 64, u = (k * fw) % (sw - fw);
    const nx = Math.cos(m), ny = Math.sin(m);
    // above the water line, then the wet band (darker) down into the water
    cor(0, qx, qy, h1); cor(1, px, py, h1); cor(2, px, py, wet); cor(3, qx, qy, wet);
    win(u, 2, u + fw, 2 + (h1 - wet) * 64); emit(s, 1, 1, 1, nx, ny, 0, st);
    if (h0 < wet) {
      cor(0, qx, qy, wet); cor(1, px, py, wet); cor(2, px, py, h0); cor(3, qx, qy, h0);
      win(u, 40, u + fw, 40 + (wet - h0) * 64); emit(s, 0.52, 0.56, 0.58, nx, ny, 0, st);
    }
  }
  if (!cap) return;
  // the cut top: a hexagon as two quads (end grain of the side wood, darker)
  const P = (k) => [cx + rr * Math.cos(a0 + k * step), cy + rr * Math.sin(a0 + k * step)];
  for (const [i, j, k, l] of [[0, 1, 2, 3], [0, 3, 4, 5]]) {
    const A = P(i), B = P(j), C = P(k), D = P(l);
    cor(0, A[0], A[1], h1); cor(1, B[0], B[1], h1); cor(2, C[0], C[1], h1); cor(3, D[0], D[1], h1);
    win(10, 10, 16, 16); emit(S.wood, 0.82, 0.74, 0.62, 0, 0, 0, st);
  }
}

// a beam from p0 to p1 (centre line, heights h0 → h1), w wide across, t tall; ends: cap bits 1 start 2 end
function beam(S, x0, y0, h0, x1, y1, h1, w, t, r, g, b, st, ends = 0, snow = null, seed = 0) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ex = dx / L, ey = dy / L, cx = -ey * w / 2, cy = ex * w / 2;
  const s = S.wood, sw = s.w * 64, len = Math.hypot(L, h1 - h0) * 64, ou = off(seed, len, sw), ov = off(seed + 0.5, 6, 64);
  const T = t / 2;
  // top
  cor(0, x0 - cx, y0 - cy, h0 + T); cor(1, x1 - cx, y1 - cy, h1 + T); cor(2, x1 + cx, y1 + cy, h1 + T); cor(3, x0 + cx, y0 + cy, h0 + T);
  win(ou, ov, ou + len, ov + w * 64); emit(s, r * 1.06, g * 1.06, b * 1.06, 0, 0, 0, st);
  if (snow) { win(ou % 32, 8, ou % 32 + len, 8 + w * 64); emit(snow, 1, 1, 1, 0, 0, SNOW, st); }
  // the two long sides
  for (const sg of [1, -1]) {
    const ox = cx * sg, oy = cy * sg;
    cor(0, x0 + ox, y0 + oy, h0 + T); cor(1, x1 + ox, y1 + oy, h1 + T); cor(2, x1 + ox, y1 + oy, h1 - T); cor(3, x0 + ox, y0 + oy, h0 - T);
    win(ou, ov + 8, ou + len, ov + 8 + t * 64); emit(s, r, g, b, -ey * sg, ex * sg, 0, st);
  }
  if (ends & 1) { cor(0, x0 + cx, y0 + cy, h0 + T); cor(1, x0 - cx, y0 - cy, h0 + T); cor(2, x0 - cx, y0 - cy, h0 - T); cor(3, x0 + cx, y0 + cy, h0 - T); win(4, 4, 4 + w * 64, 4 + t * 64); emit(s, r * 0.8, g * 0.8, b * 0.8, -ex, -ey, 0, st); }
  if (ends & 2) { cor(0, x1 - cx, y1 - cy, h1 + T); cor(1, x1 + cx, y1 + cy, h1 + T); cor(2, x1 + cx, y1 + cy, h1 - T); cor(3, x1 - cx, y1 - cy, h1 - T); win(4, 4, 4 + w * 64, 4 + t * 64); emit(s, r * 0.8, g * 0.8, b * 0.8, ex, ey, 0, st); }
}

// a thin board between two 3D points in a vertical plane (braces, balusters), w wide, seen from both sides
function board(S, x0, y0, h0, x1, y1, h1, w, r, g, b, st, seed = 0) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), dh = h1 - h0, n = Math.hypot(L, dh) || 1;
  const ex = L > 1e-6 ? dx / L : 1, ey = L > 1e-6 ? dy / L : 0;
  // across the board inside its plane: (−dh, L) / n in (horizontal, up)
  const ph = (-dh / n) * (w / 2), pu = (L / n) * (w / 2);
  cor(0, x0 + ex * ph, y0 + ey * ph, h0 + pu); cor(1, x1 + ex * ph, y1 + ey * ph, h1 + pu); cor(2, x1 - ex * ph, y1 - ey * ph, h1 - pu); cor(3, x0 - ex * ph, y0 - ey * ph, h0 - pu);
  const s = S.wood, len = n * 64, ou = off(seed, len, s.w * 64);
  win(ou, 20, ou + len, 20 + w * 64); emit(s, r, g, b, -ey, ex, TWO, st);
}

// a quad from four (x, y, h) corners with a texture window; n = its outward normal (0, 0 = a top)
function quad(s, ax, ay, ah, bx, by, bh, cx, cy, ch, dx, dy, dh, u0, v0, u1, v1, r, g, b, nx, ny, fl, st) {
  cor(0, ax, ay, ah); cor(1, bx, by, bh); cor(2, cx, cy, ch); cor(3, dx, dy, dh);
  win(u0, v0, u1, v1); emit(s, r, g, b, nx, ny, fl, st);
}

// ---------- pieces ----------
// a point along (a) / across (c) a piece of axis ax (1 = north-south: a ↔ y, c ↔ x)
let TX = 0, TY = 0, AX = 1;
const wx = (a, c) => TX + (AX === 1 ? c : a);
const wy = (a, c) => TY + (AX === 1 ? a : c);
const nA = (sg) => (AX === 1 ? [0, sg] : [sg, 0]); // normal toward +a / −a
const nC = (sg) => (AX === 1 ? [sg, 0] : [0, sg]);
// an edge of the tile in edge-local coordinates: s along it (0..1, clockwise seen from above), t outward
const EDGE = {
  1: (s, t) => [TX + s, TY - t], 2: (s, t) => [TX + 1 + t, TY + s], 4: (s, t) => [TX + 1 - s, TY + 1 + t], 8: (s, t) => [TX - t, TY + 1 - s],
};
const ENRM = { 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] };
const EDIR = { 1: [1, 0], 2: [0, 1], 4: [-1, 0], 8: [0, -1] }; // (the direction of growing s along each edge)
const EDGES = [1, 2, 4, 8];

function buildPier(S, o, d) {
  const H = PIER_H, FD = 0.085, R = 0.05, sd = (o.tx * 0.137 + o.ty * 0.291) % 1;
  TX = o.tx; TY = o.ty; AX = d.axis;
  const tw = 0.95 + 0.1 * sd; // (each piece a little different in tone)
  // piles (stage 0)
  for (let c = 0; c < 4; c++) {
    const kind = (d.piles >> (c * 3)) & 7;
    if (!kind) continue;
    const cx = o.tx + (c & 1), cy = o.ty + (c >> 1);
    const top = kind === 1 ? H - 0.05 : kind === 2 ? H + 0.03 : kind === 3 ? H + 0.1 : H + 0.3;
    pile(S, cx, cy, kind === 4 ? R * 1.25 : R, -0.03, top, 0, kind !== 1, c + sd * 7);
    if (kind === 4) pile({ ...S, log: S.rope }, cx, cy, R * 1.25 + 0.012, H + 0.17, H + 0.23, 2, false, c); // a rope wound on the bollard
  }
  // under the open sides: X braces (stage 1) and the fascia board (stage 1)
  for (const b of EDGES) {
    if (!(d.open & b)) continue;
    const E = EDGE[b], [nx, ny] = ENRM[b];
    const p0 = E(0.02, 0.02), p1 = E(0.98, 0.02);
    board(S, p0[0], p0[1], 0.03, p1[0], p1[1], H - FD, 0.045, 0.78 * tw, 0.74 * tw, 0.7 * tw, 1, sd + b);
    board(S, p0[0], p0[1], H - FD, p1[0], p1[1], 0.03, 0.045, 0.74 * tw, 0.7 * tw, 0.66 * tw, 1, sd + b * 2);
    const q0 = E(0, 0), q1 = E(1, 0);
    quad(S.wood, q0[0], q0[1], H, q1[0], q1[1], H, q1[0], q1[1], H - FD, q0[0], q0[1], H - FD, 2, 30, 66, 30 + FD * 64, 0.95 * tw, 0.92 * tw, 0.88 * tw, nx, ny, 0, 1);
  }
  // the deck (stage 2): boards across the way out
  const P = S.planks[d.v];
  quad(P, wx(0, 0), wy(0, 0), H, wx(0, 1), wy(0, 1), H, wx(1, 1), wy(1, 1), H, wx(1, 0), wy(1, 0), H, 0, 0, 64, 64, tw, tw, tw, 0, 0, 0, 2);
  quad(S.snow, wx(0, 0), wy(0, 0), H, wx(0, 1), wy(0, 1), H, wx(1, 1), wy(1, 1), H, wx(1, 0), wy(1, 0), H, 0, 0, 64, 64, 1, 1, 1, 0, 0, SNOW, 2);
  // boards ramping onto the bank, on a log sill (stage 0 sill, 2 boards)
  for (const b of EDGES) {
    if (!(d.land & b)) continue;
    const E = EDGE[b];
    const a0 = E(0.06, 0), a1 = E(0.94, 0), b0 = E(0.06, RAMP), b1 = E(0.94, RAMP);
    quad(P, b0[0], b0[1], LOW_H, b1[0], b1[1], LOW_H, a1[0], a1[1], H, a0[0], a0[1], H, 4, 40, 60, 62, tw * 0.96, tw * 0.96, tw * 0.96, 0, 0, 0, 2);
    quad(S.snow, b0[0], b0[1], LOW_H, b1[0], b1[1], LOW_H, a1[0], a1[1], H, a0[0], a0[1], H, 4, 40, 60, 62, 1, 1, 1, 0, 0, SNOW, 2);
    // the ramp's sides (wood, down to the ground): their normals run along the edge
    const [ex, ey] = EDIR[b];
    for (const [p, q, sg] of [[a0, b0, -1], [a1, b1, 1]]) {
      quad(S.wood, q[0], q[1], LOW_H, p[0], p[1], H, p[0], p[1], 0, q[0], q[1], 0, 6, 12, 6 + RAMP * 64, 12 + H * 64, 0.8 * tw, 0.76 * tw, 0.7 * tw, ex * sg, ey * sg, 0, 2);
    }
    const s0 = E(0.02, RAMP - 0.03), s1 = E(0.98, RAMP + 0.04);
    box(S.log, Math.min(s0[0], s1[0]), Math.min(s0[1], s1[1]), Math.max(s0[0], s1[0]), Math.max(s0[1], s1[1]), 0, 0.055, 0.92, 0.88, 0.82, 0, sd, 15, true, true);
  }
  // the far end: a ladder down into the water (stage 2)
  if (d.end) {
    const E = EDGE[d.end];
    for (const s of [0.37, 0.63]) {
      const p = E(s, 0.04);
      box(S.wood, p[0] - 0.016, p[1] - 0.016, p[0] + 0.016, p[1] + 0.016, -0.05, H + 0.16, 0.86, 0.8, 0.72, 2, s, 15, true, true);
    }
    for (let h = 0.0; h < H - 0.02; h += 0.075) {
      const p = E(0.37, 0.04), q = E(0.63, 0.04);
      beam(S, p[0], p[1], h, q[0], q[1], h, 0.024, 0.02, 0.8, 0.74, 0.66, 2, 0, null, h * 3);
    }
  }
}

function buildBridge(S, o, d) {
  TX = o.tx; TY = o.ty; AX = d.axis;
  const sd = (o.tx * 0.173 + o.ty * 0.311) % 1, tw = 0.95 + 0.1 * sd;
  const hA = (a) => (a < 0.5 ? d.h0 + (d.hm - d.h0) * a * 2 : d.hm + (d.h1 - d.hm) * (a - 0.5) * 2);
  if (!d.wet) return buildAbutment(S, o, d, hA, tw, sd);
  const P = S.planks[(((o.tx * 7 + o.ty * 13) % 3) + 3) % 3];
  const C0 = 0.03, C1 = 0.97, FD = 0.09;
  // support bent at the low edge (stage 0 piles, stage 1 cap + braces)
  if (d.bent) {
    const h = d.h0;
    for (const c of [0.14, 0.86]) pile(S, wx(0, c), wy(0, c), 0.062, -0.04, h - 0.17, 0, false, c * 9);
    const a0 = -0.06, a1 = 0.06;
    box(S.wood, Math.min(wx(a0, 0.04), wx(a1, 0.96)), Math.min(wy(a0, 0.04), wy(a1, 0.96)), Math.max(wx(a0, 0.04), wx(a1, 0.96)), Math.max(wy(a0, 0.04), wy(a1, 0.96)), h - 0.25, h - 0.17, 0.82 * tw, 0.78 * tw, 0.72 * tw, 1, sd);
    board(S, wx(0, 0.14), wy(0, 0.14), 0.04, wx(0, 0.86), wy(0, 0.86), h - 0.26, 0.045, 0.76, 0.72, 0.66, 1, sd + 1);
    board(S, wx(0, 0.14), wy(0, 0.14), h - 0.26, wx(0, 0.86), wy(0, 0.86), 0.04, 0.045, 0.72, 0.68, 0.62, 1, sd + 2);
  }
  // two segments along the arch
  for (let k = 0; k < 2; k++) {
    const a0 = k * 0.5, a1 = a0 + 0.5, h0 = hA(a0), h1 = hA(a1);
    // stringers (inset, under the fascia) and the fascia boards on both sides (stage 1)
    for (const sg of [-1, 1]) {
      const cF = sg < 0 ? C0 : C1, cS = sg < 0 ? 0.09 : 0.91, [nx, ny] = nC(sg);
      quad(S.wood, wx(a0, cS), wy(a0, cS), h0 - FD, wx(a1, cS), wy(a1, cS), h1 - FD, wx(a1, cS), wy(a1, cS), h1 - 0.18, wx(a0, cS), wy(a0, cS), h0 - 0.18, a0 * 64, 40, a1 * 64, 46, 0.7 * tw, 0.66 * tw, 0.6 * tw, nx, ny, 0, 1);
      quad(S.wood, wx(a0, cF), wy(a0, cF), h0, wx(a1, cF), wy(a1, cF), h1, wx(a1, cF), wy(a1, cF), h1 - FD, wx(a0, cF), wy(a0, cF), h0 - FD, a0 * 64, 2, a1 * 64, 2 + FD * 64, 0.92 * tw, 0.88 * tw, 0.82 * tw, nx, ny, 0, 1);
    }
    // the deck boards (stage 2)
    const A = (c) => [wx(a0, c), wy(a0, c)], B = (c) => [wx(a1, c), wy(a1, c)];
    const p = A(C0), q = A(C1), r = B(C1), s = B(C0);
    cor(0, p[0], p[1], h0); cor(1, q[0], q[1], h0); cor(2, r[0], r[1], h1); cor(3, s[0], s[1], h1);
    UV[0] = C0 * 64; UV[1] = a0 * 64; UV[2] = C1 * 64; UV[3] = a0 * 64; UV[4] = C1 * 64; UV[5] = a1 * 64; UV[6] = C0 * 64; UV[7] = a1 * 64;
    emit(P, tw, tw, tw, 0, 0, 0, 2);
    emit(S.snow, 1, 1, 1, 0, 0, SNOW, 2);
    // railings (stage 2): handrail, mid rail and a zig-zag baluster on each side
    for (const c of [0.06, 0.94]) {
      beam(S, wx(a0, c), wy(a0, c), h0 + 0.31, wx(a1, c), wy(a1, c), h1 + 0.31, 0.06, 0.05, 0.98 * tw, 0.94 * tw, 0.86 * tw, 2, 0, S.snow, sd + k);
      beam(S, wx(a0, c), wy(a0, c), h0 + 0.16, wx(a1, c), wy(a1, c), h1 + 0.16, 0.035, 0.03, 0.9 * tw, 0.86 * tw, 0.78 * tw, 2, 0, null, sd + k + 0.5);
      const lo = k === 0, ha = lo ? 0.03 : 0.28, hb = lo ? 0.28 : 0.03;
      board(S, wx(a0 + 0.03, c), wy(a0 + 0.03, c), hA(a0 + 0.03) + ha, wx(a1 - 0.03, c), wy(a1 - 0.03, c), hA(a1 - 0.03) + hb, 0.032, 0.86 * tw, 0.82 * tw, 0.74 * tw, 2, sd + c);
    }
  }
  // posts at the low edge (and closing the run at the high edge)
  const post = (a) => {
    const h = hA(a);
    for (const c of [0.06, 0.94]) {
      const x = wx(a, c), y = wy(a, c);
      box(S.wood, x - 0.04, y - 0.04, x + 0.04, y + 0.04, h - 0.1, h + 0.36, 0.9 * tw, 0.85 * tw, 0.76 * tw, 2, sd + a + c, 15, true, true, S.snow);
    }
  };
  post(0);
  if (d.postHi) post(1);
  // the bridge stops here (no next piece): an end board across, the stringers' ends
  for (const [a, sg, nb] of [[0, -1, d.prev], [1, 1, d.next]]) {
    if (nb) continue;
    const h = hA(a), [nx, ny] = nA(sg);
    quad(S.wood, wx(a, C0), wy(a, C0), h, wx(a, C1), wy(a, C1), h, wx(a, C1), wy(a, C1), h - FD, wx(a, C0), wy(a, C0), h - FD, 2, 50, 62, 50 + FD * 64, 0.85 * tw, 0.8 * tw, 0.72 * tw, nx, ny, 0, 1);
  }
}

// a stone abutment on the bank (or an island pier between two runs)
function buildAbutment(S, o, d, hA, tw, sd) {
  const st = S.stone, h0 = d.h0, h1 = d.h1, c0 = -0.03, c1 = 1.03, i0 = 0.1, i1 = 0.9;
  const P = S.planks[(((o.tx * 7 + o.ty * 13) % 3) + 3) % 3];
  const ts = 0.96 + 0.08 * sd;
  // outer sides, up to the parapet tops (stage 0)
  for (const sg of [-1, 1]) {
    const c = sg < 0 ? c0 : c1, [nx, ny] = nC(sg);
    quad(st, wx(0, c), wy(0, c), h0 + PAR, wx(1, c), wy(1, c), h1 + PAR, wx(1, c), wy(1, c), -0.04, wx(0, c), wy(0, c), -0.04, 0, 64 - (Math.max(h0, h1) + PAR + 0.04) * 64, 64, 64, ts, ts, ts, nx, ny, 0, 0);
    // the parapet: inner face, sloped top
    const ci = sg < 0 ? i0 : i1, [mx, my] = nC(-sg);
    quad(st, wx(0, ci), wy(0, ci), h0 + PAR, wx(1, ci), wy(1, ci), h1 + PAR, wx(1, ci), wy(1, ci), h1, wx(0, ci), wy(0, ci), h0, 0, 2, 64, 2 + PAR * 64, ts * 0.92, ts * 0.92, ts * 0.92, mx, my, 0, 0);
    const ca = Math.min(c, ci), cb = Math.max(c, ci);
    quad(st, wx(0, ca), wy(0, ca), h0 + PAR, wx(0, cb), wy(0, cb), h0 + PAR, wx(1, cb), wy(1, cb), h1 + PAR, wx(1, ca), wy(1, ca), h1 + PAR, 20, 0, 20 + (cb - ca) * 64, 64, ts * 1.04, ts * 1.04, ts * 1.04, 0, 0, 0, 0);
    quad(S.snow, wx(0, ca), wy(0, ca), h0 + PAR, wx(0, cb), wy(0, cb), h0 + PAR, wx(1, cb), wy(1, cb), h1 + PAR, wx(1, ca), wy(1, ca), h1 + PAR, 20, 0, 20 + (cb - ca) * 64, 64, 1, 1, 1, 0, 0, SNOW, 0);
  }
  // end faces: at the water (stone down into it) and on the bank (the parapets' ends)
  for (const [a, sg] of [[0, -1], [1, 1]]) {
    const h = a ? h1 : h0, [nx, ny] = nA(sg), water = (sg > 0 ? d.next : d.prev) === 2 || (d.ramp === 0) || (sg > 0 ? d.ramp > 0 : d.ramp < 0);
    const L = sg > 0 ? [c1, i1, i0, c0] : [c0, i0, i1, c1]; // left to right seen from outside
    // parapet ends
    quad(st, wx(a, L[0]), wy(a, L[0]), h + PAR, wx(a, L[1]), wy(a, L[1]), h + PAR, wx(a, L[1]), wy(a, L[1]), water ? -0.04 : 0, wx(a, L[0]), wy(a, L[0]), water ? -0.04 : 0, 2, 4, 10, 4 + (h + PAR + 0.04) * 64, ts * 0.95, ts * 0.95, ts * 0.95, nx, ny, 0, 0);
    quad(st, wx(a, L[2]), wy(a, L[2]), h + PAR, wx(a, L[3]), wy(a, L[3]), h + PAR, wx(a, L[3]), wy(a, L[3]), water ? -0.04 : 0, wx(a, L[2]), wy(a, L[2]), water ? -0.04 : 0, 52, 4, 60, 4 + (h + PAR + 0.04) * 64, ts * 0.95, ts * 0.95, ts * 0.95, nx, ny, 0, 0);
    // between them: the stone face under the deck
    quad(st, wx(a, L[1]), wy(a, L[1]), h, wx(a, L[2]), wy(a, L[2]), h, wx(a, L[2]), wy(a, L[2]), water ? -0.04 : 0, wx(a, L[1]), wy(a, L[1]), water ? -0.04 : 0, 8, 20, 60, 20 + (h + 0.04) * 64, ts * 0.9, ts * 0.9, ts * 0.9, nx, ny, 0, 0);
  }
  // newel pillars at the bank end (stage 0)
  if (d.ramp) {
    const aL = d.ramp > 0 ? 0 : 1, a0 = aL ? 0.84 : 0, a1 = aL ? 1 : 0.16, hT = (aL ? h1 : h0) + 0.34;
    for (const [ca, cb] of [[-0.06, 0.13], [0.87, 1.06]]) {
      const xa = wx(a0, ca), ya = wy(a0, ca), xb = wx(a1, cb), yb = wy(a1, cb);
      box(st, Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb), 0, hT, ts * 1.02, ts * 1.02, ts * 1.02, 0, sd + ca, 15, true, false, S.snow);
    }
  }
  // the boards between the parapets (stage 2)
  cor(0, wx(0, i0), wy(0, i0), h0 + 0.006); cor(1, wx(0, i1), wy(0, i1), h0 + 0.006); cor(2, wx(1, i1), wy(1, i1), h1 + 0.006); cor(3, wx(1, i0), wy(1, i0), h1 + 0.006);
  UV[0] = i0 * 64; UV[1] = 0; UV[2] = i1 * 64; UV[3] = 0; UV[4] = i1 * 64; UV[5] = 64; UV[6] = i0 * 64; UV[7] = 64;
  emit(P, tw, tw, tw, 0, 0, 0, 2);
  emit(S.snow, 1, 1, 1, 0, 0, SNOW, 2);
}

function buildGeo(S, o, d) {
  GN = 0;
  if (d.k === 'pier') buildPier(S, o, d); else buildBridge(S, o, d);
  return GN;
}
function cache(S, o, d) {
  let g = o._dg;
  if (g && g.sig === d.sig && g.key === S.key && g.tx === o.tx && g.ty === o.ty) return g;
  const n = buildGeo(S, o, d);
  g = o._dg = { sig: d.sig, key: S.key, tx: o.tx, ty: o.ty, n, a: GA.slice(0, n * QF) }; // (once per change)
  return g;
}

// ---------- ghosts (the placement preview) ----------
let GK = '', GM = null;
function ghostDesc(o) {
  const g = KIT_ENV.game, m = g?.build?.mode;
  if (!g || !m || !m.tiles) return null;
  let key = m.type + ':' + g.build.v;
  for (const t of m.tiles) key += t.ok ? `|${t.tx},${t.ty}` : '';
  if (key !== GK) { GK = key; GM = ghostShapes(g, m.type, m.tiles); }
  return GM.get(g.world.idx(o.tx, o.ty)) || (BUILDINGS[o.type]?.deck === 'pier' ? LONE_PIER : (LONE_BRIDGE.wet = !!g.world.water.get(g.world.idx(o.tx, o.ty)), LONE_BRIDGE)); // (a red ghost: a lone piece)
}
const LONE_PIER = { k: 'pier', nb: 0, land: 0, axis: 1, end: 0, piles: 3 | (3 << 3) | (3 << 6) | (3 << 9), open: 15, v: 0, sig: 'lone' };
const LONE_BRIDGE = { k: 'bridge', axis: 1, wet: true, h0: 0.3, hm: 0.3, h1: 0.3, prev: 0, next: 0, bent: 0, postHi: true, ramp: 1, rails: 10, sig: 'lone' };

// ---------- drawing ----------
const SH_T = { opt: null };
function draw(B, A, o) {
  const F = B.faces, S = F ? sprites(A) : null;
  if (!S) return false;
  let d = o._dk, src, n;
  if (o._ghost) {
    d = ghostDesc(o);
    if (!d) return false;
    n = buildGeo(S, o, d); src = GA;
  } else {
    if (!d || !d.sig) return false;
    const g = cache(S, o, d);
    src = g.a; n = g.n;
  }
  const TN = tintOf(o), al = o.alpha ?? 1;
  const p = o._ghost ? -1 : o.blueprint ? o.progress || 0 : 2;
  const game = KIT_ENV.game, snow = p >= 1 ? game?.season?.snow || 0 : 0;
  for (let q = 0; q < n; q++) {
    const k = q * QF, fl = src[k + 25];
    if (fl & SNOW) { if (snow < 0.02) continue; }
    const nx = src[k + 23], ny = src[k + 24];
    let sh = 1;
    if (nx || ny) {
      const vis = seen(nx, ny);
      if (!vis && !(fl & TWO)) continue;
      sh = vis ? shade(nx, ny) : shade(-nx, -ny) * 0.9;
    }
    if (fl & SNOW) { F.quadF(src, k, 1, 1, 1, snow * 0.92 * al); continue; }
    const done = p >= STAGE[src[k + 26]];
    if (done) F.quadF(src, k, src[k + 20] * sh, src[k + 21] * sh, src[k + 22] * sh, al);
    else F.quadF(src, k, src[k + 20] * sh * TN[0], src[k + 21] * sh * TN[1], src[k + 22] * sh * TN[2], TN[3]);
  }
  // sun shadows of the finished deck on the water (the box of the deck, railings as thin walls)
  if (p >= 1 && B.shadow) {
    if (SH_T.opt === null || SH_T.A !== A) { SH_T.A = A; SH_T.opt = (nm) => (A.has(nm) ? A.get(nm) : null); }
    const a = 0.85 * al;
    if (d.k === 'pier') shadowRect(B, SH_T, o.tx + 0.5, o.ty, 0, 1, 1, 0.08, a, PIER_H - 0.08);
    else {
      const h = (d.h0 + d.h1) / 2;
      if (!d.wet) shadowRect(B, SH_T, o.tx + 0.5, o.ty, 0, 1.06, 1, h + PAR, a, 0);
      else {
        shadowRect(B, SH_T, o.tx + 0.5, o.ty, 0, 1, 1, 0.09, a, h - 0.09);
        for (const c of [0.06, 0.94]) {
          const x = d.axis === 1 ? o.tx + c : o.tx + 0.5, y = d.axis === 1 ? o.ty : o.ty + c - 0.03;
          shadowRect(B, SH_T, x, y, 0, d.axis === 1 ? 0.06 : 1, d.axis === 1 ? 1 : 0.06, 0.34, a * 0.7, h);
        }
      }
    }
  }
  return true;
}

registerFaces({ id: 'deck', prio: 2, test: (o, d) => !!d && !!d.deck, draw });
