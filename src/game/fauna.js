// Wild fauna behaviour (docs/FAUNA.md; numbers in content/fauna.js). HOST only, like every creature: mobs.js
// spawnMember → setupFauna gives the members of a fauna spawner this brain; guests draw AI-less proxies (entity
// stream) and read the shared `fmode` bits (flying / hidden / in a tree / resting, art/faunaDraw.js FMODE).
//
//   walkers (move 'walk')      the generic creature brain (ai.js updateCreature) plus: herds that flee together,
//                              territorial neutrals that charge a player too close, prides resting by day (they see
//                              less), stalkers that creep and then pounce (speedK), a snake hidden in the grass that
//                              strikes when stepped near, monkeys that run up a tree, herds that wander the land
//   climbers / amphibians      their own simple brain (idle, wander, flee, chase, evade) with their own footing:
//                              goats and yaks climb rock and cliffs nobody else can; crocodiles, seals and crabs walk
//                              and swim; a crocodile lurks in the water with its eyes out and lunges at who comes near
//   swimmers (move 'swim')     deep water only: sharks hunt players who swim, dolphins play (jumps, ride along a
//                              boat), whales blow and dive
//   fliers (move 'fly')        on the ground (perched, in a tree, wading) until someone comes near or for a while,
//                              then flying (soaring circles, a flock together) and landing again; vultures come down
//                              to the dead, eagles dive at small animals
// Creative mode: every attack starts through ai.aggro, which never picks a fight with a player in creative.

import { SPECIES } from './data.js';
import { FAUNA } from './content/fauna.js';
import { WILD_COATS } from './content/horses.js';
import { FMODE } from '../art/faunaDraw.js';
import { updateCreature, aggro, startFlee, evade, tickStatus, aggroRadius, pickTarget, bite } from './ai.js';
import { mobBlocked, resetNav, steer } from './nav.js';
import { collides, facingFrom } from './physics.js';
import { reach, dist, faceTowards, hasLOS, dealDamage } from './combat.js';
import { allPlayers } from './players.js';
import { enterCombat } from './player.js';
import { stepGait } from './anim.js';
import { nightK } from './seasons.js';

const { FLY, HIDE, TREE, REST } = FMODE;
const R = Math.random; // (host-only cosmetic / AI choices, like ai.js)
const night = (game) => nightK(game.env?.hour ?? 12) > 0.5;
const setMode = (m, bit, on) => { m.fmode = on ? (m.fmode | 0) | bit : (m.fmode | 0) & ~bit; };
const SMELL = 3;

// ---------- setup (mobs.js spawnMember, host) ----------
export function setupFauna(game, m, s) {
  const F = FAUNA[m.species];
  if (!F) return;
  const roll = () => game.net.roll();
  m.fauna = F; m.brain = faunaBrain; m.fmode = 0;
  if (SPECIES[m.species].noCorpse) m.noCorpse = true;
  m.variant = (m.id & 1) && roll() < 0.35 ? 1 : 0; // (the second coat of the herd: art tint)
  if (m.species === 'wild_horse') { // horse coats (variant bits 2–3: dun / chestnut / grey / black — kept when tamed, docs/HORSE.md)
    let u = roll(), c = 0;
    for (let k = 1; k < WILD_COATS.length; k++) { if (u < WILD_COATS[k]) { c = k; break; } u -= WILD_COATS[k]; }
    m.variant |= c << 2;
  }
  if (m.species === 'lion') {
    // a pride: one male (the mane), the rest lionesses
    if (!s.members.some((o) => o.variant & 2) && (s.members.length === 0 || roll() < 0.2)) m.variant |= 2;
    else m.name = 'Leoa';
  }
  const w = game.world;
  if (F.move === 'swim') {
    m.noPush = true;
    const sp = waterNear(w, s.x, s.y, 4, 2, roll) || [s.x, s.y];
    m.x = sp[0]; m.y = sp[1]; m.home = { x: m.x, y: m.y };
  } else if (F.move === 'fly') {
    m.noPush = true;
    if (F.soar) { m.state = 'fly'; m.fmode = FLY; m.flyT = 30 + roll() * 120; } // (soarers: up in the air most of the time)
    else { m.state = 'perch'; m.stateT = 4 + roll() * 20; }
  } else if (F.ambush?.hide === 'water' || F.toWater) {
    // crocodiles lurk in the water: home on a water tile next to the bank
    const wp = waterNear(w, s.x, s.y, 4, 1);
    if (wp) { m.x = wp[0]; m.y = wp[1]; m.home = { x: m.x, y: m.y }; }
  }
}
// a water tile (class ≥ min) within r tiles of (x, y): the nearest, or one at random (roll: a pod spreads out)
function waterNear(w, x, y, r, min = 1, roll = null) {
  let best = null, bd = 1e9, n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
    if (!w.inBounds(tx, ty) || w.liquidAt(tx, ty, true) < min) continue;
    const d = roll ? 0 : dx * dx + dy * dy;
    if (roll ? roll() * ++n < 1 : d < bd) { bd = d; best = [tx + 0.2 + (roll ? roll() * 0.6 : 0.3), ty + 0.2 + (roll ? roll() * 0.6 : 0.3)]; }
  }
  return best;
}

