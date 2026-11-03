// Synthetic planet source (docs/STREAMING.md): a cheap, pure function of (seed, x, y) for the whole 16384 × 8192 planet —
// continents of periodic value noise (seamless across the x seam, which always lies in a wide ocean), polar seas, ridge
// mountains, biomes by latitude / height / moisture, trees and plants by biome. It exists to stress the streaming
// engine (walking / sailing / teleporting across the planet, many chunks, the seam); the real planet generator
// (src/world/planet, agent P) plugs in through the same source contract (source.js).
// Runs on the main thread (synchronous fallback) and in src/world/chunkWorker.js.

import { hash2 } from '../engine/noise.js';
import { G, BIOME_ID, treeSpecies, bushSpecies, boulderMossy } from './worldgen.js';
import { PW, PH, CS, CT, CW } from './store.js';

const B = BIOME_ID;
export const SYNTH_ID0 = 1e7, SYNTH_IDS = 8192; // natural object ids: SYNTH_ID0 + chunk * SYNTH_IDS + k (chunk from the id)
const SEAM = 900; // tiles of forced ocean on each side of the x seam

// periodic value noise: lattice cell s tiles, x period PW (seamless across the seam)
function vnoise(x, y, s, seed) {
  const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), P = PW / s;
  let u = fx - ix, v = fy - iy;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const x0 = ((ix % P) + P) % P, x1 = (x0 + 1) % P;
  const a = hash2(x0, iy, seed), b = hash2(x1, iy, seed), c = hash2(x0, iy + 1, seed), d = hash2(x1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s0, oct, seed) {
  let a = 1, s = s0, sum = 0, n = 0;
  for (let k = 0; k < oct; k++) { sum += a * (vnoise(x, y, s, seed + k * 101) * 2 - 1); n += a; a *= 0.5; s /= 2; }
  return sum / n;
}

// pure per-tile fields
export function elevation(seed, x, y) {
  let e = fbm(x, y, 2048, 6, seed + 11) * 1.25 + 0.04;
  const d = Math.abs(((x % PW) + PW) % PW > PW / 2 ? (((x % PW) + PW) % PW) - PW : ((x % PW) + PW) % PW); // distance to the seam
  if (d < SEAM) e -= (1 - d / SEAM) ** 2 * 1.4;
  const lat = Math.abs(y / PH - 0.5);
  if (lat > 0.42) e -= (lat - 0.42) * 7;
  return e;
}
const ridge = (seed, x, y) => 1 - Math.abs(fbm(x, y, 384, 3, seed + 777));
const moisture = (seed, x, y) => vnoise(x, y, 640, seed + 33) * 0.7 + vnoise(x, y, 96, seed + 34) * 0.3;
const temperature = (y, e) => 1 - 2 * Math.abs(y / PH - 0.5) - Math.max(0, e) * 0.45;
const isRockAt = (seed, x, y, e) => e > 0.2 && ridge(seed, x, y) > 0.8 - (e - 0.2) * 0.5;
const waterOf = (e) => (e >= 0 ? 0 : e > -0.035 ? 1 : e > -0.25 ? 2 : 3);

