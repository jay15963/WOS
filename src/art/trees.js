// Trees (3/4 view, trunk at the bottom, canopy above). Sizes in tiles; anchor = trunk base.

import { sprite, rng, OW, TAU, lin, atop, fill, taper, leaf, ramp, rgb, hex, smoothClosed, blobPts } from './paint.js';
import { mkLump, drawFoliage } from './foliage.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const BARK = { deep: '#2e2016', dark: '#47311f', mid: '#664730', light: '#87643f', high: '#a07b52' };

const OAK_PALS = [
  { deep: '#263c17', dark: '#365222', mid: '#4c6e2b', light: '#668c35', high: '#86a948' },
  { deep: '#2c3f15', dark: '#3f5820', mid: '#57752a', light: '#729234', high: '#93ad4a' },
  { deep: '#223a1a', dark: '#304d25', mid: '#43662f', light: '#5c8239', high: '#7b9f4d' },
  { deep: '#2f3d16', dark: '#45561f', mid: '#5f722a', light: '#7c8e35', high: '#9aa84b' },
  { deep: '#253d19', dark: '#345423', mid: '#4a722d', light: '#649236', high: '#84ad4b' },
];

// trunk polygon with root flare; returns top point
function trunkPath(g, cx, baseY, topY, wb, wt, lean, rand) {
  const flare = wb * 0.35;
  const lx0 = cx - wb / 2, rx0 = cx + wb / 2;
  const tx = cx + lean;
  g.moveTo(lx0 - flare, baseY);
  g.quadraticCurveTo(lx0 + 1, baseY - 4, lx0 + 2, baseY - 12);
  g.quadraticCurveTo(tx - wt / 2 - 2 + lean * 0.3, (baseY + topY) / 2, tx - wt / 2, topY);
  g.lineTo(tx + wt / 2, topY);
  g.quadraticCurveTo(tx + wt / 2 + 2 + lean * 0.3, (baseY + topY) / 2, rx0 - 2, baseY - 12);
  g.quadraticCurveTo(rx0 - 1, baseY - 4, rx0 + flare, baseY);
  // root bumps along the bottom
  g.quadraticCurveTo(rx0 - 2, baseY + 2.5, cx + wb * 0.15, baseY + 1);
  g.quadraticCurveTo(cx, baseY + 3.5 + rand() * 1.5, cx - wb * 0.15, baseY + 1);
  g.quadraticCurveTo(lx0 + 2, baseY + 2.5, lx0 - flare, baseY);
  g.closePath();
}

