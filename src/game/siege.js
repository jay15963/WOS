// Siege engines (máquinas de guerra, docs/REINOS.md §5 + "Implementação — máquinas de guerra"): the trebuchet
// ("Trabuco"), the catapult ("Catapulta"), the battering ram ("Aríete") and the siege tower ("Torre de cerco"). They are
// structures (BUILDINGS, cat 'siege': blueprints with real work, hit points through o.dmg, saved / replicated like any
// structure), built with a finished Oficina de cerco (siege_workshop) within 16 tiles. Numbers: content/siege.js;
// ops: mut/siege.js; 3D: art/faces/solidSiege.js; HUD: ui/siegeUi.js; look and sound of the shots: fx/siegefx.js.
//
// Artillery (trebuchet, catapult; like the ballista, game/ballista.js): one operator (o.user). The operator's client
// turns the frame slowly toward a ground point (mouse / the attack button dragged as a stick: the angle and how far)
// and reports it (intent siege.aim → op siege.set {aim, dist}); the attack fires (intent siege.fire: the stone is paid
// from the operator's backpack, refunded on a reject; the host checks the reload) → op siege.shot (the host rolled the
// landing point: the trebuchet scatters a lot — less every shot at the same target —, the catapult a little). Every
// peer swings the arm and, at the release, flies the same stone (projectiles.js fireLob); the host's copy resolves the
// impact: area damage to creatures (catapult = the ballista's damage; trebuchet weak) and to structures (trebuchet very
// strong) — only what siegeCanDamage allows.
// Pushed engines (ram, tower): E grabs one (intent siege.push → op siege.set {push: [pid × 4 slots]}); each pusher's
// client roots its player at its slot around the engine and sends where its stick pushes (intent siege.drive: a world
// direction); the host adds the pushers up (2+ the same way = normal speed, one alone very slowly, across its length
// slower) and moves the structure a tile at a time (op siege.step → mut/structures.js relocateStructure; every peer
// slides the model there smoothly). The ram, touching a gate (BUILDINGS[type].gate, or the debug mark), strikes on
// the attack (intent siege.ram → op siege.swing + siege.dmg): it damages ONLY gates. The tower is planned with the
// height of the wall it faces (towerStoriesFor; o.v = its stories 1..3); pushed against a wall of that height it
// drops its ramp (op siege.set {ramp}): its deck becomes a surface of that story (levels.js) next to the wall-walk,
// and people climb its back ladder (E: an animated climb on the owner's client) and walk across.
//
// Shared state: o.user / o.aim / o.dist (artillery), o.push (pids by slot) / o.ramp (pushed), o.dmg + o.sdmg (siege
// damage that does not settle at dawn) — op appliers only (mut/siege.js), snapshot rows `sieg` / `sdmg`.
// Cosmetic per peer: o._aimD / o._distD (drawn aim), o._reload, o._shotT (the swing), o._swT (the ram's blow),
// o._rampK (the ramp, 0 up … 1 down), o._sl* (the slide of a step), o._roll (wheels), o._rng (ranging, for the HUD).

import { BUILDINGS } from './data.js';
import { ARTY, PUSH, SIEGE_HP, HP_WOOD, HP_STONE, HP_GATE_WOOD, HP_GATE_STONE, WORKSHOP, WORKSHOP_R, PUSH_REACH, PUSH_SLOTS, isEngine, pushSpeed, scatterOf, flightOf } from './content/siege.js';
import { dealDamage, isMob } from './combat.js';
import { allPlayers } from './players.js';
import { facingFrom, collides } from './physics.js';
import { MAX_LV, STORY_H } from './levels.js';
import { fireLob } from './projectiles.js';
import { placeReason } from './mut/structures.js';

export { ARTY, PUSH } from './content/siege.js';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const ROT_ANG = [Math.PI / 2, Math.PI, -Math.PI / 2, 0]; // rot 0..3 = front S, W, N, E (world angle)
export const DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]];   // world direction index (= rot of the front): S, W, N, E

// ---------- what is what ----------
export const isEngineObj = (o) => !!o && o.building && !o.removed && isEngine(o.type);
export const isArtyObj = (o) => !!o && o.building && !o.removed && !!ARTY[o.type];
export const isPushObj = (o) => !!o && o.building && !o.removed && !!PUSH[o.type];
export function engineOf(game, id) { const o = game.world.objById.get(id); return isEngineObj(o) ? o : null; }
// the siege engines of the world (cached until the structures change: game.build.v)
export function enginesOf(game) {
  const c = game._sgList, v = game.build.v;
  if (c && c.v === v) return c.L;
  const L = game.build.structures.filter((o) => isEngine(o.type) && !o.removed);
  game._sgList = { v, L };
  return L;
}
export const towerN = (o) => clamp(o?.v | 0 || 1, 1, MAX_LV); // a siege tower's stories (its deck's story)
// the player entity of a pid on this peer (host: avatars; any peer: the local player)
export function playerByPid(game, pid) {
  if (!pid) return null;
  for (const q of allPlayers(game)) if ((q === game.player ? game.net.pid : q.pid) === pid) return q;
  return null;
}
const pidOf = (game, e) => (e === game.player ? game.net.pid : e?.pid || null);

