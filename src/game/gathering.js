// Gathering + generic work loop. Natural objects: trees (axe: chop -> fall -> stump -> chop the stump
// to remove it), boulders (pickaxe), and by hand: pebbles / sticks (pick), fiber grass, bushes, berry
// bushes, wild crops (forage). Everything harvested is REMOVED from the world (flora.js regrows
// elsewhere). Other modules (mining, building, farming) register their work kinds with registerWork().
//
// p.work = { it, owner:'gather', type (action anim), cycle, need, hits, t, hitDone, k (0..1), label, tool? }

import { occRemove } from './nav.js';
import { dropLoot } from './loot.js';
import { gainXp } from './player.js';
import { faceTowards } from './combat.js';
import { bestTool } from './equipment.js';
import { ITEMS } from './data.js';
import { removeNatural } from './flora.js';

export { TREE_SOLID } from './flora.js';
const TREE_TIME = { tree_oak: 4.6, tree_pine: 3.9, tree_birch: 3.6, tree_dead: 2.6 };
const TREE_WOOD = { tree_oak: [4, 5], tree_pine: [3, 5], tree_birch: [3, 4], tree_dead: [2, 3] };
export const STUMP_DECAY = 2160; // s (3 in-game days)
const FORAGE = {
  fibergrass:  { verb: 'Colher fibra', label: 'Colhendo fibra', cycle: 0.9, prio: 3, fiber: true },
  bush:        { verb: 'Colher', label: 'Colhendo arbusto', cycle: 1.2, prio: 2, fiber: true },
  berrybush:   { verb: 'Colher frutas', label: 'Colhendo frutas', cycle: 1.3, prio: 4 },
  wild_potato: { verb: 'Colher batata', label: 'Colhendo batata', cycle: 1.2, prio: 4 },
  wild_corn:   { verb: 'Colher milho', label: 'Colhendo milho', cycle: 1.2, prio: 4 },
  wild_cotton: { verb: 'Colher algodão', label: 'Colhendo algodão', cycle: 1.2, prio: 4 },
};
const PICK = { pebble: { verb: 'Pegar pedrinha', item: 'pebble' }, stick: { verb: 'Pegar graveto', item: 'stick' } };

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function touch(game, o) { if (!o.flora) game.touched.set(o.id, o); }

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
  hit(game, wk) {
    const p = game.player, o = wk.it.o, J = game.juice;
    o.shake = 1; o.prog = wk.hits / wk.need;
    J.leaves(o.x, o.y, 4, 1.8 * o.s);
    J.chips(o.x - (o.x - p.x) * 0.3, o.y, [0.62, 0.45, 0.28], 4, 0.4);
    game.audio?.play('chop', { x: o.x, y: o.y });
    touch(game, o);
  },
  finish(game, wk) {
    const o = wk.it.o, p = game.player;
    o.fall = 0.001; o.prog = 0;
    o.fallDir = p.x < o.x ? 1 : -1;
    occRemove(game, o);
    game.falling.push(o);
    game.audio?.play('chop', { x: o.x, y: o.y, volume: 1.2 });
    gainXp(game, 6);
    touch(game, o);
    return true;
  },
});

registerWork('stump', {
  valid: (g, it) => !it.o.gone && it.o.stump,
  start(game, it) {
    const tool = bestTool(game.player, 'chop');
    if (!tool) return needTool(game, 'chop');
    const cycle = 0.85 / Math.sqrt(tool.speed);
    return { type: 'chop', cycle, need: 2, hits: Math.floor((it.o.prog || 0) * 2), label: 'Arrancando toco', tool: tool.id };
  },
  hit(game, wk) {
    const o = wk.it.o;
    o.shake = 1; o.flash = 0.5; o.prog = wk.hits / wk.need;
    game.juice.chips(o.x, o.y - 0.1, [0.55, 0.4, 0.25], 5, 0.35);
    game.audio?.play('chop', { x: o.x, y: o.y, volume: 0.8 });
  },
  finish(game, wk) {
    const o = wk.it.o;
    dropLoot(game, o.x, o.y - 0.1, 'wood', 1, 0.6);
    game.juice.puff(o.x, o.y, 6, [0.6, 0.5, 0.38], 0.6);
    game.stumps.delete(o);
    removeNatural(game, o);
    gainXp(game, 2);
    return true;
  },
});

registerWork('boulder', {
  valid: (g, it) => !it.o.gone,
  start(game, it) {
    const tool = bestTool(game.player, 'mine');
    if (!tool) return needTool(game, 'mine');
    const { need, cycle } = hitsFor((2.2 + it.o.s * 2.2) / tool.speed, 2);
    return { type: 'mine', cycle, need, hits: Math.floor((it.o.prog || 0) * need), label: 'Quebrando pedra', tool: tool.id };
  },
  hit(game, wk) {
    const o = wk.it.o, J = game.juice;
    o.flash = 0.8; o.shake = 1; o.prog = wk.hits / wk.need;
    J.chips(o.x, o.y, [0.62, 0.6, 0.57], 7, 0.35);
    J.puff(o.x, o.y, 3, [0.7, 0.68, 0.64], 0.4);
    game.audio?.play('mine', { x: o.x, y: o.y });
    touch(game, o);
  },
  finish(game, wk) {
    const o = wk.it.o, J = game.juice;
    const n = Math.max(2, Math.round(2 + o.s * 2 + Math.random()));
    for (let k = 0; k < n; k++) dropLoot(game, o.x, o.y - 0.1, 'stone');
    if (Math.random() < 0.5) dropLoot(game, o.x, o.y - 0.1, 'pebble');
    J.puff(o.x, o.y, 10, [0.7, 0.68, 0.64], 0.8);
    J.chips(o.x, o.y, [0.62, 0.6, 0.57], 12, 0.3);
    game.juice.shake(0.15);
    removeNatural(game, o);
    gainXp(game, 6);
    return true;
  },
});