function drawTrunk(g, cx, baseY, topY, wb, wt, lean, rand, bark, shadeTo) {
  const path = (gg) => trunkPath(gg, cx, baseY, topY, wb, wt, lean, rand);
  fill(g, lin(g, cx - wb, 0, cx + wb, 0, [[0, bark.high], [0.3, bark.light], [0.55, bark.mid], [0.8, bark.dark], [1, bark.deep]]), path);
  g.save(); g.beginPath(); path(g); g.clip();
  // bark grooves
  g.lineWidth = 1.3;
  for (let i = 0; i < 6; i++) {
    const u = (i + 0.5) / 6 - 0.5 + (rand() - 0.5) * 0.08;
    const x0 = cx + u * wb * 0.9, x1 = cx + lean + u * wt * 0.9;
    g.strokeStyle = rgb(hex(bark.deep), 0.55 + rand() * 0.3);
    g.beginPath();
    const y0 = baseY - 2 - rand() * 6, y1 = topY + rand() * 20;
    g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + (rand() - 0.5) * 4, y0 + (y1 - y0) * 0.33, x1 + (rand() - 0.5) * 4, y0 + (y1 - y0) * 0.66, x1, y1);
    g.stroke();
  }
  g.lineWidth = 1;
  g.strokeStyle = rgb(hex(bark.high), 0.6);
  for (let i = 0; i < 3; i++) {
    const x = cx - wb * 0.28 + rand() * 3, y = baseY - 10 - rand() * (baseY - topY) * 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean * 0.05, y - 6 - rand() * 8); g.stroke();
  }
  // canopy shadow on the upper trunk
  if (shadeTo) {
    g.fillStyle = lin(g, 0, topY, 0, shadeTo, [[0, rgb(hex(bark.deep), 0.95)], [0.6, rgb(hex(bark.deep), 0.6)], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(cx - wb * 2, topY - 2, wb * 4, shadeTo - topY + 2);
  }
  g.restore();
}

// ---------------- OAK ----------------
function oak(v) {
  const rand = rng(1000 + v * 77);
  const shapes = [
    { W: 2.7, rx: 72, ry: 60, n: 6, trunk: 40, ox: 0 },
    { W: 2.7, rx: 67, ry: 62, n: 6, trunk: 44, ox: -7 },
    { W: 2.85, rx: 80, ry: 56, n: 7, trunk: 38, ox: 2 },
    { W: 2.6, rx: 62, ry: 68, n: 6, trunk: 46, ox: 7 },
    { W: 2.75, rx: 72, ry: 62, n: 7, trunk: 42, ox: -4 },
  ];
  const S = shapes[v % shapes.length];
  const pal = OAK_PALS[v % OAK_PALS.length];
  const Hpx = 12 + S.ry * 2 + S.trunk + 9;
  const canvas = sprite(S.W, Hpx / 64, (g, P) => {
    const W = P.W, H = P.H;
    const cx = W / 2, baseY = H - 9;
    const ccy = 12 + S.ry;
    const lean = S.ox * 0.8 + (rand() - 0.5) * 4;
    const ccx = cx + S.ox;
    // trunk with a fork disappearing into the canopy
    P.layer((g) => {
      const tx = cx + lean, ty = ccy + S.ry * 0.35;
      g.fillStyle = BARK.mid;
      for (const side of [-1, 1]) {
        g.beginPath(); taper(g, tx, ty + 14, tx + side * 10, ty, tx + side * (22 + rand() * 8), ty - 18 - rand() * 8, 11, 5); g.fill();
      }
      drawTrunk(g, cx, baseY, ty + 2, 28, 17, lean, rand, BARK, ccy + S.ry * 1.02);
    });
    // canopy
    const all = [];
    const n = S.n;
    const a0 = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + (rand() - 0.5) * 0.45;
      const k = 0.5 + rand() * 0.1;
      const r = Math.min(S.rx, S.ry) * (0.44 + rand() * 0.1);
      all.push(mkLump(ccx + Math.cos(a) * S.rx * k, ccy + Math.sin(a) * S.ry * k * 0.92, r, rand));
    }
    const m = 2 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < m; i++) {
      const a = rand() * TAU, d = 0.12 + rand() * 0.2;
      all.push(mkLump(ccx + Math.cos(a) * S.rx * d, ccy + Math.sin(a) * S.ry * d - S.ry * 0.12, Math.min(S.rx, S.ry) * (0.42 + rand() * 0.08), rand));
    }
    P.layer((g) => drawFoliage(g, all, pal, rand, { cx: ccx, cy: ccy, R: S.rx, RY: S.ry, marks: 1.1 }));
  });
  return canvas;
}

// ---------------- PINE ----------------
const PINE_PALS = [
  { deep: '#14261c', dark: '#1e3627', mid: '#2b4a35', light: '#3d6247', high: '#567d5c' },
  { deep: '#152a20', dark: '#1f3b2c', mid: '#2d513b', light: '#40694d', high: '#5a8463' },
  { deep: '#17261a', dark: '#223825', mid: '#304e31', light: '#436542', high: '#5d7f57' },
  { deep: '#13241f', dark: '#1c352d', mid: '#294a3e', light: '#3a6150', high: '#527c68' },
];

