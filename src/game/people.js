// The settlements' people (docs/REINOS.md "Fase 2 — moradores e guardas"): citizens and guards.
//
// Identities (every peer, pure from the seed): game.people.of(sid) — each person of a settlement with a name, a home
// (and a bed), a trade and a workplace, a schedule (jittered hours) and clothes by trade (art/look: varied faces, hair,
// colours); guards with the kingdom's tabard and shield, archers with bows. Who died lives in the shared state
// (mut/people.js town.pop): the population regrows over the days (the host replaces one at a time).
//
// Level of detail (host): a person is a COUNT unless a player is near the place it is at now (the schedule says where:
// home, bed, work, the plaza, the tavern, a post on the walls…). Near a player (PEOPLE.matR) the people who are outdoors
// — and the ones inside a building a player is next to — become real creatures (species 'citizen' / 'guard', kind
// 'pawn', faction 'town', temper 'friendly'), up to PEOPLE.cap per settlement, the nearest first; far away again (and out
// of sight) they go back to being counts. They are host creatures streamed to guests like any other (net/entities.js:
// the identity comes from `camp` = 'p<sid>.<i>' — the guest rebuilds the look / trade from the seed; their pose (in bed,
// on a chair) rides the stream too).
//
// Their brains (game/npc.js): the day's routine on the game clock, work with animations, chats on the plaza, home at
// dusk, in bed at night; danger (monsters in the town land): civilians run home, the gates close, the bell rings
// (op town.alarm), guards fight (the raiders' brain on the town's side), archers shoot from the walls, crews man the
// ballistas; by day they repair the town's walls and gates. Paths: game/townnav.js (cached, budgeted).
//
// No friendly fire (combat.js): players never hurt the people of a kingdom ("Os moradores de X estão sob a proteção do
// reino"); monsters do (and kill them: no loot, no body). Talking: E / a tap = "Conversar" (ui/talk.js, local UI).
//
// API for the economy (game.towns.people(sid)): population, alive / dead, workers per workplace, productivity — see
// peopleSummary below and docs/REINOS.md.

import { PEOPLE as N, JOBS, WORK_JOB, WORK_N, GUARDS, ARCHER_SHARE, NAMES_M, NAMES_F, BYNAMES, TRADE_BYNAME, DRESS, TALK, SEASON_PT } from './content/people.js';
import { randomLook, cleanLook, hexOf } from './look.js';
import { CATALOG } from '../art/look/catalog.js';
import { METALS } from '../world/realm/names.js';
import { SPECIES, BUILDINGS } from './data.js';
import { mobStats } from './stats.js';
import { allocMob } from './mobs.js';
import { allPlayers, inAnyView } from './players.js';
import { weaponProfile, offhandProfile, equipArmor } from './content/weapons.js';
import { seasonAt } from './seasons.js';
import { realmNpcLevel } from './towns.js';
import { registerWork } from './gathering.js';
import { TownNav, nearPass } from './townnav.js';
import { npcBrain, npcSeparate, repairTick, scavTick, repairByNumbers, npcHurt, bedSide, insideAt, hostile } from './npc.js';
import { perimeterOf, openings, frontsOf, frontsSig, assignDefense } from './defense.js';
import { deadMap } from './mut/people.js';
import { STORY_H } from './levels.js';
import { ownerOf } from './mut/realms.js'; // phase 3a: the kingdom a place belongs to now (its guards wear its colours)

const TAU = Math.PI * 2;
export const CODE = /^p(\d+)\.(\d+)$/;
const hash = (a, b = 0) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; return h >>> 0; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const lerp = (a, b, k) => a + (b - a) * k;
const hex3 = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// ---------- identities (every peer) ----------
const HAIR_F = ['long', 'bun', 'single_braid', 'ponytail', 'braid', 'low_bun', 'long_wavy', 'wavy', 'bob', 'curly', 'long_curly', 'curtains', 'pixie', 'crown_braid', 'medium', 'afro', 'twists'];
const HAIR_M = ['short', 'crew', 'buzz', 'messy', 'shaggy', 'receding', 'balding', 'slick', 'curly', 'medium', 'wavy', 'bald', 'short', 'crew', 'afro', 'dreads'];
const BEARDS = ['full', 'short', 'long', 'goatee', 'mustache', 'mutton', 'stubble', 'stubble_heavy', 'walrus', 'chin_strap', 'sideburns'];
const OLD_HAIR = ['a8a39c', 'e8e4dc', '857565', 'a8a39c'];
const YOUNG_HAIR = ['2a2220', '3b2e28', '4e3424', '6b4630', '7e4a2c', '93684a', 'a88a5e', 'd2b47c', 'c06a32', '9a4a2a'];
// the look of a person (pure): randomLook(face, hair, skin) + the trade's clothes; crest: guards' tabard division
function lookOf(S, P, r) {
  const L = randomLook(hash(S.seed, P.i * 7 + 1));
  const D = DRESS[P.job] || DRESS.homemaker;
  const set = (k, list) => { if (list && list.length) { const v = pick(r, list); if (v != null) L[k] = v; } };
  set('top', D.top); set('topC', D.topC); set('topC2', D.topC2); set('pattern', D.pattern); set('over', D.over); set('overC', D.overC);
  set('bottom', D.bottom); set('botC', D.botC); set('shoes', D.shoes); set('build', D.build);
  if (!D.pattern) L.pattern = r() < 0.75 ? 'plain' : L.pattern;
  // the kingdom's colours on its guards, archers and lords
  if (P.job === 'guard') { L.overC = S.crest.fh; L.topC2 = S.crest.mh; }
  else if (P.job === 'archer') { L.topC = S.crest.fh; L.topC2 = S.crest.mh; }
  else if (P.job === 'lord') { L.topC = S.crest.fh; L.topC2 = S.crest.mh; L.overC = S.crest.mh; }
  // hair and beards by sex; children and elders
  L.hair = pick(r, P.female ? HAIR_F : HAIR_M);
  L.beard = P.female || P.age === 'child' ? 'none' : r() < 0.55 ? pick(r, BEARDS) : 'none';
  if (P.age === 'child') { L.height = 'short'; L.build = 'slim'; L.age = 'none'; if (L.top === 'robe' || L.top === 'gown') L.top = 'tee'; }
  else if (P.age === 'elder') { L.age = r() < 0.6 ? 'old' : 'mature'; L.hairC = pick(r, OLD_HAIR); L.beardC = ''; if (L.hair === 'afro' || L.hair === 'dreads') L.hair = 'receding'; }
  if (P.age !== 'elder' && /^(a8a39c|e8e4dc|ece0c4)$/.test(L.hairC)) L.hairC = pick(r, YOUNG_HAIR); // (grey / white hair: the elders')
  if (P.age === 'child') L.hairFx = 'none';
  if (P.female && (L.top === 'tank' || L.top === 'sleeveless')) L.top = 'peasant';
  if (P.female && L.bottom === 'shorts') L.bottom = 'skirt';
  if (!P.female && (L.top === 'dress' || L.top === 'gown')) L.top = pick(r, ['tunic', 'shirt', 'laced']);
  if (!P.female && (L.bottom === 'long_skirt' || L.bottom === 'skirt')) L.bottom = pick(r, ['trousers', 'breeches']);
  if (L.over && !CATALOG.over.some((e) => e.id === L.over)) L.over = 'none'; // (an art without the tabard yet)
  const out = cleanLook(L);
  if (P.job === 'guard') out.crest = S.crest.d; // (raw field: the heraldic division on the tabard, art/look/rig.js)
  return out;
}

