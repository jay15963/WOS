// Path materials (agent M): procedural tileable textures for the painted terrain paths (src/game/content/paths.js).
// 512² RGBA per layer covering 4×4 tiles (same scale as the ground bank in terrainTex.js, 128 px per tile):
//   0 packed earth · 1 gravel · 2 flagstones (lajota) · 3 cobble setts (paralelepípedo) · 4 stepping stones
// RGB = albedo WITHOUT baked directional light (the terrain shader lights the relief with the real sun), only soft
// contact occlusion. A = height: material above ~0.25, "gaps" below (the ground under the path shows there — grass
// between slabs and stones); in the gaps A also grows toward the stones (contact AO for the shader).
// Everything wraps seamlessly. Generated off the main thread (pathTexWorker.js) and cached in IndexedDB by source hash.

import { mulberry32, clamp } from '../engine/noise.js';
import { _noise } from './terrainTex.js';

export const PATH_TEX = 512;
export const PATH_LAYERS = 5;
const { fbmField, worley } = _noise;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (v, n) => ((v % n) + n) % n;

// ---------------------------------------------------------------- painter
class PTex {
  constructor(n, seed) {
    this.n = n;
    this.r = new Float32Array(n * n); this.g = new Float32Array(n * n); this.b = new Float32Array(n * n); this.h = new Float32Array(n * n);
    this.rand = mulberry32(seed);
  }
  fill(c, h) { this.r.fill(c[0]); this.g.fill(c[1]); this.b.fill(c[2]); this.h.fill(h); return this; }
  // col *= 1 + f * amt (* tint), h += f * hAmt
  mod(f, amt, tint = null, hAmt = 0) {
    const { r, g, b, h } = this, t0 = tint ? tint[0] : 1, t1 = tint ? tint[1] : 1, t2 = tint ? tint[2] : 1;
    for (let i = 0; i < f.length; i++) { const v = f[i] * amt; r[i] *= 1 + v * t0; g[i] *= 1 + v * t1; b[i] *= 1 + v * t2; h[i] += f[i] * hAmt; }
    return this;
  }
  disc(cx, cy, rad, col, alpha, hDelta = 0) {
    const n = this.n, R = Math.ceil(rad + 0.5), x0 = Math.floor(cx), y0 = Math.floor(cy), ir = 1 / rad;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const ex = (x0 + dx + 0.5 - cx) * ir, ey = (y0 + dy + 0.5 - cy) * ir, d2 = ex * ex + ey * ey;
      if (d2 >= 1) continue;
      const q = 1 - d2, a = alpha * q * q, i = wrap(y0 + dy, n) * n + wrap(x0 + dx, n);
      this.r[i] += (col[0] - this.r[i]) * a; this.g[i] += (col[1] - this.g[i]) * a; this.b[i] += (col[2] - this.b[i]) * a;
      this.h[i] += hDelta * a;
    }
  }
  line(x0, y0, x1, y1, w, col, alpha, hTo = null) {
    const n = this.n, sx = x1 - x0, sy = y1 - y0, L2 = sx * sx + sy * sy || 1;
    for (let py = Math.floor(Math.min(y0, y1) - w - 1); py <= Math.ceil(Math.max(y0, y1) + w + 1); py++) {
      for (let px = Math.floor(Math.min(x0, x1) - w - 1); px <= Math.ceil(Math.max(x0, x1) + w + 1); px++) {
        const qx = px + 0.5 - x0, qy = py + 0.5 - y0, tt = clamp((qx * sx + qy * sy) / L2, 0, 1);
        const d = Math.hypot(qx - sx * tt, qy - sy * tt);
        if (d > w + 0.5) continue;
        const a = clamp(w + 0.5 - d, 0, 1) * alpha, i = wrap(py, n) * n + wrap(px, n);
        this.r[i] += (col[0] - this.r[i]) * a; this.g[i] += (col[1] - this.g[i]) * a; this.b[i] += (col[2] - this.b[i]) * a;
        if (hTo !== null) this.h[i] += (hTo - this.h[i]) * a;
      }
    }
  }
  // irregular rounded stone, unlit: rim occlusion + contact AO ring on what is under it; height dome, z-ordered
  // (a stone only covers pixels lower than itself, so piles of pebbles overlap naturally)
  stone(cx, cy, rad, col, { h = 0.85, rim = 0.32, flat = 0.3, el = null, rot = null, ao = 0.22, harm = 1 } = {}) {
    const n = this.n, R0 = this.rand;
    const a1 = (0.07 + R0() * 0.13) * harm, p1 = R0() * 6.28, a2 = (0.04 + R0() * 0.08) * harm, p2 = R0() * 6.28;
    const e = el ?? 0.72 + R0() * 0.5, ro = rot ?? R0() * Math.PI, cr = Math.cos(ro), sr = Math.sin(ro);
    const x0 = Math.floor(cx), y0 = Math.floor(cy), R = Math.ceil(rad * 1.45 / Math.min(1, e) + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const ex = x0 + dx + 0.5 - cx, ey = y0 + dy + 0.5 - cy;
      const lx = (ex * cr + ey * sr) / e, ly = -ex * sr + ey * cr, dl = Math.hypot(lx, ly);
      if (dl > rad * 1.45) continue;
      const ca = dl > 0 ? lx / dl : 1, sa = dl > 0 ? ly / dl : 0;
      const s2 = 2 * sa * ca, c2 = ca * ca - sa * sa, s3 = sa * (3 - 4 * sa * sa), c3 = ca * (4 * ca * ca - 3);
      const rr = rad * (1 + a1 * (s2 * Math.cos(p1) + c2 * Math.sin(p1)) + a2 * (s3 * Math.cos(p2) + c3 * Math.sin(p2)));
      const d = dl / rr, i = wrap(y0 + dy, n) * n + wrap(x0 + dx, n);
      if (d >= 1) {
        // contact occlusion on the ground / pebbles around the stone
        if (ao > 0 && d < 1.4) { const k = 1 - ao * (1 - smooth(1.0, 1.4, d)); this.r[i] *= k; this.g[i] *= k; this.b[i] *= k; }
        continue;
      }
      const dome = Math.sqrt(Math.max(0, 1 - d * d));
      const ht = h * (flat + (1 - flat) * dome);
      if (ht < this.h[i] - 0.015) continue; // under a taller neighbour
      const aa = clamp((1 - d) * rr * 1.1, 0, 1);
      const s = (1 - rim * smooth(0.62, 1.0, d)) * (0.97 + 0.06 * dome);
      this.r[i] += (col[0] * s - this.r[i]) * aa; this.g[i] += (col[1] * s - this.g[i]) * aa; this.b[i] += (col[2] * s - this.b[i]) * aa;
      this.h[i] += (Math.max(ht, this.h[i]) - this.h[i]) * aa;
    }
  }
  bytes() {
    const n = this.n, out = new Uint8Array(n * n * 4), { r, g, b, h } = this;
    for (let i = 0, o = 0; i < n * n; i++, o += 4) {
      out[o] = clamp(r[i] * 255 + 0.5, 0, 255); out[o + 1] = clamp(g[i] * 255 + 0.5, 0, 255);
      out[o + 2] = clamp(b[i] * 255 + 0.5, 0, 255); out[o + 3] = clamp(h[i] * 255 + 0.5, 0, 255);
    }
    return out;
  }
}