function tierPts(cx, topY, botY, w, rand, teeth) {
  const pts = [];
  const asym = (rand() - 0.5) * 0.18;
  const wl = w * (1 + asym), wr = w * (1 - asym);
  pts.push([cx + (rand() - 0.5) * 2, topY]);
  const sag = (botY - topY) * 0.14;
  // left slope (slightly concave), a few small notches
  const steps = 4;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = cx - wl * Math.pow(t, 0.85);
    const y = topY + (botY - topY) * t - (1 - t) * t * 6;
    pts.push([x + (i % 2 ? 1.5 : -1.5) + (rand() - 0.5) * 1.5, y]);
  }
  pts.push([cx - wl - 2, botY + 2 + rand() * 3]);
  // bottom: drooping sawtooth along a sagging curve (irregular needle clumps)
  for (let i = 1; i < teeth; i++) {
    const t = (i + (rand() - 0.5) * 0.35) / teeth;
    const x = cx - wl + (wl + wr) * t;
    const u = (x - cx) / (x < cx ? wl : wr);
    const yb = botY + sag * (1 - u * u);
    const tip = i % 2 === 1;
    const d = tip ? 3.5 + rand() * 4.5 + (rand() < 0.18 ? 3 : 0) : -2.5 - rand() * 2.5;
    pts.push([x + (rand() - 0.5) * 2, yb + d]);
  }
  pts.push([cx + wr + 2, botY + 2 + rand() * 3]);
  for (let i = steps - 1; i >= 1; i--) {
    const t = i / steps;
    const x = cx + wr * Math.pow(t, 0.85);
    const y = topY + (botY - topY) * t - (1 - t) * t * 6;
    pts.push([x + (i % 2 ? -1.5 : 1.5) + (rand() - 0.5) * 1.5, y]);
  }
  return pts;
}
function polyPath(g, pts) { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }

function pine(v) {
  const rand = rng(2000 + v * 131);
  const shapes = [
    { W: 2.3, H: 3.6, n: 5, w0: 60 },
    { W: 2.1, H: 3.8, n: 6, w0: 54 },
    { W: 2.4, H: 3.3, n: 5, w0: 64 },
    { W: 2.2, H: 3.5, n: 5, w0: 58 },
  ];
  const S = shapes[v % shapes.length];
  const pal = PINE_PALS[v % PINE_PALS.length];
  const stops = [pal.deep, pal.dark, pal.mid, pal.light, pal.high];
  return sprite(S.W, S.H, (g, P) => {
    const W = P.W, H = P.H;
    const cx = W / 2, baseY = H - 9;
    const lowest = baseY - 22;
    const top = 8;
    P.layer((g) => drawTrunk(g, cx, baseY, lowest - 10, 15, 9, 0, rand, { deep: '#2a1a12', dark: '#41281a', mid: '#5c3a25', light: '#7a5034', high: '#8f6244' }, lowest + 8));
    P.layer((g) => {
      const n = S.n;
      const span = lowest - top;
      const tiers = [];
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const botY = lowest - span * (Math.pow(f, 1.08) * 0.82);
        const w = S.w0 * Math.pow(1 - f * 0.86, 0.95) * (0.95 + rand() * 0.1);
        const h = k === n - 1 ? botY - top : (span / n) * 2.1;
        tiers.push({ botY, w, topY: Math.max(top, botY - h), pts: null });
      }
      for (const T of tiers) T.pts = tierPts(cx, T.topY, T.botY, T.w, rand, T.w > 40 ? 13 : T.w > 25 ? 9 : 7);
      for (let k = 0; k < n; k++) {
        const T = tiers[k];
        // drop shadow onto the tier below
        if (k > 0) {
          atop(g, () => {
            g.translate(2.5, 7);
            fill(g, rgb(hex(pal.deep), 0.85), (gg) => polyPath(gg, T.pts));
          });
        }
        const x0 = cx - T.w, x1 = cx + T.w;
        fill(g, lin(g, x0, T.topY, x1, T.botY, [[0, ramp(stops, 0.78)], [0.3, ramp(stops, 0.6)], [0.5, ramp(stops, 0.48)], [0.58, ramp(stops, 0.3)], [1, ramp(stops, 0.18)]]), (gg) => polyPath(gg, T.pts));
        g.save(); g.beginPath(); polyPath(g, T.pts); g.clip();
        // needle clusters (scattered, irregular), batched per tone
        g.lineWidth = 1.15;
        const area = T.w * (T.botY - T.topY);
        const nm = Math.round(area / 26);
        const NBN = 8, litP = [], darkP = [];
        for (let i = 0; i < NBN; i++) { litP.push(null); darkP.push(null); }
        for (let i = 0; i < nm; i++) {
          const t = Math.sqrt(rand());
          const y = T.topY + 4 + (T.botY - T.topY - 2) * t;
          const half = T.w * Math.pow(t, 0.85);
          const x = cx + (rand() * 2 - 1) * half;
          const u = (x - cx) / Math.max(1, T.w);
          const lit = u < -0.08 - rand() * 0.2;
          const tone = lit ? clamp01(0.82 - t * 0.2 + rand() * 0.1) : clamp01(0.05 + rand() * 0.1);
          const arr = lit ? litP : darkP;
          const b = Math.round(tone * (NBN - 1));
          const path = arr[b] || (arr[b] = new Path2D());
          const sz = 2 + rand() * 2.5, sk = (rand() - 0.5) * 0.8;
          path.moveTo(x - sz + sk, y + sz * 0.8); path.lineTo(x, y); path.lineTo(x + sz + sk, y + sz * 0.8);
        }
        for (let b = 0; b < NBN; b++) {
          if (litP[b]) { g.strokeStyle = ramp(stops, b / (NBN - 1), 0.75); g.stroke(litP[b]); }
          if (darkP[b]) { g.strokeStyle = ramp(stops, b / (NBN - 1), 0.6); g.stroke(darkP[b]); }
        }
        // darker drooping fringe at the bottom
        g.strokeStyle = rgb(hex(pal.deep), 0.7);
        g.lineWidth = 3;
        g.beginPath();
        const bp = T.pts.slice(4, T.pts.length - 3);
        for (let i = 0; i < bp.length; i++) (i ? g.lineTo : g.moveTo).call(g, bp[i][0], bp[i][1] - 1);
        g.stroke();
        // lit left rim
        g.strokeStyle = ramp(stops, 0.95, 0.75);
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(T.pts[0][0], T.pts[0][1] + 2);
        for (let i = 1; i <= 4; i++) g.lineTo(T.pts[i][0] + 2, T.pts[i][1]);
        g.stroke();
        g.restore();
      }
      // overall volume
      atop(g, () => {
        g.fillStyle = lin(g, 0, top, 0, lowest + 12, [[0, 'rgba(255,255,220,0.06)'], [0.7, 'rgba(0,0,0,0)'], [1, rgb(hex(pal.deep), 0.35)]]);
        g.fillRect(0, 0, W, H);
      });
    });
  });
}

