// The winter attacks on the settlements (owner, docs/REINOS.md §1 "Ataques aos lugares no inverno" and §16): on the
// nights of each region's bad season (the same rule that brings that region's dead — undead.js nightFamilyAt: the walkers'
// winter, the warm zone's mild winter, the tropics' dry season) the region's dead come at the villages, castles and cities —
// a wave a bit smaller than the place's live guards (a giant may lead it), from one side, against the walls / the gate /
// the palisade / the edge of an open village, so the town's defense plays out (§11: the bell, the archers on the walls,
// the melee at the gates and the stretch attacked, the gaps held, the civilians at home). The humans win almost always;
// rarely (~5 %, calibrated: game/raidsim.js, tools/raid-calib.mjs) the defense breaks — a lost night kills some guards
// and townsfolk and damages the place, never all of it; the next day the people rebuild (the player's rented house too,
// never the player's private property: his bought house and what he built on his plot wait for him — "Consertar").
//
// Host (raidsSystem, every 0.5 s):
//   - at dusk the night is planned: each place in its bad season is attacked with RAID.chance (polar: chancePolar), at a
//     random hour of the dark, from a random side; a horde with RAID.horde.p (a pure hash of the world, the place and the
//     night: the same plan after a reload);
//   - when its hour comes: with a player within RAID.liveR of the place the wave is LIVE — the region's dead as creatures
//     (walkers.js / giants.js, at most RAID.liveCap at once, the rest walking in as the first ones fall), each one × the
//     wave's fury (raidsim.js furyOf: a monster ≈ 1 / par of a melee guard of the place), drawn to the place's middle
//     through its wall; all the guards of the place come out as creatures (people.js manage) and fight. The defense
//     breaks (op raid.fall) when few melee guards are left and the dead still stand; the wave is over when its dead are
//     all down, at dawn (they crumble) or — the players gone — by numbers from where it stood;
//   - far from every player the attack is fought BY NUMBERS at once (raidsim.js fight): the dead (op raid.end: replaced
//     1.5 days later like any death), the wall cracked on that side (lost: the breach, maybe the gate, houses broken into)
//     — in the shared town state like a siege by numbers;
//   - by day, far from the players, the pieces destroyed by an attack are rebuilt by numbers from the next morning (the
//     creatures do it by hand near the players: npc.js repairTick) — never a player's owned house (TOWN.privatePiece).
// Every peer: game.raids (mut/raids.js: the attacks going on, the log), the notices (ui/raidHud.js), "Consertar" /
// "Reconstruir" on the player's own property (forNear + building.js 'repair').

import { RAID } from './content/raids.js';
import { guardsOf, planWave, fight, FAMILY_MOB, FAMILY_GIANT, unitStats } from './raidsim.js';
import { raidsState, FIX_STEP } from './mut/raids.js';
import { deadMap } from './mut/people.js';
import { TOWN } from './mut/structures.js';
import { BUILDINGS, SPECIES } from './data.js';
import { nightFamilyAt, mildBad, ARID } from './undead.js';
import { ZONES, nightK } from './seasons.js';
import { realmNpcLevel } from './towns.js';
import { levelForDistance } from './mobs.js';
import { allPlayers, inAnyView } from './players.js';
import { killMob } from './combat.js';
import { perimeterOf } from './defense.js';
import { propsOf, meUid } from './eco.js';
import { spawnRaidMob } from './walkers.js';
import { spawnRaidGiant } from './giants.js';
import { mobBlocked } from './nav.js';
import { registerWork, hitsFor } from './gathering.js';

const realmOf = (game) => game.towns?.realm || null;
const h32 = (...v) => { let h = 2166136261; for (const x of v) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; } return h >>> 0; };
const h01 = (...v) => h32(...v) / 4294967296;
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const NIGHT_H = 11 / 300; // game hours a real second at night (calendar.js hourRate)
const hourS = (game, h) => (h * (game.env?.dayLength || 780)) / 780 / NIGHT_H; // real seconds of h game hours of the night
const darkLeft = (game, hour) => hourS(game, (hour >= 12 ? 24 - hour + 5.4 : Math.max(0, 5.4 - hour)));
const dayHourS = (game) => ((game.env?.dayLength || 780) / 780) * (480 / 13); // real seconds of a game hour by day
export const SIDE_PT = ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'];
export const FAM_PT = { ice: ['Andarilhos do Gelo', 'andarilhos'], bone: ['Esqueletos', 'esqueletos'], sand: ['Múmias', 'múmias'] };

// ---------- the family of a place's nights (every peer: the same answer) ----------
// loaded: the walkers' own rule at its middle; far: the planet's macro climate there (its season slot) and biome
function placeFamily(game, s) {
  const w = game.world;
  if (w.isLoaded?.(w.chunkIndex(s.x, s.y))) return nightFamilyAt(game, s.x, s.y);
  const H = game.raids.H, z = zoneOf(game, s), S = game.seasons?.[z + (w.hemiAt ? w.hemiAt(Math.floor(s.y)) * ZONES : 0)];
  if (!S?.id) return null;
  if (S.hard) return 'ice';
  if (!mildBad(S)) return null;
  let d = H.desert.get(s.id);
  if (d == null) {
    const P = w.source?.planet, keys = w.source?.biomeKeys;
    d = !!(P?.biome && keys) && ARID.has(keys[P.biome[Math.max(0, Math.min(255, Math.floor(s.y / 32))) * 512 + (((Math.floor(s.x / 32)) % 512) + 512) % 512]]);
    H.desert.set(s.id, d);
  }
  return d ? 'sand' : 'bone';
}
function zoneOf(game, s) {
  const H = game.raids.H;
  let z = H.zone.get(s.id);
  if (z == null) { z = game.world.source?.climateAt?.(s.x, s.y)?.zone ?? 2; H.zone.set(s.id, z); }
  return z;
}
// does the family bring its giant here (undead.js giantHere: the humid tropics' skeletons come alone)
const giantOk = (game, s, fam) => fam !== 'bone' || zoneOf(game, s) === 1;

