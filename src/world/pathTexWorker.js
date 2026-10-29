// Module worker: paints the path material layers off the main thread (src/world/pathTex.js).
import { generatePathLayers } from './pathTex.js';

self.onmessage = () => {
  const layers = generatePathLayers();
  self.postMessage(layers, layers.map((l) => l.buffer));
};
