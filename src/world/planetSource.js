// The real planet generator (src/world/planet, docs/PLANET.md) as a world source (docs/STREAMING.md "Fonte do mundo"):
// ?source=planet (or ?planet=1). generatePlanet(seed) → the macro planet (512 × 256 typed arrays, postMessage-able)
// is made once on the main thread (spawn, map, synchronous fallback) and handed to the chunk workers; each chunk is
// generateChunk(planet, cx, cy, { decor }) adapted to the engine's ChunkData (src/world/source.js):
//   ground ids 8–13 / rock types 5–6 → the classic ones (planet/biomes.js GROUND_CLASSIC / ROCK_CLASSIC; the planet's own
//   ids ride along as pground / prock / pbiome for the looks), biomes → their classic class (BIOME_LIST[b].cl), the
//   planet's plant / tree kinds → a classic kind + an art species (planet/flora.js, art/planetFlora.js),
//   lush 0..255 → 0..1, `height` (65 × 65 corners, stories) → world.cornerH, water 3 (abyss) → deep for the game.
// Object ids are the planet's: (cy * 256 + cx) * 16384 + k → chunkOfId.

import { CS, CT, PW, PH } from './store.js';
import { G, BIOME_ID } from './worldgen.js';
import { applyRealm } from './realm/ground.js'; // kingdoms: the settlements' ground and the roads (docs/REINOS.md)
import { settlementLayout, packLayout, adoptLayout } from './realm/layout.js';
import { realmIndex } from './realm/realm.js';

const ID_PER_CHUNK = 16384, ID_MAX = 1073741824;
const DECOR_MAX = 1600;

// the planet's natural kinds are classic kinds + an art species (planet/flora.js, art/planetFlora.js); decor kinds with
// their own art join the classic ones
const KEEP = new Set(['tree_oak', 'tree_pine', 'tree_birch', 'tree_dead', 'bush', 'berrybush', 'herbbush', 'boulder', 'pebble', 'stick', 'fibergrass', 'wild_potato', 'wild_cotton', 'wild_corn', 'wild_wheat']);
const DECOR_OK = new Set(['grass', 'tallgrass', 'flower', 'reed', 'mushroom', 'fern', 'bloom', 'heather', 'drygrass', 'thistle', 'litter', 'needles', 'twigs', 'petals', 'moss', 'lily', 'riverstone', 'scree', 'shell', 'driftwood']);

let PM = null; // the planet modules
async function mods() {
  if (PM) return PM;
  const [idx, bio, ren, fl, spw] = await Promise.all([import('./planet/index.js'), import('./planet/biomes.js'), import('./planet/render.js').catch(() => null), import('./planet/flora.js'), import('./planet/spawn.js')]);
  for (const k of fl.FLORA_DECOR) DECOR_OK.add(k);
  return (PM = { ...idx, GROUND_CLASSIC: bio.GROUND_CLASSIC, ROCK_CLASSIC: bio.ROCK_CLASSIC, BIOME_LIST: bio.BIOME_LIST, renderMacro: ren?.renderMacro, floraObject: fl.floraObject, regrowV: fl.regrowV, spawnScores: spw.spawnScores });
}

// the chunk generator of a worker (chunkWorker.js): init = { kind: 'planet', seed, planet }
export async function workerGenerator(init) {
  const m = await mods();
  const planet = init.planet || m.generatePlanet(init.seed);
  const R = planet.realm, sent = new Set();
  return (cx, cy, o) => {
    const d = adaptChunk(m, m.generateChunk(planet, cx, cy, o), cx, cy, o, planet);
    // the settlements of the chunk: their layouts (made here for the ground) go to the main thread once per worker
    // (game/towns.js places the pieces from them; the main thread would plan them in a frame)
    const e = R ? realmIndex(R).get(cy * 256 + cx) : null;
    if (e?.s.length) for (const sid of e.s) if (!sent.has(sid)) { sent.add(sid); (d.layouts || (d.layouts = [])).push(packLayout(settlementLayout(planet, R, sid))); }
    return d;
  };
}

