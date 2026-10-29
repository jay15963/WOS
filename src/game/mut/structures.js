// Structures (buildings, blueprints, doors, chests, stations): every shared change.
// Ops: struct.add · struct.paid · struct.progress · struct.complete · struct.remove · struct.decon · struct.working ·
//      struct.relocate · door.set · chest.set
// Intents: build.place · build.hit · build.decon · build.move · decon.hit · struct.raze · door.toggle · chest.put ·
//          chest.take · station.work
// Refunds / yields are computed by the authority and travel as owner effects (`give` to `by`).
//
// Shared structure fields: id, type, tx, ty, v, rot, progress (< 1 = blueprint), paid (materials delivered),
// decon, store, working, open (doors), moveOf (a "Mover" blueprint: id of the structure that will move here),
// style / det (agent K's kits, see mut/kit.js; roofs: J's styles in content/roofs.js through the 'roof' kit).
// Roofs (layer 'roof', agent J): placing needs a (planned or finished) support within 6 tiles, building needs a
// finished one; game/roofs.js keeps world.broof and the collapse checks in step (onRoofStruct).
// Derived (setGeom): fw × fh footprint after rotation, x, y (base / sort key), cy (round collision centre).
// Blueprints are free to place; the builder delivers the cost when work starts (build.hit start + pay).

import { defineIntent, defineOp } from '../../net/registry.js';
import { BUILDINGS, ITEMS } from '../data.js';
import { Inventory } from '../inventory.js';
import { occAdd, occRemove } from '../nav.js';
import { gridAdd, gridRemove, footprint, updateMasksAround, wallBehind } from '../autotile.js';
import { collides } from '../physics.js';
import { G } from '../../world/worldgen.js';
import { addLootRows } from './loot.js';
import { lootRow, r3 } from './roll.js';
import { noGrowStamp, removeNatural, findObj } from './objects.js';
import { removeCropAt, cropAt } from './crops.js';
import { sortedSlots, SORT_MODES } from '../invsort.js'; // store.sort (agents B + I)
import { sortBody } from './corpses.js';
import { allPlayers } from '../players.js';
import { applyKitFields, kitComplete, kitRemove } from './kit.js'; // agent K: style / detail kits, training dummy
import { normStyle, cleanDet } from '../content/kits.js';
import { onRoofStruct, onDoor, roofSupported } from '../roofs.js';
import { ROOF_STYLES, defaultRoofStyle } from '../content/roofs.js';

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

// ---------- geometry (rotation / edge placement) ----------
// edge props: [body depth N-S, half width E-W] in tiles (base = front-bottom of the body)
export const EDGE_GEOM = { chest: [0.56, 0.37], torch: [0.14, 0.08], chair_wood: [0.5, 0.26], flower_pot: [0.34, 0.2], banner: [0.3, 0.3], lamp_post: [0.3, 0.14] };
const EM = 0.04; // gap to the tile edge
export const rotCount = (type) => { const d = BUILDINGS[type]; return d?.edge ? 5 : d?.rotate ? 4 : 1; };
export const normRot = (type, r) => { const n = rotCount(type), v = Number.isFinite(r) ? Math.trunc(r) : 0; return ((v % n) + n) % n; };
export function dimsOf(type, rot = 0) {
  const d = BUILDINGS[type];
  const [w, h] = d?.size || [1, 1];
  return d?.rotate && (rot & 1) ? [h, w] : [w, h];
}
// front direction: rotate types rot 0..3 = S, W, N, E · edge props 0 centre (S), 1 N edge (S), 2 E edge (W), 3 S edge (N), 4 W edge (E)
const FACE_ROT = ['s', 'w', 'n', 'e'], FACE_EDGE = ['s', 's', 'w', 'n', 'e'];
export function facingOf(o) {
  const d = BUILDINGS[o.type];
  return d?.edge ? FACE_EDGE[o.rot | 0] || 's' : d?.rotate ? FACE_ROT[o.rot & 3] : 's';
}
// derived position fields from tx, ty, rot (identical on every peer)
export function setGeom(o) {
  const def = BUILDINGS[o.type];
  const [fw, fh] = dimsOf(o.type, o.rot);
  o.fw = fw; o.fh = fh;
  if (def.edge) {
    const [d, hw] = EDGE_GEOM[o.type] || def.eg || [0.5, 0.3];
    const r = o.rot | 0, tx = o.tx, ty = o.ty;
    let x = tx + 0.5, cy = ty + 0.5, y = ty + 0.5 + d / 2;
    if (r === 1) { cy = ty + EM + d / 2; y = ty + EM + d; }
    else if (r === 3) { y = ty + 1 - EM; cy = y - d / 2; }
    else if (r === 2) { x = tx + 1 - EM - d / 2; y = ty + 0.5 + hw; }
    else if (r === 4) { x = tx + EM + d / 2; y = ty + 0.5 + hw; }
    o.x = x; o.y = y; o.cy = cy;
  } else {
    o.x = o.tx + fw / 2; o.y = o.ty + fh; o.cy = o.ty + fh * 0.6;
  }
  o.face = facingOf(o);
  return o;
}

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

