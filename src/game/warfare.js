// War near the players (docs/REINOS.md §12 contract, §14 "Fase 3b — campo de batalha e cerco"): the armies of the
// kingdoms as real soldiers when they are near a player — field battles and the playable siege (game/siegeAI.js).
//
// game.warfare (every peer; the host decides):
//   materialize(army) / dematerialize(id) → { n, eng, siege }   (game/realms.js of part 3a hands an army over when it comes
//       within ~120 tiles of a player, and takes it back as numbers when nobody is near)
//   forces                  Map id → force (host: the whole force; guests: its public row — op war.force)
//   startSiege(spec)        debug / tests: spec = { k, sid (the target), n, lv, eng { treb, ram, tower }, at: [x, y] }
//   startBattle(a, b)       debug / tests: a / b = { k, n, lv, at: [x, y] } (or armies of 3a)
//   decorate(e), label(e), mayHurt(player, e), forceOfEnt(e), threatOn(sid), towersOn(sid), siegeOn(sid), debug(id)
// Who is at war: game.realms.atWar(a, b) (3a); the owner of a place: game.realms.owner(sid) ?? the settlement's k.
// Reports go back with game.realms.report(id, { n, eng, state, x, y, lost, killed }).
//
// A force: its soldiers (identities from the seed: game/soldier.js), at most WAR.cap.side live creatures near the
// players (WAR.cap.total for every force together) — the others are numbers that step in as the live ones fall —, its
// phase, its morale and the general. Field battle: march in a column → deploy the lines (infantry in front, archers
// behind, the general with the standard) → advance, the archers' volleys → the clash → the morale breaks: rout and pursuit
// → the losses are reported. The siege: game/siegeAI.js.
//
// Shared state (mut/warfare.js): war.force (the public row of a force: kind, kingdom, target, phase, numbers, where),
// war.end, war.mark (structures of an army: o.realm), war.cry (a shout near the players), war.rep (reputation a player
// earned helping a side); snapshot / save `war`, digest part `war`. The soldiers are host creatures (net/entities.js).

import { WAR, CRIES, SHARE } from './content/soldiers.js';
import {
  spawnSoldier, decorateSoldier, soldierLabel, soldierBrain, separate, playerMayHurt, soldierHurt, crestOf, atWar, ownerOf, solNear,
  FIGHTING, isPlayer,
} from './soldier.js';
import { siegeTick, siegeSetup, siegeEnd, siegeThreat, siegeTowers, siegeStatus, siegeReport, siegeLoad, planWhy } from './siegeAI.js';
import { allPlayers, inAnyView } from './players.js';
import { uidOf, memberOf } from './eco.js';
import { damageStructure, isEngineObj } from './siege.js';
import { drawStandard } from '../art/faces/camp.js'; // (the general's standard)
import { liftOf } from './levels.js';

const hash = (a, b = 0) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; return h >>> 0; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
export const PHASE_PT = {
  march: 'em marcha', camp: 'acampando', build: 'construindo as máquinas', bombard: 'bombardeio', assault: 'assalto', held: 'tomou o lugar', retreat: 'recuando',
  deploy: 'formando as linhas', advance: 'avançando', clash: 'combate', rout: 'em debandada', won: 'vitória', end: 'fim',
};

// ---------- install (every peer) ----------
export function installWarfare(game) {
  const W = {
    forces: new Map(), ids: new Map(), byNid: new Map(), tagOf: new Map(), // (tag → force id)
    stats: { ms: 0, msSum: 0, maxMs: 0, frames: 0, live: 0, peak: 0, spawned: 0, dropped: 0, brains: 0, last: [], flowMs: 0 },
    materialize: (army) => materialize(game, army),
    dematerialize: (id) => dematerialize(game, id),
    startSiege: (spec) => startSiege(game, spec),
    startBattle: (a, b) => startBattle(game, a, b),
    startForce: (spec, kind, tick) => startForce(game, spec, kind, tick), // (a force with its own tick: a skirmish's garrison — game/skirmish.js)
    decorate: (e) => decorateSoldier(game, e),
    label: (e) => soldierLabel(game, e),
    mayHurt: (pl, e) => (game.creative ? 'Modo criativo' : playerMayHurt(game, pl, e)),
    forceOfEnt: (e) => (e?.soldier ? W.forces.get(e.soldier.f) || W.forces.get(W.tagOf.get(e.soldier.tag)) || null : null),
    crewEnt: (id) => crewEnt(game, id),
    onHurt: (m, src) => onHurt(game, m, src),
    onKilled: (m, killer) => onKilled(game, m, killer),
    threatOn: (sid) => threatOn(game, sid),
    towersOn: (sid) => { const F = siegeOn(game, sid); return F && F.phase !== 'retreat' ? siegeTowers(game, F) : []; }, // (the siege towers standing: where the defense waits on the wall walk)
    siegeOn: (sid) => siegeOn(game, sid),
    foeOfTown: (S, e) => !!e?.soldier && !e.dead && atWar(game, e.soldier.k, ownerOf(game, S.sid)),
    boltHits: (b, e) => boltHits(game, b, e),
    boltStruct: (b) => boltStruct(game, b),
    engineTargets: (S) => engineTargets(game, S),
    ents: () => game.entities.filter((e) => e.soldier && !e.dead),
    debug: (id) => debugForce(game, id),
    crest: (k) => crestOf(game, k),
    planWhy: () => planWhy(),
  };
  game.warfare = W;
  return W;
}

