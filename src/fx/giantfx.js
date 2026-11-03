// The ice giants and the ballista, the look and sound around them — cosmetic, on every peer (fed by replicated
// state / ops: giants are entities, giant.tele / giant.rock / ballista.shot / ballista.end are ops):
//   - the smash telegraph (op giant.tele → game.teles): a danger circle on the ground where the club will land, filling
//     up until the blow; then the impact: a shock ring, ice chunks, snow and dust, a boom, the screen shakes nearby
//   - the thrown ice rock (projectiles.js LOB_KINDS.ice_rock): a tumbling boulder of ice with a frost trail, a landing
//     ring on the ground that tightens as it comes down, bursting on landing
//   - giant footsteps: a heavy thud, a puff of snow, a tremor close to the camera
//   - the ballista: the release (thump, dust, kick), the bolt biting into a wall / a giant (splinters, shards, thunk)
// Nothing here touches game state.

import { LOB_KINDS } from '../game/projectiles.js';
import { archSprite } from '../art/archCompose.js';
import { PAWN_GAIT } from '../art/compose.js';

const rnd = Math.random;
const TAU = Math.PI * 2;
const ROCK_R = 1.0; // (game/giants.js ROCK.r: the hit radius around the landing point)
const RX = 0.547, RY = 0.359; // fx_ring ellipse radii (tiles) at scale 1

