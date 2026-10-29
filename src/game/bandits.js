// Bandit camps: 2–4 raider camps (world.zones type 'bandit_camp', else seeded open spots ≥ 60 tiles from
// the spawn) with tents, breakable crates, a campfire and a banner as world objects; 3–5 raiders each
// (kind 'pawn', faction 'bandit': melee with weapon specials, a kiting archer, an elite chief).
// Raiders patrol, aggro as a camp, leash home, use abilities (interruptible telegraphs) and respawn.
//
// World object types (CONTENT §5, drawn by the art): tent_0 | tent_1 | crate_0 | campfire | banner.
// Missing sprites get a tinted stand-in from the render hook below.

import { SPECIES } from './data.js';
import { weaponProfile, offhandProfile, equipArmor } from './content/weapons.js';
import { mobStats } from './stats.js';
import { mulberry32 } from '../engine/noise.js';
import { occAdd, occAddTiles, occRemove, steer, resetNav, mobBlocked } from './nav.js';
import { dealDamage, dist, faceTowards, hasLOS, reach, addDot, lootable, facingVec } from './combat.js';
import { aggro, aggroRadius, evade, go, fleeDir, tickStatus, pickWander } from './ai.js';
import { enterCombat, stunPlayer } from './player.js';
import { dropLoot } from './loot.js';
import { fireArrow } from './projectiles.js';
import { nextMobId, levelForDistance } from './mobs.js';

const CAMP_MIN_D = 60;
const LEASH = 30;
const BORED = 12;
const CAMP_RESPAWN = [240, 330];
const CRATE_RESPAWN = 600;

const SHIRTS = [[0.46, 0.17, 0.13], [0.34, 0.26, 0.19], [0.24, 0.26, 0.2], [0.5, 0.37, 0.22], [0.2, 0.2, 0.22], [0.4, 0.3, 0.32]];
const SKINS = [[0.96, 0.8, 0.66], [0.88, 0.68, 0.52], [0.74, 0.54, 0.38], [0.56, 0.38, 0.26], [0.42, 0.28, 0.2]];
const HAIRC = [[0.12, 0.09, 0.07], [0.3, 0.18, 0.1], [0.5, 0.32, 0.16], [0.62, 0.5, 0.32], [0.45, 0.42, 0.4], [0.55, 0.22, 0.1]];
const HAIR_M = ['short', 'mohawk', 'curly', 'short', 'bald'];
const HAIR_F = ['long', 'bun', 'ponytail', 'curly'];

// melee kits by camp tier (0 = closer / weaker, 1 = farther)
const MELEE_KITS = [
  [{ main: 'club_wood' }, { main: 'spear_stone' }, { main: 'axe_stone' }, { main: 'knife_stone', body: 'armor_leather' }, { main: 'spear_stone', off: 'shield_wood' }],
  [{ main: 'spear_copper', body: 'armor_leather' }, { main: 'axe_copper', head: 'hood_leather' }, { main: 'club_iron', body: 'armor_leather' },
   { main: 'sword_copper', off: 'shield_wood', head: 'hood_leather' }, { main: 'knife_copper', body: 'armor_leather', head: 'hood_leather' }],
];
const ARCHER_KITS = [{ main: 'bow_wood', head: 'hood_leather' }, { main: 'bow_wood', body: 'armor_leather', head: 'hood_leather' }];
const CHIEF_KITS = [
  { main: 'sword_copper', off: 'shield_wood', body: 'armor_leather', head: 'helmet_copper' },
  { main: 'sword_iron', off: 'shield_copper', body: 'armor_copper', head: 'helmet_copper' },
];

const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

// ---------- camp placement ----------
function openSpot(game, x, y, R) {
  const w = game.world;
  if (!w.inBounds(Math.floor(x - R - 2), Math.floor(y - R - 2)) || !w.inBounds(Math.floor(x + R + 2), Math.floor(y + R + 2))) return false;
  let trees = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue;
    const i = w.idx(Math.floor(x + dx), Math.floor(y + dy));
    if (w.rock[i] || w.water[i] || w.solid[i]) return false;
  }
  if (game.build?.structures?.some((s) => Math.hypot(s.x - x, s.y - y) < R + 6)) return false;
  w.forChunks(x - R, y - R, x + R, y + R, (c) => { for (const o of c.objects) if (o.type.startsWith('tree_') && Math.hypot(o.x - x, o.y - y) < R) trees++; });
  return trees <= 9;
}