// ---------- the forces (host) ----------
// the roles of n soldiers: the general first (6+), engineers (sieges), archers, then infantry (spears and swords)
function rolesOf(n, siege, seed) {
  const out = [];
  const gen = n >= 6 ? 1 : 0, eng = siege ? clamp(Math.round(n * SHARE.eng), 2, 10) : 0;
  const arch = Math.round((n - gen - eng) * SHARE.archer);
  for (let i = 0; i < n; i++) {
    let role;
    if (i < gen) role = 'general';
    else if (i < gen + eng) role = 'eng';
    else if (i < gen + eng + arch) role = 'archer';
    else role = hash(seed, i) % 100 < SHARE.sword * 100 ? 'sword' : 'spear';
    out.push({ i, role, dead: false });
  }
  return out;
}
// the order the soldiers become creatures: the general and the engineers, then archers and infantry mixed in proportion
function spawnOrder(units) {
  const first = units.filter((u) => u.role === 'general' || u.role === 'eng'), A = units.filter((u) => u.role === 'archer'), I = units.filter((u) => u.role === 'spear' || u.role === 'sword');
  const out = first.slice(), na = A.length, ni = I.length;
  let a = 0, b = 0;
  while (a < na || b < ni) { if (b < ni && (a >= na || b / Math.max(1, ni) <= a / Math.max(1, na))) out.push(I[b++]); else out.push(A[a++]); }
  return out.map((u) => u.i);
}
function newForce(game, spec, kind) {
  const W = game.warfare, net = game.net;
  const fid = net.newId('W'), id = spec.id || fid, tag = fid.slice(1);
  const R = game.towns.realm, k = spec.k | 0;
  const n0 = Math.max(spec.min ?? 4, Math.min(600, spec.n | 0 || 30)); // (min: a skirmish's small sides — game/skirmish.js)
  const lv = Math.max(1, spec.lv | 0 || realmLevelOf(game, k));
  const units = rolesOf(n0, kind === 'siege', hash(game.world.seed | 0, hash(k, +tag || 1)));
  const [x, y] = spec.at || [game.player.x, game.player.y];
  const F = {
    id, tag, k, kind, sid: spec.sid ?? null, foe: null, phase: 'march', lv, n0, n: n0, x, y, fx: 0, fy: 1,
    units, order: spawnOrder(units), live: new Map(), dead: 0, killed: 0, morale: WAR.morale.start, rallyB: 0, rallyT: 0, genDead: false,
    t: 0, T: 0, foes: [], army: spec.army || null, eng: { treb: 0, cat: 0, ram: 0, tower: 0, ...(spec.eng || {}) }, pubT: -9, pubSig: '', rep: new Map(), name: R.kingdoms[k]?.name || '?',
    anchor: { x, y }, face: { x: 0, y: 1 }, cap: WAR.cap.side, spawnT: 0,
    // a skirmish (game/skirmish.js): keep = never ends for want of players near, kit = the gear of every soldier, hold = the
    // lines wait for the start, reach = how far it looks for the forces it fights, sk = the match
    keep: !!spec.keep, kit: spec.kit || null, hold: !!spec.hold, reach: spec.reach || 0, sk: spec.sk || null,
  };
  W.forces.set(id, F);
  W.tagOf.set(tag, id);
  return F;
}
function realmLevelOf(game, k) {
  const R = game.towns?.realm, K = R?.kingdoms[k], s = K ? R.settlements[K.capital] : null;
  return s && game.towns.npcLevel ? game.towns.npcLevel(s.id) : 1;
}
// the public row of a force (op war.force; snapshot; digest)
export function pubRow(F) { return [F.id, F.tag, F.k, F.kind, F.sid ?? -1, F.foe || 0, F.phase, F.n, F.n0, F.lv, r2(F.x), r2(F.y), r2(F.fx), r2(F.fy)]; }
function publish(game, F, force = false) {
  const sig = `${F.phase}|${F.n}|${F.foe}|${Math.round(F.x / 4)}|${Math.round(F.y / 4)}`;
  if (!force && (sig === F.pubSig || game.worldTime - F.pubT < 1)) return;
  F.pubSig = sig; F.pubT = game.worldTime;
  game.net.emit('war.force', { row: pubRow(F) });
}
export function setPhase(game, F, ph, cry = null) {
  if (F.phase === ph) return;
  F.phase = ph; F.t = 0;
  publish(game, F, true);
  if (cry) shout(game, F, cry);
  report(game, F);
}
// a shout near the players (the general, a captain): op war.cry → a toast on the peers whose player is near
export function shout(game, F, list, x = F.x, y = F.y) {
  const L = Array.isArray(list) ? list : [list], s = L[Math.floor(game.net.roll() * L.length) % L.length] || ''; // (the host picks the line: the text goes in the op)
  game.net.emit('war.cry', { id: F.id, k: F.k, text: s.replace(/\{reino\}/g, F.name), x: r2(x), y: r2(y) });
}
// the state 3a knows (game/realms.js: 'march' | 'camp' | 'siege' | 'battle' | 'retreat') for a force's phase
function report(game, F) {
  const eng = F.kind === 'siege' ? siegeReport(game, F) : engObj(F.eng);
  const st = F.army ? game.realms?.armies?.get(F.id)?.state || F.army.state : F.kind === 'battle' ? 'battle' : F.kind === 'siege' ? 'siege' : 'march';
  const r = { n: F.n, eng, state: st, x: Math.round(F.x), y: Math.round(F.y), lost: F.dead, killed: F.killed, kind: F.kind, sid: F.sid, phase: F.phase };
  if (F.kind === 'battle') r.state = 'battle'; // (3a resolves the battle itself once it takes the armies back)
  const W = game.warfare;
  (W.reports || (W.reports = new Map())).set(F.id, r); // (tests / debug: the last report of each force, and a short log)
  const RL = W.reportLog || (W.reportLog = []);
  RL.push([F.id, r]); if (RL.length > 300) RL.splice(0, 100);
  if (F.army) game.realms?.report?.(F.id, r); // (3a: only its own armies — a debug force has none)
}
// 3a's engines: [treb, cat, ram, tower] or { treb, cat, ram, tower }
const engObj = (e) => (Array.isArray(e) ? { treb: e[0] | 0, cat: e[1] | 0, ram: e[2] | 0, tower: e[3] | 0 } : { treb: e?.treb | 0, cat: e?.cat | 0, ram: e?.ram | 0, tower: e?.tower | 0 });

