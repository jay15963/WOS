// Macro grid helpers (MW x MH cells, x wraps): neighbours, distance fields, blur, Dijkstra growth.

import { MW, MH, CELL } from './consts.js';
import { Heap } from './noise.js';

export const N = MW * MH;
export const SQ2 = 1.4142135623730951;
// 8 neighbours: dx, dy, step length (cells)
export const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
export const DL8 = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];

export const cxOf = (i) => i % MW;
export const cyOf = (i) => (i - (i % MW)) / MW;
// tile coords of a cell centre
export const tileX = (i) => (i % MW) * CELL + CELL / 2;
export const tileY = (i) => ((i - (i % MW)) / MW) * CELL + CELL / 2;
// neighbour k of cell i, or -1 past the poles
export function nb(i, k) {
  const x = i % MW, y = (i - x) / MW;
  const ny = y + DY8[k];
  if (ny < 0 || ny >= MH) return -1;
  let nx = x + DX8[k];
  if (nx < 0) nx += MW; else if (nx >= MW) nx -= MW;
  return ny * MW + nx;
}
// precomputed neighbour table (N * 8, -1 outside)
let NBT = null;
export function nbTable() {
  if (NBT) return NBT;
  NBT = new Int32Array(N * 8);
  for (let i = 0; i < N; i++) for (let k = 0; k < 8; k++) NBT[i * 8 + k] = nb(i, k);
  return NBT;
}
// wrapped cell distance (cells, Euclidean)
export function cellDist(a, b) {
  let dx = Math.abs(cxOf(a) - cxOf(b));
  if (dx > MW / 2) dx = MW - dx;
  const dy = cyOf(a) - cyOf(b);
  return Math.sqrt(dx * dx + dy * dy);
}

// Distance (cells, 8-neighbour Dijkstra) from every cell to the nearest source cell; `cap` stops early.
// Returns Float32Array (Infinity-like 1e9 past cap). `src` (optional Int32Array) receives the source index.
export function distField(isSource, cap = 1e9, src = null) {
  const T = nbTable();
  const d = new Float64Array(N).fill(1e9);
  const h = new Heap(4096);
  for (let i = 0; i < N; i++) if (isSource(i)) { d[i] = 0; h.push(0, i); if (src) src[i] = i; }
  while (h.n) {
    const i = h.pop(), di = h.lastKey;
    if (di > d[i] || di > cap) continue;
    for (let k = 0; k < 8; k++) {
      const j = T[i * 8 + k];
      if (j < 0) continue;
      const nd = di + DL8[k];
      if (nd < d[j]) { d[j] = nd; if (src) src[j] = src[i]; h.push(nd, j); }
    }
  }
  return Float32Array.from(d);
}

// Box blur with x wrap and y clamp (radius r cells), returns a new Float32Array.
export function blur(a, r) {
  const tmp = new Float32Array(N), out = new Float32Array(N), inv = 1 / (2 * r + 1);
  for (let y = 0; y < MH; y++) {
    const row = y * MW;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += a[row + ((k + MW) % MW)];
    for (let x = 0; x < MW; x++) {
      tmp[row + x] = acc * inv;
      acc += a[row + ((x + r + 1) % MW)] - a[row + ((x - r + MW) % MW)];
    }
  }
  for (let x = 0; x < MW; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(MH - 1, Math.max(0, k)) * MW + x];
    for (let y = 0; y < MH; y++) {
      out[y * MW + x] = acc * inv;
      acc += tmp[Math.min(MH - 1, y + r + 1) * MW + x] - tmp[Math.max(0, y - r) * MW + x];
    }
  }
  return out;
}

// Multi-source region growth (noisy Dijkstra). seeds: [{cell, id, ...}], cost(fromCell, toCell, k, seedIdx)
// returns the step cost (Infinity = blocked). limit(seedIdx, count) -> true stops that region. Returns
// Int16Array owner (-1 unclaimed).
export function growRegions(seeds, cost, limit = null) {
  const T = nbTable();
  const owner = new Int16Array(N).fill(-1);
  const best = new Float64Array(N).fill(Infinity);
  const count = new Int32Array(seeds.length);
  const h = new Heap(8192);
  const tag = new Int16Array(N).fill(-1); // seed that pushed the best key
  seeds.forEach((s, k) => { best[s.cell] = 0; tag[s.cell] = k; h.push(0, s.cell); });
  while (h.n) {
    const i = h.pop(), di = h.lastKey;
    if (owner[i] >= 0 || di > best[i]) continue;
    const k = tag[i];
    if (limit && limit(k, count[k])) continue;
    owner[i] = k; count[k]++;
    for (let q = 0; q < 8; q++) {
      const j = T[i * 8 + q];
      if (j < 0 || owner[j] >= 0) continue;
      const c = cost(i, j, q, k);
      if (!(c < Infinity)) continue;
      const nd = di + c;
      if (nd < best[j]) { best[j] = nd; tag[j] = k; h.push(nd, j); }
    }
  }
  return owner;
}
