// Livestock art (docs/LIVESTOCK.md): cow, sheep, pig, chicken (+ their young) and fish, in the animals' look (cel shading,
// soft fur, dark outline) but from a small 3D model, so every view is the real animal seen from that side — the 3/4
// views (se / ne; sw / nw mirrored) included, never a squeezed side view.
//
// How: each animal is a set of ellipsoids in body space (x forward, y left, z up; px, 64 per tile; origin = the ground
// under the body). A sprite turns the body to its view (yaw) and ray-casts it pixel by pixel (orthographic camera 18°
// above the horizon, light from the upper left of the screen): the nearest surface wins, normals of touching parts are
// blended (smooth joints), materials add fur noise, coat patches (in body space: the same on every view and frame),
// eyes and nostrils as surface marks; depth jumps get a thin inner line, the layer gets the painters' outline.
//
// Sprite names (anchor = the ground point under the body):
//   <sp>_<v>            standing · v: e (side, facing right), se, s (front), ne, n (back); w / sw / nw = mirrored
//   <sp>_<v>_w0..w3     trot frames (diagonal pairs: 0 A forward, 1 A passing / B lifted, 2 B forward, 3 B passing / A lifted);
//                       s / n views: w0 and w2 only
//   <sp>_<v>_graze      head down to the grass (e, se, ne)
//   <sp>_baby_<v>(_w0|_w2)  the young (no graze)
//   fish_top, fish_top_1, fish_top_2 (swimming, seen from above: tail swing) · fish_e / fish_s / fish_n (a jump)
// Also: the feeder (2×1 trough, empty / full, front + side art), wheat (crop_wheat_0..3, wild_wheat_0), item icons
// (wheat, seed_wheat, bread, fish_raw, fish_cooked, wool, feather, rod_wood), held_rod_wood, fx_rope, fx_bobber.

import { spritePxFast as spritePx, rng, TAU, mixc, rgb, hex, lin, rad, circle, leaf, taper, SS } from './paint.js';

const OUTL = 'rgba(30,22,16,0.92)';
const PHI = (18 * Math.PI) / 180;

// ---------- small vector helpers (arrays of 3) ----------
const v3 = (x, y, z) => [x, y, z];
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

// rotation matrices (columns = local axes in body space)
const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// axes with the local x along `u` (a limb / a stretched part), z as close to `up` as possible
function axesAlong(u, up = [0, 0, 1]) {
  const x = nrm3(u);
  let y = cross3(up, x);
  if (len3(y) < 1e-4) y = cross3([0, 1, 0], x);
  y = nrm3(y);
  const z = cross3(x, y);
  return [x, y, z];
}
// pitch (nose up = +) about the lateral axis, then yaw about z, then roll about the local x
function axesPYR(pitch = 0, yaw = 0, roll = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  let x = [cp, 0, sp], y = [0, 1, 0], z = [-sp, 0, cp];
  const yawv = (v) => [v[0] * cy - v[1] * sy, v[0] * sy + v[1] * cy, v[2]];
  x = yawv(x); y = yawv(y); z = yawv(z);
  const y2 = add3(mul3(y, cr), mul3(z, sr)), z2 = add3(mul3(z, cr), mul3(y, -sr));
  return [x, y2, z2];
}

// ---------- 3D value noise (deterministic) ----------
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi), c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1), c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w);
}
const fbm3 = (x, y, z) => vnoise(x, y, z) * 0.62 + vnoise(x * 2.1 + 7.3, y * 2.1 - 3.1, z * 2.1 + 1.7) * 0.38;

// ---------- the model ----------
// part: { c: [x, y, z], a: [ax, ay, az] (semi-axes), R: axes (columns, body space), m: material, g: blend group,
//         br: blend radius (px), edge: false (no inner line around it) }
// material: { col, belly?, tex?(Pb, part) → [r, g, b] | null, fur (noise amount), gloss, rough (wool bumps) }
function E(c, a, m, o = {}) { return { c, a, R: o.R || IDENT, m, g: o.g ?? 'body', br: o.br ?? 3.2, edge: o.edge ?? true, id: o.id }; }
// a limb segment p0 → p1 of radius r (an ellipsoid stretched between the points)
function seg(p0, p1, r, m, o = {}) {
  const d = sub3(p1, p0), L = len3(d) / 2;
  return E(mul3(add3(p0, p1), 0.5), [L + r * 0.35, r * (o.wy ?? 1), r * (o.wz ?? 1)], m, { ...o, R: axesAlong(d, o.up) });
}

// ---------- rendering ----------
const CAM = { R: [1, 0, 0], U: [0, 0, 0], C: [0, 0, 0] };
function setCam(phi) {
  const s = Math.sin(phi), c = Math.cos(phi);
  CAM.U = [0, -s, c]; CAM.C = [0, c, s];
}
// body → world for a view yaw (world: x east, y south, z up)
function bodyToWorld(yaw) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [[cy, sy, 0], [sy, -cy, 0], [0, 0, 1]]; // columns: forward, left, up
}
const mv = (M, v) => [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]];
const mtv = (M, v) => [dot3(M[0], v), dot3(M[1], v), dot3(M[2], v)]; // inverse of an orthonormal M

// precompute a part in world space for the current camera
function prep(p, Wb) {
  const c = mv(Wb, p.c);
  const ax = p.R.map((col) => mv(Wb, col)); // world axes
  const A = ax.map((col, i) => mul3(col, 1 / p.a[i])); // rows of A = axis / a
  const q = {
    p, c, ax, A, Ac: [dot3(A[0], c), dot3(A[1], c), dot3(A[2], c)],
    AR: [A[0][0], A[1][0], A[2][0]],
    AU: [dot3(A[0], CAM.U), dot3(A[1], CAM.U), dot3(A[2], CAM.U)],
    AC: [dot3(A[0], CAM.C), dot3(A[1], CAM.C), dot3(A[2], CAM.C)],
  };
  // screen half extents: |row · G| with G = axes · diag(a)
  let ex = 0, ey = 0;
  for (let i = 0; i < 3; i++) { ex += (ax[i][0] * p.a[i]) ** 2; ey += (dot3(ax[i], CAM.U) * p.a[i]) ** 2; }
  q.ex = Math.sqrt(ex); q.ey = Math.sqrt(ey);
  q.sx = c[0]; q.sy = -dot3(c, CAM.U);
  q.dd = dot3(q.AC, q.AC);
  q.amin = Math.min(p.a[0], p.a[1], p.a[2]);
  return q;
}

// light (screen fixed: upper left, a bit toward the camera) in world space
function lightDir() { return nrm3(add3(add3(mul3(CAM.R, -0.55), mul3(CAM.U, 0.72)), mul3(CAM.C, 0.42))); }

