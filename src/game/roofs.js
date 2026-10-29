// Roofs: built roofs (structures on layer 'roof'), the support rule, collapses, the "indoors" state of the local
// player and everything the renderer needs to draw roofs (agent J).
//
// Shared / deterministic part (runs inside op appliers on every peer, never reads the local player):
//   - world.broof[i] = style index + 1 of the FINISHED roof tile at i (0 = none) — onRoofStruct() from
//     placeStructure / completeStructure / removeStructure (mut/structures.js);
//   - support: a roof tile needs a support within ROOF_GEOM.support (6) tiles, Euclidean between tile centres:
//     a wall / door / column (def.support) on layer 'main', natural rock, or the map edge. Placing a roof plan
//     counts planned supports too; building a roof tile needs a FINISHED support; a finished roof tile whose last
//     finished support goes away collapses (host system roofSupportSystem → op roof.collapse, mut/roofs.js);
//   - natural roofs are a pure function of the rock grid (world.js _naturalRoof).
// Local / cosmetic part (roofsSystem, sync 'cosmetic'):
//   - regions: 4-connected finished roof tiles (game.roofs.regions, regionOf), each with its procedural art
//     (src/art/roofRaster.js) rebuilt only when its tiles / fires change, drawn as depth-sorted column slices
//     (collect → renderer roof segments), sun-shadow casters and a light occluder;
//   - roofData (RGBA per tile, renderer uRoofT): R = interior darkness (walking distance from open sky through
//     open doors), G = revealed (the region the local player is under, faded), B = built roof coverage;
//   - game.indoors = { kind: null | 'cave' | 'built', region, zoomK, caveK, builtK } for the local player
//     (camera zoom lock in game.js, screen effects in the post shader, audio / survival read world.roofAt);
//   - fades: the region the local player is under fades out (~0.35 s); a roof in front of the player goes
//     see-through (0.32); chimneys smoke while a fire burns under them; cave-ins and collapses kick up dust.

import { BUILDINGS } from './data.js';
import { ROOF_GEOM, ROOF_STYLES, ROOF_TYPE_STYLES, roofEaveH, DET, detBits } from './content/roofs.js';
import { rasterRegion, attachArt } from '../art/roofRaster.js';

const STYLE_KEYS = Object.keys(ROOF_STYLES);
const STYLE_IDX = Object.fromEntries(STYLE_KEYS.map((k, i) => [k, i + 1]));
export const styleIndex = (o) => STYLE_IDX[o.style] || STYLE_IDX[ROOF_TYPE_STYLES[o.type]?.[0]] || 1;
const BUILT_DK = [0, 0.42, 0.66, 0.82, 0.92, 1]; // interior darkness by walking distance from open sky
const SUPPORT = ROOF_GEOM.support;
const ART_BUDGET_MS = 8;  // per frame for painting region art on the main thread (no worker)
const MAX_JOBS = 3;       // region paintings in flight in the worker

export const isRoofType = (type) => !!BUILDINGS[type]?.roof;
export const isSupportType = (type) => !!BUILDINGS[type]?.support;

export function initRoofs(game) {
  const w = game.world, N = w.W * w.H;
  game.roofs = {
    regionOf: new Int32Array(N),   // cosmetic: region id per tile (0 = none)
    regions: new Map(),
    nextId: 1,
    dirty: new Set(),              // tiles whose finished roof changed (regions to rebuild)
    artDirty: new Set(),           // tiles whose region art must be redrawn (fires appear / go)
    supportDirty: [],              // [x0, y0, x1, y1] where a finished support disappeared (host: collapse check)
    data: new Uint8Array(N * 4),   // roofData texture (R dark, G revealed, B coverage)
    dataDirty: null,               // tile rect of roofData to recompute (light / coverage)
    upload: null,                  // tile rect of roofData to upload
    fx: [],                        // pending cosmetic fx (dust of collapses / cave-ins)
    caveFade: new Map(),           // tile -> { a, b, t } cave darkness easing after a cave-in
    v: 0,
  };
  game.indoors = { kind: null, region: 0, zoomK: 0, caveK: 0, builtK: 0, _cand: null, _candT: 0, _k: 0 };
  game.roofs.hidden = (x, y) => underOpaqueRoof(game, x, y); // for fx modules (no import of game code)
  // the world asks us to ease cave darkness changes caused by mining (cosmetic)
  w.caveFade = (i, a, b) => { game.roofs.caveFade.set(i, { a, b, t: 0 }); };
}

