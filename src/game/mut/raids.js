// The winter attacks on the settlements (game/raids.js, docs/REINOS.md §16): the shared part. The host decides everything
// (when a place is attacked, the wave, the fight by numbers far from the players, the end); every peer keeps the same:
//   game.raids.on   Map sid → { sid, day, fam, n (monsters), g (guards when it came), giant ('' | species), horde 0|1,
//                   side (0..7: the sector it comes from), at (worldTime), live 1|0, fell 0|1 (the defense broke) } — the
//                   attacks going on (near the players: a wave of creatures; far ones are resolved at once)
//   game.raids.log  [[day, sid, out (1 held · 2 lost), n, gd (guards dead), cd (townsfolk dead), live, horde, at, fam]] —
//                   the last RAID.log attacks (the mural's line, the rebuilding by numbers the day after, the tests)
// Ops: raid.start · raid.fall · raid.end (its deaths and, far from the players, the damage by numbers: town state rows —
// loaded or not — and the cracks on the players' structures on their plots, which never settle). Intent: prop.fix (a
// player mends / rebuilds a piece of his own property: the townsfolk never mend the private property — owner's rule).
// Snapshot / save field `raids`, rows in the digest part `towns`.

import { defineIntent, defineOp } from '../../net/registry.js';
import { BUILDINGS, ITEMS } from '../data.js';
import { TOWN, structById, removeStructure } from './structures.js';
import { deadMap } from './people.js';
import { RAID } from '../content/raids.js';
import { uidOf } from '../eco.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v, d = 0) => Math.floor(num(v, d));
const str = (v, n = 24) => (typeof v === 'string' ? v.slice(0, n) : '');
const TID = /^t(\d+)\.(\d+)$/;
const realmOf = (game) => game.towns?.realm || null;
export const FAMS = ['ice', 'bone', 'sand'];

// ---------- state ----------
export function raidsState(game) {
  const R = game.raids || (game.raids = {});
  if (!R.on) Object.assign(R, { on: new Map(), log: [], v: 0 });
  return R;
}
const bump = (game) => { const R = raidsState(game); R.v = (R.v || 0) + 1; };
const onRow = (r) => [r.sid, r.day, FAMS.indexOf(r.fam), r.n, r.g, r.giant || '', r.horde ? 1 : 0, r.side, Math.round(r.at), r.live ? 1 : 0, r.fell ? 1 : 0];
const onOf = (a) => ({ sid: int(a[0]), day: int(a[1]), fam: FAMS[int(a[2])] || 'ice', n: int(a[3]), g: int(a[4]), giant: str(a[5]), horde: a[6] ? 1 : 0, side: int(a[7]) & 7, at: num(a[8]), live: a[9] ? 1 : 0, fell: a[10] ? 1 : 0 });
const logRow = (r) => (Array.isArray(r) && r.length >= 10 ? [int(r[0]), int(r[1]), int(r[2]) === 2 ? 2 : 1, int(r[3]), int(r[4]), int(r[5]), r[6] ? 1 : 0, r[7] ? 1 : 0, Math.round(num(r[8])), FAMS.includes(r[9]) ? r[9] : 'ice'] : null);

// ---------- rows (snapshot / save / digest) ----------
export function raidRows(game) {
  const R = raidsState(game);
  if (!R.on.size && !R.log.length) return null;
  return { on: [...R.on.values()].map(onRow).sort((a, b) => a[0] - b[0]), log: R.log.map((r) => r.slice()) };
}
export function applyRaidRows(game, d, reconcile) {
  const R = raidsState(game);
  if (reconcile) { R.on.clear(); R.log.length = 0; }
  if (!d || typeof d !== 'object') { bump(game); return; }
  for (const a of Array.isArray(d.on) ? d.on : []) if (Array.isArray(a) && realmOf(game)?.settlements[int(a[0])]) { const r = onOf(a); R.on.set(r.sid, r); }
  if (Array.isArray(d.log)) { R.log.length = 0; for (const r of d.log) { const q = logRow(r); if (q) R.log.push(q); } }
  bump(game);
}
export const raidDigestRows = (game) => {
  const R = raidsState(game);
  return [...R.on.values()].map((r) => ['raid:' + r.sid, onRow(r).join('.')]).concat(R.log.map((r, i) => ['rlog:' + i, r.join('.')]));
};

