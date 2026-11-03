// Runtime world: tile queries, collision, chunked object lists — on the planet-scale paged store (docs/STREAMING.md).
//
// Size & addressing: W = PW (16384) × H = PH (8192) tiles; a tile is i = idx(x, y) = y * W + (x wrapped). Every per-tile
// layer (`w.rock`, `w.water`…) is a store Layer: `w.rock.get(i)`, `w.rock.set(i, v)`, `w.rock.at(x, y)`. Layers that
// come from the world source (src/world/source.js) are paged by 64 × 64 chunk: `ensure(c)` loads a chunk synchronously,
// the streamer (src/world/streamer.js) loads ahead in workers and evicts far, unchanged chunks. A bounded source (the
// classic 256 × 256 world) sets `wrap = false` and `bounds`: inBounds / map extents are the old ones, outside is bedrock.
// A wrapping source (the planet) has inBounds = 0 ≤ y < H; positions stay canonical (0 ≤ x < W) and distances across the
// seam use `w.dx(a, b)`.
//
// Mountains & caves: `roof0` = 1 where the ORIGINAL rock was ≥ 2 tiles deep (static, from the source).
// `roof` = the CURRENT natural (mountain) roof: a mined roof0 tile keeps it only while rock is still within
// ROOF_GEOM.natSupport tiles (support rule, src/game/content/roofs.js). It is a pure function of the shared rock
// grid (rock only ever disappears), so every peer derives the same roof; mining the mountain open removes it
// (sky light, rain, sun) — `lastLost` lists the tiles that lost their roof in the last mineRock (cave-in fx).
// `broof` = built roof coverage (style index + 1), kept by src/game/roofs.js from roof structures.
// One indoors API: roofAt(tx, ty) → ROOF_NONE 0 / ROOF_NATURAL 1 / ROOF_BUILT 2; isCave = mined + natural roof.
// `caveDk` (u8 per tile): cave darkness — mined & naturally roofed tiles get darker with the walking distance from the
// nearest open-sky tile, spilling ~1 tile onto the surrounding rock. The GPU copy (caveData: R darkness, G ore nearby,
// B trampled ground, A mined floor) is built per chunk by the terrain window (src/world/terrainWindow.js).
// Object buckets (16 × 16 tiles, `CHUNK`): `bucket.objects`, `bucket.decor`, `bucket.pop = { tree, bush, … }`
// (initial population per kind: regrowth targets), `bucket.decals` (Int32Array of tileIndex * 2 + kind; kind 0 = ore
// deposit on a rock tile, 1 = rubble around rough stone floors — built lazily by decalsOf).
// `canGrow(tx, ty, kind)` / `growWeight(...)` tell where a kind may (re)grow naturally.

import { clamp } from '../engine/noise.js';
import { G, BIOMES, BIOME_ID, CAMP_R } from './worldgen.js';
import { ROOF_GEOM } from '../game/content/roofs.js';
import { fertileAt } from './soil.js';
import { Layer, PW, PH, XM, PWS, CS, CSS, CW, CH, NCH, CT, chunkOfI } from './store.js';
import { setActiveHeight } from './height.js';
import { PagedHeight } from './heightPaged.js';

export const ROOF_NONE = 0, ROOF_NATURAL = 1, ROOF_BUILT = 2;
// darkness by walking distance (tiles) from open sky into a cave: 0 = mouth .. ≥ 5 = deep
const CAVE_DK = [0, 0.5, 0.74, 0.88, 0.96, 1];

export const CHUNK = 16;           // object bucket size (tiles)
export const FR = 4;               // field texture resolution per tile
export const BKW = PW / CHUNK, BKH = PH / CHUNK; // object buckets: 1024 × 512 (index by * BKW + bx)
const BKM = BKW - 1, BPC = CS / CHUNK; // (4 buckets per chunk side)
const HPW = PW / 2;
// natural round props that block movement (radius)
export const NATURAL_SOLID = { tree_oak: 0.2, tree_pine: 0.18, tree_birch: 0.16, tree_dead: 0.16, boulder: 0.34 };

const POP_KEYS = ['tree', 'bush', 'berrybush', 'herbbush', 'boulder', 'fibergrass', 'pebble', 'stick', 'wild', 'wild_potato', 'wild_cotton', 'wild_corn'];
const B = BIOME_ID;
const SRC_U8 = ['ground', 'water', 'rockType', 'ore', 'tramp', 'biome', 'fertile'];
const SRC_F32 = ['lush', 'flowX', 'flowY', 'dWater', 'dRock'];

