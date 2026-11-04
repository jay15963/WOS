// Kingdoms and settlements in the game (docs/REINOS.md "Implementação — geração"). The realm (src/world/realm: kingdoms,
// settlements, territories, roads) comes with the planet; each settlement's plan (layout.js) is a pure function of it.
//
// Materialization: when a chunk loads (every peer), the settlement pieces whose anchor tile is in it are placed as real
// structures (ids 't<sid>.<k>', o.town = sid) without marking the chunk changed (world._layout: they come back the same);
// when the chunk is dropped they go with it (not destroyed). Big batches (a city chunk holds ~2000 pieces) are spread over
// frames (a few ms each), the chunks next to the local player first and at once. What players / monsters / sieges change
// in them is shared state (mut/towns.js: destroyed, doors / gates, damage), applied when a piece is placed.
//
// The town system:
//   host  — settlement gates open by day and close at night or while hostile creatures are inside the town land; players'
//           gates on automatic follow the day; destroyed pieces are rebuilt after two days with nobody near (town.restore);
//           the village animals in the pens (host creatures owned by the place, never the players').
//   local — the place the player is in: "Reino de X — Vila Y" when it changes (event 'place' → ui/placebanner.js).
// Building rule (phase 2 sells plots on the mural): nothing is built on a town land ("Terra de <Vila>: compre um terreno no
// mural"), nothing in a castle; outside the town lands building stays free.
// Hooks for phase 2: game.towns.layout(sid).hooks (homes / beds, workplaces, guard posts, patrol loops, archer spots on
// the walls, artillery), .buildings, .pens, .fields; game.towns.info(sid).

import { realmIndex, settlementAt, kingdomAt, districtAt, canReach } from '../world/realm/realm.js';
import { METALS } from '../world/realm/names.js';
import { settlementLayout, layoutCached } from '../world/realm/layout.js';
import { BUILDINGS } from './data.js';
import { placeStructure, removeStructure, setDoorOpen, TOWN, defOf, setGeom, normRot } from './mut/structures.js';
import { applyTownRows, defaultOpen, TOWN_ID } from './mut/towns.js';
import { isNight, levelForDistance } from './mobs.js';
import { allPlayers, minPlayerDist } from './players.js';
import { spawnStock } from './livestock.js';

const BUDGET_MS = 3;           // per frame for queued pieces
const URGENT_MS = 12;
const PEN_MS = 2;              // per frame for the pens' animals (host)          // per frame for the chunks next to the local player (it may stand there)
const RESTORE_AFTER = 2;       // days before a destroyed piece is rebuilt (nobody within RESTORE_FAR tiles)
const RESTORE_FAR = 40;
export const KIND_PT = { city: 'Cidade', castle: 'Castelo', village: 'Vila' };

