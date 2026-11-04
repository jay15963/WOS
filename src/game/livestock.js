// Livestock (docs/LIVESTOCK.md): cows, sheep, pigs and chickens living in wild herds, tied with a rope and led by a
// player (up to 5 at once), domesticated by a feeder (alimentador: every farm animal within its range), fed from it,
// breeding when well fed, starving (warnings, then death) when it runs dry, the young growing up over a few days, and
// slaughtered with a single knife hit once domesticated. Fish swim in rivers and lakes (fishing.js / mut/fish.js).
//
// Multiplayer: the animals are host creatures (mobs.js / net/entities.js): brains, hunger, births and growth run on
// the host only (stockSystem sync 'host'); guests see the entity stream, which carries the farm state too (dyn bits:
// domesticated / hungry / starving / owned, and the pid of the player leading it — entities.js). Ties go through the
// intents stock.tie / stock.untie (mut/stock.js); the feeder is a shared container (chest.put / chest.take / chest.set,
// food is eaten through chest.set); a slaughter is the usual death (mob.die + corpse.add, butchered, + loot.add).
// Owned animals (tied once, domesticated, born on the farm) are saved with the world (stockRows / restoreStock).
//
// Host-side fields on a farm animal: stock (species data), owned, tame (in a feeder's range, not tied), feeder (id),
// tiedTo (pid), fed 0..1, starveT (s), bornAt / adultAt (worldTime; adultAt null = adult), breedAt, eatT.

import { SPECIES, ITEMS, BUILDINGS } from './data.js';
import { STOCK, FEEDER_RANGE, MAX_TIED, FEEDER_CAP, BELLY_DAYS, STARVE_DAYS, HUNGRY_AT, BREED_FED, BABY_SCALE } from './content/livestock.js';
import { mulberry32 } from '../engine/noise.js';
import { steer, resetNav, mobBlocked } from './nav.js';
import { go, pickWander, tickStatus, updateCreature } from './ai.js';
import { allPlayers, minPlayerDist } from './players.js';
import { killMob, dropTable } from './combat.js';
import { allocMob, levelForDistance } from './mobs.js';
import { mobStats } from './stats.js';
import { registerWork } from './gathering.js';
import { openContainer } from '../ui/container.js';
import { buildIco } from '../ui/econIcons.js';
import { facingFrom } from './physics.js';
import { stepGait } from './anim.js';
import { fertileAt } from '../world/soil.js';

export const isStockSpecies = (sp) => !!STOCK[sp];
const dayLen = (game) => game.env?.dayLength || 780;
const r2 = (v) => Math.round(v * 100) / 100;
const portion = (m) => 1 / (STOCK[m.species]?.perDay || 1);
const isBabyM = (m) => !!((m.variant | 0) & 2);
// it goes to eat once a whole portion fits in its belly (one item = 1 / perDay of a full belly; the young: twice as much),
// and never later than at 35 % (a one-a-day eater would else wait until it starves)
const eatAt = (m) => Math.max(0.35, 1 - portion(m) * (isBabyM(m) ? 2 : 1)) + 1e-6;
export const nameOf = (sp, baby) => (baby ? STOCK[sp]?.baby : SPECIES[sp]?.name) || SPECIES[sp]?.name || sp;

// ---------- feeders ----------
export const isFeeder = (o) => !!o && !o.blueprint && !o.removed && !!BUILDINGS[o.type]?.feed;
export const feederCenter = (o) => [o.tx + (o.fw || BUILDINGS[o.type].size[0]) / 2, o.ty + (o.fh || BUILDINGS[o.type].size[1]) / 2];
// the finished feeders (cached for half a second: the farm clock and the range rings ask often)
const FL = { t: -1, game: null, n: -1, list: [] };
function feederList(game) {
  const S = game.build?.structures || [];
  if (FL.game !== game || game.time - FL.t > 0.5 || FL.t > game.time || FL.n !== S.length) {
    FL.game = game; FL.t = game.time; FL.n = S.length; FL.list.length = 0;
    for (const o of S) if (o.type === 'feeder' || BUILDINGS[o.type]?.feed) FL.list.push(o);
  }
  return FL.list;
}
export function feedersNear(game, x, y, r = FEEDER_RANGE) {
  const out = [];
  for (const o of feederList(game)) {
    if (!isFeeder(o)) continue;
    const [cx, cy] = feederCenter(o);
    if (Math.hypot(cx - x, cy - y) <= r) out.push(o);
  }
  return out;
}
// can species `sp` eat item `id`
export function eats(sp, id) {
  const E = STOCK[sp]?.eats;
  if (!E || !ITEMS[id]) return false;
  return E === 'any' ? !!ITEMS[id].food || id === 'wheat' : E.includes(id);
}
// what a feeder accepts: animal feed (wheat, corn, anything edible for the pigs)
export const isFeed = (id) => !!ITEMS[id] && (!!ITEMS[id].food || id === 'wheat');
// slot index of something `sp` eats in a feeder, or −1
function feedSlot(o, sp) {
  const S = o.store?.slots || [];
  for (let i = 0; i < S.length; i++) if (S[i] && S[i].qty > 0 && eats(sp, S[i].id)) return i;
  return -1;
}

