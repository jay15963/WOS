// 3/4 views of animals and creatures (camera rotation, 8 directions): a new drawing made from the species' own
// painters — never the side sprite squeezed. Seen from 45° the body stands diagonally on the ground: its length runs
// along the facing diagonal (the front end lower on the screen when it comes toward the camera, higher when it goes
// away: the ground depth drawn as short as the front / back art draws it), the side drawing's body is swept across the
// body's width (far side darker: the back and the chest / rump show their width), the far legs stand on the far side
// (up, toward the far flank), the near legs on the near side, and the head is turned like the humanoid parts
// (art/look/turn.js): the front (or back) head drawing and the side head drawing laid on a stand-in head turned 45° —
// both eyes, the muzzle pointing down the diagonal, the near ear. Every part keeps its own outline (painted after).
// 'se' (front-side) and 'ne' (back-side); sw / nw are the mirrors.
//
// Shared helper (livestock and creatures can use it):
//   beast34(spec, view) → padded canvas (like spritePx: origW / origH / origin), anchor (0.5, (foot + m) / (H + 2m))
//   spec = { W, H,        side design box (px; the painters draw in it, oy already applied)
//            cx, foot,    the body's length centre (x) and the ground row
//            wb, wl,      body half width (sweep) and the legs' sideways offset (px)
//            farOff,      [dx, dy] the side drawing's own offset of its far legs (taken back)
//            far(P), body(P), near(P), top?(P), tail?(P)  raw layers via P.layer (top: on the near flank; tail: not swept)
//            head?: { side(P, dx), front(P, x, y, s), back(P, x, y, s), spread?: [layer i], ears? }  side head (shifted
//                   by dx) / face-on heads; spread: thin branching layers (antlers) leaned instead of laid on the head;
//                   ears: the rows above the skull leaned the same way (pointed ears stay sharp)
//            headOver?, k?, m?,   (headOver: going away the head stays over the body — a long neck)
//            bend?: { pv, ang, R, E? } grazing: the neck and head (polygon R, design px) turned by ang about the withers
//                   pv (E: a leftover to erase), like the side graze frame; look?: the head turned toward the camera
//            key? }               (frames of one look that share body, tail and head: painted once for all of them)     depth shear (default 0.22), margin above and below (default 14)

import { SS, canvas, spritePxFast } from './paint.js';
import { Rec, extents, smoothE, projectLayer, stretch, GAMMA } from './look/turn.js';

const PAD = 12;
const K_DEPTH = 0.22; // (the front / back art draws the body's length about this short)

