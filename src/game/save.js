// Save / load to localStorage ('wos.' prefix). Autosave every 20 s and on hide/pagehide.
// v2: player (inventory, equipment), structures (progress / masks recomputed / stores / fuel / decon),
// harvested natural objects (by id, validated by type + position), regrown flora, mined tiles,
// mining designations, crops, crafting queue, ground items, hints. Migrates v1 saves.

import { applyLevel, respawnPoint } from './player.js';
import { occRemove } from './nav.js';
import { placeStructure } from './building.js';
import { BUILDINGS, ITEMS, ITEM_ALIASES } from './data.js';
import { saveFlora, loadFlora, SAPLING_GROW } from './flora.js';
import { saveCrops, loadCrops } from './farming.js';
import { saveCraft, loadCraft } from './crafting.js';
import { equipChanged, SLOTS } from './equipment.js';
import { collides } from './physics.js';

const VERSION = 2;
// guests in someone else's world keep a separate save (game.saveSuffix = '.guest')
const key = (game, v = VERSION) => `wos.save.v${v}.${game.world.seed}${game.saveSuffix || ''}`;
const OFFLINE_CAP = 3600; // seconds of regrowth credited while away

export function hasSave(game) {
  try { return !!(localStorage.getItem(key(game)) || localStorage.getItem(key(game, 1))); } catch { return false; }
}

export function saveGame(game) {
  const p = game.player;
  if (!game._loaded) return false;
  const nat = [];
  for (const o of game.touched.values()) {
    if (o.flora) continue;
    nat.push([o.id, o.type, +o.x.toFixed(2), +o.y.toFixed(2), o.gone ? 1 : 0, o.stump ? 1 : 0, Math.round(o.stumpAt || 0), +(o.prog || 0).toFixed(2)]);
  }
  const data = {
    v: VERSION, seed: game.world.seed, savedAt: Date.now(), worldTime: Math.round(game.worldTime),
    env: { hour: +game.env.hour.toFixed(3), day: game.env.dayIndex, weather: game.env.weather },
    player: {
      name: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), facing: p.facing,
      hp: Math.round(p.dead ? p.maxHp * 0.5 : p.hp), energy: Math.round(p.energy), hunger: +p.hunger.toFixed(1),
      level: p.level, xp: Math.round(p.xp), inv: p.inv.toJSON(), respawn: p.respawn, dead: !!p.dead,
      equip: { ...p.equip }, seedPref: p.seedPref || null,
    },
    structures: game.build.structures.map((o) => {
      const s = { id: o.id, type: o.type, tx: o.tx, ty: o.ty, builtAt: Math.round(o.builtAt || 0) };
      if (o.progress < 1) s.p = +o.progress.toFixed(3);
      if (o.store) s.store = o.store.toJSON();
      if (o.fuel) s.fuel = o.fuel;
      if (game.build.decon.has(o)) s.decon = 1;
      return s;
    }),
    nat,
    flora: saveFlora(game),
    mined: game.minedTiles,
    marks: [...game.mining.marks],
    crops: saveCrops(game),
    craft: saveCraft(game),
    loot: game.loot.filter((l) => l.t < 240).slice(-80).map((l) => [l.item, l.qty, +l.x.toFixed(2), +l.y.toFixed(2)]),
    hinted: game.ctl?.hinted || {},
  };
  try {
    localStorage.setItem(key(game), JSON.stringify(data));
    game.lastSave = Date.now();
    return true;
  } catch (e) {
    console.warn('save falhou', e);
    return false;
  }
}

// find a natural object saved as (id, type, x, y): exact id first, then the same type at the same spot
function findNatural(w, id, type, x, y) {
  const o = w.objById.get(id);
  if (o && (!type || (o.type === type && Math.abs(o.x - x) < 0.6 && Math.abs(o.y - y) < 0.6))) return o;
  if (!type) return null;
  const near = w.query(x, y, 0.6, (q) => q.type === type && !q.building && !q.flora);
  return near[0] || null;
}

function removeQuiet(game, o) {
  occRemove(game, o);
  game.world.removeObject(o);
  o.gone = true;
  game.touched.set(o.id, o);
}

function makeStump(game, o, at) {
  o.stump = true; o.stumpAt = at; o.prog = 0;
  occRemove(game, o);
  game.stumps.add(o);
  game.touched.set(o.id, o);
}

