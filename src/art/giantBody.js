// The ice giant's own body ("Gigante de Gelo", species 'giant'): not a person scaled up, but a creature of its own —
// massive shoulders and ape-long arms with ice-crusted fists, a hunched heavy torso with ice crystals growing out of
// the back, thick legs on bare feet, a small jutting head (heavy brow of ice, tusks, frosted beard, a crown of ice
// crystals, glowing eyes), a fur and hide loincloth, an ice-crusted wooden club.
//
// How: like the livestock (art/livestock.js), each part is a small 3D model of ellipsoids in body space (x forward,
// y left, z up; px, 64 per tile) ray-cast pixel by pixel with cel shading, an orthographic camera PHI above the
// horizon and the painters' outline — so every view is the same giant seen from that side, the 3/4 views included.
// Unlike them the body is not one sprite per frame: it is a set of parts placed by a 3D skeleton every frame
// (art/giantRig.js), so every animation (walk, smash, throw, hurt, shatter) is smooth and works at every angle.
//
// Parts (lazy sprites in the look texture; anchor = the part's joint):
//   gi_torso_<v> · gi_head_<v> · gi_fist_<v> · gi_foot_<v> · gi_paulR_<v> / gi_paulL_<v>   per view v: s, se, e, ne, n
//                   (sw / w / nw mirrored — the parts are symmetric; a mirrored view swaps the two pauldrons)
//   gi_uarm · gi_farm · gi_thigh · gi_shin · gi_club   limbs and the club, painted along −z (pointing down), lit from
//                   the front so the rig can turn them any way
// SK: the rest skeleton the parts were modelled on (the rig poses it). EYES: the eye points on the head (glow).
// Everything is modelled in 'unit' px and painted GS times bigger (a giant about three times a person: ~3 tiles with
// its crown), so the sprites are sharp at their real size; the rig scales the skeleton the same way.

import { spritePxFast as spritePx, SS, hex } from './paint.js';
import { lazyDef } from './lazyDefs.js';

export const PHI = (18 * Math.PI) / 180;
export const GS = 1.8; // (the model's scale: unit px → painted px)
export const VIEWS5 = ['s', 'se', 'e', 'ne', 'n'];
export const YAW5 = { e: 0, se: Math.PI / 4, s: Math.PI / 2, ne: -Math.PI / 4, n: -Math.PI / 2 };
const OUTL = 'rgba(14,20,28,0.94)';

// ---------- the rest skeleton (px; torso joints relative to the pelvis, limbs along their own −z) ----------
export const SK = {
  pelvis: 56,                          // pelvis height above the ground
  hip: [0, 14, -3],                    // hip joints (± y) from the pelvis
  shoulder: [2, 31, 37],               // shoulder joints (± y) from the pelvis
  neck: [13, 0, 45],                   // neck joint from the pelvis
  uarm: 30, farm: 27, fist: 6,         // upper arm, forearm (elbow → wrist), wrist → fist centre
  thigh: 28, shin: 26, ankle: 7.5,     // leg bones; ankle height above the sole
  club: 44, clubTip: 63,               // grip → club head centre / tip
};
// the glowing eyes on the head (head space, from the neck joint) and the way they look (outward normal)
export const EYES = [[13.4, 4.2, 11.6], [13.4, -4.2, 11.6]];

// ---------- vectors ----------
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const col3 = (h) => { const c = hex(h); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
const mixv = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function axesAlong(u, up = [0, 0, 1]) {
  const x = nrm3(u);
  let y = cross3(up, x);
  if (len3(y) < 1e-4) y = cross3([0, 1, 0], x);
  y = nrm3(y);
  return [x, y, cross3(x, y)];
}
// deterministic value noise
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf), l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
const fbm3 = (x, y, z) => vnoise(x, y, z) * 0.62 + vnoise(x * 2.1 + 7.3, y * 2.1 - 3.1, z * 2.1 + 1.7) * 0.38;

