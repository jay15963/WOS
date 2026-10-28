// Gathering: trees (chop -> fall -> stump -> sapling regrow), berry bushes, fiber bushes,
// boulders and mountain rock tiles (mine), campfire cooking. Work loop drives player.action.

import { occAdd, occRemove } from './nav.js';
import { dropLoot } from './loot.js';
import { gainXp } from './player.js';
import { faceTowards } from './combat.js';

export const TREE_SOLID = { tree_oak: 0.2, tree_pine: 0.18, tree_birch: 0.16, tree_dead: 0.16 };
const TREE_HITS = { tree_oak: 5, tree_pine: 4, tree_birch: 4, tree_dead: 3 };
const TREE_WOOD = { tree_oak: [4, 5], tree_pine: [3, 5], tree_birch: [3, 4], tree_dead: [2, 3] };
const ROCK_COL = [[0.6, 0.58, 0.55], [0.62, 0.6, 0.58], [0.76, 0.72, 0.62], [0.42, 0.44, 0.48], [0.86, 0.85, 0.82]];
const STUMP_REGROW = 300, BERRY_REGROW = 180, FIBER_CD = 120, GROW_TIME = 160;

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function touch(game, o) { game.touched.set(o.id, o); }

// Interactable descriptor for a natural world object (or null)
export function describeObject(game, o) {
  const t = o.type;
  if (t.startsWith('tree_')) {
    if (o.stump || o.fall || (o.age ?? 1) < 0.9) return null; // saplings can't be chopped yet
    return { kind: 'tree', o, x: o.x, y: o.y, verb: 'Cortar', icon: 'axe', prio: 2, reach: 0.95 };
  }
  if (t === 'berrybush') return o.empty ? null : { kind: 'berry', o, x: o.x, y: o.y, verb: 'Colher', icon: 'gather', prio: 4, reach: 0.95 };
  if (t === 'bush') return (o.cdUntil || 0) > game.worldTime ? null : { kind: 'bush', o, x: o.x, y: o.y, verb: 'Fibras', icon: 'gather', prio: 1, reach: 0.9 };
  if (t === 'boulder') return { kind: 'boulder', o, x: o.x, y: o.y, verb: 'Minerar', icon: 'pickaxe', prio: 2, reach: 0.75 + o.s * 0.4 };
  return null;
}

export function describeRock(game, tx, ty) {
  const w = game.world;
  if (!w.inBounds(tx, ty) || !w.rock[w.idx(tx, ty)]) return null;
  // only mineable when it borders open ground
  let open = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.inBounds(tx + dx, ty + dy) && !w.rock[w.idx(tx + dx, ty + dy)]) open = true;
  if (!open) return null;
  return { kind: 'rock', tx, ty, x: tx + 0.5, y: ty + 0.5, verb: 'Minerar', icon: 'pickaxe', prio: 1, tile: true, reach: 0.55 };
}

// distance from player to the interactable's contact zone
export function reachDist(p, it) {
  if (it.tile) {
    const cx = Math.max(it.tx, Math.min(it.tx + 1, p.x)), cy = Math.max(it.ty, Math.min(it.ty + 1, p.y));
    return Math.hypot(p.x - cx, p.y - cy) - p.r;
  }
  return Math.hypot(p.x - it.x, p.y - it.y) - p.r;
}

export function startWork(game, it) {
  const p = game.player, o = it.o;
  const err = (text) => { game.events.emit('error', { text }); return false; };
  let w;
  switch (it.kind) {
    case 'tree':
      if ((o.age ?? 1) < 0.9) return err('Ainda está crescendo');
      w = { type: 'chop', cycle: 0.72, need: TREE_HITS[o.type] || 4, hits: o.hits || 0, label: 'Cortando' };
      p.weapon = 'axe';
      break;
    case 'boulder':
      w = { type: 'mine', cycle: 0.85, need: Math.round(3 + o.s * 2), hits: o.hits || 0, label: 'Minerando' };
      p.weapon = 'pickaxe';
      break;
    case 'rock': {
      const i = game.world.idx(it.tx, it.ty);
      w = { type: 'mine', cycle: 0.85, need: 5, hits: game.rockHits.get(i) || 0, label: 'Minerando' };
      p.weapon = 'pickaxe';
      break;
    }
    case 'berry':
      w = { type: 'gather', cycle: 1.3, need: 1, hits: 0, label: 'Colhendo' };
      break;
    case 'bush':
      w = { type: 'gather', cycle: 1.1, need: 1, hits: 0, label: 'Colhendo fibras' };
      break;
    case 'cook':
      if (!p.inv.count('meat')) return err('Sem carne crua para assar');
      w = { type: 'gather', cycle: 2.0, need: 1, hits: 0, label: 'Assando carne', loop: true };
      break;
    default: return false;
  }
  p.autoAttack = false;
  p.work = { ...w, it, t: 0, hitDone: false, k: w.hits / w.need };
  p.action = { type: w.type, t: 0 };
  return true;
}

