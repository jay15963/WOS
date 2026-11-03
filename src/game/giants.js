// Ice giants — "Gigante de Gelo" (SPECIES.giant, kind 'pawn', faction 'walker', twice a person). Host only.
// They walk with the winter walkers: same nights, same brain to find the living / lights and to break into rooms
// (walkers.js walkerBrain; a giant breaks a piece SIEGE_MUL times faster), crumble at sunrise like them (walkersTick),
// show on the radar / map like them (faction 'walker'). The fight is their own (giantChase, called from the raiders'
// brain while chasing):
//  - SMASH (in reach): a slow overhead slam with a long, visible wind-up — the club goes up, a danger circle grows on
//    the ground where it will land (op giant.tele, fx/giantfx.js), a cast bar "Esmagar" — then the club comes down on
//    that spot: every player still inside the circle takes the heavy hit. Step out of the circle to dodge it. A stun
//    (shield bash, Esmagar…) during the wind-up cancels it (elite: stuns last half).
//  - THROW (out of reach, in sight, 4.5–15 tiles): it pulls an ice rock out of the snow, lifts it ("Arremessar") and
//    lobs it at where the player will be (op giant.rock: the same flight on every peer, a landing ring on the ground);
//    whoever is within ROCK.r of the landing point takes a walker's hit (small) — move and it misses.
// Spawning (giantsTick, from walkersTick on winter nights): very few in the first winter, more every winter after
// (GIANT_GROWTH). Away from players and lights, out of sight, like the walkers. Killed: XP, it shatters (no body) and
// leaves a little metal frozen inside it. Creative worlds: like the walkers there (no hunting, no breaking, no light).
// Numbers (balance): docs/PLAN-V2.md "Gigantes de gelo".

import { SPECIES } from './data.js';
import { mobStats } from './stats.js';
import { weaponProfile } from './content/weapons.js';
import { allocMob, levelForDistance, litNear } from './mobs.js';
import { mobBlocked, steer } from './nav.js';
import { allPlayers, minPlayerDist, inAnyView, hurtPlayer } from './players.js';
import { makeLook } from './bandits.js';
import { hasLOS, faceTowards, dist, reach } from './combat.js';
import { go } from './ai.js';
import { hostProjId } from './projectiles.js';
import { lootRows, ri } from './mut/roll.js';

// ---------- numbers ----------
// winter k (0 = the first): up to `near` giants around a player, a spawn try every `every` s (faster each winter),
// each try succeeding with `chance`; the first try of a night comes after `first` s of darkness
export const GIANT_GROWTH = { near: 1, nearEvery: 2, nearMax: 4, every: [150, 210], faster: 0.3, everyMin: 55, chance: 0.5, chancePer: 0.15, first: [40, 100] };
export function giantNumbers(game, k = (game.season?.year || 1) - 1) {
  const G = GIANT_GROWTH;
  return {
    near: Math.min(G.nearMax, G.near + Math.floor(k / G.nearEvery)),
    every: Math.max(G.everyMin, (G.every[0] + Math.random() * (G.every[1] - G.every[0])) / (1 + G.faster * k)),
    chance: Math.min(0.95, G.chance + G.chancePer * k),
  };
}
export const SIEGE_MUL = 8;        // × a walker's pace on walls / doors / fences (stone: ~44 s alone, wood: ~13 s)
export const SMASH = { wind: 1.15, raise: 0.6, reach: 1.45, r: 1.25, mult: 1, recover: 0.55 }; // wind-up s, raise part, impact radius (tiles)
export const ROCK = { min: 4.5, max: 15, cast: 0.85, r: 1.0, cd: [7, 10], dur: [0.55, 0.055], apex: [1.4, 0.24], scatter: 0.45, lead: 0.55 };
const SWING = 3.0;                 // s between smashes

// throw damage: a winter walker's hit at the giant's level (owner: "o mesmo dano dos andarilhos")
const walkerHit = (L) => SPECIES.walker.dmg * (1 + 0.16 * (L - 1)) * 1.06;

// ---------- spawning ----------
let groupSeq = 0;
function giantDeath(game, m) {
  // the ice shatters: XP (combat.killMob) and a little metal of the ones it crushed, frozen inside it
  const out = [], net = game.net;
  if (net.roll() < 0.7) lootRows(net, out, m.x, m.y, 'iron_bar', ri(net, 1, 2));
  if (net.roll() < 0.3) lootRows(net, out, m.x, m.y, 'steel_bar', 1);
  return { rows: out, toast: 'Gigante de gelo derrubado!' };
}

