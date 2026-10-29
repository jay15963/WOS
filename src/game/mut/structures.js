// Structures (buildings, blueprints, doors, chests, stations): every shared change.
// Ops: struct.add · struct.progress · struct.complete · struct.remove · struct.decon · struct.working · chest.set
// Intents: build.place · build.hit · build.decon · decon.hit · chest.put · chest.take · station.work
// Refunds / yields are computed by the authority and travel as owner effects (`give` to `by`).

import { defineIntent, defineOp } from '../../net/registry.js';
import { BUILDINGS, ITEMS } from '../data.js';
import { Inventory } from '../inventory.js';
import { occAdd, occRemove } from '../nav.js';
import { gridAdd, gridRemove, footprint, updateMasksAround } from '../autotile.js';
import { collides } from '../physics.js';
import { G } from '../../world/worldgen.js';
import { addLootRows } from './loot.js';
import { lootRow, r3 } from './roll.js';
import { noGrowStamp, removeNatural, findObj } from './objects.js';
import { removeCropAt, cropAt } from './crops.js';

export const REFUND = 0.75;
export const MAX_TILES = 140;
export const CLEARABLE = new Set(['pebble', 'stick', 'fibergrass', 'bush', 'berrybush', 'herbbush', 'wild_potato', 'wild_cotton', 'wild_corn']);
export const CLEAR_YIELD = { pebble: { pebble: 1 }, stick: { stick: 1 }, fibergrass: { fiber: 2 }, bush: { fiber: 2, stick: 1 }, berrybush: { berries: 2, stick: 1 }, herbbush: { herb: 1 },
  wild_potato: { potato: 1, seed_potato: 1 }, wild_cotton: { cotton: 2, seed_cotton: 1 }, wild_corn: { corn: 1, seed_corn: 1 } };

export const defOf = (o) => BUILDINGS[o.type];
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const msgBuilt = (def) => `${def.name} ${def.g === 'm' ? 'construído' : 'construída'}`;
export const structById = (game, id) => {
  const o = game.world.objById.get(id);
  return o && o.building && !o.removed ? o : null;
};

// ---------- helpers (appliers / snapshot only) ----------
export function objectsOnTile(game, tx, ty) {
  const out = [];
  game.world.forChunks(tx - 1, ty - 1, tx + 2, ty + 2, (c) => {
    for (const o of c.objects) {
      if (o.building || o.gone) continue;
      if (Math.floor(o.x) === tx && Math.floor(o.y - 0.05) === ty) out.push(o);
    }
  });
  return out;
}

function clearDecor(game, tx, ty, sw, sh) {
  game.world.forChunks(tx, ty, tx + sw, ty + sh, (c) => {
    for (let k = c.decor.length - 1; k >= 0; k--) {
      const d = c.decor[k];
      if (d.x >= tx && d.x < tx + sw && d.y >= ty && d.y < ty + sh) c.decor.splice(k, 1);
    }
  });
}

// nudge entities out of a newly solid footprint (tile blocks) or round prop. Each peer nudges its own
// player; the authority also its creatures (remote avatars and proxies follow their owners).
function nudgeOut(game, o, auth) {
  const def = defOf(o);
  const round = typeof def.block === 'number' && def.block > 0;
  if (def.block !== 'tile' && def.block !== 'door' && !round) return;
  const [sw, sh] = def.size;
  for (const e of game.entities) {
    if (e.dead || e.remote || e.proxy || (e.isMob && !auth)) continue;
    if (round) { if (Math.hypot(e.x - o.x, e.y - o.cy) >= e.r + def.block) continue; }
    else if (e.x + e.r <= o.tx || e.x - e.r >= o.tx + sw || e.y + e.r <= o.ty || e.y - e.r >= o.ty + sh) continue;
    if (def.block === 'door' && e.passDoors) continue;
    let best = null, bd = 1e9;
    const pd = !!e.passDoors;
    const cands = [];
    if (round) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = e.r + def.block + 0.05; cands.push([o.x + Math.cos(a) * rr, o.cy + Math.sin(a) * rr]); }
    for (let ty = o.ty - 1; ty <= o.ty + sh; ty++) for (let tx = o.tx - 1; tx <= o.tx + sw; tx++) cands.push([tx + 0.5, ty + 0.5]);
    for (const [x, y] of cands) {
      if (collides(game.world, x, y, e.r, null, pd)) continue;
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) { e.x = best[0]; e.y = best[1]; }
  }
}

