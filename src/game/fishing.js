// Fishing with a rod (docs/LIVESTOCK.md): with a fishing rod (Vara de pescar) in the bag or the hand, next to water
// the use action (E / Usar) says "Pescar": the player casts toward the water in front of it (a bobber lands 1.6-6.5
// tiles away), waits, and when the bobber goes under ("Puxe!") uses the action again in time to land 2-3 raw fish.
// Walking away reels the line in. A long shot (bow) or a thrown spear into the water where fish swim catches one
// (livestock.js fish onDeath). Shared rules (bite time, judging the pull) are the host's: mut/fish.js.
//
// game.fishing = { bobs: Map pid → { x, y, bite, until } (every peer: drawing), host: Map (authority sessions),
//                  near() (the contextual action), bobberOf(pid), anglerOf(pid), ended(op) }

import { FISH } from './content/livestock.js';
import { registerWork } from './gathering.js';
import { allPlayers } from './players.js';
import { fishHostTick } from './mut/fish.js';
import { ROD_RELEASE } from '../art/compose.js'; // (the cast swing: when the bobber leaves the rod tip)

const hasRod = (p) => p.inv.count('rod_wood') > 0 || p.equip?.main === 'rod_wood';
const DIRS = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };

// the water point to cast at: straight ahead first, then a fan around it (the nearest open water 1.6..6.5 tiles off)
function castPoint(game, p) {
  const w = game.world;
  const f = DIRS[p.facing] || [0, 1];
  const base = Math.atan2(f[1], f[0]);
  for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
    const a = base + da, cx = Math.cos(a), cy = Math.sin(a);
    let first = 0;
    for (let d = FISH.castMin; d <= FISH.castMax; d += 0.5) {
      const x = p.x + cx * d, y = p.y + cy * d;
      if (w.liquidAt(Math.floor(x), Math.floor(y))) { if (!first) first = d; if (d - first >= 1 || d >= FISH.castMax - 0.5) return [x, y]; }
      else if (first) return [p.x + cx * (first + d) / 2 - cx * 0.5, p.y + cy * (first + d) / 2 - cy * 0.5];
    }
    if (first) return [p.x + cx * first, p.y + cy * first];
  }
  return null;
}
function frozenNear(game, p) {
  const w = game.world;
  if (!w.frozen) return false;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (w.waterAt(Math.floor(p.x) + dx, Math.floor(p.y) + dy)) return true;
  return false;
}

function near(game) {
  const p = game.player, F = game.fishing;
  if (p.dead || p.swimming || !hasRod(p)) return null;
  const me = F.bobs.get(game.net.pid);
  if (me || F.pending) {
    const bite = me && game.worldTime >= me.bite - 0.05 && game.worldTime <= me.until + 0.2;
    return { kind: 'fish_pull', verb: bite ? 'Puxar!' : 'Recolher a linha', icon: 'gather', prio: 9, x: p.x, y: p.y, reach: 99, fishing: true };
  }
  const pt = F._ptT > game.time ? F._pt : (F._pt = castPoint(game, p), F._ptT = game.time + 0.3, F._pt);
  if (!pt) return frozenNear(game, p) ? { kind: 'fish_cast', verb: 'Água congelada', icon: 'gather', prio: 0, x: p.x, y: p.y, reach: 99, frozen: true } : null;
  return { kind: 'fish_cast', verb: 'Pescar', icon: 'gather', prio: 1, x: pt[0], y: pt[1], tx: pt[0], ty: pt[1], reach: FISH.castMax + 1.2, fishing: true };
}

