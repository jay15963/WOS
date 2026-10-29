// Action-bar abilities: dynamic bar from the equipment (ABILITY_ORDER is rebuilt in place), GCD, cooldowns,
// energy, range/LOS/ammo/item checks, casts (Aimed Shot), leaps (Disengage), shield block (hold),
// and every effect (CONTENT §4). Simulation only; the HUD reads abilityState() / p.cast.

import { ABILITIES, ABILITY_ORDER, GCD, ITEMS } from './data.js';
import { barFor, lobSpec, lobFlight } from './content/weapons.js';
import { moveCircle, facingFrom, collides } from './physics.js';
import { addBuff, removeBuff, enterCombat } from './player.js';
import {
  rollPlayerHit, applyPlayerHit, healEntity, reach, dist, attackable, isMob, faceTowards, facingVec,
  hasLOS, addDot, stun, useAmmo, noAmmo, playerShot, mobEffect, canSkin,
} from './combat.js';
import { aggro } from './ai.js';
import { fireLob, retargetLob } from './projectiles.js';

const SPIN_DIRS = ['s', 'e', 'n', 'w'];

// ---------- the bar ----------
export function rebuildBar(game) {
  const p = game.player;
  const ids = barFor(p.equip);
  const key = ids.join(',');
  if (key === p._barKey) return false;
  ABILITY_ORDER.length = 0;
  ABILITY_ORDER.push(...ids);
  p._barKey = key;
  if (p.cast && !ids.includes(p.cast.id)) cancelCast(game, null);
  if (p.block && !ids.includes('block')) endBlock(p);
  game.events.emit('bar', { ids: ABILITY_ORDER.slice() });
  return true;
}
export const barAbilities = () => ABILITY_ORDER;

