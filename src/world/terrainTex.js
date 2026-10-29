// Procedural tileable ground/rock textures (RGBA Uint8Array, TEX x TEX) + shader noise texture.
// Layers 0..7 = ground ids (see worldgen G), 8..11 = rock types (granite, limestone, slate, marble).
// RGB = albedo, A = height (0..1). The terrain shader uses the height for height-blended transitions
// between ground types, puddles in low spots, and dynamic sun bump-lighting on rock tops.
// Everything is periodic (wraps seamlessly). The look is fixed (independent of the world seed).

import { mulberry32, clamp } from '../engine/noise.js';

export const TEX = 512;

// ---------------------------------------------------------------- fast periodic noise
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Adds one octave of periodic gradient noise (≈[-1,1] * amp) into `out` (n*n).
function addOctave(out, n, P, amp, rand) {
  const gx = new Float32Array(P * P), gy = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) { const a = rand() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const s = P / n;
  const c0 = new Int32Array(n), c1 = new Int32Array(n), cf = new Float32Array(n), cu = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const f = x * s, i = Math.floor(f), t = f - i;
    c0[x] = i % P; c1[x] = (i + 1) % P; cf[x] = t; cu[x] = fade(t);
  }
  const k = amp * 1.414;
  for (let y = 0; y < n; y++) {
    const fy = y * s, iy = Math.floor(fy), ty = fy - iy, v = fade(ty), ty1 = ty - 1;
    const r0 = (iy % P) * P, r1 = ((iy + 1) % P) * P, row = y * n;
    for (let x = 0; x < n; x++) {
      const tx = cf[x], u = cu[x], tx1 = tx - 1;
      const a = r0 + c0[x], b = r0 + c1[x], c = r1 + c0[x], d = r1 + c1[x];
      const na = gx[a] * tx + gy[a] * ty, nb = gx[b] * tx1 + gy[b] * ty;
      const nc = gx[c] * tx + gy[c] * ty1, nd = gx[d] * tx1 + gy[d] * ty1;
      const x0 = na + (nb - na) * u, x1 = nc + (nd - nc) * u;
      out[row + x] += (x0 + (x1 - x0) * v) * k;
    }
  }
}

// Periodic fBm field, ≈[-1,1]. `P` = base period in cells across the texture.
function fbmField(n, P, oct, gain, rand) {
  const out = new Float32Array(n * n);
  let amp = 1, norm = 0, per = P;
  for (let o = 0; o < oct && per <= n / 2; o++) {
    addOctave(out, n, per, amp, rand);
    norm += amp; amp *= gain; per *= 2;
  }
  const inv = 1 / norm;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

// Anisotropic periodic noise (different periods along x / y): strata, cleavage.
function anisoField(n, Px, Py, oct, gain, rand) {
  const out = new Float32Array(n * n);
  let amp = 1, norm = 0;
  const c0 = new Int32Array(n), c1 = new Int32Array(n), cf = new Float32Array(n), cu = new Float32Array(n);
  for (let o = 0; o < oct; o++) {
    const px = Px << o, py = Py << o;
    if (px > n / 2 || py > n / 2) break;
    const gx = new Float32Array(px * py), gy = new Float32Array(px * py);
    for (let i = 0; i < px * py; i++) { const a = rand() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    for (let x = 0; x < n; x++) {
      const f = (x * px) / n, i = Math.floor(f), t = f - i;
      c0[x] = i % px; c1[x] = (i + 1) % px; cf[x] = t; cu[x] = fade(t);
    }
    const k = amp * 1.414;
    for (let y = 0; y < n; y++) {
      const fy = (y * py) / n, iy = Math.floor(fy), ty = fy - iy, v = fade(ty), ty1 = ty - 1;
      const r0 = (iy % py) * px, r1 = ((iy + 1) % py) * px, row = y * n;
      for (let x = 0; x < n; x++) {
        const tx = cf[x], u = cu[x], tx1 = tx - 1;
        const a = r0 + c0[x], b = r0 + c1[x], c = r1 + c0[x], d = r1 + c1[x];
        const na = gx[a] * tx + gy[a] * ty, nb = gx[b] * tx1 + gy[b] * ty;
        const nc = gx[c] * tx + gy[c] * ty1, nd = gx[d] * tx1 + gy[d] * ty1;
        const x0 = na + (nb - na) * u, x1 = nc + (nd - nc) * u;
        out[row + x] += (x0 + (x1 - x0) * v) * k;
      }
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Periodic Worley noise with optional domain warp (wx, wy fields, in pixels).
// Returns { e (F2-F1 edge distance), cell (nearest cell index), id (per-cell random 0..1 array),
//           ox, oy (offset of the pixel from its feature point, in cell units) }.
function worley(n, cells, rand, jitter = 0.9, wx = null, wy = null) {
  const C = cells, px = new Float32Array(C * C), py = new Float32Array(C * C), id = new Float32Array(C * C);
  for (let i = 0; i < C * C; i++) {
    px[i] = 0.5 + (rand() - 0.5) * jitter; py[i] = 0.5 + (rand() - 0.5) * jitter; id[i] = rand();
  }
  const e = new Float32Array(n * n), cell = new Int32Array(n * n), ox = new Float32Array(n * n), oy = new Float32Array(n * n);
  const s = C / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let fx = x * s, fy = y * s;
      if (wx) {
        fx += wx[i] * s; fy += wy[i] * s;
        if (fx < 0) fx += C; else if (fx >= C) fx -= C;
        if (fy < 0) fy += C; else if (fy >= C) fy -= C;
      }
      const cx = Math.floor(fx), cy = Math.floor(fy), lx = fx - cx, ly = fy - cy;
      let d1 = 9, d2 = 9, best = 0, bx = 0, by = 0;
      for (let oy2 = -1; oy2 <= 1; oy2++) {
        let yy = cy + oy2; if (yy < 0) yy += C; else if (yy >= C) yy -= C;
        const row = yy * C;
        for (let ox2 = -1; ox2 <= 1; ox2++) {
          let xx = cx + ox2; if (xx < 0) xx += C; else if (xx >= C) xx -= C;
          const k = row + xx;
          const dx = ox2 + px[k] - lx, dy = oy2 + py[k] - ly;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = k; bx = dx; by = dy; } else if (d < d2) d2 = d;
        }
      }
      e[i] = Math.sqrt(d2) - Math.sqrt(d1); cell[i] = best; ox[i] = -bx; oy[i] = -by;
    }
  }
  return { e, cell, id, ox, oy };
}

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LX = -0.48, LY = -0.58, LZ = 0.66; // baked light: from top-left

// Shared field bank: a few expensive fields reused (cyclically shifted) by several layers.
class Bank {
  constructor(n, seed) { this.n = n; this.rand = mulberry32(seed); this.cache = new Map(); }
  get(key, P, oct, gain) {
    let f = this.cache.get(key);
    if (!f) { f = fbmField(this.n, P, oct, gain, this.rand); this.cache.set(key, f); }
    return f;
  }
  // shifted (and optionally transposed) view of a cached field — still tileable
  view(key, P, oct, gain, sx, sy, transpose = false) {
    let f = this.get(key, P, oct, gain);
    const n = this.n;
    if (transpose) {
      const tk = key + '^T';
      let t = this.cache.get(tk);
      if (!t) {
        t = new Float32Array(n * n);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) t[y * n + x] = f[x * n + y];
        this.cache.set(tk, t);
      }
      f = t;
    }
    sx = ((sx % n) + n) % n; sy = ((sy % n) + n) % n;
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      const src = ((y + sy) % n) * n, dst = y * n;
      out.set(f.subarray(src + sx, src + n), dst);
      if (sx) out.set(f.subarray(src, src + sx), dst + n - sx);
    }
    return out;
  }
}