// ---------- spawning (host; called at the end of mobs.js createSpawners) ----------
// wild herds on open grassland (own seeded rng: the other spawners keep their layout), fish schools in the water
export function createStockSpawners(game) {
  const w = game.world, rand = mulberry32((w.seed | 0) * 977 + 41), S = game.spawners;
  const want = { cow: 7, sheep: 7, pig: 6, chicken: 8 };
  const have = { cow: 0, sheep: 0, pig: 0, chicken: 0 };
  const sx = w.spawn.x, sy = w.spawn.y;
  const added = [];
  for (let k = 0; k < 7000 && Object.keys(want).some((s) => have[s] < want[s]); k++) {
    const x = w.bx0 + 6 + Math.floor(rand() * (w.bx1 - w.bx0 - 12)), y = w.by0 + 6 + Math.floor(rand() * (w.by1 - w.by0 - 12));
    const i = w.idx(x, y);
    if (w.rock.get(i) || w.water.get(i) || w.solid?.get(i)) continue;
    const d = Math.hypot(x - sx, y - sy);
    const biome = w.biomeAt ? w.biomeAt(x + 0.5, y + 0.5) : 'meadow';
    const lush = w.lush ? w.lush.get(i) : 0.5;
    const cands = [];
    if (biome === 'meadow' && lush > 0.45) cands.push('cow', 'sheep');
    if (biome === 'meadow' || biome === 'shore') cands.push('chicken');
    if (biome === 'forest' || biome === 'birch' || (biome === 'meadow' && lush > 0.6)) cands.push('pig');
    if (!cands.length) continue;
    const sp = cands[Math.floor(rand() * cands.length)];
    if (have[sp] >= want[sp] || d < (SPECIES[sp].minD ?? 8)) continue;
    if (S.some((s) => Math.hypot(s.x - x, s.y - y) < 8) || added.some((s) => s.species === sp && Math.hypot(s.x - x, s.y - y) < 22)) continue;
    const [a, b] = STOCK[sp].herd;
    const s = { id: S.length + 1, species: sp, x: x + 0.5, y: y + 0.5, level: levelForDistance(d), count: a + Math.floor(rand() * (b - a + 1)), members: [], when: 'day', stock: true };
    S.push(s); added.push(s);
    have[sp]++;
  }
  // fish: schools in rivers and lakes (deep or shallow water, away from each other)
  let fish = 0;
  for (let k = 0; k < 9000 && fish < 34; k++) {
    const x = w.bx0 + 2 + Math.floor(rand() * (w.bx1 - w.bx0 - 4)), y = w.by0 + 2 + Math.floor(rand() * (w.by1 - w.by0 - 4));
    if (!w.water.get(w.idx(x, y))) continue;
    let wet = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.waterAt(x + dx, y + dy)) wet++;
    if (wet < 7) continue;
    if (S.some((s) => s.species === 'fish' && Math.hypot(s.x - x, s.y - y) < 11)) continue;
    S.push({ id: S.length + 1, species: 'fish', x: x + 0.5, y: y + 0.5, level: 1, count: 2 + Math.floor(rand() * 2), members: [], when: 'always', fish: true });
    fish++;
  }
}

// a spawner member just made by mobs.js spawnMember (host): farm animals and fish get their brain and fields
export function setupMember(game, m, s) {
  if (s.fish || m.species === 'fish') { setupFish(game, m, s); return; }
  if (!STOCK[m.species]) return;
  m.brain = stockBrain; m.stock = STOCK[m.species]; m.fed = 0.8 + game.net.roll() * 0.2; m.starveT = 0;
  m.variant = (m.id & 1) && game.net.roll() < (m.species === 'sheep' ? 0.15 : 0.45) ? 1 : 0; // (the second coat: black sheep are rare)
}
function setupFish(game, m, s) {
  const w = game.world;
  // spawnMember keeps creatures out of the water: put the fish back into it
  for (let k = 0; k < 14; k++) {
    const a = game.net.roll() * Math.PI * 2, r = game.net.roll() * 2.2;
    const x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
    if (w.waterAt(Math.floor(x), Math.floor(y))) { m.x = x; m.y = y; break; }
    if (k === 13) { m.x = s.x; m.y = s.y; }
  }
  m.home = { x: m.x, y: m.y };
  m.brain = fishBrain; m.water = true; m.noCorpse = true; m.scale = +(0.85 + game.net.roll() * 0.3).toFixed(3);
  m.onDeath = () => ({ give: { fish_raw: 1 }, toast: 'Você pegou um peixe!' }); // (a long shot / spear: less than a rod, fishing.js)
}

// a new farm animal (host): births, restored saves, tests
export function spawnStock(game, species, x, y, { baby = false, owned = true, variant = 0, fed = 1, level = null } = {}) {
  const sp = SPECIES[species], w = game.world;
  const lv = level ?? levelForDistance(Math.hypot(x - w.spawn.x, y - w.spawn.y));
  const st = mobStats(sp, lv);
  const ids = allocMob(game);
  const now = game.worldTime;
  const m = {
    isEntity: true, isMob: true, kind: 'animal', ...ids, species, name: nameOf(species, baby), level: lv, elite: false, temper: sp.temper,
    x, y, r: sp.r * (baby ? 0.7 : 1), scale: baby ? BABY_SCALE : +((sp.scale || 1) * (0.94 + game.net.roll() * 0.12)).toFixed(3), variant: (variant & ~2) | (baby ? 2 : 0), // (a horse's coat: bits 2-3)
    facing: game.net.roll() < 0.5 ? 'e' : 'w', moving: false, moveT: game.net.roll() * 10, action: null, flash: 0,
    dead: false, deadT: 0, hp: st.maxHp, maxHp: st.maxHp, dmg: 0, home: { x, y }, spawner: null, state: 'idle', stateT: 1 + game.net.roll() * 3, swingT: 0, stunT: 0,
    brain: stockBrain, stock: STOCK[species], owned, fed, starveT: 0, bornAt: now, adultAt: baby ? now + STOCK[species].grow * dayLen(game) : null,
    breedAt: now + (baby ? 0 : 0.25 * dayLen(game)),
  };
  game.entities.push(m); // sync-ok: host-only creature list (guests get proxies from net/entities.js)
  return m;
}

