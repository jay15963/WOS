// Ground items (shared). Rows are rolled by the authority (mut/roll.js lootRow) and applied by every peer
// with the exact same values: row = [id, item, qty, x, y, vx, vy, vlift, t]. The pop arc and the magnet
// toward the local player are cosmetic (loot.js); pickup and expiry go through the host.

import { defineIntent, defineOp } from '../../net/registry.js';
import { ITEMS, ITEM_ALIASES } from '../content/items.js';
import { lootRow } from './roll.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const phaseOf = (id) => { let h = 7; const s = String(id); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 600) / 100; };

export function lootById(game, id) {
  for (const it of game.loot) if (it.id === id) return it;
  return null;
}

// applier helper (also used by other ops' `drops`): push rows with their exact values
export function addLootRows(game, rows) {
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const [id, item, qty, x, y, vx = 0, vy = 0, vlift = 0, t = 0] = r;
    if (!ITEMS[item] || lootById(game, id)) continue;
    game.loot.push({ id, item, qty: qty | 0 || 1, x, y, vx, vy, lift: vlift ? 0.3 : 0, vlift, t, ph: phaseOf(id) });
  }
}

export function removeLoot(game, id) {
  const L = game.loot;
  for (let i = L.length - 1; i >= 0; i--) if (L[i].id === id) { L.splice(i, 1); return true; }
  return false;
}

// Drop items on the ground from anywhere. Authority: emits loot.add now. Guest: asks the host
// (loot.drop); the items must already be out of the inventory — they come back if the host refuses.
export function dropLoot(game, x, y, item, qty = 1, spread = 1, opts = {}) {
  const net = game.net;
  item = ITEM_ALIASES[item] || item;
  if (net.auth) {
    const row = lootRow(net, x, y, item, qty, spread, opts.hold ? -2 : 0);
    net.emit('loot.add', { list: [row] });
    return row[0];
  }
  net.request('loot.drop', { item, qty, x, y, spread, hold: opts.hold ? 1 : 0 }, { refund: { [item]: qty } });
  return null;
}

defineOp('loot.add', {
  doc: 'Ground items appear with exact rolled values (id, item, qty, position, pop velocity, age).',
  args: { list: '[[id, item, qty, x, y, vx, vy, vlift, t]]' },
  apply(game, a) { addLootRows(game, a.list); },
});

defineOp('loot.take', {
  doc: 'A player picked up qty of a ground item (the host arbitrated who got it); items go to `by` via give.',
  args: { id: 'lootId', qty: 'int', by: 'pid', give: '{item: qty}' },
  apply(game, a, ctx) {
    const it = lootById(game, a.id);
    if (!it) return;
    it.qty -= a.qty | 0;
    if (it.qty <= 0) removeLoot(game, a.id);
    if (ctx.mine) game.audio?.play('pickup', { x: it.x, y: it.y });
  },
});

defineOp('loot.expire', {
  doc: 'Old ground items vanish (host clock, 300 s).',
  args: { ids: '[lootId]' },
  apply(game, a) { for (const id of a.ids || []) removeLoot(game, id); },
});

defineIntent('loot.take', {
  doc: 'Pick up (part of) a ground item. First request wins; a second one for the same item is rejected.',
  args: { id: 'lootId', qty: 'int ≥ 1 (room in the backpack)' },
  run(game, a, actor, net) {
    const it = lootById(game, a.id);
    if (!it) return 'Já foi coletado';
    const qty = Math.min(it.qty, Math.max(0, num(a.qty) | 0));
    if (qty <= 0) return 'Mochila cheia';
    if (it.t < 0.45 && !actor.local) return 'Ainda caindo';
    const e = actor.ent;
    if (e && Math.hypot(e.x - it.x, e.y - it.y) > 4.5) return 'Longe demais';
    net.emit('loot.take', { id: it.id, qty, by: actor.pid, give: { [it.item]: qty } });
  },
});

defineIntent('loot.drop', {
  doc: 'Put items from the actor\'s inventory on the ground (already removed; refunded on reject). split = one row per unit.',
  args: { item: 'itemId', qty: 'int', x: 'number', y: 'number', spread: 'number?', hold: '0|1 (t = -2: not re-picked at once)', split: '0|1' },
  run(game, a, actor, net) {
    const item = ITEM_ALIASES[a.item] || a.item;
    if (typeof item !== 'string' || !ITEMS[item]) return 'Item desconhecido';
    const qty = Math.max(1, Math.min(9999, num(a.qty, 1) | 0));
    const W = game.world;
    const x = Math.max(0, Math.min(W.W, num(a.x, actor.ent?.x || 0))), y = Math.max(0, Math.min(W.H, num(a.y, actor.ent?.y || 0)));
    const spread = Math.max(0, Math.min(2, num(a.spread, 0.3)));
    const t = a.hold ? -2 : 0;
    const list = [];
    if (a.split) for (let k = 0; k < qty; k++) list.push(lootRow(net, x, y, item, 1, spread, t));
    else list.push(lootRow(net, x, y, item, qty, spread, t));
    net.emit('loot.add', { list });
  },
});
