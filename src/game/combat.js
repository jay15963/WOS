// Combat rules: hit rolls, damage pipeline (armor, shields, blocks, damage types), heals, DoTs,
// deaths, loot & XP, breakable props, and the player's auto attack (melee swing timer / bow auto-shot).
// Multiplayer: creatures are host objects. On a guest, a hit on a creature proxy is routed to the host
// (routeHit → intent mob.hit with the locally rolled amount); crates go through prop.hit; deaths are the
// op mob.die. The attacker's own rolls stay local (feel), the host applies armor / aggro / death / loot.

import { SPECIES, ITEMS } from './data.js';
import { weaponProfile, armorReduction } from './content/weapons.js';
import { mobXp } from './stats.js';
import { enterCombat, addBuff, removeBuff, killPlayer, knock } from './player.js';
import { aggro } from './ai.js';
import { lootRows, ri } from './mut/roll.js';
import { facingFrom } from './physics.js';
import { fireArrow } from './projectiles.js';
import { applyMobEffect } from './mut/combat.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// any creature / raider controlled by the sim
export const isMob = (e) => !!(e && e.isEntity && (e.isMob || e.kind === 'animal'));
// can the player target & hit it (mobs + breakable props like bandit crates)
export const attackable = (e) => !!e && ((isMob(e) && !e.dead) || (e.isProp && !e.broken));
// melee contact distance (center to center); a.reachX = weapon reach of the attacker
export const reach = (a, b) => a.r + (b.r || 0.3) + (a.reachX ?? 0.62);
// player attack distance with the current weapon (bow range or melee reach)
export function attackRange(p, t) {
  const pr = p.wprof;
  return pr && pr.ranged ? pr.range + (t.r || 0.3) : reach(p, t);
}

// is `t` roughly in front of `e` (4-dir facing, generous cone)
export function facingOk(e, t, min = -0.2) {
  const dx = t.x - e.x, dy = t.y - e.y, L = Math.hypot(dx, dy) || 1;
  const f = e.facing;
  const fx = f === 'e' ? 1 : f === 'w' ? -1 : 0, fy = f === 's' ? 1 : f === 'n' ? -1 : 0;
  return (dx * fx + dy * fy) / L > min;
}
export const facingVec = (f) => (f === 'e' ? [1, 0] : f === 'w' ? [-1, 0] : f === 'n' ? [0, -1] : [0, 1]);

export function faceTowards(e, t) { e.facing = facingFrom(t.x - e.x, t.y - e.y, e.facing); }

// Line of sight for shots: rock and walls/doors block, trees/water don't (projectiles still collide with trunks).
export function hasLOS(world, x0, y0, x1, y1) {
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : 1e9, ddy = dy !== 0 ? Math.abs(1 / dy) : 1e9;
  let mx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * ddx : 1e9;
  let my = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * ddy : 1e9;
  for (let n = 0; n < 64; n++) {
    if (tx === ex && ty === ey) return true;
    if (mx < my) { mx += ddx; tx += sx; } else { my += ddy; ty += sy; }
    if (tx === ex && ty === ey) return true;
    if (!world.inBounds(tx, ty)) return false;
    const i = ty * world.W + tx;
    if (world.rock[i] || world.solid[i]) return false;
  }
  return true;
}

// ---------- rolls ----------
// roll player weapon damage against a target
export function rollPlayerHit(game, target, mult = 1, flat = 0, canMiss = true, critBonus = 0) {
  const p = game.player;
  const diff = Math.max(0, (target.level || 1) - p.level);
  if (canMiss && !target.isProp && Math.random() < 0.04 + diff * 0.02) return { miss: true };
  const base = p.wMin + Math.random() * (p.wMax - p.wMin);
  const crit = Math.random() < p.crit + critBonus;
  const amount = Math.max(1, Math.round((base * mult + flat) * p.dmgMul * (crit ? 1.8 : 1)));
  return { amount, crit };
}

export function applyPlayerHit(game, target, roll, opts = {}) {
  const p = game.player;
  if (roll.miss) { playerMiss(game, target); return 0; }
  return dealDamage(game, p, target, roll.amount, { crit: roll.crit, ...opts });
}

// the local player missed `target` ("Errou" + aggro); a proxy's miss is shown by the host's echo
export function playerMiss(game, target) {
  const p = game.player;
  if (target?.proxy) { routeHit(game, p, target, 0, { miss: true }); return; }
  game.events.emit('damage', { target, src: p, amount: 0, kind: 'miss' });
  if (isMob(target)) aggro(game, target, p);
}

