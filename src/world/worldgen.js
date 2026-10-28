// Deterministic world generation (pure data, no DOM). Same seed => same world (MMO-ready).
// Output: tile layers + list of static objects (trees, bushes...) + decor (grass, flowers).

import { mulberry32, makePerlin, fbm, hash2, clamp, smoothstep } from '../engine/noise.js';

export const G = { SOIL: 0, RICH: 1, SAND: 2, GRAVEL: 3, MARSH: 4, MUD: 5, STONE: 6, MOSS: 7 };
export const ROCK_NAMES = ['', 'Granito', 'Calcário', 'Ardósia', 'Mármore'];
export const ORE = { NONE: 0, STEEL: 1, GOLD: 2, JADE: 3 };

function distanceField(W, H, isSource) {
  // multi-source BFS with octile-ish weights (two-pass chamfer)
  const INF = 1e9;
  const d = new Float32Array(W * H).fill(INF);
  for (let i = 0; i < W * H; i++) if (isSource(i)) d[i] = 0;
  const D1 = 1, D2 = 1.4142;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + D1);
    if (y > 0) {
      v = Math.min(v, d[i - W] + D1);
      if (x > 0) v = Math.min(v, d[i - W - 1] + D2);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + D1);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + D1);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2);
      if (x > 0) v = Math.min(v, d[i + W - 1] + D2);
    }
    d[i] = v;
  }
  return d;
}

