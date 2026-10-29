// Runtime world: tile queries, collision, chunked object lists, GPU field textures.
//
// Mountains & caves: `roof[i] = 1` where the ORIGINAL rock was ≥ 2 tiles deep (static, set by worldgen).
// Mined tiles under a roof are dark caves (`isCave`). `caveData` (RGBA, 1×, linear on the GPU):
//   R = cave darkness (mined & roofed tiles, spilling ~1 tile onto the surrounding rock and fading at
//       the cave mouth), G = ore nearby (tile or a neighbour holds ore: lets the shader skip ore work),
//       B = trampled ground (bandit camps / trails), A = mined floor.
// Chunks carry their initial population per kind: `chunk.pop = { tree, bush, berrybush, boulder,
// fibergrass, pebble, stick, wild, wild_potato, wild_cotton, wild_corn }` (regrowth targets).
// `canGrow(tx, ty, kind)` / `growWeight(...)` tell where a kind may (re)grow naturally.
// Terrain decals: `chunk.decals` (Int32Array of tileIndex * 2 + kind; kind 0 = ore deposit on a rock
// tile, 1 = rubble around rough stone floors) — the tiles the DECAL shader pass must cover.

import { boxBlur, clamp } from '../engine/noise.js';
import { G, BIOMES, BIOME_ID, CAMP_R } from './worldgen.js';

export const CHUNK = 16;
export const FR = 4; // field texture resolution per tile

const POP_KEYS = ['tree', 'bush', 'berrybush', 'boulder', 'fibergrass', 'pebble', 'stick', 'wild', 'wild_potato', 'wild_cotton', 'wild_corn'];
const B = BIOME_ID;

export class World {
  constructor(gen) {
    Object.assign(this, gen);
    const N = this.W * this.H;
    this.FR = FR;
    this.CW = Math.ceil(this.W / CHUNK);
    this.CH = Math.ceil(this.H / CHUNK);
    this.chunks = [];
    for (let i = 0; i < this.CW * this.CH; i++) this.chunks.push({ objects: [], decor: [] });
    this.objById = new Map();
    for (const o of this.objects) this._insert(o);
    for (const d of this.decor) this.chunkAt(d.x, d.y).decor.push(d);
    for (const c of this.chunks) c.pop = popCount(c.objects);
    if (!this.roof) this.roof = new Uint8Array(N);
    if (!this.tramp) this.tramp = new Uint8Array(N);
    this.rock0 = this.rock.slice();               // rock before any mining
    this.camps = (this.zones || []).filter((z) => z.type === 'bandit_camp');
    this.solid = new Uint8Array(N); // buildings/walls occupancy
    this.tileData = new Uint8Array(N * 4);
    this.field2 = new Uint8Array(N * 4);
    this.field = new Uint8Array(this.W * FR * this.H * FR * 4);
    this.caveData = new Uint8Array(N * 4);
    this._buildTileData(0, 0, this.W - 1, this.H - 1);
    this._buildFields(0, 0, this.W - 1, this.H - 1);
    this._buildCave(0, 0, this.W - 1, this.H - 1);
    this.rubble = new Uint8Array(N);              // rough stone floor tiles that show loose rubble
    this._buildDecals(0, 0, this.W - 1, this.H - 1);
    this.dirty = null; // tile rect needing GPU re-upload
  }