function hit(game, wk) {
  const p = game.player, it = wk.it, o = it.o, J = game.juice;
  switch (it.kind) {
    case 'tree':
      o.shake = 1; o.hits = (o.hits || 0) + 1;
      J.leaves(o.x, o.y, 4, 1.8 * o.s);
      J.chips(o.x - (o.x - p.x) * 0.3, o.y, [0.62, 0.45, 0.28], 4, 0.4);
      game.audio?.play('chop', { x: o.x, y: o.y });
      break;
    case 'boulder':
      o.flash = 0.8; o.shake = 1; o.hits = (o.hits || 0) + 1;
      J.chips(o.x, o.y, [0.62, 0.6, 0.57], 7, 0.35);
      J.puff(o.x, o.y, 3, [0.7, 0.68, 0.64], 0.4);
      game.audio?.play('mine', { x: o.x, y: o.y });
      break;
    case 'rock': {
      const w = game.world, i = w.idx(it.tx, it.ty);
      game.rockHits.set(i, (game.rockHits.get(i) || 0) + 1);
      const col = ROCK_COL[w.rockType[i]] || ROCK_COL[0];
      const cx = Math.max(it.tx, Math.min(it.tx + 1, p.x)), cy = Math.max(it.ty, Math.min(it.ty + 1, p.y));
      J.chips(cx, cy, col, 7, 0.5);
      if (w.ore[i]) J.chips(cx, cy, [1, 0.75, 0.3], 3, 0.5);
      J.puff(cx, cy, 2, col, 0.4);
      game.audio?.play('mine', { x: cx, y: cy });
      break;
    }
    default: break;
  }
  touchIt(game, it);
}

function touchIt(game, it) { if (it.o) touch(game, it.o); }

function finish(game, wk) {
  const p = game.player, it = wk.it, o = it.o, J = game.juice;
  switch (it.kind) {
    case 'tree':
      o.fall = 0.001;
      occRemove(game, o);
      game.falling.push(o);
      game.audio?.play('chop', { x: o.x, y: o.y, volume: 1.2 });
      gainXp(game, 6);
      return true;
    case 'boulder': {
      const n = ri(3, 4);
      for (let k = 0; k < n; k++) dropLoot(game, o.x, o.y - 0.1, 'stone');
      if (Math.random() < 0.12) dropLoot(game, o.x, o.y, 'ore');
      J.puff(o.x, o.y, 10, [0.7, 0.68, 0.64], 0.8);
      J.chips(o.x, o.y, [0.62, 0.6, 0.57], 12, 0.3);
      game.juice.shake(0.15);
      occRemove(game, o);
      game.world.removeObject(o);
      o.gone = true;
      touch(game, o);
      gainXp(game, 6);
      game.events.emit('tile', { tx: Math.floor(o.x), ty: Math.floor(o.y) });
      return true;
    }
    case 'rock': {
      const w = game.world, i = w.idx(it.tx, it.ty);
      const ore = w.ore[i];
      const col = ROCK_COL[w.rockType[i]] || ROCK_COL[0];
      if (w.mineRock(it.tx, it.ty)) {
        game.minedTiles.push(i);
        game.rockHits.delete(i);
        const cx = it.tx + 0.5, cy = it.ty + 0.6;
        const n = ri(2, 3);
        for (let k = 0; k < n; k++) dropLoot(game, cx, cy, 'stone');
        if (ore) { const m = ri(1, 2); for (let k = 0; k < m; k++) dropLoot(game, cx, cy, 'ore'); game.events.emit('toast', { text: 'Veio de minério!', kind: 'good' }); }
        J.puff(cx, cy, 12, col, 1.0);
        game.juice.shake(0.25);
        gainXp(game, 5);
        game.events.emit('tile', { tx: it.tx, ty: it.ty });
      }
      return true;
    }
    case 'berry': {
      o.empty = true; o.shake = 1; o.regrowAt = game.worldTime + BERRY_REGROW;
      game.regrow.add(o); touch(game, o);
      const n = ri(2, 4);
      for (let k = 0; k < n; k++) dropLoot(game, o.x, o.y - 0.2, 'berries', 1, 0.6);
      J.leaves(o.x, o.y, 3, 0.5);
      game.audio?.play('pickup', { x: o.x, y: o.y });
      gainXp(game, 2);
      return true;
    }
    case 'bush': {
      o.shake = 1; o.cdUntil = game.worldTime + FIBER_CD; touch(game, o);
      const n = ri(1, 2);
      for (let k = 0; k < n; k++) dropLoot(game, o.x, o.y - 0.2, 'fiber', 1, 0.6);
      J.leaves(o.x, o.y, 4, 0.5);
      gainXp(game, 1);
      return true;
    }
    case 'cook': {
      if (p.inv.remove('meat', 1)) {
        const left = p.inv.add('cooked', 1);
        if (left) dropLoot(game, p.x, p.y, 'cooked');
        game.events.emit('loot', { item: 'cooked', qty: 1 });
        game.events.emit('inventory', {});
        game.audio?.play('fire', { x: o.x, y: o.y });
        J.puff(o.x, o.y - 0.2, 4, [0.5, 0.5, 0.5], 0.6);
        gainXp(game, 3);
      }
      wk.hits = 0;
      return p.inv.count('meat') === 0;
    }
  }
  return true;
}

