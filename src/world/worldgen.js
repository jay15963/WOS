// Deterministic world generation (pure data, no DOM). Same seed => same world (MMO-ready).
// Output: tile layers + list of static objects (trees, bushes...) + decor (grass, flowers) +
// biome map and gameplay zones.
//
// Biomes (gen.biome Uint8Array, names in BIOMES): meadow, forest (oak), pine (conifers near the
// mountains), birch (groves near water), marsh, shore (beaches / river banks), rocky (gravel at the
// mountain feet and around outcrops), water, mountain.
// Zones (gen.zones): [{ type, x, y, r, ... }] — type is a biome name (one per 16x16 chunk where it
// dominates, with `f` = fraction) or one of: lake, river, flowers, mushrooms, outcrop, clearing, spawn.

import { mulberry32, makePerlin, fbm, hash2, clamp, smoothstep } from '../engine/noise.js';

export const G = { SOIL: 0, RICH: 1, SAND: 2, GRAVEL: 3, MARSH: 4, MUD: 5, STONE: 6, MOSS: 7 };
export const ROCK_NAMES = ['', 'Granito', 'Calcário', 'Ardósia', 'Mármore'];
export const ORE = { NONE: 0, STEEL: 1, GOLD: 2, JADE: 3 };
export const BIOMES = ['meadow', 'forest', 'pine', 'birch', 'marsh', 'shore', 'rocky', 'water', 'mountain'];
export const BIOME_NAMES_PT = ['Campina', 'Floresta', 'Pinheiral', 'Bosque de bétulas', 'Pântano', 'Margem', 'Pedregal', 'Água', 'Montanha'];
const B = { MEADOW: 0, FOREST: 1, PINE: 2, BIRCH: 3, MARSH: 4, SHORE: 5, ROCKY: 6, WATER: 7, MOUNTAIN: 8 };