export function buildPeople(game, sid) {
  const T = game.towns, R = T?.realm, s = R?.settlements[sid];
  if (!s) return null;
  const L = T.layout(sid), K = R.kingdoms[ownerOf(game, sid)], B = K.banner; // (a captured place: the conqueror's tabards)
  const S = { sid, s, L, K, kind: s.kind, name: s.name, seed: hash((s.seed | 0) ^ 0x51ed, sid), persons: [], homes: [], works: [] };
  const metal = METALS[B.m] || METALS.or;
  S.crest = { f: K.color.map((v) => v / 255), m: metal.map((v) => v / 255), fh: hex3(K.color), mh: hex3(metal), d: B.d || 'plain' };
  const r = rng(S.seed);
  // buildings: homes (beds), guard houses, workplaces; their door and the tile outside it
  const doorOut = (b) => {
    const [x0, y0, x1, y1] = b.box, d = b.door;
    if (!d) return null;
    const [dx, dy] = d[1] >= y1 ? [0, 1] : d[1] <= y0 ? [0, -1] : d[0] <= x0 ? [-1, 0] : [1, 0];
    return { door: d, out: [d[0] + dx + 0.5, d[1] + dy + 0.5], inn: [d[0] - dx + 0.5, d[1] - dy + 0.5], cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, box: b.box };
  };
  L.buildings.forEach((b, bi) => { b._do = doorOut(b); });
  for (const h of L.hooks.homes) { const b = L.buildings[h.b]; if (b._do) S.homes.push({ b: h.b, rec: b, ...b._do, beds: h.beds.slice(), guard: !!b.guard, n: 0, bedUsed: 0 }); }
  for (const w of L.hooks.work) { const b = L.buildings[w.b]; if (b._do) S.works.push({ b: w.b, rec: b, name: w.name, job: WORK_JOB[w.name] || null, at: w.at.slice(), ...b._do, n: 0 }); }
  const findBuilding = (key) => L.buildings.findIndex((b) => b.key === key);
  S.tavern = S.works.find((w) => w.job === 'innkeeper') || null;
  const [px, py, pr] = L.plaza;
  S.plaza = { x: px, y: py, r: pr };
  S.benches = []; S.wells = []; S.chairs = [];
  L.structs.forEach((row, k) => {
    const t = row[0];
    if (t === 'bench_wood' && Math.hypot(row[1] - px, row[2] - py) < pr + 8) S.benches.push(k);
    else if ((t === 'well' || t === 'fountain') && Math.hypot(row[1] - px, row[2] - py) < pr + 10) S.wells.push(k);
    else if (t === 'chair_wood' && S.tavern) { const [x0, y0, x1, y1] = S.tavern.box; if (row[1] > x0 && row[1] < x1 && row[2] > y0 && row[2] < y1) S.chairs.push(k); }
  });
  void findBuilding;
  // ---- the people: guards, workers of each workplace, farmers, herders, merchants, then families ----
  const total = Math.max(4, s.pop | 0);
  const kind = s.kind;
  const nG = Math.max(2, kind === 'village' ? GUARDS.village + (s.walls ? 2 : 0) : Math.round(total * GUARDS[kind]));
  const nA = Math.max(kind === 'village' ? 1 : 2, Math.round(nG * ARCHER_SHARE[kind]));
  const plan = [];
  for (let k = 0; k < nG; k++) plan.push({ job: k < nA ? 'archer' : 'guard' });
  for (const w of S.works) {
    if (!w.job || w.job === 'guard') continue;
    const n = Math.max(1, Math.min(WORK_N[w.name] ?? 1, Math.max(w.at.length, 1)));
    for (let k = 0; k < n; k++) plan.push({ job: w.job, work: S.works.indexOf(w), spot: k });
  }
  if (kind !== 'castle' || L.fields.length) for (let k = 0; k < L.fields.length && k < (kind === 'city' ? 12 : 7); k++) plan.push({ job: 'farmer', field: k });
  for (let k = 0; k < L.pens.length; k++) plan.push({ job: 'herder', pen: k });
  const nMerch = kind === 'city' ? 5 : kind === 'village' && total > 30 ? 1 : 0;
  for (let k = 0; k < nMerch; k++) plan.push({ job: 'merchant', spot: k });
  // the rest: families (children, elders, people at home)
  while (plan.length > total && plan.some((q) => q.job === 'farmer' || q.job === 'herder')) { const i = plan.map((q) => q.job).lastIndexOf('farmer'); plan.splice(i >= 0 ? i : plan.map((q) => q.job).lastIndexOf('herder'), 1); }
  const rest = Math.max(0, total - plan.length);
  const nKids = kind === 'castle' ? 0 : Math.round(rest * 0.26), nOld = Math.round(rest * 0.12);
  for (let k = 0; k < rest; k++) plan.push({ job: k < nKids ? 'child' : k < nKids + nOld ? 'elder' : 'homemaker' });
  // homes: guards in the guard houses (else the keep / any home); the others in the houses, beds to the adults first
  // the houses the economy sells / rents to the players (game.eco.api.props: a fixed list from the plan) stay empty: no
  // townsfolk live or sleep there (bought or not); a place whose every house is on the market keeps them all
  const forSale = new Set((game.eco?.api?.props?.(sid)?.houses || []).map((h) => h.bi));
  for (const h of S.homes) h.prop = forSale.has(h.b);
  const civAll = S.homes.filter((h) => !h.guard), civFree = civAll.filter((h) => !h.prop);
  const civHomes = civFree.length ? civFree : civAll, guardHomes = S.homes.filter((h) => h.guard && !h.prop);
  const keep = S.homes.find((h) => h.rec.key === 'keep');
  let hi = Math.floor(r() * Math.max(1, civHomes.length));
  plan.forEach((q, i) => {
    const job = JOBS[q.job], P = { i, code: `p${sid}.${i}`, sid, job: q.job, guard: !!job.guard, work: q.work ?? -1, spot: q.spot ?? i, field: q.field ?? -1, pen: q.pen ?? -1 };
    P.age = q.job === 'child' ? 'child' : q.job === 'elder' ? 'elder' : 'adult';
    P.female = q.job === 'guard' || q.job === 'archer' ? r() < 0.25 : q.job === 'smith' || q.job === 'miner' || q.job === 'woodcutter' ? r() < 0.25 : q.job === 'weaver' ? r() < 0.75 : q.job === 'homemaker' ? r() < 0.62 : r() < 0.5;
    const first = pick(r, P.female ? NAMES_F : NAMES_M);
    const by = TRADE_BYNAME[q.job] && r() < 0.3 ? TRADE_BYNAME[q.job] : pick(r, BYNAMES);
    P.first = first; P.name = q.job === 'child' ? first : `${first} ${by}`;
    P.jobPt = job.pt[P.female ? 1 : 0];
    // home
    let H = null;
    if (P.guard) H = guardHomes.length ? guardHomes[i % guardHomes.length] : (keep && !keep.prop ? keep : null) || civHomes[i % Math.max(1, civHomes.length)] || null;
    else if (q.job === 'lord') H = keep || civHomes[0] || null;
    else if (civHomes.length) { H = civHomes[hi % civHomes.length]; if (r() < 0.55) hi++; }
    else H = keep || S.homes[0] || null;
    P.home = H ? S.homes.indexOf(H) : -1;
    if (H) H.n++;
    P.bed = -1; // (beds: below, the townsfolk first)
    // schedule (hours): wake, leave, work end, home by; leisure; guards' shifts
    const j = () => r();
    P.wake = lerp(N.wake[0], N.wake[1], j()); P.leave = Math.max(P.wake + 0.3, lerp(N.leave[0], N.leave[1], j()));
    P.end = lerp(N.workEnd[0], N.workEnd[1], j()); P.back = lerp(N.homeBy[0], N.homeBy[1], j());
    P.bedT = N.bed + j() * 1.4;
    P.leisure = S.tavern && j() < 0.3 ? 'tavern' : j() < 0.75 ? 'plaza' : 'home';
    P.shift = P.guard ? (i % 2) : 0; // 0: day watch (some of them stay up at night too), 1: night watch
    P.nightToo = P.guard && P.shift === 0 && (i % 3 === 0);
    P.seed = hash(S.seed, i);
    // gear: guards / archers by the place
    const lvlKind = kind === 'village' ? 0 : 1;
    if (q.job === 'guard') { P.weapon = pick(r, lvlKind ? ['spear_iron', 'sword_iron', 'spear_iron'] : ['spear_copper', 'sword_copper', 'spear_iron']); P.offhand = 'shield_guard'; P.armor = { body: null, head: lvlKind ? 'helmet_iron' : 'helmet_copper' }; }
    else if (q.job === 'archer') { P.weapon = lvlKind ? 'bow_composite' : 'bow_wood'; P.offhand = null; P.armor = { body: null, head: 'hood_leather' }; }
    else { P.weapon = null; P.offhand = null; const hat = (DRESS[q.job] || {}).hat; const h = hat ? pick(r, hat) : null; P.armor = { body: null, head: P.age === 'child' ? null : h }; }
    P.carry = JOBS[q.job].carry || null;
    P.scale = P.age === 'child' ? 0.72 + j() * 0.08 : P.age === 'elder' ? 0.96 : 1;
    P.look = lookOf(S, P, r);
    S.persons.push(P);
  });
  // beds: the adults of each home (townsfolk first, then the guards who live there: half of them are on watch at night)
  for (const pass of [0, 1, 2]) for (const P of S.persons) {
    const H = S.homes[P.home];
    if (!H || P.bed >= 0 || H.bedUsed >= H.beds.length) continue;
    if (pass === 0 ? P.guard || P.age !== 'adult' : pass === 1 ? !(P.age === 'elder') : !P.guard) continue;
    P.bed = H.beds[H.bedUsed++];
  }
  // guard duties: gate posts, patrols, archer spots on the walls, ballista crews
  assignDuties(game, S, r);
  return S;
}

