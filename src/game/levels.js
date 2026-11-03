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

import { Layer, NodeTable } from '../world/store.js'; // sparse per-level grids, A* scratch (docs/STREAMING.md)
import { groundZ } from '../world/height.js'; // terrain height
import { BUILDINGS } from './data.js';
import { tileBlocked, railHit, railCross, underAt, underFor, deckTrack } from './physics.js';
import { walkable } from './nav.js';
import { WALL_H } from '../art/structures.js';
import { underOpaqueRoof, underCaveCeiling } from './roofs.js';
import { ROOF_GEOM } from './content/roofs.js';
import { wallBehind as wallBehindL } from './autotile.js';
import { drawStatic } from '../art/composeWorld.js';
import { drawStairFaces, stairZk, layFlat } from '../art/faces/levels.js'; // camera rotation (docs/CAMERA-ROTATION.md)
import { drawProxy } from './artcompat.js';
import { lootRow } from './mut/roll.js';

export const MAX_LV = 3;
export const STORY_H = WALL_H;   // screen height of one story (tiles): a wall top is the next story's floor
export const STAIR_SPEED = 0.8;
const GRAV = 26;                 // stories / s² (falls and hops)
const EPS = 1e-3;

// drawing lift (tiles) of an entity standing at height z
export const liftOf = (e) => (e && e.z > 0 ? e.z * STORY_H : 0);
// same story (melee, contact): heights closer than half a story
export const sameLevel = (a, b) => Math.abs((a?.z || 0) - (b?.z || 0)) < 0.5 && Math.abs(gz(a) - gz(b)) < 1.2; // (terrain: not across a cliff)
// ranged height advantage (owner): +20 % range per story above the target (b = null: the ground), up to +100 %
export const HEIGHT_PER_STORY = 0.2, HEIGHT_MAX = 1;
// (terrain height, docs/TERRAIN-HEIGHT.md: the ground under each counts too — a hill or a cliff top is height advantage)
export const heightK = (a, b) => 1 + Math.min(HEIGHT_MAX, HEIGHT_PER_STORY * Math.max(0, (a?.z || 0) + (b ? gz(a) - gz(b) : 0) - (b?.z || 0)));
const gz = (e) => (e ? groundZ(e.x, e.y) : 0);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
const isWallTop = (def) => def.connect === 'wall' && (def.block === 'tile' || def.block === 'door');
const SUPPORT = ROOF_GEOM.support;    // same rule as J's roofs: a support of the story below within 6 tiles
const NEED_SUPPORT = 'Precisa de apoio: paredes ou colunas no andar de baixo a até 6 tiles';
const NOT_UP = new Set(['farm_plot', 'campfire']); // (things that only make sense on the ground)
const LAYER_DY = { floor: 0.0006, rug: 0.0003 };      // upper pieces share the sorted batch: the slab first, then rugs, then the rest

export function installLevels(game) {
  const L = new Levels(game);
  game.levels = L;
  game.world.levels = L; // physics / LOS only get the world
  // J's roofs ask how many stories a building has (eaves on top of the highest one)
  game.build.storeysAt = (x, y) => L.sync().storeysAt(x, y);
  game.build.storeysIn = (tiles) => L.sync().storeysIn(tiles);
  return L;
}

export class Levels {
  constructor(game) {
    this.game = game;
    this.v = -1;
    this._active = false;
    this.surf = [];      // [k] sparse store Layer (u8) | undefined: standable surface at level k (k ≥ 1)
    this.blk = [];       // [k] Uint8Array | undefined: blocked at level k [P2: upper walls, railings, furniture]
    this.st = [];        // [k] Int32Array: stair index + 1 (steps at level n, the open stairwell at level n + 1)
    this.stairs = [];
    this.node = [];      // [k] Int32Array tile -> A* node id (k ≥ 1)
    this.M = 0;          // upper nodes
    this.nodeTile = new Int32Array(64);
    this.nodeLv = new Uint8Array(64);
    this._nb = new Int32Array(16); this._nc = new Float32Array(16); this._nl = new Uint8Array(16); // (_nl: the neighbour is under a bridge deck)
    this.STORY = STORY_H;
    this.hasUpper = false;
    this.hasTops = false;
  }

  // any stairs in the world (level traversal possible)? Rebuilds the map when the structures changed.
  get active() { this.sync(); return this._active; }
  sync() { const b = this.game.build; if (b && b.v !== this.v) this.rebuild(); return this; }

  // per-level grids over the planet: sparse store layers (pages only where something is built)
  _arr(list, k, Ctor, n, def = 0) {
    return list[k] || (list[k] = new Layer('lv' + k, Ctor, def, { sparse: true }));
  }