export async function makePlanetSource(seed, opts = {}) {
  const m = await mods();
  const t0 = performance.now();
  const pw = await planetInWorker(seed);
  const planet = pw?.planet || m.generatePlanet(seed);
  const t1 = performance.now();
  let spawn = null;
  const px = opts.px != null && opts.px !== '' ? +opts.px : NaN, py = opts.py != null && opts.py !== '' ? +opts.py : NaN;
  if (px === px && py === py) spawn = { x: px + 0.5, y: py + 0.5 };
  else {
    // the start of a world is temperate (the four seasons, game/seasons.js): findSpawn scores macro cells, the zone of the
    // spot itself (climate interpolated + its altitude) may fall on the warm / subpolar side of a border — the next
    // best spots then (each ~70 ms)
    // the start of a world: the plaza of a village in the deep temperate zone, in front of its mural (docs/REINOS.md
    // "O início"); a planet without kingdoms falls back to the temperate river-side spot of before
    spawn = villageSpawn(m, planet);
    if (!spawn) {
      const sp = m.findSpawn(planet);
      spawn = (sp ? temperateSpawn(m, planet, sp) : anySpawn(m, planet)) || { x: PW / 2 + 0.5, y: PH / 3 + 0.5 };
    }
  }
  const src = {
    kind: 'planet', seed, wrap: true, bounds: null, zones: [{ type: 'spawn', x: spawn.x, y: spawn.y, r: 10 }], spawn,
    timings: { planet: Math.round(t1 - t0) },
    worker: { url: new URL('./chunkWorker.js', import.meta.url).href, init: { kind: 'planet', seed, planet: stripPlanet(planet) } },
    chunk: (cx, cy, o) => adaptChunk(m, m.generateChunk(planet, cx, cy, o), cx, cy, o, planet),
    // the climate of a point (game/seasons.js: local seasons, survival temperatures): the planet's annual mean °C at that
    // place corrected by the lapse rate for its own height h (stories), the seasonal amplitude, the rain (mm / year), its
    // season zone (0 tropical .. 4 polar) and the latitude (degrees, display only)
    climateAt: (x, y, h = null, out = {}) => climatePoint(m, planet, x, y, h, out),
    planet, // (the macro planet: the map, tools)
    biomeKeys: m.BIOME_KEYS, // (world.pbiome id → key: camps, the hot / dry crop rule)
    macro: () => {
      if (!m.renderMacro) return null;
      const rgba = m.renderMacro(planet, 'satellite');
      return { w: m.MW, h: m.MH, rgba, tpp: PW / m.MW };
    },
    // the painted map of the whole planet (relief, biomes, coasts, rivers: planet/render.js renderDetail, 8 tiles a
    // pixel) — made by the planet worker after the boot: a Promise of { w, h, rgba, tpp } (null without a worker)
    mapImage: pw?.map || Promise.resolve(null),
    // the settlement layouts a chunk worker sent with a chunk (streamer.js): adopted, never planned again here
    adoptLayouts: (list) => { if (planet.realm) for (const P of list) adoptLayout(planet.realm, P); },
    chunkOfId: (id) => (typeof id === 'number' && id >= 0 && id < ID_MAX ? Math.floor(id / ID_PER_CHUNK) : -1),
    // regrowth (game/flora.js): the planet species of the tile's planet biome for a regrown classic kind (undefined: classic)
    floraLook: (w, kind, tx, ty, r, v) => m.regrowV(kind, w.pbiome ? w.pbiome.at(tx, ty) : 0, r, v),
  };
  console.info(`[planet] seed ${seed}: planet ${src.timings.planet} ms, spawn ${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)}`);
  return src;
}

