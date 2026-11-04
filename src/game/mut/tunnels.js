// Tunnels dug into the relief (docs/TERRAIN-HEIGHT.md "Túneis"): world.tun = the floor height per tunnel tile.
// Intent: tunnel.hit {tx, ty, inc?, final?}  a pickaxe hit on the face of the relief next to the actor (progress: op
//         rock.prog, as for rock); the final hit digs the tile (op tunnel.dig) when it still fits. The HOST decides the
//         floor: the ground the actor stands on (the floor of its tunnel inside one). A rock tile mined from the floor of a
//         relief a story above it becomes a tunnel too (mut/tiles.js rock.hit → tunnelRock).
// Op:     tunnel.dig {tx, ty, f: floor × 100, drops?, by, xp?}  every peer digs it (world.digTunnel; a rock tile is mined
//         too: mineTile, no cut); then the support rule: tunnel tiles left without solid relief within TUN_SUPPORT cave
//         in (an open cut down to the floor: world.lastLost; dust and rubble; the host hurts who stands there).
// Snapshot / save: data.tun = [tileIdx, floor × 100, …] (serializeTunnels / applyTunnels): set before the mined tiles.

import { defineIntent, defineOp } from '../../net/registry.js';
import { G } from '../../world/worldgen.js';
import { addLootRows } from './loot.js';
import { lootRows, ri } from './roll.js';
import { mineTile, rockHitFx, ROCK_COL } from './tiles.js';
import { hurtUnder } from './roofs.js';
import { collapseFx, onRockMined } from '../roofs.js';
import { groundOf } from '../../world/height.js';
import { ORE_ITEM as ORE_ITEM_DB } from '../content/items.js';
import * as WG from '../../world/worldgen.js';

export const T_HEAD = 1.0;   // relief needed above the floor (stories, the tile's highest corner)
export const T_REACH = 2.2;  // the actor's centre to the tile (tiles)
const ORE_ITEM = WG.ORE_ITEM || ORE_ITEM_DB;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// can tile (tx, ty) be dug into a tunnel with its floor at f? null = yes, else the reason (WHY key)
export function canTunnel(game, tx, ty, f) {
  const w = game.world, L = w.height;
  if (!L.any || !w.inBounds(tx, ty) || !Number.isFinite(f)) return 'flat';
  const i = w.idx(tx, ty);
  if (w.tun.get(i) > -Infinity) return 'done';
  if (w.water.get(i)) return 'water';
  if (w.solid.get(i)) return 'build';
  for (let k = 0; k < 4; k++) if (L.plotH(tx + (k & 1), ty + (k >> 1)) > -Infinity) return 'build';
  if (L.tileMax(tx, ty) < f + T_HEAD) return 'low';
  if (L.tileMin(tx, ty) < f - 0.35) return 'below';
  if (w.query(tx + 0.5, ty + 0.5, 0.75, (o) => o.solid && !o.stump && Math.floor(o.x) === tx && Math.floor(o.y - 0.05) === ty).length) return 'tree';
  return null;
}
export const TUN_WHY = {
  flat: 'Aqui não há relevo para cavar um túnel',
  done: 'Já é túnel',
  water: 'Água: não dá para cavar aqui',
  build: 'Tem construção aqui',
  low: 'Baixo demais para um túnel: use Cavar (pá) para abrir um corte',
  below: 'O chão ali é mais baixo que você',
  tree: 'Tire a árvore / pedra de cima primeiro',
  far: 'Chegue mais perto da parede',
  side: 'Cave de frente: o túnel segue pelos lados do quadrado',
};
// the actor (an entity) is next to the tile: its own tile is a 4-neighbour of it, its centre close enough
export function besideTile(e, tx, ty) {
  const ax = Math.floor(e.x), ay = Math.floor(e.y);
  if (Math.abs(ax - tx) + Math.abs(ay - ty) !== 1) return false;
  const cx = Math.max(tx, Math.min(tx + 1, e.x)), cy = Math.max(ty, Math.min(ty + 1, e.y));
  return Math.hypot(e.x - cx, e.y - cy) <= T_REACH - 0.5;
}

// every peer: dig the tile (+ the rock of a rock tile), the support rule, the cave-in fx
export function digTunnelTile(game, tx, ty, f, fx = true) {
  const w = game.world, i = w.idx(tx, ty), wasRock = w.rock.get(i) === 1;
  w.digTunnel(tx, ty, f, false);
  if (wasRock) mineTile(game, tx, ty, fx); // (world.mineRock: no cut under a tunnel)
  else onRockMined(game, tx, ty);          // (the caves / indoor light around: game/roofs.js)
  w.lastLost = w.tunSupport(tx, ty);
  const lost = w.lastLost;
  if (lost.length) {
    game.terrainV = (game.terrainV || 0) + 1;
    for (const j of lost) game.roofs?.caveDirty.add(j);
    if (fx) {
      const tiles = lost.map((j) => { const c = ROCK_COL[w.rockType.get(j)] || ROCK_COL[0]; return [j % w.W, (j / w.W) | 0, [c[0] * 0.8, c[1] * 0.74, c[2] * 0.68]]; });
      const c = collapseFx(game, tiles, { big: lost.length > 6, cave: true, quiet: lost.length < 2 });
      if (c && Math.hypot(game.cam.x - c[0], game.cam.y - c[1]) < 26) game.events.emit('toast', { text: 'Desabamento! O teto do túnel caiu: largo demais sem apoio', kind: 'warn' });
    }
  }
  game.events.emit('tile', { tx, ty });
  game.events.emit('tunnel', { tx, ty, f });
  return true;
}

