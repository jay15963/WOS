// Camera rotation — doors as computed faces, with the real door art (art/structures.js doorH / doorV frames, the
// styled leaves of art/arch.js, the entrance details of the door kit).
//
// Built in the door's own frame: u along the wall (0..1), w across it (0 = back, 1 = front; an E-W door's front is
// south, a N-S door's is west). Two timber jambs J wide fill the wall at both ends (their faces: the door frame's jamb
// front across the wall, the N-S door's jamb front along it, tops from the north-view frames), and two leaves hang on
// them. Closed, the leaves fill the gap between the jambs, the leaf art on both faces (the back seen mirrored); open,
// each leaf swings about its hinge into the back of the opening as a thin board — the gap is free. Knocker / wreath
// (closed door) and the stone arch, lantern and awning sit on the front; the step and the sill lie on the ground.
import { STRUCT_GEOM as SG } from '../structures.js';
import { ARCH_GEOM as AG } from '../arch.js';
import { ARCH_FACES as K } from '../archCompose.js';
import { seen, shade, artQuad, solidUV, shadowRect, depthOf, clamp01, partsReset, part, partsSorted } from './kit.js';

const DH = SG.FH - 1 / 64;           // leaf height (a full story less a pixel)
const LEAF_H = [0.22, 0.7], LEAF_V = [0.34, 0.66]; // leaf thickness rows (w) of the north-view art
const J_H = 9 / 64, J_V = 0.15;      // jamb width along the wall
const LEAF_C = [0.39, 0.23, 0.13];   // a leaf's edge (dark boards)

let V = false, TX = 0, TY = 0;       // current door: N-S?, tile
// door frame → world (x, y) / world direction
const WX = (u, w) => (V ? TX + 1 - w : TX + u), WY = (u, w) => (V ? TY + u : TY + w);
const DX = (du, dw) => (V ? -dw : du), DY = (du, dw) => (V ? du : dw);
const seenL = (du, dw) => seen(DX(du, dw), DY(du, dw));
const shadeL = (du, dw) => shade(DX(du, dw), DY(du, dw));
// a face of the door frame: TL (u, w, h), TR, BL in door coordinates
function aq(F, s, flip, ox, oy, c0, r0, c1, r1, au, aw, ah, bu, bw, bh, du, dw, dh, r, g, b, a) {
  artQuad(F, s, flip, ox, oy, c0, r0, c1, r1, WX(au, aw), WY(au, aw), ah, WX(bu, bw), WY(bu, bw), bh, WX(du, dw), WY(du, dw), dh, r, g, b, a);
}

