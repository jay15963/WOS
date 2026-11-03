// Drawing of the wild fauna (art/fauna.js sprites; docs/FAUNA.md). Reads replicated creature state only — facing,
// moving, moveT, action, flash, dead, scale, variant, fmode (flying / hidden / in a tree / resting: game/fauna.js) — and
// the world's water under it, so every peer draws the same animal. 8 views like the livestock: the camera-turned 3/4
// view (o._dv from art/facing.js), and at 0° from the creature's own motion.
//   quadrupeds: walk / trot frames by the gait phase, a gallop's rock and stretch when running, grazing on a shared
//     schedule, a lunge with the attack frame, a flinch when hit, toppling over when killed; big cats rest lying down
//   birds: hop / peck on the ground; flying: wing beats (or a glide) at a cosmetic height eased on every peer, the
//     shadow left on the ground
//   swimmers (shark, dolphin, whale, croc and seal in deep water): only what is above the water (the `_cut` sprites),
//     the body's dark shape under the surface (`_top`, flat), a ring of ripples; dolphins jump (action 'jump'), whales
//     blow (action 'spout') and dive (fmode hidden)
//   ambushers: a hidden crocodile shows its eyes only, a hidden snake lies coiled and nearly invisible

import { viewB, animEnv } from './compose.js';
import { viewFacing8 } from './facing.js';
import { lookAtlasOf, LOOK_CLOCK } from './look/lazy.js';
import { FAUNA_ART } from './fauna.js';

// fmode bits (replicated in the entity stream next to the farm bits: net/entities.js; set by game/fauna.js)
export const FMODE = { FLY: 1, HIDE: 2, TREE: 4, REST: 8 };

const TAU = Math.PI * 2, HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeIn = (u) => u * u * u;
const smooth = (u) => u * u * (3 - 2 * u);

// body plan and gait of each species (cosmetic): f = gait phase rad per moveT unit (0.25 per tile), bob / rock,
// graze = grazes when idle, run = how it runs ('gallop' rocks and stretches, 'bound' leaps)
const K = {
  wild_horse: { k: 'quad', f: 8, bob: 0.03, rock: 0.02, graze: true, run: 'gallop' },
  zebra: { k: 'quad', f: 8.5, bob: 0.03, rock: 0.02, graze: true, run: 'gallop' },
  gazelle: { k: 'quad', f: 12, bob: 0.04, rock: 0.03, graze: true, run: 'bound' },
  reindeer: { k: 'quad', f: 9.5, bob: 0.03, rock: 0.02, graze: true, run: 'gallop' },
  moose: { k: 'quad', f: 7, bob: 0.025, rock: 0.02, graze: true, run: 'gallop' },
  bison: { k: 'quad', f: 7.5, bob: 0.025, rock: 0.025, graze: true, run: 'gallop' },
  yak: { k: 'quad', f: 8, bob: 0.025, rock: 0.025, graze: true, run: 'gallop' },
  camel: { k: 'quad', f: 6.5, bob: 0.03, rock: 0.035, graze: true, run: 'gallop' },
  mountain_goat: { k: 'quad', f: 11, bob: 0.035, rock: 0.03, graze: true, run: 'bound' },
  elephant: { k: 'quad', f: 5, bob: 0.015, rock: 0.012, graze: true, run: 'gallop' },
  lion: { k: 'quad', f: 9, bob: 0.025, rock: 0.02, run: 'gallop', cat: true },
  jaguar: { k: 'quad', f: 11, bob: 0.025, rock: 0.02, run: 'gallop', cat: true },
  lynx: { k: 'quad', f: 12, bob: 0.03, rock: 0.02, run: 'gallop', cat: true },
  polar_bear: { k: 'quad', f: 8, bob: 0.03, rock: 0.03, run: 'gallop', cat: true },
  arctic_fox: { k: 'quad', f: 16, bob: 0.04, rock: 0.03, run: 'gallop', cat: true },
  monkey: { k: 'quad', f: 16, bob: 0.05, rock: 0.04, run: 'bound' },
  vulture: { k: 'bird', f: 18, glide: 0.8 },
  eagle: { k: 'bird', f: 18, glide: 0.7 },
  parrot: { k: 'bird', f: 24, glide: 0.1 },
  seagull: { k: 'bird', f: 22, glide: 0.5 },
  heron: { k: 'bird', f: 12, glide: 0.35 },
  rattlesnake: { k: 'snake', f: 10 },
  crocodile: { k: 'croc', f: 9, bob: 0.01 },
  crab: { k: 'crab', f: 26, bob: 0.01 },
  scorpion: { k: 'crab', f: 22, bob: 0.008 },
  shark: { k: 'swim', f: 6 },
  dolphin: { k: 'swim', f: 7 },
  whale: { k: 'swim', f: 3 },
  seal: { k: 'seal', f: 12, bob: 0.02 },
};
export const FAUNA = new Set(Object.keys(K));
// art key of a creature (a male lion: variant bit 1)
export const faunaKey = (sp, v = 0) => (sp === 'lion' && (v & 2) ? 'lion_m' : FAUNA.has(sp) ? sp : null);
// size class of a body (corpse skeleton / carcass art)
export const FAUNA_SIZE = {
  wild_horse: 'l', zebra: 'm', gazelle: 's', reindeer: 'm', moose: 'l', bison: 'l', yak: 'l', camel: 'l', mountain_goat: 's', elephant: 'l',
  lion: 'm', jaguar: 'm', lynx: 's', polar_bear: 'l', arctic_fox: 's', monkey: 's', vulture: 's', eagle: 's', parrot: 's', seagull: 's', heron: 's',
  rattlesnake: 's', crocodile: 'l', crab: 's', scorpion: 's', shark: 'm', dolphin: 'm', whale: 'l', seal: 'm',
};
// second coat (variant & 1): a darker / paler animal of the herd
const TINT = {
  wild_horse: [0.78, 0.66, 0.56], reindeer: [1.12, 1.08, 1.04], yak: [1.9, 1.84, 1.72], camel: [0.86, 0.8, 0.74], mountain_goat: [0.96, 0.93, 0.88],
  bison: [0.86, 0.82, 0.8], gazelle: [0.92, 0.88, 0.84], seal: [0.82, 0.82, 0.84], crab: [1.0, 0.82, 0.62], monkey: [0.84, 0.8, 0.76],
};
const NOTINT = [1, 1, 1];

