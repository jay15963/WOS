// The planet's natural kinds (biomes.js NEW_KINDS) as the game plays them: each one behaves as a classic kind
// (collision, harvest, regrowth, network) and is drawn as an art species inside it (src/art/planetFlora.js):
//   trees           o.v = species * 16 + variant      (composeWorld TREE_SPECIES: the classic species keep 0..2)
//   bush / fibergrass / boulder   o.v = species * 1000 + variant
// Pure data (no DOM): the in-game adapter (ingame.js) and the art read it.

import { BIOME_LIST, pickWeighted } from './biomes.js';

export const FLORA_KIND = {
  tree_palm: ['tree_oak', 3], tree_acacia: ['tree_oak', 4], tree_baobab: ['tree_oak', 5], tree_jungle: ['tree_oak', 6], tree_kapok: ['tree_oak', 7],
  tree_olive: ['tree_oak', 8], tree_fern: ['tree_oak', 9], tree_mangrove: ['tree_oak', 10],
  tree_spruce: ['tree_pine', 3], tree_larch: ['tree_pine', 4], tree_redwood: ['tree_pine', 5], tree_cypress: ['tree_pine', 6],
  tree_dwarf: ['tree_birch', 2], bamboo: ['tree_birch', 3],
  // plants: bushes give fibre + sticks, the grasses fibre, the rocks stone
  cactus: ['bush', 3], cactus_tall: ['bush', 4], agave: ['bush', 5], shrub_desert: ['bush', 6], dead_bush: ['bush', 7], tundra_shrub: ['bush', 8], banana: ['bush', 9],
  tussock: ['fibergrass', 1], dune_grass: ['fibergrass', 2], papyrus: ['fibergrass', 3],
  lichen_rock: ['boulder', 20], termite_mound: ['boulder', 21], desert_rock: ['boulder', 22],
};
// ground details with their own art (the rest of the planet's decor uses the classic kinds)
export const FLORA_DECOR = new Set(['snowtuft', 'lichen', 'cottongrass', 'saltcrust', 'seaweed', 'coral', 'ash', 'sandripple', 'savgrass', 'jungleplant',
  'pneumato', 'crackedmud']);

// the classic object (type, v) of a planet object (type, v); null = not a natural kind of the game
export function floraObject(type, v) {
  const fk = FLORA_KIND[type];
  if (!fk) return null;
  const [kind, sp] = fk;
  return { type: kind, v: kind.startsWith('tree_') ? sp * 16 + (v & 15) : sp * 1000 + (v % 1000) };
}

// species v for a regrown classic `kind` on a tile of planet biome `b` (r: one roll 0..1): a planet species of that
// kind from the biome's tables, undefined = keep the classic species
export function regrowV(kind, b, r, v) {
  const bm = BIOME_LIST[b];
  if (!bm) return undefined;
  const tab = kind.startsWith('tree_') ? bm.t : bm.b;
  if (!tab) return undefined;
  const sub = {};
  let any = false, classic = 0;
  for (const k in tab) {
    const fk = FLORA_KIND[k];
    if (fk && fk[0] === kind) { sub[k] = tab[k]; any = true; } else if (k === kind) classic += tab[k];
  }
  if (!any) return undefined;
  if (classic) sub[kind] = classic;
  const pick = pickWeighted(sub, r);
  if (pick === kind) return undefined;
  return floraObject(pick, v).v;
}
