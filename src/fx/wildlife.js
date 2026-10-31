// Cosmetic wildlife (sync: 'cosmetic' — local only, Math.random is fine, never feeds gameplay):
// butterflies of several kinds and bees on the flowers, dragonflies over the water, frogs on the banks
// (they hop into the water), duck families on still water, fish shadows, squirrels that run up the trees,
// songbirds that land, hop and peck, and little rabbits that dart into the bushes. Everything flees from
// players (local and remote pawns), is capped per kind (fewer on low quality), spawned only around the view
// and removed once off-screen. Critters are y-sorted with the world through `collect` (objects with draw()).
// Sprites: src/art/critters.js (cr_*), rabbits reuse rabbit_e / rabbit_e_walk.

import { installWaterline } from './waterline.js';
import { SEASON } from '../art/season.js';

const rnd = Math.random;
const TAU = Math.PI * 2;
const SCAN = 0.8; // s between habitat scans

// per-kind caps (high quality); low ×0.5, medium ×0.8
// seasons (art/season.js): no insects or frogs in the cold, fewer in autumn; ducks and fish only on open water;
// fewer birds, squirrels and rabbits about in the snow
function seasonCap(kind) {
  const S = SEASON, cold = Math.max(S.winter, S.snow);
  if (kind === 'butterfly' || kind === 'bee' || kind === 'dragonfly' || kind === 'frog') return (1 - cold) * (1 - 0.6 * S.autumn);
  if (kind === 'duck' || kind === 'fish') return 1 - S.ice;
  if (kind === 'bird' || kind === 'squirrel' || kind === 'rabbit') return 1 - 0.5 * cold;
  return 1;
}
const CAP = { butterfly: 10, bee: 7, dragonfly: 5, frog: 6, duck: 7, fish: 6, squirrel: 3, bird: 8, rabbit: 3 };
const FLOWERS = new Set(['flower', 'bloom', 'heather', 'thistle']);
const TREE_OK = new Set(['tree_oak', 'tree_pine', 'tree_birch']);

class Critter {
  constructor(sys, kind) { this.sys = sys; this.kind = kind; this.y = 0; this.x = 0; this.lift = 0; this.a = 0; this.t = 0; this.dead = false; }
  draw(B, A, t) { this.sys._draw(B, this, t); }
}

