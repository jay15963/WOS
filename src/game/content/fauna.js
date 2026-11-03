// Wild fauna of the planet's biomes (pure data, docs/FAUNA.md). Every user-facing string in Brazilian Portuguese.
// Three tables:
//   FAUNA_SPECIES  combat stats, merged into SPECIES (content/combat.js): temper, hp, dmg, swing, speed (tiles / s),
//                  aggro (sight, tiles), r, scale, xp, lvl (levels above the distance level), minD (tiles from the world
//                  spawn), loot rows [item, min, max, chance, 'skin'?] (butchering, mut/corpses.js), size (corpse class)
//   FAUNA          behaviour (game/fauna.js): move ('walk' | 'climb' | 'amphib' | 'swim' | 'fly'), when ('day' |
//                  'night' | 'always'), herd (flees together), territorial (tiles: a neutral one charges a player this
//                  close), ambush ({ r, hide: 'water' | 'grass', warn? }), stalk (creeps, then pounces), rest ('day':
//                  lies down by day, sees less), lounge (lies down now and then), migrate (the herd wanders the land),
//                  trees (climbs a tree when scared), perch / soar / scavenge / prey (birds), swimTarget (hunts only
//                  players in the water), jump / spout / dive (sea), water speed
//   FAUNA_SPAWNS   per planet biome (key of world/planet/biomes.js BIOME_LIST): groups per 64 × 64 chunk of that
//                  biome, group size, where in it (on), altitude (stories); the existing species are listed where they
//                  belong (wolf, deer, boar, bear, fox, rabbit) and fish schools ('fish') in the sea

const skin = (a, b, c = 1) => ['leather', a, b, c, 'skin'];
const meat = (a, b, c = 1) => ['meat', a, b, c];