// ---------- the damage permission (ONE place; phase 3 diplomacy plugs in here) ----------
// siegeCanDamage(game, attacker, target) → may a siege engine hurt `target`?
//   attacker: the engine structure (o) or { realm, pid } — a kingdom's engine carries o.realm (phase 3), a player's none
//   target:   a structure (o.building), a world prop (a bandit camp crate: isProp), or an entity (creature / player)
// Phase 1 rules (docs/REINOS.md §4 "sem fogo amigo"; no kingdoms at war yet):
//   - players: never · players' structures: never (no PvP structure damage yet)
//   - settlement / kingdom structures (o.realm / o.kingdom / o.settle, game/… of the kingdoms agent): only when their
//     realm is an ENEMY of the attacker's — asked to game.realms.atWar(a, b) when it exists (phase 3); never now
//   - monsters, bandits, wild creatures (not farm animals, pets or tamed horses): yes · bandit camp crates: yes
//   - debug / tests: siegeDebug(game).hostile (structure ids treated as enemy) — host side
export function siegeDebug(game) { return game._siegeDbg || (game._siegeDbg = { hostile: new Set(), gates: new Set() }); }
export const realmOf = (x) => (x ? x.realm ?? x.kingdom ?? x.settle ?? null : null);
export function siegeCanDamage(game, attacker, target) {
  if (!target || target.removed || target.dead) return false;
  if (target.isEntity) {
    if (target === game.player || target.avatar || target.remote || (target.kind === 'pawn' && !target.isMob)) return false; // (players: never)
    if (!isMob(target)) return false;
    if (target.faction === 'friend' || target.owned || target.tame || target.tiedTo || target.saddle) return false; // (pets, the farm's animals, horses)
    return true;
  }
  if (target.isProp) return !target.dummy && !target.broken; // (bandit camp crates; never a training dummy)
  if (target.building) {
    if (siegeDebug(game).hostile.has(target.id)) return true;
    const tr = realmOf(target);
    if (tr != null) {
      const ar = realmOf(attacker);
      return !!(ar != null && ar !== tr && game.realms?.atWar?.(ar, tr)); // (phase 3: kingdoms at war)
    }
    if (target.camp || target.bandit) return true; // (a bandit camp's own structures, if any)
    return false; // (a player's structure)
  }
  return false;
}
// a gate: what the battering ram breaks (BUILDINGS[type].gate — the kingdoms' Portão de madeira / de pedra; tests mark
// any piece with siegeDebug(game).gates)
export const isGate = (game, o) => !!o && !o.removed && (!!BUILDINGS[o.type]?.gate || siegeDebug(game).gates.has(o.id));
// siege hit points of a structure (o.dmg = damage / hp)
export function structHp(game, o) {
  const def = BUILDINGS[o.type] || {};
  if (def.siegeHp) return def.siegeHp;
  if (def.hp) return def.hp;
  if (SIEGE_HP[o.type]) return SIEGE_HP[o.type];
  const stone = def.mat === 'stone' || /stone/.test(o.type) || !!def.cost?.stone_block;
  if (isGate(game, o)) return stone ? HP_GATE_STONE : HP_GATE_WOOD;
  return stone ? HP_STONE : HP_WOOD;
}
// host: siege damage to a structure (op siege.dmg: cracks on every peer, persistent; at full damage it breaks apart)
export function damageStructure(game, o, amount, x, y) {
  if (!o || o.removed || o.blueprint || !(amount > 0) || game.creative) return 0;
  const d = Math.min(1, (o.dmg || 0) + amount / structHp(game, o));
  game.net.emit('siege.dmg', { id: o.id, d: +d.toFixed(4), x: +x.toFixed(2), y: +y.toFixed(2) });
  if (d >= 1) game.net.emit('struct.remove', { id: o.id, fx: 'smash' });
  return d;
}

// ---------- the height of a wall (the siege AI uses it too: "a IA mede a muralha") ----------
const isWallTop = (def) => !!def && def.connect === 'wall' && (def.block === 'tile' || def.block === 'door');
// the story of the top of the wall at tile (tx, ty): stacked wall / door pieces from the ground up (0 = no wall there)
export function wallTopStory(game, tx, ty, planned = false) {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return 0;
  const N = w.W * w.H, i = w.idx(tx, ty), G = game.build.grid.main;
  let k = 0;
  while (k < MAX_LV) {
    const o = G.get(i + k * N);
    if (!o || o.moveOf || (!planned && o.blueprint) || !isWallTop(BUILDINGS[o.type])) break;
    k++;
  }
  return k;
}
// towerStoriesFor(game, target) → how many stories a siege tower needs to put its ramp on that wall's top (1..MAX_LV),
// 0 = no wall. target: a wall / gate structure, a tile [tx, ty] or {tx, ty}, or a list of those (the tallest).
export function towerStoriesFor(game, target, { planned = false } = {}) {
  if (!target) return 0;
  if (Array.isArray(target) && (Array.isArray(target[0]) || (target[0] && typeof target[0] === 'object'))) {
    let n = 0;
    for (const t of target) n = Math.max(n, towerStoriesFor(game, t, { planned }));
    return n;
  }
  let tiles;
  if (Array.isArray(target)) tiles = [[target[0] | 0, target[1] | 0]];
  else if (target.building) { tiles = []; for (let y = target.ty; y < target.ty + (target.fh || 1); y++) for (let x = target.tx; x < target.tx + (target.fw || 1); x++) tiles.push([x, y]); }
  else tiles = [[target.tx | 0, target.ty | 0]];
  let n = 0;
  for (const [x, y] of tiles) n = Math.max(n, wallTopStory(game, x, y, planned));
  return Math.min(MAX_LV, n);
}
// the wall a tower blueprint at (tx, ty, rot) faces: the first wall within `far` tiles straight ahead of its front →
// { n: stories, d: tiles away } | null (the build preview's automatic height)
export function towerAhead(game, tx, ty, rot, far = 40) {
  const [w0, h0] = BUILDINGS.siege_tower.size, r = rot & 3, fw = r & 1 ? h0 : w0, fh = r & 1 ? w0 : h0;
  const [dx, dy] = DIR[r];
  for (let d = 1; d <= far; d++) {
    let n = 0;
    for (let k = 0; k < (dx ? fh : fw); k++) {
      const x = dx ? (dx > 0 ? tx + fw - 1 + d : tx - d) : tx + k, y = dy ? (dy > 0 ? ty + fh - 1 + d : ty - d) : ty + k;
      n = Math.max(n, wallTopStory(game, x, y, true));
    }
    if (n) return { n: Math.min(MAX_LV, n), d };
  }
  return null;
}