// a wild animal becomes the players' (tied or domesticated): out of its herd for good; the herd only refills after a
// while (a dead placeholder that "respawns" in 1.5 days: catching a herd does not make free animals appear at once)
export function takeFromHerd(game, m) {
  m.owned = true;
  const s = m.spawner;
  if (!s) return;
  m.spawner = null;
  const k = s.members.indexOf(m);
  if (k >= 0) s.members.splice(k, 1, { dead: true, deadT: 0, respawnAt: game.worldTime + 1.5 * dayLen(game), placeholder: true });
}

// ---------- brains (host) ----------
const leaderOf = (game, pid) => (pid ? allPlayers(game).find((q) => (q === game.player ? game.net.pid : q.pid) === pid) || null : null);
const tiedTo = (game, pid) => game.entities.filter((e) => e.stock && !e.dead && e.tiedTo === pid);

export function stockBrain(game, m, dt) {
  if (m.rider) { game.horses?.follow(m, dt); return; } // (a ridden horse keeps under its rider: horses.js)
  if (!tickStatus(game, m, dt)) return;
  if (m.state === 'flee' || m.fearT > 0) { if (!m.tiedTo) { updateCreature(game, m, dt); return; } m.state = 'idle'; m.fearT = 0; }
  const sp = SPECIES[m.species];
  if (m.tiedTo) { follow(game, m, dt, sp); return; }
  // domesticated and hungry: to the feeder, eat (a portion every ~2.5 s of nibbling)
  if (m.tame && m.wantEat) {
    const o = game.world.objById.get(m.feeder);
    if (isFeeder(o) && feedSlot(o, m.species) >= 0) {
      const [px, py] = edgePoint(o, m);
      if (Math.hypot(px - m.x, py - m.y) > 0.35) {
        const dir = steer(game, m, px, py, dt, sp.speed * 0.45, 0.25);
        if (dir) { go(game, m, dir, sp.speed * 0.45, dt); return; }
      }
      m.moving = false;
      const [cx, cy] = feederCenter(o);
      m.facing = facingFrom(cx - m.x, cy - m.y, m.facing);
      if (!m.action) m.action = { type: 'eat', t: 0, dur: 2.5 };
      m.eatT = (m.eatT || 0) + dt;
      if (m.eatT >= 2.5) { m.eatT = 0; eatFrom(game, m, o); }
      return;
    }
  }
  m.eatT = 0;
  if (m.action?.type === 'eat') m.action = null;
  // idle / wander around home (domesticated: the feeder's area); calm: they only run when hit
  if (m.state === 'wander' && m.wp) {
    m.stateT -= dt;
    const ws = sp.speed * (isBabyM(m) ? 0.36 : 0.28);
    const dir = steer(game, m, m.wp[0], m.wp[1], dt, ws, 0.3);
    if (!dir || m.stateT <= 0) { m.state = 'idle'; m.stateT = 3 + game.net.roll() * 7; m.moving = false; }
    else go(game, m, dir, ws, dt);
  } else {
    m.state = 'idle'; m.moving = false;
    m.stateT -= dt;
    if (m.stateT <= 0) {
      const fo = m.tame && m.feeder ? game.world.objById.get(m.feeder) : null; // (a horse away from any feeder: where it was left)
      const home = fo ? feederCenter(fo) : [m.home.x, m.home.y];
      m.home.x = home[0]; m.home.y = home[1];
      m.wp = pickWander(game, m, fo ? FEEDER_RANGE - 1.6 : m.species === 'horse' ? 2.5 : 5);
      m.state = 'wander'; m.stateT = 8; resetNav(m);
    }
  }
  if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.02 * dt);
}

// the nearest point just outside the feeder's footprint (where an animal stands to eat)
function edgePoint(o, m) {
  const fw = o.fw || 2, fh = o.fh || 1;
  const cx = Math.max(o.tx, Math.min(o.tx + fw, m.x)), cy = Math.max(o.ty, Math.min(o.ty + fh, m.y));
  let dx = m.x - cx, dy = m.y - cy;
  const L = Math.hypot(dx, dy);
  if (L < 1e-3) { dx = 0; dy = 1; } else { dx /= L; dy /= L; }
  const k = (m.r || 0.3) + 0.12;
  return [cx + dx * k, cy + dy * k];
}

// tied: keep behind the leader (a short queue), faster when the rope is long, snap when far too long
function follow(game, m, dt, sp) {
  const L = leaderOf(game, m.tiedTo);
  if (!L || L.dead || L.gone) { untie(game, m, 'leader'); return; }
  const mine = tiedTo(game, m.tiedTo);
  const idx = Math.max(0, mine.indexOf(m));
  const want = 1.5 + idx * 0.55 + (m.r || 0.3);
  const d = Math.hypot(L.x - m.x, L.y - m.y);
  if (d > 16) { untie(game, m, 'far'); return; }
  m.home.x = m.x; m.home.y = m.y;
  if (d <= want) { m.moving = false; m.state = 'idle'; if (d > 0.3) m.facing = facingFrom(L.x - m.x, L.y - m.y, m.facing); return; }
  const spd = Math.min(sp.speed * 1.7, (L.speed || 4) * (d > want + 2 ? 1.15 : 0.95));
  const dir = steer(game, m, L.x, L.y, dt, spd, want * 0.9, L.lv | 0);
  if (dir) go(game, m, dir, spd, dt);
  else { m.moving = false; }
}

