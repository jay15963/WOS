// Settlements' shared state and the gates (docs/REINOS.md). The pieces of a settlement are made per chunk on every peer
// from the seed (game/towns.js); what players / monsters / sieges changed in them lives here, known on every peer whether
// the chunk is loaded or not (like the camp crates):
//   game.towns.state: Map id → { gone 0|1, open −1 (default) | 0 | 1, dmg 0..100, at (worldTime of the change), x, y }
//     (non-default rows only) — written by the generic structure ops on a town piece (struct.remove → gone, door.set →
//     open, struct.dmg → dmg: mut/structures.js TOWN.note), by town.restore (the place rebuilds), and read when a chunk
//     materializes. Snapshot / save rows `towns: [[id, gone, open, dmg, at, x, y]]` (interest: chunk diffs carry the rows
//     of their chunks), digest part `towns`.
//   game.gates: Map id → { owner (pid | ''), auto 0|1 } — players' gates (gate_big_wood / gate_stone): the owner opens and
//     closes them, or leaves them on automatic (open by day, closed at night: the host's town system). Snapshot rows
//     `gates: [[id, owner, auto]]`, digest part `towns`.
// Ops: town.restore {ids} · gate.mode {id, owner?, auto}. Intents: gate.mode {id, auto}.

import { defineIntent, defineOp } from '../../net/registry.js';
import { BUILDINGS } from '../data.js';
import { TOWN, structById } from './structures.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const TOWN_ID = /^t\d+\.\d+$/;
export const isGateDef = (def) => !!def?.gate2;
// the default open state of a town piece: gates open (by day), house doors closed
export const defaultOpen = (o) => !!BUILDINGS[o.type]?.gate2;

const S = (game) => game.towns?.state || (game.towns ||= { state: new Map() }).state;
function rowOf(game, id, o) {
  const st = S(game);
  let r = st.get(id);
  if (!r) { r = { gone: 0, open: -1, dmg: 0, at: 0, x: o ? o.tx : 0, y: o ? o.ty : 0 }; st.set(id, r); }
  return r;
}
function tidy(game, id) {
  const r = S(game).get(id);
  if (r && !r.gone && r.open < 0 && !r.dmg) S(game).delete(id);
}

// a shared change of a town piece (inside an op applier, every peer)
TOWN.note = (game, o, what) => {
  if (typeof o.id !== 'string' || !TOWN_ID.test(o.id)) return;
  const r = rowOf(game, o.id, o);
  if (what === 'gone') { r.gone = 1; r.open = -1; r.dmg = 0; r.at = Math.round(game.worldTime); }
  else if (what === 'door') r.open = !!o.open === defaultOpen(o) ? -1 : o.open ? 1 : 0;
  else if (what === 'dmg') r.dmg = Math.round((o.dmg || 0) * 100);
  tidy(game, o.id);
  game.towns.v = (game.towns.v || 0) + 1;
};
// the same change for a piece this peer has not placed (yet): its chunk is still being made here, or not loaded — the
// state is kept all the same and the piece comes with it (game/towns.js placePiece). A stand-in with the layout's type and
// tile; a piece already gone stays as it was.
TOWN.noteAbsent = (game, id, what, v = 0) => {
  if (typeof id !== 'string' || !TOWN_ID.test(id) || !game.towns?.layout) return;
  const [sid, k] = id.slice(1).split('.').map(Number), row = game.towns.layout(sid)?.structs[k];
  if (!row || S(game).get(id)?.gone) return;
  const o = { id, type: row[0], tx: row[1], ty: row[2] };
  if (what === 'door') o.open = !!v;
  else if (what === 'dmg') o.dmg = v;
  TOWN.note(game, o, what);
};
// a player's gate placed / gone (struct.add / removeStructure appliers)
TOWN.gateAdded = (game, o, by) => {
  if (!isGateDef(BUILDINGS[o.type]) || o.town != null) return;
  const G = game.gates || (game.gates = new Map());
  if (!G.has(o.id)) G.set(o.id, { owner: typeof by === 'string' ? by.slice(0, 40) : '', auto: 1 });
};
TOWN.gateGone = (game, o) => { if (o.town == null) game.gates?.delete(o.id); };

