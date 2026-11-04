// Crops on farm plots: every shared change. Growth is a HOST clock (growCrops, 1 Hz); peers only see the
// stage changes (crop.stage). Ops: crop.add · crop.stage · crop.remove. Intents: farm.plant · farm.harvest.

import { defineIntent, defineOp } from '../../net/registry.js';
import { addLootRows } from './loot.js';
import { lootRows, ri } from './roll.js';
import { fertileAt } from '../../world/soil.js';
import { seasonAt } from '../seasons.js';

// grow: seconds of world time to ripen — 8 minutes for every crop (owner), faster in the rain, never in winter.
// yield rows [item, min, max]: one plot gives little (docs/LIVESTOCK.md "Plantações": the old 3-4 potatoes per plot
// were far too much); the seed row gives the seed back with a small surplus, so a field grows slowly.
// fertile: only on fertile soil (src/world/soil.js: within 5 tiles of a river)
export const CROP_GROW_S = 8 * 60;
export const CROPS = {
  potato: { name: 'Batata', seed: 'seed_potato', grow: CROP_GROW_S, yield: [['potato', 1, 2], ['seed_potato', 1, 2]] },
  corn:   { name: 'Milho', seed: 'seed_corn', grow: CROP_GROW_S, yield: [['corn', 1, 2], ['seed_corn', 1, 2]] },
  cotton: { name: 'Algodão', seed: 'seed_cotton', grow: CROP_GROW_S, yield: [['cotton', 2, 3], ['seed_cotton', 1, 2]] },
  wheat:  { name: 'Trigo', seed: 'seed_wheat', grow: CROP_GROW_S, fertile: true, yield: [['wheat', 2, 3], ['seed_wheat', 1, 2]] },
};
export const stageOf = (g) => (g >= 1 ? 3 : g >= 0.62 ? 2 : g >= 0.28 ? 1 : 0);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function cropAt(game, tx, ty) {
  return game.world.inBounds(tx, ty) ? game.farm.crops.get(game.world.idx(tx, ty)) || null : null;
}

// ---------- helpers (appliers / snapshot only) ----------
export function plantCrop(game, kind, tx, ty, growth = 0, lastT = game.worldTime) {
  const o = { id: 'c' + tx + '_' + ty, type: 'crop', kind, tx, ty, x: tx + 0.5, y: ty + 0.72, s: 1, f: (tx * 7 + ty) % 2 ? 1 : -1, v: 0, growth, stage: 0, lastT };
  o.stage = stageOf(growth);
  game.world.addObject(o);
  game.farm.crops.set(game.world.idx(tx, ty), o);
  game.events.emit('tile', { tx, ty });
  return o;
}

export function removeCrop(game, c) {
  game.world.removeObject(c);
  game.farm.crops.delete(game.world.idx(c.tx, c.ty));
  c.gone = true;
  game.events.emit('tile', { tx: c.tx, ty: c.ty });
}

export function removeCropAt(game, tx, ty) {
  const c = cropAt(game, tx, ty);
  if (c) removeCrop(game, c);
}

const plotAt = (game, tx, ty) => {
  if (!game.world.inBounds(tx, ty)) return null;
  const p = game.build.grid.floor.get(game.world.idx(tx, ty));
  return p && p.type === 'farm_plot' && !p.blueprint ? p : null;
};

// ---------- ops ----------
defineOp('crop.add', {
  doc: 'A seed is planted on a farm plot (absolute host time `at` starts its growth clock).',
  args: { tx: 'int', ty: 'int', kind: "'potato'|'corn'|'cotton'|'wheat'", growth: '0..1', at: 'worldTime', by: 'pid', xp: 'number' },
  apply(game, a) {
    if (!CROPS[a.kind] || cropAt(game, a.tx, a.ty)) return;
    plantCrop(game, a.kind, a.tx, a.ty, a.growth || 0, a.at);
    game.juice.puff(a.tx + 0.5, a.ty + 0.7, 4, [0.45, 0.35, 0.22], 0.4);
    game.audio?.play('pickup', { x: a.tx + 0.5, y: a.ty + 0.5, volume: 0.5 });
  },
});

defineOp('crop.stage', {
  doc: 'A crop reached a new growth stage (host clock).',
  args: { tx: 'int', ty: 'int', stage: '0..3', growth: '0..1' },
  apply(game, a) {
    const c = cropAt(game, a.tx, a.ty);
    if (!c) return;
    c.stage = a.stage; c.growth = a.growth;
    game.events.emit('tile', { tx: c.tx, ty: c.ty });
  },
});

defineOp('crop.remove', {
  doc: 'A crop is harvested (drops) or destroyed (plot removed / built over).',
  args: { tx: 'int', ty: 'int', drops: 'lootRows?', by: 'pid?', xp: 'number?' },
  apply(game, a) {
    const c = cropAt(game, a.tx, a.ty);
    if (!c) return;
    if (a.drops) { game.juice.leaves(c.x, c.y, 5, 0.5); game.audio?.play('pickup', { x: c.x, y: c.y }); }
    removeCrop(game, c);
    addLootRows(game, a.drops);
  },
});

