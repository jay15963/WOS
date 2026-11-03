// The real planet generator (src/world/planet, docs/PLANET.md) as a world source (docs/STREAMING.md "Fonte do mundo"):
// ?source=planet (or ?planet=1). generatePlanet(seed) → the macro planet (512 × 256 typed arrays, postMessage-able)
// is made once on the main thread (spawn, map, synchronous fallback) and handed to the chunk workers; each chunk is
// generateChunk(planet, cx, cy, { decor }) adapted to the engine's ChunkData (src/world/source.js):
//   ground ids 8–13 / rock types 5–6 → the classic ones (planet/biomes.js GROUND_CLASSIC / ROCK_CLASSIC), biomes → their
//   classic class (BIOME_LIST[b].cl), new plant / tree kinds → existing art (the same table as planet/ingame.js),
//   lush 0..255 → 0..1, `height` (65 × 65 corners, stories) → world.cornerH, water 3 (abyss) → deep for the game.
// Object ids are the planet's: (cy * 256 + cx) * 16384 + k → chunkOfId.

import { CS, CT, PW, PH } from './store.js';
import { G, BIOME_ID } from './worldgen.js';

const ID_PER_CHUNK = 16384, ID_MAX = 1073741824;
const DECOR_MAX = 1600;

// new tree / plant kinds of the planet → art the game has (planet/ingame.js)
const TREE_MAP = {
  tree_oak: 'tree_oak', tree_pine: 'tree_pine', tree_birch: 'tree_birch', tree_dead: 'tree_dead',
  tree_palm: 'tree_oak', tree_acacia: 'tree_oak', tree_baobab: 'tree_oak', tree_jungle: 'tree_oak', tree_kapok: 'tree_oak', tree_olive: 'tree_oak', tree_fern: 'tree_oak',
  tree_spruce: 'tree_pine', tree_larch: 'tree_pine', tree_redwood: 'tree_pine', tree_cypress: 'tree_pine', tree_dwarf: 'tree_birch', bamboo: 'tree_birch',
};
const DRY_PLANTS = new Set(['cactus', 'cactus_tall', 'agave', 'shrub_desert', 'dead_bush', 'tussock', 'tundra_shrub', 'dune_grass', 'termite_mound', 'papyrus']);
const KEEP = new Set(['bush', 'berrybush', 'herbbush', 'boulder', 'pebble', 'stick', 'fibergrass', 'wild_potato', 'wild_cotton', 'wild_corn', 'wild_wheat']);
const DECOR_MAP = { lichen: 'moss', cottongrass: 'tallgrass', ash: 'scree' };
const DECOR_OK = new Set(['grass', 'tallgrass', 'flower', 'reed', 'mushroom', 'fern', 'bloom', 'heather', 'drygrass', 'thistle', 'litter', 'needles', 'twigs', 'petals', 'moss', 'lily', 'riverstone', 'scree', 'shell', 'driftwood']);

let PM = null; // the planet modules
async function mods() {
  if (PM) return PM;
  const [idx, bio, ren] = await Promise.all([import('./planet/index.js'), import('./planet/biomes.js'), import('./planet/render.js').catch(() => null)]);
  return (PM = { ...idx, GROUND_CLASSIC: bio.GROUND_CLASSIC, ROCK_CLASSIC: bio.ROCK_CLASSIC, BIOME_LIST: bio.BIOME_LIST, renderMacro: ren?.renderMacro });
}

// the chunk generator of a worker (chunkWorker.js): init = { kind: 'planet', seed, planet }
export async function workerGenerator(init) {
  const m = await mods();
  const planet = init.planet || m.generatePlanet(init.seed);
  return (cx, cy, o) => adaptChunk(m, m.generateChunk(planet, cx, cy, o), cx, cy, o, planet);
}

