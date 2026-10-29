// Natural world objects (worldgen ids 1..N) and host-created flora ('f…' ids): every shared change.
// Ops: obj.add · obj.remove · obj.prog · tree.fell · tree.land · tree.stump · tree.solid
// Intent: gather.hit (tree / stump / boulder / pick / forage) — the host accumulates progress and completes.
// Helpers used only inside appliers / snapshot apply: makeFloraObject, removeNatural, noGrowStamp, touch.

import { defineIntent, defineOp } from '../../net/registry.js';
import { occAdd, occRemove } from '../nav.js';
import { addLootRows } from './loot.js';
import { lootRow, lootRows, ri, r3 } from './roll.js';

export const TREE_SOLID = { tree_oak: 0.2, tree_pine: 0.18, tree_birch: 0.16, tree_dead: 0.16 };
export const SAPLING_GROW = 1440;  // s (2 in-game days) from sapling to full tree
export const NOGROW_R = 3;
export const PICK_ITEM = { pebble: 'pebble', stick: 'stick' };
export const FORAGE_KINDS = new Set(['fibergrass', 'bush', 'berrybush', 'herbbush', 'wild_potato', 'wild_corn', 'wild_cotton']);
export const TREE_WOOD = { tree_oak: [4, 5], tree_pine: [3, 5], tree_birch: [3, 4], tree_dead: [2, 3] };

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const isTree = (o) => o.type.startsWith('tree_');
export const ageOf = (game, o) => (o.born == null ? (o.age ?? 1) : Math.min(1, 0.08 + (game.worldTime - o.born) / SAPLING_GROW));

// worldgen objects whose state changed (snapshot / save rows)
export function touch(game, o) { if (!o.flora) game.touched.set(o.id, o); }

// ---------- helpers (appliers / snapshot only) ----------
export function noGrowStamp(game, tx0, ty0, w, h, sign) {
  const W = game.world;
  const G2 = W.noGrow;
  if (!G2) return;
  for (let y = ty0 - NOGROW_R; y < ty0 + h + NOGROW_R; y++) for (let x = tx0 - NOGROW_R; x < tx0 + w + NOGROW_R; x++) {
    if (!W.inBounds(x, y)) continue;
    const i = W.idx(x, y);
    G2[i] = Math.max(0, G2[i] + sign);
  }
}

export function removeNatural(game, o) {
  occRemove(game, o);
  game.world.removeObject(o);
  o.gone = true;
  if (o.flora) game.flora.dyn.delete(o.id);
  else game.touched.set(o.id, o);
  game.flora.growing.delete(o);
  game.stumps?.delete(o);
  const k = game.falling.indexOf(o);
  if (k >= 0) game.falling.splice(k, 1);
  game.events.emit('tile', { tx: Math.floor(o.x), ty: Math.floor(o.y) });
}

// every visual field must be given (rolled by the authority: mut/roll.js floraLook)
export function makeFloraObject(game, kind, x, y, opts) {
  const F = game.flora;
  const o = { id: opts.id, type: kind, x, y, f: opts.f ?? 1, flora: true, v: opts.v ?? 0, s: opts.s ?? 1 };
  if (isTree(o)) {
    o.born = opts.born ?? game.worldTime;
    o.age = ageOf(game, o);
    o.solid = 0;
  } else if (kind === 'boulder') o.solid = 0.34;
  game.world.addObject(o);
  F.dyn.set(o.id, o);
  if (isTree(o)) {
    const solid = opts.solid ?? o.age >= 0.6;
    if (solid) { o.solid = TREE_SOLID[o.type] || 0.18; occAdd(game, o); }
    if (o.age < 1 || !o.solid) F.growing.add(o);
  } else if (o.solid) occAdd(game, o);
  return o;
}

export function makeStump(game, o, at) {
  o.fall = 0; o.stump = true; o.prog = 0; o.alpha = 1;
  o.stumpAt = at;
  o.solid = 0;
  occRemove(game, o);
  game.flora.growing.delete(o);
  game.stumps.add(o);
  touch(game, o);
  const k = game.falling.indexOf(o);
  if (k >= 0) game.falling.splice(k, 1);
}

export const findObj = (game, id) => game.world.objById.get(id) || game.flora.dyn.get(id) || null;

// cosmetic effects (any peer) — the actor plays its own immediately (gathering.js), others on the op
function hitFx(game, o, toward) {
  const J = game.juice;
  (game.shaking ||= new Set()).add(o);
  if (isTree(o) && !o.stump) {
    o.shake = 1;
    J.leaves(o.x, o.y, 4, 1.8 * o.s);
    J.chips(toward ? o.x - (o.x - toward.x) * 0.3 : o.x, o.y, [0.62, 0.45, 0.28], 4, 0.4);
    game.audio?.play('chop', { x: o.x, y: o.y });
  } else if (o.stump) {
    o.shake = 1; o.flash = 0.5;
    J.chips(o.x, o.y - 0.1, [0.55, 0.4, 0.25], 5, 0.35);
    game.audio?.play('chop', { x: o.x, y: o.y, volume: 0.8 });
  } else if (o.type === 'boulder') {
    o.flash = 0.8; o.shake = 1;
    J.chips(o.x, o.y, [0.62, 0.6, 0.57], 7, 0.35);
    J.puff(o.x, o.y, 3, [0.7, 0.68, 0.64], 0.4);
    game.audio?.play('mine', { x: o.x, y: o.y });
  }
}
export { hitFx as objectHitFx };

