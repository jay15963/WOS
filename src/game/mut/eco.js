// The economy of the kingdoms: every shared change (docs/REINOS.md "Fase 2 — economia", game/eco.js).
// Coins are an inventory item (owner state): the buyer's client takes the coins / goods out of its backpack and sends
// them as the paid part of the intent (refunded on a reject); the host checks the price with the replicated stocks and
// answers with an op whose owner effect `give` hands over the goods / coins.
//
// Ops: eco.start · eco.day · eco.who · eco.trade · eco.member · eco.job · eco.prog · eco.prop · eco.bill · eco.paid · eco.gift
// Intents: eco.hello · trade.buy · trade.sell · realm.join · realm.leave · job.take · job.done · job.drop · prop.buy ·
//          prop.rent · prop.leave · eco.pay · item.give
// Owner message: eco.collect (the day's tax / rent: the owner pays from its backpack, or is warned)
// Rows (snapshot / save `eco`, digest part `eco`): ecoRows / applyEcoRows.

import { defineIntent, defineOp, defineOwn } from '../../net/registry.js';
import { ITEMS } from '../data.js';
import { TOWN } from './structures.js';
import { GOODS, NG, GI, REP, JOB_MAX, PROP, COIN, PARCEL, rankOf, RANKS } from '../content/eco.js';
import {
  ecoState, uidOf, recOf, settlement, kingdomOf, realmOf, dealReason, profileOf, quoteBuy, quoteSell, atMural, boardOf, propById, chargeOf,
  rankInfo, payBills, fmt, entOfPid, playerName, emptyChests,
} from '../eco.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v, d = 0) => Math.floor(num(v, d));
const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');
const E_ = (game) => ecoState(game);
const bump = (game) => { const E = E_(game); E.v = (E.v || 0) + 1; E._avg?.clear(); };
// a player's record (created inside appliers only)
function rec(game, u, name = '') {
  const E = E_(game);
  let r = E.pl.get(u);
  if (!r) { r = { name: str(name, 18) || 'Jogador', k: -1, rep: {}, vol: {}, trep: {}, jobs: [], done: [] }; E.pl.set(u, r); }
  else if (name) r.name = str(name, 18);
  return r;
}
function addRep(game, u, k, d) {
  if (!(k >= 0) || !d) return;
  const r = rec(game, u), before = rankOf(r.rep[k] | 0);
  r.rep[k] = Math.max(-200, (r.rep[k] | 0) + d);
  const after = rankOf(r.rep[k]);
  if (after !== before) game.events?.emit('eco', { type: after > before ? 'rankup' : 'rankdown', u, k, rank: after });
}
const goodsRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && Number.isInteger(r[0]) && Array.isArray(r[1]));
function setStocks(game, rows) {
  const E = E_(game);
  for (const [sid, a] of goodsRows(rows)) { const out = new Int32Array(NG); for (let i = 0; i < NG; i++) out[i] = Math.max(0, int(a[i])); E.mk.set(sid, out); }
}
const cleanEv = (ev) => (Array.isArray(ev) ? ev : []).filter((e) => Array.isArray(e) && e.length >= 4).map((e) => [int(e[0]), int(e[1]), int(e[2]), int(e[3])]).slice(0, 40);
function cleanJob(j) {
  if (!j || typeof j !== 'object' || typeof j.id !== 'string') return null;
  const o = { id: str(j.id), sid: int(j.sid), k: int(j.k, -1), t: str(j.t, 12), day: int(j.day), exp: int(j.exp), n: Math.max(1, int(j.n, 1)), got: Math.max(0, int(j.got)),
    pay: Math.max(0, int(j.pay)), rep: int(j.rep), title: str(j.title, 80), text: str(j.text, 300) };
  if (j.crop) o.crop = str(j.crop, 16);
  if (j.good) o.good = str(j.good, 24);
  if (j.dest != null) o.dest = int(j.dest);
  if (j.night) o.night = 1;
  if (Number.isFinite(j.x)) { o.x = Math.round(j.x * 10) / 10; o.y = Math.round(num(j.y) * 10) / 10; }
  if (Number.isFinite(j.r)) o.r = int(j.r);
  if (j.giver && typeof j.giver === 'object') o.giver = { name: str(j.giver.name, 24), role: str(j.giver.role, 24) };
  return o;
}

