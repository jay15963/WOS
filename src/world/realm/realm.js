// Kingdoms and settlements on the planet (docs/REINOS.md "Implementação — geração"): a pure function of the macro planet
// (src/world/planet generatePlanet), run once per world right after it (the planet worker / the main thread fallback /
// every chunk worker gets it inside the planet object: planet.realm). No DOM, no Math.random, no trig in the data:
// only + − × ÷ sqrt, hashes and the seed — every peer makes the same realm.
//
// realm = {
//   v, seed, ms,
//   kingdoms:    [{ id, name, color [r,g,b], banner {f, m, d, c, c2}, capital (sid), comp (landmass), area (cells),
//                   settlements [sid…], neighbours [kid…] (sharing a border, same landmass) }],
//   settlements: [{ id, k (kingdom), kind 'city'|'castle'|'village', name, x, y (centre tile), r (core radius: the town
//                   land / walls, tiles), ro (outer radius: fields, pens), pop, comp, walls 'stone'|'palisade'|null,
//                   seed, exits [[x, y]] (where its roads leave the core: gates), roads [roadId] }],
//   roads:       [{ id, a, b (sids), k (kingdom, −1 between two), main (bool), w (width tiles), pts Float32Array [x, y, …] }],
//   owner:       Uint8Array(MW·MH)  kingdom id + 1 of each macro cell (0 = free land)
//   district:    Uint16Array(MW·MH) settlement id + 1 whose district the cell is (inside a kingdom)
// }
// canReach(realm, kA, kB): same landmass (no ships yet: kingdoms on different landmasses never interact).

import { MW, MH, CELL, W as PW, seasonZoneOf } from '../planet/consts.js';
import { BIOME_KEYS } from '../planet/biomes.js';
import { nbTable, DL8, blur } from '../planet/grid.js';
import { Heap, rng32 } from '../planet/noise.js';
import { makeNamer, KINGDOM_COLORS, makeBanner } from './names.js';

export const REALM_V = 1;
export const MAX_KINGDOMS = 30;
const NC = MW * MH;
const FL_VOLC = 1, FL_CANYON = 2, FL_FJORD = 4;

// settlement sizes (tiles) and populations
export const SITE = {
  city: { r: 56, ro: 80, pop: 200 },
  castle: { r: 18, ro: 40, pop: 30 },
  village: { r: 27, ro: 52, pop: 50 },
};
export const BLEND = 10; // tiles of the terrain blend ring outside the outer radius (ground.js)

// how good a biome is to live in (0 = never a settlement)
const HAB_BIOME = { temperate_forest: 1, steppe: 1, floodplain: 1.1, mediterranean: 1, heath: 0.75, taiga: 0.6, tropical_dry: 0.8, savanna: 0.75,
  rainforest: 0.45, cloud_forest: 0.35, temperate_rainforest: 0.7, tundra: 0.2, alpine: 0.25, marsh: 0.3, swamp: 0.25, cold_desert: 0.25,
  desert_rocky: 0.1, badlands: 0.18, desert_dunes: 0.02, beach: 0.3, rocky_shore: 0.35 };
const NO_SITE = new Set(['ice_sheet', 'polar_desert', 'snow_peaks', 'salt_flat', 'desert_dunes', 'mangrove', 'swamp', 'cliff', 'beach', 'volcanic', 'sea_ice']);

const hashU = (s, a, b) => {
  let h = Math.imul((s | 0) ^ 0x51ed270b, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const cx = (i) => i % MW, cyOf = (i) => (i - (i % MW)) / MW;
function cdist(a, b) { let dx = Math.abs(cx(a) - cx(b)); if (dx > MW / 2) dx = MW - dx; const dy = cyOf(a) - cyOf(b); return Math.sqrt(dx * dx + dy * dy); }
const cellAt = (x, y) => { const X = ((Math.floor(x / CELL) % MW) + MW) % MW, Y = Math.max(0, Math.min(MH - 1, Math.floor(y / CELL))); return Y * MW + X; };
// cells within radius r (cells) of c
function disc(c, r, fn) {
  const x0 = cx(c), y0 = cyOf(c), R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= MH) return false;
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (fn(y * MW + ((x0 + dx) % MW + MW) % MW) === false) return false;
    }
  }
  return true;
}

