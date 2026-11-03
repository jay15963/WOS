// World sources (docs/STREAMING.md): where the tiles of the planet come from. A source is a pure function of
// (seed, chunk) — the same chunk on every peer — plus a few world facts (spawn, zones, bounds).
//
// Contract (every source):
//   kind        'classic' | 'synth' | 'planet'
//   seed        world seed
//   wrap        true: the planet (x wraps, the whole PW × PH is land / sea); false: a bounded world inside `bounds`
//   bounds      { x0, y0, x1, y1 } tiles (exclusive x1 / y1) — the playable area; outside is solid bedrock
//   spawn       { x, y } where new players appear
//   zones       [{ type, x, y, r, … }] gameplay zones (bandit camps…) known up front (may be empty)
//   chunk(cx, cy) → ChunkData   synchronous generation (main thread fallback; must be deterministic)
//   worker      { url, init } | null   module worker generating chunks off the main thread (same function)
//   macro()     → { w, h, rgba, x0, y0, tw, th } | null  coarse colour image of the whole world (planet-scale map)
//   decor(cx, cy) → [decor]   (optional) cosmetic ground decor of a chunk, made lazily near the camera
//
// ChunkData (CT = 64 × 64 values per layer, row-major inside the chunk):
//   ground, water, rock, rockType, ore, roof (roof0: original mountain roof), tramp, biome, fertile: Uint8Array
//   lush, flowX, flowY, dWater, dRock: Float32Array
//   objects: natural objects [{ id, type, x, y, v, s, f, … }] with global positions and ids unique on the planet
//   decor: [] (or null: made later by source.decor)

import { generateWorld, G, BIOME_ID } from './worldgen.js';
import { sculptHills } from './hills.js';
import { fertileGrid } from './soil.js';
import { CS, CT, PW, PH } from './store.js';

const U8 = ['ground', 'water', 'rock', 'rockType', 'ore', 'roof', 'tramp', 'biome', 'fertile'];
const F32 = ['lush', 'flowX', 'flowY', 'dWater', 'dRock'];
export const CHUNK_U8 = U8, CHUNK_F32 = F32;

// a chunk of solid bedrock (outside a bounded world)
export function bedrockChunk(cx, cy) {
  const d = { cx, cy, objects: [], decor: [] };
  for (const k of U8) d[k] = new Uint8Array(CT);
  for (const k of F32) d[k] = new Float32Array(CT);
  d.ground.fill(G.STONE); d.rock.fill(1); d.rockType.fill(1); d.roof.fill(1); d.biome.fill(BIOME_ID.MOUNTAIN);
  d.dWater.fill(99);
  return d;
}

// ---------- classic: today's 256 × 256 generator, embedded at the origin of the planet ----------
// The whole small world is generated at once (its rivers / distance fields are global) and served chunk by chunk;
// everything outside is bedrock (the old map edge). Tile coordinates inside it are the old ones.
export class ClassicSource {
  constructor(seed, { size = 256, hills = false } = {}) {
    const g = generateWorld(seed, size, size);
    // ?hills=1 (dev, docs/TERRAIN-HEIGHT.md): the terrain-height showcase sculpted around the spawn (gen.heightCorners,
    // (W + 1) × (H + 1) stories); a guest follows its host (welcome.hills)
    if (hills) sculptHills(g);
    this.hills = hills ? g.hills || true : false; // (its landmarks: plateau, canyon, … — dev shots / tests)
    this.kind = 'classic';
    this.seed = seed;
    this.wrap = false;
    this.bounds = { x0: 0, y0: 0, x1: g.W, y1: g.H };
    this.spawn = g.spawn;
    this.zones = g.zones;
    this.timings = g.timings;
    this.worker = null;
    this.g = g;
    this.fert = fertileGrid({ W: g.W, H: g.H, water: wrapArr(g.water), flowX: wrapArr(g.flowX), flowY: wrapArr(g.flowY), inBounds: (x, y) => x >= 0 && y >= 0 && x < g.W && y < g.H, idx: (x, y) => y * g.W + x });
    // natural objects by chunk
    this.objs = new Map();
    for (const o of g.objects) { const k = key(o.x, o.y); let l = this.objs.get(k); if (!l) this.objs.set(k, l = []); l.push(o); }
    this.dec = new Map();
    for (const d of g.decor) { const k = key(d.x, d.y); let l = this.dec.get(k); if (!l) this.dec.set(k, l = []); l.push(d); }
  }

  chunk(cx, cy) {
    const g = this.g, x0 = cx * CS, y0 = cy * CS;
    if (x0 >= g.W || y0 >= g.H || x0 + CS <= 0 || y0 + CS <= 0) { const b = bedrockChunk(cx, cy); if (g.heightCorners) b.heights = this._heights(cx, cy); return b; }
    const d = bedrockChunk(cx, cy);
    const src = { ...Object.fromEntries(U8.map((k) => [k, g[k]])), ...Object.fromEntries(F32.map((k) => [k, g[k]])), fertile: this.fert };
    for (let ly = 0; ly < CS; ly++) {
      const y = y0 + ly;
      if (y < 0 || y >= g.H) continue;
      for (let lx = 0; lx < CS; lx++) {
        const x = x0 + lx;
        if (x < 0 || x >= g.W) continue;
        const i = y * g.W + x, l = ly * CS + lx;
        for (const k of U8) d[k][l] = src[k][i];
        for (const k of F32) d[k][l] = src[k][i];
      }
    }
    d.objects = (this.objs.get(cy * 4096 + cx) || []).slice();
    if (g.heightCorners) d.heights = this._heights(cx, cy);
    d.decor = (this.dec.get(cy * 4096 + cx) || []).slice();
    return d;
  }

  // the chunk's 65 × 65 corners (a chunk beyond the edge repeats the edge: the old clamped corner array)
  _heights(cx, cy) {
    const g = this.g, C = g.heightCorners, GW = g.W + 1, h = new Float32Array((CS + 1) * (CS + 1));
    for (let y = 0; y <= CS; y++) for (let x = 0; x <= CS; x++) {
      const X = Math.max(0, Math.min(g.W, cx * CS + x)), Y = Math.max(0, Math.min(g.H, cy * CS + y));
      h[y * (CS + 1) + x] = C[Y * GW + X];
    }
    return h;
  }

  // the small world as a picture for the map (one pixel per tile)
  macro() { return null; }
}

const key = (x, y) => Math.floor(y / CS) * 4096 + Math.floor(x / CS);
// (soil.js reads w.water[i] with get(): a typed array seen through the layer API)
function wrapArr(a) { return { get: (i) => a[i] }; }

// pick a source from the URL flags / a saved world: 'classic' (default), 'synth' (synthetic planet, stress test),
// 'planet' (src/world/planet when present)
export async function makeSource(kind, seed, opts = {}) {
  if (kind === 'synth') { const m = await import('./synth.js'); return new m.SynthSource(seed); }
  if (kind === 'classic') return new ClassicSource(seed, opts);
  if (kind === 'planet') {
    try { const m = await import('./planetSource.js'); return await m.makePlanetSource(seed, opts); }
    catch (e) { console.warn('[world] planet source unavailable, using synth', e); const m = await import('./synth.js'); return new m.SynthSource(seed); }
  }
  return new ClassicSource(seed);
}

export const PLANET = { W: PW, H: PH };
