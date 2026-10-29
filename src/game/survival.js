// Survival (owner side: the local player's own body): hunger with penalties and ramping starvation, and
// body heat driven by a felt temperature (°C) from biome + time of day + rain / storm / wind / wet (read
// from game.env), warmed by fires, enclosed shelters (roofed = floor or cave), clothing and warm food.
// Every number lives in SURVIVAL below. Effects: hungry (<25%), starving (0), chilled (<30% heat:
// slower, hungrier), hypothermia (<10%: ramping damage). Eating lives here too.

import { ITEMS, BUILDINGS, FOOD_IDS } from './data.js';
import { addBuff, removeBuff, hasBuff } from './player.js';
import { healEntity, dealDamage } from './combat.js';

export const SURVIVAL = {
  hunger: {
    drain: 0.19,          // per second idle: full → empty in ~8.8 min
    sprint: 2.2, work: 1.35, combat: 1.3, chilled: 1.45, nearFire: 0.9,
    hungry: 25,           // below this: slower, half energy regen
    hungrySpeed: 0.92, hungryRegen: 0.5,
    starveEvery: 2,       // s between starvation hits
    starveBase: 1, starveRamp: 1 / 15, starveMax: 6, // damage per hit grows by 1 every 15 s starving
  },
  temp: {
    biome: { meadow: 17, forest: 15, pine: 9, birch: 12, marsh: 13, shore: 16, rocky: 10, water: 13, mountain: 4 },
    biomeDefault: 14,
    dayAmp: 4,            // ±°C over the day (warmest 14 h, coldest 2 h)
    night: -6,            // extra at full night
    rain: -4, storm: -7, wet: -2, wind: -5, // wind × env.wind (0..1.2)
    cave: 3,              // inside a mountain cave: no rain / wind, a bit warmer
    fire: 22,             // °C at a fire, fading to 0 at 1.25 × its warm radius
    shelter: 7, roof: 3,  // enclosed room (walls / doors / rock all around) + roof (floor tiles or a cave)
    cloth: 3,             // per point of clothing warmth (tunic 2, leather 1, hood 1…)
    warmFood: 6,          // while a warm meal lasts
    comfort: 12,          // felt °C at or above which the body warms up
    lossK: 0.065,         // heat %/s lost per °C below comfort
    gainK: 0.09, gainBase: 0.4, // heat %/s regained per °C above comfort (+ base)
    chilled: 30, hypo: 10,
    chilledSpeed: 0.86,
    hypoEvery: 2, hypoBase: 1, hypoRamp: 1 / 12, hypoMax: 6,
  },
};

