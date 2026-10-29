// Presentation-only feedback: screen shake, particles bursts, footsteps, and the cosmetic animation driver:
// the local player's head turn (p.headFacing) and resting poses (p.pose: sitting by a fire / on a chair,
// lying in bed) — both replicated in the presence stream so every peer draws the same — plus per-pawn
// FX derived from replicated state (heal herbs, crumbs, dirt, Zzz, respawn glow), bush / crop rustle and
// the wind fed to art/compose.js. Every sprite is guarded with atlas.has() so missing art never throws.

import { animEnv, PAWN_GAIT } from '../art/compose.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const HALF_PI = Math.PI / 2;
// things that sway when something walks through them
const RUSTLE = new Set(['bush', 'berrybush', 'herbbush', 'fibergrass', 'wild_potato', 'wild_cotton', 'wild_corn', 'crop', 'tallgrass', 'fern']);
const SEAT = /^(chair|stool|bench)/;
// dominant-axis facing from a vector
const faceOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n');
const OPP = { s: 'n', n: 's', e: 'w', w: 'e' };
const cross = (kp, k, x) => kp < x && k >= x; // action progress passed threshold x this frame

export class Juice {
  constructor(game) {
    this.g = game;
    this.trauma = 0;
    this.idleT = 0;      // local player: seconds without doing anything
    this.scanT = 0;      // throttles the seat / fire / look-target scans
    this.lookE = null;   // something alive nearby to glance at
    this.seat = null;
    this.fireNear = null;
    this.sleepT = 0;
  }

  spr(...names) {
    const A = this.g.A;
    for (const n of names) if (n && A.has(n)) return n;
    return null;
  }

