// Building: placement modes (single / line / rectangle outline / filled area) with connected ghost
// previews, blueprints built over time by the player (action 'build', o.progress 0→1, non-blocking until
// done), deconstruction (refund 75%), doors / gates (world.solid = 2, o.open 0..1), structure use
// (chest, bed, crafting stations), floor speed bonus.
// Multiplayer: this module is the player's side (modes, preview, work loop, UI). Every change to the
// shared structures goes through the host: intents build.place / build.hit / build.decon / decon.hit and
// the ops of mut/structures.js (placeStructure, completeStructure, removeStructure live there).
//
// Structure object: { id, type, v, tx, ty, x, y (base), s, f, building, layer, flat?, progress, blueprint?,
//   mask (autotile), orient ('h'|'v' doors), open (doors), working (stations), store (chest), light, fire }
// 1×1: x = tx + 0.5, y = ty + 1 · w×h: x = tx + w/2, y = ty + h. Round props collide at (x, cy).

import { BUILDINGS, ITEMS } from './data.js';
import { buildSprite } from './artcompat.js';
import { registerWork, hitsFor } from './gathering.js';
import { initGrids, computeMask, structureAt, DIRS4 } from './autotile.js';
import * as CW from '../art/composeWorld.js';
import { placeReason, objectsOnTile, CLEARABLE, defOf, REFUND, MAX_TILES } from './mut/structures.js';

export { placeStructure, completeStructure, removeStructure, placeReason, defOf, REFUND } from './mut/structures.js';

const FRONT = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };

export function initBuilding(game) {
  game.build = { mode: null, structures: [], doors: [], decon: new Set(), v: 0 };
  initGrids(game);
}

export function frontTile(p) {
  const [fx, fy] = FRONT[p.facing] || FRONT.s;
  return [Math.floor(p.x + fx * 0.9), Math.floor(p.y - 0.1 + fy * 0.9)];
}

// tiles for a drag from (ax, ay) to (bx, by)
function dragTiles(kind, ax, ay, bx, by) {
  const out = [];
  if (kind === 'area') {
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push([x, y]);
  } else if (ax !== bx && ay !== by) {
    // rectangle outline (a room)
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    for (let x = x0; x <= x1; x++) { out.push([x, y0]); out.push([x, y1]); }
    for (let y = y0 + 1; y < y1; y++) { out.push([x0, y]); out.push([x1, y]); }
  } else {
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    const sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    for (let k = 0; k <= n; k++) out.push([ax + sx * k, ay + sy * k]);
  }
  return out.slice(0, MAX_TILES);
}

// ---------- build mode ----------
export function enterBuildMode(game, type) {
  const p = game.player;
  if (p.dead) return;
  const def = BUILDINGS[type];
  if (!def) return;
  if (!p.inv.has(def.cost)) { game.events.emit('error', { text: 'Materiais insuficientes' }); return; }
  game.mining && (game.mining.mode = false);
  const [tx, ty] = frontTile(p);
  game.build.mode = { kind: 'place', type, hover: [tx, ty], anchor: null, end: null, locked: false, tiles: [], valid: false, reason: null, n: 0 };
  game.events.emit('buildui', {});
  const h = game.ctl?.hinted;
  if (def.drag && h && !h['drag_' + def.drag]) {
    h['drag_' + def.drag] = true;
    const touch = game.input.isTouch;
    game.events.emit('toast', {
      text: def.drag === 'line'
        ? (touch ? 'Toque no início e no fim: linha reta, ou na diagonal para uma sala' : 'Arraste para uma linha; na diagonal faz uma sala')
        : (touch ? 'Toque em dois cantos para cobrir uma área' : 'Arraste para cobrir uma área'),
      kind: 'info',
    });
  }
}

export function enterDeconMode(game) {
  if (game.player.dead) return;
  game.mining && (game.mining.mode = false);
  game.build.mode = { kind: 'decon', hover: null, anchor: null, end: null, tiles: [] };
  game.events.emit('buildui', {});
}

export function exitBuildMode(game) {
  if (!game.build.mode) return;
  game.build.mode = null;
  game.events.emit('buildui', {});
}