// draw model `parts` (+ marks `feats`) seen at `yaw` into layer context lg (FastPainter layer: device px = (design + pad) × SS)
function render(lg, P, parts, feats, yaw, ox, oy, opt = {}) {
  setCam(opt.phi ?? PHI);
  const Wb = bodyToWorld(yaw);
  const Q = parts.map((p) => prep(p, Wb));
  const L = lightDir();
  const cw = lg.canvas.width, ch = lg.canvas.height, pad = P.pad;
  const N = cw * ch;
  const D = new Float32Array(N).fill(-1e9), I = new Int16Array(N).fill(-1);
  // design px of device pixel (u, v): (u + 0.5) / SS − pad; relative to the anchor (ox, oy)
  for (let k = 0; k < Q.length; k++) {
    const q = Q[k];
    const u0 = Math.max(0, Math.floor((ox + q.sx - q.ex - 1 + pad) * SS)), u1 = Math.min(cw - 1, Math.ceil((ox + q.sx + q.ex + 1 + pad) * SS));
    const v0 = Math.max(0, Math.floor((oy + q.sy - q.ey - 1 + pad) * SS)), v1 = Math.min(ch - 1, Math.ceil((oy + q.sy + q.ey + 1 + pad) * SS));
    const AR = q.AR, AU = q.AU, Ac = q.Ac, AC = q.AC, a = q.dd;
    for (let v = v0; v <= v1; v++) {
      const sy = (v + 0.5) / SS - pad - oy;
      const by0 = -sy * AU[0] - Ac[0], by1 = -sy * AU[1] - Ac[1], by2 = -sy * AU[2] - Ac[2];
      for (let u = u0; u <= u1; u++) {
        const sx = (u + 0.5) / SS - pad - ox;
        const q0 = sx * AR[0] + by0, q1 = sx * AR[1] + by1, q2 = sx * AR[2] + by2;
        const b = q0 * AC[0] + q1 * AC[1] + q2 * AC[2];
        const cc = q0 * q0 + q1 * q1 + q2 * q2 - 1;
        const disc = b * b - a * cc;
        if (disc < 0) continue;
        const t = (-b + Math.sqrt(disc)) / a;
        const i = v * cw + u;
        if (t > D[i]) { D[i] = t; I[i] = k; }
      }
    }
  }
  const img = lg.getImageData(0, 0, cw, ch);
  const px = img.data;
  const fw = feats.map((f) => ({ ...f, w: mv(Wb, f.c), on: f.on }));
  const hl = mul3(L, 1); // eye highlights face the light
  const P3 = [0, 0, 0], QA = [0, 0, 0];
  for (let v = 0; v < ch; v++) {
    for (let u = 0; u < cw; u++) {
      const i = v * cw + u, k = I[i];
      if (k < 0) continue;
      const q = Q[k], p = q.p;
      const sx = (u + 0.5) / SS - pad - ox, sy = (v + 0.5) / SS - pad - oy, t = D[i];
      P3[0] = sx; P3[1] = -sy * CAM.U[1] + t * CAM.C[1]; P3[2] = -sy * CAM.U[2] + t * CAM.C[2];
      // normal blended with the touching parts of the same group (smooth joints); colour from the part hit
      let nx = 0, ny = 0, nz = 0;
      for (let j = 0; j < Q.length; j++) {
        const o = Q[j];
        if (j !== k && (o.p.g !== p.g || Math.abs(P3[0] - o.c[0]) > o.ex + o.p.br + 2)) continue;
        const dx = P3[0] - o.c[0], dy = P3[1] - o.c[1], dz = P3[2] - o.c[2];
        const A0 = o.A[0], A1 = o.A[1], A2 = o.A[2];
        const a0 = A0[0] * dx + A0[1] * dy + A0[2] * dz;
        const a1 = A1[0] * dx + A1[1] * dy + A1[2] * dz;
        const a2 = A2[0] * dx + A2[1] * dy + A2[2] * dz;
        let w = 1;
        if (j !== k) { const d = (Math.sqrt(a0 * a0 + a1 * a1 + a2 * a2) - 1) * o.amin; if (d > o.p.br) continue; w = (1 - Math.max(0, d) / o.p.br) ** 2 * 0.9; }
        else { QA[0] = a0; QA[1] = a1; QA[2] = a2; }
        const gx = A0[0] * a0 + A1[0] * a1 + A2[0] * a2, gy = A0[1] * a0 + A1[1] * a1 + A2[1] * a2, gz = A0[2] * a0 + A1[2] * a1 + A2[2] * a2;
        const gl = w / (Math.hypot(gx, gy, gz) || 1);
        nx += gx * gl; ny += gy * gl; nz += gz * gl;
      }
      const m = p.m;
      const Pb = mtv(Wb, P3);
      const c0 = baseColor(p, Pb, QA[0], QA[1], QA[2]);
      let cr = c0[0], cg = c0[1], cb = c0[2];
      // wool / feather relief: a cheap curly bump on the normal (body space: the same on every view)
      if (m.rough) {
        const f = 1 / m.rough;
        const X = Pb[0] * f, Y = Pb[1] * f, Z = Pb[2] * f;
        const bx = Math.cos(X * 2.1 + Math.sin(Z * 1.7) * 1.3), by = Math.cos(Y * 2.3 + Math.sin(X * 1.9) * 1.2), bz = Math.cos(Z * 2.2 + Math.sin(Y * 1.6) * 1.4);
        const wb = mv(Wb, [bx, by, bz]);
        const amp = 0.42 / (Math.hypot(nx, ny, nz) || 1);
        nx = nx * amp / 0.42 + wb[0] * 0.42; ny = ny * amp / 0.42 + wb[1] * 0.42; nz = nz * amp / 0.42 + wb[2] * 0.42;
        const lum = 0.93 + 0.07 * (bx * by + bz) * 0.5;
        cr *= lum; cg *= lum; cb *= lum;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // marks (eyes, nostrils, hooves' shine…): body-space discs on the surface of their part
      for (const f of fw) {
        if (f.on && f.on !== p.id) continue;
        const dx = P3[0] - f.w[0], dy = P3[1] - f.w[1], dz = P3[2] - f.w[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > f.r * f.r) continue;
        cr = f.col[0]; cg = f.col[1]; cb = f.col[2];
        if (f.hl) {
          const hx = dx - hl[0] * f.r * 0.42, hy = dy - hl[1] * f.r * 0.42, hz = dz - hl[2] * f.r * 0.42;
          if (hx * hx + hy * hy + hz * hz < f.r * f.r * 0.16) { cr = cg = cb = 0.97; }
        }
      }
      // cel shading: half-lambert through a soft ramp, warm darks, a little sky from above, darker near the ground
      const ndl = nx * L[0] + ny * L[1] + nz * L[2];
      const k1 = smooth(0.2, 0.74, ndl * 0.5 + 0.5);
      let sh = 0.6 + 0.47 * k1 + 0.05 * nz;
      sh *= 0.84 + 0.16 * clamp01((P3[2] + 2) / 26);
      // warm darks: blue (and a little green) drop in the shade
      let r = cr * sh, g = cg * sh * (0.95 + 0.05 * k1), b2 = cb * sh * (0.84 + 0.16 * k1);
      if (m.gloss) { const sp = Math.max(0, ndl) ** 12 * m.gloss; r += sp; g += sp; b2 += sp; }
      px[i * 4] = Math.min(255, r * 255); px[i * 4 + 1] = Math.min(255, g * 255); px[i * 4 + 2] = Math.min(255, b2 * 255); px[i * 4 + 3] = 255;
    }
  }
  // inner lines where a part passes in front of another (depth jump)
  const TH = opt.th ?? 5.5, K = 2;
  const ink = [24, 18, 13], OFFS = [K, -K, K * cw, -K * cw];
  for (let v = K; v < ch - K; v++) for (let u = K; u < cw - K; u++) {
    const i = v * cw + u;
    if (I[i] < 0 || !Q[I[i]].p.edge) continue;
    const d = D[i], gi = Q[I[i]].p.g;
    let hit = false;
    // (parts of one group blend into each other: no line between them)
    for (const o of OFFS) { const j = i + o; if (I[j] >= 0 && D[j] - d > TH && Q[I[j]].p.edge && Q[I[j]].p.g !== gi) { hit = true; break; } }
    if (!hit) continue;
    const o = i * 4;
    px[o] = px[o] * 0.22 + ink[0] * 0.78; px[o + 1] = px[o + 1] * 0.22 + ink[1] * 0.78; px[o + 2] = px[o + 2] * 0.22 + ink[2] * 0.78;
  }
  lg.putImageData(img, 0, 0);
}

// material colour at a body-space point (fur noise, belly, the part's own texture); a0..a2 = the point in the part's
// unit-sphere coordinates (a2 < 0: its underside)
const TMP = [0, 0, 0];
function baseColor(p, Pb, a0, a1, a2) {
  const m = p.m;
  let c = m.col;
  if (m.tex) { const t = m.tex(Pb, p, a0, a1, a2); if (t) c = t; }
  if (m.belly && a2 < -0.25) c = mixv(c, m.belly, smooth(-0.25, -0.7, a2));
  if (m.fur) {
    const k = 1 + (vnoise(Pb[0] / 2.2, Pb[1] / 2.2, Pb[2] / 3.4) - 0.5) * m.fur;
    TMP[0] = c[0] * k; TMP[1] = c[1] * k; TMP[2] = c[2] * k;
    return TMP;
  }
  return c;
}

// ---------- species ----------
// opts: { baby, frame: 'stand' | 'w0'..'w3', graze }
// leg poses: [upper swing (rad, + = forward), lower extra bend (rad), lift px]
const GAIT = {
  stand: { A: [0, 0, 0], B: [0, 0, 0] },
  w0: { A: [0.34, -0.05, 0], B: [-0.3, 0.1, 0] },
  w1: { A: [0.02, 0, 0], B: [0.12, 0.85, 4] },
  w2: { A: [-0.3, 0.1, 0], B: [0.34, -0.05, 0] },
  w3: { A: [0.12, 0.85, 4], B: [0.02, 0, 0] },
};
// a leg from its hip (x, y, z) to the ground: upper + lower segments and a hoof / foot; front legs bend back at the knee
function leg(out, hip, lenU, lenL, rU, rL, swing, bend, lift, mats, front, hoof) {
  const s = swing, b = bend * (front ? -1 : 1);
  const knee = [hip[0] + Math.sin(s) * lenU, hip[1], hip[2] - Math.cos(s) * lenU];
  const s2 = s + b;
  let foot = [knee[0] + Math.sin(s2) * lenL, hip[1], knee[2] - Math.cos(s2) * lenL];
  // planted feet touch the ground: shift the whole leg up / down a little (it is drawn from the hip)
  const drop = lift ? 0 : foot[2] - hoof.h;
  if (!lift) { knee[2] -= drop; foot[2] -= drop; }
  else { knee[2] += lift * 0.4; foot[2] += lift; }
  out.push(seg(hip, knee, rU, mats.u, { g: 'leg' + (front ? 'f' : 'h') + (hip[1] > 0 ? 'l' : 'r') }));
  out.push(seg(knee, foot, rL, mats.l, { g: 'leg' + (front ? 'f' : 'h') + (hip[1] > 0 ? 'l' : 'r') }));
  out.push(E([foot[0] + hoof.fx, foot[1], foot[2] - hoof.h * 0.2], [hoof.rx, hoof.ry, hoof.h], mats.h, { g: 'hoof', br: 0.5 }));
  return foot;
}
// four legs, trot pairs A = (front left, hind right), B = (front right, hind left); D.front / D.hind = { x, y, z, ru, rl, k }
// (k: share of the leg's length in the upper segment)
function legs4(out, D, frame) {
  const G = GAIT[frame] || GAIT.stand;
  for (const [front, side] of [[1, 1], [1, -1], [0, 1], [0, -1]]) {
    const pair = (front && side > 0) || (!front && side < 0) ? G.A : G.B;
    const L0 = front ? D.front : D.hind;
    const Lt = L0.z - D.hoof.h, ku = L0.k ?? 0.48;
    leg(out, [L0.x, side * L0.y, L0.z], Lt * ku, Lt * (1 - ku), L0.ru, L0.rl, pair[0] * (front ? 1 : 0.9), pair[1], pair[2], D.mats, !!front, D.hoof);
  }
}

// ---- cow (Holstein black & white; drawn tinted for the brown variant) ----
function cowModel({ baby, frame, graze }) {
  const k = baby ? 0.86 : 1;
  const white = col3('#f2ede4'), black = col3('#2a2522'), pink = col3('#e7a9a0'), horn = col3('#e9dcc0');
  const patch = (Pb) => (fbm3(Pb[0] / 15 + 3.1, Pb[1] / 13 + 1.7, Pb[2] / 14 + 0.4) > 0.55 ? black : null);
  const coat = { col: white, fur: 0.07, belly: col3('#fbf6ee'), tex: patch };
  const head = { col: white, fur: 0.05, tex: (Pb) => (Math.abs(Pb[1]) > 3.5 && fbm3(Pb[0] / 7, Math.abs(Pb[1]) / 7, Pb[2] / 7) > 0.48 ? black : null) };
  const P = [];
  const H = baby ? 34 : 40; // body centre height
  P.push(E([0, 0, H], [33 * k, 16 * k, 14 * k], coat));
  P.push(E([-21 * k, 0, H + 2], [15 * k, 16 * k, 15 * k], coat));
  P.push(E([19 * k, 0, H + 1], [16 * k, 15 * k, 16 * k], coat));
  P.push(E([1, 0, H - 7], [26 * k, 14 * k, 10 * k], coat));
  if (!baby) P.push(E([-15, 0, H - 17], [8, 7, 5.5], { col: pink, gloss: 0.15 }, { g: 'udder', br: 1.5 })); // udder
  // neck + head (graze: down to the grass)
  const hs = baby ? 1.25 : 1;
  const nb = [27 * k, 0, H + 5], nt = graze ? [43 * k, 0, 14] : [41 * k, 0, H + 11];
  P.push(seg(nb, nt, 11 * k, coat));
  const hp = graze ? -1.25 : -0.45;
  const hc = graze ? [48 * k, 0, 10 * hs] : [50 * k, 0, H + 12];
  const HA = axesPYR(hp);
  P.push(E(hc, [12.5 * hs, 8.5 * hs, 9.5 * hs], head, { R: HA, g: 'head', id: 'head' }));
  const mz = add3(hc, mv(HA, [10 * hs, 0, -2 * hs]));
  P.push(E(mz, [6.5 * hs, 7.6 * hs, 6.4 * hs], { col: pink, fur: 0.03, gloss: 0.2 }, { R: HA, g: 'head', id: 'muzzle' }));
  // ears (sideways, flat) and short horns
  for (const s of [1, -1]) {
    const eb = add3(hc, mv(HA, [-3 * hs, s * 8 * hs, 5 * hs]));
    P.push(E(add3(eb, [0, s * 4 * hs, 0]), [5.5 * hs, 3.4 * hs, 1.8 * hs], { col: white, fur: 0.05 }, { R: axesPYR(hp * 0.3, 0, s * 0.5), g: 'ear', br: 1 }));
    if (!baby) {
      const h0 = add3(hc, mv(HA, [-5, s * 5, 8])), h1 = add3(h0, mv(HA, [1, s * 4, 4]));
      P.push(seg(h0, h1, 1.7, { col: horn, gloss: 0.25 }, { g: 'horn', br: 0.5 }));
    }
  }
  // tail with a dark tuft
  const t0 = [-35 * k, 0, H + 10], t1 = graze ? [-40 * k, -2, H - 14] : [-39 * k, 0, H - 18];
  P.push(seg(t0, t1, 1.6, coat, { g: 'tail', br: 1 }));
  P.push(E(add3(t1, [0, 0, -2]), [2.4, 2.4, 4], { col: black, fur: 0.1 }, { g: 'tail', br: 1 }));
  legs4(P, {
    front: { x: 21 * k, y: 9 * k, z: H - 6, ru: 5.6 * k, rl: 3.8 * k },
    hind: { x: -22 * k, y: 9 * k, z: H - 4, ru: 6.6 * k, rl: 3.9 * k, k: 0.5 },
    mats: { u: coat, l: { col: white, fur: 0.05 }, h: { col: col3('#3a302a'), gloss: 0.3 } },
    hoof: { rx: 4 * k, ry: 3.6 * k, h: 2.6, fx: 0.8 },
  }, frame);
  const F = [];
  const ey = add3(hc, mv(HA, [2.5 * hs, 7.6 * hs, 3 * hs]));
  for (const s of [1, -1]) F.push({ c: [ey[0], s * Math.abs(ey[1]), ey[2]], r: (baby ? 2.6 : 2.2), col: col3('#1a1410'), hl: true, on: 'head' });
  for (const s of [1, -1]) { const n = add3(mz, mv(HA, [6 * hs, s * 2.6 * hs, 0.5])); F.push({ c: n, r: 1.3 * hs, col: col3('#8a4a48'), on: 'muzzle' }); }
  return [P, F];
}

// ---- sheep (cream wool, dark face; the young: less wool, bigger head) ----
function sheepModel({ baby, frame, graze }) {
  const k = baby ? 0.82 : 1;
  const woolC = col3('#ece3cf'), face = col3('#3b302b'), dark = col3('#2b231f');
  const wool = { col: woolC, rough: 3.2, fur: 0.1 };
  const P = [];
  const H = baby ? 27 : 33;
  P.push(E([0, 0, H], [26 * k, 16 * k, 14.5 * k], wool, { g: 'wool', br: 4 }));
  // puffs over the back and sides (bumpy silhouette)
  const n = baby ? 22 : 34;
  for (let i = 0; i < n; i++) {
    const z = 1 - (i + 0.5) / n * 1.45; // top hemisphere and a bit below
    const r = Math.sqrt(Math.max(0, 1 - z * z)), a = i * 2.39996;
    const c = [Math.cos(a) * r * 24 * k, Math.sin(a) * r * 14.5 * k, H + z * 12.5 * k];
    P.push(E(c, [6.2 * k, 5.8 * k, 5.6 * k], wool, { g: 'wool', br: 4, edge: false }));
  }
  const hs = baby ? 1.3 : 1;
  const hp = graze ? -1.2 : -0.55;
  const hc = graze ? [33 * k, 0, 9 * hs] : [31 * k, 0, H + 8];
  const HA = axesPYR(hp);
  P.push(E(add3(hc, mv(HA, [-4 * hs, 0, 0])), [7.5 * hs, 7 * hs, 7.5 * hs], wool, { g: 'wool', br: 3 })); // wool cap / neck
  P.push(E(hc, [9.5 * hs, 6.2 * hs, 6.8 * hs], { col: baby ? col3('#4a3c35') : face, fur: 0.06 }, { R: HA, g: 'head', id: 'head' }));
  for (const s of [1, -1]) {
    const eb = add3(hc, mv(HA, [-2 * hs, s * 6.5 * hs, 2.5 * hs]));
    P.push(E(add3(eb, [0, s * 3.2 * hs, -1]), [4.6 * hs, 2.8 * hs, 1.5 * hs], { col: face, fur: 0.05 }, { R: axesPYR(-0.2, 0, s * 0.35), g: 'ear', br: 1 }));
  }
  P.push(E([-25 * k, 0, H + 4], [5, 5, 5.5], wool, { g: 'wool', br: 3 })); // tail puff
  legs4(P, {
    front: { x: 16 * k, y: 8 * k, z: H - 8, ru: 3.2 * k, rl: 2.6 * k },
    hind: { x: -16 * k, y: 8 * k, z: H - 7, ru: 3.6 * k, rl: 2.6 * k, k: 0.5 },
    mats: { u: { col: dark, fur: 0.05 }, l: { col: dark, fur: 0.05 }, h: { col: col3('#1c1714'), gloss: 0.2 } },
    hoof: { rx: 2.8 * k, ry: 2.4 * k, h: 2, fx: 0.5 },
  }, frame);
  const F = [];
  const ey = add3(hc, mv(HA, [2 * hs, 5.4 * hs, 2.2 * hs]));
  for (const s of [1, -1]) F.push({ c: [ey[0], s * Math.abs(ey[1]), ey[2]], r: 1.7 * hs, col: col3('#e8d8b8'), on: 'head' }); // pale eye ring
  for (const s of [1, -1]) F.push({ c: [ey[0] + 0.3, s * (Math.abs(ey[1]) + 0.25), ey[2]], r: 1.05 * hs, col: col3('#120e0c'), hl: true, on: 'head' });
  return [P, F];
}

// ---- pig (pink, round, floppy ears, snout disc, curly tail) ----
function pigModel({ baby, frame, graze }) {
  const k = baby ? 0.8 : 1;
  const pinkC = col3('#eaa99c'), pinkD = col3('#d98a80'), snout = col3('#e48f88');
  const skin = { col: pinkC, fur: 0.05, belly: col3('#f2c0b4'), gloss: 0.08 };
  const P = [];
  const H = baby ? 19 : 23;
  P.push(E([0, 0, H], [29 * k, 16.5 * k, 15.5 * k], skin));
  P.push(E([-15 * k, 0, H + 1], [15 * k, 16 * k, 15 * k], skin));
  P.push(E([15 * k, 0, H + 1], [14 * k, 15 * k, 15 * k], skin));
  const hs = baby ? 1.25 : 1;
  const hp = graze ? -0.9 : -0.15;
  const hc = graze ? [33 * k, 0, 10 * hs] : [31 * k, 0, H + 3];
  const HA = axesPYR(hp);
  P.push(E(hc, [12 * hs, 11 * hs, 11 * hs], skin, { R: HA, g: 'head', br: 3, id: 'head' }));
  const sc = add3(hc, mv(HA, [11.5 * hs, 0, -2.4 * hs]));
  P.push(E(sc, [4.5 * hs, 5.6 * hs, 4.8 * hs], { col: snout, gloss: 0.18 }, { R: HA, g: 'snout', br: 1.2, id: 'snout' }));
  for (const s of [1, -1]) {
    const eb = add3(hc, mv(HA, [2 * hs, s * 6.5 * hs, 8.5 * hs]));
    P.push(E(add3(eb, mv(HA, [3.5 * hs, s * 1.5, -1])), [5.6 * hs, 4.2 * hs, 1.5 * hs], { col: pinkD, fur: 0.04 }, { R: axesPYR(hp - 0.65, s * 0.35, s * 0.3), g: 'ear', br: 1 }));
  }
  // curly tail: a little spiral of beads
  for (let i = 0; i < 6; i++) {
    const a = i * 1.15;
    P.push(E([-29 * k - 2 - Math.cos(a) * 2, Math.sin(a) * 2.4, H + 7 + i * 0.6], [1.5, 1.5, 1.5], { col: pinkD }, { g: 'tail', br: 1.2, edge: false }));
  }
  legs4(P, {
    front: { x: 17 * k, y: 9 * k, z: H - 7, ru: 4.6 * k, rl: 3.6 * k },
    hind: { x: -18 * k, y: 9 * k, z: H - 6, ru: 5.2 * k, rl: 3.7 * k, k: 0.5 },
    mats: { u: skin, l: { col: pinkC, fur: 0.04 }, h: { col: col3('#7a4f46'), gloss: 0.25 } },
    hoof: { rx: 3.2 * k, ry: 3 * k, h: 2, fx: 0.6 },
  }, frame);
  const F = [];
  const ey = add3(hc, mv(HA, [6 * hs, 7.2 * hs, 3.2 * hs]));
  for (const s of [1, -1]) F.push({ c: [ey[0], s * Math.abs(ey[1]), ey[2]], r: 1.35 * hs, col: col3('#1a1210'), hl: true, on: 'head' });
  for (const s of [1, -1]) F.push({ c: add3(sc, mv(HA, [4.3 * hs, s * 1.8 * hs, 0])), r: 1.1 * hs, col: col3('#8e4f4c'), on: 'snout' });
  return [P, F];
}

// ---- chicken (white hen, red comb; the young: a yellow chick) ----
function chickenModel({ baby, frame, graze }) {
  const P = [], F = [];
  const yel = col3('#e8b84a'), red = col3('#d23a2e');
  // legs: thin, two of them (biped: left / right alternate)
  const G = GAIT[frame] || GAIT.stand;
  const legM = { col: yel, gloss: 0.2 };
  const footY = [[3, G.A], [-3, G.B]];
  if (baby) {
    const fluff = { col: col3('#f6dc6c'), rough: 2.2, fur: 0.08 };
    P.push(E([0, 0, 8.5], [8, 7, 7.2], fluff, { g: 'body', br: 3 }));
    const hc = graze ? [7, 0, 6] : [5.5, 0, 15];
    P.push(E(hc, [5.4, 5, 5.2], fluff, { g: 'body', br: 3, id: 'head' }));
    P.push(E(add3(hc, [5.2, 0, -0.8]), [2.2, 1.4, 1.1], { col: col3('#e88a2a'), gloss: 0.3 }, { g: 'beak', br: 0.5 }));
    for (const [y, g] of footY) {
      const sw = g[0] * 1.6, lf = g[2] * 0.5;
      P.push(seg([0, y * 0.8, 4], [Math.sin(sw) * 3, y * 0.8, lf], 0.9, legM, { g: 'leg', br: 0.5 }));
      P.push(E([Math.sin(sw) * 3 + 1.5, y * 0.8, lf + 0.4], [2.2, 1.6, 0.6], legM, { g: 'foot', br: 0.3 }));
    }
    for (const s of [1, -1]) F.push({ c: add3(hc, [2.6, s * 4.1, 1.3]), r: 1.1, col: col3('#16100c'), hl: true, on: 'head' });
    return [P, F];
  }
  const white = col3('#f3eee4'), wing = col3('#e6dfd0');
  const feathers = { col: white, fur: 0.08, rough: 2.6 };
  const bob = frame === 'w0' || frame === 'w2' ? 1.2 : 0;
  P.push(E([0, 0, 16], [11.5, 8.2, 9], feathers, { R: axesPYR(0.25), g: 'body', br: 3 }));
  P.push(E([5, 0, 14.5], [8, 7.4, 8], feathers, { g: 'body', br: 3 }));
  // tail fan (up and back)
  for (const [y, rz] of [[0, 0], [2.6, 0.35], [-2.6, -0.35]]) P.push(E([-10, y, 24], [2.4, 1.6, 8], { col: wing, fur: 0.06 }, { R: axesPYR(0.55, rz), g: 'tail', br: 1.5 }));
  for (const s of [1, -1]) P.push(E([-1, s * 7.6, 16.5], [9, 1.7, 5.2], { col: wing, fur: 0.06 }, { R: axesPYR(0.2), g: 'wing', br: 1 }));
  const hc = graze ? [12, 0, 7] : [9 + bob, 0, 28];
  P.push(seg([6, 0, 20], add3(hc, [-2, 0, -2]), 3.8, feathers, { g: 'body', br: 3 }));
  P.push(E(hc, [4.8, 4.2, 4.8], feathers, { g: 'body', br: 2.5, id: 'head' }));
  const bk = add3(hc, graze ? [3.4, 0, -3.6] : [5.2, 0, -0.6]);
  P.push(E(bk, [2.8, 1.4, 1.2], { col: col3('#e8a83a'), gloss: 0.3 }, { R: axesPYR(graze ? -0.9 : -0.2), g: 'beak', br: 0.4 }));
  for (let i = 0; i < 3; i++) P.push(E(add3(hc, graze ? [1 + i * 1.5, 0, 4.5 - i * 0.5] : [-1.6 + i * 1.9, 0, 4.8 - Math.abs(i - 1) * 0.4]), [1.6, 0.9, 1.8], { col: red, gloss: 0.15 }, { g: 'comb', br: 0.6 }));
  P.push(E(add3(hc, graze ? [3.2, 0, -4.6] : [3.6, 0, -4.2]), [1.1, 0.9, 2], { col: red, gloss: 0.15 }, { g: 'comb', br: 0.6 }));
  for (const [y, g] of footY) {
    const sw = g[0] * 1.3, lf = g[2] * 0.6;
    const knee = [1 + Math.sin(sw) * 2, y, 8];
    const foot = [1 + Math.sin(sw) * 4.6, y, 1 + lf];
    P.push(seg([0, y, 11], knee, 1.6, { col: white, fur: 0.06 }, { g: 'thigh', br: 1 }));
    P.push(seg(knee, foot, 0.95, legM, { g: 'leg', br: 0.3 }));
    P.push(E(add3(foot, [2, 0, -0.4]), [3.6, 2.4, 0.6], legM, { g: 'foot', br: 0.3 }));
  }
  for (const s of [1, -1]) F.push({ c: add3(hc, [2.3, s * 3.6, 1]), r: 1.05, col: col3('#2a1508'), hl: true, on: 'head' });
  return [P, F];
}

// ---- fish (river trout-ish: dark olive back, silver belly, spots) ----
function fishModel({ frame }) {
  const P = [];
  const sw = frame === 1 ? 0.45 : frame === 2 ? -0.45 : 0;
  const back = col3('#4c6a58'), belly = col3('#dfe4d6');
  const skin = { col: back, belly, gloss: 0.35, tex: (Pb, p, a0, a1, a2) => (a2 > -0.1 && fbm3(Pb[0] / 2.2, Pb[1] / 2.2, Pb[2] / 2.2) > 0.7 ? col3('#26352c') : a2 < 0.15 && a2 > -0.35 ? col3('#b98f8a') : null) };
  P.push(E([0, 0, 8], [15, 4.4, 5.6], skin, { g: 'body', br: 2 }));
  P.push(E([-9, 0, 8.2], [8, 3, 4], skin, { R: axesPYR(0, sw * 0.5), g: 'body', br: 2 }));
  const tc = [-17 - Math.cos(sw) * 2, -Math.sin(sw) * 5, 8.4];
  P.push(E(tc, [4.6, 0.8, 5.6], { col: col3('#3d5648'), gloss: 0.2 }, { R: axesPYR(0, sw), g: 'fin', br: 0.5 }));
  P.push(E([-1, 0, 13.8], [5, 0.8, 2.4], { col: col3('#3d5648') }, { R: axesPYR(-0.25), g: 'fin', br: 0.5 }));
  for (const s of [1, -1]) P.push(E([5, s * 4, 5.5], [3, 0.6, 1.6], { col: col3('#c8b6a0') }, { R: axesPYR(-0.4, s * 0.5), g: 'fin', br: 0.3 }));
  const F = [];
  for (const s of [1, -1]) F.push({ c: [11, s * 3.2, 9.2], r: 1.2, col: col3('#141210'), hl: true });
  return [P, F];
}

// ---------- sprite making ----------
// a view's yaw (body forward in world, y south): e 0, se 45°, s 90°, ne −45°, n −90°
const YAW = { e: 0, se: Math.PI / 4, s: Math.PI / 2, ne: -Math.PI / 4, n: -Math.PI / 2 };
// screen bounds of the model at a yaw → nominal sprite box with the anchor (the body's ground point) inside
function bounds(parts, yaw, phi) {
  setCam(phi);
  const Wb = bodyToWorld(yaw);
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const p of parts) {
    const q = prep(p, Wb);
    x0 = Math.min(x0, q.sx - q.ex); x1 = Math.max(x1, q.sx + q.ex); y0 = Math.min(y0, q.sy - q.ey); y1 = Math.max(y1, q.sy + q.ey);
  }
  return [x0, x1, y0, y1];
}
function modelSprite(model, yaw, phi = PHI) {
  const [parts, feats] = model;
  const [x0, x1, y0, y1] = bounds(parts, yaw, phi);
  const hw = Math.ceil(Math.max(-x0, x1)) + 6, top = Math.ceil(-y0) + 6, bot = Math.ceil(Math.max(0, y1)) + 6;
  const W = hw * 2, H = top + bot;
  const c = spritePx(W, H, (g, P) => P.layer((lg) => render(lg, P, parts, feats, yaw, hw, top, { phi }), 2.5, OUTL));
  return [c, top / H];
}

