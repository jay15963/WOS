// Look part definitions → canvases, at atlas resolution (spritePxFast, 1× PPU) or k× for the big previews of
// the character creator. Both run the very same painter: def.paint(P) only uses P.layer(fn, ow, col, opacity)
// with coordinates in the part's nominal 1× box, so the preview is the in-game sprite, just sharper.
//   def = { W, H, ax, ay, pad, paint(P) }  (ax, ay = anchor in the nominal box, like atlas add())

import { spritePxFast, OW, OUT, PPU } from '../paint.js';

export function atlasCanvas(def) {
  return spritePxFast(def.W, def.H, (g, P) => def.paint(P), { pad: def.pad ?? 10 });
}

function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
// Dilation of a layer's alpha by a disc of radius R (device px), as a chain of small octagon dilations
// (Minkowski sums add up: 1 + 2 + 4 + … = R): ~9 blits per pass instead of hundreds of taps at large k.
const OCT = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
function dilate(src, R, A, B) {
  const steps = [];
  for (let s = 1, sum = 0; sum < R - 0.01; s *= 2) { const st = Math.min(s, R - sum); steps.push(st); sum += st; }
  let from = src, to = A;
  for (let i = 0; i < steps.length; i++) {
    const g = to.getContext('2d'), st = steps[i];
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, to.width, to.height);
    g.drawImage(from, 0, 0);
    for (const [dx, dy] of OCT) g.drawImage(from, dx * st, dy * st);
    from = to; to = to === A ? B : A;
  }
  return from;
}
const colAlpha = (col) => { const m = /rgba\(([^)]+)\)/.exec(col); if (!m) return [col, 1]; const v = m[1].split(','); return [`rgb(${v[0]},${v[1]},${v[2]})`, +v[3]]; };

class HiPainter {
  constructor(W, H, k, pad) {
    this.k = k; this.pad = pad;
    this.c = cnv((W + pad * 2) * k, (H + pad * 2) * k);
    this.g = this.c.getContext('2d');
    this.tmp = null; this.tmp2 = null;
  }
  layer(fn, ow = OW, col = OUT, opacity = 1) {
    const { c, k, pad } = this;
    const L = cnv(c.width, c.height), lg = L.getContext('2d');
    lg.lineJoin = 'round'; lg.lineCap = 'round';
    lg.setTransform(k, 0, 0, k, pad * k, pad * k);
    fn(lg);
    const g = this.g;
    g.save();
    g.globalAlpha = opacity;
    if (ow > 0) {
      const A = this.tmp || (this.tmp = cnv(c.width, c.height)), B = this.tmp2 || (this.tmp2 = cnv(c.width, c.height));
      const t = dilate(L, ow * k, A, B), tg = t.getContext('2d');
      const [cc, a] = colAlpha(col);
      tg.globalCompositeOperation = 'source-atop';
      tg.fillStyle = cc; tg.fillRect(0, 0, t.width, t.height);
      tg.globalCompositeOperation = 'source-over';
      g.globalAlpha = opacity * a;
      g.drawImage(t, 0, 0);
      g.globalAlpha = opacity;
    }
    g.drawImage(L, 0, 0);
    g.restore();
  }
}

// k× canvas of a part + its anchor (fractions of the canvas) and size in tiles
export function hiCanvas(def, k) {
  const pad = def.pad ?? 10;
  const P = new HiPainter(def.W, def.H, k, pad);
  def.paint(P);
  const c = P.c;
  return { canvas: c, ax: (def.ax * def.W + pad) / (def.W + pad * 2), ay: (def.ay * def.H + pad) / (def.H + pad * 2), w: c.width / (PPU * k), h: c.height / (PPU * k) };
}
