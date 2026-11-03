// Fauna spawning by planet biome (docs/FAUNA.md §Spawn). Two parts:
//
// 1) spawnsForChunk(grid, rng, opts) — PURE (no game, no DOM, no Math.random): the creature groups of one chunk from
//    its layers and the per-biome tables (content/fauna.js FAUNA_SPAWNS). The streaming engine calls it per chunk when
//    a chunk becomes active (seeded by the chunk's planet coordinates: chunkRng), the ?planet=1 hook below for the whole
//    cut. Same grid + same rng = same groups, on any peer.
//      grid = { size,                       tiles per side (64 for a planet chunk)
//               biome: Uint8Array(size²),   planet biome ids (world/planet/biomes.js BIOME_LIST)
//               water?: Uint8Array,         0 land · 1 shallow · 2 deep · 3 abyss
//               rock?: Uint8Array,          1 = rock mass
//               height?: Float32Array,      corner heights (size+1)², stories (the chunk's `height`)
//               trees?: Uint8Array,         1 = a tree stands on the tile (the 'trees' rows; skipped when absent)
//               x0?, y0? }                  world tile of the grid's corner (added to the positions)
//      rng  = () => [0, 1)  (mulberry32 of chunkRng(seed, cx, cy))
//      opts = { tables?, density? (× every row), gap? (tiles between groups, default 6), exclude?(x, y) → true to skip }
//    → [{ species, x, y, count, when, biome, on }]   x, y = tile centre (+ x0 / y0); when = the species' hours
//
// 2) createFaunaSpawners(game, { levelFor, whenOf, firstId }) — the ?planet=1 hook (mobs.js createSpawners): the
//    in-game cut walked in 64 × 64 blocks aligned to the planet's chunks (world.planetAt), each block through
//    spawnsForChunk with its own chunk seed, turned into mobs.js spawners (level by distance from the spawn like every
//    spawner, min distance from the spawn per species, fish schools as livestock fish spawners).

import { FAUNA_SPAWNS, FAUNA } from './content/fauna.js';
import { SPECIES } from './data.js';
import { BIOME_KEYS } from '../world/planet/biomes.js';
import { mulberry32 } from '../engine/noise.js';

const CHUNK = 64;
// hours of a species: the fauna table, else the classic creatures' (mobs.js ACTIVE, passed in), else 'always'
const whenDefault = (sp) => FAUNA[sp]?.when || (sp === 'wolf' ? 'night' : sp === 'boar' || sp === 'bear' || sp === 'fish' ? 'always' : 'day');

// a chunk's seed from the world seed and its planet chunk coordinates (stable whatever window / streaming cut holds it)
export function chunkRng(seed, cx, cy) {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(cx | 0, 0x27d4eb2f) ^ Math.imul(cy | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return mulberry32(h >>> 0);
}

export function spawnsForChunk(grid, rng, opts = {}) {
  const S = grid.size, N = S * S, B = grid.biome, Wt = grid.water, Rk = grid.rock, Hc = grid.height, Tr = grid.trees;
  const tables = opts.tables || FAUNA_SPAWNS, dens = opts.density ?? 1, gap = opts.gap ?? 6, x0 = grid.x0 || 0, y0 = grid.y0 || 0;
  const wat = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? -1 : Wt ? Wt[y * S + x] : 0);
  const any = (x, y, r, f) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const u = x + dx, v = y + dy; if (u >= 0 && v >= 0 && u < S && v < S && f(u, v)) return true; } return false; };
  const tileH = (x, y) => (Hc ? (Hc[y * (S + 1) + x] + Hc[y * (S + 1) + x + 1] + Hc[(y + 1) * (S + 1) + x] + Hc[(y + 1) * (S + 1) + x + 1]) / 4 : 0);
  const steep = (x, y) => Hc && Math.max(Math.abs(Hc[y * (S + 1) + x] - Hc[(y + 1) * (S + 1) + x + 1]), Math.abs(Hc[y * (S + 1) + x + 1] - Hc[(y + 1) * (S + 1) + x])) > 0.9;
  const fits = (on, x, y) => {
    const i = y * S + x, w = wat(x, y), land = w === 0 && !(Rk && Rk[i]);
    switch (on || 'land') {
      case 'land': return land;
      case 'shore': return land && any(x, y, 2, (u, v) => wat(u, v) > 0);
      case 'rock': return land && any(x, y, 3, (u, v) => (Rk && Rk[v * S + u]) || (u < S && v < S && steep(u, v)));
      case 'trees': return land && (!Tr || any(x, y, 3, (u, v) => Tr[v * S + u]));
      case 'shallow': return w === 1;
      case 'deep': return w >= 2;
      case 'far': return w >= 2 && !any(x, y, 10, (u, v) => wat(u, v) === 0);
      case 'water': return w >= 1 && !any(x, y, 1, (u, v) => wat(u, v) === 0);
      default: return land;
    }
  };
  // tiles of each biome present
  const tiles = new Map();
  for (let i = 0; i < N; i++) { const b = B[i]; let L = tiles.get(b); if (!L) tiles.set(b, (L = [])); L.push(i); }
  const out = [];
  const ids = [...tiles.keys()].sort((a, b) => a - b);
  for (const b of ids) {
    const rows = tables[BIOME_KEYS[b]];
    if (!rows) continue;
    const L = tiles.get(b), share = L.length / N;
    for (const row of rows) {
      const ex = row.d * share * dens;
      let k = Math.floor(ex) + (rng() < ex - Math.floor(ex) ? 1 : 0);
      for (; k > 0; k--) {
        for (let t = 0; t < 32; t++) {
          const i = L[Math.floor(rng() * L.length)], x = i % S, y = (i / S) | 0;
          if (!fits(row.on, x, y)) continue;
          if (row.alt && Hc) { const h = tileH(x, y); if (h < row.alt[0] || h > row.alt[1]) continue; }
          const wx = x0 + x + 0.5, wy = y0 + y + 0.5;
          if (out.some((o) => Math.abs(o.x - wx) < gap && Math.abs(o.y - wy) < gap)) continue;
          if (opts.exclude && opts.exclude(wx, wy)) continue;
          const [a, c] = row.n;
          out.push({ species: row.sp, x: wx, y: wy, count: a + Math.floor(rng() * (c - a + 1)), when: row.when || whenDefault(row.sp), biome: BIOME_KEYS[b], on: row.on || 'land' });
          break;
        }
      }
    }
  }
  return out;
}

