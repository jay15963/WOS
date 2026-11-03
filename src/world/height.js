// Terrain height (docs/TERRAIN-HEIGHT.md): a smooth, continuous 3D surface (Valheim-like, not blocks).
// Source data: corner heights in STORIES (1 story = 1 tile up the screen, the same unit as built stories: levels.js
// STORY_H), (W + 1) × (H + 1) floats — corner (ix, iy) is the tile corner at world (ix, iy). Everything outside this file
// reads it through the accessors below (the streaming engine pages it later).
//
// Derived surface: a fine grid of SUB × SUB samples per tile ((W·SUB + 1) × (H·SUB + 1)), interpolated from the corners
// with a Catmull-Rom spline (smooth hills and valleys, a uniform slope stays planar) clamped to the corners around each
// sample (no overshoot: the ground next to a cliff stays flat, water stays at sea level), and roughened where it is
// steep (crags on the rock faces, a ragged rim). Each fine cell is two triangles split along the diagonal whose ends
// differ less (a rim running either way stays a clean line, never a sawtooth); heightAt interpolates on the same
// triangles as the GPU mesh and the sprites' lift (shaders.js HGT_FN), so feet, depth and picking agree exactly.
// The fine surface is a pure function of the corners (a partial rebuild gives the same values as a full one: every
// peer agrees, whatever order it learnt the edits in).
// Slope of a tile = the steepest fine triangle in it (stories per tile). A tile steeper than WALK_MAX is a CLIFF: it
// blocks walking like rock (physics / nav / building), is drawn as rock and can be cut back with a pickaxe.
// A world without heights (all zero, `any` false) behaves exactly as before: every accessor returns 0 / false.
//
// Three corner layers: `base` = the generated terrain (from the seed: never sent), `t` = the terrain after the players'
// edits (dig / fill / level / smooth, cliffs cut back: mut/terrain.js — the only shared part, as a diff against
// `base`: diff() / applyDiff()), `plot` = the base height of the buildings standing on each corner (derived from the
// structures on every peer: game/terrain.js). The surface everything stands on is c = max(t, plot): a building's
// footprint becomes a level pad at its base, the ground around it an embankment (or a masonry face when steep).

export const SUB = 4;           // fine samples per tile side
export const WALK_MAX = 0.75;   // steepest walkable slope (stories per tile, ~37°)
export const SNOW_LINE = 9;     // permanent snow above this height (stories), on gentle ground and ledges

