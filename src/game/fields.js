// The settlements' fields and surroundings: what the mural's jobs need to be possible (docs/REINOS.md §10 "Trabalhos
// possíveis"). Used by game/eco.js (the board, the host's check when a job is taken, the tracker) and mut/objects.js.
//
// Fields. The plan of a place (world/realm/layout.js: L.fields [{ x0, y0, x1, y1, crop }], tiles [x0, x1) × [y0, y1)) is
// planted by the chunk generator (world/realm/ground.js): one plant per tile, every third row bare (the furrows), worldgen
// ids (cy·256 + cx)·16384 + 13000 + k. A harvested plant is a worldgen object gone (game.touched; saved as `gone`). The
// place's farmers replant: at the economy's dawn (game/eco.js dayTick, host) every gone field plant of a place whose
// season lets crops grow (not a hard winter) comes back — the same object, id and spot (op obj.back, mut/objects.js;
// located: a far guest gets it with the chunk later, the save simply no longer lists it as gone).
//   cropFields(L, s, good)      the fields of a crop, biggest first (then nearest the place): [{ f, n, x, y }]
//   cropTotal(L, good)          plants of a crop the plan holds (all its fields)
//   fieldOf(game, o)            { sid, f } — the place / field a plant belongs to (null: not a field plant)
//   fieldsGone(game, fresh)     Map sid → Map plant type → [objects]: the gone field plants this peer knows
//   fieldsLeft(game, sid, good) { total, gone, left }
//   replantFields(game, canGrow)  host: the dawn's replanting (obj.back ops, ≤ 64 ids each)
// Surroundings, deterministic from the planet (every peer the same, no chunk needed): survey(game, s) → { trees, boulders,
// fauna, woods {x, y}, rocks {x, y}, animals [pt names] } — the expected standing trees in the ring around the place (the
// macro biomes' tree density × TREE_K, calibrated on generated chunks), the boulders near it (land × the rocky ground's
// chance), the wild animals of its biomes (content/fauna.js FAUNA_SPAWNS).
// Local targets (cosmetic, this peer's loaded world: the tracker / the ground marker): nearestPlant, nearestTarget;
// areaCount (the host's check when a job is taken; the board's hint).

import { CROP_GOOD } from './content/eco.js';
import { FAUNA_SPAWNS } from './content/fauna.js';
import { SPECIES } from './data.js';
import { ageOf } from './mut/objects.js';
import { realmIndex } from '../world/realm/realm.js';
import { isFieldCropId, fieldRow } from '../world/realm/ground.js';
import { BIOME_LIST, PG } from '../world/planet/biomes.js';
import { CELL, MW, MH } from '../world/planet/consts.js';

export const CROP_TYPE = Object.fromEntries(Object.entries(CROP_GOOD).map(([t, g]) => [g, t])); // good → plant type
const TYPES = new Set(Object.keys(CROP_GOOD));
const ID_PER_CHUNK = 16384;

// ---------- the fields of a plan ----------
export function fieldSize(f) {
  let rows = 0;
  for (let y = f.y0; y < f.y1; y++) if (fieldRow(y)) rows++;
  return rows * (f.x1 - f.x0);
}
export const inField = (f, o) => { const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05); return tx >= f.x0 && tx < f.x1 && ty >= f.y0 && ty < f.y1; };
const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
export function cropFields(L, s, good) {
  const type = CROP_TYPE[good];
  return L.fields.filter((f) => f.crop === type).map((f) => ({ f, n: fieldSize(f), x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 }))
    .sort((a, b) => b.n - a.n || d2(a.x, a.y, s.x, s.y) - d2(b.x, b.y, s.x, s.y) || a.f.x0 - b.f.x0 || a.f.y0 - b.f.y0);
}
export const cropTotal = (L, good) => L.fields.reduce((a, f) => a + (f.crop === CROP_TYPE[good] ? fieldSize(f) : 0), 0);

