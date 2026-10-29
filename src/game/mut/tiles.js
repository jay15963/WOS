// Rock tiles: mining progress and mined tiles (world.rock / ground / textures / wall masks).
// Ops: rock.prog · tile.mine. Intent: rock.hit. Designations (game.mining.marks) stay per player.

import { defineIntent, defineOp } from '../../net/registry.js';
import { ORE_ITEM as ORE_ITEM_DB, ORE_NAME_PT } from '../content/items.js';
import * as WG from '../../world/worldgen.js';
import { updateMasksAround } from '../autotile.js';
import { addLootRows } from './loot.js';
import { lootRows, ri } from './roll.js';

const ORE_ITEM = WG.ORE_ITEM || ORE_ITEM_DB; // world ore code -> item id (CONTENT §7)
export const ROCK_COL = [[0.6, 0.58, 0.55], [0.62, 0.6, 0.58], [0.76, 0.72, 0.62], [0.42, 0.44, 0.48], [0.86, 0.85, 0.82]];
export const ORE_COL = [null, [0.95, 0.55, 0.25], [0.6, 0.45, 0.38], [0.15, 0.15, 0.16], [1, 0.85, 0.3], [0.35, 0.85, 0.55]];
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// cosmetic hit on a rock tile seen from (fx, fy)
export function rockHitFx(game, tx, ty, fx, fy) {
  const w = game.world, i = w.idx(tx, ty), J = game.juice;
  const col = ROCK_COL[w.rockType[i]] || ROCK_COL[0];
  const cx = Math.max(tx, Math.min(tx + 1, fx)), cy = Math.max(ty, Math.min(ty + 1, fy));
  J.chips(cx, cy, col, 7, 0.5);
  if (w.ore[i]) J.chips(cx, cy, ORE_COL[w.ore[i]] || [1, 0.75, 0.3], 3, 0.5);
  J.puff(cx, cy, 2, col, 0.4);
  game.audio?.play('mine', { x: cx, y: cy });
}

// helper (appliers / snapshot): turn a rock tile into rough stone floor + bookkeeping
export function mineTile(game, tx, ty) {
  const w = game.world, i = w.idx(tx, ty);
  if (!w.mineRock(tx, ty)) return false;
  if (!game.minedSet.has(i)) { game.minedTiles.push(i); game.minedSet.add(i); }
  game.rockHits.delete(i);
  const M = game.mining;
  if (M) { M.marks.delete(i); M.blocked.delete(i); M.v++; }
  updateMasksAround(game, tx, ty);
  game.events.emit('tile', { tx, ty });
  return true;
}

defineOp('rock.prog', {
  doc: 'Mining progress on a rock tile.',
  args: { i: 'tileIdx', p: '0..1', by: 'pid', x: 'miner x', y: 'miner y' },
  apply(game, a, ctx) {
    game.rockHits.set(a.i, a.p);
    if (!ctx.mine) { const W = game.world.W; rockHitFx(game, a.i % W, (a.i / W) | 0, a.x ?? 0, a.y ?? 0); }
  },
});

defineOp('tile.mine', {
  doc: 'A rock tile is mined out: rough stone floor, ore/stone drops, neighbouring wall masks updated.',
  args: { tx: 'int', ty: 'int', drops: 'lootRows', by: 'pid', xp: 'number', toast: 'string?' },
  apply(game, a, ctx) {
    const w = game.world;
    if (!w.inBounds(a.tx, a.ty)) return;
    const i = w.idx(a.tx, a.ty);
    const col = ROCK_COL[w.rockType[i]] || ROCK_COL[0];
    if (!mineTile(game, a.tx, a.ty)) return;
    game.juice.puff(a.tx + 0.5, a.ty + 0.6, 12, col, 1.0);
    if (ctx.mine) game.juice.shake(0.2);
    addLootRows(game, a.drops);
  },
});

defineIntent('rock.hit', {
  doc: 'A pickaxe hit on a rock tile (inc = 1/need of the actor\'s pickaxe; the actor checked the ore tier) or the final hit.',
  args: { tx: 'int', ty: 'int', inc: 'number?', final: 'bool?' },
  run(game, a, actor, net) {
    const w = game.world, tx = num(a.tx) | 0, ty = num(a.ty) | 0;
    if (!w.inBounds(tx, ty)) return 'Fora do mapa';
    const i = w.idx(tx, ty);
    if (w.rock[i] !== 1) return 'Já foi minerado';
    const e = actor.ent;
    if (e && Math.hypot(e.x - tx - 0.5, e.y - ty - 0.5) > 4.5) return 'Longe demais';
    const prog = game.rockHits.get(i) || 0;
    if (!a.final) {
      const inc = Math.max(0, Math.min(1, num(a.inc)));
      net.emit('rock.prog', { i, p: +Math.min(0.999, prog + inc).toFixed(3), by: actor.pid, x: e ? +e.x.toFixed(2) : 0, y: e ? +e.y.toFixed(2) : 0 });
      return;
    }
    if (prog < 0.85) return 'Ainda não terminou';
    const ore = w.ore[i];
    const cx = tx + 0.5, cy = ty + 0.6;
    const rows = [];
    lootRows(net, rows, cx, cy, 'stone', ri(net, 1, 2) + (net.roll() < 0.25 ? 1 : 0));
    const oreItem = ORE_ITEM[ore];
    if (oreItem) lootRows(net, rows, cx, cy, oreItem, ore >= 4 ? 1 : ri(net, 1, 2));
    net.emit('tile.mine', { tx, ty, drops: rows, by: actor.pid, xp: ore ? 8 : 4, tip: oreItem ? ['ore' + ore, `Veio de ${ORE_NAME_PT[ore]}!`, 1, 'good'] : undefined });
  },
});
