// Seasons (owner's rules): the year of the calendar (calendar.js) — 7 days: spring (day 1), summer (days 2–3),
// autumn (day 4, the day before winter), winter (days 5–7) — then a new year; a new world starts on a spring morning.
// Everything is derived from the shared clock (env.dayIndex / env.hour, host-authoritative and streamed every 2 s,
// in snapshots and saves), so every peer computes the same season with no extra sync. game.season is refreshed
// every frame by seasonSystem (sync 'all': pure function of the clock):
//
//   game.season = {
//     id: 'spring' | 'summer' | 'autumn' | 'winter',   // gameplay season (whole days)
//     name: 'Primavera' | 'Verão' | 'Outono' | 'Inverno',
//     c: 0..7,            // position in the year (days, with the hour)
//     day: 1..,           // day within the season · toWinter: whole days until winter starts (0 in winter)
//     year: 1..,          // the calendar year (calendar.dateOf)
//     // smooth 0..1 weights for visuals (they ramp over a few in-game hours around the changes, mostly at night):
//     snow,               // snow lying on the ground / trees / roofs (falls the autumn night, melts the spring morning)
//     ice,                // water frozen over (forms the first winter morning, thaws the spring morning)
//     autumn,             // autumn foliage (yellow / orange / red), then the leaves drop into winter
//     bare,               // deciduous trees and bushes without leaves (winter)
//     bloom,              // spring blossoms / flowers (fades into summer during the first summer day)
//     winter,             // winter weight (cold grade, breath, snowfall instead of rain)
//     frozen,             // GAMEPLAY: water is ice (walkable, no swimming, no fishing) — ice ≥ 0.5
//     coldC,              // GAMEPLAY: °C added to the felt temperature in autumn (−6) / spring (−3); winter
//                         //   replaces the biome climate instead (survival.js SURVIVAL.temp.winter, by `winter`)
//   }
//
// Visual code (art / shaders / fx) only READS game.season; gameplay reads id / frozen / coldC. Positions in the
// year are relative to START (the first day of each season) and CYCLE (the year), never hard-coded numbers.

import { YEAR_DAYS, SEASON_START, SEASON_PT as PT } from './calendar.js';

export const CYCLE = YEAR_DAYS;
export const SEASON_PT = PT;
export const START = SEASON_START; // first day of each season in the year (0-based)

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// position in the year (0..CYCLE) for an env clock
export function seasonClock(dayIndex, hour) {
  const d = ((((dayIndex | 0) - 1) % CYCLE) + CYCLE) % CYCLE;
  return d + Math.max(0, Math.min(24, hour || 0)) / 24;
}
export function seasonIdAt(c) { return c < START.summer ? 'spring' : c < START.autumn ? 'summer' : c < START.winter ? 'autumn' : 'winter'; }

// night weight from the hour (same curve as the renderer / survival: full night 20:24 → 04:36)
export const nightK = (h) => (h < 12 ? 1 - ss(4.6, 6.3, h) : ss(18.7, 20.4, h));

// fill `out` (reused object) for year position c
export function seasonState(c, out = {}) {
  const id = seasonIdAt(c), A = START.autumn, W = START.winter, E = CYCLE;
  // unwrapped: spring and the first half of the next summer day sit after winter (E ≤ u < E + 1.5), so the ramps
  // across the new year are continuous
  const u = c < 1.5 ? c + E : c;
  out.id = id;
  out.name = SEASON_PT[id];
  out.c = c;
  out.day = Math.floor(c) - START[id] + 1;
  out.toWinter = id === 'winter' ? 0 : Math.ceil(W - c);
  out.snow = ss(W - 0.1, W + 0.25, u) * (1 - ss(E - 0.15, E + 0.3, u));
  out.ice = ss(W, W + 0.35, u) * (1 - ss(E - 0.1, E + 0.25, u));
  out.autumn = ss(A - 0.15, A + 0.25, u) * (1 - ss(W - 0.1, W + 0.2, u));
  out.bare = ss(W - 0.05, W + 0.3, u) * (1 - ss(E - 0.05, E + 0.3, u));
  out.bloom = ss(E - 0.05, E + 0.3, u) * (1 - ss(E + 0.75, E + 1.4, u));
  out.winter = ss(W - 0.1, W + 0.15, u) * (1 - ss(E - 0.1, E + 0.15, u));
  const autumnK = ss(A - 0.1, A + 0.15, u) * (1 - ss(W - 0.1, W + 0.15, u)), springK = ss(E - 0.1, E + 0.15, u) * (1 - ss(E + 0.9, E + 1.15, u));
  out.frozen = out.ice >= 0.5;
  out.coldC = -6 * autumnK - 3 * springK;
  return out;
}

// the season of a game right now (also usable before the system ran)
export function seasonOf(game) {
  const E = game.env;
  const S = seasonState(seasonClock(E?.dayIndex ?? 1, E?.hour ?? 8));
  S.year = Math.floor(Math.max(0, (E?.dayIndex ?? 1) - 1) / CYCLE) + 1;
  return S;
}

// Keeps game.season fresh and the world's frozen flag (physics / swimming / creature paths) in step with it;
// emits 'season' { id, prev } when the gameplay season changes and 'frozen' { frozen } when the water freezes / thaws.
export function seasonSystem() {
  return {
    sync: 'all', // a pure function of the shared clock: every peer computes the same
    update(game) {
      const E = game.env, S = game.season || (game.season = {});
      const prev = S.id, wasFrozen = !!S.frozen;
      seasonState(seasonClock(E.dayIndex, E.hour), S);
      S.year = Math.floor(Math.max(0, E.dayIndex - 1) / CYCLE) + 1;
      const w = game.world;
      if (w) w.frozen = S.frozen;
      if (prev && prev !== S.id) game.events.emit('season', { id: S.id, prev });
      if (prev && wasFrozen !== S.frozen) game.events.emit('frozen', { frozen: S.frozen });
    },
  };
}
