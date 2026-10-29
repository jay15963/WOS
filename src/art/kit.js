// Shape kit for the character/creature/item art (Art B): splines, jointed limbs, fur strokes, rounded rects.
// Pure path helpers on a Canvas2D context (coordinates in the sprite's 1× pixel box, see paint.js).

import { TAU, canvas, spritePxFast as spritePx } from './paint.js';

// ---------- multi-frame sprites from shared parts ----------
// Paint `fn(P)` as an isolated padded sprite part (same nominal box W×H as the final sprite).
export function part(W, H, fn) { return spritePx(W, H, (g, P) => fn(P)); }
// part restricted to the horizontal band y0..y1 of the W×H box (smaller canvases = faster outlines);
// stack() places it back at its offset.
export function band(W, H, y0, y1, fn) {
  y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(H, Math.ceil(y1));
  const c = spritePx(W, y1 - y0, (g, P) => fn({ layer: (f, ow, col, op) => P.layer((g) => { g.translate(0, -y0); f(g); }, ow, col, op) }));
  c.offY = y0;
  return c;
}
// n frames of a part. fn(P, dx) draws every frame i translated by i*dx; each frame is painted into its own
// part with the others shifted off-canvas (outline passes only see one frame → small bounding boxes).
export function strip(W, H, n, fn, y0 = 0, y1 = H) {
  const dx = W + 40;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(band(W, H, y0, y1, (P) => {
      const Q = { layer: (f, ow, col, op) => P.layer((g) => { g.translate(-i * dx, 0); f(g); }, ow, col, op) };
      fn(Q, dx);
    }));
  }
  return out;
}
// horizontally mirrored copy of a part (mirrors around the nominal center, keeps crop metadata)
export function mirror(c0) {
  const c = canvas(c0.width, c0.height);
  const g = c.getContext('2d');
  g.translate(c0.width, 0); g.scale(-1, 1); g.drawImage(c0, 0, 0);
  c.origW = c0.origW; c.origH = c0.origH; c.origin = { x: c0.width - c0.origin.x - c0.origW, y: c0.origin.y }; c.needsCrop = true;
  if (c0.offY != null) c.offY = c0.offY;
  return c;
}
// Stack finished parts (same size/pad) into one sprite canvas, keeping the crop metadata of the first.
export function stack(parts) {
  let c0 = null;
  for (const p of parts) if (p && p.offY == null) { c0 = p; break; }
  const c = canvas(c0.width, c0.height);
  const g = c.getContext('2d');
  for (const p of parts) if (p) g.drawImage(p, 0, p.offY || 0);
  c.origW = c0.origW; c.origH = c0.origH; c.origin = c0.origin; c.needsCrop = true;
  return c;
}

// Closed (or open) Catmull-Rom spline THROUGH the points. k = tension (1 = standard, <1 tighter).
export function spline(g, pts, closed = true, k = 1, move = true) {
  const n = pts.length;
  if (n < 2) return;
  const P = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  if (move) g.moveTo(pts[0][0], pts[0][1]); else g.lineTo(pts[0][0], pts[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    g.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6 * k, p1[1] + (p2[1] - p0[1]) / 6 * k,
      p2[0] - (p3[0] - p1[0]) / 6 * k, p2[1] - (p3[1] - p1[1]) / 6 * k,
      p2[0], p2[1]);
  }
  if (closed) g.closePath();
}

// Jointed chain: top joint (x, y, w0) + segments [len, angle, wEnd]; angle measured from straight DOWN,
// positive toward +x. `d` = per-segment cumulative angle deltas (pose). Returns [[x, y, w], ...].
export function chain(x, y, w0, segs, d) {
  const pts = [[x, y, w0]];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const [len, ang, w] = segs[i];
    acc += d ? d[i] || 0 : 0;
    const a = ang + acc;
    x += Math.sin(a) * len; y += Math.cos(a) * len;
    pts.push([x, y, w]);
  }
  return pts;
}
// stretch a chain vertically (about its top) so its last point lands on ground y
export function plant(pts, ground) {
  const y0 = pts[0][1], y1 = pts[pts.length - 1][1];
  if (Math.abs(y1 - y0) < 1e-3) return pts;
  const k = (ground - y0) / (y1 - y0);
  for (const p of pts) p[1] = y0 + (p[1] - y0) * k;
  return pts;
}

