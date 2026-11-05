// The player in the army (docs/REINOS.md §15, game/army.js): every shared change. Per player (uid, like the economy's
// record — game/eco.js), decided on the host, replicated to every peer:
//   game.army.en   Map uid → { sid (the place whose army: its garrison 'g<sid>'), k (the kingdom), rank (content/army.js
//                  ARMY.ranks), svc (service points), since (day enlisted), paid (the last economy day paid), kills,
//                  a (the 3a army it follows now: 'a<n>' | ''), kd / kn (the day and the kills of that day that counted) }
//   game.army.des  Map uid → [k, until day]  (a deserter: that kingdom does not take it back before that day)
// Op: army.rec {u, r (the whole record | 0 = out of the army), ban, ev, by, give, toast} — joining, leaving, the pay,
// service, a bonus, a promotion, another place's army, the army it follows. Intents: army.join · army.leave.
// Rows (snapshot / save `army`, digest part `army`): armyRows / applyArmyRows / armyDigestRows.

import { defineIntent, defineOp } from '../../net/registry.js';
import { ARMY, rankOfSvc } from '../content/army.js';
import { joinReason, inAction, newRecord, desertToast, uidFor, travelWhy, travelSpot } from '../army.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v, d = 0) => Math.floor(num(v, d));
const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');

export function armyState(game) {
  const A = game.army || (game.army = {});
  if (!A.en) Object.assign(A, { en: new Map(), des: new Map(), v: 0 });
  return A;
}
const realmOf = (game) => game.towns?.realm || null;
// a record from its wire / save form (validated)
export function cleanRec(game, o) {
  if (!o || typeof o !== 'object') return null;
  const S = realmOf(game)?.settlements, sid = int(o.sid, -1);
  if (S && !S[sid]) return null;
  const svc = Math.max(0, int(o.svc));
  return {
    sid, k: int(o.k, -1), rank: Math.max(0, Math.min(ARMY.ranks.length - 1, int(o.rank, rankOfSvc(svc)))), svc, since: int(o.since), paid: int(o.paid, -1),
    kills: Math.max(0, int(o.kills)), a: str(o.a, 14), kd: int(o.kd, -1), kn: Math.max(0, int(o.kn)),
  };
}
export const recRow = (u, r) => [u, r.sid, r.k, r.rank, r.svc, r.since, r.paid, r.kills, r.a, r.kd, r.kn];
const rowRec = (row) => ({ sid: row[1], k: row[2], rank: row[3], svc: row[4], since: row[5], paid: row[6], kills: row[7], a: row[8], kd: row[9], kn: row[10] });

// ---------- rows (snapshot / save / digest) ----------
export function armyRows(game) {
  const A = game.army;
  if (!A?.en || (!A.en.size && !A.des.size)) return null;
  return {
    en: [...A.en].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([u, r]) => recRow(u, r)),
    des: [...A.des].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([u, d]) => [u, d[0], d[1]]),
  };
}
export function applyArmyRows(game, d, reconcile) {
  const A = armyState(game);
  if (!d || typeof d !== 'object') { if (reconcile) { A.en.clear(); A.des.clear(); A.v++; game.events?.emit('army', { type: 'sync' }); } return; }
  A.en.clear();
  for (const row of Array.isArray(d.en) ? d.en : []) { if (!Array.isArray(row) || typeof row[0] !== 'string') continue; const r = cleanRec(game, rowRec(row)); if (r) A.en.set(row[0].slice(0, 40), r); }
  A.des.clear();
  for (const row of Array.isArray(d.des) ? d.des : []) if (Array.isArray(row) && typeof row[0] === 'string') A.des.set(row[0].slice(0, 40), [int(row[1], -1), int(row[2])]);
  A.v++;
  game.events?.emit('army', { type: 'sync' });
}
export function armyDigestRows(game) {
  const D = armyRows(game);
  if (!D) return [];
  return [...D.en.map((r) => ['e:' + r[0], JSON.stringify(r)]), ...D.des.map((r) => ['d:' + r[0], r[1], r[2]])];
}

