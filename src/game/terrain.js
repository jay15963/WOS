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

// ---------- owner: walking uphill is slower ----------
const _g = [0, 0];
export function slopeSpeed(game, e, mx, my) {
  const L = game.world.height;
  if (!L.any || !(mx || my) || e.lv > 0) return 1;
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
