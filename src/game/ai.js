// Creature brain (WoW-like): idle/wander, aggro by level-scaled radius, chase, swing-timer attacks,
// leash -> evade home with full regen, passive animals flee (smart direction sampling), fear (torch),
// daze (shove), poison bites (spiders), skittish animals (foxes). Movement never passes doors (nav.moveMob).
// Raiders (faction 'bandit') have their own brain in bandits.js but share these helpers.
// Multiplayer: creatures exist on the HOST only. They pick the nearest player (players.js), chase their
// `threat` (local player or a remote avatar) and hurt it through hurtPlayer (owner applies the damage).
// On guests the same objects are AI-less proxies (net/entities.js): aggro() on a proxy is routed to the host.

import { SPECIES } from './data.js';
import { facingFrom } from './physics.js';
import { steer, resetNav, moveMob, mobBlocked } from './nav.js';
import { slopeSpeed, dropAhead, startHop, hopStep } from './terrain.js'; // terrain height: uphill, small drops
import { reach, dist, faceTowards, mobEffect, hasLOS, dealDamage } from './combat.js';
import { enterCombat } from './player.js';
import { nearestPlayer, hurtPlayer, allPlayers } from './players.js';
import { stepGait } from './anim.js';
import { nightK } from './seasons.js';
import { PREY } from './content/livestock.js';
import { HUNT } from './content/fauna.js'; // wild predators vs wild prey

export const LEASH = 120; // max distance from home while chasing (was 26: chases gave up far too soon)
const FLEE_LEASH = 26;    // passive animals fleeing start curving back home past this distance
const BORED = 45;         // seconds without exchanging blows before evading (scaled with LEASH)
const SUN_LEASH = 4;      // cave monsters: seconds out in the daylight before they go back to their nest

// how far a hostile notices a player (owner): animals a little further than they used to — still about where the
// player sees them first (the default view, a little zoomed out) — and only in sight (line of sight) past a few
// tiles; the winter walkers see as far as the most zoomed-out view (PAWN_SIGHT): only the radar / map shows them
// before they see you; raiders see less (their species aggro, 12: a bit past the default view)
export const PAWN_SIGHT = 18;
export function aggroRadius(m, p) {
  const sp = SPECIES[m.species];
  if (sp?.pawn) return m.aggroR ?? PAWN_SIGHT;
  const k = Math.max(0.35, Math.min(1.25, 1 + 0.15 * (m.level - p.level)));
  return (m.aggroR ?? sp.aggro ?? 0) * k;
}
const SMELL = 3; // tiles: this close an animal notices you even out of sight
// a player running (sprint) or galloping (mounted): the local player from its own state, a remote avatar on the host
// from its measured speed (session.js av.vx / vy; walking is 4 tiles / s, a sprint 6.6)
export function fastMover(game, q) {
  if (!q || q.dead || !q.moving) return false;
  if (q === game.player) return !!q.mount || q.buffs?.some((b) => b.id === 'sprint');
  return Math.hypot(q.vx || 0, q.vy || 0) > 5.2;
}

// who this creature cares about: its threat while chasing, else the nearest player
export function pickTarget(game, m) {
  if (m.state === 'chase' && m.threat && !m.threat.gone) return m.threat;
  return nearestPlayer(game, m.x, m.y, 60, { alive: false }) || game.player;
}

// m was damaged / provoked by src
export function aggro(game, m, src, social = true) {
  if (!m || m.dead || m.isProp) return;
  if (game.creative && src && allPlayers(game).includes(src)) return; // creative.js: nothing picks a fight with a player
  if (m.proxy) { mobEffect(game, m, { aggro: 1 }); return; } // guest: the host decides
  if (m.state === 'evade') return;
  const sp = SPECIES[m.species];
  m.lastCombatT = game.worldTime;
  if (m.temper === 'passive' || sp.temper === 'passive') {
    startFlee(m, src, 4 + Math.random() * 2);
    return;
  }
  if (m.fearT > 0) return;
  const was = m.state === 'chase';
  m.state = 'chase';
  m.threat = src;
  if (!was) {
    resetNav(m);
    game.audio?.play('growl', { x: m.x, y: m.y, volume: m.kind === 'pawn' ? 0.5 : 1 });
    if (src === game.player) enterCombat(src);
    if (social && sp.social) {
      const R = m.camp ? 9 : 8;
      for (const o of game.entities) {
        if (o === m || o.dead || o.state === 'chase' || !o.isMob) continue;
        const kin = m.camp ? o.camp === m.camp : o.species === m.species;
        if (kin && dist(o, m) < R) aggro(game, o, src, false);
      }
    }
    game.events.emit('aggro', { mob: m });
  }
}

