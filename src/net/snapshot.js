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
//   lvs:    [[structId, lv]]   (levels, agent L: structures above the ground; absent = every one on level 0)
//   terr:   [cornerIdx, h×100, …]  terrain edits vs the generated terrain (world/height.js diff; docs/TERRAIN-HEIGHT.md)
//   bzs:    [[structId, bz×100]]  the base height a building's story 0 stands on (terrain height)
//           (rows of 10 = older saves: rot 0, paid 1, closed, no move plan; rows of 14 = no style / details)
//   crops:  [[tx, ty, kind, growth, stage]],
//   loot:   [[id, item, qty, x, y]],
//   props:  [[id, hp, broken, brokenAt]],
//   corpses:[[id, of, x, y, f, deathT, size, slots|0, butchered, owner|0, name|0, look|0, sc, v, gear|0, 0]]  (mut/corpses.js)
//   paths:  { g, p }  painted paths: run-length [value, count…] of world.path / world.pathPlan (mut/paths.js)
//   ids, natpos                                                            // save file only
//   stock:  [[species, x, y, variant, fed, bornAt, adultAt|0, breedAt, scale, level, hp]]  owned farm animals (save file only, livestock.js)
//   boats:  [[id, x, y, h, v, at, seats|0, pets|0]]  boats (game/boats.js; a save drops the riders: 0)
// }
// applyWorld(game, data, mode): mode 'load' (save file on a fresh world) or 'net' (join and RESYNC:
// reconcile — remove what is not in the snapshot, add what is missing, overwrite the rest; never un-mine).
// Runs inside net.applying (world mutation guard).
// Interest (net/interest.js, docs/STREAMING.md §8): serializeWorld(game, { keep(x, y), skipped }) leaves out the LOCAL rows
// (natural objects, flora, falling trees, mined tiles, structures, crops, ground items) whose place fails keep and lists
// their chunks in `skipped`; the global parts (clock, camp crates, bodies, paths, terrain edits, boats) always go.
// applyWorld(game, data, 'chunk', scope) applies such a diff of the chunks in `scope` (a Set): reconcile only there,
// nothing global touched.

import { BUILDINGS, ITEMS, ITEM_ALIASES } from '../game/data.js';
import { setYearLength } from '../game/calendar.js';
import { BUILD } from './netlog.js';
import { occAdd, occRemove } from '../game/nav.js';
import { updateAllMasks } from '../game/autotile.js';
import { makeFloraObject, removeNatural, makeStump, TREE_SOLID, findObj } from '../game/mut/objects.js';
import { placeStructure, completeStructure, removeStructure, setWorking, setDoorOpen, dimsOf } from '../game/mut/structures.js';
import { applyKitFields } from '../game/mut/kit.js';
import { plantCrop, removeCrop, stageOf, CROPS } from '../game/mut/crops.js';
import { addLootRows, removeLoot } from '../game/mut/loot.js';
import { mineTile } from '../game/mut/tiles.js';
import { propById, setPropBroken, campStateRows, applyCampState } from '../game/mut/camps.js';
import { corpseRow, addCorpse, removeCorpse } from '../game/mut/corpses.js';
import { serializePaths, applyPaths } from '../game/mut/paths.js';
import { stockRows, stashStock } from '../game/livestock.js'; // owned farm animals (save file only)

export const SNAP_V = 1;
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const r3 = (v) => Math.round((v || 0) * 1000) / 1000;

