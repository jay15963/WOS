// Flora regrowth: per-chunk population targets taken from the initial world (trees, bushes, berry
// bushes, fiber grass, pebbles, sticks, wild crops). Missing plants slowly respawn at suitable tiles
// (same biome/ground as the originals of that chunk), off-screen only, never within NOGROW_R tiles
// (Chebyshev) of any player structure (world.noGrow count grid), never on mined / roofed tiles.
// Trees come back as saplings that grow over ~2 in-game days. Also: removal helper for natural objects
// and a starter safety net (pebbles / sticks / fiber / stone near the spawn: no dead ends).

import { occAdd, occRemove } from './nav.js';
import { BIOMES, G } from '../world/worldgen.js';
import { CHUNK } from '../world/world.js';

export const TREE_SOLID = { tree_oak: 0.2, tree_pine: 0.18, tree_birch: 0.16, tree_dead: 0.16 };
export const NOGROW_R = 3;
export const SAPLING_GROW = 1440;  // s (2 in-game days) from sapling to full tree
const SMALL = new Set(['pebble', 'stick', 'fibergrass']);
const TREES = ['tree_oak', 'tree_pine', 'tree_birch', 'tree_dead'];
export const FLORA_KINDS = [...TREES, 'bush', 'berrybush', 'fibergrass', 'pebble', 'stick', 'wild_potato', 'wild_cotton', 'wild_corn'];
const FLORA_SET = new Set(FLORA_KINDS);

// synthesized densities (per tile, by biome) for kinds the world generator did not place at all
const B = Object.fromEntries(BIOMES.map((n, i) => [n, i]));
const SYNTH = {
  pebble:      { meadow: 0.012, forest: 0.008, pine: 0.01, birch: 0.008, marsh: 0.004, shore: 0.02, rocky: 0.03 },
  stick:       { meadow: 0.004, forest: 0.016, pine: 0.016, birch: 0.014, marsh: 0.006, rocky: 0.002 },
  fibergrass:  { meadow: 0.016, forest: 0.006, pine: 0.004, birch: 0.01, marsh: 0.016, shore: 0.006 },
  wild_potato: { meadow: 0.0025, forest: 0.002, birch: 0.002 },
  wild_corn:   { meadow: 0.0025, birch: 0.001 },
  wild_cotton: { meadow: 0.0015, shore: 0.0025, marsh: 0.001 },
};

const rnd = Math.random;

export function initFlora(game) {
  const w = game.world;
  w.noGrow = new Uint16Array(w.W * w.H);
  const n = w.CW * w.CH;
  const F = game.flora = { chunks: [], dyn: new Map(), nextId: 1, t: 0, ci: 0, growing: new Set(), safetyT: 60 };
  for (let k = 0; k < n; k++) F.chunks.push({ target: {}, tmpl: {}, jit: rnd() });
  const totals = {};
  const tmplKey = (i) => (w.biome ? w.biome[i] : 0) * 16 + w.ground[i];
  for (const c of w.chunks) for (const o of c.objects) {
    if (!FLORA_SET.has(o.type)) continue;
    const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
    if (!w.inBounds(tx, ty)) continue;
    const ch = F.chunks[chunkIndex(w, o.x, o.y)];
    ch.target[o.type] = (ch.target[o.type] || 0) + 1;
    (ch.tmpl[o.type] ||= new Set()).add(tmplKey(w.idx(tx, ty)));
    totals[o.type] = (totals[o.type] || 0) + 1;
  }
  // kinds absent from the generated world: synthesize targets from the biome mix of each chunk
  for (const kind in SYNTH) {
    if (totals[kind]) continue;
    const dens = SYNTH[kind];
    const allowed = new Set(Object.keys(dens).map((b) => B[b]));
    for (let cy = 0; cy < w.CH; cy++) for (let cx = 0; cx < w.CW; cx++) {
      let sum = 0;
      for (let y = cy * CHUNK; y < Math.min(w.H, (cy + 1) * CHUNK); y++) for (let x = cx * CHUNK; x < Math.min(w.W, (cx + 1) * CHUNK); x++) {
        const i = w.idx(x, y);
        if (w.rock[i] || w.water[i] || !w.biome) continue;
        sum += dens[BIOMES[w.biome[i]]] || 0;
      }
      if (sum <= 0) continue;
      const ch = F.chunks[cy * w.CW + cx];
      ch.target[kind] = sum;
      ch.synth ||= {};
      ch.synth[kind] = allowed;
    }
  }
}

