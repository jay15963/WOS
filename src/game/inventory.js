// Slot-based inventory (pure data).

import { ITEMS, ITEM_ALIASES } from './data.js';

export class Inventory {
  constructor(size = 20) {
    this.size = size;
    this.slots = new Array(size).fill(null); // { id, qty } | null
    this.version = 0; // bumps on every change (cheap dirty check for UI)
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.qty;
    return n;
  }

  // returns leftover that did not fit
  add(id, qty = 1) {
    const max = ITEMS[id]?.stack || 99;
    let left = qty;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.qty < max) { const k = Math.min(max - s.qty, left); s.qty += k; left -= k; }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) { const k = Math.min(max, left); this.slots[i] = { id, qty: k }; left -= k; }
    }
    if (left !== qty) this.version++;
    return left;
  }

  // how many of `id` could still fit
  room(id) {
    const max = ITEMS[id]?.stack || 99;
    let n = 0;
    for (const s of this.slots) n += !s ? max : s.id === id ? max - s.qty : 0;
    return n;
  }

  // could all of { id: qty } fit at once (ignoring what `freed` would release)?
  fits(items, freed = null) {
    const free = this.slots.filter((s) => !s).length + (freed ? freed : 0);
    let need = 0;
    for (const id in items) {
      const max = ITEMS[id]?.stack || 99;
      let left = items[id];
      for (const s of this.slots) if (s && s.id === id) left -= max - s.qty;
      if (left > 0) need += Math.ceil(left / max);
    }
    return need <= free;
  }

  remove(id, qty = 1) {
    if (this.count(id) < qty) return false;
    let left = qty;
    for (let i = this.size - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(s.qty, left); s.qty -= k; left -= k; if (!s.qty) this.slots[i] = null; }
    }
    this.version++;
    return true;
  }

  has(cost) {
    for (const id in cost) if (this.count(id) < cost[id]) return false;
    return true;
  }

  pay(cost) {
    if (!this.has(cost)) return false;
    for (const id in cost) this.remove(id, cost[id]);
    return true;
  }

  // returns what did not fit as { id: qty }
  addAll(items) {
    const left = {};
    for (const id in items) { const l = this.add(id, items[id]); if (l) left[id] = l; }
    return left;
  }

  takeSlot(i) {
    const s = this.slots[i];
    this.slots[i] = null;
    if (s) this.version++;
    return s;
  }

  used() { let n = 0; for (const s of this.slots) if (s) n++; return n; }

  toJSON() { return this.slots.map((s) => (s ? [s.id, s.qty] : 0)); }

  load(arr) {
    this.slots.fill(null);
    if (Array.isArray(arr)) arr.forEach((s, i) => {
      if (!s) return;
      const id = ITEM_ALIASES[s[0]] || s[0];
      if (!ITEMS[id]) return;
      if (i < this.size && !this.slots[i]) this.slots[i] = { id, qty: Math.max(1, s[1] | 0) };
      else this.add(id, Math.max(1, s[1] | 0));
    });
    this.version++;
  }
}
