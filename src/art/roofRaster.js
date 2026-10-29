// Procedural roofs (agent J): one image per roof region, painted on the CPU into typed arrays (no DOM) and cached
// until the region changes. Pure functions (not part of the atlas; not imported by sprites.js).
//
// Geometry (any shape of 4-connected roof tiles):
//   1. the region is covered by MAXIMAL RECTANGLES (greedy: the biggest rectangle through every uncovered tile;
//      rectangles may overlap);
//   2. each rectangle gets a pitched roof along its long side: a FRONT GABLE (ridge N-S, the triangular gable
//      end faces the camera) when it is at most ROOF_GEOM.frontGable× wider than deep, else a SIDE GABLE (ridge
//      E-W, the long slope faces the camera); ends are gables or hips by style (style.ends); the pitch flattens
//      on wide spans so the ridge never rises more than ROOF_GEOM.maxRise above the eaves;
//   3. the roof surface is the MAX of the rectangles' height fields: where two roofs meet, max() forms the valleys
//      of cross gables (L / T / U shapes) and a lower wing dies into the higher roof;
//   4. 3/4 view: a point (x, y, h) is drawn at screen (x, y - h); a z-buffer on the ground depth y (larger = in
//      front) resolves overhangs, gable faces, bargeboards and chimneys.
// Painting (per pixel, once): scalloped fish-scale tiles / wood shakes / thatch / stone slabs by style (course
// rows parallel to each eave), baked light from the upper left on four facet orientations, ridge caps, hip caps,
// valley gutters, bargeboards along the gable rakes, fascia + a soft shadow under the eaves, plaster / timber /
// planks / stone gable faces with a small window, stone chimneys above fires (and det-bit chimneys), weathervanes,
// moss, soft dark outlines.
// Output: premultiplied RGBA + per-pixel owner slice (one per tile column run: the renderer depth-sorts each slice
// by the run's south edge) + source tile (picking).

import { ROOF_GEOM, ROOF_STYLES, DET } from '../game/content/roofs.js';

// prim kinds
const SURF = 1, FACE = 2, BOARD = 3, CHIM = 4, VANE = 5, SHADE = 6;
// facets: 1 W-facing, 2 E-facing, 3 S-facing, 4 N-facing
const LX = -0.5, LY = 0.35, LZ = 0.8; // baked light (upper left, a bit from the front)

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
// cheap value noise (tiles)
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------------- rectangles ----------------
function maximalRects(inR, bw, bh) {
  const covered = new Uint8Array(bw * bh), rects = [];
  // run lengths: left / right extent of each tile's row run
  const L = new Int16Array(bw * bh), Rr = new Int16Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    let s = -1;
    for (let x = 0; x < bw; x++) { const i = y * bw + x; if (inR[i]) { if (s < 0) s = x; L[i] = s; } else s = -1; }
    s = -1;
    for (let x = bw - 1; x >= 0; x--) { const i = y * bw + x; if (inR[i]) { if (s < 0) s = x; Rr[i] = s; } else s = -1; }
  }
  for (let ty = 0; ty < bh; ty++) for (let tx = 0; tx < bw; tx++) {
    const t = ty * bw + tx;
    if (!inR[t] || covered[t]) continue;
    // up intervals (rows ty..r0) and down intervals (rows ty..r1) around column tx
    const up = [], dn = [];
    let lo = L[t], hi = Rr[t];
    for (let y = ty; y >= 0 && inR[y * bw + tx]; y--) { lo = Math.max(lo, L[y * bw + tx]); hi = Math.min(hi, Rr[y * bw + tx]); up.push([y, lo, hi]); }
    lo = L[t]; hi = Rr[t];
    for (let y = ty; y < bh && inR[y * bw + tx]; y++) { lo = Math.max(lo, L[y * bw + tx]); hi = Math.min(hi, Rr[y * bw + tx]); dn.push([y, lo, hi]); }
    let best = null, ba = -1;
    for (const [y0, l0, h0] of up) for (const [y1, l1, h1] of dn) {
      const l = Math.max(l0, l1), h = Math.min(h0, h1), a = (h - l + 1) * (y1 - y0 + 1);
      // prefer bigger, then squarer (nicer roofs)
      const sc = a * 100 - Math.abs((h - l + 1) - (y1 - y0 + 1));
      if (sc > ba) { ba = sc; best = [l, y0, h + 1, y1 + 1]; }
    }
    const [x0, y0, x1, y1] = best;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) covered[y * bw + x] = 1;
    rects.push({ x0, y0, x1, y1 });
  }
  return rects;
}