export function installTowns(game) {
  const w = game.world, realm = w.wrap ? w.source?.planet?.realm || null : null;
  const T = game.towns || (game.towns = { state: new Map() });
  Object.assign(T, { realm, live: new Map(), jobs: [], penQ: [], wait: new Map(), v: T.v || 0, stats: { placed: 0, ms: 0, maxMs: 0, jobs: 0, unloaded: 0 } });
  if (!game.gates) game.gates = new Map();
  T.layout = (sid) => (realm ? settlementLayout(realm._planet || w.source.planet, realm, sid) : null);
  T.info = (sid) => info(game, sid);
  T.at = (x, y) => placeAt(game, x, y);
  T.canReach = (a, b) => canReach(realm, a, b);
  T.npcLevel = (sid) => (realm?.settlements[sid] ? realmNpcLevel(game, realm.settlements[sid]) : 1); // (phase 2: the people's level, §7b)
  T.resync = (ids) => resyncPieces(game, ids);
  T.ready = (sid, near = 2) => townReady(game, sid, near); // (phase 2 / tests: the place is all made here)
  T.townChunks = realm ? new Set([...realmIndex(realm)].filter(([, e]) => e.s.length).map(([c]) => c)) : new Set();
  w.towns = T;
  if (!realm) return T;
  realm._planet = w.source.planet;
  const onLoad = (c) => {
    if (game.world !== w) return;
    const e = realmIndex(realm).get(c);
    if (e?.s.length) for (const sid of e.s) T.jobs.push({ sid, c });
    // pieces kept in a neighbour chunk that waited for this one (under their footprint)
    const q = T.wait.get(c);
    if (q) {
      T.wait.delete(c);
      const by = new Map();
      for (const [sid, ac, k] of q) { const key = sid + ':' + ac; let j = by.get(key); if (!j) by.set(key, (j = { sid, c: ac, ks: [] })); j.ks.push(k); }
      for (const j of by.values()) T.jobs.push(j);
    }
  };
  for (const c of [...w.live].sort((a, b) => a - b)) onLoad(c);
  w.onLoad.push(onLoad);
  w.onEvict.push((c) => { if (game.world === w) unloadChunk(game, c); });
  warmUp(game);
  return T;
}
// at the boot (behind the loading screen): the settlement chunks around the start are made at once, with their pieces —
// the first frames of a new game never build a village (a new world starts on a village plaza)
function warmUp(game) {
  const w = game.world, T = game.towns, I = realmIndex(T.realm), t0 = performance.now();
  const sp = w.spawn, c0 = w.chunkIndex(sp.x, sp.y);
  if (c0 < 0) return;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cy = (c0 >>> 8) + dy, c = cy * 256 + ((((c0 & 255) + dx) % 256) + 256) % 256;
    if (cy < 0 || cy > 127 || !I.get(c)?.s.length) continue;
    w.ensure(c);
  }
  for (const j of T.jobs) runJob(game, j, 0);
  T.jobs.length = 0;
  T.stats.warmMs = Math.round(performance.now() - t0);
}

// ---------- the pieces of one chunk ----------
// A piece belongs to the chunk where the world keeps it: the chunk of its anchor point (o.x, o.y — the middle of the
// south edge of its footprint: a piece on the last row of a chunk is kept in the chunk below), so it comes and goes with
// that chunk's objects. It is made only when every chunk under its footprint is loaded too (it reads the ground there):
// never a chunk generated on the main thread in the middle of a frame (a 40–60 ms hitch walking into a city — docs/
// REINOS.md "Fase 2 — correções e desempenho"). A piece waiting for a chunk is made when that chunk arrives (T.wait).
// per layout: { at: chunk → sorted piece indices, of: piece index → its chunk, need: piece index → [other chunks under it]
// (only when there are) }
const BYCHUNK = new WeakMap();
const chunkOfXY = (x, y) => ((Math.floor(x) & 16383) >> 6) + (Math.floor(y) >> 6) * 256;
const GEO = { type: '', tx: 0, ty: 0, rot: 0 };
function chunkIndexOf(L) {
  let M = BYCHUNK.get(L);
  if (!M) {
    M = { at: new Map(), need: new Map(), of: new Int32Array(L.structs.length).fill(-1) };
    L.structs.forEach((r, k) => {
      const [type, tx, ty, rot] = r;
      if (!BUILDINGS[type]) return;
      GEO.type = type; GEO.tx = tx; GEO.ty = ty; GEO.rot = normRot(type, rot);
      setGeom(GEO);
      const cc = chunkOfXY(GEO.x, GEO.y);
      M.of[k] = cc;
      let a = M.at.get(cc);
      if (!a) M.at.set(cc, (a = []));
      a.push(k);
      let need = null;
      for (const [x, y] of [[tx, ty], [tx + GEO.fw - 1, ty], [tx, ty + GEO.fh - 1], [tx + GEO.fw - 1, ty + GEO.fh - 1]]) {
        const c2 = chunkOfXY(x, y);
        if (c2 !== cc && !(need && need.includes(c2))) (need || (need = [])).push(c2);
      }
      if (need) M.need.set(k, need);
    });
    BYCHUNK.set(L, M);
  }
  return M;
}
function piecesIn(L, c) { return chunkIndexOf(L).at.get(c) || null; }
const pieceId = (sid, k) => `t${sid}.${k}`;
function liveOf(game, sid) {
  const T = game.towns;
  let r = T.live.get(sid);
  if (!r) { r = { sid, objs: new Map(), chunks: new Set(), animals: [], pens: new Set() }; T.live.set(sid, r); }
  return r;
}