// guard posts (hooks.guards: inside each gate), the patrol loop, archer spots (stone walls: tower tops / stair heads at
// story 2; a palisade: its top beside the gates, story 1 — standing on it once it is walkable; else on the ground),
// ballista crews (hooks.artillery, cities and castles)
function assignDuties(game, S, r) {
  const L = S.L, H = L.hooks, cx = L.x, cy = L.y;
  const gates = H.guards.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return { k: 'gate', x, y, fx: (x - cx) / d, fy: (y - cy) / d, lv: 0 }; });
  const walls = H.archers.map(([x, y, lv]) => { const d = Math.hypot(x - cx, y - cy) || 1; return { k: 'wall', x, y, fx: (x - cx) / d, fy: (y - cy) / d, lv }; });
  if (!walls.length && S.s.walls === 'palisade') {
    // a palisade: beside each gate on the wall's top (story 1)
    for (const k of L.gates) {
      const row = L.structs[k], vert = row[3] & 1;
      for (const off of [-2, 3]) {
        const x = row[1] + (vert ? 0 : off), y = row[2] + (vert ? off : 0);
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) || 1;
        walls.push({ k: 'wall', x: x + 0.5, y: y + 0.5, fx: (x + 0.5 - cx) / d, fy: (y + 0.5 - cy) / d, lv: 1, pal: true });
      }
    }
  }
  const crews = (H.artillery || []).filter((k) => k >= 0).map((k) => { const row = L.structs[k]; return { k: 'crew', s: k, x: row[1] + 0.5, y: row[2] + 0.5, lv: row[4] | 0 }; });
  S.posts = { gates, walls, crews, patrol: H.patrol.map(([x, y]) => [x, y]) };
  const G = S.persons.filter((P) => P.job === 'guard'), A = S.persons.filter((P) => P.job === 'archer');
  // melee guards: day — the gates first (1 each), then patrols; night — gates, patrols, crews
  let gi = 0;
  G.forEach((P, k) => {
    const day = k < gates.length ? { ...gates[k] } : { k: 'patrol', i: (k * 3) % Math.max(1, S.posts.patrol.length), dir: k & 1 ? 1 : -1 };
    P.dutyDay = day;
    const nk = k - Math.max(0, gates.length);
    P.dutyNight = crews[k] ? { ...crews[k] } : gates.length && k % 3 === 0 ? { ...gates[(gi++) % gates.length] } : { k: 'patrol', i: (k * 5) % Math.max(1, S.posts.patrol.length), dir: k & 1 ? -1 : 1 };
    void nk;
  });
  // archers: the walls at night (day: a gate / the plaza)
  A.forEach((P, k) => {
    P.dutyNight = walls.length ? { ...walls[Math.floor(((k + 0.5) * walls.length) / A.length) % walls.length] } : gates.length ? { ...gates[k % gates.length] } : { k: 'patrol', i: k, dir: 1 }; // (spread along the walls)
    P.dutyDay = gates.length ? { ...gates[(k + 1) % gates.length] } : { k: 'patrol', i: (k * 2) % Math.max(1, S.posts.patrol.length), dir: 1 };
    if (P.dutyDay.k === 'gate') { P.dutyDay.x += 1.2 * (k & 1 ? 1 : -1) * Math.abs(P.dutyDay.fy); P.dutyDay.y += 1.2 * (k & 1 ? 1 : -1) * Math.abs(P.dutyDay.fx); }
  });
  void r;
}

