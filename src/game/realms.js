// Phase 3a — the kingdoms' strategy (docs/REINOS.md §12 / §13): diplomacy, who owns each place, armies on the map,
// marches along the realm's roads, field battles and sieges resolved by numbers far from the players, conquest.
//
// game.realms (every peer; the state is replicated, decided on the host — game/mut/realms.js):
//   rel(a, b) → 'self'|'ally'|'neutral'|'war' · atWar(a, b) · relInfo(a, b) · owner(sid) · ownerAt(x, y) · alive(k)
//   armies (Map id → army: the home army 'g<sid>' of every place and the field armies 'a<n>') · fieldArmies()
//   capture(sid, k) (host) · report(id, { n, eng, state, x, y, siege }) (host: 3b while an army is `live`)
//   besieged(sid) / siegeOf(sid) · holdRepair(sid) · placesOf(k) · capitalOf(k) · strength(k) · posOf(army) · etaOf(army)
//   newsText(row) · reward(pid, k, d, why) (host: reputation for helping a kingdom — 3b) · marketNews(day, roll, ev) (host:
//   eco.js) · siegeThreat(sid, prev) (host: people.js, the town defense faces the besiegers' camp) · dbg (tests)
// The hand-off to phase 3b (§12): an army (its battle / its siege) within WAR.live tiles of a player is `live` →
// game.warfare?.materialize(army); nobody within WAR.liveOut → game.warfare?.dematerialize(id) → { n, eng, siege } and the
// numbers go on from there. Without game.warfare everything stays numeric (live is never set).
//
// Host simulation (realmsSystem, sync 'host'): the world clock is followed in steps of WAR.step seconds (a time skip — a
// night slept, env.skip — is simulated for at most WAR.maxSkip days): marches (positions derived from the clock: the
// route and t0 / d0 / v in the army row — no op while marching), meetings of armies at war (battle rounds every 8 s),
// siege hours (engines, bombardment, the ram, assault, capture or retreat), campaign plans every WAR.planEvery game hours,
// and the daily diplomacy (tension, war, alliances, weariness, peace, recruits). Nothing per frame on the clients but the
// derived positions of the few armies in the field (every 0.25 s).

import { WAR, capOf, powerOf, watchOf, wallKind } from './content/war.js';
import { realmsState, ownerOf, ownerAt, relKey, armyRow, siegeIndex, homeArmy } from './mut/realms.js';
import { canReach } from '../world/realm/realm.js';
import { realmNpcLevel } from './towns.js';
import { perimeterOf } from './defense.js';
import { allPlayers } from './players.js';
import { uidOf, profileOf } from './eco.js';
import { GI } from './content/eco.js';
import { DAY_LENGTH } from './calendar.js';
import { Heap } from '../world/planet/noise.js';

const DAYLEN = (game) => game.env?.dayLength || DAY_LENGTH;
const HOURLEN = (game) => DAYLEN(game) / 24;
const realmOf = (game) => game.towns?.realm || null;
const K_NAME = (game, k) => realmOf(game)?.kingdoms[k]?.name || '?';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const h01 = (...v) => { let h = 2166136261; for (const x of v) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; } return (h >>> 0) / 4294967296; };

// ---------- the road graph (settlements = nodes, roads = edges) ----------
const GRAPH = new WeakMap();
function graphOf(realm) {
  let G = GRAPH.get(realm);
  if (G) return G;
  const W = 16384, adj = realm.settlements.map(() => []), len = new Float64Array(realm.roads.length);
  for (const R of realm.roads) {
    const P = R.pts;
    let L = 0;
    for (let i = 2; i < P.length; i += 2) { let dx = P[i] - P[i - 2]; if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W; L += Math.hypot(dx, P[i + 1] - P[i - 1]); }
    len[R.id] = L;
    adj[R.a].push([R.b, R.id, 1]); adj[R.b].push([R.a, R.id, 0]); // (to the other end: dir 1 = a → b)
  }
  G = { adj, len };
  GRAPH.set(realm, G);
  return G;
}
// Dijkstra from `src` (sids) over the roads (≤ maxD): dist, the previous node and the road taken to reach each node
function dijkstra(realm, src, maxD = Infinity) {
  const G = graphOf(realm), n = realm.settlements.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), via = new Int32Array(n).fill(-1), vdir = new Int8Array(n);
  const open = [];
  for (const s of src) { dist[s] = 0; open.push(s); }
  const done = new Uint8Array(n);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const u = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (done[u]) continue;
    done[u] = 1;
    for (const [v, rid, dir] of G.adj[u]) {
      const nd = dist[u] + G.len[rid];
      if (nd > maxD || nd >= dist[v]) continue;
      dist[v] = nd; prev[v] = u; via[v] = rid; vdir[v] = dir; open.push(v);
    }
  }
  return { dist, prev, via, vdir };
}
// the route from place `from` to the source of a Dijkstra run made FROM the target (follow the previous nodes): roads
// from → … → target, each with the direction it is walked in
function routeFrom(D, from) {
  const r = [];
  for (let u = from, n = 0; D.prev[u] >= 0 && n < 60; u = D.prev[u], n++) r.push(D.via[u], D.vdir[u] ? 0 : 1); // (prev[u] → u was walked dir; u → prev[u] is the other way)
  return r;
}
// two places of one land mass with no road between them (kingdoms apart across free land): the army goes across country —
// A* over the planet's macro cells (land only; hills and mountains cost more), host only; the cells travel in the op
// (path.c) and every peer makes the same polyline from them
export function overland(game, from, to) {
  const P = game.world.source?.planet, realm = realmOf(game);
  if (!P?.water || !realm) return null;
  const MW = 512, MH = 256, S = realm.settlements, cellOf = (s) => Math.max(0, Math.min(MH - 1, Math.floor(s.y / 32))) * MW + ((Math.floor(s.x / 32) % MW) + MW) % MW;
  const a = cellOf(S[from]), b = cellOf(S[to]), land = (i) => !P.water[i] && !P.ocean[i] && !P.lakeId[i];
  if (P.comp[a] !== P.comp[b]) return null;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  const hd = (i) => { let dx = Math.abs((i % MW) - (b % MW)); if (dx > MW / 2) dx = MW - dx; return Math.hypot(dx, Math.floor(i / MW) - Math.floor(b / MW)); };
  const G = new Map([[a, 0]]), from_ = new Map(), H = new Heap(4096);
  H.push(hd(a), a);
  let n = 0;
  while (H.n) {
    const i = H.pop();
    if (i === b) break;
    if (++n > 40000) return null;
    const gi = G.get(i), x = i % MW, y = (i - x) / MW;
    for (let q = 0; q < 8; q++) {
      const yy = y + DY[q];
      if (yy < 0 || yy >= MH) continue;
      const j = yy * MW + (((x + DX[q]) % MW) + MW) % MW;
      if (j !== b && !land(j)) continue;
      const c = DL[q] * (1 + 3 * (P.relief?.[j] || 0) + 10 * (P.mtn?.[j] || 0) + (P.rkind?.[j] === 1 ? 1.5 : 0));
      const ng = gi + c;
      if (ng < (G.get(j) ?? Infinity)) { G.set(j, ng); from_.set(j, i); H.push(ng + hd(j), j); }
    }
  }
  if (!G.has(b)) return null;
  const cells = [];
  for (let i = from_.get(b); i != null && i !== a; i = from_.get(i)) cells.push(i);
  cells.reverse();
  return { f: from, t: to, r: [], c: cells.slice(0, 400) };
}
function geomOverland(game, path) {
  const realm = realmOf(game), W = game.world.W || 16384, A = realm.settlements[path.f], B = realm.settlements[path.t] || A;
  let P = [[A.x, A.y]];
  for (const i of path.c) {
    let x = (i % 512) * 32 + 16;
    const y = Math.floor(i / 512) * 32 + 16, px = P[P.length - 1][0];
    if (x - px > W / 2) x -= W; else if (px - x > W / 2) x += W;
    P.push([x, y]);
  }
  { let x = B.x; const px = P[P.length - 1][0]; if (x - px > W / 2) x -= W; else if (px - x > W / 2) x += W; P.push([x, B.y]); }
  for (let it = 0; it < 2; it++) { // (Chaikin: a winding track, not cell steps)
    const Q = [P[0]];
    for (let k = 0; k < P.length - 1; k++) { const [x0, y0] = P[k], [x1, y1] = P[k + 1]; Q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]); }
    Q.push(P[P.length - 1]);
    P = Q;
  }
  const pts = [];
  for (const [x, y] of P) pts.push(Math.round(x * 4) / 4, Math.round(y * 4) / 4);
  const m = pts.length / 2, cum = new Float64Array(m);
  for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
  return { pts, cum, len: cum[m - 1] || 0, end: path.t, overland: true };
}
// the geometry of a path { f, r: [roadId, dir, …] } (or { f, t, c: [cells] } across country): a continuous polyline (x may
// run past the seam), cumulative lengths
function geomOf(game, path) {
  if (path.c?.length || (path.t != null && !path.r.length)) return geomOverland(game, path);
  const realm = realmOf(game), W = game.world.W || 16384;
  const pts = [];
  let node = path.f;
  for (let i = 0; i + 1 < path.r.length; i += 2) {
    const R = realm.roads[path.r[i]];
    if (!R) break;
    const fwd = !!path.r[i + 1], P = R.pts, n = P.length / 2;
    const fx = P[(fwd ? 0 : n - 1) * 2];
    const refX = pts.length ? pts[pts.length - 2] : realm.settlements[node].x;
    const shift = Math.round((refX - fx) / W) * W;
    for (let k = 0; k < n; k++) {
      const j = fwd ? k : n - 1 - k;
      if (pts.length && k === 0) continue; // (the junction: the same settlement centre)
      pts.push(P[j * 2] + shift, P[j * 2 + 1]);
    }
    node = fwd ? R.b : R.a;
  }
  if (!pts.length) { const s = realm.settlements[path.f]; pts.push(s.x, s.y); }
  const m = pts.length / 2, cum = new Float64Array(m);
  for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
  return { pts, cum, len: cum[m - 1] || 0, end: node };
}
export function routeOf(game, a) {
  if (!a?.path) return null;
  const key = a.path.f + ':' + a.path.r.join(',') + (a.path.c ? '|' + a.path.t + ':' + a.path.c.join(',') : '');
  if (a._route?.key === key) return a._route;
  const g = geomOf(game, a.path);
  g.key = key;
  a._route = g;
  return g;
}
// a point at distance d along a route → [x (wrapped), y, heading]
const PT = [0, 0, 0];
function along(game, g, d) {
  const W = game.world.W || 16384, cum = g.cum, P = g.pts, m = cum.length;
  d = clamp(d, 0, g.len);
  let lo = 0, hi = m - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1, t = clamp((d - cum[lo]) / seg, 0, 1);
  const x0 = P[lo * 2], y0 = P[lo * 2 + 1], x1 = P[hi * 2] ?? x0, y1 = P[hi * 2 + 1] ?? y0;
  PT[0] = (((x0 + (x1 - x0) * t) % W) + W) % W; PT[1] = y0 + (y1 - y0) * t; PT[2] = Math.atan2(y1 - y0, x1 - x0);
  return PT;
}
// the distance along a route nearest to (x, y) (3b hands an army back where its soldiers stood)
function project(game, g, x, y) {
  const w = game.world, P = g.pts;
  let best = 0, bd = Infinity;
  for (let k = 0; k + 1 < g.cum.length; k++) {
    const ax = P[k * 2], ay = P[k * 2 + 1], bx = P[k * 2 + 2], by = P[k * 2 + 3];
    const px = ax + w.dx(x, ax), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (y - ay) * dy) / L2, 0, 1), qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(px - qx, y - qy);
    if (d < bd) { bd = d; best = g.cum[k] + t * Math.sqrt(L2); }
  }
  return best;
}
// where a marching army is at time t (the same on every peer: route + clock)
export function distAt(a, t) { return a.d0 + a.v * Math.max(0, t - a.t0); }
function placeArmy(game, a, t) {
  if (a.state !== 'march' && a.state !== 'retreat') return a;
  const g = routeOf(game, a);
  if (!g) return a;
  const p = along(game, g, distAt(a, t));
  a.x = p[0]; a.y = p[1]; a._dir = p[2];
  return a;
}

