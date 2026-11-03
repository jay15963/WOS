// The real planet generator (src/world/planet, agent P) as a world source (docs/STREAMING.md "Fonte do mundo"):
// ?source=planet. The planet module exports generatePlanet(seed) → macro data (512 × 256) and
// generateChunk(planet, cx, cy) → the layers of one 64 × 64 chunk; this adapter turns them into the engine's ChunkData
// (src/world/source.js) and runs the same functions in the chunk workers (chunkWorker.js → workerGenerator).
// Field names it understands (typed arrays of 64 × 64, row-major; heights (65 × 65) when present):
//   ground, water (0 land · 1 shallow · 2 deep · 3 abyssal), rock (or rockMass > 0.5), rockType, ore, roof,
//   flowX, flowY, biome (+ planet.biomeNames to map ids to names), fertile, lush, heights, objects [], decor []
// Anything missing is derived (roof from rock depth, dWater / dRock distances inside the chunk, lush from the biome).
// Until the planet module is on this branch, makeSource falls back to the synthetic planet (synth.js).

import { CS, CT, PW, PH, CW } from './store.js';
import { G, BIOMES, BIOME_ID } from './worldgen.js';

const PLANET_PATHS = ['./planet/index.js', './planet/planet.js'];
const ID0 = 2e7, IDS = 8192; // natural object ids: ID0 + chunk * IDS + k

async function loadPlanetModule() {
  let err = null;
  for (const p of PLANET_PATHS) {
    try { const m = await import(p); if (m.generatePlanet && m.generateChunk) return m; } catch (e) { err = e; }
  }
  throw err || new Error('src/world/planet não encontrado');
}

// the chunk generator for a worker (chunkWorker.js): init = { kind: 'planet', seed }
export async function workerGenerator(init) {
  const m = await loadPlanetModule();
  const planet = m.generatePlanet(init.seed);
  return (cx, cy, o) => adaptChunk(planet, m.generateChunk(planet, cx, cy, o), cx, cy, o);
}

export async function makePlanetSource(seed) {
  const m = await loadPlanetModule();
  const planet = m.generatePlanet(seed);
  const spawn = m.findSpawn ? m.findSpawn(planet) : planet.spawn || { x: PW / 2 + 0.5, y: PH / 3 + 0.5 };
  return {
    kind: 'planet', seed, wrap: true, bounds: null, zones: [], spawn,
    worker: { url: new URL('./chunkWorker.js', import.meta.url).href, init: { kind: 'planet', seed } },
    chunk: (cx, cy, o) => adaptChunk(planet, m.generateChunk(planet, cx, cy, o), cx, cy, o),
    macro: () => (m.macroImage ? m.macroImage(planet) : null),
    chunkOfId: (id) => (typeof id === 'number' && id >= ID0 ? Math.floor((id - ID0) / IDS) : -1),
  };
}

// the planet's layers → the engine's ChunkData
export function adaptChunk(planet, p, cx, cy, { decor = true } = {}) {
  const u8 = (k, alt) => (p[k] instanceof Uint8Array ? p[k] : alt ? alt() : new Uint8Array(CT));
  const f32 = (k) => (p[k] instanceof Float32Array ? p[k] : new Float32Array(CT));
  const water = u8('water');
  const rock = p.rock instanceof Uint8Array ? p.rock : p.rockMass ? Uint8Array.from(p.rockMass, (v) => (v > 0.5 ? 1 : 0)) : new Uint8Array(CT);
  const names = planet.biomeNames || BIOMES;
  const bmap = names.map((n) => BIOME_ID[String(n).toUpperCase()] ?? (/sea|ocean|lake|water/.test(n) ? BIOME_ID.WATER : /mount|peak|alpine/.test(n) ? BIOME_ID.MOUNTAIN : /tundra|taiga|boreal|pine|snow/.test(n) ? BIOME_ID.PINE : /forest|jungle|rain/.test(n) ? BIOME_ID.FOREST : /marsh|swamp|wet/.test(n) ? BIOME_ID.MARSH : /beach|shore|coast|sand|desert|dune/.test(n) ? BIOME_ID.SHORE : /rock|bad|scree/.test(n) ? BIOME_ID.ROCKY : BIOME_ID.MEADOW));
  const biome = new Uint8Array(CT), pb = p.biome || new Uint8Array(CT);
  for (let l = 0; l < CT; l++) biome[l] = rock[l] ? BIOME_ID.MOUNTAIN : water[l] ? BIOME_ID.WATER : bmap[pb[l]] ?? BIOME_ID.MEADOW;
  const ground = u8('ground', () => { const g = new Uint8Array(CT); for (let l = 0; l < CT; l++) g[l] = rock[l] ? G.STONE : biome[l] === BIOME_ID.SHORE ? G.SAND : biome[l] === BIOME_ID.ROCKY ? G.GRAVEL : biome[l] === BIOME_ID.MARSH ? G.MARSH : G.SOIL; return g; });
  // roof: rock ≥ 2 deep (inside the chunk; the border counts as rock)
  const roof = u8('roof', () => {
    const r = new Uint8Array(CT);
    for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
      if (!rock[y * CS + x]) continue;
      let deep = 1;
      for (let dy = -2; dy <= 2 && deep; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < CS && Y < CS && !rock[Y * CS + X]) { deep = 0; break; } }
      r[y * CS + x] = deep;
    }
    return r;
  });
  const dWater = dist(water), dRock = dist(rock);
  const lush = p.lush instanceof Float32Array ? p.lush : Float32Array.from(biome, (b) => (b === BIOME_ID.FOREST || b === BIOME_ID.MEADOW ? 0.6 : b === BIOME_ID.MARSH ? 0.7 : 0.3));
  const c = cy * CW + cx;
  let k = 0;
  const objects = (p.objects || []).map((o) => ({ ...o, id: o.id ?? ID0 + c * IDS + k++ }));
  return {
    cx, cy, ground, water, rock, rockType: u8('rockType', () => new Uint8Array(CT).fill(1)), ore: u8('ore'), roof, tramp: u8('tramp'),
    biome, fertile: u8('fertile'), lush, flowX: f32('flowX'), flowY: f32('flowY'), dWater, dRock,
    heights: p.heights instanceof Float32Array ? p.heights : null,
    objects, decor: decor ? p.decor || [] : null,
  };
}

// chamfer distance (tiles, ≤ 9) to the set tiles inside the chunk
function dist(m) {
  const a = new Float32Array(CT);
  for (let l = 0; l < CT; l++) a[l] = m[l] ? 0 : 9;
  for (let pass = 0; pass < 2; pass++) for (let n = 0; n < CT; n++) {
    const l = pass ? CT - 1 - n : n, x = l % CS, s = pass ? 1 : -1;
    let v = a[l];
    if (x + s >= 0 && x + s < CS) v = Math.min(v, a[l + s] + 1);
    const j = l + s * CS;
    if (j >= 0 && j < CT) v = Math.min(v, a[j] + 1);
    a[l] = v;
  }
  return a;
}