// ---------------- main ----------------
// spec: { tiles: Int32Array (world idx, sorted), W, x0, y0, x1, y1 (tile bbox), style: [styleId per tile],
//         det: Int32Array, fires: [[x, y, id]], eaveH, res }
export function rasterRegion(spec) {
  const G = ROOF_GEOM, res = spec.res || 48, He = spec.eaveH ?? G.eaveH, e = G.overhang, er = G.rake, thick = G.thick;
  const eS = G.overhangS ?? 0.12, erS = Math.min(er, eS); // south: short eaves / rake so the wall face below shows
  const W = spec.W, bx0 = spec.x0, by0 = spec.y0, bw = spec.x1 - spec.x0 + 1, bh = spec.y1 - spec.y0 + 1;
  const T = spec.tiles, nT = T.length;
  // local grid: tile order index + 1
  const inR = new Int32Array(bw * bh);
  for (let n = 0; n < nT; n++) { const i = T[n], x = i % W - bx0, y = ((i / W) | 0) - by0; inR[y * bw + x] = n + 1; }
  const ST = new Array(nT);
  for (let n = 0; n < nT; n++) ST[n] = ROOF_STYLES[spec.style[n]] || ROOF_STYLES.thatch;
  const styleOf = (n) => ST[n];
  // ---- rectangles + their roofs ----
  const rects = maximalRects(inR, bw, bh);
  let maxRise = 0;
  for (const r of rects) {
    const cnt = {};
    let best = null, bn = 0;
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      const k = spec.style[inR[y * bw + x] - 1];
      cnt[k] = (cnt[k] || 0) + 1;
      if (cnt[k] > bn) { bn = cnt[k]; best = k; }
    }
    const S = ROOF_STYLES[best] || ROOF_STYLES.thatch;
    r.S = S;
    // world coords
    r.X0 = r.x0 + bx0; r.X1 = r.x1 + bx0; r.Y0 = r.y0 + by0; r.Y1 = r.y1 + by0;
    const w = r.X1 - r.X0, d = r.Y1 - r.Y0;
    r.ns = w <= d * G.frontGable;                       // ridge N-S (front gable) unless clearly wider than deep
    r.hip = S.ends === 'hip';
    const span = r.ns ? w : d;
    r.p = Math.min(S.pitch, G.maxRise / Math.max(0.5, span / 2));
    r.half = span / 2 + e;
    r.c = r.ns ? (r.X0 + r.X1) / 2 : (r.Y0 + r.Y1) / 2;
    r.rise = r.p * span / 2;
    if (r.rise > maxRise) maxRise = r.rise;
    // domain (world): eaves e on the sides and north, eS / erS at the south (hips: e / eS, gables: rake er / erS)
    if (r.ns) { r.dx0 = r.X0 - e; r.dx1 = r.X1 + e; r.dy0 = r.Y0 - (r.hip ? e : er); r.dy1 = r.Y1 + (r.hip ? eS : erS); }
    else { r.dx0 = r.X0 - (r.hip ? e : er); r.dx1 = r.X1 + (r.hip ? e : er); r.dy0 = r.Y0 - e; r.dy1 = r.Y1 + eS; }
  }
  const NR = rects.length;
  // height of rect r at (x, y); -1e9 outside its domain. Sets HF (facet) as a side value. The roof is the min of
  // its planes; each plane rises at pitch p from the wall line and its overhang (a < off) kicks out shallower.
  let HF = 0;
  const plane = (p, a, off, kick = 0.4) => (a >= off ? He + p * (a - off) : He - (off - a) * p * kick);
  const hRect = (r, x, y) => {
    if (x < r.dx0 || x > r.dx1 || y < r.dy0 || y > r.dy1) return -1e9;
    const p = r.p;
    let h, f;
    if (r.ns) {
      const hw = plane(p, x - r.dx0, e), he = plane(p, r.dx1 - x, e);
      if (hw <= he) { h = hw; f = 1; } else { h = he; f = 2; }
      if (r.hip) {
        const hs = plane(p, r.dy1 - y, eS), hn = plane(p, y - r.dy0, e, 1);
        if (hs < h && hs <= hn) { h = hs; f = 3; } else if (hn < h) { h = hn; f = 4; }
      }
    } else {
      const hs = plane(p, r.dy1 - y, eS), hn = plane(p, y - r.dy0, e, 1);
      if (hs <= hn) { h = hs; f = 3; } else { h = hn; f = 4; }
      if (r.hip) {
        const hw = plane(p, x - r.dx0, e), he = plane(p, r.dx1 - x, e);
        if (hw < h && hw <= he) { h = hw; f = 1; } else if (he < h) { h = he; f = 2; }
      }
    }
    HF = f;
    return h;
  };

  // ---- image frame (screen-world: x, sy = y - h) ----
  const chimH = G.chimneyH;
  const sx0 = bx0 - e - 0.12, sx1 = bx0 + bw + e + 0.12;
  const sy0 = by0 - e - He - maxRise - chimH - 0.35, sy1 = by0 + bh + e + 0.3;
  const IW = Math.max(4, Math.ceil((sx1 - sx0) * res)), IH = Math.max(4, Math.ceil((sy1 - sy0) * res));
  const NP = IW * IH;
  const depth = new Float32Array(NP).fill(-1e9), hgt = new Float32Array(NP), prim = new Uint8Array(NP), pid = new Int16Array(NP), fac = new Uint8Array(NP), src = new Int32Array(NP).fill(-1);
  const gx = new Float32Array(NP); // ground x / u of the primitive (for patterns)
  const put = (px, py, d, h, k, r, f, s, x) => {
    if (px < 0 || py < 0 || px >= IW || py >= IH) return;
    const j = py * IW + px;
    if (d <= depth[j]) return;
    depth[j] = d; hgt[j] = h; prim[j] = k; pid[j] = r; fac[j] = f; src[j] = s; gx[j] = x;
  };
  // nearest region tile (local order index) for a world point (clamped into rect r)
  const tileIn = (r, x, y) => {
    const tx = Math.min(r.x1 - 1, Math.max(r.x0, Math.floor(x) - bx0)), ty = Math.min(r.y1 - 1, Math.max(r.y0, Math.floor(y) - by0));
    return inR[ty * bw + tx] - 1;
  };

  // ---- 1. roof surfaces (column by column, south → north, z-tested) ----
  const colRects = [];
  for (let px = 0; px < IW; px++) {
    const x = sx0 + (px + 0.5) / res;
    colRects.length = 0;
    let ya = 1e9, yb = -1e9, maxP = 0;
    for (let k = 0; k < NR; k++) {
      const r = rects[k];
      if (x < r.dx0 || x > r.dx1) continue;
      colRects.push(k); ya = Math.min(ya, r.dy0); yb = Math.max(yb, r.dy1);
      if (!r.ns || r.hip) maxP = Math.max(maxP, r.p); // slopes along y stretch on screen: sample denser
    }
    if (!colRects.length) continue;
    const dy = 1 / (res * (1 + maxP) * 1.1);
    let prevPy = -1, prevH = 0, prevK = -1;
    for (let y = yb; y >= ya; y -= dy) {
      let H = -1e9, K = -1, F = 0;
      for (let q = 0; q < colRects.length; q++) {
        const k = colRects[q], h = hRect(rects[k], x, y);
        if (h > H) { H = h; K = k; F = HF; }
      }
      if (K < 0) { prevPy = -1; continue; }
      const r = rects[K], s = tileIn(r, x, y);
      const py = Math.floor((y - H - sy0) * res);
      if (prevPy < 0) {
        // front edge entering the roof: a slab edge (fascia / bargeboard) below the first sample
        const gableEnd = r.ns && !r.hip && y > r.Y1;
        const tk = gableEnd ? 0.12 : thick;
        for (let q = 0, n = Math.ceil(tk * res); q <= n; q++) put(px, py + q, y + 0.0005, H, BOARD, K, gableEnd ? 7 : 8, s, x); // h = top of the board
        put(px, py, y, H, SURF, K, F, s, x);
      } else if (H > prevH + 0.02 + r.p * dy * 2) {
        // step up onto a higher roof (its gable end or eave edge stands in front of the lower one)
        const isFace = r.ns && !r.hip;
        for (let q = py; q <= prevPy; q++) put(px, q, y, isFace ? y - (q / res + sy0) : H, isFace ? FACE : BOARD, K, isFace ? 0 : 8, s, x);
      } else {
        const a = Math.min(py, prevPy), b = Math.max(py, prevPy);
        for (let q = a; q <= b; q++) put(px, q, y, H, SURF, K, F, s, x);
      }
      prevPy = py; prevH = H; prevK = K;
    }
  }
  // ---- 2. gable faces + bargeboards (south ends of front-gable rectangles) ----
  const windows = [];
  for (let k = 0; k < NR; k++) {
    const r = rects[k];
    if (!r.ns || r.hip) continue;
    const winH = Math.min(0.62, (r.rise - 0.1) * 0.3);
    if (winH > 0.16 && r.half - e > 0.7) windows.push({ x: r.c, y: r.Y1, h: He + r.rise * 0.36, s: winH });
    const yF = r.Y1, pxa = Math.floor((r.X0 - sx0) * res), pxb = Math.ceil((r.X1 - sx0) * res);
    for (let px = pxa; px < pxb; px++) {
      const x = sx0 + (px + 0.5) / res;
      if (x < r.X0 || x > r.X1) continue;
      const top = hRect(r, x, yF) - thick * 0.6;
      if (top <= He) continue;
      const s = tileIn(r, x, yF - 0.5);
      const qa = Math.floor((yF - top - sy0) * res), qb = Math.ceil((yF - He - sy0) * res);
      for (let q = qa; q <= qb; q++) put(px, q, yF, yF - (q / res + sy0), FACE, k, 0, s, x);
    }
  }
  // ---- 3. chimneys (above fires, or det-bit tiles) and weathervanes ----
  const chimneys = [];
  const evalH = (x, y) => { let H = -1e9, K = -1; for (let k = 0; k < NR; k++) { const h = hRect(rects[k], x, y); if (h > H) { H = h; K = k; } } return [H, K]; };
  const addChimney = (cx, cy, fire) => {
    for (const c of chimneys) if (Math.abs(c.x - cx) < 0.8 && Math.abs(c.y - cy) < 0.8) return;
    const cw = 0.34, cd = 0.3;
    let base = -1e9;
    for (const [ox, oy] of [[-cw / 2, -cd / 2], [cw / 2, -cd / 2], [-cw / 2, cd / 2], [cw / 2, cd / 2]]) base = Math.max(base, evalH(cx + ox, cy + oy)[0]);
    if (base < -1e8) return;
    const top = base + chimH * 0.75 + 0.25, K = evalH(cx, cy)[1];
    const s = tileIn(rects[K], cx, cy);
    const ys = cy + cd / 2, xa = Math.floor((cx - cw / 2 - sx0) * res), xb = Math.ceil((cx + cw / 2 - sx0) * res);
    for (let px = xa; px < xb; px++) {
      const x = sx0 + (px + 0.5) / res;
      const hs = evalH(x, ys)[0];
      // south face
      for (let q = Math.floor((ys - top - sy0) * res); q <= Math.ceil((ys - Math.max(hs, base - 0.4) - sy0) * res); q++) put(px, q, ys + 0.01, ys - (q / res + sy0), CHIM, K, 3, s, x);
      // lid (top) + cap rim
      for (let q = Math.floor((cy - cd / 2 - top - 0.04 - sy0) * res); q <= Math.ceil((ys - top - sy0) * res); q++) {
        const yy = q / res + sy0 + top;
        put(px, q, yy + 0.02, top, CHIM, K, 5, s, x);
      }
    }
    chimneys.push({ x: cx, y: ys - 0.02, top: top + 0.02, fire, always: !fire });
  };
  for (const [fx, fy, id] of spec.fires || []) addChimney(Math.min(bx0 + bw - 0.3, Math.max(bx0 + 0.3, fx)), fy, id);
  const vanes = [];
  for (let n = 0; n < nT; n++) {
    const d = spec.det[n] | 0;
    if (!d) continue;
    const i = T[n], tx = i % W + 0.5, ty = ((i / W) | 0) + 0.5;
    if (d & DET.chimney) addChimney(tx, ty, null);
    if (d & DET.vane) vanes.push([tx, ty, n]);
  }
  for (const [vx, vy, n] of vanes) {
    // on the local ridge: move to the highest point of the tile column
    let best = vy, bh2 = -1e9;
    for (let yy = vy - 0.5; yy <= vy + 0.5; yy += 0.05) { const h = evalH(vx, yy)[0]; if (h > bh2) { bh2 = h; best = yy; } }
    const K = evalH(vx, best)[1];
    if (K < 0) continue;
    const top = bh2 + 0.62, pxc = Math.floor((vx - sx0) * res);
    for (let q = Math.floor((best - top - sy0) * res); q <= Math.ceil((best - bh2 - sy0) * res); q++) { put(pxc, q, best + 0.05, 0, VANE, K, 0, n, vx); put(pxc + 1, q, best + 0.05, 0, VANE, K, 1, n, vx); }
    // arrow + cardinal bar
    const qa = Math.floor((best - top + 0.1 - sy0) * res), qb = Math.floor((best - top + 0.22 - sy0) * res);
    for (let d2 = -Math.round(0.2 * res); d2 <= Math.round(0.24 * res); d2++) put(pxc + d2, qa, best + 0.05, 0, VANE, K, 2, n, vx);
    for (let d2 = -Math.round(0.09 * res); d2 <= Math.round(0.09 * res); d2++) put(pxc + d2, qb, best + 0.05, 0, VANE, K, 3, n, vx);
    for (let q = -2; q <= 2; q++) for (let d2 = Math.round(0.2 * res) - 3; d2 <= Math.round(0.2 * res) + 1; d2++) if (Math.abs(q) <= (Math.round(0.2 * res) + 1 - d2) * 0.6) put(pxc + d2, qa + q, best + 0.05, 0, VANE, K, 2, n, vx);
  }

  // ---- 4. paint ----
  const col = new Float32Array(NP * 4);
  const nrm = [];
  for (const r of rects) {
    const p = r.p, inv = 1 / Math.hypot(p, 1);
    // facet shading (baked light), index by facet code
    r.sh = [0, 0.5 + 0.62 * (-LX * p + LZ) * inv, 0.5 + 0.62 * (LX * p + LZ) * inv, 0.5 + 0.62 * (LY * p + LZ) * inv, 0.5 + 0.62 * (-LY * p + LZ) * inv];
    nrm.push(inv);
  }
  const C = [0, 0, 0];
  const mix3 = (a, b, t) => { C[0] = a[0] + (b[0] - a[0]) * t; C[1] = a[1] + (b[1] - a[1]) * t; C[2] = a[2] + (b[2] - a[2]) * t; };
  for (let py = 0; py < IH; py++) {
    const sy = sy0 + (py + 0.5) / res;
    for (let px = 0; px < IW; px++) {
      const j = py * IW + px, k = prim[j];
      if (!k) continue;
      const x = gx[j], r = rects[pid[j]], s = src[j] >= 0 ? styleOf(src[j]) : r.S, f = fac[j], h = hgt[j], yd = depth[j];
      let R = 0, Gc = 0, B = 0, A = 1;
      if (k === SURF) {
        // pattern coordinates: U along the courses (parallel to the facet's eave), V up the slope (screen tiles)
        let U, V, ridgeD;
        if (f === 1 || f === 2) {
          U = sy; V = f === 1 ? x - r.dx0 : r.dx1 - x;
          ridgeD = r.ns ? Math.abs(x - r.c) : 9;
        } else {
          U = x; V = (f === 3 ? r.dy1 - yd : yd - r.dy0) * (1 + r.p);
          ridgeD = r.ns ? 9 : Math.abs(yd - r.c) * (1 + r.p);
        }
        const tint = (1 + 0.06 * Math.sin(x * 0.9 + yd * 0.6) * Math.sin(yd * 1.3 - x * 0.45)) * (0.9 + 0.1 * smooth(0, 1.6, V))
          * (1 + (vnoise(x * 0.45 + 31, yd * 0.45) - 0.5) * 0.14);
        let lum = 1, base = s.base;
        const rowH = s.rowH, cw = s.cellW;
        if (s.pattern === 'scale') {
          let row = Math.floor(V / rowH), fv = V / rowH - row;
          let uu = U / cw + (row & 1) * 0.5, cell = Math.floor(uu), fu = uu - cell - 0.5;
          let arc = 0.62 * (1 - Math.sqrt(Math.max(0, 1 - 4 * fu * fu)));
          let t;
          if (fv >= arc) t = fv - arc;
          else { row--; uu = U / cw + (row & 1) * 0.5; cell = Math.floor(uu); fu = uu - cell - 0.5; arc = 0.62 * (1 - Math.sqrt(Math.max(0, 1 - 4 * fu * fu))); t = fv + 1 - arc; }
          const jit = (hash(cell, row) - 0.5) * s.jitter * 3;
          lum = (t < 0.06 ? 0.42 : t < 0.17 ? 1.22 : 1.08 - 0.32 * smooth(0.2, 1.3, t)) * (1 + jit);
          lum *= 1 - 0.16 * smooth(0.3, 0.5, Math.abs(fu)) * smooth(0.5, 1.2, t);
        } else if (s.pattern === 'shake') {
          const row = Math.floor(V / rowH), fv = V / rowH - row;
          const uu = U / cw + hash(row, 7) * 0.9, cell = Math.floor(uu), fu = uu - cell;
          const jit = (hash(cell, row) - 0.5) * s.jitter * 3.2;
          lum = (fu < 0.07 ? 0.45 : 1) * (fv < 0.1 ? 1.2 : fv > 0.8 ? 0.72 - 0.15 * smooth(0.8, 1, fv) : 1) * (1 + jit);
          lum *= 0.94 + 0.06 * Math.sin(U * 130 + cell * 3.1) * Math.sin(V * 9 + cell);
          if (hash(cell, row + 99) < 0.08) lum *= 0.82; // a weathered shake
        } else if (s.pattern === 'thatch') {
          const si = Math.floor(U * 26), sf = U * 26 - si;              // strands ~2 px wide
          const ragged = (hash(si, 77) - 0.5) * 0.16 + Math.sin(U * 3.1) * 0.04;
          const row = Math.floor((V + ragged) / rowH), fv = (V + ragged) / rowH - row;
          const st = hash(si + row * 131, row) * 0.55 + hash(Math.floor(U * 9) + row * 17, row + 3) * 0.45;
          const groove = 1 - 0.18 * Math.abs(sf - 0.5) * 2;               // round strands
          lum = (0.78 + 0.36 * st) * groove;
          lum *= fv < 0.1 ? 1.16 + 0.1 * st : fv > 0.72 ? 1 - 0.45 * smooth(0.72, 1, fv) : 1; // fringe / shadow under the next course
          if (fv < 0.025) lum *= 0.55;
        } else { // slab
          const row = Math.floor(V / rowH), fv = V / rowH - row;
          const uu = U / cw + (row & 1) * 0.5 + hash(row, 3) * 0.2, cell = Math.floor(uu), fu = uu - cell;
          const jit = (hash(cell, row) - 0.5) * s.jitter * 3;
          const edge = Math.min(fu, 1 - fu) * cw, ev = Math.min(fv, 1 - fv) * rowH;
          lum = (edge < 0.02 || ev < 0.018 ? 0.48 : fv > 0.82 ? 0.82 : fv < 0.16 ? 1.16 : 1) * (1 + jit);
          lum *= 0.94 + 0.12 * vnoise(U * 9 + cell, V * 9);
        }
        // ridge cap along the top of this rectangle's roof
        const capW = s.ridge === 'bound' ? 0.16 : 0.1;
        let shade = r.sh[f];
        let cap = 0;
        if (ridgeD < capW && h > He + r.rise - 0.25) cap = 1 - ridgeD / capW;
        if (lum < 1) mix3(s.dark, s.base, Math.max(0, lum)); else mix3(s.base, s.light, Math.min(1, (lum - 1) * 1.6));
        R = C[0] * tint; Gc = C[1] * tint; B = C[2] * tint;
        // moss / weathering (det bit) on the north and east faces
        const d = src[j] >= 0 ? spec.det[src[j]] | 0 : 0;
        if (d & DET.moss) {
          const m = smooth(0.55, 0.8, vnoise(x * 1.7, yd * 1.7) + (f === 4 || f === 2 ? 0.15 : -0.05));
          R += (0.3 - R) * m * 0.6; Gc += (0.38 - Gc) * m * 0.6; B += (0.18 - B) * m * 0.6;
        }
        if (cap > 0) {
          // ridge cap: a rounded band with a dark lower edge (tiles: half-round tiles with joints; thatch: a bound
          // straw roll with ties; wood: a ridge board)
          const along = r.ns ? sy : x;
          const cc = s.ridge === 'board' ? s.board : s.ridge === 'bound' ? s.base : s.dark;
          let k = s.ridge === 'board' ? 1.7 : s.ridge === 'bound' ? 0.95 : 1.25;
          k *= 0.72 + 0.5 * Math.sqrt(cap);                                   // rounded: bright along the top
          if (s.ridge === 'tile') { const u = (along * 3.1) % 1; k *= u < 0.08 ? 0.55 : 0.9 + 0.2 * Math.sin(u * 3.1416); }
          else if (s.ridge === 'bound') { if (Math.abs((along * 1.6) % 1 - 0.5) < 0.05) k *= 0.55; k *= 0.92 + 0.16 * hash(Math.floor(along * 30), 9); }
          if (cap < 0.22) k *= 0.5;                                            // edge line
          R = cc[0] * k; Gc = cc[1] * k; B = cc[2] * k;
          shade = Math.max(shade, 0.95);
        }
        // trim (det): light painted rake boards along the gable edges of the slopes
        const rakeD = r.ns ? (r.hip ? 9 : Math.min(yd - r.dy0, r.dy1 - yd)) : (r.hip ? 9 : Math.min(x - r.dx0, r.dx1 - x));
        if (rakeD < 0.09) {
          const bc = d & DET.trim ? TRIM : s.board;
          const hi = rakeD < 0.03 ? 1.3 : 1;
          R = bc[0] * hi; Gc = bc[1] * hi; B = bc[2] * hi; shade = 0.95;
        }
        R *= shade; Gc *= shade; B *= shade;
      } else if (k === FACE) {
        // gable face: plaster with timber, planks or stone; a small window in the middle
        const gc = s.gableCol, tm = s.timber;
        const hb = h - He, u = x - r.c, half = r.half - e;
        let c = gc, lum = 1;
        if (s.gable === 'planks') {
          const bw2 = 0.16, q = (x - r.X0) / bw2, fu = q - Math.floor(q);
          lum = (fu < 0.1 ? 0.5 : 1) * (1 + (hash(Math.floor(q), 5) - 0.5) * 0.16) * (0.95 + 0.05 * Math.sin(hb * 60 + Math.floor(q)));
        } else if (s.gable === 'stone') {
          const row = Math.floor(hb / 0.16), fv = hb / 0.16 - row, uu = (x - r.X0) / 0.3 + (row & 1) * 0.5, fu = uu - Math.floor(uu);
          lum = (fv < 0.12 || fu < 0.06 ? 0.55 : 1) * (1 + (hash(Math.floor(uu), row) - 0.5) * 0.2);
        } else {
          // plaster with a timber frame: tie beam at the bottom, king post, diagonal braces
          lum = 0.96 + 0.08 * vnoise(x * 6, hb * 6);
          const beam = hb < 0.1, post = Math.abs(u) < 0.05, brace = Math.abs(Math.abs(u) - (hb * 0.9)) < 0.05 && hb > 0.1;
          if (beam || post || brace) { c = tm; lum = 0.9 + 0.2 * vnoise(x * 20, hb * 3); }
        }
        // window (or vent) in the middle of a tall enough face
        const winH = Math.min(0.62, (r.rise - 0.1) * 0.3), wy = r.rise * 0.36;
        if (winH > 0.16 && half > 0.7) {
          const du = Math.abs(u), dv = hb - wy, hw = winH * 0.46, hh = winH * 0.5;
          if (du < hw + 0.05 && dv > -hh - 0.06 && dv < -hh + 0.005) { c = tm; lum = 1.25; }       // sill
          else if (du < hw && Math.abs(dv) < hh) {
            const frame = du > hw - 0.045 || Math.abs(dv) > hh - 0.045 || du < 0.022 || Math.abs(dv) < 0.02;
            if (frame) { c = tm; lum = 1; }
            else { c = GLASS; lum = 1 + 0.9 * smooth(0.6, 1, 1 - Math.abs((u + dv) * 6 - 0.6)) + (dv > 0 ? 0.25 : 0); } // sky glint
          }
        }
        // shade: vertical face facing the camera, darker right under the roof (eave shadow)
        const top = hRect(r, x, r.Y1) - He;
        const ao = 1 - 0.38 * smooth(top - 0.35, top, hb);
        const sh = 0.78 * ao * (1 + 0.06 * (u < 0 ? 1 : -1) * 0);
        R = c[0] * lum * sh; Gc = c[1] * lum * sh; B = c[2] * lum * sh;
      } else if (k === BOARD) {
        // bargeboard (7) / fascia (8): dark wood, light top edge
        const d = src[j] >= 0 ? spec.det[src[j]] | 0 : 0;
        const bc = d & DET.trim ? TRIM : s.board;
        const yTop = yd - h; // screen y of the board's top edge at this column
        const t = (sy - yTop) * res;
        const lum = t < 1.2 ? 1.45 : 0.85 - 0.25 * smooth(0, 7, t);
        R = bc[0] * lum; Gc = bc[1] * lum; B = bc[2] * lum;
      } else if (k === CHIM) {
        const stone = STONE;
        if (f === 5) {
          // lid: dark opening with a stone rim
          const ch = chimneys.length ? nearestChim(chimneys, x, yd) : null;
          const du = ch ? Math.abs(x - ch.x) : 0, dv = ch ? Math.abs(yd - (ch.y - 0.13)) : 0;
          const hole = du < 0.1 && dv < 0.08;
          R = hole ? 0.07 : 0.4; Gc = hole ? 0.06 : 0.39; B = hole ? 0.06 : 0.37;
        } else {
          const row = Math.floor(h / 0.1), uu = x / 0.12 + (row & 1) * 0.5, fu = uu - Math.floor(uu), fv = h / 0.1 - row;
          const lum = (fv < 0.14 || fu < 0.1 ? 0.55 : 0.95 + (hash(Math.floor(uu), row) - 0.5) * 0.25);
          R = stone[0] * lum * 0.85; Gc = stone[1] * lum * 0.85; B = stone[2] * lum * 0.85;
        }
      } else if (k === VANE) {
        const lum = f === 1 ? 0.55 : 1;
        R = 0.16 * lum; Gc = 0.15 * lum; B = 0.15 * lum;
      }
      const o = j * 4;
      col[o] = R; col[o + 1] = Gc; col[o + 2] = B; col[o + 3] = A;
    }
  }
  // ---- 5. creases (hip caps / valley gutters) and outlines ----
  const out = new Uint8Array(NP * 4);
  for (let py = 0; py < IH; py++) for (let px = 0; px < IW; px++) {
    const j = py * IW + px;
    const o = j * 4;
    if (!prim[j]) continue;
    let R = col[o], Gc = col[o + 1], B = col[o + 2], A = col[o + 3];
    // silhouette: neighbours without roof
    let empty = 0, behind = 0;
    const d = depth[j], edgeX = px === 0 || px === IW - 1, edgeY = py === 0 || py === IH - 1;
    if (edgeX || edgeY) empty++;
    else {
      const q0 = j - 1, q1 = j + 1, q2 = j - IW, q3 = j + IW;
      if (!prim[q0]) empty++; else if (depth[q0] > d + 0.22) behind++;
      if (!prim[q1]) empty++; else if (depth[q1] > d + 0.22) behind++;
      if (!prim[q2]) empty++; else if (depth[q2] > d + 0.22) behind++;
      if (!prim[q3]) empty++; else if (depth[q3] > d + 0.22) behind++;
    }
    if (prim[j] === SURF && !edgeX && !edgeY) {
      const fi = pid[j] * 8 + fac[j];
      let crease = 0, valley = 0;
      for (let n = 0; n < 4; n++) {
        const q = n === 0 ? j - 1 : n === 1 ? j + 1 : n === 2 ? j - IW : j + IW;
        if (prim[q] !== SURF) continue;
        const fq = pid[q] * 8 + fac[q];
        if (fq === fi) continue;
        if (pid[q] === pid[j]) crease++; else valley++;
      }
      if (valley) { R *= 0.5; Gc *= 0.5; B *= 0.52; }
      else if (crease) {
        const s = src[j] >= 0 ? styleOf(src[j]) : rects[pid[j]].S;
        const cc = s.ridge === 'board' ? s.board : s.dark;
        R = R * 0.35 + cc[0] * 1.2 * 0.65; Gc = Gc * 0.35 + cc[1] * 1.2 * 0.65; B = B * 0.35 + cc[2] * 1.2 * 0.65;
      }
    }
    if (behind) { R *= 0.55; Gc *= 0.55; B *= 0.58; }      // contact line behind a front edge
    if (empty) { R *= 0.45; Gc *= 0.45; B *= 0.48; A *= empty >= 2 ? 0.7 : 0.9; } // soft dark outline
    out[o] = clamp255(R * A); out[o + 1] = clamp255(Gc * A); out[o + 2] = clamp255(B * A); out[o + 3] = clamp255(A);
  }
  // ---- 6. soft shadow under the eaves (on the walls below) ----
  const shadeRows = Math.ceil(0.16 * res);
  for (let px = 0; px < IW; px++) {
    for (let py = IH - 2; py >= 0; py--) {
      const j = py * IW + px;
      if (!prim[j] || prim[j] === SHADE) continue;
      if (prim[(py + 1) * IW + px]) continue;
      // bottom edge of a roof / board: shade below it
      if (prim[j] !== BOARD && prim[j] !== SURF) continue;
      for (let q = 1; q <= shadeRows && py + q < IH; q++) {
        const jj = (py + q) * IW + px;
        if (prim[jj]) break;
        const a = 0.34 * (1 - q / (shadeRows + 1)) ** 1.5;
        prim[jj] = SHADE; src[jj] = src[j]; depth[jj] = depth[j];
        const o = jj * 4;
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = clamp255(a);
      }
    }
  }

  // ---- 7. slices: one per tile column run (depth-sorted by the run's south edge) ----
  const runOf = new Int32Array(nT).fill(-1);
  const slices = [];
  for (let lx = 0; lx < bw; lx++) {
    let ly = 0;
    while (ly < bh) {
      if (!inR[ly * bw + lx]) { ly++; continue; }
      const a = ly;
      while (ly < bh && inR[ly * bw + lx]) { runOf[inR[ly * bw + lx] - 1] = slices.length; ly++; }
      slices.push({ id: slices.length, col: lx + bx0, ya: a + by0, yb: ly - 1 + by0, key: ly + by0 + 0.003, p0: IW, q0: IH, p1: -1, q1: -1 });
    }
  }
  const owner = new Uint16Array(NP);
  for (let py = 0; py < IH; py++) for (let px = 0; px < IW; px++) {
    const j = py * IW + px;
    if (!prim[j] || src[j] < 0) continue;
    const sl = slices[runOf[src[j]]];
    if (!sl) continue;
    owner[j] = sl.id + 1;
    if (px < sl.p0) sl.p0 = px; if (px > sl.p1) sl.p1 = px; if (py < sl.q0) sl.q0 = py; if (py > sl.q1) sl.q1 = py;
  }
  const live = [];
  for (const s of slices) {
    if (s.p1 < 0) continue;
    s.x0 = sx0 + s.p0 / res; s.x1 = sx0 + (s.p1 + 1) / res; s.y0 = sy0 + s.q0 / res; s.y1 = sy0 + (s.q1 + 1) / res;
    s.u0 = s.p0 / IW; s.u1 = (s.p1 + 1) / IW; s.v0 = s.q0 / IH; s.v1 = (s.q1 + 1) / IH;
    live.push(s);
  }
  // ---- per-tile roof height (sun-shadow casters) ----
  const tileH = new Float32Array(nT);
  for (let n = 0; n < nT; n++) {
    const i = T[n], tx = i % W + 0.5, ty = ((i / W) | 0) + 0.5;
    tileH[n] = Math.max(He, evalH(tx, ty)[0]);
  }
  // plain data (structured-clone / transfer friendly: the worker sends it back); attachArt adds the lookups
  return {
    res, w: IW, h: IH, sx0, sy0, sx1: sx0 + IW / res, sy1: sy0 + IH / res,
    color: out, owner, src, slices: live, tileH, chimneys, windows, rects: rects.length, maxRise, tiles: T,
  };
}

