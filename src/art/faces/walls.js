// Camera rotation — walls (every style kit and the default look) as boxes of computed faces; things hung on walls;
// siege cracks on the faces.
//
// A wall's own painters (archCompose.drawWall) draw it into a recording, the same layers as in the north view: base,
// trims, corner pieces, windows and their night glow, shelves / paintings, ivy… Every layer drawn in the piece's frame
// is laid on the box: the frame's top half on the top, its facade half on each side that faces the camera.
//   - south / north side: the facade of a straight E-W run (recorded with the E / W neighbours only); the north one is
//     the same facade seen from behind (art in world order). Shelves / paintings / sconces: south only (where placed).
//   - east / west side: the facade recorded as if that side were the front (south neighbour on the left).
//   - inner sides (another wall / door next to it) are never drawn.
//   - crenels: 3D merlons on the top (their own art), never laid flat; window light pools on the sides the window
//     shows on; the sconce flame where the sconce hangs; the sun shadow of the box (world mode).
import { BUILDINGS } from '../../game/content/buildings.js';
import { STRUCT_GEOM as SG } from '../structures.js';
import { DECOR_GEOM as DG } from '../decor.js';
import { STONE_FAMS, CORNER_FAM, SOFT_MASKS } from '../arch.js';
import { CAMV, KIT_ENV, ARCH_FACES as K } from '../archCompose.js';
import { seen, shade, vq, tq, bq, artQuad, shadowRect, shadowArt, depthOf, partsReset, part, partsSorted } from './kit.js';

// the default look (no kit): drawn by the same painters as the style it is
const DEF_K = {
  plank: { kit: 'wall', style: 'plank', on: {}, tint: null, ids: [], n: 0 },
  cut: { kit: 'wall', style: 'cut', on: {}, tint: null, ids: [], n: 0 },
};
export const wallLook = (o) => o._k || DEF_K[o.type === 'wall_stone' || BUILDINGS[o.type]?.mat === 'stone' ? 'cut' : 'plank'];

// art drawn in 3D here, never laid flat: crenels (→ the south merlon sprite of their family) and stone buttresses
const SPECIAL = new WeakMap();
function specialsOf(T) {
  let M = SPECIAL.get(T);
  if (M) return M;
  M = new Map();
  const D = T.d;
  for (const e of ['n', 's', 'w']) if (D['cren_' + e]) M.set(D['cren_' + e], D.cren_s);
  for (const f in T.crenw) for (const e of ['n', 's', 'w']) if (T.crenw[f][e]) M.set(T.crenw[f][e], T.crenw[f].s);
  for (const f of STONE_FAMS) if (T.bt[f]) M.set(T.bt[f], BT);
  SPECIAL.set(T, M);
  return M;
}
const BT = { buttress: true };
const SOFT = new Set(SOFT_MASKS);
const WIN = ['window', 'window_shutters', 'window_curtains', 'window_round'];

// the facade layers of the last recording (L main, E glows) on one side (xa, ya) → (xb, yb), art columns c0..c1,
// heights hb..ht, light z
function facade(F, L, E, xa, ya, xb, yb, c0, c1, hb, ht, z) {
  for (const r of L) vq(F, r[0], r[3] < 0, 32, 128, c0, 64, c1, 128, xa, ya, xb, yb, hb, ht, r[5] * z, r[6] * z, r[7] * z, r[8]);
  for (const r of E) vq(F, r[0], r[3] < 0, 32, 128, c0, 64, c1, 128, xa, ya, xb, yb, hb, ht, r[5], r[6], r[7], -r[8]); // (lit windows: glow layer)
}
const facadeLayers = (o, CM) => K.layers(K.RM, o).filter((r) => !CM.has(r[0]));
const SQ = Math.SQRT1_2;
const TOP = [];
const MER = [[2, 2, 16, 11], [34, 2, 48, 11], [2, 56, 16, 64], [34, 56, 48, 64], [0, 8, 9, 22], [0, 40, 9, 54], [55, 8, 64, 22], [55, 40, 64, 54]];
const MER_E = [1, 1, 4, 4, 8, 8, 2, 2]; // the open edge each merlon stands on (mask bit that must be clear)

