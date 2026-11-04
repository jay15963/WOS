// Seasons (owner's rules): the year of the calendar (calendar.js; its length is a world setting) — the short year:
// spring (day 1), summer (days 2–3), autumn (day 4, the day before winter), winter (days 5–7); normal / long years
// stretch every season — then a new year; a new world starts on a spring morning.
//
// Seasons by latitude (owner: "nos polos os andarilhos são constantes a noite e próximo dos polos o inverno chega"): the
// year clock is GLOBAL (the calendar), its effects are LOCAL — each place has a season zone (the planet's climate at that
// tile with its own altitude, world.js `zone` layer, docs/PLANET.md §5; a bounded / synthetic world is temperate
// everywhere) and lives the year of its zone:
//   0 tropical   no winter: a wet season (spring + summer: more rain) and a dry season (autumn + winter: little rain)
//   1 warm       a short mild winter ("Inverno ameno"): cooler, no snow, no ice, the crops grow slower, no walkers
//   2 temperate  the original year
//   3 subpolar   winter every year, longer: it comes earlier in the autumn and stays into the spring
//   4 polar      permanent winter: snow, ice, cold — the winter walkers every night
// High mountains are colder zones anywhere (the zone of a tile includes its altitude).
//
// Everything is derived from the shared clock (env.dayIndex / env.hour, host-authoritative, streamed, in snapshots and
// saves) and the zone layer (a pure function of the seed), so every peer computes the same with no extra sync.
// seasonSystem (sync 'all') refreshes every frame:
//   game.seasons[z]   the state of zone z (below), 5 objects reused
//   world.iceZ[z]     1 while the water of zone z is ice (world.iceAt / frozenAt / liquidAt: walking, swimming, boats,
//                     fishing, creature paths — never the abyssal ocean)
//   game.season       the state where the LOCAL player stands (HUD, survival, looks: fx/seasonfx.js) — a reference to
//                     game.seasons[its zone]; world.frozen mirrors its `frozen` (cosmetic code only)
// Host / gameplay code asks by place: seasonAt(game, x, y) (crops, wolves, prey, walkers, giants).
//
//   state = {
//     id: 'spring' | 'summer' | 'autumn' | 'winter',   // gameplay season (tropical: 'summer' all year)
//     name,                // the season's name for the HUD ('Inverno ameno', 'Estação seca', 'Inverno polar'…)
//     zone, zoneName,      // 0..4, 'Temperado'…
//     hard,                // a real winter (snow): wolves ×3, little prey, crops stop, walkers at night
//     c: 0..E,             // position in the year (days, with the hour) — the global clock
//     day: 1..,            // day within the season · toWinter: whole days until winter starts (0 in winter, -1 never)
//     len,                 // whole days of this zone's winter (0 none, -1 all year)
//     year: 1..,           // the calendar year (calendar.dateOf)
//     wet: 0..1,           // tropical: the wet season (rain more often / heavier: the looks, survival)
//     // smooth 0..1 weights for visuals (they ramp over a few in-game hours around the changes, mostly at night):
//     snow, ice, autumn, bare, bloom, winter,
//     frozen,              // GAMEPLAY: water is ice (walkable, no swimming, no fishing) — ice ≥ 0.5
//     coldC,               // GAMEPLAY (bounded worlds): °C added to the felt temperature in autumn (−6) / spring (−3);
//                          //   the planet takes its temperatures from its climate (survival.js)
//     tC,                  // the seasonal temperature curve −1 (mid winter) .. +1 (mid summer) of this zone's year
//   }
//
// Visual code (art / shaders / fx) only READS game.season; gameplay reads id / hard / frozen / coldC. Positions in the
// year are relative to START (the first day of each season) and CYCLE (the year), never hard-coded numbers.

import { YEAR_DAYS, SEASON_START, SEASON_PT as PT } from './calendar.js';

export { YEAR_DAYS as CYCLE } from './calendar.js'; // (live: the world's year length, calendar.setYearLength)
const CYCLE_ = () => YEAR_DAYS;
export const SEASON_PT = PT;
export const START = SEASON_START; // first day of each season in the year (0-based)
export const ZONES = 5;
export const ZONE_PT = ['Tropical', 'Quente', 'Temperado', 'Subpolar', 'Polar'];
export const ZONE_HINT = [
  'Região tropical: sem inverno — estação chuvosa e estação seca.',
  'Região quente: o inverno é curto e ameno (sem neve nem gelo).',
  'Região temperada: as quatro estações.',
  'Região subpolar: o inverno chega cedo e dura muito; muitas noites com os Andarilhos do Gelo.',
  'Região polar: inverno eterno — gelo, frio extremo e Andarilhos do Gelo toda noite.',
];

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// position in the year (0..CYCLE) for an env clock
export function seasonClock(dayIndex, hour) {
  const Y = CYCLE_(), d = ((((dayIndex | 0) - 1) % Y) + Y) % Y;
  return d + Math.max(0, Math.min(24, hour || 0)) / 24;
}
export function seasonIdAt(c) { return c < START.summer ? 'spring' : c < START.autumn ? 'summer' : c < START.winter ? 'autumn' : 'winter'; }

