// Diagonal views of the humanoid rig (camera rotation, 8 directions). The painted art has three views (s front,
// n back, e side; w = e mirrored); a 3/4 view ('se' front-side, 'ne' back-side; sw / nw mirrored) is made from the
// front (s) or back (n) image of every part, turned on the body's vertical axis: the outline stays where it is (a
// head / torso seen from 45° has nearly the same silhouette) while the content inside slides toward the side the
// body faces, squeezed on the far side and spread on the near side, as a surface wrapped on a cylinder does —
// eyes, nose, mouth, buttons, the hair parting move over; the far eye narrows. Content past the cylinder (the
// outline, ears, sleeves) keeps its place and width. A 3/4 torso is a little narrower than a front one.
//
// Parts are painted lazily into the look texture (art/look/lazy.js, agent H's machinery: same eviction / reuse) the
// first time a turned camera shows them — nothing is baked, nothing is shared state. Sources may be look parts
// (lk_*, walker overlays: painted canvases, not necessarily placed) or baked atlas sprites (armour wear_*, bandana,
// legacy masks: read back from the atlas canvas).
//   diagSprite(A, src, view, kind) → look-texture record (ready later) or null
//   diagRig(A, LK, view) → { body, head, brows, beard, hair, hairBack, lids, need } for a look rig (look/rig.js)
//   diagReady(D, A, urgent) → are all its parts painted?
//   turnX(x, view, kind) → where a point of the source image lands (tiles from the axis; e.g. eye glows)

import { LAZY_DEFS } from '../lazyDefs.js';
import { lookAtlasOf, LOOK_CLOCK } from './lazy.js';
import { BW, BH, FEET, NECK, HY, bodyPath } from '../pawns.js';

// px at atlas resolution (PPU 64): the turning radius of each row follows the body: the torso outline (pawns.js
// bodyPath) or the skull (a sphere of radius R round the skull centre, a cylinder from the cheeks down: the jaw,
// chin and beard move with the face) — so a dome stays a dome. turn = how far the centre slides (radians on the
// cylinder), w = width of the 3/4 silhouette relative to the source
export const KIND = {
  body: { turn: 0.6, w: 0.88 },
  head: { turn: 0.7, w: 1, R: 17.5 },
};
// the source image of a view and the way its content slides (+1: to the right)
export const VIEW = { se: { pd: 's', sg: 1 }, ne: { pd: 'n', sg: -1 } };

// half width of the torso outline per row (px above the feet), measured once from the painters' path
let BODY_HALF = null;
function bodyHalf(up) {
  if (!BODY_HALF) {
    BODY_HALF = new Float32Array(BH + 1);
    const c = document.createElement('canvas');
    c.width = BW; c.height = BH;
    const g = c.getContext('2d');
    g.beginPath(); bodyPath(g, 's'); g.fillStyle = '#fff'; g.fill();
    const d = g.getImageData(0, 0, BW, BH).data;
    for (let y = 0; y < BH; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < BW; x++) if (d[(y * BW + x) * 4 + 3] > 128) { if (x0 < 0) x0 = x; x1 = x; }
      BODY_HALF[FEET - y] = x0 < 0 ? 0 : Math.max(0, (x1 + 1 - x0) / 2 - 1);
    }
  }
  const i = Math.round(up);
  return i >= 0 && i <= BH ? BODY_HALF[i] || 0 : 0;
}
// turning radius of a row (dy: px below the anchor; head anchor = the neck)
function radiusAt(kind, dy) {
  if (kind === 'body') return bodyHalf(-dy);
  const K = KIND.head, c = dy + (NECK - HY); // from the skull centre
  return c >= 0 ? K.R : c > -K.R ? Math.sqrt(K.R * K.R - c * c) : 0;
}
// source x (px from the axis) → 3/4 x, for a row of radius a
function turnPx(x, a, K, sg) {
  if (a < 1.5 || x <= -a || x >= a) return x * K.w;
  const th = Math.asin(x / a), u = th / (Math.PI / 2);
  return a * Math.sin(th + sg * K.turn * (1 - u * u)) * K.w;
}
// where a point of the source image lands (tiles from the axis; ly: tiles above the anchor)
export function turnX(x, ly, view, kind = 'head') { return turnPx(x * 64, radiusAt(kind, -ly * 64), KIND[kind], VIEW[view].sg) / 64; }

