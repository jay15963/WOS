// World clock jumps that are not the steady tick. Op: env.skip (host only: debug skipTo / test fast-forward).
// (Beds no longer skip the night: they only set the respawn point — building.js useStructure 'bed'.)

import { defineOp } from '../../net/registry.js';

defineOp('env.skip', {
  doc: 'Time jumps (host): hour, day and the world clock (crops / regrowth advance). Tests fast-forward with it.',
  args: { hour: 'number', day: 'int', wt: 'worldTime', by: 'pid' },
  apply(game, a) {
    game.env.hour = a.hour;
    game.env.dayIndex = a.day;
    game.worldTime = a.wt;
  },
});