export function startFlee(m, from, t) {
  m.state = 'flee';
  m.fleeT = t;
  m.fleeFrom = from;
  m.fleeDir = null;
  resetNav(m);
}

export function evade(m, calm = 0) {
  if (m.dead) return;
  m.state = 'evade';
  // time to walk home before the stuck fallback snaps it there (long chases need longer)
  const homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);
  m.stateT = Math.max(12, 6 + homeD / Math.max(1, (SPECIES[m.species]?.speed || 3) * 1.4) * 1.6);
  m.calmT = calm; // seconds of ignoring the player after giving up (unreachable / bored)
  m.threat = null;
  m.action = null;
  m.cast = null;
  m.blocking = false;
  resetNav(m);
}

// somewhere 9-13 tiles further from the player than the creature is now (going home for the night / the day)
function leaveSpot(game, m, p) {
  const w = game.world;
  let ax = m.x - p.x, ay = m.y - p.y;
  const L = Math.hypot(ax, ay) || 1;
  ax /= L; ay /= L;
  for (let k = 0; k < 6; k++) {
    const a = Math.atan2(ay, ax) + (Math.random() - 0.5) * 1.2, r = 9 + Math.random() * 4;
    const x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r;
    if (!mobBlocked(w, x, y, m.r) && w.waterAt(Math.floor(x), Math.floor(y)) !== 2) return [x, y];
  }
  return [m.home.x, m.home.y];
}

// (a deck — a pier / bridge, game/decks.js — is ground: a spot on one is fine, deep water is not)
const deepAt = (w, x, y) => { const tx = Math.floor(x), ty = Math.floor(y); return w.waterAt(tx, ty) === 2 && !(w.deck && w.inBounds(tx, ty) && w.deck.get(w.idx(tx, ty))); };
export function pickWander(game, m, rMax = 5) {
  const w = game.world;
  // now and then a stroll onto a pier / bridge near home (they would only cross one on a path otherwise)
  if (game.decks?.any && Math.random() < 0.3) { const d = deckSpot(game, m, rMax); if (d) return d; }
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * rMax;
    const x = m.home.x + Math.cos(a) * r, y = m.home.y + Math.sin(a) * r;
    if (!mobBlocked(w, x, y, m.r) && !deepAt(w, x, y)) return [x, y];
  }
  return [m.home.x, m.home.y];
}
// a free spot on a finished pier / bridge piece within reach of home (one of them at random), or null
function deckSpot(game, m, rMax) {
  const D = game.decks, w = game.world, R = rMax + 2.5;
  let pick = null, n = 0;
  for (const o of D.list) {
    if (o.blueprint || Math.abs(o.tx + 0.5 - m.home.x) > R || Math.abs(o.ty + 0.5 - m.home.y) > R) continue;
    if (Math.random() * ++n < 1) pick = o; // (reservoir: each piece as likely)
  }
  if (!pick) return null;
  const x = pick.tx + 0.3 + Math.random() * 0.4, y = pick.ty + 0.3 + Math.random() * 0.4;
  return mobBlocked(w, x, y, m.r) ? null : [x, y];
}

export function go(game, m, dir, speed, dt) {
  if (m._hop?.terrain) { const x0 = m.x, y0 = m.y; hopStep(game, m, dt); stepGait(m, Math.hypot(m.x - x0, m.y - y0)); return; } // (jumping down a small drop: terrain.js)
  if (!dir) { m.moving = false; return; }
  let spd = speed * (game.levels ? game.levels.speedAt(m) : game.world.speedAt(m.x, m.y, m._ud)); // levels: stairs slower; under a bridge: the water's
  if (m.dazeT > 0) spd *= 0.45;
  if (game.world.hasHeight) spd *= slopeSpeed(game, m, dir[0], dir[1]); // terrain height: slower uphill
  const x0 = m.x, y0 = m.y;
  moveMob(game, m, dir[0] * spd * dt, dir[1] * spd * dt);
  m.facing = facingFrom(dir[0], dir[1], m.facing);
  m.moving = true;
  const dd = Math.hypot(m.x - x0, m.y - y0);
  stepGait(m, dd);
  // pushing into the edge of a small drop (its path / chase runs down it): hop down (terrain.js)
  if (dd < spd * dt * 0.25 && game.world.hasHeight && !m.isProp && !m.fly) { const d = dropAhead(game, m, dir[0], dir[1]); if (d) startHop(game, m, d, 0.4); }
}