export function placeStructure(game, type, tx, ty, opts) {
  const def = BUILDINGS[type], w = game.world;
  const [sw, sh] = def.size;
  const o = {
    id: opts.id, type, v: opts.v ?? 0,
    tx, ty, x: tx + sw / 2, y: ty + sh, cy: ty + sh * 0.6, s: 1, f: 1, building: true, layer: def.layer,
    progress: Math.max(0, Math.min(1, opts.progress ?? 1)), mask: 0, solid: 0, builtAt: opts.builtAt ?? Math.round(game.worldTime),
  };
  if (def.flat) o.flat = true;
  if (o.progress < 1) { o.blueprint = true; if (def.fire || def.workLight) { o.fire = false; o.lit = false; } }
  if (def.slots) { o.store = new Inventory(def.slots); if (opts.store) o.store.load(opts.store); }
  if (def.station) { o.station = true; o.working = false; }
  if (def.block === 'door') { o.door = true; o.open = 0; o.orient = 'h'; game.build.doors.push(o); }
  w.addObject(o);
  game.build.structures.push(o);
  gridAdd(game, o);
  noGrowStamp(game, tx, ty, sw, sh, +1);
  clearDecor(game, tx, ty, sw, sh);
  updateMasksAround(game, tx, ty, tx + sw - 1, ty + sh - 1);
  if (o.progress >= 1) completeStructure(game, o, { silent: true, auth: game.net.auth });
  if (opts.decon) game.build.decon.add(o);
  if (opts.working) setWorking(game, o, true);
  game.build.v++;
  game.events.emit('tile', { tx, ty });
  return o;
}

export function completeStructure(game, o, { silent = false, auth = true } = {}) {
  const def = defOf(o), w = game.world;
  o.progress = 1;
  delete o.blueprint;
  const [sw, sh] = def.size;
  if (def.block === 'tile' || def.block === 'door') {
    for (const [x, y] of footprint(o)) w.solid[w.idx(x, y)] = def.block === 'door' ? 2 : 1;
  } else if (typeof def.block === 'number' && def.block > 0) {
    o.solid = def.block; occAdd(game, o);
  }
  if (def.light) o.light = { ...def.light };
  if (def.fire) o.fire = true;
  else if (def.workLight) o.fire = false;
  delete o.lit;
  nudgeOut(game, o, auth);
  if (!silent) {
    game.juice.puff(o.x, o.y - 0.2, 10, [0.72, 0.64, 0.52], 0.8);
    game.audio?.play('build', { x: o.x, y: o.y });
    if (o.type === 'campfire') game.audio?.play('fire', { x: o.x, y: o.y });
    game.events.emit('built', { o });
  }
  game.build.v++;
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (x || y) game.events.emit('tile', { tx: o.tx + x, ty: o.ty + y });
}

export function removeStructure(game, o, { drops = null, quiet = false } = {}) {
  const def = defOf(o), w = game.world;
  const S = game.build.structures, k = S.indexOf(o);
  if (k >= 0) S.splice(k, 1);
  else if (game.world.objById.get(o.id) !== o) return; // (orphans still in the world are cleaned up: resync repair)
  const wasBlueprint = !!o.blueprint;
  gridRemove(game, o);
  const [sw, sh] = def.size;
  noGrowStamp(game, o.tx, o.ty, sw, sh, -1);
  w.removeObject(o);
  occRemove(game, o);
  if (!wasBlueprint && (def.block === 'tile' || def.block === 'door')) for (const [x, y] of footprint(o)) w.solid[w.idx(x, y)] = 0;
  if (o.door) { const i = game.build.doors.indexOf(o); if (i >= 0) game.build.doors.splice(i, 1); }
  game.build.decon.delete(o);
  o.removed = true;
  addLootRows(game, drops);
  if (o.type === 'farm_plot') removeCropAt(game, o.tx, o.ty);
  updateMasksAround(game, o.tx, o.ty, o.tx + sw - 1, o.ty + sh - 1);
  if (!quiet) {
    game.juice.puff(o.x, o.y - 0.2, 8, [0.72, 0.64, 0.52], 0.7);
    game.audio?.play('build', { x: o.x, y: o.y, volume: 0.7 });
  }
  game.build.v++;
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
}

export function setWorking(game, o, on) {
  if (o.working === on) return;
  o.working = on;
  const def = defOf(o);
  if (def.workLight) { if (on) o.light = { ...def.workLight }; else delete o.light; }
  if (def.warmWorking && o.type !== 'campfire') o.fire = on;
}