export class World {
  constructor(source) {
    this.source = source;
    this.seed = source.seed;
    this.W = PW; this.H = PH; this.FR = FR;
    this.wrap = !!source.wrap;
    const b = source.bounds || { x0: 0, y0: 0, x1: PW, y1: PH };
    this.bounds = b;
    this.bx0 = b.x0; this.by0 = b.y0; this.bx1 = b.x1; this.by1 = b.y1;
    // extents for loops / clamps: x is unbounded on a wrapping world
    this.minX = this.wrap ? -Infinity : b.x0; this.maxX = this.wrap ? Infinity : b.x1 - 1;
    this.minY = this.wrap ? 0 : b.y0; this.maxY = this.wrap ? PH - 1 : b.y1 - 1;
    this.spawn = source.spawn;
    this.zones = source.zones || [];
    this.timings = source.timings;
    this.camps = this.zones.filter((z) => z.type === 'bandit_camp');
    // ---- layers ----
    const L = (name, T, def, sparse = false) => (this[name] = new Layer(name, T, def, { sparse, store: this }));
    L('ground', Uint8Array, G.STONE); L('water', Uint8Array, 0); L('rockType', Uint8Array, 1); L('ore', Uint8Array, 0);
    L('tramp', Uint8Array, 0); L('biome', Uint8Array, B.MOUNTAIN); L('fertile', Uint8Array, 0);
    L('lush', Float32Array, 0); L('flowX', Float32Array, 0); L('flowY', Float32Array, 0); L('dWater', Float32Array, 9); L('dRock', Float32Array, 0);
    L('rock', Uint8Array, 1); L('rock0', Uint8Array, 1); L('roof', Uint8Array, 1); L('roof0', Uint8Array, 1);
    L('caveDk', Uint8Array, 0); L('rubble', Uint8Array, 0);
    // terrain corner heights (stories, docs/TERRAIN-HEIGHT.md): corner (x, y) = the north-west corner of tile (x, y);
    // chunk-backed (a chunk keeps its 64 × 64 corners, the 65th row / column is the next chunk's first): hBase the
    // source's terrain, hT with the players' edits, hC the surface (+ building bases) — read through this.height
    // (heightPaged.js). wlevel: water surface per tile (stories; the planet's lakes on plateaus), pground: the planet's own
    // ground id (volcanic ash / snow: the terrain shader's climate channel).
    L('hBase', Float32Array, 0); L('hT', Float32Array, 0); L('hC', Float32Array, 0); L('wlevel', Float32Array, 0); L('pground', Uint8Array, 0);
    this.srcLayers = [this.ground, this.water, this.rockType, this.ore, this.tramp, this.biome, this.fertile, this.lush, this.flowX, this.flowY, this.dWater, this.dRock, this.rock, this.rock0, this.roof, this.roof0, this.caveDk, this.rubble, this.hBase, this.hT, this.hC, this.wlevel, this.pground];
    this.hills = !!source.hills; // (dev showcase ?hills=1: a guest sculpts the same classic world, world/hills.js)
    L('solid', Uint8Array, 0, true);   // buildings / walls occupancy (sparse: only where something stands)
    L('broof', Uint8Array, 0, true);   // built roofs (src/game/roofs.js)
    this.deck = null; this.rail = null; this.railU = null; // bridges / piers (game/decks.js): sparse layers when any
    this.lastLost = [];
    // ---- chunks & object buckets ----
    this.crec = new Array(NCH).fill(null); // chunk records { c, cx, cy, ready, dirty, pin, t }
    this.loaded = 0;
    this.live = new Set();                 // loaded chunk indices
    this.stats = { genSync: 0, genAsync: 0, genMs: 0, evicted: 0, installMs: 0 };
    this.onLoad = [];  // (c, rec, data) after a chunk is installed (game systems: flora targets, occupancy…)
    this.onEvict = []; // (c, rec) before a chunk is dropped
    this.bk = new Array(BKW * BKH).fill(null);
    this.objById = new Map();
    this.dirty = null;     // tile rect needing GPU re-upload
    this.caveDirty = null; // tile rect whose cave darkness changed
    // a bounded world is loaded whole up front (16 chunks for the classic world)
    if (!this.wrap) {
      for (let cy = Math.floor(b.y0 / CS); cy <= Math.floor((b.y1 - 1) / CS); cy++)
        for (let cx = Math.floor(b.x0 / CS); cx <= Math.floor((b.x1 - 1) / CS); cx++) this.ensure(cy * CW + cx);
    }
    // terrain height (docs/TERRAIN-HEIGHT.md): all zero = the flat world of before (every hook skipped: height.any false)
    this.height = new PagedHeight(this);
    setActiveHeight(this.height);
  }

