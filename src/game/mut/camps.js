// Bandit camps — layout and breakable props (crates).
// installCamps(game): DETERMINISTIC camp layout (tents, crates, campfire, banner, cleared area), run on
// every client right after the world exists and before any save / snapshot, from the pristine world only
// (seeded rngs, ids 'camp<i>:<k>'). Raiders (bandits.js populateCamps) are host-only creatures.
// The planet (docs/STREAMING.md): camps are made PER CHUNK, on every peer, when a chunk loads (planetCampSpot: at
// most one per 3 × 3 block of chunks, a seeded spot in the chunk that holds it, kept if the pristine ground there is
// open, gentle dry land — not the ocean, ice, polar land, swamps, beaches, cliffs — ≥ 60 tiles from the world spawn);
// ids 'camp<chunk>:<k>'; the layout does not mark the chunk changed (it comes back identical), so it leaves with the
// chunk and is rebuilt when the chunk loads again; its raiders come and go with it (host, bandits.js).
// Crate state lives in game.campState (id → [hp, broken, brokenAt], non-default only) — known on every peer whether
// the crate's chunk is loaded or not (op prop.set, snapshot / save rows), applied to the crate when its camp is built.
// Op: prop.set (crate hp / broken / restored). Intent: prop.hit.

import { defineIntent, defineOp } from '../../net/registry.js';
import { mulberry32 } from '../../engine/noise.js';
import { occAdd, occAddTiles, occRemove } from '../nav.js';
import { nearSettlement } from '../../world/realm/realm.js'; // (camps keep away from the settlements: docs/REINOS.md)

const CAMP_MIN_D = 60;
// set by bandits.js (host side of a crate break: loot table, camp aggro)
export const campHooks = { crateBreak: null };
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------- camp placement ----------
function openSpot(game, x, y, R) {
  const w = game.world;
  if (!w.inBounds(Math.floor(x - R - 2), Math.floor(y - R - 2)) || !w.inBounds(Math.floor(x + R + 2), Math.floor(y + R + 2))) return false;
  let trees = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue;
    const i = w.idx(Math.floor(x + dx), Math.floor(y + dy));
    if (w.rock0.get(i) || w.water.get(i)) return false; // pristine world only (never player structures / mined tiles)
  }
  w.forChunks(x - R, y - R, x + R, y + R, (c) => { for (const o of c.objects) if (o.type.startsWith('tree_') && Math.hypot(o.x - x, o.y - y) < R) trees++; });
  return trees <= 9;
}

// ---------- the planet: one camp at most per 3 × 3 block of chunks ----------
const BLOCK = 3, CAMP_P = 0.8;
// planet biomes (world/planet/biomes.js BIOME_KEYS) where no camp stands
const NO_CAMP = new Set(['abyss', 'ocean', 'shallows', 'reef', 'sea_ice', 'lake', 'salt_lake', 'lagoon', 'river', 'ice_sheet', 'polar_desert',
  'snow_peaks', 'mangrove', 'swamp', 'marsh', 'beach', 'cliff', 'salt_flat', 'volcanic']);
