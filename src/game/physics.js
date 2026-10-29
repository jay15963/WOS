
// Circle-vs-tile and circle-vs-obstacle collision with axis sliding.
// world.solid: 1 blocks everyone (walls, fences, stations, beds, CLOSED doors / gates). Doors open and close
// only by an explicit action (door.toggle → door.set): open = 0, everyone passes (creatures too). Value 2
// (legacy "only passDoors movers") is no longer written. Deep water (world.water = 2) blocks everyone except movers with `canSwim`
// (the local player: very slow, see World.speedAt). Round props collide at (o.x, o.cy ?? o.y).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function tileBlocked(world, tx, ty, passDoors = false, swim = false) {
  if (!world.inBounds(tx, ty)) return true;
  const i = world.idx(tx, ty);
  const s = world.solid[i];
  return world.rock[i] === 1 || (world.water[i] === 2 && !swim) || s === 1 || (s === 2 && !passDoors);
}

export function collides(world, x, y, r, ignore = null, passDoors = false, swim = false) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!tileBlocked(world, tx, ty, passDoors, swim)) continue;
    const cx = clamp(x, tx, tx + 1), cy = clamp(y, ty, ty + 1);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  let hit = false;
  world.forChunks(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (c) => {
    if (hit) return;
    for (const o of c.objects) {
      if (!o.solid || o.stump || o.fall || o === ignore) continue;
      const rr = r + o.solid;
      const dx = x - o.x, dy = y - (o.cy ?? o.y);
      if (dx * dx + dy * dy < rr * rr) { hit = true; return; }
    }
  });
  return hit;
}

function overlappedProp(world, x, y, r) {
  let found = null;
  world.forChunks(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (c) => {
    if (found) return;
    for (const o of c.objects) {
      if (!o.solid || o.stump || o.fall) continue;
      const rr = r + o.solid, dx = x - o.x, dy = y - (o.cy ?? o.y);
      if (dx * dx + dy * dy < rr * rr) { found = o; return; }
    }
  });
  return found;
}

export function moveCircle(world, e, dx, dy) {
  const L = world.levels;
  if (L && (L.active || e.lv || e.z > 0)) return L.move(e, dx, dy); // levels: stairs / ramparts (src/game/levels.js)
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
  const sx = dx / steps, sy = dy / steps;
  const pd = !!e.passDoors, sw = !!e.canSwim;
  // already overlapping a round prop (finished / loaded under us): ignore it so we can walk out
  const stuckOn = collides(world, e.x, e.y, e.r, null, pd, sw) ? overlappedProp(world, e.x, e.y, e.r) : null;
  let moved = false;
  for (let i = 0; i < steps; i++) {
    if (!collides(world, e.x + sx, e.y, e.r, stuckOn, pd, sw)) { e.x += sx; moved = true; }
    if (!collides(world, e.x, e.y + sy, e.r, stuckOn, pd, sw)) { e.y += sy; moved = true; }
  }
  return moved;
}

export function facingFrom(dx, dy, prev) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 1e-4 && ay < 1e-4) return prev;
  // hysteresis keeps side-facing during diagonal movement
  if (ax > ay * 0.8) return dx > 0 ? 'e' : 'w';
  return dy > 0 ? 's' : 'n';
}
