// Visual composition & animation: turns game state into sprite instances. Reads state only (private
// `_`-prefixed caches aside), no game logic, allocation-light (runs every frame for every visible object).
// B = renderer.batches, A = atlas, t = time (s).
// batch.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift)

import { PAWN } from './pawns.js';
import { TORCH_FLAME_LIFT, CAMPFIRE_FLAME_LIFT } from './buildings.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u * u;
const smooth = (u) => u * u * (3 - 2 * u);

// ---------- sprite lookup tables (built once per atlas) ----------
const CACHE = new WeakMap();
const DIRS = ['s', 'n', 'e'];
const WEAPON_SPR = { sword: 'weapon_sword', axe: 'weapon_axe', pickaxe: 'tool_pickaxe', spear: 'weapon_spear', club: 'weapon_club' };
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  T = { body: {}, head: {}, hair: {}, beard: {}, weapon: {}, animal: {}, flames: [], blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft') };
  for (const d of DIRS) { T.body[d] = A.get('pawn_body_' + d); T.head[d] = A.get('pawn_head_' + d); }
  for (const s of A.list) {
    const m = s.name.match(/^hair_(\w+)_([sne])$/);
    if (m) (T.hair[m[1]] ||= {})[m[2]] = s;
  }
  T.beard.s = opt('beard_s'); T.beard.e = opt('beard_e');
  for (const k in WEAPON_SPR) T.weapon[k] = opt(WEAPON_SPR[k]);
  for (const sp of ['wolf', 'boar', 'deer', 'rabbit', 'bear']) {
    if (!A.has(sp + '_e')) continue;
    T.animal[sp] = { s: opt(sp + '_s') || A.get(sp + '_e'), n: opt(sp + '_n') || A.get(sp + '_e'), e: A.get(sp + '_e'), ew: opt(sp + '_e_walk') || A.get(sp + '_e') };
  }
  for (let i = 0; i < 3; i++) T.flames.push(opt('fx_flame_' + i) || A.get('fx_flame'));
  T.stump = A.groups.tree_stump ? A.pick('tree_stump', 0) : null;
  T.sapling = A.groups.tree_sapling ? A.pick('tree_sapling', 0) : null;
  CACHE.set(A, T);
  return T;
}
const phaseOf = (o) => o._ph ?? (o._ph = ((o.id ?? 0) * 0.618 + Math.random()) * TAU);

// ---------- weapon swing curves ----------
// returns 0..1 amounts { wind, hit } for an action progress k (wind-up, fast strike, recovery)
let W_WIND = 0, W_HIT = 0, W_ANG = 0;
function swing(k, rest, wind, hit, windEnd = 0.4, hitEnd = 0.6) {
  if (k < windEnd) { const u = easeOut(k / windEnd); W_WIND = u; W_HIT = 0; W_ANG = rest + (wind - rest) * u; }
  else if (k < hitEnd) { const u = easeIn((k - windEnd) / (hitEnd - windEnd)); W_WIND = 1 - u; W_HIT = u; W_ANG = wind + (hit - wind) * u; }
  else { const u = smooth((k - hitEnd) / (1 - hitEnd)); W_WIND = 0; W_HIT = 1 - u; W_ANG = hit + (rest - hit) * u; }
}

const DEFAULT_LOOK = { skin: [0.95, 0.8, 0.66], hair: 'short', hairColor: [0.35, 0.22, 0.12], shirt: [0.5, 0.5, 0.5] };

