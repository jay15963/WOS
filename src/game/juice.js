// Presentation-only feedback: screen shake, particles bursts, footsteps.
// Every sprite is guarded with atlas.has() so missing art never throws.

const rnd = (a, b) => a + Math.random() * (b - a);

export class Juice {
  constructor(game) {
    this.g = game;
    this.trauma = 0;
    this.stepK = 0;
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
    this.footsteps(dt);
  }

  footsteps() {
    const p = this.g.player;
    if (!p.moving || p.dead) return;
    const k = Math.floor((p.moveT * 8.5) / Math.PI);
    if (k === this.stepK) return;
    this.stepK = k;
    const w = this.g.world;
    const tx = Math.floor(p.x), ty = Math.floor(p.y);
    const side = (k & 1 ? 1 : -1) * 0.08;
    if (p.z > 0) { this.g.audio?.play('step', { x: p.x, y: p.y, volume: 0.25, surface: this.g.levels?.surfaceOf(p) }); return; } // levels: stairs / wall top
    if (w.waterAt(tx, ty) === 1) {
      this.splash(p.x + side, p.y, 0.7);
      this.g.audio?.play('splash', { x: p.x, y: p.y, volume: 0.35 });
    } else {
      const s = this.spr('fx_dust', 'fx_smoke');
      const dusty = w.groundAt(tx, ty) !== 4; // marsh: no dust
      if (s && dusty) {
        for (let i = 0; i < 2; i++) this.emit({ spr: s, x: p.x + side + rnd(-0.06, 0.06), y: p.y + rnd(-0.02, 0.04), vx: rnd(-0.3, 0.3), vy: rnd(-0.1, 0.1), life: rnd(0.45, 0.7), size: 0.16, size1: 0.42, r: 0.72, g: 0.62, b: 0.48, a: s === 'fx_dust' ? 0.55 : 0.32, a1: 0, lift: 0.04, vlift: 0.25, drag: 3 });
      }
      this.g.audio?.play('step', { x: p.x, y: p.y, volume: 0.25 });
    }
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
