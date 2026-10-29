// Gathering + generic work loop. Natural objects: trees (axe: chop -> fall -> stump -> chop the stump
// to remove it), boulders (pickaxe), and by hand: pebbles / sticks (pick), fiber grass, bushes, berry
// bushes, wild crops (forage). Everything harvested is REMOVED from the world (flora.js regrows
// elsewhere). Other modules (mining, building, farming) register their work kinds with registerWork().
// Multiplayer: the work loop is the worker's own; every shared change goes through the host
// (intent gather.hit → ops in mut/objects.js). Work handlers never mutate shared state.
//
// p.work = { it, owner:'gather', type (action anim), cycle, need, hits, t, hitDone, k (0..1), label, tool? }

import { faceTowards } from './combat.js';
import { bestTool } from './equipment.js';
import { ITEMS } from './data.js';
import { objectHitFx, treeLandDrops, touch } from './mut/objects.js';
import { inAnyView } from './players.js';

export { TREE_SOLID } from './flora.js';
export { touch };
const TREE_TIME = { tree_oak: 4.6, tree_pine: 3.9, tree_birch: 3.6, tree_dead: 2.6 };
export const STUMP_DECAY = 2160; // s (3 in-game days)
const FORAGE = {
  fibergrass:  { verb: 'Colher fibra', label: 'Colhendo fibra', cycle: 0.9, prio: 3, fiber: true },
  bush:        { verb: 'Colher', label: 'Colhendo arbusto', cycle: 1.2, prio: 2, fiber: true },
  berrybush:   { verb: 'Colher frutas', label: 'Colhendo frutas', cycle: 1.3, prio: 4 },
  herbbush:    { verb: 'Colher ervas', label: 'Colhendo ervas', cycle: 1.4, prio: 4 },
  wild_potato: { verb: 'Colher batata', label: 'Colhendo batata', cycle: 1.2, prio: 4 },
  wild_corn:   { verb: 'Colher milho', label: 'Colhendo milho', cycle: 1.2, prio: 4 },
  wild_cotton: { verb: 'Colher algodão', label: 'Colhendo algodão', cycle: 1.2, prio: 4 },
};
const PICK = { pebble: { verb: 'Pegar pedrinha', item: 'pebble' }, stick: { verb: 'Pegar graveto', item: 'stick' } };

// ---------- work kind registry ----------
// handler: { start(game, it) -> spec | null, valid(game, it), hit?(game, wk), finish(game, wk) -> done, tick?(game, wk, dt) }
const WORK = {};
export function registerWork(kind, handler) { WORK[kind] = handler; }
export const workHandler = (kind) => WORK[kind];

const TOOL_MSG = {
  chop: ['Você precisa de um machado', 'Machado primitivo: 2 pedrinhas + 2 fibras + 1 graveto (Criar)'],
  mine: ['Você precisa de uma picareta', 'Picareta primitiva: 3 pedrinhas + 2 fibras + 1 graveto (Criar)'],
};
export const needToolMsg = (kind) => TOOL_MSG[kind][0];
export function needTool(game, kind) {
  const msg = TOOL_MSG[kind];
  game.events.emit('error', { text: msg[0] });
  const h = game.ctl?.hinted;
  if (h && !h['tool_' + kind]) { h['tool_' + kind] = true; game.events.emit('toast', { text: msg[1], kind: 'info' }); }
  return null;
}

// split a total work time into hits of ~0.75 s
export function hitsFor(total, min = 2) {
  const need = Math.max(min, Math.round(total / 0.75));
  return { need, cycle: total / need };
}

// Interactable descriptor for a natural world object (or null)
export function describeObject(game, o) {
  const t = o.type, p = game.player;
  if (t.startsWith('tree_')) {
    if (o.fall) return null;
    const axe = !!bestTool(p, 'chop');
    if (o.stump) return { kind: 'stump', o, x: o.x, y: o.y, verb: 'Arrancar toco', icon: 'axe', prio: axe ? 1 : -2, reach: 0.8 };
    if ((o.age ?? 1) < 0.9) return null; // saplings can't be chopped yet
    return { kind: 'tree', o, x: o.x, y: o.y, verb: 'Cortar', icon: 'axe', prio: axe ? 2 : -1, reach: 0.95 };
  }
  if (PICK[t]) return { kind: 'pick', o, x: o.x, y: o.y, verb: PICK[t].verb, icon: 'hand', prio: 5, reach: 0.7 };
  const F = FORAGE[t];
  if (F) return { kind: 'forage', o, x: o.x, y: o.y, verb: F.verb, icon: 'gather', prio: F.prio, reach: 0.9 };
  if (t === 'boulder') {
    const pick = !!bestTool(p, 'mine');
    return { kind: 'boulder', o, x: o.x, y: o.y, verb: 'Quebrar', icon: 'pickaxe', prio: pick ? 2 : -1, reach: 0.75 + o.s * 0.4 };
  }
  return null;
}