// ---------- sprite lookup (baked atlas first, then the lazy texture; a lazy frame not painted yet falls back) ----------
const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  T = { A, LA: lookAtlasOf(A), recs: new Map(), blob: opt('fx_blob'), ring: opt('fx_ring'), soft: opt('fx_soft') };
  CACHE.set(A, T);
  return T;
}
function sprite(T, name) {
  let r = T.recs.get(name);
  if (r === undefined) { r = T.A.has(name) ? T.A.get(name) : T.LA.has(name) ? T.LA.get(name) : null; T.recs.set(name, r); }
  if (!r || r.ready === undefined) return r;
  r.lu = LOOK_CLOCK.f;
  if (r.ready) return r;
  T.LA.want(r);
  return null;
}
// <key>_<view>[_frame][_cut] with fallbacks: the standing art of that view, then the baked side / front / back
function frame(T, key, view, fr, cut, dir) {
  const base = key + '_' + view, c = cut ? '_cut' : '';
  return (fr && sprite(T, base + '_' + fr + c)) || sprite(T, base + c) || (cut ? null : sprite(T, key + '_' + (dir === 's' || dir === 'n' ? dir : 'e')));
}
function seedOf(a) {
  if (a._seed != null) return a._seed;
  const s = String(a.nid ?? a.id ?? 0);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (a._seed = ((h >>> 0) % 10007) / 10007);
}
// speed on screen (tiles / s), smoothed: walking vs running (cosmetic cache)
function speedOf(a, t) {
  const dt = a._fst == null ? 0 : t - a._fst;
  const dx = a.x - (a._fsx ?? a.x), dy = a.y - (a._fsy ?? a.y);
  a._fst = t; a._fsx = a.x; a._fsy = a.y;
  if (dt > 0 && dt < 0.3) { const v = Math.hypot(dx, dy) / dt; a._fsp = (a._fsp || 0) + (v - (a._fsp || 0)) * Math.min(1, dt * 6); }
  return a.moving ? a._fsp || 0 : 0;
}
// heading on the ground from the motion (top-down shapes), else the facing letter
function headingOf(a) {
  const dx = a.x - (a._fhx ?? a.x), dy = a.y - (a._fhy ?? a.y);
  a._fhx = a.x; a._fhy = a.y;
  if (dx * dx + dy * dy > 1e-6) a._fh = Math.atan2(dy, dx);
  return a._fh ?? ({ e: 0, s: HALF_PI, w: Math.PI, n: -HALF_PI }[a.facing] || 0);
}
// a flier's height (tiles): eased toward its cruising height (a slow swell, by its id) while flying, to its perch
// (the ground, a tree's crown) landed
function altOf(a, t, fly, perch = 0) {
  const sd = seedOf(a), cruise = 1.7 + sd * 1.6 + Math.sin(t * 0.4 + sd * 20) * 0.25;
  const dt = a._fat == null ? 0 : Math.min(0.1, t - a._fat);
  a._fat = t;
  const goal = fly ? cruise : perch;
  a._alt = (a._alt ?? goal) + (goal - (a._alt ?? goal)) * Math.min(1, dt * (fly ? 1.6 : 2.6));
  return a._alt;
}

