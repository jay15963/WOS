// Skirmish ("Escaramuça", docs/SKIRMISH.md): the shared part. The whole state of the lobby and of the match is ONE small
// object (game.skirmish.st, ~1 KB) that the host replaces with op sk.st whenever something changes — the settings, the
// players' sides / classes / ready, the phase (lobby → prep → count → fight → end), the match (the place, the kingdoms, the
// numbers, where each side starts), the scoreboard (at most once a second) and the results. Every peer reads it; each peer
// moves / equips ITS OWN player from it (game/skirmish.js: an op never touches the local player).
// Intents (any player → the host): sk.pick {side, cls, ready} (its own pick) · host only: sk.set {patch}, sk.start {},
// sk.lobby {} ("Jogar de novo"). Snapshot `sk`, digest part `sk`.

import { defineOp, defineIntent } from '../../net/registry.js';

const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const PHASES = new Set(['lobby', 'prep', 'count', 'fight', 'end']);

// a clean copy of a state from the wire (plain JSON data: strings, numbers, arrays, objects; bounded)
function cleanJson(v, depth = 0) {
  if (depth > 6) return null;
  if (typeof v === 'string') return v.slice(0, 120);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v == null) return v ?? null;
  if (Array.isArray(v)) return v.slice(0, 64).map((x) => cleanJson(x, depth + 1));
  if (typeof v === 'object') { const o = {}; let n = 0; for (const k of Object.keys(v)) { if (++n > 48) break; o[k.slice(0, 24)] = cleanJson(v[k], depth + 1); } return o; }
  return null;
}
export function cleanSt(st) {
  if (!st || typeof st !== 'object') return null;
  const o = cleanJson(st);
  o.v = num(o.v) | 0;
  o.phase = PHASES.has(o.phase) ? o.phase : 'lobby';
  o.picks = Array.isArray(o.picks) ? o.picks.filter((p) => Array.isArray(p) && typeof p[0] === 'string') : [];
  return o;
}

defineOp('sk.st', {
  doc: 'The skirmish (lobby and match) as a whole: settings, the players\' picks, the phase, the match, the scoreboard, the results. The host replaces it whenever it changes; each peer moves / equips its own player from it.',
  args: { st: '{ v, phase, set, picks, host, arena, match, score, res }' },
  apply(game, a) {
    const S = game.skirmish;
    if (!S) return;
    const st = cleanSt(a.st);
    if (!st) return;
    const prev = S.st;
    S.st = st;
    game.events?.emit('skirmish', { st, prev });
  },
});

// any player: its own side / class / ready (the host checks the phase and the mode's rules)
defineIntent('sk.pick', {
  doc: 'A player picks its side (a | b), its class (archer | spear | sword) and whether it is ready, in the skirmish lobby.',
  args: { side: "'a'|'b'?", cls: "'archer'|'spear'|'sword'?", ready: '0|1?' },
  run(game, a, actor) {
    const H = game.skirmish?.host;
    if (!H) return 'Não é uma escaramuça';
    return H.pick(actor.pid, { side: str(a.side, 1), cls: str(a.cls, 8), ready: a.ready == null ? null : !!a.ready });
  },
});
// the host only: the settings of the match
defineIntent('sk.set', {
  doc: 'The host changes the skirmish settings (mode, place, monster family, soldiers in the battle, the share of each side).',
  args: { mode: 'string?', place: 'string?', fam: 'string?', total: 'number?', pa: 'number?' },
  run(game, a, actor) {
    const H = game.skirmish?.host;
    if (!H) return 'Não é uma escaramuça';
    if (!actor.local) return 'Só o anfitrião muda a partida';
    return H.set({ mode: a.mode == null ? null : str(a.mode, 10), place: a.place == null ? null : str(a.place, 10), fam: a.fam == null ? null : str(a.fam, 6), total: a.total == null ? null : num(a.total), pa: a.pa == null ? null : num(a.pa) });
  },
});
defineIntent('sk.start', {
  doc: 'The host starts the match ("Iniciar partida"): every player of the lobby goes to the battlefield.',
  args: {},
  run(game, a, actor) {
    const H = game.skirmish?.host;
    if (!H) return 'Não é uma escaramuça';
    if (!actor.local) return 'Só o anfitrião inicia a partida';
    return H.start();
  },
});
defineIntent('sk.lobby', {
  doc: 'The host takes everyone back to the lobby with the same settings ("Jogar de novo"): the battlefield is cleared.',
  args: {},
  run(game, a, actor) {
    const H = game.skirmish?.host;
    if (!H) return 'Não é uma escaramuça';
    if (!actor.local) return 'Só o anfitrião decide';
    return H.lobby();
  },
});

// ---------- rows (snapshot / digest; never saved: a skirmish world has no save) ----------
export const skRows = (game) => (game.skirmish?.st ? game.skirmish.st : null);
export function applySkRows(game, d) {
  const S = game.skirmish;
  if (!S || !d) return;
  const st = cleanSt(d);
  if (!st) return;
  const prev = S.st;
  S.st = st;
  game.events?.emit('skirmish', { st, prev });
}
export const skDigestRows = (game) => (game.skirmish?.st ? [JSON.stringify(game.skirmish.st)] : []);
