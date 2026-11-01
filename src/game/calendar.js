// Calendar (owner's rules): the length of the year is a world setting chosen when the world is created (worlds.js
// `year`, carried by the snapshot / save `year` like the game mode, so every peer agrees):
//   short  (Curta)  7 days — spring 1, summer 2, autumn 1, winter 3 (the original year)
//   normal (Normal) 12 days — spring 2, summer 3, autumn 2, winter 5
//   long   (Longa)  22 days — spring 4, summer 6, autumn 4, winter 8
// setYearLength(kind) rewrites YEAR_DAYS / SEASON_LEN / SEASON_START in place (live bindings: every importer sees it).
// A new world starts on the first spring morning of year 1. A day lasts 13 minutes of play: 8 min of daylight
// (06:00 → 19:00) and 5 min of night (19:00 → 06:00), so a short year is 91 minutes.
// The date is a pure function of the shared clock (env.dayIndex 1.. and env.hour 0..24, host-authoritative,
// streamed every 2 s, in snapshots and saves): every peer agrees with no extra sync. Seasons (seasons.js), the HUD
// date (radar), the time a world has lived (world list) and anything dated later read it from here.

export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
export const YEAR_PRESETS = {
  short: { spring: 1, summer: 2, autumn: 1, winter: 3 },
  normal: { spring: 2, summer: 3, autumn: 2, winter: 5 },
  long: { spring: 4, summer: 6, autumn: 4, winter: 8 },
};
export const YEAR_PT = { short: 'Curta', normal: 'Normal', long: 'Longa' };
export let YEAR_KIND = 'short';
export let YEAR_DAYS = 7;
export const SEASON_LEN = { spring: 1, summer: 2, autumn: 1, winter: 3 };
export const SEASON_START = { spring: 0, summer: 1, autumn: 3, winter: 4 }; // first day of the year (0-based)
export const SEASON_PT = { spring: 'Primavera', summer: 'Verão', autumn: 'Outono', winter: 'Inverno' };
export const yearKind = (k) => (YEAR_PRESETS[k] ? k : 'short');
// the world's year (unknown / missing = short, the original)
export function setYearLength(kind) {
  const k = yearKind(kind), P = YEAR_PRESETS[k];
  let s = 0;
  for (const id of SEASON_ORDER) { SEASON_LEN[id] = P[id]; SEASON_START[id] = s; s += P[id]; }
  YEAR_KIND = k; YEAR_DAYS = s;
  return k;
}

// the clock: real seconds of daylight / night and the in-game hours where they change
export const DAY_REAL_S = 480, NIGHT_REAL_S = 300;
export const DAWN = 6, DUSK = 19;
export const DAY_LENGTH = DAY_REAL_S + NIGHT_REAL_S; // 780 s: one in-game day (worldTime ↔ days)

// in-game hours per real second at hour h (daylight is slower than the night); scale = DAY_LENGTH / env.dayLength
export function hourRate(h, scale = 1) {
  return (h >= DAWN && h < DUSK ? (DUSK - DAWN) / DAY_REAL_S : (24 - DUSK + DAWN) / NIGHT_REAL_S) * scale;
}

// advance env { hour, dayIndex } by dt real seconds (crossing dawn / dusk / midnight on the way)
export function advanceClock(E, dt) {
  const scale = E.dayLength ? DAY_LENGTH / E.dayLength : 1;
  let h = E.hour, t = dt;
  for (let k = 0; k < 6 && t > 0; k++) {
    const r = hourRate(h, scale);
    const edge = h < DAWN ? DAWN : h < DUSK ? DUSK : 24;
    const need = (edge - h) / r;
    if (t < need) { h += t * r; t = 0; break; }
    h = edge; t -= need;
    if (h >= 24) { h -= 24; E.dayIndex++; }
  }
  E.hour = h;
}

// days and season starts of a year kind (kind omitted: the current world's year)
const OTHER = { days: 7, start: {} };
function yearOf(kind) {
  if (kind == null) return { days: YEAR_DAYS, start: SEASON_START };
  const P = YEAR_PRESETS[yearKind(kind)];
  let s = 0;
  for (const id of SEASON_ORDER) { OTHER.start[id] = s; s += P[id]; }
  OTHER.days = s;
  return OTHER;
}

// the date of a clock: { year 1.., day 1.. of the year, season, seasonDay 1.., hour }; kind: another world's year
// (the world list) instead of the current one
export function dateOf(dayIndex, hour = 0, kind) {
  const Y = yearOf(kind), d = Math.max(1, dayIndex | 0) - 1, doy = d % Y.days;
  let season = 'spring';
  for (const s of SEASON_ORDER) if (doy >= Y.start[s]) season = s;
  return { year: Math.floor(d / Y.days) + 1, day: doy + 1, season, seasonDay: doy - Y.start[season] + 1, hour };
}

// how long a world has lived: whole years and days since its first morning
export function elapsedOf(dayIndex, kind) {
  const Y = yearOf(kind).days, d = Math.max(0, (dayIndex | 0) - 1);
  return { years: Math.floor(d / Y), days: d % Y };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "3 anos e 4 dias", "1 ano", "5 dias", "Primeiro dia"
export function formatElapsed(e) {
  const parts = [];
  if (e.years) parts.push(plural(e.years, 'ano', 'anos'));
  if (e.days) parts.push(plural(e.days, 'dia', 'dias'));
  return parts.length ? parts.join(' e ') : 'Primeiro dia';
}
// "Ano 2 · Dia 3" (short) / "Dia 3 de 7 do Ano 2 · Verão" (long)
export function formatDate(dt, long = false) {
  return long ? `Dia ${dt.day} de ${YEAR_DAYS} do Ano ${dt.year} · ${SEASON_PT[dt.season]}` : `Ano ${dt.year} · Dia ${dt.day}`;
}
export const clockHHMM = (h) => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