  emit(o) { if (o.spr) this.g.particles.emit(o); }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  update(dt) {
    const g = this.g;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const k = this.trauma * this.trauma * 0.22;
    const t = g.time * 37;
    g.shakeOff.x = k * (Math.sin(t) * 0.6 + Math.sin(t * 2.3 + 1) * 0.4);
    g.shakeOff.y = k * (Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 3.1) * 0.4);
    this.wind();
    const p = g.player;
    if (p) { this.look(p, dt); this.rest(p, dt); }
    this.pawns(dt);
  }

  // ---------- animation driver ----------
  wind() {
    const E = this.g.env, W = E?.wind;
    if (W && typeof W === 'object') { animEnv.wx = W.x ?? 0; animEnv.wy = W.y ?? 0; animEnv.gust = W.gust ?? 0; }
    else {
      const e = E?.env, sp = typeof e?.wind === 'number' ? e.wind : 0.2;
      animEnv.wx = sp * (e?.windDir?.[0] ?? 1); animEnv.wy = sp * (e?.windDir?.[1] ?? 0); animEnv.gust = e?.gust ?? 0;
    }
    animEnv.wt = this.g.worldTime || 0;
  }

  // head turned toward the target, else glance at something alive nearby, else look around when idle
  look(p, dt) {
    const g = this.g;
    if (p.dead) { p.headFacing = null; return; }
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.45;
      let best = null, bd = 36;
      for (const e of g.entities) {
        if (e === p || e.dead || !e.isEntity) continue;
        const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      this.lookE = best;
      this.seatScan(p);
    }
    const tg = p.target && !p.target.dead ? p.target : this.lookE && !this.lookE.dead ? this.lookE : null;
    let hf = null;
    if (tg) hf = faceOf(tg.x - p.x, tg.y - p.y);
    else if (!p.moving && this.idleT > 2.5) {
      // idle glances: a few seconds to one side now and then (cosmetic)
      const u = (g.time * 0.21 + 0.37) % 1;
      if (u > 0.55 && u < 0.72) hf = p.facing === 's' || p.facing === 'n' ? 'e' : 's';
      else if (u > 0.82 && u < 0.92) hf = p.facing === 's' || p.facing === 'n' ? 'w' : 's';
    }
    p.headFacing = hf && hf !== p.facing && hf !== OPP[p.facing] ? hf : null;
  }

  // nearest seat / lit campfire around the player (throttled with the look scan)
  seatScan(p) {
    const S = this.g.build?.structures;
    this.seat = null; this.fireNear = null;
    if (!S || p.moving) return;
    let sd = 0.85, fd = 2.9;
    for (const o of S) {
      if (o.blueprint || o.removed || o.gone) continue;
      const d = Math.hypot(o.x - p.x, (o.cy ?? o.y) - p.y);
      if (SEAT.test(o.type) && d < sd) { sd = d; this.seat = o; }
      else if (o.type === 'campfire' && o.fire !== false && o.lit !== false && d < fd) { fd = d; this.fireNear = o; }
    }
  }

  // sitting down when idle (on a chair, or on the ground by a fire), waking up from bed
  rest(p, dt) {
    const busy = p.moving || p.action || p.work || p.dead || p.inCombat || p.charge || p.cast || (p._swim || 0) > 0.3 || (p.autoAttack && p.target && !p.target.dead);
    const P = p.pose;
    if (P) {
      const gone = P.o && (P.o.gone || P.o.removed);
      const h = this.g.env?.hour ?? 12;
      if (P.type === 'sleep') this.sleepT += dt;
      if (busy || gone || (P.type === 'sleep' && h > 6 && h < 19 && this.sleepT > 4)) { p.pose = null; this.idleT = 0; }
      return;
    }
    if (busy) { this.idleT = 0; return; }
    this.idleT += dt;
    if (this.seat && this.idleT > 1.4 && !this.seat.gone) {
      if (this.seat.face) p.facing = this.seat.face; // sit the way the chair faces (A's rotated props)
      p.pose = { type: 'sit', id: this.seat.id, o: this.seat };
      return;
    }
    if (this.fireNear && this.idleT > 4.5) {
      p.facing = faceOf(this.fireNear.x - p.x, (this.fireNear.cy ?? this.fireNear.y) - p.y);
      p.pose = { type: 'sit', id: null, o: null };
    }
  }

  // called when the local player uses a bed at night: lie down until moving (or morning)
  lieDown(o) {
    const p = this.g.player;
    if (!p || p.dead || !o) return;
    p.action = null;
    p.pose = { type: 'sleep', id: o.id, o };
    this.sleepT = 0;
    this.idleT = 0;
  }

  // per-pawn cosmetic FX for the local player and remote players (same replicated state on every peer)
  pawns(dt) {
    const g = this.g, v = g.view ? g.view() : null;
    for (const e of g.entities) {
      if (e.kind !== 'pawn' || (e !== g.player && !e.remote)) continue;
      if (v && (e.x < v.x0 - 2 || e.x > v.x1 + 2 || e.y < v.y0 - 2 || e.y > v.y1 + 3)) continue;
      // respawn glow seen by others (the owner plays its own in respawnPlayer)
      if (e._jd && !e.dead && e !== g.player) this.levelUp(e);
      e._jd = !!e.dead;
      if (e.dead) continue;
      this.water(e, dt);
      this.footsteps(e);
      this.rustle(e);
      const a = e.action;
      const type = a ? a.type : null;
      const k = a ? a.t : 1;
      if (type !== e._jt || (a && k < (e._jk ?? 1) - 0.3)) e._jk = -1; // new action / work cycle restarted
      const kp = e._jk ?? -1;

      if (type === 'heal' || type === 'bandage') {
        if (k < 0.5 && Math.random() < dt * 22) this.herbBits(e, 1);
        if (cross(kp, k, 0.55)) this.herbBits(e, 5);
      } else if (type === 'eat') {
        if (cross(kp, k, 0.28) || cross(kp, k, 0.61) || cross(kp, k, 0.94)) this.crumbs(e);
      } else if (type === 'plant') {
        if (cross(kp, k, 0.25) || cross(kp, k, 0.75)) this.dirt(e, 3);
      } else if (type === 'harvest') {
        if (cross(kp, k, 0.58)) { this.dirt(e, 5); this.leaves(e.x + this.fwd(e) * 0.3, e.y + 0.05, 3, 0.35); }
      }
      e._jk = k;
      e._jt = type;
      // Zzz rising from a sleeper
      if (e.pose?.type === 'sleep') {
        e._zt = (e._zt ?? 0.8) - dt; // first one once the sleeper has been drawn (head position known)
        if (e._zt <= 0) { e._zt = 1.5; this.zzz(e); }
      } else e._zt = null;
    }
  }

  fwd(e) { return e.facing === 'e' ? 1 : e.facing === 'w' ? -1 : 0; }

  // footsteps on the gait clock (contact = every half cycle of art/compose.js's walk): dust + step sound
  footsteps(e) {
    if (!e.moving || e.pose || e._swim > 0.5) return;
    const k = Math.floor((e.moveT * PAWN_GAIT - HALF_PI) / Math.PI);
    if (k === e._stepK) return;
    const first = e._stepK == null;
    e._stepK = k;
    if (first) return;
    const w = this.g.world;
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    const side = (k & 1 ? 1 : -1) * 0.1;
    const lat = e.facing === 'e' || e.facing === 'w';
    const sx = lat ? 0 : side, sy = lat ? side * 0.4 : 0;
    const me = e === this.g.player;
    if (w.waterAt(tx, ty) === 1) {
      this.splash(e.x + sx, e.y + sy, 0.7);
      if (me) this.g.audio?.play('splash', { x: e.x, y: e.y, volume: 0.35 });
    } else {
      const s = this.spr('fx_dust', 'fx_smoke');
      const dusty = w.groundAt(tx, ty) !== 4; // marsh: no dust
      const run = (e._gs || 0) > 5;
      if (s && dusty) {
        for (let i = 0; i < (run ? 3 : 2); i++) this.emit({ spr: s, x: e.x + sx + rnd(-0.06, 0.06), y: e.y + sy + rnd(-0.02, 0.04), vx: rnd(-0.3, 0.3) - this.fwd(e) * (run ? 0.5 : 0.2), vy: rnd(-0.1, 0.1), life: rnd(0.45, 0.7), size: 0.16, size1: run ? 0.5 : 0.42, r: 0.72, g: 0.62, b: 0.48, a: s === 'fx_dust' ? 0.55 : 0.32, a1: 0, lift: 0.04, vlift: 0.25, drag: 3 });
      }
      if (me) this.g.audio?.play('step', { x: e.x, y: e.y, volume: 0.25 });
    }
  }

  // bushes, tall plants and crops sway (and shed a leaf) when someone walks through them
  rustle(e) {
    if (!e.moving) return;
    const cx = Math.round(e.x * 2), cy = Math.round(e.y * 2);
    if (cx === e._rcx && cy === e._rcy) return; // only when entering a new half-tile cell
    e._rcx = cx; e._rcy = cy;
    const g = this.g, x = e.x, y = e.y;
    g.world.forChunks(x - 0.8, y - 0.8, x + 0.8, y + 0.8, (c) => {
      for (const o of c.objects) {
        if (!RUSTLE.has(o.type) || Math.abs(o.x - x) > 0.6 || Math.abs(o.y - y) > 0.45) continue;
        if ((o.shake || 0) < 0.5) {
          o.shake = 0.75;
          (g.shaking ||= new Set()).add(o);
          if (o.type !== 'crop' && Math.random() < 0.6) this.leaves(o.x, o.y, 1, 0.4);
          if (e === g.player) g.audio?.play('rustle', { x: o.x, y: o.y, volume: 0.3 });
        }
      }
    });
  }

  // swimming in deep water (from the tile under the avatar, same on every peer) and the wet look after it:
  // e._swim 0..1 and e._wet 0..1 are read by art/compose.js; splashes while swimming, drips while drying
  water(e, dt) {
    const deep = this.g.world.waterAt(Math.floor(e.x), Math.floor(e.y)) === 2;
    e._swim = (e._swim || 0) + ((deep ? 1 : 0) - (e._swim || 0)) * Math.min(1, dt * 5);
    if (deep) {
      e._wet = 1;
      if (Math.random() < dt * (e.moving ? 1.1 : 0.35)) this.splash(e.x + rnd(-0.2, 0.2), e.y + 0.03, 0.4);
    } else if (e._wet > 0) {
      e._wet = Math.max(0, e._wet - dt / 35);
      if (e._wet > 0.15 && Math.random() < dt * 5 * e._wet) this.drip(e);
    }
  }

  drip(e) {
    const s = this.spr('fx_drop', 'fx_soft');
    if (s) this.emit({ spr: s, x: e.x + rnd(-0.2, 0.2), y: e.y + rnd(-0.03, 0.03), vx: 0, vy: 0, life: 0.45, size: 0.1, size1: 0.06, r: 0.7, g: 0.85, b: 1, a: 0.85, a1: 0.3, lift: rnd(0.15, 0.45), vlift: -0.4, grav: 6 });
  }

  // ---------- small bursts used by the poses ----------
  herbBits(e, n) {
    const s = this.spr('fx_leaf', 'fx_spark');
    if (!s) return;
    const f = this.fwd(e);
    for (let i = 0; i < n; i++) this.emit({ spr: s, x: e.x + f * 0.15 + rnd(-0.06, 0.06), y: e.y + (e.facing === 's' ? 0.05 : e.facing === 'n' ? -0.05 : 0), vx: rnd(-0.4, 0.4), vy: rnd(-0.1, 0.1), life: rnd(0.35, 0.6), size: rnd(0.22, 0.34), size1: 0.1, r: 0.55, g: 1, b: 0.45, a: 1, a1: 0, rot: rnd(0, 6), vr: rnd(-6, 6), lift: 0.32, vlift: rnd(0.2, 0.9), grav: 2.5, drag: 1.5 });
  }

  crumbs(e) {
    const s = this.spr('fx_spark', 'fx_soft');
    if (!s) return;
    const f = this.fwd(e);
    for (let i = 0; i < 3; i++) this.emit({ spr: s, x: e.x + f * 0.12 + rnd(-0.05, 0.05), y: e.y + 0.02, vx: rnd(-0.5, 0.5), vy: rnd(0, 0.2), life: rnd(0.3, 0.5), size: 0.16, size1: 0.1, r: 0.85, g: 0.62, b: 0.42, a: 1, a1: 0.3, lift: 0.62, vlift: rnd(0, 0.6), grav: 6 });
  }

  dirt(e, n) {
    const s = this.spr('fx_spark', 'fx_soft');
    if (!s) return;
    const f = this.fwd(e), fy = e.facing === 's' ? 0.18 : e.facing === 'n' ? -0.18 : 0;
    for (let i = 0; i < n; i++) this.emit({ spr: s, x: e.x + f * 0.3 + rnd(-0.08, 0.08), y: e.y + fy + rnd(-0.03, 0.03), vx: rnd(-0.6, 0.6), vy: rnd(-0.2, 0.2), life: rnd(0.3, 0.5), size: 0.3, size1: 0.2, r: 0.45, g: 0.33, b: 0.22, a: 1, a1: 0.4, lift: 0.04, vlift: rnd(0.6, 1.4), grav: 7 });
  }

  zzz(e) {
    const s = this.spr('pawn_zz');
    if (!s) return;
    const x = e._zx ?? e.x, y = e._zy ?? e.y;
    this.emit({ spr: s, x: x + 0.1, y, vx: 0.18, vy: 0, life: 2.2, size: 0.35, size1: 0.7, r: 0.85, g: 0.9, b: 1, a: 0.9, a1: 0, fadeIn: 0.2, lift: 0.4, vlift: 0.28, rot: -0.2, vr: 0.15, ground: false });
  }

  // a boulder breaking up: chunks of rock tumbling out
  crumble(o) {
    const s = this.spr('pebble_0', 'fx_spark');
    const sc = o.s || 1;
    if (s) for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(0.8, 2.2);
      this.emit({ spr: s, x: o.x + Math.cos(a) * 0.2 * sc, y: o.y + Math.sin(a) * 0.08, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.45, life: rnd(0.6, 1.0), size: rnd(0.5, 0.9) * sc, size1: 0.4 * sc, r: 0.85, g: 0.83, b: 0.8, a: 1, a1: 0.6, rot: rnd(0, 6), vr: rnd(-8, 8), lift: rnd(0.15, 0.45) * sc, vlift: rnd(1.5, 3), grav: 10, drag: 1.2 });
    }
    const r = this.spr('fx_ring');
    if (r) this.emit({ spr: r, x: o.x, y: o.y, life: 0.55, size: 0.4 * sc, size1: 1.8 * sc, r: 0.72, g: 0.68, b: 0.62, a: 0.5, a1: 0, lift: 0.01 });
  }

  // a tree hit by an axe: the canopy sheds a burst of leaves (a few keep drifting down with the wind)
  treeHit(o, toward) {
    const sc = o.s || 1;
    this.leaves(o.x, o.y, 5, 1.9 * sc);
    const s = this.spr('fx_leaf');
    if (s) for (let i = 0; i < 3; i++) this.emit({ spr: s, x: o.x + rnd(-0.9, 0.9) * sc, y: o.y + rnd(-0.1, 0.15), vx: rnd(-0.3, 0.3) + animEnv.wx * 0.6, vy: rnd(0, 0.1), life: rnd(2.2, 3.2), size: rnd(0.6, 0.9), size1: 0.5, a: 1, a1: 0, rot: rnd(0, 6), vr: rnd(-3, 3), lift: rnd(1.6, 2.4) * sc, vlift: rnd(-0.1, 0.1), grav: 0.35, drag: 1.2 });
    void toward;
  }

  // a felled tree hits the ground: leaves along the canopy, dust along the trunk and a ring
  treeLand(o, dir) {
    const sc = o.s || 1;
    for (let i = 0; i < 4; i++) {
      const d = (0.7 + i * 0.55) * sc;
      this.leaves(o.x + dir * d, o.y, i < 2 ? 2 : 4, 0.35);
      this.puff(o.x + dir * d, o.y + rnd(-0.05, 0.05), 3, [0.6, 0.55, 0.45], 0.7 + i * 0.1);
    }
    const r = this.spr('fx_ring');
    if (r) this.emit({ spr: r, x: o.x + dir * 1.5 * sc, y: o.y, life: 0.6, size: 0.6, size1: 3.2 * sc, r: 0.7, g: 0.64, b: 0.52, a: 0.45, a1: 0, lift: 0.01 });
  }

  splash(x, y, scale = 1) {
    const s = this.spr('fx_splash');
    if (s) this.emit({ spr: s, x, y, life: 0.45, size: 0.3 * scale, size1: 0.8 * scale, a: 0.8, a1: 0, lift: 0.02 });
    const d = this.spr('fx_drop', 'fx_soft');
    if (d) for (let i = 0; i < 4; i++) this.emit({ spr: d, x: x + rnd(-0.1, 0.1), y, vx: rnd(-0.6, 0.6), vy: rnd(-0.2, 0.2), life: 0.45, size: 0.12 * scale, size1: 0.06, r: 0.75, g: 0.88, b: 1, a: 0.8, a1: 0, lift: 0.05, vlift: rnd(1.2, 2.0), grav: 7 });
    const r = this.spr('fx_ring');
    if (r) this.emit({ spr: r, x, y, life: 0.5, size: 0.15 * scale, size1: 0.7 * scale, r: 0.8, g: 0.92, b: 1, a: 0.5, a1: 0, lift: 0.01 });
  }

  hit(x, y, crit, color) {
    const sl = this.spr('fx_slash');
    if (sl) this.emit({ spr: sl, x, y, life: 0.22, size: crit ? 1.0 : 0.7, size1: crit ? 1.3 : 0.9, a: 0.95, a1: 0, rot: rnd(-1, 1), lift: 0.45, ground: false, layer: 'emissive', r: 1, g: 0.95, b: 0.85 });
    const sp = this.spr('fx_spark');
    const c = color || [1, 0.85, 0.6];
    if (sp) for (let i = 0; i < (crit ? 12 : 6); i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(1.5, crit ? 4.5 : 3);
      this.emit({ spr: sp, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, life: rnd(0.2, 0.4), size: crit ? 0.7 : 0.5, size1: 0.1, r: c[0], g: c[1], b: c[2], a: 1, a1: 0, lift: 0.45, vlift: rnd(-0.5, 2), drag: 4, layer: 'emissive', ground: false });
    }
  }

  blood(x, y, n = 5) {
    const s = this.spr('fx_drop', 'fx_soft');
    if (!s) return;
    for (let i = 0; i < n; i++) this.emit({ spr: s, x, y, vx: rnd(-1.2, 1.2), vy: rnd(-0.4, 0.4), life: rnd(0.3, 0.55), size: 0.13, size1: 0.08, r: 0.6, g: 0.06, b: 0.05, a: 0.9, a1: 0, lift: 0.4, vlift: rnd(0.5, 2.5), grav: 9 });
  }

  puff(x, y, n = 6, col = [0.75, 0.68, 0.58], size = 0.5) {
    const s = this.spr('fx_dust', 'fx_smoke');
    if (!s) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.emit({ spr: s, x: x + Math.cos(a) * 0.15, y: y + Math.sin(a) * 0.08, vx: Math.cos(a) * rnd(0.4, 1.2), vy: Math.sin(a) * rnd(0.2, 0.6), life: rnd(0.5, 0.9), size: size * 0.4, size1: size, r: col[0], g: col[1], b: col[2], a: 0.5, a1: 0, lift: 0.05, vlift: 0.3, drag: 2.5 });
    }
  }

  leaves(x, y, n = 6, h = 1.6) {
    const s = this.spr('fx_leaf');
    if (!s) return;
    for (let i = 0; i < n; i++) this.emit({ spr: s, x: x + rnd(-0.6, 0.6), y: y + rnd(-0.1, 0.1), vx: rnd(-0.6, 0.6), vy: rnd(-0.1, 0.2), life: rnd(1.2, 2.2), size: rnd(0.7, 1.1), size1: 0.6, a: 1, a1: 0, rot: rnd(0, 6), vr: rnd(-4, 4), lift: h * rnd(0.6, 1.1), vlift: rnd(-0.2, 0.4), grav: 0.9, drag: 1.5 });
  }

  chips(x, y, col, n = 6, lift = 0.4) {
    const s = this.spr('fx_spark', 'fx_soft');
    if (!s) return;
    for (let i = 0; i < n; i++) this.emit({ spr: s, x, y, vx: rnd(-1.6, 1.6), vy: rnd(-0.5, 0.5), life: rnd(0.35, 0.6), size: 0.45, size1: 0.3, r: col[0], g: col[1], b: col[2], a: 1, a1: 0.6, lift, vlift: rnd(1, 3), grav: 9, drag: 1 });
  }

  levelUp(p) {
    const st = this.spr('fx_star', 'fx_spark');
    if (st) for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.emit({ spr: st, x: p.x + Math.cos(a) * 0.3, y: p.y + Math.sin(a) * 0.15, vx: Math.cos(a) * rnd(0.6, 1.6), vy: Math.sin(a) * rnd(0.3, 0.8), life: rnd(0.9, 1.5), size: st === 'fx_star' ? 0.5 : 0.9, size1: 0.1, r: 1, g: 0.86, b: 0.4, a: 1, a1: 0, lift: rnd(0.2, 1.2), vlift: rnd(1, 2.6), drag: 1.5, layer: 'emissive', ground: false, rot: rnd(0, 6), vr: rnd(-3, 3) });
    }
    const r = this.spr('fx_ring');
    if (r) for (let i = 0; i < 2; i++) this.emit({ spr: r, x: p.x, y: p.y, life: 0.7 + i * 0.25, size: 0.4, size1: 3.2 + i, r: 1, g: 0.85, b: 0.4, a: 0.9, a1: 0, layer: 'emissive', lift: 0.02 });
    const soft = this.spr('fx_soft');
    if (soft) this.emit({ spr: soft, x: p.x, y: p.y, life: 0.8, size: 2, size1: 6, r: 1, g: 0.8, b: 0.4, a: 0.6, a1: 0, layer: 'emissive', lift: 0.5, ground: false });
  }

  heal(e) {
    const s = this.spr('fx_star', 'fx_spark');
    if (!s) return;
    for (let i = 0; i < 3; i++) this.emit({ spr: s, x: e.x + rnd(-0.3, 0.3), y: e.y + rnd(-0.05, 0.05), vx: 0, vy: 0, life: rnd(0.8, 1.2), size: s === 'fx_star' ? 0.3 : 0.6, size1: 0.1, r: 0.5, g: 1, b: 0.5, a: 1, a1: 0, lift: rnd(0.1, 0.6), vlift: rnd(0.6, 1.2), layer: 'emissive', ground: false });
  }

  whirl(p) {
    const s = this.spr('fx_slash', 'fx_ring');
    if (!s) return;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.emit({ spr: s, x: p.x + Math.cos(a) * 1.3, y: p.y + Math.sin(a) * 0.9, vx: -Math.sin(a) * 3, vy: Math.cos(a) * 2, life: 0.3, size: s === 'fx_slash' ? 0.9 : 0.5, size1: s === 'fx_slash' ? 1.2 : 1.1, rot: a + Math.PI / 2, a: 0.85, a1: 0, layer: 'emissive', lift: 0.4, ground: false });
    }
    const r = this.spr('fx_ring');
    if (r) this.emit({ spr: r, x: p.x, y: p.y, life: 0.4, size: 0.8, size1: 4.6, r: 1, g: 0.9, b: 0.7, a: 0.7, a1: 0, layer: 'emissive', lift: 0.02 });
    this.puff(p.x, p.y, 10, [0.75, 0.68, 0.58], 0.9);
  }

  trail(p) {
    const s = this.spr('fx_dust', 'fx_smoke');
    if (s) this.emit({ spr: s, x: p.x + rnd(-0.1, 0.1), y: p.y, life: 0.5, size: 0.3, size1: 0.7, r: 0.78, g: 0.7, b: 0.58, a: 0.5, a1: 0, lift: 0.1, vlift: 0.3 });
  }

  stun(e) {
    const s = this.spr('fx_star', 'fx_spark');
    if (!s) return;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.emit({ spr: s, x: e.x + Math.cos(a) * 0.35, y: e.y + Math.sin(a) * 0.15, vx: -Math.sin(a) * 0.8, vy: Math.cos(a) * 0.4, life: 1.2, size: s === 'fx_star' ? 0.3 : 0.5, size1: 0.2, r: 1, g: 0.95, b: 0.5, a: 1, a1: 0, lift: 0.9 * (e.scale || 1), layer: 'emissive', ground: false });
    }
  }
}
