// Trees (3/4 view, trunk at the bottom, canopy above). Sizes in tiles; anchor = trunk base.

import { sprite, rng, OW, TAU, lin, rad, atop, fill, taper, leaf, ramp, rgb, hex, smoothClosed, blobPts, circle } from './paint.js';
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
      // exposed roots spreading into the ground
      for (const s of [-1, 1]) {
        g.fillStyle = BARK.mid;
        g.beginPath(); taper(g, cx + s * 9, baseY - 5, cx + s * 17, baseY - 1, cx + s * (24 + rand() * 4), baseY + 2, 6, 1.6); g.fill();
        g.fillStyle = 'rgba(255,230,190,0.22)';
        g.beginPath(); taper(g, cx + s * 9, baseY - 6, cx + s * 16, baseY - 2.5, cx + s * 22, baseY, 2, 0.6); g.fill();
      }
      g.fillStyle = BARK.dark; g.beginPath(); taper(g, cx + 3, baseY - 3, cx + 6, baseY + 1, cx + 9, baseY + 3.5, 4.5, 1.2); g.fill();
      // moss on the shaded foot of the trunk + a knot hole on some trees
      g.save(); g.beginPath(); trunkPath(g, cx, baseY, ty + 2, 28, 17, lean, rand); g.clip();
      for (let i = 0; i < 10; i++) {
        g.fillStyle = i & 1 ? 'rgba(98,122,52,0.75)' : 'rgba(122,146,64,0.65)';
        g.beginPath(); g.ellipse(cx + 4 + rand() * 12, baseY - 3 - rand() * 14, 2 + rand() * 2.4, 1.4 + rand() * 1.4, 0, 0, TAU); g.fill();
      }
      if (v % 2 === 0) {
        const kx = cx - 3 + lean * 0.4, ky = baseY - 26 - rand() * 8;
        g.fillStyle = '#2a1c12'; g.beginPath(); g.ellipse(kx, ky, 3, 4.4, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(160,120,80,0.6)'; g.lineWidth = 1; g.beginPath(); g.ellipse(kx, ky, 4.4, 5.8, 0, 0, TAU); g.stroke();
      }
      g.restore();
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
    P.layer((g) => drawFoliage(g, all, pal, rand, { cx: ccx, cy: ccy, R: S.rx, RY: S.ry, marks: 1.1, sprigs: 1.3 }));
  });
  return canvas;
}

// ---------------- PINE ----------------
// Layered conifer: a stack of drooping boughs. Each bough is an umbrella-like skirt (convex lit upper
// surface that curves down into drooping tips) with a lobed needle fringe (branch ends), branch ridges
// radiating from the trunk, herringbone needle strokes and fresh light tips. Upper boughs overlap and shade
// the ones below; between boughs the silhouette notches in, so the layers read clearly at any zoom.
const PINE_PALS = [
  { deep: '#0e1f18', dark: '#183428', mid: '#254b37', light: '#38664a', high: '#578a62', tip: '#8fb071' },
  { deep: '#0f201d', dark: '#19362e', mid: '#264d3f', light: '#386954', high: '#55886e', tip: '#88ad80' },
  { deep: '#112015', dark: '#1d3622', mid: '#2c4e31', light: '#416a41', high: '#608b55', tip: '#9cb26c' },
  { deep: '#0d1e1c', dark: '#16342f', mid: '#234b40', light: '#336655', high: '#4f8571', tip: '#82aa86' },
  { deep: '#112017', dark: '#1c3628', mid: '#2a4e39', light: '#3c684b', high: '#5a8862', tip: '#96b072' },
];
const PINE_BARK = { deep: '#2a1812', dark: '#43271a', mid: '#613a26', light: '#7f5236', high: '#9a6a48' };
// W,H tiles · n boughs · w0 widest half-width (px) · top (apex y) · trunk (visible px) · ov (bough height / spacing)
const PINE_SHAPES = [
  { W: 2.4, H: 3.9, n: 6, w0: 62, top: 7, trunk: 22, ov: 1.85, lean: 0 },     // full, classic
  { W: 2.0, H: 3.9, n: 7, w0: 46, top: 5, trunk: 20, ov: 1.9, lean: 3 },      // tall & narrow
  { W: 2.8, H: 3.5, n: 5, w0: 78, top: 9, trunk: 20, ov: 1.8, lean: -2 },     // broad & bushy
  { W: 1.7, H: 2.5, n: 4, w0: 40, top: 6, trunk: 16, ov: 1.8, lean: 1 },      // young
  { W: 2.3, H: 4.1, n: 5, w0: 56, top: 5, trunk: 46, ov: 1.85, lean: -2 },    // old, high crown
];