// the place / field of a field plant (cached per realm: ids are fixed)
const FOF = new WeakMap();
export function fieldOf(game, o) {
  if (!o || !TYPES.has(o.type) || !isFieldCropId(o.id)) return null;
  const R = game.towns?.realm;
  if (!R) return null;
  let M = FOF.get(R);
  if (!M) FOF.set(R, (M = new Map()));
  let r = M.get(o.id);
  if (r !== undefined) return r;
  r = null;
  const e = realmIndex(R).get(Math.floor(o.id / ID_PER_CHUNK));
  for (const sid of e?.s || []) {
    const f = game.towns.layout(sid)?.fields.find((q) => q.crop === o.type && inField(q, o));
    if (f) { r = { sid, f }; break; }
  }
  if (M.size > 60000) M.clear();
  M.set(o.id, r);
  return r;
}

// the gone field plants this peer knows: Map sid → Map plant type → [objects] (cached: recounted when a field plant goes /
// comes back, at most once a second otherwise — a snapshot's reconcile puts plants back without telling)
export function fieldsGone(game, fresh = false) {
  const key = `${game.touched?.size | 0}|${game.fieldV | 0}`, t = game.time || 0, C = game._fieldsGone;
  if (!fresh && C && C.key === key && t - C.t < 1 && t >= C.t) return C.map;
  const map = new Map();
  for (const o of game.touched?.values() || []) {
    if (!o.gone || !TYPES.has(o.type) || !isFieldCropId(o.id)) continue;
    const fo = fieldOf(game, o);
    if (!fo) continue;
    let m = map.get(fo.sid);
    if (!m) map.set(fo.sid, (m = new Map()));
    let a = m.get(o.type);
    if (!a) m.set(o.type, (a = []));
    a.push(o);
  }
  game._fieldsGone = { key, t, map }; // (local cache)
  return map;
}
export function fieldsLeft(game, sid, good, fresh = false) {
  const L = game.towns?.layout?.(sid);
  if (!L) return { total: 0, gone: 0, left: 0 };
  const total = cropTotal(L, good), gone = fieldsGone(game, fresh).get(sid)?.get(CROP_TYPE[good])?.length || 0;
  return { total, gone, left: Math.max(0, total - gone) };
}

// host, at the economy's dawn: the gone field plants of every place where canGrow(sid) come back (never under a building
// put there since: a player's or an army's piece) → how many
export function replantFields(game, canGrow) {
  const w = game.world, net = game.net, grid = game.build?.grid;
  let n = 0;
  for (const [sid, m] of [...fieldsGone(game, true)].sort((a, b) => a[0] - b[0])) {
    if (!canGrow(sid)) continue;
    const ids = [];
    for (const list of m.values()) for (const o of list) {
      const i = w.idx(Math.floor(o.x), Math.floor(o.y - 0.05));
      const b = grid?.main?.get?.(i);
      if (b && b.town == null) continue;
      ids.push(o.id);
    }
    ids.sort((a, b) => a - b);
    for (let k = 0; k < ids.length; k += 64) net.emit('obj.back', { ids: ids.slice(k, k + 64), sid });
    n += ids.length;
  }
  return n;
}

