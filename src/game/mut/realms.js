// The kingdoms' diplomacy, ownership and armies: every shared change (docs/REINOS.md §12 / §13, game/realms.js).
// The host decides (game/realms.js realmsSystem: the daily diplomacy, campaigns, marches, battles and sieges by numbers);
// these appliers run on every peer and are the only writers of the state below (on game.realms, next to its API):
//   day, day0          the last diplomacy day the host processed · the world's first one (the grace counts from it)
//   k0                 the start kingdom (the kingdom of the world's spawn village)
//   rels  Map 'a.b' → { r: 'war' | 'ally' | 'truce', since (day), by (who declared: −1), wa, wb (war weariness), until (truce) }
//   tens  Map 'a.b' → tension 0..100 (neighbours) · past Map 'a.b' → wars fought
//   own   Map sid → k  (a place taken: its kingdom now; the seed's s.k otherwise) · fallen Set k (kingdoms gone)
//   armies Map id → army — the home army of every place ('g<sid>', state 'home': its garrison) and the armies in the
//                field ('a<n>'): { id, k, home, n, n0, lv, state 'home'|'march'|'camp'|'siege'|'battle'|'retreat',
//                target (sid | −1), mission 'attack'|'relief'|'return'|'', path { f (from sid), r [roadId, dir, …] },
//                t0, d0, v (a march: worldTime and distance along the route at its start, tiles / s — the position is
//                derived from the clock on every peer), x, y, eng [treb, cat, ram, tower], foe (army id), since, phase,
//                bp (engine build points), hrs, dw, dn, bn, live }
//   scar  Map sid → worldTime  (a siege there ended: the walls stay broken for a while)
//   news  [[n, day, hour×10, type, a, b, sid, x]]  the last WAR.news events (mural lists, notices)
// Ops: realm.start · realm.day · realm.rel · realm.army · realm.wall · realm.capture · realm.fall
// Rows: realmRows / applyRealmRows (snapshot / save `realms`, global), realmDigestRows (digest part `realms`).

import { defineOp } from '../../net/registry.js';
import { canReach, districtAt, kingdomAt } from '../../world/realm/realm.js';
import { WAR, capOf } from '../content/war.js';
import { TOWN, structById, removeStructure } from './structures.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v, d = 0) => Math.floor(num(v, d));
const str = (v, n = 24) => (typeof v === 'string' ? v.slice(0, n) : '');
const r2 = (v) => Math.round(num(v) * 100) / 100;
export const relKey = (a, b) => (a < b ? `${a}.${b}` : `${b}.${a}`);
export const STATES = ['home', 'march', 'camp', 'siege', 'battle', 'retreat'];
const realmOf = (game) => game.towns?.realm || null;

// ---------- state ----------
export function realmsState(game) {
  const R = game.realms || (game.realms = {});
  if (!R.armies) Object.assign(R, { day: -1, day0: -1, k0: -1, rels: new Map(), tens: new Map(), past: new Map(), own: new Map(), fallen: new Set(), armies: new Map(), scar: new Map(), news: [], nn: 0, nid: 0, v: 0, ov: 0, rv: 0 });
  return R;
}
// the kingdom a place belongs to now (the seed's s.k until it is taken) — every peer
export function ownerOf(game, sid) {
  const R = game.realms, s = realmOf(game)?.settlements[sid];
  if (!s) return -1;
  const k = R?.own?.get(sid);
  return k == null ? s.k : k;
}
// the kingdom whose land holds (x, y), following the captures: a district belongs to its place's owner
export function ownerAt(game, x, y) {
  const realm = realmOf(game);
  if (!realm) return -1;
  const k = kingdomAt(realm, x, y);
  if (k < 0) return -1;
  const d = districtAt(realm, x, y);
  return d ? ownerOf(game, d.id) : k;
}
export const bump = (game, what = 'v') => { const R = realmsState(game); R.v++; if (what === 'own') R.ov++; if (what === 'rel') R.rv++; };