// ---------- the place as the numbers see it ----------
function placeOf(game, s, fam, hour) {
  const g = guardsOf(s), D = deadMap(game);
  let archers = 0, melee = 0;
  for (let i = 0; i < g.n; i++) { if (D.has(`${s.id}.${i}`)) continue; if (i < g.archers) archers++; else melee++; }
  const w = game.world, sp = w.spawn;
  return {
    sid: s.id, kind: s.kind, walls: s.walls || null, pop: s.pop, fam, giantOk: giantOk(game, s, fam),
    glv: realmNpcLevel(game, s), mlv: Math.max(2, levelForDistance(Math.hypot(w.dx(s.x, sp.x), s.y - sp.y) + s.r + RAID.spawnOut, 2)), // (where the wave comes from: walkers.js levels it there)
    guards: { n: archers + melee, melee, archers }, g0: g, dark: darkLeft(game, hour),
  };
}

// ---------- private property (every peer: the shared economy says whose it is) ----------
// the house (from the economy's list: for sale / for rent) a piece of the plan k belongs to — its box holds the piece's tile
export function houseOf(game, sid, k) {
  const L = game.towns?.layout?.(sid), r = L?.structs[k];
  if (!r) return null;
  for (const h of propsOf(game, sid).houses) { const [x0, y0, x1, y1] = h.box; if (r[1] >= x0 && r[1] <= x1 && r[2] >= y0 && r[2] <= y1) return h; }
  return null;
}
// a piece of a house a player OWNS (bought): the townsfolk never mend / rebuild it (owner's rule); rented ones they do
export function privatePiece(game, id) {
  const pr = game.eco?.pr;
  if (!pr?.size || typeof id !== 'string') return false;
  const m = /^t(\d+)\.(\d+)$/.exec(id);
  if (!m) return false;
  let any = false;
  for (const [pid, row] of pr) if (row.mode === 'own' && pid.startsWith(`h${m[1]}.`)) { any = true; break; }
  if (!any) return false;
  const h = houseOf(game, +m[1], +m[2]);
  return !!h && game.eco.pr.get(h.id)?.mode === 'own';
}
// the plot (owned by a player) a structure of a player stands on, inside a town land: { pl, row } | null
function plotOf(game, o) {
  const pr = game.eco?.pr;
  if (!pr?.size || o.town != null) return null;
  const s = game.towns?.at?.(o.x, o.y)?.town;
  if (!s) return null;
  for (const pl of propsOf(game, s.id).plots) {
    if (o.tx < pl.x0 || o.tx > pl.x1 || o.ty < pl.y0 || o.ty > pl.y1) continue;
    const row = pr.get(pl.id);
    return row ? { pl, row, s } : null;
  }
  return null;
}
export const privateStruct = (game, o) => !!plotOf(game, o);

// ---------- install (every peer) ----------
export function installRaids(game) {
  const R = raidsState(game);
  R.H = { plan: new Map(), planned: null, live: new Map(), zone: new Map(), desert: new Map(), off: false, rebT: 0, stats: { ticks: 0, ms: 0, maxMs: 0, far: 0, live: 0, planned: 0, farMs: 0 } };
  Object.assign(R, {
    houseOf: (sid, k) => houseOf(game, sid, k),
    privatePiece: (id) => privatePiece(game, id),
    privateStruct: (o) => privateStruct(game, o),
    familyOf: (sid) => { const s = realmOf(game)?.settlements[sid]; return s ? placeFamily(game, s) : null; },
    lastOf: (sid) => { for (let i = R.log.length - 1; i >= 0; i--) if (R.log[i][1] === sid) return R.log[i]; return null; },
    onHit: (m, o, d, gone) => onHit(game, m, o, d, gone),
    liveOf: (sid) => R.H.live.get(sid) || null,
    forNear: (consider) => forNear(game, consider),
    damageOf: (propId) => damageOf(game, propId),
    mayRepair: (o) => mayRepair(game, o),
    dbg: makeDebug(game),
  });
  TOWN.privatePiece = (g, id) => privatePiece(g, id);
  return R;
}

// ---------- host: the night's plan ----------
const nightKeyOf = (E) => (E.hour >= 12 ? E.dayIndex : E.dayIndex - 1);
function planNight(game, key) {
  const R = game.raids, H = R.H, realm = realmOf(game), E = game.env, seed = game.world.seed | 0;
  H.plan.clear();
  H.planned = key;
  const done = new Set(R.log.filter((r) => r[0] === key).map((r) => r[1]));
  for (const s of realm.settlements) {
    if (done.has(s.id) || R.on.has(s.id)) continue;
    const fam = placeFamily(game, s);
    if (!fam) continue;
    if (game.realms?.besieged?.(s.id)) continue; // (an army camped before it: the dead keep away from the soldiers)
    const polar = zoneOf(game, s) === 4;
    if (h01(seed, s.id, key, 1) >= (polar ? RAID.chancePolar : RAID.chance)) continue;
    const span = (RAID.hours[1] + 24 - RAID.hours[0]) % 24, hr = (RAID.hours[0] + span * h01(seed, s.id, key, 2)) % 24;
    // hours from now to hr (the night: from the evening across midnight)
    const now = E.hour, toH = (hr - now + 24) % 24;
    if (toH > 12) continue; // (its hour went by already: a night planned late — a reload, a skip)
    H.plan.set(s.id, { sid: s.id, fam, key, hour: hr, at: game.worldTime + hourS(game, toH), side: Math.floor(h01(seed, s.id, key, 3) * 8) & 7, horde: h01(seed, s.id, key, 4) < RAID.horde.p, seed: h32(seed, s.id, key, 5) });
  }
  H.stats.planned += H.plan.size;
}