// bough outline: upper edge (tip → apex → tip) then a lobed, needle-spiked fringe back to the first tip.
// returns { pts, fr (index where the fringe starts) }
function boughPts(x, top, wl, wr, H, droop, fingers, rand, ex = 1.8) {
  const pts = [];
  const yl = top + H * 0.62 + droop * (0.7 + rand() * 0.6), yr = top + H * 0.62 + droop * (0.7 + rand() * 0.6);
  const NT = 6;
  const edge = (side, w, yt, t) => [x + side * w * t + (rand() - 0.5) * 1.6, top + (yt - top) * Math.pow(t, ex) - (1 - t) * t * H * 0.08 + (rand() - 0.5) * 1.6];
  // drooping sprig sticking out of the left tip
  const sl = 3 + rand() * 7;
  pts.push([x - wl - sl, yl + sl * 0.7 + 2]);
  for (let i = NT; i >= 1; i--) pts.push(edge(-1, wl, yl, i / NT));
  pts.push([x, top]);
  for (let i = 1; i <= NT; i++) pts.push(edge(1, wr, yr, i / NT));
  const sr = 3 + rand() * 7;
  pts.push([x + wr + sr, yr + sr * 0.7 + 2]);
  const fr = pts.length;
  // irregular finger partition along the fringe
  const fb = [0];
  for (let j = 0; j < fingers; j++) fb.push(fb[j] + 0.6 + rand() * 0.8);
  for (let j = 1; j <= fingers; j++) fb[j] /= fb[fingers];
  const amp = []; for (let j = 0; j < fingers; j++) amp.push(0.6 + rand() * 0.7);
  const M = fingers * 4;
  const lobe = H * 0.2;
  let j = 0;
  for (let i = 1; i < M; i++) {
    const u = 1 - (2 * i) / M; // +1 (right tip) → -1 (left tip)
    const w = u > 0 ? wr : wl, au = Math.abs(u);
    const base = top + H * (0.62 + 0.38 * (1 - u * u)) + droop * au * au * au;
    const t = (1 - u) / 2;
    while (j < fingers - 1 && t > fb[j + 1]) j++;
    const f0 = (t - fb[j]) / (fb[j + 1] - fb[j]);
    const bulge = Math.pow(Math.sin(Math.min(1, Math.max(0, f0)) * Math.PI), 0.7) * lobe * amp[j];
    const spike = i & 1 ? 1.4 + rand() * 2.8 + (rand() < 0.12 ? 3 : 0) : 0;
    pts.push([x + u * w * (0.97 + bulge / lobe * 0.05) + (rand() - 0.5) * 1.4, base - lobe * 0.55 + bulge + spike]);
  }
  return { pts, fr, yl, yr };
}

function polyPath(g, pts) { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }

function pine(v) {
  const rand = rng(2000 + v * 131);
  const S = PINE_SHAPES[v % PINE_SHAPES.length];
  const pal = PINE_PALS[v % PINE_PALS.length];
  const stops = [pal.deep, pal.dark, pal.mid, pal.light, pal.high];
  const deep = hex(pal.deep);
  return sprite(S.W, S.H, (g, P) => {
    const W = P.W, H = P.H;
    const cx = W / 2, baseY = H - 9;
    const lowest = baseY - S.trunk;
    const lean = S.lean;
    // fallen needles around the base
    P.layer((g) => {
      g.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const a = rand() * TAU, r = 9 + rand() * 13;
        const x = cx + Math.cos(a) * r, y = baseY + 1 + Math.sin(a) * r * 0.25;
        g.strokeStyle = rand() < 0.5 ? 'rgba(120,84,46,0.8)' : 'rgba(156,116,64,0.7)';
        const b = rand() * TAU;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * 3, y + Math.sin(b) * 1.2); g.stroke();
      }
    }, 0);
    // ---- trunk ----
    const tw = S.trunk > 30 ? 15 : 13;
    P.layer((g) => {
      drawTrunk(g, cx, baseY, S.top + 20, tw, 5, lean * 0.4, rand, PINE_BARK, lowest + 4);
      g.save(); g.beginPath(); trunkPath(g, cx, baseY, S.top + 20, tw, 5, lean * 0.4, rand); g.clip();
      for (let i = 0; i < 10; i++) { // scaly reddish bark plates
        const y = lowest + 4 + rand() * (baseY - lowest - 6), x = cx - 5 + rand() * 8;
        g.fillStyle = rgb(hex(rand() < 0.5 ? PINE_BARK.high : PINE_BARK.light), 0.5);
        g.beginPath(); g.ellipse(x, y, 1.5 + rand() * 1.5, 2.4 + rand() * 2, (rand() - 0.5) * 0.4, 0, TAU); g.fill();
      }
      g.restore();
      if (S.trunk > 30) { // dead stub branches on old trees
        g.fillStyle = PINE_BARK.mid;
        g.beginPath(); taper(g, cx + 2, lowest + 14, cx + 9, lowest + 9, cx + 15, lowest + 10, 3.4, 1.3); g.fill();
        g.beginPath(); taper(g, cx - 2, lowest + 4, cx - 8, lowest, cx - 13, lowest - 1, 3, 1.2); g.fill();
      }
    });
    // ---- canopy ----
    P.layer((g) => {
      const n = S.n;
      const spacing = (lowest - S.top) / (n - 1 + S.ov);
      const Rx = S.w0, yMid = (S.top + lowest) / 2;
      const NBN = 10;
      for (let k = 0; k < n; k++) {
        const f = k / (n - 0.55);
        const Hb = spacing * S.ov * (k === n - 1 ? 1.2 : 1) * (0.94 + rand() * 0.12);
        const bot = lowest + 3 - spacing * k;
        const top = bot - Hb;
        const w = Math.max(7, S.w0 * Math.pow(1 - f * 0.94, 0.95) * (k ? 0.88 + rand() * 0.24 : 1));
        const asym = (rand() - 0.5) * 0.3;
        const wl = w * (1 + asym), wr = w * (1 - asym);
        const x = cx + lean * f * 2.5 + (k ? (rand() - 0.5) * 3 : 0);
        const fingers = Math.max(2, Math.round(w / 9));
        const B = boughPts(x, top, wl, wr, Hb, Hb * 0.18, fingers, rand, 1.85 - 0.85 * f);
        const path = new Path2D(); polyPath(path, B.pts);
        // shadow onto the boughs below
        if (k > 0) atop(g, () => { g.translate(2, 6); g.fillStyle = rgb(deep, 0.7); g.fill(path); });
        // body: lit upper surface → dark hanging fringe
        g.fillStyle = lin(g, 0, top, 0, bot + 2, [[0, ramp(stops, 0.62)], [0.42, ramp(stops, 0.42)], [0.75, ramp(stops, 0.24)], [1, ramp(stops, 0.1)]]);
        g.fill(path);
        g.save(); g.clip(path);
        // light from the left, shade on the right
        g.fillStyle = lin(g, x - wl, 0, x + wr, 0, [[0, 'rgba(225,255,200,0.16)'], [0.45, 'rgba(0,0,0,0)'], [1, rgb(deep, 0.42)]]);
        g.fillRect(x - wl - 6, top - 4, wl + wr + 12, Hb + 12);
        // shade right under the trunk/ next bough
        g.fillStyle = rad(g, x, top + 2, 0, Math.min(w, Hb) * 0.75, [[0, rgb(deep, 0.6)], [1, 'rgba(0,0,0,0)']]);
        g.fillRect(x - w, top - 4, w * 2, Hb);
        // rays from the trunk toward the fringe: needle strokes + branch ridges
        const lit = [], dark = [];
        for (let i = 0; i < NBN; i++) { lit.push(null); dark.push(null); }
        const ridges = new Path2D(), tips = new Path2D();
        const fp = B.pts;
        for (let i = B.fr - 3; i < fp.length + 2; i++) {
          const F = fp[(i + fp.length) % fp.length];
          const dx = F[0] - x, dy = F[1] - top;
          const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
          const cnt = Math.round(L / 6);
          for (let j = 0; j < cnt; j++) {
            const s = 0.12 + 0.84 * rand();
            const px = x + dx * s + (rand() - 0.5) * 3, py = top + dy * s * (0.92 + rand() * 0.1);
            const lf = clamp01(0.55 - (px - cx) / Rx * 0.32 + (0.5 - s) * 0.55 + (rand() - 0.5) * 0.15);
            const ln = 3 + rand() * 3;
            for (const side of [-1, 1]) {
              const tone = clamp01(lf + (side < 0 ? 0.12 : -0.14));
              const b = Math.round(tone * (NBN - 1));
              const arr = side < 0 ? lit : dark;
              const p2 = arr[b] || (arr[b] = new Path2D());
              p2.moveTo(px, py); p2.lineTo(px + (ux - uy * side * 0.9) * ln, py + (uy + ux * side * 0.9) * ln * 0.8 + ln * 0.35);
            }
          }
          if ((i - B.fr) % 4 === 0 && F[0] < x + wr * 0.5) {
            ridges.moveTo(x + dx * 0.08, top + dy * 0.08);
            ridges.quadraticCurveTo(x + dx * 0.5, top + dy * 0.38, x + dx * 0.86, top + dy * 0.86);
          }
          if ((i & 3) === 1 && F[0] < x + wr * 0.7) {
            for (let j = 0; j < 2; j++) {
              const a = Math.atan2(dy, dx) + (rand() - 0.5) * 1.1;
              const px = x + dx * (0.8 + rand() * 0.12), py = top + dy * (0.78 + rand() * 0.12);
              tips.moveTo(px, py); tips.lineTo(px + Math.cos(a) * 4, py + Math.sin(a) * 4);
            }
          }
        }
        g.lineWidth = 1.0;
        for (let b = 0; b < NBN; b++) {
          if (dark[b]) { g.strokeStyle = ramp(stops, b / (NBN - 1), 0.6); g.stroke(dark[b]); }
          if (lit[b]) { g.strokeStyle = ramp(stops, b / (NBN - 1), 0.7); g.stroke(lit[b]); }
        }
        g.lineWidth = 1.5; g.strokeStyle = ramp(stops, 0.85, 0.35); g.stroke(ridges);
        g.lineWidth = 1.25; g.strokeStyle = rgb(hex(pal.tip), 0.7); g.stroke(tips);
        // dark needle fringe along the lower edge
        g.lineWidth = 2.4; g.strokeStyle = rgb(deep, 0.55);
        g.beginPath();
        for (let i = B.fr; i < fp.length; i++) (i === B.fr ? g.moveTo : g.lineTo).call(g, fp[i][0], fp[i][1] - 1.2);
        g.stroke();
        g.restore();
        // lit rim along the upper-left edge
        g.lineWidth = 1.3; g.strokeStyle = ramp(stops, 0.95, 0.55);
        g.beginPath();
        for (let i = 1; i <= 7; i++) (i === 1 ? g.moveTo : g.lineTo).call(g, fp[i][0] + 1, fp[i][1] + 1.4);
        g.stroke();
      }
      // leader (upright tip)
      const lx = cx + lean * 0.9, ly = Math.max(1, S.top - 9);
      g.fillStyle = ramp(stops, 0.5);
      g.beginPath(); taper(g, cx + lean * 0.8, S.top + 9, cx + lean * 0.85, S.top + 1, lx, ly, 4.8, 0.8); g.fill();
      g.strokeStyle = rgb(hex(pal.tip), 0.85); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(lx, ly + 3); g.lineTo(lx - 2.6, ly + 7.5); g.moveTo(lx, ly + 3); g.lineTo(lx + 2.4, ly + 7); g.stroke();
      // global volume: light top-left, deep shade bottom-right & underside
      atop(g, () => {
        const Ry = (lowest - S.top) / 2;
        g.fillStyle = rad(g, cx - Rx * 0.55, S.top + Ry * 0.35, 0, Math.max(Rx, Ry) * 1.5, [
          [0, 'rgba(235,255,215,0.08)'], [0.5, 'rgba(0,0,0,0)'], [1, rgb(deep, 0.4)]]);
        g.fillRect(0, 0, W, H);
        g.fillStyle = lin(g, 0, yMid, 0, lowest + 6, [[0, 'rgba(0,0,0,0)'], [1, rgb(deep, 0.32)]]);
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
        drawFoliage(g, lumps, pal, rand, { cx: tx, cy: ccy, R: S.rx * 1.3, RY: S.ry, marks: 1.4, lfBias: -0.1, sprigs: 1 });
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
      drawFoliage(g, lumps, pal, rand, { cx: tx, cy: ccy, R: S.rx, RY: S.ry, marks: 1.4, sprigs: 1 });
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
      // bracket fungus shelves on the trunk
      for (const [fx, fy, fw] of [[-6, -16, 6], [-7, -21, 4.5], [5, -40, 4]]) {
        g.fillStyle = '#b8935e'; g.beginPath(); g.ellipse(cx + fx, baseY + fy, fw, fw * 0.42, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill();
        g.fillStyle = '#e2c88e'; g.beginPath(); g.ellipse(cx + fx, baseY + fy - fw * 0.12, fw * 0.8, fw * 0.2, 0, Math.PI, TAU); g.fill();
        g.strokeStyle = 'rgba(90,60,30,0.6)'; g.lineWidth = 0.7; g.beginPath(); g.ellipse(cx + fx, baseY + fy, fw * 0.6, fw * 0.25, 0, Math.PI, TAU); g.stroke();
      }
      // peeling bark patches
      g.fillStyle = 'rgba(150,130,108,0.7)';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(cx - 3 + rand() * 6, baseY - 10 - rand() * 40, 1.2, 3 + rand() * 2, 0, 0, TAU); g.fill(); }
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
      // bark rim, moss on the shaded side, a little cluster of mushrooms
      g.strokeStyle = BARK.dark; g.lineWidth = 1.6; g.beginPath(); g.ellipse(cx, top, 14.5, 6.5, 0, 0.1, Math.PI - 0.1); g.stroke();
      for (let i = 0; i < 7; i++) { g.fillStyle = i & 1 ? 'rgba(98,122,52,0.85)' : 'rgba(126,150,66,0.8)'; g.beginPath(); g.ellipse(cx + 6 + rand() * 8, baseY - 4 - rand() * 12, 1.8 + rand() * 2, 1.3 + rand(), 0, 0, TAU); g.fill(); }
      for (const [mx, mh, mr] of [[-12, 5, 3], [-8, 3.5, 2.2]]) {
        g.fillStyle = '#efe6d2'; g.fillRect(cx + mx - 0.7, baseY - mh, 1.4, mh);
        g.fillStyle = '#b07a4a'; g.beginPath(); g.ellipse(cx + mx, baseY - mh, mr, mr * 0.6, 0, Math.PI, TAU); g.fill();
        g.fillStyle = 'rgba(255,240,220,0.5)'; g.beginPath(); g.ellipse(cx + mx - mr * 0.3, baseY - mh - mr * 0.3, mr * 0.35, mr * 0.2, 0, 0, TAU); g.fill();
      }
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
      const L = [[-9, -34, -0.5], [8, -30, 0.6], [-6, -22, -0.9], [7, -18, 0.9], [0, -42, 0], [-11, -26, -1.1], [10, -38, 0.4], [3, -14, 1.1], [-4, -40, -0.2]];
      g.fillStyle = BARK.mid; g.beginPath(); taper(g, cx - 1, baseY - 20, cx - 5, baseY - 24, cx - 9, baseY - 28, 1.8, 0.8); g.fill();
      g.beginPath(); taper(g, cx, baseY - 26, cx + 5, baseY - 30, cx + 8, baseY - 33, 1.6, 0.8); g.fill();
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

// =====================================================================================================
// Species (art groups inside the gameplay tree types; composeWorld picks the group from o.v >> 4):
//   tree_oak → oak · maple (autumn) · willow   tree_pine → conifer · scots pine · juniper
//   tree_birch → birch · aspen                  tree_dead → dead · snag
export const TREE_SPECIES = {
  tree_oak: ['tree_oak', 'tree_maple', 'tree_willow'],
  tree_pine: ['tree_pine', 'tree_scots', 'tree_juniper'],
  tree_birch: ['tree_birch', 'tree_aspen'],
  tree_dead: ['tree_dead', 'tree_snag'],
};

// a few fallen leaves / needles painted at the foot of a tree (sprite layer 0, under the trunk)
function footLitter(g, cx, baseY, cols, n, rand, rx = 22, needles = false) {
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU, r = 6 + rand() * rx;
    const x = cx + Math.cos(a) * r, y = baseY + 1 + Math.sin(a) * r * 0.28;
    g.fillStyle = cols[Math.floor(rand() * cols.length)];
    if (needles) { g.strokeStyle = g.fillStyle; g.lineWidth = 1; const b = rand() * TAU; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * 3, y + Math.sin(b) * 1.2); g.stroke(); }
    else { g.beginPath(); g.ellipse(x, y, 1.8 + rand() * 1.2, 1 + rand() * 0.6, rand() * TAU, 0, TAU); g.fill(); }
  }
}

// ---------------- MAPLE (autumn) ----------------
const MAPLE_PALS = [
  { deep: '#4f2410', dark: '#83361a', mid: '#b9531f', light: '#dd7a2c', high: '#f3a64a' },   // orange
  { deep: '#45130f', dark: '#771c16', mid: '#a62e1f', light: '#cb4a2b', high: '#e87a4c' },   // red
  { deep: '#4f3c12', dark: '#836116', mid: '#b5891f', light: '#d9ad33', high: '#f0cd5c' },   // golden
];
const MAPLE_BARK = { deep: '#2c241e', dark: '#463a30', mid: '#625345', light: '#80705f', high: '#9a8a78' };
function maple(v) {
  const rand = rng(6100 + v * 89);
  const S = [{ W: 2.5, rx: 62, ry: 58, trunk: 44, ox: 0 }, { W: 2.4, rx: 58, ry: 62, trunk: 46, ox: -5 }, { W: 2.6, rx: 66, ry: 56, trunk: 42, ox: 4 }][v % 3];
  const pal = MAPLE_PALS[v % MAPLE_PALS.length];
  const Hpx = 12 + S.ry * 2 + S.trunk + 9;
  return sprite(S.W, Hpx / 64, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 9, ccy = 12 + S.ry, ccx = cx + S.ox;
    const lean = S.ox * 0.7 + (rand() - 0.5) * 3;
    P.layer((g) => footLitter(g, cx, baseY, [pal.mid, pal.light, pal.dark, pal.high], 26, rand, 26), 0);
    P.layer((g) => {
      const tx = cx + lean, ty = ccy + S.ry * 0.3;
      g.fillStyle = MAPLE_BARK.mid;
      for (const side of [-1, 1]) { g.beginPath(); taper(g, tx, ty + 16, tx + side * 12, ty, tx + side * (26 + rand() * 6), ty - 22, 9, 4); g.fill(); }
      g.beginPath(); taper(g, tx, ty + 10, tx + 2, ty - 6, tx + (rand() - 0.5) * 8, ty - 30, 8, 3.5); g.fill();
      drawTrunk(g, cx, baseY, ty + 2, 24, 14, lean, rand, MAPLE_BARK, ccy + S.ry);
      for (const s of [-1, 1]) { g.fillStyle = MAPLE_BARK.mid; g.beginPath(); taper(g, cx + s * 8, baseY - 4, cx + s * 14, baseY - 1, cx + s * 20, baseY + 2, 5, 1.4); g.fill(); }
    });
    const all = [];
    const n = 7, a0 = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + (rand() - 0.5) * 0.5, k = 0.52 + rand() * 0.12;
      all.push(mkLump(ccx + Math.cos(a) * S.rx * k, ccy + Math.sin(a) * S.ry * k * 0.9, Math.min(S.rx, S.ry) * (0.38 + rand() * 0.1), rand, 0.85));
    }
    for (let i = 0; i < 3; i++) { const a = rand() * TAU, d = 0.1 + rand() * 0.2; all.push(mkLump(ccx + Math.cos(a) * S.rx * d, ccy + Math.sin(a) * S.ry * d - S.ry * 0.14, Math.min(S.rx, S.ry) * (0.4 + rand() * 0.08), rand, 0.85)); }
    P.layer((g) => {
      drawFoliage(g, all, pal, rand, { cx: ccx, cy: ccy, R: S.rx, RY: S.ry, marks: 1.35, sprigs: 1.6 });
      // a few bare twigs showing through the thinning crown
      g.strokeStyle = MAPLE_BARK.dark; g.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) { const a = Math.PI * (1.15 + rand() * 0.7), r0 = S.rx * 0.55; const x0 = ccx + Math.cos(a) * r0, y0 = ccy + Math.sin(a) * r0 * 0.9; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * 9, y0 + Math.sin(a) * 9); g.stroke(); }
    });
  });
}

