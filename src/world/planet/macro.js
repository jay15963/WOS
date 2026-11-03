// generatePlanet(seed): the whole planet on the 512 x 256 macro grid (1 cell = 32 x 32 tiles).
// Pure function of the seed; plain object of typed arrays (structured-clone friendly: send it to workers).
// Steps: continents -> plates -> elevation (base + boundaries + hotspots + coast noise) -> sea level so land is
// ~30 % -> abyss walls between continents + seam ocean -> stream-power erosion -> volcanoes -> climate ->
// hydrology (lakes, rivers, deltas, fjords, canyons) -> biomes, coasts. See docs/PLANET.md.

import { MW, MH, CELL, SEAM_HALF, ABYSS_M, sinLatCell, metersToStories } from './consts.js';
import { rng32, fbm, ridged, clamp, smoothstep, smooth01, hash01, ihash } from './noise.js';
import { N, DL8, cxOf, cyOf, tileX, tileY, nbTable, distField, blur } from './grid.js';
import { buildContinents, buildPlates, boundaryUplift, pickHotspots } from './tectonics.js';
import { computeClimate, seaIceAt } from './climate.js';
import { computeHydrology, buildRivers, priorityFlood, RIVER_Q } from './hydro.js';
import { BIOME, landBiome } from './biomes.js';

export const PLANET_VERSION = 1;

// coast types (per coastal cell)
export const COAST = { NONE: 0, BEACH: 1, DUNES: 2, LAGOON: 3, ROCKY: 4, CLIFF: 5, MANGROVE: 6, FJORD: 7, ICE: 8, DELTA: 9 };
export const COAST_PT = ['', 'Praia', 'Dunas costeiras', 'Laguna e restinga', 'Costa rochosa', 'Falésias', 'Mangue', 'Fiordes', 'Costa de gelo', 'Delta'];
// cell flags
export const FLAG = { VOLCANIC: 1, CANYON: 2, FJORD: 4, DELTA: 8, PLATEAU: 16, RIFT: 32, ERG: 64, LAKES: 128 };

const bumpF = (d, w) => { if (d < 0) d = -d; if (d >= w) return 0; const t = d / w, u = 1 - t * t; return u * u; };

// volcanic cone height (m) at distance d (tiles) from a volcano v
export function coneAt(v, d) {
  if (d >= v.R) return 0;
  const t = d / v.R;
  let h;
  if (v.shield) { const u = 1 - t * t; h = v.H * u * Math.sqrt(u); }
  else { const u = 1 - t; h = v.H * u * Math.sqrt(u); }
  if (t < v.crater) { const c = 1 - t / v.crater; h -= v.H * 0.09 * c * c; }
  return h;
}
const VB = 8; // volcano bucket size (cells)
export function volcanoBuckets(vols) {
  const BW = MW / VB, BH = MH / VB, buckets = Array.from({ length: BW * BH }, () => []);
  vols.forEach((v, k) => {
    const r = v.R / CELL / VB + 1;
    const bx0 = Math.floor(v.x / CELL / VB - r), bx1 = Math.floor(v.x / CELL / VB + r);
    const by0 = Math.max(0, Math.floor(v.y / CELL / VB - r)), by1 = Math.min(BH - 1, Math.floor(v.y / CELL / VB + r));
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) buckets[by * BW + ((bx % BW) + BW) % BW].push(k);
  });
  return buckets;
}
// sum of cones at tile point (x, y)
export function coneSum(planet, x, y) {
  const vols = planet.volcanoes, B = planet._vb || (planet._vb = volcanoBuckets(vols));
  const BW = MW / VB, bx = ((Math.floor(x / CELL / VB) % BW) + BW) % BW, by = clamp(Math.floor(y / CELL / VB), 0, MH / VB - 1);
  let h = 0;
  for (const k of B[by * BW + bx]) {
    const v = vols[k];
    let dx = x - v.x; if (dx > 8192) dx -= 16384; else if (dx < -8192) dx += 16384;
    const dy = y - v.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < v.R * v.R) h += coneAt(v, Math.sqrt(d2));
  }
  return h;
}

