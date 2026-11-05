// The economy of the kingdoms (docs/REINOS.md §6 and "Fase 2 — economia"): gold coins, a market in every settlement
// (supply and demand, Mount & Blade style), reputation per kingdom, the job board of the murals, houses / plots and the
// kingdoms' daily tax. `game.eco` (do not confuse with `game.econ`, the crafting tools API of economy.js).
//
// Shared state (written only by the op appliers of mut/eco.js; snapshot / save `eco`, digest part `eco`):
//   E.day                      the last economy day the host processed (the daily tick: markets, bills, expired jobs)
//   E.mk   Map sid → Int32Array(NG)  each settlement's stock of every good (content/eco.js GOODS)
//   E.ev   [[sid, gi, mult×100, untilDay]]  market news: a glut / a shortage for a few days
//   E.pl   Map uid → { name, k (kingdom joined | −1 = traveller), rep {k: n}, vol {k: coins}, trep {k: n today},
//                      jobs [job], done [jobId] }
//   E.pr   Map propId → { u (owner uid), name, mode 'own' | 'rent', day (since), due (coins owed), warn (days late) }
//   E.st   Map townPieceId → slots   the contents of the settlements' chests (a bought / rented house's chests)
// Player identity: a uid kept in localStorage (`wos.uid`; tests: 'u' + ?pid) — the session pid changes every time a tab
// opens, the uid does not, so a player keeps its houses and reputation across sessions. The host maps session pids to
// uids (E.who, host only, from the intent eco.hello); records are keyed by uid, owner effects still go to the pid.
//
// Host (ecoSystem, sync 'host'): the daily tick (market drift toward each place's balance, noise, news, slow spreading
// between the markets of one land mass — never across the sea —, bills of tax / rent, expired jobs) and the job progress
// seen in the ops (net.js calls E.onOp before applying: crops harvested on a town's fields, rock mined near its mine,
// trees felled, animals hunted, the night's dead killed near the town).
// Owner: the bill (own message eco.collect) is paid from the coins in the BACKPACK (coins kept in chests never count).

import { GOODS, NG, GI, PRICE, MARKET, SEASON_FOOD, SEASON_MEAT, CROP_FOODS, WARM_CLOTHES, EVENTS, RANKS, rankOf, REP, JOB_KINDS, JOB_MAX, BAD_RANKS, badRankOf, rankName, bandOf, INHERIT,
  GIVER_NAMES, HOME_KEYS, PROP, CROP_GOOD, CROP_PT, SPECIES_GOODS, COIN, PARCEL, TRADE, JOB_SITE } from './content/eco.js';
import { ITEMS, BUILDINGS, SPECIES } from './data.js';
import { baseHeight } from '../world/planet/chunk.js';
import { canReach } from '../world/realm/realm.js';
import { zoneSeason, slotClock, seasonClock } from './seasons.js';
import { YEAR_DAYS } from './calendar.js';
import { findObj } from './mut/objects.js';
import { dimsOf, TOWN } from './mut/structures.js';
import { ownerOf } from './mut/realms.js'; // phase 3a: the kingdom a place belongs to now (docs/REINOS.md §13)
import { cropFields, cropTotal, fieldsLeft, replantFields, survey, nearestPlant, nearestTarget, areaCount, inField, CROP_TYPE } from './fields.js'; // (jobs that can be done: docs/REINOS.md §10)

export { GOODS, NG, GI, RANKS, rankOf, BAD_RANKS, badRankOf, rankName, bandOf };
const DEV = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);

// ---------- small helpers ----------
export const h32 = (...v) => { let h = 2166136261; for (const x of v) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; } return h >>> 0; };
const hf = (...v) => h32(...v) / 4294967296;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const DIRS = ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'];
export const dirPt = (dx, dy) => DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];

// ---------- state ----------
export function ecoState(game) {
  if (!game.eco) game.eco = {};
  const E = game.eco;
  if (!E.mk) Object.assign(E, { day: -1, mk: new Map(), ev: [], pl: new Map(), pr: new Map(), st: new Map(), feat: new Map(), v: 0, who: new Map(), pend: new Map(), pu: new Map() }); // (pu: session pid → uid on every peer — op eco.who; phase 3c: who is who in a fight)
  return E;
}
export const realmOf = (game) => game.towns?.realm || null;
export const settlement = (game, sid) => realmOf(game)?.settlements[sid] || null;
export const kingdomOf = (game, k) => (k >= 0 ? realmOf(game)?.kingdoms[k] || null : null);

// ---------- identity ----------
let UID = null;
export function localUid() {
  if (UID) return UID;
  try {
    const forced = DEV ? new URLSearchParams(location.search).get('pid') : null; // (tests: every frame of the harness is another player)
    if (forced) return (UID = 'u' + forced.slice(0, 12));
    let id = localStorage.getItem('wos.uid');
    if (!id) { id = 'u' + Math.random().toString(36).slice(2, 12); localStorage.setItem('wos.uid', id); } // sync-ok: the player's identity (like playerId), never world state
    return (UID = id);
  } catch { return (UID = 'u' + Math.random().toString(36).slice(2, 12)); } // sync-ok: the player's identity
}
// my uid (a guest whose uid was taken by another tab of the same browser gets the host's answer: E.me)
export const meUid = (game) => game.eco?.me || localUid();
// the uid of a session pid (host: the map from eco.hello; the local player: its own)
export function uidOf(game, pid) {
  if (pid == null) return null;
  if (pid === game.net.pid) return meUid(game);
  return game.eco?.who?.get(pid) || null;
}
const pidOfEnt = (game, who) => (who ? who.pid || (who === game.player ? game.net.pid : null) : null);
export const recOf = (game, uid) => (uid ? game.eco?.pl.get(uid) || null : null);
export const myRec = (game) => recOf(game, meUid(game));
export const repOf = (game, uid, k) => recOf(game, uid)?.rep[k] | 0;
export const memberOf = (game, uid) => { const r = recOf(game, uid); return r && r.k >= 0 ? r.k : -1; };
// can this player deal with kingdom k? A traveller: always. A member: its own kingdom and the kingdoms its own reaches by
// land and is not at war with (phase 3: game.realms.atWar)
export function dealReason(game, uid, k) {
  const mk = memberOf(game, uid);
  if (mk < 0 || mk === k) return null;
  const R = realmOf(game);
  if (!canReach(R, mk, k)) return `O Reino de ${R.kingdoms[mk].name} não tem relações com ${R.kingdoms[k].name} (outra terra). Viajantes comerciam com todos.`;
  if (game.realms?.atWar?.(mk, k)) return `O Reino de ${R.kingdoms[mk].name} está em guerra com ${R.kingdoms[k].name}`;
  return null;
}