// night weight from the hour (same curve as the renderer / survival: full night 20:24 → 04:36)
export const nightK = (h) => (h < 12 ? 1 - ss(4.6, 6.3, h) : ss(18.7, 20.4, h));

// fill `out` (reused object) for year position c — the temperate year (the original)
export function seasonState(c, out = {}) {
  const id = seasonIdAt(c), A = START.autumn, W = START.winter, E = CYCLE_(), S1 = START.summer;
  // unwrapped: spring and the first half of the next summer day sit after winter (E ≤ u < E + S1 + 0.5), so the ramps
  // across the new year are continuous
  const u = c < S1 + 0.5 ? c + E : c;
  out.id = id;
  out.name = SEASON_PT[id];
  out.c = c;
  out.day = Math.floor(c) - START[id] + 1;
  out.toWinter = id === 'winter' ? 0 : Math.ceil(W - c);
  out.snow = ss(W - 0.1, W + 0.25, u) * (1 - ss(E - 0.15, E + 0.3, u));
  out.ice = ss(W, W + 0.35, u) * (1 - ss(E - 0.1, E + 0.25, u));
  out.autumn = ss(A - 0.15, A + 0.25, u) * (1 - ss(W - 0.1, W + 0.2, u));
  out.bare = ss(W - 0.05, W + 0.3, u) * (1 - ss(E - 0.05, E + 0.3, u));
  out.bloom = ss(E - 0.05, E + 0.3, u) * (1 - ss(E + S1 - 0.25, E + S1 + 0.4, u)); // (all spring, fading into summer)
  out.winter = ss(W - 0.1, W + 0.15, u) * (1 - ss(E - 0.1, E + 0.15, u));
  const autumnK = ss(A - 0.1, A + 0.15, u) * (1 - ss(W - 0.1, W + 0.15, u)), springK = ss(E - 0.1, E + 0.15, u) * (1 - ss(E + S1 - 0.1, E + S1 + 0.15, u));
  out.frozen = out.ice >= 0.5;
  out.coldC = -6 * autumnK - 3 * springK;
  out.hard = id === 'winter';
  out.len = Math.round(E - W);
  out.wet = 0;
  // the temperature curve: +1 in the middle of summer, −1 in the middle of winter
  const mS = (S1 + A) / 2, mW = (W + E) / 2;
  out.tC = c >= mS && c < mW ? Math.cos(Math.PI * (c - mS) / (mW - mS)) : Math.cos(Math.PI + Math.PI * (((c - mW + E) % E) / (E - (mW - mS))));
  return out;
}

// ---------- zones ----------
// The start of each season of a zone's year, in days of the temperate year (spring, summer, autumn, winter; spring may
// start before day 0 = during the last days of the previous year's temperate winter). The zone's year position is mapped
// piecewise-linearly onto the temperate year (seasonState), so every ramp keeps its shape, stretched or squeezed.
function zoneBounds(z) {
  const A = START.autumn, W = START.winter, E = CYCLE_(), S1 = START.summer;
  if (z === 3) return [0.5 * S1, S1 + 0.25 * (A - S1), A, A + 0.35 * (W - A)]; // subpolar: long winter
  if (z === 1) return [-0.4 * (E - W), S1, A + 0.3 * (W - A), W + 0.3 * (E - W)]; // warm: short winter
  return [0, S1, A, W];
}
const TB = [0, 0, 0, 0, 0];
// the temperate position of zone year position c
function zoneClock(z, c) {
  const Z = zoneBounds(z), E = CYCLE_();
  TB[0] = 0; TB[1] = START.summer; TB[2] = START.autumn; TB[3] = START.winter; TB[4] = E;
  const u = (((c - Z[0]) % E) + E) % E;
  let cum = 0;
  for (let k = 0; k < 4; k++) {
    const len = (k < 3 ? Z[k + 1] : Z[0] + E) - Z[k];
    if (u < cum + len || k === 3) return Math.min(E - 1e-6, TB[k] + ((u - cum) / len) * (TB[k + 1] - TB[k]));
    cum += len;
  }
  return c;
}

