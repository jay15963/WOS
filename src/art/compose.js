// Visual composition & animation: turns game state into sprite instances. Reads state only (private
// `_`-prefixed caches aside), no game logic, allocation-light (runs every frame for every visible object).
// B = renderer.batches, A = atlas, t = time (s).
// batch.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift)
//
// Pawn state read here (see docs/CONTENT.md §3):
//   look { skin, hair, hairColor, shirt, pants?, beard?, hat?:'bandana', hatColor?, face?:'scar'|'eyepatch'|'mask' }
//   weapon (item id → held_<id>; legacy 'sword'|'axe'|'pickaxe'|'spear'|'club'; null = bare hands)
//   offhand ('shield_*' | 'torch_hand'), armor { body, head } (→ wear_<id>_<dir>), blocking (bool)
//   action { type, t } — attack, chop, mine, gather, pick, build, cast, shoot, throw, block, bash, stab, cleave,
//   smash, pierce (+ ability ids: strike, lacerate, sweep, whirlwind, charge, aimed_shot, multi_shot, disengage,
//   shield_bash, torch_swing, shove, punch, bandage)
// Animal state: species, facing, moving, moveT, action, flash, dead, deadT, scale, variant? (deer: 1 = doe; else id parity)

import { PAWN } from './pawns.js';
import { TORCH_TIP } from './gear.js';
import { WEAR_HIDES_HAIR } from './apparel.js';

// set by the game (artcompat.js): called once per missing sprite when a fallback is drawn (must never happen
// with a validated atlas). Kept as a hook so the art module graph does not import game/net code.
export const artHooks = { warn: null };

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u * u;
const smooth = (u) => u * u * (3 - 2 * u);

// ---------- sprite lookup tables (built once per atlas) ----------
const CACHE = new WeakMap();
const DIRS = ['s', 'n', 'e'];
const LEGACY = { sword: 'sword_iron', axe: 'axe_iron', pickaxe: 'pickaxe_iron', spear: 'spear_iron', club: 'club_wood', mace: 'club_iron', bow: 'bow_wood', knife: 'knife_iron', shield: 'shield_wood', torch: 'torch_hand', hammer: 'hammer' };
const LEGACY_SPR = { sword: 'weapon_sword', axe: 'weapon_axe', pickaxe: 'tool_pickaxe', spear: 'weapon_spear', club: 'weapon_club' };
const SPECIES = ['wolf', 'boar', 'deer', 'deer_doe', 'rabbit', 'bear', 'fox', 'spider'];
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  T = {
    A, body: {}, legs: {}, head: {}, brows: {}, hair: {}, beard: {}, hat: {}, face: {}, animal: {}, flames: [],
    held: new Map(), wear: new Map(),
    blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft'), spark: opt('fx_spark') || opt('fx_soft'), hand: opt('pawn_hand'),
  };
  for (const d of DIRS) {
    T.body[d] = A.get('pawn_body_' + d); T.head[d] = A.get('pawn_head_' + d);
    T.legs[d] = opt('pawn_legs_' + d); T.brows[d] = opt('brows_' + d);
    T.hat[d] = opt('hat_bandana_' + d);
  }
  for (const s of A.list) {
    const m = s.name.match(/^hair_(\w+)_([sne])$/);
    if (m) (T.hair[m[1]] ||= {})[m[2]] = s;
    const f = s.name.match(/^face_(\w+)_([se])$/);
    if (f) (T.face[f[1]] ||= {})[f[2]] = s;
  }
  T.beard.s = opt('beard_s'); T.beard.e = opt('beard_e');
  for (const sp of SPECIES) {
    if (!A.has(sp + '_e')) continue;
    const e = A.get(sp + '_e');
    const fr = (n) => opt(sp + n) || e;
    const s = opt(sp + '_s') || e, n = opt(sp + '_n') || e;
    T.animal[sp] = {
      e, s, n,
      ew: [fr('_e_walk'), fr('_e_w1'), opt(sp + '_e_w2') || fr('_e_walk'), opt(sp + '_e_w3') || fr('_e_w1')],
      sw: [opt(sp + '_s_w1') || s, s, opt(sp + '_s_w2') || s, s],
      nw: [opt(sp + '_n_w1') || n, n, opt(sp + '_n_w2') || n, n],
      dead: opt(sp + '_dead'),
    };
  }
  for (let i = 0; i < 3; i++) T.flames.push(opt('fx_flame_' + i) || A.get('fx_flame'));
  T.axe = held(T, 'axe_iron'); T.pick = held(T, 'pickaxe_iron'); T.bow = held(T, 'bow_wood'); T.hammer = held(T, 'hammer');
  CACHE.set(A, T);
  return T;
}