// ---------- the Oficina de cerco ----------
export function nearWorkshop(game, type, tx, ty, rot) {
  const def = BUILDINGS[type], [w0, h0] = def.size || [1, 1], [fw, fh] = def.rotate && (rot & 1) ? [h0, w0] : [w0, h0];
  const cx = tx + fw / 2, cy = ty + fh / 2;
  for (const o of game.build.structures) {
    if (o.type !== WORKSHOP || o.blueprint || o.removed) continue;
    if (Math.hypot(game.world.dx ? game.world.dx(o.tx + o.fw / 2, cx) : o.tx + o.fw / 2 - cx, o.ty + o.fh / 2 - cy) <= WORKSHOP_R) return true;
  }
  return false;
}
// placement rule of an engine (mut/structures.js placeReason hook): null = ok
export function siegePlaceReason(game, type, tx, ty, rot, lv, ignore) {
  if (ignore) return null; // (moving one: build.move / a step)
  if (PUSH[type] || type === 'trebuchet') { if (lv > 0) return 'Só no chão'; }
  if (!nearWorkshop(game, type, tx, ty, rot)) return 'Construa perto de uma Oficina de cerco pronta (até 16 tiles)';
  return null;
}

// ---------- geometry ----------
export const bodyOf = (o) => [o.tx + (o.fw || 1) / 2, o.ty + (o.fh || 1) / 2];
export const frontAng = (o) => ROT_ANG[o.rot & 3];
// local (x across, y toward the front, tiles from the body centre) → world, with the drawn slide of a step
export function toWorld(o, lx, ly, slide = true) {
  const [cx, cy] = bodyOf(o), a = (o.rot & 3) * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
  const sx = slide ? slideOf(o) : null;
  return [cx + c * lx - s * ly + (sx ? sx[0] : 0), cy + s * lx + c * ly + (sx ? sx[1] : 0)];
}
// the offset still to slide (cosmetic: a step moves the structure at once, the model glides there)
const SL = [0, 0];
export function slideOf(o) {
  if (!(o._slT > 0) || !(o._slD > 0)) { SL[0] = SL[1] = 0; return SL; }
  const k = o._slT / o._slD;
  SL[0] = o._slx * k; SL[1] = o._sly * k;
  return SL;
}
// the row of tiles just in front of a pushed engine's footprint
export function frontTiles(o) {
  const [dx, dy] = DIR[o.rot & 3], out = [], fw = o.fw || 1, fh = o.fh || 1;
  if (dx) { const x = dx > 0 ? o.tx + fw : o.tx - 1; for (let y = o.ty; y < o.ty + fh; y++) out.push([x, y]); }
  else { const y = dy > 0 ? o.ty + fh : o.ty - 1; for (let x = o.tx; x < o.tx + fw; x++) out.push([x, y]); }
  return out;
}
// local size [across, along] of an engine (its footprint at rot 0)
export const sizeOf = (o) => BUILDINGS[o.type]?.size || [1, 1];
// pusher slot k (0, 1 at the back, 2, 3 on the sides near the back) in local coordinates
export function slotLocal(o, k) {
  const [W, D] = sizeOf(o);
  if (k === 0) return [-0.48, -(D / 2 + 0.42)];
  if (k === 1) return [0.48, -(D / 2 + 0.42)];
  if (k === 2) return [-(W / 2 + 0.42), -D / 2 + 0.45];
  return [W / 2 + 0.42, -D / 2 + 0.45];
}
// the tower's ladder (behind its back face) and the deck spot it leads to
export const ladderLocal = (o) => [0, -(sizeOf(o)[1] / 2 + 0.32)];
export const deckLocal = (o) => [0, -sizeOf(o)[1] / 2 + 0.5];
// distance from a point to an engine's footprint
export function footDist(o, x, y) {
  const dx = Math.max(o.tx - x, 0, x - (o.tx + (o.fw || 1))), dy = Math.max(o.ty - y, 0, y - (o.ty + (o.fh || 1)));
  return Math.hypot(dx, dy);
}

// artillery: the turning axis, the aim (world angle), how far (tiles), the operator's seat
export const pivotOf = (o) => bodyOf(o);
export const aimOf = (o) => (Number.isFinite(o.aim) ? o.aim : frontAng(o));
export function distOf(o) { const S = ARTY[o.type]; return S ? clamp(Number.isFinite(o.dist) ? o.dist : (S.range[0] + S.range[1]) / 2, S.range[0], S.range[1]) : 0; }
export function seatOf(o, a) { const [x, y] = pivotOf(o), d = ARTY[o.type]?.seat || 1; return [x - Math.cos(a) * d, y - Math.sin(a) * d]; }
const AROUND = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8];
export function seatSpot(game, o, a, r = 0.24) {
  const lv = o.lv | 0, L = game.levels, [px, py] = pivotOf(o), S = ARTY[o.type];
  if (!lv || !L) return seatOf(o, a);
  for (const off of AROUND) for (const d of [S.seat, S.seat + 0.25, 0.9]) {
    const b = a + Math.PI + off, x = px + Math.cos(b) * d, y = py + Math.sin(b) * d;
    if (!L.collidesL(lv, x, y, r, false, false, -1)) return [x, y];
  }
  return null;
}
// where the stone leaves the frame (its ground point) for an aim angle
export function releaseOf(o, a) { const [x, y] = pivotOf(o), k = o.type === 'trebuchet' ? 0.5 : 0.35; return [x + Math.cos(a) * k, y + Math.sin(a) * k]; }
// the scatter factor of the next shot at (x, y) (the crew ranges in on the same target): o._rng from the last shot
export function rangingK(o, x, y) {
  const S = ARTY[o.type], R = o._rng;
  if (!S || !R || Math.hypot(R.x - x, R.y - y) > S.same) return 1;
  return Math.max(S.settleMin, R.k * S.settle);
}

