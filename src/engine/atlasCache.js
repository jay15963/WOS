// Caches the packed sprite atlas (PNG + sprite metadata) in IndexedDB so later boots skip painting.
// Cache key = hash of the source text of every module reachable from src/art/sprites.js, so any
// art change invalidates it. Disabled on localhost (art iteration; force with ?cache) and with ?nocache.
// NOTE for art code: modules must not rely on state computed while painting (it is skipped on a hit).

import { Atlas } from './atlas.js';

const DB = 'wos-atlas', STORE = 'atlas', TAG = 'a1';
const QS = new URLSearchParams(location.search);
const ENABLED = typeof indexedDB !== 'undefined' && !QS.has('nocache')
  && (QS.has('cache') || !/^(localhost|127\.|\[::1\])/.test(location.hostname));

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// Breadth-first over relative imports, one parallel fetch per level (files are in the HTTP cache).
async function sourceHash(entry) {
  const seen = new Set();
  const texts = new Map();
  let level = [new URL(entry, location.href).href];
  while (level.length) {
    level = level.filter((u) => !seen.has(u));
    level.forEach((u) => seen.add(u));
    const srcs = await Promise.all(level.map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.text(); })));
    const next = [];
    srcs.forEach((src, i) => {
      texts.set(level[i], src);
      for (const m of src.matchAll(/(?:import|export)\s[^'";]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) next.push(new URL(m[1], level[i]).href);
    });
    level = next;
  }
  let h = 2166136261 >>> 0;
  for (const u of [...texts.keys()].sort()) {
    const s = u + texts.get(u);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return `${TAG}-${h.toString(36)}-${texts.size}`;
}

// Start early (in parallel with world generation). Resolves to { key, atlas|null }.
export function startAtlasLookup(entry = './src/art/sprites.js') {
  if (!ENABLED) return Promise.resolve({ key: null, atlas: null });
  return (async () => {
    try {
      const key = await sourceHash(entry);
      const db = await openDB();
      const v = await new Promise((res) => {
        const g = db.transaction(STORE, 'readonly').objectStore(STORE).get('main');
        g.onsuccess = () => res(g.result); g.onerror = () => res(null);
      });
      db.close();
      if (!v || v.key !== key || !v.blob || !v.meta) return { key, atlas: null };
      const bmp = await createImageBitmap(v.blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      return { key, atlas: Atlas.fromCache(v.meta, c) };
    } catch (e) {
      console.warn('[atlas cache] lookup failed', e);
      return { key: null, atlas: null };
    }
  })();
}

export function storeAtlas(key, atlas, delay = 4000) {
  if (!ENABLED || !key) return;
  setTimeout(() => {
    try {
      atlas.canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          const db = await openDB();
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ key, meta: atlas.serialize(), blob }, 'main');
          tx.oncomplete = () => db.close();
          tx.onerror = () => db.close();
        } catch { /* ignore */ }
      }, 'image/png');
    } catch { /* ignore */ }
  }, delay);
}
