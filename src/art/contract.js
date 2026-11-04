// Sprite contract: names the game relies on (docs/ARCHITECTURE.md). A contract name that a painter failed
// to produce gets a magenta placeholder in buildAtlas(); an atlas with placeholders is never cached and
// refuses multiplayer. Pure data (no imports): tools/check-sync.mjs (R12) imports it in node.
// Every creature species (non-pawn) needs <sp>_{s,n,e}; every structure / flora / crop kind one name.

export const CREATURE_SPECIES = ['wolf', 'boar', 'deer', 'rabbit', 'bear', 'fox', 'spider', 'cow', 'sheep', 'pig', 'chicken', 'fish'];
// wild fauna of the planet's biomes (docs/FAUNA.md, art/fauna.js): baked standing e / s / n each
export const FAUNA_SPECIES = ['polar_bear', 'seal', 'arctic_fox', 'moose', 'reindeer', 'lynx', 'wild_horse', 'horse', 'bison', 'yak', 'camel', 'scorpion', 'rattlesnake',
  'vulture', 'zebra', 'gazelle', 'lion', 'elephant', 'monkey', 'jaguar', 'parrot', 'crocodile', 'heron', 'mountain_goat', 'eagle', 'crab', 'seagull',
  'dolphin', 'shark', 'whale'];

export const CONTRACT = [
  'fx_blob', 'fx_soft', 'fx_spark', 'fx_smoke', 'fx_leaf', 'fx_drop', 'fx_ring', 'fx_flame', 'fx_splash', 'fx_dust', 'fx_slash', 'fx_star',
  'tree_oak_0', 'tree_pine_0', 'tree_birch_0', 'tree_dead_0', 'tree_stump_0', 'tree_sapling_0',
  'bush_0', 'berrybush_0', 'berrybush_empty_0', 'herbbush_0', 'grass_0', 'tallgrass_0', 'reed_0', 'flower_0', 'mushroom_0', 'boulder_0',
  'pawn_body_s', 'pawn_body_n', 'pawn_body_e', 'pawn_head_s', 'pawn_head_n', 'pawn_head_e',
  'hair_short_s', 'hair_short_n', 'hair_short_e', 'hair_long_s', 'hair_long_n', 'hair_long_e',
  'weapon_sword', 'weapon_axe', 'tool_pickaxe',
  ...CREATURE_SPECIES.flatMap((s) => [s + '_s', s + '_n', s + '_e']),
  ...FAUNA_SPECIES.flatMap((s) => [s + '_s', s + '_n', s + '_e']),
  'proj_arrow', 'proj_spear',
  'campfire', 'torch', 'wall_wood', 'chest', 'bed',
  'stairs_wood', // levels (agent L)
  // world expansion (Art A): one per group is enough for composeWorld's fallbacks
  'wall_stone', 'fence_wood', 'floor_wood', 'floor_stone', 'farm_plot', 'door_wood_h', 'door_wood_v', 'gate_wood_h', 'gate_wood_v',
  'workbench', 'stonecutter', 'furnace', 'anvil', 'loom', 'cooking_pot', 'table_wood', 'chair_wood', 'rug_0', 'flower_pot_0',
  'banner_0', 'brazier', 'lamp_post', 'tent_0', 'crate_0', 'pebble_0', 'stick_0', 'fibergrass_0', 'wild_potato_0', 'wild_cotton_0', 'wild_corn_0',
  'crop_potato_0', 'crop_cotton_0', 'crop_corn_0',
  // roofs (agent J): build-menu icons of the roof types + columns (roofs are painted per region at runtime)
  'roof_thatch', 'roof_wood', 'roof_stone', 'column_wood', 'column_stone', 'fx_solid', 'fx_solid_b',
  'item_wood', 'item_stone', 'item_berries', 'item_meat', 'item_cooked', 'item_leather', 'item_fiber', 'item_ore',
  'icon_strike', 'icon_charge', 'icon_whirlwind', 'icon_heal', 'icon_sprint', 'icon_attack', 'icon_eat', 'icon_build', 'icon_bag', 'icon_gather',
  // corpses (I): skeletons, carcasses, rot, fly, bone item
  'corpse_skel_s', 'corpse_skel_m', 'corpse_skel_l', 'corpse_skel_pawn', 'corpse_carcass_s', 'corpse_carcass_m', 'corpse_carcass_l', 'corpse_rot_0', 'fx_fly', 'item_bone',
  // agent K: stone wall / hedge (baked default look; src/art/arch.js)
  'fence_stone', 'hedge',
  // piers / bridges (src/art/decks.js): build-menu icons + the textures of the procedural pieces (art/faces/deck.js)
  'pier_wood', 'bridge_wood', 'deck_planks_0', 'deck_planks_1', 'deck_planks_2', 'deck_wood', 'deck_log', 'deck_stone', 'deck_rope', 'deck_snow',
  // livestock (docs/LIVESTOCK.md, art/livestock.js): the feeder, wheat, the young, swimming fish, rope / bobber
  'feeder', 'crop_wheat_0', 'wild_wheat_0', 'fish_top', 'fx_rope', 'fx_bobber', 'held_rod_wood',
];

// agent K: building kinds whose art is painted lazily (art/lazyDefs.js, shared lazy texture) — never baked, never in the
// atlas digest; checkAtlas (game/artcheck.js) requires a registered lazy painter for each, tools/check-sync.mjs R12 accepts them.
export const LAZY_KINDS = [
  'shelf_wood', 'bookshelf', 'wardrobe', 'dresser', 'bench_wood', 'stool', 'chair_fine', 'table_round', 'table_small', 'barrel', 'crates',
  'sacks', 'jars', 'candles', 'candelabra', 'herbs_hang', 'curtain', 'plant_pot_0', 'rug_round', 'rug_fur', 'painting', 'trophy', 'pot_hooks', 'weapon_rack',
  'armor_stand', 'fireplace', 'washtub', 'training_dummy', 'lamp_stone', 'lamp_wood', 'flower_bed_0', 'planter', 'stepping_0', 'well', 'signpost', 'bench_stone',
  'garden_arch', 'statue_0', 'totem', 'woodpile', 'haystack', 'cart', 'scarecrow', 'birdhouse', 'beehive', 'drying_rack', 'notice_board', 'fountain', 'pergola',
  'ballista', // (defense: art/faces/solidDefense.js)
  'boat', // (the rowboat: art/faces/solidBoat.js)
  'siege_workshop', 'trebuchet', 'catapult', 'battering_ram', 'siege_tower', // (siege engines: art/faces/solidSiege.js)
  'gate_big_wood', 'gate_stone', 'town_mural', // (the kingdoms: art/faces/gates.js)
];

// does `names` (Set or Map-like with has) hold art for a kind: exact, _0, _h or any _<n> variant
export function hasKindArt(names, kind) {
  if (names.has(kind) || names.has(kind + '_0') || names.has(kind + '_h')) return true;
  for (let i = 1; i < 16; i++) if (names.has(kind + '_' + i)) return true;
  return false;
}

// FNV-1a over the sorted sprite names: identical for two clients with equivalent atlases (pixel sizes may
// differ by a pixel between browsers, names may not). Sent in the multiplayer handshake.
export function atlasDigest(names) {
  let h = 2166136261 >>> 0;
  for (const n of [...names].sort()) {
    for (let i = 0; i < n.length; i++) { h ^= n.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 10; h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