  idx(x, y) { return y * this.W + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  chunkAt(x, y) {
    const cx = clamp(Math.floor(x / CHUNK), 0, this.CW - 1), cy = clamp(Math.floor(y / CHUNK), 0, this.CH - 1);
    return this.chunks[cy * this.CW + cx];
  }

  _insert(o) {
    this.chunkAt(o.x, o.y).objects.push(o);
    this.objById.set(o.id, o);
  }

  addObject(o) {
    o.id ||= Math.floor(Math.random() * 1e9);
    this._insert(o);
    // keep chunk list y-sorted lazily
    this.chunkAt(o.x, o.y).sorted = false;
    return o;
  }

  removeObject(o) {
    const c = this.chunkAt(o.x, o.y);
    const k = c.objects.indexOf(o);
    if (k >= 0) c.objects.splice(k, 1);
    this.objById.delete(o.id);
  }

  // iterate chunks overlapping a world rect
  forChunks(x0, y0, x1, y1, fn) {
    const cx0 = clamp(Math.floor(x0 / CHUNK), 0, this.CW - 1), cx1 = clamp(Math.floor(x1 / CHUNK), 0, this.CW - 1);
    const cy0 = clamp(Math.floor(y0 / CHUNK), 0, this.CH - 1), cy1 = clamp(Math.floor(y1 / CHUNK), 0, this.CH - 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(this.chunks[cy * this.CW + cx]);
  }

  // objects within radius
  query(x, y, r, filter) {
    const out = [];
    this.forChunks(x - r, y - r, x + r, y + r, (c) => {
      for (const o of c.objects) {
        const dx = o.x - x, dy = o.y - y;
        if (dx * dx + dy * dy <= r * r && (!filter || filter(o))) out.push(o);
      }
    });
    return out;
  }

  // ---------- tiles ----------
  isRock(tx, ty) { return !this.inBounds(tx, ty) || this.rock[this.idx(tx, ty)] === 1; }
  waterAt(tx, ty) { return this.inBounds(tx, ty) ? this.water[this.idx(tx, ty)] : 0; }
  blocked(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = this.idx(tx, ty);
    return this.rock[i] === 1 || this.water[i] === 2 || this.solid[i] === 1;
  }
  groundAt(tx, ty) { return this.inBounds(tx, ty) ? this.ground[this.idx(tx, ty)] : G.STONE; }

  // movement speed multiplier at a world point
  speedAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (this.waterAt(tx, ty) === 1) return 0.55;
    const g = this.groundAt(tx, ty);
    if (g === G.MARSH) return 0.7;
    if (g === G.MUD) return 0.8;
    return 1;
  }

  // Remove a rock wall tile (mining). Returns true if changed.
  mineRock(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    if (!this.rock[i]) return false;
    this.rock[i] = 0;
    this.ore[i] = 0;
    this.ground[i] = G.STONE;
    this._buildTileData(tx - 1, ty - 1, tx + 1, ty + 1);
    this._buildFields(tx - 6, ty - 6, tx + 6, ty + 6);
    this._buildCave(tx - 2, ty - 2, tx + 2, ty + 2);
    this._buildDecals(tx - 2, ty - 2, tx + 2, ty + 2);
    this._markDirty(tx - 6, ty - 6, tx + 6, ty + 6);
    return true;
  }

  // rubble tiles in the rect (+1), then the decal lists of every chunk overlapping it
  _buildDecals(x0, y0, x1, y1) {
    const W = this.W, H = this.H, K = this.rock, K0 = this.rock0, Gd = this.ground, RB = this.rubble, D = this.caveData;
    const rx0 = Math.max(0, x0 - 1), ry0 = Math.max(0, y0 - 1), rx1 = Math.min(W - 1, x1 + 1), ry1 = Math.min(H - 1, y1 + 1);
    for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) {
      const i = y * W + x;
      let r = 0;
      if (!K[i] && Gd[i] === G.STONE) {
        if (K0[i]) r = 1; // mined floor
        else for (let dy = -1; dy <= 1 && !r; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && K[yy * W + xx]) { r = 1; break; }
        }
      }
      RB[i] = r;
    }
    const cx0 = Math.max(0, Math.floor(rx0 / CHUNK) - 0), cx1 = Math.min(this.CW - 1, Math.floor(rx1 / CHUNK));
    const cy0 = Math.max(0, Math.floor(ry0 / CHUNK) - 0), cy1 = Math.min(this.CH - 1, Math.floor(ry1 / CHUNK));
    const list = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      list.length = 0;
      const tx0 = cx * CHUNK, ty0 = cy * CHUNK, tx1 = Math.min(W, tx0 + CHUNK), ty1 = Math.min(H, ty0 + CHUNK);
      for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) {
        const i = y * W + x;
        if (K[i]) { if (D[i * 4 + 1]) list.push(i * 2); continue; }
        // rubble quads cover the rubble tiles and their neighbours (stones may straddle tile edges)
        let near = RB[i];
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && RB[yy * W + xx]) { near = 1; break; }
        }
        if (near) list.push(i * 2 + 1);
      }
      this.chunks[cy * this.CW + cx].decals = Int32Array.from(list);
    }
  }

  // ---------- mountain roofs & caves ----------
  // 1 where the original rock was thick (≥ 2 tiles deep). Unchanged by mining. Out of bounds = roofed.
  roofAt(tx, ty) { return this.inBounds(tx, ty) ? this.roof[this.idx(tx, ty)] : 1; }
  // mined tile under a mountain roof (dark cave floor)
  isCave(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    return this.roof[i] === 1 && this.rock[i] === 0;
  }
  // smooth cave darkness 0..1 at a world point (same field the shaders use)
  caveDark(x, y) {
    const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
    const W = this.W, H = this.H, D = this.caveData;
    const s = (xx, yy) => D[(clamp(yy, 0, H - 1) * W + clamp(xx, 0, W - 1)) * 4];
    const a = s(x0, y0) + (s(x0 + 1, y0) - s(x0, y0)) * u, b = s(x0, y0 + 1) + (s(x0 + 1, y0 + 1) - s(x0, y0 + 1)) * u;
    return (a + (b - a) * v) / 255;
  }
  // tile was rock originally and has been dug out
  isMined(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    return this.rock0[i] === 1 && this.rock[i] === 0;
  }

  _buildCave(x0, y0, x1, y1) {
    const W = this.W, H = this.H, R = this.roof, K = this.rock, K0 = this.rock0, T = this.tramp, D = this.caveData, O = this.ore;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    const cav = (x, y) => x >= 0 && y >= 0 && x < W && y < H && R[y * W + x] === 1 && K[y * W + x] === 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, o = i * 4;
      let v = 0;
      if (cav(x, y)) v = 1;
      else {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && cav(x + dx, y + dy)) m = Math.max(m, dx && dy ? 0.55 : 1);
        }
        // darkness spills onto the rock around the tunnels; the cave mouth fades to daylight
        v = m * (K[i] ? 0.7 : 0.42);
      }
      D[o] = Math.round(v * 255);
      let ore = 0;
      for (let dy = -1; dy <= 1 && !ore; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && O[yy * W + xx]) { ore = 255; break; }
      }
      D[o + 1] = ore;
      D[o + 2] = T[i];
      D[o + 3] = K0[i] && !K[i] ? 255 : 0;
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
    if (this.rock0[i] || this.water[i] || this.solid[i] || this.roof[i]) return 0;
    if (this.tramp[i] > 40) return 0;
    for (const c of this.camps) if ((tx + 0.5 - c.x) ** 2 + (ty + 0.5 - c.y) ** 2 < (c.r || CAMP_R) ** 2) return 0;
    const b = this.biome[i], g = this.ground[i], dw = this.dWater ? this.dWater[i] : 9, dr = this.dRock ? this.dRock[i] : 9;
    const L = this.lush ? this.lush[i] : 0.5;
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

  // ---------- GPU data ----------
  _buildTileData(x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.W - 1, x1); y1 = Math.min(this.H - 1, y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, y), o = i * 4;
      this.tileData[o] = this.ground[i];
      this.tileData[o + 1] = (x * 73 + y * 151) & 255;
      this.tileData[o + 2] = this.rockType[i];
      this.tileData[o + 3] = this.ore[i];
      this.field2[o] = clamp(this.lush[i] * 255, 0, 255);
      this.field2[o + 1] = clamp(128 + this.flowX[i] * 127, 0, 255);
      this.field2[o + 2] = clamp(128 + this.flowY[i] * 127, 0, 255);
      this.field2[o + 3] = 0;
    }
  }

  // biome name at a world point (see worldgen BIOMES)
  biomeAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inBounds(tx, ty) || !this.biome) return 'mountain';
    return BIOMES[this.biome[this.idx(tx, ty)]];
  }

  // Compute smooth fields at FR x resolution for tile rect (with margin), write back the rect.
  _buildFields(x0, y0, x1, y1) {
    const W = this.W, H = this.H, M = 6;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    const wx0 = Math.max(0, x0 - M), wy0 = Math.max(0, y0 - M), wx1 = Math.min(W - 1, x1 + M), wy1 = Math.min(H - 1, y1 + M);
    const tw = wx1 - wx0 + 1, th = wy1 - wy0 + 1;
    // tile-level helpers inside window
    const dIn = new Float32Array(tw * th);   // depth inside rock (tiles)
    const dW = new Float32Array(tw * th);    // distance to water (tiles)
    const dOut = new Float32Array(tw * th);  // distance to rock from outside (tiles)
    {
      // simple chamfer within window
      const INF = 99;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const i = this.idx(wx0 + x, wy0 + y);
        dIn[y * tw + x] = this.rock[i] ? INF : 0;
        dW[y * tw + x] = this.water[i] ? 0 : INF;
        dOut[y * tw + x] = this.rock[i] ? 0 : INF;
      }
      const pass = (a) => {
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
          const i = y * tw + x; let v = a[i];
          if (x > 0) v = Math.min(v, a[i - 1] + 1);
          if (y > 0) { v = Math.min(v, a[i - tw] + 1); if (x > 0) v = Math.min(v, a[i - tw - 1] + 1.414); if (x < tw - 1) v = Math.min(v, a[i - tw + 1] + 1.414); }
          a[i] = v;
        }
        for (let y = th - 1; y >= 0; y--) for (let x = tw - 1; x >= 0; x--) {
          const i = y * tw + x; let v = a[i];
          if (x < tw - 1) v = Math.min(v, a[i + 1] + 1);
          if (y < th - 1) { v = Math.min(v, a[i + tw] + 1); if (x < tw - 1) v = Math.min(v, a[i + tw + 1] + 1.414); if (x > 0) v = Math.min(v, a[i + tw - 1] + 1.414); }
          a[i] = v;
        }
      };
      pass(dIn); pass(dW); pass(dOut);
    }
    // rock proximity (1x, field2.A): 0 at rock .. 1 at >= 4 tiles
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const v = dOut[(ty - wy0) * tw + (tx - wx0)];
      this.field2[this.idx(tx, ty) * 4 + 3] = clamp(Math.round((v / 4) * 255), 0, 255);
    }
    const sw = tw * FR, sh = th * FR, S = sw * sh;
    const rockM = new Float32Array(S), height = new Float32Array(S), wat = new Float32Array(S), wet = new Float32Array(S);
    const hTile = new Float32Array(tw * th), wetTile = new Float32Array(tw * th);
    for (let i = 0; i < tw * th; i++) {
      // massif height: rises over ~7 tiles inside the rock (ridges along the medial axis)
      const d = Math.max(0, dIn[i] - 0.5);
      hTile[i] = clamp(1 - Math.exp(-d / 3.2), 0, 1);
      wetTile[i] = dW[i] === 0 ? 1 : clamp(1 - (dW[i] - 1) / 2.5, 0, 1);
    }
    // per sub-sample column/row bilinear setup (tile centers at k + 0.5)
    const cx0 = new Int32Array(sw), cx1 = new Int32Array(sw), cux = new Float32Array(sw);
    for (let sx = 0; sx < sw; sx++) {
      const fx = (sx + 0.5) / FR - 0.5, ix = Math.floor(fx);
      cx0[sx] = clamp(ix, 0, tw - 1); cx1[sx] = clamp(ix + 1, 0, tw - 1); cux[sx] = fx - ix;
    }
    for (let sy = 0; sy < sh; sy++) {
      const fy = (sy + 0.5) / FR - 0.5, iy = Math.floor(fy), uy = fy - iy;
      const r0 = clamp(iy, 0, th - 1) * tw, r1 = clamp(iy + 1, 0, th - 1) * tw;
      const ty = (sy / FR) | 0, trow = (wy0 + ty) * W + wx0, srow = sy * sw;
      for (let sx = 0; sx < sw; sx++) {
        const ti = trow + ((sx / FR) | 0), s = srow + sx;
        rockM[s] = this.rock[ti];
        const wv = this.water[ti];
        wat[s] = wv === 2 ? 1 : wv === 1 ? 0.55 : 0;
        const a0 = cx0[sx], a1 = cx1[sx], ux = cux[sx];
        const ha = hTile[r0 + a0] + (hTile[r0 + a1] - hTile[r0 + a0]) * ux;
        const hb = hTile[r1 + a0] + (hTile[r1 + a1] - hTile[r1 + a0]) * ux;
        height[s] = ha + (hb - ha) * uy;
        const ea = wetTile[r0 + a0] + (wetTile[r0 + a1] - wetTile[r0 + a0]) * ux;
        const eb = wetTile[r1 + a0] + (wetTile[r1 + a1] - wetTile[r1 + a0]) * ux;
        wet[s] = ea + (eb - ea) * uy;
      }
    }
    const r1 = boxBlur(boxBlur(rockM, sw, sh, 2), sw, sh, 2);
    const h1 = boxBlur(height, sw, sh, 3);
    const w1 = boxBlur(boxBlur(wat, sw, sh, 3), sw, sh, 3);
    const e1 = boxBlur(wet, sw, sh, 2);
    // write back only the requested rect
    const FW = W * FR, F = this.field;
    for (let ty = y0; ty <= y1; ty++) for (let ky = 0; ky < FR; ky++) {
      const sy = (ty - wy0) * FR + ky;
      for (let tx = x0; tx <= x1; tx++) for (let kx = 0; kx < FR; kx++) {
        const s = sy * sw + (tx - wx0) * FR + kx;
        const o = ((ty * FR + ky) * FW + (tx * FR + kx)) * 4;
        F[o] = r1[s] * 255; F[o + 1] = h1[s] * 255; F[o + 2] = w1[s] * 255; F[o + 3] = e1[s] * 255;
      }
    }
  }
}

// initial population of a chunk per natural kind
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
