// Ground items: pop out of kills/harvests (shared state: mut/loot.js ops), magnet to the local player
// (cosmetic), pick-up through the host (intent loot.take: first request wins, no duplication).
// Drawn in the decor batch (under characters) with a little bob.
// rollKillLoot(): kill loot helper (authority) — leather needs a skinning tool (knife).

import { ITEMS } from './data.js';
import { collides } from './physics.js';
import { bestTool } from './equipment.js';
import { dropLoot } from './mut/loot.js';
import { lootRows, ri } from './mut/roll.js';

export { dropLoot };

// Kill loot from a table [[item, min, max, chance], ...] at (x, y), rolled by the authority.
// Leather only with a knife of the killer `p` (better knife: +1 leather on copper+); returns { lostLeather }.
export function rollKillLoot(game, x, y, table, p = game.player) {
  const net = game.net;
  const knife = bestTool(p, 'skin');
  let lostLeather = false;
  const rows = [];
  for (const [item, a, b, ch] of table || []) {
    if (net.roll() > ch) continue;
    let n = ri(net, a, b);
    if (item === 'leather') {
      if (!knife) { lostLeather = true; continue; }
      if (knife.tier >= 2 && net.roll() < 0.5) n++;
    }
    lootRows(net, rows, x, y, item, n);
  }
  if (rows.length) net.emit('loot.add', { list: rows });
  if (lostLeather) {
    const h = game.ctl?.hinted;
    if (h && !h.skin) { h.skin = true; game.events.emit('toast', { text: 'Sem faca você não tira o couro. Faça uma faca primitiva.', kind: 'warn' }); }
  }
  return { lostLeather };
}

// local pick-up attempt (authority: immediate; guest: one request at a time per item)
function tryPickup(game, it) {
  const p = game.player;
  const room = p.inv.room(it.item);
  if (room <= 0) return false;
  if (it._rq && game.time - it._rq < 1.5) return true;
  it._rq = game.time;
  game.net.request('loot.take', { id: it.id, qty: Math.min(room, it.qty) });
  return true;
}
// sprite for a ground item: item_<id>, else a look-alike that exists
const FB = { pebble: ['item_stone', 0.6], stick: ['item_wood', 0.7], copper_ore: ['item_ore', 1], iron_ore: ['item_ore', 1], gold_ore: ['item_ore', 1],
  jade: ['item_ore', 0.8], coal: ['item_stone', 0.8], stone_block: ['item_stone', 1], copper_bar: ['item_ore', 0.9], iron_bar: ['item_ore', 0.9],
  steel_bar: ['item_ore', 0.9], gold_bar: ['item_ore', 0.9], potato: ['item_berries', 0.9], baked_potato: ['item_cooked', 0.8], corn: ['item_berries', 0.9],
  roast_corn: ['item_cooked', 0.8], stew: ['item_cooked', 0.9], cotton: ['item_fiber', 0.9], cloth: ['item_leather', 0.8], rope: ['item_fiber', 0.9],
  herb: ['item_fiber', 0.8], arrow: ['item_wood', 0.6] };
function itemSprite(A, id) {
  const def = ITEMS[id];
  if (def && A.has(def.sprite)) return [def.sprite, 1];
  const fb = FB[id];
  if (fb && A.has(fb[0])) return fb;
  const cat = def?.cat;
  if (cat === 'tool' || cat === 'weapon') return [def.weapon?.type === 'pickaxe' ? 'tool_pickaxe' : def.weapon?.type === 'axe' ? 'weapon_axe' : 'weapon_sword', 0.7];
  if (cat === 'seed') return ['item_berries', 0.6];
  if (cat === 'armor' || cat === 'offhand') return ['item_leather', 0.9];
  return ['item_stone', 0.8];
}

export function lootSystem() {
  let fullT = 0;
  const expired = [];
  return {
    sync: 'all', // pop arcs / magnet (cosmetic) + local pick-up requests; expiry only on the authority
    update(game, dt) {
      const p = game.player, w = game.world;
      const L = game.loot;
      fullT -= dt;
      expired.length = 0;
      for (let i = L.length - 1; i >= 0; i--) {
        const it = L[i];
        it.t += dt;
        // pop arc
        if (it.vlift || it.lift > 0) {
          it.vlift -= 9 * dt;
          it.lift += it.vlift * dt;
          if (it.lift <= 0) { it.lift = 0; it.vlift = Math.abs(it.vlift) > 1.2 ? -it.vlift * 0.35 : 0; it.vx *= 0.5; it.vy *= 0.5; }
          const nx = it.x + it.vx * dt, ny = it.y + it.vy * dt;
          if (!collides(w, nx, ny, 0.08)) { it.x = nx; it.y = ny; } else { it.vx = it.vy = 0; }
          it.vx *= Math.exp(-dt * 2); it.vy *= Math.exp(-dt * 2);
        }
        if (it.t > 300) { if (game.net.auth) expired.push(it.id); continue; }
        if (p.dead || it.t < 0.45) continue;
        const dx = p.x - it.x, dy = p.y - it.y, d = Math.hypot(dx, dy);
        const full = p.inv.room(it.item) <= 0;
        if (d < 2.3 && !full) {
          const k = Math.min(1, dt * (5 + (2.3 - d) * 8));
          it.x += dx * k; it.y += dy * k;
          it.lift = Math.max(it.lift, 0.12 * (2.3 - d));
        }
        if (d < 0.45) {
          if (!full) tryPickup(game, it);
          else if (fullT <= 0) {
            fullT = 4;
            if (!it.fullMsgT || game.time > it.fullMsgT) { game.events.emit('error', { text: 'Mochila cheia' }); it.fullMsgT = game.time + 4; }
          }
        }
      }
      if (expired.length) game.net.emit('loot.expire', { ids: expired.slice() });
    },
    render(game, B, v, env) {
      const A = game.A, t = game.time;
      const blob = A.get('fx_blob');
      const glow = A.has('fx_soft') ? A.get('fx_soft') : null;
      for (const it of game.loot) {
        if (it.x < v.x0 - 1 || it.x > v.x1 + 1 || it.y < v.y0 - 1 || it.y > v.y1 + 1) continue;
        const [name, sc] = itemSprite(A, it.item);
        if (!A.has(name)) continue;
        const s = A.get(name);
        const bob = it.lift + (it.lift === 0 ? 0.04 + Math.sin(t * 3 + it.ph) * 0.03 : 0);
        B.blob.add(blob, it.x, it.y, 0.35, 0.3, 1, 1, 1, 0.55);
        B.decor.add(s, it.x, it.y, 0.9 * sc, 0.9 * sc, 1, 1, 1, 1, 0, 0, 0, 1, 0, bob);
        if (glow && env.night > 0.2) B.emissive.add(glow, it.x, it.y, 0.9, 0.9, 1, 0.85, 0.5, 0.25 * env.night * (0.7 + 0.3 * Math.sin(t * 4 + it.ph)), 0, 0, 0, 1, 0, bob + 0.12);
      }
    },
  };
}
