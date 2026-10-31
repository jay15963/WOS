// Camera rotation — the toolkit of the structure faces (walls, doors, fences, gates, things on walls).
//
// The north view is an oblique projection with a fixed key: a point of a piece at (xr, yr) inside its tile (0..1) and
// height h (tiles) is painted at frame pixel  col = 64·xr,  row = R0 + 64·yr − 64·h  of the piece's sprite frame
// (R0 = 64 for the 1×2-tile wall / door frames, PH = 36 for the fence / gate frames). So a face turned south finds its
// own art at those rows (drawn at 0° it is exactly the old sprite), and a top face its own art too; the other faces
// borrow the art of a face that looks the same. Art is laid in WORLD order (art column ↔ world position), so a face
// seen from behind shows it mirrored, like a real painted board.
// Only the part of a sprite its (cropped) image covers is drawn: the atlas neighbours are never sampled.
import { CAMV, KIT_ENV } from '../archCompose.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// a side whose outside faces the viewer (view y = −sin·x + cos·y grows toward the camera)
export const seen = (nx, ny) => -CAMV.s * nx + CAMV.c * ny > 0.02;
// view depth of a world point (larger = nearer the camera)
export const depthOf = (x, y) => -CAMV.s * x + CAMV.c * y;
// light on a vertical face: a south face keeps its painted look (as in the north view); a face turned more toward the
// sun than the south one is brighter, one turned away darker (CAMV.lx / ly: toward the sun)
export function shade(nx, ny) {
  const k = 1 + 0.26 * (nx * CAMV.lx + ny * CAMV.ly - CAMV.ly);
  return k < 0.6 ? 0.6 : k > 1.24 ? 1.24 : k;
}

// Lay the frame rect [c0, r0]–[c1, r1] (px) of sprite s on a parallelogram given by its corners TL (ax, ay, ah),
// TR (bx, by, bh) and BL (dx, dy, dh) (BR = TR + BL − TL); (ox, oy) = the sprite's anchor in frame px; flip = the
// art mirrored about the anchor column (a sprite drawn with sx < 0). Colour premultiplies; a < 0 = a glow (glow layer).
export function artQuad(F, s, flip, ox, oy, c0, r0, c1, r1, ax, ay, ah, bx, by, bh, dx, dy, dh, r, g, b, a) {
  if (!s || !(s.w > 0)) return;
  const W = s.w * 64, H = s.h * 64, ix0 = ox - s.ax * W, iy0 = oy - s.ay * H;
  const lo = flip ? 2 * ox - ix0 - W : ix0;
  const ca = c0 > lo + 0.5 ? c0 : lo + 0.5, cb = c1 < lo + W - 0.5 ? c1 : lo + W - 0.5;
  const ra = r0 > iy0 + 0.5 ? r0 : iy0 + 0.5, rb = r1 < iy0 + H - 0.5 ? r1 : iy0 + H - 0.5;
  if (cb <= ca || rb <= ra) return;
  const iu = 1 / (c1 - c0), iv = 1 / (r1 - r0);
  const u0 = (ca - c0) * iu, u1 = (cb - c0) * iu, v0 = (ra - r0) * iv, v1 = (rb - r0) * iv;
  const ux = bx - ax, uy = by - ay, uh = bh - ah, vx = dx - ax, vy = dy - ay, vh = dh - ah;
  const du = s.u1 - s.u0, dv = s.v1 - s.v0;
  const Ua = s.u0 + du * ((flip ? 2 * ox - ca : ca) - ix0) / W, Ub = s.u0 + du * ((flip ? 2 * ox - cb : cb) - ix0) / W;
  const Va = s.v0 + dv * (ra - iy0) / H, Vb = s.v0 + dv * (rb - iy0) / H;
  F.quad4(
    ax + ux * u0 + vx * v0, ay + uy * u0 + vy * v0, ah + uh * u0 + vh * v0, Ua, Va,
    ax + ux * u1 + vx * v0, ay + uy * u1 + vy * v0, ah + uh * u1 + vh * v0, Ub, Va,
    ax + ux * u1 + vx * v1, ay + uy * u1 + vy * v1, ah + uh * u1 + vh * v1, Ub, Vb,
    ax + ux * u0 + vx * v1, ay + uy * u0 + vy * v1, ah + uh * u0 + vh * v1, Ua, Vb,
    r, g, b, a);
}
// a vertical face from (xa, ya) to (xb, yb), heights hb..ht (rows r0 → ht, r1 → hb)
export function vq(F, s, flip, ox, oy, c0, r0, c1, r1, xa, ya, xb, yb, hb, ht, r, g, b, a) {
  artQuad(F, s, flip, ox, oy, c0, r0, c1, r1, xa, ya, ht, xb, yb, ht, xa, ya, hb, r, g, b, a);
}
// a horizontal face over [x0, x1] × [y0, y1] at height h (cols → x, rows → y)
export function tq(F, s, flip, ox, oy, c0, r0, c1, r1, x0, y0, x1, y1, h, r, g, b, a) {
  artQuad(F, s, flip, ox, oy, c0, r0, c1, r1, x0, y0, h, x1, y0, h, x0, y1, h, r, g, b, a);
}
// a face that turns toward the camera (round things: caps, birds, flowers, lanterns): the art column cc stands on the
// world point (px, py); row r1 at height hb, the rest above it at the art's own scale
export function bq(F, s, flip, ox, oy, c0, r0, c1, r1, cc, px, py, hb, r, g, b, a) {
  const C = CAMV.c, S = CAMV.s, l = (c0 - cc) / 64, rr = (c1 - cc) / 64, ht = hb + (r1 - r0) / 64;
  artQuad(F, s, flip, ox, oy, c0, r0, c1, r1, px + C * l, py + S * l, ht, px + C * rr, py + S * rr, ht, px + C * l, py + S * l, hb, r, g, b, a);
}