// ---------------------------------------------------------------- texture canvas
class Tex {
  constructor(n, seed) {
    this.n = n;
    this.r = new Float32Array(n * n); this.g = new Float32Array(n * n); this.b = new Float32Array(n * n);
    this.h = new Float32Array(n * n);
    this.rand = mulberry32(seed);
  }
  fill(c, h = 0.5) { this.r.fill(c[0]); this.g.fill(c[1]); this.b.fill(c[2]); this.h.fill(h); return this; }
  // brightness (and optional hue) modulation by field: col *= 1 + f*amt*tint
  mod(f, amt, tint = null, hAmt = 0) {
    const { r, g, b, h } = this;
    const t0 = tint ? tint[0] : 1, t1 = tint ? tint[1] : 1, t2 = tint ? tint[2] : 1;
    for (let i = 0; i < f.length; i++) {
      const v = f[i] * amt;
      r[i] *= 1 + v * t0; g[i] *= 1 + v * t1; b[i] *= 1 + v * t2;
      h[i] += f[i] * hAmt;
    }
    return this;
  }
  // blend toward colour where mask (0..1) is set
  paint(mask, col, hTo = null, hK = 1) {
    const { r, g, b, h } = this;
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i];
      if (m <= 0) continue;
      r[i] += (col[0] - r[i]) * m; g[i] += (col[1] - g[i]) * m; b[i] += (col[2] - b[i]) * m;
      if (hTo !== null) h[i] += (hTo - h[i]) * m * hK;
    }
    return this;
  }

  // soft disc (clods, stains, grains)
  disc(cx, cy, rad, col, alpha, hDelta = 0) {
    const n = this.n, R = Math.ceil(rad + 0.5), x0 = Math.floor(cx), y0 = Math.floor(cy), ir = 1 / rad;
    for (let dy = -R; dy <= R; dy++) {
      const py = (((y0 + dy) % n) + n) % n, ey = (y0 + dy + 0.5 - cy) * ir;
      for (let dx = -R; dx <= R; dx++) {
        const ex = (x0 + dx + 0.5 - cx) * ir, d2 = ex * ex + ey * ey;
        if (d2 >= 1) continue;
        const q = 1 - d2, a = alpha * q * q;
        const i = py * n + ((((x0 + dx) % n) + n) % n);
        this.r[i] += (col[0] - this.r[i]) * a; this.g[i] += (col[1] - this.g[i]) * a; this.b[i] += (col[2] - this.b[i]) * a;
        this.h[i] += hDelta * a;
      }
    }
  }

  // rounded irregular stone with baked lighting, dark rim and contact shadow
  pebble(cx, cy, rad, col, { h = 0.85, rim = 0.5, shadow = 0.32, flat = 0.4, lum = 1 } = {}) {
    const n = this.n, rand = this.rand;
    const a1 = 0.08 + rand() * 0.14, p1 = rand() * 6.28, a2 = 0.05 + rand() * 0.08, p2 = rand() * 6.28;
    const el = 0.75 + rand() * 0.45, rot = rand() * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    const sox = rad * 0.28, soy = rad * 0.34, sr2 = 1 / (rad * 1.12);
    if (shadow > 0) {
      const R = Math.ceil(rad * 1.2 + 1);
      for (let dy = -R; dy <= R + 1; dy++) for (let dx = -R; dx <= R + 1; dx++) {
        const ex = (x0 + dx + 0.5 - cx - sox) * sr2, ey = (y0 + dy + 0.5 - cy - soy) * sr2;
        const d2 = ex * ex + ey * ey;
        if (d2 >= 1) continue;
        const i = ((((y0 + dy) % n) + n) % n) * n + ((((x0 + dx) % n) + n) % n), k = 1 - shadow * (1 - d2);
        this.r[i] *= k; this.g[i] *= k; this.b[i] *= k;
      }
    }
    const R = Math.ceil(rad * 1.3 / Math.min(1, el) + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const ex = x0 + dx + 0.5 - cx, ey = y0 + dy + 0.5 - cy;
      const lx = (ex * cr + ey * sr) / el, ly = -ex * sr + ey * cr;
      const dl = Math.sqrt(lx * lx + ly * ly);
      if (dl > rad * 1.25) continue;
      const ca = dl > 0 ? lx / dl : 1, sa = dl > 0 ? ly / dl : 0;
      // sin(2a), sin(3a) via angle identities (no atan2)
      const s2 = 2 * sa * ca, c2 = ca * ca - sa * sa, s3 = sa * (3 - 4 * sa * sa), c3 = ca * (4 * ca * ca - 3);
      const rr = rad * (1 + a1 * (s2 * Math.cos(p1) + c2 * Math.sin(p1)) + a2 * (s3 * Math.cos(p2) + c3 * Math.sin(p2)));
      const d = dl / rr;
      if (d >= 1.0) continue;
      const aa = clamp((1 - d) * rr * 1.2, 0, 1);
      const nz0 = Math.sqrt(Math.max(0, 1 - d * d));
      const nx = (ex / rr) * (1 - flat), ny = (ey / rr) * (1 - flat), nz = nz0 * (1 - flat) + flat;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const lit = Math.max(0, (nx * LX + ny * LY + nz * LZ) / nl);
      let s = (0.5 + 0.62 * lit) * lum;
      s *= 1 - rim * smooth(0.72, 1.0, d);
      const i = ((((y0 + dy) % n) + n) % n) * n + ((((x0 + dx) % n) + n) % n);
      this.r[i] += (col[0] * s - this.r[i]) * aa;
      this.g[i] += (col[1] * s - this.g[i]) * aa;
      this.b[i] += (col[2] * s - this.b[i]) * aa;
      const ht = h * (0.55 + 0.45 * nz0);
      if (ht > this.h[i]) this.h[i] += (ht - this.h[i]) * aa;
    }
  }

  // elongated leaf (forest litter) with a soft drop shadow
  leaf(cx, cy, len, wid, ang, col, alpha = 1) {
    const n = this.n, ca = Math.cos(ang), sa = Math.sin(ang), R = Math.ceil(len + 2);
    const x0 = Math.floor(cx), y0 = Math.floor(cy), il = 1 / len, iw = 1 / wid;
    for (let pass = 0; pass < 2; pass++) {
      const ox = pass === 0 ? 0.9 : 0, oy = pass === 0 ? 1.1 : 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const ex = x0 + dx + 0.5 - cx - ox, ey = y0 + dy + 0.5 - cy - oy;
        const u = (ex * ca + ey * sa) * il, v = (-ex * sa + ey * ca) * iw;
        const prof = 1 - u * u;
        if (prof <= 0) continue;
        const d = Math.abs(v) / Math.sqrt(prof);
        if (d >= 1) continue;
        const aa = clamp((1 - d) * wid * 1.3, 0, 1) * alpha;
        const i = ((((y0 + dy) % n) + n) % n) * n + ((((x0 + dx) % n) + n) % n);
        if (pass === 0) { const k = 1 - 0.28 * aa; this.r[i] *= k; this.g[i] *= k; this.b[i] *= k; continue; }
        const s = (0.88 - 0.16 * v) * (Math.abs(v) < 0.16 ? 0.84 : 1);
        this.r[i] += (col[0] * s - this.r[i]) * aa; this.g[i] += (col[1] * s - this.g[i]) * aa; this.b[i] += (col[2] * s - this.b[i]) * aa;
        this.h[i] += (0.62 - this.h[i]) * aa * 0.7;
      }
    }
  }

  // thin antialiased line (twigs, roots, needles)
  line(x0, y0, x1, y1, w, col, alpha = 1, hTo = 0.6) {
    const n = this.n, sx = x1 - x0, sy = y1 - y0, L2 = sx * sx + sy * sy || 1;
    const minx = Math.floor(Math.min(x0, x1) - w - 1), maxx = Math.ceil(Math.max(x0, x1) + w + 1);
    const miny = Math.floor(Math.min(y0, y1) - w - 1), maxy = Math.ceil(Math.max(y0, y1) + w + 1);
    for (let py = miny; py <= maxy; py++) for (let px = minx; px <= maxx; px++) {
      const qx = px + 0.5 - x0, qy = py + 0.5 - y0;
      const tt = clamp((qx * sx + qy * sy) / L2, 0, 1);
      const ddx = qx - sx * tt, ddy = qy - sy * tt, d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d > w + 0.5) continue;
      const a = clamp(w + 0.5 - d, 0, 1) * alpha;
      const i = (((py % n) + n) % n) * n + (((px % n) + n) % n);
      this.r[i] += (col[0] - this.r[i]) * a; this.g[i] += (col[1] - this.g[i]) * a; this.b[i] += (col[2] - this.b[i]) * a;
      this.h[i] += (hTo - this.h[i]) * a * 0.6;
    }
  }

  bytes() {
    const n = this.n, out = new Uint8Array(n * n * 4);
    const { r, g, b, h } = this;
    for (let i = 0, o = 0; i < n * n; i++, o += 4) {
      out[o] = clamp(r[i] * 255 + 0.5, 0, 255);
      out[o + 1] = clamp(g[i] * 255 + 0.5, 0, 255);
      out[o + 2] = clamp(b[i] * 255 + 0.5, 0, 255);
      out[o + 3] = clamp(h[i] * 255 + 0.5, 0, 255);
    }
    return out;
  }
}