// ---------- queries ----------
const fallen = (game, k) => !!game.realms?.fallen?.has(k);
export function relOf(game, a, b) {
  if (a === b) return 'self';
  const r = game.realms?.rels?.get(relKey(a, b));
  return r ? (r.r === 'truce' ? 'neutral' : r.r) : 'neutral';
}
export const atWar = (game, a, b) => a !== b && game.realms?.rels?.get(relKey(a, b))?.r === 'war';
export function placesOf(game, k) { const realm = realmOf(game); return realm ? realm.settlements.filter((s) => ownerOf(game, s.id) === k) : []; }
export function capitalOf(game, k) {
  const realm = realmOf(game), K = realm?.kingdoms[k];
  if (!K) return null;
  if (ownerOf(game, K.capital) === k) return realm.settlements[K.capital];
  return placesOf(game, k).find((s) => s.kind === 'city') || null;
}
const homeOf = (game, sid) => game.realms?.armies?.get('g' + sid) || null;
export function strength(game, k) { let p = 0; for (const a of game.realms?.armies?.values() || []) if (a.k === k) p += powerOf(a.n, a.lv); return p; }
const warsOf = (game, k) => { let n = 0; for (const [key, r] of game.realms.rels) if (r.r === 'war') { const [x, y] = key.split('.').map(Number); if (x === k || y === k) n++; } return n; };
const alliesOf = (game, k) => { const out = []; for (const [key, r] of game.realms.rels) if (r.r === 'ally') { const [x, y] = key.split('.').map(Number); if (x === k) out.push(y); else if (y === k) out.push(x); } return out; };
const enemiesOf = (game, k) => { const out = []; for (const [key, r] of game.realms.rels) if (r.r === 'war') { const [x, y] = key.split('.').map(Number); if (x === k) out.push(y); else if (y === k) out.push(x); } return out; };
export const inGrace = (game, k, day = game.env?.dayIndex | 0) => { const R = game.realms; return R.day0 >= 0 && ((k === R.k0 && day < R.day0 + WAR.graceDays) || day < R.day0 + WAR.quietDays); };
export function defenseOf(game, sid) {
  const s = realmOf(game).settlements[sid], g = homeOf(game, sid), sg = siegeIndex(game).get(sid);
  const n = (g?.n || 0) + Math.max(0, watchOf(s) - (sg?.dw || 0));
  return { n, pow: powerOf(n, g?.lv || 1) * WAR.siege.wallK[wallKind(s)] };
}
// the side a besieged place is attacked from (people.js: the town defense faces the camp)
function siegeThreat(game, sid, prev = null) {
  const a = siegeIndex(game).get(sid), s = realmOf(game)?.settlements[sid];
  if (!a || !s) return null;
  const dx = game.world.dx(a.x, s.x), dy = a.y - s.y, an = Math.atan2(dy, dx);
  let sector = ((Math.round(an / (Math.PI / 4)) % 8) + 8) % 8;
  if (prev && prev.sector != null) sector = prev.sector === sector ? prev.sector : sector;
  const sa = sector * (Math.PI / 4);
  return { fx: Math.cos(sa), fy: Math.sin(sa), sector, n: a.n, army: a.id };
}
export const holdRepair = (game, sid) => {
  const R = game.realms;
  if (!R?.armies) return false;
  if (siegeIndex(game).has(sid)) return true;
  const t = R.scar.get(sid);
  return t != null && game.worldTime - t < WAR.siege.repairHold * DAYLEN(game);
};

// ---------- news: the text of a news row [n, day, hour×10, type, a, b, sid, x] ----------
export function newsText(game, row) {
  const realm = realmOf(game);
  if (!realm) return '';
  const [, , , type, a, b, sid, x] = row, A = K_NAME(game, a), B = K_NAME(game, b), S = realm.settlements[sid];
  const sn = S ? S.name : '';
  switch (type) {
    case 'war': return `O Reino de ${A} declarou guerra ao Reino de ${B}`;
    case 'peace': return `O Reino de ${A} e o Reino de ${B} assinaram a paz${x ? ` (trégua até o dia ${x})` : ''}`;
    case 'ally': return `O Reino de ${A} e o Reino de ${B} fizeram uma aliança`;
    case 'break': return `Acabou a aliança entre o Reino de ${A} e o Reino de ${B}`;
    case 'truce': return `Terminou a trégua entre o Reino de ${A} e o Reino de ${B}`;
    case 'march': return `Um exército do Reino de ${A} (${x} soldados) marcha sobre ${sn}, do Reino de ${B}`;
    case 'relief': return `O Reino de ${A} manda ${x} soldados socorrer ${sn}`;
    case 'siege': return `${sn} está sob cerco do Reino de ${A} (${x} soldados)`;
    case 'battle': return `Batalha entre os exércitos do Reino de ${A} e do Reino de ${B}${sn ? ` perto de ${sn}` : ''}`;
    case 'won': return `O exército do Reino de ${A} venceu o do Reino de ${B}${sn ? ` perto de ${sn}` : ''}`;
    case 'lift': return `O cerco de ${sn} terminou: o exército do Reino de ${A} recuou`;
    case 'capture': return `${sn} foi tomada pelo Reino de ${A}`;
    case 'retake': return `${sn} foi retomada pelo Reino de ${A}`;
    case 'fall': return `O Reino de ${A} caiu: suas terras passam ao Reino de ${B}`;
  }
  return '';
}
export const newsKinds = (row) => [row[4], row[5]]; // (the kingdoms a news row is about)

