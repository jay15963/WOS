// Climate on the macro grid: mean annual temperature (°C), seasonal amplitude (°C), precipitation (mm/yr).
//
// Temperature: latitude curve + lapse rate (-6.5 °C/km) + ocean currents (cold currents off subtropical west
// coasts, warm currents off east coasts, a warm drift on mid-latitude west coasts) + continentality.
// Winds by latitude band: trade winds (blow west, 0-30°), westerlies (blow east, 30-60°), polar easterlies.
// Moisture is carried along the wind across every row (two laps round the planet): oceans evaporate, land rains
// it out (more on the windward slope of a mountain, much less in its lee = rain shadow), plants give some back.
// A weaker isotropic humidity spread from all coasts is mixed in. ITCZ wet belt, dry subtropical highs.

import { MW, MH, sinLatCell } from './consts.js';
import { clamp, smoothstep } from './noise.js';
import { N, nbTable, distField, blur } from './grid.js';

// sea-level mean temperature by |sin(lat)| (equator 27 °C, 30° ~25, 45° ~16, 60° ~0, pole -25)
export function baseTemp(s) {
  const s2 = s * s;
  return 27 - 52 * s2 * s2 * Math.sqrt(s);
}
// rain efficiency by |sin(lat)|: ITCZ wet, subtropical highs dry, mid-latitude storms, dry poles
const RS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
const RV = [2.1, 1.85, 1.05, 0.42, 0.26, 0.4, 0.82, 1.05, 0.92, 0.5, 0.28];
export function latRain(s) {
  let k = 0;
  while (k < RS.length - 2 && s > RS[k + 1]) k++;
  const t = (s - RS[k]) / (RS[k + 1] - RS[k]);
  return RV[k] + (RV[k + 1] - RV[k]) * clamp(t, 0, 1);
}
// share of the year the wind blows westward (trades / polar easterlies) at |sin(lat)| s
export function westward(s) {
  let w;
  if (s < 0.42) w = 1;
  else if (s < 0.58) w = 1 - smoothstep(0.42, 0.58, s);
  else if (s < 0.8) w = 0;
  else if (s < 0.92) w = smoothstep(0.8, 0.92, s);
  else w = 1;
  return 0.1 + 0.8 * w;
}
// potential evapotranspiration (mm/yr)
export const pet = (T) => clamp(55 * (T + 4), 0, 1750);
const qsat = (T) => { const a = clamp((T + 14) / 42, 0.02, 1.15); return a * a + 0.03; };

