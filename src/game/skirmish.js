// Skirmish ("Escaramuça", docs/SKIRMISH.md): a throwaway arena world where the players try the game's war — a field
// battle, a siege of a real settlement, or the defense of a place against a winter-night wave of monsters — alone or with
// friends (the same room code as the multiplayer). Nothing of it is saved (game.noSave), nothing touches the survival
// worlds.
//
// game.skirmish (every peer):
//   on                 this world is a skirmish arena
//   st                 the shared state (game/mut/skirmish.js op sk.st): settings, picks, phase, match, score, results
//   kOf(e) / kOfPid(pid) / sideOf(pid)   the kingdom / side of a player in the match (−1 / null: not in it)
//   mayHurt(pl, soldier) / pvpWhy(a, b)  who may hurt whom (game/soldier.js, game/army.js hooks)
//   respawnAt() / keepKit() / respawnLeft()   death in a match: no body, the kit stays, back at the side's rear
//   onKill(pid, m) / pvpHit(a, v)        the tally (game/combat.js, game/mut/combat.js hooks; host)
//   host { set, pick, start, lobby }     the host's side of the intents sk.set / sk.pick / sk.start / sk.lobby
//   debug()                              tests
// Systems: the host's (the lobby's picks, the arena, the forces, the wave, the end, the reset) and every peer's (its own
// player: where it stands, its kit, the clock, no cold / hunger — owner's rule —, the respawn).
//
// The war is the real one: 3b's forces (game/warfare.js startBattle / startSiege, with a skirmish's copper kit, kept alive
// while nobody is near, held until the countdown ends) and a garrison of soldiers holding the walls (startForce, below);
// the town's own guards defend their place (game/people.js, defense.js); the monsters are the night's dead
// (game/walkers.js, giants.js) marching on the place (m.lure) — a small wave kept apart so the winter raids can take it
// over later.

import { MODES, PLACES, FAMS, DEFAULTS, TOTAL, SHARE, giantsFor, sidesOf, CLASSES, BAG, NPC_KIT, LEVEL, MATCH, CAPS, END_PT } from './content/skirmish.js';
import { WAR } from './content/soldiers.js';
import { allPlayers, inAnyView } from './players.js';
import { solNear, solPass, surfAt, ownerOf, stepTo, unstick } from './soldier.js';
import { spawnWalkerAt } from './walkers.js';
import { spawnGiantAt } from './giants.js';
import { killMob } from './combat.js';
import { equipChanged } from './equipment.js';
import { applyLevel, removeBuff, respawnPlayer } from './player.js';
import { mobStats } from './stats.js';
import { SPECIES } from './data.js';
import { siegeThreat } from './siegeAI.js';
import { facingFrom } from './physics.js';
import { entOfPid } from './eco.js';

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const SURVIVAL_BAD = ['hypothermia', 'cold', 'wet', 'chilled', 'starving', 'hungry'];

// ---------- install (every peer) ----------
export function installSkirmish(game, { quality = game.quality } = {}) {
  const H = { st: null, dirty: false, forces: [], mobs: new Set(), wave: null, gar: null, tickT: 0, scoreT: 0, prepT: 0, lastHit: new Map(), deadSeen: new Map(), plazaT: 0, myPid: null, arena: new Map(), endT: 0, stats: { ms: 0, max: 0, n: 0, sum: 0 } };
  const L = { phase: null, mid: null, deadT: -1, viewKey: '', kitKey: '', heldBtn: false };
  const SK = {
    on: true, st: null, H, L,
    kOf: (e) => kOfEnt(game, e),
    kOfPid: (pid) => kOfPid(game, pid),
    sideOf: (pid) => sideOf(game, pid),
    mayHurt: (pl, e) => mayHurt(game, pl, e),
    pvpWhy: (a, b, name) => pvpWhy(game, a, b, name),
    respawnAt: () => respawnAt(game),
    respawnLeft: () => respawnLeft(game),
    keepKit: () => true, // (the arena never leaves a body: nothing is lost here)
    onKill: (pid, m) => onKill(game, pid, m),
    pvpHit: (a, v) => { if (inFight(game)) H.lastHit.set(v, [a, game.worldTime]); },
    host: { set: (p) => hostSet(game, p), pick: (pid, a) => hostPick(game, pid, a), start: () => hostStart(game), lobby: () => hostLobby(game) },
    debug: () => debugOf(game),
    arenaOf: (set) => arenaFor(game, set || SK.st?.set || DEFAULTS),
  };
  game.skirmish = SK;
  // back in a match: whole again at once (no "weak" debuff, full life)
  game.events.on('respawn', () => { if (inMatch(game, game.net.pid)) game.later(0, () => heal(game)); });
  // more live soldiers at once than in the survival game (docs/SKIRMISH.md "Desempenho"): by the device's quality
  const C = CAPS[quality] || CAPS.medium;
  Object.assign(WAR.cap, { total: C.total, side: C.side, siege: C.siege, low: 1 });
  SK.cap = C;
  if (game.net.auth) {
    // a still world: the kingdoms' AI paused (no war breaks out by itself), clear skies
    game.realms?.dbg?.stop?.(true);
    game.env.setWeather?.('clear'); game.env.weatherT = 1e9;
    H.st = { v: 0, phase: 'lobby', set: { ...DEFAULTS }, picks: [], host: game.net.pid, arena: null, match: null, score: null, res: null };
    H.st.arena = arenaPub(arenaFor(game, H.st.set));
    flush(game, true);
  }
  return SK;
}
// the systems (main.js adds them after installSystems)
export function skirmishHostSystem() {
  return {
    sync: 'host', // the lobby, the match, the forces, the wave, the end (replicated by op sk.st and the 3b ops)
    update(game, dt) {
      const SK = game.skirmish;
      if (!SK) return;
      const t0 = performance.now();
      hostTick(game, dt);
      const ms = performance.now() - t0, S = SK.H.stats;
      S.ms = ms; S.max = Math.max(S.max, ms); S.n++; S.sum += ms;
    },
  };
}
export function skirmishLocalSystem() {
  return {
    sync: 'all', // every peer: its own player (where it stands, its kit, the bars, the respawn) and the frozen clock
    update(game, dt) { if (game.skirmish) localTick(game, dt); },
  };
}

// ---------- who is who (every peer, from the shared state) ----------
const ST = (game) => game.skirmish?.st || null;
const matchOf = (game) => { const st = ST(game); return st && st.match && st.phase !== 'lobby' ? st.match : null; };
function sideOf(game, pid) {
  const M = matchOf(game);
  if (!M || pid == null) return null;
  for (const q of M.players || []) if (q[0] === pid) return q[1];
  return null;
}
const inMatch = (game, pid) => sideOf(game, pid) != null;
const inFight = (game) => { const st = ST(game); return !!st && (st.phase === 'fight' || st.phase === 'count'); };
function kOfPid(game, pid) {
  const M = matchOf(game), s = sideOf(game, pid);
  if (!M || !s) return -1;
  return s === 'a' ? M.ka : M.kb;
}
const pidOfEnt = (game, e) => (!e ? null : e === game.player ? game.net.pid : e.pid || e.owner?.pid || (e.owner === game.player ? game.net.pid : null));
// the kingdom of a player body (the local player, a remote copy, a host avatar, an arrow's owner): its side's; −1 when it
// is no player of the match; null for anything else (not a player: the survival rules)
function kOfEnt(game, e) {
  if (!game.skirmish?.on) return null;
  const pid = pidOfEnt(game, e);
  if (pid == null) return null;
  return inFight(game) || ST(game)?.phase === 'end' ? kOfPid(game, pid) : -1;
}
function mayHurt(game, pl, e) {
  const S = e?.soldier;
  if (!S) return undefined;
  const k = kOfPid(game, pidOfEnt(game, pl));
  if (k < 0) return 'Fora da partida';
  if (S.k === k) return `${e.name} é do seu lado`;
  return null;
}
function pvpWhy(game, a, b, name = 'Este jogador') {
  if (!game.skirmish?.on) return undefined;
  const sa = sideOf(game, a), sb = sideOf(game, b);
  if (!sa || !sb || !inFight(game)) return `${name} não está na partida`;
  if (sa === sb) return `${name} é do seu lado`;
  return null;
}

