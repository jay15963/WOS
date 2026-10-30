// Work sites (owner's request): blueprints ("plantas", placed for free) that sit close together form one site — two
// plans belong together when their footprints are at most LINK tiles apart (any story: a house and its upper floor
// are one site). For a site: the materials still needed to finish it — the cost of every plan whose work has not
// started (o.paid: its materials were already taken) — against what the local player carries ("12/45 madeira").
// Finished plans stop being blueprints, started ones are paid: both drop out of the sum by themselves.
// Local only (a view of the shared structures): recomputed when the structures change (game.build.v).

import { BUILDINGS } from './data.js';

export const LINK = 3;     // tiles between two plans of the same site
export const NEAR = 2.6;   // tiles: the player is at a site (its button shows) this close to one of its plans

const isPlan = (o) => o.blueprint && !o.removed && !o.moveOf; // (move plans carry no new materials)

// clusters of the current blueprints (cached per structures version)
export function sites(game) {
  const C = game._sites || (game._sites = { v: -1, list: [] });
  if (C.v === game.build.v) return C.list;
  C.v = game.build.v;
  const P = game.build.structures.filter(isPlan);
  // union-find, pairs found through a coarse grid (cells of LINK + 1 tiles)
  const par = P.map((_, i) => i), find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const cell = LINK + 1, grid = new Map();
  P.forEach((o, i) => {
    const k = Math.floor(o.tx / cell) + ',' + Math.floor(o.ty / cell);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  });
  const gap = (a, b) => Math.max(
    Math.max(0, a.tx - (b.tx + (b.fw || 1) - 1), b.tx - (a.tx + (a.fw || 1) - 1)),
    Math.max(0, a.ty - (b.ty + (b.fh || 1) - 1), b.ty - (a.ty + (a.fh || 1) - 1)));
  P.forEach((a, i) => {
    const cx = Math.floor(a.tx / cell), cy = Math.floor(a.ty / cell);
    for (let dx = -1; dx <= 1 + Math.ceil((a.fw || 1) / cell); dx++) for (let dy = -1; dy <= 1 + Math.ceil((a.fh || 1) / cell); dy++) {
      for (const j of grid.get((cx + dx) + ',' + (cy + dy)) || []) if (j > i && gap(a, P[j]) <= LINK) par[find(j)] = find(i);
    }
  });
  const by = new Map();
  P.forEach((o, i) => { const r = find(i); let s = by.get(r); if (!s) by.set(r, (s = [])); s.push(o); });
  C.list = [...by.values()].map((plans) => {
    const need = {}, types = {};
    let paid = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const o of plans) {
      types[o.type] = (types[o.type] || 0) + 1;
      x0 = Math.min(x0, o.tx); y0 = Math.min(y0, o.ty); x1 = Math.max(x1, o.tx + (o.fw || 1)); y1 = Math.max(y1, o.ty + (o.fh || 1));
      if (o.paid) { paid++; continue; }
      for (const [k, n] of Object.entries(BUILDINGS[o.type]?.cost || {})) need[k] = (need[k] || 0) + n;
    }
    return { plans, need, types, paid, x0, y0, x1, y1 };
  });
  return C.list;
}

// distance from (x, y) to a plan's footprint
const rectD = (o, x, y) => Math.hypot(Math.max(o.tx - x, 0, x - (o.tx + (o.fw || 1))), Math.max(o.ty - y, 0, y - (o.ty + (o.fh || 1))));

// the site the player stands at (null: none within NEAR)
export function siteNear(game, x, y, r = NEAR) {
  let best = null, bd = r;
  for (const s of sites(game)) {
    if (x < s.x0 - r - 1 || x > s.x1 + r + 1 || y < s.y0 - r - 1 || y > s.y1 + r + 1) continue;
    for (const o of s.plans) { const d = rectD(o, x, y); if (d <= bd) { bd = d; best = s; } }
  }
  return best;
}

// [{ id, need, have }] for a site and an inventory (sorted: what is missing first, then by amount)
export function siteMaterials(site, inv) {
  return Object.entries(site.need).map(([id, need]) => ({ id, need, have: inv.count(id) }))
    .sort((a, b) => (b.have < b.need) - (a.have < a.need) || b.need - a.need);
}
