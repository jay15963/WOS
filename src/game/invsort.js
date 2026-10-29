// Inventory / chest sorting (pure): merges partial stacks and orders them.
//   name — A→Z by pt-BR name · type — category (tools, weapons, off-hand, clothing, food, materials,
//   seeds, ammo, others), then quantity desc, then name · qty — quantity desc, then name.
// The player's backpack is sorted locally (owner state); chests and bodies are sorted by the host (intent store.sort,
// src/game/mut/structures.js) and the resulting slot list travels in the chest.set / corpse.set op.

import { ITEMS } from './data.js';

export const SORT_MODES = ['name', 'type', 'qty'];
export const SORT_PT = { name: 'A→Z', type: 'Tipo', qty: 'Quantidade' };
const CAT_ORDER = ['tool', 'weapon', 'offhand', 'armor', 'food', 'material', 'seed', 'ammo'];

// slots: Inventory.slots ({id, qty} | null) → Inventory.toJSON() layout ([id, qty] | 0) of length `size`
export function sortedSlots(slots, size, mode) {
  const tot = new Map();
  for (const s of slots) if (s) tot.set(s.id, (tot.get(s.id) || 0) + s.qty);
  const ids = [...tot.keys()];
  const name = (id) => ITEMS[id]?.name || id;
  const byName = (a, b) => name(a).localeCompare(name(b), 'pt-BR') || (a < b ? -1 : a > b ? 1 : 0);
  const cat = (id) => { const i = CAT_ORDER.indexOf(ITEMS[id]?.cat); return i < 0 ? CAT_ORDER.length : i; };
  if (mode === 'name') ids.sort(byName);
  else if (mode === 'qty') ids.sort((a, b) => tot.get(b) - tot.get(a) || byName(a, b));
  else ids.sort((a, b) => cat(a) - cat(b) || tot.get(b) - tot.get(a) || byName(a, b));
  const out = [];
  for (const id of ids) {
    let n = tot.get(id);
    const max = ITEMS[id]?.stack || 99;
    while (n > 0 && out.length < size) { const k = Math.min(max, n); out.push([id, k]); n -= k; }
  }
  while (out.length < size) out.push(0);
  return out;
}

// sorts the local player's backpack in place (owner-side state)
export function sortBackpack(game, mode) {
  const inv = game.player.inv;
  inv.load(sortedSlots(inv.slots, inv.size, mode));
  inv.version++;
  game.events.emit('inventory', {});
}