export function loadGame(game) {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(key(game)) || 'null');
    if (!data) data = JSON.parse(localStorage.getItem(key(game, 1)) || 'null'); // migrate v1
  } catch { data = null; }
  game._loaded = true;
  if (!data || (data.v !== 1 && data.v !== VERSION)) return false;
  const v1 = data.v === 1;
  const w = game.world, p = game.player;
  const away = Math.max(0, Math.min(OFFLINE_CAP, (Date.now() - (data.savedAt || Date.now())) / 1000));
  game.worldTime = (data.worldTime || 0) + away;

  if (data.env) {
    game.env.hour = data.env.hour ?? game.env.hour;
    game.env.dayIndex = data.env.day ?? game.env.dayIndex;
    if (data.env.weather) game.env.setWeather?.(data.env.weather);
  }

  // mined rock tiles
  for (const i of data.mined || []) {
    const tx = i % w.W, ty = Math.floor(i / w.W);
    if (w.mineRock(tx, ty)) { game.minedTiles.push(i); game.minedSet.add(i); }
  }

  // natural objects
  if (v1) {
    for (const [id, stump, age, empty, gone] of data.objects || []) {
      const o = w.objById.get(id);
      if (!o || o.building) continue;
      const tree = o.type.startsWith('tree_');
      // (ids may point at different objects after world generator changes: only apply what fits the type)
      if (gone || (empty && o.type === 'berrybush')) { removeQuiet(game, o); continue; }
      if (stump && tree) makeStump(game, o, game.worldTime);
      else if (age < 1 && tree) {
        o.age = age; o.born = game.worldTime - Math.max(0, age - 0.08) * SAPLING_GROW;
        if (age < 0.6) { o.solid = 0; occRemove(game, o); }
        game.flora.growing.add(o); game.touched.set(id, o);
      }
    }
  } else {
    for (const [id, type, x, y, gone, stump, stumpAt, prog] of data.nat || []) {
      const o = findNatural(w, id, type, x, y);
      if (!o) continue;
      if (gone) { removeQuiet(game, o); continue; }
      if (stump) makeStump(game, o, stumpAt || game.worldTime);
      if (prog) { o.prog = prog; game.touched.set(o.id, o); }
    }
    loadFlora(game, data.flora);
  }

  // buildings (old v1 structures are complete)
  for (const s of data.structures || []) {
    if (!BUILDINGS[s.type]) continue;
    const def = BUILDINGS[s.type];
    let ok = true;
    for (let y = s.ty; y < s.ty + def.size[1]; y++) for (let x = s.tx; x < s.tx + def.size[0]; x++) {
      if (!w.inBounds(x, y) || w.rock[w.idx(x, y)] || game.build.grid[def.layer].has(w.idx(x, y))) ok = false;
    }
    if (!ok) continue;
    // anything natural still standing on a restored structure goes away
    for (let y = s.ty; y < s.ty + def.size[1]; y++) for (let x = s.tx; x < s.tx + def.size[0]; x++) {
      for (const o of w.query(x + 0.5, y + 0.6, 0.9, (q) => !q.building && q.type !== 'crop' && Math.floor(q.x) === x && Math.floor(q.y - 0.05) === y)) {
        if (o.flora) { game.world.removeObject(o); game.flora.dyn.delete(o.id); occRemove(game, o); } else removeQuiet(game, o);
      }
    }
    placeStructure(game, s.type, s.tx, s.ty, { id: s.id, progress: s.p ?? 1, builtAt: s.builtAt, store: s.store, fuel: s.fuel, decon: s.decon });
  }

  loadCrops(game, data.crops);
  for (const i of data.marks || []) if (w.rock[i]) game.mining.marks.add(i);
  loadCraft(game, data.craft);

  // ground items
  for (const [item0, qty, x, y] of data.loot || []) {
    const item = ITEM_ALIASES[item0] || item0;
    if (ITEMS[item]) game.loot.push({ id: 1e6 + game.loot.length, item, qty, x, y, vx: 0, vy: 0, lift: 0, vlift: 0, t: 1, ph: Math.random() * 6 });
  }

  // player
  const d = data.player || {};
  p.name = d.name || p.name;
  p.level = Math.max(1, d.level | 0 || 1);
  applyLevel(p);
  p.xp = d.xp || 0;
  if (Number.isFinite(d.x) && Number.isFinite(d.y) && w.inBounds(Math.floor(d.x), Math.floor(d.y))) { p.x = d.x; p.y = d.y; }
  p.facing = d.facing || 's';
  p.hp = Math.max(1, Math.min(p.maxHp, d.hp ?? p.maxHp));
  p.energy = Math.min(p.maxEnergy, d.energy ?? p.maxEnergy);
  p.hunger = Math.min(p.maxHunger, d.hunger ?? p.maxHunger);
  p.inv.load(d.inv);
  if (d.equip && !v1) for (const s of SLOTS) { const id = d.equip[s]; p.equip[s] = id && ITEMS[id]?.slot === s ? id : null; }
  p.seedPref = d.seedPref || null;
  equipChanged(game);
  p.respawn = d.respawn || null;
  if (d.dead) { const sp = respawnPoint(game); p.x = sp.x; p.y = sp.y; } // saved while dead: wake up at the respawn point
  if (collides(w, p.x, p.y, p.r, null, true)) { // never wake up stuck inside something built later
    const x0 = p.x, y0 = p.y;
    for (let k = 0; k < 40 && collides(w, p.x, p.y, p.r, null, true); k++) { const a = k * 2.4, r = 0.3 + k * 0.1; p.x = x0 + Math.cos(a) * r; p.y = y0 + Math.sin(a) * r; }
  }
  if (game.ctl && data.hinted) game.ctl.hinted = { ...data.hinted };
  game.cam.x = p.x; game.cam.y = p.y - 0.4;
  if (v1) {
    game.later(2.5, () => game.events.emit('toast', { text: 'Mundo atualizado: ferramentas agora são criadas (Criar · C)', kind: 'warn' }));
    if (saveGame(game)) try { localStorage.removeItem(key(game, 1)); } catch { /* ignore */ }
  }
  return true;
}

export function resetSave(game) {
  try { localStorage.removeItem(key(game)); localStorage.removeItem(key(game, 1)); } catch { /* ignore */ }
}

export function saveSystem(game) {
  const doSave = () => saveGame(game);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') doSave(); });
  addEventListener('pagehide', doSave);
  let t = 0;
  return {
    update(g, dt) {
      t += dt;
      if (t >= 20) { t = 0; doSave(); }
    },
  };
}