// ---------- the API ----------
export function startSiege(game, spec) {
  if (!game.net.auth || !game.towns?.realm) return null;
  const s = game.towns.realm.settlements[spec.sid];
  if (!s) return null;
  const F = newForce(game, { ...spec, k: spec.k ?? s.k }, 'siege');
  siegeSetup(game, F, spec);
  publish(game, F, true);
  return F;
}
// a force with its own tick (kind: its name, tick(game, F) every 0.5 s after its foes are listed) — a skirmish's garrison
export function startForce(game, spec, kind, tick) {
  if (!game.net.auth || !game.towns?.realm) return null;
  const F = newForce(game, spec, kind);
  F.kindTick = tick;
  publish(game, F, true);
  return F;
}
export function startBattle(game, a, b) {
  if (!game.net.auth || !game.towns?.realm) return null;
  const p = game.player;
  const A = a.at || (a.x != null ? [a.x, a.y] : [p.x - 20, p.y]), B = b.at || (b.x != null ? [b.x, b.y] : [p.x + 20, p.y]);
  const FA = newForce(game, { ...a, id: a.id, at: A, army: a.k != null && a.home != null ? a : null }, 'battle');
  const FB = newForce(game, { ...b, id: b.id, at: B, army: b.k != null && b.home != null ? b : null }, 'battle');
  FA.foe = FB.id; FB.foe = FA.id;
  // the field: the middle between them, each side deploys gap/2 from it, facing the other
  const cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2, dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  const bt = { cx, cy, ux, uy, t: 0, end: 0, winner: null };
  for (const [F, s] of [[FA, -1], [FB, 1]]) {
    F.bt = bt; F.face = { x: -s * ux, y: -s * uy }; F.fx = F.face.x; F.fy = F.face.y;
    F.deploy = { x: cx + s * ux * WAR.battle.gap / 2, y: cy + s * uy * WAR.battle.gap / 2 };
    const far = Math.hypot(F.anchor.x - F.deploy.x, F.anchor.y - F.deploy.y);
    if (far < 6) { F.anchor = { ...F.deploy }; F.phase = 'deploy'; }
    publish(game, F, true);
  }
  shout(game, FA, `Batalha! O Reino de ${FA.name} enfrenta o Reino de ${FB.name}`, cx, cy);
  return [FA, FB];
}
// 3a hands an army over (near a player — game/realms.js liveCheck): a siege where it besieges (what it has already built
// by numbers stands at once: the camp, the engines), a battle when it meets the other army of its battle, else a column on
// its road (marching / going home) or a camp (gathering)
export function materialize(game, army) {
  if (!game.net.auth || !army || game.warfare.forces.has(army.id)) return game.warfare.forces.get(army?.id) || null;
  const eng = engObj(army.eng), spec = { id: army.id, k: army.k, n: army.n, lv: army.lv, at: [army.x, army.y], sid: army.target >= 0 ? army.target : null, army };
  if (army.state === 'siege' && army.target >= 0) {
    // (its engines by numbers: the trebuchets it has are the ones it wants; a ram and a tower as always)
    return startSiege(game, { ...spec, eng: { treb: Math.max(1, eng.treb), ram: 1, tower: 1 }, have: eng, ph: army.phase || 'camp', hrs: army.hrs || 0 });
  }
  if (army.state === 'battle') {
    // the other army of the battle (army.foe): 3a materializes both — the first one waits for the second
    for (const F of game.warfare.forces.values()) {
      if (F.kind !== 'pending' || (army.foe ? F.id !== army.foe : Math.hypot(F.x - army.x, F.y - army.y) > 160 || !atWar(game, F.k, army.k))) continue;
      game.warfare.forces.delete(F.id);
      return startBattle(game, F.spec, spec);
    }
    const F = { id: army.id, kind: 'pending', spec, x: army.x, y: army.y, k: army.k, phase: 'march', live: null, units: null, n: army.n, foes: [], army };
    game.warfare.forces.set(army.id, F);
    return F;
  }
  if (army.state === 'home') return null;
  // a column on its road (3a's route: the points still ahead of it), or standing (a camp gathering the campaign)
  const F = newForce(game, spec, 'march');
  F.path = army.state === 'march' || army.state === 'retreat' ? routeAhead(game, army) : [];
  const last = F.path[F.path.length - 1];
  F.goal = last ? { ...last } : { x: army.x, y: army.y };
  publish(game, F, true);
  return F;
}
// the points of an army's route ahead of where 3a froze it (game.realms.routeOf: pts / cum), the next ~200 tiles
function routeAhead(game, a, far = 200) {
  if (Array.isArray(a.path)) return a.path.filter((q) => Array.isArray(q) && q.length >= 2).map(([x, y]) => ({ x, y }));
  if (!a.path || !Array.isArray(a.path.r)) return [];
  const g = game.realms?.routeOf?.(a);
  if (!g?.pts || !g.cum) return [];
  const w = game.world, d0 = Number.isFinite(a.d0) ? a.d0 : 0, out = [];
  for (let k = 0; k + 1 < g.cum.length; k++) {
    if (g.cum[k + 1] <= d0) continue;
    if (g.cum[k] > d0 + far) break;
    const x = g.pts[(k + 1) * 2], y = g.pts[(k + 1) * 2 + 1];
    out.push({ x: w.near ? w.near(x, a.x) : x, y });
  }
  return out;
}
// 3a takes it back (nobody near): the soldiers become numbers again, the camp and the engines are struck, the numbers go on
// from what was played here
const PHASE3A = { march: 'camp', camp: 'camp', build: 'build', bombard: 'bombard', assault: 'assault', held: 'assault', retreat: 'bombard' };
export function dematerialize(game, id) {
  const W = game.warfare, F = W.forces.get(id);
  if (!F) return null;
  if (F.kind === 'pending') { W.forces.delete(id); return { n: F.n }; }
  const out = { n: F.n, eng: F.kind === 'siege' ? siegeReport(game, F) : engObj(F.eng), lost: F.dead, killed: F.killed, state: F.army ? game.realms?.armies?.get(F.id)?.state || F.army.state : F.kind, x: Math.round(F.x), y: Math.round(F.y) };
  if (F.kind === 'siege') out.siege = { ...siegeStatus(game, F), phase: PHASE3A[F.phase] || 'bombard', hrs: (F.sg?.hrs0 || 0) + Math.floor(F.T / Math.max(1, (game.env?.dayLength || 780) / 24)), live: F.phase };
  endForce(game, F, true);
  return out;
}
// a force of 3a whose fight here is over (the battle won / lost, the place taken, the siege given up): its soldiers leave,
// the camp is struck, and 3a takes the numbers back AT ONCE (game.realms.settle — phase 3c: the army goes home, holds the
// place, marches on, whoever stays near; 3a hands it to 3b again in its new shape)
export function finishForce(game, F, outcome = null) {
  if (!F.army) { endForce(game, F); return; }
  if (F.kind === 'siege') siegeEnd(game, F);
  for (const m of [...(F.live?.values() || [])]) dropSoldier(game, F, m);
  F.done = true;
  if (F.phase !== 'end') { F.phase = 'end'; publish(game, F, true); }
  const out = outcome || (F.kind === 'siege' ? (F.sg?.captured ? 'taken' : 'lifted') : 'lost');
  try { game.realms?.settle?.(F.id, { n: F.n, outcome: out, x: Math.round(F.x), y: Math.round(F.y) }); } catch (e) { console.error(e); }
}
function endForce(game, F, quiet = false) {
  const W = game.warfare;
  if (F.kind === 'siege') siegeEnd(game, F);
  for (const m of [...(F.live?.values() || [])]) dropSoldier(game, F, m);
  if (F.tag) W.tagOf.delete(F.tag);
  W.forces.delete(F.id);
  if (F.kind !== 'pending') game.net.emit('war.end', { id: F.id, quiet: quiet ? 1 : 0 });
  if (!quiet) report(game, { ...F, phase: 'end' });
}

