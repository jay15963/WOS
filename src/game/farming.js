// Farming: build a farm_plot (canteiro), plant seeds, crops grow over in-game time (rain speeds it
// up), harvest at stage 3 -> food / cotton + seeds. Crop object (drawn by the art as crop_<kind>_<stage>):
//   { type: 'crop', kind: 'potato'|'cotton'|'corn', stage: 0..3, growth: 0..1, tx, ty, x, y }
// Multiplayer: planting / harvesting are intents and growth is the host's clock (mut/crops.js).

import { ITEMS, SEED_IDS } from './content/items.js';
import { registerWork } from './gathering.js';
import { CROPS, cropAt, growCrops } from './mut/crops.js';

export { CROPS, cropAt };

export function initFarming(game) {
  game.farm = { crops: new Map(), describePlot }; // tile idx -> crop
}

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
    game.events.emit('inventory', {});
    game.net.request('farm.plant', { tx: it.tx, ty: it.ty, seed }, { refund: { [seed]: 1 } });
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
    if (!cropAt(game, it.tx, it.ty)) return true;
    game.net.request('farm.harvest', { tx: it.tx, ty: it.ty });
    game.work?.queueHarvestNear(it.tx, it.ty);
    return true;
  },
});

export function farmingSystem() {
  let t = 0;
  return {
    sync: 'host', // crop growth is the host's clock; peers get crop.stage ops
    update(game, dt) {
      t -= dt;
      if (t > 0) return;
      t = 1;
      growCrops(game);
    },
  };
}