// ---------- the settlements' economic profile ----------
// What a place makes and needs: from its buildings / fields / pens when its plan is known here (layout cached), else
// from the same odds the planner uses (abstract, cheap: every place of the world on the host). p / c: production /
// consumption strength per good (0..~3), ref: the reference stock (demand), deals: the goods traded there.
const PROF = new WeakMap();
// The features of a place come from E.feat (replicated: the host publishes them, op eco.feat, once it knows the place's
// plan — every peer then prices it the same, whatever plans it has cached itself), else from the planner's odds.
export function profileOf(game, sid) {
  const R = realmOf(game);
  if (!R || !R.settlements[sid]) return null;
  let M = PROF.get(R);
  if (!M) PROF.set(R, (M = new Map()));
  let P = M.get(sid);
  const F = game.eco?.feat?.get(sid) || null;
  if (P && P.feat === F) return P;
  P = makeProfile(game, R, R.settlements[sid], F);
  M.set(sid, P);
  return P;
}
const FEATS = ['sawmill', 'smithy', 'mine', 'weaver', 'tavern', 'chapel', 'stable', 'granary', 'storehouse', 'barracks', 'keep', 'farmhouse'];
// the features of a place's plan: { b: {building key: n}, crops: {good: fields}, pens: {species: n} }
export function featuresOf(L) {
  const b = {}, crops = {}, pens = {};
  for (const q of L.buildings) if (FEATS.includes(q.key)) b[q.key] = (b[q.key] || 0) + 1;
  for (const q of L.fields) { const g = CROP_GOOD[q.crop]; if (g) crops[g] = (crops[g] || 0) + 1; }
  for (const q of L.pens) pens[q.species] = (pens[q.species] || 0) + 1;
  return { b, crops, pens };
}
function makeProfile(game, R, s, F) {
  const f = Object.fromEntries(FEATS.map((k) => [k, 0]));
  let crops = {}, pens = {};
  const cl = game.world.source?.climateAt?.(s.x, s.y) || { T: 12, zone: 2 };
  const T = cl.T ?? 12, zone = cl.zone ?? 2;
  if (F) {
    for (const k in F.b) if (k in f) f[k] = F.b[k] | 0;
    crops = { ...F.crops }; pens = { ...F.pens };
  } else {
    const r = (k) => hf(s.seed | 0, s.id, k);
    let hilly = false;
    try { const o = {}; baseHeight(R._planet || game.world.source?.planet, s.x, s.y, o); hilly = o.relief > 0.12 || o.mtn > 0.05; } catch { /* no planet */ }
    const cropsOf = T > 18 ? ['corn', 'corn', 'potato', 'cotton'] : T < 6 ? ['potato', 'potato', 'wheat'] : ['wheat', 'wheat', 'potato', 'corn'];
    let nf = 0, np = 0;
    if (s.kind === 'village') {
      f.tavern = r(1) < 0.7 ? 1 : 0; f.smithy = r(2) < 0.6 ? 1 : 0; f.granary = r(3) < 0.6 ? 1 : 0; f.chapel = r(4) < 0.5 ? 1 : 0;
      f.sawmill = r(5) < 0.6 ? 1 : 0; f.weaver = r(6) < 0.45 ? 1 : 0; f.stable = r(7) < 0.4 ? 1 : 0; f.mine = hilly && r(8) < 0.85 ? 1 : 0;
      nf = Math.round(s.pop / 6); np = 2 + (s.r > 28 ? 1 : 0);
    } else if (s.kind === 'castle') {
      f.keep = 1; f.barracks = 1; f.storehouse = 1; f.stable = 2; f.farmhouse = 2; nf = 6; np = 2;
    } else {
      f.tavern = 2; f.chapel = 1; f.smithy = 2; f.storehouse = 2; f.granary = 1; f.weaver = 1; f.barracks = 1; f.stable = 1; f.sawmill = 1; f.keep = 1;
      nf = Math.round(s.pop / 12); np = 3;
    }
    for (let k = 0; k < nf; k++) { const g = cropsOf[Math.floor(r(20 + k) * cropsOf.length)]; crops[g] = (crops[g] || 0) + 1; }
    for (let k = 0; k < np; k++) { const sp = ['sheep', 'cow', 'pig', 'chicken'][Math.floor(r(40 + k) * 4)]; pens[sp] = (pens[sp] || 0) + 1; }
  }
  const fish = hf(s.seed | 0, s.id, 99) < 0.3 ? 1 : 0;
  const gems = hf(s.seed | 0, s.id, 98);
  const p = new Float32Array(NG), c = new Float32Array(NG);
  const P = (id, v) => { p[GI[id]] += v; }, C = (id, v) => { c[GI[id]] += v; };
  const kind = s.kind;
  // everybody eats
  const eat = kind === 'city' ? 2.2 : kind === 'castle' ? 2 : 1;
  for (const id of ['wheat', 'potato', 'corn', 'meat', 'bread']) C(id, eat);
  C('fish_raw', eat * 0.6);
  // the land: fields and pens
  const cold = T < 6, warm = T > 18;
  for (const g in crops) P(g, Math.min(3, 1 + 0.35 * crops[g]) * (kind === 'city' ? 0.5 : 1) * (cold ? 0.75 : 1));
  for (const sp in pens) for (const [g, v] of SPECIES_GOODS[sp] || []) P(g, v * Math.min(2, pens[sp]));
  if (fish) P('fish_raw', 1.6);
  if (kind === 'village') P('wood', 0.8); // (every village has woodcutters)
  // the workshops
  if (f.sawmill) { P('wood', 2.2); }
  if (f.smithy) { P('iron_bar', 0.6); P('copper_bar', 0.5); P('axe_iron', 1); P('pickaxe_iron', 1); P('arrow', 0.8); for (const id of ['knife_copper', 'axe_copper', 'pickaxe_copper', 'shovel_copper']) P(id, 0.6); C('coal', 1); C('iron_ore', 1); C('copper_ore', 0.6); }
  if (f.mine) { P('stone', 2); P('copper_ore', 1.2); P('iron_ore', 1); P('coal', 1.2); P('gold_ore', gems < 0.35 ? 1 : 0.3); if (gems < 0.25) P('jade', 1); C('pickaxe_iron', 1); C('rope', 0.6); C('meat', 0.3); }
  if (f.weaver) { P('cloth', 1.8); P('rope', 1.2); P('tunic_cloth', 1.2); C('cotton', 1.2); C('wool', 1.2); }
  if (f.tavern) { P('bread', 1.2); P('stew', 1.5); C('wheat', 0.6); C('meat', 0.5); C('potato', 0.4); }
  if (f.chapel) P('herb', 1.2);
  if (f.stable) { P('saddle', 0.8); P('leather', 0.5); C('wheat', 0.5); }
  if (f.granary) P('bread', 0.3);
  if (f.barracks) { for (const [id, v] of [['arrow', 2], ['sword_iron', 1.5], ['spear_iron', 1.5], ['shield_iron', 1.2], ['armor_iron', 1], ['helmet_iron', 1], ['bow_wood', 1], ['armor_leather', 1], ['saddle', 0.6], ['bread', 0.5], ['meat', 0.5], ['spear_copper', 1], ['sword_copper', 1], ['shield_copper', 0.8], ['helmet_copper', 0.8], ['armor_copper', 0.6]]) C(id, v); }
  if (f.keep) { for (const [id, v] of [['gold_bar', 1], ['jade', 1], ['cloth', 0.8], ['steel_bar', 0.6], ['stew', 0.6]]) C(id, v); }
  // the kind of place
  if (kind === 'village') for (const [id, v] of [['rope', 0.5], ['cloth', 0.6], ['axe_iron', 0.6], ['pickaxe_iron', 0.5], ['tunic_cloth', 0.4], ['herb', 0.5], ['stone', 0.4], ['coal', 0.3], ['iron_bar', 0.4]]) C(id, v);
  else if (kind === 'castle') for (const [id, v] of [['iron_bar', 1], ['leather', 1], ['wood', 0.8], ['stone', 1.2], ['stone_block', 1], ['rope', 0.6], ['coal', 0.6], ['herb', 0.8]]) C(id, v);
  else {
    for (const [id, v] of [['bread', 1.5], ['stew', 1.2], ['cloth', 1.4], ['rope', 1], ['stone_block', 1.6], ['copper_bar', 1.2], ['iron_bar', 1.4], ['steel_bar', 1.4], ['gold_bar', 1], ['arrow', 1],
      ['axe_iron', 1.4], ['pickaxe_iron', 1.4], ['sword_iron', 1.2], ['spear_iron', 1], ['bow_wood', 0.8], ['shield_iron', 1], ['armor_leather', 1], ['armor_iron', 1], ['helmet_iron', 1], ['saddle', 0.8],
      ['coat_fur', 1], ['hat_fur', 1], ['tunic_cloth', 1.2]]) P(id, v);
    for (const [id, v] of [['wood', 1.6], ['stone', 1.4], ['cotton', 1.4], ['wool', 1.4], ['leather', 1.2], ['coal', 1.4], ['iron_ore', 1.4], ['copper_ore', 1.2], ['gold_ore', 1.2], ['jade', 1.4], ['herb', 1]]) C(id, v);
  }
  // the climate
  if (cold) { C('coat_fur', 1.5); C('hat_fur', 1.2); C('wood', 0.6); }
  if (warm) { P('cotton', 0.8); c[GI.coat_fur] = Math.max(0, c[GI.coat_fur] - 0.8); c[GI.hat_fur] = Math.max(0, c[GI.hat_fur] - 0.8); }
  // reference stocks (demand) and what is traded there
  const scale = Math.max(0.4, (s.pop || 50) / 50) * (kind === 'castle' ? 1.2 : 1);
  const ref = new Float32Array(NG), deals = new Uint8Array(NG);
  for (let i = 0; i < NG; i++) {
    const [id, , cat, vol] = GOODS[i];
    let r = vol * scale;
    if (f.granary && cat === 'food') r *= 1.3;
    if (f.storehouse) r *= 1.2;
    ref[i] = Math.max(1, Math.round(r * 10) / 10);
    // (owner, Mount & Blade's logic — content/eco.js TRADE): a village the simple civil goods, a city everything civil, a
    // castle the military goods, their materials and rations
    deals[i] = kind === 'city' ? (cat !== 'arms' ? 1 : 0)
      : kind === 'castle' ? (cat === 'arms' || TRADE.castleRations.has(id) ? 1 : 0)
      : (TRADE.village.has(id) || (f.mine && TRADE.villageMine.has(id)) ? 1 : 0);
  }
  return { sid: s.id, kind, f, crops, pens, fish, zone, T, p, c, ref, deals, feat: F };
}

// ---------- the season of a place (its own climate zone, wherever it is: no loaded chunk needed) ----------
const SEAS = new Map(); // (slot, day, hour) → season state: the market day asks it ~20 000 times
export function placeSeason(game, s, day = null, hour = null) {
  const P = profileOf(game, s.id), z = P ? P.zone : 2;
  const slot = z + (game.world.hemiAt?.(Math.floor(s.y)) ? 5 : 0);
  const E = game.env, d = day ?? E.dayIndex, h = hour ?? E.hour;
  const key = `${slot}|${d}|${h}|${YEAR_DAYS}`;
  let S = SEAS.get(key);
  if (!S) { if (SEAS.size > 4000) SEAS.clear(); S = zoneSeason(z, slotClock(slot, seasonClock(d, h))); SEAS.set(key, S); }
  return S;
}
function foodSeasonK(S, zone, meat) {
  if (zone === 4) return meat ? 0.85 : 0.6;
  if (zone === 0) return S.name === 'Estação seca' ? 0.85 : 1.05;
  if (zone === 1 && S.id === 'winter') return meat ? 0.95 : 0.8;
  return (meat ? SEASON_MEAT : SEASON_FOOD)[S.id] ?? 1;
}
// the night's dead come to this place tonight? ('ice' | 'dead' | null) — from its own zone and season
export function nightDanger(game, s, day = null) {
  const S = placeSeason(game, s, day, 22), z = S.zone;
  if (S.hard) return 'ice';
  if ((z === 1 && S.id === 'winter') || (z === 0 && S.name === 'Estação seca')) return 'dead';
  return null;
}