// nudge entities out of a newly solid footprint (tile blocks, closed doors) or round prop. Each peer nudges its
// own player; the authority also its creatures (remote avatars and proxies follow their owners).
function nudgeOut(game, o, auth) {
  const def = defOf(o);
  const round = typeof def.block === 'number' && def.block > 0;
  if (def.block !== 'tile' && def.block !== 'door' && !round) return;
  if (def.block === 'door' && o.open) return;
  const sw = o.fw || 1, sh = o.fh || 1;
  const olv = o.lv | 0, L = game.levels;
  for (const e of game.entities) {
    if (e.dead || e.remote || e.proxy || (e.isMob && !auth)) continue;
    if ((e.lv | 0) !== olv || (L && L.onStair(e))) continue; // levels: only the story it was built on (stairs are corridors)
    if (round) { if (Math.hypot(e.x - o.x, e.y - o.cy) >= e.r + def.block) continue; }
    else if (e.x + e.r <= o.tx || e.x - e.r >= o.tx + sw || e.y + e.r <= o.ty || e.y - e.r >= o.ty + sh) continue;
    let best = null, bd = 1e9;
    const pd = !!e.passDoors;
    const cands = [];
    if (round) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = e.r + def.block + 0.05; cands.push([o.x + Math.cos(a) * rr, o.cy + Math.sin(a) * rr]); }
    for (let ty = o.ty - 1; ty <= o.ty + sh; ty++) for (let tx = o.tx - 1; tx <= o.tx + sw; tx++) cands.push([tx + 0.5, ty + 0.5]);
    for (const [x, y] of cands) {
      if (olv ? L.collidesL(olv, x, y, e.r, pd, false, -1) : collides(game.world, x, y, e.r, null, pd)) continue;
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) { e.x = best[0]; e.y = best[1]; }
  }
}

const costEmpty = (def) => !def.cost || !Object.keys(def.cost).length;

export function placeStructure(game, type, tx, ty, opts) {
  const def = BUILDINGS[type], w = game.world;
  const o = {
    id: opts.id, type, v: opts.v ?? 0, tx, ty, rot: normRot(type, opts.rot), s: 1, f: 1, building: true, layer: def.layer,
    progress: Math.max(0, Math.min(1, opts.progress ?? 1)), mask: 0, solid: 0, builtAt: opts.builtAt ?? Math.round(game.worldTime),
  };
  if (opts.lv && !def.roof) o.lv = Math.max(0, Math.min(3, opts.lv | 0)); // levels: story (absent = ground)
  setGeom(o);
  applyKitFields(game, o, opts.style, opts.det);
  o.paid = o.progress >= 1 || !!opts.paid || costEmpty(def);
  if (opts.moveOf) o.moveOf = opts.moveOf;
  if (def.roof) o.roof = true; // (style / det: applyKitFields above, roof styles through the 'roof' kit)
  if (def.flat) o.flat = true;
  if (o.progress < 1) { o.blueprint = true; if (def.fire || def.workLight) { o.fire = false; o.lit = false; } }
  if (def.slots && !o.moveOf) { o.store = new Inventory(def.slots); if (opts.store) o.store.load(opts.store); }
  if (def.station) { o.station = true; o.working = false; }
  if (def.block === 'door') { o.door = true; o.open = !!opts.open; o._openT = o.open ? 1 : 0; o.orient = 'h'; game.build.doors.push(o); }
  w.addObject(o);
  game.build.structures.push(o);
  if (!o.moveOf) gridAdd(game, o); // "Mover" plans stay out of the grid (they may overlap the object being moved)
  if (!o.lv) noGrowStamp(game, tx, ty, o.fw, o.fh, +1);
  if (!def.roof && !o.lv) clearDecor(game, tx, ty, o.fw, o.fh);
  updateMasksAround(game, tx, ty, tx + o.fw - 1, ty + o.fh - 1);
  if (o.progress >= 1) completeStructure(game, o, { silent: true, auth: game.net.auth });
  if (opts.decon) game.build.decon.add(o);
  if (opts.working) setWorking(game, o, true);
  game.build.v++;
  game.events.emit('tile', { tx, ty });
  return o;
}