function spawnGiant(game, x, y, group, home) {
  const sp = SPECIES.giant, w = game.world, R = () => game.net.roll();
  const level = Math.max(4, levelForDistance(Math.hypot(x - w.spawn.x, y - w.spawn.y), 2) + (R() < 0.3 ? 1 : 0));
  const st = mobStats(sp, level);
  const wp = weaponProfile('club_ice');
  const m = {
    isEntity: true, isMob: true, kind: 'pawn', faction: 'walker', species: 'giant', giant: true, ...allocMob(game),
    name: sp.name, level, elite: true, role: 'melee', camp: group.id, campRef: group,
    temper: 'hostile', x, y, r: sp.r, scale: sp.scale, facing: R() < 0.5 ? 'e' : 'w', moving: false, moveT: R() * 10,
    action: null, flash: 0, dead: false, deadT: 0,
    hp: st.maxHp, dmg: st.dmg, home, state: 'wander', stateT: 30, swingT: 0, stunT: 0, wp: [home.x, home.y],
    look: makeLook(R, false, false), weapon: 'club_ice', offhand: null, armor: { body: null, head: null },
    wprof: wp, shield: null, reachX: 1.05, swingDur: SWING, armorV: 12, aggroR: sp.aggro, heavy: true, siegeMul: SIEGE_MUL,
    xpMul: sp.xp, specialT: 2, blockT: 99, throwT: 2 + R() * 2, onDeath: giantDeath, patrol: false, noCorpse: true,
  };
  m.maxHp = m.hp;
  group.members.push(m);
  game.entities.push(m); // sync-ok: host-only creature list (giants spawn like the walkers, walkers.js)
  return m;
}

// tests / debug (host): one giant at (x, y), roaming there
export function spawnGiantAt(game, x, y) {
  const group = { id: 'g' + (++groupSeq).toString(36), x, y, members: [] };
  return spawnGiant(game, x, y, group, { x, y });
}

function spawnTry(game) {
  const w = game.world, L = allPlayers(game).filter((q) => !q.dead);
  if (!L.length) return false;
  const p = L[Math.floor(Math.random() * L.length)];
  const N = giantNumbers(game);
  let near = 0;
  for (const e of game.entities) if (e.species === 'giant' && !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 50) near++;
  if (near >= N.near || Math.random() > N.chance) return false;
  const ok = (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return w.inBounds(tx, ty) && !mobBlocked(w, x, y, SPECIES.giant.r) && (!w.waterAt(tx, ty) || w.frozen) && !w.isCave(tx, ty) && !w.roofAt?.(tx, ty) && !litNear(game, x, y);
  };
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 10;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (!ok(x, y) || minPlayerDist(game, x, y) < 24 || inAnyView(game, x, y, 4, 4)) continue;
    let hx = p.x + Math.cos(a) * 9, hy = p.y + Math.sin(a) * 9;
    if (!ok(hx, hy)) { hx = x; hy = y; }
    const group = { id: 'g' + (++groupSeq).toString(36), x: hx, y: hy, members: [] };
    spawnGiant(game, x, y, group, { x: hx, y: hy });
    return true;
  }
  return false;
}

// host, once a second on winter nights (walkersTick): the spawn schedule (on = a winter night)
export function giantsTick(game, on) {
  if (!on) { game._giantT = null; return; }
  if (game._giantT == null) { const F = GIANT_GROWTH.first; game._giantT = F[0] + Math.random() * (F[1] - F[0]); }
  game._giantT -= 1;
  if (game._giantT > 0) return;
  game._giantT = giantNumbers(game).every;
  spawnTry(game);
}

// ---------- the fight (raiders' brain, state 'chase'; t = its threat, d = distance) ----------
const r2 = (v) => Math.round(v * 100) / 100;
function canSee(game, m, p) { return hasLOS(game.world, m.x, m.y, p.x, p.y, m.z || 0, p.z || 0); }

export function giantChase(game, m, t, d, dt) {
  const sp = SPECIES.giant;
  const rng = reach(m, t);
  if (rng > 0 && d <= rng + 0.15) {
    m.moving = false;
    faceTowards(m, t);
    if (m.swingT <= 0) smash(game, m, t);
    return;
  }
  if (m.throwT <= 0 && d > ROCK.min && d < ROCK.max && canSee(game, m, t)) { throwRock(game, m, t, d); return; }
  const dir = steer(game, m, t.x, t.y, dt, sp.speed, Math.max(0.5, rng * 0.85), t.lv | 0);
  go(game, m, dir, sp.speed, dt);
}

