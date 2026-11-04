// The plan of one settlement (docs/REINOS.md "Implementação — geração"): a pure function of (planet, realm, settlement)
// computed the same on every peer and thread — the chunk workers use its ground (flat lots, cleared and dry land, paved
// streets, fields) and the game materializes its structures chunk by chunk (game/towns.js).
//
// L = {
//   sid, kind, x, y, r (town land radius), ro, A (wall half extent, octagon), C (corner cut),
//   structs: [[type, tx, ty, rot, lv, style, det]]   every piece, lower stories first, roofs last (index = its id suffix)
//   buildings: [{ key, name, work, pop, box [x0,y0,x1,y1], door [x,y], beds [i], work [i], lights [i], guard }]
//   gates: [i] (gate structures), mural: i, plaza: [x, y, r],
//   pens: [{ x0, y0, x1, y1, species, n }], fields: [{ x0, y0, x1, y1, crop }],
//   hooks: { homes: [{ b, beds }], work: [{ b, at }], guards: [[x, y]], patrol: [[x, y]], archers: [[x, y, lv]], artillery: [i] },
//   grid: { x0, y0, w, h, pave (Uint8 path type per tile), flag (Uint8: 1 clear, 2 dry, 4 field, crop << 4), th / tw
//           (Float32 target height / weight per corner, (w+1)·(h+1)) }
// }
// No Math.random, no trig in the data (a rounded direction table), deterministic iteration order.

import { BLEND } from './realm.js';
import { PREFABS, stampPrefab, lotOf, SIZE, WOOD_STYLES, WINDOWS } from './prefabs.js';
import { baseHeight } from '../planet/chunk.js';
import { rng32 } from '../planet/noise.js';

export const F_CLEAR = 1, F_DRY = 2, F_FIELD = 4;
export const CROPS = ['', 'wild_wheat', 'wild_potato', 'wild_corn', 'wild_cotton'];
export const PAVE = { dirt: 1, gravel: 2, flag: 3, cobble: 4, steps: 5 };

const CACHE = new WeakMap();
export function settlementLayout(planet, realm, sid) {
  let M = CACHE.get(realm);
  if (!M) CACHE.set(realm, (M = new Map()));
  let L = M.get(sid);
  if (!L) { L = buildLayout(planet, realm, realm.settlements[sid]); M.set(sid, L); }
  return L;
}
export const layoutCached = (realm, sid) => CACHE.get(realm)?.get(sid) || null;
// Across threads: a chunk worker makes the layout anyway (the town's ground, ground.js) and sends it once with a chunk
// (planetSource.js workerGenerator) — the main thread adopts it instead of planning the place in a frame (a city ~25–55
// ms). The pieces travel as one Int32Array (7 numbers a row) + a string table.
export function packLayout(L) {
  const dict = [], at = new Map(), n = L.structs.length, rows = new Int32Array(n * 7);
  const id = (s) => { let k = at.get(s); if (k == null) { k = dict.length; dict.push(s); at.set(s, k); } return k; };
  for (let k = 0; k < n; k++) {
    const r = L.structs[k], o = k * 7;
    rows[o] = id(r[0]); rows[o + 1] = r[1]; rows[o + 2] = r[2]; rows[o + 3] = r[3]; rows[o + 4] = r[4]; rows[o + 5] = id(r[5]); rows[o + 6] = id(r[6]);
  }
  return { ...L, structs: null, dict, rows };
}
export function adoptLayout(realm, P) {
  let M = CACHE.get(realm);
  if (!M) CACHE.set(realm, (M = new Map()));
  if (M.has(P.sid)) return M.get(P.sid);
  const { dict, rows } = P, n = rows.length / 7, structs = new Array(n);
  for (let k = 0; k < n; k++) { const o = k * 7; structs[k] = [dict[rows[o]], rows[o + 1], rows[o + 2], rows[o + 3], rows[o + 4], dict[rows[o + 5]], dict[rows[o + 6]]]; }
  const L = { ...P, structs };
  delete L.dict; delete L.rows;
  M.set(P.sid, L);
  return L;
}