// ---------- the model ----------
// part: { c, a (semi-axes), R (axes, columns), m (material), g (blend group), br (blend radius), id }
function E(c, a, m, o = {}) { return { c, a, R: o.R || IDENT, m, g: o.g ?? 'body', br: o.br ?? 3.4, edge: o.edge ?? true, id: o.id }; }
function seg(p0, p1, r, m, o = {}) {
  const d = sub3(p1, p0), L = len3(d) / 2;
  return E(mul3(add3(p0, p1), 0.5), [L + r * (o.cap ?? 0.35), r * (o.wy ?? 1), r * (o.wz ?? 1)], m, { ...o, R: axesAlong(d, o.up) });
}
const both = (fn) => [fn(1), fn(-1)];

// ---------- materials ----------
const C = {
  skin: col3('#5d7b99'), skinL: col3('#83a1b9'), skinD: col3('#425c76'),
  ice: col3('#c6eefa'), iceD: col3('#79bcd8'), rime: col3('#f4fcff'),
  hide: col3('#634634'), hideD: col3('#432f22'), fur: col3('#cfd6da'), furD: col3('#9aa6ae'),
  belt: col3('#3a2a20'), bone: col3('#ddd3bc'), beard: col3('#e4eef4'),
  wood: col3('#5f4430'), woodD: col3('#43301f'), socket: col3('#0f1a26'),
};
// glacier skin: mottled, frosted where it faces up (snow settles on the shoulders, the head, the fists)
const SKIN = { col: C.skin, fur: 0.05, frost: 0.5, tex: (P) => { const n = fbm3(P[0] / 9, P[1] / 9, P[2] / 11); return n > 0.62 ? mixv(C.skin, C.skinL, smooth(0.62, 0.8, n) * 0.6) : n < 0.3 ? mixv(C.skin, C.skinD, smooth(0.3, 0.12, n) * 0.5) : null; } };
// glacier ice: glossy, with thin dark cracks (noise ridges) and bright rime
const ICE = { col: C.ice, gloss: 0.55, ice: true, tex: (P) => { const n = fbm3(P[0] / 6, P[1] / 6, P[2] / 6); if (Math.abs(n - 0.5) < 0.022) return C.iceD; return n > 0.7 ? C.rime : null; } };
const HIDE = { col: C.hide, fur: 0.12, tex: (P) => (Math.abs(((P[2] * 0.55 + P[0] * 0.2) % 6) - 3) < 0.45 ? C.hideD : null) };
const WRAP = { col: C.hide, fur: 0.1, tex: (P) => (Math.abs(((P[2] + 40) % 5.5) - 2.75) < 0.6 ? C.hideD : null) };
const FUR = { col: C.fur, fur: 0.28, rough: 2.2, frost: 0.2, tex: (P) => (fbm3(P[0] / 3, P[1] / 3, P[2] / 5) < 0.38 ? C.furD : null) };
const BELT = { col: C.belt, fur: 0.08 };
const BONE = { col: C.bone, gloss: 0.15 };
const BEARD = { col: C.beard, fur: 0.18, rough: 1.6, tex: (P) => (fbm3(P[0] / 2.5, P[1] / 2.5, P[2] / 4) < 0.36 ? C.furD : null) };
const WOOD = { col: C.wood, fur: 0.1, tex: (P) => { const a = Math.atan2(P[1], P[0]); return Math.sin(a * 5 + fbm3(P[2] / 9, 0, 0) * 6) > 0.72 ? C.woodD : null; } };

