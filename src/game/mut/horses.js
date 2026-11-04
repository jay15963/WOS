// Horses (docs/HORSE.md, game/horses.js): taming a wild horse with wheat from the hand, saddling, riding. The horse is a
// host creature: its state (species, saddle, rider) reaches the guests through the entity stream (net/entities.js), so
// the ops here carry who rides what (game.horses.rides on every peer), the owner effects (a saddle back, toasts) and the
// cosmetic feedback.
// Intents: horse.feed · horse.saddle · horse.unsaddle · horse.mount · horse.dismount. Ops: horse.ride · horse.note.

import { defineIntent, defineOp } from '../../net/registry.js';
import { findMob } from './combat.js';
import { HORSE } from '../content/horses.js';
import { feedWild, mountHorse, dismountHorse, horseOf } from '../horses.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');
const near = (e, m, extra = 0.6) => !e || Math.hypot(e.x - m.x, e.y - m.y) <= HORSE.reach + (m.r || 0.4) + extra;

defineIntent('horse.feed', {
  doc: 'Give one wheat (already taken from the actor; refunded on reject) to a wild horse by hand: it calms down a while; the third one tames it (the creature becomes the players\' horse, in place).',
  args: { nid: 'mobNid' },
  run(game, a, actor, net) {
    const m = findMob(game, a.nid), e = actor.ent;
    if (!m || m.dead) return 'O cavalo não está mais aqui';
    if (m.species !== 'wild_horse') return m.species === 'horse' ? 'Este cavalo já é domado' : 'Não é um cavalo selvagem';
    if (!e || e.dead) return 'Você está morto';
    if (horseOf(game, actor.pid)) return 'Desça do cavalo';
    if (!near(e, m)) return 'Chegue mais perto';
    if (m.state === 'flee' && m.fleeT > 0.5) return 'O cavalo está assustado: chegue devagar';
    const r = feedWild(game, m, actor);
    const tamed = r === 'tamed';
    net.emit('horse.note', { nid: m.nid, x: r2(m.x), y: r2(m.y), fx: tamed ? 'tamed' : 'eat', by: actor.pid,
      toast: tamed ? 'Você domou o cavalo! Sela para montar, trigo para comer' : `O cavalo comeu o trigo da sua mão (${r}/${HORSE.tameGives})`,
      toastKind: tamed ? 'good' : 'info' });
    return { n: tamed ? HORSE.tameGives : r };
  },
});

defineIntent('horse.saddle', {
  doc: 'Put a saddle (already taken from the actor; refunded on reject) on a tamed horse nobody rides.',
  args: { nid: 'mobNid' },
  run(game, a, actor, net) {
    const m = findMob(game, a.nid), e = actor.ent;
    if (!m || m.dead || m.species !== 'horse') return 'Só um cavalo domado pode ser selado';
    if (m.saddle) return 'Este cavalo já está selado';
    if (m.tiedTo && m.tiedTo !== actor.pid) return 'Outro jogador leva este cavalo';
    if (!near(e, m)) return 'Chegue mais perto';
    m.saddle = true;
    net.emit('horse.note', { nid: m.nid, x: r2(m.x), y: r2(m.y), fx: 'saddle', by: actor.pid, toast: 'Cavalo selado: "Montar" para cavalgar', toastKind: 'good' });
  },
});

defineIntent('horse.unsaddle', {
  doc: 'Take the saddle off a tamed horse nobody rides: the saddle goes to the actor.',
  args: { nid: 'mobNid' },
  run(game, a, actor, net) {
    const m = findMob(game, a.nid), e = actor.ent;
    if (!m || m.dead || m.species !== 'horse' || !m.saddle) return 'Este cavalo não tem sela';
    if (m.rider) return 'Alguém está montado nele';
    if (!near(e, m)) return 'Chegue mais perto';
    m.saddle = false;
    net.emit('horse.note', { nid: m.nid, x: r2(m.x), y: r2(m.y), fx: 'saddle', by: actor.pid, give: { saddle: 1 }, toast: 'Você tirou a sela', toastKind: 'info' });
  },
});