// the slam: wind-up (cast + ground telegraph), the club comes down on the marked spot
function smash(game, m, t) {
  const dx = t.x - m.x, dy = t.y - m.y, L = Math.hypot(dx, dy) || 1;
  const k = Math.max(0.9, Math.min(L, SMASH.reach));
  const ix = m.x + (dx / L) * k, iy = m.y + (dy / L) * k;
  m.swingT = m.swingDur * (0.95 + Math.random() * 0.1) + SMASH.wind;
  m.lastCombatT = game.worldTime;
  // the club rises (a new action object: guests start it too), then holds high (another one: they see it held)
  m.action = { type: 'smash', t: 0, dur: (SMASH.wind * SMASH.raise) / 0.41 };
  game.net.emit('giant.tele', { x: r2(ix), y: r2(iy), r: SMASH.r, dur: SMASH.wind + 0.08, k: 'smash' });
  game.audio?.play('giant_roar', { x: m.x, y: m.y, volume: 0.7 });
  m.cast = {
    name: 'Esmagar', t: 0, dur: SMASH.wind, raised: false,
    step(dt) {
      faceTowards(m, { x: ix, y: iy });
      if (!this.raised && this.t >= SMASH.wind * SMASH.raise) { this.raised = true; m.action = { type: 'smash', t: 0.41, hold: true }; }
    },
    fn: () => {
      if (m.dead || m.stunT > 0) return;
      m.action = { type: 'smash', t: 0.42, dur: SMASH.recover };
      game.later(0.08, () => {
        if (m.dead) return;
        for (const q of allPlayers(game)) {
          if (q.dead || Math.abs((q.z || 0) - (m.z || 0)) > 0.5 || Math.hypot(q.x - ix, q.y - iy) > SMASH.r + (q.r || 0.24) * 0.5) continue;
          const crit = Math.random() < 0.06;
          const dmg = Math.max(1, Math.round(m.dmg * SMASH.mult * (0.9 + Math.random() * 0.2) * (crit ? 1.4 : 1)));
          hurtPlayer(game, m, q, dmg, { crit, ability: 'giant_smash', from: { x: ix, y: iy }, knock: 0.5 });
        }
      });
    },
  };
}

// lob an ice rock where the target will be
function throwRock(game, m, t, d) {
  m.throwT = ROCK.cd[0] + Math.random() * (ROCK.cd[1] - ROCK.cd[0]);
  m.swingT = Math.max(m.swingT, ROCK.cast + 0.8);
  m.lastCombatT = game.worldTime;
  faceTowards(m, t);
  m.action = { type: 'throw', t: 0, dur: ROCK.cast / 0.44 };
  m.cast = {
    name: 'Arremessar', t: 0, dur: ROCK.cast, held: false,
    step() {
      faceTowards(m, t);
      if (!this.held && this.t >= ROCK.cast * 0.95) { this.held = true; m.action = { type: 'throw', t: 0.43, hold: true }; }
    },
    fn: () => {
      if (m.dead || m.stunT > 0 || t.dead) return;
      m.action = { type: 'throw', t: 0.45, dur: 0.5 };
      const D = Math.min(ROCK.max, Math.max(1, dist(m, t)));
      const dur = ROCK.dur[0] + ROCK.dur[1] * D, apex = ROCK.apex[0] + ROCK.apex[1] * D;
      // lead: where it is going (remote avatars carry a velocity estimate), a little scatter (host randomness)
      let lx = t.x, ly = t.y;
      if (t.vx != null) { lx += t.vx * dur * ROCK.lead; ly += t.vy * dur * ROCK.lead; }
      else if (t.moving && t.facing) { const f = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[t.facing] || [0, 0]; lx += f[0] * (t.speed || 4) * dur * ROCK.lead; ly += f[1] * (t.speed || 4) * dur * ROCK.lead; }
      const a = Math.random() * Math.PI * 2, rr = ROCK.scatter * Math.sqrt(Math.random());
      lx += Math.cos(a) * rr; ly += Math.sin(a) * rr;
      const W = game.world;
      lx = Math.max(0.5, Math.min(W.W - 0.5, lx)); ly = Math.max(0.5, Math.min(W.H - 0.5, ly));
      const id = hostProjId();
      const fx = (m.facing === 'e' ? 0.5 : m.facing === 'w' ? -0.5 : 0), fy = (m.facing === 's' ? 0.3 : m.facing === 'n' ? -0.3 : 0);
      game.net.emit('giant.rock', { id, x: r2(m.x + fx), y: r2(m.y + fy), lx: r2(lx), ly: r2(ly), dur: r2(dur), apex: r2(apex) });
      game.audio?.play('swing_heavy', { x: m.x, y: m.y, volume: 0.9 });
      const pr = game.projectiles?.find((q) => q.id === id);
      const L = m.level;
      if (pr) pr.onLand = (g, p) => {
        if (p.blocked) return;
        for (const q of allPlayers(g)) {
          if (q.dead || Math.abs(q.z || 0) > 0.5 || Math.hypot(q.x - p.lx, q.y - p.ly) > ROCK.r + (q.r || 0.24) * 0.5) continue;
          const dmg = Math.max(1, Math.round(walkerHit(L) * (0.85 + Math.random() * 0.3)));
          hurtPlayer(g, m, q, dmg, { ability: 'ice_rock', ranged: true, from: { x: p.x0, y: p.y0 }, dtype: 'phys' });
        }
      };
    },
  };
}

// tests / debug (host)
export function giantDebug(m) { return { state: m.state, cast: m.cast?.name || null, action: m.action?.type || null, swingT: +(m.swingT || 0).toFixed(2), throwT: +(m.throwT || 0).toFixed(2), hp: m.hp, maxHp: m.maxHp }; }