// held item record { s, type, e?, n?, d1?, d2? } for an item id (cached; null = nothing to draw)
const NO_HELD = { s: null, type: null };
function held(T, id) {
  if (!id) return NO_HELD;
  let r = T.held.get(id);
  if (r) return r;
  const A = T.A;
  const type = id.split('_')[0];
  let name = 'held_' + id;
  if (!A.has(name) && LEGACY[id]) name = 'held_' + LEGACY[id];
  if (!A.has(name)) {
    // unknown tier: any held sprite of the same type (prefer iron / stone / wood)
    name = null;
    for (const t of ['iron', 'stone', 'wood', 'copper', 'steel', 'primitive']) if (A.has(`held_${type}_${t}`)) { name = `held_${type}_${t}`; break; }
    if (!name) for (const s of A.list) if (s.name.startsWith('held_' + type + '_') && !/_(e|n|draw1?)$/.test(s.name)) { name = s.name; break; }
  }
  const s = name ? A.get(name) : LEGACY_SPR[type] && A.has(LEGACY_SPR[type]) ? A.get(LEGACY_SPR[type]) : null;
  const opt = (n) => (name && A.has(name + n) ? A.get(name + n) : null);
  r = s ? { s, type: LEGACY[id] ? LEGACY[id].split('_')[0] : type, e: opt('_e'), n: opt('_n'), d1: opt('_draw1'), d2: opt('_draw') } : NO_HELD;
  T.held.set(id, r);
  return r;
}
function wear(T, id, d) {
  if (!id) return null;
  const k = id + '|' + d;
  let s = T.wear.get(k);
  if (s === undefined) { s = T.A.has(`wear_${id}_${d}`) ? T.A.get(`wear_${id}_${d}`) : null; T.wear.set(k, s); }
  return s;
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
// thrust curve: pull back (−) then a fast jab (+1) then recover
function thrust(k, wEnd = 0.3, hEnd = 0.48, back = 0.5) {
  if (k < wEnd) return -back * easeOut(k / wEnd);
  if (k < hEnd) return -back + (1 + back) * easeIn((k - wEnd) / (hEnd - wEnd));
  return 1 - smooth((k - hEnd) / (1 - hEnd));
}
const hump = (k) => Math.sin(clamp01(k) * Math.PI);

const DEFAULT_LOOK = { skin: [0.95, 0.8, 0.66], hair: 'short', hairColor: [0.35, 0.22, 0.12], shirt: [0.5, 0.5, 0.5] };
const PANTS = [0.42, 0.35, 0.28];
const HAT_COL = [0.62, 0.17, 0.13];
const TALL_HAIR = { mohawk: 1, bun: 1 };
// action type → pose (attack depends on the weapon)
const POSE_OF = {
  strike: 'attack', punch: 'attack', lacerate: 'slash', sweep: 'cleave', aimed_shot: 'shoot', multi_shot: 'shoot',
  shield_bash: 'bash', torch_swing: 'torch',
};
const ATTACK_OF = { knife: 'stab', sword: 'slash', axe: 'heavy', pickaxe: 'heavy', club: 'smash', spear: 'pierce', bow: 'shoot', torch: 'slash', hammer: 'smash' };
const WHIRL = ['s', 'e', 'n', 'w'];

// ---------- pawns (humanoids) ----------
export function drawPawn(B, A, p, t) {
  const T = tables(A);
  const act = p.action && p.action.t < 1 ? p.action : null;
  const k = act ? clamp01(act.t) : 0;
  let pose = act ? POSE_OF[act.type] || act.type : null;
  let dir = p.facing || 's';
  if (pose === 'whirlwind') dir = WHIRL[(Math.floor(k * 8) + WHIRL.indexOf(dir === 'w' ? 'w' : dir)) & 3];
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  const L = p.look || DEFAULT_LOOK;
  const fl = p.flash || 0;
  const sh = L.shirt || DEFAULT_LOOK.shirt, sk = L.skin || DEFAULT_LOOK.skin, hc = L.hairColor || DEFAULT_LOOK.hairColor;
  const pc = L.pants || PANTS, hat = L.hatColor || HAT_COL;
  const body = T.body[sd], head = T.head[sd], legs = T.legs[sd];
  const armor = p.armor;
  const wb = armor ? wear(T, armor.body, sd) : null;
  const wh = armor ? wear(T, armor.head, sd) : null;
  const bandana = L.hat === 'bandana' ? T.hat[sd] : null;
  const hides = wh ? WEAR_HIDES_HAIR[armor.head] : bandana ? 'tall' : null;
  const hs = T.hair[L.hair];
  let hair = hs ? hs[sd] : null;
  if (hides === true || (hides === 'tall' && TALL_HAIR[L.hair])) hair = null;
  const beard = L.beard && sd !== 'n' ? T.beard[sd] : null;
  const brows = sd !== 'n' ? T.brows[sd] : null;
  const fs = L.face && T.face[L.face] ? T.face[L.face][sd === 'n' ? 'x' : sd] : null;
  const fTint = L.face === 'mask' ? hat : null;
  const ph0 = phaseOf(p);

  const M = held(T, p.weapon);
  let O = held(T, p.offhand);
  if (M.type === 'bow') O = NO_HELD; // two-handed

  if (p.dead) {
    const u = clamp01((p.deadT || 0) * 2.8);
    const kk = u < 0.75 ? easeIn(u / 0.75) : 1 - Math.sin(((u - 0.75) / 0.25) * Math.PI) * 0.07;
    const side = sd === 'e' ? -flip : ph0 % TAU > Math.PI ? 1 : -1;
    const rot = side * HALF_PI * kk;
    const HL = PAWN.headLift;
    const hx = p.x + Math.sin(rot) * HL, hy = p.y - Math.cos(rot) * HL;
    if (T.blob) B.blob.add(T.blob, p.x + side * 0.3 * kk, p.y, 0.75 + 0.5 * kk, 0.6, 1, 1, 1, 0.55);
    if (M.s) B.main.add(M.s, p.x - side * 0.25, p.y + 0.12, 0.9, 0.9, 1, 1, 1, 1, 0, side * HALF_PI * 1.15, fl, 1, 0, 0.02);
    if (O.s) B.main.add(O.s, p.x + side * 0.15, p.y + 0.18, 0.9, 0.9, 1, 1, 1, 1, 0, side * 0.3, fl, 1, 0, 0.01);
    B.main.add(body, p.x, p.y, 1, 1, sh[0], sh[1], sh[2], 1, 0, rot, fl, flip, 0, 0);
    if (legs) B.main.add(legs, p.x, p.y, 1, 1, pc[0], pc[1], pc[2], 1, 0, rot, fl, flip, 0, 0);
    if (wb) B.main.add(wb, p.x, p.y, 1, 1, 1, 1, 1, 1, 0, rot, fl, flip, 0, 0);
    B.main.add(head, hx, hy, 1, 1, sk[0], sk[1], sk[2], 1, 0, rot, fl, flip, 0, 0);
    if (fs) B.main.add(fs, hx, hy, 1, 1, fTint ? fTint[0] : 1, fTint ? fTint[1] : 1, fTint ? fTint[2] : 1, 1, 0, rot, fl, flip, 0, 0);
    if (beard) B.main.add(beard, hx, hy, 1, 1, hc[0], hc[1], hc[2], 1, 0, rot, fl, flip, 0, 0);
    if (hair) B.main.add(hair, hx, hy, 1, 1, hc[0], hc[1], hc[2], 1, 0, rot, fl, flip, 0, 0);
    if (bandana) B.main.add(bandana, hx, hy, 1, 1, hat[0], hat[1], hat[2], 1, 0, rot, fl, flip, 0, 0);
    if (wh) B.main.add(wh, hx, hy, 1, 1, 1, 1, 1, 1, 0, rot, fl, flip, 0, 0);
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

  // ---- held items: rest pose ----
  const H = sd === 's' ? PAWN.handS : sd === 'n' ? PAWN.handN : PAWN.handE;
  const OH = sd === 's' ? PAWN.offS : sd === 'n' ? PAWN.offN : PAWN.offE;
  let wsp = M.s, wType = M.type;
  let wRot = 0, wSy = 1, wSx = 1, wHx = 0, wHl = 0, wBehind = sd === 'n', showW = !!wsp, wFlipK = 1;
  const long = wType === 'spear' || wType === 'bow' || wType === 'torch';
  if (sd === 'e') wRot = flip * (long ? 0.18 : 0.55); else if (sd === 's') wRot = long ? -0.15 : -0.5; else wRot = long ? 0.15 : 0.4;
  // off hand (shield / torch)
  let osp = O.s, oType = O.type, oRot = 0, oSc = 1, oHx = 0, oHl = 0, showO = !!osp;
  let oBehind = sd === 'n' || (sd === 'e' && flip > 0);
  if (osp && oType === 'shield') { if (sd === 'e') osp = O.e || osp; else if (sd === 'n') osp = O.n || osp; }
  if (oType === 'torch') { oRot = sd === 'e' ? flip * 0.12 : sd === 's' ? 0.2 : -0.2; }
  // hands (fists / grips): up to two, in tile offsets from the pawn
  let h1 = false, h1x = 0, h1l = 0, h1dy = 0, h1b = false, h2 = false, h2x = 0, h2l = 0, h2dy = 0, h2b = false;
  let blockK = p.blocking ? 1 : 0;

  // ---- actions ----
  if (pose === 'attack') pose = wType ? ATTACK_OF[wType] || 'slash' : 'punch';
  if (pose === 'chop' || pose === 'mine') {
    const want = pose === 'chop' ? 'axe' : 'pickaxe';
    if (wType !== want) { const R = pose === 'chop' ? T.axe : T.pick; wsp = R.s || wsp; }
    pose = 'heavy';
  } else if (pose === 'build') {
    if (T.hammer.s) wsp = T.hammer.s;
  } else if (pose === 'shoot' && wType !== 'bow') {
    if (T.bow.s) { wsp = T.bow.s; wType = 'bow'; }
  }
  showW = !!wsp;
  // bows are slung across the back unless shooting
  if (wType === 'bow' && pose !== 'shoot' && wsp === M.s) {
    wRot = sd === 'e' ? flip * 1.05 : sd === 's' ? 0.75 : -0.75;
    wHx = -H[0] * flip + (sd === 'e' ? -flip * 0.1 : 0);
    wHl = 0.5 - H[1];
    wBehind = sd !== 'n'; wSx = wSy = 0.82;
  }
  if (act && pose) {
    if (pose === 'slash' || pose === 'heavy' || pose === 'cleave') {
      const heavy = pose === 'heavy';
      const wide = pose === 'cleave';
      if (sd === 'e') {
        heavy ? swing(k, 0.55, -1.75, 1.7, 0.45, 0.62) : wide ? swing(k, 0.55, -1.7, 2.6, 0.38, 0.56) : swing(k, 0.55, -1.35, 2.15);
        wRot = flip * W_ANG;
        wHl = W_WIND * 0.14 - W_HIT * 0.06;
        wHx = flip * (W_HIT * 0.1 - W_WIND * 0.06);
        rot += flip * (W_HIT * 0.13 - W_WIND * 0.08);
        ox += flip * W_HIT * 0.09;
        if (wide) sx *= 1 - W_HIT * 0.12;
      } else if (sd === 's') {
        if (heavy) {
          // overhead chop toward the camera: foreshorten the tool (tip up → tip down)
          swing(k, 0, -1, 1, 0.45, 0.62);
          wRot = -0.3 + Math.max(0, W_ANG) * 0.55;
          wSy = W_ANG <= 0 ? 1 : 1 - W_ANG * 1.85;
          wHl = W_WIND * 0.2 - W_HIT * 0.12; wHx = 0.1 * W_HIT;
          headDy -= W_HIT * 0.03;
        } else if (wide) {
          swing(k, -0.5, -1.9, 2.0, 0.38, 0.56);
          wRot = W_ANG; wHx = W_HIT * 0.32 - W_WIND * 0.04; wHl = W_WIND * 0.08 - W_HIT * 0.04;
          rot += W_HIT * 0.08 - W_WIND * 0.06; sx *= 1 - W_HIT * 0.08;
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
          swing(k, 0.4, wide ? 2.2 : 2.3, wide ? -2.0 : -0.95, wide ? 0.38 : 0.4, wide ? 0.56 : 0.6);
          wRot = W_ANG;
          wHl = W_WIND * 0.08 + W_HIT * 0.06; wHx = -W_HIT * (wide ? 0.3 : 0.16);
          rot += W_WIND * 0.05 - W_HIT * 0.06;
        }
        oy -= W_HIT * 0.06;
      }
    } else if (pose === 'smash') {
      // overhead slam: big raise, short hold, hard impact with a squash
      if (sd === 'e') {
        swing(k, 0.55, -2.4, 2.0, 0.42, 0.56);
        wRot = flip * W_ANG; wHl = W_WIND * 0.3 - W_HIT * 0.1; wHx = flip * (W_HIT * 0.14 - W_WIND * 0.1);
        rot += flip * (W_HIT * 0.2 - W_WIND * 0.12); ox += flip * W_HIT * 0.08; lift += W_WIND * 0.05;
      } else {
        swing(k, 0, -1, 1, 0.42, 0.56);
        wRot = sd === 's' ? -0.2 + Math.max(0, W_ANG) * 0.5 : 0.1;
        wSy = W_ANG <= 0 ? 1 + W_WIND * 0.1 : 1 - W_ANG * (sd === 's' ? 1.9 : 0.6);
        wHl = W_WIND * 0.32 - W_HIT * (sd === 's' ? 0.14 : -0.04); wHx = (sd === 's' ? 0.16 : -0.08) * W_HIT;
        oy += (sd === 's' ? 0.06 : -0.05) * W_HIT; lift += W_WIND * 0.05;
      }
      if (k > 0.55 && k < 0.72) { const u = 1 - Math.abs((k - 0.6) / 0.1); sy *= 1 - 0.1 * clamp01(u); sx *= 1 + 0.07 * clamp01(u); }
    } else if (pose === 'stab' || pose === 'pierce' || pose === 'charge') {
      const pr = pose === 'pierce', ch = pose === 'charge';
      const f = ch ? Math.min(1, k * 3) * (1 - smooth(clamp01((k - 0.75) / 0.25))) : pr ? thrust(k, 0.36, 0.52, 0.6) : thrust(k, 0.26, 0.42, 0.45);
      const reach = pr ? 0.3 : ch ? 0.16 : 0.22;
      if (sd === 'e') {
        wRot = flip * HALF_PI * (wType === 'spear' || pr ? 1 : 0.95); wHx = flip * (0.06 + f * reach); wHl = 0.03;
        rot += flip * f * (ch ? 0.2 : 0.09); ox += flip * Math.max(0, f) * (ch ? 0.12 : 0.06);
        if (pr) { h2 = true; h2x = flip * (0.0 + f * reach * 0.6); h2l = 0.27; }
      } else if (sd === 's') {
        wRot = Math.PI - 0.15; wSy = 0.5 + 0.2 * (1 - Math.max(0, f)); wHx = 0.1 + f * 0.04; wHl = 0.24 - f * 0.05; oy += f * reach * 0.35;
        if (pr) { h2 = true; h2x = 0.05; h2l = 0.18 - f * 0.04; h2dy = f * reach * 0.3; }
      } else {
        wRot = 0.05; wSy = 0.6; wHx = -0.08; wHl = 0.32 + f * reach * 0.6; oy -= f * reach * 0.3;
      }
      if (ch) { sx *= 1 + f * 0.05; sy *= 1 - f * 0.04; }
    } else if (pose === 'shoot') {
      // bow: raise, draw (string pulled, arrow nocked), release with a small recoil
      const draw = k < 0.12 ? 0 : k < 0.7 ? (k - 0.12) / 0.58 : 0;
      const recoil = k >= 0.7 ? 1 - smooth((k - 0.7) / 0.3) : 0;
      const R = wType === 'bow' ? (wsp === M.s ? M : T.bow) : T.bow;
      if (draw > 0) wsp = draw > 0.45 ? R.d2 || wsp : R.d1 || wsp;
      const up = smooth(clamp01(k / 0.14)) * (1 - smooth(clamp01((k - 0.8) / 0.2)));
      const pull = draw > 0.45 ? 0.2 : draw > 0 ? 0.11 : 0;
      if (sd === 'e') {
        wRot = flip * 0.18 * (1 - up); wHx = flip * (0.16 * up - 0.04 * recoil * up); wHl = 0.06 * up; wFlipK = 1;
        if (draw > 0) { h2 = true; h2x = flip * (H[0] + 0.16 * up - pull); h2l = H[1] + 0.06 * up; }
        rot -= flip * draw * 0.05;
      } else if (sd === 's') {
        wRot = -0.15 + (HALF_PI + 0.15) * up; wHx = 0.23 * up; wHl = 0.06 * up; wBehind = false;
        if (draw > 0) { h2 = true; h2x = H[0] + 0.23 * up; h2l = H[1] + 0.06 + pull; }
      } else {
        wRot = 0.15 - (HALF_PI + 0.15) * up; wHx = -0.22 * up; wHl = 0.08 * up;
        if (draw > 0) { h2 = true; h2x = H[0] - 0.22 * up; h2l = H[1] + 0.08 - pull; h2b = true; }
      }
    } else if (pose === 'throw') {
      if (sd === 'e') { swing(k, 0.55, -2.0, 1.3, 0.45, 0.56); wRot = flip * W_ANG; wHl = W_WIND * 0.22; wHx = flip * (W_HIT * 0.18 - W_WIND * 0.12); rot += flip * (W_HIT * 0.12 - W_WIND * 0.1); }
      else { swing(k, 0, -1, 1, 0.45, 0.56); wSy = W_ANG <= 0 ? 1 : 1 - W_ANG * 0.8; wHl = W_WIND * 0.25; oy += (sd === 's' ? 0.05 : -0.05) * W_HIT; }
      if (k > 0.55 && wType === 'spear') showW = false; // thrown
    } else if (pose === 'block') {
      blockK = Math.max(blockK, hump(Math.min(1, k * 1.4)) > 0 ? smooth(clamp01(k / 0.2)) * (1 - smooth(clamp01((k - 0.8) / 0.2))) : 0);
    } else if (pose === 'bash' || pose === 'shove') {
      const f = thrust(k, 0.28, 0.44, 0.4);
      ox += sd === 'e' ? flip * Math.max(0, f) * 0.12 : 0; oy += sd === 's' ? Math.max(0, f) * 0.08 : sd === 'n' ? -Math.max(0, f) * 0.08 : 0;
      rot += sd === 'e' ? flip * f * 0.1 : 0;
      if (pose === 'bash' && showO && oType === 'shield') { blockK = 1; oHx = sd === 'e' ? flip * f * 0.18 : 0; oHl = sd === 'n' ? f * 0.06 : -f * 0.03; oSc = 1 + Math.max(0, f) * 0.1; }
      else {
        h1 = h2 = true;
        if (sd === 'e') { h1x = flip * (0.16 + f * 0.2); h1l = 0.3; h2x = flip * (0.1 + f * 0.2); h2l = 0.24; h2b = flip > 0; }
        else if (sd === 's') { h1x = -0.14; h2x = 0.14; h1l = h2l = 0.27 - Math.max(0, f) * 0.04; h1dy = h2dy = Math.max(0, f) * 0.12; }
        else { h1x = -0.14; h2x = 0.14; h1l = h2l = 0.33 + Math.max(0, f) * 0.06; h1b = h2b = true; }
      }
    } else if (pose === 'punch') {
      // fist jab, alternating hands between consecutive punches
      if (p._pk === undefined || k < p._pk - 0.3) p._ps = p._ps ? 0 : 1;
      const f = thrust(k, 0.22, 0.4, 0.35), side = p._ps ? 1 : -1;
      h1 = true; h2 = true;
      if (sd === 'e') {
        h1x = flip * (0.12 + Math.max(0, f) * 0.26 - (f < 0 ? -f * 0.06 : 0)); h1l = 0.3;
        h2x = flip * 0.04; h2l = 0.26; h2b = flip > 0;
        if (side < 0) { const tx = h1x; h1x = h2x; h2x = tx; const tb = h2b; h2b = false; h1b = tb; }
        rot += flip * f * 0.09; ox += flip * Math.max(0, f) * 0.05;
      } else if (sd === 's') {
        h1x = side * 0.17; h1l = 0.28 - Math.max(0, f) * 0.04; h1dy = Math.max(0, f) * 0.16;
        h2x = -side * 0.19; h2l = 0.27; rot += side * f * 0.05;
      } else {
        h1x = side * 0.16; h1l = 0.32 + Math.max(0, f) * 0.1; h1b = true; h2x = -side * 0.19; h2l = 0.3; h2b = true;
      }
      showW = false;
    } else if (pose === 'pick' || pose === 'gather' || pose === 'bandage') {
      const u = pose === 'pick' ? hump(k) : 1;
      const b = pose === 'gather' ? Math.abs(Math.sin(k * Math.PI * 3)) : pose === 'bandage' ? Math.abs(Math.sin(k * Math.PI * 4)) : 0;
      sy *= 1 - 0.13 * u + b * 0.04; sx *= 1 + 0.05 * u - b * 0.02;
      headDy -= (0.08 + (pose === 'pick' ? 0.05 : 0)) * u - b * 0.03;
      if (sd === 'e') rot += flip * (0.14 + (pose === 'pick' ? 0.18 : 0) * u + b * 0.04);
      else oy += sd === 's' ? 0.03 * u : -0.03 * u;
      showW = false; showO = showO && oType === 'torch';
      h1 = true;
      if (pose === 'bandage') {
        const a = k * TAU * 2;
        h1x = (sd === 'e' ? flip * 0.12 : 0.06) + Math.cos(a) * 0.05; h1l = 0.24 + Math.sin(a) * 0.04; h1b = sd === 'n';
        h2 = true; h2x = sd === 'e' ? flip * 0.04 : -0.12; h2l = 0.22; h2b = sd === 'n' || (sd === 'e' && flip > 0);
      } else {
        const reach = pose === 'pick' ? u : 0.5 + 0.5 * b;
        if (sd === 'e') { h1x = flip * (0.18 + 0.14 * reach); h1l = 0.24 - 0.2 * reach; }
        else if (sd === 's') { h1x = (pose === 'gather' && Math.sin(k * Math.PI * 6) > 0 ? -0.12 : 0.12); h1l = 0.22 - 0.16 * reach; h1dy = 0.1 * reach; }
        else { h1x = 0.1; h1l = 0.28 - 0.1 * reach; h1b = true; }
      }
    } else if (pose === 'build') {
      const kk = (k * 2) % 1;
      if (sd === 'e') { swing(kk, 0.3, -1.3, 1.25, 0.5, 0.66); wRot = flip * W_ANG; wHl = W_WIND * 0.12; wHx = flip * (W_HIT * 0.06); rot += flip * (0.08 + W_HIT * 0.06); }
      else { swing(kk, 0, -1, 1, 0.5, 0.66); wRot = sd === 's' ? -0.3 : 0.2; wSy = W_ANG <= 0 ? 1 : 1 - W_ANG * (sd === 's' ? 1.5 : 0.5); wHl = W_WIND * 0.16 - W_HIT * 0.06; }
      sy *= 1 - W_HIT * 0.03;
      showW = !!wsp;
    } else if (pose === 'cast') {
      const u = Math.sin(k * Math.PI);
      lift += u * 0.06; sy *= 1 + u * 0.04;
      wHl = u * 0.2; wRot = sd === 'e' ? flip * (0.55 - u * 0.6) : wRot * (1 - u);
    } else if (pose === 'whirlwind') {
      // spinning: facing already cycles; weapon held straight out to the side
      wRot = sd === 'e' ? flip * 1.75 : sd === 's' ? -1.75 : 1.75; wHl = 0.02; wHx = sd === 'e' ? flip * 0.06 : sd === 's' ? -0.08 : 0.08;
      lift += 0.03 * hump(k); sx *= 0.94;
    } else if (pose === 'disengage') {
      const u = hump(k);
      lift += u * 0.26; rot -= (sd === 'e' ? flip : 0) * u * 0.14; oy += sd === 's' ? -u * 0.1 : sd === 'n' ? u * 0.1 : 0; ox -= sd === 'e' ? flip * u * 0.15 : 0;
      sy *= 1 + u * 0.05;
    } else if (pose === 'torch') {
      if (showO) {
        swing(k, sd === 'e' ? 0.2 : 0.2, sd === 'e' ? -1.4 : -1.2, sd === 'e' ? 2.0 : 1.9, 0.38, 0.56);
        oRot = sd === 'e' ? flip * W_ANG : sd === 's' ? W_ANG : -W_ANG;
        oHl = W_WIND * 0.12; oHx = sd === 'e' ? flip * W_HIT * 0.14 : sd === 's' ? -W_HIT * 0.2 : W_HIT * 0.2;
        if (sd === 'e') oBehind = false;
      }
    }
  }
  p._pk = act ? k : 1;
  // raised shield (block / blocking flag)
  if (blockK > 0 && showO && oType === 'shield') {
    if (sd === 's') { oHx = -OH[0] * 0.8 * blockK + oHx; oHl += 0.04 * blockK; oSc *= 1 + 0.12 * blockK; }
    else if (sd === 'e') { oHx += flip * 0.1 * blockK; oHl += 0.02 * blockK; oSc *= 1 + 0.1 * blockK; if (blockK > 0.5) oBehind = false; }
    else { oHx = -OH[0] * 0.7 * blockK + oHx; oHl += 0.16 * blockK; }
    if (!act || pose === 'block') { wHl -= 0.04 * blockK; wRot *= 1 - 0.4 * blockK; }
  }

  const x = p.x + ox, y = p.y + oy;
  const HL = PAWN.headLift * sy;
  const hx = x + Math.sin(rot) * HL;
  const hl = lift + Math.cos(rot) * HL + headDy;
  const hr = rot * 0.55 + headRot;

  // contact shadow (shrinks a little while airborne)
  if (T.blob) B.blob.add(T.blob, p.x, p.y, 0.7 - lift * 0.8, 0.6 - lift * 0.6, 1, 1, 1, 0.75);

  // item positions
  let wx = 0, wl = 0;
  if (showW && wsp) { wx = x + H[0] * flip + wHx + Math.sin(rot) * H[1]; wl = lift + H[1] * sy + wHl; }
  let ox2 = 0, ol = 0;
  if (showO && osp) { ox2 = x + OH[0] * flip + oHx + Math.sin(rot) * OH[1]; ol = lift + OH[1] * sy + oHl; }
  const wFlip = sd === 'e' ? flip * wFlipK : 1;
  const oFlip = sd === 'e' ? flip : 1;
  const hand = T.hand;
  const hx1 = x + h1x, hx2 = x + h2x;

  // behind the body
  if (showO && osp && oBehind) B.main.add(osp, ox2, y, oSc, oSc, 1, 1, 1, 1, 0, oRot, fl, oFlip, 0, ol);
  const wA = p._wFade == null ? 1 : p._wFade; // thrown spear coming back (src/ui/aim.js)
  if (showW && wsp && wBehind) B.main.add(wsp, wx, y, wSx, wSy, 1, 1, 1, wA, 0, wRot, fl, wFlip, 0, wl);
  if (hand && h1 && h1b) B.main.add(hand, hx1, y + h1dy, 1, 1, sk[0], sk[1], sk[2], 1, 0, 0, fl, 1, 0, lift + h1l);
  if (hand && h2 && h2b) B.main.add(hand, hx2, y + h2dy, 1, 1, sk[0], sk[1], sk[2], 1, 0, 0, fl, 1, 0, lift + h2l);
  // body
  B.main.add(body, x, y, sx, sy, sh[0], sh[1], sh[2], 1, 0, rot, fl, flip, 0, lift);
  if (legs) B.main.add(legs, x, y, sx, sy, pc[0], pc[1], pc[2], 1, 0, rot, fl, flip, 0, lift);
  if (wb) B.main.add(wb, x, y, sx, sy, 1, 1, 1, 1, 0, rot, fl, flip, 0, lift);
  // head
  B.main.add(head, hx, y, 1, 1, sk[0], sk[1], sk[2], 1, 0, hr, fl, flip, 0, hl);
  if (fs && L.face !== 'mask') B.main.add(fs, hx, y, 1, 1, 1, 1, 1, 1, 0, hr, fl, flip, 0, hl);
  if (brows && !(wh && armor.head === 'helmet_iron' && sd === 's')) B.main.add(brows, hx, y, 1, 1, hc[0], hc[1], hc[2], 1, 0, hr, fl, flip, 0, hl);
  if (beard) B.main.add(beard, hx, y, 1, 1, hc[0], hc[1], hc[2], 1, 0, hr, fl, flip, 0, hl);
  if (fs && L.face === 'mask') B.main.add(fs, hx, y, 1, 1, fTint[0], fTint[1], fTint[2], 1, 0, hr, fl, flip, 0, hl);
  if (hair) B.main.add(hair, hx, y, 1, 1, hc[0], hc[1], hc[2], 1, 0, hr, fl, flip, 0, hl);
  if (bandana && !wh) B.main.add(bandana, hx, y, 1, 1, hat[0], hat[1], hat[2], 1, 0, hr, fl, flip, 0, hl);
  if (wh) B.main.add(wh, hx, y, 1, 1, 1, 1, 1, 1, 0, hr, fl, flip, 0, hl);
  // in front of the body
  if (showW && wsp && !wBehind) B.main.add(wsp, wx, y, wSx, wSy, 1, 1, 1, wA, 0, wRot, fl, wFlip, 0, wl);
  if (showO && osp && !oBehind) B.main.add(osp, ox2, y, oSc, oSc, 1, 1, 1, 1, 0, oRot, fl, oFlip, 0, ol);
  if (hand && h1 && !h1b) B.main.add(hand, hx1, y + h1dy, 1, 1, sk[0], sk[1], sk[2], 1, 0, 0, fl, 1, 0, lift + h1l);
  if (hand && h2 && !h2b) B.main.add(hand, hx2, y + h2dy, 1, 1, sk[0], sk[1], sk[2], 1, 0, 0, fl, 1, 0, lift + h2l);

  // hand torch flame (emissive) at the tip
  const torchOn = showO && oType === 'torch' ? 1 : showW && wType === 'torch' ? 2 : 0;
  if (torchOn) {
    const r = torchOn === 1 ? oRot : wRot;
    const tx = (torchOn === 1 ? ox2 : wx) + Math.sin(r) * TORCH_TIP, tl = (torchOn === 1 ? ol : wl) + Math.cos(r) * TORCH_TIP;
    const seed = ph0;
    const fph = t * 11 + seed;
    const fk = 0.9 + 0.12 * Math.sin(fph) + 0.06 * Math.sin(fph * 2.3);
    const lean = -r * 0.4 + (p.moving ? -flip * 0.25 : 0) + 0.1 * Math.sin(fph * 0.6);
    B.emissive.add(T.flames[0], tx, y, 0.34 * fk, 0.46 * fk, 1, 1, 1, 0.95, 0, lean, 0, 1, 0, tl - 0.02);
    B.emissive.add(T.flames[1], tx, y, 0.22, 0.3 * (0.8 + 0.2 * Math.sin(fph * 1.7)), 1, 1, 1, 0.8, 0, lean - 0.1, 0, 1, 0, tl);
    if (T.glow) B.emissive.add(T.glow, tx, y, 0.75, 0.75, 1, 0.6, 0.3, 0.22 + 0.04 * Math.sin(fph * 1.3), 0, 0, 0, 1, 0, tl + 0.12);
  }

  B.shadow.add(body, x, y, sx, sy, 1, 1, 1, 0.9, 0, rot, 0, flip, 0, lift);
  B.shadow.add(head, hx, y, 1, 1, 1, 1, 1, 0.9, 0, hr, 0, flip, 0, hl);
  const topS = wh || hair || bandana;
  if (topS) B.shadow.add(topS, hx, y, 1, 1, 1, 1, 1, 0.9, 0, hr, 0, flip, 0, hl);
  if (showW && wsp) B.shadow.add(wsp, wx, y, wSx, wSy, 1, 1, 1, 0.8 * wA, 0, wRot, 0, wFlip, 0, wl);
  if (showO && osp) B.shadow.add(osp, ox2, y, oSc, oSc, 1, 1, 1, 0.8, 0, oRot, 0, oFlip, 0, ol);
}

// ---------- animals ----------
// a: { x, y, species, facing, moving, moveT, action, flash, dead, deadT, scale, variant? }
// f: gait speed (rad per moveT unit; 4 frames per cycle), bob: body lift, rock: pitch/roll
const GAIT = {
  wolf: { f: 10, bob: 0.05, rock: 0.035 },
  fox: { f: 11, bob: 0.045, rock: 0.035 },
  boar: { f: 12.5, bob: 0.04, rock: 0.045 },
  deer: { f: 8.5, bob: 0.075, rock: 0.035 },
  rabbit: { f: 7.5, bob: 0.2, rock: 0.15, hop: true },
  bear: { f: 6.5, bob: 0.045, rock: 0.06, roll: 0.035 },
  spider: { f: 15, bob: 0.015, rock: 0.02, skitter: true },
};
const GAIT_DEF = { f: 10, bob: 0.05, rock: 0.04 };
export function drawAnimal(B, A, a, t) {
  const T = tables(A);
  let key = a.species;
  if (key === 'deer' && (a.variant === 1 || (a.variant == null && ((a.id ?? 0) & 1))) && T.animal.deer_doe) key = 'deer_doe';
  let S = T.animal[key];
  if (!S) { artHooks.warn?.(key + '_s'); S = T.animal.wolf; }
  if (!S) return;
  const dir = a.facing || 'e';
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  const sc = a.scale || 1;
  const fl = a.flash || 0;
  const sp = a.species;
  const G = GAIT[sp] || GAIT_DEF;
  const ph0 = phaseOf(a);

  if (a.dead) {
    const u = clamp01((a.deadT || 0) * 2.6);
    const k = u < 0.7 ? easeIn(u / 0.7) : 1 - Math.sin(((u - 0.7) / 0.3) * Math.PI) * 0.08;
    if (S.dead) {
      // spider: flips onto its back with a little bounce, legs curled
      const s = u < 0.5 ? S.e : S.dead;
      const hop = Math.sin(clamp01(u / 0.6) * Math.PI) * 0.25 * sc;
      if (T.blob) B.blob.add(T.blob, a.x, a.y, s.w * 0.7 * sc, 0.6 * sc, 1, 1, 1, 0.5);
      B.main.add(s, a.x, a.y, sc, sc * (u < 0.5 ? 1 - u : 1), 0.85, 0.82, 0.8, 1, 0, u < 0.5 ? flip * u * 2 : 0, fl, flip, 0, hop);
      return;
    }
    const s = S.e;
    const rot = flip * HALF_PI * k;
    const c = s.h * s.ay * 0.45 * sc;
    if (T.blob) B.blob.add(T.blob, a.x, a.y, s.w * 0.8 * sc, 0.7 * sc, 1, 1, 1, 0.5);
    B.main.add(s, a.x - flip * c * k, a.y + 0.05 * k, sc, sc, 0.82, 0.8, 0.78, 1, 0, rot, fl, flip, 0, 0);
    return;
  }

  let spr = sd === 'e' ? S.e : sd === 's' ? S.s : S.n;
  let lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0;
  if (a.moving) {
    const ph = (a.moveT || 0) * G.f;
    const u = ((ph / TAU) % 1 + 1) % 1;
    const fi = (u * 4) | 0;
    if (G.hop) {
      // crouch → airborne stretch → land
      const air = u > 0.18 && u < 0.82 ? Math.sin(((u - 0.18) / 0.64) * Math.PI) : 0;
      lift = air * G.bob;
      if (sd === 'e') { spr = air > 0.12 ? S.ew[0] : S.ew[1]; rot = -flip * Math.cos(((u - 0.18) / 0.64) * Math.PI) * 0.16 * (air > 0 ? 1 : 0); }
      sy = air > 0 ? 1 + air * 0.08 : 0.9; sx = air > 0 ? 1 - air * 0.04 : 1.08;
    } else {
      lift = G.bob * (0.5 - 0.5 * Math.cos(2 * ph - HALF_PI));
      if (sd === 'e') { spr = S.ew[fi]; rot = flip * Math.sin(2 * ph) * G.rock * 0.5; }
      else { spr = sd === 's' ? S.sw[fi] : S.nw[fi]; rot = Math.sin(ph) * G.rock * 0.6; sx = 1 + Math.cos(2 * ph) * 0.02; }
      if (G.roll) { ox += Math.sin(ph) * G.roll * (sd === 'e' ? 0.3 : 1); rot += sd === 'e' ? 0 : Math.sin(ph) * G.roll; }
      if (G.skitter) ox += Math.sin(ph * 3.1) * 0.012;
    }
  } else {
    const br = Math.sin(t * 2 + ph0);
    sy = 1 + br * 0.016; sx = 1 - br * 0.006;
    // spiders twitch a leg now and then
    if (G.skitter && Math.sin(t * 1.3 + ph0 * 3) > 0.96) spr = sd === 'e' ? S.ew[1] : sd === 's' ? S.sw[0] : S.nw[0];
  }
  const act = a.action;
  if (act && act.type === 'attack' && act.t < 1) {
    const k = clamp01(act.t);
    // species flavours: canids pounce, boars gore, bears/deer/spiders rear up then strike
    const rear = sp === 'bear' || sp === 'deer' || sp === 'spider';
    let f;
    if (k < 0.4) f = -0.35 * easeOut(k / 0.4);
    else if (k < 0.58) f = -0.35 + 1.35 * easeIn((k - 0.4) / 0.18);
    else f = 1 - smooth((k - 0.58) / 0.42);
    const reach = (sp === 'boar' ? 0.34 : sp === 'bear' ? 0.2 : 0.26) * sc;
    if (sd === 'e') {
      ox += flip * Math.max(f, rear ? 0 : f) * reach;
      if (rear && f < 0) rot -= flip * (-f / 0.35) * (sp === 'bear' ? 0.42 : 0.28);
      else rot += flip * f * (sp === 'boar' ? 0.1 : 0.14);
      if (sp === 'wolf' || sp === 'fox' || sp === 'rabbit') lift += Math.max(0, f) * 0.09 * sc;
      if (sp === 'spider' && f < 0) spr = S.ew[1];
    } else if (sd === 's') {
      oy += f * reach * 0.7; sx *= 1 + Math.max(0, f) * 0.08; sy *= 1 + f * 0.06;
      if (rear && f < 0) { sy *= 1 - f * 0.35; lift -= f * 0.08; }
    } else { oy -= f * reach * 0.7; sy *= 1 - f * 0.05; if (rear && f < 0) { sy *= 1 - f * 0.25; } }
    if (f < 0 && !rear) { sy *= 1 + f * 0.12; sx *= 1 - f * 0.06; }
    if (rear && k > 0.58 && k < 0.7) { const u = 1 - Math.abs((k - 0.62) / 0.08); sy *= 1 - 0.08 * clamp01(u); sx *= 1 + 0.06 * clamp01(u); }
  }
  if (fl > 0.4) ox += Math.sin(t * 70) * 0.025 * fl; // hit flinch
  const x = a.x + ox, y = a.y + oy;
  const bw = sd === 'e' ? spr.w * 0.62 : spr.w * 0.72;
  if (T.blob) B.blob.add(T.blob, a.x, a.y, bw * sc * (1 - lift), 0.55 * sc * (1 - lift), 1, 1, 1, 0.7);
  B.main.add(spr, x, y, sc * sx, sc * sy, 1, 1, 1, 1, 0, rot, fl, flip, 0, lift);
  B.shadow.add(spr, x, y, sc * sx, sc * sy, 1, 1, 1, 0.9, 0, rot, 0, flip, 0, lift);
  // glowing spider eyes (visible at night)
  if (sp === 'spider' && sd !== 'n' && T.spark) {
    const pulse = 0.55 + 0.2 * Math.sin(t * 3 + ph0);
    if (sd === 'e') B.emissive.add(T.spark, x + flip * 0.44 * sc * sx, y, 0.18 * sc, 0.14 * sc, 1, 0.25, 0.15, pulse, 0, 0, 0, 1, 0, lift + 0.52 * sc * sy);
    else for (let i = -1; i <= 1; i += 2) B.emissive.add(T.spark, x + i * 0.055 * sc, y, 0.13 * sc, 0.13 * sc, 1, 0.25, 0.15, pulse, 0, 0, 0, 1, 0, lift + 0.48 * sc * sy);
  }
}

// World objects, structures and ground decor live in composeWorld.js (re-exported here).
export { drawStatic, drawDecor } from './composeWorld.js';

export { TAU };