// ---------------------------------------------------------------- ground layers
// shared fields: 'macro' (P4, gentle variation), 'mid' (P16), 'grain' (P96 fine grain), 'patch' (P6 blotches)
function soil(n, B, seed, dark) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill(dark ? [0.405, 0.300, 0.200] : [0.462, 0.360, 0.248], 0.45);
  T.mod(B.view('macro', 4, 3, 0.5, dark ? 131 : 0, dark ? 77 : 0), 0.065, [1.0, 0.9, 0.75], 0.1);
  T.mod(B.view('mid', 16, 3, 0.55, dark ? 50 : 0, 0, dark), 0.065, null, 0.12);
  T.mod(B.view('grain', 96, 3, 0.6, dark ? 211 : 0, dark ? 19 : 0), 0.11, null, 0.18);
  const nc = dark ? 480 : 340;
  for (let k = 0; k < nc; k++) {
    const r = 2 + R() * 5, dk = R() < 0.6;
    const c = dark ? (dk ? [0.32, 0.23, 0.15] : [0.46, 0.35, 0.24]) : (dk ? [0.385, 0.295, 0.20] : [0.535, 0.425, 0.30]);
    T.disc(R() * n, R() * n, r, c, 0.26 + R() * 0.2, dk ? -0.05 : 0.08);
  }
  if (dark) for (let k = 0; k < 70; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, l = 4 + R() * 10;
    T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.45, [0.20, 0.14, 0.09], 0.5, 0.5);
  }
  for (let k = 0; k < 3000; k++) {
    const light = R() < 0.55;
    const c = light ? (dark ? [0.45, 0.36, 0.26] : [0.64, 0.55, 0.42]) : (dark ? [0.17, 0.12, 0.08] : [0.28, 0.21, 0.14]);
    T.disc(R() * n, R() * n, 0.7 + R() * 0.9, c, 0.5, light ? 0.06 : -0.03);
  }
  const np = dark ? 30 : 75;
  for (let k = 0; k < np; k++) {
    const g = 0.4 + R() * 0.22;
    T.pebble(R() * n, R() * n, 1.5 + Math.pow(R(), 1.5) * 3.2, [g * 1.08, g * 0.98, g * 0.85], { h: 0.8, rim: 0.45, shadow: 0.3 });
  }
  // life in the soil: tiny sprouts and clover leaves in loose patches, dry grass fibres, moss specks
  const pm = B.view('patch', 6, 3, 0.5, dark ? 61 : 23, dark ? 187 : 91);
  for (let k = 0; k < (dark ? 260 : 340); k++) {
    const x = R() * n, y = R() * n;
    if (pm[Math.floor(y) * n + Math.floor(x)] < -0.05 && R() < 0.7) continue;
    const gc = dark ? [0.26, 0.33, 0.15] : [0.34, 0.42, 0.18], v = 0.85 + R() * 0.3;
    if (R() < 0.45) { // clover / seedling leaves
      for (let j = 0; j < 3; j++) { const a = (j / 3) * 6.28 + R(); T.disc(x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.1, 1.1 + R() * 0.5, [gc[0] * v, gc[1] * v, gc[2] * v], 0.75, 0.05); }
    } else { const a = -1.57 + (R() - 0.5) * 1.2, l = 2 + R() * 3; T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.4, [gc[0] * v, gc[1] * v * 1.05, gc[2] * v], 0.85, 0.6); }
  }
  for (let k = 0; k < (dark ? 60 : 140); k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, l = 3 + R() * 5;
    T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.35, dark ? [0.30, 0.24, 0.15] : [0.62, 0.56, 0.36], 0.6, 0.55);
  }
  if (dark) for (let k = 0; k < 420; k++) T.disc(R() * n, R() * n, 0.6 + R() * 0.7, R() < 0.5 ? [0.27, 0.32, 0.15] : [0.33, 0.38, 0.17], 0.55, 0.03);
  return T.bytes();
}

