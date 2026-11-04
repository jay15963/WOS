// GPU window over the planet (docs/STREAMING.md "Render"): no whole-world textures. Every per-tile texture the shaders
// read (tile ids, fields, caves, climate, roof data, painted paths) is a WIN × WIN tile RING around the camera: world
// tile (x, y) lives in texel (x mod WIN, y mod WIN) and the textures REPEAT, so a shader samples `wp / WIN` and never
// knows where the window is (the seam of the planet, W = 32 × WIN, needs nothing either). As the camera moves, the
// chunks that enter the window are computed from the world layers and uploaded (texSubImage2D): the ones in view at
// once on the main thread, the others in a worker (src/world/terrainWorker.js, nearest first, a few in flight); edits
// re-upload just their rect (main thread: a few hundred tiles).
//
// Textures (name: scale, format) — the same contents as the old world-sized ones:
//   tile   1×, RGBA nearest: R ground id, G random, B rock type, A ore
//   field2 1×, RGBA linear : R lush, GB river flow, A rock proximity (0 at rock .. 1 at ≥ 4 tiles)
//   field  4×, RGBA linear : R rock mask, G rock height, B water depth, A shore wetness
//   cave   1×, RGBA linear : R cave darkness (world.caveDk), G ore nearby, B trampled ground, A mined floor
//   clim   1×, RGBA linear : R snow affinity (cold biomes, blurred ~3 tiles), G structure occupancy (contact AO)
//   + channels other modules register (renderer: 'roof'; paths: 'path' 1× / 'pathCov' 2× RG) with their own fill.

import { createTexture } from '../engine/gl.js';
import { CS, CW, CH, PH, XM, PWS, chunkKey } from './store.js';
import { computeTerrain, MD } from './terrainFill.js';