// the cast: a work kind that keeps the angler still, facing the bobber, rod in hand, until the line comes out
registerWork('fish_cast', {
  valid(g, it) { const F = g.fishing; return !!(F.pending || F.bobs.get(g.net.pid)); },
  start(game, it) {
    if (it.frozen) { game.events.emit('error', { text: 'A água está congelada: espere o inverno passar' }); return null; }
    const p = game.player, F = game.fishing;
    if (!hasRod(p)) { game.events.emit('error', { text: 'Você precisa de uma vara de pescar (2 gravetos + 3 fibras)' }); return null; }
    if (F.bobs.get(game.net.pid) || F.pending) return null;
    F.pending = true;
    game.net.request('fish.cast', { x: +it.tx.toFixed(2), y: +it.ty.toFixed(2) }, {
      onOk: () => { F.pending = false; },
      onReject: (why) => { F.pending = false; game.events.emit('error', { text: why || 'Não deu para lançar a linha' }); },
    });
    game.audio?.play('swing', { x: p.x, y: p.y, volume: 0.5 });
    F._castT = game.time; p._fishT0 = game.time; // (the cast swing starts now: art/compose.js rodPhase)
    return { type: 'fish', cycle: 1e6, need: 1, label: 'Pescando', tool: 'rod_wood' };
  },
  finish: () => true,
});
// the pull (or reeling in before a bite): one request, the work ends when the host says how it went (fish.end)
registerWork('fish_pull', {
  valid: () => false,
  start(game) {
    const F = game.fishing;
    if (!F.bobs.get(game.net.pid)) return null;
    if (F._pullT > game.time - 0.4) return null;
    F._pullT = game.time;
    game.net.request('fish.pull', {});
    game.audio?.play('swing', { x: game.player.x, y: game.player.y, volume: 0.4 });
    // the pull: the cast work ends here, the rod is yanked up (an action every peer plays: the presence stream)
    const p = game.player;
    if (p.work?.it?.kind === 'fish_cast') p.work = null;
    p.action = { type: 'reel', t: 0, dur: 0.6 };
    return null;
  },
  finish: () => true,
});

export function installFishing(game) {
  game.fishing = {
    bobs: new Map(), host: new Map(), pending: false,
    reels: new Map(), // pid → { x, y, t0, ok }: a line just pulled out (cosmetic: the bobber flies back to the rod)
    near: () => near(game),
    bobberOf: (pid) => game.fishing.host.get(pid) || null,
    anglerOf: (pid) => allPlayers(game).find((q) => (q === game.player ? game.net.pid : q.pid) === pid) || null,
    // a line came out (op fish.end): the angler's own work ends
    ended(a) {
      if (a.pid !== game.net.pid) return;
      const p = game.player;
      if (p.work?.it?.kind === 'fish_cast') { p.work = null; p.action = null; }
    },
  };
}

// ---------- cosmetics: the cast, the bobber's flight, the line, the pull (every peer, from replicated state) ----------
const FLY = (d) => 0.26 + d * 0.05; // s the bobber flies (1.6..6.5 tiles away)
// when the bobber leaves the rod tip on this peer: the angler's cast swing (as this peer saw it start) + its release,
// never before the host's bobber arrived; a cast this peer has not seen start yet gets a moment to show up
function flyStart(game, b, e) {
  if (b.fly != null) return b.fly;
  const c = e?._fishT0;
  if (c != null && c > b.t0 - 3) return (b.fly = Math.max(b.t0, c + ROD_RELEASE));
  if (game.time > b.t0 + 0.35) return (b.fly = b.t0 + 0.35);
  return Infinity;
}
const flyDist = (b, e) => (e ? Math.hypot(b.x - e.x, b.y - e.y) : 3);
// every angler this peer draws: the start of a cast (an action turning into 'fish'), the bite (the rod tip dips)
function anglers(game) {
  const F = game.fishing, out = [game.player];
  for (const pl of game.session?.players?.values?.() || []) if (pl.ent) out.push(pl.ent);
  for (const e of out) {
    const on = e.action?.type === 'fish' && !e.dead;
    if (on && !e._fishOn && e !== game.player) e._fishT0 = game.time; // (the local player: at the cast itself)
    e._fishOn = on;
    const pid = e === game.player ? game.net.pid : e.pid, b = pid ? F.bobs.get(pid) : null;
    e._fishBite = !!(b && game.worldTime >= b.bite && game.worldTime <= b.until);
  }
}

// rod tip of a player (cosmetic): the rod is held in the hand on the screen's side toward the bobber (a side view) or
// to the right (front / back), its tip ~1.25 tiles up
function tipOf(game, e, b) {
  const rot = game.cam.rot || 0, rc = Math.cos(rot), rs = Math.sin(rot);
  const dx = b.x - e.x, dy = b.y - e.y, vx = rc * dx + rs * dy, vy = -rs * dx + rc * dy;
  const side = Math.abs(vx) > Math.abs(vy) ? Math.sign(vx) * 0.5 : vy < 0 ? 0.3 : -0.3;
  return [e.x + rc * side, e.y + rs * side, 1.25 + (e._dh || 0)]; // (_dh: fishing from a pier / bridge deck, decks.js)
}
const anglerEnt = (game, pid) => (pid === game.net.pid ? game.player : game.session?.players?.get?.(pid)?.ent || null);

