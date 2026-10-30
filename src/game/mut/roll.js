// Authority-side randomness and allocation helpers. Everything rolled here ends up in op args, so every
// peer applies the same outcome. Only the authority may call these (net.roll / net.newId assert it).

import { ITEM_ALIASES } from '../content/items.js';

export const r3 = (v) => Math.round(v * 1000) / 1000;
export const ri = (net, a, b) => a + Math.floor(net.roll() * (b - a + 1));
export const chance = (net, p) => net.roll() < p;

// one ground-item row: [id, item, qty, x, y, vx, vy, vlift, t]  (t = -2: freshly dropped by a player)
export function lootRow(net, x, y, item, qty = 1, spread = 1, t = 0) {
  item = ITEM_ALIASES[item] || item;
  const a = net.roll() * Math.PI * 2;
  const v = (0.8 + net.roll() * 1.2) * spread;
  return [net.newId('L'), item, qty, r3(x), r3(y), r3(Math.cos(a) * v), r3(Math.sin(a) * v * 0.6), r3(2.2 + net.roll()), t];
}

// n separate units (the classic "pop" of a harvest)
export function lootRows(net, rows, x, y, item, n, spread = 1) {
  for (let k = 0; k < n; k++) rows.push(lootRow(net, x, y, item, 1, spread));
  return rows;
}
// the same n items in a few piles (at most `piles` rows): big yields don't scatter dozens of loose items
export function lootPiles(net, rows, x, y, item, n, spread = 1, piles = 3) {
  const k = Math.max(1, Math.min(piles, n));
  for (let i = 0; i < k; i++) { const q = Math.floor(n / k) + (i < n % k ? 1 : 0); if (q > 0) rows.push(lootRow(net, x, y, item, q, spread)); }
  return rows;
}

// visual variant / scale / flip of a new flora object (same distributions as the world generator)
export function floraLook(net, kind) {
  const R = () => net.roll();
  const f = R() < 0.5 ? -1 : 1;
  if (kind.startsWith('tree_')) return { v: Math.floor(R() * 16), s: r3(0.85 + R() * 0.35), f };
  if (kind === 'bush' || kind === 'berrybush' || kind === 'herbbush') return { v: Math.floor(R() * 1000), s: r3(0.75 + R() * 0.45), f };
  if (kind === 'boulder') return { v: Math.floor(R() * 7919), s: r3(0.6 + R() * 0.5), f };
  if (kind === 'pebble') return { v: Math.floor(R() * 4), s: r3(0.8 + R() * 0.4), f };
  if (kind === 'stick' || kind === 'fibergrass') return { v: Math.floor(R() * 3), s: r3(0.85 + R() * 0.3), f };
  return { v: 0, s: r3(0.9 + R() * 0.2), f };
}
