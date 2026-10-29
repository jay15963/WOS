// Navigation: tile occupancy grid for solid props, budgeted tile A*, a door-safe mover for creatures,
// and a steering helper (direct seek when the straight line is clear, local probe avoidance, early A*
// when walls / rock / trunks are in the way, stuck detection, path smoothing). Pure simulation.
//
// Doors: a closed door / gate is world.solid 1 (blocks and is routed around by everyone, creatures
// included); an open one is 0 (everyone passes). They never open by themselves. The value-2 paths below
// (legacy "passDoors only" doors) stay for safety but nothing writes 2 any more.

import { collides, moveCircle } from './physics.js';

// ---------- occupancy (solid round props per tile) ----------
export function buildOcc(game) {
  const w = game.world;
  game.occ = new Uint8Array(w.W * w.H);
  for (const c of w.chunks) for (const o of c.objects) if (o.solid) occAdd(game, o);
}
const occIdx = (w, o) => {
  const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
  return w.inBounds(tx, ty) ? w.idx(tx, ty) : -1;
};
export function occAdd(game, o) {
  if (o._occ != null) return;
  const i = occIdx(game.world, o);
  if (i < 0) return;
  game.occ[i] = Math.min(255, game.occ[i] + 1);
  o._occ = i;
}
export function occRemove(game, o) {
  if (o._occ == null) return;
  if (game.occ[o._occ] > 0) game.occ[o._occ]--;
  o._occ = null;
  if (o._occX) { for (const i of o._occX) if (game.occ[i] > 0) game.occ[i]--; o._occX = null; }
}
// extra occupied tiles for wide props (tents)
export function occAddTiles(game, o, tiles) {
  const w = game.world;
  o._occX = o._occX || [];
  for (const [tx, ty] of tiles) {
    if (!w.inBounds(tx, ty)) continue;
    const i = w.idx(tx, ty);
    if (i === o._occ) continue;
    game.occ[i] = Math.min(255, game.occ[i] + 1);
    o._occX.push(i);
  }
}
export function walkable(game, tx, ty, doors = false) {
  const w = game.world;
  if (w.blocked(tx, ty)) return false;
  const i = w.idx(tx, ty);
  if (game.occ[i]) return false;
  return doors || w.solid[i] !== 2;
}

// ---------- door-safe movement for creatures ----------
function overlapsDoor(w, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!w.inBounds(tx, ty) || w.solid[ty * w.W + tx] !== 2) continue;
    const cx = Math.max(tx, Math.min(tx + 1, x)), cy = Math.max(ty, Math.min(ty + 1, y));
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}
export const mobBlocked = (w, x, y, r) => collides(w, x, y, r) || overlapsDoor(w, x, y, r);

export function moveMob(game, e, dx, dy) {
  const w = game.world;
  if (e.passDoors) return moveCircle(w, e, dx, dy);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
  const sx = dx / steps, sy = dy / steps;
  let moved = false;
  for (let i = 0; i < steps; i++) {
    if (!mobBlocked(w, e.x + sx, e.y, e.r)) { e.x += sx; moved = true; }
    if (!mobBlocked(w, e.x, e.y + sy, e.r)) { e.y += sy; moved = true; }
  }
  return moved;
}

// straight-line walkability between two points (tile DDA on the center line).
// hard = only walls / rock / water / doors count (trunks are left to local avoidance)
export function clearLine(game, x0, y0, x1, y1, doors = false, hard = false) {
  const w = game.world;
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : 1e9, ddy = dy !== 0 ? Math.abs(1 / dy) : 1e9;
  let mx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * ddx : 1e9;
  let my = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * ddy : 1e9;
  for (let n = 0; n < 96; n++) {
    if (tx === ex && ty === ey) return true;
    if (mx < my) { mx += ddx; tx += sx; } else { my += ddy; ty += sy; }
    if (tx === ex && ty === ey) return true; // goal tile itself may hold the target's prop
    if (hard ? (w.blocked(tx, ty) || (!doors && w.solid[ty * w.W + tx] === 2)) : !walkable(game, tx, ty, doors)) return false;
  }
  return true;
}

