// Weapon / off-hand / armor combat numbers (pure data + tiny pure helpers, no DOM).
// Item ids follow docs/CONTENT.md: `<type>_<material>` (knife_stone, bow_wood, shield_iron...).
// The item DB (./items.js, owned by economy) may carry `weapon: { type, min?, max?, swing?, reach?, range? }`,
// `armor: { value }` and `tier`; everything here is the fallback when those fields are missing.

import { ITEMS } from './items.js';
import { ABILITIES, GENERIC_ABILITIES } from './combat.js';

// damage multiplier / swing-time multiplier per material tier
export const TIERS = {
  primitive: { name: 'primitiva', dmg: 0.72, speed: 1.06, rank: 0 },
  wood:      { name: 'de madeira', dmg: 0.9, speed: 1.0, rank: 1 },
  stone:     { name: 'de pedra', dmg: 1.0, speed: 1.0, rank: 1 },
  ice:       { name: 'de gelo', dmg: 1.0, speed: 1.0, rank: 1 }, // the winter walkers' weapons: as strong as stone
  copper:    { name: 'de cobre', dmg: 1.35, speed: 0.96, rank: 2 },
  iron:      { name: 'de ferro', dmg: 1.75, speed: 0.93, rank: 3 },
  composite: { name: 'composto', dmg: 1.7, speed: 0.92, rank: 3, range: 1.5 },
  steel:     { name: 'de aço', dmg: 2.2, speed: 0.9, rank: 4 },
};
const TIER_BY_RANK = ['primitive', 'stone', 'copper', 'iron', 'steel'];

// Base numbers are for a stone-tier weapon at player level 1 (damage scales with level, see playerPower).
// reach = extra distance beyond both collision radii (center-to-center = a.r + b.r + reach).
// act = p.action.type of the auto attack (art pose).
export const WEAPON_TYPES = {
  unarmed: { name: 'Mãos', g: 'f', min: 2, max: 4, swing: 1.05, reach: 0.55, crit: 0, act: 'attack', auto: 'punch',
             abilities: ['shove'], icon: 'punch' },
  knife:   { name: 'Faca', g: 'f', min: 4, max: 7, swing: 1.15, reach: 0.6, crit: 0.06, act: 'stab', abilities: ['stab', 'lacerate'], icon: 'stab' },
  axe:     { name: 'Machado', g: 'm', min: 7, max: 12, swing: 1.75, reach: 0.68, crit: 0.02, act: 'attack', abilities: ['cleave', 'shove'], icon: 'cleave' },
  pickaxe: { name: 'Picareta', g: 'f', min: 5, max: 9, swing: 1.8, reach: 0.66, crit: 0, act: 'attack', abilities: ['shove'], icon: 'attack' },
  spear:   { name: 'Lança', g: 'f', min: 6, max: 10, swing: 1.55, reach: 1.3, crit: 0.03, act: 'stab', abilities: ['pierce', 'sweep', 'throw_spear'], icon: 'pierce' },
  sword:   { name: 'Espada', g: 'f', min: 8, max: 13, swing: 1.5, reach: 0.72, crit: 0.03, act: 'attack', abilities: ['strike', 'whirlwind', 'charge'], icon: 'strike' },
  club:    { name: 'Clava', g: 'f', min: 7, max: 12, swing: 1.85, reach: 0.66, crit: 0.02, act: 'attack', stun: 0.08, abilities: ['smash', 'shove'], icon: 'smash' },
  bow:     { name: 'Arco', g: 'm', min: 7, max: 12, swing: 1.9, reach: 0.55, crit: 0.04, act: 'shoot', auto: 'shoot', ranged: true, range: 9,
             twoHanded: true, ammo: 'arrow', abilities: ['aimed_shot', 'multi_shot', 'long_shot', 'disengage'], icon: 'shoot' },
};

