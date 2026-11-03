// Terrain height on the planet-scale store (docs/STREAMING.md "Alturas", docs/TERRAIN-HEIGHT.md): the same surface and
// accessors as world/height.js HeightLayer, paged by chunk instead of world-sized arrays.
//
// Corners: corner (x, y) = the north-west corner of tile (x, y), index w.idx(x, y) (x wraps; the south-pole row y = H is
// not stored). Three chunk-backed corner layers of the World: `base` (the source's generated terrain: hBase), `t` (with
// the players' edits: hT) and `c` (the surface = max(t, plot): hC), plus a sparse `plot` layer (building bases, −∞ =
// none). Edits are also kept as a map corner → height (diff() / applyDiff(): the snapshot / save / stream diff); a
// chunk with an edit is changed (never evicted).
// Fine surface (SUB × SUB samples per tile), slopes and cliff flags: per chunk ("fine page"), from the corners of the
// chunk + 3 around, with the same spline, clamp and crag rules as HeightLayer (a pure function of the corners: every
// peer gets the same values, whatever order it loaded chunks in). Usually computed by the terrain window's worker
// together with the chunk's GPU contents (terrainWindow.js: computeFine + fineTex, ~8 ms a chunk), else on the main
// thread when first needed (heightAt, isCliff away from the camera). A page is `complete` when its 8 neighbour chunks
// were loaded: a neighbour arriving later drops only incomplete pages (their margins read it as 0); an edit within reach
// drops any. A chunk whose corners (and margin) are all zero is flat: nothing is allocated.

import { SUB, WALK_MAX, triH } from './height.js';
import { Layer, PW, PH, XM, PWS, CS, CW, CH, CT, NCH } from './store.js';

const FS = CS * SUB;            // fine samples per chunk side (256)
const FM = PW * SUB - 1;        // fine x mask (the planet wraps)
const M = 3;                    // corner margin read around a chunk (the spline reaches 2 corners, the crags 1 sample)
const NC = CS + 2 * M + 1;      // corners per side of that window
const EW = FS + 3;              // fine page row: samples −1 .. FS + 1 (the chunk's (FS + 1)² and a ring around it)
const FLAT = { flat: true, max: 0, complete: true };

const CR = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3); };
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function slope2(a, b, c, d) {
  let x1, y1, x2, y2;
  if (Math.abs(a - d) <= Math.abs(b - c)) { x1 = b - a; y1 = d - b; x2 = d - c; y2 = c - a; } else { x1 = b - a; y1 = c - a; x2 = d - c; y2 = d - b; }
  return Math.max(x1 * x1 + y1 * y1, x2 * x2 + y2 * y2);
}

export class PagedHeight {
  constructor(w) {
    this.w = w;
    this.W = PW; this.H = PH;
    this.FW = PW * SUB + 1; this.FH = PH * SUB + 1;
    this.base = w.hBase; this.t = w.hT; this.c = w.hC;
    this.plot = new Layer('plot', Float32Array, -Infinity, { sparse: true });
    this.edits = new Map();        // corner → terrain height (≠ base)
    this.plots = new Map();        // corner → building base
    this.fine = new Array(NCH).fill(null);
    this.fineGen = new Uint32Array(NCH);  // bumped when a chunk's corners (or its margin) change
    this.cmax = new Float32Array(NCH); // highest corner per loaded chunk
    this.any = false; this.max = 0; this.v = 0; this.dirty = null;
    this.stats = { fine: 0, fineMs: 0, fineW: 0 };
    w.onLoad.push((c) => this._loaded(c));
    w.onEvict.push((c) => { this.fine[c] = null; this.cmax[c] = 0; });
    for (const c of w.live) this._loaded(c);
  }