// ---------- rows (snapshot / save / digest) ----------
export function ecoRows(game) {
  const E = game.eco;
  if (!E || !E.mk) return null;
  return {
    day: E.day, ev: E.ev.map((e) => e.slice()),
    mk: [...E.mk].sort((a, b) => a[0] - b[0]).map(([sid, a]) => [sid, [...a]]),
    pl: [...E.pl].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([u, r]) => [u, r.name, r.k, { ...r.rep }, { ...r.vol }, { ...r.trep }, r.jobs.map((j) => ({ ...j })), r.done.slice()]),
    pr: [...E.pr].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, r]) => [id, r.u, r.name, r.mode, r.day, r.due, r.warn]),
    st: [...E.st].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, s]) => [id, s]),
    ft: [...(E.feat || [])].sort((a, b) => a[0] - b[0]).map(([sid, f]) => [sid, f]),
  };
}
const obj = (o) => { const out = {}; if (o && typeof o === 'object') for (const k in o) if (/^-?\d+$/.test(k)) out[k] = int(o[k]); return out; };
export function applyEcoRows(game, d, reconcile) {
  const E = ecoState(game);
  if (!d || typeof d !== 'object') { if (reconcile) { E.mk.clear(); E.pl.clear(); E.pr.clear(); E.st.clear(); E.feat.clear(); E.ev = []; E.day = -1; } return; }
  E.day = int(d.day, -1);
  E.feat.clear();
  for (const r of Array.isArray(d.ft) ? d.ft : []) { const f = Array.isArray(r) && cleanFeat(r[1]); if (f && settlement(game, int(r[0]))) E.feat.set(int(r[0]), f); }
  E.ev = cleanEv(d.ev);
  E.mk.clear(); setStocks(game, d.mk);
  E.pl.clear();
  for (const r of Array.isArray(d.pl) ? d.pl : []) {
    if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
    E.pl.set(r[0].slice(0, 40), { name: str(r[1], 18) || 'Jogador', k: int(r[2], -1), rep: obj(r[3]), vol: obj(r[4]), trep: obj(r[5]),
      jobs: (Array.isArray(r[6]) ? r[6] : []).map(cleanJob).filter(Boolean), done: (Array.isArray(r[7]) ? r[7] : []).filter((x) => typeof x === 'string').slice(-60) });
  }
  E.pr.clear();
  for (const r of Array.isArray(d.pr) ? d.pr : []) if (Array.isArray(r) && typeof r[0] === 'string') E.pr.set(r[0], { u: str(r[1]), name: str(r[2], 18), mode: r[3] === 'rent' ? 'rent' : 'own', day: int(r[4]), due: Math.max(0, int(r[5])), warn: Math.max(0, int(r[6])) });
  E.st.clear();
  for (const r of Array.isArray(d.st) ? d.st : []) if (Array.isArray(r) && typeof r[0] === 'string' && Array.isArray(r[1])) E.st.set(r[0], r[1]);
  // the settlements' chests already placed here: their contents as the snapshot says
  for (const o of game.build?.structures || []) if (o.town != null && o.store) { const s = E.st.get(o.id); if (s || o.store.used()) o.store.load(s || []); }
  bump(game);
  game.events?.emit('eco', { type: 'sync' });
}
// digest rows (exact): markets, players, properties, chests
export function ecoDigestRows(game) {
  const R = ecoRows(game);
  if (!R) return [];
  return [['day', R.day, JSON.stringify(R.ev)], ...R.mk.map(([sid, a]) => ['m' + sid, a.join(',')]), ...R.pl.map((r) => ['u:' + r[0], JSON.stringify(r)]),
    ...R.pr.map((r) => ['p:' + r[0], JSON.stringify(r)]), ...R.st.map((r) => ['s:' + r[0], JSON.stringify(r[1])]), ...R.ft.map((r) => ['f' + r[0], JSON.stringify(r[1])])];
}

