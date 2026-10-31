// Rock being mined (cosmetic). The cracks follow the pickaxe: every hit (op rock.prog → game.rockHits, shared, so
// every peer sees the same crack) splits the rock top further, from the middle of the tile out to its edges — a
// better pickaxe needs fewer hits, so its cracks open faster. The last hit (op tile.mine → mut/tiles.js mineTile)
// breaks the block apart along those cracks: the terrain shader keeps drawing it as rock while its chunks drop out
// one by one (~0.3 s), its pieces slump into the hole and dust rises (the puff of tile.mine).
// The terrain shader reads up to 8 tiles near the view (renderer.mine: tx, ty, crack 0..1 or 1 + break progress,
// hit pulse 0..1 for the tremble).
//
// Walls / doors / fences hit by winter walkers (op struct.dmg → o.dmg 0..1, walkers.js) crack the same way: every
// hit trembles the piece's cracks and throws splinters / chips, the cracks spread as the damage grows (wall-face
// crack sprites over the piece, depth-sorted right after it), and the last hit (struct.remove fx 'smash') breaks it
// into pieces that drop around its tile with dust.

import { archSprite, CAMV } from '../art/archCompose.js';
import { BUILDINGS } from '../game/data.js';
import { STRUCT_GEOM } from '../art/structures.js';
import { boxDepth } from '../art/faces/registry.js';

const MAXN = 8;
const BREAK_T = 0.32;

export function initRockFx(game) {
  game.rockFx = { hitT: new Map(), breaking: new Map(), walls: new Set(), structHit, structBreak };
}

const isStone = (o) => o.type === 'wall_stone' || BUILDINGS[o.type]?.mat === 'stone';
const WOOD_COL = [0.56, 0.4, 0.24], STONE_COL = [0.6, 0.58, 0.55];

// op struct.dmg applied (every peer): o.dmg is set; (x, y) = the hitter (null: it settled)
function structHit(game, o, x, y) {
  const F = game.rockFx;
  if (!F) return;
  if (o.dmg > 0) F.walls.add(o); else F.walls.delete(o);
  if (x == null || game.headless) return;
  o._hitT = game.time; o._hitX = x; o._hitY = y;
  const col = isStone(o) ? STONE_COL : WOOD_COL;
  // splinters / chips fly off the face toward the hitter, a thud
  const dx = x - o.x, dy = y - (o.y - 0.5), L = Math.hypot(dx, dy) || 1;
  game.juice?.chips(o.x + (dx / L) * 0.35, o.y - 0.3 + (dy / L) * 0.2, col, 4 + Math.round(o.dmg * 4), 0.55);
  game.audio?.play(isStone(o) ? 'pick' : 'build_hit', { x: o.x, y: o.y, volume: 0.55 + o.dmg * 0.3 });
}

// op struct.remove fx 'smash' (before the piece is removed): it falls apart into pieces + dust
function structBreak(game, o) {
  const F = game.rockFx;
  F?.walls.delete(o);
  if (game.headless) return;
  const col = isStone(o) ? STONE_COL : WOOD_COL, w = game.world;
  breakFx(game, o.ty * w.W + o.tx, { col, fx: o._hitX, fy: o._hitY, lift: 0.7, n: 8 });
  game.juice?.puff(o.x, o.y - 0.25, 12, isStone(o) ? [0.7, 0.68, 0.64] : [0.66, 0.56, 0.42], 0.9);
  const p = game.player;
  if (p && Math.hypot(p.x - o.x, p.y - o.y) < 9) game.juice?.shake?.(0.25); // (felt nearby only)
}

// a hit landed on rock tile i (op applier, or the local swing ahead of the host's reply); (x, y) = the miner
export function onRockHit(game, i, x, y) {
  game.rockFx?.hitT.set(i, { t: game.time, x, y });
}

// rock tile i was mined out (op applier with fx): it breaks apart; col = its rock colour
export function onRockBreak(game, i, col) {
  const F = game.rockFx;
  if (!F) return;
  const h = F.hitT.get(i);
  F.hitT.delete(i);
  F.breaking.set(i, { t: 0, col, fx: h?.x, fy: h?.y, spawned: false });
}