export function findCampSpots(game) {
  const w = game.world, sx = w.spawn.x, sy = w.spawn.y;
  const zones = (w.zones || []).filter((z) => z.type === 'bandit_camp');
  if (zones.length) return zones.slice(0, 4).map((z) => ({ x: z.x, y: z.y, r: z.r || 6, zone: true }));
  const rand = mulberry32((w.seed | 0) * 131 + 17);
  const cands = [];
  for (const z of w.zones || []) {
    if (z.type !== 'clearing' && z.type !== 'meadow' && z.type !== 'birch' && z.type !== 'forest') continue;
    const d = Math.hypot(z.x - sx, z.y - sy);
    if (d < CAMP_MIN_D) continue;
    cands.push({ x: z.x, y: z.y, d, score: (z.type === 'clearing' ? 2 : z.type === 'meadow' ? 1.2 : 0.6) + rand() });
  }
  for (let k = 0; k < 400; k++) {
    const x = 12 + rand() * (w.W - 24), y = 12 + rand() * (w.H - 24);
    const d = Math.hypot(x - sx, y - sy);
    if (d >= CAMP_MIN_D) cands.push({ x, y, d, score: rand() * 0.8 });
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= 3) break;
    const x = Math.floor(c.x) + 0.5, y = Math.floor(c.y) + 0.5;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 48)) continue;
    if (!openSpot(game, x, y, 5)) continue;
    out.push({ x, y, r: 6 });
  }
  return out;
}

function clearArea(game, x, y, R) {
  const w = game.world;
  const kill = [];
  w.forChunks(x - R - 1, y - R - 1, x + R + 1, y + R + 1, (c) => {
    for (const o of c.objects) {
      if (o.building || o.camp) continue;
      if (Math.hypot(o.x - x, o.y - y) > R) continue;
      if (/^(tree_|bush|berrybush|boulder|pebble|stick|fibergrass|wild_)/.test(o.type)) kill.push(o);
    }
    if (c.decor) c.decor = c.decor.filter((d) => d.t === 'grass' || Math.hypot(d.x - x, d.y - y) > R - 0.5);
  });
  for (const o of kill) { occRemove(game, o); w.removeObject(o); o.gone = true; }
}

function addCampObject(game, camp, o) {
  const w = game.world;
  // reuse an object the world generator may already have placed here
  let found = null;
  w.forChunks(o.x - 1, o.y - 1, o.x + 1, o.y + 1, (c) => {
    for (const q of c.objects) if (!found && q.type === o.type && Math.hypot(q.x - o.x, q.y - o.y) < 1.2) found = q;
  });
  const obj = found || w.addObject({ v: 0, s: 1, f: 1, ...o });
  Object.assign(obj, { camp: camp.id });
  if (!found && obj.solid) occAdd(game, obj);
  camp.objects.push(obj);
  return obj;
}

function makeCrate(game, camp, x, y) {
  const o = addCampObject(game, camp, { type: 'crate_0', x, y, solid: 0.32, f: Math.random() < 0.5 ? 1 : -1 });
  Object.assign(o, { isProp: true, name: 'Caixote', temper: 'neutral', level: 1, r: 0.34, scale: 0.9, hp: 3, maxHp: 3, broken: false, onBreak: crateBreak });
  (game.props ||= []).push(o);
  camp.crates.push(o);
  return o;
}

