// Horses (docs/HORSE.md; numbers in content/horses.js). A wild horse (content/fauna.js wild_horse, the herds of the
// steppes) is tamed by hand: "Dar trigo" three times (one wheat each) and it becomes the players' horse — the farm
// animal 'horse' (livestock.js: owned, saved with the world, tied with a rope, aboard a boat, hungry anywhere: it eats
// wheat at a feeder or starves). With a saddle ("Selar") it can be ridden ("Montar" / "Desmontar"): the rider moves at
// the sprint's speed, a big body that keeps out of deep water, doors, stairs and tunnels; only the spear fights from
// horseback, and its long shot becomes the lance charge ("Estocada": abilities.js), the one attack that does not stop
// the horse.
//
// Multiplayer (docs/SYNC.md): the horse is a host creature like every animal. Taming, saddling, mounting and getting off
// are intents (mut/horses.js: horse.feed · horse.saddle · horse.unsaddle · horse.mount · horse.dismount); the horse's
// state reaches every peer through the entity stream (net/entities.js: the saddle bit, the rider's pid) and the op
// horse.ride (who rides what: game.horses.rides on every peer, the landing spot of the one getting off). The rider drives
// the movement as the owner of its avatar (like the boat's rower): the host keeps its horse under the avatar (rideFollow)
// and every peer draws the pair as one unit at the rider's drawn spot (horseSystem: _ride / _rideD / _riddenBy marks; the
// pawn draws the horse between its legs and its body: art/compose.js, art/faunaDraw.js ridePose / rideDraw).
//
// Host fields on a horse (besides livestock's): tameN (wild: wheat eaten), saddle, rider (pid). Cosmetic: _rd (its
// drawing state while ridden), _riddenBy (the rider drawn with it). Owner: game.player.mount { nid, spd, … }.

import { SPECIES, BUILDINGS } from './data.js';
import { STOCK } from './content/livestock.js';
import { HORSE } from './content/horses.js';
import { mobStats } from './stats.js';
import { takeFromHerd, stockBrain } from './livestock.js';
import { registerWork } from './gathering.js';
import { allPlayers } from './players.js';
import { moveCircle, collides, facingFrom } from './physics.js';
import { resetNav } from './nav.js';
import { stepGait } from './anim.js';
import { dealDamage } from './combat.js';
import { hasBuff, removeBuff } from './player.js';

const r2 = (v) => Math.round(v * 100) / 100;
export const isHorse = (e) => e?.species === 'horse';
export const isWildHorse = (e) => e?.species === 'wild_horse';
const ME = (game) => game.net.pid;

// ---------- lookups ----------
// a horse by its creature id (host: the creature; guest: its proxy)
export function horseByNid(game, nid) {
  if (!nid) return null;
  if (!game.net.auth) return game.net.entsApi?.byNid?.(nid) || null;
  for (const e of game.entities) if (e.nid === nid && e.isMob && !e.proxy) return e;
  return null;
}
// host: the horse a player rides
export function horseOf(game, pid) {
  if (!pid) return null;
  for (const e of game.entities) if (e.rider === pid && e.isMob && !e.dead && !e.proxy) return e;
  return null;
}
// host: a player's avatar (the local player, a remote avatar: its latest position)
function avatarOf(game, pid) {
  for (const q of allPlayers(game)) if ((q === game.player ? game.net.pid : q.pid) === pid) return q;
  return null;
}
// any peer: the drawn entity of a player
function drawnPlayer(game, pid) {
  if (!pid) return null;
  if (pid === game.net.pid) return game.player;
  return game.session?.players?.get?.(pid)?.ent || null;
}

