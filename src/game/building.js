// Building: placement modes (single / line / rectangle outline / filled area) with connected ghost
// previews, blueprints built over time by the player (action 'build', o.progress 0→1, non-blocking until
// done), deconstruction (refund 75%), doors / gates (world.solid = 2, o.open 0..1), structure use
// (chest, bed, crafting stations), floor speed bonus, noGrow stamps and decor clearing.
//
// Structure object: { id, type, v, tx, ty, x, y (base), s, f, building, layer, flat?, progress, blueprint?,
//   mask (autotile), orient ('h'|'v' doors), open (doors), working (stations), store (chest), light, fire }
// 1×1: x = tx + 0.5, y = ty + 1 · w×h: x = tx + w/2, y = ty + h. Round props collide at (x, cy).

import { BUILDINGS, ITEMS } from './data.js';
import { Inventory } from './inventory.js';
import { occAdd, occRemove } from './nav.js';
import { gainXp } from './player.js';
import { dropLoot } from './loot.js';
import { buildSprite } from './artcompat.js';
import { registerWork, hitsFor } from './gathering.js';
import { initGrids, gridAdd, gridRemove, footprint, computeMask, updateMasksAround, structureAt, DIRS4 } from './autotile.js';
import { noGrowStamp, removeNatural } from './flora.js';
import { collides } from './physics.js';
import { G } from '../world/worldgen.js';
import * as CW from '../art/composeWorld.js';

let nextId = 1;
const FRONT = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
const MAX_DIST = 22;       // placement distance from the player (tiles)
const MAX_TILES = 140;     // per drag
export const REFUND = 0.75;
const CLEARABLE = new Set(['pebble', 'stick', 'fibergrass', 'bush', 'berrybush', 'wild_potato', 'wild_cotton', 'wild_corn']);
const CLEAR_YIELD = { pebble: { pebble: 1 }, stick: { stick: 1 }, fibergrass: { fiber: 2 }, bush: { fiber: 2, stick: 1 }, berrybush: { berries: 2, stick: 1 },
  wild_potato: { potato: 1, seed_potato: 1 }, wild_cotton: { cotton: 2, seed_cotton: 1 }, wild_corn: { corn: 1, seed_corn: 1 } };
const BAD_FARM = new Set([G.STONE, G.SAND, G.GRAVEL]);

export function initBuilding(game) {
  game.build = { mode: null, structures: [], doors: [], decon: new Set(), v: 0 };
  initGrids(game);
}

export const defOf = (o) => BUILDINGS[o.type];
const msgBuilt = (def) => `${def.name} ${def.g === 'm' ? 'construído' : 'construída'}`;

export function frontTile(p) {
  const [fx, fy] = FRONT[p.facing] || FRONT.s;
  return [Math.floor(p.x + fx * 0.9), Math.floor(p.y - 0.1 + fy * 0.9)];
}

// ---------- natural objects on a tile ----------
function objectsOnTile(game, tx, ty) {
  const out = [];
  game.world.forChunks(tx - 1, ty - 1, tx + 2, ty + 2, (c) => {
    for (const o of c.objects) {
      if (o.building || o.gone) continue;
      if (Math.floor(o.x) === tx && Math.floor(o.y - 0.05) === ty) out.push(o);
    }
  });
  return out;
}

// ---------- placement validity ----------
// returns null when OK, else a pt-BR reason. `skipExisting` lets drags silently skip built tiles.
export function placeReason(game, type, tx, ty) {
  const def = BUILDINGS[type], w = game.world, p = game.player;
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
  if (Math.hypot(tx + sw / 2 - p.x, ty + sh / 2 - p.y) > MAX_DIST) return 'Muito longe';
  return replace ? { replace } : null;
}