// a job: place the pieces of settlement sid kept in chunk c (resumable: k = next piece index in the chunk's list; ks: only
// these pieces — the ones that waited for another chunk under them)
function runJob(game, job, deadline) {
  const T = game.towns, w = game.world;
  if (!w.isLoaded(job.c)) return true;
  const L = T.layout(job.sid), I = chunkIndexOf(L), list = job.ks || I.at.get(job.c);
  if (!list) return true;
  const rec = liveOf(game, job.sid);
  rec.chunks.add(job.c);
  let k = job.k || 0;
  const t0 = performance.now();
  const Lv = game.levels;
  w._layout = (w._layout || 0) + 1;
  TOWN.quiet++;
  try {
    game.net.withApply(() => {
      for (; k < list.length; k++) {
        if (deadline && k > (job.k || 0) && performance.now() > deadline) break;
        const pk = list[k], need = I.need.get(pk);
        const miss = need && need.find((c2) => !w.isLoaded(c2));
        if (miss != null) { // (a chunk under it is not here yet: made when it arrives)
          let q = T.wait.get(miss);
          if (!q) T.wait.set(miss, (q = []));
          q.push([job.sid, job.c, pk]);
          continue;
        }
        // the levels map (stairs, wall tops) follows the new piece without a full rebuild over the whole list (levels.js)
        const v0 = game.build.v, o = placePiece(game, L, job.sid, pk, rec);
        if (o && Lv && Lv.v === v0) Lv.addPiece(o);
      }
    });
  } finally { TOWN.quiet--; w._layout--; }
  const ms = performance.now() - t0;
  T.stats.ms += ms; T.stats.maxMs = Math.max(T.stats.maxMs, ms);
  job.k = k;
  if (k < list.length) return false;
  // done: the minimap re-draws the chunk once (the pieces were placed quietly)
  game.events?.emit('tile', { tx: (job.c & 255) * 64 + 32, ty: (job.c >>> 8) * 64 + 32 });
  if (game.net.auth) T.penQ.push([job.sid, job.c]); // (its pens' animals: a few a frame, townsSystem)
  return true;
}
// the shared state row of piece k, only when it was written for that very piece (its tile): a row kept by an older build
// of the plan (a save from before a layout change: the indices moved) never lands on another piece
function stateOf(game, L, sid, k) {
  const st = game.towns.state.get(pieceId(sid, k)), r = L.structs[k];
  return st && r && st.x === r[1] && st.y === r[2] ? st : null;
}
function placePiece(game, L, sid, k, rec) {
  const w = game.world, id = pieceId(sid, k);
  if (rec.objs.has(k) || w.objById.has(id)) return;
  const st = stateOf(game, L, sid, k);
  if (st?.gone) return;
  const [type, tx, ty, rot, lv, style, det] = L.structs[k];
  const def = BUILDINGS[type];
  if (!def) return;
  // pieces of the fields / pens never stand in water or rock (the outer ring is the natural ground), nor over a player's
  const i = w.idx(tx, ty);
  if (!lv && (w.water.get(i) || w.rock.get(i)) && !def.roof) return;
  if (game.build.grid[def.layer || 'main'].has(i + (lv | 0) * w.W * w.H)) return; // (a player's piece there, or another of the place's)
  const open = st && st.open >= 0 ? !!st.open : def.block === 'door' ? !!def.gate2 : false; // (a gate open, a house door closed)
  const o = placeStructure(game, type, tx, ty, { id, rot, lv, style, det, progress: 1, open, town: sid, builtAt: 0 });
  if (st?.dmg) o.dmg = st.dmg / 100;
  // (cosmetic: the side a gate's leaves swing to — inside; the kingdom's colour on the mural)
  if (def.gate2) o._in = (rot & 1) ? (L.x < o.x ? 1 : -1) : (L.y > o.y - 0.5 ? 1 : -1);
  if (type === 'town_mural') { const K = game.towns.realm.kingdoms[game.towns.realm.settlements[sid].k]; o._kc = K.color.map((v) => v / 255); o._kc2 = (METALS[K.banner.m] || METALS.or).map((v) => v / 255); rec.mural = o; }
  rec.objs.set(k, o);
  game.towns.stats.placed++;
  return o;
}