// best open direction away from `from` (8 samples, prefers away + toward home when far)
export function fleeDir(game, m, from, homeBias = 0) {
  const w = game.world;
  let ax = m.x - from.x, ay = m.y - from.y;
  const L = Math.hypot(ax, ay) || 1;
  ax /= L; ay /= L;
  let hx = 0, hy = 0;
  if (homeBias > 0) { const hd = Math.hypot(m.home.x - m.x, m.home.y - m.y) || 1; hx = (m.home.x - m.x) / hd; hy = (m.home.y - m.y) / hd; }
  let best = null, bs = -1e9;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let score = dx * ax + dy * ay + (dx * hx + dy * hy) * homeBias;
    // open space ahead?
    let open = 0;
    for (const s of [0.6, 1.3, 2.2]) {
      const x = m.x + dx * s, y = m.y + dy * s;
      if (mobBlocked(w, x, y, m.r) || w.waterAt(Math.floor(x), Math.floor(y)) === 2) break;
      open++;
    }
    score += open * 0.45 - (open === 0 ? 3 : 0);
    if (score > bs) { bs = score; best = [dx, dy]; }
  }
  return best;
}

// common per-frame bookkeeping; returns false when the mob can't act this frame (stunned)
export function tickStatus(game, m, dt) {
  m.swingT = Math.max(0, (m.swingT || 0) - dt);
  if (m.dazeT > 0) m.dazeT -= dt;
  if (m.calmT > 0) m.calmT -= dt;
  if (m.action) {
    if (!m.action.hold) m.action.t += dt / (m.action.dur || 0.5);
    if (m.action.t >= 1) m.action = null;
  }
  if (m.stunT > 0) {
    m.stunT -= dt;
    m.moving = false;
    m.action = null;
    m.cast = null;
    return false;
  }
  return true;
}

// creature melee swing at a player (shared by animals and the wild fauna, game/fauna.js; raiders use their own variants)
export function bite(game, m, p, sp, rng) {
  m.swingT = sp.swing * (0.9 + Math.random() * 0.2);
  m.action = { type: 'attack', t: 0, dur: 0.5 };
  game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
  game.later(0.24, () => {
    if (m.dead || m.stunT > 0 || p.dead || dist(m, p) > rng + 0.6) return;
    m.lastCombatT = game.worldTime;
    const crit = Math.random() < 0.05;
    const pz = sp.poison;
    // poison is rolled with the bite and applied by the owner only if the bite lands
    const poison = pz && Math.random() < pz.chance ? { dur: pz.dur, tick: pz.tick, dmg: Math.max(1, Math.round(m.dmg * pz.k)) } : null;
    hurtPlayer(game, m, p, Math.max(1, Math.round(m.dmg * (0.8 + Math.random() * 0.4) * (crit ? 1.5 : 1))), { crit, poison });
  });
}