// ---------- ops ----------
defineOp('struct.add', {
  doc: 'Structures / blueprints appear (ids and look from the host); `give` refunds tiles the host refused.',
  args: { list: '[[id, type, tx, ty, v, progress, builtAt]]', by: 'pid?', give: '{item: qty}?' },
  apply(game, a) {
    for (const r of a.list || []) {
      const [id, type, tx, ty, v, progress, builtAt] = r;
      if (!BUILDINGS[type] || game.world.objById.has(id)) continue;
      placeStructure(game, type, tx, ty, { id, v, progress, builtAt });
    }
  },
});

defineOp('struct.progress', {
  doc: 'Blueprint construction progress (0..0.999).',
  args: { id: 'structId', p: '0..1', by: 'pid' },
  apply(game, a, ctx) {
    const o = structById(game, a.id);
    if (!o || !o.blueprint) return;
    o.progress = Math.min(0.999, a.p);
    if (!ctx.mine) { game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3); game.audio?.play('build', { x: o.x, y: o.y, volume: 0.35 }); }
  },
});

defineOp('struct.complete', {
  doc: 'A blueprint is finished: solid / light / fire / masks; builder gets xp, toast (and the bed respawn).',
  args: { id: 'structId', by: 'pid', xp: 'number', toast: 'string', respawn: 'structId?' },
  apply(game, a, ctx) {
    const o = structById(game, a.id);
    if (!o || !o.blueprint) return;
    completeStructure(game, o, { auth: ctx.auth });
  },
});

defineOp('struct.remove', {
  doc: 'A structure / blueprint is removed (decon, cancel, door replacing a wall); refund as give, chest contents as drops.',
  args: { id: 'structId', by: 'pid?', give: '{item: qty}?', giveAt: '[x, y]?', drops: 'lootRows?', quiet: '0|1', toast: 'string?' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o) return;
    removeStructure(game, o, { drops: a.drops, quiet: !!a.quiet });
  },
});

defineOp('struct.decon', {
  doc: 'Structures marked (on) / unmarked for deconstruction.',
  args: { ids: '[structId]', on: '0|1' },
  apply(game, a) {
    const D = game.build.decon;
    for (const id of a.ids || []) {
      const o = structById(game, id);
      if (!o || o.blueprint) continue;
      if (a.on) D.add(o); else D.delete(o);
    }
    game.build.v++;
  },
});

defineOp('struct.working', {
  doc: 'A crafting station starts / stops working (light, fire).',
  args: { id: 'structId', on: '0|1' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (o && o.station) setWorking(game, o, !!a.on);
  },
});

defineOp('chest.set', {
  doc: 'New contents of a chest (whole slot list); `give` hands taken / leftover items to `by`.',
  args: { id: 'structId', slots: 'Inventory.toJSON()', by: 'pid', give: '{item: qty}?' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o || !o.store) return;
    o.store.load(a.slots);
    game.events.emit('chest', { o });
  },
});

// ---------- authority side ----------
// placement check shared by the local preview and the host. `who` = the placing player (distance).
export function placeReason(game, type, tx, ty, who) {
  const def = BUILDINGS[type], w = game.world;
  if (!def) return 'Construção desconhecida';
  const [sw, sh] = def.size;
  const layer = def.layer;
  const G2 = game.build.grid;
  let replace = null;
  for (let y = ty; y < ty + sh; y++) for (let x = tx; x < tx + sw; x++) {
    if (!w.inBounds(x, y) || x < 1 || y < 1 || x >= w.W - 1 || y >= w.H - 1) return 'Fora do mapa';
    const i = w.idx(x, y);
    if (w.rock[i]) return 'Rocha no caminho';
    if (w.water[i]) return 'Não dá para construir na água';
    if (G2[layer].has(i)) {
      // a door / gate can replace a wall / fence of its group (single tile)
      const cur = G2[layer].get(i);
      if (def.block === 'door' && sw === 1 && sh === 1 && BUILDINGS[cur.type].connect === def.connect && BUILDINGS[cur.type].block === 'tile') { replace = cur; continue; }
      return 'exists';
    }
    if (layer === 'main' && G2.floor.get(i)?.type === 'farm_plot') return 'Canteiro no caminho';
    if (type === 'farm_plot') {
      if (G2.main.has(i) || G2.rug.has(i)) return 'Construção no caminho';
      if (BAD_FARM.has(w.ground[i])) return 'Solo ruim para plantar';
    }
    if (layer === 'rug' && G2.floor.get(i)?.type === 'farm_plot') return 'Canteiro no caminho';
    if (layer === 'main' && w.solid[i] && !replace) return 'Algo no caminho';
    for (const o of objectsOnTile(game, x, y)) {
      if (CLEARABLE.has(o.type)) continue;
      if (o.type === 'crop') { if (layer !== 'floor') return 'Plantação no caminho'; continue; }
      return o.type.startsWith('tree_') ? (o.stump ? 'Toco no caminho' : 'Árvore no caminho') : o.type === 'boulder' ? 'Pedregulho no caminho' : 'Algo no caminho';
    }
  }
  if (who && Math.hypot(tx + sw / 2 - who.x, ty + sh / 2 - who.y) > MAX_DIST) return 'Muito longe';
  return replace ? { replace } : null;
}
export const MAX_DIST = 22;
const BAD_FARM = new Set([G.STONE, G.SAND, G.GRAVEL]);

