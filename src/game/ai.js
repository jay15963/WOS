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
import { reach, dist, faceTowards, mobEffect } from './combat.js';
import { enterCombat } from './player.js';
import { nearestPlayer, hurtPlayer } from './players.js';
import { stepGait } from './anim.js';

export const LEASH = 26;  // max distance from home while chasing
const BORED = 11;         // seconds without exchanging blows before evading

export function aggroRadius(m, p) {
  const sp = SPECIES[m.species];
  const k = Math.max(0.35, Math.min(1.6, 1 + 0.15 * (m.level - p.level)));
  return (m.aggroR ?? sp.aggro ?? 0) * k;
}

// who this creature cares about: its threat while chasing, else the nearest player
export function pickTarget(game, m) {
  if (m.state === 'chase' && m.threat && !m.threat.gone) return m.threat;
  return nearestPlayer(game, m.x, m.y, 60, { alive: false }) || game.player;
}

// m was damaged / provoked by src
export function aggro(game, m, src, social = true) {
  if (!m || m.dead || m.isProp) return;
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
  m.stateT = 12;
  m.calmT = calm; // seconds of ignoring the player after giving up (unreachable / bored)
  m.threat = null;
  m.action = null;
  m.cast = null;
  m.blocking = false;
  resetNav(m);
}

export function pickWander(game, m, rMax = 5) {
  const w = game.world;
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * rMax;
    const x = m.home.x + Math.cos(a) * r, y = m.home.y + Math.sin(a) * r;
    if (!mobBlocked(w, x, y, m.r) && w.waterAt(Math.floor(x), Math.floor(y)) !== 2) return [x, y];
  }
  return [m.home.x, m.home.y];
}

export function go(game, m, dir, speed, dt) {
  if (!dir) { m.moving = false; return; }
  let spd = speed * game.world.speedAt(m.x, m.y);
  if (m.dazeT > 0) spd *= 0.45;
  const x0 = m.x, y0 = m.y;
  moveMob(game, m, dir[0] * spd * dt, dir[1] * spd * dt);
  m.facing = facingFrom(dir[0], dir[1], m.facing);
  m.moving = true;
  stepGait(m, Math.hypot(m.x - x0, m.y - y0));
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

// creature melee swing at a player (shared by animals; raiders use their own variants)
function bite(game, m, p, sp, rng) {
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
          if (sp.temper === 'hostile' && d < aggroRadius(m, p) && !(m.calmT > 0)) { aggro(game, m, p); break; }
          if (sp.temper === 'passive') {
            const sk = sp.skittish || 0;
            if (d < Math.max(2.2, sk) || (d < 4.5 && p.moving)) { startFlee(m, p, (sk ? 3.5 : 2.5) + Math.random() * 1.5); break; }
          }
        }
      }
      if (m.state === 'idle') {
        m.moving = false;
        m.stateT -= dt;
        if (m.stateT <= 0) {
          m.wp = pickWander(game, m);
          m.state = 'wander';
          m.stateT = 8;
          resetNav(m);
        }
      } else {
        m.stateT -= dt;
        const dir = steer(game, m, m.wp[0], m.wp[1], dt, sp.speed * 0.32, 0.3);
        if (!dir || m.stateT <= 0) { m.state = 'idle'; m.stateT = 2 + Math.random() * 5; m.moving = false; }
        else go(game, m, dir, sp.speed * 0.32, dt);
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
      if (!m.fleeDir || m.fleeRe <= 0) { m.fleeRe = 0.35; m.fleeDir = fleeDir(game, m, f, homeD > LEASH ? 1.2 : 0); }
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
      if (t === game.player) enterCombat(t, 1);
      const rng = reach(m, t);
      if (d <= rng) {
        m.moving = false;
        faceTowards(m, t);
        if (m.swingT <= 0) bite(game, m, t, sp, rng);
      } else {
        const dir = steer(game, m, t.x, t.y, dt, sp.speed, rng * 0.85);
        go(game, m, dir, sp.speed, dt);
      }
      break;
    }

    case 'evade': {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.3 * dt);
      m.stateT -= dt;
      if (m.stateT <= 0) { m.x = m.home.x; m.y = m.home.y; } // hopelessly stuck: snap home
      const dir = steer(game, m, m.home.x, m.home.y, dt, sp.speed * 1.4, 0.8);
      if (!dir) { m.hp = m.maxHp; m.state = 'idle'; m.stateT = 1.5; m.moving = false; resetNav(m); }
      else go(game, m, dir, sp.speed * 1.4, dt);
      break;
    }
    default:
      m.state = 'idle'; m.stateT = 1;
  }
}
