// Building: placement modes (single / line / rectangle outline / filled area) with connected ghost previews,
// rotation (R / Shift+R, ⟳ on the build bar: 4 orientations for multi-tile things, 5 edge placements for small
// props), free RimWorld-like blueprints (blue, translucent) built over time by the player — the builder delivers
// the materials when the work starts; a blueprint without them shows "falta material" and is skipped —,
// deconstruction (refund 75%), raze (campfires), "Mover" (a move plan; the object keeps its state), doors /
// gates opened and closed only by an explicit action (door.toggle), structure use (chest, bed, stations, doors),
// floor speed bonus.
// Multiplayer: this module is the player's side (modes, preview, work loop, UI). Every change to the shared
// structures goes through the host: intents build.place / build.move / build.hit / build.decon / decon.hit /
// struct.raze / door.toggle and the ops of mut/structures.js.
//
// Structure object: { id, type, v, tx, ty, rot, fw, fh, x, y (base / sort key), cy, building, layer, flat?,
//   progress, blueprint?, paid, moveOf?, mask (autotile), orient ('h'|'v' doors), open (doors, shared),
//   _openT (door swing 0..1, cosmetic), working (stations), store (chest), light, fire }

import { BUILDINGS, ITEMS } from './data.js';
import { buildSprite } from './artcompat.js';
import { registerWork, hitsFor } from './gathering.js';
import { initGrids, computeMask, structureAt, wallBehind, DIRS4 } from './autotile.js';
import * as CW from '../art/composeWorld.js';
import { placeReason, objectsOnTile, CLEARABLE, defOf, REFUND, MAX_TILES, rotCount, normRot, dimsOf, setGeom } from './mut/structures.js';

export { placeStructure, completeStructure, removeStructure, placeReason, defOf, REFUND, dimsOf, rotCount } from './mut/structures.js';

const FRONT = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };

export function initBuilding(game) {
  game.build = { mode: null, structures: [], doors: [], decon: new Set(), v: 0, rot: {} };
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

// labels of the orientations (build bar / toast)
const ROT_EDGE = ['No centro', 'Encostado ao norte', 'Encostado ao leste', 'Encostado ao sul', 'Encostado ao oeste'];
const ROT_FACE = ['Virado para o sul', 'Virado para o oeste', 'Virado para o norte', 'Virado para o leste'];
export function rotLabel(type, rot) {
  const d = BUILDINGS[type];
  if (d?.edge) return ROT_EDGE[rot | 0] || ROT_EDGE[0];
  if (d?.rotate) return ROT_FACE[rot & 3];
  return '';
}

// ---------- build mode ----------
// opts.move = a finished structure to move ("Mover": same type, keeps its state)
export function enterBuildMode(game, type, opts = {}) {
  const p = game.player;
  if (p.dead) return;
  const src = opts.move || null;
  if (src) type = src.type;
  const def = BUILDINGS[type];
  if (!def) return;
  game.mining && (game.mining.mode = false);
  const [tx, ty] = src ? [src.tx, src.ty] : frontTile(p);
  const rot = src ? src.rot | 0 : normRot(type, rotMemory(game)[type] ?? 0);
  game.build.mode = { kind: 'place', type, rot, move: src, hover: [tx, ty], anchor: null, end: null, locked: !!src, tiles: [], valid: false, reason: null, n: 0, short: null };
  game.events.emit('buildui', {});
  const h = game.ctl?.hinted;
  if (!h) return;
  const touch = game.input.isTouch;
  if (src) {
    if (!h.movehint) { h.movehint = true; game.events.emit('toast', { text: touch ? 'Toque no novo lugar, ⟳ para girar e ✓ para confirmar' : 'Clique no novo lugar · R gira · Esc cancela', kind: 'info' }); }
  } else if (def.drag && !h['drag_' + def.drag]) {
    h['drag_' + def.drag] = true;
    game.events.emit('toast', {
      text: def.drag === 'line'
        ? (touch ? 'Arraste um dedo para fazer uma linha (na diagonal, uma sala); dois dedos dão zoom' : 'Arraste para uma linha; na diagonal faz uma sala')
        : (touch ? 'Arraste um dedo para cobrir uma área' : 'Arraste para cobrir uma área'),
      kind: 'info',
    });
  } else if (rotCount(type) > 1 && !h.rotatehint) {
    h.rotatehint = true;
    game.events.emit('toast', { text: touch ? 'Use ⟳ para girar ou encostar na parede' : 'R gira (Shift+R volta) · encoste na parede', kind: 'info' });
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

// last orientation per type (kept with the player's hints, so it survives a reload)
const rotMemory = (game) => { const h = game.ctl?.hinted; return h ? (h.brot ||= {}) : game.build.rot; };

// R / Shift+R / ⟳: next orientation (remembered per type)
export function rotateBuild(game, dir = 1) {
  const m = game.build.mode;
  if (!m || m.kind !== 'place') return false;
  const n = rotCount(m.type);
  if (n < 2) { game.events.emit('error', { text: 'Isto não gira' }); return false; }
  m.rot = (((m.rot + dir) % n) + n) % n;
  if (!m.move) rotMemory(game)[m.type] = m.rot; // sync-ok: local preference (player save), not a structure
  game.audio?.play('rotate', {});
  game.events.emit('buildui', {});
  return true;
}

// footprint origin for the tile under a world point (multi-tile ghosts are centred on the cursor)
export function originAt(game, wx, wy) {
  const m = game.build.mode;
  if (!m || m.kind !== 'place') return [Math.floor(wx), Math.floor(wy)];
  const [fw, fh] = dimsOf(m.type, m.rot);
  return [Math.floor(wx - fw / 2 + 0.5), Math.floor(wy - fh / 2 + 0.5)];
}

// recompute the ghost preview (called every frame while placing)
function updatePreview(game) {
  const m = game.build.mode, p = game.player;
  const def = BUILDINGS[m.type];
  const origin = m.anchor || m.hover;
  const target = m.anchor ? (m.end || m.hover) : m.hover;
  const tiles = def.drag && m.anchor && !m.move ? dragTiles(def.drag, origin[0], origin[1], target[0], target[1]) : [m.hover];
  const multi = tiles.length > 1;
  const ghost = new Set();
  const out = [];
  let nOk = 0, firstReason = null;
  for (const [tx, ty] of tiles) {
    let r = placeReason(game, m.type, tx, ty, p, m.rot, m.move);
    if (r === 'exists' && multi) continue;
    let replace = null;
    if (r && typeof r === 'object') { replace = r.replace; r = null; }
    if (!r && m.move && tx === m.move.tx && ty === m.move.ty && m.rot === (m.move.rot | 0)) r = 'Já está aqui';
    const t = { tx, ty, ok: !r, reason: r === 'exists' ? 'Já existe uma construção aqui' : r, mask: 0, replace };
    if (t.ok) nOk++;
    else if (!firstReason) firstReason = t.reason;
    if (def.connect) ghost.add(game.world.idx(tx, ty));
    out.push(t);
  }
  if (def.connect) {
    const extra = (x, y) => game.world.inBounds(x, y) && ghost.has(game.world.idx(x, y));
    for (const t of out) t.mask = computeMask(game, m.type, t.tx, t.ty, extra); // sync-ok: ghost preview tile, not a structure
  }
  m.tiles = out; m.n = nOk; m.valid = nOk > 0; m.reason = nOk ? null : firstReason;
  // materials are only needed when the work starts: tell the player what is missing for all of it
  m.short = null;
  if (!m.move && nOk) {
    const need = {};
    for (const k in def.cost) need[k] = def.cost[k] * nOk;
    const miss = [];
    for (const k in need) { const have = p.inv.count(k); if (have < need[k]) miss.push(`${need[k] - have} ${(ITEMS[k]?.name || k).toLowerCase()}`); }
    if (miss.length) m.short = 'Falta: ' + miss.join(', ');
  }
}

// place every valid tile of the preview as free blueprints (or the move plan)
export function commitPlacement(game) {
  const m = game.build.mode;
  if (!m || m.kind !== 'place') return false;
  updatePreview(game);
  const def = BUILDINGS[m.type], p = game.player;
  if (!m.valid) { game.events.emit('error', { text: m.reason || 'Local inválido' }); return false; }
  const tiles = [];
  for (const t of m.tiles) if (t.ok) tiles.push([t.tx, t.ty]);
  const n = tiles.length;
  if (!n) return false;
  if (m.move) {
    const src = m.move;
    game.net.request('build.move', { id: src.id, tx: tiles[0][0], ty: tiles[0][1], rot: m.rot }, {
      onReject: (why) => game.events.emit('error', { text: why || 'Não deu para mover' }),
    });
    game.events.emit('toast', { text: `${def.name}: mudança marcada`, kind: 'info' });
    game.work?.wake();
    exitBuildMode(game);
    return true;
  }
  game.net.request('build.place', { type: m.type, tiles, rot: m.rot }, {
    onReject: (why) => game.events.emit('error', { text: why || 'Local inválido' }),
  });
  game.events.emit('toast', { text: (n > 1 ? `${n}× ${def.name}: planta marcada` : `${def.name}: planta marcada`) + (m.short ? ` · ${m.short.toLowerCase()}` : ''), kind: m.short ? 'warn' : 'info' });
  const h = game.ctl?.hinted;
  if (h && !h.blueprint) { h.blueprint = true; game.events.emit('toast', { text: 'Você constrói as plantas sozinho quando fica parado; o material sai da mochila quando a obra começa', kind: 'info' }); } // sync-ok: hint flag, not a structure
  game.work?.wake();
  m.anchor = null; m.end = null; m.locked = false;
  if (!def.drag) exitBuildMode(game);
  return true;
}
export const confirmPlace = (game) => {
  const m = game.build.mode;
  if (m?.kind === 'place') commitPlacement(game);
  else if (m?.kind === 'decon') exitBuildMode(game);
};
// ✕ / Esc / right click: cancel the current drag first, then leave the mode
export function cancelBuild(game) {
  const m = game.build.mode;
  if (m?.kind === 'place' && (m.anchor || m.dragging)) { m.anchor = m.end = null; m.locked = false; m.dragging = false; return; }
  if (m?.kind === 'decon' && m.anchor) { m.anchor = m.end = null; return; }
  exitBuildMode(game);
}

// touch / tap in build mode (mouse and finger drags use buildDrag*)
export function buildTap(game, wx, wy) {
  const m = game.build.mode;
  if (m.kind === 'decon') { deconAt(game, wx, wy); return; }
  const [tx, ty] = originAt(game, wx, wy);
  const def = BUILDINGS[m.type];
  if (def.drag && !m.move) {
    if (!m.anchor) { m.anchor = [tx, ty]; m.hover = [tx, ty]; m.end = null; m.locked = true; return; }
    const tgt = m.end || m.anchor;
    if (tgt[0] === tx && tgt[1] === ty) { commitPlacement(game); return; }
    m.end = [tx, ty];
    return;
  }
  if (m.locked && m.hover[0] === tx && m.hover[1] === ty) { commitPlacement(game); return; }
  m.hover = [tx, ty]; m.locked = true;
}

// drags (mouse left button, one finger on touch). commitOnEnd: rows of walls / floors are placed on release.
export function buildDragStart(game, wx, wy) {
  const m = game.build.mode;
  if (!m) return;
  if (m.kind === 'decon') { const t = [Math.floor(wx), Math.floor(wy)]; m.anchor = t; m.end = t.slice(); return; }
  const o = originAt(game, wx, wy);
  m.dragging = true;
  m.hover = o; m.locked = true;
  if (BUILDINGS[m.type].drag && !m.move) { m.anchor = o; m.end = o.slice(); }
}
export function buildDragMove(game, wx, wy) {
  const m = game.build.mode;
  if (!m) return;
  if (m.kind === 'decon') { if (m.anchor) m.end = [Math.floor(wx), Math.floor(wy)]; return; }
  if (!m.dragging) return;
  const o = originAt(game, wx, wy);
  m.hover = o;
  if (m.anchor) m.end = o;
}
// returns true when something was placed / designated
export function buildDragEnd(game, wx, wy, { commit = true } = {}) {
  const m = game.build.mode;
  if (!m) return false;
  if (m.kind === 'decon') {
    const a = m.anchor; m.anchor = m.end = null;
    if (!a) return false;
    const tx = Math.floor(wx), ty = Math.floor(wy);
    if (a[0] === tx && a[1] === ty) { deconAt(game, wx, wy); return true; }
    const n = deconRect(game, a[0], a[1], tx, ty);
    if (n) game.events.emit('toast', { text: `${n} marcada(s) para desmontar`, kind: 'info' });
    return n > 0;
  }
  if (!m.dragging) return false;
  m.dragging = false;
  const o = originAt(game, wx, wy);
  m.hover = o;
  if (m.anchor) m.end = o;
  if (!commit) return false;
  return commitPlacement(game);
}

// ---------- deconstruction designations ----------
export function structureAtPoint(game, wx, wy) {
  const tx = Math.floor(wx), ty = Math.floor(wy);
  const g = structureAt(game, tx, ty, 'main') || structureAt(game, tx, ty, 'rug') || structureAt(game, tx, ty, 'floor');
  if (g) return g;
  // move plans are not in the grid
  for (const o of game.build.structures) if (o.moveOf && tx >= o.tx && tx < o.tx + o.fw && ty >= o.ty && ty < o.ty + o.fh) return o;
  return null;
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
  if (defOf(o).raze && !o.blueprint) { razeStructure(game, o); return; }
  toggleDecon(game, o);
}

export function deconRect(game, x0, y0, x1, y1) {
  const seen = new Set();
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    for (const L of ['main', 'rug', 'floor']) { const o = structureAt(game, x, y, L); if (o) seen.add(o); }
  }
  for (const o of game.build.structures) if (o.moveOf && o.tx <= bx && o.tx + o.fw > ax && o.ty <= by && o.ty + o.fh > ay) seen.add(o);
  if (seen.size) {
    game.net.request('build.decon', { ids: [...seen].map((o) => o.id), on: 1 });
    game.work?.wake();
  }
  return seen.size;
}

export function razeStructure(game, o) {
  game.net.request('struct.raze', { id: o.id }, { onReject: (why) => game.events.emit('error', { text: why || 'Não deu para arrasar' }) });
}

export function toggleDoor(game, o) {
  game.net.request('door.toggle', { id: o.id, open: o.open ? 0 : 1 }, { onReject: (why) => game.events.emit('error', { text: why || 'A porta não abriu' }) });
}

// ---------- materials ----------
// can the local player start this blueprint? (delivered already, or the cost is in the bag)
export function canSupply(game, o) {
  if (!o.blueprint || o.paid || o.moveOf) return true;
  return game.player.inv.has(defOf(o).cost);
}
export function missingText(game, o) {
  const cost = defOf(o).cost, p = game.player, miss = [];
  for (const k in cost) { const have = p.inv.count(k); if (have < cost[k]) miss.push(`${cost[k] - have} ${(ITEMS[k]?.name || k).toLowerCase()}`); }
  return miss.join(', ');
}

// ---------- work kinds ----------
// read-only footprint check (the host clears it when the work starts and may still refuse)
function footprintBlocked(game, o) {
  for (let y = o.ty; y < o.ty + o.fh; y++) for (let x = o.tx; x < o.tx + o.fw; x++) {
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
    let pay = 0, paid = null;
    if (!o.paid && !o.moveOf) {
      if (!p.inv.pay(def.cost)) { game.events.emit('error', { text: `Falta material: ${missingText(game, o)}` }); return null; }
      pay = 1; paid = { ...def.cost };
      game.events.emit('inventory', {});
    }
    let refused = false;
    game.net.request('build.hit', { id: o.id, start: true, pay }, {
      refund: paid,
      onReject: (why) => {
        refused = true; // authority: synchronous · guest: arrives later and stops the work
        if (p.work?.it?.o === o) { p.work = null; p.action = null; }
        game.events.emit('error', { text: why || 'Algo está no caminho' });
      },
    });
    if (refused || o.removed || !o.blueprint) return null;
    const { need, cycle } = hitsFor((def.time || 2) * (o.moveOf ? 0.5 : 1), 2);
    return { type: 'build', cycle, need, hits: Math.floor((o.progress || 0) * need), label: `${o.moveOf ? 'Movendo' : 'Construindo'} ${def.name.toLowerCase()}` };
  },
  hit(game, wk) {
    const o = wk.it.o;
    game.juice.chips(o.x, o.y - 0.3, [0.72, 0.6, 0.45], 4, 0.3);
    game.audio?.play('build_hit', { x: o.x, y: o.y, volume: 0.4 });
    game.net.request('build.hit', { id: o.id, inc: +(1 / wk.need).toFixed(4) });
  },
  finish(game, wk) {
    const o = wk.it.o;
    game.net.request('build.hit', { id: o.id, final: true }, { onReject: (why) => why && game.events.emit('error', { text: why }) });
    return true;
  },
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
    game.audio?.play('build_hit', { x: o.x, y: o.y, volume: 0.35 });
  },
  finish(game, wk) { game.net.request('decon.hit', { id: wk.it.o.id }); return true; },
});