  // ---------- chunks ----------
  _loaded(c) {
    const X0 = (c & (CW - 1)) * CS, Y0 = (c >>> 8) * CS;
    // the players' edits and the building bases of this chunk (a chunk reloaded / loaded after a snapshot)
    for (const [i, h] of this.edits) if (this._chunkOf(i) === c) this.t.set(i, h);
    for (const [i, h] of this.plots) if (this._chunkOf(i) === c) this.plot.set(i, h);
    const Cp = this.c.pages[c], Tp = this.t.pages[c], Pp = this.plot.pages[c];
    let mx = 0, any = false;
    for (let l = 0; l < CT; l++) { let v = Tp[l]; if (Pp && Pp[l] > v) v = Pp[l]; Cp[l] = v; if (v !== 0) any = true; if (v > mx) mx = v; }
    this.cmax[c] = mx;
    if (any) this.any = true;
    if (mx > this.max) this.max = mx;
    // (the GPU window recomputes this slot and its neighbours' itself: TerrainWindow.chunkChanged)
    this._touch(X0 - 3, Y0 - 3, X0 + CS + 2, Y0 + CS + 2, false);
  }
  _chunkOf(i) { return ((i >>> 20) << 8) | ((i & XM) >>> 6); }
  // corners changed in a tile rect: the fine pages within reach are dropped (edit: all; a chunk arriving: the incomplete
  // ones), the GPU re-uploads the rect (edits)
  _touch(x0, y0, x1, y1, edit = true) {
    this.v++;
    if (edit) {
      const d = this.dirty;
      if (!d) this.dirty = [x0, y0, x1, y1];
      else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
    }
    for (let cy = Math.max(0, Math.floor((y0 - M) / CS)); cy <= Math.min(PH / CS - 1, Math.floor((y1 + M) / CS)); cy++)
      for (let cx = Math.floor((x0 - M) / CS); cx <= Math.floor((x1 + M) / CS); cx++) {
        const k = cy * CW + (((cx % CW) + CW) % CW), F = this.fine[k];
        if (edit || !F || !F.complete) { this.fine[k] = null; this.fineGen[k]++; }
      }
  }
  // the 8 neighbours of chunk c that its margin reads are loaded (outside the planet / a bounded world: nothing to read)
  complete(c) {
    const w = this.w, cx = c & (CW - 1), cy = c >>> 8;
    for (let dy = -1; dy <= 1; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= CH) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = (cx + dx) & (CW - 1), n = y * CW + x;
        if (!w.wrap && (x * CS + CS <= w.bx0 || x * CS > w.bx1 || y * CS + CS <= w.by0 || y * CS > w.by1)) continue;
        if (!w.isLoaded(n)) return false;
      }
    }
    return true;
  }

  // a corner (any x, y clamped to the planet; a bounded world reads its edge beyond the bounds)
  _cc(ix, iy) {
    const w = this.w;
    if (!w.wrap) { ix = ix < w.bx0 ? w.bx0 : ix > w.bx1 ? w.bx1 : ix; iy = iy < w.by0 ? w.by0 : iy > w.by1 ? w.by1 : iy; }
    iy = iy < 0 ? 0 : iy > PH - 1 ? PH - 1 : iy;
    return this.c.get((iy << PWS) | (ix & XM));
  }

  // the corner window a chunk's fine page reads (NC × NC from (X0 − M, Y0 − M)); null when it is all zero (flat).
  // A neighbour not loaded yet: its corners are the chunk's own edge extended (provisional — the page is incomplete and
  // dropped when the neighbour arrives; never a fake cliff at the edge of the loaded area)
  cornerWindow(c) {
    const w = this.w, X0 = (c & (CW - 1)) * CS, Y0 = (c >>> 8) * CS, C = new Float32Array(NC * NC);
    const cx = c & (CW - 1), cy = c >>> 8, has = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = cy + dy;
      has.push(!dx && !dy || y < 0 || y >= CH || !w.wrap || w.isLoaded(y * CW + ((cx + dx) & (CW - 1))));
    }
    let nz = false;
    for (let y = 0; y < NC; y++) for (let x = 0; x < NC; x++) {
      let X = X0 - M + x, Y = Y0 - M + y;
      const sx = X < X0 ? 0 : X >= X0 + CS ? 2 : 1, sy = Y < Y0 ? 0 : Y >= Y0 + CS ? 2 : 1;
      if (!has[sy * 3 + sx]) { X = X < X0 ? X0 : X > X0 + CS - 1 ? X0 + CS - 1 : X; Y = Y < Y0 ? Y0 : Y > Y0 + CS - 1 ? Y0 + CS - 1 : Y; }
      const v = this._cc(X, Y);
      C[y * NC + x] = v; if (v !== 0) nz = true;
    }
    return nz ? C : null;
  }
  // the fine page of chunk c (computed now when missing; the terrain window's worker usually made it already)
  page(c) { return this.fine[c] || this._fine(c); }
  _fine(c) {
    const t0 = performance.now();
    const complete = this.complete(c), C = this.cornerWindow(c);
    const F = C ? computeFine(C, (c & (CW - 1)) * CS, (c >>> 8) * CS) : { ...FLAT };
    F.complete = complete;
    this.stats.fine++; this.stats.fineMs += performance.now() - t0;
    return (this.fine[c] = F);
  }
  // a fine page computed elsewhere (terrain window worker) from the corners of generation `gen` (null: flat)
  setFine(c, gen, F, complete) {
    if (this.fine[c] || this.fineGen[c] !== gen || !this.w.isLoaded(c)) return;
    this.fine[c] = F ? { flat: false, f: F.f, slope: F.slope, cliff: F.cliff, max: F.max, complete } : { ...FLAT, complete };
    this.stats.fineW++;
  }
  // a fine sample of the planet (global fine indices; i wraps, j clamped)
  fs(i, j) {
    j = j < 0 ? 0 : j > PH * SUB - 1 ? PH * SUB - 1 : j;
    i &= FM;
    const c = ((j >> 8) << 8) | (i >> 8), F = this.fine[c] || this._fine(c);
    return F.flat ? 0 : F.f[((j & 255) + 1) * EW + (i & 255) + 1];
  }

  // ---------- reads (the HeightLayer API) ----------
  cornerH(ix, iy) { return this._cc(ix | 0, iy | 0); }
  terrainH(ix, iy) { iy = Math.max(0, Math.min(PH - 1, iy | 0)); return this.t.get((iy << PWS) | ((ix | 0) & XM)); }
  plotH(ix, iy) { iy = Math.max(0, Math.min(PH - 1, iy | 0)); return this.plot.get((iy << PWS) | ((ix | 0) & XM)); }
  heightAt(x, y) {
    if (!this.any) return 0;
    const u = x * SUB, v = y * SUB, i = Math.floor(u), j = Math.floor(v);
    return triH(this.fs(i, j), this.fs(i + 1, j), this.fs(i, j + 1), this.fs(i + 1, j + 1), u - i, v - j);
  }
  gradAt(x, y, out = [0, 0]) {
    out[0] = out[1] = 0;
    if (!this.any) return out;
    const u = x * SUB, v = y * SUB, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const a = this.fs(i, j), b = this.fs(i + 1, j), c = this.fs(i, j + 1), d = this.fs(i + 1, j + 1);
    if (Math.abs(a - d) <= Math.abs(b - c)) { if (fx >= fy) { out[0] = b - a; out[1] = d - b; } else { out[0] = d - c; out[1] = c - a; } }
    else if (fx + fy <= 1) { out[0] = b - a; out[1] = c - a; } else { out[0] = d - c; out[1] = d - b; }
    out[0] *= SUB; out[1] *= SUB;
    return out;
  }
  _tile(tx, ty) {
    if (!this.any || ty < 0 || ty >= PH) return null;
    const c = ((ty >> 6) << 8) | ((tx & XM) >> 6), F = this.fine[c] || this._fine(c);
    return F.flat ? null : F;
  }
  tileSlope(tx, ty) { const F = this._tile(tx, ty); return F ? F.slope[(ty & 63) * CS + (tx & 63)] : 0; }
  isCliff(tx, ty) { const F = this._tile(tx, ty); return !!F && F.cliff[(ty & 63) * CS + (tx & 63)] === 1; }
  tileMin(tx, ty) { return Math.min(this._cc(tx, ty), this._cc(tx + 1, ty), this._cc(tx, ty + 1), this._cc(tx + 1, ty + 1)); }
  tileMax(tx, ty) { return Math.max(this._cc(tx, ty), this._cc(tx + 1, ty), this._cc(tx, ty + 1), this._cc(tx + 1, ty + 1)); }
  // highest ground inside a world rect (coarse: whole chunks)
  maxIn(x0, y0, x1, y1) {
    if (!this.any) return 0;
    let m = 0;
    for (let cy = Math.max(0, Math.floor(y0 / CS)); cy <= Math.min(PH / CS - 1, Math.floor(y1 / CS)); cy++)
      for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) { const v = this.cmax[cy * CW + (((cx % CW) + CW) % CW)]; if (v > m) m = v; }
    return m;
  }
  cliffBetween(ax, ay, bx, by) {
    if (!this.any) return false;
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 0.25));
    let h0 = this.heightAt(ax, ay);
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (this.isCliff(Math.floor(x), Math.floor(y))) return true;
      const h = this.heightAt(x, y);
      if (Math.abs(h - h0) > WALK_MAX * (d / n) + 1e-4) return true;
      h0 = h;
    }
    return false;
  }

  // ---------- writes (deterministic on every peer: mut/terrain.js ops, game/terrain.js plots, mining) ----------
  // terrain corners [[cornerIdx, h], …]
  setTerrain(list) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (const [i, h] of list) {
      if (!(i >= 0 && i < PW * PH) || !Number.isFinite(h)) continue;
      this.t.set(i, h);
      if (h !== this.base.get(i)) this.edits.set(i, h); else this.edits.delete(i);
      const p = this.plot.get(i), v = h > p ? h : p;
      this.c.set(i, v);
      this.w.markDirty(i);
      const x = i & XM, y = i >>> PWS, c = this._chunkOf(i);
      if (v > this.cmax[c]) this.cmax[c] = v;
      if (v > this.max) this.max = v;
      if (v !== 0) this.any = true;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++;
    }
    if (n) this._touch(x0 - 2, y0 - 2, x1 + 1, y1 + 1);
    return n > 0;
  }
  // the edits as a diff of the generated terrain: [cornerIdx, h × 100, …] (snapshot / save)
  diff() {
    const out = [];
    for (const i of [...this.edits.keys()].sort((a, b) => a - b)) out.push(i, Math.round(this.edits.get(i) * 100));
    return out;
  }
  applyDiff(d, full = true) {
    const list = [];
    if (full) for (const i of this.edits.keys()) list.push([i, this.base.get(i)]);
    if (Array.isArray(d)) for (let k = 0; k + 1 < d.length; k += 2) if (Number.isInteger(d[k]) && Number.isFinite(d[k + 1])) list.push([d[k], d[k + 1] / 100]);
    return this.setTerrain(list);
  }
  // building bases per corner (Map cornerIdx → base height): only the corners that changed are rebuilt
  setPlots(map) {
    const list = [];
    for (const [i] of this.plots) if (!map.has(i)) { this.plots.delete(i); this.plot.set(i, -Infinity); list.push([i, this.t.get(i)]); }
    for (const [i, v] of map) if (this.plots.get(i) !== v) { this.plots.set(i, v); this.plot.set(i, v); list.push([i, this.t.get(i)]); }
    if (!list.length) return false;
    // (setTerrain recomputes the surface c = max(t, plot); the terrain itself does not change)
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [i, h] of list) {
      const p = this.plot.get(i), v = h > p ? h : p;
      this.c.set(i, v);
      const c = this._chunkOf(i);
      if (v > this.cmax[c]) this.cmax[c] = v;
      if (v > this.max) this.max = v;
      if (v !== 0) this.any = true;
      const x = i & XM, y = i >>> PWS;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    this._touch(x0 - 2, y0 - 2, x1 + 1, y1 + 1);
    return true;
  }
  // corner index of (ix, iy) — the callers' `iy * (W + 1) + ix` of world/height.js
  ci(ix, iy) { return (Math.max(0, Math.min(PH - 1, iy)) << PWS) | (ix & XM); }
  bytes() { let b = 0; for (const F of this.fine) if (F && !F.flat) b += F.f.byteLength + F.slope.byteLength + F.cliff.byteLength; return b + this.plot.bytes(); }
}