// ---------- the news (every peer, inside appliers) ----------
export const NEWS_TYPES = ['war', 'peace', 'ally', 'break', 'truce', 'march', 'siege', 'battle', 'won', 'lift', 'capture', 'retake', 'fall', 'relief'];
function addNews(game, type, a, b, sid = -1, x = 0) {
  const R = realmsState(game);
  const row = [++R.nn, game.env?.dayIndex | 0, Math.round((game.env?.hour ?? 12) * 10), type, a | 0, b | 0, sid | 0, Math.round(num(x))];
  R.news.push(row);
  if (R.news.length > WAR.news) R.news.splice(0, R.news.length - WAR.news);
  game.events?.emit('realmnews', { row });
}

// ---------- armies ----------
const ENG0 = () => [0, 0, 0, 0];
export function homeArmy(game, sid, n = null) {
  const s = realmOf(game)?.settlements[sid];
  return { id: 'g' + sid, k: ownerOf(game, sid), home: sid, n: n == null ? Math.round(capOf(s) * WAR.init) : n, n0: 0, lv: 1, state: 'home', target: -1, mission: '', path: null,
    t0: 0, d0: 0, v: 0, x: s.x, y: s.y, eng: ENG0(), foe: '', since: 0, phase: '', bp: 0, hrs: 0, dw: 0, dn: 0, bn: 0, live: 0, grp: '' };
}
export function cleanArmy(game, o) {
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[ga]\w{1,12}$/.test(o.id)) return null;
  const realm = realmOf(game), S = realm?.settlements;
  const home = int(o.home, -1);
  if (!S?.[home]) return null;
  const a = homeArmy(game, home, Math.max(0, int(o.n)));
  a.id = o.id; a.k = int(o.k, a.k); a.n0 = Math.max(0, int(o.n0)); a.lv = Math.max(1, int(o.lv, 1));
  a.state = STATES.includes(o.state) ? o.state : 'home';
  a.target = S[int(o.target, -1)] ? int(o.target) : -1;
  a.mission = ['attack', 'relief', 'join', 'return', ''].includes(o.mission) ? o.mission : '';
  if (o.path && Array.isArray(o.path.r) && S[int(o.path.f, -1)]) {
    a.path = { f: int(o.path.f), r: o.path.r.slice(0, 120).map((v) => int(v)) };
    if (Array.isArray(o.path.c) && S[int(o.path.t, -1)]) { a.path.t = int(o.path.t); a.path.c = o.path.c.slice(0, 400).map((v) => int(v)); } // (across country: macro cells)
  }
  a.t0 = r2(o.t0); a.d0 = r2(o.d0); a.v = num(o.v); a.x = r2(o.x ?? a.x); a.y = r2(o.y ?? a.y);
  a.eng = Array.isArray(o.eng) ? [0, 1, 2, 3].map((i) => Math.max(0, int(o.eng[i]))) : ENG0();
  a.foe = str(o.foe, 14); a.since = r2(o.since); a.phase = str(o.phase, 16); a.bp = r2(o.bp); a.hrs = Math.max(0, int(o.hrs)); a.dw = Math.max(0, int(o.dw)); a.dn = Math.max(0, int(o.dn)); a.bn = Math.max(0, int(o.bn));
  a.live = o.live ? 1 : 0; a.grp = str(o.grp, 14);
  return a;
}
export const armyRow = (a) => ({ id: a.id, k: a.k, home: a.home, n: a.n, n0: a.n0, lv: a.lv, state: a.state, target: a.target, mission: a.mission, path: a.path ? (a.path.c ? { f: a.path.f, r: a.path.r.slice(), t: a.path.t, c: a.path.c.slice() } : { f: a.path.f, r: a.path.r.slice() }) : null,
  t0: a.t0, d0: a.d0, v: a.v, x: a.x, y: a.y, eng: a.eng.slice(), foe: a.foe, since: a.since, phase: a.phase, bp: a.bp, hrs: a.hrs, dw: a.dw, dn: a.dn, bn: a.bn, live: a.live, grp: a.grp });
