// World composition: trees, plants, rocks, pickups, structures (autotiled walls / fences / floors / farm
// plots, doors & gates), stations, furniture, lights, camp, crops and ground decor.
// Reads state only (private `_`-prefixed caches aside) and allocates nothing per frame.
// B = renderer.batches, A = atlas, t = time (s).
// batch.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift)
// B.ground = flat sprites drawn under everything (floors, farm plots, rugs, door sills); never cast shadows.
//
// Object fields read (all optional except type/x/y):
//   type, v (variant), x, y, s (scale), f (±1 flip), alpha, flash, shake (0..1)
//   trees: fall, fallDir, stump, age · bushes: empty
//   autotile (wall_* / fence_* / floor_* / farm_plot): mask 0..15 (N=1 E=2 S=4 W=8)
//   doors/gates (door_wood / gate_wood, or *_h / *_v): _openT 0..1 swing (else open), orient 'h'|'v' (else from mask)
//   rotated / edge props: face 's'|'n'|'e'|'w' (sprites <type>, <type>_n, <type>_e; w = e mirrored), fw x fh footprint,
//   tx / ty, rot; torches: _mount (wall behind -> wall torch); rug: rot (drawn rotated, centred on the footprint)
//   stations: working (furnace glow, pot steam), fire / lit (false = off)
//   crops: type 'crop' + kind ('potato'|'cotton'|'corn') or type 'crop_<kind>'; stage 0..3
//          farm_plot may also carry crop/kind + stage (drawn on top of the plot)
//   construction: progress 0..1 (< 1 = blueprint: RimWorld-blue, translucent; scaffold once work started)
//   build ghosts (drawGhost): _ghost 1 = valid (blue) / 2 = invalid (red)
//   damage: hp / maxHp (cracks below 75 / 50 / 25 %)

import { TORCH_FLAME_LIFT, CAMPFIRE_FLAME_LIFT, TORCH_WALL } from './buildings.js';
import { STRUCT_GEOM as G } from './structures.js';
import { PROP_GEOM as PG } from './stations.js';

const HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const AUTO = ['wall_wood', 'wall_stone', 'fence_wood', 'floor_wood', 'floor_stone', 'farm_plot'];
const FLAT = { floor_wood: 1, floor_stone: 1, farm_plot: 1, rug: 1 };
const CROPS = ['potato', 'cotton', 'corn'];
// footprint width (tiles) for blueprint scaffolds / crack overlays of multi-tile props
const WIDE = { workbench: 2, stonecutter: 2, loom: 2, table_wood: 2, rug: 2, tent: 2, bed: 1 };
const ROT_A = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  T = { flames: [], blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft'), smoke: opt('fx_smoke') || opt('fx_soft'), auto: {}, crop: {}, cracks: [], parts: {} };
  for (let i = 0; i < 3; i++) T.flames.push(opt('fx_flame_' + i) || opt('fx_flame'));
  T.stump = A.groups.tree_stump ? A.pick('tree_stump', 0) : null; // sync-ok: sprite table of the painter, not a world object
  T.sapling = A.groups.tree_sapling ? A.pick('tree_sapling', 0) : null;
  for (const type of AUTO) {
    const arr = [];
    for (let m = 0; m < 16; m++) arr.push(opt(type + '_' + m) || opt(type));
    T.auto[type] = arr[0] ? arr : null;
  }
  for (const k of CROPS) { const arr = []; for (let s = 0; s < 4; s++) arr.push(opt(`crop_${k}_${s}`)); T.crop[k] = arr[0] ? arr : null; }
  for (let i = 0; i < 3; i++) { const c = opt('crack_' + i); if (c) T.cracks.push(c); }
  T.scaffold = opt('scaffold_0');
  for (const n of ['door_wood_h', 'door_wood_h_frame', 'door_wood_h_leaf', 'door_wood_v', 'door_wood_v_frame', 'door_wood_v_leaf', 'door_wood_v_post',
    'door_wood_sill_h', 'door_wood_sill_v', 'gate_wood_h', 'gate_wood_h_frame', 'gate_wood_h_leaf', 'gate_wood_v', 'gate_wood_v_frame', 'gate_wood_v_leaf',
    'gate_wood_v_post', 'campfire_coals', 'furnace_glow', 'lamp_post_glow', 'banner_pole', 'cooking_pot_coals', 'brazier_coals']) T.parts[n] = opt(n);
  T.banner = []; for (let i = 0; i < 3; i++) { const c = opt('banner_cloth_' + i); if (c) T.banner.push(c); }
  T.face = {}; // type -> [n, e] facing variants (null = mirror / reuse the base)
  for (const n of ['torch_wall_s', 'torch_wall_e', 'chest_open']) T.parts[n] = opt(n);
  CACHE.set(A, T);
  return T;
}
const spriteOf = (A, type, v) => (A.groups[type] ? A.pick(type, v | 0) : A.has(type) ? A.get(type) : null);
// facing variant of a prop: front S = base, N = <type>_n (else the base mirrored), E = <type>_e, W = E mirrored
let FFLIP = 1;
function faceSprite(A, T, type, v, face) {
  FFLIP = 1;
  const base = spriteOf(A, type, v);
  if (!face || face === 's') return base;
  let fv = T.face[type];
  if (!fv) { fv = T.face[type] = [A.has(type + '_n') ? A.get(type + '_n') : null, A.has(type + '_e') ? A.get(type + '_e') : null]; }
  if (face === 'n') { if (fv[0]) return fv[0]; FFLIP = -1; return base; }
  if (face === 'w') FFLIP = -1;
  return fv[1] || base;
}

