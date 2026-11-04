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
import { T_R, T_REACH, terrainBrush } from './mut/terrain.js';
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

// ---------- the tool: the shovel ("Pá", content/items.js shovel_*) ----------
// Build window → Terreno, or E / Usar with a shovel in the hand (nothing else to use there). While on, a bar shows the
// four modes (ui/terrainbar.js: desktop and touch; R cycles them) and the brush is previewed on the ground: a ring at the
// cursor plus a dot on every corner it would move, at the height it would get (green), or where it is refused (red, the
// reason in the bar). The preview runs the host's own brush (mut/terrain.js terrainBrush) on this peer's world.
export const TERRAIN_ORDER = ['dig', 'fill', 'flat', 'smooth'];
export const shovelOf = (p) => bestTool(p, 'dig');
export function enterTerrainMode(game, m) {
  const p = game.player;
  if (p.dead || !TERRAIN_MODES[m] || !game.world.hasHeight) return false;
  const old = game.build.mode;
  game.build.mode = { kind: 'terrain', tool: TERRAIN_TOOL, m, h: null, hold: false, t: 0, at: null, pv: null };
  game.lastTerrainMode = m;
  game.events.emit('buildui', {});
  if (old?.kind !== 'terrain') game.events.emit('toast', { text: `${TERRAIN_MODES[m].name}: ${game.input.isTouch ? 'toque no chão' : 'clique ou segure no chão · R troca · Esc sai'}`, kind: 'info' });
  if (!game.creative && !shovelOf(p)) game.events.emit('error', { text: SHOVEL_MSG });
  return true;
}
export const SHOVEL_MSG = 'Precisa de uma pá (Criar: Pá de pedra — 2 madeira, 3 pedra, 1 corda)';
export function setTerrainMode(game, m) {
  const md = game.build.mode;
  if (md?.kind !== 'terrain' || !TERRAIN_MODES[m]) return enterTerrainMode(game, m);
  if (md.m !== m) { md.m = m; md.h = null; md.pv = null; game.lastTerrainMode = m; }
  return true;
}
function apply(game, wx, wy) {
  const m = game.build.mode, p = game.player;
  if (!m || m.kind !== 'terrain') return false;
  const tool = shovelOf(p);
  if (!game.creative && !tool) { game.events.emit('error', { text: SHOVEL_MSG }); return false; }
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
  p.action = { type: 'dig', t: 0 };
  m.rate = tool ? 0.22 / Math.sqrt(Math.max(0.5, tool.speed)) : 0.15; // (a better shovel digs a bit faster)
  return true;
}
export const TERRAIN_TOOL = {
  dragStart(game, wx, wy) { const m = game.build.mode; m.hold = true; m.at = [wx, wy]; m.t = m.rate || 0.22; apply(game, wx, wy); },
  dragMove(game, wx, wy) { const m = game.build.mode; if (m.hold) m.at = [wx, wy]; },
  dragEnd(game) { const m = game.build.mode; m.hold = false; return true; },
  tap(game, wx, wy) { return apply(game, wx, wy); },
  cancel(game) { exitBuildMode(game); },
};
// the brush preview at (x, y): { list: [[corner, h]], why, x, y } (cached per spot / mode / terrain version)
export function brushPreview(game, x, y) {
  const m = game.build.mode, w = game.world;
  if (m?.kind !== 'terrain') return null;
  const qx = Math.round(x * 8) / 8, qy = Math.round(y * 8) / 8, h = m.m === 'flat' ? (m.h ?? Math.round(w.heightAt(x, y) * 4) / 4) : 0;
  const pv = m.pv;
  if (pv && pv.x === qx && pv.y === qy && pv.m === m.m && pv.h === h && pv.v === w.height.v && pv.c === !!game.creative) return pv;
  const r = terrainBrush(game, m.m, qx, qy, h, game.creative);
  const far = Math.hypot(qx - game.player.x, qy - game.player.y) > T_REACH;
  const why = far ? 'far' : !game.creative && !shovelOf(game.player) ? 'shovel' : m.m === 'fill' && !game.creative && game.player.inv.count('dirt') < 1 ? 'dirt' : r.list.length ? null : r.why;
  return (m.pv = { x: qx, y: qy, m: m.m, h, v: w.height.v, c: !!game.creative, list: r.list, why, block: r.block || [] });
}
export const PREVIEW_WHY = { far: 'Longe demais', shovel: 'Precisa de uma pá', dirt: 'Precisa de terra (cave com Cavar)', build: 'Construção: o terreno embaixo não muda', water: 'Água: não dá para mexer na margem', rock: 'Rocha: use a picareta', tunnel: 'Túnel perto: o teto dele não muda', deep: 'Fundo demais aqui', high: 'Alto demais aqui', same: 'Já está assim', edge: 'Fora do mapa' };

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
  let bv = -1, tv = -1, bar = null, dec = false;
  return {
    sync: 'all', // plots derived from the replicated structures (every peer); the tool and the brush preview are local
    update(game, dt) {
      const w = game.world;
      if (!w.hasHeight) return;
      if (!dec) { dec = true; const prev = w.onDecor; w.onDecor = (c) => { prev?.(c); hideDugDecor(game, null, c); }; } // (decor made later: chunks streaming back)
      if (game.build.v !== bv || (game.terrainV || 0) !== tv) { bv = game.build.v; tv = game.terrainV || 0; rebuildPlots(game); }
      playerHop(game, dt); // (the local player: a small drop ahead)
      // the shovel's bar (four modes, desktop and touch), loaded lazily like the path bar
      if (!bar && typeof document !== 'undefined' && game.R?.canvas && !game.headless) {
        bar = 1;
        import('../ui/terrainbar.js').then((mod) => { bar = mod.installTerrainbar(game); }).catch((e) => { console.warn('terrainbar', e); bar = 2; });
      }
      if (typeof bar === 'object' && bar) bar.update(dt);
      const m = game.build.mode;
      if (m?.kind !== 'terrain') return;
      if (game.player.dead) { exitBuildMode(game); return; }
      if (game.input.pressed?.has('Escape')) { exitBuildMode(game); return; }
      if (game.input.pressed?.has('KeyR')) setTerrainMode(game, TERRAIN_ORDER[(TERRAIN_ORDER.indexOf(m.m) + 1) % 4]);
      if (m.hold && m.at && (m.t -= dt) <= 0) { m.t = m.rate || 0.22; apply(game, m.at[0], m.at[1]); }
    },
    render(game, B) {
      const m = game.build.mode, A = game.A;
      if (m?.kind !== 'terrain' || !A.has('fx_ring')) return;
      const hv = game.ctl?.hover, at = hv ? [hv.wx, hv.wy] : m.at;
      if (!at) return;
      const pv = brushPreview(game, at[0], at[1]), ok = pv && !pv.why, ring = A.get('fx_ring'), w = game.world, L = w.height;
      // the ring at the cursor: the mode's colour, red when refused
      const c = !ok ? [1, 0.36, 0.3] : m.m === 'dig' ? [1, 0.78, 0.45] : m.m === 'fill' ? [0.62, 0.9, 0.5] : m.m === 'flat' ? [0.5, 0.78, 1] : [0.85, 0.75, 1];
      const s = T_R * 2, pulse = 0.85 + 0.15 * Math.sin(game.time * 5);
      B.fx.add(ring, at[0], at[1] + 0.08 * s, s, s * 0.66, c[0], c[1], c[2], 0.75 * pulse);
      if (!pv) return;
      // a dot on every corner it moves, at the height it gets (green; a faint one where it is now), the refused ones red
      // (overlay: seen through the ground)
      const dot = A.has('fx_spark') ? A.get('fx_spark') : ring, K = 1 / Math.max(0.01, dot.w), ds = 0.3 * K;
      for (const [i, h] of pv.list) {
        const x = w.near(i & 16383, game.cam.x), y = i >>> 14, g0 = L.heightAt(x, y), up = h - g0;
        const k = pv.why ? [1, 0.4, 0.32] : up > 0 ? [0.6, 1, 0.45] : [0.35, 1, 0.55];
        if (Math.abs(up) > 0.04) B.fx.add(dot, x, y, ds * 0.6, ds * 0.6, 1, 1, 1, 0.45); // (where it is now)
        B.fx.add(dot, x, y, ds, ds, k[0], k[1], k[2], 1, 0, 0, 0, 1, 0, up);
      }
      for (const i of pv.block) B.fx.add(dot, w.near(i & 16383, game.cam.x), i >>> 14, ds, ds, 1, 0.3, 0.25, 1);
      // aplanar: the target level as a wide faint ring at that height
      if (m.m === 'flat') { const h = pv.h - L.heightAt(at[0], at[1]); B.fx.add(ring, at[0], at[1] + 0.08 * s, s * 1.15, s * 0.76, 0.5, 0.8, 1, 0.45, 0, 0, 0, 1, 0, h); }
    },
  };
}