// distance from player to the interactable's contact zone (tile kinds use the footprint rect)
export function reachDist(p, it) {
  if (it.tile) {
    const w = it.w || 1, h = it.h || 1;
    const cx = Math.max(it.tx, Math.min(it.tx + w, p.x)), cy = Math.max(it.ty, Math.min(it.ty + h, p.y));
    return Math.hypot(p.x - cx, p.y - cy) - p.r;
  }
  return Math.hypot(p.x - it.x, p.y - it.y) - p.r;
}

export function startWork(game, it) {
  const p = game.player;
  const H = WORK[it.kind];
  if (!H || p.dead) return false;
  const spec = H.start(game, it);
  if (!spec) return false;
  p.autoAttack = false;
  p.work = { owner: 'gather', it, t: 0, hitDone: false, hits: 0, ...spec };
  p.work.k = p.work.hits / p.work.need;
  p.action = { type: spec.type, t: 0 };
  return true;
}

// ---------- natural objects ----------
// The worker's client plays the hit feedback at once and asks the host (gather.hit); the host owns the
// progress (o.prog) and the completion. `finish` never mutates: it sends the final hit and ends the work.
const hitReq = (game, wk, kind) => game.net.request('gather.hit', { id: wk.it.o.id, kind, inc: +(1 / wk.need).toFixed(4) });
const finalReq = (game, wk, kind, extra) => { game.net.request('gather.hit', { id: wk.it.o.id, kind, final: true, ...extra }); return true; };

registerWork('tree', {
  valid: (g, it) => !it.o.gone && !it.o.stump && !it.o.fall,
  start(game, it) {
    const o = it.o;
    if ((o.age ?? 1) < 0.9) { game.events.emit('error', { text: 'Ainda está crescendo' }); return null; }
    const tool = bestTool(game.player, 'chop');
    if (!tool) return needTool(game, 'chop');
    const { need, cycle } = hitsFor((TREE_TIME[o.type] || 4) * (o.s || 1) / tool.speed, 3);
    return { type: 'chop', cycle, need, hits: Math.floor((o.prog || 0) * need), label: 'Cortando', tool: tool.id };
  },
  hit(game, wk) { objectHitFx(game, wk.it.o, game.player); hitReq(game, wk, 'tree'); },
  finish: (game, wk) => finalReq(game, wk, 'tree'),
});

registerWork('stump', {
  valid: (g, it) => !it.o.gone && it.o.stump,
  start(game, it) {
    const tool = bestTool(game.player, 'chop');
    if (!tool) return needTool(game, 'chop');
    const cycle = 0.85 / Math.sqrt(tool.speed);
    return { type: 'chop', cycle, need: 2, hits: Math.floor((it.o.prog || 0) * 2), label: 'Arrancando toco', tool: tool.id };
  },
  hit(game, wk) { objectHitFx(game, wk.it.o, game.player); hitReq(game, wk, 'stump'); },
  finish: (game, wk) => finalReq(game, wk, 'stump'),
});

registerWork('boulder', {
  valid: (g, it) => !it.o.gone,
  start(game, it) {
    const tool = bestTool(game.player, 'mine');
    if (!tool) return needTool(game, 'mine');
    const { need, cycle } = hitsFor((2.2 + it.o.s * 2.2) / tool.speed, 2);
    return { type: 'mine', cycle, need, hits: Math.floor((it.o.prog || 0) * need), label: 'Quebrando pedra', tool: tool.id };
  },
  hit(game, wk) { objectHitFx(game, wk.it.o, game.player); hitReq(game, wk, 'boulder'); },
  finish: (game, wk) => finalReq(game, wk, 'boulder'),
});

registerWork('pick', {
  valid: (g, it) => !it.o.gone,
  start: () => ({ type: 'pick', cycle: 0.55, need: 1, label: 'Pegando', instantHit: true }),
  finish: (game, wk) => finalReq(game, wk, 'pick'),
});

