// Boats (barco, docs/PLAN-V2.md "Barco"): a rowboat for up to 4 players and their tied animals. Built like a structure
// (BUILDINGS.boat on a water tile next to the bank or a pier); when the work ends the host launches it (op boat.launch):
// the blueprint goes away and a boat floats in game.boats — not a structure: it moves.
//
// Shared state (game.boats.map: id → boat; ops in mut/boats.js; snapshot / save `boats` rows; digest part `boats`):
//   x, y (hull centre), h (heading: the world angle the bow points to), vx, vy (last reported velocity), v (variant),
//   at (launch worldTime), seats [pid|0 × 6] (players by place; place 0 = the oars: the driver), pets [[nid, pid, place]]
//   (animals aboard, by leader and place). 6 places shared by players and animals (content/boats.js BOAT.places).
// Rowing: the driver's client simulates the boat (the movement input relative to the camera, as walking; it speeds up,
// glides, turns toward the input, stops at the bank / piers / other boats, passes under bridges) and reports it
// (intent boat.move, ≤ BOAT.hz a second); the host checks the driver, the speed and the water under the hull → op
// boat.pos (a refused move comes back as boat.pos with fix: the driver snaps to it). Every other peer draws the shared
// pose through a short interpolation buffer (cosmetic b._x / _y / _h).
// Riders: every peer puts each seated player (local or remote copy) and each animal aboard on its spot of the drawn
// boat (sitting / standing, lifted by e._dh, marked e._boat): no swimming, no wet, no wading rings; the animals'
// brains rest while they ride (mobs.js). Getting off (intent boat.leave): the host picks a landing spot next to the
// hull (land, a pier, shallow water; never deep water — refused far from the bank; frozen water is ice: anywhere) →
// op boat.set {off} (the leaver's own client moves there); its animals get off with it; a driver that leaves hands
// the oars to the next passenger. Winter: frozen water holds the boat (it does not move).
// Cosmetic per peer: the drawn pose, bobbing and rocking, the oars' stroke (from the drawn speed), the wake.

import { BOAT, halfW, hullPt, inHull, hullNear, hullFree, launchPose, roomOf } from './content/boats.js';
import { collides, facingFrom } from './physics.js';
import { registerWork } from './gathering.js';
import { allPlayers } from './players.js';
import { drawBoat } from '../art/faces/solidBoat.js';
import { cleanLook, DEFAULT_LOOK } from './look.js'; // (dev stand-in riders)

export { BOAT, hullFree, launchPose } from './content/boats.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const DELAY = 0.15; // s: remote boats are drawn this far in the past (interpolation buffer)
const hasRod = (p) => p.inv?.count?.('rod_wood') > 0 || p.equip?.main === 'rod_wood';
const hashOf = (s) => { let h = 7; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 1000) / 1000; };

// ---------- the boats of a world ----------
export class Boats {
  constructor(game) {
    this.game = game;
    this.map = new Map();     // id → boat
    this.v = 0;               // bumps when the set / riders change
    this.land = null;         // [x, y] where the local player steps off (op boat.set off) — applied by the owner system
    this.ctl = { b: null, x: 0, y: 0, h: 0, vx: 0, vy: 0, w: 0, sendT: 0, sx: NaN, sy: 0, sh: 0, k: -1, on: false, rowing: false, iceT: 0, deadSent: false, ia: 0 };
    this.fx = [];             // wake / ripples (cosmetic)
    this.nids = new Map();    // host: nid → creature (refreshed while animals ride)
    this.marked = new Set();  // entities marked _boat
    this.extra = null;        // dev: stand-in riders (pid → pawn entity) for screenshots
  }

