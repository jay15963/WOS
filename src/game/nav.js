// Navigation: tile occupancy grid for solid props, budgeted tile A*, a door-safe mover for creatures,
// and a steering helper (direct seek when the straight line is clear, local probe avoidance, early A*
// when walls / rock / trunks are in the way, stuck detection, path smoothing). Pure simulation.
//
// Doors: a closed door / gate is world.solid 1 (blocks and is routed around by everyone, creatures
// included); an open one is 0 (everyone passes). They never open by themselves. The value-2 paths below
// (legacy "passDoors only" doors) stay for safety but nothing writes 2 any more.

import { collides, moveCircle, railCross, underAt, underFor, deckTrack, tunSet, tunTrack, tunClear } from './physics.js';
import { Layer, NodeTable } from '../world/store.js';
import { DROP_MIN, DROP_MAX, dropAhead } from './terrain.js'; // small drops a body hops down

// Bridges (game/decks.js, physics.js): a step between two tiles is tested against the walls of the level it is taken at
// — the railings on a deck, the walls at the water (support bents, abutments) under a deck or on the ground — and a
// path remembers per tile whether it went under a deck (entered through a railed side from the water / ice beside it),
// where deep water is water (only ice or shallow water: creatures do not swim). The steps physics allows, no more.
const wallsAt = (w, i, u) => (!u && w.deck && w.deck.get(i) ? w.rail : w.railU);
// may a creature step from tile i (under a deck: u) to tile j (layer nu)? (the deep water a deck does not cover)
const deepOff = (w, i, j, u, nu) => w.water.get(j) === 2 && !w.iceAt(j) && (nu || (!u && !(w.deck && w.deck.get(i)) && w.deck && w.deck.get(j)));

// ---------- occupancy (solid round props per tile) ----------
// game.occ: a sparse store layer (docs/STREAMING.md); chunks that load / leave add / drop their props
export function buildOcc(game) {
  const w = game.world;
  game.occ = new Layer('occ', Uint8Array, 0, { sparse: true });
  for (const o of w.allObjects()) if (o.solid) occAdd(game, o);
  w.onLoad.push((c, r, d) => { if (game.world === w) for (const o of d.objects) if (o.solid) occAdd(game, o); });
  w.onEvict.push((c) => { if (game.world !== w) return; w._forBucketsOf(c, (bk) => { for (const o of bk.objects) occRemove(game, o); }); });
}
const occIdx = (w, o) => {
  const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
  return w.inBounds(tx, ty) ? w.idx(tx, ty) : -1;
};
export function occAdd(game, o) {
  if (o._occ != null) return;
  const i = occIdx(game.world, o);
  if (i < 0) return;
  game.occ.set(i, Math.min(255, game.occ.get(i) + 1));
  o._occ = i;
}
export function occRemove(game, o) {
  if (o._occ == null) return;
  const v = game.occ.get(o._occ);
  if (v > 0) game.occ.set(o._occ, v - 1);
  o._occ = null;
  if (o._occX) { for (const i of o._occX) { const u = game.occ.get(i); if (u > 0) game.occ.set(i, u - 1); } o._occX = null; }
}
// extra occupied tiles for wide props (tents)
export function occAddTiles(game, o, tiles) {
  const w = game.world;
  o._occX = o._occX || [];
  for (const [tx, ty] of tiles) {
    if (!w.inBounds(tx, ty)) continue;
    const i = w.idx(tx, ty);
    if (i === o._occ) continue;
    game.occ.set(i, Math.min(255, game.occ.get(i) + 1));
    o._occX.push(i);
  }
}
export function walkable(game, tx, ty, doors = false) {
  const w = game.world;
  if (w.blocked(tx, ty)) return false;
  const i = w.idx(tx, ty);
  if (game.occ.get(i)) return false;
  const S0 = game.levels?.st[0];
  if (S0 && S0.get(i)) return false; // levels: stair steps are side walls at level 0 (entered only through their entrance)
  return doors || w.solid.get(i) !== 2;
}

// ---------- door-safe movement for creatures ----------
function overlapsDoor(w, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!w.inBounds(tx, ty) || w.solid.get(w.idx(tx, ty)) !== 2) continue;
    const cx = Math.max(tx, Math.min(tx + 1, x)), cy = Math.max(ty, Math.min(ty + 1, y));
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}
// ud: the creature would be under a bridge deck there (physics.underFor)
export const mobBlocked = (w, x, y, r, ud = false) => collides(w, x, y, r, null, false, false, ud) || overlapsDoor(w, x, y, r);