// ---------- install (every peer) ----------
export function installRealms(game) {
  const R = realmsState(game);
  const H = { acc: new Map(), lost: new Map(), placeLost: new Map(), planAt: new Map(), t: null, per: new Map(), stats: { ticks: 0, sum: 0, max: 0, steps: 0, maxSkip: 0, dayMs: 0 } }; // (host-only bookkeeping)
  Object.assign(R, {
    H,
    rel: (a, b) => relOf(game, a, b), // (§12: 'self' | 'ally' | 'neutral' | 'war')
    relOf: (a, b) => relOf(game, a, b),
    atWar: (a, b) => atWar(game, a, b),
    relInfo: (a, b) => { const r = R.rels.get(relKey(a, b)); return { rel: relOf(game, a, b), r: r?.r || 'neutral', since: r?.since ?? -1, until: r?.until || 0, by: r?.by ?? -1, wa: a < b ? r?.wa | 0 : r?.wb | 0, wb: a < b ? r?.wb | 0 : r?.wa | 0, tension: R.tens.get(relKey(a, b)) ?? null, past: R.past.get(relKey(a, b)) || 0, reach: canReach(realmOf(game), a, b) }; },
    owner: (sid) => ownerOf(game, sid),
    ownerAt: (x, y) => ownerAt(game, x, y),
    alive: (k) => !!realmOf(game)?.kingdoms[k] && !fallen(game, k),
    fieldArmies: () => [...R.armies.values()].filter((a) => a.state !== 'home'),
    placesOf: (k) => placesOf(game, k),
    capitalOf: (k) => capitalOf(game, k),
    strength: (k) => strength(game, k),
    besieged: (sid) => siegeIndex(game).has(sid),
    siegeOf: (sid) => siegeIndex(game).get(sid) || null,
    holdRepair: (sid) => holdRepair(game, sid),
    siegeThreat: (sid, prev) => siegeThreat(game, sid, prev),
    defense: (sid) => defenseOf(game, sid),
    inGrace: (k) => inGrace(game, k),
    posOf: (a) => placeArmy(game, a, game.worldTime),
    routeOf: (a) => routeOf(game, a),
    etaOf: (a) => etaOf(game, a),
    newsText: (row) => newsText(game, row),
    newsFor: (k, n = 8) => R.news.filter((r) => r[4] === k || r[5] === k || (r[6] >= 0 && ownerOf(game, r[6]) === k)).slice(-n).reverse(),
    capture: (sid, k) => { if (!game.net.auth) return false; return hostCapture(game, sid, k, null); },
    report: (id, r) => hostReport(game, id, r),
    reward: (pid, k, d, why = '') => {
      if (!game.net.auth || !(k >= 0) || !d) return false;
      const u = uidOf(game, pid);
      if (!u) return false;
      game.net.emit('eco.rep', { u, k, d: Math.round(d), by: pid, toast: why ? `${d > 0 ? '+' : ''}${Math.round(d)} de reputação no Reino de ${K_NAME(game, k)}: ${why}` : undefined, toastKind: d > 0 ? 'good' : 'warn' });
      return true;
    },
    marketNews: (day, roll, ev) => marketNews(game, day, roll, ev),
    dbg: makeDebug(game),
  });
  return R;
}
// the time left of a march (s of game time) and its distance
function etaOf(game, a) {
  if (a.state !== 'march' && a.state !== 'retreat') return null;
  const g = routeOf(game, a);
  if (!g || !(a.v > 0)) return null;
  const stop = stopAt(game, a, g), d = distAt(a, game.worldTime);
  return { left: Math.max(0, stop - d), s: Math.max(0, stop - d) / a.v };
}
function stopAt(game, a, g) {
  if (a.mission === 'return' || a.mission === 'join' || a.target < 0) return g.len;
  const T = realmOf(game).settlements[a.target];
  return Math.max(0, g.len - (T.r + WAR.stopOut));
}

// ---------- host: ops helpers ----------
const emitArmy = (game, a, extra = {}) => game.net.emit('realm.army', { a: armyRow(a), ...extra });
const copy = (a) => ({ ...armyRow(a) });
function lost(game, k, n) { const H = game.realms.H; H.lost.set(k, (H.lost.get(k) || 0) + Math.max(0, n)); }

// the way from place `from` to place T: by the roads (D: a Dijkstra run from T), else across country (same land mass)
function pathTo(game, D, from, T) {
  if (D && D.dist[from] < Infinity) { const r = routeFrom(D, from); return r.length ? { f: from, r } : null; }
  return overland(game, from, T);
}
// a new army leaves `from` toward `target` (host); muster: it waits there for the other contingents first (no path yet)
function launch(game, k, from, target, n, mission, D, news = null, t = game.worldTime, { grp = '', muster = false } = {}) {
  const R = game.realms, g = homeOf(game, from), realm = realmOf(game);
  if (!g || n < 1) return null;
  const path = muster ? null : pathTo(game, D, from, target);
  if (!path && !muster) return null;
  const id = 'a' + (R.nid + 1);
  const T0 = Math.round(t * 100) / 100;
  const a = { ...homeArmy(game, from, n), id, k, n, n0: n, lv: g.lv, state: muster ? 'camp' : 'march', phase: muster ? 'muster' : '', target, mission, path, t0: T0, d0: 0, v: muster ? 0 : WAR.march, since: T0, grp: grp || id };
  const s = realm.settlements[from];
  a.x = s.x; a.y = s.y;
  emitArmy(game, a, { gar: [[from, g.n - n]], news: news || undefined });
  return R.armies.get(id);
}
// an army mustering at a place sets out for its target (the contingents came, or it waited long enough)
function depart(game, a, t) {
  const realm = realmOf(game), T = a.target, own = T >= 0 ? ownerOf(game, T) : -1;
  const goes = a.mission === 'relief' ? own === a.k && siegeIndex(game).has(T) : T >= 0 && atWar(game, a.k, own);
  const path = goes ? pathTo(game, dijkstra(realm, [T], WAR.maxRoute * 1.5), a.home, T) : null;
  if (!path) { mergeHome(game, a); return; } // (the war is over, the siege lifted, no way there: back to the garrison)
  const b = copy(a), T0 = Math.round(t * 100) / 100;
  Object.assign(b, { state: 'march', phase: '', path, t0: T0, d0: 0, v: WAR.march, since: T0, n0: a.n });
  emitArmy(game, b, { news: a.mission === 'relief' ? ['relief', a.k, siegeIndex(game).get(T)?.k ?? -1, T, a.n] : ['march', a.k, own, T, a.n] });
}
// an army turns back home along the road it came by (from where it stands now)
function goHome(game, a, t, extra = {}) {
  const g = routeOf(game, a);
  if (!g || !a.path) { mergeHome(game, a, extra); return; }
  const d = a.state === 'march' || a.state === 'retreat' ? Math.min(distAt(a, t), g.len) : project(game, g, a.x, a.y);
  const rr = [];
  for (let i = a.path.r.length - 2; i >= 0; i -= 2) rr.push(a.path.r[i], a.path.r[i + 1] ? 0 : 1);
  const back = a.path.c ? { f: a.path.t, r: [], t: a.path.f, c: a.path.c.slice().reverse() } : { f: g.end, r: rr }; // (the way it came, backwards)
  const b = copy(a);
  Object.assign(b, { state: 'retreat', mission: 'return', target: -1, path: back, t0: Math.round(t * 100) / 100, d0: Math.round((g.len - d) * 100) / 100, v: WAR.march, foe: '', phase: '', since: Math.round(t * 100) / 100, live: 0 });
  emitArmy(game, b, extra);
}
// an army back home: its soldiers join the home army (a lost home: the kingdom's nearest place)
function mergeHome(game, a, extra = {}) {
  const realm = realmOf(game);
  let home = a.home;
  if (ownerOf(game, home) !== a.k) {
    const s0 = realm.settlements[home], own = placesOf(game, a.k);
    home = own.length ? own.sort((p, q) => Math.hypot(game.world.dx(p.x, s0.x), p.y - s0.y) - Math.hypot(game.world.dx(q.x, s0.x), q.y - s0.y))[0].id : -1;
  }
  const g = home >= 0 ? homeOf(game, home) : null;
  const gar = g ? [[home, Math.max(g.n, Math.min(capOf(realm.settlements[home]), g.n + a.n))]] : undefined;
  game.realms.H.acc.delete(a.id);
  game.net.emit('realm.army', { del: a.id, gar, ...extra });
}

