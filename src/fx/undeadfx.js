// The night's dead of the warm lands (docs/NIGHT-DEAD.md, game/undead.js), the look around them — cosmetic, on every
// client (host and guests see the same replicated entities, so it works the same everywhere):
//   - skeletons: now and then a pale wisp curling up from the eye sockets, a little bone dust where they step;
//     mummies: sand trickling from their wraps, a puff of dust at their feet as they shuffle
//   - a faint glow around them in the dark (pale green for the bones, amber for the wrapped), like the walkers' cold one
//   - when one dies (its replicated `dead` flag turns on — killed, or at sunrise): a skeleton falls apart (art/deadRig.js
//     drops the bones) with chips of bone flying and a puff of dust, the clatter of bones; a mummy pours into sand —
//     grains streaming down from where its body was, a dust cloud, the hiss of sand (bigger for the giants)
//   - one that vanishes in plain view without dying (a despawn) bursts the same way
// Nothing here touches game state.

import { SPECIES } from '../game/data.js';

const rnd = Math.random;
const TAU = Math.PI * 2;
const COL = {
  bone: { glow: [0.55, 1, 0.65], dust: [0.86, 0.83, 0.74], chip: [0.94, 0.9, 0.78], wisp: [0.7, 1, 0.75] },
  sand: { glow: [1, 0.72, 0.32], dust: [0.88, 0.76, 0.52], chip: [0.95, 0.82, 0.55], wisp: [1, 0.85, 0.5] },
};

