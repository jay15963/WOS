// Module worker of the terrain window (src/world/terrainWindow.js): computes the GPU contents of a chunk off the main
// thread from the layers gathered around it (src/world/terrainFill.js, pure).
import { computeTerrain } from './terrainFill.js';
import { computeFine, fineTex } from './heightPaged.js';

const FS = 256; // fine samples per chunk side (64 tiles × SUB)

self.onmessage = (e) => {
  const { id, inp } = e.data || {};
  try {
    const out = computeTerrain(inp);
    const tr = [out.tile.buffer, out.field2.buffer, out.cave.buffer, out.clim.buffer, out.field.buffer, out.cold.buffer, out.walls.buffer];
    if (inp.hgt) { // terrain heights: the chunk's fine page + its GPU contents (heightPaged.js)
      const { C, X0, Y0 } = inp.hgt, F = C ? computeFine(C, X0, Y0) : null;
      out.fine = F;
      out.hgt = new Float32Array(FS * FS); out.hgtG = new Uint16Array(FS * FS * 4);
      fineTex(F, out.hgt, out.hgtG);
      tr.push(out.hgt.buffer, out.hgtG.buffer);
      if (F) tr.push(F.f.buffer, F.slope.buffer, F.cliff.buffer);
    }
    self.postMessage({ id, out }, tr);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