export async function makePlanetSource(seed, opts = {}) {
  const m = await mods();
  const t0 = performance.now();
  const planet = (await planetInWorker(seed)) || m.generatePlanet(seed);
  const t1 = performance.now();
  let spawn = null;
  const px = opts.px != null && opts.px !== '' ? +opts.px : NaN, py = opts.py != null && opts.py !== '' ? +opts.py : NaN;
  if (px === px && py === py) spawn = { x: px + 0.5, y: py + 0.5 };
  else { const sp = m.findSpawn(planet); spawn = sp ? { x: sp.x, y: sp.y } : { x: PW / 2 + 0.5, y: PH / 3 + 0.5 }; }
  const src = {
    kind: 'planet', seed, wrap: true, bounds: null, zones: [{ type: 'spawn', x: spawn.x, y: spawn.y, r: 10 }], spawn,
    timings: { planet: Math.round(t1 - t0) },
    worker: { url: new URL('./chunkWorker.js', import.meta.url).href, init: { kind: 'planet', seed, planet: stripPlanet(planet) } },
    chunk: (cx, cy, o) => adaptChunk(m, m.generateChunk(planet, cx, cy, o), cx, cy, o, planet),
    // the climate of a point (game/seasons.js: local seasons, survival temperatures): the planet's annual mean °C at that
    // place corrected by the lapse rate for its own height h (stories), the seasonal amplitude, the rain (mm / year), its
    // season zone (0 tropical .. 4 polar) and the latitude (degrees, display only)
    climateAt: (x, y, h = 0, out = {}) => climatePoint(m, planet, x, y, h, out),
    planet, // (the macro planet: the map, tools)
    macro: () => {
      if (!m.renderMacro) return null;
      const rgba = m.renderMacro(planet, 'satellite');
      return { w: m.MW, h: m.MH, rgba, tpp: PW / m.MW };
    },
    chunkOfId: (id) => (typeof id === 'number' && id >= 0 && id < ID_MAX ? Math.floor(id / ID_PER_CHUNK) : -1),
  };
  console.info(`[planet] seed ${seed}: planet ${src.timings.planet} ms, spawn ${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)}`);
  return src;
}

// generatePlanet in a module worker (~2 s off the main thread: the graphics keep loading); null without workers
function planetInWorker(seed) {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  return new Promise((res) => {
    let wk;
    try { wk = new Worker(new URL('./planetWorker.js', import.meta.url), { type: 'module' }); } catch { res(null); return; }
    wk.onmessage = (e) => { wk.terminate(); res(e.data && e.data.planet ? e.data.planet : null); };
    wk.onerror = () => { wk.terminate(); res(null); };
    wk.postMessage({ seed });
  });
}

// the planet object without caches the workers do not need (and that may not clone)
function stripPlanet(p) {
  const o = {};
  for (const k in p) { const v = p[k]; if (k[0] === '_' || typeof v === 'function') continue; o[k] = v; }
  return o;
}

// climate of a point (see source.climateAt): macro climate + lapse rate for the point's own height (stories)
const CO = {};
export function climatePoint(m, planet, x, y, h, out) {
  m.macroAt(planet, x, y, CO);
  const T = CO.T - 0.0065 * (Math.max(0, m.storiesToMeters(h || 0)) - Math.max(0, CO.e));
  out.T = T; out.tAmp = CO.tAmp; out.P = CO.P; out.zone = m.seasonZoneOf(T, CO.tAmp); out.lat = m.latitudeAt(y);
  return out;
}

// season zone per tile (0 tropical .. 4 polar, world.js `zone` layer): the macro climate sampled per 4 × 4 block, the
// lapse rate per tile from its own height (snowy peaks are polar anywhere); | 8 on the abyssal ocean
function zonesOf(m, planet, p, cx, cy) {
  const z = new Uint8Array(CT), Hc = p.height, N1 = CS + 1, X0 = cx * CS, Y0 = cy * CS;
  for (let by = 0; by < CS; by += 4) for (let bx = 0; bx < CS; bx += 4) {
    m.macroAt(planet, X0 + bx + 2, Y0 + by + 2, CO);
    const T0 = CO.T, amp = CO.tAmp, e0 = Math.max(0, CO.e);
    for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) {
      const l = y * CS + x;
      const h = Hc ? (Hc[y * N1 + x] + Hc[y * N1 + x + 1] + Hc[(y + 1) * N1 + x] + Hc[(y + 1) * N1 + x + 1]) * 0.25 : 0;
      const T = T0 - 0.0065 * (Math.max(0, m.storiesToMeters(h)) - e0);
      z[l] = m.seasonZoneOf(T, amp) | (p.water[l] === 3 ? 8 : 0);
    }
  }
  return z;
}