  // ---------- addressing ----------
  idx(x, y) { return (y << PWS) | (x & XM); }
  inBounds(x, y) { return this.wrap ? y >= 0 && y < PH : x >= this.bx0 && y >= this.by0 && x < this.bx1 && y < this.by1; }
  // inBounds with a margin of m tiles (the old "x < 1 || x >= W - 1" edge rules: placement, spawns)
  inside(x, y, m = 0) { return this.wrap ? y >= m && y < PH - m : x >= this.bx0 + m && y >= this.by0 + m && x < this.bx1 - m && y < this.by1 - m; }
  // shortest signed x distance a − b (across the seam on a wrapping world)
  dx(a, b) { let d = a - b; if (this.wrap) { if (d > HPW) d -= PW; else if (d < -HPW) d += PW; } return d; }
  // x shifted by whole planets to be nearest ref (drawing across the seam)
  near(x, ref) { if (!this.wrap) return x; const d = x - ref; return d > HPW ? x - PW : d < -HPW ? x + PW : x; }
  wrapPos(x) { return this.wrap && (x < 0 || x >= PW) ? x - PW * Math.floor(x / PW) : x; }
  dist(ax, ay, bx, by) { return Math.hypot(this.dx(ax, bx), ay - by); }

  // ---------- chunks ----------
  chunkIndex(x, y) { const tx = Math.floor(x), ty = Math.floor(y); return ty < 0 || ty >= PH ? -1 : (ty >> CSS) * CW + ((tx & XM) >> CSS); }
  isLoaded(c) { const r = this.crec[c]; return !!(r && r.ready); }
  // load chunk c now (synchronous generation from the source when it is not there yet)
  ensure(c) {
    let r = this.crec[c];
    if (r && r.ready) return r;
    if (c < 0 || c >= NCH) return null;
    const t0 = performance.now();
    const d = this.source.chunk(c & (CW - 1), c >>> 8);
    this.stats.genSync++; this.stats.genMs += performance.now() - t0;
    return this.install(c, d);
  }
  // install generated chunk data (from the source or a worker)
  install(c, d) {
    let r = this.crec[c];
    if (r && r.ready) return r;
    const t0 = performance.now();
    if (!r) r = this.crec[c] = { c, cx: c & (CW - 1), cy: c >>> 8, ready: false, dirty: false, pin: 0, t: 0 };
    // water class 3 (abyssal ocean, planet sources) is deep water for gameplay (the `=== 2` rules); the source keeps
    // the distinction for its looks / the map
    { const Wt = d.water; for (let l = 0; l < CT; l++) if (Wt[l] > 2) Wt[l] = 2; }
    this.rock0.attach(c, d.rock); this.rock.attach(c, d.rock.slice());
    this.roof0.attach(c, d.roof); this.roof.attach(c, d.roof.slice());
    for (const k of SRC_U8) this[k].attach(c, d[k]);
    for (const k of SRC_F32) this[k].attach(c, d[k]);
    this.caveDk.attach(c, new Uint8Array(CT)); this.rubble.attach(c, new Uint8Array(CT));
    const hb = cornersOf(d.heights);
    this.hBase.attach(c, hb); this.hT.attach(c, hb.slice()); this.hC.attach(c, hb.slice());
    this.wlevel.attach(c, d.wlevel instanceof Float32Array && d.wlevel.length === CT ? d.wlevel : new Float32Array(CT));
    this.pground.attach(c, d.pground instanceof Uint8Array && d.pground.length === CT ? d.pground : new Uint8Array(CT));
    r.ready = true; r.decor = !!d.decor;
    this.loaded++; this.live.add(c);
    for (const o of d.objects) { o.solid = NATURAL_SOLID[o.type] || 0; this._insert(o); }
    if (d.decor) for (const dd of d.decor) this.chunkAt(dd.x, dd.y).decor.push(dd);
    if (d.decor && this.onDecor) this.onDecor(c);
    // initial population per bucket (regrowth targets)
    this._forBucketsOf(c, (bk) => { bk.pop = popCount(bk.objects); bk.decals = null; });
    this._decalsDirtyNear(c);
    for (const f of this.onLoad) f(c, r, d);
    const ms = performance.now() - t0;
    this.stats.installMs += ms; this.stats.installMax = Math.max(this.stats.installMax || 0, ms);
    return r;
  }
  // cosmetic ground decor of a chunk made after its load (streamed sources make it only near the camera)
  addDecor(c, list) {
    const r = this.crec[c];
    if (!r || !r.ready || r.decor) return;
    r.decor = true;
    for (const dd of list) this.chunkAt(dd.x, dd.y).decor.push(dd);
    this.onDecor?.(c); // (game/paths.js: grass hidden on painted paths)
  }
  // forget the cosmetic decor of a chunk far from the camera (made again by the source when it comes back)
  dropDecor(c) {
    const r = this.crec[c];
    if (!r || !r.decor) return;
    r.decor = false;
    this._forBucketsOf(c, (bk) => { bk.decor = []; });
  }
  // drop a loaded chunk (never one that changed: its state lives only here — `dirty` / `pin`)
  evict(c) {
    const r = this.crec[c];
    if (!r || !r.ready || r.dirty || r.pin) return false;
    for (const f of this.onEvict) f(c, r);
    this._forBucketsOf(c, (bk) => { for (const o of bk.objects) this.objById.delete(o.id); }, true);
    for (const L of this.srcLayers) L.detach(c);
    this.crec[c] = null;
    this.loaded--; this.live.delete(c);
    this.stats.evicted++;
    return true;
  }
  // the chunk of tile i changed (mined, object added / removed / touched): it is never evicted from now on
  markDirty(i) { const r = this.crec[chunkOfI(i)]; if (r) r.dirty = true; }
  markDirtyAt(x, y) { const ty = Math.floor(y); if (ty >= 0 && ty < PH) this.markDirty(this.idx(Math.floor(x), ty)); }
  _forBucketsOf(c, fn, drop = false) {
    const bx0 = (c & (CW - 1)) * BPC, by0 = (c >>> 8) * BPC;
    for (let by = by0; by < by0 + BPC; by++) for (let bx = bx0; bx < bx0 + BPC; bx++) {
      const k = by * BKW + bx, bk = this.bk[k];
      if (bk) { fn(bk); if (drop) this.bk[k] = null; }
    }
  }
  // loaded chunk indices (ascending)
  *loadedChunks() { for (const c of [...this.live].sort((a, b) => a - b)) yield c; }
  // loaded buckets (all object lists) — the buckets of the loaded chunks
  *buckets() {
    for (const c of this.live) {
      const bx0 = (c & (CW - 1)) * BPC, by0 = (c >>> 8) * BPC;
      for (let by = by0; by < by0 + BPC; by++) for (let bx = bx0; bx < bx0 + BPC; bx++) { const b = this.bk[by * BKW + bx]; if (b) yield b; }
    }
  }
  // every loaded object
  *allObjects() { for (const b of this.buckets()) yield* b.objects; }