// The start village (realm.starts: villages of the deep temperate zone, best first, a pure function of the seed): the first
// whose plaza is well inside the temperate zone at tile level; the spot = the plaza in front of its mural (layout.js)
function villageSpawn(m, planet) {
  const R = planet.realm;
  for (const sid of R?.starts || []) {
    const [x, y] = settlementLayout(planet, R, sid).spawn;
    if (deepTemperate(m, planet, x, y)) return { x, y, town: sid };
  }
  return null;
}
// The start of a world is temperate (the four seasons, game/seasons.js). findSpawn scores macro cells by their own
// climate; the climate of a tile is interpolated between cells (+ its altitude), so the spot it picks may fall on the
// warm / subpolar side of a zone border. Then: the good cells around it (findSpawn's own scores) nearest first, a dry
// flat tile of temperate zone in the chunk of the first one that has it, near a river (5..12 tiles) like findSpawn.
function temperateSpawn(m, planet, sp) {
  if (deepTemperate(m, planet, sp.x, sp.y)) return { x: sp.x, y: sp.y };
  const score = planet._spawnScore || (planet._spawnScore = m.spawnScores(planet)), MW = m.MW, MH = m.MH, CELL = m.CELL;
  const c0 = sp.cell ?? (Math.floor(sp.y / CELL) * MW + Math.floor(sp.x / CELL)), x0 = c0 % MW, y0 = Math.floor(c0 / MW), cand = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const y = y0 + dy;
    if (y < 0 || y >= MH) continue;
    const c = y * MW + (((x0 + dx) % MW) + MW) % MW;
    if (score[c] > -1e8) cand.push([dx * dx + dy * dy - score[c], c]);
  }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return pickTemperate(m, planet, cand.slice(0, 40).map((q) => q[1])) || anySpawn(m, planet) || { x: sp.x, y: sp.y };
}
// no spot from findSpawn (a planet without a good river cell): the land cells of temperate climate, flattest and
// mildest first
function anySpawn(m, planet) {
  const P = planet, cand = [];
  for (let c = 0; c < P.tMean.length; c++) {
    if (P.ocean[c] || P.lakeId[c] || P.water[c] || m.seasonZoneOf(P.tMean[c], P.tAmp[c]) !== 2) continue;
    cand.push([Math.abs(P.tMean[c] - 11) * 0.5 + P.relief[c] * 10 + Math.abs(P.precip[c] - 900) / 300, c]);
  }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return pickTemperate(m, planet, cand.slice(0, 60).map((q) => q[1]));
}
// well inside the temperate zone around (x, y): the point and a ring 48 tiles out are temperate with ≥ 1 °C to spare
// (a start on a zone border would change its season a few steps away)
const TC = {};
function deepTemperate(m, planet, x, y) {
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI * 2, r = k ? 48 : 0, c = climatePoint(m, planet, x + Math.cos(a) * r, y + Math.sin(a) * r, null, TC);
    const warm = c.T + c.tAmp / 2, cold = c.T - c.tAmp / 2;
    if (c.zone !== 2 || Math.min(6 - cold, warm - 10, cold + 12) < 1) return false; // (planet/consts.js seasonZoneOf: temperate = coldest month −12..6 °C, warmest ≥ 10)
  }
  return true;
}
// a dry flat temperate tile near a river in the chunk of the first of these macro cells that has one (null: none)
function pickTemperate(m, planet, cells) {
  const T = {}, MW = m.MW, CELL = m.CELL;
  for (const c of cells) {
    const tx = (c % MW) * CELL + CELL / 2, ty = Math.floor(c / MW) * CELL + CELL / 2;
    if (!deepTemperate(m, planet, tx, ty)) continue;
    const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS), ch = m.generateChunk(planet, cx, cy, { decor: false });
    const riv = [];
    for (let i = 0; i < CT; i++) if (ch.water[i] && (ch.flowX[i] || ch.flowY[i])) riv.push(i);
    let best = null, bs = -1e9;
    for (let y = 4; y < CS - 4; y += 2) for (let x = 4; x < CS - 4; x += 2) {
      const i = y * CS + x, N1 = CS + 1;
      if (ch.water[i] || ch.rock[i]) continue;
      const h0 = ch.height[y * N1 + x];
      if (Math.abs(ch.height[y * N1 + x + 1] - h0) > 0.3 || Math.abs(ch.height[(y + 1) * N1 + x] - h0) > 0.3) continue;
      if (climatePoint(m, planet, cx * CS + x + 0.5, cy * CS + y + 0.5, h0, T).zone !== 2) continue;
      let dr = 99;
      for (const r of riv) { const ax = (r % CS) - x, ay = ((r / CS) | 0) - y, d = Math.sqrt(ax * ax + ay * ay); if (d < dr) dr = d; }
      const s = -Math.abs(Math.min(dr, 30) - 8) - Math.hypot(x - CS / 2, y - CS / 2) * 0.05 + (ch.fertile[i] ? 1 : 0);
      if (s > bs) { bs = s; best = { x: cx * CS + x + 0.5, y: cy * CS + y + 0.5 }; }
    }
    if (best) return best;
  }
  return null;
}