// ---------- the settlements' chests (a house's chest: its contents live here, loaded or not) ----------
TOWN.storeOf = (game, id) => game.eco?.st.get(id) || null;
TOWN.storeSet = (game, id, slots) => {
  if (typeof id !== 'string' || !/^t\d+\.\d+$/.test(id)) return;
  const E = E_(game);
  if (Array.isArray(slots) && slots.some(Boolean)) E.st.set(id, slots.slice(0, 40)); else E.st.delete(id);
  bump(game);
};

// ---------- ops ----------
defineOp('eco.start', {
  doc: 'The markets open (host, a new world / an old save): the day and every settlement\'s first stocks.',
  args: { day: 'int', mk: '[[sid, [stock × goods]]]' },
  apply(game, a) {
    const E = E_(game);
    E.day = int(a.day);
    setStocks(game, a.mk);
    bump(game);
    game.events?.emit('eco', { type: 'day' });
  },
});

const cleanCounts = (o) => { const out = {}; if (o && typeof o === 'object') for (const k in o) if (/^[a-z_]{2,20}$/.test(k)) out[k] = Math.max(0, Math.min(99, int(o[k]))); return out; };
const cleanFeat = (f) => (f && typeof f === 'object' ? { b: cleanCounts(f.b), crops: cleanCounts(f.crops), pens: cleanCounts(f.pens) } : null);

defineOp('eco.feat', {
  doc: 'The real features of a place (its workshops, fields, pens — from its plan, known to the host once it made the place): every peer prices it the same from now on.',
  args: { sid: 'int', f: '{ b: {building: n}, crops: {good: n}, pens: {species: n} }' },
  apply(game, a) {
    const f = cleanFeat(a.f);
    if (!f || !settlement(game, int(a.sid))) return;
    E_(game).feat.set(int(a.sid), f);
    bump(game);
  },
});

defineOp('eco.day', {
  doc: 'A new economy day (host): every market\'s new stocks (drift toward its balance, spreading, noise) and the market news; the trade reputation caps reset.',
  args: { day: 'int', mk: '[[sid, [stock × goods]]]', ev: '[[sid, good index, mult×100, until day]]' },
  apply(game, a) {
    const E = E_(game);
    E.day = int(a.day);
    setStocks(game, a.mk);
    E.ev = cleanEv(a.ev);
    for (const r of E.pl.values()) r.trep = {};
    bump(game);
    game.events?.emit('eco', { type: 'day', day: E.day });
  },
});

defineOp('eco.who', {
  doc: 'A player is known to the economy: its uid (stable across sessions) and name; the peer whose pid is `by` keeps the uid it was given.',
  args: { u: 'uid', name: 'string', by: 'pid' },
  apply(game, a, ctx) {
    const u = str(a.u);
    if (!u) return;
    rec(game, u, a.name);
    if (ctx.mine) E_(game).me = u; // (a second tab of the same browser: the host answers with another uid)
    bump(game);
  },
});

defineOp('eco.trade', {
  doc: 'A trade at a settlement\'s market: its stock of good g changes by d (− bought, + sold); the trader\'s volume there counts toward its reputation (1 per 60 coins, 10 a day); `give` hands the goods / coins over.',
  args: { sid: 'int', g: 'good index', d: 'int', u: 'uid', coins: 'int', by: 'pid', give: '{item: qty}' },
  apply(game, a) {
    const E = E_(game), m = E.mk.get(int(a.sid)), g = int(a.g, -1);
    if (m && g >= 0 && g < NG) m[g] = Math.max(0, m[g] + int(a.d));
    const s = settlement(game, int(a.sid)), u = str(a.u);
    if (s && u) {
      const r = rec(game, u), k = s.k;
      r.vol[k] = (r.vol[k] | 0) + Math.max(0, int(a.coins));
      while ((r.vol[k] | 0) >= REP.tradeCoins) {
        r.vol[k] -= REP.tradeCoins;
        if ((r.trep[k] | 0) >= REP.tradeDayCap) { r.vol[k] = Math.min(r.vol[k], REP.tradeCoins - 1); break; }
        r.trep[k] = (r.trep[k] | 0) + 1;
        addRep(game, u, k, 1);
      }
    }
    bump(game);
    game.events?.emit('eco', { type: 'trade', sid: int(a.sid), g, u });
  },
});