// tiles for a drag from (ax, ay) to (bx, by)
function dragTiles(kind, ax, ay, bx, by) {
  const out = [];
  if (kind === 'area') {
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push([x, y]);
  } else if (ax !== bx && ay !== by) {
    // rectangle outline (a room)
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    for (let x = x0; x <= x1; x++) { out.push([x, y0]); out.push([x, y1]); }
    for (let y = y0 + 1; y < y1; y++) { out.push([x0, y]); out.push([x1, y]); }
  } else {
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    for (let k = 0; k <= n; k++) out.push([ax + sx * k, ay + sy * k]);
  }
  return out.slice(0, MAX_TILES);
}

// ---------- build mode ----------
export function enterBuildMode(game, type) {
  const p = game.player;
  if (p.dead) return;
  const def = BUILDINGS[type];
  if (!def) return;
  if (!p.inv.has(def.cost)) { game.events.emit('error', { text: 'Materiais insuficientes' }); return; }
  game.mining && (game.mining.mode = false);
  const [tx, ty] = frontTile(p);
  game.build.mode = { kind: 'place', type, hover: [tx, ty], anchor: null, end: null, locked: false, tiles: [], valid: false, reason: null, n: 0 };
  game.events.emit('buildui', {});
  const h = game.ctl?.hinted;
  if (def.drag && h && !h['drag_' + def.drag]) {
    h['drag_' + def.drag] = true;
    const touch = game.input.isTouch;
    game.events.emit('toast', {
      text: def.drag === 'line'
        ? (touch ? 'Toque no início e no fim: linha reta, ou na diagonal para uma sala' : 'Arraste para uma linha; na diagonal faz uma sala')
        : (touch ? 'Toque em dois cantos para cobrir uma área' : 'Arraste para cobrir uma área'),
      kind: 'info',
    });
  }
}

export function enterDeconMode(game) {
  if (game.player.dead) return;
  game.mining && (game.mining.mode = false);
  game.build.mode = { kind: 'decon', hover: null, anchor: null, end: null, tiles: [] };
  game.events.emit('buildui', {});
}

export function exitBuildMode(game) {
  if (!game.build.mode) return;
  game.build.mode = null;
  game.events.emit('buildui', {});
}

// recompute the ghost preview (called every frame while placing)
function updatePreview(game) {
  const m = game.build.mode, p = game.player;
  const def = BUILDINGS[m.type];
  const origin = m.anchor || m.hover;
  const target = m.anchor ? (m.end || m.hover) : m.hover;
  let tiles = def.drag && m.anchor ? dragTiles(def.drag, origin[0], origin[1], target[0], target[1]) : [m.hover];
  const multi = tiles.length > 1;
  const ghost = new Set();
  const out = [];
  const total = {};
  let nOk = 0, firstReason = null;
  for (const [tx, ty] of tiles) {
    let r = placeReason(game, m.type, tx, ty);
    if (r === 'exists' && multi) continue;
    let replace = null;
    if (r && typeof r === 'object') { replace = r.replace; r = null; }
    const t = { tx, ty, ok: !r, reason: r === 'exists' ? 'Já existe uma construção aqui' : r, mask: 0, replace };
    if (t.ok) {
      for (const k in def.cost) total[k] = (total[k] || 0) + def.cost[k];
      if (!p.inv.has(total)) { t.ok = false; t.reason = 'Materiais insuficientes'; for (const k in def.cost) total[k] -= def.cost[k]; }
    }
    if (t.ok) nOk++;
    else if (!firstReason) firstReason = t.reason;
    if (def.connect) ghost.add(game.world.idx(tx, ty));
    out.push(t);
  }
  if (def.connect) {
    const extra = (x, y) => game.world.inBounds(x, y) && ghost.has(game.world.idx(x, y));
    for (const t of out) t.mask = computeMask(game, m.type, t.tx, t.ty, extra);
  }
  m.tiles = out; m.n = nOk; m.valid = nOk > 0; m.reason = nOk ? null : firstReason; m.total = total;
}

