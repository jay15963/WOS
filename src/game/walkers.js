// Winter nights (owner's request): the frozen dead — "Andarilhos do Gelo" (SPECIES.walker, kind 'pawn', faction
// 'walker') — walk out of the dark in small groups with ice swords / ice spears (as strong as stone), use the
// raiders' brain (bandits.js updateBandit: melee specials, spear throws as 'ice_spear') and crumble to snow at
// sunrise or when the winter ends (no body, no loot, no XP). Killed by a player: XP only (they shatter, nothing drops).
// Host only: walkersTick runs from mobsSystem's slow tick (sync 'host'); guests see them through the entity
// stream (species 'walker': the art draws them, agent "seasons visuals").
//
// Spawning: in the dark around a player (groups every ~25–40 s), 24–34 tiles away, out of sight, never within 3× the
// radius of a light (mobs.litNear), never in caves / under roofs. Every winter brings more of them (WINTER_GROWTH):
// winter 1 up to 3 around a player in groups of 1–3, then +2 per winter (bigger groups, sooner) up to 9.
//
// Hunting (walkerBrain, before the raiders' brain) — winter nights play almost like a tower defense (owner):
//  - what they want: a living player they see (line of sight) up to ai.PAWN_SIGHT tiles (the most zoomed-out view —
//    only the radar / map shows them first) or feel through walls up to SENSE; else the nearest light up to LIGHT_R
//    (campfires, torches, lamps… even indoors; a torch in a player's hand up to LIGHT_HAND). Further away they roam
//    where they came from (the raiders' brain).
//  - they walk there (nav.steer). A wall / door / fence in the way gets broken: when they stop getting anywhere
//    (STALL_S), when there is no way at all, or when the only way is a long detour (a path longer than DETOUR × the
//    straight line) — the first breakable piece on the straight line to it (breachToward). A gap close by is taken.
//  - what they want shut inside a room (walls, doors, rock all around — roofs.enclosedRoom): the closest wall / door
//    of it from outside (pickBreach); a wall on the way to that spot (a yard around the house) is broken first.
//  - hitting a piece: op struct.dmg (cracks and splinters on every peer, rockfx.js) until it breaks (struct.remove
//    fx 'smash': it falls apart). One walker needs SIEGE_S walker-seconds for a piece: in a night (5 min of play,
//    ~4.4 of them dark enough for walkers) a group of 3 breaks a wooden one about 6–7 times, a stone one about twice.
//  - a player in sight and in reach: they fight (the raiders' brain: chase, ice spear throws, specials).
// At sunrise the cracks of the night settle (struct.dmg 0).

import { SPECIES } from './data.js';
import { mobStats } from './stats.js';
import { weaponProfile } from './content/weapons.js';
import { mobBlocked } from './nav.js';
import { allocMob, levelForDistance, litNear } from './mobs.js';
import { allPlayers, minPlayerDist, inAnyView } from './players.js';
import { makeLook } from './bandits.js';
import { killMob, hasLOS, faceTowards, dist } from './combat.js';
import { BUILDINGS } from './data.js';
import { enclosedRoom } from './roofs.js';
import { steer, resetNav } from './nav.js';
import { go, aggro, aggroRadius } from './ai.js';
import { CYCLE } from './seasons.js';

let groupSeq = 0;

// the winter number (1 = the first winter of the world) and how many walkers it brings around a player
const winterNo = (game) => Math.floor(((game.env?.dayIndex ?? 1) - 1) / CYCLE) + 1;
const WINTER_GROWTH = { near: 3, nearPer: 2, nearMax: 9, groupMax: 3, groupPer: 1, groupCap: 5, every: [25, 40], faster: 0.3, everyMin: 12 };
function winterNumbers(game) {
  const k = winterNo(game) - 1, G = WINTER_GROWTH;
  return {
    near: Math.min(G.nearMax, G.near + G.nearPer * k),
    group: Math.min(G.groupCap, G.groupMax + G.groupPer * k),
    every: Math.max(G.everyMin, (G.every[0] + Math.random() * (G.every[1] - G.every[0])) / (1 + G.faster * k)),
  };
}

