// Corpses (I · corpos e decomposição): every living being leaves a body on the ground that decomposes in
// SHARED world time, counted from the moment of death (game.worldTime, one day = env.dayLength s):
//   age < 1 day: fresh · 1..2: rotten · 2..5: skeleton · ≥ 5: removed by the host (corpse.remove).
// The stage is derived on every peer from (worldTime - deathT); only creation, contents, butchering and
// removal are ops.
//
// Ops:     corpse.add · corpse.set · corpse.butcher · corpse.remove
// Intents: corpse.player (a player died: its items go into the body) · corpse.put · corpse.take ·
//          store.sort (chest or corpse) · corpse.butcher ("Coletar", day 1, animals) · corpse.bones ("Remover ossada")
//
// Shared corpse fields (snapshot / digest): id, of ('pawn' | species), x, y, f (facing), deathT, size, store
// (pawn bodies), butchered, owner (pid of a dead player), name (window title), look (pawns), sc (scale),
// v (variant), gear ([main, off, body, head] worn at death, visual only).
// Cosmetic: _t0 (local clock when it appeared: fall animation), _ph, _fly.

import { defineIntent, defineOp } from '../../net/registry.js';
import { ITEMS, ITEM_ALIASES, SPECIES } from '../data.js';
import { Inventory } from '../inventory.js';
import { ri } from './roll.js';
import { sortSlots, SORT_MODES } from '../itemsort.js';

export const CORPSE_SLOTS = 30;      // a player carries 24 + 4 equipped
export const BANDIT_SLOTS = 12;
export const MAX_CORPSES = 150;      // oldest bodies go first beyond this (host)
export const DAY_ROTTEN = 1, DAY_SKELETON = 2, DAY_GONE = 5;
// size class of a body: skeleton / carcass art, work time and bones
export const SIZE_OF = { rabbit: 's', fox: 's', spider: 's', deer: 'm', wolf: 'm', boar: 'm', bear: 'l', pawn: 'p' };
export const BONES = { s: 1, m: 2, l: 4, p: 3 };
const REACH = 3.2;                   // host check (the window closes at 2.6 on the client)

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round((v || 0) * 100) / 100;

export const dayLen = (game) => game.env?.dayLength || 720;
export const corpseAge = (game, c) => (game.worldTime - c.deathT) / dayLen(game);
// 'fresh' | 'rotten' | 'skeleton' | 'gone'
export function stageOf(game, c) {
  const d = corpseAge(game, c);
  return d < DAY_ROTTEN ? 'fresh' : d < DAY_SKELETON ? 'rotten' : d < DAY_GONE ? 'skeleton' : 'gone';
}
export const corpseById = (game, id) => game.corpses?.map.get(id) || null;
export const isPawnCorpse = (c) => c.of === 'pawn';
export const sizeOf = (c) => SIZE_OF[c.of] || 'm';
export const bonesOf = (c) => (c.of === 'spider' ? 0 : BONES[sizeOf(c)] || 1);
const near = (e, c, r = REACH) => !e || Math.hypot(e.x - c.x, e.y - c.y) <= r;

// row = [id, of, x, y, f, deathT, size, slots|0, butchered, owner|0, name|0, look|0, sc, v, gear|0, src|0]
export function corpseRow(c, src = 0) {
  return [c.id, c.of, r2(c.x), r2(c.y), c.f, r2(c.deathT), c.size | 0, c.store ? c.store.toJSON() : 0, c.butchered ? 1 : 0,
    c.owner || 0, c.name || 0, c.look || 0, c.sc || 1, c.v | 0, c.gear || 0, src || 0];
}

const cleanJSON = (v, max) => { try { const s = JSON.stringify(v); return s && s.length <= max ? JSON.parse(s) : 0; } catch { return 0; } };

// applier / snapshot helper: create (or overwrite) a corpse from a row
export function addCorpse(game, r, { fresh = true } = {}) {
  if (!Array.isArray(r) || typeof r[0] !== 'string') return null;
  const [id, of, x, y, f, deathT, size, slots, butchered, owner, name, look, sc, v, gear, src] = r;
  if (of !== 'pawn' && !SPECIES[of]) return null;
  const C = game.corpses;
  let c = C.map.get(id);
  if (!c) {
    c = { id, _t0: fresh ? game.time : -100, _ph: phase(id) };
    C.map.set(id, c);
  }
  Object.assign(c, {
    of, x: num(x), y: num(y), f: typeof f === 'string' ? f : 'e', deathT: num(deathT), size: Math.max(0, Math.min(60, size | 0)),
    butchered: !!butchered, owner: owner || null, name: typeof name === 'string' ? name.slice(0, 48) : null,
    look: look && typeof look === 'object' ? cleanJSON(look, 4000) || null : null, sc: num(sc, 1) || 1, v: v | 0,
    gear: Array.isArray(gear) ? gear.slice(0, 4).map((g) => (typeof g === 'string' && ITEMS[g] ? g : null)) : null,
  });
  if (c.size > 0) {
    if (!c.store || c.store.size !== c.size) c.store = new Inventory(c.size);
    c.store.load(slots || []);
  } else c.store = null;
  C.v++;
  game.events.emit('corpse', { c, add: fresh, src: src || null });
  return c;
}