const TROP = ['Estação chuvosa', 'Estação seca'];
// fill `out` with the state of zone z at year position c
export function zoneSeason(z, c, out = {}) {
  const E = CYCLE_();
  if (z === 4) {
    // polar: winter all year
    seasonState(START.winter + 0.5 * (E - START.winter), out);
    out.c = c; out.snow = 1; out.ice = 1; out.bare = 1; out.winter = 1; out.autumn = 0; out.bloom = 0; out.frozen = true; out.coldC = 0;
    out.id = 'winter'; out.name = 'Inverno polar'; out.day = Math.floor(c) + 1; out.toWinter = 0; out.len = -1; out.hard = true;
    out.tC = -1 + 0.3 * (seasonState(c, TMP).tC + 1); // (a little less cruel in the temperate summer)
  } else if (z === 0) {
    // tropical: no winter; wet season through spring and summer, dry through autumn and winter
    seasonState(c, out);
    const wet = c < START.autumn;
    const u = c < START.summer + 0.5 ? c + E : c;
    out.wet = ss(E - 0.2, E + 0.3, u) * (1 - ss(START.autumn - 0.2, START.autumn + 0.3, u));
    out.snow = 0; out.ice = 0; out.bare = 0; out.winter = 0; out.autumn = 0; out.frozen = false; out.coldC = 0;
    out.bloom = ss(E - 0.05, E + 0.3, u) * (1 - ss(E + 0.7, E + 1.2, u)) * 0.6; // (the first rains: blossoms)
    out.id = 'summer'; out.name = TROP[wet ? 0 : 1]; out.day = Math.floor(wet ? c : c - START.autumn) + 1;
    out.toWinter = -1; out.len = 0; out.hard = false; out.tC *= 0.5;
  } else {
    const cc = zoneClock(z, c);
    seasonState(cc, out);
    const Z = zoneBounds(z), id = out.id, k = id === 'spring' ? 0 : id === 'summer' ? 1 : id === 'autumn' ? 2 : 3;
    out.c = c;
    out.day = Math.floor((((c - Z[k]) % E) + E) % E) + 1;
    out.toWinter = id === 'winter' ? 0 : Math.ceil((((Z[3] - c) % E) + E) % E);
    out.len = Math.round(Z[0] + E - Z[3]);
    if (z === 1) {
      // warm: a mild winter — no snow, no ice, a few trees lose their leaves; crops slow down (hard false)
      out.snow = 0; out.ice = 0; out.frozen = false; out.bare *= 0.45; out.winter *= 0.25; out.coldC *= 0.5; out.hard = false;
      if (id === 'winter') out.name = 'Inverno ameno';
    }
  }
  out.zone = z; out.zoneName = ZONE_PT[z];
  return out;
}
const TMP = {};

// the season of a game right now at the local player (also usable before the system ran)
export function seasonOf(game) {
  const E = game.env, p = game.player, w = game.world;
  const z = w && p && w.zoneAt ? w.zoneAt(Math.floor(p.x), Math.floor(p.y)) : 2;
  const S = zoneSeason(z, seasonClock(E?.dayIndex ?? 1, E?.hour ?? 8));
  S.year = Math.floor(Math.max(0, (E?.dayIndex ?? 1) - 1) / CYCLE_()) + 1;
  return S;
}

// the season state where (x, y) is (gameplay: crops, creatures, walkers); fresh every frame once seasonSystem runs
export function seasonAt(game, x, y) {
  const w = game.world, z = w && w.zoneAt ? w.zoneAt(Math.floor(x), Math.floor(y)) : 2;
  const L = game.seasons;
  if (L && L[z]?.id) return L[z];
  const E = game.env, S = zoneSeason(z, seasonClock(E?.dayIndex ?? 1, E?.hour ?? 8));
  S.year = Math.floor(Math.max(0, (E?.dayIndex ?? 1) - 1) / CYCLE_()) + 1;
  return S;
}
// a real winter (snow) at (x, y) now
export const hardWinterAt = (game, x, y) => !!seasonAt(game, x, y).hard;

// Keeps game.seasons / game.season and the world's ice by zone (physics / swimming / creature paths) in step with the
// clock; emits 'season' { id, prev, zone } when the gameplay season of the local player changes (the clock, or walking
// into another zone), 'zone' { zone, prev } when the local player enters another zone, and 'frozen' { frozen } when
// the water around the local player freezes / thaws.
export function seasonSystem() {
  return {
    sync: 'all', // a pure function of the shared clock and the zone layer: every peer computes the same
    update(game) {
      const E = game.env, w = game.world;
      const L = game.seasons || (game.seasons = Array.from({ length: ZONES }, () => ({})));
      const c = seasonClock(E.dayIndex, E.hour), year = Math.floor(Math.max(0, E.dayIndex - 1) / CYCLE_()) + 1;
      for (let z = 0; z < ZONES; z++) { zoneSeason(z, c, L[z]); L[z].year = year; if (w?.iceZ) w.iceZ[z] = L[z].frozen ? 1 : 0; }
      const p = game.player, z = w && p && w.zoneAt ? w.zoneAt(Math.floor(p.x), Math.floor(p.y)) : 2;
      const prev = game.season, S = L[z];
      const prevId = game._seaId, prevZone = game._seaZone, wasFrozen = !!game._seaFrozen;
      game.season = S;
      game._seaId = S.id; game._seaZone = z; game._seaFrozen = S.frozen;
      if (w) w.frozen = S.frozen; // (cosmetic: the local player's zone — gameplay asks iceAt / frozenAt by place)
      if (prev && prevZone !== undefined && prevZone !== z) game.events.emit('zone', { zone: z, prev: prevZone });
      if (prevId && prevId !== S.id) game.events.emit('season', { id: S.id, prev: prevId, zone: z, moved: prevZone !== z });
      if (prevId && wasFrozen !== S.frozen) game.events.emit('frozen', { frozen: S.frozen });
    },
  };
}