function setSolid(game, o) {
  const def = defOf(o), w = game.world;
  if (def.block !== 'tile' && def.block !== 'door') return;
  if (o.lv) return; // levels: upper stories block through the level map (levels.blk)
  const v = def.block === 'door' && o.open ? 0 : 1;
  for (const [x, y] of footprint(o)) if (w.inBounds(x, y)) w.solid[w.idx(x, y)] = v;
}

export function completeStructure(game, o, { silent = false, auth = true } = {}) {
  const def = defOf(o);
  o.progress = 1;
  o.paid = true;
  delete o.blueprint;
  if (def.block === 'tile' || def.block === 'door') setSolid(game, o);
  else if (typeof def.block === 'number' && def.block > 0) { o.solid = def.block; if (!o.lv) occAdd(game, o); }
  if (def.light) o.light = { ...def.light };
  if (def.fire) o.fire = true;
  else if (def.workLight) o.fire = false;
  delete o.lit;
  kitComplete(game, o);
  nudgeOut(game, o, auth);
  updateMasksAround(game, o.tx, o.ty, o.tx + o.fw - 1, o.ty + o.fh - 1); // wall-mounted props, door orientation
  if (!silent) {
    game.juice.puff(o.x, o.y - 0.2 - (def.roof ? 0.6 : 0), def.roof ? 5 : 10, [0.72, 0.64, 0.52], 0.8);
    game.audio?.play(def.roof ? 'build_hit' : 'build_done', { x: o.x, y: o.y });
    if (o.type === 'campfire') game.audio?.play('fire', { x: o.x, y: o.y });
    game.events.emit('built', { o });
  }
  game.build.v++;
  onRoofStruct(game, o, 'complete');
  for (const [x, y] of footprint(o)) game.events.emit('tile', { tx: x, ty: y });
}

export function removeStructure(game, o, { drops = null, quiet = false, fx = null } = {}) {
  const def = defOf(o), w = game.world;
  const S = game.build.structures, k = S.indexOf(o);
  if (k >= 0) S.splice(k, 1);
  else if (game.world.objById.get(o.id) !== o) return; // (orphans still in the world are cleaned up: resync repair)
  const wasBlueprint = !!o.blueprint;
  if (!o.moveOf) gridRemove(game, o);
  if (!o.lv) noGrowStamp(game, o.tx, o.ty, o.fw, o.fh, -1);
  w.removeObject(o);
  occRemove(game, o);
  if (!wasBlueprint && !o.lv && (def.block === 'tile' || def.block === 'door')) for (const [x, y] of footprint(o)) w.solid[w.idx(x, y)] = 0;
  if (o.door) { const i = game.build.doors.indexOf(o); if (i >= 0) game.build.doors.splice(i, 1); }
  game.build.decon.delete(o);
  o.removed = true;
  kitRemove(game, o);
  onRoofStruct(game, o, 'remove', wasBlueprint);
  addLootRows(game, drops);
  if (o.type === 'farm_plot') removeCropAt(game, o.tx, o.ty);
  // plans to move this object die with it
  if (!o.moveOf) for (const b of S.filter((q) => q.moveOf === o.id)) removeStructure(game, b, { quiet: true });
  updateMasksAround(game, o.tx, o.ty, o.tx + o.fw - 1, o.ty + o.fh - 1);
  if (!quiet) {
    game.juice.puff(o.x, o.y - 0.2, 8, [0.72, 0.64, 0.52], 0.7);
    game.audio?.play(fx || (wasBlueprint ? 'ui' : 'decon'), { x: o.x, y: o.y, volume: 0.8 });
  }
  game.build.v++;
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
}