function giveDirect(game, o, id, qty) {
  const p = game.player;
  const left = p.inv.add(id, qty);
  if (qty - left > 0) { game.events.emit('loot', { item: id, qty: qty - left }); game.events.emit('inventory', {}); }
  if (left) for (let k = 0; k < left; k++) dropLoot(game, o.x, o.y, id, 1, 0.4);
}

registerWork('pick', {
  valid: (g, it) => !it.o.gone,
  start: () => ({ type: 'pick', cycle: 0.55, need: 1, label: 'Pegando', instantHit: true }),
  finish(game, wk) {
    const o = wk.it.o;
    const item = PICK[o.type].item;
    giveDirect(game, o, item, (o.s || 1) > 1.05 && Math.random() < 0.5 ? 2 : 1);
    game.audio?.play('pickup', { x: o.x, y: o.y });
    game.juice.puff(o.x, o.y, 3, [0.62, 0.56, 0.46], 0.35);
    removeNatural(game, o);
    gainXp(game, 1);
    return true;
  },
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
  finish(game, wk) {
    const o = wk.it.o, J = game.juice, p = game.player;
    const drop = (id, n) => { for (let k = 0; k < n; k++) dropLoot(game, o.x, o.y - 0.2, id, 1, 0.6); };
    const knife = !!bestTool(p, 'fiber');
    switch (o.type) {
      case 'fibergrass': drop('fiber', ri(2, 3) + (knife ? 1 : 0)); break;
      case 'bush': drop('fiber', ri(2, 3) + (knife ? 1 : 0)); drop('stick', 1); break;
      case 'berrybush': drop('berries', ri(2, 4)); drop('stick', 1); break;
      case 'wild_potato': drop('potato', ri(1, 2)); drop('seed_potato', ri(1, 2)); break;
      case 'wild_corn': drop('corn', ri(1, 2)); drop('seed_corn', ri(1, 2)); break;
      case 'wild_cotton': drop('cotton', ri(2, 3)); drop('seed_cotton', 1); break;
    }
    J.leaves(o.x, o.y, 5, 0.5);
    game.audio?.play('pickup', { x: o.x, y: o.y });
    removeNatural(game, o);
    gainXp(game, 2);
    return true;
  },
});

// ---------- system ----------
export function gatheringSystem() {
  let slowT = 0;
  return {
    update(game, dt) {
      const p = game.player;
      game.stumps ||= new Set();
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

      // shaking objects decay
      game.shaking = game.shaking || new Set();
      if (p.work?.it?.o) game.shaking.add(p.work.it.o);
      for (const o of game.shaking) {
        if (o.shake > 0) o.shake = Math.max(0, o.shake - dt * 3.5);
        if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 5);
        if (!(o.shake > 0) && !(o.flash > 0) && o !== p.work?.it?.o) game.shaking.delete(o);
      }

      // falling trees
      for (let i = game.falling.length - 1; i >= 0; i--) {
        const o = game.falling[i];
        const before = o.fall;
        o.fall += dt * (o.fall < 1 ? 0.6 + o.fall * 1.6 : 1.4);
        const dir = o.fallDir || o.f || 1;
        if (before < 1 && o.fall >= 1) {
          const fx = o.x + dir * 1.6 * o.s;
          game.juice.leaves(fx, o.y, 12, 0.4);
          game.juice.puff(fx, o.y, 8, [0.6, 0.55, 0.45], 0.9);
          game.juice.shake(0.2);
          const [a, b] = TREE_WOOD[o.type] || [3, 4];
          const n = ri(a, b);
          for (let k = 0; k < n; k++) dropLoot(game, o.x + dir * (0.6 + (k / n) * 1.6) * o.s, o.y + (Math.random() - 0.5) * 0.3, 'wood', 1, 0.4);
          if (Math.random() < 0.6) dropLoot(game, o.x + dir * 1.2 * o.s, o.y, 'stick', 1, 0.5);
        }
        if (o.fall >= 1.5) {
          o.fall = 0; o.stump = true; o.prog = 0; o.alpha = 1;
          o.stumpAt = game.worldTime;
          game.stumps.add(o); touch(game, o);
          game.falling.splice(i, 1);
          game.events.emit('tile', { tx: Math.floor(o.x), ty: Math.floor(o.y) });
        }
      }

      // stumps rot away after a few days (never while on screen)
      slowT -= dt;
      if (slowT <= 0) {
        slowT = 5;
        const now = game.worldTime, v = game.view();
        for (const o of game.stumps) {
          if (o.gone || !o.stump) { game.stumps.delete(o); continue; }
          if (now - (o.stumpAt || now) < STUMP_DECAY) continue;
          if (o.x > v.x0 - 2 && o.x < v.x1 + 2 && o.y > v.y0 - 2 && o.y < v.y1 + 3) continue;
          game.stumps.delete(o);
          removeNatural(game, o);
        }
      }
    },
  };
}

export const itemName = (id) => ITEMS[id]?.name || id;