export function generateRealm(p) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const seed = p.seed | 0, T8 = nbTable();
  const rnd = rng32(seed * 7919 + 4421);
  const land = (i) => !p.water[i] && !p.ocean[i] && !p.lakeId[i];
  // ---------- habitability per cell ----------
  const hab = new Float32Array(NC);
  for (let i = 0; i < NC; i++) {
    if (!land(i)) continue;
    let h = HAB_BIOME[BIOME_KEYS[p.biome[i]]] || 0;
    if (!h) continue;
    const z = seasonZoneOf(p.tMean[i], p.tAmp[i]);
    if (z === 4) continue;
    if (z === 3) h *= 0.45; else if (z === 0) h *= 0.9;
    const e = p.elev[i];
    if (e > 2200) continue;
    if (e > 1400) h *= 0.5;
    h *= 1 - Math.min(0.8, p.relief[i] * 1.6);
    h *= 1 - Math.min(0.9, p.mtn[i]);
    if (p.flags[i] & FL_VOLC) h *= 0.5;
    let riv = p.rkind[i] === 1;
    for (let k = 0; k < 8 && !riv; k++) { const j = T8[i * 8 + k]; if (j >= 0 && p.rkind[j] === 1) riv = true; }
    if (riv) h += h < 0.2 ? 0.45 : 0.25; // (a river through dry land: the Nile strips)
    if (p.dOcean[i] >= 1 && p.dOcean[i] <= 4) h += 0.1;
    hab[i] = h;
  }
  // a settlement site: every cell of the core disc dry, flat enough, no big river, no ice / dunes / swamp
  const siteOk = (c, r, maxRel) => {
    if (hab[c] < 0.15 || p.dOcean[c] < 2) return false;
    const e0 = p.elev[c];
    return disc(c, r, (i) => {
      if (!land(i) || p.rkind[i] === 1 || (p.flags[i] & (FL_VOLC | FL_CANYON | FL_FJORD)) || p.relief[i] > maxRel || p.mtn[i] > 0.25) return false;
      if (NO_SITE.has(BIOME_KEYS[p.biome[i]]) || Math.abs(p.elev[i] - e0) > 260 || p.elev[i] < 8) return false;
      return true;
    });
  };
  // habitable mass around each cell (the capitals go where there is room for a kingdom)
  const mass = blur(Float32Array.from(hab, (h) => (h > 0.3 ? 1 : 0)), 7);
  const compHab = new Map();
  for (let i = 0; i < NC; i++) if (hab[i] > 0.3) compHab.set(p.comp[i], (compHab.get(p.comp[i]) || 0) + 1);

  // ---------- capitals ----------
  const cands = [];
  for (let i = 0; i < NC; i++) {
    if (hab[i] < 0.65 || mass[i] < 0.3 || (compHab.get(p.comp[i]) || 0) < 200) continue;
    cands.push([hab[i] * 0.6 + mass[i] * 1.4 + hashU(seed, i, 1) * 0.5, i]);
  }
  cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const caps = [];
  for (const [, c] of cands) {
    if (caps.length >= MAX_KINGDOMS + 6) break; // (a few spare: some kingdoms may not fit their settlements)
    if (caps.some((q) => cdist(q, c) < 23)) continue;
    if (!siteOk(c, 3, 0.28)) continue;
    caps.push(c);
  }

  // ---------- territories: cost-limited growth from the capitals over land ----------
  const RK = 17;
  const stepCost = (i, j, k) => {
    let c = DL8[k] * (1 + 2.5 * p.relief[j] + 6 * p.mtn[j] + (hab[j] < 0.12 ? 2.5 : 0) + (p.elev[j] > 1800 ? 3 : 0));
    if (p.rkind[j] === 1 && p.rkind[i] !== 1) c += 1.5; // (big rivers make borders)
    return c;
  };
  const growTerr = (seeds) => {
    const own = new Int16Array(NC).fill(-1), best = new Float64Array(NC).fill(Infinity), tag = new Int16Array(NC).fill(-1), H = new Heap(8192);
    seeds.forEach((c, k) => { best[c] = 0; tag[c] = k; H.push(0, c); });
    while (H.n) {
      const i = H.pop(), di = H.lastKey;
      if (own[i] >= 0 || di > best[i]) continue;
      own[i] = tag[i];
      for (let q = 0; q < 8; q++) {
        const j = T8[i * 8 + q];
        if (j < 0 || own[j] >= 0 || !land(j)) continue;
        const nd = di + stepCost(i, j, q);
        if (nd > RK) continue;
        if (nd < best[j]) { best[j] = nd; tag[j] = tag[i]; H.push(nd, j); }
      }
    }
    return own;
  };
  let own = growTerr(caps);

  // ---------- settlements of each kingdom ----------
  const namer = makeNamer(rnd);
  const kingdoms = [], settlements = [];
  const taken = []; // cells of every settlement so far
  const farFromAll = (c, d) => taken.every((q) => cdist(q, c) >= d);
  const cellsOf = new Map();
  for (let i = 0; i < NC; i++) if (own[i] >= 0) { let a = cellsOf.get(own[i]); if (!a) cellsOf.set(own[i], (a = [])); a.push(i); }
  // distance (cells) to the territory's edge, per cell
  const edgeD = new Float32Array(NC).fill(0);
  {
    const H = new Heap(4096), d = new Float64Array(NC).fill(1e9);
    for (let i = 0; i < NC; i++) {
      if (own[i] < 0) continue;
      for (let q = 0; q < 8; q++) { const j = T8[i * 8 + q]; if (j < 0 || own[j] !== own[i]) { d[i] = 0; H.push(0, i); break; } }
    }
    while (H.n) {
      const i = H.pop(), di = H.lastKey;
      if (di > d[i]) continue;
      for (let q = 0; q < 8; q++) { const j = T8[i * 8 + q]; if (j < 0 || own[j] !== own[i]) continue; const nd = di + DL8[q]; if (nd < d[j]) { d[j] = nd; H.push(nd, j); } }
    }
    for (let i = 0; i < NC; i++) if (own[i] >= 0) edgeD[i] = d[i];
  }
  const foreignNear = (c, r) => !disc(c, r, (i) => !(own[i] >= 0 && own[i] !== own[c]));
  const newSettlement = (kid, kind, c, comp) => {
    const S = SITE[kind];
    const ox = Math.floor((hashU(seed, c, 11) - 0.5) * 12), oy = Math.floor((hashU(seed, c, 12) - 0.5) * 12);
    const popJ = 0.7 + hashU(seed, c, 13) * 0.6;
    const pop = Math.round(S.pop * popJ);
    const rk = kind === 'castle' ? 1 : Math.sqrt(popJ);
    const s = {
      id: settlements.length, k: kid, kind, name: '', x: cx(c) * CELL + CELL / 2 + ox, y: cyOf(c) * CELL + CELL / 2 + oy,
      r: Math.round(S.r * rk), ro: Math.round(S.ro * (0.85 + 0.15 * rk)), pop, comp, cell: c,
      walls: kind === 'village' ? (hashU(seed, c, 14) < 0.4 ? 'palisade' : null) : 'stone', seed: Math.floor(hashU(seed, c, 15) * 2147483647), exits: [], roads: [],
    };
    settlements.push(s);
    taken.push(c);
    return s;
  };
  let kid = 0;
  for (let ci = 0; ci < caps.length && kingdoms.length < MAX_KINGDOMS; ci++) {
    const cells = cellsOf.get(ci) || [];
    const c0 = caps[ci], comp = p.comp[c0];
    const area = cells.length;
    if (area < 150) continue;
    const firstS = settlements.length, takenN = taken.length;
    const k = kingdoms.length;
    const city = newSettlement(k, 'city', c0, comp);
    // castles: near the border (facing neighbours), on gentle hills
    const nC = Math.max(2, Math.min(4, Math.round(area / 220) + 1));
    const castles = [];
    const pickInto = (list, n, ok, score, sep) => {
      const cs = [];
      for (const c of cells) if (ok(c)) cs.push([score(c), c]);
      cs.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (const [, c] of cs) { if (list.length >= n) break; if (!farFromAll(c, sep)) continue; list.push(c); taken.push(c); }
    };
    const castleScore = (c) => {
      const e = edgeD[c], border = 1 - Math.min(1, Math.abs(e - 3.5) / 4);
      const rel = p.relief[c], hill = rel > 0.06 && rel < 0.35 ? 1 : 0.4;
      return border * 1.2 + hill * 0.8 + (foreignNear(c, 10) ? 0.6 : 0) + hashU(seed, c, 2) * 0.4;
    };
    pickInto(castles, nC, (c) => cdist(c, c0) >= 7 && siteOk(c, 1.5, 0.4), castleScore, 6);
    if (castles.length < 2) pickInto(castles, 2, (c) => cdist(c, c0) >= 5 && siteOk(c, 1.5, 0.45), castleScore, 5);
    // villages: rivers, farmland and coasts
    const nV = Math.max(8, Math.min(20, Math.round(area / 30)));
    const villages = [];
    const vScore = (c) => {
      let riv = 0;
      disc(c, 2.2, (i) => { if (p.rkind[i] === 1) riv = 1; });
      const coast = p.dOcean[c] >= 2 && p.dOcean[c] <= 5 ? 1 : 0;
      return hab[c] + riv * 0.6 + coast * 0.25 + hashU(seed, c, 3) * 0.35 - Math.max(0, cdist(c, c0) - 12) * 0.02;
    };
    pickInto(villages, nV, (c) => hab[c] >= 0.35 && cdist(c, c0) >= 5 && siteOk(c, 1.6, 0.32), vScore, 4);
    if (villages.length < 8) pickInto(villages, 8, (c) => hab[c] >= 0.25 && cdist(c, c0) >= 5 && siteOk(c, 1.5, 0.36), vScore, 3.7);
    if (villages.length < 8 || castles.length < 2) {
      // no room for a whole kingdom: give the land back (it stays free)
      settlements.length = firstS; taken.length = takenN;
      for (const c of cells) own[c] = -2 - ci;
      continue;
    }
    for (const c of castles) newSettlement(k, 'castle', c, comp);
    for (const c of villages) newSettlement(k, 'village', c, comp);
    // drop the cells we pushed into `taken` by pickInto (newSettlement pushes them again)
    taken.length = takenN;
    for (let s = firstS; s < settlements.length; s++) taken.push(settlements[s].cell);
    const ids = [];
    for (let s = firstS; s < settlements.length; s++) ids.push(s);
    kingdoms.push({ id: k, src: ci, name: '', color: null, banner: null, capital: city.id, comp, area, settlements: ids, neighbours: [] });
    kid++;
  }
  // territory ids: the capital index → kingdom id (dropped ones become free land)
  const capToK = new Map(kingdoms.map((K) => [K.src, K.id]));
  const owner = new Uint8Array(NC);
  for (let i = 0; i < NC; i++) { const k = capToK.get(own[i]); if (k != null) owner[i] = k + 1; }
  for (const K of kingdoms) delete K.src;
  own = null;

  // ---------- names, colours, banners ----------
  const colIdx = KINGDOM_COLORS.map((_, i) => i);
  for (let i = colIdx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = colIdx[i]; colIdx[i] = colIdx[j]; colIdx[j] = t; }
  for (const K of kingdoms) {
    K.name = namer.kingdom();
    K.color = KINGDOM_COLORS[colIdx[K.id % colIdx.length]];
    K.banner = makeBanner(rnd, K.color, KINGDOM_COLORS.filter((c) => c !== K.color));
  }
  for (const s of settlements) s.name = s.kind === 'city' ? namer.city() : s.kind === 'castle' ? namer.castle() : namer.village();

  // ---------- districts: each kingdom cell belongs to its nearest settlement ----------
  const district = new Uint16Array(NC);
  {
    const H = new Heap(8192), d = new Float64Array(NC).fill(Infinity);
    for (const s of settlements) { const c = s.cell; d[c] = 0; district[c] = s.id + 1; H.push(0, c); }
    while (H.n) {
      const i = H.pop(), di = H.lastKey;
      if (di > d[i]) continue;
      for (let q = 0; q < 8; q++) {
        const j = T8[i * 8 + q];
        if (j < 0 || owner[j] !== owner[i] || !owner[j]) continue;
        const nd = di + stepCost(i, j, q);
        if (nd < d[j]) { d[j] = nd; district[j] = district[i]; H.push(nd, j); }
      }
    }
  }

  // ---------- neighbours: kingdoms whose territories touch (same landmass) ----------
  for (let i = 0; i < NC; i++) {
    const a = owner[i];
    if (!a) continue;
    for (let q = 0; q < 8; q++) {
      const j = T8[i * 8 + q];
      if (j < 0) continue;
      const b = owner[j];
      if (b && b !== a) { const A = kingdoms[a - 1]; if (!A.neighbours.includes(b - 1)) A.neighbours.push(b - 1); }
    }
  }
  // kingdoms close across a strip of free land count as neighbours too (a road may join them)
  for (const A of kingdoms) for (const B of kingdoms) {
    if (A.id >= B.id || A.comp !== B.comp || A.neighbours.includes(B.id)) continue;
    const ca = settlements[A.capital].cell, cb = settlements[B.capital].cell;
    if (cdist(ca, cb) < 46) { A.neighbours.push(B.id); B.neighbours.push(A.id); }
  }
  for (const K of kingdoms) K.neighbours.sort((a, b) => a - b);

  // ---------- roads ----------
  const roads = [], roadCell = new Uint8Array(NC);
  const G = new Float64Array(NC).fill(Infinity), from = new Int32Array(NC).fill(-1), seen = [];
  const roadCost = (i, j, q) => {
    let c = DL8[q] * (1 + 3 * p.relief[j] + 12 * p.mtn[j] + Math.abs(p.elev[j] - p.elev[i]) / 120 + (hab[j] < 0.1 ? 0.6 : 0));
    if (p.rkind[j] === 1 && p.rkind[i] !== 1) c += 2;
    if (roadCell[j]) c *= 0.45;
    return c;
  };
  const astar = (a, b) => {
    for (const i of seen) { G[i] = Infinity; from[i] = -1; }
    seen.length = 0;
    const H = new Heap(4096);
    G[a] = 0; seen.push(a); H.push(cdist(a, b) * 0.45, a);
    let n = 0;
    while (H.n) {
      const i = H.pop();
      if (i === b) break;
      if (++n > 60000) return null;
      const gi = G[i];
      for (let q = 0; q < 8; q++) {
        const j = T8[i * 8 + q];
        if (j < 0 || !land(j)) continue;
        const ng = gi + roadCost(i, j, q);
        if (ng < G[j]) { if (G[j] === Infinity) seen.push(j); G[j] = ng; from[j] = i; H.push(ng + cdist(j, b) * 0.45, j); }
      }
    }
    if (G[b] === Infinity) return null;
    const path = [];
    for (let i = b; i >= 0; i = i === a ? -1 : from[i]) path.push(i);
    return path.reverse();
  };
  const addRoad = (sa, sb, k, main) => {
    const A = settlements[sa], B = settlements[sb];
    if (roads.some((r) => (r.a === sa && r.b === sb) || (r.a === sb && r.b === sa))) return;
    const path = astar(A.cell, B.cell);
    if (!path) return;
    for (const c of path) roadCell[c] = 1;
    // tile polyline: the settlement centres, cell centres jittered in between, Chaikin-smoothed twice
    let P = [[A.x, A.y]];
    for (let n = 1; n < path.length - 1; n++) {
      const c = path[n];
      let x = cx(c) * CELL + CELL / 2 + (hashU(seed, c, 21) - 0.5) * 14, y = cyOf(c) * CELL + CELL / 2 + (hashU(seed, c, 22) - 0.5) * 14;
      const px = P[P.length - 1][0];
      if (x - px > PW / 2) x -= PW; else if (px - x > PW / 2) x += PW; // (continuous across the seam)
      P.push([x, y]);
    }
    { let x = B.x; const px = P[P.length - 1][0]; if (x - px > PW / 2) x -= PW; else if (px - x > PW / 2) x += PW; P.push([x, B.y]); }
    for (let it = 0; it < 2; it++) {
      const Q = [P[0]];
      for (let n = 0; n < P.length - 1; n++) {
        const [x0, y0] = P[n], [x1, y1] = P[n + 1];
        Q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
      }
      Q.push(P[P.length - 1]);
      P = Q;
    }
    const pts = new Float32Array(P.length * 2);
    P.forEach(([x, y], n) => { pts[n * 2] = Math.round(x * 4) / 4; pts[n * 2 + 1] = Math.round(y * 4) / 4; });
    const id = roads.length;
    roads.push({ id, a: sa, b: sb, k, main, w: main ? 3 : 2, pts });
    A.roads.push(id); B.roads.push(id);
  };
  for (const K of kingdoms) {
    // a minimum spanning tree over the kingdom's settlements (Prim, cell distances), then a few loops
    const ids = K.settlements, inT = new Set([K.capital]), edges = [];
    while (inT.size < ids.length) {
      let best = null, bd = Infinity;
      for (const a of inT) for (const b of ids) {
        if (inT.has(b)) continue;
        const d = cdist(settlements[a].cell, settlements[b].cell) * (settlements[b].kind === 'village' ? 1 : 0.9);
        if (d < bd || (d === bd && (a * 997 + b) < (best[0] * 997 + best[1]))) { bd = d; best = [a, b]; }
      }
      inT.add(best[1]); edges.push(best);
    }
    edges.sort((e, f) => cdist(settlements[e[0]].cell, settlements[e[1]].cell) - cdist(settlements[f[0]].cell, settlements[f[1]].cell) || e[0] - f[0] || e[1] - f[1]);
    for (const [a, b] of edges) addRoad(a, b, K.id, settlements[a].kind !== 'village' && settlements[b].kind !== 'village');
    // loops: a village joins its second nearest settlement when that is close
    for (const a of ids) {
      if (settlements[a].kind !== 'village') continue;
      const near = ids.filter((b) => b !== a).map((b) => [cdist(settlements[a].cell, settlements[b].cell), b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      if (near[1] && near[1][0] < 9 && hashU(seed, a, 31) < 0.5) addRoad(a, near[1][1], K.id, false);
    }
  }
  // between neighbouring kingdoms: their two closest settlements (castles and cities first)
  for (const A of kingdoms) for (const bid of A.neighbours) {
    if (bid <= A.id) continue;
    const B = kingdoms[bid];
    let best = null, bd = Infinity;
    for (const a of A.settlements) for (const b of B.settlements) {
      const sa = settlements[a], sb = settlements[b];
      const d = cdist(sa.cell, sb.cell) * (sa.kind === 'village' ? 1.15 : 1) * (sb.kind === 'village' ? 1.15 : 1);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    if (best && bd < 40) addRoad(best[0], best[1], -1, true);
  }
  // ---------- the start: a village in the deep temperate zone (docs/REINOS.md "O início") ----------
  // every cell of its 3 × 3 block temperate with a margin of 1 °C (planetSource checks the exact tile climate and takes the
  // first candidate that passes); a seed without one gets a village placed there, in the nearest kingdom of its landmass
  const deepT = (c) => {
    for (let q = -1; q < 8; q++) {
      const i = q < 0 ? c : T8[c * 8 + q];
      if (i < 0 || !land(i)) return false;
      const T = p.tMean[i], A = p.tAmp[i], cold = T - A / 2, warm = T + A / 2;
      if (seasonZoneOf(T, A) !== 2 || Math.min(6 - cold, warm - 10, cold + 12) < 1) return false;
    }
    return true;
  };
  const startScore = (s) => -Math.abs(p.tMean[s.cell] - 11) * 0.5 + hab[s.cell] - p.relief[s.cell] * 4 + (s.walls ? 0.2 : 0) + hashU(seed, s.id, 41) * 0.3;
  let starts = settlements.filter((s) => s.kind === 'village' && deepT(s.cell)).sort((a, b) => startScore(b) - startScore(a) || a.id - b.id).map((s) => s.id);
  if (!starts.length && kingdoms.length) {
    const cs = [];
    for (let i = 0; i < NC; i++) if (hab[i] >= 0.4 && deepT(i) && farFromAll(i, 4) && siteOk(i, 1.6, 0.32)) cs.push([hab[i] - p.relief[i] * 4 + hashU(seed, i, 42) * 0.2, i]);
    cs.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, c] of cs) {
      // its kingdom: the nearest on the same landmass
      let K = null, bd = Infinity;
      for (const Q of kingdoms) { const d = cdist(settlements[Q.capital].cell, c); if (Q.comp === p.comp[c] && d < bd) { bd = d; K = Q; } }
      if (!K) continue;
      const v = newSettlement(K.id, 'village', c, K.comp);
      v.name = namer.village();
      K.settlements.push(v.id);
      district[c] = v.id + 1;
      let near = null, nd = Infinity;
      for (const sid of K.settlements) { if (sid === v.id) continue; const d = cdist(settlements[sid].cell, c); if (d < nd) { nd = d; near = sid; } }
      if (near != null) addRoad(v.id, near, K.id, false);
      starts = [v.id];
      break;
    }
  }
  // where each road leaves a settlement's core: its gates
  for (const s of settlements) {
    for (const rid of s.roads) {
      const R = roads[rid], P = R.pts, n = P.length / 2, fromA = R.a === s.id;
      for (let t = 0; t < n; t++) {
        const k = fromA ? t : n - 1 - t;
        let x = P[k * 2];
        if (x - s.x > PW / 2) x -= PW; else if (s.x - x > PW / 2) x += PW;
        const y = P[k * 2 + 1], d = Math.hypot(x - s.x, y - s.y);
        if (d >= s.r + 6) { s.exits.push([Math.round(x * 4) / 4, Math.round(y * 4) / 4]); break; }
      }
    }
  }
  const ms = typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0;
  return { v: REALM_V, seed, ms, kingdoms, settlements, roads, owner, district, starts: starts.slice(0, 12) };
}