// ---------- the plan: where a person is now (pure: identity + clock + danger) ----------
// k: 'bed' | 'home' | 'shelter' | 'work' | 'plaza' | 'play' | 'tavern' | 'well' | 'post' (gate) | 'patrol' | 'wall' |
// 'crew' | 'off' (a guard off duty: home); in: indoors (a building) · x, y: where (the building's middle when indoors)
const PL = { k: 'home', in: true, x: 0, y: 0, lv: 0, key: '', b: null, duty: null };
export function planOf(game, S, P, hour, danger, winter) {
  const p = PL;
  p.lv = 0; p.duty = null; p.b = null;
  const H = S.homes[P.home] || null;
  const atHome = (k) => { p.k = k; p.in = true; p.b = H; p.x = H ? H.cx : S.plaza.x; p.y = H ? H.cy : S.plaza.y; p.key = k + ':' + (P.home); return p; };
  if (P.guard) {
    // the defense (defense.js, host): the bell rang — every guard to its post on the walls / at the gates / the gaps; a
    // gap in the walls is held even when calm
    const dd = S.def?.posts.get(P.i);
    if (dd && (danger || dd.k === 'gap')) {
      p.duty = dd; p.in = false; p.k = dd.k === 'wall' ? 'wall' : dd.k === 'crew' ? 'crew' : 'hold'; p.lv = dd.lv || 0; p.x = dd.x; p.y = dd.y;
      p.key = `def:${dd.k}:${Math.round(dd.x * 2)},${Math.round(dd.y * 2)}:${P.i}`;
      return p;
    }
    const night = hour >= 19.4 || hour < 5.8;
    const on = night ? P.shift === 1 || P.nightToo || P.job === 'archer' : P.shift === 0 || (P.job === 'archer' && P.i % 2 === 0);
    if (!on) return atHome('off');
    const d = night ? P.dutyNight : P.dutyDay;
    if (!d) return atHome('off');
    p.duty = d; p.in = false; p.k = d.k === 'gate' ? 'post' : d.k; p.lv = d.lv || 0;
    if (d.k === 'patrol') { const L = S.posts.patrol; const q = L[(d.i + Math.floor(hour * 4)) % Math.max(1, L.length)] || [S.plaza.x, S.plaza.y]; p.x = q[0]; p.y = q[1]; }
    else { p.x = d.x; p.y = d.y; }
    p.key = p.k + ':' + (night ? 'n' : 'd') + ':' + P.i;
    return p;
  }
  if (danger) return atHome('shelter');
  if (hour < P.wake || hour >= P.bedT) return atHome(P.bed >= 0 ? 'bed' : 'home');
  const jb = P.job;
  // outdoors at its own doorstep (chores, a chat with the neighbours, children playing in the street)
  const porch = (k = 'porch') => { p.k = k; p.in = false; p.b = H; p.x = H ? H.out[0] : S.plaza.x; p.y = H ? H.out[1] : S.plaza.y; p.key = k + ':' + P.home; return p; };
  const plaza = (k = 'plaza') => { p.k = k; p.in = false; p.x = S.plaza.x; p.y = S.plaza.y; p.key = k; return p; };
  // a third of them go to the plaza, the rest stay around their street. A city has ~240 people for one plaza: they take
  // turns there (half an hour each, a quarter of them at a time — a sixth for the market morning), so it is busy but
  // never packed, and people keep coming and going
  const city = S.kind === 'city', turn = (n) => (P.i + Math.floor(hour * 2)) % n === 0, odd = city ? turn(4) : P.i % 3 === 0;
  if (jb === 'child') { if (hour >= 8 && hour < P.back - 0.4 && !winter && !(hour >= 12 && hour < 13.5)) return odd ? plaza('play') : porch('play'); return atHome('home'); }
  if (jb === 'elder') { if (hour >= 9 && hour < 12) return porch(); if (hour >= 14 && hour < 17.5) return odd ? plaza() : porch(); return atHome('home'); }
  if (hour < P.leave) return atHome('home');
  if (hour < P.end) {
    if (jb === 'homemaker') {
      if (hour < 9.4) return S.wells.length && P.i % 4 === 1 ? plaza('well') : porch();
      if (city && hour < 12) return turn(6) ? plaza() : porch(); // (the city's market morning: in turns; the others at their door)
      if (hour < 12) return atHome('home');
      if (hour < 15) return porch();
      return atHome('home');
    }
    if (jb === 'farmer' && winter) return hour < 13 ? porch() : plaza(); // (the land sleeps: firewood at the door, then the plaza)
    const W = S.works[P.work];
    if (jb === 'farmer') { const f = S.L.fields[P.field]; if (f) { p.k = 'work'; p.in = false; p.x = (f.x0 + f.x1) / 2; p.y = (f.y0 + f.y1) / 2; p.key = 'field:' + P.field; return p; } }
    if (jb === 'herder') { const f = S.L.pens[P.pen]; if (f) { p.k = 'work'; p.in = false; p.x = (f.x0 + f.x1) / 2; p.y = (f.y0 + f.y1) / 2; p.key = 'pen:' + P.pen; return p; } }
    if (jb === 'merchant') { p.k = 'work'; p.in = false; p.x = S.plaza.x; p.y = S.plaza.y; p.key = 'market'; return p; }
    if (W) {
      // in its workplace most of the hour, outside its door now and then (the yard: carrying, sorting): seen from the street
      const yard = ((Math.floor(hour * 3) + P.i) % 4) === 0 || jb === 'porter' || jb === 'woodcutter';
      p.k = 'work'; p.b = W; p.in = !yard; p.x = yard ? W.out[0] : W.cx; p.y = yard ? W.out[1] : W.cy; p.key = (yard ? 'yard:' : 'work:') + P.work; return p;
    }
    return atHome('home');
  }
  if (hour < P.back) {
    if (P.leisure === 'tavern' && S.tavern) { p.k = 'tavern'; p.b = S.tavern; p.in = true; p.x = S.tavern.cx; p.y = S.tavern.cy; p.key = 'tavern'; return p; }
    if (P.leisure === 'plaza' && !winter) return odd || jb === 'merchant' ? plaza() : porch();
  }
  return atHome('home');
}

// ---------- install ----------
export function installPeople(game) {
  const Pp = {
    S: new Map(), live: new Map(), nav: new Map(), off: false,
    stats: { ms: 0, maxMs: 0, frames: 0, spawned: 0, dropped: 0, live: 0, brains: 0, peak: 0, msSum: 0, last: [] },
    of: (sid) => peopleOf(game, sid),
    navOf: (sid) => navOf(game, sid),
    plan: (S, P) => planOf(game, S, P, game.env?.hour ?? 12, !!Pp.live.get(S.sid)?.danger, winterAt(game, S)),
    decorate: (e) => decorate(game, e),
    tapIt: (e) => tapIt(game, e),
    forNear: (consider) => forNear(game, consider),
    label: (e) => labelOf(e),
    lines: (e) => talkLines(game, e),
    fighting: npcFighting,
    alive: (sid, i) => !deadMap(game).has(`${sid}.${i}`),
    summary: (sid) => peopleSummary(game, sid),
    ents: () => game.entities.filter((e) => e.npc && !e.dead),
    onHurt: (m, src) => npcHurt(game, m, src),
    _drop: (rec, m) => dropNpc(game, rec, m),
    alarm: new Map(), // sid → the bell is ringing (every peer: op town.alarm)
    // tests / debug (host): the people out now and the homes of a settlement
    debug: (sid) => {
      const rec = Pp.live.get(sid), S = peopleOf(game, sid);
      return {
        danger: !!rec?.danger,
        live: rec ? [...rec.ents.values()].map((m) => { const d = S?.def?.posts.get(m.npc.i); return { nid: m.nid, i: m.npc.i, job: m.npc.job, guard: m.npc.guard, plan: m.planKey, task: m.task?.k || null, state: m.state, threat: m.threat?.nid || null, x: m.x, y: m.y, z: m.z || 0, pose: m.pose?.type || null, act: m.action?.type || null, hp: m.hp, repair: m.repair?.id || null, duty: d ? { k: d.k, x: d.x, y: d.y, lv: d.lv || 0, op: d.op || null } : null, hunt: m.hunt?.nid || null }; }) : [],
        def: S?.def ? { danger: S.def.danger, th: S.def.th, fronts: S.def.fronts || [], ops: S.def.ops.map((o) => o.id), posts: [...S.def.posts].map(([i, d]) => ({ i, k: d.k, x: d.x, y: d.y, lv: d.lv || 0, op: d.op || null, front: d.front ?? null, melee: !!d.melee })) } : null,
        homes: S ? S.homes.map((h) => ({ b: h.b, beds: h.beds.slice(), out: h.out, box: h.box, sealed: rec ? sealed(game, rec, h) : null, people: S.persons.filter((P) => S.homes[P.home] === h).map((P) => P.i) })) : [],
      };
    },
  };
  game.people = Pp;
  if (game.towns) game.towns.people = (sid) => peopleSummary(game, sid);
  // the defense of a place (defense.js; phase 3 — armies besieging it — uses the same): its wall line, the gaps in it,
  // from where the attackers come, the posts of the watch now (host), a plan of the posts for a given threat
  game.townDefense = {
    perimeter: (sid) => { const S = peopleOf(game, sid); return S ? perimeterOf(S) : null; },
    openings: (sid) => { const S = peopleOf(game, sid); return S ? openings(game, S) : []; },
    threat: (sid) => Pp.live.get(sid)?.threat || null,
    fronts: (sid) => Pp.live.get(sid)?.fronts || [], // (defense.js frontsOf: [main, the others] — tests / debug)
    posts: (sid) => peopleOf(game, sid)?.def?.posts || null,
    assign: (sid, th = null, danger = true) => { const S = peopleOf(game, sid); return S ? assignDefense(game, S, Pp.live.get(sid) || null, openings(game, S), th, danger) : null; },
  };
  return Pp;
}
export function peopleOf(game, sid) {
  const M = game.people?.S;
  if (!M) return null;
  let S = M.get(sid);
  if (S === undefined) { const t0 = performance.now(); S = buildPeople(game, sid); if (S) M.set(sid, S); const st = game.people.stats; st.buildMs = Math.max(st.buildMs || 0, performance.now() - t0); } // (a place not ready yet: tried again later — never cached as empty)
  return S || null;
}
function navOf(game, sid) {
  const M = game.people.nav;
  let n = M.get(sid);
  if (!n) { const S = peopleOf(game, sid); if (!S) return null; n = new TownNav(game, S.L); M.set(sid, n); }
  return n;
}
const winterAt = (game, S) => !!seasonAt(game, S.s.x, S.s.y).hard;