// ---------- aimed ground throws (abilities with aim: 'ground', lob: <weapon type>) ----------
// range: max distance in tiles, the same on every device (fair in multiplayer). The simple bow reaches about half
// of what a landscape phone shows at max zoom out (844 px / 22 px per tile ≈ 38 tiles wide → 18). Longer bows do
// not zoom out further: the camera follows the aim point (src/ui/aim.js, game.camFocus).
// scatter radius of the landing point = s0 + k × distance (rolled on the host, centre-weighted).
// hitR: a creature is hit when the landing point is within hitR + its body radius.
// dur / apex: flight time (s) and arc height (tiles) = [a, b] → a + b × distance. knock: push on hit.
// open: needs open sky (no shooting it up from inside a cave).
export const LOB = {
  bow:   { ability: 'long_shot', proj: 'arrow', open: true, range: 18, s0: 0.1, k: 0.065, hitR: 0.45, dur: [0.5, 0.05], apex: [0.6, 0.2], knock: 0.15 },
  spear: { ability: 'throw_spear', proj: 'spear', range: 8, s0: 0.1, k: 0.08, hitR: 0.5, dur: [0.32, 0.06], apex: [0.25, 0.1], knock: 0.6 },
};
// per-item range overrides: a better bow is one line here (the camera follows further, the zoom stays)
export const LOB_RANGE = { bow_composite: 22 };

const LOBS = new Map();
// flight / accuracy spec of a main-hand item for its aimed ground ability, or null
export function lobSpec(id) {
  if (!id) return null;
  if (LOBS.has(id)) return LOBS.get(id);
  const { type } = splitId(id);
  const L = WEAPON_TYPES[type] ? LOB[type] : null;
  const S = L ? { ...L, type, range: LOB_RANGE[id] ?? L.range } : null;
  LOBS.set(id, S);
  return S;
}
export const lobScatter = (S, d) => S.s0 + S.k * d;
export const lobFlight = (S, d) => ({ dur: S.dur[0] + S.dur[1] * d, apex: S.apex[0] + S.apex[1] * d });
const SPECIAL_NAMES = { club_wood: 'Clava', club_iron: 'Maça de ferro', bow_wood: 'Arco simples', bow_composite: 'Arco composto' };

// Off-hand. blockChance: passive chance to block a frontal hit (passiveReduce of the damage);
// blockReduce: frontal reduction while the Block ability is up.
export const SHIELDS = {
  shield_wood:   { name: 'Escudo de madeira', armor: 3, blockChance: 0.10, passiveReduce: 0.4, blockReduce: 0.62 },
  shield_copper: { name: 'Escudo de cobre', armor: 5, blockChance: 0.13, passiveReduce: 0.45, blockReduce: 0.72 },
  shield_iron:   { name: 'Escudo de ferro', armor: 8, blockChance: 0.16, passiveReduce: 0.5, blockReduce: 0.82 },
};
export const OFFHAND_TYPES = {
  shield: { abilities: ['block', 'shield_bash'] },
  torch:  { abilities: ['torch_swing'], light: { r: 1, g: 0.7, b: 0.38, radius: 4.4, intensity: 1.05, flicker: 0.3, lift: 1.0 } },
};

// Armor values (fallback when ITEMS[id].armor.value is missing)
export const ARMOR = {
  tunic_cloth: 2, armor_leather: 5, armor_copper: 9, armor_iron: 14,
  hat_straw: 1, hood_leather: 3, helmet_copper: 5, helmet_iron: 8,
};

// player damage scaling with level (fists included)
export const playerPower = (L) => 1 + 0.11 * (L - 1);

// Armor damage reduction vs an attacker of level L (WoW-like diminishing returns, capped)
export function armorReduction(armor, L = 1) {
  if (!(armor > 0)) return 0;
  return Math.min(0.65, armor / (armor + 30 + 6 * L));
}

// ---------- id parsing ----------
export function splitId(id) {
  if (!id) return { type: null, mat: null };
  const def = ITEMS[id];
  const k = id.indexOf('_');
  let type = k > 0 ? id.slice(0, k) : id;
  let mat = k > 0 ? id.slice(k + 1) : null;
  const wt = def?.weapon?.type;
  if (wt) type = wt;
  if (!TIERS[mat]) {
    const t = def?.tier;
    mat = typeof t === 'number' ? TIER_BY_RANK[Math.max(0, Math.min(4, t | 0))] : TIERS[t] ? t : 'stone';
  }
  return { type, mat };
}