function sand(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.79, 0.71, 0.55], 0.4);
  T.mod(B.view('macro', 4, 3, 0.5, 200, 33, true), 0.05, [1, 0.95, 0.85], 0.1);
  T.mod(B.view('grain', 96, 3, 0.6, 300, 101, true), 0.05, null, 0.08);
  const w = B.view('patch', 6, 3, 0.5, 17, 250);
  const rip = new Float32Array(n * n), K = (2 * Math.PI) / n; // integer wave counts keep it tileable
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, ph = (x * 22 + y * 8) * K + w[i] * 7;
    rip[i] = Math.sin(ph) * 0.6 + Math.sin(ph * 2 + 1) * 0.15;
  }
  T.mod(rip, 0.035, null, 0.12);
  for (let k = 0; k < 3000; k++) {
    const t = R();
    const c = t < 0.5 ? [0.90, 0.83, 0.67] : t < 0.85 ? [0.66, 0.57, 0.42] : [0.52, 0.46, 0.38];
    T.disc(R() * n, R() * n, 0.6 + R() * 0.7, c, 0.5);
  }
  for (let k = 0; k < 14; k++) {
    const g = 0.55 + R() * 0.25;
    T.pebble(R() * n, R() * n, 1.4 + R() * 2.0, [g, g * 0.95, g * 0.86], { h: 0.75, rim: 0.35, shadow: 0.22 });
  }
  for (let k = 0; k < 10; k++) T.pebble(R() * n, R() * n, 1.2 + R() * 0.8, [0.93, 0.89, 0.82], { h: 0.6, rim: 0.25, shadow: 0.2, flat: 0.6 });
  // fine wind ripples across the big ones, broken shell bits, a few dark seaweed threads
  const fr = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; fr[i] = Math.sin((x * 9 - y * 38) * K + w[i] * 3) * smooth(-0.2, 0.4, w[i]); }
  T.mod(fr, 0.02, null, 0.05);
  for (let k = 0; k < 26; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, c = R() < 0.6 ? [0.95, 0.91, 0.84] : [0.88, 0.74, 0.66];
    T.line(x, y, x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 0.7, c, 0.9, 0.62);
    T.line(x + Math.cos(a + 1.2) * 0.6, y + Math.sin(a + 1.2) * 0.6, x + Math.cos(a + 0.5) * 2, y + Math.sin(a + 0.5) * 2, 0.5, c, 0.7, 0.6);
  }
  for (let k = 0; k < 8; k++) { const x = R() * n, y = R() * n, a = R() * 6.28, l = 5 + R() * 6; T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.45, [0.30, 0.34, 0.22], 0.55, 0.5); }
  return T.bytes();
}

function gravel(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.47, 0.43, 0.37], 0.22);
  T.mod(B.view('patch', 6, 3, 0.5, 90, 400, true), 0.08);
  T.mod(B.view('grain', 96, 3, 0.6, 77, 300), 0.06);
  for (let k = 0; k < 2400; k++) { const c = R() < 0.5 ? [0.36, 0.33, 0.29] : [0.58, 0.54, 0.48]; T.disc(R() * n, R() * n, 0.6 + R() * 0.8, c, 0.6); }
  const cols = [[0.55, 0.53, 0.50], [0.62, 0.58, 0.52], [0.48, 0.45, 0.42], [0.58, 0.50, 0.42], [0.70, 0.67, 0.62], [0.44, 0.43, 0.44]];
  for (let k = 0; k < 1050; k++) {
    const c = cols[Math.floor(R() * cols.length)], v = 0.88 + R() * 0.24;
    T.pebble(R() * n, R() * n, 1.8 + Math.pow(R(), 1.6) * 5.5, [c[0] * v, c[1] * v, c[2] * v], { h: 0.7 + R() * 0.3, rim: 0.5, shadow: 0.35 });
  }
  // lichen rosettes on some stones (pale green / rust) and grass tufts between them
  for (let k = 0; k < 150; k++) {
    const x = R() * n, y = R() * n;
    if (T.h[Math.floor(y) * n + Math.floor(x)] < 0.55) continue;
    T.disc(x, y, 0.8 + R() * 1.1, R() < 0.6 ? [0.62, 0.66, 0.46] : [0.70, 0.52, 0.32], 0.6);
  }
  for (let k = 0; k < 60; k++) { const x = R() * n, y = R() * n; for (let j = 0; j < 3; j++) { const a = -1.57 + (j - 1) * 0.5 + (R() - 0.5) * 0.3, l = 2 + R() * 2.5; T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.35, [0.40, 0.46, 0.22], 0.85, 0.5); } }
  return T.bytes();
}

