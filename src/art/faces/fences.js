// Camera rotation — fences, hedges, stone fence-walls and gates as real 3D pieces of computed faces, with the art of
// the north view (art/structures.js fenceSprite / gateH, art/arch.js fenceStyleSprite / gate leaves / details).
//
// Fence tile: a post (a small box with the post art on its sides) at the middle of the tile and, toward each connected
// neighbour, an arm: the rails / pickets / boards / woven panel of the style as a thin board with two faces (art of a
// straight E-W run, in world order: the N-S arms use it turned). Hedges and stone fence-walls: a block in the middle and
// a thick arm per neighbour, their front art on the long sides and the run seen from above on top. Caps, birds,
// lanterns and the flowers at the foot are cards that face the camera; vines grow on the arm faces.
// Gate: two tall posts and two leaves (the leaf art on both faces) hung on them; open, the leaves swing about their
// hinges to the back. Arch with flowers: a card through the gate line; the sign on the closed leaves' front.
import { STRUCT_GEOM as SG } from '../structures.js';
import { CAMV, ARCH_FACES as K } from '../archCompose.js';
import { seen, shade, vq, tq, artQuad, bq, solidUV, shadowRect, shadowArt, depthOf, clamp01, partsReset, part, partsSorted } from './kit.js';

const FOOT = 68; // frame row of the post foot (PH + 32: the middle of the tile on the ground)
// thin styles: post half width / height (px), arm board thickness (tiles)
// tops: the heights (px over the foot) of the top edges of its rails / boards — a thin top strip each, so a run seen
// along its line (its faces edge-on) still shows its rails
const THIN = {
  rail: { pw: 4.6, ph: 31, d: 0.07, tops: [13.6, 25.6] }, picket: { pw: 5.4, ph: 33, d: 0.06, tops: [11, 24, 30] },
  board: { pw: 5.4, ph: 35, d: 0.08, tops: [27] }, wattle: { pw: 3.6, ph: 33, d: 0.09, tops: [26] },
};
// solid styles: half thickness (tiles), height (px), the front art's top row, the top strip's projection row (PH − h)
const SOLID = { stone: { hw: 10 / 64, h: 24, r0: 45.5, top: 12, c0: 22, c1: 42 }, hedge: { hw: 11 / 64, h: 30, r0: 40, top: 6, c0: 21, c1: 43, fringe: 31 } }; // (r0: below the art's outline)
const hash = (a, b) => K.hash(a, b);

