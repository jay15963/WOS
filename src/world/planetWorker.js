// Module worker: the planet's macro map (src/world/planet generatePlanet, ~2 s) made off the main thread at boot
// (planetSource.js); the planet goes back first (cloned: this worker keeps its copy), then the painted map of the whole
// planet for the big map (planet/render.js renderDetail: relief, biomes, coasts, rivers and lakes; ~2.5 s, 2048 × 1024 =
// 8 tiles a pixel), transferred.
import { generatePlanet } from './planet/index.js';
import { renderDetail } from './planet/render.js';

self.onmessage = (e) => {
  let planet;
  try {
    planet = generatePlanet(e.data.seed);
    self.postMessage({ planet });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
    return;
  }
  if (!e.data.map) return;
  try {
    const w = 2048, h = 1024, rgba = renderDetail(planet, w, h, { riverBoost: 1.6 }).data;
    self.postMessage({ map: { w, h, rgba, tpp: 8 } }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({ mapError: String(err && err.message || err) });
  }
};
