// Runtime world: tile queries, collision, chunked object lists, GPU field textures.

import { boxBlur, clamp } from '../engine/noise.js';
import { G, BIOMES } from './worldgen.js';

export const CHUNK = 16;
export const FR = 4; // field texture resolution per tile

export class World {
  constructor(gen) {
    Object.assign(this, gen);
    this.FR = FR;
    this.CW = Math.ceil(this.W / CHUNK);
    this.CH = Math.ceil(this.H / CHUNK);
    this.chunks = [];
    for (let i = 0; i < this.CW * this.CH; i++) this.chunks.push({ objects: [], decor: [] });
    this.objById = new Map();
    for (const o of this.objects) this._insert(o);
    for (const d of this.decor) this.chunkAt(d.x, d.y).decor.push(d);
    this.solid = new Uint8Array(this.W * this.H); // buildings/walls occupancy
    this.tileData = new Uint8Array(this.W * this.H * 4);
    this.field2 = new Uint8Array(this.W * this.H * 4);
    this.field = new Uint8Array(this.W * FR * this.H * FR * 4);
    this._buildTileData(0, 0, this.W - 1, this.H - 1);
    this._buildFields(0, 0, this.W - 1, this.H - 1);
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
    this._markDirty(tx - 6, ty - 6, tx + 6, ty + 6);
    return true;
  }

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