// ---------- pawns (humanoids) ----------
// p: { x, y, facing:'s'|'n'|'e'|'w', moving, moveT, action:{type,t}|null, flash, dead, deadT,
//      look:{ skin, hair, hairColor, shirt, beard? }, weapon:'sword'|'axe'|'pickaxe'|'spear'|'club'|null }
export function drawPawn(B, A, p, t) {
  const T = tables(A);
  const dir = p.facing || 's';
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  const L = p.look || DEFAULT_LOOK;
  const fl = p.flash || 0;
  const body = T.body[sd], head = T.head[sd];
  const hs = T.hair[L.hair];
  const hair = hs ? hs[sd] : null;
  const beard = L.beard && sd !== 'n' ? T.beard[sd] : null;
  const sh = L.shirt, sk = L.skin, hc = L.hairColor;
  const ph0 = phaseOf(p);

  if (p.dead) {
    const u = clamp01((p.deadT || 0) * 2.8);
    // fall onto the side with a small bounce
    const k = u < 0.75 ? easeIn(u / 0.75) : 1 - Math.sin(((u - 0.75) / 0.25) * Math.PI) * 0.07;
    const side = sd === 'e' ? -flip : ph0 % TAU > Math.PI ? 1 : -1;
    const rot = side * HALF_PI * k;
    const HL = PAWN.headLift;
    const hx = p.x + Math.sin(rot) * HL, hy = p.y - Math.cos(rot) * HL;
    B.blob.add(T.blob, p.x + side * 0.3 * k, p.y, 0.75 + 0.5 * k, 0.6, 1, 1, 1, 0.55);
    const wsp = p.weapon ? T.weapon[p.weapon] : null;
    if (wsp) B.main.add(wsp, p.x - side * 0.25, p.y + 0.12, 0.9, 0.9, 1, 1, 1, 1, 0, side * HALF_PI * 1.15, fl, 1, 0, 0.02);
    B.main.add(body, p.x, p.y, 1, 1, sh[0], sh[1], sh[2], 1, 0, rot, fl, flip, 0, 0);
    B.main.add(head, hx, hy, 1, 1, sk[0], sk[1], sk[2], 1, 0, rot, fl, flip, 0, 0);
    if (beard) B.main.add(beard, hx, hy, 1, 1, hc[0], hc[1], hc[2], 1, 0, rot, fl, flip, 0, 0);
    if (hair) B.main.add(hair, hx, hy, 1, 1, hc[0], hc[1], hc[2], 1, 0, rot, fl, flip, 0, 0);
    return;
  }

  // ---- locomotion / idle ----
  let lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0, headRot = 0, headDy = 0;
  if (p.moving) {
    const ph = (p.moveT || 0) * 9.5;
    const s = Math.sin(ph), c = Math.cos(ph), b = Math.abs(s);
    lift = b * 0.065;
    sy = 1 + (b - 0.55) * 0.06; sx = 1 - (b - 0.55) * 0.045;
    if (sd === 'e') { rot = flip * (0.075 + 0.035 * c); headRot = -flip * 0.03 * c; }
    else { rot = s * 0.075; ox = s * 0.02; headRot = -s * 0.04; }
  } else {
    const br = Math.sin(t * 2.4 + ph0);
    sy = 1 + br * 0.018; sx = 1 - br * 0.009;
    headDy = br * 0.006;
  }

  // ---- actions ----
  const act = p.action;
  const k = act ? clamp01(act.t) : 0;
  let wsp = p.weapon ? T.weapon[p.weapon] : null;
  let wRot = 0, wSy = 1, wHx = 0, wHl = 0, wBehind = sd === 'n', showW = !!wsp;
  // rest pose
  if (sd === 'e') wRot = flip * 0.55; else if (sd === 's') wRot = -0.5; else wRot = 0.4;
  if (act && act.t < 1) {
    const ty = act.type;
    if (ty === 'attack' || ty === 'chop' || ty === 'mine') {
      if (ty === 'chop') wsp = T.weapon.axe || wsp;
      else if (ty === 'mine') wsp = T.weapon.pickaxe || wsp;
      showW = !!wsp;
      const heavy = ty !== 'attack';
      if (sd === 'e') {
        heavy ? swing(k, 0.55, -1.75, 1.7, 0.45, 0.62) : swing(k, 0.55, -1.35, 2.15);
        wRot = flip * W_ANG;
        wHl = W_WIND * 0.14 - W_HIT * 0.06;
        wHx = flip * (W_HIT * 0.1 - W_WIND * 0.06);
        rot += flip * (W_HIT * 0.13 - W_WIND * 0.08);
        ox += flip * W_HIT * 0.09;
      } else if (sd === 's') {
        if (heavy) {
          // overhead chop toward the camera: foreshorten the tool (tip up → tip down)
          swing(k, 0, -1, 1, 0.45, 0.62);
          wRot = -0.3 + Math.max(0, W_ANG) * 0.55;
          wSy = W_ANG <= 0 ? 1 : 1 - W_ANG * 1.85;
          wHl = W_WIND * 0.2 - W_HIT * 0.12; wHx = 0.1 * W_HIT;
          headDy -= W_HIT * 0.03;
        } else {
          swing(k, -0.5, -1.15, 2.5);
          wRot = W_ANG;
          wHl = W_WIND * 0.12 - W_HIT * 0.05; wHx = W_HIT * 0.18;
          rot += W_HIT * 0.06 - W_WIND * 0.05;
        }
        oy += W_HIT * 0.06;
      } else {
        if (heavy) {
          swing(k, 0, -1, 1, 0.45, 0.62);
          wRot = 0.15; wSy = W_ANG <= 0 ? 1 : 1 - W_ANG * 0.55;
          wHl = W_WIND * 0.22 + W_HIT * 0.06; wHx = -0.06 * W_HIT;
        } else {
          swing(k, 0.4, 2.3, -0.95);
          wRot = W_ANG;
          wHl = W_WIND * 0.08 + W_HIT * 0.06; wHx = -W_HIT * 0.16;
          rot += W_WIND * 0.05 - W_HIT * 0.06;
        }
        oy -= W_HIT * 0.06;
      }
    } else if (ty === 'gather') {
      // crouch and bob (picking)
      const b = Math.abs(Math.sin(k * Math.PI * 3));
      sy *= 0.86 + b * 0.08; sx *= 1.06 - b * 0.04;
      headDy -= 0.08 - b * 0.04;
      if (sd === 'e') rot += flip * (0.12 + b * 0.05);
      else oy += sd === 's' ? 0.03 : -0.03;
      showW = false;
    } else if (ty === 'cast') {
      const u = Math.sin(k * Math.PI);
      lift += u * 0.06; sy *= 1 + u * 0.04;
      wHl = u * 0.2; wRot = sd === 'e' ? flip * (0.55 - u * 0.6) : wRot * (1 - u);
    }
  }

  const x = p.x + ox, y = p.y + oy;
  const HL = PAWN.headLift * sy;
  const hx = x + Math.sin(rot) * HL;
  const hl = lift + Math.cos(rot) * HL + headDy;
  const hr = rot * 0.55 + headRot;

  // contact shadow (shrinks a little while airborne)
  B.blob.add(T.blob, p.x, p.y, 0.7 - lift * 0.8, 0.6 - lift * 0.6, 1, 1, 1, 0.75);

  // weapon at the hand
  let wx = 0, wl = 0;
  if (showW && wsp) {
    const H = sd === 's' ? PAWN.handS : sd === 'n' ? PAWN.handN : PAWN.handE;
    wx = x + H[0] * flip + wHx + Math.sin(rot) * H[1];
    wl = lift + H[1] * sy + wHl;
  }
  const wFlip = sd === 'e' ? flip : 1;
  if (showW && wsp && wBehind) B.main.add(wsp, wx, y, 1, wSy, 1, 1, 1, 1, 0, wRot, fl, wFlip, 0, wl);
  B.main.add(body, x, y, sx, sy, sh[0], sh[1], sh[2], 1, 0, rot, fl, flip, 0, lift);
  B.main.add(head, hx, y, 1, 1, sk[0], sk[1], sk[2], 1, 0, hr, fl, flip, 0, hl);
  if (beard) B.main.add(beard, hx, y, 1, 1, hc[0], hc[1], hc[2], 1, 0, hr, fl, flip, 0, hl);
  if (hair) B.main.add(hair, hx, y, 1, 1, hc[0], hc[1], hc[2], 1, 0, hr, fl, flip, 0, hl);
  if (showW && wsp && !wBehind) B.main.add(wsp, wx, y, 1, wSy, 1, 1, 1, 1, 0, wRot, fl, wFlip, 0, wl);

  B.shadow.add(body, x, y, sx, sy, 1, 1, 1, 0.9, 0, rot, 0, flip, 0, lift);
  B.shadow.add(head, hx, y, 1, 1, 1, 1, 1, 0.9, 0, hr, 0, flip, 0, hl);
  if (hair) B.shadow.add(hair, hx, y, 1, 1, 1, 1, 1, 0.9, 0, hr, 0, flip, 0, hl);
}

