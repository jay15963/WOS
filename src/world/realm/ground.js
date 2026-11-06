// The settlements and roads in the ground of a chunk (docs/REINOS.md "Implementação — geração"): applied to the planet's
// generated chunk (generateChunk output, chunk-relative coordinates) before it becomes the engine's ChunkData
// (planetSource.adaptChunk), in the chunk workers and the main thread alike — a pure function of (planet, cx, cy).
//   - settlements: the town ground (smooth, flat lots — layout.js grid th / tw per corner), dry and rock-free land in the
//     town (F_DRY), no natural objects on lots / streets / fields (F_CLEAR), field crops in rows (F_FIELD), paved streets;
//   - roads: painted along the realm's road polylines (main roads gravel, others dirt), trees / rock cleared off them, a
//     river crossed by a ford (the water there becomes shallow: wade across).
// Returns the chunk's road layer (Uint8Array(4096): path type per tile, 0 none — content/paths.js ids) or null.

import { realmIndex, BLEND } from './realm.js';
import { settlementLayout, F_CLEAR, F_DRY, F_FIELD, CROPS } from './layout.js';

const S = 64, N1 = 65;
const ID_PER_CHUNK = 16384, CROP_ID0 = 13000, CROP_MAX = 3000; // (crop object ids: (cy·256 + cx)·16384 + 13000 + k)
const PW = 16384;
// a settlement's field plant (its worldgen id: the planet's own objects of a chunk take 1..4096 — game/fields.js)
export const isFieldCropId = (id) => typeof id === 'number' && id >= 0 && id % ID_PER_CHUNK >= CROP_ID0 && id % ID_PER_CHUNK < CROP_ID0 + CROP_MAX;
// the planted rows of a field (world tile row ty): every third row stays bare (the furrows)
export const fieldRow = (ty) => ((ty % 3) + 3) % 3 !== 2;