export function drawFenceFaces(B, A, o, h0 = 0, t = 0) {
  const F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  const k = o._k, on = k ? k.on : {};
  const st = o.type === 'fence_stone' ? 'stone' : o.type === 'hedge' ? 'hedge' : k && T.fence[k.style] ? k.style : 'rail';
  const set = T.fence[st];
  const pick = (mm) => K.use(set?.[mm]) || T.fence.rail?.[mm];
  const sEW = pick(10);
  if (!sEW) return false;
  K.setState(o); K.tone(k);
  const C = K.col(), R = C.tr, G = C.tg, Bl = C.tb, a = C.a;
  const m = (o.mask | 0) & 15, x0 = o.tx, y0 = o.ty, cx = x0 + 0.5, cy = y0 + 0.5;
  const sol = SOLID[st];
  partsReset();
  if (sol) {
    // a block in the middle, an arm toward each neighbour
    const hw = sol.hw, Hs = sol.h / 64, top = pick(5) || sEW;
    part(depthOf(cx, cy), 0);
    if (m & 1) part(depthOf(cx, y0 + 0.25 - hw / 2), 1);
    if (m & 4) part(depthOf(cx, y0 + 0.75 + hw / 2), 4);
    if (m & 8) part(depthOf(x0 + 0.25 - hw / 2, cy), 8);
    if (m & 2) part(depthOf(x0 + 0.75 + hw / 2, cy), 2);
    for (const p of partsSorted()) {
      let bx0 = cx - hw, bx1 = cx + hw, by0 = cy - hw, by1 = cy + hw;
      if (p.k === 1) { by0 = y0; by1 = cy - hw; } else if (p.k === 4) { by0 = cy + hw; by1 = y0 + 1; }
      else if (p.k === 8) { bx0 = x0; bx1 = cx - hw; } else if (p.k === 2) { bx0 = cx + hw; bx1 = x0 + 1; }
      if (!C.bp) shadowRect(B, T, (bx0 + bx1) / 2, by0, 0, bx1 - bx0, by1 - by0, Hs, a, h0);
      solidBlock(F, sEW, top, sol, p.k, m, bx0 - x0, by0 - y0, bx1 - x0, by1 - y0, x0, y0, h0, Hs, R, G, Bl, a);
    }
  } else {
    const S = THIN[st] || THIN.rail, pw = S.pw / 64, ph = S.ph / 64, d = S.d;
    const post = pick(0) || sEW;
    if (!C.bp) {
      // the run's own silhouettes (an axis at a time: the N-S arms as the E-W art turned)
      if (m & 10 || !(m & 5)) shadowArt(B, pick(m & 10), cx, cy, 0, false, a, h0 - 0.5);
      if (m & 5) shadowArt(B, pick(((m & 1) ? 8 : 0) | ((m & 4) ? 2 : 0)), cx, cy, Math.PI / 2, false, a, h0 - 0.5);
    }
    part(depthOf(cx, cy), 0);
    if (m & 1) part(depthOf(cx, y0 + 0.25), 1);
    if (m & 4) part(depthOf(cx, y0 + 0.75), 4);
    if (m & 8) part(depthOf(x0 + 0.25, cy), 8);
    if (m & 2) part(depthOf(x0 + 0.75, cy), 2);
    const vines = on.vines && T.d.f_vines_h && K.ok(T.d.f_vines_h) ? T.d.f_vines_h : null;
    for (const p of partsSorted()) {
      if (p.k === 0) postBox(F, post, cx, cy, pw, ph, h0, R, G, Bl, a);
      else arm(F, sEW, vines, p.k, x0, y0, pw, d, S.tops, h0, R, G, Bl, C, a);
    }
  }
  // cards on top: caps, lantern, bird; flowers at the foot
  const D = T.d, lift = st === 'stone' ? -0.2 : st === 'hedge' ? -0.06 : 0, posts = !sol;
  const cap = on.cap_flat ? 'f_cap_flat' : on.cap_ball ? 'f_cap_ball' : on.cap_point ? 'f_cap_point' : null;
  if (cap && (posts || cap === 'f_cap_ball')) card(F, D[cap], false, 22, 18, 42, 40, cx, cy, h0 + lift, R, G, Bl, a);
  if (on.lantern) {
    card(F, D.f_lantern, false, 24, 14, 48, 40, cx, cy, h0 + lift, C.r, C.g, C.b, a);
    if (!C.bp) K.lanternGlow(B, T, cx + CAMV.c * 7 / 64, cy + CAMV.s * 7 / 64, 0.6 + lift + h0, t);
  }
  if (on.bird && hash(o.tx * 3, o.ty * 5) < 0.4) card(F, D.f_bird, hash(o.ty, o.tx * 2) < 0.5, 20, 20, 44, 40, cx, cy, h0 + lift, C.r, C.g, C.b, a);
  if (on.flowers && D.f_flowers && K.ok(D.f_flowers)) {
    const fl = hash(o.tx, o.ty) < 0.5;
    bq(F, D.f_flowers, fl, 32, 100, 10, 58, 54, 80, 32, cx, cy + 0.14, h0, C.r * 0.95, C.g * 0.95, C.b * 0.95, a);
  }
  return true;
}