export function drawDoorFaces(B, A, o, h0 = 0, t = 0) {
  const F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  const k = o._k, on = k ? k.on : {}, st = k ? k.style : 'plank';
  const L0 = T.door[st] || T.door.plank, L = K.use(L0.h) ? L0 : T.door.plank;
  const fH = T.door_wood_h_frame, fV = T.door_wood_v_frame, pV = T.door_wood_v_post, leaf = L.h, uv = solidUV(T);
  if (!fH || !fV || !pV || !leaf || !uv) return false;
  K.setState(o); K.tone(k);
  const C = K.col(), R = C.tr, G = C.tg, Bl = C.tb, a = C.a;
  const m = (o.mask | 0) & 15;
  V = (o.orient || (!(m & 10) && (m & 5) ? 'v' : 'h')) === 'v'; TX = o.tx; TY = o.ty;
  const J = V ? J_V : J_H, LW = V ? LEAF_V : LEAF_H, H = SG.FH, ht = h0 + H;
  const open = clamp01(o._openT ?? (+o.open || 0));
  // neighbours along the wall: the jambs' outer sides are hidden by them
  const nA = V ? m & 1 : m & 8, nB = V ? m & 4 : m & 2;
  // ----- the parts, back to front -----
  partsReset();
  part(depthOf(WX(J / 2, 0.5), WY(J / 2, 0.5)), 0);
  part(depthOf(WX(1 - J / 2, 0.5), WY(1 - J / 2, 0.5)), 1);
  const th = open * 1.45, cs = Math.cos(th), sn = Math.sin(th), Th = (LW[1] - LW[0]) + (0.09 - (LW[1] - LW[0])) * clamp01(open * 4);
  const wP = (LW[0] + LW[1]) / 2, Lw = 0.5 - J + 0.004;
  for (let i = 0; i < 2; i++) {
    const sg = i ? -1 : 1, hu = (i ? 1 - J : J) + sg * (Th / 2) * sn, du = sg * cs, dw = -sn;
    part(depthOf(WX(hu + du * Lw / 2, wP + dw * Lw / 2), WY(hu + du * Lw / 2, wP + dw * Lw / 2)), 2 + i);
  }
  const ldU = (i) => (i ? -cs : cs), ldW = -sn, lnU = (i) => (i ? -sn : sn), lnW = cs; // leaf along / front normal
  if (!C.bp) {
    // sun shadows: the jambs and the leaves
    for (let i = 0; i < 2; i++) {
      const u0 = i ? 1 - J : 0, ax = Math.min(WX(u0, 0), WX(u0 + J, 1)), ay = Math.min(WY(u0, 0), WY(u0 + J, 1));
      shadowRect(B, T, ax + (V ? 0.5 : J / 2), ay, 0, V ? 1 : J, V ? J : 1, H, a, h0);
      const sg = i ? -1 : 1, hu = (i ? 1 - J : J) + sg * (Th / 2) * sn, dx = DX(ldU(i), ldW), dy = DY(ldU(i), ldW);
      shadowRect(B, T, WX(hu, wP), WY(hu, wP), Math.atan2(-dx, dy), Th, Lw, DH, a, h0);
    }
  }
  for (const p of partsSorted()) {
    if (p.k < 2) jamb(F, T, p.k, J, h0, ht, p.k ? nB : nA, fH, fV, pV, R, G, Bl, a);
    else {
      const i = p.k - 2, sg = i ? -1 : 1, hu = (i ? 1 - J : J) + sg * (Th / 2) * sn;
      leafBox(F, leaf, V && K.use(L.v) ? L.v : null, uv, hu, wP, ldU(i), ldW, lnU(i), lnW, Lw, Th, LW, h0, open, R, G, Bl, a);
    }
  }
  // ----- the entrance details (on the front; E-W doors as in the north view) -----
  if (!V) {
    const D = T.d, wf = LW[1] + 0.006;
    if (open < 0.12) for (const s of [on.knocker && D.knocker, on.wreath && D.wreath]) {
      if (s && K.ok(s) && seenL(0, 1)) aq(F, s, false, 32, 128, 0, 0, 64, 64 + 64 * LW[1], 0, wf, h0 + 1 + LW[1], 1, wf, h0 + 1 + LW[1], 0, wf, h0, C.r, C.g, C.b, a);
    }
    const front = (s, tint) => { if (s && K.ok(s) && seenL(0, 1)) aq(F, s, false, 32, 128, 0, 0, 64, 128, 0, 1.004, h0 + 2, 1, 1.004, h0 + 2, 0, 1.004, h0, tint ? R : C.r, tint ? G : C.g, tint ? Bl : C.b, a); };
    if (st === 'arched') front(D.door_arch, false);
    if (on.lantern) {
      front(D.dlantern, false);
      if (!C.bp) K.lanternGlow(B, T, WX(0.5 + 28.6 / 64, 1.05), WY(0.5 + 28.6 / 64, 1.05), AG.dlanternLift + h0, t);
    }
    if (on.awning && D.awning && K.ok(D.awning)) {
      // a little shingled canopy over the door, out from the wall top
      const z = shadeL(0, 1);
      aq(F, D.awning, false, 32, 128, 0, 48, 64, 76, 0, 1, ht + 0.02, 1, 1, ht + 0.02, 0, 1.27, ht - 0.17, R * z, G * z, Bl * z, a);
    }
  }
  if (!(o.lv | 0)) {
    // on the ground (flat: they turn whole with the camera)
    const sill = V ? T.door_wood_sill_v : T.door_wood_sill_h;
    if (!V && on.step && T.d.step && K.ok(T.d.step)) B.ground.add(T.d.step, o.x, o.y + 0.02, 1, 1, C.r, C.g, C.b, a, 0, 0, 0, 1, 1);
    if (sill) B.ground.add(sill, o.x, o.y, 1, 1, R, G, Bl, a, 0, 0, 0, 1, 1);
  }
  return true;
}

