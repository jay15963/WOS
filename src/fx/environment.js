// Day/night cycle + weather -> per-frame render parameters (env object consumed by Renderer).
// env.extra holds extra shader uniforms (terrain + post) applied generically by the renderer.

import { clamp, lerp, smoothstep, mulberry32 } from '../engine/noise.js';
import { advanceClock, DAY_LENGTH, dateOf, formatDate, clockHHMM } from '../game/calendar.js';

// hour, ambient light, tint (gain), lift (shadow tint), saturation, contrast, sky (water reflection)
// moonlit blue night → lavender pre-dawn → pink dawn → golden morning → neutral noon → warm afternoon →
// golden hour → pink / orange dusk → violet blue hour → night
const KF = [
  [0.0,  [0.30, 0.36, 0.58], [0.90, 0.98, 1.14], [0.012, 0.020, 0.052], 0.66, 1.06, [0.09, 0.13, 0.27]],
  [4.2,  [0.30, 0.36, 0.58], [0.90, 0.98, 1.14], [0.012, 0.020, 0.052], 0.66, 1.06, [0.09, 0.13, 0.27]],
  [5.0,  [0.42, 0.42, 0.62], [0.96, 0.95, 1.08], [0.020, 0.015, 0.048], 0.72, 1.04, [0.30, 0.30, 0.50]],
  [5.8,  [0.80, 0.66, 0.66], [1.05, 0.96, 0.98], [0.030, 0.015, 0.030], 0.90, 1.04, [0.86, 0.64, 0.64]],
  [6.6,  [1.04, 0.88, 0.68], [1.07, 1.00, 0.89], [0.022, 0.012, 0.000], 1.08, 1.06, [0.94, 0.80, 0.62]],
  [8.0,  [1.00, 0.96, 0.88], [1.04, 1.00, 0.95], [0.008, 0.005, 0.000], 1.07, 1.05, [0.62, 0.74, 0.86]],
  [12.0, [1.00, 1.00, 1.00], [1.00, 1.00, 1.00], [0.000, 0.000, 0.004], 1.06, 1.05, [0.56, 0.70, 0.86]],
  [15.6, [1.00, 0.98, 0.92], [1.03, 1.00, 0.95], [0.004, 0.002, 0.000], 1.08, 1.05, [0.62, 0.72, 0.82]],
  [17.4, [1.02, 0.86, 0.66], [1.07, 0.99, 0.88], [0.020, 0.010, 0.000], 1.10, 1.06, [0.92, 0.74, 0.58]],
  [18.4, [0.96, 0.76, 0.74], [1.04, 0.96, 0.98], [0.032, 0.015, 0.034], 0.95, 1.05, [0.94, 0.64, 0.68]],
  [19.3, [0.58, 0.54, 0.74], [0.99, 0.95, 1.08], [0.022, 0.017, 0.052], 0.86, 1.04, [0.46, 0.38, 0.64]],
  [20.4, [0.32, 0.37, 0.59], [0.90, 0.98, 1.14], [0.012, 0.020, 0.052], 0.66, 1.06, [0.10, 0.14, 0.28]],
  [24.0, [0.30, 0.36, 0.58], [0.90, 0.98, 1.14], [0.012, 0.020, 0.052], 0.66, 1.06, [0.09, 0.13, 0.27]],
];
const NEUTRAL_GRADE = { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, mist: 0 };

export const WEATHERS = {
  clear:  { cloud: 0.12, rain: 0, fog: 0.0, wind: 0.18, storm: 0 },
  cloudy: { cloud: 0.72, rain: 0, fog: 0.04, wind: 0.38, storm: 0 },
  rain:   { cloud: 0.92, rain: 0.72, fog: 0.10, wind: 0.55, storm: 0 },
  storm:  { cloud: 1.0, rain: 1.0, fog: 0.14, wind: 0.92, storm: 1 },
  fog:    { cloud: 0.45, rain: 0, fog: 0.52, wind: 0.05, storm: 0 },
};
export const WEATHER_NAMES_PT = { clear: 'Céu limpo', cloudy: 'Nublado', rain: 'Chuva', storm: 'Tempestade', fog: 'Neblina' };

