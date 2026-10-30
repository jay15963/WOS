// Seasons (owner's rules): a cycle of 11 days — spring (1 day), summer (6), autumn (1, the day before winter),
// winter (3) — then the count starts again; a new world starts on a spring morning (day 1).
// Everything is derived from the shared clock (env.dayIndex / env.hour, host-authoritative and streamed every 2 s,
// in snapshots and saves), so every peer computes the same season with no extra sync. game.season is refreshed
// every frame by seasonSystem (sync 'all': pure function of the clock):
//
//   game.season = {
//     id: 'spring' | 'summer' | 'autumn' | 'winter',   // gameplay season (whole days)
//     name: 'Primavera' | 'Verão' | 'Outono' | 'Inverno',
//     c: 0..11,           // position in the cycle (days, with the hour)
//     day: 1..,           // day within the season · toWinter: whole days until winter starts (0 in winter)
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
// Visual code (art / shaders / fx) only READS game.season; gameplay reads id / frozen / coldC.

export const CYCLE = 11;
export const SEASON_PT = { spring: 'Primavera', summer: 'Verão', autumn: 'Outono', winter: 'Inverno' };
const START = { spring: 0, summer: 1, autumn: 7, winter: 8 }; // first cycle day of each season

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// position in the cycle (0..11) for an env clock
export function seasonClock(dayIndex, hour) {
  const d = ((((dayIndex | 0) - 1) % CYCLE) + CYCLE) % CYCLE;
  return d + Math.max(0, Math.min(24, hour || 0)) / 24;
}
export function seasonIdAt(c) { return c < 1 ? 'spring' : c < 7 ? 'summer' : c < 8 ? 'autumn' : 'winter'; }

// night weight from the hour (same curve as the renderer / survival: full night 20:24 → 04:36)
export const nightK = (h) => (h < 12 ? 1 - ss(4.6, 6.3, h) : ss(18.7, 20.4, h));

// fill `out` (reused object) for clock position c
export function seasonState(c, out = {}) {
  const id = seasonIdAt(c);
  // unwrapped: spring and the first half of the next summer day sit after winter (11 ≤ u < 12.5), so the ramps
  // across the cycle boundary are continuous
  const u = c < 1.5 ? c + CYCLE : c;
  out.id = id;
  out.name = SEASON_PT[id];
  out.c = c;
  out.day = Math.floor(c) - START[id] + 1;
  out.toWinter = id === 'winter' ? 0 : Math.ceil(START.winter - c);
  out.snow = ss(7.9, 8.25, u) * (1 - ss(10.85, 11.3, u));
  out.ice = ss(8.0, 8.35, u) * (1 - ss(10.9, 11.25, u));
  out.autumn = ss(6.85, 7.25, u) * (1 - ss(7.9, 8.2, u));
  out.bare = ss(7.95, 8.3, u) * (1 - ss(10.95, 11.3, u));
  out.bloom = ss(10.95, 11.3, u) * (1 - ss(11.75, 12.4, u));
  out.winter = ss(7.9, 8.15, u) * (1 - ss(10.9, 11.15, u));
  const autumnK = ss(6.9, 7.15, u) * (1 - ss(7.9, 8.15, u)), springK = ss(10.9, 11.15, u) * (1 - ss(11.9, 12.15, u));
  out.frozen = out.ice >= 0.5;
  out.coldC = -6 * autumnK - 3 * springK;
  return out;
}

// the season of a game right now (also usable before the system ran)
export function seasonOf(game) {
  const E = game.env;
  return seasonState(seasonClock(E?.dayIndex ?? 1, E?.hour ?? 8));
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
      const w = game.world;
      if (w) w.frozen = S.frozen;
      if (prev && prev !== S.id) game.events.emit('season', { id: S.id, prev });
      if (prev && wasFrozen !== S.frozen) game.events.emit('frozen', { frozen: S.frozen });
    },
  };
}
