// The winter attack on a settlement BY NUMBERS (docs/REINOS.md §16): the same match-up the live wave plays near the
// players — the place's live guards (melee + archers, game/people.js) against a wave of the region's dead a bit smaller
// than them (game/content/raids.js) — fought in rounds of a few seconds: the wave walks in under the archers' arrows,
// breaks a piece of the wall (a palisade log, a stone wall, the gate; an open village: straight to its edge), then the
// melee at the gap (a few at a time, more as they spill in), the archers shooting all along, until the wave is dead (the
// place HELD), the defense collapses (LOST: few melee guards left and monsters still standing) or the dawn comes (the
// dead crumble: held). Pure (node can import it: tools/raid-calib.mjs measures the loss rate over thousands of attacks):
// every number comes from the game's own tables — the creatures (content/combat.js SPECIES, stats.js mobStats), the
// weapons and armour (content/weapons.js), the night's kits (undead.js), the guards' kit (game/people.js).
//
//   guardsOf(s) → { n, melee, archers }            the watch of a place (people.js buildPeople: the same rule)
//   unitStats(role, lv, o) → { hp, dps, armor, …}   one creature's numbers (role: 'guard' | 'archer' | a night species)
//   furyOf(place) → the strength factor of a normal wave there (RAID.par)
//   planWave(place, R, { horde, n }) → the wave: { n, f, giant, horde, fury, mlv, glv, fam, species }
//   fight(place, wave, R, o) → { out 'held'|'lost', t, gDead { melee, archers }, mDead, breach, gate, left, … }
// place: { kind 'village'|'castle'|'city', walls 'palisade'|'stone'|null, pop, fam 'ice'|'bone'|'sand', giantOk, glv,
// mlv, guards { n, melee, archers } (alive), dark (game seconds of night left) }. R: a random function 0..1.

import { SPECIES } from './content/combat.js';
import { mobStats } from './stats.js';
import { weaponProfile, offhandProfile, equipArmor, armorReduction } from './content/weapons.js';
import { GUARDS, ARCHER_SHARE } from './content/people.js';
import { RAID, waveCount } from './content/raids.js';

export const FAMILY_MOB = { ice: 'walker', bone: 'skeleton', sand: 'mummy' };
export const FAMILY_GIANT = { ice: 'giant', bone: 'skeleton_giant', sand: 'mummy_giant' };
// the walkers' breaking of walls (walkers.js SIEGE_S / SIEGE_WOOD: walker-seconds of hitting for one piece; giants ×8)
const SIEGE = { wood: 105, stone: 350 }, GIANT_SIEGE = 8;
// the raiders' brain (bandits.js special): a strike × 1.7 / a pierce × 1.6 every 7–11 s — about a quarter of a monster's
// blows near the walls (measured in WA6)
const SPECIAL = 1 + 0.25 * 0.65;

// ---------- the watch of a place (people.js buildPeople) ----------
export function guardsOf(s) {
  const total = Math.max(4, s.pop | 0), kind = s.kind;
  const n = Math.max(2, kind === 'village' ? GUARDS.village + (s.walls ? 2 : 0) : Math.round(total * GUARDS[kind]));
  const archers = Math.max(kind === 'village' ? 1 : 2, Math.round(n * ARCHER_SHARE[kind]));
  return { n, archers: Math.min(n, archers), melee: Math.max(0, n - archers) };
}

