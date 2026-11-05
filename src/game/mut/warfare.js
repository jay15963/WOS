// War near the players (game/warfare.js, docs/REINOS.md §14): the shared part.
//   game.warfare.forces: Map id → the public row of a force (op war.force: [id, tag, k, kind, sid|−1, foe|0, phase, n, n0,
//     lv, x, y, fx, fy]) — every peer knows what fights where (the HUD, the rule that lets a player hit a soldier:
//     game/soldier.js playerMayHurt). The host keeps the rest of the force (its soldiers, the siege plan) to itself.
//   o.realm = k on the structures of an army (its engines, its camp: op war.mark) — the siege rules (siegeCanDamage) and
//     the colours of its tents and banners read it.
// Ops: war.force {row} · war.end {id} · war.mark {ids, k} · war.cry {id, k, text, x, y} (a shout: a toast near it, nothing
// kept) · war.rep {u, k, d, k2, d2} (the reputation a player earned helping a side; `by` / `toast` for its owner).
// Snapshot / save `war: { f: [rows], r: [[structId, k]] }`, digest part `war`.

import { defineOp } from '../../net/registry.js';
import { addRep } from './eco.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v, d = 0) => (Number.isInteger(v) ? v : d);
const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');
const W_ = (game) => game.warfare || null;

// a public row (validated) → the force record of every peer (the host's whole force keeps its private fields)
function applyRow(game, r) {
  const W = W_(game);
  if (!W || !Array.isArray(r) || typeof r[0] !== 'string') return null;
  const id = str(r[0]);
  let F = W.forces.get(id);
  if (!F && game.net.auth) return null; // (the host's forces are made by game/warfare.js: a late row of one that ended is not one)
  if (!F) { F = { id, live: null }; W.forces.set(id, F); }
  const row = [id, str(r[1], 12), int(r[2]), str(r[3], 12), int(r[4], -1), typeof r[5] === 'string' ? str(r[5]) : 0, str(r[6], 12), int(r[7]), int(r[8]), int(r[9], 1),
    num(r[10]), num(r[11]), num(r[12]), num(r[13])];
  F.pub = row;
  F.tag = row[1]; F.k = row[2]; F.kind = row[3]; F.sid = row[4] >= 0 ? row[4] : null; F.foe = row[5] || null;
  if (!game.net.auth) { F.phase = row[6]; F.n = row[7]; F.n0 = row[8]; F.lv = row[9]; F.x = row[10]; F.y = row[11]; F.fx = row[12]; F.fy = row[13]; }
  if (F.tag) W.tagOf.set(F.tag, id);
  return F;
}

defineOp('war.force', {
  doc: 'A force of a kingdom near the players appears / changes (its public row: kind siege | battle | march, kingdom, target settlement, phase, soldiers alive / at the start, level, where, facing).',
  args: { row: '[id, tag, k, kind, sid|-1, foe|0, phase, n, n0, lv, x, y, fx, fy]' },
  apply(game, a) {
    const F = applyRow(game, a.row);
    if (F) game.events?.emit('warforce', { id: F.id, phase: a.row[6] });
  },
});

defineOp('war.end', {
  doc: 'A force is gone (its battle / siege is over, or it went back to being numbers far from the players).',
  args: { id: 'force id', quiet: '0|1?' },
  apply(game, a) {
    const W = W_(game), id = str(a.id);
    if (!W) return;
    const F = W.forces.get(id);
    if (F?.tag) W.tagOf.delete(F.tag);
    W.forces.delete(id);
    game.events?.emit('warend', { id, quiet: !!a.quiet });
  },
});

defineOp('war.mark', {
  doc: 'Structures of an army (its siege engines, its camp: tents, banners, fires) belong to kingdom k (o.realm).',
  args: { ids: '[structId]', k: 'kingdom' },
  apply(game, a) {
    const k = int(a.k, -1);
    if (k < 0) return;
    const c = game.warfare?.crest?.(k);
    for (const id of Array.isArray(a.ids) ? a.ids : []) { const o = game.world.objById.get(id); if (o && o.building) { o.realm = k; if (c) { o._kc = c.f; o._kc2 = c.m; } } } // (_kc: the colours of its tents / banners, cosmetic)
  },
});

