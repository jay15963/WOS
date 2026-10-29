// Vegetation parting around walkers (cosmetic, local; positions of remote players and creatures are already
// replicated, so every peer sees the same thing). Each frame it feeds the renderer up to 12 pushers
// (x, y, radius, strength) used by the shared sway function in the sprite / shadow shaders: grass tufts,
// tall grass, flowers, ferns, reeds and crops bend away from players, creatures and ground critters, and a
// spring point lagging behind every walker (under-damped) pulls them back past neutral — the recoil /
// overshoot after someone passes. Swimming pawns push the reeds too. Walking through lush plants sheds a few
// seeds, petals and leaf bits (capped, density × quality).

import { qualityPreset } from './quality.js';

const rnd = Math.random;
const MAXP = 12;
const CRITTERS = new Set(['rabbit', 'frog', 'bird', 'squirrel', 'duck']);
const BRUSHY = new Set(['grass', 'tallgrass', 'drygrass', 'flower', 'bloom', 'reed', 'fern', 'heather', 'thistle']);
const PETAL = { flower: 1, bloom: 1, heather: 1, thistle: 1 };
const PETAL_COL = [[1, 0.78, 0.88], [1, 0.97, 0.92], [1, 0.9, 0.45], [0.85, 0.72, 1]];

export function installBrush(game) {
  const sys = new Brush(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system (renderer uniforms + particles), tagged above
  game.brush = sys;
  return sys;
}

class Brush {
  constructor(game) {
    this.g = game;
    this.st = new WeakMap();        // walker -> spring trail { x, y, vx, vy, cx, cy }
    this.arr = new Float32Array(MAXP * 4);
    this.n = 0;
    this.cand = [];
    this.budget = 0;                // rustle particles allowed right now (refills ~25/s)
    this.sprLeaf = null;
  }

  _walkers(g, v) {
    const L = this.cand;
    L.length = 0;
    const p = g.player, cx = g.cam.x, cy = g.cam.y;
    const add = (e, r, s, kind) => {
      if (e.x < v.x0 - 2 || e.x > v.x1 + 2 || e.y < v.y0 - 2 || e.y > v.y1 + 3) return;
      L.push({ e, r, s, kind, d: e === p ? -1 : (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy) });
    };
    for (const e of g.entities) {
      if (e.dead || e.hidden) continue;
      if (e.kind === 'pawn') add(e, 0.75, 1, 'pawn');
      else add(e, Math.min(1.3, Math.max(0.45, (e.r || 0.3) * 2.2 * (e.scale || 1))), 0.9, 'mob');
    }
    const W = g.wildlife;
    if (W && W.list) for (const c of W.list) if (CRITTERS.has(c.kind) && !c.dead && (c.lift || 0) < 0.1 && (c.a ?? 1) > 0.2) add(c, 0.34, 0.6, 'critter');
    L.sort((a, b) => a.d - b.d);
    return L;
  }

  update(g, dt) {
    const v = g.view(), L = this._walkers(g, v), k = Math.min(dt, 0.05);
    this.budget = Math.min(25, this.budget + dt * 25 * qualityPreset().fx);
    for (const c of L) {
      const e = c.e;
      let s = this.st.get(e);
      if (!s) { s = { x: e.x, y: e.y, vx: 0, vy: 0, cx: 0, cy: 0 }; this.st.set(e, s); }
      if (Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > 3) { s.x = e.x; s.y = e.y; s.vx = s.vy = 0; } // teleport / respawn
      // under-damped spring (ω ≈ 5.5 rad/s, ζ ≈ 0.36): lags behind, overshoots, settles
      s.vx += ((e.x - s.x) * 30 - s.vx * 4) * k; s.vy += ((e.y - s.y) * 30 - s.vy * 4) * k;
      s.x += s.vx * k; s.y += s.vy * k;
      if (c.kind !== 'critter' && e.moving !== false) this._rustle(g, e, s);
    }
  }

  // a few seeds / petals / leaf bits when a walker enters a new half-tile cell among lush plants
  _rustle(g, e, s) {
    const cx = Math.round(e.x * 2), cy = Math.round(e.y * 2);
    if (cx === s.cx && cy === s.cy) return;
    s.cx = cx; s.cy = cy;
    if (this.budget < 1 || !(Math.abs(s.vx) + Math.abs(s.vy) > 0.3)) return;
    const w = g.world, x = e.x, y = e.y, A = g.A, P = g.particles;
    const leaf = this.sprLeaf || (this.sprLeaf = A.get(A.has('fx_leaf') ? 'fx_leaf' : 'fx_soft'));
    const soft = this.sprSoft || (this.sprSoft = A.get('fx_soft'));
    const env = g.env.env, wx = (g.env.wind?.x || 0) * 0.4, wy = (g.env.wind?.y || 0) * 0.25;
    w.forChunks(x - 0.6, y - 0.6, x + 0.6, y + 0.6, (ch) => {
      for (const d of ch.decor) {
        if (this.budget < 1) return;
        if (Math.abs(d.x - x) > 0.55 || Math.abs(d.y - y) > 0.4 || !BRUSHY.has(d.t) || rnd() > 0.45) continue;
        this.budget -= 1;
        const petal = PETAL[d.t], sp = petal ? soft : leaf, sz = petal ? 0.06 : 0.075;
        // petals keep the flower's colour; grass sheds pale seed fluff and green bits
        const tint = petal ? PETAL_COL[(d.v || 0) & 3] : rnd() < 0.5 ? [1.05, 1.0, 0.7] : [0.85, 1.05, 0.6];
        const a = rnd() * Math.PI * 2;
        P.emit({ spr: sp.name || (petal ? 'fx_soft' : 'fx_leaf'), x: d.x + (rnd() - 0.5) * 0.2, y: d.y, lift: 0.12 + rnd() * 0.25, vlift: 0.35 + rnd() * 0.45,
          vx: Math.cos(a) * 0.35 + s.vx * 0.15 + wx, vy: Math.sin(a) * 0.2 + s.vy * 0.1 + wy, grav: 0.55, drag: 1.4, life: 1.1 + rnd() * 0.9,
          size: sz / sp.w, size1: sz * 0.7 / sp.w, rot: rnd() * 6.28, vr: (rnd() - 0.5) * 6, r: tint[0], g: tint[1], b: tint[2], a: env.night > 0.5 ? 0.55 : 0.9, a1: 0 });
      }
    });
  }

  // feed the shaders (called each frame right before the renderer draws)
  render(g) {
    const L = this.cand, a = this.arr;
    let n = 0;
    const put = (x, y, r, s) => { if (n >= MAXP) return; const o = n * 4; a[o] = x; a[o + 1] = y; a[o + 2] = r; a[o + 3] = s; n++; };
    // walkers first (nearest to the camera), then the recoil points of the nearest ones
    for (const c of L) put(c.e.x, c.e.y + 0.02, c.r, c.s);
    for (const c of L) {
      const s = this.st.get(c.e);
      if (!s) continue;
      const lag = Math.hypot(s.x - c.e.x, s.y - c.e.y);
      if (lag > 0.04) put(s.x, s.y, c.r * 0.9, -0.4 * c.s * Math.min(1, lag / 0.35));
    }
    this.n = n;
    g.R.setPushers?.(a, n);
  }
}
