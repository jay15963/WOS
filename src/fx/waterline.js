// Water around the plants and stones standing in it (cosmetic: sync 'cosmetic', local only, never gameplay).
// The waterline itself (soft wavy cut, refraction, tint, bright lip) is done in the sprite shader for instances
// flagged with recvShadow < 0 (composeWorld.drawDecor: decor with d.w from worldgen; SPRITE_FS "WATER").
// This system adds, for the in-water decor in view (reeds, river stones, lily pads):
//  - slow ripple rings spreading (and wobbling) from each stem base, following the wind
//    (game.env.wind = { x, y, gust } from the environment pass);
//  - a short faded reflection of the stems in calm water (quality medium / high, weaker in rain);
//  - bigger rings + a sway kick (d._kick, read by drawDecor) when a pawn, animal or duck wades through a clump,
//    and wading rings behind anyone moving in shallow water (swimmers in deep water get theirs from compose.js).
// Everything is drawn in B.ground (on the water surface, under the stems), capped and culled to the view.

import { WATERLINE } from '../art/composeWorld.js';

const SCAN = 0.5;   // s between scans of the view
const TAU = Math.PI * 2;

export function installWaterline(game) {
  const sys = new Waterline(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed with the ambient one, before the gameplay registry (tagged above)
  game.waterline = sys;
  return sys;
}

class Waterline {
  constructor(game) {
    this.g = game;
    this.items = [];   // in-water decor in view (reused)
    this.kicked = [];  // decor with a decaying _kick
    this.rings = [];   // disturbance rings { x, y, t, life, s0, s1, a }
    this.scanT = 0;
    this.t = 0;
    const A = game.A;
    this.ring = A.has('fx_ripple') ? A.get('fx_ripple') : A.has('fx_ring') ? A.get('fx_ring') : null;
    this.kRing = this.ring ? 1 / Math.max(0.01, this.ring.w) : 1;
  }

  cap() { const q = this.g.quality; return q === 'low' ? 50 : q === 'medium' ? 100 : 150; }

  _scan(v) {
    const L = this.items, max = this.cap();
    L.length = 0;
    this.g.world.forChunks(v.x0 - 1, v.y0 - 1, v.x1 + 1, v.y1 + 2, (c) => {
      for (const d of c.decor) {
        if (!d.w || L.length >= max) continue;
        if (d.x < v.x0 - 1 || d.x > v.x1 + 1 || d.y < v.y0 - 0.5 || d.y > v.y1 + 1.5) continue;
        L.push(d);
      }
    });
  }

  _windNow() {
    const w = this.g.env?.wind;
    if (w && typeof w === 'object') return [Math.min(1.1, Math.hypot(w.x, w.y)), w.x, w.y];
    const e = this.g.env?.env;
    const s = e?.wind || 0, d = e?.windDir || [1, 0];
    return [s, d[0] * s, d[1] * s];
  }

  update(g, dt) {
    if (!this.ring) return;
    this.t += dt;
    const v = g.view(), w = g.world;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = SCAN; this._scan(v); }
    // waders: pawns, animals and ducks moving through the water
    const wade = (x, y, e, deep) => {
      if (x < v.x0 - 1 || x > v.x1 + 1 || y < v.y0 - 1 || y > v.y1 + 2) return;
      // wading rings (swimmers in deep water already get theirs from compose.js)
      if (!deep && e._wr <= 0 && this.rings.length < 36) { e._wr = 0.32; this.rings.push({ x, y: y + 0.02, t: 0, life: 1.5, s0: 0.2, s1: 1.0, a: 0.42 }); }
      for (const d of this.items) {
        if (Math.abs(d.x - x) < 0.6 && Math.abs(d.y - y) < 0.45) {
          if (!d._kick) this.kicked.push(d);
          d._kick = 1;
        }
      }
    };
    for (const e of g.entities) {
      if (e.dead) continue;
      const wv = w.waterAt(Math.floor(e.x), Math.floor(e.y));
      if (!wv) continue;
      e._wr = (e._wr || 0) - dt; // ring timer runs while in the water
      const mv = e.moving || Math.hypot(e.x - (e._wx ?? e.x), e.y - (e._wy ?? e.y)) > 0.004;
      e._wx = e.x; e._wy = e.y;
      if (mv) wade(e.x, e.y, e, wv === 2);
    }
    const W = g.wildlife;
    if (W) for (const c of W.list) if (c.kind === 'duck' && c.st === 0 && c.a > 0.5) {
      const mv = Math.hypot(c.x - (c._wx ?? c.x), c.y - (c._wy ?? c.y)) > 0.004;
      c._wx = c.x; c._wy = c.y;
      if (mv) for (const d of this.items) if (Math.abs(d.x - c.x) < 0.5 && Math.abs(d.y - c.y) < 0.35) { if (!d._kick) this.kicked.push(d); d._kick = 1; }
    }
    // decay
    for (let k = this.kicked.length - 1; k >= 0; k--) {
      const d = this.kicked[k];
      d._kick = Math.max(0, d._kick - dt * 0.6);
      if (d._kick <= 0) { d._kick = 0; this.kicked[k] = this.kicked[this.kicked.length - 1]; this.kicked.pop(); }
    }
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.t += dt;
      if (r.t >= r.life) { this.rings[k] = this.rings[this.rings.length - 1]; this.rings.pop(); }
    }
  }

  render(g, B, v, env) {
    if (!this.ring) return;
    const t = this.t, R = this.ring, K = this.kRing;
    const [wind, wx, wy] = this._windNow();
    const rain = env?.rain || 0;
    const refl = g.quality !== 'low';
    const calm = 1 - Math.min(1, Math.max(0, (wind - 0.3) / 0.6));
    const ra = 0.5 + 0.5 * (env?.day ?? 1); // rings read a bit weaker at night (the lighting pass darkens them too)
    for (const d of this.items) {
      const ph = d.x * 1.71 + d.y * 2.37, kick = d._kick || 0, s = d.s || 1;
      const lily = d.t === 'lily', stone = d.t === 'riverstone';
      // drift of the rings with the wind (water surface moves down-wind a little)
      const dx = wx * 0.05, dy = wy * 0.03;
      const n = lily ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const u = (t * (0.2 + 0.2 * wind) + ph + k * 0.5) % 1;
        const sz = (lily ? 0.55 : stone ? 0.4 : 0.42) + u * (0.45 + 0.3 * wind + kick * 0.7);
        const a = (1 - u) * Math.min(1, u * 4) * (lily ? 0.3 : 0.55 + 0.2 * wind) * (1 + kick * 0.8) * ra;
        const wob = Math.sin(t * (1.4 + wind) + ph + k) * (0.015 + 0.025 * wind + kick * 0.04);
        B.ground.add(R, d.x + dx * u + wob, d.y + 0.02 + dy * u, sz * s * K, sz * s * K, 1, 1, 1, a, 0, 0, 0, 1, 1);
      }
      if (lily) continue;
      // short faded reflection of the stems (calm water, medium / high quality)
      if (refl && !stone && d._s && calm > 0.05) {
        const a = 0.55 * calm * (1 - rain * 0.75) * (1 - kick * 0.6);
        if (a > 0.02) B.ground.add(d._s, d.x, d.y - WATERLINE * 0.6, s, -s * 0.6, 0.6, 0.7, 0.75, a, 0, 0, 0, d.f, -3); // mirrored at the waterline (d.y)
      }
    }
    for (const r of this.rings) {
      const u = r.t / r.life, sz = (r.s0 + (r.s1 - r.s0) * Math.sqrt(u)) * K;
      B.ground.add(R, r.x, r.y, sz, sz, 1, 1, 1, r.a * (1 - u) * ra, 0, 0, 0, 1, 1);
    }
  }
}
