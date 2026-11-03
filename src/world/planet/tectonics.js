// Continents (continental crust) and tectonic plates on the macro grid, and the relief their boundaries make.
//
// Continents: 5..8 cratons of very different sizes and shapes, grown by a noisy anisotropic Dijkstra from a
// seed, ≥ GAP cells apart (abyss between them), never in the seam ocean around x = 0. A few microcontinents
// (big islands) are added. Plates: 12..19 regions grown from seeds (1-2 inside each continent, the rest in the
// oceans); crossing a coastline costs extra so many plate edges follow continental margins (active margins).
// Each plate has a motion vector; at every boundary the relative motion against the boundary normal gives
// convergence (> 0), divergence (< 0) or shear (transform).

import { MW, MH, SEAM_HALF } from './consts.js';
import { fbm, ridged, clamp, smoothstep } from './noise.js';
import { N, DX8, DY8, DL8, cxOf, cyOf, tileX, tileY, nbTable, distField, growRegions, blur } from './grid.js';

const GAP = 20; // min cells of ocean between two continents' crust

// wrapped |dx| of a cell column to the seam (cell boundary between columns MW-1 and 0)
const seamDist = (cx) => Math.min(cx + 0.5, MW - cx - 0.5);

export function buildContinents(seed, rng) {
  const T = nbTable();
  const K = 5 + Math.floor(rng() * 4);
  const crustTarget = N * (0.315 + rng() * 0.03);
  const ws = [];
  for (let k = 0, f = 1; k < K; k++, f *= 0.74) ws.push((0.65 + 0.7 * rng()) * f);
  ws.sort((a, b) => b - a);
  const wsum = ws.reduce((a, b) => a + b, 0);
  // no crust near the seam ocean or the polar edges (noisy limits: no straight coasts)
  const forbid = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const x = cxOf(i), y = cyOf(i);
    const ns = (fbm(0, tileY(i), seed + 71, 1024, 3) + 1) * 0.5, np = (fbm(tileX(i), 0, seed + 72, 1024, 3) + 1) * 0.5;
    if (seamDist(x) < SEAM_HALF + 12 + 12 * ns || y < 7 + 9 * np || y >= MH - 7 - 9 * np) forbid[i] = 1;
  }
  const owner = new Int16Array(N).fill(-1);
  const conts = [];
  let distLand = new Float32Array(N).fill(1e9);
  // small-angle rotation from exact ops (deterministic)
  const rot = (vx, vy, a) => { const a2 = a * a, ca = 1 - a2 / 2 + (a2 * a2) / 24 - (a2 * a2 * a2) / 720, sa = a - (a2 * a) / 6 + (a2 * a2 * a) / 120; return [vx * ca - vy * sa, vx * sa + vy * ca]; };
  const cellAt = (x, y) => { const cy = Math.round(y); if (cy < 0 || cy >= MH) return -1; return cy * MW + ((Math.round(x) % MW) + MW) % MW; };
  // continent styles: the biggest is often blocky; one long north-south chain (like the Americas), one broken
  // into an archipelago, sometimes one near a pole (ice cap)
  const style = new Array(K).fill('normal');
  if (rng() < 0.65) style[0] = 'blocky';
  const pickFree = () => { for (let t = 0; t < 20; t++) { const k = 1 + Math.floor(rng() * (K - 1)); if (style[k] === 'normal') return k; } return -1; };
  for (const st of ['long', 'broken', rng() < 0.55 ? 'polar' : null]) { if (!st) continue; const k = pickFree(); if (k > 0) style[k] = st; }
  for (let k = 0; k < K; k++) {
    const area = Math.round((crustTarget * 0.92 * ws[k]) / wsum);
    const sty = style[k];
    // seed: the most isolated of 60 random free spots
    let bestC = -1, bestD = -1;
    for (let t = 0; t < 60; t++) {
      const x = Math.floor(rng() * MW);
      // latitude: most continents in the mid latitudes (|sin lat| 0.3..0.85), some tropical, either hemisphere
      const u = rng();
      let sl = u < 0.65 ? 0.3 + 0.52 * rng() : 0.62 * rng();
      if (sty === 'polar') sl = 0.8 + 0.07 * rng();
      if (sty === 'long') sl = 0.45 * rng();
      const y = Math.floor((MH * (1 - (rng() < 0.6 ? sl : -sl))) / 2);
      if (y < 0 || y >= MH) continue;
      const c = y * MW + x;
      if (forbid[c]) continue;
      const d = distLand[c] + rng() * 4;
      if (d > bestD) { bestD = d; bestC = c; }
    }
    if (bestC < 0) continue;
    // lobes along a bending spine: one continent = 1..4 overlapping noisy blobs
    let nL = 1 + Math.floor(rng() * (area > 5000 ? 4 : area > 2500 ? 3 : 2));
    if (sty === 'long') nL = 3 + Math.floor(rng() * 2);
    if (sty === 'blocky') nL = 1 + Math.floor(rng() * 2);
    const lw = [];
    for (let l = 0; l < nL; l++) lw.push(0.4 + rng());
    const lws = lw.reduce((a, b) => a + b, 0);
    let ax = rng() * 2 - 1, ay = rng() * 2 - 1;
    if (sty === 'long') { ax = (rng() - 0.5) * 0.5; ay = 1; }
    const al = Math.sqrt(ax * ax + ay * ay) || 1; ax /= al; ay /= al;
    const lobes = [];
    let px = cxOf(bestC), py = cyOf(bestC), prevR = 0;
    for (let l = 0; l < nL; l++) {
      const la = Math.round((area * lw[l]) / lws), r = Math.sqrt(la / 3.14159);
      let cell = bestC;
      if (l > 0) {
        cell = -1;
        for (let t = 0; t < 8 && cell < 0; t++) {
          const [dx, dy] = rot(ax, ay, (rng() - 0.5) * (sty === 'long' ? 0.7 : 1.8));
          const sp = (sty === 'long' ? 0.95 : 0.78) * (prevR + r);
          const c = cellAt(px + dx * sp, py + dy * sp);
          if (c >= 0 && !forbid[c] && distLand[c] > GAP + r * 0.5) { cell = c; ax = dx; ay = dy; }
        }
        if (cell < 0) { lobes[0].area += la; continue; }
        px = cxOf(cell); py = cyOf(cell);
      }
      let bx = rng() * 2 - 1, by = rng() * 2 - 1;
      if (sty === 'long') { bx = ax; by = ay; }
      const bl = Math.sqrt(bx * bx + by * by) || 1;
      const aspect = sty === 'long' ? 1.8 + rng() * 0.8 : sty === 'blocky' ? 1 + rng() * 0.3 : 1 + rng() * rng() * 2.4;
      const rough = sty === 'blocky' ? 0.45 + rng() * 0.3 : sty === 'broken' ? 2 + rng() * 0.6 : 0.7 + rng() * 1.5;
      lobes.push({ cell, area: la, ax: bx / bl, ay: by / bl, aspect, bend: 0.4 + rng() * 1.2, rough, salt: seed * 31 + k * 977 + l * 131 + 11 });
      prevR = r;
    }
    const cost = (i, j, q, li) => {
      if (forbid[j]) return Infinity;
      const L = lobes[li], tx = tileX(j), ty = tileY(j);
      if (distLand[j] < GAP * (0.75 + 0.5 * (fbm(tx, ty, seed + 73, 512, 2) + 1) * 0.5)) return Infinity;
      const nz = (fbm(tx, ty, L.salt, 2048, 5) + 1) * 0.5;
      // local main axis bends with a slow noise
      let dx = L.ax + L.bend * fbm(tx, ty, L.salt + 5, 4096, 2), dy = L.ay + L.bend * fbm(tx, ty, L.salt + 6, 4096, 2);
      const dl = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dl; dy /= dl;
      const sx = DX8[q] / DL8[q], sy = DY8[q] / DL8[q];
      const along = sx * dx + sy * dy, across = sx * dy - sy * dx;
      const an = Math.sqrt(along * along + L.aspect * L.aspect * across * across);
      return DL8[q] * an * (0.15 + L.rough * 2.6 * nz * nz * nz);
    };
    const reg = growRegions(lobes, cost, (li, n) => n >= lobes[li].area);
    let got = 0, sx = 0, sy = 0;
    const x0 = cxOf(bestC);
    for (let i = 0; i < N; i++) if (reg[i] >= 0) {
      owner[i] = k; got++;
      let dx = cxOf(i) - x0; if (dx > MW / 2) dx -= MW; else if (dx < -MW / 2) dx += MW;
      sx += dx; sy += cyOf(i);
    }
    conts.push({ id: k, seed: bestC, area: got, lobes: lobes.length, style: sty, cx: (x0 + sx / Math.max(1, got) + MW) % MW, cy: sy / Math.max(1, got) });
    distLand = distField((i) => owner[i] >= 0, GAP + 2);
  }
  // microcontinents / big islands (may sit near a continent, sharing its shelf)
  const M = 3 + Math.floor(rng() * 4);
  for (let m = 0; m < M; m++) {
    const area = Math.round(N * (0.0012 + rng() * 0.0035));
    let c = -1;
    for (let t = 0; t < 80 && c < 0; t++) {
      const x = Math.floor(rng() * MW), y = Math.floor(MH * (0.12 + 0.76 * rng()));
      const cc = y * MW + x;
      if (!forbid[cc] && distLand[cc] > 7 && distLand[cc] < 60) c = cc;
    }
    if (c < 0) continue;
    const salt = seed * 53 + m * 1543 + 7;
    const cost = (i, j, q) => {
      if (forbid[j] || distLand[j] < 5) return Infinity;
      const nz = (fbm(tileX(j), tileY(j), salt, 1024, 3) + 1) * 0.5;
      return DL8[q] * (0.2 + 2.5 * nz * nz);
    };
    const reg = growRegions([{ cell: c }], cost, (s, n) => n >= area);
    const id = 100 + m;
    let got = 0;
    for (let i = 0; i < N; i++) if (reg[i] === 0) { owner[i] = id; got++; }
    conts.push({ id, seed: c, area: got, micro: true, cx: cxOf(c), cy: cyOf(c) });
    distLand = distField((i) => owner[i] >= 0, GAP + 2);
  }
  // fill single-cell holes / pinholes in the crust
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      if (owner[i] >= 0) continue;
      let cnt = 0, o = -1;
      for (let k = 0; k < 8; k++) { const j = T[i * 8 + k]; if (j >= 0 && owner[j] >= 0) { cnt++; o = owner[j]; } }
      if (cnt >= 7) owner[i] = o;
    }
  }
  return { owner: warpOwner(owner, seed + 80, 6, 2.5), conts };
}

