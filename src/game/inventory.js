// Slot-based inventory (pure data).

import { ITEMS } from './data.js';

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

  takeSlot(i) {
    const s = this.slots[i];
    this.slots[i] = null;
    if (s) this.version++;
    return s;
  }

  toJSON() { return this.slots.map((s) => (s ? [s.id, s.qty] : 0)); }

  load(arr) {
    this.slots.fill(null);
    if (Array.isArray(arr)) arr.forEach((s, i) => { if (s && i < this.size && ITEMS[s[0]]) this.slots[i] = { id: s[0], qty: s[1] | 0 }; });
    this.version++;
  }
}