function marsh(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.262, 0.250, 0.165], 0.5);
  T.mod(B.view('macro', 4, 3, 0.5, 333, 128), 0.07, [0.9, 1.0, 0.9]);
  T.mod(B.view('grain', 96, 3, 0.6, 5, 444, true), 0.08, null, 0.1);
  const pud = B.view('patch', 6, 3, 0.5, 256, 128, true), m = new Float32Array(n * n);
  const fine = B.view('mid', 16, 3, 0.55, 300, 300);
  // standing water pockets (low height, dark murky) — soft edges, not camo blobs
  for (let i = 0; i < m.length; i++) m[i] = smooth(0.18, 0.42, pud[i] + fine[i] * 0.25) * 0.9;
  T.paint(m, [0.175, 0.185, 0.14], 0.05, 1);
  // mossy hummocks
  for (let i = 0; i < m.length; i++) m[i] = smooth(0.15, 0.45, -pud[i] + fine[i] * 0.4) * 0.45;
  T.paint(m, [0.33, 0.35, 0.195], 0.66, 0.6);
  for (let k = 0; k < 1500; k++) {
    const x = R() * n, y = R() * n;
    if (pud[Math.floor(y) * n + Math.floor(x)] > 0.25) continue;
    T.disc(x, y, 0.7 + R() * 1.2, R() < 0.5 ? [0.38, 0.39, 0.22] : [0.21, 0.205, 0.13], 0.5, 0.05);
  }
  for (let k = 0; k < 170; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, l = 3 + R() * 6;
    if (pud[Math.floor(y) * n + Math.floor(x)] > 0.22) continue;
    T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.5, R() < 0.5 ? [0.46, 0.43, 0.26] : [0.30, 0.32, 0.18], 0.7, 0.7);
  }
  // duckweed floating in the pools (bright little green dots, clustered)
  for (let k = 0; k < 1100; k++) {
    const x = R() * n, y = R() * n, i = Math.floor(y) * n + Math.floor(x);
    if (pud[i] < 0.3 || fine[i] < -0.1) continue;
    T.disc(x, y, 0.55 + R() * 0.5, R() < 0.5 ? [0.36, 0.48, 0.16] : [0.44, 0.56, 0.2], 0.85);
  }
  return T.bytes();
}

function mud(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.340, 0.266, 0.192], 0.5);
  T.mod(B.view('macro', 4, 3, 0.5, 64, 400, true), 0.07, [1, 0.95, 0.9], 0.15);
  T.mod(B.view('mid', 16, 3, 0.55, 128, 9, true), 0.06, null, 0.15);
  T.mod(B.view('grain', 96, 3, 0.6, 400, 222), 0.05);
  const pud = B.view('patch', 6, 3, 0.5, 400, 30), m = new Float32Array(n * n);
  for (let i = 0; i < m.length; i++) m[i] = smooth(0.2, 0.38, pud[i]);
  T.paint(m, [0.262, 0.203, 0.152], 0.06, 1);
  for (let k = 0; k < 260; k++) T.disc(R() * n, R() * n, 1.5 + R() * 4, [0.42, 0.34, 0.25], 0.22, 0.08);
  for (let k = 0; k < 1200; k++) T.disc(R() * n, R() * n, 0.6 + R() * 0.8, R() < 0.5 ? [0.24, 0.18, 0.13] : [0.45, 0.37, 0.28], 0.45);
  for (let k = 0; k < 16; k++) { const g = 0.4 + R() * 0.15; T.pebble(R() * n, R() * n, 1.4 + R() * 2.4, [g, g * 0.93, g * 0.84], { h: 0.75, rim: 0.4 }); }
  // drying cracks on the raised (dry) parts
  const Wc = worley(n, 12, R, 0.9);
  for (let i = 0; i < n * n; i++) {
    const c = (1 - smooth(0.01, 0.045, Wc.e[i])) * smooth(0.05, 0.25, -pud[i]);
    if (c <= 0) continue;
    const k = 1 - 0.32 * c;
    T.r[i] *= k; T.g[i] *= k; T.b[i] *= k; T.h[i] -= c * 0.12;
  }
  // a few animal tracks pressed into the mud: deer hooves and bird feet
  for (let k = 0; k < 7; k++) {
    let x = R() * n, y = R() * n; const a = R() * 6.28;
    for (let s = 0; s < 4; s++) {
      x += Math.cos(a) * 9; y += Math.sin(a) * 9;
      const side = s & 1 ? 1 : -1, ox = Math.cos(a + 1.57) * side * 2.2, oy = Math.sin(a + 1.57) * side * 2.2;
      for (const d of [-0.8, 0.8]) T.disc(x + ox + Math.cos(a + 1.57) * d, y + oy + Math.sin(a + 1.57) * d, 0.9, [0.22, 0.17, 0.12], 0.55, -0.08);
    }
  }
  for (let k = 0; k < 6; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28;
    for (let s = 0; s < 3; s++) {
      const px = x + Math.cos(a) * s * 5, py = y + Math.sin(a) * s * 5;
      for (const d of [-0.5, 0, 0.5]) T.line(px, py, px + Math.cos(a + d) * 2.4, py + Math.sin(a + d) * 2.4, 0.32, [0.24, 0.18, 0.13], 0.6, 0.4);
    }
  }
  return T.bytes();
}

