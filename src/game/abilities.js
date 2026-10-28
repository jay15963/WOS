// Action-bar abilities: GCD, cooldowns, energy, range checks, effects (strike, charge+stun,
// whirlwind, bandage HoT, sprint). Simulation only; HUD reads abilityState().

import { ABILITIES, GCD } from './data.js';
import { moveCircle, facingFrom } from './physics.js';
import { addBuff, enterCombat } from './player.js';
import { rollPlayerHit, applyPlayerHit, healEntity, reach, dist, attackable, faceTowards } from './combat.js';
import { aggro } from './ai.js';

const SPIN_DIRS = ['s', 'e', 'n', 'w'];

// nearest attackable creature within maxD (prefers ones fighting the player)
export function nearestEnemy(game, maxD = 12, filter) {
  const p = game.player;
  let best = null, bd = 1e9;
  for (const e of game.entities) {
    if (!attackable(e) || (filter && !filter(e))) continue;
    let d = dist(p, e);
    if (d > maxD) continue;
    if (e.state === 'chase' && e.threat === p) d -= 4;
    else if (e.temper === 'passive') d += 3;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function rangeOk(game, ab, t) {
  const p = game.player;
  if (!ab.range) return 'ok';
  if (!t) return 'notarget';
  const d = dist(p, t);
  if (ab.range === 'melee') return d <= reach(p, t) + 0.15 ? 'ok' : 'far';
  if (d < ab.range[0]) return 'near';
  if (d > ab.range[1]) return 'far';
  return 'ok';
}

// HUD-facing state for an ability button
export function abilityState(game, id) {
  const p = game.player, ab = ABILITIES[id];
  const cd = p.cds[id] || 0;
  const gcd = ab.offGcd ? 0 : p.gcdT;
  const t = attackable(p.target) ? p.target : null;
  const rs = ab.target ? (t ? rangeOk(game, ab, t) : 'ok') : 'ok';
  return {
    cd, cdDur: ab.cd, gcd, gcdDur: GCD,
    energyOk: p.energy >= ab.cost,
    inRange: rs === 'ok',
    usable: !p.dead && cd <= 0 && gcd <= 0 && p.energy >= ab.cost && rs === 'ok' && !p.charge,
  };
}

export function useAbility(game, id) {
  const p = game.player, ab = ABILITIES[id];
  const err = (text) => { game.events.emit('error', { text }); return false; };
  if (!ab || p.dead) return false;
  if (p.charge) return false;
  if ((p.cds[id] || 0) > 0) return err('Ainda não está pronto');
  if (!ab.offGcd && p.gcdT > 0) {
    // WoW-like queue window: a press near the end of the GCD fires as soon as it ends
    if (p.gcdT < 0.5) p.queued = id;
    return false;
  }
  if (p.energy < ab.cost) return err('Sem energia');

  let t = null;
  if (ab.target) {
    t = attackable(p.target) ? p.target : null;
    if (!t) {
      t = nearestEnemy(game, ab.range === 'melee' ? 3 : ab.range[1]);
      if (t) { p.target = t; game.events.emit('target', { target: t }); }
    }
    if (!t) return err('Sem alvo');
    const rs = rangeOk(game, ab, t);
    if (rs === 'far') return err('Muito longe');
    if (rs === 'near') return err('Perto demais');
  }

  // cancel gathering
  if (p.work) { p.work = null; p.action = null; }
  p.energy -= ab.cost;
  p.cds[id] = ab.cd;
  if (!ab.offGcd) p.gcdT = GCD;
  game.audio?.play('ui', { volume: 0.3 });

  switch (id) {
    case 'golpe': {
      p.weapon = 'sword';
      faceTowards(p, t);
      p.action = { type: 'attack', t: 0, dur: 0.32 };
      p.autoAttack = true;
      game.audio?.play('swing', { x: p.x, y: p.y });
      game.later(0.1, () => { if (!t.dead) applyPlayerHit(game, t, rollPlayerHit(game, t, 1.8, 4), { ability: id }); });
      break;
    }
    case 'investida': {
      p.weapon = 'sword';
      p.charge = { target: t, t: 0 };
      p.autoAttack = true;
      enterCombat(p);
      aggro(game, t, p);
      game.audio?.play('swing', { x: p.x, y: p.y });
      break;
    }
    case 'redemoinho': {
      p.weapon = 'sword';
      p.spin = { t: 0, dur: 0.5 };
      p.action = { type: 'attack', t: 0, dur: 0.5 };
      game.juice.whirl(p);
      game.audio?.play('swing', { x: p.x, y: p.y });
      let n = 0;
      for (const e of game.entities) {
        if (!attackable(e) || dist(p, e) > 2.3 + e.r) continue;
        n++;
        const hitE = e;
        game.later(0.08 + n * 0.03, () => applyPlayerHit(game, hitE, rollPlayerHit(game, hitE, 1.1, 2), { ability: id }));
      }
      if (n) enterCombat(p);
      break;
    }
    case 'bandagem': {
      const total = p.maxHp * 0.4, ticks = 8;
      addBuff(p, 'bandage', 8, { tick: 1, tickT: 1, onTick: (g, pl) => healEntity(g, pl, total / ticks) });
      p.action = { type: 'cast', t: 0, dur: 0.5 };
      game.audio?.play('eat', { x: p.x, y: p.y, volume: 0.5 });
      break;
    }
    case 'disparada': {
      addBuff(p, 'sprint', 5);
      game.juice.puff(p.x, p.y, 8);
      break;
    }
  }
  return true;
}

export function abilitiesSystem() {
  return {
    update(game, dt) {
      const p = game.player;
      p.gcdT = Math.max(0, p.gcdT - dt);
      for (const k in p.cds) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
      if (p.dead) { p.charge = null; p.spin = null; p.queued = null; return; }
      if (p.queued && p.gcdT <= 0 && !p.charge) { const id = p.queued; p.queued = null; useAbility(game, id); }

      // charge: fast dash to target, then stun
      if (p.charge) {
        const c = p.charge, t = c.target;
        c.t += dt;
        p.rooted = true;
        if (!t || t.dead) { p.charge = null; p.rooted = false; }
        else {
          const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
          const stopAt = reach(p, t) - 0.25;
          const step = Math.min(22 * dt, Math.max(0, d - stopAt));
          const moved = step > 0 && moveCircle(game.world, p, (dx / d) * step, (dy / d) * step);
          p.facing = facingFrom(dx, dy, p.facing);
          p.moving = true; p.moveT += dt * 4;
          game.juice.trail(p);
          if (d - step <= stopAt + 0.05 || !moved || c.t > 0.8) {
            p.charge = null; p.rooted = false; p.moving = false;
            if (dist(p, t) <= reach(p, t) + 0.6) {
              t.stunT = 1.5;
              game.juice.stun(t);
              game.juice.shake(0.3);
              p.action = { type: 'attack', t: 0, dur: 0.3 };
              applyPlayerHit(game, t, rollPlayerHit(game, t, 0.6, 2, false), { ability: 'investida' });
              game.events.emit('damage', { target: t, src: p, amount: 0, kind: 'stun' });
            }
          }
        }
      }

      // whirlwind spin visual: cycle facing
      if (p.spin) {
        p.spin.t += dt;
        p.facing = SPIN_DIRS[Math.floor(p.spin.t * 16) % 4];
        if (p.spin.t >= p.spin.dur) p.spin = null;
      }
    },
  };
}