// ---------------- WILLOW (weeping, by the water) ----------------
const WILLOW_PAL = [
  { deep: '#2f4219', dark: '#45602a', mid: '#628236', light: '#83a447', high: '#a8c563' },
  { deep: '#32461c', dark: '#4a652c', mid: '#678838', light: '#8aaa4a', high: '#b0c968' },
];
function willow(v) {
  const rand = rng(6400 + v * 97);
  const pal = WILLOW_PAL[v % WILLOW_PAL.length];
  const stops = [pal.deep, pal.dark, pal.mid, pal.light, pal.high];
  const Wt = v ? 2.9 : 3.15, Ht = v ? 3.3 : 3.5;
  return sprite(Wt, Ht, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 9;
    const lean = v ? -6 : 7;
    const ccx = cx + lean * 1.2, ccy = 52, R = W * 0.4, RY = 34;
    P.layer((g) => footLitter(g, cx, baseY, [pal.mid, pal.light, '#8c8a46'], 22, rand, 34), 0);
    // trunk: short, thick, leaning, splitting into arching limbs that carry the curtains
    const limbs = [];
    P.layer((g) => {
      drawTrunk(g, cx, baseY, ccy + 40, 30, 18, lean, rand, BARK, ccy + 70);
      g.fillStyle = BARK.mid;
      for (const [s, k] of [[-1, 1], [1, 1], [-1, 0.55], [1, 0.6]]) {
        const x0 = cx + lean, y0 = ccy + 46, x1 = ccx + s * R * 0.78 * k, y1 = ccy + 4 - k * 8;
        limbs.push([x1, y1]);
        g.beginPath(); taper(g, x0, y0, (x0 + x1) / 2 + s * 4, y1 - 6, x1, y1, 10 * k + 3, 3); g.fill();
      }
    });
    // a hanging strand: out from its origin, arching, then falling with a little sway; narrow leaves along it
    const strand = (g, x0, y0, len, dir, t) => {
      const out = dir * (6 + rand() * 8), x1 = x0 + out + (rand() - 0.5) * 6, y1 = Math.min(baseY - 3, y0 + len);
      g.strokeStyle = ramp(stops, t - 0.2); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + out * 1.2, y0 + 6, x1, y1); g.stroke();
      const m = Math.round((y1 - y0) / 3.6);
      for (let k = 1; k <= m; k++) {
        const tt = k / m, u = 1 - tt;
        const px = u * u * x0 + 2 * u * tt * (x0 + out * 1.2) + tt * tt * x1, py = u * u * y0 + 2 * u * tt * (y0 + 6) + tt * tt * y1;
        g.fillStyle = ramp(stops, t + (rand() - 0.5) * 0.22 + (k & 1 ? 0.07 : -0.05) - tt * 0.08);
        const s = k & 1 ? 1 : -1, wl = 1.5 - tt * 0.5;
        g.beginPath(); leaf(g, px, py, px + s * (1.6 + rand() * 1.6), py + 4.2 + rand() * 2, wl, 0); g.fill();
      }
    };
    // back curtains (darker, behind the crown)
    P.layer((g) => {
      for (let i = 0; i < 30; i++) {
        const a = Math.PI * (1.0 + rand() * 1.0), d = 0.55 + rand() * 0.45;
        const x0 = ccx + Math.cos(a) * R * d, y0 = ccy + Math.sin(a) * RY * d * 0.8;
        strand(g, x0, y0, 60 + rand() * 60 - Math.abs(Math.cos(a)) * 10, Math.sign(Math.cos(a)) || 1, 0.22 + rand() * 0.14);
      }
    }, OW * 0.55);
    // crown: an irregular, lumpy wide dome (several sub-domes on the limbs)
    P.layer((g) => {
      const lumps = [];
      for (const [lx, ly] of limbs) for (let i = 0; i < 3; i++) lumps.push(mkLump(lx + (rand() - 0.5) * 16, ly - 4 + (rand() - 0.5) * 10, R * (0.26 + rand() * 0.08), rand, 0.75));
      for (let i = 0; i < 3; i++) lumps.push(mkLump(ccx + (i - 1) * R * 0.35 + (rand() - 0.5) * 6, ccy - RY * 0.55 + rand() * 6, R * (0.3 + rand() * 0.06), rand, 0.75));
      drawFoliage(g, lumps, pal, rand, { cx: ccx, cy: ccy - 6, R, RY, marks: 1.4, sprigs: 2.2, drop: 0.4 });
    });
    // front curtains: cascade over the lower crown, ragged hem, lit on the left
    P.layer((g) => {
      for (let i = 0; i < 34; i++) {
        const u = rand() * 2 - 1;
        const x0 = ccx + u * R * 0.92, y0 = ccy - RY * 0.35 + (1 - u * u) * RY * 0.5 + rand() * 10;
        const len = 52 + rand() * 54 - Math.abs(u) * 14;
        strand(g, x0, y0, len, u < 0 ? -1 : 1, 0.5 + 0.3 * (1 - (u + 1) / 2) + rand() * 0.08);
      }
    }, OW * 0.5);
  });
}

