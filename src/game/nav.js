// Navigation: tile occupancy grid for solid props, budgeted tile A*, and a steering helper
// (direct seek + local probe avoidance + A* fallback when stuck). Pure simulation.

import { collides } from './physics.js';

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
}
export function walkable(game, tx, ty) {
  const w = game.world;
  return !w.blocked(tx, ty) && !game.occ[w.idx(tx, ty)];
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
export function findPath(game, sx, sy, gx, gy, maxNodes = 1600) {
  const w = game.world, W = w.W;
  if (N !== w.W * w.H) {
    N = w.W * w.H;
    gArr = new Float32Array(N); parent = new Int32Array(N); seen = new Uint32Array(N); closed = new Uint32Array(N);
  }
  stamp++;
  const s = w.idx(sx, sy), g = w.idx(gx, gy);
  if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
  const h = (i) => { const x = i % W, y = (i / W) | 0; const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  heapSize = 0;
  gArr[s] = 0; parent[s] = -1; seen[s] = stamp;
  heapPush(s, h(s));
  let best = s, bestH = h(s), expanded = 0;
  const free = (x, y) => w.inBounds(x, y) && ((x === gx && y === gy) || walkable(game, x, y));
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
      if (dx && dy && (!walkable(game, cx + dx, cy) || !walkable(game, cx, cy + dy))) continue; // no corner cutting
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
  const nav = e.nav || (e.nav = { path: null, i: 0, gx: 0, gy: 0, chkT: 0, lastD: 1e9, retryT: 0, side: Math.random() < 0.5 ? 1 : -1 });
  const dGoal = Math.hypot(gx - e.x, gy - e.y);
  if (dGoal <= arrive) { nav.path = null; return null; }
  nav.retryT -= dt;
  let tx = gx, ty = gy;
  if (nav.path) {
    if (Math.hypot(gx - nav.gx, gy - nav.gy) > 1.6) nav.path = null;
    else {
      let wp = nav.path[nav.i];
      while (wp && Math.hypot(wp[0] - e.x, wp[1] - e.y) < 0.32) wp = nav.path[++nav.i];
      if (!wp) nav.path = null;
      else { tx = wp[0]; ty = wp[1]; }
    }
  }
  let dx = tx - e.x, dy = ty - e.y;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  const w = game.world;
  if (!nav.path) {
    const pr = 0.3;
    if (collides(w, e.x + dx * pr, e.y + dy * pr, e.r)) {
      const angs = [0.7, -0.7, 1.35, -1.35, 2.0, -2.0];
      for (const a0 of angs) {
        const a = a0 * nav.side;
        const cs = Math.cos(a), sn = Math.sin(a);
        const rx = dx * cs - dy * sn, ry = dx * sn + dy * cs;
        if (!collides(w, e.x + rx * pr, e.y + ry * pr, e.r)) { dx = rx; dy = ry; break; }
      }
    }
  }
  // stuck detection -> request A*
  nav.chkT += dt;
  if (nav.chkT > 0.45) {
    const progress = nav.lastD - dGoal;
    const expected = expectSpeed * nav.chkT;
    if (progress < expected * 0.25 && !nav.path && nav.retryT <= 0 && (game._pathBudget ?? 1) > 0 && dGoal > 0.9) {
      game._pathBudget = (game._pathBudget ?? 1) - 1;
      const res = findPath(game, Math.floor(e.x), Math.floor(e.y), Math.floor(gx), Math.floor(gy));
      if (res && res.path.length) { nav.path = res.path; nav.i = 0; nav.gx = gx; nav.gy = gy; nav.partial = !res.complete; }
      else nav.retryT = 1.5;
      if (!res || !res.complete) nav.side = -nav.side;
      nav.fails = (res && res.complete) ? 0 : (nav.fails || 0) + 1;
    }
    nav.lastD = dGoal;
    nav.chkT = 0;
  }
  return [dx, dy];
}

export function resetNav(e) { if (e.nav) { e.nav.path = null; e.nav.lastD = 1e9; e.nav.chkT = 0; e.nav.fails = 0; } }