export function removeCorpse(game, c, fx = null) {
  const C = game.corpses;
  if (!C.map.delete(c.id)) return;
  c.removed = true;
  C.v++;
  game.events.emit('corpse', { c, removed: true, fx });
}

const storeClone = (c) => { const inv = new Inventory(c.store.size); inv.load(c.store.toJSON()); return inv; };

// ---------- authority helpers ----------
// slot list [[id, qty]] → clean list (known items, sane quantities), aliases resolved
function cleanSlots(list, max) {
  const out = [];
  for (const s of Array.isArray(list) ? list.slice(0, max) : []) {
    if (!Array.isArray(s)) continue;
    const id = ITEM_ALIASES[s[0]] || s[0];
    if (typeof id !== 'string' || !ITEMS[id]) continue;
    out.push([id, Math.max(1, Math.min(999, num(s[1], 1) | 0))]);
  }
  return out;
}

// ground-loot rows [id, item, qty, …] (kill loot tables) → slot list
function rowsToSlots(rows) {
  const acc = new Map();
  for (const r of rows || []) if (Array.isArray(r) && ITEMS[r[1]]) acc.set(r[1], (acc.get(r[1]) || 0) + (r[2] | 0 || 1));
  return [...acc].map(([id, n]) => [id, n]);
}

const facing4 = (f) => (f === 'e' || f === 'w' || f === 'n' || f === 's' ? f : 'e');
// pawn bodies lie sideways: facing n/s at death becomes e/w (stable by id)
const lieDir = (f, id) => (f === 'e' || f === 'w' ? f : (phase(id) > Math.PI ? 'e' : 'w'));

// authority: a creature died (killMob) → its body; humanoid raiders keep their loot rows inside it
export function corpseFromMob(game, m, rows) {
  const net = game.net;
  const pawn = m.kind === 'pawn';
  const id = net.newId('c');
  const slots = pawn ? rowsToSlots(rows).slice(0, BANDIT_SLOTS) : 0;
  const name = pawn ? (m.role === 'chief' ? 'Corpo do chefe dos saqueadores' : m.name === 'Saqueadora' ? 'Corpo da saqueadora' : 'Corpo do saqueador') : 0;
  const gear = pawn ? [m.weapon || null, m.offhand || null, m.armor?.body || null, m.armor?.head || null] : 0;
  net.emit('corpse.add', { list: [[id, pawn ? 'pawn' : m.species, r2(m.x), r2(m.y), pawn ? lieDir(m.facing, id) : facing4(m.facing), r2(game.worldTime),
    pawn ? BANDIT_SLOTS : 0, slots, 0, 0, name, pawn ? m.look || 0 : 0, m.scale || 1, m.variant | 0, gear, m.nid || 0]] });
  capCorpses(game);
  return id;
}

// authority: too many bodies → the oldest go
export function capCorpses(game) {
  const C = game.corpses;
  if (C.map.size <= MAX_CORPSES) return;
  const old = [...C.map.values()].sort((a, b) => a.deathT - b.deathT).slice(0, C.map.size - MAX_CORPSES).map((c) => c.id);
  game.net.emit('corpse.remove', { ids: old, quiet: 1 });
}

// butcher yields from the species loot table (rolled on the host). blade: 'knife'|'sword'|'axe'|0, tier 0..4.
// A blade: full table, +1 meat 35%, +1 hide 50% with a copper+ knife. Bare hands: no hide, ~60% of the meat.
export function butcherYield(net, species, blade, tier) {
  const give = {};
  const rows = SPECIES[species]?.loot || [];
  for (const [item, a, b, chance, flag] of rows) {
    if (!ITEMS[item]) continue;
    if (flag === 'skin' && !blade) continue;
    if (net.roll() > chance * (blade ? 1 : 0.8)) continue;
    let n = ri(net, a, b);
    if (blade) {
      if (item === 'meat' && net.roll() < 0.35) n++;
      if (item === 'leather' && blade === 'knife' && tier >= 2 && net.roll() < 0.5) n++;
    } else n = Math.max(1, Math.floor(n * 0.6));
    give[item] = (give[item] || 0) + n;
  }
  if (!Object.keys(give).length && rows[0] && ITEMS[rows[0][0]] && rows[0][4] !== 'skin') give[rows[0][0]] = 1;
  return give;
}