// ---------- ground decor on dug / heaped ground (grass, flowers, small stones): gone with the turf ----------
// (cosmetic, every peer: on op terrain.set and when a chunk's decor comes back from the source)
export function hideDugDecor(game, corners, chunk = -1) {
  const w = game.world, L = w.height;
  if (!L.edits.size) return;
  const dug = (x, y) => { for (let k = 0; k < 4; k++) if (L.edits.has(L.ci(x + (k & 1), y + (k >> 1)))) return true; return false; };
  const hideIn = (bk, x0, y0, x1, y1) => { for (const d of bk.decor) if (!d._hid && d.x >= x0 && d.x < x1 && d.y >= y0 && d.y < y1 && dug(Math.floor(d.x), Math.floor(d.y))) d._hid = true; };
  if (corners) { // (the buckets around the corners only: edits may lie far apart on the planet)
    const seen = new Set();
    for (const i of corners) {
      const x = i & 16383, y = i >>> 14;
      for (let k = 0; k < 4; k++) {
        const bk = w.chunkAt(x - (k & 1), y - (k >> 1));
        if (seen.has(bk)) continue;
        seen.add(bk);
        const bx = (bk.k % 1024) * 16, by = Math.floor(bk.k / 1024) * 16;
        hideIn(bk, bx, by, bx + 16, by + 16);
      }
    }
  } else if (chunk >= 0) {
    const X0 = (chunk & 255) * 64, Y0 = (chunk >>> 8) * 64;
    w.forChunks(X0, Y0, X0 + 63, Y0 + 63, (bk) => hideIn(bk, X0, Y0, X0 + 64, Y0 + 64));
  }
}