// ---------- the places' pieces by numbers (every peer, loaded or not) ----------
// row [id, type, x, y, d]: a crack (d 0..1) · gone row [id, type, x, y]: destroyed — written to the town state (without the
// plan: the row carries the piece's tile) or straight on the piece when this peer has it
function townHit(game, id, type, x, y, d, at) {
  if (typeof id !== 'string' || !TID.test(id) || !BUILDINGS[type]) return;
  const o = structById(game, id);
  if (d === 'gone') {
    if (o) { game.rockFx?.structBreak?.(game, o); removeStructure(game, o, { quiet: true, fx: 'raze' }); }
    else if (!game.towns?.state?.get(id)?.gone) TOWN.note?.(game, { id, type, tx: x, ty: y }, 'gone');
    const st = game.towns?.state?.get(id);
    if (st) st.at = Math.round(at); // (the host's clock: the same row on every peer)
    return;
  }
  const v = Math.max(0, Math.min(1, num(d)));
  if (o) { if (v > 0) o.dmg = v; else delete o.dmg; TOWN.note?.(game, o, 'dmg'); game.rockFx?.structHit?.(game, o, null); }
  else if (!game.towns?.state?.get(id)?.gone) TOWN.note?.(game, { id, type, tx: x, ty: y, dmg: v }, 'dmg');
}

// ---------- ops ----------
defineOp('raid.start', {
  doc: 'A wave of the night\'s dead comes at a settlement near the players (host): who, how many against how many guards, from which side.',
  args: { sid: 'int', day: 'int', fam: "'ice'|'bone'|'sand'", n: 'monsters', g: 'guards', giant: 'species?', horde: '0|1', side: '0..7', at: 'worldTime', live: '0|1' },
  apply(game, a) {
    const sid = int(a.sid, -1);
    if (!realmOf(game)?.settlements[sid]) return;
    const r = onOf([sid, a.day, FAMS.indexOf(a.fam), a.n, a.g, a.giant, a.horde, a.side, a.at, a.live, 0]);
    raidsState(game).on.set(sid, r);
    bump(game);
    game.events?.emit('raid', { type: 'start', sid, r });
  },
});

defineOp('raid.fall', {
  doc: 'The defense of a settlement under attack broke (host): few guards left and the dead still standing — the night is lost.',
  args: { sid: 'int' },
  apply(game, a) {
    const r = raidsState(game).on.get(int(a.sid, -1));
    if (!r || r.fell) return;
    r.fell = 1;
    bump(game);
    game.events?.emit('raid', { type: 'fall', sid: r.sid, r });
  },
});

defineOp('raid.end', {
  doc: 'An attack on a settlement is over (host): held (1) or lost (2), the dead (townsfolk / guards, replaced 1.5 days later) and — far from the players — the damage by numbers (town pieces; the players\' structures on their plots keep their cracks); `own`: whose private property was hit.',
  args: { sid: 'int', day: 'int', out: '1|2', n: 'int', gd: 'int', cd: 'int', live: '0|1', horde: '0|1', fam: 'string', at: 'worldTime', dead: '[[i, at]]', hit: '[[id, type, x, y, d]]', gone: '[[id, type, x, y]]', pdmg: '[[structId, d]]', own: '[[uid, kind, propId, n]]' },
  apply(game, a) {
    const sid = int(a.sid, -1), s = realmOf(game)?.settlements[sid];
    if (!s) return;
    const R = raidsState(game), at = num(a.at, game.worldTime);
    // the dead (game/people.js: replaced regrowDays later; no message for each — owner's rule)
    const D = deadMap(game);
    for (const q of Array.isArray(a.dead) ? a.dead.slice(0, 400) : []) {
      if (!Array.isArray(q)) continue;
      const i = int(q[0], -1);
      if (i < 0) continue;
      D.set(`${sid}.${i}`, num(q[1], at));
      game.events?.emit('townpop', { sid, i, dead: true });
    }
    if (Array.isArray(a.dead) && a.dead.length && game.towns) game.towns.popV = (game.towns.popV || 0) + 1;
    // the pieces (by numbers: far from the players)
    for (const q of Array.isArray(a.hit) ? a.hit.slice(0, 120) : []) if (Array.isArray(q)) townHit(game, q[0], q[1], int(q[2]), int(q[3]), num(q[4]), at);
    for (const q of Array.isArray(a.gone) ? a.gone.slice(0, 60) : []) if (Array.isArray(q)) townHit(game, q[0], q[1], int(q[2]), int(q[3]), 'gone', at);
    // a player's structures on his plot: persistent cracks (they never settle at dawn; he mends them himself)
    for (const q of Array.isArray(a.pdmg) ? a.pdmg.slice(0, 80) : []) {
      if (!Array.isArray(q)) continue;
      const o = structById(game, q[0]);
      if (!o || o.town != null) continue;
      const d = Math.max(0, Math.min(1, num(q[1])));
      if (d > 0) { o.dmg = d; o.sdmg = 1; } else { delete o.dmg; delete o.sdmg; }
      game.rockFx?.structHit?.(game, o, null);
    }
    if ((a.hit?.length || a.gone?.length) && game.towns) game.towns.v = (game.towns.v || 0) + 1;
    const out = int(a.out) === 2 ? 2 : 1;
    R.log.push([int(a.day), sid, out, int(a.n), int(a.gd), int(a.cd), a.live ? 1 : 0, a.horde ? 1 : 0, Math.round(at), FAMS.includes(a.fam) ? a.fam : 'ice']);
    if (R.log.length > RAID.log) R.log.splice(0, R.log.length - RAID.log);
    const was = R.on.get(sid) || null;
    R.on.delete(sid);
    bump(game);
    game.events?.emit('raid', { type: 'end', sid, out, live: !!a.live, n: int(a.n), gd: int(a.gd), cd: int(a.cd), horde: !!a.horde, fam: a.fam, was, own: Array.isArray(a.own) ? a.own.slice(0, 40) : [] });
  },
});