// ---------- ops ----------
defineOp('corpse.add', {
  doc: 'Bodies appear (host death path): rows [id, of, x, y, f, deathT, size, slots, butchered, owner, name, look, sc, v, gear, src].',
  args: { list: '[[id, of, x, y, f, deathT, size, slots|0, butchered, owner|0, name|0, look|0, sc, v, gear|0, src|0]]', by: 'pid?', toast: 'string?' },
  apply(game, a) {
    for (const r of a.list || []) {
      const c = addCorpse(game, r);
      if (c) game.juice.puff(c.x, c.y, 6, [0.62, 0.56, 0.48], 0.5);
    }
  },
});

defineOp('corpse.set', {
  doc: 'New contents of a body (whole slot list); `give` hands taken / leftover items to `by`.',
  args: { id: 'corpseId', slots: 'Inventory.toJSON()', by: 'pid?', give: '{item: qty}?', quiet: '0|1' },
  apply(game, a) {
    const c = corpseById(game, a.id);
    if (!c || !c.store) return;
    c.store.load(a.slots);
    game.corpses.v++;
    game.events.emit('container', { key: 'corpse:' + c.id });
  },
});

defineOp('corpse.butcher', {
  doc: '"Coletar": an animal body was butchered on its first day (yields rolled by the host, given to `by`); it becomes a carcass.',
  args: { id: 'corpseId', by: 'pid', give: '{item: qty}', xp: 'number', tip: '[key, text, max]?' },
  apply(game, a) {
    const c = corpseById(game, a.id);
    if (!c) return;
    c.butchered = true;
    game.corpses.v++;
    game.juice.blood(c.x, c.y - 0.1, 8);
    game.audio?.play('butcher', { x: c.x, y: c.y });
    game.events.emit('corpse', { c, butchered: true });
  },
});

defineOp('corpse.remove', {
  doc: 'Bodies disappear: bones collected ("Remover ossada", fx bones, bones as give) or expired after 5 days / cap (host).',
  args: { ids: '[corpseId]', by: 'pid?', give: '{item: qty}?', xp: 'number?', fx: "'bones'?", quiet: '0|1', toast: 'string?' },
  apply(game, a) {
    for (const id of a.ids || []) {
      const c = corpseById(game, id);
      if (!c) continue;
      if (a.fx === 'bones') game.audio?.play('bones', { x: c.x, y: c.y });
      removeCorpse(game, c, a.fx === 'bones' ? 'bones' : null);
    }
  },
});

// ---------- intents ----------
defineIntent('corpse.player', {
  doc: 'The actor died: its bag and equipped items (already removed, refunded on reject) stay in its body.',
  args: { x: 'number', y: 'number', f: "'s'|'n'|'e'|'w'", slots: '[[item, qty]] (≤ 30)', gear: '[main, off, body, head]' },
  run(game, a, actor, net) {
    const e = actor.ent;
    let x = num(a.x, e?.x ?? 0), y = num(a.y, e?.y ?? 0);
    if (e && Math.hypot(x - e.x, y - e.y) > 8) { x = e.x; y = e.y; } // trust the owner's position within reason
    const W = game.world;
    x = Math.max(1, Math.min(W.W - 1, x)); y = Math.max(1, Math.min(W.H - 1, y));
    const slots = cleanSlots(a.slots, CORPSE_SLOTS);
    const gear = Array.isArray(a.gear) ? a.gear.slice(0, 4).map((g) => (typeof g === 'string' && ITEMS[g] ? g : null)) : 0;
    const look = e?.look || e?.ent?.look || 0;
    const pname = String(e?.name || 'Sobrevivente').slice(0, 24);
    const id = net.newId('c');
    net.emit('corpse.add', { list: [[id, 'pawn', r2(x), r2(y), lieDir(facing4(a.f), id), r2(game.worldTime), CORPSE_SLOTS, slots, 0, actor.pid, `Corpo de ${pname}`,
      look, 1, 0, gear, actor.pid]] });
    capCorpses(game);
    return { id };
  },
});

// a pawn body whose contents can still be handled (fresh or rotten), near the actor
function openBody(game, a, actor) {
  const c = corpseById(game, a.id);
  if (!c) return [null, 'O corpo não existe mais'];
  if (!c.store) return [null, 'Não há nada aqui'];
  if (stageOf(game, c) !== 'fresh' && stageOf(game, c) !== 'rotten') return [null, 'Restou só a ossada'];
  if (!near(actor.ent, c)) return [null, 'Chegue mais perto'];
  return [c, null];
}