// a jamb: a timber block J wide through the whole wall (its front / back: the door frame's jamb; its ends: the N-S
// door frame's jamb front; its top from the north-view frame)
function jamb(F, T, i, J, h0, ht, hidden, fH, fV, pV, R, G, B, a) {
  const u0 = i ? 1 - J : 0, u1 = u0 + J, c0 = i ? 64 - J * 64 : 0, c1 = c0 + J * 64;
  // across the wall (front w = 1, back w = 0): the h frame's jamb, art in u order
  for (const w of [1, 0]) {
    if (!seenL(0, w ? 1 : -1)) continue;
    const z = shadeL(0, w ? 1 : -1);
    aq(F, fH, false, 32, 128, i ? 55 : 0, 64, i ? 64 : 9, 128, u0, w, ht, u1, w, ht, u0, w, h0, R * z, G * z, B * z, a);
  }
  // along the wall: the reveal (into the opening) and the outer side (unless a wall is there): the v frame's jamb front
  for (const e of [0, 1]) {
    const u = e ? u1 : u0, nu = e ? 1 : -1;
    if ((i === 0 && !e && hidden) || (i === 1 && e && hidden) || !seenL(nu, 0)) continue;
    const z = shadeL(nu, 0);
    aq(F, pV, false, 32, 128, 0, 64, 64, 128, u, 1, ht, u, 0, ht, u, 1, h0, R * z, G * z, B * z, a);
  }
  // top: the north-view frame's own top (E-W: the h frame; N-S: the north / south jamb block)
  if (!V) aq(F, fH, false, 32, 128, c0, 0, c1, 64, u0, 0, ht, u1, 0, ht, u0, 1, ht, R, G, B, a);
  else {
    const s = i ? pV : fV, y0 = i ? (1 - J) * 64 : 0, y1 = i ? 64 : J * 64;
    // (world rows y0..y1 of the N-S frame = u0..u1, cols 0..64 = x = 1 − w)
    artQuad(F, s, false, 32, 128, 0, y0, 64, y1, TX, TY + u0, ht, TX + 1, TY + u0, ht, TX, TY + u1, ht, R, G, B, a);
  }
}

// a leaf: a board Lw long from its hinge (hu, wP) along (du, dw), Th thick across (nu, nw) = its front; the leaf art
// (hinge → free end) on both faces, the top strip of the leaf art on top, the free end in plain dark wood
function leafBox(F, s, sv, uv, hu, wP, du, dw, nu, nw, Lw, Th, LW, h0, open, R, G, B, a) {
  const ht = h0 + DH, q = Th / 2;
  const P = (sx, qx) => [hu + du * sx + nu * qx, wP + dw * sx + nw * qx];
  const fa = P(0, q), fb = P(Lw, q), ba = P(0, -q), bb = P(Lw, -q);
  // (the art's rows: the closed E-W leaf's front, whatever this door's thickness)
  const r0 = 64 + 64 * LEAF_H[1] - 64 * DH, r1 = 64 + 64 * LEAF_H[1];
  for (const sd of [1, -1]) {
    if (!seenL(nu * sd, nw * sd)) continue;
    const z = shadeL(nu * sd, nw * sd), A0 = sd > 0 ? fa : ba, B0 = sd > 0 ? fb : bb;
    aq(F, s, false, 9, 128, 9, r0, 32.5, r1, A0[0], A0[1], ht, B0[0], B0[1], ht, A0[0], A0[1], h0, R * z, G * z, B * z, a);
  }
  // the free end and the hinge end once it swings (closed: against the other leaf / the jamb)
  if (open > 0.02) {
    for (const e of [1, 0]) {
      const sd = e ? 1 : -1;
      if (!seenL(du * sd, dw * sd)) continue;
      const z = shadeL(du * sd, dw * sd), A0 = e ? fb : ba, B0 = e ? bb : fa;
      const x0 = WX(A0[0], A0[1]), y0 = WY(A0[0], A0[1]), x1 = WX(B0[0], B0[1]), y1 = WY(B0[0], B0[1]);
      F.quad(x0, y0, ht, x1, y1, ht, x1, y1, h0, x0, y0, h0, uv, LEAF_C[0] * R * z, LEAF_C[1] * G * z, LEAF_C[2] * B * z, a);
    }
  }
  // top: the leaf art's top strip (rows of the closed leaf's thickness), hinge → free; a N-S door: its own leaf seen
  // from above (art/structures.js doorV: anchored on the leaf's hinge row, the boards along, cols 22..42 across)
  const t0 = 64 + 64 * LEAF_H[0] - 64 * DH;
  if (sv) aq(F, sv, false, 32, 10.6, 22, 10.6, 42, 10.6 + 22.4, fa[0], fa[1], ht, ba[0], ba[1], ht, fb[0], fb[1], ht, R, G, B, a);
  else aq(F, s, false, 9, 128, 9, t0, 32.5, r0, ba[0], ba[1], ht, bb[0], bb[1], ht, fa[0], fa[1], ht, R, G, B, a);
}