// ---------- the API for the economy (and the mural) ----------
// game.towns.people(sid) → an Array of every person of the place (alive or not: the same list on every peer, from the
// seed) — [{ i, name, job, role (the trade in Portuguese), jobPt, female, age, home (building index), work (building index
// | −1), alive }] — carrying the place's numbers as properties: { sid, name, kind, total, alive, dead, guards, archers,
// children, elders, jobs: {job: {pt, n, alive}}, workplaces: [{ b (building index in the layout), name (workplace),
// job, slots, alive, productivity 0..1 }], fields / pens: { slots, alive }, productivity (alive workers / slots, all
// trades), list() (the array itself) }
export function peopleSummary(game, sid) {
  const S = peopleOf(game, sid);
  if (!S) return null;
  const D = deadMap(game), alive = (P) => !D.has(`${sid}.${P.i}`);
  const jobs = {}, W = S.works.map((w) => ({ b: w.b, name: w.name, job: w.job, slots: 0, alive: 0, productivity: 0 }));
  let n = 0, a = 0, guards = 0, archers = 0, kids = 0, old = 0, wSlots = 0, wAlive = 0;
  const fields = { slots: 0, alive: 0 }, pens = { slots: 0, alive: 0 };
  const out = [];
  for (const P of S.persons) {
    const ok = alive(P);
    n++; if (ok) a++;
    out.push({ i: P.i, name: P.name, job: P.job, role: P.jobPt, jobPt: P.jobPt, female: P.female, age: P.age, home: S.homes[P.home]?.b ?? -1, work: S.works[P.work]?.b ?? -1, alive: ok });
    const J = jobs[P.job] || (jobs[P.job] = { pt: JOBS[P.job].pt[0], n: 0, alive: 0 });
    J.n++; if (ok) J.alive++;
    if (P.job === 'guard' && ok) guards++;
    if (P.job === 'archer' && ok) archers++;
    if (P.age === 'child' && ok) kids++;
    if (P.age === 'elder' && ok) old++;
    if (P.work >= 0 && W[P.work]) { W[P.work].slots++; if (ok) W[P.work].alive++; }
    if (P.field >= 0) { fields.slots++; if (ok) fields.alive++; }
    if (P.pen >= 0) { pens.slots++; if (ok) pens.alive++; }
    if (P.work >= 0 || P.field >= 0 || P.pen >= 0 || P.job === 'merchant') { wSlots++; if (ok) wAlive++; }
  }
  for (const w of W) w.productivity = w.slots ? w.alive / w.slots : 0;
  return Object.assign(out, {
    sid, name: S.name, kind: S.kind, total: n, alive: a, dead: n - a, guards, archers, children: kids, elders: old, jobs, workplaces: W, fields, pens,
    productivity: wSlots ? wAlive / wSlots : 1, list: () => out,
  });
}

// ---------- guests: a proxy gets its identity from `camp` (the look, the trade) ----------
function decorate(game, e) {
  const m = typeof e.camp === 'string' ? CODE.exec(e.camp) : null;
  if (!m) return false;
  const S = peopleOf(game, +m[1]), P = S?.persons[+m[2]];
  if (!P) return false;
  e.npc = P; e.look = P.look; e.carry = P.carry; e.crest = S.crest; e.npcS = S;
  return true;
}

// ---------- talking (local UI: ui/talk.js) ----------
const fill = (s, D) => s.replace(/\{(\w+)\}/g, (_, k) => D[k] ?? '');
export function talkLines(game, e) {
  const P = e.npc, S = e.npcS || peopleOf(game, P.sid);
  if (!P || !S) return [];
  const R = game.towns.realm, cap = R.settlements[S.K.capital];
  const se = seasonAt(game, S.s.x, S.s.y).id;
  const D = { nome: P.first, vila: S.name, tipo: S.kind === 'city' ? 'cidade' : S.kind === 'castle' ? 'castelo' : 'vila', reino: S.K.name, capital: cap?.name || S.name, estacao: SEASON_PT[se] || '' };
  const r = rng(hash(P.seed, Math.floor(game.worldTime / 40)));
  const danger = !!game.people.live.get(S.sid)?.danger || !!game.people.alarm.get(S.sid);
  const night = (game.env?.hour ?? 12) >= 20 || (game.env?.hour ?? 12) < 5.5;
  const J = TALK.job[P.job] || {};
  const out = [];
  if (danger) { out.push(pick(r, P.guard ? TALK.dangerGuard : TALK.danger)); return out.map((s) => fill(s, D)); }
  out.push(night ? pick(r, TALK.helloNight) : pick(r, TALK.hello));
  const jl = [...(J.any || []), ...(J[se] || [])];
  if (jl.length) out.push(pick(r, jl));
  const seen = game.ctl?.hinted?.mural;
  if (!seen || r() < 0.25) out.push(pick(r, TALK.mural));
  out.push(r() < 0.5 ? pick(r, TALK.season[se] || TALK.any) : pick(r, TALK.any));
  out.push(pick(r, TALK.bye));
  return out.map((s) => fill(s, D));
}
export function labelOf(e) { const P = e.npc; return P ? `${P.name} · ${P.jobPt}${P.guard ? '  ' + e.level : ''}` : null; }
// "Conversar": a person near the local player (E) / a tap on one
function talkIt(e) { return { kind: 'talk', o: e, x: e.x, y: e.y, reach: 1.9, verb: `Conversar com ${e.npc.first}`, icon: 'talk', prio: 2.5, talk: true }; }
// in a fight (chasing a foe / swinging, shooting): no "Conversar" — no button, a tap does nothing (the same on every peer:
// the state and the action come with the creature stream)
const FIGHT_ACTS = new Set(['attack', 'shoot', 'stab', 'slash', 'heavy', 'pierce']);
export const npcFighting = (e) => !!e && (e.state === 'chase' || (!!e.action && FIGHT_ACTS.has(e.action.type)));
function tapIt(game, e) { if (!e || !e.npc || e.dead || e.z > 0.5) return null; if (game.army?.npcWhy && !game.army.npcWhy(game.player, e)) return null; return npcFighting(e) ? false : talkIt(e); } // (an enemy guard for an enlisted player: a tap attacks — docs/REINOS.md §15)
function forNear(game, consider) {
  const p = game.player;
  for (const e of game.entities) {
    if (!e.npc || e.dead || Math.abs(e.x - p.x) > 2.6 || Math.abs(e.y - p.y) > 2.6 || Math.abs((e.z || 0) - (p.z || 0)) > 0.5 || npcFighting(e)) continue;
    if (game.army?.npcWhy && !game.army.npcWhy(p, e)) continue; // (no talking with an enemy guard when enlisted against it)
    consider(talkIt(e));
  }
}
registerWork('talk', {
  valid: (g, it) => !it.o.dead && !npcFighting(it.o),
  start(game, it) { game.events.emit('talk', { e: it.o }); return null; }, // (ui/talk.js opens the card; no work loop)
});