// ---------- the surroundings of a place (the planet's macro cells: deterministic) ----------
// standing trees per tile = the biome's tree density × TREE_K (measured, seed 4242, 16 places of 8 biomes on generated
// chunks: 0.23–0.48 × the density; the tree-less cold deserts have a few trees of their neighbours: not counted)
export const TREE_K = 0.28;
// boulders per tile (planet/chunk.js: 0.0015 on open ground, 0.02 on gravel / stone, 0.012 in the rocky biomes, 0.05
// next to rock — measured 0.0014–0.0058 around the places): a little under the open ground's
const ROCKY = new Set(['rocky_shore', 'alpine', 'tundra']);
const boulderRate = (bm, mtn) => (bm.g === PG.GRAVEL || bm.g === PG.STONE ? 0.016 : ROCKY.has(bm.key) ? 0.01 : 0.0012) + 0.004 * Math.min(1, mtn * 4);
// wild land animals (the farm herds and fish are not prey for a tanner)
const NONWILD = new Set(['cow', 'sheep', 'pig', 'chicken', 'fish', 'whale', 'dolphin', 'shark']);
const LANDWISE = (e) => !e.on || e.on === 'rock' || e.on === 'trees' || e.on === 'shore';
const cellOf = (x, y) => Math.max(0, Math.min(MH - 1, Math.floor(y / CELL))) * MW + (((Math.floor(x / CELL) % MW) + MW) % MW);
const SURV = new WeakMap();
export function survey(game, s) {
  const R = game.towns?.realm, P = R?._planet || game.world?.source?.planet;
  if (!R || !s || !P?.biome) return null;
  let M = SURV.get(R);
  if (!M) SURV.set(R, (M = new Map()));
  let V = M.get(s.id);
  if (V) return V;
  const RT = s.ro + 90, RM = s.ro + 60, r0 = s.r + 2, ST = 8, A = ST * ST;
  const sec = Array.from({ length: 8 }, () => ({ t: 0, tw: 0, tx: 0, ty: 0, b: 0, bw: 0, bx: 0, by: 0 }));
  let trees = 0, boulders = 0, land = 0, fw = 0, fd = 0;
  const an = new Map();
  for (let dy = -RT; dy <= RT; dy += ST) for (let dx = -RT; dx <= RT; dx += ST) {
    const d = Math.hypot(dx, dy);
    if (d > RT || d < r0) continue;
    const x = s.x + dx, y = s.y + dy, c = cellOf(x, y), bm = BIOME_LIST[P.biome[c]];
    if (!bm || bm.water) continue;
    const S = sec[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8], near = 1 / (1 + d / 60);
    const t = A * (bm.td || 0) * TREE_K;
    if (t > 0) { trees += t; S.t += t * near; S.tw += t * near; S.tx += x * t * near; S.ty += y * t * near; }
    if (d <= RM) {
      land += A;
      const b = A * boulderRate(bm, P.mtn?.[c] || 0);
      boulders += b; S.b += b * near; S.bw += b * near; S.bx += x * b * near; S.by += y * b * near;
    }
    fw += A;
    for (const e of FAUNA_SPAWNS[bm.key] || []) {
      if (NONWILD.has(e.sp) || !LANDWISE(e) || !SPECIES[e.sp]) continue;
      fd += e.d * A;
      an.set(e.sp, (an.get(e.sp) || 0) + e.d * A);
    }
  }
  const best = (k, w) => { let q = null; for (const S of sec) if (S[w] > 0 && (!q || S[k] > q[k])) q = S; return q; };
  const T = best('t', 'tw'), B = best('b', 'bw');
  V = {
    trees: Math.round(trees), boulders: Math.round(boulders), land,
    fauna: fw ? Math.round((fd / fw) * 100) / 100 : 0,
    animals: [...an].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([sp]) => plural(SPECIES[sp].name)),
    woods: T ? { x: Math.round((T.tx / T.tw) * 10) / 10, y: Math.round((T.ty / T.tw) * 10) / 10 } : null,
    rocks: B ? { x: Math.round((B.bx / B.bw) * 10) / 10, y: Math.round((B.by / B.bw) * 10) / 10 } : null,
  };
  if (M.size > 600) M.clear();
  M.set(s.id, V);
  return V;
}
// "Cervo" → "cervos", "Escorpião" → "escorpiões", "Raposa-do-ártico" → "raposas-do-ártico", "Urso-polar" → "ursos-polares",
// "Cavalo selvagem" → "cavalos selvagens"
export function plural(name) {
  const one = (w) => (/ão$/.test(w) ? w.slice(0, -2) + 'ões' : /m$/.test(w) ? w.slice(0, -1) + 'ns' : /[rz]$/.test(w) ? w + 'es' : /[aeiou]l$/.test(w) ? w.slice(0, -1) + 'is' : /s$/.test(w) ? w : w + 's');
  const words = String(name).toLowerCase().split(/([ -])/); // (words and their separators)
  let stop = false;
  for (let i = 0; i < words.length; i += 2) {
    if (/^d[oae]s?$/.test(words[i])) stop = true; // ("raposa-do-ártico": only the first word)
    if (!stop) words[i] = one(words[i]);
  }
  return words.join('');
}