export function installUndeadFx(game) {
  const sys = new UndeadFx(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed before the gameplay registry (tagged above)
  game.undeadFx = sys;
  return sys;
}

class UndeadFx {
  constructor(game) {
    this.g = game;
    this.recs = new Map();   // entity id → { x, y, f, born, dead, inner, t, sc, fam, big }
    this.frame = 0;
    this.list = [];          // live ones in view (render: their glow at night)
    this.stats = { bone: 0, sand: 0 }; // collapses seen (tests: the bones / the sand at sunrise)
    const A = game.A;
    const pick = (...n) => n.find((k) => A && A.has(k)) || 'fx_soft';
    this.spr = { soft: pick('fx_smoke', 'fx_soft'), spark: pick('fx_spark', 'fx_soft'), chip: pick('fx_chip', 'fx_spark'), dust: pick('fx_dust', 'fx_smoke'), ring: pick('fx_ring', 'fx_soft') };
    this.K = {};
    for (const k in this.spr) { const s = A && A.has(this.spr[k]) ? A.get(this.spr[k]) : null; this.K[k] = s ? 1 / Math.max(0.01, s.w) : 1; }
  }

  update(g, dt) {
    const f = ++this.frame, list = this.list;
    list.length = 0;
    if (g.headless) return;
    const v = g.view(), P = g.particles, K = this.K, S = this.spr;
    const low = g.quality === 'low', night = g.env?.env?.night || 0;
    for (const e of g.entities) {
      const sp = SPECIES[e.species], fam = sp?.undead;
      if (fam !== 'bone' && fam !== 'sand') continue; // (the walkers / ice giant: fx/walkerfx.js)
      const big = !!sp.giant, sc = big ? 2.4 : 1;
      const key = e.id ?? e;
      let r = this.recs.get(key);
      if (!r) { r = { x: e.x, y: e.y, f, born: f, dead: !!e.dead, inner: false, t: rnd(), sc, fam, big }; this.recs.set(key, r); }
      r.f = f; r.x = e.x; r.y = e.y;
      const inView = e.x > v.x0 - 2 && e.x < v.x1 + 2 && e.y > v.y0 - 1 && e.y < v.y1 + 3;
      r.inner = e.x > v.x0 + 1 && e.x < v.x1 - 1 && e.y > v.y0 + 0.8 && e.y < v.y1 - 0.3;
      if (e.dead) {
        if (!r.dead) { r.dead = true; if (inView) this.collapse(g, e.x, e.y, fam, big); }
        // the mummy keeps pouring for a moment
        if (fam === 'sand' && inView && (e.deadT || 0) < (big ? 1.6 : 1.1) && rnd() < (low ? 0.4 : 0.9)) this.pour(g, e.x, e.y, big, e.deadT || 0);
        continue;
      }
      r.dead = false;
      if (!inView) continue;
      list.push(e);
      r.t -= dt;
      if (r.t > 0) continue;
      const C = COL[fam];
      if (fam === 'bone') {
        r.t = (e.moving ? 0.22 : 0.5) * (low ? 2 : 1) * (big ? 0.6 : 1);
        // bone dust where it steps; at night a pale wisp from the sockets
        if (e.moving) P.emit({ spr: S.dust, x: e.x + (rnd() - 0.5) * 0.4 * sc, y: e.y + (rnd() - 0.3) * 0.12, lift: 0.02, vx: (rnd() - 0.5) * 0.4, vy: (rnd() - 0.5) * 0.12, vlift: 0.15,
          drag: 2, life: 0.6 + rnd() * 0.4, size: 0.2 * K.dust * sc, size1: 0.55 * K.dust * sc, r: C.dust[0], g: C.dust[1], b: C.dust[2], a: 0.35, a1: 0, ground: false });
        if (night > 0.2 && !low && rnd() < 0.5) P.emit({ spr: S.spark, x: e.x + (rnd() - 0.5) * 0.25 * sc, y: e.y + 0.01, lift: (big ? 2.7 : 0.85) + rnd() * 0.1, vlift: 0.25 + rnd() * 0.2, vx: (rnd() - 0.5) * 0.15, drag: 0.6,
          life: 0.8 + rnd() * 0.6, size: 0.06 * K.spark * (big ? 1.6 : 1), size1: 0.015 * K.spark, r: C.wisp[0], g: C.wisp[1], b: C.wisp[2], a: 0.8 * night, a1: 0, layer: 'emissive', ground: false });
      } else {
        r.t = (e.moving ? 0.12 : 0.35) * (low ? 2 : 1) * (big ? 0.6 : 1);
        // sand trickling from the wraps (falling grains), a puff of dust at the shuffling feet
        P.emit({ spr: S.chip, x: e.x + (rnd() - 0.5) * 0.45 * sc, y: e.y + 0.02, lift: (0.25 + rnd() * 0.5) * sc, vx: (rnd() - 0.5) * 0.1, vy: 0, vlift: -0.2, grav: 5, drag: 0.4,
          life: 0.5 + rnd() * 0.3, size: 0.05 * K.chip * (big ? 1.6 : 1), size1: 0.04 * K.chip, r: C.chip[0], g: C.chip[1], b: C.chip[2], a: 0.9, a1: 0.4, ground: false });
        if (e.moving) P.emit({ spr: S.dust, x: e.x + (rnd() - 0.5) * 0.4 * sc, y: e.y + (rnd() - 0.3) * 0.12, lift: 0.02, vx: (rnd() - 0.5) * 0.35, vy: (rnd() - 0.5) * 0.12, vlift: 0.12,
          drag: 2, life: 0.8 + rnd() * 0.5, size: 0.25 * K.dust * sc, size1: 0.7 * K.dust * sc, r: C.dust[0], g: C.dust[1], b: C.dust[2], a: 0.32, a1: 0, ground: false });
      }
    }
    // gone without dying while well in view (a despawn): the same burst where it stood
    for (const [k, r] of this.recs) {
      if (r.f === f) continue;
      if (!r.dead && r.inner && f - r.born > 30) this.collapse(g, r.x, r.y, r.fam, r.big);
      this.recs.delete(k);
    }
  }

  // a skeleton falls apart (bone chips, dust, the clatter) / a mummy pours into sand (a dust cloud, the hiss)
  collapse(g, x, y, fam, big) {
    const P = g.particles, K = this.K, S = this.spr, C = COL[fam], sc = big ? 2.4 : 1;
    this.stats[fam]++;
    if (fam === 'bone') {
      for (let i = 0; i < 12 * (big ? 2 : 1); i++) {
        const a = rnd() * TAU, sp = (0.6 + rnd() * 1.8) * Math.sqrt(sc);
        P.emit({ spr: S.chip, x: x + Math.cos(a) * 0.1 * sc, y: y + Math.sin(a) * 0.05 * sc, lift: (0.2 + rnd() * 0.6) * sc, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5,
          vlift: 1 + rnd() * 2, grav: 9, drag: 0.6, bounce: 0.35, life: 0.9 + rnd() * 0.8, hold: 0.6, size: (0.07 + rnd() * 0.07) * K.chip * (big ? 1.6 : 1), size1: 0.04 * K.chip,
          rot: rnd() * TAU, vr: (rnd() - 0.5) * 14, r: C.chip[0], g: C.chip[1], b: C.chip[2], a: 1, a1: 0 });
      }
    } else {
      for (let i = 0; i < 10 * (big ? 2 : 1); i++) {
        const a = rnd() * TAU, sp = (0.2 + rnd() * 0.7) * sc;
        P.emit({ spr: S.dust, x: x + Math.cos(a) * 0.2 * sc, y: y + Math.sin(a) * 0.08 * sc, lift: (0.3 + rnd() * 0.8) * sc, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4, vlift: -0.1 + rnd() * 0.2,
          drag: 1.4, life: 1.4 + rnd() * 0.9, size: 0.35 * K.dust * sc, size1: (1 + rnd() * 0.5) * K.dust * sc, r: C.dust[0], g: C.dust[1], b: C.dust[2], a: 0.55, a1: 0, fadeIn: 0.05, ground: false });
      }
    }
    for (let i = 0; i < 6 * sc; i++) {
      const a = rnd() * TAU, sp = (0.3 + rnd() * 0.6) * sc;
      P.emit({ spr: S.dust, x: x + (rnd() - 0.5) * 0.3 * sc, y: y + (rnd() - 0.5) * 0.1 * sc, lift: 0.05 + rnd() * 0.3 * sc, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4, vlift: 0.2 + rnd() * 0.3,
        drag: 1.4, life: 1.2 + rnd() * 0.8, size: 0.3 * K.dust * sc, size1: (1 + rnd() * 0.5) * K.dust * sc, r: C.dust[0], g: C.dust[1], b: C.dust[2], a: 0.5, a1: 0, fadeIn: 0.05, ground: false });
    }
    P.emit({ spr: S.ring, x, y, life: 0.8, size: 0.2 * K.ring, size1: 1.3 * K.ring * sc, r: C.dust[0], g: C.dust[1], b: C.dust[2], a: 0.45, a1: 0 });
    if (big) g.juice?.shake?.(0.25);
    g.audio?.play(fam === 'bone' ? 'bones_fall' : 'sand_pour', { x, y, volume: big ? 1 : 0.8 });
  }

  // grains of sand streaming down from where the mummy's body was (k: how far it has sunk)
  pour(g, x, y, big, k) {
    const P = g.particles, K = this.K, C = COL.sand, sc = big ? 2.4 : 1, h = (1.1 - k) * (big ? 2.8 : 1);
    P.emit({ spr: this.spr.chip, x: x + (rnd() - 0.5) * 0.5 * sc, y: y + 0.03, lift: Math.max(0.1, h * rnd()), vx: (rnd() - 0.5) * 0.3, vy: 0, vlift: -0.4, grav: 7, drag: 0.3,
      life: 0.45 + rnd() * 0.3, size: 0.06 * K.chip * (big ? 1.7 : 1), size1: 0.05 * K.chip, r: C.chip[0], g: C.chip[1], b: C.chip[2], a: 1, a1: 0.5, ground: false });
  }

  // a faint glow around them in the dark: pale green (bones), amber (wraps)
  render(g, B) {
    const night = g.env?.env?.night || 0;
    if (night < 0.05) return;
    for (const e of this.list) {
      const sp = SPECIES[e.species], c = COL[sp.undead].glow, big = sp.giant;
      const [ux, uy] = g.toWorldDir ? g.toWorldDir(0, big ? -1.6 : -0.55) : [0, big ? -1.6 : -0.55];
      const R = big ? 5.5 : 2.4;
      B.light.addRaw(e.x + ux, e.y + uy, R, R, c[0], c[1], c[2], (big ? 0.42 : 0.32) * night);
    }
  }
}
