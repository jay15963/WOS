// Livestock (docs/LIVESTOCK.md, src/game/livestock.js): tying farm animals with a rope and releasing them. The animal
// itself is a host creature: its tie / farm state reaches guests through the entity stream (net/entities.js dyn
// fields), so the ops here only carry the owner effects (the rope back, toasts) and the cosmetic feedback.
// Intents: stock.tie · stock.untie. Ops: stock.rope (tied / released) · stock.note (a farm message for everyone).

import { defineIntent, defineOp } from '../../net/registry.js';
import { findMob } from './combat.js';
import { canTie, tie, untie, nameOf } from '../livestock.js';

const r2 = (v) => Math.round((v || 0) * 100) / 100;
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');

defineIntent('stock.tie', {
  doc: 'Tie a farm animal (cow, sheep, pig, chicken) with a rope (already taken from the actor; refunded on reject): it follows the actor (at most 5 per player).',
  args: { nid: 'mobNid' },
  run(game, a, actor, net) {
    const m = findMob(game, a.nid);
    const why = canTie(game, m, actor.pid);
    if (why) return why;
    const e = actor.ent;
    if (e && Math.hypot(e.x - m.x, e.y - m.y) > 3.2) return 'Chegue mais perto';
    tie(game, m, actor.pid);
    const nm = nameOf(m.species, !!((m.variant | 0) & 2)).toLowerCase(), masc = nm.endsWith('o');
    net.emit('stock.rope', { nid: m.nid, on: 1, x: r2(m.x), y: r2(m.y), by: actor.pid, toast: `Você amarrou ${masc ? 'o' : 'a'} ${nm}: ${masc ? 'ele' : 'ela'} segue você`, toastKind: 'info' });
  },
});

defineIntent('stock.untie', {
  doc: 'Release an animal the actor leads (the rope comes back); it stays where it is — inside a feeder\'s range it is domesticated.',
  args: { nid: 'mobNid' },
  run(game, a, actor) {
    const m = findMob(game, a.nid);
    if (!m || m.dead || !m.stock) return 'Não dá';
    if (m.tiedTo !== actor.pid) return 'Este animal não está com você';
    untie(game, m, 'hand');
  },
});

defineOp('stock.rope', {
  doc: 'A farm animal was tied (on: 1) or released (on: 0) at (x, y); owner effects: the rope back (give) and a toast for `by`.',
  args: { nid: 'mobNid', on: '0|1', x: 'number', y: 'number', by: 'pid', give: '{rope: 1}?', toast: 'string?', toastKind: 'string?' },
  apply(game, a) {
    game.audio?.play(a.on ? 'pickup' : 'ui_click', { x: a.x, y: a.y, volume: 0.6 });
    game.juice?.puff?.(a.x, a.y, 4, [0.72, 0.6, 0.42], 0.35);
  },
});

defineOp('stock.note', {
  doc: 'A message about the farm for every player (a birth, an animal starving / dead of hunger).',
  args: { text: 'string', kind: "'good'|'bad'|'info'" },
  apply(game, a) {
    const text = str(a.text);
    if (text) game.events.emit('toast', { text, kind: a.kind === 'bad' ? 'bad' : a.kind === 'good' ? 'good' : 'info' });
  },
});