// fish: idle drifts and short swims inside the water around home; dart away from someone wading close
export function fishBrain(game, m, dt) {
  const w = game.world;
  if (!tickStatus(game, m, dt)) return;
  if (w.frozenAt(m.x, m.y)) { m.moving = false; return; }
  m.stateT -= dt;
  const hk = m.hooked && game.fishing?.bobberOf?.(m.hooked);
  if (hk) { swimTo(game, m, hk.x, hk.y, 1.6, dt); return; }
  if (m.state === 'flee' && m.stateT > 0 && m.wp) { if (!swimTo(game, m, m.wp[0], m.wp[1], 3.2, dt)) m.stateT = 0; return; }
  // someone in the water next to it, or a splash (fishing.js / projectiles land): dart away
  if (!m._scare && m.state !== 'flee') for (const q of allPlayers(game)) if (!q.dead && Math.abs(q.x - m.x) < 1.6 && Math.abs(q.y - m.y) < 1.6 && Math.hypot(q.x - m.x, q.y - m.y) < 1.4) m._scare = { x: q.x, y: q.y, t: game.worldTime };
  const scare = m._scare;
  if (scare && scare.t > game.worldTime - 0.5) {
    m._scare = null;
    const a = Math.atan2(m.y - scare.y, m.x - scare.x);
    m.wp = waterPoint(game, m, m.x + Math.cos(a) * 3, m.y + Math.sin(a) * 3, 1.5) || m.wp;
    m.state = 'flee'; m.stateT = 1.2;
    return;
  }
  if (m.state === 'swim' && m.wp) {
    if (!swimTo(game, m, m.wp[0], m.wp[1], 0.9, dt) || m.stateT <= 0) { m.state = 'idle'; m.stateT = 1.5 + game.net.roll() * 4; m.moving = false; }
    return;
  }
  m.state = 'idle'; m.moving = false;
  if (m.stateT <= 0) {
    const a = game.net.roll() * Math.PI * 2, r = 1 + game.net.roll() * 3.5;
    m.wp = waterPoint(game, m, m.home.x + Math.cos(a) * r, m.home.y + Math.sin(a) * r, 1.2);
    if (m.wp) { m.state = 'swim'; m.stateT = 6; } else m.stateT = 1;
  }
}
// a water tile near (x, y) reachable in a straight line through water, or null
function waterPoint(game, m, x, y, jit) {
  const w = game.world;
  for (let k = 0; k < 6; k++) {
    const px = x + (game.net.roll() - 0.5) * jit * 2, py = y + (game.net.roll() - 0.5) * jit * 2;
    let ok = true;
    for (let s = 1; s <= 5 && ok; s++) { const u = s / 5; if (!w.liquidAt(Math.floor(m.x + (px - m.x) * u), Math.floor(m.y + (py - m.y) * u), true)) ok = false; } // (under: bridges and piers are water for a fish)
    if (ok) return [px, py];
  }
  return null;
}
function swimTo(game, m, x, y, spd, dt) {
  const w = game.world, dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy);
  if (d < 0.15) { m.moving = false; return false; }
  const s = Math.min(d, spd * dt), nx = m.x + (dx / d) * s, ny = m.y + (dy / d) * s;
  if (!w.liquidAt(Math.floor(nx), Math.floor(ny), true)) { m.moving = false; return false; } // (swims under decks too)
  m.x = nx; m.y = ny;
  m.facing = facingFrom(dx, dy, m.facing);
  m.moving = true;
  stepGait(m, s);
  return true;
}

// ---------- the farm clock (host, 1 Hz): domestication, hunger, starvation, births, growth ----------
function eatFrom(game, m, o) {
  const i = feedSlot(o, m.species);
  if (i < 0) { m.wantEat = false; return false; }
  if (!game.creative) {
    const slots = o.store.toJSON().map((s) => (s ? s.slice() : s));
    const s = slots[i];
    if (Array.isArray(s)) { s[1] -= 1; if (s[1] <= 0) slots[i] = null; }
    game.net.emit('chest.set', { id: o.id, slots, quiet: 1 });
  }
  m.fed = Math.min(1, (m.fed || 0) + portion(m) * (isBabyM(m) ? 2 : 1));
  m.starveT = 0;
  m.wantEat = m.fed <= eatAt(m);
  game.audio?.play('eat', { x: m.x, y: m.y, volume: 0.4 });
  return true;
}

function note(game, text, kind = 'info') { game.net.emit('stock.note', { text, kind }); }
const artigo = (sp) => (STOCK[sp]?.g === 'm' ? 'Um' : 'Uma');

