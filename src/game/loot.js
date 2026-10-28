// Ground items: pop out of kills/harvests, magnet to the player, auto pick-up.
// Drawn in the decor batch (under characters) with a little bob.

import { ITEMS } from './data.js';
import { collides } from './physics.js';

let nextId = 1;

export function dropLoot(game, x, y, item, qty = 1, spread = 1) {
  const a = Math.random() * Math.PI * 2;
  const v = (0.8 + Math.random() * 1.2) * spread;
  const it = { id: nextId++, item, qty, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, lift: 0.3, vlift: 2.2 + Math.random(), t: 0, ph: Math.random() * 6 };
  game.loot.push(it);
  return it;
}

export function pickup(game, it) {
  const p = game.player;
  const left = p.inv.add(it.item, it.qty);
  const got = it.qty - left;
  if (got > 0) {
    game.events.emit('loot', { item: it.item, qty: got });
    game.events.emit('inventory', {});
    game.audio?.play('pickup', { x: it.x, y: it.y });
  }
  it.qty = left;
  if (left > 0) {
    if (!it.fullMsgT || game.time > it.fullMsgT) { game.events.emit('error', { text: 'Mochila cheia' }); it.fullMsgT = game.time + 4; }
    return false;
  }
  return true;
}

export function lootSystem() {
  let fullT = 0;
  return {
    update(game, dt) {
      const p = game.player, w = game.world;
      const L = game.loot;
      fullT -= dt;
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
        if (it.t > 300) { L.splice(i, 1); continue; }
        if (p.dead || it.t < 0.45) continue;
        const dx = p.x - it.x, dy = p.y - it.y, d = Math.hypot(dx, dy);
        const full = p.inv.room(it.item) <= 0;
        if (d < 2.3 && !full) {
          const k = Math.min(1, dt * (5 + (2.3 - d) * 8));
          it.x += dx * k; it.y += dy * k;
          it.lift = Math.max(it.lift, 0.12 * (2.3 - d));
        }
        if (d < 0.45 && (!full || fullT <= 0)) {
          if (full) fullT = 4;
          if (pickup(game, it)) L.splice(i, 1);
        }
      }
    },
    render(game, B, v, env) {
      const A = game.A, t = game.time;
      const blob = A.get('fx_blob');
      const glow = A.has('fx_soft') ? A.get('fx_soft') : null;
      for (const it of game.loot) {
        if (it.x < v.x0 - 1 || it.x > v.x1 + 1 || it.y < v.y0 - 1 || it.y > v.y1 + 1) continue;
        const def = ITEMS[it.item];
        const name = def && A.has(def.sprite) ? def.sprite : 'item_stone';
        if (!A.has(name)) continue;
        const s = A.get(name);
        const bob = it.lift + (it.lift === 0 ? 0.04 + Math.sin(t * 3 + it.ph) * 0.03 : 0);
        B.blob.add(blob, it.x, it.y, 0.35, 0.3, 1, 1, 1, 0.55);
        B.decor.add(s, it.x, it.y, 0.9, 0.9, 1, 1, 1, 1, 0, 0, 0, 1, 0, bob);
        if (glow && env.night > 0.2) B.emissive.add(glow, it.x, it.y, 0.9, 0.9, 1, 0.85, 0.5, 0.25 * env.night * (0.7 + 0.3 * Math.sin(t * 4 + it.ph)), 0, 0, 0, 1, 0, bob + 0.12);
      }
    },
  };
}