// the chunk is dropped: its pieces go with it (not destroyed: TOWN.unloading), its animals too (host)
function unloadChunk(game, c) {
  const T = game.towns;
  T.jobs = T.jobs.filter((j) => j.c !== c);
  const e = realmIndex(T.realm).get(c);
  if (!e?.s.length) return;
  const w = game.world, gone = [];
  for (const sid of e.s) {
    const rec = T.live.get(sid);
    if (!rec || !rec.chunks.has(c)) continue;
    rec.chunks.delete(c);
    const L = layoutCached(T.realm, sid), list = L && piecesIn(L, c);
    if (list) for (let n = list.length - 1; n >= 0; n--) { const o = rec.objs.get(list[n]); if (o) { gone.push(o); rec.objs.delete(list[n]); } }
    if (game.net.auth) dropAnimals(game, rec, c);
    if (!rec.chunks.size) T.live.delete(sid);
  }
  if (!gone.length) return;
  w._layout = (w._layout || 0) + 1;
  TOWN.quiet++; TOWN.unloading++;
  try { game.net.withApply(() => { for (const o of gone) removeStructure(game, o, { quiet: true, keepList: true }); }); }
  finally { TOWN.unloading--; TOWN.quiet--; w._layout--; }
  game.build.structures = game.build.structures.filter((o) => !o.removed);
  T.stats.unloaded += gone.length;
}

// is settlement sid all made on this peer? Every chunk holding its pieces within `near` chunks of its middle is loaded and
// done (no job, no piece waiting for a chunk under it)
function townReady(game, sid, near = 2) {
  const T = game.towns, w = game.world, L = T.layout(sid), rec = T.live.get(sid);
  if (!L || !rec) return false;
  const cx = (Math.floor(L.x) >> 6) & 255, cy = Math.floor(L.y) >> 6;
  for (const c of chunkIndexOf(L).at.keys()) {
    let dx = Math.abs((c & 255) - cx); if (dx > 128) dx = 256 - dx;
    if (Math.max(dx, Math.abs((c >>> 8) - cy)) > near) continue;
    if (!w.isLoaded(c) || !rec.chunks.has(c)) return false;
  }
  if (T.jobs.some((j) => j.sid === sid)) return false;
  for (const q of T.wait.values()) for (const e of q) if (e[0] === sid && w.isLoaded(e[1])) return false;
  return true;
}

// shared state changed under loaded pieces (a snapshot / chunk diff / town.restore): put them back in step
function resyncPieces(game, ids) {
  const T = game.towns, w = game.world;
  if (!T.realm) return;
  const back = [];
  for (const id of ids) {
    if (!TOWN_ID.test(id)) continue;
    const [sid, k] = id.slice(1).split('.').map(Number);
    const rec = T.live.get(sid), L = layoutCached(T.realm, sid);
    if (!rec || !L || !L.structs[k]) continue;
    const c = chunkIndexOf(L).of[k];
    if (!rec.chunks.has(c)) continue;
    const st = stateOf(game, L, sid, k), o = rec.objs.get(k);
    if (st?.gone) { if (o) { rec.objs.delete(k); w._layout = (w._layout || 0) + 1; TOWN.unloading++; try { game.net.withApply(() => removeStructure(game, o, { quiet: true })); } finally { TOWN.unloading--; w._layout--; } } continue; }
    if (!o) {
      const need = chunkIndexOf(L).need.get(k), miss = need && need.find((c2) => !w.isLoaded(c2));
      if (miss != null) { let q = T.wait.get(miss); if (!q) T.wait.set(miss, (q = [])); q.push([sid, c, k]); continue; } // (made with that chunk)
      back.push([sid, k, rec, L]);
      continue;
    }
    const want = st && st.open >= 0 ? !!st.open : defaultOpen(o);
    if (o.door && !!o.open !== want) { TOWN.quiet++; try { game.net.withApply(() => setDoorOpen(game, o, want)); } finally { TOWN.quiet--; } }
    const d = st?.dmg ? st.dmg / 100 : 0;
    if ((o.dmg || 0) !== d) { if (d) o.dmg = d; else delete o.dmg; }
  }
  if (back.length) {
    w._layout = (w._layout || 0) + 1;
    try { game.net.withApply(() => { for (const [sid, k, rec, L] of back) placePiece(game, L, sid, k, rec); }); } finally { w._layout--; }
  }
}

