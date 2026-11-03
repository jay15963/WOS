// Painted terrain paths (agent M) — the player's side. Shared state (grids world.path / world.pathPlan, ops path.plan /
// path.set, intents path.plan / path.lay / path.dig) lives in src/game/mut/paths.js; the catalogue in content/paths.js;
// the look in the terrain shader (src/engine/shaders.js PATH_FN) + material bank (src/world/pathTex.js).
//
// Painting = build mode { kind: 'path', tool: PATH_TOOL, code (1..5 type, 15 eraser), brush 1|2|3, shape }:
//   desktop: the brush ring follows the mouse; left drag paints ('free' stroke / straight 'line' / 'area' rectangle),
//     a click stamps once, right click / Esc drops the stroke then leaves the mode, [ ] change the brush, R the shape.
//   touch: one finger paints (src/ui/buildbar.js forwards the drag through building.js), two fingers stay pinch zoom
//     (the stroke is dropped), a tap stamps once.
//   The stroke shows at once as a local blueprint preview; on release the tiles go to the host in ONE request
//   (path.plan, run-length encoded) and come back as blue blueprints for everyone.
// Building (RimWorld flow, cheapest to sync): blueprints are free; opt-in auto-work (work.js sequence kind 'path':
//   tap / click a blue plan, E next to it, or "Assentar" on the toolbar) lays a patch of up to PATH_PATCH planned tiles
//   around the worked one per cycle and walks the rest of the painted stroke; the materials leave the bag when the patch is laid
//   (path.lay; the dirt path is free). Removal: the eraser or the deconstruct tool marks built tiles (code 15), work
//   digs them out (path.dig, 75% of the materials back). Blueprints under the eraser are cancelled at once.
// Cosmetic (every peer, from the shared grids): GPU data for the shader (signed distance fields, region uploads),
//   grass / ground decor hidden on paths (d._hid), footsteps (world.pathSurface). Owner: walking speed bonus.

import { PATH_TYPES, PATH_BY_KEY, PATH_REMOVE, PATH_SURFACE, PATH_MAX_PAINT, PATH_PATCH } from './content/paths.js';
import { initPathGrids, canPaint, rleTiles } from './mut/paths.js';
import { registerWork, hitsFor } from './gathering.js';
import { exitBuildMode } from './building.js';
import { ITEMS } from './data.js';
import { createTextureArray } from '../engine/gl.js';
import { Layer } from '../world/store.js';
import { fillLayer4 } from '../world/terrainWindow.js'; // (GPU copies: channels of the terrain window ring)
import { loadPathLayers, PATH_TEX } from '../world/pathTex.js';

export { PATH_TYPES, PATH_BY_KEY, PATH_REMOVE };

const SD_R = 3;                       // signed distance search radius (tiles); encoded range ±2
const enc = (sd) => (sd <= -2 ? 0 : sd >= 2 ? 255 : Math.round((sd + 2) * 63.75));
const OFF = (() => {
  const a = [];
  for (let dy = -SD_R; dy <= SD_R; dy++) for (let dx = -SD_R; dx <= SD_R; dx++) if (dx || dy) a.push([dx, dy, Math.hypot(dx, dy)]);
  a.sort((p, q) => p[2] - q[2]);
  return { dx: Int8Array.from(a.map((o) => o[0])), dy: Int8Array.from(a.map((o) => o[1])), d: Float32Array.from(a.map((o) => o[2])) };
})();
const DECOR_HIDE = -0.08;
const PATH_STEPS = PATH_BY_KEY.steps;             // decor whose base sits deeper than this into a path is hidden (edge tufts stay)
// smooth coverage (2x): each tile spreads as a Gaussian (σ 0.5 tile, integrated over the tile) → the outline the shader
// draws (iso 0.36) is rounded and never shows the tile steps. CW[parity][dx + 2] = weight of tile bx + dx for subtexel 2bx + parity.
const COV_S = 0.5;
export const COV_ISO = 0.36; // outline level (same constant in the shader: pathSd)
const erf = (x) => { const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); };
const CW = [0, 1].map((par) => Float32Array.from([-2, -1, 0, 1, 2].map((dx) => {
  const rel = dx + 0.25 - 0.5 * par, k = 1 / (COV_S * Math.SQRT2);
  return 0.5 * (erf((rel + 0.5) * k) - erf((rel - 0.5) * k));
})));