export function installWildlife(game) {
  const sys = new Wildlife(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed with the ambient one, before the gameplay registry (tagged above)
  game.wildlife = sys;
  installWaterline(game); // ripples / reflections around the plants standing in water
  return sys;
}

class Wildlife {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.n = {};
    for (const k in CAP) this.n[k] = 0;
    this.flowers = []; this.lilies = []; this.trees = []; this.bushes = [];
    this.pl = []; // player positions (reused)
    this.scanT = 0;
    this.t = 0;
    this.dLand = null; // distance to land for water tiles (lazy)
    const A = game.A;
    const S = (n) => (A.has(n) ? A.get(n) : null);
    this.S = {
      bf: [0, 1, 2, 3, 4].map((i) => S('cr_butterfly_' + i)), bee: S('cr_bee'), df: [S('cr_dragonfly_0'), S('cr_dragonfly_1')],
      frog: [S('cr_frog_0'), S('cr_frog_1')], frogJump: S('cr_frog_jump'),
      duck: [S('cr_duck_0'), S('cr_duck_1')], duckFly: S('cr_duck_fly'), duckling: S('cr_duckling'), fish: S('cr_fish'),
      sq: { sit: S('cr_squirrel_sit'), run: S('cr_squirrel_run'), climb: S('cr_squirrel_climb') },
      bird: [0, 1, 2].map((i) => ({ sit: S(`cr_bird_${i}_sit`), peck: S(`cr_bird_${i}_peck`), fly: S(`cr_bird_${i}_fly`) })),
      rab: S('rabbit_e'), rabRun: S('rabbit_e_walk') || S('rabbit_e'),
      blob: S('fx_blob'), ring: S('fx_ring') || S('fx_soft'), spark: S('fx_spark') || S('fx_soft'),
    };
    this.ok = !!(this.S.bf[0] && this.S.blob);
    this.kBlob = this.S.blob ? 1 / Math.max(0.01, this.S.blob.w) : 1;
    this.kRing = this.S.ring ? 1 / Math.max(0.01, this.S.ring.w) : 1;
    this.kSpark = this.S.spark ? 1 / Math.max(0.01, this.S.spark.w) : 1;
  }

  // ---------------------------------------------------------------- helpers
  capOf(kind) {
    const q = this.g.quality;
    return Math.round(CAP[kind] * (q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1) * seasonCap(kind));
  }
  add(kind, props) {
    if (this.n[kind] >= this.capOf(kind)) return null;
    if (props.x != null && this.g.world.roofAt?.(Math.floor(props.x), Math.floor(props.y)) === 2) return null; // never indoors (built roofs)
    const c = new Critter(this, kind);
    Object.assign(c, props);
    c.t = 0; c.a = 0; c.ph = rnd() * TAU;
    this.list.push(c);
    this.n[kind]++;
    return c;
  }
  // nearest player distance from (x, y); sets this.px / this.py
  near(x, y) {
    let best = 1e9;
    for (let i = 0; i < this.pl.length; i += 2) {
      const dx = this.pl[i] - x, dy = this.pl[i + 1] - y, d = dx * dx + dy * dy;
      if (d < best) { best = d; this.px = this.pl[i]; this.py = this.pl[i + 1]; }
    }
    return Math.sqrt(best);
  }
  water(x, y) { return this.g.world.waterAt(Math.floor(x), Math.floor(y)); }
  landOk(x, y) {
    const w = this.g.world, tx = Math.floor(x), ty = Math.floor(y);
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    return !w.rock[i] && !w.water[i] && !w.solid[i];
  }
  stillWater(x, y) {
    const w = this.g.world, tx = Math.floor(x), ty = Math.floor(y);
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    return w.water[i] > 0 && Math.abs(w.flowX[i]) + Math.abs(w.flowY[i]) < 0.25;
  }
  landDist(x, y) {
    const w = this.g.world;
    if (!this.dLand) {
      // chamfer distance from land, computed once (water never changes at runtime)
      const W = w.W, H = w.H, d = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) d[i] = w.water[i] ? 1e9 : 0;
      for (let pass = 0; pass < 2; pass++) {
        const fwd = pass === 0;
        for (let yy = fwd ? 0 : H - 1; fwd ? yy < H : yy >= 0; yy += fwd ? 1 : -1) for (let xx = fwd ? 0 : W - 1; fwd ? xx < W : xx >= 0; xx += fwd ? 1 : -1) {
          const i = yy * W + xx, s = fwd ? -1 : 1;
          let v = d[i];
          const nx = xx + s, ny = yy + s;
          if (nx >= 0 && nx < W) v = Math.min(v, d[i + s] + 1);
          if (ny >= 0 && ny < H) { v = Math.min(v, d[i + s * W] + 1); if (nx >= 0 && nx < W) v = Math.min(v, d[i + s * W + s] + 1.414); }
          d[i] = v;
        }
      }
      this.dLand = d;
    }
    const tx = Math.floor(x), ty = Math.floor(y);
    return w.inBounds(tx, ty) ? this.dLand[w.idx(tx, ty)] : 0;
  }

  // ---------------------------------------------------------------- scan
  _scan(v) {
    const w = this.g.world;
    const F = this.flowers, L = this.lilies, T = this.trees, Bu = this.bushes;
    F.length = 0; L.length = 0; T.length = 0; Bu.length = 0;
    w.forChunks(v.x0 - 2, v.y0 - 2, v.x1 + 2, v.y1 + 3, (c) => {
      for (const d of c.decor) {
        if (d.x < v.x0 - 1 || d.x > v.x1 + 1 || d.y < v.y0 - 1 || d.y > v.y1 + 1.5) continue;
        if (FLOWERS.has(d.t)) { if (F.length < 240) F.push(d); }
        else if (d.t === 'lily' && L.length < 60) L.push(d);
      }
      for (const o of c.objects) {
        if (o.x < v.x0 - 2 || o.x > v.x1 + 2 || o.y < v.y0 - 1 || o.y > v.y1 + 3) continue;
        if (TREE_OK.has(o.type) && !o.stump && !o.fall && (o.age ?? 1) >= 1 && T.length < 120) T.push(o);
        else if ((o.type === 'bush' || o.type === 'berrybush' || o.type === 'herbbush') && Bu.length < 60) Bu.push(o);
      }
    });
  }

  // random point in the view rect (+ margin)
  _rp(v, m = 0) { return [v.x0 - m + rnd() * (v.x1 - v.x0 + 2 * m), v.y0 - m + rnd() * (v.y1 - v.y0 + 2 * m)]; }

  _spawn(v, env) {
    const w = this.g.world;
    const day = env.day * (1 - env.rain), calm = 1 - Math.max(0, env.wind - 0.6) * 2;
    const dusk = Math.max(0, 1 - Math.abs(env.hour - 19) / 2.5) + Math.max(0, 1 - Math.abs(env.hour - 6) / 2);
    // butterflies & bees on the flowers (warm, calm, dry day)
    if (this.flowers.length && day > 0.45 && calm > 0.4) {
      const wantB = Math.min(this.capOf('butterfly'), 1 + Math.round(this.flowers.length / 12));
      if (this.n.butterfly < wantB && rnd() < 0.5) {
        const f = this.flowers[Math.floor(rnd() * this.flowers.length)];
        if (this.near(f.x, f.y) > 3) {
          const r = rnd();
          this.add('butterfly', { x: f.x + (rnd() - 0.5) * 4, y: f.y + (rnd() - 0.5) * 3, lift: 0.6, tx: f.x, ty: f.y, st: 0, rest: 0, life: 25 + rnd() * 30,
            v: r < 0.32 ? 0 : r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4, sp: 0.8 + rnd() * 0.5, s: 0.75 + rnd() * 0.25 });
        }
      }
      const wantBee = Math.min(this.capOf('bee'), Math.round(this.flowers.length / 15));
      if (this.n.bee < wantBee && rnd() < 0.5) {
        const f = this.flowers[Math.floor(rnd() * this.flowers.length)];
        if (this.near(f.x, f.y) > 2.5) this.add('bee', { x: f.x, y: f.y, lift: 0.35, tx: f.x, ty: f.y, st: 0, rest: 0.5, life: 18 + rnd() * 20, hx: f.x, hy: f.y });
      }
    }
    // water: dragonflies, frogs, ducks, fish
    for (let tries = 0; tries < 6; tries++) {
      const [x, y] = this._rp(v, 1);
      const wv = this.water(x, y);
      if (!wv) {
        // a frog on the bank (land right next to the water)
        if (this.n.frog < this.capOf('frog') && (day > 0.2 || dusk > 0.3) && rnd() < 0.35 + env.rain * 0.4 + dusk * 0.3) {
          const tx = Math.floor(x), ty = Math.floor(y);
          if (this.landOk(x, y) && w.dWater && w.dWater[w.idx(tx, ty)] <= 1.05 && this.near(x, y) > 3.5) this.add('frog', { x, y, st: 0, v: rnd() < 0.6 ? 0 : 1, flip: rnd() < 0.5 ? -1 : 1, life: 40 + rnd() * 40, hopT: 2 + rnd() * 5 });
        }
        continue;
      }
      const shore = this.landDist(x, y);
      if (this.n.dragonfly < this.capOf('dragonfly') && day > 0.4 && calm > 0.5 && shore <= 2.5 && rnd() < 0.4 && this.near(x, y) > 2.5) {
        this.add('dragonfly', { x, y, lift: 0.7 + rnd() * 0.3, tx: x, ty: y, st: 0, hov: 1 + rnd() * 2, v: rnd() < 0.5 ? 0 : 1, rot: rnd() * TAU, life: 25 + rnd() * 25 });
      }
      if (wv === 2 && this.n.fish < this.capOf('fish') && rnd() < 0.3 && this.near(x, y) > 3) {
        this.add('fish', { x, y, h: rnd() * TAU, sp: 0.25 + rnd() * 0.3, life: 30 + rnd() * 40, s: 0.7 + rnd() * 0.6 });
      }
      if (this.n.duck === 0 && this.stillWater(x, y) && shore >= 1.5 && day > 0.25 && rnd() < 0.25 && this.near(x, y) > 6) {
        const n = rnd() < 0.4 ? 0 : 1 + Math.floor(rnd() * 3);
        const h = rnd() * TAU;
        const mom = this.add('duck', { x, y, h, sp: 0.18, st: 0, v: rnd() < 0.5 ? 0 : 1, lead: null, life: 120, wakeT: 0 });
        let prev = mom;
        for (let k = 0; k < n && mom; k++) {
          const d = this.add('duck', { x: x - Math.cos(h) * 0.35 * (k + 1), y: y - Math.sin(h) * 0.35 * (k + 1), h, sp: 0.18, st: 0, v: 2, lead: prev, life: 120 });
          if (d) prev = d;
        }
        if (mom && n === 0 && rnd() < 0.5) { const d2 = this.add('duck', { x: x + 0.5, y: y + 0.2, h, sp: 0.18, st: 0, v: mom.v ? 0 : 1, lead: mom, life: 120 }); if (d2) d2.pair = true; }
      }
    }
    // squirrels around the trees in the woods
    if (this.trees.length > 4 && this.n.squirrel < this.capOf('squirrel') && day > 0.3 && rnd() < 0.25) {
      const o = this.trees[Math.floor(rnd() * this.trees.length)];
      const x = o.x + (rnd() - 0.5) * 2, y = o.y + 0.3 + rnd() * 0.8;
      if (this.landOk(x, y) && this.near(x, y) > 4.5) this.add('squirrel', { x, y, st: 0, tx: x, ty: y, hopT: 1 + rnd() * 2, flip: rnd() < 0.5 ? -1 : 1, tree: null, life: 40 + rnd() * 30 });
    }
    // songbirds landing on open ground (meadows, clearings, banks)
    if (this.n.bird < this.capOf('bird') - 2 && day > 0.35 && env.rain < 0.4 && rnd() < 0.18) {
      const [x, y] = this._rp(v, -1);
      const tx = Math.floor(x), ty = Math.floor(y);
      if (this.landOk(x, y) && w.lush && w.lush[w.idx(tx, ty)] > 0.25 && this.near(x, y) > 5.5) {
        const n = 1 + Math.floor(rnd() * 3), v0 = Math.floor(rnd() * 3), from = rnd() * TAU;
        for (let k = 0; k < n; k++) {
          const bx = x + (rnd() - 0.5) * 1.6, by = y + (rnd() - 0.5) * 1.0;
          if (!this.landOk(bx, by)) continue;
          this.add('bird', { x: bx + Math.cos(from) * 3, y: by + Math.sin(from) * 3, gx: bx, gy: by, lift: 2.6, st: 0, v: rnd() < 0.7 ? v0 : Math.floor(rnd() * 3), flip: Math.cos(from) > 0 ? -1 : 1, hopT: 1, peck: 0, life: 18 + rnd() * 25, delay: k * 0.25 });
        }
      }
    }
    // rabbits nibbling in the meadows near bushes / tall grass
    if (this.S.rab && this.n.rabbit < this.capOf('rabbit') && (day > 0.3 || dusk > 0.4) && rnd() < 0.12) {
      const [x, y] = this._rp(v, -1);
      const tx = Math.floor(x), ty = Math.floor(y);
      const b = w.biome ? w.biome[w.idx(tx, ty)] : 0;
      if (this.landOk(x, y) && (b === 0 || b === 3) && w.lush[w.idx(tx, ty)] > 0.4 && this.near(x, y) > 6) this.add('rabbit', { x, y, st: 0, flip: rnd() < 0.5 ? -1 : 1, hopT: 1 + rnd() * 3, life: 30 + rnd() * 30 });
    }
  }

  // ---------------------------------------------------------------- update
  update(g, dt) {
    if (!this.ok) return;
    this.t += dt;
    const env = g.env.env, v = g.view();
    // player positions (local + remote pawns)
    const pl = this.pl;
    pl.length = 0;
    for (const e of g.entities) if (e.kind === 'pawn' && !e.dead) pl.push(e.x, e.y);
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = SCAN; this._scan(v); this._spawn(v, env); }
    const L = this.list;
    for (let k = L.length - 1; k >= 0; k--) {
      const c = L[k];
      c.t += dt;
      if (c.t < c.life && seasonCap(c.kind) < 0.05) c.t = c.life; // out of season (insects in the cold, ducks on the ice)
      this['_' + c.kind](c, dt, env);
      const out = c.x < v.x0 - 7 || c.x > v.x1 + 7 || c.y < v.y0 - 7 || c.y > v.y1 + 8;
      if (c.dead || out || (c.t > c.life && c.a <= 0.01)) {
        L[k] = L[L.length - 1]; L.pop();
        this.n[c.kind]--;
        continue;
      }
      // fade in, fade out at the end of life (unless a state already drives alpha)
      if (!c.fading) c.a = Math.min(1, c.a + dt * 1.5) * (c.t > c.life ? 0.96 : 1);
      if (c.t > c.life && !c.fading) c.a -= dt;
    }
  }

  _toward(c, tx, ty, sp, dt) {
    const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
    if (d < 1e-4) return 0;
    const s = Math.min(d, sp * dt);
    c.x += (dx / d) * s; c.y += (dy / d) * s;
    return d;
  }
  _flee(c, dist) { // target `dist` tiles away from the nearest player
    const dx = c.x - this.px, dy = c.y - this.py, d = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx) + (rnd() - 0.5) * 0.8;
    c.tx = c.x + Math.cos(a) * dist; c.ty = c.y + Math.sin(a) * dist;
    return d;
  }
  _pickFlower(c, R) {
    const F = this.flowers;
    for (let k = 0; k < 4 && F.length; k++) {
      const f = F[Math.floor(rnd() * F.length)];
      if (Math.abs(f.x - c.x) < R && Math.abs(f.y - c.y) < R) { c.tx = f.x; c.ty = f.y; return true; }
    }
    c.tx = c.x + (rnd() - 0.5) * 4; c.ty = c.y + (rnd() - 0.5) * 3;
    return false;
  }

  _butterfly(c, dt, env) {
    if (c.st !== 2 && this.near(c.x, c.y) < 1.4) { c.st = 2; c.rest = 0; this._flee(c, 4); c.ft = 1.6; }
    if (c.st === 2) { // fleeing: fast and high
      c.ft -= dt;
      this._toward(c, c.tx, c.ty, 2.6, dt);
      c.lift += (1.2 - c.lift) * dt * 2;
      if (c.ft <= 0) { c.st = 0; this._pickFlower(c, 6); }
    } else if (c.rest > 0) {
      c.rest -= dt;
      c.lift += (0.16 - c.lift) * Math.min(1, dt * 4);
      if (c.rest <= 0) this._pickFlower(c, 5);
    } else {
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < 0.12) { c.rest = rnd() < 0.6 ? 1.2 + rnd() * 3 : 0; if (!c.rest) this._pickFlower(c, 5); }
      else {
        const wob = Math.sin(this.t * 6 + c.ph) * 0.9;
        c.x += (dx / d * c.sp + wob * -dy / d * 0.6 + env.windDir[0] * env.wind * 0.35) * dt;
        c.y += (dy / d * c.sp + wob * dx / d * 0.6 + env.windDir[1] * env.wind * 0.2) * dt;
        c.lift += (0.5 + Math.sin(this.t * 2.3 + c.ph) * 0.25 - c.lift) * dt * 2;
      }
    }
    if (env.day < 0.25 || env.rain > 0.3) c.t = Math.max(c.t, c.life);
  }

  _bee(c, dt, env) {
    if (this.near(c.x, c.y) < 0.9 && c.st !== 2) { c.st = 2; this._flee(c, 2.5); c.ft = 0.8; }
    if (c.st === 2) { c.ft -= dt; this._toward(c, c.tx, c.ty, 3, dt); if (c.ft <= 0) { c.st = 0; this._pickFlower(c, 3); } }
    else if (c.rest > 0) {
      c.rest -= dt;
      c.lift += (0.2 - c.lift) * Math.min(1, dt * 5);
      if (c.rest <= 0) this._pickFlower(c, 3);
    } else {
      const d = this._toward(c, c.tx + Math.sin(this.t * 9 + c.ph) * 0.12, c.ty + Math.cos(this.t * 7 + c.ph) * 0.08, 1.6, dt);
      c.lift += (0.35 + Math.sin(this.t * 11 + c.ph) * 0.06 - c.lift) * dt * 4;
      if (d < 0.1) c.rest = 0.5 + rnd() * 1.6;
    }
    if (env.day < 0.3 || env.rain > 0.3) c.t = Math.max(c.t, c.life);
  }

  _dragonfly(c, dt, env) {
    if (this.near(c.x, c.y) < 1.7 && c.st !== 2) { c.st = 2; this._flee(c, 3.5); }
    if (c.st === 0) { // hovering
      c.hov -= dt;
      c.x += Math.sin(this.t * 13 + c.ph) * 0.06 * dt; c.y += Math.cos(this.t * 11 + c.ph) * 0.05 * dt;
      if (c.hov <= 0) {
        for (let k = 0; k < 5; k++) {
          const a = rnd() * TAU, r = 0.8 + rnd() * 2;
          const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
          if (this.water(x, y) || this.landDist(x, y) <= 0) { c.tx = x; c.ty = y; c.st = 1; break; }
        }
        c.hov = 0.8 + rnd() * 2.2;
      }
    } else {
      const dx = c.tx - c.x, dy = c.ty - c.y;
      c.rot = Math.atan2(dy, dx) + Math.PI / 2;
      const d = this._toward(c, c.tx, c.ty, c.st === 2 ? 6 : 4.5, dt);
      if (d < 0.08) c.st = 0;
    }
    c.lift += (0.75 + Math.sin(this.t * 1.7 + c.ph) * 0.12 - c.lift) * dt * 2;
    if (env.day < 0.3 || env.rain > 0.35) c.t = Math.max(c.t, c.life);
  }

  _frog(c, dt, env) {
    if (c.st === 0) {
      if (this.near(c.x, c.y) < 2.7) {
        // hop into the nearest water
        let best = null, bd = 9;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = Math.floor(c.x) + dx + 0.5, y = Math.floor(c.y) + dy + 0.5;
          if (!this.water(x, y)) continue;
          const d = Math.hypot(x - c.x, y - c.y);
          if (d < bd) { bd = d; best = [x, y]; }
        }
        if (!best) { c.fading = true; c.st = 3; return; }
        c.st = 1; c.t0 = c.t; c.sx = c.x; c.sy = c.y; c.ex = best[0] + (rnd() - 0.5) * 0.4; c.ey = best[1] + (rnd() - 0.5) * 0.3;
        c.flip = c.ex < c.x ? -1 : 1;
        return;
      }
      c.hopT -= dt;
      if (c.hopT <= 0) { c.hopT = 3 + rnd() * 6; c.flip = -c.flip; }
      if (rnd() < dt * 0.04 && env.night > 0.2) this.g.audio?.play?.('frog', { x: c.x, y: c.y, volume: 0.4 });
    } else if (c.st === 1) { // jump arc
      const k = Math.min(1, (c.t - c.t0) / 0.42);
      c.x = c.sx + (c.ex - c.sx) * k; c.y = c.sy + (c.ey - c.sy) * k; c.lift = Math.sin(k * Math.PI) * 0.45;
      if (k >= 1) {
        c.dead = true;
        this._splash(c.x, c.y, 0.45);
        this.g.audio?.play?.('splash', { x: c.x, y: c.y, volume: 0.25 });
      }
    } else { c.a -= dt * 2; if (c.a <= 0) c.dead = true; }
  }

  _duck(c, dt) {
    const lead = c.lead && !c.lead.dead ? c.lead : null;
    if (c.lead && !lead) c.lead = null;
    const dP = this.near(c.x, c.y);
    if (c.st === 0 && dP < 1.8) {
      c.st = c.v === 2 ? 3 : 2; c.fading = true; // the adult flies off, ducklings dive
      if (c.st === 2) { this._flee(c, 9); this.g.audio?.play?.('duck', { x: c.x, y: c.y, volume: 0.5 }); this._splash(c.x, c.y, 0.5); }
    }
    if (c.st === 2) { // flying away
      this._toward(c, c.tx, c.ty, 3.6, dt);
      c.lift = Math.min(3.5, c.lift + dt * 1.8);
      c.flip = c.tx < c.x ? -1 : 1;
      if (c.lift > 1.6) c.a -= dt * 0.8;
      if (c.a <= 0) c.dead = true;
      return;
    }
    if (c.st === 3) { c.a -= dt * 1.8; if (c.a <= 0) { c.dead = true; this._splash(c.x, c.y, 0.25); } return; }
    let sp = c.sp;
    if (dP < 3.4 && !lead) { // paddle away from the player
      c.h = Math.atan2(c.y - this.py, c.x - this.px);
      sp = 0.9;
    }
    if (lead) { // follow the one in front at a small distance
      const dx = lead.x - c.x, dy = lead.y - c.y, d = Math.hypot(dx, dy);
      const want = c.pair ? 0.55 : 0.36;
      if (d > want) { c.h = Math.atan2(dy, dx); sp = Math.min(1.4, (d - want) * 3 + lead.sp * 0.5); } else sp = 0;
    } else c.h += Math.sin(this.t * 0.3 + c.ph) * dt * 0.5;
    const nx = c.x + Math.cos(c.h) * sp * dt, ny = c.y + Math.sin(c.h) * sp * dt;
    if (this.water(nx, ny) && (lead || this.landDist(nx, ny) >= 0.8)) { c.x = nx; c.y = ny; } else if (!lead) c.h += Math.PI * (0.5 + rnd() * 0.5);
    if (Math.abs(Math.cos(c.h)) > 0.2) c.flip = Math.cos(c.h) < 0 ? -1 : 1;
    c.lift = Math.sin(this.t * 2 + c.ph) * 0.015;
    if (!lead && sp > 0.05) { c.wakeT -= dt; if (c.wakeT <= 0) { c.wakeT = 1.1; this._ring(c.x - Math.cos(c.h) * 0.2, c.y, 0.25, 0.9, 0.22); } }
    c.sp = sp > 0.05 ? sp : c.sp;
    if (!lead) c.sp = 0.18 + Math.max(0, sp - 0.18) * 0.5;
  }

  _fish(c, dt) {
    if (this.near(c.x, c.y) < 2.3 && c.st !== 2) { c.st = 2; c.h = Math.atan2(c.y - this.py, c.x - this.px); c.sp = 2.2; c.fading = true; }
    if (c.st === 2) { c.a -= dt * 0.9; if (c.a <= 0) c.dead = true; }
    c.h += Math.sin(this.t * 0.7 + c.ph) * dt * 0.6;
    const nx = c.x + Math.cos(c.h) * c.sp * dt, ny = c.y + Math.sin(c.h) * c.sp * dt;
    if (this.water(nx, ny) === 2 || (this.water(nx, ny) && c.st === 2)) { c.x = nx; c.y = ny; } else c.h += Math.PI * 0.7;
  }

  _squirrel(c, dt) {
    if (c.st < 2 && this.near(c.x, c.y) < 3.6) {
      // run for the nearest tree trunk and climb it
      let best = null, bd = 7;
      for (const o of this.trees) { const d = Math.hypot(o.x - c.x, o.y - c.y); if (d < bd) { bd = d; best = o; } }
      if (best) { c.st = 2; c.tree = best; c.tx = best.x; c.ty = best.y + 0.02; }
      else { c.st = 2; this._flee(c, 6); c.tree = null; c.fading = true; }
    }
    if (c.st === 0) { // sitting / nibbling
      c.hopT -= dt;
      if (c.hopT <= 0) {
        const a = rnd() * TAU, r = 0.6 + rnd() * 1.4, x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r * 0.7;
        if (this.landOk(x, y)) { c.tx = x; c.ty = y; c.st = 1; c.flip = x < c.x ? -1 : 1; }
        c.hopT = 1.2 + rnd() * 3;
      }
    } else if (c.st === 1) {
      const d = this._toward(c, c.tx, c.ty, 2.2, dt);
      c.lift = Math.abs(Math.sin(c.t * 14)) * 0.06;
      if (d < 0.05) { c.st = 0; c.lift = 0; }
    } else if (c.st === 2) { // dash to the trunk
      c.flip = c.tx < c.x ? -1 : 1;
      const d = this._toward(c, c.tx, c.ty, 4.2, dt);
      c.lift = Math.abs(Math.sin(c.t * 18)) * 0.08;
      if (c.fading) { c.a -= dt * 0.8; if (c.a <= 0) c.dead = true; }
      else if (d < 0.06) { c.st = 3; c.lift = 0; }
    } else { // climbing into the canopy
      c.lift += dt * 1.6;
      if (c.lift > 1.1) { c.fading = true; c.a -= dt * 2.2; if (c.a <= 0) c.dead = true; }
    }
  }

  _bird(c, dt) {
    if (c.delay > 0) { c.delay -= dt; c.a = 0; return; }
    if (c.st === 0) { // landing
      const d = this._toward(c, c.gx, c.gy, 2.6, dt);
      c.lift = Math.max(0, c.lift - dt * 2.2);
      if (d < 0.05 && c.lift <= 0.01) { c.st = 1; c.lift = 0; }
      if (this.near(c.x, c.y) < 3) this._birdFly(c);
      return;
    }
    if (c.st === 1) {
      if (this.near(c.x, c.y) < 3.4 || c.t > c.life) { this._birdFly(c); this._alarm(c); return; }
      c.hopT -= dt;
      c.peck = Math.max(0, c.peck - dt);
      if (c.hopT <= 0) {
        c.hopT = 0.6 + rnd() * 1.6;
        if (rnd() < 0.5) c.peck = 0.35 + rnd() * 0.5;
        else { const a = rnd() * TAU, x = c.x + Math.cos(a) * 0.25, y = c.y + Math.sin(a) * 0.15; if (this.landOk(x, y)) { c.x = x; c.y = y; c.hop = 0.18; c.flip = Math.cos(a) < 0 ? -1 : 1; } }
      }
      c.hop = Math.max(0, (c.hop || 0) - dt);
      c.lift = Math.sin(Math.min(1, (0.18 - c.hop) / 0.18) * Math.PI) * 0.06 * (c.hop > 0 ? 1 : 0);
      return;
    }
    // flying away
    this._toward(c, c.tx, c.ty, 4.2, dt);
    c.lift += dt * 2.4;
    if (c.lift > 2) c.a -= dt * 1.2;
    if (c.a <= 0) c.dead = true;
  }
  _birdFly(c) {
    if (c.st === 2) return;
    c.st = 2; c.fading = true;
    if (this.pl.length) this._flee(c, 10); else { c.tx = c.x + 8; c.ty = c.y - 2; }
    c.flip = c.tx < c.x ? -1 : 1;
    if (rnd() < 0.5) this.g.audio?.play?.('chirp', { x: c.x, y: c.y, volume: 0.35 });
  }
  _alarm(c) { for (const o of this.list) if (o.kind === 'bird' && o !== c && o.st === 1 && Math.abs(o.x - c.x) < 2.5 && Math.abs(o.y - c.y) < 2) { this.px = c.x; this.py = c.y + 0.1; this._birdFly(o); } }

  _rabbit(c, dt) {
    if (c.st === 0 && this.near(c.x, c.y) < 4.3) {
      c.st = 1; c.runT = 0; c.zig = 0;
      let best = null, bd = 7;
      for (const o of this.bushes) { const d = Math.hypot(o.x - c.x, o.y - c.y); if (d < bd && Math.hypot(o.x - this.px, o.y - this.py) > 2) { bd = d; best = o; } }
      if (best) { c.tx = best.x; c.ty = best.y; c.hide = true; } else { this._flee(c, 8); c.hide = false; }
    }
    if (c.st === 0) {
      c.hopT -= dt;
      if (c.hopT <= 0) {
        c.hopT = 1.5 + rnd() * 4;
        const a = rnd() * TAU, x = c.x + Math.cos(a) * 0.5, y = c.y + Math.sin(a) * 0.3;
        if (this.landOk(x, y)) { c.x = x; c.y = y; c.hop = 0.25; c.flip = Math.cos(a) < 0 ? -1 : 1; }
      }
      c.hop = Math.max(0, (c.hop || 0) - dt);
      c.lift = c.hop > 0 ? Math.sin((1 - c.hop / 0.25) * Math.PI) * 0.12 : 0;
      return;
    }
    // darting away in zig-zags
    c.runT += dt;
    c.zig += dt;
    const ang = Math.atan2(c.ty - c.y, c.tx - c.x) + (Math.sin(c.zig * 7) > 0 ? 0.5 : -0.5);
    const sp = 4.6 * dt, nx = c.x + Math.cos(ang) * sp, ny = c.y + Math.sin(ang) * sp;
    if (this.landOk(nx, ny)) { c.x = nx; c.y = ny; }
    c.flip = Math.cos(ang) < 0 ? -1 : 1;
    c.lift = Math.abs(Math.sin(c.runT * 12)) * 0.14;
    const d = Math.hypot(c.tx - c.x, c.ty - c.y);
    if ((c.hide && d < 0.45) || c.runT > 2.2) { c.fading = true; c.a -= dt * 3; if (c.a <= 0) c.dead = true; }
  }

  // ---------------------------------------------------------------- fx helpers
  _ring(x, y, s0, s1, a) {
    if (!this.S.ring) return;
    this.g.particles.emit({ spr: this.S.ring.name, x, y, life: 1.1, size: s0 * this.kRing, size1: s1 * this.kRing, r: 0.9, g: 0.95, b: 1, a, a1: 0 });
  }
  _splash(x, y, s) {
    this._ring(x, y, 0.08 * s, 0.9 * s, 0.45);
    if (!this.S.spark) return;
    for (let k = 0; k < 4; k++) this.g.particles.emit({ spr: this.S.spark.name, x, y, vx: (rnd() - 0.5) * 1.2 * s, vy: (rnd() - 0.5) * 0.6 * s, lift: 0.02, vlift: 1 + rnd(), grav: 7, life: 0.45, size: 0.1 * this.kSpark, size1: 0.06 * this.kSpark, r: 0.9, g: 0.95, b: 1, a: 0.85, a1: 0.2 });
  }

  // ---------------------------------------------------------------- render
  collect(game, list, v) {
    for (const c of this.list) if (c.a > 0.01 && c.x > v.x0 - 1 && c.x < v.x1 + 1 && c.y > v.y0 - 1 && c.y < v.y1 + 4) list.push(c);
  }
  _shadow(B, c, w, a) {
    if (!this.S.blob) return;
    const k = this.kBlob;
    B.blob.add(this.S.blob, c.x, c.y, w * k, w * 0.5 * k, 1, 1, 1, a * c.a / (1 + c.lift * 1.5));
  }
  _draw(B, c, t) {
    // camera turned: a critter faces the other way when the world's east points left on screen; headings minus the yaw
    const yaw = this.g.cam?.rot || 0, fx = Math.cos(yaw) < 0 ? -1 : 1;
    const S = this.S, a = c.a;
    switch (c.kind) {
      case 'butterfly': {
        const s = S.bf[c.v] || S.bf[0];
        const flap = c.rest > 0 ? 0.55 + 0.35 * Math.sin(t * 3 + c.ph) : Math.abs(Math.sin(t * 15 + c.ph));
        this._shadow(B, c, 0.18, 0.28);
        B.main.add(s, c.x, c.y, c.s * (0.18 + 0.82 * flap), c.s, 1, 1, 1, a, 0, Math.sin(t * 2 + c.ph) * 0.15, 0, 1, 0, c.lift);
        break;
      }
      case 'bee': {
        this._shadow(B, c, 0.08, 0.2);
        B.main.add(S.bee, c.x, c.y, 1, 1, 1, 1, 1, a, 0, Math.sin(t * 20 + c.ph) * 0.2, 0, 1, 0, c.lift + Math.sin(t * 40 + c.ph) * 0.01);
        break;
      }
      case 'dragonfly': {
        const s = S.df[c.v] || S.df[0];
        this._shadow(B, c, 0.22, 0.18);
        B.main.add(s, c.x, c.y, 0.9 + 0.1 * Math.sin(t * 50 + c.ph), 0.9, 1, 1, 1, a * (0.85 + 0.15 * Math.sin(t * 60)), 0, (c.rot || 0) - yaw, 0, 1, 0, c.lift);
        break;
      }
      case 'frog': {
        const s = c.st === 1 ? S.frogJump : S.frog[c.v] || S.frog[0];
        this._shadow(B, c, 0.2, 0.35);
        const breath = c.st === 0 ? 1 + Math.sin(t * 3 + c.ph) * 0.03 : 1;
        B.main.add(s, c.x, c.y, 0.85 * breath, 0.85, 1, 1, 1, a, 0, 0, 0, c.flip * fx, 0, c.lift);
        break;
      }
      case 'duck': {
        const s = c.st === 2 ? S.duckFly : c.v === 2 ? S.duckling : S.duck[c.v] || S.duck[0];
        if (c.st === 2) this._shadow(B, c, 0.4, 0.25);
        B.main.add(s, c.x, c.y, 0.85, 0.85, 1, 1, 1, a, 0, c.st === 2 ? 0 : Math.sin(t * 1.6 + c.ph) * 0.04, 0, c.flip * fx, c.st === 2 ? 0 : -1, c.lift); // -1: waterline
        break;
      }
      case 'fish': {
        if (!S.fish) break;
        B.ground.add(S.fish, c.x, c.y, c.s, c.s, 1, 1, 1, 0.32 * a, 0, c.h + Math.sin(t * 6 + c.ph) * 0.12, 0, 1, 0, 0);
        break;
      }
      case 'squirrel': {
        const s = c.st === 3 ? S.sq.climb : c.st === 0 ? S.sq.sit : S.sq.run;
        if (!s) break;
        if (c.st < 3) this._shadow(B, c, 0.2, 0.3);
        B.main.add(s, c.x, c.y + (c.st === 3 ? 0.05 : 0), 0.85, 0.85, 1, 1, 1, a, 0, 0, 0, c.st === 3 ? 1 : c.flip * fx, 0, c.lift);
        break;
      }
      case 'bird': {
        const B3 = S.bird[c.v] || S.bird[0];
        const flying = c.st !== 1;
        const s = flying ? B3.fly : c.peck > 0 && Math.sin(t * 22 + c.ph) > 0 ? B3.peck : B3.sit;
        if (!s) break;
        this._shadow(B, c, 0.16, 0.3);
        const flap = flying ? 0.7 + 0.3 * Math.sin(t * 28 + c.ph) : 1;
        B.main.add(s, c.x, c.y, 0.9, 0.9 * flap, 1, 1, 1, a, 0, 0, 0, c.flip * fx, 0, c.lift);
        break;
      }
      case 'rabbit': {
        const s = c.st === 1 && Math.sin(c.runT * 12) > 0 ? S.rabRun : S.rab;
        if (!s) break;
        this._shadow(B, c, 0.32, 0.4);
        const sc = 0.55, chew = c.st === 0 ? 1 + Math.sin(t * 9 + c.ph) * 0.015 : 1;
        B.main.add(s, c.x, c.y, sc * chew, sc, 1, 1, 1, a, 0, 0, 0, c.flip * fx, 0, c.lift);
        break;
      }
    }
  }
}