// ---------- the plan being built ----------
const O_FREE = 0, O_STREET = 1, O_PLAZA = 2, O_BUILD = 3, O_MARGIN = 4, O_WALL = 5, O_FIELD = 6, O_PEN = 7, O_RES = 8;
class Plan {
  constructor(planet, realm, s) {
    this.planet = planet; this.realm = realm; this.s = s;
    this.cx = Math.round(s.x); this.cy = Math.round(s.y);
    const R = s.ro + BLEND + 2;
    this.R = R;
    this.x0 = this.cx - R; this.y0 = this.cy - R; this.w = this.h = 2 * R + 1;
    const n = this.w * this.h;
    this.occ = new Uint8Array(n); this.pave = new Uint8Array(n); this.flag = new Uint8Array(n);
    this.structs = []; this.pads = []; this.buildings = []; this.gates = []; this.fields = []; this.pens = [];
    this.hooks = { homes: [], work: [], guards: [], patrol: [], archers: [], artillery: [] };
    this.rng = rng32(s.seed | 0);
    this.towers = [];
    // the smooth town ground: the generated base height sampled every 8 tiles, bilinear in between
    const st = 8, nx = Math.ceil(this.w / st) + 2;
    this.st = st; this.nx = nx;
    this.lat = new Float32Array(nx * nx);
    const o = {};
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) this.lat[j * nx + i] = baseHeight(planet, this.x0 + i * st, this.y0 + j * st, o);
  }
  S(x, y) {
    const u = (x - this.x0) / this.st, v = (y - this.y0) / this.st, nx = this.nx;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(u))), j = Math.max(0, Math.min(nx - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i)), fv = Math.max(0, Math.min(1, v - j)), L = this.lat;
    const a = L[j * nx + i] + (L[j * nx + i + 1] - L[j * nx + i]) * fu, b = L[(j + 1) * nx + i] + (L[(j + 1) * nx + i + 1] - L[(j + 1) * nx + i]) * fu;
    return a + (b - a) * fv;
  }
  rnd() { return this.rng(); }
  in(x, y) { return x >= this.x0 && y >= this.y0 && x < this.x0 + this.w && y < this.y0 + this.h; }
  i(x, y) { return (y - this.y0) * this.w + (x - this.x0); }
  get(x, y) { return this.in(x, y) ? this.occ[this.i(x, y)] : O_RES; }
  set(x, y, v) { if (this.in(x, y)) this.occ[this.i(x, y)] = v; } // sync-ok: the plan's own occupancy grid (pure data, not game.occ)
  setPave(x, y, t, over = false) { if (!this.in(x, y)) return; const k = this.i(x, y); if (over || !this.pave[k]) this.pave[k] = t; this.flag[k] |= F_CLEAR | F_DRY; }
  d2(x, y) { const dx = x + 0.5 - this.s.x, dy = y + 0.5 - this.s.y; return dx * dx + dy * dy; }
  put(type, tx, ty, rot = 0, lv = 0, style = '', det = '') { this.structs.push([type, tx, ty, rot | 0, lv | 0, style || '', det || '']); return this.structs.length - 1; }
  // a flat lot: corners x0..x1 × y0..y1 at height h, blending into the town ground over m tiles
  pad(x0, y0, x1, y1, h, m = 2) { this.pads.push([x0, y0, x1, y1, h, m]); }
  // free rectangle (tiles x..x+w-1, y..y+h-1) with a margin, all inside the town land
  fits(x, y, w, h, margin = 1, rmax = this.s.r - 1) {
    for (let yy = y - margin; yy < y + h + margin; yy++) for (let xx = x - margin; xx < x + w + margin; xx++) {
      const o = this.get(xx, yy);
      const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
      if (inside ? o !== O_FREE : o === O_BUILD || o === O_WALL || o === O_PLAZA) return false;
    }
    for (const [xx, yy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) if (this.d2(xx, yy) > rmax * rmax) return false;
    return true;
  }
  mark(x, y, w, h, v, margin = 0, mv = O_MARGIN) {
    for (let yy = y - margin; yy < y + h + margin; yy++) for (let xx = x - margin; xx < x + w + margin; xx++) {
      const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
      if (inside) this.set(xx, yy, v); else if (this.get(xx, yy) === O_FREE) this.set(xx, yy, mv);
      if (this.in(xx, yy)) this.flag[this.i(xx, yy)] |= F_CLEAR | F_DRY;
    }
  }
  // a street from (ax, ay) to (bx, by), `wd` tiles wide, paved with t
  street(ax, ay, bx, by, wd, t) {
    const L = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), n = Math.max(1, Math.ceil(L * 2));
    const h = wd / 2;
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      for (let yy = Math.floor(y - h); yy <= Math.floor(y + h - 0.01); yy++) for (let xx = Math.floor(x - h); xx <= Math.floor(x + h - 0.01); xx++) {
        const o = this.get(xx, yy);
        if (o === O_BUILD || o === O_WALL) continue;
        if (o !== O_PLAZA) this.set(xx, yy, O_STREET);
        this.setPave(xx, yy, t);
      }
    }
  }
  // the building of prefab `key` with its lot's top-left at (x, y), turned R
  building(key, x, y, R, opt = {}) {
    const P = PREFABS[key];
    const [lw, lh] = lotOf(key, R);
    const b = stampPrefab(key, x, y, R, (t, tx, ty, rot, lv, st, dt) => this.put(t, tx, ty, rot, lv, st, dt), opt);
    const [bx0, by0, bx1, by1] = b.box;
    // its lot: built, cleared, dry, flat at the town ground of its middle (quarter stories)
    this.mark(x, y, lw, lh, O_BUILD, 1);
    const h = Math.round(this.S((bx0 + bx1 + 1) / 2, (by0 + by1 + 1) / 2) * 4) / 4;
    this.pad(Math.min(x, bx0) - 1, Math.min(y, by0) - 1, Math.max(x + lw, bx1 + 1) + 1, Math.max(y + lh, by1 + 1) + 1, h, 3);
    // the roof over the building's own tiles
    const roofs = b.tiles.map(([tx, ty]) => this.put(opt.roof?.[0] || P.roof[0], tx, ty, 0, 0, opt.roof?.[1] || P.roof[1], opt.roofDet || ''));
    const rec = { key, name: P.name, work: P.work || null, pop: P.pop || 0, guard: !!P.guard, box: b.box, door: b.door, beds: b.beds, ws: b.work, lights: b.lights, roofs };
    this.buildings.push(rec);
    // the door's step: a short path to the street in front of it
    if (b.door) {
      const [dx, dy] = b.door, f = FRONT[R & 3];
      for (let k = 1; k <= 3; k++) { const px = dx + f[0] * k, py = dy + f[1] * k; if (this.get(px, py) === O_STREET || this.get(px, py) === O_PLAZA) break; if (this.get(px, py) !== O_BUILD || k === 1) this.setPave(px, py, opt.path || PAVE.dirt); }
    }
    return rec;
  }
}
const FRONT = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // the front's outward direction for R = 0..3 (S, W, N, E)

// ---------- the octagon (town walls / town land outline) ----------
// sides at x = ±A, y = ±A (axis sides, where gates go) and four diagonal sides cutting the corners by C
function octagonTiles(cx, cy, A, C) {
  const pts = [[A - C, -A], [A, -(A - C)], [A, A - C], [A - C, A], [-(A - C), A], [-A, A - C], [-A, -(A - C)], [-(A - C), -A]];
  const out = [], seen = new Set();
  const add = (x, y, side) => { const k = x * 100003 + y; if (seen.has(k)) return; seen.add(k); out.push([cx + x, cy + y, side]); };
  for (let k = 0; k < 8; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % 8];
    if (ax === bx || ay === by) { // straight axis run
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let t = 0; t <= n; t++) add(ax + Math.sign(bx - ax) * t, ay + Math.sign(by - ay) * t, k);
    } else { // diagonal: a 4-connected staircase
      const sx = Math.sign(bx - ax), sy = Math.sign(by - ay), n = Math.abs(bx - ax);
      for (let t = 0; t <= n; t++) { add(ax + sx * t, ay + sy * t, k); if (t < n) add(ax + sx * (t + 1), ay + sy * t, k); }
    }
  }
  return { tiles: out, pts };
}
// the axis side (0 N, 1 E, 2 S, 3 W) of a direction
const sideOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
const SIDE_N = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// ---------- walls with gates and towers ----------
// kind 'palisade' (one story of logs) | 'stone' (two stories, battlements, towers, stairs up to the wall walk)
function buildWalls(P, A, C, kind, gates, opt = {}) {
  const { tiles } = octagonTiles(P.cx, P.cy, A, C);
  const gateAt = new Map(); // tile key → gate index
  const gateTiles = [];
  // a gate: 2 tiles on an axis side, centred near the wanted offset
  for (const g of gates) {
    const [nx, ny] = SIDE_N[g.side];
    const along = Math.max(-(A - C) + 3, Math.min(A - C - 4, Math.round(g.off)));
    const gx = nx ? P.cx + nx * A : P.cx + along, gy = ny ? P.cy + ny * A : P.cy + along;
    const tiles2 = nx ? [[gx, gy], [gx, gy + 1]] : [[gx, gy], [gx + 1, gy]];
    g.x = tiles2[0][0]; g.y = tiles2[0][1]; g.vert = !!nx;
    for (const [x, y] of tiles2) gateAt.set(x * 100003 + y, g);
    gateTiles.push(g);
  }
  const stone = kind === 'stone';
  const wallT = stone ? 'wall_stone' : 'wall_wood', style = stone ? (opt.style || 'cut') : 'log';
  const towerSet = new Set();
  if (stone) {
    // towers: the 8 corners of the octagon, the middle of long sides, both sides of every gate (3 × 3 solid blocks)
    const T = (x, y) => towerSet.add(x * 100003 + y);
    for (const [x, y] of [[A - C, -A], [A, -(A - C)], [A, A - C], [A - C, A], [-(A - C), A], [-A, A - C], [-A, -(A - C)], [-(A - C), -A]]) T(P.cx + x, P.cy + y);
    for (const g of gateTiles) {
      if (g.vert) { T(g.x, g.y - 2); T(g.x, g.y + 3); } else { T(g.x - 2, g.y); T(g.x + 3, g.y); }
    }
    if (A - C > 14) for (let s = 0; s < 4; s++) { const [nx, ny] = SIDE_N[s]; const ok = !gateTiles.some((g) => g.side === s && Math.abs((nx ? g.y : g.x) - (nx ? P.cy : P.cx)) < 6); if (ok) T(P.cx + nx * A, P.cy + ny * A); }
    for (const k of towerSet) { const x = Math.floor(k / 100003 + 0.5), y = k - x * 100003; P.towers.push([x, y]); }
  }
  // the wall line (towers are drawn over it as blocks); stone walls: two stories with battlements on the upper one
  const det2 = stone ? 'crenel' : 'crenel';
  for (const [x, y] of tiles) {
    if (gateAt.has(x * 100003 + y)) continue;
    P.set(x, y, O_WALL); P.flag[P.i(x, y)] |= F_CLEAR | F_DRY;
    if (stone) { P.put(wallT, x, y, 0, 0, style, ''); P.put(wallT, x, y, 0, 1, style, det2); } else P.put(wallT, x, y, 0, 0, style, det2);
  }
  for (const g of gateTiles) {
    const type = stone ? 'gate_stone' : 'gate_big_wood';
    const k = P.put(type, g.x, g.y, g.vert ? 1 : 0, 0, '', '');
    P.gates.push(k);
    for (let t = 0; t < 2; t++) { const x = g.x + (g.vert ? 0 : t), y = g.y + (g.vert ? t : 0); P.set(x, y, O_STREET); P.flag[P.i(x, y)] |= F_CLEAR | F_DRY; }
    if (stone) for (let t = 0; t < 2; t++) P.put(wallT, g.x + (g.vert ? 0 : t), g.y + (g.vert ? t : 0), 0, 1, style, det2); // (the wall walk goes over the gate)
    // torches / braziers by the gate (inside), a guard spot
    const [nx, ny] = SIDE_N[g.side];
    const ix = g.x - nx * 2, iy = g.y - ny * 2;
    P.hooks.guards.push([ix + (g.vert ? 0.5 : 1), iy + (g.vert ? 1 : 0.5)]);
  }
  if (stone) {
    for (const [x, y] of P.towers) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = x + dx, ty = y + dy;
        if (gateAt.has(tx * 100003 + ty)) continue;
        const on = P.get(tx, ty) === O_WALL;
        P.set(tx, ty, O_WALL); P.flag[P.i(tx, ty)] |= F_CLEAR | F_DRY;
        if (!on) { P.put(wallT, tx, ty, 0, 0, style, ''); P.put(wallT, tx, ty, 0, 1, style, (dx || dy) ? det2 : ''); }
      }
      // the tower top (story 2, a platform on the wall walk): artillery and archers
      P.hooks.archers.push([x + 0.5, y + 0.5, 2]);
    }
    // stairs up to the wall walk, inside, at the middle of each long stretch: two 1-story blocks + two flights
    stairsUp(P, A, C, wallT, style, gateTiles);
  } else palisadeStairs(P, A, C, gateTiles);
  // the patrol loop: just inside the wall
  for (let s = 0; s < 8; s++) {
    const a = s / 8, [ux, uy] = DIR8[s];
    const d = A - 3;
    P.hooks.patrol.push([P.cx + ux * d * (s & 1 ? 0.78 : 1) + 0.5, P.cy + uy * d * (s & 1 ? 0.78 : 1) + 0.5]);
    void a;
  }
  // the wall's ground: flat along the line (quarter stories of the town ground)
  for (const [x, y] of tiles) { const h = Math.round(P.S(x + 0.5, y + 0.5) * 4) / 4; P.pad(x, y, x + 1, y + 1, h, 1); }
  return gateTiles;
}
const DIR8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