  rebuild() {
    const g = this.game, w = g.world, W = w.W, N = W * w.H;
    this.v = g.build.v;
    for (const a of this.surf) a?.clear();
    for (const a of this.blk) a?.clear();
    for (const a of this.st) a?.clear();
    this.stairs.length = 0;
    let upper = 0, sig = 0, tops = 0;
    const mark = (list, k, o) => {
      const A = this._arr(list, k, Uint8Array, N);
      for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) if (w.inBounds(x, y)) A.set(w.idx(x, y), 1);
    };
    for (const o of g.build.structures) {
      if (o.moveOf || o.removed) continue;
      const def = BUILDINGS[o.type];
      if (!def) continue;
      const lv = o.lv | 0;
      if (lv) { upper++; sig = (sig * 31 + (o.tx * 7 + o.ty * 131 + lv * 17 + (o.blueprint ? 1 : 2))) | 0; o._sy = Math.max(o.y, o.ty + (o.fh || 1)) + 0.001 * lv - (LAYER_DY[def.layer] || 0); } // depth: just after the story below (slab, rug, then what stands on it); a piece anchored above its tile's south edge (edge props: chest, table…) still sorts after the slab of its own tile (it vanished under it)
      if (o.blueprint) continue;
      if (def.block === 'stairs') { this._addStair(o, lv); continue; }
      if (isWallTop(def) && lv < MAX_LV) { mark(this.surf, lv + 1, o); tops++; } // wall / door tops: the next story's floor
      if (lv && def.layer === 'floor' && !def.roof) mark(this.surf, lv, o);       // upper floor slab
      if (lv && (def.block === 'tile' || (def.block === 'door' && !o.open))) mark(this.blk, lv, o); // upper walls, closed doors, railings, furniture
    }
    this._active = this.stairs.length > 0;
    this.hasUpper = upper > 0;
    this.hasTops = tops > 0; // (the build mode's story selector shows up)
    this._nodesV = -1; // A* nodes are built on the first path request
    // roofs: their eaves sit on the highest story — repaint J's regions when the upper stories change
    if (sig !== this._upSig) {
      this._upSig = sig;
      const R = g.roofs;
      if (R?.artDirty) for (const o of g.build.structures) if (o.lv && !o.removed) for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) if (w.inBounds(x, y) && w.broof?.get(w.idx(x, y))) R.artDirty.add(w.idx(x, y));
      if (R?.artDirty && this._upTiles) for (const i of this._upTiles) R.artDirty.add(i);
      this._upTiles = g.build.structures.filter((o) => o.lv && !o.removed).map((o) => w.idx(o.tx, o.ty));
    }
  }

  // ---------- stories (upper floors, walls, furniture) ----------
  // number of stories at a tile (J's roofs put their eaves on top): 1 + the highest story holding a wall / floor there
  storeysAt(x, y) {
    const g = this.game, w = g.world;
    if (!this.hasUpper || !w.inBounds(x, y)) return 1;
    const i = w.idx(x, y), N = w.W * w.H, G = g.build.grid;
    let s = 1;
    for (let k = 1; k <= MAX_LV; k++) {
      const a = G.main.get(i + k * N), f = G.floor.get(i + k * N);
      if ((a && isWallTop(BUILDINGS[a.type]) && !a.blueprint) || (f && !f.blueprint)) s = k + 1;
    }
    return s;
  }
  storeysIn(tiles) { let s = 1; if (this.hasUpper) for (const i of tiles) { const W = this.game.world.W; s = Math.max(s, this.storeysAt(i % W, (i / W) | 0)); } return s; }

  // a support of story lv-1 (wall / door / column, planned too when `planned`) within SUPPORT tiles: upper floors stand on it
  supportedL(tx, ty, lv, planned = false) {
    const g = this.game, w = g.world, N = w.W * w.H, G = g.build.grid.main, R = SUPPORT, R2 = R * R, base = (lv - 1) * N;
    for (let dy = -R; dy <= R; dy++) {
      const y = ty + dy;
      if (y < w.minY || y > w.maxY) continue;
      const r = Math.floor(Math.sqrt(R2 - dy * dy));
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx;
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (lv === 1 && w.rock.get(i)) return true;
        const o = G.get(i + base);
        if (o && !o.moveOf && !this._gone?.has(o) && (BUILDINGS[o.type].support || isWallTop(BUILDINGS[o.type])) && (planned || !o.blueprint)) return true;
      }
    }
    return false;
  }
  // something to stand a piece on at story lv: a floor slab of lv or the top of a wall of lv-1 (planned too when `planned`)
  surfaceUnder(tx, ty, lv, planned = false) {
    const g = this.game, w = g.world, N = w.W * w.H, i = w.idx(tx, ty), G = g.build.grid;
    const f = G.floor.get(i + lv * N);
    if (f && !f.moveOf && !this._gone?.has(f) && (planned || !f.blueprint)) return true;
    const a = G.main.get(i + (lv - 1) * N);
    return !!(a && !a.moveOf && !this._gone?.has(a) && isWallTop(BUILDINGS[a.type]) && (planned || !a.blueprint));
  }
  // placement rule for a piece on story lv ≥ 1 (mut/structures.placeReason hook). Same contract as placeReason.
  upperReason(type, tx, ty, who, rot, ignore, lv) {
    this.sync();
    const g = this.game, w = g.world, def = BUILDINGS[type], N = w.W * w.H;
    if (lv > MAX_LV) return 'Alto demais';
    if (NOT_UP.has(type) || def.raze) return 'Isto só pode ficar no chão';
    const [w0, h0] = def.size || [1, 1];
    const [sw, sh] = def.rotate && (rot & 1) ? [h0, w0] : [w0, h0];
    const G2 = g.build.grid[def.layer];
    let replace = null;
    for (let y = ty; y < ty + sh; y++) for (let x = tx; x < tx + sw; x++) {
      if (!w.inside(x, y, 1)) return 'Fora do mapa';
      const i = w.idx(x, y);
      const cur = G2.get(i + lv * N);
      if (cur && !(ignore && cur === ignore)) {
        if (!ignore && def.block === 'door' && sw === 1 && sh === 1 && BUILDINGS[cur.type].connect === def.connect && BUILDINGS[cur.type].block === 'tile') { replace = cur; continue; }
        return 'exists';
      }
      if (this.stairwell(x, y, lv)) return 'Vão da escada: deixe aberto';
      if (def.layer === 'floor') { if (!this.supportedL(x, y, lv, true)) return NEED_SUPPORT; if (lv === 1 && this._tallBelow(x, y)) return 'Árvore ou pedra embaixo: tire antes'; }
      else if (!this.surfaceUnder(x, y, lv, true)) return 'Precisa de piso embaixo (ou o topo de uma parede)';
    }
    if (def.block === 'stairs') { const r = this.stairsReason(type, tx, ty, rot, lv); if (r) return r; }
    if (def.mount === 'wall' && !(rot >= 1 && rot <= 4 && wallBehindL(g, tx, ty, rot, lv))) return 'Encoste numa parede pronta';
    if (who && Math.hypot(tx + sw / 2 - who.x, ty + sh / 2 - who.y) > 22) return 'Muito longe';
    return replace ? { replace } : null;
  }
  // a tree / boulder on the ground tile (it would poke through a story-1 slab)
  _tallBelow(tx, ty) {
    let hit = false;
    this.game.world.forChunks(tx - 1, ty - 1, tx + 2, ty + 2, (c) => {
      if (hit) return;
      for (const o of c.objects) if (!o.building && !o.gone && !o.stump && (o.type.startsWith('tree_') || o.type === 'boulder') && Math.floor(o.x) === tx && Math.floor(o.y - 0.05) === ty) { hit = true; return; }
    });
    return hit;
  }
  // upper piece drawn under a screen point (lifted by its story; faded ones are skipped), highest story first —
  // building.structureAtPoint / controller.pick ask it before the ground
  pickUpper(wx, wy, layers = ['main', 'rug', 'floor']) {
    if (!this.hasUpper) return null;
    const g = this.game, w = g.world, N = w.W * w.H, G = g.build.grid, r = g.cam?.rot || 0, rs = r ? Math.sin(r) : 0, rc = r ? Math.cos(r) : 1;
    for (let k = MAX_LV; k >= 1; k--) {
      const tx = Math.floor(wx - rs * k * STORY_H), ty = Math.floor(wy + rc * k * STORY_H); // (camera turned: the lift is up the screen)
      if (!w.inBounds(tx, ty)) continue;
      for (const L of layers) {
        const o = G[L].get(w.idx(tx, ty) + k * N);
        if (o && (o.alpha ?? 1) > 0.5) return o;
      }
    }
    return null;
  }
  // build.hit start hook: what an upper blueprint needs FINISHED before the work starts (null = ok)
  buildStartReason(o) {
    const def = BUILDINGS[o.type], lv = o.lv | 0;
    for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) {
      if (def.layer === 'floor') { if (!this.supportedL(x, y, lv)) return 'Sem apoio: termine as paredes do andar de baixo primeiro'; }
      else if (!this.surfaceUnder(x, y, lv)) return 'Construa o piso embaixo primeiro';
    }
    return null;
  }
  // host: finished upper pieces that lost what holds them up (support for floors, a surface for the rest)
  unsupported() {
    const out = [];
    for (const o of this.game.build.structures) {
      if (!o.lv || o.blueprint || o.moveOf || o.removed) continue;
      const def = BUILDINGS[o.type];
      let bad = false;
      for (let y = o.ty; y < o.ty + (o.fh || 1) && !bad; y++) for (let x = o.tx; x < o.tx + (o.fw || 1) && !bad; x++) {
        bad = def.layer === 'floor' ? !this.supportedL(x, y, o.lv) : !this.surfaceUnder(x, y, o.lv);
      }
      if (bad) out.push(o);
    }
    return out;
  }

  // upper pieces that would fall if `gone` (a Set of structures) were removed (building.confirmSupports asks first)
  lostWithout(gone) {
    this.sync();
    if (!this.hasUpper) return [];
    this._gone = gone;
    try { return this.unsupported().filter((o) => !gone.has(o)); } finally { this._gone = null; }
  }

  _addStair(o, n) {
    const w = this.game.world, W = w.W, N = W * w.H;
    const fw = o.fw || 1, fh = o.fh || 1, tx = o.tx, ty = o.ty, r = o.rot & 3;
    const id = (x, y) => (w.inBounds(x, y) ? w.idx(x, y) : -1);
    let ax, sg, b, len, l0, l1, ent, land;
    const tiles = [];
    if (r === 0) { ax = 1; sg = -1; b = ty + fh; len = fh; l0 = tx; l1 = tx + fw; ent = id(tx, ty + fh); land = id(tx, ty - 1); for (let k = 0; k < len; k++) tiles.push(id(tx, ty + fh - 1 - k)); }
    else if (r === 2) { ax = 1; sg = 1; b = ty; len = fh; l0 = tx; l1 = tx + fw; ent = id(tx, ty - 1); land = id(tx, ty + fh); for (let k = 0; k < len; k++) tiles.push(id(tx, ty + k)); }
    else if (r === 1) { ax = 0; sg = 1; b = tx; len = fw; l0 = ty; l1 = ty + fh; ent = id(tx - 1, ty); land = id(tx + fw, ty); for (let k = 0; k < len; k++) tiles.push(id(tx + k, ty)); }
    else { ax = 0; sg = -1; b = tx + fw; len = fw; l0 = ty; l1 = ty + fh; ent = id(tx + fw, ty); land = id(tx - 1, ty); for (let k = 0; k < len; k++) tiles.push(id(tx + fw - 1 - k, ty)); }
    if (tiles.some((i) => i < 0)) return;
    // the tiles beside the bottom / top step: a stair is also entered and left sideways at its ends
    const sides = (i) => { const x = i % W, y = (i - x) / W; return (ax ? [id(x - 1, y), id(x + fw, y)] : [id(x, y - 1), id(x, y + fh)]).filter((j) => j >= 0); };
    const s = { o, n, ax, sg, b, len, l0, l1, ent, land, tiles, i0: tiles[0], i1: tiles[len - 1], side0: sides(tiles[0]), side1: sides(tiles[len - 1]), idx: this.stairs.length };
    this.stairs.push(s);
    for (const k of [n, n + 1]) {
      if (k > MAX_LV) continue;
      const A = this._arr(this.st, k, Int32Array, N);
      for (const i of tiles) A.set(i, s.idx + 1);
    }
    o._sy = n ? ty + fh + 0.002 : ty + 0.2; // depth key: before anything standing on it, after the slab under it (docs/LEVELS.md §8)
  }

  _buildNodes() {
    const w = this.game.world, N = w.W * w.H;
    this._nodesV = this.v;
    this.M = 0;
    for (let k = 1; k <= MAX_LV; k++) {
      const S = this.surf[k];
      if (!S) { if (this.node[k]) this.node[k].clear(); continue; }
      const A = this._arr(this.node, k, Int32Array, N, -1);
      A.clear();
      S.forEach((i) => {
        if (this.M >= this.nodeTile.length) {
          const a = new Int32Array(this.nodeTile.length * 2); a.set(this.nodeTile); this.nodeTile = a;
          const b = new Uint8Array(this.nodeLv.length * 2); b.set(this.nodeLv); this.nodeLv = b;
        }
        A.set(i, N + this.M);
        this.nodeTile[this.M] = i; this.nodeLv[this.M] = k;
        this.M++;
      });
    }
  }

  // ---------- queries ----------
  _tile(x, y) { const w = this.game.world, tx = Math.floor(x), ty = Math.floor(y); return w.inBounds(tx, ty) ? w.idx(tx, ty) : -1; }
  isSurface(k, i) { return k === 0 || (i >= 0 && !!this.surf[k]?.get(i)); }
  // stair whose footprint holds (x, y) for an entity walking at level lv (steps at n = lv, or entered from n + 1 = lv)
  stairAt(lv, x, y) {
    const A = this.st[lv];
    if (!A) return null;
    const i = this._tile(x, y);
    const id = i >= 0 ? A.get(i) : 0;
    return id ? this.stairs[id - 1] : null;
  }
  onStair(e) { return !!this.stairAt(e.lv | 0, e.x, e.y); }
  uOf(s, x, y) { return (s.sg * ((s.ax ? y : x) - s.b)) / s.len; }
  // is a level-(n+1) cover (roof / upper floor) forbidden at (tx, ty) because a stair comes up there?
  stairwell(tx, ty, lv = 1) {
    this.sync();
    const A = this.st[lv], w = this.game.world;
    if (!A || !w.inBounds(tx, ty)) return false;
    const id = A.get(w.idx(tx, ty));
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
      if (this.game.build.grid.roof?.get(i) && this.storeysAt(x, y) <= lv + 1) return 'Tire o telhado de cima da escada primeiro'; // J's roof right over it
    }
    return null;
  }

  // ---------- collision ----------
  // tile free to stand on at level k; `cur` = the mover's current tile (stair steps open only from their entrance / landing)
  tileFree(k, tx, ty, pd, sw, cur, od = true) {
    const w = this.game.world;
    if (!w.inBounds(tx, ty)) return false;
    const i = w.idx(tx, ty);
    const A = this.st[k], sid = A ? A.get(i) : 0;
    if (sid) {
      const s = this.stairs[sid - 1];
      return s.n === k ? i === s.i0 && (cur === s.ent || cur === i || s.side0.includes(cur)) : i === s.i1 && (cur === s.land || cur === i || s.side1.includes(cur));
    }
    if (k === 0) return !tileBlocked(w, tx, ty, pd, sw, od); // (od: on a deck — physics.js; under / beside it deep water blocks)
    const S = this.surf[k];
    if (!S || !S.get(i)) return false; // air: walkable edges are bounded
    const Bk = this.blk[k];
    return !(Bk && Bk.get(i));
  }

  // ud: (level 0) the body would be under a bridge deck at (x, y) (physics.underFor)
  collidesL(k, x, y, r, pd, sw, cur, ignore = null, ud = false) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    const wd = this.game.world.deck, od = !ud && !!wd && !!wd.get(this._tile(x, y));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (this.tileFree(k, tx, ty, pd, sw, cur, od)) continue;
      const cx = x < tx ? tx : x > tx + 1 ? tx + 1 : x, cy = y < ty ? ty : y > ty + 1 ? ty + 1 : y;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
    // round props of this level only (trees, boulders, chests…)
    const w = this.game.world;
    if (k === 0 && w.rail && railHit(w, x, y, r, ud)) return true; // bridge railings / the walls under a deck (game/decks.js)
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

  // how deep a body of radius r at (x, y) sits inside blocked tiles / round props of level k (0 = free). A body that
  // is already inside something (a stair corner it slid into, a wall built over it…) may always move to where it
  // sits less deep or as deep (move): it slides out instead of being frozen in place.
  penL(k, x, y, r, pd, sw, cur) {
    let p = 0;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (this.tileFree(k, tx, ty, pd, sw, cur)) continue;
      const cx = x < tx ? tx : x > tx + 1 ? tx + 1 : x, cy = y < ty ? ty : y > ty + 1 ? ty + 1 : y;
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) p = Math.max(p, r - d + (x > tx && x < tx + 1 && y > ty && y < ty + 1 ? 1 : 0)); // (centre inside: deepest)
    }
    this.game.world.forChunks(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (c) => {
      for (const o of c.objects) {
        if (!o.solid || o.stump || o.fall || (o.lv | 0) !== k) continue;
        const rr = r + o.solid, d = Math.hypot(x - o.x, y - (o.cy ?? o.y));
        if (d < rr) p = Math.max(p, rr - d);
      }
    });
    return p;
  }
  // may a body stuck at (e.x, e.y) step to (x, y)? (only when it is inside something now, and not deeper after)
  _eases(k, e, x, y, pd, sw, cur) {
    const p0 = this.penL(k, e.x, e.y, e.r, pd, sw, cur);
    return p0 > 1e-4 && this.penL(k, x, y, e.r, pd, sw, cur) <= p0 + 1e-6;
  }

  // probe for steering (nav.steer local avoidance)
  blockedFor(e, x, y) {
    const k = e.lv | 0;
    if (this.stairAt(k, e.x, e.y)) return false; // the stair is a corridor: no probing
    return this.collidesL(k, x, y, e.r || 0.25, !!e.passDoors, !!e.canSwim && !k, this._tile(e.x, e.y), null, !k && !!this.game.world.rail && underFor(this.game.world, e, x, y));
  }

  // ---------- movement (physics.moveCircle / nav.moveMob hook) ----------
  move(e, dx, dy) {
    this.sync();
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
    const sx = dx / steps, sy = dy / steps;
    const pd = !!e.passDoors;
    let stuckOn = null;
    const w = this.game.world, dk = !!w.rail; // (bridges: on a deck or under it — physics.js)
    if (!(e.lv > 0) && !this.stairAt(0, e.x, e.y) && this.collidesL(0, e.x, e.y, e.r, pd, !!e.canSwim, this._tile(e.x, e.y), null, dk && deckTrack(w, e))) stuckOn = this._overlapped(e);
    let moved = false;
    for (let n = 0; n < steps; n++) {
      const k = e.lv | 0;
      const s = this.stairAt(k, e.x, e.y);
      if (s) { if (this._stairStep(e, s, sx, sy, pd)) moved = true; continue; }
      const sw = !!e.canSwim && !k;
      let cur = this._tile(e.x, e.y);
      if (sx && (!this.collidesL(k, e.x + sx, e.y, e.r, pd, sw, cur, stuckOn, !k && dk && underFor(w, e, e.x + sx, e.y)) || this._eases(k, e, e.x + sx, e.y, pd, sw, cur))) { e.x += sx; moved = true; }
      const s1 = this.stairAt(k, e.x, e.y);
      if (s1) { this._onStair(e, s1); continue; }
      cur = this._tile(e.x, e.y);
      if (sy && (!this.collidesL(k, e.x, e.y + sy, e.r, pd, sw, cur, stuckOn, !k && dk && underFor(w, e, e.x, e.y + sy)) || this._eases(k, e, e.x, e.y + sy, pd, sw, cur))) { e.y += sy; moved = true; }
      const s2 = this.stairAt(k, e.x, e.y);
      if (s2) this._onStair(e, s2);
    }
    if (dk) deckTrack(w, e);
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
    // pushing past a side rail at the bottom end (to the ground beside it) or at the top end (onto the wall top /
    // upper floor beside it): step off sideways when that side is free
    const qw = q0 + dq;
    if ((qw < lo || qw > hi) && Math.abs(dq) > 1e-5 && u >= 0 && u <= 1 && (u < 0.32 || u > 0.68)) {
      const top = u > 0.68, lvl = top ? s.n + 1 : s.n;
      // (kept inside that step along the stair, so the edge of the body never touches the tile past its end)
      const st = top ? s.i1 : s.i0, W = this.game.world.W, t0 = ax ? (st / W) | 0 : st % W;
      const ca = Math.max(t0 + r + 0.01, Math.min(t0 + 1 - r - 0.01, c));
      const nx = ax ? qw : ca, ny = ax ? ca : qw;
      if (lvl <= MAX_LV && !this.collidesL(lvl, nx, ny, r, pd, false, top ? s.i1 : s.i0)) {
        e.x = nx; e.y = ny; e.lv = lvl; e.z = lvl; e._fallV = 0;
        return true;
      }
    }
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
    if (!(e.lv > 0) && !(e.z > 0)) return this.game.world.speedAt(e.x, e.y, e._ud);
    return this.stairAt(e.lv | 0, e.x, e.y) ? STAIR_SPEED : 1;
  }

  // ---------- falls (owner / authority, every frame) ----------
  settle(e, dt) {
    if (!(e.lv > 0) && !(e.z > 0) && !(e._fallV < 0)) return;
    this.sync();
    if (e.dead && (e.lv > 0 || this.stairAt(e.lv | 0, e.x, e.y))) { // died up high: the body falls to the ground below
      const [gx, gy] = this.groundSpot(e.x, e.y);
      e.x = gx; e.y = gy; e.lv = 0; e._hop = null;
    }
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

  // nearest free ground point (level 0, not a stair step) to (x, y) — where a body that died up high lies
  // (mut/corpses.js on the authority, settle() for the dying entity: same function, same spot)
  groundSpot(x, y, r = 0.1) {
    this.sync();
    if (!this.collidesL(0, x, y, r, true, false, -1)) return [x, y];
    for (let n = 1; n < 90; n++) {
      const a = n * 2.4, d = 0.25 + n * 0.06, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!this.collidesL(0, px, py, r, true, false, -1)) return [px, py];
    }
    return [x, y];
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
  _nodeOf(k, i) { return k === 0 ? i : this.node[k] ? this.node[k].get(i) : -1; }
  // node for an entity / goal at level lv on tile i (stair tiles are nodes of their base level)
  nodeFor(lv, i) {
    const A = this.st[lv], sid = A ? A.get(i) : 0;
    if (sid) return this._nodeOf(this.stairs[sid - 1].n, i);
    for (let k = Math.min(MAX_LV, lv); k > 0; k--) { const n = this._nodeOf(k, i); if (n >= 0) return n; }
    return i;
  }
  _walk(k, x, y, doors) {
    const w = this.game.world;
    if (!w.inBounds(x, y)) return false;
    if (k === 0) return walkable(this.game, x, y, doors); // (walkable excludes stair steps)
    const i = w.idx(x, y);
    return !!this.surf[k]?.get(i) && !this.blk[k]?.get(i) && !this.st[k]?.get(i);
  }
  _neighbors(node, doors, goal) {
    const w = this.game.world, W = w.W, N = W * w.H, NB = this._nb, NC = this._nc;
    let k, i, n = 0;
    if (node < N) { k = 0; i = node; } else { k = this.nodeLv[node - N]; i = this.nodeTile[node - N]; }
    const sid = this.st[k] ? this.st[k].get(i) : 0;
    const s = sid ? this.stairs[sid - 1] : null;
    if (s && s.n === k) {
      // a step: only along the stair (entrance … landing)
      const p = s.tiles.indexOf(i);
      const prev = p === 0 ? (s.ent >= 0 && this._walkI(s.n, s.ent, doors) ? this._nodeOf(s.n, s.ent) : -1) : this._nodeOf(s.n, s.tiles[p - 1]);
      const next = p === s.len - 1 ? (s.land >= 0 && s.n + 1 <= MAX_LV && this._walkI(s.n + 1, s.land, doors) ? this._nodeOf(s.n + 1, s.land) : -1) : this._nodeOf(s.n, s.tiles[p + 1]);
      if (prev >= 0) { this._nl[n] = 0; NB[n] = prev; NC[n++] = 1.15; }
      if (next >= 0) { this._nl[n] = 0; NB[n] = next; NC[n++] = 1.15; }
      return n;
    }
    const x = i % W, y = (i / W) | 0;
    const SA = this.st[k];
    const NL = this._nl, dk = k === 0 && !!w.rail, u = dk && this._curLay === 1; // (bridges: the level of this tile)
    for (const [dx, dy, cost] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const ni = w.idx(nx, ny);
      if (!this._walk(k, nx, ny, doors)) {
        // portals: the bottom step from the entrance, the top step from the landing (straight on only)
        const sid2 = SA ? SA.get(ni) : 0;
        if (sid2) {
          const s2 = this.stairs[sid2 - 1];
          if (dx && dy) continue;
          if (s2.n === k && ni === s2.i0 && i === s2.ent) { NL[n] = 0; NB[n] = this._nodeOf(k, ni); NC[n++] = 1.15; }
          else if (s2.n + 1 === k && ni === s2.i1 && i === s2.land) { const q = this._nodeOf(s2.n, ni); if (q >= 0) { NL[n] = 0; NB[n] = q; NC[n++] = 1.15; } }
        } else if (k === 0 && ni === goal && !w.blocked(nx, ny)) { NL[n] = 0; NB[n] = ni; NC[n++] = cost; } // goal tile may hold the target's prop
        continue;
      }
      if (dx && dy && (!this._walk(k, x + dx, y, doors) || !this._walk(k, x, y + dy, doors))) continue; // no corner cutting
      let nu = 0;
      if (dk) { // bridges (game/decks.js, nav.js): the walls of the level the step is taken at, the water under a deck
        if (railCross(w, x, y, dx, dy, !u && w.deck && w.deck.get(i) ? w.rail : w.railU)) continue;
        nu = underAt(w, i, ni, u) ? 1 : 0;
        if (w.water.get(ni) === 2 && !w.iceAt(ni) && (nu || (!u && !(w.deck && w.deck.get(i)) && w.deck && w.deck.get(ni)))) continue;
      }
      const q = this._nodeOf(k, ni);
      if (q >= 0) { NL[n] = nu; NB[n] = q; NC[n++] = nu ? cost * 2.5 : cost; } // (under a deck: slow water)
    }
    return n;
  }
  _walkI(k, i, doors) { const W = this.game.world.W; return this._walk(k, i % W, (i / W) | 0, doors); }
  _nodeXY(node) {
    const w = this.game.world, W = w.W, N = W * w.H;
    const i = node < N ? node : this.nodeTile[node - N];
    return [i % W, (i / W) | 0, node < N ? 0 : this.nodeLv[node - N]];
  }

  // { path: [[x, y, lv]…] tile centres (excluding the start), complete } | null — same contract as nav.findPath (ud: the
  // start is under a bridge deck)
  findPath(sx, sy, slv, gx, gy, glv, maxNodes = 1600, doors = false, ud = false) {
    this.sync();
    if (this._nodesV !== this.v) this._buildNodes();
    const w = this.game.world, W = w.W, N = W * w.H;
    if (!w.inBounds(sx, sy) || !w.inBounds(gx, gy)) return null;
    const T = this._nt || (this._nt = new NodeTable(15)); // (scratch over node ids: tiles of the planet + upper nodes)
    T.reset();
    const s = this.nodeFor(slv | 0, w.idx(sx, sy)), goal = this.nodeFor(glv | 0, w.idx(gx, gy));
    const h = (nd) => { const i = nd < N ? nd : this.nodeTile[nd - N]; const dx = Math.abs(w.dx(i % W, gx)), dy = Math.abs(((i / W) | 0) - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    const H = this._heap || (this._heap = new Heap());
    H.clear();
    const s0 = T.slot(s);
    T.g[s0] = 0; T.par[s0] = -1; T.lay[s0] = ud ? 1 : 0;
    H.push(s, h(s));
    let best = s, bestH = h(s), expanded = 0;
    while (H.size > 0 && expanded < maxNodes) {
      const cur = H.pop(), cs = T.find(cur);
      if (cs < 0 || T.flag[cs] === 1) continue;
      T.flag[cs] = 1;
      expanded++;
      if (cur === goal) { best = cur; bestH = 0; break; }
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; best = cur; }
      this._curLay = T.lay[cs];
      const n = this._neighbors(cur, doors, goal);
      const gc = T.g[cs];
      for (let j = 0; j < n; j++) {
        const ni = this._nb[j];
        let ns = T.find(ni);
        if (ns >= 0 && T.flag[ns] === 1) continue;
        const ng = gc + this._nc[j];
        if (ns >= 0 && ng >= T.g[ns]) continue;
        if (ns < 0 && (ns = T.slot(ni)) < 0) continue;
        T.g[ns] = ng; T.par[ns] = cur; T.lay[ns] = this._nl[j];
        H.push(ni, ng + h(ni) * 1.05);
      }
    }
    if (best === s) return null;
    const path = [];
    for (let i = best; i !== s && i >= 0; i = T.par[T.find(i)]) { const [x, y, lv] = this._nodeXY(i); path.push([w.near(x, sx) + 0.5, y + 0.5, lv]); }
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

// ---------- drawing upper stories (game.js hook) ----------
// An upper piece is drawn by the normal painters with its base lifted by lv stories, all of it into the sorted batch
// (its floor / blob / sill sprites too, so it stays in depth order with what stands around it).
Levels.prototype.drawUpper = function drawUpper(B, A, o, t) {
  const a = o.alpha ?? 1;
  if (a <= 0.02) return;
  const lift = (o.lv | 0) * STORY_H;
  if (B.faces) drawUpperRot(this, B, A, o, t, lift, a); // (at every camera angle: docs/CAMERA-ROTATION.md)
};
// (at every camera angle) the piece's sprites lifted straight up the screen (its position moved along the view's up while it is
// drawn), its flat layers (rugs, a floor's ghost, sills) laid at the story's height as faces in drawing order (closing
// the face segment after each, so a flat layer stays under what is drawn after it), the plan grid as flat faces too,
// the decon ring and the light lifted up the screen. (Upper floors / walls / stairs are face kinds: art/faces.)
function drawUpperRot(L, B, A, o, t, lift, a) {
  const g = L.game, R = g.R, rot = g.cam.rot || 0, sn = Math.sin(rot), cs = Math.cos(rot), dx = sn * lift, dy = -cs * lift;
  let PB = L._pbr;
  if (!PB || PB.main !== B.main) {
    const flat = { add(s, x, y, sx = 1, sy = 1, r = 1, gg = 1, b = 1, al = 1, sway = 0, rt = 0, fl = 0, flip = 1) { layFlat(B.faces, s, x - PB._dx, y - PB._dy, sx, sy, r, gg, b, al, rt, flip, PB._h); R?.setFaceTex?.(null); }, addRaw() {} };
    PB = L._pbr = { ...B, ground: flat, decor: flat, blob: B.main, _dx: 0, _dy: 0, _h: 0 };
  }
  const fw = o.fw || 1, fh = o.fh || 1, x0 = o.x, y0 = o.y, cy0 = o.cy, tx0 = o.tx, ty0 = o.ty;
  if (BUILDINGS[o.type]?.block === 'stairs') { drawStairFaces(B.faces, A, o, lift, 2); R?.setFaceTex?.(null); return; } // (a stairs ghost)
  // a piece standing on its footprint (anchor = the middle of its south edge, the front in the north view) stands on
  // the middle of the footprint's edge toward the camera
  let ax = 0, ay = 0;
  if (tx0 != null && Math.abs(x0 - (tx0 + fw / 2)) < 1e-3 && Math.abs(y0 - (ty0 + fh)) < 1e-3) {
    const ext = 0.5 * (Math.abs(sn) * fw + Math.abs(cs) * fh);
    ax = tx0 + fw / 2 - sn * ext - x0; ay = ty0 + fh / 2 + cs * ext - y0;
  }
  PB._dx = dx + ax; PB._dy = dy + ay; PB._h = lift;
  // depth: the piece stands on its story (a card through that point at the floor's height, engine/spriteBatch.js);
  // its flat layers and contact shadow lie on the slab, a little toward the camera
  const Z = R?.depth, zb = B.faces.bias;
  if (Z) { Z.ref = true; Z.x = x0 + ax; Z.y = y0 + ay; Z.h = lift; Z.bias += 0.01; }
  B.faces.bias = 0.01;
  if (o.blueprint && !o._ghost && A.has('bp_tile')) { // the blue plan grid flat on its story
    const s = A.get('bp_tile');
    for (let y = ty0; y < ty0 + fh; y++) for (let x = tx0; x < tx0 + fw; x++) B.faces.quad4(x, y, lift + 0.002, s.u0, s.v0, x + 1, y, lift + 0.002, s.u1, s.v0, x + 1, y + 1, lift + 0.002, s.u1, s.v1, x, y + 1, lift + 0.002, s.u0, s.v1, 0.42, 0.7, 1, 0.5 * a);
    R?.setFaceTex?.(null);
  }
  o.x = x0 + PB._dx; o.y = y0 + PB._dy; o.tx = tx0 + PB._dx; o.ty = ty0 + PB._dy; if (cy0 != null) o.cy = cy0 + PB._dy; // sync-ok: drawn lifted this frame only, restored right below
  try { drawStatic(PB, A, drawProxy(A, o), t); } finally { o.x = x0; o.y = y0; o.cy = cy0; o.tx = tx0; o.ty = ty0; B.faces.bias = zb; } // sync-ok: restores the position
  if (!o._ghost && g.build.decon.has(o) && A.has('fx_ring')) B.fx.add(A.get('fx_ring'), tx0 + fw / 2, ty0 + fh / 2 + 0.1, 0.95 * fw, 0.65 * fh, 1, 0.35, 0.3, 0.85, 0, 0, 0, 1, 0, lift);
  const Lg = o.light;
  if (Lg) {
    const tt = g.time, f = Lg.flicker ? 1 - Lg.flicker * (0.5 + 0.5 * Math.sin(tt * 11 + o.x * 3) * Math.sin(tt * 7.3 + o.y)) : 1, d = Lg.radius * 2 * (0.96 + 0.04 * f), h = lift + (Lg.lift ?? 0.3);
    B.light.addRaw(o.x + sn * h, o.y - cs * h, d, d, Lg.r, Lg.g, Lg.b, Lg.intensity * f * a);
  }
}
// the depth key of an entity up a story (game.js; base = its turned y). It sorts after the surface it
// stands on — a wall top's / slab's front-most corner can be up to ~1.07 tiles ahead of the feet at a diagonal yaw, so
// a small margin over the one tile per story —; on a stair it sorts between the stair's back (steps, far stringer) and
// its front part (near stringer, handrail: stairFront below), the nearer climber last.
Levels.prototype.zkRot = function zkRot(e, base, rc, rs) {
  const z = e.z > 0 ? e.z : 0;
  const s = this._active ? this.stairAt(e.lv | 0, e.x, e.y) : null;
  if (s) { const k = stairZk(s.o, rc, rs); return k + 0.0002 + 1e-5 * Math.max(-5, Math.min(5, base + z - k)); }
  return base + z + Math.min(z, 1) * 0.12;
};
// the front part of each finished stair in view (art/faces/levels.js), sorted just after the stair and
// whoever climbs it; hidden like the stair itself (under an opaque roof / a cave ceiling)
const FRONT = new WeakMap();
function stairFront(game, o) {
  let d = FRONT.get(o);
  if (!d) {
    d = {
      o, get x() { return o.x; }, get y() { return o.y; },
      zkRot: (rc, rs) => stairZk(o, rc, rs) + 0.0004,
      draw: (B, A) => {
        if (o.removed || underOpaqueRoof(game, o.x, o.y) || underCaveCeiling(game, o.x, o.y)) return;
        drawStairFaces(B.faces, A, o, (o.lv | 0) * STORY_H, 1);
      },
    };
    FRONT.set(o, d);
  }
  return d;
}
// hidden under an opaque upper floor? (entities and furniture below a slab whose story is not faded for the player)
Levels.prototype.culled = function culled(o) {
  const g = this.game;
  if (o === g.player || o.draw) return false;
  if (!o.isEntity) { const def = o.building && BUILDINGS[o.type]; if (!def || isWallTop(def) || def.layer === 'floor' || def.roof || def.block === 'stairs') return false; }
  const w = g.world, tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
  if (!w.inBounds(tx, ty)) return false;
  const k = o.isEntity ? Math.round(o.z || 0) : (o.lv | 0), i = w.idx(tx, ty), N = w.W * w.H, F = g.build.grid.floor;
  for (let L = k + 1; L <= MAX_LV; L++) { const f = F.get(i + L * N); if (f && !f.blueprint && (f.alpha ?? 1) > 0.5) return true; }
  return false;
};

// ---------- reveal (cosmetic): the stories above the local player inside its roofed building fade out ----------
// Building = J's roof region over the player (indoors). Upper pieces of higher stories on it (and on the ring of walls
// around it) fade to 0, so the player sees its own story; things under the slab the player stands on are culled (they
// would poke through it). Out in the open (a courtyard, under a walkway or a slab without a roof) nothing fades: the
// cutout around the player (engine/shaders.js CUT_FN) opens only what really covers it.
function reveal(game, dt) {
  const L = game.levels, p = game.player, w = game.world;
  const C = L._rev || (L._rev = { key: '', want: new Set(), live: new Set() });
  if (!L.hasUpper && !C.live.size) return;
  const V = Math.round(p.z || 0), tx = Math.floor(p.x), ty = Math.floor(p.y - 0.05), I = game.indoors;
  const key = p.dead ? '' : `${tx},${ty},${V},${game.build.v},${I?.kind === 'built' ? I.region : 0}`;
  if (key !== C.key) {
    C.key = key;
    C.want.clear();
    if (key && w.inBounds(tx, ty) && L.hasUpper) {
      let tiles = null;
      const reg = I?.kind === 'built' ? game.roofs?.regions?.get(I.region) : null;
      if (reg) tiles = new Set(reg.tiles);
      if (tiles) {
        const near = (i) => tiles.has(i) || tiles.has(i - 1) || tiles.has(i + 1) || tiles.has(i - w.W) || tiles.has(i + w.W);
        for (const o of game.build.structures) {
          if (!(o.lv > V) || o.removed) continue;
          let hit = false;
          for (let y = o.ty; y < o.ty + (o.fh || 1) && !hit; y++) for (let x = o.tx; x < o.tx + (o.fw || 1) && !hit; x++) hit = near(w.idx(x, y));
          if (hit) C.want.add(o);
        }
      }
    }
  }
  for (const o of C.want) C.live.add(o);
  const k = 1 - Math.exp(-dt * 7);
  for (const o of C.live) {
    const to = C.want.has(o) && !o.removed ? 0 : 1;
    const a = o.alpha ?? 1;
    const na = Math.abs(to - a) < 0.01 ? to : a + (to - a) * k;
    if (na >= 1) { delete o.alpha; C.live.delete(o); } else o.alpha = na; // sync-ok: cosmetic fade (COSMETIC_FIELDS 'alpha')
  }
}

// authority: upper pieces that lost their support fall (op lv.collapse, half the materials as loot below)
function collapseCheck(game) {
  const L = game.levels;
  if (L._colV === L.v) return;
  L._colV = L.v;
  const bad = L.unsupported();
  if (!bad.length) return;
  const net = game.net, drops = [];
  for (const o of bad) {
    const cost = BUILDINGS[o.type]?.cost || {};
    for (const id in cost) { const q = Math.floor(cost[id] / 2); if (q > 0) drops.push(lootRow(net, o.x, o.y - 0.3, id, q, 0.7)); }
    if (o.store) for (const s of o.store.slots) if (s) drops.push(lootRow(net, o.x, o.y - 0.3, s.id, s.qty, 0.8));
  }
  net.emit('lv.collapse', { ids: bad.map((o) => o.id), drops: drops.length ? drops : undefined });
}

// (the old cutaway — walls of the player's room and in front of it faded to 0.22 — is retired: the cutout around the
// player opens only what covers it, at every camera angle)

// ---------- system ----------
// Every peer keeps the derived map fresh; the owner settles its own player (falls, jump down), the authority
// its creatures. Remote copies only display the replicated z. Also the landing marker of a stairs ghost (cosmetic).
// (Depth: game.js sorts by (_sy ?? y) + z — one tile of depth per story; stairs get _sy at rebuild.)
export function levelsSystem() {
  let bar = null;
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
        for (const e of game.entities) if (e.isMob && !e.proxy && (e.lv || e.z > 0)) L.settle(e, dt);
      }
      p._lx = p.x; p._ly = p.y; // (stair / wall-top footsteps: juice + audio 'step' with surfaceOf)
      if (game.net.auth && L.hasUpper) collapseCheck(game);
      if (!game.headless) reveal(game, dt);
      // build mode: the story to build on (src/ui/levelbar.js), loaded lazily like the build bar
      if (!bar && typeof document !== 'undefined' && game.R?.canvas && !game.headless) {
        bar = 1;
        import('../ui/levelbar.js').then((m) => { bar = m.installLevelbar(game); }).catch((e) => { console.warn('levelbar', e); bar = 2; });
      }
      if (typeof bar === 'object' && bar) bar.update(dt);
    },
    // (at every camera angle) the front part of each finished stair in view, as a drawable of its own (stairFront)
    collect(game, list, v) {
      const L = game.levels;
      if (!L?._active) return; // (3D at every angle)
      for (const s of L.stairs) {
        const o = s.o;
        if (o.x > v.x0 - 4 && o.x < v.x1 + 4 && o.y > v.y0 - 4 && o.y < v.y1 + 4) list.push(stairFront(game, o));
      }
    },
    render(game, B) {
      // stairs ghost: mark where it lets you off upstairs — the landing ahead and the two tiles beside the top step
      // (green when a surface is there to step onto; the landing red when nothing at all is up there)
      const m = game.build?.mode, A = game.A;
      if (!m || m.kind !== 'place' || BUILDINGS[m.type]?.block !== 'stairs' || !A.has('fx_ring')) return;
      const L = game.levels, ring = A.get('fx_ring'), pulse = 0.7 + 0.3 * Math.sin(game.time * 5);
      const [w0, h0] = BUILDINGS[m.type].size;
      for (const g of m.tiles || []) {
        const r = m.rot & 3, fw = r & 1 ? h0 : w0, fh = r & 1 ? w0 : h0;
        const lx = r === 0 ? g.tx : r === 2 ? g.tx : r === 1 ? g.tx + fw : g.tx - 1;
        const ly = r === 0 ? g.ty - 1 : r === 2 ? g.ty + fh : g.ty;
        const up = Math.min(MAX_LV, (m.lv | 0) + 1), surf = (x, y) => L.isSurface(up, L._tile(x + 0.5, y + 0.5));
        const tx1 = r === 1 ? g.tx + fw - 1 : g.tx, ty1 = r === 2 ? g.ty + fh - 1 : g.ty; // the top step
        const sides = r & 1 ? [[tx1, ty1 - 1], [tx1, ty1 + 1]] : [[tx1 - 1, ty1], [tx1 + 1, ty1]];
        let any = surf(lx, ly);
        // (camera turned: the ring at the tile's middle, lifted straight up the screen)
        const rot = game.cam?.rot || 0, RY = (y) => (rot ? y + 0.5 : y + 0.6 - up * STORY_H), rl = rot ? up * STORY_H - 0.1 : 0;
        for (const [sx, sy] of sides) if (surf(sx, sy)) { any = true; B.fx.add(ring, sx + 0.5, RY(sy), 0.7, 0.45, 0.5, 1, 0.55, 0.6 * pulse, 0, 0, 0, 1, 0, rl); }
        const ok = surf(lx, ly);
        B.fx.add(ring, lx + 0.5, RY(ly), 0.8, 0.5, ok ? 0.5 : any ? 0.8 : 1, ok ? 1 : any ? 0.8 : 0.85, ok ? 0.55 : any ? 0.8 : 0.45, (ok || !any ? 0.75 : 0.35) * pulse, 0, 0, 0, 1, 0, rl);
      }
    },
  };
}