// ---------- the parts ----------
function torso() {
  const P = [];
  P.push(E([6, 0, 13], [20, 21, 16], SKIN));                                    // belly
  P.push(E([11, 0, 9], [15, 17, 12], SKIN));                                    // gut
  P.push(E([9, 0, 29], [20, 28, 14], SKIN));                                    // chest
  for (const s of [1, -1]) P.push(E([17, 11 * s, 30], [8, 12, 8], SKIN, { br: 4 })); // pecs
  P.push(E([-9, 0, 35], [18, 26, 16], SKIN));                                   // the hump of the upper back
  P.push(E([5, 0, 41], [12, 19, 9], SKIN));                                     // traps
  for (const s of [1, -1]) {
    P.push(E([2, 31 * s, 37], [13, 12.5, 13], SKIN));                           // deltoids (the arms hang here)
    P.push(E([-1, 21 * s, 22], [14, 10, 14], SKIN));                            // lats
  }
  P.push(E([2, 0, 3], [17.5, 23, 4.2], BELT, { g: 'belt' }));                   // belt
  P.push(E([16.8, 0, 3], [3, 4.2, 3.6], BONE, { g: 'bone' }));                  // a bone toggle
  P.push(E([1, 0, -4], [16, 22, 8], FUR, { g: 'cloth' }));                      // fur skirt
  P.push(E([11, 0, -14], [4.5, 12, 13], HIDE, { g: 'flap' }));                  // hide flaps, front and back
  P.push(E([-10, 0, -14], [4.5, 13, 13], HIDE, { g: 'flap' }));
  for (const s of [1, -1]) P.push(E([0, 19 * s, -10], [9, 5.5, 9], FUR, { g: 'cloth' }));
  // glacier ice growing out of the back: a crust over the hump and crystals leaning back and out (low behind the
  // head, so it never reads as sunk between them)
  P.push(E([-17, 0, 36], [6, 19, 11], ICE, { g: 'ice' }));
  for (const s of [1, -1]) {
    P.push(seg([-16, 11 * s, 40], [-23, 19 * s, 58], 4.4, ICE, { g: 'ice' }));
    P.push(seg([-12, 20 * s, 37], [-17, 29 * s, 51], 3.2, ICE, { g: 'ice' }));
    P.push(seg([-15, 6 * s, 27], [-23, 10 * s, 37], 2.6, ICE, { g: 'ice' }));
  }
  P.push(seg([-19, 0, 40], [-25, 0, 55], 3.8, ICE, { g: 'ice' }));
  return [P, []];
}
function head() {
  const P = [];
  P.push(E([5, 0, 12], [10, 9.5, 10.5], SKIN, { id: 'skull' }));
  P.push(E([8.5, 0, 4.5], [8, 9, 6], SKIN));                                    // heavy jaw
  for (const s of [1, -1]) P.push(E([10.5, 5.5 * s, 7.5], [4, 4, 3.3], SKIN));  // cheekbones
  P.push(E([14, 0, 9.5], [3, 2.6, 3.5], SKIN));                                 // nose
  P.push(E([11.5, 0, 14.6], [3.8, 9.6, 3], ICE, { g: 'ice' }));                 // a brow ridge of ice
  P.push(E([11, 0, 1.5], [6, 8.5, 7.5], BEARD, { g: 'beard' }));                // frosted beard
  P.push(E([12.5, 0, -4.5], [4, 5.5, 5.5], BEARD, { g: 'beard' }));
  for (const s of [1, -1]) {
    P.push(seg([13.5, 4.2 * s, 4.5], [15.5, 6.4 * s, 11.5], 1.35, BONE, { g: 'tusk' + s, br: 0.5 })); // tusks
    P.push(E([2, 9 * s, 11], [3, 1.6, 4], SKIN));                               // small ears
    P.push(seg([-1, 5 * s, 19], [-4, 9 * s, 26], 2, ICE, { g: 'ice' }));        // the crown of ice crystals
    P.push(seg([-4, 8 * s, 15], [-9, 13 * s, 20], 1.6, ICE, { g: 'ice' }));
  }
  P.push(seg([2, 0, 20], [0, 0, 29], 2.3, ICE, { g: 'ice' }));
  const F = EYES.map((c) => ({ c, r: 2.3, col: C.socket, on: 'skull' }));        // deep sockets (the glow is drawn by the rig)
  return [P, F];
}
function upperArm() {
  return [[seg([0, 0, 0], [0, 0, -SK.uarm], 10.5, SKIN), E([3, 0, -13], [9.5, 9.5, 11], SKIN), E([-1, 0, -24], [8, 8.5, 6.5], SKIN)], []];
}
function forearm() {
  const L = SK.farm;
  return [[seg([0, 0, 0], [0, 0, -L], 9.6, SKIN), E([0, 0, -L + 8], [10.4, 10.4, 6.5], ICE, { g: 'ice' }),
    seg([-7, 0, -L + 12], [-13, 0, -L + 17], 1.8, ICE, { g: 'ice' }), seg([-5, 5, -L + 7], [-10, 9, -L + 10], 1.6, ICE, { g: 'ice' }), seg([-5, -5, -L + 7], [-10, -9, -L + 10], 1.6, ICE, { g: 'ice' })], []];
}
function fist() {
  return [[E([0, 0, 0], [10, 9.5, 9.5], SKIN), E([6, 0, 3], [4.6, 9, 4.4], SKIN), E([-6, 0, 6.5], [4.8, 8.2, 3.6], ICE, { g: 'ice' })], []];
}
function thigh() { return [[seg([0, 0, 0], [0, 0, -SK.thigh], 12.5, SKIN), E([2, 0, -10], [13, 12.5, 11], SKIN)], []]; }
function shin() { return [[seg([0, 0, 0], [0, 0, -SK.shin], 10.5, SKIN), E([0, 0, -SK.shin + 11], [11.3, 11.3, 8.5], WRAP, { g: 'wrap' })], []]; }
function foot() {
  const P = [E([5, 0, -3], [12.5, 9.5, 5], SKIN), E([14, 0, -4.6], [5, 9.5, 3.6], SKIN)];
  for (const y of [-5.4, 0, 5.4]) P.push(E([17.6, y, -5], [3.3, 2.9, 2.7], SKIN, { br: 1.2 }));
  P.push(E([0, 0, 0.5], [9.5, 9.5, 4.6], WRAP, { g: 'wrap' }));
  return [P, []];
}
function club() {
  const P = [seg([0, 0, 9], [0, 0, -22], 3.4, WOOD), E([0, 0, 1], [4.2, 4.2, 6.5], WRAP, { g: 'wrap' }), seg([0, 0, -20], [0, 0, -54], 7.8, WOOD), E([0, 0, -43], [9.4, 9.4, 13], WOOD)];
  P.push(E([1, 0, -45], [10.4, 10.2, 10], ICE, { g: 'ice' }));
  P.push(seg([6, 0, -38], [14, 0, -33], 2.2, ICE, { g: 'ice' }), seg([-5, 6, -44], [-11, 12, -42], 2, ICE, { g: 'ice' }), seg([-3, -7, -50], [-6, -14, -50], 2, ICE, { g: 'ice' }));
  P.push(seg([1, 0, -54], [2, 0, -63], 2.4, ICE, { g: 'ice' }), seg([4, 5, -48], [9, 10, -50], 1.8, ICE, { g: 'ice' }));
  return [P, []];
}
// a slab of ice on a shoulder, its crags leaning out and back (s: −1 the right shoulder, +1 the left)
function pauldron(s) {
  return [[E([0, 2.5 * s, 2.5], [10, 10.5, 5.5], ICE, { g: 'ice' }), E([-1, 4 * s, 0], [9, 8, 4], ICE, { g: 'ice' }),
    seg([-2, 5 * s, 5], [-5, 12 * s, 13], 2.4, ICE, { g: 'ice' }), seg([4, 6 * s, 4], [5, 11 * s, 10], 1.8, ICE, { g: 'ice' })], []];
}