// ---------- host: arrivals ----------
function arrive(game, a, t) {
  const realm = realmOf(game), R = game.realms;
  if (a.mission === 'return' || a.target < 0) { mergeHome(game, a); return; }
  if (a.mission === 'join') { // (a contingent at its muster place: joins the main army, or follows it to the target)
    const M = R.armies.get(a.grp);
    if (M && M.state === 'camp' && M.phase === 'muster') {
      const b = copy(M); b.n += a.n; b.n0 += a.n;
      R.H.acc.delete(a.id);
      emitArmy(game, b);
      game.net.emit('realm.army', { del: a.id });
      return;
    }
    const path = M && M.target >= 0 && M.state !== 'retreat' ? pathTo(game, dijkstra(realm, [M.target], WAR.maxRoute * 1.5), a.target, M.target) : null;
    if (!path) { mergeHome(game, a); return; }
    const b = copy(a), T0 = Math.round(t * 100) / 100;
    Object.assign(b, { mission: M.mission, target: M.target, path, t0: T0, d0: 0, v: WAR.march, since: T0 });
    emitArmy(game, b);
    return;
  }
  const T = a.target, own = ownerOf(game, T), s = realm.settlements[T];
  const g = routeOf(game, a), here = along(game, g, stopAt(game, a, g));
  if (a.mission === 'relief') {
    const S = siegeIndex(game).get(T);
    if (S && atWar(game, a.k, S.k) && S.state === 'siege') { startBattle(game, { ...copy(a), x: here[0], y: here[1] }, S, t, T); return; }
    // no siege any more: part of it stays to strengthen the place, the rest goes home
    const hg = homeOf(game, T), room = Math.max(0, capOf(s) - (hg?.n || 0)), stay = own === a.k ? Math.min(room, a.n) : 0;
    if (stay >= a.n) { R.H.acc.delete(a.id); game.net.emit('realm.army', { del: a.id, gar: [[T, hg.n + stay]] }); return; }
    goHome(game, { ...copy(a), n: a.n - stay, x: here[0], y: here[1], state: 'camp' }, t, stay ? { gar: [[T, hg.n + stay]] } : {});
    return;
  }
  // an attack
  if (own === a.k) { const hg = homeOf(game, T); R.H.acc.delete(a.id); game.net.emit('realm.army', { del: a.id, gar: [[T, Math.max(hg?.n || 0, Math.min(capOf(s), (hg?.n || 0) + a.n))]] }); return; }
  if (!atWar(game, a.k, own)) { goHome(game, a, t); return; }
  const S = siegeIndex(game).get(T);
  if (S && S.k === a.k) { // (joins the siege already there)
    const b = copy(S); b.n += a.n; b.n0 += a.n; for (let i = 0; i < 4; i++) b.eng[i] += a.eng[i];
    R.H.acc.delete(a.id);
    emitArmy(game, b);
    game.net.emit('realm.army', { del: a.id });
    return;
  }
  if (S) { goHome(game, a, t); return; } // (another kingdom besieges it: not ours to join)
  const b = copy(a);
  Object.assign(b, { state: 'siege', phase: 'camp', hrs: 0, dw: 0, dn: defenseOf(game, T).n, x: Math.round(here[0] * 100) / 100, y: Math.round(here[1] * 100) / 100, since: Math.round(t * 100) / 100, v: 0, d0: Math.round(stopAt(game, a, g) * 100) / 100, t0: Math.round(t * 100) / 100, bp: 0 });
  emitArmy(game, b, { news: ['siege', a.k, own, T, b.n], scar: T, wt: Math.round(t) });
}

// ---------- host: field battles ----------
function nearSid(game, x, y) {
  const realm = realmOf(game);
  let best = -1, bd = 400;
  for (const s of realm.settlements) { const d = Math.hypot(game.world.dx(s.x, x), s.y - y); if (d < bd) { bd = d; best = s.id; } }
  return best;
}
function startBattle(game, a, b, t, sid = -1) {
  const H = game.realms.H;
  const A = copy(a), B = copy(b), mx = b.x + game.world.dx(a.x, b.x) / 2, my = (a.y + b.y) / 2;
  for (const [o, f] of [[A, B], [B, A]]) {
    const g = routeOf(game, o === A ? a : b);
    const d = (o.state === 'march' || o.state === 'retreat') && g ? Math.min(distAt(o, t), g.len) : o.d0;
    o.phase = (o.state + '/' + (o.phase || '')).slice(0, 16);
    Object.assign(o, { state: 'battle', foe: f.id, bn: o.n, d0: Math.round(d * 100) / 100, t0: Math.round(t * 100) / 100, v: 0 });
  }
  A.x = Math.round(mx * 100) / 100; A.y = Math.round(my * 100) / 100; // (they meet half-way: the battle is there)
  B.x = A.x; B.y = A.y;
  H.acc.set(A.id, { b: 0, s: 0 }); H.acc.set(B.id, { b: 0, s: 0 });
  const where = sid >= 0 ? sid : nearSid(game, mx, my);
  emitArmy(game, A);
  emitArmy(game, B, { news: A.n + B.n >= WAR.battle.newsMin ? ['battle', A.k, B.k, where, A.n + B.n] : undefined }); // (a skirmish of a few: no news)
}
function battleRound(game, a, b, t, roll) {
  const B = WAR.battle, pa = powerOf(a.n, a.lv), pb = powerOf(b.n, b.lv);
  const la = Math.min(a.n, Math.round(pb * B.kill * (0.7 + 0.6 * roll()))), lb = Math.min(b.n, Math.round(pa * B.kill * (0.7 + 0.6 * roll())));
  const A = copy(a), Bb = copy(b);
  A.n -= la; Bb.n -= lb;
  lost(game, a.k, la); lost(game, b.k, lb);
  const brokeA = A.n < Math.max(B.wipe, A.bn * B.morale), brokeB = Bb.n < Math.max(B.wipe, Bb.bn * B.morale);
  if (!brokeA && !brokeB) { emitArmy(game, A); emitArmy(game, Bb); return; }
  // the one that broke harder loses
  const loseA = brokeA && (!brokeB || A.n / Math.max(1, A.bn) <= Bb.n / Math.max(1, Bb.bn));
  const W = loseA ? Bb : A, L = loseA ? A : Bb;
  endBattle(game, W, L, t);
}
function resume(game, o, t) {
  const [st, ph] = (o.phase || 'march/').split('/');
  o.state = st === 'siege' || st === 'camp' ? st : st === 'retreat' ? 'retreat' : 'march';
  o.phase = ph || ''; o.foe = ''; o.bn = 0;
  if (o.state === 'march' || o.state === 'retreat') { o.t0 = Math.round(t * 100) / 100; o.v = WAR.march; }
  return o;
}
function endBattle(game, W, L, t) {
  const H = game.realms.H, where = nearSid(game, W.x, W.y);
  H.acc.delete(W.id); H.acc.delete(L.id);
  const lostSiege = L.phase.startsWith('siege');
  // the loser: home with what is left (or nothing left)
  if (L.n < WAR.battle.wipe) game.net.emit('realm.army', { del: L.id, scar: lostSiege ? L.target : undefined, wt: Math.round(t) });
  else { const l = resume(game, { ...L }, t); goHome(game, l, t, lostSiege ? { scar: L.target, wt: Math.round(t) } : {}); }
  // the winner: back to what it was doing (a relief that broke a siege: some stay to guard the place, the rest go home)
  const w = resume(game, { ...W }, t);
  if (W.mission === 'relief' && lostSiege) {
    const T = L.target, realm = realmOf(game), hg = homeOf(game, T), room = Math.max(0, capOf(realm.settlements[T]) - (hg?.n || 0));
    const stay = ownerOf(game, T) === W.k ? Math.min(room, w.n) : 0;
    if (stay >= w.n) game.net.emit('realm.army', { del: w.id, gar: [[T, hg.n + stay]], news: ['lift', L.k, W.k, T, 0] });
    else goHome(game, { ...w, n: w.n - stay, state: 'camp' }, t, { gar: stay ? [[T, hg.n + stay]] : undefined, news: ['lift', L.k, W.k, T, 0] });
    return;
  }
  emitArmy(game, w, { news: (W.bn || 0) + (L.bn || 0) >= WAR.battle.newsMin ? ['won', W.k, L.k, where, W.n] : undefined });
}