export function installGiantFx(game) {
  const sys = new GiantFx(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed before the gameplay registry (tagged above)
  game.giantFx = sys;
  return sys;
}

class GiantFx {
  constructor(game) {
    this.g = game;
    const A = game.A;
    const pick = (...n) => n.find((k) => A && A.has(k)) || 'fx_soft';
    this.spr = { soft: pick('fx_smoke', 'fx_soft'), spark: pick('fx_spark', 'fx_soft'), shard: pick('fx_shard', 'fx_spark'), dust: pick('fx_dust', 'fx_smoke'), ring: pick('fx_ring', 'fx_soft'), chip: pick('fx_chip', 'fx_spark') };
    this.K = {};
    for (const k in this.spr) { const s = A && A.has(this.spr[k]) ? A.get(this.spr[k]) : null; this.K[k] = s ? 1 / Math.max(0.01, s.w) : 1; }
    this.steps = new WeakMap();
    // the ice rock (game/giants.js throwRock → op giant.rock → projectiles.fireLob)
    LOB_KINDS.ice_rock = { h0: 2.3, shadow: 1.25, draw: (g, B, A2, pr) => this.drawRock(g, B, A2, pr), trail: (g, pr, dt) => this.rockTrail(g, pr, dt), land: (g, pr, wall) => this.rockLand(g, pr, wall) };
    this.subbed = false; // (game.events exists once the systems are installed: subscribed on the first frame)
  }
  subscribe(g) {
    if (this.subbed || !g.events) return;
    this.subbed = true;
    g.events.on('ballistashot', (d) => this.ballistaShot(d));
    g.events.on('boltland', (d) => this.boltLand(d));
  }

  near(x, y) { const p = this.g.player; return p ? Math.hypot(p.x - x, p.y - y) : 99; }
  shakeAt(x, y, amount, R = 8) { const d = this.near(x, y); if (d < R) this.g.juice?.shake?.(amount * (1 - d / R)); }

  update(g, dt) {
    this.subscribe(g);
    if (g.headless) return;
    // telegraphs: count down, then the blow lands
    const T = g.teles;
    if (T && T.length) for (let i = T.length - 1; i >= 0; i--) {
      const q = T[i];
      q.t += dt;
      if (q.t >= q.dur) { this.slam(g, q); T.splice(i, 1); }
    }
    // giant footsteps (on the gait clock, like juice.footsteps)
    const v = g.view();
    for (const e of g.entities) {
      if (e.species !== 'giant' || e.dead || !e.moving) continue;
      if (e.x < v.x0 - 2 || e.x > v.x1 + 2 || e.y < v.y0 - 2 || e.y > v.y1 + 3) continue;
      const k = Math.floor(((e.moveT || 0) * PAWN_GAIT - Math.PI / 2) / Math.PI), k0 = this.steps.get(e);
      this.steps.set(e, k);
      if (k0 == null || k0 === k) continue;
      const P = g.particles, K = this.K, side = (k & 1 ? 1 : -1) * 0.22;
      for (let n = 0; n < 4; n++) P.emit({ spr: this.spr.dust, x: e.x + side + (rnd() - 0.5) * 0.4, y: e.y + (rnd() - 0.5) * 0.15, lift: 0.04, vx: (rnd() - 0.5) * 0.8, vy: (rnd() - 0.5) * 0.3, vlift: 0.2,
        drag: 2.5, life: 0.6 + rnd() * 0.4, size: 0.3 * K.dust, size1: 0.8 * K.dust, r: 0.9, g: 0.94, b: 1, a: 0.45, a1: 0, ground: false });
      g.audio?.play('giant_step', { x: e.x, y: e.y, volume: 0.8 });
      this.shakeAt(e.x, e.y, 0.07, 9);
    }
  }

  // the club lands on the marked spot: shock ring, chunks of ice, snow and dust
  slam(g, q) {
    const P = g.particles, K = this.K, S = this.spr, { x, y, r } = q;
    P.emit({ spr: S.ring, x, y, life: 0.7, size: 0.4 * K.ring, size1: 3.2 * r * K.ring, r: 1, g: 0.96, b: 0.9, a: 0.85, a1: 0 });
    P.emit({ spr: S.ring, x, y, life: 1.1, size: 0.6 * K.ring, size1: 4.6 * r * K.ring, r: 0.8, g: 0.92, b: 1, a: 0.5, a1: 0 });
    for (let i = 0; i < 22; i++) {
      const a = rnd() * TAU, sp = 1 + rnd() * 3.2;
      P.emit({ spr: S.shard, x: x + Math.cos(a) * 0.3, y: y + Math.sin(a) * 0.15, lift: 0.1 + rnd() * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55,
        vlift: 1.8 + rnd() * 2.8, grav: 9, drag: 0.5, bounce: 0.3, life: 1 + rnd() * 0.8, hold: 0.6, size: (0.12 + rnd() * 0.16) * K.shard, size1: 0.06 * K.shard,
        rot: rnd() * TAU, vr: (rnd() - 0.5) * 14, r: 0.88 + rnd() * 0.12, g: 0.96, b: 1, a: 0.95, a1: 0 });
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * TAU, sp = 0.6 + rnd() * 1.6;
      P.emit({ spr: S.dust, x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.3, lift: 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vlift: 0.3 + rnd() * 0.5,
        drag: 1.6, life: 1.2 + rnd() * 0.8, size: 0.5 * K.dust, size1: (1.4 + rnd() * 0.8) * K.dust, r: 0.92, g: 0.95, b: 1, a: 0.6, a1: 0, ground: false });
    }
    g.audio?.play('giant_smash', { x, y });
    this.shakeAt(x, y, 0.55, 10);
  }

  // ---------- the ice rock ----------
  drawRock(g, B, A, pr) {
    const S = archSprite(A, 'proj_ice_rock'), blob = A.has('fx_blob') ? A.get('fx_blob') : null, ring = A.has('fx_ring') ? A.get('fx_ring') : null;
    if (!pr.stuck && ring) {
      // the landing ring: where it comes down, tightening as it falls
      const k = Math.min(1, pr.k || 0), R = ROCK_R * (1.35 - 0.35 * k), a = 0.35 + 0.6 * k, pulse = 1 + 0.05 * Math.sin(g.time * 14);
      B.blob.add(ring, pr.lx, pr.ly, (R * pulse) / RX, (R * pulse) / RY, 1, 0.42, 0.3, a);
      B.fx.add(ring, pr.lx, pr.ly, (R * pulse) / RX, (R * pulse) / RY, 1, 0.5, 0.36, a * 0.35);
      if (blob) B.blob.add(blob, pr.lx, pr.ly, (R * 2) / blob.w, (R * 1.3) / blob.h, 0.6, 0.2, 0.15, 0.18 * k);
      const night = g.env?.env?.night || 0;
      if (night > 0.1) B.emissive.add(ring, pr.lx, pr.ly, R / RX, R / RY, 0.8, 0.3, 0.2, 0.6 * a * night);
    }
    if (pr.stuck) return true;
    const sc = 1.05 + Math.max(0, pr.lift) * 0.05, rot = (pr.t || 0) * 7;
    if (S) B.main.add(S, pr.x, pr.y, sc, sc, 1, 1, 1, pr.alpha ?? 1, 0, rot, 0, 1, 0, pr.lift);
    else if (blob) B.main.add(blob, pr.x, pr.y, 0.6 / blob.w, 0.5 / blob.h, 0.7, 0.85, 0.95, 1, 0, 0, 0, 1, 0, pr.lift);
    return true;
  }
  rockTrail(g, pr, dt) {
    pr._tr = (pr._tr || 0) + dt;
    if (pr._tr < 0.04 || g.headless) return;
    pr._tr = 0;
    g.particles.emit({ spr: this.spr.soft, x: pr.x + (rnd() - 0.5) * 0.2, y: pr.y, lift: pr.lift, vlift: -0.2, drag: 1.5, life: 0.5 + rnd() * 0.3, size: 0.25 * this.K.soft, size1: 0.55 * this.K.soft, r: 0.88, g: 0.95, b: 1, a: 0.4, a1: 0, ground: false });
    if (!pr.whoosh && pr.k > 0.4) { pr.whoosh = true; g.audio?.play('swing_heavy', { x: pr.x, y: pr.y, volume: 0.7 }); }
  }
  rockLand(g, pr, wall) {
    const P = g.particles, K = this.K, S = this.spr, x = pr.lx, y = pr.ly;
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, sp = 0.8 + rnd() * 2.4;
      P.emit({ spr: S.shard, x, y, lift: 0.15 + rnd() * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55, vlift: 1.4 + rnd() * 2.2, grav: 9, drag: 0.6, bounce: 0.3,
        life: 0.9 + rnd() * 0.7, hold: 0.6, size: (0.1 + rnd() * 0.12) * K.shard, size1: 0.05 * K.shard, rot: rnd() * TAU, vr: (rnd() - 0.5) * 16, r: 0.9, g: 0.97, b: 1, a: 0.95, a1: 0 });
    }
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU, sp = 0.4 + rnd() * 0.9;
      P.emit({ spr: S.dust, x, y, lift: 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4, vlift: 0.3, drag: 1.5, life: 1 + rnd() * 0.6, size: 0.35 * K.dust, size1: 1.1 * K.dust, r: 0.93, g: 0.96, b: 1, a: 0.55, a1: 0, ground: false });
    }
    P.emit({ spr: S.ring, x, y, life: 0.6, size: 0.3 * K.ring, size1: 2 * K.ring, r: 0.9, g: 0.96, b: 1, a: 0.6, a1: 0 });
    g.audio?.play('ice_rock_land', { x, y });
    this.shakeAt(x, y, 0.22, 6);
    void wall;
    return true; // (gone: it burst)
  }

  // ---------- the ballista ----------
  ballistaShot(d) {
    const g = this.g, P = g.particles, K = this.K;
    g.audio?.play('ballista_fire', { x: d.x, y: d.y });
    for (let i = 0; i < 6; i++) P.emit({ spr: this.spr.dust, x: d.x - Math.cos(d.a) * 0.3, y: d.y - Math.sin(d.a) * 0.3, lift: 0.3, vx: (rnd() - 0.5) * 0.8 - Math.cos(d.a) * 0.6, vy: (rnd() - 0.5) * 0.4, vlift: 0.3,
      drag: 2, life: 0.6 + rnd() * 0.4, size: 0.25 * K.dust, size1: 0.7 * K.dust, r: 0.85, g: 0.8, b: 0.72, a: 0.45, a1: 0, ground: false });
    this.shakeAt(d.x, d.y, 0.18, 3);
    setTimeout(() => g.audio?.play('ballista_crank', { x: d.x, y: d.y, volume: 0.7 }), 900);
  }
  boltLand(d) {
    const g = this.g, P = g.particles, K = this.K;
    if (!d.stuck) { g.audio?.play('arrow_ground', { x: d.x, y: d.y, volume: 1 }); return; }
    g.audio?.play('ballista_hit', { x: d.x, y: d.y });
    for (let i = 0; i < 10; i++) {
      const a = Math.atan2(-d.uy, -d.ux) + (rnd() - 0.5) * 2.2, sp = 0.8 + rnd() * 2;
      P.emit({ spr: this.spr.chip, x: d.x, y: d.y, lift: 0.5 + rnd() * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vlift: 0.8 + rnd() * 1.6, grav: 8, drag: 0.8,
        life: 0.6 + rnd() * 0.5, size: (0.07 + rnd() * 0.07) * K.chip, size1: 0.04 * K.chip, rot: rnd() * TAU, vr: (rnd() - 0.5) * 18, r: 0.86, g: 0.74, b: 0.55, a: 1, a1: 0 });
    }
    this.shakeAt(d.x, d.y, 0.12, 6);
  }

  // the danger circles on the ground (smash telegraphs)
  render(g, B) {
    const T = g.teles, A = g.A;
    if (!T || !T.length || !A.has('fx_ring')) return;
    const ring = A.get('fx_ring'), soft = A.has('fx_soft') ? A.get('fx_soft') : null, night = g.env?.env?.night || 0;
    for (const q of T) {
      const u = Math.min(1, q.t / q.dur), R = q.r, pulse = 1 + 0.04 * Math.sin(g.time * 18);
      const hot = u > 0.75 ? 1 : 0, col = hot ? [1, 0.3, 0.2] : [1, 0.55, 0.32];
      if (soft) B.blob.add(soft, q.x, q.y, (2.3 * R) / soft.w, (1.5 * R) / soft.h, col[0], col[1] * 0.6, col[2] * 0.5, 0.18 + 0.32 * u);
      B.blob.add(ring, q.x, q.y, (R * pulse) / RX, (R * pulse) / RY, col[0], col[1], col[2], 0.95);
      B.fx.add(ring, q.x, q.y, (R * pulse) / RX, (R * pulse) / RY, col[0], col[1], col[2], 0.35); // (visible through canopies)
      const ri = Math.max(0.05, R * u);
      B.blob.add(ring, q.x, q.y, ri / RX, ri / RY, 1, 0.9, 0.8, 0.85);
      if (night > 0.1) B.emissive.add(ring, q.x, q.y, R / RX, R / RY, col[0] * 0.6, col[1] * 0.4, col[2] * 0.3, 0.7 * night);
    }
  }
}