// ---------- soldiers in and out (host) ----------
function dropSoldier(game, F, m) {
  const E = game.entities, i = E.indexOf(m);
  if (i >= 0) E.splice(i, 1); // sync-ok: host-only creature list (the soldier is a number again)
  F.live.delete(m.soldier.i);
  game.warfare.byNid.delete(m.nid);
  if (game.player.target === m) { game.player.target = null; game.events.emit('target', { target: null }); }
  game.warfare.stats.dropped++;
}
function crewEnt(game, id) {
  if (typeof id !== 'string' || id[0] !== '~') return null;
  const nid = id.slice(1);
  return game.net.auth ? game.warfare.byNid.get(nid) || null : game.net.entsApi?.byNid?.(nid) || null;
}
const aliveIn = (F) => { let n = 0; if (F.live) for (const m of F.live.values()) if (!m.dead) n++; return n; };
const liveTotal = (game) => { let n = 0; for (const F of game.warfare.forces.values()) n += aliveIn(F); return n; }; // (the bodies on the ground do not count: they do not think)
// where a new soldier appears: its spot when nobody sees it, else behind its lines (out of sight if it can)
function spawnSpot(game, F, u, want) {
  if (want && !inAnyView(game, want[0], want[1], 2, 3)) { const q = solNear(game, want[0], want[1], 3); if (q) return q; }
  const back = F.rear ? F.rear(u) : [F.anchor.x - F.face.x * 10, F.anchor.y - F.face.y * 10];
  for (let k = 0; k < 6; k++) {
    const x = back[0] - F.face.x * k * 3, y = back[1] - F.face.y * k * 3;
    if (!inAnyView(game, x, y, 2, 3) || k === 5) { const q = solNear(game, x + ((u.i % 5) - 2) * 0.9, y + (((u.i / 5) | 0) % 3) * 0.9, 3); if (q) return q; }
  }
  return null;
}
function fillRanks(game, F) {
  const W = game.warfare, low = game.quality === 'low' ? WAR.cap.low : 1;
  const nForces = [...W.forces.values()].filter((q) => q.live && q.kind !== 'pending' && q.phase !== 'end').length || 1;
  F.cap = Math.max(4, Math.floor(Math.min((F.kind === 'siege' ? WAR.cap.siege : WAR.cap.side) * low, (WAR.cap.total * low) / nForces))); // (a weak device: × low, once)
  if (F.phase === 'rout' || F.phase === 'retreat' || F.phase === 'end' || F.phase === 'held' && F.t > 10) return;
  let made = 0, total = liveTotal(game), alive = aliveIn(F);
  // (owner: "todos deveriam aparecer de uma vez" — a force that has nobody out yet comes out whole, at once; then the
  //  reserves step in as soldiers fall, a few a tick)
  const per = alive === 0 ? F.cap : WAR.spawnPerTick;
  for (const i of F.order) {
    if (alive >= F.cap || total >= WAR.cap.total * low || made >= per) break;
    const u = F.units[i];
    if (u.dead || F.live.has(i)) continue;
    const at = spawnSpot(game, F, u, F.slotOf ? F.slotOf(u) : null);
    if (!at) continue;
    const m = spawnSoldier(game, F, u, at[0], at[1]);
    if (!m) continue;
    F.live.set(i, m); W.byNid.set(m.nid, m);
    made++; total++; alive++; W.stats.spawned++;
    F.onSpawn?.(game, F, m);
  }
}

// ---------- hurt, killed (host) ----------
function onHurt(game, m, src) {
  soldierHurt(game, m, src);
  if (isPlayer(game, src)) repHit(game, m, src, false);
}
function onKilled(game, m, killer) {
  // (combat.js killMob → m.onDeath: only for a player's killing blow)
  const F = game.warfare.forceOfEnt(m), src = killer?.owner || killer || m.pfoe?.e || null;
  if (F && src) repHit(game, m, src, true);
}
// reputation for helping the side the soldier fights (docs/REINOS.md §14 "Jogadores"): with the kingdom it attacks (+) and
// with its own (−), gathered per player and sent at most every WAR.rep.every seconds (no spam)
function repHit(game, m, pl, killed) {
  const F = game.warfare.forceOfEnt(m);
  if (!F) return;
  const pid = pl === game.player ? game.net.pid : pl.pid, uid = uidOf(game, pid);
  if (!uid) return;
  const foeK = sideAgainst(game, F);
  const RP = WAR.rep;
  let B = F.rep.get(uid);
  if (!B) F.rep.set(uid, (B = { pid, hits: 0, d: 0, sent: 0, kills: 0, t: game.worldTime }));
  B.pid = pid;
  if (killed) { const role = m.soldier.role; B.d += role === 'general' ? RP.general : role === 'eng' ? RP.engineer : RP.kill; B.kills++; }
  else if (++B.hits % RP.hits === 0) B.d += RP.hit;
  B.foeK = foeK;
  flushRep(game, F, false);
}
// the kingdom a player helps by fighting force F: the owner of the place it besieges; in a battle, the other army's
function sideAgainst(game, F) {
  if (F.kind === 'siege' && F.sid != null) return ownerOf(game, F.sid);
  if (F.kind === 'battle' && F.foe) return game.warfare.forces.get(F.foe)?.k ?? -1;
  return -1;
}
function flushRep(game, F, all) {
  const RP = WAR.rep, now = game.worldTime;
  for (const [uid, B] of F.rep) {
    if (!B.d || (!all && now - B.t < RP.every)) continue;
    const room = Math.max(0, RP.cap - B.sent), d = Math.min(B.d, room);
    B.d = 0; B.t = now;
    if (!d) continue;
    B.sent += d;
    const R = game.towns.realm, place = F.kind === 'siege' && F.sid != null ? R.settlements[F.sid]?.name : null;
    const gk = B.foeK, gn = gk >= 0 ? R.kingdoms[gk]?.name : null;
    const mk = memberOf(game, uid);
    const toast = gn ? `+${d} reputação com o Reino de ${gn} — ${place ? 'defendendo ' + place : 'na batalha contra ' + F.name}${mk !== F.k ? ` · −${d} com ${F.name}` : ''}` : `Você lutou contra o exército de ${F.name}`;
    if (game.realms?.reward) {
      // (3a's reputation op: the side helped, with its notice; the attackers' kingdom quietly)
      if (gk >= 0) game.realms.reward(B.pid, gk, d, place ? `defendendo ${place}` : `na batalha contra o Reino de ${F.name}`);
      if (mk !== F.k) game.realms.reward(B.pid, F.k, -d, '');
    } else game.net.emit('war.rep', { u: uid, k: gk, d: gk >= 0 ? d : 0, k2: F.k, d2: mk === F.k ? 0 : -d, by: B.pid, toast });
  }
}
export function repelled(game, F) {
  // the attackers gave up: whoever fought them gets the bonus of having defended the place
  for (const B of F.rep.values()) if (B.kills || B.hits >= 3) B.d += WAR.rep.repelled;
  flushRep(game, F, true);
  game.army?.onOutcome?.('repelled', F); // (the defenders' enlisted players near the place: the bonus — game/army.js)
}