export function faunaBrain(game, m, dt) {
  if (m.proxy) return;
  const F = m.fauna || FAUNA[m.species];
  if (F.move === 'fly') return birdBrain(game, m, dt, F);
  if (F.move === 'swim') return swimBrain(game, m, dt, F);
  if (F.move === 'amphib' || F.move === 'climb') return roamBrain(game, m, dt, F);
  return walkBrain(game, m, dt, F);
}

// ---------- footing ----------
// can a creature of this kind stand at (x, y)? walkers: like every creature; climbers: rock and cliffs too;
// amphibians: deep water too; swimmers: deep water only; fliers: anywhere in the world
function climbBlocked(w, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!w.inBounds(tx, ty)) return true;
    const i = w.idx(tx, ty);
    const wa = w.water.get(i), so = w.solid.get(i);
    if ((wa === 2 && !w.iceAt(i)) || so === 1 || so === 2) {
      const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  }
  let hit = false;
  w.forChunks(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (c) => {
    if (hit) return;
    for (const o of c.objects) { if (!o.solid || o.stump || o.fall) continue; const rr = r + o.solid; if (w.dx(x, o.x) ** 2 + (y - (o.cy ?? o.y)) ** 2 < rr * rr) { hit = true; return; } }
  });
  return hit;
}
export function blockedFor(game, m, x, y) {
  const w = game.world, F = m.fauna, tx = Math.floor(x), ty = Math.floor(y);
  if (!w.inBounds(tx, ty)) return true;
  switch (F?.move) {
    case 'fly': return false;
    case 'swim': return w.liquidAt(tx, ty, true) !== 2;
    case 'amphib': return collides(w, x, y, m.r, null, false, true);
    case 'climb': return climbBlocked(w, x, y, m.r);
    default: return mobBlocked(w, x, y, m.r);
  }
}
// move by (dx, dy) along the axes (sliding along what blocks)
function moveF(game, m, dx, dy) {
  const x0 = m.x, y0 = m.y;
  if (!blockedFor(game, m, m.x + dx, m.y)) m.x += dx;
  if (!blockedFor(game, m, m.x, m.y + dy)) m.y += dy;
  const d = Math.hypot(m.x - x0, m.y - y0);
  if (d > 0) { m.facing = facingFrom(dx, dy, m.facing); stepGait(m, d); }
  return d > 0;
}
// a step toward (tx, ty) at spd: straight, else turned up to 90° around what is in the way; false = arrived / stuck
function stepTo(game, m, tx, ty, spd, dt, arrive = 0.3) {
  const dx = tx - m.x, dy = ty - m.y, L = Math.hypot(dx, dy);
  if (L < arrive) { m.moving = false; return false; }
  const ux = dx / L, uy = dy / L, s = Math.min(L, spd * dt);
  for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.6, -1.6]) {
    const c = Math.cos(a), sn = Math.sin(a), vx = ux * c - uy * sn, vy = ux * sn + uy * c;
    if (blockedFor(game, m, m.x + vx * Math.max(0.35, m.r + 0.1), m.y + vy * Math.max(0.35, m.r + 0.1))) continue;
    if (moveF(game, m, vx * s, vy * s)) { m.moving = true; if (m.fauna?.sideways) m.facing = facingFrom(-vy, vx, m.facing) === 'w' ? 'w' : 'e'; return true; }
  }
  m.moving = false;
  return false;
}
// a spot within r of (cx, cy) where it can stand (pred: an extra test), or null
function spotNear(game, m, cx, cy, r, pred = null, tries = 8) {
  for (let k = 0; k < tries; k++) {
    const a = R() * Math.PI * 2, d = 0.8 + R() * r, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (!blockedFor(game, m, x, y) && (!pred || pred(x, y))) return [x, y];
  }
  return null;
}
// the best open direction away from `from` for this kind's footing (8 samples)
function fleeDirF(game, m, from, pref = null) {
  let ax = m.x - from.x, ay = m.y - from.y;
  const L = Math.hypot(ax, ay) || 1; ax /= L; ay /= L;
  let best = null, bs = -1e9;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let sc = dx * ax + dy * ay, open = 0;
    for (const s of [0.6, 1.3, 2.2]) { if (blockedFor(game, m, m.x + dx * s, m.y + dy * s)) break; open++; }
    sc += open * 0.45 - (open === 0 ? 3 : 0);
    if (pref) sc += pref(m.x + dx * 2, m.y + dy * 2) ? 0.9 : 0;
    if (sc > bs) { bs = sc; best = [dx, dy]; }
  }
  return best;
}
const swimming = (game, q) => !q.dead && !q._boat && !(q.z > 0) && game.world.liquidAt(Math.floor(q.x), Math.floor(q.y)) === 2;
// the nearest live player matching pred within r (in sight past SMELL)
function seePlayer(game, m, r, pred = null) {
  let best = null, bd = r;
  for (const q of allPlayers(game)) {
    if (q.dead || q.ghost || (pred && !pred(q))) continue; // (ghost: the simulation's spectator)
    const d = Math.hypot(q.x - m.x, q.y - m.y);
    if (d >= bd) continue;
    if (d > SMELL && !hasLOS(game.world, m.x, m.y, q.x, q.y, m.z || 0, q.z || 0, m._tn, q._tn)) continue;
    best = q; bd = d;
  }
  return best;
}
// the herd runs together: the others of its kind close by run from the same thing
function herdFlee(game, m) {
  for (const o of game.entities) {
    if (o === m || o.dead || o.proxy || o.species !== m.species || o.state === 'flee' || o.state === 'chase' || o.calmT > 0) continue; // (calmT: a wild horse eating from a hand stays, docs/HORSE.md)
    if (Math.abs(o.x - m.x) > 14 || Math.abs(o.y - m.y) > 14) continue;
    startFlee(o, m.fleeFrom || m, Math.max(3, m.fleeT || 3) + R() * 1.5);
  }
}
// herds wander the land: now and then the herd's ground (its spawner) moves a few tiles, the members follow
function migrate(game, m) {
  const s = m.spawner;
  if (!s || s.loose || s.members.find((o) => !o.dead) !== m) return;
  s.x0 ??= s.x; s.y0 ??= s.y;
  if (s._migT == null) s._migT = game.worldTime + 50 + R() * 60;
  if (game.worldTime < s._migT || m.state === 'flee' || m.state === 'chase') return;
  s._migT = game.worldTime + 70 + R() * 90;
  const w = game.world, bio = (x, y) => (w.pbiome ? w.pbiome.get(w.idx(Math.floor(x), Math.floor(y))) : 255), b0 = bio(s.x, s.y);
  for (let k = 0; k < 10; k++) {
    const a = R() * Math.PI * 2, r = 6 + R() * 7, x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
    if (Math.hypot(w.dx(x, s.x0), y - s.y0) > 40 || !w.inBounds(Math.floor(x), Math.floor(y)) || blockedFor(game, m, x, y) || w.waterAt(Math.floor(x), Math.floor(y))) continue;
    if (b0 !== 255 && bio(x, y) !== b0) continue;
    if (s.chunk != null && w.chunkIndex?.(x, y) !== s.chunk) continue; // (a chunk's spawner stays in its chunk: it leaves with it)
    s.x = x; s.y = y;
    for (const o of s.members) if (!o.dead) o.home = { x: x + (R() - 0.5) * 3, y: y + (R() - 0.5) * 3 };
    return;
  }
}