// guest: a hit by the local player on a host creature -> intent mob.hit (rolled amount; no local damage
// event: the host's fx echo shows the number). Returns the rolled amount for local UX.
export function routeHit(game, src, dst, amount, opts = {}) {
  const p = game.player;
  if (src === p || src?.owner === p) enterCombat(p);
  const f = opts.from;
  game.net.request('mob.hit', {
    nid: dst.nid, amount: Math.round(amount), crit: opts.crit ? 1 : 0, miss: opts.miss ? 1 : 0, ability: opts.ability || undefined,
    dtype: opts.dtype || undefined, ranged: opts.ranged ? 1 : 0, from: f ? [+f.x.toFixed(2), +f.y.toFixed(2)] : undefined,
    knock: opts.knock, skin: canSkin(game) ? 1 : 0, eff: opts.eff,
  });
  return opts.miss ? 0 : Math.max(1, Math.round(amount));
}

// status effects of the local player's abilities on a creature: applied on the authority, routed on guests
export function mobEffect(game, e, eff) {
  if (!e || e.dead || e.isProp) return;
  if (e.proxy) { game.net.request('mob.hit', { nid: e.nid, amount: 0, noDmg: 1, eff, skin: canSkin(game) ? 1 : 0 }); return; }
  applyMobEffect(game, e, eff, game.player);
}

// frontal test for blocks: is `from` in front of `e`
function frontal(e, from) {
  if (!from) return true;
  return facingOk(e, from, 0.05);
}

// ---------- damage pipeline ----------
// opts: { crit, ability, dtype:'phys'|'bleed'|'poison'|'fire', dot, noDodge, noKnock, knock, from:{x,y}, ranged, pure }
export function dealDamage(game, src, dst, amount, opts = {}) {
  if (!dst) return 0;
  if (dst.isProp) return damageProp(game, src, dst, amount, opts);
  if (dst.dead) return 0;
  if (dst.proxy) return opts.dot ? 0 : routeHit(game, src, dst, amount, opts);
  const p = game.player;
  const dtype = opts.dtype || 'phys';
  if (dst.state === 'evade') {
    game.events.emit('damage', { target: dst, src, amount: 0, kind: 'immune' });
    return 0;
  }
  if (dst === p && !opts.noDodge && !opts.dot && Math.random() < p.dodge) {
    game.events.emit('damage', { target: dst, src, amount: 0, kind: 'dodge' });
    return 0;
  }
  let blocked = false;
  if (!opts.dot && !opts.pure && src !== dst) {
    const from = opts.from || src;
    // armor
    const armor = dst === p ? p.armorV || 0 : dst.armorV || 0;
    if (armor > 0) amount *= 1 - armorReduction(armor, src?.level || 1);
    // shields: active block (frontal) or passive block chance
    const sh = dst === p ? p.shield : dst.shield;
    if (dst.blocking && frontal(dst, from)) {
      amount *= 1 - (sh?.blockReduce ?? 0.6);
      blocked = true;
    } else if (sh && sh.blockChance && frontal(dst, from) && Math.random() < sh.blockChance) {
      amount *= 1 - sh.passiveReduce;
      blocked = true;
    }
  }
  amount = Math.max(1, Math.round(amount));
  dst.hp -= amount;
  dst.flash = opts.dot ? Math.max(dst.flash || 0, 0.45) : 1;
  game.events.emit('damage', { target: dst, src, amount, crit: !!opts.crit, kind: 'hit', ability: opts.ability, dtype, blocked, dot: !!opts.dot });
  const hx = dst.x, hy = dst.y;
  if (src !== dst && !opts.dot) {
    if (blocked) {
      game.juice.chips(hx, hy, [0.95, 0.85, 0.6], 6, 0.6);
      game.audio?.play('mine', { x: hx, y: hy, volume: 0.6 });
    } else {
      game.juice.hit(hx, hy, opts.crit, dst === p ? [1, 0.45, 0.35] : dtype === 'fire' ? [1, 0.55, 0.15] : null);
      if (dtype === 'phys') game.juice.blood(hx, hy, opts.crit ? 7 : 4);
      game.audio?.play(opts.crit ? 'crit' : 'hit', { x: hx, y: hy });
    }
  } else if (opts.dot) dotPuff(game, dst, dtype);
  if (!opts.noKnock && !opts.dot && src !== dst && !blocked) {
    const from = opts.from || src;
    knock(game, dst, from.x, from.y, opts.knock ?? (opts.crit ? 0.22 : 0.1));
  }

  if (dst === p) {
    if (src !== p) enterCombat(p);
    if (src !== p && !opts.dot && removeBuff(p, 'bandage')) game.events.emit('error', { text: 'Bandagem interrompida' });
    if (src !== p && !opts.dot) game.juice.shake(amount >= p.maxHp * 0.12 ? 0.35 + Math.min(0.4, amount / p.maxHp) : 0.15);
    if (p.work && src !== p && !opts.dot && p.work.it?.kind !== 'cook') { p.work = null; p.action = null; }
    if (p.hp <= 0) killPlayer(game);
  } else {
    if (src === p) {
      enterCombat(p);
      if (opts.crit) game.juice.shake(0.22);
    }
    dst.lastCombatT = game.worldTime;
    if (dst.hp <= 0) killMob(game, dst, src);
    else if (src && src !== dst) aggro(game, dst, src);
  }
  return amount;
}