// ---------- prices (only + − × ÷: the same on every peer) ----------
export const goodBase = (gi) => GOODS[gi][1];
export function priceFactor(S, R) {
  const K = Math.max(2, R * PRICE.k);
  return clamp(PRICE.lo + (1 - PRICE.lo) * (R + K) / (Math.max(0, S) + K), PRICE.lo, PRICE.hi);
}
// the balance point of a good there now (season, news) as a share of its reference stock
export function balanceOf(game, sid, gi, day = null) {
  const P = profileOf(game, sid), s = settlement(game, sid);
  let m = clamp((1 + MARKET.w * P.p[gi]) / (1 + MARKET.w * P.c[gi]), MARKET.eLo, MARKET.eHi);
  const id = GOODS[gi][0];
  if (CROP_FOODS.has(id) || id === 'meat' || id === 'fish_raw') m *= foodSeasonK(placeSeason(game, s, day, 12), P.zone, !CROP_FOODS.has(id));
  if (WARM_CLOTHES.has(id) && P.zone >= 2 && placeSeason(game, s, day, 12).id === 'winter') m *= 0.6; // (in winter the furs go)
  for (const e of game.eco?.ev || []) if (e[0] === sid && e[1] === gi) m *= e[2] / 100;
  return m;
}
export const discountOf = (game, uid, k) => RANKS[rankOf(repOf(game, uid, k))].disc;
// negative reputation with kingdom k (phase 3a, owner's rule): trade allowed at worse prices — { buy, sell, b (band | −1) }
const NO_PEN = { buy: 0, sell: 0, b: -1 };
export function penaltyOf(game, uid, k) {
  const b = badRankOf(repOf(game, uid, k));
  return b < 0 ? NO_PEN : { buy: BAD_RANKS[b].buy, sell: BAD_RANKS[b].sell, b };
}
// joining kingdom k: the player's reputation with every other kingdom becomes k's relation with it — ally +40, truce −15,
// war −60, anyone else (other lands too) 0; k itself unchanged; fallen kingdoms left out. [[kingdom, reputation]]
export function inheritFor(game, k) {
  const R = realmOf(game), out = [];
  if (!R) return out;
  for (const K of R.kingdoms) {
    if (K.id === k || game.realms?.fallen?.has(K.id)) continue;
    const r = game.realms?.rels?.get(k < K.id ? `${k}.${K.id}` : `${K.id}.${k}`)?.r || 'neutral';
    out.push([K.id, INHERIT[r] ?? 0]);
  }
  return out;
}
// the demand of a good there today: its reference stock × the season (winter: food and firewood wanted, furs much more;
// the autumn harvest: food less) — keyed to the economy day (E.day, replicated: every peer prices the same)
export function demandOf(game, sid, gi) {
  const P = profileOf(game, sid), id = GOODS[gi][0], R = P.ref[gi];
  const food = CROP_FOODS.has(id), meat = id === 'meat' || id === 'fish_raw', warm = WARM_CLOTHES.has(id);
  if (!food && !meat && !warm && id !== 'wood') return R;
  const day = game.eco?.day >= 0 ? game.eco.day : game.env.dayIndex;
  const S = placeSeason(game, settlement(game, sid), day, 12), z = P.zone, win = S.id === 'winter';
  if (food) return R * (z === 4 ? 1.3 : z === 0 ? (S.name === 'Estação seca' ? 1.15 : 1) : z === 1 ? (win ? 1.15 : 1) : win ? 1.45 : S.id === 'autumn' ? 0.85 : S.id === 'spring' ? 1.1 : 1);
  if (meat) return R * (z >= 2 && win ? 1.2 : S.id === 'autumn' ? 0.95 : 1);
  if (warm) return R * (z < 2 ? 0.7 : win ? 1.8 : S.id === 'autumn' ? 1.3 : S.id === 'summer' ? 0.7 : 1);
  return R * (z >= 2 && win ? 1.3 : 1); // (firewood)
}
// buying n of good gi at sid: total cost (coins, rounded up once), the unit price of the first one and after the last
export function quoteBuy(game, sid, gi, n, uid) {
  const S0 = game.eco?.mk.get(sid)?.[gi] | 0, R = demandOf(game, sid, gi);
  const ko = ownerOf(game, sid), k = (1 + PRICE.buyFee - discountOf(game, uid, ko)) * (1 + penaltyOf(game, uid, ko).buy), b = goodBase(gi); // (negative reputation: dearer)
  let sum = 0;
  const m = Math.min(n, S0);
  for (let i = 0; i < m; i++) sum += b * priceFactor(S0 - i, R) * k;
  return { n: m, cost: Math.ceil(sum - 1e-9), unit: b * priceFactor(S0, R) * k, next: b * priceFactor(S0 - m, R) * k, stock: S0 };
}
export function quoteSell(game, sid, gi, n, uid) {
  const S0 = game.eco?.mk.get(sid)?.[gi] | 0, R = demandOf(game, sid, gi);
  const ko = ownerOf(game, sid), k = (1 - PRICE.sellFee + discountOf(game, uid, ko)) * (1 - penaltyOf(game, uid, ko).sell), b = goodBase(gi); // (negative reputation: cheaper)
  let sum = 0;
  for (let i = 0; i < n; i++) sum += b * priceFactor(S0 + i + 1, R) * k;
  return { n, gain: Math.floor(sum + 1e-9), unit: b * priceFactor(S0 + 1, R) * k, next: b * priceFactor(S0 + n + 1, R) * k, stock: S0 };
}
// how many can a purse of `coins` buy
export function maxAfford(game, sid, gi, coins, uid) {
  const S0 = game.eco?.mk.get(sid)?.[gi] | 0, R = demandOf(game, sid, gi);
  const ko = ownerOf(game, sid), k = (1 + PRICE.buyFee - discountOf(game, uid, ko)) * (1 + penaltyOf(game, uid, ko).buy), b = goodBase(gi);
  let sum = 0, n = 0;
  while (n < S0 && n < 9999) { const v = sum + b * priceFactor(S0 - n, R) * k; if (Math.ceil(v - 1e-9) > coins) break; sum = v; n++; }
  return n;
}
// a price relative to the average of the markets of this land (hints "barato aqui" / "vende bem aqui")
export function landAverage(game, sid, gi) {
  const R = realmOf(game), s = R.settlements[sid], K = R.kingdoms[s.k];
  const c = (game.eco._avg ||= new Map()), key = `${K.comp}|${gi}|${game.eco.v}`;
  if (c.has(key)) return c.get(key);
  let sum = 0, n = 0;
  for (const q of R.settlements) {
    if (R.kingdoms[q.k].comp !== K.comp) continue;
    const P = profileOf(game, q.id);
    if (!P.deals[gi]) continue;
    sum += goodBase(gi) * priceFactor(game.eco.mk.get(q.id)?.[gi] | 0, demandOf(game, q.id, gi)); n++;
  }
  const v = n ? sum / n : goodBase(gi);
  if (c.size > 2000) c.clear();
  c.set(key, v);
  return v;
}
// the best places nearby to sell / buy a good (same land, within MARKET.neighD × 1.5 tiles): [{ s, price, d }]
export function bestMarkets(game, sid, gi, sell = true, n = 3) {
  const R = realmOf(game), s0 = R.settlements[sid], comp = R.kingdoms[s0.k].comp, w = game.world, out = [];
  for (const q of R.settlements) {
    if (q.id === sid || R.kingdoms[q.k].comp !== comp) continue;
    const d = Math.hypot(w.dx(q.x, s0.x), q.y - s0.y);
    if (d > MARKET.neighD * 1.5) continue;
    const P = profileOf(game, q.id);
    if (!P.deals[gi]) continue;
    out.push({ s: q, d, price: goodBase(gi) * priceFactor(game.eco.mk.get(q.id)?.[gi] | 0, demandOf(game, q.id, gi)) * (sell ? 1 - PRICE.sellFee : 1 + PRICE.buyFee) });
  }
  out.sort((a, b) => (sell ? b.price - a.price : a.price - b.price) || a.d - b.d);
  return out.slice(0, n);
}

