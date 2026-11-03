// generateChunk(planet, cx, cy[, opts]): the tiles of one 64 x 64 chunk, from the macro planet + noise.
// Pure function of (planet, cx, cy): every peer / worker computes the same bits, and chunks join without seams
// (also across the wrap at x = 0) because every value is either a function of the global tile position or of
// a window that extends MARGIN tiles past the chunk (distance fields are capped below MARGIN).
//
// Pipeline per window (chunk + margin): macro interpolation (bicubic elevation, bilinear climate) -> detail
// noise in stories (hills, ridged mountains, dunes, mesas) -> land / sea -> coast shaping by coast type (beach,
// dunes, lagoon barrier, rocky, cliffs + sea stacks, mangrove, fjord, ice) -> rivers (splines through the
// macro river cells, meanders, floodplains, canyons with walls, fjords, waterfalls) -> lakes + ponds -> deltas
// -> water classes, biome, ground, rock, ore -> corner heights -> natural objects, decor, fertile soil.
// Output layout: docs/PLANET.md §6.

import { W, H, CELL, MW, MH, CHUNK, CW, ABYSS_M, metersToStories, storiesToMeters } from './consts.js';
import { fbm, ridged, gnoise, hash01, ihash, clamp, smoothstep, smooth01, dxWrap } from './noise.js';
import { BIOME, BIOME_LIST, PG, landBiome, pickWeighted } from './biomes.js';
import { coneSum, COAST, FLAG } from './macro.js';
import { seaIceAt } from './climate.js';

const sq = (v) => v * v;

export const MARGIN = 16;
const S = CHUNK;
const SEED_OFF = 0x51f15e;

// fbm (~±0.3 typical) mapped to a roughly uniform 0..1
const u01 = (v) => (v < -0.3 ? 0 : v > 0.3 ? 1 : (v + 0.3) / 0.6);
const cellIdx = (cx, cy) => (cy < 0 ? 0 : cy >= MH ? MH - 1 : cy) * MW + ((cx % MW) + MW) % MW;

// Catmull-Rom weights
function crw(t, w) {
  const t2 = t * t, t3 = t2 * t;
  w[0] = (-t3 + 2 * t2 - t) * 0.5; w[1] = (3 * t3 - 5 * t2 + 2) * 0.5; w[2] = (-3 * t3 + 4 * t2 + t) * 0.5; w[3] = (t3 - t2) * 0.5;
}

// Macro fields at a tile point (tile coords): bicubic elevation without cones (clamped to the 2x2 range: no
// overshoot at coasts), bilinear climate / relief. Writes into o.
const WU = new Float64Array(4), WV = new Float64Array(4);
export function macroAt(p, x, y, o) {
  const u = x / CELL - 0.5, v = y / CELL - 0.5;
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  crw(fu, WU); crw(fv, WV);
  // separable Catmull-Rom, each 1D pass clamped to its two inner samples (no overshoot, still continuous)
  const E = p.elev, C = p.cone;
  let e = 0, r1 = 0, r2 = 0;
  for (let b = 0; b < 4; b++) {
    const cy = j0 - 1 + b;
    let row = 0, v1 = 0, v2 = 0;
    for (let a = 0; a < 4; a++) {
      const c = cellIdx(i0 - 1 + a, cy), val = E[c] - C[c];
      row += WU[a] * val;
      if (a === 1) v1 = val; else if (a === 2) v2 = val;
    }
    const lo = v1 < v2 ? v1 : v2, hi = v1 < v2 ? v2 : v1;
    row = row < lo ? lo : row > hi ? hi : row;
    if (b === 1) r1 = row; else if (b === 2) r2 = row;
    e += WV[b] * row;
  }
  const lo = r1 < r2 ? r1 : r2, hi = r1 < r2 ? r2 : r1;
  o.e = e < lo ? lo : e > hi ? hi : e;
  const c00 = cellIdx(i0, j0), c10 = cellIdx(i0 + 1, j0), c01 = cellIdx(i0, j0 + 1), c11 = cellIdx(i0 + 1, j0 + 1);
  const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
  const bl = (A) => A[c00] * w00 + A[c10] * w10 + A[c01] * w01 + A[c11] * w11;
  o.T = bl(p.tMean); o.P = bl(p.precip); o.relief = bl(p.relief); o.mtn = bl(p.mtn); o.plateau = bl(p.plateau);
  o.tAmp = bl(p.tAmp); o.dOcean = bl(p.dOcean);
  const B = p.biome;
  const is = (k) => (B[c00] === k ? w00 : 0) + (B[c10] === k ? w10 : 0) + (B[c01] === k ? w01 : 0) + (B[c11] === k ? w11 : 0);
  o.erg = is(BIOME.DESERT_DUNES);
  o.mesa = is(BIOME.BADLANDS);
  o.oceanNear = 0;
  const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (p.ocean[cellIdx(ci + a, cj + b)]) o.oceanNear = 1;
  o.cell = cellIdx(ci, cj);
  o.c00 = c00; o.c10 = c10; o.c01 = c01; o.c11 = c11; o.w00 = w00; o.w10 = w10; o.w01 = w01; o.w11 = w11;
  return o;
}

// Tile-scale height (stories) at tile point (x, y) before coasts / rivers / lakes: macro elevation + cones +
// hills + ridged mountains + dunes + mesas. o = macroAt result (filled by this call too).
export function baseHeight(p, x, y, o) {
  macroAt(p, x, y, o);
  const sd = p.seed * 7 + SEED_OFF;
  const cone = p.volcanoes.length ? coneSum(p, x, y) : 0;
  o.cone = cone;
  const em = o.e + cone;
  o.em = em;
  let h = metersToStories(em);
  const land = smoothstep(-350, 30, em);
  if (land > 0) {
    const hilly = smooth01((fbm(x, y, sd + 1, 2048, 2) + 0.2) * 1.4);
    const A = (0.16 + 0.85 * o.relief + 0.6 * hilly * (0.3 + o.relief)) * land;
    h += A * fbm(x, y, sd + 2, 256, 5);
    if (o.mtn > 0.02) {
      // ridges and valleys: crests every ~256 tiles, rugged spurs every ~64
      const r = ridged(x, y, sd + 3, 256, 5), r2 = ridged(x, y, sd + 10, 64, 3);
      o.ridge = r;
      h += o.mtn * (10 * (r - 0.52) + 2.6 * (r2 - 0.55));
    } else o.ridge = 0;
    h += 0.07 * fbm(x, y, sd + 4, 16, 2) * land;
    // coves, headlands and islets along the shore
    const cz = 1 - smoothstep(60, 260, em < 0 ? -em : em);
    if (cz > 0) h += cz * (1.6 * fbm(x, y, sd + 11, 128, 4) + 0.5 * fbm(x, y, sd + 12, 32, 2));
    // sand seas: transverse dune ridges (crests north-south under zonal winds), barchan-ish warp
    if (o.erg > 0.02 && em > 0) {
      const wx = x + 40 * fbm(x, y, sd + 5, 256, 2);
      const d1 = 1 - Math.abs(gnoise(wx / 26, y / 110, sd + 6, 0));
      const d2 = 1 - Math.abs(gnoise(wx / 9, y / 40, sd + 7, 0));
      h += o.erg * (1.5 * d1 * d1 * d1 + 0.35 * d2 * d2 - 0.55) * smoothstep(0, 60, em);
    }
    // mesas and buttes: stepped flat tops with steep sides
    if (o.mesa > 0.02 && em > 0) {
      const m = fbm(x, y, sd + 8, 128, 4) + 0.25 * fbm(x, y, sd + 9, 32, 2);
      const step1 = smoothstep(0.08, 0.13, m), step2 = smoothstep(0.32, 0.36, m);
      h += o.mesa * (2.6 * step1 + 2.2 * step2 - 1.2);
    }
  } else o.ridge = 0;
  o.h = h;
  return h;
}

// Highest lake level (m) of the lake cells within LAKE_REACH tiles of (x, y), NaN if none. The shore is then
// wherever the terrain crosses that level (natural outlines, not cell squares).
const LAKE_REACH = 30;
let _lakeId = 0;
export function lakeLevelNear(p, x, y) {
  const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
  let best = NaN; _lakeId = 0;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const c = cellIdx(ci + a, cj + b), lv = p.lakeLevel[c];
    if (lv !== lv) continue;
    const lx = (ci + a) * CELL, ly = (cj + b) * CELL;
    const ddx = Math.max(lx - x, 0, x - lx - CELL), ddy = Math.max(ly - y, 0, y - ly - CELL);
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 > LAKE_REACH * LAKE_REACH) continue;
    // away from the lake cells the surface sinks a little: the shore curves instead of following the cell edge
    const f = Math.sqrt(d2) / LAKE_REACH, lvf = lv - (f * f) * 60 * (1 + fbm(x, y, p.seed + 77, 64, 2) * 2);
    if (!(lvf <= best)) { best = lvf; _lakeId = p.lakeId[c]; }
  }
  return best;
}
export function lakeIdNear(p, x, y) { lakeLevelNear(p, x, y); return _lakeId; }

