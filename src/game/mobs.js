// Creature spawners (deterministic from the world seed), creature factory, respawn timers,
// dynamic cave spiders in mined roofed tunnels, sleep outside ~40 tiles, corpse cleanup and
// light separation. Raiders (bandits.js) are mobs too: updated here with their own brain.
//
// Day and night (owner's rules): passive animals (green: rabbit, fox, deer) are out by day only; predators
// (wolves) by night only, and many more of them: their dens fill at dusk and hunting packs roam out of the dark
// toward the players (3x wolves per pack in winter); boars and bears (not nocturnal) any time; monsters
// (spiders) live in caves only. Nothing nocturnal appears within 3x the radius of a light (campfires, torches,
// lamps, a hand torch). Creatures out of their hours go home and vanish once nobody sees them.
//
// Bare-hands balance: the ring around the spawn only holds passive animals (rabbit, fox, deer) and
// neutral boars; wolves start ~30 tiles out, spiders hug the mountains (~32+), bears ~55+, camps ~60+.
// Multiplayer: creatures live on the HOST only (spawners, AI, respawns: mobsSystem is sync 'host'); they
// reach guests through the entity stream (net/entities.js). Sleep / respawn / caves consider every player.

import { SPECIES } from './data.js';
import { mobStats } from './stats.js';
import { mulberry32 } from '../engine/noise.js';
import { updateCreature } from './ai.js';
import { updateBandit } from './bandits.js';
import { mobBlocked } from './nav.js';
import { allPlayers, minPlayerDist, inAnyView } from './players.js';
import { nightK } from './seasons.js';
import { BUILDINGS } from './data.js';
import { ITEMS } from './content/items.js';
import { walkersTick } from './walkers.js';

const SLEEP = 40;
// creature ids from the authority: nid 'm<base36>' for the network, numeric id for the art (gait phase)
export function allocMob(game) {
  const nid = game.net.newId('m');
  return { nid, id: parseInt(nid.slice(1), 36) };
}

function countTrees(world, x, y, r) {
  let n = 0;
  world.forChunks(x - r, y - r, x + r, y + r, (c) => {
    for (const o of c.objects) if (o.type.startsWith('tree_') && Math.abs(o.x - x) < r && Math.abs(o.y - y) < r) n++;
  });
  return n;
}

export const levelForDistance = (d, extra = 0) => Math.max(1, Math.min(18, 1 + Math.floor(d / 24) + extra));

const QUOTA = { wolf: 20, boar: 14, deer: 14, rabbit: 20, fox: 12, bear: 5 };
// when each species is out: 'day' | 'night' | 'always' | 'cave' (a cave nest: day and night)
export const ACTIVE = { rabbit: 'day', fox: 'day', deer: 'day', wolf: 'night', boar: 'always', bear: 'always', spider: 'cave', walker: 'night' };
export const isNight = (game) => nightK(game.env?.hour ?? 12) > 0.5;
const winterNow = (game) => game.season?.id === 'winter';
// pack size now (wolves: 3x in winter)
const packSize = (game, s) => s.count * (s.species === 'wolf' && winterNow(game) ? 3 : 1);
function activeNow(game, s, night) {
  const when = s.when || ACTIVE[s.species] || 'always';
  return when === 'day' ? !night : when === 'night' ? night : true;
}

// ---------- light keeps the night away ----------
// lights: [x, y, protected radius^2] for structures with a light (campfires, torches, braziers, lamps, a working
// furnace) and players holding a hand torch; refreshed by the slow tick
const LIGHT_K = 3;
function collectLights(game) {
  const out = game._spawnLights || (game._spawnLights = []);
  out.length = 0;
  for (const o of game.build.structures) {
    if (o.blueprint || o.removed) continue;
    const def = BUILDINGS[o.type];
    const L = def?.light || (o.working && def?.workLight);
    if (!L || o.fire === false || o.lit === false) continue;
    const r = L.radius * LIGHT_K;
    out.push(o.x, o.y, r * r);
  }
  const hand = ITEMS.torch_hand?.light?.radius || 5;
  for (const q of allPlayers(game)) {
    if (q.dead) continue;
    if (q.light || q.offhand === 'torch_hand' || q.equip?.off === 'torch_hand') { const r = (q.light?.radius || hand) * LIGHT_K; out.push(q.x, q.y, r * r); }
  }
  return out;
}
export function litNear(game, x, y) {
  const L = game._spawnLights || collectLights(game);
  for (let i = 0; i < L.length; i += 3) { const dx = L[i] - x, dy = L[i + 1] - y; if (dx * dx + dy * dy < L[i + 2]) return true; }
  return false;
}

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
    spawners.push({ id: spawners.length + 1, species, x: x + 0.5, y: y + 0.5, level, count, members: [], when: ACTIVE[species] });
    have[species]++;
  }
  game.spawners = spawners;
  // only what is out at this hour (the rest fills in when its time comes: mobsSystem slow tick)
  const night = isNight(game);
  collectLights(game);
  for (const s of spawners) {
    if (!activeNow(game, s, night) || (s.when === 'night' && litNear(game, s.x, s.y))) continue;
    for (let n = 0; n < packSize(game, s); n++) spawnMember(game, s);
  }
}