// ---------- queries (any peer, any thread) ----------
export const canReach = (realm, a, b) => !!realm && a >= 0 && b >= 0 && realm.kingdoms[a]?.comp === realm.kingdoms[b]?.comp;
export const kingdomAtCell = (realm, c) => (realm && c >= 0 ? realm.owner[c] - 1 : -1);
export function kingdomAt(realm, x, y) { return realm ? realm.owner[cellAt(x, y)] - 1 : -1; }
export function districtAt(realm, x, y) { const d = realm ? realm.district[cellAt(x, y)] : 0; return d ? realm.settlements[d - 1] : null; }

// spatial index (built once per consumer, never cloned): chunk → { s: [sid], r: [[roadId, i0, i1]] }
const IDX = new WeakMap();
export function realmIndex(realm) {
  let I = IDX.get(realm);
  if (I) return I;
  I = new Map();
  const at = (c) => { let e = I.get(c); if (!e) I.set(c, (e = { s: [], r: [] })); return e; };
  const ch = (x) => (((Math.floor(x / 64) % 256) + 256) % 256);
  for (const s of realm.settlements) {
    const R = s.ro + BLEND + 2;
    for (let cy = Math.max(0, Math.floor((s.y - R) / 64)); cy <= Math.min(127, Math.floor((s.y + R) / 64)); cy++)
      for (let X = Math.floor((s.x - R) / 64); X <= Math.floor((s.x + R) / 64); X++) at(cy * 256 + ch(X * 64)).s.push(s.id);
  }
  for (const R of realm.roads) {
    const P = R.pts, n = P.length / 2, m = R.w + 4;
    for (let k = 0; k < n - 1; k++) {
      const x0 = Math.min(P[k * 2], P[k * 2 + 2]) - m, x1 = Math.max(P[k * 2], P[k * 2 + 2]) + m;
      const y0 = Math.min(P[k * 2 + 1], P[k * 2 + 3]) - m, y1 = Math.max(P[k * 2 + 1], P[k * 2 + 3]) + m;
      for (let cy = Math.max(0, Math.floor(y0 / 64)); cy <= Math.min(127, Math.floor(y1 / 64)); cy++)
        for (let X = Math.floor(x0 / 64); X <= Math.floor(x1 / 64); X++) {
          const e = at(cy * 256 + ch(X * 64)), last = e.r[e.r.length - 1];
          if (last && last[0] === R.id && last[2] === k - 1) last[2] = k; else if (!(last && last[0] === R.id && last[2] === k)) e.r.push([R.id, k, k]);
        }
    }
  }
  IDX.set(realm, I);
  return I;
}
// within `extra` tiles of any settlement's outer ring (camps, wild herds keep away; the chunk and its neighbours)
export function nearSettlement(realm, x, y, extra = 0) {
  if (!realm) return false;
  const I = realmIndex(realm), cx = Math.floor(x / 64), cy = Math.floor(y / 64);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const yy = cy + dy;
    if (yy < 0 || yy > 127) continue;
    const e = I.get(yy * 256 + ((((cx + dx) % 256) + 256) % 256));
    if (!e) continue;
    for (const sid of e.s) {
      const s = realm.settlements[sid];
      let ddx = x - s.x;
      if (ddx > PW / 2) ddx -= PW; else if (ddx < -PW / 2) ddx += PW;
      const R = s.ro + extra;
      if (ddx * ddx + (y - s.y) * (y - s.y) < R * R) return true;
    }
  }
  return false;
}
// the settlement whose town land (core disc) holds the point (null: none)
export function settlementAt(realm, x, y, pad = 0) {
  if (!realm) return null;
  const e = realmIndex(realm).get((Math.max(0, Math.min(127, Math.floor(y / 64)))) * 256 + (((Math.floor(x / 64) % 256) + 256) % 256));
  if (!e) return null;
  for (const sid of e.s) {
    const s = realm.settlements[sid];
    let dx = x - s.x;
    if (dx > PW / 2) dx -= PW; else if (dx < -PW / 2) dx += PW;
    if (dx * dx + (y - s.y) * (y - s.y) <= (s.r + pad) * (s.r + pad)) return s;
  }
  return null;
}