export function eat(game, id) {
  const p = game.player, def = ITEMS[id];
  if (!def?.food || p.dead) return false;
  if (p.hunger >= p.maxHunger - 1 && p.hp >= p.maxHp && !def.food.warm) { game.events.emit('error', { text: 'Você está satisfeito' }); return false; }
  if (!p.inv.remove(id, 1)) return false;
  const f = def.food;
  p.hunger = Math.min(p.maxHunger, p.hunger + f.hunger);
  if (f.heal) healEntity(game, p, f.heal);
  if (f.warm) p.warmFoodT = Math.max(p.warmFoodT || 0, f.warm);
  game.audio?.play('eat', { x: p.x, y: p.y });
  game.events.emit('inventory', {});
  game.events.emit('toast', { text: `Comeu ${def.name.toLowerCase()} (+${f.hunger} fome${f.warm ? ' · aquece' : ''})`, kind: 'info' });
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

// °C added by the nearest fire sources at (x, y) (0 = none)
export function fireHeat(game, x, y) {
  let best = 0;
  for (const o of game.build.structures) {
    if (o.blueprint) continue;
    const def = BUILDINGS[o.type];
    if (!def?.warm || (def.warmWorking && !o.working) || o.fire === false || o.lit === false) continue;
    const r = def.warm * 1.25;
    const dx = o.x - x, dy = o.y - y;
    if (Math.abs(dx) > r || Math.abs(dy) > r) continue;
    const d = Math.hypot(dx, dy);
    if (d >= r) continue;
    const h = SURVIVAL.temp.fire * Math.pow(1 - d / r, 0.7) * (def.warm >= 4 ? 1 : 0.7);
    if (h > best) best = h;
  }
  return best;
}
// kept for older callers: is (x, y) warmed by a fire source?
export function warmAt(game, x, y) { return fireHeat(game, x, y) > 3; }

// Enclosed shelter around tile (tx, ty): flood fill over walkable tiles; walls, doors, rock and deep water
// close it. Returns { enclosed, roof } (roof = a floor under the player or a mountain cave).
const MAX_ROOM = 140;
function shelterAt(game, tx, ty) {
  const w = game.world, W = w.W;
  if (!w.inBounds(tx, ty)) return { enclosed: false, roof: false };
  const cave = !!w.isCave?.(tx, ty);
  const seen = new Set();
  const q = [ty * W + tx];
  seen.add(q[0]);
  let open = false;
  while (q.length) {
    const i = q.pop();
    const x = i % W, y = (i - x) / W;
    if (Math.abs(x - tx) > 12 || Math.abs(y - ty) > 12 || seen.size > MAX_ROOM) { open = true; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny)) { open = true; break; }
      const j = ny * W + nx;
      if (seen.has(j)) continue;
      if (w.solid[j] || w.rock[j] === 1 || w.water[j] === 2) continue; // wall / door / rock / deep water
      seen.add(j);
      q.push(j);
    }
    if (open) break;
  }
  let floor = false;
  if (!open) for (const o of game.build.structures) if (!o.blueprint && BUILDINGS[o.type]?.layer === 'floor' && o.tx === tx && o.ty === ty && o.type !== 'farm_plot') { floor = true; break; }
  return { enclosed: !open, roof: cave || (!open && floor), cave };
}

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// felt temperature at the player and its parts (for the °C readout / tooltip)
export function feltTemp(game, p, shelter) {
  // simulation state of the environment (env.cur / wet / hour advance in update(), also without rendering)
  const T = SURVIVAL.temp, E = game.env, e = E.cur || E.env || {};
  const wet = E.wet ?? E.env?.wet ?? 0;
  const biome = game.world.biomeAt?.(p.x, p.y);
  const base = T.biome[biome] ?? T.biomeDefault;
  const h = E.hour ?? 12;
  const night = h < 12 ? 1 - ss(4.6, 6.3, h) : ss(18.7, 20.4, h);
  const day = T.dayAmp * Math.cos(((h - 14) / 24) * Math.PI * 2) + T.night * night;
  const covered = shelter.enclosed || shelter.cave;
  const rain = covered ? 0 : (e.rain || 0) * T.rain + (e.storm || 0) * T.storm + wet * T.wet;
  const wind = covered ? 0 : (e.wind || 0) * T.wind;
  const fire = fireHeat(game, p.x, p.y);
  const room = (shelter.enclosed ? T.shelter : 0) + (shelter.roof ? T.roof : 0) + (shelter.cave && !shelter.enclosed ? T.cave : 0);
  const cloth = (p.warmth || 0) * T.cloth;
  const food = p.warmFoodT > 0 ? T.warmFood : 0;
  const c = base + day + rain + wind + fire + room + cloth + food;
  return { c, base, day, rain, wind, fire, room, cloth, food };
}

// HUD readout: { key, text, cls, why }
export function heatState(p) {
  const f = p._felt;
  if (!f) return { key: '-', text: '', cls: '', why: '' };
  const c = Math.round(f.c);
  const cls = c < 0 ? 'freeze' : c < SURVIVAL.temp.comfort ? 'cold' : c > 26 ? 'hot' : 'ok';
  const parts = [];
  const add = (v, t) => { if (Math.abs(v) >= 0.5) parts.push(`${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}° ${t}`); };
  parts.push(`${Math.round(f.base)}° aqui`);
  add(f.day, 'hora do dia'); add(f.rain, 'chuva'); add(f.wind, 'vento'); add(f.fire, 'fogo'); add(f.room, 'abrigo'); add(f.cloth, 'roupas'); add(f.food, 'comida quente');
  const why = parts.join(' · ') + (c < SURVIVAL.temp.comfort ? '. Abaixo de 12° o corpo esfria.' : '. Confortável: o corpo se aquece.');
  return { key: c + cls + (p.bodyHeat < 30 ? 'c' : ''), text: `${c}°C`, cls, why };
}

