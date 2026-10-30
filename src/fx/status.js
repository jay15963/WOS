// Status screen effects for the LOCAL player (cosmetic, local only): the player feels that something is
// wrong without reading the HUD. Drives the post shader through env.extra:
//   uFeelA = (hp, cold, hunger, wet)      severities 0..1, smoothed (~1 s)
//   uFeelB = (sick, warm, hitFlash, beat) beat = heartbeat pulse 0..1 (faster as HP drops)
//   uFeelC = (shakeX, shakeY, wobble, wave) screen-space displacement (0 with "reduzir movimento")
// Input: game.player.feel = { hp, cold, hunger, wet, sick, warm } (0..1 each) when the survival model
// provides it; otherwise derived from hp / hunger / buffs (cold, wet, starving, sick, poison, warm) and the
// tile under the player (wading → wet). Breath vapour puffs from the pawn when cold.
// Settings (localStorage): wos.fx.status ('0' = off, default on), wos.fx.reduceMotion ('1' = no shake /
// wobble / wave). game.reduceMotion mirrors the latter for other systems (camera shake…).

const KEY_ON = 'wos.fx.status', KEY_RM = 'wos.fx.reduceMotion';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
export const statusFxOn = () => lsGet(KEY_ON) !== '0';
export const reduceMotion = () => lsGet(KEY_RM) === '1';
export function setStatusFx(on) { lsSet(KEY_ON, on ? '1' : '0'); }
export function setReduceMotion(on) { lsSet(KEY_RM, on ? '1' : '0'); }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const has = (p, id) => !!(p.buffs && p.buffs.some((b) => b.id === id));