// ---------- host: sieges by numbers ----------
function perimeter(game, sid) {
  const H = game.realms.H;
  let P = H.per.get(sid);
  if (P) return P;
  const realm = realmOf(game), L = game.towns.layout(sid); // (the plan: from the chunk worker when the place was ever near; else made here, once)
  if (!L) return null;
  P = perimeterOf({ L, sid, s: realm.settlements[sid] });
  H.per.set(sid, P);
  return P;
}
const pieceState = (game, sid, k) => game.towns?.state?.get(`t${sid}.${k}`) || null;
// the wall pieces facing the camp, nearest first (not gone)
function facing(game, sid, a, gate = false) {
  const P = perimeter(game, sid);
  if (!P) return [];
  const w = game.world, fx = w.dx(a.x, P.cx), fy = a.y - P.cy, fl = Math.hypot(fx, fy) || 1;
  const out = [];
  for (const q of P.pieces.values()) {
    if (!!q.gate !== gate) continue;
    if (pieceState(game, sid, q.k)?.gone) continue;
    if (!gate && (q.fx * fx + q.fy * fy) / fl < 0.35) continue; // (the walls facing the camp; the ram goes round to the nearest gate)
    out.push([Math.hypot(w.dx(q.cx, a.x), q.cy - a.y), q]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1].k - q[1].k);
  return out.map((e) => e[1]);
}
function breached(game, sid) {
  const P = perimeter(game, sid);
  if (!P) return { open: false, gate: false };
  let open = false, gate = false;
  for (const q of P.pieces.values()) if (pieceState(game, sid, q.k)?.gone) { if (q.gate) gate = true; else open = true; }
  return { open, gate };
}
function siegeHour(game, a, t, roll) {
  const realm = realmOf(game), S = WAR.siege, T = a.target, s = realm.settlements[T], own = ownerOf(game, T);
  if (own === a.k) { goHome(game, a, t, { scar: T, wt: Math.round(t) }); return; }
  if (!atWar(game, a.k, own)) { goHome(game, a, t, { news: ['lift', a.k, own, T, 0], scar: T, wt: Math.round(t) }); return; }
  const b = copy(a), g = homeOf(game, T);
  let gn = g?.n || 0;
  b.hrs++;
  const wk = wallKind(s), stone = wk === 'city' || wk === 'castle';
  if (b.phase === 'camp' && b.hrs >= S.campHours) b.phase = 'build';
  const hit = [], gone = [];
  const dmgOf = (q) => (pieceState(game, T, q.k)?.dmg || 0) / 100;
  const pending = new Map();
  const strike = (q, d) => { const v = Math.min(1, (pending.get(q.k) ?? dmgOf(q)) + d); pending.set(q.k, v); };
  if (b.phase === 'build' || b.phase === 'bombard') {
    // the engines the camp makes for these walls
    const want = S.want[wk === 'castle' ? 'stone' : wk] || {}, order = ['ram', 'cat', 'treb', 'tower'], idx = { treb: 0, cat: 1, ram: 2, tower: 3 };
    b.bp += b.n * S.buildPer;
    for (const e of order) {
      const need = (want[e] || 0) - b.eng[idx[e]];
      if (need > 0 && b.bp >= S.cost[e]) { b.bp -= S.cost[e]; b.eng[idx[e]]++; break; }
    }
    b.bp = Math.round(Math.min(b.bp, 30) * 100) / 100;
    if (b.eng.some((v) => v > 0) || wk === 'none') b.phase = 'bombard';
    // bombardment: trebuchets on stone, catapults on a palisade, the ram on the gate
    if (b.phase === 'bombard' && wk !== 'none') {
      const F = facing(game, T, b);
      const shots = [...Array(b.eng[0]).fill(S.treb), ...Array(stone ? 0 : b.eng[1]).fill(S.cat)];
      for (const sh of shots) {
        if (!F.length || roll() > sh.hit) continue;
        // the crews keep hitting the stretch already cracked (a breach), now and then another piece near it
        const near = F.slice(0, 6), worst = near.reduce((m, q) => ((pending.get(q.k) ?? dmgOf(q)) > (pending.get(m.k) ?? dmgOf(m)) ? q : m), near[0]);
        const q = roll() < 0.7 ? worst : near[Math.min(near.length - 1, Math.floor(roll() * near.length))];
        strike(q, sh.dmg * (0.7 + 0.6 * roll()));
      }
      if (b.eng[2] > 0) {
        const G = facing(game, T, b, true)[0];
        if (G) { strike(G, (/stone/.test(realm && game.towns.layout(T)?.structs[G.k]?.[0] || '') ? S.ram.stone : S.ram.wood) * (0.8 + 0.4 * roll())); b.n = Math.max(0, b.n - S.ramLoss); lost(game, b.k, S.ramLoss); }
      }
    }
  }
  for (const [k, d] of pending) { if (d >= 1) gone.push(k); else hit.push([k, Math.round(d * 1e4) / 1e4]); }
  // the fighting this hour
  const br = breached(game, T), towers = stone && b.eng[3] > 0 && b.hrs >= 8; // (towers at the wall: after the bombardment had its time)
  for (const k of gone) { const q = perimeter(game, T)?.pieces.get(k); if (q?.gate) br.gate = true; else if (q) br.open = true; }
  const W = S.wallK[wk] * (br.open ? S.breachK : br.gate ? S.gateK : towers ? S.towerK : 1);
  const watch = Math.max(0, watchOf(s) - b.dw), D = gn + watch, lv = g?.lv || 1;
  const dPow = powerOf(D, lv) * W, aPow = powerOf(b.n, b.lv);
  const canStorm = b.phase !== 'camp' && (wk === 'none' || br.open || br.gate || towers);
  let la, ld;
  if (canStorm && aPow >= S.assault.need * dPow) { la = Math.round(dPow * S.assault.att * (0.8 + 0.4 * roll())); ld = Math.round(aPow * S.assault.def * (0.8 + 0.4 * roll())); b.phase = 'assault'; }
  else { la = b.phase === 'camp' ? 0 : Math.round(powerOf(D, lv) * S.shoot * S.wallK[wk] * (0.8 + 0.4 * roll())); ld = b.phase === 'camp' ? 0 : Math.round(aPow * S.bomb * (0.8 + 0.4 * roll())); if (b.phase === 'assault') b.phase = 'bombard'; }
  if (b.hrs > S.starveAfter) ld += Math.ceil(D * S.starve);
  la = Math.min(b.n, la); ld = Math.min(D, ld);
  b.n -= la; lost(game, b.k, la); lost(game, own, ld);
  const fromGar = Math.min(gn, ld); gn -= fromGar; b.dw += ld - fromGar;
  const Dleft = gn + Math.max(0, watchOf(s) - b.dw);
  if (hit.length || gone.length) game.net.emit('realm.wall', { sid: T, hit, gone, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10 });
  if (Dleft <= 0 && b.n > 0) { emitArmy(game, b, { gar: [[T, 0]] }); hostCapture(game, T, b.k, game.realms.armies.get(b.id), t); return; }
  const giveUp = b.n < S.giveUp.share * b.n0 || (b.hrs > 6 && powerOf(b.n, b.lv) < S.giveUp.ratio * powerOf(Dleft, lv) * W) || b.hrs > S.giveUp.hours;
  if (giveUp) { goHome(game, b, t, { gar: [[T, gn]], news: ['lift', b.k, own, T, 0], scar: T, wt: Math.round(t) }); return; }
  emitArmy(game, b, { gar: [[T, gn]] });
}

// ---------- host: conquest ----------
function hostCapture(game, sid, k, army = null, t = game.worldTime) {
  const realm = realmOf(game), s = realm?.settlements[sid];
  if (!s || !realm.kingdoms[k] || fallen(game, k)) return false;
  const from = ownerOf(game, sid);
  if (from === k) return false;
  const H = game.realms.H;
  const stay = army ? Math.max(1, Math.min(capOf(s), Math.round(army.n * WAR.siege.hold))) : Math.round(capOf(s) * 0.3);
  game.net.emit('realm.capture', { sid, k, from, n: stay });
  H.placeLost.set(from, (H.placeLost.get(from) || 0) + 1);
  H.placeLost.set(k, (H.placeLost.get(k) || 0) - 1);
  // the players' houses and plots there are lost (docs/REINOS.md §13: back on sale under the new kingdom)
  game.eco?.loseAt?.(sid, 'captured', k);
  // the people come back as the new kingdom's (their colours: game/people.js builds them again with the owner)
  const rec = game.people?.live?.get(sid);
  if (rec) { for (const m of [...rec.ents.values()]) game.people._drop(rec, m); game.people.live.delete(sid); }
  H.per.delete(sid);
  if (army) {
    const left = army.n - stay;
    if (left >= 5) goHome(game, { ...copy(army), n: left, state: 'camp' }, t, { scar: sid, wt: Math.round(t) });
    else { H.acc.delete(army.id); game.net.emit('realm.army', { del: army.id, scar: sid, wt: Math.round(t) }); }
  }
  // a kingdom without a city falls: what it has left goes to the one that took its last city
  if (!fallen(game, from) && !placesOf(game, from).some((q) => q.kind === 'city')) {
    game.net.emit('realm.fall', { k: from, to: k });
    game.eco?.dropKingdom?.(from);
  }
  return true;
}
function hostReport(game, id, r) {
  if (!game.net.auth || !r) return false;
  const a = game.realms.armies.get(id);
  if (!a) return false;
  const b = copy(a);
  if (Number.isFinite(r.n)) b.n = Math.max(0, Math.round(r.n));
  if (Array.isArray(r.eng)) b.eng = [0, 1, 2, 3].map((i) => Math.max(0, Math.round(r.eng[i] || 0)));
  else if (r.eng && typeof r.eng === 'object') b.eng = [r.eng.treb | 0, r.eng.cat | 0, r.eng.ram | 0, r.eng.tower | 0];
  if (typeof r.state === 'string' && ['march', 'camp', 'siege', 'battle', 'retreat'].includes(r.state)) b.state = r.state;
  if (Number.isFinite(r.x) && Number.isFinite(r.y)) { b.x = Math.round(r.x * 100) / 100; b.y = Math.round(r.y * 100) / 100; }
  emitArmy(game, b);
  return true;
}

