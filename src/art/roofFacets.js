// Camera rotation (docs/CAMERA-ROTATION.md, agent J): a roof region as true 3D pieces with art of their own, so a
// slope looks the same from every side. Pure functions (worker friendly, no DOM).
//
// turnedGeom(spec) — the pieces (plain data, structured-clone friendly), from roofShape (the same rectangles / planes /
// overhangs as the north-view painter, art/roofRaster.js):
//   - facets: the exact planar pieces of the surface = MAX over the rectangles of the MIN of their planes. Each
//     rectangle's domain is split by its wall lines (where the eaves kick out shallower), each plane keeps the convex
//     part where it is the lowest of its rectangle, and every other rectangle that is higher there is subtracted (convex
//     polygon clipping: hips, valleys of L / T / U shapes and wings dying into a higher roof come out exact);
//   - vertical faces along the domain edges where the surface steps down: fascia (eaves), bargeboards (gable rakes),
//     steps from a higher roof onto a lower one (gable material under a board);
//   - gable faces at the wall lines (plaster with timber / planks / stone by style, a window when big enough + its glow
//     at night), only where the outside is not inside another rectangle's walls;
//   - a soft eave shadow on the walls under the roof (where the region has a wall);
//   - chimneys over the hearths (stone shaft standing on the slope, a cap, a dark flue), the weathervane;
//   - an atlas: the roof surface painted in PLAN (orthographic, world-aligned: courses follow each slope's own eave, so a
//     slope reads the same from every side; the baked light, ridge caps, hip caps, valley gutters, moss, trims and
//     tone of the north painter), then strips for the gables, steps, boards, chimney stone, glow, eave shadow.
// rasterTurned(spec) = turnedGeom + the painted atlas (art/roofWorker.js runs it off the main thread).
// turnedView(G, rot) — per camera angle (main thread, cached by game/roofs.js): the pieces facing the camera, in a
// painter's order (plan-disjoint convex pieces ordered along the view direction: the one nearer the camera on any
// shared view line goes after; things standing on the roof go after the surface under them), cut into view columns one
// tile wide (each column a depth-sorted drawable, like the north view's tile-column slices).

import { ROOF_GEOM, DET } from '../game/content/roofs.js';
import { roofShape, patLum, gableRGB, hash, smooth, vnoise, TRIM, STONE, clamp255 } from './roofRaster.js';

const EPS_A = 1e-6;
const PAD = 3;                 // atlas padding around each strip (filtering / mipmaps)
const BOARD_H = 0.12;          // board strip height (tiles): fascia / bargeboards use its top part
const SHADE_H = 0.2;           // eave shadow on the walls (tiles)
const CW = 0.34, CD = 0.3;     // chimney shaft (as the north painter)

// ---------------- convex polygons (flat [x0, y0, x1, y1, ...], counter-clockwise) ----------------
function clip2(P, a, b, c) { // keep a·x + b·y + c ≤ 0
  const n = P.length >> 1, out = [];
  if (n < 2) return out;
  let x0 = P[2 * n - 2], y0 = P[2 * n - 1], d0 = a * x0 + b * y0 + c;
  for (let i = 0; i < n; i++) {
    const x1 = P[2 * i], y1 = P[2 * i + 1], d1 = a * x1 + b * y1 + c;
    if (d1 <= 1e-12) {
      if (d0 > 1e-12) { const t = d0 / (d0 - d1); out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
      out.push(x1, y1);
    } else if (d0 < 0) { const t = d0 / (d0 - d1); out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
    x0 = x1; y0 = y1; d0 = d1;
  }
  return out;
}
function clean(P) {
  const n = P.length >> 1, out = [];
  for (let i = 0; i < n; i++) {
    const x = P[2 * i], y = P[2 * i + 1], m = out.length;
    if (m && Math.abs(out[m - 2] - x) < 1e-9 && Math.abs(out[m - 1] - y) < 1e-9) continue;
    out.push(x, y);
  }
  while (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-9 && Math.abs(out[1] - out[out.length - 1]) < 1e-9) out.length -= 2;
  return out.length >= 6 ? out : [];
}
function area2(P) {
  let s = 0;
  const n = P.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) s += P[2 * j] * P[2 * i + 1] - P[2 * i] * P[2 * j + 1];
  return s / 2;
}
function bbox(P) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < P.length; i += 2) { const x = P[i], y = P[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const boxHit = (a, b) => a[0] < b[2] - 1e-9 && b[0] < a[2] - 1e-9 && a[1] < b[3] - 1e-9 && b[1] < a[3] - 1e-9;
// P minus the convex Q: convex pieces
function subtract(P, Q) {
  const out = [];
  let rem = P;
  const n = Q.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x0 = Q[2 * j], y0 = Q[2 * j + 1], x1 = Q[2 * i], y1 = Q[2 * i + 1];
    const a = y1 - y0, b = -(x1 - x0), c = -a * x0 - b * y0;
    if (Math.abs(a) + Math.abs(b) < 1e-12) continue;
    const o = clean(clip2(rem, -a, -b, -c));
    if (o.length && area2(o) > EPS_A) out.push(o);
    rem = clean(clip2(rem, a, b, c));
    if (!rem.length || area2(rem) <= EPS_A) return out;
  }
  return out;
}

// ---------------- geometry ----------------
// the linear pieces of a rectangle's planes over its 9 sub-rectangles (cut by the wall lines): cells where each plane
// is the lowest of the rectangle — { P, A, B, C (h = A·x + B·y + C), f (1 W, 2 E, 3 S, 4 N) }
function rectCells(r, He) {
  const p = r.p, K = 0.4, out = [];
  const xs = [r.dx0, r.X0, r.X1, r.dx1], ys = [r.dy0, r.Y0, r.Y1, r.dy1];
  const we = r.ns || r.hip, sn = !r.ns || r.hip;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const L = [];
    if (we) { const kw = i === 0 ? K : 1, ke = i === 2 ? K : 1; L.push([p * kw, 0, He - p * kw * r.X0, 1], [-p * ke, 0, He + p * ke * r.X1, 2]); }
    if (sn) { const ks = j === 2 ? K : 1; L.push([0, -p * ks, He + p * ks * r.Y1, 3], [0, p, He - p * r.Y0, 4]); }
    const sub = [xs[i], ys[j], xs[i + 1], ys[j], xs[i + 1], ys[j + 1], xs[i], ys[j + 1]];
    for (let a = 0; a < L.length; a++) {
      let P = sub;
      for (let b = 0; b < L.length && P.length; b++) if (b !== a) P = clip2(P, L[a][0] - L[b][0], L[a][1] - L[b][1], L[a][2] - L[b][2]);
      P = clean(P);
      if (P.length && area2(P) > EPS_A) out.push({ P, A: L[a][0], B: L[a][1], C: L[a][2], f: L[a][3], r });
    }
  }
  return out;
}

