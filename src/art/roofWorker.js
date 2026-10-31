// Module worker: paints roof regions off the main thread (src/art/roofRaster.js; camera rotation: src/art/roofFacets.js).
// Message { id, spec, mode } (mode bit 1: the north-view art, bit 2: the turned art — default 1) → { id, art, tart }
// with the pixel buffers transferred. Cosmetic only.

import { rasterRegion } from './roofRaster.js';
import { rasterTurned } from './roofFacets.js';

self.onmessage = (ev) => {
  const { id, spec, mode = 1 } = ev.data || {};
  try {
    const art = mode & 1 ? rasterRegion(spec) : null;
    const tart = mode & 2 ? rasterTurned(spec) : null;
    const tr = [];
    if (art) tr.push(art.color.buffer, art.owner.buffer, art.src.buffer);
    if (tart) tr.push(tart.color.buffer);
    self.postMessage({ id, art, tart }, tr);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