// ---------- ghost previews ----------
// structureSprite(A, type, mask?, opts?) → [sprite, scale] for a build ghost of `type` with the given
// neighbour mask (autotile types) or orientation (doors/gates: opts.orient 'h'|'v'). The returned array
// is reused between calls (copy it if you keep it). [null, 1] when unknown.
const GHOST = [null, 1];
export function structureSprite(A, type, mask = 0, opts) {
  const T = tables(A);
  GHOST[0] = null; GHOST[1] = 1;
  const auto = T.auto[type];
  if (auto) { GHOST[0] = auto[mask & 15]; return GHOST; }
  if (type === 'door_wood' || type === 'gate_wood') {
    const o = opts?.orient || ((mask & 10) || !(mask & 5) ? 'h' : 'v');
    GHOST[0] = A.has(type + '_' + o) ? A.get(type + '_' + o) : null;
    return GHOST;
  }
  if (type === 'crop' || type.startsWith('crop_')) {
    const k = type === 'crop' ? opts?.kind || 'potato' : type.slice(5);
    GHOST[0] = T.crop[k] ? T.crop[k][0] : null;
    return GHOST;
  }
  GHOST[0] = spriteOf(A, type, opts?.v ?? 0);
  return GHOST;
}

// placement ghost: the real drawing of `o` (a scratch object with type, x, y, tx, ty, rot, face, fw, fh, mask) in
// RimWorld-blue (o._ghost 1) or red (2), translucent (o.alpha)
export function drawGhost(B, A, o, t) { drawStatic(B, A, o, t); }