function distanceField(W, H, isSource) {
  // multi-source two-pass chamfer (octile-ish weights)
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
  const P = (k) => makePerlin(seed * 7919 + k * 104729);
  const pE = P(1), pR = P(2), pM = P(3), pF = P(4), pT = P(5), pS = P(6), pK = P(7), pO = P(8);
  const pW = P(9), pL = P(10), pX = P(11), pC = P(12), pV = P(13), pQ = P(14);
  const N = W * H;
  const idx = (x, y) => y * W + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  const rock = new Uint8Array(N);      // 1 = rock wall
  const water = new Uint8Array(N);     // 0 none, 1 shallow, 2 deep
  const ground = new Uint8Array(N);
  const rockType = new Uint8Array(N);  // regional rock type 1..4
  const ore = new Uint8Array(N);
  const biome = new Uint8Array(N);
  const moist = new Float32Array(N);
  const fert = new Float32Array(N);
  const forest = new Float32Array(N);
  const elev = new Float32Array(N);
  const flowX = new Float32Array(N), flowY = new Float32Array(N);
  const lakeMask = new Uint8Array(N), sandbar = new Uint8Array(N);
  const zones = [];

  // ---------- mountains: a range along one map edge + scattered outcrops ----------
  const side = Math.floor(rand() * 4); // 0 left, 1 right, 2 top, 3 bottom
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const e = fbm(pE, x / 46, y / 46, 5);
    const ridge = 1 - Math.abs(fbm(pR, x / 34, y / 34, 3));
    const edge = side === 0 ? x / W : side === 1 ? 1 - x / W : side === 2 ? y / H : 1 - y / H;
    const m = e * 0.95 + ridge * 0.3 + smoothstep(0.4, 0.0, edge) * 0.78 - 0.1;
    elev[i] = m;
    if (m > 0.53) rock[i] = 1;
    moist[i] = fbm(pM, x / 38, y / 38, 4);
    fert[i] = fbm(pF, x / 22, y / 22, 3);
    forest[i] = fbm(pT, x / 30, y / 30, 4) + fbm(pT, x / 9 + 31, y / 9, 2) * 0.12;
    const rt = fbm(pK, x / 60, y / 60, 3);
    rockType[i] = rt < -0.18 ? 3 : rt < 0.06 ? 1 : rt < 0.25 ? 2 : 4;
  }
  // outcrops (keep the map centre free for the spawn meadow)
  const nOut = 4 + Math.floor(rand() * 4);
  for (let k = 0, tries = 0; k < nOut && tries < 200; tries++) {
    const cx = 18 + rand() * (W - 36), cy = 18 + rand() * (H - 36);
    if (Math.hypot(cx - W / 2, cy - H / 2) < 30) continue;
    if (elev[idx(Math.floor(cx), Math.floor(cy))] > 0.35) continue;
    const R = 2.4 + rand() * 3.6;
    const RR = Math.ceil(R * 1.7);
    for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
      const x = Math.floor(cx + dx), y = Math.floor(cy + dy);
      if (!inB(x, y)) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R + fbm(pX, x / 4.5, y / 4.5, 2) * 0.55;
      if (d < 1) rock[idx(x, y)] = 1;
    }
    zones.push({ type: 'outcrop', x: cx, y: cy, r: R + 1 });
    k++;
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

  // ---------- lakes: a few organic lakes + small ponds ----------
  const lakes = [];
  const wantLakes = 2 + Math.floor(rand() * 2), wantPonds = 2 + Math.floor(rand() * 3);
  for (let tries = 0; tries < 400 && lakes.length < wantLakes + wantPonds; tries++) {
    const big = lakes.length < wantLakes;
    const R = big ? 7 + rand() * 6 : 2.6 + rand() * 2.2;
    const cx = R + 8 + rand() * (W - 2 * R - 16), cy = R + 8 + rand() * (H - 2 * R - 16);
    const ci = idx(Math.floor(cx), Math.floor(cy));
    if (elev[ci] > 0.3 || rock[ci]) continue;
    if (Math.hypot(cx - W / 2, cy - H / 2) < R + 9) continue; // spawn meadow stays dry
    let ok = true;
    for (const l of lakes) if (Math.hypot(l.x - cx, l.y - cy) < l.r + R + 10) { ok = false; break; }
    if (!ok) continue;
    lakes.push({ x: cx, y: cy, r: R, big });
  }
  for (const l of lakes) {
    const RR = Math.ceil(l.r * 1.8);
    for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
      const x = Math.floor(l.x + dx), y = Math.floor(l.y + dy);
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (rock[i]) continue;
      const wx = fbm(pL, x / 11, y / 11, 3) * l.r * 0.5, wy = fbm(pL, x / 11 + 50, y / 11, 3) * l.r * 0.5;
      const d = Math.hypot(x + 0.5 - l.x + wx, y + 0.5 - l.y + wy) / l.r;
      if (d < 1) {
        const lvl = d < (l.big ? 0.56 : 0.3) ? 2 : 1;
        if (lvl > water[i]) water[i] = lvl;
        lakeMask[i] = 1;
      }
    }
    zones.push({ type: 'lake', x: l.x, y: l.y, r: l.r });
  }

  // ---------- river: from the mountains to the opposite edge, meandering ----------
  {
    const vertical = side >= 2;                 // range on top/bottom -> river runs vertically
    const len = vertical ? H : W, across = vertical ? W : H;
    const flip = side === 1 || side === 3;      // flows from the mountain edge
    const c0 = across * (0.3 + rand() * 0.4), c1 = across * (0.3 + rand() * 0.4);
    const ph = rand() * 6.28, lam = 10 + rand() * 5;
    const cf = (t) => {
      const u = clamp(t / len, 0, 1);
      const amp = 9 + fbm(pS, t / 70, 1.7, 2) * 8;
      return c0 + (c1 - c0) * u + Math.sin(t / lam + ph) * amp + fbm(pS, t / 34, 3.3, 3) * 14;
    };
    const pts = [];
    for (let t = -6; t <= len + 6; t += 0.5) {
      const c = cf(t), dc = (cf(t + 0.5) - cf(t - 0.5)), ddc = cf(t + 1) - 2 * c + cf(t - 1);
      const width = 2.0 + fbm(pS, t / 30, 9.1, 2) * 1.1 + clamp(t / len, 0, 1) * 0.8;
      const tt = flip ? len - t : t;
      pts.push({ x: vertical ? c : tt, y: vertical ? tt : c, w: width, dc, ddc, t });
    }
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k], q = pts[k - 1];
      let fx = p.x - q.x, fy = p.y - q.y;
      const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
      const R = Math.ceil(p.w + 2);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const tx = Math.floor(p.x + dx), ty = Math.floor(p.y + dy);
        if (!inB(tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
        const i = idx(tx, ty);
        if (d < p.w + 0.7) {
          rock[i] = 0;
          const lvl = d < p.w - 0.9 ? 2 : 1;
          if (lvl > water[i]) water[i] = lvl;
          const s = 1 - d / (p.w + 0.7);
          const fs = 0.35 + s * 0.65;
          if (fs > Math.hypot(flowX[i], flowY[i])) { flowX[i] = fx * fs; flowY[i] = fy * fs; }
        } else if (d < p.w + 1.7 && rock[i]) {
          rock[i] = 0; // canyon walls slightly wider than the water
        }
      }
    }
    // sandbars on the inner side of strong bends
    let lastBar = -99;
    for (let k = 2; k < pts.length - 2; k++) {
      const p = pts[k];
      if (Math.abs(p.ddc) < 0.05 || p.w < 2.3 || k - lastBar < 44) continue;
      if (p.x < 6 || p.y < 6 || p.x > W - 6 || p.y > H - 6) continue;
      lastBar = k;
      // inner bank = towards the centre of curvature
      const sgn = Math.sign(p.ddc);
      const nx = vertical ? sgn : 0, ny = vertical ? 0 : sgn;
      const bx = p.x + nx * p.w * 0.55, by = p.y + ny * p.w * 0.55, br = p.w * 0.62;
      const RR = Math.ceil(br + 2);
      for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
        const tx = Math.floor(bx + dx), ty = Math.floor(by + dy);
        if (!inB(tx, ty)) continue;
        const i = idx(tx, ty);
        const d = Math.hypot(tx + 0.5 - bx, ty + 0.5 - by) / br + fbm(pQ, tx / 3, ty / 3, 2) * 0.35;
        if (d < 1 && water[i]) { water[i] = 0; sandbar[i] = 1; }
        else if (d < 1.5 && water[i] === 2) water[i] = 1;
      }
    }
    for (let k = 0; k < pts.length; k += 48) {
      const p = pts[k];
      if (inB(Math.floor(p.x), Math.floor(p.y))) zones.push({ type: 'river', x: p.x, y: p.y, r: p.w + 4 });
    }
  }

  // ---------- distances ----------
  const dWater = distanceField(W, H, (i) => water[i] > 0);
  const dRock = distanceField(W, H, (i) => rock[i] > 0);
  const dLand = distanceField(W, H, (i) => rock[i] === 0); // depth inside mountains
  const dLake = distanceField(W, H, (i) => lakeMask[i] > 0);

  // ---------- forest clearings ----------
  const clearings = [];
  for (let tries = 0; tries < 300 && clearings.length < 10; tries++) {
    const x = 10 + rand() * (W - 20), y = 10 + rand() * (H - 20);
    const i = idx(Math.floor(x), Math.floor(y));
    if (forest[i] < 0.18 || rock[i] || water[i]) continue;
    const r = 2.5 + rand() * 3.5;
    clearings.push({ x, y, r });
    zones.push({ type: 'clearing', x, y, r });
  }
  for (const c of clearings) {
    const RR = Math.ceil(c.r * 1.6);
    for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
      const x = Math.floor(c.x + dx), y = Math.floor(c.y + dy);
      if (!inB(x, y)) continue;
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / c.r;
      if (d < 1.5) forest[idx(x, y)] -= 0.45 * smoothstep(1.5, 0.7, d);
    }
  }
  // the spawn meadow (map centre) is kept mostly open
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - W / 2, y - H / 2);
    if (d < 22) forest[idx(x, y)] -= 0.28 * smoothstep(22, 9, d);
  }

  // ---------- biomes ----------
  const FT = 0.05; // forest threshold
  const marshN = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (rock[i]) { biome[i] = B.MOUNTAIN; continue; }
    if (water[i]) { biome[i] = B.WATER; continue; }
    const n2 = fbm(pS, x / 9, y / 9, 2);
    const mN = fbm(pV, x / 17, y / 17, 3) + moist[i] * 0.4 + (dLake[i] < 9 ? 0.3 * (1 - dLake[i] / 9) : 0) - (dRock[i] < 10 ? 0.35 * (1 - dRock[i] / 10) : 0);
    marshN[i] = mN;
    let b = B.MEADOW;
    if (forest[i] > FT) {
      const birchN = fbm(pW, x / 21 + 9, y / 21, 2) + (dWater[i] < 12 ? 0.3 * (1 - dWater[i] / 12) : 0);
      if (elev[i] > 0.26 + n2 * 0.1 || dRock[i] < 6 + n2 * 3) b = B.PINE;
      else if (birchN > 0.2) b = B.BIRCH;
      else b = B.FOREST;
    }
    if (mN > 0.3 && dWater[i] < 12) b = B.MARSH;
    if (sandbar[i] || (dWater[i] <= 1.6 + n2 * 1.4 && b !== B.MARSH)) b = B.SHORE;
    if (dRock[i] < 2.0 + n2 * 1.6) b = B.ROCKY;
    biome[i] = b;
  }

  // ---------- ground ----------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const nz = hash2(x, y, seed) - 0.5;
    const n2 = fbm(pS, x / 9 + 17, y / 9, 2);
    let g = G.SOIL;
    switch (biome[i]) {
      case B.MOUNTAIN: g = G.STONE; break;
      case B.WATER: g = water[i] === 2 ? G.MUD : G.SAND; break;
      case B.SHORE: g = G.SAND; break;
      case B.MARSH: g = marshN[i] > 0.48 + n2 * 0.06 ? G.MARSH : G.MUD; break;
      case B.ROCKY: g = dRock[i] < 1.3 && n2 > 0.12 ? G.STONE : G.GRAVEL; break;
      case B.PINE: g = forest[i] > FT + 0.06 + n2 * 0.08 ? G.MOSS : (n2 < -0.3 ? G.GRAVEL : G.SOIL); break;
      case B.FOREST: g = forest[i] > FT + 0.07 + n2 * 0.08 ? G.MOSS : (fert[i] > 0.2 ? G.RICH : G.SOIL); break;
      case B.BIRCH: g = forest[i] > FT + 0.16 + n2 * 0.1 ? G.MOSS : (fert[i] > 0.12 ? G.RICH : G.SOIL); break;
      default: // meadow
        g = fert[i] > 0.36 + nz * 0.04 + n2 * 0.06 ? G.RICH : G.SOIL;
    }
    ground[i] = g;
    // ore inside mountains: thin steel veins + rare gold / jade pockets
    if (rock[i] && dLand[i] > 1.5) {
      const mask = fbm(pO, x / 23 + 130, y / 23, 2);           // where veins exist at all
      const v = 1 - Math.abs(fbm(pO, x / 9, y / 9, 2));        // thin ridged lines
      if (mask > 0.2 && v > 0.96) ore[i] = ORE.STEEL;
      else {
        const p = fbm(pO, x / 5 + 70, y / 5, 2);
        if (p > 0.56 && mask < -0.05) ore[i] = hash2(Math.floor(x / 7), Math.floor(y / 7), seed + 9) < 0.55 ? ORE.GOLD : ORE.JADE;
      }
    }
  }

  // ---------- plants & objects ----------
  const objects = []; // interactive: trees, bushes, boulders
  const decor = [];   // non-interactive: grass, flowers, reeds, mushrooms
  const occupied = new Uint8Array(N);
  let oid = 1;
  const canPlant = (i) => !rock[i] && !water[i];
  const pickTree = (b, r) => {
    switch (b) {
      case B.PINE: return r < 0.84 ? 'tree_pine' : r < 0.9 ? 'tree_birch' : r < 0.94 ? 'tree_dead' : 'tree_oak';
      case B.BIRCH: return r < 0.68 ? 'tree_birch' : r < 0.97 ? 'tree_oak' : 'tree_pine';
      case B.MARSH: return r < 0.42 ? 'tree_dead' : 'tree_birch';
      case B.ROCKY: return r < 0.8 ? 'tree_pine' : 'tree_dead';
      case B.MEADOW: return r < 0.68 ? 'tree_oak' : 'tree_birch';
      default: return r < 0.76 ? 'tree_oak' : r < 0.9 ? 'tree_birch' : r < 0.985 ? 'tree_pine' : 'tree_dead';
    }
  };
  // berry bush clusters near forest edges
  const berryC = [];
  for (let tries = 0; tries < 600 && berryC.length < 34; tries++) {
    const x = 6 + rand() * (W - 12), y = 6 + rand() * (H - 12);
    const i = idx(Math.floor(x), Math.floor(y));
    if (!canPlant(i) || Math.abs(forest[i] - FT) > 0.08 || biome[i] === B.MARSH) continue;
    berryC.push({ x, y });
  }
  const berryNear = (x, y) => { for (const c of berryC) if ((c.x - x) ** 2 + (c.y - y) ** 2 < 6.5) return true; return false; };

  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y);
    if (!canPlant(i)) continue;
    const b = biome[i];
    const r = hash2(x, y, seed + 101);
    const fo = forest[i];
    // trees
    let pTree = 0;
    if (b === B.FOREST || b === B.BIRCH || b === B.PINE) pTree = 0.2 + 0.42 * smoothstep(FT, FT + 0.35, fo);
    else if (b === B.MEADOW) pTree = 0.006 + 0.1 * smoothstep(FT - 0.12, FT, fo);
    else if (b === B.MARSH) pTree = 0.035;
    else if (b === B.ROCKY) pTree = 0.025;
    if (dWater[i] < 1.5) pTree *= 0.25;
    if (r < pTree) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (occupied[idx(x + dx, y + dy)] === 1) { near = true; break; }
      if (!near || r < pTree * 0.22) {
        const kind = pickTree(b, hash2(x, y, seed + 8));
        const jx = (hash2(x, y, seed + 3) - 0.5) * 0.55, jy = (hash2(x, y, seed + 4) - 0.5) * 0.55;
        const big = b === B.MEADOW ? 0.15 : 0; // lone meadow trees grow larger
        objects.push({ id: oid++, type: kind, v: Math.floor(hash2(x, y, seed + 5) * 16), x: x + 0.5 + jx, y: y + 0.6 + jy, s: 0.85 + big + hash2(x, y, seed + 6) * 0.35, f: hash2(x, y, seed + 7) < 0.5 ? -1 : 1, age: 1 });
        occupied[i] = 1;
        continue;
      }
    }
    // bushes / berry bushes / boulders
    const r2 = hash2(x, y, seed + 202);
    const edge = 1 - smoothstep(0.0, 0.1, Math.abs(fo - FT));
    const fertile = b === B.MEADOW || b === B.FOREST || b === B.BIRCH || b === B.PINE;
    if (fertile && berryNear(x + 0.5, y + 0.5) && r2 < 0.2) {
      objects.push({ id: oid++, type: 'berrybush', v: Math.floor(r2 * 1000), x: x + 0.5 + (r - 0.5) * 0.4, y: y + 0.6, s: 0.8 + r * 0.35, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 2;
      continue;
    }
    const pBush = fertile ? 0.006 + edge * 0.05 + (b !== B.MEADOW ? 0.02 : 0) : b === B.MARSH ? 0.012 : 0;
    if (r2 < pBush) {
      objects.push({ id: oid++, type: 'bush', v: Math.floor(r2 * 1000), x: x + 0.5 + (r - 0.5) * 0.4, y: y + 0.6, s: 0.75 + r * 0.45, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 2;
      continue;
    }
    const r3 = hash2(x, y, seed + 303);
    const pRock = b === B.ROCKY ? 0.06 : dRock[i] < 5 ? 0.02 : b === B.SHORE ? 0.006 : 0.0022;
    if (r3 < pRock) {
      objects.push({ id: oid++, type: 'boulder', v: Math.floor(r3 * 7919), x: x + 0.5 + (r - 0.5) * 0.3, y: y + 0.6, s: 0.6 + r * 0.55, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 3;
    }
  }

  // ---------- decor ----------
  const lush = new Float32Array(N);
  // flower meadows
  const flowerZ = [];
  for (let tries = 0; tries < 500 && flowerZ.length < 14; tries++) {
    const x = 8 + rand() * (W - 16), y = 8 + rand() * (H - 16);
    const i = idx(Math.floor(x), Math.floor(y));
    if (biome[i] !== B.MEADOW && biome[i] !== B.BIRCH) continue;
    const r = 3 + rand() * 4.5;
    flowerZ.push({ x, y, r, c: Math.floor(rand() * 4) });
    zones.push({ type: 'flowers', x, y, r });
  }
  const flowerAt = (x, y) => {
    let best = 0, col = 0;
    for (const z of flowerZ) {
      const d2 = ((z.x - x) ** 2 + (z.y - y) ** 2) / (z.r * z.r);
      if (d2 < 1 && 1 - d2 > best) { best = 1 - d2; col = z.c; }
    }
    return [best, col];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const b = biome[i];
    // reeds standing in shallow water along lake / marsh shores
    if (water[i] === 1 && dWater[i] === 0) {
      let land = false;
      for (let dy = -1; dy <= 1 && !land; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (inB(xx, yy) && !water[idx(xx, yy)] && !rock[idx(xx, yy)]) { land = true; break; }
      }
      const rn = fbm(pC, x / 5 + 40, y / 5, 2);
      const flowing = Math.hypot(flowX[i], flowY[i]) > 0.2;
      if (land && rn > (flowing ? 0.25 : -0.05)) {
        const n = 2 + Math.floor(hash2(x, y, seed + 707) * 3);
        for (let k = 0; k < n; k++) {
          const h1 = hash2(x * 7 + k, y * 13 - k, seed + 708), h2 = hash2(x * 11 - k, y * 3 + k, seed + 709);
          decor.push({ t: 'reed', v: Math.floor(h1 * 997), x: x + h1, y: y + h2, s: 0.8 + h2 * 0.4, f: h1 < 0.5 ? -1 : 1 });
        }
      }
      continue;
    }
    if (!canPlant(i)) continue;
    const g = ground[i];
    let L;
    switch (b) {
      case B.MEADOW: L = 0.62 + fert[i] * 0.45; break;
      case B.FOREST: L = g === G.MOSS ? 0.32 : 0.55; break;
      case B.PINE: L = g === G.MOSS ? 0.22 : 0.4; break;
      case B.BIRCH: L = g === G.MOSS ? 0.4 : 0.66; break;
      case B.MARSH: L = 0.75; break;
      case B.SHORE: L = 0.08; break;
      case B.ROCKY: L = 0.14; break;
      default: L = 0.3;
    }
    L += fbm(pS, x / 6 + 11, y / 6, 2) * 0.32;
    L = clamp(L, 0, 1);
    lush[i] = L;
    const [fz, fc] = flowerAt(x + 0.5, y + 0.5);
    const tallN = fbm(pW, x / 7, y / 7, 2);
    const colN = fbm(pC, x / 6, y / 6, 2);
    const count = Math.floor(L * 2.4 + hash2(x, y, seed + 303) + fz * 1.5);
    for (let k = 0; k < count; k++) {
      const h1 = hash2(x * 7 + k, y * 13 - k, seed + 404), h2 = hash2(x * 11 - k, y * 3 + k, seed + 505);
      const h3 = hash2(x + k * 31, y - k * 17, seed + 606);
      let t = 'grass', v = Math.floor(h3 * 997);
      if (b === B.MARSH) t = h3 < 0.45 ? 'reed' : h3 < 0.75 ? 'tallgrass' : 'grass';
      else if (fz > 0 && h3 < 0.18 + fz * 0.45) {
        t = 'flower';
        v = h3 < 0.12 ? Math.floor(h1 * 4) : fc; // mostly one colour per meadow
      } else if (L > 0.62 && tallN > 0.05 && h3 < 0.45) t = 'tallgrass';
      else if (h3 > 0.985 && (b === B.MEADOW || b === B.BIRCH)) { t = 'flower'; v = Math.floor((colN * 0.5 + 0.5) * 4) & 3; }
      else if (g === G.MOSS && h3 > 0.93) t = 'mushroom';
      decor.push({ t, v, x: x + h1, y: y + h2, s: 0.75 + h3 * 0.45, f: h1 < 0.5 ? -1 : 1 });
    }
  }
  // mushroom rings in the forests
  for (let tries = 0, made = 0; tries < 400 && made < 9; tries++) {
    const x = 8 + rand() * (W - 16), y = 8 + rand() * (H - 16);
    const i = idx(Math.floor(x), Math.floor(y));
    if ((biome[i] !== B.FOREST && biome[i] !== B.PINE && biome[i] !== B.BIRCH) || occupied[i]) continue;
    const r = 1.0 + rand() * 1.1, n = 9 + Math.floor(rand() * 7), v = Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.3, rr = r * (0.9 + rand() * 0.2);
      const mx = x + Math.cos(a) * rr, my = y + Math.sin(a) * rr;
      const mi = idx(clamp(Math.floor(mx), 0, W - 1), clamp(Math.floor(my), 0, H - 1));
      if (!canPlant(mi)) continue;
      decor.push({ t: 'mushroom', v, x: mx, y: my, s: 0.8 + rand() * 0.3, f: rand() < 0.5 ? -1 : 1 });
    }
    zones.push({ type: 'mushrooms', x, y, r: r + 0.5 });
    made++;
  }

  // ---------- spawn: open meadow near a forest edge, water in view, far from cliffs ----------
  const dForest = distanceField(W, H, (i) => biome[i] === B.FOREST || biome[i] === B.BIRCH || biome[i] === B.PINE);
  let spawn = null, best = -1e9;
  const srand = mulberry32(seed * 31 + 5);
  for (let k = 0; k < 6000; k++) {
    const x = Math.floor(W * 0.22 + srand() * W * 0.56), y = Math.floor(H * 0.22 + srand() * H * 0.56);
    const i = idx(x, y);
    if (!canPlant(i) || occupied[i] || biome[i] !== B.MEADOW) continue;
    const dw = dWater[i], df = dForest[i];
    let score = 0;
    score -= Math.abs(dw - 8) * 0.55;              // water in view, not on the beach
    score -= Math.abs(df - 5) * 0.45;              // close to a forest edge
    score += Math.min(dRock[i], 14) * 0.25;        // away from cliffs
    score += lush[i] * 2;
    score -= Math.hypot(x - W / 2, y - H / 2) * 0.04;
    if (dw < 3) score -= 6;
    if (score > best) { best = score; spawn = { x: x + 0.5, y: y + 0.5 }; }
  }
  if (!spawn) {
    // fallback: nearest plantable tile to the centre
    let bd = 1e9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!canPlant(i)) continue;
      const d = Math.hypot(x - W / 2, y - H / 2);
      if (d < bd) { bd = d; spawn = { x: x + 0.5, y: y + 0.5 }; }
    }
  }
  // keep the arrival spot clear
  for (let k = objects.length - 1; k >= 0; k--) {
    const o = objects[k];
    if ((o.x - spawn.x) ** 2 + (o.y - spawn.y) ** 2 < 2.4 * 2.4) objects.splice(k, 1);
  }
  zones.push({ type: 'spawn', x: spawn.x, y: spawn.y, r: 10 });

  // ---------- biome zones per chunk (for gameplay spawn tables) ----------
  const CH = 16;
  for (let cy = 0; cy < H; cy += CH) for (let cx = 0; cx < W; cx += CH) {
    const cnt = new Uint16Array(BIOMES.length);
    for (let y = cy; y < Math.min(H, cy + CH); y++) for (let x = cx; x < Math.min(W, cx + CH); x++) cnt[biome[idx(x, y)]]++;
    let bb = 0;
    for (let k = 1; k < cnt.length; k++) if (cnt[k] > cnt[bb]) bb = k;
    const fr = cnt[bb] / (CH * CH);
    if (fr > 0.4) zones.push({ type: BIOMES[bb], x: cx + CH / 2, y: cy + CH / 2, r: CH / 2, f: Math.round(fr * 100) / 100 });
  }

  return { seed, W, H, rock, water, ground, rockType, ore, lush, flowX, flowY, objects, decor, spawn, dWater, dRock, biome, zones };
}