// ---------------- BIRCH ----------------
const BIRCH_PALS = [
  { deep: '#3f5221', dark: '#566d2a', mid: '#728b35', light: '#91a944', high: '#b2c35e' },
  { deep: '#45551f', dark: '#5e7128', mid: '#7c9033', light: '#9cae43', high: '#bcc65d' },
  { deep: '#3a5024', dark: '#4f6a2d', mid: '#698838', light: '#86a647', high: '#a6bf5f' },
];
function birch(v) {
  const rand = rng(3000 + v * 191);
  const S = [{ W: 2.0, rx: 42, ry: 64, trunk: 62 }, { W: 2.1, rx: 46, ry: 58, trunk: 58 }, { W: 1.9, rx: 38, ry: 70, trunk: 64 }][v % 3];
  const pal = BIRCH_PALS[v % BIRCH_PALS.length];
  const Hpx = 10 + S.ry * 2 + S.trunk + 9;
  return sprite(S.W, Hpx / 64, (g, P) => {
    const W = P.W, H = P.H;
    const cx = W / 2, baseY = H - 9;
    const ccy = 10 + S.ry;
    const topY = ccy - S.ry * 0.55;
    const lean = (rand() - 0.5) * 10;
    const bend = (rand() - 0.5) * 8;
    const tx = cx + lean, mx = cx + bend;
    const barkFill = (gg) => { gg.fillStyle = lin(gg, cx - 7, 0, cx + 7, 0, [[0, '#f6f3ea'], [0.45, '#e2ddd0'], [0.78, '#bcb6a7'], [1, '#8f897b']]); };
    const trunkPath = (gg) => { taper(gg, cx, baseY + 1, mx, (baseY + topY) / 2, tx, topY, 12, 5, 16); gg.ellipse(cx, baseY - 1, 9, 3.5, 0, 0, TAU); };
    const sideC = [
      { x: tx - S.rx * 0.82, y: ccy + S.ry * (0.15 + rand() * 0.25), r: 13 + rand() * 3 },
      { x: tx + S.rx * 0.82, y: ccy + S.ry * (-0.05 + rand() * 0.3), r: 12 + rand() * 3 },
    ];
    // trunk & branches
    P.layer((g) => {
      for (const C of sideC) {
        const s = Math.sign(C.x - tx);
        const y0 = C.y + 18;
        const x0 = tx + (mx - tx) * 0.3;
        barkFill(g);
        g.beginPath(); taper(g, x0, y0 + 8, x0 + s * 8, y0 - 2, C.x - s * 4, C.y + 2, 4.5, 2); g.fill();
      }
      barkFill(g);
      g.beginPath(); trunkPath(g); g.fill();
      g.save(); g.beginPath(); trunkPath(g); g.clip();
      g.fillStyle = '#2a2622';
      for (let i = 0; i < 18; i++) {
        const t = rand() * 0.85;
        const y = baseY - (baseY - topY) * t;
        const x = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * mx + t * t * tx;
        const w = 2 + rand() * 4;
        g.beginPath(); g.ellipse(x + (rand() - 0.5) * 7, y, w, 0.8 + rand() * 0.9, (rand() - 0.5) * 0.25, 0, TAU); g.fill();
      }
      for (let i = 0; i < 5; i++) {
        g.beginPath(); smoothClosed(g, blobPts(cx + (rand() - 0.5) * 9, baseY - 2 - rand() * 12, 3 + rand() * 3, 2 + rand() * 2.5, rand, 7, 0.3)); g.fill();
      }
      // shade under canopy
      g.fillStyle = lin(g, 0, topY, 0, ccy + S.ry + 6, [[0, 'rgba(40,44,30,0.9)'], [0.75, 'rgba(40,44,30,0.55)'], [1, 'rgba(40,44,30,0)']]);
      g.fillRect(0, 0, W, ccy + S.ry + 6);
      g.restore();
    });
    // side clumps (behind the main mass, airy silhouette)
    for (const C of sideC) {
      P.layer((g) => {
        const lumps = [];
        for (let i = 0; i < 3; i++) {
          const a = rand() * TAU;
          lumps.push(mkLump(C.x + Math.cos(a) * C.r * 0.4, C.y + Math.sin(a) * C.r * 0.3, C.r * (0.62 + rand() * 0.18), rand));
        }
        drawFoliage(g, lumps, pal, rand, { cx: tx, cy: ccy, R: S.rx * 1.3, RY: S.ry, marks: 1.4, lfBias: -0.1 });
      }, OW * 0.95);
    }
    // main canopy: tall teardrop of small clumps
    P.layer((g) => {
      const lumps = [];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand() * 0.4;
        const sy = Math.sin(a);
        const wk = sy < 0 ? 0.78 + 0.22 * (1 + sy) : 1; // narrower toward the top
        lumps.push(mkLump(tx + Math.cos(a) * S.rx * 0.6 * wk, ccy + sy * S.ry * 0.62, S.rx * (0.32 + rand() * 0.1), rand, 1.1));
      }
      for (let i = 0; i < 4; i++) lumps.push(mkLump(tx + (rand() - 0.5) * S.rx * 0.5, ccy + (i - 1.6) * S.ry * 0.3, S.rx * (0.36 + rand() * 0.08), rand, 1.1));
      drawFoliage(g, lumps, pal, rand, { cx: tx, cy: ccy, R: S.rx, RY: S.ry, marks: 1.4 });
    });
  });
}