// host / tests: one creature at (x, y) on its own spawner (any time of day with when 'always')
export function spawnLoose(game, species, x, y, { level = null, when = 'always' } = {}) {
  const w = game.world, d = Math.hypot(x - w.spawn.x, y - w.spawn.y);
  const s = { id: game.spawners.length + 1, species, x, y, level: level ?? levelForDistance(d, SPECIES[species]?.lvl || 0), count: 1, members: [], when, loose: true };
  game.spawners.push(s);
  return spawnMember(game, s);
}

export function spawnMember(game, s) {
  const sp = SPECIES[s.species];
  const w = game.world;
  const R = () => game.net.roll();
  let x = s.x, y = s.y;
  for (let k = 0; k < 10; k++) {
    const a = R() * Math.PI * 2, r = R() * 2.5;
    const tx = s.x + Math.cos(a) * r, ty = s.y + Math.sin(a) * r;
    if (!mobBlocked(w, tx, ty, sp.r) && !w.waterAt(Math.floor(tx), Math.floor(ty))) { x = tx; y = ty; break; }
  }
  const level = Math.max(1, s.level + (R() < 0.25 ? (R() < 0.5 ? -1 : 1) : 0));
  const st = mobStats(sp, level);
  const ids = allocMob(game);
  const m = {
    isEntity: true, isMob: true, kind: 'animal', ...ids, species: s.species, name: sp.name, level, elite: !!sp.elite,
    temper: sp.temper, x, y, r: sp.r, scale: +(sp.scale * (0.92 + R() * 0.16)).toFixed(3), variant: ids.id & 1,
    facing: R() < 0.5 ? 'e' : 'w', moving: false, moveT: R() * 10, action: null, flash: 0,
    dead: false, deadT: 0, hp: st.maxHp, maxHp: st.maxHp, dmg: st.dmg,
    home: { x, y }, spawner: s, state: 'idle', stateT: R() * 4, swingT: 0, stunT: 0,
  };
  if (s.cave) m.cave = true;
  s.members.push(m);
  game.entities.push(m); // host-only creature list (guests get proxies from net/entities.js)
  return m;
}

// ---------- cave spiders: mined tunnels under mountain roofs get dark and infested ----------
function caveSpawn(game) {
  const w = game.world;
  const L = allPlayers(game), p = L[Math.floor(Math.random() * L.length)]; // around any player
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
    const s = { id: game.spawners.length + 1, species: 'spider', x, y, level: levelForDistance(dSpawn, 1), count: 1 + (Math.random() < 0.5 ? 1 : 0), members: [], cave: true, when: 'cave' };
    game.spawners.push(s);
    for (let n = 0; n < s.count; n++) spawnMember(game, s);
    return;
  }
}