// ---------- host: the system ----------
export function raidsSystem() {
  let t = 0;
  return {
    sync: 'host', // the attacks are decided on the host (mut/raids.js replicates them)
    update(game, dt) {
      const R = game.raids, H = R?.H;
      if (!H || !realmOf(game) || !game.towns?.layout) return;
      for (const rec of H.live.values()) feedLive(game, rec, dt);
      t -= dt;
      if (t > 0) return;
      t = 0.5;
      const t0 = performance.now();
      const E = game.env, night = nightK(E.hour) > 0.5;
      // the night's plan at dusk (every bad night)
      if (!H.off && night) { const key = nightKeyOf(E); if (H.planned !== key) planNight(game, key); }
      // their hour came: live near a player, else by numbers (a few a tick)
      let far = 0;
      if (!H.off) for (const P of [...H.plan.values()]) {
        if (game.worldTime < P.at) continue;
        const s = realmOf(game).settlements[P.sid];
        if (R.on.has(P.sid)) { H.plan.delete(P.sid); continue; }
        if (night && nearPlayer(game, s, RAID.liveR) && game.people?.of && placeReadyLive(game, s)) { H.plan.delete(P.sid); startLive(game, s, P); continue; }
        if (far >= 3) break;
        H.plan.delete(P.sid);
        resolveFar(game, s, P);
        far++;
      }
      for (const rec of [...H.live.values()]) tickLive(game, rec, night);
      // the next day: the pieces destroyed by an attack rebuilt by numbers far from the players
      H.rebT -= 0.5;
      if (H.rebT <= 0) { H.rebT = dayHourS(game); rebuildByNumbers(game); }
      const ms = performance.now() - t0, S = H.stats;
      S.ticks++; S.ms += ms; S.maxMs = Math.max(S.maxMs, ms);
    },
  };
}
const nearPlayer = (game, s, r) => { const w = game.world; for (const q of allPlayers(game)) if (!q.dead && Math.hypot(w.dx(q.x, s.x), q.y - s.y) < s.r + r) return true; return false; };
// the place is made here (its pieces, its people): a live wave needs its walls
const placeReadyLive = (game, s) => !!game.towns.live?.get(s.id) && !!game.people?.live?.has(s.id);