// small helper: periodic fbm, ≈[-1, 1]
const fb = (n, P, oct, gain, rand) => fbmField(n, P, oct, gain, rand);

// ---------------------------------------------------------------- 0 packed earth
function dirt(n, seed) {
  const T = new PTex(n, seed), R = T.rand;
  T.fill([0.57, 0.47, 0.345], 0.46);
  T.mod(fb(n, 4, 3, 0.5, R), 0.07, [1, 0.92, 0.8], 0.06);
  T.mod(fb(n, 16, 3, 0.55, R), 0.06, null, 0.05);
  T.mod(fb(n, 96, 3, 0.6, R), 0.08, null, 0.06);
  // dry crack network in patches (faint), darker damp blotches
  const cw = worley(n, 11, R, 0.9), cm = fb(n, 6, 3, 0.5, R), dm = fb(n, 8, 3, 0.5, R);
  for (let i = 0; i < n * n; i++) {
    const crack = cw.e[i] < 0.035 ? (1 - smooth(0.0, 0.035, cw.e[i])) * smooth(0.05, 0.35, cm[i]) : 0;
    const damp = smooth(0.15, 0.55, dm[i]);
    const k = (1 - 0.14 * crack) * (1 - 0.08 * damp);
    T.r[i] *= k; T.g[i] *= k * 1.005; T.b[i] *= k * 1.01;
    T.h[i] -= crack * 0.09 + damp * 0.03;
  }
  // grit: light / dark grains, a few embedded small stones, straw bits
  for (let k = 0; k < 3400; k++) {
    const light = R() < 0.55;
    T.disc(R() * n, R() * n, 0.6 + R() * 0.9, light ? [0.7, 0.61, 0.47] : [0.36, 0.28, 0.2], 0.4, light ? 0.04 : -0.03);
  }
  const sc = [[0.6, 0.57, 0.52], [0.52, 0.47, 0.4], [0.66, 0.6, 0.5], [0.45, 0.42, 0.4]];
  for (let k = 0; k < 140; k++) {
    const c = sc[Math.floor(R() * sc.length)], v = 0.88 + R() * 0.24;
    T.stone(R() * n, R() * n, 1.3 + Math.pow(R(), 1.8) * 2.6, [c[0] * v, c[1] * v, c[2] * v], { h: 0.62, flat: 0.45, rim: 0.3, ao: 0.16 });
  }
  for (let k = 0; k < 40; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, l = 3 + R() * 6;
    T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.35, [0.66, 0.58, 0.38], 0.55);
  }
  for (let i = 0; i < n * n; i++) T.h[i] = Math.max(0.32, T.h[i]);
  return T.bytes();
}