// ---------- night hunts: wolf packs come out of the dark toward the players ----------
// every ~30-50 s at night, around a random player with fewer than 2 (winter 3) packs within 50 tiles: a pack of
// 2-3 (x3 in winter) appears 24-34 tiles away, out of sight and away from any light, and roams a spot ~9 tiles
// from that player (in the dark): close enough to smell them. They go home at dawn.
function nightHunt(game) {
  const w = game.world, L = allPlayers(game).filter((q) => !q.dead);
  if (!L.length) return;
  const p = L[Math.floor(Math.random() * L.length)];
  const winter = winterNow(game);
  const packs = game.spawners.filter((s) => s.hunt && s.members.some((m) => !m.dead) && Math.hypot(s.x - p.x, s.y - p.y) < 50).length;
  if (packs >= (winter ? 3 : 2)) return;
  const ok = (x, y, r) => { const tx = Math.floor(x), ty = Math.floor(y); return w.inBounds(tx, ty) && !mobBlocked(w, x, y, r) && !w.waterAt(tx, ty)
    && !w.isCave(tx, ty) && !w.roofAt?.(tx, ty) && !litNear(game, x, y); };
  for (let k = 0; k < 16; k++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 10;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (!ok(x, y, 0.32) || minPlayerDist(game, x, y) < 22 || inAnyView(game, x, y, 3, 3)) continue;
    // the spot they roam: between them and the player, ~9 tiles from the player, in the dark
    let hx = p.x + Math.cos(a) * 9, hy = p.y + Math.sin(a) * 9;
    if (!ok(hx, hy, 0.32)) { hx = x; hy = y; }
    const dSpawn = Math.hypot(x - w.spawn.x, y - w.spawn.y);
    const s = { id: game.spawners.length + 1, species: 'wolf', x, y, level: levelForDistance(dSpawn, Math.random() < 0.3 ? 1 : 0), count: 2 + (Math.random() < 0.4 ? 1 : 0), members: [], when: 'night', hunt: true };
    game.spawners.push(s);
    for (let n = 0; n < packSize(game, s); n++) { const m = spawnMember(game, s); m.home = { x: hx + (Math.random() - 0.5) * 3, y: hy + (Math.random() - 0.5) * 3 }; }
    return;
  }
}

export function mobsSystem() {
  let slowT = 0, caveT = 8, huntT = 20;
  return {
    sync: 'host', // creatures are simulated by the host only
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
          if (m.deadT > 60 || (m.deadT > 20 && !inAnyView(game, m.x, m.y, 2, 2))) {
            E.splice(i, 1); // host-only creature list
            if (p.target === m) { p.target = null; game.events.emit('target', { target: null }); }
          }
          continue;
        }
        let d = 1e9;
        for (const q of allPlayers(game)) d = Math.min(d, Math.abs(m.x - q.x) + Math.abs(m.y - q.y));
        if (d > SLEEP * 1.4 && m.state !== 'evade' && m.state !== 'chase') { m.moving = false; continue; }
        if (m.faction === 'bandit' || m.faction === 'walker') updateBandit(game, m, dt);
        else updateCreature(game, m, dt);
        awake.push(m);
      }
      // separation between awake creatures
      for (let i = 0; i < awake.length; i++) {
        const a = awake[i];
        for (let j = i + 1; j < awake.length; j++) {
          const b = awake[j];
          if (a.lv || b.lv || a.z > 0 || b.z > 0) continue; // levels: separation on the ground only
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
      // schedule + respawns (slow tick)
      slowT -= dt;
      if (slowT <= 0) {
        slowT = 1;
        const night = isNight(game);
        collectLights(game);
        const drop = (s, k, m) => { s.members.splice(k, 1); const i = E.indexOf(m); if (i >= 0) E.splice(i, 1); }; // host-only creature list
        for (let si = game.spawners.length - 1; si >= 0; si--) {
          const s = game.spawners[si];
          const on = activeNow(game, s, night);
          for (let k = s.members.length - 1; k >= 0; k--) {
            const m = s.members[k];
            if (!m.dead) {
              // out of its hours: home, and gone once nobody sees it (never in the middle of a fight)
              if (on) { m.leaving = false; continue; }
              m.leaving = true;
              if (m.state !== 'chase' && m.state !== 'flee' && !inAnyView(game, m.x, m.y, 3, 3)) drop(s, k, m);
              continue;
            }
            if (game.worldTime < m.respawnAt) continue;
            if (minPlayerDist(game, s.x, s.y) < 18) continue; // never pop in on anyone's screen
            drop(s, k, m);
            if (s.cave || s.hunt || s.loose || !on) continue; // nests / hunting packs don't refill; out of hours: later
            spawnMember(game, s);
          }
          // its hours came: fill up to the pack size, one at a time, out of sight (nocturnal ones not by a light)
          if (on && !s.cave && !s.hunt && !s.loose && s.members.length < packSize(game, s) && minPlayerDist(game, s.x, s.y) >= 18
            && !inAnyView(game, s.x, s.y, 3, 3) && !(s.when === 'night' && litNear(game, s.x, s.y))) spawnMember(game, s);
          if ((s.cave || s.hunt || s.loose) && !s.members.length) game.spawners.splice(si, 1);
        }
        walkersTick(game, night); // winter nights: the frozen dead (walkers.js)
      }
      huntT -= dt;
      if (huntT <= 0) { huntT = 30 + Math.random() * 20; if (isNight(game)) nightHunt(game); }
      caveT -= dt;
      if (caveT <= 0) { caveT = 15 + Math.random() * 10; caveSpawn(game); }
    },
  };
}