// =====================================================================================================================
// walkers: ai.js updateCreature + the species' habits
// =====================================================================================================================
function walkBrain(game, m, dt, F) {
  const was = m.state;
  const calm = m.state === 'idle' || m.state === 'wander';
  m._ft = (m._ft || 0) - dt;
  const think = m._ft <= 0;
  if (think) m._ft = 0.3 + R() * 0.1;
  // prides rest by day (lying down, seeing less) and hunt from dusk
  if (F.rest === 'day') {
    const resting = !night(game) && calm && !m.leaving;
    m.aggroR = resting ? F.restAggro : undefined;
    if (resting && m.state === 'idle') m.stateT = Math.max(m.stateT, 1.5);
    setMode(m, REST, resting && m.state === 'idle');
  }
  if (F.lounge) lounge(game, m, dt, F, calm);
  // stalkers creep while far and pounce close in
  if (F.stalk) m.speedK = m.state === 'chase' && m.threat ? (dist(m, m.threat) > 4.5 ? 0.6 : 1.3) : 1;
  // a neutral that wants its space: charges a player too close (in sight)
  if (F.territorial && calm && think && !(m.calmT > 0)) {
    const p = seePlayer(game, m, F.territorial);
    if (p) { aggro(game, m, p); if (m.state === 'chase') { game.audio?.play('growl', { x: m.x, y: m.y, volume: 0.8 }); m.calmT = 0; } }
  }
  // a snake hidden in the grass: strikes only when stepped near (a rattle first)
  if (F.ambush) {
    const hidden = calm && Math.hypot(m.x - m.home.x, m.y - m.home.y) < 1.5 && !m.leaving;
    setMode(m, HIDE, hidden && m.state === 'idle');
    m.aggroR = hidden ? F.ambush.r : undefined;
    if (hidden && m.state === 'idle') m.stateT = Math.max(m.stateT, 1);
    if (hidden && think && F.ambush.warn && seePlayer(game, m, F.ambush.warn) && !(m._warnT > game.worldTime)) { m._warnT = game.worldTime + 3; game.audio?.play('growl', { x: m.x, y: m.y, volume: 0.35 }); }
  }
  if (F.trees && treeStep(game, m, dt, F, think)) return;
  updateCreature(game, m, dt);
  if (F.herd && m.state === 'flee' && was !== 'flee') herdFlee(game, m);
  if (m.state !== 'idle') { setMode(m, REST, false); if (m.state !== 'wander') setMode(m, HIDE, false); }
  if (F.migrate) migrate(game, m);
}
function lounge(game, m, dt, F, calm) {
  if (!calm || m.moving) { if (m.fmode & REST && !calm) setMode(m, REST, false); m._lounge = 0; return; }
  if (m.fmode & REST) {
    m._lounge -= dt;
    m.stateT = Math.max(m.stateT, 0.5);
    if (m._lounge <= 0) setMode(m, REST, false);
  } else if (m.state === 'idle' && R() < dt * F.lounge * 0.1) { setMode(m, REST, true); m._lounge = 15 + R() * 20; }
}
// monkeys: someone close → up the nearest tree (shown up in its crown), down again once they are gone
function treeStep(game, m, dt, F, think) {
  if (m.state === 'chase' || m.state === 'evade' || m.stunT > 0) { if (m._tree) { m._tree = null; setMode(m, TREE, false); } return false; }
  if (m._tree) {
    m.moving = false;
    if (think) { if (seePlayer(game, m, F.trees * 1.35)) m._treeT = 4 + R() * 3; else m._treeT -= 0.35; }
    if (m._treeT <= 0 || m._tree.stump || m._tree.gone) {
      setMode(m, TREE, false); m._tree = null; m.state = 'idle'; m.stateT = 2;
      const s = spotNear(game, m, m.x, m.y, 1.2); if (s) { m.x = s[0]; m.y = s[1]; }
    }
    return true;
  }
  if (m.state === 'climb') {
    const o = m._climbTo;
    if (!o || o.stump || (m.climbT -= dt) <= 0) { m.state = 'idle'; m.stateT = 1; return false; }
    const gx = o.x, gy = o.y + 0.55;
    if (Math.hypot(m.x - gx, m.y - gy) < 0.45) { m._tree = o; m._treeT = 5; m.x = o.x; m.y = o.y + 0.04; setMode(m, TREE, true); m.state = 'idle'; game.audio?.play('growl', { x: m.x, y: m.y, volume: 0.3 }); return true; }
    const sp = SPECIES[m.species].speed * 1.1, dir = steer(game, m, gx, gy, dt, sp, 0.3);
    if (!dir) { m.state = 'idle'; m.stateT = 1; return false; }
    m.moving = moveF(game, m, dir[0] * sp * dt, dir[1] * sp * dt);
    return true;
  }
  if (!think || m.state === 'flee') return false;
  const p = seePlayer(game, m, F.trees);
  if (!p) return false;
  let best = null, bd = 9;
  game.world.forChunks(m.x - 9, m.y - 9, m.x + 9, m.y + 9, (c) => {
    for (const o of c.objects) {
      if (!o.type?.startsWith('tree_') || o.stump || o.fall || (o.age ?? 1) < 0.8) continue;
      const d = Math.hypot(o.x - m.x, o.y - m.y), dp = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd && dp > 2) { bd = d; best = o; }
    }
  });
  if (!best) return false;
  m.state = 'climb'; m._climbTo = best; m.climbT = 6; resetNav(m);
  // the troop follows up the trees around
  for (const o of game.entities) if (o !== m && !o.dead && !o.proxy && o.species === m.species && !o._tree && o.state !== 'climb' && dist(o, m) < 9) o._ft = 0;
  return true;
}

