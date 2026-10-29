// Module worker: paints roof regions off the main thread (src/art/roofRaster.js). Message { id, spec } →
// { id, art } with the pixel buffers transferred. Cosmetic only.

import { rasterRegion } from './roofRaster.js';

self.onmessage = (ev) => {
  const { id, spec } = ev.data || {};
  try {
    const art = rasterRegion(spec);
    self.postMessage({ id, art }, [art.color.buffer, art.owner.buffer, art.src.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