// ---------------- DEAD ----------------
function deadTree(v) {
  const rand = rng(4000 + v * 37);
  return sprite(2.3, 3.0, (g, P) => {
    const W = P.W, H = P.H;
    const cx = W / 2, baseY = H - 9;
    const segs = [];
    const grow = (x, y, a, len, w, d) => {
      const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
      const bend = (rand() - 0.5) * len * 0.35;
      const mx = (x + x1) / 2 + Math.cos(a + Math.PI / 2) * bend, my = (y + y1) / 2 + Math.sin(a + Math.PI / 2) * bend;
      segs.push([x, y, mx, my, x1, y1, w, w * 0.62]);
      if (d <= 0 || w < 2) return;
      const nb = d > 2 ? 2 : 1 + (rand() < 0.6 ? 1 : 0);
      for (let i = 0; i < nb; i++) {
        const da = (i === 0 ? -1 : 1) * (0.3 + rand() * 0.35) + (rand() - 0.5) * 0.2;
        grow(x1, y1, a + da, len * (0.62 + rand() * 0.15), w * 0.62, d - 1);
      }
      if (rand() < 0.4) grow(x1, y1, a + (rand() - 0.5) * 0.3, len * 0.5, w * 0.5, d - 2);
    };
    grow(cx, baseY + 1, -Math.PI / 2 + (rand() - 0.5) * 0.2, 56, 15, 4);
    // fit inside the canvas
    let k = 1;
    for (const sg of segs) for (const [x, y] of [[sg[2], sg[3]], [sg[4], sg[5]]]) {
      if (Math.abs(x - cx) > W / 2 - 9) k = Math.min(k, (W / 2 - 9) / Math.abs(x - cx));
      if (baseY - y > baseY - 9) k = Math.min(k, (baseY - 9) / (baseY - y));
    }
    for (const sg of segs) for (let i = 0; i < 6; i += 2) { sg[i] = cx + (sg[i] - cx) * k; sg[i + 1] = baseY + (sg[i + 1] - baseY) * k; }
    P.layer((g) => {
      g.fillStyle = '#5c5045';
      for (const s of segs) { g.beginPath(); taper(g, ...s); g.fill(); }
      g.beginPath(); g.ellipse(cx, baseY - 1, 13, 4, 0, 0, TAU); g.fill();
      // lit left edges
      g.fillStyle = '#7d6e5d';
      for (const s of segs) { g.beginPath(); taper(g, s[0] - s[6] * 0.18, s[1], s[2] - s[6] * 0.18, s[3], s[4] - s[7] * 0.15, s[5], s[6] * 0.45, s[7] * 0.4); g.fill(); }
      // cracks
      g.strokeStyle = 'rgba(40,32,24,0.7)'; g.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const x = cx + (rand() - 0.5) * 8, y = baseY - 8 - rand() * 40;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - 10 - rand() * 12); g.stroke();
      }
      // knot hole
      g.fillStyle = '#2b2219';
      g.beginPath(); g.ellipse(cx + 2, baseY - 30, 2.5, 4, 0, 0, TAU); g.fill();
    });
  });
}