// a stair block against the inside of an axis side: 1-story walls (x, 1..3 inward), a flight on the ground climbing onto
// the block's end and a flight on the block climbing onto the wall walk (docs/LEVELS.md: a stair climbs one story)
function stairsUp(P, A, C, wallT, style, gates) {
  for (let s = 0; s < 4; s++) {
    const [nx, ny] = SIDE_N[s], ix = -nx, iy = -ny; // inward
    // along the side, away from gates and towers
    let best = null;
    for (const off of [5, -6, 9, -10, 2]) {
      const ax = nx ? P.cx + nx * A : P.cx + off, ay = ny ? P.cy + ny * A : P.cy + off;
      if (Math.abs(off) > A - C - 4) continue;
      if (gates.some((g) => g.side === s && Math.abs((nx ? g.y - ay : g.x - ax)) < 6)) continue;
      if (P.towers.some(([tx, ty]) => Math.abs(tx - ax) <= 3 && Math.abs(ty - ay) <= 3)) continue;
      best = [ax, ay]; break;
    }
    if (!best) continue;
    const [wx, wy] = best;
    // the block: 3 tiles inward from the wall (x stays on the wall's normal line)
    const B = [1, 2, 3].map((d) => [wx + ix * d, wy + iy * d]);
    // the ground flight beside the block's far end, climbing onto it sideways; along the wall: perpendicular
    const ax = -iy, ay = ix; // along the wall
    const end = B[2];
    const g0 = [end[0] - ax * 2, end[1] - ay * 2]; // 2 tiles beside the end (the flight's footprint end next to the block)
    const ok = [...B, [end[0] - ax, end[1] - ay], g0, [end[0] - ax * 3, end[1] - ay * 3]].every(([x, y]) => P.get(x, y) === O_FREE || P.get(x, y) === O_MARGIN);
    if (!ok) continue;
    for (const [x, y] of B) { P.set(x, y, O_WALL); P.flag[P.i(x, y)] |= F_CLEAR | F_DRY; P.put(wallT, x, y, 0, 0, style, ''); }
    // story-1 flight on the block: footprint B[0], B[1] (1×2 along the normal), climbing outward onto the wall walk
    // (rot: ascends N = 0, S = 2, E = 1, W = 3 — rot 0 climbs north (−y); the outward normal picks it)
    const up1 = ny === -1 ? 0 : ny === 1 ? 2 : nx === 1 ? 1 : 3;
    const f1 = ny ? [Math.min(B[0][0], B[1][0]), Math.min(B[0][1], B[1][1])] : [Math.min(B[0][0], B[1][0]), B[0][1]];
    P.put('stairs_wood', f1[0], f1[1], up1, 1, '', '');
    // the ground flight: 2 tiles along the wall ending next to B[2], climbing toward it
    const toEnd = ax > 0 ? 1 : ax < 0 ? 3 : ay > 0 ? 2 : 0; // climbs +along → toward the block? (+along = ax, ay)
    const fx = Math.min(end[0] - ax, end[0] - ax * 2), fy = Math.min(end[1] - ay, end[1] - ay * 2);
    P.put('stairs_wood', fx, fy, toEnd, 0, '', '');
    for (let t = 1; t <= 3; t++) { const x = end[0] - ax * t, y = end[1] - ay * t; P.set(x, y, O_BUILD); P.flag[P.i(x, y)] |= F_CLEAR | F_DRY; }
    P.hooks.archers.push([wx + 0.5, wy + 0.5, 2]);
  }
}