// ---------------------------------------------------------------- 1 gravel
function gravel(n, seed) {
  const T = new PTex(n, seed), R = T.rand;
  T.fill([0.33, 0.3, 0.26], 0.3); // gritty soil between the stones
  T.mod(fb(n, 12, 3, 0.55, R), 0.12);
  for (let k = 0; k < 2600; k++) T.disc(R() * n, R() * n, 0.5 + R() * 0.8, R() < 0.5 ? [0.25, 0.22, 0.19] : [0.48, 0.45, 0.4], 0.6, 0.02);
  const cols = [[0.62, 0.6, 0.56], [0.55, 0.53, 0.5], [0.7, 0.66, 0.58], [0.47, 0.46, 0.46], [0.66, 0.57, 0.47], [0.58, 0.55, 0.5], [0.75, 0.72, 0.66], [0.52, 0.45, 0.38]];
  const pm = fb(n, 5, 3, 0.5, R);
  for (let k = 0; k < 3900; k++) {
    const x = R() * n, y = R() * n, i = Math.floor(y) * n + Math.floor(x);
    const c = cols[Math.floor(R() * cols.length)], v = (0.86 + R() * 0.26) * (1 + pm[i] * 0.06);
    const rad = 2.4 + Math.pow(R(), 1.5) * 5.2;
    T.stone(x, y, rad, [c[0] * v, c[1] * v, c[2] * v], { h: 0.62 + R() * 0.34, flat: 0.15 + R() * 0.25, rim: 0.34, ao: 0.26, harm: 1.3 });
  }
  // speckles on the stones, a little dust in the lows
  for (let i = 0; i < n * n; i++) {
    if (T.h[i] > 0.5) { const s = (Math.sin(i * 12.9898) * 43758.5453) % 1; const v = s < 0 ? s + 1 : s; if (v > 0.93) { T.r[i] *= 0.82; T.g[i] *= 0.82; T.b[i] *= 0.84; } else if (v < 0.05) { T.r[i] *= 1.12; T.g[i] *= 1.12; T.b[i] *= 1.1; } }
    else { const k = 0.06 * (0.5 - T.h[i]); T.r[i] += k * 0.6; T.g[i] += k * 0.5; T.b[i] += k * 0.4; }
  }
  return T.bytes();
}

