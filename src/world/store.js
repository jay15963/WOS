// Planet-scale paged tile storage (docs/STREAMING.md).
//
// The world is PW × PH tiles (x wraps, y does not: poles at 0 and PH − 1), split in CS × CS chunks. A tile is addressed
// by its GLOBAL index i = y * PW + x (fits in an int32); every per-tile layer is a `Layer`: a table of chunk pages
// (typed arrays of CS² values, or CS² × comps) indexed by chunk, so get / set are a few integer ops and two array reads.
//
// Two kinds of layer, one API:
//   chunk-backed  pages come from the world source when a chunk loads (ground, water, rock…); reading an unloaded chunk
//                 gives the layer's default (rock = 1: solid, never walked into); writing one loads it synchronously
//                 (store.ensure) — correctness never waits for a worker
//   sparse        pages are allocated on the first non-default write (structures, decks, paths, roofs, levels…); they
//                 do not depend on chunk loading at all
//
// Index helpers (PW = 2^14): x = i & XM, y = i >>> 14, chunk = (y >> 6) * CW + (x >> 6), local = (y & 63) * 64 + (x & 63).

export const PW = 16384, PH = 8192;          // planet size in tiles
export const XM = PW - 1, PWS = 14;          // x mask, log2(PW)
export const CS = 64, CSS = 6, CM = CS - 1;  // chunk size, log2, mask
export const CW = PW / CS, CH = PH / CS;     // 256 × 128 chunks
export const NCH = CW * CH;                  // 32768
export const CT = CS * CS;                   // tiles per chunk (4096)

export const chunkOfI = (i) => ((i >>> 20) << 8) | ((i & XM) >>> 6);
export const localOfI = (i) => ((i >>> 8) & 4032) | (i & 63);
export const tileI = (x, y) => (y << PWS) | (x & XM);
export const wrapTX = (x) => x & XM;                                   // integer tile x
export const wrapX = (x) => x - PW * Math.floor(x / PW);                // world x (float) in [0, PW)
export const wdx = (dx) => dx - PW * Math.round(dx / PW);               // shortest signed x distance across the seam
export const chunkKey = (cx, cy) => cy * CW + (((cx % CW) + CW) % CW);  // chunk index of chunk coords (cx wraps)

export class Layer {
  // Type: typed array constructor; def: value outside loaded / allocated pages; comps: values per tile (RGBA = 4)
  constructor(name, Type, def = 0, { sparse = false, comps = 1, store = null } = {}) {
    this.name = name;
    this.T = Type;
    this.def = def;
    this.sparse = sparse;
    this.comps = comps;
    this.store = store; // sync-ok: the layer's chunk store (not a replicated object field)
    this.pages = new Array(NCH).fill(null);
    this.n = 0;          // allocated pages
    this.v = 0;          // bumped by clear()
  }

