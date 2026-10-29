// Shared Canvas2D painting helpers for the procedural art (RimWorld-like visual language).
// Everything is drawn supersampled (SS×) in "1× pixel" coordinates (PPU px per tile) and downscaled once,
// which gives smooth anti-aliased vector-like shapes. Outlines are made by dilating a part's silhouette
// (stamping it around a circle) so every part gets a uniform, confident dark contour.

import { mulberry32 } from '../engine/noise.js';

export const PPU = 64;
export const SS = 2;
export const OUT = '#1e1a16';
export const OW = 3.2; // default outline width (1× px)
export const TAU = Math.PI * 2;

export const rng = (seed) => mulberry32((seed * 2654435761) >>> 0);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- colors ----------
export function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgb(c, a = 1) {
  const r = clamp(c[0], 0, 255) | 0, g = clamp(c[1], 0, 255) | 0, b = clamp(c[2], 0, 255) | 0;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}
// mix two colors (hex or arrays) → css
export function mixc(a, b, t, alpha = 1) {
  const A = typeof a === 'string' ? hex(a) : a, B = typeof b === 'string' ? hex(b) : b;
  return rgb([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)], alpha);
}
// multiply brightness (k<1 darker, k>1 lighter)
export function tone(c, k, alpha = 1) {
  const A = typeof c === 'string' ? hex(c) : c;
  return rgb([A[0] * k, A[1] * k, A[2] * k], alpha);
}
export function alpha(c, a) {
  const A = typeof c === 'string' ? hex(c) : c;
  return rgb(A, a);
}
// palette ramp: sample a list of hex stops at t in 0..1
export function ramp(stops, t, a = 1) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mixc(stops[i], stops[i + 1], t - i, a);
}
// shift a hex palette (hue-ish tint via mixing toward a color)
export function tintPal(pal, toward, k) {
  const out = {};
  for (const key in pal) out[key] = typeof pal[key] === 'string' ? mixc(pal[key], toward, k) : pal[key];
  return out;
}
export function cssToHexArr(c) {
  if (c[0] === '#') return hex(c);
  const m = c.match(/[\d.]+/g);
  return [+m[0], +m[1], +m[2]];
}

// ---------- canvases ----------
// All art canvases are CPU (software) canvases: thousands of tiny path fills + blits are much faster
// there than on GPU-backed canvases (per-draw overhead, shader compiles, readback stalls).
export let SOFT = true;
export function setSoftCanvas(v) { SOFT = v; }
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  if (SOFT) c.getContext('2d', { willReadFrequently: true });
  return c;
}
function ctx2d(c) {
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  g.lineCap = 'round';
  return g;
}

const pool = new Map();
function acquire(w, h) {
  const k = w + 'x' + h;
  const list = pool.get(k);
  if (list && list.length) {
    const c = list.pop();
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    return c;
  }
  return canvas(w, h);
}
function release(c) {
  const k = c.width + 'x' + c.height;
  let list = pool.get(k);
  if (!list) pool.set(k, (list = []));
  if (list.length < 4) list.push(c);
}
export function clearPool() { pool.clear(); }

// dilation offsets for a given radius in device px: integer offsets (fast unfiltered blits) covering a disc
const offCache = new Map();
function offsets(R) {
  const key = Math.round(R * 4);
  let o = offCache.get(key);
  if (o) return o;
  o = [];
  const seen = new Set();
  const push = (x, y) => { const k = x + ',' + y; if (!seen.has(k) && (x || y)) { seen.add(k); o.push([x, y]); } };
  const n1 = R > 3 ? 14 : 10;
  for (let i = 0; i < n1; i++) { const a = (i / n1) * TAU; push(Math.round(Math.cos(a) * R), Math.round(Math.sin(a) * R)); }
  if (R > 2.2) for (let i = 0; i < 6; i++) { const a = ((i + 0.5) / 6) * TAU; push(Math.round(Math.cos(a) * R * 0.55), Math.round(Math.sin(a) * R * 0.55)); }
  offCache.set(key, o);
  return o;
}

