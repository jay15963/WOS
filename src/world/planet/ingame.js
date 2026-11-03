// Dev preview (?planet=1[&px=..&py=..&psize=256|512]): a classic-size World built from the planet's chunk
// generator around the spawn (or tile px, py), mapped onto the fields generateWorld returns, so the current
// game can walk real planet terrain before the streaming engine exists. Heights are not used by the current
// renderer: they ride along as `heightStories` (corners, (W+1) x (H+1)) for the height prototype, with the
// planet's own layers in `planetBiome`, `planetGround`, `planetWater` (incl. abyss 3) and `planetAt`.

import { generatePlanet } from './macro.js';
import { assembleWindow } from './window.js';
import { findSpawn } from './spawn.js';
import { BIOME_LIST, GROUND_CLASSIC, ROCK_CLASSIC } from './biomes.js';
import { floraObject, regrowV, FLORA_DECOR } from './flora.js';
import { CHUNK, CHH } from './consts.js';
import { BIOMES, BIOME_ID } from '../worldgen.js';
import { mulberry32 } from '../../engine/noise.js';

const sq = (v) => v * v;

const KEEP = new Set(['tree_oak', 'tree_pine', 'tree_birch', 'tree_dead', 'bush', 'berrybush', 'herbbush', 'boulder', 'pebble', 'stick', 'fibergrass', 'wild_potato', 'wild_cotton', 'wild_corn', 'wild_wheat']);
const DECOR_OK = new Set(['grass', 'tallgrass', 'flower', 'reed', 'mushroom', 'fern', 'bloom', 'heather', 'drygrass', 'thistle', 'litter', 'needles', 'twigs', 'petals', 'moss', 'lily', 'riverstone', 'scree', 'shell', 'driftwood', ...FLORA_DECOR]);

function distanceField(W, H, isSource) {
  const d = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) if (isSource(i)) d[i] = 0;
  const D2 = 1.4142;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + D2); if (x < W - 1) v = Math.min(v, d[i - W + 1] + D2); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + D2); if (x > 0) v = Math.min(v, d[i + W - 1] + D2); }
    d[i] = v;
  }
  return d;
}

