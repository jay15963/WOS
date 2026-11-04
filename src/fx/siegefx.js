// Siege engines (game/siege.js), the look and sound around them — cosmetic, on every peer (fed by the replicated ops:
// siege.shot / siege.swing / siege.step / siege.set ramp, through game.events):
//   - the release: the trebuchet's creak and whoosh, the catapult's slam against its padded bar, dust kicked at the base
//   - the stones in flight (projectiles.js LOB_KINDS.treb_stone / cat_stone): a tumbling boulder, a dust trail, a
//     landing ring on the ground that tightens as it comes down (where it will land: everyone sees it coming)
//   - the impact: a shock ring, chunks of stone and earth, a dust cloud, a boom, the screen shakes nearby
//   - the ram: the blow lands after its back-swing — a deep boom on a gate, splinters, a tremor
//   - wheels creaking and dust under them while pushed; the tower's ramp slamming down
// Nothing here touches game state.

import { LOB_KINDS } from '../game/projectiles.js';
import { archSprite } from '../art/archCompose.js';
import { ARTY } from '../game/content/siege.js';

const rnd = Math.random;
const TAU = Math.PI * 2;
const RX = 0.547, RY = 0.359; // fx_ring ellipse radii (tiles) at scale 1

export function installSiegeFx(game) {
  const sys = new SiegeFx(game);
  sys.sync = 'cosmetic';
  game.systems.push(sys); // sync-ok: cosmetic system installed before the gameplay registry (tagged above)
  game.siegeFx = sys;
  return sys;
}

class SiegeFx {
  constructor(game) {
    this.g = game;
    const A = game.A;
    const pick = (...n) => n.find((k) => A && A.has(k)) || 'fx_soft';
    this.spr = { soft: pick('fx_smoke', 'fx_soft'), dust: pick('fx_dust', 'fx_smoke'), ring: pick('fx_ring', 'fx_soft'), chip: pick('fx_chip', 'fx_spark'), spark: pick('fx_spark', 'fx_soft') };
    this.K = {};
    for (const k in this.spr) { const s = A && A.has(this.spr[k]) ? A.get(this.spr[k]) : null; this.K[k] = s ? 1 / Math.max(0.01, s.w) : 1; }
    for (const [kind, big] of [['treb_stone', true], ['cat_stone', false]]) {
      LOB_KINDS[kind] = { h0: big ? ARTY.trebuchet.h0 : ARTY.catapult.h0, shadow: big ? 1.4 : 0.8, draw: (g, B, A2, pr) => this.drawStone(g, B, A2, pr, big), trail: (g, pr, dt) => this.trail(g, pr, dt, big), land: (g, pr, wall) => this.land(g, pr, wall, big) };
    }
    this.subbed = false;
    this.later = [];
  }
  subscribe(g) {
    if (this.subbed || !g.events) return;
    this.subbed = true;
    g.events.on('siegeshot', (d) => this.release(d));
    g.events.on('siegeram', (d) => this.later.push({ t: 0.58, fn: () => this.ramHit(d) }));
    g.events.on('siegestep', (d) => this.step(d));
    g.events.on('siegeramp', (d) => { if (d.down) this.later.push({ t: 1.15, fn: () => this.rampDown(d.o) }); else g.audio?.play('siege_winch', { x: d.o.x, y: d.o.y, volume: 0.6 }); });
  }
  near(x, y) { const p = this.g.player; return p ? Math.hypot(p.x - x, p.y - y) : 99; }
  shakeAt(x, y, amount, R = 8) { const d = this.near(x, y); if (d < R) this.g.juice?.shake?.(amount * (1 - d / R)); }

  update(g, dt) {
    this.subscribe(g);
    const L = this.later;
    for (let i = L.length - 1; i >= 0; i--) { L[i].t -= dt; if (L[i].t <= 0) { const f = L[i].fn; L.splice(i, 1); if (!g.headless) f(); } }
  }

  // ---------- the release ----------
  release(d) {
    const g = this.g, P = g.particles, K = this.K, big = d.type === 'trebuchet';
    if (g.headless || !P) return;
    g.audio?.play(big ? 'treb_release' : 'cat_fire', { x: d.x, y: d.y });
    const n = big ? 12 : 6, bx = d.x - Math.cos(d.a) * (big ? 0.8 : 0.3), by = d.y - Math.sin(d.a) * (big ? 0.8 : 0.3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = 0.4 + rnd() * (big ? 1.2 : 0.7);
      P.emit({ spr: this.spr.dust, x: bx + Math.cos(a) * 0.4, y: by + Math.sin(a) * 0.25, lift: 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vlift: 0.2 + rnd() * 0.3,
        drag: 2, life: 0.8 + rnd() * 0.6, size: 0.3 * K.dust, size1: (big ? 1.1 : 0.7) * K.dust, r: 0.82, g: 0.76, b: 0.66, a: 0.45, a1: 0, ground: false });
    }
    this.shakeAt(d.x, d.y, big ? 0.3 : 0.14, big ? 7 : 4);
    if (big) this.later.push({ t: 0.32, fn: () => g.audio?.play('swing_heavy', { x: d.x, y: d.y, volume: 0.9, pitch: 0.55 }) });
    this.later.push({ t: big ? 2.4 : 0.9, fn: () => g.audio?.play('siege_winch', { x: d.x, y: d.y, volume: big ? 0.7 : 0.5 }) });
  }

