// World snapshot = the world part of the save file AND the join / resync message (docs/SYNC.md §3.8):
// "anything persisted is replicated at join" by construction.
//
// serializeWorld(game, { save }) -> {
//   v, build, seed, seq, wt, env:{h,d,w},
//   gone:   [worldgen ids removed],
//   nat:    [[id, stump, stumpAt, prog]],                                  // modified worldgen objects
//   dyn:    [[id, type, x, y, v, s, f, born, stump, stumpAt, solid]],      // host-created flora
//   falling:[[id, fall, dir]],
//   mined:  [tileIdx...],  rockp: [[i, p]],
//   structs:[[id, type, tx, ty, v, progress, decon, store|0, working, builtAt, rot, paid, open, moveOf, style, det]],
//           (rows of 10 = older saves: rot 0, paid 1, closed, no move plan; rows of 14 = no style / details)
//   crops:  [[tx, ty, kind, growth, stage]],
//   loot:   [[id, item, qty, x, y]],
//   props:  [[id, hp, broken, brokenAt]],
//   corpses:[[id, of, x, y, f, deathT, size, slots|0, butchered, owner|0, name|0, look|0, sc, v, gear|0, 0]]  (mut/corpses.js)
//   ids, natpos                                                            // save file only
// }
// applyWorld(game, data, mode): mode 'load' (save file on a fresh world) or 'net' (join and RESYNC:
// reconcile — remove what is not in the snapshot, add what is missing, overwrite the rest; never un-mine).
// Runs inside net.applying (world mutation guard).

import { BUILDINGS, ITEMS, ITEM_ALIASES } from '../game/data.js';
import { BUILD } from './netlog.js';
import { occAdd, occRemove } from '../game/nav.js';
import { updateAllMasks } from '../game/autotile.js';
import { makeFloraObject, removeNatural, makeStump, TREE_SOLID, findObj } from '../game/mut/objects.js';
import { placeStructure, completeStructure, removeStructure, setWorking, setDoorOpen, dimsOf } from '../game/mut/structures.js';
import { applyKitFields } from '../game/mut/kit.js';
import { plantCrop, removeCrop, stageOf, CROPS } from '../game/mut/crops.js';
import { addLootRows, removeLoot } from '../game/mut/loot.js';
import { mineTile } from '../game/mut/tiles.js';
import { propById, setPropBroken } from '../game/mut/camps.js';
import { corpseRow, addCorpse, removeCorpse } from '../game/mut/corpses.js';

export const SNAP_V = 1;
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const r3 = (v) => Math.round((v || 0) * 1000) / 1000;

export function serializeWorld(game, { save = false } = {}) {
  const w = game.world, net = game.net;
  const gone = [], nat = [], natpos = {};
  for (const o of game.touched.values()) {
    if (o.flora || o.building || o.type === 'crop') continue;
    if (o.gone) gone.push(o.id);
    else if (o.stump || o.prog) nat.push([o.id, o.stump ? 1 : 0, Math.round(o.stumpAt || 0), r3(o.prog)]);
    else continue;
    if (save) natpos[o.id] = [o.type, r2(o.x), r2(o.y)];
  }
  const dyn = [];
  for (const o of game.flora.dyn.values()) {
    if (o.gone) continue;
    dyn.push([o.id, o.type, r3(o.x), r3(o.y), o.v | 0, r3(o.s || 1), o.f || 1, o.born == null ? null : Math.round(o.born), o.stump ? 1 : 0, Math.round(o.stumpAt || 0), o.solid > 0 ? 1 : 0]);
  }
  const data = {
    v: SNAP_V, build: BUILD, seed: w.seed, seq: net.seq, wt: Math.round(game.worldTime * 100) / 100,
    env: { h: +game.env.hour.toFixed(3), d: game.env.dayIndex, w: game.env.weather },
    gone, nat, dyn,
    falling: game.falling.filter((o) => !o.gone).map((o) => [o.id, r3(o.fall), o.fallDir || 1]),
    mined: game.minedTiles.slice(),
    rockp: [...game.rockHits].map(([i, p]) => [i, r3(p)]),
    structs: game.build.structures.map((o) => [o.id, o.type, o.tx, o.ty, o.v | 0, r3(o.progress), game.build.decon.has(o) ? 1 : 0,
      o.store ? o.store.toJSON() : 0, o.working ? 1 : 0, Math.round(o.builtAt || 0), o.rot | 0, o.paid ? 1 : 0, o.open ? 1 : 0, o.moveOf || 0, o.style || '', o.det || '']),
    crops: [...game.farm.crops.values()].map((c) => [c.tx, c.ty, c.kind, r3(c.growth), c.stage]),
    loot: game.loot.filter((l) => l.qty > 0 && (!save || l.t < 240)).slice(save ? -80 : 0).map((l) => [l.id, l.item, l.qty, r2(l.x), r2(l.y)]),
    props: (game.props || []).filter((o) => o.broken || o.hp !== o.maxHp).map((o) => [o.id, o.hp | 0, o.broken ? 1 : 0, Math.round(o.brokenAt || 0)]),
    corpses: game.corpses ? [...game.corpses.map.values()].map((c) => corpseRow(c)) : [],
  };
  if (save) { data.ids = { ...net.ids }; data.natpos = natpos; }
  return data;
}