const chunkIndex = (w, x, y) => {
  const cx = Math.max(0, Math.min(w.CW - 1, Math.floor(x / CHUNK))), cy = Math.max(0, Math.min(w.CH - 1, Math.floor(y / CHUNK)));
  return cy * w.CW + cx;
};

// ---------- no-grow grid (structures and their surroundings) ----------
export function noGrowStamp(game, tx0, ty0, w, h, sign) {
  const W = game.world;
  const G2 = W.noGrow;
  if (!G2) return;
  for (let y = ty0 - NOGROW_R; y < ty0 + h + NOGROW_R; y++) for (let x = tx0 - NOGROW_R; x < tx0 + w + NOGROW_R; x++) {
    if (!W.inBounds(x, y)) continue;
    const i = W.idx(x, y);
    G2[i] = Math.max(0, G2[i] + sign);
  }
}

// ---------- removing natural objects (harvested) ----------
export function removeNatural(game, o) {
  occRemove(game, o);
  game.world.removeObject(o);
  o.gone = true;
  if (o.flora) game.flora.dyn.delete(o.id);
  else game.touched.set(o.id, o);
  game.flora.growing.delete(o);
  game.events.emit('tile', { tx: Math.floor(o.x), ty: Math.floor(o.y) });
}

// ---------- spawning ----------
function tileFree(game, tx, ty, kind) {
  const w = game.world;
  if (!w.inBounds(tx, ty) || tx < 1 || ty < 1 || tx >= w.W - 1 || ty >= w.H - 1) return false;
  const i = w.idx(tx, ty);
  if (w.rock[i] || w.water[i] || w.solid[i] || game.occ[i]) return false;
  if (w.noGrow && w.noGrow[i]) return false;
  if (game.minedSet?.has(i)) return false;
  if (w.roofAt ? w.roofAt(tx, ty) : w.roof?.[i]) return false;
  if (game.camps) for (const c of game.camps) if (Math.hypot(tx + 0.5 - c.x, ty + 0.5 - c.y) < Math.max(7, (c.r || 0) + 1)) return false;
  const minD = kind.startsWith('tree_') ? 1.25 : 0.7;
  const cx = tx + 0.5, cy = ty + 0.6;
  let ok = true;
  w.forChunks(cx - 2, cy - 2, cx + 2, cy + 2, (c) => {
    if (!ok) return;
    for (const o of c.objects) {
      const d = Math.hypot(o.x - cx, o.y - cy);
      const lim = o.building ? 1.5 : o.type.startsWith('tree_') ? Math.max(minD, 1.0) : minD;
      if (d < lim) { ok = false; return; }
    }
  });
  return ok;
}

export function makeFloraObject(game, kind, x, y, opts = {}) {
  const F = game.flora;
  const o = {
    id: opts.id || 'f' + (F.nextId++).toString(36) + Math.floor(rnd() * 1e4).toString(36),
    type: kind, x, y, f: opts.f ?? (rnd() < 0.5 ? -1 : 1), flora: true,
  };
  if (kind.startsWith('tree_')) {
    o.v = opts.v ?? Math.floor(rnd() * 16); o.s = opts.s ?? 0.85 + rnd() * 0.35;
    o.born = opts.born ?? game.worldTime;
    o.age = opts.age ?? 0.08;
    o.solid = 0;
  } else if (kind === 'bush' || kind === 'berrybush') { o.v = opts.v ?? Math.floor(rnd() * 1000); o.s = opts.s ?? 0.75 + rnd() * 0.45; }
  else if (kind === 'boulder') { o.v = opts.v ?? Math.floor(rnd() * 7919); o.s = opts.s ?? 0.6 + rnd() * 0.5; o.solid = 0.34; }
  else if (kind === 'pebble') { o.v = opts.v ?? Math.floor(rnd() * 4); o.s = opts.s ?? 0.8 + rnd() * 0.4; }
  else if (kind === 'stick' || kind === 'fibergrass') { o.v = opts.v ?? Math.floor(rnd() * 3); o.s = opts.s ?? 0.85 + rnd() * 0.3; }
  else { o.v = opts.v ?? 0; o.s = opts.s ?? 0.9 + rnd() * 0.2; }
  if (o.age != null && o.age >= 1) o.age = 1;
  game.world.addObject(o);
  F.dyn.set(o.id, o);
  if (o.type.startsWith('tree_')) {
    if (o.age >= 0.6) { o.solid = TREE_SOLID[o.type] || 0.18; occAdd(game, o); }
    if (o.age < 1) F.growing.add(o);
  } else if (o.solid) occAdd(game, o);
  return o;
}