// warp a region map: every cell takes the owner of a noise-displaced cell (curved, irregular borders)
export function warpOwner(owner, salt, a1, a2) {
  const out = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const tx = tileX(i), ty = tileY(i);
    const wx = a1 * fbm(tx, ty, salt, 4096, 3) + a2 * fbm(tx, ty, salt + 2, 1024, 3);
    const wy = a1 * fbm(tx, ty, salt + 1, 4096, 3) + a2 * fbm(tx, ty, salt + 3, 1024, 3);
    const sx = Math.round(cxOf(i) + wx), sy = clamp(Math.round(cyOf(i) + wy), 0, MH - 1);
    out[i] = owner[sy * MW + ((sx % MW) + MW) % MW];
  }
  return out;
}

export function buildPlates(seed, rng, crust, conts) {
  const P = 12 + Math.floor(rng() * 8);
  const seeds = [];
  const far = (c, minD) => seeds.every((s) => {
    let dx = Math.abs(cxOf(s.cell) - cxOf(c)); if (dx > MW / 2) dx = MW - dx;
    const dy = cyOf(s.cell) - cyOf(c);
    return dx * dx + dy * dy >= minD * minD;
  });
  // continental plate seeds
  const big = conts.filter((c) => !c.micro).sort((a, b) => b.area - a.area);
  big.forEach((ct, k) => {
    const n = k < 2 && ct.area > 6000 ? 2 : 1;
    const cells = [];
    for (let i = 0; i < N; i++) if (crust[i] === ct.id) cells.push(i);
    for (let s = 0; s < n && seeds.length < P; s++) {
      for (let t = 0; t < 40; t++) {
        const c = cells[Math.floor(rng() * cells.length)];
        if (far(c, 30)) { seeds.push({ cell: c, cont: true }); break; }
      }
    }
  });
  for (let t = 0; t < 4000 && seeds.length < P; t++) {
    const c = Math.floor(rng() * N);
    if (cyOf(c) < 6 || cyOf(c) >= MH - 6) continue;
    if (far(c, t < 2000 ? 60 : 36)) seeds.push({ cell: c, cont: crust[c] >= 0 });
  }
  const plates = seeds.map((s, k) => {
    let vx = rng() * 2 - 1, vy = rng() * 2 - 1;
    const l = Math.sqrt(vx * vx + vy * vy) || 1;
    const sp = (0.3 + 0.7 * rng()) * (s.cont ? 0.65 : 1);
    return { id: k, cell: s.cell, vx: (vx / l) * sp, vy: (vy / l) * sp, speed: 0.7 + 0.7 * rng(), pen: s.cont ? 2 + rng() * 14 : 1 + rng() * 6, dens: rng(), cont: s.cont };
  });
  const salt = seed * 97 + 5;
  const cost = (i, j, q, k) => {
    const nz = (fbm(tileX(j), tileY(j), salt, 1024, 4) + 1) * 0.5;
    let c = DL8[q] * (0.5 + 1.2 * nz) / plates[k].speed;
    if ((crust[i] >= 0) !== (crust[j] >= 0)) c += plates[k].pen;
    return c;
  };
  const owner = warpOwner(growRegions(seeds, cost), seed + 90, 9, 3.5);
  const plate = new Uint8Array(N);
  for (let i = 0; i < N; i++) plate[i] = owner[i] < 0 ? 0 : owner[i];
  // plate type by crust share
  const cnt = new Int32Array(plates.length), cc = new Int32Array(plates.length);
  for (let i = 0; i < N; i++) { cnt[plate[i]]++; if (crust[i] >= 0) cc[plate[i]]++; }
  plates.forEach((p, k) => { p.area = cnt[k]; p.continental = cc[k] > cnt[k] * 0.35; });
  return { plate, plates };
}

