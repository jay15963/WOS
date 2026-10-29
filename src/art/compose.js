// Visual composition & animation: turns game state into sprite instances. Reads state only (private
// `_`-prefixed caches aside), no game logic, allocation-light (runs every frame for every visible object).
// B = renderer.batches, A = atlas, t = time (s).
// batch.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift)
//
// Pawn state read here (see docs/CONTENT.md §3):
//   look { skin, hair, hairColor, shirt, pants?, beard?, hat?:'bandana', hatColor?, face?:'scar'|'eyepatch'|'mask' }
//   weapon (item id → held_<id>; legacy 'sword'|'axe'|'pickaxe'|'spear'|'club'; null = bare hands)
//   offhand ('shield_*' | 'torch_hand'), armor { body, head } (→ wear_<id>_<dir>), blocking (bool)
//   action { type, t, item? } — attack, chop, mine, gather, pick, build, cast, shoot, throw, block, bash, stab, cleave,
//   smash, pierce, plant, harvest, craft, cook, eat (+ ability ids: strike, lacerate, sweep, whirlwind, charge,
//   aimed_shot, multi_shot, disengage, shield_bash, torch_swing, shove, punch, heal (alias bandage))
//   headFacing? ('s'|'n'|'e'|'w': head turned toward a target), pose? { type: 'sleep'|'sit', o?: bed / seat object }
// Animal state: species, facing, moving, moveT, action, flash, dead, deadT, scale, variant? (deer: 1 = doe; else id parity),
//   nid / id (idle-life schedule), state ('chase' | 'flee' …)
// Every animation is a function of replicated state (facing, moving, moveT, action, flash, dead, pose,
// headFacing) plus time, so remote copies animate like the original. `_`-fields are per-client caches.
//
// ---------- PAWN RIG (anchors; directions s / n / e, w = e mirrored with flip -1) ----------
// Appearance comes ONLY from `look` (tints + part ids); equipment (weapon, offhand, armor → wear_*) is separate.
// All positions are in tiles; `lift` = height above the ground plane (screen up). Per-frame values:
//   x, y   ground point under the body (entity x, y + pose offsets); bl = body lift (bob + LEG 0.05 on the boots)
//   torso  pawn_body_<d> (× look.shirt) and pawn_legs_<d> (× look.pants): BW×BH = 56×56 px canvas, anchor bottom
//          centre at FEET (53 px) → drawn at (x, y, lift bl), scale (sx, sy) squash/stretch, rotation rot.
//          Body armour wear_<id>_<d> uses the same canvas/anchor. → drawTorso()
//   head   pawn_head_<d> (× look.skin): HW×HH = 58×66 px canvas, anchor at the neck (NECK 52 px) → drawn at
//          (hx, y, lift hl) with hl = bl + PAWN.headLift·sy (0.56) + bob, rotation hr. Every head part shares that
//          canvas and anchor: pawn_lids_<d> (blink / sleep, × skin), face_<id>_<d>, brows_<d> / beard_<d> /
//          hair_<style>_<d> (× look.hairColor; hair gets its own follow-through rot/lift), hat_bandana_<d>,
//          head wear wear_<id>_<d>. The head may face another way than the body (headFacing). → drawHead()
//   hands  pawn_hand (× skin, centre anchor, 14 px): rest at the sleeve cuffs (s/n: x ±0.27, lift 0.17; e: near
//          x +0.02 / far −0.03, lift 0.18), weapon grip at PAWN.handS/N/E (+ offS/N/E for the off hand).
//   feet   pawn_foot_<s|e> (boots, × pants·0.5, anchor at the sole): s/n x ±0.125; e x ±0.025 + stride, drawn
//          behind the torso; sitting: in front (+ pawn_thigh_e from the hip in the side view).
// Part painters (art/pawns.js today, art/look/* later) only need to paint into these canvases/anchors.

import { PAWN } from './pawns.js';
import { TORCH_TIP } from './gear.js';
import { WEAR_HIDES_HAIR } from './apparel.js';

// set by the game (artcompat.js): called once per missing sprite when a fallback is drawn (must never happen
// with a validated atlas). Kept as a hook so the art module graph does not import game/net code.
export const artHooks = { warn: null };
// cosmetic environment fed by the game every frame (juice.js): wind for idle hair, world clock for idle life
export const animEnv = { wx: 0.15, wy: 0, gust: 0, wt: 0 };

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u * u;
const smooth = (u) => u * u * (3 - 2 * u);
const backOut = (u) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2;
// pawn gait: phase radians per moveT unit (moveT grows 0.25 per tile on every peer: game/anim.js)
export const PAWN_GAIT = 9.5;
const PER_TILE = 0.25;

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
    held: new Map(), wear: new Map(), items: new Map(),
    blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft'), spark: opt('fx_spark') || opt('fx_soft'), hand: opt('pawn_hand'),
    foot: { s: opt('pawn_foot_s'), e: opt('pawn_foot_e') }, lids: { s: opt('pawn_lids_s'), e: opt('pawn_lids_e') },
    soft: opt('fx_soft'), ring: opt('fx_ring'),
    bones: opt('item_bones') || opt('item_bone'), cover: opt('pawn_cover'), herb: opt('pawn_herb'), food: opt('item_berries'), thigh: opt('pawn_thigh_e'),
  };
  T.foot.n = T.foot.s;
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
      dead: opt(sp + '_dead'), graze: opt(sp + '_e_graze'),
    };
  }
  for (let i = 0; i < 3; i++) T.flames.push(opt('fx_flame_' + i) || A.get('fx_flame'));
  T.knife = held(T, 'knife_iron'); T.axe = held(T, 'axe_iron'); T.pick = held(T, 'pickaxe_iron'); T.bow = held(T, 'bow_wood'); T.hammer = held(T, 'hammer');
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
const BLANKET = [0.47, 0.61, 0.78];
const WET_SH = [0, 0, 0], WET_PC = [0, 0, 0];
const WATER = [0.36, 0.55, 0.62];
const TALL_HAIR = { mohawk: 1, bun: 1 };
const LONG_HAIR = { long: 1, ponytail: 1, braid: 1, shaggy: 1 };
const OPP = { s: 'n', n: 's', e: 'w', w: 'e' };
// action type → pose (attack depends on the weapon)
const POSE_OF = {
  strike: 'attack', punch: 'attack', lacerate: 'slash', sweep: 'cleave', aimed_shot: 'shoot', multi_shot: 'shoot',
  shield_bash: 'bash', torch_swing: 'torch', bandage: 'heal',
};
const ATTACK_OF = { knife: 'stab', sword: 'slash', axe: 'heavy', pickaxe: 'heavy', club: 'smash', spear: 'pierce', bow: 'shoot', torch: 'slash', hammer: 'smash' };
const WHIRL = ['s', 'e', 'n', 'w'];
const TWO_HAND = { heavy: 1, smash: 1 };
const BLADE = { knife: 1, sword: 1, axe: 1 }; // can cut a carcass
// poses that look down at the hands (head follows the body, no head turn)
const BUSY = { heal: 1, eat: 1, craft: 1, cook: 1, plant: 1, harvest: 1, gather: 1, pick: 1, build: 1 };

// food sprite held while eating (item_<id>, berries by default)
function itemSprite(T, id) {
  if (!id) return T.food;
  let s = T.items.get(id);
  if (s === undefined) { s = T.A.has('item_' + id) ? T.A.get('item_' + id) : T.food; T.items.set(id, s); }
  return s;
}

// per-entity frame clock: dt, smoothed ground speed (tiles/s, from the shared gait clock) and a 0..1 "moving"
// blend so feet and arms settle when the walk stops
function tick(p, t) {
  const dt = p._ft == null ? 0 : Math.min(0.1, Math.max(0, t - p._ft));
  p._ft = t;
  const m = p.moveT || 0;
  if (dt > 0) {
    const v = p.moving ? Math.min(12, Math.max(0, m - (p._gm ?? m)) / PER_TILE / dt) : 0;
    p._gs = (p._gs || 0) + (v - (p._gs || 0)) * Math.min(1, dt * 7);
    p._mk = (p._mk ?? 0) + ((p.moving ? 1 : 0) - (p._mk ?? 0)) * Math.min(1, dt * 11);
    // stride blend: a short stop (swing / bow draw) keeps the feet planted where they were — the walk resumes
    // from the same phase without a pop; a longer stop brings them together with a small shuffle step
    p._stop = p.moving ? 0 : (p._stop || 0) + dt;
    const sk = p._sk ?? 0;
    p._sk = p.moving ? sk + (1 - sk) * Math.min(1, dt * 11) : p._stop > 0.5 ? sk * Math.max(0, 1 - dt * 4.5) : sk;
  } else if (p._mk == null) { p._mk = p.moving ? 1 : 0; p._sk = p._mk; }
  p._gm = m;
  return dt;
}