const DOT_COL = { bleed: [0.75, 0.08, 0.1], poison: [0.45, 0.9, 0.25], fire: [1, 0.55, 0.15] };
function dotPuff(game, e, dtype) {
  const c = DOT_COL[dtype];
  if (!c) return;
  if (dtype === 'bleed') game.juice.blood(e.x, e.y, 3);
  else game.juice.chips(e.x, e.y - 0.1, c, 4, 0.5 * (e.scale || 1));
}

export function healEntity(game, e, amount) {
  if (e.dead) return 0;
  const before = e.hp;
  e.hp = Math.min(e.maxHp, e.hp + amount);
  const got = Math.round(e.hp - before);
  if (got > 0) {
    game.events.emit('damage', { target: e, src: e, amount: got, kind: 'heal' });
    game.juice.heal(e);
  }
  return got;
}

// ---------- damage over time ----------
// id: 'bleed' | 'poison' | 'burn'. dmg per tick (already scaled). Refreshes an existing dot of the same id.
export function addDot(game, target, id, { dur = 6, tick = 1, dmg = 1, src = null } = {}) {
  if (!target || target.dead) return;
  if (target.proxy) { mobEffect(game, target, { dot: { id, dur, tick, dmg } }); return; }
  const dtype = id === 'burn' ? 'fire' : id;
  const p = game.player;
  if (target === p) {
    addBuff(p, id, dur, {
      tick, tickT: tick,
      onTick: (g, pl) => { if (pl.hp > 0) dealDamage(g, src || pl, pl, dmg, { dot: true, dtype, noKnock: true, noDodge: true }); },
    });
    return;
  }
  const D = target.dots || (target.dots = []);
  const ex = D.find((d) => d.id === id);
  if (ex) { ex.t = Math.max(ex.t, dur); ex.dmg = Math.max(ex.dmg, dmg); ex.src = src; return; }
  D.push({ id, t: dur, tick, tickT: tick, dmg, src, dtype });
}

export const hasDot = (e, id) => !!e?.dots?.some((d) => d.id === id);

function updateDots(game, dt) {
  for (const e of game.entities) {
    const D = e.dots;
    if (!D || !D.length || e.proxy) continue; // proxies: the host ticks their dots
    if (e.dead) { D.length = 0; continue; }
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i];
      d.t -= dt; d.tickT -= dt;
      if (d.tickT <= 0) {
        d.tickT += d.tick;
        dealDamage(game, d.src || e, e, d.dmg, { dot: true, dtype: d.dtype, noKnock: true, ability: d.id });
        if (e.dead) { D.length = 0; break; }
      }
      if (d.t <= 0) D.splice(i, 1);
    }
  }
}

// ---------- breakable props (bandit crates) ----------
// o: camp crate { isProp:true, hp, maxHp, name, r } — shared state: intent prop.hit → op prop.set (mut/camps.js)
function damageProp(game, src, o, amount, opts) {
  if (o.broken) return 0;
  if (src === game.player || src?.owner === game.player) enterCombat(game.player, 1);
  game.net.request('prop.hit', { id: o.id, amount: Math.round(amount) });
  return amount >= 18 ? 2 : 1;
}

// ---------- deaths & loot ----------
// can the player skin animals (needs a knife): economy helper first, then inventory / equipment scan
export function canSkin(game, p = game.player) {
  if (typeof game.hasTool === 'function') {
    try { return !!game.hasTool(p, 'skin'); } catch { /* fall through */ }
  }
  if (p.equip && Object.values(p.equip).some((id) => typeof id === 'string' && id.startsWith('knife_'))) return true;
  return !!p.inv?.slots?.some((s) => s && s.id.startsWith('knife_'));
}

