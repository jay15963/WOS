// Drawing of the farm animals and fish (art/livestock.js sprites; docs/LIVESTOCK.md). Reads replicated creature state
// only (facing, moving, moveT, action, flash, dead, scale, variant, `baby` from the name / variant bit), so every peer
// draws the same animal. 8 views: the camera-turned 3/4 view (o._dv from art/facing.js) — and at 0° too, from the
// creature's own motion (an animal walking diagonally across the map is drawn in its 3/4 view).
//   adults: <sp>_<e|se|s|ne|n>, trot frames _w0.._w3 (s / n: w0, w2), _graze · the young: <sp>_baby_<v>(_w0|_w2)
//   variant bit 0 = the second coat (tinted), bit 1 = young

import { viewB, animEnv } from './compose.js';
import { viewFacing8 } from './facing.js';

export const LIVESTOCK = new Set(['cow', 'sheep', 'pig', 'chicken']);
const TAU = Math.PI * 2, HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// gait: f = phase rad per moveT unit (0.25 per tile), bob = body lift, peck = pecks / grazes quickly (chickens)
const GAIT = {
  cow: { f: 9, bob: 0.035, rock: 0.02 },
  sheep: { f: 12, bob: 0.04, rock: 0.025 },
  pig: { f: 14, bob: 0.035, rock: 0.03 },
  chicken: { f: 24, bob: 0.03, rock: 0.05, peck: true },
};
// second coat (variant & 1): brown cow, black sheep, darker spotted pig, brown hen
const TINT = { cow: [0.86, 0.64, 0.46], sheep: [0.45, 0.4, 0.38], pig: [0.94, 0.78, 0.72], chicken: [0.86, 0.58, 0.36] };
const NOTINT = [1, 1, 1];

const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  T = {};
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  for (const sp of LIVESTOCK) {
    for (const baby of [0, 1]) {
      const base = sp + (baby ? '_baby' : '');
      const V = {};
      for (const v of ['e', 'se', 's', 'ne', 'n']) {
        const st = opt(base + '_' + v);
        if (!st) continue;
        const w = [0, 1, 2, 3].map((i) => opt(`${base}_${v}_w${i}`));
        // 2-frame views alternate w0 / stand / w2 / stand
        const walk = w[1] ? w : [w[0] || st, st, w[2] || st, st];
        V[v] = { st, walk, graze: opt(base + '_' + v + '_graze') };
      }
      (T[sp] ||= [])[baby] = V;
    }
  }
  T.blob = opt('fx_blob');
  T.fish = [opt('fish_top'), opt('fish_top_1'), opt('fish_top_2')];
  T.fishE = opt('fish_e');
  CACHE.set(A, T);
  return T;
}

function seedOf(a) {
  if (a._seed != null) return a._seed;
  const s = String(a.nid ?? a.id ?? 0);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (a._seed = ((h >>> 0) % 10007) / 10007);
}

// one entry for game.js: true when drawn here (farm animals, fish), false = not ours (drawAnimal)
export function drawStock(B, A, a, t, frozen = false) {
  if (LIVESTOCK.has(a.species)) return drawLivestock(B, A, a, t);
  if (a.species === 'fish') return drawFish(B, A, a, t, frozen);
  return false;
}

export function isBaby(a) { return !!((a.variant | 0) & 2); }

