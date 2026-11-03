// Assemble a rectangle of chunks into one tile window (preview tools, the in-game ?planet=1 world).
// The streaming engine does not need this: it consumes generateChunk directly.

import { CHUNK, CW, CHH } from './consts.js';
import { generateChunk } from './chunk.js';

// window of nx x ny chunks with its top-left chunk at (cx0, cy0) (cx wraps). Object / decor / feature
// coordinates are relative to the window. opts.decor / opts.objects passed to generateChunk.
export function assembleWindow(planet, cx0, cy0, nx, ny, opts = {}) {
  const w = nx * CHUNK, h = ny * CHUNK, n = w * h;
  const out = {
    w, h, cx0, cy0, x0: cx0 * CHUNK, y0: cy0 * CHUNK,
    height: new Float32Array((w + 1) * (h + 1)),
    ground: new Uint8Array(n), water: new Uint8Array(n), biome: new Uint8Array(n), rock: new Uint8Array(n), rockType: new Uint8Array(n),
    ore: new Uint8Array(n), flowX: new Float32Array(n), flowY: new Float32Array(n), wlevel: new Float32Array(n), fertile: new Uint8Array(n), lush: new Uint8Array(n),
    objects: [], decor: [], features: [], ms: 0, chunkMs: [],
  };
  const layers = ['ground', 'water', 'biome', 'rock', 'rockType', 'ore', 'flowX', 'flowY', 'wlevel', 'fertile', 'lush'];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = (((cx0 + i) % CW) + CW) % CW, cy = cy0 + j;
    if (cy < 0 || cy >= CHH) continue;
    const ch = generateChunk(planet, cx, cy, opts);
    out.ms += ch.ms; out.chunkMs.push(ch.ms);
    const ox = i * CHUNK, oy = j * CHUNK;
    for (const L of layers) {
      const src = ch[L], dst = out[L];
      for (let y = 0; y < CHUNK; y++) dst.set(src.subarray(y * CHUNK, (y + 1) * CHUNK), (oy + y) * w + ox);
    }
    for (let y = 0; y <= CHUNK; y++) for (let x = 0; x <= CHUNK; x++) out.height[(oy + y) * (w + 1) + ox + x] = ch.height[y * (CHUNK + 1) + x];
    for (const o of ch.objects) { o.x += ox; o.y += oy; out.objects.push(o); }
    for (const d of ch.decor) { d.x += ox; d.y += oy; out.decor.push(d); }
    for (const f of ch.features) { f.x += ox; f.y += oy; out.features.push(f); }
  }
  return out;
}