export function applyRealm(planet, p, cx, cy) {
  const realm = planet?.realm;
  if (!realm) return null;
  const e = realmIndex(realm).get(cy * 256 + cx);
  if (!e) return null;
  const X0 = cx * S, Y0 = cy * S;
  let road = null;
  const R = () => road || (road = new Uint8Array(S * S));
  const clear = new Uint8Array(S * S); // tiles where no natural object stays
  const crops = [];
  // ---------- settlements ----------
  for (const sid of e.s) {
    const L = settlementLayout(planet, realm, sid), G = L.grid, W1 = G.w + 1;
    // (the settlement's grid near this chunk: x continuous across the seam — settlements never sit on it, but be safe)
    let gx0 = X0 - G.x0;
    if (gx0 > PW / 2) gx0 -= PW; else if (gx0 < -PW / 2) gx0 += PW;
    const gy0 = Y0 - G.y0;
    if (gx0 > G.w || gy0 > G.h || gx0 + S < 0 || gy0 + S < 0) continue;
    // corners: the town ground blended over the generated one
    const H = p.height;
    if (H) for (let y = 0; y < N1; y++) {
      const gy = gy0 + y;
      if (gy < 0 || gy > G.h) continue;
      for (let x = 0; x < N1; x++) {
        const gx = gx0 + x;
        if (gx < 0 || gx > G.w) continue;
        const k = gy * W1 + gx, w = G.tw[k];
        if (!w) continue;
        const o = y * N1 + x;
        H[o] = Math.round((H[o] + (G.th[k] - H[o]) * w) * 1024) / 1024;
      }
    }
    // tiles
    for (let y = 0; y < S; y++) {
      const gy = gy0 + y;
      if (gy < 0 || gy >= G.h) continue;
      for (let x = 0; x < S; x++) {
        const gx = gx0 + x;
        if (gx < 0 || gx >= G.w) continue;
        const k = gy * G.w + gx, f = G.flag[k], l = y * S + x;
        if (f & F_DRY) dry(p, l, realm, planet, L);
        if (f & F_CLEAR) clear[l] = 1;
        if (G.pave[k]) R()[l] = G.pave[k];
        if (f & F_FIELD) {
          clear[l] = 1;
          const c = f >> 4;
          // crops in rows (every tile of the field, a gap row every third: the furrows)
          if (c && fieldRow(Y0 + y)) crops.push([CROPS[c], x, y]);
        }
      }
    }
  }
  // ---------- roads (outside the settlements' cores) ----------
  if (e.r.length) {
    const cores = e.s.map((sid) => realm.settlements[sid]);
    for (const [rid, i0, i1] of e.r) {
      const Rd = realm.roads[rid], P = Rd.pts, half = Rd.w / 2, t = Rd.main ? 2 : 1;
      for (let k = i0; k <= i1; k++) {
        let ax = P[k * 2], ay = P[k * 2 + 1], bx = P[k * 2 + 2], by = P[k * 2 + 3];
        // (into this chunk's frame: x continuous)
        const sh = ax - X0 > PW / 2 ? -PW : X0 - ax > PW / 2 ? PW : 0;
        ax += sh - X0; bx += sh - X0; ay -= Y0; by -= Y0;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1)), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx) + half + 1));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1)), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by) + half + 1));
        const vx = bx - ax, vy = by - ay, LL = vx * vx + vy * vy;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          let u = LL > 0 ? ((px - ax) * vx + (py - ay) * vy) / LL : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = ax + vx * u - px, dy = ay + vy * u - py;
          if (dx * dx + dy * dy > half * half) continue;
          // not inside a settlement's core (its own streets lead there)
          let inCore = false;
          for (const s of cores) { const ddx = X0 + px - s.x, ddy = Y0 + py - s.y; if (ddx * ddx + ddy * ddy < (s.r + 5) * (s.r + 5)) { inCore = true; break; } }
          if (inCore) continue;
          const l = y * S + x;
          if (p.water[l] >= 3) continue; // (never across the open sea)
          if (p.water[l]) { p.water[l] = 1; } // a ford: shallow water, waded across
          if (p.rock[l]) { p.rock[l] = 0; p.ore[l] = 0; if (p.ground[l] === 6) p.ground[l] = 3; }
          const r = R();
          if (r[l] < t) r[l] = t;
          clear[l] = 1;
        }
      }
    }
  }
  // ---------- natural objects / decor off the cleared tiles, field crops on ----------
  const off = (o) => { const x = Math.floor(o.x), y = Math.floor(o.y - 0.05); return x >= 0 && y >= 0 && x < S && y < S && clear[y * S + x]; };
  if (p.objects) p.objects = p.objects.filter((o) => !off(o));
  if (p.decor) p.decor = p.decor.filter((d) => { const x = Math.floor(d.x), y = Math.floor(d.y); return !(x >= 0 && y >= 0 && x < S && y < S && (clear[y * S + x] || (road && road[y * S + x]))); });
  if (crops.length && p.objects) {
    const base = (cy * 256 + cx) * ID_PER_CHUNK + CROP_ID0;
    crops.forEach(([type, x, y], k) => { if (k < CROP_MAX) p.objects.push({ id: base + k, type, v: (x * 7 + y * 13) & 3, x: x + 0.5, y: y + 0.85, s: 1, f: (x + y) & 1 ? 1 : -1 }); });
  }
  return road;
}

// a town tile: dry land (no water, no rock), the ground of the place
function dry(p, l, realm, planet, L) {
  if (p.water[l]) {
    p.water[l] = 0;
    if (p.wlevel) p.wlevel[l] = 0;
    if (p.flowX) { p.flowX[l] = 0; p.flowY[l] = 0; }
    p.biome[l] = townBiome(planet, L);
    p.ground[l] = 0;
    if (p.lush) p.lush[l] = 150;
  }
  if (p.rock[l]) { p.rock[l] = 0; p.ore[l] = 0; if (p.ground[l] === 6) p.ground[l] = 0; }
}
const TB = new WeakMap();
function townBiome(planet, L) {
  let m = TB.get(planet);
  if (!m) TB.set(planet, (m = new Map()));
  let b = m.get(L.sid);
  if (b == null) { const s = planet.realm.settlements[L.sid]; b = planet.biome[s.cell]; m.set(L.sid, b); }
  return b;
}
export { BLEND };