// bed → pillow (BX, BY), head angle BR and head→feet axis (BUX, BUY). Legacy bed (no rot): sprite pillow
// 1.3 tiles above the anchor. Rotated beds (o.rot 0..3 = head N/E/S/W): 2-tile bed centred on the footprint.
let BX = 0, BY = 0, BR = 0, BUX = 0, BUY = 1;
function bedSlot(o) {
  if (o.rot == null) { BX = o.x; BY = o.y - 1.3; BR = 0; BUX = 0; BUY = 1; return; }
  const q = (((o.rot | 0) % 4) + 4) % 4;
  const vert = q === 0 || q === 2;
  BUX = q === 1 ? -1 : q === 3 ? 1 : 0; BUY = q === 0 ? 1 : q === 2 ? -1 : 0;
  BX = o.x - BUX * 0.62; BY = (vert ? o.y - 1 : o.y - 0.5) - BUY * 0.62; BR = q * HALF_PI;
}

// ---------- look-driven part drawing (the rig decides where; the look decides what) ----------
// torso: body (× shirt) + trousers (× pants) + body armour, all on the torso anchor
function drawTorso(B, T, L, armor, sd, sh, pc, x, y, sx, sy, rot, fl, flip, lift, al, legsOn = true) {
  B.main.add(T.body[sd], x, y, sx, sy, sh[0], sh[1], sh[2], al, 0, rot, fl, flip, 0, lift);
  const legs = T.legs[sd];
  if (legs && legsOn) B.main.add(legs, x, y, sx, sy, pc[0], pc[1], pc[2], al, 0, rot, fl, flip, 0, lift);
  const wb = armor ? wear(T, armor.body, sd) : null;
  if (wb) B.main.add(wb, x, y, sx, sy, 1, 1, 1, al, 0, rot, fl, flip, 0, lift);
}
// hair sprite for a look (null when bald or hidden by head wear / bandana)
function hairOf(T, L, armor, d) {
  const hs = T.hair[L.hair];
  if (!hs) return null;
  const wh = armor ? wear(T, armor.head, d) : null;
  const hides = wh ? WEAR_HIDES_HAIR[armor.head] : L.hat === 'bandana' ? 'tall' : null;
  if (hides === true || (hides === 'tall' && TALL_HAIR[L.hair])) return null;
  return hs[d] || null;
}
// topmost head sprite (sun shadow silhouette)
function headTop(T, L, armor, d) {
  return (armor ? wear(T, armor.head, d) : null) || hairOf(T, L, armor, d) || (L.hat === 'bandana' ? T.hat[d] : null);
}
// head + every part sharing its anchor, from the look. d: 's'|'n'|'e' (flip mirrors 'w'); shut: eyelids closed;
// hairR / hairL: hair rotation / lift (follow-through), equal to r / l when no follow-through is wanted
function drawHead(B, T, L, armor, d, flip, x, y, l, r, fl, al, shut, hairR, hairL) {
  const sk = L.skin || DEFAULT_LOOK.skin, hc = L.hairColor || DEFAULT_LOOK.hairColor, hat = L.hatColor || HAT_COL;
  const wh = armor ? wear(T, armor.head, d) : null;
  B.main.add(T.head[d], x, y, 1, 1, sk[0], sk[1], sk[2], al, 0, r, fl, flip, 0, l);
  if (shut && d !== 'n' && T.lids[d]) B.main.add(T.lids[d], x, y, 1, 1, sk[0], sk[1], sk[2], al, 0, r, fl, flip, 0, l);
  const fs = L.face && T.face[L.face] ? T.face[L.face][d === 'n' ? 'x' : d] : null;
  if (fs && L.face !== 'mask') B.main.add(fs, x, y, 1, 1, 1, 1, 1, al, 0, r, fl, flip, 0, l);
  const brows = d !== 'n' ? T.brows[d] : null;
  if (brows && !(wh && armor.head === 'helmet_iron' && d === 's')) B.main.add(brows, x, y, 1, 1, hc[0], hc[1], hc[2], al, 0, r, fl, flip, 0, l);
  const beard = L.beard && d !== 'n' ? T.beard[d] : null;
  if (beard) B.main.add(beard, x, y, 1, 1, hc[0], hc[1], hc[2], al, 0, r, fl, flip, 0, l);
  if (fs && L.face === 'mask') B.main.add(fs, x, y, 1, 1, hat[0], hat[1], hat[2], al, 0, r, fl, flip, 0, l);
  const hair = hairOf(T, L, armor, d);
  if (hair) B.main.add(hair, x, y, 1, 1, hc[0], hc[1], hc[2], al, 0, hairR, fl, flip, 0, hairL);
  const bandana = L.hat === 'bandana' ? T.hat[d] : null;
  if (bandana && !wh) B.main.add(bandana, x, y, 1, 1, hat[0], hat[1], hat[2], al, 0, r, fl, flip, 0, l);
  if (wh) B.main.add(wh, x, y, 1, 1, 1, 1, 1, al, 0, r, fl, flip, 0, l);
}

// eyes closed now? (blink schedule from the pawn's phase: irregular, sometimes a double blink)
function blinking(t, ph0) {
  const per = 3.1 + 1.8 * ((ph0 * 7.31) % 1);
  const bt = (t + ph0) % per;
  return bt < 0.12 || (((ph0 * 3.7) % 1) < 0.35 && bt > 0.26 && bt < 0.36);
}

