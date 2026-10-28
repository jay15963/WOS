// Ambient life & weather FX (owned by the environment pass).
// Installed from main.js: installAmbient(game). Runs as a regular game system.
//  - fire objects (o.fire): smoke + rising embers
//  - rain splashes on the ground, wind-blown dust and leaves in gusts
//  - fireflies at night, butterflies near flowers, falling leaves, dust motes in sunbeams
//  - bird flocks crossing the sky (with ground shadows), fish jumping in lakes, water sparkles
//  - adaptive render resolution when the frame rate drops (game.R.autoScale = false disables)
// Everything is spawned only around the visible view and capped.

const rnd = Math.random;
const TAU = Math.PI * 2;

export function installAmbient(game) {
  const sys = new Ambient(game);
  game.systems.push(sys);
  game.ambient = sys;
}

class Ambient {
  constructor(game) {
    this.g = game;
    const A = game.A;
    const pick = (...names) => names.find((n) => A.has(n)) || 'fx_soft';
    this.S = {
      soft: pick('fx_soft'), spark: pick('fx_spark', 'fx_soft'), smoke: pick('fx_smoke', 'fx_soft'),
      leaf: pick('fx_leaf', 'fx_soft'), ring: pick('fx_ring', 'fx_soft'), splash: pick('fx_splash', 'fx_ring', 'fx_soft'),
      dust: pick('fx_dust', 'fx_smoke', 'fx_soft'), star: pick('fx_star', 'fx_spark', 'fx_soft'), blob: pick('fx_blob', 'fx_soft'),
      drop: pick('fx_drop', 'fx_spark', 'fx_soft'),
    };
    this._spr = {};
    // world-size -> sprite scale factors (particle `size` multiplies the sprite's own size)
    this.K = {};
    for (const k in this.S) { const sp = A.get(this.S[k]); this.K[k] = 1 / Math.max(0.01, sp.w); }
    this.t = 0;
    this.acc = { fire: 0, rain: 0, leaf: 0, fly: 0, mote: 0, spark: 0, gustDust: 0 };
    this.scanT = 0;
    this.fires = [];
    this.trees = [];
    this.flowers = [];
    this.fireflies = [];
    this.butterflies = [];
    this.flocks = [];
    this.fish = [];
    this.nextFlock = 12 + rnd() * 20;
    this.nextFish = 4 + rnd() * 6;
    // adaptive resolution
    this.perf = { last: performance.now(), ema: 1 / 60, slowT: 0, fastT: 0, coolT: 0 };
  }

  spr(name) { return this._spr[name] || (this._spr[name] = this.g.A.get(name)); }

  // ------------------------------------------------------------------ update
  update(g, dt) {
    this.t += dt;
    const env = g.env.env, v = g.view(), w = g.world, P = g.particles, K = this.K;
    const area = (v.x1 - v.x0) * (v.y1 - v.y0);
    const areaK = Math.min(2.5, area / 900);
    this._perf(g);

    // periodic scan of the visible neighbourhood (fires, trees, flowers)
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.4; this._scan(g, v); }

    // ---------- fire: smoke + embers ----------
    for (const f of this.fires) {
      const o = f.o;
      if (!o.fire || o.dead) continue;
      const I = typeof o.fire === 'number' ? o.fire : 1;
      const lift = (o.light && o.light.lift != null ? o.light.lift : 0.3) + 0.15;
      f.acc = (f.acc || 0) + dt * I;
      while (f.acc > 0.11) {
        f.acc -= 0.11;
        const wx = env.windDir[0] * env.wind, wy = env.windDir[1] * env.wind;
        P.emit({ spr: this.S.smoke, x: o.x + (rnd() - 0.5) * 0.15, y: o.y + 0.02, vx: wx * 0.5 + (rnd() - 0.5) * 0.12, vy: wy * 0.3,
          lift: lift + 0.2, vlift: 0.55 + rnd() * 0.3, drag: 0.25, life: 2.6 + rnd() * 1.6, size: (0.35) * K.smoke, size1: (1.5 + rnd() * 0.6) * K.smoke,
          r: 0.55, g: 0.53, b: 0.52, a: 0.32, a1: 0, rot: rnd() * TAU, vr: (rnd() - 0.5) * 0.6, fadeIn: 0.35, ground: false });
        if (rnd() < 0.55) {
          P.emit({ spr: this.S.spark, x: o.x + (rnd() - 0.5) * 0.25, y: o.y + 0.02, vx: (rnd() - 0.5) * 0.5 + wx * 0.4, vy: (rnd() - 0.5) * 0.2,
            lift: lift, vlift: 1.0 + rnd() * 1.4, grav: 0.35, drag: 0.6, life: 0.7 + rnd() * 1.1, size: (0.16 + rnd() * 0.12) * K.spark, size1: (0.04) * K.spark,
            r: 1.0, g: 0.62 + rnd() * 0.25, b: 0.2, a: 1, a1: 0.2, layer: 'emissive', ground: false });
        }
      }
    }