  get(i) {
    const p = this.pages[((i >>> 20) << 8) | ((i & XM) >>> 6)];
    return p == null ? this.def : p[((i >>> 8) & 4032) | (i & 63)];
  }
  set(i, v) {
    const c = ((i >>> 20) << 8) | ((i & XM) >>> 6);
    let p = this.pages[c];
    if (p == null) { if (i < 0 || c >= NCH || (p = this._page(c, v)) == null) return; }
    p[((i >>> 8) & 4032) | (i & 63)] = v;
  }
  // tile (x, y) — x wraps, y outside the planet = default
  at(x, y) { return y < 0 || y >= PH ? this.def : this.get((y << PWS) | (x & XM)); }
  // multi-component access (comps > 1): component k of tile i
  get4(i, k) {
    const p = this.pages[((i >>> 20) << 8) | ((i & XM) >>> 6)];
    return p == null ? 0 : p[((((i >>> 8) & 4032) | (i & 63)) << 2) + k];
  }
  set4(i, k, v) {
    const c = ((i >>> 20) << 8) | ((i & XM) >>> 6);
    let p = this.pages[c];
    if (p == null) { if (i < 0 || c >= NCH || (p = this._page(c, v)) == null) return; }
    p[((((i >>> 8) & 4032) | (i & 63)) << 2) + k] = v;
  }
  // any number of components: component k of tile i (comps from the constructor)
  getc(i, k) {
    const p = this.pages[((i >>> 20) << 8) | ((i & XM) >>> 6)];
    return p == null ? 0 : p[(((i >>> 8) & 4032) | (i & 63)) * this.comps + k];
  }
  setc(i, k, v) {
    const c = ((i >>> 20) << 8) | ((i & XM) >>> 6);
    let p = this.pages[c];
    if (p == null) { if (i < 0 || c >= NCH || (p = this._page(c, v)) == null) return; }
    p[(((i >>> 8) & 4032) | (i & 63)) * this.comps + k] = v;
  }
  // the page of chunk c (creating it for a sparse layer / loading the chunk for a chunk-backed one)
  page(c, create = true) {
    const p = this.pages[c];
    if (p != null || !create) return p;
    return this._page(c, null);
  }
  _page(c, v) {
    if (this.sparse) {
      if (v === this.def || (v === 0 && !this.def)) return null; // (writing the default needs no page)
      const p = new this.T(CT * this.comps);
      if (this.def) p.fill(this.def);
      this.pages[c] = p; this.n++;
      return p;
    }
    if (!this.store) return null;
    this.store.ensure(c);
    return this.pages[c];
  }
  attach(c, arr) { if (this.pages[c] == null) this.n++; this.pages[c] = arr; }
  detach(c) { if (this.pages[c] != null) { this.pages[c] = null; this.n--; } }
  // every page back to the default (sparse layers drop their pages)
  clear() {
    this.v++;
    if (this.sparse) { if (this.n) { this.pages.fill(null); this.n = 0; } return; }
    for (const p of this.pages) if (p) p.fill(this.def);
  }
  // fill(0) kept for older callers (= clear)
  fill(v) { if (v === this.def || (!v && !this.def)) this.clear(); else throw new Error('Layer.fill: only the default'); return this; }
  // bytes held by the pages
  bytes() { let b = 0; for (const p of this.pages) if (p) b += p.byteLength; return b; }
  // indices of the allocated pages
  *chunks() { for (let c = 0; c < NCH; c++) if (this.pages[c]) yield c; }
  // call fn(i, v) for every non-default value (sparse layers; comps 1)
  forEach(fn) {
    const d = this.def;
    for (let c = 0; c < NCH; c++) {
      const p = this.pages[c];
      if (!p) continue;
      const x0 = (c & (CW - 1)) << CSS, y0 = (c >>> 8) << CSS;
      for (let l = 0; l < CT; l++) { const v = p[l]; if (v !== d) fn(((y0 + (l >>> CSS)) << PWS) | (x0 + (l & CM)), v); }
    }
  }
}

// An open-addressing table int key → slot (A* scratch over unbounded node ids: nav.js, levels.js). Cleared by a stamp,
// so a search costs nothing to reset; grows when full.
export class NodeTable {
  constructor(bits = 15) { this._alloc(bits); }
  _alloc(bits) {
    const n = 1 << bits;
    this.bits = bits; this.mask = n - 1; this.cap = n; // sync-ok: A* scratch table (not a replicated object field)
    this.key = new Int32Array(n); this.st = new Uint32Array(n); this.stamp = 1; this.used = 0;
    this.g = new Float32Array(n); this.par = new Int32Array(n); this.flag = new Uint8Array(n); this.lay = new Uint8Array(n);
  }
  reset() { if (++this.stamp > 0xfffffff0) { this.st.fill(0); this.stamp = 1; } this.used = 0; }
  // slot of key k (-1 = absent)
  find(k) {
    const m = this.mask, K = this.key, S = this.st, s = this.stamp;
    let h = Math.imul(k, 0x9e3779b1) >>> (32 - this.bits);
    for (;;) {
      if (S[h] !== s) return -1;
      if (K[h] === k) return h;
      h = (h + 1) & m;
    }
  }
  // slot of key k, inserted (flag 0, par -1) when absent; -1 when the table is too full (the search stops there)
  slot(k) {
    const m = this.mask, K = this.key, S = this.st, s = this.stamp;
    let h = Math.imul(k, 0x9e3779b1) >>> (32 - this.bits);
    for (;;) {
      if (S[h] !== s) {
        if (this.used * 4 > this.cap * 3) return -1;
        S[h] = s; K[h] = k; this.flag[h] = 0; this.par[h] = -1; this.g[h] = 0; this.lay[h] = 0; this.used++;
        return h;
      }
      if (K[h] === k) return h;
      h = (h + 1) & m;
    }
  }
}