// ---------------- shared hooks (op appliers / snapshot) ----------------
// a roof / support / fire structure changed: keep world.broof and the dirty sets in step
export function onRoofStruct(game, o, what, wasBlueprint = false) {
  const R = game.roofs;
  if (!R) return;
  const def = BUILDINGS[o.type], w = game.world;
  if (def?.roof) {
    const i = w.idx(o.tx, o.ty);
    if (what === 'complete') { w.broof[i] = styleIndex(o); R.supportDirty.push([o.tx, o.ty, o.tx, o.ty]); } // (host: still held up?)
    else if (what === 'remove' && !wasBlueprint) w.broof[i] = 0;
    else return;
    R.dirty.add(i);
    markData(R, o.tx - 6, o.ty - 6, o.tx + 6, o.ty + 6);
    return;
  }
  if (def?.support && what === 'remove' && !wasBlueprint) R.supportDirty.push([o.tx, o.ty, o.tx + (o.fw || 1) - 1, o.ty + (o.fh || 1) - 1]);
  // fires under a roof change its chimneys; anything solid changes the indoor light
  if ((def?.fire || def?.warm || def?.workLight) && !o.moveOf) for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) if (w.inBounds(x, y)) R.artDirty.add(w.idx(x, y));
  markData(R, o.tx - 6, o.ty - 6, o.tx + (o.fw || 1) + 6, o.ty + (o.fh || 1) + 6);
}
// rock mined: a support of nearby built roofs may be gone; the indoor light changes
export function onRockMined(game, tx, ty) {
  const R = game.roofs;
  if (!R) return;
  R.supportDirty.push([tx, ty, tx, ty]);
  markData(R, tx - 8, ty - 8, tx + 8, ty + 8);
}
// a door opened / closed (light comes in through the doorway)
export function onDoor(game, o) { if (game.roofs) markData(game.roofs, o.tx - 6, o.ty - 6, o.tx + 6, o.ty + 6); }

function markData(R, x0, y0, x1, y1) {
  const d = R.dataDirty;
  if (!d) R.dataDirty = [x0, y0, x1, y1];
  else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
}
function markUpload(R, x0, y0, x1, y1) {
  const d = R.upload;
  if (!d) R.upload = [x0, y0, x1, y1];
  else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
}

// ---------------- support rule ----------------
// a support on tile i? completed: only finished supports count; exclude: Set of structures treated as gone
export function supportAt(game, i, completed = true, exclude = null) {
  const w = game.world;
  if (w.rock[i]) return true;
  const o = game.build.grid.main.get(i);
  if (!o || !BUILDINGS[o.type]?.support || o.moveOf) return false;
  if (completed && o.blueprint) return false;
  return !(exclude && exclude.has(o));
}
// is a roof on (tx, ty) held up? (within SUPPORT tiles of a support; the map edge counts)
export function roofSupported(game, tx, ty, completed = true, exclude = null) {
  const w = game.world, N = SUPPORT, N2 = N * N;
  for (let dy = -N; dy <= N; dy++) {
    const y = ty + dy;
    if (y < 0 || y >= w.H) return true;
    const r = Math.floor(Math.sqrt(N2 - dy * dy));
    for (let dx = -r; dx <= r; dx++) {
      const x = tx + dx;
      if (x < 0 || x >= w.W) return true;
      if (supportAt(game, y * w.W + x, completed, exclude)) return true;
    }
  }
  return false;
}
// finished roof structures that would lose their support if `gone` (a Set of supports) disappeared
export function roofsLostWithout(game, gone) {
  const w = game.world, out = [], seen = new Set();
  for (const s of gone) {
    for (let y = s.ty - SUPPORT; y < s.ty + (s.fh || 1) + SUPPORT; y++) for (let x = s.tx - SUPPORT; x < s.tx + (s.fw || 1) + SUPPORT; x++) {
      if (!w.inBounds(x, y)) continue;
      const o = game.build.grid.roof.get(w.idx(x, y));
      if (!o || o.blueprint || seen.has(o)) continue;
      seen.add(o);
      if (!roofSupported(game, x, y, true, gone)) out.push(o);
    }
  }
  return out;
}

// host: finished roof tiles with no finished support near the rects where supports vanished
export function unsupportedRoofs(game, rects) {
  const w = game.world, out = [], seen = new Set();
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0 - SUPPORT; y <= y1 + SUPPORT; y++) for (let x = x0 - SUPPORT; x <= x1 + SUPPORT; x++) {
      if (!w.inBounds(x, y)) continue;
      const o = game.build.grid.roof?.get(w.idx(x, y));
      if (!o || o.blueprint || seen.has(o)) continue;
      seen.add(o);
      if (!roofSupported(game, x, y, true)) out.push(o);
    }
  }
  return out;
}