defineIntent('corpse.put', {
  doc: 'Put items into a body (already removed from the actor; refunded on reject, leftovers given back).',
  args: { id: 'corpseId', item: 'itemId', qty: 'int' },
  run(game, a, actor, net) {
    const [c, why] = openBody(game, a, actor);
    if (!c) return why;
    if (typeof a.item !== 'string' || !ITEMS[a.item]) return 'Item desconhecido';
    const qty = Math.max(1, Math.min(9999, num(a.qty, 1) | 0));
    const inv = storeClone(c);
    const left = inv.add(a.item, qty);
    if (left === qty) return 'Não cabe mais nada';
    net.emit('corpse.set', { id: c.id, slots: inv.toJSON(), by: actor.pid, give: left ? { [a.item]: left } : undefined, quiet: 1 });
  },
});

defineIntent('corpse.take', {
  doc: "Take up to qty of the stack in a body's slot (qty = room in the actor's backpack); refused from day 3 (skeleton).",
  args: { id: 'corpseId', slot: 'int', qty: 'int' },
  run(game, a, actor, net) {
    const [c, why] = openBody(game, a, actor);
    if (!c) return why;
    const s = c.store.slots[num(a.slot, -1) | 0];
    if (!s) return 'Vazio';
    const n = Math.min(s.qty, Math.max(0, num(a.qty) | 0));
    if (n <= 0) return 'Mochila cheia';
    const inv = storeClone(c);
    inv.remove(s.id, n);
    net.emit('corpse.set', { id: c.id, slots: inv.toJSON(), by: actor.pid, give: { [s.id]: n } });
  },
});

defineIntent('store.sort', {
  doc: 'Sort a shared container (kind chest | corpse) by mode: alpha (Alfabético), type (Tipo: category, then quantity), qty (Quantidade). Stacks merge.',
  args: { kind: "'chest'|'corpse'", id: 'structId|corpseId', mode: "'alpha'|'type'|'qty'" },
  run(game, a, actor, net) {
    const mode = SORT_MODES.includes(a.mode) ? a.mode : 'type';
    if (a.kind === 'corpse') {
      const [c, why] = openBody(game, a, actor);
      if (!c) return why;
      net.emit('corpse.set', { id: c.id, slots: sortSlots(c.store.slots, c.store.size, mode), quiet: 1 });
      return;
    }
    const o = game.world.objById.get(a.id);
    if (!o || !o.building || o.removed || !o.store || o.blueprint) return 'Baú não existe mais';
    if (actor.ent && Math.hypot(actor.ent.x - o.x, actor.ent.y - o.y) > REACH + 1) return 'Chegue mais perto';
    net.emit('chest.set', { id: o.id, slots: sortSlots(o.store.slots, o.store.size, mode), quiet: 1 });
  },
});

defineIntent('corpse.butcher', {
  doc: '"Coletar" (end of the local work): animal body on its first day, not butchered yet → yields by the host. blade = the cutting tool the actor used.',
  args: { id: 'corpseId', blade: "'knife'|'sword'|'axe'|0", tier: 'int 0..4' },
  run(game, a, actor, net) {
    const c = corpseById(game, a.id);
    if (!c) return 'O corpo não existe mais';
    if (c.of === 'pawn') return 'Não dá para coletar isto';
    if (c.butchered) return 'Já foi coletado';
    const st = stageOf(game, c);
    if (st === 'rotten') return 'Está podre demais';
    if (st !== 'fresh') return 'Restou só a ossada';
    if (!near(actor.ent, c)) return 'Chegue mais perto';
    const blade = a.blade === 'knife' || a.blade === 'sword' || a.blade === 'axe' ? a.blade : 0;
    const tier = Math.max(0, Math.min(4, num(a.tier) | 0));
    const give = butcherYield(net, c.of, blade, tier);
    const sp = SPECIES[c.of];
    net.emit('corpse.butcher', {
      id: c.id, by: actor.pid, give, xp: Math.max(1, Math.round((sp?.xp || 1) * 2)),
      tip: blade ? undefined : ['butcher', 'Sem lâmina: pouca carne e nada de couro. Uma faca ajuda.', 2],
    });
  },
});

defineIntent('corpse.bones', {
  doc: '"Remover ossada" (end of the local work): a body in its skeleton stage (days 3–5) is removed; the actor gets the bones.',
  args: { id: 'corpseId' },
  run(game, a, actor, net) {
    const c = corpseById(game, a.id);
    if (!c) return 'Já foi removida';
    if (stageOf(game, c) !== 'skeleton') return 'Ainda não virou ossada';
    if (!near(actor.ent, c)) return 'Chegue mais perto';
    const n = bonesOf(c);
    net.emit('corpse.remove', { ids: [c.id], by: actor.pid, give: n ? { bone: n } : undefined, xp: 1, fx: 'bones',
      toast: n ? undefined : 'Restos removidos', toastKind: 'info' });
  },
});

// stable pseudo-random phase from an id (art side / lying direction)
export function phase(id) {
  let h = 7;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 6283) / 1000);
}