// ---------- setup ----------
export function initPaths(game) {
  const w = game.world;
  initPathGrids(game);
  w.pathSurface = PATH_SURFACE; // footsteps (src/fx/audio.js surfaceAt)
  const V = {
    // (sparse store layers over the planet: pages only around painted tiles)
    data: new Layer('pathData', Uint8Array, 0, { sparse: true, comps: 4 }), // GPU copy: R type (+128 nearest, outside), G plan code (+16 preview), B plan sd, A built sd
    cov: new Layer('pathCov', Uint8Array, 0, { sparse: true, comps: 8 }),   // GPU copy, 2x res RG per tile: [(sub y * 2 + sub x) * 2 + built / plan] coverage
    dir: new Layer('pathDir', Float32Array, 0, { sparse: true, comps: 3 }), // scratch per built tile: path direction (x, y) + σ along it
    preview: new Layer('pathPrev', Uint8Array, 0, { sparse: true }),        // local stroke / pending requests (code + 16)
    prevList: [],                    // tiles set in `preview`
    mark: new Map(), gen: 0,         // scratch: tiles wanted in the preview this refresh
    stroke: null,                    // { tiles: Set, ok: Map } while painting
    pending: [],                     // [{ tiles: [] }] sent, waiting for the host
    layers: null, layersP: null,     // material layers (CPU) once generated
    gpuReady: false, full: true, hover: null, icons: null, t0: 0,
    stats: { last: 0, max: 0, n: 0 },  // CPU ms of the last / worst GPU-data rebuild (debug)
  };
  game._paths = V;
  game.paths = {
    types: PATH_TYPES,
    at: (tx, ty) => (w.inBounds(tx, ty) ? w.path.get(w.idx(tx, ty)) : 0),
    planAt: (tx, ty) => (w.inBounds(tx, ty) ? w.pathPlan.get(w.idx(tx, ty)) : 0),
    counts: () => ({ built: game.pathGrid.built, planned: game.pathGrid.planned.size }),
    enter: (key) => enterPathMode(game, key),
    // paint / erase from code: tiles = [[tx, ty]…] or tile indices (tests, hotbar…)
    paint: (key, tiles, opts) => requestPlan(game, key === 'remove' ? PATH_REMOVE : key === 'cancel' ? 0 : PATH_BY_KEY[key] ?? key, toIdx(game, tiles), opts),
    jobAt: (tx, ty) => jobIt(game, tx, ty),
    deconAt: (wx, wy) => deconTiles(game, [w.idx(Math.floor(wx), Math.floor(wy))], true),
    deconRect: (x0, y0, x1, y1) => {
      const list = [];
      for (let y = Math.max(w.minY, y0); y <= Math.min(w.maxY, y1); y++) for (let x = Math.max(w.minX, x0); x <= Math.min(w.maxX, x1); x++) list.push(w.idx(x, y));
      return deconTiles(game, list, false);
    },
    layers: () => ensureLayers(game),
    stats: () => ({ ...V.stats }),
    refresh: () => { V.full = true; },
  };
  // work: the auto-work queue picks planned tiles too
  game.work?.providers?.push(PROVIDER);
  // decor that arrives with a streamed chunk (or comes back near the camera) hides on the painted paths too
  w.onDecor = (c) => { if (game.pathGrid?.built) { const x0 = (c & 255) * 64, y0 = (c >>> 8) * 64; refreshDecor(game, x0, y0, x0 + 63, y0 + 63); } };
  if (typeof document !== 'undefined' && !game.headless) ensureLayers(game);
  return game.paths;
}

function toIdx(game, tiles) {
  const w = game.world;
  return (tiles || []).map((t) => (Array.isArray(t) ? w.idx(t[0] | 0, t[1] | 0) : t | 0));
}

export function ensureLayers(game) {
  const V = game._paths;
  if (!V.layersP) V.layersP = loadPathLayers().then((L) => { V.layers = L; return L; }).catch((e) => { console.warn('[paths] materials', e); return null; });
  return V.layersP;
}

// ---------- build mode ----------
export function enterPathMode(game, key = 'dirt') {
  const p = game.player;
  if (p.dead) return false;
  const code = key === 'remove' ? PATH_REMOVE : PATH_BY_KEY[key] ?? (PATH_TYPES[key] ? key : 0);
  if (!code) return false;
  game.mining && (game.mining.mode = false);
  const h = game.ctl?.hinted || {};
  game.build.mode = { kind: 'path', tool: PATH_TOOL, code, key: code === PATH_REMOVE ? 'remove' : PATH_TYPES[code].key, brush: h.pbrush || 2, shape: h.pshape || 'free', anchor: null, end: null, last: null, n: 0 };
  ensureLayers(game);
  game.events.emit('buildui', {});
  if (game.ctl?.hinted && !h.pathhint) {
    h.pathhint = true; // sync-ok: hint flag (player save), not shared state
    game.events.emit('toast', {
      text: game.input.isTouch ? 'Arraste um dedo para pintar o caminho (dois dedos dão zoom). Depois toque na planta azul para assentar.'
        : 'Arraste para pintar o caminho · [ ] tamanho do pincel · R forma · Esc cancela · clique na planta azul para assentar',
      kind: 'info',
    });
  }
  return true;
}
export function setBrush(game, b) {
  const m = game.build.mode;
  if (m?.kind !== 'path') return;
  m.brush = Math.max(1, Math.min(3, b | 0));
  if (game.ctl?.hinted) game.ctl.hinted.pbrush = m.brush; // sync-ok: UI preference (player save)
  game.events.emit('buildui', {});
}
export function setShape(game, s) {
  const m = game.build.mode;
  if (m?.kind !== 'path') return;
  m.shape = s === 'line' || s === 'area' ? s : 'free';
  if (game.ctl?.hinted) game.ctl.hinted.pshape = m.shape; // sync-ok: UI preference (player save)
  game.events.emit('buildui', {});
}
export function setPathCode(game, key) {
  const m = game.build.mode;
  if (m?.kind !== 'path') return enterPathMode(game, key);
  const code = key === 'remove' ? PATH_REMOVE : PATH_BY_KEY[key];
  if (!code) return false;
  dropStroke(game);
  m.code = code; m.key = key;
  game.events.emit('buildui', {});
  return true;
}