// ---------- the host: who is out, spawns / despawns, brains ----------
const nearestPlayerD = (game, x, y) => { let d = 1e9; const w = game.world; for (const q of allPlayers(game)) { if (q.dead) continue; const dd = Math.hypot(w.dx(q.x, x), q.y - y); if (dd < d) d = dd; } return d; };
export function npcLevel(game, S, P) { const lv = realmNpcLevel(game, S.s); return P.guard ? lv : Math.max(1, lv - 2); }

function spawnNpc(game, S, P, x, y, lv = 0) {
  const guard = P.guard, sp = SPECIES[guard ? 'guard' : 'citizen'];
  const level = npcLevel(game, S, P), st = mobStats(sp, level);
  const wp = weaponProfile(P.weapon || null), off = P.offhand ? offhandProfile('shield_iron') : null;
  const wf = guard ? 0.7 + 0.4 * (((wp.min + wp.max) / 2) / 8) : 0.6;
  const ids = allocMob(game);
  const m = {
    isEntity: true, isMob: true, kind: 'pawn', faction: 'town', species: guard ? 'guard' : 'citizen', ...ids,
    name: P.name, level, elite: false, temper: 'friendly', camp: P.code, role: P.job === 'archer' ? 'archer' : 'melee',
    x, y, r: 0.24 * P.scale, scale: P.scale, facing: 's', moving: false, moveT: (P.seed % 1000) / 100, action: null, flash: 0, dead: false, deadT: 0,
    hp: Math.round(st.maxHp * (P.age === 'child' ? 0.5 : guard ? 1.6 : 1)), dmg: st.dmg * wf * (guard ? 1.5 : 1), // (the watch: trained, armoured, iron-armed) home: { x, y }, state: 'idle', stateT: 0, swingT: 0, stunT: 0,
    look: P.look, weapon: P.weapon || null, offhand: P.offhand || null, armor: { body: P.armor?.body || null, head: P.armor?.head || null },
    wprof: wp, shield: off, reachX: wp.reach, swingDur: wp.swing * 1.12, armorV: guard ? equipArmor({ off: 'shield_iron', head: P.armor?.head }) + 4 : 0, aggroR: N.guardSight,
    specialT: 3, blockT: 4, throwT: 2, xpMul: 0, noCorpse: true, npc: P, npcS: S, carry: P.carry, crest: S.crest,
    lv: lv | 0, z: lv || 0, task: null, planKey: '', planT: 0, _acc: 0,
  };
  m.maxHp = m.hp;
  m.campRef = { x, y };
  game.entities.push(m); // sync-ok: host-only creature list (guests get proxies from net/entities.js)
  game.people.stats.spawned++;
  return m;
}
function dropNpc(game, rec, m) {
  const E = game.entities, i = E.indexOf(m);
  if (i >= 0) E.splice(i, 1); // sync-ok: host-only creature list (the person went back to being a count)
  rec.ents.delete(m.npc.i);
  if (game.player.target === m) { game.player.target = null; game.events.emit('target', { target: null }); }
  game.people.stats.dropped++;
}

// where a person comes out when it becomes a creature: the plan's spot when nobody sees it (or it is indoors: the spot
// inside), else the door of its home / workplace (stepping out of the house)
function spawnSpot(game, S, P, pl) {
  if (pl.k === 'wall' || pl.k === 'crew') return [pl.x, pl.y, pl.lv];
  const hidden = (x, y) => !inAnyView(game, x, y, 2, 3);
  if (pl.in && pl.b) {
    // inside: by its bed when it is bedtime (a house whose door is blocked inside included: it is already there)
    const q = (pl.k === 'bed' && bedSide(game, S, P)) || insideAt(game, pl.b, Math.random) || nearPass(game, pl.b.cx, pl.b.cy, 3);
    if (q) return [q[0], q[1], 0];
  }
  if (hidden(pl.x, pl.y)) { const q = nearPass(game, pl.x + ((P.seed % 7) - 3) * 0.5, pl.y + (((P.seed >> 3) % 7) - 3) * 0.5, 3); if (q) return [q[0], q[1], 0]; }
  const H = S.homes[P.home];
  if (H) return [H.out[0], H.out[1], 0];
  const q = nearPass(game, pl.x, pl.y, 4);
  return q ? [q[0], q[1], 0] : null;
}

// the population tick of one settlement (host): who should be a creature now
function manage(game, rec, players) {
  const S = rec.S, L = S.L, hour = game.env?.hour ?? 12, winter = winterAt(game, S), D = deadMap(game);
  const cap = Math.round((N.cap[S.kind] || 40) * (game.quality === 'low' ? 0.6 : 1)); // (a weak device: fewer people out)
  const raid = !!game.raids?.H?.live?.has(S.sid); // (a winter attack played here: the whole watch out, wherever its post — game/raids.js)
  const want = [];
  for (const P of S.persons) {
    if (D.has(`${S.sid}.${P.i}`)) continue;
    const pl = planOf(game, S, P, hour, rec.danger, winter);
    let d = 1e9;
    for (const q of players) { const dd = Math.hypot(game.world.dx(q.x, pl.x), q.y - pl.y); if (dd < d) d = dd; }
    const has = rec.ents.get(P.i);
    if (raid && P.guard && !pl.in) d = Math.min(d, 1);
    // indoors: only when a player stands by that building (and its inside can be reached from its door); outdoors: near enough
    const ok = pl.in ? !!pl.b && d < N.indoorR + Math.max(pl.b.box[2] - pl.b.box[0], pl.b.box[3] - pl.b.box[1]) / 2 : d < (has ? N.dropR : N.matR);
    if (ok) want.push([d, P, pl.in, pl.k, pl.x, pl.y, pl.lv, pl.b]);
  }
  want.sort((a, b) => a[0] - b[0]);
  const keep = new Set();
  for (let k = 0; k < want.length && k < cap; k++) keep.add(want[k][1].i);
  // creatures no longer wanted: back to a count when nobody sees them (else they walk home: npc.js 'vanish')
  for (const [i, m] of rec.ents) {
    if (m.dead) continue;
    if (keep.has(i)) { m._unwanted = 0; continue; }
    m._unwanted = (m._unwanted || 0) + 1;
    if (!inAnyView(game, m.x, m.y, 3, 4) || m._unwanted > 40) dropNpc(game, rec, m);
  }
  // new creatures (a few a tick)
  let made = 0;
  // (owner: "todos deveriam aparecer de uma vez" — a place with nobody out yet (a player just arrived, joined) shows its
  //  people all at once: a city's 60 in one tick, ~23 ms once; then a few a tick, those coming out of their doors)
  const per = rec.ents.size === 0 ? cap : N.spawnPerTick;
  for (let k = 0; k < want.length && k < cap && made < per; k++) {
    const [, P, , , px, py, plv, pb] = want[k];
    if (rec.ents.has(P.i) || game.people.taken?.has(`${rec.sid}.${P.i}`)) continue; // (taken: a player is this person now — the simulation, game/sim.js)
    if (rec.ents.size >= cap) break; // (the cap counts everyone still out: the unwanted ones going home included)
    const pl = { k: want[k][3], in: want[k][2], x: px, y: py, lv: plv, b: pb };
    const at = spawnSpot(game, S, P, pl);
    if (!at) continue;
    const m = spawnNpc(game, S, P, at[0], at[1], at[2]);
    rec.ents.set(P.i, m);
    made++;
  }
  void L;
}