// a source image: { img, x0, y0, w, h, ax, ay } (ax / ay: the anchor in px inside the sub-rect)
function source(A, LA, name) {
  if (!name) return null;
  if (LA.has(name)) {
    const r = LA.get(name);
    if (!r || !LA.prepare(r)) return null;
    return { img: r.canvas, x0: 0, y0: 0, w: r.pw, h: r.ph, ax: r.ax * r.pw, ay: r.ay * r.ph };
  }
  if (A.has(name) && A.canvas && A.size) {
    const s = A.get(name), S = A.size;
    return { img: A.canvas, x0: Math.round(s.u0 * S), y0: Math.round(s.v0 * S), w: s.pw, h: s.ph, ax: s.ax * s.pw, ay: s.ay * s.ph };
  }
  return null;
}

// a source's pixels (RGBA rows)
const pixelsOf = (S) => {
  const c = document.createElement('canvas');
  c.width = S.w; c.height = S.h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(S.img, S.x0, S.y0, S.w, S.h, 0, 0, S.w, S.h);
  return g.getImageData(0, 0, S.w, S.h).data;
};
// premultiplied horizontal sample of row y at px x of a pixel buffer (box filter of width fw when squeezed)
const ACC = [0, 0, 0, 0];
function sample(px, w, h, y, x, fw) {
  ACC[0] = ACC[1] = ACC[2] = ACC[3] = 0;
  if (y < 0 || y >= h) return;
  const n = fw <= 1.2 ? 1 : Math.min(6, Math.ceil(fw));
  for (let q = 0; q < n; q++) {
    const xx = n === 1 ? x : x + ((q + 0.5) / n - 0.5) * fw;
    const x0 = Math.floor(xx - 0.5), f = xx - 0.5 - x0;
    for (let e = 0; e < 2; e++) {
      const xi = x0 + e, wq = (e ? f : 1 - f) / n;
      if (xi < 0 || xi >= w || wq <= 0) continue;
      const i = (y * w + xi) * 4, al = px[i + 3] * wq;
      ACC[0] += px[i] * al; ACC[1] += px[i + 1] * al; ACC[2] += px[i + 2] * al; ACC[3] += al;
    }
  }
}
// the 3/4 canvas, row by row (anchor on the same axis / height as the source). nameE (3/4 front hair): the side
// image's back of the head, squeezed onto the near edge, under the turned front hair (the front image has no hair
// behind the ear)
function warp(A, name, view, kind, def, nameE) {
  const LA = lookAtlasOf(A), S = source(A, LA, name), K = KIND[kind], sg = VIEW[view].sg;
  const E = nameE ? source(A, LA, nameE) : null;
  const c = document.createElement('canvas');
  c.origin = { x: 0, y: 0 };
  if (!S) { c.width = c.height = 1; c.origW = c.origH = 1; return c; }
  const sw = S.w, half = Math.max(S.ax, sw - S.ax);
  // (wide enough for a small part slid toward the side: an eye, a nose)
  const hw = Math.ceil(Math.max(half, kind === 'head' ? 24 : 28) * Math.max(1, K.w)) + 1, W = hw * 2;
  const top = Math.max(S.ay, E ? E.ay : 0), H = Math.ceil(top + Math.max(S.h - S.ay, E ? E.h - E.ay : 0));
  const oy = Math.round(top - S.ay), ey = E ? Math.round(top - E.ay) : 0; // rows of the sources in the output
  c.width = W; c.height = H;
  const src = pixelsOf(S), esrc = E ? pixelsOf(E) : null;
  const g = c.getContext('2d');
  const out = g.createImageData(W, H), o = out.data;
  // side image: its back half (behind x = −2 px) onto the output's near edge, squeezed (sg: which edge is near)
  const eHalf = E ? Math.max(E.ax, E.w - E.ax) : 0, eK = 0.45, eL = -(half - 0.5);
  const N = Math.ceil(half * 2 * 4) + 2, xs = new Float32Array(N), xo = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const ys = y - oy, a = radiusAt(kind, ys - S.ay);
    // inverse map on a fine grid: output pixel centre → source x (monotonic)
    for (let i = 0; i < N; i++) { xs[i] = -half + i / 4; xo[i] = turnPx(xs[i], a, K, sg); }
    let j = 0;
    for (let i = 0; i < W; i++) {
      const x = i + 0.5 - hw;
      let r = 0, gg = 0, b = 0, al = 0;
      if (x >= xo[0] && x <= xo[N - 1]) {
        while (j < N - 2 && xo[j + 1] < x) j++;
        const d = xo[j + 1] - xo[j], f = d > 1e-6 ? (x - xo[j]) / d : 0;
        sample(src, sw, S.h, ys, S.ax + xs[j] + f * 0.25, d > 1e-6 ? 0.25 / d : 4);
        r = ACC[0]; gg = ACC[1]; b = ACC[2]; al = ACC[3];
      }
      if (E && al < 254 && ys - S.ay + (NECK - HY) > -8) { // (below the crown: the dome stays the front hair's)
        const xe = (sg * x - eL) / eK - eHalf; // (mirrored when the near edge is the right one)
        if (xe < -2 && xe > -eHalf) {
          sample(esrc, E.w, E.h, y - ey, E.ax + xe, 1 / eK);
          const k = 1 - al / 255;
          r += ACC[0] * k; gg += ACC[1] * k; b += ACC[2] * k; al += ACC[3] * k;
        }
      }
      if (al < 0.5) continue;
      const p = (y * W + i) * 4;
      o[p] = r / al; o[p + 1] = gg / al; o[p + 2] = b / al; o[p + 3] = al;
    }
  }
  g.putImageData(out, 0, 0);
  def.ay = top / H;
  c.origW = W; c.origH = H;
  return c;
}