  // ---------- object buckets ----------
  chunkAt(x, y) {
    const by = clamp(Math.floor(y / CHUNK), 0, BKH - 1);
    let bx = Math.floor(x / CHUNK);
    if (!this.wrap) bx = clamp(bx, Math.floor(this.bx0 / CHUNK), Math.floor((this.bx1 - 1) / CHUNK));
    const k = by * BKW + (bx & BKM);
    return this.bk[k] || (this.bk[k] = { k, objects: [], decor: [], pop: null, decals: null, sorted: true });
  }

  _insert(o) {
    this.chunkAt(o.x, o.y).objects.push(o);
    this.objById.set(o.id, o);
  }

  // Runtime changes to the object lists are SHARED state: only op appliers / snapshot apply / the
  // deterministic camp layout may call these (game.net installs `guard`, which checks net.applying).
  // Every object needs an id given by the authority (no random ids: two peers would disagree).
  addObject(o) {
    this.guard?.('addObject');
    if (o.id == null || o.id === '') throw new Error('world.addObject: objeto sem id');
    this.ensure(this.chunkIndex(o.x, o.y));
    this._insert(o);
    this.markDirtyAt(o.x, o.y);
    // keep chunk list y-sorted lazily
    this.chunkAt(o.x, o.y).sorted = false;
    return o;
  }

  removeObject(o) {
    this.guard?.('removeObject');
    const c = this.chunkAt(o.x, o.y);
    const k = c.objects.indexOf(o);
    if (k >= 0) c.objects.splice(k, 1);
    this.objById.delete(o.id);
    this.markDirtyAt(o.x, o.y);
  }

  // iterate buckets overlapping a world rect (x wraps on the planet; a bounded world clamps to its area)
  forChunks(x0, y0, x1, y1, fn) {
    let bx0 = Math.floor(x0 / CHUNK), bx1 = Math.floor(x1 / CHUNK);
    const by0 = Math.max(0, Math.floor(y0 / CHUNK)), by1 = Math.min(BKH - 1, Math.floor(y1 / CHUNK));
    if (!this.wrap) { bx0 = Math.max(bx0, Math.floor(this.bx0 / CHUNK)); bx1 = Math.min(bx1, Math.floor((this.bx1 - 1) / CHUNK)); }
    else if (bx1 - bx0 >= BKW) { bx0 = 0; bx1 = BKM; }
    const K = this.bk;
    for (let by = by0; by <= by1; by++) {
      const row = by * BKW;
      for (let bx = bx0; bx <= bx1; bx++) { const b = K[row + (bx & BKM)]; if (b) fn(b); }
    }
  }