// ---------- one creature's numbers ----------
const KIT = { village: { melee: ['spear_copper', 'sword_copper', 'spear_iron'], head: 'helmet_copper', bow: 'bow_wood' }, other: { melee: ['spear_iron', 'sword_iron', 'spear_iron'], head: 'helmet_iron', bow: 'bow_composite' } };
const avgOf = (ids) => { let a = 0, s = 0; for (const id of ids) { const p = weaponProfile(id); a += (p.min + p.max) / 2; s += p.swing; } return { avg: a / ids.length, swing: s / ids.length }; };
const SHIELD = offhandProfile('shield_iron');
const MEMO = new Map();
// role: 'guard' (melee) | 'archer' | 'walker' | 'skeleton' | 'mummy' | 'giant' | 'skeleton_giant' | 'mummy_giant'
// o.kind (guards: the place's kind — copper in villages, iron elsewhere), o.fury (a raid monster: hp and damage ×)
export function unitStats(role, lv, o = {}) {
  const key = `${role}|${lv}|${o.kind || ''}|${o.fury || 1}`;
  let U = MEMO.get(key);
  if (U) return U;
  const fury = o.fury || 1;
  if (role === 'guard' || role === 'archer') {
    // people.js spawnNpc: hp × 1.6, damage × the weapon factor × 1.5, swing × 1.12, armour = shield + helmet + 4 (archers
    // wear the hood and get the shield's value too, without its block); a heavy blow (× 1.6) every 6–10 s
    const K = KIT[o.kind === 'village' ? 'village' : 'other'], arch = role === 'archer', st = mobStats(SPECIES.guard, lv);
    const w = avgOf(arch ? [K.bow] : K.melee), wf = 0.7 + 0.4 * (w.avg / 8);
    const dmg = st.dmg * wf * 1.5, swing = w.swing * 1.12 * (arch ? 1.1 : 1);
    U = { role, lv, hp: Math.round(st.maxHp * 1.6), dmg, dps: (dmg * (arch ? 1 : 1.12)) / swing, armor: equipArmor({ off: 'shield_iron', head: arch ? 'hood_leather' : K.head }) + 4,
      block: arch ? 0 : SHIELD.blockChance * SHIELD.passiveReduce, ranged: arch, giant: false };
  } else if (SPECIES[role]?.giant) {
    // giants.js: the smash every swing + its wind-up, on the spot it marks (often two of the people around it); armour 12
    const sp = SPECIES[role], st = mobStats(sp, lv), swing = (role === 'giant' ? 3.0 : sp.swing) + 1.15;
    U = { role, lv, hp: Math.round(st.maxHp * fury), dmg: st.dmg * fury, dps: (st.dmg * fury * 1.5) / swing, armor: 12, block: 0, ranged: false, giant: true, siege: GIANT_SIEGE, pierceK: role === 'skeleton_giant' ? 0.8 : 1 };
  } else {
    // the night's dead (undead.js nightKit): the expected numbers over their kits
    const sp = SPECIES[role] || SPECIES.walker, st = mobStats(sp, lv);
    const kits = role === 'skeleton'
      ? [[0.3, 'bow_wood', null, 1.1, true], [0.38, 'sword_bone', null, 1.1], [0.32, 'spear_bone', null, 1.1]]
      : role === 'mummy' ? [[0.4, 'sword_copper', 1.05, 1.25], [0.6, null, 1.0, null, false, 2.2]]
        : [[0.55, 'sword_ice', null, 1.15], [0.45, 'spear_ice', null, 1.15]];
    let dps = 0, rshare = 0, rdps = 0;
    for (const [p, wid, dmgK, swK, ranged, swing0] of kits) {
      const wp = weaponProfile(wid), wf = dmgK ?? 0.6 + 0.4 * (((wp.min + wp.max) / 2) / 8);
      const swing = swing0 ?? wp.swing * swK, d = (st.dmg * wf * fury) / swing;
      if (ranged) { rshare += p; rdps += d; } else dps += p * d;
    }
    U = { role, lv, hp: Math.round(st.maxHp * fury), dps: (dps / Math.max(0.01, 1 - rshare)) * SPECIAL, rdps, rshare, armor: role === 'skeleton' ? 2 : role === 'mummy' ? 6 : 4, block: 0, ranged: false, giant: false,
      siege: 1, pierceK: role === 'skeleton' ? 0.7 : 1 };
  }
  MEMO.set(key, U);
  return U;
}
// a's damage per second on b (armour by a's level, b's shield)
export const effDps = (a, b, dps = a.dps, ranged = a.ranged) => dps * (1 - armorReduction(b.armor, a.lv)) * (1 - (ranged ? 0 : b.block || 0)) * (ranged ? b.pierceK || 1 : 1);
// fighting worth of a unit against another: what it survives × what it deals (Lanchester's "power")
export const powerVs = (a, b) => a.hp * effDps(a, b);