// place every valid, affordable tile of the preview as blueprints
export function commitPlacement(game) {
  const m = game.build.mode;
  if (!m || m.kind !== 'place') return false;
  updatePreview(game);
  const def = BUILDINGS[m.type], p = game.player;
  if (!m.valid) { game.events.emit('error', { text: m.reason || 'Local inválido' }); return false; }
  let n = 0;
  for (const t of m.tiles) {
    if (!t.ok) continue;
    if (!p.inv.pay(def.cost)) break;
    if (t.replace && !t.replace.removed) removeStructure(game, t.replace, 1, true);
    placeStructure(game, m.type, t.tx, t.ty, { progress: 0 });
    n++;
  }
  if (!n) return false;
  game.events.emit('inventory', {});
  game.audio?.play('build', { x: p.x, y: p.y, volume: 0.5 });
  game.events.emit('toast', { text: n > 1 ? `${n}× ${def.name}: planta marcada` : `${def.name}: planta marcada`, kind: 'info' });
  const h = game.ctl?.hinted;
  if (h && !h.blueprint) { h.blueprint = true; game.events.emit('toast', { text: 'Você constrói as plantas automaticamente quando fica parado', kind: 'info' }); }
  game.work?.wake();
  m.anchor = null; m.end = null; m.locked = false;
  if (!def.drag || !p.inv.has(def.cost)) exitBuildMode(game);
  return true;
}
export const confirmPlace = (game) => {
  const m = game.build.mode;
  if (m?.kind === 'place') commitPlacement(game);
  else if (m?.kind === 'decon') exitBuildMode(game);
};

// touch / tap in build mode (mouse uses pointer drags, see controller)
export function buildTap(game, wx, wy) {
  const m = game.build.mode;
  const tx = Math.floor(wx), ty = Math.floor(wy);
  if (m.kind === 'decon') { deconAt(game, wx, wy); return; }
  const def = BUILDINGS[m.type];
  if (def.drag) {
    if (!m.anchor) { m.anchor = [tx, ty]; m.hover = [tx, ty]; m.end = null; m.locked = true; return; }
    const tgt = m.end || m.anchor;
    if (tgt[0] === tx && tgt[1] === ty) { commitPlacement(game); return; }
    m.end = [tx, ty];
    return;
  }
  if (m.locked && m.hover[0] === tx && m.hover[1] === ty) { commitPlacement(game); return; }
  m.hover = [tx, ty]; m.locked = true;
}

// ---------- structures ----------
export function placeStructure(game, type, tx, ty, opts = {}) {
  const def = BUILDINGS[type], w = game.world;
  const [sw, sh] = def.size;
  const o = {
    id: opts.id || 'b' + Date.now().toString(36) + (nextId++).toString(36), type, v: opts.v ?? Math.floor(Math.random() * 1000),
    tx, ty, x: tx + sw / 2, y: ty + sh, cy: ty + sh * 0.6, s: 1, f: 1, building: true, layer: def.layer,
    progress: Math.max(0, Math.min(1, opts.progress ?? 1)), mask: 0, solid: 0, builtAt: opts.builtAt ?? game.worldTime,
  };
  if (def.flat) o.flat = true;
  if (o.progress < 1) { o.blueprint = true; if (def.fire || def.workLight) { o.fire = false; o.lit = false; } }
  if (def.slots) { o.store = new Inventory(def.slots); if (opts.store) o.store.load(opts.store); }
  if (def.station) { o.station = true; o.working = false; if (opts.fuel) o.fuel = opts.fuel; }
  if (def.block === 'door') { o.door = true; o.open = 0; o.orient = 'h'; game.build.doors.push(o); }
  w.addObject(o);
  game.build.structures.push(o);
  gridAdd(game, o);
  noGrowStamp(game, tx, ty, sw, sh, +1);
  clearDecor(game, tx, ty, sw, sh);
  updateMasksAround(game, tx, ty, tx + sw - 1, ty + sh - 1);
  if (o.progress >= 1) completeStructure(game, o, true);
  if (opts.decon) game.build.decon.add(o);
  game.build.v++;
  game.events.emit('tile', { tx, ty });
  return o;
}

function clearDecor(game, tx, ty, sw, sh) {
  game.world.forChunks(tx, ty, tx + sw, ty + sh, (c) => {
    for (let k = c.decor.length - 1; k >= 0; k--) {
      const d = c.decor[k];
      if (d.x >= tx && d.x < tx + sw && d.y >= ty && d.y < ty + sh) c.decor.splice(k, 1);
    }
  });
}