const SUNRISE = 5.9, SUNSET = 19.1;

export class Environment {
  constructor(seed = 1) {
    this.hour = 8.2;            // in-game hour 0..24
    this.dayIndex = 1;
    this.dayLength = DAY_LENGTH; // real seconds per in-game day (calendar.js: 8 min of daylight + 5 of night)
    this.rand = mulberry32(seed);
    this.weather = 'clear';
    this.weatherT = 150 + this.rand() * 150;
    this.cur = { ...WEATHERS.clear };
    this.wet = 0;
    this.flash = 0;
    this.t = 0;
    this.windAng = this.rand() * Math.PI * 2;
    // Cosmetic wind field (per frame, local to each client; never feeds gameplay):
    // game.env.wind = { x, y, gust } — x, y = direction × strength (0..~1.05), gust 0..1 (both low-passed).
    this.wind = { x: Math.cos(this.windAng) * 0.18, y: Math.sin(this.windAng) * 0.18, gust: 0.5 };
    this._windS = WEATHERS.clear.wind;   // smoothed strength
    this._gustS = 0.5;                  // smoothed gust
    this.strikes = [];          // recent lightning: { t, dist } (audio reads it for thunder)
    this.strikeId = 0;
    this._nextStrike = 4;
    this.snowCover = 0;         // cosmetic: snow lying in cold biomes (builds up while it precipitates, melts after)
    this.grade = NEUTRAL_GRADE; // per-biome colour grade around the camera (set by the ambient system)
    this.env = {
      ambient: [1, 1, 1], tint: [1, 1, 1], sat: 1, contrast: 1, vignette: 0.5,
      shadowDir: [0, 0], shadowStr: 0.5, sun3: [0, 0, 1], sunI: 1, sky: [0.6, 0.7, 0.8],
      cloud: 0, day: 1, cloudVel: [0.004, 0.0016], fog: 0, fogCol: [0.8, 0.82, 0.85],
      wind: 0.2, windDir: [1, 0], gust: 0, wet: 0, rain: 0, storm: 0, flash: 0, hour: 8, night: 0,
      weather: 'clear', mist: 0,
      windPh: [0, 0], // accumulated sway / wind-wave phases (smooth whatever the wind does)
      extra: {
        uRain: 0, uSunWarm: [0, 0, 0], uCloud: 0, uCloudVel: [0, 0], uLift: [0, 0, 0], uRainDir: [0, 0],
        uMist: 0, uCloudSh: 0, uFlashCol: [0, 0, 0], uNight: 0,
        // caves & wind (world pass): ambient inside mined mountain caves, grass waves, light shafts
        uCaveAmb: [0.12, 0.125, 0.15], uWindDir: [1, 0], uWindK: 0.2, uWindPh: [0, 0], uRays: 0, uSunXY: [1, 0],
        uCamCave: 0, // set by the ambient system (camera inside a cave)
        // snow over cold biomes (cover 0..1, permanent peaks), lightning strike light (x, y, radius, intensity)
        uSnow: 0, uSnowPeak: 0.5, uBolt: [0, 0, 1, 0],
      },
      snowAt: 0,   // share of the precipitation at the camera that falls as snow (ambient system; audio may read it)
    };
    this._phT = 0;
  }

  setWeather(name) {
    if (!WEATHERS[name]) return;
    this.weather = name;
    this.weatherT = (name === 'storm' ? 70 : 150) + this.rand() * 200;
  }
  weatherName() { return WEATHER_NAMES_PT[this.weather] || this.weather; }