// ---------- predators vs farm animals (docs/LIVESTOCK.md; numbers: content/livestock.js PREY) ----------
// At night a wolf pack (bears too, less often) may go after the farm animals it sees nearby — wild or domesticated,
// never one on a rope. Rolled once a night per pack (most nights they leave them alone), one kill a night, then the
// pack lets them be; a fence / pen around them blocks the path and the pack gives up. The hunted animal and the ones
// next to it run; a player in sight still comes first. A killed animal leaves its body (butchered like any kill).
const nightNow = (game) => nightK(game.env?.hour ?? 12) > 0.5;
const nightNo = (game) => (game.env?.dayIndex ?? 0) - ((game.env?.hour ?? 12) < 12 ? 1 : 0); // (a night spans midnight)
export const isPrey = (e) => !!e && e.isMob && !!e.stock && !e.dead && !e.proxy && !e.tiedTo && !e.rider; // (a ridden horse: its rider is the target)
// the pack's mood tonight (one roll per pack and night; the pack = its spawner, a lone one itself)
function packMood(game, m) {
  const s = m.spawner || m, n = nightNo(game);
  if (s._preyN !== n) { s._preyN = n; s._preyOk = Math.random() < PREY.chance * (PREY.hunters[m.species] || 0); s._preyKills = 0; s._preyCalm = 0; }
  return s;
}
// ---------- wild predators vs wild prey (docs/FAUNA.md "Caça"; numbers: content/fauna.js HUNT) ----------
// Once a day each pack rolls whether it hunts (a lion pride from dusk, jaguars / lynxes at night, wolves and polar bears
// any time); a hungry one going about its business notices prey in sight, creeps up (the prey does not see it coming
// until HUNT.flee tiles) and sprints the last stretch; the prey and its herd run (fast prey often escapes), a bite dazes
// it. One kill a day, then the pack stays by the body a while (eating) and lets the rest be. The body is like any kill.
const huntWhen = (game, w) => w === 'always' || (w === 'night' ? nightNow(game) : nightNow(game) || (game.env?.hour ?? 12) >= 16.5);
export const isWildPrey = (e, list) => !!e && e.isMob && !e.dead && !e.proxy && !e.stock && !e.tiedTo && list.includes(e.species) && !((e.fmode | 0) & 5); // (not up a tree / flying)
function huntMood(game, m) {
  const s = m.spawner || m, n = game.env?.dayIndex ?? 0;
  if (s._wildN !== n) { s._wildN = n; s._wildOk = Math.random() < HUNT.chance; s._wildKills = 0; s._wildCalm = 0; }
  return s;
}
function lookForWild(game, m) {
  const H = HUNT.hunters[m.species];
  if (!H || m.leaving || !huntWhen(game, H.when)) return false;
  m.wildT = (m.wildT || 0) - 0.3;
  if (m.wildT > 0) return false;
  m.wildT = 1.2;
  const s = huntMood(game, m);
  if (!s._wildOk || s._wildKills >= HUNT.kills || s._wildCalm > game.worldTime) return false;
  let best = null, bd = HUNT.r;
  for (const e of game.entities) {
    if (Math.abs(e.x - m.x) > bd || Math.abs(e.y - m.y) > bd || !isWildPrey(e, H.prey)) continue;
    const d = dist(m, e);
    if (d >= bd || (m.preyBan && m.preyBan.nid === e.nid && m.preyBan.t > game.worldTime)) continue;
    if (!hasLOS(game.world, m.x, m.y, e.x, e.y, m.z || 0, e.z || 0, m._tn, e._tn)) continue;
    best = e; bd = d;
  }
  if (!best) return false;
  startWildHunt(game, m, best);
  return true;
}
// (exported: tests start a hunt right away)
export function startWildHunt(game, m, e) {
  startHunt(game, m, e);
  m.huntWild = true;
  for (const o of game.entities) {
    if (o !== m && !o.dead && !o.proxy && o.species === m.species && o.spawner && o.spawner === m.spawner && (o.state === 'idle' || o.state === 'wander') && dist(o, m) < 14) { startHunt(game, o, e); o.huntWild = true; }
  }
}