// ---------- host: taming ----------
// a wild horse eats the wheat from the actor's hand (intent horse.feed): it calms down a while; the third one tames it
export function feedWild(game, m, actor) {
  m.tameN = (m.tameN || 0) + 1;
  m.state = 'idle'; m.stateT = HORSE.calmT; m.calmT = HORSE.calmT; m.fleeT = 0; m.fearT = 0; m.moving = false; m.leaving = false;
  const e = actor.ent;
  if (e) m.facing = facingFrom(e.x - m.x, e.y - m.y, m.facing);
  resetNav(m);
  if (m.tameN < HORSE.tameGives) return m.tameN;
  tameHorse(game, m);
  return 'tamed';
}
// the wild horse becomes the players' horse, in place (same creature id): out of its herd for good, a farm animal
export function tameHorse(game, m) {
  const sp = SPECIES.horse, st = mobStats(sp, m.level || 1), now = game.worldTime;
  takeFromHerd(game, m); // (owned; its herd refills a while later)
  Object.assign(m, {
    species: 'horse', name: sp.name, temper: sp.temper, r: sp.r, maxHp: st.maxHp, hp: st.maxHp, dmg: 0, elite: false,
    scale: +((m.scale || 1) * sp.scale).toFixed(3), variant: (m.variant | 0) & ~2, // (its coat kept; bit 1 = a foal in the farm code)
    brain: stockBrain, stock: STOCK.horse, fauna: null, fmode: 0, owned: true, tame: true, fed: 0.75, starveT: 0, wantEat: false,
    bornAt: now, adultAt: null, breedAt: now + 1e9, saddle: false, rider: null, tiedTo: null, tameN: 0,
    state: 'idle', stateT: 4, threat: null, fleeT: 0, fleeFrom: null, fearT: 0, leaving: false, calmT: 0, home: { x: m.x, y: m.y }, action: null,
  });
  resetNav(m);
}

// ---------- host: riding ----------
export function mountHorse(game, m, pid) {
  const net = game.net;
  if (m.tiedTo) { const lead = m.tiedTo; m.tiedTo = null; net.emit('stock.rope', { nid: m.nid, on: 0, x: r2(m.x), y: r2(m.y), by: lead, give: { rope: 1 } }); } // (the rope back)
  m.rider = pid; m._rideAt = game.worldTime; m.noPush = true; m.state = 'idle'; m.moving = false; m.action = null; m.wantEat = false; m.eatT = 0; m.fleeT = 0; m.fearT = 0;
  resetNav(m);
  net.emit('horse.ride', { nid: m.nid, pid, on: 1, x: r2(m.x), y: r2(m.y) });
}
// the rider gets off (why: 'hand' · 'horse' its horse died · 'dead' / 'gone' the rider · 'far' the avatar left the horse)
export function dismountHorse(game, m, why = 'hand') {
  const pid = m.rider;
  if (!pid) return;
  m.rider = null; m.noPush = false; m.home = { x: m.x, y: m.y }; m.state = 'idle'; m.stateT = 3; m.moving = false;
  const spot = why === 'dead' || why === 'gone' || why === 'far' ? null : landing(game, m);
  const toast = why === 'horse' ? 'Seu cavalo morreu: você caiu (sem se machucar)' : undefined;
  game.net.emit('horse.ride', { nid: m.nid, pid, on: 0, x: spot ? spot[0] : undefined, y: spot ? spot[1] : undefined, by: pid, toast, toastKind: toast ? 'bad' : undefined });
}
// where the rider steps off: beside the horse (its left side first), on dry ground
function landing(game, m) {
  const w = game.world, F = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 }[m.facing] ?? 0;
  for (const da of [-Math.PI / 2, Math.PI / 2, Math.PI, 0, -Math.PI / 4, Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4]) {
    for (const d of [0.72, 1.0, 1.35]) {
      const x = m.x + Math.cos(F + da) * d, y = m.y + Math.sin(F + da) * d, tx = Math.floor(x), ty = Math.floor(y);
      if (!w.inBounds(tx, ty) || w.liquidAt(tx, ty) === 2 || collides(w, x, y, 0.26, null, false, false)) continue;
      return [r2(x), r2(y)];
    }
  }
  return [r2(m.x), r2(m.y)]; // (nowhere around: where it stands)
}
// a ridden horse keeps under its rider's avatar (stockBrain, every frame on the host)
export function rideFollow(game, m, dt) {
  const q = avatarOf(game, m.rider);
  if (!q || q.dead || q.gone) { dismountHorse(game, m, q?.dead ? 'dead' : 'gone'); return; }
  const dx = game.world.dx ? game.world.dx(q.x, m.x) : q.x - m.x, dy = q.y - m.y, d = Math.hypot(dx, dy);
  if (d > HORSE.farRide) { dismountHorse(game, m, 'far'); return; }
  if (d > 0.6 && game.worldTime - (m._rideAt || 0) < 1) { m.moving = false; return; } // (just mounted: the rider's avatar is on its way to the saddle)
  if (d > 1e-4) { stepGait(m, d); if (!q.facing) m.facing = facingFrom(dx, dy, m.facing); }
  m.x = q.x; m.y = q.y; m.lv = 0; m.z = 0;
  m.moving = !!q.moving || d > 0.01;
  if (q.facing) m.facing = q.facing;
  m.state = 'idle'; m.stateT = 2; m.fleeT = 0; m.fearT = 0; m.action = null; m.wantEat = false; m.eatT = 0;
  m.home.x = m.x; m.home.y = m.y;
  void dt;
}
// a creature's blow at a mounted player: the horse (the bigger target) takes it now and then (players.js hurtPlayer)
export function hurtRedirect(game, target, src, amount, opts = {}) {
  if (!game.net.auth || !target || opts.dot || !src || !src.isMob) return null;
  const pid = target === game.player ? game.net.pid : target.pid;
  const h = horseOf(game, pid);
  if (!h || h === src || game.net.roll() > HORSE.hurtK) return null;
  return dealDamage(game, src, h, amount, { crit: opts.crit, ranged: opts.ranged, from: opts.from, noKnock: true, dtype: opts.dtype });
}
// host: ridden horses that died throw their rider (unhurt)
function hostTidy(game) {
  for (const m of game.entities) if (m.rider && m.isMob && !m.proxy && m.species === 'horse' && m.dead) dismountHorse(game, m, 'horse');
}

