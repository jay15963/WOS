// Lazy look atlas (agent H): the 1100+ look parts are NOT baked into the game atlas any more. Only the parts the
// looks on screen use are painted (same painters, atlas resolution), cropped and shelf-packed into a small second
// texture (1024², grows to 2048×1024 if a crowd needs it). The renderer uploads new parts (texSubImage2D) and
// binds it next to the atlas; sprite records carry u in [-1, 0) so the sprite / shadow shaders know to sample it.
//   lookAtlasOf(A)  → the LookAtlas of a game atlas (one per atlas, shared by the game and the menu showcase)
//   LA.get(name)    → a stable sprite record { name, ready, canvas, w, h, ax, ay, u0…v1 } (painted later)
//   LA.want(r) / LA.paintNow(r) · LA.tick(budgetMs) (renderer, once per frame) · LA.stats()
// Parts not drawn for a while are evicted when space runs out (records stay; they are re-placed on demand).
// Nothing here is shared state: every client paints the parts its own looks need, from the same code.
// Agent K registers more lazily painted sprites in art/lazyDefs.js (style variants, details, decoration): same texture.

import { lookDefs } from './index.js';
import { atlasCanvas } from './hipaint.js';
import { PPU, anchorOf } from '../paint.js';
import { LAZY_DEFS } from '../lazyDefs.js'; // agent K: style variants / details / decoration share this texture

const PAD = 4;              // texels between parts (mipmaps)
const IDLE_FRAMES = 600;    // a part unused this long (~10 s) may be evicted
const RECENT_FRAMES = 60;   // … and one unused this long (~1 s) before the texture grows
export const LOOK_CLOCK = { f: 0 }; // frame counter; compose stamps rec.lu = LOOK_CLOCK.f when it draws a part