// nudge entities out of a newly solid footprint
function nudgeOut(game, o) {
  const def = defOf(o);
  if (def.block !== 'tile' && def.block !== 'door') return;
  const [sw, sh] = def.size;
  for (const e of game.entities) {
    if (e.dead) continue;
    if (e.x + e.r <= o.tx || e.x - e.r >= o.tx + sw || e.y + e.r <= o.ty || e.y - e.r >= o.ty + sh) continue;
    if (def.block === 'door' && e.passDoors) continue;
    let best = null, bd = 1e9;
    for (let ty = o.ty - 1; ty <= o.ty + sh; ty++) for (let tx = o.tx - 1; tx <= o.tx + sw; tx++) {
      const x = tx + 0.5, y = ty + 0.5;
      if (collides(game.world, x, y, e.r)) continue;
      const d = Math.hypot(x - e.x, y - e.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) { e.x = best[0]; e.y = best[1]; }
  }
}

export function completeStructure(game, o, silent = false) {
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
  nudgeOut(game, o);
  const p = game.player;
  if (o.type === 'bed' && (!silent || !p.respawn)) p.respawn = o.id;
  if (!silent) {
    game.juice.puff(o.x, o.y - 0.2, 10, [0.72, 0.64, 0.52], 0.8);
    game.audio?.play('build', { x: o.x, y: o.y });
    gainXp(game, def.xp || 3);
    game.events.emit('toast', { text: msgBuilt(def), kind: 'good' });
    if (o.type === 'bed') game.events.emit('toast', { text: 'Ponto de renascimento definido', kind: 'info' });
    if (o.type === 'campfire') game.audio?.play('fire', { x: o.x, y: o.y });
    game.events.emit('built', { o });
  }
  game.build.v++;
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (x || y) game.events.emit('tile', { tx: o.tx + x, ty: o.ty + y });
}

function refundTo(game, o, items) {
  const p = game.player;
  for (const id in items) {
    const n = items[id];
    if (n <= 0) continue;
    const left = p.inv.add(id, n);
    if (n - left > 0) game.events.emit('loot', { item: id, qty: n - left });
    for (let k = 0; k < left; k++) dropLoot(game, o.x, o.y - 0.2, id, 1, 0.6);
  }
  game.events.emit('inventory', {});
}

export function removeStructure(game, o, refund = REFUND, quiet = false) {
  const def = defOf(o), w = game.world;
  const S = game.build.structures, k = S.indexOf(o);
  if (k < 0) return;
  S.splice(k, 1);
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
  if (refund > 0) {
    const back = {};
    for (const id in def.cost) back[id] = wasBlueprint ? def.cost[id] : Math.floor(def.cost[id] * refund);
    refundTo(game, o, back);
  }
  if (o.store) for (const s of o.store.slots) if (s) dropLoot(game, o.x, o.y - 0.3, s.id, s.qty, 0.8);
  if (o.fuel > 0) { /* unburnt fuel is lost */ }
  if (o.type === 'farm_plot') game.farm?.removeCropAt(o.tx, o.ty);
  if (game.player.respawn === o.id) game.player.respawn = null;
  updateMasksAround(game, o.tx, o.ty, o.tx + sw - 1, o.ty + sh - 1);
  if (!quiet) {
    game.juice.puff(o.x, o.y - 0.2, 8, [0.72, 0.64, 0.52], 0.7);
    game.audio?.play('build', { x: o.x, y: o.y, volume: 0.7 });
  }
  game.build.v++;
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
}

// ---------- deconstruction designations ----------
export function structureAtPoint(game, wx, wy) {
  const tx = Math.floor(wx), ty = Math.floor(wy);
  return structureAt(game, tx, ty, 'main') || structureAt(game, tx, ty, 'rug') || structureAt(game, tx, ty, 'floor');
}

export function toggleDecon(game, o, on = null) {
  const D = game.build.decon;
  if (o.blueprint) { // cancelling a blueprint is instant, full refund
    removeStructure(game, o, 1);
    game.events.emit('toast', { text: `${defOf(o).name}: planta cancelada`, kind: 'info' });
    return false;
  }
  const want = on == null ? !D.has(o) : on;
  if (want) D.add(o); else D.delete(o);
  game.build.v++;
  if (want) game.work?.wake();
  return want;
}

export function deconAt(game, wx, wy) {
  const o = structureAtPoint(game, wx, wy);
  if (!o) { game.events.emit('error', { text: 'Nenhuma construção aqui' }); return; }
  toggleDecon(game, o);
}

export function deconRect(game, x0, y0, x1, y1) {
  const seen = new Set();
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (const L of ['main', 'rug', 'floor']) { const o = structureAt(game, x, y, L); if (o) seen.add(o); }
  }
  for (const o of seen) toggleDecon(game, o, true);
  return seen.size;
}