// the planet's chunk → the engine's ChunkData
export function adaptChunk(m, p, cx, cy, { decor = true } = {}, planet = null) {
  const GC = m.GROUND_CLASSIC, RC = m.ROCK_CLASSIC, BL = m.BIOME_LIST;
  const rock = p.rock, water = new Uint8Array(CT), ground = new Uint8Array(CT), rockType = new Uint8Array(CT), biome = new Uint8Array(CT), lush = new Float32Array(CT);
  for (let l = 0; l < CT; l++) {
    water[l] = rock[l] ? 0 : p.water[l]; // (3 = abyss: deep for the game, world.install)
    ground[l] = rock[l] ? G.STONE : GC[p.ground[l]] ?? G.SOIL;
    rockType[l] = RC[p.rockType[l]] || 1;
    biome[l] = rock[l] ? BIOME_ID.MOUNTAIN : water[l] ? BIOME_ID.WATER : BL[p.biome[l]]?.cl ?? BIOME_ID.MEADOW;
    lush[l] = p.lush[l] / 255;
  }
  // roof: rock ≥ 2 tiles deep (inside the chunk; beyond its edge counts as rock — a cave dug there keeps its ceiling)
  const roof = new Uint8Array(CT);
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    if (!rock[y * CS + x]) continue;
    let deep = 1;
    for (let dy = -2; dy <= 2 && deep; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < CS && Y < CS && !rock[Y * CS + X]) { deep = 0; break; } }
    roof[y * CS + x] = deep;
  }
  // (the planet gives object / decor positions inside the chunk: to planet coordinates)
  const X0 = cx * CS, Y0 = cy * CS;
  const objects = [];
  for (const o of p.objects || []) {
    if (o.w) continue; // (nothing standing in water yet)
    let t = o.type, v = o.v;
    if (t.startsWith('tree_') || t === 'bamboo') { const n = TREE_MAP[t] || 'tree_oak'; if (n !== t) v = v & 15; t = n; }
    else if (DRY_PLANTS.has(t)) { v = 2000 + (v % 1000); t = 'bush'; }
    else if (t === 'lichen_rock') t = 'boulder';
    else if (!KEEP.has(t)) continue;
    o.x += X0; o.y += Y0;
    objects.push(t === o.type && v === o.v ? o : { ...o, type: t, v });
  }
  let dec = null;
  if (decor && p.decor) {
    dec = [];
    // (cosmetic and heavy: at most ~DECOR_MAX per chunk — dense grasslands keep an even sample)
    const step = Math.max(1, p.decor.length / DECOR_MAX);
    for (let k = 0; k < p.decor.length; k += step) {
      const d = p.decor[Math.floor(k)];
      const t = DECOR_MAP[d.t] || d.t;
      if (!DECOR_OK.has(t)) continue;
      const lx = Math.floor(d.x), ly = Math.floor(d.y);
      if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) continue;
      const l = ly * CS + lx;
      if (rock[l] || (water[l] && !d.w)) continue;
      d.x += X0; d.y += Y0;
      dec.push(t === d.t ? d : { ...d, t });
    }
  }
  // heights (65 × 65 corners, stories): the corners of a water tile rise to its water level (the sea at 0, a lake on a
  // plateau at its own: height.js foldWater; the seabed is not drawn)
  let heights = null;
  if (p.height) {
    heights = p.height.slice();
    const N1 = CS + 1, wl = p.wlevel;
    for (let ty = 0; ty < CS; ty++) for (let tx = 0; tx < CS; tx++) {
      const l = ty * CS + tx;
      if (!p.water[l] || rock[l]) continue;
      const lv = wl ? wl[l] : 0;
      for (let k = 0; k < 4; k++) { const o = (ty + (k >> 1)) * N1 + tx + (k & 1); if (heights[o] < lv) heights[o] = lv; }
    }
  }
  return {
    cx, cy, ground, water, rock, rockType, ore: p.ore, roof, tramp: new Uint8Array(CT), biome, fertile: p.fertile, lush,
    flowX: p.flowX, flowY: p.flowY, dWater: dist(water), dRock: dist(rock), heights, objects, decor: dec,
    wlevel: p.wlevel instanceof Float32Array ? p.wlevel : null, pground: p.ground,
    zone: planet ? zonesOf(m, planet, p, cx, cy) : null, pbiome: p.biome, // (pbiome: the fauna's spawn tables, camps / herds)
  };
}

// chamfer-ish distance (tiles, ≤ 9) to the set tiles inside the chunk
function dist(mk) {
  const a = new Float32Array(CT);
  for (let l = 0; l < CT; l++) a[l] = mk[l] ? 0 : 9;
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