// The palisade's wall walk (story 1: the tops of the log walls and of the gates — levels.js wall tops) is reached by
// wooden stairs on the inside, climbing straight onto the wall: one beside each gate (2–6 tiles from it, off the street)
// and one in the middle of each axis side without a gate; the walk goes all round (the diagonal sides are a 4-connected
// line of wall tops). Archer spots (phase 2) on each landing and on the wall beside each gate (docs/REINOS.md "Fase 2").
function palisadeStairs(P, A, C, gates) {
  const lim = A - C - 2, want = [];
  for (let s = 0; s < 4; s++) {
    const gs = gates.filter((g) => g.side === s);
    if (gs.length) for (const g of gs) { const a = g.vert ? g.y - P.cy : g.x - P.cx; want.push([s, [a - 3, a + 4, a - 4, a + 5, a - 5, a + 6, a - 6, a + 7]]); }
    else want.push([s, [0, 2, -2, 4, -4, 6, -6, 8, -8]]);
  }
  const okTile = (x, y) => { const o = P.get(x, y); return o === O_FREE || o === O_MARGIN; };
  for (const [s, offs] of want) {
    const [nx, ny] = SIDE_N[s];
    for (const off of offs) {
      if (Math.abs(off) > lim) continue;
      const wx = nx ? P.cx + nx * A : P.cx + off, wy = ny ? P.cy + ny * A : P.cy + off;
      if (P.get(wx, wy) !== O_WALL) continue; // (the landing: a wall top — not a gate)
      const T = [1, 2, 3].map((d) => [wx - nx * d, wy - ny * d]); // the two steps, then the foot of the stair (kept free)
      if (!T.every(([x, y]) => okTile(x, y))) continue;
      // (a stair climbs away from its entrance — rot 0 N, 1 E, 2 S, 3 W here: toward the wall)
      const rot = ny === -1 ? 0 : ny === 1 ? 2 : nx === 1 ? 1 : 3;
      P.put('stairs_wood', Math.min(T[0][0], T[1][0]), Math.min(T[0][1], T[1][1]), rot, 0, '', '');
      for (const [x, y] of T) { P.set(x, y, x === T[2][0] && y === T[2][1] ? O_RES : O_BUILD); P.flag[P.i(x, y)] |= F_CLEAR | F_DRY; }
      // its ground at the wall's (a flat run to the foot of the wall)
      const h = Math.round(P.S(wx + 0.5, wy + 0.5) * 4) / 4;
      P.pad(Math.min(wx, T[2][0]), Math.min(wy, T[2][1]), Math.max(wx, T[2][0]) + 1, Math.max(wy, T[2][1]) + 1, h, 1);
      P.hooks.archers.push([wx + 0.5, wy + 0.5, 1]);
      break;
    }
  }
  // the wall beside each gate (the guard's spot over the gate)
  for (const g of gates) {
    const [ax, ay] = g.vert ? [0, -1] : [-1, 0];
    const x = g.x + ax, y = g.y + ay;
    if (P.get(x, y) === O_WALL) P.hooks.archers.push([x + 0.5, y + 0.5, 1]);
  }
}

// ---------- fields and pens in the outer ring ----------
function farmland(P, A, roads, crops, nPens, nFields = 10) {
  const s = P.s, out = s.ro - 2, inner = A + 4;
  let nf = 0;
  const nearRoad = (x, y) => roads.some(([ax, ay, bx, by]) => segDist(x, y, ax, ay, bx, by) < 4);
  const cells = [];
  for (let gy = -out; gy <= out; gy += 3) for (let gx = -out; gx <= out; gx += 3) cells.push([gx, gy]);
  cells.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[0] - b[0] || a[1] - b[1]);
  let pens = 0;
  for (const [gx, gy] of cells) {
    const fw = 6 + Math.floor(P.rnd() * 3), fh = 4 + Math.floor(P.rnd() * 2);
    const x = P.cx + gx, y = P.cy + gy;
    // fully outside the walls' ring, inside the outer ring, off the roads
    let ok = true;
    for (const [xx, yy] of [[x, y], [x + fw, y], [x, y + fh], [x + fw, y + fh]]) {
      const dx = Math.abs(xx - P.cx), dy = Math.abs(yy - P.cy);
      if ((dx < inner && dy < inner) || (dx + dy < inner * 1.6 && dx < inner + 4 && dy < inner + 4)) ok = false;
      if (P.d2(xx, yy) > out * out) ok = false;
    }
    if (!ok) continue;
    for (let yy = y; yy < y + fh && ok; yy++) for (let xx = x; xx < x + fw; xx++) if (P.get(xx, yy) !== O_FREE || nearRoad(xx + 0.5, yy + 0.5)) { ok = false; break; }
    if (!ok) continue;
    if (pens < nPens && (Math.abs(gx) < inner + 10 || Math.abs(gy) < inner + 10)) {
      // a pen: fence ring with a small gate, hay, the village's animals
      const sp = ['sheep', 'cow', 'pig', 'chicken'][Math.floor(P.rnd() * 4)];
      for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) {
        P.set(xx, yy, O_PEN); P.flag[P.i(xx, yy)] |= F_CLEAR;
        const edge = xx === x || yy === y || xx === x + fw - 1 || yy === y + fh - 1;
        if (!edge) continue;
        const gate = yy === y + fh - 1 && xx === x + (fw >> 1);
        P.put(gate ? 'gate_wood' : 'fence_wood', xx, yy, 0, 0, gate ? 'rail' : 'rail', '');
      }
      P.put('haystack', x + 1, y + 1, 0, 0, '', '');
      P.pens.push({ x0: x + 1, y0: y + 1, x1: x + fw - 1, y1: y + fh - 1, species: sp, n: sp === 'chicken' ? 4 : sp === 'cow' ? 2 : 3 });
      pens++;
      continue;
    }
    if (nf >= nFields) continue;
    nf++;
    const crop = crops[Math.floor(P.rnd() * crops.length)];
    for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) {
      P.set(xx, yy, O_FIELD);
      P.flag[P.i(xx, yy)] |= F_CLEAR | F_FIELD | (crop << 4);
      P.put('farm_plot', xx, yy, 0, 0, '', '');
    }
    // a path along one side of the field
    for (let xx = x - 1; xx <= x + fw; xx++) P.setPave(xx, y + fh, PAVE.dirt);
    P.fields.push({ x0: x, y0: y, x1: x + fw, y1: y + fh, crop: CROPS[crop] });
    if (P.rnd() < 0.3) P.put('scarecrow', x + (fw >> 1), y + (fh >> 1), 0, 0, '', '');
  }
}
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
  let t = L > 0 ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + vx * t - px, dy = ay + vy * t - py;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------- lots along the streets ----------
// try to put prefab `key` beside the street segment (ax, ay)→(bx, by) at fraction t, on side sg (±1), facing it
function lotBeside(P, key, ax, ay, bx, by, t, sg, wd, opt) {
  const vx = bx - ax, vy = by - ay, L = Math.sqrt(vx * vx + vy * vy) || 1, ux = vx / L, uy = vy / L;
  const nx = -uy * sg, ny = ux * sg; // from the street to the lot
  const R = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 1 : 3) : ny > 0 ? 2 : 0; // the front faces the street (−n)
  const [lw, lh] = lotOf(key, R);
  const px = ax + vx * t + nx * (wd / 2 + 1), py = ay + vy * t + ny * (wd / 2 + 1);
  // the lot's front edge touches (px, py): place the rect away from the street
  let x, y;
  if (R === 0) { x = Math.round(px - lw / 2); y = Math.round(py) - lh; }
  else if (R === 2) { x = Math.round(px - lw / 2); y = Math.round(py); }
  else if (R === 1) { x = Math.round(px); y = Math.round(py - lh / 2); }
  else { x = Math.round(px) - lw; y = Math.round(py - lh / 2); }
  if (!P.fits(x, y, lw, lh, 1, opt.rmax)) return null;
  return P.building(key, x, y, R, opt);
}

// the first of the wanted specials (in order) that fits here, else the first home that does
function tryLots(P, want, homes, ax, ay, bx, by, t, sg, wd, opt) {
  for (const key of want) { const b = lotBeside(P, key, ax, ay, bx, by, t, sg, wd, opt); if (b) { b.special = true; return b; } }
  for (const key of homes) { const b = lotBeside(P, key, ax, ay, bx, by, t, sg, wd, opt); if (b) return b; }
  return null;
}

