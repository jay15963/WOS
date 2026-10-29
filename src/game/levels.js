// Height levels (docs/LEVELS.md): stories lv 0..MAX_LV, stairs (portals between stories), ramparts (walkable
// wall tops), per-level collision and stair traversal, falls, jump down, a level-aware A*, combat helpers and
// drawing helpers (lift, depth keys).
//
// The level map is DERIVED from the replicated structures (rebuilt whenever game.build.v changes), so every
// peer computes the same map with no extra ops. Entities carry `lv` (collision / navigation level) and `z`
// (height in stories, continuous on stairs); both are owner-authoritative like positions (the presence and
// entity streams replicate z). Anything without level data is level 0, and with no stairs in the world and
// nobody up high every hook takes the old level-0 path.
//
// Hooks elsewhere (one-liners marked `levels:`): physics.moveCircle, nav.{moveMob, walkable, steer},
// combat.{reach, attackRange, hasLOS}, projectiles (heights), ai / bandits (target level), game.js (speed,
// camera, depth keys, lift), session / entities (z), save (player z), placeReason (stairwell).

import { BUILDINGS } from './data.js';
import { tileBlocked } from './physics.js';
import { walkable } from './nav.js';
import { WALL_H } from '../art/structures.js';

export const MAX_LV = 3;
export const STORY_H = WALL_H;   // screen height of one story (tiles): a wall top is the next story's floor
export const STAIR_SPEED = 0.8;
const GRAV = 26;                 // stories / s² (falls and hops)
const EPS = 1e-3;

// drawing lift (tiles) of an entity standing at height z
export const liftOf = (e) => (e && e.z > 0 ? e.z * STORY_H : 0);
// same story (melee, contact): heights closer than half a story
export const sameLevel = (a, b) => Math.abs((a?.z || 0) - (b?.z || 0)) < 0.5;
// ranged height advantage: +12 % range per story above the target (max 2 stories)
export const heightK = (a, b) => 1 + 0.12 * Math.max(0, Math.min(2, (a?.z || 0) - (b?.z || 0)));

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
const isWallTop = (def) => def.connect === 'wall' && (def.block === 'tile' || def.block === 'door');

export function installLevels(game) {
  const L = new Levels(game);
  game.levels = L;
  game.world.levels = L; // physics / LOS only get the world
  return L;
}

export class Levels {
  constructor(game) {
    this.game = game;
    this.v = -1;
    this._active = false;
    this.surf = [];      // [k] Uint8Array(W*H) | undefined: standable surface at level k (k ≥ 1)
    this.blk = [];       // [k] Uint8Array | undefined: blocked at level k [P2: upper walls, railings, furniture]
    this.st = [];        // [k] Int32Array: stair index + 1 (steps at level n, the open stairwell at level n + 1)
    this.stairs = [];
    this.node = [];      // [k] Int32Array tile -> A* node id (k ≥ 1)
    this.M = 0;          // upper nodes
    this.nodeTile = new Int32Array(64);
    this.nodeLv = new Uint8Array(64);
    this._nb = new Int32Array(16); this._nc = new Float32Array(16);
  }

  // any stairs in the world (level traversal possible)? Rebuilds the map when the structures changed.
  get active() { this.sync(); return this._active; }
  sync() { const b = this.game.build; if (b && b.v !== this.v) this.rebuild(); return this; }

  _arr(list, k, Ctor, n) {
    let a = list[k];
    if (!a || a.length !== n) a = list[k] = new Ctor(n);
    return a;
  }

