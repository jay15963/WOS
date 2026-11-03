
// Circle-vs-tile and circle-vs-obstacle collision with axis sliding.
// world.solid: 1 blocks everyone (walls, fences, stations, beds, CLOSED doors / gates). Doors open and close
// only by an explicit action (door.toggle → door.set): open = 0, everyone passes (creatures too). Value 2
// (legacy "only passDoors movers") is no longer written. Deep water (world.water = 2) blocks everyone except movers with `canSwim`
// (the local player: very slow, see World.speedAt) — not on a finished pier / bridge deck (world.deck, game/decks.js),
// whose railings (world.rail) are thin walls on tile edges. Round props collide at (o.x, o.cy ?? o.y).
// A bridge over the water has two levels: its deck (entered along the line) and the water under it (entered through
// its railed sides from the water / ice / bank beside it: swimmers, waders, ice walkers). A mover under a deck (e._ud,
// kept by deckTrack) treats the water as water and is stopped by the walls at the water (world.railU: the support
// bents, the abutments' stone), not by the railings; one on a deck by the railings (world.rail); one on the ground by
// world.railU too (it may pass under a bridge from the side).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// onDeck: the mover stands on a deck (its tiles are ground); false = at the water under / beside it (deep water blocks)
export function tileBlocked(world, tx, ty, passDoors = false, swim = false, onDeck = true) {
  if (!world.inBounds(tx, ty)) return true;
  const i = world.idx(tx, ty);
  const s = world.solid.get(i);
  return world.rock.get(i) === 1 || (world.water.get(i) === 2 && !swim && !world.frozen && !(onDeck && world.deck && world.deck.get(i))) || s === 1 || (s === 2 && !passDoors); // frozen: ice (seasons.js); deck: a pier / bridge (decks.js)
}

// ---------- decks: on a bridge or under it (game/decks.js) ----------
// a finished bridge piece over the water (the tile has two levels)
export const bridgeWater = (w, i) => !!w.deck && w.deck.get(i) === 2 && w.water.get(i) > 0;
const deckAtPt = (w, x, y) => { if (!w.deck) return false; const tx = Math.floor(x), ty = Math.floor(y); return w.inBounds(tx, ty) && !!w.deck.get(w.idx(tx, ty)); };
// is a body whose centre goes from tile p to tile i under a bridge deck? (u: whether it was under one on p)
export function underAt(w, p, i, u) {
  if (!w.rail || i < 0 || !bridgeWater(w, i)) return false;
  if (i === p) return u;
  if (p < 0) return false;
  if (bridgeWater(w, p)) return u;   // along under it / along its deck
  if (w.deck.get(p)) return false;       // from an abutment / a pier: onto the deck
  const W = w.W, dy = ((i / W) | 0) - ((p / W) | 0);
  let dx = (i % W) - (p % W);
  if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W; // (across the seam of the planet)
  if (dx > 1 || dx < -1 || dy > 1 || dy < -1) return false; // (a jump: on the deck)
  // from the water / ice / bank beside it: under it when it comes through a railed side
  return !!(w.rail.get(i) & ((dx > 0 ? 8 : dx < 0 ? 2 : 0) | (dy > 0 ? 1 : dy < 0 ? 4 : 0)));
}
const tileOf = (w, x, y) => { const tx = Math.floor(x), ty = Math.floor(y); return w.inBounds(tx, ty) ? w.idx(tx, ty) : -1; };
// keep e._ud (under a deck) as its centre moves from tile to tile (e._ut: its tile last time); every peer runs it for
// what it sees (decksSystem), the movers at each sub-step
export function deckTrack(w, e) {
  if (!w.rail) { if (e._ud) e._ud = false; e._ut = -1; return false; }
  const i = tileOf(w, e.x, e.y);
  if (i === e._ut) return !!e._ud;
  const u = underAt(w, e._ut ?? -1, i, !!e._ud);
  e._ut = i; e._ud = u;
  return u;
}
// would e be under a deck with its centre at (x, y)?
export function underFor(w, e, x, y) {
  if (!w.rail) return false;
  deckTrack(w, e);
  return underAt(w, e._ut ?? -1, tileOf(w, x, y), !!e._ud);
}

