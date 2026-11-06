// NPC long shot — the player's "Tiro Longo" (content/combat.js ABILITIES.long_shot) for the creatures' archers
// (owner: "os arqueiros NPC também usam o Tiro Longo"; docs/REINOS.md §14 "Mira automática, golpes e paredes, caminhos").
// HOST only: the same flight and scatter as the player's (content/weapons.js lobSpec / lobScatter / lobFlight, the landing
// rolled here), flown by projectiles.js fireLob; every other peer flies a cosmetic copy from the projectile fx
// ['proj', id, 'lob', x, y, lx, ly, dur, apex] (no owner pid) and ['pend', …] when it hits. Used by the kingdoms' soldiers
// (soldier.js: battles, sieges, armies, a skirmish) and the raiders / skeleton archers (bandits.js archer()); the town
// archers (npc.js) can call it the same way.
//
// npcLongShot(game, shooter, foe, opts) → true when the shot started (the shoot animation; the arrow leaves 0,34 s later)
//   shooter  a host creature: x, y, z, facing, action, dmg, weapon, swingT / swingDur (both optional), stunT, dead
//   foe      what it aims at (a creature or a player); a moving one is led by the flight time (vx / vy, else facing ×
//            speed while moving)
//   opts {
//     weapon   main-hand item id (default shooter.weapon) — only a bow lobs (bow 18 tiles, bow_composite 22: LOB_RANGE)
//     dmg      the damage of one of its plain arrows (default shooter.dmg); the hit is dmg × 1,3 + 2, like the player's
//     direct   tiles of its plain shot (default: the bow's weapon range × heightK): the lob is for a foe beyond it, or
//              for one it has no line of fire to (over a palisade / a wall, around a ridge)
//     canHit(e) who the landing may hurt — the same rule as its plain arrows (its foes: never its own side, never the
//              shooter). Default: players only
//     onHit(game, victim, amount, hitOpts) apply the hit (default players.js hurtPlayer — it routes creatures to
//              dealDamage); hitOpts = { ranged: true, ability: 'long_shot', from: {x, y}, knock }
//     faction  label of the projectile (default 'army'; cosmetic)
//     rangeK   × the lob range (default 1); heightK of the shooter over the foe always applies (+20 % per story)
//     minD     closer than this it does not lob (default 4 tiles)
//     force    true: skip the "when" rule (a caller that already decided)
//   }
//   It does nothing (false) when: not the host, no bow, a roof over the shooter (needs open sky), the foe out of the lob
//   range or too near, its own cool-down (ABILITIES.long_shot.cd = 3 s, × 0,9–1,2), mid-swing / stunned, or (no force)
//   the foe within `direct` with a clear line.
//   It does not lob at a foe standing on a wall top / a rock either (lobbable): the arrow would come down on the stones.
//
// npcThrowSpear(game, thrower, foe, opts) → true when the throw started — the spear's "Lançar Lança" (owner: "lanceiros
//   npc também podem usar o tiro longo"; ABILITIES.throw_spear: up to 8 tiles × heightK, 10 s cool-down × 0,9–1,2, the hit
//   dmg × 2,4 + 6, a hard knock), the same flight as the player's (lobSpec spear: a low arc). The throw pose is held past
//   the release until the spear comes down (the hand stays empty: art/compose.js 'throw' hides it after k 0,55), then it is
//   back in the hand. opts as npcLongShot's (weapon a spear, faction, canHit, onHit, dmg, rangeK) + minD (default 2,6: closer
//   it stabs). It needs a clear line (a spear does not go over a wall) and a foe on open ground (lobbable); no "direct" rule
//   — its caller decides when (a melee fighter out of reach of its foe).
// lobReach(game, shooter, foe?, weapon?, rangeK?) → the lob range in tiles now (0: it cannot lob — no bow, a roof overhead)
// lineOfFire(game, shooter, foe) → a clear line for a plain arrow (hasLOS, cached 0,4 s per shooter)
// lobbable(game, foe) → a lob coming down on the foe's tile may hit it (not a wall top, a rock, a solid tile)
// spearReach(game, thrower, foe?) → the throw's range in tiles now (0: no spear in the hand)
// The landing (on the host): nothing on a wall / rock / a roof (projectiles.js landLob → pr.blocked); else the nearest
// creature or player within the bow's hitR + its body that canHit allows; no one → the arrow stays in the ground.

import { ABILITIES } from './content/combat.js';
import { lobSpec, lobScatter, lobFlight, weaponProfile } from './content/weapons.js';
import { faceTowards, facingVec, hasLOS } from './combat.js';
import { fireLob, hostProjId } from './projectiles.js';
import { allPlayers, hurtPlayer } from './players.js';
import { heightK } from './levels.js';
import { SPECIES } from './data.js';