defineOp('eco.member', {
  doc: 'A player joins a kingdom (k) or leaves it (k = −1: a traveller again).',
  args: { u: 'uid', k: 'int', name: 'string', by: 'pid', toast: 'string?' },
  apply(game, a) {
    const r = rec(game, str(a.u), a.name), k = int(a.k, -1);
    r.k = k >= 0 && kingdomOf(game, k) ? k : -1;
    bump(game);
    game.events?.emit('eco', { type: 'member', u: str(a.u), k: r.k });
  },
});

defineOp('eco.job', {
  doc: 'A player\'s job: taken (add), turned in (done: reputation up), abandoned (drop: −3) or expired (fail: −2). `give` = parcels / the pay.',
  args: { u: 'uid', add: 'job?', done: 'jobId?', drop: 'jobId?', fail: 'jobId?', by: 'pid?', give: '{item: qty}?', toast: 'string?' },
  apply(game, a) {
    const u = str(a.u), r = rec(game, u);
    if (a.add) { const j = cleanJob(a.add); if (j && !r.jobs.some((q) => q.id === j.id)) { j.got = 0; r.jobs.push(j); } }
    for (const [key, d] of [['done', 0], ['drop', REP.abandon], ['fail', REP.fail]]) {
      if (typeof a[key] !== 'string') continue;
      const i = r.jobs.findIndex((q) => q.id === a[key]);
      if (i < 0) continue;
      const j = r.jobs[i];
      r.jobs.splice(i, 1);
      if (key === 'done') { r.done.push(j.id); if (r.done.length > 60) r.done.splice(0, r.done.length - 60); addRep(game, u, j.k, j.rep); }
      else addRep(game, u, j.k, d);
      game.events?.emit('eco', { type: 'job' + key, u, job: j });
    }
    bump(game);
    game.events?.emit('eco', { type: 'jobs', u });
  },
});

defineOp('eco.prog', {
  doc: 'Progress of a player\'s job (host saw the actions: crops harvested on the town\'s fields, rock mined, trees felled, animals hunted, the night\'s dead killed).',
  args: { u: 'uid', id: 'jobId', got: 'int' },
  apply(game, a) {
    const u = str(a.u), j = recOf(game, u)?.jobs.find((q) => q.id === a.id);
    if (!j) return;
    const was = j.got | 0;
    j.got = Math.max(0, Math.min(j.n, int(a.got)));
    bump(game);
    game.events?.emit('eco', { type: 'prog', u, job: j, done: was < j.n && j.got >= j.n });
  },
});

defineOp('eco.prop', {
  doc: 'A property changes hands: bought / rented by u (mode own | rent) or given back to the kingdom (gone: sold back, rent ended, taken for unpaid tax). Its chests are emptied when it goes.',
  args: { id: 'propId', u: 'uid?', name: 'string?', mode: "'own'|'rent'?", day: 'int?', gone: '0|1', why: "'left'?", by: 'pid?', give: '{coin: n}?', toast: 'string?' },
  apply(game, a) {
    const E = E_(game), id = str(a.id), old = E.pr.get(id);
    if (a.gone) {
      E.pr.delete(id);
      emptyChests(game, propById(game, id));
      if (old) game.events?.emit('eco', { type: 'proplost', u: old.u, id, why: str(a.why, 12) });
    } else {
      E.pr.set(id, { u: str(a.u), name: str(a.name, 18), mode: a.mode === 'rent' ? 'rent' : 'own', day: int(a.day), due: 0, warn: 0 });
      game.events?.emit('eco', { type: 'propgot', u: str(a.u), id });
    }
    bump(game);
  },
});