// ---------- the hunt ----------
const SENSE = 14;       // tiles: they feel the living through walls this close
const LIGHT_R = 40;     // tiles: light draws them from this far (high but limited: not the whole map)
const LIGHT_HAND = 22;  // tiles: a torch in a player's hand
// walker-seconds of hitting to break a piece (one walker); wood the default. 3 walkers: wood ~35 s, stone ~2 min
const SIEGE_S = { wall_stone: 350 };
const SIEGE_WOOD = 105;
const DETOUR = 1.5, DETOUR_ADD = 6; // a way longer than this × the straight line (+ tiles) is not taken: break through
const STALL_S = 2.5;    // s without getting anywhere (< 0.8 tile): break what is in the way
const breakable = (o) => { const d = o && !o.blueprint && !o.removed && !o.lv && BUILDINGS[o.type]; return !!d && (d.connect === 'wall' || d.connect === 'fence') && (d.block === 'tile' || d.block === 'door'); };
const handTorch = (q) => q.offhand === 'torch_hand' || q.equip?.off === 'torch_hand';
const openTile = (w, x, y) => w.inBounds(x, y) && !w.blocked(x, y) && w.solid[y * w.W + x] !== 2; // (doors stop them)

// what it wants now: a living player it sees / feels, else the nearest light; shut = inside a room it is not in
function pickGoal(game, m) {
  const w = game.world;
  let goal = null, bd = 1e9;
  for (const q of allPlayers(game)) {
    if (q.dead || (q.lv | 0) > 0) continue;
    const d = Math.hypot(q.x - m.x, q.y - m.y);
    if (d >= bd || d > aggroRadius(m, q)) continue;
    if (d > SENSE && !hasLOS(w, m.x, m.y, q.x, q.y, 0, 0)) continue;
    bd = d; goal = { x: q.x, y: q.y, kind: 'player', ref: q };
  }
  if (!goal) {
    bd = LIGHT_R;
    for (const o of game.build.structures) {
      if (o.blueprint || o.removed || o.lv) continue;
      const def = BUILDINGS[o.type], L = def?.light || (o.working && def?.workLight);
      if (!L || o.fire === false || o.lit === false) continue;
      const d = Math.hypot(o.x - m.x, o.y - m.y);
      if (d < bd) { bd = d; goal = { x: o.x, y: o.y - 0.3, kind: 'light' }; }
    }
    for (const q of allPlayers(game)) {
      if (q.dead || (q.lv | 0) > 0 || !handTorch(q)) continue;
      const d = Math.hypot(q.x - m.x, q.y - m.y);
      if (d < bd && d < LIGHT_HAND) { bd = d; goal = { x: q.x, y: q.y, kind: 'player', ref: q }; }
    }
  }
  if (!goal) return null;
  const tx = Math.floor(goal.x), ty = Math.floor(goal.y), key = tx + ',' + ty + ',' + game.build.v;
  let room = null;
  if (m._roomKey === key) room = m._room;
  else { room = enclosedRoom(game, tx, ty, 220); m._roomKey = key; m._room = room; }
  if (room) {
    const mx = Math.floor(m.x), my = Math.floor(m.y);
    goal.shut = !room.some(([x, y]) => x === mx && y === my);
    goal.room = room;
  }
  return goal;
}

// the piece of the room's ring to break: the closest breakable one, and a free spot outside next to it
function pickBreach(game, m, room, skip) {
  const w = game.world, G = game.build.grid.main, inRoom = new Set(room.map(([x, y]) => y * w.W + x));
  let best = null, bd = 1e9;
  for (const [x, y] of room) {
    const o = G.get(y * w.W + x);
    if (!breakable(o) || skip?.has(o.id)) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const sx = x + dx, sy = y + dy;
      if (!w.inBounds(sx, sy) || inRoom.has(sy * w.W + sx) || w.blocked(sx, sy)) continue;
      const d = Math.hypot(sx + 0.5 - m.x, sy + 0.5 - m.y);
      if (d < bd) { bd = d; best = { o, stand: [sx + 0.5, sy + 0.5] }; }
    }
  }
  return best;
}