// =====================================================================================================================
// climbers and amphibians: own simple brain with their own footing
// =====================================================================================================================
function roamBrain(game, m, dt, F) {
  const sp = SPECIES[m.species];
  if (!tickStatus(game, m, dt)) return;
  const w = game.world, p = pickTarget(game, m), d = dist(m, p);
  const wet = w.liquidAt(Math.floor(m.x), Math.floor(m.y), true) > 0;
  const spd = wet && F.water ? F.water : sp.speed;
  m.thinkT = (m.thinkT || 0) - dt;
  if (m.fearT > 0) {
    m.fearT -= dt;
    if (m.state !== 'flee') startFlee(m, p, m.fearT);
    m.fleeT = Math.max(m.fleeT || 0, m.fearT);
  }
  const amb = F.ambush;
  switch (m.state) {
    case 'idle': case 'wander': {
      if (m.thinkT <= 0) {
        m.thinkT = 0.28 + R() * 0.1;
        const hidden = !!(m.fmode & HIDE);
        if (!p.dead && !(m.calmT > 0)) {
          if (sp.temper === 'hostile') {
            const r = hidden && amb ? amb.r : aggroRadius(m, p);
            if (d < r && (d < SMELL || hasLOS(w, m.x, m.y, p.x, p.y, 0, p.z || 0, m._tn, p._tn))) { aggro(game, m, p); if (m.state === 'chase') { setMode(m, HIDE, false); m.lungeT = 0.8; } break; }
          } else if (sp.temper === 'passive') {
            if (d < (F.flee || 4) || (d < 6.5 && p.moving)) { startFlee(m, p, 3 + R() * 2); if (F.herd) herdFlee(game, m); break; }
          } else if (F.territorial && d < F.territorial && hasLOS(w, m.x, m.y, p.x, p.y, 0, p.z || 0, m._tn, p._tn)) { aggro(game, m, p); break; }
          else if (m.species === 'crab' && d < 1.6 && p.moving) { startFlee(m, p, 1.5); break; } // (a crab scuttles off)
        }
      }
      // a crocodile lies in wait in the water at home (eyes out only)
      if (amb && amb.hide === 'water') {
        const atHome = Math.hypot(m.x - m.home.x, m.y - m.home.y) < 1.2 && wet;
        if (m.state === 'idle' && atHome) { m._hideT = (m._hideT || 0) + dt; if (m._hideT > 2.5) setMode(m, HIDE, true); m.stateT = Math.max(m.stateT, 1); }
        else { m._hideT = 0; setMode(m, HIDE, false); }
      }
      if (m.state === 'idle') {
        m.moving = false; m.stateT -= dt;
        if (m.stateT <= 0) {
          const home = amb && amb.hide === 'water' ? [m.home.x, m.home.y] : spotNear(game, m, m.home.x, m.home.y, F.move === 'climb' ? 6 : 4);
          m.wp = home || [m.home.x, m.home.y];
          m.state = 'wander'; m.stateT = 9;
        }
      } else {
        m.stateT -= dt;
        if (!stepTo(game, m, m.wp[0], m.wp[1], spd * 0.35, dt) || m.stateT <= 0) { m.state = 'idle'; m.stateT = 2 + R() * 5; m.moving = false; }
      }
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05 * dt);
      break;
    }
    case 'flee': {
      m.fleeT -= dt;
      m.fleeRe = (m.fleeRe || 0) - dt;
      const from = m.fleeFrom || p;
      if (!m.fleeDir || m.fleeRe <= 0) {
        m.fleeRe = 0.35;
        // seals make for the water; goats for the rocks
        const pref = F.toWater ? (x, y) => w.liquidAt(Math.floor(x), Math.floor(y), true) > 0 : F.move === 'climb' ? (x, y) => !!w.rock.get(w.idx(Math.floor(x), Math.floor(y))) || w.isCliff?.(Math.floor(x), Math.floor(y)) : null;
        m.fleeDir = fleeDirF(game, m, from, pref);
      }
      const dir = m.fleeDir;
      if (dir) { if (!moveF(game, m, dir[0] * spd * dt, dir[1] * spd * dt)) m.fleeRe = 0; m.moving = true; }
      if (m.fleeT <= 0 && !(m.fearT > 0)) { m.state = 'idle'; m.stateT = 1 + R() * 2; m.fleeDir = null; m.moving = false; }
      break;
    }
    case 'chase': {
      const t = m.threat, homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);
      if (!t || t.dead || t.gone || homeD > (F.leash ?? 26) || game.worldTime - (m.lastCombatT || 0) > 25) { evade(m, 6); m.fmode = 0; break; }
      if (t === game.player) enterCombat(t, 1);
      const rng = reach(m, t);
      if (d <= rng) { m.moving = false; faceTowards(m, t); if (m.swingT <= 0) bite(game, m, t, sp, rng); }
      else {
        // a crocodile's lunge out of the water: a burst of speed first
        m.lungeT = Math.max(0, (m.lungeT || 0) - dt);
        stepTo(game, m, t.x, t.y, spd * (m.lungeT > 0 ? 2.2 : 1), dt, rng * 0.8);
      }
      break;
    }
    case 'evade': {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.3 * dt);
      m.stateT -= dt;
      if (m.stateT <= 0) { m.x = m.home.x; m.y = m.home.y; }
      if (!stepTo(game, m, m.home.x, m.home.y, spd * 1.2, dt, 0.5)) { m.state = 'idle'; m.stateT = 1.5; m.hp = m.maxHp; m.moving = false; }
      break;
    }
    default: m.state = 'idle'; m.stateT = 1;
  }
}