// ---------- markets: the first stocks, the daily drift (host) ----------
export function initialStocks(game, sid) {
  const P = profileOf(game, sid), out = new Int32Array(NG);
  for (let i = 0; i < NG; i++) out[i] = P.deals[i] ? Math.round(P.ref[i] * balanceOf(game, sid, i)) : 0;
  return out;
}
export function ensureMarkets(game) {
  const E = ecoState(game), R = realmOf(game);
  if (!R) return;
  for (const s of R.settlements) if (!E.mk.has(s.id)) E.mk.set(s.id, initialStocks(game, s.id)); // sync-ok: host-only first fill (a new world / an old save), then the snapshot carries them
}
const NEIGH = new WeakMap();
function neighbours(game) {
  const R = realmOf(game);
  let N = NEIGH.get(R);
  if (N) return N;
  N = R.settlements.map((s) => R.settlements.filter((q) => q.id !== s.id && R.kingdoms[q.k].comp === R.kingdoms[s.k].comp)
    .map((q) => [q.id, Math.hypot(game.world.dx(q.x, s.x), q.y - s.y)]).filter(([, d]) => d < MARKET.neighD).sort((a, b) => a[1] - b[1]).slice(0, MARKET.neigh).map(([id]) => id));
  NEIGH.set(R, N);
  return N;
}
// the new stocks of every market for `day` (host; roll = net.roll) → { mk: [[sid, [stocks]]], ev }
export function simulateDay(game, day, roll, near = []) {
  const E = game.eco, R = realmOf(game), ev = E.ev.filter((e) => e[3] >= day);
  // market news: one anywhere, one near each player (within 900 tiles: news the player can act on)
  const W = game.world, picks = [];
  for (let k = 0; k < EVENTS.perDay; k++) picks.push(R.settlements[Math.floor(roll() * R.settlements.length)]);
  for (const [x, y] of near.slice(0, 4)) {
    const close = R.settlements.filter((q) => Math.hypot(W.dx(q.x, x), q.y - y) < 900);
    if (close.length) picks.push(close[Math.floor(roll() * close.length)]);
  }
  for (const s of picks) {
    const P = profileOf(game, s.id);
    const can = []; for (let i = 0; i < NG; i++) if (P.deals[i] && GOODS[i][3] >= 4) can.push(i);
    if (!can.length) continue;
    const gi = can[Math.floor(roll() * can.length)];
    if (ev.some((e) => e[0] === s.id && e[1] === gi)) continue;
    const glut = roll() < 0.5, days = EVENTS.days[0] + Math.floor(roll() * (EVENTS.days[1] - EVENTS.days[0] + 1));
    ev.push([s.id, gi, Math.round((glut ? EVENTS.glut : EVENTS.short) * 100), day + days]);
  }
  for (const e of game.realms?.marketNews?.(day, roll, ev) || []) ev.push(e); // (the wars: weapons and iron wanted at the front, food in a besieged place — game/realms.js)
  E.ev = ev; // sync-ok: host-side preview of the news for balanceOf below (the op eco.day sets the same on every peer)
  const next = new Map();
  for (const s of R.settlements) {
    const P = profileOf(game, s.id), cur = E.mk.get(s.id) || initialStocks(game, s.id), out = new Float64Array(NG);
    for (let i = 0; i < NG; i++) {
      if (!P.deals[i]) { out[i] = 0; continue; }
      const goal = P.ref[i] * balanceOf(game, s.id, i, day);
      out[i] = cur[i] + (goal - cur[i]) * MARKET.relax + (roll() - 0.5) * 2 * MARKET.noise * P.ref[i];
    }
    next.set(s.id, out);
  }
  // spreading: a market whose stock / reference is above its neighbour's sends a little over (same land mass only)
  const N = neighbours(game), flow = new Map([...next].map(([sid]) => [sid, new Float64Array(NG)]));
  for (const s of R.settlements) {
    const A = next.get(s.id), PA = profileOf(game, s.id), FA = flow.get(s.id);
    for (const q of N[s.id]) {
      if (q < s.id && N[q].includes(s.id)) continue; // (each pair once)
      const B = next.get(q), PB = profileOf(game, q), FB = flow.get(q);
      for (let i = 0; i < NG; i++) {
        if (!PA.deals[i] || !PB.deals[i]) continue;
        const t = MARKET.diffuse * (A[i] / PA.ref[i] - B[i] / PB.ref[i]) * Math.min(PA.ref[i], PB.ref[i]) * 0.5;
        FA[i] -= t; FB[i] += t;
      }
    }
  }
  const mk = [];
  for (const s of R.settlements) {
    const A = next.get(s.id), F = flow.get(s.id), P = profileOf(game, s.id), row = new Array(NG);
    for (let i = 0; i < NG; i++) row[i] = P.deals[i] ? Math.max(0, Math.min(Math.round(P.ref[i] * 4), Math.round(A[i] + F[i]))) : 0;
    mk.push([s.id, row]);
  }
  return { mk, ev };
}

// ---------- reputation, ranks ----------
export function rankInfo(game, uid, k) {
  const rep = repOf(game, uid, k), i = rankOf(rep), nx = RANKS[i + 1], bad = badRankOf(rep);
  // (negative — phase 3a: the band, how far to 0 "Desconhecido", the worse prices)
  if (bad >= 0) { const B = BAD_RANKS[bad], up = BAD_RANKS[bad - 1]; return { rep, i, bad, name: B.name, next: up ? up.name : RANKS[0].name, need: up ? up.floor : 0, from: B.floor, disc: 0, buy: B.buy, sell: B.sell }; }
  return { rep, i, bad: -1, name: RANKS[i].name, next: nx ? nx.name : null, need: nx ? nx.min : null, from: RANKS[i].min, disc: RANKS[i].disc, buy: 0, sell: 0 };
}
// tax rate of kingdom k (share of a property's value a day)
export function taxRate(game, k) {
  const R = realmOf(game);
  return Math.round((PROP.taxLo + (PROP.taxHi - PROP.taxLo) * hf(R?.seed | 0, k, 77)) * 1000) / 1000;
}

// ---------- the mural of a place: where it stands (trades and jobs happen there) ----------
export function muralSpot(game, sid) {
  const L = game.towns?.layout?.(sid);
  if (!L) return null;
  const r = L.structs[L.mural];
  if (!r) return { x: L.x, y: L.y };
  const [w, h] = dimsOf(r[0], r[3]);
  return { x: r[1] + w / 2, y: r[2] + h / 2 };
}
export const MURAL_REACH = 8;
export function atMural(game, sid, ent) {
  const m = muralSpot(game, sid);
  return !!(m && ent && Math.hypot(game.world.dx(ent.x, m.x), ent.y - m.y) <= MURAL_REACH);
}