function buildCamp(game, spot, id, tier, rand) {
  const w = game.world;
  const camp = { id: 'camp' + id, x: spot.x, y: spot.y, r: spot.r, tier, objects: [], crates: [], members: [], rand };
  if (!spot.zone) clearArea(game, spot.x, spot.y, 4.6);
  const cx = spot.x, cy = spot.y;
  addCampObject(game, camp, {
    type: 'campfire', x: cx, y: cy + 0.12, solid: 0.3, fire: true,
    light: { r: 1, g: 0.62, b: 0.3, radius: 6, intensity: 1.3, flicker: 0.25, lift: 0.3 },
  });
  addCampObject(game, camp, { type: 'banner', x: cx + 1.6, y: cy - 1.1, solid: 0.12 });
  const a0 = rand() * Math.PI * 2;
  for (let k = 0; k < 2; k++) {
    const a = a0 + k * Math.PI * (0.85 + rand() * 0.3);
    const tx = Math.floor(cx + Math.cos(a) * 3.3) + 0.5, ty = Math.floor(cy + Math.sin(a) * 2.6) + 1;
    const t = addCampObject(game, camp, { type: 'tent_' + (k % 2), x: tx, y: ty, solid: 0.62, f: Math.cos(a) > 0 ? -1 : 1 });
    occAddTiles(game, t, [[Math.floor(tx) - 1, Math.floor(ty - 0.05)], [Math.floor(tx) + 1, Math.floor(ty - 0.05)]]);
    makeCrate(game, camp, tx + (Math.cos(a) > 0 ? -1.5 : 1.5), ty + 0.6);
  }
  if (rand() < 0.6) makeCrate(game, camp, cx - 1.8, cy + 1.4);
  return camp;
}

// ---------- raiders ----------
function makeLook(rand, female, chief) {
  return {
    skin: pick(rand, SKINS), hair: female ? pick(rand, HAIR_F) : pick(rand, HAIR_M), hairColor: pick(rand, HAIRC),
    shirt: chief ? [0.56, 0.12, 0.1] : pick(rand, SHIRTS), beard: !female && rand() < 0.55,
    // rough outlaw extras (Art B): bandana, face mask/scar/eyepatch, dark trousers
    hat: rand() < 0.45 ? 'bandana' : undefined, hatColor: pick(rand, BANDANAS),
    face: chief ? 'scar' : rand() < 0.25 ? 'mask' : rand() < 0.2 ? 'scar' : rand() < 0.12 ? 'eyepatch' : undefined,
    pants: pick(rand, PANTS),
  };
}
const BANDANAS = [[0.62, 0.14, 0.12], [0.2, 0.22, 0.26], [0.42, 0.3, 0.18], [0.75, 0.6, 0.3]];
const PANTS = [[0.28, 0.24, 0.2], [0.22, 0.24, 0.28], [0.36, 0.3, 0.22], [0.18, 0.17, 0.16]];

function kitFor(camp, role, rand) {
  if (role === 'chief') return CHIEF_KITS[Math.min(1, camp.tier)];
  if (role === 'archer') return pick(rand, ARCHER_KITS);
  return pick(rand, MELEE_KITS[Math.min(1, camp.tier)]);
}

function spawnBandit(game, camp, role, slot) {
  const sp = SPECIES.bandit, rand = Math.random;
  const female = role !== 'chief' && rand() < 0.4;
  const kit = kitFor(camp, role, rand);
  const level = Math.max(1, camp.level + (role === 'chief' ? 2 : rand() < 0.3 ? 1 : 0));
  const st = mobStats(sp, level);
  const wp = weaponProfile(kit.main || null);
  const off = wp.twoHanded ? null : offhandProfile(kit.off || null);
  const wf = 0.6 + 0.4 * (((wp.min + wp.max) / 2) / 8); // weapon damage factor vs a stone spear (damped)
  const chief = role === 'chief';
  const a = (slot / 5) * Math.PI * 2 + rand() * 0.6;
  const post = { x: camp.x + Math.cos(a) * 2.2, y: camp.y + Math.sin(a) * 1.8 + 0.6 };
  let x = post.x, y = post.y;
  for (let k = 0; k < 10 && mobBlocked(game.world, x, y, sp.r); k++) { x = post.x + (rand() - 0.5) * 3; y = post.y + (rand() - 0.5) * 3; }
  const m = {
    isEntity: true, isMob: true, kind: 'pawn', faction: 'bandit', species: 'bandit', id: nextMobId(),
    name: chief ? 'Chefe dos saqueadores' : female ? 'Saqueadora' : 'Saqueador', level, elite: chief, role, camp: camp.id, campRef: camp,
    temper: 'hostile', x, y, r: sp.r, scale: chief ? 1.08 : 1, facing: rand() < 0.5 ? 'e' : 'w', moving: false, moveT: rand() * 10,
    action: null, flash: 0, dead: false, deadT: 0,
    hp: Math.round(st.maxHp * (chief ? 2.0 : role === 'archer' ? 0.8 : 1)), dmg: st.dmg * wf * (chief ? 1.2 : 1),
    home: { x, y }, state: 'idle', stateT: rand() * 4, swingT: 0, stunT: 0,
    look: makeLook(rand, female, chief), weapon: kit.main || null, offhand: off ? kit.off : null, armor: { body: kit.body || null, head: kit.head || null },
    wprof: wp, shield: off && off.type === 'shield' ? off : null, reachX: wp.reach, swingDur: wp.swing * (chief ? 1.05 : 1.15),
    armorV: equipArmor({ off: off ? kit.off : null, body: kit.body, head: kit.head }), aggroR: role === 'archer' ? 10 : sp.aggro,
    xpMul: chief ? 4.5 : sp.xp, specialT: 3 + rand() * 4, blockT: 4, throwT: 2, onDeath: banditDeath, patrol: rand() < 0.35 && !chief,
  };
  m.maxHp = m.hp;
  camp.members.push(m);
  game.entities.push(m);
  return m;
}