export function generatePlanet(seed = 1) {
  seed = seed | 0;
  const timings = {};
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  let t0 = now();
  const lap = (k) => { const t = now(); timings[k] = Math.round(t - t0); t0 = t; };
  const rng = rng32(seed * 2654435761 + 12345);
  const T8 = nbTable();

  // ---------- continents & plates ----------
  const { owner: crust, conts } = buildContinents(seed, rng);
  lap('continents');
  const { plate, plates } = buildPlates(seed, rng, crust, conts);
  const isCrust = new Float32Array(N);
  for (let i = 0; i < N; i++) isCrust[i] = crust[i] >= 0 ? 1 : 0;
  const crustB = blur(isCrust, 2);
  const bnd = boundaryUplift(seed, plate, plates, crustB);
  bnd.U = blur(blur(bnd.U, 1), 1); // the warped plate edges are jagged at cell scale
  lap('plates');

  // ---------- base elevation ----------
  const dIn = distField((i) => crust[i] < 0, 40), dOut = distField((i) => crust[i] >= 0, 60);
  const sd = new Float32Array(N);
  for (let i = 0; i < N; i++) sd[i] = crust[i] >= 0 ? dIn[i] - 0.5 : -(dOut[i] - 0.5);
  const activeSrc = (i) => bnd.kind[i] === 2 || bnd.kind[i] === 3;
  const dActive = distField(activeSrc, 10);
  const elev = new Float32Array(N);
  const plateau = new Float32Array(N);
  const iceT = new Float32Array(N); // ice sheet thickness (m)
  const S = seed * 1009;
  const brokenIds = new Set(conts.filter((c) => c.style === 'broken').map((c) => c.id));
  const fragC = new Float32Array(N);
  for (let i = 0; i < N; i++) fragC[i] = brokenIds.has(crust[i]) ? 1 : 0;
  const fragB = blur(blur(fragC, 4), 4);
  for (let i = 0; i < N; i++) {
    const tx = tileX(i), ty = tileY(i), d = sd[i];
    let e;
    if (d > 0) {
      const reg = fbm(tx, ty, S + 1, 4096, 4);
      const up = smoothstep(-0.15, 0.55, reg);
      e = 30 + 230 * smooth01(d / 12) + 950 * up * smooth01(d / 6);
      const pl = smoothstep(0.2, 0.36, fbm(tx, ty, S + 2, 2048, 3)) * smooth01((d - 2) / 8);
      plateau[i] = pl;
      e += 1150 * pl;
      const bm = smoothstep(0.22, 0.55, fbm(tx, ty, S + 3, 4096, 2));
      const rn = ridged(tx, ty, S + 4, 1024, 4);
      e += 1600 * bm * rn * rn * smooth01(d / 4);
      e += 170 * fbm(tx, ty, S + 5, 512, 4) * smooth01(d / 3);
      e -= 300 * smoothstep(0.2, 0.6, -reg) * smooth01(d / 8);
      if (crust[i] === 50) { iceT[i] = 2300 * smooth01(d / 12); e += iceT[i] + 700 * ridged(tx, ty, S + 15, 1024, 4) * smooth01(d / 4); } // ice dome + buried ranges
    } else {
      const dd = -d;
      const shelfW = (1.6 + 4.6 * (fbm(tx, ty, S + 6, 2048, 2) * 0.5 + 0.5)) * (dActive[i] < 8 ? 0.45 : 1);
      if (dd < shelfW) e = -25 - 160 * (dd / shelfW);
      else if (dd < shelfW + 3) e = -185 - 3700 * smooth01((dd - shelfW) / 3);
      else e = -3900 - 1100 * smooth01((dd - shelfW - 3) / 20) + 350 * fbm(tx, ty, S + 7, 512, 3);
    }
    // fractal coasts: gulfs and peninsulas (1024), bays and capes (256); broken continents become archipelagos
    const fb = fragB[i];
    const frag = Math.max(fb, smoothstep(-0.1, 0.55, fbm(tx, ty, S + 9, 4096, 2)) * 0.7);
    e += (220 + 520 * frag) * fbm(tx, ty, S + 10, 1024, 3) * bumpF(d, 8 + 4 * frag);
    e += (120 + 380 * frag) * fbm(tx, ty, S + 8, 256, 3) * bumpF(d, 3.5 + 3 * frag);
    if (fb > 0.05) e += fb * (520 * fbm(tx, ty, S + 13, 512, 4) - 160) * smoothstep(-3, 3, d);
    // roughness so the drainage converges into trees instead of running in parallel lines
    if (d > -1) e += (45 + 0.06 * Math.max(0, e)) * fbm(tx, ty, S + 12, 256, 3) + 22 * fbm(tx, ty, S + 14, 128, 2);
    e += bnd.U[i];
    elev[i] = e;
  }
  lap('elevation');

  // ---------- volcanoes: arcs + hotspot chains + rifts ----------
  const volcanoes = [];
  const near = (x, y, r) => volcanoes.some((v) => { let dx = Math.abs(v.x - x); if (dx > 8192) dx = 16384 - dx; const dy = v.y - y; return dx * dx + dy * dy < r * r; });
  {
    const cand = [];
    for (let i = 0; i < N; i++) if (bnd.arc[i] > 0.45) cand.push(i);
    cand.sort((a, b) => ihash(a, 7, seed) - ihash(b, 7, seed));
    for (const i of cand) {
      if (hash01(i, 3, seed) > 0.18) continue;
      const x = tileX(i) + (hash01(i, 4, seed) - 0.5) * CELL, y = tileY(i) + (hash01(i, 5, seed) - 0.5) * CELL;
      if (near(x, y, 11 * CELL)) continue;
      const ocean = elev[i] < 0;
      volcanoes.push({ x, y, R: (ocean ? 70 : 55) + hash01(i, 6, seed) * 80, H: (ocean ? 2600 : 1400) + hash01(i, 8, seed) * 1900, crater: 0.07 + hash01(i, 9, seed) * 0.08, shield: false, active: hash01(i, 10, seed) < 0.4, kind: 'arco' });
    }
    const hs = pickHotspots(seed, rng, 3 + Math.floor(rng() * 4));
    for (const h of hs) {
      const p = plates[plate[h]];
      const vl = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      const ux = -p.vx / vl, uy = -p.vy / vl;
      const hOcean = elev[h] < 0;
      const n = hOcean ? 4 + Math.floor(rng() * 5) : 1 + Math.floor(rng() * 2), sp = (3.5 + rng() * 2.5) * CELL;
      for (let k = 0; k < n; k++) {
        const x = tileX(h) + ux * sp * k + (rng() - 0.5) * CELL, y = tileY(h) + uy * sp * k + (rng() - 0.5) * CELL;
        if (y < 200 || y > MH * CELL - 200) break;
        const cx = ((Math.floor(x / CELL) % MW) + MW) % MW, cy = clamp(Math.floor(y / CELL), 0, MH - 1);
        const ci = cy * MW + cx;
        if (Math.min(cx, MW - 1 - cx) < SEAM_HALF + 2) break;
        const ocean = elev[ci] < 0;
        let age = 1;
        for (let a = 0; a < k; a++) age *= 0.8;
        volcanoes.push({ x: ((x % 16384) + 16384) % 16384, y, R: ocean ? (110 + rng() * 80) * (0.7 + 0.3 * age) : 140 + rng() * 60, H: ocean ? (5200 + rng() * 1200) * age : 900 * age + 400, crater: ocean ? 0.05 : 0.22, shield: ocean, active: k === 0, kind: ocean ? 'ponto quente' : 'caldeira' });
      }
    }
    for (let i = 0; i < N && volcanoes.length < 400; i++) {
      if (bnd.kind[i] !== 5 || hash01(i, 21, seed) > 0.006) continue;
      const x = tileX(i), y = tileY(i);
      if (near(x, y, 9 * CELL)) continue;
      volcanoes.push({ x, y, R: 60 + hash01(i, 22, seed) * 50, H: 1200 + hash01(i, 23, seed) * 1400, crater: 0.1, shield: false, active: false, kind: 'rifte' });
    }
  }
  lap('volcanoes');

  // ---------- sea level: land ~30 % (shift the continents only) ----------
  const landTarget = 0.297 + hash01(seed, 1, 77) * 0.025;
  const wSea = new Float32Array(N);
  for (let i = 0; i < N; i++) wSea[i] = smoothstep(-4, 2, sd[i]);
  const coneC = new Float32Array(N); // cones sampled at cell centres (added after erosion)
  const tmpPl = { volcanoes };
  for (let i = 0; i < N; i++) coneC[i] = coneSum(tmpPl, tileX(i), tileY(i));
  {
    let lo = -900, hi = 900;
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2;
      let land = 0;
      for (let i = 0; i < N; i++) if (elev[i] + mid * wSea[i] + coneC[i] > 0) land++;
      if (land / N > landTarget) hi = mid; else lo = mid;
    }
    const delta = (lo + hi) / 2;
    for (let i = 0; i < N; i++) elev[i] += delta * wSea[i];
    timings.seaShift = Math.round(delta);
  }

  // ---------- abyss walls between continents, seam ocean ----------
  const bigIds = new Set(conts.filter((c) => !c.micro && c.area >= 900).map((c) => c.id));
  const terrSrc = new Int32Array(N).fill(-1);
  distField((i) => bigIds.has(crust[i]), 1e9, terrSrc);
  const terr = new Int16Array(N);
  for (let i = 0; i < N; i++) terr[i] = terrSrc[i] >= 0 ? crust[terrSrc[i]] : -1;
  const isWall = (i) => { for (let k = 0; k < 4; k++) { const j = T8[i * 8 + k]; if (j >= 0 && terr[j] !== terr[i]) return true; } return false; };
  const dWall = distField(isWall, 6);
  for (let i = 0; i < N; i++) {
    if (dWall[i] < 4) elev[i] = Math.min(elev[i], ABYSS_M - 700 - 900 * (1 - dWall[i] / 4));
    const x = cxOf(i), sdist = Math.min(x + 0.5, MW - x - 0.5);
    if (sdist < SEAM_HALF + 4) {
      const f = smoothstep(SEAM_HALF + 4, SEAM_HALF, sdist);
      elev[i] = Math.min(elev[i], -1800 - 2600 * f + 300 * fbm(tileX(i), tileY(i), S + 11, 1024, 2));
    }
    // the north polar edge: open (frozen) ocean
    const y = cyOf(i);
    if (y < 2) elev[i] = Math.min(elev[i], -2000);
  }
  // no volcano inside the walls / seam
  for (let k = volcanoes.length - 1; k >= 0; k--) {
    const v = volcanoes[k], ci = clamp(Math.floor(v.y / CELL), 0, MH - 1) * MW + ((Math.floor(v.x / CELL) % MW) + MW) % MW;
    if (dWall[ci] < 4 + v.R / CELL || Math.min(cxOf(ci), MW - 1 - cxOf(ci)) < SEAM_HALF + 4 + v.R / CELL) volcanoes.splice(k, 1);
  }
  lap('separation');

  // ---------- erosion (implicit stream power, uniform rain) + diffusion ----------
  {
    const A = new Float64Array(N);
    for (let it = 0; it < 6; it++) {
      const seedL = new Float64Array(N).fill(NaN);
      for (let i = 0; i < N; i++) if (elev[i] < 0) seedL[i] = elev[i];
      for (let x = 0; x < MW; x++) { seedL[x] = elev[x]; seedL[(MH - 1) * MW + x] = elev[(MH - 1) * MW + x]; }
      const f = priorityFlood(elev, seedL);
      A.fill(1);
      for (let k = f.n - 1; k >= 0; k--) { const i = f.order[k], p = f.parent[i]; if (p >= 0) A[p] += A[i]; }
      for (let k = 0; k < f.n; k++) {
        const i = f.order[k], r = f.parent[i];
        if (r < 0 || elev[i] <= 0) continue;
        const dx = Math.abs(cxOf(i) - cxOf(r)), dy = Math.abs(cyOf(i) - cyOf(r));
        const len = dx && dy ? 1.4142135623730951 : 1;
        const F = (0.0075 * Math.sqrt(A[i])) / len;
        const er = Math.max(elev[r], 0);
        if (elev[i] > er) elev[i] = (elev[i] + F * er) / (1 + F);
      }
    }
    {
      const b1 = blur(elev, 1);
      for (let i = 0; i < N; i++) if (elev[i] > 0 && b1[i] > 0) elev[i] = elev[i] * 0.45 + b1[i] * 0.55;
    }
    for (let pass = 0; pass < 4; pass++) {
      const ne = elev.slice();
      for (let i = 0; i < N; i++) {
        if (elev[i] <= 0) continue;
        let a = 0, n = 0;
        for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0) { a += elev[j]; n++; } }
        const v = elev[i] + 0.16 * (a / n - elev[i]);
        ne[i] = Math.max(1, v);
      }
      elev.set(ne);
    }
  }
  // volcano cones on top (exact cones are re-added per tile by the chunk generator)
  const cone = new Float32Array(N);
  const volPl = { volcanoes };
  for (let i = 0; i < N; i++) { cone[i] = coneSum(volPl, tileX(i), tileY(i)); elev[i] += cone[i]; }
  lap('erosion');

  // ---------- ocean (connected to the seam) ----------
  const ocean = new Uint8Array(N);
  {
    const st = [];
    for (let y = 0; y < MH; y++) { const i = y * MW; if (elev[i] < 0) { ocean[i] = 1; st.push(i); } }
    while (st.length) {
      const i = st.pop();
      for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0 && !ocean[j] && elev[j] < 0) { ocean[j] = 1; st.push(j); } }
    }
  }

  // ---------- climate ----------
  const clim = computeClimate(elev, ocean, seed);
  const { tMean, tAmp, precip, dOcean } = clim;
  lap('climate');

  // ---------- fjord / canyon potential ----------
  const maxNear = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = elev[i];
    const x = cxOf(i), y = cyOf(i);
    for (let dy = -3; dy <= 3; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= MH) continue;
      for (let dx = -3; dx <= 3; dx++) { const j = yy * MW + ((x + dx + MW) % MW); if (elev[j] > m) m = elev[j]; }
    }
    maxNear[i] = m;
  }
  const fjordP = new Float32Array(N), canyonP = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (ocean[i]) continue;
    const s = Math.abs(sinLatCell(cyOf(i)));
    fjordP[i] = smoothstep(0.7, 0.8, s) * smoothstep(7, 2, tMean[i] + 0.0065 * elev[i]) * smoothstep(250, 800, maxNear[i]) * smoothstep(9, 3, dOcean[i]);
    canyonP[i] = smoothstep(520, 280, precip[i]) * smoothstep(700, 1300, maxNear[i]) * smoothstep(-0.1, 0.3, plateau[i] + (maxNear[i] > 1600 ? 0.3 : 0));
  }

  // ---------- hydrology ----------
  const hyd = computeHydrology(elev, ocean, tMean, precip);
  const riv = buildRivers(hyd, elev, ocean, precip, tMean, { fjord: fjordP, canyon: canyonP });
  lap('hydrology');

  // ---------- deltas ----------
  const deltas = [];
  for (let i = 0; i < N; i++) {
    if (riv.kind[i] !== 1 || riv.mouthD[i] !== 1 || riv.flow[i] < 22) continue;
    const d = hyd.down[i];
    if (d < 0 || elev[d] < -260 || elev[i] > 140 || fjordP[i] > 0.3) continue;
    // apex one cell upstream on the main stem
    const up = riv.upMain[i] >= 0 ? riv.upMain[i] : i;
    let dx = tileX(d) - tileX(up); if (dx > 8192) dx -= 16384; else if (dx < -8192) dx += 16384;
    const dy = tileY(d) - tileY(up), l = Math.sqrt(dx * dx + dy * dy) || 1;
    const R = clamp(36 + 9 * Math.sqrt(riv.flow[i]), 40, 150);
    const dl = { cell: i, x: tileX(i), y: tileY(i), dx: dx / l, dy: dy / l, R, flow: riv.flow[i], channels: [] };
    const r = rng32(ihash(i, 99, seed));
    const nCh = 3 + Math.floor(r() * 4);
    for (let c = 0; c < nCh; c++) {
      let ang = (c / (nCh - 1) - 0.5) * 1.9 + (r() - 0.5) * 0.3;
      // rotate the main direction by ang (small-angle rotation built from exact ops)
      const pts = [];
      let px = dl.x - dl.dx * R * 0.35, py = dl.y - dl.dy * R * 0.35;
      let hx = dl.dx, hy = dl.dy;
      const rot = (vx, vy, a) => { const a2 = a * a, ca = 1 - a2 / 2 + (a2 * a2) / 24, sa = a - (a2 * a) / 6 + (a2 * a2 * a) / 120; return [vx * ca - vy * sa, vx * sa + vy * ca]; };
      [hx, hy] = rot(hx, hy, ang * 0.5);
      const len = R * (1.05 + r() * 0.45);
      for (let s = 0; s <= len; s += 6) {
        pts.push(px, py);
        [hx, hy] = rot(hx, hy, (r() - 0.5) * 0.5 + (s < len * 0.3 ? ang * 0.08 : 0));
        px += hx * 6; py += hy * 6;
      }
      dl.channels.push({ pts, w: clamp((1.2 + 1.1 * Math.sqrt(riv.flow[i])) * (0.22 + r() * 0.2), 1.2, 7) });
    }
    deltas.push(dl);
  }

  // ---------- biomes, coasts, flags ----------
  const biome = new Uint8Array(N), coast = new Uint8Array(N), flags = new Uint8Array(N);
  const relief = new Float32Array(N), mtn = new Float32Array(N);
  const westOcean = new Float32Array(N).fill(999);
  for (let y = 0; y < MH; y++) {
    let d = 999;
    for (let lap2 = 0; lap2 < 2; lap2++) for (let x = 0; x < MW; x++) { const i = y * MW + x; d = ocean[i] ? 0 : d + 1; if (lap2) westOcean[i] = d; }
  }
  for (let i = 0; i < N; i++) {
    const x = cxOf(i), y = cyOf(i);
    let mn = elev[i], mx = elev[i];
    for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0) { if (elev[j] < mn) mn = elev[j]; if (elev[j] > mx) mx = elev[j]; } }
    relief[i] = clamp((Math.max(0, mx) - Math.max(0, mn)) / 1500, 0, 1);
    const bed = elev[i] - iceT[i];
    mtn[i] = smoothstep(350, 2300, bed) * (0.35 + 0.65 * relief[i]) + 0.5 * smoothstep(1800, 4000, bed);
    if (iceT[i] > 200) relief[i] *= 0.4;
    void x; void y;
  }
  const dDelta = distField((i) => deltas.some((dl) => dl.cell === i), 4);
  for (let i = 0; i < N; i++) {
    const tx = tileX(i), ty = tileY(i), s = Math.abs(sinLatCell(cyOf(i)));
    const e = elev[i];
    const T = tMean[i] + 1.6 * fbm(tx, ty, S + 37, 1024, 3), P = precip[i] * (1 + 0.18 * fbm(tx, ty, S + 38, 1024, 3));
    if (ocean[i]) {
      const ice = seaIceAt(seed, tx, ty, tMean[i], false);
      biome[i] = ice ? BIOME.SEA_ICE : e < ABYSS_M ? BIOME.ABYSS : e > -40 ? BIOME.SHALLOWS : BIOME.OCEAN;
      if (biome[i] === BIOME.SHALLOWS && T > 23) biome[i] = BIOME.REEF;
      continue;
    }
    const L = hyd.lakeId[i];
    if (L) { const lk = hyd.lakes[L - 1]; biome[i] = lk.dry ? BIOME.SALT_FLAT : lk.salt ? BIOME.SALT_LAKE : T < -6 ? BIOME.SEA_ICE : BIOME.LAKE; continue; }
    const erg = fbm(tx, ty, S + 31, 2048, 3) + 0.15 - relief[i] * 1.2;
    const med = s > 0.47 && s < 0.7 && westOcean[i] < 14 && dOcean[i] < 14 && P > 280;
    let b = landBiome(T, P, e, { relief: relief[i], med, coast: dOcean[i], erg, plateau: plateau[i], heath: fbm(tx, ty, S + 33, 1024, 2) });
    // wetlands on flat wet lowlands
    if (e < 140 && relief[i] < 0.07 && T > -4) {
      const wet = fbm(tx, ty, S + 35, 1024, 3) + (P - 1300) / 1200 + (hyd.A[i] > 400 ? 0.25 : 0);
      if (wet > 0.35) b = T > 17 ? BIOME.SWAMP : BIOME.MARSH;
    }
    if (cone[i] > 300) flags[i] |= FLAG.VOLCANIC;
    if (cone[i] > 1300 && T > -6) b = BIOME.VOLCANIC;
    biome[i] = b;
    if (b === BIOME.DESERT_DUNES) flags[i] |= FLAG.ERG;
    if (plateau[i] > 0.4) flags[i] |= FLAG.PLATEAU;
    if (bnd.kind[i] === 5) flags[i] |= FLAG.RIFT;
    if (canyonP[i] > 0.25) flags[i] |= FLAG.CANYON;
    if (fjordP[i] > 0.4) flags[i] |= FLAG.FJORD;
    if (dDelta[i] < 2.5) flags[i] |= FLAG.DELTA;
    // lake districts: glaciated / flat wet lowlands
    if (relief[i] < 0.18 && P > 350 && T < 4 && T > -9 && dOcean[i] > 1) flags[i] |= FLAG.LAKES;
  }
  // coast type of every cell within 3 cells of a coastline
  {
    const isCoast = (i) => { if (ocean[i]) return false; for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0 && ocean[j]) return true; } return false; };
    const cs = new Int32Array(N).fill(-1);
    const dC = distField(isCoast, 4, cs);
    const typeOf = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!isCoast(i)) continue;
      const tx = tileX(i), ty = tileY(i), T = tMean[i], P = precip[i], e = elev[i];
      let m1 = e;
      for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0 && elev[j] > m1) m1 = elev[j]; }
      const steep = e > 220 || m1 > 700 || (bnd.kind[i] === 2 && m1 > 300);
      const n1 = fbm(tx, ty, S + 41, 1024, 3);
      let c;
      if (T < -7) c = COAST.ICE;
      else if (dDelta[i] < 1.5) c = COAST.DELTA;
      else if (fjordP[i] > 0.4) c = COAST.FJORD;
      else if (T > 21 && P > 1150 && e < 60 && !steep && n1 > -0.25) c = COAST.MANGROVE;
      else if (steep && n1 > -0.3) c = n1 > 0.1 ? COAST.CLIFF : COAST.ROCKY;
      else if ((e > 90 && n1 > 0.15) || (Math.abs(sinLatCell(cyOf(i))) > 0.75 && n1 > 0)) c = n1 > 0.45 ? COAST.CLIFF : COAST.ROCKY;
      else if (n1 < -0.18 && Math.abs(sinLatCell(cyOf(i))) < 0.72 && e < 50) c = COAST.LAGOON;
      else c = P < 320 && T > 8 ? COAST.DUNES : COAST.BEACH;
      typeOf[i] = c;
    }
    for (let i = 0; i < N; i++) if (dC[i] <= 4 && cs[i] >= 0) coast[i] = typeOf[cs[i]];
  }
  lap('biomes');

  // ---------- macro water class ----------
  const water = new Uint8Array(N);
  for (let i = 0; i < N; i++) water[i] = ocean[i] ? (elev[i] < ABYSS_M ? 3 : 2) : hyd.lakeId[i] ? 4 : 0;
  let landCells = 0;
  for (let i = 0; i < N; i++) if (!ocean[i] && !hyd.lakeId[i]) landCells++;
  // continents = big land components
  const comp = new Int32Array(N).fill(-1), compArea = [];
  {
    const st = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (ocean[s0] || comp[s0] >= 0) continue;
      const id = compArea.length; let a = 0;
      comp[s0] = id; st.push(s0);
      while (st.length) {
        const i = st.pop(); a++;
        for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0 && !ocean[j] && comp[j] < 0) { comp[j] = id; st.push(j); } }
      }
      compArea.push(a);
    }
  }
  const continents = [];
  compArea.forEach((a, id) => { if (a >= 600) continents.push({ comp: id, area: a }); });
  continents.sort((a, b) => b.area - a.area);
  let islands = 0;
  compArea.forEach((a) => { if (a < 600) islands++; });
  const stats = {
    land: Math.round((landCells / N) * 1000) / 10,
    continents: continents.length,
    continentAreas: continents.map((c) => c.area),
    islands,
    lakes: hyd.lakes.length,
    rivers: riv.kind.reduce((a, k) => a + (k === 1 ? 1 : 0), 0),
    volcanoes: volcanoes.length,
    plates: plates.length,
    villages: Math.round((landCells * CELL * CELL) / (256 * 256)),
  };
  lap('finish');
  timings.total = Object.values(timings).reduce((a, b) => a + b, 0) - (timings.seaShift || 0);

  return {
    version: PLANET_VERSION, seed, W: MW * CELL, H: MH * CELL, CELL, MW, MH,
    elev, cone, iceT, surf: hyd.surf, sd, plateau, relief, mtn,
    crust, plate, plates: plates.map((p) => ({ id: p.id, vx: p.vx, vy: p.vy, continental: p.continental, area: p.area })),
    bkind: bnd.kind, bconv: bnd.bconv,
    tMean, tAmp, precip, dOcean, ocean, water, biome, coast, flags, comp,
    down: hyd.down, flow: riv.flow, drain: hyd.A, rkind: riv.kind, upMain: riv.upMain, mouthD: riv.mouthD,
    rlevel: riv.level, fall: riv.fall, canyon: riv.canyon,
    lakeId: hyd.lakeId, lakeLevel: hyd.lakeLevel,
    lakes: hyd.lakes.map((l) => ({ id: l.id, level: l.level, levelS: metersToStories(l.level), area: l.area, salt: l.salt, dry: l.dry, endorheic: l.endorheic })),
    volcanoes, deltas, continents, stats, timings, riverQ: RIVER_Q,
  };
}

export { DL8 };