  // ---- shared state (op appliers in mut/boats.js only) ----
  add(r) {
    const [id, x, y, h, v, at] = r;
    if (typeof id !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    let b = this.map.get(id);
    if (!b) {
      b = { id, x, y, h: Number.isFinite(h) ? h : 0, vx: 0, vy: 0, v: v | 0, at: at || 0, seats: [0, 0, 0, 0, 0, 0], pets: [], _x: x, _y: y, _h: h || 0, _buf: null, _ph: hashOf(id) * 6.28 };
      this.map.set(id, b);
    }
    b.x = x; b.y = y; b.h = Number.isFinite(h) ? h : b.h; b.v = v | 0; b.at = at || 0;
    this.v++;
    return b;
  }
  remove(id) {
    const b = this.map.get(id);
    if (!b) return;
    this.map.delete(id);
    b.removed = true; // sync-ok: called only by the boat.remove applier (mut/boats.js) and the snapshot
    this.v++;
  }
  // riders / animals (sanitised); off: [[pid, x, y]] players stepping off
  setRiders(b, seats, pets, off) {
    if (Array.isArray(seats)) for (let k = 0; k < BOAT.room; k++) { const s = seats[k]; b.seats[k] = typeof s === 'string' && s ? s.slice(0, 40) : 0; }
    if (Array.isArray(pets)) b.pets = pets.filter((q) => Array.isArray(q) && typeof q[0] === 'string').slice(0, BOAT.room).map((q) => [q[0].slice(0, 24), typeof q[1] === 'string' ? q[1].slice(0, 40) : 0, Math.max(1, Math.min(BOAT.room - 1, q[2] | 0))]);
    if (Array.isArray(off)) for (const q of off) if (Array.isArray(q) && q[0] === this.game.net.pid && Number.isFinite(q[1]) && Number.isFinite(q[2])) this.land = [q[1], q[2]];
    this.v++;
  }
  setPos(b, a) {
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    b.x = num(a.x, b.x); b.y = num(a.y, b.y); b.h = num(a.h, b.h); b.vx = num(a.vx, 0); b.vy = num(a.vy, 0);
    if (a.fix && a.fix === this.game.net.pid && this.ctl.b === b) { const C = this.ctl; C.x = b.x; C.y = b.y; C.h = b.h; C.vx = C.vy = C.w = 0; C.sx = NaN; }
  }

  // ---- queries ----
  seatOf(b, pid) { return pid ? b.seats.indexOf(pid) : -1; }
  boatOf(pid) { for (const b of this.map.values()) if (b.seats.includes(pid)) return b; return null; }
  mine() { return this.boatOf(this.game.net.pid); }
  riderEnt(pid) {
    const g = this.game;
    if (!pid) return null;
    if (pid === g.net.pid) return g.player;
    return g.session?.players?.get?.(pid)?.ent || this.extra?.get(pid) || null;
  }
  petEnt(nid) {
    const g = this.game;
    return g.net.auth ? this.nids.get(nid) || null : g.net.entsApi?.byNid?.(nid) || null;
  }
  // host: an animal / player by nid / pid on the authority (its creatures, the avatars)
  hostPlayer(pid) {
    for (const q of allPlayers(this.game)) if ((q === this.game.player ? this.game.net.pid : q.pid) === pid) return q;
    return this.extra?.get(pid) || null;
  }
  refreshNids() {
    const M = this.nids;
    M.clear();
    let any = false;
    for (const b of this.map.values()) if (b.pets.length) { any = true; break; }
    if (!any) return;
    for (const e of this.game.entities) if (e.nid && e.isMob) M.set(e.nid, e);
  }
  // world point and lift of seat k / an animal bay spot in the drawn boat, with its bobbing: [x, y, dh]
  spot(b, u, s, base) {
    const k = b._bob || NOBOB;
    const [x, y] = hullPt(b._x, b._y, b._h, u, s);
    return [x, y, base + k.base + k.roll * s + k.pitch * u];
  }
  // placing a boat blueprint (mut/structures.js placeReason: the preview and the host): null = ok, 'exists', or why not
  reason(tx, ty, who, lv = 0) {
    const g = this.game, w = g.world, G = g.build.grid;
    if (lv > 0) return 'Só no térreo (na água)';
    if (!w.inside(tx, ty, 2)) return 'Fora do mapa';
    const i = w.idx(tx, ty);
    if (G.main.get(i)?.type === 'boat') return 'exists';
    if (!w.water.get(i) || w.rock.get(i)) return 'O barco vai na água, encostado na margem ou num trapiche';
    if (G.deck.has(i)) return 'Trapiche ou ponte no caminho';
    if (G.main.has(i) || w.solid.get(i)) return 'Algo no caminho';
    let side = false;
    for (let dy = -1; dy <= 1 && !side; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if ((!dx && !dy) || !w.inBounds(x, y)) continue;
      const j = w.idx(x, y);
      if ((!w.water.get(j) && !w.rock.get(j)) || G.deck.has(j)) { side = true; break; }
    }
    if (!side) return 'Encoste na margem ou num trapiche';
    for (const b of this.map.values()) if (Math.hypot(b.x - tx - 0.5, b.y - ty - 0.5) < 2.6) return 'Já tem um barco aqui';
    for (const o of g.build.structures) if (o.type === 'boat' && Math.abs(o.tx - tx) + Math.abs(o.ty - ty) < 4) return 'Já tem um barco planejado aqui';
    if (!launchPose(g, tx, ty)) return 'Pouca água para o barco (ele tem 4 tiles de comprimento)';
    if (who && Math.hypot(tx + 0.5 - who.x, ty + 0.5 - who.y) > 22) return 'Muito longe';
    return null;
  }
  // host: the launch of a finished boat blueprint → op args (boat.launch)
  launchArgs(o, by, extra = {}) { return launchArgs(this.game, o, by, extra); }

  // where the animals stand: single file down the middle, across the hull, each taking the room of its species
  // (content/boats.js roomOf), in the stretches no seated player takes, the biggest nearest the widest part; the same
  // on every peer (shared seats / pets + species) -> [[u, s, across, side]] in b.pets order
  layout(b) {
    let key = '';
    for (const q of b.seats) key += q ? '1' : '0';
    const ents = b.pets.map((q) => this.petEnt(q[0]));
    for (const m of ents) key += '|' + (m ? m.species + ((m.variant | 0) & 2 ? 'y' : '') : '?');
    if (b._layK === key && b._lay) return b._lay;
    const occ = [];
    for (let k = 0; k < BOAT.room; k++) if (b.seats[k]) { const u = BOAT.places[k][0]; occ.push(u - 0.27, u + 0.27); }
    const R = ents.map((m) => roomOf(m)), order = ents.map((m, i) => i).sort((i, j) => R[j][0] - R[i][0] || i - j);
    const out = new Array(ents.length);
    let n = 0;
    for (const i of order) {
      const [t, len] = R[i];
      let at = null;
      for (const u of LAY_U) {
        if (u - t / 2 < LAY_LO || u + t / 2 > LAY_HI || 2 * halfW(u) * 1.1 < len) continue;
        let free = true;
        for (let k = 0; k < occ.length && free; k += 2) if (u + t / 2 + 0.02 > occ[k] && u - t / 2 - 0.02 < occ[k + 1]) free = false;
        if (free) { at = u; break; }
      }
      if (at == null) { const p = BOAT.places[b.pets[i][2]] || BOAT.places[1]; out[i] = [p[0], p[1] * 0.7, false, 1]; continue; } // (no room left: its place)
      occ.push(at - t / 2, at + t / 2);
      out[i] = [at, 0, true, n++ % 2 ? -1 : 1];
    }
    b._layK = key; b._lay = out;
    return out;
  }

  // places taken (players and animals) / players aboard / the first free place for a player or an animal (-1: none)
  used(b) { let n = 0; for (const q of b.seats) if (q) n++; return n + b.pets.length; }
  players(b) { let n = 0; for (const q of b.seats) if (q) n++; return n; }
  freePlace(b, animal, taken = null) {
    for (const k of animal ? BOAT.animalOrder : BOAT.playerOrder) if (!b.seats[k] && !b.pets.some((q) => q[2] === k) && !(taken && taken.has(k))) return k;
    return -1;
  }

  // where a rider of boat b at (fx, fy) steps off: land / a pier / shallow water next to the hull, toward the bow first;
  // never deep water (frozen water: ice, anywhere) — null when the bank is too far
  landingSpot(b, fx, fy, r = 0.26) {
    const w = this.game.world;
    let best = null, bs = 1e9;
    const consider = (u, s) => {
      const [x, y] = hullPt(b.x, b.y, b.h, u, s), tx = Math.floor(x), ty = Math.floor(y);
      if (!w.inBounds(tx, ty) || w.liquidAt(tx, ty) === 2 || collides(w, x, y, r, null, true, false)) return;
      for (const o of this.map.values()) if (inHull(o.x, o.y, o.h, x, y, 0.15)) return;
      const i = w.idx(tx, ty), wet = w.water.get(i) && !(w.deck && w.deck.get(i)) && !w.frozen;
      const sc = Math.hypot(x - fx, y - fy) + (wet ? 0.7 : 0) - 0.3 * (u / 1.5);
      if (sc < bs) { bs = sc; best = [r2(x), r2(y)]; }
    };
    for (let u = -1.7; u <= 1.95; u += 0.25) {
      const hw = halfW(Math.max(BOAT.stern, Math.min(BOAT.bow, u)));
      for (const d of [0.42, 0.75, 1.1, 1.5]) { consider(u, hw + d); consider(u, -(hw + d)); }
    }
    for (const d of [0.5, 0.9, 1.3, 1.7]) { consider(BOAT.bow + d, 0); consider(BOAT.stern - d, 0); }
    return best;
  }
  // a free spot for an animal near (x, y) (getting off with its leader)
  nearSpot(x, y, r = 0.32, k0 = 0) {
    const w = this.game.world;
    for (let k = k0; k < k0 + 60; k++) {
      const a = k * 2.4, d = 0.55 + k * 0.07, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, tx = Math.floor(px), ty = Math.floor(py);
      if (!w.inBounds(tx, ty) || w.liquidAt(tx, ty) === 2 || collides(w, px, py, r, null, false, false)) continue;
      let inside = false;
      for (const o of this.map.values()) if (inHull(o.x, o.y, o.h, px, py, 0.1)) { inside = true; break; }
      if (!inside) return [r2(px), r2(py)];
    }
    return null;
  }

  // ---- player side ----
  board(b) {
    const g = this.game, p = g.player;
    if (p.dead || !b || b.removed) return;
    g.net.request('boat.board', { id: b.id }, {
      onOk: () => {
        const h = g.ctl?.hinted, k = b.seats.indexOf(g.net.pid), touch = g.input?.isTouch;
        if (!h || h.boat) return;
        h.boat = true;
        g.events.emit('toast', { text: k === 0 ? (touch ? 'Barco: o direcional rema · Sair no botão de usar, perto da margem' : 'Barco: WASD rema · E sai perto da margem') : 'No barco: quem está nos remos conduz · sai perto da margem', kind: 'info' });
      },
      onReject: (why) => { if (why) g.events.emit('error', { text: why }); },
    });
  }
  leave(far = false) {
    const g = this.game, b = this.mine();
    if (!b) return;
    if (far) { g.events.emit('error', { text: 'Longe da margem: reme até a terra (ou um trapiche)' }); return; }
    if (b.seats[0] === g.net.pid) this.sendMove(b, true); // (the last of the rowing first: same ordered channel)
    g.net.request('boat.leave', { id: b.id }, { onReject: (why) => { if (why) g.events.emit('error', { text: why }); } });
  }
  sendMove(b, force = false) {
    const C = this.ctl, g = this.game;
    if (C.b !== b) return;
    if (!force && Math.abs(C.x - C.sx) < 0.004 && Math.abs(C.y - C.sy) < 0.004 && Math.abs(angDiff(C.h, C.sh)) < 0.003) return;
    C.sx = C.x; C.sy = C.y; C.sh = C.h;
    g.net.request('boat.move', { id: b.id, x: r3(C.x), y: r3(C.y), h: r3(Math.atan2(Math.sin(C.h), Math.cos(C.h))), vx: r2(C.vx), vy: r2(C.vy) });
  }

  // ---- interaction (controller.js: nearestInteractable / pick) ----
  forNear(consider) {
    const g = this.game, p = g.player;
    if (p.dead || !this.map.size) return;
    const mine = this.mine();
    if (mine) { consider(this.leaveIt(mine)); return; }
    for (const b of this.map.values()) {
      if (Math.abs(b._x - p.x) > 4 || Math.abs(b._y - p.y) > 4) continue;
      consider(this.boardIt(b));
    }
  }
  boardIt(b) {
    const p = this.game.player, [nx, ny] = hullNear(b._x, b._y, b._h, p.x, p.y);
    const full = this.used(b) >= BOAT.room || this.players(b) >= BOAT.players;
    return { kind: 'boat_board', verb: full ? 'Barco cheio' : 'Embarcar', icon: 'hand', prio: full ? 0 : 3, x: nx, y: ny, reach: BOAT.reach, o: b, boat: true };
  }
  leaveIt(b) {
    const g = this.game, p = g.player, C = this.ctl;
    if (C.ltT == null || g.time - C.ltT > 0.3 || C.ltB !== b) { C.ltT = g.time; C.ltB = b; C.lt = this.landingSpot(b, p.x, p.y); }
    if (C.lt) return { kind: 'boat_leave', verb: 'Sair do barco', icon: 'close', prio: 5, x: p.x, y: p.y, reach: 99, o: b, boat: true };
    if (hasRod(p)) return null; // (far from the bank with a rod: the use button fishes)
    return { kind: 'boat_leave', verb: 'Longe da margem', icon: 'close', prio: 0, x: p.x, y: p.y, reach: 99, o: b, boat: true, far: true };
  }
  // a tap / click on a boat (controller pick): its descriptor
  pickAt(wx, wy, tol) {
    const g = this.game;
    if (!this.map.size) return null;
    const [ux, uy] = g.toWorldDir(0, 1); // (down the screen: a point of the hull up to its gunwale shows higher)
    for (const b of this.map.values()) {
      if (Math.abs(b._x - wx) > 3 || Math.abs(b._y - wy) > 3.5) continue;
      for (let k = 0; k <= 4; k++) {
        const hh = (0.42 * k) / 4;
        if (!inHull(b._x, b._y, b._h, wx + ux * hh, wy + uy * hh, tol * 0.6)) continue;
        return this.boatOf(g.net.pid) === b ? this.leaveIt(b) : this.boardIt(b);
      }
    }
    return null;
  }
  // build menu "Desmontar" mode: a tap on an empty boat takes it apart (a second tap confirms)
  deconAt(wx, wy) {
    const g = this.game;
    let hit = null;
    for (const b of this.map.values()) if (inHull(b._x, b._y, b._h, wx, wy, 0.2)) { hit = b; break; }
    if (!hit) return false;
    if (hit.seats.some(Boolean)) { g.events.emit('error', { text: 'Tem gente no barco' }); return true; }
    const C = this.ctl;
    if (C.dcId !== hit.id || g.time - C.dcT > 4) { C.dcId = hit.id; C.dcT = g.time; g.events.emit('toast', { text: 'Toque de novo para desmontar o barco (devolve 75% do material)', kind: 'warn' }); return true; }
    C.dcId = null;
    g.net.request('boat.decon', { id: hit.id }, { onReject: (why) => { if (why) g.events.emit('error', { text: why }); } });
    return true;
  }
}
const NOBOB = { base: 0, roll: 0, pitch: 0 };

registerWork('boat_board', { valid: () => false, start(game, it) { game.boats?.board(it.o); return null; }, finish: () => true });
registerWork('boat_leave', { valid: () => false, start(game, it) { game.boats?.leave(!!it.far); return null; }, finish: () => true });

export function installBoats(game) {
  const B = (game.boats = new Boats(game));
  B.ashoreT = 0.3; // (after the save loads)
  game.events?.on?.('worldreset', () => { B.ashoreT = 0.3; }); // (a join / resync snapshot)
  return B;
}

// ---------- the drawn pose ----------
// remote boats: the shared pose through a short buffer (arrival times smoothed to the report rate), extrapolated a
// little when it runs dry; a jump > 4 tiles snaps
function track(b, now) {
  const L = b._buf || (b._buf = []);
  const last = L[L.length - 1];
  if (!last || last.x !== b.x || last.y !== b.y || last.h !== b.h) {
    if (last && Math.hypot(b.x - last.x, b.y - last.y) > 4) L.length = 0;
    const prev = L[L.length - 1];
    if (prev && now - prev.t > 0.35) L.push({ t: now - 0.1, x: prev.x, y: prev.y, h: prev.h, vx: 0, vy: 0 }); // (after a pause: from rest)
    const t = prev ? Math.min(now + 0.1, Math.max(now, L[L.length - 1].t + 0.07)) : now;
    L.push({ t, x: b.x, y: b.y, h: b.h, vx: b.vx || 0, vy: b.vy || 0 });
    if (L.length > 16) L.splice(0, L.length - 16);
  }
  const rt = now - DELAY;
  let a = L[0], c = L[L.length - 1];
  if (L.length === 1 || rt <= a.t) { b._x = a.x; b._y = a.y; b._h = a.h; return; }
  if (rt >= c.t) {
    const ex = Math.min(0.2, rt - c.t), mv = Math.hypot(c.vx, c.vy) > 0.05 ? 1 : 0;
    b._x = c.x + c.vx * ex * mv; b._y = c.y + c.vy * ex * mv; b._h = c.h;
    return;
  }
  for (let i = L.length - 1; i > 0; i--) if (L[i - 1].t <= rt) { a = L[i - 1]; c = L[i]; break; }
  const k = (rt - a.t) / Math.max(1e-3, c.t - a.t);
  b._x = a.x + (c.x - a.x) * k; b._y = a.y + (c.y - a.y) * k; b._h = a.h + angDiff(c.h, a.h) * k;
}

// bobbing / rocking (cosmetic, the same clock for the hull and whoever rides it)
function bob(b, t, dt) {
  const k = b._bob || (b._bob = { base: 0, roll: 0, pitch: 0 });
  const ph = b._ph || 0, sp = b._spd || 0;
  k.base = 0.016 * Math.sin(t * 1.55 + ph) + 0.008 * Math.sin(t * 2.7 + ph * 2);
  k.roll = 0.03 * Math.sin(t * 1.1 + ph * 3) + (b._turn || 0) * 0.025;
  k.pitch = 0.016 * Math.sin(t * 0.85 + ph) - Math.min(0.025, sp * 0.008) + (b._surge || 0) * 0.01;
  void dt;
}

// ---------- cosmetic: oars pulled in where they would go through a bank / a pier / under a bridge; the hull under a bridge ----------
const OAR_SW = [-0.6, 0, 0.6], OAR_D = [0.55, 0.95, 1.35], HULL_U = [-1.85, -1.2, -0.6, 0, 0.6, 1.2, 1.95], HULL_S = [0, 0.55, -0.55];
function oarRoom(w, b, dt) {
  const oi = b._oi || (b._oi = [0, 0]), uo = BOAT.places[0][0], hw = halfW(uo), k = Math.min(1, dt * 5);
  for (let j = 0; j < 2; j++) {
    const sd = j ? -1 : 1;
    let blocked = false;
    for (const sw of OAR_SW) for (const d of OAR_D) {
      if (blocked) break;
      const [x, y] = hullPt(b._x, b._y, b._h, uo + Math.sin(sw) * d, sd * (hw + Math.cos(sw) * d)), tx = Math.floor(x), ty = Math.floor(y);
      if (!w.inBounds(tx, ty)) { blocked = true; break; }
      const i = w.idx(tx, ty);
      if (!w.water.get(i) || w.rock.get(i) || (w.deck && w.deck.get(i)) || w.solid.get(i)) blocked = true;
    }
    oi[j] += ((blocked ? 1 : 0) - oi[j]) * k;
  }
  let ub = false;
  if (w.deck) for (const u of HULL_U) for (const s of HULL_S) {
    if (ub) break;
    const [x, y] = hullPt(b._x, b._y, b._h, u, s), tx = Math.floor(x), ty = Math.floor(y);
    if (w.inBounds(tx, ty) && w.deck.get(w.idx(tx, ty)) === 2) ub = true;
  }
  b._ub = ub;
}

// ---------- the driver (owner side) ----------
const BACK_A = 2.2; // rad: the stick this far behind the bow backs the boat
const WIGGLE = [0, 0.02, -0.02, 0.05, -0.05, 0.1, -0.1]; // (radians tried against a bank / a bridge pier: the hull lines up with the gap)
function drive(game, B, b, C, dt) {
  const inp = game.input, w = game.world;
  if (C.b !== b) { C.b = b; C.x = b.x; C.y = b.y; C.h = b.h; C.vx = b.vx || 0; C.vy = b.vy || 0; C.w = 0; C.sx = NaN; C.sendT = 0; }
  let [mx, my] = inp.move();
  if (mx || my) [mx, my] = game.toWorldDir(mx, my);
  const mag = Math.min(1, Math.hypot(mx, my));
  C.rowing = false;
  if (w.frozen) {
    C.vx = C.vy = C.w = 0;
    if (mag > 0.2 && game.time - C.iceT > 4) { C.iceT = game.time; game.events.emit('error', { text: 'O barco está preso no gelo' }); }
  } else {
    // the river's current (worldgen flow: rivers only, lakes are still): the oars and the drag act on the speed
    // through the water, so an idle boat drifts downstream and a rower easily beats it
    const ci = w.inBounds(Math.floor(C.x), Math.floor(C.y)) ? w.idx(Math.floor(C.x), Math.floor(C.y)) : -1;
    const cux = ci >= 0 && w.flowX ? w.flowX.get(ci) * BOAT.current : 0, cuy = ci >= 0 && w.flowY ? w.flowY.get(ci) * BOAT.current : 0;
    const c = Math.cos(C.h), n = Math.sin(C.h), rvx = C.vx - cux, rvy = C.vy - cuy;
    let vf = rvx * c + rvy * n, vl = -rvx * n + rvy * c;
    let turn = 0;
    if (mag > 0.15) {
      const want = Math.atan2(my, mx), d = angDiff(want, C.h);
      // the stick well behind the boat (> ~125°): back water, the stern turning toward it (straight back: no turn, so a
      // boat in a narrow river backs out instead of wedging itself across); else turn the bow toward it and pull
      const back = Math.abs(d) > BACK_A, dt2 = back ? angDiff(want + Math.PI, C.h) : d;
      const rate = Math.min(BOAT.turn, Math.abs(dt2) * 3.2 + 0.15);
      turn = Math.sign(dt2) * Math.min(Math.abs(dt2), rate * dt);
      const cd = Math.cos(dt2);
      vf += BOAT.accel * mag * (back ? -BOAT.back * Math.max(0, cd) : Math.max(0, cd)) * dt;
      C.rowing = true;
    }
    vf *= Math.exp(-dt * (C.rowing ? BOAT.dragRow : BOAT.drag));
    vl *= Math.exp(-dt * BOAT.side);
    vf = Math.max(-BOAT.speed * BOAT.back, Math.min(BOAT.speed * Math.max(0.35, mag), vf));
    if (Math.abs(vf) < 0.01 && !C.rowing) vf = 0;
    if (Math.abs(vl) < 0.01 && !C.rowing) vl = 0;
    // turn (kept when the turned hull would hit something)
    if (turn && hullFree(game, C.x, C.y, C.h + turn, b)) C.h += turn; else turn = 0;
    C.w = turn / Math.max(dt, 1e-3);
    const c2 = Math.cos(C.h), n2 = Math.sin(C.h);
    C.vx = c2 * vf - n2 * vl + cux; C.vy = n2 * vf + c2 * vl + cuy;
    // move; against a bank it eases its heading a little (the hull lines up with a channel) or slides along; a hard
    // knock stops it
    const nx = C.x + C.vx * dt, ny = C.y + C.vy * dt;
    const pose = (x, y) => { for (const dh of WIGGLE) if (hullFree(game, x, y, C.h + dh, b)) { C.x = x; C.y = y; C.h += dh; return true; } return false; };
    if (!pose(nx, ny)) {
      const sp = Math.hypot(C.vx, C.vy);
      if (pose(nx, C.y)) C.vy *= -0.15;
      else if (pose(C.x, ny)) C.vx *= -0.15;
      else { C.vx *= -0.2; C.vy *= -0.2; }
      if (sp > 0.9 && game.time - (C.bumpT || 0) > 0.6) { C.bumpT = game.time; game.audio?.play('build_hit', { x: C.x, y: C.y, volume: 0.35 }); game.juice?.shake?.(0.08); }
    }
  }
  if (game.world.wrap) C.x = game.world.wrapPos(C.x); // (the planet wraps: canonical x, the drawing takes the nearest image)
  b._x = C.x; b._y = C.y; b._h = C.h; b._buf = null;
  // report: a few times a second while it moves / turns, and once when it settles
  C.sendT -= dt;
  const moving = Math.hypot(C.vx, C.vy) > 0.02 || Math.abs(C.w) > 0.01;
  if (C.sendT <= 0 && (moving || Number.isNaN(C.sx) || Math.abs(C.x - C.sx) > 0.004 || Math.abs(C.y - C.sy) > 0.004 || Math.abs(angDiff(C.h, C.sh)) > 0.003)) {
    C.sendT = 1 / BOAT.hz;
    B.sendMove(b);
  }
}

// a rider / an animal on its spot of the drawn boat (every peer; the local player: also its gameplay position)
// (riders sit on their place like on a chair — art/compose.js seat pose: legs down, the 3/4 views — facing the bow at
// its true angle (art/facing.js seat.ang); a seated pawn is drawn from its seat, so the bench height goes in seatAt and
// e._dh stays 0, as for a chair on a deck; acting — a bow shot — it stands on the bench, lifted by e._dh)
function placeRider(B, b, e, k) {
  const [u, s] = BOAT.places[k];
  const [x, y, dh] = B.spot(b, u, s, BOAT.seatH);
  e.x = x; e.y = y; e._dh = dh; e._boat = b; e.lv = 0; e.z = 0;
  e.moving = false;
  e._zb = underDeck(B.game.world, x, y) ? UNDER : 0;
  if (!e.action && !e.dead) {
    const S = (b._st ||= [])[k] || (b._st[k] = { x: 0, y: 0, h: 0, face: 's', ang: 0, _zk: 0, _fk: SEAT_FK, _boatSeat: true });
    const rot = B.game.cam?.rot || 0;
    S.x = x; S.y = y; S.h = dh; S.ang = b._h; S.face = facingFrom(Math.cos(b._h), Math.sin(b._h), S.face);
    e._dh = 0;
    S._zk = -Math.sin(rot) * x + Math.cos(rot) * y - 0.02; // (game.js: the sitter right after its seat = its own depth)
    if (e.pose?.o !== S) e.pose = { type: 'sit', id: null, o: S };
    if (!(e._faceLockT > 0)) e.facing = S.face;
  }
}
const PELVIS = 0.476; // (art/faces/solid.js: the sitting body's bottom above its base, past the rig's 0.13)
const SEAT_Q = [0, 0, 0];
const SEAT_FK = { seatAt(S) { SEAT_Q[0] = S.x; SEAT_Q[1] = S.y; SEAT_Q[2] = S.h - PELVIS - 0.13; return SEAT_Q; } };
const isBoatPose = (e) => !!e.pose?.o?._boatSeat;
// riders / animals under a finished bridge: drawn behind its deck (game.js depth bias) — they pass under it, as the hull
// (art/faces/solidBoat.js: the same bias on its faces while any of it is under a bridge, b._ub)
export const UNDER = -1.5;
const underDeck = (w, x, y) => { const tx = Math.floor(x), ty = Math.floor(y); return !!w.deck && w.inBounds(tx, ty) && w.deck.get(w.idx(tx, ty)) === 2; };
// an animal stands on the floor at its spot of the layout (Boats.layout: across the hull, heads turned to either side)
function placePet(B, b, m, L) {
  const [u, s, across, dir] = L;
  const [x, y, dh] = B.spot(b, u, s, BOAT.floorH);
  m.x = x; m.y = y; m._dh = dh; m._boat = b; m.moving = false;
  m._zb = underDeck(B.game.world, x, y) ? UNDER : 0;
  if (across) m.facing = facingFrom(dir * Math.sin(b._h), -dir * Math.cos(b._h), m.facing);
  else m.facing = facingFrom(Math.cos(b._h), Math.sin(b._h), m.facing);
}
// candidate spots down the middle of the hull, the widest first
const LAY_LO = -1.72, LAY_HI = 1.78, LAY_U = [];
for (let u = LAY_LO; u <= LAY_HI + 1e-6; u += 0.02) LAY_U.push(Math.round(u * 100) / 100);
LAY_U.sort((a, b) => Math.abs(a - 0.15) - Math.abs(b - 0.15) || a - b);
function placeAll(game, B, b, hostSide) {
  for (let k = 0; k < BOAT.room; k++) {
    const pid = b.seats[k];
    if (!pid) continue;
    const e = B.riderEnt(pid);
    if (e && !e.dead) placeRider(B, b, e, k);
  }
  if (!b.pets.length) return;
  const L = B.layout(b);
  for (let i = 0; i < b.pets.length; i++) {
    const m = B.petEnt(b.pets[i][0]);
    if (!m || m.dead) continue;
    placePet(B, b, m, L[i]);
    if (hostSide) { m.state = 'idle'; m.stateT = 2; }
  }
}

// ---------- systems ----------
// every peer: the drawn pose of each boat, riders / animals on their spots, the wake; host: launching finished boat
// blueprints (creative), riders / animals that are gone, animals that ended up in deep water
export function boatsSystem() {
  let slowT = 0, launchV = -1;
  return {
    sync: 'all', // shared boats come from ops; the drawn pose, riders' spots and the wake are cosmetic; host parts check net.auth
    update(game, dt) {
      const B = game.boats;
      if (!B) return;
      const net = game.net, auth = net.auth, now = performance.now() / 1000;
      if (game.debug && !game.debug.boatScene) installBoatDebug(game);
      // host: a finished boat blueprint (creative / a path that skipped the launch) is launched
      if (auth && game.build.v !== launchV) {
        launchV = game.build.v;
        for (const o of game.build.structures) if (o.type === 'boat' && !o.blueprint && !o.removed) net.emit('boat.launch', launchArgs(game, o, null));
      }
      // after a load: the local player standing inside a boat (saved while riding) steps ashore
      if (B.ashoreT != null && (B.ashoreT -= dt) <= 0) { B.ashoreT = null; ashore(game, B); }
      if (!B.map.size) { unmark(B, null); if (B.fx.length) wake(game, B, dt); return; }
      if (auth) B.refreshNids();
      const mine = B.mine(), C = B.ctl;
      for (const b of B.map.values()) {
        // the drawn pose (the local driver's own boat is drawn from its simulation: boatOwnerSystem)
        const driving = b === mine && b.seats[0] === net.pid && C.b === b;
        // (the pose drawn last frame: the local driver's boat moves after this system, in boatOwnerSystem)
        const x0 = b._lx ?? b._x, y0 = b._ly ?? b._y, h0 = b._lh ?? b._h;
        if (!driving) {
          if (C.b === b && b.seats[0] !== net.pid) { C.b = null; b._buf = [{ t: now - DELAY - 0.05, x: b._x, y: b._y, h: b._h, vx: 0, vy: 0 }]; } // (just handed the oars over: ease to the shared pose)
          track(b, now);
        }
        // drawn speed / turning (oars, wake, rocking) — smoothed
        const sp = dt > 0 ? Math.hypot(b._x - x0, b._y - y0) / dt : 0, tw = dt > 0 ? angDiff(b._h, h0) / dt : 0;
        b._spd = (b._spd || 0) + (Math.min(4, sp) - (b._spd || 0)) * Math.min(1, dt * 5);
        b._turn = (b._turn || 0) + (Math.max(-2, Math.min(2, tw)) - (b._turn || 0)) * Math.min(1, dt * 5);
        b._vx = dt > 0 ? (b._x - x0) / dt : 0; b._vy = dt > 0 ? (b._y - y0) / dt : 0;
        b._lx = b._x; b._ly = b._y; b._lh = b._h;
        bob(b, game.time, dt);
        oarRoom(game.world, b, dt);
        // the oars: a stroke while it moves or turns with someone at them
        const rowing = !!b.seats[0] && (b._spd > 0.25 || Math.abs(b._turn) > 0.25) && !game.world.frozen;
        b._rowK = (b._rowK || 0) + ((rowing ? 1 : 0) - (b._rowK || 0)) * Math.min(1, dt * 4);
        if (rowing || (b._row || 0) % 1 > 0.02) {
          const r0 = b._row || 0;
          b._row = r0 + dt * (0.55 + 0.25 * Math.min(1, b._spd / BOAT.speed));
          if (Math.floor(b._row) !== Math.floor(r0) && rowing) oarSplash(game, b);
        }
        if (auth) placeAll(game, B, b, true); // (host: its creatures stand where they are drawn — the entity stream sends that)
      }
      mark(game, B);
      wake(game, B, dt);
      if (!auth) return;
      slowT -= dt;
      if (slowT > 0) return;
      slowT = 0.5;
      hostTidy(game, B);
    },
    // render time (after every update: interpolated remote players / creature proxies): riders and animals on their
    // spots of the drawn boats, then the boats themselves (drawn before them: their faces write depth)
    collect(game, list, v) {
      const B = game.boats;
      if (!B || !B.map.size) return;
      for (const b of B.map.values()) {
        if (b._x < v.x0 - 4 || b._x > v.x1 + 4 || b._y < v.y0 - 4 || b._y > v.y1 + 5) continue;
        placeAll(game, B, b, false);
        const d = b._d || (b._d = { b, x: 0, y: 0, draw(Bt, A, t) { drawBoat(Bt, A, this.b, t); }, zkRot(rc, rs) { return -rs * this.b._x + rc * this.b._y - 1.7; } });
        d.x = b._x; d.y = b._y;
        list.push(d);
      }
    },
    render(game, Bt) { drawWake(game, Bt); },
  };
}

// the local rider: rooted on its seat; at the oars it rows (sim + reports); getting off moves it to the landing spot
export function boatOwnerSystem() {
  return {
    sync: 'owner',
    update(game, dt) {
      const B = game.boats;
      if (!B) return;
      const p = game.player, C = B.ctl, me = game.net.pid;
      const b = B.mine();
      if (!b) {
        if (C.on) {
          C.on = false; C.k = -1; C.deadSent = false;
          if (C.b) C.b = null;
          p._boat = null; p._dh = 0;
          if (isBoatPose(p)) p.pose = null;
          p._zb = 0;
          game.events.emit('boat', { on: false });
        }
        const L = B.land;
        if (L) {
          B.land = null;
          if (!p.dead) { p.x = L[0]; p.y = L[1]; p.lv = 0; p.z = 0; p.moving = false; game.juice?.splash?.(p.x, p.y, 0.5); game.audio?.play('splash', { x: p.x, y: p.y, volume: 0.35 }); }
        }
        return;
      }
      B.land = null;
      if (p.dead) {
        if (!C.deadSent) { C.deadSent = true; game.net.request('boat.leave', { id: b.id, dead: 1 }); }
        return;
      }
      const k = b.seats.indexOf(me);
      if (!C.on) {
        C.on = true; C.k = k; C.deadSent = false;
        if (p.work) { p.work = null; p.action = null; }
        if (game.ctl) game.ctl.goal = null;
        game.events.emit('boat', { on: true, b });
      } else if (k === 0 && C.k > 0) game.events.emit('toast', { text: 'Agora você está nos remos', kind: 'info' });
      C.k = k;
      p.rooted = true; // (no walking: the oars take the movement input — abilities.js resets it every frame before this)
      p.autoMove = null;
      p.swimming = false;
      p.wetT = 0; p._wet = 0; // (dry in a boat: no soaking, no drips — survival.js / juice.js)
      if (k === 0) drive(game, B, b, C, dt);
      else if (C.b === b) C.b = null;
      placeRider(B, b, p, k);
    },
  };
}

// host: the launch of a finished boat blueprint → op args (the pose worked out from the tile)
export function launchArgs(game, o, by, extra = {}) {
  const lp = launchPose(game, o.tx, o.ty) || [o.tx + 0.5, o.ty + 0.5, Math.PI / 2];
  return { sid: o.id, id: o.id, x: lp[0], y: lp[1], h: lp[2], v: (o.v | 0) % 4, at: Math.round(game.worldTime), by: by || undefined, ...extra };
}

// host, twice a second: riders that left / died get off (their animals with them), animals that died / were untied
// stay or get off, animals that ended up in deep water outside a boat (a save made while riding) come ashore
function hostTidy(game, B) {
  const net = game.net, w = game.world;
  for (const b of B.map.values()) {
    let changed = false;
    const seats = b.seats.slice(), pets = b.pets.slice();
    for (let k = 0; k < BOAT.room; k++) {
      const pid = seats[k];
      if (!pid) continue;
      const q = B.hostPlayer(pid);
      if (q && !q.dead && !q.gone) continue;
      seats[k] = 0; changed = true;
      // its animals get off on the nearest bank
      for (let i = pets.length - 1; i >= 0; i--) if (pets[i][1] === pid) { unloadPet(game, B, b, pets[i][0], null); pets.splice(i, 1); }
    }
    for (let i = pets.length - 1; i >= 0; i--) {
      const m = B.nids.get(pets[i][0]);
      if (!m || m.dead) { pets.splice(i, 1); changed = true; continue; }
      if (m.tiedTo !== pets[i][1] || !seats.includes(pets[i][1])) { unloadPet(game, B, b, pets[i][0], null); pets.splice(i, 1); changed = true; }
    }
    if (!changed) continue;
    if (!seats[0]) promote(seats);
    net.emit('boat.set', { id: b.id, seats, pets });
  }
  // farm animals stuck in deep water (not riding): to the nearest bank
  for (const m of game.entities) {
    if (!m.stock || m.dead || m.proxy || m._boat || m.water) continue;
    if (w.liquidAt(Math.floor(m.x), Math.floor(m.y)) !== 2) continue;
    const s = B.nearSpot(m.x, m.y, m.r || 0.3);
    if (s) { m.x = s[0]; m.y = s[1]; }
  }
}
// the next passenger takes the oars (the stern seat, the aft bench, the fore bench)
export function promote(seats) {
  if (seats[0]) return null;
  for (const k of BOAT.playerOrder) if (k && seats[k]) { seats[0] = seats[k]; seats[k] = 0; return seats[0]; }
  return null;
}
// host: an animal gets off near (x, y) (its leader's landing spot), else the nearest bank around the boat
export function unloadPet(game, B, b, nid, at, k = 0) {
  const m = B.nids.get(nid) || B.petEnt(nid);
  if (!m || m.dead) return;
  let s = at ? B.nearSpot(at[0], at[1], m.r || 0.3, k * 3) : null;
  if (!s) { const L = B.landingSpot(b, b.x, b.y, m.r || 0.3); if (L) s = B.nearSpot(L[0], L[1], m.r || 0.3, k * 3) || L; }
  if (!s) { // a wider search: the nearest walkable tile within 12 tiles
    for (let r = 2; r <= 12 && !s; r++) s = B.nearSpot(b.x, b.y, m.r || 0.3, r * 8);
  }
  m._boat = null; m._dh = 0;
  if (s) { m.x = s[0]; m.y = s[1]; }
  m.moving = false; m.state = 'idle'; m.stateT = 1;
}

// entities marked as riding (e._boat): every peer, from the shared seats / pets
function mark(game, B) {
  const now = B._mk || (B._mk = new Set());
  now.clear();
  for (const b of B.map.values()) {
    for (const pid of b.seats) { if (!pid) continue; const e = B.riderEnt(pid); if (e) { e._boat = b; now.add(e); } }
    for (const q of b.pets) { const m = B.petEnt(q[0]); if (m) { m._boat = b; now.add(m); } }
  }
  unmark(B, now);
}
function unmark(B, now) {
  for (const e of B.marked) if (!now || !now.has(e)) { if (e._boat) { e._boat = null; e._dh = 0; e._zb = 0; if (isBoatPose(e)) e.pose = null; } }
  B.marked.clear();
  if (now) for (const e of now) B.marked.add(e);
}

// after a load / join: the local player inside a boat (not riding) steps ashore next to it
function ashore(game, B) {
  const p = game.player;
  if (p.dead || B.mine()) return;
  for (const b of B.map.values()) {
    if (!inHull(b.x, b.y, b.h, p.x, p.y, 0.3)) continue;
    const s = B.landingSpot(b, p.x, p.y) || B.nearSpot(b.x, b.y);
    if (s) { p.x = s[0]; p.y = s[1]; game.cam.x = p.x; game.cam.y = p.y - 0.4; }
    return;
  }
}

// ---------- wake (cosmetic) ----------
// foam streaks off the bow and the stern while it moves, slow rings around the hull while it bobs, the oars' splashes
function wake(game, B, dt) {
  const F = B.fx;
  for (let i = F.length - 1; i >= 0; i--) { const f = F[i]; f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; if (f.t >= f.life) F.splice(i, 1); }
  if (game.world.frozen) return;
  const v = game.view?.();
  for (const b of B.map.values()) {
    if (v && (b._x < v.x0 - 3 || b._x > v.x1 + 3 || b._y < v.y0 - 3 || b._y > v.y1 + 4)) continue;
    const sp = b._spd || 0;
    b._wT = (b._wT || 0) - dt;
    if (sp > 0.35 && b._wT <= 0 && F.length < 110) {
      b._wT = 0.07;
      const c = Math.cos(b._h), n = Math.sin(b._h), k = Math.min(1, sp / BOAT.speed), j = ((b._wn = (b._wn || 0) + 1) * 0.618) % 1;
      // the bow wave: a short streak off each side that stays in the water and drifts out (the arms of a V)
      for (const sd of [-1, 1]) {
        const [x, y] = hullPt(b._x, b._y, b._h, BOAT.bow - 0.35 - j * 0.2, sd * (halfW(BOAT.bow - 0.45) + 0.04));
        const ox = n * sd, oy = -c * sd; // (outward)
        F.push({ k: 0, x, y, vx: ox * 0.3 * sp, vy: oy * 0.3 * sp, t: 0, life: 1.6, a: 0.95 * k, s: 0.5, h: Math.atan2(-n + oy * 0.36, -c + ox * 0.36) });
      }
      // the stern: soft foam that spreads and fades
      if ((b._wn & 1) === 0) {
        const [x, y] = hullPt(b._x, b._y, b._h, BOAT.stern - 0.05, (j - 0.5) * 0.4);
        F.push({ k: 1, x, y, vx: 0, vy: 0, t: 0, life: 2, a: 0.7 * k, s: 0.55, h: b._h });
      }
      if (b._wn % 5 === 0) { const [x, y] = hullPt(b._x, b._y, b._h, BOAT.stern - 0.3, 0); F.push({ k: 4, x, y, vx: 0, vy: 0, t: 0, life: 1.8, a: 0.55 * k, s: 1, h: b._h }); } // (rings spreading behind it)
    }
    // idle: a slow ring around the hull now and then
    b._rT = (b._rT || 0) - dt;
    if (b._rT <= 0 && sp < 0.35 && F.length < 110) { b._rT = 1.9; F.push({ k: 2, x: b._x, y: b._y, vx: 0, vy: 0, t: 0, life: 2.6, a: 0.2, s: 1, h: b._h }); }
  }
}
function oarSplash(game, b) {
  const F = game.boats.fx;
  for (const sd of [-1, 1]) {
    const [x, y] = hullPt(b._x, b._y, b._h, BOAT.places[0][0] + 0.35, sd * (halfW(0) + 0.95));
    if (F.length < 100) F.push({ k: 3, x, y, vx: 0, vy: 0, t: 0, life: 1.1, a: 0.45, s: 0.3, h: 0 });
  }
  if (Math.hypot(b._x - game.cam.x, b._y - game.cam.y) < 14) game.audio?.play('splash', { x: b._x, y: b._y, volume: 0.12 });
}
function drawWake(game, Bt) {
  const F = game.boats?.fx, A = game.A;
  if (!F || !F.length || !Bt.ground) return;
  const ring = A.has('fx_ripple') ? A.get('fx_ripple') : A.has('fx_ring') ? A.get('fx_ring') : null, soft = A.has('fx_soft') ? A.get('fx_soft') : null;
  for (const f of F) {
    const u = f.t / f.life, fade = (1 - u) * (u < 0.12 ? u / 0.12 : 1);
    // (foam reads on bright shallow water too: a darker trough under each white crest)
    if ((f.k === 0 || f.k === 1) && soft) {
      const L = f.k ? f.s + u * 1.1 : f.s + u * 0.7, T = f.k ? f.s * 0.8 + u * 0.8 : 0.2 + u * 0.16;
      Bt.ground.add(soft, f.x, f.y, (L * 1.3) / soft.w, (T * 1.6 + 0.08) / soft.h, 0.05, 0.2, 0.24, 0.4 * f.a * fade, 0, f.h, 0, 1, 1);
    }
    if (f.k === 0 && soft) Bt.ground.add(soft, f.x, f.y, (f.s + u * 0.7) / soft.w, (0.2 + u * 0.16) / soft.h, 1, 1, 1, f.a * fade, 0, f.h, 0, 1, 1);
    else if (f.k === 1 && soft) Bt.ground.add(soft, f.x, f.y, (f.s + u * 1.1) / soft.w, (f.s * 0.8 + u * 0.8) / soft.h, 1, 1, 1, f.a * fade, 0, f.h, 0, 1, 1);
    else if (f.k === 2 && ring) Bt.ground.add(ring, f.x, f.y, (4.3 + u * 1.4) / ring.w, (1.5 + u * 1.2) / ring.h, 0.85, 0.95, 1, f.a * fade, 0, f.h);
    else if (f.k === 3 && ring) Bt.ground.add(ring, f.x, f.y, (0.25 + u * 0.8) / ring.w, (0.25 + u * 0.8) / ring.h, 0.9, 0.97, 1, f.a * fade, 0, 0);
    else if (f.k === 4 && ring) Bt.ground.add(ring, f.x, f.y, (0.5 + u * 1.5) / ring.w, (0.4 + u * 1.1) / ring.h, 0.95, 1, 1, f.a * fade, 0, f.h, 0, 1, 1);
  }
}

// ---------- dev helpers (localhost: game.debug exists) ----------
// game.debug.boatScene({ riders: 0..3 stand-ins, pets: ['cow', 'sheep'], board: true, at: [tx, ty], near: [x, y] }) — a
// boat launched on the nearest bank / pier (host; at: that water tile); returns { id, x, y, h }. game.debug.boatAt(id)
// puts the camera on it.
export function installBoatDebug(game) {
  const G = game.debug;
  if (!G || G.boatScene) return;
  G.boatSite = (r0 = 0, from = null) => {
    const w = game.world, p = game.player, px = Math.floor(from ? from[0] : p.x), py = Math.floor(from ? from[1] : p.y);
    for (let r = r0; r < 90; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = px + dx, y = py + dy;
        if (!w.inBounds(x, y) || !w.water.get(w.idx(x, y)) || game.build.grid.main.has(w.idx(x, y)) || game.build.grid.deck.has(w.idx(x, y))) continue;
        let side = false;
        for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.inBounds(x + ex, y + ey) && ((!w.water.get(w.idx(x + ex, y + ey)) && !w.rock.get(w.idx(x + ex, y + ey))) || game.build.grid.deck.has(w.idx(x + ex, y + ey)))) side = true;
        if (!side) continue;
        const lp = launchPose(game, x, y);
        if (lp) return { tx: x, ty: y, pose: lp };
      }
    }
    return null;
  };
  G.boatScene = (opts = {}) => {
    const net = game.net, p = game.player;
    if (!net.auth) return 'só o anfitrião';
    const s = opts.pose ? { pose: opts.pose } : opts.at ? { tx: opts.at[0], ty: opts.at[1], pose: launchPose(game, opts.at[0], opts.at[1]) } : G.boatSite(opts.r0 || 0, opts.near || null);
    if (!s || !s.pose) return null;
    const id = net.newId('s');
    net.emit('boat.launch', { id, x: s.pose[0], y: s.pose[1], h: s.pose[2], v: 0, at: Math.round(game.worldTime) });
    const B = game.boats, b = B.map.get(id);
    b._x = b.x; b._y = b.y; b._h = b.h;
    // stand-in riders (screenshots): plain pawns with a pid (B.extra)
    const n = Math.max(0, Math.min(3, opts.riders | 0));
    if (n) {
      B.extra ||= new Map();
      const looks = [{ hair: 'short', hairC: '2a1c14', topC: 'b8503a', skin: 'c99a6e' }, { hair: 'short', hairC: 'c8a060', topC: '4f8a4a', beard: 'full', beardC: 'c8a060' }, { hair: 'short', hairC: '6a3a20', topC: 'd6b25a', skin: '8a5a3c' }];
      for (let k = 0; k < n; k++) {
        const pid = 'dbg' + id + k;
        const e = { isEntity: true, kind: 'pawn', remote: true, faction: 'friend', pid, name: ['Ana', 'Rui', 'Bia'][k], x: b.x, y: b.y, r: 0.24, facing: 's', moving: false, moveT: 0, action: null, flash: 0,
          look: cleanLook({ ...DEFAULT_LOOK, ...looks[k] }), weapon: k === 1 ? 'bow_wood' : null, offhand: null, armor: { body: null, head: null }, hp: 100, maxHp: 100, level: 3, dead: false };
        B.extra.set(pid, e);
        game.entities.push(e); // sync-ok: dev stand-in rider (screenshots), never on a real session
      }
    }
    if (opts.board !== false) {
      const seats = [net.pid, 0, 0, 0, 0, 0], order = BOAT.playerOrder.slice(1);
      for (let k = 0; k < n; k++) seats[order[k]] = 'dbg' + id + k;
      const pets = [], taken = new Set(seats.map((q, k) => (q ? k : -1)));
      for (const sp of opts.pets || []) {
        const k = BOAT.animalOrder.find((j) => !taken.has(j));
        if (k == null) break;
        const m = game.stock?.debug?.spawn(sp, b.x, b.y, { owned: true });
        if (!m) continue;
        m.tiedTo = net.pid; m.owned = true;
        pets.push([m.nid, net.pid, k]); taken.add(k);
      }
      net.emit('boat.set', { id, seats, pets });
    }
    p.x = b.x; p.y = b.y; game.cam.x = b.x; game.cam.y = b.y - 0.4;
    return { id, x: b.x, y: b.y, h: b.h };
  };
  G.boatAt = (id) => { const b = id ? game.boats.map.get(id) : [...game.boats.map.values()][0]; if (b) { game.cam.x = b._x; game.cam.y = b._y - 0.4; } return b ? { x: b._x, y: b._y, h: b._h, seats: b.seats, pets: b.pets } : null; };
}