registerWork('forage', {
  valid: (g, it) => !it.o.gone,
  start(game, it) {
    const F = FORAGE[it.o.type];
    let cycle = F.cycle;
    let tool = null;
    if (F.fiber) {
      const k = bestTool(game.player, 'fiber');
      if (k) { cycle /= 1 + 0.35 * k.speed; tool = k.id; }
    }
    return { type: 'gather', cycle, need: 1, label: F.label, tool };
  },
  finish: (game, wk) => finalReq(game, wk, 'forage', { fibre: !!bestTool(game.player, 'fiber') }),
});

// ---------- system ----------
export function gatheringSystem() {
  let slowT = 0;
  return {
    sync: 'all', // work loop: owner · falling animation: every peer · drops, stumps and decay: authority
    update(game, dt) {
      const p = game.player, net = game.net;
      const wk = p.work;
      if (wk && wk.owner === 'gather' && !p.dead) {
        const it = wk.it, H = WORK[it.kind];
        if (!H || !H.valid(game, it) || reachDist(p, it) > it.reach + 0.45) { p.work = null; p.action = null; }
        else {
          faceTowards(p, { x: it.tile ? it.tx + (it.w || 1) / 2 : it.x, y: it.tile ? it.ty + (it.h || 1) / 2 : it.y });
          wk.t += dt / wk.cycle;
          const hitAt = wk.instantHit ? 1 : 0.55;
          if (H.hit && !wk.hitDone && wk.t >= hitAt) { wk.hitDone = true; wk.hits++; H.hit(game, wk); }
          if (wk.t >= 1) {
            if (!H.hit) wk.hits++;
            wk.t = 0; wk.hitDone = false;
            if (wk.hits >= wk.need) {
              const done = H.finish(game, wk);
              if (done !== false) { if (p.work === wk) { p.work = null; p.action = null; } }
              else { wk.hits = 0; }
            }
          }
          if (p.work === wk) {
            p.action = p.action || { type: wk.type, t: 0 };
            p.action.type = wk.type;
            p.action.t = wk.type === 'gather' || wk.type === 'pick' ? Math.min(1, wk.t) : wk.t;
            const done = H.hit && wk.hitDone ? wk.hits - 1 : wk.hits;
            wk.k = Math.min(1, (done + Math.min(1, wk.t)) / wk.need);
            H.tick?.(game, wk, dt);
          }
        }
      }

      // shaking objects decay (cosmetic)
      game.shaking = game.shaking || new Set();
      if (p.work?.it?.o) game.shaking.add(p.work.it.o);
      for (const o of game.shaking) {
        if (o.shake > 0) o.shake = Math.max(0, o.shake - dt * 3.5);
        if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 5);
        if (!(o.shake > 0) && !(o.flash > 0) && o !== p.work?.it?.o) game.shaking.delete(o);
      }

      // falling trees: every peer animates; the authority drops the wood and makes the stump
      for (let i = game.falling.length - 1; i >= 0; i--) {
        const o = game.falling[i];
        const before = o.fall;
        o.fall = Math.min(net.auth ? 9 : 1.5, o.fall + dt * (o.fall < 1 ? 0.6 + o.fall * 1.6 : 1.4)); // sync-ok: fall animation progress (start/end are ops)
        const dir = o.fallDir || o.f || 1;
        if (before < 1 && o.fall >= 1) {
          const fx = o.x + dir * 1.6 * o.s;
          if (game.juice.treeLand) game.juice.treeLand(o, dir); else game.juice.leaves(fx, o.y, 12, 0.4);
          game.juice.puff(fx, o.y, 8, [0.6, 0.55, 0.45], 0.9);
          if (Math.hypot(p.x - o.x, p.y - o.y) < 14) game.juice.shake(0.2);
          if (net.auth) net.emit('tree.land', { id: o.id, drops: treeLandDrops(game, o) });
        }
        if (o.fall >= 1.5 && net.auth) net.emit('tree.stump', { id: o.id, at: Math.round(game.worldTime) });
      }

      // stumps rot away after a few days (never while any player can see them) — authority
      slowT -= dt;
      if (slowT <= 0 && net.auth) {
        slowT = 5;
        const now = game.worldTime, ids = [];
        for (const o of game.stumps) {
          if (o.gone || !o.stump) { game.stumps.delete(o); continue; }
          if (now - (o.stumpAt || now) < STUMP_DECAY) continue;
          if (inAnyView(game, o.x, o.y, 2, 3)) continue;
          ids.push(o.id);
        }
        if (ids.length) net.emit('obj.remove', { ids });
      }
    },
  };
}
export const itemName = (id) => ITEMS[id]?.name || id;