// ---------- rows (snapshot / save / digest) ----------
export function townRows(game, keep = null) {
  const out = [];
  for (const [id, r] of S(game)) if (!keep || keep(r.x + 0.5, r.y + 0.5)) out.push([id, r.gone, r.open, r.dmg, r.at, r.x, r.y]);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
export function gateRows(game) {
  return [...(game.gates?.entries() || [])].map(([id, g]) => [id, g.owner || '', g.auto ? 1 : 0]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
// apply rows: `scope(x, y)` limits a chunk diff (reconcile only there); the game side re-materializes what changed
export function applyTownRows(game, rows, reconcile, scope = null) {
  const st = S(game), before = new Map(st);
  if (reconcile) for (const [id, r] of [...st]) if (!scope || scope(r.x + 0.5, r.y + 0.5)) st.delete(id);
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !TOWN_ID.test(r[0])) continue;
    st.set(r[0], { gone: r[1] ? 1 : 0, open: r[2] === 0 || r[2] === 1 ? r[2] : -1, dmg: Math.max(0, Math.min(100, num(r[3]) | 0)), at: num(r[4]) | 0, x: num(r[5]) | 0, y: num(r[6]) | 0 });
  }
  const changed = new Set();
  for (const id of new Set([...before.keys(), ...st.keys()])) if (JSON.stringify(before.get(id)) !== JSON.stringify(st.get(id))) changed.add(id);
  if (changed.size) { game.towns.v = (game.towns.v || 0) + 1; game.towns.resync?.(changed); }
}
export function applyGateRows(game, rows, reconcile) {
  const G = game.gates || (game.gates = new Map());
  if (reconcile) G.clear();
  for (const r of Array.isArray(rows) ? rows : []) if (Array.isArray(r) && typeof r[0] === 'string') G.set(r[0], { owner: typeof r[1] === 'string' ? r[1].slice(0, 40) : '', auto: r[2] ? 1 : 0 });
}

// ---------- ops ----------
defineOp('town.restore', {
  doc: 'A settlement rebuilt destroyed pieces (host, after a while with nobody near): their rows go; peers with the chunk loaded put them back.',
  args: { ids: '[townPieceId]' },
  apply(game, a) {
    const ids = (Array.isArray(a.ids) ? a.ids : []).filter((id) => typeof id === 'string' && TOWN_ID.test(id)).slice(0, 400);
    for (const id of ids) { const r = S(game).get(id); if (r) { r.gone = 0; r.at = 0; tidy(game, id); } }
    if (ids.length) { game.towns.v = (game.towns.v || 0) + 1; game.towns.resync?.(new Set(ids)); }
  },
});

defineOp('gate.mode', {
  doc: "A player's gate: automatic (open by day, closed at night) or by hand; `owner` set when it is claimed.",
  args: { id: 'structId', auto: '0|1', owner: 'pid?', by: 'pid?' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o || o.town != null || !isGateDef(BUILDINGS[o.type])) return;
    const G = game.gates || (game.gates = new Map());
    const g = G.get(o.id) || { owner: '', auto: 1 };
    g.auto = a.auto ? 1 : 0;
    if (typeof a.owner === 'string') g.owner = a.owner.slice(0, 40);
    G.set(o.id, g);
    game.events?.emit('gatemode', { o });
  },
});

defineIntent('gate.mode', {
  doc: "Switch a player's gate between automatic and by hand (its owner only; a gate without an owner is claimed).",
  args: { id: 'structId', auto: '0|1' },
  run(game, a, actor, net) {
    const o = structById(game, a.id);
    if (!o || o.blueprint || !isGateDef(BUILDINGS[o.type])) return 'Não é um portão';
    if (o.town != null) return 'O portão é da guarda do lugar';
    const g = game.gates?.get(o.id);
    if (g?.owner && g.owner !== actor.pid && !game.creative) return 'Só o dono mexe neste portão';
    net.emit('gate.mode', { id: o.id, auto: a.auto ? 1 : 0, owner: g?.owner || actor.pid, by: actor.pid, toast: a.auto ? 'Portão no automático: abre de dia, fecha à noite' : 'Portão no manual: abra e feche com E', toastKind: 'info' });
  },
});
