// The settlements' people (game/people.js, docs/REINOS.md "Fase 2 — moradores e guardas"): the shared part.
// Who each person is comes from the seed on every peer; what changes is shared state here:
//   game.towns.dead: Map '<sid>.<i>' → worldTime of the death (a person of settlement sid killed by monsters; the host
//     brings one back after some days: op town.pop dead 0). Snapshot / save rows `tpop: [[sid, i, at]]`, digest part `towns`.
//   game.towns.prog: the world's progress (the highest player level ever seen in this world, docs/REINOS.md §7b) — it only
//     goes up (op town.prog); the kingdoms' people level with it. Snapshot / save field `wprog`, digest part `towns`.
// Ops: town.pop {sid, i, dead, at} · town.prog {lv} · town.alarm {sid, on} (the bell: monsters in the town land — every
// peer rings it near the place and tells its player; nothing kept).

import { defineOp } from '../../net/registry.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const T = (game) => game.towns || (game.towns = { state: new Map() });
export const deadMap = (game) => T(game).dead || (T(game).dead = new Map());

// ---------- rows (snapshot / save / digest) ----------
export function popRows(game) {
  const out = [];
  for (const [k, at] of deadMap(game)) { const [sid, i] = k.split('.').map(Number); out.push([sid, i, Math.round(at)]); }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export function applyPopRows(game, rows, reconcile) {
  const D = deadMap(game);
  if (reconcile) D.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || !Number.isInteger(r[1])) continue;
    D.set(`${r[0]}.${r[1]}`, num(r[2]));
  }
  T(game).popV = (T(game).popV || 0) + 1;
}
export function applyProg(game, lv, reconcile) {
  const v = Math.max(1, Math.min(60, num(lv, 1) | 0));
  if (reconcile) T(game).prog = v; else T(game).prog = Math.max(T(game).prog || 1, v);
}
// digest rows of this part (towns)
export const peopleDigestRows = (game) => popRows(game).map((r) => ['pop:' + r[0] + '.' + r[1], r[2]]).concat([['prog', T(game).prog || 1]]);

// ---------- ops ----------
defineOp('town.pop', {
  doc: "A person of a settlement died (dead 1, at: worldTime) or was replaced (dead 0) — the host decides; who it is comes from the seed.",
  args: { sid: 'settlement id', i: 'person index', dead: '0|1', at: 'worldTime?', toast: 'string?' },
  apply(game, a) {
    if (!Number.isInteger(a.sid) || !Number.isInteger(a.i)) return;
    const D = deadMap(game), k = `${a.sid}.${a.i}`;
    if (a.dead) D.set(k, num(a.at, game.worldTime)); else D.delete(k);
    T(game).popV = (T(game).popV || 0) + 1;
    game.events?.emit('townpop', { sid: a.sid, i: a.i, dead: !!a.dead });
  },
});

defineOp('town.prog', {
  doc: "The world's progress: the highest player level seen in this world (only goes up); the kingdoms' people follow it (§7b).",
  args: { lv: 'level' },
  apply(game, a) { applyProg(game, a.lv, false); },
});

defineOp('town.alarm', {
  doc: 'The bell of a settlement: hostile creatures in its town land (on 1) or gone (on 0). Every peer rings it near the place.',
  args: { sid: 'settlement id', on: '0|1' },
  apply(game, a) { if (Number.isInteger(a.sid)) game.events?.emit('townalarm', { sid: a.sid, on: !!a.on }); },
});
