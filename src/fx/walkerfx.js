// Winter walkers (species 'walker', "Andarilho do Gelo"), the look around them — cosmetic, on every client (host
// and guests see the same replicated entities, so it works the same everywhere):
//   - a cold mist trailing at their feet with frost glints; a faint cold glow around them at night
//   - when one dies (its replicated `dead` flag turns on) it shatters: ice shards, glints, a puff of snow and an icy
//     crack ('ice_shatter') — art/compose.js draws no body for a dead walker
//   - one that vanishes in plain view without dying (it crumbles at sunrise / despawns) bursts into snow
// Nothing here touches game state.

const rnd = Math.random;
const TAU = Math.PI * 2;

export function installWalkerFx(game) {
  const sys = new WalkerFx(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed before the gameplay registry (tagged above)
  game.walkerFx = sys;
  return sys;
}

class WalkerFx {
  constructor(game) {
    this.g = game;
    this.recs = new Map();   // entity id → { x, y, f (last frame seen), born, dead, inner, mist }
    this.frame = 0;
    this.list = [];          // live walkers in view (render: night glow)
    const A = game.A;
    const pick = (...n) => n.find((k) => A && A.has(k)) || 'fx_soft';
    this.spr = { soft: pick('fx_smoke', 'fx_soft'), spark: pick('fx_spark', 'fx_soft'), shard: pick('fx_shard', 'fx_spark'), dust: pick('fx_dust', 'fx_smoke'), ring: pick('fx_ring', 'fx_soft'), star: pick('fx_star', 'fx_spark') };
    this.K = {};
    for (const k in this.spr) { const s = A && A.has(this.spr[k]) ? A.get(this.spr[k]) : null; this.K[k] = s ? 1 / Math.max(0.01, s.w) : 1; }
  }

  update(g, dt) {
    const f = ++this.frame, list = this.list;
    list.length = 0;
    if (g.headless) return;
    const v = g.view(), P = g.particles, K = this.K, S = this.spr, env = g.env.env;
    const low = g.quality === 'low';
    for (const e of g.entities) {
      if (e.species !== 'walker') continue;
      const key = e.id ?? e;
      let r = this.recs.get(key);
      if (!r) { r = { x: e.x, y: e.y, f, born: f, dead: !!e.dead, inner: false, mist: 0 }; this.recs.set(key, r); }
      r.f = f; r.x = e.x; r.y = e.y;
      const inView = e.x > v.x0 - 1 && e.x < v.x1 + 1 && e.y > v.y0 - 1 && e.y < v.y1 + 2;
      r.inner = e.x > v.x0 + 1 && e.x < v.x1 - 1 && e.y > v.y0 + 0.8 && e.y < v.y1 - 0.3;
      if (e.dead) {
        if (!r.dead) { r.dead = true; if (inView) this.shatter(g, e.x, e.y, true); }
        continue;
      }
      r.dead = false;
      if (!inView) continue;
      list.push(e);
      // cold mist curling around the feet, a few frost glints rising from it
      r.mist -= dt;
      if (r.mist <= 0) {
        r.mist = (e.moving ? 0.08 : 0.17) * (low ? 2 : 1);
        const wx = env.windDir[0] * env.wind * 0.25;
        // on the ground layer (under the body: it never veils the walker), plus a faint wisp in front of the feet
        P.emit({ spr: S.soft, x: e.x + (rnd() - 0.5) * 0.5, y: e.y + (rnd() - 0.3) * 0.16, lift: 0, vx: wx + (rnd() - 0.5) * 0.25, vy: (rnd() - 0.5) * 0.1,
          drag: 0.9, life: 1.6 + rnd() * 0.9, size: 0.35 * K.soft, size1: (0.85 + rnd() * 0.35) * K.soft,
          r: 0.82, g: 0.93, b: 1, a: 0.34, a1: 0, fadeIn: 0.3, layer: 'blob', ground: false });
        if (rnd() < 0.4) P.emit({ spr: S.soft, x: e.x + (rnd() - 0.5) * 0.4, y: e.y + 0.08 + rnd() * 0.08, lift: 0, vx: wx + (rnd() - 0.5) * 0.2, vy: 0.04,
          drag: 0.9, life: 1.2 + rnd() * 0.6, size: 0.2 * K.soft, size1: 0.45 * K.soft, r: 0.85, g: 0.94, b: 1, a: 0.12, a1: 0, fadeIn: 0.25, ground: false });
        if (!low && rnd() < 0.3) P.emit({ spr: S.spark, x: e.x + (rnd() - 0.5) * 0.5, y: e.y + 0.02, lift: 0.15 + rnd() * 0.6, vlift: 0.12, drag: 0.5,
          life: 0.7 + rnd() * 0.5, size: 0.07 * K.spark, size1: 0.02 * K.spark, r: 0.6, g: 0.92, b: 1, a: 0.85, a1: 0, layer: 'emissive', ground: false });
      }
    }
    // gone without dying while well in view (crumbled at sunrise / despawned): a burst of snow where it stood
    for (const [k, r] of this.recs) {
      if (r.f === f) continue;
      if (!r.dead && r.inner && f - r.born > 30) this.shatter(g, r.x, r.y, false);
      this.recs.delete(k);
    }
  }

  // ice shards flying apart and tinkling down, glints, a snow puff and a frost ring on the ground
  shatter(g, x, y, crack) {
    const P = g.particles, K = this.K, S = this.spr;
    if (crack) {
      for (let i = 0; i < 16; i++) {
        const a = rnd() * TAU, sp = 0.8 + rnd() * 2.2;
        P.emit({ spr: S.shard, x: x + Math.cos(a) * 0.12, y: y + Math.sin(a) * 0.05, lift: 0.25 + rnd() * 0.65, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55,
          vlift: 1.4 + rnd() * 2.4, grav: 8.5, drag: 0.6, bounce: 0.3, life: 1.1 + rnd() * 0.9, hold: 0.65, size: (0.1 + rnd() * 0.12) * K.shard, size1: 0.06 * K.shard,
          rot: rnd() * TAU, vr: (rnd() - 0.5) * 16, r: 0.9 + rnd() * 0.1, g: 0.97, b: 1, a: 0.95, a1: 0 });
      }
      for (let i = 0; i < 10; i++) {
        const a = rnd() * TAU, sp = 0.4 + rnd() * 1.4;
        P.emit({ spr: S.spark, x, y, lift: 0.3 + rnd() * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vlift: 0.6 + rnd() * 1.4, grav: 2, drag: 1.2,
          life: 0.5 + rnd() * 0.6, size: 0.12 * K.spark, size1: 0.03 * K.spark, r: 0.55, g: 0.9, b: 1, a: 1, a1: 0, layer: 'emissive', ground: false });
      }
      P.emit({ spr: S.ring, x, y, life: 0.9, size: 0.2 * K.ring, size1: 1.5 * K.ring, r: 0.85, g: 0.95, b: 1, a: 0.55, a1: 0 });
      g.audio?.play?.('ice_shatter', { x, y });
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU, sp = 0.3 + rnd() * 0.7;
      P.emit({ spr: S.dust, x: x + (rnd() - 0.5) * 0.3, y: y + (rnd() - 0.5) * 0.1, lift: 0.1 + rnd() * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4, vlift: 0.25 + rnd() * 0.3,
        drag: 1.4, life: 1.3 + rnd() * 0.8, size: 0.35 * K.dust, size1: (1.1 + rnd() * 0.5) * K.dust, r: 0.92, g: 0.96, b: 1, a: 0.55, a1: 0, fadeIn: 0.05, ground: false });
    }
    if (!crack) g.audio?.play?.('step_snow', { x, y, volume: 0.8 });
  }

  // a faint cold glow around them in the dark
  render(g, B) {
    const night = g.env.env.night || 0;
    if (night < 0.05) return;
    const [ux, uy] = g.toWorldDir ? g.toWorldDir(0, -0.55) : [0, -0.55]; // (up the screen, camera turned or not)
    for (const e of this.list) B.light.addRaw(e.x + ux, e.y + uy, 2.6, 2.6, 0.45, 0.8, 1, 0.38 * night);
  }
}