  // ---------- the stones ----------
  drawStone(g, B, A, pr, big) {
    const ring = A.has('fx_ring') ? A.get('fx_ring') : null, blob = A.has('fx_blob') ? A.get('fx_blob') : null;
    if (!pr.stuck && ring) {
      // where it comes down (everyone sees it: a ring tightening as it falls)
      const k = Math.min(1, pr.k || 0), R0 = big ? 2.0 : 1.3, R = R0 * (1.4 - 0.4 * k), a = 0.25 + 0.65 * k, pulse = 1 + 0.05 * Math.sin(g.time * 14);
      B.blob.add(ring, pr.lx, pr.ly, (R * pulse) / RX, (R * pulse) / RY, 1, 0.5, 0.3, a);
      B.fx.add(ring, pr.lx, pr.ly, (R * pulse) / RX, (R * pulse) / RY, 1, 0.55, 0.35, a * 0.35);
      if (blob) B.blob.add(blob, pr.lx, pr.ly, (R * 2) / blob.w, (R * 1.3) / blob.h, 0.6, 0.25, 0.15, 0.16 * k);
      const night = g.env?.env?.night || 0;
      if (night > 0.1) B.emissive.add(ring, pr.lx, pr.ly, R / RX, R / RY, 0.8, 0.4, 0.2, 0.6 * a * night);
    }
    if (pr.stuck) return true;
    const S = archSprite(A, big ? 'proj_treb_stone' : 'proj_cat_stone'), sc = (big ? 1.0 : 0.85) + Math.max(0, pr.lift) * 0.02, rot = (pr.t || 0) * (big ? 4 : 7);
    if (S) B.main.add(S, pr.x, pr.y, sc, sc, 1, 1, 1, pr.alpha ?? 1, 0, rot, 0, 1, 0, pr.lift);
    else if (blob) B.main.add(blob, pr.x, pr.y, (big ? 0.5 : 0.3) / blob.w, (big ? 0.45 : 0.27) / blob.h, 0.55, 0.52, 0.48, 1, 0, 0, 0, 1, 0, pr.lift);
    return true;
  }
  trail(g, pr, dt, big) {
    pr._tr = (pr._tr || 0) + dt;
    if (!pr.whoosh && pr.k > 0.4) { pr.whoosh = true; g.audio?.play('swing_heavy', { x: pr.x, y: pr.y, volume: big ? 0.6 : 0.4, pitch: big ? 0.6 : 0.85, force: true }); }
    if (pr._tr < (big ? 0.03 : 0.05) || g.headless) return;
    pr._tr = 0;
    g.particles.emit({ spr: this.spr.soft, x: pr.x + (rnd() - 0.5) * 0.15, y: pr.y, lift: pr.lift, vlift: -0.1, drag: 1.5, life: 0.45 + rnd() * 0.3, size: (big ? 0.28 : 0.16) * this.K.soft, size1: (big ? 0.7 : 0.4) * this.K.soft, r: 0.8, g: 0.76, b: 0.7, a: 0.35, a1: 0, ground: false });
  }
  land(g, pr, wall, big) {
    const P = g.particles, K = this.K, S = this.spr, x = pr.lx, y = pr.ly;
    if (g.headless || !P) return true;
    const water = !wall && g.world.liquidAt?.(Math.floor(x), Math.floor(y)) > 0;
    if (water) { g.juice?.splash?.(x, y, big ? 1.6 : 1.0); g.audio?.play('splash', { x, y, volume: 1 }); return true; }
    P.emit({ spr: S.ring, x, y, life: 0.6, size: 0.3 * K.ring, size1: (big ? 4.2 : 2.6) * K.ring, r: 1, g: 0.92, b: 0.8, a: 0.75, a1: 0 });
    const nc = big ? 26 : 14, col = wall ? [0.62, 0.58, 0.54] : [0.5, 0.42, 0.32];
    for (let i = 0; i < nc; i++) {
      const a = rnd() * TAU, sp = 1 + rnd() * (big ? 3.4 : 2.4), st = rnd() < 0.5;
      P.emit({ spr: S.chip, x: x + Math.cos(a) * 0.2, y: y + Math.sin(a) * 0.1, lift: (wall ? 0.7 : 0.15) + rnd() * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.55,
        vlift: 1.6 + rnd() * 2.6, grav: 9, drag: 0.5, bounce: 0.3, life: 0.9 + rnd() * 0.8, hold: 0.6, size: ((big ? 0.12 : 0.08) + rnd() * 0.12) * K.chip, size1: 0.05 * K.chip,
        rot: rnd() * TAU, vr: (rnd() - 0.5) * 14, r: st ? 0.66 : col[0], g: st ? 0.63 : col[1], b: st ? 0.58 : col[2], a: 1, a1: 0 });
    }
    for (let i = 0; i < (big ? 16 : 8); i++) {
      const a = rnd() * TAU, sp = 0.5 + rnd() * 1.4;
      P.emit({ spr: S.dust, x: x + Math.cos(a) * 0.4, y: y + Math.sin(a) * 0.25, lift: 0.1 + (wall ? 0.6 : 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vlift: 0.3 + rnd() * 0.6,
        drag: 1.4, life: 1.4 + rnd() * 1, size: (big ? 0.6 : 0.4) * K.dust, size1: (big ? 2.0 : 1.2) * K.dust, r: 0.78, g: 0.72, b: 0.62, a: 0.6, a1: 0, ground: false });
    }
    g.juice?.puff?.(x, y, big ? 10 : 5, [0.62, 0.55, 0.45], big ? 1.2 : 0.8);
    g.audio?.play('siege_impact', { x, y, volume: big ? 1 : 0.7, pitch: big ? 1 : 1.3 });
    this.shakeAt(x, y, big ? 0.6 : 0.28, big ? 14 : 8);
    return true; // (gone: shattered)
  }

  // ---------- the ram ----------
  ramHit(d) {
    const g = this.g, P = g.particles, K = this.K, o = d.o;
    if (!o || !P) return;
    if (!d.hit) { g.audio?.play('swing_heavy', { x: o.x, y: o.y, volume: 0.6, pitch: 0.6 }); return; }
    g.audio?.play('ram_hit', { x: d.x, y: d.y, volume: d.hit === 1 ? 1 : 0.7 });
    for (let i = 0; i < (d.hit === 1 ? 16 : 6); i++) {
      const a = rnd() * TAU, sp = 0.8 + rnd() * 2.4;
      P.emit({ spr: this.spr.chip, x: d.x, y: d.y, lift: 0.6 + rnd() * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vlift: 0.8 + rnd() * 1.8, grav: 8, drag: 0.8,
        life: 0.7 + rnd() * 0.6, size: (0.07 + rnd() * 0.08) * K.chip, size1: 0.04 * K.chip, rot: rnd() * TAU, vr: (rnd() - 0.5) * 18, r: 0.72, g: 0.56, b: 0.38, a: 1, a1: 0 });
    }
    for (let i = 0; i < 6; i++) P.emit({ spr: this.spr.dust, x: d.x, y: d.y, lift: 0.4, vx: (rnd() - 0.5) * 1.2, vy: (rnd() - 0.5) * 0.6, vlift: 0.3, drag: 1.8, life: 0.9 + rnd() * 0.5, size: 0.3 * K.dust, size1: 0.9 * K.dust, r: 0.8, g: 0.74, b: 0.64, a: 0.5, a1: 0, ground: false });
    this.shakeAt(d.x, d.y, d.hit === 1 ? 0.35 : 0.2, 8);
  }

  // ---------- pushed ----------
  step(d) {
    const g = this.g, o = d.o, P = g.particles, K = this.K;
    if (!o || g.headless || !P) return;
    const t = g.time;
    if (!o._creakT || t - o._creakT > 1.6) { o._creakT = t; g.audio?.play('siege_roll', { x: o.x, y: o.y, volume: 0.65 }); }
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = o.tx + rnd() * o.fw, y = o.ty + rnd() * o.fh;
      P.emit({ spr: this.spr.dust, x, y, lift: 0.05, vx: (rnd() - 0.5) * 0.5, vy: (rnd() - 0.5) * 0.3, vlift: 0.15, drag: 2, life: 0.7 + rnd() * 0.4, size: 0.25 * K.dust, size1: 0.6 * K.dust, r: 0.76, g: 0.7, b: 0.6, a: 0.35, a1: 0, ground: false });
    }
  }
  rampDown(o) {
    const g = this.g;
    if (!o || o.removed) return;
    g.audio?.play('ramp_drop', { x: o.x, y: o.y });
    g.juice?.puff?.(o.x, o.y - 0.4, 6, [0.66, 0.58, 0.46], 0.8);
    this.shakeAt(o.x, o.y, 0.2, 6);
  }
}