export function moveMob(game, e, dx, dy) {
  const w = game.world;
  const L = game.levels;
  if (e.passDoors || (L && (L.active || e.lv || e.z > 0))) return moveCircle(w, e, dx, dy); // levels: stairs / ramparts (moveCircle → levels.move)
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
  const sx = dx / steps, sy = dy / steps, dk = !!w.rail, tn = !!w.tunnels?.size; // (dk: bridges around — on / under a deck; tn: tunnels)
  let moved = false;
  for (let i = 0; i < steps; i++) {
    if (tn) tunSet(w, e);
    if (!mobBlocked(w, e.x + sx, e.y, e.r, dk && underFor(w, e, e.x + sx, e.y))) { e.x += sx; moved = true; }
    if (tn) tunSet(w, e);
    if (!mobBlocked(w, e.x, e.y + sy, e.r, dk && underFor(w, e, e.x, e.y + sy))) { e.y += sy; moved = true; }
  }
  if (dk) deckTrack(w, e);
  if (tn) { tunTrack(w, e); tunClear(); }
  return moved;
}

// straight-line walkability between two points (tile DDA on the center line).
// hard = only walls / rock / water / doors count (trunks are left to local avoidance); ud = it starts under a bridge deck
export function clearLine(game, x0, y0, x1, y1, doors = false, hard = false, ud = false) {
  const w = game.world;
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : 1e9, ddy = dy !== 0 ? Math.abs(1 / dy) : 1e9;
  let mx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * ddx : 1e9;
  let my = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * ddy : 1e9;
  let u = !!ud;
  for (let n = 0; n < 96; n++) {
    if (tx === ex && ty === ey) return true;
    const pi = w.idx(tx, ty);
    if (mx < my) { if (w.rail && railCross(w, tx, ty, sx, 0, wallsAt(w, pi, u))) return false; mx += ddx; tx += sx; } else { if (w.rail && railCross(w, tx, ty, 0, sy, wallsAt(w, pi, u))) return false; my += ddy; ty += sy; } // (bridges: decks.js)
    if (w.rail && w.inBounds(tx, ty)) { const ni = w.idx(tx, ty), nu = underAt(w, pi, ni, u); if (deepOff(w, pi, ni, u, nu)) return false; u = nu; }
    if (tx === ex && ty === ey) return true; // goal tile itself may hold the target's prop
    if (hard ? (w.blocked(tx, ty) || (!doors && w.solid.get(w.idx(tx, ty)) === 2)) : !walkable(game, tx, ty, doors)) return false;
  }
  return true;
}

// ---------- A* ----------
// scratch over tile indices of the whole planet: an open-addressing table (store.js NodeTable; lay: the tile was reached
// under a bridge deck), reset by a stamp
const NT = new NodeTable(15);
let heapN = new Int32Array(4096), heapF = new Float32Array(4096), heapSize = 0;

function heapPush(n, f) {
  if (heapSize >= heapN.length) {
    const a = new Int32Array(heapN.length * 2); a.set(heapN); heapN = a;
    const b = new Float32Array(heapF.length * 2); b.set(heapF); heapF = b;
  }
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= f) break;
    heapN[i] = heapN[p]; heapF[i] = heapF[p]; i = p;
  }
  heapN[i] = n; heapF[i] = f;
}
function heapPop() {
  const top = heapN[0];
  const n = heapN[--heapSize], f = heapF[heapSize];
  let i = 0;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= heapSize) break;
    if (c + 1 < heapSize && heapF[c + 1] < heapF[c]) c++;
    if (heapF[c] >= f) break;
    heapN[i] = heapN[c]; heapF[i] = heapF[c]; i = c;
  }
  heapN[i] = n; heapF[i] = f;
  return top;
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