defineOp('war.cry', {
  doc: 'A shout of an army (the general rallying, a breach, the gate falling, a place taken): a toast for the players near it. Nothing kept.',
  args: { id: 'force id', k: 'kingdom', text: 'string', x: 'number', y: 'number' },
  apply(game, a) { game.events?.emit('warcry', { id: a.id, k: int(a.k), text: str(a.text, 140), x: num(a.x), y: num(a.y) }); }, // (game/warfare.js warfareFxSystem: a toast for a player near it)
});

defineOp('war.rep', {
  doc: 'A player (uid) fought a kingdom\'s soldiers that attack a place / another army: reputation d with kingdom k (the side helped) and d2 with k2 (the soldiers\'). The host gathers it (a few seconds) — `toast` tells the player.',
  args: { u: 'uid', k: 'kingdom|-1', d: 'int', k2: 'kingdom', d2: 'int', by: 'pid?', toast: 'string?' },
  apply(game, a) {
    const u = str(a.u);
    if (!u || !game.eco) return;
    if (int(a.k, -1) >= 0 && int(a.d)) addRep(game, u, int(a.k), int(a.d));
    if (int(a.k2, -1) >= 0 && int(a.d2)) addRep(game, u, int(a.k2), int(a.d2));
  },
});

// ---------- rows (snapshot / save / digest) ----------
// forces: their public rows (a debug force of the host is saved with its losses: a load takes it up again; an army of 3a
// is 3a's to save) · marks: [structId, k] of every structure of an army
export function warRows(game, save = false) {
  const W = W_(game);
  if (!W) return null;
  const f = [];
  for (const F of W.forces.values()) {
    if (!F.pub) continue;
    if (save && (F.army || !F.units)) continue;
    f.push(save ? F.pub.concat([F.sg ? [F.sg.sid, Math.round(F.sg.at[0]), Math.round(F.sg.at[1])] : 0, F.eng || 0]) : F.pub.slice());
  }
  const r = game.build.structures.filter((o) => o.realm != null && !o.removed).map((o) => [o.id, o.realm]);
  return f.length || r.length ? { f, r } : null;
}
export function applyWarRows(game, d, mode) {
  const W = W_(game);
  if (!W) return;
  const reconcile = mode === 'net';
  const R = new Map((d && Array.isArray(d.r) ? d.r : []).filter((q) => Array.isArray(q) && typeof q[0] === 'string').map((q) => [q[0], int(q[1], -1)]));
  for (const o of game.build.structures) {
    if (R.has(o.id)) { o.realm = R.get(o.id); const c = W.crest?.(o.realm); if (c) { o._kc = c.f; o._kc2 = c.m; } }
    else if (reconcile && o.realm != null) delete o.realm;
  }
  if (mode === 'load') { W.saved = d && Array.isArray(d.f) ? d.f.filter(Array.isArray) : []; return; } // (the host takes them up again: warfare.js)
  if (reconcile && !game.net.auth) {
    const ids = new Set();
    for (const r of d && Array.isArray(d.f) ? d.f : []) { const F = applyRow(game, r); if (F) ids.add(F.id); }
    for (const id of [...W.forces.keys()]) if (!ids.has(id)) { const F = W.forces.get(id); if (F?.tag) W.tagOf.delete(F.tag); W.forces.delete(id); }
  }
}
export function warDigestRows(game, OK = () => true) {
  const W = W_(game);
  if (!W) return [];
  const out = [];
  for (const F of W.forces.values()) if (F.pub) out.push(['f:' + F.id, F.pub[2], F.pub[3], F.pub[4], F.pub[6], F.pub[7], F.pub[8], Math.round(F.pub[10]), Math.round(F.pub[11])]);
  for (const o of game.build.structures) if (o.realm != null && !o.removed && OK(o.tx + 0.5, o.ty + 0.5)) out.push(['r:' + o.id, o.realm]);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
