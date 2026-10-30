// Saved worlds of this browser (up to MAX_WORLDS): registry `wos.worlds` = [{ id, name, seed, mode, created, played }]
// (mode 'survival' | 'creative', creative.js). A world's save lives under `wos.save.v2.<id>` (game.worldId, save.js)
// and its hotbar layout under `wos.hotbar.<id>` (hotbar.js). Worlds from before the list (one save per seed,
// `wos.save.v2.<seed>`) join it on first use with id = String(seed), so their keys stay as they were.
// Guests keep their per-host player saves keyed by the host's seed (+ '.guest'), outside the list.
import { elapsedOf, formatElapsed, dateOf } from '../game/calendar.js';

export const MAX_WORLDS = 10;
const KEY = 'wos.worlds', LAST = 'wos.world';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
};

function read() {
  try { const v = JSON.parse(ls.get(KEY) || 'null'); return Array.isArray(v) ? v.filter((w) => w && w.id) : null; } catch { return null; }
}
const write = (list) => ls.set(KEY, JSON.stringify(list.slice(0, MAX_WORLDS)));

// first use: the saves made before the list become its worlds
function migrate() {
  let list = read();
  if (list) return list;
  list = [];
  const now = Date.now();
  for (const k of ls.keys()) {
    const m = /^wos\.save\.v[12]\.(\d+)$/.exec(k);
    if (!m || list.some((w) => w.id === m[1])) continue;
    list.push({ id: m[1], name: `Mundo ${m[1]}`, seed: +m[1], mode: 'survival', created: now, played: now - list.length });
  }
  const last = ls.get('wos.seed');
  const lw = last && list.find((w) => w.id === last);
  if (lw) { lw.played = now + 1; ls.set(LAST, lw.id); }
  write(list);
  return list;
}

export function listWorlds() { return migrate().slice().sort((a, b) => (b.played || 0) - (a.played || 0)); }
export function getWorld(id) { return migrate().find((w) => w.id === id) || null; }
export function lastWorld() { const id = ls.get(LAST); return (id && getWorld(id)) || listWorlds()[0] || null; }

// day / level of a world's save and how long it has lived ("2 anos e 3 dias": calendar.js) — null: never saved yet
export function worldInfo(id) {
  const raw = ls.get(`wos.save.v2.${id}`) || ls.get(`wos.save.v1.${id}`);
  if (!raw) return null;
  let day = 1, level = 1;
  try { const d = JSON.parse(raw); day = d.env?.day ?? d.world?.env?.d ?? d.day ?? 1; level = d.player?.level ?? d.level ?? 1; } catch { /* unreadable: defaults */ }
  return { day, level, age: formatElapsed(elapsedOf(day)), date: dateOf(day) };
}

export function randomSeed() { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 2147483000) + 1; }

// a new world in the list (null when it is full)
export function createWorld({ name, seed, mode }) {
  const list = migrate();
  if (list.length >= MAX_WORLDS) return null;
  const s = Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed();
  let id;
  do id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); while (list.some((w) => w.id === id)); // sync-ok: a local save-slot id of this browser, never shared state
  const n = list.length + 1;
  const w = { id, name: String(name || '').trim().slice(0, 28) || `Mundo ${n}`, seed: s, mode: mode === 'creative' ? 'creative' : 'survival', created: Date.now(), played: Date.now() };
  list.push(w);
  write(list);
  return w;
}

export function renameWorld(id, name) {
  const list = migrate(), w = list.find((q) => q.id === id);
  if (!w) return;
  w.name = String(name || '').trim().slice(0, 28) || w.name;
  write(list);
}

// gone for good: the entry, its save and its hotbar layout
export function deleteWorld(id) {
  const list = migrate().filter((w) => w.id !== id);
  write(list);
  for (const k of [`wos.save.v2.${id}`, `wos.save.v1.${id}`, `wos.hotbar.${id}`]) ls.del(k);
  if (ls.get(LAST) === id) ls.del(LAST);
}

// the world being played (it moves to the top of the list)
export function touchWorld(id) {
  const list = migrate(), w = list.find((q) => q.id === id);
  if (!w) return;
  w.played = Date.now();
  write(list);
  ls.set(LAST, id);
}

// "há 3 dias" style label of a timestamp
export function agoLabel(t) {
  const s = Math.max(0, (Date.now() - (t || 0)) / 1000);
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