// a building whose inside cannot be reached from its door (furniture in the way): nobody is shown inside it (they
// would be stuck there) — cached per labelling of the town
function sealed(game, rec, b) {
  const nav = navOf(game, rec.sid);
  if (!nav || nav.compV < 0) return false;
  if (b._sealV === nav.compV) return b._sealed;
  b._sealV = nav.compV; b._sealed = true;
  const [x0, y0, x1, y1] = b.box;
  for (let y = y0 + 1; y < y1 && b._sealed; y++) for (let x = x0 + 1; x < x1; x++) if (nav.connected(b.out[0], b.out[1], x + 0.5, y + 0.5)) { b._sealed = false; break; }
  return b._sealed;
}
// hostile creatures in the town land (+ a margin): the danger of a settlement — rec.foes (all of them), rec.inside (the
// ones within its wall line / edge). The alarm ends only when the threat is NEUTRALIZED (owner: "o alerta … sumir apenas
// quando a ameaça estar neutralizada"): a hostile that came into the alarm ring, or is attacking the place — breaking a
// piece of it, fighting one of its people, a winter attack's wave (game/raids.js) — stays a foe while it is alive within
// the hold ring (the town land + N.alarmHold tiles) and attacked / came close within the last N.alarmMemory seconds: one
// that backs off a few steps, kites or stands hitting the wall from outside keeps the bell ringing and the watch on its
// posts; the calm grace (a few seconds) only starts once every one of them is dead or gone
const attacking = (e, S) => e.raid === S.sid || e.siege?.o?.town === S.sid || (!!e.threat?.npc && e.threat.npc.sid === S.sid && e.state === 'chase');
function dangerOf(game, rec) {
  const S = rec.S, r = S.s.r + N.alarmR, r2 = r * r, R = S.s.r + N.alarmHold, R2 = R * R, w = game.world, per = perimeterOf(S), now = game.worldTime;
  const foes = rec.foes || (rec.foes = []), inside = rec.inside || (rec.inside = []), seen = rec.seen || (rec.seen = new Map());
  foes.length = 0; inside.length = 0;
  for (const e of game.entities) {
    if (e.dead || !e.isMob || e.proxy || e.npc) continue;
    if (!(e.faction === 'walker' || e.faction === 'bandit' || e.temper === 'hostile' || (e.soldier && game.warfare?.foeOfTown?.(S, e)))) continue; // (+ the soldiers of a kingdom at war with it: game/warfare.js)
    const dx = w.dx(e.x, S.s.x), dy = e.y - S.s.y, d2 = dx * dx + dy * dy;
    if (d2 >= R2) continue;
    if (d2 < r2 || attacking(e, S)) seen.set(e, now);
    else if (!(rec.danger && now - (seen.get(e) ?? -1e9) < N.alarmMemory)) continue;
    foes.push(e);
    if (per.inside(e.x, e.y, w)) inside.push(e);
  }
  if (seen.size) for (const [e, t] of seen) if (e.dead || now - t > N.alarmMemory) seen.delete(e);
  // (an enlisted player of a kingdom at war with the place: the bell, the gates, the watch — game/army.js, phase 3c)
  if (game.army?.en?.size || game.skirmish?.on) for (const e of allPlayers(game)) { // (+ a skirmish's side)
    if (e.dead || !game.army.townFoe(S, e)) continue;
    const dx = w.dx(e.x, S.s.x), dy = e.y - S.s.y;
    if (dx * dx + dy * dy >= r2) continue;
    foes.push(e);
    if (per.inside(e.x, e.y, w)) inside.push(e);
  }
  return foes.length > 0;
}
// the defense (defense.js): new posts only when something changed — the alarm, a gap opened / closed, the attackers'
// side, a guard dead / back
function defenseTick(game, rec) {
  const S = rec.S, ops = openings(game, S), D = deadMap(game);
  // the fronts (defense.js frontsOf): the foes outside by side, an army besieging it weighing its whole number at the side
  // it attacks (the live siege: game/warfare.js; else the besiegers' camp by numbers: game/realms.js); the main one is the
  // threat, a smaller one gets a share of the watch proportional to its size
  const anchor = rec.danger ? game.warfare?.threatOn?.(S.sid) || game.realms?.siegeThreat?.(S.sid, null) || null : null;
  rec.fronts = rec.danger ? frontsOf(game, S, rec.foes || [], anchor, rec.fronts) : [];
  rec.threat = rec.fronts[0] || null;
  let dk = 0;
  for (const P of S.persons) if (P.guard && D.has(`${S.sid}.${P.i}`)) dk = (Math.imul(dk, 31) + P.i + 1) | 0;
  const tw = rec.danger ? game.warfare?.towersOn?.(S.sid) || [] : []; // (a siege tower standing: a few melee guards up on the walk where it comes — defense.js)
  const sig = `${rec.danger ? 1 : 0}|${ops.map((o) => o.id + ':' + o.w).join(',')}|${frontsSig(rec.fronts)}|${dk}|${tw.map((q) => q.id).join(',')}`;
  if (sig !== rec.defSig) {
    rec.defSig = sig;
    S.def = rec.danger || ops.length ? assignDefense(game, S, rec, ops, rec.threat, rec.danger, rec.fronts) : null;
    game.people.stats.defs = (game.people.stats.defs || 0) + 1;
    for (const m of rec.ents.values()) if (m.npc.guard) m.planT = 0; // (to their new posts now)
  }
  // the foes already inside the walls: hunted by the reserve and the nearest melee guards (not the ones holding a gap /
  // manning a ballista) — a few per foe
  for (const m of rec.ents.values()) m.hunt = null;
  if (!rec.danger || !rec.inside?.length) return;
  const pool = [];
  for (const m of rec.ents.values()) {
    if (m.dead || m.npc.job !== 'guard' || m.z > 0.5) continue;
    const k = S.def?.posts.get(m.npc.i)?.k;
    if (k !== 'crew' && k !== 'wall') pool.push([m, k === 'reserve' ? -1000 : k === 'gap' ? 40 : 0]); // (not the ones going up to meet a siege tower)
  }
  for (const e of rec.inside) {
    if (!hostile(e, S, game)) continue;
    pool.sort((a, b) => (Math.hypot(a[0].x - e.x, a[0].y - e.y) + a[1]) - (Math.hypot(b[0].x - e.x, b[0].y - e.y) + b[1]));
    let n = 0;
    for (const [m] of pool) { if (m.hunt) continue; m.hunt = e; if (++n >= N.def.hunters) break; }
  }
}