function populate(game, camp) {
  const n = 3 + Math.floor(camp.rand() * 3); // 3..5
  const roles = ['chief', 'archer'];
  while (roles.length < n) roles.push(camp.rand() < 0.2 && roles.filter((r) => r === 'archer').length < 2 ? 'archer' : 'melee');
  camp.roles = roles;
  roles.forEach((r, i) => spawnBandit(game, camp, r, i));
}

export function installBandits(game) {
  const w = game.world;
  game.camps = [];
  game.props = game.props || [];
  const spots = findCampSpots(game);
  spots.forEach((s, i) => {
    const rand = mulberry32((w.seed | 0) * 977 + i * 31 + 3);
    const d = Math.hypot(s.x - w.spawn.x, s.y - w.spawn.y);
    const camp = buildCamp(game, s, i + 1, d > 95 ? 1 : 0, rand);
    camp.level = levelForDistance(d, 1);
    populate(game, camp);
    game.camps.push(camp);
  });
  return game.camps;
}

// ---------- loot ----------
function drop(game, x, y, id, a = 1, b = a) {
  if (!lootable(id)) return false;
  const n = a + Math.floor(Math.random() * (b - a + 1));
  for (let k = 0; k < n; k++) dropLoot(game, x, y, id, 1);
  return n > 0;
}
function rollTable(game, x, y, rows, rolls) {
  let any = false;
  for (let k = 0; k < rolls; k++) {
    let tot = 0;
    for (const r of rows) if (lootable(r[0])) tot += r[3];
    if (tot <= 0) break;
    let u = Math.random() * tot;
    for (const r of rows) {
      if (!lootable(r[0])) continue;
      u -= r[3];
      if (u <= 0) { any = drop(game, x, y, r[0], r[1], r[2]) || any; break; }
    }
  }
  if (!any) drop(game, x, y, pick(Math.random, ['wood', 'stone', 'fiber']), 1, 2);
}
const BANDIT_LOOT = [
  ['arrow', 2, 5, 3], ['leather', 1, 2, 2], ['rope', 1, 1, 2], ['cloth', 1, 2, 1.5], ['cooked', 1, 2, 2], ['bandage', 1, 1, 1.5],
  ['copper_bar', 1, 1, 1.2], ['stick', 2, 3, 1], ['coal', 1, 2, 1], ['berries', 2, 3, 1],
];
const CRATE_LOOT = [
  ['arrow', 3, 8, 3], ['bandage', 1, 2, 2], ['rope', 1, 2, 2], ['cloth', 1, 3, 1.6], ['copper_bar', 1, 2, 1.6], ['iron_bar', 1, 1, 0.6],
  ['coal', 1, 3, 1.4], ['leather', 1, 2, 1.4], ['seed_potato', 1, 3, 1], ['seed_corn', 1, 2, 0.8], ['seed_cotton', 1, 2, 0.8],
  ['potato', 1, 3, 1], ['cooked', 1, 2, 1], ['copper_ore', 1, 3, 1], ['iron_ore', 1, 2, 0.6], ['knife_stone', 1, 1, 0.4], ['spear_stone', 1, 1, 0.3],
];

