// Procedural sprite art (RimWorld-like visual language), drawn with Canvas2D at PPU px per tile
// (supersampled 2× then downscaled) and packed into one atlas.
// CONTRACT: sprite names listed in docs/ARCHITECTURE.md (extra variants/names are additive).
//
// Modules: paint.js (helpers), foliage.js (leaf masses), trees.js, plants.js, rocks.js, pawns.js,
// animals.js, buildings.js (+ items), icons.js, fx.js. Animation/composition lives in compose.js.
// Art B (characters & items): kit.js (shape helpers), creatures.js (spider), gear.js (held tools/weapons/shields,
// projectiles), apparel.js (wear overlays, bandit extras), items.js (item icons).

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
import { addCreatures } from './creatures.js';
import { addGear } from './gear.js';
import { addApparel } from './apparel.js';
import { addItems } from './items.js';
import { addArch } from './arch.js';
import { addDecor } from './decor.js';
import { addLook } from './look/index.js';
import { addCorpses } from './corpses.js';
import { CONTRACT } from './contract.js';

export { PPU, CONTRACT };

// opts.fail: name of a painter group that must throw (tests of the poisoned-cache rule, ?fakepaintfail=1)
export function buildAtlas(opts = {}) {
  const A = new Atlas(4096);
  const pending = [];
  const names = new Set();
  const add = (name, c, ax = 0.5, ay = 1) => {
    if (names.has(name)) console.warn('[art] duplicate sprite', name);
    names.add(name);
    pending.push({ name, c, ax, ay });
  };
  // Each group is isolated: a failure in one painter must never break boot — but it is RECORDED
  // (A.failures): an atlas with failures or placeholders is never cached and refuses multiplayer.
  const failures = [];
  const steps = [addFx, addTrees, addPlants, addRocks, addPawns, addAnimals, addBuildings, addIcons, addStructures, addStations, addCrops, addNatural,
    addCreatures, addGear, addApparel, addItems, addLook, addCorpses, addArch, addDecor];
  for (const step of steps) {
    try { if (opts.fail === step.name) throw new Error('falha simulada'); step(add); } catch (e) { console.error('[art] ' + step.name + ' failed', e); failures.push(`${step.name}: ${e?.message || e}`); }
  }
  try { addLegacyItems(add, (n) => names.has(n)); } catch (e) { console.error('[art] legacy items failed', e); failures.push(`addLegacyItems: ${e?.message || e}`); }
  const placeholders = ensureContract(names, add);
  // crop padded canvases to content (single readback), convert anchors, then pack
  let canv;
  try { canv = cropAll(pending.map((p) => p.c)); } catch (e) { console.error('[art] crop failed', e); failures.push(`cropAll: ${e?.message || e}`); canv = pending.map((p) => p.c); }
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i], c = canv[i];
    const [x, y] = anchorOf(c, p.ax, p.ay);
    A.add(p.name, c, x, y, PPU);
  }
  clearPool();
  A.pack();
  A.failures = failures;
  A.placeholders = placeholders;
  return A;
}

// Fallback sprites for any contract name that failed to draw (keeps the game booting). Every placeholder is
// recorded in A.placeholders: such an atlas is never cached and refuses multiplayer.
function ensureContract(names, add) {
  const out = [];
  for (const name of CONTRACT) {
    if (names.has(name)) continue;
    console.warn('[art] missing sprite, using placeholder:', name);
    out.push(name);
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#c040c0'; g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2); g.fill();
    add(name, c, 0.5, 0.9);
  }
  return out;
}
