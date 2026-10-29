// Flora regrowth: per-chunk population targets taken from the initial world (trees, bushes, berry
// bushes, fiber grass, pebbles, sticks, wild crops). Missing plants slowly respawn at suitable tiles
// (same biome/ground as the originals of that chunk), never in view of ANY player, never within NOGROW_R
// tiles (Chebyshev) of any structure (world.noGrow count grid), never on mined / roofed tiles.
// Trees come back as saplings that grow over ~2 in-game days. Also a starter safety net (pebbles / sticks /
// fiber / stone near the spawn: no dead ends).
// Multiplayer: regrowth, the safety net and sapling solidity are HOST decisions emitted as ops
// (mut/objects.js obj.add / tree.solid); every peer derives the sapling age from `born` + worldTime.

import { BIOMES, G, treeSpecies, bushSpecies, boulderMossy } from '../world/worldgen.js';
import { CHUNK } from '../world/world.js';
import { mulberry32 } from '../engine/noise.js';
import { spawnFlora, ageOf, TREE_SOLID, SAPLING_GROW, NOGROW_R } from './mut/objects.js';
import { floraLook } from './mut/roll.js';
import { inAnyView, minPlayerDist } from './players.js';
import { footprint } from './autotile.js';

export { removeNatural, makeFloraObject, noGrowStamp } from './mut/objects.js';
export { TREE_SOLID, SAPLING_GROW, NOGROW_R };
const SMALL = new Set(['pebble', 'stick', 'fibergrass']);
const TREES = ['tree_oak', 'tree_pine', 'tree_birch', 'tree_dead'];
export const FLORA_KINDS = [...TREES, 'bush', 'berrybush', 'herbbush', 'fibergrass', 'pebble', 'stick', 'wild_potato', 'wild_cotton', 'wild_corn'];
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