// recompute the ghost preview (called every frame while placing)
function updatePreview(game) {
  const m = game.build.mode, p = game.player;
  const def = BUILDINGS[m.type];
  const origin = m.anchor || m.hover;
  const target = m.anchor ? (m.end || m.hover) : m.hover;
  let tiles = def.drag && m.anchor ? dragTiles(def.drag, origin[0], origin[1], target[0], target[1]) : [m.hover];
  const multi = tiles.length > 1;
  const ghost = new Set();
  const out = [];
  const total = {};
  let nOk = 0, firstReason = null;
  for (const [tx, ty] of tiles) {
    let r = placeReason(game, m.type, tx, ty, p);
    if (r === 'exists' && multi) continue;
    let replace = null;
    if (r && typeof r === 'object') { replace = r.replace; r = null; }
    const t = { tx, ty, ok: !r, reason: r === 'exists' ? 'Já existe uma construção aqui' : r, mask: 0, replace };
    if (t.ok) {
      for (const k in def.cost) total[k] = (total[k] || 0) + def.cost[k];
      if (!p.inv.has(total)) { t.ok = false; t.reason = 'Materiais insuficientes'; for (const k in def.cost) total[k] -= def.cost[k]; }
    }
    if (t.ok) nOk++;
    else if (!firstReason) firstReason = t.reason;
    if (def.connect) ghost.add(game.world.idx(tx, ty));
    out.push(t);
  }
  if (def.connect) {
    const extra = (x, y) => game.world.inBounds(x, y) && ghost.has(game.world.idx(x, y));
    for (const t of out) t.mask = computeMask(game, m.type, t.tx, t.ty, extra); // sync-ok: ghost preview tile, not a structure
  }
  m.tiles = out; m.n = nOk; m.valid = nOk > 0; m.reason = nOk ? null : firstReason; m.total = total;
}

// place every valid, affordable tile of the preview as blueprints (paid now; the host refunds refusals)
export function commitPlacement(game) {
  const m = game.build.mode;
  if (!m || m.kind !== 'place') return false;
  updatePreview(game);
  const def = BUILDINGS[m.type], p = game.player;
  if (!m.valid) { game.events.emit('error', { text: m.reason || 'Local inválido' }); return false; }
  const tiles = [];
  for (const t of m.tiles) {
    if (!t.ok) continue;
    if (!p.inv.pay(def.cost)) break;
    tiles.push([t.tx, t.ty]);
  }
  const n = tiles.length;
  if (!n) return false;
  const paid = {};
  for (const k in def.cost) paid[k] = def.cost[k] * n;
  game.events.emit('inventory', {});
  game.net.request('build.place', { type: m.type, tiles }, {
    refund: paid,
    onReject: (why) => game.events.emit('error', { text: why || 'Local inválido' }),
  });
  game.audio?.play('build', { x: p.x, y: p.y, volume: 0.5 });
  game.events.emit('toast', { text: n > 1 ? `${n}× ${def.name}: planta marcada` : `${def.name}: planta marcada`, kind: 'info' });
  const h = game.ctl?.hinted;
  if (h && !h.blueprint) { h.blueprint = true; game.events.emit('toast', { text: 'Você constrói as plantas automaticamente quando fica parado', kind: 'info' }); } // sync-ok: hint flag, not a structure
  game.work?.wake();
  m.anchor = null; m.end = null; m.locked = false;
  if (!def.drag || !p.inv.has(def.cost)) exitBuildMode(game);
  return true;
}
export const confirmPlace = (game) => {
  const m = game.build.mode;
  if (m?.kind === 'place') commitPlacement(game);
  else if (m?.kind === 'decon') exitBuildMode(game);
};

// touch / tap in build mode (mouse uses pointer drags, see controller)
export function buildTap(game, wx, wy) {
  const m = game.build.mode;
  const tx = Math.floor(wx), ty = Math.floor(wy);
  if (m.kind === 'decon') { deconAt(game, wx, wy); return; }
  const def = BUILDINGS[m.type];
  if (def.drag) {
    if (!m.anchor) { m.anchor = [tx, ty]; m.hover = [tx, ty]; m.end = null; m.locked = true; return; }
    const tgt = m.end || m.anchor;
    if (tgt[0] === tx && tgt[1] === ty) { commitPlacement(game); return; }
    m.end = [tx, ty];
    return;
  }
  if (m.locked && m.hover[0] === tx && m.hover[1] === ty) { commitPlacement(game); return; }
  m.hover = [tx, ty]; m.locked = true;
}