// two-pass chamfer distance (tiles) on a w x h window, capped
function chamfer(d, w, h, cap) {
  const D2 = 1.4142135623730951;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = d[i];
    if (v === 0) continue;
    if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
    if (y > 0) {
      if (d[i - w] + 1 < v) v = d[i - w] + 1;
      if (x > 0 && d[i - w - 1] + D2 < v) v = d[i - w - 1] + D2;
      if (x < w - 1 && d[i - w + 1] + D2 < v) v = d[i - w + 1] + D2;
    }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = d[i];
    if (v === 0) continue;
    if (x < w - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
    if (y < h - 1) {
      if (d[i + w] + 1 < v) v = d[i + w] + 1;
      if (x < w - 1 && d[i + w + 1] + D2 < v) v = d[i + w + 1] + D2;
      if (x > 0 && d[i + w - 1] + D2 < v) v = d[i + w - 1] + D2;
    }
    d[i] = v > cap ? cap : v;
  }
}

// node (tile coords) of a macro cell on the river network: cell centre + a stable jitter
export function riverNode(p, c) {
  const x = (c % MW) * CELL + CELL / 2, y = ((c - (c % MW)) / MW) * CELL + CELL / 2;
  const s = p.seed * 13 + 5;
  return [x + (hash01(c, 1, s) - 0.5) * CELL * 0.55, y + (hash01(c, 2, s) - 0.5) * CELL * 0.55];
}
// river half width (tiles) from relative flow
export const riverHalfWidth = (q, kind) => (kind === 3 ? clamp(3 + 1.6 * Math.sqrt(q), 3.5, 9) : kind === 2 ? clamp(0.6 + 0.35 * Math.sqrt(q), 0.6, 3) : kind === 4 ? clamp(0.3 + 0.3 * Math.sqrt(q), 0.35, 0.7) : clamp(0.35 + 0.6 * Math.sqrt(q), 0.5, 20));

// all river segments (macro cell -> downstream cell) whose spline may touch the tile rect [x0, x1) x [y0, y1)
// (unwrapped coordinates near x0). Segment: { c, d, P: [8 control coords], hw0, hw1, L0, L1, kind, can0, can1, fall, tf, flat }
export function riverSegments(p, x0, y0, x1, y1) {
  const out = [];
  const cxa = Math.floor((x0 - 3 * CELL) / CELL), cxb = Math.floor((x1 + 3 * CELL) / CELL);
  const cya = Math.max(0, Math.floor((y0 - 3 * CELL) / CELL)), cyb = Math.min(MH - 1, Math.floor((y1 + 3 * CELL) / CELL));
  const xc = (x0 + x1) / 2;
  const un = (pt) => [xc + dxWrap(xc, pt[0]), pt[1]];
  const levelOf = (c) => (p.lakeId[c] ? metersToStories(p.lakeLevel[c]) : p.ocean[c] ? 0 : p.rkind[c] ? p.rlevel[c] : metersToStories(Math.max(0, p.surf[c])));
  for (let cy = cya; cy <= cyb; cy++) for (let cx = cxa; cx <= cxb; cx++) {
    const c = cellIdx(cx, cy);
    const d = p.down[c];
    if (d < 0) continue;
    const kind = p.rkind[c];
    const outlet = !kind && p.lakeId[c] && p.rkind[d] && !p.lakeId[d];
    if (!kind && !outlet) continue;
    if (p.lakeId[c] && p.lakeId[d]) continue;
    // control points: main upstream branch (or extrapolated), c, d, d's downstream (or extrapolated)
    const P1 = un(riverNode(p, c)), P2 = un(riverNode(p, d));
    const um = p.upMain[c];
    const P0 = um >= 0 ? un(riverNode(p, um)) : [2 * P1[0] - P2[0], 2 * P1[1] - P2[1]];
    const dd = p.down[d];
    const P3 = dd >= 0 && !p.ocean[d] ? un(riverNode(p, dd)) : [2 * P2[0] - P1[0], 2 * P2[1] - P1[1]];
    const kd = outlet ? p.rkind[d] : kind;
    const q0 = outlet ? p.flow[d] : p.flow[c];
    const mainOfD = p.upMain[d] === c;
    const q1 = mainOfD && p.rkind[d] ? p.flow[d] : q0;
    let hw0 = riverHalfWidth(q0, kd), hw1 = riverHalfWidth(q1, kd === 3 || p.rkind[d] !== 3 ? kd : 3);
    // estuaries widen towards the sea
    if (kd === 1 && p.mouthD[c] && p.mouthD[c] <= 2 && !(p.flags[c] & FLAG.DELTA)) { hw1 *= p.ocean[d] ? 2.2 : 1.4; if (p.mouthD[c] === 1) hw0 *= 1.4; }
    const L0 = outlet ? levelOf(c) : p.rlevel[c], L1 = levelOf(d);
    const span = Math.max(hw0, hw1) + 30;
    const bx0 = Math.min(P1[0], P2[0]) - span, bx1 = Math.max(P1[0], P2[0]) + span;
    const by0 = Math.min(P1[1], P2[1]) - span, by1 = Math.max(P1[1], P2[1]) + span;
    if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
    out.push({
      c, d, P: [P0[0], P0[1], P1[0], P1[1], P2[0], P2[1], P3[0], P3[1]], hw0, hw1, L0, L1, kind: kd,
      can0: p.canyon[c], can1: p.rkind[d] ? p.canyon[d] : p.canyon[c], fall: p.fall[c], tf: 0.35 + hash01(c, 7, p.seed) * 0.3,
      flat: clamp(1 - p.relief[c] * 3, 0, 1) * smoothstep(900, 100, p.elev[c]), toSea: !!p.ocean[d], spring: (kind === 1 || kind === 4) && um < 0 && !hasLakeIn(p, c),
    });
  }
  return out;
}
function hasLakeIn(p, c) {
  const x = c % MW, y = (c - x) / MW;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const j = cellIdx(x + dx, y + dy);
    if (j !== c && p.down[j] === c && (p.lakeId[j] || p.rkind[j])) return true;
  }
  return false;
}
// point on a Catmull-Rom segment (t in 0..1) + tangent
export function crPoint(P, t) {
  const t2 = t * t, t3 = t2 * t;
  const a0 = -0.5 * t3 + t2 - 0.5 * t, a1 = 1.5 * t3 - 2.5 * t2 + 1, a2 = -1.5 * t3 + 2 * t2 + 0.5 * t, a3 = 0.5 * t3 - 0.5 * t2;
  const d0 = -1.5 * t2 + 2 * t - 0.5, d1 = 4.5 * t2 - 5 * t, d2 = -4.5 * t2 + 4 * t + 0.5, d3 = 1.5 * t2 - t;
  return [a0 * P[0] + a1 * P[2] + a2 * P[4] + a3 * P[6], a0 * P[1] + a1 * P[3] + a2 * P[5] + a3 * P[7],
    d0 * P[0] + d1 * P[2] + d2 * P[4] + d3 * P[6], d0 * P[1] + d1 * P[3] + d2 * P[5] + d3 * P[7]];
}
// sample a segment into points [x, y, hw, L, dirx, diry, can, t] with meanders (zero at the nodes)
export function sampleSegment(p, sg) {
  const P = sg.P;
  const len = Math.sqrt(sq(P[4] - P[2]) + sq(P[5] - P[3]));
  const n = Math.max(4, Math.ceil(len / 1.5));
  const pts = [];
  const sd = p.seed * 11 + 3;
  // meanders: wide loops on flat floodplains, entrenched loops in canyons, wiggles everywhere else
  const hwm = Math.max(sg.hw0, sg.hw1), can = Math.max(sg.can0, sg.can1);
  const mAmp = sg.kind === 3 ? 1 : (2.5 + 2.6 * hwm) * (0.45 + 0.55 * sg.flat) * (1 + 0.7 * can) * (sg.kind === 4 ? 1.8 : 1);
  const lam = sg.kind === 1 ? clamp(16 + 9 * hwm, 16, 128) : 64;
  const lamP = lam <= 32 ? 32 : lam <= 64 ? 64 : 128;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const [x, y, tx, ty] = crPoint(P, t);
    const tl = Math.sqrt(tx * tx + ty * ty) || 1;
    const dx = tx / tl, dy = ty / tl;
    const taper = smooth01(Math.min(t, 1 - t) * 3.2);
    const off = mAmp * taper * (2.2 * fbm(x, y, sd, lamP, 3) + 0.6 * fbm(x, y, sd + 1, 16, 2));
    const hw = sg.hw0 + (sg.hw1 - sg.hw0) * t;
    let L;
    if (sg.fall > 0) L = t < sg.tf ? sg.L0 : t < sg.tf + 0.04 ? sg.L0 + (sg.L1 - sg.L0) * ((t - sg.tf) / 0.04) : sg.L1;
    else L = sg.L0 + (sg.L1 - sg.L0) * t;
    pts.push(x - dy * off, y + dx * off, hw, L, dx, dy, sg.can0 + (sg.can1 - sg.can0) * t, t);
  }
  return pts;
}