const REMOVE_FX = {
  stump: (game, o) => game.juice.puff(o.x, o.y, 6, [0.6, 0.5, 0.38], 0.6),
  boulder: (game, o, mine) => {
    game.juice.puff(o.x, o.y, 10, [0.7, 0.68, 0.64], 0.8);
    game.juice.chips(o.x, o.y, [0.62, 0.6, 0.57], 12, 0.3);
    if (mine) game.juice.shake(0.15);
  },
  pick: (game, o) => { game.audio?.play('pickup', { x: o.x, y: o.y }); game.juice.puff(o.x, o.y, 3, [0.62, 0.56, 0.46], 0.35); },
  forage: (game, o) => { game.juice.leaves(o.x, o.y, 5, 0.5); game.audio?.play('pickup', { x: o.x, y: o.y }); },
  clear: (game, o) => game.juice.leaves?.(o.x, o.y, 3, 0.4),
};

// ---------- ops ----------
defineOp('obj.add', {
  doc: 'Host-created flora (regrowth, starter safety net) appears with exact id / position / look / birth time.',
  args: { list: '[{id, type, x, y, v, s, f, born?, solid?}]' },
  apply(game, a) {
    for (const r of a.list || []) {
      if (!r || !r.id || game.world.objById.has(r.id)) continue;
      makeFloraObject(game, r.type, r.x, r.y, r);
      game.events.emit('tile', { tx: Math.floor(r.x), ty: Math.floor(r.y) });
    }
  },
});

defineOp('obj.remove', {
  doc: 'Natural objects removed (harvested, broken, decayed, cleared under a building); optional drops / give.',
  args: { ids: '[objId]', drops: 'lootRows?', fx: "'stump'|'boulder'|'pick'|'forage'|'clear'?", by: 'pid?', xp: 'number?', give: '{item: qty}?', giveAt: '[x, y]?' },
  apply(game, a, ctx) {
    for (const id of a.ids || []) {
      const o = findObj(game, id);
      if (!o || o.gone) continue;
      REMOVE_FX[a.fx]?.(game, o, ctx.mine);
      removeNatural(game, o);
    }
    addLootRows(game, a.drops);
  },
});

defineOp('obj.prog', {
  doc: 'Work progress on a tree / stump / boulder (shake, chips and sound for everyone but the worker).',
  args: { id: 'objId', prog: '0..1', by: 'pid', x: 'worker x?', y: 'worker y?' },
  apply(game, a, ctx) {
    const o = findObj(game, a.id);
    if (!o || o.gone) return;
    o.prog = a.prog;
    touch(game, o);
    if (!ctx.mine) hitFx(game, o, a.x != null ? { x: a.x, y: a.y } : null);
  },
});

defineOp('tree.fell', {
  doc: 'A tree starts falling to side `dir`; wood lands later (tree.land), the stump at the end (tree.stump).',
  args: { id: 'objId', dir: '±1', by: 'pid', xp: 'number' },
  apply(game, a) {
    const o = findObj(game, a.id);
    if (!o || o.gone || o.stump) return;
    o.fall = 0.001; o.prog = 0;
    o.fallDir = a.dir;
    occRemove(game, o);
    if (!game.falling.includes(o)) game.falling.push(o);
    game.audio?.play('chop', { x: o.x, y: o.y, volume: 1.2 });
    touch(game, o);
  },
});

defineOp('tree.land', {
  doc: 'The falling tree hit the ground: its wood / stick drops appear.',
  args: { id: 'objId', drops: 'lootRows' },
  apply(game, a) { addLootRows(game, a.drops); },
});

defineOp('tree.stump', {
  doc: 'The fallen tree becomes a stump (absolute host time `at`, for decay).',
  args: { id: 'objId', at: 'worldTime' },
  apply(game, a) {
    const o = findObj(game, a.id);
    if (!o || o.gone) return;
    makeStump(game, o, a.at);
    game.events.emit('tile', { tx: Math.floor(o.x), ty: Math.floor(o.y) });
  },
});

defineOp('tree.solid', {
  doc: 'A sapling grew tall enough to block movement.',
  args: { id: 'objId' },
  apply(game, a) {
    const o = findObj(game, a.id);
    if (!o || o.gone || o.stump || o.solid) return;
    o.solid = TREE_SOLID[o.type] || 0.18;
    occAdd(game, o);
  },
});

// ---------- authority helpers ----------
// regrown / starter flora at (x, y): one obj.add op
export function spawnFlora(game, kind, x, y, look) {
  const net = game.net;
  const r = { id: net.newId('f'), type: kind, x: r3(x), y: r3(y), ...look };
  if (kind.startsWith('tree_')) r.born = Math.round(game.worldTime);
  net.emit('obj.add', { list: [r] });
  return findObj(game, r.id);
}

