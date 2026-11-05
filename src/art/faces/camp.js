// The kingdoms' war camps (docs/REINOS.md §14 "Fase 3b"): pieces drawn as computed 3D faces in the colours of the
// kingdom that raised them (o._kc field colour, o._kc2 metal — set from o.realm by game/mut/warfare.js war.mark).
//   war_tent   — a ridge tent (2 × 3, the ridge north–south): canvas in the kingdom's colour with a band of the metal, the
//                guy ropes, the door flaps tied open in the south gable, a pennant on the front pole;
//   war_banner — a tall standard: pole, crossbar, the banner in the field colour with a band of the metal and a
//                swallowtail, a gold finial, waving;
//   drawStandard — the same banner on a pole carried by a general (game/warfare.js: the cosmetic system adds it to the
//                depth-sorted list beside the general).
// Built in the piece's own frame (u east, w south, h up). Lazy art (build menu icons / fallbacks): war_tent, war_banner.
import { registerFaces } from './registry.js';
import { seen, shade, solidUV, shadowRect, depthOf, partsReset, part, partsSorted } from './kit.js';
import { ARCH_FACES as K } from '../archCompose.js';
import { lazyDef } from '../lazyDefs.js';
import { spritePx } from '../paint.js';

const WOOD = [0.42, 0.29, 0.17], WOOD_D = [0.3, 0.2, 0.11], WOOD_L = [0.56, 0.4, 0.25], GOLD = [1, 0.8, 0.26], GOLD_D = [0.74, 0.5, 0.14], ROPE = [0.78, 0.7, 0.52];
let F = null, UV = null, TX = 0, TY = 0, A0 = 1, CR = 1, CG = 1, CB = 1;
const q4 = (a, b, c, d, col, z = 1, al = A0) => F.quad(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2], UV, col[0] * z * CR, col[1] * z * CG, col[2] * z * CB, al);
// an axis box in world coordinates (x0..x1, y0..y1, h0..h1)
function wbox(x0, x1, y0, y1, h0, h1, c, ct = c) {
  if (seen(0, 1)) q4([x0, y1, h1], [x1, y1, h1], [x1, y1, h0], [x0, y1, h0], c, shade(0, 1));
  if (seen(0, -1)) q4([x1, y0, h1], [x0, y0, h1], [x0, y0, h0], [x1, y0, h0], c, shade(0, -1));
  if (seen(1, 0)) q4([x1, y1, h1], [x1, y0, h1], [x1, y0, h0], [x1, y1, h0], c, shade(1, 0));
  if (seen(-1, 0)) q4([x0, y0, h1], [x0, y1, h1], [x0, y1, h0], [x0, y0, h0], c, shade(-1, 0));
  q4([x0, y0, h1], [x1, y0, h1], [x1, y1, h1], [x0, y1, h1], ct, 1.08);
}
function begin(B, A, o) {
  F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  UV = solidUV(T);
  if (!UV) return false;
  K.setState(o); K.tone(o._k);
  const C = K.col();
  A0 = C.a; CR = C.r; CG = C.g; CB = C.b;
  TX = o.tx; TY = o.ty;
  return T;
}
const KC = [0.62, 0.16, 0.14], K2 = [0.92, 0.78, 0.3];