// bounding box of non-transparent pixels [x0, y0, x1, y1) or null (cheap on software canvases).
// Sampled every 2nd row/column (+2 px safety margin): features thinner than that don't exist at SS 2×.
function alphaBox(c) {
  const W = c.width, H = c.height;
  const u = new Uint32Array(c.getContext('2d').getImageData(0, 0, W, H).data.buffer);
  let y0 = -1, y1 = -1, x0 = W, x1 = -1;
  for (let y = 0; y < H; y += 2) {
    const r = y * W;
    let rowMin = -1, rowMax = -1;
    for (let x = 0; x < W; x += 2) if (u[r + x] >>> 24) { rowMin = x; break; }
    if (rowMin < 0) continue;
    for (let x = (W - 1) & ~1; x >= rowMin; x -= 2) if (u[r + x] >>> 24) { rowMax = x; break; }
    if (y0 < 0) y0 = y;
    y1 = y;
    if (rowMin < x0) x0 = rowMin;
    if (rowMax > x1) x1 = rowMax;
  }
  if (y0 < 0) return null;
  return [Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(W, x1 + 3), Math.min(H, y1 + 3)];
}
const colAlpha = (col) => { const m = /rgba\(([^)]+)\)/.exec(col); if (!m) return [col, 1]; const v = m[1].split(','); return [`rgb(${v[0]},${v[1]},${v[2]})`, +v[3]]; };

// Draws `src` onto `dst` (identity transform) with a dilated outline behind it. Only the painted
// region (bounding box + outline radius) is processed.
export function outlineOnto(dst, src, ow = OW, col = OUT) {
  const W = src.width, H = src.height;
  const box = alphaBox(src);
  if (!box) return;
  const R = Math.ceil(ow * SS) + 1;
  const rx0 = Math.max(0, box[0] - R), ry0 = Math.max(0, box[1] - R);
  const rx1 = Math.min(W, box[2] + R), ry1 = Math.min(H, box[3] + R);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  if (ow > 0) {
    const t = acquire(W, H);
    const tg = t.getContext('2d');
    tg.imageSmoothingEnabled = false;
    const bw = box[2] - box[0], bh = box[3] - box[1];
    for (const [dx, dy] of offsets(ow * SS)) tg.drawImage(src, box[0], box[1], bw, bh, box[0] + dx, box[1] + dy, bw, bh);
    tg.imageSmoothingEnabled = true;
    const [c, a] = colAlpha(col);
    tg.globalCompositeOperation = 'source-atop';
    tg.fillStyle = c;
    tg.fillRect(rx0, ry0, rw, rh);
    tg.globalCompositeOperation = 'source-over';
    const ga = dst.globalAlpha;
    dst.globalAlpha = ga * a;
    dst.drawImage(t, rx0, ry0, rw, rh, rx0, ry0, rw, rh);
    dst.globalAlpha = ga;
    release(t);
  }
  dst.drawImage(src, rx0, ry0, rw, rh, rx0, ry0, rw, rh);
  dst.restore();
}