// ---------- animals ----------
// a: { x, y, species, facing, moving, moveT, action, flash, dead, deadT, scale }
const GAIT = {
  wolf: { f: 10, bob: 0.06, rock: 0.07 },
  boar: { f: 12.5, bob: 0.05, rock: 0.06 },
  deer: { f: 8.5, bob: 0.09, rock: 0.08 },
  rabbit: { f: 7.5, bob: 0.2, rock: 0.15, hop: true },
  bear: { f: 6.5, bob: 0.05, rock: 0.05 },
};
const GAIT_DEF = { f: 10, bob: 0.05, rock: 0.05 };
export function drawAnimal(B, A, a, t) {
  const T = tables(A);
  const S = T.animal[a.species];
  if (!S) return;
  const dir = a.facing || 'e';
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  const sc = a.scale || 1;
  const fl = a.flash || 0;
  const G = GAIT[a.species] || GAIT_DEF;
  const ph0 = phaseOf(a);

  if (a.dead) {
    const u = clamp01((a.deadT || 0) * 2.6);
    const k = u < 0.7 ? easeIn(u / 0.7) : 1 - Math.sin(((u - 0.7) / 0.3) * Math.PI) * 0.08;
    const s = S.e;
    const rot = flip * HALF_PI * k;
    const c = s.h * s.ay * 0.45 * sc;
    B.blob.add(T.blob, a.x, a.y, s.w * 0.8 * sc, 0.7 * sc, 1, 1, 1, 0.5);
    B.main.add(s, a.x - flip * c * k, a.y + 0.05 * k, sc, sc, 0.82, 0.8, 0.78, 1, 0, rot, fl, flip, 0, 0);
    return;
  }

  let spr = sd === 'e' ? S.e : sd === 's' ? S.s : S.n;
  let lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0;
  if (a.moving) {
    const ph = (a.moveT || 0) * G.f;
    const s = Math.sin(ph), c = Math.cos(ph);
    if (G.hop) {
      const h = Math.max(0, s);
      lift = h * G.bob;
      if (sd === 'e') { spr = h > 0.15 ? S.ew : S.e; rot = -flip * c * 0.18 * (h > 0.05 ? 1 : 0); }
      sy = h > 0.05 ? 1 + h * 0.08 : 0.9; sx = h > 0.05 ? 1 - h * 0.04 : 1.08;
    } else {
      lift = Math.abs(s) * G.bob;
      if (sd === 'e') { spr = s > 0 ? S.ew : S.e; rot = flip * c * G.rock * 0.6; }
      else { rot = s * G.rock * 0.5; sx = 1 + c * 0.025; }
    }
  } else {
    const br = Math.sin(t * 2 + ph0);
    sy = 1 + br * 0.016; sx = 1 - br * 0.006;
  }
  const act = a.action;
  if (act && act.type === 'attack' && act.t < 1) {
    const k = clamp01(act.t);
    // crouch back, then a fast lunge/bite, then recover
    let f;
    if (k < 0.4) f = -0.35 * easeOut(k / 0.4);
    else if (k < 0.58) f = -0.35 + 1.35 * easeIn((k - 0.4) / 0.18);
    else f = 1 - smooth((k - 0.58) / 0.42);
    const reach = 0.24 * sc;
    if (sd === 'e') { ox += flip * f * reach; rot += flip * f * 0.14; lift += Math.max(0, f) * 0.05; }
    else if (sd === 's') { oy += f * reach * 0.7; sx *= 1 + Math.max(0, f) * 0.08; sy *= 1 + f * 0.06; }
    else { oy -= f * reach * 0.7; sy *= 1 - f * 0.05; }
    if (f < 0) { sy *= 1 + f * 0.12; sx *= 1 - f * 0.06; }
  }
  const x = a.x + ox, y = a.y + oy;
  const bw = sd === 'e' ? spr.w * 0.62 : spr.w * 0.72;
  B.blob.add(T.blob, a.x, a.y, bw * sc * (1 - lift), 0.55 * sc * (1 - lift), 1, 1, 1, 0.7);
  B.main.add(spr, x, y, sc * sx, sc * sy, 1, 1, 1, 1, 0, rot, fl, flip, 0, lift);
  B.shadow.add(spr, x, y, sc * sx, sc * sy, 1, 1, 1, 0.9, 0, rot, 0, flip, 0, lift);
}

