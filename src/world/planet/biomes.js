// Planet biomes, ground ids and the natural object kinds per biome (docs/PLANET.md §5).
// The content phase paints the placeholder kinds listed in NEW_KINDS; the in-game preview maps them onto
// existing art (ingame.js).

import { G } from '../worldgen.js';

// Ground ids: 0..7 are the current game's G.* (same numbers); 8.. are new (the content phase adds textures).
export const PG = {
  ...G,           // SOIL 0, RICH 1, SAND 2, GRAVEL 3, MARSH 4, MUD 5, STONE 6, MOSS 7
  SNOW: 8,        // permanent snow (ice sheets, peaks, polar ground)
  ICE: 9,         // glacier ice / ice cliffs
  ASH: 10,        // black volcanic ash / basalt
  SALT: 11,       // salt crust (salt flats, dry salt-lake shores)
  CLAY: 12,       // red clay / laterite (badlands, tropical soils)
  DRY: 13,        // dry hardpan / desert pavement / steppe dust
};
export const GROUND_NAMES_PT = ['Terra', 'Terra fértil', 'Areia', 'Cascalho', 'Brejo', 'Lama', 'Pedra', 'Musgo', 'Neve', 'Gelo', 'Cinza vulcânica', 'Sal', 'Argila vermelha', 'Chão seco'];
// classic stand-in for each ground id (in-game preview with the current textures)
export const GROUND_CLASSIC = [0, 1, 2, 3, 4, 5, 6, 7, 6, 6, 3, 2, 0, 0];

// Rock types: 1..4 = current game (granite, limestone, slate, marble); 5 basalt, 6 sandstone are new.
export const ROCK_PT = ['', 'Granito', 'Calcário', 'Ardósia', 'Mármore', 'Basalto', 'Arenito'];
export const ROCK_CLASSIC = [0, 1, 2, 3, 4, 3, 2];

