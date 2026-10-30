// Seasons, the look (cosmetic, every client on its own). Reads game.season (src/game/seasons.js: smooth 0..1
// weights) and drives:
//   - art/season.js SEASON (art modules: bare tree twins, decor under the snow, spring flowers…)
//   - shader uniforms env.extra.uSeaA = (snow, ice, autumn, bloom), uSeaB = (bare, winter, autumn colour of the
//     crowns, blizzard): terrain (snow everywhere, ice, autumn litter, spring flowers), sprites (season classes), roofs
//     (snow), post (snowfall instead of rain, blizzards)
//   - env.env.snow (footsteps crunch), a whiter, thicker air in blizzards
//   - particles: spring petals drifting from the blossoming trees, breath vapour of pawns in the cold, glints on
//     the snow in the sun (falling autumn leaves: ambient.js)
// Nothing here touches game state.

import { SEASON, seasonHash } from '../art/season.js';
import { seasonOf } from '../game/seasons.js';

const rnd = Math.random;
const TAU = Math.PI * 2;

export function installSeasonFx(game) {
  const sys = new SeasonFx(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed before the gameplay registry (tagged above)
  game.seasonFx = sys;
  return sys;
}

class SeasonFx {
  constructor(game) {
    this.g = game;
    this.A = [0, 0, 0, 0];
    this.B = [0, 0, 0, 0];
    this.bz = 0;            // smoothed blizzard
    this.acc = { petal: 0, glint: 0 };
    this.scanT = 0;
    this.bloomers = [];     // blossoming trees / shrubs in view (petals)
    const A = game.A;
    const pick = (...n) => n.find((k) => A && A.has(k)) || 'fx_soft';
    this.spr = { petal: pick('fx_petal', 'fx_leaf'), soft: pick('fx_smoke', 'fx_soft'), star: pick('fx_star', 'fx_spark') };
    this.K = {};
    for (const k in this.spr) { const s = A && A.has(this.spr[k]) ? A.get(this.spr[k]) : null; this.K[k] = s ? 1 / Math.max(0.01, s.w) : 1; }
  }

  update(g, dt) {
    const S = g.season && g.season.id ? g.season : seasonOf(g);
    const E = g.env.env, X = E.extra;
    const c = S.c ?? 0;
    // art modules
    SEASON.snow = S.snow || 0; SEASON.ice = S.ice || 0; SEASON.autumn = S.autumn || 0; SEASON.bloom = S.bloom || 0;
    SEASON.bare = S.bare || 0; SEASON.winter = S.winter || 0; SEASON.wane = c > 5 && c < 9.5 ? 1 : 0;
    // blizzard: a storm in winter (smoothed like the weather)
    const bzT = SEASON.winter * Math.max(0, (E.storm || 0) * 1.1 - 0.1);
    this.bz += (bzT - this.bz) * (1 - Math.exp(-dt / 4));
    const a = this.A, b = this.B;
    a[0] = SEASON.snow; a[1] = SEASON.ice; a[2] = SEASON.autumn; a[3] = SEASON.bloom;
    // crowns keep their autumn colours on the way to winter until the leaves have dropped (not in spring)
    b[0] = SEASON.bare; b[1] = SEASON.winter; b[2] = SEASON.wane && c > 7.5 ? 1 : SEASON.autumn; b[3] = this.bz;
    if (X) { X.uSeaA = a; X.uSeaB = b; }
    E.snow = Math.max(SEASON.snow, (E.snowCover || 0) * Math.min(1, (E.snowAt || 0) * 4)); // footsteps (audio surfaceAt)
    E.season = S.id;

    if (g.headless) return;
    const v = g.view(), P = g.particles;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.6; this._scan(g, v); }
    const env = E, area = (v.x1 - v.x0) * (v.y1 - v.y0), areaK = Math.min(2.5, area / 900) * (g.quality === 'low' ? 0.5 : 1);

    // ---------- spring: petals drifting from the blossoming trees ----------
    if (SEASON.bloom > 0.15 && this.bloomers.length && env.rain < 0.6) {
      this.acc.petal += dt * SEASON.bloom * (2.5 + env.wind * 6) * Math.min(1, this.bloomers.length / 6) * areaK;
      while (this.acc.petal > 1) {
        this.acc.petal -= 1;
        const o = this.bloomers[Math.floor(rnd() * this.bloomers.length)];
        const s = o.s || 1, pink = o._pk;
        const sp = 0.3 + env.wind * 1.1;
        P.emit({ spr: this.spr.petal, x: o.x + (rnd() - 0.5) * 1.4 * s, y: o.y + (rnd() - 0.3) * 0.5, lift: (o.type === 'tree_oak' ? 1.4 + rnd() * 1.4 : 0.3 + rnd() * 0.4) * s,
          vx: env.windDir[0] * sp + (rnd() - 0.5) * 0.35, vy: env.windDir[1] * sp * 0.6 + (rnd() - 0.5) * 0.25, vlift: -0.18 - rnd() * 0.15, drag: 0.04,
          life: 6 + rnd() * 4, size: (0.09 + rnd() * 0.05) * this.K.petal, size1: 0.08 * this.K.petal, rot: rnd() * TAU, vr: (rnd() - 0.5) * 4,
          r: 1, g: pink ? 0.8 : 0.97, b: pink ? 0.88 : 0.95, a: 0.95, a1: 0, hold: 0.7, flip: rnd() < 0.5 ? -1 : 1 });
      }
    }

    // ---------- winter: breath vapour of every living pawn in view (players, raiders…) ----------
    if (SEASON.winter > 0.25) {
      const night = env.night || 0;
      for (const e of g.entities) {
        if (e.kind !== 'pawn' || e.dead || e.species === 'walker' || e.x < v.x0 - 1 || e.x > v.x1 + 1 || e.y < v.y0 - 1 || e.y > v.y1 + 2) continue;
        if (e._swim > 0.5 || (e.z || 0) > 0) continue;
        e._brT = (e._brT ?? rnd() * 3) - dt * (e.moving ? 1.6 : 1);
        if (e._brT > 0) continue;
        e._brT = 2.4 + rnd() * 1.6;
        const d = e.facing || 's', fx = d === 'e' ? 1 : d === 'w' ? -1 : 0, fy = d === 's' ? 1 : d === 'n' ? -1 : 0;
        if (d === 'n') continue; // facing away: the puff is hidden by the head
        const k = SEASON.winter;
        for (let i = 0; i < 2; i++) {
          P.emit({ spr: this.spr.soft, x: e.x + fx * 0.2, y: e.y + 0.02 + fy * 0.05, lift: 0.86 + (i ? 0.02 : 0), vx: fx * (0.35 + rnd() * 0.15) + env.windDir[0] * env.wind * 0.4 + (rnd() - 0.5) * 0.1,
            vy: fy * 0.12 + (rnd() - 0.5) * 0.06, vlift: 0.1 + rnd() * 0.08, drag: 1.1, life: 1.1 + rnd() * 0.5, size: 0.06 * this.K.soft, size1: (0.28 + rnd() * 0.1) * this.K.soft,
            r: 0.94, g: 0.96, b: 1, a: (0.3 + 0.12 * night) * k, a1: 0, fadeIn: 0.12, ground: false });
        }
      }
    }

    // ---------- winter: sunlight glinting on the snow ----------
    if (SEASON.snow > 0.6 && env.sunI > 0.4 && env.rain < 0.2 && g.quality !== 'low') {
      this.acc.glint += dt * 7 * env.sunI * SEASON.snow * areaK;
      const w = g.world;
      while (this.acc.glint > 1) {
        this.acc.glint -= 1;
        const x = v.x0 + rnd() * (v.x1 - v.x0), y = v.y0 + rnd() * (v.y1 - v.y0);
        const tx = Math.floor(x), ty = Math.floor(y);
        if (w.isRock?.(tx, ty) || w.roofAt?.(tx, ty)) continue;
        P.emit({ spr: this.spr.star, x, y, life: 0.3 + rnd() * 0.4, size: 0.03 * this.K.star, size1: (0.12 + rnd() * 0.08) * this.K.star, r: 0.92, g: 0.97, b: 1, a: 0.7 * env.sunI, a1: 0,
          rot: rnd() * TAU, layer: 'emissive' });
      }
    }
  }

  // trees / shrubs in blossom near the view (same rule as the sprite shader: per-position hash)
  _scan(g, v) {
    const list = this.bloomers;
    list.length = 0;
    if (SEASON.bloom < 0.1) return;
    g.world.forChunks(v.x0 - 2, v.y0 - 2, v.x1 + 2, v.y1 + 4, (c) => {
      for (const o of c.objects) {
        if (list.length >= 40 || o.stump || o.fall) continue;
        if (o.type !== 'tree_oak' && o.type !== 'bush' && o.type !== 'berrybush') continue;
        if (o.type === 'bush' && (((o.v | 0) / 1000) | 0) === 2) continue; // juniper shrub
        if (o.x < v.x0 - 1 || o.x > v.x1 + 1 || o.y < v.y0 || o.y > v.y1 + 3) continue;
        const h = seasonHash(o);
        const tree = o.type === 'tree_oak';
        if (tree ? h >= 0.62 || (o.v >> 4) % 3 !== 0 : h >= 0.65) continue;
        o._pk = tree ? h < 0.22 : h < 0.4;
        list.push(o);
      }
    });
  }

  // blizzard: thicker, whiter air (after env.compute, before the frame is drawn)
  render(g, B, v, env) {
    // winter nights: the snow throws the moonlight back — a little brighter, less saturated blue
    const wn = SEASON.winter * (env.night || 0);
    if (wn > 0.01) {
      env.sat *= 1 - 0.3 * wn;
      const a = env.ambient, m = (a[0] + a[1] + a[2]) / 3;
      for (let i = 0; i < 3; i++) a[i] = (a[i] + (m - a[i]) * 0.3 * wn) * (1 + 0.12 * wn);
    }
    const bz = this.bz;
    if (bz > 0.01) {
      env.fog = Math.min(0.9, env.fog + bz * 0.34);
      const L = 0.5 + 0.42 * (env.day || 0);
      for (let i = 0; i < 3; i++) env.fogCol[i] += (L * [0.94, 0.97, 1.02][i] - env.fogCol[i]) * bz * 0.85;
      env.sat *= 1 - 0.2 * bz;
    }
  }
}
