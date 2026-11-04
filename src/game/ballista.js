// The ballista ("Balista", building 'ballista', 3D model in art/faces/solidDefense.js): a siege weapon against the ice
// giants. One operator at a time; the top turns slowly toward the aim; every shot is a heavy bolt from the operator's
// backpack (item ballista_bolt) that flies straight and far.
//
// Shared state (ops, mut/ballista.js): o.user (the operator's pid, or none), o.aim (world angle, radians) — in the
// snapshot / save (net/snapshot.js `ball` rows; a save drops the operator). Intents: ballista.use {id, on} (mount /
// leave; one operator: the host refuses a second one), ballista.aim {id, a} (the operator, ≤ AIM_HZ a second while it
// turns), ballista.fire {id, a} (the bolt is paid by the operator, refunded on a reject; the host checks the reload) →
// op ballista.shot (every peer flies the same bolt; the host's copy resolves the hits) → op ballista.end (where it stopped).
// Cosmetic per peer: o._aimD (the drawn angle: eased toward o.aim; the operator's own client draws its local angle at
// once), o._reload (string slack / no bolt on the rail until reloaded), bolts in flight (game.bolts).
//
// Controls (owner side, ballistaOwnerSystem + ui/ballistaUi.js):
//  - enter: the use button / E next to it, or a tap / click on it (describeStructure 'ballista' → useBallista); leave:
//    E / the use button again ("Sair", which takes the use button's place on phones). While on it the player stands
//    behind it and only turns it (no walking).
//  - desktop: the top turns smoothly and slowly (TURN rad/s, eased near the end) toward the mouse pointer; the attack
//    key / button (or a left click on the world) fires along where it points now.
//  - phones: the attack button works like the long shot: press and drag = a joystick that sets where it should point
//    (it still turns slowly), release fires as soon as it lines up (≤ 2.5 s), dragging back to the centre (or onto
//    "Cancelar") cancels; a quick tap fires straight ahead.
// Damage (host): a bolt pierces every creature in its way (each hit once) and stops in the first ice giant, a wall or
// rock (trunks and loose rocks do not stop it, like an aimed arrow); a giant takes GIANT_K of its max life (two bolts
// kill it), anything else at least its whole life (one bolt); never players (no friendly fire).
// Up a story (o.lv ≥ 1: on a wall-walk / an upper floor, docs/LEVELS.md): only someone standing at that story gets on;
// the operator stands behind it where there is floor (on a one-wall rampart: beside it, along the wall); the bolt
// leaves at that height and plunges (boltZ: level for the first tiles, then down a story every DESC tiles) — over the
// walls below while it is high, hitting what stands at the height it has (a giant is tall: hit from a rampart too).

import { BUILDINGS, SPECIES } from './data.js';
import { dealDamage, isMob } from './combat.js';
import { allPlayers } from './players.js';
import { facingFrom, collides } from './physics.js';
import { archSprite } from '../art/archCompose.js';
import { STORY_H } from './levels.js';

export const BALLISTA = {
  reload: 3.0,        // s between two shots of one ballista (host-checked)
  turn: 0.95,         // rad/s: the top's top turning speed (~54°/s), eased in the last ~15°
  range: 34,          // tiles a bolt flies
  speed: 30,          // tiles/s
  dmg: 600,           // the least a bolt does to anything (pure: no armour)
  giantK: 0.55,       // × a giant's max life per bolt: two bolts
  reach: 2.6,         // tiles: how close the operator must be to get on
  seat: 0.98,         // tiles behind the post where the operator stands
  h0: 0.64,           // tiles: the bolt's height (the rail)
  aimHz: 8,           // aim updates per second while turning
};
const STEP = 0.2;
const FLAT = 1.2, DESC = 4.5; // (up a story: the bolt flies level FLAT tiles, then drops a story every DESC tiles)
const GIANT_TALL = 3.4;      // stories an ice giant stands tall (a bolt at that height still hits it)