// the strength factor of a normal wave at a place: each monster ≈ 1 / RAID.par of a melee guard of the place
export function furyOf(place) {
  const g = unitStats('guard', place.glv, { kind: place.kind }), m = unitStats(FAMILY_MOB[place.fam] || 'walker', place.mlv);
  const r = powerVs(g, m) / Math.max(1e-6, powerVs(m, g)); // (fury f: the monster's power × f² — hp × f, damage × f)
  const par = RAID.par[place.kind] ?? RAID.par.village ?? RAID.par;
  return Math.max(RAID.furyMin, Math.min(RAID.furyMax, Math.sqrt(r / par)));
}

// ---------- the wave ----------
// o.horde: force it (true / false; else rolled) · o.n: force the count of monsters (a giant counts as RAID.giantK)
export function planWave(place, R, o = {}) {
  const horde = o.horde ?? R() < RAID.horde.p;
  const sz = horde ? RAID.horde.size : RAID.size;
  const f = sz[0] + (sz[1] - sz[0]) * R();
  const g = Math.max(1, place.guards.n);
  let n = o.n ?? waveCount(g, f);
  const gp = (RAID.giant[place.kind] || 0) * (horde ? 1.6 : 1);
  const giant = place.giantOk && n > RAID.giantK + 1 && (o.giant ?? R() < gp) ? FAMILY_GIANT[place.fam] : null;
  const hk = RAID.horde.k[place.kind] ?? RAID.horde.k.village ?? RAID.horde.k;
  const fury = furyOf(place) * (horde ? hk : 1); // (a horde: hp and damage × k)
  return { n, f, units: giant ? n - RAID.giantK : n, giant, horde: !!horde, fury, mlv: place.mlv, glv: place.glv, fam: place.fam, species: FAMILY_MOB[place.fam] || 'walker' };
}

