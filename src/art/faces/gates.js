// The kingdoms' pieces as computed 3D faces (docs/REINOS.md): the two big gates and the town mural.
//   gate_big_wood — two heavy posts with caps, a lintel beam, two plank leaves with iron bands that swing inward
//                   (o._openT eased from the shared o.open: game/building.js door swing);
//   gate_stone    — two stone piers and an arch lintel under the wall walk; an iron portcullis that slides up into the
//                   wall when open (the bars drawn only below the lintel);
//   town_mural    — a notice board on two posts under a little shingled roof, notices pinned on it, the kingdom's colour
//                   on a pennant (o._kc, set by game/towns.js).
// Built in the piece's own frame: u along the gate (0..2 tiles), w across (0..1), h up (stories); rot 1 (a north–south
// wall) turns it. Flat shaded boxes (fx_solid) with a light grain / courses drawn as thin darker strips.
// Lazy art (build menu icons / fallbacks): gate_big_wood, gate_stone, town_mural.
import { registerFaces } from './registry.js';
import { seen, shade, solidUV, shadowRect, depthOf, clamp01, partsReset, part, partsSorted, night as kitNight } from './kit.js';
import { ARCH_FACES as K, CAMV } from '../archCompose.js';
import { lazyDef } from '../lazyDefs.js';
import { spritePx, lin } from '../paint.js';
import { BUILDINGS } from '../../game/content/buildings.js';

const WOOD = [0.47, 0.32, 0.18], WOOD_D = [0.33, 0.21, 0.11], WOOD_L = [0.6, 0.43, 0.26], IRON = [0.27, 0.27, 0.3], IRON_L = [0.45, 0.46, 0.5];
const STONE = [0.6, 0.58, 0.54], STONE_D = [0.46, 0.44, 0.41], STONE_L = [0.72, 0.7, 0.66];

// ---------- a box in the piece's frame ----------
let F = null, UV = null, V = false, TX = 0, TY = 0, A0 = 1, CR = 1, CG = 1, CB = 1;
// frame → world (rot 0: u = x, w = y; rot 1: u = y, w = 1 − x (the front, w = 1, faces west))
const WX = (u, w) => (V ? TX + 1 - w : TX + u), WY = (u, w) => (V ? TY + u : TY + w);
const DX = (du, dw) => (V ? -dw : du), DY = (du, dw) => (V ? du : dw);
// a quad given by four frame corners (u, w, h) with a face normal (nu, nw) for light / back-face culling
function fq(p, nu, nw, c, top = false) {
  const nx = DX(nu, nw), ny = DY(nu, nw);
  if (!top && !seen(nx, ny)) return;
  const z = top ? 1.08 : shade(nx, ny);
  F.quad(WX(p[0], p[1]), WY(p[0], p[1]), p[2], WX(p[3], p[4]), WY(p[3], p[4]), p[5], WX(p[6], p[7]), WY(p[6], p[7]), p[8], WX(p[9], p[10]), WY(p[9], p[10]), p[11],
    UV, c[0] * z * CR, c[1] * z * CG, c[2] * z * CB, A0);
}
// an oriented box: base corner (u, w), along (au, aw) × len, across (bu, bw) × th, heights h0..h1
function obox(u, w, au, aw, len, bu, bw, th, h0, h1, c, ctop = c) {
  const P = (s, q, h) => [u + au * s + bu * q, w + aw * s + bw * q, h];
  const a = P(0, 0, 0), b = P(len, 0, 0), d = P(0, th, 0), e = P(len, th, 0);
  const Q = (p0, p1, hA, hB) => [p0[0], p0[1], hA, p1[0], p1[1], hA, p1[0], p1[1], hB, p0[0], p0[1], hB];
  fq(Q(d, e, h1, h0), bu, bw, c);                // +across
  fq(Q(b, a, h1, h0), -bu, -bw, c);              // −across
  fq(Q(e, b, h1, h0), au, aw, c);                // +along (end)
  fq(Q(a, d, h1, h0), -au, -aw, c);              // −along
  fq([a[0], a[1], h1, b[0], b[1], h1, e[0], e[1], h1, d[0], d[1], h1], 0, 0, ctop, true);
}
const box = (u0, u1, w0, w1, h0, h1, c, ct) => obox(u0, w0, 1, 0, u1 - u0, 0, 1, w1 - w0, h0, h1, c, ct || c);