// ---------------- SCOTS PINE (tall bare trunk, umbrella clumps) ----------------
const SCOTS_PAL = [
  { deep: '#16281d', dark: '#24402c', mid: '#355b3c', light: '#4c7a4c', high: '#6e9a62' },
  { deep: '#182a1c', dark: '#27432b', mid: '#3a5f3a', light: '#527e48', high: '#76a05e' },
];
const SCOTS_BARK = { deep: '#3a1c10', dark: '#6a3419', mid: '#a25426', light: '#c87a3e', high: '#e0a062' };
function scots(v) {
  const rand = rng(6700 + v * 53);
  const pal = SCOTS_PAL[v % SCOTS_PAL.length];
  const Wt = v ? 2.4 : 2.7, Ht = v ? 3.8 : 3.6;
  return sprite(Wt, Ht, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 9;
    const lean = v ? -7 : 6;
    const topY = 22;
    P.layer((g) => footLitter(g, cx, baseY, ['rgba(120,84,46,0.85)', 'rgba(156,116,64,0.75)', 'rgba(90,60,34,0.8)'], 22, rand, 16, true), 0);
    // trunk: grey-brown fissured base, glowing orange upper bark, a couple of bare limbs
    P.layer((g) => {
      const bark = { ...SCOTS_BARK };
      drawTrunk(g, cx, baseY, topY + 40, 17, 8, lean, rand, bark, topY + 92);
      g.save(); g.beginPath(); trunkPath(g, cx, baseY, topY + 40, 17, 8, lean, rand); g.clip();
      g.fillStyle = lin(g, 0, baseY - 70, 0, baseY, [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(70,58,48,0.55)'], [1, 'rgba(60,48,40,0.85)']]);
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(240,170,100,0.45)'; g.beginPath(); g.ellipse(cx - 3 + rand() * 4 + lean * 0.5, topY + 50 + rand() * 50, 1.2, 2.6, 0, 0, TAU); g.fill(); }
      g.restore();
      g.fillStyle = SCOTS_BARK.mid;
      const lx = cx + lean * 0.62;
      g.beginPath(); taper(g, lx, topY + 66, lx - 10, topY + 58, lx - 18, topY + 60, 3, 1.2); g.fill();
      for (const [s, dy, len] of [[-1, 40, 36], [1, 30, 40], [-1, 14, 28], [1, 6, 22], [-1, 58, 30], [1, 54, 30]]) {
        const bx = cx + lean * (0.75 + dy * 0.002), by = topY + dy + 14;
        g.beginPath(); taper(g, bx, by + 6, bx + s * len * 0.5, by - 2, bx + s * len, by - 10, 4.5, 1.8); g.fill();
      }
    });
    // umbrella crown: flat-topped clumps, each a cluster of small lumps, light on the upper faces
    P.layer((g) => {
      const clumps = [[-34, 40, 27], [32, 32, 29], [-6, 16, 31], [12, 50, 24], [-40, 70, 18], [38, 64, 19], [-14, 62, 20], [4, 34, 22]];
      const lumps = [];
      for (const [dx, dy, r] of clumps) {
        const kx = cx + lean + dx * (v ? 0.85 : 1), ky = topY + dy;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI + Math.PI + (rand() - 0.5) * 0.3;
          lumps.push(mkLump(kx + Math.cos(a) * r * 0.55, ky + Math.sin(a) * r * 0.25 + 4, r * (0.42 + rand() * 0.1), rand, 0.7));
        }
        lumps.push(mkLump(kx, ky + 2, r * 0.5, rand, 0.7));
      }
      drawFoliage(g, lumps, pal, rand, { cx: cx + lean, cy: topY + 40, R: 56, RY: 42, marks: 0.7, sprigs: 1.8, drop: 0.6 });
      // needle tufts on the lit tops
      g.strokeStyle = rgb(hex(pal.high), 0.7); g.lineWidth = 1;
      g.beginPath();
      for (const [dx, dy, r] of clumps) {
        const kx = cx + lean + dx * (v ? 0.85 : 1), ky = topY + dy - r * 0.15;
        for (let i = 0; i < 7; i++) { const x = kx - r * 0.5 + rand() * r * 0.8, y = ky - rand() * 3; const a = -Math.PI / 2 + (rand() - 0.5) * 1.2; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5); }
      }
      g.stroke();
    });
  });
}