// ---------- the tent (2 × 3: the ridge north–south, the door in the south gable, facing the camera) ----------
function drawTent(B, A, o, t) {
  const T = begin(B, A, o);
  if (!T) return false;
  const kc = o._kc || KC, k2 = o._kc2 || K2, x0 = TX + 0.1, x1 = TX + 1.9, xm = TX + 1, y0 = TY + 0.2, y1 = TY + 2.8, H = 1.55, he = 0.1;
  if (!K.col().bp) shadowRect(B, T, TX + 1, TY + 1.5, 0, 1.9, 2.7, H * 0.7, A0);
  const canvas = [kc[0] * 0.9 + 0.07, kc[1] * 0.9 + 0.07, kc[2] * 0.9 + 0.07];
  // the two slopes (east / west): canvas with a band of the metal near the eaves
  for (const sd of [-1, 1]) {
    const xe = sd < 0 ? x0 : x1, nz = shade(sd, 0) * 0.92;
    const at = (f) => [xm + (xe - xm) * f, H + (he - H) * f];
    for (const [f0, f1, c] of [[0, 0.7, canvas], [0.7, 0.83, k2], [0.83, 1, canvas]]) {
      const [xa, ha] = at(f0), [xb, hb] = at(f1);
      const P = sd > 0 ? [[xa, y1, ha], [xa, y0, ha], [xb, y0, hb], [xb, y1, hb]] : [[xa, y0, ha], [xa, y1, ha], [xb, y1, hb], [xb, y0, hb]];
      q4(P[0], P[1], P[2], P[3], c, nz);
      q4(P[3], P[2], P[1], P[0], c, 0.45); // (the inside, seen through the door)
    }
  }
  // the gables: north closed; south with the door flaps tied back (a dark opening) and a band of the metal at the hem
  if (seen(0, -1)) q4([xm, y0, H], [xm, y0, H], [x1, y0, he], [x0, y0, he], canvas, shade(0, -1));
  if (seen(0, 1)) {
    const z = shade(0, 1), yf = y1;
    q4([xm, yf, H], [xm, yf, H], [x0, yf, he], [x1, yf, he], canvas, z);
    q4([x0 + 0.08, yf + 0.004, 0.32], [x1 - 0.08, yf + 0.004, 0.32], [x1, yf + 0.004, he], [x0, yf + 0.004, he], k2, z); // (the hem)
    q4([xm - 0.22, yf + 0.008, 0.95], [xm + 0.22, yf + 0.008, 0.95], [xm + 0.4, yf + 0.008, he], [xm - 0.4, yf + 0.008, he], [0.09, 0.07, 0.05], 1); // (the doorway)
    q4([xm, yf + 0.012, 1.35], [xm - 0.24, yf + 0.03, 0.92], [xm - 0.46, yf + 0.03, he + 0.02], [xm - 0.36, yf + 0.012, he + 0.02], canvas, z * 0.82); // (the flaps tied back)
    q4([xm + 0.24, yf + 0.03, 0.92], [xm, yf + 0.012, 1.35], [xm + 0.36, yf + 0.012, he + 0.02], [xm + 0.46, yf + 0.03, he + 0.02], canvas, z * 0.82);
  }
  // the ridge pole, the poles at the gables, a pennant on the front pole
  wbox(xm - 0.04, xm + 0.04, y0 - 0.06, y1 + 0.06, H - 0.02, H + 0.05, WOOD_D, WOOD_L);
  for (const y of [y0, y1]) wbox(xm - 0.045, xm + 0.045, y - 0.045, y + 0.045, 0, H + 0.42, WOOD_D, WOOD_L);
  const wv = Math.sin(t * 2.3 + TX * 0.7) * 0.07;
  q4([xm, y1, H + 0.4], [xm + 0.55, y1 + wv, H + 0.32], [xm + 0.55, y1 + wv, H + 0.24], [xm, y1, H + 0.18], kc, 1);
  q4([xm + 0.55, y1 + wv, H + 0.32], [xm, y1, H + 0.4], [xm, y1, H + 0.18], [xm + 0.55, y1 + wv, H + 0.24], kc, 0.7);
  // the guy ropes and their pegs (from the ridge ends and the eaves)
  for (const [x, y, xt, yt, ht] of [[xm, y0 - 0.5, xm, y0, H], [xm, y1 + 0.5, xm, y1, H], [x0 - 0.38, TY + 0.7, x0 + 0.05, TY + 0.7, 0.45], [x0 - 0.38, TY + 2.3, x0 + 0.05, TY + 2.3, 0.45], [x1 + 0.38, TY + 0.7, x1 - 0.05, TY + 0.7, 0.45], [x1 + 0.38, TY + 2.3, x1 - 0.05, TY + 2.3, 0.45]]) {
    q4([xt - 0.015, yt, ht], [xt + 0.015, yt, ht], [x + 0.015, y, 0.03], [x - 0.015, y, 0.03], ROPE, 0.9);
    wbox(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0, 0.1, WOOD_D);
  }
  return true;
}

// ---------- the banner (a tall standard on its own: 1 × 1) ----------
// the banner cloth: field + a band of the metal + a swallowtail, hung from a crossbar at height h1, waving
function cloth(x, y, h1, wdt, len, kc, k2, t, seed, al = A0) {
  const wv = (k) => Math.sin(t * 1.9 + seed + k * 2.2) * 0.07 * k;
  const rows = 6, x0 = x - wdt / 2, x1 = x + wdt / 2;
  for (let r = 0; r < rows; r++) {
    const f0 = r / rows, f1 = (r + 1) / rows, ha = h1 - len * f0, hb = h1 - len * f1, wa = wv(f0), wb = wv(f1);
    const c = f0 >= 0.38 && f0 < 0.55 ? k2 : kc, z = 0.9 + 0.12 * Math.sin(t * 2.1 + seed + r);
    const P = [[x0, y + wa, ha], [x1, y + wa, ha], [x1, y + wb, hb], [x0, y + wb, hb]];
    if (seen(0, 1)) q4(P[0], P[1], P[2], P[3], c, z, al); else q4(P[1], P[0], P[3], P[2], c, z * 0.8, al);
  }
  // the swallowtail: two points below
  const hb = h1 - len, wt = wv(1.15), m = (x0 + x1) / 2;
  for (const [a, b] of [[x0, m - 0.04], [m + 0.04, x1]]) {
    const P = [[a, y + wv(1), hb], [b, y + wv(1), hb], [(a + b) / 2 + (b > m ? 0.04 : -0.04), y + wt, hb - len * 0.22], [(a + b) / 2 + (b > m ? 0.04 : -0.04), y + wt, hb - len * 0.22]];
    if (seen(0, 1)) q4(P[0], P[1], P[2], P[3], kc, 0.86, al); else q4(P[1], P[0], P[3], P[2], kc, 0.7, al);
  }
}
function drawBanner(B, A, o, t) {
  const T = begin(B, A, o);
  if (!T) return false;
  const kc = o._kc || KC, k2 = o._kc2 || K2, x = TX + 0.5, y = TY + 0.55, H = 3.1;
  if (!K.col().bp) shadowRect(B, T, x, y, 0, 0.18, 0.18, H, A0);
  partsReset();
  part(depthOf(x, y - 0.02), 0); part(depthOf(x, y + 0.02), 1);
  for (const p of partsSorted()) {
    if (p.k === 0) {
      wbox(x - 0.16, x + 0.16, y - 0.16, y + 0.16, 0, 0.12, WOOD_D, WOOD_L); // (the foot)
      wbox(x - 0.05, x + 0.05, y - 0.05, y + 0.05, 0, H, WOOD_D, WOOD);
      wbox(x - 0.48, x + 0.48, y - 0.03, y + 0.03, H - 0.22, H - 0.16, WOOD_D, WOOD_L);
      wbox(x - 0.08, x + 0.08, y - 0.08, y + 0.08, H, H + 0.14, GOLD_D, GOLD);
    } else cloth(x, y + 0.06, H - 0.2, 0.86, 1.55, kc, k2, t, TX * 0.37 + TY * 0.71);
  }
  return true;
}
registerFaces({ id: 'war_tent', prio: 2, test: (o) => o.type === 'war_tent', draw: drawTent });
registerFaces({ id: 'war_banner', prio: 2, test: (o) => o.type === 'war_banner', draw: drawBanner });

