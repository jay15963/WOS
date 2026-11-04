// Farming: build a farm_plot (canteiro), plant seeds, crops grow over in-game time (rain speeds it
// up), harvest at stage 3 -> food / cotton + seeds. Crop object (drawn by the art as crop_<kind>_<stage>):
//   { type: 'crop', kind: 'potato'|'cotton'|'corn', stage: 0..3, growth: 0..1, tx, ty, x, y }
// Multiplayer: planting / harvesting are intents and growth is the host's clock (mut/crops.js).

import { ITEMS, SEED_IDS } from './content/items.js';
import { registerWork } from './gathering.js';
import { CROPS, cropAt, growCrops, plantProblem, growNote } from './mut/crops.js';
import { fertileAt } from '../world/soil.js';

export { CROPS, cropAt };

export function initFarming(game) {
  game.farm = { crops: new Map(), describePlot }; // tile idx -> crop
}

// can this seed grow on that tile (wheat: fertile soil only, src/world/soil.js; hot / dry land: only the fertile strips
// along the water; polar land: nothing — mut/crops.js plantProblem)
export const seedGrowsAt = (game, seed, tx, ty) => !plantProblem(game, ITEMS[seed]?.seed, tx, ty);
void fertileAt;

// seed to plant: the player's preference if owned, else the first seed in the backpack; with a tile, one that grows there
// (wheat needs fertile soil) — else the first owned one (the plot then says "Solo não fértil")
export function seedToPlant(p, game = null, tx = 0, ty = 0) {
  const own = (id) => id && p.inv.count(id) > 0;
  if (!game) return own(p.seedPref) ? p.seedPref : SEED_IDS.find(own) || null;
  const ok = (id) => own(id) && seedGrowsAt(game, id, tx, ty);
  if (ok(p.seedPref)) return p.seedPref;
  return SEED_IDS.find(ok) || (own(p.seedPref) ? p.seedPref : SEED_IDS.find(own)) || null;
}

function describePlot(game, plot) {
  if (plot.blueprint) return null;
  const c = cropAt(game, plot.tx, plot.ty);
  const base = { o: plot, tile: true, tx: plot.tx, ty: plot.ty, w: 1, h: 1, x: plot.tx + 0.5, y: plot.ty + 0.5, reach: 0.6 };
  if (c) {
    if (c.stage >= 3) return { ...base, kind: 'harvest', crop: c, verb: `Colher ${CROPS[c.kind].name.toLowerCase()}`, icon: 'gather', prio: 4 };
    // growing: say so when the place slows it down (heat, a mild winter, the dry season) or stops it
    const note = growNote(game, plot.tx, plot.ty);
    return note ? { ...base, kind: 'crop_info', crop: c, verb: note, note, icon: 'gather', prio: -1, bad: true } : null;
  }
  const seed = seedToPlant(game.player, game, plot.tx, plot.ty);
  if (!seed) return { ...base, kind: 'plant', verb: 'Plantar', icon: 'gather', prio: -1 };
  // wheat off the fertile soil / dry hot land / polar cold: the use button says why (and the overlay rings the plot red)
  const why = plantProblem(game, ITEMS[seed].seed, plot.tx, plot.ty);
  if (why) return { ...base, kind: 'plant', seed, bad: true, verb: why.split(':')[0], why, icon: 'gather', prio: 1 };
  return { ...base, kind: 'plant', seed, verb: `Plantar ${CROPS[ITEMS[seed].seed].name.toLowerCase()}`, icon: 'gather', prio: 2 };
}

registerWork('plant', {
  valid: (g, it) => !it.o.removed && !cropAt(g, it.tx, it.ty),
  start(game, it) {
    const seed = seedToPlant(game.player, game, it.tx, it.ty);
    if (!seed) { game.events.emit('error', { text: 'Sem sementes. Colha plantas silvestres.' }); return null; }
    const why = plantProblem(game, ITEMS[seed].seed, it.tx, it.ty);
    if (why) { game.events.emit('error', { text: why }); return null; }
    it.seed = seed;
    return { type: 'plant', cycle: 0.9, need: 1, label: 'Plantando' };
  },
  finish(game, wk) {
    const it = wk.it, p = game.player;
    const seed = seedToPlant(p, game, it.tx, it.ty);
    if (!seed || !seedGrowsAt(game, seed, it.tx, it.ty) || !p.inv.remove(seed, 1)) return true;
    game.events.emit('inventory', {});
    game.net.request('farm.plant', { tx: it.tx, ty: it.ty, seed }, { refund: { [seed]: 1 } });
    // keep planting the neighbouring empty plots
    game.work?.queuePlantNear(it.tx, it.ty);
    return true;
  },
});

// a growing crop slowed / stopped by its place: the button only explains
registerWork('crop_info', {
  valid: () => false,
  start(game, it) { game.events.emit('toast', { text: `${it.note}${/calor|seco/.test(it.note) ? ' — em terra quente e seca só o solo fértil perto da água dá colheita, e mais devagar' : ''}`, kind: 'info' }); return null; },
});

registerWork('harvest', {
  valid: (g, it) => { const c = cropAt(g, it.tx, it.ty); return !!c && c.stage >= 3; },
  start: () => ({ type: 'harvest', cycle: 1.0, need: 1, label: 'Colhendo' }),
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
