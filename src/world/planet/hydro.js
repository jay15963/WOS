// Hydrology on the macro grid.
//  1. priority-flood from the ocean -> depressions; small shallow ones are filled with sediment, the rest are
//     lakes. Water balance per lake (inflow vs. evaporation of its surface): a lake that can't fill up to its
//     spill point is endorheic (salt lake at a lower level, or a dry salt flat).
//  2. priority-flood again with the endorheic lakes as extra sinks -> flow direction of every cell (D8 tree),
//     discharge (runoff accumulated downstream, lakes lose their evaporation), drainage area.
//  3. rivers = cells whose discharge passes RIVER_Q (springs where it first does); dry washes = big drainage
//     areas in arid land without a perennial flow.

import { MW, MH, metersToStories } from './consts.js';
import { Heap, clamp } from './noise.js';
import { N, DL8, nbTable } from './grid.js';
import { pet } from './climate.js';

export const RIVER_Q = 2400;  // mm*cells/yr of discharge that makes a perennial river (and >= RIVER_A cells drained)
export const RIVER_A = 9;
const EPS = 0.02;             // m per cell: drainage slope on filled flats

// priority-flood (Barnes): fill (Float64), pop order, parent (drains to)
export function priorityFlood(elev, seedLevel) {
  const T = nbTable();
  const fill = new Float64Array(N), parent = new Int32Array(N).fill(-1), order = new Int32Array(N);
  const done = new Uint8Array(N);
  const h = new Heap(16384);
  for (let i = 0; i < N; i++) {
    if (seedLevel[i] === seedLevel[i]) { // not NaN = seed
      fill[i] = seedLevel[i]; done[i] = 1; h.push(fill[i], i);
    }
  }
  let n = 0;
  while (h.n) {
    const i = h.pop();
    order[n++] = i;
    const fi = fill[i];
    for (let k = 0; k < 8; k++) {
      const j = T[i * 8 + k];
      if (j < 0 || done[j]) continue;
      done[j] = 1;
      const f = Math.max(elev[j], fi + EPS * DL8[k]);
      fill[j] = f; parent[j] = i;
      h.push(f, j);
    }
  }
  return { fill, parent, order, n };
}

// (ice sheets and permafrost: the water stays frozen, glaciers carry it instead of rivers)
export function runoffOf(P, T) { const r = Math.max(0, P - 0.85 * Math.min(P, pet(T))); return T < -9 ? 0 : T < -4 ? r * (T + 9) / 5 : r; }

