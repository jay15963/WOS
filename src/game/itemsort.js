// Container sorting (pure): Alfabético (name), Tipo (category, then quantity desc), Quantidade (quantity desc).
// Stacks of the same item merge (up to the item's stack size) and gaps close. Used by the transfer window for
// the backpack (local) and, through the host (intent store.sort), for chests and bodies.

import { ITEMS } from './data.js';

export const SORT_MODES = ['alpha', 'type', 'qty'];
export const SORT_PT = { alpha: 'Alfabético', type: 'Tipo', qty: 'Quantidade' };
// category order for "Tipo"
const CAT_ORDER = ['weapon', 'tool', 'offhand', 'armor', 'ammo', 'food', 'seed', 'material'];
const catRank = (id) => { const i = CAT_ORDER.indexOf(ITEMS[id]?.cat); return i < 0 ? CAT_ORDER.length : i; };
const nameOf = (id) => ITEMS[id]?.name || id;

// slots: [{id, qty} | [id, qty] | null | 0] → Inventory.toJSON()-style list of `size` entries
export function sortSlots(slots, size, mode = 'type') {
  const tot = new Map();
  for (const s of slots || []) {
    if (!s) continue;
    const id = Array.isArray(s) ? s[0] : s.id, q = (Array.isArray(s) ? s[1] : s.qty) | 0;
    if (!ITEMS[id] || q <= 0) continue;
    tot.set(id, (tot.get(id) || 0) + q);
  }
  const stacks = [];
  for (const [id, n] of tot) {
    const max = ITEMS[id].stack || 99;
    for (let left = n; left > 0; left -= max) stacks.push([id, Math.min(max, left)]);
  }
  const byName = (a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), 'pt-BR');
  if (mode === 'alpha') stacks.sort((a, b) => byName(a, b) || b[1] - a[1]);
  else if (mode === 'qty') stacks.sort((a, b) => b[1] - a[1] || byName(a, b));
  else stacks.sort((a, b) => catRank(a[0]) - catRank(b[0]) || b[1] - a[1] || byName(a, b));
  if (stacks.length > size) return (slots || []).map((s) => (!s ? 0 : Array.isArray(s) ? s : [s.id, s.qty])); // never lose items
  const out = stacks;
  while (out.length < size) out.push(0);
  return out;
}

// sort the local player's own backpack (owner state, no host round trip)
export function sortInventory(inv, mode) {
  inv.load(sortSlots(inv.slots, inv.size, mode));
}
