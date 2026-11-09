// Planet constants shared by the macro generator, the chunk generator, the preview tools and the
// streaming engine (docs/PLANET.md). Pure data, no DOM.
//
// The world is a flat cylinder: x wraps (W tiles), y runs from the north pole (y = 0) to the south pole
// (y = H - 1). Latitude follows an equal-area mapping (sin(lat) is linear in y), so each climate band gets
// the same share of tiles a real sphere gives it (tropics ~40 %, polar caps ~8 %).

export const W = 16384;          // planet width in tiles (wraps)
export const H = 8192;           // planet height in tiles (pole to pole)
export const CELL = 32;          // macro cell = 32 x 32 tiles
export const MW = W / CELL;      // 512 macro columns
export const MH = H / CELL;      // 256 macro rows
export const CHUNK = 64;         // chunk = 64 x 64 tiles
export const CW = W / CHUNK;     // 256 chunk columns
export const CHH = H / CHUNK;    // 128 chunk rows
export const SEAM_HALF = 16;     // cells: the seam ocean is forced to abyss for |x| < 16 cells (1024 tiles wide)

// water classes (per tile and per macro cell)
export const WATER = { LAND: 0, SHALLOW: 1, DEEP: 2, ABYSS: 3 };
export const ABYSS_M = -1500;    // macro sea floor deeper than this is abyssal ocean (boats can't enter)

export const wrapX = (x) => ((x % W) + W) % W;
export const wrapCX = (cx) => ((cx % MW) + MW) % MW;

// ---------- vertical scale ----------
// ONE place to tune how physical elevation (metres) becomes game height (stories; 1 story = one built floor
// = 1 tile up the screen, game/levels.js STORY_H). Square-root curve for the low ground: lowlands 0..2 (0..280 m),
// hills 2..5 (280..1000 m); above HI_M0 the high ground gains HI_K stories per metre more (smoothly: no extra slope at
// HI_M0, the full HI_K well above it), so the ranges of the world map stand high in the game (owner: "terrenos mais
// elevados devem ser realmente mais elevados"): 1500 m 9, 2000 m 13.6, 3000 m 23, 4000 m 33, 6000 m 52, 8800 m 79.
// Rivers, lakes, waterfalls and the lapse rate all go through this pair (one curve: they stay consistent). Odd: the
// sea floor mirrors the square-root part below 0. Only + - * / sqrt: bit-identical on every browser.
export const STORY_A = 2.89;
export const STORY_B = 150;
export const HI_M0 = 900, HI_D = 700, HI_K = 0.0082;
export function metersToStories(m) {
  if (m < 0) return -STORY_A * (Math.sqrt(1 - m / STORY_B) - 1);
  const d = m - HI_M0;
  return STORY_A * (Math.sqrt(1 + m / STORY_B) - 1) + (d > 0 ? HI_K * d * d / (d + HI_D) : 0);
}
// stories gained per metre at an elevation m >= 0 (the curve's slope)
function dStories(m) {
  const d = m - HI_M0;
  return STORY_A / (2 * STORY_B * Math.sqrt(1 + m / STORY_B)) + (d > 0 ? HI_K * d * (d + 2 * HI_D) / ((d + HI_D) * (d + HI_D)) : 0);
}
export function storiesToMeters(s) {
  const a = (s >= 0 ? s : -s) / STORY_A + 1;
  let m = STORY_B * (a * a - 1);
  if (s < 0) return -m;
  // the square-root inverse is exact up to HI_M0; above it, Newton from there (a fixed count: the same bits everywhere)
  if (m > HI_M0) { m = m < 2 * HI_M0 ? m : HI_M0 + (m - HI_M0) * 0.3; for (let k = 0; k < 8; k++) { const f = metersToStories(m) - s; m -= f / dStories(m); if (m < HI_M0) m = HI_M0; } }
  return m;
}
// metres per story around an elevation m (slope of the curve)
export function metersPerStory(m) {
  return 1 / dStories(m >= 0 ? m : -m);
}

// ---------- latitude ----------
// sin(latitude) of tile row y (+1 north pole, 0 equator, -1 south pole)
export const sinLatAt = (y) => 1 - (2 * (y + 0.5)) / H;
// latitude in degrees (display only: uses Math.asin, never feed it back into the generation)
export const latitudeAt = (y) => (Math.asin(Math.max(-1, Math.min(1, sinLatAt(y)))) * 180) / Math.PI;
// sin(lat) of macro row cy
export const sinLatCell = (cy) => 1 - (2 * (cy + 0.5)) / MH;

// Season zones for the content phase (from the warmest / coldest month of a place):
//   0 tropical  — no winter
//   1 warm      — mild winter, no snow
//   2 temperate — winter like the current game
//   3 subpolar  — a long hard winter every year
//   4 polar     — permanent winter (walkers every night)
export const SEASON_ZONES = ['tropical', 'warm', 'temperate', 'subpolar', 'polar'];
export const SEASON_ZONES_PT = ['Tropical (sem inverno)', 'Quente (inverno ameno)', 'Temperado', 'Subpolar (inverno longo)', 'Polar (inverno eterno)'];
// (the game's winter — snow, ice, walkers — comes to a place whose coldest month is below ~6 °C: game/seasons.js; the
// thresholds were 1 / 15 °C at first, which left ~1 % of the land temperate)
export function seasonZoneOf(tMean, tAmp) {
  const warm = tMean + tAmp * 0.5, cold = tMean - tAmp * 0.5;
  if (warm < 2) return 4;
  if (cold < -12 || warm < 10) return 3;
  if (cold < 6) return 2;
  if (cold < 16) return 1;
  return 0;
}
