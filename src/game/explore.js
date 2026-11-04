// Explored chunks of the local player (docs/STREAMING.md "Mapa"): the fog of war of the planet map (ui/minimap.js).
// game.explored = Uint8Array(256 × 128 chunks), 1 = seen; marked every second around the local player (the streamer
// system), saved with the player (save.js: a packed 4 KB bitset in base64) — each player its own, host or guest.

// chunks seen by the local player (planet: 256 × 128 chunks, 1 = explored): marked every second within EXPLORE_R chunks
export const EXPLORE_R = 2;
export function markExplored(game) {
  const w = game.world, p = game.player;
  if (!w.wrap || !p) return;
  const E = game.explored || (game.explored = new Uint8Array(32768));
  const pcx = Math.floor(p.x / 64), pcy = Math.floor(p.y / 64);
  for (let dy = -EXPLORE_R; dy <= EXPLORE_R; dy++) for (let dx = -EXPLORE_R; dx <= EXPLORE_R; dx++) {
    const cy = pcy + dy;
    if (cy < 0 || cy >= 128) continue;
    const c = cy * 256 + ((pcx + dx) & 255);
    if (!E[c]) { E[c] = 1; game._exploredV = (game._exploredV || 0) + 1; }
  }
}
// packed (base64 of a 4 KB bitset) for the save, and back
export function packExplored(E) {
  if (!E) return undefined;
  const b = new Uint8Array(4096);
  let any = false;
  for (let c = 0; c < 32768; c++) if (E[c]) { b[c >> 3] |= 1 << (c & 7); any = true; }
  if (!any) return undefined;
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function unpackExplored(str) {
  const E = new Uint8Array(32768);
  try {
    const s = atob(str);
    for (let i = 0; i < Math.min(4096, s.length); i++) { const v = s.charCodeAt(i); if (v) for (let k = 0; k < 8; k++) if (v & (1 << k)) E[i * 8 + k] = 1; }
  } catch { /* unreadable: nothing explored */ }
  return E;
}