const W4 = ['w0', 'w1', 'w2', 'w3'], W2 = ['w0', 'stand', 'w2', 'stand'], S4 = ['s0', 's1', 's2', 's3'];
const FLAP = ['fly0', 'fly1', 'fly2', 'fly1'];

// one entry for game.js: true when drawn here (wild fauna), false = not ours
export function drawFauna(B, A, a, t, world = null) {
  const sp = a.species;
  const G = K[sp];
  if (!G) return false;
  const T = tables(A);
  const key = faunaKey(sp, a.variant | 0);
  if (!sprite(T, key + '_e')) return false;
  B = viewB(B, a.x, a.y);
  let dv = a.dead ? null : a._dv, dir = a.facing || 'e';
  if (!animEnv.yaw && !a.dead) { dir = viewFacing8(a, t, 0); dv = a._dv; a._dv = null; }
  let view, flip = 1;
  if (dv) { view = dv[0] === 's' ? 'se' : 'ne'; flip = dv[1] === 'w' ? -1 : 1; }
  else if (dir === 'e' || dir === 'w') { view = 'e'; flip = dir === 'w' ? -1 : 1; }
  else view = dir;
  const sc = a.scale || 1, fl = a.flash || 0, fm = a.fmode | 0;
  const tint = (a.variant | 0) & 1 ? TINT[sp] || NOTINT : NOTINT;
  const ph0 = seedOf(a) * TAU;
  const tx = Math.floor(a.x), ty = Math.floor(a.y);
  const deep = world && (G.k === 'swim' || G.k === 'croc' || G.k === 'seal' || sp === 'polar_bear') ? world.liquidAt(tx, ty) === 2 : false;
  const wet = G.k === 'swim' || deep;

  // ---- death: it sinks and keels over, then lies on its side (legs out; the flat ones flip onto the back) — the
  // body on the ground takes over with the same lying drawing (corpseDraw.js)
  if (a.dead) {
    const u = clamp01((a.deadT || 0) * 2.6);
    const s = sprite(T, key + '_e'), dead = sprite(T, key + '_dead') || s;
    const fall = G.k === 'bird' ? altOf(a, t, false) : 0; // (a bird shot down falls from where it flew)
    if (T.blob && !wet) B.blob.add(T.blob, a.x, a.y, dead.w * 0.8 * sc, 0.6 * sc, 1, 1, 1, 0.5);
    if (u < 0.42) {
      const k = smooth(u / 0.42);
      B.main.add(s, a.x, a.y, sc * (1 + 0.04 * k), sc * (1 - 0.3 * k), tint[0] * 0.9, tint[1] * 0.88, tint[2] * 0.86, 1, 0, flip * 0.35 * k, fl, flip, 0, fall);
    } else {
      const k = (u - 0.42) / 0.58, hop = Math.sin(clamp01(k * 1.4) * Math.PI) * 0.06 * sc;
      B.main.add(dead, a.x, a.y, sc, sc * (0.92 + 0.08 * clamp01(k * 2)), tint[0] * 0.85, tint[1] * 0.82, tint[2] * 0.8, 1, 0, 0, fl, flip, 0, hop + fall);
    }
    return true;
  }

  let fr = '', cut = false, lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0, alpha = 1;
  const act = a.action && a.action.t < 1 ? a.action : null;
  const spd = speedOf(a, t);
  const ph = (a.moveT || 0) * G.f + ph0;
  const u = ((ph / TAU) % 1 + 1) % 1;
  const sd = seedOf(a);
  const idleU = a._idleU ?? ((animEnv.wt + sd * 37) / (7 + sd * 5)) % 1; // (_idleU: a fixed moment, tools/diag.html)
  let showBlob = true, ripple = 0, under = false;

  if (G.k === 'bird') {
    const fly = !!(fm & FMODE.FLY), perch = fm & FMODE.TREE ? 1.45 + sd * 0.3 : 0;
    lift = altOf(a, t, fly, perch);
    if (perch) showBlob = false;
    if (fly || lift > perch + 0.05) {
      // glide most of the time (soaring birds), beat the wings in bursts
      const beat = a._beat ?? ((t * 1.1 + sd * 7) % 1 > G.glide); // (_beat: fixed, tools/diag.html)
      fr = beat || lift < 0.6 ? FLAP[((t * (G.f / 2.2) + sd * 4) * 4 | 0) % 4] : 'glide';
      rot = flip * Math.sin(t * 0.9 + ph0) * 0.06;
    } else if (a.moving) { fr = ['w0', 'stand', 'w2', 'stand'][(u * 4) | 0]; lift = Math.abs(Math.sin(ph)) * 0.04; }
    else if (act && act.type === 'attack') fr = 'atk';
    else if (idleU < 0.4) fr = 'graze';
  } else if (G.k === 'snake') {
    if (fm & FMODE.HIDE) { fr = 'coil'; alpha = 0.32; }
    else if (act && act.type === 'attack') fr = 'atk';
    else if (a.moving) fr = S4[(u * 4) | 0];
  } else if (G.k === 'swim' || ((G.k === 'croc' || G.k === 'seal' || sp === 'polar_bear') && deep)) {
    // in the water: what shows above it, the shape under it
    under = true; showBlob = false;
    const hidden = !!(fm & FMODE.HIDE);
    if (G.k === 'croc') { fr = act && act.type === 'attack' ? 'atk' : 'swim'; cut = fr === 'swim'; if (hidden) alpha = 0.8; }
    else if (G.k === 'seal' || sp === 'polar_bear') { fr = 'swim'; cut = true; }
    else if (act && act.type === 'jump') {
      // a dolphin's leap: the whole body in an arc (its nose up, then down)
      const k = clamp01(act.t);
      fr = 'jump'; cut = false; lift = Math.sin(k * Math.PI) * 0.9; rot = flip * (0.45 - k * 0.9);
      if (k > 0.85 || k < 0.12) ripple = 1;
    } else if (sp === 'whale' && hidden) { fr = act && act.type === 'dive' ? 'dive' : ''; cut = true; if (!fr) alpha = 0; }
    else if (act && act.type === 'attack') { fr = 'atk'; cut = false; lift = -0.12; }
    else { fr = a.moving ? (Math.sin(t * G.f * 0.5 + ph0) > 0 ? 'swim1' : 'swim2') : Math.sin(t * 1.4 + ph0) > 0.6 ? 'swim1' : ''; cut = true; }
    if (cut) ripple = 0.7;
    oy += Math.sin(t * 1.3 + ph0) * 0.015;
  } else {
    // walkers: quadrupeds, crocs and crabs on land, seals humping along
    const rest = !!(fm & FMODE.REST), tree = !!(fm & FMODE.TREE);
    if (tree) { fr = 'sit'; lift = 1.25 + sd * 0.35; showBlob = false; }
    else if (act && act.type === 'attack') fr = 'atk';
    else if (a.moving) {
      fr = (view === 's' || view === 'n') && G.k === 'quad' ? W4[(u * 4) | 0] : G.k === 'seal' ? W2[(u * 4) | 0] : W4[(u * 4) | 0];
      const run = spd > 3.4 && G.run;
      const bob = (G.bob || 0.02) * (run ? 1.8 : 1);
      lift = bob * (0.5 - 0.5 * Math.cos(2 * ph - HALF_PI));
      rot = flip * Math.sin(2 * ph) * (G.rock || 0.02) * (view === 'e' ? 0.5 : 1);
      if (run && view !== 's' && view !== 'n') {
        if (G.run === 'bound') { const air = Math.sin(ph) > 0 ? Math.sin(ph) : 0; lift += air * 0.16; rot += flip * Math.cos(ph) * 0.12; fr = air > 0.3 ? 'w0' : 'w2'; }
        else { rot += flip * Math.sin(2 * ph) * 0.06; sx *= 1 + Math.abs(Math.cos(ph)) * 0.05; sy *= 1 - Math.abs(Math.cos(ph)) * 0.03; }
      }
    } else if (rest && FAUNA_ART[key].frames.includes('rest')) fr = 'rest';
    else {
      const br = Math.sin(t * 2 + ph0);
      sy = 1 + br * 0.014; sx = 1 - br * 0.005;
      if (G.graze && a.state !== 'flee' && a.state !== 'chase' && idleU < 0.45) fr = 'graze';
      else if (G.cat && a.state !== 'chase' && idleU > 0.55 && idleU < 0.62) fr = 'graze'; // (sniffs the ground)
      if (idleU > 0.86 && idleU < 0.89) rot += flip * Math.sin(t * 60) * 0.018;
    }
  }
  // the attack: a lunge along the facing (birds and swimmers: their own pose)
  if (act && act.type === 'attack' && !under && G.k !== 'bird') {
    const k = clamp01(act.t);
    const f = k < 0.4 ? -0.3 * smooth(k / 0.4) : k < 0.58 ? -0.3 + 1.3 * easeIn((k - 0.4) / 0.18) : 1 - smooth((k - 0.58) / 0.42);
    const reach = (G.k === 'snake' ? 0.42 : G.k === 'crab' ? 0.12 : 0.24) * sc;
    if (view === 's') oy += f * reach * 0.7; else if (view === 'n') oy -= f * reach * 0.7; else ox += flip * f * reach;
    if (view === 'se') oy += f * reach * 0.5; else if (view === 'ne') oy -= f * reach * 0.5;
    if (f < 0) { sy *= 1 + f * 0.1; sx *= 1 - f * 0.05; }
  }
  if (fl > 0.4) { ox += Math.sin(t * 70) * 0.025 * fl; sy *= 1 - 0.05 * fl; } // hit flinch
  const spr = frame(T, key, view, fr, cut, dir);
  const x = a.x + ox, y = a.y + oy;
  // the shape under the water (flat, turned to where it swims) and the ring of ripples at the water line
  if (under && T.LA) {
    const top = sprite(T, key + '_top');
    if (top && !(sp === 'whale' && alpha === 0 && !fr)) B.ground.add(top, a.x, a.y, sc * 0.95, sc * 0.95, 0.16, 0.26, 0.32, (sp === 'whale' && (fm & FMODE.HIDE) ? 0.18 : 0.38) + fl * 0.2, 0, headingOf(a), fl, 1, 1);
    else headingOf(a);
  }
  if (ripple && T.ring && spr) {
    const w = (spr.w || 1) * sc * 0.75, p = 0.85 + 0.15 * Math.sin(t * 3 + ph0);
    B.ground.add(T.ring, a.x, a.y, w * p / T.ring.w, w * 0.35 * p / T.ring.w, 0.85, 0.92, 0.95, 0.35 * ripple * alpha, 0, 0, 0, 1, 1);
  }
  if (!spr || alpha <= 0.01) return true;
  if (showBlob && T.blob) {
    const k = G.k === 'bird' ? Math.max(0.25, 1 - lift * 0.22) : 1 - Math.min(0.5, lift);
    const bw = view === 's' || view === 'n' ? spr.w * 0.6 : spr.w * 0.62;
    B.blob.add(T.blob, a.x, a.y, bw * sc * k, 0.5 * sc * k, 1, 1, 1, (G.k === 'bird' && lift > 0.3 ? 0.45 : 0.7) * alpha);
  }
  B.main.add(spr, x, y, sc * sx, sc * sy, tint[0], tint[1], tint[2], alpha, 0, rot, fl, flip, 0, lift);
  if (!under && alpha > 0.5) B.shadow.add(spr, x, y, sc * sx, sc * sy, 1, 1, 1, 0.9, 0, rot, 0, flip, 0, lift);
  // a whale's blow: a plume of spray over its back (action 'spout', replicated)
  if (sp === 'whale' && act && act.type === 'spout' && T.soft) {
    const k = clamp01(act.t);
    const top = Math.min(1, k * 3) * 1.9, bx = x + (view === 'e' ? flip * 0.9 : view === 'se' || view === 'ne' ? flip * 0.6 : 0) * sc, by = y + (view === 's' ? 0.5 : view === 'n' ? -0.5 : 0) * sc;
    for (let i = 0; i < 10; i++) {
      const q = i / 9, h = 0.25 + q * top, s2 = (0.22 + q * 0.75) * (0.8 + 0.4 * k);
      B.fx.add(T.soft, bx + Math.sin(i * 2.1 + t * 3) * 0.08 * q, by, s2, s2, 0.95, 0.98, 1, 0.5 * (1 - smooth(clamp01((k - 0.5) * 2))) * (1 - q * 0.5), 0, 0, 0, 1, 0, h);
    }
  }
  // the frames of this view nearby in time right after: they share the model
  const pk = '_pre_' + key + view;
  if (!T.recs.has(pk)) { T.recs.set(pk, null); for (const q of FAUNA_ART[key].frames) sprite(T, key + '_' + view + (q === 'stand' ? '' : '_' + q)); }
  return true;
}
