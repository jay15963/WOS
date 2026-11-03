// Terrain window contents of a tile rect (pure: runs on the main thread or in src/world/terrainWorker.js).
// Input = the world layers over the rect + a margin of MD tiles, gathered by terrainWindow.js (gatherTerrain):
//   { tw, th, x0, y0, DW, DH, u8: { rock, water, rock0, ground, rockType, ore, biome, caveDk, tramp, solid, inb },
//     f32: { lush, flowX, flowY }, coldLut }
// (row-major DW × DH, origin at (x0 − MD, y0 − MD); `inb` = 1 inside the world, outside tiles hold the nearest edge
// tile's values like the old clamped textures).
// Output = { tile, field2, cave, clim (tw × th × RGBA), field (tw·4 × th·4 × RGBA), cold, walls (tw × th: world.solid) } — the same
// contents as the old world-sized textures (see src/world/terrainWindow.js).

export const MD = 12, MS = 3, FR = 4, CR = 3;
// the planet's grounds 8..13 have their own texture layers: the tile shows them while the classic ground under them is
// still their stand-in (planet/biomes.js GROUND_CLASSIC; a mined tile turns to stone and shows stone)
const PG_CLASSIC = [0, 1, 2, 3, 4, 5, 6, 7, 6, 6, 3, 2, 0, 0];
// canopy shade of the planet's closed forests by planet biome (planet/biomes.js ids: taiga 12, temperate forest 13,
// temperate rainforest 14, rainforest 23, cloud forest 24, mangrove 25, swamp 26)
const CANOPY = new Uint8Array(64);
CANOPY[23] = 255; CANOPY[24] = 210; CANOPY[14] = 170; CANOPY[25] = 140; CANOPY[12] = 90; CANOPY[26] = 80; CANOPY[13] = 70;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// scratch buffers reused between calls (one thread each)
const S = { n: 0 };
function scratch(name, Ctor, n) {
  const a = S[name];
  if (a && a.length >= n) return a;
  return (S[name] = new Ctor(n));
}