// ---------- the level of a kingdom's people (phase 2: NPCs — docs/REINOS.md §7b) ----------
// baseLevel: the distance from the world start, like the creatures (mobs.js levelForDistance) — a pure function of the
// place, never stored with the settlement. The people follow the most advanced player (worldProgress) up to the level of
// the farthest settlements: the kingdoms near the start grow with the players instead of staying weak for ever.
// (phase 2: worldProgress may become a saved high-water mark; this is the one place to change)
export function realmBaseLevel(game, s) {
  const w = game.world, sp = w.spawn;
  return levelForDistance(Math.hypot(w.dx(s.x, sp.x), s.y - sp.y));
}
export function worldProgress(game) {
  let lv = 1;
  for (const p of allPlayers(game)) if (p && (p.level || 1) > lv) lv = p.level || 1;
  return lv;
}
const CAPS = new WeakMap(); // realm → the base level of its farthest settlement (per world start)
export function realmNpcLevel(game, s) {
  const R = game.towns?.realm, sp = game.world.spawn;
  let c = R && CAPS.get(R);
  if (R && (!c || c.x !== sp.x || c.y !== sp.y)) { c = { x: sp.x, y: sp.y, cap: 1 }; for (const q of R.settlements) c.cap = Math.max(c.cap, realmBaseLevel(game, q)); CAPS.set(R, c); }
  const base = realmBaseLevel(game, s);
  return Math.max(base, Math.min(c ? c.cap : base, worldProgress(game)));
}

// ---------- queries ----------
function info(game, sid) {
  const realm = game.towns?.realm, s = realm?.settlements[sid];
  if (!s) return null;
  const K = realm.kingdoms[s.k];
  return { id: s.id, name: s.name, kind: s.kind, kindPt: KIND_PT[s.kind], pop: s.pop, x: s.x, y: s.y, r: s.r, walls: s.walls, kingdom: K,
    capital: realm.settlements[K.capital], neighbours: K.neighbours.map((k) => realm.kingdoms[k]) };
}
// where a point is: { k (kingdom id | −1), kingdom, town (the settlement whose town land holds it) | null, district }
const PLACE = { k: -1, kingdom: null, town: null, district: null };
function placeAt(game, x, y) {
  const realm = game.towns?.realm;
  if (!realm) { PLACE.k = -1; PLACE.kingdom = PLACE.town = PLACE.district = null; return PLACE; }
  const k = kingdomAt(realm, x, y);
  PLACE.k = k; PLACE.kingdom = k >= 0 ? realm.kingdoms[k] : null;
  PLACE.town = settlementAt(realm, x, y);
  PLACE.district = k >= 0 ? districtAt(realm, x, y) : null;
  return PLACE;
}
// the settlement whose town land holds a tile rect (null: none)
export function townLandAt(game, tx, ty, w = 1, h = 1) {
  const realm = game.towns?.realm;
  if (!realm) return null;
  for (const [x, y] of [[tx, ty], [tx + w - 1, ty], [tx, ty + h - 1], [tx + w - 1, ty + h - 1]]) { const s = settlementAt(realm, x + 0.5, y + 0.5); if (s) return s; }
  return null;
}

// ---------- rules (mut/structures.js hooks) ----------
TOWN.landReason = (game, type, tx, ty, w, h) => {
  if (game.creative) return null;
  const s = townLandAt(game, tx, ty, w, h);
  if (!s) return null;
  if (s.kind === 'castle') return `${s.name}: não se constrói no castelo`;
  return `Terra de ${s.name}: compre um terreno no mural`;
};
TOWN.refuse = (game, o) => { const s = game.towns?.realm?.settlements[o.town]; return s ? `Isto pertence a ${s.name}` : 'Isto pertence ao lugar'; };
TOWN.gateReason = (game, o, actor) => {
  if (o.town != null) return defOf(o).gate2 ? 'O portão é da guarda: abre de dia e fecha à noite' : null;
  if (!defOf(o).gate2 || game.creative) return null;
  const g = game.gates?.get(o.id);
  if (g?.owner && g.owner !== actor.pid) return 'Só o dono abre e fecha este portão';
  return null;
};

