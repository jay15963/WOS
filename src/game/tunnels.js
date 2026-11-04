// Tunnels dug into the relief (docs/TERRAIN-HEIGHT.md "Túneis"), the players' side. Shared state: world.tun (the floor
// per tunnel tile, mut/tunnels.js). Derived here on every peer:
//   - bodies in a tunnel: e._tn (their floor, physics.js tunTrack) kept for everyone this peer sees (the movers keep their
//     own); e._th = how far a body stands above / below the ground the GPU shows under it (its sprite / depth lift);
// and for the local view (cosmetic):
//   - reveal: the tunnel the local player is in (its cave region, game/roofs.js caves, eased like a cave ceiling), its
//     mouths (always: a dark notch in the face) and, at a mouth, the first tiles in (peek) show their FLOOR: the GPU
//     height there is lowered to the floor (renderer post hooks: hgt / hgtG / hgtC / hgtK), so the relief opens over it
//     — a dark gallery (the cave channel's darkness only where it is shown) with walls of rock, the player at the floor,
//     the cutout around it as anywhere. Elsewhere the surface stays as it was (walkable on top).
//   - hidden: a body in a tunnel nobody can see into is not drawn (labels, picking, aim: roofs.hidden(x, y, e)).
// The tool: "Cavar túnel" (pickaxe) on the face of the relief in front of the player, from its floor (work 'tunnel').

import { registerWork, hitsFor, needToolMsg } from './gathering.js';
import { bestTool } from './equipment.js';
import { tunTrack } from './physics.js';
import { canTunnel, T_HEAD } from './mut/tunnels.js';
import { rockHitFx } from './mut/tiles.js';
import { onRockHit } from '../fx/rockfx.js';
import { groundOf } from '../world/height.js';
import { G } from '../world/worldgen.js';

const XM = 16383, PWS = 14;
const PEEK = 2.6;  // a body at a mouth sees this far in (tiles)

export function installTunnels(game) {
  const T = {
    k: new Map(),      // tile → reveal 0..1 (the floor shown) — only tunnel tiles with k > 0
    mouth: new Set(),  // tunnel tiles open to the outside at their floor
    v: -1, mv: -1,
    // the ground the GPU shows at a point (the floor where a tunnel is revealed) — picking, labels, lifts
    viewH(x, y) {
      const w = game.world, h = w.heightAt(x, y);
      if (!this.k.size) return h;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!w.inBounds(tx, ty)) return h;
      const i = w.idx(tx, ty), k = this.k.get(i);
      if (!k) return h;
      const f = w.tun.get(i);
      return h + (Math.min(h, f) - h) * k;
    },
    // hidden from the local view: a body in a tunnel not shown (e), or a thing lying in one (no e: loot, lights)
    hidden(x, y, e) {
      const w = game.world;
      if (!w.tunnels.size) return false;
      if (e && e.isEntity !== false && (e.x != null)) { if (e._tn == null || e === game.player) return false; }
      const tx = Math.floor(x), ty = Math.floor(y - 0.05);
      if (!w.inBounds(tx, ty)) return false;
      const i = w.idx(tx, ty);
      if (!(w.tun.get(i) > -Infinity)) return false;
      return (this.k.get(i) || 0) < 0.5;
    },
    // GPU post hook (renderer → terrainWindow._fill): the channels of a tile rect, after they were computed
    post(name, x0, y0, tw, th, data) { post(game, T, name, x0, y0, tw, th, data); },
  };
  game.tunnels = T;
  if (game.R) game.R.tunnelPost = (n, x0, y0, tw, th, d) => T.post(n, x0, y0, tw, th, d);
  return T;
}

// ---------- the tool: dig a tunnel into the face in front of the player ----------
// the tile the local player would tunnel into at (tx, ty) (null when it cannot)
export function describeTunnel(game, tx, ty, near = false) {
  const p = game.player, w = game.world;
  if (!w.hasHeight || p.dead || p.lv > 0 || p.z > 0 || w.rock.get(w.idx(tx, ty))) return null; // (rock: describeRock — the host tunnels it)
  const f = groundOf(p);
  if (canTunnel(game, tx, ty, f)) return null;
  if (near && Math.abs(Math.floor(p.x) - tx) + Math.abs(Math.floor(p.y) - ty) !== 1) return null;
  if (!near && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) > 6) return null;
  return { kind: 'tunnel', tx, ty, x: tx + 0.5, y: ty + 0.5, verb: 'Cavar túnel', icon: 'pickaxe', prio: bestTool(p, 'mine') ? 0 : -1, tile: true, reach: 0.55 };
}