// ---------------------------------------------------------------- 2 flagstones (lajota)
function flagstones(n, seed) {
  const T = new PTex(n, seed), R = T.rand;
  T.fill([0.26, 0.23, 0.18], 0.06); // dark earth in the joints (mostly replaced by the real ground in the shader)
  const wx = fb(n, 8, 3, 0.55, R), wy = fb(n, 8, 3, 0.55, R);
  for (let i = 0; i < wx.length; i++) { wx[i] *= 11; wy[i] *= 11; }
  const C = 8, V = worley(n, C, R, 0.86, wx, wy);
  const rough = fb(n, 48, 3, 0.6, R), grain = fb(n, 128, 2, 0.6, R), gapN = fb(n, 10, 3, 0.5, R), lich = fb(n, 20, 3, 0.55, R);
  // per slab: tint, tilt, wear, a crack (angle) or none
  const NC = C * C, tint = new Float32Array(NC * 3), tcx = new Float32Array(NC), tcy = new Float32Array(NC), crackA = new Float32Array(NC), hasCrack = new Uint8Array(NC), moss = new Float32Array(NC);
  const pal = [[0.62, 0.59, 0.54], [0.66, 0.6, 0.51], [0.55, 0.55, 0.55], [0.6, 0.55, 0.49], [0.7, 0.66, 0.59], [0.52, 0.5, 0.47]];
  for (let k = 0; k < NC; k++) {
    const c = pal[Math.floor(R() * pal.length)], v = 0.9 + R() * 0.18;
    tint[k * 3] = c[0] * v; tint[k * 3 + 1] = c[1] * v; tint[k * 3 + 2] = c[2] * v;
    const a = R() * 6.283, s = 0.05 + R() * 0.1;
    tcx[k] = Math.cos(a) * s; tcy[k] = Math.sin(a) * s;
    hasCrack[k] = R() < 0.4 ? 1 : 0; crackA[k] = R() * Math.PI; moss[k] = R();
  }
  const { r, g, b, h } = T;
  for (let i = 0; i < n * n; i++) {
    const k = V.cell[i], e = V.e[i], ox = V.ox[i], oy = V.oy[i];
    const gw = 0.07 + 0.045 * smooth(-0.4, 0.6, gapN[i]); // joint half-width (cell units), wider in places
    if (e < gw) {
      // joint: earth, its height rising toward the slab edge (contact AO in the shader)
      h[i] = 0.02 + 0.14 * smooth(gw * 0.2, gw, e);
      continue;
    }
    const bev = smooth(gw, gw + 0.09, e);           // rounded worn edge
    const tilt = ox * tcx[k] + oy * tcy[k];
    let hh = 0.56 + 0.22 * bev + tilt + rough[i] * 0.05 + grain[i] * 0.02;
    let kk = (0.9 + 0.1 * bev) * (1 + rough[i] * 0.05 + grain[i] * 0.06);
    // worn, slightly polished middle
    kk *= 1 + 0.05 * smooth(0.3, 0.05, Math.hypot(ox, oy));
    // thin crack across some slabs (through the feature point, wobbling)
    if (hasCrack[k]) {
      const ca = Math.cos(crackA[k]), sa = Math.sin(crackA[k]);
      const dist = Math.abs(-ox * sa + oy * ca + rough[i] * 0.03) * 64; // px
      if (dist < 1.3) { const c = 1 - dist / 1.3; kk *= 1 - 0.35 * c; hh -= 0.12 * c; }
    }
    let rr = tint[k * 3] * kk, gg = tint[k * 3 + 1] * kk, bb = tint[k * 3 + 2] * kk;
    // lichen / moss creeping in from the joints on some slabs
    const mz = smooth(0.12, -0.05, e - gw - 0.05 * lich[i]) * (moss[k] < 0.55 ? 0.8 : 0.3) + (moss[k] < 0.25 ? smooth(0.35, 0.6, lich[i]) * 0.55 : 0);
    if (mz > 0) { rr += (0.45 * kk - rr) * mz * 0.55; gg += (0.5 * kk - gg) * mz * 0.55; bb += (0.3 * kk - bb) * mz * 0.55; }
    r[i] = rr; g[i] = gg; b[i] = bb;
    h[i] = clamp(hh, 0.3, 1);
  }
  // pale lichen rosettes
  for (let k = 0; k < 90; k++) {
    const x = R() * n, y = R() * n;
    if (h[Math.floor(y) * n + Math.floor(x)] < 0.4) continue;
    T.disc(x, y, 1 + R() * 2.2, R() < 0.6 ? [0.74, 0.74, 0.6] : [0.7, 0.62, 0.4], 0.45);
  }
  return T.bytes();
}