export function drawWallFaces(B, A, o, h0 = 0, t = 0) {
  const F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  const k = wallLook(o), kOver = o._k ? null : k;
  const m = (o.mask | 0) & 15, H = SG.FH, hb = h0, ht = h0 + H;
  const x0 = o.tx, y0 = o.ty, x1 = x0 + 1, y1 = y0 + 1;
  const sS = !(m & 4) && seen(0, 1), sN = !(m & 1) && seen(0, -1), sE = !(m & 2) && seen(1, 0), sW = !(m & 8) && seen(-1, 0);
  const CM = specialsOf(T);
  // the top first (kept aside: drawn last, its rim over the sides)
  K.recordPiece(A, o, m, t, false, null, kOver);
  TOP.length = 0;
  let cren = null;
  for (const r of K.layers(K.RM, o)) { const sp = CM.get(r[0]); if (sp === BT) continue; if (sp) cren = cren || r; else TOP.push(r); }
  if (!TOP.length) return false;
  const C = K.col(), bp = C.bp, a = C.a;
  if (!bp) shadowRect(B, T, x0 + 0.5, y0, 0, 1, 1, H, a, h0);
  // soft corners: each convex corner cut by a 45° face (the soft art's wrap-around columns on it)
  const soft = !!k.on.soft && SOFT.has(m), Rr = soft ? 10 / 64 : 0, RC = Rr * 64;
  const cSW = soft && !(m & 12), cSE = soft && !(m & 6), cNW = soft && !(m & 9), cNE = soft && !(m & 3);
  let dSW = cSW && seen(-SQ, SQ), dSE = cSE && seen(SQ, SQ), dNW = cNW && seen(-SQ, -SQ), dNE = cNE && seen(SQ, -SQ);
  const diag = (L, E, ax, ay, bx, by, c0, c1, nx, ny) => facade(F, L, E, ax, ay, bx, by, c0, c1, hb, ht, shade(nx, ny));
  // south / north: the facade of a straight E-W run
  if (sS || sN) {
    K.recordPiece(A, o, m & 10, t, !sS, null, kOver);
    const L = facadeLayers(o, CM), E = K.layers(K.RE, o);
    if (sS) {
      facade(F, L, E, x0 + (cSW ? Rr : 0), y1, x1 - (cSE ? Rr : 0), y1, cSW ? RC : 0, cSE ? 64 - RC : 64, hb, ht, 1);
      if (dSW) { diag(L, E, x0, y1 - Rr, x0 + Rr, y1, 0, RC, -SQ, SQ); dSW = false; }
      if (dSE) { diag(L, E, x1 - Rr, y1, x1, y1 - Rr, 64 - RC, 64, SQ, SQ); dSE = false; }
      // flames of what hangs on the south face (sconce): where the north view puts them
      for (const r of K.RE) if (r[9] || r[10] || Math.abs(Math.abs(r[3]) - 1) > 1e-3) B.emissive.add(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], 0, r[10], 0, 1, 0, r[9] + h0);
    } else {
      facade(F, L, E, x0 + (cNW ? Rr : 0), y0, x1 - (cNE ? Rr : 0), y0, cNW ? RC : 0, cNE ? 64 - RC : 64, hb, ht, shade(0, -1));
      if (dNW) { diag(L, E, x0, y0 + Rr, x0 + Rr, y0, 0, RC, -SQ, -SQ); dNW = false; }
      if (dNE) { diag(L, E, x1 - Rr, y0, x1, y0 + Rr, 64 - RC, 64, SQ, -SQ); dNE = false; }
    }
  }
  // east / west: the facade as if that side were the front (south on its left)
  if (sE || sW || dSW || dSE || dNW || dNE) {
    K.recordPiece(A, o, ((m & 4) ? 8 : 0) | ((m & 1) ? 2 : 0), t, true, null, kOver);
    const L = facadeLayers(o, CM), E = K.layers(K.RE, o);
    if (sE) facade(F, L, E, x1, y1 - (cSE ? Rr : 0), x1, y0 + (cNE ? Rr : 0), cSE ? RC : 0, cNE ? 64 - RC : 64, hb, ht, shade(1, 0));
    if (sW) facade(F, L, E, x0, y1 - (cSW ? Rr : 0), x0, y0 + (cNW ? Rr : 0), cSW ? RC : 0, cNW ? 64 - RC : 64, hb, ht, shade(-1, 0));
    if (dSE) diag(L, E, x1 - Rr, y1, x1, y1 - Rr, 0, RC, SQ, SQ);
    if (dSW) diag(L, E, x0 + Rr, y1, x0, y1 - Rr, 0, RC, -SQ, SQ);
    if (dNE) diag(L, E, x1, y0 + Rr, x1 - Rr, y0, 64 - RC, 64, SQ, -SQ);
    if (dNW) diag(L, E, x0, y0 + Rr, x0 + Rr, y0, 64 - RC, 64, -SQ, -SQ);
  }
  for (const r of TOP) tq(F, r[0], r[3] < 0, 32, 128, 0, 0, 64, 64, x0, y0, x1, y1, ht, r[5], r[6], r[7], r[8]);
  if (cren) merlons(F, CM.get(cren[0]), cren, m, x0, y0, ht);
  // stone buttresses: a pier against the middle of each open side that shows
  if (k.on.buttress) {
    const s = T.bt[CORNER_FAM[k.style]];
    if (s && CM.get(s) === BT && K.ok(s)) for (const [bit, nx, ny] of SIDES) if (!(m & bit) && seen(nx, ny)) buttress(F, s, bit, x0, y0, h0, H, C.tr, C.tg, C.tb, a);
  }
  // window light at night: a pool before each side the window shows on (the faces of the run)
  const n = KIT_ENV.night;
  if (n > 0.05 && !bp && B.light && WIN.some((w) => k.on[w])) {
    const lx = CAMV.s * h0, ly = -CAMV.c * h0; // (an upper story: the pool lifted with it, as game.js lifts lights)
    const pool = (nx, ny) => B.light.addRaw(x0 + 0.5 + nx * 0.42 + lx, y0 + 0.5 + ny * 0.42 + ly, 1.9, 1.3, 1, 0.7, 0.42, 0.22 * n);
    if (!(m & 4) || !(m & 1)) { if (!(m & 4)) pool(0, 1); if (!(m & 1)) pool(0, -1); }
    else { if (!(m & 2)) pool(1, 0); if (!(m & 8)) pool(-1, 0); }
  }
  return true;
}