const POND_MAX = 96;
const RK_RIVER = 1, RK_WASH = 2, RK_FJORD = 3, RK_CREEK = 4, RK_DELTA = 5;

export function generateChunk(p, cx, cy, opts = {}) {
  const tStart = typeof performance !== 'undefined' ? performance.now() : 0;
  cx = ((cx % CW) + CW) % CW;
  const M = MARGIN, WW = S + 2 * M, NW = WW * WW;
  const X0 = cx * S - M, Y0 = cy * S - M;
  const sd = p.seed * 7 + SEED_OFF;
  const o = {};
  // ---------- 1. base fields ----------
  const hS = new Float32Array(NW), emI = new Float32Array(NW), Tt = new Float32Array(NW), Pt = new Float32Array(NW);
  const relief = new Float32Array(NW), mtn = new Float32Array(NW), ridge = new Float32Array(NW), coneM = new Float32Array(NW);
  const cellOf = new Int32Array(NW), dOc = new Float32Array(NW), tAmp = new Float32Array(NW), plat = new Float32Array(NW);
  const sea0 = new Uint8Array(NW);
  for (let wy = 0; wy < WW; wy++) for (let wx = 0; wx < WW; wx++) {
    const i = wy * WW + wx, x = X0 + wx + 0.5, y = Y0 + wy + 0.5;
    let h = baseHeight(p, x, y, o);
    emI[i] = o.em; Tt[i] = o.T; Pt[i] = o.P; relief[i] = o.relief; mtn[i] = o.mtn; ridge[i] = o.ridge; coneM[i] = o.cone;
    cellOf[i] = o.cell; dOc[i] = o.dOcean; tAmp[i] = o.tAmp; plat[i] = o.plateau;
    if (h < 0) { if (o.oceanNear) sea0[i] = 1; else h = 0.03 + 0.05 * hash01(X0 + wx, Y0 + wy, sd); }
    hS[i] = h;
  }
  // ---------- 2. coasts ----------
  const ds = new Float32Array(NW), dl = new Float32Array(NW);
  for (let i = 0; i < NW; i++) { ds[i] = sea0[i] ? 0 : 99; dl[i] = sea0[i] ? 99 : 0; }
  chamfer(ds, WW, WW, M - 1); chamfer(dl, WW, WW, M - 1);
  const coastT = new Uint8Array(NW), beachW = new Float32Array(NW), shallowW = new Float32Array(NW);
  const lagoon = new Uint8Array(NW), stack = new Uint8Array(NW), cliffTop = new Float32Array(NW), shelf = new Uint8Array(NW);
  for (let wy = 0; wy < WW; wy++) for (let wx = 0; wx < WW; wx++) {
    const i = wy * WW + wx;
    if (sea0[i] ? dl[i] >= M - 1 : ds[i] >= M - 1) continue; // (all coast profiles fade out before the distance cap)
    const x = X0 + wx + 0.5, y = Y0 + wy + 0.5;
    const jx = fbm(x, y, sd + 20, 128, 2) * 28, jy = fbm(x, y, sd + 21, 128, 2) * 28;
    const ct = p.coast[cellIdx(Math.floor((x + jx) / CELL), Math.floor((y + jy) / CELL))] || COAST.BEACH;
    coastT[i] = ct;
    const n = u01(fbm(x, y, sd + 22, 256, 3));
    // cliff height along the coast: high headlands, low stretches, coves with small beaches between them
    const cliffH = ct === COAST.CLIFF ? 0.4 + 6 * u01(fbm(x, y, sd + 24, 512, 3)) * (0.45 + 0.55 * u01(fbm(x, y, sd + 28, 128, 2))) : 0;
    const cove = ct === COAST.CLIFF && cliffH < 1.4;
    let bw = 0, sw = 2;
    switch (ct) {
      case COAST.BEACH: bw = 3 + 6 * n; sw = 3 + 5 * n; break;
      case COAST.DUNES: bw = 4 + 6 * n; sw = 3 + 4 * n; break;
      case COAST.LAGOON: bw = 3 + 4 * n; sw = 2 + 3 * n; break;
      case COAST.DELTA: bw = 2 + 4 * n; sw = 6 + 6 * n; break;
      case COAST.MANGROVE: bw = 0; sw = 6 + 6 * n; break;
      case COAST.ROCKY: bw = n > 0.65 ? 1.5 : 0; sw = 1 + 2 * n; break;
      case COAST.CLIFF: bw = cove ? 2 + 3 * n : 0; sw = cove ? 2 + 2 * n : 0.6; break;
      case COAST.FJORD: bw = 0; sw = 0.8; break;
      case COAST.ICE: bw = 0; sw = 1; break;
    }
    beachW[i] = bw; shallowW[i] = sw;
    if (!sea0[i]) {
      const d = ds[i];
      if (bw > 0 && d <= Math.min(bw + 6, 14)) {
        const target = 0.08 + 0.05 * (d / (bw + 1));
        const t = smoothstep(bw * 0.6, Math.min(bw + 6, 14), d);
        if (hS[i] > target) hS[i] = target + (hS[i] - target) * t;
      }
      if (ct === COAST.MANGROVE && d < 12) { const target = 0.06; if (hS[i] > target) hS[i] = target + (hS[i] - target) * smoothstep(4, 14, d); }
      if (ct === COAST.DUNES && d > bw && d < 14) {
        const dn = 1 - Math.abs(gnoise(x / 9, y / 30, sd + 23, 0));
        hS[i] += 0.9 * dn * dn * smoothstep(bw, bw + 3, d) * (1 - smoothstep(Math.min(bw + 6, 11), 14, d));
      }
      if ((ct === COAST.CLIFF && !cove) || ct === COAST.ICE || (ct === COAST.FJORD && n > 0.4) || (ct === COAST.ROCKY && n > 0.6)) {
        const cH = ct === COAST.CLIFF ? cliffH : ct === COAST.ICE ? 1.4 + 1.6 * n : 0.8 + 1.4 * n;
        // the cliff top rises straight from the water (no beach strip), the headland blends inland
        const tgt = cH * (1 - smoothstep(3 + 5 * n, 14, d));
        if (d >= 0.5 && hS[i] < tgt) hS[i] = tgt;
        cliffTop[i] = cH;
      }
    } else {
      const d = dl[i];
      // lagoon barrier: a sand bar parallel to the coast, broken by tidal inlets
      if (ct === COAST.LAGOON) {
        const b0 = 6 + 7 * n, b1 = b0 + 2 + 2.5 * (1 - n);
        const inlet = fbm(x, y, sd + 25, 128, 2) > 0.2;
        if (d >= b0 && d < b1 && !inlet && hS[i] > -1.2) { hS[i] = 0.12; sea0[i] = 0; }
        else if (d < b0 && hS[i] > -1.5) { lagoon[i] = 1; hS[i] = Math.max(hS[i], -0.3 - 0.1 * (d / b0)); }
      }
      // sea stacks off cliffs
      if (ct === COAST.CLIFF && cliffH > 2.2 && d >= 1.5 && d < 7 && fbm(x, y, sd + 26, 16, 2) > 0.27 - 0.01 * d) { stack[i] = 1; hS[i] = cliffH * (0.5 + 0.4 * n); sea0[i] = 0; }
      // wave-cut rock shelves in front of the high cliffs
      else if (ct === COAST.CLIFF && cliffH > 1.8 && d < 2.5 + 3 * u01(fbm(x, y, sd + 29, 64, 2)) && fbm(x, y, sd + 30, 32, 2) > -0.05) { hS[i] = Math.max(hS[i], -0.18); shelf[i] = 1; }
      // warm shallow seas: reef flats
      if (Tt[i] > 23 && d > 5 && d < 34 && emI[i] > -200 && fbm(x, y, sd + 27, 128, 3) > 0.12) hS[i] = Math.max(hS[i], -0.22);
    }
  }
  // ---------- 3. rivers ----------
  const rD = new Float32Array(NW).fill(1e9), rHW = new Float32Array(NW), rL = new Float32Array(NW), rDX = new Float32Array(NW), rDY = new Float32Array(NW);
  const rK = new Uint8Array(NW), rCan = new Float32Array(NW), rFlat = new Float32Array(NW);
  const features = [];
  const segs = riverSegments(p, X0, Y0, X0 + WW, Y0 + WW);
  const stampCapsule = (ax, ay, bx, by, hwA, hwB, LA, LB, dx, dy, can, kind, flat, reach) => {
    const R = Math.max(hwA, hwB) + reach;
    const minx = Math.max(0, Math.floor(Math.min(ax, bx) - R - X0)), maxx = Math.min(WW - 1, Math.ceil(Math.max(ax, bx) + R - X0));
    const miny = Math.max(0, Math.floor(Math.min(ay, by) - R - Y0)), maxy = Math.min(WW - 1, Math.ceil(Math.max(ay, by) + R - Y0));
    if (minx > maxx || miny > maxy) return;
    const vx = bx - ax, vy = by - ay, vl = vx * vx + vy * vy || 1;
    for (let wy = miny; wy <= maxy; wy++) for (let wx = minx; wx <= maxx; wx++) {
      const px = X0 + wx + 0.5 - ax, py = Y0 + wy + 0.5 - ay;
      let t = (px * vx + py * vy) / vl; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - vx * t, qy = py - vy * t, d = Math.sqrt(qx * qx + qy * qy);
      const hw = hwA + (hwB - hwA) * t;
      const i = wy * WW + wx;
      if (d - hw < rD[i] - rHW[i]) { rD[i] = d; rHW[i] = hw; rL[i] = LA + (LB - LA) * t; rDX[i] = dx; rDY[i] = dy; rK[i] = kind; rCan[i] = can; rFlat[i] = flat; }
    }
  };
  for (const sg of segs) {
    const pts = sampleSegment(p, sg);
    const reach = sg.kind === RK_FJORD ? 12 : sg.kind === RK_CREEK ? 3 : 4 + sg.flat * 18 + 34 * Math.max(sg.can0, sg.can1);
    for (let k = 8; k < pts.length; k += 8) {
      const a = k - 8;
      stampCapsule(pts[a], pts[a + 1], pts[k], pts[k + 1], pts[a + 2], pts[k + 2], pts[a + 3], pts[k + 3], pts[k + 4], pts[k + 5], pts[k + 6], sg.kind, sg.flat, reach);
    }
    // features inside this chunk
    const inChunk = (x, y) => x >= X0 + M && x < X0 + M + S && y >= Y0 + M && y < Y0 + M + S;
    if (sg.fall > 0) {
      const [fx, fy, tx, ty] = crPoint(sg.P, sg.tf + 0.02);
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      if (inChunk(fx, fy)) features.push({ t: 'waterfall', x: fx - X0 - M, y: fy - Y0 - M, drop: Math.round(sg.fall * 10) / 10, dx: tx / tl, dy: ty / tl });
    }
    if (sg.spring && inChunk(sg.P[2], sg.P[3])) features.push({ t: 'spring', x: sg.P[2] - X0 - M, y: sg.P[3] - Y0 - M });
  }
  // deltas: a low fan of new land + distributary channels at sea level
  const deltaLand = new Uint8Array(NW);
  for (const dlt of p.deltas) {
    const ax = X0 + WW / 2 + dxWrap(X0 + WW / 2, dlt.x), ay = dlt.y;
    if (ax + dlt.R * 1.6 < X0 || ax - dlt.R * 1.6 > X0 + WW || ay + dlt.R * 1.6 < Y0 || ay - dlt.R * 1.6 > Y0 + WW) continue;
    const ox = ax - dlt.x;
    for (let wy = 0; wy < WW; wy++) for (let wx = 0; wx < WW; wx++) {
      const i = wy * WW + wx, x = X0 + wx + 0.5, y = Y0 + wy + 0.5;
      const vx = x - ax, vy = y - ay, d = Math.sqrt(vx * vx + vy * vy);
      if (d > dlt.R * 1.5) continue;
      const dp = d > 0 ? (vx * dlt.dx + vy * dlt.dy) / d : 1;
      const re = dlt.R * (0.7 + 0.45 * fbm(x, y, sd + 30, 64, 3)) * (0.55 + 0.45 * clamp(dp + 0.3, 0, 1));
      if (d < re && hS[i] < 0.2 && hS[i] > -2.5) { hS[i] = 0.04 + 0.1 * (1 - d / re) + 0.04 * fbm(x, y, sd + 31, 16, 2); sea0[i] = 0; deltaLand[i] = 1; }
    }
    for (const ch of dlt.channels) {
      const pts = ch.pts;
      for (let k = 2; k < pts.length; k += 2) {
        const hw = ch.w * 0.5 * (1 - 0.3 * (k / pts.length));
        const dx = pts[k] - pts[k - 2], dy = pts[k + 1] - pts[k - 1], l = Math.sqrt(dx * dx + dy * dy) || 1;
        stampCapsule(pts[k - 2] + ox, pts[k - 1], pts[k] + ox, pts[k + 1], hw, hw, 0, 0, dx / l, dy / l, 0, RK_DELTA, 1, 2);
      }
    }
  }
  // ---------- 4. carve rivers ----------
  const water = new Uint8Array(NW), wlevel = new Float32Array(NW), wkind = new Uint8Array(NW); // wkind 1 sea 2 lake 3 river 4 pond 5 lagoon
  const flowX = new Float32Array(NW), flowY = new Float32Array(NW);
  for (let i = 0; i < NW; i++) {
    const k = rK[i];
    if (!k) continue;
    if (sea0[i] && k !== RK_FJORD) { rK[i] = 0; continue; }
    const d = rD[i], hw = rHW[i], L = rL[i];
    const can = rCan[i], flat = rFlat[i];
    if (k === RK_FJORD) {
      if (d < hw) { hS[i] = Math.min(hS[i], -1.2 - 0.25 * hw * (1 - d / hw)); sea0[i] = 1; }
      else if (d < hw + 12) hS[i] = Math.min(hS[i], 0.2 + (d - hw) * 0.85);
      continue;
    }
    const depth = k === RK_WASH ? -0.05 : k === RK_DELTA || k === RK_CREEK ? 0.3 : clamp(0.3 + 0.12 * hw, 0.3, 2.4);
    const h0 = hS[i];
    if (d < hw) {
      // a river whose level is above the local ground (a perched stretch of the spline) sinks onto the ground
      const Lr = L < h0 + 0.3 ? L : h0 + 0.3;
      hS[i] = Math.min(hS[i], Lr - depth);
      if (k !== RK_WASH) {
        water[i] = 1; wlevel[i] = Lr; wkind[i] = 3;
        const fs = 0.35 + 0.65 * (1 - d / Math.max(0.6, hw));
        flowX[i] = rDX[i] * fs; flowY[i] = rDY[i] * fs;
      }
      continue;
    }
    const e = d - hw;
    if (can > 0.25) {
      // canyon: a flat floor, then walls in strata bands (a steep riser, then a bench) up to the plateau rim
      const F = 1.5 + 0.5 * hw + 3 * can, Wt = F + 6 + 26 * can;
      const D = hS[i] - L - 0.12;
      if (e < F) hS[i] = Math.min(hS[i], L + 0.12);
      else if (e < Wt && D > 0.6) {
        const xg = X0 + (i % WW) + 0.5, yg = Y0 + ((i - (i % WW)) / WW) + 0.5;
        const t = clamp((e - F) / (Wt - F) + 0.1 * fbm(xg, yg, sd + 90, 32, 2), 0, 1);
        const k = D > 5 ? 4 : D > 2.5 ? 3 : 2, tb = t * k, band = Math.floor(tb), fr = tb - band;
        let prof = (band + smooth01(fr / 0.12)) / k;
        if (e < F + 2) prof = Math.min(prof, (e - F) * 0.08); // talus at the foot
        hS[i] = Math.min(hS[i], L + 0.12 + D * clamp(prof, 0, 1));
      }
    } else {
      const V = 2 + hw * 1.2 + flat * 16;
      const target = L + 0.18 + 0.02 * e;
      if (hS[i] > target) hS[i] = target + (hS[i] - target) * smooth01(e / V);
    }
    if (e < 1.5 && hS[i] < L + 0.12) hS[i] = Math.min(L + 0.12, h0 + 0.3);
  }
  // ---------- 5. lakes and ponds ----------
  const lakeSalt = new Uint8Array(NW);
  {
    const cxa = Math.floor(X0 / CELL) - 1, cxb = Math.floor((X0 + WW) / CELL) + 1;
    const cya = Math.max(0, Math.floor(Y0 / CELL) - 1), cyb = Math.min(MH - 1, Math.floor((Y0 + WW) / CELL) + 1);
    let anyLake = false;
    for (let ccy = cya; ccy <= cyb && !anyLake; ccy++) for (let ccx = cxa; ccx <= cxb; ccx++) if (p.lakeLevel[cellIdx(ccx, ccy)] === p.lakeLevel[cellIdx(ccx, ccy)]) { anyLake = true; break; }
    if (anyLake) for (let wy = 0; wy < WW; wy++) for (let wx = 0; wx < WW; wx++) {
      const i = wy * WW + wx, x = X0 + wx + 0.5, y = Y0 + wy + 0.5;
      const lv = lakeLevelNear(p, x, y);
      if (lv !== lv || sea0[i]) continue;
      const best = metersToStories(lv), lk = p.lakes[_lakeId - 1];
      if (hS[i] >= best) continue;
      if (lk && lk.dry) { lakeSalt[i] = 2; continue; }
      water[i] = 1; wlevel[i] = best; wkind[i] = 2; lakeSalt[i] = lk && lk.salt ? 1 : 0; flowX[i] = 0; flowY[i] = 0;
    }
    // ponds (small lakes): lake districts, wet lowlands, rare oases
    const sdp = p.seed * 17 + 9;
    // (a pond reaches at most POND_MAX tiles from its centre: gather every cell that close to the window)
    const pxa = Math.floor((X0 - POND_MAX) / CELL), pxb = Math.floor((X0 + WW + POND_MAX) / CELL);
    const pya = Math.max(0, Math.floor((Y0 - POND_MAX) / CELL)), pyb = Math.min(MH - 1, Math.floor((Y0 + WW + POND_MAX) / CELL));
    for (let ccy = pya; ccy <= pyb; ccy++) for (let ccx = pxa; ccx <= pxb; ccx++) {
      const c = cellIdx(ccx, ccy);
      if (p.ocean[c] || p.lakeId[c] || p.relief[c] > 0.3 || p.sd[c] < 1.5) continue;
      const f = p.flags[c], P = p.precip[c], T = p.tMean[c];
      const dens = f & FLAG.LAKES ? 1.3 : P > 650 && T > -6 && T < 16 && p.relief[c] < 0.15 ? 0.18 : P < 300 && P > 60 && T > 14 ? 0.04 : 0.06;
      const n = Math.floor(dens + hash01(c, 1, sdp));
      for (let k = 0; k < n; k++) {
        const px = ccx * CELL + 4 + hash01(c, 10 + k, sdp) * (CELL - 8), py = ccy * CELL + 4 + hash01(c, 20 + k, sdp) * (CELL - 8);
        const r = 4 + 16 * hash01(c, 30 + k, sdp) * hash01(c, 40 + k, sdp) + (f & FLAG.LAKES ? 7 : 0);
        // elongated along a random axis, shoreline from noise at two scales and from the terrain itself
        let ux = hash01(c, 50 + k, sdp) * 2 - 1, uy = hash01(c, 60 + k, sdp) * 2 - 1;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
        const asp = 1 + 1.8 * hash01(c, 70 + k, sdp);
        const R = Math.min(POND_MAX, r * asp * 1.7);
        if (px + R < X0 || px - R > X0 + WW || py + R < Y0 || py - R > Y0 + WW) continue;
        const lvl = baseHeight(p, px, py, {}) - 0.05;
        if (lvl < 0.2) continue;
        // only on flat ground: the terrain along the pond's axis must stay near its level
        let flatOk = true;
        for (const t of [-1, 1]) for (const q of [0.6, 1.1]) {
          const hq = baseHeight(p, px + ux * r * asp * q * t, py + uy * r * asp * q * t, {}), hc = baseHeight(p, px - uy * r * q * t, py + ux * r * q * t, {});
          if (Math.abs(hq - lvl) > 0.45 || Math.abs(hc - lvl) > 0.45) flatOk = false;
        }
        if (!flatOk) continue;
        const lamP = r < 8 ? 16 : r < 16 ? 32 : 64;
        for (let wy = Math.max(0, Math.floor(py - R - Y0)); wy <= Math.min(WW - 1, Math.ceil(py + R - Y0)); wy++) {
          for (let wx = Math.max(0, Math.floor(px - R - X0)); wx <= Math.min(WW - 1, Math.ceil(px + R - X0)); wx++) {
            const i = wy * WW + wx, x = X0 + wx + 0.5, y = Y0 + wy + 0.5;
            if (sea0[i] || wkind[i] === 3 || rK[i] === RK_RIVER) continue;
            const dx = x - px, dy = y - py;
            const al = (dx * ux + dy * uy) / asp, ac = -dx * uy + dy * ux;
            const de = Math.sqrt(al * al + ac * ac) / r + 1.1 * fbm(x, y, sdp + k, lamP, 3) + 0.4 * fbm(x, y, sdp + k + 7, 8, 2);
            if (de < 0.85) hS[i] = Math.min(hS[i], lvl - 0.15 - 0.7 * (0.85 - de));
            if (de < 1 && hS[i] < lvl) { water[i] = 1; wlevel[i] = lvl; wkind[i] = 4; }
            else if (de < 1.3 && hS[i] < lvl + 0.08) hS[i] = Math.min(lvl + 0.08, hS[i] + 0.3);
          }
        }
      }
    }
  }
  // ---------- 6. sea / final water ----------
  for (let i = 0; i < NW; i++) {
    if (water[i]) continue;
    if (hS[i] < 0 && (sea0[i] || lagoon[i] || rK[i])) {
      water[i] = 1; wlevel[i] = 0; wkind[i] = lagoon[i] ? 5 : 1;
    } else if (hS[i] < 0) hS[i] = 0.02;
  }
  // water classes: shallow by depth / near-shore width; abyss from the macro sea floor
  const dLand2 = new Float32Array(NW);
  for (let i = 0; i < NW; i++) dLand2[i] = water[i] ? 99 : 0;
  chamfer(dLand2, WW, WW, M - 1);
  const wcls = new Uint8Array(NW);
  for (let wy = 0; wy < WW; wy++) for (let wx = 0; wx < WW; wx++) {
    const i = wy * WW + wx;
    if (!water[i]) continue;
    const depth = wlevel[i] - hS[i];
    const wk = wkind[i];
    let c;
    if (wk === 1 || wk === 5) {
      const ab = emI[i] < ABYSS_M + 260 * fbm(X0 + wx, Y0 + wy, sd + 40, 128, 2);
      if (ab) c = 3;
      else c = depth < 0.35 || dLand2[i] <= shallowW[i] || wk === 5 ? 1 : 2;
      if (c === 3 && dLand2[i] < 6) c = 2;
    } else if (wk === 3) c = depth > 0.75 && rHW[i] > 2.2 && rD[i] < rHW[i] - 1 ? 2 : 1;
    else c = depth < 0.32 ? 1 : 2;
    wcls[i] = c;
  }
  // ---------- 7. corner heights (average of the 4 tiles around each corner) ----------
  const CWn = S + 1;
  const height = new Float32Array(CWn * CWn);
  for (let y = 0; y <= S; y++) for (let x = 0; x <= S; x++) {
    const wx = x + M, wy = y + M;
    const a = hS[(wy - 1) * WW + wx - 1], b = hS[(wy - 1) * WW + wx], c = hS[wy * WW + wx - 1], d = hS[wy * WW + wx];
    height[y * CWn + x] = Math.round(((a + b + c + d) * 0.25) * 1024) / 1024;
  }
  // steepness per window tile (from window-local corners, so it also exists in the margin)
  const steep = new Float32Array(NW);
  for (let wy = 1; wy < WW - 1; wy++) for (let wx = 1; wx < WW - 1; wx++) {
    const i = wy * WW + wx;
    const c00 = (hS[i] + hS[i - 1] + hS[i - WW] + hS[i - WW - 1]) * 0.25, c10 = (hS[i] + hS[i + 1] + hS[i - WW] + hS[i - WW + 1]) * 0.25;
    const c01 = (hS[i] + hS[i - 1] + hS[i + WW] + hS[i + WW - 1]) * 0.25, c11 = (hS[i] + hS[i + 1] + hS[i + WW] + hS[i + WW + 1]) * 0.25;
    steep[i] = Math.max(c00, c10, c01, c11) - Math.min(c00, c10, c01, c11);
  }
  // ---------- 8. biome, ground, rock ----------
  const biomeW = new Uint8Array(NW), groundW = new Uint8Array(NW), rockW = new Uint8Array(NW), rockTW = new Uint8Array(NW);
  const Ttile = new Float32Array(NW);
  for (let wy = 1; wy < WW - 1; wy++) for (let wx = 1; wx < WW - 1; wx++) {
    const i = wy * WW + wx, x = X0 + wx + 0.5, y = Y0 + wy + 0.5;
    const hm = storiesToMeters(hS[i]);
    const T = Tt[i] - 0.0065 * (Math.max(0, hm) - Math.max(0, emI[i])) + 1.2 * fbm(x, y, sd + 50, 256, 2);
    Ttile[i] = T;
    const P = Pt[i] * (1 + 0.22 * fbm(x, y, sd + 51, 256, 2));
    // macro biome at a jittered position (no cell-square patches)
    const mb = p.biome[cellIdx(Math.floor((x + 30 * fbm(x, y, sd + 94, 128, 3)) / CELL), Math.floor((y + 30 * fbm(x, y, sd + 95, 128, 3)) / CELL))];
    if (water[i]) {
      const wk = wkind[i];
      let b;
      if (wk === 1) b = seaIceAt(p.seed, x, y, Tt[i]) ? BIOME.SEA_ICE : wcls[i] === 3 ? BIOME.ABYSS : wcls[i] === 2 ? BIOME.OCEAN : (Tt[i] > 23 && hS[i] > -0.3 && dLand2[i] > 4 ? BIOME.REEF : BIOME.SHALLOWS);
      else if (wk === 5) b = BIOME.LAGOON;
      else if (wk === 3) b = T < -8 ? BIOME.SEA_ICE : BIOME.RIVER;
      else b = lakeSalt[i] ? BIOME.SALT_LAKE : T < -6 ? BIOME.SEA_ICE : BIOME.LAKE;
      biomeW[i] = b;
      groundW[i] = wk === 3 ? (wcls[i] === 2 ? PG.MUD : rFlat[i] < 0.3 ? PG.GRAVEL : PG.SAND) : shelf[i] ? PG.STONE : wcls[i] >= 2 ? PG.MUD : PG.SAND;
      continue;
    }
    const ctx = { relief: relief[i], med: mb === BIOME.MEDITERRANEAN, coast: Math.min(dOc[i], ds[i] / CELL), erg: fbm(x, y, sd + 52, 1024, 2) + 0.2 - relief[i] * 1.2 + (mb === BIOME.DESERT_DUNES ? 0.4 : -0.2), plateau: plat[i], heath: fbm(x, y, sd + 53, 512, 2) };
    let b = landBiome(T, P, hm, ctx);
    // keep the macro wetlands / special lands where the climate agrees
    if ((mb === BIOME.SWAMP || mb === BIOME.MARSH) && hm < 200 && fbm(x, y, sd + 54, 128, 3) > -0.25 && b !== BIOME.ALPINE && b !== BIOME.SNOW_PEAKS) b = mb;
    if (coneM[i] > 700 && T > -6 && (coneM[i] > 1400 || fbm(x, y, sd + 55, 64, 2) > 0.1)) b = BIOME.VOLCANIC;
    if (lakeSalt[i] === 2) b = BIOME.SALT_FLAT;
    const ct = coastT[i], d = ds[i];
    if (deltaLand[i]) b = T > 21 && P > 1000 ? BIOME.MANGROVE : BIOME.MARSH;
    if (ct && d < 16) {
      if ((ct === COAST.BEACH || ct === COAST.DUNES || ct === COAST.LAGOON || ct === COAST.DELTA) && d <= beachW[i] + 0.5 && hS[i] < 0.6) b = BIOME.BEACH;
      else if (ct === COAST.MANGROVE && d < 9 + 4 * fbm(x, y, sd + 56, 64, 2) && T > 12) b = BIOME.MANGROVE;
      else if (ct === COAST.ROCKY && d < 3.5) b = BIOME.ROCKY_SHORE;
      else if ((ct === COAST.CLIFF || ct === COAST.ICE || ct === COAST.FJORD) && d < 5 && cliffTop[i] > 0) b = T < -8 ? BIOME.ICE_SHEET : BIOME.CLIFF;
    }
    if (stack[i]) b = BIOME.CLIFF;
    // floodplains (oases in the deserts) along the bigger rivers
    if (rK[i] === RK_RIVER && rD[i] - rHW[i] < 3 + rHW[i] * 2.5 * rFlat[i] && rHW[i] > 1.2 && rCan[i] < 0.25 && T > 2 && b !== BIOME.BEACH && b !== BIOME.MANGROVE && b !== BIOME.SWAMP && hS[i] - rL[i] < 1.2) {
      if (b === BIOME.DESERT_DUNES || b === BIOME.DESERT_ROCKY || b === BIOME.STEPPE || b === BIOME.SAVANNA || b === BIOME.COLD_DESERT || b === BIOME.MEDITERRANEAN || fbm(x, y, sd + 57, 64, 2) > 0.1) b = BIOME.FLOODPLAIN;
    }
    biomeW[i] = b;
    // ground
    const gn = fbm(x, y, sd + 58, 32, 3), gh = hash01(X0 + wx, Y0 + wy, sd + 59);
    let g = BIOME_LIST[b].g ?? PG.SOIL;
    switch (b) {
      case BIOME.TEMPERATE_FOREST: g = gn > 0.25 ? PG.MOSS : gn < -0.3 ? PG.RICH : PG.SOIL; break;
      case BIOME.TAIGA: g = gn > -0.15 ? PG.MOSS : gn < -0.5 ? PG.GRAVEL : PG.SOIL; break;
      case BIOME.TUNDRA: g = gn > 0.1 ? PG.MOSS : gn < -0.35 ? PG.GRAVEL : PG.SOIL; break;
      case BIOME.STEPPE: g = gn > 0.2 ? PG.DRY : gn < -0.35 ? PG.RICH : PG.SOIL; break;
      case BIOME.SAVANNA: g = gn > -0.1 ? PG.DRY : PG.SOIL; break;
      case BIOME.RAINFOREST: g = gn > -0.2 ? PG.MOSS : PG.RICH; break;
      case BIOME.TROPICAL_DRY: g = gn > 0.3 ? PG.CLAY : PG.SOIL; break;
      case BIOME.DESERT_ROCKY: g = gn > 0.2 ? PG.GRAVEL : gn < -0.4 ? PG.SAND : PG.DRY; break;
      case BIOME.COLD_DESERT: g = gn > 0.15 ? PG.GRAVEL : PG.DRY; break;
      case BIOME.BADLANDS: g = gn > 0.3 ? PG.SAND : PG.CLAY; break;
      case BIOME.ALPINE: g = gn > 0.25 ? PG.GRAVEL : PG.SOIL; break;
      case BIOME.MARSH: case BIOME.SWAMP: g = gn > 0.05 ? PG.MARSH : PG.MUD; break;
      case BIOME.MEDITERRANEAN: g = gn > 0 ? PG.DRY : PG.SOIL; break;
      case BIOME.HEATH: g = gn > 0.1 ? PG.MOSS : PG.SOIL; break;
      case BIOME.ROCKY_SHORE: g = gn > 0 ? PG.STONE : PG.GRAVEL; break;
      case BIOME.CLIFF: g = d < 3 ? PG.STONE : gn > 0 ? PG.SOIL : PG.GRAVEL; break;
      case BIOME.ICE_SHEET: g = gn > 0.3 ? PG.ICE : PG.SNOW; break;
    }
    if (rK[i] === RK_WASH && rD[i] < rHW[i] + 0.5) g = gh < 0.5 ? PG.GRAVEL : PG.SAND;
    if (rCan[i] > 0.25 && rK[i] && rD[i] - rHW[i] < 3.5 + 0.5 * rHW[i] + 3 * rCan[i] && rD[i] > rHW[i]) g = gh < 0.6 ? PG.GRAVEL : PG.SAND;
    else if (rK[i] && rD[i] - rHW[i] < 1.2 && b !== BIOME.SNOW_PEAKS) g = rFlat[i] > 0.4 ? PG.SAND : PG.GRAVEL;
    if (steep[i] > 1.1) g = PG.STONE; else if (steep[i] > 0.7 && g !== PG.SNOW) g = PG.GRAVEL;
    // snow: altitude (T), aspect (slopes facing the pole keep it), slope (steep faces shed it), noisy edge
    {
      const hs = y < H / 2 ? 1 : -1, dhdy = (hS[i + WW] - hS[i - WW]) * 0.5;
      const Ts = T - 2.4 * clamp(dhdy * hs * 1.5, -1, 1) + 6 * fbm(x, y, sd + 91, 64, 3) + 2.5 * fbm(x, y, sd + 92, 16, 2);
      let sp = clamp((-3.5 - Ts) / 3, 0, 1);
      if (steep[i] > 0.8) sp *= 0.15;
      if (sp > 0 && hash01(X0 + wx, Y0 + wy, sd + 93) < sp && b !== BIOME.BEACH) g = PG.SNOW;
    }
    groundW[i] = g;
    // rock: cliff faces, mountain cores along the ridges, sea stacks
    let r = 0;
    if (steep[i] > 1.25) r = 1;
    if (mtn[i] > 0.35 && ridge[i] > 0.81 - 0.05 * mtn[i] && hS[i] > 5) r = 1;
    if (stack[i] && hS[i] > 0.6) r = 1;
    if (b === BIOME.BEACH || rK[i] && rD[i] < rHW[i] + 1) r = 0;
    rockW[i] = r;
    if (r) {
      const rt = fbm(x, y, sd + 60, 1024, 3);
      const strata = [6, 2, 6, 3, 2][((Math.floor(hS[i] / 0.9) % 5) + 5) % 5];
      rockTW[i] = coneM[i] > 150 ? 5 : rCan[i] > 0.25 || b === BIOME.BADLANDS || b === BIOME.DESERT_ROCKY ? strata : rt < -0.1 ? 3 : rt < 0.05 ? 1 : rt < 0.15 ? 2 : 4;
      if (g !== PG.SNOW) groundW[i] = PG.STONE;
    }
  }
  // ---------- 9. chunk layers ----------
  const NT = S * S;
  const L = {
    ground: new Uint8Array(NT), water: new Uint8Array(NT), biome: new Uint8Array(NT), rock: new Uint8Array(NT), rockType: new Uint8Array(NT),
    ore: new Uint8Array(NT), flowX: new Float32Array(NT), flowY: new Float32Array(NT), wlevel: new Float32Array(NT), fertile: new Uint8Array(NT), lush: new Uint8Array(NT),
  };
  // rock depth (for ores) and the river edge distance (fertile soil) on the window
  const dRockIn = new Float32Array(NW), dRiv = new Float32Array(NW);
  for (let i = 0; i < NW; i++) dRockIn[i] = rockW[i] ? 99 : 0;
  chamfer(dRockIn, WW, WW, 9);
  for (let wy = 0; wy < WW; wy++) for (let wx = 0; wx < WW; wx++) {
    const i = wy * WW + wx;
    let edge = 0;
    if (wkind[i] === 3 && wx > 0 && wy > 0 && wx < WW - 1 && wy < WW - 1) edge = wkind[i - 1] !== 3 || wkind[i + 1] !== 3 || wkind[i - WW] !== 3 || wkind[i + WW] !== 3 ? 1 : 0;
    dRiv[i] = edge ? 0 : 99;
  }
  chamfer(dRiv, WW, WW, 8);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y + M) * WW + x + M, t = y * S + x;
    const gx = cx * S + x, gy = cy * S + y;
    L.water[t] = wcls[i]; L.biome[t] = biomeW[i]; L.ground[t] = groundW[i]; L.rock[t] = rockW[i]; L.rockType[t] = rockTW[i];
    L.flowX[t] = Math.round(flowX[i] * 1024) / 1024; L.flowY[t] = Math.round(flowY[i] * 1024) / 1024;
    L.wlevel[t] = water[i] ? Math.round(wlevel[i] * 1024) / 1024 : 0;
    if (!water[i] && !rockW[i] && dRiv[i] <= 5.01) L.fertile[t] = 1;
    const bm = BIOME_LIST[biomeW[i]];
    L.lush[t] = water[i] || rockW[i] ? 0 : clamp(Math.round(((bm.gr ?? 0.4) * 0.8 + clamp(Pt[i] / 2000, 0, 0.3) + 0.25 * fbm(gx, gy, sd + 61, 16, 2)) * 255), 0, 255);
    if (rockW[i]) {
      const dep = dRockIn[i], rt = rockTW[i];
      const v1 = 1 - Math.abs(gnoise(gx / 7, gy / 7, sd + 62, 0));
      const v2 = 1 - Math.abs(gnoise(gx / 5, gy / 5, sd + 63, 0));
      const hh = hash01(gx, gy, sd + 64);
      if (dep >= 5 && v2 > 0.965 && hh < 0.6) L.ore[t] = hh < 0.3 ? 4 : 5;
      else if (dep >= 2.5 && v1 > 0.94) L.ore[t] = 2;
      else if (dep >= 1 && dep < 7 && v2 > 0.93) L.ore[t] = rt === 2 || rt === 6 ? 3 : 1;
      else if (dep >= 1 && dep < 7 && v1 > 0.955 && (rt === 2 || rt === 6)) L.ore[t] = 3;
    }
  }
  // ---------- 10. natural objects & decor ----------
  const objects = [], decor = [];
  const cidx = cy * CW + cx;
  let k = 0;
  const nid = () => cidx * 16384 + (++k);
  const treeP = (i, x, y) => {
    if (water[i] || rockW[i] || steep[i] > 0.9 || groundW[i] === PG.SNOW) return 0;
    const bm = BIOME_LIST[biomeW[i]];
    if (!bm.td) return 0;
    const grove = fbm(x, y, sd + 70, 128, 3);
    let pr = bm.td * clamp(0.55 + grove * 1.4, 0.05, 1.6);
    if (rK[i] && rD[i] - rHW[i] < 1.5) pr *= 0.3;
    if (biomeW[i] === BIOME.MANGROVE) pr = bm.td;
    return pr;
  };
  const tP = new Float32Array(NW), tR = new Float32Array(NW);
  for (let wy = 1; wy < WW - 1; wy++) for (let wx = 1; wx < WW - 1; wx++) {
    if (wx < M - 1 || wy < M - 1 || wx > M + S || wy > M + S) continue;
    const i = wy * WW + wx, gx = X0 + wx, gy = Y0 + wy;
    tP[i] = treeP(i, gx + 0.5, gy + 0.5);
    tR[i] = hash01(gx, gy, sd + 71);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = x + M, wy = y + M, i = wy * WW + wx;
    const gx = cx * S + x, gy = cy * S + y;
    const b = biomeW[i], bm = BIOME_LIST[b];
    const h1 = hash01(gx, gy, sd + 72), h2 = hash01(gx, gy, sd + 73), h3 = hash01(gx, gy, sd + 74);
    const jx = (h1 - 0.5) * 0.55, jy = (h2 - 0.5) * 0.5, f = h3 < 0.5 ? -1 : 1;
    // mangroves stand in the shallow water too
    if (water[i]) {
      if (wcls[i] === 1 && coastT[i] === COAST.MANGROVE && dLand2[i] < 7 && Ttile[i] > 15 && tR[i] < 0.22) objects.push({ id: nid(), type: 'tree_mangrove', v: Math.floor(h1 * 16), x: x + 0.5 + jx, y: y + 0.6 + jy, s: 0.85 + h2 * 0.3, f, w: 1 });
      else if (opts.decor !== false && wcls[i] === 1 && dLand2[i] <= 1.5 && wkind[i] !== 1 && hash01(gx, gy, sd + 75) < 0.35 && Ttile[i] > -2) decor.push({ t: 'reed', v: Math.floor(h1 * 997), x: x + h1, y: y + h2, s: 0.8 + h3 * 0.4, f, w: 1 });
      else if (opts.decor !== false && wcls[i] === 1 && wkind[i] === 1 && b === BIOME.REEF && h1 < 0.08) decor.push({ t: 'coral', v: Math.floor(h2 * 4), x: x + h1, y: y + h2, s: 0.8 + h3 * 0.4, f, w: 1 });
      continue;
    }
    if (rockW[i]) continue;
    // trees: hash below the local chance and the smallest such hash among the 8 neighbours (no clumping),
    // except a few clumps
    const pr = tP[i];
    if (pr > 0 && tR[i] < pr) {
      let ok = true;
      if (tR[i] > pr * 0.2) for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = i + dy * WW + dx;
        if (tR[j] < tP[j] && tR[j] < tR[i]) { ok = false; break; }
      }
      if (ok) {
        const kind = pickWeighted(bm.t, hash01(gx, gy, sd + 76)) || 'tree_oak';
        let v = Math.floor(hash01(gx, gy, sd + 77) * 16);
        if (kind === 'tree_oak') v += (b === BIOME.TEMPERATE_FOREST && fbm(gx, gy, sd + 78, 64, 2) > 0.3 ? 1 : (rK[i] && rD[i] < rHW[i] + 4) ? 2 : 0) * 16;
        if (kind === 'tree_pine') v += (b === BIOME.MEDITERRANEAN || b === BIOME.ALPINE || b === BIOME.BADLANDS ? 2 : fbm(gx, gy, sd + 79, 64, 2) > 0.2 ? 1 : 0) * 16;
        objects.push({ id: nid(), type: kind, v, x: x + 0.5 + jx, y: y + 0.6 + jy, s: 0.85 + h2 * 0.35, f, age: 1 });
        continue;
      }
    }
    // bushes / plants
    const bd = bm.bd || 0;
    if (bd && h1 < bd * (0.6 + 0.8 * (fbm(gx, gy, sd + 80, 64, 2) + 0.5))) {
      const kind = pickWeighted(bm.b, h2);
      if (kind) { objects.push({ id: nid(), type: kind, v: Math.floor(h3 * 1000), x: x + 0.5 + jx * 0.7, y: y + 0.6, s: 0.8 + h2 * 0.35, f }); continue; }
    }
    // boulders near rock and on rocky ground
    const g = groundW[i];
    const nearRock = dRockIn[i] === 0 && (rockW[i - 1] || rockW[i + 1] || rockW[i - WW] || rockW[i + WW]);
    const pB = nearRock ? 0.05 : g === PG.GRAVEL || g === PG.STONE ? 0.02 : b === BIOME.ROCKY_SHORE || b === BIOME.ALPINE || b === BIOME.TUNDRA ? 0.012 : 0.0015;
    const h4 = hash01(gx, gy, sd + 81);
    if (h4 < pB) { objects.push({ id: nid(), type: 'boulder', v: (b === BIOME.TEMPERATE_FOREST || b === BIOME.TAIGA || b === BIOME.RAINFOREST || b === BIOME.TEMPERATE_RAINFOREST ? 8000 : 0) + Math.floor(h1 * 7919), x: x + 0.5 + jx * 0.5, y: y + 0.6, s: 0.6 + h2 * 0.55, f }); continue; }
    // small gatherables: pebbles, sticks, fibre grass, wild crops, wild wheat on fertile soil
    const h5 = hash01(gx, gy, sd + 82);
    const woods = bm.td > 0.15;
    const pPeb = g === PG.GRAVEL || g === PG.STONE || b === BIOME.BEACH || b === BIOME.ROCKY_SHORE ? 0.05 : 0.006;
    if (h5 < pPeb) { objects.push({ id: nid(), type: 'pebble', v: Math.floor(h1 * 4), x: x + 0.5 + jx, y: y + 0.5 + jy, s: 0.8 + h2 * 0.35, f }); continue; }
    if (woods && h5 > 0.99 - 0.006) { objects.push({ id: nid(), type: 'stick', v: Math.floor(h1 * 3), x: x + 0.5 + jx, y: y + 0.5 + jy, s: 0.85 + h2 * 0.3, f }); continue; }
    const grassy = (bm.gr || 0) > 0.4 && g !== PG.SNOW;
    if (grassy && h5 > 0.5 && h5 < 0.5 + 0.012 * bm.gr) { objects.push({ id: nid(), type: 'fibergrass', v: Math.floor(h1 * 3), x: x + 0.5 + jx, y: y + 0.5 + jy, s: 0.85 + h2 * 0.35, f }); continue; }
    if (L.fertile[y * S + x] && grassy && Ttile[i] > 4 && h5 > 0.3 && h5 < 0.3 + 0.006) { objects.push({ id: nid(), type: 'wild_wheat', v: 0, x: x + 0.5 + jx, y: y + 0.55, s: 0.9 + h2 * 0.2, f }); continue; }
    if ((b === BIOME.STEPPE || b === BIOME.TEMPERATE_FOREST || b === BIOME.FLOODPLAIN) && h5 > 0.2 && h5 < 0.2 + 0.0025) { objects.push({ id: nid(), type: h1 < 0.5 ? 'wild_potato' : h1 < 0.8 ? 'wild_corn' : 'wild_cotton', v: 0, x: x + 0.5 + jx, y: y + 0.5 + jy, s: 0.9 + h2 * 0.2, f }); continue; }
    // decor
    if (opts.decor === false) continue;
    const gr = (bm.gr || 0) * (0.7 + 0.6 * (fbm(gx, gy, sd + 83, 32, 2) + 0.5));
    const n = Math.floor(gr * 2.2 + hash01(gx, gy, sd + 84));
    for (let q = 0; q < n; q++) {
      const a1 = hash01(gx * 7 + q, gy * 13 - q, sd + 85), a2 = hash01(gx * 11 - q, gy * 3 + q, sd + 86), a3 = hash01(gx + q * 31, gy - q * 17, sd + 87);
      let t = 'grass', v = Math.floor(a3 * 997);
      if (g === PG.SNOW) t = a3 < 0.3 ? 'snowtuft' : 'lichen';
      else if (b === BIOME.TUNDRA) t = a3 < 0.25 ? 'cottongrass' : a3 < 0.5 ? 'lichen' : 'grass';
      else if (b === BIOME.MARSH || b === BIOME.SWAMP) t = a3 < 0.45 ? 'reed' : a3 < 0.75 ? 'tallgrass' : 'grass';
      else if (b === BIOME.STEPPE || b === BIOME.SAVANNA || b === BIOME.MEDITERRANEAN) t = a3 < 0.35 ? 'drygrass' : a3 < 0.7 ? 'tallgrass' : 'grass';
      else if (b === BIOME.TEMPERATE_FOREST || b === BIOME.RAINFOREST || b === BIOME.CLOUD_FOREST || b === BIOME.TEMPERATE_RAINFOREST) t = a3 < 0.12 ? 'fern' : a3 < 0.16 ? 'mushroom' : 'grass';
      else if (b === BIOME.TAIGA) t = a3 < 0.2 ? 'needles' : a3 < 0.3 ? 'moss' : 'grass';
      else if (b === BIOME.HEATH || b === BIOME.ALPINE) t = a3 < 0.3 ? 'heather' : a3 < 0.37 ? 'bloom' : 'grass';
      else if (b === BIOME.FLOODPLAIN) t = a3 < 0.08 ? 'flower' : a3 < 0.45 ? 'tallgrass' : 'grass';
      else if (b === BIOME.VOLCANIC) t = 'ash';
      if (t === 'flower') v = Math.floor(a1 * 4);
      decor.push({ t, v, x: x + a1, y: y + a2, s: 0.75 + a3 * 0.45, f: a1 < 0.5 ? -1 : 1 });
    }
    if (b === BIOME.BEACH && h4 > 0.95) decor.push({ t: 'shell', v: Math.floor(h1 * 2), x: x + h1, y: y + h2, s: 0.9, f });
    if (b === BIOME.SALT_FLAT && h4 > 0.8) decor.push({ t: 'saltcrust', v: Math.floor(h1 * 3), x: x + h1, y: y + h2, s: 1, f });
    if (b === BIOME.DESERT_DUNES && h4 > 0.9) decor.push({ t: 'sandripple', v: Math.floor(h1 * 3), x: x + h1, y: y + h2, s: 1, f });
  }
  // volcano craters inside the chunk
  for (const v of p.volcanoes) {
    const vx = X0 + WW / 2 + dxWrap(X0 + WW / 2, v.x);
    if (vx >= cx * S && vx < cx * S + S && v.y >= cy * S && v.y < cy * S + S) features.push({ t: 'crater', x: vx - cx * S, y: v.y - cy * S, active: v.active, kind: v.kind });
  }
  const tEnd = typeof performance !== 'undefined' ? performance.now() : 0;
  return { cx, cy, x0: cx * S, y0: cy * S, size: S, height, ...L, objects, decor, features, ms: Math.round((tEnd - tStart) * 10) / 10 };
}

// Climate at a tile (content phase: seasons by place). { tMean, tAmp, precip, lat (deg), zone }
export function climateAt(p, x, y) {
  const o = macroAt(p, x + 0.5, y + 0.5, {});
  return { tMean: o.T, tAmp: o.tAmp, precip: o.P };
}
export { W, H };
