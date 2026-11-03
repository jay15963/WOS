// Preview images of the planet (pure: RGBA byte arrays, no DOM) for tools/planet.html and
// tools/planet-shots.mjs. Macro layers at 1 px per cell; detail views sample the tile-scale height.

import { MW, MH, CELL, W, H, ABYSS_M, metersToStories, seasonZoneOf } from './consts.js';
import { BIOME_LIST, BIOME, PG } from './biomes.js';
import { clamp, fbm } from './noise.js';
import { baseHeight, riverNode, riverHalfWidth, crPoint, lakeLevelNear, lakeIdNear } from './chunk.js';
import { storiesToMeters } from './consts.js';
import { seaIceAt } from './climate.js';

export const LAYERS = ['satellite', 'relief', 'biome', 'temp', 'rain', 'rivers', 'plates', 'water', 'seasons'];
export const LAYER_PT = { satellite: 'Satélite', relief: 'Relevo', biome: 'Biomas', temp: 'Temperatura', rain: 'Chuva', rivers: 'Rios e lagos', plates: 'Placas', water: 'Classes de água', seasons: 'Estações' };

const ramp = (stops, t) => {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k, a = stops[k], b = stops[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
};
const LAND = [[62, 118, 52], [96, 140, 66], [150, 158, 92], [168, 142, 98], [140, 112, 86], [150, 140, 134], [236, 238, 242]];
const SEA = [[8, 20, 52], [14, 40, 88], [26, 76, 130], [52, 120, 164], [86, 160, 184]];
const TEMP = [[60, 40, 140], [60, 110, 220], [120, 200, 240], [240, 240, 200], [250, 190, 80], [230, 90, 40], [150, 20, 20]];
const RAIN = [[150, 100, 50], [210, 180, 110], [230, 230, 160], [130, 200, 120], [40, 150, 120], [20, 90, 160], [30, 40, 120]];
const PLATE_C = (k) => [70 + ((k * 97) % 150), 70 + ((k * 57) % 150), 80 + ((k * 151) % 140)];

export function hypso(e) {
  if (e < 0) return ramp(SEA, 1 + Math.max(-6000, e) / 6000);
  return ramp(LAND, metersToStories(e) / 15);
}

// shade 0.4..1.3 from a height field sampler (light from the north-west)
function shadeAt(hx0, hx1, hy0, hy1, k) {
  const gx = (hx1 - hx0) * k, gy = (hy1 - hy0) * k;
  const l = (-gx - gy) / Math.sqrt(gx * gx + gy * gy + 1) * 0.7071 + 1 / Math.sqrt(gx * gx + gy * gy + 1);
  return clamp(0.35 + 0.75 * l, 0.35, 1.35);
}

export function renderMacro(planet, layer = 'satellite') {
  const out = new Uint8ClampedArray(MW * MH * 4);
  const E = planet.elev, at = (x, y) => E[clamp(y, 0, MH - 1) * MW + ((x + MW) % MW)];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * MW + x, o = i * 4;
    const e = E[i];
    const land = !planet.ocean[i];
    const sh = land ? shadeAt(metersToStories(at(x - 1, y)), metersToStories(at(x + 1, y)), metersToStories(at(x, y - 1)), metersToStories(at(x, y + 1)), 0.9) : 1;
    let c;
    switch (layer) {
      case 'relief': c = hypso(e).map((v) => v * (land ? sh : 1)); break;
      case 'biome': c = BIOME_LIST[planet.biome[i]].c.map((v) => v * (land ? 0.75 + 0.25 * sh : 1)); break;
      case 'temp': c = ramp(TEMP, (planet.tMean[i] + 30) / 62).map((v) => v * (land ? 0.85 + 0.15 * sh : 0.8)); break;
      case 'rain': c = land ? ramp(RAIN, Math.sqrt(planet.precip[i] / 4000)).map((v) => v * (0.85 + 0.15 * sh)) : [40, 50, 70]; break;
      case 'plates': {
        c = PLATE_C(planet.plate[i]).map((v) => v * (land ? 1 : 0.55));
        const k = planet.bkind[i];
        if (k && planet.bconv && Math.abs(planet.bconv[i]) > 0) {
          if (k === 1 || k === 2 || k === 4) c = [230, 60, 50];
          else if (k === 3) c = [130, 30, 30];
          else if (k === 5 || k === 6) c = [60, 140, 240];
          else if (k === 7) c = [240, 220, 60];
        }
        break;
      }
      case 'water': {
        const wc = planet.water[i];
        c = wc === 0 ? [205, 196, 170] : wc === 2 ? [60, 130, 190] : wc === 3 ? [12, 24, 60] : [90, 170, 210];
        if (e < 0 && e > -60) c = [140, 200, 220];
        break;
      }
      case 'seasons': {
        const z = seasonZoneOf(planet.tMean[i], planet.tAmp[i]);
        c = [[60, 150, 60], [170, 190, 80], [120, 160, 200], [90, 110, 190], [230, 235, 245]][z].map((v) => v * (land ? 0.8 + 0.2 * sh : 0.45));
        break;
      }
      case 'rivers': c = land ? [200, 196, 184].map((v) => v * (0.85 + 0.15 * sh)) : [60, 80, 110]; break;
      default: c = satColor(planet, i, sh);
    }
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
  }
  if (layer === 'rivers' || layer === 'satellite' || layer === 'biome') drawMacroRivers(planet, out, layer === 'rivers' ? 1 : 0.7);
  return out;
}