// the look-texture record of a 3/4 part (painted later; null when there is nothing to make it from)
export function diagSprite(A, name, view, kind, nameE = null) {
  if (!name) return null;
  const key = `~${view}:${kind}:${name}${nameE ? '+' + nameE : ''}`;
  if (!LAZY_DEFS.has(key)) {
    const def = { ax: 0.5, ay: 1, canvas: () => warp(A, name, view, kind, def, nameE) };
    LAZY_DEFS.set(key, def);
  }
  return lookAtlasOf(A).get(key);
}

// ---- a look rig's 3/4 stacks (cached on the rig) ----
function stackOf(A, D, list, view, kind, side = null) {
  const res = [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i], e = side && side[i] && side[i].s.name.replace(/_e$/, '') === l.s.name.replace(/_[sn]$/, '') ? side[i].s.name : null;
    const s = diagSprite(A, l.s.name, view, kind, e);
    if (!s) continue;
    D.need.push(s);
    res.push({ s, r: l.r, g: l.g, b: l.b, legs: l.legs });
  }
  return res;
}
export function diagRig(A, LK, view) {
  const C = LK.diag || (LK.diag = {});
  if (C[view]) return C[view];
  const pd = VIEW[view].pd;
  const D = { view, need: [], ready: false, epoch: -1, body: [], head: [], brows: [], beard: [], hair: [], hairBack: [], lids: null };
  D.body = stackOf(A, D, LK.body[pd], view, 'body');
  D.head = stackOf(A, D, LK.head[pd], view, 'head');
  D.hair = stackOf(A, D, LK.hair[pd], view, 'head', view === 'se' ? LK.hair.e : null);
  D.brows = stackOf(A, D, LK.brows[pd], view, 'head');
  D.beard = stackOf(A, D, LK.beard[pd], view, 'head');
  D.hairBack = stackOf(A, D, LK.hairBack[pd], view, 'head');
  const ls = LK.lids[pd];
  if (ls) { D.lids = diagSprite(A, ls.name, view, 'head'); if (D.lids) D.need.push(D.lids); }
  C[view] = D;
  return D;
}
// are all parts of a 3/4 rig painted and placed? urgent: paint the missing ones now (the local player)
export function diagReady(D, A, urgent = false) {
  const LA = lookAtlasOf(A);
  if (D.ready && D.epoch === LA.epoch) return true;
  let ok = true;
  for (const r of D.need) {
    if (r.ready || r.failed) continue;
    if (urgent) LA.paintNow(r); else LA.want(r);
    if (!r.ready && !r.failed) ok = false;
  }
  D.ready = ok; D.epoch = LA.epoch;
  return ok;
}
// one 3/4 part outside a look (armour, bandana, masks, walker overlays): the record when painted, else asks for it
export function diagPart(A, name, view, kind, urgent = false) {
  const r = diagSprite(A, name, view, kind);
  if (!r || r.failed) return null;
  if (r.ready) { r.lu = LOOK_CLOCK.f; return r; }
  const LA = lookAtlasOf(A);
  if (urgent) LA.paintNow(r); else LA.want(r);
  return r.ready ? r : null;
}