// ---------- interaction descriptors ----------
export function structIt(o, extra) {
  const def = defOf(o);
  const sw = o.fw || def.size[0], sh = o.fh || def.size[1];
  if (def.block === 'tile' || def.block === 'door' || def.flat || sw > 1 || sh > 1)
    return { o, tile: true, tx: o.tx, ty: o.ty, w: sw, h: sh, x: o.tx + sw / 2, y: o.ty + sh / 2, reach: 0.6, ...extra };
  return { o, x: o.x, y: o.cy ?? o.y, reach: 0.85, ...extra };
}

export function describeStructure(game, o) {
  const def = defOf(o);
  if (!def) return null;
  if (o.blueprint) return structIt(o, { kind: 'blueprint', verb: o.moveOf ? 'Mover' : 'Construir', icon: 'build', prio: canSupply(game, o) ? 3 : 0 });
  if (game.build.decon.has(o)) return structIt(o, { kind: 'decon', verb: 'Desmontar', icon: 'build', prio: 1 });
  if (o.door) return structIt(o, { kind: 'door', verb: o.open ? 'Fechar' : 'Abrir', icon: 'door', prio: 3, use: true, reach: 1.1 });
  if (o.type === 'chest') return structIt(o, { kind: 'chest', verb: 'Abrir', icon: 'chest', prio: 3, use: true });
  if (o.type === 'bed') return structIt(o, { kind: 'bed', verb: 'Dormir', icon: 'bed', prio: 3, use: true });
  if (def.station) return structIt(o, { kind: 'station', verb: o.type === 'campfire' ? 'Cozinhar' : 'Criar', icon: 'craft', prio: o.type === 'campfire' ? 1 : 3, use: true, reach: 1.4 });
  if (o.type === 'farm_plot') return game.farm?.describePlot(game, o) || null;
  return null;
}