const XM_ = 16383;
export function serializeWorld(game, { save = false, keep = null, skipped = null } = {}) {
  const w = game.world, net = game.net;
  // (interest: a row is kept when its place passes `keep`; the chunks of the others go to `skipped`)
  const K = !keep ? () => true : (x, y) => { if (keep(x, y)) return true; skipped?.add(w.chunkIndex(x, y)); return false; };
  const KI = (i) => K((i & XM_) + 0.5, (i >>> 14) + 0.5);
  const gone = [], nat = [], natpos = {};
  for (const o of game.touched.values()) {
    if (o.flora || o.building || o.type === 'crop') continue;
    if (!K(o.x, o.y)) continue;
    if (o.gone) gone.push(o.id);
    else if (o.stump || o.prog) nat.push([o.id, o.stump ? 1 : 0, Math.round(o.stumpAt || 0), r3(o.prog)]);
    else continue;
    if (save) natpos[o.id] = [o.type, r2(o.x), r2(o.y)];
  }
  const dyn = [];
  for (const o of game.flora.dyn.values()) {
    if (o.gone || !K(o.x, o.y)) continue;
    dyn.push([o.id, o.type, r3(o.x), r3(o.y), o.v | 0, r3(o.s || 1), o.f || 1, o.born == null ? null : Math.round(o.born), o.stump ? 1 : 0, Math.round(o.stumpAt || 0), o.solid > 0 ? 1 : 0]);
  }
  const data = {
    v: SNAP_V, build: BUILD, seed: w.seed, seq: net.seq, wt: Math.round(game.worldTime * 100) / 100,
    env: { h: +game.env.hour.toFixed(3), d: game.env.dayIndex, w: game.env.weather },
    gone, nat, dyn,
    falling: game.falling.filter((o) => !o.gone && K(o.x, o.y)).map((o) => [o.id, r3(o.fall), o.fallDir || 1]),
    mined: keep ? game.minedTiles.filter(KI) : game.minedTiles.slice(),
    rockp: [...game.rockHits].filter(([i]) => KI(i)).map(([i, p]) => [i, r3(p)]),
    structs: structsOf(game, K).map((o) => [o.id, o.type, o.tx, o.ty, o.v | 0, r3(o.progress), game.build.decon.has(o) ? 1 : 0,
      o.store ? o.store.toJSON() : 0, o.working ? 1 : 0, Math.round(o.builtAt || 0), o.rot | 0, o.paid ? 1 : 0, o.open ? 1 : 0, o.moveOf || 0, o.style || '', o.det || '']),
    crops: [...game.farm.crops.values()].filter((c) => K(c.tx + 0.5, c.ty + 0.5)).map((c) => [c.tx, c.ty, c.kind, r3(c.growth), c.stage]),
    loot: game.loot.filter((l) => l.qty > 0 && (!save || l.t < 240) && K(l.x0 ?? l.x, l.y0 ?? l.y)).slice(save ? -80 : 0).map((l) => [l.id, l.item, l.qty, r2(l.x), r2(l.y)]),
    props: campStateRows(game), // (camp crates: the shared state, loaded or not — mut/camps.js)
    corpses: game.corpses ? [...game.corpses.map.values()].map((c) => corpseRow(c)) : [],
    paths: serializePaths(game),
    mode: game.creative ? 'creative' : undefined, // world game mode (creative.js): the host's world decides for everyone
    year: game.yearLen && game.yearLen !== 'short' ? game.yearLen : undefined, // the world's year length (calendar.js)
  };
  const SK = keep ? new Set(data.structs.map((r) => r[0])) : null, inS = (o) => !SK || SK.has(o.id);
  const lvs = game.build.structures.filter((o) => o.lv > 0 && inS(o)).map((o) => [o.id, o.lv | 0]); // levels: upper stories
  if (lvs.length) data.lvs = lvs;
  // terrain height (docs/TERRAIN-HEIGHT.md): the players' terrain edits as a diff of the generated terrain, the bases
  // buildings stand on
  if (w.hasHeight) {
    const terr = w.height.diff();
    if (terr.length) data.terr = terr;
    const bzs = game.build.structures.filter((o) => Number.isFinite(o.bz) && inS(o)).map((o) => [o.id, Math.round(o.bz * 100)]);
    if (bzs.length) data.bzs = bzs;
  }
  // ballistas (game/ballista.js): where each points, its operator (never in a save: nobody is on it after a load)
  const ball = game.build.structures.filter((o) => o.type === 'ballista' && inS(o) && (Number.isFinite(o.aim) || o.user)).map((o) => [o.id, Number.isFinite(o.aim) ? Math.round(o.aim * 1e4) / 1e4 : null, !save && o.user ? o.user : 0]);
  if (ball.length) data.ball = ball;
  // boats (game/boats.js): pose and riders (a save drops the riders: everyone is ashore after a load)
  if (game.boats?.map.size) data.boats = [...game.boats.map.values()].map((b) => [b.id, r3(b.x), r3(b.y), r3(b.h), b.v | 0, Math.round(b.at || 0), save ? 0 : b.seats.slice(), save ? 0 : b.pets.map((q) => q.slice())]);
  if (save) { data.ids = { ...net.ids }; data.natpos = natpos; data.stock = stockRows(game); } // (stock: the farm's animals; guests see them in the entity stream)
  return data;
}

// the structures whose anchor tile passes K (all of them without a filter)
function structsOf(game, K) { return game.build.structures.filter((o) => K(o.tx + 0.5, o.ty + 0.5)); }

// a diff of the chunks in `scope` (interest: a guest coming near chunks it was not kept up to date on): the local rows
// of serializeWorld there, nothing global
export function serializeChunks(game, scope) {
  const w = game.world, d = serializeWorld(game, { keep: (x, y) => scope.has(w.chunkIndex(x, y)) });
  const out = { v: d.v, seq: d.seq, gone: d.gone, nat: d.nat, dyn: d.dyn, falling: d.falling, mined: d.mined, rockp: d.rockp, structs: d.structs, crops: d.crops, loot: d.loot };
  for (const k of ['lvs', 'bzs', 'ball']) if (d[k]) out[k] = d[k];
  return out;
}