// ---------- the defense hooks (people.js / towns.js) ----------
function siegeOn(game, sid) {
  for (const F of game.warfare.forces.values()) if (F.kind === 'siege' && F.sid === sid && FIGHTING.has(F.phase) && F.phase !== 'held') return F;
  return null;
}
function threatOn(game, sid) { const F = siegeOn(game, sid); return F && F.phase !== 'retreat' ? siegeThreat(game, F) : null; }
// a ballista bolt (ballista.js): a town crew's hits the soldiers at war with the town; a player's, the ones the rule lets
function boltHits(game, b, e) {
  if (b.by === 'npc') { const o = game.world.objById.get(b.oid); const k = o?.town != null ? ownerOf(game, o.town) : o?.realm ?? null; return k != null && atWar(game, k, e.soldier.k); }
  const pl = (() => { for (const q of allPlayers(game)) if ((q === game.player ? game.net.pid : q.pid) === b.by) return q; return null; })();
  return !!pl && !playerMayHurt(game, pl, e);
}

// a town crew's ballista on the engines of an army besieging it (npc.js crewTask): { x, y, dead, o } of each
function engineTargets(game, S) {
  const F = siegeOn(game, S.sid);
  if (!F || !F.sg?.jobs) return [];
  const out = [];
  for (const j of F.sg.jobs) { const o = j.id ? game.world.objById.get(j.id) : null; if (isEngineObj(o) && !o.blueprint && j.role !== 'ws') out.push({ x: o.tx + o.fw / 2, y: o.ty + o.fh / 2, dead: false, o, z: 0 }); }
  return out;
}
// a bolt stuck in a structure of an army at war with the crew's town: siege damage (an engine, a tent)
const BOLT_SDMG = 240;
function boltStruct(game, b) {
  if (b.by !== 'npc') return;
  const w = game.world, x = b.x + b.ux * 0.5, y = b.y + b.uy * 0.5, tx = Math.floor(x), ty = Math.floor(y);
  if (!w.inBounds(tx, ty)) return;
  const o = game.build.grid.main.get(w.idx(tx, ty));
  if (!o || o.realm == null || o.removed || o.blueprint) return;
  const crew = game.world.objById.get(b.oid), k = crew?.town != null ? ownerOf(game, crew.town) : crew?.realm ?? null;
  if (k == null || !atWar(game, k, o.realm)) return;
  damageStructure(game, o, BOLT_SDMG, b.x, b.y);
}

