// Creature brain (WoW-like): idle/wander, aggro by level-scaled radius, chase, swing-timer attacks,
// leash -> evade home with full regen, passive animals flee. Obstacle-aware via nav.steer.

import { SPECIES } from './data.js';
import { moveCircle, facingFrom, collides } from './physics.js';
import { steer, resetNav } from './nav.js';
import { dealDamage, reach, dist, faceTowards } from './combat.js';
import { enterCombat } from './player.js';

const LEASH = 26;        // max distance from home while chasing
const BORED = 11;        // seconds without exchanging blows before evading

export function aggroRadius(m, p) {
  const sp = SPECIES[m.species];
  const k = Math.max(0.35, Math.min(1.6, 1 + 0.15 * (m.level - p.level)));
  return (sp.aggro || 0) * k;
}

// m was damaged / provoked by src
export function aggro(game, m, src, social = true) {
  if (!m || m.dead || m.state === 'evade') return;
  const sp = SPECIES[m.species];
  m.lastCombatT = game.worldTime;
  if (sp.temper === 'passive') {
    startFlee(m, src, 4 + Math.random() * 2);
    return;
  }
  const was = m.state === 'chase';
  m.state = 'chase';
  m.threat = src;
  if (!was) {
    resetNav(m);
    game.audio?.play('growl', { x: m.x, y: m.y });
    if (src === game.player) enterCombat(game.player);
    if (social && sp.social) {
      for (const o of game.entities) {
        if (o !== m && o.kind === 'animal' && !o.dead && o.species === m.species && o.state !== 'chase' && dist(o, m) < 8) aggro(game, o, src, false);
      }
    }
  }
}

function startFlee(m, from, t) {
  m.state = 'flee';
  m.fleeT = t;
  m.fleeFrom = from;
  resetNav(m);
}

export function evade(m) {
  if (m.dead) return;
  m.state = 'evade';
  m.stateT = 12;
  m.threat = null;
  m.action = null;
  resetNav(m);
}

function pickWander(game, m) {
  const w = game.world;
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5;
    const x = m.home.x + Math.cos(a) * r, y = m.home.y + Math.sin(a) * r;
    if (!collides(w, x, y, m.r) && w.waterAt(Math.floor(x), Math.floor(y)) !== 2) return [x, y];
  }
  return [m.home.x, m.home.y];
}

function go(game, m, dir, speed, dt) {
  if (!dir) { m.moving = false; return; }
  const spd = speed * game.world.speedAt(m.x, m.y);
  moveCircle(game.world, m, dir[0] * spd * dt, dir[1] * spd * dt);
  m.facing = facingFrom(dir[0], dir[1], m.facing);
  m.moving = true;
  m.moveT += dt * (spd / 4);
}

export function updateCreature(game, m, dt) {
  const sp = SPECIES[m.species];
  const p = game.player;
  m.swingT = Math.max(0, (m.swingT || 0) - dt);
  if (m.action) {
    m.action.t += dt / (m.action.dur || 0.5);
    if (m.action.t >= 1) m.action = null;
  }
  if (m.stunT > 0) {
    m.stunT -= dt;
    m.moving = false;
    m.action = null;
    return;
  }
  const d = dist(m, p);
  m.thinkT = (m.thinkT || 0) - dt;

  switch (m.state) {
    case 'idle':
    case 'wander': {
      // perception
      if (m.thinkT <= 0) {
        m.thinkT = 0.25 + Math.random() * 0.1;
        if (!p.dead) {
          if (sp.temper === 'hostile' && d < aggroRadius(m, p)) { aggro(game, m, p); break; }
          if (sp.temper === 'passive' && (d < 2.2 || (d < 4.5 && p.moving))) { startFlee(m, p, 2.5 + Math.random() * 1.5); break; }
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
      let ax = m.x - f.x, ay = m.y - f.y;
      const L = Math.hypot(ax, ay) || 1;
      ax /= L; ay /= L;
      const homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);
      if (homeD > LEASH) { ax = (m.home.x - m.x) / homeD; ay = (m.home.y - m.y) / homeD; }
      const dir = steer(game, m, m.x + ax * 4, m.y + ay * 4, dt, sp.speed, 0.1);
      go(game, m, dir, sp.speed * (m.fleeT > 1 ? 1 : 0.7), dt);
      if (m.fleeT <= 0) { m.state = 'idle'; m.stateT = 1 + Math.random() * 2; }
      break;
    }

    case 'chase': {
      const t = m.threat;
      const homeD = Math.hypot(m.x - m.home.x, m.y - m.home.y);
      if (!t || t.dead || homeD > LEASH || game.worldTime - (m.lastCombatT || 0) > BORED || (m.nav && m.nav.fails > 3)) { evade(m); break; }
      if (t === p) enterCombat(p, 1);
      const rng = reach(m, t);
      if (d <= rng && t === p) {
        m.moving = false;
        faceTowards(m, t);
        if (m.swingT <= 0) {
          m.swingT = sp.swing * (0.9 + Math.random() * 0.2);
          m.action = { type: 'attack', t: 0, dur: 0.5 };
          game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
          game.later(0.24, () => {
            if (m.dead || m.stunT > 0 || p.dead || dist(m, p) > rng + 0.6) return;
            m.lastCombatT = game.worldTime;
            const crit = Math.random() < 0.05;
            dealDamage(game, m, p, Math.max(1, Math.round(m.dmg * (0.8 + Math.random() * 0.4) * (crit ? 1.5 : 1))), { crit });
          });
        }
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