// move a finished structure to (tx, ty, rot) keeping its id and state (store, variant, working, open…)
export function relocateStructure(game, o, tx, ty, rot, auth = true) {
  const def = defOf(o), w = game.world;
  const ox = o.tx, oy = o.ty, ofw = o.fw, ofh = o.fh;
  const blocks = !o.blueprint && !o.lv && (def.block === 'tile' || def.block === 'door');
  gridRemove(game, o);
  if (!o.lv) noGrowStamp(game, ox, oy, ofw, ofh, -1);
  w.removeObject(o);
  occRemove(game, o);
  if (blocks) for (const [x, y] of footprint(o)) w.solid[w.idx(x, y)] = 0;
  o.tx = tx; o.ty = ty; o.rot = normRot(o.type, rot);
  setGeom(o);
  w.addObject(o);
  gridAdd(game, o);
  if (!o.lv) { noGrowStamp(game, tx, ty, o.fw, o.fh, +1); clearDecor(game, tx, ty, o.fw, o.fh); }
  if (!o.blueprint) {
    if (blocks) setSolid(game, o);
    else if (o.solid && !o.lv) occAdd(game, o);
    nudgeOut(game, o, auth);
  }
  updateMasksAround(game, ox, oy, ox + ofw - 1, oy + ofh - 1);
  updateMasksAround(game, tx, ty, tx + o.fw - 1, ty + o.fh - 1);
  game.build.v++;
  game.events.emit('tile', { tx: ox, ty: oy });
  game.events.emit('tile', { tx, ty });
}

export function setWorking(game, o, on) {
  if (o.working === on) return;
  o.working = on;
  const def = defOf(o);
  if (def.workLight) { if (on) o.light = { ...def.workLight }; else delete o.light; }
  if (def.warmWorking && o.type !== 'campfire') o.fire = on;
}

export function setDoorOpen(game, o, open) {
  o.open = !!open;
  if (!o.blueprint) setSolid(game, o);
  onDoor(game, o);
  game.build.v++;
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
}

// ---------- ops ----------
defineOp('struct.add', {
  doc: 'Structures / blueprints appear (ids and look from the host). Rows: [id, type, tx, ty, v, progress, builtAt, rot, paid, moveOf, style, det].',
  args: { list: '[[id, type, tx, ty, v, progress, builtAt, rot, paid, moveOf, style, det]]', by: 'pid?', give: '{item: qty}?', lv: 'story 0..3? (levels: the whole batch)' },
  apply(game, a, ctx) {
    const lv = Math.max(0, Math.min(3, a.lv | 0));
    for (const r of a.list || []) {
      const [id, type, tx, ty, v, progress, builtAt, rot, paid, moveOf, style, det] = r;
      if (!BUILDINGS[type] || game.world.objById.has(id)) continue;
      placeStructure(game, type, tx, ty, { id, v, progress, builtAt, rot, paid: !!paid, moveOf: moveOf || undefined, style, det, lv });
    }
    if (ctx.mine && a.list?.length) game.audio?.play('blueprint', {});
  },
});

defineOp('struct.paid', {
  doc: 'The builder delivered the materials of a blueprint (taken from its bag when the work started); `give` returns a second delivery.',
  args: { id: 'structId', by: 'pid', give: '{item: qty}?' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o || !o.blueprint) return;
    o.paid = true;
    game.build.v++;
  },
});

defineOp('struct.progress', {
  doc: 'Blueprint construction progress (0..0.999).',
  args: { id: 'structId', p: '0..1', by: 'pid' },
  apply(game, a, ctx) {
    const o = structById(game, a.id);
    if (!o || !o.blueprint) return;
    o.progress = Math.min(0.999, a.p);
    if (!ctx.mine) { game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3); game.audio?.play('build_hit', { x: o.x, y: o.y, volume: 0.35 }); }
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
  doc: 'A structure / blueprint is removed (decon, raze, cancel, door replacing a wall); refund as give, chest contents as drops.',
  args: { id: 'structId', by: 'pid?', give: '{item: qty}?', giveAt: '[x, y]?', drops: 'lootRows?', quiet: '0|1', toast: 'string?', fx: "'decon'|'raze'?" },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o) return;
    removeStructure(game, o, { drops: a.drops, quiet: !!a.quiet, fx: a.fx === 'raze' ? 'raze' : null });
  },
});