const CR = (p0, p1, p2, p3, t) => { // Catmull-Rom (uniform)
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
};
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y) { // value noise (crags on the rock faces)
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// the layer of the world being played (set by World): ground height for helpers that only see entities (levels.js)
let ACTIVE = null;
export function setActiveHeight(L) { ACTIVE = L; }
export const groundZ = (x, y) => (ACTIVE && ACTIVE.any && Number.isFinite(x) && Number.isFinite(y) ? ACTIVE.heightAt(x, y) : 0);

export class HeightLayer {
  constructor(W, H, corners = null) {
    this.W = W; this.H = H;
    this.CW = W + 1;
    const N = (W + 1) * (H + 1);
    this.base = corners && corners.length === N ? corners : new Float32Array(N);
    this.t = this.base.slice();           // terrain with the players' edits
    this.plot = null;                     // building bases per corner (-Infinity = none), allocated on the first plot
    this.c = this.t.slice();              // the surface: max(t, plot)
    this.FW = W * SUB + 1; this.FH = H * SUB + 1;
    this.f = null;                        // fine surface (allocated only when there is any height)
    this.slope = new Float32Array(W * H); // steepest fine triangle per tile
    this.cliff = new Uint8Array(W * H);   // 1 = tile steeper than WALK_MAX
    this.max = 0;                         // highest corner (the mesh margin)
    this.any = false;                     // any non-zero corner (false = the old flat world, every hook skipped)
    this.v = 0;                           // bumped on every change (GPU re-upload, caches)
    this.dirty = null;                    // tile rect to re-upload [tx0, ty0, tx1, ty1]
    this.rebuild(0, 0, W - 1, H - 1);
  }

  // ---------- reads ----------
  cornerH(ix, iy) {
    ix = ix < 0 ? 0 : ix > this.W ? this.W : ix | 0;
    iy = iy < 0 ? 0 : iy > this.H ? this.H : iy | 0;
    return this.c[iy * this.CW + ix];
  }

  // height of the surface at a world point (stories); the same triangles as the GPU mesh
  heightAt(x, y) {
    if (!this.any) return 0;
    let u = x * SUB, v = y * SUB;
    const M = this.FW - 1, N = this.FH - 1;
    u = u < 0 ? 0 : u > M ? M : u; v = v < 0 ? 0 : v > N ? N : v;
    let i = Math.floor(u), j = Math.floor(v);
    if (i >= M) i = M - 1; if (j >= N) j = N - 1;
    const F = this.f, o = j * this.FW + i;
    return triH(F[o], F[o + 1], F[o + this.FW], F[o + this.FW + 1], u - i, v - j);
  }

  // surface gradient (dh/dx, dh/dy in stories per tile) at a world point (its fine triangle)
  gradAt(x, y, out = [0, 0]) {
    out[0] = out[1] = 0;
    if (!this.any) return out;
    const u = x * SUB, v = y * SUB, i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= this.FW - 1 || j >= this.FH - 1) return out;
    const F = this.f, o = j * this.FW + i;
    triGrad(F[o], F[o + 1], F[o + this.FW], F[o + this.FW + 1], u - i, v - j, out);
    out[0] *= SUB; out[1] *= SUB;
    return out;
  }

  tileSlope(tx, ty) { return this.any && tx >= 0 && ty >= 0 && tx < this.W && ty < this.H ? this.slope[ty * this.W + tx] : 0; }
  isCliff(tx, ty) { return this.any && tx >= 0 && ty >= 0 && tx < this.W && ty < this.H && this.cliff[ty * this.W + tx] === 1; }
  // lowest / highest corner of a tile
  tileMin(tx, ty) { const C = this.c, o = ty * this.CW + tx; return Math.min(C[o], C[o + 1], C[o + this.CW], C[o + this.CW + 1]); }
  tileMax(tx, ty) { const C = this.c, o = ty * this.CW + tx; return Math.max(C[o], C[o + 1], C[o + this.CW], C[o + this.CW + 1]); }

  // highest ground inside a world rect (coarse: 16-tile blocks)
  maxIn(x0, y0, x1, y1) {
    if (!this.any) return 0;
    const NX = Math.ceil(this.W / 16), NY = Math.ceil(this.H / 16);
    const a = Math.max(0, Math.floor(x0 / 16)), b = Math.min(NX - 1, Math.floor(x1 / 16)), c = Math.max(0, Math.floor(y0 / 16)), d = Math.min(NY - 1, Math.floor(y1 / 16));
    let m = 0;
    for (let cy = c; cy <= d; cy++) for (let cx = a; cx <= b; cx++) { const v = this.cmax[cy * NX + cx]; if (v > m) m = v; }
    return m;
  }

  // does a straight walk from a to b cross a cliff tile (or climb faster than WALK_MAX on the way)?
  cliffBetween(ax, ay, bx, by) {
    if (!this.any) return false;
    const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 0.25));
    let h0 = this.heightAt(ax, ay);
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (this.isCliff(Math.floor(x), Math.floor(y))) return true;
      const h = this.heightAt(x, y);
      if (Math.abs(h - h0) > WALK_MAX * (d / n) + 1e-4) return true;
      h0 = h;
    }
    return false;
  }

  // terrain (without buildings) at a corner; a building's base there (or -Infinity)
  terrainH(ix, iy) { ix = Math.max(0, Math.min(this.W, ix | 0)); iy = Math.max(0, Math.min(this.H, iy | 0)); return this.t[iy * this.CW + ix]; }
  plotH(ix, iy) { if (!this.plot) return -Infinity; ix = Math.max(0, Math.min(this.W, ix | 0)); iy = Math.max(0, Math.min(this.H, iy | 0)); return this.plot[iy * this.CW + ix]; }

  // ---------- writes (deterministic on every peer: mut/terrain.js ops, game/terrain.js plots) ----------
  // terrain corners [[cornerIdx, h], …] (edits); rebuilds around them
  setTerrain(list) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const [i, h] of list) {
      if (!(i >= 0 && i < this.t.length) || !Number.isFinite(h)) continue;
      this.t[i] = h;
      const p = this.plot ? this.plot[i] : -Infinity;
      this.c[i] = h > p ? h : p;
      const x = i % this.CW, y = (i / this.CW) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 >= 0) this.rebuild(x0 - 2, y0 - 2, x1 + 1, y1 + 1);
    return x1 >= 0;
  }
  // the edits as a compact diff against the generated terrain: [cornerIdx, h × 100, …] (snapshot / save / the
  // streaming engine's per-chunk store); applyDiff takes the same (a full diff: corners not listed go back to base)
  diff() {
    const out = [], T = this.t, B = this.base;
    for (let i = 0; i < T.length; i++) if (T[i] !== B[i]) out.push(i, Math.round(T[i] * 100));
    return out;
  }
  applyDiff(d, full = true) {
    const list = [];
    if (full) for (let i = 0; i < this.t.length; i++) if (this.t[i] !== this.base[i]) list.push([i, this.base[i]]);
    if (Array.isArray(d)) for (let k = 0; k + 1 < d.length; k += 2) if (Number.isInteger(d[k]) && Number.isFinite(d[k + 1])) list.push([d[k], d[k + 1] / 100]);
    return this.setTerrain(list);
  }
  // building bases per corner (Map cornerIdx → base height): only the corners that changed are rebuilt
  setPlots(map) {
    const N = this.c.length;
    if (!this.plot) { if (!map.size) return false; this.plot = new Float32Array(N).fill(-Infinity); }
    const P = this.plot, list = [];
    for (let i = 0; i < N; i++) { const v = map.has(i) ? map.get(i) : -Infinity; if (P[i] !== v) { P[i] = v; list.push([i, this.t[i]]); } }
    return list.length ? this.setTerrain(list) : false;
  }

  // the spline at fine sample (i, j), clamped near the corners around it (an edge sample: its edge's two corners), with a
  // little room so curved slopes stay smooth (no flat spots), never below sea level when the corners are not
  _spline(i, j, cc) {
    const W = this.W, H = this.H, ex = i % SUB === 0, ey = j % SUB === 0;
    if (ex && ey) return cc(i / SUB, j / SUB);
    const tx = Math.min(W - 1, Math.floor(i / SUB)), ty = Math.min(H - 1, Math.floor(j / SUB));
    const u = i / SUB - tx, v = j / SUB - ty, r = this._r || (this._r = [0, 0, 0, 0]);
    for (let k = -1; k <= 2; k++) r[k + 1] = CR(cc(tx - 1, ty + k), cc(tx, ty + k), cc(tx + 1, ty + k), cc(tx + 2, ty + k), u);
    const h = CR(r[0], r[1], r[2], r[3], v);
    const a = cc(tx, ty), b = cc(tx + 1, ty), c = cc(tx, ty + 1), e = cc(tx + 1, ty + 1);
    let lo, hi;
    if (ey) { const p = v === 0 ? a : c, q = v === 0 ? b : e; lo = Math.min(p, q); hi = Math.max(p, q); }
    else if (ex) { const p = u === 0 ? a : b, q = u === 0 ? c : e; lo = Math.min(p, q); hi = Math.max(p, q); }
    else { lo = Math.min(a, b, c, e); hi = Math.max(a, b, c, e); }
    const mg = (hi - lo) * 0.45; // (flat tiles: range 0 → still exactly flat)
    lo = lo >= 0 ? Math.max(0, lo - mg) : lo - mg; hi += mg;
    return h < lo ? lo : h > hi ? hi : h;
  }

  // recompute the fine surface, slopes and cliff flags of a tile rect (corner changes reach 2 tiles: the spline)
  rebuild(x0, y0, x1, y1) {
    const W = this.W, H = this.H, C = this.c, CW = this.CW;
    let mx = 0, any = false;
    for (let i = 0; i < C.length; i++) { const v = C[i]; if (v !== 0) any = true; if (v > mx) mx = v; }
    this.max = mx; this.any = any; this.v++;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    const d = this.dirty;
    if (!d) this.dirty = [x0, y0, x1, y1];
    else { d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0); d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1); }
    if (!any) { this.slope.fill(0); this.cliff.fill(0); return; }
    if (!this.f) { this.f = new Float32Array(this.FW * this.FH); x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
    const F = this.f, FW = this.FW;
    const cc = (ix, iy) => C[(iy < 0 ? 0 : iy > H ? H : iy) * CW + (ix < 0 ? 0 : ix > W ? W : ix)];
    // fine samples of the rect (edges included) + one sample around (the crags read the neighbours)
    const i0 = x0 * SUB - 1, j0 = y0 * SUB - 1, i1 = (x1 + 1) * SUB + 1, j1 = (y1 + 1) * SUB + 1, TW = i1 - i0 + 1;
    const T = new Float32Array(TW * (j1 - j0 + 1));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) T[(j - j0) * TW + i - i0] = this._spline(Math.max(0, Math.min(this.FW - 1, i)), Math.max(0, Math.min(this.FH - 1, j)), cc);
    // crags on steep ground: noise scaled by the local steepness of the spline (zero on gentle ground: flats stay flat)
    for (let j = j0 + 1; j < j1; j++) for (let i = i0 + 1; i < i1; i++) {
      const k = (j - j0) * TW + i - i0, gx = (T[k + 1] - T[k - 1]) * SUB / 2, gy = (T[k + TW] - T[k - TW]) * SUB / 2;
      const st = Math.sqrt(gx * gx + gy * gy);
      let h = T[k];
      if (st > 1.1) {
        // gullies and ribs running down the face (noise stretched along the slope), plus a finer roughness
        const dx = gx / st, dy = gy / st, a = i * dx + j * dy, b = -i * dy + j * dx;
        const nz = (vnoise(a * 0.05, b * 0.42) - 0.5) + (vnoise(a * 0.16 + 17, b * 0.9) - 0.5) * 0.35;
        h = Math.max(0, h + nz * 0.6 * Math.min(1, (st - 1.1) / 2.2));
      }
      if (i >= 0 && j >= 0 && i < this.FW && j < this.FH) F[j * FW + i] = h;
    }
    // slopes (the steepest fine triangle of each tile, in stories per tile) and cliff flags
    for (let ty = Math.max(0, y0 - 1); ty <= Math.min(H - 1, y1 + 1); ty++) for (let tx = Math.max(0, x0 - 1); tx <= Math.min(W - 1, x1 + 1); tx++) {
      let m = 0;
      for (let j = ty * SUB; j < ty * SUB + SUB; j++) for (let i = tx * SUB; i < tx * SUB + SUB; i++) {
        const o = j * FW + i, g = slope2(F[o], F[o + 1], F[o + FW], F[o + FW + 1]);
        if (g > m) m = g;
      }
      const s = Math.sqrt(m) * SUB, k = ty * W + tx;
      this.slope[k] = s; this.cliff[k] = s > WALK_MAX ? 1 : 0;
    }
    // highest corner per 16 × 16 tiles (view culling: high ground below the screen still shows)
    const NX = Math.ceil(W / 16), NY = Math.ceil(H / 16);
    if (!this.cmax) this.cmax = new Float32Array(NX * NY);
    for (let cy = Math.floor(y0 / 16); cy <= Math.floor(y1 / 16); cy++) for (let cx = Math.floor(x0 / 16); cx <= Math.floor(x1 / 16); cx++) {
      let m = 0;
      for (let y = cy * 16; y <= Math.min(H, cy * 16 + 16); y++) for (let x = cx * 16; x <= Math.min(W, cx * 16 + 16); x++) { const v = C[y * CW + x]; if (v > m) m = v; }
      this.cmax[cy * NX + cx] = m;
    }
  }
}