  rebuild() {
    const g = this.game, w = g.world, W = w.W, N = W * w.H;
    this.v = g.build.v;
    for (const a of this.surf) a?.fill(0);
    for (const a of this.blk) a?.fill(0);
    for (const a of this.st) a?.fill(0);
    this.stairs.length = 0;
    for (const o of g.build.structures) {
      if (o.blueprint || o.moveOf || o.removed) continue;
      const def = BUILDINGS[o.type];
      if (!def) continue;
      const lv = o.lv | 0;
      if (def.block === 'stairs') { this._addStair(o, lv); continue; }
      if (isWallTop(def) && lv < MAX_LV) {
        const S = this._arr(this.surf, lv + 1, Uint8Array, N);
        for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) if (w.inBounds(x, y)) S[y * W + x] = 1;
      }
      // [P2] upper floors (floor_* with lv ≥ 1) → surf[lv]; upper walls / doors / railings / furniture → blk[lv]
    }
    this._active = this.stairs.length > 0;
    this._nodesV = -1; // A* nodes are built on the first path request
  }

  _addStair(o, n) {
    const w = this.game.world, W = w.W, N = W * w.H;
    const fw = o.fw || 1, fh = o.fh || 1, tx = o.tx, ty = o.ty, r = o.rot & 3;
    const id = (x, y) => (w.inBounds(x, y) ? y * W + x : -1);
    let ax, sg, b, len, l0, l1, ent, land;
    const tiles = [];
    if (r === 0) { ax = 1; sg = -1; b = ty + fh; len = fh; l0 = tx; l1 = tx + fw; ent = id(tx, ty + fh); land = id(tx, ty - 1); for (let k = 0; k < len; k++) tiles.push(id(tx, ty + fh - 1 - k)); }
    else if (r === 2) { ax = 1; sg = 1; b = ty; len = fh; l0 = tx; l1 = tx + fw; ent = id(tx, ty - 1); land = id(tx, ty + fh); for (let k = 0; k < len; k++) tiles.push(id(tx, ty + k)); }
    else if (r === 1) { ax = 0; sg = 1; b = tx; len = fw; l0 = ty; l1 = ty + fh; ent = id(tx - 1, ty); land = id(tx + fw, ty); for (let k = 0; k < len; k++) tiles.push(id(tx + k, ty)); }
    else { ax = 0; sg = -1; b = tx + fw; len = fw; l0 = ty; l1 = ty + fh; ent = id(tx + fw, ty); land = id(tx - 1, ty); for (let k = 0; k < len; k++) tiles.push(id(tx + fw - 1 - k, ty)); }
    if (tiles.some((i) => i < 0)) return;
    const s = { o, n, ax, sg, b, len, l0, l1, ent, land, tiles, i0: tiles[0], i1: tiles[len - 1], idx: this.stairs.length };
    this.stairs.push(s);
    for (const k of [n, n + 1]) {
      if (k > MAX_LV) continue;
      const A = this._arr(this.st, k, Int32Array, N);
      for (const i of tiles) A[i] = s.idx + 1;
    }
    o._sy = ty + 0.2; // depth key: drawn before anything standing on it (docs/LEVELS.md §8)
  }

  _buildNodes() {
    const w = this.game.world, N = w.W * w.H;
    this._nodesV = this.v;
    this.M = 0;
    for (let k = 1; k <= MAX_LV; k++) {
      const S = this.surf[k];
      if (!S) { if (this.node[k]) this.node[k].fill(-1); continue; }
      const A = this._arr(this.node, k, Int32Array, N);
      A.fill(-1);
      for (let i = 0; i < N; i++) {
        if (!S[i]) continue;
        if (this.M >= this.nodeTile.length) {
          const a = new Int32Array(this.nodeTile.length * 2); a.set(this.nodeTile); this.nodeTile = a;
          const b = new Uint8Array(this.nodeLv.length * 2); b.set(this.nodeLv); this.nodeLv = b;
        }
        A[i] = N + this.M;
        this.nodeTile[this.M] = i; this.nodeLv[this.M] = k;
        this.M++;
      }
    }
  }

  // ---------- queries ----------
  _tile(x, y) { const w = this.game.world, tx = Math.floor(x), ty = Math.floor(y); return w.inBounds(tx, ty) ? ty * w.W + tx : -1; }
  isSurface(k, i) { return k === 0 || (i >= 0 && !!this.surf[k]?.[i]); }
  // stair whose footprint holds (x, y) for an entity walking at level lv (steps at n = lv, or entered from n + 1 = lv)
  stairAt(lv, x, y) {
    const A = this.st[lv];
    if (!A) return null;
    const i = this._tile(x, y);
    const id = i >= 0 ? A[i] : 0;
    return id ? this.stairs[id - 1] : null;
  }
  onStair(e) { return !!this.stairAt(e.lv | 0, e.x, e.y); }
  uOf(s, x, y) { return (s.sg * ((s.ax ? y : x) - s.b)) / s.len; }
  // is a level-(n+1) cover (roof / upper floor) forbidden at (tx, ty) because a stair comes up there?
  stairwell(tx, ty, lv = 1) {
    this.sync();
    const A = this.st[lv], w = this.game.world;
    if (!A || !w.inBounds(tx, ty)) return false;
    const id = A[ty * w.W + tx];
    return !!id && this.stairs[id - 1].n + 1 === lv;
  }
  // extra placement rule for stairs (placeReason hook): the stairwell above must be open
  stairsReason(type, tx, ty, rot = 0, lv = 0) {
    this.sync();
    const def = BUILDINGS[type];
    if (!def) return null;
    const [w0, h0] = def.size || [1, 2];
    const [fw, fh] = def.rotate && (rot & 1) ? [h0, w0] : [w0, h0];
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
      const i = this._tile(x + 0.5, y + 0.5);
      if (lv + 1 <= MAX_LV && this.isSurface(lv + 1, i)) return 'Tire o piso de cima da escada primeiro';
      if (this.game.roofs?.at?.(x, y, lv + 1)) return 'Tire o telhado de cima da escada primeiro'; // J's built roofs
    }
    return null;
  }

  // ---------- collision ----------
  // tile free to stand on at level k; `cur` = the mover's current tile (stair steps open only from their entrance / landing)
  tileFree(k, tx, ty, pd, sw, cur) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = ty * w.W + tx;
    const A = this.st[k], sid = A ? A[i] : 0;
    if (sid) {
      const s = this.stairs[sid - 1];
      return s.n === k ? i === s.i0 && cur === s.ent : i === s.i1 && cur === s.land;
    }
    if (k === 0) return !tileBlocked(w, tx, ty, pd, sw);
    const S = this.surf[k];
    if (!S || !S[i]) return false; // air: walkable edges are bounded
    const Bk = this.blk[k];
    return !(Bk && Bk[i]);
  }

  collidesL(k, x, y, r, pd, sw, cur, ignore = null) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (this.tileFree(k, tx, ty, pd, sw, cur)) continue;
      const cx = x < tx ? tx : x > tx + 1 ? tx + 1 : x, cy = y < ty ? ty : y > ty + 1 ? ty + 1 : y;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
    // round props of this level only (trees, boulders, chests…)
    const w = this.game.world;
    let hit = false;
    w.forChunks(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (c) => {
      if (hit) return;
      for (const o of c.objects) {
        if (!o.solid || o.stump || o.fall || o === ignore || (o.lv | 0) !== k) continue;
        const rr = r + o.solid, dx = x - o.x, dy = y - (o.cy ?? o.y);
        if (dx * dx + dy * dy < rr * rr) { hit = true; return; }
      }
    });
    return hit;
  }

  // probe for steering (nav.steer local avoidance)
  blockedFor(e, x, y) {
    const k = e.lv | 0;
    if (this.stairAt(k, e.x, e.y)) return false; // the stair is a corridor: no probing
    return this.collidesL(k, x, y, e.r || 0.25, !!e.passDoors, !!e.canSwim && !k, this._tile(e.x, e.y));
  }

  // ---------- movement (physics.moveCircle / nav.moveMob hook) ----------
  move(e, dx, dy) {
    this.sync();
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
    const sx = dx / steps, sy = dy / steps;
    const pd = !!e.passDoors;
    let stuckOn = null;
    if (!(e.lv > 0) && !this.stairAt(0, e.x, e.y) && this.collidesL(0, e.x, e.y, e.r, pd, !!e.canSwim, this._tile(e.x, e.y))) stuckOn = this._overlapped(e);
    let moved = false;
    for (let n = 0; n < steps; n++) {
      const k = e.lv | 0;
      const s = this.stairAt(k, e.x, e.y);
      if (s) { if (this._stairStep(e, s, sx, sy, pd)) moved = true; continue; }
      const sw = !!e.canSwim && !k;
      if (!this.collidesL(k, e.x + sx, e.y, e.r, pd, sw, this._tile(e.x, e.y), stuckOn)) { e.x += sx; moved = true; }
      const s1 = this.stairAt(k, e.x, e.y);
      if (s1) { this._onStair(e, s1); continue; }
      if (!this.collidesL(k, e.x, e.y + sy, e.r, pd, sw, this._tile(e.x, e.y), stuckOn)) { e.y += sy; moved = true; }
      const s2 = this.stairAt(k, e.x, e.y);
      if (s2) this._onStair(e, s2);
    }
    return moved;
  }

  _overlapped(e) {
    let found = null;
    this.game.world.forChunks(e.x - e.r - 1, e.y - e.r - 1, e.x + e.r + 1, e.y + e.r + 1, (c) => {
      if (found) return;
      for (const o of c.objects) {
        if (!o.solid || o.stump || o.fall || (o.lv | 0)) continue;
        const rr = e.r + o.solid, dx = e.x - o.x, dy = e.y - (o.cy ?? o.y);
        if (dx * dx + dy * dy < rr * rr) { found = o; return; }
      }
    });
    return found;
  }

  _onStair(e, s) {
    const u = clamp01(this.uOf(s, e.x, e.y));
    e.z = s.n + u;
    e.lv = u < 0.5 ? s.n : s.n + 1;
    e._fallV = 0;
  }

  // one sub-step on a stair: along its axis, sideways eased into the corridor (side rails), leaving past the
  // bottom edge (level n, entrance free) or the top edge (level n + 1, landing free)
  _stairStep(e, s, sx, sy, pd) {
    const ax = s.ax, r = e.r || 0.25;
    let c = (ax ? e.y : e.x) + (ax ? sy : sx);
    const q0 = ax ? e.x : e.y, dq = ax ? sx : sy;
    const lo = s.l0 + r, hi = s.l1 - r;
    const qt = Math.min(hi, Math.max(lo, q0 + dq));
    const mq = Math.max(Math.abs(dq), 0.6 * Math.hypot(sx, sy) + 0.02);
    const q = q0 + Math.max(-mq, Math.min(mq, qt - q0));
    const u = (s.sg * (c - s.b)) / s.len;
    if (u < 0) {
      const nx = ax ? q : c, ny = ax ? c : q;
      if (!this.collidesL(s.n, nx, ny, r, pd, false, s.ent)) { e.x = nx; e.y = ny; e.lv = s.n; e.z = s.n; return true; }
      c = s.b + s.sg * EPS;
    } else if (u > 1) {
      const nx = ax ? q : c, ny = ax ? c : q;
      if (s.n + 1 <= MAX_LV && !this.collidesL(s.n + 1, nx, ny, r, pd, false, s.land)) { e.x = nx; e.y = ny; e.lv = s.n + 1; e.z = s.n + 1; return true; }
      c = s.b + s.sg * (s.len - EPS);
    }
    const nx = ax ? q : c, ny = ax ? c : q;
    const moved = Math.abs(nx - e.x) + Math.abs(ny - e.y) > 1e-6;
    e.x = nx; e.y = ny;
    this._onStair(e, s);
    return moved;
  }

  // footstep surface of an elevated entity (audio 'step' route): stairs, or the wall top it walks on
  surfaceOf(e) {
    if (this.stairAt(e.lv | 0, e.x, e.y)) return 'stairs';
    const o = this.game.build?.grid?.main?.get(this._tile(e.x, e.y));
    return o && o.type.includes('stone') ? 'stone' : 'wood';
  }

  // movement speed factor (stairs slower; water / mud only on the ground)
  speedAt(e) {
    if (!(e.lv > 0) && !(e.z > 0)) return this.game.world.speedAt(e.x, e.y);
    return this.stairAt(e.lv | 0, e.x, e.y) ? STAIR_SPEED : 1;
  }

  // ---------- falls (owner / authority, every frame) ----------
  settle(e, dt) {
    if (!(e.lv > 0) && !(e.z > 0) && !(e._fallV < 0)) return;
    this.sync();
    const k = e.lv | 0;
    const s = this.stairAt(k, e.x, e.y);
    if (s && !e._hop) { this._onStair(e, s); return; }
    const i = this._tile(e.x, e.y);
    if (k > 0 && !this.isSurface(k, i)) {
      // the surface under it vanished (deconstructed wall, removed stair): fall to the highest one below
      let to = 0;
      for (let j = k - 1; j > 0; j--) if (this.isSurface(j, i)) { to = j; break; }
      e.lv = to;
      e._fallV = e._fallV || 0;
      if (to === 0 && this.collidesL(0, e.x, e.y, e.r || 0.25, true, false, i)) this._unstick(e);
    }
    const lv = e.lv | 0;
    if (e.z > lv + EPS || e._fallV < 0) {
      e._fallV = (e._fallV || 0) + GRAV * dt;
      e.z = Math.max(lv, e.z - e._fallV * dt);
      if (e.z <= lv + EPS && e._fallV > 0) { e.z = lv; this._land(e); }
    } else if (e.z !== lv) e.z = lv;
  }

  _land(e) {
    const g = this.game, v = e._fallV || 0;
    e._fallV = 0;
    if (v < 3) return;
    g.juice?.puff?.(e.x, e.y - liftOf(e), 6, [0.72, 0.64, 0.52], 0.5);
    g.audio?.play('jump_land', { x: e.x, y: e.y, volume: Math.min(1, 0.4 + v * 0.06) });
  }

  // nearest free ground spot (spiral), for an entity whose floor vanished over a solid tile
  _unstick(e) {
    const x0 = e.x, y0 = e.y, r = e.r || 0.25;
    for (let n = 1; n < 60; n++) {
      const a = n * 2.4, d = 0.3 + n * 0.08, x = x0 + Math.cos(a) * d, y = y0 + Math.sin(a) * d;
      if (!this.collidesL(0, x, y, r, true, false, this._tile(x, y))) { e.x = x; e.y = y; return; }
    }
  }

  // ---------- jump down (local player only) ----------
  // pushing against the edge of a surface for ~0.9 s without moving: a hop to the free tile beyond, one level down
  hopUpdate(game, p, dt) {
    const h = p._hop;
    if (h) {
      h.t += dt;
      const k = Math.min(1, h.t / h.dur), e = k * (2 - k);
      p.x = h.x0 + (h.x1 - h.x0) * e; p.y = h.y0 + (h.y1 - h.y0) * e;
      p.moving = true;
      if (k >= 1) p._hop = null;
      return;
    }
    const lv = p.lv | 0;
    if (p.dead || !lv || p.rooted || this.stairAt(lv, p.x, p.y)) { p._push = 0; return; }
    const mv = game.input?.move ? game.input.move() : null;
    const mx = mv ? mv[0] : 0, my = mv ? mv[1] : 0, L = Math.hypot(mx, my);
    const movedD = p._lx == null ? 1 : Math.hypot(p.x - p._lx, p.y - p._ly);
    if (L < 0.5 || movedD > 0.02) { p._push = 0; return; }
    const ux = mx / L, uy = my / L, r = p.r || 0.24;
    if (this.isSurface(lv, this._tile(p.x + ux * (r + 0.12), p.y + uy * (r + 0.12)))) { p._push = 0; return; } // not an edge
    const lx = p.x + ux * (r + 0.62), ly = p.y + uy * (r + 0.62), li = this._tile(lx, ly);
    let to = -1;
    for (let j = lv - 1; j >= 0 && to < 0; j--) if (this.isSurface(j, li) && !this.collidesL(j, lx, ly, r, true, false, -1)) to = j;
    if (to < 0) { p._push = 0; return; }
    p._push = (p._push || 0) + dt;
    const hint = game.ctl?.hinted;
    if (p._push > 0.3 && hint && !hint.hop) { hint.hop = true; game.events.emit('toast', { text: 'Continue empurrando para pular', kind: 'info' }); }
    if (p._push < 0.9) return;
    p._push = 0;
    p._hop = { x0: p.x, y0: p.y, x1: lx, y1: ly, t: 0, dur: 0.42 };
    p.lv = to;
    p._fallV = -2.6; // a little up first, then gravity (settle)
    game.audio?.play('jump', { x: p.x, y: p.y, volume: 0.5 });
  }

  // back on a rampart / stair after a reload if it is still there (save.js), else on the ground
  restore(p, z) {
    this.sync();
    p.lv = 0; p.z = 0;
    if (!(z > 0)) return false;
    for (const k of [Math.floor(z), Math.ceil(z)]) {
      const s = this.stairAt(k, p.x, p.y);
      if (s) { this._onStair(p, s); return true; }
    }
    const k = Math.min(MAX_LV, Math.round(z));
    if (k > 0 && this.isSurface(k, this._tile(p.x, p.y))) { p.lv = k; p.z = k; return true; }
    return false;
  }

  // ---------- navigation: A* over (tile, level) nodes, stairs as portals ----------
  _nodeOf(k, i) { return k === 0 ? i : this.node[k] ? this.node[k][i] : -1; }
  // node for an entity / goal at level lv on tile i (stair tiles are nodes of their base level)
  nodeFor(lv, i) {
    const A = this.st[lv], sid = A ? A[i] : 0;
    if (sid) return this._nodeOf(this.stairs[sid - 1].n, i);
    for (let k = Math.min(MAX_LV, lv); k > 0; k--) { const n = this._nodeOf(k, i); if (n >= 0) return n; }
    return i;
  }
  _walk(k, x, y, doors) {
    const w = this.game.world;
    if (!w.inBounds(x, y)) return false;
    if (k === 0) return walkable(this.game, x, y, doors); // (walkable excludes stair steps)
    const i = y * w.W + x;
    return !!this.surf[k]?.[i] && !this.blk[k]?.[i] && !this.st[k]?.[i];
  }
  _neighbors(node, doors, goal) {
    const w = this.game.world, W = w.W, N = W * w.H, NB = this._nb, NC = this._nc;
    let k, i, n = 0;
    if (node < N) { k = 0; i = node; } else { k = this.nodeLv[node - N]; i = this.nodeTile[node - N]; }
    const sid = this.st[k] ? this.st[k][i] : 0;
    const s = sid ? this.stairs[sid - 1] : null;
    if (s && s.n === k) {
      // a step: only along the stair (entrance … landing)
      const p = s.tiles.indexOf(i);
      const prev = p === 0 ? (s.ent >= 0 && this._walkI(s.n, s.ent, doors) ? this._nodeOf(s.n, s.ent) : -1) : this._nodeOf(s.n, s.tiles[p - 1]);
      const next = p === s.len - 1 ? (s.land >= 0 && s.n + 1 <= MAX_LV && this._walkI(s.n + 1, s.land, doors) ? this._nodeOf(s.n + 1, s.land) : -1) : this._nodeOf(s.n, s.tiles[p + 1]);
      if (prev >= 0) { NB[n] = prev; NC[n++] = 1.15; }
      if (next >= 0) { NB[n] = next; NC[n++] = 1.15; }
      return n;
    }
    const x = i % W, y = (i / W) | 0;
    const SA = this.st[k];
    for (const [dx, dy, cost] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const ni = ny * W + nx;
      if (!this._walk(k, nx, ny, doors)) {
        // portals: the bottom step from the entrance, the top step from the landing (straight on only)
        const sid2 = SA ? SA[ni] : 0;
        if (sid2) {
          const s2 = this.stairs[sid2 - 1];
          if (dx && dy) continue;
          if (s2.n === k && ni === s2.i0 && i === s2.ent) { NB[n] = this._nodeOf(k, ni); NC[n++] = 1.15; }
          else if (s2.n + 1 === k && ni === s2.i1 && i === s2.land) { const q = this._nodeOf(s2.n, ni); if (q >= 0) { NB[n] = q; NC[n++] = 1.15; } }
        } else if (k === 0 && ni === goal && !w.blocked(nx, ny)) { NB[n] = ni; NC[n++] = cost; } // goal tile may hold the target's prop
        continue;
      }
      if (dx && dy && (!this._walk(k, x + dx, y, doors) || !this._walk(k, x, y + dy, doors))) continue; // no corner cutting
      const q = this._nodeOf(k, ni);
      if (q >= 0) { NB[n] = q; NC[n++] = cost; }
    }
    return n;
  }
  _walkI(k, i, doors) { const W = this.game.world.W; return this._walk(k, i % W, (i / W) | 0, doors); }
  _nodeXY(node) {
    const w = this.game.world, W = w.W, N = W * w.H;
    const i = node < N ? node : this.nodeTile[node - N];
    return [i % W, (i / W) | 0, node < N ? 0 : this.nodeLv[node - N]];
  }

  // { path: [[x, y, lv]…] tile centres (excluding the start), complete } | null — same contract as nav.findPath
  findPath(sx, sy, slv, gx, gy, glv, maxNodes = 1600, doors = false) {
    this.sync();
    if (this._nodesV !== this.v) this._buildNodes();
    const w = this.game.world, W = w.W, N = W * w.H;
    if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
    const T = N + this.M;
    if (!this._g || this._g.length < T) {
      this._g = new Float32Array(T); this._par = new Int32Array(T); this._seen = new Uint32Array(T); this._closed = new Uint32Array(T);
      this._stamp = 0;
    }
    const gA = this._g, par = this._par, seen = this._seen, closed = this._closed;
    const stamp = ++this._stamp;
    const s = this.nodeFor(slv | 0, sy * W + sx), goal = this.nodeFor(glv | 0, gy * W + gx);
    const h = (nd) => { const i = nd < N ? nd : this.nodeTile[nd - N]; const dx = Math.abs((i % W) - gx), dy = Math.abs(((i / W) | 0) - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    const H = this._heap || (this._heap = new Heap());
    H.clear();
    gA[s] = 0; par[s] = -1; seen[s] = stamp;
    H.push(s, h(s));
    let best = s, bestH = h(s), expanded = 0;
    while (H.size > 0 && expanded < maxNodes) {
      const cur = H.pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      expanded++;
      if (cur === goal) { best = cur; bestH = 0; break; }
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; best = cur; }
      const n = this._neighbors(cur, doors, goal);
      for (let j = 0; j < n; j++) {
        const ni = this._nb[j];
        if (closed[ni] === stamp) continue;
        const ng = gA[cur] + this._nc[j];
        if (seen[ni] === stamp && ng >= gA[ni]) continue;
        seen[ni] = stamp; gA[ni] = ng; par[ni] = cur;
        H.push(ni, ng + h(ni) * 1.05);
      }
    }
    if (best === s) return null;
    const path = [];
    for (let i = best; i !== s && i >= 0; i = par[i]) { const [x, y, lv] = this._nodeXY(i); path.push([x + 0.5, y + 0.5, lv]); }
    path.reverse();
    return { path, complete: best === goal };
  }
}