// ---------- the arena (host): the place, the kingdoms, the field ----------
// the settlement of the start (the world's spawn: a village plaza)
function startTown(game) {
  const R = game.towns?.realm, sp = game.world.spawn;
  if (!R || !sp) return null;
  let best = null, bd = 1e9;
  for (const s of R.settlements) { const d = hyp(s.x, s.y, sp.x, sp.y); if (d < bd) { bd = d; best = s; } }
  return best;
}
// the nearest settlement of a kind (PLACES) to the start, on the start's landmass
function placeFor(game, place, s0) {
  const R = game.towns.realm, P = PLACES[place];
  if (!P || !s0) return null;
  if (s0.kind === P.kind && (s0.walls || null) === P.walls) return s0;
  let best = null, bd = 1e9;
  for (const s of R.settlements) {
    if (s.kind !== P.kind || (s.walls || null) !== P.walls || s.comp !== s0.comp) continue;
    const d = hyp(s.x, s.y, s0.x, s0.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// two kingdoms of the landmass with colours far apart: the defender's (a place) and the nearest other one
function kingdomsFor(game, s, kb = null) {
  const R = game.towns.realm, K = R.kingdoms, comp = s.comp;
  const near = K.filter((k) => k.comp === comp && (!game.realms?.alive || game.realms.alive(k.id))).sort((a, b) => hyp(R.settlements[a.capital].x, R.settlements[a.capital].y, s.x, s.y) - hyp(R.settlements[b.capital].x, R.settlements[b.capital].y, s.x, s.y));
  const far = (a, b) => { const c = K[a]?.color, d = K[b]?.color; return c && d ? Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) : 0; };
  if (kb == null) kb = near[0]?.id ?? 0;
  const others = near.filter((k) => k.id !== kb);
  const ka = (others.find((k) => far(k.id, kb) > 110) || others[0] || K.find((k) => k.id !== kb))?.id ?? kb;
  return [ka, kb];
}
// how open a box of ground is (0..1): the soldiers' ground (no rock, cliffs, deep water, trees, buildings); a tile of a
// chunk not loaded here counts as half open
let UNL = 0; // (the share of the last box that was not loaded here)
function openness(game, cx, cy, ux, uy, halfL, halfW) {
  const w = game.world, tx = -uy, ty = ux;
  let ok = 0, n = 0, unl = 0;
  for (let a = -halfL; a <= halfL; a += 2) for (let b = -halfW; b <= halfW; b += 2) {
    const x = cx + ux * a + tx * b, y = cy + uy * a + ty * b, X = Math.floor(x), Y = Math.floor(y);
    n++;
    if (!w.inBounds(X, Y)) continue;
    const ci = w.chunkIndex ? w.chunkIndex(X, Y) : -1;
    if (ci >= 0 && w.isLoaded && !w.isLoaded(ci)) { ok += 0.5; unl++; continue; }
    if (solPass(game, X, Y)) ok++;
  }
  UNL = n ? unl / n : 0;
  return n ? ok / n : 0;
}
const DIRS8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
// the field of a battle: open ground beside the start village (its land kept out of the fight), the lines' axis along it
function fieldSite(game, s0) {
  const R = game.towns.realm;
  let best = null;
  for (const [dx, dy] of DIRS8) {
    const D = s0.r + 64, cx = s0.x + dx * D, cy = s0.y + dy * D, ux = -dy, uy = dx;
    let sc = openness(game, cx, cy, ux, uy, 38, 12);
    const unl = UNL;
    for (const s of R.settlements) if (s !== s0 && hyp(s.x, s.y, cx, cy) < s.r + 50) sc -= 0.35; // (not into another place)
    if (!best || sc > best.sc) best = { cx: r2(cx), cy: r2(cy), ux: r2(ux), uy: r2(uy), sc, unl };
  }
  return best;
}
// the side an army / a wave comes from: the most open ground around the place
function approachDir(game, s) {
  let best = null;
  for (const [dx, dy] of DIRS8) {
    const D = s.r + 32, sc = openness(game, s.x + dx * D, s.y + dy * D, dx, dy, 14, 14) + (dx === 1 && !dy ? 0.03 : 0);
    if (!best || sc > best.sc) best = { x: dx, y: dy, sc };
  }
  return best;
}
// the arena of a set of settings (cached by mode + place): { sid, name, kind, ka, kb, view, field? }
function arenaFor(game, set) {
  const H = game.skirmish.H, key = set.mode === 'field' ? 'field' : 'p:' + set.place;
  if (H.arena.has(key)) return H.arena.get(key);
  const R = game.towns?.realm, s0 = startTown(game);
  if (!R || !s0) return null;
  let A;
  if (set.mode === 'field') {
    const f = fieldSite(game, s0), [ka, kb] = kingdomsFor(game, s0);
    A = { sid: -1, name: `Campos de ${s0.name}`, kind: 'field', ka, kb, view: [f.cx, f.cy], field: f, near: s0.name };
    if (f.unl > 0.25) return A; // (the ground there not loaded yet: a guess, looked at again from the lobby — hostTick)
  } else {
    const s = placeFor(game, set.place, s0);
    if (!s) return null;
    const kb = ownerOf(game, s.id), [ka] = kingdomsFor(game, s, kb), Lo = game.towns.layout(s.id);
    const v = Lo?.spawn || [s.x, s.y + 3];
    A = { sid: s.id, name: s.name, kind: s.kind, walls: s.walls || null, ka, kb, view: [r2(v[0]), r2(v[1])], far: Math.round(hyp(s.x, s.y, s0.x, s0.y)) };
  }
  H.arena.set(key, A);
  return A;
}
// the arena as the lobby shows it (names, colours)
function arenaPub(A) {
  if (!A) return null;
  return { sid: A.sid, name: A.name, kind: A.kind, walls: A.walls || null, ka: A.ka, kb: A.kb, view: A.view, far: A.far || 0 };
}

// ---------- the host: state, intents ----------
function flush(game, force = false) {
  const H = game.skirmish.H;
  if (!H.dirty && !force) return;
  H.dirty = false;
  H.st.v = (H.st.v | 0) + 1;
  game.net.emit('sk.st', { st: H.st });
}
const put = (game) => { game.skirmish.H.dirty = true; return game.skirmish.H.st; };

// the players here now (host): [{ pid, name }]
function present(game) {
  const out = [{ pid: game.net.pid, name: game.player.name || 'Anfitrião' }];
  const s = game.session;
  if (s && s.state !== 'closed') for (const pl of s.players.values()) if (pl.synced) out.push({ pid: pl.pid, name: pl.name || 'Jogador' });
  return out;
}
function syncPicks(game) {
  const H = game.skirmish.H, st = H.st;
  // (hosting a room changes the host's own pid: its pick goes with it)
  if (H.myPid && H.myPid !== game.net.pid) { for (const p of st.picks) if (p[0] === H.myPid) { p[0] = game.net.pid; H.dirty = true; } if (st.match) for (const q of st.match.players) if (q[0] === H.myPid) q[0] = game.net.pid; st.host = game.net.pid; }
  H.myPid = game.net.pid;
  const here = present(game), ids = new Set(here.map((q) => q.pid));
  const before = st.picks.length;
  st.picks = st.picks.filter((p) => ids.has(p[0]));
  for (const q of here) {
    let p = st.picks.find((x) => x[0] === q.pid);
    if (!p) {
      const na = st.picks.filter((x) => x[2] === 'a').length, nb = st.picks.length - na;
      const side = st.set.mode === 'monsters' ? 'b' : na <= nb ? 'a' : 'b';
      st.picks.push(p = [q.pid, q.name.slice(0, 18), side, 'sword', q.pid === game.net.pid ? 1 : 0]);
      H.dirty = true;
    } else if (p[1] !== q.name.slice(0, 18)) { p[1] = q.name.slice(0, 18); H.dirty = true; }
  }
  if (st.picks.length !== before) H.dirty = true;
}
function hostSet(game, patch) {
  const st = game.skirmish.H.st;
  if (st.phase !== 'lobby') return 'A partida já começou';
  const S = { ...st.set };
  if (patch.mode && MODES[patch.mode]) S.mode = patch.mode;
  if (patch.place && PLACES[patch.place]) S.place = patch.place;
  if (patch.fam && FAMS[patch.fam]) S.fam = patch.fam;
  if (patch.total != null) S.total = clamp(Math.round(patch.total / TOTAL.step) * TOTAL.step, TOTAL.min, TOTAL.max);
  if (patch.pa != null) S.pa = clamp(Math.round(patch.pa / SHARE.step) * SHARE.step, SHARE.min, SHARE.max);
  if (S.mode !== 'field' && S.total < TOTAL.minNpc) S.total = TOTAL.minNpc;
  const modeChanged = S.mode !== st.set.mode;
  put(game).set = S;
  if (S.mode === 'monsters') for (const p of st.picks) if (p[2] !== 'b') p[2] = 'b';
  if (modeChanged && S.mode === 'monsters' && S.pa === DEFAULTS.pa) S.pa = 60; // (monsters: 60 % of the battle by default)
  const A = arenaFor(game, S);
  st.arena = arenaPub(A);
  flush(game);
  return A ? true : 'Não há um lugar assim neste mundo';
}
function hostPick(game, pid, a) {
  const st = game.skirmish.H.st;
  syncPicks(game);
  const p = st.picks.find((x) => x[0] === pid);
  if (!p) return 'Jogador desconhecido';
  if (st.phase !== 'lobby') return 'A partida já começou: espere a próxima';
  if (a.side === 'a' || a.side === 'b') { if (st.set.mode === 'monsters' && a.side === 'a') return 'Na defesa contra monstros todos defendem'; p[2] = a.side; }
  if (a.cls && CLASSES[a.cls]) p[3] = a.cls;
  if (a.ready != null) p[4] = a.ready ? 1 : 0;
  put(game);
  flush(game);
  return true;
}
// why the match cannot start now (null: it can)
export function startWhy(st, myPid) {
  if (!st || st.phase !== 'lobby') return 'A partida já começou';
  if (!st.arena) return 'Não há um lugar assim neste mundo';
  const wait = st.picks.filter((p) => p[0] !== myPid && !p[4]);
  if (wait.length) return `Aguardando ${wait.map((p) => p[1]).join(', ')} ficar pronto`;
  const [na, nb] = sidesOf(st.set.total, st.set.pa);
  if (st.set.mode === 'field' && !na && !nb) {
    const sa = st.picks.some((p) => p[2] === 'a'), sb = st.picks.some((p) => p[2] === 'b');
    if (!sa || !sb) return 'Sem soldados: ponha soldados na batalha ou escolham lados opostos (PvP)';
  }
  return null;
}
function hostStart(game) {
  const SK = game.skirmish, H = SK.H, st = H.st;
  syncPicks(game);
  const why = startWhy(st, game.net.pid);
  if (why) return why;
  const A = arenaFor(game, st.set);
  if (!A) return 'Não há um lugar assim neste mundo';
  const set = st.set, [nA, nB] = sidesOf(set.total, set.pa), mode = set.mode;
  const id = game.net.newId('K');
  const M = {
    id, mode, place: set.place, fam: set.fam, sid: A.sid, name: A.name, ka: A.ka, kb: A.kb, nA, nB,
    giants: mode === 'monsters' ? giantsFor(nA) : 0, players: st.picks.map((p) => [p[0], mode === 'monsters' ? 'b' : p[2], p[3], p[1]]),
    spots: null, countT: 0, t0: 0, limit: MATCH.limit[mode] || 720, hour: mode === 'monsters' ? MATCH.hour.night : MATCH.hour.day,
  };
  put(game);
  st.match = M; st.phase = 'prep'; st.score = null; st.res = null;
  // the world around it: the kingdoms at war (quietly), the time and the weather, the guards' level (§7b record)
  game.realms?.dbg?.stop?.(true);
  if (M.ka !== M.kb) game.net.emit('realm.rel', { a: M.ka, b: M.kb, rel: 'war', by: M.ka, why: 'escaramuça', quiet: 1 });
  game.net.emit('env.skip', { hour: M.hour, day: game.env.dayIndex, wt: r2(game.worldTime + 0.5) });
  if ((game.towns?.prog || 1) < LEVEL.guards) game.net.emit('town.prog', { lv: LEVEL.guards });
  game.env.setWeather?.('clear'); game.env.weatherT = 1e9;
  H.prepT = 0; H.forces = []; H.gar = null; H.wave = null; H.mobs.clear(); H.lastHit.clear(); H.deadSeen.clear(); H.plazaT = 0; H.kills = new Map(); H.deaths = new Map(); H.made = false;
  flush(game);
  return true;
}
// "Jogar de novo": the field cleared, everyone back in the lobby with the same settings
function hostLobby(game) {
  const SK = game.skirmish, H = SK.H, st = H.st;
  if (st.phase === 'lobby') return true;
  clearField(game);
  put(game);
  st.phase = 'lobby'; st.match = null; st.score = null;
  for (const p of st.picks) if (p[0] !== game.net.pid) p[4] = 0;
  flush(game);
  return true;
}
function clearField(game) {
  const SK = game.skirmish, H = SK.H, M = H.st.match, W = game.warfare;
  for (const id of H.forces) if (W?.forces.has(id)) W.dematerialize(id);
  for (const F of [...(W?.forces.values() || [])]) if (F.sk && F.sk === M?.id) W.dematerialize(F.id);
  H.forces = []; H.gar = null; H.wave = null;
  for (const m of H.mobs) if (!m.dead) killMob(game, m, null);
  H.mobs.clear();
  if (M && M.sid >= 0) healTown(game, M.sid, M.kb);
  if (M && M.ka !== M.kb) game.net.emit('realm.rel', { a: M.ka, b: M.kb, rel: 'neutral', quiet: 1 });
}
// the place as it was: pieces back, damage gone, its dead back, its kingdom back
function healTown(game, sid, k) {
  const pre = `t${sid}.`, ids = [];
  for (const [id, r] of game.towns?.state || []) {
    if (!id.startsWith(pre)) continue;
    if (r.gone) ids.push(id);
    else if (r.dmg > 0) game.net.emit(game.world.objById.get(id)?.sdmg ? 'siege.dmg' : 'struct.dmg', { id, d: 0, x: r.x + 0.5, y: r.y + 0.5 });
  }
  if (ids.length) game.net.emit('town.restore', { ids: ids.slice(0, 400) });
  for (const key of [...(game.towns?.dead || new Map()).keys()]) { const [a, i] = String(key).split('.').map(Number); if (a === sid) game.net.emit('town.pop', { sid, i, dead: 0 }); }
  if (game.realms?.owner && game.realms.owner(sid) !== k) game.realms.dbg?.capture?.(sid, k);
}

// ---------- the host's tick ----------
function hostTick(game, dt) {
  const SK = game.skirmish, H = SK.H, st = H.st;
  if (!st) return;
  H.tickT -= dt;
  if (H.tickT > 0) return;
  H.tickT = 0.25;
  syncPicks(game);
  // the lobby: an arena guessed before its ground was loaded is looked at again
  if (st.phase === 'lobby' && (H.arenaT = (H.arenaT || 0) - 0.25) <= 0) {
    H.arenaT = 2;
    const A = arenaPub(arenaFor(game, st.set));
    if (JSON.stringify(A) !== JSON.stringify(st.arena)) { put(game); st.arena = A; }
  }
  if (st.phase === 'prep') prepTick(game);
  else if (st.phase === 'count') { if (game.worldTime >= st.match.countT) beginFight(game); }
  else if (st.phase === 'fight') fightTick(game);
  else if (st.phase === 'end') { for (const m of H.mobs) if (!m.dead && game.worldTime - H.endT > MATCH.endShow && st.res?.win === 'b') killMob(game, m, null); }
  flush(game);
}
// the battlefield made: the place ready here, the forces up, the spots of each side → the countdown
function prepTick(game) {
  const SK = game.skirmish, H = SK.H, st = H.st, M = st.match;
  H.prepT += 0.25;
  const late = H.prepT > MATCH.prepMax;
  if (M.sid >= 0 && !late && !game.towns.ready?.(M.sid)) return;
  if (!H.made) { H.made = true; makeForces(game); }
  const spots = spotsOf(game);
  if (!spots) { if (!late) return; }
  put(game);
  M.spots = spots || fallbackSpots(game);
  M.countT = r2(game.worldTime + MATCH.count);
  st.phase = 'count';
  st.score = scoreOf(game);
}
function beginFight(game) {
  const SK = game.skirmish, H = SK.H, st = H.st, M = st.match;
  put(game);
  st.phase = 'fight';
  M.t0 = r2(game.worldTime);
  for (const id of H.forces) { const F = game.warfare.forces.get(id); if (F) F.hold = false; }
  if (H.wave) H.wave.on = true;
}
const forceOf = (game, id) => (id ? game.warfare?.forces.get(id) || null : null);
// the forces of the match (host): 3b's battle / siege with the skirmish's copper kit, a garrison on the walls, the wave
function makeForces(game) {
  const SK = game.skirmish, H = SK.H, M = H.st.match, W = game.warfare, A = arenaFor(game, H.st.set);
  const base = { lv: LEVEL.soldier, keep: true, kit: NPC_KIT, min: 1, sk: M.id };
  if (M.mode === 'field') {
    const f = A.field, ax = f.cx - f.ux * 17, ay = f.cy - f.uy * 17, bx = f.cx + f.ux * 17, by = f.cy + f.uy * 17;
    M.axis = [f.cx, f.cy, f.ux, f.uy];
    if (M.nA && M.nB) {
      const [FA, FB] = W.startBattle({ ...base, k: M.ka, n: M.nA, at: [ax, ay], hold: true }, { ...base, k: M.kb, n: M.nB, at: [bx, by], hold: true });
      H.forces = [FA.id, FB.id]; H.fa = FA.id; H.fb = FB.id;
    }
    return;
  }
  const s = game.towns.realm.settlements[M.sid], dir = approachDir(game, s), reach = s.r + 90;
  M.dir = [r2(dir.x), r2(dir.y)];
  if (M.mode === 'siege') {
    const want = s.kind === 'village' ? (s.walls ? { treb: 1, ram: 1, tower: 1 } : {}) : { treb: 2, ram: 1, tower: 1 };
    const F = W.startSiege({ ...base, k: M.ka, sid: M.sid, n: M.nA, at: [s.x + dir.x * (s.r + 42), s.y + dir.y * (s.r + 42)], eng: want, have: { ...want }, ph: 'build', reach });
    if (F) { H.forces.push(F.id); H.fs = F.id; }
  }
  const nDef = M.nB;
  if (nDef > 0) {
    const G = W.startForce({ ...base, k: M.kb, n: nDef, at: [s.x, s.y], reach }, 'garrison', (g, F) => garrisonTick(g, F));
    if (G) {
      G.phase = 'hold'; G.gar = { sid: M.sid, sig: '', posts: new Map(), climb: new Map(), mon: M.mode === 'monsters' };
      const S = game.people?.of?.(M.sid), plaza = S?.plaza || { x: s.x, y: s.y };
      G.anchor = { x: plaza.x, y: plaza.y }; G.face = { x: dir.x, y: dir.y }; G.fx = dir.x; G.fy = dir.y;
      G.rear = () => [plaza.x, plaza.y];
      G.slotOf = (u) => { const p = G.gar.posts.get(u.i); return p ? [p.x, p.y] : [plaza.x + ((u.i % 5) - 2), plaza.y + ((u.i / 5 | 0) % 3)]; };
      H.forces.push(G.id); H.gar = G.id;
    }
  }
  if (M.mode === 'monsters') {
    const fam = FAMS[M.fam] || FAMS.ice, n = M.nA, g = M.giants;
    const S = game.people?.of?.(M.sid), plaza = S?.plaza || { x: s.x, y: s.y };
    H.wave = { on: false, fam, left: n - g, giants: g, total: n, made: 0, nextGiant: g ? Math.max(1, Math.floor(n / (g + 1))) : 1e9, every: g ? Math.max(1, Math.floor(n / g)) : 1e9, dir, s, lure: [r2(plaza.x), r2(plaza.y)], cap: SK.cap.monsters };
  }
}
// where each side starts / comes back (host): [x, y, fx, fy] of a and b, + the rears ra / rb
function spotsOf(game) {
  const SK = game.skirmish, H = SK.H, M = H.st.match;
  if (M.mode === 'field') {
    const [cx, cy, ux, uy] = M.axis, back = M.nA || M.nB ? 28 : 10;
    const a = [cx - ux * back, cy - uy * back], b = [cx + ux * back, cy + uy * back];
    return { a: [...xy(game, a), ux, uy], b: [...xy(game, b), -ux, -uy], ra: xy(game, a), rb: xy(game, b) };
  }
  const s = game.towns.realm.settlements[M.sid], S = game.people?.of?.(M.sid), plaza = S?.plaza || { x: s.x, y: s.y }, dir = { x: M.dir[0], y: M.dir[1] };
  const rb = xy(game, [plaza.x, plaza.y]);
  if (M.mode === 'siege') {
    const F = forceOf(game, H.fs), P = F?.sg?.plan;
    if (F && !P) return null; // (the siege still planning its camp: the countdown waits for it)
    const camp = P ? P.camp : { x: s.x + dir.x * (s.r + 30), y: s.y + dir.y * (s.r + 30) }, ax = P ? P.A.x : dir.x, ay = P ? P.A.y : dir.y;
    const a = xy(game, [camp.x - ax * 1.5, camp.y - ay * 1.5]);
    return { a: [...a, -ax, -ay], b: [...xy(game, [(plaza.x * 2 + s.x + dir.x * s.r * 0.6) / 3, (plaza.y * 2 + s.y + dir.y * s.r * 0.6) / 3]), dir.x, dir.y], ra: a, rb };
  }
  // monsters: the defenders by the plaza, toward the side the wave comes from
  return { a: [...xy(game, [s.x + dir.x * (s.r + 30), s.y + dir.y * (s.r + 30)]), -dir.x, -dir.y], b: [...xy(game, [plaza.x + dir.x * 3, plaza.y + dir.y * 3]), dir.x, dir.y], ra: rb, rb };
}
function fallbackSpots(game) {
  const v = game.skirmish.H.st.arena?.view || [game.world.spawn.x, game.world.spawn.y];
  return { a: [v[0] - 4, v[1], 1, 0], b: [v[0] + 4, v[1], -1, 0], ra: v, rb: v };
}
const xy = (game, p) => { const q = solNear(game, p[0], p[1], 4) || p; return [r2(q[0]), r2(q[1])]; };

// ---------- the garrison: soldiers of the defenders holding the walls, the gates, the breaches and the plaza ----------
function garrisonTick(game, F) {
  const G = F.gar, sid = G.sid, S = game.people?.of?.(sid), per = game.townDefense?.perimeter?.(sid);
  if (!S || !per) return;
  const H = game.skirmish.H, s = S.s, w = game.world;
  // the monsters near the place are its foes too (3b lists soldiers, guards and players)
  if (G.mon) for (const m of H.mobs) if (!m.dead && hyp(m.x, m.y, s.x, s.y) < s.r + 45) F.foes.push(m);
  // the threat: the siege's side, else the wave's
  const FS = forceOf(game, H.fs), th = FS ? siegeThreat(game, FS) : { fx: F.face.x, fy: F.face.y, sector: 0 };
  const ops = game.townDefense.openings(sid);
  const ents = [...F.live.values()].filter((m) => !m.dead);
  let inside = 0;
  for (const e of F.foes) if (!e.dead && per.inside(e.x, e.y, w)) inside++;
  const sig = `${ops.map((o) => o.id).join(',')}|${th.sector}|${ents.length}|${inside > 0 ? 1 : 0}`;
  if (sig !== G.sig) { G.sig = sig; G.posts = garrisonPosts(game, F, S, per, ops, th, ents, inside > 0); }
  for (const m of ents) {
    const p = G.posts.get(m.soldier.i);
    if (!p) continue;
    if (p.lv > 0) { if (!(m.z > 0.5)) { if (!m.job?.wall) m.job = climbJob(p); } else { m.job = null; m.order = { k: 'wall', x: p.x, y: p.y, fx: p.fx, fy: p.fy, eng: WAR.archer.range * 1.25, rangeK: 1 }; } continue; }
    if (m.job?.wall) m.job = null;
    if (m.z > 0.5) { const q = solNear(game, m.x - (p.fx || 0) * 2, m.y - (p.fy || 0) * 2, 3); if (q) { m.x = q[0]; m.y = q[1]; m.z = 0; m.lv = 0; } }
    const O = m.order && m.order.k === 'hold' && m.order.key === p.key ? m.order : (m.order = { k: 'hold', key: p.key });
    O.x = p.x; O.y = p.y; O.fx = p.fx; O.fy = p.fy; O.eng = p.eng; O.leash = p.leash; O.run = true;
  }
}
// archers: to the foot of the wall below the spot, a moment, and up (like the guards: game/npc.js upTask)
function climbJob(p) {
  const f = (game, F, m, dt) => {
    const T = m._wclimb || (m._wclimb = { foot: null, t: 0 });
    const up = () => { m.x = p.x; m.y = p.y; m.z = p.lv; m.lv = p.lv; m.moving = false; m._wclimb = null; m.job = null; };
    if (!inAnyView(game, p.x, p.y, 1, 2) && !inAnyView(game, m.x, m.y, 1, 2)) { up(); return true; }
    const q = T.foot || (T.foot = solNear(game, p.x - (p.fx || 0) * 2, p.y - (p.fy || 0) * 2, 3));
    if (!q) { up(); return true; }
    const st = stepTo(game, m, q[0], q[1], WAR.speed.run, dt, 0.5);
    if (st === 'here') { m.moving = false; m.facing = facingFrom(p.x - m.x, p.y - m.y, m.facing); T.t += dt; if (T.t > 1.1) up(); }
    else if (st === 'stuck') { T.t += dt; if (!unstick(game, m, q[0], q[1]) && T.t > 4) up(); }
    return true;
  };
  f.wall = true; f.eng = 0;
  return f;
}
// the posts (recomputed when something changes): archers on the wall tops facing the threat (an open village: behind
// its edge), the breaches held by the nearest, two at each gate facing the threat and one at the others, a reserve on the
// plaza, the rest along the stretch facing the attackers; with foes inside the walls the reserve and the stretch hunt them
function garrisonPosts(game, F, S, per, ops, th, ents, inside) {
  const out = new Map(), al = (fx, fy) => fx * th.fx + fy * th.fy, plaza = S.plaza;
  const arch = ents.filter((m) => m.soldier.role === 'archer'), mel = ents.filter((m) => m.soldier.role !== 'archer');
  const free = new Set(mel);
  const take = (x, y, n) => { const L = [...free].sort((a, b) => hyp(a.x, a.y, x, y) - hyp(b.x, b.y, x, y)).slice(0, n); for (const m of L) free.delete(m); return L; };
  const spot = (x, y) => solNear(game, x, y, 2) || [x, y];
  const set = (m, x, y, fx, fy, eng, key, lv = 0) => out.set(m.soldier.i, { x, y, fx, fy, eng, leash: eng + 4, key, lv });
  // the breaches
  for (const o of ops.slice().sort((a, b) => al(b.fx, b.fy) - al(a.fx, a.fy))) {
    take(o.x, o.y, o.w >= 3 || o.gate ? 4 : 3).forEach((m, j) => { const q = spot(o.x - o.fx * (j ? 1.2 : 0.2) + -o.fy * (j - 1) * 0.9, o.y - o.fy * (j ? 1.2 : 0.2) + o.fx * (j - 1) * 0.9); set(m, q[0], q[1], o.fx, o.fy, 6, 'gap' + o.id); });
  }
  // the reserve on the plaza (15 %): what got inside
  take(plaza.x, plaza.y, Math.max(1, Math.round(mel.length * 0.15))).forEach((m, j) => { const q = spot(plaza.x + ((j % 4) - 1.5) * 1.2, plaza.y + ((j / 4 | 0) % 3) * 1.2); set(m, q[0], q[1], th.fx, th.fy, inside ? 40 : 14, 'res' + j); });
  // the gates
  const gates = S.posts.gates.slice().sort((a, b) => al(b.fx, b.fy) - al(a.fx, a.fy));
  for (const g of gates) { if (!free.size) break; take(g.x, g.y, al(g.fx, g.fy) > 0.5 ? 2 : 1).forEach((m, j) => { const q = spot(g.x - g.fy * j * 1.1, g.y + g.fx * j * 1.1); set(m, q[0], q[1], g.fx, g.fy, 8, 'gate' + g.x + ',' + g.y + j); }); }
  // the stretch facing the threat (walled: the patrol loop just inside; open: points of the edge)
  let pts;
  if (per.walled) {
    pts = S.posts.patrol.map(([x, y]) => { const dx = x - per.cx, dy = y - per.cy, d = Math.hypot(dx, dy) || 1; return { x, y, fx: dx / d, fy: dy / d }; }).filter((p) => al(p.fx, p.fy) > -0.2).sort((a, b) => al(b.fx, b.fy) - al(a.fx, a.fy));
  } else {
    const a0 = Math.atan2(th.fy, th.fx), R = per.A - 1;
    pts = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2].map((da) => { const fx = Math.cos(a0 + da), fy = Math.sin(a0 + da); return { x: per.cx + fx * R, y: per.cy + fy * R, fx, fy }; });
  }
  if (!pts.length) pts = [{ x: plaza.x + th.fx * 6, y: plaza.y + th.fy * 6, fx: th.fx, fy: th.fy }];
  let j = 0;
  for (const m of [...free]) {
    const p = pts[j % pts.length], row = Math.floor(j / pts.length), q = spot(p.x - p.fx * row * 1.2 + -p.fy * (row & 1 ? 0.8 : 0), p.y - p.fy * row * 1.2 + p.fx * (row & 1 ? 0.8 : 0));
    set(m, q[0], q[1], p.fx, p.fy, inside ? 22 : 9, 'st' + j); j++;
  }
  // archers: the wall tops facing the threat (beside each other along the walk), never on a piece that is gone
  const W = S.posts.walls.filter((w) => !ops.some((o) => hyp(o.x, o.y, w.x, w.y) < 1 + o.w / 2)).sort((a, b) => al(b.fx, b.fy) - al(a.fx, a.fy));
  const used = new Set();
  arch.forEach((m, k) => {
    if (W.length) {
      for (let tries = 0; tries < W.length * 4; tries++) {
        const w0 = W[(k + tries) % W.length], n = Math.floor((k + tries) / W.length), off = (n & 1 ? 1 : -1) * Math.ceil(n / 2), tx = Math.round(-w0.fy), ty = Math.round(w0.fx);
        const x = w0.x + tx * off, y = w0.y + ty * off, key = Math.floor(x) + ',' + Math.floor(y);
        if (used.has(key) || ((w0.lv | 0) > 0 && !surfAt(game, w0.lv | 0, x, y))) continue;
        used.add(key); set(m, x, y, w0.fx, w0.fy, WAR.archer.range * 1.2, 'w' + key, w0.lv | 0);
        return;
      }
    }
    const p = pts[k % pts.length], q = spot(p.x - p.fx * 3, p.y - p.fy * 3);
    set(m, q[0], q[1], p.fx, p.fy, WAR.archer.range, 'ar' + k);
  });
  return out;
}

// ---------- the wave of monsters (host) ----------
function waveTick(game) {
  const H = game.skirmish.H, V = H.wave;
  if (!V || !V.on) return;
  let alive = 0;
  for (const m of H.mobs) { if (m.dead) { H.mobs.delete(m); continue; } alive++; m.crumbleAt = Infinity; if (!m.lure) m.lure = V.lure; } // (never crumbling: their night lasts the match)
  let made = 0;
  while (alive < V.cap && (V.left > 0 || V.giants > 0) && made < 3) {
    const giant = V.giants > 0 && (V.made + 1 >= V.nextGiant || V.left <= 0);
    const at = waveSpot(game, V);
    if (!at) break;
    const sp = giant ? V.fam.giant : V.fam.mob;
    const m = giant ? spawnGiantAt(game, at[0], at[1], sp) : spawnWalkerAt(game, at[0], at[1], sp);
    if (!m) break;
    tuneMob(m, sp, giant ? LEVEL.giant : LEVEL.monster);
    m.lure = V.lure; m.crumbleAt = Infinity; m.awake = true; m.sk = game.skirmish.H.st.match?.id || 1; // (awake: far from every player it still marches — mobs.js)
    if (m.campRef) { m.campRef.x = V.lure[0]; m.campRef.y = V.lure[1]; }
    H.mobs.add(m);
    if (giant) { V.giants--; V.nextGiant += V.every; } else V.left--;
    V.made++; alive++; made++;
  }
}
// a spot out on the side the wave comes from (out of sight when it can), spread along a front
function waveSpot(game, V) {
  const s = V.s, d = V.dir, tx = -d.y, ty = d.x, R = s.r + 26;
  for (let k = 0; k < 8; k++) {
    const roll = game.net.roll(), roll2 = game.net.roll();
    const x = s.x + d.x * (R + roll2 * 10) + tx * (roll - 0.5) * (s.r * 1.6 + 20), y = s.y + d.y * (R + roll2 * 10) + ty * (roll - 0.5) * (s.r * 1.6 + 20);
    const q = solNear(game, x, y, 3);
    if (!q) continue;
    if (k < 5 && inAnyView(game, q[0], q[1], 2, 3)) continue;
    return q;
  }
  return solNear(game, s.x + d.x * R, s.y + d.y * R, 5);
}
// a monster at the match's level (the night's dead are levelled by their distance from the world's start)
function tuneMob(m, sp, lv) {
  const S = SPECIES[sp];
  if (!S || m.level === lv) return;
  const a = mobStats(S, m.level), b = mobStats(S, lv);
  m.hp = m.maxHp = Math.round(m.maxHp * (b.maxHp / Math.max(1, a.maxHp)));
  m.dmg = m.dmg * (b.dmg / Math.max(0.01, a.dmg));
  m.level = lv;
}

// ---------- the fight (host): the scoreboard, the end ----------
function fightTick(game) {
  const SK = game.skirmish, H = SK.H, st = H.st, M = st.match;
  waveTick(game);
  deaths(game);
  const T = game.worldTime - M.t0;
  H.scoreT -= 0.25;
  if (H.scoreT <= 0) { H.scoreT = MATCH.scoreEvery; const sc = scoreOf(game); if (JSON.stringify(sc) !== JSON.stringify(st.score)) { put(game); st.score = sc; } }
  const end = endOf(game, T);
  if (end) finish(game, end, T);
}
// who died (host): every player of the match — its death counted, the last enemy player who hit it credited
function deaths(game) {
  const H = game.skirmish.H, M = H.st.match;
  for (const [pid] of M.players) {
    const e = entOfPid(game, pid);
    if (!e) continue;
    const was = H.deadSeen.get(pid) || false;
    if (e.dead && !was) {
      H.deaths.set(pid, (H.deaths.get(pid) || 0) + 1);
      const h = H.lastHit.get(pid);
      if (h && game.worldTime - h[1] < 15 && sideOf(game, h[0]) && sideOf(game, h[0]) !== sideOf(game, pid)) { H.kills.set(h[0], (H.kills.get(h[0]) || 0) + 1); H.pvp = (H.pvp || new Map()).set(sideOf(game, h[0]), ((H.pvp?.get(sideOf(game, h[0]))) || 0) + 1); }
      H.lastHit.delete(pid);
    }
    H.deadSeen.set(pid, !!e.dead);
  }
}
// a player felled a creature (combat.js killMob, host): an enemy of its side counts
function onKill(game, pid, m) {
  const H = game.skirmish?.H, st = H?.st;
  if (!st || st.phase !== 'fight' || !game.net.auth) return;
  const s = sideOf(game, pid);
  if (!s) return;
  const M = st.match, myK = s === 'a' ? M.ka : M.kb;
  const foe = (m.soldier && m.soldier.k !== myK) || (m.npc?.guard && s === 'a' && M.mode === 'siege') || (m.faction === 'walker' && H.mobs.has(m));
  if (foe) H.kills.set(pid, (H.kills.get(pid) || 0) + 1);
}
function guardsOf(game, sid) {
  const S = game.people?.of?.(sid);
  if (!S) return [0, 0];
  let n = 0, a = 0;
  for (const P of S.persons) if (P.job === 'guard' || P.job === 'archer') { n++; if (game.people.alive(sid, P.i)) a++; }
  return [a, n];
}
// the scoreboard: [alive (with the reserves), at the start] of each side + the players' tallies
function scoreOf(game) {
  const H = game.skirmish.H, M = H.st.match, W = game.warfare;
  const nOf = (id) => { const F = forceOf(game, id); return F ? [Math.max(0, F.n | 0), F.n0 | 0] : [0, 0]; };
  let a = [0, 0], b = [0, 0];
  if (M.mode === 'field') { a = nOf(H.fa); b = nOf(H.fb); if (!H.fa && M.nA) a = [0, M.nA]; if (!H.fb && M.nB) b = [0, M.nB]; }
  else {
    const g = guardsOf(game, M.sid), gr = nOf(H.gar);
    b = [g[0] + gr[0], g[1] + gr[1]];
    if (M.mode === 'siege') a = nOf(H.fs);
    else { const V = H.wave, alive = [...H.mobs].filter((m) => !m.dead).length; a = [alive + (V ? V.left + V.giants : 0), M.nA]; }
  }
  const kills = {}, deaths = {};
  for (const [pid, n] of H.kills || []) kills[pid] = n;
  for (const [pid, n] of H.deaths || []) deaths[pid] = n;
  void W;
  return { a, b, kills, deaths, pvp: [H.pvp?.get('a') || 0, H.pvp?.get('b') || 0] };
}
// the end of the match now (host): { win: 'a' | 'b' | 'draw', why } or null
function endOf(game, T) {
  const H = game.skirmish.H, M = H.st.match, R = game.towns.realm, kn = (k) => R.kingdoms[k]?.name || '?';
  const limit = T >= M.limit;
  if (M.mode === 'field') {
    if (!M.nA && !M.nB) {
      const pa = H.pvp?.get('a') || 0, pb = H.pvp?.get('b') || 0;
      if (pa >= MATCH.pvpKills || pb >= MATCH.pvpKills) return { win: pa > pb ? 'a' : 'b', why: END_PT.pvp(MATCH.pvpKills) };
      const sa = M.players.some(([pid, s]) => s === 'a' && entOfPid(game, pid)), sb = M.players.some(([pid, s]) => s === 'b' && entOfPid(game, pid));
      if (!sa || !sb) return { win: sa ? 'a' : sb ? 'b' : 'draw', why: END_PT.leftAlone };
      if (limit) return { win: pa === pb ? 'draw' : pa > pb ? 'a' : 'b', why: END_PT.time };
      return null;
    }
    const FA = forceOf(game, H.fa), FB = forceOf(game, H.fb);
    if (FA && FA.phase === 'rout' || (!FA && FB)) return { win: 'b', why: FA && FA.n > 0 ? END_PT.rout(kn(M.ka)) : END_PT.wiped(kn(M.ka)) };
    if (FB && FB.phase === 'rout' || (!FB && FA)) return { win: 'a', why: FB && FB.n > 0 ? END_PT.rout(kn(M.kb)) : END_PT.wiped(kn(M.kb)) };
    if (!FA && !FB) return { win: 'draw', why: END_PT.time };
    if (limit) { const ka = FA.n / Math.max(1, FA.n0), kb = FB.n / Math.max(1, FB.n0); return { win: Math.abs(ka - kb) < 0.02 ? 'draw' : ka > kb ? 'a' : 'b', why: END_PT.time }; }
    return null;
  }
  const s = R.settlements[M.sid];
  if (M.mode === 'siege') {
    const F = forceOf(game, H.fs);
    if (F && (F.phase === 'held' || F.sg?.captured)) return { win: 'a', why: END_PT.taken(s.name, kn(M.ka)) };
    if (!F || F.phase === 'retreat' || F.phase === 'end') return { win: 'b', why: END_PT.repelled(s.name) };
    if (limit) return { win: 'b', why: END_PT.repelled(s.name) };
    return null;
  }
  // monsters
  const V = H.wave, alive = [...H.mobs].filter((m) => !m.dead);
  if (V && V.left <= 0 && V.giants <= 0 && !alive.length) return { win: 'b', why: END_PT.wave(V.fam.pt) };
  const S = game.people?.of?.(M.sid), plaza = S?.plaza || { x: s.x, y: s.y };
  const at = alive.filter((m) => hyp(m.x, m.y, plaza.x, plaza.y) < MATCH.plazaR).length;
  let def = 0;
  const rec = game.people?.live?.get(M.sid);
  if (rec) for (const m of rec.ents.values()) if (!m.dead && m.npc.guard && hyp(m.x, m.y, plaza.x, plaza.y) < MATCH.defR) def++;
  const G = forceOf(game, H.gar);
  if (G) for (const m of G.live.values()) if (!m.dead && hyp(m.x, m.y, plaza.x, plaza.y) < MATCH.defR) def++;
  for (const [pid] of M.players) { const e = entOfPid(game, pid); if (e && !e.dead && hyp(e.x, e.y, plaza.x, plaza.y) < MATCH.defR) def++; }
  H.plazaT = at >= 3 && !def ? H.plazaT + 0.25 : Math.max(0, H.plazaT - 0.5);
  if (H.plazaT >= MATCH.overrunT) return { win: 'a', why: END_PT.overrun(s.name) };
  const g = guardsOf(game, M.sid);
  if (!g[0] && (!G || G.n <= 0) && (M.nB > 0 || g[1] > 0) && game.worldTime - M.t0 > 10) return { win: 'a', why: END_PT.fallen(s.name) };
  if (limit) return { win: 'b', why: `${s.name} resistiu até o fim da noite` };
  return null;
}
function finish(game, end, T) {
  const SK = game.skirmish, H = SK.H, st = H.st, M = st.match;
  const sc = scoreOf(game);
  put(game);
  st.score = sc;
  st.phase = 'end';
  H.endT = game.worldTime;
  st.res = {
    id: M.id, win: end.win, why: end.why, t: Math.round(T), mode: M.mode, name: M.name, ka: M.ka, kb: M.kb,
    n0: [sc.a[1], sc.b[1]], lost: [Math.max(0, sc.a[1] - sc.a[0]), Math.max(0, sc.b[1] - sc.b[0])],
    players: M.players.map(([pid, side, cls, name]) => [pid, name, side, cls, sc.kills[pid] || 0, sc.deaths[pid] || 0]),
  };
  // the battlefield stops: the lines stand, the monsters crumble a moment later when the defenders won (hostTick)
  for (const id of H.forces) { const F = forceOf(game, id); if (F && F.kind === 'battle' && F.phase !== 'rout' && F.phase !== 'won') F.hold = true; }
}

// ---------- every peer: its own player ----------
function localTick(game, dt) {
  const SK = game.skirmish, st = SK.st, L = SK.L, p = game.player;
  if (!st) return;
  // the clock stands still (a battle by day, the monsters' night) — the same on every peer
  const E = game.env, hour = st.match && st.phase !== 'lobby' ? st.match.hour : st.set?.mode === 'monsters' ? MATCH.hour.night : MATCH.hour.day;
  if (Math.abs(E.hour - hour) > 0.01) E.hour = hour;
  // the owner's rule: no cold, no hunger in a skirmish (only the fight hurts)
  if (!p.dead) {
    p.hunger = p.maxHunger || 100; p.bodyHeat = 100; p.wetT = 0;
    if (p.buffs?.length) for (const id of SURVIVAL_BAD) if (p.buffs.some((b) => b.id === id)) removeBuff(p, id);
  }
  const me = game.net.pid, M = st.match, side = sideOf(game, me);
  // in the lobby / waiting for a match nobody gets hurt (the night's wolves, a stray arrow): only the match fights
  if (!p.dead && (!side || st.phase === 'lobby' || st.phase === 'prep')) p.hp = p.maxHp;
  // a phase change: where the player stands, its kit
  const key = `${st.phase}|${M?.id || ''}`;
  if (key !== L.phase) {
    const prev = L.phase;
    L.phase = key;
    if (st.phase === 'count' && side) { toSpot(game, side, true); L.mid = M.id; }
    else if (st.phase === 'lobby' || (st.phase !== 'end' && !side)) { L.mid = null; toView(game); if (p.dead) respawnPlayer(game); heal(game); }
    if (st.phase === 'fight' && side && prev && !prev.startsWith('count')) { toSpot(game, side, true); L.mid = M.id; } // (joined at the fight's start)
  }
  // in the lobby the view follows the chosen arena
  if (st.phase === 'lobby' && st.arena) { const vk = st.arena.view.join(','); if (vk !== L.viewKey) toView(game); }
  // in the match: arrows never run out, the respawn comes by itself
  if (side && (st.phase === 'fight' || st.phase === 'count')) {
    if (p.equip?.main === 'bow_composite' && p.inv.count('arrow') < BAG.arrowLow) { p.inv.add('arrow', BAG.arrow); game.events.emit('inventory', {}); }
    if (p.dead) { if (L.deadT < 0) L.deadT = game.worldTime; if (game.worldTime - L.deadT >= MATCH.respawn) { L.deadT = -1; respawnPlayer(game); } }
    else L.deadT = -1;
  } else if (p.dead && st.phase === 'end' && L.deadT >= 0 && game.worldTime - L.deadT >= MATCH.respawn) { L.deadT = -1; respawnPlayer(game); }
}
function respawnLeft(game) {
  const L = game.skirmish.L;
  return L.deadT >= 0 ? Math.max(0, MATCH.respawn - (game.worldTime - L.deadT)) : 0;
}
// where a fallen player comes back: its side's rear
function respawnAt(game) {
  const st = ST(game), side = sideOf(game, game.net.pid);
  if (!st || !side || !st.match?.spots) return null;
  const r = side === 'a' ? st.match.spots.ra : st.match.spots.rb;
  return r ? { x: r[0] + ((game.net.pid.charCodeAt(0) % 5) - 2) * 0.7, y: r[1], where: 'retaguarda do seu lado' } : null;
}
// the player to its side's spot (beside its side's other players), with its whole kit, at full strength
function toSpot(game, side, kit) {
  const st = ST(game), M = st.match, sp = M.spots && M.spots[side];
  if (!sp) return;
  const mine = M.players.filter((q) => q[1] === side).map((q) => q[0]), j = Math.max(0, mine.indexOf(game.net.pid)), n = mine.length;
  const fx = sp[2] || 0, fy = sp[3] || 1, off = (j - (n - 1) / 2) * 1.6;
  teleport(game, sp[0] - fy * off, sp[1] + fx * off, fx, fy);
  if (kit) giveKit(game, M.players.find((q) => q[0] === game.net.pid)?.[2] || 'sword');
}
function toView(game) {
  const st = ST(game), v = st?.arena?.view;
  if (!v) return;
  game.skirmish.L.viewKey = v.join(',');
  const j = Math.max(0, (st.picks || []).findIndex((p) => p[0] === game.net.pid));
  teleport(game, v[0] + ((j % 4) - 1.5) * 1.4, v[1] + 1.5 + Math.floor(j / 4), 0, 1);
}
function teleport(game, x, y, fx = 0, fy = 1) {
  const p = game.player;
  if (p.mount) { try { game.horses?.dismount?.(p); } catch { /* ignore */ } }
  const q = solNear(game, x, y, 4) || [x, y];
  p.x = q[0]; p.y = q[1]; p.lv = 0; p.z = 0; p._fallV = 0; p._hop = null; p.moving = false; p.autoMove = null; p.work = null; p.action = null;
  p.target = null; p.autoAttack = false; game.events.emit('target', { target: null });
  if (game.ctl) game.ctl.goal = null;
  if (p.nav) { p.nav.path = null; p.nav.fails = 0; }
  p.facing = facingFrom(fx, fy, p.facing);
  game.cam.x = p.x; game.cam.y = p.y;
  // (the chunks there load: then out of anything solid)
  game.later(1.4, () => { const sp = solNear(game, p.x, p.y, 4); if (sp && Math.hypot(sp[0] - p.x, sp[1] - p.y) > 0.05) { p.x = sp[0]; p.y = sp[1]; } });
}
// the class's kit: iron armour, steel weapons, the composite bow; the bag only arrows and a few herbs
export function giveKit(game, cls) {
  const p = game.player, C = CLASSES[cls] || CLASSES.sword;
  for (let i = 0; i < p.inv.size; i++) p.inv.slots[i] = null;
  p.inv.version++;
  p.equip.main = C.main; p.equip.off = C.off; p.equip.body = C.body; p.equip.head = C.head;
  if (C.main === 'bow_composite') p.inv.add('arrow', BAG.arrow);
  p.inv.add('herb', BAG.herb);
  if (p.level !== LEVEL.player) { p.level = LEVEL.player; p.xp = 0; applyLevel(p); }
  equipChanged(game);
  game.events.emit('inventory', {});
  heal(game);
}
function heal(game) {
  const p = game.player;
  if (p.dead) return;
  removeBuff(p, 'weak');
  p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = p.maxHunger || 100; p.bodyHeat = 100;
}

// ---------- tests / debug ----------
function debugOf(game) {
  const SK = game.skirmish, H = SK.H, st = SK.st;
  const F = (id) => { const f = forceOf(game, id); return f ? { id: f.id, kind: f.kind, k: f.k, phase: f.phase, n: f.n, n0: f.n0, live: f.live ? [...f.live.values()].filter((m) => !m.dead).length : 0, hold: !!f.hold } : null; };
  return {
    phase: st?.phase, v: st?.v, match: st?.match ? { ...st.match } : null, res: st?.res || null, score: st?.score || null,
    forces: { a: F(H.fa), b: F(H.fb), siege: F(H.fs), garrison: F(H.gar) }, mobs: [...H.mobs].filter((m) => !m.dead).length,
    wave: H.wave ? { left: H.wave.left, giants: H.wave.giants, made: H.wave.made, on: H.wave.on, cap: H.wave.cap } : null,
    cap: SK.cap, plazaT: H.plazaT, prepT: H.prepT, stats: { ...H.stats, avg: H.stats.n ? +(H.stats.sum / H.stats.n).toFixed(3) : 0 },
  };
}
export { sidesOf, giantsFor };
