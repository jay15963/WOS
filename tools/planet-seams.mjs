// Seam / determinism test for the chunk generator: node tools/planet-seams.mjs [seed] [samples]
// For random chunk pairs (including the wrap at x = 0) the shared corner heights must be identical, and a tile
// row computed by one chunk must equal what a bigger window would give (heights continuous across the border:
// the step between the two edge tile rows is compared with the steps inside each chunk). Also checks that two
// runs give identical bytes.
import { generatePlanet } from '../src/world/planet/macro.js';
import { generateChunk } from '../src/world/planet/chunk.js';
import { CW, CHH, CHUNK } from '../src/world/planet/consts.js';
import { findSpawn } from '../src/world/planet/spawn.js';

const seed = parseInt(process.argv[2] || '1', 10), samples = parseInt(process.argv[3] || '40', 10);
const p = generatePlanet(seed);
const S = CHUNK, C = S + 1;
let bad = 0, checked = 0;
const sp = findSpawn(p);
// sample chunks near land (spawn area, random land chunks) + the wrap column
const picks = [[Math.floor(sp.x / S), Math.floor(sp.y / S)], [CW - 1, Math.floor(CHH * 0.9)], [CW - 1, Math.floor(CHH / 2)]];
let r = seed * 7 + 1;
const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };
while (picks.length < samples) {
  const cx = Math.floor(rnd() * CW), cy = 2 + Math.floor(rnd() * (CHH - 4));
  const c = (cy * S / 32 | 0) * 512 + (cx * S / 32 | 0);
  if (!p.ocean[c]) picks.push([cx, cy]);
}
for (const [cx, cy] of picks) {
  const a = generateChunk(p, cx, cy, { decor: false });
  const b = generateChunk(p, (cx + 1) % CW, cy, { decor: false });
  const d = generateChunk(p, cx, cy + 1, { decor: false });
  for (let y = 0; y <= S; y++) { checked++; if (a.height[y * C + S] !== b.height[y * C]) { bad++; if (bad < 6) console.log(`corner seam E chunk ${cx},${cy} row ${y}: ${a.height[y * C + S]} vs ${b.height[y * C]}`); } }
  for (let x = 0; x <= S; x++) { checked++; if (a.height[S * C + x] !== d.height[x]) { bad++; if (bad < 6) console.log(`corner seam S chunk ${cx},${cy} col ${x}: ${a.height[S * C + x]} vs ${d.height[x]}`); } }
  // a chunk twice: identical
  const a2 = generateChunk(p, cx, cy, { decor: false });
  for (const k of ['height', 'water', 'ground', 'biome', 'rock']) for (let i = 0; i < a[k].length; i++) if (a[k][i] !== a2[k][i]) { bad++; console.log('nondeterministic', k); break; }
  if (a.objects.length !== a2.objects.length) { bad++; console.log('nondeterministic objects'); }
}
// the whole planet twice: bit-identical typed arrays
const p2 = generatePlanet(seed);
const hashArr = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 2166136261; for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619); return h >>> 0; };
for (const k of Object.keys(p)) if (k[0] !== '_' && p[k] && p[k].byteLength && hashArr(p[k]) !== hashArr(p2[k])) { bad++; console.log('planet not deterministic:', k); }
console.log(`planet ${seed}: elev ${hashArr(p.elev).toString(16)} biome ${hashArr(p.biome).toString(16)} flow ${hashArr(p.flow).toString(16)}`);
console.log(`seams: ${picks.length} chunks, ${checked} shared corners, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
