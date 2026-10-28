// Creature spawners (deterministic from the world seed), creature factory, respawn timers,
// sleep outside ~40 tiles, corpse cleanup and light separation.

import { SPECIES } from './data.js';
import { mobStats } from './stats.js';
import { collides } from './physics.js';
import { mulberry32 } from '../engine/noise.js';
import { updateCreature } from './ai.js';

const SLEEP = 40;
let mobId = 1;

function countTrees(world, x, y, r) {
  let n = 0;
  world.forChunks(x - r, y - r, x + r, y + r, (c) => {
    for (const o of c.objects) if (o.type.startsWith('tree_') && Math.abs(o.x - x) < r && Math.abs(o.y - y) < r) n++;
  });
  return n;
}

export function createSpawners(game) {
  const w = game.world, rand = mulberry32((w.seed | 0) * 31 + 7);
  const spawners = [];
  const quota = { wolf: 16, boar: 14, deer: 14, rabbit: 20, bear: 5 };
  const have = { wolf: 0, boar: 0, deer: 0, rabbit: 0, bear: 0 };
  const sx = w.spawn.x, sy = w.spawn.y;
  for (let k = 0; k < 9000; k++) {
    const x = 6 + Math.floor(rand() * (w.W - 12)), y = 6 + Math.floor(rand() * (w.H - 12));
    const i = w.idx(x, y);
    if (w.rock[i] || w.water[i]) continue;
    const d = Math.hypot(x - sx, y - sy);
    const trees = countTrees(w, x + 0.5, y + 0.5, 4);
    const lush = w.lush ? w.lush[i] : 0.5;
    const dRock = w.dRock ? w.dRock[i] : 99;
    const cands = [];
    if (trees >= 7 && d > 16) cands.push('wolf');
    if (trees >= 1 && trees <= 5 && lush > 0.35 && d > 10) cands.push('boar');
    if (trees <= 2 && lush > 0.5 && d > 7) cands.push('deer');
    if (trees <= 3 && lush > 0.42 && d > 4) cands.push('rabbit');
    if (dRock < 6 && d > 42 && trees <= 6) cands.push('bear');
    if (!cands.length) continue;
    const species = cands[Math.floor(rand() * cands.length)];
    if (have[species] >= quota[species]) continue;
    const minSame = species === 'bear' ? 40 : species === 'rabbit' ? 12 : 16;
    if (spawners.some((s) => { const dd = Math.hypot(s.x - x, s.y - y); return dd < 7 || (s.species === species && dd < minSame); })) continue;
    const sp = SPECIES[species];
    const level = Math.max(1, Math.min(18, 1 + Math.floor(d / 22) + (sp.lvl || 0) + (rand() < 0.3 ? 1 : 0)));
    const count = species === 'wolf' ? 2 + (rand() < 0.35 ? 1 : 0) : species === 'bear' ? 1 : species === 'rabbit' ? 1 + (rand() < 0.5 ? 1 : 0) : 1 + Math.floor(rand() * 2) + (species === 'deer' && rand() < 0.3 ? 1 : 0);
    spawners.push({ id: spawners.length + 1, species, x: x + 0.5, y: y + 0.5, level, count, members: [] });
    have[species]++;
  }
  game.spawners = spawners;
  for (const s of spawners) for (let n = 0; n < s.count; n++) spawnMember(game, s);
}

export function spawnMember(game, s) {
  const sp = SPECIES[s.species];
  const w = game.world;
  let x = s.x, y = s.y;
  for (let k = 0; k < 10; k++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 2.5;
    const tx = s.x + Math.cos(a) * r, ty = s.y + Math.sin(a) * r;
    if (!collides(w, tx, ty, sp.r) && !w.waterAt(Math.floor(tx), Math.floor(ty))) { x = tx; y = ty; break; }
  }
  const level = Math.max(1, s.level + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0));
  const st = mobStats(sp, level);
  const m = {
    isEntity: true, kind: 'animal', id: mobId++, species: s.species, name: sp.name, level, elite: !!sp.elite,
    temper: sp.temper, x, y, r: sp.r, scale: sp.scale * (0.92 + Math.random() * 0.16),
    facing: Math.random() < 0.5 ? 'e' : 'w', moving: false, moveT: Math.random() * 10, action: null, flash: 0,
    dead: false, deadT: 0, hp: st.maxHp, maxHp: st.maxHp, dmg: st.dmg,
    home: { x, y }, spawner: s, state: 'idle', stateT: Math.random() * 4, swingT: 0, stunT: 0,
  };
  s.members.push(m);
  game.entities.push(m);
  return m;
}

export function mobsSystem() {
  let slowT = 0;
  return {
    update(game, dt) {
      const p = game.player;
      game._pathBudget = 3;
      const awake = game._awake || (game._awake = []);
      awake.length = 0;
      const E = game.entities;
      for (let i = E.length - 1; i >= 0; i--) {
        const m = E[i];
        if (m.kind !== 'animal') continue;
        if (m.dead) {
          // corpse cleanup
          if (m.deadT > 60 || (m.deadT > 20 && !onScreen(game, m))) {
            E.splice(i, 1);
            if (p.target === m) { p.target = null; game.events.emit('target', { target: null }); }
          }
          continue;
        }
        const d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
        if (d > SLEEP * 1.4 && m.state !== 'evade' && m.state !== 'chase') { m.moving = false; continue; }
        updateCreature(game, m, dt);
        awake.push(m);
      }
      // separation between awake creatures
      for (let i = 0; i < awake.length; i++) {
        const a = awake[i];
        for (let j = i + 1; j < awake.length; j++) {
          const b = awake[j];
          const dx = b.x - a.x, dy = b.y - a.y, rr = (a.r + b.r) * 0.9;
          if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
          const dd = Math.hypot(dx, dy);
          if (dd > 0.001 && dd < rr) {
            const push = (rr - dd) * 0.5, ux = dx / dd, uy = dy / dd;
            if (!collides(game.world, a.x - ux * push, a.y - uy * push, a.r)) { a.x -= ux * push; a.y -= uy * push; }
            if (!collides(game.world, b.x + ux * push, b.y + uy * push, b.r)) { b.x += ux * push; b.y += uy * push; }
          }
        }
      }
      // respawns (slow tick)
      slowT -= dt;
      if (slowT <= 0) {
        slowT = 1;
        for (const s of game.spawners) {
          for (let k = s.members.length - 1; k >= 0; k--) {
            const m = s.members[k];
            if (!m.dead || game.worldTime < m.respawnAt) continue;
            if (Math.hypot(s.x - p.x, s.y - p.y) < 18) continue; // never pop in on screen
            s.members.splice(k, 1);
            const i = E.indexOf(m);
            if (i >= 0) E.splice(i, 1);
            spawnMember(game, s);
          }
        }
      }
    },
  };
}

function onScreen(game, e) {
  const v = game.view();
  return e.x > v.x0 - 2 && e.x < v.x1 + 2 && e.y > v.y0 - 2 && e.y < v.y1 + 2;
}