export const FAUNA_SPECIES = {
  // ---- polar / ice ----
  polar_bear:  { name: 'Urso-polar', temper: 'hostile', elite: true, hp: 260, dmg: 15, swing: 2.4, speed: 4.3, aggro: 8.5, r: 0.5, scale: 1, xp: 4, lvl: 4, minD: 60, size: 'l',
                 loot: [meat(4, 6), skin(3, 5)] },
  seal:        { name: 'Foca', temper: 'passive', hp: 44, dmg: 0, swing: 2, speed: 2.2, r: 0.36, scale: 1, xp: 0.6, minD: 10, size: 'm',
                 loot: [meat(2, 3), skin(1, 2, 0.9)] },
  arctic_fox:  { name: 'Raposa-do-ártico', temper: 'passive', hp: 22, dmg: 0, swing: 1.4, speed: 6.0, r: 0.22, scale: 1.25, xp: 0.5, minD: 8, size: 's', skittish: 6.5,
                 loot: [meat(1, 1), skin(1, 1, 0.8)] },
  // ---- tundra / taiga ----
  moose:       { name: 'Alce', temper: 'neutral', hp: 160, dmg: 11, swing: 2.4, speed: 4.6, r: 0.5, scale: 1, xp: 2.2, lvl: 2, minD: 30, size: 'l',
                 loot: [meat(4, 6), skin(2, 3)] },
  reindeer:    { name: 'Rena', temper: 'passive', hp: 52, dmg: 0, swing: 2, speed: 5.6, r: 0.36, scale: 1, xp: 0.8, minD: 10, size: 'm',
                 loot: [meat(2, 3), skin(1, 2, 0.9)] },
  lynx:        { name: 'Lince', temper: 'hostile', hp: 48, dmg: 5.5, swing: 1.5, speed: 5.0, aggro: 7.5, r: 0.3, scale: 1.25, xp: 1.4, minD: 30, size: 's',
                 loot: [meat(1, 1), skin(1, 1, 0.8)] },
  // ---- steppe / grassland ----
  wild_horse:  { name: 'Cavalo selvagem', temper: 'passive', hp: 72, dmg: 0, swing: 2, speed: 6.4, r: 0.42, scale: 1, xp: 0.9, minD: 10, size: 'l',
                 loot: [meat(3, 4), skin(2, 2)] },
  bison:       { name: 'Bisão', temper: 'neutral', hp: 175, dmg: 10, swing: 2.6, speed: 4.5, r: 0.55, scale: 1, xp: 2.2, lvl: 1, minD: 20, size: 'l', social: true,
                 loot: [meat(5, 7), skin(3, 4)] },
  yak:         { name: 'Iaque', temper: 'neutral', hp: 140, dmg: 9, swing: 2.6, speed: 3.8, r: 0.5, scale: 1, xp: 1.8, lvl: 1, minD: 20, size: 'l', social: true,
                 loot: [meat(4, 5), skin(2, 3), ['wool', 2, 4, 1]] },
  // ---- hot desert ----
  camel:       { name: 'Camelo', temper: 'passive', hp: 95, dmg: 0, swing: 2, speed: 4.4, r: 0.45, scale: 1, xp: 0.9, minD: 10, size: 'l',
                 loot: [meat(3, 5), skin(2, 3)] },
  scorpion:    { name: 'Escorpião', temper: 'hostile', hp: 18, dmg: 3, swing: 1.3, speed: 3.6, aggro: 4.5, r: 0.18, scale: 1.3, xp: 0.8, minD: 16, size: 's', noCorpse: true,
                 poison: { chance: 0.6, dur: 6, tick: 1.5, k: 0.5 }, loot: [] },
  rattlesnake: { name: 'Cascavel', temper: 'hostile', hp: 20, dmg: 4, swing: 1.6, speed: 3.2, aggro: 2.4, r: 0.2, scale: 1.2, xp: 1, minD: 14, size: 's',
                 poison: { chance: 0.8, dur: 8, tick: 1.5, k: 0.55 }, loot: [meat(1, 1, 0.6), skin(1, 1, 0.5)] },
  vulture:     { name: 'Abutre', temper: 'passive', hp: 24, dmg: 0, swing: 2, speed: 3.2, r: 0.26, scale: 1, xp: 0.5, minD: 8, size: 's', noAuto: true,
                 loot: [meat(1, 1, 0.7), ['feather', 2, 4, 1]] },
  // ---- savanna ----
  zebra:       { name: 'Zebra', temper: 'passive', hp: 66, dmg: 0, swing: 2, speed: 6.2, r: 0.4, scale: 1, xp: 0.9, minD: 10, size: 'm',
                 loot: [meat(3, 3), skin(2, 2)] },
  gazelle:     { name: 'Gazela', temper: 'passive', hp: 30, dmg: 0, swing: 2, speed: 7.2, r: 0.26, scale: 1.15, xp: 0.6, minD: 8, size: 's', skittish: 8,
                 loot: [meat(1, 2), skin(1, 1, 0.8)] },
  lion:        { name: 'Leão', temper: 'hostile', hp: 150, dmg: 11, swing: 1.9, speed: 5.0, aggro: 9, r: 0.42, scale: 1.1, xp: 2.6, lvl: 2, minD: 45, size: 'm', social: true,
                 loot: [meat(3, 4), skin(2, 3)] },
  elephant:    { name: 'Elefante', temper: 'neutral', elite: true, hp: 480, dmg: 22, swing: 3, speed: 4.2, r: 0.85, scale: 1, xp: 5, lvl: 3, minD: 30, size: 'l', social: true,
                 loot: [meat(8, 12), skin(5, 7)] },
  // ---- tropical rainforest ----
  monkey:      { name: 'Macaco', temper: 'neutral', hp: 26, dmg: 3, swing: 1.2, speed: 5.4, r: 0.22, scale: 1.3, xp: 0.5, minD: 8, size: 's', social: true,
                 loot: [meat(1, 1)] },
  jaguar:      { name: 'Onça-pintada', temper: 'hostile', elite: true, hp: 125, dmg: 12, swing: 1.7, speed: 5.2, aggro: 8, r: 0.4, scale: 1.15, xp: 2.6, lvl: 2, minD: 40, size: 'm',
                 loot: [meat(2, 3), skin(2, 2)] },
  parrot:      { name: 'Arara', temper: 'passive', hp: 8, dmg: 0, swing: 2, speed: 3, r: 0.16, scale: 1.2, xp: 0.2, minD: 4, size: 's', noAuto: true,
                 loot: [['feather', 1, 3, 1], meat(1, 1, 0.4)] },
  // ---- swamp / mangrove / marsh ----
  crocodile:   { name: 'Crocodilo', temper: 'hostile', hp: 170, dmg: 14, swing: 2.2, speed: 3.4, aggro: 3.8, r: 0.45, scale: 1, xp: 2.6, lvl: 2, minD: 30, size: 'l',
                 loot: [meat(3, 4), skin(3, 4)] },
  heron:       { name: 'Garça', temper: 'passive', hp: 16, dmg: 0, swing: 2, speed: 2.6, r: 0.2, scale: 1.15, xp: 0.3, minD: 6, size: 's', noAuto: true,
                 loot: [meat(1, 1), ['feather', 2, 3, 1]] },
  // ---- mountains / alpine ----
  mountain_goat: { name: 'Cabra-montês', temper: 'passive', hp: 42, dmg: 0, swing: 2, speed: 5.2, r: 0.3, scale: 1.1, xp: 0.7, minD: 10, size: 's',
                 loot: [meat(2, 2), skin(1, 1, 0.8), ['wool', 1, 1, 0.5]] },
  eagle:       { name: 'Águia', temper: 'passive', hp: 22, dmg: 0, swing: 2, speed: 3, r: 0.22, scale: 1.1, xp: 0.5, minD: 8, size: 's', noAuto: true,
                 loot: [['feather', 2, 4, 1]] },
  // ---- coast / beach ----
  crab:        { name: 'Caranguejo', temper: 'neutral', hp: 12, dmg: 2, swing: 1.4, speed: 3, r: 0.16, scale: 1.25, xp: 0.3, minD: 4, size: 's',
                 loot: [meat(1, 1)] },
  seagull:     { name: 'Gaivota', temper: 'passive', hp: 8, dmg: 0, swing: 2, speed: 3, r: 0.16, scale: 1.1, xp: 0.2, minD: 4, size: 's', noAuto: true,
                 loot: [['feather', 1, 2, 1]] },
  // ---- ocean (seen from the shore / a boat) ----
  dolphin:     { name: 'Golfinho', temper: 'passive', hp: 70, dmg: 0, swing: 2, speed: 6, r: 0.4, scale: 1, xp: 0.8, minD: 20, size: 'm', noAuto: true,
                 loot: [meat(3, 3)] },
  shark:       { name: 'Tubarão', temper: 'hostile', hp: 135, dmg: 16, swing: 1.8, speed: 4.6, aggro: 9, r: 0.45, scale: 1, xp: 2.4, lvl: 2, minD: 30, size: 'm',
                 loot: [meat(3, 4), skin(2, 2)] },
  whale:       { name: 'Baleia', temper: 'passive', hp: 1200, dmg: 0, swing: 2, speed: 2.2, r: 1.6, scale: 1, xp: 3, minD: 40, size: 'l', noAuto: true,
                 loot: [meat(20, 30), skin(6, 10)] },
};
for (const k in FAUNA_SPECIES) FAUNA_SPECIES[k].fauna = true; // (game/fauna.js runs them: mobs.js spawnMember)