// ---------- the owner on horseback ----------
// no doors (a gate in a fence is fine), stairs, tunnels, upper stories; deep water: a mounted body does not swim
function rideForbidden(game, p) {
  if (p.lv > 0 || p.z > 0.05 || p._tn != null) return true;
  const w = game.world, G = game.build?.grid?.main, r = 0.2;
  if (!G) return false;
  for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const tx = Math.floor(p.x + ox), ty = Math.floor(p.y + oy);
    if (!w.inBounds(tx, ty)) return true;
    const o = G.get(w.idx(tx, ty));
    if (!o || o.blueprint) continue;
    if ((o.door && !String(o.type).startsWith('gate')) || BUILDINGS[o.type]?.block === 'stairs') return true;
  }
  return false;
}
// the rider's step (game.js, instead of moveCircle): the horse's body (wider, no swimming); a step into a forbidden
// tile is taken back (each axis on its own, so it slides along the doorway)
export function rideMove(game, p, dx, dy) {
  const w = game.world, r0 = p.r, sw = p.canSwim;
  const save = () => [p.x, p.y, p._tn, p._tt, p.lv, p.z, p._ud, p._ut];
  const back = (s) => { [p.x, p.y, p._tn, p._tt, p.lv, p.z, p._ud, p._ut] = s; };
  const R = collides(w, p.x, p.y, HORSE.r, null, false, false) ? r0 : HORSE.r; // (wedged in somewhere: the body's own size to get out)
  p.r = R; p.canSwim = false;
  let moved = false;
  try {
    const s0 = save();
    moved = moveCircle(w, p, dx, dy);
    if (moved && rideForbidden(game, p)) {
      back(s0); moved = false;
      for (const [ax, ay] of [[dx, 0], [0, dy]]) {
        if (!ax && !ay) continue;
        const s1 = save();
        if (moveCircle(w, p, ax, ay) && !rideForbidden(game, p)) { moved = true; continue; }
        back(s1);
      }
      if (!moved) refuseOnce(game, 'Cavalo não passa: portas, escadas e túneis só a pé');
    }
  } finally { p.r = r0; p.canSwim = sw; }
  if (!moved && game.world.liquidAt(Math.floor(p.x + Math.sign(dx) * 0.6), Math.floor(p.y + Math.sign(dy) * 0.6)) === 2) refuseOnce(game, 'Água funda: o cavalo não nada');
  return moved;
}
let refuseT = -9;
function refuseOnce(game, text) {
  if (game.time - refuseT < 2.5) return;
  refuseT = game.time;
  game.events.emit('error', { text });
}

