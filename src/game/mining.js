// Mining like RimWorld: designate rock tiles (mode "Minerar" or tapping rock), marked with an overlay;
// the work loop (work.js) mines the reachable ones nearest-first. Time depends on the pickaxe tier,
// rock hardness (world.rockType) and the ore; ore needs a minimum pickaxe tier (CONTENT §1/§7).
// Yields stone + ore item; world.mineRock() turns the tile into rough stone floor (roof stays: World).

import { registerWork, hitsFor, needToolMsg } from './gathering.js';
import { bestTool } from './equipment.js';
import { ORE_ITEM as ORE_ITEM_DB, ORE_MIN_TIER, ORE_NAME_PT, TIER_PT_F } from './content/items.js';
import * as WG from '../world/worldgen.js';
const ORE_ITEM = WG.ORE_ITEM || ORE_ITEM_DB; // world ore code -> item id (CONTENT §7)
import { dropLoot } from './loot.js';
import { gainXp } from './player.js';
import { updateMasksAround } from './autotile.js';

const HARD = [1.1, 1.4, 1.0, 1.15, 1.25];        // by world.rockType (1 granite .. 4 marble)
const ORE_HARD = [1, 1.2, 1.35, 1.15, 1.5, 1.6];  // by world.ore
const BASE = 3.4;                                  // s with a primitive pickaxe on limestone
const ROCK_COL = [[0.6, 0.58, 0.55], [0.62, 0.6, 0.58], [0.76, 0.72, 0.62], [0.42, 0.44, 0.48], [0.86, 0.85, 0.82]];
const ORE_COL = [null, [0.95, 0.55, 0.25], [0.6, 0.45, 0.38], [0.15, 0.15, 0.16], [1, 0.85, 0.3], [0.35, 0.85, 0.55]];
const MAX_MARKS = 600;

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function initMining(game) {
  game.mining = { marks: new Set(), mode: false, blocked: new Map(), anchor: null, end: null, v: 0 };
  game.minedSet = new Set();
}

export const isRock = (game, tx, ty) => game.world.inBounds(tx, ty) && game.world.rock[game.world.idx(tx, ty)] === 1;

// set / clear / toggle a designation. Returns the new state, or null when (tx,ty) is not rock.
export function designate(game, tx, ty, on = null) {
  if (!isRock(game, tx, ty)) return null;
  const M = game.mining, i = game.world.idx(tx, ty);
  const want = on == null ? !M.marks.has(i) : on;
  if (want) { if (M.marks.size >= MAX_MARKS) { game.events.emit('error', { text: 'Fila de mineração cheia' }); return false; } M.marks.add(i); }
  else { M.marks.delete(i); M.blocked.delete(i); }
  M.v++;
  return want;
}

export function designateRect(game, x0, y0, x1, y1, on) {
  let n = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    if (designate(game, x, y, on) != null) n++;
  }
  return n;
}

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