// ---------- work kinds ----------
function clearFootprint(game, o) {
  const def = defOf(o);
  const [sw, sh] = def.size;
  const give = {};
  for (let y = o.ty; y < o.ty + sh; y++) for (let x = o.tx; x < o.tx + sw; x++) {
    for (const n of objectsOnTile(game, x, y)) {
      if (CLEARABLE.has(n.type)) {
        const yld = CLEAR_YIELD[n.type] || {};
        for (const k in yld) give[k] = (give[k] || 0) + yld[k];
        game.juice.leaves?.(n.x, n.y, 3, 0.4);
        removeNatural(game, n);
      } else if (n.type === 'crop' && def.layer !== 'floor') {
        game.farm?.removeCrop(n);
      } else if (n.type !== 'crop') return false;
    }
  }
  refundTo(game, o, give);
  return true;
}

registerWork('blueprint', {
  valid: (g, it) => !it.o.removed && !!it.o.blueprint,
  start(game, it) {
    const o = it.o, def = defOf(o);
    if (!clearFootprint(game, o)) { game.events.emit('error', { text: 'Algo está no caminho' }); return null; }
    const { need, cycle } = hitsFor(def.time || 2, 2);
    return { type: 'build', cycle, need, hits: Math.floor((o.progress || 0) * need), label: `Construindo ${def.name.toLowerCase()}` };
  },
  hit(game, wk) {
    const o = wk.it.o;
    game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3);
    game.audio?.play('build', { x: o.x, y: o.y, volume: 0.35 });
  },
  tick(game, wk) { wk.it.o.progress = Math.min(0.999, wk.k); },
  finish(game, wk) { completeStructure(game, wk.it.o); return true; },
});

registerWork('decon', {
  valid: (g, it) => !it.o.removed && g.build.decon.has(it.o),
  start(game, it) {
    const def = defOf(it.o);
    const { need, cycle } = hitsFor(Math.max(1, (def.time || 2) * 0.5), 1);
    return { type: 'build', cycle, need, label: `Desmontando ${def.name.toLowerCase()}` };
  },
  hit(game, wk) {
    const o = wk.it.o;
    o.shake = 1;
    game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3);
    game.audio?.play('build', { x: o.x, y: o.y, volume: 0.35 });
  },
  finish(game, wk) {
    const o = wk.it.o, def = defOf(o);
    removeStructure(game, o, REFUND);
    game.events.emit('toast', { text: `${def.name} ${def.g === 'm' ? 'desmontado' : 'desmontada'}`, kind: 'info' });
    return true;
  },
});

// ---------- interaction descriptors ----------
export function structIt(o, extra) {
  const def = defOf(o);
  const [sw, sh] = def.size;
  if (def.block === 'tile' || def.block === 'door' || def.flat || sw > 1 || sh > 1)
    return { o, tile: true, tx: o.tx, ty: o.ty, w: sw, h: sh, x: o.tx + sw / 2, y: o.ty + sh / 2, reach: 0.6, ...extra };
  return { o, x: o.x, y: o.cy ?? o.y, reach: 0.85, ...extra };
}

