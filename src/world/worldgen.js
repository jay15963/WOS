// Deterministic world generation (pure data, no DOM). Same seed => same world (MMO-ready).
// Output: tile layers + list of static objects (trees, bushes...) + decor (grass, flowers) +
// biome map and gameplay zones.
//
// Biomes (gen.biome Uint8Array, names in BIOMES): meadow, forest (oak), pine (conifers near the
// mountains), birch (groves near water), marsh, shore (beaches / river banks), rocky (gravel at the
// mountain feet and around outcrops), water, mountain.
// Zones (gen.zones): [{ type, x, y, r, ... }] — type is a biome name (one per 16x16 chunk where it
// dominates, with `f` = fraction) or one of: lake, river, flowers, mushrooms, outcrop, clearing, spawn,
// bandit_camp (2..4, r = 6, cleared trampled ground ≥ 60 tiles from the spawn, joined by dirt trails).
//
// Ores (gen.ore, ids in ORE): clustered veins inside the mountains — coal seams and copper near the
// edges (depth 1..6), iron deeper (≥ 3), small gold / jade pockets deep inside (≥ 6).
// Roof (gen.roof): 1 where the ORIGINAL rock is ≥ 2 tiles deep; mined tiles there become dark caves.
// Small natural objects (hand-gathered, no `solid`): pebble (v 0..3), stick (0..2), fibergrass (0..2),
// wild_potato, wild_cotton, wild_corn. Generated after the trees/bushes/boulders so their ids are stable.
// Guarantee: ≥ 10 pebbles, 8 sticks, 8 fibergrass, 2 berry bushes and 1 herb bush reachable within 14 tiles of spawn.
// Herb bushes (`herbbush`, medicinal herbs with little green berries): clusters in shady / damp spots.
// Species (art only, inside the gameplay kinds): trees o.v = species * 16 + variant (treeSpecies), bushes
// o.v = species * 1000 + variant (bushSpecies), mossy boulders o.v >= 8000 — composeWorld picks the art group.
// Decor in water carries `w` (water depth 1 / 2): reeds / river stones get the shader waterline, ripples
// and reflections (src/fx/waterline.js); lily pads float.
// Decor: grass / tallgrass / flower / reed / mushroom + undergrowth (fern, bloom, heather, drygrass, thistle) and
// flat ground details (litter, needles, twigs, petals, moss, lily, riverstone, scree, shell, driftwood).
// `tramp` also holds a few faint game trails winding down to the water.
// gen.timings = { section: ms } (generation profile).

import { mulberry32, hash2, clamp, smoothstep } from '../engine/noise.js';