// ---------------------------------------------------------------- 3 cobble setts (paralelepípedo)
function cobbles(n, seed) {
  const T = new PTex(n, seed), R = T.rand;
  T.fill([0.46, 0.41, 0.33], 0.1); // sandy joints
  const rows = 16, rh = n / rows; // 32 px rows (0.25 tile)
  const rough = fb(n, 40, 3, 0.6, R), sand = fb(n, 64, 2, 0.6, R);
  const pal = [[0.5, 0.5, 0.52], [0.56, 0.53, 0.51], [0.44, 0.45, 0.47], [0.58, 0.55, 0.52], [0.5, 0.47, 0.45], [0.62, 0.6, 0.58]];
  const { r, g, b, h } = T;
  for (let row = 0; row < rows; row++) {
    // random sett widths that add up to exactly n (seamless wrap), shifted per row
    const ws = [];
    let sum = 0;
    while (sum < n - 30) { const w = 34 + Math.floor(R() * 26); ws.push(w); sum += w; }
    const k = n / sum;
    let acc = 0;
    const edges = ws.map((w) => { const s = Math.round(acc); acc += w * k; return [s, Math.round(acc)]; });
    edges[edges.length - 1][1] = n;
    const off = Math.floor(R() * n);
    for (const [s0, s1] of edges) {
      const c = pal[Math.floor(R() * pal.length)], v = 0.88 + R() * 0.22;
      const cr = c[0] * v, cg = c[1] * v, cb = c[2] * v;
      const tx = (R() - 0.5) * 0.12, ty = (R() - 0.5) * 0.12;
      const jw = 1.5 + R() * 1.1, rc = 5 + R() * 5; // joint half width, corner radius (px)
      const w = s1 - s0, y0 = row * rh;
      for (let y = 0; y < rh; y++) for (let x = 0; x < w; x++) {
        const px = wrap(s0 + x + off, n), py = y0 + y, i = py * n + px;
        // distance to the rounded rectangle edge (inside, px)
        const lx = Math.min(x + 0.5, w - x - 0.5), ly = Math.min(y + 0.5, rh - y - 0.5);
        let de;
        if (lx < rc && ly < rc) de = rc - Math.hypot(rc - lx, rc - ly); else de = Math.min(lx, ly);
        de += rough[i] * 2.6 + sand[i] * 0.8;
        if (de < jw) { h[i] = 0.02 + 0.13 * smooth(0, jw, de); const sk = 1 + sand[i] * 0.12; r[i] = 0.46 * sk; g[i] = 0.41 * sk; b[i] = 0.33 * sk; continue; }
        const bev = smooth(jw, jw + 7, de);
        const u = (x / w - 0.5), vv = (y / rh - 0.5);
        h[i] = clamp(0.52 + 0.3 * bev + u * tx * 4 + vv * ty * 4 + rough[i] * 0.05, 0.3, 1);
        const kk = (0.88 + 0.12 * bev) * (1 + rough[i] * 0.06);
        r[i] = cr * kk; g[i] = cg * kk; b[i] = cb * kk;
      }
    }
  }
  // granite speckle (mica / quartz) on the stones
  const rs = mulberry32(seed * 7 + 3);
  for (let i = 0; i < n * n; i++) {
    if (h[i] < 0.3) continue;
    const s = rs();
    if (s > 0.92) { r[i] *= 0.72; g[i] *= 0.72; b[i] *= 0.74; } else if (s < 0.05) { r[i] *= 1.16; g[i] *= 1.15; b[i] *= 1.13; }
  }
  return T.bytes();
}