const hashU = (seed, a, b, k) => {
  let h = Math.imul((seed | 0) ^ 0x2545f491, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(k | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
// the candidate of block (bx, by): its chunk and spot (tile), from hashes only (no terrain: neighbouring blocks are
// compared without their chunks)
function blockCand(seed, bx, by) {
  if (hashU(seed, bx, by, 1) > CAMP_P) return null;
  const cx = bx * BLOCK + Math.floor(hashU(seed, bx, by, 2) * BLOCK), cy = by * BLOCK + Math.floor(hashU(seed, bx, by, 3) * BLOCK);
  return { cx, cy, x: cx * 64 + 10 + Math.floor(hashU(seed, bx, by, 4) * 44), y: cy * 64 + 10 + Math.floor(hashU(seed, bx, by, 5) * 44), pr: hashU(seed, bx, by, 6) };
}
// the camp spot of chunk c on a planet, or null (deterministic: the seed and the pristine chunk only)
export function planetCampSpot(game, c) {
  const w = game.world, seed = w.seed | 0;
  const cx = c & 255, cy = c >>> 8, NB = Math.floor(256 / BLOCK), bx = Math.floor(cx / BLOCK), by = Math.floor(cy / BLOCK);
  if (cy < 4 || cy > 123 || bx >= NB) return null; // (never at the poles' edge; the last odd column of blocks: none)
  const k = blockCand(seed, bx, by);
  if (!k || k.cx !== cx || k.cy !== cy) return null;
  // the neighbouring blocks' candidates: the lower priority gives way when two are close
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const o = blockCand(seed, (((bx + dx) % NB) + NB) % NB, by + dy);
    if (o && o.pr < k.pr && Math.hypot(w.dx(o.x, k.x), o.y - k.y) < 90) return null;
  }
  if (Math.hypot(w.dx(k.x + 0.5, w.spawn.x), k.y + 0.5 - w.spawn.y) < CAMP_MIN_D) return null;
  const keys = w.source?.biomeKeys || null;
  // the spot, or a few seeded alternatives in the same chunk (always ≥ 10 tiles inside it: only its own tiles are read)
  for (let t = 0; t < 8; t++) {
    const x = t ? cx * 64 + 10 + Math.floor(hashU(seed, c, t, 7) * 44) : k.x, y = t ? cy * 64 + 10 + Math.floor(hashU(seed, c, t, 8) * 44) : k.y;
    const i = w.idx(x, y);
    if ((w.zone.get(i) & 7) === 4 || (keys && NO_CAMP.has(keys[w.pbiome.get(i)]))) continue;
    if (!flatAround(w, x, y, 6)) continue;
    if (!openSpot(game, x + 0.5, y + 0.5, 5)) continue;
    if (nearSettlement(w.source?.planet?.realm, x + 0.5, y + 0.5, 30)) continue; // (never by a village, a castle or a city)
    return { x: x + 0.5, y: y + 0.5, r: 6, c };
  }
  return null;
}
// gentle ground around (x, y): the generated corner heights (hBase) within R vary by less than 1.2 stories
function flatAround(w, x, y, R) {
  let lo = 1e9, hi = -1e9;
  for (let dy = -R; dy <= R + 1; dy += 2) for (let dx = -R; dx <= R + 1; dx += 2) { const h = w.hBase.get(w.idx(x + dx, y + dy)); if (h < lo) lo = h; if (h > hi) hi = h; }
  return hi - lo < 1.2;
}

export function findCampSpots(game) {
  const w = game.world, sx = w.spawn.x, sy = w.spawn.y;
  const zones = (w.zones || []).filter((z) => z.type === 'bandit_camp');
  if (zones.length) return zones.slice(0, 4).map((z) => ({ x: z.x, y: z.y, r: z.r || 6, zone: true }));
  const rand = mulberry32((w.seed | 0) * 131 + 17);
  const cands = [];
  for (const z of w.zones || []) {
    if (z.type !== 'clearing' && z.type !== 'meadow' && z.type !== 'birch' && z.type !== 'forest') continue;
    const d = Math.hypot(z.x - sx, z.y - sy);
    if (d < CAMP_MIN_D) continue;
    cands.push({ x: z.x, y: z.y, d, score: (z.type === 'clearing' ? 2 : z.type === 'meadow' ? 1.2 : 0.6) + rand() });
  }
  for (let k = 0; k < 400; k++) {
    const x = w.bx0 + 12 + rand() * (w.bx1 - w.bx0 - 24), y = w.by0 + 12 + rand() * (w.by1 - w.by0 - 24);
    const d = Math.hypot(x - sx, y - sy);
    if (d >= CAMP_MIN_D) cands.push({ x, y, d, score: rand() * 0.8 });
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= 3) break;
    const x = Math.floor(c.x) + 0.5, y = Math.floor(c.y) + 0.5;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 48)) continue;
    if (!openSpot(game, x, y, 5)) continue;
    out.push({ x, y, r: 6 });
  }
  return out;
}

function clearArea(game, x, y, R, tag = null) {
  const w = game.world;
  const kill = [];
  w.forChunks(x - R - 1, y - R - 1, x + R + 1, y + R + 1, (c) => {
    for (const o of c.objects) {
      if (o.building || o.camp) continue;
      if (Math.hypot(o.x - x, o.y - y) > R) continue;
      if (/^(tree_|bush|berrybush|boulder|pebble|stick|fibergrass|wild_)/.test(o.type)) kill.push(o);
    }
    if (c.decor) c.decor = c.decor.filter((d) => d.t === 'grass' || Math.hypot(d.x - x, d.y - y) > R - 0.5);
  });
  for (const o of kill) { occRemove(game, o); w.removeObject(o); o.gone = true; if (tag) tag.push(o); }
}

function addCampObject(game, camp, o) {
  const w = game.world;
  // reuse an object the world generator may already have placed here
  let found = null;
  w.forChunks(o.x - 1, o.y - 1, o.x + 1, o.y + 1, (c) => {
    for (const q of c.objects) if (!found && q.type === o.type && Math.hypot(q.x - o.x, q.y - o.y) < 1.2) found = q;
  });
  const obj = found || w.addObject({ v: 0, s: 1, f: 1, ...o, id: camp.id + ':' + camp.objects.length });
  Object.assign(obj, { camp: camp.id });
  if (!found && obj.solid) occAdd(game, obj);
  camp.objects.push(obj);
  return obj;
}