function facetsOf(S) {
  const R = S.rects, cells = R.map((r) => rectCells(r, S.He)), out = [];
  for (let k = 0; k < R.length; k++) for (const c of cells[k]) {
    let parts = [c.P];
    const cb = bbox(c.P);
    for (let m = 0; m < R.length && parts.length; m++) {
      if (m === k) continue;
      const q = R[m];
      if (!boxHit(cb, [q.dx0, q.dy0, q.dx1, q.dy1])) continue;
      for (const d of cells[m]) {
        // where m's cell d is above c (ties: the lower index keeps it)
        const dA = c.A - d.A, dB = c.B - d.B, dC = c.C - d.C;
        let Q;
        if (Math.abs(dA) + Math.abs(dB) < 1e-9) { if (dC < -1e-9 || (Math.abs(dC) <= 1e-9 && m < k)) Q = d.P; else continue; }
        else Q = clean(clip2(d.P, dA, dB, dC));
        if (!Q.length || area2(Q) <= EPS_A) continue;
        const qb = bbox(Q), np = [];
        for (const P of parts) { if (!boxHit(bbox(P), qb)) { np.push(P); continue; } for (const o of subtract(P, Q)) np.push(o); }
        parts = np;
        if (!parts.length) break;
      }
    }
    for (const P of parts) out.push({ P, A: c.A, B: c.B, C: c.C, f: c.f, r: c.r });
  }
  return out;
}

// atlas strips: { kind, w, h (px), ... }; packed under the plan image
function Strip(list, kind, w, h, o) { const s = Object.assign({ kind, w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)), id: list.length }, o); list.push(s); return s; }

const colKey = (c) => c.map((v) => Math.round(v * 1000)).join(',');