  update(dt) {
    this.t += dt;
    advanceClock(this, dt); // daylight runs slower than the night (calendar.js)
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const r = this.rand();
      // storms only follow rain; fog prefers mornings
      let w = r < 0.42 ? 'clear' : r < 0.66 ? 'cloudy' : r < 0.86 ? 'rain' : 'fog';
      if (this.weather === 'rain' && this.rand() < 0.35) w = 'storm';
      if (w === 'fog' && (this.hour > 11 && this.hour < 17)) w = 'cloudy';
      this.setWeather(w);
    }
    const target = WEATHERS[this.weather];
    const k = 1 - Math.exp(-dt / 14);
    for (const key in target) this.cur[key] = lerp(this.cur[key], target[key], k);
    this.wet = clamp(this.wet + (this.cur.rain > 0.25 ? dt / 35 * this.cur.rain : -dt / 110), 0, 1);
    this.snowCover = clamp(this.snowCover + (this.cur.rain > 0.25 ? dt / 60 * this.cur.rain : -dt / 260), 0, 1);
    this.windAng += dt * 0.004 * Math.sin(this.t * 0.01);
    // wind: slow gust noise, then low-passed strength (a few seconds) so sway amplitude never pumps;
    // the sway / wave speeds stay almost constant (see compute) — calm even in storms
    const tt = this.t, sdt = Math.min(dt, 0.1);
    const gRaw = clamp(0.5 + 0.5 * Math.sin(tt * 0.17) * Math.sin(tt * 0.43 + 1.3) + 0.25 * Math.sin(tt * 0.6 + 0.4) * Math.sin(tt * 0.07), 0, 1);
    this._gustS += (gRaw - this._gustS) * (1 - Math.exp(-sdt / 2.5));
    const wRaw = Math.min(1.05, this.cur.wind * (0.75 + 0.5 * this._gustS) + this.cur.storm * 0.12 * this._gustS);
    this._windS += (wRaw - this._windS) * (1 - Math.exp(-sdt / 3));
    const W = this.wind;
    W.x = Math.cos(this.windAng) * this._windS; W.y = Math.sin(this.windAng) * this._windS; W.gust = this._gustS;