class Heap {
  constructor() { this.n = new Int32Array(1024); this.f = new Float32Array(1024); this.size = 0; }
  clear() { this.size = 0; }
  push(n, f) {
    if (this.size >= this.n.length) {
      const a = new Int32Array(this.n.length * 2); a.set(this.n); this.n = a;
      const b = new Float32Array(this.f.length * 2); b.set(this.f); this.f = b;
    }
    const N = this.n, F = this.f;
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; N[i] = N[p]; F[i] = F[p]; i = p; }
    N[i] = n; F[i] = f;
  }
  pop() {
    const N = this.n, F = this.f, top = N[0];
    const n = N[--this.size], f = F[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && F[c + 1] < F[c]) c++;
      if (F[c] >= f) break;
      N[i] = N[c]; F[i] = F[c]; i = c;
    }
    N[i] = n; F[i] = f;
    return top;
  }
}

// ---------- system ----------
// Every peer keeps the derived map fresh; the owner settles its own player (falls, jump down), the authority
// its creatures. Remote copies only display the replicated z. Also: depth keys for the sorted batch and the
// landing marker of a stairs ghost (cosmetic).
export function levelsSystem() {
  return {
    sync: 'all', // derived map everywhere; settle() runs on the owner (player) / the host (creatures)
    update(game, dt) {
      const L = game.levels;
      if (!L) return;
      L.sync();
      const p = game.player;
      L.hopUpdate(game, p, dt);
      L.settle(p, dt);
      if (game.net.auth && (L._active || L.surf[1])) {
        for (const e of game.entities) if (e.isMob && !e.proxy && !e.dead && (e.lv || e.z > 0)) L.settle(e, dt);
      }
      p._lx = p.x; p._ly = p.y; // (stair / wall-top footsteps: juice + audio 'step' with surfaceOf)
    },
    // depth keys: entities draw one tile deeper per story (after the wall they stand on)
    collect(game, list) {
      for (let i = 0; i < list.length; i++) { const o = list[i]; if (o.isEntity) o._sy = o.z > 0 ? o.y + o.z : o.y; }
    },
    render(game, B) {
      // stairs ghost: mark the landing tile (green when a surface is there to step onto)
      const m = game.build?.mode, A = game.A;
      if (!m || m.kind !== 'place' || BUILDINGS[m.type]?.block !== 'stairs' || !A.has('fx_ring')) return;
      const L = game.levels, ring = A.get('fx_ring'), pulse = 0.7 + 0.3 * Math.sin(game.time * 5);
      const [w0, h0] = BUILDINGS[m.type].size;
      for (const g of m.tiles || []) {
        const r = m.rot & 3, fw = r & 1 ? h0 : w0, fh = r & 1 ? w0 : h0;
        const lx = r === 0 ? g.tx : r === 2 ? g.tx : r === 1 ? g.tx + fw : g.tx - 1;
        const ly = r === 0 ? g.ty - 1 : r === 2 ? g.ty + fh : g.ty;
        const ok = L.isSurface(1, L._tile(lx + 0.5, ly + 0.5));
        B.fx.add(ring, lx + 0.5, ly + 0.6 - STORY_H, 0.8, 0.5, ok ? 0.5 : 1, ok ? 1 : 0.85, ok ? 0.55 : 0.45, 0.75 * pulse);
      }
    },
  };
}