// enclosed room around (tx, ty): tiles bounded by walls / doors / rock (≤ max tiles), + the wall ring around it.
// Returns null when it is open (or too big). Used to fill a room with roof plans in one tap.
export function enclosedRoom(game, tx, ty, max = 220) {
  const w = game.world, W = w.W;
  if (!w.inBounds(tx, ty)) return null;
  const wallish = (i) => w.rock[i] === 1 || (() => { const o = game.build.grid.main.get(i); return !!o && BUILDINGS[o.type]?.connect === 'wall'; })();
  const s0 = ty * W + tx;
  if (wallish(s0)) return null;
  const seen = new Set([s0]), q = [s0], ring = new Set();
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny) || nx < 1 || ny < 1 || nx >= W - 1 || ny >= w.H - 1) return null;
      const j = ny * W + nx;
      if (seen.has(j) || ring.has(j)) continue;
      if (wallish(j)) { if (!w.rock[j]) ring.add(j); continue; }
      if (dx && dy) continue; // corners only collect walls
      seen.add(j);
      if (seen.size > max) return null;
      q.push(j);
    }
  }
  const out = [];
  for (const i of [...seen, ...ring]) out.push([i % W, (i / W) | 0]);
  return out;
}

// ---------------- cosmetic: collapse / cave-in dust ----------------
export function collapseFx(game, tiles, { big = false, cave = false } = {}) {
  const J = game.juice, w = game.world, R = game.roofs;
  let cx = 0, cy = 0;
  const n = Math.min(tiles.length, 60);
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    const x = Array.isArray(t) ? t[0] : t % w.W, y = Array.isArray(t) ? t[1] : (t / w.W) | 0;
    cx += x + 0.5; cy += y + 0.5;
    if (k >= n) continue;
    const col = cave ? [0.58, 0.55, 0.5] : [0.62, 0.5, 0.34];
    J?.puff(x + 0.5, y + 0.6, cave ? 6 : 7, col, 1.1);
    J?.chips(x + 0.5, y + 0.5, cave ? [0.5, 0.48, 0.44] : [0.55, 0.4, 0.24], 5, 0.9);
    if (R) R.fx.push({ x: x + 0.5, y: y + 0.5, t: -k * 0.02, cave });
  }
  if (!tiles.length) return;
  cx /= tiles.length; cy /= tiles.length;
  const near = Math.hypot(game.cam.x - cx, game.cam.y - cy);
  if (near < 22) game.juice?.shake?.(Math.min(0.6, (big ? 0.55 : 0.3) * (1 - near / 26)));
  game.audio?.play(cave ? 'cave_in' : 'roof_collapse', { x: cx, y: cy });
  return [cx, cy];
}