    // ---------- rain splashes on the ground ----------
    if (env.rain > 0.05) {
      this.acc.rain += dt * env.rain * 55 * areaK;
      while (this.acc.rain > 1) {
        this.acc.rain -= 1;
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        const tx = Math.floor(x), ty = Math.floor(y);
        if (w.isRock(tx, ty) || w.waterAt(tx, ty)) continue; // water ripples are drawn by the terrain shader
        P.emit({ spr: this.S.splash, x, y, life: 0.28, size: (0.08) * K.splash, size1: (0.3) * K.splash, r: 0.85, g: 0.9, b: 1, a: 0.55, a1: 0 });
        if (rnd() < 0.3) for (let k = 0; k < 2; k++) {
          P.emit({ spr: this.S.spark, x, y, vx: (rnd() - 0.5) * 1.2, vy: (rnd() - 0.5) * 0.6, lift: 0.02, vlift: 1 + rnd(), grav: 7, life: 0.3, size: (0.1) * K.spark, size1: (0.06) * K.spark, r: 0.85, g: 0.9, b: 1, a: 0.7, a1: 0 });
        }
      }
    }

    // ---------- gusts: dust over sand/gravel, extra leaves ----------
    const gusty = Math.max(0, env.wind - 0.55);
    if (gusty > 0 && env.rain < 0.3) {
      this.acc.gustDust += dt * gusty * 14 * areaK;
      while (this.acc.gustDust > 1) {
        this.acc.gustDust -= 1;
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        const gnd = w.groundAt(Math.floor(x), Math.floor(y));
        if (!(gnd === 2 || gnd === 3 || gnd === 0) || w.waterAt(Math.floor(x), Math.floor(y))) continue;
        const sp = 1.5 + env.wind * 2.5;
        P.emit({ spr: this.S.dust, x, y, vx: env.windDir[0] * sp, vy: env.windDir[1] * sp, lift: 0.1, vlift: 0.15, life: 1.8, size: (0.4) * K.dust, size1: (1.4) * K.dust,
          r: 0.75, g: 0.66, b: 0.52, a: 0.16, a1: 0, fadeIn: 0.4, ground: false });
      }
    }

    // ---------- falling leaves under trees ----------
    if (this.trees.length) {
      this.acc.leaf += dt * (0.8 + env.wind * 4 + gusty * 10) * Math.min(1, this.trees.length / 12) * areaK;
      while (this.acc.leaf > 1) {
        this.acc.leaf -= 1;
        const o = this.trees[Math.floor(rnd() * this.trees.length)];
        if (o.stump || o.fall) continue;
        const s = o.s || 1, pine = o.type === 'tree_pine';
        if (pine && rnd() < 0.7) continue;
        const autumn = rnd();
        const c = o.type === 'tree_birch' ? [1.35, 1.2, 0.45] : autumn < 0.45 ? [1, 1, 1] : autumn < 0.8 ? [1.3, 0.95, 0.5] : [1.25, 0.72, 0.42];
        const sp = 0.3 + env.wind * 1.6;
        P.emit({ spr: this.S.leaf, x: o.x + (rnd() - 0.5) * 1.3 * s, y: o.y + (rnd() - 0.3) * 0.5, lift: (1.2 + rnd() * 1.3) * s,
          vx: env.windDir[0] * sp + (rnd() - 0.5) * 0.3, vy: env.windDir[1] * sp * 0.6 + (rnd() - 0.5) * 0.2, vlift: -0.25 - rnd() * 0.2, grav: 0.02, drag: 0.05,
          life: 5 + rnd() * 3, size: (0.17 + rnd() * 0.1) * K.leaf, size1: (0.15) * K.leaf, rot: rnd() * TAU, vr: (rnd() - 0.5) * 5, r: c[0], g: c[1], b: c[2], a: 1, a1: 0, flip: rnd() < 0.5 ? -1 : 1 });
      }
    }

