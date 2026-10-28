// Day/night cycle + weather -> per-frame render parameters (env object consumed by Renderer).
// env.extra holds extra shader uniforms (terrain + post) applied generically by the renderer.

import { clamp, lerp, smoothstep, mulberry32 } from '../engine/noise.js';

// hour, ambient light, tint (gain), lift (shadow tint), saturation, contrast, sky (water reflection)
const KF = [
  [0.0,  [0.31, 0.35, 0.54], [0.92, 0.97, 1.12], [0.012, 0.018, 0.045], 0.62, 1.04, [0.10, 0.14, 0.27]],
  [4.2,  [0.31, 0.35, 0.54], [0.92, 0.97, 1.12], [0.012, 0.018, 0.045], 0.62, 1.04, [0.10, 0.14, 0.27]],
  [5.0,  [0.40, 0.41, 0.60], [0.95, 0.96, 1.09], [0.014, 0.016, 0.045], 0.70, 1.03, [0.26, 0.29, 0.46]],
  [5.8,  [0.74, 0.62, 0.64], [1.04, 0.96, 0.98], [0.020, 0.012, 0.030], 0.86, 1.03, [0.74, 0.60, 0.64]],
  [6.6,  [1.00, 0.86, 0.70], [1.06, 0.99, 0.91], [0.016, 0.010, 0.004], 1.04, 1.05, [0.86, 0.76, 0.66]],
  [8.0,  [1.00, 0.96, 0.89], [1.03, 1.00, 0.96], [0.006, 0.004, 0.000], 1.06, 1.05, [0.62, 0.72, 0.82]],
  [12.0, [1.00, 1.00, 1.00], [1.00, 1.00, 1.00], [0.000, 0.000, 0.004], 1.06, 1.05, [0.56, 0.70, 0.84]],
  [16.2, [1.00, 0.97, 0.91], [1.02, 1.00, 0.96], [0.004, 0.002, 0.000], 1.07, 1.05, [0.60, 0.70, 0.80]],
  [17.6, [1.00, 0.85, 0.68], [1.06, 0.98, 0.90], [0.016, 0.010, 0.004], 1.08, 1.06, [0.86, 0.72, 0.60]],
  [18.6, [0.90, 0.68, 0.62], [1.05, 0.94, 0.93], [0.020, 0.010, 0.022], 0.98, 1.05, [0.80, 0.58, 0.58]],
  [19.3, [0.52, 0.48, 0.66], [0.98, 0.94, 1.06], [0.014, 0.012, 0.045], 0.80, 1.04, [0.36, 0.34, 0.54]],
  [20.3, [0.32, 0.35, 0.55], [0.92, 0.97, 1.12], [0.012, 0.018, 0.045], 0.63, 1.04, [0.11, 0.15, 0.28]],
  [24.0, [0.31, 0.35, 0.54], [0.92, 0.97, 1.12], [0.012, 0.018, 0.045], 0.62, 1.04, [0.10, 0.14, 0.27]],
];

const WEATHERS = {
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
    this.dayLength = 720;       // real seconds per in-game day
    this.rand = mulberry32(seed);
    this.weather = 'clear';
    this.weatherT = 150 + this.rand() * 150;
    this.cur = { ...WEATHERS.clear };
    this.wet = 0;
    this.flash = 0;
    this.t = 0;
    this.windAng = this.rand() * Math.PI * 2;
    this.strikes = [];          // recent lightning: { t, dist } (audio reads it for thunder)
    this.strikeId = 0;
    this._nextStrike = 4;
    this.env = {
      ambient: [1, 1, 1], tint: [1, 1, 1], sat: 1, contrast: 1, vignette: 0.5,
      shadowDir: [0, 0], shadowStr: 0.5, sun3: [0, 0, 1], sunI: 1, sky: [0.6, 0.7, 0.8],
      cloud: 0, day: 1, cloudVel: [0.004, 0.0016], fog: 0, fogCol: [0.8, 0.82, 0.85],
      wind: 0.2, windDir: [1, 0], gust: 0, wet: 0, rain: 0, storm: 0, flash: 0, hour: 8, night: 0,
      weather: 'clear', mist: 0,
      extra: {
        uRain: 0, uSunWarm: [0, 0, 0], uCloud: 0, uCloudVel: [0, 0], uLift: [0, 0, 0], uRainDir: [0, 0],
        uMist: 0, uCloudSh: 0, uFlashCol: [0, 0, 0], uNight: 0,
      },
    };
  }

  setWeather(name) {
    if (!WEATHERS[name]) return;
    this.weather = name;
    this.weatherT = (name === 'storm' ? 70 : 150) + this.rand() * 200;
  }
  weatherName() { return WEATHER_NAMES_PT[this.weather] || this.weather; }

  update(dt) {
    this.t += dt;
    this.hour += (dt / this.dayLength) * 24;
    if (this.hour >= 24) { this.hour -= 24; this.dayIndex++; }
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
    this.windAng += dt * 0.004 * Math.sin(this.t * 0.01);

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
    if (isDay) { X.uSunWarm[0] = 0.22 * low; X.uSunWarm[1] = 0.03 * low; X.uSunWarm[2] = -0.24 * low; }
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
    // mist: morning lowland mist, a little at dusk, plus fog weather
    const morning = h > 4.3 && h < 9.2 ? Math.sin(((h - 4.3) / 4.9) * Math.PI) : 0;
    const evening = h > 19 && h < 22.5 ? Math.sin(((h - 19) / 3.5) * Math.PI) * 0.35 : 0;
    e.mist = (morning * 0.42 + evening) * (1 - this.cur.wind * 0.8);
    e.fog = this.cur.fog + morning * 0.06;
    X.uMist = e.mist;
    const glow = morning * 0.7 + evening * 0.5;
    const fogLum = 0.34 + 0.54 * Math.max(e.day, glow * 0.8);
    const warmF = isDay ? low * 0.6 : 0;
    e.fogCol[0] = fogLum * (0.94 + warmF * 0.12); e.fogCol[1] = fogLum * (0.97 + warmF * 0.02); e.fogCol[2] = fogLum * (1.06 - warmF * 0.1);
    if (!isDay) { e.fogCol[0] *= 0.62; e.fogCol[1] *= 0.7; e.fogCol[2] *= 0.95; }

    // wind with gusts
    const tt = this.t;
    const gust = clamp(0.5 + 0.5 * Math.sin(tt * 0.17) * Math.sin(tt * 0.43 + 1.3) + 0.25 * Math.sin(tt * 1.1 + 0.4) * Math.sin(tt * 0.07), 0, 1);
    e.gust = gust;
    e.wind = clamp(this.cur.wind * (0.7 + 0.6 * gust) + this.cur.storm * 0.2 * gust, 0, 1.2);
    e.windDir[0] = Math.cos(this.windAng); e.windDir[1] = Math.sin(this.windAng);
    const cs = 0.0035 + this.cur.wind * 0.006;
    e.cloudVel[0] = e.windDir[0] * cs; e.cloudVel[1] = e.windDir[1] * cs;

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
    return e;
  }

  clockString() {
    const hh = Math.floor(this.hour), mm = Math.floor((this.hour - hh) * 60);
    return `Dia ${this.dayIndex} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
