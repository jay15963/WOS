// World composition: trees, plants, rocks, structures, stations, furniture, crops, ground decor.
// Reads state only (private `_`-prefixed caches aside), allocation-light (runs every frame).
// B = renderer.batches, A = atlas, t = time (s).
// batch.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift)
// B.ground = flat sprites drawn under everything (floors, farm plots, rugs).

import { TORCH_FLAME_LIFT, CAMPFIRE_FLAME_LIFT } from './buildings.js';

const HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  T = { flames: [], blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft') };
  for (let i = 0; i < 3; i++) T.flames.push(opt('fx_flame_' + i) || A.get('fx_flame'));
  T.stump = A.groups.tree_stump ? A.pick('tree_stump', 0) : null;
  T.sapling = A.groups.tree_sapling ? A.pick('tree_sapling', 0) : null;
  CACHE.set(A, T);
  return T;
}

// ---------- static world objects ----------
// o: { type, v, x, y, s, f, shake, fall, fallDir?(±1, defaults to f), stump, empty, flash, age, light, fire,
//      alpha?(0..1 see-through multiplier, trees/bushes) }
const TREE_SWAY = { tree_oak: 0.03, tree_pine: 0.024, tree_birch: 0.04, tree_dead: 0.015 };
export function drawStatic(B, A, o, t) {
  const T = tables(A);
  const type = o.type;
  const f = o.f || 1;
  const fl = o.flash || 0;
  if (type.charCodeAt(0) === 116 && type.startsWith('tree_')) {
    if (o.stump) {
      const s = T.stump || A.pick('tree_stump', 0);
      B.blob.add(T.blob, o.x, o.y, 0.7 * o.s, 0.5 * o.s, 1, 1, 1, 0.5);
      B.main.add(s, o.x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, fl, f);
      return;
    }
    const age = o.age ?? 1;
    if (age < 0.35 && T.sapling) {
      const k = 0.7 + age * 1.4;
      B.blob.add(T.blob, o.x, o.y, 0.45 * k, 0.35 * k, 1, 1, 1, 0.4);
      B.main.add(T.sapling, o.x, o.y, k, k, 1, 1, 1, 1, 0.08, 0, fl, f);
      return;
    }
    const s = A.pick(A.groups[type] ? type : 'tree_oak', o.v);
    let x = o.x, rot = 0, alpha = 1;
    const shk = o.shake || 0;
    if (shk > 0) { x += Math.sin(t * 57) * 0.045 * shk; rot = Math.sin(t * 43 + 1.3) * 0.028 * shk; }
    const fall = o.fall || 0;
    if (fall > 0) {
      let a;
      if (fall <= 1) a = fall * fall * fall * 0.15 + fall * fall * 0.85;
      else { const u = Math.min(1, (fall - 1) / 0.25); a = 1 - Math.sin(u * Math.PI) * 0.06 * (1 - u * 0.5); }
      rot = (o.fallDir || f) * HALF_PI * a;
      alpha = 1 - clamp01((fall - 1.1) / 0.4);
    }
    const sc = o.s * age;
    const sa = alpha;
    if (o.alpha != null) alpha *= o.alpha; // optional see-through (e.g. canopy over the player)
    B.blob.add(T.blob, o.x, o.y, 1.05 * sc, 0.85 * sc, 1, 1, 1, 0.6 * (fall > 0 ? 1 - clamp01(fall) : 1));
    const sway = fall > 0 ? 0 : TREE_SWAY[type] ?? 0.03;
    B.main.add(s, x, o.y, sc, sc, 1, 1, 1, alpha, sway, rot, fl, f);
    B.shadow.add(s, x, o.y, sc, sc, 1, 1, 1, sa, sway, rot, 0, f);
    return;
  }
  if (type === 'bush' || type === 'berrybush') {
    const name = type === 'berrybush' && o.empty ? 'berrybush_empty' : type;
    const s = A.pick(name, o.v);
    const shk = o.shake || 0;
    const x = o.x + (shk > 0 ? Math.sin(t * 50) * 0.035 * shk : 0);
    const rot = shk > 0 ? Math.sin(t * 38) * 0.05 * shk : 0;
    B.blob.add(T.blob, o.x, o.y, 0.95 * o.s, 0.62 * o.s, 1, 1, 1, 0.55);
    B.main.add(s, x, o.y, o.s, o.s, 1, 1, 1, o.alpha ?? 1, 0.05, rot, fl, f, 0.5);
    B.shadow.add(s, x, o.y, o.s, o.s, 1, 1, 1, 0.85, 0.05, rot, 0, f);
    return;
  }
  if (type === 'boulder') {
    const s = A.pick('boulder', o.v);
    const shk = o.shake || 0;
    const x = o.x + (shk > 0 ? Math.sin(t * 60) * 0.03 * shk : 0);
    B.blob.add(T.blob, o.x, o.y, 1.0 * o.s, 0.55 * o.s, 1, 1, 1, 0.5);
    B.main.add(s, x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, fl, f);
    B.shadow.add(s, x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, 0, f);
    return;
  }
  if (type === 'campfire') {
    const s = A.get('campfire');
    const sc = o.s || 1;
    B.main.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, fl, 1);
    if (o.fire !== false && o.lit !== false) {
      const seed = o.x * 1.7 + o.y;
      for (let i = 0; i < 3; i++) {
        const ph = t * (8.5 + i * 2.3) + i * 2.1 + seed;
        const k = 0.86 + 0.16 * Math.sin(ph) + 0.08 * Math.sin(ph * 2.7 + 1);
        const mid = i === 1;
        const fx = o.x + (i - 1) * 0.13 * sc + 0.025 * Math.sin(ph * 1.3);
        const fsx = (mid ? 0.92 : 0.68) * k * sc;
        const fsy = (mid ? 1.35 : 0.95) * (0.85 + 0.15 * Math.sin(ph * 0.8 + i)) * k * sc;
        B.emissive.add(T.flames[i], fx, o.y + 0.02, fsx, fsy, 1, 1, 1, 0.92, 0, (i - 1) * 0.22 + 0.08 * Math.sin(ph * 0.7), 0, 1, 0, CAMPFIRE_FLAME_LIFT * sc);
      }
      // small licking tongue that pops in and out
      const pop = Math.sin(t * 5.3 + seed) * 0.5 + 0.5;
      B.emissive.add(T.flames[(t * 3 | 0) % 3], o.x + Math.sin(t * 2.1 + seed) * 0.08, o.y, 0.35 * sc, 0.6 * pop * sc, 1, 1, 1, 0.7 * pop, 0, 0, 0, 1, 0, (CAMPFIRE_FLAME_LIFT + 0.18) * sc);
      if (T.glow) B.emissive.add(T.glow, o.x, o.y - 0.15 * sc, 1.5 * sc, 1.1 * sc, 1, 0.55, 0.25, 0.22 + 0.05 * Math.sin(t * 9 + seed), 0, 0, 0, 1, 0, 0);
    }
    return;
  }
  if (type === 'torch') {
    const s = A.get('torch');
    const sc = o.s || 1;
    B.blob.add(T.blob, o.x, o.y, 0.35 * sc, 0.25 * sc, 1, 1, 1, 0.5);
    B.main.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, fl, 1);
    B.shadow.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, 0, 1);
    if (o.fire !== false && o.lit !== false) {
      const seed = o.x * 2.3 + o.y;
      const ph = t * 11 + seed;
      const k = 0.9 + 0.12 * Math.sin(ph) + 0.06 * Math.sin(ph * 2.3);
      B.emissive.add(T.flames[0], o.x + 0.015 * Math.sin(ph * 0.9), o.y, 0.36 * k * sc, 0.5 * k * sc, 1, 1, 1, 0.95, 0, 0.1 * Math.sin(ph * 0.6), 0, 1, 0, TORCH_FLAME_LIFT * sc);
      B.emissive.add(T.flames[1], o.x, o.y, 0.24 * sc, 0.34 * (0.8 + 0.2 * Math.sin(ph * 1.7)) * sc, 1, 1, 1, 0.8, 0, -0.1, 0, 1, 0, (TORCH_FLAME_LIFT + 0.04) * sc);
      if (T.glow) B.emissive.add(T.glow, o.x, o.y, 0.6 * sc, 0.6 * sc, 1, 0.6, 0.3, 0.2, 0, 0, 0, 1, 0, TORCH_FLAME_LIFT * sc + 0.1);
    }
    return;
  }
  if (A.has(type)) {
    const s = A.get(type);
    const sc = o.s || 1;
    const item = type.charCodeAt(0) === 105 && type.startsWith('item_');
    const flat = item || type === 'bed';
    if (item) B.blob.add(T.blob, o.x, o.y, 0.42 * sc, 0.26 * sc, 1, 1, 1, 0.45);
    else if (type === 'chest') B.blob.add(T.blob, o.x, o.y, 0.9 * sc, 0.45 * sc, 1, 1, 1, 0.45);
    B.main.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, fl, f);
    if (!flat) B.shadow.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, 0, f);
  }
}

// ---------- ground decor (grass, flowers...) ----------
// subtle per-tuft tint so the carpet never looks stamped
const GRASS_TINT = [[1, 1, 1], [0.93, 0.99, 0.88], [1.05, 1.02, 0.92], [0.9, 0.95, 0.84], [1.02, 0.98, 0.86], [0.96, 1.03, 0.94], [1.08, 1.04, 0.9], [0.88, 0.93, 0.86]];
export function drawDecor(B, A, d) {
  const s = d._s || (d._s = A.pick(d.t, d.v));
  const t = d.t;
  const tint = t === 'flower' || t === 'mushroom' ? GRASS_TINT[0] : GRASS_TINT[(d.v >> 2) & 7];
  const sway = t === 'flower' || t === 'mushroom' ? 0.05 : t === 'tallgrass' || t === 'reed' ? 0.15 : 0.11;
  B.decor.add(s, d.x, d.y, d.s, d.s, tint[0], tint[1], tint[2], 1, t === 'mushroom' ? 0 : sway, 0, 0, d.f, 1);
}