// ---------------- the local / cosmetic system ----------------
export function roofsSystem() {
  let artT = 0, smokeAcc = 0;
  const tmpList = [];
  return {
    sync: 'cosmetic', // regions, art, fades, indoor state of the local player, roofData texture
    update(game, dt) {
      const R = game.roofs;
      if (!R) return;
      if (R.dirty.size) rebuildRegions(game);
      if (R.artDirty.size) {
        for (const i of R.artDirty) { const id = R.regionOf[i]; if (id) { const g = R.regions.get(id); if (g) g.artDirty = true; } }
        R.artDirty.clear();
      }
      if (R.dataDirty) { const d = R.dataDirty; R.dataDirty = null; computeData(game, d[0], d[1], d[2], d[3]); }
      updateIndoors(game, dt);
      updateFades(game, dt);
      easeCave(game, dt);
      if (!game.net.auth) R.supportDirty.length = 0; // (only the host checks collapses)
      // region art: the dirty ones near the view first (worker; main thread within a frame budget as fallback)
      artT += dt;
      if (!game.headless) {
        const v = game.view(), t0 = performance.now();
        tmpList.length = 0;
        for (const g of R.regions.values()) if (g.artDirty && !g.pending) tmpList.push(g);
        if (tmpList.length) {
          const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
          tmpList.sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy));
          const W = workerOf(game);
          for (const g of tmpList) {
            if (W ? W.jobs.size >= MAX_JOBS : performance.now() - t0 > ART_BUDGET_MS && g.art) break;
            buildArt(game, g, W);
          }
        }
      }
      // chimney smoke while a fire burns under the roof
      smokeAcc += dt;
      if (smokeAcc > 0.12) { smokeChimneys(game, smokeAcc); smokeAcc = 0; }
      dustFx(game, dt);
      // roofData upload
      if (R.upload && game.R?.updateRoofData) { const u = R.upload; R.upload = null; game.R.updateRoofData(R.data, u[0], u[1], u[2], u[3]); }
      // screen effects (post shader) and the indoor ambient level
      const X = game.env?.env?.extra;
      if (X) {
        const F = X.uIndoorFx || (X.uIndoorFx = [0, 0, 0, 0]);
        const I = game.indoors;
        F[0] = I.caveK; F[1] = I.builtK; F[2] = I.zoomK; F[3] = 0;
        X.uIndoorAmb = 0.42;
      }
    },
    collect(game, list, v) {
      const R = game.roofs;
      if (!R || !R.regions.size) return;
      for (const g of R.regions.values()) {
        const a = g.art;
        if (!a || a.sx1 < v.x0 - 1 || a.sx0 > v.x1 + 1 || a.sy1 < v.y0 - 1 || a.sy0 > v.y1 + 1) continue;
        if (g.alpha <= 0.004) continue;
        for (const s of a.slices) if (s.x1 > v.x0 - 1 && s.x0 < v.x1 + 1 && s.y1 > v.y0 - 1 && s.y0 < v.y1 + 1) { s.drawable.region = g; list.push(s.drawable); }
      }
    },
    render(game, B, v, env) {
      const R = game.roofs;
      if (!R || !R.regions.size || !B.shadow) return;
      // sun-shadow casters: a vertical card + a lifted lid per tile (the roof volume, union by MAX blend)
      const A = game.A, top = A.has('fx_solid') ? A.get('fx_solid') : null, card = A.has('fx_solid_b') ? A.get('fx_solid_b') : null;
      if (!top || !card) return;
      const w = game.world, sx0 = v.x0 - 4, sx1 = v.x1 + 4, sy0 = v.y0 - 3, sy1 = v.y1 + 4;
      for (const g of R.regions.values()) {
        const a = g.art;
        if (!a || g.x1 + 1 < sx0 || g.x0 > sx1 || g.y1 + 1 < sy0 || g.y0 > sy1) continue;
        const k = Math.min(1, g.alpha * 1.4);
        if (k < 0.05) continue;
        const kt = 1 / top.w, kc = 1 / card.w, AT = a.tiles;
        for (let n = 0; n < AT.length; n++) {
          const i = AT[n], tx = i % w.W, ty = (i - tx) / w.W;
          if (tx < sx0 || tx > sx1 || ty < sy0 || ty > sy1) continue;
          const h = a.tileH[n];
          B.shadow.add(card, tx + 0.5, ty + 0.5, kt * 1.02, h / card.h, 1, 1, 1, k, 0, 0, 0, 1, 0, 0);
          B.shadow.add(top, tx + 0.5, ty, kc * 1.02, (1 / 0.6) / top.h, 1, 1, 1, k, 0, 0, 0, 1, 0, h);
        }
      }
      // gable windows glow warm at night while a light burns inside
      const night = env?.night || 0, glow = A.has('fx_glow') ? A.get('fx_glow') : null;
      if (night < 0.15 || !glow || !B.emissive) return;
      const kg = 1 / glow.w;
      for (const g of R.regions.values()) {
        const a = g.art;
        if (!a || !a.windows.length || g.alpha < 0.3 || a.sx1 < v.x0 || a.sx0 > v.x1 || a.sy1 < v.y0 || a.sy0 > v.y1) continue;
        if (!g.lights.some((id) => { const o = w.objById.get(id); return o && o.light && o.fire !== false && o.lit !== false; })) continue;
        for (const wd of a.windows) {
          const fl = 0.85 + 0.15 * Math.sin(game.time * 7 + wd.x * 3) * Math.sin(game.time * 4.3 + wd.y);
          B.emissive.add(glow, wd.x, wd.y, wd.s * 2.2 * kg, wd.s * 1.8 * kg, 1, 0.66, 0.3, 0.55 * night * g.alpha * fl, 0, 0, 0, 1, 0, wd.h);
        }
      }
    },
  };
}