// ---------- local targets: what this peer has loaded ----------
// the nearest plant of a crop on a place's fields (null: none loaded here)
export function nearestPlant(game, sid, good, px, py) {
  const L = game.towns?.layout?.(sid), type = CROP_TYPE[good], w = game.world;
  if (!L || !type) return null;
  let best = null, bd = Infinity;
  for (const f of L.fields) {
    if (f.crop !== type) continue;
    w.forChunks(f.x0, f.y0, f.x1, f.y1, (b) => {
      for (const o of b.objects) {
        if (o.type !== type || o.gone || !inField(f, o)) continue;
        const d = d2(w.dx(o.x, px), o.y - py, 0, 0);
        if (d < bd) { bd = d; best = o; }
      }
    });
  }
  return best;
}
const standingTree = (game, o) => o.type.startsWith('tree_') && !o.stump && !o.fall && !o.gone && !o.building && ageOf(game, o) >= 0.9;
const isBoulder = (o) => o.type === 'boulder' && !o.gone && !o.building;
const rockAt = (w, x, y) => w.isLoaded(w.chunkIndex(x + 0.5, y + 0.5)) && w.rock.get(w.idx(x, y)) === 1;
// the nearest tree ('chop') / boulder or rock tile ('mine') to (px, py) inside the area inA(x, y), within r: { x, y, o?, rock? }
export function nearestTarget(game, kind, inA, px, py, r = 44) {
  const w = game.world;
  let best = null, bd = r * r;
  const pred = kind === 'chop' ? (o) => standingTree(game, o) : isBoulder;
  w.forChunks(px - r, py - r, px + r, py + r, (b) => {
    for (const o of b.objects) {
      if (!pred(o)) continue;
      const dx = w.dx(o.x, px), dy = o.y - py, d = dx * dx + dy * dy;
      if (d < bd && inA(o.x, o.y)) { bd = d; best = { x: o.x, y: o.y, o }; }
    }
  });
  if (kind === 'mine') {
    const R = Math.min(24, r), x0 = Math.floor(px), y0 = Math.floor(py);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = dx * dx + dy * dy;
      if (d >= bd || !rockAt(w, x0 + dx, y0 + dy) || !inA(x0 + dx + 0.5, y0 + dy + 0.5)) continue;
      bd = d; best = { x: x0 + dx + 0.5, y: y0 + dy + 0.5, rock: true };
    }
  }
  return best;
}
// how many trees ('chop') / boulders and rock tiles ('mine') the circle (cx, cy, r) holds inside inA, in what this peer has
// loaded (counted up to cap): { n, full } — full: every chunk of the circle is loaded here (a low count is then the truth)
export function areaCount(game, kind, cx, cy, r, inA, cap = 1e9) {
  const w = game.world;
  let n = 0, full = true;
  for (let y = Math.floor((cy - r) / 64) * 64; y <= cy + r; y += 64) for (let x = Math.floor((cx - r) / 64) * 64; x <= cx + r; x += 64) if (!w.isLoaded(w.chunkIndex(x + 1, Math.max(0, y) + 1))) full = false;
  const pred = kind === 'chop' ? (o) => standingTree(game, o) : isBoulder;
  w.forChunks(cx - r, cy - r, cx + r, cy + r, (b) => {
    if (n >= cap) return;
    for (const o of b.objects) if (pred(o) && inA(o.x, o.y)) n++;
  });
  if (kind === 'mine' && n < cap) {
    for (let y = Math.floor(cy - r); y <= cy + r && n < cap; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!rockAt(w, x, y) || !inA(x + 0.5, y + 0.5)) continue;
      if (++n >= cap) break;
    }
  }
  return { n, full };
}
