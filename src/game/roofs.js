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
//     open doors), G = revealed (the region the local player is under, faded), B = built roof coverage,
//     A = cave ceiling drawn over the tile, G on cave tiles = its cracks (see "cave ceilings");
//   - game.indoors = { kind: null | 'cave' | 'built', region (built region / cave id), zoomK, caveK, builtK } for the local player
//     (camera zoom lock in game.js, screen effects in the post shader, audio / survival read world.roofAt);
//   - fades: the region the local player is under fades out (~0.35 s); a roof in front of the player goes
//     see-through (0.32); chimneys smoke while a fire burns under them; cave-ins and collapses kick up dust.
//   - camera turned (game.cam.rot ≠ 0, docs/CAMERA-ROTATION.md): each region as true 3D pieces (art/roofFacets.js:
//     exact facets textured with a plan-view painting, fascia / bargeboards / steps, gables with windows that glow,
//     chimneys, weathervane), painted in the worker once the camera has turned (a flat-coloured stand-in until then),
//     drawn as view columns depth-sorted with the sprites, ray-cast for picking / occlusion, shadows as ground faces.

import { BUILDINGS } from './data.js';
import { ROOF_GEOM, ROOF_STYLES, ROOF_TYPE_STYLES, roofEaveH, DET, detBits } from './content/roofs.js';
import { roofArtStyle } from './content/kits.js'; // agent K: style overrides from the Detalhes kit
import { rasterRegion, attachArt, roofShape } from '../art/roofRaster.js';
import { turnedGeom, turnedView, rasterTurned } from '../art/roofFacets.js'; // camera rotation: roofs as 3D pieces
import { CAMV } from '../art/archCompose.js';

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
  game.roofs.collapsing = new Set(); // tiles whose roof just fell (cosmetic: the old painting drops and fades)
  // camera rotation: paint the turned art (3D pieces) too — from the first turn on, or from the start for a player who
  // turned the camera in an earlier session (local preference, cosmetic)
  try { game.roofs.turned = typeof localStorage !== 'undefined' && localStorage.getItem('wos.roofTurn') === '1'; } catch { game.roofs.turned = false; }
  game.roofs.falling = [];           // [{ g, t }] old paintings dropping
  // cave ceilings (cosmetic, see "cave ceilings" below)
  Object.assign(game.roofs, { caveOf: new Int32Array(N), caves: new Map(), caveNext: 1, caveDirty: new Set(), caveAll: true, crumble: new Map(), cracks: new Map(), peek: new Map() });
  game.indoors = { kind: null, region: 0, zoomK: 0, caveK: 0, builtK: 0, _cand: null, _candT: 0, _k: 0 };
  // for fx modules (no import of game code): hidden by an opaque built roof or by a cave ceiling
  game.roofs.hidden = (x, y) => underOpaqueRoof(game, x, y) || underCaveCeiling(game, x, y);
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
  if ((def?.fire || def?.warm || def?.workLight || (R.turned && def?.connect === 'wall')) && !o.moveOf) for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) if (w.inBounds(x, y)) R.artDirty.add(w.idx(x, y)); // (walls: the eave shadow of the turned pieces)
  markData(R, o.tx - 6, o.ty - 6, o.tx + (o.fw || 1) + 6, o.ty + (o.fh || 1) + 6);
}
// rock mined: a support of nearby built roofs may be gone; the indoor light changes
export function onRockMined(game, tx, ty) {
  const R = game.roofs;
  if (!R) return;
  R.supportDirty.push([tx, ty, tx, ty]);
  markData(R, tx - 8, ty - 8, tx + 8, ty + 8);
  // cosmetic: the caves change (a new cave tile, tiles that lost the natural roof — world.lastLost of this mining)
  R.caveDirty.add(game.world.idx(tx, ty));
  for (const j of game.world.lastLost) R.caveDirty.add(j);
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
export function enclosedRoom(game, tx, ty, max = 220, info = null) { // info.big: gave up because the room is larger than max
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
      if (seen.size > max) { if (info) info.big = true; return null; }
      q.push(j);
    }
  }
  const out = [];
  for (const i of [...seen, ...ring]) out.push([i % W, (i / W) | 0]);
  return out;
}