  // objects within radius
  query(x, y, r, filter) {
    const out = [], wrap = this.wrap;
    this.forChunks(x - r, y - r, x + r, y + r, (c) => {
      for (const o of c.objects) {
        let dx = o.x - x;
        if (wrap) { if (dx > HPW) dx -= PW; else if (dx < -HPW) dx += PW; }
        const dy = o.y - y;
        if (dx * dx + dy * dy <= r * r && (!filter || filter(o))) out.push(o);
      }
    });
    return out;
  }

  // ---------- tiles ----------
  isRock(tx, ty) { return !this.inBounds(tx, ty) || this.rock.get(this.idx(tx, ty)) === 1; }
  waterAt(tx, ty) { return this.inBounds(tx, ty) ? this.water.get(this.idx(tx, ty)) : 0; }
  // water you can sink into: none while it is frozen (winter: this.frozen, set by seasons.js on every peer) nor on a
  // finished pier / bridge deck (this.deck, derived by game/decks.js from the structures on every peer) — unless the
  // body is under the deck (under: e._ud, physics.deckTrack: swimming under a bridge).
  // Movement / swimming / creature paths use this; looks, placement rules and the minimap keep waterAt.
  liquidAt(tx, ty, under = false) { return this.frozen || (!under && this.deck && this.inBounds(tx, ty) && this.deck.get(this.idx(tx, ty))) ? 0 : this.waterAt(tx, ty); }
  blocked(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = this.idx(tx, ty);
    return this.rock.get(i) === 1 || (this.water.get(i) === 2 && !this.frozen && !(this.deck && this.deck.get(i))) || this.solid.get(i) === 1 || this.height.isCliff(tx, ty);
  }
  groundAt(tx, ty) { return this.inBounds(tx, ty) ? this.ground.get(this.idx(tx, ty)) : G.STONE; }

  // ---------- terrain height (heightPaged.js; stories, 0 everywhere on a flat world) ----------
  heightAt(x, y) { return this.height.heightAt(x, y); }
  cornerH(ix, iy) { return this.height.cornerH(ix, iy); }
  tileSlope(tx, ty) { return this.height.tileSlope(tx, ty); }
  isCliff(tx, ty) { return this.height.isCliff(tx, ty); }
  cliffBetween(ax, ay, bx, by) { return this.height.cliffBetween(ax, ay, bx, by); }
  get hasHeight() { return this.height.any; }

  // movement speed multiplier at a world point (under: the body is under a bridge deck, physics.deckTrack)
  speedAt(x, y, under = false) {
    const tx = Math.floor(x), ty = Math.floor(y);
    const wa = this.waterAt(tx, ty);
    if (wa && !under && this.deck && this.deck.get(this.idx(tx, ty))) return 1; // on a pier / bridge deck (game/decks.js)
    if (wa && this.frozen) return 0.92; // ice: a little careful
    if (wa === 2) return 0.14; // deep water: swimming, a lot slower than wading
    if (wa === 1) return 0.55;
    const g = this.groundAt(tx, ty);
    if (g === G.MARSH) return 0.7;
    if (g === G.MUD) return 0.8;
    return 1;
  }

  // Remove a rock wall tile (mining). Returns true if changed.
  mineRock(tx, ty) {
    this.guard?.('mineRock');
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    if (!this.rock.get(i)) return false;
    this.rock.set(i, 0);
    this.ore.set(i, 0);
    this.ground.set(i, G.STONE);
    this.markDirty(i);
    // terrain height (docs/TERRAIN-HEIGHT.md): a rocky knoll is cut down to the tile's lowest corner (every peer)
    if (this.height.any) {
      const L = this.height, lo = L.tileMin(tx, ty), cut = [];
      for (let k = 0; k < 4; k++) { const o = L.ci(tx + (k & 1), ty + (k >> 1)); if (L.t.get(o) > lo + 1e-4) cut.push([o, lo]); }
      if (cut.length) L.setTerrain(cut);
    }
    this.lastLost = this._naturalRoof(tx, ty);
    const M = ROOF_GEOM.natSupport + CAVE_DK.length;
    this._buildCave(tx - M, ty - M, tx + M, ty + M);
    this._markCaveDirty(tx - M, ty - M, tx + M, ty + M);
    this._decalsDirty(tx - 2, ty - 2, tx + 2, ty + 2);
    this._markDirty(tx - 6, ty - 6, tx + 6, ty + 6);
    return true;
  }

