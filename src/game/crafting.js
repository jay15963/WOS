// Crafting: recipes by station (content/recipes.js). Ingredients are paid when queued (refunded on
// cancel); each item takes time while the player stands still near the station (progress bar over the
// player via p.work, owner 'craft'); moving pauses, staying idle in range resumes. Furnace recipes burn
// fuel (wood 1 / coal 3 units, kept in station.fuel). Stations get o.working = true while crafting.

import { RECIPES, STATION_RANGE, FUEL_VALUE, STATION_PT, stationsOf } from './content/recipes.js';
import { ITEMS, BUILDINGS } from './data.js';
import { structuresNear } from './building.js';
import { gainXp } from './player.js';
import { dropLoot } from './loot.js';
import { faceTowards } from './combat.js';
import { equipItem } from './equipment.js';

export const MAX_QUEUE = 8;
const WORK_LINGER = 1.6; // s a furnace keeps glowing between items

export function initCrafting(game) {
  game.craft = { queue: [], v: 0, status: null };
}

const stationName = (r) => stationsOf(r).map((s) => STATION_PT[s]).join(' ou ');

export function nearestStation(game, r) {
  if (r.station === 'hand') return null;
  const types = stationsOf(r);
  const p = game.player;
  let best = null, bd = 1e9;
  for (const o of structuresNear(game, p.x, p.y, STATION_RANGE, (s) => types.includes(s.type))) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

const anyBuilt = (game, types) => game.build.structures.some((o) => !o.blueprint && types.includes(o.type));

function fuelAvailable(game, st) {
  const inv = game.player.inv;
  return (st?.fuel || 0) + inv.count('wood') * FUEL_VALUE.wood + inv.count('coal') * FUEL_VALUE.coal;
}

// UI-facing state of a recipe
export function recipeState(game, id) {
  const r = RECIPES[id], p = game.player;
  const missing = {};
  let have = true;
  for (const k in r.in) { const n = p.inv.count(k); if (n < r.in[k]) { have = false; missing[k] = r.in[k] - n; } }
  const st = nearestStation(game, r);
  const stationOk = r.station === 'hand' || !!st;
  let reason = null;
  if (!stationOk) reason = anyBuilt(game, stationsOf(r)) ? `Fique perto: ${stationName(r)}` : `Precisa de: ${stationName(r)}`;
  else if (!have) reason = 'Faltam materiais';
  else if (r.fuel && fuelAvailable(game, st) - (r.in.wood || 0) < r.fuel) reason = 'Sem combustível (madeira ou carvão)';
  return { ok: !reason, have, stationOk, station: st, reason, missing, queueFull: game.craft.queue.length >= MAX_QUEUE };
}

export function enqueue(game, id, n = 1) {
  const r = RECIPES[id], p = game.player, Q = game.craft.queue;
  let made = 0;
  for (let k = 0; k < n; k++) {
    if (Q.length >= MAX_QUEUE) { if (!made) game.events.emit('error', { text: 'Fila de criação cheia' }); break; }
    const s = recipeState(game, id);
    if (!s.ok) { if (!made) game.events.emit('error', { text: s.reason }); break; }
    if (!p.inv.pay(r.in)) break;
    Q.push({ id, t: 0, station: r.station === 'hand' ? null : s.station.id });
    made++;
  }
  if (made) {
    game.craft.v++;
    game.events.emit('inventory', {});
    game.audio?.play('ui', {});
  }
  return made;
}

export function cancelCraft(game, index) {
  const Q = game.craft.queue, e = Q[index];
  if (!e) return;
  Q.splice(index, 1);
  const r = RECIPES[e.id], p = game.player;
  for (const k in r.in) {
    const left = p.inv.add(k, r.in[k]);
    for (let j = 0; j < left; j++) dropLoot(game, p.x, p.y, k, 1, 0.5);
  }
  if (index === 0 && p.work?.owner === 'craft') { p.work = null; p.action = null; }
  game.craft.v++;
  game.events.emit('inventory', {});
}

function takeFuel(game, st, need) {
  const inv = game.player.inv;
  st.fuel = st.fuel || 0;
  while (st.fuel < need) {
    if (inv.remove('wood', 1)) st.fuel += FUEL_VALUE.wood;
    else if (inv.remove('coal', 1)) st.fuel += FUEL_VALUE.coal;
    else return false;
  }
  st.fuel -= need;
  game.events.emit('inventory', {});
  return true;
}

function complete(game, e, st) {
  const r = RECIPES[e.id], p = game.player, def = ITEMS[r.out];
  const left = p.inv.add(r.out, r.qty || 1);
  const got = (r.qty || 1) - left;
  if (got) game.events.emit('loot', { item: r.out, qty: got });
  for (let k = 0; k < left; k++) dropLoot(game, p.x, p.y, r.out, 1, 0.5);
  if (left) game.events.emit('error', { text: 'Mochila cheia: item no chão' });
  game.audio?.play(r.cat === 'food' ? 'eat' : 'build', { x: p.x, y: p.y, volume: 0.6 });
  game.juice.puff(st ? st.x : p.x, (st ? st.y : p.y) - 0.3, 5, [0.85, 0.8, 0.7], 0.5);
  gainXp(game, Math.max(2, Math.round(r.time)));
  // first weapon / armour piece goes straight to its empty slot
  if (def?.slot && !p.equip[def.slot] && got && !(def.slot === 'off' && ITEMS[p.equip.main]?.weapon?.twoHanded)) {
    const wasTool = def.cat === 'tool';
    if (!wasTool || !p.equip.main) if (equipItem(game, r.out)) game.events.emit('toast', { text: `Equipado: ${def.name}`, kind: 'good' });
  }
  game.events.emit('crafted', { id: e.id, item: r.out });
  game.events.emit('inventory', {});
}

export function craftingSystem() {
  const lit = new Set();
  return {
    update(game, dt) {
      const C = game.craft, Q = C.queue, p = game.player, ctl = game.ctl;
      let active = null, going = false;
      C.status = null;
      if (Q.length && !p.dead) {
        const e = Q[0], r = RECIPES[e.id];
        let st = null;
        if (r.station !== 'hand') {
          st = game.world.objById.get(e.station);
          if (!st || st.removed || !structuresNear(game, p.x, p.y, STATION_RANGE, (o) => o === st).length) st = nearestStation(game, r);
          if (st) e.station = st.id;
        }
        const busy = p.moving || ctl?.goal || (p.work && p.work.owner !== 'craft') || (p.autoAttack && p.target && !p.target.dead) || p.charge;
        if (r.station !== 'hand' && !st) C.status = `Volte para perto: ${stationName(r)}`;
        else if (busy) C.status = 'Pausado (fique parado)';
        else if (r.fuel && !e.fueled && !takeFuel(game, st, r.fuel)) {
          C.status = 'Sem combustível (madeira ou carvão)';
          if (!e.fuelMsgT || game.time > e.fuelMsgT) { e.fuelMsgT = game.time + 6; game.events.emit('error', { text: C.status }); }
        } else {
          if (r.fuel) e.fueled = true;
          active = st; going = true;
          e.t += dt;
          const k = Math.min(1, e.t / r.time);
          const type = st && !['campfire', 'cooking_pot'].includes(st.type) ? 'build' : 'gather';
          if (p.work?.owner !== 'craft') p.work = { owner: 'craft', it: { kind: 'craft' }, type, t: 0 };
          const wk = p.work;
          wk.k = k; wk.type = type;
          wk.label = `${ITEMS[r.out].name}${Q.length > 1 ? ` (+${Q.length - 1})` : ''}`;
          p.action = { type, t: type === 'build' ? (e.t * 1.6) % 1 : 0 };
          if (st) faceTowards(p, { x: st.x, y: st.y - 0.5 });
          if (e.t >= r.time) {
            Q.shift();
            C.v++;
            complete(game, e, st);
            if (!Q.length) { p.work = null; p.action = null; }
          }
        }
        if (!going && p.work?.owner === 'craft') { p.work = null; p.action = null; }
      } else if (p.work?.owner === 'craft') { p.work = null; p.action = null; }

      // station working state (+ light / fire for furnace & pot)
      if (active) { active.workT = WORK_LINGER; lit.add(active); }
      for (const o of lit) {
        if (o !== active) o.workT = (o.workT || 0) - dt;
        const on = o.workT > 0 && !o.removed;
        if (o.working !== on) {
          o.working = on;
          const def = BUILDINGS[o.type];
          if (def.workLight) { if (on) o.light = { ...def.workLight }; else delete o.light; }
          if (def.warmWorking && o.type !== 'campfire') o.fire = on;
        }
        if (!on) lit.delete(o);
      }
    },
  };
}

export function saveCraft(game) {
  return game.craft.queue.map((e) => [e.id, +e.t.toFixed(2), e.station || 0, e.fueled ? 1 : 0]);
}

export function loadCraft(game, arr) {
  for (const [id, t, station, fueled] of arr || []) {
    if (!RECIPES[id]) continue;
    game.craft.queue.push({ id, t: t || 0, station: station || null, fueled: !!fueled });
  }
}