// ---------- static world objects ----------
// o: { type, v, x, y, s, f, shake, fall, stump, empty, flash, age, light, fire }
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
    const s = A.pick(type, o.v);
    let x = o.x, rot = 0, alpha = 1;
    const shk = o.shake || 0;
    if (shk > 0) { x += Math.sin(t * 57) * 0.045 * shk; rot = Math.sin(t * 43 + 1.3) * 0.028 * shk; }
    const fall = o.fall || 0;
    if (fall > 0) {
      let a;
      if (fall <= 1) a = fall * fall * fall * 0.15 + fall * fall * 0.85;
      else { const u = Math.min(1, (fall - 1) / 0.25); a = 1 - Math.sin(u * Math.PI) * 0.06 * (1 - u * 0.5); }
      rot = f * HALF_PI * a;
      alpha = 1 - clamp01((fall - 1.1) / 0.4);
    }
    const sc = o.s * age;
    B.blob.add(T.blob, o.x, o.y, 1.05 * sc, 0.85 * sc, 1, 1, 1, 0.6 * (fall > 0 ? 1 - clamp01(fall) : 1));
    const sway = fall > 0 ? 0 : TREE_SWAY[type] ?? 0.03;
    B.main.add(s, x, o.y, sc, sc, 1, 1, 1, alpha, sway, rot, fl, f);
    B.shadow.add(s, x, o.y, sc, sc, 1, 1, 1, alpha, sway, rot, 0, f);
    return;
  }
  if (type === 'bush' || type === 'berrybush') {
    const name = type === 'berrybush' && o.empty ? 'berrybush_empty' : type;
    const s = A.pick(name, o.v);
    const shk = o.shake || 0;
    const x = o.x + (shk > 0 ? Math.sin(t * 50) * 0.035 * shk : 0);
    const rot = shk > 0 ? Math.sin(t * 38) * 0.05 * shk : 0;
    B.blob.add(T.blob, o.x, o.y, 0.95 * o.s, 0.62 * o.s, 1, 1, 1, 0.55);
    B.main.add(s, x, o.y, o.s, o.s, 1, 1, 1, 1, 0.05, rot, fl, f, 0.5);
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
        const fsx = (mid ? 0.8 : 0.6) * k * sc;
        const fsy = (mid ? 1.15 : 0.8) * (0.85 + 0.15 * Math.sin(ph * 0.8 + i)) * k * sc;
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
    if (item) B.blob.add(T.blob, o.x, o.y, 0.42 * sc, 0.26 * sc, 1, 1, 1, 0.45);
    B.main.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, fl, f);
    if (!item) B.shadow.add(s, o.x, o.y, sc, sc, 1, 1, 1, 1, 0, 0, 0, f);
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

export { TAU };