function banditDeath(game, m) {
  const x = m.x, y = m.y;
  if (m.role === 'archer') drop(game, x, y, 'arrow', 3, 7);
  if (m.weapon && Math.random() < (m.role === 'chief' ? 0.6 : 0.22)) drop(game, x, y, m.weapon);
  const ap = m.armor && (m.armor.body || m.armor.head);
  if (ap && Math.random() < (m.role === 'chief' ? 0.35 : 0.1)) drop(game, x, y, ap);
  if (m.offhand && Math.random() < 0.2) drop(game, x, y, m.offhand);
  if (m.role === 'chief') {
    drop(game, x, y, m.level >= 6 ? 'iron_bar' : 'copper_bar', 1, 2);
    drop(game, x, y, 'bandage', 1, 2);
    game.events.emit('toast', { text: 'Chefe dos saqueadores derrotado!', kind: 'good' });
  }
  rollTable(game, x, y, BANDIT_LOOT.filter((r) => r[0] !== 'iron_bar' || m.level >= 5), m.role === 'chief' ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0));
}

function crateBreak(game, o) {
  occRemove(game, o);
  game.world.removeObject(o); // the art never sees a broken crate; it comes back with the camp
  o.brokenAt = game.worldTime;
  rollTable(game, o.x, o.y - 0.1, CRATE_LOOT, 2 + Math.floor(Math.random() * 2));
  game.events.emit('toast', { text: 'Caixote quebrado', kind: 'info' });
  // the camp notices
  const camp = game.camps?.find((c) => c.id === o.camp);
  if (camp) for (const m of camp.members) if (!m.dead && dist(m, o) < 12 && m.state !== 'chase') aggro(game, m, game.player);
}

// ---------- AI ----------
function canSee(game, m, p) { return hasLOS(game.world, m.x, m.y, p.x, p.y); }

function meleeHit(game, m, p, mult, opts = {}) {
  const rng = reach(m, p);
  game.later(opts.delay ?? 0.22, () => {
    if (m.dead || m.stunT > 0 || p.dead || dist(m, p) > rng + 0.6) return;
    m.lastCombatT = game.worldTime;
    const crit = Math.random() < 0.06;
    const dmg = Math.max(1, Math.round(m.dmg * (m.enraged ? 1.3 : 1) * mult * (0.85 + Math.random() * 0.3) * (crit ? 1.5 : 1)));
    const got = dealDamage(game, m, p, dmg, { crit, ability: opts.ability });
    if (got > 0) opts.after?.(got);
  });
}

function shootAt(game, m, p, mult, kind = 'arrow', ability) {
  // lead the player a little when moving
  let tx = p.x, ty = p.y;
  if (p.moving) {
    const f = facingVec(p.facing), tFly = dist(m, p) / (kind === 'spear' ? 13 : 17);
    tx += f[0] * p.speed * tFly * 0.55; ty += f[1] * p.speed * tFly * 0.55;
  }
  const dmg = Math.max(1, Math.round(m.dmg * mult * (0.85 + Math.random() * 0.3)));
  fireArrow(game, {
    src: m, faction: 'bandit', x: m.x, y: m.y, tx, ty, range: 13, kind,
    onHit: (g, e, pr) => { dealDamage(g, m, e, dmg, { from: { x: pr.ox, y: pr.oy }, ranged: true, ability }); },
  });
}

// telegraphed special: m.cast shows a bar over the raider; stun/shove/shield bash interrupts it
function startCast(m, name, dur, fn) { m.cast = { name, t: 0, dur, fn }; m.moving = false; }