function build(spec) {
  const S = roofShape(spec);
  const G = ROOF_GEOM, He = S.He, thick = G.thick, res = spec.res || 48;
  const R = S.rects, NR = R.length;
  const det = (n) => (n >= 0 ? spec.det[n] | 0 : 0);
  const styleN = (n) => (n >= 0 ? S.ST[n] : R[0].S);
  // plan image: the domains' box (+ a margin), painted at a finer resolution (slopes facing the camera stretch)
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of R) { x0 = Math.min(x0, r.dx0); y0 = Math.min(y0, r.dy0); x1 = Math.max(x1, r.dx1); y1 = Math.max(y1, r.dy1); }
  const area = (x1 - x0) * (y1 - y0);
  const pres = Math.max(16, Math.min(res * 1.5, Math.sqrt(700000 / Math.max(1, area))));
  const PW = Math.ceil((x1 - x0) * pres) + 2, PH = Math.ceil((y1 - y0) * pres) + 2;
  const planX0 = x0 - 1 / pres, planY0 = y0 - 1 / pres;
  const strips = [];
  const items = [];
  const planUV = (x, y) => [(x - planX0) * pres, (y - planY0) * pres];
  // ---- 1. facets ----
  for (const fc of facetsOf(S)) {
    const r = fc.r, P = fc.P, p = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < P.length; i += 2) {
      const x = P[i], y = P[i + 1], [u, v] = planUV(x, y);
      p.push(x, y, fc.A * x + fc.B * y + fc.C, u, v);
      cx += x; cy += y;
    }
    cx /= P.length / 2; cy /= P.length / 2;
    const st = styleN(S.tileIn(r, cx, cy)), k = r.sh[fc.f];
    items.push({ k: 'f', fp: P, gA: fc.A, gB: fc.B, layer: 0, pri: 0, dk: [r.X0, r.Y0, r.X1, r.Y1],
      polys: [{ p, st: -1, col: [st.base[0] * k, st.base[1] * k, st.base[2] * k] }] });
  }
  // ---- 2. steps along the domain edges (fascia, bargeboards, a higher roof over a lower one) ----
  const boards = new Map();
  const boardStrip = (c) => { const key = colKey(c); let b = boards.get(key); if (!b) { b = Strip(strips, 'board', 4, 16, { col: c }); boards.set(key, b); } return b; };
  const sample = (x, y, nx, ny) => {
    const d = 2e-4;
    const hi = S.surf(x - nx * d, y - ny * d), ki = S.K;
    const ho = S.surf(x + nx * d, y + ny * d), ko = S.K;
    return { hi, ki, ho: ko < 0 ? -1e9 : ho, ko };
  };
  for (let k = 0; k < NR; k++) {
    const r = R[k];
    const E4 = [[r.dx0, r.dy1, r.dx1, r.dy1, 0, 1], [r.dx1, r.dy0, r.dx0, r.dy0, 0, -1], [r.dx1, r.dy1, r.dx1, r.dy0, 1, 0], [r.dx0, r.dy0, r.dx0, r.dy1, -1, 0]];
    for (const [ax, ay, bx, by, nx, ny] of E4) {
      const L = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / L, dy = (by - ay) / L;
      const rake = !r.hip && (r.ns ? ny !== 0 : nx !== 0), thk = rake ? BOARD_H : thick;
      const P = (t) => [ax + dx * t, ay + dy * t];
      // breakpoints: every rectangle's domain / wall / ridge lines crossing this edge
      const br = [0, L];
      for (const q of R) {
        const vals = ny !== 0 ? [q.dx0, q.X0, q.X1, q.dx1, q.ns ? q.c : null] : [q.dy0, q.Y0, q.Y1, q.dy1, !q.ns ? q.c : null];
        for (const v of vals) { if (v == null) continue; const t = ny !== 0 ? (v - ax) * dx : (v - ay) * dy; if (t > 1e-6 && t < L - 1e-6) br.push(t); }
      }
      br.sort((a, b) => a - b);
      const segs = [];
      const smp = (t) => { const [x, y] = P(t); return sample(x, y, nx, ny); };
      const lin = (a, b, m, f) => { const v = a.hi + (b.hi - a.hi) * f; if (Math.abs(m.hi - v) > 1e-3) return false; if (a.ko >= 0 && b.ko >= 0 && m.ko >= 0) { const w = a.ho + (b.ho - a.ho) * f; if (Math.abs(m.ho - w) > 1e-3) return false; } return true; };
      const rec = (ta, sa, tb, sb, depth) => {
        if (tb - ta < 1e-3 || depth > 9) { segs.push([ta, sa, tb, sb]); return; }
        const tm = (ta + tb) / 2, sm = smp(tm);
        let ok = sa.ki === sm.ki && sm.ki === sb.ki && (sa.ko < 0) === (sm.ko < 0) && (sm.ko < 0) === (sb.ko < 0) && lin(sa, sb, sm, 0.5);
        if (ok) for (const f of [0.25, 0.75]) { const s2 = smp(ta + (tb - ta) * f); if (s2.ki !== sa.ki || (s2.ko < 0) !== (sa.ko < 0) || !lin(sa, sb, s2, f)) { ok = false; break; } }
        if (ok) { segs.push([ta, sa, tb, sb]); return; }
        rec(ta, sa, tm, sm, depth + 1); rec(tm, sm, tb, sb, depth + 1);
      };
      for (let i = 0; i + 1 < br.length; i++) {
        const ta = br[i], tb = br[i + 1];
        if (tb - ta < 1e-6) continue;
        // (samples just inside the interval: a breakpoint sits on another domain's edge)
        const e1 = Math.min(1e-4, (tb - ta) / 4);
        rec(ta, smp(ta + e1), tb, smp(tb - e1), 0);
      }
      // pieces: [t0, t1, top0, top1, bot0, bot1, kind]
      const boardsP = [], stepsP = [];
      for (const [ta, sa, tb, sb] of segs) {
        if (sa.ki !== k || sb.ki !== k) continue;
        if (sa.ko < 0 && sb.ko < 0) { boardsP.push([ta, tb, sa.hi, sb.hi, sa.hi - thk, sb.hi - thk]); continue; }
        if (sa.ko < 0 || sb.ko < 0) continue;
        let t0 = ta, t1 = tb, i0 = sa.hi, i1 = sb.hi, o0 = sa.ho, o1 = sb.ho;
        const d0 = i0 - o0, d1 = i1 - o1;
        if (Math.max(d0, d1) < 0.008) continue;
        if (d0 < 0 || d1 < 0) { // the step ends inside the piece
          const f = d0 / (d0 - d1), tm = t0 + (t1 - t0) * f, im = i0 + (i1 - i0) * f;
          if (d0 < 0) { t0 = tm; i0 = im; o0 = im; } else { t1 = tm; i1 = im; o1 = im; }
        }
        boardsP.push([t0, t1, i0, i1, Math.max(i0 - thk, o0), Math.max(i1 - thk, o1)]);
        if (i0 - thk > o0 + 0.004 || i1 - thk > o1 + 0.004) stepsP.push([t0, t1, i0 - thk, i1 - thk, Math.min(o0, i0 - thk), Math.min(o1, i1 - thk)]);
      }
      const merge = (L2) => {
        const out = [];
        for (const q of L2) {
          const m = out[out.length - 1];
          if (m && Math.abs(m[1] - q[0]) < 1e-6) {
            const s0 = (m[3] - m[2]) / (m[1] - m[0]), s1 = (q[3] - q[2]) / (q[1] - q[0]), b0 = (m[5] - m[4]) / (m[1] - m[0]), b1 = (q[5] - q[4]) / (q[1] - q[0]);
            if (Math.abs(s0 - s1) < 1e-4 && Math.abs(b0 - b1) < 1e-4 && Math.abs(m[3] - q[2]) < 1e-5 && Math.abs(m[5] - q[4]) < 1e-5) { m[1] = q[1]; m[3] = q[3]; m[5] = q[5]; continue; }
          }
          out.push(q.slice());
        }
        return out;
      };
      const nrm = [nx, ny];
      for (const [t0, t1, a0, a1, b0, b1] of merge(boardsP)) {
        const [px0, py0] = P(t0), [px1, py1] = P(t1);
        const n = S.tileIn(r, (px0 + px1) / 2 - nx * 0.35, (py0 + py1) / 2 - ny * 0.35), st = styleN(n);
        const c = det(n) & DET.trim ? TRIM : st.board, bs = boardStrip(c);
        const v = (top, h) => ((top - h) / BOARD_H) * 16;
        items.push({ k: 'b', fp: [px0, py0, px1, py1], n: nrm, layer: 0, pri: 2, dk: [r.X0, r.Y0, r.X1, r.Y1],
          polys: [{ st: bs.id, vert: 1, col: c, p: [px0, py0, a0, 2, 0, px1, py1, a1, 2, 0, px1, py1, b1, 2, v(a1, b1), px0, py0, b0, 2, v(a0, b0)] }] });
      }
      const steps = merge(stepsP);
      if (steps.length) {
        let ta = 1e9, tb = -1e9, hb = 1e9, ht = -1e9;
        for (const q of steps) { ta = Math.min(ta, q[0]); tb = Math.max(tb, q[1]); ht = Math.max(ht, q[2], q[3]); hb = Math.min(hb, q[4], q[5]); }
        const [sx0, sy0] = P(ta);
        const sp = Strip(strips, 'step', (tb - ta) * res, (ht - hb) * res, { r: k, ax: sx0, ay: sy0, dx, dy, nx, ny, len: tb - ta, ht, hb });
        for (const [t0, t1, a0, a1, b0, b1] of steps) {
          const [px0, py0] = P(t0), [px1, py1] = P(t1), u0 = (t0 - ta) * res, u1 = (t1 - ta) * res;
          const V = (h) => (ht - h) * res;
          items.push({ k: 'v', fp: [px0, py0, px1, py1], n: nrm, layer: 0, pri: 1, dk: [r.X0, r.Y0, r.X1, r.Y1],
            polys: [{ st: sp.id, vert: 1, col: r.S.gableCol, p: [px0, py0, a0, u0, V(a0), px1, py1, a1, u1, V(a1), px1, py1, b1, u1, V(b1), px0, py0, b0, u0, V(b0)] }] });
        }
      }
    }
  }
  // ---- 3. gable faces at the wall lines (+ windows), eave shadows on the walls ----
  // along a wall line of rectangle r (outward n), the parts whose outside is not inside another rectangle's walls
  const exposed = (r, axisX, line, nx, ny, a0, a1) => {
    const hid = [];
    for (const q of R) {
      if (q === r) continue;
      const ox = axisX ? null : line + nx * 1e-3, oy = axisX ? line + ny * 1e-3 : null;
      if (axisX) { if (oy > q.Y0 && oy < q.Y1) hid.push([q.X0, q.X1]); }
      else if (ox > q.X0 && ox < q.X1) hid.push([q.Y0, q.Y1]);
    }
    hid.sort((a, b) => a[0] - b[0]);
    const out = [];
    let cur = a0;
    for (const [h0, h1] of hid) { if (h1 <= cur) continue; if (h0 >= a1) break; if (h0 > cur + 1e-6) out.push([cur, Math.min(h0, a1)]); cur = Math.max(cur, h1); }
    if (cur < a1 - 1e-6) out.push([cur, a1]);
    return out;
  };
  const sides = (r) => [
    // [axisX (runs along x), line, nx, ny, a0, a1, from (a seen left on the outside), point(a)]
    [true, r.Y1, 0, 1, r.X0, r.X1], [true, r.Y0, 0, -1, r.X0, r.X1], [false, r.X1, 1, 0, r.Y0, r.Y1], [false, r.X0, -1, 0, r.Y0, r.Y1],
  ];
  const walls = spec.walls || null;
  let shadeStrip = null;
  for (let k = 0; k < NR; k++) {
    const r = R[k];
    for (const [axisX, line, nx, ny, a0, a1] of sides(r)) {
      const pt = (a) => (axisX ? [a, line] : [line, a]);
      const parts = exposed(r, axisX, line, nx, ny, a0, a1);
      if (!parts.length) continue;
      const nrm = [nx, ny];
      // the eave shadow on the walls (tile by tile where the region has a wall)
      if (walls) for (const [p0, p1] of parts) {
        // runs of tiles with a wall under the roof's edge
        const runs = [];
        for (let a = Math.floor(p0 + 1e-6); a < p1 - 1e-6; a++) {
          const aa = Math.max(a, p0), ab = Math.min(a + 1, p1);
          if (ab - aa < 0.05) continue;
          const [ix, iy] = pt(a + 0.5), n = S.tileAt(Math.floor(ix - nx * 0.5), Math.floor(iy - ny * 0.5));
          if (n < 0 || !walls[n]) continue;
          const last = runs[runs.length - 1];
          if (last && Math.abs(last[1] - aa) < 1e-6) last[1] = ab; else runs.push([aa, ab]);
        }
        for (const [aa, ab] of runs) {
          shadeStrip ||= Strip(strips, 'shade', 4, 24, {});
          const [qx0, qy0] = pt(aa), [qx1, qy1] = pt(ab), e2 = 0.002;
          items.push({ k: 's', fp: [qx0 + nx * e2, qy0 + ny * e2, qx1 + nx * e2, qy1 + ny * e2], n: nrm, layer: 0, pri: -1, dk: [r.X0, r.Y0, r.X1, r.Y1],
            polys: [{ st: shadeStrip.id, dark: 1, col: [0, 0, 0], p: [qx0 + nx * e2, qy0 + ny * e2, He, 2, 0, qx1 + nx * e2, qy1 + ny * e2, He, 2, 0, qx1 + nx * e2, qy1 + ny * e2, He - SHADE_H, 2, 24, qx0 + nx * e2, qy0 + ny * e2, He - SHADE_H, 2, 24] }] });
        }
      }
      // gable ends: the ridge axis ends of a gable rectangle
      const gable = !r.hip && (r.ns ? axisX : !axisX);
      if (!gable) continue;
      const tent = (a) => He + r.p * Math.min(a - a0, a1 - a) - thick * 0.6;
      const cc = (a0 + a1) / 2, rise = r.rise;
      const winH = Math.min(0.62, (rise - 0.1) * 0.3), hw = winH * 0.46, half = r.half - S.e;
      let win = winH > 0.16 && half > 0.7;
      if (win) win = parts.some(([p0, p1]) => p0 < cc - hw - 0.08 && p1 > cc + hw + 0.08);
      const gs = Strip(strips, 'gable', (a1 - a0) * res, rise * res, { r: k, axisX, line, nx, ny, a0, a1, win });
      for (const [p0, p1] of parts) {
        // the face: He up to the tent (under the roof), clipped to h ≥ He
        let Q = [p0, He, p1, He, p1, tent(p1)];
        if (cc > p0 && cc < p1) Q.push(cc, tent(cc));
        Q.push(p0, tent(p0));
        // (a, h) polygon: counter-clockwise in (a, -h) is irrelevant for the clip of h ≥ He: keep He − h ≤ 0
        Q = clean(clip2(Q, 0, -1, He));
        if (!Q.length) continue;
        const p = [];
        for (let i = 0; i < Q.length; i += 2) { const a = Q[i], h = Q[i + 1], [x, y] = pt(a); p.push(x, y, h, (a - a0) * res, (He + rise - h) * res); }
        const [fx0, fy0] = pt(p0), [fx1, fy1] = pt(p1);
        items.push({ k: 'g', fp: [fx0, fy0, fx1, fy1], n: nrm, layer: 0, pri: 0, dk: [r.X0, r.Y0, r.X1, r.Y1], polys: [{ st: gs.id, vert: 1, col: r.S.gableCol, p }] });
      }
      if (win) {
        // its glow at night (a light inside): a warm blob just in front of the window
        const wy = He + rise * 0.36, gw = winH * 2.2 / 2, gh = winH * 1.8 / 2, e2 = 0.004;
        const [wx0, wy0] = pt(cc - gw), [wx1, wy1] = pt(cc + gw);
        const gl = strips.find((s) => s.kind === 'glow') || Strip(strips, 'glow', 32, 32, {});
        items.push({ k: 'w', fp: [wx0 + nx * e2, wy0 + ny * e2, wx1 + nx * e2, wy1 + ny * e2], n: nrm, layer: 0, pri: 3, dk: [r.X0, r.Y0, r.X1, r.Y1],
          polys: [{ st: gl.id, glow: 1, col: [1, 0.66, 0.3], p: [wx0 + nx * e2, wy0 + ny * e2, wy + gh, 0, 0, wx1 + nx * e2, wy1 + ny * e2, wy + gh, 32, 0, wx1 + nx * e2, wy1 + ny * e2, wy - gh, 32, 32, wx0 + nx * e2, wy0 + ny * e2, wy - gh, 0, 32] }] });
      }
    }
  }
  // ---- 4. chimneys over the hearths, the weathervane ----
  const chim = [];
  const bx0 = S.bx0, bw = S.bw;
  const white = () => strips.find((s) => s.kind === 'white') || Strip(strips, 'white', 4, 4, {});
  for (const [fx, fy] of spec.fires || []) {
    const cx = Math.min(bx0 + bw - 0.3, Math.max(bx0 + 0.3, fx)), cy = fy;
    if (chim.some((c) => Math.abs(c.x - cx) < 0.8 && Math.abs(c.y - cy) < 0.8)) continue;
    let base = -1e9, low = 1e9;
    for (const [ox, oy] of [[-CW / 2, -CD / 2], [CW / 2, -CD / 2], [-CW / 2, CD / 2], [CW / 2, CD / 2]]) { const h = S.surf(cx + ox, cy + oy); base = Math.max(base, h); low = Math.min(low, h); }
    if (base < -1e8 || low < -1e8) continue;
    const top = base + G.chimneyH * 0.75 + 0.25, capT = top + 0.02, capB = top - 0.07;
    chim.push({ x: cx, y: cy, top: capT });
    const x0c = cx - CW / 2, x1c = cx + CW / 2, y0c = cy - CD / 2, y1c = cy + CD / 2;
    const ss = Strip(strips, 'stone', (CW + 0.02) * res, (capB - low + 0.1) * res, { top: capB });
    const cs = Strip(strips, 'cap', (CW + 0.06) * res, 0.1 * res, {});
    const ls = Strip(strips, 'lid', (CW + 0.06) * res, (CD + 0.06) * res, {});
    const polys = [];
    // a side: corners left → right seen from outside; its foot follows the roof (sampled), its top at capB
    const side = (ax, ay, bx, by, nx, ny, wdt) => {
      const N = 4;
      for (let i = 0; i < N; i++) {
        const f0 = i / N, f1 = (i + 1) / N;
        const xa = ax + (bx - ax) * f0, ya = ay + (by - ay) * f0, xb = ax + (bx - ax) * f1, yb = ay + (by - ay) * f1;
        const ha = Math.max(low - 0.3, S.surf(xa, ya)) - 0.02, hb2 = Math.max(low - 0.3, S.surf(xb, yb)) - 0.02;
        const ua = f0 * wdt * res, ub = f1 * wdt * res, V = (h) => (capB - h) * res;
        polys.push({ st: ss.id, vert: 1, nn: [nx, ny], col: STONE, p: [xa, ya, capB, ua, 0, xb, yb, capB, ub, 0, xb, yb, hb2, ub, V(hb2), xa, ya, ha, ua, V(ha)] });
      }
    };
    side(x0c, y1c, x1c, y1c, 0, 1, CW); side(x1c, y0c, x0c, y0c, 0, -1, CW); side(x1c, y1c, x1c, y0c, 1, 0, CD); side(x0c, y0c, x0c, y1c, -1, 0, CD);
    // the cap: a slab a little wider than the shaft, then the flue on top
    const e3 = 0.03, X0 = x0c - e3, X1 = x1c + e3, Y0 = y0c - e3, Y1 = y1c + e3, cw2 = (CW + 2 * e3) * res, chH = (capT - capB) * res;
    const cap = (ax, ay, bx, by, nx, ny) => polys.push({ st: cs.id, vert: 1, nn: [nx, ny], col: STONE, p: [ax, ay, capT, 0, 0, bx, by, capT, cw2, 0, bx, by, capB, cw2, chH, ax, ay, capB, 0, chH] });
    cap(X0, Y1, X1, Y1, 0, 1); cap(X1, Y0, X0, Y0, 0, -1); cap(X1, Y1, X1, Y0, 1, 0); cap(X0, Y0, X0, Y1, -1, 0);
    const lw = (CW + 2 * e3) * res, lh = (CD + 2 * e3) * res;
    polys.push({ st: ls.id, col: [0.4, 0.39, 0.37], p: [X0, Y0, capT, 0, 0, X1, Y0, capT, lw, 0, X1, Y1, capT, lw, lh, X0, Y1, capT, 0, lh] });
    items.push({ k: 'c', fp: [X0, Y0, X1, Y0, X1, Y1, X0, Y1], n: null, layer: 1, pri: 0, dk: null, polys });
  }
  // the weathervane: one per roof, on the ridge of the tile that asked for it nearest the middle (as the north view)
  {
    const mcx = (spec.x0 + spec.x1 + 1) / 2, mcy = (spec.y0 + spec.y1 + 1) / 2;
    let vb = null, vd = 1e9;
    for (let n = 0; n < S.nT; n++) {
      if (!(det(n) & DET.vane)) continue;
      const i = S.T[n], tx = (i % S.W) + 0.5, ty = ((i / S.W) | 0) + 0.5, dd = Math.hypot(tx - mcx, ty - mcy);
      if (dd < vd) { vd = dd; vb = [tx, ty]; }
    }
    if (vb) {
      const [vx] = vb;
      let best = vb[1], bh2 = -1e9;
      for (let yy = vb[1] - 0.5; yy <= vb[1] + 0.5; yy += 0.05) { const h = S.surf(vx, yy); if (h > bh2) { bh2 = h; best = yy; } }
      if (bh2 > -1e8) {
        const wt = white(), I = [0.16, 0.15, 0.15], top = bh2 + 0.62, y = best, polys = [];
        const q = (ax, ay, ah, bx, by, bh, cx2, cy2, ch, dx2, dy2, dh, c = I) => polys.push({ st: wt.id, col: c, tint: 1, p: [ax, ay, ah, 2, 2, bx, by, bh, 2, 2, cx2, cy2, ch, 2, 2, dx2, dy2, dh, 2, 2] });
        const pw = 0.018;
        q(vx - pw, y, top, vx + pw, y, top, vx + pw, y, bh2, vx - pw, y, bh2);           // the pole (a cross: seen from any side)
        q(vx, y - pw, top, vx, y + pw, top, vx, y + pw, bh2, vx, y - pw, bh2);
        const ha = top - 0.1, t2 = 0.022;                                                 // the arrow (east), tail feather, head
        q(vx - 0.2, y, ha + t2, vx + 0.17, y, ha + t2, vx + 0.17, y, ha - t2, vx - 0.2, y, ha - t2);
        q(vx + 0.16, y, ha + 0.06, vx + 0.25, y, ha, vx + 0.25, y, ha, vx + 0.16, y, ha - 0.06);
        q(vx - 0.24, y, ha + 0.07, vx - 0.17, y, ha + 0.03, vx - 0.17, y, ha - 0.03, vx - 0.24, y, ha - 0.07);
        const hc = top - 0.24, t3 = 0.016;                                                 // the cardinal cross
        q(vx - 0.1, y, hc + t3, vx + 0.1, y, hc + t3, vx + 0.1, y, hc - t3, vx - 0.1, y, hc - t3);
        q(vx, y - 0.1, hc + t3, vx, y + 0.1, hc + t3, vx, y + 0.1, hc - t3, vx, y - 0.1, hc - t3);
        q(vx - 0.03, y, top + 0.05, vx + 0.03, y, top + 0.05, vx + 0.03, y, top - 0.01, vx - 0.03, y, top - 0.01); // the ball
        items.push({ k: 'n', fp: [vx - 0.05, y - 0.05, vx + 0.05, y - 0.05, vx + 0.05, y + 0.05, vx - 0.05, y + 0.05], n: null, layer: 1, pri: 1, dk: null, polys });
      }
    }
  }
  // ---- 5. atlas layout: the plan image on top, the strips packed in shelves under it ----
  const AW = Math.max(128, PW + 2 * PAD, ...strips.map((s) => s.w + 2 * PAD));
  const order = strips.slice().sort((a, b) => b.h - a.h);
  let cx = 0, cy = PH + 2 * PAD, rowH = 0;
  for (const s of order) {
    if (cx + s.w + 2 * PAD > AW) { cx = 0; cy += rowH; rowH = 0; }
    s.x0 = cx + PAD; s.y0 = cy + PAD;
    cx += s.w + 2 * PAD; rowH = Math.max(rowH, s.h + 2 * PAD);
  }
  const AH = cy + rowH;
  // strip-local pixels → uv
  let maxH = He;
  for (const it of items) for (const pl of it.polys) {
    const p = pl.p, s = pl.st >= 0 ? strips[pl.st] : null;
    for (let i = 0; i < p.length; i += 5) {
      const ox = s ? s.x0 : PAD, oy = s ? s.y0 : PAD;
      p[i + 3] = (ox + p[i + 3]) / AW; p[i + 4] = (oy + p[i + 4]) / AH;
      if (p[i + 2] > maxH) maxH = p[i + 2];
    }
    if (s && s.kind === 'white') for (let i = 0; i < p.length; i += 5) { p[i + 3] = (s.x0 + 2) / AW; p[i + 4] = (s.y0 + 2) / AH; }
  }
  const Gm = { v: 1, He, pres, res, AW, AH, planV: (PH + 2 * PAD) / AH, plan: [planX0, planY0, PW, PH], items, strips, chim, box: [x0, y0, x1, y1], maxH,
    rects: R.map((r) => [r.X0, r.Y0, r.X1, r.Y1]) };
  return { G: Gm, S };
}