// ---------------- regions ----------------
function rebuildRegions(game) {
  const R = game.roofs, w = game.world, W = w.W, RG = R.regionOf, B = w.broof;
  const seeds = [];
  const affected = new Set();
  for (const i of R.dirty) {
    seeds.push(i);
    const x = i % W;
    for (const j of [i, i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= RG.length || (j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
      if (RG[j]) affected.add(RG[j]);
    }
  }
  // tiles that lost their roof leave the revealed mask
  for (const i of R.dirty) if (!B[i] && R.data[i * 4 + 1]) { R.data[i * 4 + 1] = 0; markUpload(R, i % W, (i / W) | 0, i % W, (i / W) | 0); }
  R.dirty.clear();
  const olds = [];
  for (const id of affected) {
    const g = R.regions.get(id);
    if (!g) continue;
    for (const i of g.tiles) { if (RG[i] === id) RG[i] = 0; seeds.push(i); }
    R.regions.delete(id);
    olds.push(g);
  }
  const q = [];
  for (const s of seeds) {
    if (!B[s] || RG[s]) continue;
    const id = R.nextId++, tiles = [];
    RG[s] = id; q.length = 0; q.push(s);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i - x) / W;
      tiles.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && B[i - 1] && !RG[i - 1]) { RG[i - 1] = id; q.push(i - 1); }
      if (x < W - 1 && B[i + 1] && !RG[i + 1]) { RG[i + 1] = id; q.push(i + 1); }
      if (y > 0 && B[i - W] && !RG[i - W]) { RG[i - W] = id; q.push(i - W); }
      if (y < w.H - 1 && B[i + W] && !RG[i + W]) { RG[i + W] = id; q.push(i + W); }
    }
    tiles.sort((a, b) => a - b);
    const g = { id, tiles: Int32Array.from(tiles), x0, y0, x1, y1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2,
      art: null, gl: null, artDirty: true, pending: 0, alpha: 1, reveal: 0, occl: 1, lights: [] };
    // keep showing the old painting of the biggest overlapping old region until the new one is ready
    let best = null, bn = 0;
    for (const o of olds) {
      if (o.taken || o.x1 < x0 || o.x0 > x1 || o.y1 < y0 || o.y0 > y1) continue;
      let n = 0;
      for (const i of o.tiles) if (RG[i] === id) n++;
      if (n > bn) { bn = n; best = o; }
    }
    if (best) {
      best.taken = true;
      g.art = best.art; g.gl = best.gl; g.reveal = best.reveal; g.occl = best.occl; g.alpha = best.alpha; g.lights = best.lights;
    }
    R.regions.set(id, g);
  }
  for (const o of olds) if (!o.taken) disposeRegion(game, o);
  R.v++;
  // the revealed mask follows the region under the player (re-evaluated next frame)
  game.indoors._maskDirty = true;
}

function disposeRegion(game, g) {
  if (g.gl && game.R?.deleteRoofTex) game.R.deleteRoofTex(g.gl);
  g.gl = null;
  // its revealed tiles are cleared from roofData
  if (g.reveal > 0) setRevealMask(game, g, 0);
}

// the painting job of a region (structured-clone friendly)
function artSpec(game, g) {
  const w = game.world, W = w.W, grid = game.build.grid.roof;
  const style = new Array(g.tiles.length), det = new Int32Array(g.tiles.length);
  for (let n = 0; n < g.tiles.length; n++) {
    const o = grid.get(g.tiles[n]);
    style[n] = o?.style || ROOF_TYPE_STYLES[o?.type]?.[0] || 'thatch';
    det[n] = detBits(o?.det);
  }
  // fire sources under the roof get a chimney above them; lights make the gable windows glow at night
  const fires = [];
  g.lights = [];
  for (const o of game.build.structures) {
    const def = BUILDINGS[o.type];
    if (o.blueprint || o.moveOf || !def) continue;
    if (o.tx < g.x0 || o.tx > g.x1 || o.ty < g.y0 || o.ty > g.y1) continue;
    if (game.roofs.regionOf[w.idx(o.tx, o.ty)] !== g.id) continue;
    if (def.light || def.workLight) g.lights.push(o.id);
    if ((def.fire || def.workLight) && (def.warm || 0) >= 2.5) fires.push([o.x, o.cy ?? o.y - 0.3, o.id]); // hearths, not torches
  }
  const res = game.quality === 'low' ? 30 : game.quality === 'medium' ? 42 : 54;
  return { tiles: g.tiles.slice(), W, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, style, det, fires,
    eaveH: roofEaveH(game.build.storeysAt?.(g.x0, g.y0) || 1), res };
}

function buildArt(game, g, W) {
  g.artDirty = false;
  const spec = artSpec(game, g);
  if (W) {
    const jid = ++W.next;
    g.pending = jid;
    W.jobs.set(jid, g.id);
    W.w.postMessage({ id: jid, spec });
    return;
  }
  const t0 = performance.now();
  const art = rasterRegion(spec);
  art.ms = performance.now() - t0;
  setArt(game, g, art);
}

function setArt(game, g, art) {
  attachArt(art);
  // depth-sorted drawables (allocated once per painting): the renderer draws each slice right after the sprites in front of it
  for (const s of art.slices) s.drawable = { y: s.key, isRoof: true, slice: s, region: g, draw: drawSlice, R: game.R };
  const old = g.gl;
  g.art = art;
  g.gl = game.R?.setRoofTex ? game.R.setRoofTex(null, art) : null;
  if (old && game.R?.deleteRoofTex) game.R.deleteRoofTex(old);
  game.roofs.v++;
}
function drawSlice() { this.R.roofSlice(this.region, this.slice); }