function special(game, m, p, d) {
  const type = m.wprof.type;
  if (type === 'club') {
    m.action = { type: 'smash', t: 0, hold: true };
    startCast(m, 'Esmagar', 0.7, () => {
      m.action = { type: 'smash', t: 0.4, dur: 0.35 };
      meleeHit(game, m, p, 1.3, { delay: 0.08, ability: 'smash', after: () => { if (!p.dead) stunPlayer(game, 0.9); } });
    });
  } else if (type === 'spear' && d > 2.6 && d < 7.5 && m.throwT <= 0 && canSee(game, m, p)) {
    m.throwT = 14;
    m.action = { type: 'throw', t: 0, dur: 0.5 };
    game.later(0.28, () => { if (!m.dead && !(m.stunT > 0)) shootAt(game, m, p, 1.3, 'spear'); });
  } else if (type === 'spear') {
    m.action = { type: 'pierce', t: 0, dur: 0.4 };
    meleeHit(game, m, p, 1.6, { ability: 'pierce' });
  } else if (type === 'axe') {
    m.action = { type: 'cleave', t: 0, dur: 0.45 };
    meleeHit(game, m, p, 1.45, { ability: 'cleave' });
  } else if (type === 'knife') {
    m.action = { type: 'attack', t: 0, dur: 0.35 };
    meleeHit(game, m, p, 0.8, { ability: 'lacerate', after: () => addDot(game, p, 'bleed', { dur: 6, tick: 1.5, dmg: Math.max(1, Math.round(m.dmg * 0.35)), src: m }) });
  } else if (m.role === 'chief' && d < 2.6) {
    m.action = { type: 'attack', t: 0, dur: 0.5 };
    m.spinT = 0.5;
    game.juice.whirl(m);
    meleeHit(game, m, p, 1.2, { delay: 0.2, ability: 'whirlwind' });
  } else {
    m.action = { type: 'attack', t: 0, dur: 0.34 };
    meleeHit(game, m, p, 1.7, { ability: 'strike' });
  }
  game.audio?.play('swing', { x: m.x, y: m.y });
}

