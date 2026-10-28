// Combat rules: hit rolls, damage/heal, deaths, loot & XP, player auto-attack swing timer.

import { SPECIES } from './data.js';
import { mobXp } from './stats.js';
import { gainXp, enterCombat, removeBuff, killPlayer, knock } from './player.js';
import { aggro } from './ai.js';
import { dropLoot } from './loot.js';
import { facingFrom } from './physics.js';

export const reach = (a, b) => a.r + b.r + 0.62;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const attackable = (e) => e && e.isEntity && e.kind === 'animal' && !e.dead;

// is `t` roughly in front of `e` (4-dir facing, generous cone)
export function facingOk(e, t) {
  const dx = t.x - e.x, dy = t.y - e.y, L = Math.hypot(dx, dy) || 1;
  const f = e.facing;
  const fx = f === 'e' ? 1 : f === 'w' ? -1 : 0, fy = f === 's' ? 1 : f === 'n' ? -1 : 0;
  return (dx * fx + dy * fy) / L > -0.2;
}

export function faceTowards(e, t) { e.facing = facingFrom(t.x - e.x, t.y - e.y, e.facing); }

// roll player weapon damage against a mob
export function rollPlayerHit(game, target, mult = 1, flat = 0, canMiss = true) {
  const p = game.player;
  const diff = Math.max(0, (target.level || 1) - p.level);
  if (canMiss && Math.random() < 0.04 + diff * 0.02) return { miss: true };
  const base = p.wMin + Math.random() * (p.wMax - p.wMin);
  const crit = Math.random() < p.crit;
  const amount = Math.max(1, Math.round((base * mult + flat) * p.dmgMul * (crit ? 1.8 : 1)));
  return { amount, crit };
}

export function applyPlayerHit(game, target, roll, opts = {}) {
  const p = game.player;
  if (roll.miss) {
    game.events.emit('damage', { target, src: p, amount: 0, kind: 'miss' });
    aggro(game, target, p);
    return 0;
  }
  return dealDamage(game, p, target, roll.amount, { crit: roll.crit, ...opts });
}

export function dealDamage(game, src, dst, amount, opts = {}) {
  if (!dst || dst.dead) return 0;
  const p = game.player;
  if (dst.state === 'evade') {
    game.events.emit('damage', { target: dst, src, amount: 0, kind: 'immune' });
    return 0;
  }
  if (dst === p && !opts.noDodge && Math.random() < p.dodge) {
    game.events.emit('damage', { target: dst, src, amount: 0, kind: 'dodge' });
    return 0;
  }
  dst.hp -= amount;
  dst.flash = 1;
  game.events.emit('damage', { target: dst, src, amount, crit: !!opts.crit, kind: 'hit', ability: opts.ability });
  const hx = dst.x, hy = dst.y;
  if (src !== dst) {
    game.juice.hit(hx, hy, opts.crit, dst === p ? [1, 0.45, 0.35] : null);
    game.juice.blood(hx, hy, opts.crit ? 7 : 4);
    game.audio?.play(opts.crit ? 'crit' : 'hit', { x: hx, y: hy });
  }
  if (!opts.noKnock && src !== dst) knock(game, dst, src.x, src.y, opts.crit ? 0.22 : 0.1);

  if (dst === p) {
    if (src !== p) enterCombat(p);
    if (src !== p && removeBuff(p, 'bandage')) game.events.emit('error', { text: 'Bandagem interrompida' });
    if (src !== p) game.juice.shake(amount >= p.maxHp * 0.12 ? 0.35 + Math.min(0.4, amount / p.maxHp) : 0.15);
    if (p.work && src !== p && p.work.it.kind !== "cook") { p.work = null; p.action = null; }
    if (p.hp <= 0) killPlayer(game);
  } else {
    if (src === p) {
      enterCombat(p);
      if (opts.crit) game.juice.shake(0.22);
    }
    dst.lastCombatT = game.worldTime;
    if (dst.hp <= 0) killMob(game, dst, src);
    else aggro(game, dst, src);
  }
  return amount;
}

export function healEntity(game, e, amount) {
  if (e.dead) return 0;
  const before = e.hp;
  e.hp = Math.min(e.maxHp, e.hp + amount);
  const got = Math.round(e.hp - before);
  if (got > 0) {
    game.events.emit('damage', { target: e, src: e, amount: got, kind: 'heal' });
    game.juice.heal(e);
  }
  return got;
}

export function killMob(game, m, killer) {
  m.hp = 0; m.dead = true; m.deadT = 0; m.action = null; m.moving = false; m.state = 'dead';
  m.diedAt = game.worldTime;
  const p = game.player;
  const sp = SPECIES[m.species];
  game.audio?.play('death', { x: m.x, y: m.y, volume: 0.6 });
  game.juice.puff(m.x, m.y, 8, [0.7, 0.64, 0.56], 0.7);
  if (killer === p) {
    const xp = mobXp(sp, m.level, p.level);
    if (xp) gainXp(game, xp);
    for (const [item, a, b, chance] of sp.loot) {
      if (Math.random() > chance) continue;
      const n = a + Math.floor(Math.random() * (b - a + 1));
      for (let i = 0; i < n; i++) dropLoot(game, m.x, m.y, item, 1);
    }
  }
  m.respawnAt = game.worldTime + (SPECIES[m.species].elite ? 300 : 100) + Math.random() * 80;
  game.events.emit('kill', { target: m });
  if (p.target === m) {
    p.autoAttack = false;
    game.later(1.2, () => { if (p.target === m) { p.target = null; game.events.emit('target', { target: null }); } });
  }
}

// ---------- player auto attack ----------
export function combatSystem() {
  return {
    update(game, dt) {
      const p = game.player;
      p.swingT = Math.max(0, p.swingT - dt);
      if (p.dead) return;
      const t = p.target;
      if (t && t.dead && p.autoAttack) p.autoAttack = false;
      if (!p.autoAttack || !attackable(t) || p.charge || p.spin) return;
      const d = dist(p, t);
      if (d > reach(p, t)) return;
      enterCombat(p, 2);
      if (!game.ctl?.manual) faceTowards(p, t);
      if (p.swingT > 0 || !facingOk(p, t)) return;
      if (p.work) { p.work = null; }
      p.weapon = 'sword';
      p.action = { type: 'attack', t: 0, dur: 0.38 };
      p.swingT = p.swing;
      game.audio?.play('swing', { x: p.x, y: p.y });
      game.later(0.14, () => {
        if (p.dead || t.dead || dist(p, t) > reach(p, t) + 0.5) return;
        applyPlayerHit(game, t, rollPlayerHit(game, t));
      });
    },
  };
}