// find a natural object saved as (id, type, x, y): exact id first, then the same type at the same spot
export function findNatural(w, id, type, x, y) {
  // (a streamed planet: the object's chunk may not be loaded — its id names it; or the saved position does)
  if (!w.objById.has(id) && w.wrap) { const c = w.source.chunkOfId?.(id) ?? -1; if (c >= 0) w.ensure(c); else if (Number.isFinite(x) && Number.isFinite(y)) w.ensure(w.chunkIndex(x, y)); }
  const o = w.objById.get(id);
  if (o && !o.building && !o.flora && (!type || (o.type === type && Math.abs(o.x - x) < 0.6 && Math.abs(o.y - y) < 0.6))) return o;
  if (!type) return null;
  const near = w.query(x, y, 0.6, (q) => q.type === type && !q.building && !q.flora);
  return near[0] || null;
}

const arr = (a) => (Array.isArray(a) ? a : []);

// rock at a tile for the checks of applyWorld: a streamed world loads the chunk first (an unloaded chunk reads as rock —
// a joiner far from the host's flora / buildings would drop them)
function rockAt(w, x, y) {
  if (w.wrap) w.ensure(w.chunkIndex(x, y));
  return w.rock.get(w.idx(x, y));
}

export function applyWorld(game, d, mode = 'net', scope = null) {
  if (!d || typeof d !== 'object') return false;
  game.net.withApply(() => applyInner(game, d, mode, scope));
  return true;
}

