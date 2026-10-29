// Stories (agent L, docs/LEVELS.md §3): an upper piece that lost what holds it up falls down.
// Op: lv.collapse — the host's levels system finds finished upper pieces with no support left (an upper floor with no
// wall / column of the story below within 6 tiles, or a wall / chest / stair with no floor under it) right after the
// structures changed, and removes them in one op with half their materials as loot on the ground below. A collapse
// can leave more pieces unsupported: the next check takes them too (cascade, one story per frame).

import { defineOp } from '../../net/registry.js';
import { removeStructure, structById } from './structures.js';
import { addLootRows } from './loot.js';

defineOp('lv.collapse', {
  doc: 'Upper-story pieces without support fall down (dust, a crash); drops = half their materials on the ground below.',
  args: { ids: '[structId]', drops: 'lootRows?' },
  apply(game, a) {
    let cx = 0, cy = 0, n = 0;
    for (const id of a.ids || []) {
      const o = structById(game, id);
      if (!o) continue;
      cx += o.x; cy += o.y; n++;
      game.juice?.puff?.(o.x, o.y - 0.4, 6, [0.66, 0.56, 0.42], 1.1);
      game.juice?.chips?.(o.x, o.y - 0.5, [0.62, 0.48, 0.3], 6, 1.2);
      removeStructure(game, o, { quiet: true });
    }
    addLootRows(game, a.drops);
    if (n) game.audio?.play('roof_collapse', { x: cx / n, y: cy / n });
  },
});