export function computeClimate(elev, ocean) {
  const T8 = nbTable();
  const tMean = new Float32Array(N), tAmp = new Float32Array(N), precip = new Float32Array(N);
  const anom = new Float32Array(N), evapF = new Float32Array(N).fill(1);
  // ---- ocean currents: per row, distance to land east / west of each ocean cell
  for (let y = 0; y < MH; y++) {
    const s = Math.abs(sinLatCell(y)), row = y * MW;
    const dE = new Float32Array(MW).fill(999), dW = new Float32Array(MW).fill(999);
    for (let lap = 0; lap < 2; lap++) {
      let d = 999;
      for (let k = MW - 1; k >= 0; k--) { const i = row + k; d = ocean[i] ? d + 1 : 0; if (lap) dE[k] = d; }
    }
    for (let lap = 0; lap < 2; lap++) {
      let d = 999;
      for (let k = 0; k < MW; k++) { const i = row + k; d = ocean[i] ? d + 1 : 0; if (lap) dW[k] = d; }
    }
    for (let k = 0; k < MW; k++) {
      const i = row + k;
      if (!ocean[i]) continue;
      const fe = clamp(1 - dE[k] / 14, 0, 1), fw = clamp(1 - dW[k] / 14, 0, 1);
      const sub = smoothstep(0.12, 0.25, s) * (1 - smoothstep(0.55, 0.68, s));
      const mid = smoothstep(0.62, 0.72, s) * (1 - smoothstep(0.86, 0.94, s));
      // land to the east = this is off a west coast
      anom[i] = -5.5 * fe * sub + 3 * fw * sub + 4 * fe * mid;
      evapF[i] = 1 - 0.65 * fe * sub + 0.3 * fw * sub;
    }
  }
  const anomB = blur(blur(anom, 3), 3);
  const dOcean = distField((i) => ocean[i] === 1, 60);
  for (let i = 0; i < N; i++) {
    const y = (i - (i % MW)) / MW, s = Math.abs(sinLatCell(y));
    const e = elev[i];
    let T = baseTemp(s) + (ocean[i] ? anom[i] : anomB[i] * 1.6 * clamp(1 - dOcean[i] / 10, 0, 1));
    if (!ocean[i]) {
      const cont = smoothstep(0, 30, dOcean[i]);
      T += (s < 0.5 ? 1.2 : -2.6 * smoothstep(0.5, 0.9, s)) * cont;
      T -= 0.0065 * Math.max(0, e);
      const s15 = s * Math.sqrt(s);
      tAmp[i] = (2 + 40 * s15) * (0.3 + 0.7 * cont);
    } else {
      tAmp[i] = (1.5 + 14 * s * s) * 0.6;
    }
    tMean[i] = T;
  }
  // ---- moisture along the zonal winds (both directions, blended per row)
  const pz = new Float32Array(N);
  for (let y = 0; y < MH; y++) {
    const s = Math.abs(sinLatCell(y)), lr = latRain(s), ww = westward(s), row = y * MW;
    for (const dir of [-1, 1]) {
      const wgt = dir < 0 ? ww : 1 - ww;
      // start just downwind of an ocean cell if there is one
      let x0 = 0;
      for (let k = 0; k < MW; k++) if (ocean[row + k]) { x0 = k; break; }
      let q = 0, hPrev = 0;
      for (let step = 0; step < MW * 2; step++) {
        const x = ((x0 + dir * step) % MW + MW) % MW, i = row + x;
        const T = tMean[i];
        let p;
        if (ocean[i]) {
          q += (qsat(T) * evapF[i] - q) * 0.22;
          p = q * 0.05 * lr;
          hPrev = 0;
        } else {
          const h = Math.max(0, elev[i]);
          const dh = h - hPrev;
          const oro = dh > 0 ? dh / 650 : 0, lee = dh < 0 ? -dh / 850 : 0;
          let rate = (0.05 * lr + 0.6 * oro) / (1 + 2.4 * lee);
          if (rate > 0.85) rate = 0.85;
          p = q * rate;
          q -= p;
          q += p * (0.3 + 0.45 * clamp((T + 2) / 28, 0, 1)); // evapotranspiration given back
          hPrev = h;
        }
        if (step >= MW) pz[i] += p * wgt;
      }
    }
  }
  // ---- isotropic humidity from the coasts (mountains block it)
  let hum = new Float32Array(N);
  for (let i = 0; i < N; i++) if (ocean[i]) hum[i] = qsat(tMean[i]) * evapF[i];
  for (let it = 0; it < 26; it++) {
    const nh = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (ocean[i]) { nh[i] = hum[i]; continue; }
      let a = 0, n = 0;
      const ei = Math.max(0, elev[i]);
      for (let k = 0; k < 8; k++) {
        const j = T8[i * 8 + k];
        if (j < 0) continue;
        const rise = ei - Math.max(0, elev[j]);
        a += hum[j] / (1 + (rise > 0 ? rise / 700 : 0));
        n++;
      }
      nh[i] = (a / n) * 0.94;
    }
    hum = nh;
  }
  for (let i = 0; i < N; i++) {
    const y = (i - (i % MW)) / MW, lr = latRain(Math.abs(sinLatCell(y)));
    precip[i] = pz[i] + hum[i] * 0.06 * lr * 0.5;
  }
  const pb = blur(blur(precip, 2), 1);
  for (let i = 0; i < N; i++) precip[i] = pb[i] * 40000;
  return { tMean, tAmp, precip, dOcean };
}