// Same Perlin / fBm as engine/noise.js (bit-identical results), specialised for worldgen speed:
// typed gradient tables, no period handling, lacunarity 2 / gain 0.5.
const GX = new Float64Array([1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float64Array([0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);
function makePerlin(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(512), base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = yi & 255, y1 = (yi + 1) & 255;
    const px0 = p[x0], px1 = p[x1];
    const a = p[px0 + y0] & 7, b = p[px1 + y0] & 7, c = p[px0 + y1] & 7, d = p[px1 + y1] & 7;
    const n00 = GX[a] * xf + GY[a] * yf, n10 = GX[b] * (xf - 1) + GY[b] * yf;
    const n01 = GX[c] * xf + GY[c] * (yf - 1), n11 = GX[d] * (xf - 1) + GY[d] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.414;
  };
}
function fbm(noise, x, y, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

export const G = { SOIL: 0, RICH: 1, SAND: 2, GRAVEL: 3, MARSH: 4, MUD: 5, STONE: 6, MOSS: 7 };
export const ROCK_NAMES = ['', 'Granito', 'Calcário', 'Ardósia', 'Mármore'];
export const ORE = { NONE: 0, COPPER: 1, IRON: 2, COAL: 3, GOLD: 4, JADE: 5 };
export const ORE_IDS = ['', 'copper', 'iron', 'coal', 'gold', 'jade'];
export const ORE_ITEM = { 1: 'copper_ore', 2: 'iron_ore', 3: 'coal', 4: 'gold_ore', 5: 'jade' };
export const ORE_NAMES_PT = ['', 'Cobre', 'Ferro', 'Carvão', 'Ouro', 'Jade'];
export const BIOMES = ['meadow', 'forest', 'pine', 'birch', 'marsh', 'shore', 'rocky', 'water', 'mountain'];
export const BIOME_NAMES_PT = ['Campina', 'Floresta', 'Pinheiral', 'Bosque de bétulas', 'Pântano', 'Margem', 'Pedregal', 'Água', 'Montanha'];
export const BIOME_ID = { MEADOW: 0, FOREST: 1, PINE: 2, BIRCH: 3, MARSH: 4, SHORE: 5, ROCKY: 6, WATER: 7, MOUNTAIN: 8 };
const B = BIOME_ID;
export const CAMP_R = 6; // bandit camp radius (tiles)

// ---------- species (art only) inside the gameplay kinds ----------
// Smooth 0..1 value noise of cell size `cell` tiles (autumn groves, pine stands): a pure function of the seed.
export function groveAt(seed, x, y, cell = 13, salt = 0) {
  const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
  let u = fx - x0, v = fy - y0;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const h = (a, b) => hash2(a, b, seed * 31 + 977 + salt);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// Tree species index for a tree of gameplay `type` at tile (tx, ty) — encoded as o.v = species * 16 + variant
// (composeWorld TREE_SPECIES). `w` = world / generator fields { seed, W, biome, dWater, dRock, ground };
// r = one uniform roll (worldgen hash or the host's net.roll for regrowth).
//   tree_oak: 0 oak · 1 maple (autumn groves) · 2 willow (banks)   tree_pine: 0 conifer · 1 scots pine · 2 juniper (dry, rocky)
//   tree_birch: 0 birch · 1 aspen (near water)                     tree_dead: 0 dead · 1 snag
export function treeSpecies(w, type, tx, ty, r) {
  const i = ty * w.W + tx;
  const b = w.biome[i], dw = w.dWater[i], dr = w.dRock[i], g = w.ground[i];
  switch (type) {
    case 'tree_oak':
      if (dw < 3.2 && b !== B.PINE && b !== B.ROCKY) return r < 0.7 ? 2 : 0;
      if (groveAt(w.seed, tx, ty, 14, 1) > 0.64) return r < 0.85 ? 1 : 0;
      return r < 0.05 ? 1 : 0;
    case 'tree_pine':
      if (b === B.ROCKY || g === G.GRAVEL || dr < 2.2) return r < 0.65 ? 2 : 0;
      return groveAt(w.seed, tx, ty, 11, 2) > 0.55 ? (r < 0.75 ? 1 : 0) : (r < 0.15 ? 1 : 0);
    case 'tree_birch': return dw < 5 ? (r < 0.45 ? 1 : 0) : (r < 0.1 ? 1 : 0);
    case 'tree_dead': return b === B.MARSH || r < 0.4 ? 1 : 0;
    default: return 0;
  }
}
// Bush species (o.v = species * 1000 + variant): 0 bush · 1 wild rose (meadows, birch groves) · 2 juniper shrub (pines, rocky)
export function bushSpecies(w, tx, ty, r) {
  const i = ty * w.W + tx, b = w.biome[i];
  if (b === B.PINE || b === B.ROCKY) return r < 0.55 ? 2 : 0;
  if (b === B.MEADOW || b === B.BIRCH) return r < 0.35 ? 1 : 0;
  return 0;
}
// Boulder look: mossy in the woods (o.v ≥ 8000)
export const boulderMossy = (w, tx, ty) => { const b = w.biome[ty * w.W + tx]; return b === B.FOREST || b === B.BIRCH || b === B.PINE || b === B.MARSH; };

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
  const pE = P(1), pR = P(2), pM = P(3), pF = P(4), pT = P(5), pS = P(6), pK = P(7);
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
  const timings = {};
  let tLap = performance.now();
  const lap = (k) => { const t = performance.now(); timings[k] = Math.round((t - tLap) * 10) / 10; tLap = t; };

  lap('start');
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

  lap('mount');
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

  lap('lakes');
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

  lap('river');
  // ---------- distances ----------
  const dWater = distanceField(W, H, (i) => water[i] > 0);
  const dRock = distanceField(W, H, (i) => rock[i] > 0);
  const dLand = distanceField(W, H, (i) => rock[i] === 0); // depth inside mountains
  const dLake = distanceField(W, H, (i) => lakeMask[i] > 0);

  lap('dist');
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

  lap('clear');
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

  lap('biomes');
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
  }

  lap('ground');
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
  // medicinal herb bush clusters: shady, damp spots (birch groves, forest floor, marsh edges, meadows by water).
  // Own rng + hash salts so adding them leaves every other object where it was.
  const herbC = [];
  {
    const hrand = mulberry32(seed * 977 + 41);
    for (let tries = 0; tries < 900 && herbC.length < 26; tries++) {
      const x = 6 + hrand() * (W - 12), y = 6 + hrand() * (H - 12);
      const i = idx(Math.floor(x), Math.floor(y));
      if (!canPlant(i)) continue;
      const b = biome[i];
      const ok = b === B.BIRCH || (b === B.FOREST && forest[i] > FT + 0.04) || (b === B.MARSH && dWater[i] > 1.5) || (b === B.MEADOW && dWater[i] < 7 && moist[i] > 0);
      if (ok) herbC.push({ x, y });
    }
  }
  const herbMask = new Uint8Array(N); // tiles within √5 of a cluster centre
  for (const c of herbC) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = Math.floor(c.x) + dx, y = Math.floor(c.y) + dy;
    if (inB(x, y) && (c.x - x - 0.5) ** 2 + (c.y - y - 0.5) ** 2 < 5) herbMask[idx(x, y)] = 1;
  }

  const SPW = { seed, W, biome, dWater, dRock, ground }; // species helpers' view of the generator
  const treeFree = (x, y, R) => {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (inB(x + dx, y + dy) && occupied[idx(x + dx, y + dy)] === 1) return false;
    return true;
  };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y);
    if (!canPlant(i)) continue;
    const b = biome[i];
    const r = hash2(x, y, seed + 101);
    const fo = forest[i];
    // weeping willows leaning over the river banks and lake shores (roomy: no other tree within 2 tiles)
    if (dWater[i] >= 1.1 && dWater[i] < 3.0 && b !== B.ROCKY && b !== B.PINE && ground[i] !== G.STONE && hash2(x, y, seed + 611) < 0.032 && treeFree(x, y, 2)) {
      const h = hash2(x, y, seed + 612);
      objects.push({ id: oid++, type: 'tree_oak', v: 32 + Math.floor(h * 16), x: x + 0.5 + (h - 0.5) * 0.3, y: y + 0.6, s: 0.9 + hash2(x, y, seed + 613) * 0.25, f: dWater[i] < 2 && h < 0.5 ? -1 : 1, age: 1 });
      occupied[i] = 1;
      continue;
    }
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
        const sp = treeSpecies(SPW, kind, x, y, hash2(x, y, seed + 9));
        objects.push({ id: oid++, type: kind, v: sp * 16 + Math.floor(hash2(x, y, seed + 5) * 16), x: x + 0.5 + jx, y: y + 0.6 + jy, s: 0.85 + big + hash2(x, y, seed + 6) * 0.35, f: hash2(x, y, seed + 7) < 0.5 ? -1 : 1, age: 1 });
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
      objects.push({ id: oid++, type: 'bush', v: bushSpecies(SPW, x, y, hash2(x, y, seed + 207)) * 1000 + Math.floor(r2 * 1000), x: x + 0.5 + (r - 0.5) * 0.4, y: y + 0.6, s: 0.75 + r * 0.45, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 2;
      continue;
    }
    const r3 = hash2(x, y, seed + 303);
    const pRock = b === B.ROCKY ? 0.06 : dRock[i] < 5 ? 0.02 : b === B.SHORE ? 0.006 : 0.0022;
    if (r3 < pRock) {
      objects.push({ id: oid++, type: 'boulder', v: (boulderMossy(SPW, x, y) ? 8000 : 0) + Math.floor(r3 * 7919), x: x + 0.5 + (r - 0.5) * 0.3, y: y + 0.6, s: 0.6 + r * 0.55, f: r < 0.5 ? -1 : 1 });
      occupied[i] = 3;
      continue;
    }
    const r4 = hash2(x, y, seed + 4041);
    if (b !== B.SHORE && b !== B.ROCKY && ground[i] !== G.MARSH && herbMask[i] && r4 < 0.13) {
      const h5 = hash2(x, y, seed + 4051);
      objects.push({ id: oid++, type: 'herbbush', v: Math.floor(h5 * 1000), x: x + 0.5 + (h5 - 0.5) * 0.4, y: y + 0.6, s: 0.8 + r4 * 2.2, f: h5 < 0.5 ? -1 : 1 });
      occupied[i] = 2;
    }
  }

  lap('plants');
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
  const flowerZA = new Float32Array(N), flowerCA = new Uint8Array(N); // flower meadow strength / colour per tile
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
          decor.push({ t: 'reed', v: Math.floor(h1 * 997), x: x + h1, y: y + h2, s: 0.8 + h2 * 0.4, f: h1 < 0.5 ? -1 : 1, w: 1 }); // w: stands in water (waterline)
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
    flowerZA[i] = fz; flowerCA[i] = fc;
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
    const r = 1.0 + rand() * 1.1, n = 9 + Math.floor(rand() * 7), v = [0, 1, 3, 0][Math.floor(rand() * 4)]; // fairy rings: brown, fly agaric, puffballs
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
  // meadows and birch groves read greener (short turf in the terrain shader follows `lush`)
  for (let i = 0; i < N; i++) if (biome[i] === B.MEADOW || biome[i] === B.BIRCH) lush[i] = Math.min(1, lush[i] + 0.07);
  lap('decor');
  addNatureDetails();

  // Undergrowth, ground details and water edges (decor only; own hash salts so the classic decor above and
  // every object keep their places). Flat kinds lie on the ground (composeWorld FLAT_DECOR).
  function addNatureDetails() {
    const D = (t, v, x, y, s, f) => decor.push({ t, v, x, y, s, f });
    const dLandW = distanceField(W, H, (i) => !water[i]);
    // fallen leaves / needles / twigs under the trees (colour by species)
    for (const o of objects) {
      if (!o.type.startsWith('tree_')) continue;
      const sp = o.v >> 4, h0 = hash2(o.id, 3, seed + 1101);
      let t = 'litter', v = h0 < 0.5 ? 0 : 1;
      if (o.type === 'tree_pine') { if (sp === 2) continue; t = 'needles'; v = h0 < 0.6 ? 0 : 1; }
      else if (o.type === 'tree_oak') v = sp === 1 ? 2 + (h0 < 0.5 ? 0 : 1) : sp === 2 ? 0 : v;
      else if (o.type === 'tree_birch') v = 4;
      else { t = 'twigs'; v = h0 < 0.5 ? 0 : 1; }
      const n = (sp === 1 && o.type === 'tree_oak' ? 3 : 1) + Math.floor(hash2(o.id, 5, seed + 1102) * 2);
      for (let k = 0; k < n; k++) {
        const a = hash2(o.id, 7 + k, seed + 1103) * Math.PI * 2, r = (0.25 + hash2(o.id, 11 + k, seed + 1104) * 0.85) * o.s;
        const x = o.x + Math.cos(a) * r, y = o.y + 0.05 + Math.sin(a) * r * 0.55;
        const tx = Math.floor(x), ty = Math.floor(y);
        if (!inB(tx, ty) || !canPlant(idx(tx, ty))) continue;
        D(t, v, x, y, 0.75 + hash2(o.id, 13 + k, seed + 1105) * 0.5, a < 3.14 ? 1 : -1);
      }
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      const h = hash2(x, y, seed + 1201), hv = hash2(x, y, seed + 1202);
      const px = x + hash2(x, y, seed + 1203), py = y + hash2(x, y, seed + 1204);
      const f = hv < 0.5 ? -1 : 1, s = 0.8 + hash2(x, y, seed + 1205) * 0.4;
      if (water[i]) {
        // still water near the shore: lily pads in patches; shallow rivers: stones
        const flowing = Math.hypot(flowX[i], flowY[i]) > 0.2;
        if (!flowing && dLandW[i] <= 2.6) {
          const p = groveAt(seed, x, y, 5, 7) > 0.45 ? 0.26 : 0.035;
          if (h < p) { D('lily', hv < 0.35 ? 1 + (hv < 0.12 ? 1 : 0) : (hv < 0.7 ? 0 : 3), px, py, s, f); decor[decor.length - 1].w = water[i]; }
        } else if (flowing && water[i] === 1 && h < 0.07) { D('riverstone', Math.floor(hv * 3), px, py, s, f); decor[decor.length - 1].w = 1; }
        continue;
      }
      if (!canPlant(i)) continue;
      const b = biome[i], g = ground[i], dr = dRock[i], dw = dWater[i];
      const woods = b === B.FOREST || b === B.BIRCH || b === B.PINE;
      // foot of the cliffs: scree, ferns and moss in the shade of the rock
      if (dr < 1.6) {
        if (h < 0.24) { D('scree', Math.floor(hv * 2), px, py, s, f); continue; }
        if (h < 0.31 && b !== B.SHORE) { D('fern', Math.floor(hv * 4), px, py, s, f); continue; }
        if (h < 0.37 && b !== B.SHORE) { D('moss', Math.floor(hv * 3), px, py, s, f); continue; }
      }
      // banks: wet stones, driftwood on sand
      if (dw <= 1.2) {
        if ((g === G.SAND || g === G.GRAVEL) && h < 0.05) { D('riverstone', Math.floor(hv * 3), px, py, s, f); continue; }
        if (g === G.SAND && h > 0.994) { D('driftwood', 0, px, py, s, f); continue; }
      }
      const cl = b === B.MEADOW || b === B.MARSH || b === B.SHORE ? 0.5 : groveAt(seed, x, y, 6, 5);
      let p;
      switch (b) {
        case B.FOREST: case B.BIRCH: case B.PINE: {
          p = (g === G.MOSS ? 0.075 : 0.035) * (cl > 0.55 ? 2.2 : 0.6) * (b === B.PINE ? 0.7 : 1);
          if (h < p) { D('fern', Math.floor(hv * 4), px, py, s, f); break; }
          if (h < p + 0.03) { D('moss', Math.floor(hv * 3), px, py, s, f); break; }
          if (h < p + 0.042) { D('twigs', Math.floor(hv * 2), px, py, s, f); break; }
          const pb = b === B.BIRCH ? 0.035 : b === B.FOREST ? 0.012 : 0;
          if (h > 1 - pb && groveAt(seed, x, y, 8, 9) > 0.45) { D('bloom', 2, px, py, s, f); break; }
          if (b === B.PINE && g !== G.MOSS && h > 0.985) D('heather', Math.floor(hv * 2), px, py, s, f);
          break;
        }
        case B.MEADOW: {
          const fo = forest[i];
          if (Math.abs(fo - FT) < 0.05 && h < 0.03) { D('fern', Math.floor(hv * 4), px, py, s, f); break; } // forest edge
          const fz = flowerZA[i], fc = flowerCA[i];
          if (fz > 0.15 && h < 0.08 + fz * 0.12) { D('bloom', fc & 1, px, py, s, f); break; }
          if (fz > 0.35 && h > 0.96) { D('petals', fc === 3 ? 1 : 0, px, py, s, f); break; }
          if (h > 0.993) { D('bloom', hv < 0.5 ? 0 : 1, px, py, s, f); break; }
          if (moist[i] < -0.12 && h < 0.006) D('thistle', Math.floor(hv * 2), px, py, s, f);
          break;
        }
        case B.MARSH:
          if (h < 0.025) D('bloom', 3, px, py, s, f);
          else if (h < 0.05) D('moss', Math.floor(hv * 3), px, py, s, f);
          else if (h < 0.06) D('fern', Math.floor(hv * 4), px, py, s, f);
          break;
        case B.SHORE:
          if (g === G.SAND && h < 0.05) D('shell', Math.floor(hv * 2), px, py, s, f);
          else if (h < 0.06 && dw > 1.2) D('drygrass', Math.floor(hv * 2), px, py, s, f);
          else if (h > 0.985 && dw > 1.5) D('bloom', 4, px, py, s, f);
          break;
        case B.ROCKY:
          if (h < 0.08) D('drygrass', Math.floor(hv * 2), px, py, s, f);
          else if (h < 0.13 && cl > 0.45) D('heather', Math.floor(hv * 2), px, py, s, f);
          else if (h < 0.1 && g === G.GRAVEL) D('scree', Math.floor(hv * 2), px, py, s, f);
          else if (h > 0.985) D('bloom', 5, px, py, s, f);
          else if (h > 0.978) D('thistle', Math.floor(hv * 2), px, py, s, f);
          break;
      }
    }
  }

  lap('details');
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

  lap('spawn');
  // ---------- reachability from the spawn (walkable: no rock, no deep water) ----------
  const reach = new Uint8Array(N);
  {
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    const s0 = idx(Math.floor(spawn.x), Math.floor(spawn.y));
    reach[s0] = 1; q[qt++] = s0;
    const walk = (j) => { if (!reach[j] && !rock[j] && water[j] !== 2) { reach[j] = 1; q[qt++] = j; } };
    while (qh < qt) {
      const i = q[qh++], x = i % W;
      if (x > 0) walk(i - 1);
      if (x < W - 1) walk(i + 1);
      if (i >= W) walk(i - W);
      if (i < N - W) walk(i + W);
    }
  }

  lap('reach');
  // ---------- bandit camps: open dry ground far from the spawn, trampled, joined by dirt trails ----------
  const tramp = new Uint8Array(N); // 0..255 trampled ground (camps + trails)
  const camps = [];
  {
    const crand = mulberry32(seed * 613 + 29);
    const want = 2 + Math.floor(crand() * 3);
    const R = CAMP_R, RR = R + 1;
    const cands = [];
    for (let k = 0; k < 700; k++) {
      const x = 14 + Math.floor(crand() * (W - 28)), y = 14 + Math.floor(crand() * (H - 28));
      const ds = Math.hypot(x + 0.5 - spawn.x, y + 0.5 - spawn.y);
      const i = idx(x, y);
      const b = biome[i];
      if (ds < 62 || dRock[i] < R + 2.5 || dWater[i] < R + 1.5) continue;
      if (b !== B.MEADOW && b !== B.FOREST && b !== B.BIRCH && b !== B.PINE) continue;
      let bad = 0, open = 0, trees = 0, n = 0;
      for (let dy = -RR; dy <= RR && !bad; dy++) for (let dx = -RR; dx <= RR; dx++) {
        if (dx * dx + dy * dy > RR * RR) continue;
        const j = idx(x + dx, y + dy);
        n++;
        if (rock[j] || water[j] || biome[j] === B.MARSH) { bad = 1; break; }
        if (biome[j] === B.MEADOW) open++;
        if (occupied[j] === 1) trees++;
      }
      if (bad) continue;
      const score = (open / n) * 3 - trees * 0.05 + (reach[i] ? 4 : 0) - Math.abs(ds - 88) * 0.012 + crand() * 0.6;
      cands.push({ x: x + 0.5, y: y + 0.5, score });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const minD of [58, 40, 26]) {
      for (const c of cands) {
        if (camps.length >= want) break;
        if (camps.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < minD)) continue;
        camps.push(c);
      }
      if (camps.length >= 2) break;
    }
    const markT = (x, y, v) => {
      if (!inB(x, y)) return;
      const j = idx(x, y);
      if (rock[j] || water[j]) return;
      if (v > tramp[j]) tramp[j] = v;
    };
    for (const c of camps) {
      zones.push({ type: 'bandit_camp', x: c.x, y: c.y, r: R });
      // trampled disc: packed soil with muddy patches, little grass
      const RE = R + 3;
      for (let dy = -RE; dy <= RE; dy++) for (let dx = -RE; dx <= RE; dx++) {
        const x = Math.floor(c.x) + dx, y = Math.floor(c.y) + dy;
        if (!inB(x, y)) continue;
        const j = idx(x, y);
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / R + fbm(pQ, x / 3.5 + 7, y / 3.5, 2) * 0.28;
        const t = smoothstep(1.18, 0.62, d);
        if (t <= 0) continue;
        markT(x, y, Math.round(t * 255));
        lush[j] *= 1 - 0.85 * t;
        if (d < 0.9 && !rock[j] && !water[j]) ground[j] = d < 0.75 && fbm(pS, x / 4 + 3, y / 4, 2) > 0.34 ? G.MUD : G.SOIL;
      }
      // 2..3 meandering dirt trails leading away from the camp
      const nT = 2 + Math.floor(crand() * 2);
      for (let k = 0; k < nT; k++) {
        let ang = (k / nT) * Math.PI * 2 + crand() * 1.2, px = c.x + Math.cos(ang) * R * 0.6, py = c.y + Math.sin(ang) * R * 0.6;
        const len = 14 + crand() * 16;
        for (let s = 0; s < len; s += 0.5) {
          ang += (crand() - 0.5) * 0.32;
          px += Math.cos(ang) * 0.5; py += Math.sin(ang) * 0.5;
          const tx = Math.floor(px), ty = Math.floor(py);
          if (!inB(tx, ty) || rock[idx(tx, ty)] || water[idx(tx, ty)]) break;
          const fade = 1 - (s / len) * 0.55;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const w = Math.max(0, 1 - Math.hypot(tx + dx + 0.5 - px, ty + dy + 0.5 - py) / 1.15);
            if (w > 0) markT(tx + dx, ty + dy, Math.round(w * fade * 200));
          }
          const j = idx(tx, ty);
          lush[j] *= 0.6;
          if (ground[j] !== G.SAND && ground[j] !== G.GRAVEL) ground[j] = G.SOIL;
        }
      }
    }
    // game trails: a few faint worn paths winding from the meadows and woods down to the water, around the trees
    {
      const trand = mulberry32(seed * 389 + 17);
      const nTr = 4 + Math.floor(trand() * 3);
      const dwAt = (x, y) => dWater[idx(clamp(x, 0, W - 1), clamp(y, 0, H - 1))];
      for (let k = 0, tries = 0; k < nTr && tries < 300; tries++) {
        let px = 16 + trand() * (W - 32), py = 16 + trand() * (H - 32);
        const i0 = idx(Math.floor(px), Math.floor(py));
        if (!canPlant(i0) || dWater[i0] < 9 || dWater[i0] > 45 || biome[i0] === B.MARSH || tramp[i0] || Math.hypot(px - spawn.x, py - spawn.y) < 6) continue;
        k++;
        let ang = trand() * Math.PI * 2;
        const len = 34 + trand() * 40;
        for (let s = 0; s < len; s += 0.5) {
          const tx = Math.floor(px), ty = Math.floor(py);
          if (dWater[idx(tx, ty)] < 1.3) break; // reached the water
          const gx = dwAt(tx + 1, ty) - dwAt(tx - 1, ty), gy = dwAt(tx, ty + 1) - dwAt(tx, ty - 1);
          let da = Math.atan2(-gy, -gx) - ang;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          ang += da * 0.07 + (trand() - 0.5) * 0.36;
          for (let t2 = 0; t2 < 5; t2++) { // swerve around trees ahead
            const ax = Math.floor(px + Math.cos(ang) * 0.9), ay = Math.floor(py + Math.sin(ang) * 0.9);
            if (!inB(ax, ay) || occupied[idx(ax, ay)] !== 1) break;
            ang += (t2 & 1 ? -1 : 1) * 0.6 * (t2 + 1);
          }
          px += Math.cos(ang) * 0.5; py += Math.sin(ang) * 0.5;
          const nx = Math.floor(px), ny = Math.floor(py);
          if (!inB(nx, ny) || rock[idx(nx, ny)] || water[idx(nx, ny)]) break;
          const fade = Math.min(1, s / 6, (len - s) / 6);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const ww = Math.max(0, 1 - Math.hypot(nx + dx + 0.5 - px, ny + dy + 0.5 - py) / 0.95);
            if (ww > 0 && occupied[idx(clamp(nx + dx, 0, W - 1), clamp(ny + dy, 0, H - 1))] !== 1) markT(nx + dx, ny + dy, Math.round(ww * fade * 84));
          }
          lush[idx(nx, ny)] *= 0.8;
        }
      }
    }
    // clear the camp grounds (Combat places tents / fire there)
    {
      for (let k = objects.length - 1; k >= 0 && camps.length; k--) {
        const o = objects[k];
        for (const c of camps) {
          if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 < (R + 0.6) ** 2) {
            occupied[idx(Math.floor(o.x), Math.floor(o.y))] = 0;
            objects.splice(k, 1);
            break;
          }
        }
      }
      // grass and flowers thin out on the trampled ground (in-place compaction)
      let w = 0;
      for (let k = 0; k < decor.length; k++) {
        const d = decor[k];
        const t = tramp[idx(clamp(Math.floor(d.x), 0, W - 1), clamp(Math.floor(d.y), 0, H - 1))] / 255;
        if (t > 0 && hash2(k, 77, seed) < t * (d.t === 'flower' ? 1.2 : 0.93)) continue;
        decor[w++] = d;
      }
      decor.length = w;
    }
  }

  lap('camps');
  // ---------- small natural objects: pebbles, sticks, fibre grass, wild crops ----------
  const small = new Uint8Array(N); // tile already holds a small object
  const freeTile = (i) => canPlant(i) && !occupied[i] && !small[i] && tramp[i] < 30;
  const nearSpawn = (x, y) => (x - spawn.x) ** 2 + (y - spawn.y) ** 2 < 2.2 * 2.2;
  const addSmall = (type, v, x, y, s, f) => {
    objects.push({ id: oid++, type, v, x, y, s, f });
    small[idx(Math.floor(x), Math.floor(y))] = 1;
  };
  {
    // sticks fall under the trees (forests and dead trees)
    const nTrees = objects.length;
    for (let k = 0; k < nTrees; k++) {
      const o = objects[k];
      if (!o.type.startsWith('tree_')) continue;
      const ti = idx(Math.floor(o.x), Math.floor(o.y));
      const b = biome[ti];
      const forestish = b === B.FOREST || b === B.PINE || b === B.BIRCH || o.type === 'tree_dead';
      const h = hash2(o.id, 17, seed + 901);
      if (h > (forestish ? 0.24 : 0.08)) continue;
      const a = hash2(o.id, 23, seed + 902) * Math.PI * 2, r = 0.75 + hash2(o.id, 29, seed + 903) * 0.95;
      const x = o.x + Math.cos(a) * r, y = o.y + Math.sin(a) * r * 0.8 + 0.1;
      if (!inB(Math.floor(x), Math.floor(y))) continue;
      const i = idx(Math.floor(x), Math.floor(y));
      if (!freeTile(i) || nearSpawn(x, y)) continue;
      addSmall('stick', Math.floor(h * 1000) % 3, x, y, 0.85 + hash2(o.id, 31, seed) * 0.3, hash2(o.id, 37, seed) < 0.5 ? -1 : 1);
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!freeTile(i)) continue;
      const b = biome[i], g = ground[i];
      const cx = x + 0.5, cy = y + 0.5;
      if (nearSpawn(cx, cy)) continue;
      const h = hash2(x, y, seed + 911), hv = hash2(x, y, seed + 912);
      const jx = (hash2(x, y, seed + 913) - 0.5) * 0.6, jy = (hash2(x, y, seed + 914) - 0.5) * 0.5;
      const f = hv < 0.5 ? -1 : 1;
      // pebbles: gravel, rocky ground, shores / river banks, mountain feet; sparse elsewhere
      let pP = b === B.ROCKY || g === G.GRAVEL ? 0.07 : b === B.SHORE ? 0.045 : 0;
      if (dRock[i] < 5) pP = Math.max(pP, 0.05 * (1 - dRock[i] / 6));
      if (!pP) pP = b === B.MEADOW ? 0.0095 : b === B.MARSH ? 0.002 : 0.0055;
      if (h < pP) {
        addSmall('pebble', Math.floor(hv * 4), cx + jx, cy + jy, 0.8 + hv * 0.35, f);
        continue;
      }
      const h2 = hash2(x, y, seed + 921);
      // stray sticks on the forest floor
      if ((b === B.FOREST || b === B.PINE || b === B.BIRCH) && h2 < 0.0035) {
        addSmall('stick', Math.floor(hv * 3), cx + jx, cy + jy, 0.85 + hv * 0.3, f);
        continue;
      }
      // fibre grass: meadows (in moist patches), marsh edges, forest clearings
      const fo = forest[i];
      let pF = 0;
      if (b === B.MEADOW) pF = 0.007 + 0.034 * smoothstep(-0.15, 0.3, moist[i] + (fert[i] - 0.1) * 0.5);
      else if (b === B.MARSH) pF = g === G.MUD ? 0.03 : 0.012;
      else if (b === B.FOREST || b === B.BIRCH) pF = fo < FT + 0.07 ? 0.016 : 0.003;
      else if (b === B.PINE) pF = 0.002;
      else if (b === B.SHORE && dWater[i] > 1.2) pF = 0.006;
      if (h2 > 0.004 && h2 < 0.004 + pF) {
        addSmall('fibergrass', Math.floor(hv * 3), cx + jx, cy + jy, 0.85 + hv * 0.35, f);
        continue;
      }
      // wild crops (rare, little groups)
      const h3 = hash2(x, y, seed + 931);
      let wild = null;
      if (b === B.MEADOW || ((b === B.FOREST || b === B.BIRCH) && Math.abs(fo - FT) < 0.09 && g !== G.MOSS)) {
        if (h3 < 0.0033) wild = 'wild_potato'; // (3x: food to stock before the winter)
        else if (b === B.MEADOW && h3 < 0.0042 && fert[i] > -0.05 && dWater[i] > 3) wild = 'wild_corn';
      }
      if (!wild && (b === B.MEADOW || b === B.SHORE) && dWater[i] > 1.4 && dWater[i] < 9 && g !== G.GRAVEL && h3 > 0.996) wild = 'wild_cotton';
      if (wild) {
        addSmall(wild, 0, cx + jx, cy + jy, 0.9 + hv * 0.22, f);
        // 0..2 companions next to it
        const nb = Math.floor(hash2(x, y, seed + 932) * 3);
        for (let k = 0; k < nb; k++) {
          const a = hash2(x + k, y, seed + 933) * Math.PI * 2;
          const ox = cx + Math.cos(a) * 1.1, oy = cy + Math.sin(a) * 1.1;
          const j = idx(Math.floor(ox), Math.floor(oy));
          if (freeTile(j) && biome[j] === b) addSmall(wild, 0, ox, oy, 0.85 + hash2(x, y + k, seed + 934) * 0.25, a < 3.14 ? 1 : -1);
        }
      }
    }
  }

  lap('small');
  // ---------- guarantee the first gatherables around the spawn (reachable, dry) ----------
  {
    const RG = 14, sx = spawn.x, sy = spawn.y;
    const okTile = (i) => reach[i] && !water[i] && !rock[i];
    const need = { pebble: 10, stick: 8, fibergrass: 8, berrybush: 2, herbbush: 1 };
    const have = { pebble: 0, stick: 0, fibergrass: 0, berrybush: 0, herbbush: 0 };
    for (const o of objects) {
      if (have[o.type] === undefined || (o.x - sx) ** 2 + (o.y - sy) ** 2 > RG * RG) continue;
      if (okTile(idx(Math.floor(o.x), Math.floor(o.y)))) have[o.type]++;
    }
    const grand = mulberry32(seed * 53 + 11);
    const cands = [];
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    for (let dy = -RG; dy <= RG; dy++) for (let dx = -RG; dx <= RG; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (!inB(x, y)) continue;
      const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
      const i = idx(x, y);
      if (d < 2.6 || d > 13.2 || !okTile(i) || !freeTile(i)) continue;
      // near a tree? (sticks)
      let tree = 0;
      for (let ky = -2; ky <= 2 && !tree; ky++) for (let kx = -2; kx <= 2; kx++) if (inB(x + kx, y + ky) && occupied[idx(x + kx, y + ky)] === 1) { tree = 1; break; }
      cands.push({ x, y, i, d, tree, r: grand() });
    }
    const pref = {
      pebble: (c) => (ground[c.i] === G.GRAVEL || ground[c.i] === G.SAND || dRock[c.i] < 6 ? 2 : 0) + (dWater[c.i] < 3 ? 1 : 0),
      stick: (c) => c.tree * 3 + (dForest[c.i] < 2 ? 1 : 0),
      fibergrass: (c) => (biome[c.i] === B.MEADOW ? 1 : 0) + lush[c.i] * 2,
      berrybush: (c) => (dForest[c.i] > 0.5 && dForest[c.i] < 4 ? 2 : 0) + (biome[c.i] === B.MEADOW ? 0.5 : 0),
      herbbush: (c) => (dForest[c.i] < 3 ? 2 : 0) + c.d * 0.12 + (dWater[c.i] < 6 ? 0.5 : 0),
    };
    const place = (type, c) => {
      const jx = (grand() - 0.5) * 0.5, jy = (grand() - 0.5) * 0.4, f = grand() < 0.5 ? -1 : 1;
      const x = c.x + 0.5 + jx, y = c.y + 0.55 + jy;
      if (type === 'berrybush' || type === 'herbbush') {
        objects.push({ id: oid++, type, v: Math.floor(grand() * 1000), x, y: c.y + 0.6, s: 0.85 + grand() * 0.3, f });
        occupied[c.i] = 2;
      } else addSmall(type, Math.floor(grand() * (type === 'pebble' ? 4 : 3)), x, y, 0.85 + grand() * 0.3, f);
      c.used = true;
    };
    for (const type of ['berrybush', 'stick', 'fibergrass', 'pebble', 'herbbush']) {
      let miss = need[type] - have[type];
      if (miss <= 0) continue;
      const P = pref[type];
      cands.sort((a, b) => (P(b) - b.d * 0.09 + b.r * 0.8) - (P(a) - a.d * 0.09 + a.r * 0.8));
      for (const c of cands) {
        if (miss <= 0) break;
        if (c.used || occupied[c.i] || small[c.i]) continue;
        place(type, c);
        miss--;
        // berry bushes come in pairs
        if (type === 'berrybush' && miss > 0) {
          const c2 = cands.find((o) => !o.used && !occupied[o.i] && !small[o.i] && Math.abs(o.x - c.x) + Math.abs(o.y - c.y) === 1);
          if (c2) { place(type, c2); miss--; }
        }
      }
    }
  }

  lap('guar');
  // ---------- ore veins (clustered, by depth inside the rock) ----------
  {
    const orand = mulberry32(seed * 131 + 77);
    const edge = [], mid = [], deep = [];
    for (let i = 0; i < N; i++) {
      if (!rock[i]) continue;
      const d = dLand[i];
      if (d <= 6.5) edge.push(i);
      if (d >= 3) mid.push(i);
      if (d >= 6) deep.push(i);
    }
    const ok = (i, minD, maxD) => rock[i] && !ore[i] && dLand[i] >= minD && dLand[i] <= maxD;
    // random walk with optional widening; elongated walks make seams, twisty ones make blobs
    const grow = (type, start, size, minD, maxD, turn, widen) => {
      let x = start % W, y = (start / W) | 0, ang = orand() * Math.PI * 2, placed = 0;
      for (let step = 0; step < size * 4 && placed < size; step++) {
        const i = idx(x, y);
        if (ok(i, minD, maxD)) { ore[i] = type; placed++; }
        if (orand() < widen) {
          const nx = x + Math.floor(orand() * 3) - 1, ny = y + Math.floor(orand() * 3) - 1;
          if (inB(nx, ny) && ok(idx(nx, ny), minD, maxD) && placed < size) { ore[idx(nx, ny)] = type; placed++; }
        }
        ang += (orand() - 0.5) * turn;
        const nx = Math.round(x + Math.cos(ang)), ny = Math.round(y + Math.sin(ang));
        if (inB(nx, ny) && rock[idx(nx, ny)]) { x = nx; y = ny; } else ang += Math.PI * (0.5 + orand());
      }
      return placed;
    };
    const veins = (type, list, per, minN, sMin, sMax, minD, maxD, turn, widen) => {
      if (!list.length) return;
      const n = Math.max(minN, Math.round(list.length / per));
      for (let k = 0; k < n; k++) {
        const s = list[Math.floor(orand() * list.length)];
        grow(type, s, sMin + Math.floor(orand() * (sMax - sMin + 1)), minD, maxD, turn, widen);
      }
    };
    // rare first so the common veins never overwrite them
    veins(ORE.GOLD, deep, 1400, 1, 2, 5, 6, 999, 2.2, 0.35);
    veins(ORE.JADE, deep, 1500, 1, 2, 6, 6, 999, 1.6, 0.4);
    veins(ORE.IRON, mid, 700, 2, 6, 14, 3, 999, 1.5, 0.5);
    veins(ORE.COPPER, edge, 330, 2, 5, 12, 1, 6.5, 1.8, 0.55);
    veins(ORE.COAL, edge, 270, 2, 7, 18, 1, 6.5, 0.45, 0.3);
    // a copper vein and a coal seam showing on a rock face reasonably close to the spawn
    const faces = [];
    for (const i of edge) if (dLand[i] <= 2.5) faces.push(i);
    const near = (type, R) => {
      for (const i of faces) if (ore[i] === type && Math.hypot((i % W) - spawn.x, ((i / W) | 0) - spawn.y) < R) return true;
      return false;
    };
    faces.sort((a, b) => Math.hypot((a % W) - spawn.x, ((a / W) | 0) - spawn.y) - Math.hypot((b % W) - spawn.x, ((b / W) | 0) - spawn.y));
    let firstFace = -1;
    for (const [type, size] of [[ORE.COPPER, 6], [ORE.COAL, 7]]) {
      if (near(type, 48)) continue;
      for (const i of faces) {
        if (ore[i] || dLand[i] > 1.5) continue;
        if (firstFace >= 0 && Math.hypot((i % W) - (firstFace % W), ((i / W) | 0) - ((firstFace / W) | 0)) < 5) continue;
        grow(type, i, size, 1, 4, 1.4, 0.5);
        firstFace = i;
        break;
      }
    }
  }

  lap('ore');
  // ---------- mountain roof: original rock ≥ 2 tiles deep (mined tiles there become caves) ----------
  const roof = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (rock[i] && dLand[i] >= 2) roof[i] = 1;

  lap('roof');
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

  lap('zones');
  return { timings, seed, W, H, rock, water, ground, rockType, ore, roof, tramp, lush, flowX, flowY, objects, decor, spawn, dWater, dRock, biome, zones };
}
