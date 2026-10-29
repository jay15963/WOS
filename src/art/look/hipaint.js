// Look part definitions → canvases, at atlas resolution (spritePxFast, 1× PPU) or k× for the big previews of
// the character creator. Both run the very same painter: def.paint(P) only uses P.layer(fn, ow, col, opacity)
// with coordinates in the part's nominal 1× box, so the preview is the in-game sprite, just sharper.
//   def = { W, H, ax, ay, pad, paint(P) }  (ax, ay = anchor in the nominal box, like atlas add())

import { spritePxFast, OW, OUT, PPU, TAU } from '../paint.js';

export function atlasCanvas(def) {
  return spritePxFast(def.W, def.H, (g, P) => def.paint(P), { pad: def.pad ?? 10 });
}

function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
const ringCache = new Map();
// integer dilation taps covering a disc of radius R (device px), dense enough for large radii
function taps(R) {
  const key = Math.round(R * 4);
  let o = ringCache.get(key);
  if (o) return o;
  o = [];
  const seen = new Set();
  const push = (x, y) => { const k = x + ',' + y; if ((x || y) && !seen.has(k)) { seen.add(k); o.push([x, y]); } };
  for (let r = R; r > 0.9; r -= 2.2) {
    const n = Math.max(8, Math.ceil((TAU * r) / 1.6));
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; push(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)); }
  }
  ringCache.set(key, o);
  return o;
}
const colAlpha = (col) => { const m = /rgba\(([^)]+)\)/.exec(col); if (!m) return [col, 1]; const v = m[1].split(','); return [`rgb(${v[0]},${v[1]},${v[2]})`, +v[3]]; };

class HiPainter {
  constructor(W, H, k, pad) {
    this.k = k; this.pad = pad;
    this.c = cnv((W + pad * 2) * k, (H + pad * 2) * k);
    this.g = this.c.getContext('2d');
    this.tmp = null;
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
      const t = this.tmp || (this.tmp = cnv(c.width, c.height)), tg = t.getContext('2d');
      tg.globalCompositeOperation = 'source-over';
      tg.clearRect(0, 0, t.width, t.height);
      tg.imageSmoothingEnabled = false;
      for (const [dx, dy] of taps(ow * k)) tg.drawImage(L, dx, dy);
      const [cc, a] = colAlpha(col);
      tg.globalCompositeOperation = 'source-atop';
      tg.fillStyle = cc; tg.fillRect(0, 0, t.width, t.height);
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