function begin(B, A, o) {
  F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  UV = solidUV(T);
  if (!UV) return false;
  K.setState(o); K.tone(o._k);
  const C = K.col();
  A0 = C.a; CR = C.r; CG = C.g; CB = C.b;
  V = (o.rot & 1) === 1; TX = o.tx; TY = o.ty;
  return T;
}

// ---------- the wooden gate ----------
function drawWoodGate(B, A, o, t) {
  const T = begin(B, A, o);
  if (!T) return false;
  const open = clamp01(o._openT ?? (+o.open || 0)), sw = o._in ?? 1; // (which side the leaves swing to: inside)
  const H = 1.32;
  partsReset();
  part(depthOf(WX(0.12, 0.5), WY(0.12, 0.5)), 0);
  part(depthOf(WX(1.88, 0.5), WY(1.88, 0.5)), 1);
  part(depthOf(WX(1, 0.5), WY(1, 0.5)), 2);
  part(depthOf(WX(0.6, 0.5 + sw * 0.4 * open), WY(0.6, 0.5 + sw * 0.4 * open)), 3);
  part(depthOf(WX(1.4, 0.5 + sw * 0.4 * open), WY(1.4, 0.5 + sw * 0.4 * open)), 4);
  if (!K.col().bp) shadowRect(B, T, WX(1, 0.5), WY(1, 0.5) - (V ? 0 : 0.0), 0, V ? 0.5 : 2, V ? 2 : 0.5, H, A0);
  const th = open * 1.52 * sw, cs = Math.cos(th), sn = Math.sin(th);
  for (const p of partsSorted()) {
    if (p.k === 0 || p.k === 1) {
      const u0 = p.k ? 1.76 : 0;
      box(u0, u0 + 0.24, 0.3, 0.7, 0, H, WOOD_D, WOOD);
      box(u0 - 0.02, u0 + 0.26, 0.28, 0.72, H, H + 0.06, IRON, IRON_L); // iron cap
      box(u0 + 0.06, u0 + 0.18, 0.36, 0.64, H + 0.06, H + 0.16, WOOD_D, WOOD_L); // a point
    } else if (p.k === 2) {
      box(0.18, 1.82, 0.38, 0.62, 1.12, 1.26, WOOD, WOOD_L); // lintel
      box(0.85, 1.15, 0.36, 0.64, 1.15, 1.23, IRON, IRON_L);
    } else {
      // a leaf: planks from its hinge, turned about it by th toward the inside
      const i = p.k - 3, sg = i ? -1 : 1, hu = i ? 1.76 : 0.24, len = 0.76;
      const au = sg * cs, aw = sn * sg * sg, bu = -sn * sg, bw = cs; // along / across (turned)
      const w0 = 0.44;
      for (let k = 0; k < 4; k++) {
        const c = k & 1 ? WOOD : WOOD_L, s0 = (k * len) / 4;
        obox(hu + au * s0 + bu * 0 - (bu * 0.06), w0 + aw * s0 - bw * 0, au, aw, len / 4 - 0.01, bu, bw, 0.11, 0.05, 1.1 - (k === 3 ? 0.04 : 0), c, WOOD_L);
      }
      for (const hb of [0.22, 0.82]) obox(hu + au * 0.02 - bu * 0.012, w0 + aw * 0.02 - bw * 0.012, au, aw, len - 0.04, bu, bw, 0.135, hb, hb + 0.07, IRON, IRON_L);
      // the diagonal brace on the inner face
      obox(hu + au * 0.08 + bu * 0.11, w0 + aw * 0.08 + bw * 0.11, au, aw, len - 0.16, bu, bw, 0.03, 0.4, 0.62, WOOD_D);
    }
  }
  return true;
}