// local mount state (from the op horse.ride: game.horses.rides)
function mountLocal(game, p, nid) {
  p.mount = { nid, spd: 0, vx: 0, vy: 0, px: p.x, py: p.y, lost: 0, sent: false };
  p.work = null; p.action = null; p.autoMove = null; p.pose = null;
  if (game.ctl) game.ctl.goal = null;
  if (hasBuff(p, 'sprint')) removeBuff(p, 'sprint');
  const H = game.horses, at = H.mountAt;
  H.mountAt = null;
  if (at) { p.x = at[0]; p.y = at[1]; p.moving = false; }
  game.events.emit('horse', { on: true, nid });
  const h = game.ctl?.hinted;
  if (h && !h.horse) {
    h.horse = true;
    game.events.emit('toast', { text: game.input?.isTouch ? 'Montado: o direcional galopa · só a lança ataca' : 'Montado: WASD galopa · E desmonta · só a lança', kind: 'info' });
  }
}
function unmountLocal(game, p) {
  p.mount = null;
  game.events.emit('horse', { on: false });
}
export function horseOwnerSystem() {
  return {
    sync: 'owner', // the local rider: mount state (from the shared rides), speed, the measured gallop (lance charge)
    update(game, dt) {
      const p = game.player, H = game.horses;
      if (!H) return;
      const nid = H.rides.get(ME(game)) || null;
      if (H.land) { // (the host's landing spot: off the horse, beside it)
        const L = H.land;
        H.land = null;
        if (!nid && !p.dead) { p.x = L[0]; p.y = L[1]; p.moving = false; p.lv = 0; p.z = 0; game.juice?.puff?.(p.x, p.y, 4, [0.6, 0.52, 0.42], 0.35); }
      }
      if (!nid) { if (p.mount) unmountLocal(game, p); return; }
      if (!p.mount || p.mount.nid !== nid) mountLocal(game, p, nid);
      const M = p.mount;
      if (p.dead) { if (!M.sent) { M.sent = true; game.net.request('horse.dismount', { nid, dead: 1 }); } return; }
      // the sprint's speed, constant: no stamina, the sprint key adds nothing
      p.speed = p.baseSpeed * HORSE.speedK;
      if (hasBuff(p, 'sprint')) removeBuff(p, 'sprint');
      p.swimming = false;
      // the measured gallop (smoothed): the lance charge's damage, the horse's frames
      if (dt > 0) {
        const vx = (p.x - M.px) / dt, vy = (p.y - M.py) / dt, k = Math.min(1, dt * 8), ok = Math.hypot(vx, vy) < 30;
        M.vx += ((ok ? vx : 0) - M.vx) * k; M.vy += ((ok ? vy : 0) - M.vy) * k;
        M.spd = Math.hypot(M.vx, M.vy);
      }
      M.px = p.x; M.py = p.y;
      // its horse gone from view for a while (a desync / it left the stream): off it
      const h = horseByNid(game, nid);
      if (!h || h.dead) { M.lost += dt; if (M.lost > 3 && !M.sent) { M.sent = true; game.net.request('horse.dismount', { nid, dead: 1 }); } } else M.lost = 0;
    },
  };
}

