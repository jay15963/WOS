// The rowboat's numbers and hull shape (pure: the rules in game/boats.js and the 3D model in art/faces/solidBoat.js
// share them). A hull point is (u, s): u tiles along the hull from its centre (+ toward the bow), s tiles across
// (+s = the hull's local +x: world (sin h, −cos h) for heading h, the world angle the bow points to).
//
// Room: 6 places shared by players and animals (each takes one; at most 4 players — the game has 4), so one player and
// the 5 animals a rope can lead all fit. Place 0 is the oars (the driver: always a player); animals take 1..5.

export const BOAT = {
  stern: -1.9, bow: 2.12,       // hull ends along its axis (tiles from the centre)
  speed: 2.6,                   // tiles/s at full stroke (walking: 4)
  back: 0.45,                   // × speed backing water (the stick behind the boat)
  current: 0.42,                // tiles/s of drift per unit of river flow (world.flowX / flowY, worldgen: 0.35..1 on rivers, 0 on lakes)
  accel: 1.6,                   // tiles/s² while rowing
  turn: 1.3,                    // rad/s turning toward the stick / keys
  drag: 0.5, dragRow: 0.18,     // forward drag (1/s): it glides when the oars stop
  side: 3.4,                    // lateral drag (1/s): the keel kills side slip
  seatH: 0.24, floorH: 0.07,    // bench tops / floor boards above the water (tiles)
  reach: 1.4,                   // boarding: this close to the hull (tiles)
  room: 6, players: 4,          // places in all / players at most
  hz: 10,                       // driver reports per second while it moves
  // the places [u, s]: 0 = the oars' thwart, 1 / 2 = the fore bench, 3 / 4 = the aft bench, 5 = the stern seat
  places: [[-0.05, 0], [0.86, 0.27], [0.86, -0.27], [-0.92, 0.27], [-0.92, -0.27], [-1.52, 0]],
  playerOrder: [0, 5, 3, 4, 1, 2], // which free place a boarding player takes (the oars first)
  animalOrder: [1, 2, 3, 4, 5],    // animals never sit at the oars
};
// room an animal takes standing across the hull, by species: [thickness along the hull, length across it] (tiles; young:
// × 0.6) — the animals stand in single file down the middle, in the stretches no seated player takes
export const ANIMAL_ROOM = { cow: [0.6, 1.35], sheep: [0.48, 0.95], pig: [0.48, 0.9], chicken: [0.32, 0.42] };
export function roomOf(m) {
  const r = ANIMAL_ROOM[m?.species] || ANIMAL_ROOM.sheep, k = (m?.variant | 0) & 2 ? 0.6 : 1;
  return [r[0] * k, r[1] * k];
}

// gunwale half-width along the hull (stations u → half-width)
const HU = [-1.9, -1.5, -0.9, -0.2, 0.5, 1.1, 1.55, 1.85, 2.12];
const HW = [0.5, 0.6, 0.67, 0.69, 0.67, 0.58, 0.44, 0.26, 0.03];
export function halfW(u) {
  if (u <= HU[0]) return HW[0];
  for (let i = 1; i < HU.length; i++) if (u <= HU[i]) { const k = (u - HU[i - 1]) / (HU[i] - HU[i - 1]); return HW[i - 1] + (HW[i] - HW[i - 1]) * k; }
  return HW[HW.length - 1];
}
// height of the gunwale (the sheer rises toward the bow and the stern)
export const sheer = (u) => 0.3 + (u > 0 ? 0.11 * (u / 2.12) ** 2 : 0.06 * (u / 1.9) ** 2);
// half-width at the waterline (the sides flare out above it)
export const waterW = (u) => halfW(u) * 0.8;

// hull point (u, s) of a boat at (x, y) heading h → world [x, y]
export function hullPt(x, y, h, u, s) { const c = Math.cos(h), n = Math.sin(h); return [x + u * c + s * n, y + u * n - s * c]; }
// world point → hull coordinates [u, s]
export function hullLocal(x, y, h, wx, wy) { const c = Math.cos(h), n = Math.sin(h), dx = wx - x, dy = wy - y; return [dx * c + dy * n, dx * n - dy * c]; }
// inside a hull at (x, y, h) (grown by g tiles)?
export function inHull(x, y, h, wx, wy, g = 0) {
  const [u, s] = hullLocal(x, y, h, wx, wy);
  return u > BOAT.stern - g && u < BOAT.bow + g && Math.abs(s) < halfW(u) + g;
}
// the nearest point of the hull's outline (or inside it) to a world point: [x, y, distance]
export function hullNear(x, y, h, wx, wy) {
  const [u, s] = hullLocal(x, y, h, wx, wy);
  const cu = Math.max(BOAT.stern, Math.min(BOAT.bow, u)), hw = halfW(cu), cs = Math.max(-hw, Math.min(hw, s));
  const [px, py] = hullPt(x, y, h, cu, cs);
  return [px, py, Math.hypot(wx - px, wy - py)];
}