// ---------- helpers ----------
export const isBallista = (o) => !!o && o.building && o.type === 'ballista' && !o.removed;
export function ballistaOf(game, id) { const o = game.world.objById.get(id); return isBallista(o) ? o : null; }
const FACE_ANG = { s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2, e: 0 };
export const baseAngle = (o) => FACE_ANG[o.face || 's'] ?? Math.PI / 2;
export const aimOf = (o) => (Number.isFinite(o.aim) ? o.aim : baseAngle(o));
export const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
// the post (turning axis): the middle of the tile
export const pivotOf = (o) => [o.tx + 0.5, o.ty + 0.5];
// where the operator stands for an aim angle
export function seatOf(o, a) { const [x, y] = pivotOf(o); return [x - Math.cos(a) * BALLISTA.seat, y - Math.sin(a) * BALLISTA.seat]; }
// ...up a story: behind it if there is floor there, else the nearest standable spot around it (a one-wall rampart:
// beside it along the wall); null = nowhere (the operator stays where it is)
const AROUND = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8];
export function seatSpot(game, o, a, r = 0.24) {
  const lv = o.lv | 0, L = game.levels;
  if (!lv || !L) return seatOf(o, a);
  const [px, py] = pivotOf(o);
  for (const off of AROUND) for (const d of [BALLISTA.seat, 0.8]) {
    const b = a + Math.PI + off, x = px + Math.cos(b) * d, y = py + Math.sin(b) * d;
    if (!L.collidesL(lv, x, y, r, false, false, -1)) return [x, y];
  }
  return null;
}
// the story a bolt flies at, d tiles out of a ballista on story lv
export const boltZ = (lv, d) => (lv > 0 ? Math.max(0, lv - Math.max(0, d - FLAT) / DESC) : 0);
// does something stop a bolt at (x, y) flying at story z: rock at any height, the walls / doors of that story
export function boltStops(game, x, y, z) {
  const w = game.world, tx = Math.floor(x), ty = Math.floor(y);
  if (!w.inBounds(tx, ty)) return true;
  const i = w.idx(tx, ty);
  if (w.rock.get(i)) return true;
  const k = Math.floor(z + 1e-3);
  if (k <= 0) return w.solid.get(i) === 1 || w.solid.get(i) === 2;
  const o = game.build?.grid?.main?.get(i + k * w.W * w.H), def = o && !o.blueprint && !o.removed ? BUILDINGS[o.type] : null;
  return !!def && def.connect === 'wall' && (def.block === 'tile' || (def.block === 'door' && !o.open));
}
// is a creature at the bolt's height (stories): about its own story; a giant (ice / skeleton / mummy) over its whole height
export function boltReaches(e, z) {
  const ez = e.z || 0;
  return Math.abs(ez - z) < 0.75 || (SPECIES[e.species]?.giant && z >= ez - 0.25 && z < ez + GIANT_TALL);
}
// the muzzle (where a bolt leaves the rail)
export function muzzleOf(o, a) { const [x, y] = pivotOf(o); return [x + Math.cos(a) * 0.9, y + Math.sin(a) * 0.9]; }
export function ballistasNear(game, x, y, r) {
  const out = [];
  for (const o of game.build.structures) if (isBallista(o) && Math.abs(o.tx + 0.5 - x) < r && Math.abs(o.ty + 0.5 - y) < r) out.push(o);
  return out;
}
// the operator's entity (host: the local player or a remote avatar)
export function playerByPid(game, pid) {
  if (!pid) return null;
  for (const q of allPlayers(game)) if ((q === game.player ? game.net.pid : q.pid) === pid) return q;
  return null;
}
// the ballista the local player operates (or null)
export function myBallista(game) {
  const me = game.net.pid, B = game._myBal;
  if (B && isBallista(B) && B.user === me) return B;
  game._myBal = null;
  for (const o of game.build.structures) if (o.type === 'ballista' && o.user === me && isBallista(o)) { game._myBal = o; return o; }
  return null;
}