// ---------- interaction (building.js describeStructure / useStructure) ----------
export function siegeIt(game, o) {
  const me = game.net.pid, p = game.player, def = BUILDINGS[o.type];
  if (ARTY[o.type]) {
    const mine = o.user && o.user === me;
    return { kind: 'siege_op', verb: mine ? 'Sair' : 'Operar', icon: mine ? 'close' : 'shoot', prio: mine ? 9 : 3, use: true, reach: mine ? 4 : def.size[0] > 1 ? 1.4 : 1.6 };
  }
  if (o.type === 'siege_tower') {
    const n = towerN(o), up = (p.z || 0) > n - 0.5;
    if (up) return { kind: 'siege_down', verb: 'Descer da torre', icon: 'hand', prio: 6, use: true, lvAny: true, reach: 1.2 };
    const pushing = (o.push || []).includes(me);
    const push = { kind: 'siege_push', verb: pushing ? 'Soltar' : 'Empurrar', icon: pushing ? 'close' : 'hand', prio: pushing ? 9 : 3, use: true, reach: pushing ? 4 : 1.2 };
    if (o.ramp && !pushing) return { kind: 'siege_up', verb: 'Subir na torre', icon: 'hand', prio: 5, use: true, reach: 1.2, alt: push };
    return push;
  }
  const pushing = (o.push || []).includes(me);
  return { kind: 'siege_push', verb: pushing ? 'Soltar' : 'Empurrar', icon: pushing ? 'close' : 'hand', prio: pushing ? 9 : 3, use: true, reach: pushing ? 4 : 1.2 };
}
const HINT = {
  trebuchet: ['Trabuco: mire com o mouse (longe = mais força), Espaço ou clique atira · a mira é ruim: atirando no mesmo alvo ela melhora · E sai', 'Trabuco: arraste o botão de ataque para mirar (direção e distância), solte para atirar · a mira melhora no mesmo alvo'],
  catapult: ['Catapulta: mire com o mouse, Espaço ou clique atira (dano em área) · E sai', 'Catapulta: arraste o botão de ataque para mirar (direção e distância), solte para atirar'],
  battering_ram: ['Aríete: empurre com as setas / WASD (2 ou mais pessoas: velocidade normal) · encostado num portão inimigo, Espaço dá a pancada · E solta', 'Aríete: empurre com o direcional (2+ pessoas: velocidade normal) · encostado num portão inimigo, o ataque dá a pancada'],
  siege_tower: ['Torre de cerco: empurre até encostar na muralha (2+ pessoas); a rampa desce sozinha e a escada de trás leva ao topo (E) · E solta', 'Torre de cerco: empurre até encostar na muralha (2+ pessoas); a rampa desce sozinha e a escada de trás leva ao topo'],
};
function hintOnce(game, type) {
  const h = game.ctl?.hinted;
  if (!h || h['siege_' + type]) return;
  h['siege_' + type] = true; // sync-ok: local hint flag (player save), not shared state
  const L = HINT[type];
  if (L) game.events.emit('toast', { text: game.input?.isTouch ? L[1] : L[0], kind: 'info' });
}
export function useSiege(game, it) {
  const o = it.o, p = game.player, me = game.net.pid;
  if (p.dead || !isEngineObj(o)) return;
  const rej = (why) => { if (why) game.events.emit('error', { text: why }); };
  switch (it.kind) {
    case 'siege_op':
      if (o.user === me) { game.net.request('siege.use', { id: o.id, on: 0 }); return; }
      game.net.request('siege.use', { id: o.id, on: 1 }, { onOk: () => hintOnce(game, o.type), onReject: rej });
      return;
    case 'siege_push':
      if ((o.push || []).includes(me)) { game.net.request('siege.push', { id: o.id, on: 0 }); return; }
      game.net.request('siege.push', { id: o.id, on: 1 }, { onOk: () => hintOnce(game, o.type), onReject: rej });
      return;
    case 'siege_up': climbStart(game, o, true); return;
    case 'siege_down': climbStart(game, o, false); return;
  }
}

// ---------- the tower's ladder (owner side: an animated climb, then the deck / the ground) ----------
function climbStart(game, o, up) {
  const p = game.player, C = siegeCtl(game);
  if (C.climb) return;
  if (!o.ramp) { game.events.emit('error', { text: 'A rampa ainda não desceu: encoste a torre numa muralha da mesma altura' }); return; }
  const n = towerN(o), [lx, ly] = toWorld(o, ...ladderLocal(o), false);
  if (up && Math.hypot(lx - p.x, ly - p.y) > 2.2) { game.events.emit('error', { text: 'A escada fica atrás da torre' }); return; }
  if (up && (p.z || 0) > 0.3) return;
  p.work = null; p.action = null; p.autoMove = null;
  if (game.ctl) game.ctl.goal = null;
  C.climb = { o, up, t: 0, dur: PUSH.siege_tower.climb * n, n, x0: p.x, y0: p.y };
  game.audio?.play('step_stairs', { x: p.x, y: p.y, volume: 0.6 });
  if (up) hintOnce(game, 'siege_tower');
}
function climbStep(game, C, dt) {
  const K = C.climb, p = game.player, o = K.o;
  if (p.dead || !isPushObj(o)) { C.climb = null; return; }
  K.t += dt;
  const k = Math.min(1, K.t / K.dur), [lx, ly] = toWorld(o, ...ladderLocal(o), false);
  p.rooted = true; p._fallV = 0; p._hop = null;
  p.facing = facingFrom(Math.cos(frontAng(o)), Math.sin(frontAng(o)), p.facing);
  if (K.up) {
    if (K.t < 0.25) { p.x = K.x0 + (lx - K.x0) * (K.t / 0.25); p.y = K.y0 + (ly - K.y0) * (K.t / 0.25); }
    else { p.x = lx; p.y = ly; }
    p.lv = 0; p.z = K.n * Math.max(0, (K.t - 0.25) / Math.max(0.1, K.dur - 0.25));
    if (k >= 1) {
      const [dx, dy] = toWorld(o, ...deckLocal(o), false);
      p.x = dx; p.y = dy; p.lv = K.n; p.z = K.n; C.climb = null;
      if (!o.ramp) { p.lv = 0; p.z = 0; p.x = lx; p.y = ly; } // (the ramp went up meanwhile: back down)
    }
  } else {
    p.x = lx; p.y = ly; p.lv = 0; p.z = K.n * (1 - k);
    if (k >= 1) { p.z = 0; C.climb = null; }
  }
  if (Math.floor(K.t * 5) !== Math.floor((K.t - dt) * 5)) game.audio?.play('step_stairs', { x: p.x, y: p.y, volume: 0.35 });
}

