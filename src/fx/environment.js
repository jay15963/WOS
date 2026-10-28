// Day/night cycle + weather -> per-frame render parameters (env object consumed by Renderer).

import { clamp, lerp, smoothstep, mulberry32 } from '../engine/noise.js';

// hour, ambient light, color tint, saturation, contrast
const KF = [
  [0.0, [0.17, 0.20, 0.36], [0.88, 0.94, 1.12], 0.62, 1.02],
  [4.6, [0.17, 0.20, 0.36], [0.88, 0.94, 1.12], 0.62, 1.02],
  [5.6, [0.42, 0.36, 0.46], [1.02, 0.92, 0.98], 0.78, 1.02],
  [6.5, [0.98, 0.74, 0.58], [1.08, 0.96, 0.86], 1.04, 1.04],
  [8.0, [1.00, 0.95, 0.88], [1.04, 1.00, 0.95], 1.06, 1.04],
  [12.0, [1.00, 1.00, 1.00], [1.00, 1.00, 1.00], 1.08, 1.05],
  [16.5, [1.00, 0.96, 0.90], [1.03, 1.00, 0.95], 1.08, 1.05],
  [18.1, [1.00, 0.70, 0.52], [1.10, 0.93, 0.82], 1.12, 1.06],
  [19.1, [0.58, 0.42, 0.52], [1.02, 0.90, 0.98], 0.9, 1.04],
  [20.2, [0.19, 0.21, 0.37], [0.88, 0.94, 1.12], 0.64, 1.02],
  [24.0, [0.17, 0.20, 0.36], [0.88, 0.94, 1.12], 0.62, 1.02],
];

const WEATHERS = {
  clear:  { cloud: 0.15, rain: 0, fog: 0.0, wind: 0.15 },
  cloudy: { cloud: 0.75, rain: 0, fog: 0.05, wind: 0.35 },
  rain:   { cloud: 0.95, rain: 0.8, fog: 0.12, wind: 0.6 },
  fog:    { cloud: 0.5, rain: 0, fog: 0.5, wind: 0.05 },
};

export class Environment {
  constructor(seed = 1) {
    this.hour = 8.2;            // in-game hour 0..24
    this.dayIndex = 1;
    this.dayLength = 720;       // real seconds per in-game day
    this.rand = mulberry32(seed);
    this.weather = 'clear';
    this.weatherT = 120 + this.rand() * 120;
    this.cur = { ...WEATHERS.clear };
    this.wet = 0;
    this.flash = 0;
    this.env = {
      ambient: [1, 1, 1], tint: [1, 1, 1], sat: 1, contrast: 1, vignette: 0.55,
      shadowDir: [0, 0], shadowStr: 0.5, sun3: [0, 0, 1], sunI: 1, sky: [0.6, 0.7, 0.8],
      cloud: 0, day: 1, cloudVel: [0.004, 0.0016], fog: 0, fogCol: [0.8, 0.82, 0.85],
      wind: 0.2, wet: 0, rain: 0, flash: 0, hour: 8,
    };
  }

  setWeather(name) { if (WEATHERS[name]) { this.weather = name; this.weatherT = 150 + this.rand() * 200; } }

  update(dt) {
    this.hour += (dt / this.dayLength) * 24;
    if (this.hour >= 24) { this.hour -= 24; this.dayIndex++; }
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const r = this.rand();
      this.setWeather(r < 0.45 ? 'clear' : r < 0.7 ? 'cloudy' : r < 0.9 ? 'rain' : 'fog');
    }
    const target = WEATHERS[this.weather];
    const k = 1 - Math.exp(-dt / 12);
    for (const key in target) this.cur[key] = lerp(this.cur[key], target[key], k);
    this.wet = clamp(this.wet + (this.cur.rain > 0.3 ? dt / 40 : -dt / 90), 0, 1);
    // lightning during heavy rain
    if (this.cur.rain > 0.6 && this.rand() < dt * 0.02) this.flash = 0.35;
    this.flash = Math.max(0, this.flash - dt * 1.8);
  }

  compute() {
    const h = this.hour, e = this.env;
    let i = 0;
    while (i < KF.length - 2 && KF[i + 1][0] <= h) i++;
    const a = KF[i], b = KF[i + 1];
    const t = smoothstep(0, 1, (h - a[0]) / (b[0] - a[0]));
    for (let c = 0; c < 3; c++) {
      e.ambient[c] = lerp(a[1][c], b[1][c], t);
      e.tint[c] = lerp(a[2][c], b[2][c], t);
    }
    e.sat = lerp(a[3], b[3], t);
    e.contrast = lerp(a[4], b[4], t);

    // sun path: rises east (right), sets west (left), arcs through the south
    const dayK = (h - 5.8) / (19.4 - 5.8);
    const isDay = dayK > 0 && dayK < 1;
    let sx, sy, sz;
    if (isDay) {
      const ang = dayK * Math.PI;
      sx = Math.cos(ang); sz = Math.sin(ang) * 0.95 + 0.05; sy = 0.45;
    } else {
      // moon: gentle fixed-ish arc
      const nk = ((h - 19.4 + 24) % 24) / (24 - (19.4 - 5.8));
      const ang = nk * Math.PI;
      sx = Math.cos(ang) * 0.6; sz = 0.55 + Math.sin(ang) * 0.35; sy = 0.4;
    }
    const L = Math.hypot(sx, sy, sz);
    e.sun3[0] = sx / L; e.sun3[1] = sy / L; e.sun3[2] = sz / L;
    const hl = Math.hypot(sx, sy) || 1;
    const len = clamp(Math.hypot(sx, sy) / Math.max(sz, 0.2), 0.35, 1.9);
    e.shadowDir[0] = (-sx / hl) * len;
    e.shadowDir[1] = (-sy / hl) * len;
    const elev = isDay ? Math.sin(dayK * Math.PI) : 0;
    e.day = isDay ? smoothstep(0, 0.12, Math.min(dayK, 1 - dayK)) : 0;
    e.sunI = e.day * (1 - this.cur.cloud * 0.6);
    e.shadowStr = isDay ? (0.18 + 0.4 * smoothstep(0, 0.15, elev)) * (1 - this.cur.cloud * 0.75) : 0.12 * (1 - this.cur.cloud);
    e.sky = isDay ? [0.55 + 0.25 * (1 - elev), 0.68, 0.78] : [0.12, 0.16, 0.28];

    // weather influence
    const cl = this.cur.cloud;
    e.cloud = cl;
    const dim = 1 - cl * 0.22 - this.cur.rain * 0.12;
    for (let c = 0; c < 3; c++) e.ambient[c] *= dim;
    e.sat *= 1 - this.cur.rain * 0.25 - cl * 0.08;
    e.fog = this.cur.fog + (h > 4.5 && h < 8 ? 0.18 * Math.sin(((h - 4.5) / 3.5) * Math.PI) : 0);
    const fogLum = 0.35 + 0.55 * e.day;
    e.fogCol = [fogLum * 0.95, fogLum * 0.98, fogLum * 1.05];
    e.wind = this.cur.wind;
    e.wet = this.wet;
    e.rain = this.cur.rain;
    e.flash = this.flash;
    e.hour = h;
    e.night = 1 - smoothstep(0.0, 0.25, e.ambient[0] - 0.15);
    return e;
  }

  clockString() {
    const hh = Math.floor(this.hour), mm = Math.floor((this.hour - hh) * 60);
    return `Dia ${this.dayIndex} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