// ---------------- JUNIPER (twisted dry-slope tree, rocky ground) ----------------
const JUN_PAL = { deep: '#1c2e22', dark: '#2c4532', mid: '#3e6044', light: '#567e56', high: '#7aa070' };
function juniper(v) {
  const rand = rng(6900 + v * 61);
  return sprite(v ? 1.8 : 2.0, v ? 2.2 : 2.4, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 9;
    const s = v ? -1 : 1;
    P.layer((g) => {
      // gnarled, twisting trunk with a silver dead limb
      g.fillStyle = lin(g, cx - 10, 0, cx + 10, 0, [[0, '#9a8a74'], [0.5, '#6f5f4c'], [1, '#3e3328']]);
      g.beginPath(); taper(g, cx, baseY + 1, cx + s * 16, baseY - 30, cx - s * 4, baseY - 62, 14, 6, 14); g.fill();
      g.beginPath(); taper(g, cx + s * 6, baseY - 34, cx + s * 22, baseY - 44, cx + s * 30, baseY - 70, 7, 3); g.fill();
      g.fillStyle = '#c9c1b0'; g.beginPath(); taper(g, cx - s * 2, baseY - 46, cx - s * 16, baseY - 56, cx - s * 26, baseY - 52, 4, 1.4); g.fill();
      g.strokeStyle = 'rgba(40,30,20,0.55)'; g.lineWidth = 1;
      for (let i = 0; i < 5; i++) { const y = baseY - 6 - i * 10; g.beginPath(); g.moveTo(cx - 4 + s * i * 2.5, y); g.quadraticCurveTo(cx + s * (2 + i * 3), y - 6, cx + s * (i * 3), y - 12); g.stroke(); }
      g.fillStyle = '#5d4c3a'; g.beginPath(); g.ellipse(cx, baseY - 1, 10, 3.5, 0, 0, TAU); g.fill();
    });
    P.layer((g) => {
      const C = [[-s * 4, 58, 24], [s * 28, 70, 18], [s * 12, 40, 20], [-s * 22, 50, 15], [s * 2, 78, 16]];
      const lumps = [];
      for (const [dx, dy, r] of C) for (let i = 0; i < 4; i++) { const a = rand() * TAU; lumps.push(mkLump(cx + dx + Math.cos(a) * r * 0.45, baseY - dy + Math.sin(a) * r * 0.3, r * (0.55 + rand() * 0.12), rand, 0.75)); }
      drawFoliage(g, lumps, JUN_PAL, rand, { cx, cy: baseY - 60, R: 38, RY: 28, marks: 1.0, sprigs: 1.8, drop: 0.5 });
      // dusty blue berries
      for (let i = 0; i < 6; i++) {
        const [dx, dy, r] = C[i % C.length];
        const x = cx + dx + (rand() - 0.5) * r * 1.2, y = baseY - dy + (rand() - 0.5) * r * 0.7;
        g.fillStyle = '#2c3d5a'; g.beginPath(); circle(g, x, y, 1.4); g.fill();
        g.fillStyle = '#8aa0c2'; g.beginPath(); circle(g, x - 0.4, y - 0.5, 0.9); g.fill();
      }
    });
  });
}