function stoneFloor(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.49, 0.47, 0.44], 0.5);
  T.mod(B.view('patch', 6, 3, 0.5, 200, 200), 0.09, null, 0.15);
  T.mod(B.view('grain', 96, 3, 0.6, 100, 100, true), 0.07, null, 0.05);
  // irregular fractured slabs (warped worley, thin cracks)
  const wx = B.view('mid', 16, 3, 0.55, 0, 0), wy = B.view('mid', 16, 3, 0.55, 256, 256);
  for (let i = 0; i < wx.length; i++) { wx[i] *= 22; wy[i] *= 22; }
  const W = worley(n, 9, R, 0.95, wx, wy);
  const { r, g, b, h } = T;
  for (let i = 0; i < n * n; i++) {
    const c = 1 - smooth(0.015, 0.05, W.e[i]);
    const idv = W.id[W.cell[i]];
    const k = (1 + (idv - 0.5) * 0.12) * (1 - 0.45 * c);
    r[i] *= k; g[i] *= k; b[i] *= k;
    h[i] += (idv - 0.5) * 0.2 - c * 0.3;
  }
  for (let k = 0; k < 2000; k++) T.disc(R() * n, R() * n, 0.6 + R() * 0.9, R() < 0.5 ? [0.34, 0.33, 0.32] : [0.62, 0.60, 0.57], 0.42);
  for (let k = 0; k < 70; k++) { const g2 = 0.45 + R() * 0.2; T.pebble(R() * n, R() * n, 1.5 + R() * 3, [g2, g2 * 0.98, g2 * 0.94], { h: 0.95 }); }
  return T.bytes();
}

function forestFloor(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.305, 0.245, 0.160], 0.4);
  T.mod(B.view('macro', 4, 3, 0.5, 450, 260), 0.07, [1, 1, 0.9]);
  T.mod(B.view('grain', 96, 3, 0.6, 33, 66), 0.08, null, 0.1);
  const mp = B.view('patch', 6, 3, 0.5, 333, 77), mg = B.view('mid', 16, 3, 0.55, 99, 400, true);
  const m = new Float32Array(n * n);
  for (let i = 0; i < m.length; i++) m[i] = smooth(0.05, 0.32, mp[i] + mg[i] * 0.2) * 0.8;
  T.paint(m, [0.305, 0.335, 0.165], 0.5, 0.4);
  const leafCols = [[0.47, 0.32, 0.16], [0.55, 0.38, 0.17], [0.40, 0.27, 0.15], [0.60, 0.46, 0.22], [0.34, 0.30, 0.17], [0.50, 0.28, 0.14], [0.36, 0.24, 0.13]];
  for (let k = 0; k < 1500; k++) {
    const x = R() * n, y = R() * n;
    if (mp[Math.floor(y) * n + Math.floor(x)] > 0.25 && R() < 0.75) continue;
    const c = leafCols[Math.floor(R() * leafCols.length)], v = 0.85 + R() * 0.25;
    const L = 2.6 + R() * 3.2;
    T.leaf(x, y, L, L * (0.38 + R() * 0.2), R() * Math.PI, [c[0] * v, c[1] * v, c[2] * v], 0.92);
  }
  for (let k = 0; k < 55; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, l = 8 + R() * 18;
    const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l;
    T.line(x + 0.8, y + 1, x1 + 0.8, y1 + 1, 0.9, [0.16, 0.12, 0.08], 0.35, 0.4);
    T.line(x, y, x1, y1, 0.75, [0.36, 0.26, 0.16], 0.95, 0.75);
    if (R() < 0.6) { const t = 0.3 + R() * 0.5, bx = x + (x1 - x) * t, by = y + (y1 - y) * t, b = a + (R() < 0.5 ? 0.7 : -0.7); T.line(bx, by, bx + Math.cos(b) * l * 0.35, by + Math.sin(b) * l * 0.35, 0.55, [0.34, 0.25, 0.15], 0.9, 0.7); }
  }
  for (let k = 0; k < 420; k++) {
    const x = R() * n, y = R() * n, a = R() * 6.28, l = 2.5 + R() * 3;
    T.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.4, R() < 0.5 ? [0.52, 0.38, 0.20] : [0.25, 0.20, 0.12], 0.75, 0.55);
  }
  for (let k = 0; k < 10; k++) { const g = 0.42 + R() * 0.15; T.pebble(R() * n, R() * n, 1.6 + R() * 2.4, [g * 0.95, g, g * 0.85], { h: 0.8 }); }
  // drifts of fallen needles, a few cones / acorns, bright moss cushions in the mossy patches
  const nd = B.view('mid', 16, 3, 0.55, 211, 377);
  for (let k = 0; k < 520; k++) {
    const x = R() * n, y = R() * n;
    if (nd[Math.floor(y) * n + Math.floor(x)] < 0.1) continue;
    const a = R() * 6.28;
    T.line(x, y, x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 0.3, R() < 0.5 ? [0.50, 0.34, 0.18] : [0.40, 0.27, 0.14], 0.85, 0.55);
  }
  for (let k = 0; k < 14; k++) T.pebble(R() * n, R() * n, 1.3 + R() * 0.8, R() < 0.5 ? [0.42, 0.28, 0.15] : [0.55, 0.42, 0.22], { h: 0.8, rim: 0.55, shadow: 0.35, flat: 0.2 });
  for (let k = 0; k < 240; k++) {
    const x = R() * n, y = R() * n;
    if (mp[Math.floor(y) * n + Math.floor(x)] < 0.1) continue;
    T.disc(x, y, 0.7 + R() * 1.1, R() < 0.5 ? [0.36, 0.44, 0.18] : [0.44, 0.52, 0.22], 0.7, 0.06);
  }
  return T.bytes();
}