// crenels: two merlons on each open edge of the top (the north view's sizes), each a little box with the art of the
// south merlon (its top and its face)
function merlons(F, s, r, m, x0, y0, ht) {
  if (!s) return;
  const hm = 10 / 64;
  partsReset();
  for (let i = 0; i < 8; i++) {
    if (m & MER_E[i]) continue;
    const q = MER[i];
    part(depthOf(x0 + (q[0] + q[2]) / 128, y0 + (q[1] + q[3]) / 128), i);
  }
  for (const p of partsSorted()) {
    const q = MER[p.k], ax = x0 + q[0] / 64, ay = y0 + q[1] / 64, bx = x0 + q[2] / 64, by = y0 + q[3] / 64;
    const wS = q[2] - q[0], wE = q[3] - q[1];
    const side = (xa, ya, xb, yb, w, nx, ny) => {
      if (!seen(nx, ny)) return;
      const z = shade(nx, ny);
      vq(F, s, false, 32, 128, 2, 54, 2 + Math.min(14, w), 64, xa, ya, xb, yb, ht, ht + hm, r[5] * z, r[6] * z, r[7] * z, r[8]);
    };
    side(ax, by, bx, by, wS, 0, 1); side(ax, ay, bx, ay, wS, 0, -1); side(bx, by, bx, ay, wE, 1, 0); side(ax, by, ax, ay, wE, -1, 0);
    tq(F, s, false, 32, 128, 2, 46, 16, 54, ax, ay, bx, by, ht + hm, r[5], r[6], r[7], r[8]);
  }
}

