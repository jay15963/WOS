// Creature spawners (deterministic from the world seed), creature factory, respawn timers,
// dynamic cave spiders in mined roofed tunnels, sleep outside ~40 tiles, corpse cleanup and
// light separation. Raiders (bandits.js) are mobs too: updated here with their own brain.
//
// Bare-hands balance: the ring around the spawn only holds passive animals (rabbit, fox, deer) and
// neutral boars; wolves start ~30 tiles out, spiders hug the mountains (~32+), bears ~55+, camps ~60+.

import { SPECIES } from './data.js';
import { mobStats } from './stats.js';
import { mulberry32 } from '../engine/noise.js';
import { updateCreature } from './ai.js';
import { updateBandit } from './bandits.js';
import { mobBlocked } from './nav.js';

const SLEEP = 40;
let mobId = 1;
export const nextMobId = () => mobId++;

function countTrees(world, x, y, r) {
  let n = 0;
  world.forChunks(x - r, y - r, x + r, y + r, (c) => {
    for (const o of c.objects) if (o.type.startsWith('tree_') && Math.abs(o.x - x) < r && Math.abs(o.y - y) < r) n++;
  });
  return n;
}

export const levelForDistance = (d, extra = 0) => Math.max(1, Math.min(18, 1 + Math.floor(d / 24) + extra));

const QUOTA = { wolf: 14, boar: 14, deer: 14, rabbit: 20, fox: 12, spider: 12, bear: 5 };

export function createSpawners(game) {
  const w = game.world, rand = mulberry32((w.seed | 0) * 31 + 7);
  const spawners = [];
  const have = {};
  for (const k in QUOTA) have[k] = 0;
  const sx = w.spawn.x, sy = w.spawn.y;
  const minD = (s) => SPECIES[s].minD ?? 8;
  for (let k = 0; k < 9000; k++) {
    const x = 6 + Math.floor(rand() * (w.W - 12)), y = 6 + Math.floor(rand() * (w.H - 12));
    const i = w.idx(x, y);
    if (w.rock[i] || w.water[i] || w.solid?.[i]) continue;
    const d = Math.hypot(x - sx, y - sy);
    const trees = countTrees(w, x + 0.5, y + 0.5, 4);
    const lush = w.lush ? w.lush[i] : 0.5;
    const dRock = w.dRock ? w.dRock[i] : 99;
    const biome = w.biomeAt ? w.biomeAt(x + 0.5, y + 0.5) : 'meadow';
    const wooded = biome === 'forest' || biome === 'pine' || biome === 'birch';
    const cands = [];
    if (trees >= 7 && d > minD('wolf')) cands.push('wolf');
    if (trees >= 1 && trees <= 5 && lush > 0.35 && d > minD('boar')) cands.push('boar');
    if (trees <= 2 && lush > 0.5 && d > minD('deer')) cands.push('deer');
    if (trees <= 3 && lush > 0.42 && d > minD('rabbit')) cands.push('rabbit');
    if ((trees >= 4 || (wooded && trees >= 2)) && d > minD('fox')) cands.push('fox');
    if (dRock < 3.2 && (biome === 'rocky' || biome === 'mountain' || dRock < 1.6) && d > minD('spider')) cands.push('spider');
    if (dRock < 6 && d > minD('bear') && trees <= 6) cands.push('bear');
    if (!cands.length) continue;
    const species = cands[Math.floor(rand() * cands.length)];
    if (have[species] >= QUOTA[species]) continue;
    const minSame = species === 'bear' ? 40 : species === 'rabbit' ? 12 : 16;
    if (spawners.some((s) => { const dd = Math.hypot(s.x - x, s.y - y); return dd < 7 || (s.species === species && dd < minSame); })) continue;
    const sp = SPECIES[species];
    const level = levelForDistance(d, (sp.lvl || 0) + (rand() < 0.3 ? 1 : 0));
    const count = species === 'wolf' ? 2 + (rand() < 0.35 ? 1 : 0)
      : species === 'spider' ? 1 + (rand() < 0.55 ? 1 : 0)
      : species === 'bear' ? 1
      : species === 'fox' ? 1
      : species === 'rabbit' ? 1 + (rand() < 0.5 ? 1 : 0)
      : 1 + Math.floor(rand() * 2) + (species === 'deer' && rand() < 0.3 ? 1 : 0);
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
    if (!mobBlocked(w, tx, ty, sp.r) && !w.waterAt(Math.floor(tx), Math.floor(ty))) { x = tx; y = ty; break; }
  }
  const level = Math.max(1, s.level + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0));
  const st = mobStats(sp, level);
  const m = {
    isEntity: true, isMob: true, kind: 'animal', id: mobId++, species: s.species, name: sp.name, level, elite: !!sp.elite,
    temper: sp.temper, x, y, r: sp.r, scale: sp.scale * (0.92 + Math.random() * 0.16),
    facing: Math.random() < 0.5 ? 'e' : 'w', moving: false, moveT: Math.random() * 10, action: null, flash: 0,
    dead: false, deadT: 0, hp: st.maxHp, maxHp: st.maxHp, dmg: st.dmg,
    home: { x, y }, spawner: s, state: 'idle', stateT: Math.random() * 4, swingT: 0, stunT: 0,
  };
  if (s.cave) m.cave = true;
  s.members.push(m);
  game.entities.push(m);
  return m;
}