// ---------- where crops grow (seasons by latitude, the planet's climate) ----------
// HOT / DRY ground (owner: "na zona quente não cresce plantação, no máximo … chão fértil ao redor de rios igual … o rio
// Nilo"): the warm zone, deserts / badlands / salt, the dry savanna (< 650 mm of rain a year), the semi-arid steppe and
// scrub (< 450 mm). There crops grow only on the fertile soil the water brings (world `fertile`: the green strips the
// planet lays along rivers, around lakes and oases, docs/PLANET.md) and slower (HOT_K); on any other soil they refuse.
export const HOT_K = 0.6;
const ARID = new Set(['desert_dunes', 'desert_rocky', 'badlands', 'cold_desert', 'salt_flat']);
const CLIM = {};
export function hotDryAt(world, tx, ty) {
  const z = world.zoneAt ? world.zoneAt(tx, ty) : 2;
  if (z === 1) return true;
  const keys = world.source?.biomeKeys;
  if (!keys || !world.inBounds(tx, ty)) return false;
  const k = keys[world.pbiome.get(world.idx(tx, ty))];
  if (ARID.has(k)) return true;
  if (k !== 'savanna' && k !== 'steppe' && k !== 'mediterranean' && k !== 'floodplain' && k !== 'tropical_dry') return false;
  const P = world.source.climateAt(tx + 0.5, ty + 0.5, 0, CLIM).P;
  return P < (k === 'savanna' || k === 'tropical_dry' ? 650 : 450);
}
// why a seed cannot be planted on tile (tx, ty) — null: it can (wheat: fertile soil only, everywhere)
export function plantProblem(game, kind, tx, ty) {
  const w = game.world;
  if (w.zoneAt && w.zoneAt(tx, ty) === 4) return 'Frio demais: nada cresce aqui fora (região polar)';
  const fert = fertileAt(w, tx, ty);
  if (!fert && hotDryAt(w, tx, ty)) return 'Solo seco: só perto de rios';
  if (CROPS[kind]?.fertile && !fert) return 'Solo não fértil: o trigo só cresce até 5 tiles de um rio';
  return null;
}
// how fast crops grow in a season state (seasons by latitude: the crop's own zone, altitude included): a hard winter
// (temperate winter, the long subpolar one, polar all year) stops them; a mild winter halves them; the tropical dry
// season slows them a little; tropical humid crops grow all year at full speed. hot: the crop stands on hot / dry
// ground (the fertile strip: HOT_K; elsewhere it does not grow)
export const cropK = (S, hot = false, fert = true) => (S.hard || (hot && !fert) ? 0 : (S.id === 'winter' ? 0.5 : S.zone === 0 && !S.wet ? 0.8 : 1) * (hot ? HOT_K : 1));
// what the player sees about a crop's growth there ('' = normal)
export function growNote(game, tx, ty) {
  const S = seasonAt(game, tx + 0.5, ty + 0.5), hot = hotDryAt(game.world, tx, ty), fert = fertileAt(game.world, tx, ty);
  if (S.hard) return S.zone === 4 ? 'Não cresce: frio polar' : 'Parado: inverno';
  if (hot && !fert) return 'Não cresce: solo seco';
  if (hot) return 'Crescimento lento: calor';
  if (S.id === 'winter') return 'Crescimento lento: inverno ameno';
  if (S.zone === 0 && !S.wet) return 'Crescimento lento: estação seca';
  return '';
}
// growth tick (1 Hz on the authority): stage changes are broadcast
export function growCrops(game) {
  const net = game.net;
  const rain = game.env.env?.rain || 0;
  const now = game.worldTime;
  for (const c of game.farm.crops.values()) {
    const el = Math.max(0, now - (c.lastT ?? now));
    c.lastT = now;
    if (c.growth >= 1) continue;
    // the season where the crop is (seasons by latitude): a hard winter stops it, a mild one slows it, the tropical dry
    // season slows it a little
    const S = seasonAt(game, c.tx + 0.5, c.ty + 0.5);
    if (c._hot == null) { c._hot = hotDryAt(game.world, c.tx, c.ty); c._fert = fertileAt(game.world, c.tx, c.ty); } // (static per tile)
    const mult = cropK(S, c._hot, c._fert) * (1 + (rain > 0.2 ? 0.5 : 0));
    const g = Math.min(1, c.growth + (el * mult) / CROPS[c.kind].grow);
    c.growth = g; // continuous value lives on the authority; peers get it on stage changes
    const st = stageOf(g);
    if (st !== c.stage) net.emit('crop.stage', { tx: c.tx, ty: c.ty, stage: st, growth: +g.toFixed(3) });
  }
}

defineIntent('farm.plant', {
  doc: 'Plant a seed (already removed from the actor; refunded on reject) on an empty completed farm plot.',
  args: { tx: 'int', ty: 'int', seed: 'seed item id' },
  run(game, a, actor, net) {
    const tx = num(a.tx) | 0, ty = num(a.ty) | 0;
    const kind = Object.keys(CROPS).find((k) => CROPS[k].seed === a.seed);
    if (!kind) return 'Semente desconhecida';
    if (!plotAt(game, tx, ty)) return 'Sem canteiro aqui';
    if (cropAt(game, tx, ty)) return 'Já plantado';
    const why = plantProblem(game, kind, tx, ty);
    if (why) return why;
    net.emit('crop.add', { tx, ty, kind, growth: 0, at: Math.round(game.worldTime), by: actor.pid, xp: 1 });
  },
});

defineIntent('farm.harvest', {
  doc: 'Harvest a ripe crop (stage 3): food / cotton + seeds dropped.',
  args: { tx: 'int', ty: 'int' },
  run(game, a, actor, net) {
    const c = cropAt(game, num(a.tx) | 0, num(a.ty) | 0);
    if (!c) return 'Já foi colhido';
    if (c.stage < 3) return 'Ainda não está pronto';
    const rows = [];
    for (const [id, lo, hi] of CROPS[c.kind].yield) lootRows(net, rows, c.x, c.y - 0.2, id, ri(net, lo, hi), 0.6);
    net.emit('crop.remove', { tx: c.tx, ty: c.ty, drops: rows, by: actor.pid, xp: 4 });
  },
});