// ---------- deconstruction designations ----------
export function structureAtPoint(game, wx, wy) {
  const tx = Math.floor(wx), ty = Math.floor(wy);
  return structureAt(game, tx, ty, 'main') || structureAt(game, tx, ty, 'rug') || structureAt(game, tx, ty, 'floor');
}

// returns the wanted state (blueprints are cancelled: false)
export function toggleDecon(game, o, on = null) {
  const want = o.blueprint ? false : on == null ? !game.build.decon.has(o) : on;
  game.net.request('build.decon', { ids: [o.id], on: on == null ? null : on ? 1 : 0 });
  if (want) game.work?.wake();
  return want;
}

export function deconAt(game, wx, wy) {
  const o = structureAtPoint(game, wx, wy);
  if (!o) { game.events.emit('error', { text: 'Nenhuma construção aqui' }); return; }
  toggleDecon(game, o);
}

export function deconRect(game, x0, y0, x1, y1) {
  const seen = new Set();
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (const L of ['main', 'rug', 'floor']) { const o = structureAt(game, x, y, L); if (o) seen.add(o); }
  }
  if (seen.size) {
    game.net.request('build.decon', { ids: [...seen].map((o) => o.id), on: 1 });
    game.work?.wake();
  }
  return seen.size;
}

// ---------- work kinds ----------
// read-only footprint check (the host clears it on the first hit and may still refuse)
function footprintBlocked(game, o) {
  const def = defOf(o);
  const [sw, sh] = def.size;
  for (let y = o.ty; y < o.ty + sh; y++) for (let x = o.tx; x < o.tx + sw; x++) {
    for (const n of objectsOnTile(game, x, y)) if (!CLEARABLE.has(n.type) && n.type !== 'crop') return true;
  }
  return false;
}

registerWork('blueprint', {
  valid: (g, it) => !it.o.removed && !!it.o.blueprint,
  start(game, it) {
    const o = it.o, def = defOf(o);
    if (footprintBlocked(game, o)) { game.events.emit('error', { text: 'Algo está no caminho' }); return null; }
    const p = game.player;
    let refused = false;
    game.net.request('build.hit', { id: o.id, start: true }, {
      onReject: (why) => {
        refused = true; // authority: synchronous · guest: arrives later and stops the work
        if (p.work?.it?.o === o) { p.work = null; p.action = null; }
        game.events.emit('error', { text: why || 'Algo está no caminho' });
      },
    });
    if (refused || o.removed || !o.blueprint) return null;
    const { need, cycle } = hitsFor(def.time || 2, 2);
    return { type: 'build', cycle, need, hits: Math.floor((o.progress || 0) * need), label: `Construindo ${def.name.toLowerCase()}` };
  },
  hit(game, wk) {
    const o = wk.it.o;
    game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3);
    game.audio?.play('build', { x: o.x, y: o.y, volume: 0.35 });
    game.net.request('build.hit', { id: o.id, inc: +(1 / wk.need).toFixed(4) });
  },
  finish(game, wk) { game.net.request('build.hit', { id: wk.it.o.id, final: true }); return true; },
});

registerWork('decon', {
  valid: (g, it) => !it.o.removed && g.build.decon.has(it.o),
  start(game, it) {
    const def = defOf(it.o);
    const { need, cycle } = hitsFor(Math.max(1, (def.time || 2) * 0.5), 1);
    return { type: 'build', cycle, need, label: `Desmontando ${def.name.toLowerCase()}` };
  },
  hit(game, wk) {
    const o = wk.it.o;
    o.shake = 1;
    (game.shaking ||= new Set()).add(o);
    game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3);
    game.audio?.play('build', { x: o.x, y: o.y, volume: 0.35 });
  },
  finish(game, wk) { game.net.request('decon.hit', { id: wk.it.o.id }); return true; },
});

// ---------- interaction descriptors ----------
export function structIt(o, extra) {
  const def = defOf(o);
  const [sw, sh] = def.size;
  if (def.block === 'tile' || def.block === 'door' || def.flat || sw > 1 || sh > 1)
    return { o, tile: true, tx: o.tx, ty: o.ty, w: sw, h: sh, x: o.tx + sw / 2, y: o.ty + sh / 2, reach: 0.6, ...extra };
  return { o, x: o.x, y: o.cy ?? o.y, reach: 0.85, ...extra };
}

