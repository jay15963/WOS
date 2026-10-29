// Ambient life & weather FX (owned by the environment pass).
// Installed from main.js: installAmbient(game). Runs as a regular game system.
//  - fire objects (o.fire): smoke + rising embers
//  - rain splashes on the ground, wind-blown dust and leaves in gusts
//  - fireflies at night, butterflies near flowers, falling leaves, dust motes in sunbeams
//  - bird flocks crossing the sky (with ground shadows), fish jumping in lakes, water sparkles
//  - caves (mined tiles under a mountain roof): dust motes drifting in torch light, water drips,
//    a faint "eyes adjusting" light around the player, deeper vignette (env.extra.uCamCave)
//  - glowing mushrooms at night, raindrops jumping on water
//  - adaptive render resolution when the frame rate drops (game.R.autoScale = false disables), then (auto
//    quality only) one quality tier down — src/fx/quality.js
//  - lightning bolts + strike light, game.events 'lightning' { x, y, power, dist } (for thunder / reactions)
//  - firelight: warm bounce light on the ground and a soft halo around flames and lamps
//  - per-biome colour grade around the camera (env.grade), snow vs rain at the camera (env.env.snowAt),
//    contact-AO texture kept in sync with walls (R.syncSolid)
// Everything is spawned only around the visible view and capped (density × quality tier).

import { installQuality, qualityPreset, qualityStepDown, qualityStepUp } from './quality.js';
import { installDebug } from './debug.js';
import { installStatusFx } from './status.js';

import { installWildlife } from './wildlife.js';

const rnd = Math.random;
const TAU = Math.PI * 2;

// colour grade per biome (tint gain, lift in the darks, saturation, extra mist); blended around the camera
const GRADE = {
  meadow: { tint: [1.025, 1.0, 0.96], lift: [0.004, 0.002, 0], sat: 1.05, mist: 0 },
  forest: { tint: [0.99, 1.015, 0.96], lift: [0, 0.006, 0.002], sat: 1.02, mist: 0.05 },
  pine: { tint: [0.965, 1.0, 1.03], lift: [0, 0.004, 0.01], sat: 0.94, mist: 0.08 },
  birch: { tint: [1.03, 1.02, 0.95], lift: [0.004, 0.003, 0], sat: 1.05, mist: 0 },
  marsh: { tint: [0.96, 1.01, 0.97], lift: [0, 0.008, 0.006], sat: 0.9, mist: 0.22 },
  shore: { tint: [1.02, 1.0, 0.98], lift: [0.002, 0.002, 0.004], sat: 1.06, mist: 0.04 },
  rocky: { tint: [1.0, 0.98, 0.965], lift: [0.004, 0.002, 0], sat: 0.93, mist: 0 },
  water: { tint: [0.99, 1.0, 1.02], lift: [0, 0.002, 0.006], sat: 1.02, mist: 0.08 },
  mountain: { tint: [0.97, 0.985, 1.03], lift: [0, 0.002, 0.01], sat: 0.92, mist: 0.03 },
};
const SNOW_GRADE = { tint: [0.98, 1.0, 1.045], lift: [0.004, 0.006, 0.012], sat: 0.9, mist: 0.04 };