// =====================================================================================================================
// swimmers: deep water only
// =====================================================================================================================
function swimBrain(game, m, dt, F) {
  const sp = SPECIES[m.species];
  if (!tickStatus(game, m, dt)) return;
  const w = game.world;
  if (w.frozenAt(m.x, m.y)) { m.moving = false; return; }
  m.thinkT = (m.thinkT || 0) - dt;
  const think = m.thinkT <= 0;
  if (think) m.thinkT = 0.3 + R() * 0.1;
  const spd = sp.speed;
  // whales: up for a while (blowing every few seconds), then a dive (hidden) and up again further on
  if (F.dive) {
    m.surfT = (m.surfT ?? 12 + R() * 10) - dt;
    if (m.fmode & HIDE) { if (m.surfT <= 0) { setMode(m, HIDE, false); m.surfT = 16 + R() * 12; m.blowT = 1; } }
    else {
      m.blowT = (m.blowT ?? 3) - dt;
      if (m.blowT <= 0 && !m.action) { m.action = { type: 'spout', t: 0, dur: 2.4 }; m.blowT = 6 + R() * 4; }
      if (m.surfT <= 0 && !m.action) { m.action = { type: 'dive', t: 0, dur: 2.6 }; setMode(m, HIDE, true); m.surfT = 22 + R() * 20; }
    }
  }
  switch (m.state) {
    case 'chase': {
      const t = m.threat;
      if (!t || t.dead || t.gone || game.worldTime - (m.lastCombatT || 0) > 25) { m.state = 'idle'; m.threat = null; m.stateT = 2; break; }
      // out of the water: it gives up after a moment
      if (!swimming(game, t)) { m._dry = (m._dry || 0) + dt; if (m._dry > 2.5) { m._dry = 0; m.state = 'idle'; m.threat = null; m.calmT = 6; m.stateT = 2; break; } }
      else m._dry = 0;
      if (t === game.player) enterCombat(t, 1);
      const rng = reach(m, t), d = dist(m, t);
      if (d <= rng) { m.moving = false; faceTowards(m, t); if (m.swingT <= 0) bite(game, m, t, sp, rng); }
      else stepTo(game, m, t.x, t.y, spd, dt, rng * 0.8);
      break;
    }
    case 'flee': {
      m.fleeT -= dt;
      const from = m.fleeFrom || m.home;
      if (!m.fleeDir || (m.fleeRe = (m.fleeRe || 0) - dt) <= 0) { m.fleeRe = 0.4; m.fleeDir = fleeDirF(game, m, from); }
      if (m.fleeDir) { moveF(game, m, m.fleeDir[0] * spd * dt, m.fleeDir[1] * spd * dt); m.moving = true; }
      if (m.fleeT <= 0) { m.state = 'idle'; m.stateT = 1; m.fleeDir = null; }
      break;
    }
    default: {
      if (think && sp.temper === 'hostile' && !(m.calmT > 0)) {
        // sharks: only who is swimming (not on a boat, not on the shore)
        const q = seePlayer(game, m, aggroRadius(m, game.player) || sp.aggro, (q) => !F.swimTarget || swimming(game, q));
        if (q) { aggro(game, m, q); if (m.state === 'chase') break; }
      }
      if (m.calmT > 0) m.calmT -= dt;
      // dolphins: ride along a moving boat close by now and then; jump out of the water
      if (F.jump && m.moving && !m.action && R() < dt * 0.07) m.action = { type: 'jump', t: 0, dur: 1.1 };
      if (F.pod && think && game.boats?.map) {
        for (const b of game.boats.map.values()) {
          if (!b.seats?.some(Boolean) || Math.hypot(b.x - m.x, b.y - m.y) > 16) continue;
          const a = b.h || 0, side = (m.id & 1 ? 1 : -1) * 1.8;
          m.wp = [b.x + Math.cos(a + Math.PI / 2) * side + Math.cos(a) * 1.5, b.y + Math.sin(a + Math.PI / 2) * side + Math.sin(a) * 1.5];
          m.state = 'swim'; m.stateT = 1.2;
          break;
        }
      }
      m.stateT -= dt;
      if (m.state === 'swim' && m.wp) {
        if (!stepTo(game, m, m.wp[0], m.wp[1], m.stateT < 1.5 && F.pod ? spd : spd * (F.dive ? 0.5 : 0.4), dt, 0.6) || m.stateT <= 0) { m.state = 'idle'; m.stateT = 1 + R() * 3; m.moving = false; }
      } else {
        m.state = 'idle'; m.moving = false;
        if (m.stateT <= 0) {
          const s = spotNear(game, m, m.home.x, m.home.y, F.dive ? 14 : 8, null, 10);
          if (s) { m.wp = s; m.state = 'swim'; m.stateT = 10; } else m.stateT = 1;
        }
      }
    }
  }
}