// Returns { path: [[x,y]...] tile centers (excluding start), complete } or null.
// When the goal is unreachable within budget, returns a partial path to the closest explored tile.
// ud: the start is under a bridge deck (a tile keeps the level it was first reached at: a valid path, maybe not the
// shortest one through a bridge tile)
export function findPath(game, sx, sy, gx, gy, maxNodes = 1600, doors = false, ud = false) {
  const w = game.world, W = w.W, T = NT;
  if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
  T.reset();
  const s = w.idx(sx, sy), g = w.idx(gx, gy);
  const h = (i) => { const x = i % W, y = (i / W) | 0; const dx = Math.abs(w.dx(x, gx)), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  heapSize = 0;
  const s0 = T.slot(s);
  T.g[s0] = 0; T.par[s0] = -1; T.lay[s0] = ud ? 1 : 0;
  heapPush(s, h(s));
  const dk = !!w.rail, HL = w.height.any ? w.height : null; // (HL: terrain height — one-way drops)
  let best = s, bestH = h(s), expanded = 0;
  const free = (x, y) => w.inBounds(x, y) && ((w.idx(x, y) === g && !w.blocked(x, y) && (doors || w.solid.get(g) !== 2)) || walkable(game, x, y, doors));
  while (heapSize > 0 && expanded < maxNodes) {
    const cur = heapPop(), cs = T.find(cur);
    if (cs < 0 || T.flag[cs] === 1) continue;
    T.flag[cs] = 1;
    expanded++;
    if (cur === g) { best = cur; bestH = 0; break; }
    const cx = cur % W, cy = (cur / W) | 0;
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    for (const [dx, dy, cost] of DIRS) {
      let nx = cx + dx, ny = cy + dy, c = cost, drop = false;
      if (!free(nx, ny)) {
        // terrain height: a one-way drop over a cliff edge at most DROP_MAX lower (game/terrain.js: the body hops down)
        if (!HL || dx && dy || !w.isCliff(nx, ny) || !free(nx + dx, ny + dy)) continue;
        const dh = HL.heightAt(cx + 0.5, cy + 0.5) - HL.heightAt(nx + dx + 0.5, ny + dy + 0.5);
        if (dh < DROP_MIN || dh > DROP_MAX || w.rock.get(w.idx(nx, ny)) || w.water.get(w.idx(nx, ny)) === 2) continue;
        nx += dx; ny += dy; c = 2.6; drop = true;
      }
      if (dx && dy && (!walkable(game, cx + dx, cy, doors) || !walkable(game, cx, cy + dy, doors))) continue; // no corner cutting
      if (drop && dk) continue; // (no drops near bridges: the levels there are the decks')
      const ni = w.idx(nx, ny);
      let nu = 0;
      if (dk) { // bridges (decks.js): the walls of the level the step is taken at, the water under a deck
        const u = T.lay[cs] === 1;
        if (railCross(w, cx, cy, dx, dy, wallsAt(w, cur, u))) continue;
        nu = underAt(w, cur, ni, u) ? 1 : 0;
        if (deepOff(w, cur, ni, u, nu)) continue;
      }
      let ns = T.find(ni);
      if (ns >= 0 && T.flag[ns] === 1) continue;
      const ng = T.g[cs] + (nu ? c * 2.5 : c); // (under a deck the water is slow: a deck tile is first reached on its boards)
      if (ns >= 0 && ng >= T.g[ns]) continue;
      if (ns < 0 && (ns = T.slot(ni)) < 0) continue; // (table full: the search ends with what it has)
      T.g[ns] = ng; T.par[ns] = cur; T.lay[ns] = nu;
      heapPush(ni, ng + h(ni) * 1.05);
    }
  }
  if (best === s) return null;
  const path = [];
  for (let i = best; i !== s && i >= 0; i = T.par[T.find(i)]) path.push([w.near(i % W, sx) + 0.5, ((i / W) | 0) + 0.5]);
  path.reverse();
  return { path, complete: best === g };
}

// ---------- steering ----------
// Returns a unit direction [dx, dy] toward (gx, gy) for entity e, or null when within `arrive`.
// `expectSpeed` (tiles/s) is used for stuck detection. Uses game._pathBudget (A* calls per frame).
// `glv` = the goal's level (stories, docs/LEVELS.md §5); null = the entity's own level.
export function steer(game, e, gx, gy, dt, expectSpeed = 3, arrive = 0.2, glv = null) {
  const nav = e.nav || (e.nav = { path: null, i: 0, gx: 0, gy: 0, chkT: 0, lastD: 1e9, retryT: 0, losT: 0, side: Math.random() < 0.5 ? 1 : -1 });
  const dGoal = Math.hypot(gx - e.x, gy - e.y);
  if (dGoal <= arrive) { nav.path = null; return null; }
  const doors = !!e.passDoors;
  const w = game.world;
  // levels: with stairs / ramparts plan over (tile, level) nodes; across levels or up high always follow a path
  const LV = game.levels && (game.levels.active || e.lv || e.z > 0) ? game.levels : null;
  const elv = e.lv | 0, tlv = glv == null ? elv : glv | 0;
  const cross = !!LV && (tlv !== elv || elv > 0 || e.z > 0);
  nav.retryT -= dt;
  nav.losT -= dt;
  const wantPath = () => {
    if (nav.retryT > 0 || (game._pathBudget ?? 1) <= 0 || (dGoal < 0.9 && !cross)) return;
    game._pathBudget = (game._pathBudget ?? 1) - 1;
    const ud = !!w.rail && deckTrack(w, e); // (under a bridge deck: the path starts at the water)
    const res = LV ? LV.findPath(Math.floor(e.x), Math.floor(e.y), elv, Math.floor(gx), Math.floor(gy), tlv, 1600, doors, ud)
      : findPath(game, Math.floor(e.x), Math.floor(e.y), Math.floor(gx), Math.floor(gy), 1600, doors, ud);
    if (res && res.path.length) { nav.path = res.path; nav.i = 0; nav.gx = gx; nav.gy = gy; nav.partial = !res.complete; }
    else nav.retryT = 1.5;
    if (!res || !res.complete) { nav.side = -nav.side; nav.retryT = Math.max(nav.retryT, 0.8); }
    nav.fails = (res && res.complete) ? 0 : (nav.fails || 0) + 1;
  };
  let tx = gx, ty = gy;
  if (nav.path) {
    if (Math.hypot(gx - nav.gx, gy - nav.gy) > 1.6) nav.path = null;
    else {
      let wp = nav.path[nav.i];
      while (wp && Math.hypot(wp[0] - e.x, wp[1] - e.y) < 0.32) wp = nav.path[++nav.i];
      // smoothing: jump ahead to the furthest waypoint still in a clear straight line (max 3 ahead; level 0 only)
      if (wp && nav.losT <= 0 && !cross) {
        nav.losT = 0.25;
        for (let k = Math.min(nav.path.length - 1, nav.i + 3); k > nav.i; k--) {
          const q = nav.path[k];
          if (clearLine(game, e.x, e.y, q[0], q[1], doors, false, e._ud)) { nav.i = k; wp = q; break; }
        }
        // whole remaining way is clear: drop the path, seek directly
        if (!nav.partial && clearLine(game, e.x, e.y, gx, gy, doors, false, e._ud) && dGoal < 6) { nav.path = null; wp = null; }
      }
      if (!wp) nav.path = null;
      else { tx = wp[0]; ty = wp[1]; }
    }
  } else if (nav.losT <= 0) {
    // walls / rock / player buildings straight ahead: plan around them right away
    nav.losT = 0.5;
    if (cross ? dGoal > 0.3 : dGoal > 1.5 && !clearLine(game, e.x, e.y, gx, gy, doors, true, e._ud)) wantPath();
    if (nav.path) { const wp = nav.path[0]; tx = wp[0]; ty = wp[1]; }
  }
  let dx = tx - e.x, dy = ty - e.y;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  // local probe avoidance (trunks, other props) — also while following a path
  const pr = 0.3;
  const dk = !!w.rail; // (bridges: the probe at the level the creature would be at there)
  const blockedAt = LV ? (x, y) => LV.blockedFor(e, x, y) : doors ? (x, y) => collides(w, x, y, e.r, null, false, false, dk && underFor(w, e, x, y)) : (x, y) => mobBlocked(w, x, y, e.r, dk && underFor(w, e, x, y));
  // (a small drop ahead on the way — a path step over it, or the goal straight down it: push into its edge, ai.js go hops)
  const toDrop = !!(w.height.any && w.isCliff(Math.floor(e.x + dx * 0.55), Math.floor(e.y + dy * 0.55)) && (nav.path ? Math.hypot(tx - e.x, ty - e.y) < 2.6 : dropAhead(game, e, dx, dy)));
  if (!toDrop && blockedAt(e.x + dx * pr, e.y + dy * pr)) {
    const angs = [0.7, -0.7, 1.35, -1.35, 2.0, -2.0];
    for (const a0 of angs) {
      const a = a0 * nav.side;
      const cs = Math.cos(a), sn = Math.sin(a);
      const rx = dx * cs - dy * sn, ry = dx * sn + dy * cs;
      if (!blockedAt(e.x + rx * pr, e.y + ry * pr)) { dx = rx; dy = ry; break; }
    }
  }
  // stuck detection -> request A*
  nav.chkT += dt;
  if (nav.chkT > 0.45) {
    const progress = nav.lastD - dGoal;
    const expected = expectSpeed * nav.chkT;
    if (progress < expected * 0.25 && !nav.path) wantPath();
    else if (progress < expected * 0.1 && nav.path) { nav.path = null; nav.side = -nav.side; } // path blocked by something new
    nav.lastD = dGoal;
    nav.chkT = 0;
  }
  return [dx, dy];
}

export function resetNav(e) { if (e.nav) { e.nav.path = null; e.nav.lastD = 1e9; e.nav.chkT = 0; e.nav.fails = 0; e.nav.losT = 0; } }