export function computeHydrology(elev, ocean, tMean, precip) {
  const T8 = nbTable();
  // ---- pass 1
  const seed1 = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) if (ocean[i]) seed1[i] = elev[i];
  // the polar edge rows always drain (pack-ice ocean)
  for (let x = 0; x < MW; x++) { if (!ocean[x]) seed1[x] = elev[x]; const j = (MH - 1) * MW + x; if (!ocean[j]) seed1[j] = elev[j]; }
  const f1 = priorityFlood(elev, seed1);
  const R = new Float32Array(N);
  for (let i = 0; i < N; i++) R[i] = ocean[i] ? 0 : runoffOf(precip[i], tMean[i]);
  const Q1 = new Float64Array(N);
  for (let k = f1.n - 1; k >= 0; k--) { const i = f1.order[k]; Q1[i] += R[i]; const p = f1.parent[i]; if (p >= 0) Q1[p] += Q1[i]; }
  // ---- depressions -> lakes
  const lakeId = new Int32Array(N);
  const cand = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!ocean[i] && f1.fill[i] - elev[i] > 1) cand[i] = 1;
  const lakes = [];
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const popIdx = new Int32Array(N);
  for (let k = 0; k < f1.n; k++) popIdx[f1.order[k]] = k;
  for (let s = 0; s < N; s++) {
    if (!cand[s] || seen[s]) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1;
    const cells = [];
    while (sp) {
      const i = stack[--sp]; cells.push(i);
      for (let k = 0; k < 8; k++) {
        const j = T8[i * 8 + k];
        if (j >= 0 && cand[j] && !seen[j] && Math.abs(f1.fill[j] - f1.fill[i]) < 2) { seen[j] = 1; stack[sp++] = j; }
      }
    }
    let level = -1e9, minE = 1e9, first = cells[0];
    for (const i of cells) {
      if (f1.fill[i] > level) level = f1.fill[i];
      if (elev[i] < minE) minE = elev[i];
      if (popIdx[i] < popIdx[first]) first = i;
    }
    const depth = level - minE;
    if (!(cells.length >= 3 || depth >= 45)) {
      for (const i of cells) elev[i] = f1.fill[i]; // sediment-filled flat
      continue;
    }
    const outlet = f1.parent[first];
    let tSum = 0;
    for (const i of cells) tSum += tMean[i];
    const tL = tSum / cells.length;
    const evap = pet(tL) * 1.05 + 30;                   // lake surface evaporation (mm/yr)
    const inflow = outlet >= 0 ? Q1[first] : 0;         // all the runoff that reaches the lake
    const id = lakes.length + 1;
    const lk = { id, level, minE, area: cells.length, outlet, endorheic: false, salt: false, dry: false, tMean: tL };
    if (inflow < evap * cells.length) {
      // endorheic: the surface where inflow = evaporation
      lk.endorheic = true; lk.salt = true;
      const sorted = cells.slice().sort((a, b) => elev[a] - elev[b] || a - b);
      const nWet = Math.floor(inflow / evap);
      if (nWet < 1) { lk.dry = true; lk.level = elev[sorted[0]] + 1; lk.wet = [sorted[0]]; }
      else {
        const k = Math.min(sorted.length - 1, nWet - 1);
        lk.level = elev[sorted[k]] + 0.5 * ((k + 1 < sorted.length ? elev[sorted[k + 1]] : elev[sorted[k]] + 10) - elev[sorted[k]]);
        lk.wet = sorted.slice(0, k + 1);
      }
      lk.area = lk.wet.length;
      lk.basin = cells;
      for (const i of lk.wet) lakeId[i] = id;
    } else {
      for (const i of cells) lakeId[i] = id;
    }
    lakes.push(lk);
  }
  // ---- pass 2: endorheic lakes are sinks
  const seed2 = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) if (!Number.isNaN(seed1[i])) seed2[i] = seed1[i];
  for (const lk of lakes) if (lk.endorheic) for (const i of lk.wet) seed2[i] = lk.level;
  const f2 = priorityFlood(elev, seed2);
  const down = f2.parent;
  // discharge: runoff accumulated downstream; lake cells evaporate
  const Q = new Float32Array(N), A = new Float32Array(N);
  const lakeEvap = new Float32Array(lakes.length + 1);
  for (const lk of lakes) lakeEvap[lk.id] = pet(lk.tMean) * 1.05 + 30;
  {
    const q = new Float64Array(N), a = new Float64Array(N);
    for (let k = f2.n - 1; k >= 0; k--) {
      const i = f2.order[k];
      if (ocean[i]) continue;
      const L = lakeId[i];
      q[i] += L ? precip[i] - lakeEvap[L] : R[i];
      if (q[i] < 0) q[i] = 0;
      a[i] += 1;
      const p = down[i];
      if (p >= 0 && !ocean[p]) { q[p] += q[i]; a[p] += a[i]; }
      Q[i] = q[i]; A[i] = a[i];
    }
  }
  // lakes: drainage-level surface (m) per cell (NaN off lakes)
  const lakeLevel = new Float32Array(N).fill(NaN);
  for (const lk of lakes) {
    const list = lk.endorheic ? lk.wet : null;
    if (list) for (const i of list) lakeLevel[i] = lk.level;
  }
  for (let i = 0; i < N; i++) if (lakeId[i] && !lakes[lakeId[i] - 1].endorheic) lakeLevel[i] = lakes[lakeId[i] - 1].level;
  // the drainage surface: filled elevation (lakes at their level)
  const surf = new Float32Array(N);
  for (let i = 0; i < N; i++) surf[i] = lakeId[i] ? lakeLevel[i] : Math.max(elev[i], f2.fill[i]);
  return { lakes, lakeId, lakeLevel, down, order: f2.order, nOrder: f2.n, Q, A, R, surf };
}

