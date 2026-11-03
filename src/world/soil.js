// Fertile soil (docs/LIVESTOCK.md): the land within FERTILE_R tiles of a river is fertile — wheat only grows there,
// wild wheat only (re)grows there. A pure function of the generated world (river water = water tiles with a flow,
// lakes have none), so every peer derives the same grid; computed once per world, lazily.

export const FERTILE_R = 5; // tiles from the river (tile centre to tile centre)

// river water: a water tile the river carved (it has a flow); lakes and ponds are still water
export function riverAt(w, tx, ty) {
  if (!w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  return w.water.get(i) > 0 && Math.hypot(w.flowX.get(i), w.flowY.get(i)) > 0.2;
}

// the fertile grid (1 = within FERTILE_R of a river edge) of a small world-like { W, H, water, flowX, flowY (get(i)),
// inBounds, idx } — the generator's raw layers (worldgen seeds wild wheat on it; the classic source serves it as the
// world's `fertile` layer: the same grid). Planet sources make the layer per chunk.
export function fertileGrid(w) {
  const W = w.W, H = w.H, g = new Uint8Array(W * H);
  const R = FERTILE_R, R2 = R * R + 0.01;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!riverAt(w, x, y)) continue;
    // only the river's edge tiles stamp (inner water adds nothing new)
    let edge = false;
    for (let k = 0; k < 4 && !edge; k++) {
      const xx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), yy = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (w.inBounds(xx, yy) && !riverAt(w, xx, yy)) edge = true;
    }
    if (!edge) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R2) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) g[yy * W + xx] = 1;
    }
  }
  return g;
}

// is the land tile (tx, ty) fertile (within FERTILE_R of a river)? Water and rock are never fertile.
// (the world's `fertile` layer comes from the source: derived from the pristine world, the same on every peer)
export function fertileAt(w, tx, ty) {
  if (!w || !w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  return w.fertile.get(i) === 1 && !w.water.get(i) && !w.rock0.get(i);
}
