// Player: stats/level, equipment → combat stats, buffs, regeneration, XP, death & respawn. Simulation only.

import { Inventory } from './inventory.js';
import { playerStats, xpToNext, MAX_LEVEL } from './stats.js';
import { BUFFS } from './data.js';
import { weaponProfile, offhandProfile, equipArmor, playerPower } from './content/weapons.js';
import { moveCircle, collides } from './physics.js';
import { moveMob } from './nav.js';

export function initPlayer(game) {
  const p = game.player;
  Object.assign(p, {
    name: 'Sobrevivente', level: 1, xp: 0,
    hunger: 100, maxHunger: 100, energy: 100, maxEnergy: 100,
    inv: new Inventory(24), buffs: [], // starts with NOTHING: empty backpack, bare hands
    equip: { main: null, off: null, body: null, head: null }, weapon: null, offhand: null, armor: { body: null, head: null },
    swingT: 0, combatT: 0, inCombat: false, gcdT: 0, cds: {},
    target: null, autoAttack: false, respawn: null, baseSpeed: 4.0,
    work: null, charge: null, spin: null, leap: null, cast: null, block: null, blocking: false, stunT: 0, dmgMul: 1,
  });
  p.weapon = null; p.offhand = null; p.armor = { body: null, head: null };
  applyLevel(p);
  p.hp = p.maxHp;
  // economy (or anyone) can announce equipment changes; we also poll p.equip every frame
  game.events?.on('equipchange', () => { p._gearKey = null; });
}

export function applyLevel(p) {
  const s = playerStats(p.level);
  p.maxHp = s.maxHp; p.maxEnergy = s.maxEnergy;
  p.baseCrit = s.crit; p.dodge = s.dodge;
  refreshGear(p);
}

// Derive combat stats from p.equip + level (weapon damage/speed/reach, armor, shield, visuals).
export function refreshGear(p) {
  const eq = p.equip || (p.equip = { main: null, off: null, body: null, head: null });
  const w = weaponProfile(eq.main || null);
  const off = w.twoHanded ? null : offhandProfile(eq.off || null);
  const pw = playerPower(p.level || 1);
  p.wprof = w;
  p.offprof = off;
  p.wMin = w.min * pw; p.wMax = w.max * pw;
  p.swing = w.swing;
  p.crit = (p.baseCrit ?? 0.08) + w.crit;
  p.reachX = w.reach;
  p.shield = off && off.type === 'shield' ? off : null;
  p.armorV = equipArmor({ ...eq, off: off ? eq.off : null });
  // visual state read by the art (economy may override p.weapon while working)
  if (!p.work) p.weapon = eq.main || null;
  p.offhand = off ? eq.off : null;
  p.armor = { body: eq.body || null, head: eq.head || null };
  // hand torch: light around the player (rendered by game.render from p.light)
  if (off && off.light) { p.light = { ...off.light }; p._torchLight = true; }
  else if (p._torchLight) { p.light = null; p._torchLight = false; }
  if (!p.shield) { p.blocking = false; p.block = null; }
  p._gearKey = gearKey(p);
}
const gearKey = (p) => { const e = p.equip || {}; return `${e.main}|${e.off}|${e.body}|${e.head}|${p.level}`; };

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

// stun the player (bandit smash): can't move or act
export function stunPlayer(game, dur) {
  const p = game.player;
  if (p.dead) return;
  p.stunT = Math.max(p.stunT || 0, dur);
  p.cast = null; p.block = null; p.blocking = false;
  addBuff(p, 'stunned', dur);
  game.juice.stun(p);
  game.events.emit('damage', { target: p, src: null, amount: 0, kind: 'stun' });
}

// ---------- death / respawn ----------
export function killPlayer(game) {
  const p = game.player;
  if (p.dead) return;
  p.dead = true; p.deadT = 0; p.hp = 0; p.rooted = true;
  p.action = null; p.work = null; p.charge = null; p.leap = null; p.cast = null; p.block = null; p.blocking = false; p.stunT = 0;
  p.autoAttack = false; p.autoMove = null; p.target = null;
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
  const done = (o) => (o.progress ?? 1) >= 1; // blueprints don't count
  const bed = p.respawn && S.find((o) => o.id === p.respawn && done(o));
  if (bed) return { x: bed.x, y: bed.y + 0.6, where: 'cama' };
  let best = null, bd = 1e9;
  for (const o of S) if (o.type === 'campfire' && done(o)) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) return { x: best.x, y: best.y + 0.9, where: 'fogueira' };
  return { x: game.world.spawn.x, y: game.world.spawn.y, where: 'ponto de partida' };
}

export function respawnPlayer(game) {
  const p = game.player;
  const sp = respawnPoint(game);
  p.x = sp.x; p.y = sp.y;
  p.lv = 0; p.z = 0; p._fallV = 0; p._hop = null; // levels: respawn on the ground
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
    sync: 'owner', // local player stats, buffs, regeneration
    update(game, dt) {
      const p = game.player;
      // equipment polling (cheap string compare) → stats + action bar (abilities.js listens to 'gear')
      if (p._gearKey !== gearKey(p)) {
        const before = p._barKey;
        refreshGear(p);
        game.events.emit('gear', { before });
      }
      if (p.dead) return;
      p.combatT = Math.max(0, p.combatT - dt);
      p.inCombat = p.combatT > 0;
      if (p.stunT > 0) { p.stunT = Math.max(0, p.stunT - dt); p.moving = false; }

      // buffs
      for (let i = p.buffs.length - 1; i >= 0; i--) {
        const b = p.buffs[i];
        if (b.perm) continue;
        b.t -= dt;
        if (b.tick) {
          b.tickT = (b.tickT ?? b.tick) - dt;
          if (b.tickT <= 0) { b.tickT += b.tick; b.onTick?.(game, p, b); if (p.dead) return; }
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
      if (p.blocking) spd *= 0.55;
      p.speed = spd;
      p.dmgMul = hasBuff(p, 'weak') ? 0.75 : 1;

      // timed action animations (gathering manages its own t and sets no dur)
      if (p.action && p.action.dur && !p.action.hold) {
        p.action.t += dt / p.action.dur;
        if (p.action.t >= 1) p.action = null;
      }
    },
  };
}

// small push used by knockback (creatures never get pushed through doors)
export function knock(game, e, fromX, fromY, dist) {
  const dx = e.x - fromX, dy = e.y - fromY, L = Math.hypot(dx, dy) || 1;
  if (e === game.player) moveCircle(game.world, e, (dx / L) * dist, (dy / L) * dist);
  else moveMob(game, e, (dx / L) * dist, (dy / L) * dist);
}