// ---------- the op ----------
const EVENTS = ['join', 'leave', 'desert', 'member', 'fall', 'move', 'pay', 'svc', 'bonus', 'assign', 'debug'];
defineOp('army.rec', {
  doc: 'A player\'s place in an army (host): enlisted / changed (r = the whole record: place, kingdom, rank, service, last day paid, kills, the army it follows) or out of it (r = 0); `ban` = [k, until day] a deserter (0 clears); ev = join | leave | desert | member | fall | move | pay | svc | bonus | assign; `give` the pay / a bonus (coins) to `by`.',
  args: { u: 'uid', r: 'record | 0', ban: '[k, day] | 0?', ev: 'string', by: 'pid?', give: '{coin: n}?', toast: 'string?', toastKind: 'string?' },
  apply(game, a) {
    const A = armyState(game), u = str(a.u);
    if (!u) return;
    const old = A.en.get(u) || null;
    if (a.r && typeof a.r === 'object') { const r = cleanRec(game, a.r); if (r) A.en.set(u, r); } else A.en.delete(u);
    if (Array.isArray(a.ban)) A.des.set(u, [int(a.ban[0], -1), int(a.ban[1])]);
    else if (a.ban === 0) A.des.delete(u);
    A.v++;
    game.events?.emit('army', { type: EVENTS.includes(a.ev) ? a.ev : 'svc', u, r: A.en.get(u) || null, old, give: a.give?.coin | 0 });
  },
});

// ---------- the intents ----------
defineIntent('army.join', {
  doc: 'Enlist in the army of the place whose mural the actor stands at: a member of its kingdom with enough reputation there (village: Conhecido; castle / city: Respeitado), not serving in another army, not a recent deserter of that kingdom.',
  args: { sid: 'int' },
  run(game, a, actor, net) {
    const u = uidFor(game, actor.pid);
    if (!u) return 'Aguarde um instante: o reino ainda não conhece você';
    const sid = int(a.sid, -1), why = joinReason(game, u, sid, actor.ent);
    if (why) return why;
    const r = newRecord(game, u, sid), s = realmOf(game).settlements[sid];
    net.emit('army.rec', { u, r, ban: 0, ev: 'join', by: actor.pid, toastKind: 'good',
      toast: `Você se alistou ${s.kind === 'village' ? 'na milícia' : s.kind === 'castle' ? 'na guarnição' : 'no exército'} de ${s.name} como ${ARMY.ranks[0].name}: siga as ordens do general` });
  },
});

// "Ir até o exército" (owner's decision, docs/REINOS.md §15): no shared state changes — the host checks and answers the spot;
// the owner moves its own avatar there (ui/armyHud.js), no time skipped
defineIntent('army.travel', {
  doc: 'An enlisted player in a place of its kingdom travels to the army it follows (beside the column on the march / at the gathering, at the camp of a siege): the host checks (not near enemies, not in a fight, not on a siege engine, far from the army) and answers { x, y, label }; the owner moves itself.',
  args: {},
  run(game, a, actor) {
    const u = uidFor(game, actor.pid), r = u ? armyState(game).en.get(u) : null;
    const why = travelWhy(game, r, actor.ent, actor.pid);
    if (why) return why;
    const to = travelSpot(game, r);
    return { x: Math.round(to.x * 100) / 100, y: Math.round(to.y * 100) / 100, label: String(to.label).slice(0, 60) };
  },
});

defineIntent('army.leave', {
  doc: 'Leave the army the actor serves in. While that army is in action (a battle, a siege — its own or of its home) it is desertion: reputation lost with the kingdom and no going back for a while.',
  args: {},
  run(game, a, actor, net) {
    const u = uidFor(game, actor.pid), A = armyState(game), r = u ? A.en.get(u) : null;
    if (!r) return 'Você não está em nenhum exército';
    const s = realmOf(game).settlements[r.sid];
    if (inAction(game, r)) {
      const until = (game.eco?.day >= 0 ? game.eco.day : game.env.dayIndex | 0) + ARMY.desert.banDays;
      net.emit('army.rec', { u, r: 0, ban: [r.k, until], ev: 'desert', by: actor.pid, toastKind: 'warn', toast: desertToast(game, r, until) });
      net.emit('eco.rep', { u, k: r.k, d: ARMY.desert.rep });
      return;
    }
    net.emit('army.rec', { u, r: 0, ev: 'leave', by: actor.pid, toastKind: 'info', toast: `Você deu baixa ${s?.kind === 'village' ? 'da milícia' : 'do exército'} de ${s?.name || ''}: a reputação fica com você` });
  },
});