const costTimes = (cost, n) => { const o = {}; for (const k in cost) o[k] = cost[k] * n; return o; };
const addTo = (acc, items) => { for (const k in items) if (items[k] > 0) acc[k] = (acc[k] || 0) + items[k]; return acc; };
const nonEmpty = (o) => (Object.keys(o).length ? o : undefined);

defineIntent('build.place', {
  doc: 'Place blueprints of `type` on tiles (cost already paid by the actor: cost × tiles). Refused tiles are refunded via give; a door may replace a wall (wall refunded).',
  args: { type: 'buildingId', tiles: '[[tx, ty]] (≤ 140)' },
  run(game, a, actor, net) {
    const def = BUILDINGS[a.type];
    if (!def) return 'Construção desconhecida';
    const tiles = Array.isArray(a.tiles) ? a.tiles.slice(0, MAX_TILES) : [];
    if (!tiles.length) return 'Nada para construir';
    const list = [], seen = new Set();
    let refused = 0, first = null;
    for (const t of tiles) {
      const tx = num(t?.[0]) | 0, ty = num(t?.[1]) | 0, key = tx + ',' + ty;
      if (seen.has(key)) { refused++; continue; }
      seen.add(key);
      let r = placeReason(game, a.type, tx, ty, actor.ent);
      if (r && typeof r === 'object') {
        const old = r.replace;
        net.emit('struct.remove', { id: old.id, by: actor.pid, give: nonEmpty(addTo({}, defOf(old).cost)), giveAt: [r3(old.x), r3(old.y - 0.2)], quiet: 1 });
        r = null;
      }
      if (r) { refused++; first ||= r === 'exists' ? 'Já existe uma construção aqui' : r; continue; }
      list.push([net.newId('s'), a.type, tx, ty, Math.floor(net.roll() * 1000), 0, Math.round(game.worldTime)]);
    }
    if (!list.length) return first || 'Local inválido';
    net.emit('struct.add', { list, by: actor.pid, give: refused ? nonEmpty(costTimes(def.cost, refused)) : undefined });
    return { placed: list.length, refused };
  },
});

defineIntent('build.hit', {
  doc: 'Work on a blueprint. start: clear its footprint (natural yields to the builder) or refuse; inc: progress; final: complete it.',
  args: { id: 'structId', start: 'bool?', inc: 'number?', final: 'bool?' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o || !o.blueprint) return 'Já foi construído';
    const def = defOf(o);
    if (a.start) {
      const [sw, sh] = def.size;
      const ids = [], give = {};
      for (let y = o.ty; y < o.ty + sh; y++) for (let x = o.tx; x < o.tx + sw; x++) {
        for (const n of objectsOnTile(game, x, y)) {
          if (CLEARABLE.has(n.type)) { ids.push(n.id); addTo(give, CLEAR_YIELD[n.type] || {}); }
          else if (n.type === 'crop') { if (def.layer !== 'floor') net.emit('crop.remove', { tx: n.tx, ty: n.ty }); }
          else return 'Algo está no caminho';
        }
      }
      if (ids.length) net.emit('obj.remove', { ids, fx: 'clear', by: actor.pid, give: nonEmpty(give), giveAt: [r3(o.x), r3(o.y - 0.2)] });
      return;
    }
    if (!a.final) {
      const inc = Math.max(0, Math.min(1, num(a.inc)));
      net.emit('struct.progress', { id: o.id, p: r3(Math.min(0.999, (o.progress || 0) + inc)), by: actor.pid });
      return;
    }
    if ((o.progress || 0) < 0.85) return 'Ainda não terminou';
    const msg = msgBuilt(def);
    net.emit('struct.complete', { id: o.id, by: actor.pid, xp: def.xp || 3, toast: o.type === 'bed' ? msg + ' · ponto de renascimento definido' : msg, respawn: o.type === 'bed' ? o.id : undefined });
  },
});