// ---------- live: the wave as creatures ----------
function startLive(game, s, P, o = {}) {
  const R = game.raids, H = R.H, E = game.env;
  const place = placeOf(game, s, P.fam, E.hour), rnd = rngOf(P.seed);
  const W = planWave(place, rnd, { horde: P.horde, n: o.n, giant: o.giant });
  const a = (P.side * Math.PI) / 4, cx = s.x, cy = s.y;
  const rec = {
    sid: s.id, s, P, W, place, side: P.side, fx: Math.cos(a), fy: Math.sin(a), cx, cy, total: W.units + (W.giant ? 1 : 0), out: 0, ents: new Set(), killed: 0,
    t0: game.worldTime, feedT: 0, group: { id: 'r' + s.id + '.' + (P.key | 0), x: cx, y: cy, members: [], fam: P.fam }, giantLeft: !!W.giant,
    deadStart: new Set([...deadMap(game).keys()].filter((k) => k.startsWith(s.id + '.'))), fell: false, homes: new Set(), priv: new Map(), lose: !!o.lose,
  };
  H.live.set(s.id, rec);
  H.stats.live++;
  game.net.emit('raid.start', { sid: s.id, day: P.key | 0, fam: P.fam, n: W.n, g: place.guards.n, giant: W.giant || undefined, horde: W.horde ? 1 : 0, side: P.side, at: Math.round(game.worldTime), live: 1 });
  feedLive(game, rec, 0, true);
  return rec;
}
// the wave comes out of the dark on its side (out of sight when it can), a few at a time up to the cap
function spawnSpot(game, rec, k) {
  const s = rec.s, w = game.world, R0 = s.r + RAID.spawnOut, tx = -rec.fy, ty = rec.fx;
  let best = null;
  for (let n = 0; n < 14; n++) {
    const off = ((k * 7 + n * 5) % 13) - 6, r = R0 + ((k + n) % 4) * 1.5;
    const x = rec.cx + rec.fx * r + tx * off, y = rec.cy + rec.fy * r + ty * off;
    if (!w.inBounds(Math.floor(x), Math.floor(y)) || mobBlocked(w, x, y, 0.3) || w.waterAt(Math.floor(x), Math.floor(y)) === 2) continue;
    if (!inAnyView(game, x, y, 2, 3)) return [x, y];
    if (!best) best = [x, y];
  }
  return best;
}
function feedLive(game, rec, dt, burst = false) {
  if (rec.done) return;
  rec.feedT -= dt;
  const cap = Math.max(4, Math.round(RAID.liveCap * (game.quality === 'low' ? 0.6 : 1)));
  let made = 0;
  while (rec.out < rec.total && rec.ents.size < cap && (burst ? made < 8 : rec.feedT <= 0)) {
    const giant = rec.W.giant && rec.out === 0; // (the giant leads it)
    const at = spawnSpot(game, rec, rec.out);
    if (!at) break;
    const home = { x: rec.cx, y: rec.cy };
    const m = giant ? spawnRaidGiant(game, at[0], at[1], rec.W.giant, rec.group, home) : spawnRaidMob(game, at[0], at[1], rec.W.species, rec.group, home);
    m.raid = rec.sid; m.raidAt = { x: rec.cx, y: rec.cy };
    // the wave's fury (raidsim.js furyOf / the horde): hp and damage
    m.hp = m.maxHp = Math.round(m.maxHp * rec.W.fury); m.dmg *= rec.W.fury;
    if (rec.W.horde) m.horde = 1;
    rec.ents.add(m);
    rec.out++; made++;
    rec.feedT = burst ? 0 : RAID.feedEvery;
    if (!burst) break;
  }
}
// what the live wave has done (host, every 0.5 s)
function tickLive(game, rec, night) {
  const s = rec.s;
  for (const m of [...rec.ents]) if (m.dead) { rec.ents.delete(m); rec.killed++; if (m.giant) rec.giantLeft = false; }
  const left = rec.ents.size + (rec.total - rec.out);
  // the guards of the place fallen since it came (people.js town.pop)
  const g = guardsOf(s), D = deadMap(game);
  let melee = 0, gd = 0;
  for (let i = 0; i < g.n; i++) { const k = `${s.id}.${i}`; if (D.has(k)) { if (!rec.deadStart.has(k)) gd++; } else if (i >= g.archers) melee++; }
  rec.gd = gd;
  const mel0 = rec.place.guards.melee, lostMel = s.kind === 'village' ? Math.min(1, Math.floor(mel0 * RAID.lost.melee)) : Math.floor(mel0 * RAID.lost.melee);
  if (!rec.fell && left >= RAID.lost.lostMin && (melee <= lostMel || rec.lose)) { rec.fell = true; game.net.emit('raid.fall', { sid: s.id }); }
  // over: all down · the dawn (they crumble: walkers.js) · nobody near any more (the rest by numbers)
  if (!left) return endLive(game, rec, 'down');
  if (!night) return endLive(game, rec, 'dawn');
  if (!game.people?.live?.has(s.id) || !nearPlayer(game, s, RAID.liveOut)) return endLive(game, rec, 'far');
}
function endLive(game, rec, why) {
  const H = game.raids.H, s = rec.s;
  rec.done = true;
  H.live.delete(s.id);
  let fell = rec.fell, more = [];
  // the players left in the middle of it: the rest of the fight by numbers, from where it stood
  if (why === 'far') {
    const left = rec.ents.size + (rec.total - rec.out);
    if (left > 0 && !fell) {
      const place = placeOf(game, s, rec.P.fam, game.env.hour), rnd = rngOf(rec.P.seed ^ 0x5bd1);
      const units = Math.max(0, left - (rec.giantLeft ? 1 : 0));
      const F = fight(place, { ...rec.W, units, giant: rec.giantLeft ? rec.W.giant : null }, rnd);
      if (F.out === 'lost') fell = true;
      more = pickGuards(game, s, place, F.gDead, rnd); // (its dead guards by numbers)
    }
    for (const m of rec.ents) if (!m.dead) { m.noCorpse = true; killMob(game, m, null); }
  }
  // a lost night: the dead went from house to house (the homes they broke into, and others near where they came in)
  const toll = fell ? nightToll(game, s, rec, rngOf(rec.P.seed ^ 0x77)) : { dead: [], cd: 0, hit: [], gone: [], pdmg: [], own: [] };
  const own = mergeOwn(toll.own, [...rec.priv.values()]);
  game.net.emit('raid.end', { ...endArgs(game, rec, fell ? 2 : 1), gd: (rec.gd | 0) + more.length, dead: more.concat(toll.dead), cd: toll.cd, hit: toll.hit, gone: toll.gone, pdmg: toll.pdmg, own });
}
const endArgs = (game, rec, out) => ({ sid: rec.sid, day: rec.P.key | 0, out, n: rec.W.n, gd: rec.gd | 0, live: 1, horde: rec.W.horde ? 1 : 0, fam: rec.P.fam, at: Math.round(game.worldTime) });

// a raid monster hit a piece (walkers.js hitPiece, host): the homes broken into, the private property hit
function onHit(game, m, o, d, gone) {
  const rec = m.raid != null ? game.raids.H.live.get(m.raid) : null;
  if (o.town != null) {
    const k = +String(o.id).split('.')[1];
    if (rec && gone) { const b = buildingOf(game, o.town, k); if (b >= 0) rec.homes.add(b); }
    if (privatePiece(game, o.id)) addPriv(game, rec, o.town, houseOf(game, o.town, k), 'house');
    return;
  }
  const P = plotOf(game, o);
  if (P) addPriv(game, rec, P.s.id, P.pl, 'plot');
  void d;
}
function addPriv(game, rec, sid, pr, kind) {
  if (!pr) return;
  const row = game.eco?.pr.get(pr.id);
  if (!row) return;
  const M = rec ? rec.priv : (game.raids.H.loosePriv || (game.raids.H.loosePriv = new Map()));
  const key = row.u + '|' + pr.id, q = M.get(key) || [row.u, kind === 'plot' ? 'plot' : row.mode === 'rent' ? 'rent' : 'house', pr.id, 0];
  q[3]++;
  M.set(key, q);
}
const mergeOwn = (a, b) => { const M = new Map(); for (const q of [...a, ...b]) { const k = q[0] + '|' + q[2], e = M.get(k); if (e) e[3] += q[3]; else M.set(k, q.slice()); } return [...M.values()].slice(0, 40); };
// the building (plan index) a piece of the plan k belongs to (its box holds the piece's tile)
function buildingOf(game, sid, k) {
  const L = game.towns.layout(sid), r = L?.structs[k];
  if (!r) return -1;
  return L.buildings.findIndex((b) => r[1] >= b.box[0] && r[1] <= b.box[2] && r[2] >= b.box[1] && r[2] <= b.box[3]);
}