// ---------- the fight ----------
const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];
// o: { dt (s a round), eff { g, m, a } (how well the live AI fights: measured — docs/REINOS.md §16) }
export function fight(place, wave, R, o = {}) {
  const dt = o.dt || 2, eff = { ...RAID.eff, ...(o.eff || {}) };
  const G = unitStats('guard', place.glv, { kind: place.kind }), A = unitStats('archer', place.glv, { kind: place.kind });
  const M = unitStats(wave.species, wave.mlv, { fury: wave.fury }), GI = wave.giant ? unitStats(wave.giant, wave.mlv, { fury: wave.fury }) : null;
  const mel = Array.from({ length: place.guards.melee }, () => G.hp), arch = Array.from({ length: place.guards.archers }, () => A.hp);
  // the wave: skeleton archers shoot from where they stand; the giant (one unit, much bigger)
  const mon = [];
  for (let k = 0; k < wave.units; k++) mon.push({ hp: M.hp, ranged: M.rshare > 0 && R() < M.rshare, u: M });
  if (GI) mon.push({ hp: GI.hp, ranged: false, u: GI, giant: true });
  const mel0 = mel.length, lostMel = place.kind === 'village' ? Math.min(1, Math.floor(mel0 * RAID.lost.melee)) : Math.floor(mel0 * RAID.lost.melee);
  const alive = (a) => a.filter((h) => h > 0).length, aliveM = () => mon.filter((m) => m.hp > 0);
  const walled = !!place.walls;
  // where it hits: a stone wall, a palisade log or — now and then — the gate (wooden gates break like a log; the ram is
  // not theirs); time to break it with the hitters at it (≤ 4 at a piece; a giant × 8)
  const gate = walled && R() < (place.kind === 'village' ? 0.35 : 0.25);
  const pieceS = !walled ? 0 : gate || place.walls === 'palisade' ? SIEGE.wood : SIEGE.stone;
  let breachLeft = pieceS, breach = !walled, t = 0, inT = 0, out = null, lostAt = -1;
  // the approach: the last ~15 tiles under the archers (3 tiles/s)
  const approach = 5 + R() * 2;
  const dark = place.dark ?? 200;
  // a blow on one of the first `k` standing (the front: the guards holding the gap, the monsters pushing through it — both
  // sides gang up on who is in front of them); k 0 = anyone
  const hitG = (arr, U, dmg, k = 0) => { const L = []; for (let i = 0; i < arr.length && (!k || L.length < k); i++) if (arr[i] > 0) L.push(i); if (!L.length) return false; const i = pick(R, L); arr[i] -= dmg; return true; };
  const hitM = (dmg, ranged, k = 0) => { let L = aliveM(); if (!L.length) return; if (k) L = L.filter((m) => !m.ranged).slice(0, k); if (!L.length) L = aliveM(); const m = pick(R, L); m.hp -= ranged ? dmg * (m.u.pierceK || 1) : dmg; };
  while (t < dark) {
    t += dt;
    const ms = aliveM();
    if (!ms.length) { out = 'held'; break; }
    const roll = () => 0.6 + 0.8 * R();
    // the archers shoot all along (from the wall / behind the line): a share of them has it in reach
    for (let i = 0; i < arch.length; i++) if (arch[i] > 0) hitM(effDps(A, M) * dt * eff.a * roll(), true);
    if (t <= approach) continue;
    if (!breach) {
      // breaking the piece: the monsters at it (≤ 4) and the giant; the skeleton archers shoot at the wall's archers
      const hitters = Math.min(4, ms.filter((m) => !m.giant && !m.ranged).length) + (ms.some((m) => m.giant) ? GIANT_SIEGE : 0);
      breachLeft -= hitters * dt;
      for (const m of ms) if (m.ranged) hitG(arch.some((h) => h > 0) ? arch : mel, A, effDps({ ...M, dps: M.rdps, ranged: true }, A) * dt * eff.m * 0.6 * roll());
      if (breachLeft <= 0) breach = true;
      continue;
    }
    // the melee at the gap: a few at a time, more as they spill in (and the guards close on the ones inside)
    inT += dt;
    const cap = (walled ? (gate ? 4 : 3) : 99) + Math.floor(inT / 8);
    const front = ms.filter((m) => !m.ranged).slice(0, cap), engG = Math.min(alive(mel), front.length + 2);
    const kG = Math.max(1, Math.ceil(front.length / (RAID.focus ?? 2))), kM = Math.max(1, Math.ceil(engG / 2));
    for (const m of front) {
      if (!alive(mel) && !alive(arch)) break;
      const tg = alive(mel) ? mel : arch, U = tg === mel ? G : A;
      if (m.giant) { const d = effDps(GI, U) * dt * eff.m * roll(); hitG(tg, U, d, kG); if (R() < 0.5) hitG(tg, U, d * 0.8, kG + 1); } // (the smash: often two)
      else hitG(tg, U, effDps(M, U) * dt * eff.m * roll(), kG);
    }
    for (const m of ms) if (m.ranged) { const tg = alive(arch) && R() < 0.5 ? arch : alive(mel) ? mel : arch; hitG(tg, tg === mel ? G : A, effDps({ ...M, dps: M.rdps, ranged: true }, tg === mel ? G : A) * dt * eff.m * 0.6 * roll()); }
    for (let k = 0; k < engG; k++) hitM(effDps(G, front.length ? front[0].u : M) * dt * eff.g * roll(), false, kM);
    if (!aliveM().length) { out = 'held'; break; }
    if (alive(mel) <= lostMel && aliveM().length >= RAID.lost.lostMin) { out = 'lost'; lostAt = t; break; }
  }
  if (!out) out = 'held'; // (the dawn: they crumble)
  const left = aliveM();
  return {
    out, t: Math.round(t), lostAt, breach, gate, dawn: t >= dark,
    gDead: { melee: mel.filter((h) => h <= 0).length, archers: arch.filter((h) => h <= 0).length },
    mDead: mon.filter((m) => m.hp <= 0).length, left: left.length, giantLeft: left.some((m) => m.giant),
  };
}

// the share of attacks lost over a sample of places (calibration: tools/raid-calib.mjs, game.raids.dbg.calibrate, WA3)
export function lossRate(places, n, R, o = {}) {
  let lost = 0, horde = 0, hordeLost = 0, gd = 0, g0 = 0, md = 0, m0 = 0;
  for (let i = 0; i < n; i++) {
    const P = places[i % places.length], W = planWave(P, R, o.wave || {}), F = fight(P, W, R, o);
    if (F.out === 'lost') lost++;
    if (W.horde) { horde++; if (F.out === 'lost') hordeLost++; }
    gd += F.gDead.melee + F.gDead.archers; g0 += P.guards.n; md += F.mDead; m0 += W.units + (W.giant ? 1 : 0);
  }
  return { n, lost, rate: lost / n, horde, hordeLost, guardsDead: gd / Math.max(1, g0), monstersDead: md / Math.max(1, m0) };
}
