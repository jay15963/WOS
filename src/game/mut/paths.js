// Painted terrain paths (agent M): every shared change of the path grid and its blueprint layer.
// Grids (Uint8Array W*H, created by initPathGrids before any save / snapshot is applied):
//   world.path     built path type per tile (0 none, 1..5 = content/paths.js PATH_TYPES)
//   world.pathPlan plan code per tile (0 none, 1..5 = lay that type: blue blueprint, 15 = remove the path here)
// Ops:     path.plan {c, tiles}  ·  path.set {t, tiles, by?, xp?, give?}
// Intents: path.plan {c, tiles}  paint blueprints (c 1..5), mark built paths for removal (15) or cancel plans (0)
//          path.lay  {t, tiles}  a worker laid a patch of planned tiles (it paid the materials: request refund)
//          path.dig  {tiles}     a worker removed marked tiles (75% of the materials back as `give`)
// Tile lists travel run-length encoded: [start, len, start, len…] over sorted tile indices (rleTiles / unrleTiles).
// Snapshot / save: { g, p } = rleGrid(world.path), rleGrid(world.pathPlan) as [value, count, …] runs.
// Derived (every peer, from the grids): game.pathGrid = { planned: Set of planned tiles, built, dirty rect, v }.

import { defineIntent, defineOp } from '../../net/registry.js';
import { objectsOnTile, CLEARABLE, CLEAR_YIELD } from './structures.js';
import { BUILDINGS } from '../data.js';
import { PATH_TYPES, PATH_COUNT, PATH_REMOVE, PATH_REFUND, PATH_MAX_PAINT, PATH_PAINT_DIST, PATH_PATCH, PATH_REACH } from '../content/paths.js';

const validCode = (c) => Number.isInteger(c) && ((c >= 0 && c <= PATH_COUNT) || c === PATH_REMOVE);

// ---------- grids + derived bookkeeping ----------
export function initPathGrids(game) {
  const w = game.world, N = w.W * w.H;
  if (!w.path || w.path.length !== N) w.path = new Uint8Array(N);
  if (!w.pathPlan || w.pathPlan.length !== N) w.pathPlan = new Uint8Array(N);
  game.pathGrid = { planned: new Set(), built: 0, dirty: null, v: 0 };
  return game.pathGrid;
}
const PG = (game) => game.pathGrid || initPathGrids(game);

// tile rect (inclusive) whose GPU data / decor visibility must be rebuilt (cosmetic consumers: game/paths.js)
export function pathChanged(game, x0, y0, x1, y1) {
  const s = PG(game), d = s.dirty;
  if (!d) s.dirty = [x0, y0, x1, y1];
  else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
  s.v++;
}

function rebuildIndex(game) {
  const w = game.world, s = PG(game), P = w.path, Q = w.pathPlan;
  s.planned.clear(); s.built = 0;
  for (let i = 0; i < P.length; i++) { if (P[i]) s.built++; if (Q[i]) s.planned.add(i); }
  pathChanged(game, 0, 0, w.W - 1, w.H - 1);
}

// ---------- tile lists ----------
export function rleTiles(list) {
  const a = [...new Set(list)].filter((i) => Number.isInteger(i) && i >= 0).sort((x, y) => x - y), out = [];
  for (let k = 0; k < a.length;) {
    let n = 1;
    while (k + n < a.length && a[k + n] === a[k] + n) n++;
    out.push(a[k], n);
    k += n;
  }
  return out;
}
// sorted unique tile indices from runs (bounds-checked, at most `max`)
export function unrleTiles(runs, N, max = PATH_MAX_PAINT) {
  const out = [];
  if (!Array.isArray(runs)) return out;
  let last = -1;
  for (let k = 0; k + 1 < runs.length && out.length < max; k += 2) {
    const s = runs[k], n = runs[k + 1];
    if (!Number.isInteger(s) || !Number.isInteger(n) || n <= 0 || s < 0) continue;
    for (let i = Math.max(s, last + 1); i < s + n && i < N && out.length < max; i++) { out.push(i); last = i; }
  }
  return out;
}
export function rleGrid(a) {
  const out = [];
  for (let i = 0; i < a.length;) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}