// the piece in the way to (gx, gy): the first wall / door / fence on the straight line, with the open tile just
// before it to stand on; when the line meets rock / something that does not break first, the breakable piece near
// that spot it can stand next to on its own side (closest to it)
function breachToward(game, m, gx, gy, skip) {
  const w = game.world, G = game.build.grid.main;
  let tx = Math.floor(m.x), ty = Math.floor(m.y);
  const ex = Math.floor(gx), ey = Math.floor(gy);
  const dx = gx - m.x, dy = gy - m.y;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : 1e9, ddy = dy !== 0 ? Math.abs(1 / dy) : 1e9;
  let mx = dx !== 0 ? (dx > 0 ? tx + 1 - m.x : m.x - tx) * ddx : 1e9;
  let my = dy !== 0 ? (dy > 0 ? ty + 1 - m.y : m.y - ty) * ddy : 1e9;
  let hit = null;
  for (let n = 0; n < 160 && !(tx === ex && ty === ey); n++) {
    const px = tx, py = ty;
    if (mx < my) { mx += ddx; tx += sx; } else { my += ddy; ty += sy; }
    if (!w.inBounds(tx, ty)) break;
    if (openTile(w, tx, ty)) continue;
    const o = G.get(ty * w.W + tx);
    if (breakable(o) && !skip?.has(o.id) && (openTile(w, px, py) || (px === Math.floor(m.x) && py === Math.floor(m.y)))) return { o, stand: [px + 0.5, py + 0.5] };
    hit = [tx, ty];
    break;
  }
  if (!hit) return null;
  let best = null, bs = 1e9;
  for (let y = hit[1] - 4; y <= hit[1] + 4; y++) for (let x = hit[0] - 4; x <= hit[0] + 4; x++) {
    if (!w.inBounds(x, y)) continue;
    const o = G.get(y * w.W + x);
    if (!breakable(o) || skip?.has(o.id)) continue;
    const dg = Math.hypot(x + 0.5 - gx, y + 0.5 - gy);
    for (const [ox, oy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const qx = x + ox, qy = y + oy;
      if (!openTile(w, qx, qy) || Math.hypot(qx + 0.5 - gx, qy + 0.5 - gy) <= dg) continue; // (its own side)
      const sc = Math.hypot(qx + 0.5 - m.x, qy + 0.5 - m.y) + 0.6 * Math.hypot(x - hit[0], y - hit[1]);
      if (sc < bs) { bs = sc; best = { o, stand: [qx + 0.5, qy + 0.5] }; }
    }
  }
  return best;
}

function hitPiece(game, m, o) {
  const inc = m.swingDur / (SIEGE_S[o.type] || SIEGE_WOOD);
  const d = Math.min(1, (o.dmg || 0) + inc);
  game.net.emit('struct.dmg', { id: o.id, d: +d.toFixed(4), x: +m.x.toFixed(2), y: +m.y.toFixed(2) });
  if (d >= 1) game.net.emit('struct.remove', { id: o.id, fx: 'smash' });
}

const badPiece = (m, o) => (m.badBreach || (m.badBreach = new Set())).add(o.id);
function startSiege(m, b, ring) {
  m.siege = { o: b.o, stand: b.stand, ring, px: m.x, py: m.y, st: 0 };
  m.state = 'siege'; m.threat = null; m.ap = null;
  resetNav(m);
}
// back to the raiders' brain (it roams around home = what drew it)
function handOff(m) {
  if (m.siege) { m.siege = null; resetNav(m); }
  m.ap = null;
  if (m.state === 'hunt' || m.state === 'siege') { m.state = 'idle'; m.stateT = 0.5 + Math.random() * 1.5; m.moving = false; }
  return false;
}
// "getting somewhere?" — moved 0.8 tile in the last STALL_S seconds (o: { px, py, st })
function stalled(o, m, dt) {
  if (Math.hypot(m.x - o.px, m.y - o.py) > 0.8) { o.px = m.x; o.py = m.y; o.st = 0; return false; }
  o.st += dt;
  return o.st > STALL_S;
}

// host: the walker part of the brain; true = it handled this frame (bandits.updateBandit skips its own)
export function walkerBrain(game, m, dt) {
  if (m.calmT > 0) return handOff(m); // (tests / debug: a calmed one keeps to itself)
  m.goalT = (m.goalT || 0) - dt;
  if (m.goalT <= 0) {
    m.goalT = 0.8 + Math.random() * 0.5;
    const g = pickGoal(game, m), o = m.goal;
    if (!g || !o || g.kind !== o.kind || g.ref !== o.ref || Math.hypot(g.x - o.x, g.y - o.y) > 3) m.ap = null; // (something else: a fresh way)
    m.goal = g;
    if (g) {
      // drawn there: the raiders' brain roams around it / its leash follows
      m.home = { x: g.x, y: g.y };
      if (m.campRef) { m.campRef.x = g.x; m.campRef.y = g.y; }
    }
  }
  const goal = m.goal;
  if (!goal) return handOff(m);
  // a player in sight and not shut away: fight (the raiders' brain)
  const t = goal.kind === 'player' ? goal.ref : null;
  if (t && !t.dead && !goal.shut && dist(m, t) < aggroRadius(m, t) && hasLOS(game.world, m.x, m.y, t.x, t.y, 0, 0)) {
    if (m.siege) { m.siege = null; resetNav(m); }
    m.ap = null;
    if (m.state !== 'chase' && m.state !== 'evade') aggro(game, m, t);
    return false;
  }
  if (m.siege && (m.siege.o.removed || !breakable(m.siege.o))) { m.siege = null; resetNav(m); }
  // shut in a room: its closest wall / door from outside
  if (!m.siege && goal.shut) {
    const b = pickBreach(game, m, goal.room, m.badBreach);
    if (b) startSiege(m, b, true);
  }
  if (m.siege) return siegeStep(game, m, dt);
  return approach(game, m, goal, t ? t.x : goal.x, t ? t.y : goal.y, dt);
}

// walk to what it wants; a wall in the way (no way / a long detour / not getting anywhere) gets broken
function approach(game, m, goal, gx, gy, dt) {
  const sp = SPECIES.walker, w = game.world;
  const dG = Math.hypot(gx - m.x, gy - m.y);
  if (dG < (goal.kind === 'light' ? 2.6 : 1)) return handOff(m); // there: they hang around the light
  const A = m.ap || (m.ap = { px: m.x, py: m.y, st: 0, path: null });
  m.state = 'hunt'; m.threat = null;
  const spd = sp.speed * 0.8;
  const dir = steer(game, m, gx, gy, dt, spd, 0.6, 0);
  if (dir) go(game, m, dir, spd, dt); else m.moving = false;
  let blocked = stalled(A, m, dt);
  const nav = m.nav;
  if (!blocked && nav?.path && nav.path !== A.path) {
    // a new way: does it get there, and without a long detour?
    A.path = nav.path;
    const P = nav.path, end = P[P.length - 1];
    if (nav.partial && Math.hypot(end[0] - gx, end[1] - gy) > 2.5) blocked = true;
    else {
      let L = Math.hypot(P[0][0] - m.x, P[0][1] - m.y);
      for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (L > dG * DETOUR + DETOUR_ADD) blocked = true;
    }
  }
  if (blocked) {
    A.st = 0; A.px = m.x; A.py = m.y;
    const b = breachToward(game, m, gx, gy, m.badBreach);
    if (b) startSiege(m, b, false);
  }
  return true;
}

// walk to the spot next to the piece, then hit it until it breaks
function siegeStep(game, m, dt) {
  const sp = SPECIES.walker, S = m.siege, o = S.o;
  const dw = Math.hypot(o.x - m.x, (o.y - 0.5) - m.y);
  if (dw > 1.3) {
    const dir = steer(game, m, S.stand[0], S.stand[1], dt, sp.speed * 0.75, 0.2, 0);
    if (dir) go(game, m, dir, sp.speed * 0.75, dt); else m.moving = false;
    if (stalled(S, m, dt) || (m.nav && m.nav.fails > 4)) {
      // something in the way to that spot (a yard wall around the house): break that first; else another piece
      const b = S.ring ? breachToward(game, m, S.stand[0], S.stand[1], m.badBreach) : null;
      if (b && b.o !== o) startSiege(m, b, false);
      else { badPiece(m, o); m.siege = null; resetNav(m); }
    }
    return true;
  }
  m.moving = false;
  faceTowards(m, { x: o.x, y: o.y - 0.5 });
  if (m.swingT <= 0) {
    m.swingT = m.swingDur * (0.9 + Math.random() * 0.2);
    m.action = { type: m.wprof?.act === 'stab' ? 'stab' : 'attack', t: 0, dur: 0.4 };
    game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
    game.later(0.22, () => { if (!m.dead && !o.removed && m.siege?.o === o) hitPiece(game, m, o); });
  }
  return true;
}

// tests / debug (host): what a walker wants and how it gets there
export function walkerDebug(m) { return { state: m.state, goal: m.goal && { kind: m.goal.kind, x: m.goal.x, y: m.goal.y, shut: !!m.goal.shut }, siege: m.siege && { id: m.siege.o.id, ring: m.siege.ring } }; }

function walkerDeath() { return { rows: [], toast: null }; } // (owner: XP only — the ice shatters, nothing drops)

function spawnWalker(game, x, y, group, home) {
  const sp = SPECIES.walker, w = game.world, R = () => game.net.roll();
  const main = R() < 0.55 ? 'sword_ice' : 'spear_ice';
  const level = Math.max(2, levelForDistance(Math.hypot(x - w.spawn.x, y - w.spawn.y), 2) + (R() < 0.3 ? 1 : 0));
  const st = mobStats(sp, level);
  const wp = weaponProfile(main);
  const wf = 0.6 + 0.4 * (((wp.min + wp.max) / 2) / 8); // weapon damage factor vs a stone spear (damped), like raiders
  const m = {
    isEntity: true, isMob: true, kind: 'pawn', faction: 'walker', species: 'walker', ...allocMob(game),
    name: sp.name, level, elite: false, role: 'melee', camp: group.id, campRef: group,
    temper: 'hostile', x, y, r: sp.r, scale: sp.scale, facing: R() < 0.5 ? 'e' : 'w', moving: false, moveT: R() * 10,
    action: null, flash: 0, dead: false, deadT: 0,
    hp: st.maxHp, dmg: st.dmg * wf, home, state: 'wander', stateT: 30, swingT: 0, stunT: 0, wp: [home.x, home.y],
    look: makeLook(R, R() < 0.3, false), weapon: main, offhand: null, armor: { body: null, head: null },
    wprof: wp, shield: null, reachX: wp.reach, swingDur: wp.swing * 1.15, armorV: 4, aggroR: sp.aggro,
    xpMul: sp.xp, specialT: 3 + R() * 4, blockT: 4, throwT: 2, onDeath: walkerDeath, patrol: false, noCorpse: true,
  };
  m.maxHp = m.hp;
  group.members.push(m);
  game.entities.push(m); // host-only creature list (guests get proxies from net/entities.js)
  return m;
}

function spawnGroup(game) {
  const w = game.world, L = allPlayers(game).filter((q) => !q.dead);
  if (!L.length) return false;
  const p = L[Math.floor(Math.random() * L.length)];
  let near = 0;
  const WN = winterNumbers(game);
  for (const e of game.entities) if (e.faction === 'walker' && !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 45) near++;
  if (near >= WN.near) return false;
  const ok = (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return w.inBounds(tx, ty) && !mobBlocked(w, x, y, 0.26) && (!w.waterAt(tx, ty) || w.frozen) && !w.isCave(tx, ty) && !w.roofAt?.(tx, ty) && !litNear(game, x, y);
  };
  for (let k = 0; k < 16; k++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 10;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (!ok(x, y) || minPlayerDist(game, x, y) < 22 || inAnyView(game, x, y, 3, 3)) continue;
    // they shamble toward a spot ~8 tiles from the player, in the dark
    let hx = p.x + Math.cos(a) * 8, hy = p.y + Math.sin(a) * 8;
    if (!ok(hx, hy)) { hx = x; hy = y; }
    const group = { id: 'w' + (++groupSeq).toString(36), x: hx, y: hy, members: [] };
    const n = Math.min(WN.near - near, 1 + Math.floor(Math.random() * WN.group));
    for (let i = 0; i < n; i++) {
      const jx = x + (Math.random() - 0.5) * 2, jy = y + (Math.random() - 0.5) * 2;
      spawnWalker(game, ok(jx, jy) ? jx : x, ok(jx, jy) ? jy : y, group, { x: hx + (Math.random() - 0.5) * 2.5, y: hy + (Math.random() - 0.5) * 2.5 });
    }
    return true;
  }
  return false;
}

// tests / debug (host): one walker at (x, y), in a group of its own that roams there
export function spawnWalkerAt(game, x, y) {
  const group = { id: 'w' + (++groupSeq).toString(36), x, y, members: [] };
  return spawnWalker(game, x, y, group, { x, y });
}

// host, once a second (mobsSystem): spawn on winter nights, crumble at sunrise / when the winter ends
export function walkersTick(game, night) {
  const on = night && game.season?.id === 'winter';
  if (!on) {
    // sunrise: they fall apart one after another over a few seconds
    let any = false;
    for (const e of game.entities) {
      if (e.faction !== 'walker' || e.dead) continue;
      any = true;
      if (e.crumbleAt == null) e.crumbleAt = game.worldTime + Math.random() * 6;
      else if (game.worldTime >= e.crumbleAt) killMob(game, e, null);
    }
    // ...and the walls they cracked settle (what they broke stays broken)
    if (!any && !night) for (const o of game.build.structures) if (o.dmg > 0) game.net.emit('struct.dmg', { id: o.id, d: 0 });
    game._walkT = 4;
    return;
  }
  game._walkT = (game._walkT ?? 4) - 1;
  if (game._walkT > 0) return;
  game._walkT = winterNumbers(game).every;
  spawnGroup(game);
}