export function weaponTypeOf(id) {
  if (!id) return 'unarmed';
  const { type } = splitId(id);
  return WEAPON_TYPES[type] ? type : null;
}

function itemName(id, W, mat) {
  if (ITEMS[id]?.name) return ITEMS[id].name;
  if (SPECIAL_NAMES[id]) return SPECIAL_NAMES[id];
  const T = TIERS[mat];
  if (!W) return id;
  let adj = T ? T.name : '';
  if (W.g === 'm') adj = adj.replace(/a$/, 'o');
  return adj ? `${W.name} ${adj}` : W.name;
}

// ---------- profiles ----------
const PROF = new Map();
// Combat profile of a main-hand item (null id = bare hands). Unknown / non-weapon items fight like fists.
export function weaponProfile(id) {
  const key = id || '';
  let P = PROF.get(key);
  if (P) return P;
  const { type, mat } = splitId(id);
  const W = (id && WEAPON_TYPES[type]) || WEAPON_TYPES.unarmed;
  const isWeapon = !!(id && WEAPON_TYPES[type]);
  const T = isWeapon ? TIERS[mat] || TIERS.stone : { dmg: 1, speed: 1 };
  const d = (isWeapon && ITEMS[id]?.weapon) || {};
  P = {
    id: id || null, type: isWeapon ? type : 'unarmed', mat: isWeapon ? mat : null, rank: T.rank ?? 0,
    name: id ? itemName(id, isWeapon ? W : null, mat) : W.name,
    min: d.min ?? W.min * T.dmg, max: d.max ?? W.max * T.dmg,
    swing: d.swing ?? +(W.swing * T.speed).toFixed(3), reach: d.reach ?? W.reach, crit: W.crit || 0,
    ranged: !!W.ranged, range: W.ranged ? (d.range ?? W.range + (T.range || 0)) : 0,
    twoHanded: !!(W.twoHanded || ITEMS[id]?.weapon?.twoHanded), ammo: W.ammo || null,
    auto: W.auto || null, act: W.act || 'attack', stun: W.stun || 0,
    abilities: W.abilities.slice(), icon: W.icon,
  };
  PROF.set(key, P);
  return P;
}

const OFF = new Map();
export function offhandProfile(id) {
  if (!id) return null;
  let P = OFF.get(id);
  if (P) return P;
  const { type, mat } = splitId(id);
  if (type === 'shield') {
    const S = SHIELDS[id] || SHIELDS['shield_' + mat] || SHIELDS.shield_wood;
    P = { id, type: 'shield', name: ITEMS[id]?.name || S.name, armor: ITEMS[id]?.armor?.value ?? S.armor,
          blockChance: S.blockChance, passiveReduce: S.passiveReduce, blockReduce: S.blockReduce, abilities: OFFHAND_TYPES.shield.abilities.slice() };
  } else if (type === 'torch') {
    P = { id, type: 'torch', name: ITEMS[id]?.name || 'Tocha de mão', armor: 0, abilities: OFFHAND_TYPES.torch.abilities.slice(), light: OFFHAND_TYPES.torch.light };
  } else P = { id, type, name: ITEMS[id]?.name || id, armor: 0, abilities: [] };
  OFF.set(id, P);
  return P;
}

export function armorValue(id) {
  if (!id) return 0;
  return ITEMS[id]?.armor?.value ?? ARMOR[id] ?? 0;
}

// Total armor of an equipment set { main, off, body, head }
export function equipArmor(eq) {
  if (!eq) return 0;
  return armorValue(eq.body) + armorValue(eq.head) + (offhandProfile(eq.off)?.armor || 0);
}

// Action-bar ability ids for an equipment set (weapon, then off-hand unless two-handed, then generic).
export const MAX_BAR = 7;
export function barFor(eq) {
  const main = weaponProfile(eq?.main || null);
  const off = main.twoHanded ? null : offhandProfile(eq?.off || null);
  const out = [];
  for (const id of main.abilities) if (ABILITIES[id] && !out.includes(id)) out.push(id);
  if (off) for (const id of off.abilities) if (ABILITIES[id] && !out.includes(id)) out.push(id);
  for (const id of GENERIC_ABILITIES) if (!out.includes(id)) out.push(id);
  return out.slice(0, MAX_BAR);
}