// ---------- biomes ----------
// t: tree kinds {kind: weight}, td: tree density (chance per free tile), b: bush kinds, bd: bush density,
// gr: grass / decor density 0..1, g: main ground, fert: soil fertility 0..1, haz: hazard 0..3 (cold, heat,
// predators), cl: classic biome (worldgen BIOMES index) for the in-game preview, water: a water biome.
const T = (o) => o;
export const BIOME_LIST = [
  T({ key: 'abyss', pt: 'Oceano abissal', c: [10, 24, 58], water: 1, cl: 7, haz: 3 }),
  T({ key: 'ocean', pt: 'Mar aberto', c: [20, 56, 106], water: 1, cl: 7, haz: 1 }),
  T({ key: 'shallows', pt: 'Águas rasas', c: [48, 112, 152], water: 1, cl: 7 }),
  T({ key: 'reef', pt: 'Recife de coral', c: [52, 160, 168], water: 1, cl: 7 }),
  T({ key: 'sea_ice', pt: 'Banquisa (mar congelado)', c: [206, 222, 234], water: 1, cl: 7, haz: 3 }),
  T({ key: 'lake', pt: 'Lago', c: [38, 86, 134], water: 1, cl: 7 }),
  T({ key: 'salt_lake', pt: 'Lago salgado', c: [96, 156, 168], water: 1, cl: 7 }),
  T({ key: 'lagoon', pt: 'Laguna', c: [62, 140, 160], water: 1, cl: 7 }),
  T({ key: 'river', pt: 'Rio', c: [44, 98, 150], water: 1, cl: 7 }),
  T({ key: 'ice_sheet', pt: 'Manto de gelo', c: [232, 240, 247], g: PG.SNOW, t: {}, td: 0, gr: 0, fert: 0, haz: 3, cl: 6 }),
  T({ key: 'polar_desert', pt: 'Deserto polar', c: [176, 176, 170], g: PG.GRAVEL, t: {}, td: 0, b: { lichen_rock: 1 }, bd: 0.01, gr: 0.05, fert: 0, haz: 3, cl: 6 }),
  T({ key: 'tundra', pt: 'Tundra', c: [128, 140, 108], g: PG.MOSS, t: { tree_dwarf: 1 }, td: 0.006, b: { tundra_shrub: 3, berrybush: 1 }, bd: 0.03, gr: 0.45, fert: 0.15, haz: 2, cl: 0 }),
  T({ key: 'taiga', pt: 'Taiga', c: [46, 78, 56], g: PG.MOSS, t: { tree_spruce: 5, tree_pine: 3, tree_larch: 2, tree_birch: 1 }, td: 0.42, b: { bush: 1, berrybush: 1 }, bd: 0.02, gr: 0.35, fert: 0.3, haz: 2, cl: 2 }),
  T({ key: 'temperate_forest', pt: 'Floresta temperada', c: [58, 104, 46], g: PG.SOIL, t: { tree_oak: 6, tree_birch: 2, tree_pine: 1 }, td: 0.36, b: { bush: 3, berrybush: 2, herbbush: 1 }, bd: 0.05, gr: 0.6, fert: 0.75, haz: 1, cl: 1 }),
  T({ key: 'temperate_rainforest', pt: 'Floresta temperada úmida', c: [32, 80, 48], g: PG.MOSS, t: { tree_redwood: 3, tree_spruce: 3, tree_pine: 2, tree_oak: 1 }, td: 0.5, b: { bush: 2, herbbush: 2 }, bd: 0.06, gr: 0.7, fert: 0.6, haz: 1, cl: 2 }),
  T({ key: 'steppe', pt: 'Estepe / pradaria', c: [168, 160, 96], g: PG.SOIL, t: { tree_oak: 1 }, td: 0.004, b: { tussock: 4, bush: 1 }, bd: 0.03, gr: 0.8, fert: 0.85, haz: 1, cl: 0 }),
  T({ key: 'mediterranean', pt: 'Mata mediterrânea', c: [132, 136, 76], g: PG.DRY, t: { tree_olive: 3, tree_cypress: 2, tree_oak: 2, tree_pine: 1 }, td: 0.08, b: { bush: 3, herbbush: 1 }, bd: 0.08, gr: 0.4, fert: 0.55, haz: 1, cl: 3 }),
  T({ key: 'cold_desert', pt: 'Deserto frio', c: [172, 156, 122], g: PG.DRY, t: {}, td: 0, b: { shrub_desert: 3, dead_bush: 1 }, bd: 0.02, gr: 0.08, fert: 0.1, haz: 2, cl: 6 }),
  T({ key: 'desert_dunes', pt: 'Deserto de dunas', c: [226, 196, 128], g: PG.SAND, t: {}, td: 0, b: { dead_bush: 1 }, bd: 0.002, gr: 0, fert: 0, haz: 3, cl: 5 }),
  T({ key: 'desert_rocky', pt: 'Deserto rochoso', c: [192, 150, 104], g: PG.DRY, t: { tree_acacia: 1 }, td: 0.001, b: { cactus: 2, cactus_tall: 1, shrub_desert: 3, agave: 1, dead_bush: 2 }, bd: 0.015, gr: 0.04, fert: 0.05, haz: 3, cl: 6 }),
  T({ key: 'badlands', pt: 'Mesas e cânions', c: [184, 106, 66], g: PG.CLAY, t: { tree_pine: 1 }, td: 0.002, b: { shrub_desert: 3, cactus: 1, dead_bush: 1 }, bd: 0.012, gr: 0.05, fert: 0.1, haz: 2, cl: 6 }),
  T({ key: 'savanna', pt: 'Savana', c: [176, 158, 74], g: PG.DRY, t: { tree_acacia: 5, tree_baobab: 1 }, td: 0.03, b: { bush: 3, termite_mound: 1, tussock: 2 }, bd: 0.02, gr: 0.75, fert: 0.45, haz: 2, cl: 0 }),
  T({ key: 'tropical_dry', pt: 'Floresta tropical seca', c: [110, 126, 52], g: PG.SOIL, t: { tree_jungle: 3, tree_acacia: 2, tree_baobab: 1, bamboo: 1 }, td: 0.2, b: { bush: 3, banana: 1, berrybush: 1 }, bd: 0.05, gr: 0.5, fert: 0.5, haz: 2, cl: 1 }),
  T({ key: 'rainforest', pt: 'Floresta tropical', c: [22, 86, 34], g: PG.MOSS, t: { tree_jungle: 7, tree_kapok: 1, tree_palm: 2, bamboo: 1, tree_fern: 1 }, td: 0.6, b: { banana: 4, bush: 1, herbbush: 2, berrybush: 1 }, bd: 0.1, gr: 0.6, fert: 0.4, haz: 2, cl: 1 }),
  T({ key: 'cloud_forest', pt: 'Floresta nebular', c: [42, 96, 68], g: PG.MOSS, t: { tree_jungle: 3, tree_fern: 3, tree_oak: 1 }, td: 0.45, b: { herbbush: 2, banana: 2, bush: 1 }, bd: 0.07, gr: 0.7, fert: 0.4, haz: 1, cl: 1 }),
  T({ key: 'mangrove', pt: 'Mangue', c: [52, 92, 62], g: PG.MUD, t: { tree_mangrove: 1 }, td: 0.3, b: {}, bd: 0, gr: 0.2, fert: 0.3, haz: 2, cl: 4 }),
  T({ key: 'swamp', pt: 'Pântano tropical', c: [66, 92, 56], g: PG.MARSH, t: { tree_jungle: 2, tree_dead: 1, tree_palm: 1 }, td: 0.1, b: { papyrus: 3, banana: 1, bush: 1 }, bd: 0.08, gr: 0.8, fert: 0.4, haz: 2, cl: 4 }),
  T({ key: 'marsh', pt: 'Brejo / turfeira', c: [92, 116, 78], g: PG.MARSH, t: { tree_dead: 2, tree_birch: 2 }, td: 0.03, b: { bush: 1 }, bd: 0.02, gr: 0.85, fert: 0.35, haz: 1, cl: 4 }),
  T({ key: 'alpine', pt: 'Prado alpino', c: [126, 136, 102], g: PG.SOIL, t: { tree_dwarf: 2, tree_pine: 1 }, td: 0.01, b: { tundra_shrub: 2, bush: 1 }, bd: 0.02, gr: 0.6, fert: 0.3, haz: 2, cl: 0 }),
  T({ key: 'snow_peaks', pt: 'Picos nevados', c: [240, 242, 247], g: PG.SNOW, t: {}, td: 0, gr: 0, fert: 0, haz: 3, cl: 8 }),
  T({ key: 'volcanic', pt: 'Terra vulcânica', c: [104, 94, 90], g: PG.ASH, t: { tree_dead: 1, tree_pine: 1 }, td: 0.01, b: { shrub_desert: 1 }, bd: 0.01, gr: 0.05, fert: 0.6, haz: 3, cl: 6 }),
  T({ key: 'salt_flat', pt: 'Salar', c: [236, 232, 222], g: PG.SALT, t: {}, td: 0, gr: 0, fert: 0, haz: 2, cl: 5 }),
  T({ key: 'beach', pt: 'Praia', c: [228, 212, 162], g: PG.SAND, t: { tree_palm: 1 }, td: 0.004, b: { dune_grass: 1 }, bd: 0.01, gr: 0.05, fert: 0.05, haz: 0, cl: 5 }),
  T({ key: 'rocky_shore', pt: 'Costa rochosa', c: [138, 128, 118], g: PG.GRAVEL, t: { tree_pine: 1 }, td: 0.01, b: { bush: 1 }, bd: 0.01, gr: 0.2, fert: 0.1, haz: 1, cl: 6 }),
  T({ key: 'cliff', pt: 'Falésia', c: [116, 108, 98], g: PG.STONE, t: {}, td: 0, b: { bush: 1 }, bd: 0.01, gr: 0.3, fert: 0.1, haz: 1, cl: 6 }),
  T({ key: 'heath', pt: 'Charneca', c: [122, 100, 104], g: PG.SOIL, t: { tree_birch: 1, tree_pine: 1 }, td: 0.01, b: { bush: 2, berrybush: 1 }, bd: 0.04, gr: 0.7, fert: 0.3, haz: 1, cl: 0 }),
  T({ key: 'floodplain', pt: 'Várzea', c: [92, 138, 58], g: PG.RICH, t: { tree_oak: 2, tree_birch: 1 }, td: 0.03, b: { bush: 1, berrybush: 1 }, bd: 0.02, gr: 0.9, fert: 1, haz: 0, cl: 0 }),
];
export const BIOME = {};
BIOME_LIST.forEach((b, i) => { BIOME[b.key.toUpperCase()] = i; b.id = i; });
export const BIOME_KEYS = BIOME_LIST.map((b) => b.key);
export const BIOME_PT = BIOME_LIST.map((b) => b.pt);
export const isWaterBiome = (b) => b <= BIOME.RIVER;