// ---------- a player mends his own property ----------
// (game/raids.js: "Consertar" on a cracked piece of his house / of what he built; "Reconstruir" a destroyed piece of his
// house — its cost paid from the backpack, refunded on a refusal). The townsfolk mend the rented houses; the owned ones and
// the plots are the player's (owner's rule, docs/REINOS.md §16).
export const FIX_STEP = { wood: 0.34, stone: 0.2 };
defineIntent('prop.fix', {
  doc: 'Mend a cracked piece (step) of the actor\'s own property — a piece of his house, a structure he may build there — or rebuild a destroyed piece of his house (`paid`: its cost, taken from the actor).',
  args: { id: 'pieceId | structId', paid: '{item: qty}?' },
  run(game, a, actor, net) {
    const id = str(a.id, 40), q = actor.ent, u = uidOf(game, actor.pid);
    if (!q || q.dead) return 'Agora não';
    const m = TID.exec(id);
    if (m) {
      // a piece of a settlement: of a house the actor holds
      const sid = +m[1], k = +m[2], row = game.towns?.layout?.(sid)?.structs[k], pr = game.raids?.houseOf?.(sid, k);
      if (!row || !pr) return 'Isto pertence ao lugar';
      const hold = game.eco?.pr.get(pr.id);
      if (!hold || hold.u !== u) return 'Só quem mora nesta casa a conserta';
      if (Math.hypot(game.world.dx(q.x, row[1] + 0.5), q.y - (row[2] + 0.5)) > 3.2) return 'Chegue mais perto';
      const st = game.towns.state.get(id);
      if (st?.gone) {
        const cost = BUILDINGS[row[0]]?.cost || {};
        for (const it in cost) if (int(a.paid?.[it]) < cost[it]) return `Falta material: ${cost[it]} ${(ITEMS[it]?.name || it).toLowerCase()}`;
        const busy = game.entities.some((e) => !e.dead && Math.abs(e.x - (row[1] + 0.5)) < 0.75 && Math.abs(e.y - (row[2] + 0.5)) < 0.75);
        if (busy) return 'Tem alguém no lugar';
        net.emit('town.restore', { ids: [id] });
        return true;
      }
      const o = structById(game, id);
      if (!(st?.dmg > 0) && !(o?.dmg > 0)) return 'Não precisa de conserto';
      const d0 = o?.dmg ?? st.dmg / 100, d = Math.max(0, d0 - (/stone/.test(row[0]) ? FIX_STEP.stone : FIX_STEP.wood));
      net.emit(o?.sdmg ? 'siege.dmg' : 'struct.dmg', { id, d: +d.toFixed(4), x: +q.x.toFixed(2), y: +q.y.toFixed(2) });
      return true;
    }
    // a player's own structure (where he may build: free land, his plot)
    const o = structById(game, id);
    if (!o || o.town != null || o.blueprint || !(o.dmg > 0)) return 'Não precisa de conserto';
    if (Math.hypot(game.world.dx(q.x, o.x), q.y - o.y) > 3.2) return 'Chegue mais perto';
    const why = TOWN.landReason?.(game, o.type, o.tx, o.ty, o.fw || 1, o.fh || 1, q);
    if (why) return why;
    const d = Math.max(0, o.dmg - (/stone/.test(o.type) ? FIX_STEP.stone : FIX_STEP.wood));
    net.emit(o.sdmg ? 'siege.dmg' : 'struct.dmg', { id, d: +d.toFixed(4), x: +q.x.toFixed(2), y: +q.y.toFixed(2) });
    return true;
  },
});
