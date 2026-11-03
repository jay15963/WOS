// Worker for tools/planet.html: generates the planet, renders the preview layers and tile windows off the
// main thread. Messages: { id, type: 'gen'|'layer'|'detail'|'tiles'|'probe'|'drop', ... } -> { id, ... }.
import { generatePlanet } from '../src/world/planet/macro.js';
import { renderMacro, renderDetail, renderTileWindow } from '../src/world/planet/render.js';
import { assembleWindow } from '../src/world/planet/window.js';
import { findSpawn } from '../src/world/planet/spawn.js';
import { macroAt, baseHeight } from '../src/world/planet/chunk.js';
import { BIOME_LIST } from '../src/world/planet/biomes.js';
import { CHUNK, MW, MH, CELL, latitudeAt, seasonZoneOf, SEASON_ZONES_PT, metersToStories } from '../src/world/planet/consts.js';
import { COAST_PT } from '../src/world/planet/macro.js';

let planet = null;
const reply = (id, msg, transfer = []) => postMessage({ id, ...msg }, transfer);

onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'gen') {
      const t0 = performance.now();
      planet = generatePlanet(m.seed);
      const ms = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const sp = findSpawn(planet);
      const spMs = Math.round(performance.now() - t1);
      const bytes = Object.values(planet).reduce((a, v) => a + (v && v.byteLength ? v.byteLength : 0), 0);
      // fingerprint of the macro data: compare it between browsers / peers (must be identical)
      let h = 2166136261;
      for (const a of [planet.elev, planet.biome, planet.flow]) { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619); }
      reply(m.id, { ms, spMs, timings: planet.timings, stats: planet.stats, spawn: sp, mb: Math.round(bytes / 1048576 * 10) / 10, hash: (h >>> 0).toString(16) });
    } else if (m.type === 'layer') {
      const t0 = performance.now();
      const img = renderMacro(planet, m.name);
      reply(m.id, { data: img, w: MW, h: MH, ms: Math.round(performance.now() - t0) }, [img.buffer]);
    } else if (m.type === 'detail') {
      const t0 = performance.now();
      const img = renderDetail(planet, m.w || 2048, m.h || 1024);
      reply(m.id, { data: img.data, w: img.w, h: img.h, ms: Math.round(performance.now() - t0) }, [img.data.buffer]);
    } else if (m.type === 'tiles') {
      const n = Math.max(1, Math.round(m.size / CHUNK));
      const cx0 = Math.floor(m.x / CHUNK) - (n >> 1), cy0 = Math.max(0, Math.min(MH * CELL / CHUNK - n, Math.floor(m.y / CHUNK) - (n >> 1)));
      const t0 = performance.now();
      const win = assembleWindow(planet, cx0, cy0, n, n, { decor: false });
      const genMs = Math.round(performance.now() - t0);
      const img = renderTileWindow(win, m.scale || (n * CHUNK <= 256 ? 4 : 2), { features: true });
      const bc = {};
      for (let i = 0; i < win.w * win.h; i++) { const k = BIOME_LIST[win.biome[i]].pt; bc[k] = (bc[k] || 0) + 1; }
      const biomes = Object.entries(bc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round((v / (win.w * win.h)) * 100)}%`);
      let hmin = 1e9, hmax = -1e9;
      for (const h of win.height) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
      const feats = {};
      for (const f of win.features) feats[f.t] = (feats[f.t] || 0) + 1;
      reply(m.id, { data: img.data, w: img.w, h: img.h, x0: win.x0, y0: win.y0, tiles: win.w, genMs, chunks: n * n, perChunk: Math.round((win.ms / (n * n)) * 10) / 10, objects: win.objects.length, biomes, hmin, hmax, feats }, [img.data.buffer]);
    } else if (m.type === 'probe') {
      const o = {};
      const h = baseHeight(planet, m.x + 0.5, m.y + 0.5, o);
      macroAt(planet, m.x + 0.5, m.y + 0.5, o);
      const c = o.cell;
      reply(m.id, {
        x: m.x, y: m.y, lat: Math.round(latitudeAt(m.y) * 10) / 10, elev: Math.round(o.e + o.cone), stories: Math.round(h * 10) / 10,
        T: Math.round(o.T * 10) / 10, P: Math.round(o.P), zone: SEASON_ZONES_PT[seasonZoneOf(o.T, o.tAmp)], biome: BIOME_LIST[planet.biome[c]].pt,
        coast: COAST_PT[planet.coast[c]] || '', water: ['terra', 'raso', 'mar', 'abissal', 'lago'][planet.water[c]], plate: planet.plate[c], storiesMacro: Math.round(metersToStories(planet.elev[c]) * 10) / 10,
      });
    } else if (m.type === 'drop') {
      planet = null;
      reply(m.id, {});
    }
  } catch (err) {
    reply(m.id, { error: String(err && err.stack || err) });
  }
};
