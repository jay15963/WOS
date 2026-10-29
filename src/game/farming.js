// Farming: build a farm_plot (canteiro), plant seeds, crops grow over in-game time (rain speeds it
// up), harvest at stage 3 -> food / cotton + seeds. Crop object (drawn by the art as crop_<kind>_<stage>):
//   { type: 'crop', kind: 'potato'|'cotton'|'corn', stage: 0..3, growth: 0..1, tx, ty, x, y }

import { ITEMS, SEED_IDS } from './content/items.js';
import { registerWork } from './gathering.js';
import { dropLoot } from './loot.js';
import { gainXp } from './player.js';
import { structureAt } from './autotile.js';

export const CROPS = {
  potato: { name: 'Batata', seed: 'seed_potato', grow: 720, yield: [['potato', 3, 4], ['seed_potato', 1, 2]] },
  corn:   { name: 'Milho', seed: 'seed_corn', grow: 900, yield: [['corn', 2, 3], ['seed_corn', 1, 2]] },
  cotton: { name: 'Algodão', seed: 'seed_cotton', grow: 800, yield: [['cotton', 3, 4], ['seed_cotton', 1, 2]] },
};
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function initFarming(game) {
  const F = game.farm = {
    crops: new Map(), // tile idx -> crop
    removeCropAt(tx, ty) { const c = F.crops.get(game.world.idx(tx, ty)); if (c) removeCrop(game, c); },
    removeCrop: (c) => removeCrop(game, c),
    describePlot,
  };
}

export function cropAt(game, tx, ty) { return game.farm.crops.get(game.world.idx(tx, ty)) || null; }

export function plantCrop(game, kind, tx, ty, growth = 0) {
  const o = { id: 'c' + tx + '_' + ty, type: 'crop', kind, tx, ty, x: tx + 0.5, y: ty + 0.72, s: 1, f: (tx * 7 + ty) % 2 ? 1 : -1, v: 0, growth, stage: 0, lastT: game.worldTime };
  o.stage = stageOf(growth);
  game.world.addObject(o);
  game.farm.crops.set(game.world.idx(tx, ty), o);
  return o;
}

function removeCrop(game, c) {
  game.world.removeObject(c);
  game.farm.crops.delete(game.world.idx(c.tx, c.ty));
  c.gone = true;
}

const stageOf = (g) => (g >= 1 ? 3 : g >= 0.62 ? 2 : g >= 0.28 ? 1 : 0);

// seed to plant: the player's preference if owned, else the first seed in the backpack
export function seedToPlant(p) {
  if (p.seedPref && p.inv.count(p.seedPref) > 0) return p.seedPref;
  return SEED_IDS.find((id) => p.inv.count(id) > 0) || null;
}

function describePlot(game, plot) {
  if (plot.blueprint) return null;
  const c = cropAt(game, plot.tx, plot.ty);
  const base = { o: plot, tile: true, tx: plot.tx, ty: plot.ty, w: 1, h: 1, x: plot.tx + 0.5, y: plot.ty + 0.5, reach: 0.6 };
  if (c) {
    if (c.stage >= 3) return { ...base, kind: 'harvest', crop: c, verb: `Colher ${CROPS[c.kind].name.toLowerCase()}`, icon: 'gather', prio: 4 };
    return null;
  }
  const seed = seedToPlant(game.player);
  if (!seed) return { ...base, kind: 'plant', verb: 'Plantar', icon: 'gather', prio: -1 };
  return { ...base, kind: 'plant', seed, verb: `Plantar ${CROPS[ITEMS[seed].seed].name.toLowerCase()}`, icon: 'gather', prio: 2 };
}

registerWork('plant', {
  valid: (g, it) => !it.o.removed && !cropAt(g, it.tx, it.ty),
  start(game, it) {
    const seed = seedToPlant(game.player);
    if (!seed) { game.events.emit('error', { text: 'Sem sementes. Colha plantas silvestres.' }); return null; }
    it.seed = seed;
    return { type: 'gather', cycle: 0.9, need: 1, label: 'Plantando' };
  },
  finish(game, wk) {
    const it = wk.it, p = game.player;
    const seed = seedToPlant(p);
    if (!seed || !p.inv.remove(seed, 1)) return true;
    plantCrop(game, ITEMS[seed].seed, it.tx, it.ty, 0);
    game.events.emit('inventory', {});
    game.juice.puff(it.tx + 0.5, it.ty + 0.7, 4, [0.45, 0.35, 0.22], 0.4);
    game.audio?.play('pickup', { x: it.tx + 0.5, y: it.ty + 0.5, volume: 0.5 });
    gainXp(game, 1);
    // keep planting the neighbouring empty plots
    game.work?.queuePlantNear(it.tx, it.ty);
    return true;
  },
});

registerWork('harvest', {
  valid: (g, it) => { const c = cropAt(g, it.tx, it.ty); return !!c && c.stage >= 3; },
  start: () => ({ type: 'gather', cycle: 1.0, need: 1, label: 'Colhendo' }),
  finish(game, wk) {
    const it = wk.it;
    const c = cropAt(game, it.tx, it.ty);
    if (!c) return true;
    for (const [id, a, b] of CROPS[c.kind].yield) {
      const n = ri(a, b);
      for (let k = 0; k < n; k++) dropLoot(game, c.x, c.y - 0.2, id, 1, 0.6);
    }
    game.juice.leaves(c.x, c.y, 5, 0.5);
    game.audio?.play('pickup', { x: c.x, y: c.y });
    removeCrop(game, c);
    gainXp(game, 4);
    game.work?.queueHarvestNear(it.tx, it.ty);
    return true;
  },
});

export function farmingSystem() {
  let t = 0;
  return {
    update(game, dt) {
      t -= dt;
      if (t > 0) return;
      t = 1;
      const rain = game.env.env?.rain || 0;
      const mult = 1 + (rain > 0.2 ? 0.5 : 0);
      const now = game.worldTime;
      for (const c of game.farm.crops.values()) {
        const el = Math.max(0, now - (c.lastT ?? now));
        c.lastT = now;
        if (c.growth >= 1) continue;
        c.growth = Math.min(1, c.growth + (el * mult) / CROPS[c.kind].grow);
        const st = stageOf(c.growth);
        if (st !== c.stage) { c.stage = st; game.events.emit('tile', { tx: c.tx, ty: c.ty }); }
      }
    },
  };
}

export function saveCrops(game) {
  return [...game.farm.crops.values()].map((c) => [c.kind, c.tx, c.ty, +c.growth.toFixed(3)]);
}

export function loadCrops(game, arr) {
  for (const [kind, tx, ty, growth] of arr || []) {
    if (!CROPS[kind]) continue;
    const plot = structureAt(game, tx, ty, 'floor');
    if (!plot || plot.type !== 'farm_plot') continue;
    plantCrop(game, kind, tx, ty, growth || 0);
  }
}
