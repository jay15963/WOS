// Module worker of the terrain window (src/world/terrainWindow.js): computes the GPU contents of a chunk off the main
// thread from the layers gathered around it (src/world/terrainFill.js, pure).
import { computeTerrain } from './terrainFill.js';

self.onmessage = (e) => {
  const { id, inp } = e.data || {};
  try {
    const out = computeTerrain(inp);
    self.postMessage({ id, out }, [out.tile.buffer, out.field2.buffer, out.cave.buffer, out.clim.buffer, out.field.buffer, out.cold.buffer, out.walls.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