// ---------------- cosmetic: collapse / cave-in dust ----------------
// tiles: [[tx, ty, col?]] or tile indices; col = roof colour (debris)
export function collapseFx(game, tiles, { big = false, cave = false, quiet = false } = {}) {
  const J = game.juice, w = game.world, R = game.roofs;
  let cx = 0, cy = 0;
  if (cave && R) {
    // a cave ceiling: cracks spread, then it breaks tile by tile from the middle outwards (caveCrumble)
    for (const t of tiles) { cx += t[0] + 0.5; cy += t[1] + 0.5; }
    if (!tiles.length) return;
    cx /= tiles.length; cy /= tiles.length;
    caveCrumble(game, tiles, cx, cy, quiet);
    if (quiet) return [cx, cy];
    const near = Math.hypot(game.cam.x - cx, game.cam.y - cy);
    if (near < 22) game.juice?.shake?.(Math.min(0.6, (big ? 0.55 : 0.3) * (1 - near / 26)));
    game.audio?.play('cave_in', { x: cx, y: cy });
    return [cx, cy];
  }
  const n = Math.min(tiles.length, 70);
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    const x = Array.isArray(t) ? t[0] : t % w.W, y = Array.isArray(t) ? t[1] : (t / w.W) | 0;
    cx += x + 0.5; cy += y + 0.5;
    if (R && !cave) R.collapsing.add(w.idx(x, y)); // its painting falls down (rebuildRegions)
    if (k >= n) continue;
    const col = (Array.isArray(t) && t[2]) || (cave ? [0.58, 0.55, 0.5] : [0.62, 0.5, 0.34]);
    J?.puff(x + 0.5, y + 0.6, cave ? 6 : 5, col, 1.2);
    J?.chips(x + 0.5, y + 0.5, col, 6, 1.1);
    if (R) R.fx.push({ x: x + 0.5, y: y + 0.5, t: -Math.random() * 0.25, cave, col });
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
  let artT = 0, smokeAcc = 0, moteAcc = 0;
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
      if (R.caveAll || R.caveDirty.size) rebuildCaves(game);
      updateIndoors(game, dt);
      updateFades(game, dt);
      updateCaves(game, dt);
      for (let k = R.falling.length - 1; k >= 0; k--) {
        const g = R.falling[k];
        g.falling += dt;
        g.dropY = Math.min(1.6, 4.9 * g.falling * g.falling);
        g.alpha = Math.max(0, 1 - g.falling / 0.55);
        if (g.falling > 0.6) { R.falling.splice(k, 1); disposeRegion(game, g); }
      }
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
        // camera rotation: once the camera has turned, every region also gets its turned art (3D pieces, roofFacets.js)
        if (!R.turned && (game.cam?.rot || game.cam?.rotTo)) { R.turned = true; try { localStorage.setItem('wos.roofTurn', '1'); } catch { /* ignore */ } }
        if (R.turned) {
          tmpList.length = 0;
          for (const g of R.regions.values()) if (g.spec && !g.artDirty && !g.pending && !g.tpending && g.tspec !== g.spec) tmpList.push(g);
          if (tmpList.length) {
            const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
            tmpList.sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy));
            const W = workerOf(game);
            for (const g of tmpList) {
              if (W ? W.jobs.size >= MAX_JOBS : performance.now() - t0 > ART_BUDGET_MS) break;
              buildTurned(game, g, W);
            }
          }
        }
      }
      // chimney smoke while a fire burns under the roof
      smokeAcc += dt;
      if (smokeAcc > 0.12) { smokeChimneys(game, smokeAcc); smokeAcc = 0; }
      dustFx(game, dt);
      // caves: fine dust motes drifting through the dim air around the player (cosmetic)
      const I = game.indoors, P = game.particles;
      if (I.caveK > 0.3 && P && game.A?.has('fx_spark')) {
        moteAcc += dt * 5 * I.caveK;
        const p = game.player, K = 1 / Math.max(0.01, game.A.get('fx_spark').w);
        while (moteAcc > 1) {
          moteAcc -= 1;
          const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * 4.5;
          P.emit({ spr: 'fx_spark', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d * 0.75, lift: 0.2 + Math.random() * 1.5, vx: (Math.random() - 0.5) * 0.07, vy: (Math.random() - 0.5) * 0.05,
            vlift: (Math.random() - 0.45) * 0.05, drag: 0.1, life: 4 + Math.random() * 4, size: (0.05 + Math.random() * 0.05) * K, size1: 0.04 * K,
            r: 0.86, g: 0.84, b: 0.78, a: 0.22, a1: 0, fadeIn: 1.4, layer: 'emissive', ground: false });
        }
      }
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
      if (!R || (!R.regions.size && !(game.cam?.rot && R.falling.length))) return;
      if (game.cam?.rot) {
        // camera turned: each roof as 3D pieces in view columns, depth-sorted with the sprites (turnedDraws); while the
        // camera turns, the views are recomputed within a budget per frame, the stalest first
        const rot = game.cam.rot, q = Math.round(rot / ROT_Q), todo = tmpList;
        todo.length = 0;
        for (const g of R.regions.values()) {
          if (g.alpha <= 0.004 || g.x1 + 3 < v.x0 || g.x0 - 3 > v.x1 || g.y1 + 3 < v.y0 || g.y0 - 3 > v.y1) continue;
          todo.push(g);
        }
        for (const g of R.falling) todo.push(g);
        todo.sort((a, b) => (b._tv ? Math.abs(b._tv.q - q) : 1e9) - (a._tv ? Math.abs(a._tv.q - q) : 1e9));
        const t0 = performance.now();
        for (const g of todo) {
          const T = turnedDraws(game, g, rot, performance.now() - t0 > VIEW_BUDGET_MS);
          if (T) for (const d of T) list.push(d);
        }
        todo.length = 0;
        return;
      }
      for (const g of R.regions.values()) {
        const a = g.art;
        if (!a || a.sx1 < v.x0 - 1 || a.sx0 > v.x1 + 1 || a.sy1 < v.y0 - 1 || a.sy0 > v.y1 + 1) continue;
        if (g.alpha <= 0.004) continue;
        for (const s of a.slices) if (s.x1 > v.x0 - 1 && s.x0 < v.x1 + 1 && s.y1 > v.y0 - 1 && s.y0 < v.y1 + 1) { s.drawable.region = g; list.push(s.drawable); }
      }
      for (const g of R.falling) for (const s of g.art.slices) { s.drawable.region = g; list.push(s.drawable); }
    },
    render(game, B, v, env) {
      const R = game.roofs;
      if (!R || !R.regions.size || !B.shadow) return;
      // sun-shadow casters: a vertical card + a lifted lid per tile (the roof volume, union by MAX blend)
      const A = game.A, top = A.has('fx_solid') ? A.get('fx_solid') : null, card = A.has('fx_solid_b') ? A.get('fx_solid_b') : null;
      if (!top || !card) return;
      const w = game.world, sx0 = v.x0 - 4, sx1 = v.x1 + 4, sy0 = v.y0 - 3, sy1 = v.y1 + 4;
      if (game.cam?.rot && B.shadowFaces) { turnedShadows(game, B, env, sx0, sy0, sx1, sy1); return; } // (window glows: in the pieces)
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
        if (!regionLit(game, g)) continue;
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
      g.tart = best.tart; g.tgl = best.tgl; g.tgeom = best.tgeom; g.tshape = best.tshape; // (camera rotation: the old pieces meanwhile)
    }
    R.regions.set(id, g);
  }
  for (const o of olds) {
    if (o.taken) continue;
    if (o.art && o.gl && [...o.tiles].some((i) => R.collapsing.has(i))) { o.falling = 0; o.dropY = 0; R.falling.push(o); continue; }
    disposeRegion(game, o);
  }
  R.collapsing.clear();
  R.v++;
  // the revealed mask follows the region under the player (re-evaluated next frame)
  game.indoors._maskDirty = true;
}