// put an army in (keeps the derived route cache of the same path)
function setArmy(game, a) {
  const R = realmsState(game), old = R.armies.get(a.id);
  if (old && old._route && old.path && a.path && old.path.f === a.path.f && old.path.r.join() === a.path.r.join() && (old.path.c || []).join() === (a.path.c || []).join()) a._route = old._route;
  const m = /^a(\d+)$/.exec(a.id);
  if (m) R.nid = Math.max(R.nid, +m[1]); // (the next army's number: host and guests agree)
  if (old) for (const k of ['_hx', '_hy', '_dir']) if (old[k] != null) a[k] = old[k];
  R.armies.set(a.id, a);
  return a;
}
// the siege index: sid → the army besieging it (derived)
export function siegeIndex(game) {
  const R = realmsState(game);
  if (R._sv === R.v && R._sieges) return R._sieges;
  const M = new Map();
  for (const a of R.armies.values()) if (a.state === 'siege' && a.target >= 0 && !M.has(a.target)) M.set(a.target, a);
  R._sieges = M; R._sv = R.v;
  return M;
}

// ---------- rows (snapshot / save / digest) ----------
export function realmRows(game) {
  const R = game.realms;
  if (!R || !R.armies || R.day0 < 0) return null;
  const sortK = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return {
    day: R.day, day0: R.day0, k0: R.k0, nn: R.nn, nid: R.nid,
    rel: [...R.rels].map(([k, r]) => [k, r.r, r.since | 0, r.by ?? -1, r.wa | 0, r.wb | 0, r.until | 0]).sort(sortK),
    tens: [...R.tens].map(([k, t]) => [k, Math.round(t * 10) / 10]).sort(sortK),
    past: [...R.past].map(([k, n]) => [k, n]).sort(sortK),
    own: [...R.own].sort((a, b) => a[0] - b[0]),
    fallen: [...R.fallen].sort((a, b) => a - b),
    armies: [...R.armies.values()].map(armyRow).sort((a, b) => (a.id < b.id ? -1 : 1)),
    scar: [...R.scar].sort((a, b) => a[0] - b[0]),
    news: R.news.map((r) => r.slice()),
  };
}
export function applyRealmRows(game, d, reconcile) {
  const R = realmsState(game);
  const before = new Map(R.own);
  if (!d || typeof d !== 'object') {
    if (!reconcile) return;
    Object.assign(R, { day: -1, day0: -1, k0: -1, nn: 0, nid: 0 });
    R.rels.clear(); R.tens.clear(); R.past.clear(); R.own.clear(); R.fallen.clear(); R.armies.clear(); R.scar.clear(); R.news = [];
  } else {
    R.day = int(d.day, -1); R.day0 = int(d.day0, -1); R.k0 = int(d.k0, -1); R.nn = int(d.nn); R.nid = int(d.nid);
    R.rels.clear();
    for (const r of Array.isArray(d.rel) ? d.rel : []) if (Array.isArray(r) && typeof r[0] === 'string' && ['war', 'ally', 'truce'].includes(r[1])) R.rels.set(r[0], { r: r[1], since: int(r[2]), by: int(r[3], -1), wa: int(r[4]), wb: int(r[5]), until: int(r[6]) });
    R.tens.clear();
    for (const r of Array.isArray(d.tens) ? d.tens : []) if (Array.isArray(r) && typeof r[0] === 'string') R.tens.set(r[0], Math.max(0, Math.min(100, num(r[1]))));
    R.past.clear();
    for (const r of Array.isArray(d.past) ? d.past : []) if (Array.isArray(r) && typeof r[0] === 'string') R.past.set(r[0], Math.max(0, int(r[1])));
    R.own.clear();
    for (const r of Array.isArray(d.own) ? d.own : []) if (Array.isArray(r) && realmOf(game)?.settlements[int(r[0], -1)]) R.own.set(int(r[0]), int(r[1]));
    R.fallen = new Set((Array.isArray(d.fallen) ? d.fallen : []).map((k) => int(k)));
    R.armies.clear();
    for (const o of Array.isArray(d.armies) ? d.armies : []) { const a = cleanArmy(game, o); if (a) R.armies.set(a.id, a); }
    R.scar.clear();
    for (const r of Array.isArray(d.scar) ? d.scar : []) if (Array.isArray(r)) R.scar.set(int(r[0]), num(r[1]));
    R.news = (Array.isArray(d.news) ? d.news : []).filter((r) => Array.isArray(r) && r.length >= 8).map((r) => [int(r[0]), int(r[1]), int(r[2]), str(r[3], 10), int(r[4]), int(r[5]), int(r[6]), int(r[7])]).slice(-WAR.news);
  }
  // places whose kingdom changed here: their people / mural / map follow
  const changed = new Set();
  for (const sid of new Set([...before.keys(), ...R.own.keys()])) if (before.get(sid) !== R.own.get(sid)) changed.add(sid);
  for (const sid of changed) ownerChanged(game, sid);
  bump(game, 'own'); bump(game, 'rel');
  game.events?.emit('realms', { type: 'sync' });
}
// digest rows (exact): relations, tensions, owners, the fallen, armies (a marching army by its route and clock — its
// position is derived from the world clock), the news
export function realmDigestRows(game) {
  const D = realmRows(game);
  if (!D) return [];
  const out = [['day', D.day, D.day0, D.k0, D.nn, D.nid], ['own', JSON.stringify(D.own)], ['fallen', D.fallen.join(',')], ['scar', JSON.stringify(D.scar.map(([s, t]) => [s, Math.round(t)]))]];
  for (const r of D.rel) out.push(['r' + r[0], JSON.stringify(r)]);
  for (const r of D.tens) out.push(['t' + r[0], r[1]]);
  for (const r of D.past) out.push(['p' + r[0], r[1]]);
  for (const a of D.armies) {
    const moving = a.state === 'march' || a.state === 'retreat';
    out.push(['a' + a.id, JSON.stringify({ ...a, x: moving ? 0 : Math.round(a.x * 10), y: moving ? 0 : Math.round(a.y * 10) })]);
  }
  out.push(['news', JSON.stringify(D.news)]);
  return out;
}