// ---------- the host system ----------
export function warfareSystem() {
  let tickT = 0, frame = 0;
  return {
    sync: 'host', // the soldiers are host creatures (guests: proxies); the shared state goes in ops
    update(game, dt) {
      const W = game.warfare;
      if (W?.saved && game.towns?.realm) restoreSaved(game);
      if (!W || !W.forces.size) { if (W) W.stats.live = 0; return; }
      const t0 = performance.now();
      frame++;
      tickT -= dt;
      const players = allPlayers(game).filter((q) => !q.dead);
      if (tickT <= 0) {
        tickT = WAR.tick;
        for (const F of [...W.forces.values()]) {
          if (F.kind === 'pending' || !F.units || F.done || W.forces.get(F.id) !== F) continue; // (one ended by another's tick meanwhile: a battle ends both)
          F.t += WAR.tick; F.T += WAR.tick;
          forceTick(game, F, players);
        }
      }
      let n = 0;
      for (const F of W.forces.values()) {
        if (!F.live || !F.units) continue;
        const list = F._list || (F._list = []);
        list.length = 0;
        for (const m of F.live.values()) {
          if (m.dead) { if (!m._goneAt) { m._goneAt = game.worldTime; death(game, F, m); } else if (game.worldTime - m._goneAt > 24 || (game.worldTime - m._goneAt > 8 && !inAnyView(game, m.x, m.y, 2, 3))) dropSoldier(game, F, m); continue; }
          if (m._gone) { dropSoldier(game, F, m); continue; }
          let d = 1e9;
          for (const q of players) { const dd = Math.abs(game.world.dx(q.x, m.x)) + Math.abs(q.y - m.y); if (dd < d) d = dd; }
          m._pd = d;
          m._acc += dt;
          list.push(m);
          if (d > WAR.nearR && (frame + m.id) % WAR.farK && m.state !== 'chase') continue;
          soldierBrain(game, F, m, m._acc);
          m._acc = 0;
          n++;
        }
        if (frame & 1) separate(game, list);
        if (F.ff) { const f0 = performance.now(); F.ff.tick(0.8); W.stats.flowMs += performance.now() - f0; }
      }
      const ms = performance.now() - t0, S = W.stats;
      S.frames++; S.msSum += ms; S.maxMs = Math.max(S.maxMs, ms); S.brains = n; S.ms = ms;
      S.live = liveTotal(game); S.peak = Math.max(S.peak, S.live);
      S.last.push(ms); if (S.last.length > 600) S.last.shift();
    },
  };
}
// every peer: the general's standard (a drawable beside the general, raised while it rallies — the 'cast' pose)
export function warfareFxSystem() {
  const pool = [], seen = new Set();
  let wired = false, cryT = -9, cryLast = '', lookT = 0;
  return {
    sync: 'cosmetic',
    update(game, dt) {
      // a force comes into view of the local player for the first time: what it is and what the player may do
      lookT -= dt;
      if (lookT <= 0 && game.warfare?.forces.size && game.towns?.realm) {
        lookT = 1;
        const p = game.player;
        for (const F of game.warfare.forces.values()) {
          if (!F.pub || seen.has(F.id) || p.dead || game.skirmish?.on || Math.hypot(game.world.dx(F.x, p.x), F.y - p.y) > 75) continue; // (a skirmish tells its own story: ui/skirmish.js)
          seen.add(F.id);
          game.events.emit('toast', { text: announce(game, F), kind: 'info' });
        }
      }
      if (!wired) {
        wired = true;
        // a shout of an army (op war.cry): a toast for the local player when it is near (the same line not twice in a row)
        game.events.on('warcry', ({ text, x, y }) => {
          const p = game.player;
          if (p.dead || !(Math.hypot(game.world.dx ? game.world.dx(x, p.x) : x - p.x, y - p.y) < 60)) return;
          if (game.time - cryT < 2.5 && cryLast === text) return;
          cryT = game.time; cryLast = text;
          game.events.emit('toast', { text, kind: 'warn' });
        });
      }
      for (const e of game.entities) {
        if (!e.soldier || e.soldier.role !== 'general') continue;
        const want = !e.dead && e.action?.type === 'cast' ? 1 : 0;
        e._rallyK = (e._rallyK || 0) + Math.max(-dt * 1.5, Math.min(dt * 3, want - (e._rallyK || 0)));
        e._rallyT = e._rallyK > 0 ? 1 : null;
      }
    },
    collect(game, list, v) {
      let n = 0;
      for (const e of game.entities) {
        if (!e.soldier || e.soldier.role !== 'general' || e.dead) continue;
        if (e.x < v.x0 - 2 || e.x > v.x1 + 2 || e.y < v.y0 - 2 || e.y > v.y1 + 4) continue;
        const d = pool[n] || (pool[n] = { x: 0, y: 0, e: null, draw(B, A, t) { drawStandard(B, A, this.e, this.e.crest, t, liftOf(this.e)); } });
        n++;
        d.e = e; d.x = e.x; d.y = e.y + (e.facing === 'n' ? 0.05 : -0.05);
        list.push(d);
      }
    },
  };
}
// "Cerco de Estrosa: o exército do Reino de Rabel (34 soldados) — acampando. Defenda o lugar: …"
function announce(game, F) {
  const R = game.towns.realm, K = R.kingdoms[F.k], kn = K ? K.name : '?', me = memberOf(game, uidOf(game, game.net.pid));
  const phase = PHASE_PT[F.phase] || F.phase, n = F.n | 0;
  if (F.kind === 'siege' && F.sid != null) {
    const s = R.settlements[F.sid], ok = ownerOf(game, F.sid), on = R.kingdoms[ok]?.name || '?';
    const hint = me === F.k ? 'É o exército do seu reino.' : me === ok ? `Defenda ${s.name}: lutar com os soldados dá reputação com o Reino de ${on}.` : `Quem lutar com os soldados ajuda a defender ${s.name} (reputação com o Reino de ${on}).`;
    return `Cerco de ${s.name}: o exército do Reino de ${kn} (${n} soldados) — ${phase}. ${hint}`;
  }
  if (F.kind === 'battle' && F.foe) {
    const O = game.warfare.forces.get(F.foe), on = R.kingdoms[O?.k]?.name || '?';
    return `Batalha: o Reino de ${kn} contra o Reino de ${on}. Lutar por um dos lados dá reputação com ele.`;
  }
  return `Um exército do Reino de ${kn} marcha por aqui (${n} soldados). Em paz com você: não ataca quem não o ataca.`;
}
// a save taken up again (host): its debug sieges start over from their place (the camp and engines still standing are
// adopted); the armies of 3a are 3a's to hand back
function restoreSaved(game) {
  const W = game.warfare, rows = W.saved;
  W.saved = null;
  for (const r of rows || []) {
    const sg = r[14];
    if (r[3] !== 'siege' || !Array.isArray(sg) || W.forces.has(r[0])) continue;
    const F = startSiege(game, { id: r[0], k: r[2], sid: sg[0], n: r[8], lv: r[9], at: [sg[1], sg[2]], eng: r[15] && typeof r[15] === 'object' ? r[15] : null });
    if (!F) continue;
    let lost = Math.max(0, r[8] - r[7]);
    for (let i = F.units.length - 1; i >= 0 && lost > 0; i--) if (F.units[i].role !== 'general' && F.units[i].role !== 'eng') { F.units[i].dead = true; F.dead++; F.n--; lost--; }
    publish(game, F, true);
  }
}
function death(game, F, m) {
  const u = F.units[m.soldier.i];
  if (u && !u.dead) { u.dead = true; F.dead++; F.n = Math.max(0, F.n - 1); }
  if (m.soldier.role === 'general' && !F.genDead) { F.genDead = true; shout(game, F, `O general do Reino de ${F.name} caiu!`, m.x, m.y); }
  m.order = null; m.job = null;
  if (F.kind === 'battle' && F.foe) { const O = game.warfare.forces.get(F.foe); if (O) O.killed++; }
  publish(game, F);
}

// one force, every WAR.tick (0.5 s): its foes, its ranks, its phase, its morale
function forceTick(game, F, players) {
  const W = game.warfare;
  // nobody near any more (3a takes it back as numbers): a debug force simply ends
  let pd = 1e9;
  for (const q of players) pd = Math.min(pd, Math.hypot(game.world.dx(q.x, F.x), q.y - F.y));
  if (F.done) return; // (its fight is over: 3a takes it back — dematerialize)
  if (pd > WAR.dropR && !F.keep) { if (!F.army) endForce(game, F); return; } // (an army of 3a: 3a hands it back to the numbers when nobody is near; a skirmish's: kept)
  // the foes it may fight (a short list scanned by each soldier now and then: no scan of every creature per soldier)
  F.foes.length = 0;
  if (F.kind === 'battle' && F.foe) { const O = W.forces.get(F.foe); if (O) for (const m of O.live.values()) if (!m.dead) F.foes.push(m); }
  if (F.kind === 'siege' && F.sid != null) { const rec = game.people?.live?.get(F.sid); if (rec) for (const m of rec.ents.values()) if (!m.dead && m.npc.guard) F.foes.push(m); }
  for (const O of W.forces.values()) if (O !== F && O.live && O.id !== F.foe && atWar(game, O.k, F.k) && Math.hypot(O.x - F.x, O.y - F.y) < Math.max(90, F.reach, O.reach || 0)) for (const m of O.live.values()) if (!m.dead) F.foes.push(m); // (another army at war nearby: a relief force; a skirmish's garrison)
  if (game.army?.en?.size || game.skirmish?.on) for (const q of players) if (Math.hypot(game.world.dx(q.x, F.x), q.y - F.y) < Math.max(70, F.reach) && game.army.soldierFoe(F.k, q)) F.foes.push(q); // (an enlisted player of a kingdom at war with it — game/army.js; a skirmish's side)
  morale(game, F);
  if (F.kind === 'siege') siegeTick(game, F);
  else if (F.kind === 'battle') battleTick(game, F);
  else if (F.kind === 'march') marchTick(game, F);
  else if (F.kindTick) F.kindTick(game, F); // (startForce: a skirmish's garrison)
  if (W.forces.get(F.id) !== F) return; // (it ended in its own tick: nothing more to publish)
  fillRanks(game, F);
  flushRep(game, F, false);
  // where the force is (its living soldiers' middle) — the public row follows
  let sx = 0, sy = 0, c = 0;
  for (const m of F.live.values()) if (!m.dead) { sx += m.x; sy += m.y; c++; }
  if (c) { F.x = sx / c; F.y = sy / c; }
  publish(game, F);
  if (F.T - (F.repT || 0) > 6) { F.repT = F.T; report(game, F); }
}