// drawable: the cracks over a damaged piece (right after it in the depth order); 4 stages that grow from the middle of
// its top (and of its front face when it faces the camera), trembling for 0.18 s after a hit
function drawCracks(B, A) {
  const o = this.o, d = o.dmg || 0;
  if (!(d > 0) || o.removed) return;
  const k = this.game.time - (o._hitT || -9), sh = k < 0.18 ? (1 - k / 0.18) * 0.035 * Math.sin(k * 90) : 0;
  const stage = Math.min(3, Math.floor(d * 4)), front = !((o.mask | 0) & 4);
  const s = archSprite(A, (front ? 'siege_crack_f' : 'siege_crack_t') + stage);
  if (!s) return;
  const fl = (o.tx * 7 + o.ty * 3) & 1 ? 1 : -1, a = Math.min(1, 0.55 + (d * 4 - stage) * 0.45) * (o.alpha ?? 1);
  if (this.game.cam.rot && B.faces) { crackFaces(B.faces, A, o, d, stage, fl, a, sh); return; }
  B.main.add(s, o.x + sh, o.y, fl, 1, 1, 1, 1, a, 0, 0, 0, 1);
}
// camera turned (docs/CAMERA-ROTATION.md): the wall is a box of faces — its cracks go on its top and on every open side
// that faces the camera, like the wall's own layers (the crack art is drawn in the wall's frame: top tile, then face)
const UVC = [0, 0, 0, 0];
function crackUV(s, y0, y1, fl) { // rows y0..y1 of the 1 × 2 wall frame (tiles from its top)
  const fu = (x) => s.ax + (x - 0.5) / s.w, fv = (y) => s.ay + (y - 2) / s.h;
  const ua = s.u0 + (s.u1 - s.u0) * fu(0), ub = s.u0 + (s.u1 - s.u0) * fu(1);
  UVC[0] = fl < 0 ? ub : ua; UVC[2] = fl < 0 ? ua : ub; UVC[1] = s.v0 + (s.v1 - s.v0) * fv(y0); UVC[3] = s.v0 + (s.v1 - s.v0) * fv(y1);
  return UVC;
}
function crackFaces(F, A, o, d, stage, fl, a, sh) {
  const m = (o.mask | 0) & 15, hb = (o.lv | 0) * (STRUCT_GEOM.FH), ht = hb + STRUCT_GEOM.FH;
  const x0 = o.tx + sh * CAMV.c, y0 = o.ty + sh * CAMV.s, x1 = x0 + 1, y1 = y0 + 1;
  const vis = (nx, ny) => -CAMV.s * nx + CAMV.c * ny > 0.02;
  const f = archSprite(A, 'siege_crack_f' + stage), t = archSprite(A, 'siege_crack_t' + stage);
  if (f) {
    const uv = crackUV(f, 1, 2, fl);
    const q = (ax, ay, bx, by) => F.quad(ax, ay, ht, bx, by, ht, bx, by, hb, ax, ay, hb, uv, 1, 1, 1, a);
    if (!(m & 4) && vis(0, 1)) q(x0, y1, x1, y1);
    if (!(m & 1) && vis(0, -1)) q(x1, y0, x0, y0);
    if (!(m & 2) && vis(1, 0)) q(x1, y1, x1, y0);
    if (!(m & 8) && vis(-1, 0)) q(x0, y0, x0, y1);
  }
  const top = t || f;
  if (top) F.quad(x0, y0, ht, x1, y0, ht, x1, y1, ht, x0, y1, ht, crackUV(top, 0, 1, fl), 1, 1, 1, a);
}

// camera turned: right after the wall box it is on (game.js depth key)
function crackDepth(rc, rs) { return boxDepth(this.o, rc, rs) + 0.002; }