defineOp('eco.bill', {
  doc: 'The day\'s bill of a player (host): each property\'s tax / rent added to what it owes; a debt from the day before counts a day of warning; after 3 the kingdom takes it back (seize, −15 reputation).',
  args: { u: 'uid', list: '[[propId, coins]]', seize: '[propId]' },
  apply(game, a) {
    const E = E_(game), u = str(a.u);
    for (const id of Array.isArray(a.seize) ? a.seize : []) {
      const row = E.pr.get(id);
      if (!row || row.u !== u) continue;
      E.pr.delete(id);
      const pr = propById(game, id);
      emptyChests(game, pr);
      if (pr) addRep(game, u, settlement(game, pr.sid)?.k ?? -1, REP.seized);
      game.events?.emit('eco', { type: 'proplost', u, id, why: 'seized' });
    }
    for (const r of Array.isArray(a.list) ? a.list : []) {
      if (!Array.isArray(r)) continue;
      const row = E.pr.get(r[0]);
      if (!row || row.u !== u) continue;
      if (row.due > 0) row.warn++;
      row.due += Math.max(0, int(r[1]));
    }
    bump(game);
    game.events?.emit('eco', { type: 'bill', u });
  },
});

defineOp('eco.paid', {
  doc: 'A player paid what it owed on some properties (tax / rent): their debt and warnings are cleared.',
  args: { u: 'uid', ids: '[propId]', coins: 'int', by: 'pid', give: '{coin: change}?', toast: 'string?' },
  apply(game, a) {
    const E = E_(game), u = str(a.u);
    for (const id of Array.isArray(a.ids) ? a.ids : []) { const row = E.pr.get(id); if (row && row.u === u) { row.due = 0; row.warn = 0; } }
    bump(game);
    game.events?.emit('eco', { type: 'paid', u, coins: int(a.coins), ids: a.ids });
  },
});

defineOp('eco.gift', {
  doc: 'One player gave items to another (the receiver is `by`: the owner effect `give`).',
  args: { by: 'pid', give: '{item: qty}', from: 'string', toast: 'string' },
  apply(game, a) { game.audio?.play('pickup', {}); void a; },
});

// ---------- authority helpers ----------
function who(game, actor) {
  const u = uidOf(game, actor.pid);
  return u;
}
const SLOW = 'Aguarde um instante: o mercado ainda não conhece você';
function placeCheck(game, actor, sid, u) {
  const s = settlement(game, sid);
  if (!s) return [null, 'Lugar desconhecido'];
  if (game.eco?.day < 0) return [null, 'O mercado ainda está abrindo'];
  if (!atMural(game, s.id, actor.ent)) return [null, `Vá até o mural de ${s.name}`];
  const why = dealReason(game, u, s.k);
  if (why) return [null, why];
  return [s, null];
}

// ---------- intents ----------
defineIntent('eco.hello', {
  doc: 'A guest tells the host its economy identity (uid kept in its browser) and name; the host answers eco.who.',
  args: { uid: 'string', name: 'string' },
  run(game, a, actor, net) {
    if (!realmOf(game)) return;
    const E = E_(game);
    let u = str(a.uid);
    if (!/^u[\w.-]{3,40}$/.test(u)) return 'Identidade inválida';
    // the same browser in two tabs: another uid for this one
    for (const [pid, q] of E.who) if (q === u && pid !== actor.pid && (pid === net.pid || game.session?.players?.get?.(pid)?.synced)) { u = (u + '.' + actor.pid).slice(0, 40); break; }
    E.who.set(actor.pid, u); // sync-ok: host-only pid → uid map
    net.emit('eco.who', { u, name: str(a.name, 18) || 'Jogador', by: actor.pid });
  },
});