// ---------- morale and the general ----------
function morale(game, F) {
  const M = WAR.morale, loss = (F.dead / Math.max(1, F.n0)) * 100;
  let out = 0;
  if (F.kind === 'battle' && F.foe) { const O = game.warfare.forces.get(F.foe); if (O && O.n > 0 && F.n < O.n * 0.6) out = M.outnumbered; }
  // the general rallies the line now and then while it wavers (a shout, the standard raised)
  const gen = [...F.live.values()].find((m) => m.soldier.role === 'general' && !m.dead);
  F.rallyT -= WAR.tick;
  const base = M.start - loss * M.perLoss - (F.genDead ? M.general : 0) - out;
  if (gen && F.rallyT <= 0 && base + F.rallyB < 88 && FIGHTING.has(F.phase) && F.phase !== 'rout' && F.phase !== 'retreat') {
    F.rallyT = M.rallyEvery; F.rallyB = Math.min(32, F.rallyB + M.rally);
    gen.action = { type: 'cast', t: 0, dur: 1.2 }; gen._rallyT = game.worldTime;
    shout(game, F, CRIES.rally, gen.x, gen.y);
  }
  F.morale = clamp(base + F.rallyB, 0, 100);
}

// ---------- the field battle ----------
// the slot of each living soldier in its lines: infantry in front (W wide), the archers behind, the general between
function formation(game, F, column = false) {
  const inf = [], arch = [], gen = [];
  for (const m of F.live.values()) { if (m.dead) continue; const r = m.soldier.role; if (r === 'archer') arch.push(m); else if (r === 'general') gen.push(m); else inf.push(m); }
  inf.sort((a, b) => a.soldier.i - b.soldier.i); arch.sort((a, b) => a.soldier.i - b.soldier.i);
  const B = WAR.battle, fx = F.face.x, fy = F.face.y, rx = -fy, ry = fx, ax = F.anchor.x, ay = F.anchor.y;
  const Wi = column ? 3 : clamp(Math.ceil(inf.length / 2), 5, 16), Wa = column ? 3 : clamp(Math.ceil(arch.length / 2), 4, 14);
  const rowsI = Math.ceil(inf.length / Wi);
  const put = (m, c, r, W, back) => { const x = ax + rx * (c - (W - 1) / 2) * B.lineW - fx * (back + r * B.rowD), y = ay + ry * (c - (W - 1) / 2) * B.lineW - fy * (back + r * B.rowD); m._slot = [x, y]; };
  inf.forEach((m, j) => put(m, j % Wi, Math.floor(j / Wi), Wi, 0));
  const ab = rowsI * B.rowD + 2.2;
  arch.forEach((m, j) => put(m, j % Wa, Math.floor(j / Wa), Wa, ab));
  gen.forEach((m) => put(m, 0, 0, 1, Math.max(1.6, ab - 1.4)));
  F.depth = ab + Math.ceil(arch.length / Wa) * B.rowD + 2;
  F.rear = () => [ax - fx * (F.depth + 6), ay - fy * (F.depth + 6)];
  F.slotOf = (u) => [ax - fx * (F.depth + 2) + rx * ((u.i % 7) - 3), ay - fy * (F.depth + 2) + ry * ((u.i % 7) - 3)];
}
function battleTick(game, F) {
  const W = game.warfare, O = W.forces.get(F.foe), B = WAR.battle, bt = F.bt, sp = WAR.speed;
  if (!O) { if (F.phase !== 'won' && F.phase !== 'rout') setPhase(game, F, 'won'); }
  // the enemy's direction (it moves)
  if (O && F.phase !== 'rout') { const dx = O.anchor.x - F.anchor.x, dy = O.anchor.y - F.anchor.y, d = Math.hypot(dx, dy) || 1; if (d > 4) F.face = { x: dx / d, y: dy / d }; F.fx = F.face.x; F.fy = F.face.y; }
  const moveAnchor = (tx, ty, v) => { const dx = tx - F.anchor.x, dy = ty - F.anchor.y, d = Math.hypot(dx, dy); if (d < 0.3) return true; const s = Math.min(d, v * WAR.tick); F.anchor.x += (dx / d) * s; F.anchor.y += (dy / d) * s; return false; };
  // the line keeps up with its slowest: the anchor waits while the soldiers are far behind their slots
  const lag = () => { let far = 0, c = 0; for (const m of F.live.values()) { if (m.dead || !m._slot || m.state === 'chase') continue; c++; if (Math.hypot(m._slot[0] - m.x, m._slot[1] - m.y) > 3) far++; } return c ? far / c : 0; };
  switch (F.phase) {
    case 'march': {
      formation(game, F, true);
      if (lag() < 0.4 && moveAnchor(F.deploy.x, F.deploy.y, sp.march)) setPhase(game, F, 'deploy');
      orders(game, F, 'slot', { eng: 4 });
      break;
    }
    case 'deploy': {
      formation(game, F);
      orders(game, F, 'slot', { eng: 4 });
      const ready = lag() < 0.2 || F.t > 12;
      F.ready = ready;
      if (ready && !F.hold && (!O || O.ready || O.phase === 'advance' || O.phase === 'clash') && F.t > 3) setPhase(game, F, 'advance', CRIES.charge); // (hold: a skirmish's countdown)
      break;
    }
    case 'advance': {
      formation(game, F);
      const d = O ? Math.hypot(O.anchor.x - F.anchor.x, O.anchor.y - F.anchor.y) : 99;
      if (d > B.charge * 2 && lag() < 0.35) moveAnchor(bt.cx, bt.cy, sp.walk * 0.62);
      orders(game, F, 'slot', { eng: 4, archerEng: WAR.archer.range });
      if (d < B.charge * 2 + 1 || (O && O.phase === 'clash')) setPhase(game, F, 'clash', CRIES.charge);
      break;
    }
    case 'clash': {
      formation(game, F);
      for (const m of F.live.values()) {
        if (m.dead) continue;
        const r = m.soldier.role;
        if (r === 'archer' || r === 'general') { m.order = { k: 'slot', x: m._slot[0], y: m._slot[1], fx: F.face.x, fy: F.face.y, eng: r === 'archer' ? WAR.archer.range : 3 }; continue; }
        // infantry: the nearest foe anywhere; none left near — toward the other line
        m.order = { k: 'hunt', eng: 30, x: O ? O.anchor.x : F.anchor.x, y: O ? O.anchor.y : F.anchor.y };
      }
      break;
    }
    case 'won': {
      formation(game, F);
      // a short pursuit, then the lines stand; the battle ends after a while
      for (const m of F.live.values()) { if (m.dead) continue; m.order = F.t < 6 && m.soldier.role !== 'general' && m.soldier.role !== 'archer' ? { k: 'hunt', eng: 18 } : { k: 'slot', x: m._slot[0], y: m._slot[1], fx: F.face.x, fy: F.face.y, eng: 5 }; }
      if (F.t > B.endT) { bt.end = 1; endBattle(game, F); }
      break;
    }
    case 'rout': {
      const bx = F.anchor.x - F.face.x * 70, by = F.anchor.y - F.face.y * 70;
      for (const m of F.live.values()) if (!m.dead && m.order?.k !== 'flee') m.order = { k: 'flee', x: bx + ((m.soldier.i % 9) - 4) * 2, y: by + (((m.soldier.i / 9) | 0) % 4) * 2, fx: F.face.x, fy: F.face.y };
      if (F.t > B.endT + 6 || !F.live.size) endBattle(game, F);
      break;
    }
  }
  // morale broken: the line breaks and runs
  if (F.phase !== 'rout' && F.phase !== 'won' && F.phase !== 'march' && (F.morale < WAR.morale.rout || F.n <= 0)) {
    setPhase(game, F, 'rout', CRIES.rout);
    if (O && O.phase !== 'rout') setPhase(game, O, 'won');
    bt.winner = O?.id || null;
  }
  if (F.T > B.maxT && F.phase !== 'rout' && F.phase !== 'won') { setPhase(game, F, 'rout', CRIES.rout); if (O && O.phase !== 'won' && O.phase !== 'rout') setPhase(game, O, 'won'); }
}
// every living soldier to its slot (archers with their range)
function orders(game, F, k, { eng = 4, archerEng = WAR.archer.range * 0.8 } = {}) {
  for (const m of F.live.values()) {
    if (m.dead || !m._slot) continue;
    const r = m.soldier.role;
    const O = m.order && m.order.k === k ? m.order : (m.order = { k });
    O.k = k; O.x = m._slot[0]; O.y = m._slot[1]; O.fx = F.face.x; O.fy = F.face.y; O.eng = r === 'archer' ? archerEng : eng; O.run = false; O.leash = r === 'archer' ? 0 : 9;
  }
}
function endBattle(game, F) {
  const W = game.warfare, O = W.forces.get(F.foe);
  for (const G of [F, O]) {
    if (!G || !W.forces.has(G.id)) continue;
    const st = G.phase === 'rout' ? 'retreat' : 'won';
    if (G.phase !== 'end') { G.phase = 'end'; publish(game, G, true); }
    flushRep(game, G, true);
    // the survivors leave the field: the losers already ran; the winners stand down (gone when nobody sees them)
    report(game, { ...G, phase: st });
    if (st === 'won') game.army?.onOutcome?.('won', G); // (the winners' enlisted players near the field: the bonus — game/army.js)
    if (G.army) { G.n = Math.max(0, G.n); finishForce(game, G, st === 'won' ? 'won' : 'lost'); } else endForce(game, G, true);
  }
}

