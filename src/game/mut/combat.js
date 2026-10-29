// Combat against host creatures. The attacker's client rolls hit / miss / crit / damage (as in single
// player); the host applies the rolled amount to its authoritative creature (armor, evade immunity, aggro,
// death, loot) — intent mob.hit. Deaths are op mob.die (xp to the killer via owner effects, proxies die on
// guests). Creature state itself reaches guests through the entity stream (net/entities.js), damage
// numbers through `fx` events. Damage to players: owner message player.hurt (mut/own.js).

import { defineIntent, defineOp } from '../../net/registry.js';
import { dealDamage, addDot, stun, dist } from '../combat.js';
import { aggro, startFlee } from '../ai.js';
import { fireCosmetic } from '../projectiles.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, n = 24) => (typeof v === 'string' ? v.slice(0, n) : undefined);

// host: the real creature · guest: its proxy
export function findMob(game, nid) {
  if (!nid) return null;
  if (!game.net.auth) return game.net.entsApi?.byNid?.(nid) || null;
  for (const e of game.entities) if (e.nid === nid) return e;
  return null;
}

// status effects of a player's ability on a creature (authority). eff: { stun, daze, interrupt, dot, fear, aggro, status }
export function applyMobEffect(game, m, eff, src) {
  if (!m || m.dead || !eff) return;
  if (eff.daze) m.dazeT = Math.max(m.dazeT || 0, num(eff.daze));
  if (eff.interrupt && m.cast) { m.cast = null; game.events.emit('damage', { target: m, src, amount: 0, kind: 'interrupt' }); }
  if (eff.dot && typeof eff.dot.id === 'string') addDot(game, m, eff.dot.id, { dur: num(eff.dot.dur, 6), tick: num(eff.dot.tick, 1), dmg: num(eff.dot.dmg, 1), src });
  if (eff.stun) stun(game, m, num(eff.stun), src);
  if (eff.fear && m.kind === 'animal' && m.faction !== 'bandit') {
    m.fearT = m.elite ? Math.min(2, num(eff.fear)) : num(eff.fear);
    startFlee(m, src, m.fearT);
    m.threat = null;
    game.events.emit('damage', { target: m, src, amount: 0, kind: 'status', text: 'Assustado!', dtype: 'fire' });
  }
  if (Array.isArray(eff.status)) game.events.emit('damage', { target: m, src, amount: 0, kind: 'status', text: str(eff.status[0], 24), dtype: str(eff.status[1], 8) });
  if (eff.aggro) aggro(game, m, src);
}

defineIntent('mob.hit', {
  doc: 'A player hit (or missed) a host creature with an amount rolled on its client; eff carries ability effects (stun, daze, dot, fear, interrupt, aggro).',
  args: { nid: 'mobNid', amount: 'number', crit: '0|1', miss: '0|1', noDmg: '0|1 (effects only)', ability: 'string?', dtype: 'string?', ranged: '0|1', from: '[x, y]?', knock: 'number?', skin: '0|1 (killer has a knife)', eff: '{...}?' },
  run(game, a, actor, net) {
    const m = findMob(game, a.nid);
    if (!m || m.dead) return 'Alvo morto';
    const src = actor.ent;
    if (src && dist(src, m) > (a.ranged ? 18 : 6)) return 'Longe demais';
    m.lastHitSkin = !!a.skin;
    if (a.miss) {
      game.events.emit('damage', { target: m, src, amount: 0, kind: 'miss' });
      aggro(game, m, src);
      return;
    }
    if (!a.noDmg) {
      const amount = Math.max(0, Math.min(5000, num(a.amount)));
      const from = Array.isArray(a.from) ? { x: num(a.from[0], src?.x), y: num(a.from[1], src?.y) } : undefined;
      dealDamage(game, src, m, amount, {
        crit: !!a.crit, ability: str(a.ability), dtype: str(a.dtype, 8), ranged: !!a.ranged, from,
        knock: a.knock != null ? Math.max(0, Math.min(3, num(a.knock))) : undefined, dot: !!a.dot, noKnock: !!a.dot,
      });
    }
    if (a.eff && typeof a.eff === 'object' && !m.dead) applyMobEffect(game, m, a.eff, src);
  },
});

defineOp('mob.die', {
  doc: 'A creature died (host decided). Proxies die on guests; xp goes to the killing player `by`.',
  args: { nid: 'mobNid', by: 'pid?', xp: 'number?', toast: 'string?', tip: '[key, text, max]?' },
  apply(game, a, ctx) {
    const m = findMob(game, a.nid);
    if (!m) return;
    if (!ctx.auth) {
      m.hp = 0; m.dead = true; m.deadT = 0; m.action = null; m.moving = false; m.cast = null; m.blocking = false; m.state = 'dead';
      m._dieSeq = ctx.seq;
    }
    game.audio?.play('death', { x: m.x, y: m.y, volume: 0.6 });
    game.juice.puff(m.x, m.y, 8, [0.7, 0.64, 0.56], 0.7);
    game.events.emit('kill', { target: m });
  },
});

defineIntent('proj.fire', {
  doc: "A player's own projectile (simulated by the shooter), relayed to the other peers as a cosmetic copy.",
  args: { id: "'pid:n'", a: '[kind, x, y, tx, ty, angle, speed, range, faction, h1]' },
  run(game, a, actor, net) {
    if (typeof a.id !== 'string' || !Array.isArray(a.a)) return 'inválido';
    const id = a.id.slice(0, 40), args = a.a.slice(0, 10);
    if (!actor.local) fireCosmetic(game, id, args);
    net.entsApi?.fx?.(['proj', id, ...args], num(args[1]), num(args[2]), actor.pid);
  },
});