export function initFlora(game) {
  const w = game.world;
  w.noGrow = new Uint16Array(w.W * w.H);
  const n = w.CW * w.CH;
  const jr = mulberry32((w.seed | 0) * 53 + 11); // per-chunk target jitter (deterministic)
  const F = game.flora = { chunks: [], dyn: new Map(), t: 0, ci: 0, growing: new Set(), safetyT: 60 };
  for (let k = 0; k < n; k++) F.chunks.push({ target: {}, tmpl: {}, jit: jr() });
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

// ---------- spawning (authority) ----------
function tileFree(game, tx, ty, kind) {
  const w = game.world;
  if (!w.inBounds(tx, ty) || tx < 1 || ty < 1 || tx >= w.W - 1 || ty >= w.H - 1) return false;
  const i = w.idx(tx, ty);
  if (w.rock[i] || w.water[i] || w.solid[i] || game.occ[i]) return false;
  if (w.noGrow && w.noGrow[i]) return false;
  if (game.minedSet?.has(i) || w.isMined?.(tx, ty)) return false;
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

function spawnAt(game, kind, tx, ty) {
  const R = () => game.net.roll();
  const jx = (R() - 0.5) * (kind.startsWith('tree_') ? 0.5 : 0.6), jy = (R() - 0.5) * 0.4;
  const look = floraLook(game.net, kind), w = game.world;
  // art species of the spot, same rules as the world generator (rolled here, travels in the op's v)
  if (kind.startsWith('tree_')) look.v = treeSpecies(w, kind, tx, ty, R()) * 16 + (look.v & 15);
  else if (kind === 'bush') look.v = bushSpecies(w, tx, ty, R()) * 1000 + (look.v % 1000);
  else if (kind === 'boulder' && boulderMossy(w, tx, ty)) look.v = 8000 + (look.v % 1000);
  return spawnFlora(game, kind, tx + 0.5 + jx, ty + 0.6 + jy, look);
}

const growKey = (kind) => (kind.startsWith('tree_') ? 'tree' : kind);
const tileInView = (game, tx, ty) => inAnyView(game, tx + 0.5, ty + 0.5, 2.5, 3.5);

function trySpawn(game, k, kind) {
  const w = game.world, F = game.flora, ch = F.chunks[k], R = () => game.net.roll();
  const cx = (k % w.CW) * CHUNK, cy = Math.floor(k / w.CW) * CHUNK;
  const tmpl = ch.tmpl[kind], allowed = ch.synth?.[kind];
  for (let a = 0; a < 12; a++) {
    const tx = cx + Math.floor(R() * CHUNK), ty = cy + Math.floor(R() * CHUNK);
    if (!w.inBounds(tx, ty) || tileInView(game, tx, ty)) continue;
    const i = w.idx(tx, ty);
    if (w.growWeight) {
      // world suitability (ground / biome / water / camps...), weighted
      const wt = w.growWeight(tx, ty, growKey(kind));
      if (wt <= 0 || R() > wt) continue;
    } else if (tmpl) { if (!tmpl.has((w.biome ? w.biome[i] : 0) * 16 + w.ground[i])) continue; }
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
  let made = 0;
  const R = () => game.net.roll();
  for (let a = 0; a < count * 40 && made < count; a++) {
    const ang = R() * Math.PI * 2, r = rMin + R() * (rMax - rMin);
    const tx = Math.floor(x + Math.cos(ang) * r), ty = Math.floor(y + Math.sin(ang) * r);
    if (offscreen && tileInView(game, tx, ty)) continue;
    if (!tileFree(game, tx, ty, kind)) continue;
    if (game.world.growWeight && game.world.growWeight(tx, ty, growKey(kind)) <= 0) continue;
    const g = game.world.ground[game.world.idx(tx, ty)];
    if (kind !== 'pebble' && kind !== 'boulder' && (g === G.STONE || g === G.SAND)) continue;
    spawnAt(game, kind, tx, ty);
    made++;
  }
  return made;
}

// keep the basics around the spawn so a new player is never stuck with bare hands (authority only)
export function ensureStarter(game, offscreen = false) {
  if (!game.net.auth) return;
  const s = game.world.spawn;
  const need = [
    [['pebble'], 'pebble', 10, 2.5, 13],
    [['stick'], 'stick', 6, 2.5, 13],
    [['fibergrass', 'bush'], 'fibergrass', 7, 2.5, 13],
    [['boulder'], 'boulder', 2, 6, 22],
    [['herbbush'], 'herbbush', 1, 6, 26],
    [['wild_potato'], 'wild_potato', 1, 8, 30],
    [['wild_corn'], 'wild_corn', 1, 8, 30],
    [['wild_cotton'], 'wild_cotton', 1, 8, 30],
  ];
  for (const [types, kind, want, rMin, rMax] of need) {
    const have = countNear(game, s.x, s.y, rMax, types);
    if (have < want) spawnNear(game, kind, s.x, s.y, rMin, rMax, want - have, offscreen);
  }
}

// Natural objects standing on a player structure's footprint (a newer world generator may grow a plant where
// an old save has a building): removed once after load by the authority (one obj.remove op, 'clear' fx).
export function clearUnderStructures(game) {
  const S = game.build?.structures;
  if (!S || !S.length) return 0;
  const w = game.world, ids = new Set();
  for (const s of S) {
    const tiles = footprint(s);
    if (!tiles.length) continue;
    const key = new Set(tiles.map(([x, y]) => x + ',' + y));
    w.forChunks(s.tx - 1, s.ty - 1, s.tx + 4, s.ty + 4, (c) => {
      for (const o of c.objects) {
        if (o.building || o.gone || (!FLORA_SET.has(o.type) && o.type !== 'boulder')) continue;
        if (key.has(Math.floor(o.x) + ',' + Math.floor(o.y - 0.05))) ids.add(o.id);
      }
    });
  }
  if (ids.size) game.net.emit('obj.remove', { ids: [...ids], fx: 'clear' });
  return ids.size;
}

// ---------- system ----------
export function floraSystem() {
  let growT = 0;
  return {
    sync: 'all', // sapling age: every peer (derived from born + worldTime); regrowth & solid flip: authority
    update(game, dt) {
      const F = game.flora, w = game.world, net = game.net;
      // sapling growth (1 Hz)
      growT -= dt;
      if (growT <= 0) {
        growT = 1;
        for (const o of F.growing) {
          if (o.gone || o.stump) { F.growing.delete(o); continue; }
          o.age = ageOf(game, o);
          if (net.auth && o.age >= 0.6 && !o.solid && minPlayerDist(game, o.x, o.y) > 0.8) net.emit('tree.solid', { id: o.id });
          if (o.age >= 1 && (o.solid || !net.auth)) F.growing.delete(o);
        }
      }
      if (!net.auth) return;
      if (!F.cleared) { F.cleared = true; clearUnderStructures(game); }
      // regrowth: a few chunks per second, round robin over the whole map
      F.t -= dt;
      if (F.t > 0) return;
      F.t = 1;
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
          for (let n = Math.min(deficit, small ? 2 : 1); n > 0; n--) if (net.roll() < rate) trySpawn(game, k, kind);
        }
      }
      // safety net near the spawn (off-screen)
      F.safetyT -= 1;
      if (F.safetyT <= 0) { F.safetyT = 90; ensureStarter(game, true); }
    },
  };
}