// one chunk: layers + natural objects (+ decor when asked)
export function synthChunk(seed, cx, cy, { decor = true } = {}) {
  const M = 10, DW = CS + 2 * M, x0 = cx * CS - M, y0 = cy * CS - M, N = DW * DW;
  const rock = new Uint8Array(N), wat = new Uint8Array(N), elev = new Float32Array(N);
  for (let y = 0; y < DW; y++) {
    const Y = y0 + y;
    for (let x = 0; x < DW; x++) {
      const X = x0 + x, j = y * DW + x;
      if (Y < 0 || Y >= PH) { wat[j] = 3; elev[j] = -1; continue; }
      const e = elevation(seed, X, Y);
      elev[j] = e;
      wat[j] = waterOf(e);
      rock[j] = !wat[j] && isRockAt(seed, X, Y, e) ? 1 : 0;
    }
  }
  const dW = new Float32Array(N), dR = new Float32Array(N);
  for (let j = 0; j < N; j++) { dW[j] = wat[j] ? 0 : 99; dR[j] = rock[j] ? 0 : 99; }
  chamfer(dW, DW, DW); chamfer(dR, DW, DW);
  const d = {
    cx, cy, ground: new Uint8Array(CT), water: new Uint8Array(CT), rock: new Uint8Array(CT), rockType: new Uint8Array(CT), ore: new Uint8Array(CT),
    roof: new Uint8Array(CT), tramp: new Uint8Array(CT), biome: new Uint8Array(CT), fertile: new Uint8Array(CT),
    lush: new Float32Array(CT), flowX: new Float32Array(CT), flowY: new Float32Array(CT), dWater: new Float32Array(CT), dRock: new Float32Array(CT),
    objects: [], decor: decor ? [] : null,
  };
  for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) {
    const X = cx * CS + lx, Y = cy * CS + ly, j = (ly + M) * DW + lx + M, l = ly * CS + lx, e = elev[j];
    d.water[l] = wat[j]; d.rock[l] = rock[j];
    d.dWater[l] = Math.min(9, dW[j]); d.dRock[l] = Math.min(9, dR[j]);
    d.rockType[l] = 1 + Math.min(3, Math.floor(vnoise(X, Y, 300, seed + 55) * 4));
    if (rock[j]) {
      // roof: the rock is ≥ 2 tiles deep (all 5 × 5 around is rock)
      let deep = 1;
      for (let dy = -2; dy <= 2 && deep; dy++) for (let dx = -2; dx <= 2; dx++) if (!rock[j + dy * DW + dx]) { deep = 0; break; }
      d.roof[l] = deep;
      d.biome[l] = B.MOUNTAIN; d.ground[l] = G.STONE;
      const on = vnoise(X, Y, 9, seed + 91);
      if (on > 0.86) { const h = hash2(X >> 3, Y >> 3, seed + 92); d.ore[l] = dR[j] === 0 && h < 0.35 ? 3 : h < 0.65 ? 1 : h < 0.88 ? 2 : h < 0.96 ? 4 : 5; }
      continue;
    }
    if (wat[j]) { d.biome[l] = B.WATER; d.ground[l] = wat[j] === 1 ? G.SAND : G.MUD; d.lush[l] = 0; continue; }
    const t = temperature(Y, e), m = moisture(seed, X, Y);
    let b;
    if (dW[j] < 2.2) b = B.SHORE;
    else if (dR[j] < 3) b = B.ROCKY;
    else if (m > 0.8 && e < 0.08) b = B.MARSH;
    else if (t < 0.36) b = B.PINE;
    else if (t < 0.52 && m > 0.45) b = B.BIRCH;
    else if (m > 0.55) b = B.FOREST;
    else b = B.MEADOW;
    d.biome[l] = b;
    d.ground[l] = b === B.SHORE ? G.SAND : b === B.ROCKY ? G.GRAVEL : b === B.MARSH ? (m > 0.9 ? G.MUD : G.MARSH) : b === B.PINE ? (hash2(X, Y, seed + 7) < 0.4 ? G.MOSS : G.SOIL) : b === B.FOREST && m > 0.7 ? G.RICH : G.SOIL;
    d.lush[l] = Math.max(0, Math.min(1, 0.25 + m * 0.6 + (vnoise(X, Y, 24, seed + 61) - 0.5) * 0.5 - (b === B.SHORE ? 0.3 : 0)));
  }
  // natural objects (ids from the chunk: the same on every peer)
  const c = cy * CW + cx;
  let k = 0;
  const id = () => SYNTH_ID0 + c * SYNTH_IDS + (k++);
  const view = { seed, idx: (x, y) => ((y - cy * CS) * CS + (x - cx * CS)), biome: { get: (i) => d.biome[i] }, dWater: { get: (i) => d.dWater[i] }, dRock: { get: (i) => d.dRock[i] }, ground: { get: (i) => d.ground[i] } };
  const taken = new Uint8Array(CT); // (tiles holding a plant)
  for (let ly = 1; ly < CS - 1; ly++) for (let lx = 1; lx < CS - 1; lx++) {
    const l = ly * CS + lx;
    if (d.rock[l] || d.water[l] || k >= SYNTH_IDS - 8) continue;
    const X = cx * CS + lx, Y = cy * CS + ly, b = d.biome[l], r = hash2(X, Y, seed + 101);
    let pTree = b === B.FOREST || b === B.BIRCH || b === B.PINE ? 0.22 : b === B.MEADOW ? 0.008 : b === B.MARSH ? 0.03 : b === B.ROCKY ? 0.02 : 0;
    if (d.dWater[l] < 1.5) pTree *= 0.25;
    if (r < pTree && !taken[l - 1] && !taken[l - CS] && !taken[l - CS - 1] && !taken[l - CS + 1]) {
      const kind = b === B.PINE || (b === B.ROCKY && r < 0.012) ? 'tree_pine' : b === B.BIRCH ? (r < 0.15 ? 'tree_oak' : 'tree_birch') : b === B.MARSH ? (r < 0.012 ? 'tree_dead' : 'tree_birch') : 'tree_oak';
      const sp = treeSpecies(view, kind, X, Y, hash2(X, Y, seed + 9));
      d.objects.push({ id: id(), type: kind, v: sp * 16 + Math.floor(hash2(X, Y, seed + 5) * 16), x: X + 0.5 + (hash2(X, Y, seed + 3) - 0.5) * 0.55, y: Y + 0.6 + (hash2(X, Y, seed + 4) - 0.5) * 0.4, s: 0.85 + (b === B.MEADOW ? 0.15 : 0) + hash2(X, Y, seed + 6) * 0.35, f: hash2(X, Y, seed + 7) < 0.5 ? -1 : 1, age: 1 });
      taken[l] = 1;
      continue;
    }
    const r2 = hash2(X, Y, seed + 202), fert = b === B.MEADOW || b === B.FOREST || b === B.BIRCH || b === B.PINE;
    const at = (type, v, s) => { d.objects.push({ id: id(), type, v, x: X + 0.5 + (r2 - 0.5) * 0.4, y: Y + 0.6, s, f: r2 < 0.5 ? -1 : 1 }); taken[l] = 2; };
    if (fert && r2 < 0.004) { at('berrybush', Math.floor(r2 * 1e5) % 1000, 0.8 + r * 0.35); continue; }
    if (fert && r2 < 0.022) { at('bush', bushSpecies(view, X, Y, hash2(X, Y, seed + 207)) * 1000 + Math.floor(r * 1000), 0.75 + r * 0.45); continue; }
    if ((b === B.FOREST || b === B.BIRCH) && r2 < 0.026) { at('herbbush', Math.floor(r * 1000), 0.8 + r * 0.6); continue; }
    const r3 = hash2(X, Y, seed + 303);
    if (r3 < (b === B.ROCKY ? 0.05 : d.dRock[l] < 5 ? 0.015 : 0.002)) { d.objects.push({ id: id(), type: 'boulder', v: (boulderMossy(view, X, Y) ? 8000 : 0) + Math.floor(r3 * 7919 * 100) % 7919, x: X + 0.5, y: Y + 0.6, s: 0.6 + r * 0.55, f: r < 0.5 ? -1 : 1 }); taken[l] = 3; continue; }
    const r4 = hash2(X, Y, seed + 404);
    if (r4 < (b === B.SHORE || b === B.ROCKY ? 0.016 : 0.006)) { d.objects.push({ id: id(), type: 'pebble', v: Math.floor(r * 4), x: X + 0.2 + r * 0.6, y: Y + 0.3 + r2 * 0.5, s: 1, f: 1 }); continue; }
    if (r4 < 0.02 && (b === B.FOREST || b === B.PINE || b === B.BIRCH)) { d.objects.push({ id: id(), type: 'stick', v: Math.floor(r * 3), x: X + 0.2 + r * 0.6, y: Y + 0.3 + r2 * 0.5, s: 1, f: r2 < 0.5 ? -1 : 1 }); continue; }
    if (r4 < 0.024 && b === B.MEADOW) d.objects.push({ id: id(), type: 'fibergrass', v: Math.floor(r * 3), x: X + 0.2 + r * 0.6, y: Y + 0.4 + r2 * 0.4, s: 1, f: r2 < 0.5 ? -1 : 1 });
  }
  if (decor) synthDecor(seed, d, cx, cy);
  return d;
}

