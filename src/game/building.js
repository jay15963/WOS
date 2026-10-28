// Building: costs, tile-snapped ghost placement, validity, structure use (cook, chest, bed,
// dismantle). Walls occupy a tile via world.solid; round props use solid radius + occupancy.

import { BUILDINGS } from './data.js';
import { Inventory } from './inventory.js';
import { occAdd, occRemove } from './nav.js';
import { gainXp } from './player.js';
import { dropLoot } from './loot.js';
import { buildSprite } from './artcompat.js';
import { startWork } from './gathering.js';

let nextId = 1;
const FRONT = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
const MAX_DIST = 6;

export function initBuilding(game) {
  game.build = { mode: null, structures: [] };
}

export function frontTile(p) {
  const [fx, fy] = FRONT[p.facing] || FRONT.s;
  return [Math.floor(p.x + fx * 0.9), Math.floor(p.y - 0.1 + fy * 0.9)];
}

export function enterBuildMode(game, type) {
  const p = game.player;
  if (p.dead) return;
  const def = BUILDINGS[type];
  if (!p.inv.has(def.cost)) { game.events.emit('error', { text: 'Materiais insuficientes' }); return; }
  const [tx, ty] = frontTile(p);
  game.build.mode = { type, tx, ty, locked: false, valid: false };
  game.events.emit('buildmode', { type });
}

export function exitBuildMode(game) {
  if (!game.build.mode) return;
  game.build.mode = null;
  game.events.emit('buildmode', { type: null });
}