export const lootable = (id) => !!ITEMS[id];

// authority: kill loot rows of a creature table; skin = the killer has a knife. -> { rows, skipped }
export function dropTable(game, m, rows, skin) {
  const net = game.net, out = [];
  let skipped = false;
  for (const [item, a, b, chance, flag] of rows) {
    if (!lootable(item) || net.roll() > chance) continue;
    if (flag === 'skin' && !skin) { skipped = true; continue; }
    lootRows(net, out, m.x, m.y, item, ri(net, a, b));
  }
  return { rows: out, skipped };
}

// the player that dealt the killing blow (local player, its arrow, or a remote avatar on the host)
function killerPlayer(game, killer) {
  const p = game.player;
  if (killer === p || (killer && killer.owner === p)) return { pid: game.net.pid, level: p.level, skin: canSkin(game) };
  if (killer && killer.avatar) return { pid: killer.pid, level: killer.level || 1, skin: !!killer.lastHitSkin };
  return null;
}

// authority only: a creature dies -> op mob.die (+ loot.add); xp / toasts go to the killer
export function killMob(game, m, killer) {
  m.hp = 0; m.dead = true; m.deadT = 0; m.action = null; m.moving = false; m.state = 'dead';
  m.cast = null; m.blocking = false; m.dots && (m.dots.length = 0);
  m.diedAt = game.worldTime;
  const sp = SPECIES[m.species] || SPECIES.wolf;
  const kp = killerPlayer(game, killer);
  const die = { nid: m.nid };
  let rows = null;
  if (kp) {
    die.by = kp.pid;
    die.xp = mobXp({ xp: m.xpMul ?? sp.xp }, m.level, kp.level) || undefined;
    if (m.onDeath) {
      const r = m.onDeath(game, m);
      rows = r?.rows;
      if (r?.toast) die.toast = r.toast;
    } else {
      const r = dropTable(game, m, sp.loot || [], killer?.avatar ? !!m.lastHitSkin : kp.skin);
      rows = r.rows;
      if (r.skipped) die.tip = ['skin', 'Sem faca: não deu para tirar o couro', 3];
    }
  }
  m.respawnAt = game.worldTime + (m.elite ? 300 : 100) + Math.random() * 80;
  game.net.emit('mob.die', die);
  if (rows && rows.length) game.net.emit('loot.add', { list: rows });
}

// ---------- player auto attack ----------
let noAmmoT = 0, losT = 0;
export function hasAmmo(p, prof = p.wprof) { return !prof?.ammo || p.inv.count(prof.ammo) > 0; }
export function useAmmo(game, prof, n = 1) {
  const p = game.player;
  if (!prof?.ammo) return n;
  const have = Math.min(n, p.inv.count(prof.ammo));
  if (have > 0) { p.inv.remove(prof.ammo, have); game.events.emit('inventory', {}); }
  return have;
}
export function noAmmo(game) {
  if (game.time - noAmmoT > 1.2) { noAmmoT = game.time; game.events.emit('error', { text: 'Sem flechas' }); }
}

// shoot one player arrow at t (roll at release; a miss flies wide). opts.side: straight fan arrow
// (Multi-Shot side arrows) — no homing, hits whatever it meets with a fresh roll.
export function playerShot(game, t, mult = 1, flat = 0, opts = {}) {
  const p = game.player;
  const side = !!opts.side;
  const roll = side ? { amount: 0 } : rollPlayerHit(game, t, mult, flat, true, opts.critBonus || 0);
  const ang = opts.angle || 0;
  let tx = t.x, ty = t.y;
  if (t.moving && !t.isProp) { // lead a moving target a little
    const f = facingVec(t.facing), lead = Math.min(0.6, dist(p, t) / 18) * (SPECIES[t.species]?.speed || 4) * 0.6;
    tx += f[0] * lead; ty += f[1] * lead;
  }
  if (roll.miss) {
    const dx = tx - p.x, dy = ty - p.y, L = Math.hypot(dx, dy) || 1;
    const s = Math.random() < 0.5 ? 1 : -1;
    tx += (-dy / L) * s * (0.7 + Math.random() * 0.5); ty += (dx / L) * s * (0.7 + Math.random() * 0.5);
  }
  return fireArrow(game, {
    src: p, faction: 'player', x: p.x, y: p.y, tx, ty, angle: ang, target: roll.miss || side ? null : t,
    range: (p.wprof?.range || 9) + 3, ability: opts.ability, kind: 'arrow',
    onHit: (g, e, pr) => {
      if (!side && roll.miss && e === t) { playerMiss(g, e); return; }
      const r = !side && e === t ? roll : rollPlayerHit(g, e, mult, flat, false);
      applyPlayerHit(g, e, r, { ability: opts.ability, ranged: true, from: { x: pr.ox, y: pr.oy }, knock: 0.08 });
    },
    onMiss: side ? null : () => { if (!roll.miss && attackable(t)) playerMiss(game, t); },
  });
}