// ---------- host: an impact (the stone landed at pr.lx, pr.ly) ----------
export function siegeImpact(game, sh) {
  const S = ARTY[sh.type];
  if (!S || !game.net.auth) return;
  const x = sh.x, y = sh.y, att = sh.o || { realm: null };
  const zi = wallTopStory(game, Math.floor(x), Math.floor(y)); // (it hit a wall: on its top)
  const src = playerByPid(game, sh.by);
  // creatures in the blast (the catapult: the ballista's damage; the trebuchet: weak)
  for (const e of game.entities) {
    if (!isMob(e) || e.dead || e.proxy) continue;
    const r = S.area + (e.r || 0.3) * (e.scale || 1) * 0.6;
    if (Math.hypot(e.x - x, e.y - y) > r || Math.abs((e.z || 0) - zi) > 1.6) continue;
    if (!siegeCanDamage(game, att, e)) continue;
    const giant = e.species === 'giant';
    const amount = giant ? Math.ceil(e.maxHp * S.giantK) : S.mobMin ? Math.max(S.mob, Math.ceil(e.maxHp * 1.01)) : S.mob;
    dealDamage(game, src && !src.dead ? src : (src || e), e, amount, { pure: true, ranged: true, ability: sh.type, from: { x, y }, knock: e.heavy ? 0.4 : 1.2, crit: S.mobMin });
  }
  // structures in reach (full at the impact, half at the edge) — only what may be hurt (never a player's)
  const R = S.sarea;
  for (const o of game.build.structures.slice()) {
    if (o.removed || o.blueprint || o === sh.o) continue;
    const d = footDist(o, x, y);
    if (d > R) continue;
    if (!siegeCanDamage(game, att, o)) continue;
    damageStructure(game, o, S.sdmg * (1 - 0.5 * (d / R)), x, y);
  }
  // bandit camp crates
  for (const o of game.props || []) {
    if (!o || o.broken || o.dummy || Math.hypot(o.x - x, o.y - y) > S.area + 0.4) continue;
    if (!siegeCanDamage(game, att, o)) continue;
    game.net.emit('prop.set', { id: o.id, hp: 0, broken: 1, at: Math.round(game.worldTime), hit: 1, by: sh.by || undefined });
    game.siegeHooks?.crateBreak?.(game, o, src);
  }
}
export function shotLanding(game, o, a, d) {
  // host: where a shot aimed at (a, d) lands (the scatter rolled with net.roll) and its ranging factor
  const S = ARTY[o.type], [px, py] = pivotOf(o), dd = clamp(d, S.range[0], S.range[1]);
  const tx = px + Math.cos(a) * dd, ty = py + Math.sin(a) * dd, k = rangingK(o, tx, ty);
  const [sL, sW] = scatterOf(S, dd, k), r = Math.sqrt(game.net.roll()), th = game.net.roll() * TAU;
  const al = Math.cos(th) * r * sL, ac = Math.sin(th) * r * sW;
  return { tx, ty, k, lx: tx + Math.cos(a) * al - Math.sin(a) * ac, ly: ty + Math.sin(a) * al + Math.cos(a) * ac };
}
// every peer: the stone leaves the sling / cup (op siege.shot, after the swing) — the host's copy resolves the impact
export function launchStone(game, o, a) {
  const S = ARTY[a.type];
  if (!S) return;
  const pr = fireLob(game, { id: a.sid, proj: a.type === 'trebuchet' ? 'treb_stone' : 'cat_stone', cosmetic: !game.net.auth, x: a.x, y: a.y, lx: a.lx, ly: a.ly, dur: a.dur, apex: a.apex, owner: a.by || null,
    onLand: game.net.auth ? (g, q) => siegeImpact(g, { type: a.type, o: isEngineObj(o) ? o : null, by: a.by, x: q.lx, y: q.ly }) : null });
  pr.lift0 = (o?.lv | 0) * STORY_H; // (from a wall top: the arc starts a story up)
  pr.h0 = S.h0 + pr.lift0;
  pr.lift = pr.h0;
  return pr;
}