// Relief from the plate boundaries (metres, added to the base elevation) + boundary metadata.
// crustB = blurred continental crust 0..1.
export function boundaryUplift(seed, plate, plates, crustB) {
  const T = nbTable();
  const isB = new Uint8Array(N);
  const bq = new Int16Array(N).fill(-1);
  const bconv = new Float32Array(N), bshear = new Float32Array(N), bcP = new Float32Array(N), bcQ = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = plate[i];
    let nx = 0, ny = 0, q = -1, nq = 0;
    for (let k = 0; k < 8; k++) {
      const j = T[i * 8 + k];
      if (j < 0 || plate[j] === p) continue;
      if (q < 0) q = plate[j];
      if (plate[j] !== q) continue;
      nx += DX8[k] / DL8[k]; ny += DY8[k] / DL8[k]; nq++;
    }
    if (q < 0) continue;
    const l = Math.sqrt(nx * nx + ny * ny) || 1; nx /= l; ny /= l;
    const P = plates[p], Q = plates[q];
    const rx = P.vx - Q.vx, ry = P.vy - Q.vy;
    isB[i] = 1; bq[i] = q;
    bconv[i] = rx * nx + ry * ny;
    bshear[i] = Math.abs(rx * ny - ry * nx);
    bcP[i] = crustB[i];
    // crust on the far side: a couple of cells across the boundary
    const fx = Math.round(cxOf(i) + nx * 2), fy = Math.round(cyOf(i) + ny * 2);
    const fc = clamp(fy, 0, MH - 1) * MW + ((fx % MW) + MW) % MW;
    bcQ[i] = crustB[fc];
  }
  // nearest boundary cell on the same plate (distance in cells)
  const src = new Int32Array(N).fill(-1);
  const bd = new Float32Array(N).fill(1e9);
  {
    const d = bd;
    // label-correcting rounds restricted to the own plate
    const order = [];
    for (let i = 0; i < N; i++) if (isB[i]) { d[i] = 0; src[i] = i; order.push(i); }
    let front = order;
    for (let round = 0; round < 40 && front.length; round++) {
      const next = [];
      for (const i of front) {
        const di = d[i];
        if (di > 26) continue;
        for (let k = 0; k < 8; k++) {
          const j = T[i * 8 + k];
          if (j < 0 || plate[j] !== plate[i]) continue;
          const nd = di + DL8[k];
          if (nd < d[j] - 1e-6) { d[j] = nd; src[j] = src[i]; next.push(j); }
        }
      }
      front = next;
    }
  }
  const U = new Float32Array(N);
  const arc = new Float32Array(N);    // volcanic arc strength 0..1 (volcano candidates)
  const kind = new Uint8Array(N);     // 0 none, 1 collision, 2 active margin (continent side), 3 trench, 4 island arc, 5 rift, 6 ridge, 7 transform
  const s1 = seed * 131 + 3, s2 = seed * 131 + 4, s3 = seed * 131 + 5;
  const bump = (d, w) => { if (d < 0) d = -d; if (d >= w) return 0; const t = d / w; const u = 1 - t * t; return u * u; };
  for (let i = 0; i < N; i++) {
    const b = src[i];
    if (b < 0 || bd[i] > 26) continue;
    const p = plate[i], q = bq[b];
    if (q < 0) continue;
    const tx = tileX(i), ty = tileY(i);
    // ranges change width along their length; a little jitter breaks the parallel bands
    const d = bd[i] / (0.65 + 0.7 * (fbm(tx, ty, s1 + 30, 2048, 2) * 0.5 + 0.5)) + 0.9 * fbm(tx, ty, s1 + 31, 512, 2);
    const mod = 0.5 + 0.5 * fbm(tx, ty, s1, 1024, 3);
    const gaps = smoothstep(-0.6, -0.15, fbm(tx, ty, s2, 512, 3)); // passes / breaks along the ranges
    const conv = bconv[b], shear = bshear[b];
    const cP = bcP[b] > 0.5, cQ = bcQ[b] > 0.5;
    let u = 0, kd = 0;
    if (conv > 0.12) {
      const k = clamp(conv / 0.8, 0.2, 1.6);
      if (cP && cQ) {
        // continental collision: broad high range + a plateau behind it on the overriding side
        const rd = ridged(tx, ty, s1 + 21, 512, 4);
        u += (2200 + 3200 * k * mod) * bump(d, 6 + 3 * k) * (0.35 + 0.65 * gaps) * (0.55 + 0.6 * rd);
        u += 650 * k * mod * bump(d, 13 + 4 * k); // foothills
        if (plates[p].dens < plates[q].dens) u += 1400 * mod * smoothstep(16, 7, d) * smoothstep(1, 4, d);
        kd = 1;
      } else if (cP && !cQ) {
        // continent overriding an ocean plate: coastal range + volcanic arc a few cells inland
        const rd = ridged(tx, ty, s1 + 22, 512, 4);
        u += (1800 + 3400 * k * mod) * bump(d - 3, 3.6) * (0.4 + 0.6 * gaps) * (0.55 + 0.6 * rd);
        u += 500 * k * mod * bump(d - 4, 8);
        arc[i] = bump(d - 3.5, 1.6) * k;
        kd = 2;
      } else if (!cP && cQ) {
        u -= 3200 * k * bump(d - 0.6, 1.8); // trench
        kd = 3;
      } else {
        // ocean-ocean: the lighter plate overrides -> island arc; the other dives -> trench
        if (plates[p].dens < plates[q].dens) {
          const isl = smoothstep(-0.1, 0.5, fbm(tx, ty, s3, 256, 3));
          u += (2600 + 2600 * k) * bump(d - 2.2, 1.7) * (0.35 + 0.65 * isl);
          arc[i] = bump(d - 2.2, 1.2) * k;
          kd = 4;
        } else { u -= 3000 * k * bump(d - 0.6, 1.6); kd = 3; }
      }
    } else if (conv < -0.12) {
      const k = clamp(-conv / 0.8, 0.2, 1.5);
      if (cP && cQ) {
        u += -700 * k * bump(d, 2.4) * (0.4 + 0.6 * gaps) + 900 * k * mod * bump(d - 3.6, 2.4); // rift valley + shoulders
        kd = 5;
      } else if (!cP && !cQ) {
        u += 1900 * bump(d, 5.5) * (0.7 + 0.3 * mod); // mid-ocean ridge (stays under water)
        kd = 6;
      }
    } else if (shear > 0.25) {
      u += 380 * fbm(tx, ty, s1 + 9, 256, 2) * bump(d, 2.2);
      kd = 7;
    }
    U[i] = u;
    if (u !== 0 || kd) kind[i] = kd;
  }
  return { U, arc, kind, isB, bconv, bq, bd };
}

export { blur };
// pick n distinct-ish hotspot cells (deterministic)
export function pickHotspots(seed, rng, n) {
  const out = [];
  for (let t = 0; t < 400 && out.length < n; t++) {
    const c = Math.floor(rng() * N);
    const y = cyOf(c);
    if (y < 20 || y > MH - 20) continue;
    if (out.some((o) => { let dx = Math.abs(cxOf(o) - cxOf(c)); if (dx > MW / 2) dx = MW - dx; const dy = cyOf(o) - y; return dx * dx + dy * dy < 60 * 60; })) continue;
    out.push(c);
  }
  return out;
}