// a place changed kingdoms on this peer: its people's colours (rebuilt from the seed with the new owner), the mural's
// colours, its home army's kingdom (game/people.js, game/towns.js read ownerOf)
function ownerChanged(game, sid) {
  game.people?.S?.delete(sid);
  const g = realmsState(game).armies.get('g' + sid);
  if (g) g.k = ownerOf(game, sid);
  TOWN.recolor?.(game, sid);
  game.events?.emit('realmowner', { sid, k: ownerOf(game, sid) });
}

// ---------- ops ----------
defineOp('realm.start', {
  doc: 'The kingdoms\' wars begin in this world (host, once): the first day (the start kingdom\'s grace counts from it), the start kingdom, the first tensions between neighbours and every place\'s home army — all from the seed.',
  args: { day0: 'int', k0: 'int', tens: '[[key, t]]' },
  apply(game, a) {
    const R = realmsState(game), realm = realmOf(game);
    if (!realm) return;
    R.day0 = int(a.day0); R.day = int(a.day0) - 1; R.k0 = int(a.k0, -1);
    R.tens.clear();
    for (const r of Array.isArray(a.tens) ? a.tens : []) if (Array.isArray(r) && typeof r[0] === 'string') R.tens.set(r[0], num(r[1]));
    for (const s of realm.settlements) if (!R.armies.has('g' + s.id)) R.armies.set('g' + s.id, homeArmy(game, s.id));
    bump(game, 'rel');
    game.events?.emit('realms', { type: 'start' });
  },
});

defineOp('realm.day', {
  doc: 'The kingdoms\' day (host): every home army\'s soldiers (recruits, losses made good) and level (§7b), the tensions between neighbours, the war weariness.',
  args: { day: 'int', gar: '[[sid, n, lv]]', tens: '[[key, t]]', weary: '[[key, wa, wb]]' },
  apply(game, a) {
    const R = realmsState(game);
    R.day = int(a.day);
    for (const r of Array.isArray(a.gar) ? a.gar : []) {
      if (!Array.isArray(r)) continue;
      const g = R.armies.get('g' + int(r[0]));
      if (g) { g.n = Math.max(0, int(r[1])); g.lv = Math.max(1, int(r[2], 1)); }
    }
    for (const r of Array.isArray(a.tens) ? a.tens : []) if (Array.isArray(r) && typeof r[0] === 'string') R.tens.set(r[0], Math.max(0, Math.min(100, num(r[1]))));
    for (const r of Array.isArray(a.weary) ? a.weary : []) { const w = Array.isArray(r) && R.rels.get(r[0]); if (w && w.r === 'war') { w.wa = int(r[1]); w.wb = int(r[2]); } }
    bump(game);
    game.events?.emit('realms', { type: 'day' });
  },
});