function unrleGrid(runs, out, ok) {
  out.fill(0);
  if (!Array.isArray(runs)) return;
  let i = 0;
  for (let k = 0; k + 1 < runs.length && i < out.length; k += 2) {
    const v = runs[k], n = runs[k + 1];
    if (!Number.isInteger(n) || n <= 0) break;
    const val = ok(v) ? v : 0;
    const e = Math.min(out.length, i + n);
    if (val) out.fill(val, i, e);
    i = e;
  }
}

// ---------- rules ----------
// why the tile can't take a path (null = fine): water, rock, floors / rugs / farm plots, structures other than doors,
// trees / stumps / boulders (small loose things — pebbles, sticks, bushes — are cleared when the path is laid)
export function canPaint(game, tx, ty) {
  const w = game.world;
  if (!w.inBounds(tx, ty) || tx < 1 || ty < 1 || tx >= w.W - 1 || ty >= w.H - 1) return 'Fora do mapa';
  const i = w.idx(tx, ty);
  if (w.rock[i]) return 'Rocha no caminho';
  if (w.water[i]) return 'Não dá para abrir caminho na água';
  const G = game.build?.grid;
  if (G) {
    const f = G.floor?.get(i);
    if (f) return f.type === 'farm_plot' ? 'Canteiro no local' : 'Piso no local (piso e caminho não se misturam)';
    if (G.rug?.get(i)) return 'Tapete no local';
    const o = G.main?.get(i);
    if (o && BUILDINGS[o.type]?.block !== 'door') return 'Construção no local';
  }
  for (const o of objectsOnTile(game, tx, ty)) {
    if (CLEARABLE.has(o.type) || o.type === 'crop') continue;
    return o.type.startsWith('tree_') ? (o.stump ? 'Toco no caminho' : 'Árvore no caminho') : o.type === 'boulder' ? 'Pedregulho no caminho' : 'Algo no caminho';
  }
  return null;
}
// floors / rugs / farm plots refuse tiles with a path or a path blueprint (exclusive per tile) — structures.js placeReason
export function pathBlocksFloor(w, i) {
  return !!(w.path && (w.path[i] || (w.pathPlan[i] > 0 && w.pathPlan[i] !== PATH_REMOVE)));
}

const addCost = (acc, cost, k) => { for (const id in cost) acc[id] = (acc[id] || 0) + cost[id] * k; return acc; };
// authority: refunds per player keep their fractions (2 gravel tiles dug = 1.5 pebbles: the half waits for the next patch)
function refundOf(game, pid, acc) {
  const s = PG(game), bank = s.bank || (s.bank = new Map());
  let b = bank.get(pid);
  if (!b) bank.set(pid, (b = {}));
  for (const id in acc) b[id] = (b[id] || 0) + acc[id];
  const out = {};
  for (const id in b) { const n = Math.floor(b[id] + 1e-6); if (n > 0) { out[id] = n; b[id] -= n; } }
  return Object.keys(out).length ? out : undefined;
}
const floorAll = (acc) => { const out = {}; for (const id in acc) { const n = Math.floor(acc[id] + 1e-6); if (n > 0) out[id] = n; } return Object.keys(out).length ? out : undefined; };

// ---------- appliers ----------
function setTiles(game, tiles, fn) {
  const w = game.world, W = w.W;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0, sx = 0, sy = 0;
  for (const i of tiles) {
    fn(i);
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    sx += x; sy += y; n++;
  }
  if (n) pathChanged(game, x0, y0, x1, y1);
  return n ? { n, x: sx / n + 0.5, y: sy / n + 0.5 } : null;
}

defineOp('path.plan', {
  doc: 'Plan code of tiles: 1..5 = lay that path type (blue blueprint), 15 = remove the built path, 0 = cancel.',
  args: { c: '0..5|15', tiles: 'tile runs [start, len…]', by: 'pid?' },
  apply(game, a, ctx) {
    const w = game.world, c = a.c | 0;
    if (!validCode(c)) return;
    const s = PG(game), Q = w.pathPlan;
    const r = setTiles(game, unrleTiles(a.tiles, Q.length), (i) => { Q[i] = c; if (c) s.planned.add(i); else s.planned.delete(i); });
    if (r && !ctx.mine && c) game.audio?.play('path_paint', { x: r.x, y: r.y, volume: 0.6 });
  },
});