// ---------- host: pushed engines ----------
// where the pushers push: the dominant world direction (opposite pushes cancel) and how many push that way
function tally(o) {
  const D = o._drive, cnt = [0, 0, 0, 0];
  if (!D) return null;
  for (const pid of o.push || []) { if (!pid) continue; const d = D.get(pid); if (d >= 0 && d < 4) cnt[d]++; }
  let best = -1, bn = 0;
  for (let d = 0; d < 4; d++) { const n = cnt[d] - cnt[(d + 2) % 4]; if (n > bn) { bn = n; best = d; } }
  return best < 0 ? null : { d: best, n: bn };
}
export const crewOf = (o) => (o.push || []).filter(Boolean).length;
// can the engine take its next step toward world direction d? (null = yes, else why not)
export function stepReason(game, o, d) {
  const [dx, dy] = DIR[d], tx = o.tx + dx, ty = o.ty + dy;
  const r = placeReason(game, o.type, tx, ty, null, o.rot | 0, o, 0);
  if (r) return typeof r === 'string' ? r : 'Algo no caminho';
  if (game.world.hasHeight) { // (terrain: not up a cliff / a too steep climb)
    const [cx, cy] = bodyOf(o), w = game.world;
    if (Math.abs(w.heightAt(cx + dx, cy + dy) - w.heightAt(cx, cy)) > 0.7) return 'Íngreme demais';
  }
  return null;
}
function msgCrew(game, o, text, key) {
  const now = game.worldTime;
  o._msg ||= {};
  if (o._msg[key] && now - o._msg[key] < 6) return;
  o._msg[key] = now;
  for (const pid of o.push || []) if (pid) game.net.toOwner(pid, 'siege.msg', { text, kind: 'warn' });
}
// the tower against a wall: { n (the wall's top story), ok (same as the tower's) } | null
export function towerTouch(game, o) {
  if (o.type !== 'siege_tower') return null;
  let n = 0;
  for (const [x, y] of frontTiles(o)) n = Math.max(n, wallTopStory(game, x, y));
  return n ? { n, ok: n === towerN(o) } : null;
}
// people up on a tower's deck (nobody may push it away or raise its ramp under them)
export function onDeck(game, o) {
  const n = towerN(o);
  for (const q of allPlayers(game)) {
    if (q.dead || Math.abs((q.z || 0) - n) > 0.5) continue;
    if (q.x > o.tx - 0.05 && q.x < o.tx + o.fw + 0.05 && q.y > o.ty - 0.05 && q.y < o.ty + o.fh + 0.05) return true;
  }
  return false;
}
function hostPush(game, o, dt) {
  const T = tally(o), mv = o._mv;
  if (o.type === 'siege_tower') {
    if (o.ramp && T) {
      // pushed while the ramp is down: up with it first (never under someone on the deck); pushed into the wall it
      // leans on: it stays (the ramp stays down)
      if (stepReason(game, o, T.d)) return;
      if (onDeck(game, o)) { msgCrew(game, o, 'Tem gente em cima da torre: desçam antes de empurrar', 'deck'); return; }
      game.net.emit('siege.set', { id: o.id, ramp: 0 });
      o._rampUpT = game.worldTime;
      return;
    }
    if (o._rampUpT && game.worldTime - o._rampUpT < PUSH.siege_tower.ramp) return; // (the ramp is still going up)
  }
  if (!T) {
    o._mv = null;
    if (o.type === 'siege_tower' && !o.ramp) dock(game, o);
    return;
  }
  const across = (T.d & 1) !== ((o.rot | 0) & 1), v = pushSpeed(o.type, T.n, across);
  if (!mv || mv.d !== T.d) o._mv = { d: T.d, k: 1, tryT: 0 };
  const M = o._mv;
  if (M.k < 1) { M.k += v * dt; return; }
  M.tryT -= dt;
  if (M.tryT > 0) return;
  const why = stepReason(game, o, T.d);
  if (why) {
    M.tryT = 0.25;
    if (o.type === 'siege_tower' && dock(game, o)) return;
    msgCrew(game, o, why === 'exists' ? 'Algo no caminho' : why, 'block');
    return;
  }
  const [dx, dy] = DIR[T.d];
  game.net.emit('siege.step', { id: o.id, tx: o.tx + dx, ty: o.ty + dy, dur: +Math.min(4, 1 / Math.max(0.05, v)).toFixed(3) });
  M.k = 0;
}
// host: a tower touching a wall drops its ramp when the heights match (else tells the crew)
function dock(game, o) {
  const t = towerTouch(game, o);
  if (!t) return false;
  if (!t.ok) { msgCrew(game, o, `Esta muralha tem ${t.n} ${t.n > 1 ? 'andares' : 'andar'}; a torre tem ${towerN(o)}`, 'height'); return false; }
  game.net.emit('siege.set', { id: o.id, ramp: 1 });
  return true;
}

// ---------- systems ----------
// every peer: drawn aim easing, reload, swing / ramp / slide timers, operators and pushers posed; host: engines moved,
// operators / pushers gone taken off
export function siegeSystem() {
  let slowT = 0;
  return {
    sync: 'all',
    update(game, dt) {
      const C = siegeCtl(game), me = game.net.pid;
      const OPS = game._opEnts || (game._opEnts = []); // (shared with the ballista: art/compose.js 'operate' pose)
      const v = game.view?.() || null;
      for (const o of enginesOf(game)) {
        if (o.removed) continue;
        if (o._reload > 0) o._reload = Math.max(0, o._reload - dt);
        if (o._slT > 0) { o._slT = Math.max(0, o._slT - dt); o._roll = (o._roll || 0) + (Math.hypot(o._slx, o._sly) / Math.max(0.05, o._slD)) * dt; }
        if (o.shake > 0) o.shake = Math.max(0, o.shake - dt * 3);
        if (PUSH[o.type]) {
          const want = o.ramp ? 1 : 0, rk = o._rampK ?? want;
          o._rampK = rk + clamp(want - rk, -dt / PUSH.siege_tower.ramp, dt / PUSH.siege_tower.ramp);
          for (const pid of o.push || []) {
            if (!pid) continue;
            const e = pid === me ? game.player : game.session?.players?.get(pid)?.ent;
            if (e && !e.dead) { e._opA = frontAng(o); OPS.push(e); }
          }
          continue;
        }
        if (o.user) {
          const e = o.user === me ? game.player : game.session?.players?.get(o.user)?.ent;
          if (e && !e.dead) { e._opA = Number.isFinite(o._aimD) ? o._aimD : aimOf(o); OPS.push(e); }
        }
        if (o === C.o) continue; // (the operator draws its own aim)
        const want = aimOf(o), wd = distOf(o);
        if (v && (o.x < v.x0 - 6 || o.x > v.x1 + 6 || o.y < v.y0 - 6 || o.y > v.y1 + 8)) { o._aimD = want; o._distD = wd; continue; }
        if (o._aimD == null) o._aimD = want;
        else { const d = angDiff(want, o._aimD); o._aimD = Math.abs(d) < 1e-3 ? want : o._aimD + d * Math.min(1, dt * 6); }
        o._distD = wd;
      }
      if (!game.net.auth) return;
      for (const o of enginesOf(game)) if (PUSH[o.type] && !o.removed && !o.blueprint && (o.push || []).some(Boolean)) hostPush(game, o, dt);
      slowT -= dt;
      if (slowT > 0) return;
      slowT = 0.5;
      for (const o of enginesOf(game).slice()) {
        if (o.user) {
          const q = playerByPid(game, o.user), [px, py] = pivotOf(o);
          if (o.removed || o.blueprint || !q || q.dead || Math.hypot(q.x - px, q.y - py) > ARTY[o.type].reach + 2 || Math.abs((q.z || 0) - (o.lv | 0)) > 0.75) game.net.emit('siege.set', { id: o.id, user: 0 });
        }
        if ((o.push || []).some(Boolean)) {
          const L = o.push.slice();
          let ch = false;
          for (let k = 0; k < L.length; k++) {
            const pid = L[k];
            if (!pid) continue;
            const q = playerByPid(game, pid);
            if (!q || q.dead || (q.z || 0) > 0.5 || footDist(o, q.x, q.y) > PUSH_REACH + 2.2) { L[k] = 0; ch = true; o._drive?.delete(pid); }
          }
          if (ch || o.removed || o.blueprint) game.net.emit('siege.set', { id: o.id, push: o.removed || o.blueprint ? [] : L });
        }
      }
    },
  };
}