// ---------- host: the hand-off to phase 3b (§12) ----------
function liveCheck(game, t) {
  const WF = game.warfare;
  if (!WF) return;
  const P = allPlayers(game).filter((p) => p && !p.dead), w = game.world;
  for (const id of fieldIds(game.realms)) { const a = game.realms.armies.get(id); if (!a) continue;
    if (a.state === 'home') continue;
    if (a.state === 'march' || a.state === 'retreat') placeArmy(game, a, t);
    let d = Infinity;
    for (const p of P) d = Math.min(d, Math.hypot(w.dx(p.x, a.x), p.y - a.y));
    if (a.state === 'siege') { const s = realmOf(game).settlements[a.target]; for (const p of P) d = Math.min(d, Math.hypot(w.dx(p.x, s.x), p.y - s.y)); }
    if (!a.live && d < WAR.live) {
      const b = copy(a);
      if (b.state === 'march' || b.state === 'retreat') { b.d0 = Math.round(distAt(a, t) * 100) / 100; b.t0 = Math.round(t * 100) / 100; b.v = 0; b.x = Math.round(a.x * 100) / 100; b.y = Math.round(a.y * 100) / 100; }
      b.live = 1;
      emitArmy(game, b);
      try { WF.materialize?.(game.realms.armies.get(a.id)); } catch (e) { console.error(e); }
    } else if (a.live && d > WAR.liveOut) {
      let r = null;
      try { r = WF.dematerialize?.(a.id) || null; } catch (e) { console.error(e); }
      const b = copy(a);
      b.live = 0;
      if (r) {
        if (Number.isFinite(r.n)) b.n = Math.max(0, Math.round(r.n));
        if (Array.isArray(r.eng)) b.eng = [0, 1, 2, 3].map((i) => Math.max(0, r.eng[i] | 0));
        else if (r.eng && typeof r.eng === 'object') b.eng = [r.eng.treb | 0, r.eng.cat | 0, r.eng.ram | 0, r.eng.tower | 0];
        if (r.siege && typeof r.siege === 'object') for (const k of ['hrs', 'dw', 'bp']) if (Number.isFinite(r.siege[k])) b[k] = r.siege[k];
        if (r.siege?.phase) b.phase = String(r.siege.phase).slice(0, 10);
      }
      if (b.state === 'march' || b.state === 'retreat') { const g = routeOf(game, a); b.d0 = g ? Math.round(project(game, g, a.x, a.y) * 100) / 100 : b.d0; b.t0 = Math.round(t * 100) / 100; b.v = WAR.march; }
      if (b.n <= 0) { game.realms.H.acc.delete(a.id); game.net.emit('realm.army', { del: a.id }); } else emitArmy(game, b);
    }
  }
}

// ---------- host: campaign plans ----------
function plan(game, t) {
  const R = game.realms, realm = realmOf(game), H = R.H, hr = HOURLEN(game);
  for (const [key, r] of [...R.rels]) {
    if (r.r !== 'war') continue;
    const [x, y] = key.split('.').map(Number);
    for (const [s, e] of [[x, y], [y, x]]) {
      if (fallen(game, s) || fallen(game, e)) continue;
      const at = H.planAt.get(s + '>' + e) || 0;
      if (t < at) continue;
      H.planAt.set(s + '>' + e, t + WAR.planEvery * hr * (0.8 + 0.4 * h01(s, e, Math.floor(t))));
      // relief: a place of ours besieged by them
      for (const A of siegeIndex(game).values()) {
        if (A.k !== e || ownerOf(game, A.target) !== s || A.live) continue;
        if ([...R.armies.values()].some((q) => q.k === s && q.mission === 'relief' && q.target === A.target)) continue;
        sendForce(game, s, A.target, powerOf(A.n, A.lv) * WAR.reliefK, 'relief', ['relief', s, e, A.target, 0], t);
      }
      // an attack: one campaign at a time per war and side
      if ([...R.armies.values()].some((q) => q.k === s && q.mission === 'attack' && q.target >= 0 && ownerOf(game, q.target) === e)) continue;
      const mine = placesOf(game, s).map((q) => q.id);
      if (!mine.length) continue;
      const D = dijkstra(realm, mine, WAR.maxRoute);
      const cand = [];
      for (const q of realm.settlements) {
        if (ownerOf(game, q.id) !== e || siegeIndex(game).has(q.id)) continue;
        const d = D.dist[q.id] < Infinity ? D.dist[q.id] : crowDist(game, mine, q) * WAR.overlandK; // (no road: across country)
        if (!(d <= WAR.overland * WAR.overlandK)) continue;
        const def = defenseOf(game, q.id);
        const score = d + def.pow * 3 + (q.kind === 'city' ? 500 : q.kind === 'castle' ? 250 : 0) - (q.k === s ? 400 : 0) + h01(q.id, s, R.day) * 120;
        cand.push([score, q.id, def.pow]);
      }
      cand.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (const [, T, dp] of cand.slice(0, 5)) if (sendForce(game, s, T, dp * WAR.force, 'attack', ['march', s, e, T, 0], t)) break;
    }
  }
}
// gather the soldiers of kingdom k's places near target T until `need` power: one army per contingent (≤ WAR.contingents)
function sendForce(game, k, T, need, mission, news, t) {
  const realm = realmOf(game), D = dijkstra(realm, [T], WAR.muster), sT = realm.settlements[T];
  const pool = [], byRoad = placesOf(game, k).some((q) => q.id !== T && D.dist[q.id] < Infinity);
  for (const q of placesOf(game, k)) {
    if (q.id === T || siegeIndex(game).has(q.id)) continue;
    // by road from the places within the muster distance; with no road to the target at all, across country from the
    // nearest places of the same land mass
    const d = D.dist[q.id] < Infinity ? D.dist[q.id] : byRoad ? Infinity : Math.hypot(game.world.dx(q.x, sT.x), q.y - sT.y) * WAR.overlandK;
    if (!(d <= (byRoad ? WAR.muster : WAR.overland * WAR.overlandK))) continue;
    const g = homeOf(game, q.id);
    if (!g) continue;
    const keep = Math.ceil(capOf(q) * WAR.keep[q.kind]), n = g.n - keep;
    if (n >= 3) pool.push([d, q.id, n, g.lv]);
  }
  pool.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (!pool.length) return false;
  // the muster: the strongest garrison among the places nearest the target (a castle before a village); the others within
  // WAR.joinRange of it join there, and the campaign marches as ONE army (fewer, bigger battles)
  const near = pool.filter((p) => p[0] <= pool[0][0] + 400).sort((p, q) => powerOf(q[2], q[3]) - powerOf(p[2], p[3]) || p[0] - q[0]);
  const [, msid, mn, mlv] = near.find((p) => pathTo(game, D, p[1], T)) || [];
  if (msid == null) return false;
  const Dm = dijkstra(realm, [msid], WAR.joinRange);
  let pow = powerOf(mn, mlv);
  const go = [];
  for (const [, sid, n, lv] of pool) {
    if (pow >= need * 1.15 || go.length + 1 >= WAR.contingents) break;
    if (sid === msid || n < 6 || !(Dm.dist[sid] < Infinity)) continue; // (a handful of villagers is not worth the march)
    go.push([sid, n]); pow += powerOf(n, lv);
  }
  if (pow < need || mn + go.reduce((s, q) => s + q[1], 0) < WAR.minArmy) return false; // (too weak, or a handful: no campaign)
  if (!go.length) { news[4] = mn; return !!launch(game, k, msid, T, mn, mission, D, news, t); }
  const M = launch(game, k, msid, T, mn, mission, D, null, t, { muster: true });
  if (!M) return false;
  for (const [sid, n] of go) launch(game, k, sid, msid, n, 'join', Dm, null, t, { grp: M.id });
  return true;
}
// the straight distance from the nearest of `sids` to place q
function crowDist(game, sids, q) {
  const S = realmOf(game).settlements;
  let d = Infinity;
  for (const id of sids) { const s = S[id]; if (realmOf(game).kingdoms[s.k].comp !== realmOf(game).kingdoms[q.k].comp) continue; d = Math.min(d, Math.hypot(game.world.dx(s.x, q.x), s.y - q.y)); }
  return d;
}