defineOp('struct.relocate', {
  doc: 'A "Mover" blueprint is done: the plan disappears and the original structure moves there (same id, contents and state).',
  args: { id: 'structId (plan)', src: 'structId', by: 'pid', xp: 'number?', toast: 'string?' },
  apply(game, a, ctx) {
    const bp = structById(game, a.id), src = structById(game, a.src);
    if (!bp) return;
    const { tx, ty, rot } = bp;
    removeStructure(game, bp, { quiet: true });
    if (!src || src.blueprint) return;
    relocateStructure(game, src, tx, ty, rot, ctx.auth);
    game.juice.puff(src.x, src.y - 0.2, 10, [0.72, 0.64, 0.52], 0.8);
    game.audio?.play('build_done', { x: src.x, y: src.y });
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

defineOp('door.set', {
  doc: 'A door / gate is opened (everyone passes) or closed (blocks everyone, creatures included).',
  args: { id: 'structId', open: '0|1', by: 'pid' },
  apply(game, a, ctx) {
    const o = structById(game, a.id);
    if (!o || !o.door) return;
    setDoorOpen(game, o, !!a.open);
    if (!o.open && !o.blueprint) nudgeOut(game, o, ctx.auth);
    game.audio?.play(o.open ? 'door_open' : 'door_close', { x: o.x, y: o.y - 0.4 });
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
// placement check shared by the local preview and the host. `who` = the placing player (distance),
// `rot` = orientation, `ignore` = a structure whose tiles count as free (the one being moved).
export function placeReason(game, type, tx, ty, who, rot = 0, ignore = null, lv = 0) {
  const def = BUILDINGS[type], w = game.world;
  if (!def) return 'Construção desconhecida';
  if (def.roof) return roofReason(game, type, tx, ty, who);
  if (lv > 0) return game.levels ? game.levels.upperReason(type, tx, ty, who, normRot(type, rot), ignore, lv) : 'Andares indisponíveis'; // levels: upper stories
  const [sw, sh] = dimsOf(type, normRot(type, rot));
  const layer = def.layer;
  const G2 = game.build.grid;
  let replace = null;
  for (let y = ty; y < ty + sh; y++) for (let x = tx; x < tx + sw; x++) {
    if (!w.inBounds(x, y) || x < 1 || y < 1 || x >= w.W - 1 || y >= w.H - 1) return 'Fora do mapa';
    const i = w.idx(x, y);
    if (w.rock[i]) return 'Rocha no caminho';
    if (w.water[i]) return 'Não dá para construir na água';
    const cur = G2[layer].get(i);
    const self = ignore && cur === ignore;
    if (cur && !self) {
      // a door / gate can replace a wall / fence of its group (single tile)
      if (!ignore && def.block === 'door' && sw === 1 && sh === 1 && BUILDINGS[cur.type].connect === def.connect && BUILDINGS[cur.type].block === 'tile') { replace = cur; continue; }
      return 'exists';
    }
    if (layer === 'main' && G2.floor.get(i)?.type === 'farm_plot') return 'Canteiro no caminho';
    if (type === 'farm_plot') {
      if (G2.main.has(i) || G2.rug.has(i)) return 'Construção no caminho';
      if (BAD_FARM.has(w.ground[i])) return 'Solo ruim para plantar';
    }
    if (layer === 'rug' && G2.floor.get(i)?.type === 'farm_plot') return 'Canteiro no caminho';
    if (layer === 'main' && w.solid[i] && !replace && !(ignore && G2.main.get(i) === ignore)) return 'Algo no caminho';
    for (const o of objectsOnTile(game, x, y)) {
      if (CLEARABLE.has(o.type)) continue;
      if (o.type === 'crop') { if (layer !== 'floor') return 'Plantação no caminho'; continue; }
      return o.type.startsWith('tree_') ? (o.stump ? 'Toco no caminho' : 'Árvore no caminho') : o.type === 'boulder' ? 'Pedregulho no caminho' : 'Algo no caminho';
    }
  }
  if (def.block === 'stairs') { const r = game.levels?.stairsReason(type, tx, ty, rot); if (r) return r; } // levels: open stairwell
  if (def.mount === 'wall' && !(rot >= 1 && rot <= 4 && wallBehind(game, tx, ty, rot))) return 'Encoste numa parede pronta'; // agent K: wall-mounted decor
  if (who && Math.hypot(tx + sw / 2 - who.x, ty + sh / 2 - who.y) > MAX_DIST) return 'Muito longe';
  return replace ? { replace } : null;
}
export const MAX_DIST = 22;

// roofs: over anything built (walls, furniture, floors) or open ground; never over rock, water, trees or under a
// mountain ceiling; a support (planned or finished) within 6 tiles
export const NO_SUPPORT = 'Sem apoio: precisa de parede, coluna ou rocha a até 6 tiles';
function roofReason(game, type, tx, ty, who) {
  const w = game.world;
  if (!w.inBounds(tx, ty) || tx < 1 || ty < 1 || tx >= w.W - 1 || ty >= w.H - 1) return 'Fora do mapa';
  const i = w.idx(tx, ty);
  if (w.rock[i]) return 'Rocha no caminho';
  if (w.water[i]) return 'Não dá para construir na água';
  if (w.roof[i]) return 'Já tem teto de rocha';
  if (game.build.grid.roof.get(i)) return 'exists';
  for (const o of objectsOnTile(game, tx, ty)) if (o.type.startsWith('tree_') && !o.stump) return 'Árvore no caminho';
  if (!roofSupported(game, tx, ty, false)) return NO_SUPPORT;
  if (who && Math.hypot(tx + 0.5 - who.x, ty + 0.5 - who.y) > MAX_DIST) return 'Muito longe';
  return null;
}
// a valid style id for a roof type (unknown → the type's default)
export function cleanStyle(type, style) {
  const st = ROOF_STYLES[style];
  return st && st.type === type ? style : defaultRoofStyle(type);
}
const BAD_FARM = new Set([G.STONE, G.SAND, G.GRAVEL]);

const addTo = (acc, items) => { for (const k in items) if (items[k] > 0) acc[k] = (acc[k] || 0) + items[k]; return acc; };
const nonEmpty = (o) => (Object.keys(o).length ? o : undefined);
const near = (e, o, r) => !e || Math.hypot(e.x - o.x, e.y - (o.cy ?? o.y)) <= r + Math.max(o.fw || 1, o.fh || 1) / 2;

defineIntent('build.place', {
  doc: 'Place free blueprints of `type` on tiles with orientation `rot` and look style / det (materials are delivered later, when work starts). A door may replace a wall (wall refunded). Looks are fixed once built.',
  args: { type: 'buildingId', tiles: '[[tx, ty]] (≤ 140)', rot: 'int?', style: 'styleId?', det: 'detailString?', lv: 'story 0..3? (levels)' },
  run(game, a, actor, net) {
    const def = BUILDINGS[a.type];
    if (!def) return 'Construção desconhecida';
    const lv = def.roof ? 0 : Math.max(0, Math.min(3, num(a.lv) | 0)); // levels: the story of the whole drag
    const tiles = Array.isArray(a.tiles) ? a.tiles.slice(0, MAX_TILES) : [];
    if (!tiles.length) return 'Nada para construir';
    const rot = normRot(a.type, num(a.rot));
    const style = normStyle(a.type, a.style), det = cleanDet(a.type, a.det);
    const list = [], seen = new Set();
    let first = null;
    for (const t of tiles) {
      const tx = num(t?.[0]) | 0, ty = num(t?.[1]) | 0, key = tx + ',' + ty;
      if (seen.has(key)) continue;
      seen.add(key);
      let r = placeReason(game, a.type, tx, ty, actor.ent, rot, null, lv);
      if (r && typeof r === 'object') {
        const old = r.replace;
        net.emit('struct.remove', { id: old.id, by: actor.pid, give: old.paid ? nonEmpty(addTo({}, defOf(old).cost)) : undefined, giveAt: [r3(old.x), r3(old.y - 0.2)], quiet: 1 });
        r = null;
      }
      if (r) { first ||= r === 'exists' ? 'Já existe uma construção aqui' : r; continue; }
      list.push([net.newId('s'), a.type, tx, ty, Math.floor(net.roll() * 1000), 0, Math.round(game.worldTime), rot, costEmpty(def) ? 1 : 0, 0, style, det]);
    }
    if (!list.length) return first || 'Local inválido';
    net.emit('struct.add', lv ? { list, by: actor.pid, lv } : { list, by: actor.pid });
    return { placed: list.length };
  },
});

defineIntent('build.move', {
  doc: '"Mover": a plan to move a finished structure to (tx, ty, rot); when it is built the object moves keeping its state.',
  args: { id: 'structId', tx: 'int', ty: 'int', rot: 'int?' },
  run(game, a, actor, net) {
    const src = structById(game, a.id);
    if (!src || src.blueprint || src.moveOf) return 'Não dá para mover isto';
    const def = defOf(src);
    if (!def.move) return 'Isto não pode ser movido';
    const tx = num(a.tx) | 0, ty = num(a.ty) | 0, rot = normRot(src.type, num(a.rot));
    if (tx === src.tx && ty === src.ty && rot === (src.rot | 0)) return 'Já está aqui';
    const r = placeReason(game, src.type, tx, ty, actor.ent, rot, src, src.lv | 0);
    if (r) return r === 'exists' ? 'Já existe uma construção aqui' : typeof r === 'string' ? r : 'Local inválido';
    for (const b of game.build.structures.filter((q) => q.moveOf === src.id)) net.emit('struct.remove', { id: b.id, quiet: 1 });
    net.emit('struct.add', { list: [[net.newId('s'), src.type, tx, ty, src.v | 0, 0, Math.round(game.worldTime), rot, 1, src.id, src.style || '', src.det || '']], by: actor.pid, lv: src.lv | 0 || undefined }); // levels: same story
  },
});

defineIntent('build.hit', {
  doc: 'Work on a blueprint. start: deliver the materials (pay: already taken from the actor) and clear the footprint, or refuse; inc: progress; final: complete it.',
  args: { id: 'structId', start: 'bool?', pay: '0|1?', inc: 'number?', final: 'bool?' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o || !o.blueprint) return 'Já foi construído';
    const def = defOf(o);
    if (a.start) {
      if (!o.paid && !a.pay) return 'Falta material';
      if (def.roof) {
        if (!roofSupported(game, o.tx, o.ty, true)) return 'Sem apoio: termine as paredes ou colunas perto (até 6 tiles)';
        if (a.pay && !o.paid) net.emit('struct.paid', { id: o.id, by: actor.pid });
        else if (a.pay) net.emit('struct.paid', { id: o.id, by: actor.pid, give: nonEmpty(addTo({}, def.cost)), quiet: 1 });
        return;
      }
      const ids = [], give = {};
      if (o.lv) { const why = game.levels?.buildStartReason(o); if (why) return why; } // levels: the floor under it first
      for (let y = o.ty; y < o.ty + o.fh; y++) for (let x = o.tx; x < o.tx + o.fw; x++) {
        if (!o.lv) for (const n of objectsOnTile(game, x, y)) {
          if (CLEARABLE.has(n.type)) { ids.push(n.id); addTo(give, CLEAR_YIELD[n.type] || {}); }
          else if (n.type !== 'crop') return 'Algo está no caminho';
        }
        if (o.moveOf) { // the target of a move must still be free (other plans may have been built there)
          const cur = game.build.grid[def.layer].get(game.world.idx(x, y) + (o.lv | 0) * game.world.W * game.world.H);
          if (cur && cur.id !== o.moveOf) return 'Já existe uma construção aqui';
        }
      }
      if (a.pay) {
        if (!o.paid) net.emit('struct.paid', { id: o.id, by: actor.pid });
        else net.emit('struct.paid', { id: o.id, by: actor.pid, give: nonEmpty(addTo({}, def.cost)), quiet: 1 }); // delivered twice: back
      }
      if (def.layer !== 'floor' && !o.lv) for (let y = o.ty; y < o.ty + o.fh; y++) for (let x = o.tx; x < o.tx + o.fw; x++) if (cropAt(game, x, y)) net.emit('crop.remove', { tx: x, ty: y });
      if (ids.length) net.emit('obj.remove', { ids, fx: 'clear', by: actor.pid, give: nonEmpty(give), giveAt: [r3(o.x), r3(o.y - 0.2)] });
      return;
    }
    if (!o.paid) return 'Falta material';
    if (!a.final) {
      const inc = Math.max(0, Math.min(1, num(a.inc)));
      net.emit('struct.progress', { id: o.id, p: r3(Math.min(0.999, (o.progress || 0) + inc)), by: actor.pid });
      return;
    }
    if ((o.progress || 0) < 0.85) return 'Ainda não terminou';
    if (o.moveOf) {
      const src = structById(game, o.moveOf);
      if (!src || src.blueprint) { net.emit('struct.remove', { id: o.id, quiet: 1 }); return 'O objeto não existe mais'; }
      const r = placeReason(game, src.type, o.tx, o.ty, null, o.rot, src, o.lv | 0);
      if (r) return typeof r === 'string' && r !== 'exists' ? r : 'Algo está no caminho';
      net.emit('struct.relocate', { id: o.id, src: src.id, by: actor.pid, xp: 2, toast: `${def.name} ${def.g === 'm' ? 'movido' : 'movida'}` });
      return;
    }
    const msg = msgBuilt(def);
    net.emit('struct.complete', { id: o.id, by: actor.pid, xp: def.xp || 3, toast: o.type === 'bed' ? msg + ' · ponto de renascimento definido' : msg, respawn: o.type === 'bed' ? o.id : undefined });
  },
});

defineIntent('build.decon', {
  doc: 'Mark / unmark structures for deconstruction (on: null toggles each). Blueprints are cancelled at once (delivered materials back).',
  args: { ids: '[structId] (≤ 400)', on: '0|1|null' },
  run(game, a, actor, net) {
    const ids = Array.isArray(a.ids) ? a.ids.slice(0, 400) : [];
    const set = [], clear = [];
    for (const id of ids) {
      const o = structById(game, id);
      if (!o) continue;
      if (o.blueprint) {
        if (a.on === 0) continue;
        const def = defOf(o);
        net.emit('struct.remove', { id: o.id, by: actor.pid, give: o.paid && !o.moveOf ? nonEmpty(addTo({}, def.cost)) : undefined, giveAt: [r3(o.x), r3(o.y - 0.2)],
          toast: o.moveOf ? 'Mudança cancelada' : `${def.name}: planta cancelada`, toastKind: 'info' });
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

defineIntent('struct.raze', {
  doc: '"Arrasar" (campfires): removed at once next to the actor; only the stones come back (half).',
  args: { id: 'structId' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o) return 'Não existe mais';
    const def = defOf(o);
    if (!def.raze || o.blueprint) return 'Não dá para arrasar isto';
    if (!near(actor.ent, o, 2.6)) return 'Chegue mais perto';
    const back = {};
    if (def.cost.pebble) back.pebble = Math.floor(def.cost.pebble * 0.5);
    net.emit('struct.remove', { id: o.id, by: actor.pid, give: nonEmpty(addTo({}, back)), giveAt: [r3(o.x), r3(o.y - 0.2)], fx: 'raze',
      toast: `${def.name} ${def.g === 'm' ? 'arrasado' : 'arrasada'}`, toastKind: 'info' });
  },
});

// is any player / creature (other than none) inside the door tile? (closing would trap it)
function doorBusy(game, o) {
  const x0 = o.tx, y0 = o.ty, x1 = o.tx + (o.fw || 1), y1 = o.ty + (o.fh || 1);
  const inside = (e) => e && !e.dead && Math.round(e.z || 0) === (o.lv | 0) && e.x + (e.r || 0.25) * 0.8 > x0 && e.x - (e.r || 0.25) * 0.8 < x1 && e.y + (e.r || 0.25) * 0.8 > y0 && e.y - (e.r || 0.25) * 0.8 < y1;
  for (const p of allPlayers(game)) if (inside(p)) return true;
  for (const e of game.entities) if (e.isMob && !e.proxy && inside(e)) return true;
  return false;
}

defineIntent('door.toggle', {
  doc: 'Open / close a door or gate next to the actor (only by an explicit action; open: wanted state, null toggles). Closing is refused while someone stands in it.',
  args: { id: 'structId', open: '0|1|null' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o || !o.door) return 'Não é uma porta';
    if (o.blueprint) return 'A porta ainda não foi construída';
    if (!near(actor.ent, o, 2.4)) return 'Chegue mais perto';
    const want = a.open == null ? !o.open : !!a.open;
    if (want === !!o.open) return;
    if (!want && doorBusy(game, o)) return 'Tem alguém na passagem';
    net.emit('door.set', { id: o.id, open: want ? 1 : 0, by: actor.pid });
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

// one shared-sort path for every shared container: chests (→ chest.set) and bodies (mut/corpses.js → corpse.set)
defineIntent('store.sort', {
  doc: 'Sort a shared container (stacks merged): kind chest (default) | corpse, mode name | type | qty. The host computes the order; it travels in chest.set / corpse.set.',
  args: { kind: "'chest'|'corpse'?", id: 'structId|corpseId', mode: "'name'|'type'|'qty'" },
  run(game, a, actor, net) {
    if (a.kind === 'corpse') return sortBody(game, a, actor, net);
    const o = chestOf(game, a.id);
    if (!o) return 'Baú não existe mais';
    if (!SORT_MODES.includes(a.mode)) return 'Ordem desconhecida';
    net.emit('chest.set', { id: o.id, slots: sortedSlots(o.store.slots, o.store.size, a.mode), by: actor.pid, quiet: 1 });
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