  // ---------- decals (lazy, per bucket) ----------
  // rubble = rough stone floor: a mined tile, or stone ground next to rock
  _rubbleAt(x, y) {
    const K = this.rock, i = this.idx(x, y);
    if (K.get(i) || this.ground.get(i) !== G.STONE) return 0;
    if (this.rock0.get(i)) return 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy;
      if (yy < 0 || yy >= PH) continue;
      if (!this.wrap && !this.inBounds(x + dx, yy)) continue;
      if (K.at(x + dx, yy)) return 1;
    }
    return 0;
  }
  _oreNear(x, y) {
    const O = this.ore;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!this.wrap && !this.inBounds(x + dx, y + dy)) continue;
      if (O.at(x + dx, y + dy)) return 1;
    }
    return 0;
  }
  // the decal list of a bucket (rock tiles with ore near, tiles on / beside rubble), built on first use
  decalsOf(bk) {
    if (bk.decals) return bk.decals;
    const bx = (bk.k % BKW) * CHUNK, by = Math.floor(bk.k / BKW) * CHUNK;
    const K = this.rock, list = [];
    // rubble of the bucket + 1 tile around
    const RW = CHUNK + 2, rb = new Uint8Array(RW * RW);
    for (let y = -1; y <= CHUNK; y++) for (let x = -1; x <= CHUNK; x++) {
      const tx = bx + x, ty = by + y;
      if (ty < 0 || ty >= PH || (!this.wrap && !this.inBounds(tx, ty))) continue;
      rb[(y + 1) * RW + x + 1] = this._rubbleAt(tx, ty);
    }
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      const tx = bx + x, ty = by + y;
      if (!this.inBounds(tx, ty)) continue;
      const i = this.idx(tx, ty);
      this.rubble.set(i, rb[(y + 1) * RW + x + 1]);
      if (K.get(i)) { if (this._oreNear(tx, ty)) list.push(i * 2); continue; }
      // rubble quads cover the rubble tiles and their neighbours (stones may straddle tile edges)
      let near = 0;
      for (let dy = 0; dy <= 2 && !near; dy++) for (let dx = 0; dx <= 2; dx++) if (rb[(y + dy) * RW + x + dx]) { near = 1; break; }
      if (near) list.push(i * 2 + 1);
    }
    return (bk.decals = Int32Array.from(list));
  }
  _decalsDirty(x0, y0, x1, y1) { this.forChunks(x0 - 1, y0 - 1, x1 + 1, y1 + 1, (bk) => { bk.decals = null; }); }
  // a chunk arrived: the buckets on its border may have used the default rock of the missing chunk
  _decalsDirtyNear(c) {
    const x0 = (c & (CW - 1)) * CS, y0 = (c >>> 8) * CS;
    this._decalsDirty(x0 - 1, y0 - 1, x0 + CS, y0 + CS);
  }

  // ---------- roofs & caves ----------
  // ROOF_BUILT (a finished roof structure), ROOF_NATURAL (mountain rock / a supported cave ceiling) or ROOF_NONE.
  // Out of bounds = natural.
  roofAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return ROOF_NATURAL;
    const i = this.idx(tx, ty);
    return this.broof.get(i) ? ROOF_BUILT : this.roof.get(i) ? ROOF_NATURAL : ROOF_NONE;
  }
  // same at a world point (feet position)
  roofAtPoint(x, y) { return this.roofAt(Math.floor(x), Math.floor(y - 0.05)); }
  // mined tile under a (still supported) mountain roof (dark cave floor)
  isCave(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    return this.roof.get(i) === 1 && this.rock.get(i) === 0;
  }
  // is rock within the natural support distance of tile (tx, ty)?
  _rockNear(tx, ty) {
    const N = ROOF_GEOM.natSupport, N2 = N * N, K = this.rock;
    for (let dy = -N; dy <= N; dy++) {
      const y = ty + dy;
      if (y < this.minY || y > this.maxY) return true; // the map edge is solid mountain
      const r = Math.floor(Math.sqrt(N2 - dy * dy));
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx;
        if (x < this.minX || x > this.maxX || K.get(this.idx(x, y))) return true;
      }
    }
    return false;
  }
  // after rock (tx, ty) was removed: mined tiles within the support distance that no longer have rock near them
  // lose their natural roof (deterministic: a function of the shared rock grid). Returns the tile indices lost.
  _naturalRoof(tx, ty) {
    const N = ROOF_GEOM.natSupport, R = this.roof, K = this.rock, lost = [];
    for (let y = Math.max(this.minY, ty - N); y <= Math.min(this.maxY, ty + N); y++) {
      for (let x = Math.max(this.minX, tx - N); x <= Math.min(this.maxX, tx + N); x++) {
        const i = this.idx(x, y);
        if (!R.get(i) || K.get(i)) continue;
        if (!this._rockNear(x, y)) { R.set(i, 0); lost.push(i); }
      }
    }
    return lost;
  }
  _markCaveDirty(x0, y0, x1, y1) {
    const d = this.caveDirty;
    if (!d) this.caveDirty = [x0, y0, x1, y1];
    else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
  }
  // smooth cave darkness 0..1 at a world point (same field the shaders use)
  caveDark(x, y) {
    const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
    const D = this.caveDk, cx = (xx) => (this.wrap ? xx : clamp(xx, this.bx0, this.bx1 - 1)), cy = (yy) => clamp(yy, this.minY, this.maxY);
    const s = (xx, yy) => D.get(this.idx(cx(xx), cy(yy)));
    const a = s(x0, y0) + (s(x0 + 1, y0) - s(x0, y0)) * u, b = s(x0, y0 + 1) + (s(x0 + 1, y0 + 1) - s(x0, y0 + 1)) * u;
    return (a + (b - a) * v) / 255;
  }
  // tile was rock originally and has been dug out
  isMined(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    return this.rock0.get(i) === 1 && this.rock.get(i) === 0;
  }

  // Cave darkness for the rect: walking distance (8-neighbour, through open ground) from the nearest sky tile
  // (open, not naturally roofed) into the roofed tunnels, mapped by CAVE_DK; computed in a window with a margin so
  // the distances in the rect are exact. `caveFade` (cosmetic hook, src/game/roofs.js) receives the changed values
  // instead of an instant jump when it is set and `fadeCave` is on.
  _buildCave(x0, y0, x1, y1) {
    const R = this.roof, K = this.rock, D = this.caveDk;
    x0 = Math.max(this.minX, x0); y0 = Math.max(this.minY, y0); x1 = Math.min(this.maxX, x1); y1 = Math.min(this.maxY, y1);
    const MD = CAVE_DK.length - 1, M = MD + 1;
    // local copies of rock / roof over the window + 1 (the darkness spill looks one tile further)
    const wx0 = Math.max(this.minX, x0 - M), wy0 = Math.max(this.minY, y0 - M), wx1 = Math.min(this.maxX, x1 + M), wy1 = Math.min(this.maxY, y1 + M);
    const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1, n = ww * wh;
    const kw = new Uint8Array(n), rw = new Uint8Array(n);
    for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
      const i = this.idx(x, y), j = (y - wy0) * ww + (x - wx0);
      kw[j] = K.get(i); rw[j] = R.get(i);
    }
    const dist = new Uint8Array(n).fill(255), q = new Int32Array(n);
    let qh = 0, qt = 0, any = false;
    for (let j = 0; j < n; j++) {
      if (kw[j]) continue;
      if (rw[j]) { any = true; continue; }
      dist[j] = 0; q[qt++] = j;
    }
    if (any) {
      while (qh < qt) {
        const j = q[qh++], d = dist[j];
        if (d >= MD) continue;
        const x = j % ww, y = (j - x) / ww;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
          const k = ny * ww + nx;
          if (dist[k] <= d + 1 || kw[k]) continue;
          if (dx && dy && (kw[y * ww + nx] || kw[ny * ww + x])) continue; // no light through rock corners
          dist[k] = d + 1; q[qt++] = k;
        }
      }
    }
    const cav = (x, y) => {
      if (y < this.minY || y > this.maxY || x < this.minX || x > this.maxX) return 0;
      if (x < wx0 || x > wx1 || y < wy0 || y > wy1) { const i = this.idx(x, y); return R.get(i) && !K.get(i) ? 1 : 0; }
      const j = (y - wy0) * ww + (x - wx0);
      if (!rw[j] || kw[j]) return 0;
      return CAVE_DK[Math.min(MD, dist[j])];
    };
    const fade = this.fadeCave && this.caveFade;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, y), rock = kw[(y - wy0) * ww + (x - wx0)];
      let v = cav(x, y);
      if (!v || rock) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) { const c = cav(x + dx, y + dy); if (c) m = Math.max(m, c * (dx && dy ? 0.55 : 1)); }
        }
        // darkness spills onto the rock around the tunnels; the cave mouth fades to daylight
        v = rock ? m * 0.7 : Math.max(v, m * 0.3);
      }
      const nv = Math.round(v * 255), ov = D.get(i);
      if (fade && Math.abs(nv - ov) > 6) fade(i, ov, nv);
      else if (nv !== ov) D.set(i, nv);
    }
  }

  // ---------- natural (re)growth ----------
  // Suitability 0..1 of a tile for a natural kind ('tree' | 'bush' | 'berrybush' | 'fibergrass' | 'pebble' |
  // 'stick' | 'wild_potato' | 'wild_cotton' | 'wild_corn' | 'boulder'), from ground, biome, water, rock and
  // roofs: never on rock, water, mined tunnels, building tiles or bandit camp grounds. 0 = never.
  // (The "not near player buildings / not in view" rules belong to the regrowth system.)
  growWeight(tx, ty, kind) {
    if (!this.inBounds(tx, ty)) return 0;
    const i = this.idx(tx, ty);
    if (this.rock0.get(i) || this.water.get(i) || this.solid.get(i) || this.roof.get(i)) return 0;
    if (this.path && (this.path.get(i) || this.pathPlan.get(i))) return 0; // painted paths and their blueprints (game/paths.js)
    if (this.tramp.get(i) > 40) return 0;
    for (const c of this.camps) if (this.dx(tx + 0.5, c.x) ** 2 + (ty + 0.5 - c.y) ** 2 < (c.r || CAMP_R) ** 2) return 0;
    const b = this.biome.get(i), g = this.ground.get(i), dw = this.dWater.get(i), dr = this.dRock.get(i);
    const L = this.lush.get(i);
    const woods = b === B.FOREST || b === B.PINE || b === B.BIRCH;
    switch (kind) {
      case 'tree': {
        if (g === G.SAND || g === G.STONE || b === B.SHORE) return 0;
        let w = woods ? 1 : b === B.MEADOW ? 0.08 : b === B.MARSH || b === B.ROCKY ? 0.15 : 0;
        if (dw < 1.5) w *= 0.25;
        return w;
      }
      case 'bush': return woods ? 0.8 : b === B.MEADOW ? 0.35 : b === B.MARSH ? 0.3 : 0;
      case 'berrybush': return g === G.SAND || g === G.STONE ? 0 : woods ? 0.7 : b === B.MEADOW ? 0.5 : 0;
      // medicinal herbs like shade and moisture: woods (birch groves most), marsh edges, damp meadows
      case 'herbbush': return g === G.SAND || g === G.STONE || g === G.MARSH ? 0 : b === B.BIRCH ? 0.8 : woods ? 0.6 : b === B.MARSH ? 0.45 : b === B.MEADOW ? (dw < 8 ? 0.35 : 0.15) : 0;
      case 'fibergrass': return b === B.MEADOW ? 0.4 + L * 0.6 : b === B.MARSH ? (g === G.MUD ? 0.9 : 0.5) : woods ? (g === G.MOSS ? 0.15 : 0.5) : b === B.SHORE && dw > 1.2 ? 0.2 : 0;
      case 'pebble': {
        if (g === G.MARSH) return 0;
        if (g === G.GRAVEL || b === B.ROCKY) return 1;
        if (b === B.SHORE || g === G.SAND) return 0.7;
        return dr < 5 ? 0.7 : 0.12;
      }
      case 'stick': return woods ? 1 : b === B.MARSH ? 0.3 : b === B.MEADOW ? 0.08 : 0;
      case 'boulder': return g === G.MARSH || g === G.MUD ? 0 : b === B.ROCKY ? 1 : dr < 5 ? 0.5 : b === B.SHORE ? 0.15 : 0.05;
      case 'wild_potato': return b === B.MEADOW || (woods && g !== G.MOSS) ? 0.6 : 0;
      case 'wild_cotton': return (b === B.MEADOW || b === B.SHORE) && dw > 1.4 && dw < 9 && g !== G.GRAVEL ? 0.7 : 0;
      case 'wild_corn': return b === B.MEADOW && dw > 3 ? 0.6 : 0;
      case 'wild_wheat': return fertileAt(this, tx, ty) && g !== G.GRAVEL && g !== G.STONE && g !== G.MUD && (b === B.MEADOW || b === B.SHORE || b === B.BIRCH || b === B.FOREST) ? 0.8 : 0; // (soil.js)
      default: return 0;
    }
  }
  canGrow(tx, ty, kind) { return this.growWeight(tx, ty, kind) > 0; }

  _markDirty(x0, y0, x1, y1) {
    if (!this.dirty) this.dirty = [x0, y0, x1, y1];
    else {
      const d = this.dirty;
      d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1);
    }
  }

  // biome name at a world point (see worldgen BIOMES)
  biomeAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inBounds(tx, ty)) return 'mountain';
    return BIOMES[this.biome.get(this.idx(tx, ty))];
  }

  // bytes held by the tile layers (streaming HUD)
  memBytes() {
    let b = 0;
    for (const L of this.srcLayers) b += L.bytes();
    for (const L of [this.solid, this.broof, this.deck, this.rail, this.railU, this.path, this.pathPlan, this.noGrow]) if (L) b += L.bytes();
    return b + (this.height ? this.height.bytes() : 0);
  }
}

// the chunk's own 64 × 64 corners from a source's (65 × 65) heights (null: flat)
function cornersOf(h) {
  const a = new Float32Array(CT);
  if (!h) return a;
  const n = h.length === CT ? CS : CS + 1;
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) a[y * CS + x] = h[y * n + x];
  return a;
}

// initial population of a bucket per natural kind
function popCount(objects) {
  const p = {};
  for (const k of POP_KEYS) p[k] = 0;
  for (const o of objects) {
    const t = o.type;
    if (t.startsWith('tree_')) p.tree++;
    else if (p[t] !== undefined) { p[t]++; if (t.startsWith('wild_')) p.wild++; }
  }
  return p;
}