// host: the drops of a tunnel tile dug from the face (rock: stone + its ore; steep rock face / stony ground: stone;
// else earth)
function tunnelDrops(game, net, tx, ty) {
  const w = game.world, i = w.idx(tx, ty), rows = [], cx = tx + 0.5, cy = ty + 0.5;
  if (w.rock.get(i)) {
    lootRows(net, rows, cx, cy, 'stone', ri(net, 1, 2) + (net.roll() < 0.25 ? 1 : 0));
    const ore = w.ore.get(i), it = ORE_ITEM[ore];
    if (it) lootRows(net, rows, cx, cy, it, ore >= 4 ? 1 : ri(net, 1, 2));
    return rows;
  }
  const g = w.groundAt(tx, ty), rocky = w.height.tileSlope(tx, ty) > 1.1 || g === G.STONE || g === G.GRAVEL;
  if (rocky) lootRows(net, rows, cx, cy, 'stone', ri(net, 1, 2));
  else { lootRows(net, rows, cx, cy, 'dirt', ri(net, 1, 2)); if (net.roll() < 0.4) lootRows(net, rows, cx, cy, 'stone', 1); }
  return rows;
}

// host: the actor's floor (its tunnel's floor inside one, else the ground under it), hundredths
const floorOf = (e) => Math.round(groundOf(e) * 100) / 100;

// host: the final hit on a rock tile (mut/tiles.js rock.hit) digs a tunnel when the relief over it is a story above the
// miner's floor — returns true when it emitted tunnel.dig
export function tunnelRock(game, net, actor, tx, ty, xp) {
  const e = actor.ent, w = game.world;
  if (!e || !w.hasHeight || !besideTile(e, tx, ty)) return false;
  const f = floorOf(e);
  if (canTunnel(game, tx, ty, f)) return false;
  net.emit('tunnel.dig', { tx, ty, f: Math.round(f * 100), drops: tunnelDrops(game, net, tx, ty), by: actor.pid, xp });
  hurtLost(game);
  return true;
}
function hurtLost(game) {
  const w = game.world, lost = w.lastLost;
  if (lost.length) hurtUnder(game, lost.map((j) => [j % w.W, (j / w.W) | 0]), 6);
}

defineOp('tunnel.dig', {
  doc: 'A tile is dug into a tunnel under the relief (floor f/100); tiles left without support cave in.',
  args: { tx: 'int', ty: 'int', f: 'floor×100', drops: 'lootRows?', by: 'pid', xp: 'number?' },
  apply(game, a, ctx) {
    const w = game.world;
    if (!w.inBounds(a.tx, a.ty) || !Number.isFinite(a.f)) return;
    const i = w.idx(a.tx, a.ty), col = ROCK_COL[w.rockType.get(i)] || ROCK_COL[0];
    digTunnelTile(game, a.tx, a.ty, a.f / 100, true);
    game.juice?.puff?.(a.tx + 0.5, a.ty + 0.6, 10, col, 0.9);
    if (ctx.mine) game.juice?.shake?.(0.15);
    game.audio?.play('mine', { x: a.tx + 0.5, y: a.ty + 0.5 });
    addLootRows(game, a.drops);
  },
});

defineIntent('tunnel.hit', {
  doc: 'A pickaxe hit digging a tunnel into the relief next to the actor (inc = 1/need) or the final hit.',
  args: { tx: 'int', ty: 'int', inc: 'number?', final: 'bool?' },
  run(game, a, actor, net) {
    const w = game.world, tx = num(a.tx) | 0, ty = num(a.ty) | 0, e = actor.ent;
    if (!w.inBounds(tx, ty)) return 'Fora do mapa';
    if (!e) return 'Sem jogador';
    if (!besideTile(e, tx, ty)) return TUN_WHY.far;
    const f = floorOf(e), why = canTunnel(game, tx, ty, f);
    if (why) return TUN_WHY[why] || 'Não dá para cavar aqui';
    const i = w.idx(tx, ty), prog = game.rockHits.get(i) || 0;
    if (!a.final) {
      const inc = Math.max(0, Math.min(1, num(a.inc)));
      net.emit('rock.prog', { i, p: +Math.min(0.999, prog + inc).toFixed(3), by: actor.pid, x: +e.x.toFixed(2), y: +e.y.toFixed(2) });
      return;
    }
    if (prog < 0.85) return 'Ainda não terminou';
    net.emit('tunnel.dig', { tx, ty, f: Math.round(f * 100), drops: tunnelDrops(game, net, tx, ty), by: actor.pid, xp: 5 });
    game.rockHits.delete(i);
    hurtLost(game);
  },
});

// ---------- snapshot / save ----------
export function serializeTunnels(game) {
  const out = [];
  for (const i of [...game.world.tunnels.keys()].sort((a, b) => a - b)) out.push(i, Math.round(game.world.tunnels.get(i) * 100));
  return out;
}
// list [tileIdx, f × 100, …]; reconcile: tunnels not in the list are filled back (a resync)
export function applyTunnels(game, list, reconcile) {
  const w = game.world, want = new Map();
  if (Array.isArray(list)) for (let k = 0; k + 1 < list.length; k += 2) if (Number.isInteger(list[k]) && Number.isFinite(list[k + 1])) want.set(list[k], list[k + 1] / 100);
  let n = 0;
  if (reconcile) for (const i of [...w.tunnels.keys()]) if (!want.has(i)) { w.fillTunnel(i & 16383, i >>> 14); n++; }
  for (const [i, f] of want) {
    if (w.tunnels.get(i) === f) continue;
    const tx = i & 16383, ty = i >>> 14;
    if (w.wrap) w.ensure(w.chunkIndex(tx, ty));
    w.digTunnel(tx, ty, f, false);
    game.roofs?.caveDirty.add(i);
    n++;
  }
  if (n) game.roofs && (game.roofs.caveAll = true);
  return n;
}