// ---------- cave spiders: mined tunnels under mountain roofs get dark and infested ----------
function caveSpawn(game) {
  const w = game.world, p = game.player;
  const roof = w.roof;
  const mined = game.minedTiles;
  if (!roof || !mined || mined.length < 6) return;
  const caves = game.spawners.filter((s) => s.cave);
  if (caves.length >= 4) return;
  for (let k = 0; k < 12; k++) {
    const i = mined[Math.floor(Math.random() * mined.length)];
    if (!roof[i] || w.rock[i]) continue;
    const tx = i % w.W, ty = Math.floor(i / w.W);
    const x = tx + 0.5, y = ty + 0.5;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < 11 || d > 34) continue;
    if (caves.some((s) => Math.hypot(s.x - x, s.y - y) < 10)) continue;
    if (mobBlocked(w, x, y, 0.26)) continue;
    const dSpawn = Math.hypot(x - w.spawn.x, y - w.spawn.y);
    const s = { id: game.spawners.length + 1, species: 'spider', x, y, level: levelForDistance(dSpawn, 1), count: 1 + (Math.random() < 0.5 ? 1 : 0), members: [], cave: true };
    game.spawners.push(s);
    for (let n = 0; n < s.count; n++) spawnMember(game, s);
    return;
  }
}

export function mobsSystem() {
  let slowT = 0, caveT = 8;
  return {
    update(game, dt) {
      const p = game.player;
      game._pathBudget = 3;
      const awake = game._awake || (game._awake = []);
      awake.length = 0;
      const E = game.entities;
      for (let i = E.length - 1; i >= 0; i--) {
        const m = E[i];
        if (!m.isMob) continue;
        if (m.dead) {
          // corpse cleanup (raider corpses linger a little longer; their camp respawns them)
          if (m.deadT > 60 || (m.deadT > 20 && !onScreen(game, m))) {
            E.splice(i, 1);
            if (p.target === m) { p.target = null; game.events.emit('target', { target: null }); }
          }
          continue;
        }
        const d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
        if (d > SLEEP * 1.4 && m.state !== 'evade' && m.state !== 'chase') { m.moving = false; continue; }
        if (m.faction === 'bandit') updateBandit(game, m, dt);
        else updateCreature(game, m, dt);
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
            if (!mobBlocked(game.world, a.x - ux * push, a.y - uy * push, a.r)) { a.x -= ux * push; a.y -= uy * push; }
            if (!mobBlocked(game.world, b.x + ux * push, b.y + uy * push, b.r)) { b.x += ux * push; b.y += uy * push; }
          }
        }
      }
      // respawns (slow tick)
      slowT -= dt;
      if (slowT <= 0) {
        slowT = 1;
        for (let si = game.spawners.length - 1; si >= 0; si--) {
          const s = game.spawners[si];
          for (let k = s.members.length - 1; k >= 0; k--) {
            const m = s.members[k];
            if (!m.dead || game.worldTime < m.respawnAt) continue;
            if (Math.hypot(s.x - p.x, s.y - p.y) < 18) continue; // never pop in on screen
            s.members.splice(k, 1);
            const i = E.indexOf(m);
            if (i >= 0) E.splice(i, 1);
            if (s.cave) continue; // cave nests don't refill; new ones appear while you dig
            spawnMember(game, s);
          }
          if (s.cave && !s.members.length) game.spawners.splice(si, 1);
        }
      }
      caveT -= dt;
      if (caveT <= 0) { caveT = 15 + Math.random() * 10; caveSpawn(game); }
    },
  };
}

function onScreen(game, e) {
  const v = game.view();
  return e.x > v.x0 - 2 && e.x < v.x1 + 2 && e.y > v.y0 - 2 && e.y < v.y1 + 2;
}