// ---------- rendering (ray-cast ellipsoids, cel shaded; the livestock renderer, with ice gloss and frost) ----------
const CAM = { U: [0, 0, 1], C: [0, 1, 0] };
function setCam(phi) { const s = Math.sin(phi), c = Math.cos(phi); CAM.U = [0, -s, c]; CAM.C = [0, c, s]; }
function bodyToWorld(yaw) { const cy = Math.cos(yaw), sy = Math.sin(yaw); return [[cy, sy, 0], [sy, -cy, 0], [0, 0, 1]]; } // columns: forward, left, up
const mv = (M, v) => [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]];
const mtv = (M, v) => [dot3(M[0], v), dot3(M[1], v), dot3(M[2], v)];
function prep(p, Wb) {
  const c = mv(Wb, p.c), ax = p.R.map((col) => mv(Wb, col)), A = ax.map((col, i) => mul3(col, 1 / p.a[i]));
  const q = { p, c, ax, A, Ac: [dot3(A[0], c), dot3(A[1], c), dot3(A[2], c)], AR: [A[0][0], A[1][0], A[2][0]],
    AU: [dot3(A[0], CAM.U), dot3(A[1], CAM.U), dot3(A[2], CAM.U)], AC: [dot3(A[0], CAM.C), dot3(A[1], CAM.C), dot3(A[2], CAM.C)] };
  let ex = 0, ey = 0;
  for (let i = 0; i < 3; i++) { ex += (ax[i][0] * p.a[i]) ** 2; ey += (dot3(ax[i], CAM.U) * p.a[i]) ** 2; }
  q.ex = Math.sqrt(ex); q.ey = Math.sqrt(ey); q.sx = c[0]; q.sy = -dot3(c, CAM.U); q.dd = dot3(q.AC, q.AC); q.amin = Math.min(p.a[0], p.a[1], p.a[2]);
  return q;
}
// light in camera terms (right, up, toward the camera): the body upper left; the limbs from the front (they turn)
const LIGHT_BODY = [-0.55, 0.72, 0.42], LIGHT_LIMB = [-0.18, 0.42, 0.89];
function render(lg, P, parts, feats, yaw, ox, oy, opt = {}) {
  setCam(PHI);
  const Wb = bodyToWorld(yaw), Q = parts.map((p) => prep(p, Wb));
  const lw = opt.light || LIGHT_BODY, L = nrm3(add3(add3([lw[0], 0, 0], mul3(CAM.U, lw[1])), mul3(CAM.C, lw[2])));
  const cw = lg.canvas.width, ch = lg.canvas.height, pad = P.pad, N = cw * ch;
  const D = new Float32Array(N).fill(-1e9), I = new Int16Array(N).fill(-1);
  for (let k = 0; k < Q.length; k++) {
    const q = Q[k];
    const u0 = Math.max(0, Math.floor((ox + q.sx - q.ex - 1 + pad) * SS)), u1 = Math.min(cw - 1, Math.ceil((ox + q.sx + q.ex + 1 + pad) * SS));
    const v0 = Math.max(0, Math.floor((oy + q.sy - q.ey - 1 + pad) * SS)), v1 = Math.min(ch - 1, Math.ceil((oy + q.sy + q.ey + 1 + pad) * SS));
    const AR = q.AR, AU = q.AU, Ac = q.Ac, AC = q.AC, a = q.dd;
    for (let v = v0; v <= v1; v++) {
      const sy = (v + 0.5) / SS - pad - oy, by0 = -sy * AU[0] - Ac[0], by1 = -sy * AU[1] - Ac[1], by2 = -sy * AU[2] - Ac[2];
      for (let u = u0; u <= u1; u++) {
        const sx = (u + 0.5) / SS - pad - ox, q0 = sx * AR[0] + by0, q1 = sx * AR[1] + by1, q2 = sx * AR[2] + by2;
        const b = q0 * AC[0] + q1 * AC[1] + q2 * AC[2], cc = q0 * q0 + q1 * q1 + q2 * q2 - 1, disc = b * b - a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / a, i = v * cw + u;
        if (t > D[i]) { D[i] = t; I[i] = k; }
      }
    }
  }
  const img = lg.getImageData(0, 0, cw, ch), px = img.data;
  const fw = feats.map((f) => ({ ...f, w: mv(Wb, f.c) }));
  const P3 = [0, 0, 0], QA = [0, 0, 0];
  for (let v = 0; v < ch; v++) for (let u = 0; u < cw; u++) {
    const i = v * cw + u, k = I[i];
    if (k < 0) continue;
    const q = Q[k], p = q.p, sx = (u + 0.5) / SS - pad - ox, sy = (v + 0.5) / SS - pad - oy, t = D[i];
    P3[0] = sx; P3[1] = -sy * CAM.U[1] + t * CAM.C[1]; P3[2] = -sy * CAM.U[2] + t * CAM.C[2];
    let nx = 0, ny = 0, nz = 0;
    for (let j = 0; j < Q.length; j++) {
      const o = Q[j];
      if (j !== k && (o.p.g !== p.g || Math.abs(P3[0] - o.c[0]) > o.ex + o.p.br + 2 || Math.abs(sy - o.sy) > o.ey + o.p.br + 2)) continue;
      const dx = P3[0] - o.c[0], dy = P3[1] - o.c[1], dz = P3[2] - o.c[2], A0 = o.A[0], A1 = o.A[1], A2 = o.A[2];
      const a0 = A0[0] * dx + A0[1] * dy + A0[2] * dz, a1 = A1[0] * dx + A1[1] * dy + A1[2] * dz, a2 = A2[0] * dx + A2[1] * dy + A2[2] * dz;
      let w = 1;
      if (j !== k) { const d = (Math.sqrt(a0 * a0 + a1 * a1 + a2 * a2) - 1) * o.amin; if (d > o.p.br) continue; w = (1 - Math.max(0, d) / o.p.br) ** 2 * 0.9; }
      else { QA[0] = a0; QA[1] = a1; QA[2] = a2; }
      const gx = A0[0] * a0 + A1[0] * a1 + A2[0] * a2, gy = A0[1] * a0 + A1[1] * a1 + A2[1] * a2, gz = A0[2] * a0 + A1[2] * a1 + A2[2] * a2;
      const gl = w / (Math.hypot(gx, gy, gz) || 1);
      nx += gx * gl; ny += gy * gl; nz += gz * gl;
    }
    const m = p.m, Pb = mtv(Wb, P3);
    let c = m.col;
    if (m.tex) { const tc = m.tex(Pb, p, QA[0], QA[1], QA[2]); if (tc) c = tc; }
    let cr = c[0], cg = c[1], cb = c[2];
    if (m.fur) { const kk = 1 + (vnoise(Pb[0] / 2.2, Pb[1] / 2.2, Pb[2] / 3.4) - 0.5) * m.fur; cr *= kk; cg *= kk; cb *= kk; }
    if (m.rough) {
      const f = 1 / m.rough, X = Pb[0] * f, Y = Pb[1] * f, Z = Pb[2] * f;
      const bx = Math.cos(X * 2.1 + Math.sin(Z * 1.7) * 1.3), by = Math.cos(Y * 2.3 + Math.sin(X * 1.9) * 1.2), bz = Math.cos(Z * 2.2 + Math.sin(Y * 1.6) * 1.4);
      const wb = mv(Wb, [bx, by, bz]), amp = 0.4 / (Math.hypot(nx, ny, nz) || 1);
      nx = nx * amp / 0.4 + wb[0] * 0.4; ny = ny * amp / 0.4 + wb[1] * 0.4; nz = nz * amp / 0.4 + wb[2] * 0.4;
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // frost settles where the surface faces up (snow on the shoulders, the head, the knuckles)
    if (m.frost && nz > 0.45) { const f = smooth(0.45, 0.85, nz) * m.frost * (0.7 + 0.6 * vnoise(Pb[0] / 3, Pb[1] / 3, Pb[2] / 3)); cr += (0.93 - cr) * f; cg += (0.97 - cg) * f; cb += (1 - cb) * f; }
    for (const f of fw) {
      if (f.on && f.on !== p.id) continue;
      const dx = P3[0] - f.w[0], dy = P3[1] - f.w[1], dz = P3[2] - f.w[2];
      if (dx * dx + dy * dy + dz * dz > f.r * f.r) continue;
      cr = f.col[0]; cg = f.col[1]; cb = f.col[2];
    }
    // cel shading: a soft ramp, cool darks (the giant is ice), a little sky from above
    const ndl = nx * L[0] + ny * L[1] + nz * L[2];
    const k1 = smooth(0.18, 0.72, ndl * 0.5 + 0.5);
    let sh = 0.56 + 0.5 * k1 + 0.05 * nz;
    if (!opt.limb) sh *= 0.86 + 0.14 * clamp01((P3[2] + 40) / 120);
    let r = cr * sh * (0.9 + 0.1 * k1), g = cg * sh * (0.95 + 0.05 * k1), b2 = cb * sh;
    if (m.gloss) { const sp = Math.max(0, ndl) ** (m.ice ? 9 : 14) * m.gloss; r += sp; g += sp; b2 += sp; }
    if (m.ice) { const rim = Math.max(0, 1 - Math.abs(nx * CAM.C[0] + ny * CAM.C[1] + nz * CAM.C[2])) ** 3 * 0.35; r += rim * 0.7; g += rim * 0.9; b2 += rim; } // (light through the edges)
    px[i * 4] = Math.min(255, r * 255); px[i * 4 + 1] = Math.min(255, g * 255); px[i * 4 + 2] = Math.min(255, b2 * 255); px[i * 4 + 3] = 255;
  }
  // inner lines where a part passes in front of another of another group (depth jump)
  const TH = 5, K = 2, ink = [14, 22, 32], OFFS = [K, -K, K * cw, -K * cw];
  for (let v = K; v < ch - K; v++) for (let u = K; u < cw - K; u++) {
    const i = v * cw + u;
    if (I[i] < 0 || !Q[I[i]].p.edge) continue;
    const d = D[i], gi = Q[I[i]].p.g;
    let hit = false;
    for (const o of OFFS) { const j = i + o; if (I[j] >= 0 && D[j] - d > TH && Q[I[j]].p.edge && Q[I[j]].p.g !== gi) { hit = true; break; } }
    if (!hit) continue;
    const o = i * 4;
    px[o] = px[o] * 0.25 + ink[0] * 0.75; px[o + 1] = px[o + 1] * 0.25 + ink[1] * 0.75; px[o + 2] = px[o + 2] * 0.25 + ink[2] * 0.75;
  }
  lg.putImageData(img, 0, 0);
}
// screen box of a model at a yaw: [W, H, anchor x, anchor row] (the model's origin is the anchor)
function boxOf(parts, yaw) {
  setCam(PHI);
  const Wb = bodyToWorld(yaw);
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const p of parts) { const q = prep(p, Wb); x0 = Math.min(x0, q.sx - q.ex); x1 = Math.max(x1, q.sx + q.ex); y0 = Math.min(y0, q.sy - q.ey); y1 = Math.max(y1, q.sy + q.ey); }
  const hw = Math.ceil(Math.max(-x0, x1)) + 5, top = Math.ceil(-y0) + 5, bot = Math.ceil(Math.max(0, y1)) + 5;
  return [hw * 2, top + bot, hw, top];
}