// a card at the post top facing the camera (rows → heights as above the post foot)
function card(F, s, flip, c0, r0, c1, r1, px, py, h, r, g, b, a) {
  if (!s || !K.ok(s)) return;
  bq(F, s, flip, 32, 100, c0, r0, c1, r1, 32, px, py, h + (FOOT - r1) / 64, r, g, b, a);
}

// a post: a small box, the post art on every side, its top the first rows of the post
function postBox(F, s, cx, cy, pw, ph, h0, R, G, B, a) {
  const x0 = cx - pw, x1 = cx + pw, y0 = cy - pw, y1 = cy + pw, ht = h0 + ph, c0 = 32 - pw * 64, c1 = 32 + pw * 64, r0 = FOOT - ph * 64;
  const side = (xa, ya, xb, yb, nx, ny) => { if (seen(nx, ny)) { const z = shade(nx, ny); vq(F, s, false, 32, 100, c0, r0, c1, FOOT + 2, xa, ya, xb, yb, h0 - 2 / 64, ht, R * z, G * z, B * z, a); } };
  side(x0, y1, x1, y1, 0, 1); side(x0, y0, x1, y0, 0, -1); side(x1, y1, x1, y0, 1, 0); side(x0, y1, x0, y0, -1, 0);
  tq(F, s, false, 32, 100, c0, r0 - 2, c1, r0 + 2 * pw * 64 - 2, x0, y0, x1, y1, ht, R * 1.06, G * 1.06, B * 1.06, a);
}

// an arm toward neighbour bit k: a board d thick from the post to the tile edge, the straight run's art on its two
// long faces (world order); N-S arms take the E-W art turned (west half → north arm, east half → south arm). Its two
// ends show the run's cross-section (one column of the art stretched across the thickness: the rails' ends, a board's
// edge) and the top edge of each rail / board is a thin strip — seen along its line the fence never vanishes.
function arm(F, s, vines, k, x0, y0, pw, d, tops, h0, R, G, B, C, a) {
  const ns = k === 1 || k === 4, lo = k === 1 || k === 8; // (north / west: the art's west half)
  const c0 = lo ? 0 : 32 + pw * 64, c1 = lo ? 32 - pw * 64 : 64, r0 = FOOT - 44, ht = h0 + 44 / 64, hb = h0;
  const t0 = lo ? 0 : 0.5 + pw, t1 = lo ? 0.5 - pw : 1, q = d / 2;
  // a point of the arm: t along it (tile coords), w across (± q off the middle line)
  const PX = (t, w) => (ns ? x0 + 0.5 + w : x0 + t), PY = (t, w) => (ns ? y0 + t : y0 + 0.5 + w);
  for (const sd of [1, -1]) {
    const nx = ns ? sd : 0, ny = ns ? 0 : sd;
    if (!seen(nx, ny)) continue;
    const z = shade(nx, ny);
    // the face: along the arm (t0 → t1), at ±q off the middle line
    const xa = PX(t0, sd * q), ya = PY(t0, sd * q), xb = PX(t1, sd * q), yb = PY(t1, sd * q);
    vq(F, s, false, 32, 100, c0, r0, c1, FOOT, xa, ya, xb, yb, hb, ht, R * z, G * z, B * z, a);
    if (vines) {
      const xo = ns ? sd * 0.004 : 0, yo = ns ? 0 : sd * 0.004;
      vq(F, vines, false, 32, 100, c0, r0, c1, FOOT, xa + xo, ya + yo, xb + xo, yb + yo, hb, ht, C.r * z, C.g * z, C.b * z, a);
    }
  }
  // the two ends: the cross-section (an art column a little in from that end)
  for (const e of [0, 1]) {
    const t = e ? t1 : t0, sg = (e ? 1 : -1), nx = ns ? 0 : sg, ny = ns ? sg : 0;
    if (!seen(nx, ny)) continue;
    const z = shade(nx, ny) * 0.9, cc = e ? c1 - 2 : c0 + 1;
    vq(F, s, false, 32, 100, cc, r0, cc + 1, FOOT, PX(t, -q), PY(t, -q), PX(t, q), PY(t, q), hb, ht, R * z, G * z, B * z, a);
  }
  // the top edges of the rails / boards: the art's rows just under each top, as a thin strip along the arm
  for (const h of tops) {
    const rr = FOOT - h, hh = h0 + h / 64;
    artQuad(F, s, false, 32, 100, c0, rr + 0.6, c1, rr + 2.2, PX(t0, -q), PY(t0, -q), hh, PX(t1, -q), PY(t1, -q), hh, PX(t0, q), PY(t0, q), hh, R * 1.05, G * 1.05, B * 1.05, a);
  }
}