// wood / stick drops of a landing tree (falling loop on the authority)
export function treeLandDrops(game, o) {
  const net = game.net, dir = o.fallDir || o.f || 1;
  const [a, b] = TREE_WOOD[o.type] || [3, 4];
  const n = ri(net, a, b);
  const rows = [];
  for (let k = 0; k < n; k++) rows.push(lootRow(net, o.x + dir * (0.6 + (k / n) * 1.6) * o.s, o.y + (net.roll() - 0.5) * 0.3, 'wood', 1, 0.4));
  if (net.roll() < 0.6) rows.push(lootRow(net, o.x + dir * 1.2 * o.s, o.y, 'stick', 1, 0.5));
  return rows;
}

function forageDrops(net, o, knife) {
  const rows = [], at = (id, n) => lootRows(net, rows, o.x, o.y - 0.2, id, n, 0.6);
  switch (o.type) {
    case 'fibergrass': at('fiber', ri(net, 2, 3) + (knife ? 1 : 0)); break;
    case 'bush': at('fiber', ri(net, 2, 3) + (knife ? 1 : 0)); at('stick', 1); break;
    case 'berrybush': at('berries', ri(net, 2, 4)); at('stick', 1); break;
    case 'herbbush': at('herb', ri(net, 1, 2)); if (net.roll() < 0.4) at('stick', 1); break;
    case 'wild_potato': at('potato', ri(net, 1, 2)); at('seed_potato', ri(net, 1, 2)); break;
    case 'wild_corn': at('corn', ri(net, 1, 2)); at('seed_corn', ri(net, 1, 2)); break;
    case 'wild_cotton': at('cotton', ri(net, 2, 3)); at('seed_cotton', 1); break;
  }
  return rows;
}

const WORKED = new Set(['tree', 'stump', 'boulder']);

defineIntent('gather.hit', {
  doc: 'A work hit on a natural object (inc = 1/need of the actor\'s tool) or the final hit (final: the actor\'s loop finished). The host accumulates o.prog and completes once.',
  args: { id: 'objId', kind: "'tree'|'stump'|'boulder'|'pick'|'forage'", inc: 'number 0..1', final: 'bool?', fibre: 'bool? (actor has a knife: +1 fibre)' },
  run(game, a, actor, net) {
    const o = findObj(game, a.id);
    if (!o || o.gone || o.building) return 'Já foi coletado';
    const e = actor.ent;
    if (e && Math.hypot(e.x - o.x, e.y - o.y) > 4.5) return 'Longe demais';
    const kind = a.kind;
    switch (kind) {
      case 'tree': if (!isTree(o) || o.stump || o.fall || ageOf(game, o) < 0.9) return 'Não dá para cortar'; break;
      case 'stump': if (!o.stump) return 'Não é um toco'; break;
      case 'boulder': if (o.type !== 'boulder') return 'Não é um pedregulho'; break;
      case 'pick': if (!PICK_ITEM[o.type]) return 'Nada para pegar'; break;
      case 'forage': if (!FORAGE_KINDS.has(o.type)) return 'Nada para colher'; break;
      default: return 'Tipo inválido';
    }
    if (!a.final) {
      if (!WORKED.has(kind)) return 'Sem progresso';
      const inc = Math.max(0, Math.min(1, num(a.inc)));
      net.emit('obj.prog', { id: o.id, prog: r3(Math.min(0.999, (o.prog || 0) + inc)), by: actor.pid, x: e ? r3(e.x) : undefined, y: e ? r3(e.y) : undefined });
      return;
    }
    if (WORKED.has(kind) && (o.prog || 0) < 0.85) return 'Ainda não terminou';
    const by = actor.pid;
    switch (kind) {
      case 'tree':
        net.emit('tree.fell', { id: o.id, dir: e && e.x < o.x ? 1 : -1, by, xp: 6 });
        break;
      case 'stump':
        net.emit('obj.remove', { ids: [o.id], drops: [lootRow(net, o.x, o.y - 0.1, 'wood', 1, 0.6)], fx: 'stump', by, xp: 2 });
        break;
      case 'boulder': {
        const rows = [];
        lootRows(net, rows, o.x, o.y - 0.1, 'stone', Math.max(2, Math.round(2 + o.s * 2 + net.roll())));
        if (net.roll() < 0.5) lootRows(net, rows, o.x, o.y - 0.1, 'pebble', 1);
        net.emit('obj.remove', { ids: [o.id], drops: rows, fx: 'boulder', by, xp: 6 });
        break;
      }
      case 'pick': {
        const n = (o.s || 1) > 1.05 && net.roll() < 0.5 ? 2 : 1;
        net.emit('obj.remove', { ids: [o.id], fx: 'pick', by, xp: 1, give: { [PICK_ITEM[o.type]]: n }, giveAt: [r3(o.x), r3(o.y)] });
        break;
      }
      case 'forage':
        net.emit('obj.remove', { ids: [o.id], drops: forageDrops(net, o, !!a.fibre), fx: 'forage', by, xp: 2 });
        break;
    }
  },
});