// descriptor used by taps / contextual button (only for designatable rock)
export function describeRock(game, tx, ty) {
  if (!isRock(game, tx, ty) || !mineable(game, tx, ty)) return null;
  const it = rockIt(game, tx, ty);
  if (game.mining.marks.has(game.world.idx(tx, ty))) it.verb = 'Minerar';
  return it;
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
  valid: (g, it) => {
    const i = g.world.idx(it.tx, it.ty);
    return g.world.rock[i] === 1 && g.mining.marks.has(i);
  },
  start(game, it) {
    const w = game.world, i = w.idx(it.tx, it.ty);
    if (!game.mining.marks.has(i)) designate(game, it.tx, it.ty, true);
    const prob = pickaxeProblem(game, i);
    if (prob) {
      game.events.emit('error', { text: prob });
      game.mining.blocked.set(i, game.worldTime + 25);
      return null;
    }
    const tool = bestTool(game.player, 'mine');
    const total = BASE * (HARD[w.rockType[i]] || 1) * (ORE_HARD[w.ore[i]] || 1) / tool.speed;
    const { need, cycle } = hitsFor(total, 2);
    return { type: 'mine', cycle, need, hits: Math.floor((game.rockHits.get(i) || 0) * need), label: w.ore[i] ? `Minerando ${ORE_NAME_PT[w.ore[i]]}` : 'Minerando', tool: tool.id };
  },
  hit(game, wk) {
    const p = game.player, it = wk.it, w = game.world, i = w.idx(it.tx, it.ty), J = game.juice;
    game.rockHits.set(i, wk.hits / wk.need);
    const col = ROCK_COL[w.rockType[i]] || ROCK_COL[0];
    const cx = Math.max(it.tx, Math.min(it.tx + 1, p.x)), cy = Math.max(it.ty, Math.min(it.ty + 1, p.y));
    J.chips(cx, cy, col, 7, 0.5);
    if (w.ore[i]) J.chips(cx, cy, ORE_COL[w.ore[i]] || [1, 0.75, 0.3], 3, 0.5);
    J.puff(cx, cy, 2, col, 0.4);
    game.audio?.play('mine', { x: cx, y: cy });
  },
  finish(game, wk) {
    const it = wk.it, w = game.world, i = w.idx(it.tx, it.ty);
    const ore = w.ore[i];
    const col = ROCK_COL[w.rockType[i]] || ROCK_COL[0];
    if (!w.mineRock(it.tx, it.ty)) return true;
    game.mining.marks.delete(i); game.mining.blocked.delete(i); game.mining.v++;
    game.minedTiles.push(i); game.minedSet.add(i);
    game.rockHits.delete(i);
    const cx = it.tx + 0.5, cy = it.ty + 0.6;
    const n = ri(1, 2) + (Math.random() < 0.25 ? 1 : 0);
    for (let k = 0; k < n; k++) dropLoot(game, cx, cy, 'stone');
    const oreItem = ORE_ITEM[ore];
    if (oreItem) {
      const m = ore >= 4 ? 1 : ri(1, 2);
      for (let k = 0; k < m; k++) dropLoot(game, cx, cy, oreItem);
      const h = game.ctl?.hinted;
      if (h && !h['ore' + ore]) { h['ore' + ore] = true; game.events.emit('toast', { text: `Veio de ${ORE_NAME_PT[ore]}!`, kind: 'good' }); }
    }
    game.juice.puff(cx, cy, 12, col, 1.0);
    game.juice.shake(0.2);
    gainXp(game, ore ? 8 : 4);
    updateMasksAround(game, it.tx, it.ty);
    game.events.emit('tile', { tx: it.tx, ty: it.ty });
    return true;
  },
});

// nearest reachable designation (for the work queue)
export function nearestMark(game, x, y, maxD = 40) {
  const M = game.mining, w = game.world;
  let best = null, bd = maxD;
  for (const i of M.marks) {
    if ((M.blocked.get(i) || 0) > game.worldTime) continue;
    const tx = i % w.W, ty = (i / w.W) | 0;
    const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
    if (d >= bd || !w.rock[i]) continue;
    if (!mineable(game, tx, ty)) continue;
    bd = d; best = [tx, ty, i];
  }
  return best;
}

export function miningSystem() {
  let cleanT = 0;
  return {
    update(game, dt) {
      cleanT -= dt;
      if (cleanT <= 0) {
        cleanT = 3;
        const w = game.world;
        for (const i of game.mining.marks) if (!w.rock[i]) game.mining.marks.delete(i);
      }
    },
    render(game, B, v) {
      const M = game.mining, A = game.A;
      if (!M.marks.size && !M.mode) return;
      const ring = A.has('fx_ring') ? A.get('fx_ring') : null;
      const pick = A.has('icon_mine') ? A.get('icon_mine') : A.has('tool_pickaxe') ? A.get('tool_pickaxe') : null;
      const w = game.world, t = game.time;
      const now = game.worldTime;
      const cur = game.player.work?.it?.kind === 'rock' ? game.player.work.it : null;
      for (const i of M.marks) {
        const tx = i % w.W, ty = (i / w.W) | 0;
        if (tx + 1 < v.x0 || tx > v.x1 || ty + 1 < v.y0 || ty > v.y1 + 1) continue;
        const blocked = (M.blocked.get(i) || 0) > now;
        const [r, g, b] = blocked ? [1, 0.4, 0.35] : [1, 0.86, 0.35];
        const active = cur && cur.tx === tx && cur.ty === ty;
        const pulse = active ? 0.8 + 0.2 * Math.sin(t * 9) : 0.85;
        if (ring) B.fx.add(ring, tx + 0.5, ty + 0.62, 0.95 * pulse, 0.62 * pulse, r, g, b, 0.75);
        if (pick) B.fx.add(pick, tx + 0.5, ty + 0.72, 0.5, 0.5, r, g, b, 0.9, 0, -0.5, 0, 1, 0, 0.12);
      }
      // drag preview (desktop rectangle)
      if (M.mode && M.anchor && M.end && ring) {
        const [ax, ay] = M.anchor, [ex, ey] = M.end;
        for (let y = Math.min(ay, ey); y <= Math.max(ay, ey); y++) for (let x = Math.min(ax, ex); x <= Math.max(ax, ex); x++) {
          if (!isRock(game, x, y)) continue;
          B.fx.add(ring, x + 0.5, y + 0.62, 0.8, 0.5, 0.6, 0.9, 1, 0.6);
        }
      }
    },
  };
}