// ---------- a column on the march ----------
function marchTick(game, F) {
  // marching WITH an enlisted player (phase 3c: 3a's clock runs — game/realms.js maintain): the column follows the army's
  // place on its road, at most its own pace
  const A = F.army ? game.realms?.armies?.get(F.id) : null;
  if (A && A.live && A.v > 0 && (A.state === 'march' || A.state === 'retreat')) {
    game.realms.posOf(A);
    const dx = game.world.dx(A.x, F.anchor.x), dy = A.y - F.anchor.y, d = Math.hypot(dx, dy);
    if (d > 0.5) { F.face = { x: dx / d, y: dy / d }; F.fx = F.face.x; F.fy = F.face.y; }
    formation(game, F, true);
    let far = 0, c = 0;
    for (const m of F.live.values()) { if (m.dead || !m._slot) continue; c++; if (Math.hypot(m._slot[0] - m.x, m._slot[1] - m.y) > 3) far++; }
    if (d > 0.4 && (!c || far / c < 0.4 || d > 14)) { const s = Math.min(d, WAR.speed.march * WAR.tick * (d > 14 ? 1.6 : 1)); F.anchor.x += F.face.x * s; F.anchor.y += F.face.y * s; }
    orders(game, F, 'slot', { eng: 0, archerEng: 0 });
    return;
  }
  const goal = F.path?.length ? F.path[0] : F.goal;
  if (!goal) return;
  const dx = goal.x - F.anchor.x, dy = goal.y - F.anchor.y, d = Math.hypot(dx, dy);
  if (d < 2) { if (F.path?.length) F.path.shift(); return; }
  F.face = { x: dx / d, y: dy / d }; F.fx = F.face.x; F.fy = F.face.y;
  formation(game, F, true);
  let far = 0, c = 0;
  for (const m of F.live.values()) { if (m.dead || !m._slot) continue; c++; if (Math.hypot(m._slot[0] - m.x, m._slot[1] - m.y) > 3) far++; }
  if (!c || far / c < 0.4) { const s = Math.min(d, WAR.speed.march * WAR.tick); F.anchor.x += F.face.x * s; F.anchor.y += F.face.y * s; }
  orders(game, F, 'slot', { eng: 0, archerEng: 0 });
}

// ---------- tests / debug ----------
function debugForce(game, id) {
  const W = game.warfare, F = id ? W.forces.get(id) : [...W.forces.values()][0];
  if (!F) return null;
  return {
    id: F.id, tag: F.tag, k: F.k, kind: F.kind, sid: F.sid, phase: F.phase, n: F.n, n0: F.n0, dead: F.dead, killed: F.killed, lv: F.lv, morale: Math.round(F.morale ?? 0), cap: F.cap, foe: F.foe,
    x: r2(F.x), y: r2(F.y), anchor: F.anchor ? { x: r2(F.anchor.x), y: r2(F.anchor.y) } : null, t: r2(F.t ?? 0),
    live: F.live ? [...F.live.values()].map((m) => ({ nid: m.nid, i: m.soldier.i, role: m.soldier.role, x: r2(m.x), y: r2(m.y), z: r2(m.z || 0), lv: m.lv | 0, hp: Math.round(m.hp), dead: !!m.dead, order: m.order?.k || null, foe: m.foe ? (m.foe.nid || (m.foe.pid ? 'p:' + m.foe.pid : 'player')) : null, act: m.action?.type || null, state: m.state })) : [],
    siege: F.kind === 'siege' ? siegeStatus(game, F) : null,
  };
}
export { siegeLoad };