// =====================================================================================================================
// fliers: perched / in a tree / wading ↔ flying (soaring circles, a flock together); vultures to the dead, eagles dive
// =====================================================================================================================
const SMALL = (F) => new Set(F.prey || []);
function landSpot(game, m, F) {
  const w = game.world, s = m.spawner, cx = s?.x ?? m.home.x, cy = s?.y ?? m.home.y;
  if (F.perch === 'tree') {
    let best = null, n = 0;
    w.forChunks(cx - 10, cy - 10, cx + 10, cy + 10, (c) => { for (const o of c.objects) if (o.type?.startsWith('tree_') && !o.stump && !o.fall && Math.hypot(o.x - cx, o.y - cy) < 10 && R() * ++n < 1) best = o; });
    if (best) return { x: best.x + (R() - 0.5) * 0.5, y: best.y + 0.04, tree: true };
  }
  for (let k = 0; k < 12; k++) {
    const a = R() * Math.PI * 2, r = R() * 6, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, tx = Math.floor(x), ty = Math.floor(y);
    if (!w.inBounds(tx, ty)) continue;
    const wa = w.liquidAt(tx, ty, true);
    if (F.perch === 'water' ? wa !== 1 && !(wa === 0 && k > 8) : wa) continue; // herons wade in shallow water
    if (wa === 0 && (w.rock.get(w.idx(tx, ty)) ? F.perch !== 'rock' : mobBlocked(w, x, y, m.r))) continue;
    return { x, y };
  }
  return { x: m.home.x, y: m.home.y };
}
function takeOff(game, m, from = null) {
  setMode(m, FLY, true); setMode(m, TREE, false);
  m.state = 'fly'; m.flyT = m.fauna?.soar ? 70 + R() * 110 : 25 + R() * 40; m.land = null;
  const a = from ? Math.atan2(m.y - from.y, m.x - from.x) + (R() - 0.5) : R() * Math.PI * 2;
  m.wp = [m.x + Math.cos(a) * 10, m.y + Math.sin(a) * 10];
  m.orbit = null;
  // the flock goes too
  if (m.spawner && !m.flockLead) for (const o of m.spawner.members) if (o !== m && !o.dead && o.state !== 'fly') { o.flockLead = m; takeOffMember(o); }
}
function takeOffMember(o) { setMode(o, FLY, true); setMode(o, TREE, false); o.state = 'fly'; o.flyT = 999; o.land = null; }
function birdBrain(game, m, dt, F) {
  const sp = SPECIES[m.species];
  if (!tickStatus(game, m, dt)) return;
  FLY_W = game.world;
  m.thinkT = (m.thinkT || 0) - dt;
  const think = m.thinkT <= 0;
  if (think) m.thinkT = 0.3 + R() * 0.1;
  const fspd = sp.speed * 2; // flying
  if (m.state === 'flee' || m.fearT > 0) { if (m.fearT > 0) m.fearT -= dt; takeOff(game, m, m.fleeFrom || pickTarget(game, m)); m.flockLead = null; }
  if (m.state === 'idle' || m.state === 'wander' || m.state === 'chase' || m.state === 'evade') { m.state = m.fmode & FLY ? 'fly' : 'perch'; m.flyT ??= 8; }
  if (m.state === 'perch') {
    m.moving = false;
    m.stateT -= dt;
    if (think) {
      const p = seePlayer(game, m, F.flush || 5);
      if (p) { takeOff(game, m, p); return; }
    }
    // a little walk now and then (not in a tree)
    if (!(m.fmode & TREE) && !m.hop && m.stateT > 2 && R() < dt * 0.15) { const s = spotNear(game, m, m.x, m.y, 1.2); if (s) m.hop = s; }
    if (m.hop) {
      const dx = m.hop[0] - m.x, dy = m.hop[1] - m.y, L = Math.hypot(dx, dy);
      if (L < 0.08) m.hop = null;
      else { const k = Math.min(L, 0.9 * dt); m.x += (dx / L) * k; m.y += (dy / L) * k; m.facing = facingFrom(dx, dy, m.facing); stepGait(m, k); m.moving = true; }
    }
    if (m.stateT <= 0 && !(m._eat > game.worldTime)) takeOff(game, m);
    return;
  }
  // flying
  const lead = m.flockLead && !m.flockLead.dead && m.flockLead.state === 'fly' ? m.flockLead : null;
  if (lead) {
    // a flock follows its leader in loose formation and lands with it
    const k = (m.id % 7) / 7 * Math.PI * 2, fx = lead.x + Math.cos(k) * 1.6, fy = lead.y + Math.sin(k) * 1.2;
    flyTo(m, fx, fy, fspd * 1.15, dt);
    return;
  }
  if (m.flockLead) { m.flockLead = null; if (m.state === 'fly' && !lead) m.flyT = Math.min(m.flyT, 3); }
  m.flyT -= dt;
  // vultures circle over a body and come down to it; eagles dive at small animals
  if (think && F.scavenge && !m.orbit) {
    let best = null, bd = 40;
    for (const c of game.corpses?.map?.values?.() || []) { if (c.of === 'pawn' || c.butchered) continue; const d = Math.hypot(c.x - m.x, c.y - m.y); if (d < bd) { bd = d; best = c; } }
    if (best) { m.orbit = { x: best.x, y: best.y, r: 3, t: 8 + R() * 6, body: best }; m.flyT = Math.max(m.flyT, 12); }
  }
  if (think && F.prey && !m.dive && m.flyT > 2) {
    const S = SMALL(F);
    for (const e of game.entities) {
      if (!e.isMob || e.dead || e.proxy || !S.has(e.species) || (e.fmode & TREE) || Math.hypot(e.x - m.x, e.y - m.y) > 14 || R() > 0.15) continue;
      m.dive = e; break;
    }
  }
  if (m.dive) {
    const e = m.dive;
    if (e.dead || Math.hypot(e.x - m.x, e.y - m.y) > 20) m.dive = null;
    else if (flyTo(m, e.x, e.y, fspd * 1.8, dt, 0.5)) {
      dealDamage(game, m, e, e.maxHp * 2, { knock: 0.05 });
      m.dive = null; m.land = { x: e.x + 0.6, y: e.y }; m.flyT = 0; m._eat = game.worldTime + 20;
    }
    return;
  }
  if (m.orbit) {
    const O = m.orbit;
    O.t -= dt;
    const a = Math.atan2(m.y - O.y, m.x - O.x) + dt * (fspd / O.r) * 0.8;
    flyTo(m, O.x + Math.cos(a) * O.r, O.y + Math.sin(a) * O.r, fspd, dt, 0.05);
    if (O.t <= 0) { m.land = { x: O.x + (R() - 0.5) * 2.4, y: O.y + 0.8 + R() * 0.6 }; m.orbit = null; m._eat = game.worldTime + 25 + R() * 20; m.flyT = 0; }
    return;
  }
  if (m.flyT <= 0) {
    if (!m.land) m.land = landSpot(game, m, F);
    if (flyTo(m, m.land.x, m.land.y, fspd * 0.8, dt, 0.25)) {
      // landed (unless someone is right there)
      if (seePlayer(game, m, (F.flush || 5) * 1.2)) { m.flyT = 6; m.land = null; return; }
      setMode(m, FLY, false); setMode(m, TREE, !!m.land.tree);
      m.state = 'perch'; m.stateT = m._eat > game.worldTime ? 25 + R() * 20 : (F.soar ? 8 : 12) + R() * (F.soar ? 10 : 22); m.moving = false; m.land = null;
      if (m.spawner) for (const o of m.spawner.members) if (o.flockLead === m) { o.flockLead = null; setMode(o, FLY, false); o.state = 'perch'; o.stateT = m.stateT + R() * 4; o.moving = false; o.x += (R() - 0.5) * 0.8; o.y += (R() - 0.5) * 0.8; if (m.fmode & TREE) setMode(o, TREE, true); }
    }
    return;
  }
  // soaring: wide circles around home; the others fly from place to place
  if (F.soar) {
    const a = Math.atan2(m.y - m.home.y, m.x - m.home.x) + dt * (fspd / 7) * 0.7;
    flyTo(m, m.home.x + Math.cos(a) * 7, m.home.y + Math.sin(a) * 7, fspd * 0.8, dt, 0.05);
  } else if (!m.wp || flyTo(m, m.wp[0], m.wp[1], fspd, dt, 0.6)) {
    const a = R() * Math.PI * 2, r = 3 + R() * 8;
    m.wp = [m.home.x + Math.cos(a) * r, m.home.y + Math.sin(a) * r];
  }
}
// straight flight toward (x, y) (kept inside the world: FLY_W); true = arrived
let FLY_W = null;
function flyTo(m, x, y, spd, dt, arrive = 0.3) {
  if (FLY_W) { x = Math.max(1, Math.min(FLY_W.W - 1, x)); y = Math.max(1, Math.min(FLY_W.H - 1, y)); }
  const dx = x - m.x, dy = y - m.y, L = Math.hypot(dx, dy);
  if (L < arrive) { m.moving = L > 0.02; return true; }
  const s = Math.min(L, spd * dt);
  m.x += (dx / L) * s; m.y += (dy / L) * s;
  m.facing = facingFrom(dx, dy, m.facing);
  stepGait(m, s);
  m.moving = true;
  return false;
}
