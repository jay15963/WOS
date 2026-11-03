// Boats (game/boats.js, docs/PLAN-V2.md "Barco"): launching a finished boat blueprint, getting on / off (and the
// tied animals with their leader), rowing (the driver reports its simulated pose; the host checks it), taking it apart.
// Intents: boat.board · boat.leave · boat.move · boat.decon. Ops: boat.launch · boat.set · boat.pos · boat.remove.
// Room: 6 places shared by players and animals (at most 4 players); a player who boards brings every animal it leads
// on a rope, or does not board ("Não cabe todo mundo").

import { defineIntent, defineOp } from '../../net/registry.js';
import { BUILDINGS } from '../data.js';
import { removeStructure, structById, REFUND } from './structures.js';
import { BOAT, hullFree, promote, unloadPet } from '../boats.js';
import { hullNear } from '../content/boats.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const boatOf = (game, id) => (typeof id === 'string' ? game.boats?.map.get(id) || null : null);
const nonEmpty = (o) => (Object.keys(o).length ? o : undefined);
const LAST = new Map(); // host: boat id → worldTime of the last accepted move

defineIntent('boat.board', {
  doc: 'Get into a boat (the first one aboard takes the oars); the actor\'s tied animals come along — all of them, or the actor does not board (6 places in all, 4 players at most).',
  args: { id: 'boatId' },
  run(game, a, actor, net) {
    const B = game.boats, b = boatOf(game, a.id), e = actor.ent, pid = actor.pid;
    if (!b) return 'Barco não encontrado';
    if (!e || e.dead) return 'Você está morto';
    if (b.seats.includes(pid)) return;
    if (B.boatOf(pid)) return 'Você já está em outro barco';
    if (hullNear(b.x, b.y, b.h, e.x, e.y)[2] > BOAT.reach + 0.8) return 'Chegue mais perto do barco';
    if (B.players(b) >= BOAT.players || B.used(b) >= BOAT.room) return `O barco está cheio (${BOAT.room} lugares)`;
    // the animals this player leads on a rope come along
    const mine = game.entities.filter((m) => m.stock && !m.dead && !m.proxy && m.tiedTo === pid && !m._boat && Math.hypot(m.x - e.x, m.y - e.y) < 16);
    if (B.used(b) + 1 + mine.length > BOAT.room) {
      const free = BOAT.room - B.used(b);
      return `Não cabe todo mundo: o barco leva ${BOAT.room} (sobra${free > 1 ? 'm' : ''} ${free} lugar${free > 1 ? 'es' : ''}; você e ${mine.length} anima${mine.length > 1 ? 'is' : 'l'})`;
    }
    const seats = b.seats.slice(), pets = b.pets.map((q) => q.slice());
    const k = B.freePlace(b, false);
    if (k < 0) return 'O barco está cheio';
    seats[k] = pid;
    const taken = new Set([k]);
    for (const m of mine) {
      const j = B.freePlace(b, true, taken);
      if (j < 0) break;
      taken.add(j);
      pets.push([m.nid, pid, j]);
    }
    net.emit('boat.set', { id: b.id, seats, pets });
    return { place: k };
  },
});

defineIntent('boat.leave', {
  doc: 'Get off a boat onto land / a pier / shallow water next to the hull (refused far from the bank); the actor\'s animals get off with it; a driver hands the oars to the next passenger. dead: 1 = the rider died (no landing).',
  args: { id: 'boatId', dead: '0|1?' },
  run(game, a, actor, net) {
    const B = game.boats, b = boatOf(game, a.id), pid = actor.pid;
    if (!b) return 'Barco não encontrado';
    const k = b.seats.indexOf(pid);
    if (k < 0) return;
    const dead = !!a.dead || !!actor.ent?.dead;
    let spot = null;
    if (!dead) {
      const e = actor.ent;
      spot = B.landingSpot(b, e ? e.x : b.x, e ? e.y : b.y);
      if (!spot) return 'Longe da margem: reme até a terra (ou um trapiche)';
    }
    const seats = b.seats.slice(), pets = [];
    seats[k] = 0;
    let n = 0;
    for (const q of b.pets) {
      if (q[1] !== pid) { pets.push(q.slice()); continue; }
      unloadPet(game, B, b, q[0], spot, n++); // (host creatures: on the bank next to their leader)
    }
    if (k === 0) promote(seats);
    net.emit('boat.set', { id: b.id, seats, pets, off: spot ? [[pid, spot[0], spot[1]]] : undefined });
    if (k === 0) net.emit('boat.pos', { id: b.id, x: b.x, y: b.y, h: b.h, vx: 0, vy: 0 }); // (nobody rows: it stops)
  },
});