const MODELS = { cow: cowModel, sheep: sheepModel, pig: pigModel, chicken: chickenModel };

export function addLivestock(add) {
  for (const sp in MODELS) {
    const M = MODELS[sp];
    for (const baby of [false, true]) {
      const base = sp + (baby ? '_baby' : '');
      for (const v of ['e', 'se', 's', 'ne', 'n']) {
        const name = base + '_' + v;
        const [c, ay] = modelSprite(M({ baby, frame: 'stand' }), YAW[v]);
        add(name, c, 0.5, ay);
        const frames = baby || v === 's' || v === 'n' ? ['w0', 'w2'] : ['w0', 'w1', 'w2', 'w3'];
        for (const f of frames) { const [cw, ayw] = modelSprite(M({ baby, frame: f }), YAW[v]); add(name + '_' + f, cw, 0.5, ayw); }
        if (!baby && (v === 'e' || v === 'se' || v === 'ne')) { const [cg, ayg] = modelSprite(M({ baby, frame: 'stand', graze: true }), YAW[v]); add(name + '_graze', cg, 0.5, ayg); }
      }
    }
  }
  // fish: from above while swimming (3 tail frames), side / front / back for a jump
  for (let f = 0; f < 3; f++) { const [c] = modelSprite(fishModel({ frame: f }), 0, Math.PI / 2 - 0.001); add(f ? 'fish_top_' + f : 'fish_top', c, 0.5, 0.5); }
  for (const v of ['e', 's', 'n']) { const [c, ay] = modelSprite(fishModel({ frame: 0 }), YAW[v]); add('fish_' + v, c, 0.5, ay); }
  addFarmArt(add);
}