// clear the local player's target shortly after it died / broke (any peer: 'kill' comes from mob.die / prop.set)
function onKill(game, target) {
  const p = game.player;
  if (p.target !== target) return;
  p.autoAttack = false;
  game.later(target.isProp ? 0.6 : 1.2, () => { if (p.target === target) { p.target = null; game.events.emit('target', { target: null }); } });
}

export function combatSystem() {
  let wired = false;
  return {
    sync: 'owner', // local auto-attack; creature dots tick on the authority only (proxies are skipped)
    update(game, dt) {
      if (!wired) { wired = true; game.events.on('kill', (d) => onKill(game, d.target)); }
      const p = game.player;
      updateDots(game, dt);
      p.swingT = Math.max(0, p.swingT - dt);
      if (p.dead) return;
      const t = p.target;
      if (t && !attackable(t) && p.autoAttack) p.autoAttack = false;
      if (!p.autoAttack || !attackable(t) || p.charge || p.spin || p.cast || p.leap || p.stunT > 0) return;
      const prof = p.wprof || weaponProfile(p.equip?.main || null);
      const d = dist(p, t);
      if (prof.ranged) {
        if (d > attackRange(p, t)) return;
        if (!hasLOS(game.world, p.x, p.y, t.x, t.y)) {
          if (game.time - losT > 2 && !game.ctl?.goal) { losT = game.time; game.events.emit('error', { text: 'Sem linha de tiro' }); }
          return;
        }
        enterCombat(p, 2);
        if (!game.ctl?.manual) faceTowards(p, t);
        if (p.swingT > 0) return;
        if (!hasAmmo(p, prof)) { noAmmo(game); p.autoAttack = false; return; }
        if (p.work) p.work = null;
        p.weapon = p.equip?.main ?? p.weapon;
        p.action = { type: 'shoot', t: 0, dur: 0.6 };
        p.swingT = p.swing;
        faceTowards(p, t); p._faceLockT = 0.62; // shoot while walking: aim at the target during the draw
        game.later(0.36, () => {
          if (p.dead || !attackable(t) || p.target !== t) return;
          if (!useAmmo(game, prof, 1)) { noAmmo(game); return; }
          faceTowards(p, t);
          playerShot(game, t, 1, 0);
          game.audio?.play('swing', { x: p.x, y: p.y, volume: 0.7 });
        });
        return;
      }
      if (d > reach(p, t)) return;
      enterCombat(p, 2);
      if (!game.ctl?.manual) faceTowards(p, t);
      if (p.swingT > 0) return;
      // attacking while walking is allowed: turn toward the target for the swing (movement facing resumes after)
      faceTowards(p, t); p._faceLockT = 0.32;
      if (p.work) { p.work = null; }
      p.weapon = p.equip?.main ?? null;
      p.action = { type: prof.act, t: 0, dur: Math.min(0.42, 0.18 + prof.swing * 0.12) };
      p.swingT = p.swing;
      game.audio?.play('swing', { x: p.x, y: p.y, volume: prof.type === 'unarmed' ? 0.5 : 1 });
      game.later(0.14, () => {
        if (p.dead || !attackable(t) || dist(p, t) > reach(p, t) + 0.5) return;
        const r = rollPlayerHit(game, t);
        applyPlayerHit(game, t, r);
        if (!r.miss && prof.stun && isMob(t) && !t.dead && Math.random() < prof.stun) stun(game, t, 1.0, p);
      });
    },
  };
}

// stun a mob (interrupts casts); elites resist half. Proxies: routed to the host.
export function stun(game, m, dur, src = game.player) {
  if (!m || m.dead || m.isProp) return;
  if (m.proxy) { mobEffect(game, m, { stun: dur }); return; }
  const d = m.elite ? dur * 0.5 : dur;
  m.stunT = Math.max(m.stunT || 0, d);
  if (m.cast) { m.cast = null; game.events.emit('damage', { target: m, src, amount: 0, kind: 'interrupt' }); }
  m.blocking = false;
  game.juice.stun(m);
  game.events.emit('damage', { target: m, src, amount: 0, kind: 'stun' });
}
