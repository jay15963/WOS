// Survival (owner side: the local player's own body): hunger with penalties and ramping starvation, and
// body heat driven by a felt temperature (°C) from biome + time of day + rain / storm / wind / wet (read
// from game.env), warmed by fires, enclosed shelters, roofs (world.roofAt: built or a cave ceiling), clothing and warm food.
// Every number lives in SURVIVAL below. Effects: hungry (<25%), starving (0), chilled (<30% heat:
// slower, hungrier, no HP regen), freezing (<20%: slow HP loss), hypothermia (<10%: ramping damage, % of max HP). Swimming in deep water chills hard and soaks the
// clothes; wet clothes (also slowly from rain) keep the player chilled until they dry (fast by a fire, faster
// in sunshine or under a roof). Eating lives here too.
//
// Player fields written here (local, owner-side, never replicated):
//   p.bodyHeat 0..100 · p.feelC felt °C · p.wetT s of soaking left · p.shelter (enclosed room) · p._felt (°C parts)
//   p.feel = { hp, cold, hunger, wet, sick, warm } — smooth 0..1 severities updated every frame (same object,
//   no allocation) for screen effects (agent C) and sounds (agent F): hp 0 above 35% health → 1 near death;
//   cold 0 at ≥50% body heat, 0.5 when chilled (30%), 1 at hypothermia (≤10%); hunger 0 above 25% → 1 starving;
//   wet 1 while swimming, decaying while the clothes dry; sick = food poisoning / poison; warm = by a fire.

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
    night: -7,            // extra at full night
    rain: -4, storm: -7, wet: -2, wind: -5, // wind × env.wind (0..1.2)
    cave: 3,              // inside a mountain cave: no rain / wind, a bit warmer
    fire: 22,             // °C at a fire, fading to 0 at 1.25 × its warm radius
    shelter: 7, roof: 3,  // enclosed room (walls / doors / rock all around) + roof over the player (built or a cave)
    porchWind: 0.6,       // wind × under a roof that is not enclosed (porch, pavilion)
    cloth: 3,             // per point of clothing warmth (tunic 2, leather 1, hood 1…)
    warmFood: 6,          // while a warm meal lasts
    comfort: 12,          // felt °C at or above which the body warms up
    lossK: 0.085,         // heat %/s lost per °C below comfort (meadow night: chilled in ~2 min)
    gainK: 0.09, gainBase: 0.4, // heat %/s regained per °C above comfort (+ base)
    chilled: 30, freezing: 20, hypo: 10, // body heat % thresholds (chilled: no HP regen, slower, hungrier)
    chilledSpeed: 0.86,
    freezeEvery: 3, freezePct: 0.01,     // < 20%: lose 1% of max HP every 3 s
    // < 10%: lose 2% of max HP every 2 s, +1% per 10 s spent freezing, up to 6% (≈ 3% max HP / s)
    hypoEvery: 2, hypoPct: 0.02, hypoRampPct: 0.001, hypoMaxPct: 0.06,
  },
  // swimming in deep water / wet clothes (p.swimming is set by game.update; p.wetT = seconds of soaking left)
  wet: {
    swim: -16,            // °C while swimming (icy river) + extra heat loss below
    swimLoss: 0.6,        // extra heat %/s while swimming
    soaked: 120,          // s to dry after leaving deep water (at the base rate)
    rainSoak: 1.6,        // wetT gained per s in rain (× rain 0..1) when not covered, up to rainMax
    rainMax: 60,
    chill: -7,            // °C while fully wet (scales with how wet), wind chill ×2 when wet
    dry: 1, dryFire: 6, drySun: 2.5, dryShelter: 1.5, // drying speed multipliers
    hungerSwim: 2.5,      // hunger × while swimming
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
  if (!p.action) p.action = { type: 'eat', t: 0, dur: 1.2, item: id }; // eating pose (replicated with presence)
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
// close it. Returns { enclosed, roof, cave } (roof = world.roofAt: a built roof or a mountain cave ceiling).
const MAX_ROOM = 140;
function shelterAt(game, tx, ty) {
  const w = game.world, W = w.W;
  if (!w.inBounds(tx, ty)) return { enclosed: false, roof: false };
  const cave = !!w.isCave?.(tx, ty);
  const roof = cave || (w.roofAt?.(tx, ty) === 2);
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
  return { enclosed: !open, roof, cave };
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
  const rain = covered || shelter.roof ? 0 : (e.rain || 0) * T.rain + (e.storm || 0) * T.storm + wet * T.wet;
  const wind = covered ? 0 : (e.wind || 0) * T.wind * (shelter.roof ? T.porchWind : 1);
  const fire = fireHeat(game, p.x, p.y);
  const room = (shelter.enclosed ? T.shelter : 0) + (shelter.roof ? T.roof : 0) + (shelter.cave && !shelter.enclosed ? T.cave : 0);
  const cloth = (p.warmth || 0) * T.cloth;
  const food = p.warmFoodT > 0 ? T.warmFood : 0;
  // water: swimming is icy; wet clothes chill (scaled by how soaked) and double the wind chill
  const Wt = SURVIVAL.wet, wk = Math.min(1, (p.wetT || 0) / 60);
  const water = p.swimming ? Wt.swim : wk > 0 ? Wt.chill * wk + wind * wk : 0;
  const c = base + day + rain + wind + fire + room + cloth + food + water;
  return { c, base, day, rain, wind, fire, room, cloth, food, water };
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
  add(f.water, p.swimming ? 'água gelada' : 'roupa molhada');
  const wetNote = p.swimming ? ' Nadando: o corpo esfria muito rápido.' : p.wetT > 0 ? ` Molhado: seca em ~${Math.ceil(p.wetT)} s (muito mais rápido perto do fogo).` : '';
  const why = parts.join(' · ') + (c < SURVIVAL.temp.comfort ? '. Abaixo de 12° o corpo esfria.' : '. Confortável: o corpo se aquece.') + wetNote;
  const wet = p.swimming || p.wetT > 0;
  return { key: c + cls + (p.bodyHeat < 30 ? 'c' : '') + (wet ? 'w' + Math.ceil((p.wetT || 0) / 10) : ''), text: `${wet ? '💧 ' : ''}${c}°C`, cls: cls + (wet ? ' wet' : ''), why, wet };
}

// p.feel: smooth 0..1 severities for screen effects / sounds (see the header); one object, reused
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function updateFeel(p, dt) {
  const F = p.feel || (p.feel = { hp: 0, cold: 0, hunger: 0, wet: 0, sick: 0, warm: 0 });
  const k = 1 - Math.exp(-dt * 3);
  const hpf = p.maxHp ? p.hp / p.maxHp : 1;
  const heat = p.bodyHeat ?? 100;
  const tHp = p.dead ? 1 : clamp01((0.35 - hpf) / 0.33);
  const tCold = p.dead ? 0 : heat >= 50 ? 0 : heat >= 30 ? (50 - heat) / 40 : 0.5 + clamp01((30 - heat) / 20) * 0.5;
  const tHunger = p.dead ? 0 : clamp01((25 - (p.hunger ?? 100)) / 25);
  const tWet = p.swimming ? 1 : clamp01((p.wetT || 0) / SURVIVAL.wet.soaked);
  let sick = 0;
  for (const b of p.buffs || []) if (b.id === 'sick' || b.id === 'poison') { sick = 1; break; }
  const tWarm = p.dead ? 0 : clamp01(Math.max((p._felt?.fire || 0) / 14, p.warmFoodT > 0 ? 0.4 : 0));
  F.hp += (tHp - F.hp) * k; F.cold += (tCold - F.cold) * k; F.hunger += (tHunger - F.hunger) * k;
  F.wet += (tWet - F.wet) * (p.swimming ? 1 - Math.exp(-dt * 8) : k); F.sick += (sick - F.sick) * k; F.warm += (tWarm - F.warm) * k;
}

export function survivalSystem() {
  let scanT = 0, hungerWarnT = 0, starveT = 0, starveAcc = 0, hypoT = 0, hypoAcc = 0, lastHeat = 100, shelter = { enclosed: false, roof: false };
  const H = SURVIVAL.hunger, T = SURVIVAL.temp;
  return {
    sync: 'owner', // hunger / body heat of the local player
    update(game, dt) {
      const p = game.player;
      if (p.bodyHeat == null) p.bodyHeat = 100;
      updateFeel(p, dt);
      if (p.dead) { starveT = hypoT = 0; p.wetT = 0; return; }
      if (p.warmFoodT > 0) p.warmFoodT -= dt;

      // felt temperature (shelter flood fill 2 Hz)
      scanT -= dt;
      if (scanT <= 0) { scanT = 0.5; shelter = shelterAt(game, Math.floor(p.x), Math.floor(p.y)); }
      // soaking / drying (p.swimming comes from game.update: deep water)
      const W = SURVIVAL.wet, E = game.env, ec = E.cur || {};
      const wasWet = (p.wetT || 0) > 0;
      if (p.swimming) p.wetT = W.soaked;
      else {
        const rainNow = shelter.enclosed || shelter.roof ? 0 : (ec.rain || 0);
        if (rainNow > 0.2 && (p.wetT || 0) < W.rainMax) p.wetT = Math.min(W.rainMax, (p.wetT || 0) + rainNow * W.rainSoak * dt);
        else if (p.wetT > 0) {
          const hr = E.hour ?? 12, sunny = hr > 7 && hr < 18 && (ec.cloud ?? 0) < 0.5 && rainNow < 0.05;
          const k = W.dry * (fireHeat(game, p.x, p.y) > 3 ? W.dryFire : 1) * (sunny ? W.drySun : 1) * (shelter.roof || shelter.enclosed ? W.dryShelter : 1);
          p.wetT = Math.max(0, p.wetT - dt * k);
        }
      }
      const wetNow = (p.wetT || 0) > 0;
      if (wetNow) { if (!hasBuff(p, 'wet')) addBuff(p, 'wet', 1, { perm: true, name: 'Molhado', icon: 'cold', good: false, desc: 'Roupa encharcada: sente frio até secar (seca bem mais rápido perto do fogo).' }); }
      else removeBuff(p, 'wet');
      if (wetNow && !wasWet) game.events.emit('toast', { text: p.swimming ? 'Água gelada! Nadar deixa você com muito frio' : 'Você está ficando molhado', kind: 'warn' });
      else if (!wetNow && wasWet) game.events.emit('toast', { text: 'Roupa seca', kind: 'good' });

      const f = p._felt = feltTemp(game, p, shelter);
      p.feelC = f.c;
      p.shelter = shelter.enclosed;

      // body heat drifts toward comfort
      const d = f.c - T.comfort;
      if (d < 0) p.bodyHeat = Math.max(0, p.bodyHeat + d * T.lossK * dt);
      else p.bodyHeat = Math.min(100, p.bodyHeat + (T.gainBase + d * T.gainK) * dt);
      if (p.swimming) p.bodyHeat = Math.max(0, p.bodyHeat - W.swimLoss * dt);
      const heat = p.bodyHeat;

      // warm buff (fire / warm meal): better regen (player.js) and a little less hunger
      const warm = f.fire > 3 || p.warmFoodT > 0;
      if (warm) { if (!hasBuff(p, 'warm')) addBuff(p, 'warm', 1, { perm: true }); } else removeBuff(p, 'warm');
      // chilled: a cold body, or swimming / wet clothes away from a fire
      const chilled = heat < T.chilled || p.swimming || (wetNow && !warm);
      if (chilled) { if (!hasBuff(p, 'cold')) addBuff(p, 'cold', 1, { perm: true, name: 'Com frio', desc: 'Corpo frio: mais lento, com mais fome e sem recuperar vida. Aqueça-se.' }); }
      else removeBuff(p, 'cold');
      const hypo = heat < T.hypo;
      if (hypo) {
        if (!hasBuff(p, 'hypothermia')) addBuff(p, 'hypothermia', 1, { perm: true, name: 'Hipotermia', icon: 'cold', good: false, desc: 'Congelando: perde vida cada vez mais rápido.' });
        hypoT += dt; hypoAcc += dt;
        if (hypoAcc >= T.hypoEvery) {
          hypoAcc = 0;
          const pct = Math.min(T.hypoMaxPct, T.hypoPct + hypoT * T.hypoRampPct);
          dealDamage(game, p, p, Math.max(1, Math.round(p.maxHp * pct)), { noDodge: true, noKnock: true });
          if (p.dead) return;
        }
      } else if (heat < T.freezing) {
        // freezing (not yet hypothermia): slow, steady HP loss
        removeBuff(p, 'hypothermia'); hypoT = Math.max(0, hypoT - dt * 2);
        hypoAcc += dt;
        if (hypoAcc >= T.freezeEvery) {
          hypoAcc = 0;
          dealDamage(game, p, p, Math.max(1, Math.round(p.maxHp * T.freezePct)), { noDodge: true, noKnock: true });
          if (p.dead) return;
        }
      } else { removeBuff(p, 'hypothermia'); hypoT = Math.max(0, hypoT - dt * 2); hypoAcc = 0; }
      // warnings when crossing thresholds on the way down
      if (d < 0) {
        if (lastHeat >= 60 && heat < 60) game.events.emit('toast', { text: `Está esfriando (${Math.round(f.c)}°C): fogueira, abrigo fechado ou roupas`, kind: 'warn' });
        if (lastHeat >= T.chilled && heat < T.chilled) game.events.emit('error', { text: 'Você está com frio!' });
        if (lastHeat >= T.freezing && heat < T.freezing) game.events.emit('error', { text: 'Você está congelando e perdendo vida!' });
        if (lastHeat >= T.hypo && heat < T.hypo) game.events.emit('error', { text: 'Hipotermia! Aqueça-se já' });
      } else if (lastHeat < T.chilled && heat >= T.chilled) game.events.emit('toast', { text: 'O corpo está se aquecendo', kind: 'good' });
      lastHeat = heat;

      // hunger
      let drain = H.drain;
      if (hasBuff(p, 'sprint')) drain *= H.sprint;
      if (p.work) drain *= H.work;
      if (p.inCombat) drain *= H.combat;
      if (chilled) drain *= H.chilled;
      if (p.swimming) drain *= W.hungerSwim; // icy water + effort
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
