// The ballista (game/ballista.js): who operates it, where it points, its shots. One operator at a time (the host
// refuses a second one); the operator's client turns the top and reports the angle; a shot is paid by the operator
// (bolt from its backpack, refunded on a reject) and flown by every peer, the host's copy resolving the hits.

import { defineIntent, defineOp } from '../../net/registry.js';
import { BALLISTA, ballistaOf, pivotOf, muzzleOf, playerByPid, spawnBolt, boltEnd, isBallista } from '../ballista.js';
import { hostProjId } from '../projectiles.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ang = (v) => { const a = num(v, NaN); return Number.isFinite(a) ? Math.atan2(Math.sin(a), Math.cos(a)) : null; };
const LAST = new Map(); // host: ballista id → worldTime of its last shot

defineIntent('ballista.use', {
  doc: 'Get on (on: 1) or off (on: 0) a ballista; one operator at a time.',
  args: { id: 'structId', on: '0|1' },
  run(game, a, actor, net) {
    const o = ballistaOf(game, a.id);
    if (!o) return 'Balista não encontrada';
    const me = actor.pid, src = actor.ent;
    if (!a.on) { if (o.user === me) net.emit('ballista.set', { id: o.id, user: 0 }); return; }
    if (o.blueprint) return 'A balista ainda está em construção';
    if (!src || src.dead) return 'Você está morto';
    const [px, py] = pivotOf(o);
    if (Math.hypot(src.x - px, src.y - py) > BALLISTA.reach + 0.6) return 'Chegue mais perto da balista';
    if (Math.abs((src.z || 0) - (o.lv | 0)) > 0.6) return (o.lv | 0) > (src.z || 0) ? 'Suba até a balista' : 'Desça até a balista'; // (up a story: from that story only)
    if (o.user && o.user !== me) {
      const q = playerByPid(game, o.user);
      if (q && !q.dead) return 'Já tem alguém operando esta balista';
    }
    for (const b of game.build.structures) if (b !== o && b.type === 'ballista' && b.user === me) net.emit('ballista.set', { id: b.id, user: 0 }); // (one at a time per player too)
    net.emit('ballista.set', { id: o.id, user: me });
  },
});

defineIntent('ballista.aim', {
  doc: 'The operator reports where the top points now (it turns on the operator\'s client, a few times a second).',
  args: { id: 'structId', a: 'radians (world angle)' },
  run(game, a, actor, net) {
    const o = ballistaOf(game, a.id), v = ang(a.a);
    if (!o || v == null) return false;
    if (o.user !== actor.pid) return false; // (silent: the operator changed meanwhile)
    net.emit('ballista.set', { id: o.id, aim: +v.toFixed(4) });
  },
});

defineIntent('ballista.fire', {
  doc: 'The operator fires one ballista bolt (already taken from its backpack; refunded on a reject) along angle a.',
  args: { id: 'structId', a: 'radians (world angle)' },
  run(game, a, actor, net) {
    const o = ballistaOf(game, a.id), v = ang(a.a);
    if (!o || v == null) return 'Balista não encontrada';
    if (o.user !== actor.pid) return 'Você não está na balista';
    if (!actor.ent || actor.ent.dead) return 'Você está morto';
    const last = LAST.get(o.id);
    if (last != null && game.worldTime - last < BALLISTA.reload * 0.85) return 'Recarregando a balista…';
    LAST.set(o.id, game.worldTime);
    const [mx, my] = muzzleOf(o, v);
    net.emit('ballista.shot', { id: o.id, sid: hostProjId(), x: +mx.toFixed(3), y: +my.toFixed(3), a: +v.toFixed(4), by: actor.pid });
  },
});

defineOp('ballista.set', {
  doc: 'A ballista\'s operator (user: pid, 0 = nobody) and / or where it points (aim, world angle).',
  args: { id: 'structId', user: 'pid|0?', aim: 'radians?' },
  apply(game, a) {
    const o = game.world.objById.get(a.id);
    if (!isBallista(o)) return;
    if ('user' in a) { if (a.user) o.user = String(a.user).slice(0, 40); else delete o.user; }
    const v = ang(a.aim);
    if (v != null) o.aim = v;
  },
});

defineOp('ballista.shot', {
  doc: 'A ballista shoots: a bolt from (x, y) along angle a on every peer (the host\'s copy resolves the hits); the string slackens until reloaded.',
  args: { id: 'structId', sid: 'shot id', x: 'number', y: 'number', a: 'radians', by: 'pid' },
  apply(game, a, ctx) {
    const o = game.world.objById.get(a.id), v = ang(a.a) ?? 0;
    if (isBallista(o)) { o.aim = v; o._reload = BALLISTA.reload; o.shake = 0.6; }
    spawnBolt(game, { sid: String(a.sid || ''), x: num(a.x), y: num(a.y), a: v, by: a.by, lv: isBallista(o) ? o.lv | 0 : 0 }, !!game.net.auth); // (up a story: from that height)
    game.events?.emit('ballistashot', { x: num(a.x), y: num(a.y), a: v }); // (fx/giantfx.js: the thump, dust, sound)
    void ctx;
  },
});

defineOp('ballista.end', {
  doc: 'Where the host\'s copy of a ballista bolt stopped (stuck: in a wall / a giant; 0: it fell at the end of its range).',
  args: { sid: 'shot id', x: 'number', y: 'number', stuck: '0|1' },
  apply(game, a) { boltEnd(game, String(a.sid || ''), num(a.x), num(a.y), !!a.stuck); },
});