// infill: buildings in the free blocks left between the streets, facing the plaza, each with a lane to the nearest
// paved tile
function infill(P, keys, popWant, pop, opt, rmax, path = PAVE.dirt) {
  const c = [];
  for (let y = P.cy - rmax; y <= P.cy + rmax; y += 2) for (let x = P.cx - rmax; x <= P.cx + rmax; x += 2) if (P.d2(x, y) < rmax * rmax) c.push([P.d2(x, y) + P.rnd() * 30, x, y]);
  c.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  let hi = 0;
  for (const [, x, y] of c) {
    if (pop >= popWant && !keys.special.length) break;
    const dx = P.cx - x, dy = P.cy - y;
    const R = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : dy > 0 ? 0 : 2; // the front toward the middle
    const list = [...keys.special, ...(pop < popWant ? [keys.homes[hi % keys.homes.length], 'house_s'] : [])];
    for (const key of list) {
      const [lw, lh] = lotOf(key, R);
      const x0 = x - (lw >> 1), y0 = y - (lh >> 1);
      if (!P.fits(x0, y0, lw, lh, 1, rmax)) continue;
      const b = P.building(key, x0, y0, R, opt);
      if (b.door) lane(P, b.door[0], b.door[1], R, path);
      if (keys.special.includes(key)) keys.special.splice(keys.special.indexOf(key), 1); else hi++;
      pop += b.pop;
      break;
    }
  }
  return pop;
}
// a lane from a door out to the nearest paved tile (straight along the front, then across)
function lane(P, x, y, R, t) {
  const f = FRONT[R & 3];
  let best = null, bd = 1e9;
  for (let r = 2; r <= 14 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const xx = x + dx, yy = y + dy;
    if (!P.in(xx, yy) || !P.pave[P.i(xx, yy)] || P.get(xx, yy) === O_BUILD) continue;
    const d = dx * dx + dy * dy - (dx * f[0] + dy * f[1]) * 2;
    if (d < bd) { bd = d; best = [xx, yy]; }
  }
  if (!best) return;
  let cx = x + f[0], cy = y + f[1];
  for (let k = 0; k < 40 && (cx !== best[0] || cy !== best[1]); k++) {
    const o = P.get(cx, cy);
    if (o === O_BUILD && k > 0) break;
    if (o !== O_BUILD) { P.setPave(cx, cy, t); if (o === O_FREE || o === O_MARGIN) P.set(cx, cy, O_STREET); }
    if (Math.abs(best[0] - cx) > Math.abs(best[1] - cy)) cx += Math.sign(best[0] - cx); else cy += Math.sign(best[1] - cy);
  }
}

// the mural on the north side of a plaza (a 4 × 1 board facing south: the camera sees its front), lamps and flower beds
// at its ends, and the spot in front of it where a new world starts (the start village: planetSource.js)
function muralCorner(P, x, y) {
  P.mural = P.put('town_mural', x - 2, y, 0, 0, '', '');
  for (let k = -2; k < 2; k++) P.set(x + k, y, O_RES);
  P.put('lamp_post', x - 3, y, 0, 0, '', ''); P.put('lamp_post', x + 2, y, 0, 0, '', '');
  P.put('flower_bed', x - 3, y + 1, 0, 0, '', ''); P.put('flower_bed', x + 2, y + 1, 0, 0, '', '');
  for (const [a, b] of [[x - 3, y], [x + 2, y], [x - 3, y + 1], [x + 2, y + 1]]) P.set(a, b, O_RES);
  P.spawn = [x + 0.5, y + 2.6];
  for (let dy = 1; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) if (P.get(x + dx, y + dy) === O_PLAZA) P.set(x + dx, y + dy, O_RES);
}

// ---------- the village ----------
function planVillage(P) {
  const s = P.s, r = s.r;
  const A = Math.max(16, r - 2), C = Math.round(A * 0.42);
  P.A = A; P.C = C;
  const woodStyle = WOOD_STYLES[Math.floor(P.rnd() * WOOD_STYLES.length)];
  const win = WINDOWS[Math.floor(P.rnd() * WINDOWS.length)];
  // exits: the realm's roads, one axis side each (+ a second street when there is only one road)
  const exits = s.exits.length ? s.exits.map(([x, y]) => [x - s.x, y - s.y]) : [[0, 1]];
  const sides = new Map();
  for (const [dx, dy] of exits) { const sd = sideOf(dx, dy); if (!sides.has(sd)) sides.set(sd, [dx, dy]); }
  if (sides.size < 2) { const sd = (([...sides.keys()][0] ?? 2) + 2) % 4; sides.set(sd, SIDE_N[sd].map((v) => v * 10)); }
  // the plaza: a paved square in the middle with the well and the mural
  const pr = 4 + (r > 30 ? 1 : 0);
  for (let y = P.cy - pr; y <= P.cy + pr; y++) for (let x = P.cx - pr; x <= P.cx + pr; x++) { P.set(x, y, O_PLAZA); P.setPave(x, y, PAVE.gravel); }
  P.pad(P.cx - pr - 1, P.cy - pr - 1, P.cx + pr + 2, P.cy + pr + 2, Math.round(P.S(P.cx + 0.5, P.cy + 0.5) * 4) / 4, 4);
  P.plaza = [P.cx + 0.5, P.cy + 0.5, pr];
  muralCorner(P, P.cx, P.cy - pr + 1);
  P.put('well', P.cx + 2, P.cy + 2, 0, 0, '', '');
  P.put('bench_wood', P.cx - 3, P.cy + pr - 1, 2, 0, '', '');
  // streets: plaza → gate (on its axis side) → out to the road
  const streets = [], roads = [];
  const gates = [];
  for (const [sd, [dx, dy]] of [...sides].sort((a, b) => a[0] - b[0])) {
    const [nx, ny] = SIDE_N[sd];
    const along = nx ? dy : dx, off = Math.max(-(A - C) + 3, Math.min(A - C - 4, Math.round(along * 0.35)));
    const gx = nx ? P.cx + nx * A : P.cx + off, gy = ny ? P.cy + ny * A : P.cy + off;
    gates.push({ side: sd, off });
    const sx = P.cx + nx * pr, sy = P.cy + ny * pr;
    const ex = gx + 0.5 + (nx ? 0 : 0.5), ey = gy + 0.5 + (ny ? 0 : 0.5);
    streets.push([sx + 0.5, sy + 0.5, ex, ey]);
    // outside the gate: to the road's exit point
    const far = s.exits.find(([x, y]) => sideOf(x - s.x, y - s.y) === sd) || [P.cx + nx * (A + 10), P.cy + ny * (A + 10)];
    roads.push([ex, ey, far[0], far[1]]);
  }
  for (const [ax, ay, bx, by] of streets) P.street(ax, ay, bx, by, 3, PAVE.dirt);
  for (const [ax, ay, bx, by] of roads) P.street(ax, ay, bx, by, 3, PAVE.dirt);
  // a ring lane halfway out (more lots), on bigger villages
  const lanes = [];
  if (r >= 24) {
    const a = Math.round(A * 0.56), c = Math.round(a * 0.42);
    const pts = [[a - c, -a], [a, -(a - c)], [a, a - c], [a - c, a], [-(a - c), a], [-a, a - c], [-a, -(a - c)], [-(a - c), -a]];
    for (let k = 0; k < 8; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 8]; lanes.push([P.cx + x0 + 0.5, P.cy + y0 + 0.5, P.cx + x1 + 0.5, P.cy + y1 + 0.5]); }
    for (const [ax, ay, bx, by] of lanes) P.street(ax, ay, bx, by, 2, PAVE.dirt);
  }
  // the buildings: the specials first (nearest the plaza), then homes until the population is housed
  const want = ['tavern', 'smithy', 'granary'];
  if (P.rnd() < 0.6) want.push('chapel');
  if (P.rnd() < 0.7) want.push('sawmill');
  if (P.rnd() < 0.5) want.push('weaver');
  if (P.rnd() < 0.5) want.push('stable');
  if (P.s.hilly) want.push('mine');
  let pop = 0;
  const homes = ['house_m', 'house_s', 'house_s2', 'house_l', 'house_m', 'house_s'];
  const opt = { style: woodStyle, win, rmax: A - 3 };
  const segs = [...streets.map((q) => [...q, 3]), ...lanes.map((q) => [...q, 2])];
  let hi = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (const [ax, ay, bx, by, wd] of segs) {
      const L = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      for (let d = 2; d < L - 2; d += 2) for (const sg of [1, -1]) {
        if (pop >= s.pop && !want.length) break;
        const b = tryLots(P, want, pop < s.pop ? [homes[hi % homes.length], 'house_s'] : [], ax, ay, bx, by, d / L, sg, wd, opt);
        if (!b) continue;
        if (b.special) want.splice(want.indexOf(b.key), 1); else hi++;
        pop += b.pop;
      }
    }
    if (pop >= s.pop && !want.length) break;
  }
  pop = infill(P, { special: want, homes }, s.pop, pop, opt, A - 3);
  P.popHoused = pop;
  // walls (some villages) and guard posts by the gates (all of them)
  if (s.walls === 'palisade') buildWalls(P, A, C, 'palisade', gates);
  else {
    for (const g of gates) { const [nx, ny] = SIDE_N[g.side]; P.hooks.guards.push([P.cx + nx * A + 0.5, P.cy + ny * A + 0.5]); }
    for (let k = 0; k < 8; k++) { const [ux, uy] = DIR8[k]; P.hooks.patrol.push([P.cx + ux * (A - 2) + 0.5, P.cy + uy * (A - 2) + 0.5]); }
  }
  for (const g of gates) {
    const [nx, ny] = SIDE_N[g.side];
    // a guard post just inside the gate, beside the street
    const gx = nx ? P.cx + nx * (A - 6) : P.cx + g.off, gy = ny ? P.cy + ny * (A - 6) : P.cy + g.off;
    for (const sg of [1, -1]) {
      const b = lotBeside(P, 'guardpost', gx - nx * 4, gy - ny * 4, gx, gy, 0.5, sg, 3, { ...opt, rmax: A + 1 });
      if (b) break;
    }
    // a torch on each side of the gate
    const tx = nx ? P.cx + nx * (A - 1) : P.cx + g.off - 1, ty = ny ? P.cy + ny * (A - 1) : P.cy + g.off - 1;
    if (P.get(tx, ty) === O_FREE) P.put('torch', tx, ty, 0, 0, '', '');
    const tx2 = nx ? tx : tx + 3, ty2 = ny ? ty : ty + 3;
    if (P.get(tx2, ty2) === O_FREE) P.put('torch', tx2, ty2, 0, 0, '', '');
  }
  // fields and pens outside
  const crops = P.s.crops || [1, 1, 2, 3];
  farmland(P, A, roads, crops, 2 + (r > 28 ? 1 : 0), Math.round(s.pop / 6));
  // the town land is cleared up to the wall line (inside it nothing grows over the lanes / lots)
  clearCore(P, A + 2);
}
function clearCore(P, A) {
  for (let y = P.cy - A; y <= P.cy + A; y++) for (let x = P.cx - A; x <= P.cx + A; x++) if (P.in(x, y) && Math.abs(x - P.cx) + Math.abs(y - P.cy) <= A * 1.6) P.flag[P.i(x, y)] |= F_DRY | (P.get(x, y) !== O_FREE ? F_CLEAR : 0);
}