// ======================================================================================================================
// Farm art painted by hand (canvas): the feeder, wheat, item icons, the rod, the rope and the bobber
// ======================================================================================================================
const A = (c, a) => rgb(hex(c), a);
const WOOD = '#9a6a3c', WOOD_D = '#5e3e22', WOOD_L = '#c8945a';

// ---- feeder (2×1 trough on short legs) ----
// Painted for the solid kit's projective texturing (faces/solidFarm.js): a point (x px from the centre column, ground
// row v in tiles, height h px) shows at column 64 + x (side art: 32 + x), row E + 64v − h. Front art (128 px wide): the
// trough body x ±FX, v FV0..FV1, h FH0..FH1 (its top face = the opening seen from above: rims, inside, feed), legs
// under it at x ±FLX. Side art (`_e`, the piece turned: 64 px wide, its 2-tile length along v SV0..SV1).
export const FEED_GEOM = { E: 12, FX: 56, FV0: 0.36, FV1: 0.84, FH0: 8, FH1: 26, FLX: 50, FLW: 5, SV0: 0.125, SV1: 1.875 };
const FG = FEED_GEOM;
function plankH(g, x0, y0, x1, y1, rand, col = WOOD) {
  g.fillStyle = col; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = A(WOOD_D, 0.32);
  for (let x = x0 + 3 + rand() * 4; x < x1 - 2; x += 6 + rand() * 7) g.fillRect(x, y0 + 0.5, 0.8, y1 - y0 - 1);
  g.fillStyle = A(WOOD_L, 0.5); g.fillRect(x0, y0, x1 - x0, 1.1);
  g.fillStyle = A(WOOD_D, 0.55); g.fillRect(x0, y1 - 1.1, x1 - x0, 1.1);
}
// the opening seen from above inside rect (x0, y0)-(x1, y1): rims (r px), dark inside, the feed heap or a few grains
function troughTop(g, x0, y0, x1, y1, r, full, rand) {
  g.fillStyle = WOOD_L; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = A(WOOD_D, 0.35); g.fillRect(x0, y1 - 1, x1 - x0, 1);
  const ix0 = x0 + r, iy0 = y0 + r * 0.8, ix1 = x1 - r, iy1 = y1 - r * 0.8;
  g.fillStyle = lin(g, 0, iy0, 0, iy1, [[0, '#3e2a18'], [0.45, '#5a3c22'], [1, '#6e4a2a']]); g.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(ix0, iy0, ix1 - ix0, 1.6);
  if (full) {
    for (let i = 0; i < (ix1 - ix0) * (iy1 - iy0) * 0.35; i++) {
      const x = ix0 + 1 + rand() * (ix1 - ix0 - 2), y = iy0 + 1 + rand() * (iy1 - iy0 - 2);
      const mid = 1 - Math.abs((x - (ix0 + ix1) / 2) / ((ix1 - ix0) / 2));
      g.fillStyle = rand() < 0.4 ? '#e8c76c' : rand() < 0.5 ? '#d2a84a' : mid > 0.5 ? '#f2d88a' : '#c0943e';
      g.beginPath(); g.ellipse(x, y, 1.3 + rand(), 0.8 + rand() * 0.5, (rand() - 0.5) * 1.4, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(200,160,70,0.85)'; g.lineWidth = 0.7;
    for (let i = 0; i < (ix1 - ix0) / 4; i++) { const x = ix0 + 2 + rand() * (ix1 - ix0 - 4), y = iy0 + 2 + rand() * (iy1 - iy0 - 4); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 7, y + (rand() - 0.5) * 3); g.stroke(); }
  } else {
    for (let i = 0; i < 7; i++) { g.fillStyle = '#c8a050'; g.beginPath(); g.ellipse(ix0 + 2 + rand() * (ix1 - ix0 - 4), iy1 - 2 - rand() * 3, 1.4, 0.8, rand(), 0, TAU); g.fill(); }
  }
}
function feederFront(full) {
  const rand = rng(8101 + (full ? 7 : 0));
  const W = 128, cx = 64;
  return spritePx(W, 64 + FG.E, (g, P) => {
    const Y = (v, h = 0) => FG.E + v * 64 - h;
    P.layer((g) => { // legs (front pair; the back pair is hidden by the trough)
      for (const x of [-FG.FLX - FG.FLW / 2, FG.FLX - FG.FLW / 2]) { g.fillStyle = WOOD_D; g.fillRect(cx + x, Y(FG.FV1, FG.FH0) - 1, FG.FLW, FG.FH0 + 1); g.fillStyle = A(WOOD_L, 0.4); g.fillRect(cx + x, Y(FG.FV1, FG.FH0), 1.2, FG.FH0); }
    }, 2, OUTL);
    P.layer((g) => {
      troughTop(g, cx - FG.FX, Y(FG.FV0, FG.FH1), cx + FG.FX, Y(FG.FV1, FG.FH1), 4, full, rand);
      const y0 = Y(FG.FV1, FG.FH1), y1 = Y(FG.FV1, FG.FH0), ym = (y0 + y1) / 2;
      plankH(g, cx - FG.FX, y0, cx + FG.FX, ym, rand);
      plankH(g, cx - FG.FX, ym, cx + FG.FX, y1, rand, mixc(WOOD, WOOD_D, 0.18));
      g.fillStyle = 'rgba(58,54,50,0.88)'; for (const x of [-32, 29]) g.fillRect(cx + x, y0, 3, y1 - y0); // iron bands
      g.fillStyle = 'rgba(210,206,196,0.55)'; for (const x of [-32, 29]) g.fillRect(cx + x, y0 + 1, 1, y1 - y0 - 2);
      g.fillStyle = A(WOOD_D, 0.6); g.fillRect(cx - FG.FX, y0, 3, y1 - y0); g.fillRect(cx + FG.FX - 3, y0, 3, y1 - y0); // end boards' edges
    }, 2.4, OUTL);
  });
}
function feederSide(full) {
  const rand = rng(8202 + (full ? 3 : 0));
  const cx = 32, hx = (64 * (FG.FV1 - FG.FV0)) / 2; // the trough's depth across this view
  return spritePx(64, 128 + FG.E, (g, P) => {
    const Y = (v, h = 0) => FG.E + v * 64 - h;
    const vl = FG.SV1 - (FG.FX - FG.FLX) / 64; // the near legs' row
    P.layer((g) => { for (const x of [-hx + 2, hx - 2 - FG.FLW]) { g.fillStyle = WOOD_D; g.fillRect(cx + x, Y(vl, FG.FH0) - 1, FG.FLW, FG.FH0 + 1); } }, 2, OUTL);
    P.layer((g) => {
      troughTop(g, cx - hx, Y(FG.SV0, FG.FH1), cx + hx, Y(FG.SV1, FG.FH1), 3.5, full, rand);
      const y0 = Y(FG.SV1, FG.FH1), y1 = Y(FG.SV1, FG.FH0);
      plankH(g, cx - hx, y0, cx + hx, y1, rand, mixc(WOOD, WOOD_D, 0.1));
      g.fillStyle = A(WOOD_D, 0.6); g.fillRect(cx - hx, y0, 2.5, y1 - y0); g.fillRect(cx + hx - 2.5, y0, 2.5, y1 - y0);
    }, 2.4, OUTL);
  });
}

// ---- wheat (crop stages + the wild plant by the rivers) ----
function wheatStalk(g, x, y, st, rand, k = 1) {
  const H = [6, 18, 30, 34][st] * k;
  const lean = (rand() - 0.5) * 4;
  const stem = st === 3 ? '#c9a84e' : st === 2 ? '#9aac4a' : '#6f9a3a';
  g.strokeStyle = stem; g.lineWidth = 1.3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.3, y - H * 0.6, x + lean, y - H); g.stroke();
  // blades
  g.fillStyle = st === 3 ? '#c8a64e' : '#6f9a3a';
  for (let i = 0; i < 2; i++) { const s = i ? 1 : -1, t = 0.3 + i * 0.2; g.beginPath(); leaf(g, x + lean * t * 0.3, y - H * t, x + s * 6 * k + lean * t, y - H * t - 4 * k, 1.6 * k, s * 0.8); g.fill(); }
  if (st >= 2) {
    // the ear: a column of grains, awns
    const ex = x + lean, ey = y - H;
    const gc = st === 3 ? ['#e8c35a', '#d4a640', '#f2d27a'] : ['#a8bc5a', '#94aa48', '#b8c86a'];
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) { g.fillStyle = gc[(i + (s > 0 ? 1 : 0)) % 3]; g.beginPath(); g.ellipse(ex + s * 1.3 * k, ey + 1 - i * 1.9 * k, 1.3 * k, 1.9 * k, s * 0.35, 0, TAU); g.fill(); }
    }
    g.strokeStyle = st === 3 ? 'rgba(240,214,140,0.85)' : 'rgba(190,210,120,0.7)'; g.lineWidth = 0.55;
    g.beginPath(); for (let i = 0; i < 6; i++) { const yy = ey - i * 1.9 * k; for (const s of [-1, 1]) { g.moveTo(ex + s * 1.6 * k, yy); g.lineTo(ex + s * 4.5 * k, yy - 5 * k); } } g.stroke();
  }
}
function wheatTuft(g, x, y, st, rand, k = 1) {
  const n = [3, 5, 6, 7][st];
  for (let i = 0; i < n; i++) wheatStalk(g, x + (i / (n - 1) - 0.5) * 9 * k + (rand() - 0.5) * 2, y + (rand() - 0.5) * 2, st, rand, k * (0.85 + rand() * 0.3));
}
const CROP_E = 58;
function wheatCrop(st) {
  const rand = rng(6400 + st * 37);
  return spritePx(64, 64 + CROP_E, (g, P) => {
    const Y = (v) => CROP_E + v * 64;
    const pts = [[0.26, 0.36], [0.72, 0.38], [0.3, 0.86], [0.74, 0.88]];
    for (const [u, v] of pts) { g.fillStyle = 'rgba(36,24,14,0.5)'; g.beginPath(); g.ellipse(u * 64, Y(v) + 1, 9, 2.6, 0, 0, TAU); g.fill(); }
    for (const row of [[pts[0], pts[1]], [pts[2], pts[3]]]) {
      P.layer((g) => { for (const [u, v] of row) wheatTuft(g, u * 64 + (rand() - 0.5) * 3, Y(v), st, rand, st === 0 ? 0.8 : 1); }, st === 0 ? 1.3 : 1.6, 'rgba(26,30,12,0.72)');
    }
  });
}
function wildWheat() {
  const rand = rng(9450);
  return spritePx(60, 64, (g, P) => {
    const cx = 30, y = 58;
    g.fillStyle = 'rgba(36,24,14,0.4)'; g.beginPath(); g.ellipse(cx, y, 15, 3.6, 0, 0, TAU); g.fill();
    P.layer((g) => { wheatTuft(g, cx + 6, y - 2, 3, rand, 0.95); }, 1.6, 'rgba(26,30,12,0.72)');
    P.layer((g) => { wheatTuft(g, cx - 5, y, 3, rand, 1.05); }, 1.6, 'rgba(26,30,12,0.72)');
  });
}