    // ---------- fireflies (night) ----------
    const night = env.night;
    const wantFly = night > 0.45 && env.rain < 0.25 ? Math.round(26 * areaK * (night - 0.3)) : 0;
    if (this.fireflies.length < wantFly) {
      this.acc.fly += dt * 6;
      while (this.acc.fly > 1 && this.fireflies.length < wantFly) {
        this.acc.fly -= 1;
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        const tx = Math.floor(x), ty = Math.floor(y);
        if (w.isRock(tx, ty)) continue;
        const i = ty * w.W + tx;
        const ok = (w.lush && w.lush[i] > 0.45) || (w.dWater && w.dWater[i] < 4);
        if (!ok) continue;
        this.fireflies.push({ x, y, lift: 0.3 + rnd() * 0.9, ph: rnd() * TAU, sp: 0.25 + rnd() * 0.35, ang: rnd() * TAU, t: 0, life: 10 + rnd() * 14, blink: 0.4 + rnd() * 0.5 });
      }
    }
    for (let k = this.fireflies.length - 1; k >= 0; k--) {
      const f = this.fireflies[k];
      f.t += dt;
      f.ang += (Math.sin(this.t * 0.9 + f.ph) * 1.8 + (rnd() - 0.5) * 2) * dt;
      f.x += Math.cos(f.ang) * f.sp * dt; f.y += Math.sin(f.ang) * f.sp * dt * 0.7;
      f.lift = Math.max(0.15, f.lift + Math.sin(this.t * 1.3 + f.ph * 3) * dt * 0.25);
      if (f.t > f.life || night < 0.3 || f.x < v.x0 - 3 || f.x > v.x1 + 3 || f.y < v.y0 - 3 || f.y > v.y1 + 3) this.fireflies.splice(k, 1);
    }

    // ---------- butterflies (day, near flowers) ----------
    const day = env.day * (1 - env.rain) * (1 - Math.max(0, env.wind - 0.6));
    const wantBf = day > 0.5 && this.flowers.length ? Math.min(9, Math.round(this.flowers.length / 6) + 1) : 0;
    if (this.butterflies.length < wantBf && rnd() < dt * 1.5) {
      const fl = this.flowers[Math.floor(rnd() * this.flowers.length)];
      const cols = [[1, 0.95, 0.85], [1, 0.82, 0.3], [0.95, 0.55, 0.2], [0.55, 0.7, 1], [1, 1, 1], [0.95, 0.5, 0.75]];
      this.butterflies.push({ x: fl.x + (rnd() - 0.5) * 3, y: fl.y + (rnd() - 0.5) * 2, lift: 0.4 + rnd() * 0.5, tx: fl.x, ty: fl.y, t: 0, life: 18 + rnd() * 20,
        c: cols[Math.floor(rnd() * cols.length)], ph: rnd() * TAU, rest: 0, sp: 0.8 + rnd() * 0.5 });
    }
    for (let k = this.butterflies.length - 1; k >= 0; k--) {
      const b = this.butterflies[k];
      b.t += dt;
      if (b.rest > 0) { b.rest -= dt; b.lift = Math.max(0.08, b.lift - dt); }
      else {
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
        if (d < 0.15) {
          b.rest = rnd() < 0.5 ? 1 + rnd() * 2.5 : 0;
          const fl = this.flowers.length ? this.flowers[Math.floor(rnd() * this.flowers.length)] : null;
          if (fl && Math.hypot(fl.x - b.x, fl.y - b.y) < 6) { b.tx = fl.x; b.ty = fl.y; } else { b.tx = b.x + (rnd() - 0.5) * 4; b.ty = b.y + (rnd() - 0.5) * 3; }
        } else {
          const wob = Math.sin(this.t * 6 + b.ph) * 0.9;
          b.x += (dx / d * b.sp + wob * -dy / d * 0.6 + env.windDir[0] * env.wind * 0.3) * dt;
          b.y += (dy / d * b.sp + wob * dx / d * 0.6) * dt;
          b.lift += (0.45 + Math.sin(this.t * 2.3 + b.ph) * 0.25 - b.lift) * dt * 2;
        }
      }
      if (b.t > b.life || day < 0.3 || b.x < v.x0 - 6 || b.x > v.x1 + 6 || b.y < v.y0 - 6 || b.y > v.y1 + 6) this.butterflies.splice(k, 1);
    }

