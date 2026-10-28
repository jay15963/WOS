// Procedural tileable ground/rock textures (RGBA Uint8Array, TEX x TEX) + shader noise texture.
// Layers 0..7 = ground ids (see worldgen G), 8..11 = rock types (granite, limestone, slate, marble).

import { makePerlin, fbm, mulberry32, clamp } from '../engine/noise.js';

export const TEX = 256;

class Tex {
  constructor(size, seed) {
    this.n = size;
    this.r = new Float32Array(size * size);
    this.g = new Float32Array(size * size);
    this.b = new Float32Array(size * size);
    this.rand = mulberry32(seed);
    this.perlin = makePerlin(seed);
  }
  // per-pixel noise mix between two colors
  noise(c0, c1, cells, oct = 4, contrast = 1, gain = 0.5) {
    const n = this.n, P = this.perlin;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = fbm(P, (x / n) * cells, (y / n) * cells, oct, 2, gain, cells);
      v = clamp(0.5 + v * contrast, 0, 1);
      const i = y * n + x;
      this.r[i] = c0[0] + (c1[0] - c0[0]) * v;
      this.g[i] = c0[1] + (c1[1] - c0[1]) * v;
      this.b[i] = c0[2] + (c1[2] - c0[2]) * v;
    }
    return this;
  }
  // multiply by noise (brightness variation)
  modulate(cells, amount, oct = 3, seedOff = 0) {
    const n = this.n, P = makePerlin(Math.floor(this.rand() * 1e9) + seedOff);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = fbm(P, (x / n) * cells, (y / n) * cells, oct, 2, 0.5, cells);
      const m = 1 + v * amount;
      const i = y * n + x;
      this.r[i] *= m; this.g[i] *= m; this.b[i] *= m;
    }
    return this;
  }
  // soft disc stamp with wrap-around (pebbles, grains, clumps)
  stamp(cx, cy, rad, col, alpha = 1, soft = 0.5, shade = 0) {
    const n = this.n, R = Math.ceil(rad + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / rad;
      if (d > 1) continue;
      let a = alpha * clamp((1 - d) / Math.max(soft, 0.001), 0, 1);
      const x = ((Math.round(cx) + dx) % n + n) % n, y = ((Math.round(cy) + dy) % n + n) % n;
      const i = y * n + x;
      // top-left lit, bottom-right shaded
      const l = shade ? 1 + shade * (-(dx + dy) / (rad * 1.4)) : 1;
      this.r[i] += (col[0] * l - this.r[i]) * a;
      this.g[i] += (col[1] * l - this.g[i]) * a;
      this.b[i] += (col[2] * l - this.b[i]) * a;
    }
  }
  scatter(count, rmin, rmax, colFn, alpha = 1, soft = 0.4, shade = 0.25) {
    for (let k = 0; k < count; k++) {
      const x = this.rand() * this.n, y = this.rand() * this.n;
      const r = rmin + this.rand() * (rmax - rmin);
      this.stamp(x, y, r, colFn(this.rand()), alpha, soft, shade);
    }
    return this;
  }
  bytes() {
    const n = this.n, out = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      out[i * 4] = clamp(this.r[i] * 255, 0, 255);
      out[i * 4 + 1] = clamp(this.g[i] * 255, 0, 255);
      out[i * 4 + 2] = clamp(this.b[i] * 255, 0, 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}

const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function generateGroundTextures(seed = 1) {
  const layers = [];
  const T = (s) => new Tex(TEX, seed * 31 + s);

  // 0 soil
  layers.push(T(1).noise([0.36, 0.28, 0.19], [0.50, 0.40, 0.28], 6, 5, 1.3)
    .modulate(16, 0.10)
    .scatter(260, 1.2, 3.2, (r) => mixc([0.30, 0.23, 0.16], [0.42, 0.33, 0.24], r), 0.6, 0.7, 0.3)
    .scatter(120, 0.8, 1.8, (r) => mixc([0.55, 0.50, 0.42], [0.62, 0.58, 0.50], r), 0.7, 0.4, 0.4)
    .bytes());
  // 1 rich soil
  layers.push(T(2).noise([0.22, 0.16, 0.11], [0.34, 0.25, 0.17], 6, 5, 1.3)
    .modulate(20, 0.12)
    .scatter(300, 1.0, 3.0, (r) => mixc([0.17, 0.12, 0.08], [0.27, 0.20, 0.13], r), 0.6, 0.7, 0.3)
    .bytes());
  // 2 sand
  layers.push(T(3).noise([0.72, 0.62, 0.44], [0.84, 0.75, 0.56], 5, 4, 1.0)
    .modulate(40, 0.05, 2)
    .scatter(900, 0.5, 1.0, (r) => mixc([0.62, 0.53, 0.38], [0.90, 0.84, 0.68], r), 0.5, 0.6, 0)
    .scatter(30, 1.2, 2.2, () => [0.70, 0.66, 0.58], 0.8, 0.35, 0.4)
    .bytes());
  // 3 gravel
  layers.push(T(4).noise([0.40, 0.37, 0.33], [0.52, 0.49, 0.44], 6, 4, 1.0)
    .scatter(700, 1.2, 3.4, (r) => mixc([0.42, 0.40, 0.37], [0.70, 0.67, 0.62], r), 0.95, 0.25, 0.45)
    .scatter(300, 0.8, 1.6, (r) => mixc([0.30, 0.28, 0.26], [0.50, 0.46, 0.40], r), 0.9, 0.3, 0.3)
    .bytes());
  // 4 marsh
  layers.push(T(5).noise([0.20, 0.21, 0.14], [0.33, 0.33, 0.21], 5, 5, 1.5)
    .modulate(10, 0.18)
    .scatter(120, 3, 9, () => [0.16, 0.19, 0.16], 0.45, 0.9, 0)
    .scatter(200, 0.8, 1.6, (r) => mixc([0.38, 0.40, 0.25], [0.46, 0.46, 0.30], r), 0.6, 0.6, 0)
    .bytes());
  // 5 mud
  layers.push(T(6).noise([0.27, 0.21, 0.15], [0.39, 0.31, 0.22], 4, 5, 1.2)
    .modulate(12, 0.12)
    .scatter(80, 3, 8, () => [0.24, 0.19, 0.14], 0.4, 0.9, 0)
    .bytes());
  // 6 rough stone floor
  layers.push(T(7).noise([0.40, 0.39, 0.37], [0.55, 0.54, 0.51], 6, 5, 1.1)
    .scatter(160, 1.0, 2.6, (r) => mixc([0.34, 0.33, 0.32], [0.60, 0.59, 0.56], r), 0.7, 0.35, 0.35)
    .bytes());
  // 7 forest floor (moss + leaf litter)
  layers.push(T(8).noise([0.24, 0.22, 0.13], [0.36, 0.33, 0.19], 6, 5, 1.3)
    .modulate(18, 0.12)
    .scatter(500, 0.9, 2.0, (r) => r < 0.5 ? mixc([0.45, 0.30, 0.15], [0.55, 0.38, 0.18], r * 2) : mixc([0.28, 0.33, 0.16], [0.36, 0.40, 0.20], r * 2 - 1), 0.7, 0.5, 0.2)
    .bytes());

  // rocks
  // 8 granite
  layers.push(T(11).noise([0.44, 0.40, 0.39], [0.58, 0.53, 0.51], 8, 5, 1.0)
    .scatter(1400, 0.5, 1.3, (r) => r < 0.5 ? [0.30, 0.27, 0.27] : [0.70, 0.60, 0.57], 0.7, 0.5, 0)
    .bytes());
  // 9 limestone
  layers.push(T(12).noise([0.56, 0.52, 0.43], [0.70, 0.66, 0.56], 6, 5, 1.0)
    .modulate(24, 0.07)
    .scatter(200, 1.0, 2.5, () => [0.52, 0.48, 0.40], 0.5, 0.8, 0)
    .bytes());
  // 10 slate
  layers.push(T(13).noise([0.27, 0.28, 0.30], [0.40, 0.41, 0.44], 7, 5, 1.0)
    .modulate(30, 0.08)
    .bytes());
  // 11 marble
  layers.push(T(14).noise([0.70, 0.69, 0.66], [0.84, 0.83, 0.80], 5, 5, 0.9)
    .modulate(12, 0.05)
    .bytes());

  return layers;
}

// Shader noise: RGBA tileable, each channel a different frequency.
export function generateNoiseTexture(seed = 7, n = 256) {
  const out = new Uint8Array(n * n * 4);
  const P = [makePerlin(seed), makePerlin(seed + 1), makePerlin(seed + 2), makePerlin(seed + 3)];
  const cells = [4, 8, 16, 12];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    for (let c = 0; c < 4; c++) {
      const v = fbm(P[c], (x / n) * cells[c], (y / n) * cells[c], c === 3 ? 3 : 4, 2, 0.5, cells[c]);
      out[i + c] = clamp((0.5 + v * 0.75) * 255, 0, 255);
    }
  }
  return out;
}