// ---------- the triangle rule (mirrored in shaders.js HGT_FN / TERRAIN_VS) ----------
// a cell's corners a = 00, b = 10, c = 01, d = 11: split along 00–11 when |a − d| ≤ |b − c|, else along 10–01
export function triH(a, b, c, d, fx, fy) {
  if (Math.abs(a - d) <= Math.abs(b - c)) return fx >= fy ? a + fx * (b - a) + fy * (d - b) : a + fy * (c - a) + fx * (d - c);
  return fx + fy <= 1 ? a + fx * (b - a) + fy * (c - a) : d + (1 - fx) * (c - d) + (1 - fy) * (b - d);
}
function triGrad(a, b, c, d, fx, fy, out) {
  if (Math.abs(a - d) <= Math.abs(b - c)) { if (fx >= fy) { out[0] = b - a; out[1] = d - b; } else { out[0] = d - c; out[1] = c - a; } }
  else if (fx + fy <= 1) { out[0] = b - a; out[1] = c - a; } else { out[0] = d - c; out[1] = d - b; }
  return out;
}
function slope2(a, b, c, d) { // the steeper triangle's squared slope (per cell)
  let x1, y1, x2, y2;
  if (Math.abs(a - d) <= Math.abs(b - c)) { x1 = b - a; y1 = d - b; x2 = d - c; y2 = c - a; } else { x1 = b - a; y1 = c - a; x2 = d - c; y2 = d - b; }
  return Math.max(x1 * x1 + y1 * y1, x2 * x2 + y2 * y2);
}