// the local operator / pusher / climber
export function siegeOwnerSystem() {
  return {
    sync: 'owner',
    update(game, dt) {
      const C = siegeCtl(game), p = game.player;
      if (C.climb) { climbStep(game, C, dt); return; }
      const o = myArty(game), q = o ? null : myPush(game);
      C.o = o; C.push = q;
      if (!o && !q) {
        if (C.was) { C.was = null; C.pending = null; C.stickOn = false; C.lastD = -2; game.events.emit('siege', { on: false }); }
        return;
      }
      const cur = o || q;
      if (C.was !== cur) {
        C.was = cur; C.lastD = -2; C.sendT = 0;
        if (o) { C.aimL = Number.isFinite(o._aimD) ? o._aimD : aimOf(o); C.want = C.aimL; C.sent = C.aimL; C.distL = distOf(o); C.wantD = C.distL; C.sentD = C.distL; C.cd = 0; }
        p.autoAttack = false; game.ctl?.setTarget?.(null);
        if (game.ctl) game.ctl.goal = null;
        game.events.emit('siege', { on: true, o: cur, kind: o ? 'arty' : 'push' });
      }
      if (p.dead) { if (o) game.net.request('siege.use', { id: o.id, on: 0 }); else game.net.request('siege.push', { id: q.id, on: 0 }); return; }
      p.rooted = true; // (abilities.js resets it every frame before this runs)
      if (p.work) { p.work = null; p.action = null; }
      p.swingT = Math.max(p.swingT || 0, 0.2); // (no auto attack meanwhile)
      if (o) operate(game, C, o, p, dt);
      else push(game, C, q, p, dt);
    },
  };
}
function operate(game, C, o, p, dt) {
  const S = ARTY[o.type];
  const want = C.wantAim();
  if (want) { C.want = want[0]; C.wantD = want[1]; }
  const d = angDiff(C.want, C.aimL), rate = Math.min(S.turn, Math.max(0.08, Math.abs(d) * 3));
  C.aimL += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  C.turning = Math.abs(d) > 0.004;
  C.distL = clamp(C.wantD, S.range[0], S.range[1]);
  o._aimD = C.aimL; o._distD = C.distL;
  C.sendT -= dt;
  if ((Math.abs(angDiff(C.aimL, C.sent)) > 0.005 || Math.abs(C.distL - C.sentD) > 0.2) && (C.sendT <= 0 || !C.turning)) {
    C.sent = C.aimL; C.sentD = C.distL; C.sendT = 1 / 6;
    game.net.request('siege.aim', { id: o.id, a: +C.aimL.toFixed(4), d: +C.distL.toFixed(2) });
  }
  // stand at the winch behind it, facing where it points (up a story: where there is floor)
  const pr = p.r || 0.24, lv = o.lv | 0, L = lv ? game.levels : null;
  const seat = seatSpot(game, o, C.aimL, pr);
  if (seat) {
    const ds = Math.hypot(seat[0] - p.x, seat[1] - p.y);
    if (ds > 0.002) {
      const [sx, sy] = seat, k = ds > 0.6 ? 1 : Math.min(1, dt * 10), nx = p.x + (sx - p.x) * k, ny = p.y + (sy - p.y) * k;
      const blocked = (x, y) => (L ? L.collidesL(lv, x, y, pr, false, false, -1) : collides(game.world, x, y, pr, null, false));
      if (!blocked(nx, ny)) { p.x = nx; p.y = ny; } else if (!blocked(sx, sy)) { p.x = sx; p.y = sy; }
    }
  }
  p.facing = facingFrom(Math.cos(C.aimL), Math.sin(C.aimL), p.facing);
  p._faceLockT = Math.max(p._faceLockT || 0, 0.1);
  C.cd = Math.max(0, C.cd - dt);
  const P = C.pending;
  if (P) { P.t += dt; if (Math.abs(angDiff(C.want, C.aimL)) < 0.03 || P.t > 4) { C.pending = null; C.fire(); } }
}
function push(game, C, o, p, dt) {
  const k = (o.push || []).indexOf(game.net.pid);
  if (k < 0) return;
  // the stick / keys → a world direction (snapped to the 4 ways, the engine's length first)
  let [mx, my] = game.input.move ? game.input.move() : [0, 0];
  if (mx || my) [mx, my] = game.toWorldDir(mx, my);
  let d = -1;
  if (Math.hypot(mx, my) > 0.3) {
    const a = Math.atan2(my, mx), f = frontAng(o);
    const along = Math.abs(angDiff(a, f)) < Math.PI * 0.32 ? 0 : Math.abs(angDiff(a, f + Math.PI)) < Math.PI * 0.32 ? 2 : -1;
    if (along >= 0) d = ((o.rot & 3) + along) & 3;
    else d = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 3 : 1) : (my > 0 ? 0 : 2);
  }
  C.sendT -= dt;
  if (d !== C.lastD || (d >= 0 && C.sendT <= 0)) { C.lastD = d; C.sendT = 1; game.net.request('siege.drive', { id: o.id, d }); }
  C.dir = d;
  // stand at the slot, following the model as it slides
  const [sx, sy] = toWorld(o, ...slotLocal(o, k)), pr = p.r || 0.24;
  const ds = Math.hypot(sx - p.x, sy - p.y);
  if (ds > 0.002) {
    const kk = ds > 0.9 ? Math.min(1, dt * 8) : 1, nx = p.x + (sx - p.x) * kk, ny = p.y + (sy - p.y) * kk;
    if (!collides(game.world, nx, ny, pr, null, false) || ds < 0.3) { p.x = nx; p.y = ny; }
  }
  p.moving = o._slT > 0.02;
  p.facing = facingFrom(Math.cos(frontAng(o)), Math.sin(frontAng(o)), p.facing);
  p._faceLockT = Math.max(p._faceLockT || 0, 0.1);
}
export function myArty(game) {
  const me = game.net.pid;
  for (const o of enginesOf(game)) if (ARTY[o.type] && o.user === me && !o.removed) return o;
  return null;
}
export function myPush(game) {
  const me = game.net.pid;
  for (const o of enginesOf(game)) if (PUSH[o.type] && !o.removed && o.push && o.push.includes(me)) return o;
  return null;
}