export function satColor(planet, i, sh) {
  const e = planet.elev[i];
  if (planet.ocean[i]) {
    if (planet.biome[i] === BIOME.SEA_ICE) return [222, 232, 240];
    return ramp(SEA, 1 + Math.max(-6000, e) / 6000);
  }
  const b = BIOME_LIST[planet.biome[i]];
  let c = b.c;
  if (planet.lakeId[i]) return b.c;
  return [c[0] * sh, c[1] * sh, c[2] * sh];
}

function drawMacroRivers(planet, out, alpha) {
  const { rkind, flow, lakeId } = planet;
  for (let i = 0; i < MW * MH; i++) {
    const o = i * 4;
    if (lakeId[i] && !planet.ocean[i]) {
      const lk = planet.lakes[lakeId[i] - 1];
      const c = lk.dry ? [236, 232, 222] : lk.salt ? [96, 170, 180] : [40, 100, 170];
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
      continue;
    }
    if (rkind[i] !== 1 && rkind[i] !== 3) continue;
    const a = clamp((0.25 + Math.sqrt(flow[i]) * 0.12) * alpha, 0, 1);
    out[o] = out[o] * (1 - a) + 30 * a; out[o + 1] = out[o + 1] * (1 - a) + 90 * a; out[o + 2] = out[o + 2] * (1 - a) + 200 * a;
  }
}