// ---------------- ASPEN / POPLAR (tall slim crown, pale trunk, by the water) ----------------
const ASPEN_PALS = [
  { deep: '#3c4f1c', dark: '#566f26', mid: '#759130', light: '#97b23e', high: '#bfd15e' },
  { deep: '#4a4e18', dark: '#6a6c20', mid: '#8f8e2a', light: '#b4ae38', high: '#d8cd5a' },  // turning yellow
];
function aspen(v) {
  const rand = rng(7100 + v * 71);
  const pal = ASPEN_PALS[v % ASPEN_PALS.length];
  return sprite(1.5, 3.8, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 9;
    const topY = 10, crownB = H - 64;
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 6, 0, cx + 6, 0, [[0, '#f0eee2'], [0.5, '#d6d2bf'], [1, '#9c9786']]);
      g.beginPath(); taper(g, cx, baseY + 1, cx + 1, (baseY + crownB) / 2, cx + 2, topY + 40, 10, 4, 14); g.fill();
      g.save(); g.beginPath(); taper(g, cx, baseY + 1, cx + 1, (baseY + crownB) / 2, cx + 2, topY + 40, 10, 4, 14); g.clip();
      g.fillStyle = '#3a3630';
      for (let i = 0; i < 9; i++) { const y = baseY - 6 - rand() * 60; g.beginPath(); g.ellipse(cx + (rand() - 0.5) * 5, y, 1.6 + rand() * 1.6, 0.8, 0, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(40,44,30,0.85)'; g.fillRect(0, 0, W, crownB + 8);
      g.restore();
    });
    P.layer((g) => {
      const lumps = [];
      const n = 12;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), y = topY + 14 + t * (crownB - topY - 10);
        const w = 15 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5 + 0.2) * (0.85 + rand() * 0.3);
        lumps.push(mkLump(cx + (i & 1 ? 1 : -1) * w * 0.5 + (rand() - 0.5) * 3, y, 9 + w * 0.45, rand, 0.9));
      }
      drawFoliage(g, lumps, pal, rand, { cx, cy: (topY + crownB) / 2, R: 22, RY: (crownB - topY) / 2, marks: 1.6, sprigs: 1.2, drop: 0.5 });
      // trembling coin-leaves catching light
      g.fillStyle = rgb(hex(pal.high), 0.9);
      for (let i = 0; i < 16; i++) { const y = topY + 16 + rand() * (crownB - topY - 20), x = cx - 12 + rand() * 14; g.beginPath(); g.ellipse(x, y, 1.6, 1.2, rand(), 0, TAU); g.fill(); }
    });
  });
}