// Painter: one sprite under construction.
// Drawing code works in the sprite's nominal W×H pixel box, but the canvas has a transparent margin
// (pad) so nothing ever clips; finish() crops to the painted content, symmetric around the horizontal
// center (so ax = 0.5 stays exact and flipped sprites mirror in place). The result carries
// origW/origH/origin so atlas anchors given in the nominal box are converted (see sprites.js).
class Painter {
  constructor(W, H, opts = {}) {
    this.W = W; this.H = H;
    this.crop = opts.crop ?? true;
    this.pad = this.crop ? (opts.pad ?? 10) : 0;
    const pw = W + this.pad * 2, ph = H + this.pad * 2;
    this.c = canvas(pw * SS, ph * SS);
    this.g = ctx2d(this.c);
    this.g.setTransform(SS, 0, 0, SS, this.pad * SS, this.pad * SS);
  }
  // Draw `fn(g)` into an isolated layer, outline it, then composite it over the sprite.
  layer(fn, ow = OW, col = OUT, opacity = 1) {
    const L = acquire(this.c.width, this.c.height);
    const lg = ctx2d(L);
    lg.setTransform(SS, 0, 0, SS, this.pad * SS, this.pad * SS);
    fn(lg);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    if (opacity < 1) { this.g.save(); this.g.globalAlpha = opacity; }
    outlineOnto(this.g, L, ow, col);
    if (opacity < 1) this.g.restore();
    release(L);
  }
  // outline everything drawn so far (whole-sprite contour)
  outlineAll(ow = OW, col = OUT) {
    const L = acquire(this.c.width, this.c.height);
    const lg = L.getContext('2d');
    lg.drawImage(this.c, 0, 0);
    this.g.save();
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.c.width, this.c.height);
    this.g.restore();
    outlineOnto(this.g, L, ow, col);
    release(L);
  }
  finish() {
    const pad = this.pad, FW = this.W + pad * 2, FH = this.H + pad * 2;
    const full = canvas(FW, FH);
    const fg = full.getContext('2d');
    fg.imageSmoothingEnabled = true;
    fg.imageSmoothingQuality = 'high';
    fg.drawImage(this.c, 0, 0, FW, FH);
    full.origW = this.W; full.origH = this.H;
    full.origin = { x: pad, y: pad };
    full.needsCrop = this.crop;
    return full;
  }
}

