// Circle-vs-tile and circle-vs-obstacle collision with axis sliding.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function collides(world, x, y, r, ignore = null) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!world.blocked(tx, ty)) continue;
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
      const dx = x - o.x, dy = y - o.y;
      if (dx * dx + dy * dy < rr * rr) { hit = true; return; }
    }
  });
  return hit;
}

export function moveCircle(world, e, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
  const sx = dx / steps, sy = dy / steps;
  let moved = false;
  for (let i = 0; i < steps; i++) {
    if (!collides(world, e.x + sx, e.y, e.r)) { e.x += sx; moved = true; }
    if (!collides(world, e.x, e.y + sy, e.r)) { e.y += sy; moved = true; }
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