// ---------------------------------------------------------------- rock tops (mountains from above)
// Faceted, fractured rock: two scales of warped Worley cells, each cell a tilted plane (height),
// cracks between cells. Albedo gets only light cavity darkening; the shader lights the height
// dynamically with the sun so facets catch the light.
function facets(T, n, B, rand, { big = 5, small = 13, crack = 0.4, tilt = 1, warp = 18, var1 = 0.12, smallK = 0.45 } = {}) {
  const wx = B.view('mid', 16, 3, 0.55, Math.floor(rand() * n), Math.floor(rand() * n));
  const wy = B.view('mid', 16, 3, 0.55, Math.floor(rand() * n), Math.floor(rand() * n), true);
  for (let i = 0; i < wx.length; i++) { wx[i] *= warp; wy[i] *= warp; }
  const A = worley(n, big, rand, 0.95, wx, wy);
  const S = worley(n, small, rand, 0.95, wx, wy);
  // per-cell tilt directions
  const tilts = (W) => { const c = new Float32Array(W.id.length), s = new Float32Array(W.id.length); for (let k = 0; k < W.id.length; k++) { c[k] = Math.cos(W.id[k] * 6.283); s[k] = Math.sin(W.id[k] * 6.283); } return [c, s]; };
  const [acx, asy] = tilts(A), [scx, ssy] = tilts(S);
  const cm = B.view('macro', 4, 3, 0.5, Math.floor(rand() * n), Math.floor(rand() * n), true); // partial crack mask
  const { r, g, b, h } = T;
  for (let i = 0; i < n * n; i++) {
    const ka = A.cell[i], ks = S.cell[i], ia = A.id[ka], is = S.id[ks];
    const pa = (acx[ka] * A.ox[i] + asy[ka] * A.oy[i]) * tilt;       // tilted slab
    const ps = (scx[ks] * S.ox[i] + ssy[ks] * S.oy[i]) * tilt;
    const dome = 1 - Math.min(1, (A.ox[i] * A.ox[i] + A.oy[i] * A.oy[i]) * 2.2);
    const lump = 1 - Math.min(1, (S.ox[i] * S.ox[i] + S.oy[i] * S.oy[i]) * 2.6);   // rubble
    const ea = A.e[i], es = S.e[i];
    const ca = ea < 0.045 ? (1 - smooth(0.0, 0.045, ea)) * smooth(-0.12, 0.12, cm[i]) : 0;  // crevices (not everywhere)
    const cs = es < 0.022 ? (1 - smooth(0.0, 0.022, es)) * smooth(0.0, 0.25, -cm[i]) : 0; // fine fractures (patchy)
    const ra = ea < 0.2 ? smooth(0.0, 0.2, ea) : 1;         // rounding / AO near crevices
    const hh = 0.36 + (ia - 0.5) * 0.26 + pa * 0.36 + dome * 0.16 + lump * 0.2 + ps * 0.1 * smallK - ca * 0.3 - cs * 0.08 * smallK;
    h[i] = h[i] * 0.25 + clamp(hh * (0.75 + 0.25 * ra), 0, 1) * 0.75;
    const k = (1 + (ia - 0.5) * var1 + (is - 0.5) * var1 * 0.6) * (1 - crack * ca - crack * 0.35 * cs * smallK) * (0.9 + 0.1 * ra) * (0.93 + 0.07 * lump);
    r[i] *= k; g[i] *= k; b[i] *= k;
  }
}

// lichen / weathering blotches on rock tops
function lichen(T, n, B, R, cols, amt) {
  const f = B.view('patch', 6, 3, 0.5, Math.floor(R() * n), Math.floor(R() * n), R() < 0.5);
  const fine = B.view('grain', 96, 3, 0.6, Math.floor(R() * n), Math.floor(R() * n));
  const m = new Float32Array(n * n);
  for (const c of cols) {
    const off = Math.floor(R() * n * n);
    for (let i = 0; i < m.length; i++) m[i] = smooth(0.28, 0.5, f[(i + off) % m.length] + fine[i] * 0.35) * amt;
    T.paint(m, c);
  }
}

function granite(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.53, 0.49, 0.475], 0.5);
  T.mod(B.view('macro', 4, 3, 0.5, 100, 300), 0.16, [1, 0.97, 0.95], 0.3);
  facets(T, n, B, R, { big: 3, small: 10, crack: 0.22, tilt: 1, var1: 0.1 });
  T.mod(B.view('grain', 96, 3, 0.6, 222, 111), 0.08, null, 0.05);
  lichen(T, n, B, R, [[0.50, 0.50, 0.40], [0.62, 0.55, 0.38]], 0.35);
  for (let k = 0; k < 3600; k++) {
    const t = R();
    const c = t < 0.4 ? [0.25, 0.24, 0.25] : t < 0.72 ? [0.78, 0.75, 0.72] : [0.70, 0.50, 0.44];
    T.disc(R() * n, R() * n, 1.2 + R() * 1.8, c, 0.35 + R() * 0.3);
  }
  return T.bytes();
}

function limestone(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.63, 0.595, 0.515], 0.5);
  T.mod(B.view('macro', 4, 3, 0.5, 300, 10, true), 0.08, [1, 0.98, 0.94], 0.3);
  T.mod(anisoField(n, 2, 12, 3, 0.5, R), 0.05, null, 0.1);
  facets(T, n, B, R, { big: 3, small: 9, crack: 0.2, tilt: 0.85, smallK: 0.35, var1: 0.08 });
  lichen(T, n, B, R, [[0.58, 0.58, 0.44], [0.55, 0.50, 0.40]], 0.35);
  T.mod(B.view('grain', 96, 3, 0.6, 12, 345), 0.05);
  for (let k = 0; k < 420; k++) {
    const x = R() * n, y = R() * n, r = 0.8 + R() * 2.2;
    T.disc(x + 0.6, y + 0.7, r * 1.1, [0.70, 0.66, 0.56], 0.3);
    T.disc(x, y, r, [0.48, 0.44, 0.36], 0.5, -0.15);
  }
  for (let k = 0; k < 1600; k++) T.disc(R() * n, R() * n, 0.6 + R() * 0.8, R() < 0.5 ? [0.74, 0.70, 0.60] : [0.55, 0.50, 0.41], 0.4);
  return T.bytes();
}