// interaction descriptor (building.js describeStructure)
export function ballistaIt(game, o) {
  const mine = o.user && o.user === game.net.pid;
  return { kind: 'ballista', verb: mine ? 'Sair' : 'Operar', icon: mine ? 'close' : 'shoot', prio: mine ? 9 : 3, use: true, reach: mine ? 3.5 : 1.6 };
}
// use it (building.js useStructure): get on, or off when on it
export function useBallista(game, o) {
  if (o.user && o.user === game.net.pid) { leaveBallista(game, o); return; }
  if (game.player.dead) return;
  game.net.request('ballista.use', { id: o.id, on: 1 }, {
    onOk: () => { if (!game.ctl?.hinted?.ballista) { if (game.ctl?.hinted) game.ctl.hinted.ballista = true; game.events.emit('toast', { text: game.input?.isTouch ? 'Balista: arraste o botão de ataque para mirar, solte para disparar · Sair no botão de usar' : 'Balista: mire com o mouse, Espaço ou clique dispara · E sai', kind: 'info' }); } },
    onReject: (why) => { if (why) game.events.emit('error', { text: why }); },
  });
}
export function leaveBallista(game, o = myBallista(game)) {
  if (!o) return;
  game.net.request('ballista.use', { id: o.id, on: 0 });
}

// ---------- bolts (every peer flies the same one; the host's copy resolves the hits) ----------
// b: { sid, x, y, x0, y0, ux, uy, d, by, auth, src, hit: Set, done, t, end }
export function spawnBolt(game, a, auth) {
  const L = game.bolts || (game.bolts = []);
  const ux = Math.cos(a.a), uy = Math.sin(a.a);
  const lv = Math.max(0, a.lv | 0); // (the ballista's story: the bolt leaves at that height)
  const b = { sid: a.sid, x: a.x, y: a.y, x0: a.x, y0: a.y, ux, uy, ang: a.a, d: 0, lv, z: lv, by: a.by, auth, src: auth ? playerByPid(game, a.by) : null, hit: new Set(), done: false, t: 0, endT: 0, stuck: false, end: null };
  L.push(b);
  if (L.length > 24) L.splice(0, L.length - 24);
  return b;
}
// the host's word on where a bolt stopped (guests snap their copy there)
export function boltEnd(game, sid, x, y, stuck) {
  const b = game.bolts?.find((q) => q.sid === sid);
  if (!b || b.auth) return;
  if (!b.done) { b.x = x; b.y = y; finish(game, b, stuck, true); } else if (b.stuck !== !!stuck || Math.hypot(b.x - x, b.y - y) > 0.4) { b.x = x; b.y = y; b.stuck = !!stuck; }
}
function finish(game, b, stuck, quiet = false) {
  b.done = true; b.stuck = !!stuck; b.endT = 0;
  game.events.emit('boltland', { x: b.x, y: b.y, stuck: b.stuck, ux: b.ux, uy: b.uy }); // (fx/giantfx.js: splinters, dust, sound)
  if (b.auth && !quiet && game.session) game.net.emit('ballista.end', { sid: b.sid, x: +b.x.toFixed(2), y: +b.y.toFixed(2), stuck: b.stuck ? 1 : 0 });
}
function stepBolt(game, b, dt) {
  let travel = BALLISTA.speed * dt;
  while (travel > 0 && !b.done) {
    const s = Math.min(STEP, travel);
    travel -= s;
    const nx = b.x + b.ux * s, ny = b.y + b.uy * s, nz = boltZ(b.lv, b.d + s);
    // walls / doors / rock stop it (trunks and loose rocks do not); up a story: the walls of the story it is at
    if (boltStops(game, nx, ny, nz)) { finish(game, b, true); break; }
    b.x = nx; b.y = ny; b.d += s; b.z = nz;
    // creatures in the way (at the height it flies)
    for (const e of game.entities) {
      if (!isMob(e) || e.dead || b.hit.has(e) || e.faction === 'friend' || e.npc || !boltReaches(e, nz)) continue; // (never the settlements' people)
      const rr = (e.r || 0.3) + 0.2, dx = e.x - nx, dy = e.y - ny;
      if (dx * dx + dy * dy > rr * rr) continue;
      b.hit.add(e);
      const giant = !!SPECIES[e.species]?.giant; // (ice / skeleton / mummy giants: game/undead.js)
      if (b.auth && !e.proxy) hitCreature(game, b, e, giant);
      if (giant) { b.x = e.x - b.ux * 0.15; b.y = e.y - b.uy * 0.15; finish(game, b, true); break; } // (stuck in the giant)
      game.juice?.chips?.(e.x, e.y, [0.85, 0.75, 0.55], 4, 0.5);
    }
    if (!b.done && b.d >= BALLISTA.range) finish(game, b, false);
  }
}
function hitCreature(game, b, e, giant) {
  const amount = giant ? Math.ceil(e.maxHp * BALLISTA.giantK) : Math.max(BALLISTA.dmg, Math.ceil(e.maxHp * 1.01));
  const src = b.src && !b.src.dead ? b.src : (b.src || null);
  dealDamage(game, src || e, e, amount, { pure: true, ranged: true, ability: 'ballista', from: { x: b.x0, y: b.y0 }, knock: e.heavy ? 0.5 : 1.4, crit: true });
}