// ---------- the ground: target heights and weights per corner ----------
function groundOf(P, coreR) {
  const W1 = P.w + 1, H1 = P.h + 1, th = new Float32Array(W1 * H1), tw = new Float32Array(W1 * H1);
  const s = P.s, r0 = coreR, r1 = coreR + 10;
  for (let j = 0; j < H1; j++) for (let i = 0; i < W1; i++) {
    const x = P.x0 + i, y = P.y0 + j, dx = x - s.x, dy = y - s.y, d = Math.sqrt(dx * dx + dy * dy);
    const k = j * W1 + i;
    th[k] = P.S(x, y);
    tw[k] = d <= r0 ? 1 : d >= r1 ? 0 : smooth(1 - (d - r0) / (r1 - r0));
  }
  // flat lots (in order: later ones win where they overlap)
  for (const [x0, y0, x1, y1, h, m] of P.pads) {
    for (let y = y0 - m; y <= y1 + m; y++) for (let x = x0 - m; x <= x1 + m; x++) {
      const i = x - P.x0, j = y - P.y0;
      if (i < 0 || j < 0 || i >= W1 || j >= H1) continue;
      const ddx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, ddy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0, dd = Math.max(ddx, ddy);
      const wv = dd === 0 ? 1 : smooth(1 - dd / (m + 1));
      const k = j * W1 + i;
      th[k] = th[k] + (h - th[k]) * wv;
      if (tw[k] < wv) tw[k] = wv;
    }
  }
  return { th, tw };
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function buildLayout(planet, realm, s) {
  const P = new Plan(planet, realm, s);
  // terrain hints: hills around (a mine), the crops of the climate
  const o = {};
  baseHeight(planet, s.x, s.y, o);
  s.hilly = o.relief > 0.12 || o.mtn > 0.05;
  const T = o.T;
  s.crops = T > 18 ? [3, 3, 2, 4] : T < 6 ? [2, 2, 1] : [1, 1, 2, 3];
  if (s.kind === 'village') planVillage(P);
  else if (s.kind === 'castle') planCastle(P);
  else planCity(P);
  // structures: lower stories first, roofs last (a roof needs its walls; an upper piece the story below)
  const order = P.structs.map((r, i) => i);
  const isRoof = (t) => t.startsWith('roof_');
  order.sort((a, b) => {
    const A = P.structs[a], B = P.structs[b];
    return (isRoof(A[0]) - isRoof(B[0])) || (A[4] - B[4]) || (a - b);
  });
  const remap = new Int32Array(P.structs.length);
  order.forEach((old, nw) => { remap[old] = nw; });
  const structs = order.map((i) => P.structs[i]);
  const R = (i) => (i >= 0 ? remap[i] : -1);
  for (const b of P.buildings) { b.beds = b.beds.map(R); b.ws = b.ws.map(R); b.lights = b.lights.map(R); b.roofs = b.roofs.map(R); }
  const hooks = P.hooks;
  P.buildings.forEach((b, bi) => {
    if (b.beds.length) hooks.homes.push({ b: bi, beds: b.beds });
    if (b.work) hooks.work.push({ b: bi, at: b.ws.length ? b.ws : [], name: b.work });
  });
  hooks.artillery = hooks.artillery.map(R);
  const { th, tw } = groundOf(P, s.kind === 'castle' ? P.A + 6 : (P.A || s.r) + 4);
  return {
    sid: s.id, kind: s.kind, x: s.x, y: s.y, r: s.r, ro: s.ro, A: P.A, C: P.C, pop: s.pop, housed: P.popHoused || 0,
    structs, buildings: P.buildings, gates: P.gates.map(R), mural: R(P.mural ?? -1), plaza: P.plaza || [s.x, s.y, 4],
    pens: P.pens, fields: P.fields, hooks, towers: P.towers, spawn: P.spawn || [s.x + 0.5, s.y + 0.5],
    grid: { x0: P.x0, y0: P.y0, w: P.w, h: P.h, pave: P.pave, flag: P.flag, th, tw },
  };
}

// ---------- castle and city (castle.js-like modules in this file) ----------
// The castle: a square stone ward (two-story curtain with battlements, towers on the corners, a gatehouse toward the main
// road, stairs up to the wall walk), the keep, barracks, stores, a stable and a well in a paved courtyard; outside, a
// small civilian annex with fields and pens that feed it.
function planCastle(P) {
  const s = P.s;
  const A = Math.max(16, Math.min(19, s.r - 1)), C = 3;
  P.A = A; P.C = C;
  const ex = s.exits.length ? s.exits.map(([x, y]) => [x - s.x, y - s.y]) : [[0, 1]];
  const main = sideOf(ex[0][0], ex[0][1]);
  // the whole ward stands on one flat pad (a levelled hilltop)
  const h = Math.round(P.S(P.cx + 0.5, P.cy + 0.5) * 4) / 4;
  P.pad(P.cx - A - 2, P.cy - A - 2, P.cx + A + 3, P.cy + A + 3, h, 6);
  // the courtyard: cobbles
  for (let y = P.cy - A + 1; y < P.cy + A; y++) for (let x = P.cx - A + 1; x < P.cx + A; x++) if (Math.abs(x - P.cx) + Math.abs(y - P.cy) < 2 * A - C - 1) { P.setPave(x, y, PAVE.cobble); }
  const gates = [{ side: main, off: 0 }];
  buildWalls(P, A, C, 'stone', gates, { style: 'cut' });
  const [gnx, gny] = SIDE_N[main];
  // the keep opposite the gate, barracks and stores on the sides
  // a building pushed from (cx, cy) toward the middle until it fits inside the ward
  const place = (key, cx, cy, R) => {
    const [lw, lh] = lotOf(key, R);
    for (let k = 0; k <= 8; k++) {
      const fx = cx + (P.cx - cx) * k / 10, fy = cy + (P.cy - cy) * k / 10;
      const x = Math.round(fx - lw / 2), y = Math.round(fy - lh / 2);
      if (P.fits(x, y, lw, lh, 1, A * 1.5)) return P.building(key, x, y, R, { path: PAVE.cobble });
    }
    return null;
  };
  const RT = [2, 3, 0, 1][main]; // the keep faces the gate (its front toward the gate's side)
  const keep = place('keep', P.cx - gnx * (A - 5), P.cy - gny * (A - 5), RT);
  void keep;
  const lx = -gny, ly = gnx; // along the gate's side
  place('barracks', P.cx + lx * (A - 5), P.cy + ly * (A - 5), sideFace(-lx, -ly));
  place('storehouse', P.cx - lx * (A - 5) - gnx * 3, P.cy - ly * (A - 5) - gny * 3, sideFace(lx, ly));
  place('stable', P.cx - lx * (A - 5) + gnx * 6, P.cy - ly * (A - 5) + gny * 6, sideFace(lx, ly));
  P.put('well', P.cx + gnx * 2, P.cy + gny * 2, 0, 0, '', '');
  { const mx = P.cx + gnx * (A - 6) + lx * 4, my = P.cy + gny * (A - 6) + ly * 4; muralCorner(P, Math.round(mx), Math.round(my)); }
  P.plaza = [P.cx + gnx * 3 + 0.5, P.cy + gny * 3 + 0.5, 4];
  for (const k of [-1, 1]) P.put('training_dummy', P.cx + gnx * 4 + lx * 4 * k, P.cy + gny * 4 + ly * 4 * k, 0, 0, '', '');
  for (const k of [-1, 1]) P.put('brazier', P.cx + gnx * (A - 2) + lx * 3 * k, P.cy + gny * (A - 2) + ly * 3 * k, 0, 0, '', '');
  // ballistas on two towers
  let nb = 0;
  for (const [x, y] of P.towers) { if (nb >= 2) break; if ((x - P.cx) * gnx + (y - P.cy) * gny > A - 2 && P.towers.length) { P.hooks.artillery.push(P.put('ballista', x, y, main === 0 ? 2 : main === 1 ? 3 : main === 2 ? 0 : 1, 2, '', '')); nb++; } }
  // the annex outside the gate: farmhouses, fields and pens
  const road = s.exits[0] || [P.cx + gnx * (s.ro - 4), P.cy + gny * (s.ro - 4)];
  const gx = P.cx + gnx * A + 0.5, gy = P.cy + gny * A + 0.5;
  P.street(gx + (gnx ? 0 : 0.5), gy + (gny ? 0 : 0.5), road[0], road[1], 3, PAVE.gravel);
  const opt = { style: 'log', rmax: s.ro - 4 };
  for (let d = 6, n = 0; d < s.ro - A - 6 && n < 3; d += 4) for (const sg of [1, -1]) {
    if (n >= 3) break;
    const b = lotBeside(P, n === 2 ? 'stable' : 'farmhouse', gx, gy, road[0], road[1], d / Math.max(1, Math.sqrt((road[0] - gx) ** 2 + (road[1] - gy) ** 2)), sg, 3, opt);
    if (b) n++;
  }
  farmland(P, A + 4, [[gx, gy, road[0], road[1]]], P.s.crops || [1, 2], 2, 6);
  clearCore(P, A + 2);
}
const sideFace = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : dy > 0 ? 0 : 2); // R whose front faces (dx, dy)