// a stone buttress against one side (bit: 4 S, 1 N, 2 E, 8 W): a pier in two stages with sloped weathering, the sizes
// of art/arch.js stoneButtress; its faces from that art, projected in the side's own frame (as if it were the south)
const SIDES = [[4, 0, 1], [1, 0, -1], [2, 1, 0], [8, -1, 0]];
const BT_ST = [[8, 6, 0.42, 0.8, 0], [12, 11, 0, 0.42, 6]]; // [half width px, depth px, h0, h1 (× story), slope back to px]
function buttress(F, s, bit, x0, y0, h0, H, r, g, b, a) {
  // u along the face (left → right from outside), w out of it
  const X = (u, w) => (bit === 4 ? x0 + u : bit === 1 ? x0 + 1 - u : bit === 2 ? x0 + 1 + w : x0 - w);
  const Y = (u, w) => (bit === 4 ? y0 + 1 + w : bit === 1 ? y0 - w : bit === 2 ? y0 + 1 - u : y0 + u);
  const ux = X(1, 0) - X(0, 0), uy = Y(1, 0) - Y(0, 0), nx = X(0, 1) - X(0, 0), ny = Y(0, 1) - Y(0, 0);
  const row = (w, h) => 128 + 64 * w - 64 * (h - h0);
  for (const [hw, d, f0, f1, sl] of BT_ST) {
    const u0 = 0.5 - hw / 64, u1 = 0.5 + hw / 64, wd = d / 64, ws = sl / 64, hb = h0 + f0 * H, ht = h0 + f1 * H, hs = ht + ((d - sl) * 0.9) / 64;
    const c0 = 32 - hw, c1 = 32 + hw;
    // the two ends: a slice of the front's edge
    for (const e of [0, 1]) {
      const sx = e ? ux : -ux, sy = e ? uy : -uy;
      if (!seen(sx, sy)) continue;
      const z = shade(sx, sy), u = e ? u1 : u0, cc = e ? c1 - d : c0;
      artQuad(F, s, false, 32, 128, cc, row(wd, ht), cc + d, row(wd, hb), X(u, e ? wd : 0), Y(u, e ? wd : 0), ht, X(u, e ? 0 : wd), Y(u, e ? 0 : wd), ht, X(u, e ? wd : 0), Y(u, e ? wd : 0), hb, r * z, g * z, b * z, a);
    }
    if (seen(nx, ny)) {
      const z = shade(nx, ny);
      artQuad(F, s, false, 32, 128, c0, row(wd, ht), c1, row(wd, hb), X(u0, wd), Y(u0, wd), ht, X(u1, wd), Y(u1, wd), ht, X(u0, wd), Y(u0, wd), hb, r * z, g * z, b * z, a);
    }
    // the sloped top back to the stage above / the wall
    artQuad(F, s, false, 32, 128, c0, row(ws, hs), c1, row(wd, ht), X(u0, ws), Y(u0, ws), hs, X(u1, ws), Y(u1, ws), hs, X(u0, wd), Y(u0, wd), ht, r, g, b, a);
  }
}

// ---------- things hung on walls (decor mounts) ----------
// rot 1: on the wall to the north (faces south) · 2: on the wall to the east (faces west) · 3: south wall (faces north) ·
// 4: west wall (faces east). Flat on that wall's face, only seen from the room side; the art at the north view's scale
// and height (archCompose.drawDecorProp: DECOR_GEOM.mount = its lift, scale 0.66)
export function drawMountFaces(B, A, o) {
  const F = B.faces;
  if (!F || !o._mount) return false;
  const r = o.rot | 0;
  if (r < 1 || r > 4) return false;
  K.prep(A);
  const s = K.spriteOf(A, o.type, o.v);
  if (!s) return false;
  if (!K.ok(s)) return true; // (lazy art not painted yet: requested)
  const nx = r === 2 ? -1 : r === 4 ? 1 : 0, ny = r === 1 ? 1 : r === 3 ? -1 : 0;
  if (!seen(nx, ny)) return true;
  K.setState(o);
  const C = K.col(), z = shade(nx, ny);
  const gm = DG.mount[o.type], sc = (typeof gm === 'object' && gm?.s) || 0.66, lift = typeof gm === 'number' ? gm : gm?.l ?? 0.04;
  const hb = lift + K.MOUNT_UP + (o.lv | 0) * SG.FH, e = 0.03;
  // the face plane and its right-hand direction as seen from the room
  let px, py, rx, ry;
  if (r === 1) { px = o.tx + 0.5; py = o.ty + e; rx = 1; ry = 0; }
  else if (r === 3) { px = o.tx + 0.5; py = o.ty + 1 - e; rx = -1; ry = 0; }
  else if (r === 2) { px = o.tx + 1 - e; py = o.ty + 0.5; rx = 0; ry = 1; }
  else { px = o.tx + e; py = o.ty + 0.5; rx = 0; ry = -1; }
  // the sprite's whole image (nominal 64 × 44 box, anchor bottom-centre) scaled by sc on the face
  const c0 = -40, c1 = 104, r0 = -40, r1 = 64, k = sc / 64;
  const ax = px + rx * (c0 - 32) * k, ay = py + ry * (c0 - 32) * k, bx = px + rx * (c1 - 32) * k, by = py + ry * (c1 - 32) * k;
  const hT = hb + (44 - r0) * k, hB = hb + (44 - r1) * k;
  artQuad(F, s, false, 32, 44, c0, r0, c1, r1, ax, ay, hT, bx, by, hT, ax, ay, hB, C.r * z, C.g * z, C.b * z, C.a);
  return true;
}
// its view depth: right after the wall it hangs on (its box: the wall's faces would hide it), before what stands in
// front of it
export function mountDepth(o, rc, rs) {
  const r = o.rot | 0, wx = o.tx + 0.5 + (r === 2 ? 1 : r === 4 ? -1 : 0), wy = o.ty + 0.5 + (r === 1 ? -1 : r === 3 ? 1 : 0);
  return -rs * wx + rc * wy + 0.5 * (Math.abs(rs) + Math.abs(rc)) + (o.lv | 0) * 0.001 + 0.0005;
}

