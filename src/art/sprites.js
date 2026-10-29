// Procedural sprite art (RimWorld-like visual language), drawn with Canvas2D at PPU px per tile
// (supersampled 2× then downscaled) and packed into one atlas.
// CONTRACT: sprite names listed in docs/ARCHITECTURE.md (extra variants/names are additive).
//
// Modules: paint.js (helpers), foliage.js (leaf masses), trees.js, plants.js, rocks.js, pawns.js,
// animals.js, buildings.js (+ items), icons.js, fx.js. Animation/composition lives in compose.js.

import { Atlas } from '../engine/atlas.js';
import { PPU, clearPool, anchorOf, cropAll } from './paint.js';
import { addFx } from './fx.js';
import { addTrees } from './trees.js';
import { addPlants } from './plants.js';
import { addRocks } from './rocks.js';
import { addPawns } from './pawns.js';
import { addAnimals } from './animals.js';
import { addBuildings, addLegacyItems } from './buildings.js';
import { addIcons } from './icons.js';
import { addStructures } from './structures.js';
import { addStations } from './stations.js';
import { addCrops } from './crops.js';
import { addNatural } from './natural.js';

export { PPU };

export function buildAtlas() {
  const A = new Atlas(4096);
  const pending = [];
  const names = new Set();
  const add = (name, c, ax = 0.5, ay = 1) => {
    if (names.has(name)) console.warn('[art] duplicate sprite', name);
    names.add(name);
    pending.push({ name, c, ax, ay });
  };
  // Each group is isolated: a failure in one painter must never break boot.
  const steps = [addFx, addTrees, addPlants, addRocks, addPawns, addAnimals, addBuildings, addIcons, addStructures, addStations, addCrops, addNatural];
  for (const step of steps) {
    try { step(add); } catch (e) { console.error('[art] ' + step.name + ' failed', e); }
  }
  try { addLegacyItems(add, (n) => names.has(n)); } catch (e) { console.error('[art] legacy items failed', e); }
  ensureContract(names, add);
  // crop padded canvases to content (single readback), convert anchors, then pack
  let canv;
  try { canv = cropAll(pending.map((p) => p.c)); } catch (e) { console.error('[art] crop failed', e); canv = pending.map((p) => p.c); }
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i], c = canv[i];
    const [x, y] = anchorOf(c, p.ax, p.ay);
    A.add(p.name, c, x, y, PPU);
  }
  clearPool();
  A.pack();
  return A;
}

// Fallback sprites for any contract name that failed to draw (keeps the game booting).
const CONTRACT = [
  'fx_blob', 'fx_soft', 'fx_spark', 'fx_smoke', 'fx_leaf', 'fx_drop', 'fx_ring', 'fx_flame', 'fx_splash', 'fx_dust', 'fx_slash', 'fx_star',
  'tree_oak_0', 'tree_pine_0', 'tree_birch_0', 'tree_dead_0', 'tree_stump_0', 'tree_sapling_0',
  'bush_0', 'berrybush_0', 'berrybush_empty_0', 'grass_0', 'tallgrass_0', 'reed_0', 'flower_0', 'mushroom_0', 'boulder_0',
  'pawn_body_s', 'pawn_body_n', 'pawn_body_e', 'pawn_head_s', 'pawn_head_n', 'pawn_head_e',
  'hair_short_s', 'hair_short_n', 'hair_short_e', 'hair_long_s', 'hair_long_n', 'hair_long_e',
  'weapon_sword', 'weapon_axe', 'tool_pickaxe',
  ...['wolf', 'boar', 'deer', 'rabbit', 'bear'].flatMap((s) => [s + '_s', s + '_n', s + '_e']),
  'campfire', 'torch', 'wall_wood', 'chest', 'bed',
  // world expansion (Art A): one per group is enough for composeWorld's fallbacks
  'wall_stone', 'fence_wood', 'floor_wood', 'floor_stone', 'farm_plot', 'door_wood_h', 'door_wood_v', 'gate_wood_h', 'gate_wood_v',
  'workbench', 'stonecutter', 'furnace', 'anvil', 'loom', 'cooking_pot', 'table_wood', 'chair_wood', 'rug_0', 'flower_pot_0',
  'banner_0', 'brazier', 'lamp_post', 'tent_0', 'crate_0', 'pebble_0', 'stick_0', 'fibergrass_0', 'wild_potato_0', 'wild_cotton_0', 'wild_corn_0',
  'crop_potato_0', 'crop_cotton_0', 'crop_corn_0',
  'item_wood', 'item_stone', 'item_berries', 'item_meat', 'item_cooked', 'item_leather', 'item_fiber', 'item_ore',
  'icon_strike', 'icon_charge', 'icon_whirlwind', 'icon_bandage', 'icon_sprint', 'icon_attack', 'icon_eat', 'icon_build', 'icon_bag', 'icon_gather',
];
function ensureContract(names, add) {
  for (const name of CONTRACT) {
    if (names.has(name)) continue;
    console.warn('[art] missing sprite, using placeholder:', name);
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#c040c0'; g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2); g.fill();
    add(name, c, 0.5, 0.9);
  }
}