// behaviour (game/fauna.js)
export const FAUNA = {
  polar_bear:  { move: 'walk', when: 'always', swims: true, lounge: 0.25 },
  seal:        { move: 'amphib', when: 'always', water: 4.6, flee: 6, toWater: true, group: 'colônia' },
  arctic_fox:  { move: 'walk', when: 'day' },
  moose:       { move: 'walk', when: 'always', territorial: 3.2 },
  reindeer:    { move: 'walk', when: 'day', herd: true, migrate: true },
  lynx:        { move: 'walk', when: 'night', stalk: true },
  wild_horse:  { move: 'walk', when: 'day', herd: true, migrate: true },
  bison:       { move: 'walk', when: 'always', herd: true, migrate: true, territorial: 2.6 },
  yak:         { move: 'climb', when: 'always', herd: true, territorial: 2.4 },
  camel:       { move: 'walk', when: 'day', lounge: 0.35 },
  scorpion:    { move: 'walk', when: 'night' },
  rattlesnake: { move: 'walk', when: 'always', ambush: { r: 2.4, hide: 'grass', warn: 4.5 } },
  vulture:     { move: 'fly', when: 'day', soar: true, scavenge: true, flush: 6 },
  zebra:       { move: 'walk', when: 'day', herd: true, migrate: true },
  gazelle:     { move: 'walk', when: 'day', herd: true, migrate: true },
  lion:        { move: 'walk', when: 'always', rest: 'day', restAggro: 4.5, pride: true },
  elephant:    { move: 'walk', when: 'always', herd: true, migrate: true, territorial: 4.2 },
  monkey:      { move: 'walk', when: 'day', trees: 7 },
  jaguar:      { move: 'walk', when: 'night', stalk: true, swims: true },
  parrot:      { move: 'fly', when: 'day', perch: 'tree', flush: 5 },
  crocodile:   { move: 'amphib', when: 'always', water: 4.4, ambush: { r: 3.8, hide: 'water' }, leash: 10 },
  heron:       { move: 'fly', when: 'day', perch: 'water', flush: 5.5, wade: true },
  mountain_goat: { move: 'climb', when: 'day', herd: true },
  eagle:       { move: 'fly', when: 'day', soar: true, perch: 'rock', prey: ['rabbit', 'arctic_fox', 'monkey', 'crab'], flush: 7 },
  crab:        { move: 'amphib', when: 'always', water: 2.4, sideways: true },
  seagull:     { move: 'fly', when: 'day', perch: 'shore', flush: 4.5 },
  dolphin:     { move: 'swim', when: 'always', jump: true, pod: true },
  shark:       { move: 'swim', when: 'always', swimTarget: true },
  whale:       { move: 'swim', when: 'always', spout: true, dive: true, far: 10 },
};