// lookups on a finished art (main thread): slice / world tile under a screen-world point (x, sy)
export function attachArt(art) {
  const { res, w: IW, h: IH, sx0, sy0, owner, src, color, tiles } = art;
  const byId = new Map(art.slices.map((s) => [s.id, s]));
  const at = (x, sy) => {
    const px = Math.floor((x - sx0) * res), py = Math.floor((sy - sy0) * res);
    if (px < 0 || py < 0 || px >= IW || py >= IH) return -1;
    const j = py * IW + px;
    return color[j * 4 + 3] < 128 ? -1 : j;
  };
  art.sliceAt = (x, sy) => { const j = at(x, sy); return j < 0 || !owner[j] ? null : byId.get(owner[j] - 1) || null; };
  art.srcAt = (x, sy) => { const j = at(x, sy); return j < 0 || src[j] < 0 ? -1 : tiles[src[j]]; };
  return art;
}

const TRIM = [0.86, 0.84, 0.78], GLASS = [0.2, 0.27, 0.33], STONE = [0.58, 0.55, 0.52];
const clamp255 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);
function nearestChim(list, x, y) { let b = null, bd = 1e9; for (const c of list) { const d = Math.abs(c.x - x) + Math.abs(c.y - y); if (d < bd) { bd = d; b = c; } } return b; }