// cosmetic ground decor (grass tufts, flowers, ferns, reeds)
function synthDecor(seed, d, cx, cy) {
  const out = d.decor;
  for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) {
    const l = ly * CS + lx;
    if (d.rock[l]) continue;
    const X = cx * CS + lx, Y = cy * CS + ly, b = d.biome[l], h = hash2(X, Y, seed + 909), h2 = hash2(X, Y, seed + 910), h3 = hash2(X, Y, seed + 911);
    if (d.water[l]) { if (d.water[l] === 1 && d.dWater[l] === 0 && h < 0.06) out.push({ t: 'reed', v: Math.floor(h2 * 997), x: X + h2, y: Y + h3, s: 0.8 + h3 * 0.4, f: h2 < 0.5 ? -1 : 1, w: 1 }); continue; }
    const lush = d.lush[l];
    const p = b === B.MEADOW ? 0.25 + lush * 0.35 : b === B.FOREST || b === B.BIRCH ? 0.18 : b === B.PINE ? 0.1 : b === B.MARSH ? 0.3 : b === B.SHORE ? 0.05 : 0.04;
    if (h > p) continue;
    let t = 'grass';
    if (b === B.MEADOW && h2 < 0.12) t = 'flower';
    else if (b === B.MEADOW && h2 < 0.3) t = 'tallgrass';
    else if ((b === B.FOREST || b === B.PINE || b === B.BIRCH) && h2 < 0.25) t = 'fern';
    else if (b === B.MARSH && h2 < 0.4) t = 'reed';
    else if (b === B.ROCKY || b === B.SHORE) t = 'drygrass';
    out.push({ t, v: Math.floor(h3 * 997), x: X + h2, y: Y + h3, s: 0.75 + h * 0.45, f: h2 < 0.5 ? -1 : 1 });
  }
}