function farmTick(game, dt) {
  const now = game.worldTime, D = dayLen(game);
  const herd = [];
  for (const m of game.entities) if (m.stock && m.isMob && !m.proxy) herd.push(m);
  // tied animals that died: the rope goes back to the leader
  for (const m of herd) if (m.dead && m.tiedTo) untie(game, m, 'dead');
  const byFeeder = new Map();
  for (const m of herd) {
    if (m.dead) continue;
    const S = STOCK[m.species];
    const f = m.tiedTo || m.rider ? null : feedersNear(game, m.x, m.y)[0] || null;
    const wasTame = !!m.tame;
    m.tame = S.always ? !!m.owned : !!f; // (a tamed horse stays tamed anywhere, and hungry anywhere: docs/HORSE.md)
    m.feeder = f ? f.id : null;
    if (m.tame && !m.owned) takeFromHerd(game, m);
    if (f && m.tame) { if (!byFeeder.has(f.id)) byFeeder.set(f.id, []); byFeeder.get(f.id).push(m); }
    if (f && m.tame && m.owned && (!wasTame || m._fid !== f.id)) { const [cx, cy] = feederCenter(f); m.home.x = cx; m.home.y = cy; }
    m._fid = f ? f.id : null;
    // growing up
    if (m.adultAt != null) {
      if (now >= m.adultAt) { m.adultAt = null; m.variant &= ~2; m.name = nameOf(m.species, false); m.scale = 1; m.r = SPECIES[m.species].r; }
      else { const k = 1 - (m.adultAt - now) / (STOCK[m.species].grow * D); m.scale = Math.round((BABY_SCALE + (1 - BABY_SCALE) * Math.max(0, k)) * 25) / 25; }
    }
    // hunger: only in a feeder's area (domesticated animals live off it); creative: never hungry
    m.hungry = m.tame && m.fed < HUNGRY_AT; m.starving = m.tame && m.starveT > 0; // (the nameplate / entity stream bits)
    if (!m.tame || game.creative) { m.starveT = 0; if (game.creative && m.tame) m.fed = 1; m.wantEat = false; continue; }
    m.fed = Math.max(0, (m.fed ?? 1) - dt / ((S.belly || BELLY_DAYS) * D) * (isBabyM(m) ? 0.5 : 1));
    m.wantEat = !!f && m.fed <= eatAt(m) && feedSlot(f, m.species) >= 0;
    // asleep far from every player (no brain running): it still eats, right where it is
    if (m.wantEat && minPlayerDist(game, m.x, m.y) > 50) eatFrom(game, m, f);
    if (m.fed <= 0) {
      const was = m.starveT || 0;
      m.starveT = was + dt;
      const lim = STARVE_DAYS * D, nm = nameOf(m.species, isBabyM(m)).toLowerCase();
      const where = S.always && !f ? ': leve-o ao alimentador!' : ' no alimentador!';
      if (was === 0) note(game, `${artigo(m.species)} ${nm} está passando fome${where}`, 'bad');
      if (was < lim * 0.6 && m.starveT >= lim * 0.6) note(game, `${artigo(m.species)} ${nm} vai morrer de fome: ${S.always ? 'trigo no alimentador!' : 'ponha comida no alimentador!'}`, 'bad');
      if (m.starveT >= lim) { note(game, `${artigo(m.species)} ${nm} morreu de fome.`, 'bad'); m.tame = false; killMob(game, m, null); }
    } else m.starveT = 0;
  }
  // births: two well-fed domesticated adults of a species at one feeder (below the feeder's cap) — now and then
  for (const [fid, list] of byFeeder) {
    if (list.length >= FEEDER_CAP) continue;
    for (const sp in STOCK) {
      if (STOCK[sp].noBreed) continue; // (horses: no foals)
      const ready = list.filter((m) => m.species === sp && !isBabyM(m) && !m.dead && m.fed >= BREED_FED && now >= (m.breedAt || 0));
      if (ready.length < 2 || game.net.roll() > 0.06 * dt) continue;
      const [a, b] = ready;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      const spot = mobBlocked(game.world, x, y, 0.2) ? [a.x, a.y] : [x, y];
      const kid = spawnStock(game, sp, spot[0], spot[1], { baby: true, owned: true, variant: game.net.roll() < 0.5 ? a.variant & 1 : b.variant & 1, fed: 0.8 });
      kid.tame = true; kid.feeder = fid;
      for (const q of [a, b]) { q.breedAt = now + STOCK[sp].breed * D; q.fed = Math.max(0, q.fed - 0.15); }
      const bn = STOCK[sp].baby.toLowerCase();
      note(game, `Nasceu um ${bn} na criação!`, 'good');
      break;
    }
  }
}

export function stockSystem() {
  let t = 0, restored = false;
  return {
    sync: 'host', // the farm clock runs on the host; guests see the result in the entity stream
    update(game, dt) {
      if (!restored) { restored = true; restoreStock(game); }
      t -= dt;
      if (t > 0) return;
      t = 1;
      farmTick(game, 1);
    },
  };
}

// ---------- ties (host side of mut/stock.js) ----------
export function canTie(game, m, pid) {
  if (!m || m.dead || !STOCK[m.species]) return 'Não dá para amarrar';
  if (m.tiedTo) return m.tiedTo === pid ? 'Já está amarrado' : 'Outro jogador já leva este animal';
  if (tiedTo(game, pid).length >= MAX_TIED) return `Você já leva ${MAX_TIED} animais (o máximo)`;
  return null;
}
export function tie(game, m, pid) {
  takeFromHerd(game, m);
  m.tiedTo = pid; m.tame = false; m.wantEat = false;
  m.state = 'idle'; m.fearT = 0; m.fleeT = 0; m.action = null; m.moving = false;
  resetNav(m);
}
// release (host): it stays where it is (in a feeder's area it is domesticated again); the rope goes back to the leader
export function untie(game, m, why = 'hand') {
  const pid = m.tiedTo;
  if (!pid) return;
  m.tiedTo = null;
  m.home.x = m.x; m.home.y = m.y;
  m.state = 'idle'; m.stateT = 2;
  const nm = nameOf(m.species, isBabyM(m)).toLowerCase();
  const toast = why === 'far' ? `A corda soltou: ${artigo(m.species).toLowerCase()} ${nm} ficou para trás` : why === 'dead' ? null : why === 'leader' ? null : undefined;
  game.net.emit('stock.rope', { nid: m.nid, on: 0, x: r2(m.x), y: r2(m.y), by: pid, give: { rope: 1 }, toast: toast || undefined, toastKind: 'info' });
}

// ---------- slaughter (host; combat.js dealDamage): a domesticated animal dies from one knife hit ----------
export function slaughter(game, src, m) {
  if (!m.stock || !m.tame || m.dead || src?.isMob) return false; // (a predator's bite is no slaughter)
  const w = src === game.player ? src.equip?.main : m.lastHitW;
  if (typeof w !== 'string' || !w.startsWith('knife_')) return false;
  const sp = SPECIES[m.species], baby = isBabyM(m);
  // the products at once (the knife's full table), a young one gives a share
  const { rows } = dropTable(game, m, sp.loot || [], true);
  if (baby) {
    const k = STOCK[m.species].babyLoot ?? 0.4;
    for (const r of rows) r[2] = Math.max(r[1] === sp.loot[0][0] ? 1 : 0, Math.round(r[2] * k));
  }
  const keep = rows.filter((r) => r[2] > 0);
  m.noCorpse = true; // (its body is made here, already butchered)
  m.onDeath = () => ({ rows: keep, toast: `${nameOf(m.species, baby)} abatid${STOCK[m.species].g === 'm' ? 'o' : 'a'}` });
  m.flash = 1;
  const x = m.x, y = m.y, f = m.facing;
  killMob(game, m, src);
  const id = game.net.newId('c');
  game.net.emit('corpse.add', { list: [[id, m.species, r2(x), r2(y), f === 'w' ? 'w' : 'e', r2(game.worldTime), 0, 0, 1, 0, 0, 0, m.scale || 1, m.variant | 0, 0, m.nid]] });
  return true;
}