    // ---------- dust motes in sunbeams ----------
    const golden = env.day > 0 ? 0.5 + 0.5 * Math.max(0, 1 - Math.abs(env.hour - 7.2) / 1.6, 1 - Math.abs(env.hour - 17.8) / 1.6) : 0;
    const motes = env.sunI * (1 - env.cloud) * (1 - env.rain) * golden;
    if (motes > 0.1 && this.trees.length) {
      this.acc.mote += dt * motes * 7 * areaK;
      while (this.acc.mote > 1) {
        this.acc.mote -= 1;
        const o = this.trees[Math.floor(rnd() * this.trees.length)];
        const x = o.x + (rnd() - 0.5) * 3, y = o.y + (rnd() - 0.5) * 2;
        P.emit({ spr: this.S.spark, x, y, lift: 0.3 + rnd() * 1.6, vx: (rnd() - 0.5) * 0.12 + env.windDir[0] * 0.08, vy: (rnd() - 0.5) * 0.08, vlift: (rnd() - 0.4) * 0.08,
          life: 4 + rnd() * 4, size: (0.12 + rnd() * 0.08) * K.spark, size1: (0.08) * K.spark, r: 1, g: 0.9, b: 0.7, a: 0.35 * motes, a1: 0, fadeIn: 1.5, layer: 'emissive', ground: false });
      }
    }

    // ---------- water sparkles ----------
    if (env.sunI > 0.35 && env.rain < 0.2) {
      this.acc.spark += dt * 10 * env.sunI * areaK;
      while (this.acc.spark > 1) {
        this.acc.spark -= 1;
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        if (!w.waterAt(Math.floor(x), Math.floor(y))) continue;
        P.emit({ spr: this.S.star, x, y, life: 0.35 + rnd() * 0.45, size: (0.05) * K.star, size1: (0.22 + rnd() * 0.15) * K.star, r: 1, g: 0.97, b: 0.88, a: 0.75 * env.sunI, a1: 0,
          rot: rnd() * TAU, layer: 'emissive' });
      }
    }

