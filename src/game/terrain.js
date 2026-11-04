// Terrain height, the player's side (docs/TERRAIN-HEIGHT.md). Shared state: the terrain edits (mut/terrain.js ops,
// world/height.js `t`) and each building's base height `o.bz` (mut/structures.js baseFor, snapshot `bzs`).
// Derived on every peer (this system): the PLOTS — every building that sits on a pad lifts the corners of its footprint
// to its base (world/height.js setPlots), so floors, furniture, people and items in a house on a slope stand on one
// level, and the ground around it becomes an embankment / a masonry face (the terrain shader paints it).
// The tool: build mode { kind: 'terrain', tool: TERRAIN_TOOL, m: 'dig' | 'fill' | 'flat' | 'smooth', h (flat target) }
// from the build window's "Terreno" tab — click / tap applies the brush at the cursor, holding the button keeps
// applying it (one request every ~0.22 s), right click / Esc leaves. Needs a pickaxe (creative: free and instant);
// filling spends 1 dirt per scoop (paid before the request, refunded on a refusal).
// Owner (local player): walking uphill is slower (slopeSpeed).

import { ON_PAD, dimsOf } from './mut/structures.js';
import { exitBuildMode } from './building.js';
import { bestTool } from './equipment.js';
import { needToolMsg } from './gathering.js';
import { T_R, T_REACH } from './mut/terrain.js';
import { collides } from './physics.js';

export const TERRAIN_MODES = {
  dig: { name: 'Cavar', desc: 'Abaixa o chão sob o cursor (dá terra; pedra na rocha).' },
  fill: { name: 'Aterrar', desc: 'Levanta o chão sob o cursor (gasta 1 terra por vez).' },
  flat: { name: 'Aplanar', desc: 'Deixa o chão na altura do primeiro ponto clicado.' },
  smooth: { name: 'Suavizar', desc: 'Arredonda degraus e buracos.' },
};

// ---------- plots: the pads buildings stand on (derived from the replicated structures) ----------
function rebuildPlots(game) {
  const L = game.world.height, map = new Map(); // (corner index: L.ci — the planet store, docs/STREAMING.md)
  for (const o of game.build.structures) {
    if (!Number.isFinite(o.bz) || o.lv > 0 || !ON_PAD(o.type)) continue;
    const [fw, fh] = dimsOf(o.type, o.rot | 0);
    for (let y = o.ty; y <= o.ty + fh; y++) for (let x = o.tx; x <= o.tx + fw; x++) {
      if (y < 0 || y >= L.H) continue;
      const i = L.ci(x, y), v = map.get(i);
      if (v == null || o.bz > v) map.set(i, o.bz);
    }
  }
  L.setPlots(map);
}