export function drawLivestock(B, A, a, t) {
  const T = tables(A);
  const sp = a.species;
  const set = T[sp]?.[isBaby(a) ? 1 : 0] || T[sp]?.[0];
  if (!set || !set.e) return false;
  B = viewB(B, a.x, a.y); // (camera turned: screen-space offsets around the body → world)
  // the view: a 3/4 view from art/facing.js (camera turned: set by game.js; at 0°: from its own motion here)
  let dv = a.dead ? null : a._dv, dir = a.facing || 'e';
  if (!animEnv.yaw && !a.dead) { dir = viewFacing8(a, t, 0); dv = a._dv; a._dv = null; }
  let view, flip = 1;
  if (dv) { view = dv[0] === 's' ? 'se' : 'ne'; flip = dv[1] === 'w' ? -1 : 1; }
  else if (dir === 'e' || dir === 'w') { view = 'e'; flip = dir === 'w' ? -1 : 1; }
  else view = dir;
  const V = set[view] || set.e;
  const G = GAIT[sp] || GAIT.cow;
  const sc = a.scale || 1, fl = a.flash || 0;
  const tint = (a.variant | 0) & 1 && !isBaby(a) ? TINT[sp] || NOTINT : NOTINT;
  const ph0 = seedOf(a) * TAU;
  if (a.dead) {
    // topple onto the side (the body on the ground takes over: corpses.js)
    const u = clamp01((a.deadT || 0) * 2.6), k = u * u * (3 - 2 * u);
    const s = set.e.st;
    if (T.blob) B.blob.add(T.blob, a.x, a.y, s.w * 0.7 * sc, 0.6 * sc, 1, 1, 1, 0.5);
    B.main.add(s, a.x - flip * s.h * s.ay * 0.4 * sc * k, a.y + 0.05 * k, sc, sc, tint[0] * 0.85, tint[1] * 0.82, tint[2] * 0.8, 1, 0, flip * HALF_PI * k, fl, flip, 0, 0);
    return true;
  }
  let spr = V.st, lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0;
  const baby = isBaby(a);
  const f = G.f * (baby ? 1.3 : 1);
  if (a.moving) {
    const ph = (a.moveT || 0) * f + ph0;
    const u = ((ph / TAU) % 1 + 1) % 1;
    spr = V.walk[(u * 4) | 0] || V.st;
    lift = G.bob * (0.5 - 0.5 * Math.cos(2 * ph - HALF_PI)) * (baby ? 1.4 : 1);
    rot = flip * Math.sin(2 * ph) * G.rock * (view === 's' || view === 'n' ? 1.2 : 0.5);
  } else {
    const br = Math.sin(t * 2 + ph0);
    sy = 1 + br * 0.014; sx = 1 - br * 0.005;
    const act = a.action;
    const eating = act && act.type === 'eat';
    // idle life on a shared schedule (creature id + world clock): grazing / pecking, a twitch
    const sd = seedOf(a), P = G.peck ? 2.4 + sd * 1.5 : 7 + sd * 5;
    const k = ((animEnv.wt + sd * 37) / P) % 1;
    const graze = eating || (a.state !== 'flee' && a.state !== 'chase' && !a.tiedTo && k < (G.peck ? 0.35 : 0.45));
    if (graze) {
      if (V.graze) { spr = V.graze; sy *= 1 - 0.015 * Math.abs(Math.sin(t * (G.peck ? 16 : 6.5) + ph0)); }
      else { sy *= 0.95; oy += view === 's' ? 0.02 : -0.02; }
    } else if (k > 0.86 && k < 0.89) { rot += flip * Math.sin(t * 60) * 0.018; } // skin twitch / ruffle
  }
  if (fl > 0.4) { ox += Math.sin(t * 70) * 0.025 * fl; sy *= 1 - 0.05 * fl; } // hit flinch
  const x = a.x + ox, y = a.y + oy;
  const bw = view === 's' || view === 'n' ? spr.w * 0.6 : spr.w * 0.62;
  if (T.blob) B.blob.add(T.blob, a.x, a.y, bw * sc * (1 - lift), 0.5 * sc * (1 - lift), 1, 1, 1, 0.7);
  B.main.add(spr, x, y, sc * sx, sc * sy, tint[0], tint[1], tint[2], 1, 0, rot, fl, flip, 0, lift);
  B.shadow.add(spr, x, y, sc * sx, sc * sy, 1, 1, 1, 0.9, 0, rot, 0, flip, 0, lift);
  return true;
}

// fish: under the water surface, seen from above (flat, turned to where it swims), the tail beating; a jump arc when
// a._jump = { t0, dur } (cosmetic, livestock.js); hidden under the ice
export function drawFish(B, A, a, t, frozen = false) {
  const T = tables(A);
  if (!T.fish[0] || a.dead || frozen) return true;
  const sc = a.scale || 1, fl = a.flash || 0;
  const J = a._jump;
  if (J && T.fishE) {
    const u = (t - J.t0) / J.dur;
    if (u >= 0 && u <= 1) {
      const h = Math.sin(u * Math.PI) * 0.75;
      const fx = a.x + (J.dx || 0) * (u - 0.5), fy = a.y + (J.dy || 0) * (u - 0.5);
      const flip = (J.dx || 1) < 0 ? -1 : 1;
      B.main.add(T.fishE, fx, fy, sc * 0.9, sc * 0.9, 1, 1, 1, 1, 0, flip * (u - 0.5) * 2.2, fl, flip, 0, h);
      return true;
    }
  }
  // heading: from the motion (cosmetic cache), else the facing letter
  const dx = a.x - (a._fx ?? a.x), dy = a.y - (a._fy ?? a.y);
  a._fx = a.x; a._fy = a.y;
  if (dx * dx + dy * dy > 1e-6) a._fh = Math.atan2(dy, dx);
  const hd = a._fh ?? ({ e: 0, s: HALF_PI, w: Math.PI, n: -HALF_PI }[a.facing] || 0);
  const beat = a.moving ? t * 9 + seedOf(a) * 9 : t * 2.5 + seedOf(a) * 9;
  const fr = T.fish[Math.sin(beat) > 0.35 ? 1 : Math.sin(beat) < -0.35 ? 2 : 0] || T.fish[0];
  const s = sc * 0.92, d = 0.03 * Math.sin(t * 1.7 + seedOf(a) * 5);
  // water-tinted, a little transparent (it swims under the surface); flat on the ground batch: turns with the world
  B.ground.add(fr, a.x, a.y + d, s, s, 0.62, 0.78, 0.82, 0.62 + fl * 0.3, 0, hd, fl, 1, 1);
  return true;
}