// ---------- village animals (host): the pens' cows, sheep, pigs and chickens, owned by the place ----------
// the animals of the pens of chunk c (one pen after another until `end`: false = more to do)
function penAnimals(game, L, rec, c, end = 0) {
  for (let n = 0; n < L.pens.length; n++) {
    const p = L.pens[n];
    const cx = (((p.x0 + p.x1) >> 1) >> 6) & 255, cy = ((p.y0 + p.y1) >> 1) >> 6;
    if (rec.pens.has(n) || !game.world.isLoaded(cx + cy * 256)) continue; // (any pen whose ground is here: the pieces are kept by their anchor chunk, c is only the one just made)
    void c;
    if (end && performance.now() > end) return false;
    rec.pens.add(n);
    for (let k = 0; k < p.n; k++) {
      const x = p.x0 + 0.5 + ((k * 2.3 + n) % Math.max(1, p.x1 - p.x0 - 1)), y = p.y0 + 0.6 + ((k * 1.7) % Math.max(1, p.y1 - p.y0 - 1));
      const m = spawnStock(game, p.species, x, y, { owned: false, level: 1 });
      m.town = L.sid; m.townPen = n; m.spawner = null; m.camp = 'town' + L.sid; // (out of the players' farm logic: livestock.js)
      m.home = { x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 };
      rec.animals.push(m);
    }
  }
  return true;
}
function dropAnimals(game, rec, c) {
  const E = game.entities;
  rec.animals = rec.animals.filter((m) => {
    const ac = ((Math.floor(m.home.x) >> 6) & 255) + (Math.floor(m.home.y) >> 6) * 256;
    if (ac !== c) return true;
    const i = E.indexOf(m); if (i >= 0) E.splice(i, 1); // sync-ok: host-only creature list (guests get proxies from net/entities.js)
    rec.pens.delete(m.townPen);
    return false;
  });
}