// ---------- every peer: riders and their horses drawn as one unit ----------
function pair(H, r, h) {
  const d = h._rd || (h._rd = { nid: h.nid, species: 'horse', x: h.x, y: h.y, moveT: 0, moving: false, facing: 'e', variant: 0, scale: 1, saddle: true, flash: 0, _seat: HORSE.seat });
  r._ride = h; r._rideD = d; h._riddenBy = r;
  H.paired.push(r, h);
}
export function horseSystem() {
  let tidyT = 0;
  return {
    sync: 'all', // pairs riders with their horses for drawing (cosmetic marks); host part: a dead horse throws its rider
    update(game, dt) {
      const H = game.horses, net = game.net;
      if (!H) return;
      for (const e of H.paired) { e._ride = null; e._rideD = null; e._riddenBy = null; e._rideH = 0; }
      H.paired.length = 0;
      const me = net.pid, myNid = H.rides.get(me);
      for (const h of game.entities) {
        if (h.species !== 'horse' || !h.isMob || h.dead) continue;
        const r = myNid && h.nid === myNid ? game.player : h.rider && h.rider !== me ? drawnPlayer(game, h.rider) : null;
        if (!r || r.dead || r.gone) continue;
        pair(H, r, h);
      }
      if (net.auth && (tidyT -= dt) <= 0) { tidyT = 0.25; hostTidy(game); }
    },
    // render time (after the interpolation of remote players): the horse's drawing state at its rider's drawn spot
    collect(game) {
      const P = game.horses?.paired;
      if (!P) return;
      for (let i = 0; i < P.length; i += 2) {
        const r = P[i], h = P[i + 1], d = r._rideD;
        if (!d) continue;
        d.x = r.x; d.y = r.y; d.moveT = r.moveT || 0; d.moving = !!r.moving; d.facing = r.facing;
        d.variant = h.variant | 0; d.scale = h.scale || 1; d.saddle = true; d.flash = h.flash || 0; d.nid = h.nid;
        d._seat = HORSE.seat * d.scale;
        r._rideH = d._seat + 0.1; // (nameplates go up with the rider)
      }
    },
  };
}

// ---------- interaction (controller.js nearestInteractable / a tap on the animal) ----------
// what the local player can do with a horse: wild → "Dar trigo"; tamed → "Montar" / "Selar" / "Amarrar"… (the second
// choice in `alt`: the HUD's second button / key, ui/hud.js)
export function describeHorse(game, m) {
  if (!m || m.dead) return null;
  const p = game.player, me = ME(game);
  if (p.mount) return null;
  const base = { o: m, horse: true, x: m.x, y: m.y, reach: HORSE.reach };
  if (isWildHorse(m)) {
    if (p.inv.count('wheat') < 1) return { ...base, kind: 'horse_feed', verb: 'Dar trigo (precisa de trigo)', icon: 'hand', prio: -1 };
    return { ...base, kind: 'horse_feed', verb: 'Dar trigo', icon: 'hand', prio: 3 };
  }
  if (!isHorse(m) || m.rider) return null;
  const tiedMe = m.tiedTo === me;
  if (m.tiedTo && !tiedMe) return null;
  const rope = tiedMe ? { ...base, kind: 'stock_untie', verb: 'Soltar cavalo', icon: 'hand', prio: 4, stockAnimal: true }
    : p.inv.count('rope') > 0 ? { ...base, kind: 'stock_tie', verb: 'Amarrar cavalo', icon: 'hand', prio: 2, stockAnimal: true } : null;
  if (m.saddle) return { ...base, kind: 'horse_mount', verb: 'Montar', icon: 'hand', prio: 5, alt: { ...base, kind: 'horse_unsaddle', verb: 'Tirar sela', icon: 'hand', prio: 4 } };
  if (p.inv.count('saddle') > 0) return { ...base, kind: 'horse_saddle', verb: 'Selar', icon: 'hand', prio: 5, alt: rope || undefined };
  if (rope) return rope;
  return { ...base, kind: 'horse_saddle', verb: 'Selar (precisa de sela)', icon: 'hand', prio: -1 };
}
export const dismountIt = (game) => ({ kind: 'horse_dismount', verb: 'Desmontar', icon: 'close', prio: 9, x: game.player.x, y: game.player.y, reach: 99, o: null, horse: true });