// ---------- tile-scale image of an assembled tile window ----------
// win = { w, h, height (corners (w+1)*(h+1), stories), water, ground, biome, rock, objects } -> RGBA (scale px per tile)
const ROCK_C = [null, [128, 122, 116], [176, 168, 146], [92, 92, 98], [210, 206, 200], [60, 56, 58], [186, 112, 72]];
const GROUND_C = [[118, 96, 64], [86, 70, 44], [222, 204, 150], [150, 142, 128], [88, 102, 64], [104, 86, 62], [132, 128, 122], [72, 104, 52], [242, 244, 248], [200, 222, 236], [56, 50, 50], [240, 236, 228], [176, 100, 64], [176, 154, 110]];
export function renderTileWindow(win, scale = 2, opts = {}) {
  const { w, h } = win, Wp = w * scale, Hp = h * scale;
  const out = new Uint8ClampedArray(Wp * Hp * 4);
  const C = win.height, cw = w + 1;
  const hc = (x, y) => C[y * cw + x];
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    const i = ty * w + tx;
    const h00 = hc(tx, ty), h10 = hc(tx + 1, ty), h01 = hc(tx, ty + 1), h11 = hc(tx + 1, ty + 1);
    const sh = shadeAt((h00 + h01) / 2, (h10 + h11) / 2, (h00 + h10) / 2, (h01 + h11) / 2, 1.6);
    const wc = win.water[i];
    let c;
    const bm = BIOME_LIST[win.biome[i]];
    if (wc) {
      const depth = (win.wlevel ? win.wlevel[i] : 0) - (h00 + h10 + h01 + h11) / 4;
      if (win.biome[i] === BIOME.SEA_ICE) c = [214, 226, 236];
      else if (wc === 3) c = [6, 14, 40];
      else if (wc === 2) c = ramp([[46, 116, 164], [32, 90, 146], [26, 74, 130]], clamp(depth / 5, 0, 1));
      else c = win.biome[i] === BIOME.REEF ? [70, 186, 180] : [72, 150, 176];
      if (win.flowX && (win.flowX[i] || win.flowY[i])) c = [c[0] * 0.9, c[1] * 1.0, c[2] * 1.08];
    } else {
      const g = GROUND_C[win.ground[i]] || [255, 0, 255];
      const bc = bm.c;
      c = [g[0] * 0.55 + bc[0] * 0.45, g[1] * 0.55 + bc[1] * 0.45, g[2] * 0.55 + bc[2] * 0.45];
      if (win.rock[i]) c = win.ground[i] === PG.SNOW ? [230, 232, 238] : ROCK_C[win.rockType[i]] || [112, 106, 100];
      c = c.map((v) => v * sh);
    }
    for (let py = 0; py < scale; py++) for (let px = 0; px < scale; px++) {
      const o = ((ty * scale + py) * Wp + tx * scale + px) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  if (opts.objects !== false && win.objects) {
    for (const ob of win.objects) {
      const t = ob.type;
      let col = null, r = 0;
      if (t.startsWith('tree_') || t === 'bamboo') { col = treeColor(t); r = scale * 0.75 * (ob.s || 1); }
      else if (t === 'cactus' || t === 'cactus_tall' || t === 'agave') { col = [70, 120, 60]; r = scale * 0.45; }
      else if (t === 'boulder' || t === 'lichen_rock') { col = [120, 116, 110]; r = scale * 0.5; }
      else if (t === 'bush' || t === 'berrybush' || t === 'herbbush' || t === 'tussock' || t === 'tundra_shrub' || t === 'shrub_desert' || t === 'papyrus') { col = [70, 100, 50]; r = scale * 0.45; }
      if (!col) continue;
      const cx = ob.x * scale, cy = ob.y * scale;
      const R = Math.max(1, r), R2 = R * R;
      for (let py = Math.floor(cy - R); py <= Math.ceil(cy + R); py++) for (let px = Math.floor(cx - R); px <= Math.ceil(cx + R); px++) {
        if (px < 0 || py < 0 || px >= Wp || py >= Hp) continue;
        const d2 = (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2;
        if (d2 > R2) continue;
        const o = (py * Wp + px) * 4, k = 1 - 0.35 * (d2 / R2) - ((px + 0.5 - cx) + (py + 0.5 - cy) < 0 ? -0.12 : 0.1);
        out[o] = col[0] * k; out[o + 1] = col[1] * k; out[o + 2] = col[2] * k;
      }
    }
  }
  if (opts.features && win.features) {
    for (const f of win.features) {
      const col = f.t === 'waterfall' ? [255, 255, 255] : f.t === 'spring' ? [120, 220, 255] : f.t === 'crater' ? [255, 90, 40] : null;
      if (!col) continue;
      const cx = f.x * scale, cy = f.y * scale, R = scale * 2.2;
      for (let py = Math.floor(cy - R); py <= cy + R; py++) for (let px = Math.floor(cx - R); px <= cx + R; px++) {
        if (px < 0 || py < 0 || px >= Wp || py >= Hp) continue;
        const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if (d > R || d < R - 1.4) continue;
        const o = (py * Wp + px) * 4; out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2];
      }
    }
  }
  return { data: out, w: Wp, h: Hp };
}
function treeColor(t) {
  switch (t) {
    case 'tree_pine': case 'tree_spruce': case 'tree_larch': case 'tree_redwood': case 'tree_cypress': return [30, 66, 44];
    case 'tree_birch': return [110, 150, 70];
    case 'tree_dead': return [100, 84, 66];
    case 'tree_palm': return [90, 150, 60];
    case 'tree_acacia': case 'tree_baobab': return [110, 120, 50];
    case 'tree_mangrove': return [50, 90, 50];
    case 'tree_olive': return [120, 130, 90];
    case 'tree_dwarf': return [90, 110, 70];
    default: return [44, 96, 40];
  }
}
export { W, H, CELL, ABYSS_M };

// ---------- detail view: the real tile-scale height sampled every (W / w) tiles ----------
// Whole planet (or opts.x0..x1, y0..y1 in tiles) -> { data RGBA, w, h }. Biome colours blend between macro cells
// (ecotones), snow follows the local altitude, sea ice has ragged pack-ice edges, rivers are drawn as splines.
export function renderDetail(planet, w = 2048, h = 1024, opts = {}) {
  const x0 = opts.x0 ?? 0, y0 = opts.y0 ?? 0, x1 = opts.x1 ?? W, y1 = opts.y1 ?? H;
  const sx = (x1 - x0) / w, sy = (y1 - y0) / h;
  const hgt = new Float32Array(w * h), col = new Float32Array(w * h * 3), wet = new Uint8Array(w * h);
  const o = {}, B = planet.biome, BL = BIOME_LIST;
  const sd = planet.seed * 1009;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = x0 + (px + 0.5) * sx, y = y0 + (py + 0.5) * sy, i = py * w + px;
    const hh = baseHeight(planet, x, y, o);
    let c;
    const lv = lakeLevelNear(planet, x, y);
    if (hh < 0 && o.oceanNear) {
      const ice = seaIceAt(planet.seed, x, y, o.T);
      const tex = fbm(x, y, sd + 41, 64, 3);
      c = ice === 1 ? [222 + 30 * tex, 232 + 20 * tex, 240 + 10 * tex] : ice === 2 ? [190, 210, 224] : ramp(SEA, 1 + Math.max(-6000, o.em) / 6000);
      wet[i] = ice ? 2 : 1;
      hgt[i] = ice ? 0.2 : 0;
    } else if (lv === lv && hh < metersToStories(lv) + 0.05) {
      const lk = planet.lakes[lakeIdNear(planet, x, y) - 1];
      c = lk && lk.dry ? [234, 230, 220] : lk && lk.salt ? [96, 166, 176] : [44, 98, 156];
      wet[i] = 1; hgt[i] = metersToStories(lv);
    } else {
      const ws = [o.w00, o.w10, o.w01, o.w11], cs = [o.c00, o.c10, o.c01, o.c11];
      c = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        let bc = BL[B[cs[k]]];
        if (bc.water) bc = BL[BIOME.BEACH];
        c[0] += bc.c[0] * ws[k]; c[1] += bc.c[1] * ws[k]; c[2] += bc.c[2] * ws[k];
      }
      // local altitude: snow line, bare rock on steep high ground
      const Tl = o.T - 0.0065 * (storiesToMeters(Math.max(0, hh)) - Math.max(0, o.e)) + 1.5 * fbm(x, y, sd + 42, 256, 2);
      if (o.mtn > 0.3 && o.ridge > 0.62) { const k = clamp((o.ridge - 0.62) * 4, 0, 0.6); c = [c[0] * (1 - k) + 120 * k, c[1] * (1 - k) + 112 * k, c[2] * (1 - k) + 104 * k]; }
      const sn = clamp((-4.5 - Tl) / 3, 0, 1);
      if (sn > 0) c = [c[0] + (244 - c[0]) * sn, c[1] + (246 - c[1]) * sn, c[2] + (250 - c[2]) * sn];
      if (hh < 0.25 && o.e < 80 && o.oceanNear) { const k = clamp((0.25 - hh) * 3, 0, 0.7); c = [c[0] + (226 - c[0]) * k, c[1] + (210 - c[1]) * k, c[2] + (160 - c[2]) * k]; }
      hgt[i] = hh;
    }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const k = 2.2 * Math.sqrt(32 / sx);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const i = py * w + px;
    const hx0 = hgt[py * w + Math.max(0, px - 1)], hx1 = hgt[py * w + Math.min(w - 1, px + 1)];
    const hy0 = hgt[Math.max(0, py - 1) * w + px], hy1 = hgt[Math.min(h - 1, py + 1) * w + px];
    let sh = wet[i] === 1 ? 1 : shadeAt(hx0, hx1, hy0, hy1, k / Math.max(1, 0.5 + 0.08 * Math.max(0, hgt[i])));
    if (col[i * 3 + 2] > 225 && col[i * 3] > 200) sh = 0.8 + 0.22 * sh; // snow and ice: soft shading
    out[i * 4] = col[i * 3] * sh; out[i * 4 + 1] = col[i * 3 + 1] * sh; out[i * 4 + 2] = col[i * 3 + 2] * sh; out[i * 4 + 3] = 255;
  }
  // rivers: splines through the macro river nodes, width by flow (at least a thin line)
  const { rkind, flow, down, upMain, ocean } = planet;
  for (let c = 0; c < MW * MH; c++) {
    const kd = rkind[c];
    if (kd !== 1 && kd !== 3) continue;
    const d = down[c];
    if (d < 0) continue;
    const P1 = riverNode(planet, c), P2 = riverNode(planet, d);
    const un = (q) => { let dx = q[0] - P1[0]; if (dx > W / 2) q[0] -= W; else if (dx < -W / 2) q[0] += W; return q; };
    un(P2);
    const um = upMain[c];
    const P0 = um >= 0 ? un(riverNode(planet, um)) : [2 * P1[0] - P2[0], 2 * P1[1] - P2[1]];
    const dd = down[d];
    const P3 = dd >= 0 && !ocean[d] ? un(riverNode(planet, dd)) : [2 * P2[0] - P1[0], 2 * P2[1] - P1[1]];
    const P = [P0[0], P0[1], P1[0], P1[1], P2[0], P2[1], P3[0], P3[1]];
    const hw = riverHalfWidth(flow[c], kd) * (opts.riverBoost ?? 1);
    const rp = Math.max(0.35, hw / sx);
    const a = clamp(0.35 + rp * 0.6, 0, 1);
    const steps = Math.max(4, Math.ceil(40 / sx));
    for (let s2 = 0; s2 <= steps; s2++) {
      const [qx, qy] = crPoint(P, s2 / steps);
      let fx = (qx - x0) / sx, fy = (qy - y0) / sy;
      if (fx < -2) fx += W / sx; else if (fx > w + 2) fx -= W / sx;
      const r = Math.max(0.5, rp);
      for (let yy = Math.floor(fy - r); yy <= Math.ceil(fy + r); yy++) for (let xx = Math.floor(fx - r); xx <= Math.ceil(fx + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const dd2 = (xx + 0.5 - fx) ** 2 + (yy + 0.5 - fy) ** 2;
        if (dd2 > r * r + 0.25) continue;
        const j = (yy * w + xx) * 4;
        if (wet[yy * w + xx]) continue;
        out[j] = out[j] * (1 - a) + 42 * a; out[j + 1] = out[j + 1] * (1 - a) + 96 * a; out[j + 2] = out[j + 2] * (1 - a) + 168 * a;
      }
    }
  }
  return { data: out, w, h };
}