// ---------- shared helpers ----------
// blueprint state → globals used by the painters below (avoids per-call objects)
let CR = 1, CG = 1, CB = 1, CA = 1, BP = false;
const BP_FLASH = 0.14; // lifts the darks of blueprints a little (pale silhouette)
// blueprint tint: a strong blue boost turns warm wood / stone into RimWorld-blue (channels > 1 are fine)
function setState(o) {
  const p = o.progress;
  BP = p != null && p < 1;
  const a = o.alpha ?? 1;
  if (o._ghost) { BP = true; if (o._ghost === 2) { CR = 1.6; CG = 0.42; CB = 0.36; } else { CR = 0.36; CG = 0.78; CB = 2.1; } CA = a * 0.72; }
  else if (BP) { CR = 0.34; CG = 0.72; CB = 2.0; CA = a * (0.62 + 0.3 * clamp01(p)); }
  else { CR = CG = CB = 1; CA = a; }
}
function overlays(B, T, o, w, t) {
  // scaffold while under construction (frame stage: work started), cracks when damaged
  if (BP && !o._ghost && T.scaffold && (o.progress || 0) > 0.02) {
    const fw = o.fw || w, fh = o.fh || 1, cx = o.tx != null ? o.tx + fw / 2 : o.x;
    for (let k = 0; k < fh; k++) B.main.add(T.scaffold, cx, o.ty != null ? o.ty + fh - k : o.y - k, fw, 1, 1, 1, 1, 0.9 * (o.alpha ?? 1), 0, 0, 0, 1);
  }
  if (o.hp != null && o.maxHp > 0 && T.cracks.length) {
    const k = o.hp / o.maxHp;
    const i = k < 0.25 ? 2 : k < 0.5 ? 1 : k < 0.75 ? 0 : -1;
    if (i >= 0) B.main.add(T.cracks[Math.min(i, T.cracks.length - 1)], o.x, o.y, w, 1, 1, 1, 1, 0.85 * CA, 0, 0, 0, 1);
  }
}
const shakeX = (o, t, k = 0.035) => (o.shake > 0 ? Math.sin(t * 57) * k * o.shake : 0);
// Block shadow (walls, door frames): the sprite is flipped (sy < 0) so all of it lies below its anchor, where
// the shadow shader keeps pixels on the ground (×0.6); it is squashed to exactly the 1-tile footprint and
// every pixel is lifted by the wall height → a uniform offset copy of the footprint, so runs of walls cast
// one continuous shadow instead of a saw-tooth of per-tile billboards. (Flipped, the texture rows 0..1 land
// at [ay-1, ay] tiles below the anchor, hence the anchor at y - ay.)
function blockShadow(B, s, x, y, a) {
  B.shadow.add(s, x, y - s.ay, 1, -1 / (0.6 * s.h), 1, 1, 1, a, 0, 0, 0, 1, 0, G.FH * 1.1);
}