export function rockFxSystem() {
  const tmp = [], pool = [];
  return {
    sync: 'cosmetic',
    collect(game, list, v) {
      const F = game.rockFx;
      if (!F?.walls.size) return;
      let k = 0;
      for (const o of F.walls) {
        if (o.removed || !(o.dmg > 0)) { F.walls.delete(o); continue; }
        if (o.x < v.x0 - 2 || o.x > v.x1 + 2 || o.y < v.y0 - 1 || o.y > v.y1 + 3) continue;
        const d = pool[k] || (pool[k] = { draw: drawCracks, x: 0, y: 0, o: null, game, zkRot: crackDepth });
        d.o = o; d.x = o.x; d.y = (o._sy ?? o.y) + 0.002; d.game = game;
        list.push(d); k++;
      }
    },
    update(game, dt) {
      const F = game.rockFx;
      if (!F) return;
      for (const [i, b] of F.breaking) {
        if (!b.spawned) { b.spawned = true; if (!game.headless) breakFx(game, i, b); }
        b.t += dt;
        if (b.t >= BREAK_T) F.breaking.delete(i);
      }
      if (F.hitT.size > 48) for (const [i, h] of F.hitT) if (game.time - h.t > 20) F.hitT.delete(i);
      const R = game.R;
      if (game.headless || !R?.mine) return;
      const W = game.world.W, v = game.view(), cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
      const inView = (x, y) => x >= v.x0 - 1 && x <= v.x1 + 1 && y >= v.y0 - 1 && y <= v.y1 + 2;
      tmp.length = 0;
      for (const [i, p] of game.rockHits) { const x = i % W, y = (i - x) / W; if (p > 0 && inView(x, y)) tmp.push([x, y, Math.min(0.999, p), i]); }
      for (const [i, b] of F.breaking) { const x = i % W, y = (i - x) / W; if (inView(x, y)) tmp.push([x, y, 1 + Math.min(1, b.t / BREAK_T), i]); }
      if (tmp.length > MAXN) tmp.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      const n = Math.min(MAXN, tmp.length), U = R.mine.u;
      for (let k = 0; k < n; k++) {
        const [x, y, p, i] = tmp[k], h = F.hitT.get(i);
        U[k * 4] = x; U[k * 4 + 1] = y; U[k * 4 + 2] = p;
        U[k * 4 + 3] = h && p < 1 ? Math.max(0, 1 - (game.time - h.t) / 0.2) : 0;
      }
      R.mine.n = n;
    },
  };
}

// the block's pieces slump into the hole it leaves and roll to a stop
function breakFx(game, i, b) {
  const P = game.particles, A = game.A, w = game.world;
  if (!P || !A) return;
  const x = i % w.W, y = (i - x) / w.W, v = game.view?.();
  if (v && (x < v.x0 - 3 || x > v.x1 + 3 || y < v.y0 - 3 || y > v.y1 + 4)) return;
  const name = A.has('fx_rubble') ? 'fx_rubble' : A.has('fx_spark') ? 'fx_spark' : null;
  if (!name) return;
  const col = b.col || [0.6, 0.58, 0.55];
  let dx = 0, dy = 1;
  if (b.fx != null) { dx = b.fx - (x + 0.5); dy = b.fy - (y + 0.5); const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }
  const K = 1 / Math.max(0.01, A.get(name).w);
  // they slump into the hole it leaves (a heap on the new floor), only a little toward the miner
  const n = b.n || 5, L0 = b.lift || 0.25;
  for (let j = 0; j < n; j++) {
    const s = (0.2 + Math.random() * 0.22) * K, sh = 0.85 + Math.random() * 0.25, k = (Math.random() * 3) | 0;
    P.emit({ spr: k && A.has('fx_rubble_' + k) ? 'fx_rubble_' + k : name, x: x + 0.2 + Math.random() * 0.6, y: y + 0.15 + Math.random() * 0.45,
      lift: L0 + Math.random() * 0.45, vlift: 0.3 + Math.random() * 0.9, grav: 11, bounce: 0.25,
      vx: dx * 0.3 + (Math.random() - 0.5) * 0.7, vy: dy * 0.2 + (Math.random() - 0.5) * 0.35, drag: 2.2,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9, life: 0.9 + Math.random() * 0.4, hold: 0.55,
      size: s, size1: s * 0.85, r: col[0] * sh, g: col[1] * sh, b: col[2] * sh, a: 1, a1: 0 });
  }
}
