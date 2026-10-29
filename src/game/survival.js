// Survival: hunger drain (faster when sprinting / cold), starvation, warmth near any fire source
// (campfire, torch, brazier, working furnace / cooking pot, stew), clothing warmth, eating.

import { ITEMS, BUILDINGS, FOOD_IDS } from './data.js';
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
  if (f.warm) p.warmFoodT = Math.max(p.warmFoodT || 0, f.warm);
  game.audio?.play('eat', { x: p.x, y: p.y });
  game.events.emit('inventory', {});
  game.events.emit('toast', { text: `Comeu ${def.name.toLowerCase()} (+${f.hunger} fome)`, kind: 'info' });
  if (f.sick && Math.random() < f.sick) {
    addBuff(p, 'sick', 6, { tick: 1, tickT: 1, onTick: (g, pl) => { if (pl.hp > 2) dealDamage(g, pl, pl, 2, { noDodge: true, noKnock: true }); } });
    game.events.emit('error', { text: 'A carne crua caiu mal…' });
  }
  return true;
}

// best food for the current need: never raw meat unless it is all there is; avoid wasting big meals
export function bestFood(p) {
  const missing = p.maxHunger - p.hunger;
  const have = FOOD_IDS.filter((id) => p.inv.count(id) > 0);
  if (!have.length) return null;
  const safe = have.filter((id) => !ITEMS[id].food.sick);
  const pool = safe.length ? safe : have;
  const val = (id) => ITEMS[id].food.hunger;
  const fit = pool.filter((id) => val(id) <= missing + 8).sort((a, b) => val(b) - val(a));
  if (fit.length) return fit[0];
  return pool.sort((a, b) => val(a) - val(b))[0];
}

export function eatBest(game) {
  const id = bestFood(game.player);
  if (!id) { game.events.emit('error', { text: 'Sem comida na mochila' }); return false; }
  return eat(game, id);
}

export function foodCount(p) { return FOOD_IDS.reduce((n, id) => n + p.inv.count(id), 0); }

// is (x, y) warmed by a fire source?
export function warmAt(game, x, y) {
  for (const o of game.build.structures) {
    if (o.blueprint) continue;
    const def = BUILDINGS[o.type];
    if (!def?.warm || (def.warmWorking && !o.working)) continue;
    const r = def.warm;
    if (Math.abs(o.x - x) < r && Math.abs(o.y - y) < r && Math.hypot(o.x - x, o.y - y) < r) return true;
  }
  return false;
}

export function survivalSystem() {
  let scanT = 0, warnT = 0;
  return {
    sync: 'owner', // hunger / warmth of the local player
    update(game, dt) {
      const p = game.player;
      if (p.dead) return;
      if (p.warmFoodT > 0) p.warmFoodT -= dt;
      // warmth scan
      scanT -= dt;
      if (scanT <= 0) {
        scanT = 0.5;
        const warm = warmAt(game, p.x, p.y) || p.warmFoodT > 0;
        if (warm) { if (!hasBuff(p, 'warm')) addBuff(p, 'warm', 1, { perm: true }); }
        else removeBuff(p, 'warm');
        const night = (game.env.env.night || 0) > 0.55;
        const dressed = (p.warmth || 0) >= 2;
        if (night && !warm && !dressed) { if (!hasBuff(p, 'cold')) addBuff(p, 'cold', 1, { perm: true }); }
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