// one painter worker per page (module worker); null when unavailable (then paint on the main thread)
function workerOf(game) {
  const R = game.roofs;
  if (R.worker !== undefined) return R.worker;
  R.worker = null;
  if (typeof Worker === 'undefined' || game.noRoofWorker) return null;
  try {
    const w = new Worker(new URL('../art/roofWorker.js', import.meta.url), { type: 'module' });
    const W = { w, next: 0, jobs: new Map() };
    w.onmessage = (ev) => {
      const { id, art, error } = ev.data || {};
      const gid = W.jobs.get(id);
      W.jobs.delete(id);
      const g = R.regions.get(gid);
      if (!g || g.pending !== id) return;
      g.pending = 0;
      if (error || !art) { console.warn('[roofs] worker', error); R.worker = null; g.artDirty = true; return; }
      art.ms = 0;
      setArt(game, g, art);
    };
    w.onerror = (e) => { console.warn('[roofs] worker failed, painting on the main thread', e?.message || e); R.worker = null; for (const g of R.regions.values()) if (g.pending) { g.pending = 0; g.artDirty = true; } };
    R.worker = W;
  } catch (e) { console.warn('[roofs] no worker', e); }
  return R.worker;
}

// ---------------- roofData (light under built roofs, revealed region, coverage) ----------------
function computeData(game, x0, y0, x1, y1) {
  const w = game.world, W = w.W, H = w.H, D = game.roofs.data, B = w.broof, S = w.solid, K = w.rock;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
  const MD = BUILT_DK.length - 1, M = MD + 1;
  const wx0 = Math.max(0, x0 - M), wy0 = Math.max(0, y0 - M), wx1 = Math.min(W - 1, x1 + M), wy1 = Math.min(H - 1, y1 + M);
  const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1, n = ww * wh;
  const dist = new Uint8Array(n).fill(255), q = new Int32Array(n);
  let qh = 0, qt = 0;
  // sky = open tile without any roof (built or natural); walls / closed doors / rock stop the light
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
    const i = y * W + x;
    if (K[i] || S[i] === 1 || B[i] || w.roof[i]) continue;
    const j = (y - wy0) * ww + (x - wx0);
    dist[j] = 0; q[qt++] = j;
  }
  while (qh < qt) {
    const j = q[qh++], d = dist[j];
    if (d >= MD) continue;
    const x = j % ww, y = (j - x) / ww;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
      const k = ny * ww + nx, i = (ny + wy0) * W + nx + wx0;
      if (dist[k] <= d + 1 || K[i] || S[i] === 1) continue;
      dist[k] = d + 1; q[qt++] = k;
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, o = i * 4;
    let dk = 0;
    if (B[i]) {
      if (S[i] === 1) { // walls under the roof: as dark as the darkest open neighbour under it
        let m = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < wx0 || ny < wy0 || nx > wx1 || ny > wy1) continue;
          const j = ny * W + nx;
          if (!B[j] || S[j] === 1) continue;
          m = Math.max(m, BUILT_DK[Math.min(MD, dist[(ny - wy0) * ww + (nx - wx0)])]);
        }
        dk = m || 1;
      } else dk = BUILT_DK[Math.min(MD, dist[(y - wy0) * ww + (x - wx0)])];
    }
    D[o] = Math.round(dk * 255);
    D[o + 2] = B[i] ? 255 : 0;
  }
  markUpload(game.roofs, x0, y0, x1, y1);
}

// G channel: revealed amount of region g's tiles (+ the ring around them, softened by the GPU filter)
function setRevealMask(game, g, k) {
  const w = game.world, W = w.W, D = game.roofs.data, v = Math.round(k * 255);
  for (const i of g.tiles) D[i * 4 + 1] = v;
  markUpload(game.roofs, g.x0, g.y0, g.x1, g.y1);
}