function slate(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.335, 0.350, 0.385], 0.5);
  T.mod(B.view('macro', 4, 3, 0.5, 20, 220), 0.09, [1, 1, 1.03], 0.3);
  const st = anisoField(n, 3, 26, 3, 0.55, R);
  const { r, g, b, h } = T;
  for (let i = 0; i < n * n; i++) {
    const v = st[i], ridge = smooth(0.75, 0.95, 1 - Math.abs(v) * 2.2);
    const k = 1 + v * 0.10 - ridge * 0.2;
    r[i] *= k; g[i] *= k; b[i] *= k; h[i] += v * 0.3 - ridge * 0.12;
  }
  facets(T, n, B, R, { big: 4, small: 12, crack: 0.22, tilt: 1.1, warp: 10, var1: 0.1 });
  lichen(T, n, B, R, [[0.36, 0.40, 0.36]], 0.3);
  T.mod(B.view('grain', 96, 3, 0.6, 444, 44, true), 0.06);
  for (let k = 0; k < 1500; k++) T.disc(R() * n, R() * n, 0.6 + R() * 0.8, R() < 0.5 ? [0.25, 0.26, 0.29] : [0.45, 0.47, 0.51], 0.4);
  return T.bytes();
}

function marble(n, B, seed) {
  const T = new Tex(n, seed), R = T.rand;
  T.fill([0.74, 0.735, 0.71], 0.5);
  T.mod(B.view('macro', 4, 3, 0.5, 256, 0), 0.06, null, 0.25);
  const w1 = B.view('patch', 6, 3, 0.5, 50, 50), w2 = B.view('macro', 4, 3, 0.5, 0, 256, true);
  const { r, g, b, h } = T;
  const K1 = (Math.PI * 2 * 2) / n, K2 = (Math.PI * 2 * 3) / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const vein = 1 - smooth(0.0, 0.09, Math.abs(Math.sin((x + y) * K1 + w1[i] * 9)));
    const vein2 = 1 - smooth(0.0, 0.05, Math.abs(Math.sin((x - y) * K2 + w2[i] * 8)));
    const k = 1 - vein * 0.32 - vein2 * 0.18;
    r[i] *= k; g[i] *= k * 1.005; b[i] *= k * 1.02;
    h[i] -= vein * 0.08;
  }
  facets(T, n, B, R, { big: 3, small: 9, crack: 0.16, tilt: 0.8, var1: 0.05, smallK: 0.3 });
  lichen(T, n, B, R, [[0.74, 0.74, 0.66]], 0.3);
  T.mod(B.view('grain', 96, 3, 0.6, 99, 199), 0.03);
  return T.bytes();
}

const times = [];
export const _layerTimes = () => times.map((t) => t.toFixed(0)).join(' ');
export const texStats = { ms: 0, cached: false };

// ---------------------------------------------------------------- IndexedDB cache
// Generation is deterministic, so the layers are cached per browser. The key hashes the source of
// every generator function: editing any of them invalidates the cache automatically.
// The read starts when this module is imported (main.js generates the world first, so it is
// usually ready in time); the write happens a few seconds after boot.
const DB = 'wos-cache', STORE = 'terrain';
function srcHash() {
  const fns = [fade, addOctave, fbmField, anisoField, worley, smooth, Bank, Tex, soil, sand, gravel, marsh, mud, stoneFloor,
    forestFloor, facets, lichen, granite, limestone, slate, marble, generateGroundTextures];
  let h = 2166136261 >>> 0;
  const str = fns.map((f) => f.toString()).join('|') + TEX + LX + LY + LZ;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 'v1-' + h.toString(36);
}
let cacheKey = null, cacheHit = null;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
try {
  if (typeof indexedDB !== 'undefined' && typeof window !== 'undefined') {
    cacheKey = srcHash();
    openDB().then((db) => {
      const g = db.transaction(STORE, 'readonly').objectStore(STORE).get('layers');
      g.onsuccess = () => {
        const v = g.result;
        if (v && v.key === cacheKey && v.layers && v.layers.length === 12 && v.layers.every((l) => l.length === TEX * TEX * 4)) cacheHit = v.layers;
        db.close();
      };
      g.onerror = () => db.close();
    }).catch(() => {});
  }
} catch { /* no cache */ }

function storeCache(layers) {
  if (!cacheKey) return;
  setTimeout(() => {
    openDB().then((db) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key: cacheKey, layers }, 'layers');
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    }).catch(() => {});
  }, 4000);
}

export function generateGroundTextures() {
  const t00 = performance.now();
  if (cacheHit) {
    const c = cacheHit;
    cacheHit = null;
    texStats.ms = performance.now() - t00; texStats.cached = true;
    return c;
  }
  const n = TEX, S = 9173;
  const B = new Bank(n, 4242);
  const gens = [
    () => soil(n, B, S + 1, false),   // 0 soil
    () => soil(n, B, S + 2, true),    // 1 rich soil
    () => sand(n, B, S + 3),          // 2 sand
    () => gravel(n, B, S + 4),        // 3 gravel
    () => marsh(n, B, S + 5),         // 4 marsh
    () => mud(n, B, S + 6),           // 5 mud
    () => stoneFloor(n, B, S + 7),    // 6 rough stone
    () => forestFloor(n, B, S + 8),   // 7 forest floor
    () => granite(n, B, S + 11),      // 8 granite
    () => limestone(n, B, S + 12),    // 9 limestone
    () => slate(n, B, S + 13),        // 10 slate
    () => marble(n, B, S + 14),       // 11 marble
  ];
  times.length = 0;
  const layers = gens.map((g) => { const t0 = performance.now(); const r = g(); times.push(performance.now() - t0); return r; });
  texStats.ms = performance.now() - t00; texStats.cached = false;
  storeCache(layers);
  return layers;
}

// Shader noise: RGBA tileable, each channel a different frequency (R 4, G 8, B 16, A 12 cells).
export function generateNoiseTexture(seed = 7, n = 256) {
  const out = new Uint8Array(n * n * 4);
  const rand = mulberry32(seed * 977 + 13);
  const cells = [4, 8, 16, 12], octs = [4, 4, 4, 3];
  for (let c = 0; c < 4; c++) {
    const f = fbmField(n, cells[c], octs[c], 0.5, rand);
    for (let i = 0; i < n * n; i++) out[i * 4 + c] = clamp((0.5 + f[i] * 0.75) * 255, 0, 255);
  }
  return out;
}

export const _noise = { fbmField, worley };