// ---------------------------------------------------------------------------------------------------------------------
// spawn tables: per planet biome key → rows { sp, d, n: [min, max], on?, alt?: [min, max] stories, when? }
//   d   expected groups in a 64 × 64 chunk made only of that biome (scaled by the biome's share of the chunk)
//   on  'land' (default) | 'shore' (land ≤ 2 tiles from water) | 'rock' (land ≤ 3 tiles from rock, or steep)
//       'shallow' (water class 1) | 'deep' (class 2+) | 'far' (deep, ≥ 10 tiles from land) | 'water' (any water)
//       'trees' (land with ≥ 2 trees within 3 tiles; needs grid.trees)
// ---------------------------------------------------------------------------------------------------------------------
const SEA = [{ sp: 'fish', d: 1.4, n: [2, 4], on: 'water' }];
export const FAUNA_SPAWNS = {
  abyss: [{ sp: 'whale', d: 0.25, n: [1, 2], on: 'far' }, { sp: 'shark', d: 0.2, n: [1, 1], on: 'deep' }],
  ocean: [{ sp: 'whale', d: 0.3, n: [1, 2], on: 'far' }, { sp: 'dolphin', d: 0.6, n: [3, 6], on: 'deep' }, { sp: 'shark', d: 0.35, n: [1, 2], on: 'deep' }, ...SEA],
  shallows: [{ sp: 'dolphin', d: 0.3, n: [2, 4], on: 'deep' }, { sp: 'shark', d: 0.15, n: [1, 1], on: 'deep' }, ...SEA],
  reef: [{ sp: 'shark', d: 0.4, n: [1, 2], on: 'deep' }, { sp: 'fish', d: 2.4, n: [3, 5], on: 'water' }],
  sea_ice: [{ sp: 'seal', d: 0.8, n: [2, 5], on: 'shore' }, { sp: 'polar_bear', d: 0.2, n: [1, 1], on: 'shore' }],
  lake: [{ sp: 'fish', d: 1.6, n: [2, 3], on: 'water' }, { sp: 'heron', d: 0.4, n: [1, 2], on: 'shallow' }],
  lagoon: [{ sp: 'fish', d: 1.2, n: [2, 3], on: 'water' }, { sp: 'heron', d: 0.5, n: [1, 2], on: 'shallow' }, { sp: 'seagull', d: 0.4, n: [3, 6], on: 'shallow' }],
  river: [{ sp: 'fish', d: 1.2, n: [2, 3], on: 'water' }],
  ice_sheet: [{ sp: 'polar_bear', d: 0.12, n: [1, 1] }, { sp: 'arctic_fox', d: 0.2, n: [1, 1] }],
  polar_desert: [{ sp: 'polar_bear', d: 0.25, n: [1, 1] }, { sp: 'arctic_fox', d: 0.5, n: [1, 2] }, { sp: 'seal', d: 0.6, n: [2, 5], on: 'shore' }],
  tundra: [{ sp: 'reindeer', d: 1, n: [4, 9] }, { sp: 'arctic_fox', d: 0.6, n: [1, 1] }, { sp: 'wolf', d: 0.45, n: [2, 3] }, { sp: 'rabbit', d: 0.6, n: [1, 2] },
    { sp: 'polar_bear', d: 0.08, n: [1, 1], on: 'shore' }, { sp: 'yak', d: 0.25, n: [2, 5], alt: [4, 99] }],
  taiga: [{ sp: 'moose', d: 0.45, n: [1, 1] }, { sp: 'reindeer', d: 0.4, n: [3, 6] }, { sp: 'lynx', d: 0.35, n: [1, 1] }, { sp: 'wolf', d: 0.6, n: [2, 3] },
    { sp: 'bear', d: 0.25, n: [1, 1] }, { sp: 'fox', d: 0.5, n: [1, 1] }, { sp: 'rabbit', d: 0.7, n: [1, 2] }, { sp: 'deer', d: 0.4, n: [1, 3] }],
  temperate_forest: [{ sp: 'deer', d: 1.1, n: [1, 3] }, { sp: 'boar', d: 0.9, n: [1, 3] }, { sp: 'wolf', d: 0.7, n: [2, 3] }, { sp: 'fox', d: 0.7, n: [1, 1] },
    { sp: 'rabbit', d: 1.1, n: [1, 2] }, { sp: 'bear', d: 0.25, n: [1, 1] }, { sp: 'lynx', d: 0.12, n: [1, 1] }],
  temperate_rainforest: [{ sp: 'deer', d: 0.9, n: [1, 3] }, { sp: 'bear', d: 0.35, n: [1, 1] }, { sp: 'wolf', d: 0.5, n: [2, 3] }, { sp: 'fox', d: 0.4, n: [1, 1] },
    { sp: 'moose', d: 0.2, n: [1, 1] }, { sp: 'rabbit', d: 0.6, n: [1, 2] }],
  steppe: [{ sp: 'wild_horse', d: 0.8, n: [3, 7] }, { sp: 'bison', d: 0.45, n: [3, 8] }, { sp: 'rabbit', d: 1, n: [1, 2] }, { sp: 'wolf', d: 0.35, n: [2, 3] },
    { sp: 'fox', d: 0.4, n: [1, 1] }, { sp: 'deer', d: 0.3, n: [1, 3] }, { sp: 'eagle', d: 0.15, n: [1, 1] }],
  mediterranean: [{ sp: 'boar', d: 0.8, n: [1, 3] }, { sp: 'deer', d: 0.6, n: [1, 2] }, { sp: 'rabbit', d: 1, n: [1, 2] }, { sp: 'fox', d: 0.5, n: [1, 1] },
    { sp: 'mountain_goat', d: 0.2, n: [2, 4], on: 'rock' }, { sp: 'eagle', d: 0.12, n: [1, 1] }],
  cold_desert: [{ sp: 'camel', d: 0.35, n: [1, 3] }, { sp: 'wild_horse', d: 0.3, n: [3, 5] }, { sp: 'yak', d: 0.3, n: [2, 5], alt: [3, 99] }, { sp: 'wolf', d: 0.25, n: [2, 3] },
    { sp: 'vulture', d: 0.2, n: [1, 3] }, { sp: 'rattlesnake', d: 0.2, n: [1, 1] }],
  desert_dunes: [{ sp: 'camel', d: 0.35, n: [1, 4] }, { sp: 'scorpion', d: 0.8, n: [1, 2] }, { sp: 'rattlesnake', d: 0.2, n: [1, 1] }, { sp: 'vulture', d: 0.25, n: [2, 4] }],
  desert_rocky: [{ sp: 'camel', d: 0.3, n: [1, 3] }, { sp: 'scorpion', d: 0.9, n: [1, 2] }, { sp: 'rattlesnake', d: 0.5, n: [1, 1] }, { sp: 'vulture', d: 0.3, n: [2, 5] },
    { sp: 'mountain_goat', d: 0.15, n: [2, 3], on: 'rock' }, { sp: 'gazelle', d: 0.25, n: [3, 6] }],
  badlands: [{ sp: 'rattlesnake', d: 0.5, n: [1, 1] }, { sp: 'scorpion', d: 0.6, n: [1, 2] }, { sp: 'vulture', d: 0.35, n: [2, 4] }, { sp: 'mountain_goat', d: 0.3, n: [2, 4], on: 'rock' },
    { sp: 'wild_horse', d: 0.2, n: [3, 5] }, { sp: 'eagle', d: 0.15, n: [1, 1] }],
  savanna: [{ sp: 'zebra', d: 0.9, n: [4, 10] }, { sp: 'gazelle', d: 0.9, n: [4, 10] }, { sp: 'elephant', d: 0.3, n: [2, 6] }, { sp: 'lion', d: 0.25, n: [2, 5] },
    { sp: 'vulture', d: 0.35, n: [2, 5] }, { sp: 'rattlesnake', d: 0.15, n: [1, 1] }],
  tropical_dry: [{ sp: 'elephant', d: 0.25, n: [2, 5] }, { sp: 'monkey', d: 0.6, n: [4, 8], on: 'trees' }, { sp: 'jaguar', d: 0.15, n: [1, 1] }, { sp: 'boar', d: 0.5, n: [1, 3] },
    { sp: 'parrot', d: 0.5, n: [3, 6] }, { sp: 'gazelle', d: 0.3, n: [3, 6] }],
  rainforest: [{ sp: 'monkey', d: 1, n: [4, 9], on: 'trees' }, { sp: 'jaguar', d: 0.3, n: [1, 1] }, { sp: 'parrot', d: 1, n: [3, 7] }, { sp: 'boar', d: 0.35, n: [1, 3] },
    { sp: 'crocodile', d: 0.3, n: [1, 1], on: 'shallow' }, { sp: 'rattlesnake', d: 0.15, n: [1, 1] }],
  cloud_forest: [{ sp: 'monkey', d: 0.7, n: [3, 7], on: 'trees' }, { sp: 'parrot', d: 0.7, n: [3, 6] }, { sp: 'jaguar', d: 0.15, n: [1, 1] }, { sp: 'deer', d: 0.3, n: [1, 2] }],
  mangrove: [{ sp: 'crocodile', d: 0.8, n: [1, 2], on: 'shallow' }, { sp: 'heron', d: 0.8, n: [1, 3], on: 'shallow' }, { sp: 'crab', d: 1.2, n: [2, 5], on: 'shore' },
    { sp: 'monkey', d: 0.25, n: [3, 6], on: 'trees' }, { sp: 'fish', d: 0.8, n: [2, 3], on: 'water' }],
  swamp: [{ sp: 'crocodile', d: 0.8, n: [1, 2], on: 'shallow' }, { sp: 'heron', d: 0.8, n: [1, 3], on: 'shallow' }, { sp: 'boar', d: 0.4, n: [1, 3] },
    { sp: 'parrot', d: 0.3, n: [3, 5] }, { sp: 'rattlesnake', d: 0.2, n: [1, 1] }],
  marsh: [{ sp: 'heron', d: 0.9, n: [1, 3], on: 'shallow' }, { sp: 'moose', d: 0.2, n: [1, 1] }, { sp: 'deer', d: 0.4, n: [1, 3] }, { sp: 'boar', d: 0.4, n: [1, 3] },
    { sp: 'fox', d: 0.3, n: [1, 1] }],
  alpine: [{ sp: 'mountain_goat', d: 0.9, n: [2, 5], on: 'rock' }, { sp: 'yak', d: 0.35, n: [2, 5] }, { sp: 'eagle', d: 0.35, n: [1, 1] }, { sp: 'bear', d: 0.12, n: [1, 1] },
    { sp: 'rabbit', d: 0.4, n: [1, 2] }, { sp: 'lynx', d: 0.12, n: [1, 1] }],
  snow_peaks: [{ sp: 'mountain_goat', d: 0.5, n: [2, 4], on: 'rock' }, { sp: 'eagle', d: 0.2, n: [1, 1] }],
  volcanic: [{ sp: 'mountain_goat', d: 0.15, n: [1, 3], on: 'rock' }, { sp: 'vulture', d: 0.15, n: [1, 3] }],
  salt_flat: [{ sp: 'camel', d: 0.12, n: [1, 2] }, { sp: 'vulture', d: 0.1, n: [1, 2] }],
  beach: [{ sp: 'crab', d: 1.6, n: [2, 5], on: 'shore' }, { sp: 'seagull', d: 1.2, n: [3, 8], on: 'shore' }, { sp: 'seal', d: 0.25, n: [2, 4], on: 'shore' }],
  rocky_shore: [{ sp: 'seagull', d: 1, n: [3, 7], on: 'shore' }, { sp: 'crab', d: 1, n: [2, 4], on: 'shore' }, { sp: 'seal', d: 0.5, n: [2, 5], on: 'shore' }],
  cliff: [{ sp: 'seagull', d: 0.9, n: [3, 7] }, { sp: 'mountain_goat', d: 0.2, n: [2, 3], on: 'rock' }, { sp: 'eagle', d: 0.15, n: [1, 1] }],
  heath: [{ sp: 'deer', d: 0.6, n: [1, 3] }, { sp: 'rabbit', d: 1, n: [1, 2] }, { sp: 'fox', d: 0.5, n: [1, 1] }, { sp: 'wolf', d: 0.35, n: [2, 3] }, { sp: 'wild_horse', d: 0.25, n: [3, 5] }],
  floodplain: [{ sp: 'deer', d: 0.8, n: [1, 3] }, { sp: 'boar', d: 0.6, n: [1, 3] }, { sp: 'heron', d: 0.5, n: [1, 2], on: 'shore' }, { sp: 'rabbit', d: 0.8, n: [1, 2] },
    { sp: 'bison', d: 0.2, n: [3, 6] }],
};