// hedge / stone wall block [bx0, bx1] × [by0, by1] (tile coords): front art on the long sides, the N-S run seen from
// above on top (E-W parts: turned); k = 0 the middle (sides only where no arm), else the arm's bit
function solidBlock(F, sEW, sNS, S, k, m, bx0, by0, bx1, by1, x0, y0, h0, Hs, R, G, B, a) {
  const ht = h0 + Hs, X0 = x0 + bx0, X1 = x0 + bx1, Y0 = y0 + by0, Y1 = y0 + by1;
  const side = (xa, ya, xb, yb, t0, t1, nx, ny) => {
    if (!seen(nx, ny)) return;
    const z = shade(nx, ny);
    vq(F, sEW, false, 32, 100, t0 * 64, S.r0, t1 * 64, FOOT + 1, xa, ya, xb, yb, h0 - 1 / 64, ht, R * z, G * z, B * z, a);
  };
  const ew = k === 0 || k === 2 || k === 8, nsP = k === 0 || k === 1 || k === 4;
  // long sides (E-W parts: south / north; N-S parts: east / west), the middle block's free sides
  if (ew && !(k === 0 && (m & 4))) side(X0, Y1, X1, Y1, bx0, bx1, 0, 1);
  if (ew && !(k === 0 && (m & 1))) side(X0, Y0, X1, Y0, bx0, bx1, 0, -1);
  if (nsP && !(k === 0 && (m & 2))) side(X1, Y0, X1, Y1, by0, by1, 1, 0);
  if (nsP && !(k === 0 && (m & 8))) side(X0, Y0, X0, Y1, by0, by1, -1, 0);
  // top: the N-S run from above (cols across, rows along: rows = the projection of its top)
  const c0 = S.c0, c1 = S.c1;
  if (k === 1 || k === 4 || k === 0) artQuad(F, sNS, false, 32, 100, c0, S.top + 64 * by0, c1, S.top + 64 * by1, X0, Y0, ht, X1, Y0, ht, X0, Y1, ht, R, G, B, a);
  else artQuad(F, sNS, false, 32, 100, c0, S.top + 64 * bx0, c1, S.top + 64 * bx1, X0, Y0, ht, X0, Y1, ht, X1, Y0, ht, R, G, B, a);
  // a hedge's bushy outline (the art's rows over its block) rises along each long side, over the top's edge
  if (S.fringe) {
    const f0 = S.fringe, hf = ht + (S.r0 - f0) / 64, hb2 = ht - 1 / 64;
    const fr = (xa, ya, xb, yb, t0, t1, nx, ny) => { const z = shade(nx, ny); vq(F, sEW, false, 32, 100, t0 * 64, f0, t1 * 64, S.r0 + 1, xa, ya, xb, yb, hb2, hf, R * z, G * z, B * z, a); };
    const mid = k === 0;
    if (ew) { if (!(mid && (m & 1))) fr(X0, Y0, X1, Y0, bx0, bx1, 0, -1); if (!(mid && (m & 4))) fr(X0, Y1, X1, Y1, bx0, bx1, 0, 1); }
    if (nsP) { if (!(mid && (m & 8))) fr(X0, Y0, X0, Y1, by0, by1, -1, 0); if (!(mid && (m & 2))) fr(X1, Y0, X1, Y1, by0, by1, 1, 0); }
  }
}