// generatePlanet in a module worker (~2 s off the main thread: the graphics keep loading) → { planet, map: Promise of
// the painted map (the same worker paints it next, ~2.5 s) }; null without workers
function planetInWorker(seed) {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  return new Promise((res) => {
    let wk, mapRes = null;
    const map = new Promise((r) => { mapRes = r; });
    try { wk = new Worker(new URL('./planetWorker.js', import.meta.url), { type: 'module' }); } catch { res(null); return; }
    wk.onmessage = (e) => {
      const d = e.data || {};
      if (d.planet) { res({ planet: d.planet, map }); return; }
      if (d.map || d.mapError || d.error) { wk.terminate(); mapRes(d.map || null); if (d.error) res(null); }
    };
    wk.onerror = () => { wk.terminate(); mapRes(null); res(null); };
    wk.postMessage({ seed, map: true });
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
// (h: the point's height in stories; null = the macro ground there — no lapse correction)
export function climatePoint(m, planet, x, y, h, out) {
  m.macroAt(planet, x, y, CO);
  const T = h == null ? CO.T : CO.T - 0.0065 * (Math.max(0, m.storiesToMeters(h)) - Math.max(0, CO.e));
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
  // the settlements (flat lots, dry town land, fields, streets) and the roads, before anything reads the chunk
  const road = planet?.realm ? applyRealm(planet, p, cx, cy) : null;
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
    if (o.w && o.type !== 'tree_mangrove') continue; // (only mangroves stand in the water)
    const fo = m.floraObject(o.type, o.v);
    if (!fo && !KEEP.has(o.type)) continue;
    o.x += X0; o.y += Y0;
    objects.push(fo ? { ...o, type: fo.type, v: fo.v } : o);
  }
  let dec = null;
  if (decor && p.decor) {
    dec = [];
    // (cosmetic and heavy: at most ~DECOR_MAX per chunk — dense grasslands keep an even sample)
    const step = Math.max(1, p.decor.length / DECOR_MAX);
    for (let k = 0; k < p.decor.length; k += step) {
      const d = p.decor[Math.floor(k)];
      const t = d.t;
      if (!DECOR_OK.has(t)) continue;
      const lx = Math.floor(d.x), ly = Math.floor(d.y);
      if (lx < 0 || ly < 0 || lx >= CS || ly >= CS) continue;
      const l = ly * CS + lx;
      if (rock[l] || (water[l] && !d.w)) continue;
      d.x += X0; d.y += Y0;
      dec.push(d);
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
    wlevel: p.wlevel instanceof Float32Array ? p.wlevel : null, pground: p.ground, prock: p.rockType, pbiome: p.biome, // (pbiome: looks + the fauna's spawn tables, camps)
    features: (p.features || []).map((f) => ({ ...f, x: f.x + X0, y: f.y + Y0 })), // (waterfalls / springs / craters, planet coordinates: fx/waterfalls.js)
    zone: planet ? zonesOf(m, planet, p, cx, cy) : null,
    road, // (path type per tile of the realm's roads and streets: world.road, game/paths.js)
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