// ---------- A* ----------
let N = 0, gArr, parent, seen, closed, stamp = 0;
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
export function findPath(game, sx, sy, gx, gy, maxNodes = 1600, doors = false) {
  const w = game.world, W = w.W;
  if (N !== w.W * w.H) {
    N = w.W * w.H;
    gArr = new Float32Array(N); parent = new Int32Array(N); seen = new Uint32Array(N); closed = new Uint32Array(N);
  }
  stamp++;
  if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
  const s = w.idx(sx, sy), g = w.idx(gx, gy);
  const h = (i) => { const x = i % W, y = (i / W) | 0; const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  heapSize = 0;
  gArr[s] = 0; parent[s] = -1; seen[s] = stamp;
  heapPush(s, h(s));
  let best = s, bestH = h(s), expanded = 0;
  const free = (x, y) => w.inBounds(x, y) && ((x === gx && y === gy && !w.blocked(x, y) && (doors || w.solid[y * W + x] !== 2)) || walkable(game, x, y, doors));
  while (heapSize > 0 && expanded < maxNodes) {
    const cur = heapPop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    expanded++;
    if (cur === g) { best = cur; bestH = 0; break; }
    const cx = cur % W, cy = (cur / W) | 0;
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx && dy && (!walkable(game, cx + dx, cy, doors) || !walkable(game, cx, cy + dy, doors))) continue; // no corner cutting
      const ni = ny * W + nx;
      if (closed[ni] === stamp) continue;
      const ng = gArr[cur] + cost;
      if (seen[ni] === stamp && ng >= gArr[ni]) continue;
      seen[ni] = stamp; gArr[ni] = ng; parent[ni] = cur;
      heapPush(ni, ng + h(ni) * 1.05);
    }
  }
  if (best === s) return null;
  const path = [];
  for (let i = best; i !== s && i >= 0; i = parent[i]) path.push([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
  path.reverse();
  return { path, complete: best === g };
}

// ---------- steering ----------
// Returns a unit direction [dx, dy] toward (gx, gy) for entity e, or null when within `arrive`.
// `expectSpeed` (tiles/s) is used for stuck detection. Uses game._pathBudget (A* calls per frame).
export function steer(game, e, gx, gy, dt, expectSpeed = 3, arrive = 0.2) {
  const nav = e.nav || (e.nav = { path: null, i: 0, gx: 0, gy: 0, chkT: 0, lastD: 1e9, retryT: 0, losT: 0, side: Math.random() < 0.5 ? 1 : -1 });
  const dGoal = Math.hypot(gx - e.x, gy - e.y);
  if (dGoal <= arrive) { nav.path = null; return null; }
  const doors = !!e.passDoors;
  const w = game.world;
  nav.retryT -= dt;
  nav.losT -= dt;
  const wantPath = () => {
    if (nav.retryT > 0 || (game._pathBudget ?? 1) <= 0 || dGoal < 0.9) return;
    game._pathBudget = (game._pathBudget ?? 1) - 1;
    const res = findPath(game, Math.floor(e.x), Math.floor(e.y), Math.floor(gx), Math.floor(gy), 1600, doors);
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
      // smoothing: jump ahead to the furthest waypoint still in a clear straight line (max 3 ahead)
      if (wp && nav.losT <= 0) {
        nav.losT = 0.25;
        for (let k = Math.min(nav.path.length - 1, nav.i + 3); k > nav.i; k--) {
          const q = nav.path[k];
          if (clearLine(game, e.x, e.y, q[0], q[1], doors)) { nav.i = k; wp = q; break; }
        }
        // whole remaining way is clear: drop the path, seek directly
        if (!nav.partial && clearLine(game, e.x, e.y, gx, gy, doors) && dGoal < 6) { nav.path = null; wp = null; }
      }
      if (!wp) nav.path = null;
      else { tx = wp[0]; ty = wp[1]; }
    }
  } else if (nav.losT <= 0) {
    // walls / rock / player buildings straight ahead: plan around them right away
    nav.losT = 0.5;
    if (dGoal > 1.5 && !clearLine(game, e.x, e.y, gx, gy, doors, true)) wantPath();
    if (nav.path) { const wp = nav.path[0]; tx = wp[0]; ty = wp[1]; }
  }
  let dx = tx - e.x, dy = ty - e.y;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  // local probe avoidance (trunks, other props) — also while following a path
  const pr = 0.3;
  const blockedAt = doors ? (x, y) => collides(w, x, y, e.r) : (x, y) => mobBlocked(w, x, y, e.r);
  if (blockedAt(e.x + dx * pr, e.y + dy * pr)) {
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