// ---------- the dead by numbers ----------
function pickGuards(game, s, place, gDead, rnd) {
  const g = place.g, D = deadMap(game), at = Math.round(game.worldTime), out = [];
  const pool = (lo, hi) => { const L = []; for (let i = lo; i < hi; i++) if (!D.has(`${s.id}.${i}`)) L.push(i); return L; };
  for (const [lo, hi, n] of [[g.archers, g.n, gDead.melee], [0, g.archers, gDead.archers]]) {
    const L = pool(lo, hi);
    for (let k = 0; k < n && L.length; k++) out.push([L.splice(Math.floor(rnd() * L.length), 1)[0], at]);
  }
  return out;
}
// a lost night (live or by numbers): the dead broke into some homes (rec.homes: the ones broken live; else / and the ones
// nearest where they came in) — each resident dies with RAID.toll.house, never more than RAID.toll.maxShare of the
// townsfolk; by numbers their doors fall and walls crack. The private property hit is listed (own)
function nightToll(game, s, rec, rnd, P = null) {
  const out = { dead: [], cd: 0, hit: [], gone: [], pdmg: [], own: [] };
  const L = game.towns.layout(s.id), S = game.people?.of?.(s.id);
  if (!L || !S) return out;
  const D = deadMap(game), at = Math.round(game.worldTime), fx = rec ? rec.fx : Math.cos((P.side * Math.PI) / 4), fy = rec ? rec.fy : Math.sin((P.side * Math.PI) / 4);
  const ex = s.x + fx * s.r * 0.8, ey = s.y + fy * s.r * 0.8; // (where they came in)
  const homes = new Set(rec ? rec.homes : []);
  const want = RAID.toll.homes[0] + Math.floor(rnd() * (RAID.toll.homes[1] - RAID.toll.homes[0] + 1));
  const props = new Map(propsOf(game, s.id).houses.map((h) => [h.bi, h]));
  const cand = L.buildings.map((b, bi) => [bi, b]).filter(([bi, b]) => !b.guard && (b.beds?.length || props.has(bi)) && !homes.has(bi))
    .map(([bi, b]) => [bi, b, Math.hypot((b.box[0] + b.box[2]) / 2 - ex, (b.box[1] + b.box[3]) / 2 - ey)]).sort((a, b) => a[2] - b[2]).slice(0, 10);
  const forced = rec?.P?.homes || P?.homes; // (tests: the homes to break into)
  if (forced) for (const bi of forced) homes.add(bi);
  else while (homes.size < want && cand.length) homes.add(cand.splice(Math.floor(rnd() * Math.min(cand.length, 6)), 1)[0][0]);
  // the residents
  const civ = S.persons.filter((q) => !q.guard && !D.has(`${s.id}.${q.i}`)), cap = Math.max(1, Math.floor(civ.length * RAID.toll.maxShare));
  for (const q of civ) {
    if (out.dead.length >= cap) break;
    const H = S.homes[q.home];
    if (H && homes.has(H.b) && rnd() < RAID.toll.house) out.dead.push([q.i, at]);
  }
  out.cd = out.dead.length;
  // by numbers (and for the homes broken by numbers in a live night too): the door falls, a wall or two crack
  const liveBroken = new Set(rec ? rec.homes : []);
  for (const bi of homes) {
    if (liveBroken.has(bi)) continue;
    const b = L.buildings[bi];
    const pieces = [];
    L.structs.forEach((r, k) => { if (r[4] | 0 || r[1] < b.box[0] || r[1] > b.box[2] || r[2] < b.box[1] || r[2] > b.box[3]) return; const d = BUILDINGS[r[0]]; if (d && (d.connect === 'wall' || (d.block === 'door' && !d.gate2))) pieces.push([k, r, d.block === 'door']); });
    const door = pieces.find((p) => p[2]), walls = pieces.filter((p) => !p[2]);
    const st = (k) => game.towns.state.get(`t${s.id}.${k}`);
    if (door && !st(door[0])?.gone) out.gone.push([`t${s.id}.${door[0]}`, door[1][0], door[1][1], door[1][2]]);
    for (let n = 0; n < 2 && walls.length; n++) { const w = walls.splice(Math.floor(rnd() * walls.length), 1)[0]; if (!st(w[0])?.gone) out.hit.push([`t${s.id}.${w[0]}`, w[1][0], w[1][1], w[1][2], +(0.35 + 0.5 * rnd()).toFixed(3)]); }
    const h = props.get(bi), row = h && game.eco?.pr.get(h.id);
    if (row) out.own.push([row.u, row.mode === 'rent' ? 'rent' : 'house', h.id, 1 + Math.min(2, walls.length)]);
  }
  // the players' plots near where they came in: what is built there cracks (it never settles: the owner mends it)
  for (const pl of propsOf(game, s.id).plots) {
    const row = game.eco?.pr.get(pl.id);
    if (!row || (!forced && Math.hypot((pl.x0 + pl.x1) / 2 - ex, (pl.y0 + pl.y1) / 2 - ey) > s.r * 0.9 && rnd() > 0.35)) continue;
    let n = 0;
    for (const o of game.build.structures) {
      if (o.town != null || o.blueprint || o.tx < pl.x0 || o.tx > pl.x1 || o.ty < pl.y0 || o.ty > pl.y1) continue;
      const d = BUILDINGS[o.type];
      if (!d || !(d.connect === 'wall' || d.connect === 'fence' || d.block === 'door')) continue;
      if (n >= 4 || (!forced && rnd() < 0.5)) continue;
      out.pdmg.push([o.id, +Math.min(0.95, (o.dmg || 0) + 0.3 + 0.4 * rnd()).toFixed(3)]); n++;
    }
    if (n) out.own.push([row.u, 'plot', pl.id, n]);
  }
  return out;
}