registerWork('tunnel', {
  valid: (g, it) => !g.world.isTunnel(it.tx, it.ty),
  start(game, it) {
    const p = game.player, w = game.world, tool = bestTool(p, 'mine');
    if (!tool) { game.events.emit('error', { text: needToolMsg('mine') }); return null; }
    if (Math.abs(Math.floor(p.x) - it.tx) + Math.abs(Math.floor(p.y) - it.ty) !== 1) { game.events.emit('error', { text: 'Cave de frente para a parede' }); return null; }
    const why = canTunnel(game, it.tx, it.ty, groundOf(p));
    if (why) { game.events.emit('error', { text: why === 'low' ? 'Baixo demais para um túnel' : 'Não dá para cavar um túnel aqui' }); return null; }
    const g = w.groundAt(it.tx, it.ty), rocky = w.tileSlope(it.tx, it.ty) > 1.1 || g === G.STONE || g === G.GRAVEL;
    const i = w.idx(it.tx, it.ty);
    const { need, cycle } = hitsFor((rocky ? 4.2 : 3) / tool.speed, 3);
    return { type: 'mine', cycle, need, hits: Math.floor((game.rockHits.get(i) || 0) * need), label: 'Cavando túnel', tool: tool.id };
  },
  hit(game, wk) {
    const p = game.player, it = wk.it;
    rockHitFx(game, it.tx, it.ty, p.x, p.y);
    onRockHit(game, game.world.idx(it.tx, it.ty), p.x, p.y);
    game.net.request('tunnel.hit', { tx: it.tx, ty: it.ty, inc: +(1 / wk.need).toFixed(4) }, { onReject: (why) => why && game.events.emit('error', { text: why }) });
  },
  finish(game, wk) {
    game.net.request('tunnel.hit', { tx: wk.it.tx, ty: wk.it.ty, final: true }, { onReject: (why) => why && game.events.emit('error', { text: why }) });
    return true;
  },
});

// ---------- the system ----------
export function tunnelsSystem() {
  return {
    sync: 'all', // e._tn of every body this peer sees (bodies' level: physics / drawing); the reveal is local (cosmetic)
    update(game, dt) {
      const w = game.world, T = game.tunnels || installTunnels(game);
      if (game.R && !game.R.tunnelPost) game.R.tunnelPost = (n, x0, y0, tw, th, d) => T.post(n, x0, y0, tw, th, d);
      if (!w.tunnels.size) {
        if (T.k.size) { const d = rectOf(w, T.k.keys()); T.k.clear(); T.mouth.clear(); invalidate(game, d); }
        for (const e of game.entities) if (e._tn != null || e._th) { e._tn = null; e._th = 0; }
        return;
      }
      for (const e of game.entities) tunTrack(w, e);
      if (T.mv !== w.tunV) { T.mv = w.tunV; mouths(game, T); }
      reveal(game, T, dt);
      // lifts: the body's ground above / below the one the GPU shows under it
      for (const e of game.entities) {
        let th = 0;
        if (e._tn != null || T.k.size) { const vh = T.viewH(e.x, e.y); th = (e._tn != null ? e._tn : w.heightAt(e.x, e.y)) - vh; if (Math.abs(th) < 0.02) th = 0; }
        if (e._th !== th) e._th = th;
      }
    },
  };
}

// tunnel tiles open to the outside at their floor (a 4-neighbour of open ground at the floor's height)
function mouths(game, T) {
  const w = game.world;
  T.mouth.clear();
  for (const [i, f] of w.tunnels) {
    const x = i & XM, y = i >>> PWS;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny) || w.isTunnel(nx, ny)) continue;
      const j = w.idx(nx, ny);
      if (w.rock.get(j) || w.water.get(j) === 2 || w.isCliff(nx, ny)) continue;
      if (w.height.tileMin(nx, ny) <= f + 0.7) { T.mouth.add(i); break; }
    }
  }
}