// flat colour (the centre texel of fx_solid)
const SOLID = [0, 0, 0, 0];
export function solidUV(T) {
  const s = T.opt('fx_solid');
  if (!s || s.u0 < 0) return null;
  SOLID[0] = SOLID[2] = (s.u0 + s.u1) / 2; SOLID[1] = SOLID[3] = (s.v0 + s.v1) / 2;
  return SOLID;
}

// sun shadows while turned (shadow shader world mode, flash < 0): the shadow of a box standing on the footprint
// rectangle that starts at (px, py) and runs L along the direction ang (0 = south), W wide across it, H tall — its four
// sides as upright cards (each sweeps its band along the sun) and its top lifted to H (MAX blend: no double dark)
export function shadowRect(B, T, px, py, ang, W, L, H, a, h0 = 0) {
  const s = T.opt('fx_solid'), sb = T.opt('fx_solid_b');
  if (!s || !sb || !B.shadow || !(H > 0)) return;
  const dx = -Math.sin(ang), dy = Math.cos(ang), nx = dy, ny = -dx; // along / across (+ = to the right of along)
  B.shadow.add(s, px, py, W / s.w, L / s.h, 1, 1, 1, a, 0, ang, -1, 1, 0, h0 + H);
  const hy = H / sb.h;
  // the two long sides (through the start and end of the width) and the two ends
  B.shadow.add(sb, px + nx * W / 2 + dx * L / 2, py + ny * W / 2 + dy * L / 2, L / sb.w, hy, 1, 1, 1, a, 0, ang + Math.PI / 2, -1, 1, 0, h0);
  B.shadow.add(sb, px - nx * W / 2 + dx * L / 2, py - ny * W / 2 + dy * L / 2, L / sb.w, hy, 1, 1, 1, a, 0, ang + Math.PI / 2, -1, 1, 0, h0);
  B.shadow.add(sb, px, py, W / sb.w, hy, 1, 1, 1, a, 0, ang, -1, 1, 0, h0);
  B.shadow.add(sb, px + dx * L, py + dy * L, W / sb.w, hy, 1, 1, 1, a, 0, ang, -1, 1, 0, h0);
}
// an upright part's own silhouette as its shadow (fences, gate leaves): sprite s anchored at (px, py) on the ground,
// its width along the direction ang (0 = east); lift = height of the anchor (negative: the art's foot is above it)
export function shadowArt(B, s, px, py, ang, flip, a, lift) {
  if (s && B.shadow) B.shadow.add(s, px, py, 1, 1, 1, 1, 1, a, 0, ang, -1, flip ? -1 : 1, 0, lift);
}

// parts of one piece drawn back to front (pooled: no allocation per frame)
const POOL = [];
let NP = 0;
export function partsReset() { NP = 0; }
export function part(d, k, i = 0, j = 0) {
  const p = POOL[NP] || (POOL[NP] = { d: 0, k: 0, i: 0, j: 0 });
  NP++;
  p.d = d; p.k = k; p.i = i; p.j = j;
  return p;
}
const byDepth = (a, b) => a.d - b.d;
const SORTED = [];
export function partsSorted() {
  SORTED.length = 0;
  for (let n = 0; n < NP; n++) SORTED.push(POOL[n]);
  return SORTED.sort(byDepth);
}

export const night = () => KIT_ENV.night;