// a model (unit px) GS times bigger: centres, semi-axes, blend radii, marks
function scaled([parts, feats]) {
  for (const p of parts) { p.c = mul3(p.c, GS); p.a = mul3(p.a, GS); p.br *= GS; }
  return [parts, feats.map((f) => ({ ...f, c: mul3(f.c, GS), r: f.r * GS }))];
}

// ---------- registration (painted on demand into the look texture) ----------
const MODELS = { torso, head, fist, foot, paulR: () => pauldron(-1), paulL: () => pauldron(1), uarm: upperArm, farm: forearm, thigh, shin, club };
const OW = { torso: 2.6, head: 2.2, fist: 2.2, foot: 2.2, paulR: 2.2, paulL: 2.2, uarm: 2.4, farm: 2.4, thigh: 2.4, shin: 2.4, club: 2.2 };
export const GIANT_PARTS = [];
function def(name, kind, yaw, limb) {
  const model = scaled(MODELS[kind]());
  const [W, H, hw, top] = boxOf(model[0], yaw);
  lazyDef(name, () => spritePx(W, H, (g, P) => P.layer((lg) => render(lg, P, model[0], model[1], yaw, hw, top, { light: limb ? LIGHT_LIMB : LIGHT_BODY, limb }), OW[kind], OUTL)), hw / W, top / H);
  GIANT_PARTS.push(name);
}
for (const v of VIEWS5) for (const k of ['torso', 'head', 'fist', 'foot', 'paulR', 'paulL']) def(`gi_${k}_${v}`, k, YAW5[v], false);
for (const k of ['uarm', 'farm', 'thigh', 'shin', 'club']) def('gi_' + k, k, 0, true);