// ---------- far from the players: the attack by numbers ----------
function resolveFar(game, s, P) {
  const H = game.raids.H, t0 = performance.now();
  const place = placeOf(game, s, P.fam, P.hour), rnd = rngOf(P.seed);
  const W = planWave(place, rnd, { horde: P.horde, giant: P.giant });
  const F = P.force === 'lost' ? { out: 'lost', gDead: { melee: Math.max(0, place.guards.melee - 1), archers: Math.floor(place.guards.archers / 2) }, breach: true, gate: rnd() < 0.5 } : fight(place, W, rnd);
  const dead = pickGuards(game, s, place, F.gDead, rnd);
  const args = { sid: s.id, day: P.key | 0, out: F.out === 'lost' ? 2 : 1, n: W.n, gd: dead.length, cd: 0, live: 0, horde: W.horde ? 1 : 0, fam: P.fam, at: Math.round(game.worldTime), dead, hit: [], gone: [], pdmg: [], own: [] };
  // the pieces: only where the plan is known here (a place ever made this session), or a lost night / a place with a
  // player's property (planned once: 7–55 ms) — a far village that held keeps its walls in the numbers only
  const ownHere = [...(game.eco?.pr?.keys() || [])].some((id) => new RegExp(`^[hp]${s.id}\\.`).test(id));
  const L = (F.out === 'lost' || ownHere) ? game.towns.layout(s.id) : game.towns.layoutCached?.(s.id) || null; // (towns.js)
  if (L) wallDamage(game, s, L, P, F, rnd, args);
  const T = F.out === 'lost' ? nightToll(game, s, null, rnd, P) : null;
  if (T) Object.assign(args, { dead: dead.concat(T.dead), cd: T.cd, hit: args.hit.concat(T.hit), gone: args.gone.concat(T.gone), pdmg: T.pdmg, own: mergeOwn(args.own, T.own) });
  game.net.emit('raid.end', args);
  H.stats.far++;
  H.stats.farMs += performance.now() - t0;
  return { W, F, args };
}
// the wall on the attacked side: cracked; a breach / the gate down when they got through (by numbers)
function wallDamage(game, s, L, P, F, rnd, args) {
  const per = perimeterOf({ L, sid: s.id, s });
  if (!per.walled) return;
  const a = (P.side * Math.PI) / 4, fx = Math.cos(a), fy = Math.sin(a);
  const st = (k) => game.towns.state.get(`t${s.id}.${k}`);
  const face = [...per.pieces.values()].filter((q) => !st(q.k)?.gone && q.fx * fx + q.fy * fy > 0.5)
    .sort((p, q) => Math.hypot(p.cx - (per.cx + fx * per.A), p.cy - (per.cy + fy * per.A)) - Math.hypot(q.cx - (per.cx + fx * per.A), q.cy - (per.cy + fy * per.A)));
  if (!face.length) return;
  const W = RAID.wall, lost = F.out === 'lost', row = (q) => L.structs[q.k];
  const nHit = lost ? W.lost[0] + Math.floor(rnd() * (W.lost[1] - W.lost[0] + 1)) : W.held[0] + Math.floor(rnd() * (W.held[1] - W.held[0] + 1));
  const nGone = lost ? W.lostGone[0] + Math.floor(rnd() * (W.lostGone[1] - W.lostGone[0] + 1)) : F.breach && rnd() < W.heldBreak ? 1 : 0;
  const walls = face.filter((q) => !q.gate).slice(0, 8), gates = face.filter((q) => q.gate);
  const used = new Set();
  if (lost && F.gate && gates[0]) { const r = row(gates[0]); args.gone.push([gates[0].id, r[0], r[1], r[2]]); used.add(gates[0].k); }
  for (let n = 0; n < nGone && walls.length; n++) { const q = walls.splice(Math.floor(rnd() * Math.min(3, walls.length)), 1)[0]; const r = row(q); args.gone.push([q.id, r[0], r[1], r[2]]); used.add(q.k); }
  for (let n = 0; n < nHit && walls.length; n++) {
    const q = walls.splice(Math.floor(rnd() * Math.min(4, walls.length)), 1)[0], r = row(q);
    const d = Math.min(0.95, (st(q.k)?.dmg || 0) / 100 + W.dmg[0] + (W.dmg[1] - W.dmg[0]) * rnd());
    args.hit.push([q.id, r[0], r[1], r[2], +d.toFixed(3)]);
  }
}

// ---------- the next day: rebuilt by numbers (far from the players) ----------
function rebuildByNumbers(game) {
  const h = game.env.hour, R = game.raids;
  if (h < RAID.rebuild.from || h > RAID.rebuild.to) return;
  const today = game.env.dayIndex, ids = [];
  const places = new Set(R.log.filter((r) => today - r[0] >= 1 && today - r[0] <= 4).map((r) => r[1]));
  for (const sid of places) {
    if (game.realms?.holdRepair?.(sid) || game.people?.live?.get(sid)?.ents.size) continue; // (a siege: not yet · the people out: by hand)
    let n = 0;
    const pre = `t${sid}.`;
    for (const [id, r] of game.towns.state) {
      if (!r.gone || !id.startsWith(pre) || n >= RAID.rebuild.perHour) continue;
      if (privatePiece(game, id)) continue; // (a house a player owns: his to rebuild)
      if (allPlayers(game).some((q) => Math.hypot(game.world.dx(q.x, r.x + 0.5), q.y - (r.y + 0.5)) < 40)) continue;
      ids.push(id); n++;
    }
  }
  if (ids.length) game.net.emit('town.restore', { ids: ids.slice(0, 200) });
}