export function fishingSystem() {
  let hostT = 0, lastBite = false;
  return {
    sync: 'all', // owner: reel in when the angler walks off · host: line timeouts · every peer: bobbers, lines, splashes
    update(game, dt) {
      const F = game.fishing, p = game.player, net = game.net;
      const me = F.bobs.get(net.pid);
      // walked off / changed work: reel the line in (not right after a pull: its answer is on the way)
      if (me && p.work?.it?.kind !== 'fish_cast' && (game.time - (F._castT || 0)) > 0.5 && !(game.time - (F._pullT ?? -9) < 2.5)) { if (!F._stopT || game.time - F._stopT > 1) { F._stopT = game.time; net.request('fish.stop', {}); } }
      anglers(game);
      // the bobber lands: a little splash where it hits the water
      for (const [pid, b] of F.bobs) {
        if (b.landed) continue;
        const e = anglerEnt(game, pid), f0 = flyStart(game, b, e);
        if (game.time >= f0 + FLY(flyDist(b, e))) { b.landed = true; game.juice?.splash?.(b.x, b.y, 0.35); game.audio?.play('arrow_land', { x: b.x, y: b.y, volume: 0.35 }); }
      }
      for (const [pid, r] of F.reels) if (game.time - r.t0 > 0.6) F.reels.delete(pid);
      // the bite: a splash, the sound, a prompt (owner) — every peer sees the bobber go under
      for (const [pid, b] of F.bobs) {
        if (!b.splashed && game.worldTime >= b.bite) {
          b.splashed = true;
          game.juice?.splash?.(b.x, b.y, 0.5);
          game.audio?.play('splash', { x: b.x, y: b.y, volume: pid === net.pid ? 0.9 : 0.5 });
          if (pid === net.pid) game.events.emit('toast', { text: 'Puxe! (E / Usar)', kind: 'good' });
        }
      }
      const bite = !!(me && game.worldTime >= me.bite && game.worldTime <= me.until);
      if (bite !== lastBite) { lastBite = bite; if (game.ctl) game.ctl.nearT = 0; } // (the use button says "Puxar!" at once)
      if (net.auth) { hostT -= dt; if (hostT <= 0) { hostT = 0.25; fishHostTick(game); } }
    },
    collect(game, list, v) {
      const F = game.fishing;
      for (const [pid, b] of F.bobs) {
        if (b.x < v.x0 - 4 || b.x > v.x1 + 4 || b.y < v.y0 - 4 || b.y > v.y1 + 4) continue;
        const e = anglerEnt(game, pid);
        const o = b._d || (b._d = { x: 0, y: 0, draw: null });
        o.x = b.x; o.y = b.y;
        o.draw = (B, A, t) => drawLine(game, B, A, b, e, t);
        list.push(o);
      }
      for (const [pid, r] of F.reels) {
        const e = anglerEnt(game, pid);
        if (!e || r.x < v.x0 - 4 || r.x > v.x1 + 4 || r.y < v.y0 - 4 || r.y > v.y1 + 4) continue;
        const o = r._d || (r._d = { x: 0, y: 0, draw: null });
        o.x = e.x; o.y = e.y + 0.05;
        o.draw = (B, A, t) => drawReel(game, B, A, r, e, t);
        list.push(o);
      }
    },
  };
}
// the rod tip of an angler: where its rig drew it this frame (art/compose.js), else a guess beside it
function tipAt(game, e, b) {
  const r = e._rodTip;
  if (r && game.time - r[3] < 0.12) return r;
  return tipOf(game, e, b);
}
// one sagging line from (x0, y0, h0) to (x1, y1, h1) in N straight pieces (screen-space angles: a turned camera)
function line(B, s, rc, rs, x0, y0, h0, x1, y1, h1, sag, N = 9) {
  let px = x0, py = y0, ph = h0;
  for (let i = 1; i <= N; i++) {
    const u = i / N, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, h = h0 + (h1 - h0) * u - Math.sin(u * Math.PI) * sag;
    const dx = x - px, dy = y - py, vx = rc * dx + rs * dy, vy = -rs * dx + rc * dy - (h - ph), len = Math.hypot(vx, vy);
    if (len > 1e-4) B.main.add(s, (x + px) / 2, (y + py) / 2, len / s.w * 1.04, 0.014 / s.h, 0.93, 0.93, 0.88, 0.8, 0, Math.atan2(vy, vx), 0, 1, 0, (h + ph) / 2);
    px = x; py = y; ph = h;
  }
}
// a line just pulled: the bobber (and the catch) flies back out of the water to the rod tip
function drawReel(game, B, A, r, e, t) {
  if (e.dead || !A.has('fx_solid')) return;
  const u = Math.min(1, (game.time - r.t0) / 0.45);
  if (u >= 1) return;
  const rot = game.cam.rot || 0, rc = Math.cos(rot), rs = Math.sin(rot);
  const [tx, ty, th] = tipAt(game, e, r);
  const k = 1 - (1 - u) * (1 - u), x = r.x + (tx - r.x) * k, y = r.y + (ty - r.y) * k;
  const h = 0.04 + (th - 0.35 - 0.04) * k + Math.sin(k * Math.PI) * 0.6;
  line(B, A.get('fx_solid'), rc, rs, tx, ty, th, x, y, h + 0.05, 0.02, 5);
  if (A.has('fx_bobber')) B.main.add(A.get('fx_bobber'), x, y, 0.85, 0.85, 1, 1, 1, 1, 0, 0, 0, 1, 0, h);
  if (r.ok && A.has('item_fish_raw')) B.main.add(A.get('item_fish_raw'), x, y, 0.55, 0.55, 1, 1, 1, 1, 0, 1.2 + Math.sin(t * 30) * 0.3, 0, 1, 0, h - 0.3);
}