// ---------- the tool ----------
export function enterTerrainMode(game, m) {
  const p = game.player;
  if (p.dead || !TERRAIN_MODES[m] || !game.world.hasHeight) return false;
  game.build.mode = { kind: 'terrain', tool: TERRAIN_TOOL, m, h: null, hold: false, t: 0, at: null };
  game.events.emit('buildui', {});
  game.events.emit('toast', { text: `${TERRAIN_MODES[m].name}: ${game.input.isTouch ? 'toque no chão' : 'clique ou segure no chão · Esc sai'}`, kind: 'info' });
  return true;
}
function apply(game, wx, wy) {
  const m = game.build.mode, p = game.player;
  if (!m || m.kind !== 'terrain') return false;
  if (!game.creative && !bestTool(p, 'mine')) { game.events.emit('error', { text: needToolMsg('mine') }); return false; }
  if (Math.hypot(wx - p.x, wy - p.y) > T_REACH) { game.events.emit('error', { text: 'Longe demais' }); return false; }
  if (m.m === 'flat' && m.h == null) m.h = Math.round(game.world.heightAt(wx, wy) * 4) / 4; // the first point sets the level
  let refund = null;
  if (m.m === 'fill' && !game.creative) {
    if (p.inv.count('dirt') < 1) { game.events.emit('error', { text: 'Precisa de terra (cave com Cavar)' }); return false; }
    p.inv.remove('dirt', 1); refund = { dirt: 1 }; game.events.emit('inventory', {});
  }
  const args = { m: m.m, x: Math.round(wx * 100) / 100, y: Math.round(wy * 100) / 100 };
  if (m.m === 'flat') args.h = m.h;
  game.net.request('terrain.edit', args, { refund, onReject: (why) => why && game.events.emit('error', { text: why }) });
  game.juice?.puff?.(wx, wy, 3, m.m === 'fill' ? [0.5, 0.4, 0.3] : [0.56, 0.46, 0.34], 0.4);
  game.audio?.play(m.m === 'fill' ? 'path_dirt' : 'dig', { x: wx, y: wy, volume: 0.7 });
  if (p.facing) { const dx = wx - p.x, dy = wy - p.y; p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n'); }
  p.action = { type: 'mine', t: 0 };
  return true;
}
export const TERRAIN_TOOL = {
  dragStart(game, wx, wy) { const m = game.build.mode; m.hold = true; m.at = [wx, wy]; m.t = 0.22; apply(game, wx, wy); },
  dragMove(game, wx, wy) { const m = game.build.mode; if (m.hold) m.at = [wx, wy]; },
  dragEnd(game) { const m = game.build.mode; m.hold = false; return true; },
  tap(game, wx, wy) { return apply(game, wx, wy); },
  cancel(game) { exitBuildMode(game); },
};

// ---------- jumping down a small drop (docs/TERRAIN-HEIGHT.md "Pular barrancos") ----------
// A body pushing into the edge of a cliff whose foot is at most DROP_MAX lower hops down to the ground past the face: a
// short arc (up a little, then down, ~0.4 s), no damage. Never up, never a bigger drop (refused: the player is stopped at
// the edge as before — no fall damage to manage, no way to get stuck below by accident in a pit deeper than a story).
// The local player hops after ~0.15 s of pushing (levels.js hopUpdate moves it: p._hop {terrain}); creatures on the
// host hop when their path / chase runs over the edge (ai.js go → hopStep; nav.js plans these one-way drops).
// e._jh: the hop's height over the ground under it (cosmetic: game.js lifts the sprite).
export const DROP_MIN = 0.3, DROP_MAX = 1.3;
export function dropAhead(game, e, ux, uy) {
  const w = game.world, L = w.height;
  if (!L.any || e._tn != null || e.lv > 0 || e.z > 0 || e._hop || e._boat) return null;
  const l = Math.hypot(ux, uy);
  if (l < 1e-3) return null;
  ux /= l; uy /= l;
  const r = e.r || 0.25, ax = e.x + ux * (r + 0.15), ay = e.y + uy * (r + 0.15);
  if (!w.isCliff(Math.floor(ax), Math.floor(ay))) return null;
  const h0 = L.heightAt(e.x, e.y);
  for (const d of [0.75, 1.0, 1.3, 1.6, 1.9]) {
    const lx = e.x + ux * (r + d), ly = e.y + uy * (r + d), tx = Math.floor(lx), ty = Math.floor(ly);
    if (!w.inBounds(tx, ty)) return null;
    if (w.isCliff(tx, ty)) continue; // (still on the face)
    if (w.blocked(tx, ty) || w.waterAt(tx, ty) === 2) return null;
    const h1 = L.heightAt(lx, ly), drop = h0 - h1;
    if (drop < DROP_MIN || drop > DROP_MAX) return null;
    if (collides(w, lx, ly, r, null, !!e.passDoors)) return null;
    // the way over: only the face (no rock, wall or deep water)
    for (let s = 0.3; s < r + d; s += 0.3) {
      const x = Math.floor(e.x + ux * s), y = Math.floor(e.y + uy * s), i = w.idx(x, y);
      if (w.rock.get(i) || w.solid.get(i) || w.water.get(i) === 2) return null;
    }
    return { x1: lx, y1: ly, h0, h1 };
  }
  return null;
}
// start a hop of e to the landing d (dropAhead)
export function startHop(game, e, d, dur = 0.42) {
  e._hop = { x0: e.x, y0: e.y, x1: d.x1, y1: d.y1, t: 0, dur, terrain: true, h0: d.h0, h1: d.h1 };
  e._jh = 0;
  game.audio?.play('jump', { x: e.x, y: e.y, volume: 0.45 });
}
// a creature's hop (the local player's runs in levels.js hopUpdate); true while hopping
export function hopStep(game, e, dt) {
  const h = e._hop;
  if (!h || !h.terrain) return false;
  h.t += dt;
  const k = Math.min(1, h.t / h.dur), q = k * (2 - k);
  e.x = h.x0 + (h.x1 - h.x0) * q; e.y = h.y0 + (h.y1 - h.y0) * q;
  e.moving = true;
  hopLift(game, e);
  if (k >= 1) landHop(game, e);
  return true;
}
// the arc: up ~0.25 story, then down to the landing; _jh = above the ground under the body now
function hopLift(game, e) {
  const h = e._hop, k = Math.min(1, h.t / h.dur);
  const y = h.h0 + (h.h1 - h.h0) * k * k + 1.0 * k * (1 - k) * 0.6;
  e._jh = Math.max(0, y - game.world.heightAt(e.x, e.y));
}
function landHop(game, e) {
  e._hop = null; e._jh = 0;
  game.juice?.puff?.(e.x, e.y, 4, [0.6, 0.52, 0.42], 0.4);
  game.audio?.play('step', { x: e.x, y: e.y, volume: 0.7 });
}
// owner: the local player pushing into a small drop hops down
function playerHop(game, dt) {
  const p = game.player, h = p._hop;
  if (h && h.terrain) {
    if (h.t >= h.dur - 1e-6) { landHop(game, p); return; } // (levels.js hopUpdate moved it; it clears _hop at the end)
    hopLift(game, p);
    return;
  }
  if (p._jh) { p._jh = 0; if (!h) game.juice?.puff?.(p.x, p.y, 4, [0.6, 0.52, 0.42], 0.4); }
  if (p.dead || p.rooted || p._boat || p.work || game.build?.mode) { p._tpush = 0; return; }
  const mv = game.input?.move ? game.input.move() : null;
  let mx = mv ? mv[0] : 0, my = mv ? mv[1] : 0;
  if (mx || my) [mx, my] = game.toWorldDir(mx, my);
  else if (p.autoMove) [mx, my] = p.autoMove;
  const moved = p._tlx == null ? 1 : Math.hypot(p.x - p._tlx, p.y - p._tly);
  p._tlx = p.x; p._tly = p.y;
  if (Math.hypot(mx, my) < 0.5 || moved > 0.01) { p._tpush = 0; return; }
  const d = dropAhead(game, p, mx, my);
  if (!d) { p._tpush = 0; return; }
  p._tpush = (p._tpush || 0) + dt;
  if (p._tpush < 0.15) return;
  p._tpush = 0;
  startHop(game, p, d);
  const hint = game.ctl?.hinted;
  if (hint && !hint.drop) { hint.drop = true; game.events.emit('toast', { text: 'Pulou o barranco (só para baixo, até 1 andar)', kind: 'info' }); }
}

// ---------- the shade of the relief on what stands in it (docs/TERRAIN-HEIGHT.md) ----------
// 0 = lit .. ~0.64 = in the shadow of a hill / cliff: the terrain shader's march toward the sun (shaders.js TERRAIN_FS
// "relief shadows") on the CPU, at the waist of a body standing at (x, y) on ground h. game.js darkens its sprites as much
// (creatures every frame; plants and props cached ~1 s).
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function reliefShade(game, x, y, h, env) {
  const L = game.world.height;
  if (!L.any || !env || !(env.shadowStr > 0.01) || (env.sunI ?? 1) < 0.02) return 0;
  const sd = env.shadowDir || [0, 0], sl = Math.max(Math.hypot(sd[0], sd[1]), 0.05), ux = sd[0] / sl, uy = sd[1] / sl;
  const h0 = h + 0.35;
  let ts = 0;
  for (let k = 1; k <= 10 && ts < 1; k++) {
    const t = 0.2 + k * k * 0.18;
    ts = Math.max(ts, smooth(0, 0.4, L.heightAt(x - ux * t, y - uy * t) - (h0 + t / sl)));
  }
  return ts * Math.min(env.shadowStr * 1.15, 0.64);
}

// ---------- walking uphill is slower (owner: the player; host: creatures — ai.js go) ----------
const _g = [0, 0];
export function slopeSpeed(game, e, mx, my) {
  const L = game.world.height;
  if (!L.any || !(mx || my) || e.lv > 0 || e._tn != null) return 1; // (in a tunnel: its floor is flat)
  L.gradAt(e.x, e.y, _g);
  const l = Math.hypot(mx, my), up = (_g[0] * mx + _g[1] * my) / l; // stories gained per tile along the move
  return up > 0 ? Math.max(0.62, 1 - up * 0.55) : Math.min(1.06, 1 - up * 0.08);
}

export function terrainSystem() {
  let bv = -1, tv = -1;
  return {
    sync: 'all', // plots derived from the replicated structures (every peer); the tool and the brush ring are local
    update(game, dt) {
      const w = game.world;
      if (!w.hasHeight) return;
      if (game.build.v !== bv || (game.terrainV || 0) !== tv) { bv = game.build.v; tv = game.terrainV || 0; rebuildPlots(game); }
      playerHop(game, dt); // (the local player: a small drop ahead)
      const m = game.build.mode;
      if (m?.kind !== 'terrain') return;
      if (game.player.dead) { exitBuildMode(game); return; }
      if (game.input.pressed?.has('Escape')) { exitBuildMode(game); return; }
      if (m.hold && m.at && (m.t -= dt) <= 0) { m.t = 0.22; apply(game, m.at[0], m.at[1]); }
    },
    render(game, B) {
      const m = game.build.mode, A = game.A;
      if (m?.kind !== 'terrain' || !A.has('fx_ring')) return;
      const hv = game.ctl?.hover, at = hv ? [hv.wx, hv.wy] : m.at;
      if (!at) return;
      const far = Math.hypot(at[0] - game.player.x, at[1] - game.player.y) > T_REACH;
      const c = far ? [1, 0.4, 0.32] : m.m === 'dig' ? [1, 0.78, 0.45] : m.m === 'fill' ? [0.62, 0.9, 0.5] : m.m === 'flat' ? [0.5, 0.78, 1] : [0.85, 0.75, 1];
      const s = T_R * 2, pulse = 0.85 + 0.15 * Math.sin(game.time * 5);
      B.fx.add(A.get('fx_ring'), at[0], at[1] + 0.08 * s, s, s * 0.66, c[0], c[1], c[2], 0.75 * pulse);
    },
  };
}