export function computeTerrain(inp) {
  const { tw, th, x0, y0, DW, DH, u8, f32, coldLut } = inp;
  const N = DW * DH;
  const rock = u8.rock, wat = u8.water;
  // ---- distance fields over the whole margin window
  const INF = 99;
  const dIn = scratch('dIn', Float32Array, N), dWt = scratch('dWt', Float32Array, N), dOut = scratch('dOut', Float32Array, N);
  for (let j = 0; j < N; j++) { const r = rock[j]; dIn[j] = r ? INF : 0; dWt[j] = wat[j] ? 0 : INF; dOut[j] = r ? 0 : INF; }
  chamfer(dIn, DW, DH); chamfer(dWt, DW, DH); chamfer(dOut, DW, DH);
  const out = {
    tile: new Uint8Array(tw * th * 4), field2: new Uint8Array(tw * th * 4), cave: new Uint8Array(tw * th * 4),
    clim: new Uint8Array(tw * th * 4), field: new Uint8Array(tw * th * FR * FR * 4), cold: new Uint8Array(tw * th), walls: new Uint8Array(tw * th),
  };
  // ---- cold: box blur (radius CR) of the biome's cold value
  const cw = tw + 2 * CR, chh = th + 2 * CR, cold = scratch('cold', Float32Array, cw * chh), ctmp = scratch('ctmp', Float32Array, cw * chh);
  const ob = MD - CR, BI = u8.biome;
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) cold[y * cw + x] = coldLut[BI[(y + ob) * DW + x + ob]];
  const kb = 1 / (2 * CR + 1);
  for (let y = 0; y < chh; y++) {
    let a = 0;
    for (let d = 0; d < 2 * CR + 1; d++) a += cold[y * cw + d];
    for (let x = CR; x < cw - CR; x++) { ctmp[y * cw + x] = a * kb; if (x + CR + 1 < cw) a += cold[y * cw + x + CR + 1] - cold[y * cw + x - CR]; }
  }
  // ---- per tile: tile, field2, cave, clim
  const T = out.tile, F2 = out.field2, CV = out.cave, CL = out.clim, CO = out.cold;
  const Gd = u8.ground, RT = u8.rockType, O = u8.ore, K0 = u8.rock0, CD = u8.caveDk, TR = u8.tramp, SO = u8.solid, IN = u8.inb;
  const LU = f32.lush, FX = f32.flowX, FY = f32.flowY, PGr = u8.pground, PR = u8.prock, PB = u8.pbiome;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const X = x0 + tx, Y = y0 + ty, o = (ty * tw + tx) * 4, j = (ty + MD) * DW + tx + MD;
    const pgj = PGr ? PGr[j] : 0;
    T[o] = pgj >= 8 && PG_CLASSIC[pgj] === Gd[j] ? pgj : Gd[j]; T[o + 1] = (X * 73 + Y * 151) & 255; T[o + 2] = (PR && PR[j]) || RT[j]; T[o + 3] = O[j];
    F2[o] = clamp(LU[j] * 255, 0, 255); F2[o + 1] = clamp(128 + FX[j] * 127, 0, 255); F2[o + 2] = clamp(128 + FY[j] * 127, 0, 255);
    F2[o + 3] = clamp(Math.round((dOut[j] / 4) * 255), 0, 255);
    const ore = O[j - DW - 1] | O[j - DW] | O[j - DW + 1] | O[j - 1] | O[j] | O[j + 1] | O[j + DW - 1] | O[j + DW] | O[j + DW + 1];
    const inside = IN[j];
    CV[o] = inside ? CD[j] : 0; CV[o + 1] = ore ? 255 : 0; CV[o + 2] = TR[j]; CV[o + 3] = K0[j] && !rock[j] ? 255 : 0;
    let a = 0;
    for (let d = -CR; d <= CR; d++) a += ctmp[(ty + CR + d) * cw + tx + CR];
    const cv = Math.round(Math.min(1, a * kb) * 255), s = inside ? SO[j] : 0;
    // B: the planet's closed canopy (shade), A: its permanent snow / ice (world/planet/biomes.js PG 8, 9)
    CL[o] = cv; CL[o + 1] = s === 1 ? 255 : s ? 128 : 0; CL[o + 2] = PB ? CANOPY[PB[j]] : 0; CL[o + 3] = pgj === 8 || pgj === 9 ? 255 : 0;
    CO[ty * tw + tx] = cv; out.walls[ty * tw + tx] = s;
  }
  // ---- field (FR×): rock mask / massif height / water depth / wetness, blurred over the rect + MS
  const ww = tw + 2 * MS, wh = th + 2 * MS, sw = ww * FR, sh = wh * FR, SN = sw * sh, ofs = MD - MS;
  const rockM = scratch('rockM', Float32Array, SN), height = scratch('height', Float32Array, SN), wv = scratch('wv', Float32Array, SN), wet = scratch('wet', Float32Array, SN);
  const hTile = scratch('hTile', Float32Array, ww * wh), wetTile = scratch('wetTile', Float32Array, ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const j = (y + ofs) * DW + x + ofs, t = y * ww + x;
    // massif height: rises over ~7 tiles inside the rock (ridges along the medial axis)
    const d = Math.max(0, dIn[j] - 0.5);
    hTile[t] = clamp(1 - Math.exp(-d / 3.2), 0, 1);
    wetTile[t] = dWt[j] === 0 ? 1 : clamp(1 - (dWt[j] - 1) / 2.5, 0, 1);
  }
  const cx0 = scratch('cx0', Int32Array, sw), cx1 = scratch('cx1', Int32Array, sw), cux = scratch('cux', Float32Array, sw);
  for (let sx = 0; sx < sw; sx++) {
    const fx = (sx + 0.5) / FR - 0.5, ix = Math.floor(fx);
    cx0[sx] = clamp(ix, 0, ww - 1); cx1[sx] = clamp(ix + 1, 0, ww - 1); cux[sx] = fx - ix;
  }
  for (let sy = 0; sy < sh; sy++) {
    const fy = (sy + 0.5) / FR - 0.5, iy = Math.floor(fy), uy = fy - iy;
    const r0 = clamp(iy, 0, wh - 1) * ww, r1 = clamp(iy + 1, 0, wh - 1) * ww;
    const ty = (sy / FR) | 0, trow = (ty + ofs) * DW + ofs, srow = sy * sw;
    for (let sx = 0; sx < sw; sx++) {
      const ti = trow + ((sx / FR) | 0), s = srow + sx;
      rockM[s] = rock[ti] ? 1 : 0;
      const wv0 = wat[ti];
      wv[s] = wv0 >= 2 ? 1 : wv0 === 1 ? 0.55 : 0;
      const a0 = cx0[sx], a1 = cx1[sx], ux = cux[sx];
      const ha = hTile[r0 + a0] + (hTile[r0 + a1] - hTile[r0 + a0]) * ux;
      const hb = hTile[r1 + a0] + (hTile[r1 + a1] - hTile[r1 + a0]) * ux;
      height[s] = ha + (hb - ha) * uy;
      const ea = wetTile[r0 + a0] + (wetTile[r0 + a1] - wetTile[r0 + a0]) * ux;
      const eb = wetTile[r1 + a0] + (wetTile[r1 + a1] - wetTile[r1 + a0]) * ux;
      wet[s] = ea + (eb - ea) * uy;
    }
  }
  const tmp = scratch('btmp', Float32Array, SN);
  blur(rockM, sw, sh, 2, tmp); blur(rockM, sw, sh, 2, tmp);
  blur(height, sw, sh, 3, tmp);
  blur(wv, sw, sh, 3, tmp); blur(wv, sw, sh, 3, tmp);
  blur(wet, sw, sh, 2, tmp);
  const F = out.field, FW = tw * FR;
  for (let ty = 0; ty < th; ty++) for (let ky = 0; ky < FR; ky++) {
    const sy = (ty + MS) * FR + ky, orow = (ty * FR + ky) * FW;
    for (let tx = 0; tx < tw; tx++) for (let kx = 0; kx < FR; kx++) {
      const s = sy * sw + (tx + MS) * FR + kx, o = (orow + tx * FR + kx) * 4;
      F[o] = rockM[s] * 255; F[o + 1] = height[s] * 255; F[o + 2] = wv[s] * 255; F[o + 3] = wet[s] * 255;
    }
  }
  return out;
}

// separable box blur in place (edges clamped, like engine/noise.js boxBlur)
function blur(a, w, h, r, tmp) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += a[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += a[row + Math.min(x + r + 1, w - 1)] - a[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      a[y * w + x] = acc * inv;
      acc += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
}

// two-pass chamfer distance (1, √2) in place
function chamfer(a, tw, th) {
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x; let v = a[i];
    if (x > 0) v = Math.min(v, a[i - 1] + 1);
    if (y > 0) { v = Math.min(v, a[i - tw] + 1); if (x > 0) v = Math.min(v, a[i - tw - 1] + 1.414); if (x < tw - 1) v = Math.min(v, a[i - tw + 1] + 1.414); }
    a[i] = v;
  }
  for (let y = th - 1; y >= 0; y--) for (let x = tw - 1; x >= 0; x--) {
    const i = y * tw + x; let v = a[i];
    if (x < tw - 1) v = Math.min(v, a[i + 1] + 1);
    if (y < th - 1) { v = Math.min(v, a[i + tw] + 1); if (x < tw - 1) v = Math.min(v, a[i + tw + 1] + 1.414); if (x > 0) v = Math.min(v, a[i + tw - 1] + 1.414); }
    a[i] = v;
  }
}