// ---------- the job board (deterministic per place and day; the host re-makes it to check a job taken) ----------
const BOARDS = new Map();
function giverOf(game, sid, salt, role) {
  const P = game.towns?.people?.(sid); // (the townsfolk agent's citizens, when they exist)
  if (Array.isArray(P) && P.length) {
    const q = P[h32(sid, salt, 3) % P.length];
    const nm = typeof q === 'string' ? q : q?.name;
    if (nm) return { name: String(nm).slice(0, 24), role: (typeof q === 'object' && (q.role || q.job)) || role };
  }
  return { name: GIVER_NAMES[h32(sid, salt, 5) % GIVER_NAMES.length], role };
}
// the economy day (E.day: replicated, it turns at the host's daily tick — every peer shows the same board)
export const ecoDay = (game) => (game.eco?.day >= 0 ? game.eco.day : game.env.dayIndex);
const LPROF = new WeakMap(); // plan → the profile made from its own features (boards: never the replicated E.feat)
export function boardOf(game, sid, day = ecoDay(game)) {
  const key = `${sid}|${day}|${ownerOf(game, sid)}`; // (a captured place: its new kingdom's jobs)
  if (BOARDS.has(key)) return BOARDS.get(key);
  const R = realmOf(game), s = R?.settlements[sid];
  if (!s) return [];
  const L = game.towns.layout(sid), out = [];
  let P = LPROF.get(L);
  if (!P) LPROF.set(L, (P = makeProfile(game, R, s, featuresOf(L))));
  const rnd = (k) => hf(R.seed | 0, sid, day, k);
  const want = s.kind === 'city' ? 6 : s.kind === 'castle' ? 3 : 5;
  const has = (k) => L.buildings.some((b) => b.key === k);
  // only what can be done there (docs/REINOS.md §10 "Trabalhos possíveis"): a harvest when crops grow there this dawn (its
  // fields were replanted — game/fields.js), wood / stone / game where the land around has them (the planet: survey)
  const V = survey(game, s), dawn = placeSeason(game, s, day, 6);
  const kinds = [];
  if (L.fields.length && !dawn.hard) kinds.push('harvest');
  if (has('mine') && (!V || V.boulders >= JOB_SITE.mineK * 8)) kinds.push('mine');
  if ((s.kind !== 'city' || has('sawmill')) && (!V || V.trees >= JOB_SITE.chopMin)) kinds.push('chop');
  kinds.push('bring', 'deliver');
  if (!V || V.fauna >= JOB_SITE.huntFauna) kinds.push('hunt');
  if (s.kind !== 'castle') kinds.push('bring');
  const danger = nightDanger(game, s, day);
  if (danger) kinds.unshift('defend');
  const used = new Set();
  for (let k = 0; out.length < want && k < 30; k++) {
    const t = danger && k === 0 ? 'defend' : kinds[Math.floor(rnd(k * 7 + 1) * kinds.length)];
    if (t !== 'bring' && used.has(t)) continue;
    const j = makeJob(game, s, L, P, t, day, out.length, (q) => rnd(k * 7 + 2 + q), danger);
    if (!j) continue;
    if (t === 'bring' && out.some((o) => o.good === j.good)) continue;
    used.add(t);
    out.push(j);
  }
  if (BOARDS.size > 300) BOARDS.clear();
  BOARDS.set(key, out);
  return out;
}
const work = (L, key) => L.buildings.find((b) => b.key === key);
function makeJob(game, s, L, P, t, day, n, r, danger) {
  const id = `${s.id}.${day}.${n}`, R = realmOf(game), w = game.world;
  const base = { id, sid: s.id, k: ownerOf(game, s.id), t, day, exp: day + 2, got: 0 };
  const big = s.kind === 'city' ? 1.3 : 1;
  const V = survey(game, s), nPt = s.kind === 'city' ? 'da cidade' : s.kind === 'castle' ? 'do castelo' : 'da vila';
  if (t === 'harvest') {
    // the crop of a field the place holds plenty of (its fields are full at dawn: replanted — game/fields.js); the waypoint
    // is the biggest field of it (a real field: its middle), the tracker then leads plant by plant (jobTarget)
    const S = placeSeason(game, s, day, 6);
    if (S.hard) return null;
    const need = 6 + Math.floor(r(2) * 7);
    const crops = [...new Set(L.fields.map((f) => CROP_GOOD[f.crop]).filter(Boolean))].sort().filter((g) => cropTotal(L, g) >= need * JOB_SITE.harvestK);
    if (!crops.length) return null;
    const g = crops[Math.floor(r(1) * crops.length)], F = cropFields(L, s, g)[0], dir = dirPt(F.x - s.x, F.y - s.y);
    return { ...base, n: need, crop: g, pay: Math.round((6 * need + 12) * big), rep: 4, x: F.x, y: F.y, giver: giverOf(game, s.id, n + day, 'Lavrador'),
      title: `Colher ${need} ${CROP_PT[g]}`,
      text: S.id === 'autumn' ? `É tempo de colheita em ${s.name} e falta gente. Colha ${need} pés de ${CROP_PT[g]} nos campos ${nPt} (toque neles): o maior fica a ${dir}.`
        : `Os lavradores de ${s.name} precisam de ajuda. Colha ${need} pés de ${CROP_PT[g]} nos campos ${nPt} (toque neles): o maior fica a ${dir}. Eles replantam de madrugada.` };
  }
  if (t === 'mine') {
    // boulders (and rock, where there is) around the place: the waypoint is the stoniest side (the tracker then leads to
    // the nearest boulder / rock)
    const b = work(L, 'mine'), need = 8 + Math.floor(r(1) * 8);
    if (V && V.boulders < need * JOB_SITE.mineK) return null;
    const p = V?.rocks || (b ? { x: (b.box[0] + b.box[2]) / 2, y: (b.box[1] + b.box[3]) / 2 } : s);
    return { ...base, n: need, pay: Math.round((5 * need + 18) * big), rep: 5, x: p.x, y: p.y, r: s.ro + 60, giver: giverOf(game, s.id, n + day, 'Mineiro'),
      title: `Minerar ${need} blocos`, text: `A mina de ${s.name} precisa de braços. Quebre ${need} pedregulhos ou blocos de rocha (pedra ou minério) nos arredores ${nPt}: há mais pedra a ${dirPt(p.x - s.x, p.y - s.y)}.` };
  }
  if (t === 'chop') {
    // only where the land around has woods (the planet's biomes: survey); the waypoint is the nearest wooded side
    const need = 4 + Math.floor(r(1) * 4), b = work(L, 'sawmill');
    if (V && V.trees < Math.max(JOB_SITE.chopMin, need * JOB_SITE.chopK)) return null;
    const p = V?.woods || (b ? { x: (b.box[0] + b.box[2]) / 2, y: (b.box[1] + b.box[3]) / 2 } : s);
    return { ...base, n: need, pay: Math.round((10 * need + 12) * big), rep: 4, x: p.x, y: p.y, r: s.ro + 90,
      giver: giverOf(game, s.id, n + day, b ? 'Lenhador' : 'Carpinteiro'), title: `Cortar ${need} árvores`,
      text: `${b ? 'A serraria' : s.kind === 'castle' ? 'O castelo' : s.kind === 'city' ? 'A cidade' : 'A vila'} de ${s.name} precisa de toras. Derrube ${need} árvores nos arredores: a mata mais perto fica a ${dirPt(p.x - s.x, p.y - s.y)}.` };
  }
  if (t === 'bring') {
    const cand = [];
    for (let i = 0; i < NG; i++) if (P.deals[i] && P.c[i] >= 0.8 && P.p[i] < 0.5 && GOODS[i][1] <= 80) cand.push(i);
    if (!cand.length) return null;
    const gi = cand[Math.floor(r(1) * cand.length)], [gid, bp] = GOODS[gi];
    const need = clamp(Math.round((150 + r(2) * 120) / bp), 3, 40);
    return { ...base, n: need, good: gid, pay: Math.round(bp * need * 1.45 + 10), rep: 4, giver: giverOf(game, s.id, n + day, 'Comerciante'),
      title: `Trazer ${need} ${ITEMS[gid].name.toLowerCase()}`, text: `Precisam de ${need} ${ITEMS[gid].name.toLowerCase()} aqui em ${s.name}. Traga e entregue neste mural: paga bem acima do mercado.` };
  }
  if (t === 'deliver') {
    const ko = ownerOf(game, s.id), K = R.kingdoms[ko];
    const cand = R.settlements.filter((q) => q.id !== s.id && R.kingdoms[q.k].comp === K.comp).map((q) => [q, Math.hypot(w.dx(q.x, s.x), q.y - s.y)])
      .filter(([q, d]) => { const kq = ownerOf(game, q.id); return d > 120 && d < 1500 && (kq === ko || K.neighbours.includes(kq)) && !game.realms?.atWar?.(ko, kq); }).sort((a, b) => a[1] - b[1]);
    if (!cand.length) return null;
    const [q, d] = cand[Math.floor(r(1) * Math.min(cand.length, 8))], np = 1 + Math.floor(r(2) * 3);
    return { ...base, n: np, dest: q.id, exp: day + 3, pay: Math.round(20 + d * 0.09 + 8 * np), rep: d > 700 ? 10 : d > 350 ? 8 : 6, giver: giverOf(game, s.id, n + day, 'Mercador'),
      title: `Levar ${np} ${np > 1 ? 'encomendas' : 'encomenda'} a ${q.name}`,
      text: `Leve ${np > 1 ? `estas ${np} encomendas` : 'esta encomenda'} até o mural de ${q.name} (${q.kind === 'city' ? 'cidade' : q.kind === 'castle' ? 'castelo' : 'vila'} do Reino de ${R.kingdoms[ownerOf(game, q.id)].name}), a ${Math.round(d)} passos a ${dirPt(w.dx(q.x, s.x), q.y - s.y)}. Pagamento na entrega.` };
  }
  if (t === 'hunt') {
    // where the land around has game (its biomes' wild animals: survey) — named in the text
    const need = 3 + Math.floor(r(1) * 3);
    if (V && V.fauna < JOB_SITE.huntFauna) return null;
    const names = V?.animals?.length ? V.animals.join(', ') : 'cervos, javalis, lobos';
    return { ...base, n: need, pay: Math.round((18 * need + 10) * big), rep: 5, giver: giverOf(game, s.id, n + day, 'Curtidor'),
      title: `Caçar ${need} animais`, text: `O curtidor de ${s.name} precisa de peles. Cace ${need} animais selvagens (${names}…) em qualquer lugar e volte ao mural.` };
  }
  if (t === 'defend') {
    if (!danger) return null;
    const need = 4 + Math.floor(r(1) * 5);
    return { ...base, n: need, exp: day + 1, night: 1, pay: Math.round(15 * need + 40), rep: 10, x: s.x, y: s.y, r: s.ro + 40, giver: giverOf(game, s.id, n + day, 'Capitão da guarda'),
      title: `Defender ${s.name} esta noite`, text: `${danger === 'ice' ? 'Os Andarilhos do Gelo' : 'Os mortos'} vão atacar ${s.name} esta noite. Derrote ${need} deles perto da vila até o amanhecer e volte ao mural para receber.` };
  }
  return null;
}
export const jobKindName = (t) => JOB_KINDS[t]?.name || t;
// the waypoint of a job for the HUD / radar / map (null: a hunt, anywhere)
export function jobWaypoint(game, j) {
  const t = jobTarget(game, j);
  return t && !t.anywhere ? { x: t.x, y: t.y, label: t.label, kind: 'job', job: j.id } : null;
}
// a job's state for its player: 'go' (working), 'ready' (turn it in), 'late' (expired)
export function jobState(game, j) {
  if (j.t === 'bring' || j.t === 'deliver') return 'carry';
  return (j.got | 0) >= j.n ? 'ready' : 'go';
}
// where the tracker points: the work area, the place to turn it in. Near the work area (this peer's loaded world, cosmetic):
// the exact target — the nearest plant of the crop on the place's fields, the nearest standing tree, the nearest boulder /
// rock (exact: the arrow and the ground marker lead to it; game/fields.js)
export function jobTarget(game, j) {
  const R = realmOf(game);
  if (!R) return null;
  if (j.t === 'deliver') { const q = R.settlements[j.dest], m = muralSpot(game, j.dest); return m ? { ...m, label: q.name } : { x: q.x, y: q.y, label: q.name }; }
  const s = R.settlements[j.sid];
  if (j.t === 'bring' || jobState(game, j) === 'ready') { const m = muralSpot(game, j.sid); return m ? { ...m, label: `mural de ${s.name}` } : { x: s.x, y: s.y, label: s.name }; }
  if (Number.isFinite(j.x)) return exactTarget(game, j, s) || { x: j.x, y: j.y, label: s.name, area: true };
  return { x: s.x, y: s.y, label: s.name, anywhere: true }; // (a hunt: anywhere — no arrow)
}
// the area of a job (its progress counts there): within r of its point or of the place
export function jobArea(game, j) {
  const s = settlement(game, j.sid), w = game.world, r = j.r || (s.ro + 60), x = j.x ?? s.x, y = j.y ?? s.y;
  const inA = (px, py) => Math.hypot(w.dx(px, x), py - y) <= r || Math.hypot(w.dx(px, s.x), py - s.y) <= r;
  const dx = w.dx(x, s.x), dy = y - s.y, h = Math.hypot(dx, dy) / 2;
  return { inA, r, cx: s.x + dx / 2, cy: s.y + dy / 2, R: r + h };
}
const EXACT = new Map(); // job id → { t, px, py, q } (cosmetic: refreshed a few times a second)
const clock = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0); // (local caches: real time)
function exactTarget(game, j, s) {
  const p = game.player;
  if (!p || !(j.t === 'harvest' || j.t === 'chop' || j.t === 'mine')) return null;
  const now = clock(), c = EXACT.get(j.id);
  if (c && now - c.t < 0.4 && now >= c.t && Math.abs(c.px - p.x) < 1 && Math.abs(c.py - p.y) < 1 && (!c.q?.o || !c.q.o.gone)) return c.q;
  let q = null;
  const w = game.world, nearPlace = Math.hypot(w.dx(p.x, s.x), p.y - s.y);
  if (j.t === 'harvest') {
    if (nearPlace < s.ro + 70) {
      const o = nearestPlant(game, j.sid, j.crop, p.x, p.y);
      if (o) q = { x: o.x, y: o.y - 0.25, label: `pé de ${CROP_PT[j.crop] || j.crop}`, area: true, exact: true, o };
    }
  } else {
    const A = jobArea(game, j);
    if (nearPlace < A.r + 40 || Math.hypot(w.dx(p.x, j.x), p.y - j.y) < A.r + 40) {
      const o = nearestTarget(game, j.t, A.inA, p.x, p.y);
      if (o) q = { x: o.x, y: o.y - (o.rock ? 0 : 0.25), label: j.t === 'chop' ? 'árvore' : o.rock ? 'rocha' : 'pedregulho', area: true, exact: true, o: o.o || null };
    }
  }
  if (EXACT.size > 30) EXACT.clear();
  EXACT.set(j.id, { t: now, px: p.x, py: p.y, q });
  return q;
}
// Can this job be done right now (the host when it is taken; the board's hint — this peer's knowledge)? A reason (pt-BR)
// or null: the place's fields of the crop harvested (they come back at dawn), the trees / stone around gone (counted where
// every chunk of the area is loaded here)
const REASON = new Map();
export function jobReason(game, j, fresh = false) {
  const s = settlement(game, j?.sid);
  if (!s) return null;
  const now = clock(), c = REASON.get(j.id), key = `${game.touched?.size | 0}|${game.fieldV | 0}`;
  if (!fresh && c && c.key === key && now - c.t < 2 && now >= c.t) return c.why;
  let why = null;
  if (j.t === 'harvest') {
    const q = fieldsLeft(game, j.sid, j.crop, fresh), pt = CROP_PT[j.crop] || j.crop;
    if (q.total && q.left < j.n) why = q.left ? `Só restam ${q.left} pés de ${pt} nos campos de ${s.name}: volte depois que replantarem (de madrugada) ou escolha outro trabalho`
      : `Os campos de ${pt} de ${s.name} já foram colhidos: volte depois que replantarem (de madrugada) ou escolha outro trabalho`;
  } else if (j.t === 'chop' || j.t === 'mine') {
    const A = jobArea(game, j), n = areaCount(game, j.t, A.cx, A.cy, A.R, A.inA, j.n);
    if (n.full && n.n < j.n) why = j.t === 'chop' ? `Quase não há árvores em pé perto de ${s.name} (${n.n}): escolha outro trabalho` : `Quase não há pedra para quebrar perto de ${s.name} (${n.n}): escolha outro trabalho`;
  }
  if (REASON.size > 40) REASON.clear();
  REASON.set(j.id, { t: now, key, why });
  return why;
}