defineOp('path.set', {
  doc: 'Built path type of tiles (0 = removed); their plan is cleared. Refunds / XP to the worker are owner effects.',
  args: { t: '0..5', tiles: 'tile runs', by: 'pid?', xp: 'number?', give: '{item: qty}?' },
  apply(game, a, ctx) {
    const w = game.world, t = a.t | 0;
    if (!(t >= 0 && t <= PATH_COUNT)) return;
    const s = PG(game), P = w.path, Q = w.pathPlan;
    const r = setTiles(game, unrleTiles(a.tiles, P.length), (i) => {
      if (P[i] && !t) s.built--; else if (!P[i] && t) s.built++;
      P[i] = t; Q[i] = 0; s.planned.delete(i);
    });
    if (!r || ctx.mine) return; // the worker's own client played its feedback already
    const T = PATH_TYPES[t];
    game.audio?.play(!t ? 'decon' : T.key === 'dirt' ? 'path_dirt' : T.key === 'gravel' ? 'path_gravel' : 'path_stone', { x: r.x, y: r.y, volume: 0.7 });
    game.juice?.puff?.(r.x, r.y, 4, t === 1 || !t ? [0.6, 0.5, 0.38] : [0.62, 0.6, 0.56], 0.5);
  },
});

// ---------- intents ----------
defineIntent('path.plan', {
  doc: 'Paint path blueprints of type c (1..5) on tiles, mark built paths for removal (c = 15) or cancel plans (c = 0). Tiles that cannot take a path (water, rock, floors, structures, trees) are skipped.',
  args: { c: '0..5|15', tiles: 'tile runs (≤ 2000 tiles)' },
  run(game, a, actor, net) {
    const w = game.world, W = w.W, c = a.c;
    if (!validCode(c)) return 'Caminho desconhecido';
    const list = unrleTiles(a.tiles, w.path.length, PATH_MAX_PAINT);
    if (!list.length) return 'Nada para pintar';
    const e = actor.ent, P = w.path, Q = w.pathPlan;
    const lay = [], cancel = [], mark = [];
    for (const i of list) {
      const tx = i % W, ty = (i / W) | 0;
      if (e && Math.hypot(tx + 0.5 - e.x, ty + 0.5 - e.y) > PATH_PAINT_DIST) continue;
      const cur = Q[i], built = P[i];
      if (c === 0) { if (cur) cancel.push(i); continue; }
      if (c === PATH_REMOVE) {
        if (cur && cur !== PATH_REMOVE) cancel.push(i); // the eraser on a blueprint cancels it at once
        else if (built && !cur) mark.push(i);
        continue;
      }
      if (built === c) { if (cur) cancel.push(i); continue; } // already that path
      if (cur === c || canPaint(game, tx, ty)) continue;
      lay.push(i);
    }
    if (cancel.length) net.emit('path.plan', { c: 0, tiles: rleTiles(cancel), by: actor.pid });
    if (mark.length) net.emit('path.plan', { c: PATH_REMOVE, tiles: rleTiles(mark), by: actor.pid });
    if (lay.length) net.emit('path.plan', { c, tiles: rleTiles(lay), by: actor.pid });
    if (!lay.length && !mark.length && !cancel.length) return c === 0 || c === PATH_REMOVE ? 'Nenhum caminho aqui' : 'Não dá para abrir caminho aqui';
    return { lay: lay.length, mark: mark.length, cancel: cancel.length };
  },
});