// find a natural object saved as (id, type, x, y): exact id first, then the same type at the same spot
export function findNatural(w, id, type, x, y) {
  const o = w.objById.get(id);
  if (o && !o.building && !o.flora && (!type || (o.type === type && Math.abs(o.x - x) < 0.6 && Math.abs(o.y - y) < 0.6))) return o;
  if (!type) return null;
  const near = w.query(x, y, 0.6, (q) => q.type === type && !q.building && !q.flora);
  return near[0] || null;
}

const arr = (a) => (Array.isArray(a) ? a : []);

export function applyWorld(game, d, mode = 'net') {
  if (!d || typeof d !== 'object') return false;
  game.net.withApply(() => applyInner(game, d, mode));
  return true;
}

function applyInner(game, d, mode) {
  const w = game.world, net = game.net;
  const reconcile = mode === 'net';
  if (Number.isFinite(d.wt)) game.worldTime = d.wt;
  if (d.env) {
    if (Number.isFinite(d.env.h)) game.env.hour = d.env.h;
    if (Number.isFinite(d.env.d)) game.env.dayIndex = d.env.d;
    if (typeof d.env.w === 'string' && d.env.w !== game.env.weather) game.env.setWeather?.(d.env.w);
  }

  // ---- mined tiles (never un-mine) & mining progress ----
  for (const i of arr(d.mined)) {
    if (!Number.isInteger(i) || i < 0 || i >= w.W * w.H) continue;
    if (w.rock[i] === 1) mineTile(game, i % w.W, Math.floor(i / w.W));
  }
  game.rockHits.clear();
  for (const [i, p] of arr(d.rockp)) if (w.rock[i] === 1) game.rockHits.set(i, p);

  // ---- natural worldgen objects ----
  const resolve = (id) => {
    const pos = d.natpos?.[id];
    return mode === 'load' && pos ? findNatural(w, id, pos[0], pos[1], pos[2]) : findObj(game, id) || (game.touched.get(id) || null);
  };
  const goneSet = new Set(), natMap = new Map();
  for (const id of arr(d.gone)) goneSet.add(id);
  for (const r of arr(d.nat)) natMap.set(r[0], r);
  if (reconcile) {
    // undo local changes the authority does not have (desync repair)
    for (const o of [...game.touched.values()]) {
      if (o.flora || o.building) continue;
      if (o.gone && !goneSet.has(o.id)) {
        o.gone = false;
        w.addObject(o);
        if (o.solid && !o.stump) occAdd(game, o);
      }
      if (!o.gone && o.stump && !natMap.get(o.id)?.[1]) {
        o.stump = false; o.prog = 0; o.stumpAt = 0;
        if (o.type.startsWith('tree_')) { o.solid = TREE_SOLID[o.type] || 0.18; occAdd(game, o); }
        game.stumps.delete(o);
      }
      if (!natMap.has(o.id) && o.prog) o.prog = 0;
    }
  }
  for (const id of goneSet) {
    const o = resolve(id);
    if (o && !o.gone && !o.building) removeNatural(game, o);
  }
  for (const [id, stump, stumpAt, prog] of natMap.values()) {
    const o = resolve(id);
    if (!o || o.gone || o.building) continue;
    if (stump && !o.stump) makeStump(game, o, stumpAt || Math.round(game.worldTime));
    else if (stump) o.stumpAt = stumpAt;
    o.prog = prog || 0;
    game.touched.set(o.id, o);
  }

  // ---- host-created flora ----
  const dynIds = new Set();
  for (const r of arr(d.dyn)) {
    const [id, type, x, y, v, s, f, born, stump, stumpAt, solid] = r;
    if (typeof id !== 'string' || typeof type !== 'string') continue;
    dynIds.add(id);
    let o = game.flora.dyn.get(id);
    if (o && (o.type !== type || Math.abs(o.x - x) > 0.01 || Math.abs(o.y - y) > 0.01)) { removeNatural(game, o); o = null; }
    if (!o) {
      const tx = Math.floor(x), ty = Math.floor(y - 0.05);
      if (!w.inBounds(tx, ty) || w.rock[w.idx(tx, ty)]) continue;
      o = makeFloraObject(game, type, x, y, { id, v, s, f, born: born ?? undefined, solid: solid == null ? undefined : !!solid });
    } else if (!stump && solid && !o.solid && type.startsWith('tree_')) { o.solid = TREE_SOLID[type] || 0.18; occAdd(game, o); }
    if (stump && !o.stump) makeStump(game, o, stumpAt);
    net.seeId(id);
  }
  if (reconcile) for (const o of [...game.flora.dyn.values()]) if (!dynIds.has(o.id)) removeNatural(game, o);

  // ---- falling trees ----
  const oldFalling = game.falling.slice();
  game.falling.length = 0;
  const fallIds = new Set();
  for (const [id, fall, dir] of arr(d.falling)) {
    const o = findObj(game, id);
    if (!o || o.gone || o.stump) continue;
    o.fall = Math.max(0.001, fall); o.fallDir = dir; o.prog = 0;
    occRemove(game, o);
    game.falling.push(o);
    fallIds.add(id);
  }
  for (const o of oldFalling) if (!fallIds.has(o.id) && !o.gone && !o.stump) { o.fall = 0; if (o.solid) occAdd(game, o); }

  // ---- structures ----
  const sIds = new Map();
  for (const r of arr(d.structs)) if (Array.isArray(r) && BUILDINGS[r[1]]) sIds.set(r[0], r);
  if (reconcile) {
    for (const o of [...game.build.structures]) {
      const r = sIds.get(o.id);
      // a finished structure the authority still has as a blueprint is rebuilt from scratch
      const same = r && r[1] === o.type && r[2] === o.tx && r[3] === o.ty && (r[10] | 0) === (o.rot | 0) && (r[13] || 0) === (o.moveOf || 0) && (o.blueprint || r[5] >= 1);
      if (!same) removeStructure(game, o, { quiet: true });
    }
  }
  for (const r of sIds.values()) {
    const [id, type, tx, ty, v, progress, decon, store, working, builtAt] = r;
    const legacy = r.length <= 10;
    const rot = legacy ? 0 : r[10] | 0, paid = legacy ? 1 : r[11] ? 1 : 0, open = !legacy && !!r[12], moveOf = (!legacy && r[13]) || undefined;
    const style = typeof r[14] === 'string' ? r[14] : '', det = typeof r[15] === 'string' ? r[15] : '';
    let o = game.world.objById.get(id);
    if (o && !o.building) continue;
    if (o && !game.build.structures.includes(o)) { removeStructure(game, o, { quiet: true }); o = null; } // orphan: rebuild
    if (!o) {
      const def = BUILDINGS[type];
      const [fw, fh] = dimsOf(type, rot);
      let ok = true;
      for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
        if (!w.inBounds(x, y) || w.rock[w.idx(x, y)] || (!moveOf && game.build.grid[def.layer].has(w.idx(x, y)))) ok = false;
      }
      if (!ok) continue;
      o = placeStructure(game, type, tx, ty, { id, v, progress, builtAt, store: store || undefined, decon: !!decon, working: !!working, rot, paid, open, moveOf, style, det });
    } else {
      if (o.blueprint && progress >= 1) completeStructure(game, o, { silent: true, auth: net.auth });
      else if (o.blueprint) o.progress = Math.min(0.999, progress);
      if (decon) game.build.decon.add(o); else game.build.decon.delete(o);
      if (o.store && store) o.store.load(store);
      if (o.station) setWorking(game, o, !!working);
      if (paid && o.blueprint) o.paid = true;
      if (o.door && !!o.open !== open) setDoorOpen(game, o, open);
      if ((o.style || '') !== style || (o.det || '') !== det) applyKitFields(game, o, style, det); // masks: updateAllMasks below
    }
    net.seeId(id);
  }

  // ---- crops ----
  const cKeys = new Set();
  for (const [tx, ty, kind, growth, stage] of arr(d.crops)) {
    if (!CROPS[kind] || !w.inBounds(tx, ty)) continue;
    const i = w.idx(tx, ty);
    cKeys.add(i);
    let c = game.farm.crops.get(i);
    if (c && c.kind !== kind) { removeCrop(game, c); c = null; }
    if (!c) {
      const plot = game.build.grid.floor.get(i);
      if (!plot || plot.type !== 'farm_plot') continue;
      c = plantCrop(game, kind, tx, ty, growth || 0, game.worldTime);
    }
    c.growth = growth || 0;
    c.stage = Number.isInteger(stage) ? stage : stageOf(c.growth);
  }
  if (reconcile) for (const [i, c] of [...game.farm.crops]) if (!cKeys.has(i)) removeCrop(game, c);

  // ---- ground items ----
  const lIds = new Set();
  const add = [];
  for (const r of arr(d.loot)) {
    const [id, item0, qty, x, y] = r;
    const item = ITEM_ALIASES[item0] || item0;
    if (!ITEMS[item]) continue;
    lIds.add(id);
    const ex = game.loot.find((l) => l.id === id);
    if (ex) { ex.qty = qty; continue; }
    add.push([id, item, qty, x, y, 0, 0, 0, 1]);
    net.seeId(id);
  }
  if (reconcile) for (const l of [...game.loot]) if (!lIds.has(l.id)) removeLoot(game, l.id);
  addLootRows(game, add);

  // ---- camp crates ----
  const pIds = new Set();
  for (const [id, hp, broken, brokenAt] of arr(d.props)) {
    const o = propById(game, id);
    if (!o) continue;
    pIds.add(id);
    if (broken) setPropBroken(game, o, true, brokenAt);
    else { setPropBroken(game, o, false); o.hp = hp; }
  }
  if (reconcile) for (const o of game.props || []) if (!pIds.has(o.id) && (o.broken || o.hp !== o.maxHp)) { setPropBroken(game, o, false); o.hp = o.maxHp; }

  // ---- bodies on the ground ----
  if (game.corpses) {
    const cIds = new Set();
    for (const r of arr(d.corpses)) {
      if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
      cIds.add(r[0]);
      addCorpse(game, r, { fresh: false });
      net.seeId(r[0]);
    }
    if (reconcile) for (const c of [...game.corpses.map.values()]) if (!cIds.has(c.id)) removeCorpse(game, c);
  }

  updateAllMasks(game);
  if (d.ids && typeof d.ids === 'object') for (const k in d.ids) if (k in net.ids && Number.isFinite(d.ids[k])) net.ids[k] = Math.max(net.ids[k], d.ids[k]);
  game.events?.emit('worldreset', {});
}