defineOp('realm.rel', {
  doc: 'Two kingdoms\' relation changes: war (declared by `by`), ally, truce (a peace treaty, until a day) or neutral. Never between kingdoms of different land masses (no ships). Also the debug / test op (§12): realm.rel {a, b, rel}.',
  args: { a: 'int', b: 'int', rel: "'war'|'ally'|'truce'|'neutral'", by: 'int?', until: 'int?', why: "'declare'|'pact'|'peace'|'break'|'expire'|'fall'|'debug'?", quiet: '0|1?' },
  apply(game, a) {
    const R = realmsState(game), realm = realmOf(game), A = int(a.a, -1), B = int(a.b, -1);
    if (!realm || A === B || !realm.kingdoms[A] || !realm.kingdoms[B]) return;
    if (a.rel !== 'neutral' && (!canReach(realm, A, B) || R.fallen.has(A) || R.fallen.has(B))) return; // (other land / gone: no relations)
    const key = relKey(A, B), old = R.rels.get(key), day = game.env?.dayIndex | 0;
    if (a.rel === 'war') {
      if (old?.r === 'war') return;
      R.rels.set(key, { r: 'war', since: day, by: num(a.by, -1) === B ? B : A, wa: 0, wb: 0, until: 0 });
      if (!a.quiet) addNews(game, 'war', num(a.by, -1) === B ? B : A, num(a.by, -1) === B ? A : B);
    } else if (a.rel === 'ally') {
      R.rels.set(key, { r: 'ally', since: day, by: -1, wa: 0, wb: 0, until: 0 });
      if (!a.quiet) addNews(game, 'ally', A, B);
    } else if (a.rel === 'truce') {
      if (old?.r === 'war') R.past.set(key, (R.past.get(key) || 0) + 1);
      R.rels.set(key, { r: 'truce', since: day, by: -1, wa: 0, wb: 0, until: int(a.until, day + WAR.truceDays) });
      if (!a.quiet) addNews(game, 'peace', A, B, -1, int(a.until, day + WAR.truceDays));
    } else {
      if (!old) return;
      R.rels.delete(key);
      if (old.r === 'war') R.past.set(key, (R.past.get(key) || 0) + 1);
      if (!a.quiet && a.why !== 'fall') addNews(game, old.r === 'ally' ? 'break' : old.r === 'truce' ? 'truce' : 'peace', A, B);
    }
    bump(game, 'rel');
    game.events?.emit('realms', { type: 'rel', a: A, b: B, rel: a.rel });
  },
});

defineOp('realm.army', {
  doc: 'An army is created / changes (its whole row: soldiers, state, route and clock of a march, siege, battle) or goes (del: home, merged, beaten); `gar` sets home armies\' soldiers (a campaign takes them, a return gives them back); `news` = [type, a, b, sid, x] (march, siege, battle, won, lift, relief); `scar` = the place whose siege ended.',
  args: { a: 'army?', del: 'armyId?', gar: '[[sid, n]]?', news: '[type, a, b, sid, x]?', scar: 'sid?', wt: 'worldTime?' },
  apply(game, a) {
    const R = realmsState(game);
    if (a.a) { const o = cleanArmy(game, a.a); if (o) setArmy(game, o); }
    if (typeof a.del === 'string' && a.del[0] === 'a') R.armies.delete(a.del);
    for (const r of Array.isArray(a.gar) ? a.gar.slice(0, 40) : []) { const g = Array.isArray(r) && R.armies.get('g' + int(r[0])); if (g) g.n = Math.max(0, int(r[1])); }
    if (a.scar != null && realmOf(game)?.settlements[int(a.scar, -1)]) R.scar.set(int(a.scar), r2(num(a.wt, game.worldTime)));
    if (Array.isArray(a.news) && NEWS_TYPES.includes(a.news[0])) addNews(game, a.news[0], int(a.news[1]), int(a.news[2]), int(a.news[3], -1), int(a.news[4]));
    bump(game);
    game.events?.emit('realms', { type: 'army', id: a.a?.id || a.del });
  },
});