function applyInner(game, d, mode, scope = null) {
  const w = game.world, net = game.net;
  const chunk = mode === 'chunk'; // (a diff of the chunks in scope: net/interest.js)
  const reconcile = mode === 'net' || chunk;
  // reconcile only touches what is in scope (every place without one)
  const IN = !chunk ? () => true : (x, y) => scope.has(w.chunkIndex(x, y));
  if (!chunk) {
    game.creative = d.mode === 'creative';
    game.yearLen = setYearLength(d.year); // (missing = the short year of older worlds)
    if (Number.isFinite(d.wt)) game.worldTime = d.wt;
    if (d.env) {
      if (Number.isFinite(d.env.h)) game.env.hour = d.env.h;
      if (Number.isFinite(d.env.d)) game.env.dayIndex = d.env.d;
      if (typeof d.env.w === 'string' && d.env.w !== game.env.weather) game.env.setWeather?.(d.env.w);
    }
    // ---- terrain edits (docs/TERRAIN-HEIGHT.md; a snapshot without them = the generated terrain) ----
    if ((reconcile || d.terr) && w.hasHeight !== undefined && (d.terr || w.height.diff().length)) { w.height.applyDiff(arr(d.terr), true); game.terrainV = (game.terrainV || 0) + 1; }
  }

  // ---- mined tiles (never un-mine) & mining progress ----
  for (const i of arr(d.mined)) {
    if (!Number.isInteger(i) || i < 0 || i >= w.W * w.H) continue;
    if (w.rock.get(i) === 1) mineTile(game, i % w.W, Math.floor(i / w.W));
  }
  if (chunk) { for (const i of [...game.rockHits.keys()]) if (IN((i % w.W) + 0.5, Math.floor(i / w.W) + 0.5)) game.rockHits.delete(i); } else game.rockHits.clear();
  for (const [i, p] of arr(d.rockp)) if (w.rock.get(i) === 1) game.rockHits.set(i, p);

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
      if (o.flora || o.building || !IN(o.x, o.y)) continue;
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
      if (!w.inBounds(tx, ty) || rockAt(w, tx, ty)) continue;
      o = makeFloraObject(game, type, x, y, { id, v, s, f, born: born ?? undefined, solid: solid == null ? undefined : !!solid });
    } else if (!stump && solid && !o.solid && type.startsWith('tree_')) { o.solid = TREE_SOLID[type] || 0.18; occAdd(game, o); }
    if (stump && !o.stump) makeStump(game, o, stumpAt);
    net.seeId(id);
  }
  if (reconcile) for (const o of [...game.flora.dyn.values()]) if (!dynIds.has(o.id) && IN(o.x, o.y)) removeNatural(game, o);

  // ---- falling trees ----
  const oldFalling = game.falling.filter((o) => IN(o.x, o.y));
  if (chunk) { for (let k = game.falling.length - 1; k >= 0; k--) if (IN(game.falling[k].x, game.falling[k].y)) game.falling.splice(k, 1); } else game.falling.length = 0;
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
  const LVS = new Map(arr(d.lvs).filter((r) => Array.isArray(r)).map((r) => [r[0], Math.max(0, Math.min(3, r[1] | 0))])); // levels
  const BZS = new Map(arr(d.bzs).filter((r) => Array.isArray(r) && Number.isFinite(r[1])).map((r) => [r[0], r[1] / 100])); // terrain height: bases
  for (const r of arr(d.structs)) if (Array.isArray(r) && BUILDINGS[r[1]]) sIds.set(r[0], r);
  if (reconcile) {
    for (const o of [...game.build.structures]) {
      if (!IN(o.tx + 0.5, o.ty + 0.5)) continue;
      const r = sIds.get(o.id);
      // a finished structure the authority still has as a blueprint is rebuilt from scratch
      const same = r && (LVS.get(o.id) || 0) === (o.lv | 0) && r[1] === o.type && r[2] === o.tx && r[3] === o.ty && (r[10] | 0) === (o.rot | 0) && (r[13] || 0) === (o.moveOf || 0) && (o.blueprint || r[5] >= 1)
        && (r[14] || '') === (o.style || '') && (r[15] || '') === (o.det || '');
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
      const lv = LVS.get(id) || 0, off = lv * w.W * w.H; // levels: the story's grid keys
      for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
        if (!w.inBounds(x, y) || (!lv && rockAt(w, x, y)) || (!moveOf && game.build.grid[def.layer].has(w.idx(x, y) + off))) ok = false;
      }
      if (!ok) continue;
      o = placeStructure(game, type, tx, ty, { id, v, progress, builtAt, store: store || undefined, decon: !!decon, working: !!working, rot, paid, open, moveOf, style, det, lv, bz: BZS.get(id) });
    } else {
      if (BZS.has(id) && o.bz !== BZS.get(id)) { o.bz = BZS.get(id); game.build.v++; } // (terrain height: the base)
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

  // ---- ballistas: aim and operator (game/ballista.js) ----
  const BAL = new Map(arr(d.ball).filter((r) => Array.isArray(r)).map((r) => [r[0], r]));
  for (const o of game.build.structures) {
    if (o.type !== 'ballista' || !IN(o.tx + 0.5, o.ty + 0.5)) continue;
    const r = BAL.get(o.id);
    if (r && Number.isFinite(r[1])) o.aim = r[1]; else if (reconcile) delete o.aim;
    if (r && r[2] && reconcile) o.user = String(r[2]).slice(0, 40); else delete o.user;
  }

  // ---- boats (game/boats.js): add / update; a 'net' snapshot removes the ones it does not list ----
  if (game.boats && !chunk) {
    const Bt = game.boats, bIds = new Set();
    for (const r of arr(d.boats)) {
      if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
      const b = Bt.add(r);
      if (!b) continue;
      bIds.add(b.id);
      Bt.setRiders(b, Array.isArray(r[6]) ? r[6] : [0, 0, 0, 0, 0, 0], Array.isArray(r[7]) ? r[7] : [], null);
      if (!reconcile || Math.hypot(b._x - b.x, b._y - b.y) > 3) { b._x = b.x; b._y = b.y; b._h = b.h; b._buf = null; }
      net.seeId(b.id);
    }
    if (reconcile) for (const id of [...Bt.map.keys()]) if (!bIds.has(id)) Bt.remove(id);
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
  if (reconcile) for (const [i, c] of [...game.farm.crops]) if (!cKeys.has(i) && IN(c.tx + 0.5, c.ty + 0.5)) removeCrop(game, c);

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
  if (reconcile) for (const l of [...game.loot]) if (!lIds.has(l.id) && IN(l.x0 ?? l.x, l.y0 ?? l.y)) removeLoot(game, l.id);
  addLootRows(game, add);
  if (chunk) { updateAllMasks(game); game.events?.emit('worldpatch', { scope }); return; } // (nothing global in a chunk diff)

  // ---- camp crates ----
  applyCampState(game, arr(d.props), reconcile);
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
  // ---- painted paths (a snapshot without them = none; an old save without them keeps none) ----
  if (reconcile || d.paths) applyPaths(game, d.paths);
  if (mode === 'load') stashStock(game, d.stock); // owned farm animals: back on the host's first farm tick (livestock.js)

  updateAllMasks(game);
  if (d.ids && typeof d.ids === 'object') for (const k in d.ids) if (k in net.ids && Number.isFinite(d.ids[k])) net.ids[k] = Math.max(net.ids[k], d.ids[k]);
  game.events?.emit('worldreset', {});
}