// ---- item icons (36×36 box like art/items.js: outlined layers, anchor 0.5, 0.82) ----
function icon(layers, seed) {
  return spritePx(36, 36, (g, P) => {
    const rand = rng(seed);
    for (const fn of layers) P.layer((g) => { g.translate(18, 18); g.scale(0.9, 0.9); g.translate(-18, -18); fn(g, rand); }, 2.3);
  }, { crop: false });
}
function sack(g, col, dark) {
  g.fillStyle = col; g.beginPath(); g.moveTo(11, 14); g.quadraticCurveTo(8, 30, 18, 31); g.quadraticCurveTo(28, 30, 25, 14); g.quadraticCurveTo(18, 11, 11, 14); g.fill();
  g.fillStyle = A(dark, 0.5); g.beginPath(); g.ellipse(18, 14, 7, 2.2, 0, 0, TAU); g.fill();
  g.strokeStyle = dark; g.lineWidth = 1.2; g.beginPath(); g.moveTo(12, 16); g.quadraticCurveTo(18, 18, 24, 16); g.stroke();
}
function sheaf(g, rand) {
  for (let i = 0; i < 5; i++) {
    const a = -0.55 + i * 0.27, x0 = 18, y0 = 31;
    const x1 = x0 + Math.sin(a) * 16, y1 = y0 - Math.cos(a) * 18;
    g.strokeStyle = '#c9a84e'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    for (let j = 0; j < 4; j++) for (const s of [-1, 1]) {
      g.fillStyle = (j + i) & 1 ? '#e8c35a' : '#d4a640';
      const t = 0.62 + j * 0.1, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      g.beginPath(); g.ellipse(x + s * 1.2, y, 1.2, 2, a + s * 0.4, 0, TAU); g.fill();
    }
  }
  g.fillStyle = '#9a6a3c'; g.fillRect(13, 24, 10, 3); // the binding
}
const ICONS = {
  item_wheat: [(g, r) => sheaf(g, r)],
  item_seed_wheat: [(g) => sack(g, '#c8b07a', '#7a6438'), (g, r) => { for (const [x, y] of [[16, 27], [20, 26], [18, 29.5], [22, 29]]) { g.fillStyle = '#e2c066'; g.beginPath(); g.ellipse(x, y, 1.3, 2, 0.4, 0, TAU); g.fill(); } }],
  item_bread: [(g) => {
    g.fillStyle = '#b8743a'; g.beginPath(); g.ellipse(18, 22, 12, 8, -0.1, 0, TAU); g.fill();
    g.fillStyle = lin(g, 0, 14, 0, 30, [[0, '#e8b064'], [1, '#a8662e']]); g.beginPath(); g.ellipse(18, 21, 11, 7, -0.1, 0, TAU); g.fill();
    g.strokeStyle = '#f6dca0'; g.lineWidth = 1.3; for (const x of [12, 17, 22]) { g.beginPath(); g.moveTo(x, 17); g.quadraticCurveTo(x + 2, 20, x + 1, 24); g.stroke(); }
    g.fillStyle = 'rgba(255,240,200,0.5)'; g.beginPath(); g.ellipse(14, 17, 4, 1.6, -0.3, 0, TAU); g.fill();
  }],
  item_fish_raw: [(g) => fishIcon(g, '#5f8070', '#dfe4d6', false)],
  item_fish_cooked: [(g) => fishIcon(g, '#a8683a', '#e8c890', true)],
  item_wool: [(g, r) => { for (let i = 0; i < 9; i++) { const a = i * 0.7, rr = i ? 6 : 0; g.fillStyle = i & 1 ? '#efe7d4' : '#e2d8c0'; g.beginPath(); circle(g, 18 + Math.cos(a) * rr, 21 + Math.sin(a) * rr * 0.7, 5.5); g.fill(); } g.fillStyle = 'rgba(255,255,250,0.6)'; g.beginPath(); circle(g, 15, 17, 2.5); g.fill(); }],
  item_feather: [(g) => {
    g.save(); g.translate(18, 19); g.rotate(-0.6);
    g.fillStyle = '#f2ede2'; g.beginPath(); g.moveTo(0, -14); g.quadraticCurveTo(7, -4, 2, 12); g.lineTo(-1, 12); g.quadraticCurveTo(-7, -4, 0, -14); g.fill();
    g.strokeStyle = '#b8ac94'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, -13); g.lineTo(0.5, 15); g.stroke();
    g.strokeStyle = 'rgba(160,150,130,0.6)'; g.lineWidth = 0.5; for (let i = -9; i < 9; i += 3) { g.beginPath(); g.moveTo(0.2, i); g.lineTo(4, i - 3); g.moveTo(0.2, i); g.lineTo(-4, i - 3); g.stroke(); }
    g.restore();
  }],
  item_rod_wood: [(g) => rodShape(g, 6, 31, 30, 5, true)],
};
function fishIcon(g, back, belly, cooked) {
  g.fillStyle = back; g.beginPath(); g.moveTo(5, 20); g.quadraticCurveTo(14, 10, 26, 17); g.lineTo(32, 12); g.lineTo(31, 27); g.lineTo(26, 22); g.quadraticCurveTo(14, 29, 5, 20); g.fill();
  g.fillStyle = belly; g.beginPath(); g.moveTo(6, 21); g.quadraticCurveTo(14, 27, 25, 21.5); g.quadraticCurveTo(14, 23, 6, 21); g.fill();
  g.fillStyle = '#141210'; g.beginPath(); circle(g, 9.5, 18.6, 1.3); g.fill();
  if (cooked) { g.strokeStyle = '#5a3418'; g.lineWidth = 1.2; for (const x of [13, 18, 23]) { g.beginPath(); g.moveTo(x, 14); g.lineTo(x - 2, 24); g.stroke(); } }
  else { g.fillStyle = 'rgba(40,52,44,0.7)'; for (const [x, y] of [[14, 16], [18, 15], [22, 17]]) { g.beginPath(); circle(g, x, y, 0.9); g.fill(); } }
}
// a rod from (x0, y0) (the grip) to (x1, y1) (the tip) with the reel, the line hanging from the tip
function rodShape(g, x0, y0, x1, y1, line) {
  g.strokeStyle = '#7a5030'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.3); g.stroke();
  g.strokeStyle = '#b8874e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.3); g.lineTo(x1, y1); g.stroke();
  g.fillStyle = '#5a5a5e'; g.beginPath(); circle(g, x0 + (x1 - x0) * 0.22 + 1.5, y0 + (y1 - y0) * 0.22 + 2, 2.2); g.fill();
  if (line) {
    g.strokeStyle = 'rgba(240,240,230,0.9)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(x1 + 1, y1 + 10, x1 - 2, y1 + 16); g.stroke();
    g.fillStyle = '#e04030'; g.beginPath(); circle(g, x1 - 2, y1 + 17, 1.8); g.fill(); g.fillStyle = '#f6f0e6'; g.beginPath(); circle(g, x1 - 2, y1 + 15.6, 1); g.fill();
  }
}
// held rod (points UP, grip at the anchor, like art/gear.js held sprites): 0.1 × 1.5 tiles
function heldRod() {
  return spritePx(12, 96, (g, P) => {
    P.layer((g) => {
      g.strokeStyle = '#6a4428'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(6, 92); g.lineTo(6, 66); g.stroke();
      g.strokeStyle = '#b8874e'; g.lineWidth = 1.7; g.beginPath(); g.moveTo(6, 68); g.quadraticCurveTo(6.5, 30, 7.5, 3); g.stroke();
      g.fillStyle = '#5a5a5e'; g.beginPath(); circle(g, 8.6, 78, 2.8); g.fill(); g.fillStyle = '#9a9aa0'; g.beginPath(); circle(g, 8.6, 78, 1.1); g.fill();
      g.fillStyle = '#d8c8a0'; for (const y of [50, 30, 12]) g.fillRect(5.6, y, 2.4, 1.2); // line guides
    }, 1.6, OUTL);
  });
}
function ropeSeg() {
  return spritePx(16, 6, (g) => {
    g.fillStyle = '#8a6a3c'; g.fillRect(0, 1.4, 16, 3.2);
    g.strokeStyle = '#c8a46a'; g.lineWidth = 0.9; for (let x = -2; x < 18; x += 3) { g.beginPath(); g.moveTo(x, 1.4); g.lineTo(x + 2.4, 4.6); g.stroke(); }
    g.fillStyle = 'rgba(40,26,12,0.45)'; g.fillRect(0, 3.8, 16, 0.8);
  }, { crop: false });
}
function bobber() {
  return spritePx(14, 18, (g, P) => {
    P.layer((g) => {
      g.fillStyle = '#e8e2d4'; g.beginPath(); g.ellipse(7, 7, 4.2, 4.6, 0, Math.PI, TAU); g.fill();
      g.fillStyle = '#d83a2a'; g.beginPath(); g.ellipse(7, 7, 4.2, 4.6, 0, 0, Math.PI); g.fill();
      g.fillStyle = '#f6f0e6'; g.fillRect(6.4, 0.5, 1.2, 3);
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); circle(g, 5.4, 4.8, 1.1); g.fill();
    }, 1.4, OUTL);
  });
}

function addFarmArt(add) {
  // anchors like every 1-row structure (the bottom of the tile row; side art: of its 2-tile row)
  add('feeder', feederFront(false), 0.5, 1);
  add('feeder_full', feederFront(true), 0.5, 1);
  add('feeder_e', feederSide(false), 0.5, 1);
  add('feeder_full_e', feederSide(true), 0.5, 1);
  for (let st = 0; st < 4; st++) add('crop_wheat_' + st, wheatCrop(st), 0.5, 1);
  const ww = wildWheat();
  add('wild_wheat_0', ww, 0.5, 1 - 6 / 64);
  let seed = 7700;
  for (const k in ICONS) add(k, icon(ICONS[k], seed++), 0.5, 0.82);
  add('held_rod_wood', heldRod(), 0.5, 0.92);
  add('fx_rope', ropeSeg(), 0.5, 0.5);
  add('fx_bobber', bobber(), 0.5, 0.62);
}
