// Autotile: per-layer tile -> structure grids and 4-neighbour connection masks (N=1, E=2, S=4, W=8).
// A connectable structure (def.connect = group) connects to neighbours of the same group in the same
// layer; group 'wall' also connects to natural rock tiles (doors are part of the wall group).
// Masks are recomputed for the footprint and its neighbours on build / remove / mining.

import { BUILDINGS } from './data.js';

export const DIRS4 = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]; // dx, dy, bit

export function initGrids(game) {
  game.build.grid = { main: new Map(), floor: new Map(), rug: new Map() };
}

export const layerOf = (type) => BUILDINGS[type]?.layer || 'main';

export function structureAt(game, tx, ty, layer = 'main') {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return null;
  return game.build.grid[layer].get(w.idx(tx, ty)) || null;
}

export function footprint(o) {
  const [w, h] = BUILDINGS[o.type]?.size || [1, 1];
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([o.tx + x, o.ty + y]);
  return out;
}

export function gridAdd(game, o) {
  const g = game.build.grid[layerOf(o.type)], w = game.world;
  for (const [x, y] of footprint(o)) if (w.inBounds(x, y)) g.set(w.idx(x, y), o);
}

export function gridRemove(game, o) {
  const g = game.build.grid[layerOf(o.type)], w = game.world;
  for (const [x, y] of footprint(o)) { const i = w.idx(x, y); if (g.get(i) === o) g.delete(i); }
}

// does tile (tx, ty) connect for `group` in `layer`? `extra(tx, ty)` lets ghosts count as built.
export function connectsAt(game, group, layer, tx, ty, extra) {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return group === 'wall';
  const i = w.idx(tx, ty);
  const o = game.build.grid[layer].get(i);
  if (o && BUILDINGS[o.type].connect === group) return true;
  if (group === 'wall' && w.rock[i] === 1) return true;
  return !!(extra && extra(tx, ty));
}

export function computeMask(game, type, tx, ty, extra) {
  const def = BUILDINGS[type];
  if (!def?.connect) return 0;
  const layer = def.layer || 'main';
  let m = 0;
  for (const [dx, dy, bit] of DIRS4) if (connectsAt(game, def.connect, layer, tx + dx, ty + dy, extra)) m |= bit;
  return m;
}

export function doorOrient(mask) {
  const ew = (mask & 10) !== 0, ns = (mask & 5) !== 0;
  return ns && !ew ? 'v' : 'h';
}

function refresh(o, game) {
  const def = BUILDINGS[o.type];
  if (!def?.connect) return;
  o.mask = computeMask(game, o.type, o.tx, o.ty);
  if (def.block === 'door') o.orient = doorOrient(o.mask);
}

// recompute masks of structures on tiles [x0..x1]×[y0..y1] expanded by one tile (all layers)
export function updateMasksAround(game, x0, y0, x1 = x0, y1 = y0) {
  const w = game.world, seen = new Set();
  for (const layer of ['main', 'floor', 'rug']) {
    const g = game.build.grid[layer];
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!w.inBounds(x, y)) continue;
      const o = g.get(w.idx(x, y));
      if (o && !seen.has(o)) { seen.add(o); refresh(o, game); }
    }
  }
}

export function updateAllMasks(game) {
  for (const o of game.build.structures) refresh(o, game);
}