function makeCrate(game, camp, x, y) {
  const o = addCampObject(game, camp, { type: 'crate_0', x, y, solid: 0.32, f: camp.rand() < 0.5 ? 1 : -1 });
  Object.assign(o, { isProp: true, name: 'Caixote', temper: 'neutral', level: 1, r: 0.34, scale: 0.9, hp: 3, maxHp: 3, broken: false });
  game.props.push(o);
  game.propsById.set(o.id, o);
  camp.crates.push(o);
  // its shared state (broken / hit while this peer had the chunk unloaded, or from a save / snapshot)
  const st = game.campState?.get(o.id);
  if (st) { if (st[1]) setPropBroken(game, o, true, st[2]); else o.hp = st[0]; }
  return o;
}

function buildCamp(game, spot, id, tier, rand) {
  const camp = { id: 'camp' + id, x: spot.x, y: spot.y, r: spot.r, tier, objects: [], crates: [], members: [], rand, chunk: spot.c ?? null };
  if (!spot.zone) clearArea(game, spot.x, spot.y, 4.6);
  const cx = spot.x, cy = spot.y;
  addCampObject(game, camp, {
    type: 'campfire', x: cx, y: cy + 0.12, solid: 0.3, fire: true,
    light: { r: 1, g: 0.62, b: 0.3, radius: 6, intensity: 1.3, flicker: 0.25, lift: 0.3 },
  });
  addCampObject(game, camp, { type: 'banner', x: cx + 1.6, y: cy - 1.1, solid: 0.12 });
  const a0 = rand() * Math.PI * 2;
  for (let k = 0; k < 2; k++) {
    const a = a0 + k * Math.PI * (0.85 + rand() * 0.3);
    const tx = Math.floor(cx + Math.cos(a) * 3.3) + 0.5, ty = Math.floor(cy + Math.sin(a) * 2.6) + 1;
    const t = addCampObject(game, camp, { type: 'tent_' + (k % 2), x: tx, y: ty, solid: 0.62, f: Math.cos(a) > 0 ? -1 : 1 });
    occAddTiles(game, t, [[Math.floor(tx) - 1, Math.floor(ty - 0.05)], [Math.floor(tx) + 1, Math.floor(ty - 0.05)]]);
    makeCrate(game, camp, tx + (Math.cos(a) > 0 ? -1.5 : 1.5), ty + 0.6);
  }
  if (rand() < 0.6) makeCrate(game, camp, cx - 1.8, cy + 1.4);
  return camp;
}

// every client, before loadGame / the join snapshot
export function installCamps(game) {
  const w = game.world;
  game.camps = [];
  game.props = [];
  game.propsById = new Map();
  game.campState = new Map(); // crate id → [hp, broken, brokenAt] (non-default only; shared: op prop.set, snapshot, save)
  if (w.wrap) { installPlanetCamps(game); return game.camps; }
  game.net.withApply(() => {
    findCampSpots(game).forEach((s, i) => {
      const rand = mulberry32((w.seed | 0) * 977 + i * 31 + 3);
      const d = Math.hypot(s.x - w.spawn.x, s.y - w.spawn.y);
      game.camps.push(buildCamp(game, s, i + 1, d > 95 ? 1 : 0, rand));
    });
  });
  return game.camps;
}

// the planet: the camp of a chunk that has one, built when the chunk loads (every peer), gone with it
function installPlanetCamps(game) {
  const w = game.world;
  const make = (c) => {
    if (game.world !== w || game.camps.some((k) => k.chunk === c)) return;
    const s = planetCampSpot(game, c);
    if (!s) return;
    const rand = mulberry32((w.seed | 0) * 977 + c * 31 + 3);
    const d = Math.hypot(w.dx(s.x, w.spawn.x), s.y - w.spawn.y);
    w._layout = (w._layout || 0) + 1; // (a deterministic layout: the chunk is not marked changed — world.addObject / removeObject)
    let camp;
    try { camp = game.net.withApply(() => buildCamp(game, s, c, d > 95 ? 1 : 0, rand)); } finally { w._layout--; }
    game.camps.push(camp);
    w.camps.push(camp); // (regrowth keeps out of it: world.growWeight)
    campHooks.built?.(game, camp); // (host: its raiders, bandits.js)
  };
  for (const c of [...w.live].sort((a, b) => a - b)) make(c);
  w.onLoad.push((c) => make(c));
  w.onEvict.push((c) => {
    if (game.world !== w) return;
    const k = game.camps.findIndex((q) => q.chunk === c);
    if (k < 0) return;
    const camp = game.camps[k];
    campHooks.gone?.(game, camp); // (host: its raiders go)
    game.camps.splice(k, 1);
    const j = w.camps.indexOf(camp);
    if (j >= 0) w.camps.splice(j, 1);
    for (const o of camp.crates) { const i = game.props.indexOf(o); if (i >= 0) game.props.splice(i, 1); game.propsById.delete(o.id); }
    for (const o of camp.objects) occRemove(game, o);
  });
}

