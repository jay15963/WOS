// Tile-scale closeups for tools/planet-shots.mjs: zoom:<x>,<y>,<size>[,<name>] or auto (finds features).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleWindow } from '../src/world/planet/window.js';
import { renderTileWindow } from '../src/world/planet/render.js';
import { CHUNK, MW, MH, CELL } from '../src/world/planet/consts.js';
import { BIOME } from '../src/world/planet/biomes.js';
import { COAST, FLAG } from '../src/world/planet/macro.js';
import { findSpawn } from '../src/world/planet/spawn.js';

export function shotWindow(planet, x, y, size, name, outDir, { png }) {
  const n = Math.max(1, Math.round(size / CHUNK));
  const cx0 = Math.floor(x / CHUNK) - (n >> 1), cy0 = Math.max(0, Math.min(MH * CELL / CHUNK - n, Math.floor(y / CHUNK) - (n >> 1)));
  const t0 = performance.now();
  const win = assembleWindow(planet, cx0, cy0, n, n, { decor: false });
  const t1 = performance.now();
  const scale = n * CHUNK <= 256 ? 4 : n * CHUNK <= 512 ? 2 : 1;
  const img = renderTileWindow(win, scale, { features: true });
  writeFileSync(join(outDir, `planet_zoom_${name}.png`), png(img.data, img.w, img.h));
  const avg = win.chunkMs.reduce((a, b) => a + b, 0) / win.chunkMs.length;
  console.log(`zoom ${name} @${x},${y}: ${n * n} chunks in ${Math.round(t1 - t0)} ms (avg ${avg.toFixed(1)} ms/chunk), ${win.objects.length} objects, ${win.features.length} features`);
  return win;
}

// first macro cell matching pred (in a hashed order so different seeds give different spots)
function findCell(planet, pred) {
  let best = -1, bestH = 2 ** 32;
  for (let i = 0; i < MW * MH; i++) {
    if (!pred(i)) continue;
    const h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    if (h < bestH) { bestH = h; best = i; }
  }
  return best;
}
const tx = (i) => (i % MW) * CELL + CELL / 2, ty = (i) => Math.floor(i / MW) * CELL + CELL / 2;

export async function run(planet, what, outDir, enc) {
  if (what.startsWith('zoom:')) {
    const [x, y, size, name] = what.slice(5).split(',');
    shotWindow(planet, +x, +y, +(size || 256), name || `${x}_${y}`, outDir, enc);
    return;
  }
  if (what !== 'auto') return;
  const P = planet;
  const finds = {
    canyon: (i) => P.rkind[i] && P.canyon[i] > 0.6 && P.flow[i] > 3,
    cliffs: (i) => P.coast[i] === COAST.CLIFF && !P.ocean[i] && P.elev[i] > 60 && [1, -1, MW, -MW].some((d) => P.ocean[i + d]),
    lagoon: (i) => P.coast[i] === COAST.LAGOON && !P.ocean[i] && [1, -1, MW, -MW].some((d) => P.ocean[i + d]),
    delta: (i) => P.deltas.length && P.deltas.some((d) => d.cell === i),
    fjord: (i) => P.rkind[i] === 3 && P.mouthD[i] === 1,
    mountains: (i) => P.mtn[i] > 0.75 && P.relief[i] > 0.4,
    dunes: (i) => P.biome[i] === BIOME.DESERT_DUNES && P.relief[i] < 0.05,
    river: (i) => P.rkind[i] === 1 && P.flow[i] > 30 && P.flow[i] < 200 && !P.ocean[P.down[i]],
    volcano: (i) => P.flags[i] & FLAG.VOLCANIC && P.cone[i] > 1500,
    lakes: (i) => P.flags[i] & FLAG.LAKES && !P.lakeId[i],
  };
  for (const [name, pred] of Object.entries(finds)) {
    const c = findCell(P, pred);
    if (c < 0) { console.log('no', name); continue; }
    shotWindow(P, tx(c), ty(c), name === 'river' || name === 'mountains' ? 512 : 256, name, outDir, enc);
  }
  const sp = findSpawn(P);
  if (sp) shotWindow(P, sp.x, sp.y, 512, 'spawn', outDir, enc);
}
