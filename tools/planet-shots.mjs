// Planet preview PNGs without a browser (node tools/planet-shots.mjs <seed> [outDir] [what...]).
//   what: macro (all macro layers, 2x) | detail (whole planet sampled at 8 tiles/px) |
//         zoom:<x>,<y>,<size>[,<name>] (tile window around tile x,y rendered from generateChunk) |
//         auto (tile closeups of interesting features found on the planet) — default: macro auto
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { generatePlanet } from '../src/world/planet/macro.js';
import { renderMacro, renderDetail, LAYERS } from '../src/world/planet/render.js';

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
export function scaleUp(rgba, w, h, k) {
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
    const s = (((y / k) | 0) * w + ((x / k) | 0)) * 4, o = (y * w * k + x) * 4;
    out[o] = rgba[s]; out[o + 1] = rgba[s + 1]; out[o + 2] = rgba[s + 2]; out[o + 3] = 255;
  }
  return out;
}

const isMain = process.argv[1] && process.argv[1].endsWith('planet-shots.mjs');
if (isMain) {
  const seed = parseInt(process.argv[2] || '1', 10);
  const outDir = process.argv[3] || 'shots';
  const what = process.argv.slice(4);
  if (!what.length) what.push('macro');
  mkdirSync(outDir, { recursive: true });
  const t0 = performance.now();
  const planet = generatePlanet(seed);
  const t1 = performance.now();
  console.log(`planet ${seed}: ${Math.round(t1 - t0)} ms`, JSON.stringify(planet.timings));
  console.log('stats', JSON.stringify(planet.stats));
  const mem = Object.values(planet).reduce((a, v) => a + (v && v.byteLength ? v.byteLength : 0), 0);
  console.log('typed arrays', (mem / 1048576).toFixed(1), 'MB');
  for (const w of what) {
    if (w === 'macro') {
      for (const L of LAYERS) {
        const img = renderMacro(planet, L);
        writeFileSync(join(outDir, `planet_${L}_${seed}.png`), png(scaleUp(img, 512, 256, 2), 1024, 512));
      }
      console.log('macro layers written');
    } else if (w === 'detail') {
      const t = performance.now();
      const img = renderDetail(planet, 2048, 1024);
      writeFileSync(join(outDir, `planet_detail_${seed}.png`), png(img.data, img.w, img.h));
      console.log('detail', Math.round(performance.now() - t), 'ms');
    } else {
      const m = await import('./planet-shots-tiles.mjs');
      await m.run(planet, w, outDir, { png, scaleUp });
    }
  }
}
