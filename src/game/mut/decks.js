// Piers / bridges (game/decks.js): pieces that fall into the water. The host decides it (deckSupportSystem) when the
// structures change: finished bridge pieces over the water no longer joined to a finished abutment on a bank, and small
// things left on the water without a deck under them (their deck was cancelled / removed). Chest contents float as loot.
// Op: deck.collapse.

import { defineOp } from '../../net/registry.js';
import { BUILDINGS } from '../data.js';
import { removeStructure, structById, ownStructs } from './structures.js';
import { addLootRows } from './loot.js';
import { lootRow } from './roll.js';

defineOp('deck.collapse', {
  doc: 'Bridge pieces that lost their footing (and small things left on the water) fall in: removed with a splash and wood chips; chest contents float as loot.',
  args: { ids: '[structId]', drops: 'lootRows?' },
  apply(game, a) {
    let cx = 0, cy = 0, n = 0;
    for (const id of a.ids || []) {
      const o = structById(game, id);
      if (!o) continue;
      const x = o.tx + 0.5, y = o.ty + 0.6;
      game.juice.splash(x, y, 1.3);
      game.juice.chips(x, y - 0.2, [0.55, 0.42, 0.28], 6, 0.4);
      removeStructure(game, o, { quiet: true });
      cx += x; cy += y; n++;
    }
    addLootRows(game, a.drops);
    if (!n) return;
    cx /= n; cy /= n;
    game.audio?.play('splash', { x: cx, y: cy, volume: 0.9 });
    game.audio?.play('decon', { x: cx, y: cy, volume: 0.7 });
    if (Math.hypot(game.cam.x - cx, game.cam.y - cy) < 30) game.events.emit('toast', { text: 'A ponte caiu na água!', kind: 'warn' });
  },
});

// Host: after the structures changed, drop what lost its footing (a cascade settles over a few frames).
export function deckSupportSystem() {
  let v = -1;
  return {
    sync: 'host',
    update(game) {
      const D = game.decks;
      if (!D) return;
      D.sync();
      if (D.v === v) return;
      v = D.v;
      const w = game.world, lost = D.any ? D.unsupported() : [];
      const gone = new Set(lost);
      // what stood on them, and small things on the water with no deck under them
      for (const o of ownStructs(game)) { // (a settlement's pieces never: not the ~18 000 of a city — mut/structures.js)
        if (o.lv || o.moveOf || o.town != null || gone.has(o) || BUILDINGS[o.type]?.layer !== 'main' || BUILDINGS[o.type]?.boat || !w.inBounds(o.tx, o.ty)) continue; // (a boat blueprint floats)
        const i = w.idx(o.tx, o.ty), d = D.at.get(i);
        if ((d && gone.has(d)) || (!d && w.water.get(i))) { lost.push(o); gone.add(o); }
      }
      if (!lost.length) return;
      const net = game.net, drops = [];
      for (const o of lost) if (o.store) for (const s of o.store.slots) if (s) drops.push(lootRow(net, o.x, o.y - 0.3, s.id, s.qty, 0.6));
      net.emit('deck.collapse', { ids: lost.map((o) => o.id), drops: drops.length ? drops.slice(0, 60) : undefined });
    },
  };
}