// Crop every padded sprite to its painted content with ONE pixel readback (staging atlas), keeping the
// nominal horizontal center centered (ax = 0.5 stays exact so flips mirror in place).
export function cropAll(list) {
  const items = [];
  for (let i = 0; i < list.length; i++) if (list[i].needsCrop) items.push(i);
  if (!items.length) return list.slice();
  const SW = 2048;
  // shelf-pack into staging pages (≤ 4096 tall)
  const pages = [];
  let page = { rects: [], h: 0 }, x = 0, y = 0, rowH = 0;
  for (const i of items) {
    const c = list[i];
    if (x + c.width > SW) { x = 0; y += rowH + 1; rowH = 0; }
    if (y + c.height > 4096) { page.h = y + rowH; pages.push(page); page = { rects: [], h: 0 }; x = 0; y = 0; rowH = 0; }
    page.rects.push({ i, x, y });
    x += c.width + 1; rowH = Math.max(rowH, c.height);
  }
  page.h = y + rowH; pages.push(page);
  const out = list.slice();
  for (const P of pages) {
    const st = canvas(SW, Math.max(1, P.h));
    const sg = st.getContext('2d', { willReadFrequently: true });
    for (const r of P.rects) sg.drawImage(list[r.i], r.x, r.y);
    const d = sg.getImageData(0, 0, SW, st.height).data;
    for (const r of P.rects) {
      const c = list[r.i];
      const FW = c.width, FH = c.height;
      let minX = FW, maxX = -1, minY = FH, maxY = -1;
      for (let yy = 0; yy < FH; yy++) {
        let o = ((r.y + yy) * SW + r.x) * 4 + 3;
        for (let xx = 0; xx < FW; xx++, o += 4) {
          if (d[o] > 3) {
            if (xx < minX) minX = xx;
            if (xx > maxX) maxX = xx;
            if (yy < minY) minY = yy;
            if (yy > maxY) maxY = yy;
          }
        }
      }
      const pad = c.origin.x;
      if (maxX < 0) { minX = pad; maxX = pad + c.origW - 1; minY = pad; maxY = pad + c.origH - 1; }
      const axp = pad + c.origW / 2;
      const half = Math.max(axp - minX, maxX + 1 - axp) + 1;
      const x0 = Math.floor(axp - half);
      const w = Math.round((axp - x0) * 2);
      const y0 = Math.max(0, minY - 1), y1 = Math.min(FH, maxY + 2);
      const cc = canvas(w, y1 - y0);
      cc.getContext('2d').drawImage(c, x0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
      cc.origW = c.origW; cc.origH = c.origH;
      cc.origin = { x: c.origin.x - x0, y: c.origin.y - y0 };
      out[r.i] = cc;
    }
  }
  return out;
}

// sprite(wTiles, hTiles, (g, P) => {...}, opts) → 1× canvas (PPU px per tile)
export function sprite(wt, ht, fn, opts) {
  const P = new Painter(Math.round(wt * PPU), Math.round(ht * PPU), opts);
  fn(P.g, P);
  return P.finish();
}
// sprite with explicit pixel size
export function spritePx(W, H, fn, opts) {
  const P = new Painter(W, H, opts);
  fn(P.g, P);
  return P.finish();
}
// convert an anchor given in a sprite's nominal box to its cropped canvas
export function anchorOf(c, ax, ay) {
  if (!c.origW) return [ax, ay];
  return [(ax * c.origW + c.origin.x) / c.width, (ay * c.origH + c.origin.y) / c.height];
}

// ---------- paths ----------
export function circle(g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
export function ell(g, x, y, rx, ry, rot = 0) { g.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); g.ellipse(x, y, rx, ry, rot, 0, TAU); }

// smooth closed curve through points (quadratic through midpoints)
export function smoothClosed(g, pts) {
  const n = pts.length;
  const m0x = (pts[n - 1][0] + pts[0][0]) / 2, m0y = (pts[n - 1][1] + pts[0][1]) / 2;
  g.moveTo(m0x, m0y);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}
export function poly(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}
// wobbly blob points around (cx,cy)
export function blobPts(cx, cy, rx, ry, rand, n = 10, jit = 0.12, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU + (rand() - 0.5) * (TAU / n) * 0.35;
    const k = 1 + (rand() - 0.5) * 2 * jit;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
export function blob(g, cx, cy, rx, ry, rand, n = 10, jit = 0.12, rot = 0) {
  smoothClosed(g, blobPts(cx, cy, rx, ry, rand, n, jit, rot));
}

// tapered stroke along a quadratic curve p0 -> (c) -> p1, width w0 -> w1 (filled polygon)
export function taper(g, x0, y0, cx, cy, x1, y1, w0, w1, steps = 10) {
  const L = [], R = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const dx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    const dy = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const d = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * t) / 2;
    const nx = -dy / d * w, ny = dx / d * w;
    L.push([x + nx, y + ny]); R.push([x - nx, y - ny]);
  }
  g.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < L.length; i++) g.lineTo(L[i][0], L[i][1]);
  for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath();
}
// leaf / blade shape from base (x0,y0) to tip (x1,y1), max width w, bend (perpendicular bulge)
export function leaf(g, x0, y0, x1, y1, w, bend = 0) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  const mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend;
  g.moveTo(x0, y0);
  g.quadraticCurveTo(mx + nx * w, my + ny * w, x1, y1);
  g.quadraticCurveTo(mx - nx * w, my - ny * w, x0, y0);
  g.closePath();
}

// ---------- fills ----------
export function lin(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (Array.isArray(s)) gr.addColorStop(s[0], s[1]);
    else gr.addColorStop(i / (stops.length - 1), s);
  }
  return gr;
}
export function rad(g, x, y, r0, r1, stops, x1 = x, y1 = y) {
  const gr = g.createRadialGradient(x, y, r0, x1, y1, r1);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (Array.isArray(s)) gr.addColorStop(s[0], s[1]);
    else gr.addColorStop(i / (stops.length - 1), s);
  }
  return gr;
}
export function fill(g, style, pathFn) {
  g.beginPath(); pathFn(g); g.fillStyle = style; g.fill();
}
export function stroke(g, style, w, pathFn) {
  g.beginPath(); pathFn(g); g.strokeStyle = style; g.lineWidth = w; g.stroke();
}
// paint only over existing pixels of the current layer
export function atop(g, fn) {
  g.save(); g.globalCompositeOperation = 'source-atop'; fn(g); g.restore();
}
export function clipTo(g, pathFn, fn) {
  g.save(); g.beginPath(); pathFn(g); g.clip(); fn(g); g.restore();
}
// directional volume shading over a layer: light from top-left, dark toward bottom-right
export function volume(g, x0, y0, x1, y1, dark = 'rgba(20,16,10,0.35)', light = 'rgba(255,250,230,0.14)') {
  atop(g, () => {
    g.fillStyle = lin(g, x0, y0, x1, y1, [[0, light], [0.45, 'rgba(0,0,0,0)'], [1, dark]]);
    g.fillRect(Math.min(x0, x1) - 50, Math.min(y0, y1) - 50, Math.abs(x1 - x0) + 100, Math.abs(y1 - y0) + 100);
  });
}

