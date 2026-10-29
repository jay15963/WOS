// Mining is a DIRECT action: stand next to a rock tile that has an open side and use it (interact button /
// E / a tap) with a pickaxe. There are no designations or mining jobs (owner's rule: no automatic mining).
// Time depends on the pickaxe tier, rock hardness (world.rockType) and the ore; ore needs a minimum pickaxe
// tier (CONTENT §1/§7). Yields stone + ore item; world.mineRock() turns the tile into rough stone floor.
// Multiplayer: progress and the mined tile are host ops (mut/tiles.js, intent rock.hit).

import { registerWork, hitsFor, needToolMsg } from './gathering.js';
import { bestTool } from './equipment.js';
import { ORE_MIN_TIER, ORE_NAME_PT, TIER_PT_F } from './content/items.js';
import { rockHitFx } from './mut/tiles.js';

const HARD = [1.1, 1.4, 1.0, 1.15, 1.25];        // by world.rockType (1 granite .. 4 marble)
const ORE_HARD = [1, 1.2, 1.35, 1.15, 1.5, 1.6];  // by world.ore
const BASE = 3.4;                                  // s with a primitive pickaxe on limestone

export function initMining(game) {
  game.mining = { mode: false }; // (mode stays false: other modules still read it)
  game.minedSet = new Set();
}

export const isRock = (game, tx, ty) => game.world.inBounds(tx, ty) && game.world.rock[game.world.idx(tx, ty)] === 1;

// an open, walkable 4-neighbour to stand on
export function mineable(game, tx, ty) {
  const w = game.world;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = tx + dx, y = ty + dy;
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (!w.rock[i] && w.water[i] !== 2 && w.solid[i] !== 1) return true;
  }
  return false;
}

export function rockIt(game, tx, ty) {
  return { kind: 'rock', tx, ty, x: tx + 0.5, y: ty + 0.5, verb: 'Minerar', icon: 'pickaxe', prio: 1, tile: true, reach: 0.55 };
}

// descriptor used by taps / the contextual button (rock with an open side)
export function describeRock(game, tx, ty) {
  if (!isRock(game, tx, ty) || !mineable(game, tx, ty)) return null;
  return rockIt(game, tx, ty);
}

// pickaxe check for an ore tile -> error text or null
export function pickaxeProblem(game, i) {
  const tool = bestTool(game.player, 'mine');
  if (!tool) return needToolMsg('mine');
  const ore = game.world.ore[i];
  const min = ORE_MIN_TIER[ore] || 0;
  if (tool.tier < min) return `Precisa de picareta ${TIER_PT_F[min]} ou melhor para ${ORE_NAME_PT[ore]}`;
  return null;
}

registerWork('rock', {
  valid: (g, it) => g.world.rock[g.world.idx(it.tx, it.ty)] === 1,
  start(game, it) {
    const w = game.world, i = w.idx(it.tx, it.ty);
    const prob = pickaxeProblem(game, i);
    if (prob) { game.events.emit('error', { text: prob }); return null; }
    const tool = bestTool(game.player, 'mine');
    const total = BASE * (HARD[w.rockType[i]] || 1) * (ORE_HARD[w.ore[i]] || 1) / tool.speed;
    const { need, cycle } = hitsFor(total, 2);
    return { type: 'mine', cycle, need, hits: Math.floor((game.rockHits.get(i) || 0) * need), label: w.ore[i] ? `Minerando ${ORE_NAME_PT[w.ore[i]]}` : 'Minerando', tool: tool.id };
  },
  // feedback now, progress and the mined tile on the host (mut/tiles.js)
  hit(game, wk) {
    const p = game.player, it = wk.it;
    rockHitFx(game, it.tx, it.ty, p.x, p.y);
    game.net.request('rock.hit', { tx: it.tx, ty: it.ty, inc: +(1 / wk.need).toFixed(4) });
  },
  finish(game, wk) {
    game.net.request('rock.hit', { tx: wk.it.tx, ty: wk.it.ty, final: true });
    return true;
  },
});