// ---------- the local controls (game.siege; the HUD adds the touch stick: ui/siegeUi.js) ----------
export function siegeCtl(game) { return game.siege || (game.siege = makeCtl(game)); }
function makeCtl(game) {
  const C = {
    o: null, push: null, was: null, climb: null, aimL: 0, want: 0, sent: 0, distL: 0, wantD: 0, sentD: 0, sendT: 0, cd: 0, ramCd: 0,
    turning: false, pending: null, stickOn: false, stickAim: null, lastD: -2, dir: -1,
    get mounted() { return !!(C.o || C.push || C.climb); },
    get operating() { return !!C.o; },
    // the aim the input asks for now: [angle, distance] | null (keep)
    wantAim() {
      const o = C.o;
      if (!o) return null;
      if (C.stickOn) return C.stickAim;
      const m = game.ctl?.mouse;
      if (m && !game.input?.isTouch) {
        const [wx, wy] = game.screenToWorld(m.x, m.y), [px, py] = pivotOf(o);
        const dx = game.world.dx ? game.world.dx(wx, px) : wx - px, dy = wy - py, L = Math.hypot(dx, dy);
        if (L > 0.8) return [Math.atan2(dy, dx), L];
      }
      return null;
    },
    fire() {
      const o = C.o, p = game.player, S = o ? ARTY[o.type] : null;
      if (!o || p.dead) return false;
      const err = (text) => { if (!C._eT || game.time - C._eT > 0.8) { C._eT = game.time; game.events.emit('error', { text }); } return false; };
      if (C.cd > 0 || o._reload > 0) return err(o.type === 'trebuchet' ? 'O trabuco ainda está sendo armado no guincho…' : 'Recarregando a catapulta…');
      if (p.inv.count(S.ammo) < 1) return err(o.type === 'trebuchet' ? 'Sem pedras de trabuco (Oficina de cerco: 6 pedras = 1)' : 'Sem pedras de catapulta (Oficina de cerco: 3 pedras = 2)');
      p.inv.remove(S.ammo, 1);
      game.events.emit('inv', {});
      C.cd = S.reload;
      game.net.request('siege.fire', { id: o.id, a: +C.aimL.toFixed(4), d: +C.distL.toFixed(2) }, {
        refund: { [S.ammo]: 1 },
        onReject: (why) => { C.cd = 0; if (why) game.events.emit('error', { text: why }); },
      });
      return true;
    },
    ram() {
      const o = C.push, p = game.player;
      if (!o || o.type !== 'battering_ram' || p.dead) return false;
      if (C.ramCd > game.time) return true;
      C.ramCd = game.time + 0.6;
      game.net.request('siege.ram', { id: o.id }, { onReject: (why) => { if (why) game.events.emit('error', { text: why }); } });
      return true;
    },
    // the attack key / button: fire / strike (true = handled)
    onAttack() {
      if (C.climb) return true;
      if (C.o) { C.pending = null; C.fire(); return true; }
      if (C.push) { if (C.push.type === 'battering_ram') C.ram(); else game.events.emit('error', { text: 'Empurrando a torre: solte com E' }); return true; }
      return false;
    },
    onTap(tap) { if (C.climb) return true; if (C.o) { if (tap?.mouse) { C.pending = null; C.fire(); } return true; } if (C.push) return true; return false; },
    // E / the use button: get off / let go
    onInteract() {
      if (C.climb) return true;
      if (C.o) { game.net.request('siege.use', { id: C.o.id, on: 0 }); return true; }
      if (C.push) { game.net.request('siege.push', { id: C.push.id, on: 0 }); return true; }
      return false;
    },
    queueFire() { if (C.o) C.pending = { t: 0 }; },
  };
  return C;
}

// tests / debug: a readable state of an engine
export function siegeState(o) {
  return { type: o.type, user: o.user || null, aim: Number.isFinite(o.aim) ? +o.aim.toFixed(3) : null, dist: Number.isFinite(o.dist) ? +o.dist.toFixed(2) : null,
    push: (o.push || []).slice(), ramp: o.ramp ? 1 : 0, rampK: +(o._rampK || 0).toFixed(2), reload: +(o._reload || 0).toFixed(2), dmg: +(o.dmg || 0).toFixed(3), tx: o.tx, ty: o.ty, n: o.type === 'siege_tower' ? towerN(o) : null };
}