function disposeRegion(game, g) {
  if (g.gl && game.R?.deleteRoofTex) game.R.deleteRoofTex(g.gl);
  if (g.tgl && game.R?.deleteRoofTex) game.R.deleteRoofTex(g.tgl);
  g.gl = null; g.tgl = null;
  // its revealed tiles are cleared from roofData
  if (g.reveal > 0) setRevealMask(game, g, 0);
}

// the painting job of a region (structured-clone friendly)
function artSpec(game, g) {
  const w = game.world, W = w.W, grid = game.build.grid.roof;
  const style = new Array(g.tiles.length), det = new Int32Array(g.tiles.length), styles = {}, walls = new Uint8Array(g.tiles.length);
  for (let n = 0; n < g.tiles.length; n++) {
    const wo = game.build.grid.main.get(g.tiles[n]);
    walls[n] = wo && !wo.blueprint && BUILDINGS[wo.type]?.connect === 'wall' ? 1 : 0; // (camera turned: the eave shadow on it)
    const o = grid.get(g.tiles[n]);
    const ka = o ? roofArtStyle(o) : null; // agent K: derived style (ends, gable, ridge, boards, tone…)
    if (ka) { styles[ka.key] ||= ka.style; style[n] = ka.key; } else style[n] = o?.style || ROOF_TYPE_STYLES[o?.type]?.[0] || 'thatch';
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
  return { tiles: g.tiles.slice(), W, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, style, styles, det, fires, walls,
    eaveH: roofEaveH(game.build.storeysIn?.(g.tiles) || game.build.storeysAt?.(g.x0, g.y0) || 1), res }; // agent L: highest story of the region
}

function buildArt(game, g, W) {
  g.artDirty = false;
  const spec = artSpec(game, g);
  g.spec = spec; // (camera rotation: the 3D pieces come from the same spec, roofFacets.js)
  const turned = !!game.roofs.turned;
  if (W) {
    const jid = ++W.next;
    g.pending = jid;
    if (turned) g.tpending = jid;
    W.jobs.set(jid, { gid: g.id, spec });
    W.w.postMessage({ id: jid, spec, mode: turned ? 3 : 1 });
    return;
  }
  const t0 = performance.now();
  const art = rasterRegion(spec);
  art.ms = performance.now() - t0;
  setArt(game, g, art);
  if (turned) setTurned(game, g, rasterTurned(spec), spec);
}
// camera rotation: the turned art of a region painted for the north view only so far
function buildTurned(game, g, W) {
  const spec = g.spec;
  if (W) {
    const jid = ++W.next;
    g.tpending = jid;
    W.jobs.set(jid, { gid: g.id, spec });
    W.w.postMessage({ id: jid, spec, mode: 2 });
    return;
  }
  setTurned(game, g, rasterTurned(spec), spec);
}
function setTurned(game, g, tart, spec) {
  const old = g.tgl;
  g.tart = tart; g.tgeom = tart.geom; g.tspec = spec; g.tshape = null;
  g.tgl = game.R?.roofFaceTex ? game.R.roofFaceTex(tart) : null;
  // (the old texture may still be shown by a falling old region: that one disposes its own)
  if (old && game.R?.deleteRoofTex && !game.roofs.falling.some((f) => f.tgl === old)) game.R.deleteRoofTex(old);
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

// ---------------- camera rotation: the roof as 3D pieces (art/roofFacets.js) ----------------
// The pieces of a region (turnedGeom: exact facets textured with a plan-view painting, fascia / bargeboards / steps,
// gables with windows, chimneys, the weathervane) with their painted atlas (rasterTurned, in the worker once the camera
// has turned); until the atlas arrives, a flat-coloured stand-in from the same geometry. Per camera angle (0.25° steps,
// cached) turnedView gives what faces the camera, in a painter's order, cut into view columns one tile wide: each column
// is a drawable depth-sorted with the sprites (key = the front-most point of its pieces, clamped into the walls).
const ROT_Q = Math.PI / 720;
const VIEW_BUDGET_MS = 2.5; // per frame for recomputing the views of the roofs in sight while the camera turns
let geomT = -1, geomMs = 0;
function regionGeom(game, g) {
  if (g.tgeom && (g.tart || g.tgeomSpec === g.spec)) return g.tgeom;
  if (!g.spec) return g.tgeom || null;
  // the stand-in's geometry on the main thread (a few ms per frame at most)
  if (geomT !== game.time) { geomT = game.time; geomMs = 0; }
  if (geomMs > 6) return g.tgeom || null;
  const t0 = performance.now();
  g.tgeom = turnedGeom(g.spec); g.tgeomSpec = g.spec;
  geomMs += performance.now() - t0;
  return g.tgeom;
}
// the shape of a region (picking / occlusion while turned)
function regionShape(g) {
  if (!g.spec) return null;
  if (!g.tshape || g.tshape.spec !== g.spec) { g.tshape = roofShape(g.spec); g.tshape.spec = g.spec; }
  return g.tshape;
}
function turnedDraws(game, g, rot, late = false) {
  const G = regionGeom(game, g);
  if (!G) return null;
  const q = Math.round(rot / ROT_Q);
  let T = g._tv;
  if (!T || T.G !== G || (T.q !== q && !late)) { // (late: over this frame's budget — last frame's view, a step behind)
    // (keys relative to the region's middle: corrected to the exact angle every frame, colDepth — an absolute depth at
    // the quantized angle would be off by the angle step × the distance from the world's origin)
    const a = q * ROT_Q, c = Math.cos(a), s = Math.sin(a), V = turnedView(G, c, s);
    const cx = (g.x0 + g.x1 + 1) / 2, cy = (g.y0 + g.y1 + 1) / 2, base = -s * cx + c * cy;
    T = g._tv = { q, G, draws: V.cols.map((col) => ({ isRoof: true, region: g, game, key: col.key - base, cx, cy, pieces: col.pieces, draw: drawRoofCol, zkRot: colDepth })) };
  }
  return T.draws;
}
function colDepth(rc, rs) { return this.key + (-rs * this.cx + rc * this.cy); }
// one view column of a roof: its pieces in order (painted atlas, or the flat stand-in), vertical ones shaded like the
// walls (art/archCompose: the light's side), window glows on the glow layer at night while a light burns inside
function drawRoofCol(B) {
  const g = this.region, game = this.game, R = game.R, F = B.faces;
  const al = g.alpha ?? 1;
  if (!F || !R.setFaceTex || al <= 0.004) return;
  const tex = g.tgl && g.tart && g.tgeom === g.tart.geom ? g.tgl : null;
  let su = -1, sv = 0;
  if (!tex) { const A = game.A; if (!A.has('fx_solid')) return; const sp = A.get('fx_solid'); su = (sp.u0 + sp.u1) / 2; sv = (sp.v0 + sp.v1) / 2; }
  R.setFaceTex(tex);
  const dh = g.dropY || 0, t = game.time;
  const night = game.env?.env?.night || 0;
  const glow = !!tex && night >= 0.15 && al >= 0.3 && regionLit(game, g);
  const lx = CAMV.lx, ly = CAMV.ly;
  for (const pc of this.pieces) {
    let r = 1, gg = 1, b = 1, a = al;
    if (pc.glow) {
      if (!glow) continue;
      const fl = 0.85 + 0.15 * Math.sin(t * 7 + pc.p[0] * 3) * Math.sin(t * 4.3 + pc.p[1]);
      gg = 0.66; b = 0.3; a = -0.55 * night * al * fl;
    } else if (pc.dark) { if (!tex) continue; r = gg = b = 0; }
    else {
      const k = pc.vert ? 0.8 - 0.2 * (pc.n[0] * lx + pc.n[1] * ly) : 1;
      if (tex && !pc.tint) r = gg = b = k; else { r = pc.col[0] * k; gg = pc.col[1] * k; b = pc.col[2] * k; }
    }
    facePoly(F, pc.p, r, gg, b, a, dh, su, sv);
  }
}
// a convex polygon of (x, y, h, u, v) vertices as a fan of quads (su ≥ 0: one solid texel instead of its uv)
function facePoly(F, p, r, g, b, a, dh, su, sv) {
  const n = (p.length / 5) | 0;
  const own = su < 0;
  for (let i = 1; i + 1 < n; i += 2) {
    const j = Math.min(i + 2, n - 1), o = 5 * i, q = 5 * (i + 1), m = 5 * j;
    F.quad4(p[0], p[1], p[2] - dh, own ? p[3] : su, own ? p[4] : sv,
      p[o], p[o + 1], p[o + 2] - dh, own ? p[o + 3] : su, own ? p[o + 4] : sv,
      p[q], p[q + 1], p[q + 2] - dh, own ? p[q + 3] : su, own ? p[q + 4] : sv,
      p[m], p[m + 1], p[m + 2] - dh, own ? p[m + 3] : su, own ? p[m + 4] : sv, r, g, b, a);
  }
}
// sun shadows while turned: the roof's pieces and the walls' volume under it projected on the ground along the sun
// (renderer batches.shadowFaces, MAX blend like the sprite casters): right at any camera angle
function turnedShadows(game, B, env, x0, y0, x1, y1) {
  const R = game.roofs, F = B.shadowFaces, A = game.A;
  if (!A.has('fx_solid')) return;
  const sp = A.get('fx_solid'), su = (sp.u0 + sp.u1) / 2, sv = (sp.v0 + sp.v1) / 2;
  const sd = env?.shadowDir || [0, 0], sx = sd[0], sy = sd[1];
  const P = [];
  const proj = (p) => { P.length = 0; for (let i = 0; i < p.length; i += 5) P.push(p[i] + sx * p[i + 2], p[i + 1] + sy * p[i + 2], 0, su, sv); return P; };
  for (const g of R.regions.values()) {
    if (g.x1 + 1 < x0 || g.x0 > x1 || g.y1 + 1 < y0 || g.y0 > y1) continue;
    const k = Math.min(1, (g.alpha ?? 1) * 1.4);
    if (k < 0.05) continue;
    const G = regionGeom(game, g);
    if (!G) continue;
    for (const it of G.items) {
      if (it.k !== 'f' && it.k !== 'g' && it.k !== 'c' && it.k !== 'v') continue;
      for (const pl of it.polys) facePoly(F, proj(pl.p), 1, 0, 1, k, 0, -1, 0);
    }
    const He = G.He;
    for (const [X0, Y0, X1, Y1] of G.rects) for (const [ax, ay, bx, by] of [[X0, Y1, X1, Y1], [X1, Y0, X0, Y0], [X1, Y1, X1, Y0], [X0, Y0, X0, Y1]]) {
      facePoly(F, proj([ax, ay, He, 0, 0, bx, by, He, 0, 0, bx, by, 0, 0, 0, ax, ay, 0, 0, 0]), 1, 0, 1, k, 0, -1, 0);
    }
  }
}
// camera turned: a flat tile mark at height h over tile (tx, ty) as a face that turns with the world (roof plans, the
// roof ghost, a finished roof tile marked for deconstruction — game/building.js); drape: laid on the roof's surface.
// false when it cannot (the caller draws its sprite as always).
export function roofTileFace(game, B, spr, tx, ty, h, r, g, b, a, drape = false) {
  if (!game.cam?.rot || !B.faces || !game.R?.setFaceTex || !spr) return false;
  game.R.setFaceTex(null);
  const R = game.roofs, w = game.world, rg = drape && R && w.inBounds(tx, ty) ? R.regions.get(R.regionOf[w.idx(tx, ty)]) : null, S = rg && regionShape(rg);
  if (!S) { B.faces.quad(tx, ty, h, tx + 1, ty, h, tx + 1, ty + 1, h, tx, ty + 1, h, [spr.u0, spr.v0, spr.u1, spr.v1], r, g, b, a); return true; }
  // laid on the roof: four quarters, each corner on the surface (the tile folds over a ridge / hip)
  const at = (x, y) => { const v = S.surf(x, y); return v > -1e8 ? v + 0.03 : h; };
  const X = [tx + 0.002, tx + 0.5, tx + 0.998], Y = [ty + 0.002, ty + 0.5, ty + 0.998], U = [spr.u0, (spr.u0 + spr.u1) / 2, spr.u1], V = [spr.v0, (spr.v0 + spr.v1) / 2, spr.v1];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    B.faces.quad(X[i], Y[j], at(X[i], Y[j]), X[i + 1], Y[j], at(X[i + 1], Y[j]), X[i + 1], Y[j + 1], at(X[i + 1], Y[j + 1]), X[i], Y[j + 1], at(X[i], Y[j + 1]), [U[i], V[j], U[i + 1], V[j + 1]], r, g, b, a);
  }
  return true;
}
// the ground point drawn under a screen point lifted h up the screen: the ground point (wx, wy) of game.screenToWorld
// seen as something at height h (roof plans at eave height: picking them while the camera is turned too)
export function liftedPoint(game, wx, wy, h) {
  const r = game.cam?.rot || 0;
  return r ? [wx - Math.sin(r) * h, wy + Math.cos(r) * h] : [wx, wy + h];
}
// camera turned: does the roof hide the local player? (a ray from the player's chest / head on screen toward the camera
// meets the roof's surface in front of the player)
function occludesTurned(game, g, p) {
  if (p.dead || game.indoors.region === g.id) return false;
  if (p.x < g.x0 - 5 || p.x > g.x1 + 6 || p.y < g.y0 - 5 || p.y > g.y1 + 6) return false;
  const S = regionShape(g);
  if (!S) return false;
  const r = game.cam.rot || 0, c = Math.cos(r), s = Math.sin(r), top = S.He + S.maxRise + 0.1;
  for (const dh of [0.45, 0.95]) {
    const gx = p.x + s * dh, gy = p.y - c * dh;
    for (let t = top; t > dh + 0.05; t -= 0.05) if (S.surf(gx - s * t, gy + c * t) >= t) return true;
  }
  return false;
}
// camera turned: the roof tile under a screen point (x, y = the ground point under it, game.screenToWorld): a ray
// toward the camera (up the screen = up in height) through every region; the front-most hit wins
function roofPickTurned(game, x, y) {
  const R = game.roofs, rot = game.cam.rot || 0, c = Math.cos(rot), s = Math.sin(rot), W = game.world.W;
  let best = null, bt = -1;
  for (const g of R.regions.values()) {
    if (g.alpha < 0.5) continue;
    const S = regionShape(g);
    if (!S) continue;
    const top = S.He + S.maxRise + 0.1, ex = x - s * top, ey = y + c * top;
    if (Math.max(x, ex) < g.x0 - 1 || Math.min(x, ex) > g.x1 + 2 || Math.max(y, ey) < g.y0 - 1 || Math.min(y, ey) > g.y1 + 2) continue;
    for (let t = top; t >= 0; t -= 0.04) {
      const px = x - s * t, py = y + c * t;
      if (S.surf(px, py) < t - 0.05) continue; // (the roof's slab and fascia have some thickness: its edges count)
      if (t > bt) { const n = S.tileIn(S.rects[S.K], px, py), i = S.T[n]; bt = t; best = { region: g, tile: i, tx: i % W, ty: (i / W) | 0 }; }
      break;
    }
  }
  return best;
}

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
      const { id, art, tart, error } = ev.data || {};
      const job = W.jobs.get(id);
      W.jobs.delete(id);
      const g = job && R.regions.get(job.gid);
      if (!g) return;
      if (error) {
        console.warn('[roofs] worker', error); R.worker = null;
        if (g.pending === id) { g.pending = 0; g.artDirty = true; }
        if (g.tpending === id) g.tpending = 0;
        return;
      }
      if (art && g.pending === id) { g.pending = 0; art.ms = 0; setArt(game, g, art); }
      if (tart && g.tpending === id) { g.tpending = 0; setTurned(game, g, tart, job.spec); }
    };
    w.onerror = (e) => { console.warn('[roofs] worker failed, painting on the main thread', e?.message || e); R.worker = null; for (const g of R.regions.values()) { if (g.pending) { g.pending = 0; g.artDirty = true; } g.tpending = 0; } };
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
      else if (w.roof[i] && !w.rock[i]) { kind = 'cave'; region = R.caveOf[i]; } // (the cave whose ceiling fades)
      else if (game.levels?.hasUpper) {
        // under an upper floor (agent L's slab: a second story, a balcony) — indoors for the camera too (no roof region)
        const V = Math.round(p.z || 0), N = w.W * w.H;
        for (let k = V + 1; k <= 3 && !kind; k++) { const f = game.build.grid.floor.get(i + k * N); if (f && !f.blueprint && !BUILDINGS[f.type]?.roof) { kind = 'built'; region = -1; } }
      }
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
    const to = g.art && (game.cam?.rot ? occludesTurned(game, g, p) : occludes(game, g, p)) ? 0.32 : 1;
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
  if (game.cam?.rot) return roofPickTurned(game, x, sy);
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
    // a chimney over a hearth smokes while it burns; a chimney added as a roof detail smokes while any hearth of
    // the house burns ("solta fumaça quando há fogo embaixo") — never on its own
    const fireLit = (id) => { const f = game.world.objById.get(id); return !!f && f.fire !== false && f.lit !== false && (!BUILDINGS[f.type].warmWorking || f.working); };
    const anyFire = a.chimneys.some((c) => c.fire && fireLit(c.fire));
    if (!anyFire) continue;
    for (const c of a.chimneys) {
      const lit = c.fire ? fireLit(c.fire) : anyFire;
      if (!lit) continue;
      if (Math.random() > dt * 7) continue;
      const cy = game.cam?.rot ? c.y - 0.13 : c.y; // (turned: out of the flue's middle, not its front face)
      P.emit({ spr: 'fx_smoke', x: c.x + (Math.random() - 0.5) * 0.08, y: cy, lift: c.top + 0.05, vlift: 0.5 + Math.random() * 0.25,
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
    const c = f.cave ? [0.6, 0.56, 0.5] : [0.68, 0.6, 0.48], rc = f.col || c;
    // a billowing cloud from the ground and from where the roof was
    for (let j = 0; j < 4; j++) P.emit({ spr: name, x: f.x + (Math.random() - 0.5) * 1.1, y: f.y + (Math.random() - 0.5) * 0.9, lift: j < 2 ? 0.15 : 0.8 + Math.random() * 1.6, vlift: j < 2 ? 0.35 : -0.15,
      vx: (Math.random() - 0.5) * 1.1, vy: (Math.random() - 0.5) * 0.6, drag: 0.7, life: 2 + Math.random() * 1.8, size: 0.9 * K, size1: (2.6 + Math.random() * 1.2) * K,
      r: c[0], g: c[1], b: c[2], a: f.cave ? 0.68 : 0.55, a1: 0, fadeIn: 0.12, ground: false });
    // falling debris (tiles / straw / rubble) from the roof height
    for (let j = 0; j < 6; j++) P.emit({ spr: pk, x: f.x + (Math.random() - 0.5) * 0.9, y: f.y + (Math.random() - 0.5) * 0.7, lift: 1 + Math.random() * 1.8, vlift: Math.random() * 0.8,
      grav: 9, vx: (Math.random() - 0.5) * 1.4, vy: (Math.random() - 0.5) * 0.6, life: 0.7 + Math.random() * 0.4, size: (0.16 + Math.random() * 0.14) * Kp, size1: 0.1 * Kp,
      r: rc[0] * 0.9, g: rc[1] * 0.85, b: rc[2] * 0.8, a: 1, a1: 0.7, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9 });
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

// ---------------- cave ceilings (cosmetic) ----------------
// A cave = 4-connected mined tiles under the natural roof (world.isCave). The terrain shader draws a ceiling over
// every cave the local player is not inside (roofData A = coverage): from outside a cave reads as a lower, earthier
// part of the mountain, and what is inside stays hidden (underCaveCeiling → roofs.hidden: sprites, labels, picking,
// aim, lights). The cave the local player enters fades out (~0.35 s); standing at its mouth, the player sees a few
// tiles into it (peek: nothing can bite from under the ceiling unseen). A cave-in (world.lastLost) plays as cracks
// running over the ceiling (roofData G on cave tiles), then the ceiling breaking tile by tile from the middle of the
// lost section outwards (each tile's chunks drop one by one), pieces falling and a dust cloud; cracks linger on the
// ceiling left around the hole.
// Everything here derives from the shared rock / roof grids, so every peer shows the same caves.
const CRACK_T = 0.42;   // cracks spreading before the first tile breaks
const BREAK_T = 0.35;   // a tile's ceiling crumbling away (its chunks drop one by one, terrain shader)
const isCaveTile = (w, i) => w.roof[i] === 1 && w.rock[i] === 0;

function rebuildCaves(game) {
  const R = game.roofs, w = game.world, W = w.W, CO = R.caveOf, D = R.data;
  const seeds = [], olds = [];
  if (R.caveAll) {
    R.caveAll = false;
    for (const g of R.caves.values()) olds.push(g);
    R.caves.clear(); CO.fill(0);
    for (let i = 0; i < CO.length; i++) if (isCaveTile(w, i)) seeds.push(i); else if (D[i * 4 + 3] && !R.crumble.has(i)) D[i * 4 + 3] = 0;
    markUpload(R, 0, 0, W - 1, w.H - 1);
  } else {
    const aff = new Set();
    for (const i of R.caveDirty) {
      seeds.push(i);
      const x = i % W;
      for (const j of [i, i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= CO.length || (j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
        if (CO[j]) aff.add(CO[j]);
      }
    }
    for (const id of aff) {
      const g = R.caves.get(id);
      if (!g) continue;
      for (const i of g.tiles) { if (CO[i] === id) CO[i] = 0; seeds.push(i); }
      R.caves.delete(id);
      olds.push(g);
    }
  }
  R.caveDirty.clear();
  const q = [];
  for (const s of seeds) {
    if (!isCaveTile(w, s)) {
      // left every cave (its roof fell, or the snapshot changed it): no ceiling unless it is still crumbling
      if (D[s * 4 + 3] && !R.crumble.has(s)) { D[s * 4 + 3] = 0; markUpload(R, s % W, (s / W) | 0, s % W, (s / W) | 0); }
      continue;
    }
    if (CO[s]) continue;
    const id = R.caveNext++, tiles = [];
    CO[s] = id; q.length = 0; q.push(s);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i - x) / W;
      tiles.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !CO[i - 1] && isCaveTile(w, i - 1)) { CO[i - 1] = id; q.push(i - 1); }
      if (x < W - 1 && !CO[i + 1] && isCaveTile(w, i + 1)) { CO[i + 1] = id; q.push(i + 1); }
      if (y > 0 && !CO[i - W] && isCaveTile(w, i - W)) { CO[i - W] = id; q.push(i - W); }
      if (y < w.H - 1 && !CO[i + W] && isCaveTile(w, i + W)) { CO[i + W] = id; q.push(i + W); }
    }
    // keep the fade of the cave it grew from / split off (no flash while the player digs inside it)
    let reveal = 0;
    for (const o of olds) {
      if (o.reveal <= reveal || o.x1 < x0 || o.x0 > x1 || o.y1 < y0 || o.y0 > y1) continue;
      for (const i of o.tiles) if (CO[i] === id) { reveal = o.reveal; break; }
    }
    R.caves.set(id, { id, tiles: Int32Array.from(tiles), x0, y0, x1, y1, reveal, av: -1 });
  }
}

// per frame: the fade of each cave's ceiling, the crumbling tiles of cave-ins, lingering cracks
function updateCaves(game, dt) {
  const R = game.roofs, I = game.indoors, w = game.world, D = R.data, W = w.W;
  const k = Math.min(1, dt / 0.35);
  for (const g of R.caves.values()) {
    const tr = I.kind === 'cave' && I.region === g.id ? 1 : 0;
    if (g.reveal !== tr) g.reveal = tr > g.reveal ? Math.min(1, g.reveal + k) : Math.max(0, g.reveal - k);
    const e = g.reveal * g.reveal * (3 - 2 * g.reveal), v = Math.round(255 * (1 - e));
    if (v === g.av) continue;
    g.av = v;
    for (const i of g.tiles) D[i * 4 + 3] = w.broof[i] ? 0 : Math.min(v, R.peek.get(i) ?? 255);
    markUpload(R, g.x0, g.y0, g.x1, g.y1);
  }
  peekCaves(game);
  for (const [i, c] of R.crumble) {
    c.t += dt;
    let a, gc;
    if (c.t < 0) {
      a = c.a;
      gc = Math.max(c.g, Math.round(255 * Math.min(1, Math.max(0, 1 + c.t / c.crack))));
    } else {
      if (!c.fell) { c.fell = true; breakFx(game, c); }
      const u = Math.min(1, c.t / BREAK_T);
      a = Math.round(c.a * (1 - u)); gc = 255;
      if (u >= 1) { R.crumble.delete(i); gc = 0; }
    }
    D[i * 4 + 3] = a;
    D[i * 4 + 1] = gc;
    markUpload(R, c.x, c.y, c.x, c.y);
  }
  for (const [i, c] of R.cracks) {
    if (c.d > 0) { c.d -= dt; continue; }  // waits for the cave-in next to it
    c.v -= dt / 45;
    const x = i % W, y = (i - x) / W;
    if (c.v <= 0 || !isCaveTile(w, i)) { R.cracks.delete(i); if (!R.crumble.has(i) && !w.broof[i]) D[i * 4 + 1] = 0; markUpload(R, x, y, x, y); continue; }
    if (R.crumble.has(i) || w.broof[i]) continue;
    D[i * 4 + 1] = Math.round(255 * Math.min(1, c.v));
    markUpload(R, x, y, x, y);
  }
}

// at a cave's mouth the local player sees a few tiles into it: the ceiling of the cave(s) touching the tiles right
// around the player fades within ~3 tiles (never through rock: only caves the player is next to)
function peekCaves(game) {
  const R = game.roofs, w = game.world, D = R.data, W = w.W, p = game.player, I = game.indoors, old = R.peek;
  const next = new Map(), near = new Set();
  if (!p.dead) {
    const px = Math.floor(p.x), py = Math.floor(p.y - 0.05);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (!w.inBounds(x, y)) continue;
      const id = R.caveOf[y * W + x];
      if (id && !(I.kind === 'cave' && I.region === id)) near.add(id);
    }
    if (near.size) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = px + dx, y = py + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * W + x;
      if (!near.has(R.caveOf[i])) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y - 0.05));
      const v = Math.round(255 * Math.min(1, Math.max(0, (d - 1.6) / 1.6)));
      if (v < 255) next.set(i, v);
    }
  }
  if (!next.size && !old.size) return;
  // tiles that leave the peek get their cave's value back; the others its minimum with the peek
  for (const i of old.keys()) if (!next.has(i)) next.set(i, 255);
  for (const [i, v] of next) {
    const g = R.caves.get(R.caveOf[i]);
    const base = g && g.av >= 0 && !w.broof[i] ? g.av : 0;
    const a = Math.min(base, v);
    if (D[i * 4 + 3] !== a) { D[i * 4 + 3] = a; markUpload(R, i % W, (i / W) | 0, i % W, (i / W) | 0); }
    if (v >= 255) next.delete(i);
  }
  R.peek = next;
}