// ---------- the systems ----------
export function townsSystem() {
  let t = 0;
  return {
    sync: 'all', // materialization runs on every peer (the pieces are each peer's own, made from the seed)
    update(game, dt) {
      const T = game.towns;
      if (!T?.realm) return;
      if (T.jobs.length) {
        const p = game.player, pc = game.world.chunkIndex(p.x, p.y), pcx = pc & 255, pcy = pc >>> 8;
        const dist = (c) => { let dx = Math.abs((c & 255) - pcx); if (dx > 128) dx = 256 - dx; return Math.max(dx, Math.abs((c >>> 8) - pcy)); };
        const near = (c) => dist(c) <= 1;
        // the chunks around the local player at once (it may stand there now), the rest within the frame budget, nearest first
        T.jobs.sort((a, b) => (dist(a.c) - dist(b.c)) || a.c - b.c || a.sid - b.sid);
        // (next to the player: a bigger slice of the frame — it may be standing there after a teleport / a join)
        const t0 = performance.now(), deadline = t0 + BUDGET_MS, urgentEnd = t0 + URGENT_MS;
        while (T.jobs.length) {
          const j = T.jobs[0], urgent = near(j.c);
          if (performance.now() > (urgent ? urgentEnd : deadline)) break;
          if (!runJob(game, j, urgent ? urgentEnd : deadline)) break;
          T.jobs.shift();
          T.stats.jobs++;
        }
      }
      // host: the pens' animals, within a small slice of the frame (a new world fills ~8 places at once)
      if (T.penQ.length && game._townsUp && game.net.auth) {
        const end = performance.now() + PEN_MS;
        while (T.penQ.length && performance.now() < end) {
          const [sid, c] = T.penQ[0], rec = T.live.get(sid), L = layoutCached(T.realm, sid);
          if (rec && L && rec.chunks.has(c) && !penAnimals(game, L, rec, c, end)) break;
          T.penQ.shift();
        }
      }
      t -= dt;
      if (t > 0) return;
      t = 1;
      if (game.net.auth) hostTick(game);
    },
  };
}
// host: gates, repairs, animals that wandered off
function hostTick(game) {
  const T = game.towns, net = game.net, night = isNight(game);
  if (!game._townsUp) { game._townsUp = true; for (const rec of T.live.values()) for (const c of rec.chunks) T.penQ.push([rec.sid, c]); }
  for (const rec of T.live.values()) {
    const L = layoutCached(T.realm, rec.sid);
    if (!L) continue;
    const want = !night && !hostileInside(game, L);
    for (const k of L.gates) {
      const o = rec.objs.get(k);
      if (!o || o.removed || !!o.open === want) continue;
      if (!want && passageBusy(game, o)) continue;
      net.emit('door.set', { id: o.id, open: want ? 1 : 0, by: 'town' });
    }
  }
  // players' gates on automatic
  for (const [id, g] of game.gates) {
    if (!g.auto) continue;
    const o = game.world.objById.get(id);
    if (!o || o.blueprint || o.removed || !!o.open === !night) continue;
    if (night && passageBusy(game, o)) continue;
    net.emit('door.set', { id, open: night ? 0 : 1, by: 'auto' });
  }
  // rebuilding: destroyed pieces come back after a while with nobody near
  const day = game.env?.dayLength || 780, ids = [];
  for (const [id, r] of T.state) {
    if (!r.gone || game.worldTime - r.at < RESTORE_AFTER * day) continue;
    if (minPlayerDist(game, r.x + 0.5, r.y + 0.5) < RESTORE_FAR) continue;
    ids.push(id);
    if (ids.length >= 200) break;
  }
  if (ids.length) net.emit('town.restore', { ids });
}
// hostile creatures inside the town land (raiders, wolves, the winter dead)
function hostileInside(game, L) {
  const r2 = (L.r + 2) * (L.r + 2), w = game.world;
  for (const e of game.entities) {
    if (e.dead || !e.isMob || e.proxy || e.temper !== 'hostile') continue;
    const dx = w.dx(e.x, L.x), dy = e.y - L.y;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}
function passageBusy(game, o) {
  const x0 = o.tx, y0 = o.ty, x1 = o.tx + (o.fw || 1), y1 = o.ty + (o.fh || 1);
  const inside = (e) => e && !e.dead && e.x + 0.2 > x0 && e.x - 0.2 < x1 && e.y + 0.2 > y0 && e.y - 0.2 < y1;
  for (const p of allPlayers(game)) if (inside(p)) return true;
  for (const e of game.entities) if (e.isMob && !e.proxy && inside(e)) return true;
  return false;
}

// local: the place the player is in (cosmetic: the HUD banner, ui/placebanner.js)
export function placeSystem() {
  let t = 0, last = null;
  return {
    sync: 'cosmetic',
    update(game, dt) {
      t -= dt;
      if (t > 0 || !game.towns?.realm) return;
      t = 0.5;
      const p = game.player;
      if (p.dead) return;
      // the murals call a player who never opened one: a gold "!" over them (art/faces/gates.js), and once a hint nearby
      const H = game.ctl?.hinted, unseen = !H?.mural;
      for (const rec of game.towns.live.values()) {
        const m = rec.mural;
        if (!m || m.removed) continue;
        m._mark = unseen;
        if (unseen && H && !H.muralTip && Math.hypot(game.world.dx(m.x, p.x), m.cy - p.y) < 9) {
          H.muralTip = true; // sync-ok: a local hint flag (player save)
          game.events.emit('toast', { text: `Veja o mural ${game.input?.isTouch ? '(toque nele)' : '(E)'}: o lugar, o reino e o que há para fazer`, kind: 'info' });
        }
      }
      const P = placeAt(game, p.x, p.y), key = `${P.k}|${P.town ? P.town.id : -1}`;
      if (key === last) return;
      const first = last == null;
      last = key;
      game.towns.here = { k: P.k, town: P.town ? P.town.id : -1, district: P.district ? P.district.id : -1 };
      game.events.emit('place', { kingdom: P.kingdom, town: P.town, district: P.district, first });
    },
  };
}