export function describeStructure(game, o) {
  const def = defOf(o);
  if (!def) return null;
  if (o.blueprint) return structIt(o, { kind: 'blueprint', verb: 'Construir', icon: 'build', prio: 3 });
  if (game.build.decon.has(o)) return structIt(o, { kind: 'decon', verb: 'Desmontar', icon: 'build', prio: 1 });
  if (o.type === 'chest') return structIt(o, { kind: 'chest', verb: 'Abrir', icon: 'chest', prio: 3, use: true });
  if (o.type === 'bed') return structIt(o, { kind: 'bed', verb: 'Dormir', icon: 'bed', prio: 3, use: true });
  if (def.station) return structIt(o, { kind: 'station', verb: o.type === 'campfire' ? 'Cozinhar' : 'Criar', icon: 'craft', prio: o.type === 'campfire' ? 1 : 3, use: true, reach: 1.4 });
  if (o.type === 'farm_plot') return game.farm?.describePlot(game, o) || null;
  return null;
}

export function useStructure(game, it) {
  const p = game.player, o = it.o;
  switch (it.kind) {
    case 'chest':
      game.events.emit('open', { panel: 'chest', chest: o });
      game.audio?.play('ui', {});
      return;
    case 'station':
      game.events.emit('open', { panel: 'craft', station: o.type });
      return;
    case 'bed': {
      p.respawn = o.id;
      const h = game.env.hour;
      const night = h >= 19.5 || h < 5.5;
      if (!night) { game.events.emit('toast', { text: 'Ponto de renascimento definido. Durma à noite.', kind: 'info' }); return; }
      if (p.inCombat || game.entities.some((e) => !e.dead && e !== p && e.state === 'chase' && e.threat === p)) {
        game.events.emit('error', { text: 'Não dá para dormir em combate' }); return;
      }
      if (!game.net.auth) { game.events.emit('toast', { text: 'Ponto de renascimento definido. Em multijogador só o anfitrião dorme até o amanhecer.', kind: 'info' }); return; }
      game.events.emit('sleep', {});
      game.later(0.9, () => {
        game.net.request('env.sleep', {}, {
          onOk: () => { p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = Math.max(0, p.hunger - 15); },
          onReject: (why) => game.events.emit('error', { text: why || 'Não deu para dormir' }),
        });
      });
      return;
    }
  }
}