// ---------- the stone gate (portcullis) ----------
function drawStoneGate(B, A, o, t) {
  const T = begin(B, A, o);
  if (!T) return false;
  const open = clamp01(o._openT ?? (+o.open || 0));
  const HO = 0.9, H = 1.0; // the opening's height, the gate's (the wall walk sits on it)
  partsReset();
  part(depthOf(WX(0.16, 0.5), WY(0.16, 0.5)), 0);
  part(depthOf(WX(1.84, 0.5), WY(1.84, 0.5)), 1);
  part(depthOf(WX(1, 0.5), WY(1, 0.5)), 2);
  if (!K.col().bp) { shadowRect(B, T, WX(0.16, 0.5), WY(0.16, 0.5), 0, V ? 1 : 0.32, V ? 0.32 : 1, H, A0); shadowRect(B, T, WX(1.84, 0.5), WY(1.84, 0.5), 0, V ? 1 : 0.32, V ? 0.32 : 1, H, A0); }
  for (const p of partsSorted()) {
    if (p.k < 2) {
      const u0 = p.k ? 1.68 : 0;
      // courses of stone: 4 rows of blocks, staggered
      for (let r = 0; r < 4; r++) {
        const h0 = (r * H) / 4, h1 = ((r + 1) * H) / 4 - 0.012, c = (r + p.k) & 1 ? STONE : STONE_D;
        box(u0, u0 + 0.32, 0.02, 0.98, h0, h1, c, STONE_L);
      }
    } else {
      // the arch lintel: three voussoirs
      for (let k = 0; k < 3; k++) box(0.32 + k * 0.4533, 0.32 + (k + 1) * 0.4533 - 0.01, 0.06, 0.94, HO, H, k === 1 ? STONE_L : STONE, STONE_L);
      // the portcullis: vertical bars sliding up (only what is below the lintel shows), cross bars, spikes
      const lift = open * (HO - 0.1), bot = 0.02 + lift;
      for (let k = 0; k < 8; k++) {
        const u = 0.39 + k * 0.175;
        box(u, u + 0.045, 0.46, 0.54, bot, HO, IRON, IRON_L);
        if (lift < HO - 0.05) box(u + 0.008, u + 0.037, 0.47, 0.53, bot - 0.05, bot, IRON_L);
      }
      for (const hb of [0.22, 0.48, 0.74]) { const h = hb + lift; if (h < HO - 0.03) box(0.33, 1.67, 0.47, 0.53, h, h + 0.035, IRON, IRON_L); }
      // the dark passage behind it when open (the vault)
      if (open > 0.05) box(0.33, 1.67, 0.08, 0.1, HO - 0.04, HO, STONE_D);
    }
  }
  return true;
}