export function installAmbient(game) {
  installQuality(game);
  installDebug(game);
  const sys = new Ambient(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed before the gameplay registry (tagged above)
  game.ambient = sys;
  installWildlife(game); // critters (butterflies, bees, dragonflies, frogs, ducks, fish, squirrels, birds, rabbits)
  installStatusFx(game);  // local player's status screen effects (cosmetic)
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
      drop: pick('fx_drop', 'fx_spark', 'fx_soft'), glow: pick('fx_glow', 'fx_soft'),
    };
    this._spr = {};
    // world-size -> sprite scale factors (particle `size` multiplies the sprite's own size)
    this.K = {};
    for (const k in this.S) { const sp = A.get(this.S[k]); this.K[k] = 1 / Math.max(0.01, sp.w); }
    this.t = 0;
    this.acc = { fire: 0, rain: 0, leaf: 0, fly: 0, mote: 0, spark: 0, gustDust: 0, caveMote: 0 };
    this.scanT = 0;
    this.fires = [];
    this.trees = [];
    this.flowers = [];
    this.mushrooms = [];
    this.caveTiles = [];   // cave floor tiles in view (drips)
    this.caveLights = [];  // light emitters standing in caves (dust motes)
    this.drips = [];
    this.nextDrip = 1;
    this.eye = 0;          // smoothed cave darkness at the player
    this.camCave = 0;      // smoothed cave darkness at the camera
    this.fireflies = [];
    this.butterflies = [];
    this.flocks = [];
    this.fish = [];
    this.nextFlock = 12 + rnd() * 20;
    this.nextFish = 4 + rnd() * 6;
    // adaptive resolution
    this.perf = { last: performance.now(), ema: 1 / 60, slowT: 0, fastT: 0, coolT: 0 };
    this.lights = [];      // light emitters in view (halo / bounce light)
    this.bolts = [];       // lightning bolts being drawn
    this._strikeId = game.env.strikeId || 0;
    this.grade = { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, mist: 0 };
    this._gradeT = { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, mist: 0 };
    this.gradeScanT = 0;
    this.snowAt = 0;
  }

  spr(name) { return this._spr[name] || (this._spr[name] = this.g.A.get(name)); }

  // ------------------------------------------------------------------ update
  update(g, dt) {
    this.t += dt;
    const env = g.env.env, v = g.view(), w = g.world, P = g.particles, K = this.K;
    const area = (v.x1 - v.x0) * (v.y1 - v.y0);
    const Q = qualityPreset();
    const areaK = Math.min(2.5, area / 900) * Q.fx;
    this._perf(g);
    this._climate(g, dt);
    this._lightning(g, dt);

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

    // ---------- caves: how dark is it around the player / camera ----------
    const pl = g.player;
    const ek = 1 - Math.exp(-dt * 1.6);
    if (w.caveDark) {
      this.eye += (w.caveDark(pl.x, pl.y) - this.eye) * ek;
      this.camCave += (w.caveDark(g.cam.x, g.cam.y + 0.4) - this.camCave) * ek;
    }
    if (g.env.env.extra) g.env.env.extra.uCamCave = this.camCave;

    // ---------- rain splashes on the ground ----------
    if (env.rain > 0.05) {
      this.acc.rain += dt * env.rain * 55 * areaK;
      while (this.acc.rain > 1) {
        this.acc.rain -= 1;
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        const tx = Math.floor(x), ty = Math.floor(y);
        if (w.isRock(tx, ty) || (w.caveDark && w.caveDark(x, y) > 0.25)) continue; // no rain underground
        if (g.R.coldAt && g.R.coldAt(x, y) > 0.6) continue;                       // it snows here (post shader)
        if (w.waterAt(tx, ty)) {
          // ripples are drawn by the terrain shader; add a droplet jumping off the surface now and then
          if (rnd() < 0.35) P.emit({ spr: this.S.spark, x, y, vx: (rnd() - 0.5) * 0.4, vy: (rnd() - 0.5) * 0.2, lift: 0.02, vlift: 0.8 + rnd() * 0.7, grav: 7, life: 0.25, size: (0.08) * K.spark, size1: (0.05) * K.spark, r: 0.82, g: 0.88, b: 0.95, a: 0.6, a1: 0 });
          continue;
        }
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
        if (w.isMined && w.isMined(Math.floor(x), Math.floor(y))) continue;
        const sp = 1.0 + env.wind * 1.6;   // calm drift even in strong wind (≤ ~2.7 tiles/s)
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
        const sp = 0.25 + env.wind * 1.1; // ≤ ~1.4 tiles/s: leaves float, never shoot
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
        if (!ok || (w.caveDark && w.caveDark(x, y) > 0.2)) continue;
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
    const wantBf = !g.wildlife && day > 0.5 && this.flowers.length ? Math.min(9, Math.round(this.flowers.length / 6) + 1) : 0; // wildlife.js has its own
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

    // ---------- caves: dust motes drifting through torch light ----------
    if (this.caveLights.length) {
      this.acc.caveMote += dt * Math.min(4, this.caveLights.length) * 2.2;
      while (this.acc.caveMote > 1) {
        this.acc.caveMote -= 1;
        const o = this.caveLights[Math.floor(rnd() * this.caveLights.length)];
        if (o.fire === false || o.lit === false) continue;
        const R = Math.min(2.6, (o.light.radius || 3) * 0.55), a = rnd() * TAU, d = Math.sqrt(rnd()) * R;
        const x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d * 0.8;
        if (w.isRock(Math.floor(x), Math.floor(y))) continue;
        const k = 1 - d / R;
        P.emit({ spr: this.S.spark, x, y, lift: 0.2 + rnd() * 1.4, vx: (rnd() - 0.5) * 0.08, vy: (rnd() - 0.5) * 0.06, vlift: (rnd() - 0.45) * 0.06, drag: 0.1,
          life: 4 + rnd() * 4, size: (0.07 + rnd() * 0.06) * K.spark, size1: (0.05) * K.spark, r: 1, g: 0.82, b: 0.55, a: 0.32 * k + 0.05, a1: 0, fadeIn: 1.2, layer: 'emissive', ground: false });
      }
    }

    // ---------- caves: water dripping from the ceiling ----------
    this.nextDrip -= dt;
    if (this.nextDrip <= 0) {
      this.nextDrip = 0.7 + rnd() * 2.2;
      if (this.caveTiles.length) {
        const i = this.caveTiles[Math.floor(rnd() * this.caveTiles.length)];
        const x = (i % w.W) + 0.15 + rnd() * 0.7, y = Math.floor(i / w.W) + 0.2 + rnd() * 0.7;
        this.drips.push({ x, y, t: 0, h: 1.5 + rnd() * 0.6 });
      }
    }
    for (let k = this.drips.length - 1; k >= 0; k--) {
      const d = this.drips[k];
      d.t += dt;
      d.lift = d.h - 4.9 * d.t * d.t;
      if (d.lift <= 0) {
        this.drips.splice(k, 1);
        P.emit({ spr: this.S.ring, x: d.x, y: d.y, life: 0.6, size: (0.04) * K.ring, size1: (0.32) * K.ring, r: 0.8, g: 0.88, b: 1, a: 0.45, a1: 0 });
        for (let j = 0; j < 3; j++) P.emit({ spr: this.S.spark, x: d.x, y: d.y, vx: (rnd() - 0.5) * 0.7, vy: (rnd() - 0.5) * 0.35, lift: 0.02, vlift: 0.7 + rnd() * 0.6, grav: 7, life: 0.3, size: (0.06) * K.spark, size1: (0.04) * K.spark, r: 0.8, g: 0.88, b: 1, a: 0.7, a1: 0 });
        g.audio?.play?.('drip', { x: d.x, y: d.y, volume: 0.7 });
      }
    }

    // ---------- water sparkles ----------
    if (env.sunI > 0.35 && env.rain < 0.2) {
      this.acc.spark += dt * 6 * env.sunI * areaK;
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
    const fires = [], trees = [], flowers = [], mushrooms = [], caveLights = [], lights = [];
    const w = g.world;
    g.R.syncSolid?.(v.x0 - 3, v.y0 - 3, v.x1 + 3, v.y1 + 4); // contact AO follows walls / doors
    const old = new Map(this.fires.map((f) => [f.o, f]));
    w.forChunks(v.x0 - 3, v.y0 - 3, v.x1 + 3, v.y1 + 5, (c) => {
      for (const o of c.objects) {
        if (o.fire) fires.push(old.get(o) || { o, acc: 0 });
        else if (o.type && o.type.startsWith('tree_') && o.type !== 'tree_dead' && !o.stump && o.x > v.x0 - 1 && o.x < v.x1 + 1 && o.y > v.y0 && o.y < v.y1 + 2) trees.push(o);
        if (o.light && w.caveDark && o.x > v.x0 - 2 && o.x < v.x1 + 2 && o.y > v.y0 - 2 && o.y < v.y1 + 2 && w.caveDark(o.x, o.y - 0.3) > 0.4) caveLights.push(o);
        if (o.light && lights.length < 48 && o.x > v.x0 - 4 && o.x < v.x1 + 4 && o.y > v.y0 - 3 && o.y < v.y1 + 5) lights.push(o);
      }
      for (const d of c.decor) {
        if (d.x < v.x0 || d.x > v.x1 || d.y < v.y0 || d.y > v.y1 + 0.5) continue;
        if (d.t === 'flower') { if (flowers.length < 240) flowers.push(d); }
        else if (d.t === 'mushroom' && mushrooms.length < 90) mushrooms.push(d);
      }
    });
    // cave floor tiles in view
    const caveTiles = [];
    if (w.isCave) {
      const x0 = Math.max(0, Math.floor(v.x0)), x1 = Math.min(w.W - 1, Math.ceil(v.x1));
      const y0 = Math.max(0, Math.floor(v.y0)), y1 = Math.min(w.H - 1, Math.ceil(v.y1));
      for (let y = y0; y <= y1 && caveTiles.length < 400; y++) for (let x = x0; x <= x1; x++) {
        if (w.isCave(x, y)) caveTiles.push(y * w.W + x);
      }
    }
    this.fires = fires; this.trees = trees; this.flowers = flowers; this.mushrooms = mushrooms;
    this.caveTiles = caveTiles; this.caveLights = caveLights; this.lights = lights;
  }

  // adaptive render scale: drop resolution when frames are slow, recover when fast
  _perf(g) {
    const R = g.R, P = this.perf, now = performance.now();
    const raw = (now - P.last) / 1000;
    P.last = now;
    // gaps > 100 ms are throttling (background / occluded tabs keep 'visible' in some shells) or hitches, not load
    if (R.autoScale === false || raw <= 0 || raw > 0.1 || document.visibilityState !== 'visible') return;
    P.ema += (raw - P.ema) * 0.05;
    P.coolT -= raw;
    if (P.ema > 1 / 42) { P.slowT += raw; P.fastT = 0; } else if (P.ema < 1 / 56) { P.fastT += raw; P.slowT = 0; } else { P.slowT = P.fastT = 0; }
    const cur = R.renderScale || 1;
    if (P.slowT > 2.5 && P.coolT <= 0) {
      // first a little less resolution, then (auto quality) one tier down, then resolution again
      if (cur > 0.86) R.renderScale = Math.max(0.85, cur - 0.15);
      else if (qualityStepDown()) P.coolT = 5;
      else if (cur > 0.55) R.renderScale = Math.max(0.55, cur - 0.15);
      P.slowT = 0; P.coolT = Math.max(P.coolT, 3);
    } else if (P.fastT > 10 && cur < 1 && P.coolT <= 0) { R.renderScale = Math.min(1, cur + 0.1); P.fastT = 0; P.coolT = 6; }
    else if (P.fastT > 45 && cur >= 1 && P.coolT <= 0 && !P.upgraded) { P.upgraded = true; if (qualityStepUp()) { P.fastT = 0; P.coolT = 8; } }
  }

  // climate around the camera: snow share of the precipitation, per-biome colour grade (smoothed)
  _climate(g, dt) {
    const E = g.env, env = E.env, w = g.world, R = g.R, cam = g.cam;
    const cold = R.coldAt ? R.coldAt(cam.x, cam.y + 0.4) : 0;
    const sk = Math.min(1, Math.max(0, (cold - 0.45) / 0.3));
    this.snowAt += (sk - this.snowAt) * (1 - Math.exp(-dt * 2));
    env.snowAt = this.snowAt * env.rain;
    env.bloomK = this.lights.length ? 1 : 0;   // the post bloom only pays its taps when a light is in view
    this.gradeScanT -= dt;
    const T = this._gradeT;
    if (this.gradeScanT <= 0 && w.biome && w.biomeAt) {
      this.gradeScanT = 0.35;
      T.tint[0] = T.tint[1] = T.tint[2] = 0; T.lift[0] = T.lift[1] = T.lift[2] = 0; T.sat = 0; T.mist = 0;
      let n = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const G = GRADE[w.biomeAt(cam.x + i * 3, cam.y + j * 3)];
        if (!G) continue;
        n++;
        for (let c = 0; c < 3; c++) { T.tint[c] += G.tint[c]; T.lift[c] += G.lift[c]; }
        T.sat += G.sat; T.mist += G.mist;
      }
      const sn = (E.snowCover || 0) * sk;
      for (let c = 0; c < 3; c++) {
        T.tint[c] = n ? T.tint[c] / n : 1; T.lift[c] = n ? T.lift[c] / n : 0;
        T.tint[c] += (SNOW_GRADE.tint[c] - T.tint[c]) * sn; T.lift[c] += (SNOW_GRADE.lift[c] - T.lift[c]) * sn;
      }
      T.sat = n ? T.sat / n : 1; T.mist = n ? T.mist / n : 0;
      T.sat += (SNOW_GRADE.sat - T.sat) * sn; T.mist += (SNOW_GRADE.mist - T.mist) * sn;
      // underground the cave look takes over
      const ck = 1 - this.camCave;
      for (let c = 0; c < 3; c++) { T.tint[c] = 1 + (T.tint[c] - 1) * ck; T.lift[c] *= ck; }
      T.sat = 1 + (T.sat - 1) * ck; T.mist *= ck;
    }
    const k = 1 - Math.exp(-dt / 2), Gr = this.grade;
    for (let c = 0; c < 3; c++) { Gr.tint[c] += (T.tint[c] - Gr.tint[c]) * k; Gr.lift[c] += (T.lift[c] - Gr.lift[c]) * k; }
    Gr.sat += (T.sat - Gr.sat) * k; Gr.mist += (T.mist - Gr.mist) * k;
    E.grade = Gr;
  }

  // lightning: a jagged bolt for near strikes, local strike light, an event for sound / reactions
  _lightning(g, dt) {
    const E = g.env, X = E.env.extra;
    if (E.strikeId !== this._strikeId) {
      this._strikeId = E.strikeId;
      const s = E.strikes[E.strikes.length - 1];
      if (s) {
        const cam = g.cam, ang = rnd() * TAU, d = 2.5 + s.dist * 16;
        const x = cam.x + Math.cos(ang) * d, y = cam.y + 0.4 + Math.sin(ang) * d * 0.75;
        const power = s.a;
        const b = { x, y, t0: s.t, power, dist: s.dist, segs: s.dist < 0.78 ? boltPath(x, y, 9 + rnd() * 3) : null };
        this.bolts.push(b);
        if (this.bolts.length > 3) this.bolts.shift();
        g.events?.emit?.('lightning', { x, y, power, dist: s.dist });
      }
    }
    let best = 0, bx = 0, by = 0, br = 1;
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k], a = E.t - b.t0;
      if (a > 1.3 || a < -0.5) { this.bolts.splice(k, 1); continue; }
      b.k = strikePulse(Math.max(0, a));
      const I = b.k * b.power * (1 - b.dist * 0.55);
      if (I > best) { best = I; bx = b.x; by = b.y; br = 8 + b.power * 6; }
    }
    if (X.uBolt) { X.uBolt[0] = bx; X.uBolt[1] = by; X.uBolt[2] = br; X.uBolt[3] = Math.min(1.2, best * 0.9); }
  }

  // ------------------------------------------------------------------ render
  render(g, B, v, env) {
    const t = this.t;
    // terrain decals (ore deposits, rubble) for the visible tiles — see world.js chunk.decals
    if (B.decal) {
      const w = g.world, W = w.W, x0 = v.x0 - 1, x1 = v.x1 + 1, y0 = v.y0 - 1, y1 = v.y1 + 1;
      w.forChunks(x0, y0, x1, y1, (c) => {
        const L = c.decals;
        if (!L) return;
        for (let k = 0; k < L.length; k++) {
          const e = L[k], i = e >> 1, tx = i % W, ty = (i / W) | 0;
          if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
          B.decal.addRaw(tx + 0.5, ty + 0.5, 1, 1, e & 1, 0, 0, 1);
        }
      });
    }
    // firelight: warm bounce on the ground around flames + a soft halo (fake bloom) around every light
    if (this.lights.length) {
      const glow = this.spr(this.S.glow || this.S.soft), K = this.K, night = env.night, dark = Math.max(night, this.camCave);
      for (const o of this.lights) {
        const L = o.light;
        if (!L || o.dead || o.fire === false || o.lit === false || o.blueprint) continue;
        const seed = o.x * 3.1 + o.y * 1.7;
        const fl = o.fire ? 0.84 + 0.1 * Math.sin(t * 9.3 + seed) * Math.sin(t * 5.1 + seed * 2) + 0.06 * Math.sin(t * 23 + seed) : 1;
        const R = L.radius || 4, I = L.intensity ?? 1, lift = L.lift ?? 0.3;
        if (o.fire && dark > 0.05) B.light.addRaw(o.x, o.y + 0.1, R * 2.3, R * 1.7, L.r, L.g * 0.8, L.b * 0.6, 0.11 * I * fl * dark);
        const a = (0.015 + 0.17 * dark) * I * fl;
        if (a > 0.01) {
          const s = (o.fire ? 1.3 : 1.0) * (0.4 + 0.16 * Math.min(R, 7)) * K.glow;
          B.emissive.add(glow, o.x, o.y, s, s * 0.85, L.r, L.g * 0.85, L.b * 0.7, a, 0, 0, 0, 1, 0, lift);
        }
      }
    }
    // lightning bolts (near strikes): glow + white core along a jagged path from the sky to the ground
    if (this.bolts.length) {
      const soft = this.spr(this.S.soft), K = this.K;
      for (const b of this.bolts) {
        if (!b.segs || !(b.k > 0.02)) continue;
        const a = Math.min(1, b.k * b.power);
        for (const sg of b.segs) {
          const dx = sg[2] - sg[0], dy = sg[3] - sg[1], len = Math.hypot(dx, dy) + 0.05, rot = Math.atan2(-dx, dy);
          const mx = (sg[0] + sg[2]) / 2, my = (sg[1] + sg[3]) / 2, wk = sg[4];
          B.emissive.add(soft, mx, my, 0.7 * wk * K.soft, len * 1.25 * K.soft, 0.55, 0.65, 1, 0.22 * a, 0, rot);
          B.emissive.add(soft, mx, my, 0.16 * wk * K.soft, len * 1.15 * K.soft, 0.95, 0.97, 1, a, 0, rot);
        }
        const gl = this.spr(this.S.glow), gs = 2.6 * this.K.glow;
        B.emissive.add(gl, b.x, b.y, gs, gs * 0.6, 0.7, 0.78, 1, 0.35 * a);
      }
    }
    // caves: faint cool light around the player so they can still make out the walls (torches do the rest)
    if (this.eye > 0.03) {
      const p = g.player;
      B.light.addRaw(p.x, p.y - 0.35, 4.6, 4.6, 0.62, 0.68, 0.85, 0.3 * this.eye);
    }
    // falling cave drips
    if (this.drips.length) {
      const drop = this.spr(this.S.drop), K = this.K;
      for (const d of this.drips) B.fx.add(drop, d.x, d.y, 0.05 * K.drop, 0.11 * K.drop, 0.85, 0.92, 1, 0.8, 0, 0, 0, 1, 0, Math.max(0, d.lift));
    }
    // bioluminescent mushrooms at night (about a third of them glow)
    if (env.night > 0.2 && this.mushrooms.length) {
      const soft = this.spr(this.S.soft), K = this.K;
      for (const d of this.mushrooms) {
        if (d.v % 3 !== 0) continue;
        const pulse = 0.65 + 0.35 * Math.sin(t * 0.9 + d.x * 1.7 + d.y);
        const a = 0.2 * env.night * pulse;
        B.emissive.add(soft, d.x, d.y, 0.5 * K.soft * d.s, 0.38 * K.soft * d.s, 0.3, 0.85, 0.72, a, 0, 0, 0, 1, 0, 0.08);
        B.emissive.add(soft, d.x, d.y, 0.16 * K.soft * d.s, 0.13 * K.soft * d.s, 0.6, 1, 0.9, a * 1.6, 0, 0, 0, 1, 0, 0.12);
      }
    }
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

// jagged lightning path from the sky (y - H, the 3/4 view maps height to screen up) down to (x, y):
// [x0, y0, x1, y1, width] segments, main channel + 1–2 short forks
function boltPath(x, y, H) {
  const N = 9, x0 = x + (rnd() - 0.5) * 3, pts = [[x0, y - H]];
  for (let i = 1; i <= N; i++) {
    const k = i / N;
    pts.push([x0 + (x - x0) * k + (i < N ? (rnd() - 0.5) * 1.1 : 0), y - H * (1 - k)]);
  }
  const segs = [];
  for (let i = 0; i < N; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1 - i * 0.03]);
  const forks = 1 + (rnd() < 0.5 ? 1 : 0);
  for (let f = 0; f < forks; f++) {
    let [px, py] = pts[2 + Math.floor(rnd() * 4)];
    const dir = rnd() < 0.5 ? -1 : 1;
    for (let j = 0; j < 3; j++) {
      const nx = px + dir * (0.4 + rnd() * 0.6), ny = py + 0.6 + rnd() * 0.6;
      segs.push([px, py, nx, ny, 0.55 - j * 0.12]);
      px = nx; py = ny;
    }
  }
  return segs;
}

// brightness of a strike over time (three quick pulses, same shape as the scene flash in environment.js)
function strikePulse(a) {
  return Math.exp(-a * 14) + (a > 0.13 ? 0.6 * Math.exp(-(a - 0.13) * 18) : 0) + (a > 0.27 ? 0.8 * Math.exp(-(a - 0.27) * 9) : 0);
}