export function describeStructure(game, o) {
  const def = defOf(o);
  if (!def) return null;
  if (o.blueprint) return structIt(o, { kind: 'blueprint', verb: 'Construir', icon: 'build', prio: 3 });
  if (game.build.decon.has(o)) return structIt(o, { kind: 'decon', verb: 'Desmontar', icon: 'build', prio: 1 });
  if (o.type === 'chest') return structIt(o, { kind: 'chest', verb: 'Abrir', icon: 'chest', prio: 3, use: true });
  if (o.type === 'bed') return structIt(o, { kind: 'bed', verb: 'Dormir', icon: 'bed', prio: 3, use: true });
  if (def.station) return structIt(o, { kind: 'station', verb: o.type === 'campfire' ? 'Cozinhar' : 'Criar', icon: 'craft', prio: o.type === 'campfire' ? 1 : 3, use: true, reach: 1.4 });
  if (o.type === 'farm_plot') return game.farm?.describePlot(game, o) || null;
  return null;
}

export function useStructure(game, it) {
  const p = game.player, o = it.o;
  switch (it.kind) {
    case 'chest':
      game.events.emit('open', { panel: 'chest', chest: o });
      game.audio?.play('ui', {});
      return;
    case 'station':
      game.events.emit('open', { panel: 'craft', station: o.type });
      return;
    case 'bed': {
      p.respawn = o.id;
      const h = game.env.hour;
      const night = h >= 19.5 || h < 5.5;
      if (!night) { game.events.emit('toast', { text: 'Ponto de renascimento definido. Durma à noite.', kind: 'info' }); return; }
      if (p.inCombat || game.entities.some((e) => !e.dead && e !== p && e.state === 'chase' && e.threat === p)) {
        game.events.emit('error', { text: 'Não dá para dormir em combate' }); return;
      }
      game.events.emit('sleep', {});
      game.later(0.9, () => {
        const from = game.env.hour;
        const hours = from >= 12 ? 24 - from + 6 : 6 - from;
        if (game.env.hour >= 12) game.env.dayIndex++;
        game.env.hour = 6.0;
        game.worldTime += Math.max(0, hours) / 24 * (game.env.dayLength || 720); // crops & regrowth advance
        p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = Math.max(0, p.hunger - 15);
        game.events.emit('toast', { text: 'Você dormiu até o amanhecer', kind: 'good' });
      });
      return;
    }
  }
}