// crop a padded part canvas to its painted content, keeping the nominal centre centred (ax = 0.5 stays exact)
function crop(c) {
  const W = c.width, H = c.height;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0, o = y * W * 4 + 3; x < W; x++, o += 4) {
    if (d[o] > 3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const pad = c.origin.x;
  if (x1 < 0) return null;
  const axp = pad + c.origW / 2;
  const half = Math.max(axp - x0, x1 + 1 - axp) + 1;
  const cx0 = Math.floor(axp - half), w = Math.round((axp - cx0) * 2);
  const cy0 = Math.max(0, y0 - 1), cy1 = Math.min(H, y1 + 2);
  const cc = document.createElement('canvas');
  cc.width = w; cc.height = cy1 - cy0;
  cc.getContext('2d').drawImage(c, cx0, cy0, w, cy1 - cy0, 0, 0, w, cy1 - cy0);
  cc.origW = c.origW; cc.origH = c.origH; cc.origin = { x: c.origin.x - cx0, y: c.origin.y - cy0 };
  return cc;
}

export class LookAtlas {
  constructor(W = 1024, H = 1024, sync = false) {
    this.defs = lookDefs();
    this.sync = sync;            // 2D previews of a game atlas: paint on first request
    this.recs = new Map();
    this.queue = [];
    this.uploads = [];           // parts placed since the last upload
    this.full = true;            // whole texture must be (re)uploaded
    this.epoch = 0;              // bumps when parts are evicted (rigs recheck readiness)
    this.painted = 0; this.failures = []; this.repacks = 0; this.ms = 0;
    this._resize(W, H);
  }
  _resize(W, H) {
    this.W = W; this.H = H;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.shelves = []; this.nextY = PAD;
    this.full = true;
  }
  has(n) { return this.defs.has(n) || LAZY_DEFS.has(n); }
  get(n) {
    let r = this.recs.get(n);
    if (r) return r;
    if (!this.defs.has(n) && !LAZY_DEFS.has(n)) return null;
    r = { name: n, ready: false, placed: false, queued: false, failed: false, canvas: null, w: 0, h: 0, ax: 0.5, ay: 1, u0: 0, v0: 0, u1: 0, v1: 0, pw: 0, ph: 0, x: 0, y: 0, lu: LOOK_CLOCK.f };
    this.recs.set(n, r);
    if (this.sync) this.paintNow(r);
    return r;
  }
  // ask for a part (painted during the next ticks, in request order)
  want(r) { if (!r.ready && !r.failed && !r.queued) { r.queued = true; this.queue.push(r); } }
  // paint / place a part right now (the local player's own look)
  paintNow(r) { if (!r.ready && !r.failed) this._process(r); }
  // once per frame (renderer): paint queued parts within a time budget
  tick(budget = 4) {
    LOOK_CLOCK.f++;
    if (!this.queue.length) return;
    if (this.queue.length > 60) budget = Math.max(budget, 8); // a crowd just appeared: catch up faster
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budget) this._process(this.queue.shift());
  }
  _process(r) {
    r.queued = false;
    if (r.ready || r.failed) return;
    const t0 = performance.now();
    if (!r.canvas && !this._paint(r)) return;
    this._place(r);
    this.ms += performance.now() - t0;
  }
  // paint a part's canvas (cropped, anchored) without placing it; false = failed
  _paint(r) {
    try {
      const def = this.defs.get(r.name) || LAZY_DEFS.get(r.name);
      const c = crop(def.canvas ? def.canvas() : atlasCanvas(def)); // (agent K's defs bring their own painter)
      if (!c) { r.failed = true; return false; } // nothing painted (never drawn)
      const [ax, ay] = anchorOf(c, def.ax, def.ay);
      r.canvas = c; r.pw = c.width; r.ph = c.height; r.w = c.width / PPU; r.h = c.height / PPU; r.ax = ax; r.ay = ay;
      this.painted++;
      return true;
    } catch (e) {
      r.failed = true;
      if (this.failures.length < 20) this.failures.push(`${r.name}: ${e?.message || e}`);
      console.error('[look] part failed', r.name, e);
      return false;
    }
  }
  // camera rotation (art/look/turn.js): a 3/4 part is made from the painted canvases of two cardinal parts, which
  // need not be placed in the texture themselves
  prepare(r) { if (!r.canvas && !r.failed) { const t0 = performance.now(); this._paint(r); this.ms += performance.now() - t0; } return r.canvas; }
  _alloc(r) {
    const w = r.pw + PAD, h = r.ph + PAD;
    for (const s of this.shelves) if (s.h >= h && s.h <= h * 1.6 + 8 && s.x + w <= this.W) { r.x = s.x; r.y = s.y; s.x += w; return true; }
    const sh = Math.ceil(h / 8) * 8;
    if (this.nextY + sh > this.H || w + PAD > this.W) return false;
    this.shelves.push({ y: this.nextY, h: sh, x: PAD + w });
    r.x = PAD; r.y = this.nextY; this.nextY += sh;
    return true;
  }
  _uv(r) {
    r.u0 = -1 + r.x / this.W; r.u1 = -1 + (r.x + r.pw) / this.W;
    r.v0 = r.y / this.H; r.v1 = (r.y + r.ph) / this.H;
  }
  _place(r) {
    let ok = this._alloc(r);
    for (let lv = 0; !ok && lv < 4; lv++) { if (this._compact(lv)) ok = this._alloc(r); }
    if (!ok) { r.failed = true; return; }
    this.ctx.drawImage(r.canvas, r.x, r.y);
    this._uv(r);
    r.placed = true; r.ready = true;
    if (!this.full) this.uploads.push(r);
  }
  // make room, then repack all: 0 = drop parts idle for ~10 s, 1 = drop parts not drawn for ~1 s, 2 = grow the
  // texture (up to 2048²), 3 = (full size) drop the older half too. Parts drawn this very second are evicted only
  // at level 3, so a scene whose parts all fit in 2048² never flickers (agent K's styles / details / decoration
  // share this texture with the look parts). Returns false when the level cannot apply (already at full size).
  _compact(level) {
    const grow = this.W < 2048 || this.H < 2048;
    if (level === 2 && !grow) return false;
    const keep = [], now = LOOK_CLOCK.f;
    const placed = [...this.recs.values()].filter((r) => r.placed);
    placed.sort((a, b) => b.lu - a.lu);
    const idle = level === 0 ? IDLE_FRAMES : RECENT_FRAMES;
    const cut = level === 3 ? Math.ceil(placed.length / 2) : placed.length;
    if (level < 2 && !placed.some((r) => now - r.lu > idle)) return false; // nothing to drop: no repack
    placed.forEach((r, i) => {
      if (now - r.lu > idle || i >= cut) { r.placed = false; r.ready = false; this.epoch++; } else keep.push(r);
    });
    if (level === 2) {
      if (this.W <= this.H && this.W < 2048) this._resize(this.W * 2, this.H);
      else this._resize(this.W, this.H * 2);
    } else this._resize(this.W, this.H);
    keep.sort((a, b) => b.ph - a.ph);
    for (const r of keep) { if (this._alloc(r)) { this.ctx.drawImage(r.canvas, r.x, r.y); this._uv(r); } else { r.placed = false; r.ready = false; this.epoch++; } }
    this.uploads.length = 0;
    this.repacks++;
    return true;
  }
  stats() {
    let placed = 0; for (const r of this.recs.values()) if (r.placed) placed++;
    return { size: `${this.W}x${this.H}`, parts: placed, painted: this.painted, queued: this.queue.length, repacks: this.repacks, paintMs: Math.round(this.ms), failures: this.failures.slice() };
  }
}

// the lazy look atlas of a game atlas (2D previews of a game atlas set A.lookSync)
export function lookAtlasOf(A) {
  return A.look || (A.look = new LookAtlas(1024, 1024, !!A.lookSync));
}