const tint = (c, a, col = '16,10,6') => { const t = canvas(c.width, c.height), g = t.getContext('2d'); g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(${col},${a})`; g.fillRect(0, 0, t.width, t.height); return t; };
// the colours of a layer softened (a box blur, its own alpha kept) and pulled toward its mean colour: the inside copies
// of a swept body show a smooth round back instead of the fur strokes and rim shading repeated into stripes
function soft(c, r = 3, flat = 0.55) {
  const W = c.width, H = c.height, g = c.getContext('2d'), src = g.getImageData(0, 0, W, H).data;
  const a = new Float32Array(W * H * 4), b = new Float32Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const al = src[i * 4 + 3] / 255; a[i * 4] = src[i * 4] * al; a[i * 4 + 1] = src[i * 4 + 1] * al; a[i * 4 + 2] = src[i * 4 + 2] * al; a[i * 4 + 3] = al; }
  const pass = (from, to, dx, dy, n, len, step) => {
    for (let l = 0; l < n; l++) {
      const base = l * (dx ? W : 1) * 4;
      for (let ch = 0; ch < 4; ch++) {
        let acc = 0, cnt = 0;
        for (let q = -r; q < len + r; q++) {
          const add = q + r, sub = q - r - 1;
          if (add < len) { acc += from[base + add * step + ch]; cnt++; }
          if (sub >= 0) { acc -= from[base + sub * step + ch]; cnt--; }
          if (q >= 0 && q < len) to[base + q * step + ch] = acc / cnt;
        }
      }
    }
  };
  let mr = 0, mg = 0, mb = 0, ma = 0;
  for (let i = 0; i < W * H; i++) { const al = src[i * 4 + 3]; if (al > 128) { mr += src[i * 4] * al; mg += src[i * 4 + 1] * al; mb += src[i * 4 + 2] * al; ma += al; } }
  if (ma) { mr /= ma; mg /= ma; mb /= ma; }
  pass(a, b, 1, 0, H, W, 4); pass(b, a, 0, 1, W, H, W * 4);
  const t = canvas(W, H), tg = t.getContext('2d'), out = tg.createImageData(W, H), d = out.data;
  for (let i = 0; i < W * H; i++) {
    const al = a[i * 4 + 3];
    if (!src[i * 4 + 3]) continue;
    const k = ma ? flat : 0, f = (j, m) => (al > 0.001 ? a[i * 4 + j] / al : src[i * 4 + j]) * (1 - k) + m * k;
    d[i * 4] = f(0, mr); d[i * 4 + 1] = f(1, mg); d[i * 4 + 2] = f(2, mb); d[i * 4 + 3] = src[i * 4 + 3];
  }
  tg.putImageData(out, 0, 0);
  return t;
}
function bbox(R) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const W = R.cw, H = R.ch;
  for (const L of R.layers) for (let y = 0; y < H; y += 2) for (let x = 0, o = y * W * 4 + 3; x < W; x += 2, o += 8) if (L.px[o] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x0 > x1) return null;
  return [x0 / SS - R.pad, y0 / SS - R.pad, x1 / SS - R.pad, y1 / SS - R.pad];
}
// a thin branching thing on both sides of the head (antlers): the face-on drawing's spread, foreshortened, leaning
// as the side drawing leans row by row (a stand-in surface would scramble the branches)
function spreadLayer(R, pxF, pxS, view) {
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS, g = GAMMA[view], cg = Math.cos(g), sg = Math.sin(g);
  const out = new Uint8ClampedArray(W * H * 4), back = view === 'ne';
  for (let y = 0; y < H; y++) {
    let zs = 0, n = 0;
    for (let x = 0; x < W; x++) { const a = pxS[(y * W + x) * 4 + 3]; if (a > 40) { zs += (x + 0.5 - ax) * a; n += a; } }
    if (!n) continue;
    const zm = zs / n;
    for (let i = 0; i < W; i++) {
      const X = (i + 0.5 - ax - zm * sg) / cg, sx = ax + (back ? -X : X);
      if (sx < 0 || sx >= W) continue;
      const o = (y * W + Math.floor(sx)) * 4, q = (y * W + i) * 4;
      out[q] = pxF[o]; out[q + 1] = pxF[o + 1]; out[q + 2] = pxF[o + 2]; out[q + 3] = pxF[o + 3];
    }
  }
  return out;
}
// ears standing above the skull (fox, rabbit: spec.head.ears): the rows above the skull's top are leaned like antlers —
// the face-on drawing narrowed and moved to the side drawing's depth row by row (rows the side drawing misses take the
// nearest one), never laid on the stand-in head (that smeared the two pointed ears into soft lumps)
function skullTop(R) {
  const W = R.cw, ax = Math.round((R.pad + R.W / 2) * SS);
  for (let y = 0; y < R.ch; y++) for (const L of R.layers) for (let x = ax - 2; x <= ax + 2; x++) if (L.px[(y * W + x) * 4 + 3] > 60) return y;
  return -1;
}
function earRows(R, pxF, pxS, view, y1) {
  const W = R.cw, H = R.ch, ax = (R.pad + R.W / 2) * SS, g = GAMMA[view], cg = Math.cos(g), sg = Math.sin(g), back = view === 'ne';
  const out = new Uint8ClampedArray(W * H * 4), Zm = new Float32Array(y1 + 1).fill(NaN);
  for (let y = 0; y <= y1; y++) {
    let zs = 0, n = 0;
    for (let x = 0; x < W; x++) { const a = pxS[(y * W + x) * 4 + 3]; if (a > 40) { zs += (x + 0.5 - ax) * a; n += a; } }
    if (n) Zm[y] = zs / n;
  }
  let near = NaN;
  for (let y = y1; y >= 0; y--) { if (Number.isNaN(Zm[y])) Zm[y] = near; else near = Zm[y]; }
  for (let y = 0; y < y1; y++) {
    const zm = Number.isNaN(Zm[y]) ? 0 : Zm[y];
    for (let i = 0; i < W; i++) {
      const X = (i + 0.5 - ax - zm * sg) / cg, sx = ax + (back ? -X : X);
      if (sx < 0 || sx >= W) continue;
      const o = (y * W + Math.floor(sx)) * 4, q = (y * W + i) * 4;
      out[q] = pxF[o]; out[q + 1] = pxF[o + 1]; out[q + 2] = pxF[o + 2]; out[q + 3] = pxF[o + 3];
    }
  }
  return out;
}
// grazing: a raw side layer with the region R turned by ang about pv (design px; SS canvas with PAD), E erased
function bendRaw(c, B) {
  const out = canvas(c.width, c.height), g = out.getContext('2d'), k = SS, o = PAD * SS;
  const path = (gg, P) => { gg.beginPath(); P.forEach(([x, y], i) => (i ? gg.lineTo(x * k + o, y * k + o) : gg.moveTo(x * k + o, y * k + o))); gg.closePath(); };
  g.save(); g.beginPath(); g.rect(0, 0, c.width, c.height); B.R.slice().reverse().forEach(([x, y], i) => (i ? g.lineTo(x * k + o, y * k + o) : g.moveTo(x * k + o, y * k + o))); g.closePath(); g.clip('evenodd'); g.drawImage(c, 0, 0); g.restore();
  const px = B.pv[0] * k + o, py = B.pv[1] * k + o;
  g.save(); g.translate(px, py); g.rotate(B.ang); g.translate(-px, -py); path(g, B.R); g.clip(); g.drawImage(c, 0, 0); g.restore();
  if (B.E) { g.save(); g.globalCompositeOperation = 'destination-out'; path(g, B.E); g.fill(); g.restore(); }
  return out;
}
const clipTop = (c, y) => { const t = canvas(c.width, c.height), g = t.getContext('2d'); g.drawImage(c, 0, 0); g.clearRect(0, 0, c.width, y); return t; };

// the turned head: raw layers in a frame of the side box whose axis (W/2) is the head's vertical axis; hx = where the
// axis is in the side drawing; earY: the ears' rows end there (spec.head.ears)
function headQ(spec, view, hv = view) {
  const { W, H } = spec, Hd = spec.head;
  view = hv; // (a look-around head: its own angle — sl / nl, front drawing)
  const S0 = new Rec(W, H, PAD); Hd.side(S0, 0);
  const sb = bbox(S0);
  if (!sb) return null;
  const face = view === 'ne' ? Hd.back : Hd.front;
  const F0 = new Rec(W, H, PAD); face(F0, W / 2, H / 2, 1);
  const fb = bbox(F0);
  if (!fb) return null;
  const s = (sb[3] - sb[1]) / Math.max(1, fb[3] - fb[1]);
  const hw = ((fb[2] - fb[0]) * s) / 2, hx = sb[0] + hw;
  // face-on head: same height and rows as the side head, centred on the frame's axis
  const fy = (sb[1] + sb[3]) / 2 - ((fb[1] + fb[3]) / 2 - H / 2) * s;
  const F = new Rec(W, H, PAD, true); face(F, W / 2, fy, s);
  const S = new Rec(W, H, PAD, true); Hd.side(S, W / 2 - hx);
  let X = smoothE(extents(F, view === 'ne'), 3), Z = smoothE(extents(S), 3);
  X = stretch(X, Z); Z = stretch(Z, X);
  const n = Math.max(F.layers.length, S.layers.length), layers = [];
  const earY = Hd.ears ? skullTop(F) : -1, W4 = F.cw * 4;
  const toCanvas = (px) => { const c = canvas(F.cw, F.ch); c.getContext('2d').putImageData(new ImageData(px, F.cw, F.ch), 0, 0); return c; };
  for (let i = 0; i < n; i++) {
    const lf = F.layers[i], ls = S.layers[i], L = lf || ls, spread = (Hd.spread || []).includes(i);
    const px = spread && lf && ls ? spreadLayer(F, lf.px, ls.px, view) : projectLayer(F, lf ? lf.px : null, ls ? ls.px : null, X, Z, view, false);
    if (earY > 0 && lf && ls && !spread) {
      const pe = earRows(F, lf.px, ls.px, view, earY);
      if (view === 'ne') layers.push({ c: toCanvas(pe), ow: L.ow, col: L.col, opacity: L.opacity, spread: true }); // (over the swept back of the head)
      else { px.fill(0, 0, earY * W4); px.set(pe.subarray(0, earY * W4)); }
    }
    layers.push({ c: toCanvas(px), ow: L.ow, col: L.col, opacity: L.opacity, spread });
  }
  return { layers, hx, earY, yc: (sb[1] + sb[3]) / 2 };
}

// the parts that are the same in every frame of a species (body, tail, head) are kept, laid out, for the next frames
// painted with it (a few species, then dropped: the frames are asked for together)
const STATIC = new Map();
export function beast34(spec, view) {
  const g0 = GAMMA[view], cg = Math.cos(g0), sg = Math.sin(g0), k = spec.k ?? K_DEPTH, m = spec.m ?? 14;
  const { W, H, cx } = spec, Ho = H + m * 2;
  const B = spec.bend || null;
  const rec = (fn, bend = false) => { if (!fn) return null; const R = new Rec(W, H, PAD, true); fn(R); if (bend && B) for (const L of R.layers) L.c = bendRaw(L.c, B); return R; };
  const skey = spec.key ? spec.key + ':' + view + (B ? ':graze' : spec.look ? ':look' : '') : null;
  let cached = skey ? STATIC.get(skey) : null;
  const far = rec(spec.far), near = rec(spec.near);
  const body = cached ? null : rec(spec.body, true), top = cached ? null : rec(spec.top), tail = cached ? null : rec(spec.tail);
  // the head: turned from its face-on and side drawings coming toward the camera; going away (the face hidden) the
  // side drawing, swept across the head's width like the body (the back of the head, the near ear and cheek)
  // (going away, antlers still spread from the back drawing: they stand out of the head on both sides)
  const spreadN = spec.head && spec.head.spread && spec.head.spread.length;
  // (look-around: the head turned toward the camera — nearly face-on coming, its face half turned going away)
  const look = !!spec.look && !!spec.head;
  const head = !cached && spec.head && (cg >= 0 || spreadN || spec.head.ears || look) ? headQ(spec, view, look ? (cg >= 0 ? 'sl' : 'nl') : view) : null;
  const headS = !cached && spec.head && cg < 0 && !look ? rec((P) => spec.head.side(P, 0)) : null; // (bent below, after its ears are cut off)
  // grazing: the side plane's turn about the withers seen in the 3/4 box (A·R·A⁻¹ about the mapped pivot), for the
  // turned head (the swept body and side head were bent before the sweep)
  let HB = null;
  if (B) {
    const c = Math.cos(B.ang), s0 = Math.sin(B.ang), a = cg * k;
    const L = [c + s0 * a, (s0 * (1 + a * a)) / sg, -s0 * sg, c - a * s0]; // [m11, m21, m12, m22]
    const px = W / 2 + sg * (B.pv[0] - cx), py = m + B.pv[1] + a * (B.pv[0] - cx);
    HB = [L[0], L[1], L[2], L[3], px - L[0] * px - L[2] * py, py - L[1] * px - L[3] * py];
  }
  // side design (x, y) → 3/4 box, for a part at sideways offset X (+ = its left: the far flank)
  const T = (X) => [sg, cg * k, 0, 1, W / 2 + X * cg - cx * sg, m - X * sg * k - cx * cg * k];
  const draw = (lg, c, M, dx = 0, dy = 0) => { lg.save(); lg.transform(M[0], M[1], M[2], M[3], M[4], M[5]); lg.drawImage(c, -PAD + dx, -PAD + dy, c.width / SS, c.height / SS); lg.restore(); };
  const fo = spec.farOff || [0, 0];
  // a body copy scaled about the body's middle (lengthwise sl, upright sv) before the 3/4 transform
  const round = (M, sl, sv, x0, y0) => [M[0] * sl, M[1] * sl, M[2] * sv, M[3] * sv, M[4] + M[0] * x0 * (1 - sl) + M[2] * y0 * (1 - sv), M[5] + M[1] * x0 * (1 - sl) + M[3] * y0 * (1 - sv)];
  const rows = (R) => { const b = bbox(R); return b ? (b[1] + b[3]) / 2 : H / 2; };
  const parts = {
    far: (P) => { if (far) for (const L of far.layers) P.layer((lg) => draw(lg, L.c, T(spec.wl), -fo[0], -fo[1]), L.ow, L.col, L.opacity); },
    near: (P) => { if (near) for (const L of near.layers) P.layer((lg) => draw(lg, L.c, T(-spec.wl)), L.ow, L.col, L.opacity); },
    body: (P) => {
      // (the tail: one, in the middle — behind the body coming toward the camera, in front going away)
      const tails = () => { if (tail) for (const L of tail.layers) P.layer((lg) => draw(lg, L.c, T(0)), L.ow, L.col, L.opacity); };
      if (cg >= 0) tails();
      if (body) for (const L of body.layers) {
        const yb = rows(body), hump = spec.hump || 0;
        // copies about a pixel apart across the width (far half darker, smaller toward the far flank: a round back
        // and chest / rump, not a box): the near flank is the side drawing as painted. hump: the spine stands that
        // much above the flanks (a heavy round back: bear, boar), the copies inside softened and lit along the spine
        const sm = hump ? soft(L.c) : null;
        const dark = tint(sm || L.c, 0.2);
        // (soft copies: a few shades from lit along the spine to dark on the far flank)
        const SH = [-0.11, -0.06, 0, 0.06, 0.12, 0.2], shades = sm ? SH.map((a) => (a < 0 ? tint(sm, -a, '255,236,205') : a > 0 ? tint(sm, a) : sm)) : null;
        const shadeOf = (u) => { const v = 0.2 * Math.max(0, u) - 0.11 * Math.max(0, 1 - Math.abs(u + 0.15) * 1.6); let j = 0; for (let q = 1; q < SH.length; q++) if (Math.abs(SH[q] - v) < Math.abs(SH[j] - v)) j = q; return shades[j]; };
        const n = Math.max(3, Math.ceil((2 * spec.wb * Math.hypot(cg, sg * k)) / 0.8) + 1);
        P.layer((lg) => {
          for (let i = 0; i < n; i++) {
            const X = spec.wb * (1 - (2 * i) / (n - 1)), u = X / spec.wb, q = Math.sqrt(Math.max(0, 1 - u * u)), r = X > 0 ? q : 1;
            const M = round(T(X), 0.82 + 0.18 * r, 0.62 + 0.38 * r, cx, yb);
            M[5] -= hump * q;
            const src = i === n - 1 ? L.c : sm ? shadeOf(u) : X > 0.01 ? dark : L.c;
            draw(lg, src, M);
          }
        }, L.ow, L.col, L.opacity);
      }
      if (cg < 0) tails();
      if (top) for (const L of top.layers) P.layer((lg) => draw(lg, L.c, T(-spec.wb * 0.6)), L.ow, L.col, L.opacity);
    },
    head: (P) => {
      if (headS) {
        const hw = spec.hw ?? 5, n = Math.max(3, Math.ceil((2 * hw) / 0.8) + 1);
        for (const [i, L] of headS.layers.entries()) {
          if (spreadN && spec.head.spread.includes(i)) continue;
          let src = head && head.earY > 0 ? clipTop(L.c, head.earY) : L.c; // (the ears: leaned from the back drawing below, not swept)
          if (B) src = bendRaw(src, B);
          const dark = tint(src, 0.18);
          P.layer((lg) => { for (let i = 0; i < n; i++) { const X = hw * (1 - (2 * i) / (n - 1)); draw(lg, X > 0.01 ? dark : src, T(X)); } }, L.ow, L.col, L.opacity);
        }
      }
      if (!head) return;
      const z = head.hx - cx;
      let M = [1, 0, 0, 1, z * sg, m + z * cg * k];
      if (HB) {
        // grazing: the turned head goes where the neck takes it (its middle moved by the side plane's turn), but it
        // only rolls part of the way (a face-on head pitching down does not spin: the ears stay out to the sides)
        const hx0 = W / 2 + M[4], hy0 = head.yc + M[5], hx1 = HB[0] * hx0 + HB[2] * hy0 + HB[4], hy1 = HB[1] * hx0 + HB[3] * hy0 + HB[5];
        const ph = B.ang * 0.45 * (cg >= 0 ? 1 : 0.7), c = Math.cos(ph), sn = Math.sin(ph);
        M = [c, sn, -sn, c, hx1 - c * hx0 + sn * hy0 + M[4] * c - M[5] * sn, hy1 - sn * hx0 - c * hy0 + M[4] * sn + M[5] * c];
      }
      for (const L of head.layers) if (!headS || L.spread) P.layer((lg) => draw(lg, L.c, M), L.ow, L.col, L.opacity);
    },
  };
  if (skey && !cached) {
    // laid out once (raw layers in the 3/4 box), replayed by the other frames
    const lay = (fn) => { const R = new Rec(W, Ho, PAD, true, false); fn(R); return R.layers; };
    cached = { body: lay(parts.body), head: lay(parts.head) };
    STATIC.set(skey, cached);
    if (STATIC.size > 3) STATIC.delete(STATIC.keys().next().value);
  }
  if (cached) {
    const replay = (list) => (P) => { for (const L of list) P.layer((lg) => { lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(L.c, 0, 0); }, L.ow, L.col, L.opacity); };
    parts.body = replay(cached.body); parts.head = replay(cached.head);
  }
  // back to front: coming toward the camera the head is in front, going away it is behind the body (a head up on a
  // long neck stays over it: headOver)
  const order = cg >= 0 ? ['far', 'body', 'near', 'head'] : spec.headOver || look ? ['far', 'body', 'head', 'near'] : ['head', 'far', 'body', 'near'];
  return spritePxFast(W, Ho, (g, P) => { for (const p of order) parts[p](P); }, { pad: PAD });
}
// anchor (fractions of the nominal box) of a beast34 canvas
export const beast34Anchor = (spec) => [0.5, (spec.foot + (spec.m ?? 14)) / (spec.H + 2 * (spec.m ?? 14))];
