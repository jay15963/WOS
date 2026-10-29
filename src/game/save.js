// Save / load to localStorage ('wos.' prefix). Autosave every 20 s and on hide/pagehide.
// v4 (key wos.save.v2.<seed>): { v: 4, worldTime, env, player, world: serializeWorld(...), marks, craft, fuel,
// hinted } — the world part is the SAME serializer as the multiplayer join snapshot (net/snapshot.js), so
// anything persisted is replicated at join by construction. v1 / v2 saves are migrated into a snapshot and
// applied through the same path. v4 (round V2): structure rows carry rot / paid / open / moveOf; older rows are
// legacy (rot 0, paid, closed) and beds saved as 1×1 get a free 1×2 spot (migrateStructRows).
// v5 (round V2, agent I): the world snapshot carries `corpses` (bodies decomposing on the ground); older saves have
// none (nothing to migrate: the field is optional and defaults to an empty list).
// v6 (roofs, agent J): structure rows carry style / det (roofs); older rows get '' (14 → 16 fields). The natural
// roof is re-derived from the mined tiles with the support rule, so old worlds dug wide open lose those ceilings.
// v7 (agent K): every construction piece (not only roofs) carries style / det; rows are the same 16 fields, so nothing
// to migrate beyond v6 (older rows get '' / '' = the default look).
// Guests (game.saveSuffix = '.guest') save ONLY their player (inventory, equipment, level, hints, crafting
// queue, fuel bank): the world belongs to the host. ?nosave=1 (game.noSave) disables every write.

import { applyLevel, respawnPoint } from './player.js';
import { BUILDINGS, ITEMS, ITEM_ALIASES } from './data.js';
import { saveCraft, loadCraft, saveFuel, loadFuel } from './crafting.js';
import { equipChanged, SLOTS } from './equipment.js';
import { collides } from './physics.js';
import { serializeWorld, applyWorld, findNatural } from '../net/snapshot.js';
import { stageOf } from './mut/crops.js';
import { dimsOf } from './mut/structures.js';

const VERSION = 7; // v5 corpses (I) · v6 roofs style / det (J) · v7 style / det on every construction piece (K)
// guests in someone else's world keep a separate save (game.saveSuffix = '.guest'); the key keeps the v2 name
const key = (game, v = 2) => `wos.save.v${v}.${game.world.seed}${game.saveSuffix || ''}`;
const OFFLINE_CAP = 3600; // seconds of regrowth credited while away

export function hasSave(game) {
  try { return !!(localStorage.getItem(key(game)) || localStorage.getItem(key(game, 1))); } catch { return false; }
}

function savePlayer(game) {
  const p = game.player;
  return {
    name: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), facing: p.facing,
    hp: Math.round(p.dead ? p.maxHp * 0.5 : p.hp), energy: Math.round(p.energy), hunger: +p.hunger.toFixed(1),
    level: p.level, xp: Math.round(p.xp), inv: p.inv.toJSON(), respawn: p.respawn, dead: !!p.dead,
    equip: { ...p.equip }, seedPref: p.seedPref || null,
  };
}

export function buildSaveData(game) {
  const guest = game.net.role === 'guest';
  const data = {
    v: VERSION, seed: game.world.seed, savedAt: Date.now(),
    player: savePlayer(game), craft: saveCraft(game), fuel: saveFuel(game), hinted: game.ctl?.hinted || {},
  };
  if (guest) { data.guest = 1; return data; } // never world data in a guest save
  data.worldTime = Math.round(game.worldTime);
  data.env = { hour: +game.env.hour.toFixed(3), day: game.env.dayIndex, weather: game.env.weather };
  data.world = serializeWorld(game, { save: true });
  data.marks = [...game.mining.marks];
  return data;
}

export function saveGame(game) {
  if (!game._loaded || game.noSave) return false;
  try {
    localStorage.setItem(key(game), JSON.stringify(buildSaveData(game)));
    game.lastSave = Date.now();
    return true;
  } catch (e) {
    console.warn('save falhou', e);
    return false;
  }
}