defineIntent('trade.buy', {
  doc: 'Buy n of a good at a settlement\'s market (the actor at its mural); `max` coins were taken from the actor (refunded on a reject).',
  args: { sid: 'int', g: 'itemId', n: 'int', max: 'int' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    if (!u) return SLOW;
    const [s, why] = placeCheck(game, actor, int(a.sid), u);
    if (why) return why;
    const gi = GI[a.g], P = profileOf(game, s.id);
    if (gi == null || !P.deals[gi]) return 'Isso não se negocia aqui';
    const n = Math.max(1, Math.min(999, int(a.n, 1)));
    const q = quoteBuy(game, s.id, gi, n, u);
    if (q.n < n) return q.n ? `O mercado só tem ${q.n}` : 'Esgotado aqui';
    const paid = Math.max(0, int(a.max));
    if (q.cost > paid) return `O preço mudou: agora custa ${fmt(q.cost)} moedas`;
    const give = { [a.g]: n };
    if (paid > q.cost) give[COIN] = paid - q.cost;
    net.emit('eco.trade', { sid: s.id, g: gi, d: -n, u, coins: q.cost, by: actor.pid, give });
  },
});

defineIntent('trade.sell', {
  doc: 'Sell n of a good at a settlement\'s market (the items were taken from the actor: refunded on a reject); `min` = the price the actor saw.',
  args: { sid: 'int', g: 'itemId', n: 'int', min: 'int' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    if (!u) return SLOW;
    const [s, why] = placeCheck(game, actor, int(a.sid), u);
    if (why) return why;
    const gi = GI[a.g], P = profileOf(game, s.id);
    if (gi == null || !P.deals[gi]) return 'Isso não se negocia aqui';
    const n = Math.max(1, Math.min(9999, int(a.n, 1)));
    const S0 = game.eco.mk.get(s.id)?.[gi] | 0;
    if (S0 + n > Math.round(P.ref[gi] * 4)) return `O mercado de ${s.name} já está cheio disso (aceita mais ${Math.max(0, Math.round(P.ref[gi] * 4) - S0)})`;
    const q = quoteSell(game, s.id, gi, n, u);
    if (q.gain < Math.max(0, int(a.min))) return `O preço mudou: agora paga ${fmt(q.gain)} moedas`;
    if (q.gain <= 0) return 'Ninguém paga nada por isso aqui';
    net.emit('eco.trade', { sid: s.id, g: gi, d: n, u, coins: q.gain, by: actor.pid, give: { [COIN]: q.gain } });
  },
});

defineIntent('realm.join', {
  doc: 'Join the kingdom of the settlement whose mural the actor stands at (leaves the one it was in).',
  args: { sid: 'int' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    if (!u) return SLOW;
    const s = settlement(game, int(a.sid));
    if (!s) return 'Lugar desconhecido';
    if (!atMural(game, s.id, actor.ent)) return `Vá até o mural de ${s.name}`;
    if (recOf(game, u)?.k === s.k) return 'Você já é deste reino';
    const K = kingdomOf(game, s.k);
    net.emit('eco.member', { u, k: s.k, name: recOf(game, u)?.name || '', by: actor.pid, toast: `Você jurou lealdade ao Reino de ${K.name}`, toastKind: 'good' });
  },
});

defineIntent('realm.leave', {
  doc: 'Leave the kingdom the actor belongs to (a traveller again).',
  args: {},
  run(game, a, actor, net) {
    const u = who(game, actor), r = recOf(game, u);
    if (!r || r.k < 0) return 'Você já é um viajante';
    const K = kingdomOf(game, r.k);
    net.emit('eco.member', { u, k: -1, name: r.name, by: actor.pid, toast: `Você deixou o Reino de ${K?.name || ''}: agora é um viajante`, toastKind: 'info' });
  },
});