export function updateBandit(game, m, dt) {
  const p = game.player;
  const sp = SPECIES.bandit;
  if (!tickStatus(game, m, dt)) { m.blocking = false; return; }
  const d = dist(m, p);
  const camp = m.campRef;
  m.thinkT = (m.thinkT || 0) - dt;
  m.specialT -= dt; m.blockT -= dt; m.throwT -= dt;
  if (m.blocking) { m.blockLeft -= dt; if (m.blockLeft <= 0) m.blocking = false; }
  if (m.spinT > 0) { m.spinT -= dt; m.facing = ['s', 'e', 'n', 'w'][Math.floor(m.spinT * 16) % 4]; }

  // telegraphed casts
  if (m.cast) {
    m.cast.t += dt;
    m.moving = false;
    if (m.state === 'chase') faceTowards(m, p);
    if (m.cast.t >= m.cast.dur) { const fn = m.cast.fn; m.cast = null; fn?.(); }
    return;
  }

  switch (m.state) {
    case 'idle':
    case 'wander': {
      if (m.thinkT <= 0) {
        m.thinkT = 0.3 + Math.random() * 0.15;
        if (!p.dead && d < aggroRadius(m, p) && !(m.calmT > 0) && canSee(game, m, p)) { aggro(game, m, p); break; }
      }
      if (m.state === 'idle') {
        m.moving = false;
        m.stateT -= dt;
        if (m.stateT <= 0) {
          if (m.patrol) {
            m.pa = (m.pa ?? Math.random() * 6) + 1;
            const a = (m.pa / 6) * Math.PI * 2;
            m.wp = [camp.x + Math.cos(a) * 6.5, camp.y + Math.sin(a) * 5];
          } else m.wp = pickWander(game, m, 2.5);
          m.state = 'wander';
          m.stateT = 9;
          resetNav(m);
        }
      } else {
        m.stateT -= dt;
        const spd = sp.speed * (m.patrol ? 0.42 : 0.3);
        const dir = steer(game, m, m.wp[0], m.wp[1], dt, spd, 0.35);
        if (!dir || m.stateT <= 0) { m.state = 'idle'; m.stateT = m.patrol ? 0.5 + Math.random() : 3 + Math.random() * 6; m.moving = false; }
        else go(game, m, dir, spd, dt);
      }
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.04 * dt);
      break;
    }

    case 'flee': // only reachable through generic helpers; raiders regroup
      m.state = 'chase';
      break;

    case 'chase': {
      const t = m.threat;
      const homeD = Math.hypot(m.x - camp.x, m.y - camp.y);
      if (!t || t.dead || homeD > LEASH || game.worldTime - (m.lastCombatT || 0) > BORED || (m.nav && m.nav.fails > 4)) { evade(m, homeD > LEASH ? 3 : 8); break; }
      if (t === p) enterCombat(p, 1);
      if (m.role === 'chief') {
        if (!m.enraged && m.hp < m.maxHp * 0.3) {
          m.enraged = true; m.swingDur *= 0.85;
          game.events.emit('damage', { target: m, src: m, amount: 0, kind: 'status', text: 'Enfurecido!', dtype: 'fire' });
          game.audio?.play('growl', { x: m.x, y: m.y });
        }
        if (m.shield && !m.blocking && m.blockT <= 0 && m.hp < m.maxHp * 0.6 && d < 3) {
          m.blocking = true; m.blockLeft = 2; m.blockT = 11;
          m.action = { type: 'block', t: 0, dur: 0.25 };
          faceTowards(m, p);
          break;
        }
      }
      if (m.blocking) { faceTowards(m, p); m.moving = false; break; }
      if (m.wprof.ranged) { archer(game, m, p, d, dt); break; }
      const rng = reach(m, t);
      // spear throw from mid range
      if (m.wprof.type === 'spear' && m.throwT <= 0 && m.specialT <= 0 && d > 2.6 && d < 7.5 && canSee(game, m, p)) {
        faceTowards(m, p); m.specialT = 6 + Math.random() * 3; special(game, m, p, d); break;
      }
      if (d <= rng) {
        m.moving = false;
        faceTowards(m, t);
        if (m.swingT <= 0) {
          m.swingT = m.swingDur * (0.9 + Math.random() * 0.2);
          if (m.specialT <= 0) { m.specialT = 7 + Math.random() * 4; special(game, m, p, d); }
          else {
            m.action = { type: m.wprof.act === 'shoot' ? 'attack' : m.wprof.act, t: 0, dur: 0.4 };
            game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
            meleeHit(game, m, p, 1);
          }
        }
      } else {
        const dir = steer(game, m, t.x, t.y, dt, sp.speed, rng * 0.85);
        go(game, m, dir, sp.speed, dt);
      }
      break;
    }

    case 'evade': {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.3 * dt);
      m.stateT -= dt;
      m.enraged = false;
      if (m.stateT <= 0) { m.x = m.home.x; m.y = m.home.y; }
      const dir = steer(game, m, m.home.x, m.home.y, dt, sp.speed * 1.4, 0.8);
      if (!dir) { m.hp = m.maxHp; m.state = 'idle'; m.stateT = 1.5; m.moving = false; resetNav(m); }
      else go(game, m, dir, sp.speed * 1.4, dt);
      break;
    }
    default:
      m.state = 'idle'; m.stateT = 1;
  }
}

// archer: keep 5–8 tiles, step back when rushed, aimed shot telegraph every ~9 s
function archer(game, m, p, d, dt) {
  const sp = SPECIES.bandit;
  const see = canSee(game, m, p);
  // rushed: back off for a moment (every few seconds), otherwise stand and shoot even point-blank
  m.kiteCd = (m.kiteCd || 0) - dt;
  if (d < 3.4 && m.kiteCd <= 0) { m.kiting = 1.3; m.kiteCd = 4.5; }
  if (m.kiting > 0) {
    m.kiting -= dt;
    const dir = fleeDir(game, m, p, Math.hypot(m.x - m.campRef.x, m.y - m.campRef.y) > LEASH - 8 ? 1.4 : 0.3);
    go(game, m, dir, sp.speed * 0.95, dt);
    return;
  }
  if (d > 9 || !see) {
    const dir = steer(game, m, p.x, p.y, dt, sp.speed, 4.5);
    go(game, m, dir, sp.speed, dt);
    return;
  }
  m.moving = false;
  faceTowards(m, p);
  if (m.swingT > 0) return;
  m.swingT = m.swingDur * (0.95 + Math.random() * 0.25);
  if (m.specialT <= 0 && d > 3) {
    m.specialT = 8 + Math.random() * 4;
    m.action = { type: 'shoot', t: 0, hold: true };
    startCast(m, 'Tiro Mirado', 1.3, () => {
      if (m.dead) return;
      m.action = { type: 'shoot', t: 0.55, dur: 0.3 };
      faceTowards(m, p);
      shootAt(game, m, p, 2.1, 'arrow', 'aimed_shot');
      game.audio?.play('swing', { x: m.x, y: m.y });
    });
    return;
  }
  m.action = { type: 'shoot', t: 0, dur: 0.6 };
  game.later(0.34, () => {
    if (m.dead || m.stunT > 0 || p.dead) return;
    faceTowards(m, p);
    shootAt(game, m, p, 1);
    game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
  });
}