// ---------------- indoors (local player) ----------------
function updateIndoors(game, dt) {
  const I = game.indoors, p = game.player, w = game.world, R = game.roofs;
  let kind = null, region = 0;
  if (!p.dead) {
    const tx = Math.floor(p.x), ty = Math.floor(p.y - 0.05);
    if (w.inBounds(tx, ty)) {
      const i = ty * w.W + tx;
      if (w.broof[i]) { kind = 'built'; region = R.regionOf[i]; }
      else if (w.roof[i] && !w.rock[i]) kind = 'cave';
    }
  }
  // debounce: a doorway shuffle never flips the camera back and forth
  const key = kind ? kind + region : '';
  if (key !== I._cand) { I._cand = key; I._candT = 0; }
  I._candT += dt;
  if (I._candT >= 0.18 || (I.kind && kind && I.kind === kind)) {
    if (I.kind !== kind || I.region !== region) { I.kind = kind; I.region = region; I._maskDirty = true; }
  }
  // zoom blend (game.js) eases over ~1 s both ways; screen fx a bit faster
  const zt = I.kind ? 1 : 0;
  I._k += Math.sign(zt - I._k) * Math.min(Math.abs(zt - I._k), dt / 1.0);
  I.zoomK = I._k * I._k * (3 - 2 * I._k);
  const ek = 1 - Math.exp(-dt / 0.45);
  I.caveK += ((I.kind === 'cave' ? 1 : 0) - I.caveK) * ek;
  I.builtK += ((I.kind === 'built' ? 1 : 0) - I.builtK) * ek;
}

function updateFades(game, dt) {
  const R = game.roofs, I = game.indoors, p = game.player;
  const k = Math.min(1, dt / 0.35);
  for (const g of R.regions.values()) {
    const tr = I.kind === 'built' && I.region === g.id ? 1 : 0;
    if (g.reveal !== tr) {
      g.reveal = tr > g.reveal ? Math.min(1, g.reveal + k) : Math.max(0, g.reveal - k);
      setRevealMask(game, g, g.reveal * g.reveal * (3 - 2 * g.reveal));
    } else if (I._maskDirty && g.reveal > 0) setRevealMask(game, g, g.reveal);
    // a roof in front of the local player turns see-through
    const to = g.art && occludes(game, g, p) ? 0.32 : 1;
    g.occl += (to - g.occl) * Math.min(1, dt / 0.3);
    const rv = g.reveal * g.reveal * (3 - 2 * g.reveal);
    g.alpha = Math.min(1 - rv, g.occl);
  }
  I._maskDirty = false;
}

// does region g hide the local player? (a roof pixel in front of the player's head / chest on screen)
function occludes(game, g, p) {
  if (p.dead || game.indoors.region === g.id) return false;
  const a = g.art;
  if (p.x < a.sx0 || p.x > a.sx1 || p.y - 1.3 > a.sy1 || p.y < a.sy0) return false;
  for (const dy of [0.45, 0.95]) {
    const s = a.sliceAt(p.x, p.y - dy);
    if (s && s.key > p.y + 0.02) return true;
  }
  return false;
}

// roof slice drawn at screen-world point (x, sy) of region g, if opaque (picking: decon taps, occlusion)
export function roofPick(game, x, sy) {
  const R = game.roofs;
  if (!R) return null;
  for (const g of R.regions.values()) {
    const a = g.art;
    if (!a || g.alpha < 0.5 || x < a.sx0 || x > a.sx1 || sy < a.sy0 || sy > a.sy1) continue;
    const src = a.srcAt(x, sy);
    if (src >= 0) return { region: g, tile: src, tx: src % game.world.W, ty: (src / game.world.W) | 0 };
  }
  return null;
}

// ---------------- cosmetic fx ----------------
function smokeChimneys(game, dt) {
  const R = game.roofs, P = game.particles, A = game.A;
  if (!P || !A?.has('fx_smoke')) return;
  const spr = A.get('fx_smoke'), K = 1 / Math.max(0.01, spr.w), v = game.view();
  const wind = game.env?.wind || { x: 0, y: 0 };
  for (const g of R.regions.values()) {
    const a = g.art;
    if (!a || !a.chimneys.length || a.sx1 < v.x0 - 2 || a.sx0 > v.x1 + 2 || a.sy1 < v.y0 - 3 || a.sy0 > v.y1 + 2) continue;
    for (const c of a.chimneys) {
      const f = c.fire ? game.world.objById.get(c.fire) : null;
      const lit = f ? (f.fire !== false && f.lit !== false && (!BUILDINGS[f.type].warmWorking || f.working)) : c.always;
      if (!lit) continue;
      if (Math.random() > dt * 7) continue;
      P.emit({ spr: 'fx_smoke', x: c.x + (Math.random() - 0.5) * 0.08, y: c.y, lift: c.top + 0.05, vlift: 0.5 + Math.random() * 0.25,
        vx: wind.x * 0.55 + (Math.random() - 0.5) * 0.1, vy: wind.y * 0.3, drag: 0.25, life: 3 + Math.random() * 1.5,
        size: 0.32 * K, size1: (1.5 + Math.random() * 0.6) * K, r: 0.62, g: 0.6, b: 0.6, a: 0.34, a1: 0, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.5, fadeIn: 0.3, ground: false });
    }
  }
}

