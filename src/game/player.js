// Player: stats/level, buffs, regeneration, XP, death & respawn. Simulation only.

import { Inventory } from './inventory.js';
import { playerStats, xpToNext, MAX_LEVEL } from './stats.js';
import { BUFFS } from './data.js';
import { moveCircle, collides } from './physics.js';

export function initPlayer(game) {
  const p = game.player;
  Object.assign(p, {
    name: 'Sobrevivente', level: 1, xp: 0,
    hunger: 100, maxHunger: 100, energy: 100, maxEnergy: 100,
    inv: new Inventory(24), buffs: [], // starts with NOTHING: empty backpack, bare hands
    equip: { main: null, off: null, body: null, head: null }, weapon: null, offhand: null, armor: { body: null, head: null },
    swingT: 0, combatT: 0, inCombat: false, gcdT: 0, cds: {},
    target: null, autoAttack: false, respawn: null, baseSpeed: 4.0,
    work: null, charge: null, spin: null, dmgMul: 1,
  });
  applyLevel(p);
  p.hp = p.maxHp;
}

export function applyLevel(p) {
  const s = playerStats(p.level);
  p.maxHp = s.maxHp; p.maxEnergy = s.maxEnergy;
  p.wMin = s.wMin; p.wMax = s.wMax; p.swing = s.swing; p.crit = s.crit; p.dodge = s.dodge;
}

// ---------- buffs ----------
export function addBuff(p, id, dur, data = {}) {
  let b = p.buffs.find((x) => x.id === id);
  if (!b) { b = { id, ...BUFFS[id], t: dur, dur, ...data }; p.buffs.push(b); }
  else Object.assign(b, { t: Math.max(b.t, dur), dur: Math.max(b.dur, dur) }, data);
  p.buffsV = (p.buffsV || 0) + 1;
  return b;
}
export function removeBuff(p, id) {
  const i = p.buffs.findIndex((x) => x.id === id);
  if (i < 0) return false;
  p.buffs.splice(i, 1);
  p.buffsV = (p.buffsV || 0) + 1;
  return true;
}
export const hasBuff = (p, id) => p.buffs.some((b) => b.id === id);

// ---------- xp ----------
export function gainXp(game, amount) {
  const p = game.player;
  if (amount <= 0 || p.level >= MAX_LEVEL) return;
  p.xp += amount;
  game.events.emit('xp', { amount });
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    applyLevel(p);
    p.hp = p.maxHp; p.energy = p.maxEnergy;
    game.events.emit('levelup', { level: p.level });
    game.juice.levelUp(p);
    game.audio?.play('levelup', { x: p.x, y: p.y });
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
}

export function enterCombat(p, t = 5) { p.combatT = Math.max(p.combatT, t); }

// ---------- death / respawn ----------
export function killPlayer(game) {
  const p = game.player;
  if (p.dead) return;
  p.dead = true; p.deadT = 0; p.hp = 0; p.rooted = true;
  p.action = null; p.work = null; p.charge = null; p.autoAttack = false; p.autoMove = null; p.target = null;
  game.events.emit('target', { target: null });
  p.buffs.length = 0; p.buffsV = (p.buffsV || 0) + 1;
  game.ctl && (game.ctl.goal = null);
  game.events.emit('death', {});
  game.audio?.play('death', { x: p.x, y: p.y });
  game.juice.shake(0.6);
}

export function respawnPoint(game) {
  const p = game.player;
  const S = game.build?.structures || [];
  const bed = p.respawn && S.find((o) => o.id === p.respawn);
  if (bed) return { x: bed.x, y: bed.y + 0.6, where: 'cama' };
  let best = null, bd = 1e9;
  for (const o of S) if (o.type === 'campfire') {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) return { x: best.x, y: best.y + 0.9, where: 'fogueira' };
  return { x: game.world.spawn.x, y: game.world.spawn.y, where: 'acampamento' };
}

export function respawnPlayer(game) {
  const p = game.player;
  const sp = respawnPoint(game);
  p.x = sp.x; p.y = sp.y;
  // nudge out of anything solid
  for (let k = 0; k < 24 && collides(game.world, p.x, p.y, p.r); k++) {
    const a = k * 2.4, r = 0.4 + k * 0.12;
    p.x = sp.x + Math.cos(a) * r; p.y = sp.y + Math.sin(a) * r;
  }
  p.dead = false; p.deadT = 0; p.rooted = false; p.flash = 0;
  p.hp = Math.round(p.maxHp * 0.5); p.energy = p.maxEnergy;
  p.hunger = Math.max(p.hunger, 35);
  p.combatT = 0; p.target = null; p.autoAttack = false;
  addBuff(p, 'weak', 60);
  game.cam.x = p.x; game.cam.y = p.y;
  game.events.emit('respawn', { where: sp.where });
  game.events.emit('target', { target: null });
  game.juice.levelUp(p);
}

// ---------- per-frame ----------
export function playerSystem() {
  return {
    update(game, dt) {
      const p = game.player;
      if (p.dead) return;
      p.combatT = Math.max(0, p.combatT - dt);
      p.inCombat = p.combatT > 0;

      // buffs
      for (let i = p.buffs.length - 1; i >= 0; i--) {
        const b = p.buffs[i];
        if (b.perm) continue;
        b.t -= dt;
        if (b.tick) {
          b.tickT = (b.tickT ?? b.tick) - dt;
          if (b.tickT <= 0) { b.tickT += b.tick; b.onTick?.(game, p, b); }
        }
        if (b.t <= 0) { p.buffs.splice(i, 1); p.buffsV = (p.buffsV || 0) + 1; }
      }

      // regeneration (no HP regen in combat, needs food in the belly)
      const warm = hasBuff(p, 'warm');
      p.energy = Math.min(p.maxEnergy, p.energy + dt * (p.inCombat ? 7 : 11));
      if (!p.inCombat && p.hunger > 15 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + dt * p.maxHp * (warm ? 0.03 : 0.012));
      }

      // speed
      let spd = p.baseSpeed;
      if (hasBuff(p, 'sprint')) spd *= 1.65;
      if (p.work) spd *= 0.6;
      p.speed = spd;
      p.dmgMul = hasBuff(p, 'weak') ? 0.75 : 1;

      // action animation for attacks (gather actions manage their own t)
      if (p.action && (p.action.type === 'attack' || p.action.type === 'cast') && p.action.dur) {
        p.action.t += dt / p.action.dur;
        if (p.action.t >= 1) p.action = null;
      }
    },
  };
}

// small push used by knockback
export function knock(game, e, fromX, fromY, dist) {
  const dx = e.x - fromX, dy = e.y - fromY, L = Math.hypot(dx, dy) || 1;
  moveCircle(game.world, e, (dx / L) * dist, (dy / L) * dist);
}
