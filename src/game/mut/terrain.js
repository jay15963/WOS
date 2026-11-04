// Terrain edits (docs/TERRAIN-HEIGHT.md): the only shared change of the terrain height (world/height.js).
// Op:     terrain.set {p: [cornerIdx, h × 100, …], by?, give?, fx?}  new heights of the changed corners (absolute,
//         hundredths of a story): every peer applies the same numbers, no brush math on the guests.
// Intent: terrain.edit {m, x, y, h?}  m = 'dig' (lower) | 'fill' (raise, the actor paid 1 dirt) | 'flat' (toward h) |
//         'smooth'; (x, y) = the brush centre (world tiles). The host runs the brush (terrainBrush) and refuses with a
//         reason: far away, a building / water / rock under the brush, too deep / too high. Digging gives dirt (stone
//         from steep rock or stony ground) as an owner effect.
// Snapshot / save: data.terr = world.height.diff() ([cornerIdx, h × 100, …] of the corners that differ from the generated
//         terrain — the same compact list the streaming engine stores per chunk); applyTerrain() puts it back.
// Creative (creative.js): instant and free — the same intent, no dirt cost, bigger steps.

import { defineIntent, defineOp } from '../../net/registry.js';
import { G } from '../../world/worldgen.js';
import { hideDugDecor } from '../terrain.js'; // (grass / flowers / small stones go with the turf)

export const T_STEP = 0.25;    // stories moved per action at the brush centre
export const T_R = 1.6;        // brush radius (tiles)
export const T_REACH = 4.5;    // how far from the actor
export const T_DEPTH = 4;      // deepest below / highest above the generated terrain
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the four tiles around a corner: does any hold water / rock / a building?
function cornerBlock(game, ix, iy) {
  const w = game.world, L = w.height;
  if (L.plotH(ix, iy) > -Infinity) return 'build';
  if (w.tunnels.size) for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (w.isTunnel(ix + dx, iy + dy)) return 'tunnel'; // (its ceiling / walls hold the tunnel)
  for (let k = 0; k < 4; k++) {
    const tx = ix - (k & 1), ty = iy - (k >> 1);
    if (!w.inBounds(tx, ty)) return 'edge';
    const i = w.idx(tx, ty);
    if (w.water.get(i)) return 'water';
    if (w.rock.get(i)) return 'rock';
    if (w.solid.get(i) || game.build?.grid && structOn(game, tx, ty)) return 'build';
  }
  return null;
}
function structOn(game, tx, ty) {
  const g = game.build.grid, i = game.world.idx(tx, ty);
  for (const k in g) { const m = g[k]; if (m && m.get && m.get(i)) return true; }
  return false;
}

// the brush (host): new heights of the corners it moves → { list: [[i, h]], why, dug, stone }
export function terrainBrush(game, m, x, y, h, creative = false) {
  const w = game.world, L = w.height; // (corner index: L.ci — the planet store, docs/STREAMING.md)
  const step = T_STEP * (creative ? 2 : 1), out = [];
  let why = null, dug = 0, stone = 0, seen = 0;
  const block = []; // (the corners refused: the brush preview shows them red)
  const R = T_R, ix0 = Math.ceil(x - R), ix1 = Math.floor(x + R), iy0 = Math.ceil(y - R), iy1 = Math.floor(y + R);
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
    const d = Math.hypot(ix - x, iy - y);
    if (d > R || iy < 0 || iy >= L.H || !w.inBounds(Math.min(ix, w.maxX), Math.min(iy, w.maxY))) continue;
    seen++;
    const b = cornerBlock(game, ix, iy);
    if (b) { why ||= b; if (block.length < 40) block.push(L.ci(ix, iy)); continue; }
    const wt = ss(R, 0.45, d), i = L.ci(ix, iy), cur = L.t.get(i), base = L.base.get(i);
    let nh = cur;
    if (m === 'dig') nh = Math.max(cur - step * wt, Math.max(0, base - T_DEPTH));
    else if (m === 'fill') nh = Math.min(cur + step * wt, base + T_DEPTH);
    else if (m === 'flat') { const tgt = Math.max(0, Math.min(base + T_DEPTH, h)); nh = cur + Math.max(-step * 2, Math.min(step * 2, tgt - cur)) * wt; }
    else if (m === 'smooth') {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { s += L.terrainH(ix + dx, iy + dy); n++; }
      nh = cur + (s / n - cur) * 0.55 * wt;
    }
    nh = Math.round(nh * 100) / 100;
    if (Math.abs(nh - cur) < 0.005) continue;
    out.push([i, nh]);
    if (nh < cur) {
      dug += cur - nh;
      // steep rock or stony ground gives stone
      const tx = Math.min(L.W - 1, ix), ty = Math.min(L.H - 1, iy), g = w.groundAt(tx, ty);
      if (L.tileSlope(tx, ty) > 1.1 || g === G.STONE || g === G.GRAVEL) stone += cur - nh;
    }
  }
  if (!out.length) why = !seen ? 'edge' : why || (m === 'dig' ? 'deep' : m === 'fill' ? 'high' : 'same');
  return { list: out, why, dug, stone, block };
}