export function gatheringSystem() {
  let slowT = 0;
  return {
    update(game, dt) {
      const p = game.player;
      const wk = p.work;
      if (wk && !p.dead) {
        const it = wk.it;
        // validity
        const valid = it.kind === 'rock' ? !!game.world.rock[game.world.idx(it.tx, it.ty)]
          : it.o && !it.o.gone && !it.o.stump && !it.o.fall && !(it.kind === 'berry' && it.o.empty);
        if (!valid || reachDist(p, it) > it.reach + 0.45) { p.work = null; p.action = null; }
        else {
          faceTowards(p, { x: it.tx != null ? it.tx + 0.5 : it.x, y: it.ty != null ? it.ty + 0.5 : it.y });
          wk.t += dt / wk.cycle;
          if (wk.type !== 'gather' && !wk.hitDone && wk.t >= 0.55) {
            wk.hitDone = true;
            wk.hits++;
            hit(game, wk);
          }
          if (wk.t >= 1) {
            if (wk.type === 'gather') wk.hits++;
            wk.t = 0; wk.hitDone = false;
            if (wk.hits >= wk.need) {
              const done = finish(game, wk);
              if (done || !wk.loop) { p.work = null; p.action = null; p.workDoneT = 0; }
            }
          }
          if (p.work) {
            p.action = p.action || { type: wk.type, t: 0 };
            p.action.type = wk.type; p.action.t = wk.type === 'gather' ? 0 : wk.t;
            wk.k = Math.min(1, (wk.hits + (wk.type === 'gather' ? wk.t : 0)) / wk.need);
            if (it.kind === 'cook') wk.label = `Assando carne (${p.inv.count('meat')})`;
          }
        }
      }
      if (!p.work && p.weapon !== 'sword') {
        p.workDoneT = (p.workDoneT || 0) + dt;
        if (p.workDoneT > 1.5 || p.autoAttack) { p.weapon = 'sword'; p.workDoneT = 0; }
      }

      // shaking objects decay
      game.shaking = game.shaking || new Set();
      if (wk?.it?.o) game.shaking.add(wk.it.o);
      for (const o of game.shaking) {
        if (o.shake > 0) o.shake = Math.max(0, o.shake - dt * 3.5);
        if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 5);
        if (!(o.shake > 0) && !(o.flash > 0) && o !== wk?.it?.o) game.shaking.delete(o);
      }

      // falling trees
      for (let i = game.falling.length - 1; i >= 0; i--) {
        const o = game.falling[i];
        const before = o.fall;
        o.fall += dt * (o.fall < 1 ? 0.6 + o.fall * 1.6 : 1.4);
        if (before < 1 && o.fall >= 1) {
          // impact
          const fx = o.x + o.f * 1.6 * o.s;
          game.juice.leaves(fx, o.y, 12, 0.4);
          game.juice.puff(fx, o.y, 8, [0.6, 0.55, 0.45], 0.9);
          game.juice.shake(0.2);
          const [a, b] = TREE_WOOD[o.type] || [3, 4];
          const n = ri(a, b);
          for (let k = 0; k < n; k++) dropLoot(game, o.x + o.f * (0.6 + (k / n) * 1.6) * o.s, o.y + (Math.random() - 0.5) * 0.3, 'wood', 1, 0.4);
        }
        if (o.fall >= 1.5) {
          o.fall = 0; o.stump = true; o.hits = 0;
          o.regrowAt = game.worldTime + STUMP_REGROW;
          game.regrow.add(o); touch(game, o);
          game.falling.splice(i, 1);
        }
      }

      // regrowth (slow tick)
      slowT -= dt;
      if (slowT <= 0) {
        const step = 1 - slowT; slowT = 1;
        const now = game.worldTime;
        for (const o of game.regrow) {
          if (o.stump && now >= o.regrowAt) {
            o.stump = false; o.age = 0.25; o.solid = 0; touch(game, o);
          } else if (!o.stump && o.type.startsWith('tree_') && (o.age ?? 1) < 1) {
            o.age = Math.min(1, o.age + step / GROW_TIME);
            if (o.age >= 0.6 && !o.solid) {
              const p2 = game.player;
              if (Math.hypot(p2.x - o.x, p2.y - o.y) > 0.8) { o.solid = TREE_SOLID[o.type] || 0.18; occAdd(game, o); }
            }
            if (o.age >= 1) game.regrow.delete(o);
          } else if (o.type === 'berrybush' && o.empty && now >= o.regrowAt) {
            o.empty = false; game.regrow.delete(o); touch(game, o);
          } else if (!o.stump && !o.empty && (o.age ?? 1) >= 1) game.regrow.delete(o);
        }
      }
    },
  };
}