// nearest attackable creature within maxD (prefers ones fighting the player)
export function nearestEnemy(game, maxD = 12, filter) {
  const p = game.player;
  let best = null, bd = 1e9;
  for (const e of game.entities) {
    if (!isMob(e) || e.dead || (filter && !filter(e))) continue;
    let d = dist(p, e);
    if (d > maxD) continue;
    if (e.state === 'chase' && e.threat === p) d -= 4;
    else if (e.temper === 'passive') d += 3;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// every hittable thing around a point (mobs + breakable props)
export function areaTargets(game, x, y, r) {
  const out = [];
  for (const e of game.entities) {
    if (!isMob(e) || e.dead) continue;
    if (Math.abs(e.x - x) > r + 1 || Math.abs(e.y - y) > r + 1) continue;
    if (Math.hypot(e.x - x, e.y - y) <= r + e.r) out.push(e);
  }
  for (const o of game.props || []) {
    if (o.broken) continue;
    if (Math.hypot(o.x - x, o.y - y) <= r + o.r) out.push(o);
  }
  return out;
}

const rangeMax = (ab) => (ab.range === 'melee' ? 3 : Array.isArray(ab.range) ? ab.range[1] : 0);

function rangeOk(game, ab, t) {
  const p = game.player;
  if (!ab.range) return 'ok';
  if (!t) return 'notarget';
  const d = dist(p, t);
  if (ab.range === 'melee') return d <= reach(p, t) + 0.15 ? 'ok' : 'far';
  if (d < ab.range[0]) return 'near';
  if (d > ab.range[1] + (t.r || 0.3)) return 'far';
  if (ab.ammo && !hasLOS(game.world, p.x, p.y, t.x, t.y)) return 'los';
  return 'ok';
}

const ammoCount = (p, ab) => (ab.ammo ? p.inv.count(ab.ammo) : -1);
const itemCount = (p, ab) => (ab.item ? p.inv.count(ab.item) : -1);

// HUD-facing state for an ability button
export function abilityState(game, id) {
  const p = game.player, ab = ABILITIES[id];
  const cd = p.cds[id] || 0;
  const gcd = ab.offGcd ? 0 : p.gcdT;
  const t = attackable(p.target) ? p.target : null;
  const rs = ab.target ? (t ? rangeOk(game, ab, t) : 'ok') : 'ok';
  const ammo = ammoCount(p, ab), items = itemCount(p, ab);
  const stocked = (ammo < 0 || ammo > 0) && (items < 0 || items > 0);
  const active = (id === 'block' && !!p.block) || (p.cast && p.cast.id === id) || (id === 'sprint' && p.buffs.some((b) => b.id === 'sprint'))
    || (!!ab.aim && game.aim?.active && game.aim.id === id);
  return {
    cd, cdDur: ab.cd, gcd, gcdDur: GCD,
    energyOk: p.energy >= (ab.cost || 0),
    inRange: rs === 'ok',
    ammo, items, stocked, active,
    usable: !p.dead && cd <= 0 && gcd <= 0 && p.energy >= (ab.cost || 0) && rs === 'ok' && stocked && !p.charge && !p.leap && !(p.stunT > 0),
  };
}

// ---------- casting ----------
export function cancelCast(game, reason = 'Interrompido') {
  const p = game.player;
  if (!p.cast) return;
  p.cast = null;
  if (p.action?.hold) p.action = null;
  if (reason) game.events.emit('error', { text: reason });
  game.events.emit('cast', { cast: null });
}

function endBlock(p) {
  p.block = null; p.blocking = false;
  removeBuff(p, 'block');
  if (p.action?.type === 'block') p.action = null;
}
// pointer/key released (hold abilities)
export function releaseAbility(game, id) {
  if (id === 'block') game.player.blockHeld = false;
}
export function holdAbility(game, id) {
  if (id === 'block') game.player.blockHeld = true;
}

export function useAbility(game, id) {
  const p = game.player, ab = ABILITIES[id];
  const err = (text) => { game.events.emit('error', { text }); return false; };
  if (!ab || ab.auto || p.dead) return false;
  if (!ABILITY_ORDER.includes(id)) return err('Não disponível com esta arma');
  if (p.charge || p.leap) return false;
  if (p.stunT > 0) return err('Atordoado');
  if (p.cast) { if (p.cast.id === id) return false; return err('Conjurando…'); }
  if (id === 'block' && p.block) { p.blockHeld = true; return false; }
  if ((p.cds[id] || 0) > 0) return err('Ainda não está pronto');
  if (!ab.offGcd && p.gcdT > 0) {
    // WoW-like queue window: a press near the end of the GCD fires as soon as it ends
    if (p.gcdT < 0.5) p.queued = id;
    return false;
  }
  if (p.energy < (ab.cost || 0)) return err('Sem energia');
  if (ab.item && p.inv.count(ab.item) <= 0) return err(ab.item === 'bandage' ? 'Sem bandagens na mochila' : `Sem ${(ITEMS[ab.item]?.name || ab.item).toLowerCase()} na mochila`);
  if (ab.ammo && p.inv.count(ab.ammo) <= 0) { noAmmo(game); return false; }
  if (ab.aim) { // ground skillshot used without aiming (queue, tests, old bindings): at the target
    const pt = aimDefault(game, id);
    if (!pt) return err('Sem alvo: segure o botão e arraste para mirar');
    return fireAimed(game, id, pt.x, pt.y) === true;
  }

  let t = null;
  if (ab.target) {
    t = attackable(p.target) ? p.target : null;
    if (!t) {
      t = nearestEnemy(game, rangeMax(ab));
      if (t) { p.target = t; game.events.emit('target', { target: t }); }
    }
    if (!t) return err('Sem alvo');
    const rs = rangeOk(game, ab, t);
    if (rs === 'far') return err('Muito longe');
    if (rs === 'near') return err('Perto demais');
    if (rs === 'los') return err('Sem linha de tiro');
  } else if (attackable(p.target) && dist(p, p.target) < 4) t = p.target;

  // cancel gathering
  if (p.work) { p.work = null; p.action = null; }
  if (!ab.offGcd) p.gcdT = GCD;
  game.audio?.play('ui', { volume: 0.3 });
  if (ab.cast) { startCast(game, id, ab, t); return true; }
  p.energy -= ab.cost || 0;
  p.cds[id] = ab.cd || 0;
  if (t && t !== p) faceTowards(p, t);
  effect(game, id, ab, t);
  return true;
}

// ---------- aimed ground abilities (aim: 'ground': Tiro Longo, Lançar Lança) ----------
// The UI (src/ui/aim.js) picks the point; fireAimed pays energy / cooldown / the arrow, rolls the damage (attacker's
// roll, like every player hit) and asks the host (intent lob.fire, mut/bow.js), which rolls the scatter, flies the
// real projectile and resolves the hit. A guest shows its own copy at once and bends it onto the host's landing.

// flight / accuracy spec of this ability with the current main hand (null = wrong weapon)
export function aimSpec(game, id) {
  const ab = ABILITIES[id], S = lobSpec(game.player.equip?.main);
  return ab?.lob && S && S.type === ab.lob ? S : null;
}

// why the ability cannot start aiming now ('' = silent no), or null when it can
export function aimCheck(game, id) {
  const p = game.player, ab = ABILITIES[id];
  if (!ab || !ab.aim || p.dead) return '';
  if (!ABILITY_ORDER.includes(id)) return 'Não disponível com esta arma';
  if (p.charge || p.leap) return '';
  if (p.stunT > 0) return 'Atordoado';
  if (p.cast) return 'Conjurando…';
  if ((p.cds[id] || 0) > 0) return 'Ainda não está pronto';
  if (p.energy < (ab.cost || 0)) return 'Sem energia';
  if (ab.ammo && p.inv.count(ab.ammo) <= 0) return 'Sem flechas';
  if (!aimSpec(game, id)) return ab.lob === 'bow' ? 'Precisa de um arco' : 'Precisa de uma lança';
  if (p._throwT > 0) return 'A lança ainda está no ar';
  return null;
}

// default point for a quick tap / an unaimed use: the target, else the nearest enemy in range
export function aimDefault(game, id) {
  const p = game.player, S = aimSpec(game, id);
  if (!S) return null;
  const R = S.range + 0.5;
  const t = attackable(p.target) && !p.target.isProp && dist(p, p.target) <= R ? p.target : nearestEnemy(game, R);
  return t ? { x: t.x, y: t.y, target: t } : null;
}

// fire at the world point (wx, wy): true = fired · 'wait' = global cooldown still running · false = refused (error shown)
let lobSeq = 0;
export function fireAimed(game, id, wx, wy) {
  const p = game.player, ab = ABILITIES[id], net = game.net;
  const why = aimCheck(game, id);
  if (why != null) { if (why) game.events.emit('error', { text: why }); return false; }
  if (!ab.offGcd && p.gcdT > 0) return 'wait';
  const S = aimSpec(game, id);
  let dx = wx - p.x, dy = wy - p.y, d = Math.hypot(dx, dy);
  if (d < 0.05) { [dx, dy] = facingVec(p.facing); d = 1; }
  const D = Math.min(Math.max(d, 1), S.range);
  const ax = p.x + (dx / d) * D, ay = p.y + (dy / d) * D;
  // costs (refunded when the host refuses)
  if (p.work) { p.work = null; p.action = null; }
  if (!ab.offGcd) p.gcdT = GCD;
  p.energy -= ab.cost || 0;
  p.cds[id] = ab.cd || 0;
  const paid = ab.ammo ? useAmmo(game, p.wprof, 1) : 0;
  enterCombat(p, 3);
  // pose: face the shot and release (bow recoil / spear follow-through)
  p.weapon = p.equip?.main ?? p.weapon;
  p.facing = facingFrom(dx, dy, p.facing); p._faceLockT = 0.5;
  p.action = ab.act === 'throw' ? { type: 'throw', t: 0.46, dur: 0.42 } : { type: 'shoot', t: 0.7, dur: 0.32 };
  p.swingT = Math.max(p.swingT || 0, 0.6); // no auto-shot right on top of it
  game.audio?.play(S.proj === 'spear' ? 'swing' : 'bow_release', { x: p.x, y: p.y, volume: 0.9 });
  const roll = rollPlayerHit(game, { level: p.level }, ab.mult || 1, ab.flat || 0, false);
  const { dur, apex } = lobFlight(S, D);
  if (S.proj === 'spear') p._throwT = dur; // the hand is empty until the spear lands (src/ui/aim.js hides it)
  const r2 = (v) => Math.round(v * 100) / 100;
  const args = { ab: id, w: p.equip?.main || null, x: r2(p.x), y: r2(p.y), ax: r2(ax), ay: r2(ay), amount: roll.amount, crit: roll.crit ? 1 : 0, skin: canSkin(game) ? 1 : 0 };
  // guest: its own copy flies right away toward the aim point (bent onto the host's landing on the ack)
  const mine = net.auth ? null : fireLob(game, { id: `${net.pid}:L${++lobSeq}`, cosmetic: true, proj: S.proj, x: p.x, y: p.y, lx: ax, ly: ay, dur, apex, owner: net.pid });
  const undo = (text) => {
    if (mine) { mine.alpha = 0; mine.stuck = true; mine.t = 0; }
    p.energy = Math.min(p.maxEnergy, p.energy + (ab.cost || 0));
    p.cds[id] = 0; p.gcdT = 0; p._throwT = 0;
    if (text) game.events.emit('error', { text });
  };
  net.request('lob.fire', args, {
    refund: paid ? { [ab.ammo]: paid } : undefined,
    onOk: (res) => { if (mine && res && typeof res.lx === 'number') retargetLob(mine, res.lx, res.ly, typeof res.id === 'string' ? res.id : null); },
    onReject: (text) => undo(text || 'Não deu para atirar'),
  });
  game.events.emit('aimfire', { id, x: ax, y: ay, dur });
  return true;
}

function startCast(game, id, ab, t) {
  const p = game.player;
  faceTowards(p, t);
  p.cast = { id, name: ab.name, t: 0, dur: ab.cast, target: t };
  p.action = { type: ab.act || 'cast', t: 0, hold: true };
  p.autoAttack = true;
  enterCombat(p, 3);
  game.events.emit('cast', { cast: p.cast });
}

function finishCast(game) {
  const p = game.player, c = p.cast, ab = ABILITIES[c.id], t = c.target;
  p.cast = null;
  game.events.emit('cast', { cast: null });
  if (!attackable(t)) { p.action = null; return; }
  const rs = rangeOk(game, ab, t);
  if (rs !== 'ok') { p.action = null; game.events.emit('error', { text: rs === 'los' ? 'Sem linha de tiro' : 'Muito longe' }); return; }
  if (p.energy < ab.cost) { p.action = null; game.events.emit('error', { text: 'Sem energia' }); return; }
  p.energy -= ab.cost;
  p.cds[c.id] = ab.cd;
  effect(game, c.id, ab, t);
}

const weapon = (p) => p.equip?.main ?? null;
const avgHit = (p) => ((p.wMin + p.wMax) / 2) * (p.dmgMul || 1);

function melee(game, t, mult, flat, opts = {}, delay = 0.1, after) {
  game.later(delay, () => {
    if (!attackable(t)) return;
    const r = rollPlayerHit(game, t, mult, flat, opts.canMiss ?? true, opts.critBonus || 0);
    applyPlayerHit(game, t, r, { ability: opts.ability, knock: opts.knock, dtype: opts.dtype });
    if (!r.miss) after?.(t, r);
  });
}

// unit vector from the player toward t (or the facing)
function aimDir(p, t) {
  if (t) { const dx = t.x - p.x, dy = t.y - p.y, L = Math.hypot(dx, dy); if (L > 0.05) return [dx / L, dy / L]; }
  return facingVec(p.facing);
}

function cone(game, dir, r, minDot) {
  const p = game.player;
  return areaTargets(game, p.x, p.y, r).filter((e) => {
    const dx = e.x - p.x, dy = e.y - p.y, L = Math.hypot(dx, dy);
    return L < 0.45 || (dx * dir[0] + dy * dir[1]) / L >= minDot;
  });
}

function slashFx(game, x, y, dir, n, spread, len) {
  const J = game.juice, s = J.spr('fx_slash', 'fx_ring');
  if (!s) return;
  const a0 = Math.atan2(dir[1], dir[0]);
  for (let i = 0; i < n; i++) {
    const a = a0 + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
    J.emit({ spr: s, x: x + Math.cos(a) * len, y: y + Math.sin(a) * len * 0.75, vx: Math.cos(a) * 2, vy: Math.sin(a) * 1.4, life: 0.26, size: 0.9, size1: 1.25, rot: a + Math.PI / 2, a: 0.85, a1: 0, layer: 'emissive', lift: 0.45, ground: false });
  }
}

function effect(game, id, ab, t) {
  const p = game.player, J = game.juice;
  const act = (type, dur = 0.34) => { p.weapon = weapon(p); p.action = { type, t: 0, dur }; };
  enterCombat(p, 3);
  switch (id) {
    case 'shove': {
      act('bash', 0.32);
      game.audio?.play('swing', { x: p.x, y: p.y, volume: 0.6 });
      melee(game, t, 0.6, 0, { ability: id, knock: 1.6 }, 0.12, (e) => {
        if (isMob(e)) mobEffect(game, e, { daze: 1.5, interrupt: 1 });
        J.puff(e.x, e.y, 6);
      });
      break;
    }
    case 'stab': {
      act('stab', 0.26);
      game.audio?.play('swing', { x: p.x, y: p.y, volume: 0.8 });
      melee(game, t, 1.5, 2, { ability: id, critBonus: 0.25 }, 0.08);
      break;
    }
    case 'lacerate': {
      act('lacerate', 0.32);
      game.audio?.play('swing', { x: p.x, y: p.y });
      melee(game, t, 0.6, 0, { ability: id }, 0.1, (e) => {
        if (!isMob(e)) return;
        mobEffect(game, e, { dot: { id: 'bleed', dur: 8, tick: 2, dmg: Math.max(1, Math.round(avgHit(p) * 1.6 / 4)) }, status: ['Sangrando', 'bleed'] });
      });
      break;
    }
    case 'cleave': {
      act('cleave', 0.42);
      const dir = aimDir(p, t);
      p.facing = facingFrom(dir[0], dir[1], p.facing);
      game.audio?.play('swing', { x: p.x, y: p.y, volume: 1.1 });
      slashFx(game, p.x, p.y, dir, 3, 1.6, 1.2);
      const list = cone(game, dir, 2.4, 0.3);
      list.forEach((e, n) => melee(game, e, 1.4, 1, { ability: id }, 0.14 + n * 0.03));
      if (list.length > 1) game.juice.shake(0.18);
      break;
    }
    case 'smash': {
      act('smash', 0.42);
      game.audio?.play('swing', { x: p.x, y: p.y, volume: 1.1 });
      melee(game, t, 1.7, 2, { ability: id }, 0.2, (e) => {
        stun(game, e, 2);
        J.puff(e.x, e.y, 10, [0.7, 0.62, 0.5], 0.8);
        J.shake(0.3);
      });
      break;
    }
    case 'pierce': {
      act('pierce', 0.36);
      const dir = aimDir(p, t);
      p.facing = facingFrom(dir[0], dir[1], p.facing);
      game.audio?.play('swing', { x: p.x, y: p.y });
      const L = 3.6, hits = [];
      for (const e of areaTargets(game, p.x, p.y, L + 0.5)) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const along = dx * dir[0] + dy * dir[1];
        const perp = Math.abs(dx * dir[1] - dy * dir[0]);
        if (along > -0.2 && along < L + e.r && perp < 0.5 + e.r) hits.push([along, e]);
      }
      hits.sort((a, b) => a[0] - b[0]);
      hits.forEach(([along, e], n) => melee(game, e, 1.5, 2, { ability: id, knock: 0.25 }, 0.1 + along * 0.025 + n * 0.01));
      const sp = J.spr('fx_slash', 'fx_spark');
      if (sp) for (let k = 0; k < 5; k++) J.emit({ spr: sp, x: p.x + dir[0] * (0.6 + k * 0.7), y: p.y + dir[1] * (0.6 + k * 0.7), life: 0.18 + k * 0.03, size: 0.7, size1: 0.2, rot: Math.atan2(dir[1], dir[0]), a: 0.9, a1: 0, layer: 'emissive', lift: 0.5, ground: false });
      break;
    }
    case 'sweep': {
      act('sweep', 0.44);
      const dir = aimDir(p, t);
      game.audio?.play('swing', { x: p.x, y: p.y, volume: 1.1 });
      slashFx(game, p.x, p.y, dir, 5, 3.2, 1.5);
      cone(game, dir, 2.5, -0.25).forEach((e, n) => melee(game, e, 0.9, 1, { ability: id, knock: 1.2 }, 0.12 + n * 0.03, (h) => { if (isMob(h)) mobEffect(game, h, { daze: 0.6 }); }));
      break;
    }
    case 'strike': {
      act('attack', 0.32);
      p.autoAttack = true;
      game.audio?.play('swing', { x: p.x, y: p.y });
      melee(game, t, 1.8, 4, { ability: id }, 0.1);
      break;
    }
    case 'charge': {
      p.weapon = weapon(p);
      p.charge = { target: t, t: 0 };
      p.autoAttack = true;
      aggro(game, t, p);
      game.audio?.play('swing', { x: p.x, y: p.y });
      break;
    }
    case 'whirlwind': {
      p.weapon = weapon(p);
      p.spin = { t: 0, dur: 0.5 };
      p.action = { type: 'whirlwind', t: 0, dur: 0.5 };
      J.whirl(p);
      game.audio?.play('swing', { x: p.x, y: p.y });
      areaTargets(game, p.x, p.y, 2.3).forEach((e, n) => melee(game, e, 1.1, 2, { ability: id }, 0.08 + n * 0.03));
      break;
    }
    case 'aimed_shot': {
      act('shoot', 0.3);
      p.action.t = 0.55; // release from the held draw
      playerShot(game, t, 2.6, 6, { ability: id });
      if (!useAmmo(game, p.wprof, 1)) noAmmo(game);
      game.audio?.play('crit', { x: p.x, y: p.y, volume: 0.5 });
      J.shake(0.12);
      break;
    }
    case 'multi_shot': {
      act('shoot', 0.45);
      const n = useAmmo(game, p.wprof, 3);
      const angs = n >= 3 ? [-0.24, 0, 0.24] : n === 2 ? [-0.12, 0.12] : [0];
      game.later(0.22, () => {
        for (const a of angs) {
          if (a === 0 || angs.length < 3) playerShot(game, t, 0.9, 0, { ability: id, angle: a });
          else shotWide(game, t, a, id);
        }
        game.audio?.play('swing', { x: p.x, y: p.y });
      });
      if (n < 3) game.events.emit('error', { text: n === 2 ? 'Só 2 flechas' : 'Só 1 flecha' });
      break;
    }
    case 'disengage': {
      const away = t || nearestEnemy(game, 6);
      let [dx, dy] = away ? [p.x - away.x, p.y - away.y] : facingVec(p.facing).map((v) => -v);
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      p.leap = { dx, dy, t: 0, dur: 0.38, dist: 4 };
      p.cast = null;
      J.puff(p.x, p.y, 8);
      game.audio?.play('swing', { x: p.x, y: p.y, volume: 0.6 });
      break;
    }
    case 'block': {
      p.block = { t: 0 };
      p.blocking = true;
      p.blockHeld = true;
      p.weapon = weapon(p);
      p.action = { type: 'block', t: 0, dur: 0.22 };
      addBuff(p, 'block', 4);
      game.audio?.play('build', { x: p.x, y: p.y, volume: 0.5 });
      break;
    }
    case 'shield_bash': {
      act('bash', 0.34);
      if (p.block) endBlock(p);
      game.audio?.play('swing', { x: p.x, y: p.y });
      melee(game, t, 0.7, 2, { ability: id, knock: 0.6 }, 0.12, (e) => {
        stun(game, e, 1);
        J.chips(e.x, e.y, [0.9, 0.85, 0.7], 8, 0.6);
        J.shake(0.2);
      });
      break;
    }
    case 'torch_swing': {
      act('torch_swing', 0.38);
      const dir = aimDir(p, t);
      p.facing = facingFrom(dir[0], dir[1], p.facing);
      game.audio?.play('fire', { x: p.x, y: p.y });
      flameFx(game, p, dir);
      cone(game, dir, 2.3, -0.05).forEach((e, n) => melee(game, e, 0.6, 1, { ability: id, dtype: 'fire', canMiss: false }, 0.12 + n * 0.03, (h) => {
        if (!isMob(h)) return;
        mobEffect(game, h, { dot: { id: 'burn', dur: 3, tick: 1, dmg: Math.max(1, Math.round(avgHit(p) * 0.3)) }, fear: 4 });
      }));
      break;
    }
    case 'bandage': {
      if (!p.inv.remove('bandage', 1)) { game.events.emit('error', { text: 'Sem bandagens na mochila' }); break; }
      game.events.emit('inventory', {});
      const total = p.maxHp * 0.4, ticks = 8;
      addBuff(p, 'bandage', 8, { tick: 1, tickT: 1, onTick: (g, pl) => healEntity(g, pl, total / ticks) });
      p.action = { type: 'bandage', t: 0, dur: 0.5 };
      game.audio?.play('eat', { x: p.x, y: p.y, volume: 0.5 });
      break;
    }
    case 'sprint': {
      addBuff(p, 'sprint', 5);
      J.puff(p.x, p.y, 8);
      break;
    }
  }
}

// side arrows of Multi-Shot: straight (no homing), hit whatever they meet
function shotWide(game, t, angle, ability) {
  playerShot(game, t, 0.9, 0, { ability, angle, side: true });
}

function flameFx(game, p, dir) {
  const J = game.juice, f = J.spr('fx_flame', 'fx_spark'), sm = J.spr('fx_smoke', 'fx_dust');
  const a0 = Math.atan2(dir[1], dir[0]);
  if (f) for (let i = 0; i < 12; i++) {
    const a = a0 + (Math.random() - 0.5) * 1.8, v = 2.5 + Math.random() * 2.5;
    J.emit({ spr: f, x: p.x + dir[0] * 0.5, y: p.y + dir[1] * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, life: 0.35 + Math.random() * 0.2, size: 0.45, size1: 0.15, r: 1, g: 0.7, b: 0.3, a: 1, a1: 0, layer: 'emissive', lift: 0.7, vlift: 0.6, drag: 3, ground: false });
  }
  if (sm) J.emit({ spr: sm, x: p.x + dir[0], y: p.y + dir[1] * 0.8, life: 0.8, size: 0.5, size1: 1.4, r: 0.4, g: 0.38, b: 0.36, a: 0.4, a1: 0, lift: 0.8, vlift: 0.6 });
}

// ---------- per-frame ----------
export function abilitiesSystem() {
  let barInit = false;
  return {
    sync: 'owner', // the local player's bar, casts, charges, leaps
    update(game, dt) {
      const p = game.player;
      if (!barInit) { barInit = true; game.events.on('gear', () => rebuildBar(game)); rebuildBar(game); }
      // independent of refreshGear's key (stats may be refreshed by applyLevel in the same frame)
      const eq = p.equip;
      const hands = eq ? `${eq.main || ''}|${eq.off || ''}` : '|';
      if (hands !== p._barHands) { p._barHands = hands; rebuildBar(game); }
      p.gcdT = Math.max(0, p.gcdT - dt);
      for (const k in p.cds) if (p.cds[k] > 0) p.cds[k] = Math.max(0, p.cds[k] - dt);
      if (p.dead) { p.charge = null; p.spin = null; p.queued = null; p.leap = null; p.cast = null; p.block = null; p.blocking = false; return; }
      if (p.queued && p.gcdT <= 0 && !p.charge && !p.cast) { const id = p.queued; p.queued = null; useAbility(game, id); }

      // casting (Aimed Shot): manual movement or stun cancels; bar progress in p.cast.t / p.cast.dur
      if (p.cast) {
        const [mx, my] = game.input.move();
        if (mx || my || p.stunT > 0) cancelCast(game, mx || my ? 'Interrompido (movimento)' : 'Interrompido');
        else if (!attackable(p.cast.target)) cancelCast(game, null);
        else {
          p.cast.t += dt;
          faceTowards(p, p.cast.target);
          if (p.action && p.action.hold) p.action.t = 0.55 * Math.min(1, p.cast.t / p.cast.dur);
          if (p.cast.t >= p.cast.dur) finishCast(game);
        }
      }

      // shield block: 2 s, held up to 4 s
      if (p.block) {
        p.block.t += dt;
        const slot = ABILITY_ORDER.indexOf('block') + 1;
        const K = game.input.keys;
        const held = p.blockHeld || (slot > 0 && (K?.has('Digit' + slot) || K?.has('Numpad' + slot)));
        if (!held) p.blockHeld = false;
        p.blocking = true;
        if ((p.block.t >= 2 && !held) || p.block.t >= 4 || !p.shield || p.stunT > 0) endBlock(p);
      }

      // charge: fast dash to target, then stun
      if (p.charge) {
        const c = p.charge, t = c.target;
        c.t += dt;
        if (!attackable(t)) { p.charge = null; }
        else {
          const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
          const stopAt = reach(p, t) - 0.25;
          const step = Math.min(22 * dt, Math.max(0, d - stopAt));
          const moved = step > 0 && moveCircle(game.world, p, (dx / d) * step, (dy / d) * step);
          p.facing = facingFrom(dx, dy, p.facing);
          p.moving = true; p.moveT += dt * 4;
          game.juice.trail(p);
          if (d - step <= stopAt + 0.05 || !moved || c.t > 0.8) {
            p.charge = null; p.moving = false;
            if (dist(p, t) <= reach(p, t) + 0.6) {
              stun(game, t, 1.5);
              game.juice.shake(0.3);
              p.action = { type: 'attack', t: 0, dur: 0.3 };
              applyPlayerHit(game, t, rollPlayerHit(game, t, 0.6, 2, false), { ability: 'charge' });
            }
          }
        }
      }

      // disengage leap: quick backwards hop (p.jumpLift is an optional visual height for the art)
      if (p.leap) {
        const L = p.leap;
        const k0 = L.t / L.dur;
        L.t += dt;
        const k1 = Math.min(1, L.t / L.dur);
        const step = (k1 - k0) * L.dist;
        if (step > 0) {
          const nx = p.x + L.dx * step, ny = p.y + L.dy * step;
          if (!collides(game.world, nx, ny, p.r)) { p.x = nx; p.y = ny; }
          else moveCircle(game.world, p, L.dx * step, L.dy * step);
        }
        p.jumpLift = Math.sin(k1 * Math.PI) * 0.45;
        p.moving = true; p.moveT += dt * 3;
        if (k1 >= 1) { p.leap = null; p.jumpLift = 0; p.moving = false; game.juice.puff(p.x, p.y, 6); }
        else game.juice.trail(p);
      }

      // whirlwind spin visual: cycle facing
      if (p.spin) {
        p.spin.t += dt;
        p.facing = SPIN_DIRS[Math.floor(p.spin.t * 16) % 4];
        if (p.spin.t >= p.spin.dur) p.spin = null;
      }

      p.rooted = !!(p.charge || p.leap || p.cast || p.stunT > 0);
    },
  };
}