// ---------- fast outline variant (added by Art B) ----------
// Same look as outlineOnto/Painter.layer with fewer dilation taps (10 on the ring + 4 inside instead of 14 + 6):
// fewer blits for character/creature/item art. spritePxFast() is a drop-in for spritePx().
const offCacheFast = new Map();
function offsetsFast(R) {
  const key = Math.round(R * 4);
  let o = offCacheFast.get(key);
  if (o) return o;
  o = [];
  const seen = new Set();
  const push = (x, y) => { const k = x + ',' + y; if (!seen.has(k) && (x || y)) { seen.add(k); o.push([x, y]); } };
  const n1 = R > 3 ? 10 : 8;
  for (let i = 0; i < n1; i++) { const a = (i / n1) * TAU; push(Math.round(Math.cos(a) * R), Math.round(Math.sin(a) * R)); }
  if (R > 2.2) for (let i = 0; i < 4; i++) { const a = ((i + 0.5) / 4) * TAU; push(Math.round(Math.cos(a) * R * 0.55), Math.round(Math.sin(a) * R * 0.55)); }
  offCacheFast.set(key, o);
  return o;
}
export function outlineOntoFast(dst, src, ow = OW, col = OUT) {
  const W = src.width, H = src.height;
  const box = alphaBox(src);
  if (!box) return;
  const R = Math.ceil(ow * SS) + 1;
  const rx0 = Math.max(0, box[0] - R), ry0 = Math.max(0, box[1] - R);
  const rx1 = Math.min(W, box[2] + R), ry1 = Math.min(H, box[3] + R);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  if (ow > 0) {
    const t = acquire(W, H);
    const tg = t.getContext('2d');
    tg.imageSmoothingEnabled = false;
    const bw = box[2] - box[0], bh = box[3] - box[1];
    for (const [dx, dy] of offsetsFast(ow * SS)) tg.drawImage(src, box[0], box[1], bw, bh, box[0] + dx, box[1] + dy, bw, bh);
    tg.imageSmoothingEnabled = true;
    const [c, a] = colAlpha(col);
    tg.globalCompositeOperation = 'source-atop';
    tg.fillStyle = c;
    tg.fillRect(rx0, ry0, rw, rh);
    tg.globalCompositeOperation = 'source-over';
    const ga = dst.globalAlpha;
    dst.globalAlpha = ga * a;
    dst.drawImage(t, rx0, ry0, rw, rh, rx0, ry0, rw, rh);
    dst.globalAlpha = ga;
    release(t);
  }
  dst.drawImage(src, rx0, ry0, rw, rh, rx0, ry0, rw, rh);
  dst.restore();
}
class FastPainter extends Painter {
  layer(fn, ow = OW, col = OUT, opacity = 1) {
    const L = acquire(this.c.width, this.c.height);
    const lg = ctx2d(L);
    lg.setTransform(SS, 0, 0, SS, this.pad * SS, this.pad * SS);
    fn(lg);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    if (opacity < 1) { this.g.save(); this.g.globalAlpha = opacity; }
    outlineOntoFast(this.g, L, ow, col);
    if (opacity < 1) this.g.restore();
    release(L);
  }
}
export function spritePxFast(W, H, fn, opts) {
  const P = new FastPainter(W, H, opts);
  fn(P.g, P);
  return P.finish();
}