export const WIN = 512;            // window size in tiles (8 × 8 chunks)
const WC = WIN / CS, WM = WIN - 1;
const COLD = { pine: 0.9, mountain: 1, rocky: 0.45, tundra: 1, taiga: 0.9, snow: 1, glacier: 1, alpine: 1 };
const BIOME_LIST = ['meadow', 'forest', 'pine', 'birch', 'marsh', 'shore', 'rocky', 'water', 'mountain'];
const MAX_JOBS = 3;                // chunks in flight in the worker
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class TerrainWindow {
  constructor(gl, world) {
    this.gl = gl;
    this.w = world;
    const n = WC * WC;
    this.slot = new Int32Array(n).fill(-2);   // chunk key in each ring slot (-2 empty, -1 outside the planet)
    this.ready = new Uint8Array(n);           // the slot's textures hold that chunk
    this.stale = new Uint8Array(n);           // a neighbour arrived / an edit came while it was computed: redo
    this.pend = new Uint32Array(n);           // worker job generation (0 = none)
    this.gen = 0;
    this.warm = 0;                            // < 2 while the first window fills (everything in view at once)
    this.ox = null; this.oy = null;           // window origin (chunk coords, unwrapped)
    this.chan = [];                           // registered textures
    this.tex = {};
    this.dirtyR = [];                         // [names | null, x0, y0, x1, y1] rects to refill
    this.stats = { up: 0, ms: 0, last: 0, pend: 0, async: 0, sync: 0, workerMs: 0 };
    this.coldLut = new Float32Array(256);
    (world.biomeNames || BIOME_LIST).forEach((nm, i) => { this.coldLut[i] = COLD[nm] || 0; });
    // CPU ring copies needed on the CPU (snow affinity: coldAt; solid: the AO diff)
    this.climR = new Uint8Array(WIN * WIN);
    this.solidR = new Uint8Array(WIN * WIN);
    // built-in channels (computed together by terrainFill.js)
    this.add('tile', { scale: 1, comps: 4, filter: gl.NEAREST, terrain: true });
    this.add('field2', { scale: 1, comps: 4, terrain: true });
    this.add('field', { scale: 4, comps: 4, terrain: true });
    this.add('cave', { scale: 1, comps: 4, terrain: true });
    this.add('clim', { scale: 1, comps: 4, terrain: true });
    this.jobs = new Map();
    this.wk = null;
    if (typeof Worker !== 'undefined' && !world.noTerrainWorker) {
      try {
        this.wk = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        this.wk.onmessage = (e) => this._done(e.data);
        this.wk.onerror = () => { this.wk = null; this.jobs.clear(); };
      } catch { this.wk = null; }
    }
  }

  // a ring texture: { scale, comps (4 RGBA / 2 RG / 1 R), filter, fill(x0, y0, w, h, out) for non-terrain channels;
  // float data: ctor (Float32Array / Uint16Array half floats), internal, format, type }
  add(name, def) {
    const gl = this.gl, s = def.scale || 1, n = WIN * s, comps = def.comps || 4;
    const rg = comps === 2;
    const c = { name, scale: s, comps, fill: def.fill || null, terrain: !!def.terrain, format: def.format ?? (rg ? gl.RG : gl.RGBA), type: def.type ?? gl.UNSIGNED_BYTE, ctor: def.ctor || Uint8Array, buf: null, zero: null };
    c.tex = createTexture(gl, { width: n, height: n, data: null, internal: def.internal ?? (rg ? gl.RG8 : gl.RGBA8), format: c.format, type: c.type, filter: def.filter ?? gl.LINEAR, wrap: gl.REPEAT });
    this.chan.push(c);
    this.tex[name] = c.tex;
    if (!c.terrain && this.ox != null) this.dirtyR.push([[name], -1e9, 0, 1e9, PH]); // (a channel added later: fill what is resident)
    return c;
  }

  // tiles changed: refill the rect (inclusive) of the named channels (null = the terrain ones)
  invalidate(x0, y0, x1, y1, names = null) { this.dirtyR.push([names, x0 | 0, y0 | 0, x1 | 0, y1 | 0]); }

  // a chunk was installed: its slot and its neighbours' (their margins read it) are recomputed
  chunkChanged(c) {
    for (let k = 0; k < this.slot.length; k++) {
      const s = this.slot[k];
      if (s < 0) continue;
      const dx = (((s & (CW - 1)) - (c & (CW - 1))) + CW + 1) % CW, dy = (s >>> 8) - (c >>> 8);
      if (dx <= 2 && dy >= -1 && dy <= 1) this.stale[k] = 1;
    }
  }

  // chunk coords of the window around the camera
  range(camX, camY) { return [Math.round(camX / CS) - WC / 2, Math.round(camY / CS) - WC / 2]; }

  // keep the window around the camera. viewR: chunk distance of what is on screen (filled now, synchronously);
  // need(c) loads a chunk synchronously (view) / want(c, d) asks the streamer for it (the rest).
  update(camX, camY, viewR, budgetMs, need, want) {
    const t0 = performance.now();
    const [ox, oy] = this.range(camX, camY);
    this.ox = ox; this.oy = oy;
    const ccx = camX / CS, ccy = camY / CS;
    const todo = this._todo || (this._todo = []);
    todo.length = 0;
    for (let sy = 0; sy < WC; sy++) for (let sx = 0; sx < WC; sx++) {
      const cx = ox + sx, cy = oy + sy, k = (cy & (WC - 1)) * WC + (cx & (WC - 1));
      const key = cy < 0 || cy >= CH ? -1 : chunkKey(cx, cy);
      const d = Math.max(Math.abs(cx + 0.5 - ccx), Math.abs(cy + 0.5 - ccy));
      if (this.slot[k] === key && !this.stale[k]) {
        if (this.ready[k]) continue;
        if (this.pend[k] && (d > viewR || this.warm >= 2)) continue; // (in the worker)
      }
      todo.push(d, cx, cy, key);
    }
    let pend = 0;
    if (todo.length) {
      const n = todo.length / 4, ord = new Array(n);
      for (let j = 0; j < n; j++) ord[j] = j;
      ord.sort((a, b) => todo[a * 4] - todo[b * 4]); // nearest first
      for (const j of ord) {
        const d = todo[j * 4], cx = todo[j * 4 + 1], cy = todo[j * 4 + 2], key = todo[j * 4 + 3];
        const k = (cy & (WC - 1)) * WC + (cx & (WC - 1));
        const inView = d <= viewR;
        if (key >= 0 && !this.w.isLoaded(key)) {
          if (inView) need(key); else { want?.(key, d); pend++; continue; }
          if (!this.w.isLoaded(key)) { pend++; continue; }
        }
        // in view: filled now while the window warms up (boot), for the chunk under the camera, or without a worker;
        // else (a teleport, a chunk that just arrived) the worker first — its slot is cleared meanwhile (plain ground,
        // never the old chunk's texels), a frame or two
        const own = Math.floor(ccx) === cx && Math.floor(ccy) === cy;
        if (inView && (own || !this.wk || this.warm < 2)) { this._fillChunk(k, cx, cy, key); continue; }
        if (this.wk) {
          if (this.jobs.size >= (inView ? MAX_JOBS + 6 : MAX_JOBS)) { pend++; continue; }
          if (inView && this.slot[k] !== key) this._clear(k, cx, cy);
          this._post(k, cx, cy, key);
          continue;
        }
        if (!inView && performance.now() - t0 > budgetMs) { pend++; continue; }
        this._fillChunk(k, cx, cy, key);
      }
    }
    if (!pend && !this.jobs.size && this.warm < 2) this.warm++; // (the first full window: boot / a new world)
    // edits
    if (this.dirtyR.length) {
      const list = this.dirtyR.splice(0);
      for (const [names, x0, y0, x1, y1] of list) this._fillRect(names, x0, y0, x1, y1);
    }
    const ms = performance.now() - t0;
    this.stats.ms += ms; this.stats.last = ms; this.stats.pend = pend + this.jobs.size;
    return pend;
  }

  // ---------- filling ----------
  _fillChunk(k, cx, cy, key) {
    this.slot[k] = key; this.stale[k] = 0; this.pend[k] = 0;
    this._fill(null, cx * CS, cy * CS, CS, CS, true, null);
    this.ready[k] = 1;
    this.stats.up++; this.stats.sync++;
  }
  // a slot about to hold another chunk: zeros (plain ground) until its contents arrive
  _clear(k, cx, cy) {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const c of this.chan) {
      const s = c.scale, Z = c.zero || (c.zero = new c.ctor(CS * CS * s * s * c.comps));
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, ((cx * CS) & WM) * s, ((cy * CS) & WM) * s, CS * s, CS * s, c.format, c.type, Z);
    }
    this.ready[k] = 0;
  }
  // a chunk to the worker: its layers + margin are gathered now (page copies), computed there, uploaded on return.
  // With terrain heights the worker also makes the chunk's fine page (heightPaged.js computeFine: the CPU heights
  // there, ~8 ms) and the 'hgt' / 'hgtG' contents from it.
  _post(k, cx, cy, key) {
    const g = ++this.gen;
    this.slot[k] = key; this.stale[k] = 0; this.pend[k] = g; this.ready[k] = 0;
    const inp = gatherTerrain(this.w, cx * CS, cy * CS, CS, CS, this.coldLut);
    const tr = [...Object.values(inp.u8), ...Object.values(inp.f32)].map((a) => a.buffer);
    const L = this.w.height;
    let hj = null;
    if (L && L.any && this.tex.hgt && key >= 0) {
      const C = L.cornerWindow(key);
      hj = { gen: L.fineGen[key], complete: L.complete(key) };
      inp.hgt = { C, X0: (key & (CW - 1)) * CS, Y0: (key >>> 8) * CS };
      if (C) tr.push(C.buffer);
    }
    this.jobs.set(g, { k, cx, cy, key, hj, t: performance.now() });
    this.wk.postMessage({ id: g, inp }, tr);
  }
  _done(msg) {
    const job = this.jobs.get(msg.id);
    this.jobs.delete(msg.id);
    if (!job) return;
    this.stats.workerMs += performance.now() - job.t;
    if (msg.error) { console.warn('[terrain] worker', msg.error); this.wk = null; return; }
    const { k, cx, cy, key, hj } = job;
    if (hj && 'fine' in msg.out) this.w.height.setFine(key, hj.gen, msg.out.fine, hj.complete); // (kept unless its corners changed)
    if (this.slot[k] !== key || this.pend[k] !== msg.id) return; // (the slot moved on / was redone)
    const t0 = performance.now();
    this._fill(null, cx * CS, cy * CS, CS, CS, true, msg.out);
    const ms = performance.now() - t0; // (main-thread cost of a worker result: the uploads)
    this.stats.doneMax = Math.max(this.stats.doneMax || 0, ms);
    this.pend[k] = 0; this.ready[k] = 1;
    this.stats.up++; this.stats.async++;
  }
  // refill the part of a rect inside the window (chunk by chunk: a chunk never straddles the ring edge)
  _fillRect(names, x0, y0, x1, y1) {
    if (this.ox == null) return;
    for (let sy = 0; sy < WC; sy++) for (let sx = 0; sx < WC; sx++) {
      const cx = this.ox + sx, cy = this.oy + sy, k = (cy & (WC - 1)) * WC + (cx & (WC - 1));
      if (this.slot[k] < 0 || this.slot[k] !== chunkKey(cx, cy)) continue;
      const X0 = cx * CS, Y0 = cy * CS;
      // the rect's x nearest this chunk (the planet wraps)
      let a0 = x0, a1 = x1;
      if (this.w.wrap && a1 - a0 < this.w.W / 2) { const s = this.w.near(a0, X0) - a0; a0 += s; a1 += s; }
      const rx0 = Math.max(X0, a0), rx1 = Math.min(X0 + CS - 1, a1), ry0 = Math.max(Y0, y0), ry1 = Math.min(Y0 + CS - 1, y1);
      if (rx1 < rx0 || ry1 < ry0) continue;
      if (!this.ready[k]) { this.stale[k] = 1; continue; } // (being computed: it is redone with the edit)
      this._fill(names, rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1, false, null);
    }
  }
  // fill + upload a tile rect (inside one chunk): all channels (a new chunk), the terrain ones (names null) or the named.
  // T: the terrain contents already computed (worker) or null (computed here)
  _fill(names, x0, y0, tw, th, all, T) {
    const gl = this.gl;
    const want = (c) => all || (names ? names.includes(c.name) : c.terrain);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const c of this.chan) {
      if (!want(c)) continue;
      let data;
      if (c.terrain) {
        if (!T) T = computeTerrain(gatherTerrain(this.w, x0, y0, tw, th, this.coldLut));
        data = T[c.name];
      } else if (T && T[c.name]) data = T[c.name]; // (made by the worker: heights)
      else {
        if (!c.fill) continue;
        const n = tw * th * c.scale * c.scale * c.comps;
        data = c.buf || (c.buf = new c.ctor(CS * CS * c.scale * c.scale * c.comps));
        data.fill(0, 0, n);
        c.fill(x0, y0, tw, th, data);
      }
      const s = c.scale;
      if (this.post) this.post(c.name, x0, y0, tw, th, data); // (a module's last word on the contents: tunnels shown)
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (x0 & WM) * s, (y0 & WM) * s, tw * s, th * s, c.format, c.type || gl.UNSIGNED_BYTE, data);
    }
    if (T) for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) { // CPU copies (coldAt, the AO diff)
      const r = ((y0 + ty) & WM) * WIN + ((x0 + tx) & WM), j = ty * tw + tx;
      this.climR[r] = T.cold[j]; this.solidR[r] = T.walls[j];
    }
  }

  // contact AO: re-upload clim where world.solid changed inside a tile rect (the visible area, a few times per
  // second). Returns { changed, any } — any: walls in the rect.
  syncSolid(x0, y0, x1, y1) {
    const w = this.w, S = w.solid;
    if (this.ox == null) return { changed: false, any: false };
    y0 = Math.max(0, y0 | 0); y1 = Math.min(PH - 1, y1 | 0); x0 |= 0; x1 |= 0;
    let n = 0, cx0 = 1e9, cy0 = 1e9, cx1 = -1e9, cy1 = -1e9;
    const R = this.solidR;
    for (let y = y0; y <= y1; y++) {
      const row = (y & WM) * WIN;
      for (let x = x0; x <= x1; x++) {
        const v = w.inBounds(x, y) ? S.get((y << PWS) | (x & XM)) : 0;
        if (v) n++;
        const r = row + (x & WM);
        if (v === R[r]) continue;
        if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
      }
    }
    if (cx1 >= cx0) this._fillRect(['clim'], cx0, cy0, cx1, cy1); // (clim is a terrain channel: recomputed + the copy)
    return { changed: cx1 >= cx0, any: n > 0 };
  }

  // snow affinity 0..1 at a world point (CPU copy of clim.R inside the window; the raw biome outside)
  coldAt(x, y) {
    const tx = Math.floor(x), ty = clamp(Math.floor(y), 0, PH - 1);
    if (this.ox != null) {
      const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS);
      if (cx >= this.ox && cx < this.ox + WC && cy >= this.oy && cy < this.oy + WC) {
        const k = (cy & (WC - 1)) * WC + (cx & (WC - 1));
        if (this.ready[k]) return this.climR[(ty & WM) * WIN + (tx & WM)] / 255;
      }
    }
    return this.coldLut[this.w.biome.get(this.w.idx(tx, ty))];
  }

  // bytes held (GPU textures + CPU copies)
  bytes() { let b = this.climR.length + this.solidR.length; for (const c of this.chan) b += (WIN * c.scale) ** 2 * c.comps * (c.ctor?.BYTES_PER_ELEMENT || 1); return b; }

  dispose() { for (const c of this.chan) this.gl.deleteTexture(c.tex); this.chan.length = 0; this.wk?.terminate(); this.wk = null; }
}

