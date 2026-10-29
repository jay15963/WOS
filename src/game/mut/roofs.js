// Roofs (agent J): collapse of built roofs that lost their support. Natural (mountain) roofs need no op: they are
// derived from the rock grid inside tile.mine on every peer (world.js _naturalRoof); the host only adds the
// cave-in damage there (mut/tiles.js).
// Op: roof.collapse. The host decides it (game/roofs.js roofSupportSystem → collapseRoofs).

import { defineOp } from '../../net/registry.js';
import { BUILDINGS } from '../data.js';
import { removeStructure, structById, defOf } from './structures.js';
import { addLootRows } from './loot.js';
import { lootRow } from './roll.js';
import { allPlayers, hurtPlayer } from '../players.js';
import { collapseFx, unsupportedRoofs } from '../roofs.js';
import { roofStyleOf } from '../content/roofs.js';

defineOp('roof.collapse', {
  doc: 'Finished roof tiles that lost their support fall down: removed with dust, debris and a sound (toast near the camera); some material lands as loot.',
  args: { ids: '[structId]', drops: 'lootRows?' },
  apply(game, a) {
    const tiles = [];
    for (const id of a.ids || []) {
      const o = structById(game, id);
      if (!o || !BUILDINGS[o.type]?.roof) continue;
      tiles.push([o.tx, o.ty, roofStyleOf(o).base]);
      removeStructure(game, o, { quiet: true });
    }
    addLootRows(game, a.drops);
    if (!tiles.length) return;
    const c = collapseFx(game, tiles, { big: tiles.length > 6 });
    if (c && Math.hypot(game.cam.x - c[0], game.cam.y - c[1]) < 30) game.events.emit('toast', { text: 'O teto desabou!', kind: 'warn' });
  },
});

// host: collapse `list` (roof structures) — a quarter of the material falls as loot, players under it get hurt
export function collapseRoofs(game, list) {
  const net = game.net;
  if (!net.auth || !list.length) return;
  const drops = [];
  for (const o of list) {
    const cost = defOf(o).cost || {};
    for (const k in cost) if (net.roll() < 0.25 * cost[k]) drops.push(lootRow(net, o.tx + 0.5, o.ty + 0.6, k, 1, 0.6));
  }
  net.emit('roof.collapse', { ids: list.map((o) => o.id), drops: drops.length ? drops.slice(0, 40) : undefined });
  hurtUnder(game, list.map((o) => [o.tx, o.ty]), 8);
}

// host: a little damage to players standing on the given tiles (falling roof / rocks)
export function hurtUnder(game, tiles, amount) {
  const set = new Set(tiles.map(([x, y]) => x + ',' + y));
  for (const p of allPlayers(game)) {
    if (!p || p.dead) continue;
    const x = p.ax ?? p.x, y = p.ay ?? p.y;
    if (!set.has(Math.floor(x) + ',' + Math.floor(y - 0.05))) continue;
    hurtPlayer(game, { x: x + 0.01, y: y - 0.5, level: 1, name: 'Desabamento' }, p, amount, { noDodge: true, noKnock: true, from: { x, y: y - 0.5 }, dtype: 'phys' });
  }
}

// Host: supports gone (decon, mining) → finished roof tiles left without a finished support within 6 tiles collapse.
export function roofSupportSystem() {
  return {
    sync: 'host',
    update(game) {
      const R = game.roofs;
      if (!R || !R.supportDirty.length) return;
      const lost = unsupportedRoofs(game, R.supportDirty.splice(0));
      if (lost.length) collapseRoofs(game, lost);
    },
  };
}