    // lightning in heavy rain / storms (multi-flicker strikes)
    const stormy = this.cur.storm * 0.9 + Math.max(0, this.cur.rain - 0.6) * 0.25;
    this._nextStrike -= dt * stormy;
    if (this._nextStrike <= 0 && stormy > 0.05) {
      this._nextStrike = 3 + this.rand() * 9;
      const dist = 0.2 + this.rand() * 0.8;   // 0 = overhead, 1 = far
      this.strikes.push({ t: this.t, dist, a: 1.15 - dist * 0.7 });
      this.strikeId++;
      if (this.strikes.length > 6) this.strikes.shift();
    }
    let f = 0;
    for (const s of this.strikes) {
      const a = this.t - s.t;
      if (a < 0 || a > 1.2) continue;
      // three quick pulses then decay
      f += s.a * (Math.exp(-a * 14) + 0.6 * Math.exp(-Math.max(0, a - 0.13) * 18) * (a > 0.13 ? 1 : 0) + 0.8 * Math.exp(-Math.max(0, a - 0.27) * 9) * (a > 0.27 ? 1 : 0));
    }
    this.flash = clamp(f, 0, 1.4);
  }

  compute() {
    const h = this.hour, e = this.env, X = e.extra;
    let i = 0;
    while (i < KF.length - 2 && KF[i + 1][0] <= h) i++;
    const a = KF[i], b = KF[i + 1];
    const t = smoothstep(0, 1, (h - a[0]) / (b[0] - a[0]));
    for (let c = 0; c < 3; c++) {
      e.ambient[c] = lerp(a[1][c], b[1][c], t);
      e.tint[c] = lerp(a[2][c], b[2][c], t);
      X.uLift[c] = lerp(a[3][c], b[3][c], t);
      e.sky[c] = lerp(a[6][c], b[6][c], t);
    }
    e.sat = lerp(a[4], b[4], t);
    e.contrast = lerp(a[5], b[5], t);

    // sun path: rises east (right), sets west (left), arcs through the south
    const dayK = (h - SUNRISE) / (SUNSET - SUNRISE);
    const isDay = dayK > 0 && dayK < 1;
    let sx, sy, sz, elev = 0;
    if (isDay) {
      const ang = dayK * Math.PI;
      elev = Math.sin(ang);
      sx = Math.cos(ang); sy = 0.42; sz = elev * 0.95 + 0.06;
    } else {
      // moon: slow arc from the east, high in the sky
      const nk = ((h - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE));
      const ang = nk * Math.PI;
      sx = Math.cos(ang) * 0.55; sy = 0.35; sz = 0.6 + Math.sin(ang) * 0.3;
    }
    const L = Math.hypot(sx, sy, sz);
    e.sun3[0] = sx / L; e.sun3[1] = sy / L; e.sun3[2] = sz / L;
    const hl = Math.hypot(sx, sy) || 1;
    const len = clamp(hl / Math.max(sz, 0.22), 0.42, 2.0);
    e.shadowDir[0] = (-sx / hl) * len;
    e.shadowDir[1] = (-sy / hl) * len;
    const cl = this.cur.cloud, rain = this.cur.rain;
    e.day = isDay ? smoothstep(0, 0.1, Math.min(dayK, 1 - dayK)) : 0;
    e.sunI = e.day * (1 - cl * 0.62);
    const low = isDay ? Math.pow(1 - elev, 2.2) : 0;
    e.shadowStr = isDay ? (0.2 + 0.4 * smoothstep(0, 0.16, elev)) * (1 - cl * 0.72) : 0.13 * (1 - cl);
    // warm low sun, cool moonlight
    if (isDay) { X.uSunWarm[0] = 0.19 * low; X.uSunWarm[1] = 0.06 * low; X.uSunWarm[2] = -0.22 * low; }
    else { X.uSunWarm[0] = -0.2; X.uSunWarm[1] = -0.08; X.uSunWarm[2] = 0.15; }

    // weather influence
    e.cloud = cl;
    const dim = 1 - cl * 0.2 - rain * 0.13 - this.cur.storm * 0.08;
    for (let c = 0; c < 3; c++) e.ambient[c] *= dim;
    // overcast: greyer sky reflection, cooler tint
    const grey = clamp(cl * 0.8 + rain * 0.3, 0, 1) * 0.7;
    const skyL = (e.sky[0] + e.sky[1] + e.sky[2]) / 3;
    for (let c = 0; c < 3; c++) {
      e.sky[c] = lerp(e.sky[c], skyL * [0.95, 1.0, 1.06][c], grey);
      e.tint[c] = lerp(e.tint[c], e.tint[c] * [0.97, 0.99, 1.04][c], rain);
    }
    e.sat *= 1 - rain * 0.22 - cl * 0.07;
    e.contrast *= 1 - rain * 0.04;
    // per-biome colour grade around the camera (warm meadows, cool pines, teal marsh…), weaker at night
    const G = this.grade || NEUTRAL_GRADE, gk = 1 - 0.6 * (h < 5 || h > 20.5 ? 1 : 0);
    for (let c = 0; c < 3; c++) { e.tint[c] *= 1 + (G.tint[c] - 1) * gk; X.uLift[c] += G.lift[c] * gk; }
    e.sat *= 1 + (G.sat - 1) * gk;
    // mist: morning lowland mist, a little at dusk, plus fog weather (marshes keep a little more)
    const morning = h > 4.3 && h < 9.2 ? Math.sin(((h - 4.3) / 4.9) * Math.PI) : 0;
    const evening = h > 19 && h < 22.5 ? Math.sin(((h - 19) / 3.5) * Math.PI) * 0.35 : 0;
    e.mist = (morning * 0.42 + evening + G.mist * (0.4 + morning)) * (1 - this.cur.wind * 0.8);
    e.fog = this.cur.fog + morning * 0.06;
    X.uMist = e.mist;
    const glow = morning * 0.7 + evening * 0.5;
    const fogLum = 0.34 + 0.54 * Math.max(e.day, glow * 0.8);
    const warmF = isDay ? low * 0.6 : 0;
    e.fogCol[0] = fogLum * (0.94 + warmF * 0.12); e.fogCol[1] = fogLum * (0.97 + warmF * 0.02); e.fogCol[2] = fogLum * (1.06 - warmF * 0.1);
    if (!isDay) { e.fogCol[0] *= 0.62; e.fogCol[1] *= 0.7; e.fogCol[2] *= 0.95; }

    // wind (smoothed in update): strength drives the sway AMPLITUDE; the speeds below barely change
    e.gust = this._gustS;
    e.wind = this._windS;
    e.windDir[0] = Math.cos(this.windAng); e.windDir[1] = Math.sin(this.windAng);
    const cs = 0.0035 + this.cur.wind * 0.006;
    e.cloudVel[0] = e.windDir[0] * cs; e.cloudVel[1] = e.windDir[1] * cs;
    // integrate the sway / wave phases on the CPU (never time × wind in a shader: that races). Rates are
    // nearly constant (~1.0–1.3 rad/s sway, ~0.9–1.3 rad/s waves). Wrapped at 100·2π: every multiplier m the
    // shaders apply to a phase must satisfy m·100 ∈ ℤ so the wrap stays invisible.
    const pdt = clamp(this.t - this._phT, 0, 0.1);
    this._phT = this.t;
    e.windPh[0] = (e.windPh[0] + pdt * (1.0 + 0.3 * e.wind)) % 628.31853;
    e.windPh[1] = (e.windPh[1] + pdt * (0.9 + 0.35 * e.wind)) % 628.31853;
    X.uWindPh[0] = e.windPh[0]; X.uWindPh[1] = e.windPh[1];
    X.uWindDir[0] = e.windDir[0]; X.uWindDir[1] = e.windDir[1];
    X.uWindK = e.wind;

    e.wet = this.wet;
    e.rain = rain;
    e.storm = this.cur.storm;
    e.flash = this.flash * 0.55;
    e.hour = h;
    e.weather = this.weather;
    e.night = h < 12 ? 1 - smoothstep(4.6, 6.3, h) : smoothstep(18.7, 20.4, h);
    e.vignette = 0.42 + 0.18 * e.night + rain * 0.1;

    X.uRain = rain;
    X.uCloud = cl;
    X.uCloudVel[0] = e.cloudVel[0]; X.uCloudVel[1] = e.cloudVel[1];
    X.uRainDir[0] = e.windDir[0] * (0.15 + e.wind * 0.45); X.uRainDir[1] = 0;
    X.uCloudSh = cl * 0.1 - rain * 0.16;
    X.uNight = e.night;
    // caves: a cool, very dim ambient (torches and fires light them up fully)
    const nk = e.night;
    X.uCaveAmb[0] = 0.12 - 0.03 * nk; X.uCaveAmb[1] = 0.125 - 0.025 * nk; X.uCaveAmb[2] = 0.15 - 0.02 * nk;
    // god rays: the signature of the mornings (dawn → ~10 h, golden), softer late afternoon, none at night,
    // fading under heavy overcast and rain
    const mornR = smoothstep(5.75, 6.5, h) * (1 - smoothstep(7.8, 10.5, h));
    const eveR = smoothstep(15.6, 17.4, h) * (1 - smoothstep(18.5, 19.25, h)) * 0.55;
    X.uRays = isDay || h < 6.5 ? (mornR + eveR) * (1 - smoothstep(0.5, 0.92, cl)) * (1 - rain) : 0;
    e.rays = X.uRays;
    X.uSunXY[0] = e.sun3[0]; X.uSunXY[1] = e.sun3[1];
    X.uSnow = this.snowCover;
    e.snowCover = this.snowCover;
    return e;
  }

  clockString() {
    return `${formatDate(dateOf(this.dayIndex, this.hour))} · ${clockHHMM(this.hour)}`;
  }

}