export function useStructure(game, it) {
  const p = game.player, o = it.o;
  switch (it.kind) {
    case 'door':
      toggleDoor(game, o);
      return;
    case 'chest':
      game.events.emit('open', { panel: 'chest', chest: o });
      game.audio?.play('chest_open', { x: o.x, y: o.y });
      o._lid = 1;
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

// context menu entries for a structure (tap-and-hold / right click): [{ id, label, icon, run }]
export function structureMenu(game, o) {
  const def = defOf(o);
  if (!def || o.removed) return [];
  const out = [];
  const it = describeStructure(game, o);
  const goUse = () => game.ctl?.interact?.(describeStructure(game, o));
  if (o.blueprint) {
    if (!canSupply(game, o)) out.push({ id: 'info', label: `Falta: ${missingText(game, o)}`, icon: 'info', disabled: true });
    else out.push({ id: 'build', label: o.moveOf ? 'Mover agora' : 'Construir agora', icon: 'build', run: goUse });
    out.push({ id: 'cancel', label: o.moveOf ? 'Cancelar mudança' : 'Cancelar planta', icon: 'close', run: () => toggleDecon(game, o) });
    return out;
  }
  if (it && it.use) out.push({ id: 'use', label: it.kind === 'chest' ? 'Abrir baú' : it.kind === 'bed' ? 'Dormir' : it.verb, icon: it.icon, run: goUse });
  if (def.move && !o.moveOf) out.push({ id: 'move', label: 'Mover', icon: 'move', run: () => enterBuildMode(game, o.type, { move: o }) });
  if (def.raze) out.push({ id: 'raze', label: 'Arrasar', icon: 'raze', run: () => razeStructure(game, o) });
  else if (game.build.decon.has(o)) out.push({ id: 'undecon', label: 'Não desmontar', icon: 'close', run: () => toggleDecon(game, o, false) });
  else out.push({ id: 'decon', label: `Desmontar (devolve ${Math.round(REFUND * 100)}%)`, icon: 'decon', run: () => toggleDecon(game, o, true) });
  return out;
}

// ---------- system ----------
// door swing: ease with a little overshoot at the end (cosmetic, every peer animates the shared o.open)
const swing = (u) => (u >= 1 ? 1 : u <= 0 ? 0 : 1 - Math.pow(1 - u, 3) * Math.cos(u * 2.2));
export function buildingSystem() {
  let chestOpen = null, bbar = null;
  return {
    sync: 'owner', // door swing animates locally from the shared o.open; preview / floor speed are the player's
    update(game, dt) {
      const p = game.player;
      // build toolbar / context menu / touch gestures (UI module, loaded lazily: no game → ui import cycle)
      if (!bbar && typeof document !== 'undefined' && game.R?.canvas && !game.headless) {
        bbar = 1;
        import('../ui/buildbar.js').then((mod) => { bbar = mod.installBuildbar(game); }).catch((e) => { console.warn('buildbar', e); bbar = 2; });
      }
      if (typeof bbar === 'object' && bbar) bbar.update(dt);
      for (const o of game.build.doors) {
        const target = o.open ? 1 : 0;
        const u = o._u ?? target;
        if (u !== target) {
          o._u = target > u ? Math.min(1, u + dt * 3.2) : Math.max(0, u - dt * 3.2);
          o._openT = target ? swing(o._u) : 1 - swing(1 - o._u);
        } else { o._u = target; o._openT = target; }
      }
      // chest lid (local player's open chest panel)
      const pn = game.ui?.panels;
      const ch = pn && pn.open === 'chest' ? pn.data?.chest : null;
      if (chestOpen && chestOpen !== ch) { game.audio?.play('chest_close', { x: chestOpen.x, y: chestOpen.y }); chestOpen._lid = 0; }
      chestOpen = ch || null;
      // floors: +10% walking speed
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const fl = structureAt(game, tx, ty, 'floor');
      if (fl && !fl.blueprint && fl.type !== 'farm_plot') p.speed *= 1.1;

      const m = game.build.mode;
      if (!m) return;
      if (p.dead) { exitBuildMode(game); return; }
      if (m.kind !== 'place') return;
      if (m.move && (m.move.removed || m.move.blueprint)) { exitBuildMode(game); return; }
      const hover = game.ctl?.hover;
      if (hover && hover.fresh && !m.dragging) {
        const o = originAt(game, hover.wx, hover.wy);
        if (!m.locked || !game.input.isTouch) { m.hover = o; m.locked = false; }
        if (m.anchor && game.ctl.dragging) m.end = o.slice();
      } else if (!m.locked && !m.anchor && !m.dragging) m.hover = frontTile(p);
      updatePreview(game);
    },
    render(game, B, v) {
      const A = game.A, t = game.time;
      const S = game.build.structures;
      const art = typeof CW.structureSprite === 'function';
      const soft = A.has('fx_soft') ? A.get('fx_soft') : null;
      const ring = A.has('fx_ring') ? A.get('fx_ring') : null;
      const tile = A.has('bp_tile') ? A.get('bp_tile') : null;
      const bar = A.has('bp_bar') ? A.get('bp_bar') : null;
      const badge = A.has('bp_nomat') ? A.get('bp_nomat') : null;
      const pulse = 0.75 + 0.25 * Math.sin(t * 5);
      for (const o of S) {
        if (o.x < v.x0 - 3 || o.x > v.x1 + 3 || o.y < v.y0 - 1 || o.y > v.y1 + 3) continue;
        const def = defOf(o);
        const sw = o.fw || 1, sh = o.fh || 1;
        if (def.flat && soft && !art && !A.has(o.type + '_' + o.mask) && !A.has(o.type)) {
          const c = FLAT_FB[o.type] || [0.6, 0.5, 0.4];
          for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++)
            B.ground.add(soft, o.tx + x + 0.5, o.ty + y + 0.85, 1.45, 1.1, c[0], c[1], c[2], o.blueprint ? 0.35 : 0.9);
        }
        if (o.blueprint) {
          // RimWorld blueprint: blue grid over the footprint, progress bar once the frame is up, missing-material badge
          const ok = canSupply(game, o);
          if (tile) for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) B.ground.add(tile, o.tx + x + 0.5, o.ty + y + 1, 1, 1, 0.42, 0.7, 1, 0.55, 0, 0, 0, 1, 0);
          else if (ring) B.fx.add(ring, o.tx + sw / 2, o.ty + sh / 2 + 0.1, 0.9 * sw, 0.6 * sh, 0.55, 0.8, 1, 0.65);
          const top = o.ty - 0.15;
          if (bar && (o.progress || 0) > 0.001) {
            const W = Math.min(1.2, 0.5 + sw * 0.35), x0 = o.tx + sw / 2 - W / 2;
            B.fx.add(bar, x0, top, W, 1, 0.08, 0.1, 0.12, 0.75);
            B.fx.add(bar, x0 + 0.02, top, (W - 0.04) * Math.min(1, o.progress), 0.62, 0.55, 0.9, 0.45, 0.95);
          }
          if (!ok && badge) { const bs = def.drag ? 0.6 : 0.85; B.fx.add(badge, o.tx + sw / 2, top - 0.02, bs, bs, 1, 1, 1, 0.75 + 0.25 * pulse, 0, 0, 0, 1, 0, 0.1 * pulse); }
          if (o.moveOf && ring) { const src = game.world.objById.get(o.moveOf); if (src) B.fx.add(ring, src.x, src.cy ?? src.y, 1.1 * (src.fw || 1), 0.7 * (src.fh || 1), 0.5, 0.75, 1, 0.5 * pulse); }
        }
        if (game.build.decon.has(o) && ring) {
          const pl = 0.85 + 0.15 * Math.sin(t * 6);
          B.fx.add(ring, o.tx + sw / 2, o.ty + sh / 2 + 0.1, 0.95 * sw * pl, 0.65 * sh * pl, 1, 0.35, 0.3, 0.85);
        }
      }
      const m = game.build.mode;
      if (!m || m.kind !== 'place') return;
      // ghost preview: blue = ok, red = invalid; footprint grid under it
      const G0 = GHOST_O;
      for (const g of m.tiles) {
        const [fw, fh] = dimsOf(m.type, m.rot);
        const [r, gg, b] = g.ok ? [0.42, 0.72, 1] : [1, 0.35, 0.3];
        if (tile) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) B.ground.add(tile, g.tx + x + 0.5, g.ty + y + 1, 1, 1, r, gg, b, 0.7 * pulse, 0, 0, 0, 1, 0);
        else if (ring) B.fx.add(ring, g.tx + fw / 2, g.ty + fh / 2 + 0.1, 1.0 * fw, 0.68 * fh, r, gg, b, 0.9 * pulse);
        G0.type = m.type; G0.tx = g.tx; G0.ty = g.ty; G0.rot = m.rot; G0.mask = g.mask; G0.orient = null; G0.v = m.move ? m.move.v | 0 : 0; // sync-ok: scratch ghost object, not a structure
        setGeom(G0);
        G0._mount = BUILDINGS[m.type].edge ? wallBehind(game, g.tx, g.ty, m.rot) : false;
        G0._ghost = g.ok ? 1 : 2; G0.alpha = 0.85 * pulse;
        if (art && CW.drawGhost) CW.drawGhost(B, A, G0, t);
        else {
          const [s, sc] = ghostSprite(A, m.type, g.mask);
          if (s) (BUILDINGS[m.type].flat ? B.ground : B.fx).add(s, G0.x, G0.y, sc, sc, r, gg, b, 0.55 * pulse, 0, 0, 0, 1);
        }
      }
    },
  };
}
// scratch object for ghosts (no per-frame allocation)
const GHOST_O = { type: '', tx: 0, ty: 0, rot: 0, x: 0, y: 0, cy: 0, fw: 1, fh: 1, mask: 0, progress: 0, blueprint: true, building: true, _ghost: 1, alpha: 1, s: 1, f: 1, v: 0 };

const FLAT_FB = { floor_wood: [0.62, 0.45, 0.28], floor_stone: [0.62, 0.62, 0.6], farm_plot: [0.36, 0.25, 0.16], rug: [0.62, 0.2, 0.18] };

// sprite for a ghost preview / icon: Art A's structureSprite(A, type, mask) when present, else fallbacks
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
    const sw = o.fw || 1, sh = o.fh || 1;
    const cx = Math.max(o.tx, Math.min(o.tx + sw, x)), cy = Math.max(o.ty, Math.min(o.ty + sh, y));
    if (Math.hypot(cx - x, cy - y) <= r && (!filter || filter(o))) out.push(o);
  }
  return out;
}

export { DIRS4 };
export const itemLabel = (id) => ITEMS[id]?.name || id;