// ---------- persistence (host save file only; the join snapshot never needs it: the entity stream shows them) ----------
// row: [species, x, y, variant, fed, bornAt, adultAt|0, breedAt, scale, level, hp, saddle, ridden by the saving host (horses; older saves: none)]
export function stockRows(game) {
  const out = [];
  for (const m of game.entities) {
    if (!m.stock || !m.owned || m.dead || m.proxy) continue;
    out.push([m.species, r2(m.x), r2(m.y), m.variant | 0, Math.round((m.fed ?? 1) * 1000) / 1000, Math.round(m.bornAt || 0), m.adultAt == null ? 0 : Math.round(m.adultAt),
      Math.round(m.breedAt || 0), m.scale || 1, m.level | 0, Math.round(m.hp), m.saddle ? 1 : 0, m.rider && m.rider === game.net.pid ? 1 : 0]); // [11] a horse's saddle, [12] the host rides it (docs/HORSE.md; a ridden one is saved too)
  }
  return out;
}
export function stashStock(game, rows) { game._stockLoad = Array.isArray(rows) ? rows.slice(0, 400) : null; }
function restoreStock(game) {
  const rows = game._stockLoad;
  game._stockLoad = null;
  if (!rows || !game.net.auth) return;
  const W = game.world;
  for (const r of rows) {
    if (!Array.isArray(r) || !STOCK[r[0]]) continue;
    const [sp, x, y, variant, fed, bornAt, adultAt, breedAt, scale, level, hp, saddle, ridden] = r;
    if (!(x > 0 && y > 0 && x < W.W && y < W.H)) continue;
    const m = spawnStock(game, sp, x, y, { baby: !!(variant & 2), variant: variant | 0, fed: Math.max(0, Math.min(1, +fed || 0)), level: level | 0 || null });
    m.bornAt = +bornAt || 0; m.adultAt = adultAt ? +adultAt : null; m.breedAt = +breedAt || 0;
    if (scale > 0.3 && scale < 1.5) m.scale = scale;
    if (STOCK[sp].always) { m.tame = true; m.saddle = !!saddle; if (ridden && m.saddle) game.horses?.remount(m); } // (a tamed horse: tamed anywhere, its saddle; the host back on the one it rode)
    if (hp > 0) m.hp = Math.min(m.maxHp, hp);
  }
}

// ---------- the owner's side: interacting with animals ----------
const ME = (game) => game.net.pid;
// tie / untie descriptor for an animal (null = nothing to do with it)
export function describeStock(game, m) {
  if (m && (m.species === 'horse' || m.species === 'wild_horse')) return game.horses?.describe(m) || null; // (horses: horses.js)
  if (!m || m.dead || !STOCK[m.species]) return null;
  const p = game.player, nm = nameOf(m.species, isBabyM(m)).toLowerCase();
  const base = { o: m, stockAnimal: true, x: m.x, y: m.y, reach: 0.9 + (m.r || 0.3) };
  if (m.tiedTo === ME(game)) return { ...base, kind: 'stock_untie', verb: `Soltar ${nm}`, icon: 'hand', prio: 4 };
  if (m.tiedTo) return null;
  if (p.inv.count('rope') < 1) return { ...base, kind: 'stock_tie', verb: 'Amarrar (precisa de corda)', icon: 'hand', prio: -1 };
  return { ...base, kind: 'stock_tie', verb: `Amarrar ${nm}`, icon: 'hand', prio: 3 };
}
function forNear(game, consider) {
  const p = game.player;
  for (const e of game.entities) {
    if (!e.isMob || e.dead || !(STOCK[e.species] || e.species === 'wild_horse') || e._riddenBy || Math.abs(e.x - p.x) > 3.5 || Math.abs(e.y - p.y) > 3.5) continue;
    consider(describeStock(game, e));
  }
}
// a tap / click on an animal (controller doTap): tie / untie it when possible; a domesticated one is only targeted
// (it dies from one knife hit: attacking it is the attack button's job, never a stray click)
function tapIt(game, e) {
  if (!(STOCK[e.species] || e.species === 'wild_horse') || e.dead) return null;
  const it = describeStock(game, e);
  if (it && it.prio >= 0) return it;
  if (e.tame) return { targetOnly: true };
  return null;
}

registerWork('stock_tie', {
  valid(g, it) { it.x = it.o.x; it.y = it.o.y; return !it.o.dead && !it.o.tiedTo; },
  start(game, it) {
    if (game.player.inv.count('rope') < 1) { game.events.emit('error', { text: 'Você precisa de uma corda (3 fibras)' }); return null; }
    return { type: 'gather', cycle: 0.7, need: 1, label: 'Amarrando' };
  },
  finish(game, wk) {
    const p = game.player, m = wk.it.o;
    if (m.dead || m.tiedTo || !p.inv.remove('rope', 1)) return true;
    game.events.emit('inventory', {});
    game.net.request('stock.tie', { nid: m.nid }, { refund: { rope: 1 }, onReject: (why) => game.events.emit('error', { text: why || 'Não deu para amarrar' }) });
    return true;
  },
});
registerWork('stock_untie', {
  valid(g, it) { it.x = it.o.x; it.y = it.o.y; return !it.o.dead && it.o.tiedTo === ME(g); },
  start: () => ({ type: 'gather', cycle: 0.45, need: 1, label: 'Soltando' }),
  finish(game, wk) { game.net.request('stock.untie', { nid: wk.it.o.nid }); return true; },
});