// ---------- system ----------
export function buildingSystem() {
  return {
    sync: 'owner', // doors animate locally from every player's position; preview / floor speed are the player's
    update(game, dt) {
      const p = game.player;
      // doors open for any player (cosmetic: derived from the positions every peer knows)
      for (const o of game.build.doors) {
        if (o.blueprint) continue;
        let near = false;
        for (const e of game.entities) {
          if (e.kind !== 'pawn' || e.isMob || e.proxy || e.dead) continue;
          if (Math.abs(e.x - (o.tx + 0.5)) < 1.25 && Math.abs(e.y - (o.ty + 0.5)) < 1.25) { near = true; break; }
        }
        const target = near ? 1 : 0;
        if (o.open !== target) {
          const was = o.open;
          o.open = target > o.open ? Math.min(1, o.open + dt * 5) : Math.max(0, o.open - dt * 3);
          if (was === 0 && o.open > 0) game.audio?.play('build', { x: o.x, y: o.y, volume: 0.2 });
        }
      }
      // floors: +10% walking speed
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const fl = structureAt(game, tx, ty, 'floor');
      if (fl && !fl.blueprint && fl.type !== 'farm_plot') p.speed *= 1.1;

      const m = game.build.mode;
      if (!m) return;
      if (p.dead) { exitBuildMode(game); return; }
      if (m.kind !== 'place') return;
      const hover = game.ctl?.hover;
      if (hover && hover.fresh) { m.hover = [Math.floor(hover.wx), Math.floor(hover.wy)]; if (m.anchor && game.ctl.dragging) m.end = m.hover.slice(); }
      else if (!m.locked && !m.anchor) m.hover = frontTile(p);
      updatePreview(game);
    },
    render(game, B, v) {
      const A = game.A, t = game.time;
      // fallback visuals while the structure art is not in the atlas
      const S = game.build.structures;
      const art = typeof CW.structureSprite === 'function';
      const soft = A.has('fx_soft') ? A.get('fx_soft') : null;
      const ring = A.has('fx_ring') ? A.get('fx_ring') : null;
      for (const o of S) {
        if (o.x < v.x0 - 3 || o.x > v.x1 + 3 || o.y < v.y0 - 1 || o.y > v.y1 + 3) continue;
        const def = defOf(o);
        if (def.flat && soft && !art && !A.has(o.type + '_' + o.mask) && !A.has(o.type)) {
          const c = FLAT_FB[o.type] || [0.6, 0.5, 0.4];
          const [sw, sh] = def.size;
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++)
            B.ground.add(soft, o.tx + x + 0.5, o.ty + y + 0.85, 1.45, 1.1, c[0], c[1], c[2], o.blueprint ? 0.35 : 0.9);
        }
        if (o.blueprint && !art && ring) {
          const [sw, sh] = def.size;
          B.fx.add(ring, o.tx + sw / 2, o.ty + sh / 2 + 0.1, 0.9 * sw, 0.6 * sh, 0.55, 0.8, 1, 0.65);
        }
        if (game.build.decon.has(o) && ring) {
          const [sw, sh] = def.size;
          const pulse = 0.85 + 0.15 * Math.sin(t * 6);
          B.fx.add(ring, o.tx + sw / 2, o.ty + sh / 2 + 0.1, 0.95 * sw * pulse, 0.65 * sh * pulse, 1, 0.35, 0.3, 0.85);
        }
      }
      const m = game.build.mode;
      if (!m || m.kind !== 'place') return;
      const def = BUILDINGS[m.type];
      const pulse = 0.75 + 0.25 * Math.sin(t * 6);
      const [sw, sh] = def.size;
      for (const g of m.tiles) {
        const [r, gg, b] = g.ok ? [0.55, 1, 0.55] : [1, 0.35, 0.3];
        if (ring) B.fx.add(ring, g.tx + sw / 2, g.ty + sh / 2 + 0.1, 1.0 * sw, 0.68 * sh, r, gg, b, 0.9 * pulse);
        const [s, sc] = ghostSprite(A, m.type, g.mask);
        if (s) {
          const layer = def.flat ? B.ground : B.fx;
          layer.add(s, g.tx + sw / 2, g.ty + sh, sc, sc, r, gg, b, (def.flat ? 0.7 : 0.55) * pulse, 0, 0, 0, 1);
        } else if (def.flat && soft) {
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) B.ground.add(soft, g.tx + x + 0.5, g.ty + y + 0.85, 1.4, 1.05, r, gg, b, 0.5 * pulse);
        }
      }
    },
  };
}

const FLAT_FB = { floor_wood: [0.62, 0.45, 0.28], floor_stone: [0.62, 0.62, 0.6], farm_plot: [0.36, 0.25, 0.16], rug: [0.62, 0.2, 0.18] };

// sprite for a ghost preview: Art A's structureSprite(A, type, mask) when present, else fallbacks
export function ghostSprite(A, type, mask = 0) {
  if (typeof CW.structureSprite === 'function') {
    try {
      const r = CW.structureSprite(A, type, mask);
      if (Array.isArray(r)) { if (r[0]) return r; }
      else if (r) return [r, 1];
    } catch { /* fall through */ }
  }
  for (const n of [type + '_' + mask, type + '_h', type + '_0', type]) if (A.has(n)) return [A.get(n), 1];
  return buildSprite(A, type);
}

// structures near the player (for stations / warmth)
export function structuresNear(game, x, y, r, filter) {
  const out = [];
  for (const o of game.build.structures) {
    if (o.blueprint) continue;
    const def = defOf(o);
    const [sw, sh] = def.size;
    const cx = Math.max(o.tx, Math.min(o.tx + sw, x)), cy = Math.max(o.ty, Math.min(o.ty + sh, y));
    if (Math.hypot(cx - x, cy - y) <= r && (!filter || filter(o))) out.push(o);
  }
  return out;
}

export { DIRS4 };
export const itemLabel = (id) => ITEMS[id]?.name || id;