// ---------------- SNAG (tall broken dead trunk) ----------------
function snag(v) {
  const rand = rng(7300 + v * 43);
  return sprite(1.4, 2.7, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 9, topY = 30;
    P.layer((g) => {
      const path = (gg) => {
        gg.moveTo(cx - 12, baseY + 1); gg.quadraticCurveTo(cx - 8, baseY - 20, cx - 7, baseY - 50);
        gg.lineTo(cx - 6, topY + 12); gg.lineTo(cx - 3, topY); gg.lineTo(cx, topY + 9); gg.lineTo(cx + 3, topY - 6); gg.lineTo(cx + 5, topY + 14);
        gg.lineTo(cx + 7, baseY - 50); gg.quadraticCurveTo(cx + 8, baseY - 20, cx + 12, baseY + 1); gg.closePath();
      };
      g.fillStyle = lin(g, cx - 10, 0, cx + 10, 0, [[0, '#8f8274'], [0.45, '#6a5d50'], [1, '#3a3129']]);
      g.beginPath(); path(g); g.fill();
      g.save(); g.beginPath(); path(g); g.clip();
      g.strokeStyle = 'rgba(30,24,18,0.6)'; g.lineWidth = 1.1;
      for (let i = 0; i < 6; i++) { const x = cx - 6 + i * 2.4; g.beginPath(); g.moveTo(x, baseY); g.lineTo(x + (rand() - 0.5) * 2, topY + 10 + rand() * 20); g.stroke(); }
      // pale broken wood at the top, moss at the foot
      g.fillStyle = '#c9b08a'; g.beginPath(); g.moveTo(cx - 6, topY + 12); g.lineTo(cx - 3, topY); g.lineTo(cx, topY + 9); g.lineTo(cx + 3, topY - 6); g.lineTo(cx + 5, topY + 14); g.lineTo(cx, topY + 16); g.closePath(); g.fill();
      for (let i = 0; i < 9; i++) { g.fillStyle = i & 1 ? 'rgba(98,122,52,0.85)' : 'rgba(126,150,66,0.8)'; g.beginPath(); g.ellipse(cx + 2 + rand() * 8, baseY - 2 - rand() * 18, 2 + rand() * 2, 1.3 + rand(), 0, 0, TAU); g.fill(); }
      g.restore();
      // woodpecker holes and a stub branch
      g.fillStyle = '#211812';
      for (const [dx, dy] of [[-1, -60], [2, -76], [-2, -38]]) { g.beginPath(); g.ellipse(cx + dx, baseY + dy, 1.8, 2.4, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#5c5045'; g.beginPath(); taper(g, cx + 5, baseY - 66, cx + 12, baseY - 72, cx + 17, baseY - 70, 3.4, 1.2); g.fill();
      for (const [fx, fy, fw] of [[-8, -24, 5], [-8, -29, 3.6]]) {
        g.fillStyle = '#b8935e'; g.beginPath(); g.ellipse(cx + fx, baseY + fy, fw, fw * 0.42, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill();
        g.fillStyle = '#e2c88e'; g.beginPath(); g.ellipse(cx + fx, baseY + fy - fw * 0.12, fw * 0.8, fw * 0.2, 0, Math.PI, TAU); g.fill();
      }
    });
  });
}

export function addTrees(add) {
  const put = (name, c, foot) => add(name, c, 0.5, 1 - foot / (c.origH || c.height));
  for (let i = 0; i < 5; i++) put('tree_oak_' + i, oak(i), 9);
  for (let i = 0; i < PINE_SHAPES.length; i++) put('tree_pine_' + i, pine(i), 9);
  for (let i = 0; i < 3; i++) put('tree_birch_' + i, birch(i), 9);
  for (let i = 0; i < 2; i++) put('tree_dead_' + i, deadTree(i), 9);
  for (let i = 0; i < 3; i++) put('tree_maple_' + i, maple(i), 9);
  for (let i = 0; i < 2; i++) put('tree_willow_' + i, willow(i), 9);
  for (let i = 0; i < 2; i++) put('tree_scots_' + i, scots(i), 9);
  for (let i = 0; i < 2; i++) put('tree_juniper_' + i, juniper(i), 9);
  for (let i = 0; i < 2; i++) put('tree_aspen_' + i, aspen(i), 9);
  put('tree_snag_0', snag(0), 9);
  put('tree_stump_0', stump(0), 7);
  put('tree_sapling_0', sapling(0), 5);
}

export { OAK_PALS, BARK };