defineIntent('path.lay', {
  doc: 'The actor laid a patch of tiles planned with type t (it took the materials from its bag: tiles refused here come back as give; a full refusal returns the request refund).',
  args: { t: '1..5', tiles: `tile runs (≤ ${PATH_PATCH * 2})` },
  run(game, a, actor, net) {
    const w = game.world, W = w.W, t = a.t;
    const T = Number.isInteger(t) && t > 0 ? PATH_TYPES[t] : null;
    if (!T) return 'Caminho desconhecido';
    const list = unrleTiles(a.tiles, w.path.length, PATH_PATCH * 2);
    const e = actor.ent, ok = [], stale = [], back = {};
    for (const i of list) {
      const tx = i % W, ty = (i / W) | 0;
      if (w.pathPlan[i] !== t || (e && Math.hypot(tx + 0.5 - e.x, ty + 0.5 - e.y) > PATH_REACH)) continue;
      if (canPaint(game, tx, ty)) { stale.push(i); continue; } // something was built / grew there: drop the plan
      ok.push(i);
      const old = w.path[i];
      if (old && old !== t) addCost(back, PATH_TYPES[old].cost, PATH_REFUND); // replaced path: 75% back
    }
    if (stale.length) net.emit('path.plan', { c: 0, tiles: rleTiles(stale), by: actor.pid });
    if (!ok.length) return 'A planta do caminho mudou';
    addCost(back, T.cost, list.length - ok.length); // paid for tiles that were refused
    // loose plants / pebbles / sticks on the laid tiles are cleared like under a building (their yields to the worker)
    const ids = [], yields = {};
    for (const i of ok) for (const o of objectsOnTile(game, i % W, (i / W) | 0)) if (CLEARABLE.has(o.type)) { ids.push(o.id); addCost(yields, CLEAR_YIELD[o.type] || {}, 1); }
    if (ids.length) net.emit('obj.remove', { ids, fx: 'clear', by: actor.pid, give: floorAll(yields) });
    const xp = Math.round(ok.length * T.xp);
    net.emit('path.set', { t, tiles: rleTiles(ok), by: actor.pid, xp: xp || undefined, give: refundOf(game, actor.pid, back) });
    return { n: ok.length };
  },
});

defineIntent('path.dig', {
  doc: 'The actor removed a patch of paths marked for removal; 75% of their materials come back (give).',
  args: { tiles: `tile runs (≤ ${PATH_PATCH * 2})` },
  run(game, a, actor, net) {
    const w = game.world, W = w.W;
    const list = unrleTiles(a.tiles, w.path.length, PATH_PATCH * 2);
    const e = actor.ent, ok = [], stale = [], back = {};
    for (const i of list) {
      const tx = i % W, ty = (i / W) | 0;
      if (w.pathPlan[i] !== PATH_REMOVE || (e && Math.hypot(tx + 0.5 - e.x, ty + 0.5 - e.y) > PATH_REACH)) continue;
      if (!w.path[i]) { stale.push(i); continue; }
      ok.push(i);
      addCost(back, PATH_TYPES[w.path[i]].cost, PATH_REFUND);
    }
    if (stale.length) net.emit('path.plan', { c: 0, tiles: rleTiles(stale), by: actor.pid });
    if (!ok.length) return 'Nada para remover';
    net.emit('path.set', { t: 0, tiles: rleTiles(ok), by: actor.pid, give: refundOf(game, actor.pid, back) });
    return { n: ok.length };
  },
});

// ---------- snapshot / save / digest ----------
export function serializePaths(game) {
  const w = game.world;
  if (!w.path) return undefined;
  return { g: rleGrid(w.path), p: rleGrid(w.pathPlan) };
}
// mode 'net' (join / resync): the snapshot is the truth (missing = no paths) · 'load': a save without paths keeps none
export function applyPaths(game, d) {
  const w = game.world;
  if (!w.path) initPathGrids(game);
  const ok = d && typeof d === 'object';
  unrleGrid(ok ? d.g : null, w.path, (v) => Number.isInteger(v) && v > 0 && v <= PATH_COUNT);
  unrleGrid(ok ? d.p : null, w.pathPlan, (v) => validCode(v) && v > 0);
  rebuildIndex(game);
}
// digest rows: one per 16×16 chunk holding any path / plan: [chunk, hash(path), hash(plan)]
export function pathRows(game) {
  const w = game.world, out = [];
  if (!w.path) return out;
  const W = w.W, H = w.H, P = w.path, Q = w.pathPlan;
  for (let cy = 0; cy < H; cy += 16) for (let cx = 0; cx < W; cx += 16) {
    let hp = 2166136261, hq = 2166136261, any = 0;
    for (let y = cy; y < Math.min(H, cy + 16); y++) for (let x = cx; x < Math.min(W, cx + 16); x++) {
      const i = y * W + x, p = P[i], q = Q[i];
      any |= p | q;
      hp ^= p; hp = Math.imul(hp, 16777619) >>> 0;
      hq ^= q; hq = Math.imul(hq, 16777619) >>> 0;
    }
    if (any) out.push([`${cx / 16},${cy / 16}`, (hp >>> 0).toString(36), (hq >>> 0).toString(36)]);
  }
  return out;
}