export function survivalSystem() {
  let scanT = 0, hungerWarnT = 0, starveT = 0, starveAcc = 0, hypoT = 0, hypoAcc = 0, lastHeat = 100, shelter = { enclosed: false, roof: false };
  const H = SURVIVAL.hunger, T = SURVIVAL.temp;
  return {
    sync: 'owner', // hunger / body heat of the local player
    update(game, dt) {
      const p = game.player;
      if (p.bodyHeat == null) p.bodyHeat = 100;
      if (p.dead) { starveT = hypoT = 0; return; }
      if (p.warmFoodT > 0) p.warmFoodT -= dt;

      // felt temperature (shelter flood fill 2 Hz)
      scanT -= dt;
      if (scanT <= 0) { scanT = 0.5; shelter = shelterAt(game, Math.floor(p.x), Math.floor(p.y)); }
      const f = p._felt = feltTemp(game, p, shelter);
      p.feelC = f.c;
      p.shelter = shelter.enclosed;

      // body heat drifts toward comfort
      const d = f.c - T.comfort;
      if (d < 0) p.bodyHeat = Math.max(0, p.bodyHeat + d * T.lossK * dt);
      else p.bodyHeat = Math.min(100, p.bodyHeat + (T.gainBase + d * T.gainK) * dt);
      const heat = p.bodyHeat;

      // warm buff (fire / warm meal): better regen (player.js) and a little less hunger
      const warm = f.fire > 3 || p.warmFoodT > 0;
      if (warm) { if (!hasBuff(p, 'warm')) addBuff(p, 'warm', 1, { perm: true }); } else removeBuff(p, 'warm');
      const chilled = heat < T.chilled;
      if (chilled) { if (!hasBuff(p, 'cold')) addBuff(p, 'cold', 1, { perm: true, name: 'Com frio', desc: 'Corpo frio: mais lento e com mais fome. Aqueça-se.' }); }
      else removeBuff(p, 'cold');
      const hypo = heat < T.hypo;
      if (hypo) {
        if (!hasBuff(p, 'hypothermia')) addBuff(p, 'hypothermia', 1, { perm: true, name: 'Hipotermia', icon: 'cold', good: false, desc: 'Congelando: perde vida cada vez mais rápido.' });
        hypoT += dt; hypoAcc += dt;
        if (hypoAcc >= T.hypoEvery) {
          hypoAcc = 0;
          dealDamage(game, p, p, Math.min(T.hypoMax, Math.floor(T.hypoBase + hypoT * T.hypoRamp)), { noDodge: true, noKnock: true });
          if (p.dead) return;
        }
      } else { removeBuff(p, 'hypothermia'); hypoT = Math.max(0, hypoT - dt * 2); hypoAcc = 0; }
      // warnings when crossing thresholds on the way down
      if (d < 0) {
        if (lastHeat >= 60 && heat < 60) game.events.emit('toast', { text: `Está esfriando (${Math.round(f.c)}°C): fogueira, abrigo fechado ou roupas`, kind: 'warn' });
        if (lastHeat >= T.chilled && heat < T.chilled) game.events.emit('error', { text: 'Você está com frio!' });
        if (lastHeat >= T.hypo && heat < T.hypo) game.events.emit('error', { text: 'Hipotermia! Aqueça-se já' });
      } else if (lastHeat < T.chilled && heat >= T.chilled) game.events.emit('toast', { text: 'O corpo está se aquecendo', kind: 'good' });
      lastHeat = heat;

      // hunger
      let drain = H.drain;
      if (hasBuff(p, 'sprint')) drain *= H.sprint;
      if (p.work) drain *= H.work;
      if (p.inCombat) drain *= H.combat;
      if (chilled) drain *= H.chilled;
      if (warm) drain *= H.nearFire;
      p.hunger = Math.max(0, p.hunger - drain * dt);
      const hungry = p.hunger < H.hungry;
      if (hungry && p.hunger > 0) { if (!hasBuff(p, 'hungry')) addBuff(p, 'hungry', 1, { perm: true, name: 'Com fome', icon: 'hunger', good: false, desc: 'Mais lento e menos energia. Coma algo.' }); }
      else removeBuff(p, 'hungry');

      // penalties (player.js recomputes speed / regen every frame before this runs)
      let spd = 1;
      if (hungry) { spd *= H.hungrySpeed; p.energy = Math.max(0, p.energy - dt * 11 * (1 - H.hungryRegen)); }
      if (chilled) spd *= T.chilledSpeed;
      if (spd !== 1) p.speed *= spd;

      hungerWarnT -= dt;
      if (p.hunger <= 0) {
        if (!hasBuff(p, 'starving')) addBuff(p, 'starving', 1, { perm: true });
        starveT += dt; starveAcc += dt;
        if (starveAcc >= H.starveEvery) {
          starveAcc = 0;
          dealDamage(game, p, p, Math.min(H.starveMax, Math.floor(H.starveBase + starveT * H.starveRamp)), { noDodge: true, noKnock: true });
        }
        if (hungerWarnT <= 0) { game.events.emit('error', { text: 'Você está morrendo de fome!' }); hungerWarnT = 15; }
      } else {
        removeBuff(p, 'starving');
        starveT = 0; starveAcc = 0;
        if (hungry && hungerWarnT <= 0) { game.events.emit('toast', { text: 'Você está com fome: coma algo (frutas, carne assada…)', kind: 'warn' }); hungerWarnT = 60; }
      }
    },
  };
}