// ---------- the feeder's window ----------
export function feederAdapter(game, o) {
  const err = (t) => (why) => game.events.emit('error', { text: why || t });
  return {
    id: 'chest:' + o.id, title: 'Alimentador', label: 'Comida dos animais', icon: buildIco(game.A, 'feeder'), cols: 3, event: 'chest',
    items: () => o.store?.slots || [],
    put(i, n) {
      const p = game.player, s = p.inv.slots[i];
      if (!s || !o.store) return false;
      if (!isFeed(s.id)) { game.events.emit('error', { text: 'Só comida: trigo, milho ou outra comida' }); return false; }
      if (o.store.room(s.id) <= 0) { game.events.emit('error', { text: 'Alimentador cheio' }); return false; }
      const it = p.inv.takeFrom(i, n);
      if (!it) return false;
      game.net.request('chest.put', { id: o.id, item: it.id, qty: it.qty }, { refund: { [it.id]: it.qty }, onReject: err('Alimentador cheio') });
      return true;
    },
    take(i, n) {
      const s = o.store?.slots[i];
      if (!s) return false;
      const room = game.player.inv.room(s.id);
      if (room <= 0) { game.events.emit('error', { text: 'Mochila cheia' }); return false; }
      game.net.request('chest.take', { id: o.id, slot: i, qty: Math.min(room, n, s.qty) }, { onReject: err('Não deu') });
      return true;
    },
    sort(mode) { game.net.request('store.sort', { kind: 'chest', id: o.id, mode }, { onReject: err('Não deu para ordenar') }); },
    canOpen() {
      const p = game.player;
      return !!o.store && !o.removed && game.build.structures.includes(o) && Math.hypot(o.x - p.x, (o.cy ?? o.y) - p.y) <= 3;
    },
  };
}
export function openFeeder(game, o) {
  openContainer(game, feederAdapter(game, o));
  game.audio?.play('chest_open', { x: o.x, y: o.y });
}

// ---------- labels (ui/overlay.js nameplates) ----------
// "Vaca · domesticada" (gold), "· com fome" (orange), "· faminta" (red), "· amarrada" — null for other creatures
export function stockLabel(e) {
  if (!STOCK[e.species]) return null;
  if (e.species === 'horse') { // (docs/HORSE.md)
    const sad = e.saddle ? ' · selado' : '';
    if (e.starving) return [`${e.name} · faminto!`, '#ff6a50'];
    if (e.hungry) return [`${e.name} · com fome${sad}`, '#ffb050'];
    if (e.tiedTo) return [`${e.name} · amarrado`, '#e8d8a8'];
    return [`${e.name} · ${e.saddle ? 'selado' : 'domado'}`, '#f2d46a'];
  }
  const f = isBabyM(e) || STOCK[e.species].g === 'm' ? 'o' : 'a'; // (the young are all masculine: bezerro, cordeiro, leitão, pintinho)
  if (e.starving) return [`${e.name} · famint${f}!`, '#ff6a50'];
  if (e.tiedTo) return [`${e.name} · amarrad${f}`, '#e8d8a8'];
  if (e.tame) return e.hungry ? [`${e.name} · com fome`, '#ffb050'] : [`${e.name} · domesticad${f}`, '#f2d46a'];
  return null;
}

// ---------- cosmetic: ropes, feeder range, fertile soil while placing plots ----------
const ROPE_N = 10;
function leaderEnt(game, pid) {
  if (!pid) return null;
  if (pid === game.net.pid) return game.player;
  return game.session?.players?.get?.(pid)?.ent || null;
}
// one sagging rope from the leader's hand to the animal's neck, as depth-sorted segments (game.js collect)
function ropeDrawable(game, m, L) {
  const o = m._rope || (m._rope = { x: 0, y: 0, isRope: true, draw: null, m, L: null });
  o.m = m; o.L = L;
  o.x = (m.x + L.x) / 2; o.y = Math.max(m.y, L.y);
  o.draw = o.draw || ((B, A) => drawRope(game, B, A, o.m, o.L));
  return o;
}
const NECK = { cow: [0.62, 0.78], sheep: [0.42, 0.55], pig: [0.42, 0.42], chicken: [0.12, 0.42], horse: [0.62, 0.95] };
function drawRope(game, B, A, m, L) {
  if (!A.has('fx_rope') || m.dead) return;
  const s = A.get('fx_rope'), sc = m.scale || 1;
  const rot = game.cam.rot || 0, rc = Math.cos(rot), rs = Math.sin(rot);
  // ends: the leader's hand (a little to its side, ~0.55 up) and the animal's neck (toward its head)
  const F = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] }[m.facing] || [1, 0];
  const nk = NECK[m.species] || [0.4, 0.5];
  const ax = m.x + F[0] * nk[0] * sc, ay = m.y + F[1] * nk[0] * sc * 0.6, ah = nk[1] * sc;
  const bx = L.x + 0.12, by = L.y + 0.02, bh = 0.55;
  const d = Math.hypot(bx - ax, by - ay), sag = Math.max(0.05, 0.5 - d * 0.06);
  let px = 0, py = 0, ph = 0;
  for (let i = 0; i <= ROPE_N; i++) {
    const u = i / ROPE_N;
    const x = ax + (bx - ax) * u, y = ay + (by - ay) * u, h = ah + (bh - ah) * u - Math.sin(u * Math.PI) * sag;
    if (i) {
      // screen-space angle of this piece (turned camera: the world turned around the view)
      const dx = x - px, dy = y - py, vx = rc * dx + rs * dy, vy = -rs * dx + rc * dy - (h - ph);
      const len = Math.hypot(vx, vy);
      if (len > 1e-4) B.main.add(s, (x + px) / 2, (y + py) / 2, len / s.w * 1.12, 0.055 / s.h, 1, 1, 1, 1, 0, Math.atan2(vy, vx), 0, 1, 0, (h + ph) / 2);
    }
    px = x; py = y; ph = h;
  }
}