// ---------- system ----------
export function buildingSystem() {
  return {
    update(game, dt) {
      const p = game.player;
      // doors open for the player
      for (const o of game.build.doors) {
        if (o.blueprint) continue;
        const near = !p.dead && Math.abs(p.x - (o.tx + 0.5)) < 1.25 && Math.abs(p.y - (o.ty + 0.5)) < 1.25;
        const target = near ? 1 : 0;
        if (o.open !== target) {
          const was = o.open;
          o.open = target > o.open ? Math.min(1, o.open + dt * 5) : Math.max(0, o.open - dt * 3);
          if (was === 0 && o.open > 0) game.audio?.play('build', { x: o.x, y: o.y, volume: 0.2 });
        }
      }
      // floors: +10% walking speed
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const fl = structureAt(game, tx, ty, 'floor');
      if (fl && !fl.blueprint && fl.type !== 'farm_plot') p.speed *= 1.1;

      const m = game.build.mode;
      if (!m) return;
      if (p.dead) { exitBuildMode(game); return; }
      if (m.kind !== 'place') return;
      const hover = game.ctl?.hover;
      if (hover && hover.fresh) { m.hover = [Math.floor(hover.wx), Math.floor(hover.wy)]; if (m.anchor && game.ctl.dragging) m.end = m.hover.slice(); }
      else if (!m.locked && !m.anchor) m.hover = frontTile(p);
      updatePreview(game);
    },
    render(game, B, v) {
      const A = game.A, t = game.time;
      // fallback visuals while the structure art is not in the atlas
      const S = game.build.structures;
      const art = typeof CW.structureSprite === 'function';
      const soft = A.has('fx_soft') ? A.get('fx_soft') : null;
      const ring = A.has('fx_ring') ? A.get('fx_ring') : null;
      for (const o of S) {
        if (o.x < v.x0 - 3 || o.x > v.x1 + 3 || o.y < v.y0 - 1 || o.y > v.y1 + 3) continue;
        const def = defOf(o);
        if (def.flat && soft && !art && !A.has(o.type + '_' + o.mask) && !A.has(o.type)) {
          const c = FLAT_FB[o.type] || [0.6, 0.5, 0.4];
          const [sw, sh] = def.size;
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++)
            B.ground.add(soft, o.tx + x + 0.5, o.ty + y + 0.85, 1.45, 1.1, c[0], c[1], c[2], o.blueprint ? 0.35 : 0.9);
        }
        if (o.blueprint && !art && ring) {
          const [sw, sh] = def.size;
          B.fx.add(ring, o.tx + sw / 2, o.ty + sh / 2 + 0.1, 0.9 * sw, 0.6 * sh, 0.55, 0.8, 1, 0.65);
        }
        if (game.build.decon.has(o) && ring) {
          const [sw, sh] = def.size;
          const pulse = 0.85 + 0.15 * Math.sin(t * 6);
          B.fx.add(ring, o.tx + sw / 2, o.ty + sh / 2 + 0.1, 0.95 * sw * pulse, 0.65 * sh * pulse, 1, 0.35, 0.3, 0.85);
        }
      }
      const m = game.build.mode;
      if (!m || m.kind !== 'place') return;
      const def = BUILDINGS[m.type];
      const pulse = 0.75 + 0.25 * Math.sin(t * 6);
      const [sw, sh] = def.size;
      for (const g of m.tiles) {
        const [r, gg, b] = g.ok ? [0.55, 1, 0.55] : [1, 0.35, 0.3];
        if (ring) B.fx.add(ring, g.tx + sw / 2, g.ty + sh / 2 + 0.1, 1.0 * sw, 0.68 * sh, r, gg, b, 0.9 * pulse);
        const [s, sc] = ghostSprite(A, m.type, g.mask);
        if (s) {
          const layer = def.flat ? B.ground : B.fx;
          layer.add(s, g.tx + sw / 2, g.ty + sh, sc, sc, r, gg, b, (def.flat ? 0.7 : 0.55) * pulse, 0, 0, 0, 1);
        } else if (def.flat && soft) {
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) B.ground.add(soft, g.tx + x + 0.5, g.ty + y + 0.85, 1.4, 1.05, r, gg, b, 0.5 * pulse);
        }
      }
    },
  };
}

const FLAT_FB = { floor_wood: [0.62, 0.45, 0.28], floor_stone: [0.62, 0.62, 0.6], farm_plot: [0.36, 0.25, 0.16], rug: [0.62, 0.2, 0.18] };

// sprite for a ghost preview: Art A's structureSprite(A, type, mask) when present, else fallbacks
export function ghostSprite(A, type, mask = 0) {
  if (typeof CW.structureSprite === 'function') {
    try {
      const r = CW.structureSprite(A, type, mask);
      if (Array.isArray(r)) { if (r[0]) return r; }
      else if (r) return [r, 1];
    } catch { /* fall through */ }
  }
  for (const n of [type + '_' + mask, type + '_h', type + '_0', type]) if (A.has(n)) return [A.get(n), 1];
  return buildSprite(A, type);
}

// structures near the player (for stations / warmth)
export function structuresNear(game, x, y, r, filter) {
  const out = [];
  for (const o of game.build.structures) {
    if (o.blueprint) continue;
    const def = defOf(o);
    const [sw, sh] = def.size;
    const cx = Math.max(o.tx, Math.min(o.tx + sw, x)), cy = Math.max(o.ty, Math.min(o.ty + sh, y));
    if (Math.hypot(cx - x, cy - y) <= r && (!filter || filter(o))) out.push(o);
  }
  return out;
}

export { DIRS4 };
export const itemLabel = (id) => ITEMS[id]?.name || id;