// a siege by numbers breaks the pieces of the wall line facing the camp: cracks (0..1) and pieces destroyed — kept in the
// town state (mut/towns.js), loaded here or not; a loaded piece shows it at once
defineOp('realm.wall', {
  doc: 'Siege damage by numbers on a place\'s pieces (host): `hit` [[piece index, damage 0..1]], `gone` [piece index] destroyed — town state rows, loaded or not.',
  args: { sid: 'int', hit: '[[k, d]]', gone: '[k]', x: 'number?', y: 'number?' },
  apply(game, a) {
    const sid = int(a.sid, -1);
    if (!realmOf(game)?.settlements[sid]) return;
    for (const r of Array.isArray(a.hit) ? a.hit.slice(0, 80) : []) {
      if (!Array.isArray(r)) continue;
      const id = `t${sid}.${int(r[0])}`, d = Math.max(0, Math.min(1, num(r[1])));
      const o = structById(game, id);
      if (!o) { TOWN.noteAbsent?.(game, id, 'dmg', d); continue; }
      if (d > 0) { o.dmg = d; o.sdmg = 1; } else { delete o.dmg; delete o.sdmg; }
      TOWN.note?.(game, o, 'dmg');
      game.rockFx?.structHit?.(game, o, num(a.x, o.x), num(a.y, o.y));
    }
    for (const k of Array.isArray(a.gone) ? a.gone.slice(0, 40) : []) {
      const id = `t${sid}.${int(k)}`, o = structById(game, id);
      if (!o) { TOWN.noteAbsent?.(game, id, 'gone'); continue; }
      game.rockFx?.structBreak?.(game, o);
      removeStructure(game, o, { quiet: true, fx: 'raze' });
    }
    game.events?.emit('realms', { type: 'wall', sid });
  },
});

defineOp('realm.capture', {
  doc: 'A place is taken: it belongs to kingdom k now (people\'s colours, mural, map, economy, guards); its home army is the winners\' garrison (n).',
  args: { sid: 'int', k: 'int', from: 'int', n: 'int' },
  apply(game, a) {
    const R = realmsState(game), realm = realmOf(game), sid = int(a.sid, -1), k = int(a.k, -1);
    const s = realm?.settlements[sid];
    if (!s || !realm.kingdoms[k]) return;
    const from = ownerOf(game, sid);
    if (from === k) return;
    if (k === s.k) R.own.delete(sid); else R.own.set(sid, k);
    const g = R.armies.get('g' + sid) || R.armies.set('g' + sid, homeArmy(game, sid, 0)).get('g' + sid);
    g.k = k; g.n = Math.max(0, int(a.n)); g.state = 'home';
    ownerChanged(game, sid);
    addNews(game, k === s.k ? 'retake' : 'capture', k, from, sid);
    bump(game, 'own');
    game.events?.emit('realms', { type: 'capture', sid, from, to: k });
    game.events?.emit('capture', { sid, from, to: k }); // (§12: evento capture { sid, from, to })
  },
});

defineOp('realm.fall', {
  doc: 'A kingdom without a city falls: its remaining castles and villages pass to the kingdom that took its last city (`to`); its relations end, its armies in the field go home to nothing.',
  args: { k: 'int', to: 'int' },
  apply(game, a) {
    const R = realmsState(game), realm = realmOf(game), k = int(a.k, -1), to = int(a.to, -1);
    if (!realm?.kingdoms[k] || !realm.kingdoms[to] || R.fallen.has(k)) return;
    R.fallen.add(k);
    for (const s of realm.settlements) {
      if (ownerOf(game, s.id) !== k) continue;
      if (to === s.k) R.own.delete(s.id); else R.own.set(s.id, to);
      ownerChanged(game, s.id);
    }
    for (const [key, r] of [...R.rels]) { const [x, y] = key.split('.').map(Number); if (x === k || y === k) { if (r.r === 'war') R.past.set(key, (R.past.get(key) || 0) + 1); R.rels.delete(key); } }
    for (const [key] of [...R.tens]) { const [x, y] = key.split('.').map(Number); if (x === k || y === k) R.tens.delete(key); }
    for (const [id, ar] of [...R.armies]) if (id[0] === 'a' && ar.k === k) R.armies.delete(id);
    addNews(game, 'fall', k, to);
    bump(game, 'own'); bump(game, 'rel');
    game.events?.emit('realms', { type: 'fall', k, to });
  },
});