// ---------- pawns (humanoids) ----------
export function drawPawn(B, A, p, t) {
  const T = tables(A);
  tick(p, t);
  // respawn: rise from the ground (derived from the replicated dead flag on every peer)
  if (p._wd && !p.dead) p._riseAt = t;
  p._wd = !!p.dead;
  const act = p.action && p.action.t < 1 ? p.action : null;
  const k = act ? clamp01(act.t) : 0;
  let pose = act ? POSE_OF[act.type] || act.type : null;
  let dir = p.facing || 's';
  if (pose === 'whirlwind') dir = WHIRL[(Math.floor(k * 8) + WHIRL.indexOf(dir === 'w' ? 'w' : dir)) & 3];
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  // head turned toward what the pawn looks at (never backwards, not while busy)
  let hdir = dir;
  const hf = p.headFacing;
  if (hf && hf !== dir && hf !== OPP[dir] && !p.dead && (!act || pose === 'cast' || pose === 'shoot') && !p.pose) hdir = hf;
  const hsd = hdir === 'w' ? 'e' : hdir;
  const hflip = hdir === 'w' ? -1 : 1;
  const L = p.look || DEFAULT_LOOK;
  const fl = p.flash || 0;
  let sh = L.shirt || DEFAULT_LOOK.shirt, pc = L.pants || PANTS;
  const sk = L.skin || DEFAULT_LOOK.skin, hc = L.hairColor || DEFAULT_LOOK.hairColor, hat = L.hatColor || HAT_COL;
  const wet = p._wet || 0;
  if (wet > 0.02) { // soaked clothes are darker (scratch colours, no allocation)
    const d = 1 - 0.3 * wet;
    WET_SH[0] = sh[0] * d; WET_SH[1] = sh[1] * d; WET_SH[2] = sh[2] * (d + 0.04 * wet); sh = WET_SH;
    WET_PC[0] = pc[0] * d; WET_PC[1] = pc[1] * d; WET_PC[2] = pc[2] * (d + 0.04 * wet); pc = WET_PC;
  }
  const body = T.body[sd], head = T.head[hsd];
  const armor = p.armor;
  const ph0 = phaseOf(p);
  const lids = hsd !== 'n' ? T.lids[hsd] : null;

  const M = held(T, p.weapon);
  let O = held(T, p.offhand);
  if (M.type === 'bow') O = NO_HELD; // two-handed

  if (p.dead) {
    p._sy = undefined;
    const u = clamp01((p.deadT || 0) * 2.4);
    // knees buckle (squash), then topple sideways with a small bounce
    const buckle = u < 0.22 ? smooth(u / 0.22) : 1;
    const fu = clamp01((u - 0.15) / 0.85);
    const kk = fu < 0.72 ? easeIn(fu / 0.72) : 1 - Math.sin(((fu - 0.72) / 0.28) * Math.PI) * 0.07;
    const side = sd === 'e' ? -flip : sd === 's' ? 1 : -1; // same on every peer (corpses match)
    const rot = side * HALF_PI * kk;
    const bsy = 1 - 0.12 * buckle * (1 - kk);
    const HL = PAWN.headLift * bsy;
    const hx = p.x + Math.sin(rot) * HL, hy = p.y - Math.cos(rot) * HL;
    if (T.blob) B.blob.add(T.blob, p.x + side * 0.3 * kk, p.y, 0.75 + 0.5 * kk, 0.6, 1, 1, 1, 0.55);
    if (M.s) B.main.add(M.s, p.x - side * 0.25, p.y + 0.12, 0.9, 0.9, 1, 1, 1, 1, 0, side * HALF_PI * 1.15, fl, 1, 0, 0.02);
    if (O.s) B.main.add(O.s, p.x + side * 0.15, p.y + 0.18, 0.9, 0.9, 1, 1, 1, 1, 0, side * 0.3, fl, 1, 0, 0.01);
    const ft = T.foot[sd];
    if (ft) B.main.add(ft, p.x - side * 0.08 * kk, p.y + 0.02, 1, 1, pc[0] * 0.5, pc[1] * 0.45, pc[2] * 0.42, 1, 0, rot, fl, flip, 0, 0);
    drawTorso(B, T, L, armor, sd, sh, pc, p.x, p.y, 1, bsy, rot, fl, flip, 0, 1);
    drawHead(B, T, L, armor, sd, flip, hx, hy, 0, rot, fl, 1, kk > 0.5, rot, 0);
    return;
  }

  // ---- resting poses (replicated: p.pose) ----
  const PS = p.pose && !act && !p.moving ? p.pose : null;
  const po = PS && PS.o && !PS.o.gone && !PS.o.removed ? PS.o : null;
  p._sy = undefined; // depth key override while lying in a bed / sitting on a chair (game.js sort)
  if (PS && PS.type === 'sleep' && T.cover) {
    let ux, uy, ang, px, py;
    if (po) { bedSlot(po); px = BX; py = BY; ang = BR; ux = BUX; uy = BUY; p._sy = Math.max(p.y, po.y + 0.02); }
    else { ux = -flip; uy = 0; ang = flip * HALF_PI; px = p.x + flip * 0.36; py = p.y - 0.08; } // on the ground
    const breath = Math.sin(t * 1.35 + ph0);
    const nx = px + ux * 0.2, ny = py + uy * 0.2;
    p._zx = nx; p._zy = ny; // where the Zzz rise from (juice.js)
    const tilt = ang + 0.14 * (ph0 % 2 > 1 ? 1 : -1) + breath * 0.015;
    const hl = 0.02;
    drawHead(B, T, L, null, 's', 1, nx, ny, hl, tilt, fl, 1, true, tilt, hl);
    // body under the blanket, chest rising slowly
    const cx = nx + ux * 0.02, cy = ny + uy * 0.02;
    B.main.add(T.cover, cx, cy, 0.86, 1 + breath * 0.025, BLANKET[0], BLANKET[1], BLANKET[2], 1, 0, ang, fl, 1, 0, hl + 0.01);
    return;
  }
  const sit = PS && PS.type === 'sit' ? PS : null;
  const seat = sit ? po : null;

  // ---- locomotion / idle ----
  const mk = sit ? 0 : p._mk ?? (p.moving ? 1 : 0);
  const run = clamp01(((p._gs || 0) - 4.7) / 1.6) * mk;
  const ph = (p.moveT || 0) * PAWN_GAIT;
  const gs = Math.sin(ph), gc = Math.cos(ph), bob = Math.abs(gc);
  let lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0, headRot = 0, headDy = 0, al = 1;
  // feet: forward offset (tiles, along the facing) and lift; hands: swing (+ = forward). 1 = right (main) side
  const skd = sit ? 0 : p._sk ?? mk;
  const stride = (0.1 + 0.06 * run) * skd, fUp = (0.045 + 0.045 * run) * mk * mk; // the lifted boot lands first
  let f1 = gs * stride, f2 = -gs * stride, f1l = Math.max(0, gc) * fUp, f2l = Math.max(0, -gc) * fUp;
  if (!p.moving && (p._stop || 0) > 0.5 && skd > 0.03) { const sh = Math.sin(Math.PI * skd) * 0.025; if (Math.abs(f1) > Math.abs(f2)) f1l += sh; else f2l += sh; }
  const arm = (0.055 + 0.06 * run) * mk;
  const a1 = -gs * arm, a2 = gs * arm;
  let feetFront = false; // sitting: feet stick out in front of the body
  if (mk > 0.01) {
    lift = mk * bob * (0.038 + 0.045 * run) + run * 0.02;
    const c = (1 - bob) * mk;
    sy = 1 - c * (0.03 + 0.035 * run) + mk * bob * 0.01; sx = 1 + c * 0.022;
    if (sd === 'e') { rot = flip * (mk * 0.03 + run * 0.12 + 0.018 * gc * mk); headRot = -flip * (run * 0.07 + 0.015 * gc * mk); }
    else { rot = gs * mk * (0.04 + 0.025 * run); ox = gs * mk * 0.013; headRot = -gs * mk * 0.028; }
    headDy = -mk * bob * 0.008;
    f1l += run * 0.025 * bob; f2l += run * 0.025 * bob; // flight phase
  }
  const idle = 1 - mk;
  {
    const br = Math.sin(t * 2.2 + ph0);
    sy *= 1 + br * 0.016 * idle; sx *= 1 - br * 0.008 * idle;
    headDy += br * 0.006 * idle;
    rot += idle * 0.012 * Math.sin(t * 0.37 + ph0 * 2); // slow weight shift
  }
  // hit flinch (flash is set on every peer by the damage event)
  if (fl > 0.05) {
    const f = fl * fl;
    if (sd === 'e') { rot -= flip * 0.13 * f; ox -= flip * 0.05 * f; } else oy += (sd === 's' ? -0.04 : 0.04) * f;
    sy *= 1 - 0.07 * f; sx *= 1 + 0.04 * f;
    headRot += (sd === 'e' ? -flip : ph0 % 2 > 1 ? 1 : -1) * 0.12 * f;
  }
  // respawn rise
  if (p._riseAt != null) {
    const u = (t - p._riseAt) / 0.7;
    if (u >= 1 || u < 0) p._riseAt = null;
    else { const e = backOut(u); sy *= 0.5 + 0.5 * e; sx *= 1.25 - 0.25 * e; al = clamp01(u * 2.5); }
  }
  // sitting (ground near a fire, or a chair): squat, feet forward, hands on the knees
  if (sit) {
    sy *= seat ? 0.88 : 0.8; sx *= 1.04; headDy -= 0.015;
    feetFront = true;
    rot = idle * 0.008 * Math.sin(t * 0.3 + ph0);
  }

  // swimming (juice.js sets _swim from the tile under every avatar): chest-deep, no walk cycle
  const swim = sit ? 0 : p._swim || 0;
  const swimming = swim > 0.5;
  let stroke = 0;
  if (swim > 0.01) {
    stroke = t * 1.9 + ph0 + (p.moveT || 0) * 4;
    const bobS = Math.sin(stroke * 2) * 0.012;
    lift = lift * (1 - swim) + bobS * swim; sy *= 1 - 0.42 * swim; sx *= 1 + 0.03 * swim;
    rot *= 1 - swim; headRot *= 1 - swim; headDy += bobS * 0.5 * swim;
    f1l = f2l = 0;
  }
  // ---- held items: rest pose ----
  const H = sd === 's' ? PAWN.handS : sd === 'n' ? PAWN.handN : PAWN.handE;
  const OH = sd === 's' ? PAWN.offS : sd === 'n' ? PAWN.offN : PAWN.offE;
  let wsp = M.s, wType = M.type;
  let wRot = 0, wSy = 1, wSx = 1, wHx = 0, wHl = 0, wDy = 0, wBehind = sd === 'n', showW = !!wsp, wFlipK = 1;
  const long = wType === 'spear' || wType === 'bow' || wType === 'torch';
  if (sd === 'e') wRot = flip * (long ? 0.18 : 0.55); else if (sd === 's') wRot = long ? -0.15 : -0.5; else wRot = long ? 0.15 : 0.4;
  // off hand (shield / torch)
  let osp = O.s, oType = O.type, oRot = 0, oSc = 1, oHx = 0, oHl = 0, oDy = 0, showO = !!osp;
  let oBehind = sd === 'n' || (sd === 'e' && flip > 0);
  if (osp && oType === 'shield') { if (sd === 'e') osp = O.e || osp; else if (sd === 'n') osp = O.n || osp; }
  if (oType === 'torch') { oRot = sd === 'e' ? flip * 0.12 : sd === 's' ? 0.2 : -0.2; }
  // walking: the hands swing (and what they hold)
  if (mk > 0.01 && !act) {
    if (sd === 'e') {
      wHx += flip * a1 * 0.9; wHl += Math.abs(a1) * 0.2 + run * 0.05; wRot += flip * a1 * (long ? 0.5 : 1.3);
      oHx += flip * a2 * 0.6; oHl += run * 0.04;
    } else {
      const fw = sd === 's' ? 1 : -1;
      wDy += a1 * 0.4 * fw; wHl += run * 0.05 - Math.abs(a1) * 0.05; wRot += a1 * (long ? 0.3 : 0.8) * fw;
      oDy += a2 * 0.35 * fw; oHl += run * 0.04;
    }
  }
  // hands (fists / grips): up to two, in tile offsets from the pawn
  let h1 = false, h1x = 0, h1l = 0, h1dy = 0, h1b = false, h2 = false, h2x = 0, h2l = 0, h2dy = 0, h2b = false;
  let blockK = p.blocking ? 1 : 0;
  let herbAt = 0; // 1: herbs between the hands, 2: under the off hand (pressed on the arm)
  let food = null;
  let bundle = null; // bones held against the chest
  let ghost = 0;  // swing trail: 1 = side view (rot = flip·angle), 2 = front/back (rot = angle)
  let kneel = 0;  // 0..1: lowered on one knee (feet apart)

  // ---- actions ----
  if (pose === 'attack') pose = wType ? ATTACK_OF[wType] || 'slash' : 'punch';
  if (pose === 'chop' || pose === 'mine') {
    const want = pose === 'chop' ? 'axe' : 'pickaxe';
    if (wType !== want) { const R = pose === 'chop' ? T.axe : T.pick; wsp = R.s || wsp; wType = want; }
    pose = 'heavy';
  } else if (pose === 'build') {
    if (T.hammer.s) { wsp = T.hammer.s; wType = 'hammer'; }
  } else if (pose === 'shoot' && wType !== 'bow') {
    if (T.bow.s) { wsp = T.bow.s; wType = 'bow'; }
  }
  showW = !!wsp;
  // bows are slung across the back unless shooting
  if (wType === 'bow' && pose !== 'shoot' && wsp === M.s) {
    wRot = sd === 'e' ? flip * 1.05 : sd === 's' ? 0.75 : -0.75;
    wHx = -H[0] * flip + (sd === 'e' ? -flip * 0.1 : 0);
    wHl = 0.5 - H[1]; wDy = 0;
    wBehind = sd !== 'n'; wSx = wSy = 0.82;
  }
  let slung = wType === 'bow' && pose !== 'shoot' && wsp === M.s;
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
        ghost = 1;
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
          ghost = 2;
        } else {
          swing(k, -0.5, -1.15, 2.5);
          wRot = W_ANG;
          wHl = W_WIND * 0.12 - W_HIT * 0.05; wHx = W_HIT * 0.18;
          rot += W_HIT * 0.06 - W_WIND * 0.05;
          ghost = 2;
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
          ghost = 2;
        }
        oy -= W_HIT * 0.06;
      }
      // impact: a short squash right after the blow lands (heavy tools bite into wood / stone)
      if (heavy && k > 0.6 && k < 0.74) { const u = clamp01(1 - Math.abs((k - 0.64) / 0.08)); sy *= 1 - 0.07 * u; sx *= 1 + 0.05 * u; }
      if (heavy) lift += W_WIND * 0.03;
    } else if (pose === 'smash') {
      // overhead slam: big raise, short hold, hard impact with a squash
      if (sd === 'e') {
        swing(k, 0.55, -2.4, 2.0, 0.42, 0.56);
        wRot = flip * W_ANG; wHl = W_WIND * 0.3 - W_HIT * 0.1; wHx = flip * (W_HIT * 0.14 - W_WIND * 0.1);
        rot += flip * (W_HIT * 0.2 - W_WIND * 0.12); ox += flip * W_HIT * 0.08; lift += W_WIND * 0.05;
        ghost = 1;
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
      if (pr && f < 0) { sy *= 1 + f * 0.04; } // coil before the jab
    } else if (pose === 'shoot') {
      // bow: raise, draw (string pulled, arrow nocked), release with a small recoil
      const draw = k < 0.12 ? 0 : k < 0.7 ? (k - 0.12) / 0.58 : 0;
      const recoil = k >= 0.7 ? 1 - smooth((k - 0.7) / 0.3) : 0;
      const R = wType === 'bow' ? (wsp === M.s ? M : T.bow) : T.bow;
      if (draw > 0) wsp = draw > 0.45 ? R.d2 || wsp : R.d1 || wsp;
      const up = smooth(clamp01(k / 0.14)) * (1 - smooth(clamp01((k - 0.8) / 0.2)));
      const pull = draw > 0.45 ? 0.2 : draw > 0 ? 0.11 : 0;
      wDy = 0;
      if (sd === 'e') {
        wRot = flip * 0.18 * (1 - up); wHx = flip * (0.16 * up - 0.04 * recoil * up); wHl = 0.06 * up; wFlipK = 1;
        if (draw > 0) { h2 = true; h2x = flip * (H[0] + 0.16 * up - pull); h2l = H[1] + 0.06 * up; }
        else if (recoil > 0) { h2 = true; h2x = flip * (H[0] - 0.22 - 0.05 * recoil); h2l = H[1] + 0.08 * recoil; } // string hand follows through
        rot -= flip * draw * 0.05;
      } else if (sd === 's') {
        wRot = -0.15 + (HALF_PI + 0.15) * up; wHx = 0.23 * up; wHl = 0.06 * up; wBehind = false;
        if (draw > 0) { h2 = true; h2x = H[0] + 0.23 * up; h2l = H[1] + 0.06 + pull; }
      } else {
        wRot = 0.15 - (HALF_PI + 0.15) * up; wHx = -0.22 * up; wHl = 0.08 * up;
        if (draw > 0) { h2 = true; h2x = H[0] - 0.22 * up; h2l = H[1] + 0.08 - pull; h2b = true; }
      }
      slung = false;
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
    } else if (pose === 'pick' || pose === 'gather') {
      const u = pose === 'pick' ? hump(k) : 1;
      const b = pose === 'gather' ? Math.abs(Math.sin(k * Math.PI * 3)) : 0;
      sy *= 1 - 0.13 * u + b * 0.04; sx *= 1 + 0.05 * u - b * 0.02;
      headDy -= (0.08 + (pose === 'pick' ? 0.05 : 0)) * u - b * 0.03;
      if (sd === 'e') rot += flip * (0.14 + (pose === 'pick' ? 0.18 : 0) * u + b * 0.04);
      else oy += sd === 's' ? 0.03 * u : -0.03 * u;
      showW = false; showO = showO && oType === 'torch';
      kneel = u;
      h1 = true;
      const reach = pose === 'pick' ? u : 0.5 + 0.5 * b;
      if (sd === 'e') { h1x = flip * (0.18 + 0.14 * reach); h1l = 0.24 - 0.2 * reach; }
      else if (sd === 's') { h1x = (pose === 'gather' && Math.sin(k * Math.PI * 6) > 0 ? -0.12 : 0.12); h1l = 0.22 - 0.16 * reach; h1dy = 0.1 * reach; }
      else { h1x = 0.1; h1l = 0.28 - 0.1 * reach; h1b = true; }
    } else if (pose === 'plant' || pose === 'harvest') {
      // kneel; plant: pat the soil twice · harvest: grab low, then pull up leaning back
      kneel = smooth(clamp01(k * 5)) * (1 - smooth(clamp01((k - 0.9) / 0.1)));
      showW = false; showO = showO && oType === 'torch';
      h1 = h2 = true;
      let hand = 0.05, pull = 0;
      if (pose === 'plant') hand = 0.04 + 0.08 * Math.abs(Math.sin(k * TAU * 2));
      else {
        pull = k < 0.55 ? 0 : k < 0.72 ? easeOut((k - 0.55) / 0.17) : 1 - smooth((k - 0.72) / 0.28);
        hand = 0.05 + pull * 0.24;
      }
      sy *= 1 - 0.19 * kneel + pull * 0.07; sx *= 1 + 0.06 * kneel;
      headDy -= 0.05 * kneel;
      if (sd === 'e') {
        rot += flip * (0.26 * kneel - pull * 0.34);
        h1x = flip * (0.27 - pull * 0.08); h1l = hand; h2x = flip * (0.21 - pull * 0.06); h2l = hand + 0.02; h2b = true;
      } else if (sd === 's') {
        oy += 0.03 * kneel - pull * 0.04;
        h1x = -0.08; h1dy = 0.15 * (1 - pull * 0.6); h1l = hand; h2x = pose === 'plant' ? 0.16 : 0.06; h2dy = pose === 'plant' ? 0.04 : h1dy; h2l = pose === 'plant' ? 0.18 : hand;
      } else {
        oy -= 0.03 * kneel - pull * 0.04;
        h1x = 0.08; h1l = hand + 0.06; h2x = -0.06; h2l = hand + 0.06; h1b = h2b = true;
      }
    } else if (pose === 'butcher' || pose === 'gather_bones') {
      // kneeling over a carcass: cut it with a blade (or pull with bare hands) · pick the bones up into the arms
      kneel = smooth(clamp01(k * 5)) * (1 - smooth(clamp01((k - 0.92) / 0.08)));
      sy *= 1 - 0.19 * kneel; sx *= 1 + 0.06 * kneel; headDy -= 0.05 * kneel;
      showO = showO && oType === 'torch';
      if (sd === 'e') rot += flip * 0.24 * kneel; else oy += (sd === 's' ? 0.03 : -0.03) * kneel;
      const tool = pose === 'butcher' ? (act.item ? held(T, act.item) : BLADE[wType] ? M : p.weapon ? T.knife : NO_HELD) : NO_HELD;
      if (tool.s) {
        // sawing strokes with the blade, the other hand pins the carcass down
        const saw = Math.sin(k * TAU * 4);
        wsp = tool.s; wType = tool.type; showW = true; wDy = 0; wSx = wSy = 0.9;
        h2 = true;
        if (sd === 'e') { wRot = flip * (HALF_PI + 0.5 + saw * 0.14); wHx = flip * (0.1 + saw * 0.05); wHl = -0.13; h2x = flip * 0.3; h2l = 0.05; h2b = true; }
        else if (sd === 's') { wRot = Math.PI - 0.4 + saw * 0.12; wSy = 0.55; wHx = 0.12 + saw * 0.04; wHl = -0.1; wDy = 0.1; h2x = 0.12; h2dy = 0.16; h2l = 0.05; wBehind = false; }
        else { wRot = 0.25 + saw * 0.12; wSy = 0.55; wHx = -0.12; wHl = 0.02; wDy = -0.08; h2x = 0.1; h2l = 0.18; h2b = true; }
      } else if (pose === 'butcher') {
        // bare hands: grab and pull back, leaning away from the carcass
        showW = false; h1 = h2 = true;
        const pull = Math.max(0, Math.sin(k * TAU * 2));
        if (sd === 'e') { rot -= flip * pull * 0.14; h1x = flip * (0.3 - pull * 0.1); h1l = 0.06 + pull * 0.06; h2x = flip * (0.26 - pull * 0.1); h2l = 0.07 + pull * 0.06; h2b = true; }
        else if (sd === 's') { h1x = -0.08; h2x = 0.08; h1dy = h2dy = 0.15 - pull * 0.06; h1l = h2l = 0.06 + pull * 0.05; oy -= pull * 0.02; }
        else { h1x = 0.08; h2x = -0.08; h1l = h2l = 0.12 + pull * 0.05; h1b = h2b = true; oy += pull * 0.02; }
      } else {
        // bones: the hands take turns picking from the ground, then hug the bundle to the chest
        showW = false; h1 = h2 = true;
        const hug = smooth(clamp01((k - 0.68) / 0.14)), wv = Math.sin(k * TAU * 2.2), rp1 = Math.max(0, wv) * (1 - hug), rp2 = Math.max(0, -wv) * (1 - hug);
        if (hug > 0.3) bundle = T.bones;
        if (sd === 'e') { h1x = flip * (0.16 + 0.14 * rp1 - 0.04 * hug); h1l = 0.2 - 0.15 * rp1 + 0.06 * hug; h2x = flip * (0.12 + 0.14 * rp2 - 0.02 * hug); h2l = 0.2 - 0.15 * rp2 + 0.07 * hug; h2b = hug < 0.5; }
        else if (sd === 's') { h1x = -0.12 + 0.06 * hug; h2x = 0.12 - 0.06 * hug; h1l = 0.2 - 0.15 * rp1 + 0.06 * hug; h2l = 0.2 - 0.15 * rp2 + 0.06 * hug; h1dy = 0.12 * rp1; h2dy = 0.12 * rp2; }
        else { h1x = 0.12 - 0.05 * hug; h2x = -0.12 + 0.05 * hug; h1l = 0.26 - 0.1 * rp1; h2l = 0.26 - 0.1 * rp2; h1b = h2b = true; }
      }
    } else if (pose === 'heal') {
      // crush the medicinal herbs between the palms, then press the poultice on the forearm
      showW = false; showO = false;
      h1 = h2 = true;
      const press = smooth(clamp01((k - 0.48) / 0.16)) * (1 - smooth(clamp01((k - 0.9) / 0.1)));
      const a = k * TAU * 4, grind = (1 - press) * (k < 0.55 ? 1 : 0);
      headDy -= 0.025;
      sy *= 0.975 - press * 0.015;
      herbAt = press > 0.5 ? 2 : 1;
      if (sd === 'e') {
        // grind in front of the chest; the far hand then crosses over to the near forearm
        h1x = flip * (0.15 - press * 0.13 + Math.cos(a) * 0.025 * grind); h1l = 0.26 - press * 0.07 + Math.sin(a) * 0.015 * grind;
        h2x = flip * (0.13 - press * 0.09); h2l = 0.25 + press * 0.03; h2b = press < 0.5;
        rot += flip * (0.05 + press * 0.04); headRot += flip * 0.06;
      } else if (sd === 's') {
        h1x = -0.05 - press * 0.18 + Math.cos(a) * 0.03 * grind; h1l = 0.27 - press * 0.08 + Math.sin(a) * 0.02 * grind;
        h2x = 0.05 - press * 0.22; h2l = 0.26 + press * 0.02; h1dy = 0.03 * (1 - press);
        rot -= press * 0.05;
      } else {
        h1x = 0.06 + press * 0.12; h1l = 0.3; h2x = -0.06 + press * 0.24; h2l = 0.3 + press * 0.02; h1b = true; h2b = press < 0.5;
      }
    } else if (pose === 'eat') {
      // three bites: the off hand brings food to the mouth, the head chews
      showO = false;
      const u = (k * 3) % 1, up = smooth(clamp01(u / 0.35)) * (1 - smooth(clamp01((u - 0.55) / 0.45)));
      const chew = up > 0.7 ? Math.abs(Math.sin(k * TAU * 9)) : 0;
      food = itemSprite(T, act.item);
      h2 = true;
      headDy -= 0.01 * chew; headRot += (sd === 'e' ? -flip : 0) * 0.05 * up;
      if (sd === 'e') { h2x = flip * (0.14 + 0.07 * up); h2l = 0.25 + up * 0.36; h2b = false; }
      else if (sd === 's') { h2x = 0.15 - 0.13 * up; h2l = 0.24 + up * 0.37; h2dy = 0.02; }
      else { h2x = -0.15 + 0.1 * up; h2l = 0.26 + up * 0.3; h2b = true; }
    } else if (pose === 'craft') {
      // working something small in the hands (head down)
      showW = false; showO = showO && oType === 'torch';
      h1 = h2 = true;
      const a = Math.sin(k * TAU * 3), b2 = Math.sin(k * TAU * 3 + 2.2);
      headDy -= 0.03;
      if (sd === 'e') { h1x = flip * (0.17 + a * 0.02); h1l = 0.25 + b2 * 0.02; h2x = flip * 0.12; h2l = 0.24 + a * 0.015; h2b = true; rot += flip * 0.05; }
      else if (sd === 's') { h1x = -0.07 + a * 0.02; h1l = 0.25 + a * 0.025; h2x = 0.07; h2l = 0.25 + b2 * 0.025; h1dy = h2dy = 0.05; }
      else { h1x = 0.07; h1l = 0.31 + a * 0.02; h2x = -0.07; h2l = 0.31 + b2 * 0.02; h1b = h2b = true; }
    } else if (pose === 'cook') {
      // stirring the pot / turning food over the fire
      showW = false;
      h1 = true;
      const a = k * TAU * 2;
      if (sd === 'e') { h1x = flip * (0.24 + Math.cos(a) * 0.045); h1l = 0.2 + Math.sin(a) * 0.025; rot += flip * 0.09; }
      else if (sd === 's') { h1x = -0.04 + Math.cos(a) * 0.06; h1l = 0.2; h1dy = 0.07 + Math.sin(a) * 0.035; oy += 0.02; }
      else { h1x = 0.05 + Math.cos(a) * 0.06; h1l = 0.29 + Math.sin(a) * 0.02; h1b = true; oy -= 0.02; }
      headDy -= 0.02;
    } else if (pose === 'build') {
      const kk = (k * 2) % 1;
      if (sd === 'e') { swing(kk, 0.3, -1.3, 1.25, 0.5, 0.66); wRot = flip * W_ANG; wHl = W_WIND * 0.12; wHx = flip * (W_HIT * 0.06); rot += flip * (0.08 + W_HIT * 0.06); }
      else { swing(kk, 0, -1, 1, 0.5, 0.66); wRot = sd === 's' ? -0.3 : 0.2; wSy = W_ANG <= 0 ? 1 : 1 - W_ANG * (sd === 's' ? 1.5 : 0.5); wHl = W_WIND * 0.16 - W_HIT * 0.06; }
      sy *= 1 - W_HIT * 0.03;
      showW = !!wsp; wDy = 0;
      // the other hand steadies the piece being nailed
      h2 = true;
      if (sd === 'e') { h2x = flip * 0.2; h2l = 0.2; h2b = true; } else if (sd === 's') { h2x = 0.12; h2l = 0.2; h2dy = 0.06; } else { h2x = -0.12; h2l = 0.28; h2b = true; }
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
      f1l = f2l = u * 0.04; f1 = 0.05 * u; f2 = -0.05 * u; // legs tucked in the leap
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
  // kneeling: one foot forward, the other knee down
  if (kneel > 0) { f1 = 0.12 * kneel; f2 = -0.07 * kneel; f1l = 0; f2l = 0; }
  // sitting: weapon laid on the ground beside, shield / torch put down
  if (sit) {
    showO = false;
    if (showW && wsp && !slung) {
      wRot = HALF_PI * (sd === 'e' ? flip : 1) * 1.04; wHl = -H[1] - lift + 0.03; wDy = sd === 'n' ? -0.05 : 0.08;
      wHx = sd === 'e' ? -flip * 0.42 - H[0] * flip : sd === 's' ? 0.55 : -0.5;
      wBehind = sd === 'n'; wSy = sd === 'e' ? 0.9 : 0.75; wSx = 0.9;
    }
    h1 = h2 = true;
    if (sd === 'e') { h1x = flip * 0.2; h1l = 0.16; h2x = flip * 0.16; h2l = 0.17; h2b = true; rot -= flip * 0.05; }
    else if (sd === 's') { h1x = -0.13; h2x = 0.13; h1l = h2l = 0.12; h1dy = h2dy = 0.09; }
    else { h1x = -0.2; h2x = 0.2; h1l = h2l = 0.16; }
  }

  const bx0 = seat ? seat.x : p.x, by0 = seat ? seat.y - 0.06 : p.y;
  if (seat) { lift += 0.13; p._sy = Math.max(p.y, seat.y + 0.02); }
  const LEG = (sit && !seat ? 0 : 0.05) * (1 - swim); // body stands on its boots (not while swimming)
  const x = bx0 + ox, y = by0 + oy;
  const bl = lift + LEG;
  const HL = PAWN.headLift * sy;
  const hx = x + Math.sin(rot) * HL;
  const hl = bl + Math.cos(rot) * HL + headDy;
  const hr = rot * 0.55 + headRot;
  // hair follow-through: lags the bob, swept back when running, sways in the wind when idle
  const hk = LONG_HAIR[L.hair] ? 1 : 0.35;
  const wind = animEnv.wx * (0.6 + 0.7 * animEnv.gust) * idle;
  const hairR = hr + hk * (wind * 0.035 * Math.sin(t * 1.7 + ph0) + wind * 0.02 + (sd === 'e' ? -flip * (0.012 + 0.035 * run) * mk : 0) + mk * 0.012 * Math.sin(2 * ph - 1.1));
  const hairL = hl - mk * 0.006 * Math.cos(2 * ph - 0.9) * hk;
  const shut = !!lids && (blinking(t, ph0) || fl > 0.6 || (pose === 'heal' && k > 0.5 && k < 0.62));

  // contact shadow (shrinks a little while airborne)
  if (T.blob) B.blob.add(T.blob, bx0, by0 + (seat ? 0.06 : 0), 0.7 - lift * 0.8, 0.6 - lift * 0.6, 1, 1, 1, 0.75 * al * (1 - swim));

  // item positions
  let wx = 0, wl = 0, wy = y + wDy;
  if (showW && wsp) { wx = x + H[0] * flip + wHx + Math.sin(rot) * H[1]; wl = bl + H[1] * sy + wHl; }
  let ox2 = 0, ol = 0;
  const oy2 = y + oDy;
  if (showO && osp) { ox2 = x + OH[0] * flip + oHx + Math.sin(rot) * OH[1]; ol = bl + OH[1] * sy + oHl; }
  const wFlip = sd === 'e' ? flip * wFlipK : 1;
  const oFlip = sd === 'e' ? flip : 1;
  const hand = T.hand;
  // rest hands at the sleeve cuffs (swinging while walking) unless a pose or a held item placed them
  if (swimming && !act) {
    showW = false; showO = false;
    const u = (stroke / TAU) % 1, sweep = Math.sin(u * TAU), reach = 0.5 + 0.5 * Math.cos(u * TAU);
    h1 = h2 = true; h1b = h2b = false;
    if (sd === 'e') { h1x = flip * (0.08 + 0.2 * reach); h1l = 0.1 + 0.03 * sweep; h2x = flip * (0.04 + 0.18 * reach); h2l = 0.11 + 0.03 * sweep; h2b = true; }
    else { const spread = 0.06 + 0.2 * (1 - reach); h1x = -spread; h2x = spread; h1l = h2l = 0.1 + 0.02 * sweep; h1dy = h2dy = (sd === 's' ? 0.08 : -0.08) * reach; h1b = h2b = sd === 'n'; }
  }
  const grip = showW && wsp && !slung && !h1;
  const twoHand = grip && act && (TWO_HAND[pose] || (pose === 'cleave' && (wType === 'axe' || wType === 'club')));
  const offGrip = showO && osp && oType === 'torch' && !h2;
  let hs1 = 0.9, hs2 = 0.9;
  if (!h1 && !grip) {
    h1 = true;
    if (sd === 'e') { h1x = flip * (0.02 + a1 * 1.1 - run * 0.03); h1l = 0.18 + Math.abs(a1) * 0.25 + run * 0.07; hs1 = 0.85; }
    else { const fw = sd === 's' ? 1 : -1; h1x = (sd === 's' ? -1 : 1) * (0.27 - run * 0.05); h1l = 0.17 + run * 0.07; h1dy = a1 * 0.4 * fw; hs1 = 0.82 + a1 * 0.7 * fw; }
  }
  if (!h2 && !offGrip && !twoHand && !(showO && oType === 'shield')) {
    h2 = true;
    if (sd === 'e') { h2x = flip * (-0.03 + a2 * 1.1 - run * 0.03); h2l = 0.19 + Math.abs(a2) * 0.25 + run * 0.07; h2b = true; hs2 = 0.85; }
    else { const fw = sd === 's' ? 1 : -1; h2x = (sd === 's' ? 1 : -1) * (0.27 - run * 0.05); h2l = 0.17 + run * 0.07; h2dy = a2 * 0.4 * fw; hs2 = 0.82 + a2 * 0.7 * fw; }
  }
  if (idle > 0.5 && !act && !sit) { const br = Math.sin(t * 2.2 + ph0) * 0.004; h1l += br; h2l += br; }
  const hx1 = x + h1x, hx2 = x + h2x;
  const r1 = sk[0], g1 = sk[1], b1 = sk[2];
  // second hand on the haft of two-handed swings
  let tgx = 0, tgl = 0;
  if (twoHand) { const L2 = 0.13 * wSy; tgx = wx + Math.sin(wRot) * L2; tgl = wl + Math.cos(wRot) * L2; }

  // fill the rig scratch (module-level helpers below draw feet / weapon / off-hand item from it)
  R.B = B; R.T = T; R.x = x; R.y = y; R.sd = sd; R.flip = flip; R.al = al; R.fl = fl; R.k = k; R.pose = pose;
  R.feetFront = feetFront; R.seat = !!seat; R.f1 = f1; R.f1l = f1l; R.f2 = f2; R.f2l = f2l;
  R.fr = pc[0] * 0.5; R.fg = pc[1] * 0.45; R.fb = pc[2] * 0.42; R.pr = pc[0]; R.pg = pc[1]; R.pb = pc[2];
  R.wsp = wsp; R.wx = wx; R.wy = wy; R.wl = wl; R.wSx = wSx; R.wSy = wSy; R.wRot = wRot; R.wFlip = wFlip; R.ghost = ghost;
  R.grip = grip; R.twoHand = twoHand; R.tgx = tgx; R.tgl = tgl; R.sr = r1; R.sg = g1; R.sb = b1;
  R.osp = osp; R.ox = ox2; R.oy = oy2; R.ol = ol; R.oSc = oSc; R.oRot = oRot; R.oFlip = oFlip; R.offGrip = offGrip; R.food = food;

  // behind the body
  if (swim < 0.5) rigFeet(false);
  if (showO && osp && oBehind) rigOff();
  if (showW && wsp && wBehind) rigWeapon();
  if (hand && h1 && h1b) B.main.add(hand, hx1, y + h1dy, hs1, hs1, r1, g1, b1, al, 0, 0, fl, 1, 0, bl + h1l);
  if (hand && h2 && h2b) { if (food) rigFood(hx2, y + h2dy, bl + h2l); B.main.add(hand, hx2, y + h2dy, hs2, hs2, r1, g1, b1, al, 0, 0, fl, 1, 0, bl + h2l); }
  // body
  drawTorso(B, T, L, armor, sd, sh, pc, x, y, sx, sy, rot, fl, flip, bl, al, swim < 0.5);
  if (swim < 0.5) rigFeet(true);
  if (swim > 0.01 && T.soft) {
    // the water line hides the lower body; a slow ripple ring spreads around the swimmer
    const wa = 0.85 * swim;
    B.main.add(T.soft, x, y + 0.02, 1.9, 0.75, WATER[0], WATER[1], WATER[2], wa, 0, 0, 0, 1, 0, 0.03);
    if (T.ring) { const u = (t * 0.7 + ph0) % 1; B.main.add(T.ring, x, y + 0.03, 0.5 + u * 0.7, 0.4 + u * 0.55, 0.85, 0.95, 1, 0.35 * (1 - u) * swim, 0, 0, 0, 1, 0, 0.01); }
  }
  // head
  drawHead(B, T, L, armor, hsd, hflip, hx, y, hl, hr, fl, al, shut, hairR, hairL);
  // in front of the body
  if (showW && wsp && !wBehind) rigWeapon();
  if (showO && osp && !oBehind) rigOff();
  if (hand && h1 && !h1b) B.main.add(hand, hx1, y + h1dy, hs1, hs1, r1, g1, b1, al, 0, 0, fl, 1, 0, bl + h1l);
  if (hand && h2 && !h2b) { if (food) rigFood(hx2, y + h2dy, bl + h2l); B.main.add(hand, hx2, y + h2dy, hs2, hs2, r1, g1, b1, al, 0, 0, fl, 1, 0, bl + h2l); }
  if (bundle && h1 && h2) B.main.add(bundle, (hx1 + hx2) / 2, y + (h1dy + h2dy) / 2 + 0.01, 0.55, 0.55, 1, 1, 1, al, 0, 0, fl, sd === 'e' ? flip : 1, 0, bl + (h1l + h2l) / 2);
  // herbs peek out between the palms / from under the pressing hand
  if (herbAt === 1 && h1 && h2 && T.herb) B.main.add(T.herb, (hx1 + hx2) / 2, y + (h1dy + h2dy) / 2 + 0.01, 0.7, 0.7, 1, 1, 1, al, 0, 0, fl, 1, 0, bl + (h1l + h2l) / 2 + 0.05);
  if (herbAt === 2 && h2 && T.herb) B.main.add(T.herb, hx2 + (sd === 'e' ? flip * 0.05 : 0.05), y + h2dy, 0.7, 0.7, 1, 1, 1, al, 0, 0.4, fl, 1, 0, bl + h2l - 0.04);

  // hand torch flame (emissive) at the tip
  const torchOn = showO && oType === 'torch' ? 1 : showW && wType === 'torch' ? 2 : 0;
  if (torchOn) {
    const r = torchOn === 1 ? oRot : wRot;
    const ty = torchOn === 1 ? oy2 : wy;
    const tx = (torchOn === 1 ? ox2 : wx) + Math.sin(r) * TORCH_TIP, tl = (torchOn === 1 ? ol : wl) + Math.cos(r) * TORCH_TIP;
    const fph = t * 11 + ph0;
    const fk = 0.9 + 0.12 * Math.sin(fph) + 0.06 * Math.sin(fph * 2.3);
    const lean = -r * 0.4 + (p.moving ? -flip * 0.25 : 0) + 0.1 * Math.sin(fph * 0.6) + animEnv.wx * 0.25;
    B.emissive.add(T.flames[0], tx, ty, 0.34 * fk, 0.46 * fk, 1, 1, 1, 0.95, 0, lean, 0, 1, 0, tl - 0.02);
    B.emissive.add(T.flames[1], tx, ty, 0.22, 0.3 * (0.8 + 0.2 * Math.sin(fph * 1.7)), 1, 1, 1, 0.8, 0, lean - 0.1, 0, 1, 0, tl);
    if (T.glow) B.emissive.add(T.glow, tx, ty, 0.75, 0.75, 1, 0.6, 0.3, 0.22 + 0.04 * Math.sin(fph * 1.3), 0, 0, 0, 1, 0, tl + 0.12);
  }

  B.shadow.add(body, x, y, sx, sy, 1, 1, 1, 0.9 * al, 0, rot, 0, flip, 0, bl);
  B.shadow.add(head, hx, y, 1, 1, 1, 1, 1, 0.9 * al, 0, hr, 0, hflip, 0, hl);
  const topS = headTop(T, L, armor, hsd);
  if (topS) B.shadow.add(topS, hx, y, 1, 1, 1, 1, 1, 0.9 * al, 0, hr, 0, hflip, 0, hl);
  if (showW && wsp) B.shadow.add(wsp, wx, wy, wSx, wSy, 1, 1, 1, 0.8 * al, 0, wRot, 0, wFlip, 0, wl);
  if (showO && osp) B.shadow.add(osp, ox2, oy2, oSc, oSc, 1, 1, 1, 0.8 * al, 0, oRot, 0, oFlip, 0, ol);
}

// ---------- rig helpers (read the scratch filled by drawPawn; no per-frame allocation) ----------
const R = {
  B: null, T: null, x: 0, y: 0, sd: 's', flip: 1, al: 1, fl: 0, k: 0, pose: null,
  feetFront: false, seat: false, f1: 0, f1l: 0, f2: 0, f2l: 0, fr: 0, fg: 0, fb: 0, pr: 0, pg: 0, pb: 0,
  wsp: null, wx: 0, wy: 0, wl: 0, wSx: 1, wSy: 1, wRot: 0, wFlip: 1, ghost: 0, grip: false, twoHand: false, tgx: 0, tgl: 0, sr: 1, sg: 1, sb: 1,
  osp: null, ox: 0, oy: 0, ol: 0, oSc: 1, oRot: 0, oFlip: 1, offGrip: false, food: null,
};
// boots: walking feet behind the body; sitting feet stick out in front (behind when seen from the back)
function rigFeet(front) {
  const ft = R.T.foot[R.sd];
  const { B, x, y, sd, flip, al, fl, fr, fg, fb } = R;
  if (!ft || front !== (R.feetFront && sd !== 'n')) return;
  if (R.feetFront) {
    const fz = R.seat ? 0.02 : 0;
    if (sd === 'e') {
      // thighs forward from the hip, boots at the knees' end
      const th = R.T.thigh, hip = R.seat ? 0.2 : 0.07;
      B.main.add(ft, x + flip * 0.22, y - 0.01, 1, 1, fr * 0.8, fg * 0.8, fb * 0.8, al, 0, 0, fl, flip, 0, fz);
      if (th) B.main.add(th, x - flip * 0.02, y - 0.01, 1, 1, R.pr * 0.85, R.pg * 0.85, R.pb * 0.85, al, 0, 0, fl, flip, 0, hip + 0.01);
      B.main.add(ft, x + flip * 0.27, y + 0.01, 1, 1, fr, fg, fb, al, 0, 0, fl, flip, 0, fz);
      if (th) B.main.add(th, x + flip * 0.01, y + 0.01, 1, 1, R.pr, R.pg, R.pb, al, 0, 0, fl, flip, 0, hip);
    } else {
      const fy = sd === 's' ? 0.13 : -0.13;
      B.main.add(ft, x - 0.09, y + fy, 1, 1, fr, fg, fb, al, 0, 0, fl, 1, 0, fz);
      B.main.add(ft, x + 0.09, y + fy, 1, 1, fr, fg, fb, al, 0, 0, fl, 1, 0, fz);
    }
    return;
  }
  if (sd === 'e') {
    // side view: longer visible stride; the swinging boot tips up a little
    B.main.add(ft, x + flip * (R.f2 * 1.5 - 0.025), y - 0.005, 1, 1, fr * 0.78, fg * 0.78, fb * 0.78, al, 0, -flip * R.f2l * 2.5, fl, flip, 0, R.f2l * 1.3);
    B.main.add(ft, x + flip * (R.f1 * 1.5 + 0.025), y, 1, 1, fr, fg, fb, al, 0, -flip * R.f1l * 2.5, fl, flip, 0, R.f1l * 1.3);
  } else {
    const sg = sd === 's' ? -1 : 1, fy = sd === 's' ? 0.35 : -0.35;
    B.main.add(ft, x + sg * 0.125, y + R.f1 * fy, 1, 1, fr, fg, fb, al, 0, 0, fl, 1, 0, R.f1l);
    B.main.add(ft, x - sg * 0.125, y + R.f2 * fy, 1, 1, fr, fg, fb, al, 0, 0, fl, 1, 0, R.f2l);
  }
}
// held weapon / tool + motion trail on fast swings + the hand(s) on its grip
function rigWeapon() {
  const { B, wsp, wx, wy, wl, wSx, wSy, wFlip, al, fl, k, pose, sd, flip } = R;
  if (R.ghost && W_HIT > 0.2 && k > 0.05) {
    const hit = W_HIT;
    for (let i = 2; i >= 1; i--) {
      const kk = k - i * 0.035;
      // the same curve a little earlier (W_* are scratch values; nothing reads them after this)
      if (pose === 'heavy') { if (sd === 'e') swing(kk, 0.55, -1.75, 1.7, 0.45, 0.62); else swing(kk, 0, -1, 1, 0.45, 0.62); }
      else if (pose === 'cleave') { if (sd === 'e') swing(kk, 0.55, -1.7, 2.6, 0.38, 0.56); else if (sd === 's') swing(kk, -0.5, -1.9, 2.0, 0.38, 0.56); else swing(kk, 0.4, 2.2, -2.0, 0.38, 0.56); }
      else if (pose === 'smash') swing(kk, 0.55, -2.4, 2.0, 0.42, 0.56);
      else if (sd === 'e') swing(kk, 0.55, -1.35, 2.15); else if (sd === 's') swing(kk, -0.5, -1.15, 2.5); else swing(kk, 0.4, 2.3, -0.95, 0.4, 0.6);
      B.main.add(wsp, wx, wy, wSx, wSy, 1, 1, 1, (0.3 * hit / i) * al, 0, R.ghost === 1 ? flip * W_ANG : W_ANG, 0.55, wFlip, 0, wl);
    }
  }
  B.main.add(wsp, wx, wy, wSx, wSy, 1, 1, 1, al, 0, R.wRot, fl, wFlip, 0, wl);
  const hand = R.T.hand;
  if (hand && R.grip) {
    if (R.twoHand) B.main.add(hand, R.tgx, wy, 1, 1, R.sr, R.sg, R.sb, al, 0, 0, fl, 1, 0, R.tgl);
    B.main.add(hand, wx, wy, 1, 1, R.sr, R.sg, R.sb, al, 0, 0, fl, 1, 0, wl);
  }
}
function rigOff() {
  const { B, al, fl } = R;
  B.main.add(R.osp, R.ox, R.oy, R.oSc, R.oSc, 1, 1, 1, al, 0, R.oRot, fl, R.oFlip, 0, R.ol);
  if (R.T.hand && R.offGrip) B.main.add(R.T.hand, R.ox, R.oy, 1, 1, R.sr, R.sg, R.sb, al, 0, 0, fl, 1, 0, R.ol);
}
function rigFood(x, y, l) { if (R.food) R.B.main.add(R.food, x, y, 0.42, 0.42, 1, 1, 1, R.al, 0, 0, R.fl, 1, 0, l + 0.03); }

// ---------- animals ----------
// a: { x, y, species, facing, moving, moveT, action, flash, dead, deadT, scale, variant?, nid?, state? }
// f: walk phase (rad per moveT unit; 4 frames per cycle) · fr: run phase (longer strides: fewer cycles per tile)
// bob: body lift · rock: pitch/roll · run: running style · graze: herbivore idle (head down to the grass)
const GAIT = {
  wolf: { f: 10, fr: 7, bob: 0.05, rock: 0.035, run: 'gallop' },
  fox: { f: 11, fr: 8, bob: 0.045, rock: 0.035, run: 'gallop' },
  boar: { f: 12.5, fr: 11, bob: 0.04, rock: 0.045, run: 'trot', graze: true },
  deer: { f: 8.5, fr: 5.2, bob: 0.075, rock: 0.035, run: 'bound', graze: true },
  rabbit: { f: 7.5, fr: 6.2, bob: 0.2, rock: 0.15, hop: true, graze: true },
  bear: { f: 6.5, fr: 5.5, bob: 0.045, rock: 0.06, roll: 0.035, run: 'lope' },
  spider: { f: 15, fr: 13, bob: 0.015, rock: 0.02, skitter: true },
};
const GAIT_DEF = { f: 10, fr: 8, bob: 0.05, rock: 0.04, run: 'gallop' };
// deterministic per-creature 0..1 seed from its network id (same idle schedule on every peer)
function seedOf(a) {
  if (a._seed != null) return a._seed;
  const s = String(a.nid ?? a.id ?? 0);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (a._seed = ((h >>> 0) % 10007) / 10007);
}
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
  // gait clock: phase advances with the distance walked (moveT, identical on every peer), faster per tile
  // when walking than when running (strides lengthen)
  const m = a.moveT || 0;
  const dm = Math.max(0, m - (a._gm ?? m));
  tick(a, t);
  const spd = a._gs || 0;
  const rk = clamp01((spd - 2.3) / 1.5) * (a._mk ?? 1);
  if (a._gph == null) a._gph = m * (G.f + (G.fr - G.f) * rk);
  else a._gph += dm * (G.f + (G.fr - G.f) * rk);

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
    // stagger, topple onto the side, a last twitch
    const s = u < 0.18 ? S.ew[1] : S.e;
    const twitch = u >= 1 ? 0 : u > 0.82 ? Math.sin((u - 0.82) * 60) * 0.02 * (1 - u) * 5 : 0;
    const rot = flip * (HALF_PI * k + twitch);
    const c = s.h * s.ay * 0.45 * sc;
    if (T.blob) B.blob.add(T.blob, a.x, a.y, s.w * 0.8 * sc, 0.7 * sc, 1, 1, 1, 0.5);
    B.main.add(s, a.x - flip * c * k, a.y + 0.05 * k, sc, sc * (1 - 0.06 * (1 - k) * (u < 0.2 ? u * 5 : 1)), 0.82, 0.8, 0.78, 1, 0, rot, fl, flip, 0, 0);
    return;
  }

  let spr = sd === 'e' ? S.e : sd === 's' ? S.s : S.n;
  let lift = 0, sx = 1, sy = 1, rot = 0, ox = 0, oy = 0;
  if (a.moving) {
    const ph = a._gph;
    const u = ((ph / TAU) % 1 + 1) % 1;
    const fi = (u * 4) | 0;
    const run = rk > 0.5;
    if (G.hop) {
      // crouch → airborne stretch → land (longer, higher hops when fleeing)
      const bob = G.bob * (1 + rk * 0.5);
      const air = u > 0.18 && u < 0.82 ? Math.sin(((u - 0.18) / 0.64) * Math.PI) : 0;
      lift = air * bob;
      if (sd === 'e') { spr = air > 0.12 ? S.ew[0] : S.ew[1]; rot = -flip * Math.cos(((u - 0.18) / 0.64) * Math.PI) * 0.16 * (air > 0 ? 1 : 0); }
      sy = air > 0 ? 1 + air * (0.08 + rk * 0.05) : 0.9; sx = air > 0 ? 1 - air * 0.04 : 1.08;
    } else if (run && G.run === 'bound' && sd === 'e') {
      // deer bound: push off gathered, sail stretched (nose up → nose down), land gathered
      if (u < 0.22) { spr = S.ew[1]; const c = Math.sin((u / 0.22) * Math.PI); sy = 1 - 0.08 * c; sx = 1 + 0.04 * c; rot = -flip * 0.06 * c; }
      else if (u < 0.84) { const v = (u - 0.22) / 0.62; spr = S.ew[0]; lift = Math.sin(v * Math.PI) * 0.24; rot = flip * (-0.16 + 0.3 * v); sx = 1.05; sy = 0.98; }
      else { spr = S.ew[3]; const c = Math.sin(((u - 0.84) / 0.16) * Math.PI); sy = 1 - 0.1 * c; sx = 1 + 0.05 * c; rot = flip * 0.05 * (1 - c); }
    } else if (run && sd === 'e') {
      // gallop / trot / lope: same 4 frames, stronger rocking-horse pitch, stretch at full extension
      spr = S.ew[fi];
      const s2 = Math.sin(2 * ph), ext = Math.abs(Math.cos(ph));
      if (G.run === 'trot') { lift = Math.abs(Math.sin(2 * ph)) * 0.045; rot = flip * (0.05 + s2 * 0.03); }
      else if (G.run === 'lope') { lift = (0.5 - 0.5 * Math.cos(2 * ph)) * 0.07; rot = flip * s2 * 0.07; ox += Math.sin(ph) * 0.02; }
      else { lift = (0.5 - 0.5 * Math.cos(2 * ph - HALF_PI)) * G.bob * 1.6; rot = flip * s2 * 0.09; sx = 1 + ext * 0.05; sy = 1 - ext * 0.03; }
      if (G.skitter) ox += Math.sin(ph * 3.1) * 0.015;
    } else {
      const bob = G.bob * (1 + rk * 0.6);
      lift = bob * (0.5 - 0.5 * Math.cos(2 * ph - HALF_PI));
      if (sd === 'e') { spr = S.ew[fi]; rot = flip * Math.sin(2 * ph) * G.rock * 0.5; }
      else { spr = sd === 's' ? S.sw[fi] : S.nw[fi]; rot = Math.sin(ph) * G.rock * (0.6 + rk * 0.5); sx = 1 + Math.cos(2 * ph) * 0.02; }
      if (G.roll) { ox += Math.sin(ph) * G.roll * (sd === 'e' ? 0.3 : 1); rot += sd === 'e' ? 0 : Math.sin(ph) * G.roll; }
      if (G.skitter) ox += Math.sin(ph * 3.1) * 0.012;
    }
  } else {
    const br = Math.sin(t * 2 + ph0);
    sy = 1 + br * 0.016; sx = 1 - br * 0.006;
    // idle life on a shared schedule (creature id + world clock): grazing, looking around, a twitch
    if (!a.action && a.state !== 'chase' && a.state !== 'flee') {
      const sd0 = seedOf(a), P = 7 + sd0 * 5;
      const u = ((animEnv.wt + sd0 * 37) / P) % 1;
      if (G.graze && S.graze && sd === 'e' && u < 0.5) {
        spr = S.graze;
        sy *= 1 - 0.012 * Math.abs(Math.sin(t * 6.5 + ph0)); // nibbling
      } else if (G.graze && sd !== 'e' && u < 0.5) {
        sy *= 0.95 - 0.012 * Math.abs(Math.sin(t * 6.5 + ph0)); oy += sd === 's' ? 0.02 : -0.02; // head down, seen front / back
      } else if (sd === 'e' && u > 0.62 && u < 0.76) spr = S.s; // looks around (toward the camera)
      else if (!G.graze && S.graze && sd === 'e' && u > 0.3 && u < 0.4) spr = S.graze; // predators sniff the ground
      if (u > 0.86 && u < 0.885) { rot += flip * Math.sin(t * 60) * 0.02; sx *= 1.01; } // skin twitch / ear flick
    }
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
      if (f > 0.3 && !rear) spr = S.ew[0]; // legs stretched in the lunge
    } else if (sd === 's') {
      oy += f * reach * 0.7; sx *= 1 + Math.max(0, f) * 0.08; sy *= 1 + f * 0.06;
      if (rear && f < 0) { sy *= 1 - f * 0.35; lift -= f * 0.08; }
    } else { oy -= f * reach * 0.7; sy *= 1 - f * 0.05; if (rear && f < 0) { sy *= 1 - f * 0.25; } }
    if (f < 0 && !rear) { sy *= 1 + f * 0.12; sx *= 1 - f * 0.06; }
    if (rear && k > 0.58 && k < 0.7) { const u = 1 - Math.abs((k - 0.62) / 0.08); sy *= 1 - 0.08 * clamp01(u); sx *= 1 + 0.06 * clamp01(u); }
  }
  if (fl > 0.4) { ox += Math.sin(t * 70) * 0.025 * fl; sy *= 1 - 0.05 * fl; } // hit flinch
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

// ---------- corpses ----------
// The death animations end in a stable lying pose (pawns: on the side / back, weapon dropped beside; animals:
// on the side, spiders on the back), oriented from `facing` only, so it is identical on every peer. drawCorpse
// draws that end pose for any pawn / animal / creature record (e.g. a corpse object that copies kind, species,
// variant, scale, look, weapon, offhand, armor, facing, x, y) — or bake corpse sprites from it.
export function drawCorpse(B, A, e, t = 0) {
  const d = e.dead, dt = e.deadT, wd = e._wd;
  e.dead = true; e.deadT = 10;
  if (e.kind === 'pawn') drawPawn(B, A, e, t); else drawAnimal(B, A, e, t);
  e.dead = d; e.deadT = dt; e._wd = wd;
}

// World objects, structures and ground decor live in composeWorld.js (re-exported here).
export { drawStatic, drawDecor } from './composeWorld.js';

export { TAU };
