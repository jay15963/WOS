// findSpawn(planet[, k]): a temperate, fertile, river-side, low-hazard starting spot on a large continent.
// Macro scoring of every cell, then a tile pick inside the best cell's chunk (dry flat land 5..12 tiles from a
// river, not rock, not on a beach). k > 0 returns the k-th best spot at least MIN_SEP cells from the better ones
// (more villages later). Pure function of the planet.

import { MW, MH, CELL, CHUNK, seasonZoneOf } from './consts.js';
import { BIOME } from './biomes.js';
import { FLAG } from './macro.js';
import { generateChunk } from './chunk.js';
import { nbTable } from './grid.js';

const MIN_SEP = 48;
const GOOD = new Set([BIOME.TEMPERATE_FOREST, BIOME.STEPPE, BIOME.FLOODPLAIN, BIOME.MEDITERRANEAN, BIOME.HEATH]);

export function spawnScores(p) {
  const N = MW * MH, T8 = nbTable();
  const score = new Float32Array(N).fill(-1e9);
  const big = new Set(p.continents.filter((c) => c.area >= 2500).map((c) => c.comp));
  for (let i = 0; i < N; i++) {
    if (p.ocean[i] || p.lakeId[i] || !big.has(p.comp[i])) continue;
    const T = p.tMean[i], P = p.precip[i], e = p.elev[i];
    if (!GOOD.has(p.biome[i]) || seasonZoneOf(T, p.tAmp[i]) !== 2) continue;
    if (e > 650 || p.relief[i] > 0.2 || p.flags[i] & FLAG.VOLCANIC || p.cone[i] > 50) continue;
    // a river in this cell or next to it, not a huge one
    let riv = 0;
    if (p.rkind[i] === 1) riv = p.flow[i];
    for (let k = 0; k < 8; k++) { const j = T8[i * 8 + k]; if (j >= 0 && p.rkind[j] === 1 && p.flow[j] > riv) riv = p.flow[j]; }
    if (!riv) continue;
    let s = 10;
    s -= Math.abs(T - 12) * 0.6;
    s -= Math.abs(P - 900) / 250;
    s -= riv > 60 ? (riv - 60) / 40 : riv < 2 ? 2 : 0;
    s -= p.relief[i] * 8;
    s += p.biome[i] === BIOME.TEMPERATE_FOREST ? 1 : p.biome[i] === BIOME.FLOODPLAIN ? 0.6 : 0;
    s -= p.dOcean[i] < 3 ? 2 : p.dOcean[i] > 40 ? (p.dOcean[i] - 40) / 20 : 0;
    score[i] = s;
  }
  return score;
}

export function findSpawn(p, k = 0) {
  const score = p._spawnScore || (p._spawnScore = spawnScores(p));
  const order = [];
  for (let i = 0; i < score.length; i++) if (score[i] > -1e8) order.push(i);
  order.sort((a, b) => score[b] - score[a] || a - b);
  const picked = [];
  for (const c of order) {
    if (picked.some((q) => { let dx = Math.abs((q % MW) - (c % MW)); if (dx > MW / 2) dx = MW - dx; const dy = ((q / MW) | 0) - ((c / MW) | 0); return dx * dx + dy * dy < MIN_SEP * MIN_SEP; })) continue;
    picked.push(c);
    if (picked.length > k) break;
  }
  const cell = picked[k];
  if (cell === undefined) return null;
  // tile pick inside the cell's chunk
  const tx = (cell % MW) * CELL + CELL / 2, ty = Math.floor(cell / MW) * CELL + CELL / 2;
  const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
  const ch = generateChunk(p, cx, cy, { decor: false });
  let best = null, bs = -1e9;
  const S = CHUNK;
  // distance to river water inside the chunk (brute force on a coarse grid)
  const riv = [];
  for (let i = 0; i < S * S; i++) if (ch.water[i] && (ch.flowX[i] || ch.flowY[i])) riv.push(i);
  for (let y = 4; y < S - 4; y += 2) for (let x = 4; x < S - 4; x += 2) {
    const i = y * S + x;
    if (ch.water[i] || ch.rock[i] || ch.biome[i] === BIOME.BEACH) continue;
    const h0 = ch.height[y * (S + 1) + x], h1 = ch.height[y * (S + 1) + x + 1], h2 = ch.height[(y + 1) * (S + 1) + x];
    if (Math.abs(h1 - h0) > 0.3 || Math.abs(h2 - h0) > 0.3) continue;
    let dr = 99;
    for (const r of riv) { const d = Math.hypot((r % S) - x, ((r / S) | 0) - y); if (d < dr) dr = d; }
    let s = -Math.abs(dr - 8) - Math.hypot(x - S / 2, y - S / 2) * 0.05;
    if (ch.fertile[i]) s += 1;
    if (s > bs) { bs = s; best = { x: cx * S + x + 0.5, y: cy * S + y + 0.5 }; }
  }
  if (!best) best = { x: tx + 0.5, y: ty + 0.5 };
  return { ...best, cell, score: score[cell], biome: p.biome[cell], tMean: p.tMean[cell], precip: p.precip[cell] };
}