// ---------- systems ----------
// every peer: bolts in flight, the drawn angle easing toward the shared aim, the reload timer; host: operators gone
// (left, dead, too far) are taken off
export function ballistaSystem() {
  let slowT = 0;
  return {
    sync: 'all',
    update(game, dt) {
      const L = game.bolts;
      if (L && L.length) for (let i = L.length - 1; i >= 0; i--) {
        const b = L[i];
        b.t += dt;
        if (!b.done) stepBolt(game, b, dt);
        else if ((b.endT += dt) > (b.stuck ? 4 : 0.6)) L.splice(i, 1);
      }
      const mine = myBallista(game);
      const v = game.view?.() || null;
      // who operates what (cosmetic, every peer): the operator's drawn body faces the aim and holds the grips
      // (art/facing.js, art/compose.js read _opA)
      const OPS = game._opEnts || (game._opEnts = []);
      for (const e of OPS) e._opA = null;
      OPS.length = 0;
      for (const o of game.build.structures) {
        if (o.type !== 'ballista' || o.removed) continue;
        if (o.user) {
          const e = o.user === game.net.pid ? game.player : game.session?.players?.get(o.user)?.ent;
          if (e && !e.dead) { e._opA = Number.isFinite(o._aimD) ? o._aimD : aimOf(o); OPS.push(e); }
        }
        if (o._reload > 0) o._reload = Math.max(0, o._reload - dt);
        if (o.shake > 0) o.shake = Math.max(0, o.shake - dt * 3); // (the kick of a shot)
        if (o === mine) continue; // (the operator draws its own angle: ballistaOwnerSystem)
        if (v && (o.x < v.x0 - 4 || o.x > v.x1 + 4 || o.y < v.y0 - 4 || o.y > v.y1 + 6)) { o._aimD = aimOf(o); continue; }
        const want = aimOf(o);
        if (o._aimD == null) o._aimD = want;
        else { const d = angDiff(want, o._aimD); o._aimD = Math.abs(d) < 1e-3 ? want : o._aimD + d * Math.min(1, dt * 9); }
      }
      if (!game.net.auth) return;
      slowT -= dt;
      if (slowT > 0) return;
      slowT = 0.5;
      for (const o of game.build.structures) {
        if (o.type !== 'ballista' || !o.user) continue;
        const q = playerByPid(game, o.user), [px, py] = pivotOf(o);
        // (gone, dead, walked off, or not at its story any more: fell off the rampart)
        if (o.removed || o.blueprint || !q || q.dead || Math.hypot(q.x - px, q.y - py) > BALLISTA.reach + 1.5 || Math.abs((q.z || 0) - (o.lv | 0)) > 0.75) game.net.emit('ballista.set', { id: o.id, user: 0 });
      }
    },
    collect(game, list, v) {
      const L = game.bolts;
      if (!L || !L.length) return;
      const pool = game._boltPool || (game._boltPool = []);
      let n = 0;
      for (const b of L) {
        if (b.x < v.x0 - 2 || b.x > v.x1 + 2 || b.y < v.y0 - 2 || b.y > v.y1 + 3) continue;
        const d = pool[n] || (pool[n] = { type: 'fx_bolt', x: 0, y: 0, b: null, draw(B, A) { drawBolt(game, B, A, this.b); }, zkRot(rc, rs) { return -rs * this.b.x + rc * this.b.y + 0.08; } });
        d.b = b; d.x = b.x; d.y = b.y + 0.08; n++;
        list.push(d);
      }
    },
  };
}