// ---------- the mural (4 × 1, facing south) ----------
// two banner poles with the kingdom's banners, a framed board with notices under a gabled shingle roof, a lantern under
// the eave (glows at night), and — until the player first opens one (o._mark, game/towns.js) — a gold "!" bobbing above
const NOTE = [[0.96, 0.93, 0.82], [0.93, 0.87, 0.69], [0.99, 0.96, 0.89], [0.86, 0.9, 0.96], [0.95, 0.9, 0.78]];
const SHINGLE = [0.52, 0.29, 0.18], SHINGLE_D = [0.36, 0.19, 0.12];
const GOLD = [1, 0.8, 0.26], GOLD_D = [0.78, 0.52, 0.12];
function card(x, y, h0, w, hgt, c, a) {
  // an upright card facing the camera (its screen-right is the view's x)
  const rx = CAMV.c * w / 2, ry = CAMV.s * w / 2;
  F.quad(x - rx, y - ry, h0 + hgt, x + rx, y + ry, h0 + hgt, x + rx, y + ry, h0, x - rx, y - ry, h0, UV, c[0] * CR, c[1] * CG, c[2] * CB, a);
}
function drawMural(B, A, o, t) {
  const T = begin(B, A, o);
  if (!T) return false;
  V = false;
  const kc = o._kc || [0.7, 0.2, 0.2], k2 = o._kc2 || [0.92, 0.8, 0.34];
  if (!K.col().bp) { shadowRect(B, T, TX + 2, TY + 0.5, 0, 2.6, 0.3, 2, A0); shadowRect(B, T, TX + 0.3, TY + 0.5, 0, 0.2, 0.2, 2.6, A0); shadowRect(B, T, TX + 3.7, TY + 0.5, 0, 0.2, 0.2, 2.6, A0); }
  // banner poles: post, crossbar, the banner hanging (field + a stripe of the second colour + a swallowtail), a gold finial
  for (const u of [0.3, 3.7]) {
    box(u - 0.07, u + 0.07, 0.43, 0.57, 0, 2.62, WOOD_D, WOOD);
    box(u - 0.11, u + 0.11, 0.41, 0.59, 2.62, 2.72, GOLD_D, GOLD);
    box(u - 0.26, u + 0.26, 0.47, 0.53, 2.42, 2.48, WOOD_D, WOOD_L);
    const wv = Math.sin(t * 1.8 + u * 2 + TX) * 0.03;
    for (const [w, nw] of [[0.535, 1], [0.465, -1]]) {
      if (!seen(0, nw)) continue;
      const z = shade(0, nw), x0 = TX + u - 0.24, x1 = TX + u + 0.24, y = TY + w + wv * nw;
      const q = (h0, h1, c) => F.quad(x0, y, h1, x1, y, h1, x1, y, h0, x0, y, h0, UV, c[0] * z * CR, c[1] * z * CG, c[2] * z * CB, A0);
      q(1.5, 2.42, kc);
      q(1.86, 2.02, k2);
      F.quad(x0, y, 1.5, x1, y, 1.5, TX + u, y, 1.32, TX + u, y, 1.32, UV, kc[0] * z * 0.85 * CR, kc[1] * z * 0.85 * CG, kc[2] * z * 0.85 * CB, A0);
    }
  }
  // the board: posts, the planks with a frame, the notices on both faces
  box(0.72, 0.88, 0.42, 0.58, 0, 1.72, WOOD_D, WOOD);
  box(3.12, 3.28, 0.42, 0.58, 0, 1.72, WOOD_D, WOOD);
  box(0.84, 3.16, 0.46, 0.54, 0.46, 1.58, WOOD, WOOD_L);
  box(0.8, 3.2, 0.44, 0.56, 1.56, 1.63, WOOD_D, WOOD_L);
  box(0.8, 3.2, 0.44, 0.56, 0.42, 0.48, WOOD_D, WOOD_L);
  const notes = [[0.96, 1.36, 0.98, 1.46], [1.42, 1.78, 0.66, 1.12], [1.86, 2.36, 1.08, 1.5], [2.44, 2.98, 0.94, 1.42], [2.06, 2.42, 0.56, 0.9], [1.0, 1.32, 0.56, 0.84], [2.6, 3.04, 0.56, 0.82]];
  for (const [w, nw] of [[0.448, -1], [0.552, 1]]) {
    if (!seen(0, nw)) continue;
    const z = shade(0, nw);
    notes.forEach(([u0, u1, h0, h1], k) => {
      const c = NOTE[k % NOTE.length];
      F.quad(TX + u0, TY + w, h1, TX + u1, TY + w, h1, TX + u1, TY + w, h0, TX + u0, TY + w, h0, UV, c[0] * z * CR, c[1] * z * CG, c[2] * z * CB, A0);
      // lines of writing (dark strips) and a wax seal in the kingdom's colour on the big notices
      const wl = TY + w + nw * 0.002;
      for (let hh = h1 - 0.1; hh > h0 + 0.06; hh -= 0.08) F.quad(TX + u0 + 0.05, wl, hh, TX + u1 - 0.05, wl, hh, TX + u1 - 0.05, wl, hh - 0.022, TX + u0 + 0.05, wl, hh - 0.022, UV, 0.32 * z * CR, 0.26 * z * CG, 0.2 * z * CB, A0);
      if (k === 0 || k === 2) { const um = (u0 + u1) / 2, ws = TY + w + nw * 0.004; F.quad(TX + um - 0.05, ws, h0 + 0.13, TX + um + 0.05, ws, h0 + 0.13, TX + um + 0.05, ws, h0 + 0.04, TX + um - 0.05, ws, h0 + 0.04, UV, kc[0] * CR, kc[1] * CG, kc[2] * CB, A0); }
    });
  }
  // the roof: a gable along the board, shingled (two slopes in courses, a ridge board, gable ends)
  const rh0 = 1.68, rh1 = 2.06;
  for (const sd of [-1, 1]) {
    const w1 = 0.5 + sd * 0.5, z = sd > 0 ? 1.04 : 0.8;
    for (let k = 0; k < 4; k++) {
      const f0 = k / 4, f1 = (k + 1) / 4, wa = 0.5 + (w1 - 0.5) * f0, wb = 0.5 + (w1 - 0.5) * f1, ha = rh1 + (rh0 - rh1) * f0, hb = rh1 + (rh0 - rh1) * f1;
      const c = k & 1 ? SHINGLE_D : SHINGLE;
      const pts = sd > 0 ? [0.62, wa, ha, 3.38, wa, ha, 3.38, wb, hb, 0.62, wb, hb] : [0.62, wb, hb, 3.38, wb, hb, 3.38, wa, ha, 0.62, wa, ha];
      F.quad(TX + pts[0], TY + pts[1], pts[2], TX + pts[3], TY + pts[4], pts[5], TX + pts[6], TY + pts[7], pts[8], TX + pts[9], TY + pts[10], pts[11], UV, c[0] * z * CR, c[1] * z * CG, c[2] * z * CB, A0);
      F.quad(TX + pts[9], TY + pts[10], pts[11], TX + pts[6], TY + pts[7], pts[8], TX + pts[3], TY + pts[4], pts[5], TX + pts[0], TY + pts[1], pts[2], UV, c[0] * 0.55 * CR, c[1] * 0.55 * CG, c[2] * 0.55 * CB, A0);
    }
  }
  box(0.6, 3.4, 0.47, 0.53, rh1 - 0.02, rh1 + 0.05, WOOD_D, WOOD_L);
  for (const u of [0.62, 3.38]) {
    const nu = u < 2 ? -1 : 1;
    if (seen(nu, 0)) { const z = shade(nu, 0); F.quad(TX + u, TY + 0.5, rh1, TX + u, TY + 0.5, rh1, TX + u, TY + (nu < 0 ? 1 : 0), rh0, TX + u, TY + (nu < 0 ? 0 : 1), rh0, UV, WOOD[0] * z * CR, WOOD[1] * z * CG, WOOD[2] * z * CB, A0); }
  }
  // the lantern under the eave, in the middle of the front: iron cage, warm panes (they glow at night)
  const nt = kitNight();
  box(1.92, 2.08, 0.06, 0.2, 1.64, 1.68, IRON, IRON_L);
  box(1.95, 2.05, 0.09, 0.17, 1.42, 1.62, IRON, IRON_L);
  box(1.965, 2.035, 0.075, 0.185, 1.45, 1.59, [1, 0.82, 0.45], [1, 0.86, 0.55]);
  if (nt > 0.1) for (const w of [0.07, 0.19]) F.quad(TX + 1.93, TY + w, 1.62, TX + 2.07, TY + w, 1.62, TX + 2.07, TY + w, 1.41, TX + 1.93, TY + w, 1.41, UV, 1, 0.75, 0.38, -0.9 * nt * A0);
  // the "!" for a player who never opened a mural: bobbing gold, facing the camera, glowing a little at night
  if (o._mark) {
    const bob = 2.95 + Math.sin(t * 2.6) * 0.12, x = TX + 2, y = TY + 0.5;
    card(x, y, bob - 0.06, 0.62, 0.94, [0.2, 0.12, 0.05], A0);
    card(x, y, bob - 0.01, 0.52, 0.84, GOLD, A0);
    card(x, y, bob + 0.27, 0.15, 0.48, [0.26, 0.15, 0.05], A0);
    card(x, y, bob + 0.07, 0.15, 0.13, [0.26, 0.15, 0.05], A0);
    if (nt > 0.05) card(x, y, bob - 0.14, 0.8, 1.1, GOLD, -0.5 * nt);
  }
  return true;
}

