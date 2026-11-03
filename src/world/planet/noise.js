// Deterministic noise for the planet: integer hashes + gradient noise that wraps around the planet in x.
// Only + - * / Math.floor / Math.sqrt / Math.imul are used, so every browser computes the same bits
// (no Math.sin / exp / pow / random).

import { W } from './consts.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smoothstep = (a, b, x) => smooth01((x - a) / (b - a));

// 32-bit integer hash of (x, y, s) -> uint32
export function ihash(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((s | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
// hash -> [0, 1)
export const hash01 = (x, y, s) => ihash(x, y, s) / 4294967296;

// sequential RNG (same as engine/noise.js mulberry32)
export function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 16 unit gradients (exact literals: cos / sin of k * 22.5 deg)
const C1 = 0.9238795325112867, C2 = 0.7071067811865476, C3 = 0.3826834323650898;
const GX = new Float64Array([1, C1, C2, C3, 0, -C3, -C2, -C1, -1, -C1, -C2, -C3, 0, C3, C2, C1]);
const GY = new Float64Array([0, C3, C2, C1, 1, C1, C2, C3, 0, -C3, -C2, -C1, -1, -C1, -C2, -C3]);

// 2D gradient noise ~[-1, 1]. px = period in lattice units along x (0 = none). Lattice hashing (no table):
// no repetition anywhere on the planet.
export function gnoise(x, y, seed, px) {
  const fx0 = Math.floor(x), fy0 = Math.floor(y);
  const fx = x - fx0, fy = y - fy0;
  let x0 = fx0, x1 = fx0 + 1;
  if (px) { x0 = ((x0 % px) + px) % px; x1 = x0 + 1 === px ? 0 : x0 + 1; }
  const y1 = fy0 + 1;
  const a = ihash(x0, fy0, seed) & 15, b = ihash(x1, fy0, seed) & 15;
  const c = ihash(x0, y1, seed) & 15, d = ihash(x1, y1, seed) & 15;
  const n00 = GX[a] * fx + GY[a] * fy, n10 = GX[b] * (fx - 1) + GY[b] * fy;
  const n01 = GX[c] * fx + GY[c] * (fy - 1), n11 = GX[d] * (fx - 1) + GY[d] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.414;
}

// fBm in TILE coordinates that wraps around the planet: `lambda` = base wavelength in tiles (a power of two
// <= W), octaves halve it. ~[-1, 1].
export function fbm(x, y, seed, lambda, oct = 4, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1 / lambda, per = W / lambda;
  for (let o = 0; o < oct; o++) {
    sum += amp * gnoise(x * f, y * f, seed + o * 7919, per >= 1 ? per : 0);
    norm += amp; amp *= gain; f *= 2; per *= 2;
  }
  return sum / norm;
}

// ridged multifractal ~[0, 1] (sharp crests at 1): mountain ridges
export function ridged(x, y, seed, lambda, oct = 4, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1 / lambda, per = W / lambda, w = 1;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(gnoise(x * f, y * f, seed + o * 7919, per >= 1 ? per : 0));
    n *= n;
    sum += amp * n * w;
    norm += amp;
    w = clamp(n * 1.6, 0, 1);
    amp *= gain; f *= 2; per *= 2;
  }
  return sum / norm;
}

// shortest signed x difference on the wrapping planet (tiles)
export const dxWrap = (a, b) => { let d = b - a; if (d > W / 2) d -= W; else if (d < -W / 2) d += W; return d; };

// Binary min-heap of (key, index) with a deterministic tie-break on the index.
export class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2), v2 = new Int32Array(this.k.length * 2);
      k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] < key || (K[p] === key && V[p] < val)) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  // pops the minimum; returns the index (key in this.lastKey)
  pop() {
    const K = this.k, V = this.v;
    const topV = V[0];
    this.lastKey = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (K[c + 1] < K[c] || (K[c + 1] === K[c] && V[c + 1] < V[c]))) c++;
        if (K[c] > key || (K[c] === key && V[c] > val)) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return topV;
  }
}