// a bolt: the shaft along its flight (screen angle = world angle − yaw), a streak behind it while flying, its shadow
function drawBolt(game, B, A, b) {
  const [vx, vy] = game.toViewDir(b.ux, b.uy), rot = Math.atan2(vy, vx); // (screen direction: the world one turned into the view)
  const a = b.done ? Math.max(0, 1 - Math.max(0, b.endT - (b.stuck ? 3.4 : 0)) / 0.6) : 1;
  if (a <= 0) return;
  const lift = (b.done ? (b.stuck ? BALLISTA.h0 * 0.8 : 0.05) : BALLISTA.h0) + (b.z || 0) * STORY_H; // (up a story: its height)
  const S = archSprite(A, 'proj_ballista_bolt'); // (lazy art: null until painted)
  const soft = A.has('fx_soft') ? A.get('fx_soft') : null, blob = A.has('fx_blob') ? A.get('fx_blob') : null;
  if (!b.done && soft) {
    // the streak: a long soft trail behind the bolt (wind-torn air)
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const k = i / n, d = Math.min(b.d, 2.6) * k;
      B.fx.add(soft, b.x - b.ux * d, b.y - b.uy * d, (0.5 - 0.28 * k) / soft.w, (0.16 - 0.1 * k) / soft.h, 1, 0.96, 0.88, 0.42 * (1 - k), 0, rot, 0, 1, 0, lift);
    }
  }
  if (blob) B.blob.add(blob, b.x, b.y, 1.0 / blob.w, 0.16 / blob.h, 1, 1, 1, 0.5 * a, 0, rot);
  if (S) B.main.add(S, b.x, b.y, 1.15, 1.15, 1, 1, 1, a, 0, rot, 0, 1, 0, lift);
  else if (soft) B.main.add(soft, b.x, b.y, 1.2 / soft.w, 0.1 / soft.h, 0.45, 0.32, 0.18, a, 0, rot, 0, 1, 0, lift);
}

// the local operator: rooted at the seat, turning the top toward the aim, sending the aim / shots
export function ballistaOwnerSystem() {
  return {
    sync: 'owner',
    update(game, dt) {
      const C = ballistaCtl(game);
      const o = myBallista(game), p = game.player;
      C.o = o;
      if (!o) { if (C.was) { C.was = false; C.pending = null; C.stickOn = false; game.events.emit('ballista', { on: false }); } return; }
      if (!C.was) {
        C.was = true; C.aimL = Number.isFinite(o._aimD) ? o._aimD : aimOf(o); C.want = C.aimL; C.sent = C.aimL; C.sentT = 0; C.cd = 0;
        p.autoAttack = false; game.ctl?.setTarget?.(null);
        if (game.ctl) game.ctl.goal = null;
        game.events.emit('ballista', { on: true, o });
      }
      if (p.dead) { leaveBallista(game, o); return; }
      p.rooted = true; // (no walking while on it: abilities.js resets it every frame before this runs)
      if (p.work) { p.work = null; p.action = null; }
      // where it should point: the mouse (desktop), the stick (phones); else it stays
      const want = C.wantAngle();
      if (want != null) C.want = want;
      const d = angDiff(C.want, C.aimL), rate = Math.min(BALLISTA.turn, Math.max(0.12, Math.abs(d) * 3.4));
      const step = Math.min(Math.abs(d), rate * dt);
      C.aimL += Math.sign(d) * step;
      C.turning = Math.abs(d) > 0.004;
      o._aimD = C.aimL;
      // the shared aim: a few times a second while it turns, and the final angle when it stops
      C.sentT -= dt;
      if (Math.abs(angDiff(C.aimL, C.sent)) > 0.005 && (C.sentT <= 0 || !C.turning)) {
        C.sent = C.aimL; C.sentT = 1 / BALLISTA.aimHz;
        game.net.request('ballista.aim', { id: o.id, a: +C.aimL.toFixed(4) });
      }
      // stand behind it, facing where it points (up a story: where there is floor, art/levels collisions)
      const pr = p.r || 0.24, lv = o.lv | 0, L = lv ? game.levels : null;
      const seat = seatSpot(game, o, C.aimL, pr);
      const ds = seat ? Math.hypot(seat[0] - p.x, seat[1] - p.y) : 0;
      if (ds > 0.002) {
        // (a step at a time while it turns; from the far side of it — got on from the front — straight to the seat)
        const [sx, sy] = seat, k = ds > 0.5 ? 1 : Math.min(1, dt * 12), nx = p.x + (sx - p.x) * k, ny = p.y + (sy - p.y) * k;
        const blocked = (x, y) => (L ? L.collidesL(lv, x, y, pr, false, false, -1) : collides(game.world, x, y, pr, null, false));
        if (!blocked(nx, ny)) { p.x = nx; p.y = ny; }
        else if (!blocked(sx, sy)) { p.x = sx; p.y = sy; }
      }
      p.facing = facingFrom(Math.cos(C.aimL), Math.sin(C.aimL), p.facing);
      p._faceLockT = Math.max(p._faceLockT || 0, 0.1);
      p.swingT = Math.max(p.swingT || 0, 0.2); // (no auto attack while on it)
      // a touch shot waiting until the top lines up
      C.cd = Math.max(0, C.cd - dt);
      const P = C.pending;
      if (P) {
        P.t += dt;
        if (Math.abs(angDiff(C.want, C.aimL)) < 0.03 || P.t > 2.5) { C.pending = null; C.fire(); }
      }
    },
  };
}