// a cave-in over `tiles` ([[tx, ty, col?]]): schedule the crumble from (ex, ey) outwards + cracks around it
function caveCrumble(game, tiles, ex, ey, quiet) {
  const R = game.roofs, w = game.world, W = w.W, D = R.data;
  const crack = quiet ? CRACK_T * 0.6 : CRACK_T;
  let far = 0;
  for (const t of tiles) {
    const [x, y] = t, i = y * W + x, d = Math.hypot(x + 0.5 - ex, y + 0.5 - ey);
    const delay = crack + d * 0.11 + Math.random() * 0.1;
    far = Math.max(far, delay);
    const old = R.crumble.get(i);
    R.crumble.set(i, { x, y, t: -delay, crack, a: old ? old.a : D[i * 4 + 3], g: D[i * 4 + 1], col: t[2] || null, fell: false, n: R.crumble.size });
  }
  // the ceiling left around the hole stays cracked for a while (shown once the hole is there, fading over ~45 s)
  for (const t of tiles) {
    const [x, y] = t;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const j = ny * W + nx;
      if (!isCaveTile(w, j) || R.crumble.has(j)) continue;
      const v = 0.42 - Math.hypot(dx, dy) * 0.1, c = R.cracks.get(j);
      if (!c || c.v < v) R.cracks.set(j, { v, d: Math.max(0, far * 0.5 - 0.1) });
    }
  }
}