// collision samples along the hull's outline
const SAMPLES = [];
for (const u of [-1.84, -1.35, -0.75, -0.15, 0.45, 1.05, 1.5, 1.82]) { const s = halfW(u) * 0.93; SAMPLES.push([u, s], [u, -s]); }
SAMPLES.push([2.05, 0], [-1.88, 0]);

// a tile a hull may float over: water (deep or shallow, a bridge over it is fine), no rock, nothing solid, no pier —
// never the abyssal ocean (world zone layer bit 8: "Oceano aberto: o barco não aguenta")
export function boatable(w, tx, ty) {
  if (!w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  return w.water.get(i) > 0 && !w.rock.get(i) && !w.solid.get(i) && !(w.deck && w.deck.get(i) === 1) && !(w.zone && w.zone.get(i) & 8);
}
// is any of the hull's outline over the abyssal ocean at (x, y, h)? (why a boat stops there)
export function hullAbyss(w, x, y, h) {
  if (!w.zone) return false;
  const c = Math.cos(h), n = Math.sin(h);
  for (const [u, s] of SAMPLES) {
    const tx = Math.floor(x + u * c + s * n), ty = Math.floor(y + u * n - s * c);
    if (w.inBounds(tx, ty) && w.zone.get(w.idx(tx, ty)) & 8) return true;
  }
  return false;
}
// does a hull fit at (x, y, h)? (other boats: their shared pose; inset shrinks the outline a little: the host checks
// a driver's rounded numbers with some slack)
export function hullFree(game, x, y, h, self = null, inset = 0) {
  const w = game.world, c = Math.cos(h), n = Math.sin(h), boats = game.boats?.map;
  for (const [u0, s0] of SAMPLES) {
    const u = u0 - Math.sign(u0) * inset, s = s0 - Math.sign(s0) * inset;
    const px = x + u * c + s * n, py = y + u * n - s * c;
    if (!boatable(w, Math.floor(px), Math.floor(py))) return false;
    if (boats) for (const o of boats.values()) if (o !== self && Math.abs(o.x - px) < 2.2 && Math.abs(o.y - py) < 2.2 && inHull(o.x, o.y, o.h, px, py)) return false;
  }
  // the walls at the water under a bridge (world.railU, game/decks.js: support bents, abutment faces): none inside the hull
  const RU = w.railU;
  if (RU) {
    const x0 = Math.floor(x - 2.2), x1 = Math.floor(x + 2.2), y0 = Math.floor(y - 2.2), y1 = Math.floor(y + 2.2);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!w.inBounds(tx, ty)) continue;
      const b = RU.get(w.idx(tx, ty));
      if (!b) continue;
      const g = 0.03 - inset; // (the host's check is a little more lenient: the driver's numbers are rounded)
      for (let k = 0; k <= 4; k++) {
        const f = k / 4;
        if (((b & 1) && inHull(x, y, h, tx + f, ty, g)) || ((b & 4) && inHull(x, y, h, tx + f, ty + 1, g))
          || ((b & 8) && inHull(x, y, h, tx, ty + f, g)) || ((b & 2) && inHull(x, y, h, tx + 1, ty + f, g))) return false;
      }
    }
  }
  return true;
}

// where a boat built on water tile (tx, ty) is launched: [x, y, h] — the heading with the most open water ahead,
// pushed the least away from the tile so the hull fits (null: too little water)
const r3 = (v) => Math.round(v * 1000) / 1000;
export function launchPose(game, tx, ty) {
  const w = game.world;
  let best = null, bs = 1e9;
  for (let k = 0; k < 16; k++) {
    const h = (k / 16) * Math.PI * 2 - Math.PI, c = Math.cos(h), n = Math.sin(h);
    let open = 0;
    for (let d = 1; d <= 7; d++) { const qx = Math.floor(tx + 0.5 + c * d), qy = Math.floor(ty + 0.5 + n * d); if (w.inBounds(qx, qy) && w.water.get(w.idx(qx, qy)) && !w.rock.get(w.idx(qx, qy))) open++; else break; }
    for (const off of [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]) {
      const x = tx + 0.5 + c * off, y = ty + 0.5 + n * off;
      if (!hullFree(game, x, y, h, null, 0.04)) continue;
      const sc = off - 0.35 * open;
      if (sc < bs - 1e-9) { bs = sc; best = [r3(x), r3(y), r3(h)]; }
      break;
    }
  }
  return best;
}