export function turnedGeom(spec) { return build(spec).G; }

// ---------------- painting ----------------
export function rasterTurned(spec) {
  const { G, S } = build(spec);
  const { AW, AH, pres, res, He } = G;
  const out = new Uint8Array(AW * AH * 4);
  const R = S.rects;
  const det = (n) => (n >= 0 ? spec.det[n] | 0 : 0);
  const styleN = (n, r) => (n >= 0 ? S.ST[n] : r.S);
  const put = (x, y, r, g, b, a = 1) => { const o = (y * AW + x) * 4; out[o] = clamp255(r * a); out[o + 1] = clamp255(g * a); out[o + 2] = clamp255(b * a); out[o + 3] = clamp255(a); };
  // ---- the plan image ----
  const [planX0, planY0, PW, PH] = G.plan;
  const IW = PW + 2 * PAD, IH = PH + 2 * PAD;
  const fid = new Int16Array(IW * IH).fill(-1), inside = new Uint8Array(IW * IH);
  const col = new Float32Array(IW * IH * 3);
  for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) {
    let x = planX0 + (i - PAD + 0.5) / pres, y = planY0 + (j - PAD + 0.5) / pres;
    let H = S.surf(x, y), K = S.K, F = S.F;
    const q = j * IW + i;
    if (K < 0) {
      // outside every domain: the colour of the nearest domain point (no fringe when filtering)
      let bd = 1e9, bx = x, by = y;
      for (const r of R) {
        const cx = Math.min(r.dx1 - 1e-4, Math.max(r.dx0 + 1e-4, x)), cy = Math.min(r.dy1 - 1e-4, Math.max(r.dy0 + 1e-4, y)), d = Math.hypot(cx - x, cy - y);
        if (d < bd) { bd = d; bx = cx; by = cy; }
      }
      x = bx; y = by; H = S.surf(x, y); K = S.K; F = S.F;
      if (K < 0) continue;
    } else inside[q] = 1;
    const r = R[K], n = S.tileIn(r, x, y), s = styleN(n, r), d = det(n), p = r.p, k1 = 1 + p;
    fid[q] = K * 8 + F;
    // course coordinates: U along the facet's eave, V up the slope ("screen units" of a slope facing the camera)
    let U, V, ridgeD;
    if (F === 1 || F === 2) { U = y; V = (F === 1 ? x - r.dx0 : r.dx1 - x) * k1; ridgeD = r.ns ? Math.abs(x - r.c) * k1 : 9; }
    else { U = x; V = (F === 3 ? r.dy1 - y : y - r.dy0) * k1; ridgeD = r.ns ? 9 : Math.abs(y - r.c) * k1; }
    const tint = (1 + 0.06 * Math.sin(x * 0.9 + y * 0.6) * Math.sin(y * 1.3 - x * 0.45)) * (0.9 + 0.1 * smooth(0, 1.6, V))
      * (1 + (vnoise(x * 0.45 + 31, y * 0.45) - 0.5) * 0.14);
    const lum = patLum(s, U, V);
    let Rc, Gc, Bc;
    if (lum < 1) { const t = Math.max(0, lum); Rc = s.dark[0] + (s.base[0] - s.dark[0]) * t; Gc = s.dark[1] + (s.base[1] - s.dark[1]) * t; Bc = s.dark[2] + (s.base[2] - s.dark[2]) * t; }
    else { const t = Math.min(1, (lum - 1) * 1.6); Rc = s.base[0] + (s.light[0] - s.base[0]) * t; Gc = s.base[1] + (s.light[1] - s.base[1]) * t; Bc = s.base[2] + (s.light[2] - s.base[2]) * t; }
    Rc *= tint; Gc *= tint; Bc *= tint;
    if (d & DET.moss) {
      const m = smooth(0.55, 0.8, vnoise(x * 1.7, y * 1.7) + (F === 4 || F === 2 ? 0.15 : -0.05));
      Rc += (0.3 - Rc) * m * 0.6; Gc += (0.38 - Gc) * m * 0.6; Bc += (0.18 - Bc) * m * 0.6;
    }
    let shade = r.sh[F];
    const capW = s.ridge === 'bound' ? 0.16 : 0.1;
    if (ridgeD < capW && H > He + r.rise - 0.25) {
      const cap = 1 - ridgeD / capW, along = r.ns ? y : x;
      const cc = s.ridge === 'board' ? s.board : s.ridge === 'bound' ? s.base : s.dark;
      let kk = s.ridge === 'board' ? 1.7 : s.ridge === 'bound' ? 0.95 : 1.25;
      kk *= 0.72 + 0.5 * Math.sqrt(cap);
      if (s.ridge === 'tile') { const u = (((along * 3.1) % 1) + 1) % 1; kk *= u < 0.08 ? 0.55 : 0.9 + 0.2 * Math.sin(u * 3.1416); }
      else if (s.ridge === 'bound') { if (Math.abs((((along * 1.6) % 1) + 1) % 1 - 0.5) < 0.05) kk *= 0.55; kk *= 0.92 + 0.16 * hash(Math.floor(along * 30), 9); }
      if (cap < 0.22) kk *= 0.5;
      Rc = cc[0] * kk; Gc = cc[1] * kk; Bc = cc[2] * kk;
      shade = Math.max(shade, 0.95);
    }
    const rakeD = r.ns ? (r.hip ? 9 : Math.min(y - r.dy0, r.dy1 - y)) : (r.hip ? 9 : Math.min(x - r.dx0, r.dx1 - x));
    if (rakeD < 0.09) {
      const bc = d & DET.trim ? TRIM : s.board, hi = rakeD < 0.03 ? 1.3 : 1;
      Rc = bc[0] * hi; Gc = bc[1] * hi; Bc = bc[2] * hi; shade = 0.95;
    }
    col[q * 3] = Rc * shade; col[q * 3 + 1] = Gc * shade; col[q * 3 + 2] = Bc * shade;
  }
  // creases (hip caps / valley gutters) and a soft dark line along the free edges, then out
  for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) {
    const q = j * IW + i, f = fid[q];
    if (f < 0) continue;
    let Rc = col[q * 3], Gc = col[q * 3 + 1], Bc = col[q * 3 + 2];
    let crease = 0, valley = 0, edge = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= IW || jj >= IH) continue;
      const qq = jj * IW + ii;
      if (!inside[qq]) { if (inside[q]) edge++; continue; }
      const g = fid[qq];
      if (g === f || g < 0) continue;
      if (g >> 3 === f >> 3) crease++; else valley++;
    }
    if (!inside[q]) edge = 3;
    if (valley) { Rc *= 0.55; Gc *= 0.55; Bc *= 0.57; }
    else if (crease) {
      const r = R[f >> 3], s = r.S, cc = s.ridge === 'board' ? s.board : s.dark;
      Rc = Rc * 0.35 + cc[0] * 1.2 * 0.65; Gc = Gc * 0.35 + cc[1] * 1.2 * 0.65; Bc = Bc * 0.35 + cc[2] * 1.2 * 0.65;
    }
    if (edge) { const m = edge >= 3 ? 0.55 : 0.7; Rc *= m; Gc *= m; Bc *= m; }
    put(i, j, Rc, Gc, Bc);
  }
  // ---- strips ----
  const GCo = [0, 0, 0];
  for (const st of G.strips) {
    const { x0, y0, w, h } = st;
    const each = (fn) => { for (let j = -PAD; j < h + PAD; j++) for (let i = -PAD; i < w + PAD; i++) { const ci = Math.min(w - 1, Math.max(0, i)), cj = Math.min(h - 1, Math.max(0, j)); fn(x0 + i, y0 + j, ci, cj); } };
    if (st.kind === 'gable') {
      const r = R[st.r], a0 = st.a0, rise = r.rise, half = r.half - S.e, cc = (st.a0 + st.a1) / 2;
      each((X, Y, i, j) => {
        const a = a0 + (i + 0.5) / res, hb = rise - (j + 0.5) / res;
        const [px, py] = st.axisX ? [a, st.line] : [st.line, a];
        const s = styleN(S.tileIn(r, px - st.nx * 0.5, py - st.ny * 0.5), r);
        const c = gableRGB(s, a, a - a0, a - cc, hb, rise, st.win && half > 0.7, GCo);
        const top = r.p * Math.min(a - a0, st.a1 - a);
        const ao = 1 - 0.38 * smooth(top - 0.35, top, hb);
        put(X, Y, c[0] * ao, c[1] * ao, c[2] * ao);
      });
    } else if (st.kind === 'step') {
      const r = R[st.r];
      each((X, Y, i, j) => {
        const t = (i + 0.5) / res, hh = st.ht - (j + 0.5) / res, px = st.ax + st.dx * t, py = st.ay + st.dy * t;
        const s = styleN(S.tileIn(r, px - st.nx * 0.4, py - st.ny * 0.4), r);
        const c = gableRGB(s, st.dx ? px : py, t, 9, hh - He + 0.2, 0, false, GCo);
        const ao = 1 - 0.3 * smooth(st.ht - 0.3, st.ht, hh);
        put(X, Y, c[0] * ao, c[1] * ao, c[2] * ao);
      });
    } else if (st.kind === 'board') {
      const c = st.col;
      each((X, Y, i, j) => { const t = ((j + 0.5) / 16) * BOARD_H * res; const lum = t < 1.2 ? 1.45 : 0.85 - 0.25 * smooth(0, 7, t); put(X, Y, c[0] * lum, c[1] * lum, c[2] * lum); });
    } else if (st.kind === 'stone') {
      each((X, Y, i, j) => {
        const hh = st.top - (j + 0.5) / res, x = (i + 0.5) / res;
        const row = Math.floor(hh / 0.1), uu = x / 0.12 + (row & 1) * 0.5, fu = uu - Math.floor(uu), fv = hh / 0.1 - row;
        const lum = (fv < 0.14 || fu < 0.1 ? 0.55 : 0.95 + (hash(Math.floor(uu), row) - 0.5) * 0.25) * 0.85;
        put(X, Y, STONE[0] * lum, STONE[1] * lum, STONE[2] * lum);
      });
    } else if (st.kind === 'cap') {
      each((X, Y, i, j) => { const v = (j + 0.5) / h, lum = v > 0.8 ? 0.55 : v < 0.2 ? 1.12 : 0.98; put(X, Y, STONE[0] * lum, STONE[1] * lum, STONE[2] * lum); });
    } else if (st.kind === 'lid') {
      each((X, Y, i, j) => {
        const u = (i + 0.5) / w - 0.5, v = (j + 0.5) / h - 0.5;
        const hole = Math.abs(u) < 0.3 && Math.abs(v) < 0.27, rim = !hole && (Math.abs(u) > 0.42 || Math.abs(v) > 0.4);
        if (hole) put(X, Y, 0.07, 0.06, 0.06); else put(X, Y, rim ? 0.42 : 0.52, rim ? 0.41 : 0.5, rim ? 0.39 : 0.47);
      });
    } else if (st.kind === 'glow') {
      each((X, Y, i, j) => {
        const u = ((i + 0.5) / w) * 2 - 1, v = ((j + 0.5) / h) * 2 - 1, d = Math.min(1, Math.hypot(u, v));
        // (fx_glow's warm gradient)
        const a = d < 0.3 ? 0.9 - (0.45 * d) / 0.3 : d < 0.7 ? 0.45 - (0.33 * (d - 0.3)) / 0.4 : 0.12 * (1 - (d - 0.7) / 0.3);
        const rr = 1, gg = d < 0.3 ? 0.78 - 0.19 * (d / 0.3) : 0.59 - 0.28 * Math.min(1, (d - 0.3) / 0.7), bb = d < 0.3 ? 0.47 - 0.23 * (d / 0.3) : 0.24 - 0.2 * Math.min(1, (d - 0.3) / 0.7);
        put(X, Y, rr, gg, bb, Math.max(0, a));
      });
    } else if (st.kind === 'shade') {
      each((X, Y, i, j) => { const q = (j + 0.5) / h; put(X, Y, 1, 1, 1, 0.34 * (1 - q) ** 1.5); });
    } else if (st.kind === 'white') each((X, Y) => put(X, Y, 1, 1, 1));
  }
  return { w: AW, h: AH, color: out, geom: G };
}

