// Dev showcase of the terrain height system (docs/TERRAIN-HEIGHT.md): `?hills=1` sculpts the generated world around
// the spawn (made for seed 4242, works on any) before the World is built — rolling hills, a high plateau ringed by
// steep rock with a ramp up, a canyon around the river east of the spawn, a coastal cliff over a new sea in the
// south-west, a valley around the lake, a mountain with a rocky crown and a snowy peak in the south-east. Deterministic (seed only), so
// every peer that opens the world with the flag gets the same heights.
// Writes gen.heightCorners ((W + 1) × (H + 1) stories) and adjusts gen.water / ground / biome / rock / objects / decor
// (the sea, bare rock on the high ground, nothing standing on a cliff or in the new sea).

import { makePerlin, fbm, smoothstep, clamp } from '../engine/noise.js';
import { G, BIOME_ID as B } from './worldgen.js';
import { HeightLayer, SNOW_LINE } from './height.js';

export function sculptHills(gen) {
  const { W, H } = gen, CW = W + 1;
  const sx = gen.spawn.x, sy = gen.spawn.y;
  const pN = makePerlin((gen.seed | 0) * 31 + 7), pM = makePerlin((gen.seed | 0) * 53 + 11);
  const n = (x, y, s) => fbm(pN, x / s, y / s, 3);
  const m = (x, y, s) => fbm(pM, x / s, y / s, 2);
  const tIdx = (x, y) => y * W + x;
  const inT = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // ---------- the river east of the spawn: its centre per row (the canyon follows it) ----------
  const rx = new Float32Array(H).fill(NaN);
  for (let y = 0; y < H; y++) {
    let a = -1, b = -1;
    for (let x = Math.floor(sx) + 4; x < Math.min(W, sx + 40); x++) {
      if (gen.water[tIdx(x, y)]) { if (a < 0) a = x; b = x; } else if (a >= 0) break;
    }
    if (a >= 0) rx[y] = (a + b + 1) / 2;
  }
  const rxs = new Float32Array(H).fill(NaN); // smoothed, gaps bridged
  for (let y = 0; y < H; y++) {
    let s = 0, k = 0;
    for (let d = -4; d <= 4; d++) { const v = rx[clamp(y + d, 0, H - 1)]; if (v === v) { s += v; k++; } }
    if (k) rxs[y] = s / k;
  }
  const riverAt = (y) => rxs[clamp(Math.round(y), 0, H - 1)];

  // ---------- features ----------
  const P = { x: sx - 30, y: sy + 2, r: 8.5, h: 2.5 };            // plateau
  const RAMP = { x0: P.x + 6, x1: P.x + 17, y: P.y + 0.5, w: 1.6 }; // ramp up its east side (high end at x0)
  const LAKE = { x: sx - 12, y: sy - 14 };                         // valley around the lake
  const MT = { x: sx + 46, y: sy + 47, r: 27, h: 8 };             // mountain
  const COAST = (x) => sy + 30 + 3.2 * n(x, 3.7, 9) + 1.4 * n(x, 9.1, 3); // sea south of this line (x < sx - 14)
  const coastK = (x) => smoothstep(sx - 8, sx - 16, x) * smoothstep(sx - 92, sx - 80, x); // where the sea is
  const dW = (x, y) => { // distance to water at a corner (the tiles around it)
    let d = 99;
    for (let k = 0; k < 4; k++) { const tx = x - (k & 1), ty = y - (k >> 1); if (inT(tx, ty)) d = Math.min(d, gen.dWater ? gen.dWater[tIdx(tx, ty)] : (gen.water[tIdx(tx, ty)] ? 0 : 9)); }
    return d;
  };

  const C = new Float32Array(CW * (H + 1));
  const seaC = new Uint8Array(CW * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    // rolling hills, flattening toward the water
    let h = (0.8 + 0.6 * n(x, y, 17) + 0.25 * n(x + 40, y, 6.5)) * smoothstep(0.6, 6.5, dW(x, y));
    h = Math.max(0, h);
    // the valley: a ring of higher hills around the lake
    const dl = Math.hypot(x - LAKE.x, y - LAKE.y) + 2.5 * m(x, y, 6);
    h = Math.max(h, 2.2 * smoothstep(7, 15, dl) * (1 - smoothstep(19, 27, dl)) * smoothstep(0.6, 3.5, dW(x, y)));
    // canyon: a high tableland cut by the river — steep rock walls (~2 tiles) from the river floor to the rim
    const cx = riverAt(y);
    if (cx === cx) {
      const fadeY = smoothstep(sy - 52, sy - 40, y) * (1 - smoothstep(sy + 26, sy + 38, y));
      if (fadeY > 0) {
        const d = Math.abs(x - cx) + 1.2 * n(x, y, 4.5), east = x > cx;
        const T = (3.0 + 0.4 * n(x, y, 9)) * fadeY;
        const hw0 = 5.0;
        let hc = T * smoothstep(hw0, hw0 + 2.3, d);
        hc *= 1 - smoothstep(east ? 22 : hw0 + 6, east ? 34 : hw0 + 16, d); // west: slopes down to the meadow
        h = d < hw0 + 2.3 ? hc : Math.max(h, hc);
        if (d < hw0) h = 0;
      }
    }
    // plateau ringed by steep rock (a smooth face ~1.4 tiles wide), with a ramp up its east side
    const h0 = h, dp = Math.hypot(x - P.x, (y - P.y) * 1.15) / P.r + 0.2 * n(x, y, 3.6) + 0.06 * n(x, y, 1.3);
    const kp = smoothstep(1.0, 0.84, dp);
    if (kp > 0) h = h0 + (P.h + 0.2 * n(x, y, 5) - h0) * kp;
    if (Math.abs(y - RAMP.y) <= RAMP.w && x >= RAMP.x0 && x <= RAMP.x1) {
      const t = (x - RAMP.x0) / (RAMP.x1 - RAMP.x0);
      h = P.h * (1 - t) + h0 * t;
    }
    // coastal cliff over the sea
    const ck = coastK(x);
    if (ck > 0) {
      const yc = COAST(x);
      if (y >= yc && ck > 0.5) { h = 0; seaC[y * CW + x] = 1; }
      else h = Math.max(h, (2.0 + 0.3 * n(x, y, 4)) * ck * (1 - smoothstep(5, 15, yc - y)) * smoothstep(0.0, 1.4, yc - y));
    }
    // mountain: a smooth massif with ridges and a steep rocky crown, snow above SNOW_LINE
    const ex = (x - MT.x) * 0.8 + (y - MT.y) * 0.6, ey = -(x - MT.x) * 0.6 + (y - MT.y) * 0.8; // (a ridge, not a cone)
    const dm = Math.hypot(ex * 0.82, ey * 1.25) + 3 * m(x, y, 7) + 1.6 * n(x + 3, y, 3.5), tm = dm / MT.r;
    if (tm < 1) {
      const ang = Math.atan2(y - MT.y, x - MT.x);
      const ridge = 1 - Math.abs(n(Math.cos(ang) * 6 + 50, Math.sin(ang) * 6 + 50, 2.2)); // radial ridges and gullies
      let hm = MT.h * Math.pow(1 - tm, 1.35) + 1.4 * (ridge - 0.5) * (1 - tm) * tm * 4 + 0.5 * n(x, y, 4);
      hm += 2.6 * Math.pow(smoothstep(0.34, 0.0, tm), 1.6) * (0.75 + 0.5 * m(x * 1.7, y * 1.7, 2.5)); // the rocky crown, ragged
      hm += 0.9 * n(x, y, 2.6) * smoothstep(0.55, 0.1, tm); // knobs and notches along the summit ridge
      h = Math.max(h, hm * smoothstep(1, 0.92, tm));
    }
    C[y * CW + x] = Math.max(0, h);
  }
  // rock masses become rocky knolls: interior corners rise with the depth inside the rock (cliffy sides, a rough top)
  {
    const dIn = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) dIn[i] = gen.rock[i] ? 99 : 0;
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xx = pass ? W - 1 - x : x, yy = pass ? H - 1 - y : y, i = yy * W + xx;
      if (!dIn[i]) continue;
      let m = dIn[i];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const ax = xx + dx, ay = yy + dy; m = Math.min(m, ax < 0 || ay < 0 || ax >= W || ay >= H ? 99 : dIn[ay * W + ax] + 1); }
      dIn[i] = m;
    }
    for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
      let d = 99;
      for (let k = 0; k < 4; k++) d = Math.min(d, dIn[(y - (k >> 1)) * W + x - (k & 1)]);
      if (!d || d >= 99) continue; // (a corner touching open ground stays at the ground)
      const md = Math.hypot(x - MT.x, y - MT.y);
      if (md < MT.r + 4) continue;
      C[y * CW + x] += Math.min(3, 1.0 + (d - 1) * 0.6) * (0.85 + 0.3 * m(x, y, 3)) + 0.25 * n(x, y, 2.2);
    }
    if (gen.roof) for (let i = 0; i < W * H; i++) if (gen.rock[i]) gen.roof[i] = 0; // (mined open, not caves: docs/TERRAIN-HEIGHT.md)
  }

  // ---------- tiles: the sea, rock / water / ground / biome on the new relief ----------
  const L = new HeightLayer(W, H, C);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = tIdx(x, y), o = y * CW + x;
    const sea = seaC[o] + seaC[o + 1] + seaC[o + CW] + seaC[o + CW + 1];
    if (sea === 4) {
      const deep = seaC[o - CW] && seaC[o - CW + 1] && seaC[o - 1] && seaC[o + 2] ? 2 : 1; // the first row of the sea is shallow
      gen.water[i] = deep; gen.rock[i] = 0; gen.ground[i] = G.SAND; gen.biome[i] = B.WATER;
      continue;
    }
    const hmax = L.tileMax(x, y), hmin = L.tileMin(x, y);
    if (hmin > 0.05 && gen.water[i]) { gen.water[i] = 0; gen.ground[i] = G.GRAVEL; } // (water only at sea level)
    const md = Math.hypot(x + 0.5 - MT.x, y + 0.5 - MT.y);
    if (md < MT.r + 4) gen.rock[i] = 0; // the mountain is made of terrain (no flat rock massif on it)
    if (sea) gen.rock[i] = 0;
    if (hmax > SNOW_LINE - 2) { gen.ground[i] = hmax > SNOW_LINE ? G.STONE : G.GRAVEL; gen.biome[i] = B.MOUNTAIN; }
    else if (hmax > 6 && md < MT.r) { gen.ground[i] = G.MOSS; if (gen.biome[i] === B.MEADOW) gen.biome[i] = B.PINE; }
    if (L.cliff[i] && gen.water[i]) gen.water[i] = 0;
  }
  // nothing stands on a cliff, in the sea or above the tree line
  const keep = (o) => {
    const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
    if (!inT(tx, ty)) return true;
    const i = tIdx(tx, ty);
    if (L.cliff[i] || gen.water[i] === 2 || gen.rock[i]) return false;
    const h = L.heightAt(o.x, o.y);
    if (h > SNOW_LINE - 1 && /^(tree|bush|berry|herb)/.test(o.type || '')) return false;
    return true;
  };
  gen.objects = gen.objects.filter(keep);
  gen.decor = gen.decor.filter((d) => { const tx = Math.floor(d.x), ty = Math.floor(d.y); if (!inT(tx, ty)) return true; const i = tIdx(tx, ty); return !L.cliff[i] && !gen.water[i] && !gen.rock[i] && L.heightAt(d.x, d.y) < SNOW_LINE + 1; });
  if (gen.dWater) { // water moved: a rough distance (enough for growth rules)
    for (let i = 0; i < W * H; i++) if (gen.water[i]) gen.dWater[i] = 0;
  }
  gen.heightCorners = C;
  gen.hills = { plateau: [P.x, P.y], ramp: [RAMP.x1 - 1, RAMP.y], rampTop: [RAMP.x0 + 1, RAMP.y], lake: [LAKE.x, LAKE.y], mountain: [MT.x, MT.y], coast: [sx - 40, COAST(sx - 40)], canyon: [riverAt(sy - 10), sy - 10] };
  return gen;
}
