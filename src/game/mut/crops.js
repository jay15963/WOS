// Crops on farm plots: every shared change. Growth is a HOST clock (growCrops, 1 Hz); peers only see the
// stage changes (crop.stage). Ops: crop.add · crop.stage · crop.remove. Intents: farm.plant · farm.harvest.

import { defineIntent, defineOp } from '../../net/registry.js';
import { addLootRows } from './loot.js';
import { lootRows, ri } from './roll.js';
import { DAY_LENGTH } from '../calendar.js';

// grow: seconds of world time to ripen — one in-game day (calendar: 13 min), faster in the rain, never in winter
export const CROPS = {
  potato: { name: 'Batata', seed: 'seed_potato', grow: DAY_LENGTH, yield: [['potato', 3, 4], ['seed_potato', 1, 2]] },
  corn:   { name: 'Milho', seed: 'seed_corn', grow: DAY_LENGTH, yield: [['corn', 2, 3], ['seed_corn', 1, 2]] },
  cotton: { name: 'Algodão', seed: 'seed_cotton', grow: DAY_LENGTH, yield: [['cotton', 3, 4], ['seed_cotton', 1, 2]] },
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
  args: { tx: 'int', ty: 'int', kind: "'potato'|'corn'|'cotton'", growth: '0..1', at: 'worldTime', by: 'pid', xp: 'number' },
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

// ---------- authority ----------
// growth tick (1 Hz on the authority): stage changes are broadcast
export function growCrops(game) {
  const net = game.net;
  const rain = game.env.env?.rain || 0;
  const mult = game.season?.id === 'winter' ? 0 : 1 + (rain > 0.2 ? 0.5 : 0); // winter: the crops stop growing
  const now = game.worldTime;
  for (const c of game.farm.crops.values()) {
    const el = Math.max(0, now - (c.lastT ?? now));
    c.lastT = now;
    if (c.growth >= 1) continue;
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