// the bobber: flying out from the rod tip in an arc (the cast), then on the water (bobbing; under at the bite,
// twitching), and the line from the rod tip to it, sagging
function drawLine(game, B, A, b, e, t) {
  const rot = game.cam.rot || 0, rc = Math.cos(rot), rs = Math.sin(rot);
  const wt = game.worldTime, bite = wt >= b.bite && wt <= b.until;
  const f0 = flyStart(game, b, e), fd = FLY(flyDist(b, e)), u = (game.time - f0) / fd;
  if (u < 1) {
    if (!e || e.dead || !A.has('fx_solid')) return;
    const [tx, ty, th] = tipAt(game, e, b);
    if (u < 0) { if (A.has('fx_bobber')) B.main.add(A.get('fx_bobber'), tx, ty, 0.7, 0.7, 1, 1, 1, 1, 0, 0, 0, 1, 0, th - 0.22); return; } // (on the rod while it swings)
    const d = Math.hypot(b.x - tx, b.y - ty), x = tx + (b.x - tx) * u, y = ty + (b.y - ty) * u;
    const h = th + (0.04 - th) * u + 4 * u * (1 - u) * (0.35 + d * 0.07);
    line(B, A.get('fx_solid'), rc, rs, tx, ty, th, x, y, h + 0.05, 0.03 * u, 7);
    if (A.has('fx_bobber')) B.main.add(A.get('fx_bobber'), x, y, 0.8, 0.8, 1, 1, 1, 1, 0, u * 9, 0, 1, 0, h);
    return;
  }
  const bob = bite ? -0.1 + Math.sin(t * 30) * 0.03 : Math.sin(t * 2.4) * 0.025;
  const bh = 0.04 + bob;
  if (A.has('fx_bobber')) B.main.add(A.get('fx_bobber'), b.x, b.y, 0.85, bite ? 0.55 : 0.85, 1, 1, 1, bite ? 0.75 : 1, 0, 0, 0, 1, 0, bh);
  if (A.has('fx_ring')) {
    const k = (t * 0.7) % 1;
    B.ground.add(A.get('fx_ring'), b.x, b.y, 0.4 + k * (bite ? 1.4 : 0.7), (0.4 + k * (bite ? 1.4 : 0.7)) * 0.6, 0.85, 0.95, 1, (1 - k) * (bite ? 0.7 : 0.35));
  }
  if (!e || e.dead || !A.has('fx_solid')) return;
  const [tx, ty, th] = tipAt(game, e, b);
  const d = Math.hypot(b.x - tx, b.y - ty), sag = bite ? 0.05 : Math.min(0.6, 0.15 + d * 0.06);
  line(B, A.get('fx_solid'), rc, rs, tx, ty, th, b.x, b.y, bh + 0.05, sag);
}