// ---------- gathering: the layers over a tile rect + MD margin, by page copies ----------
const GU8 = ['rock', 'water', 'rock0', 'ground', 'rockType', 'ore', 'biome', 'caveDk', 'tramp', 'solid', 'pground'];
const GF32 = ['lush', 'flowX', 'flowY'];
export function gatherTerrain(w, x0, y0, tw, th, coldLut) {
  const DW = tw + 2 * MD, DH = th + 2 * MD, gx0 = x0 - MD, gy0 = y0 - MD, N = DW * DH;
  const u8 = {}, f32 = {};
  for (const k of GU8) u8[k] = new Uint8Array(N);
  for (const k of GF32) f32[k] = new Float32Array(N);
  const inb = u8.inb = new Uint8Array(N);
  const bounded = !w.wrap, L8 = GU8.map((k) => [w[k], u8[k]]), L32 = GF32.map((k) => [w[k], f32[k]]);
  for (let y = 0; y < DH; y++) {
    let Y = gy0 + y;
    const rowIn = bounded ? Y >= w.by0 && Y < w.by1 : Y >= 0 && Y < PH;
    if (!rowIn) Y = bounded ? clamp(Y, w.by0, w.by1 - 1) : clamp(Y, 0, PH - 1);
    for (let x = 0; x < DW;) {
      const X = gx0 + x, o = y * DW + x;
      if (bounded && (X < w.bx0 || X >= w.bx1)) {
        // outside a bounded world: the nearest edge tile (like the old clamped textures), one tile at a time
        const i = (Y << PWS) | (clamp(X, w.bx0, w.bx1 - 1) & XM);
        for (const [L, d] of L8) d[o] = L.get(i);
        for (const [L, d] of L32) d[o] = L.get(i);
        x++;
        continue;
      }
      const Xw = X & XM, lx = Xw & 63;
      const run = Math.min(64 - lx, DW - x, bounded ? w.bx1 - X : 1e9);
      const c = ((Y >> 6) << 8) | (Xw >> 6), base = (Y & 63) * 64 + lx;
      for (const [L, d] of L8) { const p = L.pages[c]; if (p) d.set(p.subarray(base, base + run), o); else if (L.def) d.fill(L.def, o, o + run); }
      for (const [L, d] of L32) { const p = L.pages[c]; if (p) d.set(p.subarray(base, base + run), o); else if (L.def) d.fill(L.def, o, o + run); }
      if (rowIn) inb.fill(1, o, o + run);
      x += run;
    }
  }
  return { tw, th, x0, y0, DW, DH, u8, f32, coldLut };
}

// copy a tile rect of a 4-component layer (store Layer, comps 4: roof data, path data) into out (RGBA, tight)
export function fillLayer4(L, x0, y0, tw, th, out) {
  for (let ty = 0; ty < th; ty++) {
    const Y = y0 + ty;
    if (Y < 0 || Y >= PH) continue;
    for (let tx = 0; tx < tw; tx++) {
      const i = (Y << PWS) | ((x0 + tx) & XM), p = L.pages[((i >>> 20) << 8) | ((i & XM) >>> 6)];
      if (!p) continue;
      const l = ((((i >>> 8) & 4032) | (i & 63)) << 2), o = (ty * tw + tx) * 4;
      out[o] = p[l]; out[o + 1] = p[l + 1]; out[o + 2] = p[l + 2]; out[o + 3] = p[l + 3];
    }
  }
}