registerFaces({ id: 'gate2', prio: 2, test: (o, d) => !!d?.gate2, draw: (B, A, o, t) => (d2(o) === 'stone' ? drawStoneGate(B, A, o, t) : drawWoodGate(B, A, o, t)) });
registerFaces({ id: 'mural', prio: 2, test: (o) => o.type === 'town_mural', draw: drawMural });
const d2 = (o) => BUILDINGS[o.type]?.gate2;

// ---------- icons (build menu, fallbacks) ----------
function gateIcon(stone) {
  return spritePx(96, 84, (g) => {
    const post = (x) => { g.fillStyle = stone ? '#9b968c' : '#5a3a1e'; g.fillRect(x, 10, 14, 70); g.fillStyle = stone ? '#b8b3a8' : '#7a5230'; g.fillRect(x, 10, 14, 4); };
    if (stone) {
      g.fillStyle = '#8c877e'; g.fillRect(6, 4, 84, 16);
      for (let r = 0; r < 5; r++) for (let x = (r & 1) * 7 + 6; x < 90; x += 14) { g.strokeStyle = 'rgba(40,36,30,0.45)'; g.strokeRect(x, 4 + r * 16, 14, 16); }
      post(6); post(76);
      g.fillStyle = '#2a2b30';
      for (let x = 24; x < 76; x += 8) g.fillRect(x, 20, 3, 60);
      for (const y of [34, 52, 68]) g.fillRect(20, y, 56, 3);
    } else {
      post(4); post(78);
      g.fillStyle = '#6b4626'; g.fillRect(16, 14, 64, 8);
      for (let i = 0; i < 2; i++) {
        const x0 = 18 + i * 31;
        for (let k = 0; k < 4; k++) { g.fillStyle = k & 1 ? '#7b5230' : '#93653b'; g.fillRect(x0 + k * 7.5, 22, 7, 56); }
        g.fillStyle = '#3c3c42'; g.fillRect(x0, 32, 30, 4); g.fillRect(x0, 64, 30, 4);
      }
    }
  });
}
function muralIcon() {
  return spritePx(96, 96, (g) => {
    g.fillStyle = '#4e3220'; g.fillRect(10, 20, 8, 72); g.fillRect(78, 20, 8, 72);
    g.fillStyle = lin(g, 0, 30, 0, 70, [[0, '#8a5f38'], [1, '#6a4526']]); g.fillRect(14, 30, 68, 44);
    const notes = [['#f2ead0', 20, 36, 18, 22], ['#ead9b0', 42, 40, 16, 20], ['#f6f0e0', 62, 34, 14, 26], ['#dde6f0', 24, 60, 22, 10]];
    for (const [c, x, y, w, h] of notes) { g.fillStyle = c; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(60,40,20,0.5)'; for (let k = 4; k < h - 2; k += 4) g.fillRect(x + 2, y + k, w - 4, 1); }
    g.fillStyle = '#b8342c'; g.beginPath(); g.arc(29, 50, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a3e28'; g.beginPath(); g.moveTo(4, 24); g.lineTo(48, 8); g.lineTo(92, 24); g.lineTo(92, 28); g.lineTo(4, 28); g.closePath(); g.fill();
  });
}
lazyDef('gate_big_wood', () => gateIcon(false), 0.5, 1);
lazyDef('gate_stone', () => gateIcon(true), 0.5, 1);
lazyDef('town_mural', muralIcon, 0.5, 1);