// ---------- static world objects ----------
const TREE_SWAY = { tree_oak: 0.03, tree_pine: 0.022, tree_birch: 0.04, tree_dead: 0.015 };
export function drawStatic(B, A, o, t) {
  const T = tables(A);
  const type = o.type;
  const f = o.f || 1;
  const fl = o._ghost || (o.progress != null && o.progress < 1) ? BP_FLASH : o.flash || 0;
  const c0 = type.charCodeAt(0);
  // ----- trees -----
  if (c0 === 116 && type.startsWith('tree_')) {
    if (o.stump) {
      const s = T.stump || A.pick('tree_stump', 0);
      B.blob.add(T.blob, o.x, o.y, 0.7 * o.s, 0.5 * o.s, 1, 1, 1, 0.5);
      B.main.add(s, o.x + shakeX(o, t), o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, fl, f);
      B.shadow.add(s, o.x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, 0, f);
      return;
    }
    const age = o.age ?? 1;
    if (age < 0.35 && T.sapling) {
      const k = 0.7 + age * 1.4;
      B.blob.add(T.blob, o.x, o.y, 0.45 * k, 0.35 * k, 1, 1, 1, 0.4);
      B.main.add(T.sapling, o.x, o.y, k, k, 1, 1, 1, 1, 0.08, 0, fl, f);
      B.shadow.add(T.sapling, o.x, o.y, k, k, 1, 1, 1, 0.8, 0.08, 0, 0, f);
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
    const x = o.x + shakeX(o, t, 0.03);
    B.blob.add(T.blob, o.x, o.y, 1.0 * o.s, 0.55 * o.s, 1, 1, 1, 0.5);
    B.main.add(s, x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, fl, f);
    B.shadow.add(s, x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, 0, f);
    return;
  }
  // ----- natural pickups -----
  if (type === 'pebble' || type === 'stick') {
    const s = spriteOf(A, type, o.v); if (!s) return;
    const sc = o.s || 1;
    B.blob.add(T.blob, o.x, o.y, 0.42 * sc, 0.22 * sc, 1, 1, 1, 0.3);
    B.main.add(s, o.x + shakeX(o, t), o.y, sc, sc, 1, 1, 1, o.alpha ?? 1, 0, 0, fl, f, 0.6);
    return;
  }
  if (type === 'fibergrass' || type === 'wild_potato' || type === 'wild_cotton' || type === 'wild_corn') {
    const s = spriteOf(A, type, o.v); if (!s) return;
    const sc = o.s || 1;
    const shk = o.shake || 0;
    const rot = shk > 0 ? Math.sin(t * 38) * 0.06 * shk : 0;
    B.blob.add(T.blob, o.x, o.y, 0.6 * sc, 0.32 * sc, 1, 1, 1, 0.4);
    const sway = type === 'fibergrass' ? 0.11 : type === 'wild_corn' ? 0.06 : 0.07;
    B.main.add(s, o.x + shakeX(o, t), o.y, sc, sc, 1, 1, 1, o.alpha ?? 1, sway, rot, fl, f, 0.5);
    B.shadow.add(s, o.x, o.y, sc, sc, 1, 1, 1, 0.75, sway, rot, 0, f);
    return;
  }
  // ----- crops -----
  if (c0 === 99 && (type === 'crop' || type.startsWith('crop_'))) { drawCrop(B, T, o, type === 'crop' ? o.kind : type.slice(5), fl, f); return; }
  // ----- autotiled structures -----
  const auto = T.auto[type];
  if (auto) {
    setState(o);
    const s = auto[(o.mask | 0) & 15];
    if (FLAT[type]) {
      B.ground.add(s, o.x, o.y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1, 1);
      if (type === 'farm_plot' && (o.crop || o.kind) && o.stage != null) drawCrop(B, T, o, o.crop || o.kind, fl, 1);
      return;
    }
    const x = o.x + shakeX(o, t, 0.025);
    B.main.add(s, x, o.y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1);
    if (!BP) {
      if (c0 === 102) B.shadow.add(s, o.x, o.y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); // fence: cast from the post foot
      else blockShadow(B, s, o.x, o.y, CA);
    }
    overlays(B, T, o, 1, t);
    return;
  }
  if (c0 === 100 && type.startsWith('door_wood')) { drawDoor(B, T, o, type, fl, true); return; }
  if (c0 === 103 && type.startsWith('gate_wood')) { drawDoor(B, T, o, type, fl, false); return; }
  // ----- fire & lights -----
  if (type === 'campfire') {
    const s = A.get('campfire');
    const sc = o.s || 1;
    setState(o);
    B.blob.add(T.blob, o.x, o.y, 0.9 * sc, 0.5 * sc, 1, 1, 1, 0.35);
    B.main.add(s, o.x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, 1);
    if (!BP && o.fire !== false && o.lit !== false) {
      const seed = o.x * 1.7 + o.y;
      if (T.parts.campfire_coals) B.emissive.add(T.parts.campfire_coals, o.x, o.y, sc, sc, 1, 1, 1, 0.75 + 0.2 * Math.sin(t * 3.1 + seed) * Math.sin(t * 7.7 + seed), 0, 0, 0, 1);
      for (let i = 0; i < 3; i++) {
        const ph = t * (8.5 + i * 2.3) + i * 2.1 + seed;
        const k = 0.86 + 0.16 * Math.sin(ph) + 0.08 * Math.sin(ph * 2.7 + 1);
        const mid = i === 1;
        const fx = o.x + (i - 1) * 0.13 * sc + 0.025 * Math.sin(ph * 1.3);
        const fsx = (mid ? 0.92 : 0.68) * k * sc;
        const fsy = (mid ? 1.35 : 0.95) * (0.85 + 0.15 * Math.sin(ph * 0.8 + i)) * k * sc;
        B.emissive.add(T.flames[i], fx, o.y + 0.02, fsx, fsy, 1, 1, 1, 0.92, 0, (i - 1) * 0.22 + 0.08 * Math.sin(ph * 0.7), 0, 1, 0, CAMPFIRE_FLAME_LIFT * sc);
      }
      const pop = Math.sin(t * 5.3 + seed) * 0.5 + 0.5;
      B.emissive.add(T.flames[(t * 3 | 0) % 3], o.x + Math.sin(t * 2.1 + seed) * 0.08, o.y, 0.35 * sc, 0.6 * pop * sc, 1, 1, 1, 0.7 * pop, 0, 0, 0, 1, 0, (CAMPFIRE_FLAME_LIFT + 0.18) * sc);
      if (T.glow) B.emissive.add(T.glow, o.x, o.y - 0.15 * sc, 1.5 * sc, 1.1 * sc, 1, 0.55, 0.25, 0.22 + 0.05 * Math.sin(t * 9 + seed), 0, 0, 0, 1, 0, 0);
    }
    overlays(B, T, o, 1, t);
    return;
  }
  if (type === 'torch') {
    const sc = o.s || 1;
    setState(o);
    const face = o.face;
    const wall = o._mount && (face === 's' || face === 'e' || face === 'w') ? T.parts[face === 's' ? 'torch_wall_s' : 'torch_wall_e'] : null;
    if (wall) {
      // wall torch: iron bracket on the wall face (lifted to wall height), torch leaning out of it
      const G2 = face === 's' ? TORCH_WALL.s : TORCH_WALL.e, fx = face === 'w' ? -1 : 1;
      B.main.add(wall, o.x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, fx, 0, G2.lift * sc);
      if (!BP && o.fire !== false && o.lit !== false) smallFlame(B, T, o.x + G2.fx * fx * sc, o.y, (G2.lift + G2.flame) * sc, sc, t, 0.9);
      return;
    }
    const s = A.get('torch');
    B.blob.add(T.blob, o.x, o.y, 0.35 * sc, 0.25 * sc, 1, 1, 1, 0.5);
    B.main.add(s, o.x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, 1);
    if (!BP) B.shadow.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, 0, 1);
    if (!BP && o.fire !== false && o.lit !== false) smallFlame(B, T, o.x, o.y, TORCH_FLAME_LIFT * sc, sc, t, 1);
    return;
  }
  if (type === 'brazier' || type === 'lamp_post' || type === 'furnace' || type === 'cooking_pot') { drawLit(B, A, T, o, type, fl, t); return; }
  if (type === 'banner') { drawBanner(B, A, T, o, fl, t); return; }
  // ----- generic props: stations, furniture, camp, items -----
  // (a chest the local player has open shows its lid up: o._lid, cosmetic)
  const lid = o._lid && type === 'chest' && (!o.face || o.face === 's') && T.parts.chest_open;
  if (lid) FFLIP = 1;
  const s = lid || (o.face ? faceSprite(A, T, type, o.v, o.face) : spriteOf(A, type, o.v));
  if (!s) return;
  const ff = o.face ? FFLIP : f;
  const sc = o.s || 1;
  setState(o);
  const x = o.x + shakeX(o, t, 0.025);
  if (FLAT[type]) {
    if (type === 'rug' && o.tx != null) B.ground.add(s, o.tx + (o.fw || 2) / 2, o.ty + (o.fh || 1) / 2, sc, sc, CR, CG, CB, CA, 0, ROT_A[(o.rot | 0) & 3], fl, 1, 1);
    else B.ground.add(s, o.x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, f, 1);
    return;
  }
  const item = c0 === 105 && type.startsWith('item_');
  if (item) {
    B.blob.add(T.blob, o.x, o.y, 0.42 * sc, 0.26 * sc, 1, 1, 1, 0.45);
    B.main.add(s, x, o.y, sc, sc, 1, 1, 1, CA, 0, 0, fl, f);
    return;
  }
  const w = o.fw || WIDE[type] || 1, h = o.fh || 1;
  B.blob.add(T.blob, o.x, o.y - 0.06 - (h - 1) * 0.5, (0.62 + 0.38 * w) * sc, (0.4 + 0.6 * (h - 1)) * sc, 1, 1, 1, 0.38 * CA);
  B.main.add(s, x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, ff);
  // (sprites of N-S footprints are ground depth, not height: no sun shadow)
  if (!BP && type !== 'bed' && h < 2) B.shadow.add(s, o.x, o.y, sc, sc * 0.8, 1, 1, 1, CA, 0, 0, 0, ff);
  overlays(B, T, o, w, t);
}