// ---------- the general's standard (a drawable beside the general: game/warfare.js warfareFxSystem) ----------
// e: the general (x, y, z, facing), C: its crest { f, m } (kingdom colour, metal) — the pole held at its side, the
// banner above its head; raised high (and waving harder) while it rallies (e._rallyT)
export function drawStandard(B, A, e, C, t, lift = 0) {
  F = B.faces;
  if (!F) return false;
  const T = K.prep(A);
  UV = solidUV(T);
  if (!UV) return false;
  K.setState({}); K.tone(null);
  const S = K.col();
  A0 = e.dead ? 0 : S.a; CR = S.r; CG = S.g; CB = S.b;
  if (A0 <= 0) return true;
  const side = e.facing === 'w' ? -1 : e.facing === 'e' ? 1 : e.facing === 'n' ? 1 : -1;
  const px = e.x + side * 0.3, py = e.y + (e.facing === 'n' ? -0.08 : 0.06);
  const rally = e._rallyT != null && (e._rallyK || 0) > 0 ? e._rallyK : 0;
  const H = 2.55 + 0.35 * rally, h0 = lift + 0.15 + 0.2 * rally;
  wbox(px - 0.035, px + 0.035, py - 0.035, py + 0.035, h0, h0 + H, WOOD_D, WOOD);
  wbox(px - 0.36, px + 0.36, py - 0.025, py + 0.025, h0 + H - 0.18, h0 + H - 0.13, WOOD_D, WOOD_L);
  wbox(px - 0.06, px + 0.06, py - 0.06, py + 0.06, h0 + H, h0 + H + 0.11, GOLD_D, GOLD);
  cloth(px, py + 0.04, h0 + H - 0.16, 0.66, 1.05, C?.f || KC, C?.m || K2, t * (1 + rally), e.id || 0);
  return true;
}

// ---------- icons (build menu / fallbacks) ----------
function tentIcon() {
  return spritePx(96, 72, (g) => {
    g.fillStyle = '#8a2a24'; g.beginPath(); g.moveTo(6, 66); g.lineTo(48, 10); g.lineTo(90, 66); g.closePath(); g.fill();
    g.fillStyle = '#d9b54a'; g.fillRect(14, 54, 68, 5);
    g.fillStyle = '#1a1210'; g.beginPath(); g.moveTo(38, 66); g.lineTo(48, 34); g.lineTo(58, 66); g.closePath(); g.fill();
    g.fillStyle = '#5a3a1e'; g.fillRect(46, 4, 4, 10);
    g.fillStyle = '#8a2a24'; g.beginPath(); g.moveTo(50, 4); g.lineTo(66, 8); g.lineTo(50, 12); g.closePath(); g.fill();
  });
}
function bannerIcon() {
  return spritePx(48, 112, (g) => {
    g.fillStyle = '#4e3220'; g.fillRect(22, 8, 4, 104); g.fillRect(8, 14, 32, 3);
    g.fillStyle = '#d9b54a'; g.fillRect(20, 2, 8, 7);
    g.fillStyle = '#8a2a24'; g.beginPath(); g.moveTo(10, 17); g.lineTo(38, 17); g.lineTo(38, 70); g.lineTo(31, 62); g.lineTo(24, 70); g.lineTo(17, 62); g.lineTo(10, 70); g.closePath(); g.fill();
    g.fillStyle = '#d9b54a'; g.fillRect(10, 36, 28, 6);
  });
}
lazyDef('war_tent', tentIcon, 0.5, 1);
lazyDef('war_banner', bannerIcon, 0.5, 1);