// ---------- gates ----------
const PW = 5.4 / 64, PH_G = 40 / 64, PU = [5.5 / 64, 58.5 / 64], HU = [10 / 64, 54 / 64], LW_G = 22 / 64, DG = 0.045;
let GV = false, GX = 0, GY = 0;
const gx = (u, w) => (GV ? GX + 1 - w : GX + u), gy = (u, w) => (GV ? GY + u : GY + w);
const gdx = (du, dw) => (GV ? -dw : du), gdy = (du, dw) => (GV ? du : dw);
function gq(F, s, flip, ox, oy, c0, r0, c1, r1, au, aw, ah, bu, bw, bh, du, dw, dh, r, g, b, a) {
  artQuad(F, s, flip, ox, oy, c0, r0, c1, r1, gx(au, aw), gy(au, aw), ah, gx(bu, bw), gy(bu, bw), bh, gx(du, dw), gy(du, dw), dh, r, g, b, a);
}

export function drawGateFaces(B, A, o, h0 = 0, t = 0) {
  const F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  const k = o._k, on = k ? k.on : {}, st = k ? k.style : 'rail';
  const L0 = T.gate[st] || T.gate.rail, L = K.use(L0.h) ? L0 : T.gate.rail;
  const frame = T.gate_wood_h_frame, leaf = L.h, uv = solidUV(T);
  if (!frame || !leaf || !uv) return false;
  K.setState(o); K.tone(k);
  const C = K.col(), R = C.tr, G = C.tg, Bl = C.tb, a = C.a;
  const m = (o.mask | 0) & 15;
  GV = (o.orient || (!(m & 10) && (m & 5) ? 'v' : 'h')) === 'v'; GX = o.tx; GY = o.ty;
  const open = clamp01(o._openT ?? (+o.open || 0)), th = open * 1.45, cs = Math.cos(th), sn = Math.sin(th);
  const D = T.d;
  // the arch: a card through the gate line, behind the posts and the leaves
  if (on.arch && D.g_arch && K.ok(D.g_arch)) gq(F, D.g_arch, false, 32, 140, 0, 0, 64, 108, 0, 0.5, h0 + 108 / 64, 1, 0.5, h0 + 108 / 64, 0, 0.5, h0, R, G, Bl, a * 0.98);
  partsReset();
  for (let i = 0; i < 2; i++) {
    part(depthOf(gx(PU[i], 0.5), gy(PU[i], 0.5)), i);
    const sg = i ? -1 : 1, du = sg * cs, dw = -sn;
    part(depthOf(gx(HU[i] + du * LW_G / 2, 0.5 + dw * LW_G / 2), gy(HU[i] + du * LW_G / 2, 0.5 + dw * LW_G / 2)), 2 + i);
  }
  if (!C.bp) for (let i = 0; i < 2; i++) {
    shadowRect(B, T, gx(PU[i], 0.5), gy(PU[i], 0.5) - PW, 0, 2 * PW, 2 * PW, PH_G, a, h0);
    const sg = i ? -1 : 1, dx = gdx(sg * cs, -sn), dy = gdy(sg * cs, -sn);
    shadowArt(B, leaf, gx(HU[i], 0.5), gy(HU[i], 0.5), Math.atan2(dy, dx), false, a, h0 - 0.5);
  }
  for (const p of partsSorted()) {
    if (p.k < 2) {
      const i = p.k, pu = PU[i], c0 = i ? 53.1 : 0.1, c1 = c0 + 10.8, ht = h0 + PH_G;
      const side = (au, aw, bu, bw, nu, nw) => {
        const nx = gdx(nu, nw), ny = gdy(nu, nw);
        if (!seen(nx, ny)) return;
        const z = shade(nx, ny);
        gq(F, frame, false, 32, 100, c0, FOOT - 43, c1, FOOT + 2, au, aw, ht + 3 / 64, bu, bw, ht + 3 / 64, au, aw, h0 - 2 / 64, R * z, G * z, Bl * z, a);
      };
      side(pu - PW, 0.5 + PW, pu + PW, 0.5 + PW, 0, 1); side(pu - PW, 0.5 - PW, pu + PW, 0.5 - PW, 0, -1);
      side(pu + PW, 0.5 + PW, pu + PW, 0.5 - PW, 1, 0); side(pu - PW, 0.5 + PW, pu - PW, 0.5 - PW, -1, 0);
      gq(F, frame, false, 32, 100, c0, 24, c1, 32, pu - PW, 0.5 - PW, ht + 3 / 64, pu + PW, 0.5 - PW, ht + 3 / 64, pu - PW, 0.5 + PW, ht + 3 / 64, R, G, Bl, a);
    } else {
      const i = p.k - 2, sg = i ? -1 : 1, du = sg * cs, dw = -sn, nu = sg * sn, nw = cs, hu = HU[i], q = DG / 2, ht = h0 + 38 / 64;
      // the leaf art from the hinge to the free end on both faces
      for (const sd of [1, -1]) {
        const nx = gdx(nu * sd, nw * sd), ny = gdy(nu * sd, nw * sd);
        if (!seen(nx, ny)) continue;
        const z = shade(nx, ny), au = hu + nu * q * sd, aw = 0.5 + nw * q * sd;
        gq(F, leaf, false, 10, 100, 10, FOOT - 38, 32, FOOT, au, aw, ht, au + du * LW_G, aw + dw * LW_G, ht, au, aw, h0, R * z, G * z, Bl * z, a);
      }
      // seen edge-on: its free end (the leaf's cross-section) and the top edge of its upper rail
      const eu = hu + du * LW_G, ew = 0.5 + dw * LW_G, nx = gdx(du, dw), ny = gdy(du, dw);
      if (seen(nx, ny)) { const z = shade(nx, ny) * 0.9; gq(F, leaf, false, 10, 100, 29, FOOT - 38, 30, FOOT, eu - nu * q, ew - nw * q, ht, eu + nu * q, ew + nw * q, ht, eu - nu * q, ew - nw * q, h0, R * z, G * z, Bl * z, a); }
      const rt = FOOT - 28.4;
      gq(F, leaf, false, 10, 100, 10, rt, 32, rt + 1.6, hu - nu * q, 0.5 - nw * q, h0 + 28 / 64, eu - nu * q, ew - nw * q, h0 + 28 / 64, hu + nu * q, 0.5 + nw * q, h0 + 28 / 64, R * 1.05, G * 1.05, Bl * 1.05, a);
    }
  }
  // the sign on the closed leaves' front, lanterns / caps on the post tops
  if (on.sign && open < 0.1 && D.g_sign && K.ok(D.g_sign)) {
    const w = 0.5 + DG / 2 + 0.004, nx = gdx(0, 1), ny = gdy(0, 1);
    if (seen(nx, ny)) gq(F, D.g_sign, false, 32, 100, 16, 26, 48, 50, 16 / 64, w, h0 + 42 / 64, 48 / 64, w, h0 + 42 / 64, 16 / 64, w, h0 + 18 / 64, C.r, C.g, C.b, a);
  }
  const pl = 9 / 64;
  for (let i = 0; i < 2; i++) {
    const px = gx(PU[i], 0.5), py = gy(PU[i], 0.5);
    if (on.cap_ball) card(F, D.f_cap_ball, false, 22, 18, 42, 40, px, py, h0 + pl, R, G, Bl, a);
    if (on.lantern) {
      card(F, D.f_lantern, !i, 16, 14, 48, 40, px, py, h0 + pl, C.r, C.g, C.b, a);
      const sx = i ? 1 : -1;
      if (!C.bp) K.lanternGlow(B, T, px + sx * CAMV.c * 7 / 64, py + sx * CAMV.s * 7 / 64, 0.6 + pl + h0, t);
    }
  }
  return true;
}