export function buildPlanetWorld(seed, opts = {}) {
  const t0 = performance.now();
  const planet = generatePlanet(seed);
  const t1 = performance.now();
  const size = +opts.size === 512 ? 512 : 256;
  let sx = opts.px != null && opts.px !== '' ? +opts.px : NaN, sy = opts.py != null && opts.py !== '' ? +opts.py : NaN;
  if (!(sx === sx && sy === sy)) { const sp = findSpawn(planet); sx = sp.x; sy = sp.y; }
  const n = size / CHUNK;
  const cx0 = Math.floor(sx / CHUNK) - (n >> 1), cy0 = Math.max(0, Math.min(CHH - n, Math.floor(sy / CHUNK) - (n >> 1)));
  const win = assembleWindow(planet, cx0, cy0, n, n, { decor: true });
  const t2 = performance.now();
  const W = win.w, H = win.h, N = W * H;
  const rock = win.rock, water = new Uint8Array(N), ground = new Uint8Array(N), rockType = new Uint8Array(N), biome = new Uint8Array(N);
  const lush = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    water[i] = rock[i] ? 0 : Math.min(2, win.water[i]);
    ground[i] = GROUND_CLASSIC[win.ground[i]] ?? 0;
    rockType[i] = ROCK_CLASSIC[win.rockType[i]] || 1;
    biome[i] = rock[i] ? BIOME_ID.MOUNTAIN : water[i] ? BIOME_ID.WATER : BIOME_LIST[win.biome[i]].cl ?? 0;
    lush[i] = win.lush[i] / 255;
  }
  const dWater = distanceField(W, H, (i) => water[i] > 0);
  const dRock = distanceField(W, H, (i) => rock[i] > 0);
  const dLand = distanceField(W, H, (i) => rock[i] === 0);
  const roof = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (rock[i] && dLand[i] >= 2) roof[i] = 1;
  // local spawn: the nearest dry, open tile
  let spx = Math.floor(sx - win.x0), spy = Math.floor(sy - win.y0);
  const okSpawn = (i) => !rock[i] && !water[i];
  if (!okSpawn(spy * W + spx)) {
    let best = 1e9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = sq(x - spx) + sq(y - spy);
      if (d < best && okSpawn(y * W + x) && dWater[y * W + x] > 2) { best = d; spx = x; spy = y; }
    }
  }
  const spawn = { x: spx + 0.5, y: spy + 0.5 };
  // objects: the planet's kinds as classic kinds + an art species (flora.js); only mangroves stand in the water;
  // clear the arrival spot
  const objects = [];
  for (const o of win.objects) {
    const fo = floraObject(o.type, o.v);
    if (o.w && o.type !== 'tree_mangrove') continue;
    if (!fo && !KEEP.has(o.type)) continue;
    if (sq(o.x - spawn.x) + sq(o.y - spawn.y) < 2.4 * 2.4) continue;
    objects.push(fo ? { ...o, type: fo.type, v: fo.v } : o);
  }
  // the first gatherables near the spawn (like generateWorld guarantees)
  {
    const rnd = mulberry32(seed * 53 + 11);
    const need = { pebble: 10, stick: 8, fibergrass: 8, berrybush: 2, herbbush: 1 };
    for (const o of objects) if (need[o.type] !== undefined && sq(o.x - spawn.x) + sq(o.y - spawn.y) < 14 * 14) need[o.type]--;
    let id = 1073741824; // above every chunk object id (cidx * 16384 + k)
    const occ = new Set(objects.map((o) => Math.floor(o.y) * W + Math.floor(o.x)));
    for (const [type, k] of Object.entries(need)) {
      for (let c = 0, tries = 0; c < k && tries < 400; tries++) {
        const x = Math.floor(spawn.x + (rnd() * 2 - 1) * 13), y = Math.floor(spawn.y + (rnd() * 2 - 1) * 13);
        const r2 = sq(x + 0.5 - spawn.x) + sq(y + 0.5 - spawn.y);
        if (r2 < 9 || r2 > 169) continue;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x;
        if (!okSpawn(i) || occ.has(i)) continue;
        occ.add(i);
        objects.push({ id: id++, type, v: Math.floor(rnd() * (type === 'pebble' ? 4 : type.endsWith('bush') ? 1000 : 3)), x: x + 0.5, y: y + 0.6, s: 0.9, f: rnd() < 0.5 ? -1 : 1 });
        c++;
      }
    }
  }
  const decor = [];
  for (const d of win.decor) {
    if (!DECOR_OK.has(d.t)) continue;
    const i = Math.floor(d.y) * W + Math.floor(d.x);
    if (i < 0 || i >= N || rock[i] || (water[i] && !d.w)) continue;
    decor.push(d);
  }
  // zones: spawn + dominant classic biome per 16 x 16 block (spawn tables)
  const zones = [{ type: 'spawn', x: spawn.x, y: spawn.y, r: 10 }];
  for (let by = 0; by < H; by += 16) for (let bx = 0; bx < W; bx += 16) {
    const cnt = new Uint16Array(BIOMES.length);
    for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) cnt[biome[y * W + x]]++;
    let bb = 0;
    for (let k = 1; k < cnt.length; k++) if (cnt[k] > cnt[bb]) bb = k;
    if (cnt[bb] > 0.4 * 256) zones.push({ type: BIOMES[bb], x: bx + 8, y: by + 8, r: 8, f: Math.round((cnt[bb] / 256) * 100) / 100 });
  }
  const timings = { planet: Math.round(t1 - t0), chunks: Math.round(t2 - t1), adapt: Math.round(performance.now() - t2) };
  console.info(`[planet] seed ${seed}: planet ${timings.planet} ms, ${n * n} chunks ${timings.chunks} ms, window ${win.x0},${win.y0} ${W}x${H}, spawn ${spawn.x},${spawn.y}`);
  return {
    timings, seed, W, H, rock, water, ground, rockType, ore: win.ore, roof, tramp: new Uint8Array(N), lush,
    flowX: win.flowX, flowY: win.flowY, objects, decor, spawn, dWater, dRock, biome, zones,
    heightStories: win.height, planetBiome: win.biome, planetGround: win.ground, planetWater: win.water, wlevel: win.wlevel, fertilePlanet: win.fertile,
    groundLook: win.ground.slice(), rockLook: win.rockType.map((v) => v || 1), // (the terrain shader's own layers for them)
    planetAt: { seed, x0: win.x0, y0: win.y0 },
    // regrowth (game/flora.js): the planet species of the biome for a regrown classic kind (undefined: classic)
    floraLook: (kind, tx, ty, r, v) => regrowV(kind, win.biome[ty * W + tx], r, v),
  };
}