function smallFlame(B, T, x, y, lift, sc, t, k) {
  const seed = x * 2.3 + y;
  const ph = t * 11 + seed;
  const q = 0.9 + 0.12 * Math.sin(ph) + 0.06 * Math.sin(ph * 2.3);
  B.emissive.add(T.flames[0], x + 0.015 * Math.sin(ph * 0.9), y, 0.36 * q * sc * k, 0.5 * q * sc * k, 1, 1, 1, 0.95, 0, 0.1 * Math.sin(ph * 0.6), 0, 1, 0, lift);
  B.emissive.add(T.flames[1], x, y, 0.24 * sc * k, 0.34 * (0.8 + 0.2 * Math.sin(ph * 1.7)) * sc * k, 1, 1, 1, 0.8, 0, -0.1, 0, 1, 0, lift + 0.04 * k);
  if (T.glow) B.emissive.add(T.glow, x, y, 0.6 * sc * k, 0.6 * sc * k, 1, 0.6, 0.3, 0.2, 0, 0, 0, 1, 0, lift + 0.1 * k);
}

function drawCrop(B, T, o, kind, fl, f) {
  const arr = T.crop[kind] || T.crop.potato;
  if (!arr) return;
  const st = Math.max(0, Math.min(3, o.stage | 0));
  const s = arr[st] || arr[0];
  const sway = 0.04 + st * 0.025;
  B.main.add(s, o.x, o.y, 1, 1, 1, 1, 1, o.alpha ?? 1, sway, 0, fl, f, 0.6);
  if (st > 0) B.shadow.add(s, o.x, o.y - 0.3, 1, 1, 1, 1, 1, 0.75, sway, 0, 0, f, 0, -0.3);
}