const WHY = {
  build: 'Tem construção aqui: o terreno embaixo dela não muda',
  water: 'Água: não dá para mexer na margem',
  rock: 'Rocha: use a picareta para minerar',
  tunnel: 'Túnel aqui perto: o teto e as paredes dele não mudam',
  edge: 'Fora do mapa',
  deep: 'Fundo demais aqui',
  high: 'Alto demais aqui',
  same: 'Já está assim',
};

export function applyTerrain(game, list) { // [[i, h]] on every peer (op / snapshot)
  const L = game.world.height;
  if (!L.setTerrain(list)) return false;
  game.terrainV = (game.terrainV || 0) + 1; // (game/terrain.js: plots, nav caches)
  return true;
}

defineOp('terrain.set', {
  doc: 'Terrain corners change height (dig / fill / level / smooth): p = [cornerIdx, h × 100, …] absolute.',
  args: { p: '[cornerIdx, h×100, …]', by: 'pid?', give: '{item: qty}?', m: 'dig|fill|flat|smooth?' },
  apply(game, a, ctx) {
    const p = Array.isArray(a.p) ? a.p : [], list = [];
    for (let k = 0; k + 1 < p.length; k += 2) if (Number.isInteger(p[k]) && Number.isFinite(p[k + 1])) list.push([p[k], p[k + 1] / 100]);
    if (!applyTerrain(game, list) || !list.length) return;
    hideDugDecor(game, list.map((r) => r[0]));
    // feedback where it happened (the actor's client already played it)
    if (ctx.mine) return;
    const i = list[0][0], x = i & 16383, y = i >>> 14; // (corner index: L.ci)
    game.juice?.puff?.(x, y, 4, a.m === 'fill' ? [0.5, 0.4, 0.3] : [0.56, 0.46, 0.34], 0.45);
    game.audio?.play(a.m === 'fill' ? 'path_dirt' : 'dig', { x, y, volume: 0.6 });
  },
});

defineIntent('terrain.edit', {
  doc: 'Shape the terrain with the brush at (x, y): m = dig | fill (the actor paid 1 dirt) | flat (toward h) | smooth.',
  args: { m: 'dig|fill|flat|smooth', x: 'world x', y: 'world y', h: 'flat target (stories)?' },
  run(game, a, actor, net) {
    const w = game.world;
    if (!w.hasHeight) return 'Este mundo não tem relevo';
    const m = a.m, x = num(a.x), y = num(a.y);
    if (!['dig', 'fill', 'flat', 'smooth'].includes(m)) return 'Ferramenta desconhecida';
    if (!(x >= 0 && y >= 0 && x <= w.W && y <= w.H)) return 'Fora do mapa';
    const e = actor.ent;
    if (e && Math.hypot(e.x - x, e.y - y) > T_REACH) return 'Longe demais';
    const r = terrainBrush(game, m, x, y, num(a.h, w.heightAt(x, y)), game.creative);
    if (!r.list.length) return WHY[r.why] || 'Nada para mudar';
    const p = [];
    for (const [i, h] of r.list) p.push(i, Math.round(h * 100));
    const args = { p, by: actor.pid, m };
    if (m === 'dig' && !game.creative) {
      // a little dirt per scoop (stone from rock / stony ground)
      const st = Math.round(r.stone * 2), dirt = Math.max(r.dug > 0.05 ? 1 : 0, Math.round((r.dug - r.stone) * 2));
      const give = {};
      if (dirt > 0) give.dirt = dirt;
      if (st > 0) give.stone = st;
      if (dirt || st) args.give = give;
    }
    net.emit('terrain.set', args);
    return { n: r.list.length };
  },
});