// natural object / decor kinds that do not exist in the game yet (the content phase paints them)
export const NEW_KINDS = {
  trees: ['tree_palm', 'tree_acacia', 'tree_baobab', 'tree_jungle', 'tree_kapok', 'tree_mangrove', 'tree_spruce', 'tree_larch', 'tree_redwood', 'tree_cypress', 'tree_olive', 'tree_fern', 'tree_dwarf', 'bamboo'],
  plants: ['cactus', 'cactus_tall', 'agave', 'banana', 'shrub_desert', 'dead_bush', 'tussock', 'tundra_shrub', 'dune_grass', 'papyrus', 'lichen_rock', 'termite_mound'],
  decor: ['snowtuft', 'lichen', 'cottongrass', 'saltcrust', 'seaweed', 'coral', 'ash', 'sandripple'],
};

// ---------- classification ----------
// Land biome from mean annual temperature T (°C), precipitation P (mm/yr), elevation em (m) and context:
// o.relief 0..1, o.med (winter-wet west coast 30..42°), o.coast (cells to the sea), o.erg (sand sea noise > 0),
// o.plateau 0..1.
export function landBiome(T, P, em, o) {
  const B = BIOME;
  const high = em > 1500 || (em > 900 && o.relief > 0.45);
  if (high) {
    if (T < -7.5) return B.SNOW_PEAKS;
    if (T < 0.5) return B.ALPINE;
    if (T > 13 && P > 1300 && em > 1000) return B.CLOUD_FOREST;
  }
  if (T < -13) return B.ICE_SHEET;
  if (T < -6) return P < 170 ? B.POLAR_DESERT : B.TUNDRA;
  if (T < 2.5) {
    if (P < 190) return T < -2 ? B.TUNDRA : B.COLD_DESERT;
    if (T < -1.5 && P < 420) return B.TUNDRA;
    return B.TAIGA;
  }
  const arid = P < 260 + T * 4;
  if (arid && P < 450 && em > 850 && o.plateau > 0.35) return B.BADLANDS;
  if (T < 12) {
    if (P < 240) return B.COLD_DESERT;
    if (P < 500) return o.plateau > 0.5 && P < 330 ? B.BADLANDS : B.STEPPE;
    if (T < 5.5 && P < 1300) return B.TAIGA;
    if (P > 1500 && o.coast < 10) return B.TEMPERATE_RAINFOREST;
    if (P > 900 && T < 9 && o.coast < 5 && o.heath > 0.2) return B.HEATH;
    return B.TEMPERATE_FOREST;
  }
  if (T < 20) {
    if (P < 250) return T > 15 ? (o.erg > 0 ? B.DESERT_DUNES : B.DESERT_ROCKY) : B.COLD_DESERT;
    if (o.med && P < 950) return B.MEDITERRANEAN;
    if (P < 560) return B.STEPPE;
    if (P > 1800) return T > 17.5 ? B.RAINFOREST : B.TEMPERATE_RAINFOREST;
    return B.TEMPERATE_FOREST;
  }
  if (P < 290) return o.erg > 0 ? B.DESERT_DUNES : B.DESERT_ROCKY;
  if (P < 1000) return B.SAVANNA;
  if (P < 1650) return B.TROPICAL_DRY;
  return B.RAINFOREST;
}

// weighted pick from a {kind: weight} table with r in [0, 1)
export function pickWeighted(tab, r) {
  let tot = 0;
  for (const k in tab) tot += tab[k];
  let a = r * tot;
  for (const k in tab) { a -= tab[k]; if (a < 0) return k; }
  for (const k in tab) return k;
  return null;
}