// ---------- host: the daily diplomacy ----------
// the pairs of kingdoms that have relations: neighbours (a border, or a road across free land) and — on one land mass —
// rivals whose capitals are within WAR.rivalRange (no border: their tension grows slower, their armies march across
// country); `far` marks the latter
const PAIRS = new WeakMap();
function neighbourPairs(game) {
  const realm = realmOf(game);
  let base = PAIRS.get(realm);
  if (!base) {
    base = [];
    for (const K of realm.kingdoms) for (const j of K.neighbours) if (K.id < j && canReach(realm, K.id, j)) base.push([K.id, j, 0]);
    for (const A of realm.kingdoms) for (const B of realm.kingdoms) {
      if (A.id >= B.id || !canReach(realm, A.id, B.id) || base.some((p) => p[0] === A.id && p[1] === B.id)) continue;
      const a = realm.settlements[A.capital], b = realm.settlements[B.capital];
      if (Math.hypot(game.world.dx(a.x, b.x), a.y - b.y) <= WAR.rivalRange) base.push([A.id, B.id, 1]);
    }
    PAIRS.set(realm, base);
  }
  const out = base.slice();
  for (const [key] of game.realms.rels) { const [x, y] = key.split('.').map(Number); if (!out.some((p) => p[0] === x && p[1] === y)) out.push([x, y, 1]); }
  return out;
}
function dayTick(game, day, mult) {
  const R = game.realms, realm = realmOf(game), net = game.net, T = WAR.tension, H = R.H;
  const roll = () => net.roll();
  // the home armies: recruits (a place under siege recruits nobody), the level of the kingdom's people (§7b)
  const gar = [];
  for (const s of realm.settlements) {
    const g = homeOf(game, s.id);
    if (!g) continue;
    const cap = capOf(s), war = enemiesOf(game, g.k).length > 0;
    let n = g.n;
    if (!siegeIndex(game).has(s.id) && n < cap) n = Math.min(cap, n + Math.ceil(cap * WAR.recruit * (war ? WAR.recruitWar : 1) * mult));
    else if (n > cap) n = cap; // (never more than its maximum: the extra men go home — a garrison over it after a return / a test)
    gar.push([s.id, n, realmNpcLevel(game, s)]);
  }
  // tensions
  const pow = new Map();
  const P = (k) => { if (!pow.has(k)) pow.set(k, strength(game, k)); return pow.get(k); };
  const pairs = neighbourPairs(game).filter(([a, b]) => !fallen(game, a) && !fallen(game, b));
  const tens = [];
  for (const [a, b, far] of pairs) {
    const key = relKey(a, b), r = R.rels.get(key);
    let t = R.tens.get(key) ?? T.init[0];
    let d = (T.base[0] + (T.base[1] - T.base[0]) * h01(realm.seed, a, b, 7)) * (far ? WAR.rivalBase : 1);
    const pa = P(a), pb = P(b);
    if (pa > pb * 1.4 || pb > pa * 1.4) d += T.rival;
    d += T.grudge * Math.min(3, R.past.get(key) || 0);
    if (placesOf(game, a).some((q) => q.k === b) || placesOf(game, b).some((q) => q.k === a)) d += T.lostLand;
    if (r?.r === 'ally') d += T.ally;
    if (r?.r === 'truce') d += T.truce;
    if ((r?.r !== 'war') && (warsOf(game, a) || warsOf(game, b))) d += T.busy;
    d += (roll() - 0.5) * T.noise;
    t = clamp(t * T.keep + d * mult, 0, 100);
    tens.push([key, Math.round(t * 10) / 10]);
  }
  // war weariness
  const weary = [];
  for (const [key, r] of R.rels) {
    if (r.r !== 'war') continue;
    const [a, b] = key.split('.').map(Number), Wy = WAR.weary;
    const wa = clamp(r.wa + (Wy.day + (H.lost.get(a) || 0) * Wy.perSoldier + (H.placeLost.get(a) || 0) * (H.placeLost.get(a) > 0 ? Wy.placeLost : -Wy.placeWon)) * 1, 0, 100);
    const wb = clamp(r.wb + (Wy.day + (H.lost.get(b) || 0) * Wy.perSoldier + (H.placeLost.get(b) || 0) * (H.placeLost.get(b) > 0 ? Wy.placeLost : -Wy.placeWon)) * 1, 0, 100);
    weary.push([key, Math.round(wa), Math.round(wb)]);
  }
  H.lost.clear(); H.placeLost.clear();
  net.emit('realm.day', { day, gar, tens, weary });
  if (H.noDiplo) return; // (tests: the AI's diplomacy paused — dbg.stop)
  // truces ending
  for (const [key, r] of [...R.rels]) if (r.r === 'truce' && day >= r.until) { const [a, b] = key.split('.').map(Number); net.emit('realm.rel', { a, b, rel: 'neutral', why: 'expire' }); }
  // peace: the weary sue for it
  for (const [key, r] of [...R.rels]) {
    if (r.r !== 'war') continue;
    const [a, b] = key.split('.').map(Number), wmax = Math.max(r.wa, r.wb);
    let p = wmax > WAR.peaceAt ? (wmax - WAR.peaceAt) * WAR.peaceP : 0;
    if (day - r.since >= 10) p += 0.15;
    if (p > 0 && roll() < p) net.emit('realm.rel', { a, b, rel: 'truce', until: day + WAR.truceDays, why: 'peace' });
  }
  // alliances made and broken
  for (const [a, b] of pairs) {
    const key = relKey(a, b), r = R.rels.get(key), t = R.tens.get(key) ?? 50;
    if (r?.r === 'ally') { if (t > WAR.breakAbove && roll() < WAR.breakP) net.emit('realm.rel', { a, b, rel: 'neutral', why: 'break' }); continue; }
    if (r || t > WAR.allyBelow || alliesOf(game, a).length >= WAR.maxAllies || alliesOf(game, b).length >= WAR.maxAllies) continue;
    const common = enemiesOf(game, a).some((e) => enemiesOf(game, b).includes(e));
    if (roll() < WAR.allyP * (common ? 3 : 1)) net.emit('realm.rel', { a, b, rel: 'ally', why: 'pact' });
  }
  // war: the strong declare on the weak when the tension runs high (never in the grace, never past the caps)
  const alive = realm.kingdoms.filter((K) => !fallen(game, K.id)).length, cap = Math.max(1, Math.ceil(alive / WAR.maxWarsK));
  const wars = () => [...R.rels.values()].filter((r) => r.r === 'war').length;
  const cand = pairs.map(([a, b]) => [R.tens.get(relKey(a, b)) ?? 0, a, b]).sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
  for (const [t, a, b] of cand) {
    if (t < WAR.declareAt || wars() >= cap) break;
    if (R.rels.get(relKey(a, b)) || inGrace(game, a, day) || inGrace(game, b, day)) continue;
    if (warsOf(game, a) >= WAR.maxWarsPer || warsOf(game, b) >= WAR.maxWarsPer) continue;
    if (roll() >= Math.min(0.6, (t - WAR.declareAt) * WAR.declareP)) continue;
    const by = P(a) >= P(b) ? a : b, vs = by === a ? b : a;
    net.emit('realm.rel', { a: by, b: vs, rel: 'war', by, why: 'declare' });
    // a defensive pact: the victim's allies join against the aggressor
    for (const x of alliesOf(game, vs)) {
      if (x === by || R.rels.get(relKey(x, by)) || !canReach(realm, x, by) || inGrace(game, x, day) || warsOf(game, x) >= WAR.maxWarsPer) continue;
      net.emit('realm.rel', { a: x, b: by, rel: 'war', by: x, why: 'pact' });
    }
  }
}

// ---------- host: war and the markets ("tudo se conversa") ----------
// each day of war: the places near the front want weapons and iron (a shortage in the market news, game/eco.js), a
// besieged place wants food
const ARMS = ['arrow', 'sword_iron', 'spear_iron', 'shield_iron', 'iron_bar', 'bow_wood', 'armor_leather'];
const FOOD = ['bread', 'wheat', 'meat'];
function marketNews(game, day, roll, ev) {
  const R = game.realms, realm = realmOf(game);
  if (!R?.rels || !realm || !game.eco) return [];
  const out = [], has = (sid, gi) => ev.some((e) => e[0] === sid && e[1] === gi) || out.some((e) => e[0] === sid && e[1] === gi);
  const push = (sid, id) => { const gi = GI[id]; if (gi == null || has(sid, gi) || out.length >= 6) return; const P = profileOf(game, sid); if (P && !P.deals[gi]) return; out.push([sid, gi, Math.round(2.1 * 100), day + 3]); };
  for (const A of siegeIndex(game).values()) push(A.target, FOOD[Math.floor(roll() * FOOD.length)]);
  for (const [key, r] of R.rels) {
    if (r.r !== 'war') continue;
    const [a, b] = key.split('.').map(Number);
    for (const [s, e] of [[a, b], [b, a]]) {
      const theirs = placesOf(game, e);
      const front = placesOf(game, s).filter((q) => q.kind !== 'village' || theirs.some((o) => Math.hypot(game.world.dx(o.x, q.x), o.y - q.y) < 700));
      if (!front.length) continue;
      const q = front[Math.floor(roll() * front.length)];
      push(q.id, ARMS[Math.floor(roll() * ARMS.length)]);
    }
  }
  return out;
}