// ---------- camp system: respawns, crate rebuilds, stand-in art ----------
const FB = { tent_0: ['bed', 2.1, [0.78, 0.64, 0.46]], tent_1: ['bed', 2.1, [0.62, 0.5, 0.4]], crate_0: ['chest', 0.85, [0.86, 0.7, 0.5]], banner: ['torch', 1.6, [0.85, 0.25, 0.2]] };

export function banditsSystem() {
  let slowT = 0;
  return {
    update(game, dt) {
      slowT -= dt;
      if (slowT > 0 || !game.camps) return;
      slowT = 2;
      const p = game.player, now = game.worldTime;
      for (const camp of game.camps) {
        const far = Math.hypot(camp.x - p.x, camp.y - p.y) > 36;
        for (let i = camp.members.length - 1; i >= 0; i--) {
          const m = camp.members[i];
          if (!m.dead) continue;
          if (!m._camprs) { m._camprs = true; m.respawnAt = now + CAMP_RESPAWN[0] + Math.random() * (CAMP_RESPAWN[1] - CAMP_RESPAWN[0]); }
          if (now < m.respawnAt || !far) continue;
          camp.members.splice(i, 1);
          const k = game.entities.indexOf(m);
          if (k >= 0) game.entities.splice(k, 1);
          spawnBandit(game, camp, m.role, i);
        }
        for (const o of camp.crates) {
          if (!o.broken || now - (o.brokenAt || 0) < CRATE_RESPAWN || !far) continue;
          o.broken = false; o.hp = o.maxHp; o.flash = 0;
          game.world.addObject(o); occAdd(game, o);
        }
      }
    },
    // optional y-sorted path (same core hook as projectiles.js); otherwise render() draws them late
    collect(game, list, v) {
      if (!game.camps) return;
      game._campSorted = game.time;
      const pool = game._campPool || (game._campPool = []);
      let n = 0;
      forStandIns(game, v, (o) => {
        const d = pool[n] || (pool[n] = { type: 'fx_standin', x: 0, y: 0, o: null, draw(B, A) { drawStandIn(B, A, this.o); } });
        d.o = o; d.x = o.x; d.y = o.y; n++;
        list.push(d);
      });
    },
    render(game, B, v) {
      if (!game.camps || game._campSorted === game.time) return;
      forStandIns(game, v, (o) => drawStandIn(B, game.A, o));
    },
  };
}

// camp objects whose sprite is missing from the atlas (Art A pending) get a tinted stand-in
function forStandIns(game, v, fn) {
  const A = game.A;
  for (const camp of game.camps) {
    if (camp.x < v.x0 - 6 || camp.x > v.x1 + 6 || camp.y < v.y0 - 6 || camp.y > v.y1 + 8) continue;
    for (const o of camp.objects) {
      const fb = FB[o.type];
      if (!fb || A.has(o.type) || A.groups[o.type] || o.broken || !A.has(fb[0])) continue;
      fn(o);
    }
  }
}
function drawStandIn(B, A, o) {
  const fb = FB[o.type];
  const s = A.get(fb[0]), c = fb[2], sc = fb[1] * (o.s || 1);
  B.main.add(s, o.x, o.y, sc, sc, c[0], c[1], c[2], 1, 0, 0, o.flash || 0, o.f || 1);
}