// an idle predator looks for a farm animal in sight (the pack joins); true when it started a hunt
function lookForPrey(game, m) {
  if (HUNT.hunters[m.species] && lookForWild(game, m)) return true;
  if (!PREY.hunters[m.species] || m.leaving || !nightNow(game)) return false;
  m.preyT = (m.preyT || 0) - 0.3;
  if (m.preyT > 0) return false;
  m.preyT = 1;
  const s = packMood(game, m);
  if (!s._preyOk || s._preyKills >= PREY.kills || s._preyCalm > game.worldTime) return false;
  let best = null, bd = PREY.r;
  for (const e of game.entities) {
    if (!isPrey(e) || Math.abs(e.x - m.x) > bd || Math.abs(e.y - m.y) > bd) continue;
    const d = dist(m, e);
    if (d >= bd || (m.preyBan && m.preyBan.nid === e.nid && m.preyBan.t > game.worldTime)) continue;
    if (!hasLOS(game.world, m.x, m.y, e.x, e.y, m.z || 0, e.z || 0, m._tn, e._tn)) continue;
    best = e; bd = d;
  }
  if (!best) return false;
  startHunt(game, m, best);
  for (const o of game.entities) {
    if (o !== m && !o.dead && !o.proxy && o.species === m.species && (o.spawner ? o.spawner === m.spawner : false) && (o.state === 'idle' || o.state === 'wander') && dist(o, m) < 14) startHunt(game, o, best);
  }
  return true;
}
function startHunt(game, m, e) {
  m.state = 'hunt'; m.prey = e; m.huntT = 0; m.huntWild = false; m._panic = false;
  resetNav(m);
  game.audio?.play('growl', { x: m.x, y: m.y, species: m.species, volume: 0.7 });
}
function stopHunt(game, m, ban = false) {
  if (ban && m.prey) m.preyBan = { nid: m.prey.nid, t: game.worldTime + 90 };
  m.prey = null; m.state = 'idle'; m.stateT = 1 + Math.random() * 2; m.moving = false; m.huntWild = false; m.speedK = 1;
  resetNav(m);
}
// the hunted animal and its neighbours run from the predator
function panic(game, e, from) {
  for (const o of game.entities) {
    if (!isPrey(o) || o.state === 'flee' || Math.abs(o.x - e.x) > 5 || Math.abs(o.y - e.y) > 5) continue;
    if (o === e || dist(o, e) < 4) startFlee(o, from, 2.5 + Math.random() * 2);
  }
}
function bitePrey(game, m, e, sp, rng) {
  m.swingT = sp.swing * (0.9 + Math.random() * 0.2);
  m.action = { type: 'attack', t: 0, dur: 0.5 };
  game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
  game.later(0.24, () => {
    if (m.dead || m.stunT > 0 || e.dead || dist(m, e) > rng + 0.6) return;
    const wild = m.huntWild;
    dealDamage(game, m, e, m.dmg * (wild ? HUNT.dmgK : PREY.dmgK) * (0.8 + Math.random() * 0.4), { knock: 0.08 });
    if (wild && !e.dead) { e.dazeT = Math.max(e.dazeT || 0, HUNT.daze); return; } // (bitten: it stumbles a moment)
    if (!e.dead) return;
    if (wild) { wildKill(game, m, e); return; }
    // a kill: the pack is done for the night (owned animals: the owners hear of it)
    const s = packMood(game, m);
    s._preyKills++; s._preyCalm = game.worldTime + PREY.calm;
    for (const o of game.entities) if (o.state === 'hunt' && o.prey === e) stopHunt(game, o);
    if (e.owned) game.net.emit('stock.note', { text: `${sp.name === 'Urso' ? 'Um urso' : 'Os lobos'} mat${sp.name === 'Urso' ? 'ou' : 'aram'} ${STOCK_A[e.species] || 'um animal'} da criação!`, kind: 'bad' });
  });
}
const STOCK_A = { cow: 'uma vaca', sheep: 'uma ovelha', pig: 'um porco', chicken: 'uma galinha', horse: 'um cavalo' };
// a wild kill: the pack is done for the day; it stays by the body a while (eating, lying down) — the body is any kill's
function wildKill(game, m, e) {
  const s = huntMood(game, m);
  s._wildKills++; s._wildCalm = game.worldTime + HUNT.calm;
  for (const o of game.entities) {
    if (o.state !== 'hunt' || o.prey !== e) continue;
    stopHunt(game, o);
    o.state = 'idle'; o.stateT = HUNT.eat[0] + Math.random() * (HUNT.eat[1] - HUNT.eat[0]); o.calmT = Math.max(o.calmT || 0, 8);
  }
  game.audio?.play('growl', { x: m.x, y: m.y, species: m.species, volume: 0.6 });
}
// the 'hunt' state: chase the animal, bite it; give up when it is out of reach (a fence: no path), too far, too long
function huntStep(game, m, dt, sp) {
  const e = m.prey, wild = m.huntWild, H = wild ? HUNT.hunters[m.species] : null;
  m.huntT = (m.huntT || 0) + dt;
  const lost = wild ? !isWildPrey(e, H?.prey || []) || m.leaving || dist(m, e) > HUNT.r * 2 : !isPrey(e) || !nightNow(game) || m.leaving || dist(m, e) > PREY.r * 2;
  const stuck = !!(m.nav && m.nav.fails > 2), giveUp = wild ? HUNT.giveUp : PREY.giveUp;
  if (lost || stuck || m.huntT > giveUp) {
    if (stuck || m.huntT > giveUp) {
      if (wild) { const s = huntMood(game, m); s._wildCalm = Math.max(s._wildCalm || 0, game.worldTime + (stuck ? 8 : HUNT.failCalm)); }
      else { const s = packMood(game, m); s._preyCalm = Math.max(s._preyCalm || 0, game.worldTime + (stuck ? 8 : PREY.calm)); }
    }
    stopHunt(game, m, stuck);
    return;
  }
  const d = dist(m, e);
  if (wild) { if (d < HUNT.flee && !m._panic) { m._panic = true; if (e.state !== 'flee') startFlee(e, m, 3 + Math.random() * 2); } }
  else if (d < PREY.flee) panic(game, e, m);
  const rng = reach(m, e);
  if (rng > 0 && d <= rng) {
    m.moving = false;
    faceTowards(m, e);
    if (m.swingT <= 0) bitePrey(game, m, e, sp, rng);
  } else {
    // wild: creep while far, sprint the last stretch (the prey runs once it sees the predator: HUNT.flee)
    const spd = sp.speed * (wild ? (d > HUNT.flee - 0.5 && !m._panic ? HUNT.creep : HUNT.sprint) : 1);
    m.speedK = wild ? spd / sp.speed : 1;
    const dir = steer(game, m, e.x, e.y, dt, spd, Math.max(0.2, rng * 0.85), e.lv | 0);
    go(game, m, dir, spd, dt);
  }
}