// Bridge railings (game/decks.js): world.rail = per-tile bits of railed edges N 1, E 2, S 4, W 8 (set on both tiles of an
// edge, finished bridges only; null while there is none). A railed edge is a thin wall nobody crosses.
const segD2 = (x, y, ax, ay, bx, by) => { const cx = clamp(x, ax, bx), cy = clamp(y, ay, by), dx = x - cx, dy = y - cy; return dx * dx + dy * dy; };
// ud: a body under a deck there; else the railings for one on a deck tile, the walls at the water for one on the ground
export function railHit(world, x, y, r, ud = false) {
  const R = !ud && deckAtPt(world, x, y) ? world.rail : world.railU;
  if (!R) return false;
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r), r2 = r * r;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!world.inBounds(tx, ty)) continue;
    const b = R.get(world.idx(tx, ty));
    if (!b) continue;
    if ((b & 1) && segD2(x, y, tx, ty, tx + 1, ty) < r2) return true;
    if ((b & 4) && segD2(x, y, tx, ty + 1, tx + 1, ty + 1) < r2) return true;
    if ((b & 8) && segD2(x, y, tx, ty, tx, ty + 1) < r2) return true;
    if ((b & 2) && segD2(x, y, tx + 1, ty, tx + 1, ty + 1) < r2) return true;
  }
  return false;
}
// does a step from tile (x, y) to (x + dx, y + dy) cross a railing? (diagonal: any railed edge at that corner); R: the
// walls to test (default the railings; nav.js passes world.railU for a step at the water)
export function railCross(world, x, y, dx, dy, R = world.rail) {
  if (!R || !world.inBounds(x, y)) return false;
  const a = R.get(world.idx(x, y));
  if (!dx || !dy) return !!(a & (dx > 0 ? 2 : dx < 0 ? 8 : dy > 0 ? 4 : 1));
  const nx = x + dx, ny = y + dy;
  const b = world.inBounds(nx, ny) ? R.get(world.idx(nx, ny)) : 0;
  return !!((a & ((dx > 0 ? 2 : 8) | (dy > 0 ? 4 : 1))) || (b & ((dx > 0 ? 8 : 2) | (dy > 0 ? 1 : 4))));
}

// ud: the body would be under a bridge deck at (x, y) (underFor)
export function collides(world, x, y, r, ignore = null, passDoors = false, swim = false, ud = false) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  const od = !ud && deckAtPt(world, x, y); // (on a deck: its tiles are ground; at the water: deep water stays water)
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!tileBlocked(world, tx, ty, passDoors, swim, od)) continue;
    const cx = clamp(x, tx, tx + 1), cy = clamp(y, ty, ty + 1);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  if (world.rail && railHit(world, x, y, r, ud)) return true;
  let hit = false;
  world.forChunks(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (c) => {
    if (hit) return;
    for (const o of c.objects) {
      if (!o.solid || o.stump || o.fall || o === ignore) continue;
      const rr = r + o.solid, dy = y - (o.cy ?? o.y);
      let dx = x - o.x;
      if (dx > 8192) dx -= 16384; else if (dx < -8192) dx += 16384; // (across the seam of the planet)
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
      const rr = r + o.solid, dx = world.dx(x, o.x), dy = y - (o.cy ?? o.y);
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
  const pd = !!e.passDoors, sw = !!e.canSwim, dk = !!world.rail; // (dk: bridges around — on / under a deck)
  // already overlapping a round prop (finished / loaded under us): ignore it so we can walk out
  const stuckOn = collides(world, e.x, e.y, e.r, null, pd, sw, dk && deckTrack(world, e)) ? overlappedProp(world, e.x, e.y, e.r) : null;
  let moved = false;
  for (let i = 0; i < steps; i++) {
    if (!collides(world, e.x + sx, e.y, e.r, stuckOn, pd, sw, dk && underFor(world, e, e.x + sx, e.y))) { e.x += sx; moved = true; }
    if (!collides(world, e.x, e.y + sy, e.r, stuckOn, pd, sw, dk && underFor(world, e, e.x, e.y + sy))) { e.y += sy; moved = true; }
  }
  if (dk) deckTrack(world, e);
  if (world.wrap && (e.x < 0 || e.x >= world.W)) e.x = world.wrapPos(e.x); // (positions stay canonical: 0 ≤ x < W)
  return moved;
}

export function facingFrom(dx, dy, prev) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 1e-4 && ay < 1e-4) return prev;
  // hysteresis keeps side-facing during diagonal movement
  if (ax > ay * 0.8) return dx > 0 ? 'e' : 'w';
  return dy > 0 ? 's' : 'n';
}