function spawnAt(game, kind, tx, ty) {
  const jx = (rnd() - 0.5) * (kind.startsWith('tree_') ? 0.5 : 0.6), jy = (rnd() - 0.5) * 0.4;
  const o = makeFloraObject(game, kind, tx + 0.5 + jx, ty + 0.6 + jy);
  game.events.emit('tile', { tx, ty });
  return o;
}

const inView = (v, tx, ty) => tx + 1 > v.x0 - 2 && tx < v.x1 + 2 && ty + 1 > v.y0 - 3 && ty < v.y1 + 4;

function trySpawn(game, k, kind, view) {
  const w = game.world, F = game.flora, ch = F.chunks[k];
  const cx = (k % w.CW) * CHUNK, cy = Math.floor(k / w.CW) * CHUNK;
  const tmpl = ch.tmpl[kind], allowed = ch.synth?.[kind];
  for (let a = 0; a < 8; a++) {
    const tx = cx + Math.floor(rnd() * CHUNK), ty = cy + Math.floor(rnd() * CHUNK);
    if (!w.inBounds(tx, ty) || inView(view, tx, ty)) continue;
    const i = w.idx(tx, ty);
    if (tmpl) { if (!tmpl.has((w.biome ? w.biome[i] : 0) * 16 + w.ground[i])) continue; }
    else if (allowed) { if (!w.biome || !allowed.has(w.biome[i]) || w.ground[i] === G.STONE) continue; }
    else return null;
    if (!tileFree(game, tx, ty, kind)) continue;
    return spawnAt(game, kind, tx, ty);
  }
  return null;
}

function countChunk(c) {
  const n = {};
  for (const o of c.objects) {
    if (!FLORA_SET.has(o.type) || o.stump || o.fall) continue;
    n[o.type] = (n[o.type] || 0) + 1;
  }
  return n;
}

// ---------- starter safety net ----------
function countNear(game, x, y, r, types) {
  let n = 0;
  game.world.forChunks(x - r, y - r, x + r, y + r, (c) => {
    for (const o of c.objects) if (types.includes(o.type) && !o.stump && Math.hypot(o.x - x, o.y - y) < r) n++;
  });
  return n;
}

function spawnNear(game, kind, x, y, rMin, rMax, count, offscreen) {
  const view = game.view();
  let made = 0;
  for (let a = 0; a < count * 40 && made < count; a++) {
    const ang = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
    const tx = Math.floor(x + Math.cos(ang) * r), ty = Math.floor(y + Math.sin(ang) * r);
    if (offscreen && inView(view, tx, ty)) continue;
    if (!tileFree(game, tx, ty, kind)) continue;
    const g = game.world.ground[game.world.idx(tx, ty)];
    if (kind !== 'pebble' && kind !== 'boulder' && (g === G.STONE || g === G.SAND)) continue;
    spawnAt(game, kind, tx, ty);
    made++;
  }
  return made;
}