// ---------- stroke ----------
function okLocal(game, i, code) {
  const S = game._paths.stroke, w = game.world;
  let v = S.ok.get(i);
  if (v !== undefined) return v;
  const tx = i % w.W, ty = (i / w.W) | 0, P = w.path.get(i), Q = w.pathPlan.get(i);
  if (code === PATH_REMOVE) v = !!(P || Q);
  else v = !(P === code && !Q) && Q !== code && !canPaint(game, tx, ty);
  S.ok.set(i, v);
  return v;
}
function addTile(game, set, tx, ty) {
  const w = game.world;
  if (!w.inBounds(tx, ty) || set.size >= PATH_MAX_PAINT) return;
  set.add(w.idx(tx, ty));
}
// tiles under the brush at a world point (1 = the tile, 2 = the nearest 2×2, 3 = a round 5-tile brush)
function stamp(game, set, wx, wy, brush) {
  if (brush <= 1) { addTile(game, set, Math.floor(wx), Math.floor(wy)); return; }
  if (brush === 2) {
    const x0 = Math.floor(wx - 0.5), y0 = Math.floor(wy - 0.5);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) addTile(game, set, x0 + x, y0 + y);
    return;
  }
  const cx = Math.floor(wx), cy = Math.floor(wy);
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x * x + y * y <= 1.7) addTile(game, set, cx + x, cy + y);
}
// stamps along a segment; a 1-tile brush stays 4-connected (no diagonal-only joints)
function sweep(game, set, ax, ay, bx, by, brush) {
  const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.22));
  let lx = Math.floor(ax), ly = Math.floor(ay);
  for (let k = 0; k <= n; k++) {
    const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
    if (brush <= 1) {
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx !== lx && ty !== ly) {
        // diagonal step: add the orthogonal neighbour nearer the segment
        const ex = Math.abs((lx + 0.5 - x) * (by - ay) - (ty + 0.5 - y) * (bx - ax)), ey = Math.abs((tx + 0.5 - x) * (by - ay) - (ly + 0.5 - y) * (bx - ax));
        if (ex < ey) addTile(game, set, lx, ty); else addTile(game, set, tx, ly);
      }
      lx = tx; ly = ty;
    }
    stamp(game, set, x, y, brush);
  }
}

function strokeReset(game) {
  const V = game._paths;
  V.stroke = { tiles: new Set(), ok: new Map() };
}
function shapeTiles(game, m, wx, wy) {
  const S = game._paths.stroke, a = m.anchor;
  if (m.shape === 'free') { sweep(game, S.tiles, m.last[0], m.last[1], wx, wy, m.brush); return; }
  S.tiles.clear();
  if (m.shape === 'line') { sweep(game, S.tiles, a[0], a[1], wx, wy, m.brush); return; }
  const x0 = Math.floor(Math.min(a[0], wx)), x1 = Math.floor(Math.max(a[0], wx)), y0 = Math.floor(Math.min(a[1], wy)), y1 = Math.floor(Math.max(a[1], wy));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) addTile(game, S.tiles, x, y);
}