// ---------- properties: houses and plots of a place (from its plan) ----------
const PROPS = new WeakMap();
export function propsOf(game, sid) {
  const L = game.towns?.layout?.(sid), s = settlement(game, sid);
  if (!L || !s) return { houses: [], plots: [] };
  let P = PROPS.get(L);
  if (P) return P;
  P = { houses: [], plots: [], byPiece: new Map() };
  if (s.kind !== 'castle') {
    const homes = L.buildings.map((b, bi) => [b, bi]).filter(([b]) => HOME_KEYS[b.key] && b.beds.length && !b.guard);
    homes.sort((a, b) => h32(sid, a[1], 11) - h32(sid, b[1], 11));
    const kind = s.kind === 'city' ? 'city' : 'village';
    const nSale = Math.min(homes.length, PROP.sale[kind]), nRent = Math.min(homes.length - nSale, PROP.rent[kind]);
    homes.slice(0, nSale + nRent).forEach(([b, bi], k) => {
      const price = Math.round(HOME_KEYS[b.key] * (s.kind === 'city' ? PROP.cityK : 1) / 10) * 10;
      const h = { id: `h${sid}.${bi}`, sid, bi, key: b.key, name: b.name, mode: k < nSale ? 'sale' : 'rent', price, rent: Math.max(5, Math.round(price * PROP.rentDay)),
        box: b.box, door: b.door, beds: [], chests: [], doors: [] };
      const [x0, y0, x1, y1] = b.box;
      L.structs.forEach((r, i) => {
        if (r[1] < x0 || r[1] > x1 || r[2] < y0 || r[2] > y1) return;
        if (r[0] === 'bed') h.beds.push(i); else if (r[0] === 'chest') h.chests.push(i); else if (BUILDINGS[r[0]]?.block === 'door' && !BUILDINGS[r[0]]?.gate2) h.doors.push(i);
      });
      for (const i of [...h.beds, ...h.chests, ...h.doors]) P.byPiece.set(`t${sid}.${i}`, h.id);
      P.houses.push(h);
    });
    P.plots = findPlots(L, s);
  }
  PROPS.set(L, P);
  return P;
}
// free square plots inside the town land: no piece, no street, off the buildings, fields and pens (the plan only)
function findPlots(L, s) {
  const G = L.grid, out = [];
  if (!G) return out;
  const taken = new Uint8Array(G.w * G.h);
  const mark = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y - G.y0) * G.w + (x - G.x0); if (x >= G.x0 && y >= G.y0 && x < G.x0 + G.w && y < G.y0 + G.h) taken[i] = 1; } };
  for (const r of L.structs) {
    const d = BUILDINGS[r[0]];
    if (!d || d.roof || r[4] > 0) continue;
    const [w, h] = dimsOf(r[0], r[3]);
    mark(r[1], r[2], r[1] + w - 1, r[2] + h - 1);
  }
  for (const b of L.buildings) mark(b.box[0] - 1, b.box[1] - 1, b.box[2] + 1, b.box[3] + 1);
  for (const q of [...L.fields, ...L.pens]) mark(q.x0 - 1, q.y0 - 1, q.x1 + 1, q.y1 + 1);
  if (L.plaza) mark(Math.floor(L.plaza[0] - L.plaza[2] - 1), Math.floor(L.plaza[1] - L.plaza[2] - 1), Math.ceil(L.plaza[0] + L.plaza[2] + 1), Math.ceil(L.plaza[1] + L.plaza[2] + 1));
  for (let i = 0; i < taken.length; i++) if (G.pave[i]) taken[i] = 1;
  // whole inside the town land (its corners); the big plots first, then the smaller ones in what is left
  const rr = (s.r - 0.5) * (s.r - 0.5);
  const max = PROP.plots[s.kind === 'city' ? 'city' : 'village'], price0 = PROP.plotPrice[s.kind === 'city' ? 'city' : 'village'];
  for (const S of PROP.plotSizes) {
    const cand = [];
    for (let y = G.y0; y + S <= G.y0 + G.h; y++) for (let x = G.x0; x + S <= G.x0 + G.w; x++) {
      let ok = true;
      for (const [cx, cy] of [[x, y], [x + S, y], [x, y + S], [x + S, y + S]]) if ((cx - s.x) * (cx - s.x) + (cy - s.y) * (cy - s.y) > rr) { ok = false; break; }
      if (!ok) continue;
      for (let yy = y; yy < y + S && ok; yy++) for (let xx = x; xx < x + S; xx++) if (taken[(yy - G.y0) * G.w + (xx - G.x0)]) { ok = false; break; }
      if (ok) cand.push([x, y, (x + S / 2 - s.x) * (x + S / 2 - s.x) + (y + S / 2 - s.y) * (y + S / 2 - s.y)]);
    }
    cand.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    for (const [x, y] of cand) {
      if (out.length >= max) break;
      if (out.some((p) => x < p.x1 + 2 && x + S > p.x0 - 1 && y < p.y1 + 2 && y + S > p.y0 - 1)) continue;
      out.push({ id: `p${s.id}.${out.length}`, sid: s.id, pi: out.length, x0: x, y0: y, x1: x + S - 1, y1: y + S - 1, w: S, price: Math.round((price0 * S * S) / 64 / 10) * 10 });
    }
  }
  return out;
}
const PROP_ID = /^([hp])(\d+)\.(\d+)$/;
export function propById(game, id) {
  const m = PROP_ID.exec(typeof id === 'string' ? id : '');
  if (!m) return null;
  const P = propsOf(game, +m[2]);
  return m[1] === 'h' ? P.houses.find((h) => h.id === id) || null : P.plots.find((p) => p.id === id) || null;
}
export const propValue = (pr) => (pr ? pr.price : 0);
export const propKind = (id) => (String(id)[0] === 'h' ? 'house' : 'plot');
// the daily rent of a house: at least PROP.rentDay of its price and PROP.rentVsTax × the tax its owner would pay to the
// kingdom that holds the place now (owner: renting has to cost far more than owning — a small village house ~49–67 a day)
export function rentOf(game, pr) {
  if (!pr) return 0;
  const tax = pr.price * taxRate(game, ownerOf(game, pr.sid));
  return Math.max(5, Math.round(Math.max(pr.price * PROP.rentDay, tax * PROP.rentVsTax)));
}
// the daily charge of a property for its holder: tax (owned) or rent (rented)
export function chargeOf(game, id, row = game.eco?.pr.get(id)) {
  const pr = propById(game, id);
  if (!pr || !row) return 0;
  if (row.mode === 'rent') return rentOf(game, pr);
  return Math.max(1, Math.round(pr.price * taxRate(game, ownerOf(game, pr.sid)))); // (a captured place: the new kingdom's tax)
}
// the property a settlement piece belongs to (a house's door / chest / bed)
export function pieceProp(game, pieceId, sid) {
  if (sid == null) { const m = /^t(\d+)\./.exec(pieceId || ''); if (!m) return null; sid = +m[1]; }
  return propsOf(game, sid).byPiece?.get(pieceId) || null;
}
// may this player use a settlement piece (a house's chest, bed, door)? its holder only
export function mayUsePiece(game, o, pid) {
  const pid0 = pid ?? game.net.pid, id = pieceProp(game, o.id, o.town);
  if (!id) return false;
  const row = game.eco?.pr.get(id);
  return !!row && row.u === uidOf(game, pid0);
}
// the building rule inside a town land (game/towns.js TOWN.landReason): undefined = not on a plot → the default refusal
export function plotReason(game, s, tx, ty, w, h, who) {
  const P = propsOf(game, s.id);
  const pl = P.plots.find((p) => tx >= p.x0 && ty >= p.y0 && tx + w - 1 <= p.x1 && ty + h - 1 <= p.y1);
  if (!pl) {
    if (P.plots.some((p) => tx <= p.x1 && tx + w - 1 >= p.x0 && ty <= p.y1 && ty + h - 1 >= p.y0)) return 'Passa da divisa do terreno';
    return undefined;
  }
  const row = game.eco?.pr.get(pl.id);
  if (!row) return `Terreno à venda: compre no mural de ${s.name}`;
  const uid = uidOf(game, pidOfEnt(game, who));
  if (row.u === uid) return null;
  return `Terreno de ${row.name || 'outro jogador'}`;
}
// where a respawn bed of a house stands (its chunk may not be loaded): for player.js respawnPoint
export function bedSpot(game, id) {
  const m = /^t(\d+)\.(\d+)$/.exec(id || '');
  if (!m || !mayUsePiece(game, { id, town: +m[1] })) return null;
  const r = game.towns?.layout?.(+m[1])?.structs[+m[2]];
  return r ? { x: r[1] + 0.5, y: r[2] + 1.6 } : null;
}
// properties of a player: [{ id, row, pr, s }]
export function propsOfUid(game, uid) {
  const out = [];
  for (const [id, row] of game.eco?.pr || []) if (row.u === uid) { const pr = propById(game, id); if (pr) out.push({ id, row, pr, s: settlement(game, pr.sid) }); }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------- job progress (host): the ops of the players' actions ----------
const isWild = (m) => m && !SPECIES[m.species]?.pawn && !SPECIES[m.species]?.stock && m.town == null && !m.owned && !m.tame && m.species !== 'spider' && !m.isProp;
const isNightDead = (m) => m && (m.faction === 'walker' || !!SPECIES[m.species]?.undead);
function bump(game, uid, j, d = 1) {
  const E = game.eco, k = uid + '|' + j.id;
  E.pend.set(k, (E.pend.get(k) || 0) + d); // sync-ok: host-only pending progress, flushed as eco.prog ops by ecoSystem
}
function forJobs(game, pid, fn) {
  const uid = uidOf(game, pid), r = recOf(game, uid);
  if (!r || !r.jobs.length) return;
  for (const j of r.jobs) if ((j.got | 0) + (game.eco.pend.get(uid + '|' + j.id) || 0) < j.n) fn(uid, j);
}
function nearJob(game, j, x, y) {
  const s = settlement(game, j.sid), w = game.world, r = j.r || (s.ro + 60);
  return Math.hypot(w.dx(x, j.x ?? s.x), y - (j.y ?? s.y)) <= r || Math.hypot(w.dx(x, s.x), y - s.y) <= r;
}
// a plant of the job's crop standing on a field of the job's place (its tile inside the field: one beside it does not count)
function inFields(game, j, o) {
  const L = game.towns?.layout?.(j.sid), type = CROP_TYPE[j.crop];
  return !!L && o.type === type && L.fields.some((f) => f.crop === type && inField(f, o));
}
export function onOp(game, name, a) {
  if (!game.eco?.pl.size || !a || a.by == null) return;
  if (name === 'obj.remove') {
    for (const id of Array.isArray(a.ids) ? a.ids : []) {
      const o = findObj(game, id);
      if (!o) continue;
      if (CROP_GOOD[o.type]) forJobs(game, a.by, (u, j) => { if (j.t === 'harvest' && CROP_GOOD[o.type] === j.crop && inFields(game, j, o)) bump(game, u, j); });
      else if (o.type === 'boulder') forJobs(game, a.by, (u, j) => { if (j.t === 'mine' && nearJob(game, j, o.x, o.y)) bump(game, u, j); });
    }
  } else if (name === 'tile.mine') {
    forJobs(game, a.by, (u, j) => { if (j.t === 'mine' && nearJob(game, j, a.tx + 0.5, a.ty + 0.5)) bump(game, u, j); });
  } else if (name === 'tree.fell') {
    const o = findObj(game, a.id);
    if (o) forJobs(game, a.by, (u, j) => { if (j.t === 'chop' && nearJob(game, j, o.x, o.y)) bump(game, u, j); });
  } else if (name === 'mob.die') {
    const m = game.entities.find((e) => e.nid === a.nid && !e.proxy);
    if (!m) return;
    const night = isNightDead(m), wild = !night && isWild(m);
    forJobs(game, a.by, (u, j) => {
      if (j.t === 'hunt' && wild) bump(game, u, j);
      else if (j.t === 'defend' && night && nearJob(game, j, m.x, m.y)) bump(game, u, j);
    });
  }
}

// ---------- the host's day ----------
export function onlineUids(game) {
  const out = new Map(); // uid → pid
  out.set(meUid(game), game.net.pid);
  for (const pl of game.session?.players?.values?.() || []) { if (!pl.synced) continue; const u = game.eco.who.get(pl.pid); if (u) out.set(u, pl.pid); }
  return out;
}
export function playerName(game, pid) {
  if (pid === game.net.pid) return game.player.name || 'Jogador';
  return game.session?.players?.get?.(pid)?.name || 'Jogador';
}
// the avatar of a session pid (host: the remote avatars at their latest position)
export function entOfPid(game, pid) {
  if (pid === game.net.pid) return game.player;
  const pl = game.session?.players?.get?.(pid);
  return pl && pl.synced !== false ? pl.av || pl.ent || null : null;
}
// a house given back: its chests are emptied (inside an op applier: every peer, loaded or not)
export function emptyChests(game, pr) {
  if (!pr?.chests) return;
  for (const k of pr.chests) {
    const id = `t${pr.sid}.${k}`;
    game.eco.st.delete(id);
    const o = game.world.objById.get(id);
    if (o?.store) { o.store.load([]); game.events?.emit('chest', { o }); }
  }
}
// the owner pays the day's bill (eco.collect) or a debt by hand: the coins in the BACKPACK, smallest debts first (keeps
// as many properties as possible); what cannot be paid stays owed — a warning with the days left
export function payBills(game, bills, auto = false) {
  const p = game.player, have = p.inv.count(COIN);
  const list = bills.map((b) => [String(b[0]), Math.max(0, b[1] | 0), Math.max(0, b[2] | 0)]).filter((b) => b[1] > 0).sort((a, b) => a[1] - b[1]);
  let left = have;
  const pay = [], miss = [];
  for (const b of list) { if (b[1] <= left) { left -= b[1]; pay.push(b); } else miss.push(b); }
  const total = have - left;
  if (pay.length && total > 0) {
    p.inv.remove(COIN, total);
    game.events.emit('inventory', {});
    game.net.request('eco.pay', { ids: pay.map((b) => b[0]), coins: total }, { refund: { [COIN]: total }, onReject: (why) => why && game.events.emit('error', { text: why }) });
  }
  if (miss.length) game.events.emit('eco', { type: 'owed', u: meUid(game), list: miss, auto, have: left });
  return { paid: total, miss };
}
function dayTick(game, day) {
  const net = game.net, E = game.eco;
  const roll = () => net.roll();
  const { mk, ev } = simulateDay(game, day, roll, [...onlineUids(game).values()].map((pid) => entOfPid(game, pid)).filter(Boolean).map((e) => [e.x, e.y]));
  net.emit('eco.day', { day, mk, ev });
  // the fields replanted overnight by the places' farmers (not in a hard winter: crops do not grow — polar never): every
  // field plant harvested before this dawn comes back, the same object (game/fields.js; the day's harvest jobs need them)
  replantFields(game, (sid) => { const s = settlement(game, sid); return !!s && !placeSeason(game, s, day, 6).hard; });
  // expired jobs
  for (const [uid, r] of E.pl) for (const j of r.jobs.slice()) if (day > j.exp) net.emit('eco.job', { u: uid, fail: j.id, toast: undefined });
  // bills: tax (owned) and rent (rented) of the players in the world (a player away is not charged for those days)
  const on = onlineUids(game), bills = new Map();
  for (const [id, row] of E.pr) {
    const pid = on.get(row.u);
    if (pid == null) continue;
    const ch = chargeOf(game, id, row);
    if (!ch) continue;
    let b = bills.get(row.u);
    if (!b) bills.set(row.u, (b = { pid, list: [] }));
    b.list.push([id, ch]);
  }
  for (const [uid, b] of bills) {
    const seize = b.list.filter(([id]) => { const r = E.pr.get(id); return r.due > 0 && r.warn + 1 >= PROP.warnDays; }).map(([id]) => id);
    if (seize.length) loseProps(game, seize, 'seized'); // (3 days unpaid: the kingdom takes it back — the one path of a property lost)
    net.emit('eco.bill', { u: uid, list: b.list.filter(([id]) => E.pr.has(id)) });
    const left = [...E.pr].filter(([, r]) => r.u === uid && r.due > 0).map(([id, r]) => [id, r.due, r.warn]);
    if (left.length) net.toOwner(b.pid, 'eco.collect', { day, bills: left });
  }
}

// ---------- a property lost (host): THE path for every way a player loses one (docs/REINOS.md §10 / §13) ----------
// a capture of the place, three days of unpaid tax, a house / plot given back to the kingdom: the row goes (and its
// debt: back on the place's sale / rent list, under the kingdom that holds the place now), a house's chests are emptied
// and everything the player built on a PLOT is taken down (struct.remove on every peer: a chunk holding a building is
// never dropped by the host, so they are all here — a far guest gets it with the chunk later; the save keeps it)
export function plotBuildings(game, pr) {
  if (!pr || pr.bi != null) return [];
  const out = [];
  for (const o of game.build.structures) if (o.town == null && o.tx <= pr.x1 && o.tx + (o.fw || 1) - 1 >= pr.x0 && o.ty <= pr.y1 && o.ty + (o.fh || 1) - 1 >= pr.y0) out.push(o.id);
  return out;
}
export function loseProps(game, ids, why, { k = -1, by = undefined, give = undefined, toast = undefined } = {}) {
  const E = game.eco, list = (ids || []).filter((id) => E?.pr.has(id));
  if (!list.length || !game.net.auth) return 0;
  const down = [];
  for (const id of list) down.push(...plotBuildings(game, propById(game, id)));
  game.net.emit('eco.lose', { ids: list, why, k, by, give, toast, built: down.length });
  for (const id of down) game.net.emit('struct.remove', { id, quiet: 1, fx: 'raze' });
  return list.length;
}

// ---------- the system ----------
export function installEco(game) {
  const E = ecoState(game);
  E.onOp = (name, a) => { try { onOp(game, name, a); } catch (e) { if (DEV) console.error(e); } };
  E.plotReason = (s, tx, ty, w, h, who) => plotReason(game, s, tx, ty, w, h, who);
  E.mayUse = (o, pid) => mayUsePiece(game, o, pid);
  E.bedSpot = (id) => bedSpot(game, id);
  E.doorReason = (o, actor) => {
    const id = pieceProp(game, o.id, o.town), row = id && E.pr.get(id);
    if (!row || game.creative || row.u === uidOf(game, actor?.pid)) return null;
    return `Casa de ${row.name || 'outro jogador'}: só quem mora aqui abre`;
  };
  // phase 3a (game/realms.js): a captured place takes its players' houses and plots; a fallen kingdom's members are travellers
  E.loseAt = (sid, why, k = -1) => loseProps(game, [...E.pr.keys()].filter((id) => propById(game, id)?.sid === sid), why, { k });
  E.dropKingdom = (k) => { for (const [u, r] of E.pl) if (r.k === k) game.net.emit('eco.member', { u, k: -1, name: r.name }); };
  E.api = makeApi(game);
  return E;
}
TOWN.mayUse = (game, o, pid) => mayUsePiece(game, o, pid);
// host: the daily tick, job progress; everyone: the local uid known to the host (eco.hello)
export function ecoSystem() {
  let t = 0;
  return {
    sync: 'host',
    update(game, dt) {
      const E = game.eco;
      if (!E || !realmOf(game)) return;
      if (E.pend.size) {
        for (const [k, d] of E.pend) {
          const [uid, id] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)], j = recOf(game, uid)?.jobs.find((q) => q.id === id);
          if (j) game.net.emit('eco.prog', { u: uid, id, got: Math.min(j.n, (j.got | 0) + d) });
        }
        E.pend.clear();
      }
      t -= dt;
      if (t > 0) return;
      t = 1;
      if (E.day < 0) { ensureMarkets(game); game.net.emit('eco.start', { day: game.env.dayIndex, mk: [...E.mk].map(([sid, a]) => [sid, [...a]]) }); return; }
      if (!E.who.has(game.net.pid) || E.who.get(game.net.pid) !== meUid(game)) E.who.set(game.net.pid, meUid(game)); // sync-ok: host-only pid → uid map
      const mine = E.pl.get(meUid(game)), nm = (game.player.name || 'Jogador').slice(0, 18);
      if (!mine || mine.name !== nm || E.pu?.get(game.net.pid) !== meUid(game)) game.net.emit('eco.who', { u: meUid(game), name: nm, by: game.net.pid }); // (the host itself: its record and name; its pid → uid known to every peer — phase 3c)
      // the places made here (their plan known): their real features for every peer's prices (a few a second)
      let n = 0;
      for (const sid of game.towns?.live?.keys() || []) {
        if (E.feat.has(sid)) continue;
        const L = game.towns.layout(sid);
        if (L) { game.net.emit('eco.feat', { sid, f: featuresOf(L) }); if (++n >= 4) break; }
      }
      const day = game.env.dayIndex;
      if (day > E.day && (game.env.hour >= 6 || day > E.day + 1)) dayTick(game, day);
    },
  };
}
// every peer: tell the host who this player is (its uid), once per session
export function ecoOwnerSystem() {
  let sent = null, t = 0;
  return {
    sync: 'owner',
    update(game, dt) {
      t -= dt;
      if (t > 0 || !game.eco) return;
      t = 1;
      const key = game.net.pid + '|' + localUid();
      if (sent === key || !game.net.synced) return;
      if (game.net.auth) { sent = key; return; }
      sent = key;
      game.net.request('eco.hello', { uid: localUid(), name: game.player.name || 'Jogador' }, { onReject: () => { sent = null; } });
    },
  };
}