// ---------- the player's own property: what needs mending (every peer) ----------
// a house the player holds / a plot he owns → { cracked, gone, ids } (the pieces of the house in the town state; the
// structures on the plot with cracks)
function damageOf(game, propId) {
  const m = /^([hp])(\d+)\.(\d+)$/.exec(propId || '');
  if (!m) return null;
  const sid = +m[2], P = propsOf(game, sid);
  const out = { cracked: 0, gone: 0 };
  if (m[1] === 'h') {
    const h = P.houses.find((q) => q.id === propId), L = game.towns?.layout?.(sid);
    if (!h || !L) return out;
    const pre = `t${sid}.`;
    for (const [id, r] of game.towns.state) {
      if (!id.startsWith(pre) || r.x < h.box[0] || r.x > h.box[2] || r.y < h.box[1] || r.y > h.box[3]) continue;
      if (r.gone) out.gone++; else if (r.dmg > 0) out.cracked++;
    }
    return out;
  }
  const pl = P.plots.find((q) => q.id === propId);
  if (!pl) return out;
  for (const o of game.build.structures) if (o.town == null && o.dmg > 0 && o.tx >= pl.x0 && o.tx <= pl.x1 && o.ty >= pl.y0 && o.ty <= pl.y1) out.cracked++;
  return out;
}

// "Consertar" / "Reconstruir" near the local player: a cracked piece of the house he holds (owned or rented) or of what he
// may build (building.js describeStructure 'repair' covers the pieces that exist); here: the destroyed pieces of his house
// (no object any more: a spot on the ground with its cost)
function forNear(game, consider) {
  const p = game.player, pr = game.eco?.pr;
  if (!pr?.size || p.dead) return;
  const town = game.towns?.at?.(p.x, p.y)?.town;
  if (!town) return;
  const me = meUid(game);
  for (const h of propsOf(game, town.id).houses) {
    const row = pr.get(h.id);
    if (!row || row.u !== me) continue;
    if (p.x < h.box[0] - 3 || p.x > h.box[2] + 4 || p.y < h.box[1] - 3 || p.y > h.box[3] + 4) continue;
    const pre = `t${town.id}.`;
    for (const [id, r] of game.towns.state) {
      if (!r.gone || !id.startsWith(pre) || r.x < h.box[0] || r.x > h.box[2] || r.y < h.box[1] || r.y > h.box[3]) continue;
      const k = +id.slice(pre.length), L = game.towns.layout(town.id), type = L?.structs[k]?.[0], def = BUILDINGS[type];
      if (!def || (L.structs[k][4] | 0) !== Math.round(p.z || 0)) continue;
      const cost = Object.entries(def.cost || {}).map(([it, n]) => `${n} ${it === 'wood' ? 'madeira' : it === 'stone' ? 'pedra' : it}`).join(', ');
      consider({ kind: 'prop_rebuild', id, type, tile: true, tx: r.x, ty: r.y, w: 1, h: 1, x: r.x + 0.5, y: r.y + 0.5, reach: 0.9, verb: `Reconstruir ${def.name.toLowerCase()}${cost ? ` (${cost})` : ''}`, icon: 'build', prio: 2.5 });
    }
  }
}
// the works (the local player's client: hammer blows → intent prop.fix on the host)
registerWork('prop_rebuild', {
  valid: (g, it) => !!g.towns?.state.get(it.id)?.gone,
  start(game, it) {
    const def = BUILDINGS[it.type], p = game.player;
    if (!def) return null;
    if (!p.inv.has(def.cost || {})) { game.events.emit('error', { text: `Falta material: ${Object.entries(def.cost || {}).map(([k, n]) => `${Math.max(0, n - p.inv.count(k))} ${k}`).join(', ')}` }); return null; }
    const { need, cycle } = hitsFor((def.time || 2) * 0.8, 2);
    return { type: 'build', cycle, need, label: `Reconstruindo ${def.name.toLowerCase()}` };
  },
  hit(game, wk) { game.juice?.chips?.(wk.it.x, wk.it.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3); game.audio?.play('build_hit', { x: wk.it.x, y: wk.it.y, volume: 0.4 }); },
  finish(game, wk) {
    const def = BUILDINGS[wk.it.type], p = game.player, cost = { ...(def?.cost || {}) };
    if (!p.inv.pay(cost)) { game.events.emit('error', { text: 'Falta material' }); return true; }
    game.events.emit('inventory', {});
    game.net.request('prop.fix', { id: wk.it.id, paid: cost }, { refund: cost, onReject: (why) => why && game.events.emit('error', { text: why }) });
    return true;
  },
});
registerWork('repair', {
  valid: (g, it) => !it.o.removed && it.o.dmg > 0,
  start(game, it) {
    const o = it.o, stone = /stone/.test(o.type);
    const steps = Math.max(1, Math.ceil(o.dmg / (stone ? FIX_STEP.stone : FIX_STEP.wood)));
    const { need, cycle } = hitsFor(steps * 1.1, steps);
    return { type: 'build', cycle, need, label: `Consertando ${(BUILDINGS[o.type]?.name || 'peça').toLowerCase()}` };
  },
  hit(game, wk) {
    const o = wk.it.o;
    game.juice?.chips?.(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3);
    game.audio?.play('build_hit', { x: o.x, y: o.y, volume: 0.4 });
    if (o.dmg > 0) game.net.request('prop.fix', { id: o.id }, { onReject: (why) => { if (why) game.events.emit('error', { text: why }); if (game.player.work?.it?.o === o) { game.player.work = null; game.player.action = null; } } });
  },
  finish() { return true; },
});
// may the local player mend this structure (building.js describeStructure)? a piece of the house he holds; his own
// structure where he may build (free land, his plot)
export function mayRepair(game, o) {
  if (!(o.dmg > 0) || o.blueprint || o.removed) return false;
  if (o.town != null) {
    const k = +String(o.id).split('.')[1], h = houseOf(game, o.town, k), row = h && game.eco?.pr.get(h.id);
    return !!row && row.u === meUid(game);
  }
  if (o.realm != null) return false;
  return !TOWN.landReason?.(game, o.type, o.tx, o.ty, o.fw || 1, o.fh || 1, game.player);
}