// one tile of cave ceiling breaks: chunks of it fall from the ceiling height, a dust cloud follows (fx queue)
function breakFx(game, c) {
  const R = game.roofs, P = game.particles, A = game.A;
  const col = c.col || [0.56, 0.53, 0.5];
  if (c.n > 90) return; // a huge cave-in: the first tiles carry the show
  const v = game.view?.();
  if (v && (c.x < v.x0 - 3 || c.x > v.x1 + 3 || c.y < v.y0 - 3 || c.y > v.y1 + 4)) return;
  if (P && A) {
    const name = A.has('fx_rubble') ? 'fx_rubble' : A.has('fx_spark') ? 'fx_spark' : null;
    if (name) {
      const K = 1 / Math.max(0.01, A.get(name).w), n = 2 + (Math.random() < 0.4 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const s = (0.26 + Math.random() * 0.32) * K, sh = 0.82 + Math.random() * 0.26, v = (Math.random() * 3) | 0;
        P.emit({ spr: v && A.has('fx_rubble_' + v) ? 'fx_rubble_' + v : name, x: c.x + 0.15 + Math.random() * 0.7, y: c.y + 0.25 + Math.random() * 0.6, lift: 1.5 + Math.random() * 0.7, vlift: -Math.random() * 0.6,
          grav: 13, bounce: 0.28, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.35, drag: 0.3, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9,
          life: 1.3 + Math.random() * 0.6, hold: 0.6, size: s, size1: s * 0.85, r: col[0] * sh, g: col[1] * sh, b: col[2] * sh, a: 1, a1: 0 });
      }
      // grit pouring from the broken edge
      const pk = A.has('fx_spark') ? 'fx_spark' : name, Kp = 1 / Math.max(0.01, A.get(pk).w);
      for (let j = 0; j < 5; j++) P.emit({ spr: pk, x: c.x + Math.random(), y: c.y + 0.2 + Math.random() * 0.7, lift: 1.6 + Math.random() * 0.5, vlift: -0.4,
        grav: 9, vx: (Math.random() - 0.5) * 0.3, vy: 0, life: 0.6 + Math.random() * 0.3, size: (0.07 + Math.random() * 0.07) * Kp, size1: 0.05 * Kp,
        r: col[0] * 0.9, g: col[1] * 0.88, b: col[2] * 0.85, a: 1, a1: 0.6 });
    }
  }
  // the dust cloud when the chunks hit the floor (dustFx)
  R.fx.push({ x: c.x + 0.5, y: c.y + 0.5, t: -0.45 - Math.random() * 0.12, cave: true, col });
}