// a spawn on temperate land, away from water and mountains (spiral search over the pure fields)
export function synthSpawn(seed) {
  const cx = PW / 2, cy = Math.round(PH * 0.32);
  for (let r = 0; r < 4000; r += 24) {
    const n = Math.max(1, Math.round((r * 2 * Math.PI) / 24));
    for (let a = 0; a < n; a++) {
      const x = Math.round(cx + Math.cos((a / n) * 6.283) * r), y = Math.round(cy + Math.sin((a / n) * 6.283) * r);
      let ok = true;
      for (let dy = -6; dy <= 6 && ok; dy += 3) for (let dx = -6; dx <= 6; dx += 3) {
        const e = elevation(seed, x + dx, y + dy);
        if (e < 0.04 || isRockAt(seed, x + dx, y + dy, e)) { ok = false; break; }
      }
      if (ok) return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return { x: cx + 0.5, y: cy + 0.5 };
}

// coarse colour picture of the planet (1 px = tpp × tpp tiles) for the map
export function synthMacro(seed, tpp = 32) {
  const w = PW / tpp, h = PH / tpp, rgba = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const X = px * tpp + tpp / 2, Y = py * tpp + tpp / 2, e = elevation(seed, X, Y), o = (py * w + px) * 4;
    let c;
    if (e < 0) { const k = Math.max(0, Math.min(1, -e * 2.2)); c = [72 - 50 * k, 116 - 72 * k, 128 - 56 * k]; }
    else if (isRockAt(seed, X, Y, e)) c = [110, 106, 100];
    else {
      const t = temperature(Y, e), m = moisture(seed, X, Y);
      c = t < 0.36 ? [58, 84, 60] : m > 0.55 ? [52, 86, 44] : t < 0.52 && m > 0.45 ? [80, 104, 58] : [104, 116, 60];
    }
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  return { w, h, rgba, tpp };
}

function chamfer(a, tw, th) {
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x; let v = a[i];
    if (x > 0) v = Math.min(v, a[i - 1] + 1);
    if (y > 0) { v = Math.min(v, a[i - tw] + 1); if (x > 0) v = Math.min(v, a[i - tw - 1] + 1.414); if (x < tw - 1) v = Math.min(v, a[i - tw + 1] + 1.414); }
    a[i] = v;
  }
  for (let y = th - 1; y >= 0; y--) for (let x = tw - 1; x >= 0; x--) {
    const i = y * tw + x; let v = a[i];
    if (x < tw - 1) v = Math.min(v, a[i + 1] + 1);
    if (y < th - 1) { v = Math.min(v, a[i + tw] + 1); if (x < tw - 1) v = Math.min(v, a[i + tw + 1] + 1.414); if (x > 0) v = Math.min(v, a[i + tw - 1] + 1.414); }
    a[i] = v;
  }
}

// the source (contract: src/world/source.js)
export class SynthSource {
  constructor(seed) {
    this.kind = 'synth';
    this.seed = seed;
    this.wrap = true;
    this.bounds = null;
    this.zones = [];
    this.spawn = synthSpawn(seed);
    this.worker = { url: new URL('./chunkWorker.js', import.meta.url).href, init: { kind: 'synth', seed } };
  }
  chunk(cx, cy, opts) { return synthChunk(this.seed, cx, cy, opts); }
  decor(cx, cy) { return synthChunk(this.seed, cx, cy, { decor: true }).decor; }
  macro() { return this._macro || (this._macro = synthMacro(this.seed)); }
  // the chunk a natural object id belongs to (load it to find the object: snapshots, saves)
  chunkOfId(id) { return typeof id === 'number' && id >= SYNTH_ID0 ? Math.floor((id - SYNTH_ID0) / SYNTH_IDS) : -1; }
}