    // ---------- birds crossing ----------
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = 25 + rnd() * 45;
      if (env.day > 0.3 && env.rain < 0.5) this._spawnFlock(v, env);
    }
    for (let k = this.flocks.length - 1; k >= 0; k--) {
      const F = this.flocks[k];
      F.t += dt;
      F.x += F.vx * dt; F.y += F.vy * dt;
      F.vy += Math.sin(F.t * 0.4 + F.ph) * 0.05 * dt;
      if (F.t > 40) this.flocks.splice(k, 1);
    }

    // ---------- fish jumping ----------
    this.nextFish -= dt;
    if (this.nextFish <= 0) {
      this.nextFish = 3 + rnd() * 7;
      for (let tries = 0; tries < 10; tries++) {
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        if (w.waterAt(Math.floor(x), Math.floor(y)) !== 2) continue;
        const ang = rnd() * TAU, dist = 0.6 + rnd() * 0.5;
        this.fish.push({ x, y, dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist * 0.6, t: 0, dur: 0.6 + rnd() * 0.25, h: 0.35 + rnd() * 0.3, flip: Math.cos(ang) < 0 ? -1 : 1, s0: false });
        this._splash(x, y, 0.8);
        g.audio?.play?.('splash', { x, y, volume: 0.35 });
        break;
      }
    }
    for (let k = this.fish.length - 1; k >= 0; k--) {
      const f = this.fish[k];
      f.t += dt;
      if (f.t >= f.dur) {
        this._splash(f.x + f.dx, f.y + f.dy, 1);
        g.audio?.play?.('splash', { x: f.x + f.dx, y: f.y + f.dy, volume: 0.45 });
        this.fish.splice(k, 1);
      }
    }
  }

  _splash(x, y, s) {
    const P = this.g.particles, K = this.K;
    P.emit({ spr: this.S.ring, x, y, life: 0.9, size: (0.12 * s) * K.ring, size1: (0.9 * s) * K.ring, r: 0.9, g: 0.95, b: 1, a: 0.5, a1: 0 });
    P.emit({ spr: this.S.ring, x, y, life: 1.3, size: (0.1 * s) * K.ring, size1: (1.4 * s) * K.ring, r: 0.9, g: 0.95, b: 1, a: 0.3, a1: 0 });
    for (let k = 0; k < 6; k++) {
      P.emit({ spr: this.S.spark, x, y, vx: (rnd() - 0.5) * 1.4 * s, vy: (rnd() - 0.5) * 0.8 * s, lift: 0.02, vlift: 1.3 + rnd() * 1.2, grav: 7, life: 0.5, size: (0.13) * K.spark, size1: (0.07) * K.spark, r: 0.9, g: 0.95, b: 1, a: 0.9, a1: 0.2 });
    }
  }

  _spawnFlock(v, env) {
    const n = 5 + Math.floor(rnd() * 6);
    const fromLeft = rnd() < 0.5;
    const sp = 3.2 + rnd() * 1.5;
    const ang = (fromLeft ? 0 : Math.PI) + (rnd() - 0.5) * 0.7;
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    const lift = 6 + rnd() * 3;
    const x = fromLeft ? v.x0 - 6 : v.x1 + 6, y = v.y0 + lift + rnd() * (v.y1 - v.y0);
    const birds = [];
    // loose V formation
    const fx = -Math.cos(ang), fy = -Math.sin(ang), px = -fy, py = fx;
    for (let k = 0; k < n; k++) {
      const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1;
      birds.push({ ox: fx * row * 0.55 + px * side * row * 0.5 + (rnd() - 0.5) * 0.25, oy: fy * row * 0.55 + py * side * row * 0.5 + (rnd() - 0.5) * 0.25, ph: rnd() * TAU, f: 9 + rnd() * 3, h: (rnd() - 0.5) * 0.6 });
    }
    this.flocks.push({ x, y, vx, vy, lift, birds, t: 0, ph: rnd() * TAU, ang });
    this.g.audio?.play?.('birds', { x, y, volume: 0.5 });
  }

  _scan(g, v) {
    const fires = [], trees = [], flowers = [];
    const old = new Map(this.fires.map((f) => [f.o, f]));
    g.world.forChunks(v.x0 - 3, v.y0 - 3, v.x1 + 3, v.y1 + 5, (c) => {
      for (const o of c.objects) {
        if (o.fire) fires.push(old.get(o) || { o, acc: 0 });
        else if (o.type && o.type.startsWith('tree_') && o.type !== 'tree_dead' && !o.stump && o.x > v.x0 - 1 && o.x < v.x1 + 1 && o.y > v.y0 && o.y < v.y1 + 2) trees.push(o);
      }
      if (flowers.length < 240) for (const d of c.decor) if (d.t === 'flower' && d.x > v.x0 && d.x < v.x1 && d.y > v.y0 && d.y < v.y1) flowers.push(d);
    });
    this.fires = fires; this.trees = trees; this.flowers = flowers;
  }

  // adaptive render scale: drop resolution when frames are slow, recover when fast
  _perf(g) {
    const R = g.R, P = this.perf, now = performance.now();
    const raw = (now - P.last) / 1000;
    P.last = now;
    if (R.autoScale === false || raw <= 0 || raw > 0.15 || document.visibilityState !== 'visible') return;
    P.ema += (raw - P.ema) * 0.05;
    P.coolT -= raw;
    if (P.ema > 1 / 42) { P.slowT += raw; P.fastT = 0; } else if (P.ema < 1 / 56) { P.fastT += raw; P.slowT = 0; } else { P.slowT = P.fastT = 0; }
    const cur = R.renderScale || 1;
    if (P.slowT > 2.5 && cur > 0.55 && P.coolT <= 0) { R.renderScale = Math.max(0.55, cur - 0.15); P.slowT = 0; P.coolT = 3; }
    else if (P.fastT > 10 && cur < 1 && P.coolT <= 0) { R.renderScale = Math.min(1, cur + 0.1); P.fastT = 0; P.coolT = 6; }
  }

  // ------------------------------------------------------------------ render
  render(g, B, v, env) {
    const t = this.t;
    // fireflies: glow + tiny light
    if (this.fireflies.length) {
      const soft = this.spr(this.S.soft), core = this.spr(this.S.spark), K = this.K;
      let lights = 0;
      for (const f of this.fireflies) {
        const fade = Math.min(1, f.t / 1.5, (f.life - f.t) / 1.5);
        const bl = Math.max(0, Math.sin(t * (1.6 + f.blink) + f.ph)) ** 2;
        const a = fade * (0.25 + 0.75 * bl) * env.night;
        if (a < 0.02) continue;
        B.emissive.add(soft, f.x, f.y, 0.42 * K.soft, 0.42 * K.soft, 0.55, 0.85, 0.25, a * 0.45, 0, 0, 0, 1, 0, f.lift);
        B.emissive.add(core, f.x, f.y, 0.13 * K.spark, 0.13 * K.spark, 0.95, 1.0, 0.6, a, 0, 0, 0, 1, 0, f.lift);
        if (lights < 10 && bl > 0.5) { lights++; B.light.addRaw(f.x, f.y - f.lift, 1.8, 1.8, 0.55, 0.9, 0.35, 0.3 * a); }
      }
    }
    // butterflies: two flapping wings + shadow
    if (this.butterflies.length) {
      const wing = this.spr(this.S.soft), body = this.spr(this.S.spark), blob = this.spr(this.S.blob), K = this.K;
      for (const b of this.butterflies) {
        const flap = b.rest > 0 ? 0.55 + 0.25 * Math.sin(t * 3 + b.ph) : Math.abs(Math.sin(t * 16 + b.ph));
        const ws = 0.15 * (0.2 + 0.8 * flap), c = b.c;   // wing width (tiles)
        const fade = Math.min(1, b.t / 1, (b.life - b.t) / 1);
        B.blob.add(blob, b.x, b.y, 0.14 * K.blob, 0.1 * K.blob, 1, 1, 1, 0.3 * fade);
        B.fx.add(wing, b.x - ws * 0.5, b.y, ws * 1.6 * K.soft, 0.2 * K.soft, c[0], c[1], c[2], fade, 0, 0, 0, 1, 0, b.lift);
        B.fx.add(wing, b.x + ws * 0.5, b.y, ws * 1.6 * K.soft, 0.2 * K.soft, c[0], c[1], c[2], fade, 0, 0, 0, 1, 0, b.lift);
        B.fx.add(body, b.x, b.y, 0.05 * K.spark, 0.1 * K.spark, 0.12, 0.1, 0.08, fade, 0, 0, 0, 1, 0, b.lift);
      }
    }
    // fish arcs
    if (this.fish.length) {
      const leaf = this.spr(this.S.leaf), K = this.K;
      for (const f of this.fish) {
        const k = f.t / f.dur, h = Math.sin(k * Math.PI) * f.h;
        const rot = (k - 0.5) * 2.2 * f.flip;
        B.fx.add(leaf, f.x + f.dx * k, f.y + f.dy * k, 0.32 * K.leaf, 0.2 * K.leaf, 1.6, 1.32, 3.4, 1, 0, rot, 0, f.flip, 0, h);
      }
    }
    // birds high up + soft shadows on the ground
    if (this.flocks.length) {
      const leaf = this.spr(this.S.leaf), blob = this.spr(this.S.blob), K = this.K;
      const sd = env.shadowDir, shA = 0.22 * Math.min(1, env.shadowStr * 2.2);
      for (const F of this.flocks) {
        for (const b of F.birds) {
          const x = F.x + b.ox, y = F.y + b.oy, lift = F.lift + b.h;
          if (x < v.x0 - 4 || x > v.x1 + 4 || y - lift < v.y0 - 2 || y - lift > v.y1 + 2) continue;
          const flap = Math.sin(t * b.f + b.ph);
          const wa = 0.35 + 0.45 * flap;
          // V shape: two thin wings
          B.fx.add(leaf, x - 0.09, y, 0.26 * K.leaf, 0.08 * K.leaf, 0.3, 0.26, 0.3, 0.95, 0, -wa, 0, 1, 0, lift);
          B.fx.add(leaf, x + 0.09, y, 0.26 * K.leaf, 0.08 * K.leaf, 0.3, 0.26, 0.3, 0.95, 0, wa, 0, 1, 0, lift);
          if (shA > 0.01) B.blob.add(blob, x + sd[0] * lift * 0.6, y + sd[1] * lift * 0.6, 0.38 * K.blob, 0.16 * K.blob, 1, 1, 1, shA);
        }
      }
    }
  }
}
