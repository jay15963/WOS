// Fauna spawning by planet biome (docs/FAUNA.md §Spawn). Two parts:
//
// 1) spawnsForChunk(grid, rng, opts) — PURE (no game, no DOM, no Math.random): the creature groups of one chunk from
//    its layers and the per-biome tables (content/fauna.js FAUNA_SPAWNS). The streaming engine calls it per chunk when
//    a chunk loads (seeded by the chunk's planet coordinates: chunkRng) — chunkFauna below. Same grid + same rng = same
//    groups, on any peer.
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
// 2) chunkFauna(game, c, { levelFor, whenOf }) — the streamed planet's hook (mobs.js planetSpawners, when chunk c loads
//    on the host, docs/STREAMING.md): the chunk's layers from the world (`pbiome`: the planet's biome ids), its own
//    chunk seed, the groups turned into mobs.js spawners (level by distance from the spawn like every spawner, min
//    distance from the spawn per species, fish schools as livestock fish spawners); they leave with the chunk.

import { FAUNA_SPAWNS, FAUNA } from './content/fauna.js';
import { SPECIES } from './data.js';
import { BIOME_KEYS } from '../world/planet/biomes.js';
import { mulberry32 } from '../engine/noise.js';
import { STOCK } from './content/livestock.js';

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
  // where a group of this row stands for the biome tile (x, y): [x, y] or null. Water tiles carry the water biomes
  // (river, lake, ocean…), so a land biome's water creature ('shallow' / 'water') takes the water next to its shore
  const near = (x, y, r, f) => { let b = null, bd = 1e9; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const u = x + dx, v = y + dy; if (u >= 0 && v >= 0 && u < S && v < S && f(u, v) && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; b = [u, v]; } } return b; };
  const fits = (on, x, y) => {
    const i = y * S + x, w = wat(x, y), land = w === 0 && !(Rk && Rk[i]);
    switch (on || 'land') {
      case 'land': return land ? [x, y] : null;
      case 'shore': return land && any(x, y, 2, (u, v) => wat(u, v) > 0) ? [x, y] : null;
      case 'rock': return land && any(x, y, 3, (u, v) => (Rk && Rk[v * S + u]) || (u < S && v < S && steep(u, v))) ? [x, y] : null;
      case 'trees': return land && (!Tr || any(x, y, 3, (u, v) => Tr[v * S + u])) ? [x, y] : null;
      case 'shallow': return w === 1 ? [x, y] : land ? near(x, y, 3, (u, v) => wat(u, v) === 1) : null;
      case 'deep': return w >= 2 ? [x, y] : null;
      case 'far': return w >= 2 && !any(x, y, 10, (u, v) => wat(u, v) === 0) ? [x, y] : null;
      case 'water': return w >= 1 && !any(x, y, 1, (u, v) => wat(u, v) === 0) ? [x, y] : land ? near(x, y, 3, (u, v) => wat(u, v) >= 1 && !any(u, v, 1, (a, b) => wat(a, b) === 0)) : null;
      default: return land ? [x, y] : null;
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
          const i = L[Math.floor(rng() * L.length)], at = fits(row.on, i % S, (i / S) | 0);
          if (!at) continue;
          const [x, y] = at;
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

// ---------- the streamed planet's hook (mobs.js planetSpawners: a chunk loads on the host) ----------
// The chunk's layers read from the world (`pbiome` = the planet's biome ids, world/planetSource.js), its own chunk seed,
// then the groups as mobs.js spawners: level by distance from the spawn like every spawner, the species' min distance
// from the spawn, fish schools as livestock fish spawners. Same chunk → same spawners on every load.
export function chunkFauna(game, c, { levelFor, whenOf = null } = {}) {
  const w = game.world;
  if (!w.pbiome) return [];
  const S = CHUNK, cx = c & 255, cy = c >>> 8, x0 = cx * S, y0 = cy * S;
  const biome = new Uint8Array(S * S), water = new Uint8Array(S * S), rock = new Uint8Array(S * S), trees = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = w.idx(x0 + x, y0 + y), j = y * S + x;
    biome[j] = w.pbiome.get(i); water[j] = w.water.get(i); rock[j] = w.rock.get(i);
  }
  w.forChunks(x0, y0, x0 + S - 1, y0 + S - 1, (bk) => {
    for (const o of bk.objects) {
      if (!o.type?.startsWith('tree_')) continue;
      const lx = Math.floor(w.dx(o.x, x0)), ly = Math.floor(o.y) - y0;
      if (lx >= 0 && ly >= 0 && lx < S && ly < S) trees[ly * S + lx] = 1;
    }
  });
  let height = null;
  if (w.height?.any) {
    height = new Float32Array((S + 1) * (S + 1));
    for (let y = 0; y <= S; y++) for (let x = 0; x <= S; x++) height[y * (S + 1) + x] = w.height.cornerH(x0 + x, y0 + y);
  }
  const rng = chunkRng(w.seed, cx, cy), sx = w.spawn.x, sy = w.spawn.y, out = [];
  for (const g of spawnsForChunk({ size: S, biome, water, rock, height, trees, x0, y0 }, rng)) {
    const sp = SPECIES[g.species];
    if (!sp) continue;
    const d = Math.hypot(w.dx(g.x, sx), g.y - sy);
    if (d < (sp.minD ?? 8)) continue; // (the bare-hands start stays fair)
    const lvl = levelFor ? levelFor(d, (sp.lvl || 0) + (rng() < 0.3 ? 1 : 0)) : 1;
    const s = { id: 0, species: g.species, x: g.x, y: g.y, level: lvl, count: g.count, members: [], when: whenOf?.(g.species) || g.when, biome: g.biome };
    if (g.species === 'fish') { s.fish = true; s.level = 1; s.when = 'always'; }
    else if (STOCK[g.species]) { s.stock = true; s.when = 'day'; } // (wild farm herds: livestock.js brain, tamable)
    else if (FAUNA[g.species]) s.fauna = true;
    out.push(s);
  }
  return out;
}
