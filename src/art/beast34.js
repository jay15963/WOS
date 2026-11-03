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
//            head?: { side(P, dx), front(P, x, y, s), back(P, x, y, s), spread?: [layer i] }  side head (shifted by
//                   dx) / face-on heads; spread: thin branching layers (antlers) leaned instead of laid on the head
//            headOver?, k?, m? }  (headOver: going away the head stays over the body — a long neck)     depth shear (default 0.22), margin above and below (default 14)

import { SS, canvas, spritePxFast } from './paint.js';
import { Rec, extents, smoothE, projectLayer, stretch, GAMMA } from './look/turn.js';

const PAD = 12;
const K_DEPTH = 0.22; // (the front / back art draws the body's length about this short)

const tint = (c, a) => { const t = canvas(c.width, c.height), g = t.getContext('2d'); g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(16,10,6,${a})`; g.fillRect(0, 0, t.width, t.height); return t; };
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
// the turned head: raw layers in a frame of the side box whose axis (W/2) is the head's vertical axis; hx = where the
// axis is in the side drawing
function headQ(spec, view) {
  const { W, H } = spec, Hd = spec.head;
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
  for (let i = 0; i < n; i++) {
    const lf = F.layers[i], ls = S.layers[i], L = lf || ls;
    const px = (Hd.spread || []).includes(i) && lf && ls ? spreadLayer(F, lf.px, ls.px, view) : projectLayer(F, lf ? lf.px : null, ls ? ls.px : null, X, Z, view, false);
    const c = canvas(F.cw, F.ch);
    c.getContext('2d').putImageData(new ImageData(px, F.cw, F.ch), 0, 0);
    layers.push({ c, ow: L.ow, col: L.col, opacity: L.opacity });
  }
  if (globalThis.B34_DEBUG) globalThis.B34_DEBUG.push({ F, S, layers, s, hx, sb, fb });
  return { layers, hx };
}

export function beast34(spec, view) {
  const g0 = GAMMA[view], cg = Math.cos(g0), sg = Math.sin(g0), k = spec.k ?? K_DEPTH, m = spec.m ?? 14;
  const { W, H, cx } = spec, Ho = H + m * 2;
  const rec = (fn) => { if (!fn) return null; const R = new Rec(W, H, PAD, true); fn(R); return R; };
  const far = rec(spec.far), near = rec(spec.near), body = rec(spec.body), top = rec(spec.top), tail = rec(spec.tail);
  // the head: turned from its face-on and side drawings coming toward the camera; going away (the face hidden) the
  // side drawing, swept across the head's width like the body (the back of the head, the near ear and cheek)
  const head = spec.head && cg >= 0 ? headQ(spec, view) : null;
  const headS = spec.head && cg < 0 ? rec((P) => spec.head.side(P, 0)) : null;
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
        const dark = tint(L.c, 0.2), yb = rows(body);
        // copies about a pixel apart across the width (far half darker, smaller toward the far flank: a round back
        // and chest / rump, not a box): the near flank is the side drawing as painted
        const n = Math.max(3, Math.ceil((2 * spec.wb * Math.hypot(cg, sg * k)) / 0.8) + 1);
        P.layer((lg) => {
          for (let i = 0; i < n; i++) {
            const X = spec.wb * (1 - (2 * i) / (n - 1)), r = X > 0 ? Math.sqrt(Math.max(0, 1 - (X / spec.wb) ** 2)) : 1;
            draw(lg, X > 0.01 ? dark : L.c, round(T(X), 0.82 + 0.18 * r, 0.62 + 0.38 * r, cx, yb));
          }
        }, L.ow, L.col, L.opacity);
      }
      if (cg < 0) tails();
      if (top) for (const L of top.layers) P.layer((lg) => draw(lg, L.c, T(-spec.wb * 0.6)), L.ow, L.col, L.opacity);
    },
    head: (P) => {
      if (headS) {
        const hw = spec.hw ?? 5, n = Math.max(3, Math.ceil((2 * hw) / 0.8) + 1);
        for (const L of headS.layers) {
          const dark = tint(L.c, 0.18);
          P.layer((lg) => { for (let i = 0; i < n; i++) { const X = hw * (1 - (2 * i) / (n - 1)); draw(lg, X > 0.01 ? dark : L.c, T(X)); } }, L.ow, L.col, L.opacity);
        }
      }
      if (!head) return;
      const z = head.hx - cx, M = [1, 0, 0, 1, z * sg, m + z * cg * k];
      for (const L of head.layers) P.layer((lg) => draw(lg, L.c, M), L.ow, L.col, L.opacity);
    },
  };
  // back to front: coming toward the camera the head is in front, going away it is behind the body (a head up on a
  // long neck stays over it: headOver)
  const order = cg >= 0 ? ['far', 'body', 'near', 'head'] : spec.headOver ? ['far', 'body', 'head', 'near'] : ['head', 'far', 'body', 'near'];
  return spritePxFast(W, Ho, (g, P) => { for (const p of order) parts[p](P); }, { pad: PAD });
}
// anchor (fractions of the nominal box) of a beast34 canvas
export const beast34Anchor = (spec) => [0.5, (spec.foot + (spec.m ?? 14)) / (spec.H + 2 * (spec.m ?? 14))];
