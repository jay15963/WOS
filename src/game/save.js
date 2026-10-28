// Save / load to localStorage ('wos.' prefix). Autosave every 20 s and on hide/pagehide.
// Stores player, inventory, buildings, harvested/mined world state (with world-time stamps), clock.

import { applyLevel, respawnPoint } from './player.js';
import { occRemove } from './nav.js';
import { placeBuilding } from './building.js';
import { BUILDINGS, ITEMS } from './data.js';

const VERSION = 1;
const key = (game) => `wos.save.v${VERSION}.${game.world.seed}`;
const OFFLINE_CAP = 3600; // seconds of regrowth credited while away

export function hasSave(game) {
  try { return !!localStorage.getItem(key(game)); } catch { return false; }
}

export function saveGame(game) {
  const p = game.player;
  if (!game._loaded) return false;
  const objects = [];
  for (const o of game.touched.values()) {
    objects.push([o.id, o.stump ? 1 : 0, +(o.age ?? 1).toFixed(3), o.empty ? 1 : 0, o.gone ? 1 : 0, Math.round(o.regrowAt || 0), Math.round(o.cdUntil || 0)]);
  }
  const data = {
    v: VERSION, seed: game.world.seed, savedAt: Date.now(), worldTime: Math.round(game.worldTime),
    env: { hour: +game.env.hour.toFixed(3), day: game.env.dayIndex, weather: game.env.weather },
    player: {
      name: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), facing: p.facing,
      hp: Math.round(p.dead ? p.maxHp * 0.5 : p.hp), energy: Math.round(p.energy), hunger: +p.hunger.toFixed(1),
      level: p.level, xp: Math.round(p.xp), inv: p.inv.toJSON(), respawn: p.respawn, dead: !!p.dead,
    },
    structures: game.build.structures.map((o) => ({ id: o.id, type: o.type, tx: o.tx, ty: o.ty, builtAt: Math.round(o.builtAt || 0), store: o.store ? o.store.toJSON() : undefined })),
    objects,
    mined: game.minedTiles,
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

export function loadGame(game) {
  let data;
  try { data = JSON.parse(localStorage.getItem(key(game)) || 'null'); } catch { data = null; }
  game._loaded = true;
  if (!data || data.v !== VERSION) return false;
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
    if (w.mineRock(tx, ty)) game.minedTiles.push(i);
  }

  // harvested objects
  for (const [id, stump, age, empty, gone, regrowAt, cdUntil] of data.objects || []) {
    const o = w.objById.get(id);
    if (!o) continue;
    if (gone) { occRemove(game, o); w.removeObject(o); o.gone = true; game.touched.set(id, o); continue; }
    o.regrowAt = regrowAt; o.cdUntil = cdUntil;
    if (stump) { o.stump = true; occRemove(game, o); game.regrow.add(o); }
    else if (age < 1) { o.age = age; if (age < 0.6) { o.solid = 0; occRemove(game, o); } game.regrow.add(o); }
    if (empty) { o.empty = true; game.regrow.add(o); }
    game.touched.set(id, o);
  }

  // buildings
  for (const s of data.structures || []) {
    if (!BUILDINGS[s.type]) continue;
    placeBuilding(game, s.type, s.tx, s.ty, s);
  }

  // ground items
  for (const [item, qty, x, y] of data.loot || []) {
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
  p.respawn = d.respawn || null;
  if (d.dead) { const sp = respawnPoint(game); p.x = sp.x; p.y = sp.y; } // saved while dead: wake up at the respawn point
  if (game.ctl && data.hinted) game.ctl.hinted = { ...data.hinted };
  game.cam.x = p.x; game.cam.y = p.y - 0.4;
  return true;
}

export function resetSave(game) {
  try { localStorage.removeItem(key(game)); } catch { /* ignore */ }
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