function circleRectHit(cx, cy, r, tx, ty) {
  const nx = Math.max(tx, Math.min(tx + 1, cx)), ny = Math.max(ty, Math.min(ty + 1, cy));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

export function validPlacement(game, type, tx, ty) {
  const w = game.world, p = game.player, def = BUILDINGS[type];
  if (!w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  if (w.rock[i] || w.water[i] || w.solid[i] || game.occ[i]) return false;
  if (Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) > MAX_DIST) return false;
  if (game.build.structures.some((s) => s.tx === tx && s.ty === ty)) return false;
  // any other world object rooted in this tile (bush, stump, boulder...)
  let blocked = false;
  w.forChunks(tx - 1, ty - 1, tx + 2, ty + 2, (c) => {
    if (blocked) return;
    for (const o of c.objects) if (Math.floor(o.x) === tx && Math.floor(o.y - 0.05) === ty) { blocked = true; return; }
  });
  if (blocked) return false;
  // entities in the way
  const pad = def.tile ? 0 : 0.1;
  for (const e of game.entities) {
    if (e.dead) continue;
    if (Math.abs(e.x - tx - 0.5) > 2 || Math.abs(e.y - ty - 0.5) > 2) continue;
    if (def.tile ? circleRectHit(e.x, e.y, e.r, tx, ty) : Math.hypot(e.x - (tx + 0.5), e.y - (ty + 0.62)) < e.r + (def.solid || 0) + pad) return false;
  }
  return true;
}

export function placeBuilding(game, type, tx, ty, restore = null) {
  const def = BUILDINGS[type], w = game.world;
  const o = {
    id: restore?.id || 'b' + Date.now().toString(36) + (nextId++), type, v: 0,
    x: tx + 0.5, y: ty + (def.tile ? 0.98 : 0.62), s: 1, f: 1,
    solid: def.tile ? 0 : def.solid || 0, building: true, tx, ty, builtAt: restore?.builtAt ?? game.worldTime,
  };
  if (def.light) o.light = { ...def.light };
  if (def.fire) o.fire = true;
  if (def.slots) { o.store = new Inventory(def.slots); if (restore?.store) o.store.load(restore.store); }
  w.addObject(o);
  if (def.tile) w.solid[w.idx(tx, ty)] = 1;
  else if (o.solid) occAdd(game, o);
  game.build.structures.push(o);
  if (type === 'bed') game.player.respawn = o.id;
  if (!restore) {
    game.juice.puff(o.x, o.y, 10, [0.72, 0.64, 0.52], 0.8);
    game.audio?.play('build', { x: o.x, y: o.y });
    gainXp(game, def.xp || 5);
    game.events.emit('toast', { text: `${def.name} ${def.g === 'm' ? 'construído' : 'construída'}`, kind: 'good' });
    if (type === 'bed') game.events.emit('toast', { text: 'Ponto de renascimento definido', kind: 'info' });
    if (type === 'campfire') game.audio?.play('fire', { x: o.x, y: o.y });
  }
  game.events.emit('tile', { tx, ty });
  return o;
}

export function tryPlace(game, tx, ty) {
  const m = game.build.mode;
  if (!m) return false;
  const def = BUILDINGS[m.type], p = game.player;
  if (!validPlacement(game, m.type, tx, ty)) { game.events.emit('error', { text: 'Local inválido' }); return false; }
  if (!p.inv.pay(def.cost)) { game.events.emit('error', { text: 'Materiais insuficientes' }); exitBuildMode(game); return false; }
  game.events.emit('inventory', {});
  placeBuilding(game, m.type, tx, ty);
  if (def.repeat && p.inv.has(def.cost)) { m.locked = false; }
  else exitBuildMode(game);
  return true;
}

export function confirmPlace(game) {
  const m = game.build.mode;
  if (m) tryPlace(game, m.tx, m.ty);
}

// tap / click on the world while in build mode
export function buildTap(game, wx, wy, isMouse) {
  const m = game.build.mode;
  const tx = Math.floor(wx), ty = Math.floor(wy);
  if (isMouse || (m.locked && tx === m.tx && ty === m.ty)) { tryPlace(game, tx, ty); return; }
  if (Math.hypot(tx + 0.5 - game.player.x, ty + 0.5 - game.player.y) > MAX_DIST) { game.events.emit('error', { text: 'Muito longe' }); return; }
  m.tx = tx; m.ty = ty; m.locked = true;
}

export function dismantle(game, o) {
  const def = BUILDINGS[o.type], w = game.world;
  const S = game.build.structures, i = S.indexOf(o);
  if (i < 0) return;
  S.splice(i, 1);
  w.removeObject(o);
  occRemove(game, o);
  if (def.tile) w.solid[w.idx(o.tx, o.ty)] = 0;
  for (const id in def.cost) { const n = Math.floor(def.cost[id] / 2); for (let k = 0; k < n; k++) dropLoot(game, o.x, o.y - 0.2, id, 1, 0.6); }
  if (o.store) for (const s of o.store.slots) if (s) dropLoot(game, o.x, o.y, s.id, s.qty, 0.8);
  if (game.player.respawn === o.id) game.player.respawn = null;
  game.juice.puff(o.x, o.y, 8, [0.72, 0.64, 0.52], 0.7);
  game.audio?.play('build', { x: o.x, y: o.y });
  game.events.emit('toast', { text: `${def.name} ${def.g === 'm' ? 'desmontado' : 'desmontada'}`, kind: 'info' });
  game.events.emit('tile', { tx: o.tx, ty: o.ty });
}

// ---------- structure interaction ----------
export function describeStructure(game, o) {
  const p = game.player;
  switch (o.type) {
    case 'campfire': return { kind: 'cook', o, x: o.x, y: o.y, verb: p.inv.count('meat') ? 'Assar' : 'Fogueira', icon: 'campfire', prio: p.inv.count('meat') ? 5 : 0, reach: 1.1 };
    case 'chest': return { kind: 'chest', o, x: o.x, y: o.y, verb: 'Abrir', icon: 'chest', prio: 3, reach: 1.0 };
    case 'bed': return { kind: 'bed', o, x: o.x, y: o.y, verb: 'Dormir', icon: 'bed', prio: 3, reach: 1.0 };
    case 'wall_wood': return { kind: 'dismantle', o, x: o.x, y: o.y - 0.5, verb: 'Desmontar', icon: 'build', prio: 0, reach: 0.95 };
    case 'torch': return { kind: 'dismantle', o, x: o.x, y: o.y, verb: 'Desmontar', icon: 'build', prio: 0, reach: 0.9 };
    default: return null;
  }
}

export function useStructure(game, it) {
  const p = game.player, o = it.o;
  switch (it.kind) {
    case 'cook':
      if (!p.inv.count('meat')) { game.events.emit('toast', { text: 'Traga carne crua para assar aqui', kind: 'info' }); return; }
      startWork(game, it);
      return;
    case 'chest':
      game.events.emit('open', { panel: 'chest', chest: o });
      game.audio?.play('ui', {});
      return;
    case 'bed': {
      p.respawn = o.id;
      const h = game.env.hour;
      const night = h >= 19.5 || h < 5.5;
      if (!night) { game.events.emit('toast', { text: 'Ponto de renascimento definido. Durma à noite.', kind: 'info' }); return; }
      if (p.inCombat || game.entities.some((e) => e.kind === 'animal' && !e.dead && e.state === 'chase' && e.threat === p)) {
        game.events.emit('error', { text: 'Não dá para dormir em combate' }); return;
      }
      game.events.emit('sleep', {});
      game.later(0.9, () => {
        if (game.env.hour >= 12) game.env.dayIndex++;
        game.env.hour = 6.0;
        p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = Math.max(0, p.hunger - 15);
        game.events.emit('toast', { text: 'Você dormiu até o amanhecer', kind: 'good' });
      });
      return;
    }
    case 'dismantle':
      dismantle(game, o);
      return;
  }
}

export function buildingSystem() {
  return {
    update(game) {
      const m = game.build.mode, p = game.player;
      if (!m) return;
      if (p.dead) { exitBuildMode(game); return; }
      const hover = game.ctl?.hover;
      if (hover && hover.fresh) { m.tx = Math.floor(hover.wx); m.ty = Math.floor(hover.wy); }
      else if (!m.locked) { [m.tx, m.ty] = frontTile(p); }
      else if (Math.hypot(m.tx + 0.5 - p.x, m.ty + 0.5 - p.y) > MAX_DIST + 1) m.locked = false;
      m.valid = validPlacement(game, m.type, m.tx, m.ty) && p.inv.has(BUILDINGS[m.type].cost);
    },
    render(game, B) {
      const m = game.build.mode;
      if (!m) return;
      const A = game.A, def = BUILDINGS[m.type];
      const pulse = 0.75 + 0.25 * Math.sin(game.time * 6);
      const [r, g, b] = m.valid ? [0.55, 1, 0.55] : [1, 0.35, 0.3];
      if (A.has('fx_ring')) B.blob.add(A.get('fx_ring'), m.tx + 0.5, m.ty + 0.5, 1.15, 0.8, r, g, b, 0.9 * pulse);
      const [s, sc] = buildSprite(A, m.type);
      if (s) {
        const y = m.ty + (def.tile ? 0.98 : 0.62);
        B.main.add(s, m.tx + 0.5, y, sc, sc, r, g, b, 0.55 * pulse, 0, 0, 0, 1);
      }
    },
  };
}
