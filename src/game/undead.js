// The night's dead of every region (owner, docs/REINOS.md §1 and docs/NIGHT-DEAD.md): "dessa forma o perigo noturno nos
// invernos que cada zona sempre vai existir". Each place has its bad season and its dead, decided by the season AT THE
// PLACE (seasons.js seasonAt: zone by latitude + altitude, the other hemisphere half a year off) and, for the deserts,
// the planet's biome around it:
//   'ice'   a real winter (snow: temperate / subpolar winter, polar always) — Andarilhos do Gelo + Gigante de Gelo
//   'bone'  the warm zone's mild winter ("Inverno ameno") and the tropics' dry season — Esqueletos (+ the Gigante
//           Esqueleto in the warm zone only: the humid tropics get the skeletons alone)
//   'sand'  the same seasons in a hot desert (arid biomes of the warm / tropical zone) — Múmias + Múmia Gigante
// One family per place: the spawn point must be of the same family as the player it comes for (walkers.js), and a
// creature out of its family's place / night crumbles (bones / sand / snow).
// They all run on the walkers' machinery (faction 'walker': walkers.js walkerBrain — drawn to light and the living,
// breaking walls, creative worlds spare everything; bandits.js updateBandit — the fight; giants.js — the giants).
// This module holds the data that differs: the families, the kits, the drops, the flavour (skeletons: blunt blows
// shatter them, arrows slip through the ribs; mummies: slow and tough, their touch may curse — slower for a while).

import { SPECIES } from './data.js';
import { seasonAt } from './seasons.js';
import { lootRows, ri } from './mut/roll.js';

// ---------- families ----------
export const FAMILY = {
  ice:  { mob: 'walker', giant: 'giant', name: 'Andarilhos do Gelo' },
  bone: { mob: 'skeleton', giant: 'skeleton_giant', name: 'Esqueletos' },
  sand: { mob: 'mummy', giant: 'mummy_giant', name: 'Múmias' },
};
// the family of a creature species (null: not one of the night's dead)
export const familyOf = (species) => SPECIES[species]?.undead || null;
// a giant of the night (ice / skeleton / mummy): the ballista's big target, its own map mark, its own rig
export const isGiant = (e) => !!(e && SPECIES[e.species]?.giant);

// hot deserts: the arid biomes (docs/PLANET.md §5); the region around a point decides (five samples R tiles apart: a
// patch of dunes in the savanna is not a desert, an oasis in the desert is still one)
const ARID = new Set(['desert_dunes', 'desert_rocky', 'badlands', 'salt_flat', 'cold_desert']);
const DR = 7;
const PTS = [[0, 0], [DR, 0], [-DR, 0], [0, DR], [0, -DR]];
export function desertAt(w, x, y) {
  const keys = w?.source?.biomeKeys;
  if (!keys || !w.pbiome) return false;
  let n = 0;
  for (const [dx, dy] of PTS) {
    const tx = Math.floor(x + dx), ty = Math.floor(y + dy);
    if (w.inBounds(tx, ty) && ARID.has(keys[w.pbiome.get(w.idx(tx, ty))])) n++;
  }
  return n >= 3;
}
// the bad season of a season state that has no snow: the warm zone's mild winter, the tropics' dry season
export const mildBad = (S) => (S.zone === 1 ? S.id === 'winter' : S.zone === 0 ? (S.wet ?? 0) < 0.5 : false);
// the family of a season state (desert: the place is a hot desert)
export const familyForSeason = (S, desert) => (S.hard ? 'ice' : !mildBad(S) ? null : desert ? 'sand' : 'bone');
// which dead walk at (x, y) when it is night there (null: no bad season now)
export function nightFamilyAt(game, x, y) {
  const S = seasonAt(game, x, y);
  if (S.hard) return 'ice';
  if (!mildBad(S)) return null;
  return desertAt(game.world, x, y) ? 'sand' : 'bone';
}
// does this family bring its giant to (x, y): ice / sand always, bone only in the warm zone (not the humid tropics)
export function giantHere(game, fam, x, y) {
  if (fam !== 'bone') return !!fam;
  return seasonAt(game, x, y).zone === 1;
}