const errOf = (game, fallback) => (why) => game.events.emit('error', { text: why || fallback });
registerWork('horse_feed', {
  valid(g, it) { it.x = it.o.x; it.y = it.o.y; return !it.o.dead && isWildHorse(it.o); },
  start(game, it) {
    if (game.player.inv.count('wheat') < 1) { game.events.emit('error', { text: 'Você precisa de trigo' }); return null; }
    return { type: 'craft', cycle: 0.6, need: 1, label: 'Dando trigo' };
  },
  finish(game, wk) {
    const p = game.player, m = wk.it.o;
    if (m.dead || !isWildHorse(m) || !p.inv.remove('wheat', 1)) return true;
    game.events.emit('inventory', {});
    game.net.request('horse.feed', { nid: m.nid }, { refund: { wheat: 1 }, onReject: errOf(game, 'O cavalo não quis') });
    return true;
  },
});
registerWork('horse_saddle', {
  valid(g, it) { it.x = it.o.x; it.y = it.o.y; return !it.o.dead && isHorse(it.o) && !it.o.saddle; },
  start(game, it) {
    if (game.player.inv.count('saddle') < 1) { game.events.emit('error', { text: 'Precisa de uma sela (bancada: 5 couros, 2 madeiras, 2 cordas)' }); return null; }
    return { type: 'craft', cycle: 0.9, need: 1, label: 'Selando' };
  },
  finish(game, wk) {
    const p = game.player, m = wk.it.o;
    if (m.dead || m.saddle || !p.inv.remove('saddle', 1)) return true;
    game.events.emit('inventory', {});
    game.net.request('horse.saddle', { nid: m.nid }, { refund: { saddle: 1 }, onReject: errOf(game, 'Não deu para selar') });
    return true;
  },
});
registerWork('horse_unsaddle', {
  valid(g, it) { it.x = it.o.x; it.y = it.o.y; return !it.o.dead && isHorse(it.o) && !!it.o.saddle; },
  start: () => ({ type: 'craft', cycle: 0.7, need: 1, label: 'Tirando a sela' }),
  finish(game, wk) { game.net.request('horse.unsaddle', { nid: wk.it.o.nid }, { onReject: errOf(game, 'Não deu para tirar a sela') }); return true; },
});
registerWork('horse_mount', { valid: () => false, start(game, it) { mount(game, it.o); return null; }, finish: () => true });
registerWork('horse_dismount', { valid: () => false, start(game) { dismount(game); return null; }, finish: () => true });

// the local player asks to get on / off
export function mount(game, m) {
  const p = game.player;
  if (!m || m.dead || p.dead) return;
  if (game.boats?.mine?.()) { game.events.emit('error', { text: 'Saia do barco primeiro' }); return; }
  if (p.lv > 0 || p.z > 0.05) { game.events.emit('error', { text: 'Só no chão' }); return; }
  game.net.request('horse.mount', { nid: m.nid }, { onReject: errOf(game, 'Não deu para montar') });
}
export function dismount(game) {
  const p = game.player, nid = p.mount?.nid || game.horses?.rides.get(ME(game));
  if (!nid) return;
  game.net.request('horse.dismount', { nid }, { onReject: errOf(game, 'Não deu para descer') });
}

// ---------- the API (game.horses) ----------
export function installHorses(game) {
  game.horses = {
    rides: new Map(),  // pid → horse nid: who rides what (op horse.ride on every peer)
    land: null,        // [x, y] where the local player steps off (op horse.ride off)
    mountAt: null,     // [x, y] the horse's spot when the local player got on
    paired: [],        // riders and horses marked for drawing this frame
    move: (p, dx, dy) => rideMove(game, p, dx, dy),
    describe: (m) => describeHorse(game, m),
    dismountIt: () => dismountIt(game),
    follow: (m, dt) => rideFollow(game, m, dt),
    hurtRedirect: (target, src, amount, opts) => hurtRedirect(game, target, src, amount, opts),
    mounted: () => !!game.player.mount,
    // a loaded world (livestock.js restoreStock): the host back on the horse it rode when it saved (it stands there)
    remount: (m) => { const p = game.player; if (game.net.auth && !p.dead && !m.rider && Math.hypot(p.x - m.x, p.y - m.y) < 1.5) mountHorse(game, m, game.net.pid); },
    // tests / dev (host): a wild horse tamed at once, a tamed horse at (x, y) (saddled: o.saddle)
    debug: {
      tame: (m) => { tameHorse(game, m); return m; },
      spawn: (x, y, o = {}) => { const m = game.stock?.debug?.spawn('horse', x, y, { owned: true, variant: (o.coat | 0) << 2, ...o }); if (m) { m.tame = true; m.saddle = !!o.saddle; } return m; },
    },
  };
  return game.horses;
}