defineIntent('build.decon', {
  doc: 'Mark / unmark structures for deconstruction (on: null toggles each). Blueprints are cancelled at once with a full refund.',
  args: { ids: '[structId] (≤ 400)', on: '0|1|null' },
  run(game, a, actor, net) {
    const ids = Array.isArray(a.ids) ? a.ids.slice(0, 400) : [];
    const set = [], clear = [];
    for (const id of ids) {
      const o = structById(game, id);
      if (!o) continue;
      if (o.blueprint) {
        const def = defOf(o);
        net.emit('struct.remove', { id: o.id, by: actor.pid, give: nonEmpty(addTo({}, def.cost)), giveAt: [r3(o.x), r3(o.y - 0.2)], toast: `${def.name}: planta cancelada` });
        continue;
      }
      const want = a.on == null ? !game.build.decon.has(o) : !!a.on;
      (want ? set : clear).push(o.id);
    }
    if (set.length) net.emit('struct.decon', { ids: set, on: 1 });
    if (clear.length) net.emit('struct.decon', { ids: clear, on: 0 });
  },
});

defineIntent('decon.hit', {
  doc: 'Finish deconstructing a marked structure: 75% refund to the actor, chest contents dropped.',
  args: { id: 'structId' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o || !game.build.decon.has(o)) return 'Não está marcada para desmontar';
    const def = defOf(o);
    const back = {};
    for (const id in def.cost) back[id] = Math.round(def.cost[id] * REFUND);
    const drops = [];
    if (o.store) for (const s of o.store.slots) if (s) drops.push(lootRow(net, o.x, o.y - 0.3, s.id, s.qty, 0.8));
    net.emit('struct.remove', {
      id: o.id, by: actor.pid, give: nonEmpty(addTo({}, back)), giveAt: [r3(o.x), r3(o.y - 0.2)], drops: drops.length ? drops : undefined,
      toast: `${def.name} ${def.g === 'm' ? 'desmontado' : 'desmontada'}`,
    });
  },
});

const chestOf = (game, id) => { const o = structById(game, id); return o && o.store && !o.blueprint ? o : null; };
const cloneStore = (o) => { const inv = new Inventory(o.store.size); inv.load(o.store.toJSON()); return inv; };

defineIntent('chest.put', {
  doc: 'Put items into a chest (already removed from the actor; refunded on reject, leftovers given back).',
  args: { id: 'structId', item: 'itemId', qty: 'int' },
  run(game, a, actor, net) {
    const o = chestOf(game, a.id);
    if (!o) return 'Baú não existe mais';
    if (typeof a.item !== 'string' || !ITEMS[a.item]) return 'Item desconhecido';
    const qty = Math.max(1, Math.min(9999, num(a.qty, 1) | 0));
    const inv = cloneStore(o);
    const left = inv.add(a.item, qty);
    if (left === qty) return 'Baú cheio';
    net.emit('chest.set', { id: o.id, slots: inv.toJSON(), by: actor.pid, give: left ? { [a.item]: left } : undefined, quiet: 1 });
  },
});

defineIntent('chest.take', {
  doc: 'Take up to qty of the stack in chest slot `slot` (qty = room in the actor\'s backpack).',
  args: { id: 'structId', slot: 'int', qty: 'int' },
  run(game, a, actor, net) {
    const o = chestOf(game, a.id);
    if (!o) return 'Baú não existe mais';
    const s = o.store.slots[num(a.slot, -1) | 0];
    if (!s) return 'Vazio';
    const n = Math.min(s.qty, Math.max(0, num(a.qty) | 0));
    if (n <= 0) return 'Mochila cheia';
    const inv = cloneStore(o);
    inv.remove(s.id, n);
    net.emit('chest.set', { id: o.id, slots: inv.toJSON(), by: actor.pid, give: { [s.id]: n } });
  },
});

defineIntent('station.work', {
  doc: 'The actor starts / stops using a crafting station (it works while anyone uses it).',
  args: { id: 'structId', on: '0|1' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o || !o.station || o.blueprint) return 'Estação não existe';
    const W = o._workers || (o._workers = new Set());
    const before = W.size > 0;
    if (a.on) W.add(actor.pid); else W.delete(actor.pid);
    const after = W.size > 0;
    if (before !== after || !!o.working !== after) net.emit('struct.working', { id: o.id, on: after ? 1 : 0 });
  },
});

// host: a player left — stop the stations it was using
export function releaseStations(game, pid) {
  if (!game.net.auth) return;
  for (const o of game.build.structures) {
    if (!o._workers?.delete(pid)) continue;
    if (!o._workers.size && o.working) game.net.emit('struct.working', { id: o.id, on: 0 });
  }
}

export { cropAt, findObj };