// ---------- what the HUD says (ui/hud.js: zone / season toasts, the dusk warning) ----------
// the dead of a place on its bad nights (for a toast: "Esqueletos e o Gigante Esqueleto")
export function nightDangerOf(game, x, y, S = seasonAt(game, x, y)) {
  if (S.zone >= 2) return S.zone === 4 ? 'Andarilhos do Gelo e o Gigante de Gelo' : 'Andarilhos do Gelo';
  if (desertAt(game.world, x, y)) return 'Múmias e a Múmia Gigante';
  return S.zone === 1 ? 'Esqueletos e o Gigante Esqueleto' : 'Esqueletos';
}
// a line for the warm / tropical zone toast: what comes at night there and when
export function warmNightHint(game, x, y, zone) {
  const when = zone === 1 ? 'nas noites do inverno ameno' : 'nas noites da estação seca';
  return desertAt(game.world, x, y) ? `Deserto: ${when}, Múmias e a Múmia Gigante saem das areias.` : `${when[0].toUpperCase() + when.slice(1)}, ${zone === 1 ? 'Esqueletos e o Gigante Esqueleto' : 'Esqueletos'} saem da terra.`;
}
// the dusk warning of a bad night of bones / sand (the walkers' winter keeps its own words)
export function duskWarning(fam) {
  if (fam === 'bone') return 'Anoiteceu: os Esqueletos saem da terra. Atraídos pela luz e por gente, quebram paredes — maças e porretes os despedaçam.';
  if (fam === 'sand') return 'Anoiteceu: as Múmias saem das areias. Lentas e duras; o toque delas amaldiçoa (fica mais lento).';
  return null;
}

// ---------- kits (host, at spawn: R = net.roll) ----------
// weapon, role and the numbers that differ from a walker: armorV, swing (× the weapon's), dmgK (× the level's damage,
// instead of the weapon factor), reach; extra fields on the creature (bluntK / pierceK: skeletons, curse: mummies)
export function nightKit(species, R) {
  if (species === 'skeleton') {
    const r = R();
    const weapon = r < 0.3 ? 'bow_wood' : r < 0.68 ? 'sword_bone' : 'spear_bone';
    return { weapon, role: weapon === 'bow_wood' ? 'archer' : 'melee', armorV: 2, swingK: 1.1, extra: { bluntK: 1.5, pierceK: 0.7 } };
  }
  if (species === 'mummy') {
    const armed = R() < 0.4;
    return { weapon: armed ? 'sword_copper' : null, role: 'melee', armorV: 6, swingK: armed ? 1.25 : null, swing: armed ? null : 2.2, dmgK: armed ? null : 1.0, reach: armed ? null : 0.72,
      extra: { curse: { chance: 0.3, dur: 3 } } };
  }
  return { weapon: R() < 0.55 ? 'sword_ice' : 'spear_ice', role: 'melee', armorV: 4, swingK: 1.15, extra: null }; // the walker
}

// ---------- deaths (killed by a player; at sunrise they only crumble: nothing) ----------
// skeletons: bones (archers: their arrows); mummies: linen, now and then embalming herbs or a gold amulet
export function nightDeath(game, m) {
  const out = [], net = game.net;
  if (m.species === 'skeleton') {
    if (net.roll() < 0.9) lootRows(net, out, m.x, m.y, 'bone', ri(net, 1, 2));
    if (m.role === 'archer' && net.roll() < 0.7) lootRows(net, out, m.x, m.y, 'arrow', ri(net, 2, 4));
  } else if (m.species === 'mummy') {
    if (net.roll() < 0.9) lootRows(net, out, m.x, m.y, 'linen', ri(net, 1, 3));
    if (net.roll() < 0.25) lootRows(net, out, m.x, m.y, 'herb', 1);
    if (net.roll() < 0.08) lootRows(net, out, m.x, m.y, 'gold_ore', 1);
  }
  return { rows: out, toast: null };
}
// the giants' drops (giants.js giantDeath)
export function giantLoot(game, m, out) {
  const net = game.net;
  if (m.species === 'skeleton_giant') {
    lootRows(net, out, m.x, m.y, 'bone', ri(net, 4, 7));
    if (net.roll() < 0.6) lootRows(net, out, m.x, m.y, 'iron_bar', ri(net, 1, 2));
    if (net.roll() < 0.25) lootRows(net, out, m.x, m.y, 'steel_bar', 1);
    return 'Gigante Esqueleto derrubado!';
  }
  if (m.species === 'mummy_giant') {
    lootRows(net, out, m.x, m.y, 'linen', ri(net, 4, 6));
    if (net.roll() < 0.7) lootRows(net, out, m.x, m.y, 'gold_bar', ri(net, 1, 2));
    if (net.roll() < 0.25) lootRows(net, out, m.x, m.y, 'jade', 1);
    return 'Múmia Gigante derrubada!';
  }
  return null;
}

// ---------- the skeletons' bones (combat.js dealDamage, on the authority) ----------
// a blow with something blunt (fists, clubs, maces, hammers, a shield bash, Esmagar…) shatters bones; an arrow / a
// thrown spear mostly slips through the ribs
const BLUNT = /^(club|hammer|mace|maul|shovel)/;
const BLUNT_AB = new Set(['smash', 'shield_bash', 'shove', 'punch', 'torch_swing']);
export function boneHitK(dst, w, opts) {
  if (!dst.bluntK) return 1;
  if (opts.ranged) return dst.pierceK || 1;
  if (BLUNT_AB.has(opts.ability) || !w || BLUNT.test(w)) return dst.bluntK;
  return 1;
}