defineIntent('horse.mount', {
  doc: 'Get on a saddled tamed horse nobody rides (the actor on the ground, not in a boat); a rope the actor held it by comes back. Every peer learns it from op horse.ride.',
  args: { nid: 'mobNid' },
  run(game, a, actor) {
    const m = findMob(game, a.nid), e = actor.ent, pid = actor.pid;
    if (!m || m.dead || m.species !== 'horse') return 'Só um cavalo domado pode ser montado';
    if (!m.saddle) return 'Ponha uma sela no cavalo primeiro';
    if (m.rider) return m.rider === pid ? undefined : 'Alguém já está montado nele';
    if (m.tiedTo && m.tiedTo !== pid) return 'Outro jogador leva este cavalo';
    if (!e || e.dead) return 'Você está morto';
    if (horseOf(game, pid)) return 'Você já está montado';
    if (game.boats?.boatOf?.(pid)) return 'Saia do barco primeiro';
    if (m._boat) return 'O cavalo está no barco';
    if ((e.lv | 0) > 0 || e.z > 0.05) return 'Só no chão';
    if (!near(e, m)) return 'Chegue mais perto';
    if (game.world.liquidAt(Math.floor(m.x), Math.floor(m.y)) === 2) return 'O cavalo está na água funda';
    mountHorse(game, m, pid);
  },
});

defineIntent('horse.dismount', {
  doc: 'Get off the horse the actor rides: the actor steps off beside it (op horse.ride off with the spot). dead: 1 = the rider died / lost its horse (no spot).',
  args: { nid: 'mobNid', dead: '0|1?' },
  run(game, a, actor) {
    const m = findMob(game, a.nid);
    if (!m || m.rider !== actor.pid) {
      // (its horse is gone already: make sure every peer drops the ride)
      if (game.horses?.rides.get(actor.pid)) game.net.emit('horse.ride', { nid: typeof a.nid === 'string' ? a.nid.slice(0, 16) : '', pid: actor.pid, on: 0, by: actor.pid });
      return;
    }
    dismountHorse(game, m, a.dead ? 'dead' : 'hand');
  },
});

defineOp('horse.ride', {
  doc: 'A player got on (on: 1) / off (on: 0) a horse: game.horses.rides on every peer (pid → nid); getting off, the rider\'s own client steps to (x, y) beside the horse. Owner effects: toast for `by`.',
  args: { nid: 'mobNid', pid: 'pid', on: '0|1', x: 'number?', y: 'number?', by: 'pid?', toast: 'string?', toastKind: 'string?' },
  apply(game, a) {
    const H = game.horses;
    if (!H || typeof a.pid !== 'string') return;
    const me = a.pid === game.net.pid;
    if (a.on) {
      H.rides.set(a.pid, str(a.nid, 16));
      if (me) H.mountAt = Number.isFinite(a.x) && Number.isFinite(a.y) ? [a.x, a.y] : null;
      game.audio?.play('pickup', { x: num(a.x), y: num(a.y), volume: 0.5 });
    } else {
      H.rides.delete(a.pid);
      if (me) H.land = Number.isFinite(a.x) && Number.isFinite(a.y) ? [a.x, a.y] : null;
    }
    if (Number.isFinite(a.x)) game.juice?.puff?.(a.x, a.y, 5, [0.62, 0.54, 0.42], 0.4);
  },
});

defineOp('horse.note', {
  doc: 'Feedback of a horse action at (x, y): fx eat (it ate from a hand) / tamed / saddle; owner effects for `by` (toast, the saddle back as give).',
  args: { nid: 'mobNid', x: 'number', y: 'number', fx: "'eat'|'tamed'|'saddle'", by: 'pid', give: '{saddle: 1}?', toast: 'string?', toastKind: 'string?' },
  apply(game, a) {
    const x = num(a.x), y = num(a.y);
    if (a.fx === 'tamed') { game.juice?.puff?.(x, y - 0.3, 10, [1, 0.86, 0.45], 0.7); game.audio?.play('levelup', { x, y, volume: 0.45 }); }
    else if (a.fx === 'eat') { game.juice?.puff?.(x, y - 0.2, 4, [0.9, 0.78, 0.42], 0.35); game.audio?.play('eat', { x, y, volume: 0.45 }); }
    else game.audio?.play('pickup', { x, y, volume: 0.55 });
  },
});
