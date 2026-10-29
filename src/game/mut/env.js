// World clock / environment changes that are not the steady tick: sleeping until dawn.
// Op: env.skip. Intent: env.sleep (only the host — or a single player — may skip time).

import { defineIntent, defineOp } from '../../net/registry.js';

defineOp('env.skip', {
  doc: 'Time jumps to dawn (bed sleep): hour, day and the world clock (crops / regrowth advance).',
  args: { hour: 'number', day: 'int', wt: 'worldTime', by: 'pid' },
  apply(game, a, ctx) {
    game.env.hour = a.hour;
    game.env.dayIndex = a.day;
    game.worldTime = a.wt;
    game.events.emit('toast', { text: ctx.mine ? 'Você dormiu até o amanhecer' : 'O anfitrião dormiu: amanheceu', kind: 'good' });
  },
});

defineIntent('env.sleep', {
  doc: 'Sleep in a bed until dawn. Refused for guests (the host owns the clock).',
  args: {},
  run(game, a, actor, net) {
    if (!actor.local) return 'Em multijogador só o anfitrião dorme até o amanhecer';
    const E = game.env, from = E.hour;
    const hours = from >= 12 ? 24 - from + 6 : 6 - from;
    const day = from >= 12 ? E.dayIndex + 1 : E.dayIndex;
    const wt = Math.round(game.worldTime + Math.max(0, hours) / 24 * (E.dayLength || 720));
    net.emit('env.skip', { hour: 6, day, wt, by: actor.pid });
  },
});
