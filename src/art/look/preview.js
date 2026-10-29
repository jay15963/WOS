// Canvas2D preview of a pawn through the game's own compose pipeline (agent H): compose.drawPawn() writes
// sprite instances into a fake batch set, and drawPawn2D() replays them on a 2D canvas with the same
// transform rules as the sprite shader (anchor, scale, rotation, lift, mirrored texture, multiply tint).
// Sprites come from a PreviewAtlas: look parts painted lazily at k× (hipaint.js), so the menu avatar and
// the creator are sharp and available before the game atlas exists. Base parts the look system does not
// own (weapons, fx…) are invisible stand-ins here.

import { drawPawn } from '../compose.js';
import { lookDefs } from './index.js';
import { hiCanvas } from './hipaint.js';

const NONE = { name: '', canvas: null, w: 0.01, h: 0.01, ax: 0.5, ay: 1, u0: 0, v0: 0, u1: 0, v1: 0 };

export class PreviewAtlas {
  constructor(k = 3) {
    this.k = k; this.defs = lookDefs(); this.sprites = new Map(); this.list = []; this.groups = {}; this.size = 0;
    this.painted = 0;
  }
  has(name) { return this.defs.has(name); }
  get(name) {
    let s = this.sprites.get(name);
    if (s) return s;
    const def = this.defs.get(name);
    if (!def) return NONE;
    const A = this;
    // geometry is known without painting; the canvas is painted on first draw
    const pad = def.pad ?? 10;
    s = {
      name, _c: null, _tint: new Map(), w: ((def.W + pad * 2) * A.k) / (64 * A.k), h: ((def.H + pad * 2) * A.k) / (64 * A.k),
      ax: (def.ax * def.W + pad) / (def.W + pad * 2), ay: (def.ay * def.H + pad) / (def.H + pad * 2),
      get canvas() { if (!this._c) { this._c = hiCanvas(def, A.k).canvas; A.painted++; } return this._c; },
    };
    this.sprites.set(name, s);
    return s;
  }
  // paint (synchronously) the given sprite names now, e.g. during idle time
  warm(names) { for (const n of names) { const s = this.get(n); if (s !== NONE) void s.canvas; } }
}

// multiply-tinted copy (cached per sprite + colour)
function tinted(s, r, g, b) {
  if (r > 0.995 && g > 0.995 && b > 0.995) return s.canvas;
  const key = ((r * 255) | 0) * 65536 + ((g * 255) | 0) * 256 + ((b * 255) | 0);
  const T = s._tint || (s._tint = new Map());
  let c = T.get(key);
  if (c) return c;
  const src = s.canvas;
  c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0);
  if (T.size > 24) T.delete(T.keys().next().value);
  T.set(key, c);
  return c;
}

class Batch2D {
  constructor() { this.items = []; }
  add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0) {
    if (s && s !== NONE && s.name) this.items.push([s, x, y, sx, sy, r, g, b, a, rot, flip, lift]);
  }
}
const SINK = { add() {} };
const BATCHES = { main: new Batch2D(), blob: SINK, shadow: SINK, emissive: SINK, fx: SINK, decor: SINK, light: SINK, ground: SINK, decal: SINK };

// draw pawn p (world units) so that its feet land at canvas px (cx, cy), `scale` px per tile
export function drawPawn2D(ctx, A, p, t, cx, cy, scale, { shadow = true } = {}) {
  const B = BATCHES.main;
  B.items.length = 0;
  drawPawn(BATCHES, A, p, t);
  if (shadow) {
    ctx.save();
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.42);
    gr.addColorStop(0, 'rgba(0,0,0,0.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.translate(cx, cy); ctx.scale(1, 0.42); ctx.translate(-cx, -cy);
    ctx.beginPath(); ctx.arc(cx, cy, scale * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const it of B.items) {
    const [s, x, y, sx, sy, r, g, b, a, rot, flip, lift] = it;
    const img = tinted(s, r, g, b);
    const w = s.w * sx * scale, h = s.h * sy * scale;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx + (x - p.x) * scale, cy + (y - p.y - lift) * scale);
    if (rot) ctx.rotate(rot);
    if (flip < 0) { ctx.scale(-1, 1); ctx.drawImage(img, (s.ax - 1) * w, -s.ay * h, w, h); }
    else ctx.drawImage(img, -s.ax * w, -s.ay * h, w, h);
    ctx.restore();
  }
  return B.items.length;
}

// a stand-in pawn for previews
export function previewPawn(look) {
  return { isEntity: true, kind: 'pawn', id: 1, x: 0, y: 0, facing: 's', moving: false, moveT: 0, action: null, flash: 0, look, weapon: null, offhand: null, armor: null, hp: 1, maxHp: 1 };
}

// the game atlas seen as a preview atlas (sprites sliced from the packed canvas on first use): lets previews
// show equipment / weapons drawn by the game (gallery checks, in-game editor)
export function atlasView(A) {
  const cache = new Map();
  return {
    k: 1, list: [], groups: {},
    has: (n) => A.has(n),
    get(n) {
      let s = cache.get(n);
      if (s) return s;
      if (!A.has(n)) return NONE;
      const r = A.get(n);
      s = {
        ...r, _c: null, _tint: new Map(),
        get canvas() {
          if (!this._c) { const c = document.createElement('canvas'); c.width = r.pw; c.height = r.ph; c.getContext('2d').drawImage(A.canvas, r.u0 * A.size, r.v0 * A.size, r.pw, r.ph, 0, 0, r.pw, r.ph); this._c = c; }
          return this._c;
        },
      };
      cache.set(n, s);
      return s;
    },
  };
}