function readSave(game) {
  try {
    return JSON.parse(localStorage.getItem(key(game)) || 'null') || JSON.parse(localStorage.getItem(key(game, 1)) || 'null'); // v1 migrates
  } catch { return null; }
}

// returns true when a save was loaded. Guests load only their player.
export function loadGame(game) {
  const data = game.noSave ? null : readSave(game);
  game._loaded = true;
  if (!data || ![1, 2, 3, 4, 5, 6, VERSION].includes(data.v)) return false;
  if (game.net.role === 'guest') {
    loadPlayer(game, data.player || {}, data);
    return true;
  }
  const away = Math.max(0, Math.min(OFFLINE_CAP, (Date.now() - (data.savedAt || Date.now())) / 1000));
  const wt = (data.worldTime || 0) + away;
  const snap = data.v >= 3 ? { ...(data.world || {}) } : migrateLegacy(game, data, wt);
  if (data.v < VERSION && Array.isArray(snap.structs)) snap.structs = migrateStructRows(game, snap.structs);
  snap.wt = wt;
  snap.env = data.env ? { h: data.env.hour, d: data.env.day, w: data.env.weather } : snap.env;
  applyWorld(game, snap, 'load');
  const w = game.world;
  for (const i of data.marks || []) if (w.rock[i]) game.mining.marks.add(i);
  loadPlayer(game, data.player || {}, data);
  if (data.v === 1) {
    game.later(2.5, () => game.events.emit('toast', { text: 'Mundo atualizado: ferramentas agora são criadas (Criar · C)', kind: 'warn' }));
    if (saveGame(game)) try { localStorage.removeItem(key(game, 1)); } catch { /* ignore */ }
  }
  return true;
}

function loadPlayer(game, d, data) {
  const w = game.world, p = game.player;
  const v1 = data.v === 1;
  loadCraft(game, data.craft);
  if (data.fuel != null) loadFuel(game, data.fuel);
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
}

// ---------- v1 / v2 -> snapshot ----------
const hashId = (s) => { let h = 7; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 1000; };

function migrateLegacy(game, data, wt) {
  const w = game.world, net = game.net;
  const snap = { gone: [], nat: [], dyn: [], falling: [], mined: (data.mined || []).slice(), rockp: [], structs: [], crops: [], loot: [], props: [] };
  if (data.v === 1) {
    for (const [id, stump, , empty, gone] of data.objects || []) {
      const o = w.objById.get(id);
      if (!o || o.building) continue;
      const tree = o.type.startsWith('tree_');
      if (gone || (empty && o.type === 'berrybush')) snap.gone.push(o.id);
      else if (stump && tree) snap.nat.push([o.id, 1, Math.round(wt), 0]);
    }
  } else {
    for (const [id, type, x, y, gone, stump, stumpAt, prog] of data.nat || []) {
      const o = findNatural(w, id, type, x, y);
      if (!o) continue;
      if (gone) snap.gone.push(o.id);
      else snap.nat.push([o.id, stump ? 1 : 0, Math.round(stumpAt || wt), prog || 0]);
    }
    for (const r of data.flora || []) {
      const [type, x, y, v, s, f, born, stump, stumpAt] = r;
      snap.dyn.push([net.newId('f'), type, x, y, v | 0, s || 1, f || 1, born ?? Math.round(wt), stump ? 1 : 0, Math.round(stumpAt || wt), null]);
    }
  }
  let fuel = 0;
  const removeOnFootprint = new Set();
  for (const s of data.structures || []) {
    const def = BUILDINGS[s.type];
    if (!def) continue;
    fuel += s.fuel || 0;
    snap.structs.push([s.id, s.type, s.tx, s.ty, hashId(s.id), s.p ?? 1, s.decon ? 1 : 0, s.store || 0, 0, s.builtAt || 0]);
    // anything natural still standing on a restored structure goes away
    for (let y = s.ty; y < s.ty + def.size[1]; y++) for (let x = s.tx; x < s.tx + def.size[0]; x++) {
      for (const o of w.query(x + 0.5, y + 0.6, 0.9, (q) => !q.building && q.type !== 'crop' && !q.flora && Math.floor(q.x) === x && Math.floor(q.y - 0.05) === y)) removeOnFootprint.add(o.id);
      for (const r of snap.dyn) if (Math.floor(r[2]) === x && Math.floor(r[3] - 0.05) === y) r[1] = null;
    }
  }
  snap.dyn = snap.dyn.filter((r) => r[1]);
  for (const id of removeOnFootprint) if (!snap.gone.includes(id)) snap.gone.push(id);
  if (fuel) game.craft.fuel = (game.craft.fuel || 0) + fuel;
  for (const [kind, tx, ty, growth] of data.crops || []) snap.crops.push([tx, ty, kind, growth || 0, stageOf(growth || 0)]);
  for (const [item0, qty, x, y] of data.loot || []) {
    const item = ITEM_ALIASES[item0] || item0;
    if (ITEMS[item]) snap.loot.push([net.newId('L'), item, qty, x, y]); // sync-ok: rows of a snapshot being built (legacy save migration)
  }
  return snap;
}