// ---------------- STUMP / SAPLING ----------------
function stump(v) {
  const rand = rng(5000 + v);
  return sprite(0.8, 0.7, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 7;
    P.layer((g) => {
      // roots
      g.fillStyle = BARK.mid;
      for (const s of [-1, 1]) { g.beginPath(); taper(g, cx + s * 8, baseY - 6, cx + s * 14, baseY - 2, cx + s * 20, baseY + 1, 7, 2); g.fill(); }
      // side
      const top = baseY - 20;
      g.beginPath();
      g.moveTo(cx - 14, top); g.lineTo(cx - 15, baseY - 3); g.quadraticCurveTo(cx, baseY + 4, cx + 15, baseY - 3); g.lineTo(cx + 14, top); g.closePath();
      g.fillStyle = lin(g, cx - 15, 0, cx + 15, 0, [[0, BARK.light], [0.5, BARK.mid], [1, BARK.deep]]); g.fill();
      g.strokeStyle = 'rgba(30,20,12,0.55)'; g.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) { const x = cx - 11 + i * 5.5 + rand() * 2; g.beginPath(); g.moveTo(x, top + 4); g.lineTo(x + (rand() - 0.5) * 2, baseY - 2); g.stroke(); }
      // top
      g.beginPath(); g.ellipse(cx, top, 14.5, 6.5, 0, 0, TAU);
      g.fillStyle = '#c9a26a'; g.fill();
      g.strokeStyle = '#8f6a3e'; g.lineWidth = 1.6; g.stroke();
      g.strokeStyle = 'rgba(140,100,58,0.8)'; g.lineWidth = 1;
      for (const k of [0.68, 0.42, 0.18]) { g.beginPath(); g.ellipse(cx + 0.5, top + 0.3, 14.5 * k, 6.5 * k, 0, 0, TAU); g.stroke(); }
      g.strokeStyle = 'rgba(90,60,30,0.8)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx + 1, top); g.lineTo(cx + 9, top + 2.5); g.stroke();
    });
  });
}

function sapling(v) {
  return sprite(0.6, 0.9, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 5;
    P.layer((g) => {
      g.fillStyle = BARK.mid;
      g.beginPath(); taper(g, cx, baseY, cx - 2, baseY - 20, cx + 1, baseY - 36, 3.2, 1.6); g.fill();
      const pal = OAK_PALS[1];
      const L = [[-9, -34, -0.5], [8, -30, 0.6], [-6, -22, -0.9], [7, -18, 0.9], [0, -42, 0]];
      for (const [dx, dy, a] of L) {
        const x0 = cx + dx * 0.15, y0 = baseY + dy + 6;
        const x1 = cx + dx + Math.sin(a) * 4, y1 = baseY + dy - 3;
        g.fillStyle = dx < 0 ? pal.light : pal.mid;
        g.beginPath(); leaf(g, x0, y0, x1, y1, 4.8, 0); g.fill();
        g.strokeStyle = pal.dark; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo((x0 + x1) / 2, (y0 + y1) / 2); g.stroke();
      }
    }, 2.4);
  });
}

export function addTrees(add) {
  const put = (name, c, foot) => add(name, c, 0.5, 1 - foot / (c.origH || c.height));
  for (let i = 0; i < 5; i++) put('tree_oak_' + i, oak(i), 9);
  for (let i = 0; i < 4; i++) put('tree_pine_' + i, pine(i), 9);
  for (let i = 0; i < 3; i++) put('tree_birch_' + i, birch(i), 9);
  for (let i = 0; i < 2; i++) put('tree_dead_' + i, deadTree(i), 9);
  put('tree_stump_0', stump(0), 7);
  put('tree_sapling_0', sapling(0), 5);
}

export { OAK_PALS, BARK };