export function peopleSystem() {
  let tickT = 0, frame = 0, regrowT = 5, progT = 2, repT = 30;
  return {
    sync: 'host', // the people are host creatures (guests: proxies, net/entities.js)
    update(game, dt) {
      const Pp = game.people, T = game.towns;
      if (!Pp || !T?.realm) return;
      const t0 = performance.now();
      frame++;
      const players = allPlayers(game).filter((q) => !q.dead);
      // population tick: which settlements are near, danger / the bell, who should be out
      tickT -= dt;
      if (tickT <= 0) {
        tickT = N.tick;
        const near = new Set();
        if (!Pp.off) for (const sid of T.live.keys()) {
          const s = T.realm.settlements[sid];
          if (!s || nearestPlayerD(game, s.x, s.y) > s.ro + N.matR) continue;
          near.add(sid);
        }
        for (const [sid, rec] of Pp.live) if (!near.has(sid)) { for (const m of [...rec.ents.values()]) dropNpc(game, rec, m); if (rec.danger) game.net.emit('town.alarm', { sid, on: 0 }); rec.S.def = null; Pp.live.delete(sid); }
        for (const sid of near) {
          let rec = Pp.live.get(sid);
          if (!rec) { const S = peopleOf(game, sid); if (!S) continue; rec = { sid, S, ents: new Map(), danger: false, dangerT: 0, repair: null, defSig: '' }; S.def = null; Pp.live.set(sid, rec); }
          const dg = dangerOf(game, rec) || !!game.warfare?.threatOn?.(sid) || !!game.realms?.besieged?.(sid); // (+ an army camped before it — live (game/warfare.js) or by numbers (phase 3a): the bell, home, the walls)
          if (dg) rec.dangerT = game.worldTime;
          const was = rec.danger;
          rec.danger = dg || (rec.danger && game.worldTime - rec.dangerT < 6); // (a few calm seconds before the all-clear)
          if (rec.danger !== was) game.net.emit('town.alarm', { sid, on: rec.danger ? 1 : 0 });
          defenseTick(game, rec);
          manage(game, rec, players);
          repairTick(game, rec, N.tick);
          scavTick(game, rec, N.tick);
        }
      }
      // the brains (far ones every few frames)
      let n = 0;
      game._townPathBudget = N.pathBudget;
      for (const rec of Pp.live.values()) {
        for (const m of rec.ents.values()) { // (a Map: a person dropped meanwhile is simply not visited)
          if (m.dead) {
            if (!m._goneAt) { m._goneAt = game.worldTime; onDeath(game, rec, m); }
            else if (game.worldTime - m._goneAt > 6) dropNpc(game, rec, m);
            continue;
          }
          let d = 1e9;
          for (const q of players) { const dd = Math.abs(game.world.dx(q.x, m.x)) + Math.abs(q.y - m.y); if (dd < d) d = dd; }
          m._pd = d;
          m._acc += dt;
          if (d > N.nearR && (frame + m.id) % N.farK && m.state !== 'chase' && !rec.danger) continue;
          npcBrain(game, rec, m, m._acc);
          m._acc = 0;
          n++;
        }
        npcSeparate(game, rec);
        game.people.nav.get(rec.sid)?.tick(1.2); // (the town's regions, in slices)
      }
      // the dead come back (one at a time per settlement, after some days)
      regrowT -= dt;
      if (regrowT <= 0) { regrowT = 5; regrow(game); }
      // far from the players, the walls are mended by the hour (an in-game hour: dayLength / 24)
      repT -= dt;
      if (repT <= 0) { repT = (game.env?.dayLength || 780) / 24; repairByNumbers(game); }
      // the world's progress (§7b): the highest player level ever seen here
      progT -= dt;
      if (progT <= 0) { progT = 2; let lv = 1; for (const q of allPlayers(game)) lv = Math.max(lv, q.level | 0); if (lv > (T.prog || 1)) game.net.emit('town.prog', { lv }); }
      const ms = performance.now() - t0, S = Pp.stats;
      S.frames++; S.msSum += ms; S.maxMs = Math.max(S.maxMs, ms); S.brains = n;
      S.live = 0; for (const rec of Pp.live.values()) S.live += rec.ents.size;
      S.peak = Math.max(S.peak, S.live);
      S.last.push(ms); if (S.last.length > 240) S.last.shift();
    },
  };
}

function onDeath(game, rec, m) {
  const P = m.npc;
  m.task = null; m.pose = null;
  game.net.emit('town.pop', { sid: rec.sid, i: P.i, dead: 1, at: Math.round(game.worldTime) });
}
// each death is made good regrowDays later (a newcomer takes the place: the same identity from the seed)
function regrow(game) {
  const D = deadMap(game), day = game.env?.dayLength || 780;
  for (const [k, at] of D) {
    if (game.worldTime - at < N.regrowDays * day) continue;
    const [sid, i] = k.split('.').map(Number);
    game.net.emit('town.pop', { sid, i, dead: 0 });
  }
}

void TAU; void hexOf; void BUILDINGS;

// ---------- every peer: doors swing as the people go through, the bell, the news ----------
const NB5 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function peopleFxSystem() {
  let wired = false, bellT = 0, bellN = 0, bellSid = -1;
  const near = (game, sid, pad) => { const s = game.towns?.realm?.settlements[sid], p = game.player; return !!s && !p.dead && Math.hypot(game.world.dx(p.x, s.x), p.y - s.y) < s.r + pad; };
  return {
    sync: 'cosmetic', // doors ajar (from what each peer sees), the bell and the toasts of the place the local player is in
    update(game, dt) {
      if (!game.people || !game.towns?.realm) return;
      if (!wired) {
        wired = true;
        game.events.on('townalarm', ({ sid, on }) => {
          const s = game.towns.realm.settlements[sid];
          if (on) game.people.alarm.set(sid, true); else game.people.alarm.delete(sid);
          const raid = !!game.raids?.on?.has(sid); // (a winter attack: its own notices tell the story — ui/raidHud.js)
          if (on) { bellSid = sid; bellN = 0; bellT = 0; if (near(game, sid, 30) && !raid) game.events.emit('toast', { text: `Alarme em ${s.name}! Monstros na ${s.kind === 'castle' ? 'fortaleza' : s.kind === 'city' ? 'cidade' : 'vila'} — o povo corre para casa e a guarda vai lutar`, kind: 'warn' }); }
          else { if (bellSid === sid) bellSid = -1; if (near(game, sid, 30) && !raid) game.events.emit('toast', { text: `${s.name}: tudo calmo de novo`, kind: 'info' }); }
        });
        // (no toast for each death — owner: in a battle there are many dead, a swarm of messages; the bell and the
        //  all-clear tell the story)
      }
      // the bell: three strokes when it starts, then now and then while the danger lasts (heard near the place)
      if (bellSid >= 0) {
        bellT -= dt;
        if (bellT <= 0) {
          bellT = bellN < 3 ? 2.6 : 9;
          bellN++;
          const s = game.towns.realm.settlements[bellSid];
          if (s && near(game, bellSid, 50)) game.audio?.play('town_bell', { x: s.x, y: s.y, volume: 0.9 });
        }
      }
      // the watch carries a lantern at night (a warm pool of light around the guards and on the walls)
      const nk = game.env?.env?.night || 0;
      for (const e of game.entities) {
        if (!e.npc?.guard) continue;
        if (nk > 0.25 && !e.dead) { const L = e.light || (e.light = { r: 1, g: 0.72, b: 0.42, radius: 2.6, intensity: 0, flicker: 0.18, lift: 0.9 }); L.intensity = 0.55 * Math.min(1, nk * 1.3); L.lift = 0.9 + (e.z || 0) * STORY_H; }
        else if (e.light) e.light = null;
      }
      // their doors / gates swing open a moment as they go through (closed for everyone else)
      const G = game.build.grid.main, w = game.world, t = game.time;
      for (const e of game.entities) {
        if (!e.npc || e.dead || !e.moving || e.z > 0.5) continue;
        const tx = Math.floor(e.x), ty = Math.floor(e.y);
        for (const [dx, dy] of NB5) {
          const o = G.get(w.idx(tx + dx, ty + dy));
          if (!o || !o.door || o.town == null || o.open) continue;
          if (Math.abs(o.tx + (o.fw || 1) / 2 - e.x) > 1.25 || Math.abs(o.ty + (o.fh || 1) / 2 - e.y) > 1.25) continue;
          if (!(o._ajarT > t)) game.audio?.play('door_open', { x: o.x, y: o.y - 0.4, volume: 0.45 });
          o._ajarT = t + 1.1;
        }
      }
    },
  };
}