export function installStatusFx(game) {
  const sys = new StatusFx(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system (local screen effects), tagged above
  game.statusFx = sys;
  Object.defineProperty(game, 'reduceMotion', { get: () => sys.rm, configurable: true });
  return sys;
}

class StatusFx {
  constructor(game) {
    this.g = game;
    this.s = { hp: 0, cold: 0, hunger: 0, wet: 0, sick: 0, warm: 0 };  // smoothed severities
    this.wetT = 0;        // lingering wetness after wading
    this.hit = 0;         // red flash on damage
    this.lastHp = null;
    this.beatPh = 0;
    this.breathT = 1;
    this.t = 0;
    this.on = statusFxOn();
    this.rm = reduceMotion();
    this.cfgT = 0;
  }

  // raw target severities for this frame
  _target(g, dt) {
    const p = g.player, f = this.force || p.feel, T = this._T || (this._T = { hp: 0, cold: 0, hunger: 0, wet: 0, sick: 0, warm: 0 });
    const hpK = p.maxHp ? p.hp / p.maxHp : 1;
    // wading / rain soak linger for a while (B's model may report wet directly)
    const w = g.world, tx = Math.floor(p.x), ty = Math.floor(p.y);
    const inWater = w && w.waterAt && w.waterAt(tx, ty) > 0;
    const env = g.env.env;
    const snowK = Math.max(g.R && g.R.coldAt ? clamp01((g.R.coldAt(p.x, p.y) - 0.45) / 0.3) : 0, clamp01(((g.season?.winter) || 0) * 2 - 0.4)); // it snows here (cold biome / winter), not rains
    const roofed = w && w.roofAtPoint ? w.roofAtPoint(p.x, p.y) !== 0 && !w.isRock(tx, ty) : false; // under a roof / cave ceiling
    const rainHere = roofed ? 0 : (env.rain || 0) * (1 - snowK) * (w && w.caveDark ? 1 - w.caveDark(p.x, p.y) : 1);
    this.wetT = inWater ? 1 : Math.max(Math.max(0, this.wetT - dt / 22), rainHere > 0.5 ? 0.3 : 0);
    if (f) {
      T.hp = clamp01(f.hp ?? 0); T.cold = clamp01(f.cold ?? 0); T.hunger = clamp01(f.hunger ?? 0);
      T.wet = clamp01(Math.max(f.wet ?? 0, this.wetT)); T.sick = clamp01(f.sick ?? 0); T.warm = clamp01(f.warm ?? 0);
    } else {
      T.hp = clamp01((0.35 - hpK) / 0.3);
      T.cold = has(p, 'cold') ? 0.6 : 0;
      const hk = p.maxHunger ? p.hunger / p.maxHunger : 1;
      T.hunger = has(p, 'starving') ? 1 : clamp01((0.3 - hk) / 0.3) * 0.7;
      T.wet = Math.max(has(p, 'wet') ? 0.6 : 0, this.wetT);
      T.sick = has(p, 'sick') || has(p, 'poison') ? 0.7 : 0;
      T.warm = has(p, 'warm') ? 0.55 : 0;
    }
    if (p.dead) { T.hp = 1; T.cold = T.wet = T.warm = 0; }
    return T;
  }

  update(g, dt) {
    this.t += dt;
    this.cfgT -= dt;
    if (this.cfgT <= 0) { this.cfgT = 1; this.on = statusFxOn(); this.rm = reduceMotion(); }
    const X = g.env.env.extra, p = g.player, S = this.s;
    // red flash when the local player loses health (any source)
    if (this.lastHp != null && p.hp < this.lastHp - 0.01 && !p.dead) {
      const k = (this.lastHp - p.hp) / Math.max(1, p.maxHp || 100);
      this.hit = Math.min(1, Math.max(this.hit, 0.35 + k * 4));
    }
    this.lastHp = p.hp;
    this.hit = Math.max(0, this.hit - dt * 2.6);
    const T = this._target(g, dt);
    const k = 1 - Math.exp(-dt / 0.9);                 // ~1 s fades, never sudden
    for (const key in S) S[key] += ((this.on ? T[key] : 0) - S[key]) * k;
    // heartbeat: 62 → 130 bpm as HP drops; "lub-dub"
    const bpm = 62 + 68 * S.hp;
    this.beatPh = (this.beatPh + dt * bpm / 60) % 1;
    const ph = this.beatPh;
    const b1 = (ph - 0.08) / 0.055, b2 = (ph - 0.27) / 0.065;
    const beat = Math.exp(-b1 * b1) + 0.6 * Math.exp(-b2 * b2);
    // displacement (respects "reduzir movimento"): shiver in severe cold, dizzy wobble when starving, sick wave
    let sx = 0, sy = 0, wob = 0, wave = 0;
    if (this.on && !this.rm) {
      const shiver = clamp01((S.cold - 0.7) / 0.3);
      if (shiver > 0) {
        const tt = this.t;
        sx = (Math.sin(tt * 47) * 0.6 + Math.sin(tt * 31 + 1.3) * 0.4) * 0.0016 * shiver;
        sy = (Math.sin(tt * 39 + 0.7) * 0.6 + Math.sin(tt * 23) * 0.4) * 0.0012 * shiver;
      }
      wob = clamp01((S.hunger - 0.75) / 0.25);
      wave = S.sick;
    }
    if (X) {
      const A = X.uFeelA || (X.uFeelA = [0, 0, 0, 0]), B = X.uFeelB || (X.uFeelB = [0, 0, 0, 0]), C = X.uFeelC || (X.uFeelC = [0, 0, 0, 0]);
      A[0] = S.hp; A[1] = S.cold; A[2] = S.hunger; A[3] = S.wet;
      B[0] = S.sick; B[1] = S.warm; B[2] = this.on ? this.hit : 0; B[3] = beat * S.hp;
      C[0] = sx; C[1] = sy; C[2] = wob; C[3] = wave;
    }
    // breath vapour from the pawn's mouth when cold (world particles, drift with the wind)
    if (this.on && S.cold > 0.25 && !p.dead) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 2.2 + Math.random() * 1.2 - S.cold * 0.6;
        const P = g.particles, A = g.A, spr = A.has('fx_smoke') ? 'fx_smoke' : 'fx_soft', sw = A.get(spr).w || 1;
        const fx = p.facing === 'e' ? 0.16 : p.facing === 'w' ? -0.16 : 0, fy = p.facing === 'n' ? -0.05 : 0.06;
        const W = g.env.wind || { x: 0, y: 0 };
        for (let i = 0; i < 3; i++) {
          P.emit({ spr, x: p.x + fx + (Math.random() - 0.5) * 0.05, y: p.y + fy, lift: 0.78 + (p.lift || 0), vlift: 0.12 + Math.random() * 0.08,
            vx: fx * 1.6 + W.x * 0.35 + (Math.random() - 0.5) * 0.12, vy: fy * 1.2 + W.y * 0.2, drag: 1.2, life: 1.1 + Math.random() * 0.5,
            size: 0.08 / sw, size1: (0.36 + S.cold * 0.12) / sw, r: 0.95, g: 0.97, b: 1, a: 0.32 * Math.min(1, S.cold * 1.4), a1: 0, fadeIn: 0.12 + i * 0.08, ground: false });
        }
      }
    }
  }
}