defineIntent('boat.move', {
  doc: 'The driver reports the boat it rows (its client simulates it): the host checks the driver, the speed and the water under the hull, and shares the pose — or sends it back (fix) to the driver.',
  args: { id: 'boatId', x: 'number', y: 'number', h: 'radians', vx: 'number', vy: 'number' },
  run(game, a, actor, net) {
    const b = boatOf(game, a.id);
    if (!b || b.seats[0] !== actor.pid) return false; // (silent: the oars changed hands meanwhile)
    const x = num(a.x, NaN), y = num(a.y, NaN), hr = num(a.h, NaN);
    const fix = () => net.emit('boat.pos', { id: b.id, x: b.x, y: b.y, h: b.h, vx: 0, vy: 0, fix: actor.pid });
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(hr)) { fix(); return; }
    const h = Math.atan2(Math.sin(hr), Math.cos(hr));
    const t = game.worldTime, last = LAST.get(b.id), dt = Math.max(0.1, Math.min(1.5, last == null ? 1.5 : t - last));
    const far = Math.hypot(x - b.x, y - b.y) > BOAT.speed * 1.6 * dt + 0.6;
    if (game.world.frozenAt(b.x, b.y) && Math.hypot(x - b.x, y - b.y) > 0.05) { fix(); return; }
    if (far || !hullFree(game, x, y, h, b, 0.05)) { fix(); return; }
    LAST.set(b.id, t);
    const vx = Math.max(-5, Math.min(5, num(a.vx))), vy = Math.max(-5, Math.min(5, num(a.vy)));
    net.emit('boat.pos', { id: b.id, x: r3(x), y: r3(y), h: r3(h), vx: r2(vx), vy: r2(vy) });
  },
});

defineIntent('boat.decon', {
  doc: 'Take an empty boat apart next to it (75% of its materials back).',
  args: { id: 'boatId' },
  run(game, a, actor, net) {
    const b = boatOf(game, a.id), e = actor.ent;
    if (!b) return 'Barco não encontrado';
    if (b.seats.some(Boolean) || b.pets.length) return 'Tem gente no barco';
    if (!e || hullNear(b.x, b.y, b.h, e.x, e.y)[2] > 3.2) return 'Chegue mais perto do barco';
    const back = {}, cost = BUILDINGS.boat.cost;
    for (const k in cost) back[k] = Math.round(cost[k] * REFUND);
    net.emit('boat.remove', { id: b.id, by: actor.pid, give: nonEmpty(back), giveAt: [r2(e.x), r2(e.y)], toast: 'Barco desmontado' });
  },
});

defineOp('boat.launch', {
  doc: 'A boat floats: its finished blueprint (sid) goes away and the boat appears at its launch pose (id, x, y, heading h, variant v, at).',
  args: { sid: 'structId?', id: 'boatId', x: 'number', y: 'number', h: 'radians', v: 'int', at: 'worldTime', by: 'pid?', xp: 'number?', toast: 'string?' },
  apply(game, a) {
    const o = a.sid ? structById(game, a.sid) : null;
    if (o) removeStructure(game, o, { quiet: true });
    const b = game.boats?.add([String(a.id || ''), num(a.x, NaN), num(a.y, NaN), num(a.h), a.v | 0, num(a.at)]);
    if (!b) return;
    b._x = b.x; b._y = b.y; b._h = b.h;
    game.juice?.splash?.(b.x, b.y, 1.4);
    game.audio?.play('splash', { x: b.x, y: b.y, volume: 0.8 });
    game.audio?.play('build_done', { x: b.x, y: b.y, volume: 0.7 });
  },
});

defineOp('boat.set', {
  doc: 'Who rides a boat: seats [pid|0 × 6] (players by place; 0 = the oars), pets [[nid, pid, place]]; off [[pid, x, y]]: players stepping off there (their own client moves them).',
  args: { id: 'boatId', seats: '[pid|0 × 6]?', pets: '[[nid, pid, place]]?', off: '[[pid, x, y]]?', by: 'pid?', toast: 'string?' },
  apply(game, a) {
    const B = game.boats, b = boatOf(game, a.id);
    if (!b) return;
    B.setRiders(b, a.seats, a.pets, a.off);
    if (Array.isArray(a.off) && a.off.length) game.audio?.play('step', { x: b.x, y: b.y, volume: 0.5 });
  },
});

defineOp('boat.pos', {
  doc: 'Where a boat is (its driver rows it): centre, heading, velocity; fix = the driver whose report was refused snaps back here.',
  args: { id: 'boatId', x: 'number', y: 'number', h: 'radians', vx: 'number', vy: 'number', fix: 'pid?' },
  apply(game, a) {
    const b = boatOf(game, a.id);
    if (b) game.boats.setPos(b, a);
  },
});

defineOp('boat.remove', {
  doc: 'A boat is taken apart (empty); materials back as give.',
  args: { id: 'boatId', by: 'pid?', give: '{item: qty}?', giveAt: '[x, y]?', toast: 'string?' },
  apply(game, a) {
    const b = boatOf(game, a.id);
    if (!b) return;
    game.juice?.puff?.(b.x, b.y - 0.1, 10, [0.72, 0.6, 0.45], 0.7);
    game.juice?.splash?.(b.x, b.y, 1);
    game.audio?.play('decon', { x: b.x, y: b.y, volume: 0.8 });
    game.boats.remove(b.id);
  },
});