// the shared state of a camp crate (non-default rows only): every peer, from prop.set / snapshot / save
function setCampState(game, id, hp, broken, at, maxHp = 3) {
  const S = game.campState || (game.campState = new Map());
  if (!broken && hp >= maxHp) S.delete(id); else S.set(id, [hp | 0, broken ? 1 : 0, Math.round(at || 0)]);
}
// rows [id, hp, broken, brokenAt] (snapshot / save `props`, digest)
export function campStateRows(game) { return [...(game.campState?.entries() || [])].map(([id, r]) => [id, r[0], r[1], r[2]]); }
const CAMP_ID = /^camp\d+:\d+$/;
export function applyCampState(game, rows, reconcile) {
  const S = game.campState || (game.campState = new Map());
  if (reconcile) S.clear();
  for (const r of rows) if (Array.isArray(r) && typeof r[0] === 'string' && CAMP_ID.test(r[0])) setCampState(game, r[0], r[1] | 0, !!r[2], r[3] | 0);
}

// ---------- crates ----------
export const propById = (game, id) => game.propsById?.get(id) || null;

export function setPropBroken(game, o, broken, at) {
  if (broken && !o.broken) {
    o.broken = true; o.brokenAt = at; o.hp = 0;
    occRemove(game, o);
    game.world.removeObject(o); // the art never sees a broken crate; it comes back with the camp
  } else if (!broken && o.broken) {
    o.broken = false; o.hp = o.maxHp; o.flash = 0;
    game.world.addObject(o);
    occAdd(game, o);
  }
}

defineOp('prop.set', {
  doc: 'Crate state: hit (hp), broken (removed, `at` = host time) or restored by the camp.',
  args: { id: 'propId', hp: 'int', broken: '0|1', at: 'worldTime?', hit: '0|1', by: 'pid?', toast: 'string?' },
  apply(game, a, ctx) {
    // (the shared state, whether the crate's chunk is loaded here or not)
    if (typeof a.id === 'string' && CAMP_ID.test(a.id)) setCampState(game, a.id, a.broken ? 0 : num(a.hp, 3), !!a.broken, a.at ?? game.worldTime);
    const o = propById(game, a.id);
    if (!o) return;
    if (a.hit) {
      o.flash = 1; o.shake = 1;
      (game.shaking ||= new Set()).add(o);
      game.juice.chips(o.x, o.y - 0.2, [0.62, 0.46, 0.28], 7, 0.45);
      game.audio?.play('chop', { x: o.x, y: o.y, volume: 0.8 });
      game.events.emit('damage', { target: o, src: null, amount: 0, kind: 'prop' });
    }
    if (a.broken && !o.broken) {
      setPropBroken(game, o, true, a.at ?? game.worldTime);
      game.juice.puff(o.x, o.y, 10, [0.62, 0.5, 0.36], 0.8);
      game.juice.chips(o.x, o.y, [0.62, 0.46, 0.28], 14, 0.3);
      if (ctx.mine) game.juice.shake(0.15);
      game.events.emit('kill', { target: o });
    } else if (!a.broken && o.broken) setPropBroken(game, o, false);
    else o.hp = a.hp;
  },
});

defineIntent('prop.hit', {
  doc: 'A player hit a crate with a rolled amount (≥ 18 counts double); breaking it rolls the camp loot and alerts the camp.',
  args: { id: 'propId', amount: 'number' },
  run(game, a, actor, net) {
    const o = propById(game, a.id);
    if (!o || o.broken) return 'Já quebrado';
    const e = actor.ent;
    if (e && Math.hypot(e.x - o.x, e.y - o.y) > 18) return 'Longe demais';
    const dmg = num(a.amount) >= 18 ? 2 : 1;
    const hp = Math.max(0, o.hp - dmg);
    if (hp > 0) { net.emit('prop.set', { id: o.id, hp, broken: 0, hit: 1, by: actor.pid }); return; }
    net.emit('prop.set', { id: o.id, hp: 0, broken: 1, at: Math.round(game.worldTime), hit: 1, by: actor.pid, toast: 'Caixote quebrado', toastKind: 'info' });
    campHooks.crateBreak?.(game, o, e);
  },
});