// River network: kind per cell (0 none, 1 river, 2 dry wash, 3 fjord, 4 creek), relative flow (Q / RIVER_Q),
// main upstream branch, distance to the mouth (cells), river surface level (stories, monotone downstream),
// waterfall drop (stories, on the upstream cell of a step).
export function buildRivers(h, elev, ocean, precip, tMean, opts) {
  const T8 = nbTable();
  const { down, Q, A, lakeId, surf, order, nOrder } = h;
  const kind = new Uint8Array(N), flow = new Float32Array(N), upMain = new Int32Array(N).fill(-1);
  const mouthD = new Uint16Array(N), level = new Float32Array(N), fall = new Float32Array(N), canyon = new Float32Array(N);
  const fj = opts.fjord, cany = opts.canyon;
  for (let i = 0; i < N; i++) {
    if (ocean[i]) continue;
    const q = Q[i] / RIVER_Q;
    const inLake = lakeId[i] > 0;
    if (!inLake && ((q >= 1 && A[i] >= RIVER_A) || (fj[i] > 0.4 && q >= 0.3 && A[i] >= 4))) kind[i] = 1;
    else if (!inLake && A[i] >= 20 && precip[i] < 420 && cany[i] > 0.15) kind[i] = 2;
    else if (!inLake && A[i] >= 8 && cany[i] > 0.35) kind[i] = 2;
    flow[i] = q;
  }
  // creeks: small headwater streams that feed a river or a lake within 3 cells
  for (let i = 0; i < N; i++) {
    if (kind[i] || ocean[i] || lakeId[i] || A[i] < 5 || Q[i] < RIVER_Q * 0.45) continue;
    let j = down[i];
    for (let s = 0; s < 2 && j >= 0; s++) {
      if (kind[j] === 1 || lakeId[j]) { kind[i] = 4; break; }
      if (ocean[j] || kind[j] === 2) break;
      j = down[j];
    }
  }
  // main upstream branch = the inflowing river cell with the largest discharge
  for (let i = 0; i < N; i++) {
    const d = down[i];
    if (!kind[i] || d < 0) continue;
    const m = upMain[d];
    if (m < 0 || Q[i] > Q[m] || (Q[i] === Q[m] && i < m)) upMain[d] = i;
  }
  // downstream-first pass (pop order): mouth distance, fjords, levels
  for (let k = 0; k < nOrder; k++) {
    const i = order[k];
    if (!kind[i]) continue;
    const d = down[i];
    const toSea = d < 0 || ocean[d];
    mouthD[i] = toSea ? 1 : lakeId[d] ? 0 : Math.min(65535, mouthD[d] + 1);
    if (kind[i] === 1 && fj[i] > 0.4 && (toSea || kind[d] === 3) && mouthD[i] <= 8) kind[i] = 3;
    const inc = kind[i] === 3 ? 0 : cany[i] * (kind[i] === 2 ? 3.2 : 4.6);
    canyon[i] = kind[i] === 3 ? 0 : cany[i];
    let L = kind[i] === 3 ? 0 : metersToStories(Math.max(0, surf[i])) - inc;
    const Ld = d < 0 || ocean[d] ? 0 : lakeId[d] ? metersToStories(surf[d]) : kind[d] ? level[d] : metersToStories(Math.max(0, surf[d]));
    if (L < Ld + 0.02) L = Ld + 0.02;
    if (kind[i] === 3) L = 0;
    level[i] = L;
    const drop = L - Ld;
    if (drop > 1.25 && kind[i] !== 2 && kind[i] !== 4) fall[i] = drop;
  }
  void T8; void tMean; void clamp;
  return { kind, flow, upMain, mouthD, level, fall, canyon };
}