// The city: a big walled town (stone walls, gates with towers on the roads, ballistas on the towers), districts of houses,
// crafts and a market around a castle in the middle.
function planCity(P) {
  const s = P.s, r = s.r;
  const A = Math.max(40, r - 4), C = Math.round(A * 0.38);
  P.A = A; P.C = C;
  const exits = s.exits.length ? s.exits.map(([x, y]) => [x - s.x, y - s.y]) : [[0, 1], [0, -1]];
  const sides = new Map();
  for (const [dx, dy] of exits) { const sd = sideOf(dx, dy); if (!sides.has(sd)) sides.set(sd, [dx, dy]); }
  for (const sd of [2, 0, 1, 3]) if (sides.size < 3 && !sides.has(sd)) sides.set(sd, SIDE_N[sd].map((v) => v * 10));
  // the inner castle (a small ward with the keep) in the middle
  const IA = 11, IC = 3;
  const hC = Math.round(P.S(P.cx + 0.5, P.cy + 0.5) * 4) / 4;
  P.pad(P.cx - IA - 2, P.cy - IA - 2, P.cx + IA + 3, P.cy + IA + 3, hC, 5);
  for (let y = P.cy - IA + 1; y < P.cy + IA; y++) for (let x = P.cx - IA + 1; x < P.cx + IA; x++) P.setPave(x, y, PAVE.cobble);
  const mainSide = [...sides.keys()][0] ?? 2;
  const sub = new Plan(P.planet, P.realm, { ...s, r: IA + 3, ro: IA + 4, exits: [] });
  void sub;
  const innerGate = [{ side: mainSide, off: 0 }];
  const saveTowers = P.towers; P.towers = [];
  buildWalls(P, IA, IC, 'stone', innerGate, { style: 'cut' });
  const innerTowers = P.towers; P.towers = saveTowers;
  const [mnx, mny] = SIDE_N[mainSide], lx = -mny, ly = mnx;
  const keepR = [2, 3, 0, 1][mainSide];
  const [kw, kh] = lotOf('keep', keepR);
  const kx = Math.round(P.cx - mnx * 3 - kw / 2), ky = Math.round(P.cy - mny * 3 - kh / 2);
  if (P.fits(kx, ky, kw, kh, 0, IA + 2)) P.building('keep', kx, ky, keepR, { path: PAVE.cobble });
  P.put('well', P.cx + mnx * 6 + lx * 5, P.cy + mny * 6 + ly * 5, 0, 0, '', '');
  // the market plaza in front of the castle gate
  const pcx = P.cx + mnx * (IA + 8), pcy = P.cy + mny * (IA + 8), pr = 6;
  for (let y = pcy - pr; y <= pcy + pr; y++) for (let x = pcx - pr; x <= pcx + pr; x++) if (P.get(x, y) === O_FREE || P.get(x, y) === O_MARGIN) { P.set(x, y, O_PLAZA); P.setPave(x, y, PAVE.flag, true); }
  P.pad(pcx - pr - 1, pcy - pr - 1, pcx + pr + 2, pcy + pr + 2, Math.round(P.S(pcx + 0.5, pcy + 0.5) * 4) / 4, 4);
  P.plaza = [pcx + 0.5, pcy + 0.5, pr];
  P.put('fountain', pcx + 2, pcy + 1, 0, 0, '', '');
  muralCorner(P, pcx, pcy - pr + 1);
  // market stalls around the plaza: awnings (pergolas) with goods
  const stall = (x, y) => { if (P.get(x, y) !== O_PLAZA) return; P.put('pergola', x, y, 0, 0, '', ''); P.put(['crates', 'sacks', 'barrel'][Math.floor(P.rnd() * 3)], x + 2, y + 1, 0, 0, '', ''); };
  stall(pcx - pr + 1, pcy - pr + 1); stall(pcx + pr - 2, pcy - pr + 1); stall(pcx - pr + 1, pcy + pr - 2); stall(pcx + pr - 2, pcy + pr - 2);
  for (const [dx, dy] of [[-pr, 0], [pr, 0], [0, -pr], [0, pr]]) if (P.get(pcx + dx, pcy + dy) === O_PLAZA) P.put('lamp_post', pcx + dx, pcy + dy, 0, 0, '', '');
  // streets: from the inner castle's ring out to the city gates (cobbles), a ring street between
  const gates = [], streets = [], roads = [];
  for (const [sd, [dx, dy]] of [...sides].sort((a, b) => a[0] - b[0])) {
    const [nx, ny] = SIDE_N[sd];
    const along = nx ? dy : dx, off = Math.max(-(A - C) + 4, Math.min(A - C - 5, Math.round(along * 0.3)));
    gates.push({ side: sd, off });
    const gx = nx ? P.cx + nx * A : P.cx + off, gy = ny ? P.cy + ny * A : P.cy + off;
    const ex = gx + 0.5 + (nx ? 0 : 0.5), ey = gy + 0.5 + (ny ? 0 : 0.5);
    const sx = P.cx + nx * (IA + 3) + 0.5, sy = P.cy + ny * (IA + 3) + 0.5;
    streets.push([sx, sy, ex, ey]);
    const far = s.exits.find(([x, y]) => sideOf(x - s.x, y - s.y) === sd) || [P.cx + nx * (A + 12), P.cy + ny * (A + 12)];
    roads.push([ex, ey, far[0], far[1]]);
  }
  for (const q of streets) P.street(q[0], q[1], q[2], q[3], 4, PAVE.cobble);
  for (const q of roads) P.street(q[0], q[1], q[2], q[3], 3, PAVE.gravel);
  const ring = (a) => { const c = Math.round(a * 0.4), pts = [[a - c, -a], [a, -(a - c)], [a, a - c], [a - c, a], [-(a - c), a], [-a, a - c], [-a, -(a - c)], [-(a - c), -a]]; const L = []; for (let k = 0; k < 8; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 8]; L.push([P.cx + x0 + 0.5, P.cy + y0 + 0.5, P.cx + x1 + 0.5, P.cy + y1 + 0.5]); } return L; };
  const ringIn = ring(IA + 3), ringMid = ring(Math.round((IA + A) * 0.5) + 2);
  for (const q of ringIn) P.street(q[0], q[1], q[2], q[3], 3, PAVE.cobble);
  for (const q of ringMid) P.street(q[0], q[1], q[2], q[3], 3, PAVE.cobble);
  // the buildings: crafts and services first, then houses (townhouses near the middle, cottages outward)
  const want = ['tavern', 'chapel', 'smithy', 'storehouse', 'granary', 'weaver', 'barracks', 'stable', 'sawmill', 'smithy', 'tavern', 'storehouse'];
  const homesIn = ['townhouse', 'house_stone', 'townhouse', 'cottage_stone'], homesOut = ['house_m', 'cottage_stone', 'house_s2', 'house_stone', 'house_m'];
  const opt = { style: 'timber', win: 'window_shutters', rmax: A - 3, path: PAVE.gravel };
  let pop = 0, hi = 0;
  const segs = [...ringIn.map((q) => [...q, 3]), ...streets.map((q) => [...q, 4]), ...ringMid.map((q) => [...q, 3])];
  for (let pass = 0; pass < 3; pass++) {
    for (const [ax, ay, bx, by, wd] of segs) {
      const L = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      for (let d = 2; d < L - 2; d += 2) for (const sg of [1, -1]) {
        if (pop >= s.pop && !want.length) break;
        const mid = (ax + (bx - ax) * d / L - P.cx) ** 2 + (ay + (by - ay) * d / L - P.cy) ** 2 < (A * 0.55) ** 2;
        const b = tryLots(P, want, pop < s.pop ? [(mid ? homesIn : homesOut)[hi % 4], 'cottage_stone', 'house_s'] : [], ax, ay, bx, by, d / L, sg, wd, opt);
        if (!b) continue;
        if (b.special) want.splice(want.indexOf(b.key), 1); else hi++;
        pop += b.pop;
      }
    }
    if (pop >= s.pop && !want.length) break;
  }
  pop = infill(P, { special: want, homes: homesOut }, s.pop, pop, opt, A - 3, PAVE.gravel);
  P.popHoused = pop;
  // lamp posts along the streets (the city glows at night)
  for (const [ax, ay, bx, by] of streets) {
    const L = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), ux = (bx - ax) / L, uy = (by - ay) / L;
    for (let d = 6; d < L - 4; d += 9) { const x = Math.round(ax + ux * d - uy * 3), y = Math.round(ay + uy * d + ux * 3); if (P.get(x, y) === O_FREE || P.get(x, y) === O_MARGIN) { P.put('lamp_post', x, y, 0, 0, '', ''); P.set(x, y, O_RES); } }
  }
  // the city walls: two stories, towers, gates on the roads; ballistas on the towers by the gates and the corners
  const gs = buildWalls(P, A, C, 'stone', gates, { style: 'rough' });
  let nb = 0;
  for (const [x, y] of P.towers) {
    if (nb >= 8) break;
    const nearGate = gs.some((g) => Math.abs(g.x - x) <= 4 && Math.abs(g.y - y) <= 4);
    if (!nearGate && nb >= 4) continue;
    const ox = x - P.cx, oy = y - P.cy, out = Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? 3 : 1) : oy > 0 ? 0 : 2; // (rot = front S, W, N, E: facing out)
    P.hooks.artillery.push(P.put('ballista', x, y, out, 2, '', ''));
    nb++;
  }
  P.towers.push(...innerTowers);
  farmland(P, A + 3, roads, P.s.crops || [1, 2, 3], 3, 22);
  clearCore(P, A + 2);
}
