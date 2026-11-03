// Fishing with a rod (docs/LIVESTOCK.md, src/game/fishing.js). The angler's client casts at a water point; the HOST
// decides when a fish bites (a real fish swims to the bobber when one is near: its brain follows `m.hooked`) and judges
// the pull against its own clock: in the bite window the catch is good (2-3 raw fish, more than a long shot / spear,
// which gives 1: livestock.js), too early / too late the fish gets away. A session is transient (seconds): every peer
// keeps the bobbers it was told about (game.fishing.bobs) only to draw them — never saved, never in the digest.
// Intents: fish.cast · fish.pull · fish.stop. Ops: fish.bob (a bobber in the water, its bite time) · fish.end.

import { defineIntent, defineOp } from '../../net/registry.js';
import { FISH } from '../content/livestock.js';
import { killMob } from '../combat.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const WHY = {
  early: 'Cedo demais: o peixe fugiu. Espere a boia afundar.',
  late: 'O peixe escapou: puxe assim que a boia afundar.',
  far: 'A linha arrebentou: você se afastou demais.',
};

// host: the session of player pid (game.fishing.host: pid → { x, y, bite, until, fish })
const sessions = (game) => game.fishing?.host || null;

defineIntent('fish.cast', {
  doc: 'Cast the line at water point (x, y) (the actor has a rod: owner state, trusted); the host picks the bite time and a fish near the bobber.',
  args: { x: 'number', y: 'number' },
  run(game, a, actor, net) {
    const S = sessions(game), e = actor.ent, w = game.world;
    if (!S || !e || e.dead) return 'inválido';
    const x = num(a.x, NaN), y = num(a.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'inválido';
    const d = Math.hypot(x - e.x, y - e.y);
    if (d > FISH.castMax + 1.5) return 'Longe demais';
    if (!w.liquidAt(Math.floor(x), Math.floor(y))) return w.frozen && w.waterAt(Math.floor(x), Math.floor(y)) ? 'A água está congelada' : 'Lance a linha na água';
    // the nearest free fish within reach of the bobber swims to it; more fish around → a quicker bite
    let best = null, bd = FISH.near, n = 0;
    for (const m of game.entities) {
      if (!m.water || m.dead || m.proxy || m.hooked) continue;
      const dd = Math.hypot(m.x - x, m.y - y);
      if (dd > FISH.near) continue;
      n++;
      if (dd < bd) { bd = dd; best = m; }
    }
    const [w0, w1] = best ? FISH.wait : FISH.waitNone;
    const wait = (w0 + net.roll() * (w1 - w0)) * (n > 2 ? 0.75 : 1);
    const bite = r2(game.worldTime + wait), until = r2(bite + FISH.window);
    const old = S.get(actor.pid);
    if (old?.fish) old.fish.hooked = null;
    if (best) best.hooked = actor.pid;
    S.set(actor.pid, { x, y, bite, until, fish: best });
    net.emit('fish.bob', { pid: actor.pid, x: r2(x), y: r2(y), bite, until, now: r2(game.worldTime) });
  },
});

defineIntent('fish.pull', {
  doc: 'Pull the line: in the bite window (host clock, with a little network slack) the catch is good; early / late the fish escapes.',
  args: {},
  run(game, a, actor, net) {
    const S = sessions(game), s = S?.get(actor.pid);
    if (!s) return 'Sem linha na água';
    const t = game.worldTime;
    const free = () => { if (s.fish) { s.fish.hooked = null; s.fish._scare = { x: s.x, y: s.y, t: game.worldTime }; } S.delete(actor.pid); };
    if (t < s.bite - FISH.slack) { free(); net.emit('fish.end', { pid: actor.pid, x: r2(s.x), y: r2(s.y), why: 'early', by: actor.pid, toast: WHY.early, toastKind: 'info' }); return; }
    if (t > s.until + FISH.slack) { free(); net.emit('fish.end', { pid: actor.pid, x: r2(s.x), y: r2(s.y), why: 'late', by: actor.pid, toast: WHY.late, toastKind: 'info' }); return; }
    const [lo, hi] = FISH.rodCatch;
    const n = lo + Math.floor(net.roll() * (hi - lo + 1));
    S.delete(actor.pid);
    if (s.fish && !s.fish.dead) { s.fish.hooked = null; killMob(game, s.fish, null); } // (the fish that bit comes out of the water; its school refills)
    net.emit('fish.end', { pid: actor.pid, x: r2(s.x), y: r2(s.y), ok: 1, by: actor.pid, give: { fish_raw: n }, toast: n > 1 ? `Você pescou ${n} peixes!` : 'Você pescou um peixe!', xp: 2 });
  },
});

defineIntent('fish.stop', {
  doc: 'Reel the line in without pulling (the angler walked away / put the rod down).',
  args: {},
  run(game, a, actor, net) {
    const S = sessions(game), s = S?.get(actor.pid);
    if (!s) return;
    if (s.fish) s.fish.hooked = null;
    S.delete(actor.pid);
    net.emit('fish.end', { pid: actor.pid, x: r2(s.x), y: r2(s.y), why: 'stop' });
  },
});

// host clock: lines left past their window end on their own, an angler far from its bobber loses the line
export function fishHostTick(game) {
  const S = sessions(game);
  if (!S || !S.size) return;
  const t = game.worldTime;
  for (const [pid, s] of [...S]) {
    const e = game.fishing.anglerOf(pid);
    const far = !e || e.dead || e.gone || Math.hypot(e.x - s.x, e.y - s.y) > FISH.castMax + 3;
    if (!far && t <= s.until + FISH.slack + 1) continue;
    if (s.fish) { s.fish.hooked = null; s.fish._scare = { x: s.x, y: s.y, t }; }
    S.delete(pid);
    game.net.emit('fish.end', { pid, x: r2(s.x), y: r2(s.y), why: far ? 'far' : 'late', by: pid, toast: far ? WHY.far : WHY.late, toastKind: 'info' });
  }
}

defineOp('fish.bob', {
  doc: "A player's bobber lands at (x, y); the fish bites at host time `bite` and lets go at `until` (every peer draws it).",
  args: { pid: 'pid', x: 'number', y: 'number', bite: 'worldTime', until: 'worldTime', now: 'host worldTime when cast' },
  apply(game, a) {
    const F = game.fishing;
    if (!F) return;
    // times in this peer's clock (a guest's worldTime may run up to ~2 s off the host's): bite / until from the host's "now"
    const off = num(a.now, game.worldTime) - game.worldTime;
    F.bobs.set(a.pid, { x: num(a.x), y: num(a.y), bite: num(a.bite) - off, until: num(a.until) - off, t0: game.time, splashed: false });
    game.juice?.splash?.(num(a.x), num(a.y), 0.35);
    game.audio?.play('arrow_land', { x: a.x, y: a.y, volume: 0.35 });
  },
});

defineOp('fish.end', {
  doc: 'A line comes out of the water: a catch (ok, give: raw fish to `by`) or the fish got away (why: early | late | far | stop).',
  args: { pid: 'pid', x: 'number', y: 'number', ok: '0|1', why: "'early'|'late'|'far'|'stop'?", by: 'pid?', give: '{fish_raw: n}?', toast: 'string?', toastKind: 'string?', xp: 'number?' },
  apply(game, a) {
    const F = game.fishing;
    if (!F) return;
    F.bobs.delete(a.pid);
    F.ended(a);
    if (a.why !== 'stop') game.juice?.splash?.(num(a.x), num(a.y), a.ok ? 0.8 : 0.4);
    if (a.ok) game.audio?.play('pickup', { x: a.x, y: a.y });
  },
});