// keep the basics around the spawn so a new player is never stuck with bare hands
export function ensureStarter(game, offscreen = false) {
  const s = game.world.spawn;
  const need = [
    [['pebble'], 'pebble', 10, 2.5, 13],
    [['stick'], 'stick', 6, 2.5, 13],
    [['fibergrass', 'bush'], 'fibergrass', 7, 2.5, 13],
    [['boulder'], 'boulder', 2, 6, 22],
    [['wild_potato'], 'wild_potato', 1, 8, 30],
    [['wild_corn'], 'wild_corn', 1, 8, 30],
    [['wild_cotton'], 'wild_cotton', 1, 8, 30],
  ];
  for (const [types, kind, want, rMin, rMax] of need) {
    const have = countNear(game, s.x, s.y, rMax, types);
    if (have < want) spawnNear(game, kind, s.x, s.y, rMin, rMax, want - have, offscreen);
  }
}

// ---------- system ----------
export function floraSystem() {
  let growT = 0;
  return {
    update(game, dt) {
      const F = game.flora, w = game.world;
      // sapling growth (1 Hz)
      growT -= dt;
      if (growT <= 0) {
        growT = 1;
        const p = game.player;
        for (const o of F.growing) {
          if (o.gone) { F.growing.delete(o); continue; }
          o.age = Math.min(1, 0.08 + (game.worldTime - (o.born ?? game.worldTime)) / SAPLING_GROW);
          if (o.age >= 0.6 && !o.solid && Math.hypot(p.x - o.x, p.y - o.y) > 0.8) { o.solid = TREE_SOLID[o.type] || 0.18; occAdd(game, o); }
          if (o.age >= 1) F.growing.delete(o);
        }
      }
      // regrowth: a few chunks per second, round robin over the whole map
      F.t -= dt;
      if (F.t > 0) return;
      F.t = 1;
      const view = game.view();
      const nCh = F.chunks.length;
      for (let s = 0; s < 4; s++) {
        const k = F.ci++ % nCh;
        const ch = F.chunks[k];
        let any = false;
        for (const kind in ch.target) { any = true; break; }
        if (!any) continue;
        const have = countChunk(w.chunks[k]);
        for (const kind in ch.target) {
          const want = Math.floor(ch.target[kind] + ch.jit);
          let deficit = want - (have[kind] || 0);
          if (deficit <= 0) continue;
          const small = SMALL.has(kind);
          const rate = small ? 0.45 : kind.startsWith('tree_') ? 0.22 : 0.3;
          for (let n = Math.min(deficit, small ? 2 : 1); n > 0; n--) if (rnd() < rate) trySpawn(game, k, kind, view);
        }
      }
      // safety net near the spawn (off-screen)
      F.safetyT -= 1;
      if (F.safetyT <= 0) { F.safetyT = 90; ensureStarter(game, true); }
    },
  };
}

// ---------- persistence ----------
export function saveFlora(game) {
  const out = [];
  for (const o of game.flora.dyn.values()) {
    if (o.gone) continue;
    const r = [o.type, +o.x.toFixed(2), +o.y.toFixed(2), o.v | 0, +(o.s || 1).toFixed(2), o.f | 0];
    if (o.type.startsWith('tree_')) r.push(Math.round(o.born ?? 0), o.stump ? 1 : 0, Math.round(o.stumpAt || 0));
    out.push(r);
  }
  return out;
}

export function loadFlora(game, arr) {
  for (const r of arr || []) {
    const [type, x, y, v, s, f, born, stump, stumpAt] = r;
    if (!FLORA_SET.has(type) && type !== 'boulder') continue;
    const tx = Math.floor(x), ty = Math.floor(y - 0.05);
    if (!game.world.inBounds(tx, ty) || game.world.rock[game.world.idx(tx, ty)]) continue;
    const opts = { v, s, f };
    if (type.startsWith('tree_')) { opts.born = born ?? game.worldTime; opts.age = Math.min(1, 0.08 + (game.worldTime - opts.born) / SAPLING_GROW); }
    const o = makeFloraObject(game, type, x, y, opts);
    if (stump) { o.stump = true; o.stumpAt = stumpAt || game.worldTime; o.hits = 0; occRemove(game, o); o.solid = 0; game.flora.growing.delete(o); game.stumps?.add(o); }
  }
}