const AB = ABILITIES.long_shot, AS = ABILITIES.throw_spear;
const SPEAR_REL = 0.28;          // s from the wind-up to the release (the throw pose: k 0,56 of 0,5 s)
const RELEASE = 0.34;            // s from the draw to the release (the soldiers' / raiders' plain shot)
const NEXT = new WeakMap();      // shooter → worldTime it may lob again
const LOF = new WeakMap();       // shooter → { f, t, ok } (line of fire, cached)
const r3 = (v) => Math.round(v * 1000) / 1000;
const roll = (game) => (game.net?.roll ? game.net.roll() : Math.random());
const isPlayer = (game, e) => e === game.player || !!e?.avatar || !!(e?.remote && e.pid);

export function lobReach(game, m, f = null, weapon = null, rangeK = 1) {
  const S = lobSpec(weapon || m?.weapon);
  if (!S || S.type !== 'bow' || (S.open && game.world.roofAtPoint(m.x, m.y))) return 0;
  return S.range * heightK(m, f) * rangeK;
}

export function lobbable(game, f) {
  const w = game.world, tx = Math.floor(f.x), ty = Math.floor(f.y);
  if (!w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  return !w.rock.get(i) && !w.solid.get(i);
}

export function spearReach(game, m, f = null) {
  const S = lobSpec(m?.weapon);
  return S && S.type === 'spear' ? S.range * heightK(m, f) : 0;
}

export function lineOfFire(game, m, f) {
  const t = game.worldTime, c = LOF.get(m);
  if (c && c.f === f && t - c.t < 0.4) return c.ok;
  const ok = hasLOS(game.world, m.x, m.y, f.x, f.y, m.z || 0, f.z || 0, m._tn, f._tn);
  LOF.set(m, { f, t, ok });
  return ok;
}

export function npcLongShot(game, m, f, o = {}) {
  if (!m || !f || m.dead || f.dead || m.proxy || (game.net && game.net.auth === false)) return false;
  const t = game.worldTime;
  if ((NEXT.get(m) ?? -1) > t || m.swingT > 0 || m.stunT > 0 || m.cast) return false;
  const wid = o.weapon || m.weapon, S = lobSpec(wid);
  if (!S || S.type !== 'bow') return false;
  const w = game.world;
  if (S.open && w.roofAtPoint(m.x, m.y)) return false; // (open sky: never from under a roof / a cave ceiling)
  const dx = w.dx ? w.dx(f.x, m.x) : f.x - m.x, dy = f.y - m.y, d = Math.hypot(dx, dy);
  const hk = heightK(m, f), R = S.range * hk * (o.rangeK || 1);
  if (d > R || d < (o.minD ?? 4) || !lobbable(game, f)) return false;
  if (!o.force) {
    const direct = o.direct ?? (weaponProfile(wid).range || 9) * hk;
    if (d <= direct && lineOfFire(game, m, f)) return false; // (a plain shot does it)
  }
  NEXT.set(m, t + (AB.cd || 3) * (0.9 + Math.random() * 0.3));
  if (m.swingDur) m.swingT = Math.max(m.swingT || 0, m.swingDur); // (no plain arrow right on top of it)
  faceTowards(m, f);
  m.moving = false;
  m.action = { type: AB.act || 'shoot', t: 0, dur: 0.6 };
  const amount = Math.max(1, Math.round((o.dmg ?? m.dmg ?? 1) * (AB.mult ?? 1.3) + (AB.flat ?? 2)));
  game.later(RELEASE, () => release(game, m, f, S, R, amount, o));
  return true;
}

export function npcThrowSpear(game, m, f, o = {}) {
  if (!m || !f || m.dead || f.dead || m.proxy || m.ride || (game.net && game.net.auth === false)) return false;
  const t = game.worldTime;
  if ((NEXT_SP.get(m) ?? -1) > t || m.swingT > 0 || m.stunT > 0 || m.cast) return false;
  const S = lobSpec(o.weapon || m.weapon);
  if (!S || S.type !== 'spear') return false;
  const w = game.world, dx = w.dx ? w.dx(f.x, m.x) : f.x - m.x, dy = f.y - m.y, d = Math.hypot(dx, dy);
  const R = S.range * heightK(m, f) * (o.rangeK || 1);
  if (d > R || d < (o.minD ?? 2.6) || !lobbable(game, f) || !lineOfFire(game, m, f)) return false;
  NEXT_SP.set(m, t + (AS.cd || 10) * (0.9 + Math.random() * 0.3));
  faceTowards(m, f);
  m.moving = false;
  m.action = { type: AS.act || 'throw', t: 0, dur: 0.5 };
  if (m.swingDur) m.swingT = Math.max(m.swingT || 0, SPEAR_REL + 0.3);
  const amount = Math.max(1, Math.round((o.dmg ?? m.dmg ?? 1) * (AS.mult ?? 2.4) + (AS.flat ?? 6)));
  game.later(SPEAR_REL, () => release(game, m, f, S, R, amount, { ...o, spear: true }));
  game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
  return true;
}
const NEXT_SP = new WeakMap();   // thrower → worldTime it may throw again

// a moving foe's velocity (tiles / s): its estimate (avatars, knocked creatures), else its facing while it walks
function velOf(e) {
  if (typeof e.vx === 'number' && typeof e.vy === 'number' && (e.vx || e.vy)) return [e.vx, e.vy];
  if (!e.moving || !e.facing) return [0, 0];
  const v = facingVec(e.facing), s = e.speed || SPECIES[e.species]?.speed || 3;
  return [v[0] * s, v[1] * s];
}

function release(game, m, f, S, R, amount, o) {
  if (m.dead || m.gone || m.stunT > 0 || f.gone) return;
  const w = game.world, ox = m.x, oy = m.y;
  // lead the foe by the flight time (twice: the flight depends on the distance)
  const [vx, vy] = velOf(f);
  let tx = w.dx ? w.dx(f.x, ox) : f.x - ox, ty = f.y - oy, D = Math.hypot(tx, ty);
  for (let k = 0; k < 2; k++) {
    const { dur } = lobFlight(S, Math.min(D, R));
    tx = (w.dx ? w.dx(f.x, ox) : f.x - ox) + vx * dur; ty = f.y - oy + vy * dur; D = Math.hypot(tx, ty);
  }
  if (D < 0.05) { tx = 0; ty = 1; D = 1; }
  const L = Math.min(Math.max(D, 1), R), ax = ox + (tx / D) * L, ay = oy + (ty / D) * L;
  // scatter: centre-weighted inside the radius for this distance (rolled here: every peer sees the same landing)
  const rad = lobScatter(S, L), ang = roll(game) * Math.PI * 2, rr = rad * roll(game);
  const lx = r3(Math.max(0.5, Math.min(w.W - 0.5, ax + Math.cos(ang) * rr)));
  const ly = r3(Math.max(0.5, Math.min(w.H - 0.5, ay + Math.sin(ang) * rr)));
  const { dur, apex } = lobFlight(S, L);
  const id = hostProjId();
  fireLob(game, { id, proj: S.proj, faction: o.faction || 'army', x: ox, y: oy, lx, ly, dur, apex, src: m, onLand: (g, pr) => land(g, pr, m, S, amount, o, ox, oy) });
  game.net?.entsApi?.fx?.(['proj', id, S.proj === 'spear' ? 'lobs' : 'lob', r3(ox), r3(oy), lx, ly, r3(dur), r3(apex)], ox, oy);
  if (o.spear) {
    // the hand stays empty while it flies: the rest of the throw pose (past k 0,56) spans the flight, then it is back
    m.action = { type: AS.act || 'throw', t: 0.56, dur: (dur + 0.12) / 0.44 };
    if (m.swingDur) m.swingT = Math.max(m.swingT || 0, dur + 0.15);
  } else game.audio?.play('bow', { x: ox, y: oy, volume: 0.45 });
}

// host, on landing: the nearest of the shooter's foes near the point (nothing on a wall / rock / a roof)
function land(game, pr, m, S, amount, o, ox, oy) {
  if (pr.blocked) return;
  const x = pr.lx, y = pr.ly, can = o.canHit || ((e) => isPlayer(game, e));
  let best = null, bd = 1e9;
  const test = (e) => {
    if (!e || e === m || e.dead || e.gone || !can(e)) return;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= S.hitR + (e.r || 0.3) && d < bd) { bd = d; best = e; }
  };
  for (const e of game.entities) if (!e.proxy && typeof e.x === 'number') test(e);
  for (const q of allPlayers(game)) test(q);
  if (!best) return;
  const opts = { ranged: true, ability: S.ability || 'long_shot', from: { x: ox, y: oy }, knock: S.knock };
  if (o.onHit) o.onHit(game, best, amount, opts);
  else hurtPlayer(game, m, best, amount, opts);
  game.juice?.chips(best.x, best.y, [0.85, 0.75, 0.55], 4, 0.4);
  if (pr.kind === 'spear') { // (like the player's: it stays where it struck — mut/bow.js resolve)
    pr.x = pr.lx = best.x; pr.y = pr.ly = best.y; pr.stuck = true; pr.ground = true; pr.lift = 0.04;
    game.net?.entsApi?.fx?.(['pend', pr.id, r3(best.x), r3(best.y), 1, 1], best.x, best.y);
    return;
  }
  pr.alpha = 0;
  game.net?.entsApi?.fx?.(['pend', pr.id, r3(x), r3(y), 0, 1], x, y);
}