defineIntent('job.take', {
  doc: 'Take a job from the board of the settlement whose mural the actor stands at (at most 3 at once); a delivery hands over its parcels.',
  args: { sid: 'int', id: 'jobId' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    if (!u) return SLOW;
    const [s, why] = placeCheck(game, actor, int(a.sid), u);
    if (why) return why;
    const j = boardOf(game, s.id).find((q) => q.id === a.id);
    if (!j) return 'Este trabalho não está mais no mural';
    const r = recOf(game, u);
    if (r?.jobs.some((q) => q.id === j.id)) return 'Você já aceitou este trabalho';
    if (r?.done.includes(j.id)) return 'Você já fez este trabalho';
    if ((r?.jobs.length || 0) >= JOB_MAX) return `No máximo ${JOB_MAX} trabalhos ao mesmo tempo`;
    net.emit('eco.job', { u, add: j, by: actor.pid, give: j.t === 'deliver' ? { [PARCEL]: j.n } : undefined, toast: `Trabalho aceito: ${j.title}`, toastKind: 'info' });
  },
});

defineIntent('job.done', {
  doc: 'Turn a job in at the right mural (delivery: the destination); bring / deliver: `paid` items / parcels were taken from the actor (refunded on a reject).',
  args: { id: 'jobId', paid: 'int?' },
  run(game, a, actor, net) {
    const u = who(game, actor), r = recOf(game, u), j = r?.jobs.find((q) => q.id === a.id);
    if (!j) return 'Trabalho não encontrado';
    const at = j.t === 'deliver' ? j.dest : j.sid, s = settlement(game, at);
    if (!atMural(game, at, actor.ent)) return `Entregue no mural de ${s?.name || '—'}`;
    if (j.t === 'bring' || j.t === 'deliver') { if (int(a.paid) < j.n) return `Faltam ${j.n - int(a.paid)}`; }
    else if ((j.got | 0) < j.n) return `Ainda falta: ${j.got | 0}/${j.n}`;
    net.emit('eco.job', { u, done: j.id, by: actor.pid, give: { [COIN]: j.pay }, toast: `Trabalho concluído: +${fmt(j.pay)} moedas, +${j.rep} de reputação`, toastKind: 'good' });
  },
});

defineIntent('job.drop', {
  doc: 'Abandon one of the actor\'s jobs (−3 reputation with that kingdom).',
  args: { id: 'jobId' },
  run(game, a, actor, net) {
    const u = who(game, actor), j = recOf(game, u)?.jobs.find((q) => q.id === a.id);
    if (!j) return 'Trabalho não encontrado';
    net.emit('eco.job', { u, drop: j.id, by: actor.pid, toast: `Trabalho abandonado (${REP.abandon} de reputação)`, toastKind: 'warn' });
  },
});

defineIntent('prop.buy', {
  doc: 'Buy a house or a plot listed at the mural the actor stands at (`paid` coins taken from the actor; rank Conhecido in that kingdom needed).',
  args: { id: 'propId', paid: 'int' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    if (!u) return SLOW;
    const pr = propById(game, a.id);
    if (!pr || (pr.mode && pr.mode !== 'sale')) return 'Não está à venda';
    const [s, why] = placeCheck(game, actor, pr.sid, u);
    if (why) return why;
    if (game.eco.pr.has(pr.id)) return 'Já foi vendido';
    const ri = rankInfo(game, u, s.k);
    if (ri.i < REP.buyRank) return `Só vende a quem é ${RANKS[REP.buyRank].name} no reino (você: ${ri.name}, ${ri.rep}/${RANKS[REP.buyRank].min})`;
    if (int(a.paid) < pr.price) return `Custa ${fmt(pr.price)} moedas`;
    const name = recOf(game, u)?.name || '';
    net.emit('eco.prop', { id: pr.id, u, name, mode: 'own', day: game.env.dayIndex, by: actor.pid, give: int(a.paid) > pr.price ? { [COIN]: int(a.paid) - pr.price } : undefined,
      toast: pr.bi != null ? `A casa é sua! Portas, baús e camas dela agora são seus` : `O terreno é seu: construa dentro da divisa`, toastKind: 'good' });
  },
});