// The fine page of a chunk from its corner window C (NC × NC from (X0 − M, Y0 − M)): the surface on samples −1 .. FS + 1
// (EW² floats: the chunk's own (FS + 1)², its east / south edge included, and a ring so its edge gradients need no
// neighbour page), slopes and cliff flags per tile. Pure (terrainWorker.js runs it too). The row splines are evaluated
// once per sample (the same numbers as HeightLayer._spline).
export function computeFine(C, X0, Y0) {
  const cc = (tx, ty) => C[(ty + M) * NC + tx + M];
  const TW = FS + 5, T = new Float32Array(TW * TW); // spline samples −2 .. FS + 2 (the crags read one more around)
  const r = new Float64Array(4);
  for (let j = -2; j <= FS + 2; j++) {
    const ty = Math.floor(j / SUB), v = j / SUB - ty, ey = v === 0;
    for (let i = -2; i <= FS + 2; i++) {
      const tx = Math.floor(i / SUB), u = i / SUB - tx, ex = u === 0;
      let h;
      if (ex && ey) h = cc(tx, ty);
      else {
        for (let k = -1; k <= 2; k++) r[k + 1] = CR(cc(tx - 1, ty + k), cc(tx, ty + k), cc(tx + 1, ty + k), cc(tx + 2, ty + k), u);
        h = CR(r[0], r[1], r[2], r[3], v);
        const a = cc(tx, ty), b = cc(tx + 1, ty), c = cc(tx, ty + 1), e = cc(tx + 1, ty + 1);
        let lo, hi;
        if (ey) { lo = Math.min(a, b); hi = Math.max(a, b); }
        else if (ex) { lo = Math.min(a, c); hi = Math.max(a, c); }
        else { lo = Math.min(a, b, c, e); hi = Math.max(a, b, c, e); }
        const mg = (hi - lo) * 0.45;
        lo = lo >= 0 ? Math.max(0, lo - mg) : lo - mg; hi += mg;
        h = h < lo ? lo : h > hi ? hi : h;
      }
      T[(j + 2) * TW + i + 2] = h;
    }
  }
  const f = new Float32Array(EW * EW);
  const gi0 = X0 * SUB, gj0 = Y0 * SUB;
  let mx = 0;
  for (let j = -1; j <= FS + 1; j++) for (let i = -1; i <= FS + 1; i++) {
    const k = (j + 2) * TW + i + 2;
    let h = T[k];
    const gx = (T[k + 1] - T[k - 1]) * SUB / 2, gy = (T[k + TW] - T[k - TW]) * SUB / 2, st = Math.sqrt(gx * gx + gy * gy);
    if (st > 1.1) {
      const dx = gx / st, dy = gy / st, gi = gi0 + i, gj = gj0 + j, a = gi * dx + gj * dy, b = -gi * dy + gj * dx;
      const nzv = (vnoise(a * 0.05, b * 0.3) - 0.5) + (vnoise(a * 0.14 + 17, b * 0.62) - 0.5) * 0.18;
      const q = h + nzv * 0.5 * Math.min(1, (st - 1.1) / 2.2);
      h = h >= 0 ? Math.max(0, q) : q;
    }
    f[(j + 1) * EW + i + 1] = h;
    if (h > mx && i >= 0 && j >= 0 && i <= FS && j <= FS) mx = h;
  }
  const slope = new Float32Array(CT), cliff = new Uint8Array(CT);
  for (let ty = 0; ty < CS; ty++) for (let tx = 0; tx < CS; tx++) {
    let m = 0;
    for (let j = ty * SUB; j < ty * SUB + SUB; j++) for (let i = tx * SUB; i < tx * SUB + SUB; i++) {
      const o = (j + 1) * EW + i + 1, g = slope2(f[o], f[o + 1], f[o + EW], f[o + EW + 1]);
      if (g > m) m = g;
    }
    const sl = Math.sqrt(m) * SUB, k = ty * CS + tx;
    slope[k] = sl; cliff[k] = sl > WALK_MAX ? 1 : 0;
  }
  return { flat: false, f, slope, cliff, max: mx };
}

// The GPU contents of a whole chunk from its fine page (renderer channels 'hgt' / 'hgtG', terrainWindow.js): hgt FS² floats
// (the surface), hgtG FS² × 4 half floats (gradient x, y in stories per tile, height). A flat page leaves them zero.
export function fineTex(F, hgt, hgtG) {
  if (!F || F.flat) return;
  const f = F.f, k = SUB / 2;
  for (let j = 0; j < FS; j++) for (let i = 0; i < FS; i++) {
    const o = (j + 1) * EW + i + 1, h = f[o], q = j * FS + i;
    if (hgt) hgt[q] = h;
    if (hgtG) { hgtG[q * 4] = toHalf((f[o + 1] - f[o - 1]) * k); hgtG[q * 4 + 1] = toHalf((f[o + EW] - f[o - EW]) * k); hgtG[q * 4 + 2] = toHalf(h); }
  }
}

// float → half float bits (the gradient texture)
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
export function toHalf(v) {
  _f32[0] = v; const x = _u32[0], sg = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sg; if (e >= 31) return sg | 0x7bff;
  return sg | (e << 10) | ((x >>> 13) & 0x3ff);
}