// Smooth tapered limb through joint points [[x, y, width], ...] with rounded caps.
export function limbPath(g, P) {
  const n = P.length;
  const L = [], R = [], F = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const hw = P[i][2] / 2;
    L.push([P[i][0] - dy * hw, P[i][1] + dx * hw]);
    R.push([P[i][0] + dy * hw, P[i][1] - dx * hw]);
    F.push([dx, dy]);
  }
  const side = (S, rev) => {
    const idx = rev ? (i) => n - 1 - i : (i) => i;
    for (let j = 1; j < n - 1; j++) {
      const p = S[idx(j)], q = S[idx(j + 1)];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    const e = S[idx(n - 1)];
    g.lineTo(e[0], e[1]);
  };
  g.moveTo(L[0][0], L[0][1]);
  side(L, false);
  // end cap (forward)
  { const p = P[n - 1], f = F[n - 1], hw = p[2] / 2, l = L[n - 1], r = R[n - 1];
    g.quadraticCurveTo(l[0] + f[0] * hw * 1.1, l[1] + f[1] * hw * 1.1, p[0] + f[0] * hw, p[1] + f[1] * hw);
    g.quadraticCurveTo(r[0] + f[0] * hw * 1.1, r[1] + f[1] * hw * 1.1, r[0], r[1]); }
  side(R, true);
  // start cap (backward)
  { const p = P[0], f = F[0], hw = p[2] / 2, l = L[0], r = R[0];
    g.quadraticCurveTo(r[0] - f[0] * hw * 1.1, r[1] - f[1] * hw * 1.1, p[0] - f[0] * hw, p[1] - f[1] * hw);
    g.quadraticCurveTo(l[0] - f[0] * hw * 1.1, l[1] - f[1] * hw * 1.1, l[0], l[1]); }
  g.closePath();
}

export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

// Short fur strokes inside the current clip, roughly following direction `dir` (radians, canvas angle).
// cols: [darkCss, lightCss]; share of light strokes = pl.
export function fur(g, rand, x0, y0, x1, y1, n, cols, dir = Math.PI * 0.6, len = 3.2, pl = 0.4, lw = 0.9) {
  g.lineWidth = lw;
  g.lineCap = 'round';
  // two batched paths (dark / light): one stroke call each
  const P = [[], []];
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    const a = dir + (rand() - 0.5) * 0.6, l = len * (0.6 + rand() * 0.8);
    P[rand() < pl ? 1 : 0].push(x, y, x + Math.cos(a) * l * 0.5 + (rand() - 0.5), y + Math.sin(a) * l * 0.5 + (rand() - 0.5), x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  for (let k = 0; k < 2; k++) {
    const q = P[k];
    if (!q.length) continue;
    g.strokeStyle = cols[k];
    g.beginPath();
    for (let i = 0; i < q.length; i += 6) { g.moveTo(q[i], q[i + 1]); g.quadraticCurveTo(q[i + 2], q[i + 3], q[i + 4], q[i + 5]); }
    g.stroke();
  }
}

// Ring of tufts along a polyline (for ruffs / bristles): little triangles pointing out along normal `side`
export function tufts(g, pts, size, side = 1, rand = Math.random) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d * side, ny = dx / d * side;
    const s = size * (0.7 + rand() * 0.6);
    g.moveTo(ax, ay);
    g.lineTo((ax + bx) / 2 + nx * s + dx / d * s * 0.35, (ay + by) / 2 + ny * s + dy / d * s * 0.35);
    g.lineTo(bx, by);
    g.closePath();
  }
}

// eye with iris/pupil/highlight. iris = null → plain dark eye
export function eyeAt(g, x, y, r, iris, ry = 1.1) {
  g.fillStyle = '#16110e'; g.beginPath(); g.ellipse(x, y, r, r * ry, 0, 0, TAU); g.fill();
  if (iris) {
    g.fillStyle = iris; g.beginPath(); g.ellipse(x, y, r * 0.68, r * 0.68 * ry, 0, 0, TAU); g.fill();
    g.fillStyle = '#120d0a'; g.beginPath(); g.ellipse(x + r * 0.05, y, r * 0.3, r * 0.42 * ry, 0, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.ellipse(x - r * 0.32, y - r * 0.38, r * 0.3, r * 0.3, 0, 0, TAU); g.fill();
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