defineIntent('prop.rent', {
  doc: 'Rent a house listed for rent at the mural the actor stands at (the first day paid now: `paid` coins taken from the actor).',
  args: { id: 'propId', paid: 'int' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    if (!u) return SLOW;
    const pr = propById(game, a.id);
    if (!pr || pr.mode !== 'rent') return 'Não está para alugar';
    const [, why] = placeCheck(game, actor, pr.sid, u);
    if (why) return why;
    if (game.eco.pr.has(pr.id)) return 'Já foi alugada';
    if (int(a.paid) < pr.rent) return `O aluguel é ${fmt(pr.rent)} moedas por dia`;
    net.emit('eco.prop', { id: pr.id, u, name: recOf(game, u)?.name || '', mode: 'rent', day: game.env.dayIndex, by: actor.pid, give: int(a.paid) > pr.rent ? { [COIN]: int(a.paid) - pr.rent } : undefined,
      toast: `Casa alugada: ${fmt(pr.rent)} moedas por dia, cobradas a cada amanhecer`, toastKind: 'good' });
  },
});

defineIntent('prop.leave', {
  doc: 'Give a property back: an owned one is sold to the kingdom (60% of its price, minus what is owed), a rented one is returned. Its chests are emptied.',
  args: { id: 'propId' },
  run(game, a, actor, net) {
    const u = who(game, actor), row = game.eco?.pr.get(a.id), pr = propById(game, a.id);
    if (!row || !pr || row.u !== u) return 'Não é sua';
    const back = row.mode === 'own' ? Math.max(0, Math.round(pr.price * PROP.sellBack) - row.due) : 0;
    net.emit('eco.prop', { id: pr.id, gone: 1, why: 'left', by: actor.pid, give: back ? { [COIN]: back } : undefined,
      toast: row.mode === 'own' ? `Vendida ao reino por ${fmt(back)} moedas` : 'Aluguel encerrado', toastKind: 'info' });
  },
});

defineIntent('eco.pay', {
  doc: 'Pay what the actor owes on some properties (tax / rent); `coins` were taken from the actor (the change comes back).',
  args: { ids: '[propId]', coins: 'int' },
  run(game, a, actor, net) {
    const u = who(game, actor);
    let left = Math.max(0, int(a.coins));
    const ids = [];
    for (const id of Array.isArray(a.ids) ? a.ids.slice(0, 40) : []) {
      const row = game.eco?.pr.get(id);
      if (!row || row.u !== u || row.due <= 0 || row.due > left) continue;
      left -= row.due; ids.push(id);
    }
    if (!ids.length) return 'Nada a pagar';
    const paid = int(a.coins) - left;
    net.emit('eco.paid', { u, ids, coins: paid, by: actor.pid, give: left ? { [COIN]: left } : undefined, quiet: 1 });
  },
});

defineIntent('item.give', {
  doc: 'Give items to another player standing near (the items were taken from the actor: refunded on a reject).',
  args: { to: 'pid', item: 'itemId', qty: 'int' },
  run(game, a, actor, net) {
    const it = ITEMS[a.item], qty = Math.max(1, int(a.qty, 1));
    if (!it) return 'Item desconhecido';
    const to = str(a.to, 40);
    if (to === actor.pid) return 'Não dá para dar a si mesmo';
    const ent = entOfPid(game, to);
    if (!ent || ent.dead) return 'Esse jogador não está aqui';
    const e = actor.ent;
    if (e && Math.hypot(game.world.dx(e.x, ent.x), e.y - ent.y) > 4.5) return 'Chegue mais perto';
    const from = playerName(game, actor.pid);
    net.emit('eco.gift', { by: to, give: { [a.item]: qty }, from, toast: `${from} deu a você ${qty} × ${it.name}`, toastKind: 'good' });
  },
});

// ---------- owner message ----------
defineOwn('eco.collect', {
  doc: 'The day\'s tax / rent bill (host → owner): the owner pays from the coins in its backpack what it can, property by property; the rest stays owed (warning).',
  args: { day: 'int', bills: '[[propId, due, warn]]' },
  apply(game, a) { payBills(game, Array.isArray(a.bills) ? a.bills : [], true); },
});

export { GOODS, NG };