// ---------- siege cracks (fx/rockfx.js) on a damaged wall / door / fence while turned ----------
// s = the crack sprite with a front (siege_crack_f*): its top crack on the box top, its front crack on every side that
// shows (a fence: the front crack on a card through its middle, facing the camera)
export function drawCrackFaces(B, A, o, s, alpha, flip, sh) {
  const F = B.faces;
  if (!F || !s) return;
  const def = BUILDINGS[o.type], h0 = (o.lv | 0) * SG.FH, x0 = o.tx + sh, y0 = o.ty, x1 = x0 + 1, y1 = y0 + 1;
  if (def?.connect === 'fence') {
    const C = CAMV.c, S = CAMV.s, cx = x0 + 0.5, cy = y0 + 0.5, hw = 0.4;
    artQuad(F, s, flip, 32, 128, 8, 76, 56, 112, cx - C * hw, cy - S * hw, h0 + 0.6, cx + C * hw, cy + S * hw, h0 + 0.6, cx - C * hw, cy - S * hw, h0, 1, 1, 1, alpha);
    return;
  }
  const m = (o.mask | 0) & 15, ht = h0 + SG.FH;
  if (def?.block === 'door') {
    // a door: on both faces of its leaves (nothing where it stands open)
    if (o.open) return;
    const v = (o.orient || (!(m & 10) && (m & 5) ? 'v' : 'h')) === 'v', J = v ? 0.15 : 9 / 64, c0 = J * 64, c1 = 64 - J * 64;
    const leaf = (xa, ya, xb, yb, nx, ny) => { if (seen(nx, ny)) { const z = shade(nx, ny); vq(F, s, flip, 32, 128, c0, 64, c1, 128, xa, ya, xb, yb, h0, ht, z, z, z, alpha); } };
    if (!v) { leaf(x0 + J, y0 + 0.705, x1 - J, y0 + 0.705, 0, 1); leaf(x0 + J, y0 + 0.215, x1 - J, y0 + 0.215, 0, -1); }
    else { leaf(x0 + 0.335, y1 - J, x0 + 0.335, y0 + J, -1, 0); leaf(x0 + 0.665, y1 - J, x0 + 0.665, y0 + J, 1, 0); }
    return;
  }
  const side = (xa, ya, xb, yb, nx, ny) => { if (seen(nx, ny)) { const z = shade(nx, ny); vq(F, s, flip, 32, 128, 0, 64, 64, 128, xa, ya, xb, yb, h0, ht, z, z, z, alpha); } };
  if (!(m & 4)) side(x0, y1, x1, y1, 0, 1);
  if (!(m & 1)) side(x0, y0, x1, y0, 0, -1);
  if (!(m & 2)) side(x1, y1, x1, y0, 1, 0);
  if (!(m & 8)) side(x0, y1, x0, y0, -1, 0);
  tq(F, s, flip, 32, 128, 0, 0, 64, 64, x0, y0, x1, y1, ht, 1, 1, 1, alpha);
}

// ---------- columns (roof supports: column_wood / column_stone) ----------
// A round shaft on a footing: a card facing the camera (as round things are), standing where the north view paints
// it — its foot at 0.78 of the tile (art/roofs.js columnWood / columnStone: 64 × (64 + 40) frame) — its own silhouette
// (turned across the sun) as the sun shadow. (A plain billboard turned only its anchor, the tile's south edge: the shaft drifted off its spot.)
const COL_FOOT = 40 + 0.78 * 64;
export function drawColumnFaces(B, A, o, h0 = 0) {
  const F = B.faces;
  if (!F) return false;
  const T = K.prep(A), s = K.spriteOf(A, o.type, o.v);
  if (!s || !K.ok(s)) return false;
  K.setState(o);
  const C = K.col(), px = o.tx + 0.5, py = o.ty + 0.78;
  if (!C.bp) shadowArt(B, s, px, py, Math.atan2(CAMV.lx, -CAMV.ly), false, C.a, h0 - (104 - COL_FOOT) / 64); // (a round shaft: its silhouette across the sun)
  if (T.blob && B.blob && !h0) B.blob.add(T.blob, px, py - 0.04, 0.95, 0.42, 1, 1, 1, 0.34 * C.a);
  bq(F, s, false, 32, 104, -32, -40, 96, 120, 32, px, py, h0 - (120 - COL_FOOT) / 64, C.r, C.g, C.b, C.a);
  return true;
}
