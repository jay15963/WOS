// Survival: hunger drain (faster when sprinting / cold), starvation, warmth near fire, eating.

import { ITEMS } from './data.js';
import { addBuff, removeBuff, hasBuff } from './player.js';
import { healEntity, dealDamage } from './combat.js';

const DRAIN = 0.075; // hunger per second (~22 min from full to empty)

export function eat(game, id) {
  const p = game.player, def = ITEMS[id];
  if (!def?.food || p.dead) return false;
  if (p.hunger >= p.maxHunger - 1 && p.hp >= p.maxHp) { game.events.emit('error', { text: 'Você está satisfeito' }); return false; }
  if (!p.inv.remove(id, 1)) return false;
  const f = def.food;
  p.hunger = Math.min(p.maxHunger, p.hunger + f.hunger);
  if (f.heal) healEntity(game, p, f.heal);
  game.audio?.play('eat', { x: p.x, y: p.y });
  game.events.emit('inventory', {});
  game.events.emit('toast', { text: `Comeu ${def.name.toLowerCase()} (+${f.hunger} fome)`, kind: 'info' });
  if (f.sick && Math.random() < f.sick) {
    addBuff(p, 'sick', 6, { tick: 1, tickT: 1, onTick: (g, pl) => { if (pl.hp > 2) dealDamage(g, pl, pl, 2, { noDodge: true, noKnock: true }); } });
    game.events.emit('error', { text: 'A carne crua caiu mal…' });
  }
  return true;
}

// best food for the current need (prefers cooked > berries > raw)
export function bestFood(p) {
  const missing = p.maxHunger - p.hunger;
  const order = missing > 30 ? ['cooked', 'berries', 'meat'] : ['berries', 'cooked', 'meat'];
  return order.find((id) => p.inv.count(id) > 0) || null;
}

export function eatBest(game) {
  const id = bestFood(game.player);
  if (!id) { game.events.emit('error', { text: 'Sem comida na mochila' }); return false; }
  return eat(game, id);
}

export function survivalSystem() {
  let scanT = 0, warnT = 0;
  return {
    update(game, dt) {
      const p = game.player;
      if (p.dead) return;
      // warmth scan
      scanT -= dt;
      if (scanT <= 0) {
        scanT = 0.5;
        let warm = false;
        for (const o of game.build.structures) {
          if (!o.fire) continue;
          const r = o.type === 'campfire' ? 4.5 : 2.2;
          if (Math.abs(o.x - p.x) < r && Math.abs(o.y - p.y) < r && Math.hypot(o.x - p.x, o.y - p.y) < r) { warm = true; break; }
        }
        if (warm) { if (!hasBuff(p, 'warm')) addBuff(p, 'warm', 1, { perm: true }); }
        else removeBuff(p, 'warm');
        const night = (game.env.env.night || 0) > 0.55;
        if (night && !warm) { if (!hasBuff(p, 'cold')) addBuff(p, 'cold', 1, { perm: true }); }
        else removeBuff(p, 'cold');
      }

      let drain = DRAIN;
      if (hasBuff(p, 'sprint')) drain *= 3;
      if (hasBuff(p, 'cold')) drain *= 1.5;
      if (hasBuff(p, 'warm')) drain *= 0.8;
      if (p.inCombat) drain *= 1.3;
      p.hunger = Math.max(0, p.hunger - drain * dt);

      warnT -= dt;
      if (p.hunger <= 0) {
        if (!hasBuff(p, 'starving')) addBuff(p, 'starving', 1, { perm: true });
        p.starveAcc = (p.starveAcc || 0) + dt * 1.5;
        if (p.starveAcc >= 3) { dealDamage(game, p, p, Math.floor(p.starveAcc), { noDodge: true, noKnock: true }); p.starveAcc = 0; }
        if (warnT <= 0) { game.events.emit('error', { text: 'Você está morrendo de fome!' }); warnT = 20; }
      } else {
        removeBuff(p, 'starving');
        if (p.hunger < 20 && warnT <= 0) { game.events.emit('toast', { text: 'Você está com fome', kind: 'warn' }); warnT = 45; }
      }
    },
  };
}
