// Caches the packed sprite atlas (PNG + sprite metadata) in IndexedDB so later boots skip painting.
// Cache key = ART_ID, a hash of the art module graph stamped into src/version.js by tools/stamp.mjs — the
// identity of the code that is actually RUNNING (never sources fetched at runtime, which could be newer than
// the running modules while the service worker revalidates and poison the cache with an old atlas).
// A stored record carries { key, artId, buildId, placeholders, meta, blob }; a hit is validated by the caller
// (artId, no placeholders, every required sprite present — see game/artcompat.js checkAtlas) and discarded
// when invalid. An atlas with painter failures or placeholders is NEVER stored.
// Disabled on localhost (art iteration; force with ?cache) and with ?nocache.
// NOTE for art code: modules must not rely on state computed while painting (it is skipped on a hit).

import { Atlas } from './atlas.js';
import { ART_ID, BUILD_ID } from '../version.js';

const DB = 'wos-atlas', STORE = 'atlas', TAG = 'a2';
const QS = new URLSearchParams(location.search);
export const ATLAS_CACHE_ENABLED = typeof indexedDB !== 'undefined' && !QS.has('nocache')
  && (QS.has('cache') || !/^(localhost|127\.|\[::1\])/.test(location.hostname));
const KEY = `${TAG}-${ART_ID}`;

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// Start early (in parallel with world generation). Resolves to { key, atlas|null, why? }.
export function startAtlasLookup() {
  if (!ATLAS_CACHE_ENABLED) return Promise.resolve({ key: null, atlas: null });
  return (async () => {
    try {
      const db = await openDB();
      const v = await new Promise((res) => {
        const g = db.transaction(STORE, 'readonly').objectStore(STORE).get('main');
        g.onsuccess = () => res(g.result); g.onerror = () => res(null);
      });
      db.close();
      if (!v) return { key: KEY, atlas: null };
      if (v.key !== KEY || v.artId !== ART_ID || !v.blob || !v.meta) return { key: KEY, atlas: null, why: 'outra versão da arte' };
      if (v.placeholders?.length) return { key: KEY, atlas: null, why: 'atlas guardado tinha substitutos: ' + v.placeholders.slice(0, 6).join(', ') };
      const bmp = await createImageBitmap(v.blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      const atlas = Atlas.fromCache(v.meta, c);
      atlas.failures = [];
      atlas.placeholders = [];
      atlas.fromCache = true;
      return { key: KEY, atlas };
    } catch (e) {
      console.warn('[atlas cache] lookup failed', e);
      return { key: null, atlas: null };
    }
  })();
}

// returns false (and stores nothing) for an atlas that must not be reused
export function storeAtlas(key, atlas, delay = 4000) {
  if (!ATLAS_CACHE_ENABLED || !key) return false;
  if (atlas.failures?.length || atlas.placeholders?.length) return false;
  setTimeout(() => {
    try {
      atlas.canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          const db = await openDB();
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ key, artId: ART_ID, buildId: BUILD_ID, placeholders: [], meta: atlas.serialize(), blob }, 'main');
          tx.oncomplete = () => db.close();
          tx.onerror = () => db.close();
        } catch { /* ignore */ }
      }, 'image/png');
    } catch { /* ignore */ }
  }, delay);
  return true;
}

export async function clearAtlasCache() {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDB();
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('main');
      tx.oncomplete = res; tx.onerror = res;
    });
    db.close();
  } catch { /* ignore */ }
}
