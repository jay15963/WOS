// Autotile: per-layer tile -> structure grids and 4-neighbour connection masks (N=1, E=2, S=4, W=8).
// Generic connect rule: a connectable (def.connect = its group) links to a neighbour in the same layer whose
// group is in def.joins (default: its own group); 'rock' in joins = natural rock tiles (walls join rock,
// fences join walls / doors / rock). Masks are recomputed for the footprint and its neighbours on build /
// remove / mining. Edge props also refresh `_mount` (cosmetic: is there a wall behind it?).

import { BUILDINGS } from './data.js';

export const DIRS4 = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]; // dx, dy, bit
// levels (agent L, docs/LEVELS.md §2.1): a structure on story lv sits in the same layer maps under the key
// tileIdx + lv·W·H, so every level-0 lookup is unchanged; masks connect within one story (rock only on the ground)
const MAXL = 3;
export const lvKey = (w, i, lv) => i + (lv | 0) * w.W * w.H;

export function initGrids(game) {
  game.build.grid = { main: new Map(), floor: new Map(), rug: new Map(), roof: new Map() };
}

export const layerOf = (type) => BUILDINGS[type]?.layer || 'main';

export function structureAt(game, tx, ty, layer = 'main', lv = 0) {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return null;
  return game.build.grid[layer].get(lvKey(w, w.idx(tx, ty), lv)) || null;
}

// footprint tiles of a structure (o.fw × o.fh after rotation; legacy objects: the type's size)
export function footprint(o) {
  const sz = BUILDINGS[o.type]?.size || [1, 1];
  const w = o.fw || sz[0], h = o.fh || sz[1];
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([o.tx + x, o.ty + y]);
  return out;
}

export function gridAdd(game, o) {
  const g = game.build.grid[layerOf(o.type)], w = game.world, lv = o.lv | 0;
  for (const [x, y] of footprint(o)) if (w.inBounds(x, y)) g.set(lvKey(w, w.idx(x, y), lv), o);
}

export function gridRemove(game, o) {
  const g = game.build.grid[layerOf(o.type)], w = game.world, lv = o.lv | 0;
  for (const [x, y] of footprint(o)) { if (!w.inBounds(x, y)) continue; const i = lvKey(w, w.idx(x, y), lv); if (g.get(i) === o) g.delete(i); }
}

// does tile (tx, ty) connect for a connectable `def` in `layer`? `extra(tx, ty)` lets ghosts count as built.
export function connectsAt(game, def, layer, tx, ty, extra, lv = 0) {
  const w = game.world, J = def.joins;
  if (!w.inBounds(tx, ty)) return J.has('rock') && !lv;
  const i = w.idx(tx, ty);
  const o = game.build.grid[layer].get(lvKey(w, i, lv));
  if (o) { const g = BUILDINGS[o.type].connect; if (g && J.has(g)) return true; }
  if (J.has('rock') && !lv && w.rock[i] === 1) return true;
  return !!(extra && extra(tx, ty));
}

export function computeMask(game, type, tx, ty, extra, lv = 0) {
  const def = BUILDINGS[type];
  if (!def?.connect) return 0;
  const layer = def.layer || 'main';
  let m = 0;
  for (const [dx, dy, bit] of DIRS4) if (connectsAt(game, def, layer, tx + dx, ty + dy, extra, lv)) m |= bit;
  return m;
}

export function doorOrient(mask) {
  const ew = (mask & 10) !== 0, ns = (mask & 5) !== 0;
  return ns && !ew ? 'v' : 'h';
}

// is there a wall-like thing (wall / door group or rock) on the tile next to (tx, ty) in direction d (1 N, 2 E, 3 S, 4 W)?
const EDGE_D = [null, [0, -1], [1, 0], [0, 1], [-1, 0]];
export function wallBehind(game, tx, ty, d, lv = 0) {
  const v = EDGE_D[d];
  if (!v) return false;
  const w = game.world, x = tx + v[0], y = ty + v[1];
  if (!w.inBounds(x, y)) return false;
  const i = w.idx(x, y);
  if (!lv && w.rock[i] === 1) return true;
  const o = game.build.grid.main.get(lvKey(w, i, lv));
  return !!(o && !o.blueprint && BUILDINGS[o.type].connect === 'wall');
}

// extra derived per-tile data recomputed with the masks (agent K: detail masks such as carpets)
export const tileHooks = [];

function refresh(o, game) {
  const def = BUILDINGS[o.type];
  for (let i = 0; i < tileHooks.length; i++) tileHooks[i](game, o);
  if (def?.edge) {
    o._mount = o.rot >= 1 && o.rot <= 4 && wallBehind(game, o.tx, o.ty, o.rot, o.lv);
    if (o.light && def.light) o.light.lift = def.light.lift + (o._mount && o.rot !== 3 ? 0.3 : 0); // wall torch: light at the flame (cosmetic)
    return;
  }
  if (!def?.connect) return;
  o.mask = computeMask(game, o.type, o.tx, o.ty, null, o.lv);
  if (def.block === 'door') o.orient = doorOrient(o.mask);
}

// recompute masks of structures on tiles [x0..x1]×[y0..y1] expanded by one tile (all layers)
export function updateMasksAround(game, x0, y0, x1 = x0, y1 = y0) {
  const w = game.world, seen = new Set();
  for (const layer of ['main', 'floor', 'rug']) {
    const g = game.build.grid[layer];
    for (let lv = 0; lv <= MAXL; lv++) for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!w.inBounds(x, y)) continue;
      const o = g.get(lvKey(w, w.idx(x, y), lv));
      if (o && !seen.has(o)) { seen.add(o); refresh(o, game); }
    }
  }
}

export function updateAllMasks(game) {
  for (const o of game.build.structures) refresh(o, game);
}