// is the point (feet) under a cave ceiling drawn right now? (sprites, labels, lights there are hidden)
export function underCaveCeiling(game, x, y) {
  const R = game.roofs, w = game.world;
  if (!R) return false;
  const tx = Math.floor(x), ty = Math.floor(y - 0.05);
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return false;
  const i = ty * w.W + tx;
  return R.data[i * 4 + 3] >= 128 && !w.rock[i];
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
  // face: the slope under the tile centre (1 west, 2 east, 3 south — facing the camera —, 4 north, 0 unknown); pitch: its rise per tile
  const i = w.idx(tx, ty);
  let lo = 0, hi = a.tiles.length - 1, m = -1;
  while (lo <= hi) { const c = (lo + hi) >> 1, v = a.tiles[c]; if (v === i) { m = c; break; } if (v < i) lo = c + 1; else hi = c - 1; }
  return { lift: roofHeightAt(game, tx, ty), key: s ? s.key : ty + 1, alpha: g.alpha, lit: regionLit(game, g), face: m >= 0 ? a.tileF?.[m] | 0 : 0, pitch: m >= 0 ? a.tileP?.[m] || 1 : 1 };
}

// a light burns inside roof region g (its gable windows glow at night)
export function regionLit(game, g) {
  const w = game.world;
  return !!g?.lights?.some((id) => { const o = w.objById.get(id); return o && o.light && o.fire !== false && o.lit !== false; });
}

export { DET };