function dustFx(game, dt) {
  const R = game.roofs, P = game.particles, A = game.A;
  if (!R.fx.length) return;
  const name = A.has('fx_dust') ? 'fx_dust' : A.has('fx_smoke') ? 'fx_smoke' : null;
  if (!P || !name) { R.fx.length = 0; return; }
  const K = 1 / Math.max(0.01, A.get(name).w), pk = A.has('fx_spark') ? 'fx_spark' : name, Kp = 1 / Math.max(0.01, A.get(pk).w);
  for (let k = R.fx.length - 1; k >= 0; k--) {
    const f = R.fx[k];
    f.t += dt;
    if (f.t < 0) continue;
    R.fx.splice(k, 1);
    const c = f.cave ? [0.55, 0.53, 0.5] : [0.66, 0.56, 0.42];
    for (let j = 0; j < 3; j++) P.emit({ spr: name, x: f.x + (Math.random() - 0.5) * 0.9, y: f.y + (Math.random() - 0.5) * 0.7, lift: 0.4 + Math.random() * 1.4, vlift: -0.2,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.3, drag: 0.6, life: 1.6 + Math.random() * 1.4, size: 0.6 * K, size1: (1.8 + Math.random()) * K,
      r: c[0], g: c[1], b: c[2], a: 0.42, a1: 0, fadeIn: 0.15, ground: false });
    // falling debris (rubble / straw) from the roof height
    for (let j = 0; j < 4; j++) P.emit({ spr: pk, x: f.x + (Math.random() - 0.5) * 0.8, y: f.y + (Math.random() - 0.5) * 0.6, lift: 1.2 + Math.random() * 1.2, vlift: 0,
      grav: 9, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.4, life: 0.6 + Math.random() * 0.3, size: (0.12 + Math.random() * 0.1) * Kp, size1: 0.08 * Kp,
      r: c[0] * 0.8, g: c[1] * 0.75, b: c[2] * 0.7, a: 1, a1: 0.6 });
  }
}

// cave darkness eases toward its new value after a cave-in / opening (~1.4 s)
function easeCave(game, dt) {
  const F = game.roofs.caveFade, w = game.world;
  if (!F.size) return;
  const D = w.caveData, W = w.W;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (const [i, f] of F) {
    f.t = Math.min(1, f.t + dt / 1.4);
    const u = f.t * f.t * (3 - 2 * f.t);
    D[i * 4] = Math.round(f.a + (f.b - f.a) * u);
    const x = i % W, y = (i - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (f.t >= 1) F.delete(i);
  }
  if (x1 >= 0) w._markCaveDirty(x0, y0, x1, y1);
}

// is the point (feet) under a roof that is fully opaque right now? (its contents need not be drawn)
export function underOpaqueRoof(game, x, y) {
  const R = game.roofs, w = game.world;
  if (!R || !R.regions.size) return false;
  const tx = Math.floor(x), ty = Math.floor(y - 0.05);
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return false;
  const i = ty * w.W + tx;
  if (!w.broof[i]) return false;
  const g = R.regions.get(R.regionOf[i]);
  return !!(g && g.art && g.alpha >= 0.985);
}

// height of the built roof surface over tile (tx, ty) (eave height when unknown)
export function roofHeightAt(game, tx, ty) {
  const R = game.roofs, w = game.world;
  if (!R || !w.inBounds(tx, ty)) return roofEaveH();
  const i = w.idx(tx, ty), g = R.regions.get(R.regionOf[i]), a = g?.art;
  if (!a) return roofEaveH();
  let lo = 0, hi = a.tiles.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = a.tiles[m]; if (v === i) return a.tileH[m]; if (v < i) lo = m + 1; else hi = m - 1; }
  return roofEaveH();
}

// for roof props drawn as sprites (agent K): lift above the ground, depth-sort key (draw at y = key + 0.001) and the
// region's alpha (fades with the roof). null when no finished, painted roof covers the tile.
export function roofPropAt(game, tx, ty) {
  const R = game.roofs, w = game.world;
  if (!R || !w.inBounds(tx, ty)) return null;
  const g = R.regions.get(R.regionOf[w.idx(tx, ty)]), a = g?.art;
  if (!a) return null;
  const s = a.slices.find((q) => q.col === tx && ty >= q.ya && ty <= q.yb);
  return { lift: roofHeightAt(game, tx, ty), key: s ? s.key : ty + 1, alpha: g.alpha };
}

export { DET };