// doors (wall group) and gates (fence group): frame + two leaves that fold into the jambs/posts as `open` → 1
function drawDoor(B, T, o, type, fl, isDoor) {
  setState(o);
  const P = T.parts;
  const base = isDoor ? 'door_wood' : 'gate_wood';
  let orient = o.orient;
  if (!orient) orient = type.endsWith('_v') ? 'v' : type.endsWith('_h') ? 'h' : o.mask != null && !(o.mask & 10) && (o.mask & 5) ? 'v' : 'h';
  const k = 1 - 0.86 * clamp01(o._openT ?? (o.open ? 1 : 0));
  const x0 = o.x - 0.5, y = o.y;
  if (orient === 'h') {
    const frame = P[base + '_h_frame'], leaf = P[base + '_h_leaf'];
    if (!frame || !leaf) { const s = P[base + '_h']; if (s) B.main.add(s, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1); return; }
    const L = isDoor ? G.DOOR_H : G.GATE_H;
    if (isDoor && P.door_wood_sill_h) B.ground.add(P.door_wood_sill_h, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
    B.main.add(frame, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x0 + L.l, y, k, 1, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x0 + L.r, y, -k, 1, CR, CG, CB, CA, 0, 0, fl, 1);
    if (!BP) {
      if (isDoor) blockShadow(B, frame, o.x, y, CA);
      else { B.shadow.add(frame, o.x, y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); B.shadow.add(leaf, x0 + L.l, y - 0.5, k, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); B.shadow.add(leaf, x0 + L.r, y - 0.5, -k, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); }
    }
  } else {
    const frame = P[base + '_v_frame'], leaf = P[base + '_v_leaf'], post = P[base + '_v_post'];
    if (!frame || !leaf || !post) { const s = P[base + '_v']; if (s) B.main.add(s, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1); return; }
    const L = isDoor ? G.DOOR_V : G.GATE_V;
    if (isDoor && P.door_wood_sill_v) B.ground.add(P.door_wood_sill_v, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
    B.main.add(frame, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(leaf, o.x, y - L.a, 1, k, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(leaf, o.x, y - L.b, 1, -k, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(post, o.x, y, 1, 1, CR, CG, CB, CA, 0, 0, fl, 1);
    if (!BP) {
      if (isDoor) blockShadow(B, frame, o.x, y, CA);
      else { B.shadow.add(frame, o.x, y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); B.shadow.add(post, o.x, y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); }
    }
  }
  overlays(B, T, o, 1, 0);
}

// lit props: base sprite + emissive glow / flames (+ steam for a working pot)
function drawLit(B, A, T, o, type, fl, t) {
  const s = spriteOf(A, type, o.v);
  if (!s) return;
  const sc = o.s || 1;
  const f = o.f || 1;
  setState(o);
  const x = o.x + shakeX(o, t, 0.025);
  B.blob.add(T.blob, o.x, o.y - 0.05, 0.85 * sc, 0.42 * sc, 1, 1, 1, 0.38 * CA);
  B.main.add(s, x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, f);
  if (!BP) B.shadow.add(s, o.x, o.y, sc, sc * (type === 'lamp_post' ? 1 : 0.8), 1, 1, 1, CA, 0, 0, 0, f);
  if (BP) { overlays(B, T, o, 1, t); return; }
  const seed = o.x * 1.37 + o.y * 0.71;
  const fl1 = 0.82 + 0.12 * Math.sin(t * 9.3 + seed) + 0.06 * Math.sin(t * 23.1 + seed * 2);
  if (type === 'furnace') {
    const on = o.working || o.fire === true || o.lit === true;
    if (on) {
      const gl = T.parts.furnace_glow;
      if (gl) B.emissive.add(gl, x, o.y, sc, sc, 1, 1, 1, fl1, 0, 0, 0, f);
      if (T.flames[0]) B.emissive.add(T.flames[(t * 4 | 0) % 3], x + 0.01 * Math.sin(t * 7), o.y, 0.26 * sc, 0.26 * fl1 * sc, 1, 1, 1, 0.8, 0, 0, 0, 1, 0, PG.furnaceMouth * sc);
      if (T.glow) B.emissive.add(T.glow, x, o.y, 1.1 * sc, 0.8 * sc, 1, 0.5, 0.2, 0.2 * fl1, 0, 0, 0, 1, 0, PG.furnaceMouth * sc);
    }
  } else if (type === 'cooking_pot') {
    if (o.fire !== false && o.lit !== false) {
      const coals = T.parts.cooking_pot_coals;
      if (coals) B.emissive.add(coals, x, o.y, sc, sc, 1, 1, 1, fl1, 0, 0, 0, f);
      for (let i = 0; i < 2; i++) {
        const ph = t * (9 + i * 3) + i * 2 + seed;
        const q = 0.85 + 0.15 * Math.sin(ph);
        if (T.flames[i]) B.emissive.add(T.flames[i], x + (i - 0.5) * 0.14 * sc, o.y - 0.02, 0.34 * q * sc, 0.38 * q * sc, 1, 1, 1, 0.85, 0, (i - 0.5) * 0.3, 0, 1, 0, PG.potFire * sc);
      }
      if (T.glow) B.emissive.add(T.glow, x, o.y, 1.0 * sc, 0.7 * sc, 1, 0.55, 0.25, 0.18 * fl1, 0, 0, 0, 1, 0, 0.05);
    }
    if (o.working && T.smoke) {
      for (let i = 0; i < 3; i++) { // steam wisps rising from the pot
        const u = (t * 0.45 + i / 3 + seed * 0.1) % 1;
        const a = Math.sin(u * Math.PI) * 0.42;
        B.fx.add(T.smoke, x + Math.sin(u * 6 + i * 2 + t) * 0.07, o.y, (0.28 + u * 0.4) * sc, (0.28 + u * 0.4) * sc, 0.95, 0.95, 0.95, a, 0, u * 2 + i, 0, 1, 0, (PG.potRim + u * 0.75) * sc);
      }
    }
  } else if (type === 'brazier') {
    if (o.fire !== false && o.lit !== false) {
      const coals = T.parts.brazier_coals;
      if (coals) B.emissive.add(coals, x, o.y, sc, sc, 1, 1, 1, fl1, 0, 0, 0, f);
      for (let i = 0; i < 3; i++) {
        const ph = t * (8 + i * 2.6) + i * 2.4 + seed;
        const q = 0.85 + 0.15 * Math.sin(ph) + 0.06 * Math.sin(ph * 2.2);
        if (T.flames[i]) B.emissive.add(T.flames[i], x + (i - 1) * 0.1 * sc + 0.02 * Math.sin(ph), o.y, (i === 1 ? 0.6 : 0.42) * q * sc, (i === 1 ? 0.85 : 0.6) * q * sc, 1, 1, 1, 0.9, 0, (i - 1) * 0.2, 0, 1, 0, PG.brazierFire * sc);
      }
      if (T.glow) B.emissive.add(T.glow, x, o.y, 1.4 * sc, 1.1 * sc, 1, 0.55, 0.25, 0.22 * fl1, 0, 0, 0, 1, 0, PG.brazierFire * sc);
    }
  } else if (type === 'lamp_post') {
    if (o.lit !== false && o.fire !== false) {
      const gl = T.parts.lamp_post_glow;
      const k = 0.9 + 0.1 * Math.sin(t * 13 + seed) * Math.sin(t * 5.1 + seed);
      if (gl) B.emissive.add(gl, x, o.y, sc, sc, 1, 1, 1, k, 0, 0, 0, f);
      if (T.glow) B.emissive.add(T.glow, x + PG.lampX * sc * f, o.y, 0.9 * sc, 0.9 * sc, 1, 0.75, 0.42, 0.28 * k, 0, 0, 0, 1, 0, PG.lampLift * sc);
    }
  }
  overlays(B, T, o, 1, t);
}

// banner: pole + cloth that swings around its top attachment (rot) with a little ripple (sx)
function drawBanner(B, A, T, o, fl, t) {
  const sc = o.s || 1;
  const f = o.f || 1;
  setState(o);
  const pole = T.parts.banner_pole, cloth = T.banner.length ? T.banner[(o.v | 0) % T.banner.length] : null;
  if (!pole || !cloth) { const s = spriteOf(A, 'banner', o.v); if (s) B.main.add(s, o.x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, f); return; }
  const seed = o.x * 0.93 + o.y * 1.31;
  const w = Math.sin(t * 1.7 + seed) * 0.6 + Math.sin(t * 3.9 + seed * 2) * 0.3 + 0.35;
  B.blob.add(T.blob, o.x, o.y, 0.5 * sc, 0.3 * sc, 1, 1, 1, 0.4 * CA);
  B.main.add(pole, o.x, o.y, sc, sc, CR, CG, CB, CA, 0, 0, fl, 1);
  const cx = o.x + PG.bannerX * sc, ly = PG.bannerLift * sc;
  B.main.add(cloth, cx, o.y, sc * f * (0.94 + 0.06 * Math.sin(t * 4.3 + seed)), sc, CR, CG, CB, CA, 0, -0.07 * w, fl, 1, 0, ly);
  if (!BP) { B.shadow.add(pole, o.x, o.y, sc, sc, 1, 1, 1, CA, 0, 0, 0, 1); B.shadow.add(cloth, cx, o.y, sc * f, sc, 1, 1, 1, CA, 0, -0.07 * w, 0, 1, 0, ly); }
  overlays(B, T, o, 1, t);
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