// ---------- the API for the UI / tests (game.eco.api) ----------
function makeApi(game) {
  return {
    me: () => meUid(game), rec: (u) => recOf(game, u ?? meUid(game)), coins: () => game.player.inv.count(COIN),
    profile: (sid) => profileOf(game, sid), stock: (sid, good) => game.eco.mk.get(sid)?.[GI[good]] | 0,
    quoteBuy: (sid, good, n) => quoteBuy(game, sid, GI[good], n, meUid(game)), quoteSell: (sid, good, n) => quoteSell(game, sid, GI[good], n, meUid(game)),
    board: (sid) => boardOf(game, sid), props: (sid) => propsOf(game, sid), prop: (id) => propById(game, id), charge: (id) => chargeOf(game, id),
    rank: (k, u) => rankInfo(game, u ?? meUid(game), k), taxRate: (k) => taxRate(game, k), mine: () => propsOfUid(game, meUid(game)),
    atMural: (sid) => atMural(game, sid, game.player),
    survey: (sid) => survey(game, settlement(game, sid)), fieldsLeft: (sid, good) => fieldsLeft(game, sid, good, true), jobReason: (j) => jobReason(game, j, true),
    jobArea: (j) => jobArea(game, j),
  };
}
export { COIN, PARCEL, JOB_MAX, REP, PROP, RANKS as RANK_LIST };
