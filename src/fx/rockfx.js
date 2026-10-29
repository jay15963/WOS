// Rock being mined (cosmetic). The cracks follow the pickaxe: every hit (op rock.prog → game.rockHits, shared, so
// every peer sees the same crack) splits the rock top further, from the middle of the tile out to its edges — a
// better pickaxe needs fewer hits, so its cracks open faster. The last hit (op tile.mine → mut/tiles.js mineTile)
// breaks the block apart along those cracks: the terrain shader keeps drawing it as rock while its chunks drop out
// one by one (~0.3 s), its pieces slump into the hole and dust rises (the puff of tile.mine).
// The terrain shader reads up to 8 tiles near the view (renderer.mine: tx, ty, crack 0..1 or 1 + break progress,
// hit pulse 0..1 for the tremble).

const MAXN = 8;
const BREAK_T = 0.32;

export function initRockFx(game) {
  game.rockFx = { hitT: new Map(), breaking: new Map() };
}

// a hit landed on rock tile i (op applier, or the local swing ahead of the host's reply); (x, y) = the miner
export function onRockHit(game, i, x, y) {
  game.rockFx?.hitT.set(i, { t: game.time, x, y });
}

// rock tile i was mined out (op applier with fx): it breaks apart; col = its rock colour
export function onRockBreak(game, i, col) {
  const F = game.rockFx;
  if (!F) return;
  const h = F.hitT.get(i);
  F.hitT.delete(i);
  F.breaking.set(i, { t: 0, col, fx: h?.x, fy: h?.y, spawned: false });
}

export function rockFxSystem() {
  const tmp = [];
  return {
    sync: 'cosmetic',
    update(game, dt) {
      const F = game.rockFx;
      if (!F) return;
      for (const [i, b] of F.breaking) {
        if (!b.spawned) { b.spawned = true; if (!game.headless) breakFx(game, i, b); }
        b.t += dt;
        if (b.t >= BREAK_T) F.breaking.delete(i);
      }
      if (F.hitT.size > 48) for (const [i, h] of F.hitT) if (game.time - h.t > 20) F.hitT.delete(i);
      const R = game.R;
      if (game.headless || !R?.mine) return;
      const W = game.world.W, v = game.view(), cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
      const inView = (x, y) => x >= v.x0 - 1 && x <= v.x1 + 1 && y >= v.y0 - 1 && y <= v.y1 + 2;
      tmp.length = 0;
      for (const [i, p] of game.rockHits) { const x = i % W, y = (i - x) / W; if (p > 0 && inView(x, y)) tmp.push([x, y, Math.min(0.999, p), i]); }
      for (const [i, b] of F.breaking) { const x = i % W, y = (i - x) / W; if (inView(x, y)) tmp.push([x, y, 1 + Math.min(1, b.t / BREAK_T), i]); }
      if (tmp.length > MAXN) tmp.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      const n = Math.min(MAXN, tmp.length), U = R.mine.u;
      for (let k = 0; k < n; k++) {
        const [x, y, p, i] = tmp[k], h = F.hitT.get(i);
        U[k * 4] = x; U[k * 4 + 1] = y; U[k * 4 + 2] = p;
        U[k * 4 + 3] = h && p < 1 ? Math.max(0, 1 - (game.time - h.t) / 0.2) : 0;
      }
      R.mine.n = n;
    },
  };
}

// the block's pieces slump into the hole it leaves and roll to a stop
function breakFx(game, i, b) {
  const P = game.particles, A = game.A, w = game.world;
  if (!P || !A) return;
  const x = i % w.W, y = (i - x) / w.W, v = game.view?.();
  if (v && (x < v.x0 - 3 || x > v.x1 + 3 || y < v.y0 - 3 || y > v.y1 + 4)) return;
  const name = A.has('fx_rubble') ? 'fx_rubble' : A.has('fx_spark') ? 'fx_spark' : null;
  if (!name) return;
  const col = b.col || [0.6, 0.58, 0.55];
  let dx = 0, dy = 1;
  if (b.fx != null) { dx = b.fx - (x + 0.5); dy = b.fy - (y + 0.5); const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; }
  const K = 1 / Math.max(0.01, A.get(name).w);
  // they slump into the hole it leaves (a heap on the new floor), only a little toward the miner
  for (let j = 0; j < 5; j++) {
    const s = (0.2 + Math.random() * 0.22) * K, sh = 0.85 + Math.random() * 0.25, k = (Math.random() * 3) | 0;
    P.emit({ spr: k && A.has('fx_rubble_' + k) ? 'fx_rubble_' + k : name, x: x + 0.2 + Math.random() * 0.6, y: y + 0.15 + Math.random() * 0.45,
      lift: 0.25 + Math.random() * 0.45, vlift: 0.3 + Math.random() * 0.9, grav: 11, bounce: 0.25,
      vx: dx * 0.3 + (Math.random() - 0.5) * 0.7, vy: dy * 0.2 + (Math.random() - 0.5) * 0.35, drag: 2.2,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9, life: 0.9 + Math.random() * 0.4, hold: 0.55,
      size: s, size1: s * 0.85, r: col[0] * sh, g: col[1] * sh, b: col[2] * sh, a: 1, a1: 0 });
  }
}