export function generateWorld(seed = 1337, W = 256, H = 256) {
  const rand = mulberry32(seed);
  const pE = makePerlin(seed * 7 + 1), pR = makePerlin(seed * 11 + 2), pM = makePerlin(seed * 13 + 3);
  const pF = makePerlin(seed * 17 + 4), pT = makePerlin(seed * 19 + 5), pS = makePerlin(seed * 23 + 6);
  const pK = makePerlin(seed * 29 + 7), pO = makePerlin(seed * 31 + 8);
  const N = W * H;
  const idx = (x, y) => y * W + x;

  const rock = new Uint8Array(N);      // 1 = rock wall
  const water = new Uint8Array(N);     // 0 none, 1 shallow, 2 deep
  const ground = new Uint8Array(N);
  const rockType = new Uint8Array(N);  // regional rock type 1..4
  const ore = new Uint8Array(N);
  const moist = new Float32Array(N);
  const fert = new Float32Array(N);
  const forest = new Float32Array(N);
  const flowX = new Float32Array(N), flowY = new Float32Array(N);

  // ---------- mountains ----------
  const side = Math.floor(rand() * 4); // which map edge hosts the big range
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const e = fbm(pE, x / 46, y / 46, 5);
    const ridge = 1 - Math.abs(fbm(pR, x / 34, y / 34, 3));
    const edge = side === 0 ? x / W : side === 1 ? 1 - x / W : side === 2 ? y / H : 1 - y / H;
    const m = e * 0.95 + ridge * 0.32 + smoothstep(0.42, 0.0, edge) * 0.75 - 0.1;
    if (m > 0.52) rock[i] = 1;
    moist[i] = fbm(pM, x / 38, y / 38, 4);
    fert[i] = fbm(pF, x / 20, y / 20, 4);
    forest[i] = fbm(pT, x / 28, y / 28, 4);
    const rt = fbm(pK, x / 60, y / 60, 3);
    rockType[i] = rt < -0.18 ? 3 : rt < 0.06 ? 1 : rt < 0.25 ? 2 : 4;
  }
  // cellular smoothing of rock
  for (let pass = 0; pass < 3; pass++) {
    const nr = rock.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c += rock[idx(x + dx, y + dy)];
      const i = idx(x, y);
      if (rock[i] && c <= 3) nr[i] = 0;
      else if (!rock[i] && c >= 6) nr[i] = 1;
    }
    rock.set(nr);
  }

  // ---------- lakes ----------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (rock[i]) continue;
    const l = fbm(pM, x / 30 + 40, y / 30 + 17, 4) - moist[i] * 0.2;
    if (l > 0.36) water[i] = 2;
    else if (l > 0.27) water[i] = 1;
  }

  // ---------- river ----------
  {
    const vertical = side < 2; // mountains left/right -> river runs top->bottom
    const len = vertical ? H : W;
    const across = vertical ? W : H;
    let c0 = across * (0.35 + rand() * 0.3);
    const c1 = across * (0.3 + rand() * 0.4);
    const pts = [];
    for (let t = -6; t <= len + 6; t += 0.5) {
      const u = clamp(t / len, 0, 1);
      const c = c0 + (c1 - c0) * u + Math.sin(t / 23 + seed) * 9 + fbm(pS, t / 40, 3.3, 3) * 26;
      const width = 2.1 + fbm(pS, t / 30, 9.1, 2) * 1.4 + Math.sin(t / 60) * 0.5;
      pts.push(vertical ? [c, t, width] : [t, c, width]);
    }
    for (let k = 1; k < pts.length; k++) {
      const [x, y, wdt] = pts[k];
      const [px, py] = pts[k - 1];
      let fx = x - px, fy = y - py;
      const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
      const R = Math.ceil(wdt + 2);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const tx = Math.floor(x + dx), ty = Math.floor(y + dy);
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        const i = idx(tx, ty);
        if (d < wdt + 0.7) {
          rock[i] = 0;
          const lvl = d < wdt - 0.9 ? 2 : 1;
          if (lvl > water[i]) water[i] = lvl;
          const s = 1 - d / (wdt + 0.7);
          flowX[i] = fx * (0.4 + s * 0.6); flowY[i] = fy * (0.4 + s * 0.6);
        } else if (d < wdt + 1.6 && rock[i]) {
          rock[i] = 0; // canyon walls slightly wider than the water
        }
      }
    }
  }

  // ---------- distances ----------
  const dWater = distanceField(W, H, (i) => water[i] > 0);
  const dRock = distanceField(W, H, (i) => rock[i] > 0);
  const dLand = distanceField(W, H, (i) => rock[i] === 0); // depth inside mountains

  // ---------- ground ----------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const nz = hash2(x, y, seed) - 0.5;
    const n2 = fbm(pS, x / 9, y / 9, 2);
    let g = G.SOIL;
    if (rock[i]) g = G.STONE;
    else if (water[i]) g = water[i] === 2 ? G.MUD : G.SAND;
    else {
      if (fert[i] > 0.22 + nz * 0.05) g = G.RICH;
      if (forest[i] > 0.2 && fert[i] > -0.1 && n2 > -0.15) g = G.MOSS;
      if (moist[i] > 0.24 && dWater[i] < 9 + n2 * 4) g = (moist[i] > 0.32 ? G.MARSH : G.MUD);
      if (dRock[i] < 1.6 + n2 * 2.2 + nz) g = G.GRAVEL;
      if (dWater[i] < 1.6 + n2 * 1.8 && moist[i] < 0.3) g = G.SAND;
      if (fert[i] < -0.38 && n2 > 0.1) g = G.GRAVEL;
    }
    ground[i] = g;
    // ore veins inside mountains
    if (rock[i] && dLand[i] > 1.5) {
      const o = fbm(pO, x / 7, y / 7, 2);
      if (o > 0.42) ore[i] = ORE.STEEL;
      else if (o < -0.5) ore[i] = hash2(x, y, seed + 9) < 0.5 ? ORE.GOLD : ORE.JADE;
    }
  }

  // ---------- plants & objects ----------
  const objects = []; // interactive: trees, bushes, boulders
  const decor = [];   // non-interactive: grass, flowers, pebbles
  const occupied = new Uint8Array(N);
  let oid = 1;
  const canPlant = (i) => !rock[i] && !water[i];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y);
    if (!canPlant(i)) continue;
    const g = ground[i];
    const r = hash2(x, y, seed + 101);
    const fo = forest[i];
    const fertile = g === G.SOIL || g === G.RICH || g === G.MOSS;
    // trees
    let pTree = 0;
    if (fertile) pTree = smoothstep(-0.15, 0.45, fo) * 0.55 + 0.012;
    if (g === G.MARSH || g === G.MUD) pTree = smoothstep(0.0, 0.5, fo) * 0.15;
    if (g === G.GRAVEL) pTree = 0.01;
    if (dWater[i] < 2) pTree *= 0.3;
    if (r < pTree) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (occupied[idx(x + dx, y + dy)] === 1) { near = true; break; }
      if (!near || r < pTree * 0.18) {
        const sp = fbm(pK, x / 22 + 50, y / 22, 2) + (dRock[i] < 10 ? 0.3 : 0) - (dWater[i] < 6 ? 0.25 : 0);
        const kind = g === G.MARSH || g === G.MUD ? (r < pTree * 0.5 ? 'tree_dead' : 'tree_birch')
          : sp > 0.18 ? 'tree_pine' : sp < -0.22 ? 'tree_birch' : 'tree_oak';
        const jx = (hash2(x, y, seed + 3) - 0.5) * 0.5, jy = (hash2(x, y, seed + 4) - 0.5) * 0.5;
        objects.push({ id: oid++, type: kind, v: Math.floor(hash2(x, y, seed + 5) * 16), x: x + 0.5 + jx, y: y + 0.6 + jy, s: 0.85 + hash2(x, y, seed + 6) * 0.35, f: hash2(x, y, seed + 7) < 0.5 ? -1 : 1, age: 1 });
        occupied[i] = 1;
        continue;
      }
    }
    // bushes / berry bushes / boulders
    const r2 = hash2(x, y, seed + 202);
    if (fertile && r2 < 0.018 + smoothstep(0, 0.5, fo) * 0.03) {
      const berry = r2 < 0.006;
      objects.push({ id: oid++, type: berry ? 'berrybush' : 'bush', v: Math.floor(r2 * 1000), x: x + 0.5 + (r - 0.5) * 0.4, y: y + 0.6, s: 0.8 + r * 0.4, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 2;
      continue;
    }
    if ((g === G.GRAVEL && r2 < 0.05) || (dRock[i] < 4 && r2 < 0.02) || r2 > 0.9965) {
      objects.push({ id: oid++, type: 'boulder', v: Math.floor(r2 * 1000), x: x + 0.5, y: y + 0.6, s: 0.7 + r * 0.5, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 3;
      continue;
    }
  }

  // decor (grass etc.) — lushness drives density
  const lush = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (!canPlant(i)) continue;
    const g = ground[i];
    let L = 0;
    if (g === G.SOIL) L = 0.55 + fert[i] * 0.6;
    else if (g === G.RICH) L = 0.85;
    else if (g === G.MOSS) L = 0.45;
    else if (g === G.MARSH) L = 0.7;
    else if (g === G.MUD) L = 0.25;
    else if (g === G.GRAVEL) L = 0.12;
    else if (g === G.SAND) L = 0.06;
    L += fbm(pS, x / 6 + 11, y / 6, 2) * 0.35;
    L = clamp(L, 0, 1);
    lush[i] = L;
    const count = Math.floor(L * 2.4 + hash2(x, y, seed + 303));
    for (let k = 0; k < count; k++) {
      const h1 = hash2(x * 7 + k, y * 13 - k, seed + 404), h2 = hash2(x * 11 - k, y * 3 + k, seed + 505);
      const h3 = hash2(x + k * 31, y - k * 17, seed + 606);
      let t = 'grass';
      if (g === G.MARSH && h3 < 0.5) t = 'reed';
      else if (L > 0.7 && h3 < 0.28) t = 'tallgrass';
      else if (h3 > 0.965 && g !== G.MARSH) t = 'flower';
      else if (g === G.MOSS && h3 > 0.9) t = 'mushroom';
      decor.push({ t, v: Math.floor(h3 * 997), x: x + h1, y: y + h2, s: 0.75 + h3 * 0.45, f: h1 < 0.5 ? -1 : 1 });
    }
  }

  // ---------- spawn ----------
  let spawn = { x: W / 2, y: H / 2 };
  let best = -1e9;
  for (let k = 0; k < 4000; k++) {
    const x = Math.floor(W * 0.3 + rand() * W * 0.4), y = Math.floor(H * 0.3 + rand() * H * 0.4);
    const i = idx(x, y);
    if (!canPlant(i) || occupied[i]) continue;
    const score = Math.min(dRock[i], 12) * 0.4 + Math.min(dWater[i], 14) * 0.2 - Math.abs(dWater[i] - 9) * 0.35 + lush[i] * 2 - Math.hypot(x - W / 2, y - H / 2) * 0.05;
    if (score > best) { best = score; spawn = { x: x + 0.5, y: y + 0.5 }; }
  }

  return { seed, W, H, rock, water, ground, rockType, ore, lush, flowX, flowY, objects, decor, spawn, dWater, dRock };
}