// the local controls of the ballista (game.ballista; the HUD adds the touch stick: ui/ballistaUi.js)
export function ballistaCtl(game) { return game.ballista || (game.ballista = makeCtl(game)); }
function makeCtl(game) {
  const C = {
    o: null, was: false, aimL: 0, want: 0, sent: 0, sentT: 0, cd: 0, turning: false, pending: null, stickOn: false, stickAng: null, mouse: null,
    get mounted() { return !!C.o; },
    // the angle the input asks for now (null = keep)
    wantAngle() {
      const o = C.o, p = game.player;
      if (!o) return null;
      if (C.stickOn) return C.stickAng;
      const m = game.ctl?.mouse;
      if (m && !game.input?.isTouch) {
        const [wx, wy] = game.screenToWorld(m.x, m.y), [px, py] = pivotOf(o);
        if (Math.hypot(wx - px, wy - py) > 0.6) return Math.atan2(wy - py, wx - px);
      }
      void p;
      return null;
    },
    // fire along where it points now
    fire() {
      const o = C.o, p = game.player;
      if (!o || p.dead) return false;
      if (C.cd > 0 || o._reload > 0) { if (!C._rT || game.time - C._rT > 0.8) { C._rT = game.time; game.events.emit('error', { text: 'Recarregando a balista…' }); } return false; }
      if (p.inv.count('ballista_bolt') < 1) { game.events.emit('error', { text: 'Sem flechas de balista (bigorna: 1 barra de ferro + 2 madeiras = 2 flechas)' }); return false; }
      p.inv.remove('ballista_bolt', 1);
      game.events.emit('inv', {});
      C.cd = BALLISTA.reload;
      game.net.request('ballista.fire', { id: o.id, a: +C.aimL.toFixed(4) }, {
        refund: { ballista_bolt: 1 },
        onReject: (why) => { C.cd = 0; if (why) game.events.emit('error', { text: why }); },
      });
      return true;
    },
    // the attack key / button while on it (true = handled)
    onAttack() { if (!C.o) return false; C.pending = null; C.fire(); return true; },
    // a click on the world while on it (desktop): fire
    onTap(tap) { if (!C.o) return false; if (tap?.mouse) { C.pending = null; C.fire(); } return true; },
    // E / the use button while on it: get off
    onInteract() { if (!C.o) return false; leaveBallista(game, C.o); return true; },
    queueFire() { if (!C.o) return; C.pending = { t: 0 }; },
  };
  return C;
}

// the angle of a ballista for a new structure (its facing) — tests / debug
export function ballistaDebug(o) { return { user: o.user || null, aim: aimOf(o), drawn: o._aimD ?? null, reload: o._reload || 0, def: !!BUILDINGS.ballista }; }