// ---------- tests / debug (host) ----------
function makeDebug(game) {
  return {
    pause: (on = true) => { game.raids.H.off = !!on; if (on) game.raids.H.plan.clear(); },
    // an attack now on place sid: { live (default: a player near), horde, lose (live: the defense breaks at once — the
    // night is lost), side, n, giant, homes (the homes the toll breaks into), force 'lost' (numbers) }
    force: (sid, o = {}) => {
      const s = realmOf(game)?.settlements[sid];
      if (!s || !game.net.auth) return null;
      const fam = o.fam || placeFamily(game, s) || 'ice', E = game.env;
      const P = { sid, fam, key: o.key ?? nightKeyOf(E), hour: E.hour, at: game.worldTime, side: (o.side ?? Math.floor(Math.random() * 8)) & 7, horde: !!o.horde, seed: o.seed ?? h32(game.world.seed | 0, sid, game.worldTime | 0), homes: o.homes, giant: o.giant, force: o.force };
      game.raids.H.plan.delete(sid);
      if (o.live === false || (o.live == null && !(nearPlayer(game, s, RAID.liveR) && placeReadyLive(game, s)))) return { far: resolveFar(game, s, P) };
      const rec = startLive(game, s, P, o);
      return { live: true, n: rec.W.n, total: rec.total, g: rec.place.guards.n, fury: rec.W.fury, horde: rec.W.horde, giant: rec.W.giant, species: rec.W.species };
    },
    live: (sid) => { const r = game.raids.H.live.get(sid); return r ? { n: r.W.n, total: r.total, out: r.out, alive: [...r.ents].filter((m) => !m.dead).length, killed: r.killed, gd: r.gd | 0, fell: r.fell, fury: r.W.fury, giant: r.W.giant, side: r.side, fx: r.fx, fy: r.fy, g: r.place.guards, ents: [...r.ents].filter((m) => !m.dead).map((m) => ({ nid: m.nid, species: m.species, level: m.level, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, state: m.state, giant: !!m.giant, siege: m.siege?.o?.id || null })) } : null; },
    plan: () => [...game.raids.H.plan.values()].map((P) => ({ ...P })),
    rebuild: () => rebuildByNumbers(game), // (the hourly rebuilding by numbers, now)
    // the numbers' prediction for a place as it is now: { rate (lost), gd (guards dead on average), place }
    model: (sid, o = {}, n = 1000) => {
      const s = realmOf(game)?.settlements[sid];
      if (!s) return null;
      const place = placeOf(game, s, placeFamily(game, s) || 'ice', game.env.hour), rnd = rngOf(o.seed ?? 1234);
      let lost = 0, gd = 0;
      for (let k = 0; k < n; k++) { const W = planWave(place, rnd, { horde: o.horde }), F = fight(place, W, rnd, o.eff ? { eff: o.eff } : {}); if (F.out === 'lost') lost++; gd += F.gDead.melee + F.gDead.archers; }
      return { rate: lost / n, gd: gd / n, place: { kind: place.kind, walls: place.walls, glv: place.glv, mlv: place.mlv, guards: place.guards } };
    },
    planNow: () => { game.raids.H.planned = null; planNight(game, nightKeyOf(game.env)); return game.raids.H.plan.size; },
    // the loss rate by numbers over the real realm (every place, the families of their bad seasons or the walkers')
    calibrate: (n = 4000, seed = 4242) => {
      const realm = realmOf(game), rnd = rngOf(seed), out = { n: 0, lost: 0, horde: 0, hordeLost: 0, gDead: 0, g0: 0, byKind: {} };
      const places = realm.settlements.map((s) => ({ ...placeOf(game, s, placeFamily(game, s) || ['ice', 'ice', 'bone', 'sand'][s.id % 4], 22), guards: guardsOf(s), dark: hourS(game, 2.6 + 5 * ((s.id * 0.618) % 1)) }));
      for (let i = 0; i < n; i++) {
        const P = places[Math.floor(rnd() * places.length)], W = planWave(P, rnd), F = fight(P, W, rnd);
        out.n++; if (F.out === 'lost') out.lost++; if (W.horde) { out.horde++; if (F.out === 'lost') out.hordeLost++; }
        out.gDead += F.gDead.melee + F.gDead.archers; out.g0 += P.guards.n;
        const K = out.byKind[P.kind] || (out.byKind[P.kind] = { n: 0, lost: 0 }); K.n++; if (F.out === 'lost') K.lost++;
      }
      out.rate = out.lost / Math.max(1, out.n); out.guardsDead = out.gDead / Math.max(1, out.g0);
      return out;
    },
    unit: (role, lv, o) => unitStats(role, lv, o),
    stats: () => ({ ...game.raids.H.stats }),
    FAMILY_MOB, FAMILY_GIANT, SPECIES_OK: (sp) => !!SPECIES[sp],
  };
}