// ---------- the ?planet=1 hook ----------
export function createFaunaSpawners(game, { levelFor, whenOf = null, firstId = 1 } = {}) {
  const w = game.world;
  if (!w.planetBiome) return [];
  const W = w.W, H = w.H, at = w.planetAt || { x0: 0, y0: 0 }, seed = at.seed ?? w.seed ?? 1;
  const sx = w.spawn.x, sy = w.spawn.y;
  // tree tiles (the 'trees' rows: monkeys)
  const trees = new Uint8Array(W * H);
  for (const o of w.objects || []) if (o.type?.startsWith('tree_')) { const tx = Math.floor(o.x), ty = Math.floor(o.y); if (tx >= 0 && ty >= 0 && tx < W && ty < H) trees[ty * W + tx] = 1; }
  const out = [];
  let id = firstId;
  // blocks aligned to the planet's chunks (the cut starts on a chunk corner)
  const ox = ((at.x0 % CHUNK) + CHUNK) % CHUNK, oy = ((at.y0 % CHUNK) + CHUNK) % CHUNK;
  for (let by = -oy; by < H; by += CHUNK) for (let bx = -ox; bx < W; bx += CHUNK) {
    const S = CHUNK, biome = new Uint8Array(S * S), water = new Uint8Array(S * S), rock = new Uint8Array(S * S), tr = new Uint8Array(S * S), height = new Float32Array((S + 1) * (S + 1));
    let inside = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = bx + x, ty = by + y, j = y * S + x;
      if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) { biome[j] = 255; continue; } // (outside the cut: no table)
      const i = ty * W + tx;
      biome[j] = w.planetBiome[i]; water[j] = w.planetWater ? w.planetWater[i] : w.water[i]; rock[j] = w.rock[i]; tr[j] = trees[i];
      inside++;
    }
    if (!inside) continue;
    if (w.height?.any) for (let y = 0; y <= S; y++) for (let x = 0; x <= S; x++) height[y * (S + 1) + x] = w.height.cornerH(bx + x, by + y);
    const pcx = Math.floor((at.x0 + bx) / CHUNK), pcy = Math.floor((at.y0 + by) / CHUNK);
    const rng = chunkRng(seed, pcx, pcy);
    const list = spawnsForChunk({ size: S, biome, water, rock, height: w.height?.any ? height : null, trees: tr, x0: bx, y0: by }, rng, {
      exclude: (x, y) => out.some((s) => Math.abs(s.x - x) < 5 && Math.abs(s.y - y) < 5),
    });
    for (const g of list) {
      const sp = SPECIES[g.species];
      if (!sp) continue;
      const d = Math.hypot(g.x - sx, g.y - sy);
      if (d < (sp.minD ?? 8)) continue; // (the bare-hands start stays fair)
      const lvl = levelFor ? levelFor(d, (sp.lvl || 0) + (rng() < 0.3 ? 1 : 0)) : 1;
      const s = { id: id++, species: g.species, x: g.x, y: g.y, level: lvl, count: g.count, members: [], when: whenOf?.(g.species) || g.when, biome: g.biome };
      if (g.species === 'fish') { s.fish = true; s.level = 1; s.when = 'always'; }
      else if (FAUNA[g.species]) s.fauna = true;
      out.push(s);
    }
  }
  return out;
}