// ---------------------------------------------------------------- 4 stepping stones
function steppingStones(n, seed) {
  const T = new PTex(n, seed), R = T.rand;
  T.fill([0.3, 0.27, 0.21], 0.0); // all gap: the real ground (grass) shows; stones sit on it
  const C = 7, cs = n / C;
  const pal = [[0.64, 0.62, 0.58], [0.6, 0.56, 0.5], [0.55, 0.55, 0.56], [0.68, 0.63, 0.55], [0.58, 0.58, 0.55]];
  const rough = fb(n, 36, 3, 0.6, R);
  // contact AO halo in the gap height, then the stones
  const centers = [];
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    const x = (cx + 0.5 + (R() - 0.5) * 0.36) * cs, y = (cy + 0.5 + (R() - 0.5) * 0.36) * cs;
    centers.push([x, y, cs * (0.27 + R() * 0.08), 0.75 + R() * 0.4, R() * Math.PI]);
  }
  const { h } = T;
  for (const [x, y, rad, e] of centers) {
    const RR = Math.ceil(rad * 1.8 * Math.max(1, e));
    for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
      const d = Math.hypot(dx, dy) / (rad * (0.5 + 0.5 * Math.max(1, e)));
      if (d > 1.7) continue;
      const i = wrap(Math.floor(y) + dy, n) * n + wrap(Math.floor(x) + dx, n);
      h[i] = Math.max(h[i], 0.15 * smooth(1.7, 0.95, d));
    }
  }
  for (const [x, y, rad, e, ro] of centers) {
    const c = pal[Math.floor(R() * pal.length)], v = 0.9 + R() * 0.18;
    T.stone(x, y, rad, [c[0] * v, c[1] * v, c[2] * v], { h: 0.72, flat: 0.72, rim: 0.26, el: e, rot: ro, ao: 0, harm: 0.8 });
  }
  for (let i = 0; i < n * n; i++) if (h[i] > 0.3) { const k = 1 + rough[i] * 0.07; T.r[i] *= k; T.g[i] *= k; T.b[i] *= k; h[i] += rough[i] * 0.04; }
  for (let k = 0; k < 70; k++) {
    const x = R() * n, y = R() * n;
    if (h[Math.floor(y) * n + Math.floor(x)] < 0.4) continue;
    T.disc(x, y, 1 + R() * 2.4, R() < 0.5 ? [0.72, 0.72, 0.58] : [0.5, 0.56, 0.36], 0.4);
  }
  return T.bytes();
}

// ---------------------------------------------------------------- generation + cache
export function generatePathLayers() {
  const n = PATH_TEX, S = 70411;
  return [dirt(n, S + 1), gravel(n, S + 2), flagstones(n, S + 3), cobbles(n, S + 4), steppingStones(n, S + 5)];
}

function srcHash() {
  const str = [PTex, dirt, gravel, flagstones, cobbles, steppingStones, generatePathLayers, smooth].map((f) => f.toString()).join('|') + PATH_TEX;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 'p1-' + h.toString(36);
}

const DB = 'wos-cache', STORE = 'terrain';
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const okLayers = (L) => Array.isArray(L) && L.length === PATH_LAYERS && L.every((l) => l && l.length === PATH_TEX * PATH_TEX * 4);
async function cacheGet(key) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const g = db.transaction(STORE, 'readonly').objectStore(STORE).get('paths');
      g.onsuccess = () => { const v = g.result; db.close(); res(v && v.key === key && okLayers(v.layers) ? v.layers : null); };
      g.onerror = () => { db.close(); res(null); };
    });
  } catch { return null; }
}
function cachePut(key, layers) {
  openDB().then((db) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, layers }, 'paths');
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  }).catch(() => {});
}

// main thread: cached layers, else generated by a module worker (sync fallback). Resolves to 5 Uint8Arrays.
let pending = null;
export const pathTexStats = { ms: 0, source: '' };
export function loadPathLayers() {
  if (pending) return pending;
  pending = (async () => {
    const t0 = performance.now();
    const key = srcHash();
    const hasDB = typeof indexedDB !== 'undefined';
    if (hasDB) {
      const hit = await cacheGet(key);
      if (hit) { pathTexStats.ms = performance.now() - t0; pathTexStats.source = 'cache'; return hit; }
    }
    let layers = null;
    if (typeof Worker !== 'undefined') {
      layers = await new Promise((res) => {
        let w;
        try { w = new Worker(new URL('./pathTexWorker.js', import.meta.url), { type: 'module' }); } catch { res(null); return; }
        const t = setTimeout(() => { w.terminate(); res(null); }, 30000);
        w.onmessage = (e) => { clearTimeout(t); w.terminate(); res(okLayers(e.data) ? e.data : null); };
        w.onerror = (e) => { e.preventDefault?.(); clearTimeout(t); w.terminate(); res(null); };
        w.postMessage(1);
      });
      if (layers) pathTexStats.source = 'worker';
    }
    if (!layers) { layers = generatePathLayers(); pathTexStats.source = 'main'; }
    pathTexStats.ms = performance.now() - t0;
    if (hasDB) setTimeout(() => cachePut(key, layers), 3000);
    return layers;
  })();
  return pending;
}
