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
    F._castT = game.time;
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
    return null;
  },
  finish: () => true,
});

export function installFishing(game) {
  game.fishing = {
    bobs: new Map(), host: new Map(), pending: false,
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
      // walked off / changed work: reel the line in
      if (me && p.work?.it?.kind !== 'fish_cast' && (game.time - (F._castT || 0)) > 0.5) { if (!F._stopT || game.time - F._stopT > 1) { F._stopT = game.time; net.request('fish.stop', {}); } }
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
    },
  };
}

// the bobber on the water (bobbing; under at the bite, twitching) and the line from the rod tip, sagging
function drawLine(game, B, A, b, e, t) {
  const rot = game.cam.rot || 0, rc = Math.cos(rot), rs = Math.sin(rot);
  const wt = game.worldTime, bite = wt >= b.bite && wt <= b.until;
  const land = Math.min(1, (game.time - b.t0) / 0.35);
  const bob = bite ? -0.1 + Math.sin(t * 30) * 0.03 : Math.sin(t * 2.4) * 0.025;
  const bh = 0.04 + bob;
  if (A.has('fx_bobber')) B.main.add(A.get('fx_bobber'), b.x, b.y, 0.85, bite ? 0.55 : 0.85, 1, 1, 1, bite ? 0.75 : 1, 0, 0, 0, 1, 0, bh);
  if (A.has('fx_ring')) {
    const k = (t * 0.7) % 1;
    B.ground.add(A.get('fx_ring'), b.x, b.y, 0.4 + k * (bite ? 1.4 : 0.7), (0.4 + k * (bite ? 1.4 : 0.7)) * 0.6, 0.85, 0.95, 1, (1 - k) * (bite ? 0.7 : 0.35));
  }
  if (!e || e.dead || !A.has('fx_solid')) return;
  const s = A.get('fx_solid');
  const [tx, ty, th] = tipOf(game, e, b);
  const d = Math.hypot(b.x - tx, b.y - ty), sag = bite ? 0.05 : Math.min(0.6, 0.15 + d * 0.06);
  const N = 9;
  let px = tx, py = ty, ph = th;
  for (let i = 1; i <= N; i++) {
    const u = (i / N) * land;
    const x = tx + (b.x - tx) * u, y = ty + (b.y - ty) * u, h = th + (bh + 0.05 - th) * u - Math.sin(u * Math.PI) * sag * u;
    const dx = x - px, dy = y - py, vx = rc * dx + rs * dy, vy = -rs * dx + rc * dy - (h - ph), len = Math.hypot(vx, vy);
    if (len > 1e-4) B.main.add(s, (x + px) / 2, (y + py) / 2, len / s.w * 1.04, 0.014 / s.h, 0.93, 0.93, 0.88, 0.8, 0, Math.atan2(vy, vx), 0, 1, 0, (h + ph) / 2);
    px = x; py = y; ph = h;
  }
}