// preview = current stroke (valid tiles) + requests waiting for the host. Only tiles that changed are re-uploaded
// (a free stroke adds a few tiles per pointer move).
function refreshPreview(game) {
  const V = game._paths, w = game.world, P = V.preview, M = V.mark, m = game.build.mode;
  const gen = ++V.gen;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  const touch = (i) => { const x = i % w.W, y = (i / w.W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const want = (i, c) => { M.set(i, gen); const pv = P.get(i); if (pv !== c + 16) { if (!pv) V.prevList.push(i); P.set(i, c + 16); touch(i); } };
  for (const q of V.pending) for (const i of q.tiles) want(i, q.code);
  if (V.stroke && m?.kind === 'path') for (const i of V.stroke.tiles) if (okLocal(game, i, m.code)) { want(i, m.code); n++; }
  let k = 0;
  for (const i of V.prevList) { if (M.get(i) === gen) V.prevList[k++] = i; else { P.set(i, 0); touch(i); } }
  M.clear();
  V.prevList.length = k;
  if (m?.kind === 'path') m.n = n;
  if (x1 >= 0) markGpu(game, x0, y0, x1, y1);
}
function markGpu(game, x0, y0, x1, y1) {
  const s = game.pathGrid, d = s.dirty;
  if (!d) s.dirty = [x0, y0, x1, y1];
  else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
}
function dropStroke(game) {
  const V = game._paths, m = game.build.mode;
  V.stroke = null;
  if (m?.kind === 'path') { m.anchor = m.end = m.last = null; m.n = 0; }
  refreshPreview(game);
}

// send a plan request (one op batch on the host); the tiles stay as a local preview until the answer
function requestPlan(game, code, list, { quiet = false, onOk, onReject } = {}) {
  if (!list.length) return false;
  const V = game._paths, q = { code: code === 0 ? 0 : code, tiles: code ? list : [] };
  if (code) V.pending.push(q);
  const done = () => { const k = V.pending.indexOf(q); if (k >= 0) V.pending.splice(k, 1); refreshPreview(game); };
  refreshPreview(game);
  return game.net.request('path.plan', { c: code, tiles: rleTiles(list) }, {
    onOk: (r) => { done(); game.work?.wake(); onOk?.(r); },
    onReject: (why) => { done(); if (!quiet) game.events.emit('error', { text: why || 'Não deu para pintar aqui' }); onReject?.(why); },
  }) !== false;
}

function commitStroke(game) {
  const V = game._paths, m = game.build.mode;
  if (!V.stroke || m?.kind !== 'path') return 0;
  const list = [];
  for (const i of V.stroke.tiles) if (okLocal(game, i, m.code)) list.push(i);
  const blocked = V.stroke.tiles.size - list.length;
  V.stroke = null;
  m.anchor = m.end = m.last = null;
  if (!list.length) {
    refreshPreview(game);
    game.events.emit('error', { text: m.code === PATH_REMOVE ? 'Nenhum caminho aqui' : blocked ? 'Não dá para abrir caminho aqui' : 'Já tem esse caminho aqui' });
    return 0;
  }
  const code = m.code, T = PATH_TYPES[code];
  game.build.lastPath = { code, tiles: list }; // "Assentar agora" on the path toolbar (local)
  const w = game.world, c = list[list.length >> 1];
  game.audio?.play('path_paint', { x: (c % w.W) + 0.5, y: ((c / w.W) | 0) + 0.5 });
  requestPlan(game, code, list, {
    onOk: (r) => {
      if (code === PATH_REMOVE) { if (r?.mark) game.events.emit('toast', { text: `${r.mark} tile(s) marcado(s) para remover`, kind: 'info' }); return; }
      const n = r?.lay ?? list.length;
      if (!n) return;
      const miss = missingFor(game, T.cost, n);
      game.events.emit('toast', { text: `${n}× ${T.name}: planta marcada` + (miss ? ` · falta ${miss}` : ''), kind: miss ? 'warn' : 'info' });
    },
  });
  return list.length;
}

function missingFor(game, cost, n) {
  const p = game.player, out = [];
  for (const k in cost) { const need = cost[k] * n, have = p.inv.count(k); if (have < need) out.push(`${need - have} ${(ITEMS[k]?.name || k).toLowerCase()}`); }
  return out.join(', ');
}

// mode handlers called by building.js (buildTap / buildDrag* / cancelBuild) for build modes carrying a `tool`
export const PATH_TOOL = {
  dragStart(game, wx, wy) {
    const m = game.build.mode;
    strokeReset(game);
    m.anchor = [wx, wy]; m.last = [wx, wy]; m.end = [wx, wy];
    stamp(game, game._paths.stroke.tiles, wx, wy, m.shape === 'area' ? 1 : m.brush);
    refreshPreview(game);
  },
  dragMove(game, wx, wy) {
    const m = game.build.mode, V = game._paths;
    if (!m.anchor || !V.stroke) return;
    shapeTiles(game, m, wx, wy);
    m.last = [wx, wy]; m.end = [wx, wy];
    refreshPreview(game);
  },
  dragEnd(game, wx, wy) {
    const m = game.build.mode;
    if (!m.anchor || !game._paths.stroke) return false;
    PATH_TOOL.dragMove(game, wx, wy);
    return commitStroke(game) > 0;
  },
  tap(game, wx, wy) {
    const m = game.build.mode;
    strokeReset(game);
    stamp(game, game._paths.stroke.tiles, wx, wy, m.brush);
    return commitStroke(game) > 0;
  },
  cancel(game) {
    const m = game.build.mode, V = game._paths;
    if (V.stroke || m.anchor) { dropStroke(game); return; }
    exitBuildMode(game);
  },
};

// deconstruct tool on tiles without structures: built paths are marked for removal, path blueprints cancelled
function deconTiles(game, list, single) {
  const w = game.world, mine = [];
  for (const i of list) if (i >= 0 && i < w.W * w.H && (w.path.get(i) || w.pathPlan.get(i)) && w.pathPlan.get(i) !== PATH_REMOVE) mine.push(i);
  if (!mine.length) return 0;
  requestPlan(game, PATH_REMOVE, mine, { quiet: !single });
  return mine.length;
}

// ---------- work: lay / dig planned tiles ----------
function jobIt(game, tx, ty) {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return null;
  const i = w.idx(tx, ty), c = w.pathPlan.get(i);
  if (!c) return null;
  const rem = c === PATH_REMOVE;
  return { kind: 'path', key: 'p' + i, i, c, tile: true, tx, ty, w: 1, h: 1, x: tx + 0.5, y: ty + 0.5, reach: 0.75, verb: rem ? 'Remover caminho' : 'Abrir caminho', icon: 'build', prio: 2 };
}
const affordable = (p, cost) => { let n = 1e9; for (const k in cost) n = Math.min(n, Math.floor(p.inv.count(k) / cost[k])); return n; };

const PROVIDER = {
  count: (game) => game.pathGrid?.planned.size || 0,
  find(game, p, maxD) {
    const S = game.pathGrid?.planned;
    if (!S || !S.size) return null;
    const w = game.world, W = w.W, Q = w.pathPlan, Wk = game.work, now = game.worldTime;
    let best = -1, bd = maxD;
    for (const i of S) {
      const x = i % W, y = (i / W) | 0, d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
      if (d >= bd) continue;
      const c = Q.get(i);
      if (c !== PATH_REMOVE && PATH_TYPES[c] && affordable(p, PATH_TYPES[c].cost) < 1) {
        if (Wk && !Wk.told.has('path' + c) && d < 14) { Wk.told.add('path' + c); game.events.emit('toast', { text: `Caminho parado · falta material: ${missingFor(game, PATH_TYPES[c].cost, 1)}`, kind: 'warn' }); }
        continue;
      }
      if (Wk && Wk.failed.get('p' + i) > now) continue;
      best = i; bd = d;
    }
    if (best < 0) return null;
    const it = jobIt(game, best % W, (best / W) | 0);
    if (it) it.auto = true;
    return it ? [it, bd] : null;
  },
};

// planned tiles of the same code around the worked one that the worker reaches from where it stands
function patchOf(game, it) {
  const w = game.world, W = w.W, Q = w.pathPlan, p = game.player, out = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = it.tx + dx, y = it.ty + dy;
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (Q.get(i) !== it.c || Math.hypot(dx, dy) > 1.6 || Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > 2.4) continue;
    out.push([Math.hypot(dx, dy), i]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, PATH_PATCH).map((r) => r[1]);
}

const LAY_LABEL = { dirt: 'Batendo a terra', gravel: 'Espalhando cascalho', flag: 'Assentando lajotas', cobble: 'Assentando paralelepípedos', steps: 'Assentando pedras' };
const CHIP = { dirt: [0.55, 0.43, 0.3], gravel: [0.6, 0.58, 0.54], flag: [0.62, 0.6, 0.55], cobble: [0.55, 0.55, 0.56], steps: [0.62, 0.6, 0.56] };

registerWork('path', {
  valid: (g, it) => g.world.pathPlan.get(it.i) === it.c,
  start(game, it) {
    const w = game.world, p = game.player;
    const rem = it.c === PATH_REMOVE;
    // something was built / grew on the blueprint meanwhile (or the path to remove is gone): drop that plan
    if (rem ? !w.path.get(it.i) : canPaint(game, it.tx, it.ty)) { game.net.request('path.plan', { c: 0, tiles: rleTiles([it.i]) }); return null; }
    let tiles = patchOf(game, it);
    if (!tiles.includes(it.i)) tiles.unshift(it.i);
    tiles = tiles.slice(0, PATH_PATCH);
    let per;
    if (rem) per = (i) => Math.max(0.15, (PATH_TYPES[w.path.get(i)]?.time || 0.3) * 0.5);
    else {
      const T = PATH_TYPES[it.c];
      const n = Math.min(tiles.length, affordable(p, T.cost));
      if (n < 1) { game.events.emit('error', { text: `Falta material: ${missingFor(game, T.cost, 1)}` }); return null; }
      tiles = tiles.slice(0, n);
      per = () => T.time;
    }
    let total = 0;
    for (const i of tiles) total += per(i);
    const { need, cycle } = hitsFor(Math.max(0.5, total), 1);
    const T = PATH_TYPES[rem ? w.path.get(it.i) || 1 : it.c];
    return { type: !rem && T.key === 'dirt' ? 'plant' : 'build', cycle, need, tiles, code: it.c, label: rem ? 'Removendo caminho' : LAY_LABEL[T.key] || 'Abrindo caminho' };
  },
  hit(game, wk) {
    const it = wk.it, w = game.world, T = PATH_TYPES[wk.code === PATH_REMOVE ? w.path.get(it.i) || 1 : wk.code];
    game.juice.chips(it.x, it.y, CHIP[T.key], 4, 0.25);
    game.audio?.play(T.key === 'dirt' ? 'path_dirt' : 'build_hit', { x: it.x, y: it.y, volume: 0.4 });
  },
  finish(game, wk) {
    const w = game.world, p = game.player, tiles = wk.tiles.filter((i) => w.pathPlan.get(i) === wk.code);
    if (!tiles.length) return true;
    let sx = 0, sy = 0;
    for (const i of tiles) { sx += i % w.W; sy += (i / w.W) | 0; }
    const cx = sx / tiles.length + 0.5, cy = sy / tiles.length + 0.5;
    if (wk.code === PATH_REMOVE) {
      game.net.request('path.dig', { tiles: rleTiles(tiles) }, { onReject: (why) => why && game.events.emit('error', { text: why }) });
      game.audio?.play('decon', { x: cx, y: cy, volume: 0.6 });
      game.juice.puff(cx, cy, 5, [0.6, 0.5, 0.38], 0.5);
      return true;
    }
    const T = PATH_TYPES[wk.code], cost = {};
    for (const k in T.cost) cost[k] = T.cost[k] * tiles.length;
    if (!p.inv.pay(cost)) { game.events.emit('error', { text: `Falta material: ${missingFor(game, T.cost, tiles.length)}` }); return true; }
    if (Object.keys(cost).length) game.events.emit('inventory', {});
    game.net.request('path.lay', { t: wk.code, tiles: rleTiles(tiles) }, {
      refund: Object.keys(cost).length ? cost : undefined, refundAt: [cx, cy],
      onReject: (why) => why && game.events.emit('error', { text: why }),
    });
    game.audio?.play(T.key === 'dirt' ? 'path_dirt' : T.key === 'gravel' ? 'path_gravel' : 'path_stone', { x: cx, y: cy, volume: 0.8 });
    game.juice.puff(cx, cy, 5, CHIP[T.key], 0.5);
    game.work?.wake(); // the next patch right away
    return true;
  },
});

// ---------- GPU data + decor (cosmetic, from the shared grids) ----------
function rebuildData(game, x0, y0, x1, y1) {
  const w = game.world, P = w.path, Q = w.pathPlan, V = game._paths, PV = V.preview, D = V.data;
  const { dx: ODX, dy: ODY, d: ODD } = OFF, NO = ODD.length;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = w.idx(x, y), b = P.get(i), pv = PV.get(i), pl = pv || Q.get(i);
    const inB = b > 0, inP = pl > 0;
    let dB = 0, dP = 0, nt = 0;
    for (let k = 0; k < NO && (!dB || !dP); k++) {
      const xx = x + ODX[k], yy = y + ODY[k];
      let bj = 0, pj = 0;
      if (w.inBounds(xx, yy)) { const j = w.idx(xx, yy); bj = P.get(j); pj = PV.get(j) || Q.get(j); }
      if (!dB && (bj > 0) !== inB) { dB = ODD[k]; if (!inB) nt = bj; }
      if (!dP && (pj > 0) !== inP) dP = ODD[k];
    }
    const sdB = dB ? (inB ? dB - 0.5 : 0.5 - dB) : inB ? 2 : -2;
    const sdP = dP ? (inP ? dP - 0.5 : 0.5 - dP) : inP ? 2 : -2;
    const r = inB ? b : nt ? 128 + nt : 0, eP = enc(sdP), eB = enc(sdB);
    if (!r && !pl && !eP && !eB && !D.pages[((i >>> 20) << 8) | ((i & 16383) >>> 6)]) continue; // (nothing here: no page)
    D.set4(i, 0, r); D.set4(i, 1, pl); D.set4(i, 2, eP); D.set4(i, 3, eB);
  }
}
// Built coverage = oriented Gaussian splats: each built tile spreads along the local path direction (structure tensor
// of its neighbours, σ up to 1.25 tile along, 0.5 across), so a band that steps one tile sideways becomes a smooth
// S-curve instead of a stair (filled areas / single tiles / path ends stay round, σ 0.5). Plans: isotropic separable.
const GW5 = (() => { const a = new Float32Array(25); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) a[(dy + 2) * 5 + dx + 2] = Math.exp(-(dx * dx + dy * dy) / (2 * 1.3 * 1.3)); return a; })();
const SPLAT_R = 3;
function tileDirs(game, x0, y0, x1, y1) {
  const w = game.world, P = w.path, Dr = game._paths.dir;
  const on = (x, y) => w.inBounds(x, y) && P.get(w.idx(x, y)) > 0;
  for (let y = Math.max(w.minY, y0); y <= Math.min(w.maxY, y1); y++) for (let x = Math.max(w.minX, x0); x <= Math.min(w.maxX, x1); x++) {
    const i = w.idx(x, y);
    if (!P.get(i)) continue;
    let sxx = 0, syy = 0, sxy = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if ((!dx && !dy) || !on(x + dx, y + dy)) continue;
      const g = GW5[(dy + 2) * 5 + dx + 2];
      sxx += g * dx * dx; syy += g * dy * dy; sxy += g * dx * dy;
    }
    const tr = sxx + syy, a = tr > 0 ? Math.hypot(sxx - syy, 2 * sxy) / tr : 0;
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    // a path end (nothing ahead or behind along the direction) keeps a round tip
    const end = !on(Math.round(x + ux), Math.round(y + uy)) || !on(Math.round(x - ux), Math.round(y - uy));
    Dr.setc(i, 0, ux); Dr.setc(i, 1, uy); Dr.setc(i, 2, end ? 0.5 : 0.5 + 0.75 * a);
  }
}
function rebuildCov(game, x0, y0, x1, y1, planOnly = false) {
  const w = game.world, P = w.path, Q = w.pathPlan, V = game._paths, PV = V.preview, C = V.cov, Dr = V.dir;
  if (!planOnly) tileDirs(game, x0 - SPLAT_R, y0 - SPLAT_R, x1 + SPLAT_R, y1 + SPLAT_R);
  const SC2 = 2 * COV_S * COV_S;
  x0 = Math.max(w.minX, x0); x1 = Math.min(w.maxX, x1); y0 = Math.max(w.minY, y0); y1 = Math.min(w.maxY, y1);
  for (let sy = y0 * 2; sy <= y1 * 2 + 1; sy++) {
    const by = sy >> 1, wy = CW[sy & 1], qy = (sy + 0.5) / 2;
    for (let sx = x0 * 2; sx <= x1 * 2 + 1; sx++) {
      const bx = sx >> 1, wx = CW[sx & 1], qx = (sx + 0.5) / 2;
      let cb = 0, cp = 0;
      for (let dy = -SPLAT_R; dy <= SPLAT_R; dy++) {
        const yy = by + dy;
        if (yy < w.minY || yy > w.maxY) continue;
        for (let dx = -SPLAT_R; dx <= SPLAT_R; dx++) {
          const xx = bx + dx;
          if (!w.inBounds(xx, yy)) continue;
          const j = w.idx(xx, yy);
          if (!planOnly && P.get(j)) {
            const ex = qx - xx - 0.5, ey = qy - yy - 0.5, ux = Dr.getc(j, 0), uy = Dr.getc(j, 1), sa = Dr.getc(j, 2);
            const u = ex * ux + ey * uy, v = -ex * uy + ey * ux;
            cb += Math.exp(-(u * u) / (2 * sa * sa) - (v * v) / SC2) / (Math.PI * SC2 * (sa / COV_S));
          }
          if (dx >= -2 && dx <= 2 && dy >= -2 && dy <= 2 && (PV.get(j) || Q.get(j))) cp += wy[dy + 2] * wx[dx + 2];
        }
      }
      const i = w.idx(bx, by), k = ((sy & 1) * 2 + (sx & 1)) * 2;
      const vb = cb >= 1 ? 255 : Math.round(cb * 255), vp = cp >= 1 ? 255 : Math.round(cp * 255);
      if (!planOnly) C.setc(i, k, vb);
      C.setc(i, k + 1, vp);
    }
  }
}
// built coverage at a world point (bilinear on the 2x field, like the shader without the noise)
function covAt(V, w, x, y) {
  const C = V.cov, fx = x * 2 - 0.5, fy = y * 2 - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
  const s = (xx, yy) => { const by = yy >> 1; if (by < w.minY || by > w.maxY) return 0; return C.getc(w.idx(xx >> 1, by), ((yy & 1) * 2 + (xx & 1)) * 2); };
  const a = s(x0, y0) + (s(x0 + 1, y0) - s(x0, y0)) * u, b = s(x0, y0 + 1) + (s(x0 + 1, y0 + 1) - s(x0, y0 + 1)) * u;
  return (a + (b - a) * v) / 255;
}
function refreshDecor(game, x0, y0, x1, y1) {
  const w = game.world, V = game._paths;
  w.forChunks(x0, y0, x1 + 1, y1 + 1, (c) => {
    for (const d of c.decor) {
      if (d.x < x0 || d.x > x1 + 1 || d.y < y0 || d.y > y1 + 1) continue;
      const tx = Math.floor(d.x), ty = Math.floor(d.y), t = w.inBounds(tx, ty) ? w.path.get(w.idx(tx, ty)) : 0;
      // grass keeps growing between stepping stones; elsewhere only edge tufts stay
      d._hid = t !== PATH_STEPS && covAt(V, w, d.x, d.y) - COV_ISO > DECOR_HIDE ? 1 : 0;
    }
  });
}
// the GPU copies are two channels of the terrain window (src/world/terrainWindow.js): register them once, then a tile
// rect re-upload is an invalidation of the window
function upload(game, x0, y0, x1, y1) {
  const R = game.R, V = game._paths, win = R?.win;
  if (!win) return;
  if (!win.tex.path) {
    const gl = R.gl;
    win.add('path', { scale: 1, comps: 4, fill: (X0, Y0, tw, th, out) => fillLayer4(V.data, X0, Y0, tw, th, out) });
    win.add('pathCov', { scale: 2, comps: 2, filter: gl.LINEAR, fill: (X0, Y0, tw, th, out) => {
      const C = V.cov, OW = tw * 2;
      for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
        const i = game.world.idx(X0 + tx, Y0 + ty), p = C.pages[((i >>> 20) << 8) | ((i & 16383) >>> 6)];
        if (!p) continue;
        const l = ((((i >>> 8) & 4032) | (i & 63))) * 8;
        for (let k = 0; k < 4; k++) { const o = ((ty * 2 + (k >> 1)) * OW + tx * 2 + (k & 1)) * 2; out[o] = p[l + k * 2]; out[o + 1] = p[l + k * 2 + 1]; }
      }
    } });
    R.pathTex = win.tex.path; R.pathCovTex = win.tex.pathCov;
    return;
  }
  win.invalidate(x0, y0, x1, y1, ['path', 'pathCov']);
}
// bounding box of every built / planned / previewed tile (full rebuilds after a load / snapshot)
function contentBox(game) {
  const w = game.world, W = w.W, P = w.path, Q = w.pathPlan, PV = game._paths.preview;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const box = (i) => { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  P.forEach(box); Q.forEach(box); PV.forEach(box);
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

function syncGpu(game) {
  const V = game._paths, s = game.pathGrid, w = game.world, R = game.R;
  if (s.dirty || V.full) V.t0 = performance.now();
  const any = s.built > 0 || s.planned.size > 0 || V.prevList.length > 0;
  if (!s.dirty && !V.full) { if (R) R.pathOn = any && V.gpuReady ? 1 : 0; return; }
  let d = s.dirty;
  const planOnly = !s.dirtyBuilt; // only blueprints / the local preview changed: the built outline field stays
  s.dirty = null; s.dirtyBuilt = false;
  if (d && d[0] <= 0 && d[1] <= 0 && d[2] >= w.W - 1 && d[3] >= w.H - 1) V.full = true; // snapshot / load
  if (V.full) {
    // whole grid: clear, then rebuild around the content only
    V.full = false;
    V.data.clear(); // type 0, plan 0, both distances −2 (byte 0)
    V.cov.clear(); V.dir.clear();
    d = contentBox(game);
    const prevHid = !!V.anyHid;
    if (d) {
      rebuildData(game, Math.max(w.minX, d[0] - SD_R), Math.max(w.minY, d[1] - SD_R), Math.min(w.maxX, d[2] + SD_R), Math.min(w.maxY, d[3] + SD_R));
      rebuildCov(game, d[0] - SPLAT_R - 2, d[1] - SPLAT_R - 2, d[2] + SPLAT_R + 2, d[3] + SPLAT_R + 2);
    }
    if (prevHid || d) for (const c of w.buckets()) { for (const q of c.decor) if (q._hid) q._hid = 0; }
    if (d) refreshDecor(game, d[0] - 4, d[1] - 4, d[2] + 4, d[3] + 4);
    V.anyHid = !!d;
    if (R?.gl && !game.headless) { if (R.pathTex) upload(game, -1e9, 0, 1e9, w.H - 1); else upload(game, 0, 0, 0, 0); }
  } else {
    const M5 = SPLAT_R + 2; // a tile change moves the directions of its neighbours (2), whose splats reach 3 further
    const x0 = Math.max(w.minX, d[0] - M5), y0 = Math.max(w.minY, d[1] - M5), x1 = Math.min(w.maxX, d[2] + M5), y1 = Math.min(w.maxY, d[3] + M5);
    rebuildData(game, Math.max(w.minX, d[0] - SD_R), Math.max(w.minY, d[1] - SD_R), Math.min(w.maxX, d[2] + SD_R), Math.min(w.maxY, d[3] + SD_R));
    rebuildCov(game, x0, y0, x1, y1, planOnly);
    if (!planOnly) { refreshDecor(game, d[0] - 4, d[1] - 4, d[2] + 4, d[3] + 4); V.anyHid = true; }
    if (R?.gl && !game.headless) upload(game, x0, y0, x1, y1);
  }
  if (R) R.pathOn = any && V.gpuReady ? 1 : 0;
  const ms = performance.now() - V.t0;
  V.stats.last = ms; V.stats.max = Math.max(V.stats.max, ms); V.stats.n++;
}

function syncMaterials(game) {
  const V = game._paths, R = game.R, s = game.pathGrid;
  if (V.gpuReady || !R?.gl || game.headless) return;
  const need = s.built > 0 || s.planned.size > 0 || V.prevList.length > 0 || game.build.mode?.kind === 'path';
  if (!need) return;
  if (!V.layers) { ensureLayers(game); return; }
  R.pathMatTex = createTextureArray(R.gl, PATH_TEX, V.layers);
  V.gpuReady = true;
}

// ---------- system ----------
export function pathsSystem() {
  let bar = null;
  return {
    sync: 'owner', // local: brush tool, GPU data / decor from the shared grids, the local player's speed bonus
    update(game, dt) {
      const V = game._paths, p = game.player, w = game.world;
      if (!V) return;
      // walking on a path (floors and paths never share a tile; not while up on a wall top / upper story)
      if (!p.dead && !(p.lv > 0)) {
        const tx = Math.floor(p.x), ty = Math.floor(p.y);
        if (w.inBounds(tx, ty)) { const t = w.path.get(w.idx(tx, ty)); if (t) p.speed *= PATH_TYPES[t].speed; }
      }
      const m = game.build.mode;
      if (m?.kind === 'path') {
        if (p.dead) exitBuildMode(game);
        // a pinch (buildbar clears the anchor) or a mode change dropped the stroke
        if (V.stroke && !m.anchor) dropStroke(game);
        const K = game.input.pressed;
        if (K.size) {
          if (K.has('BracketLeft')) setBrush(game, m.brush - 1);
          if (K.has('BracketRight')) setBrush(game, m.brush + 1);
          if (K.has('KeyR')) setShape(game, m.shape === 'free' ? 'line' : m.shape === 'line' ? 'area' : 'free');
          if (K.has('Enter')) exitBuildMode(game);
        }
        V.hover = game.ctl?.hover ? [game.ctl.hover.wx, game.ctl.hover.wy] : m.last || null;
      } else if (V.stroke) dropStroke(game);
      if (!bar && typeof document !== 'undefined' && game.R?.canvas && !game.headless) {
        bar = 1;
        import('../ui/pathbar.js').then((mod) => { bar = mod.installPathbar(game); }).catch((e) => { console.warn('pathbar', e); bar = 2; });
      }
      if (typeof bar === 'object' && bar) bar.update(dt);
      syncMaterials(game);
      syncGpu(game);
    },
    render(game, B) {
      const m = game.build.mode, V = game._paths, A = game.A;
      if (m?.kind !== 'path' || !V.hover || !A.has('fx_ring')) return;
      const ring = A.get('fx_ring'), [hx, hy] = V.hover;
      const rem = m.code === PATH_REMOVE, b = m.shape === 'area' && m.anchor ? 1 : m.brush;
      let cx = Math.floor(hx) + 0.5, cy = Math.floor(hy) + 0.5;
      if (b === 2) { cx = Math.floor(hx - 0.5) + 1; cy = Math.floor(hy - 0.5) + 1; }
      const s = b === 1 ? 1.05 : b === 2 ? 2.0 : 2.9, pulse = 0.85 + 0.15 * Math.sin(game.time * 5);
      const tx = Math.floor(hx), ty = Math.floor(hy);
      const bad = !rem && w0Bad(game, tx, ty);
      const c = rem ? [1, 0.45, 0.38] : bad ? [1, 0.4, 0.32] : [0.5, 0.78, 1];
      B.fx.add(ring, cx, cy + 0.08 * s, s, s * 0.66, c[0], c[1], c[2], 0.75 * pulse);
    },
  };
}
function w0Bad(game, tx, ty) {
  const V = game._paths;
  if (V._badT === game.time) return V._bad;
  V._badT = game.time;
  V._bad = !!canPaint(game, tx, ty);
  return V._bad;
}