// ---------- v3 -> v4: structure footprints that grew (bed 1×1 -> 1×2) ----------
// Old rows (length 10) keep working: rot 0, paid, closed doors. A bed gets the first free 1×2 spot among: extending
// south, extending north, lying east, lying west; else the nearest free spot within 3 tiles (rare).
const GREW = { bed: [1, 1] };
export function migrateStructRows(game, rows) {
  const w = game.world;
  const occ = new Map(); // `${layer}:${tileIdx}` -> row
  const dims = (r) => (r.length <= 10 && GREW[r[1]] ? GREW[r[1]] : dimsOf(r[1], r.length > 10 ? r[10] | 0 : 0));
  const mark = (r, tx, ty, fw, fh, on) => {
    const L = BUILDINGS[r[1]].layer;
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) { const k = L + ':' + w.idx(x, y); if (on) occ.set(k, r); else if (occ.get(k) === r) occ.delete(k); }
  };
  const valid = rows.filter((r) => Array.isArray(r) && BUILDINGS[r[1]]);
  for (const r of valid) { const [fw, fh] = dims(r); mark(r, r[2], r[3], fw, fh, true); }
  const free = (r, tx, ty, fw, fh) => {
    const L = BUILDINGS[r[1]].layer;
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
      if (!w.inBounds(x, y) || x < 1 || y < 1 || x >= w.W - 1 || y >= w.H - 1) return false;
      const i = w.idx(x, y);
      if (w.rock[i] || w.water[i]) return false;
      const o = occ.get(L + ':' + i);
      if (o && o !== r) return false;
    }
    return true;
  };
  const out = [];
  for (const r0 of valid) {
    const r = r0.slice();
    if (r.length <= 10) {
      while (r.length < 10) r.push(0);
      r.push(0, 1, 0, 0); // rot, paid, open, moveOf
      if (GREW[r[1]]) {
        const tx = r[2], ty = r[3];
        mark(r0, tx, ty, 1, 1, false);
        const cands = [[tx, ty, 0], [tx, ty - 1, 0], [tx, ty, 1], [tx - 1, ty, 1]];
        for (let d = 1; d <= 3; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === d) cands.push([tx + dx, ty + dy, 0], [tx + dx, ty + dy, 1]);
        const hit = cands.find(([x, y, rot]) => { const [fw, fh] = dimsOf(r[1], rot); return free(r, x, y, fw, fh); });
        if (!hit) continue; // nowhere to put it: dropped (practically never)
        [r[2], r[3], r[10]] = hit;
        const [fw, fh] = dimsOf(r[1], hit[2]);
        mark(r, hit[0], hit[1], fw, fh, true);
      }
    }
    while (r.length < 14) r.push(0);
    while (r.length < 16) r.push(''); // v6: style, det
    out.push(r);
  }
  return out;
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
    sync: 'owner', // host: world + player; guest: player only
    update(g, dt) {
      t += dt;
      if (t >= 20) { t = 0; doSave(); }
    },
  };
}