export function updateCreature(game, m, dt) {
  if (m.proxy) { game.net.violation('updateCreature num proxy'); return; }
  const sp = SPECIES[m.species] || SPECIES.wolf;
  const p = pickTarget(game, m);
  if (!tickStatus(game, m, dt)) return;
  const d = dist(m, p);
  m.thinkT = (m.thinkT || 0) - dt;

  // fear (torch): run from the player, then resume (hostiles come back angry)
  if (m.fearT > 0) {
    m.fearT -= dt;
    if (m.state !== 'flee') { m.state = 'flee'; m.fleeFrom = p; m.fleeDir = null; resetNav(m); }
    m.fleeT = Math.max(m.fleeT || 0, m.fearT);
    if (m.fearT <= 0) { m.fearT = 0; if (sp.temper !== 'passive' && !p.dead) { m.state = 'idle'; aggro(game, m, p); } }
  }

  switch (m.state) {
    case 'idle':
    case 'wander': {
      // perception
      if (m.thinkT <= 0) {
        m.thinkT = 0.25 + Math.random() * 0.1;
        if (!p.dead) {
          if (sp.temper === 'hostile' && d < aggroRadius(m, p) && !(m.calmT > 0) && (d < SMELL || hasLOS(game.world, m.x, m.y, p.x, p.y, m.z || 0, p.z || 0, m._tn, p._tn))) { aggro(game, m, p); break; }
          if (sp.temper === 'passive' && sp.calm) {
            // calm grazers (wild horses, docs/HORSE.md): walking up to them is fine; someone running / galloping at them
            // within `calm` tiles spooks the herd (a horse calmed by wheat from a hand stays put a while: calmT)
            if (d < sp.calm && !(m.calmT > 0) && fastMover(game, p)) { startFlee(m, p, 3.5 + Math.random() * 1.5); break; }
          } else if (sp.temper === 'passive') {
            const sk = sp.skittish || 0;
            if (d < Math.max(2.2, sk) || (d < 4.5 && p.moving)) { startFlee(m, p, (sk ? 3.5 : 2.5) + Math.random() * 1.5); break; }
          }
        }
        if (sp.temper === 'hostile' && lookForPrey(game, m)) break; // (night: farm animals in sight)
      }
      if (m.state === 'idle') {
        m.moving = false;
        m.stateT -= dt;
        if (m.stateT <= 0) {
          m.wp = m.leaving && !p.dead ? leaveSpot(game, m, p) : pickWander(game, m);
          m.state = 'wander';
          m.stateT = 8;
          resetNav(m);
        }
      } else {
        m.stateT -= dt;
        const ws = sp.speed * (m.leaving ? 0.55 : 0.32);
        const dir = steer(game, m, m.wp[0], m.wp[1], dt, ws, 0.3);
        if (!dir || m.stateT <= 0) { m.state = 'idle'; m.stateT = m.leaving ? 0.3 : 2 + Math.random() * 5; m.moving = false; }
        else go(game, m, dir, ws, dt);
      }
      // slow regen when calm
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05 * dt);
      break;
    }

    case 'flee': {
      m.fleeT -= dt;
      const f = m.fleeFrom || p;
      const homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);
      // re-pick a direction a few times per second (corners, rivers, walls)
      m.fleeRe = (m.fleeRe || 0) - dt;
      if (!m.fleeDir || m.fleeRe <= 0) { m.fleeRe = 0.35; m.fleeDir = fleeDir(game, m, f, homeD > FLEE_LEASH ? 1.2 : 0); }
      const dir = m.fleeDir;
      const fast = m.fleeT > 1 || m.fearT > 0;
      if (dir && mobBlocked(game.world, m.x + dir[0] * 0.35, m.y + dir[1] * 0.35, m.r)) m.fleeRe = 0;
      go(game, m, dir, sp.speed * (fast ? 1 : 0.7), dt);
      if (m.fleeT <= 0 && !(m.fearT > 0)) { m.state = 'idle'; m.stateT = 1 + Math.random() * 2; m.fleeDir = null; }
      break;
    }

    case 'chase': {
      const t = m.threat;
      const homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);
      if (!t || t.dead || t.gone || homeD > LEASH || game.worldTime - (m.lastCombatT || 0) > BORED || (m.nav && m.nav.fails > 3)) { evade(m, homeD > LEASH ? 4 : 9); break; }
      if (m.cave) {
        // out of the cave in the daylight: a few seconds, then back to the nest (at night or underground: as usual)
        const sun = !game.world.isCave(Math.floor(m.x), Math.floor(m.y)) && nightK(game.env?.hour ?? 12) < 0.5;
        m.sunT = sun ? (m.sunT || 0) + dt : Math.max(0, (m.sunT || 0) - dt);
        if (m.sunT > SUN_LEASH) { m.sunT = 0; evade(m, 10); break; }
      }
      if (t === game.player) enterCombat(t, 1);
      const rng = reach(m, t);
      if (d <= rng) {
        m.moving = false;
        faceTowards(m, t);
        if (m.swingT <= 0) bite(game, m, t, sp, rng);
      } else {
        const spd = sp.speed * (m.speedK ?? 1); // (speedK: a stalking cat creeps, then pounces — game/fauna.js)
        const dir = steer(game, m, t.x, t.y, dt, spd, rng * 0.85, t.lv | 0); // levels: the target's story (stairs as portals)
        go(game, m, dir, spd, dt);
      }
      break;
    }

    case 'hunt': {
      // a player in sight still comes first
      if (m.thinkT <= 0) {
        m.thinkT = 0.25 + Math.random() * 0.1;
        if (!p.dead && d < aggroRadius(m, p) && !(m.calmT > 0) && (d < SMELL || hasLOS(game.world, m.x, m.y, p.x, p.y, m.z || 0, p.z || 0, m._tn, p._tn))) { m.prey = null; m.state = 'idle'; aggro(game, m, p); break; }
      }
      huntStep(game, m, dt, sp);
      break;
    }

    case 'evade': {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.3 * dt);
      m.stateT -= dt;
      if (m.stateT <= 0) { m.x = m.home.x; m.y = m.home.y; m.lv = 0; m.z = 0; } // hopelessly stuck: snap home
      const dir = steer(game, m, m.home.x, m.home.y, dt, sp.speed * 1.4, 0.8, 0);
      if (!dir) { m.hp = m.maxHp; m.state = 'idle'; m.stateT = 1.5; m.moving = false; resetNav(m); }
      else go(game, m, dir, sp.speed * 1.4, dt);
      break;
    }
    default:
      m.state = 'idle'; m.stateT = 1;
  }
}