const RING_N = 48;
function rangeRing(B, A, cx, cy, r, a, col) {
  const s = A.has('fx_soft') ? A.get('fx_soft') : null;
  if (!s) return;
  for (let i = 0; i < RING_N; i++) {
    if (i & 1) continue; // dashed
    const t = (i / RING_N) * Math.PI * 2;
    B.ground.add(s, cx + Math.cos(t) * r, cy + Math.sin(t) * r, 0.24, 0.24, col[0], col[1], col[2], a);
  }
}

export function stockFxSystem() {
  let jumpT = 3;
  return {
    sync: 'cosmetic', // ropes, rings and soil marks drawn by every peer from replicated state; fish jumps (local)
    update(game, dt) {
      // now and then a fish in view leaps out of the water (cosmetic, each peer its own: art/livestockDraw.js _jump)
      jumpT -= dt;
      if (jumpT > 0) return;
      jumpT = 3 + Math.random() * 6;
      const v = game.view(), F = [];
      for (const e of game.entities) if (e.water && !e.dead && !game.world.frozenAt(e.x, e.y) && e.x > v.x0 && e.x < v.x1 && e.y > v.y0 && e.y < v.y1) F.push(e);
      if (!F.length) return;
      const f = F[Math.floor(Math.random() * F.length)], a = f._fh ?? Math.random() * Math.PI * 2;
      f._jump = { t0: game.time, dur: 0.75, dx: Math.cos(a) * 1.1, dy: Math.sin(a) * 1.1 };
      game.juice?.splash?.(f.x - Math.cos(a) * 0.55, f.y - Math.sin(a) * 0.55, 0.35);
      game.later(0.75, () => game.juice?.splash?.(f.x + Math.cos(a) * 0.55, f.y + Math.sin(a) * 0.55, 0.45));
      game.audio?.play('splash', { x: f.x, y: f.y, volume: 0.35 });
    },
    collect(game, list, v) {
      for (const m of game.entities) {
        if (!m.tiedTo || m.dead || !STOCK[m.species]) continue;
        if (m.x < v.x0 - 8 || m.x > v.x1 + 8 || m.y < v.y0 - 8 || m.y > v.y1 + 8) continue;
        const L = leaderEnt(game, m.tiedTo);
        if (L && !L.dead && Math.hypot(L.x - m.x, L.y - m.y) < 18) list.push(ropeDrawable(game, m, L));
      }
    },
    render(game, B, v) {
      const A = game.A, p = game.player, bm = game.build?.mode;
      // feeder range: around the feeder ghost while placing one, and faintly around feeders the player stands near
      if (bm?.kind === 'place' && bm.type && BUILDINGS[bm.type]?.feed) {
        for (const g of bm.tiles || []) { const [fw, fh] = bm.rot & 1 ? [1, 2] : [2, 1]; rangeRing(B, A, g.tx + fw / 2, g.ty + fh / 2, FEEDER_RANGE, 0.55, [1, 0.86, 0.45]); }
      } else if (!bm) {
        for (const o of feedersNear(game, p.x, p.y, FEEDER_RANGE + 3)) { const [cx, cy] = feederCenter(o); rangeRing(B, A, cx, cy, FEEDER_RANGE, 0.22, [1, 0.86, 0.45]); }
      }
      // fertile soil while placing farm plots with wheat seeds in the bag (green = fertile), and the plot to plant
      const tile = A.has('bp_tile') ? A.get('bp_tile') : A.has('fx_soft') ? A.get('fx_soft') : null;
      if (tile && bm?.kind === 'place' && bm.type === 'farm_plot' && p.inv.count('seed_wheat') > 0) {
        const h = bm.hover || [Math.floor(p.x), Math.floor(p.y)];
        for (let y = h[1] - 7; y <= h[1] + 7; y++) for (let x = h[0] - 9; x <= h[0] + 9; x++) {
          if (!game.world.inBounds(x, y) || game.world.water.get(game.world.idx(x, y)) || game.world.rock.get(game.world.idx(x, y))) continue;
          const ok = fertileAt(game.world, x, y); // (green = fertile soil, a faint red = not)
          B.ground.add(tile, x + 0.5, y + 1, 1, 1, ok ? 0.45 : 1, ok ? 1 : 0.35, ok ? 0.4 : 0.3, ok ? 0.3 : 0.13);
        }
        for (const g of bm.tiles || []) { const ok = fertileAt(game.world, g.tx, g.ty); B.ground.add(tile, g.tx + 0.5, g.ty + 1, 1, 1, ok ? 0.4 : 1, ok ? 1 : 0.3, ok ? 0.35 : 0.25, 0.45); }
      }
      const n = game.ctl?.near;
      if (n && n.kind === 'plant' && n.seed === 'seed_wheat' && tile) {
        const ok = !n.bad;
        B.ground.add(tile, n.tx + 0.5, n.ty + 1, 1, 1, ok ? 0.4 : 1, ok ? 1 : 0.3, ok ? 0.35 : 0.25, 0.5 + 0.15 * Math.sin(game.time * 5));
      }
    },
  };
}

// API for other modules (controller / building / overlay / tests): game.stock
export function installStock(game) {
  game.stock = {
    forNear: (consider) => forNear(game, consider),
    tapIt: (e) => tapIt(game, e),
    describe: (m) => describeStock(game, m),
    openFeeder: (o) => openFeeder(game, o),
    label: stockLabel,
    isFeed,
    // tests / dev (host): a farm animal at (x, y); run the farm clock for dt seconds at once (hunger, births, growth)
    debug: { spawn: (sp, x, y, o) => spawnStock(game, sp, x, y, o), tick: (dt = 1) => farmTick(game, dt), restore: () => restoreStock(game) },
  };
}

export { MAX_TIED, FEEDER_RANGE };
