// Abyss / coast test: node tools/planet-abyss.mjs [seeds=1,7,3] [samples per seed=8]
//  1. macro: no abyssal cell (class 3) closer than ABYSS_D cells to any land;
//  2. macro: no path through non-abyssal water joins two continents (each continent is ringed by abyss);
//  3. tiles: around fjord mouths, cliff coasts, ocean volcano islands, subduction coasts and random coasts, no
//     class-3 tile within MIN_D tiles of a land tile (7 x 7 chunk windows, the central chunk is checked, so every
//     land tile closer than MIN_D is inside the window).
import { generatePlanet, ABYSS_D, COAST } from '../src/world/planet/macro.js';
import { assembleWindow } from '../src/world/planet/window.js';
import { MW, MH, CELL, CHUNK, CHH } from '../src/world/planet/consts.js';

const MIN_D = 150;
const seeds = (process.argv[2] || '1,7,3').split(',').map(Number);
const samples = +(process.argv[3] || 8);
let bad = 0;
for (const seed of seeds) {
  const p = generatePlanet(seed);
  const N = MW * MH;
  // 1
  let near = 0;
  for (let i = 0; i < N; i++) if (p.water[i] === 3 && p.dLand[i] < ABYSS_D) near++;
  // 2: components of land + non-abyssal water
  const comp = new Int32Array(N).fill(-1), st = [];
  let nc = 0;
  for (let s = 0; s < N; s++) {
    if (p.water[s] === 3 || comp[s] >= 0) continue;
    comp[s] = nc; st.push(s);
    while (st.length) {
      const i = st.pop(), x = i % MW, y = (i - x) / MW;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy; if (yy < 0 || yy >= MH) continue;
        const j = yy * MW + ((x + dx + MW) % MW);
        if (p.water[j] !== 3 && comp[j] < 0) { comp[j] = nc; st.push(j); }
      }
    }
    nc++;
  }
  // every land cell carries its continent's territory (the land of one continent + its islands): one territory
  // per non-abyssal component
  const owner = new Map();
  let joined = 0;
  for (let i = 0; i < N; i++) {
    if (p.ocean[i] || p.terr[i] < 0) continue;
    const k = comp[i], t = owner.get(k);
    if (t === undefined) owner.set(k, p.terr[i]);
    else if (t !== p.terr[i]) { joined++; owner.set(k, p.terr[i]); }
  }
  // 3
  const picks = [];
  const pick = (pred, n) => { const list = []; for (let i = 0; i < N; i++) if (pred(i)) list.push(i); for (let k = 0; k < n && list.length; k++) picks.push(list[Math.floor(((k + 0.5) / n) * list.length)]); };
  const coastal = (i) => !p.ocean[i] && [1, -1, MW, -MW].some((d) => p.ocean[i + d]);
  pick((i) => p.rkind[i] === 3 && p.mouthD[i] === 1, 2);
  pick((i) => p.coast[i] === COAST.CLIFF && coastal(i), 2);
  pick((i) => p.cone[i] > 2000 && p.sd[i] < -6, 1);
  pick((i) => (p.bkind[i] === 3 || p.bkind[i] === 2) && coastal(i), 1);
  pick(coastal, Math.max(1, samples - 9));
  pick((i) => p.ocean[i] && p.dLand[i] >= 5 && p.dLand[i] < 6.5, 3); // right at the shelf edge
  let tileBad = 0, abyssTiles = 0;
  for (const c of picks) {
    const tx = (c % MW) * CELL + CELL / 2, ty = Math.floor(c / MW) * CELL + CELL / 2;
    const cx0 = Math.floor(tx / CHUNK) - 3, cy0 = Math.max(0, Math.min(CHH - 7, Math.floor(ty / CHUNK) - 3));
    const win = assembleWindow(p, cx0, cy0, 7, 7, { decor: false });
    const W = win.w, Hh = win.h, d = new Float32Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) d[i] = win.water[i] === 0 ? 0 : 1e9;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x) d[i] = Math.min(d[i], d[i - 1] + 1); if (y) d[i] = Math.min(d[i], d[i - W] + 1, x ? d[i - W - 1] + 1.4142 : 1e9, x < W - 1 ? d[i - W + 1] + 1.4142 : 1e9); }
    for (let y = Hh - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (x < W - 1) d[i] = Math.min(d[i], d[i + 1] + 1); if (y < Hh - 1) d[i] = Math.min(d[i], d[i + W] + 1, x < W - 1 ? d[i + W + 1] + 1.4142 : 1e9, x ? d[i + W - 1] + 1.4142 : 1e9); }
    let here = 0;
    for (let y = 3 * CHUNK; y < 4 * CHUNK; y++) for (let x = 3 * CHUNK; x < 4 * CHUNK; x++) {
      const i = y * W + x;
      if (win.water[i] !== 3) continue;
      abyssTiles++;
      if (d[i] < MIN_D) { tileBad++; here++; }
    }
    if (here) console.log(`  ${here} abyssal tiles too close to land near tile ${tx},${ty} (cell ${c}: elev ${Math.round(p.elev[c])} cone ${Math.round(p.cone[c])} dLand ${p.dLand[c].toFixed(1)})`);
  }
  console.log(`seed ${seed}: macro abyss < ${ABYSS_D} cells from land: ${near} · continents joined by shallow/deep water: ${joined} · tile windows ${picks.length}: ${tileBad} abyssal tiles < ${MIN_D} tiles from land (of ${abyssTiles} checked) · land ${p.stats.land}%`);
  bad += near + joined + tileBad;
}
console.log(bad ? `FAIL (${bad})` : 'ok');
process.exit(bad ? 1 : 0);