// ---------- host: start / the clock ----------
function startTick(game) {
  const realm = realmOf(game), w = game.world, sp = w.spawn;
  const s0 = realm.settlements.find((s) => Math.hypot(w.dx(s.x, sp.x), s.y - sp.y) <= s.r + 2);
  const k0 = s0 ? s0.k : ownerAt(game, sp.x, sp.y);
  const tens = [];
  for (const [a, b, far] of neighbourPairs(game)) if (!far || h01(realm.seed, a, b, 5) < 0.6) tens.push([relKey(a, b), Math.round((WAR.tension.init[0] + (WAR.tension.init[1] - WAR.tension.init[0]) * h01(realm.seed, a, b, 3)) * 10) / 10]);
  game.net.emit('realm.start', { day0: game.env.dayIndex | 0, k0, tens });
}
// a big jump of the clock: only the last WAR.maxSkip days are simulated; the marches shift with the dropped time
function rebase(game, drop) {
  for (const a of [...game.realms.armies.values()]) {
    if ((a.state !== 'march' && a.state !== 'retreat') || a.live) continue;
    const b = copy(a);
    b.t0 = Math.round((a.t0 + drop) * 100) / 100;
    emitArmy(game, b);
  }
}
// (every loop below walks a list of ids and takes each army as it is NOW: an op replaces an army's object, and one army's
// event — a battle's end, an arrival — changes others)
const fieldIds = (R) => { const out = []; for (const [id, a] of R.armies) if (a.state !== 'home') out.push(id); return out; };
function simStep(game, t, dt) {
  const R = game.realms, H = R.H, roll = () => game.net.roll();
  // marches: positions now, arrivals
  for (const id of fieldIds(R)) {
    const a = R.armies.get(id);
    if (!a || a.live || (a.state !== 'march' && a.state !== 'retreat')) continue;
    const g = routeOf(game, a);
    if (!g) { mergeHome(game, a); continue; }
    placeArmy(game, a, t);
    if (distAt(a, t) >= stopAt(game, a, g)) arrive(game, a, t);
  }
  // meetings: field armies of kingdoms at war this close fight (a retreating army is let go)
  const F = [...R.armies.values()].filter((a) => !a.live && (a.state === 'march' || a.state === 'siege' || a.state === 'camp'));
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
    const a = R.armies.get(F[i].id), b = R.armies.get(F[j].id);
    if (!a || !b || a.state === 'battle' || b.state === 'battle' || a.state === 'home' || b.state === 'home' || !atWar(game, a.k, b.k)) continue;
    if (a.state === 'siege' && b.state === 'siege') continue;
    if (Math.hypot(game.world.dx(a.x, b.x), a.y - b.y) > WAR.meet) continue;
    startBattle(game, a, b, t);
  }
  // musters: the main army sets out when its contingents have come (or after WAR.musterWait hours)
  for (const id of fieldIds(R)) {
    const a = R.armies.get(id);
    if (!a || a.state !== 'camp' || a.phase !== 'muster' || a.live) continue;
    const waiting = [...R.armies.values()].some((q) => q.grp === a.id && q.mission === 'join' && q.state === 'march');
    if (!waiting || t - a.since > WAR.musterWait * HOURLEN(game)) depart(game, a, t);
  }
  // battles: a round every WAR.battle.round seconds
  for (const id of fieldIds(R)) {
    const a = R.armies.get(id);
    if (!a || a.state !== 'battle' || a.live) continue;
    const b = R.armies.get(a.foe);
    if (!b || b.state !== 'battle') { const o = resume(game, copy(a), t); emitArmy(game, o); continue; }
    if (a.id > b.id || b.live) continue;
    const acc = H.acc.get(a.id) || { b: 0, s: 0 };
    acc.b += dt;
    H.acc.set(a.id, acc);
    if (acc.b < WAR.battle.round) continue;
    acc.b -= WAR.battle.round;
    battleRound(game, a, b, t, roll);
  }
  // sieges: an hour at a time
  const hr = HOURLEN(game);
  for (const id of fieldIds(R)) {
    const a = R.armies.get(id);
    if (!a || a.state !== 'siege' || a.live) continue;
    const acc = H.acc.get(a.id) || { b: 0, s: 0 };
    acc.s += dt;
    H.acc.set(a.id, acc);
    if (acc.s < hr) continue;
    acc.s -= hr;
    siegeHour(game, a, t, roll);
  }
  if (!H.noPlan) plan(game, t);
}
export function realmsSystem() {
  let tick = 0, posT = 0;
  return {
    sync: 'host', // the kingdoms' strategy: decided here, replicated by the ops of mut/realms.js
    update(game, dt) {
      const R = game.realms, realm = realmOf(game);
      if (!R?.H || !realm) return;
      tick -= dt;
      if (tick > 0) return;
      tick = 0.5;
      if (R.day0 < 0) { startTick(game); return; }
      if (R.H.frozen) { R.H.t = game.worldTime; return; }
      const now = game.worldTime, H = R.H, max = WAR.maxSkip * DAYLEN(game);
      if (H.t == null || now < H.t) H.t = now;
      if (now - H.t > max) { const drop = now - H.t - max; H.t = now - max; rebase(game, drop); }
      const t0 = performance.now();
      let n = 0;
      while (H.t < now && n < 4000) { const st = Math.min(WAR.step, now - H.t); H.t += st; simStep(game, H.t, st); n++; }
      if ((posT -= 0.5) <= 0) { posT = 1; liveCheck(game, now); }
      const day = game.env.dayIndex | 0, t1 = performance.now();
      if (day > R.day && (game.env.hour >= 6.5 || day > R.day + 1)) { dayTick(game, day, Math.min(WAR.maxSkip, Math.max(1, day - R.day))); H.stats.dayMs = Math.round((performance.now() - t1) * 100) / 100; }
      // (cost: a tick every 0.5 s — the steps of the clock since the last one; the daily diplomacy apart)
      const ms = t1 - t0, S = H.stats;
      S.ticks++; S.sum += ms; S.max = Math.max(S.max, ms); S.steps = n; if (n > 1) S.maxSkip = Math.max(S.maxSkip, ms);
    },
  };
}
// every peer: the derived positions of the armies in the field (the map, the radar, 3b)
export function realmsPosSystem() {
  let t = 0;
  return {
    sync: 'all',
    update(game, dt) {
      const R = game.realms;
      if (!R?.armies?.size) return;
      t -= dt;
      if (t > 0) return;
      t = 0.25;
      for (const a of R.armies.values()) if (a.state === 'march' || a.state === 'retreat') placeArmy(game, a, game.worldTime);
    },
  };
}

// ---------- tests / debug (host) ----------
function makeDebug(game) {
  const R = () => game.realms;
  return {
    war: (a, b) => game.net.emit('realm.rel', { a, b, rel: 'war', by: a, why: 'debug' }),
    peace: (a, b, days = WAR.truceDays) => game.net.emit('realm.rel', { a, b, rel: 'truce', until: (game.env.dayIndex | 0) + days, why: 'debug' }),
    ally: (a, b) => game.net.emit('realm.rel', { a, b, rel: 'ally', why: 'debug' }),
    neutral: (a, b) => game.net.emit('realm.rel', { a, b, rel: 'neutral', why: 'debug' }),
    // a campaign of kingdom k on place T now (its contingents from the places near it): true when it went
    attack: (k, T, need = 0) => sendForce(game, k, T, need || defenseOf(game, T).pow * WAR.force, 'attack', ['march', k, ownerOf(game, T), T, 0], game.worldTime),
    // one army of n soldiers from place `from` to place T (mission attack / relief)
    launch: (from, T, n, mission = 'attack') => { const k = ownerOf(game, from), D = dijkstra(realmOf(game), [T], Infinity); return launch(game, k, from, T, n, mission, D, mission === 'attack' ? ['march', k, ownerOf(game, T), T, n] : ['relief', k, -1, T, n]); },
    route: (from, T) => { const D = dijkstra(realmOf(game), [T], Infinity); const p = pathTo(game, D, from, T); return p ? { ...p, len: geomOf(game, p).len, road: D.dist[from] < Infinity } : null; },
    pairs: () => neighbourPairs(game),
    garrison: (sid, n) => game.net.emit('realm.army', { gar: [[sid, n]] }),
    capture: (sid, k) => hostCapture(game, sid, k, null),
    day: () => dayTick(game, game.env.dayIndex | 0, 1), // (the diplomacy of today once more: the grace and the truces count the world's day)
    plan: () => { game.realms.H.planAt.clear(); plan(game, game.worldTime); },
    stop: (on = true) => { game.realms.H.noPlan = on; game.realms.H.noDiplo = on; },
    freeze: (on = true) => { game.realms.H.frozen = on; }, // (tests: nothing moves — a synthetic setup)
    grace: (k) => inGrace(game, k),
    pos: (id) => { const a = R().armies.get(id); return a ? placeArmy(game, a, game.worldTime) && [a.x, a.y] : null; },
  };
}
