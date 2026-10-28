// Lightweight CPU particle system. Particles render into renderer.batches.fx (alpha, lit by scene)
// or renderer.batches.emissive (additive, glows at night).
//
// emit({ spr, x, y, vx, vy, life, size, size1, r,g,b,a, a1, rot, vr, grav, drag, layer, lift, vlift, sway })
//   lift = height above ground (world units), vlift = vertical velocity (positive = up)

export class Particles {
  constructor(max = 3000) {
    this.max = max;
    this.list = [];
  }

  emit(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      spr: o.spr || 'fx_soft', x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0,
      life: o.life || 1, t: 0, size: o.size ?? 1, size1: o.size1 ?? o.size ?? 1,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 1, a1: o.a1 ?? 0,
      rot: o.rot || 0, vr: o.vr || 0, grav: o.grav || 0, drag: o.drag ?? 0,
      layer: o.layer || 'fx', lift: o.lift || 0, vlift: o.vlift || 0, flip: o.flip || 1,
      fadeIn: o.fadeIn || 0, ground: o.ground ?? true,
    });
  }

  update(dt) {
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vlift *= dr;
      p.vlift -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.lift += p.vlift * dt;
      if (p.ground && p.lift < 0) { p.lift = 0; p.vlift = 0; p.vx *= 0.5; p.vy *= 0.5; }
      p.rot += p.vr * dt;
      L[w++] = p;
    }
    L.length = w;
  }

  draw(B, A, x0, y0, x1, y1) {
    for (const p of this.list) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 + 2) continue;
      const k = p.t / p.life;
      const s = p.size + (p.size1 - p.size) * k;
      let a = p.a + (p.a1 - p.a) * k;
      if (p.fadeIn && p.t < p.fadeIn) a *= p.t / p.fadeIn;
      const spr = p._s || (p._s = A.get(p.spr));
      B[p.layer].add(spr, p.x, p.y, s, s, p.r, p.g, p.b, a, 0, p.rot, 0, p.flip, 0, p.lift);
    }
  }
}
