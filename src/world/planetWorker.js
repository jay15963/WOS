// Module worker: the planet's macro map (src/world/planet generatePlanet, ~2 s) made off the main thread at boot
// (planetSource.js); the typed arrays come back transferred.
import { generatePlanet } from './planet/index.js';

self.onmessage = (e) => {
  try {
    const planet = generatePlanet(e.data.seed);
    const tr = [];
    for (const k in planet) { const v = planet[k]; if (ArrayBuffer.isView(v) && !tr.includes(v.buffer)) tr.push(v.buffer); }
    self.postMessage({ planet }, tr);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