// reveal per tunnel tile: its cave region's (the one the local player is in, eased by game/roofs.js), its mouths, and
// the peek of a body at the floor's height within PEEK tiles
function reveal(game, T, dt) {
  const w = game.world, R = game.roofs, p = game.player;
  const pf = p && !p.dead ? groundOf(p) : null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ch = false;
  for (const [i, f] of w.tunnels) {
    const x = i & XM, y = i >>> PWS;
    let k = 0;
    const g = R?.caves.get(R.caveOf.get(i));
    if (g) k = g.reveal * g.reveal * (3 - 2 * g.reveal);
    if (T.mouth.has(i)) k = 1;
    if (pf != null && k < 1 && Math.abs(pf - f) <= 0.7) {
      const d = Math.hypot(w.dx(x + 0.5, p.x), y + 0.5 - p.y);
      if (d < PEEK + 1) k = Math.max(k, Math.min(1, (PEEK + 1 - d) / 1.2));
    }
    k = Math.round(k * 32) / 32;
    const o = T.k.get(i) || 0;
    if (k === o) continue;
    if (k > 0) T.k.set(i, k); else T.k.delete(i);
    ch = true;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  for (const i of [...T.k.keys()]) if (!w.tunnels.has(i)) { T.k.delete(i); ch = true; const x = i & XM, y = i >>> PWS; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (ch) invalidate(game, [x0, y0, x1, y1]);
}
function rectOf(w, keys) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const i of keys) { const x = i & XM, y = i >>> PWS; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
function invalidate(game, d) {
  if (!d || d[2] < d[0] || game.headless) return;
  game.R?.win?.invalidate(d[0] - 1, d[1] - 1, d[2] + 1, d[3] + 1, ['hgt', 'hgtG', 'hgtC', 'hgtK', 'cave']);
}

// ---------- GPU: the shown floor (renderer channel post hooks) ----------
const SUBH = 4;
function post(game, T, name, x0, y0, tw, th, data) {
  const w = game.world;
  if (!w.tunnels.size) return;
  const L = w.height;
  // a revealed tile (tx, ty) of the rect: lx, ly = its place in the rect (the planet wraps: the rect's x may be unwrapped)
  const inRect = (tx, ty, m) => { const lx = w.dx(tx, x0); return lx >= -m && lx < tw + m && ty - y0 >= -m && ty - y0 < th + m ? lx : null; };
  if (name === 'cave') { // darkness only where the floor is shown (the surface above a tunnel is daylight)
    for (const [i] of w.tunnels) {
      const tx = i & XM, ty = i >>> PWS, lx = inRect(tx, ty, 0);
      if (lx == null) continue;
      const k = T.k.get(i) || 0, o = ((ty - y0) * tw + lx) * 4;
      data[o] = Math.round(data[o] * k); data[o + 3] = Math.round(data[o + 3] * k);
    }
    return;
  }
  if (!T.k.size) return;
  // the shown height of a fine sample (global indices): lowered toward the floor of the revealed tiles holding it
  const disp = (gi, gj) => {
    let h = L.fs(gi, gj), m = h;
    const ax = Math.floor(gi / SUBH), ay = Math.floor(gj / SUBH), ex = gi - ax * SUBH === 0, ey = gj - ay * SUBH === 0;
    for (let a = 0; a <= (ex ? 1 : 0); a++) for (let b = 0; b <= (ey ? 1 : 0); b++) {
      const tx = ax - a, ty = ay - b;
      if (ty < 0 || ty >= w.H) continue;
      const i = w.idx(tx, ty), k = T.k.get(i);
      if (!k) continue;
      const f = w.tun.get(i), v = h + (Math.min(h, f) - h) * k;
      if (v < m) m = v;
    }
    return m;
  };
  if (name === 'hgt' || name === 'hgtG') {
    const OW = tw * SUBH, OH = th * SUBH, i0 = x0 * SUBH, j0 = y0 * SUBH, M = name === 'hgtG' ? 1 : 0;
    const done = new Set();
    for (const [i] of T.k) {
      const tx = i & XM, ty = i >>> PWS, lx = inRect(tx, ty, 1);
      if (lx == null) continue;
      const gx0 = (x0 + lx) * SUBH, gy0 = ty * SUBH; // (the tile's first sample, in the rect's frame)
      for (let gj = gy0 - M; gj <= gy0 + SUBH + M; gj++) for (let gi = gx0 - M; gi <= gx0 + SUBH + M; gi++) {
        const li = gi - i0, lj = gj - j0;
        if (li < 0 || lj < 0 || li >= OW || lj >= OH) continue;
        const q = lj * OW + li;
        if (done.has(q)) continue;
        done.add(q);
        const gw = i0 + li; // (unwrapped x of the sample: disp wraps through the store)
        if (name === 'hgt') data[q] = disp(gw, gj);
        else {
          const h = disp(gw, gj), k = SUBH / 2;
          data[q * 4] = toHalf((disp(gw + 1, gj) - disp(gw - 1, gj)) * k);
          data[q * 4 + 1] = toHalf((disp(gw, gj + 1) - disp(gw, gj - 1)) * k);
          data[q * 4 + 2] = toHalf(h);
        }
      }
    }
    return;
  }
  if (name === 'hgtC') { // corner heights (the faces' foot / lip)
    for (const [i, k] of T.k) {
      const tx = i & XM, ty = i >>> PWS, lx = inRect(tx, ty, 1), f = w.tun.get(i);
      if (lx == null) continue;
      for (let b = 0; b <= 1; b++) for (let a = 0; a <= 1; a++) {
        const cx = lx + a, cy = ty - y0 + b;
        if (cx < 0 || cy < 0 || cx >= tw || cy >= th) continue;
        const q = cy * tw + cx, h = data[q];
        data[q] = Math.min(h, h + (Math.min(h, f) - h) * k);
      }
    }
    return;
  }
  if (name === 'hgtK') { // the floor: bare rock
    for (const [i, k] of T.k) {
      const tx = i & XM, ty = i >>> PWS, lx = inRect(tx, ty, 0);
      if (lx == null) continue;
      const o = ((ty - y0) * tw + lx) * 4;
      data[o] = Math.max(data[o], Math.round(150 * k)); data[o + 2] = Math.round(data[o + 2] * (1 - k));
    }
  }
}

// float → half float bits (heightPaged.js toHalf, local copy: no import cycle into the world module from here)
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function toHalf(v) {
  _f32[0] = v; const x = _u32[0], sg = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sg; if (e >= 31) return sg | 0x7bff;
  return sg | (e << 10) | ((x >>> 13) & 0x3ff);
}
export { T_HEAD };