// ---------------- per camera angle: what faces the camera, in a painter's order, in view columns ----------------
// G: turnedGeom; c, s: cos / sin of the camera yaw. Returns { cols: [{ k, key, pieces }] } where a piece is
// { p: [x, y, h, u, v, ...], col, vert (shade by normal), n, glow, dark } in drawing order.
export function turnedView(G, c, s) {
  const its = G.items, vis = [];
  for (const it of its) {
    if (it.k === 'f') { if (-s * it.gA + c * it.gB < 0.985) vis.push(it); }
    else if (it.n) { if (-s * it.n[0] + c * it.n[1] > 0.03) vis.push(it); }
    else vis.push(it);
  }
  const N = vis.length;
  // footprints in view space (vx, vy), their vx range
  const fv = new Array(N), lo = new Float64Array(N), hi = new Float64Array(N), mid = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const P = vis[i].fp, V = [];
    let a = 1e9, b = -1e9, m = 0;
    for (let j = 0; j < P.length; j += 2) { const vx = c * P[j] + s * P[j + 1], vy = -s * P[j] + c * P[j + 1]; V.push(vx, vy); if (vx < a) a = vx; if (vx > b) b = vx; m += vy; }
    fv[i] = V; lo[i] = a; hi[i] = b; mid[i] = m / (P.length / 2);
  }
  // vy interval of footprint i on the view line vx = m
  const span = (i, m) => {
    const V = fv[i], n = V.length >> 1;
    let a = 1e9, b = -1e9;
    if (n === 2) {
      const x0 = V[0], y0 = V[1], x1 = V[2], y1 = V[3];
      const t = Math.abs(x1 - x0) < 1e-9 ? 0.5 : Math.min(1, Math.max(0, (m - x0) / (x1 - x0))), y = y0 + (y1 - y0) * t;
      return [y, y];
    }
    for (let k = 0, j = n - 1; k < n; j = k++) {
      const x0 = V[2 * j], y0 = V[2 * j + 1], x1 = V[2 * k], y1 = V[2 * k + 1];
      if ((x0 - m) * (x1 - m) > 0) continue;
      if (Math.abs(x1 - x0) < 1e-12) { a = Math.min(a, y0, y1); b = Math.max(b, y0, y1); continue; }
      const y = y0 + ((y1 - y0) * (m - x0)) / (x1 - x0);
      if (y < a) a = y; if (y > b) b = y;
    }
    return a > b ? null : [a, b];
  };
  // "i before j" edges
  const succ = Array.from({ length: N }, () => []), indeg = new Int32Array(N);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const a = Math.max(lo[i], lo[j]), b = Math.min(hi[i], hi[j]);
    if (b - a < 1e-4) continue;
    const m = (a + b) / 2, si = span(i, m), sj = span(j, m);
    if (!si || !sj) continue;
    let first;
    const ov = Math.min(si[1], sj[1]) - Math.max(si[0], sj[0]);
    if (vis[i].layer !== vis[j].layer && ov > 1e-4) first = vis[i].layer < vis[j].layer ? i : j;
    else {
      const mi = (si[0] + si[1]) / 2, mj = (sj[0] + sj[1]) / 2;
      if (Math.abs(mi - mj) < 1e-6) first = vis[i].pri <= vis[j].pri ? i : j;
      else first = mi < mj ? i : j;
    }
    const second = first === i ? j : i;
    succ[first].push(second); indeg[second]++;
  }
  // Kahn, the nearest-to-the-back first among the ready ones (a cycle — numerically — breaks at the back-most)
  const done = new Uint8Array(N), ord = [];
  for (let n = 0; n < N; n++) {
    let best = -1;
    for (let i = 0; i < N; i++) if (!done[i] && indeg[i] === 0 && (best < 0 || mid[i] < mid[best])) best = i;
    if (best < 0) for (let i = 0; i < N; i++) if (!done[i] && (best < 0 || mid[i] < mid[best])) best = i;
    done[best] = 1; ord.push(best);
    for (const j of succ[best]) indeg[j]--;
  }
  // view columns (one tile wide): each piece cut to its column, keyed by the front-most point of its item (clamped
  // into its rectangle's walls: a sprite standing under the eaves in front of a wall draws over them, as in the
  // north view)
  const cols = new Map();
  for (const i of ord) {
    const it = vis[i];
    let key = -1e9;
    const P = it.fp;
    for (let j = 0; j < P.length; j += 2) {
      let x = P[j], y = P[j + 1];
      if (it.dk) { x = Math.min(it.dk[2], Math.max(it.dk[0], x)); y = Math.min(it.dk[3], Math.max(it.dk[1], y)); }
      key = Math.max(key, -s * x + c * y);
    }
    for (const pl of it.polys) {
      if (pl.nn && -s * pl.nn[0] + c * pl.nn[1] <= 0.02) continue;
      const p = pl.p;
      let a = 1e9, b = -1e9;
      for (let j = 0; j < p.length; j += 5) { const vx = c * p[j] + s * p[j + 1]; if (vx < a) a = vx; if (vx > b) b = vx; }
      for (let k = Math.floor(a); k <= Math.floor(b - 1e-9); k++) {
        let q = p;
        if (a < k) q = clip5(q, -c, -s, k);
        if (q.length && b > k + 1) q = clip5(q, c, s, -(k + 1));
        if (q.length < 15) continue;
        let col = cols.get(k);
        if (!col) { col = { k, key: -1e9, pieces: [] }; cols.set(k, col); }
        if (key > col.key) col.key = key;
        col.pieces.push({ p: q, col: pl.col, vert: pl.vert ? 1 : 0, n: pl.nn || it.n, glow: pl.glow ? 1 : 0, dark: pl.dark ? 1 : 0, tint: pl.tint ? 1 : 0 });
      }
    }
  }
  // a column's key also covers every wall box under the roof that overlaps it on screen: the front-most point of the
  // walls (the rectangles) within half a tile diagonal of the column (a wall box drawn after a roof column would put its
  // top over the eaves)
  const RP = G.rects.map(([X0, Y0, X1, Y1]) => [X0, Y0, X1, Y0, X1, Y1, X0, Y1]);
  for (const col of cols.values()) {
    const a = col.k - 0.72, b = col.k + 1.72;
    for (const P of RP) {
      let q = clip2(P, -c, -s, a);
      if (q.length) q = clip2(q, c, s, -b);
      for (let j = 0; j < q.length; j += 2) { const vy = -s * q[j] + c * q[j + 1]; if (vy > col.key) col.key = vy; }
    }
    col.key += 0.02; // (ties and the camera angle's step: the walls first)
  }
  return { cols: [...cols.values()].sort((a, b) => a.k - b.k) };
}
// clip a polygon of (x, y, h, u, v) vertices: keep a·x + b·y + c ≤ 0
function clip5(P, a, b, c) {
  const n = (P.length / 5) | 0, out = [];
  if (n < 3) return out;
  let j = n - 1, dj = a * P[5 * j] + b * P[5 * j + 1] + c;
  for (let i = 0; i < n; i++) {
    const di = a * P[5 * i] + b * P[5 * i + 1] + c;
    if (di <= 1e-12) {
      if (dj > 1e-12) { const t = dj / (dj - di); for (let k = 0; k < 5; k++) out.push(P[5 * j + k] + (P[5 * i + k] - P[5 * j + k]) * t); }
      for (let k = 0; k < 5; k++) out.push(P[5 * i + k]);
    } else if (dj < 0) { const t = dj / (dj - di); for (let k = 0; k < 5; k++) out.push(P[5 * j + k] + (P[5 * i + k] - P[5 * j + k]) * t); }
    j = i; dj = di;
  }
  return out;
}
