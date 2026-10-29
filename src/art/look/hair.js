// Hair & facial hair painters (agent H). A style is a recipe (catalog.js HAIR[].p): cap (cranium cover),
// fringe / hairline, length of the sides & back, texture and add-ons (buns, tails, braids, crest…). The
// recipe becomes a set of filled sub-shapes per facing; shading and texture are painted 'source-atop' so
// they only land on hair. White/grey art tinted with the hair colour; accent masks (streaks / tips / roots)
// repaint the same hair and keep only the accent area (tinted with the second colour).
//   front: drawn over the face (after the head) · back: long hair behind the body ('s' only)
// Head box geometry from pawns.js (skull ellipse HX, HY, 17.5 × 18).

import { TAU, lin, rad, circle, rng } from '../paint.js';
import { spline } from '../kit.js';
import { HX, HY } from '../pawns.js';

const DARKH = (a) => `rgba(70,70,70,${a})`;
const LITEH = (a) => `rgba(255,255,255,${a})`;
const LEN_Y = [0, 6, 17, 26, 34, 43]; // bottom of the side / back hair per length (relative to HY)

// ---------------- recipe → shapes ----------------
// every shape is fn(g) adding one closed sub-path; shapes are filled one by one (unions never cancel)
const poly = (pts, smooth = false) => (g) => { if (smooth) spline(g, pts, true, 1); else { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); } };
const ell = (x, y, rx, ry, rot = 0) => (g) => { g.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); g.ellipse(x, y, rx, ry, rot, 0, TAU); };
const mx = (pts) => pts.map(([x, y]) => [2 * HX - x, y]);

// front hairline / fringe edge, from the right temple to the left temple ('s'); 'e': front-top → sideburn
const FR_S = {
  line: { pts: [[17.4, 1], [16.2, -6], [11.4, -10.2], [4, -11.4], [-4, -11.4], [-11.4, -10.2], [-16.2, -6], [-17.4, 1]], smooth: 1 },
  back: { pts: [[17.6, 1.6], [16.6, -5], [12, -9.6], [4.4, -11], [-4.4, -11], [-12, -9.6], [-16.6, -5], [-17.6, 1.6]], smooth: 1 },
  short: { pts: [[17.5, 0.5], [15, -7], [9, -9.5], [5, -7], [-1, -10], [-6, -7.5], [-11, -9], [-15.5, -5], [-17.6, 0.5]] },
  part: { pts: [[17.4, 1], [15.8, -6.6], [9.6, -10.4], [3.2, -10.2], [-3.4, -7.8], [-9.4, -5.6], [-14.2, -3.2], [-16.8, -0.4], [-17.6, 1.6]], smooth: 1 },
  swept: { pts: [[17.2, -2], [15.4, -8.6], [9, -11.2], [2.4, -9.6], [-4, -6], [-9.6, -3.4], [-13.6, -2.4], [-16.8, -2.2], [-18.4, 0.8]], smooth: 1 },
  spiky: { pts: [[17.6, 0.6], [16.4, -4.6], [14.2, -7.2], [12.6, -3.6], [10, -8.6], [7.6, -4.4], [4.6, -9.4], [2, -5], [-1, -9.6], [-3.8, -4.6], [-6.8, -9], [-9.4, -4.4], [-12, -8], [-14.4, -3.8], [-16.4, -5.4], [-17.6, 0.6]] },
  messy: { pts: [[18.4, 3.6], [16.8, -1.4], [15, -6.4], [12.4, -3], [10.6, -8], [7, -4.6], [5.4, -9.4], [1.6, -4.2], [-1.6, -8.8], [-4.6, -3.6], [-7.4, -8.4], [-10.4, -3.8], [-12.6, -7], [-15.2, -2], [-16.6, -4.4], [-18.4, 3]] },
  shaggy: { pts: [[19, 6], [16, 2], [15, -5], [9, -4], [6, -9], [1, -5], [-3, -10], [-8, -4.5], [-12, -8], [-15, -2], [-16.5, 3], [-19.5, 7]] },
  pixie: { pts: [[17.4, 1], [14.6, -6.4], [8.4, -9], [2.4, -6.4], [-3.6, -3.4], [-8.6, -2], [-12.4, -0.6], [-14.6, -2.6], [-16.8, -1.6], [-17.8, 1.6]] },
  bangs: { pts: [[17.6, 2], [16.8, -2.4], [14, -2.4], [11.6, -1.8], [9, -2.6], [6, -2], [3, -2.8], [0, -2.2], [-3, -2.8], [-6, -2], [-9, -2.6], [-11.6, -1.8], [-14, -2.4], [-16.8, -2.4], [-17.6, 2]] },
  curtain: { pts: [[17.6, 2.4], [16.2, -2.6], [11.6, -6.6], [5, -10], [0.6, -12.6], [-0.6, -12.6], [-5, -10], [-11.6, -6.6], [-16.2, -2.6], [-17.6, 2.4]], smooth: 1 },
  curls: { pts: [[18.2, 2.4], [17, -3.6], [14.4, -7.4], [10, -9.6], [5, -10.6], [0, -11.2], [-5, -10.6], [-10, -9.6], [-14.4, -7.4], [-17, -3.6], [-18.2, 2.4]], smooth: 1, bumps: 2.1 },
  twists: { pts: [[18, 2], [16.6, -3], [14, -5.2], [10.6, -4], [7.6, -6.4], [4.4, -4.6], [1.4, -6.8], [-1.6, -4.8], [-4.6, -6.6], [-7.6, -4.4], [-10.6, -6.2], [-14, -4.6], [-16.6, -3], [-18, 2]] },
  locs: { pts: [[18.4, 3.6], [16.8, -2.4], [14.6, -1.4], [12.6, -5], [10.4, -1.2], [8, -5.4], [5.6, -1.6], [3, -6], [0.4, -2], [-2.2, -6], [-4.8, -1.8], [-7.4, -5.6], [-9.8, -1.4], [-12.2, -5], [-14.4, -1.6], [-16.8, -2.4], [-18.4, 3.6]] },
  receding: { pts: [[17.2, 1], [15.4, -8], [12, -12.6], [6, -11.4], [0, -13.4], [-6, -11.4], [-12, -12.6], [-15.4, -8], [-17.2, 1]], smooth: 1 },
};
const FR_E = {
  line: [[16.4, -9.6], [10.6, -10], [5.4, -8.6], [2.4, -6.6]],
  back: [[16.4, -10.4], [10.8, -10.8], [5.2, -9.4], [2.4, -7.4]],
  short: [[12.5, -9], [6, -6.5], [2, -7.5]],
  part: [[17.2, -6.2], [14.8, -5], [10.6, -6.6], [6, -6.8], [2.4, -6.6]],
  swept: [[18.6, -4.6], [16, -2.6], [11.6, -3.6], [7, -5.6], [2.4, -6.6]],
  spiky: [[20.6, -10.6], [16.4, -8.6], [17.6, -5.4], [12.6, -6.4], [11.6, -3.4], [7, -5.6], [2.4, -6.6]],
  messy: [[19.4, -7.6], [15.6, -6.4], [16.4, -2.4], [11.6, -4.8], [10.4, -1.6], [6.4, -4.6], [2.4, -6]],
  shaggy: [[14, -6], [9, -6], [7, -2], [3, -6]],
  pixie: [[17.6, -6.6], [16, -2.4], [12.6, -4.2], [8.6, -3.2], [5, -5.4], [2.4, -6.2]],
  bangs: [[17.8, -2], [15.6, -2.4], [12, -2], [8.6, -2.8], [5, -3.6], [2.4, -5.6]],
  curtain: [[17.4, -5.2], [15.2, -3], [11.6, -5.4], [6.4, -7.4], [2.4, -6.6]],
  curls: [[17.6, -6.6], [15, -3], [11, -5], [6.6, -5.6], [2.4, -5.6]],
  twists: [[17.6, -6.4], [15.4, -3.6], [12.6, -5.2], [9.6, -3.4], [6.4, -5.2], [2.4, -5.4]],
  locs: [[18, -6], [16.6, -1.6], [13.6, -4.6], [11.4, -0.8], [8.4, -4.4], [5.6, -1.6], [2.4, -5.4]],
  receding: [[13.6, -13], [9.6, -12.2], [5, -9.6], [2.4, -7.4]],
};

function capS(sh, p, v, ears = (p.len || 0) < 1 && (p.vol || 1) < 1.1) {
  const fr = FR_S[p.fr] || FR_S.line, cy = HY - (v - 1) * 5;
  // short styles leave the ears free (temples tucked just inside the skull edge)
  const a0 = ears ? Math.PI * 1.05 : Math.PI * 0.97, a1 = ears ? Math.PI * 1.95 : Math.PI * 2.03;
  sh.push((g) => {
    g.moveTo(HX + Math.cos(a0) * 19.2 * v, cy + Math.sin(a0) * 19.6 * v);
    g.ellipse(HX, cy, 19.2 * v, 19.6 * v, 0, a0, a1);
    const pts = fr.pts.map(([x, y]) => [HX + x, HY + y]);
    if (ears) { const n = pts.length - 1; pts[0] = [HX + Math.min(16.4, fr.pts[0][0]), HY + Math.min(1.6, fr.pts[0][1] + 0.4)]; pts[n] = [HX + Math.max(-16.4, fr.pts[n][0]), HY + Math.min(1.6, fr.pts[n][1] + 0.4)]; }
    if (fr.smooth) spline(g, pts, false, 1, false); else for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
  });
  if (fr.bumps) for (let i = 1; i < fr.pts.length - 1; i++) { const [x, y] = fr.pts[i]; sh.push(ell(HX + x, HY + y + 0.4, fr.bumps, fr.bumps * 0.9)); }
}
function capN(sh, v, nape) {
  const cy = HY - (v - 1) * 4;
  sh.push((g) => {
    g.moveTo(HX + Math.cos(Math.PI * 0.78) * 19.2 * v, cy + Math.sin(Math.PI * 0.78) * 19.6 * v);
    g.ellipse(HX, cy, 19.2 * v, 19.6 * v, 0, Math.PI * 0.78, Math.PI * 2.22);
    g.quadraticCurveTo(HX + 6, HY + nape + 1.6, HX, HY + nape); g.quadraticCurveTo(HX - 6, HY + nape + 1.6, HX - 15, HY + 12.5);
    g.closePath();
  });
}
function capE(sh, p, v) {
  const fr = FR_E[p.fr] || FR_E.line, cy = HY - (v - 1) * 4.6, cx = HX - (v - 1) * 2;
  sh.push((g) => {
    g.moveTo(cx + Math.cos(Math.PI * 0.72) * 19.2 * v, cy + Math.sin(Math.PI * 0.72) * 19.6 * v);
    g.ellipse(cx, cy, 19.2 * v, 19.6 * v, 0, Math.PI * 0.72, Math.PI * 1.86);
    for (const [x, y] of fr) g.lineTo(HX + x, HY + y);
    g.quadraticCurveTo(HX - 1, HY - 2, HX - 1, HY + 4);
    g.quadraticCurveTo(HX - 6, HY + 8, HX - 7, HY + 14);
    g.closePath();
  });
  if (p.fr === 'curls') for (const [x, y] of fr.slice(0, -1)) sh.push(ell(HX + x, HY + y + 0.4, 2, 1.8));
}

// side / back length shapes
function lengthS(sh, p, v, back) {
  const L = p.len || 0;
  if (L < 1) return;
  const Y = HY + LEN_Y[L], wob = p.tex === 'wavy' || p.tex === 'curly' || p.wild ? 1.6 : 0.8;
  const w = 19.6 * v + (p.round ? 1.6 : 0) + (p.wild ? 3 : 0);
  for (const s of [-1, 1]) {
    if (p.side && s > 0) continue; // asymmetric: long on the left only
    const X = (x) => HX + s * x;
    const inner = L >= 2 ? 15.4 : 16;
    const pts = [[X(17.2), HY - 6], [X(w), HY + 1], [X(w + (L >= 3 ? 1.6 : 0.6) + wob * 0.4), Y - 6], [X(w - 0.6 + wob * 0.6), Y - 1.4]];
    // ragged / curled ends
    const n = L >= 3 ? 4 : 3;
    for (let i = 1; i <= n; i++) { const t = i / n; const x = w - 0.6 - (w - inner + 1.4) * t; pts.push([X(x), Y + (i % 2 ? 1.4 : -1) * (p.round ? 0.2 : 1) - t * (p.round ? 0.6 : 1.6)]); }
    pts.push([X(inner - 0.6), Y - 4], [X(inner), HY + 10], [X(15.6), HY + 1], [X(15.4), HY - 4]);
    sh.push(poly(pts, p.round || p.tex !== 'straight'));
  }
  if (back && L >= 3) return;
}
function backS(sh, p, v) {
  const L = p.len || 0;
  if (L < 3) return;
  const Y = HY + LEN_Y[L] + 2, w = 21 * v + (p.wild ? 3.4 : 0);
  const pts = [[HX - w + 1, HY - 8], [HX - w - 0.6, HY + 6], [HX - w - 0.4, Y - 6]];
  const n = 7;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([HX - w + 1 + (2 * w - 2) * t, Y + (i % 2 ? 1.6 : -0.8) - Math.sin(t * Math.PI) * 1.6]); }
  pts.push([HX + w + 0.4, Y - 6], [HX + w + 0.6, HY + 6], [HX + w - 1, HY - 8], [HX, HY - 18]);
  if (p.side) for (const q of pts) if (q[0] > HX) q[0] = HX + (q[0] - HX) * 0.55;
  sh.push(poly(pts, true));
}
function lengthN(sh, p, v) {
  const L = p.len || 0;
  const Y = HY + (L ? LEN_Y[L] + 3 : 15), w = 19.4 * v + (p.wild ? 3 : 0) + (p.round ? 1.2 : 0);
  if (L < 1) { capN(sh, v, p.tex === 'rows' ? 15.2 : 16.5); return; }
  capN(sh, v, 15);
  const pts = [[HX - w, HY - 2], [HX - w - 0.8, Y - 8], [HX - w + 0.6, Y - 1]];
  const n = 6;
  for (let i = 1; i < n; i++) { const t = i / n; pts.push([HX - w + 0.6 + (2 * w - 1.2) * t, Y + (i % 2 ? 1.4 : -0.6) * (p.round ? 0.3 : 1)]); }
  pts.push([HX + w - 0.6, Y - 1], [HX + w + 0.8, Y - 8], [HX + w, HY - 2]);
  if (p.side) for (const q of pts) if (q[0] > HX + 4) q[1] = Math.min(q[1], HY + 13);
  sh.push(poly(pts, p.tex !== 'straight' || p.round));
}
function lengthE(sh, p, v) {
  const L = p.len || 0;
  if (L < 1) return;
  const Y = HY + LEN_Y[L] + (L >= 3 ? 1 : 0), back = 19.8 * v + (p.wild ? 3 : 0);
  const front = L >= 2 ? (p.round ? -1 : -4.4) : -6;
  const pts = [[HX - 14, HY - 12], [HX - back, HY], [HX - back - (L >= 3 ? 1.4 : 0.4), Y - 6], [HX - back + 1.4, Y - 0.8]];
  const n = 4;
  for (let i = 1; i <= n; i++) { const t = i / n; pts.push([HX - back + 1.4 + (back + front - 1.4) * t, Y + (i % 2 ? -1.6 : 0.8) * (p.round ? 0.2 : 1) - t * 1.2]); }
  pts.push([HX + front, Y - 5], [HX + front + 1.4, HY + 6], [HX + 1, HY - 1], [HX - 2, HY - 8]);
  sh.push(poly(pts, p.tex !== 'straight' || p.round));
}

// add-ons (buns, tails, braids…): shapes + optional detail painter (ties, braid segments)
function extras(sh, det, p, d) {
  for (const x of p.x || []) {
    if (x === 'crest') {
      if (d === 's') sh.push(poly([[HX - 6, HY - 9], [HX - 8, HY - 18], [HX - 6, HY - 27], [HX - 2.5, HY - 31], [HX + 1, HY - 33], [HX + 4, HY - 30], [HX + 7.5, HY - 26], [HX + 8.5, HY - 18], [HX + 6, HY - 9], [HX, HY - 11]], true));
      else if (d === 'n') sh.push(poly([[HX - 6, HY + 14], [HX - 7, HY - 12], [HX - 6, HY - 25], [HX - 2, HY - 30], [HX + 2, HY - 32], [HX + 6, HY - 27], [HX + 7.5, HY - 12], [HX + 6, HY + 14], [HX, HY + 16]], true));
      else sh.push(poly([[HX + 12, HY - 12], [HX + 14, HY - 21], [HX + 7, HY - 18], [HX + 6, HY - 29], [HX - 1, HY - 22], [HX - 5, HY - 31], [HX - 9, HY - 22], [HX - 16, HY - 27], [HX - 16, HY - 16], [HX - 23, HY - 16], [HX - 19, HY - 6], [HX - 2, HY - 16]]));
    } else if (x === 'ponytail') {
      if (d === 's') { sh.push(poly([[HX + 15, HY + 8], [HX + 21.4, HY + 13], [HX + 22.4, HY + 21], [HX + 20.4, HY + 29], [HX + 18, HY + 23], [HX + 15.6, HY + 17]], true)); }
      else if (d === 'n') { sh.push(poly([[HX - 4, HY + 3], [HX - 6.6, HY + 14], [HX - 5, HY + 24], [HX - 2, HY + 31], [HX + 1, HY + 33], [HX + 4, HY + 29], [HX + 6.4, HY + 17], [HX + 4, HY + 3]], true)); det.push(['tie', HX, HY + 4.6, 4.4, 1.4, 0]); }
      else { sh.push(poly([[HX - 14, HY - 7], [HX - 22, HY - 4], [HX - 26, HY + 6], [HX - 25, HY + 17], [HX - 21, HY + 27], [HX - 18.4, HY + 20], [HX - 18, HY + 11], [HX - 16, HY + 3], [HX - 12, HY]], true)); det.push(['tie', HX - 16.4, HY - 2.6, 2.4, 3.8, 0.6]); }
    } else if (x === 'high_tail') {
      if (d === 's') sh.push(poly([[HX + 8, HY - 17], [HX + 18, HY - 20], [HX + 24.4, HY - 12], [HX + 25, HY + 2], [HX + 22, HY + 13], [HX + 20.6, HY + 2], [HX + 18, HY - 9], [HX + 12, HY - 14]], true));
      else if (d === 'n') { sh.push(poly([[HX - 4.6, HY - 14], [HX - 7.6, HY - 2], [HX - 6, HY + 12], [HX - 1.6, HY + 22], [HX + 2.4, HY + 22], [HX + 6, HY + 10], [HX + 7, HY - 2], [HX + 4.6, HY - 14]], true)); det.push(['tie', HX, HY - 12, 4.6, 1.6, 0]); }
      else { sh.push(poly([[HX - 8, HY - 20], [HX - 18, HY - 23], [HX - 27, HY - 15], [HX - 29, HY - 2], [HX - 26.4, HY + 11], [HX - 23.6, HY + 2], [HX - 22.6, HY - 8], [HX - 16, HY - 15], [HX - 10, HY - 14]], true)); det.push(['tie', HX - 11.6, HY - 18, 2.6, 3.8, 0.9]); }
    } else if (x === 'pigtails') {
      const tail = (s) => [[HX + s * 15.6, HY - 4], [HX + s * 21.6, HY - 1], [HX + s * 24, HY + 8], [HX + s * 23, HY + 17], [HX + s * 20.4, HY + 24], [HX + s * 18.6, HY + 16], [HX + s * 18, HY + 7], [HX + s * 16.4, HY + 1]];
      if (d === 'e') { sh.push(poly([[HX - 8, HY - 8], [HX - 15, HY - 6], [HX - 19, HY + 4], [HX - 18.6, HY + 15], [HX - 16, HY + 23], [HX - 13.6, HY + 14], [HX - 12.6, HY + 5], [HX - 10, HY - 1]], true)); det.push(['tie', HX - 11.6, HY - 4.6, 2.8, 3, 0.7]); }
      else for (const s of [-1, 1]) { sh.push(poly(tail(s), true)); det.push(['tie', HX + s * 17.6, HY - 1.6, 2.4, 3.2, s * 0.6]); }
    } else if (x === 'bun') {
      const [cx, cy, r] = d === 's' ? [HX + 1, HY - 21, 7.5] : d === 'n' ? [HX, HY - 13, 8.5] : [HX - 13, HY - 15, 7.8];
      sh.push(ell(cx, cy, r, r * 0.94)); det.push(['bun', cx, cy, r]);
    } else if (x === 'low_bun') {
      if (d === 'n') { sh.push(ell(HX, HY + 11, 7.6, 6.8)); det.push(['bun', HX, HY + 11, 7.2]); }
      else if (d === 'e') { sh.push(ell(HX - 15.6, HY + 8, 6.6, 6.2)); det.push(['bun', HX - 15.6, HY + 8, 6.2]); }
    } else if (x === 'knot') {
      const [cx, cy] = d === 's' ? [HX, HY - 22.6] : d === 'n' ? [HX, HY - 18] : [HX - 7, HY - 21];
      sh.push(ell(cx, cy, 4.8, 4.4)); det.push(['tie', cx, cy + 3.6, 3.6, 1.3, 0]);
    } else if (x === 'buns2') {
      const B = d === 'e' ? [[HX - 11.4, HY - 18.6, 5.6], [HX - 2, HY - 21.6, 6]] : [[HX - 11.4, HY - 19, 6], [HX + 11.4, HY - 19, 6]];
      for (const [cx, cy, r] of B) { sh.push(ell(cx, cy, r, r * 0.95)); det.push(['bun', cx, cy, r]); }
    } else if (x === 'braids2') {
      if (d === 's') for (const s of [-1, 1]) { sh.push(poly([[HX + s * 15.6, HY + 1], [HX + s * 20.6, HY + 9], [HX + s * 20.6, HY + 19], [HX + s * 19.4, HY + 28], [HX + s * 16.6, HY + 28], [HX + s * 16.6, HY + 18], [HX + s * 14.6, HY + 6]], true)); det.push(['braid', HX + s * 18.2, HY + 9, HY + 27, 2.2]); }
      else if (d === 'n') for (const s of [-1, 1]) { sh.push(poly([[HX + s * 4.6, HY + 8], [HX + s * 9.4, HY + 9], [HX + s * 10.6, HY + 20], [HX + s * 10.4, HY + 31], [HX + s * 7.6, HY + 32], [HX + s * 6.6, HY + 20]], true)); det.push(['braid', HX + s * 8.6, HY + 12, HY + 31, 2]); }
      else { sh.push(poly([[HX - 12, HY + 4], [HX - 18, HY + 10], [HX - 19, HY + 21], [HX - 17.4, HY + 31], [HX - 14.4, HY + 31], [HX - 14.6, HY + 19], [HX - 9.6, HY + 9]], true)); det.push(['braid', HX - 16.4, HY + 11, HY + 30, 2.1]); }
    } else if (x === 'braid_back') {
      if (d === 'n') { sh.push(poly([[HX - 4, HY + 6], [HX - 5, HY + 20], [HX - 4.4, HY + 34], [HX - 1.6, HY + 39], [HX + 1.6, HY + 39], [HX + 4.4, HY + 34], [HX + 5, HY + 20], [HX + 4, HY + 6]], true)); det.push(['braid', HX, HY + 10, HY + 37, 2.8]); det.push(['tie', HX, HY + 36, 2.6, 1.2, 0]); }
      else if (d === 'e') { sh.push(poly([[HX - 13, HY + 2], [HX - 19, HY + 10], [HX - 21, HY + 22], [HX - 20.4, HY + 35], [HX - 17, HY + 35], [HX - 16.6, HY + 22], [HX - 12, HY + 9]], true)); det.push(['braid', HX - 18, HY + 12, HY + 33, 2.2]); }
    } else if (x === 'crown') {
      if (d === 's') { sh.push((g) => { g.moveTo(HX - 18.6, HY - 3); g.ellipse(HX, HY - 2, 19.4, 16.8, 0, Math.PI * 1.02, Math.PI * 1.98); g.lineTo(HX + 14.6, HY - 2.6); g.ellipse(HX, HY - 2, 14.6, 12, 0, Math.PI * 1.98, Math.PI * 1.02, true); g.closePath(); }); det.push(['ring', HX, HY - 2, 17, 14.4, Math.PI * 1.04, Math.PI * 1.96]); }
      else if (d === 'n') { sh.push((g) => { g.moveTo(HX - 19.6, HY + 2); g.ellipse(HX, HY + 1, 19.8, 17.4, 0, Math.PI * 1.0, Math.PI * 2.0); g.lineTo(HX + 15, HY + 2); g.ellipse(HX, HY + 1, 15, 12.4, 0, Math.PI * 2.0, Math.PI * 1.0, true); g.closePath(); }); det.push(['ring', HX, HY + 1, 17.4, 14.8, Math.PI * 1.02, Math.PI * 1.98]); }
      else { sh.push((g) => { g.moveTo(HX + 8, HY - 19); g.quadraticCurveTo(HX - 12, HY - 22, HX - 19.4, HY - 6); g.quadraticCurveTo(HX - 21, HY + 4, HX - 15, HY + 10); g.lineTo(HX - 11, HY + 6); g.quadraticCurveTo(HX - 15.6, HY + 1, HX - 14.4, HY - 6); g.quadraticCurveTo(HX - 9, HY - 16.6, HX + 7, HY - 14.6); g.closePath(); }); det.push(['ringE']); }
    } else if (x === 'puff') {
      const [cx, cy, r] = d === 's' ? [HX, HY - 22, 11] : d === 'n' ? [HX, HY - 17.6, 11.6] : [HX - 6, HY - 21.6, 10.8];
      sh.push(ell(cx, cy, r, r * 0.9));
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; sh.push(ell(cx + Math.cos(a) * r * 0.96, cy + Math.sin(a) * r * 0.86, 2.3, 2.1)); }
      det.push(['tie', cx, cy + r * 0.82, 5.4, 1.4, 0]);
    } else if (x === 'tie_back' && d === 'n') det.push(['tie', HX, HY + 9, 6.6, 1.6, 0]);
  }
}

// full recipe for one facing: { shapes, stubble, crown:[x,y], top, bot }
export function hairShapes(p, d, back = false) {
  const sh = [], det = [], stub = [];
  const v = p.vol || 1;
  if (p.none) return null;
  if (back) {
    if (d !== 's') return null;
    backS(sh, p, v);
    return sh.length ? { shapes: sh, det, stub, crown: [HX, HY - 10], top: HY - 12, bot: HY + LEN_Y[p.len] + 3, back: true } : null;
  }
  const cap = p.cap || 'full';
  if (p.shave) {
    if (d === 's') capS(stub, { fr: 'line' }, 0.97);
    else if (d === 'n') capN(stub, 0.97, 15.4);
    else capE(stub, { fr: 'line' }, 0.97);
  }
  if (cap === 'crest') { /* only the crest add-on */ }
  else if (cap === 'balding') {
    if (d === 's') for (const s of [-1, 1]) sh.push(poly([[HX + s * 15.8, HY - 7], [HX + s * 19.4, HY - 4], [HX + s * 19.6, HY + 2], [HX + s * 17.4, HY + 4], [HX + s * 16, HY + 1]], true));
    else if (d === 'n') sh.push((g) => { g.moveTo(HX - 19.2, HY - 6); g.quadraticCurveTo(HX - 20.4, HY + 10, HX - 12, HY + 15.4); g.quadraticCurveTo(HX, HY + 18.4, HX + 12, HY + 15.4); g.quadraticCurveTo(HX + 20.4, HY + 10, HX + 19.2, HY - 6); g.quadraticCurveTo(HX + 16, HY - 1, HX + 10, HY + 2.4); g.quadraticCurveTo(HX, HY + 5, HX - 10, HY + 2.4); g.quadraticCurveTo(HX - 16, HY - 1, HX - 19.2, HY - 6); g.closePath(); });
    else sh.push(poly([[HX - 9, HY - 9], [HX - 17.6, HY - 6], [HX - 19.4, HY + 4], [HX - 14, HY + 14], [HX - 7, HY + 14], [HX - 5.4, HY + 8], [HX - 1, HY + 4], [HX - 0.4, HY - 3], [HX - 4, HY - 3]], true));
  } else if (cap === 'afro') {
    const R = 19.6 * v;
    if (d === 's') {
      sh.push((g) => { g.moveTo(HX - R * 1.02, HY + 4); g.ellipse(HX, HY - 6.4, R * 1.02, R * 0.92, 0, Math.PI * 0.86, Math.PI * 2.14); const pts = FR_S.line.pts.map(([x, y]) => [HX + x * 1.04, HY + y + 1.6]); pts[0] = [HX + R * 0.92, HY + 5]; pts[pts.length - 1] = [HX - R * 0.92, HY + 5]; spline(g, pts, false, 1, false); g.closePath(); });
    } else if (d === 'n') sh.push(ell(HX, HY - 4.4, R * 1.02, R * 0.98));
    else sh.push((g) => { g.moveTo(HX + R * 0.6, HY - 16); g.ellipse(HX - 3.6, HY - 5.4, R * 0.98, R * 0.94, 0, Math.PI * 1.64, Math.PI * 2.84, true); g.lineTo(HX - 1, HY + 4); g.quadraticCurveTo(HX - 1, HY - 3, HX + 3, HY - 6.6); g.lineTo(HX + 12, HY - 8.6); g.closePath(); });
    // fuzzy rim
    const rim = d === 's' ? [HX, HY - 6.4, R * 1.02, R * 0.92, Math.PI * 0.9, Math.PI * 2.1] : d === 'n' ? [HX, HY - 4.4, R * 1.02, R * 0.98, 0, TAU] : [HX - 3.6, HY - 5.4, R * 0.98, R * 0.94, Math.PI * 0.82, Math.PI * 1.66];
    for (let a = rim[4]; a < rim[5]; a += 0.32) sh.push(ell(rim[0] + Math.cos(a) * rim[2], rim[1] + Math.sin(a) * rim[3], 2.4, 2.2));
  } else if (cap === 'top') {
    if (d === 's') sh.push((g) => { g.moveTo(HX - 13.4, HY - 9); g.quadraticCurveTo(HX - 15.6, HY - 21, HX, HY - 22.4 - (v - 1) * 6); g.quadraticCurveTo(HX + 15.6, HY - 21, HX + 13.4, HY - 9); if (p.fr === 'swept') { g.lineTo(HX + 10, HY - 11); g.quadraticCurveTo(HX - 2, HY - 9, HX - 10, HY - 3.6); g.lineTo(HX - 13.6, HY - 4.4); } else { g.quadraticCurveTo(HX, HY - 12.4, HX - 13.4, HY - 9); } g.closePath(); });
    else if (d === 'n') sh.push((g) => { g.moveTo(HX - 12.6, HY + 2); g.quadraticCurveTo(HX - 15.6, HY - 20, HX, HY - 21.6); g.quadraticCurveTo(HX + 15.6, HY - 20, HX + 12.6, HY + 2); g.quadraticCurveTo(HX, HY - 2, HX - 12.6, HY + 2); g.closePath(); });
    else sh.push((g) => { g.moveTo(HX + 15.4, HY - 9.4); g.quadraticCurveTo(HX + 10, HY - 23, HX - 4, HY - 21.6); g.quadraticCurveTo(HX - 17.6, HY - 18, HX - 18.4, HY - 6); g.quadraticCurveTo(HX - 8, HY - 10, HX + 2, HY - 10.6); if (p.fr === 'swept') { g.quadraticCurveTo(HX + 12, HY - 9.4, HX + 19, HY - 4.6); } g.closePath(); });
  } else if (cap === 'buzz') {
    if (d === 's') capS(sh, { fr: 'line' }, 0.955);
    else if (d === 'n') capN(sh, 0.955, 15.6);
    else capE(sh, { fr: 'line' }, 0.955);
  } else {
    const pp = cap === 'receding' ? { ...p, fr: 'receding' } : p;
    if (d === 's') capS(sh, pp, v);
    else if (d === 'e') capE(sh, pp, v);
  }
  if (d === 's') lengthS(sh, p, v);
  else if (d === 'n') { if (cap !== 'balding' && cap !== 'afro' && cap !== 'top' && cap !== 'crest' && cap !== 'buzz') lengthN(sh, p, v); else if (cap === 'top' && p.len >= 1) lengthN(sh, { ...p, len: p.len }, 0.96); }
  else if (cap !== 'crest' && cap !== 'balding') lengthE(sh, p, v);
  extras(sh, det, p, d);
  if (!sh.length && !stub.length) return null;
  const crownOf = { s: [HX - 2, HY - 16], n: [HX, HY - 6], e: [HX - 4, HY - 14] };
  const L = p.len || 0;
  return { shapes: sh, det, stub, crown: crownOf[d], top: HY - 20 * v - (p.x?.some((x) => /bun|knot|crest|puff|high/.test(x)) ? 10 : 0), bot: HY + Math.max(LEN_Y[L] + 2, d === 'n' ? 16 : 6, (p.x || []).length ? 30 : 0) };
}

// ---------------- painting ----------------
function texture(g, p, d, R, rand) {
  const [cx, cy] = R.crown;
  const tex = p.tex || 'straight';
  g.save(); g.globalCompositeOperation = 'source-atop';
  // volume: crown light → darker rim, darker underside
  g.fillStyle = rad(g, cx - 4, cy - 2, 2, 36, [[0, '#ffffff'], [0.45, '#e8e8e8'], [1, '#a6a6a6']]);
  g.fillRect(-20, -30, 100, 140);
  g.fillStyle = lin(g, 0, HY - 4, 0, R.bot + 4, [[0, 'rgba(0,0,0,0)'], [1, DARKH(0.3)]]);
  g.fillRect(-20, HY - 4, 100, 90);
  if (R.back) { g.fillStyle = DARKH(0.22); g.fillRect(-20, -30, 100, 140); }
  // strokes are batched into one dark and one light path (one stroke call each: fast atlas painting)
  const dk = new Path2D(), lt = new Path2D();
  const flush = (wd = 0.9, wl = 0.75, ad = 0.4, al = 0.42) => { g.strokeStyle = DARKH(ad); g.lineWidth = wd; g.stroke(dk); g.strokeStyle = LITEH(al); g.lineWidth = wl; g.stroke(lt); };
  const strand = (x, y, len, ang, bend, light) => {
    const P = light ? lt : dk;
    P.moveTo(x, y);
    P.quadraticCurveTo(x + Math.cos(ang + bend) * len * 0.55, y + Math.sin(ang + bend) * len * 0.55, x + Math.cos(ang + bend * 1.6) * len, y + Math.sin(ang + bend * 1.6) * len);
  };
  if (tex === 'straight' || tex === 'wavy') {
    const wave = tex === 'wavy';
    // radiating from the crown on the cranium
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU, r0 = 3 + rand() * 6, r1 = 14 + rand() * 18, b = (rand() - 0.5) * (wave ? 1.1 : 0.5);
      strand(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, r1, a, b, i % 3 === 0);
    }
    // hanging strands
    if (R.bot > HY + 8) for (let i = 0; i < 34; i++) {
      const x = HX - 24 + rand() * 48, y = HY - 2 + rand() * (R.bot - HY - 4);
      const ang = Math.PI / 2 + (x - HX) * 0.012 + (rand() - 0.5) * 0.2;
      if (wave) {
        const P = i % 3 ? dk : lt; P.moveTo(x, y);
        for (let k = 1; k <= 3; k++) P.quadraticCurveTo(x + (k % 2 ? 1.8 : -1.8), y + k * 3 - 1.5, x + (k % 2 ? 0.2 : -0.2), y + k * 3);
      } else strand(x, y, 6 + rand() * 9, ang, (rand() - 0.5) * 0.15, i % 3 === 0);
    }
    flush();
    // glossy sheen
    g.strokeStyle = LITEH(0.85); g.lineWidth = 2;
    g.beginPath(); g.arc(cx + 1, cy + 8, 11, Math.PI * 1.12, Math.PI * 1.42); g.stroke();
    g.strokeStyle = LITEH(0.4); g.lineWidth = 1.2;
    g.beginPath(); g.arc(cx + 1, cy + 8, 14, Math.PI * 1.15, Math.PI * 1.35); g.stroke();
    if (R.bot > HY + 14) { g.strokeStyle = LITEH(0.35); g.lineWidth = 1.4; g.beginPath(); for (const s of [-1, 1]) { g.moveTo(HX + s * 18.6, HY + 4); g.quadraticCurveTo(HX + s * 19.6, HY + 12, HX + s * 18.8, HY + 20); } g.stroke(); }
  } else if (tex === 'curly' || tex === 'coily') {
    const n = tex === 'coily' ? 110 : 56, r = tex === 'coily' ? 1.1 : 2;
    for (let i = 0; i < n; i++) {
      const x = HX - 30 + rand() * 60, y = R.top - 2 + rand() * (R.bot - R.top + 6);
      const r1 = r + rand() * r, r2 = r * 0.8 + rand() * 0.6;
      dk.moveTo(x + Math.cos(0.2) * r1, y + Math.sin(0.2) * r1); dk.arc(x, y, r1, 0.2, 2.6);
      lt.moveTo(x - 0.6 + Math.cos(3.5) * r2, y - 0.6 + Math.sin(3.5) * r2); lt.arc(x - 0.6, y - 0.6, r2, 3.5, 5.2);
    }
    if (tex === 'coily') flush(0.7, 0.6, 0.36, 0.35); else flush(1, 0.8, 0.45, 0.6);
    g.fillStyle = LITEH(tex === 'coily' ? 0.22 : 0.3); g.beginPath(); g.ellipse(cx - 2, cy - 1, 9, 5, -0.3, 0, TAU); g.fill();
  } else if (tex === 'locs' || tex === 'twists') {
    // ropes: from the crown outward on the cranium, then down
    const n = tex === 'locs' ? 18 : 22;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.85 + (i / (n - 1)) * 1.3) + (d === 'n' ? Math.PI * -0.1 : 0);
      const x0 = cx + Math.cos(a) * 4, y0 = cy + Math.sin(a) * 4;
      const x1 = cx + Math.cos(a) * 18, y1 = cy + Math.sin(a) * 15;
      const xe = x1 + (x1 - HX) * 0.1, ye = Math.max(y1, R.bot + 2);
      dk.moveTo(x0, y0); dk.quadraticCurveTo(x1, y1, xe, ye);
      lt.moveTo(x0 + 1.4, y0 + 0.4); lt.quadraticCurveTo(x1 + 1.4, y1 + 0.6, xe + 1.4, ye);
    }
    flush(0.9, 0.8, 0.5, 0.45);
    g.strokeStyle = DARKH(0.4); g.lineWidth = 0.6; g.beginPath();
    for (let i = 0; i < (tex === 'twists' ? 70 : 50); i++) { const x = HX - 26 + rand() * 52, y = R.top + rand() * (R.bot - R.top + 4); g.moveTo(x - 1.2, y - 0.6); g.lineTo(x + 1.2, y + (tex === 'twists' ? 1.4 : 0.6)); }
    g.stroke();
  } else if (tex === 'rows') {
    // cornrows: braided rows from the hairline to the nape
    const rows = 7;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1) - 0.5;
      g.strokeStyle = DARKH(0.6); g.lineWidth = 1;
      g.beginPath();
      if (d === 's') { g.moveTo(HX + t * 30, HY - 9 - Math.cos(t * 3) * 2); g.quadraticCurveTo(HX + t * 26, HY - 18, HX + t * 14, HY - 22); }
      else if (d === 'n') { g.moveTo(HX + t * 34, HY - 18); g.quadraticCurveTo(HX + t * 30, HY, HX + t * 10, HY + 15); }
      else { g.moveTo(HX + 15, HY - 9 - t * 18); g.quadraticCurveTo(HX - 2, HY - 14 - t * 16, HX - 17, HY + 4 - t * 12); }
      g.stroke();
      g.strokeStyle = LITEH(0.5); g.lineWidth = 0.7; g.beginPath();
      for (let k = 0; k < 9; k++) {
        const u = k / 8;
        let x, y;
        if (d === 's') { x = HX + t * (30 - 16 * u) + 2; y = HY - 9 - 13 * u; }
        else if (d === 'n') { x = HX + t * (34 - 24 * u) + 2.2; y = HY - 18 + 33 * u; }
        else { x = HX + 15 - 32 * u; y = HY - 9 - t * 18 + (12 - 6 * t) * u * u - 4 * u; }
        g.moveTo(x - 1.2, y - 0.8); g.lineTo(x, y + 0.4); g.lineTo(x + 1.2, y - 0.8);
      }
      g.stroke();
    }
  } else if (tex === 'buzz') {
    g.fillStyle = DARKH(0.28); g.beginPath();
    for (let i = 0; i < 160; i++) circle(g, HX - 22 + rand() * 44, HY - 22 + rand() * 40, 0.35 + rand() * 0.3);
    g.fill();
    g.fillStyle = LITEH(0.3); g.beginPath(); g.ellipse(cx, cy, 8, 4, -0.3, 0, TAU); g.fill();
  }
  if (p.side && d === 's') { g.strokeStyle = DARKH(0.45); g.lineWidth = 1; g.beginPath(); g.moveTo(HX + 6, HY - 19); g.quadraticCurveTo(HX + 4, HY - 14, HX + 6, HY - 9); g.stroke(); }
  if (p.fr === 'part' && d === 's') { g.strokeStyle = DARKH(0.5); g.lineWidth = 0.9; g.beginPath(); g.moveTo(HX + 7, HY - 20); g.quadraticCurveTo(HX + 6, HY - 15, HX + 4, HY - 10.6); g.stroke(); }
  if (p.fr === 'curtain' && d === 's') { g.strokeStyle = DARKH(0.5); g.lineWidth = 0.9; g.beginPath(); g.moveTo(HX, HY - 21); g.lineTo(HX, HY - 12.4); g.stroke(); }
  g.restore();
}
function details(g, det) {
  g.save(); g.globalCompositeOperation = 'source-atop';
  for (const D of det) {
    if (D[0] === 'bun') {
      const [, x, y, r] = D;
      g.strokeStyle = DARKH(0.5); g.lineWidth = 1.1;
      g.beginPath(); g.arc(x, y, r * 0.55, 0.3, 4.5); g.stroke();
      g.beginPath(); g.arc(x, y + r * 0.85, r * 0.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.strokeStyle = LITEH(0.6); g.lineWidth = 1; g.beginPath(); g.arc(x - 0.6, y - 0.8, r * 0.7, 3.6, 4.9); g.stroke();
    } else if (D[0] === 'braid') {
      const [, x, y0, y1, w] = D;
      g.strokeStyle = DARKH(0.55); g.lineWidth = 0.9;
      for (let y = y0; y < y1; y += 2.8) { g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y + 2, x + w, y); g.stroke(); }
      g.strokeStyle = LITEH(0.45); g.lineWidth = 0.7;
      for (let y = y0 + 1.2; y < y1; y += 2.8) { g.beginPath(); g.moveTo(x - w * 0.7, y - 0.4); g.quadraticCurveTo(x - w * 0.2, y + 0.6, x, y + 0.8); g.stroke(); }
    } else if (D[0] === 'ring') {
      // a plaited band: lit, edged, with crossing plaits
      const [, x, y, rx, ry, a0, a1] = D;
      g.strokeStyle = LITEH(0.35); g.lineWidth = 4; g.beginPath(); g.ellipse(x, y, rx, ry, 0, a0, a1); g.stroke();
      g.strokeStyle = DARKH(0.6); g.lineWidth = 0.9; g.beginPath(); g.ellipse(x, y, rx + 2.4, ry + 2.4, 0, a0, a1); g.stroke();
      g.beginPath(); g.ellipse(x, y, rx - 2.4, ry - 2.4, 0, a0, a1); g.stroke();
      for (let a = a0 + 0.06, k = 0; a < a1; a += 0.15, k++) {
        const c = Math.cos(a), sn = Math.sin(a), px = x + c * rx, py = y + sn * ry;
        g.beginPath(); g.moveTo(px - c * 2.2 - sn * 1.2, py - sn * 2.2 + c * 1.2); g.quadraticCurveTo(px + sn * 0.4, py - c * 0.4, px + c * 2.2 - sn * 1.2, py + sn * 2.2 + c * 1.2); g.stroke();
      }
    } else if (D[0] === 'ringE') {
      g.strokeStyle = LITEH(0.35); g.lineWidth = 3.6; g.beginPath(); g.moveTo(HX + 7.6, HY - 17); g.quadraticCurveTo(HX - 10.6, HY - 19.4, HX - 16.6, HY - 6); g.quadraticCurveTo(HX - 18, HY + 2, HX - 13, HY + 8); g.stroke();
      g.strokeStyle = DARKH(0.55); g.lineWidth = 0.9;
      for (let t = 0; t < 1; t += 0.07) { const x = HX + 7 - 23 * t, y = HY - 17 + 24 * t * t; g.beginPath(); g.moveTo(x - 1.4, y - 1.6); g.quadraticCurveTo(x + 0.4, y - 0.2, x + 1.4, y + 1.6); g.stroke(); }
    }
  }
  g.restore();
  // hair ties / bands (drawn over, untextured)
  for (const D of det) if (D[0] === 'tie') {
    const [, x, y, rx, ry, rot] = D;
    g.fillStyle = '#7c7c7c'; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill();
    g.fillStyle = LITEH(0.4); g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.3, rx * 0.4, ry * 0.4, rot, 0, TAU); g.fill();
  }
}
function fillShapes(g, shapes, col = '#d9d9d9') { g.fillStyle = col; for (const s of shapes) { g.beginPath(); s(g); g.fill(); } }

// hair part painter: mode 'base' (outlined, textured) or an accent mask 'streaks' | 'tips' | 'roots'
export function paintHair(P, e, d, { back = false, mode = 'base' } = {}) {
  const p = e.p, R = hairShapes(p, d, back);
  if (!R) return;
  const seed = e.id.length * 131 + e.id.charCodeAt(0) * 7 + d.charCodeAt(0) + (back ? 50 : 0);
  if (mode === 'base' && R.stub.length) {
    P.layer((g) => { g.globalAlpha = 0.34; fillShapes(g, R.stub, '#8a8a8a'); g.globalAlpha = 1; g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(40,40,40,0.35)'; const r = rng(seed + 9); g.beginPath(); for (let i = 0; i < 90; i++) circle(g, HX - 20 + r() * 40, HY - 20 + r() * 34, 0.4); g.fill(); g.restore(); }, 0);
  }
  if (!R.shapes.length) return;
  const thin = p.cap === 'buzz';
  P.layer((g) => {
    fillShapes(g, R.shapes);
    texture(g, p, d, R, rng(seed));
    details(g, R.det);
    if (mode !== 'base') {
      g.save(); g.globalCompositeOperation = 'destination-in';
      if (mode === 'streaks') {
        const r = rng(seed + 3), [cx, cy] = R.crown;
        g.strokeStyle = '#fff'; g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * (0.95 + (i / 8) * 1.1) + (r() - 0.5) * 0.12;
          g.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3);
          g.quadraticCurveTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 14, cx + Math.cos(a) * 20 + (a > Math.PI * 1.5 ? 1 : -1), Math.max(cy + Math.sin(a) * 18, R.bot + 4));
        }
        g.lineWidth = 1.7; g.stroke();
      } else {
        const t0 = R.top, t1 = R.bot + 2, span = t1 - t0;
        g.fillStyle = mode === 'tips'
          ? lin(g, 0, t0 + span * 0.48, 0, t1, [[0, 'rgba(255,255,255,0)'], [0.55, 'rgba(255,255,255,0.85)'], [1, '#fff']])
          : lin(g, 0, t0, 0, t0 + span * 0.5, [[0, '#fff'], [0.55, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]);
        g.fillRect(-30, -40, 120, 160);
      }
      g.restore();
    }
  }, mode === 'base' ? (thin ? 0.9 : 2.6) : 0, thin ? 'rgba(30,26,22,0.6)' : undefined, thin ? 0.62 : 1);
}
export const hasBack = (e) => !e.p.none && (e.p.len || 0) >= 3;

// ---------------- facial hair (s, e) ----------------
function mustache(g, d, m) {
  if (d === 'e') {
    const x = HX + 15.4, y = HY + 10.2;
    g.beginPath();
    if (m === 'walrus') { g.moveTo(x + 0.6, y - 1); g.quadraticCurveTo(x - 3, y - 1.6, x - 6.4, y + 0.6); g.quadraticCurveTo(x - 5, y + 4.4, x - 1, y + 3.2); g.quadraticCurveTo(x + 1.4, y + 2.6, x + 0.6, y - 1); }
    else if (m === 'pencil') { g.moveTo(x + 0.2, y - 0.4); g.quadraticCurveTo(x - 3, y - 0.8, x - 4.6, y + 0.4); g.quadraticCurveTo(x - 3, y + 0.6, x + 0.2, y + 0.6); }
    else if (m === 'handlebar') { g.moveTo(x + 0.4, y - 0.8); g.quadraticCurveTo(x - 4, y - 1.4, x - 6.2, y + 0.4); g.quadraticCurveTo(x - 8.4, y - 0.4, x - 8.6, y - 3); g.quadraticCurveTo(x - 7.4, y + 1.8, x - 4, y + 1.8); g.quadraticCurveTo(x - 1, y + 2, x + 0.4, y - 0.8); }
    else { g.moveTo(x + 0.4, y - 0.8); g.quadraticCurveTo(x - 3.4, y - 1.4, x - 5.4, y + 0.8); g.quadraticCurveTo(x - 3.6, y + 2.8, x - 0.6, y + 2); g.quadraticCurveTo(x + 1, y + 1.4, x + 0.4, y - 0.8); }
    g.fill(); return;
  }
  const y = HY + 10.6;
  for (const s of [-1, 1]) {
    const X = (dx) => HX + s * dx;
    g.beginPath();
    if (m === 'walrus') { g.moveTo(X(0), y - 1.4); g.quadraticCurveTo(X(4), y - 2.4, X(6.4), y); g.quadraticCurveTo(X(6.8), y + 3.8, X(4.6), y + 4.2); g.quadraticCurveTo(X(2), y + 3, X(0), y + 2.2); }
    else if (m === 'pencil') { g.moveTo(X(0.6), y - 0.2); g.quadraticCurveTo(X(3), y - 0.8, X(4.6), y + 0.6); g.quadraticCurveTo(X(3), y + 0.6, X(0.6), y + 0.8); }
    else if (m === 'handlebar') { g.moveTo(X(0), y - 1); g.quadraticCurveTo(X(4), y - 1.6, X(5.6), y + 0.4); g.quadraticCurveTo(X(8), y + 0.6, X(8.6), y - 2.6); g.quadraticCurveTo(X(9.2), y + 2.4, X(5.6), y + 2.4); g.quadraticCurveTo(X(2.4), y + 2.2, X(0), y + 1.4); }
    else { g.moveTo(X(0), y - 1.2); g.quadraticCurveTo(X(3.6), y - 1.8, X(5.4), y + 0.8); g.quadraticCurveTo(X(4.6), y + 2.8, X(2), y + 2.2); g.quadraticCurveTo(X(0.8), y + 1.8, X(0), y + 1.6); }
    g.closePath(); g.fill();
  }
}
function beardShape(g, d, b) {
  if (d === 'e') {
    const t = { goatee: [HX + 9, HY + 13, HY + 18], soul: [HX + 11, HY + 14.6, HY + 16.6], short: [HX - 2, HY + 4, HY + 21.4], full: [HX - 2.6, HY + 2, HY + 23.6], long: [HX - 3, HY + 2, HY + 31], braided: [HX - 3, HY + 2, HY + 33], forked: [HX - 3, HY + 2, HY + 31], strap: [HX - 2, HY + 2, HY + 19.4], mutton: [HX - 2.4, HY + 1, HY + 15], sideburns: [HX - 1.4, HY + 0.4, HY + 9] }[b];
    if (!t) return;
    const [x0, yTop, yBot] = t;
    g.beginPath();
    if (b === 'sideburns') { g.moveTo(HX - 2.4, HY - 4); g.lineTo(HX + 2.6, HY - 4); g.lineTo(HX + 3.4, HY + 9); g.quadraticCurveTo(HX, HY + 10.4, HX - 2.4, HY + 8); g.closePath(); g.fill(); return; }
    if (b === 'goatee' || b === 'soul') { g.moveTo(HX + 15, yTop); g.quadraticCurveTo(HX + 15.6, yBot, HX + 11.6, yBot + 0.6); g.quadraticCurveTo(x0 - 1, yBot - 1, x0, yTop + 0.6); g.closePath(); g.fill(); return; }
    g.moveTo(x0, yTop - 4);
    g.lineTo(x0 + 4.4, yTop - 4);
    if (b === 'mutton') { g.quadraticCurveTo(x0 + 6, yTop + 6, x0 + 10, yTop + 9.6); g.quadraticCurveTo(x0 + 13.6, yTop + 10.6, HX + 15.6, HY + 10.6); g.lineTo(HX + 15.4, HY + 13); g.quadraticCurveTo(HX + 8, yBot + 1.6, x0 + 1, yBot); g.closePath(); g.fill(); return; }
    g.quadraticCurveTo(x0 + 5, yTop + 6, x0 + 8, HY + 9.4);
    g.quadraticCurveTo(HX + 11, HY + 9.6, HX + 15.6, HY + 9.4);
    if (b === 'strap') { g.lineTo(HX + 15.6, HY + 14.6); g.quadraticCurveTo(HX + 13, HY + 17, HX + 9, HY + 16.4); g.quadraticCurveTo(HX + 4, HY + 14, x0 + 2.4, yTop + 2); }
    else {
      g.quadraticCurveTo(HX + 18.4, HY + 13, HX + 17.6, HY + 16);
      if (b === 'forked') { g.lineTo(HX + 17, yBot - 3); g.lineTo(HX + 14.6, yBot); g.lineTo(HX + 12.6, yBot - 5); g.lineTo(HX + 9.6, yBot - 1); }
      else g.quadraticCurveTo(HX + 16.6, yBot, HX + 10.6, yBot);
      g.quadraticCurveTo(x0 + 2, yBot - 4, x0 - 0.6, yTop + 4);
    }
    g.closePath(); g.fill();
    return;
  }
  g.beginPath();
  if (b === 'sideburns') { for (const s of [-1, 1]) { g.moveTo(HX + s * 17.4, HY - 3); g.lineTo(HX + s * 14.4, HY - 3); g.lineTo(HX + s * 14.6, HY + 7.6); g.quadraticCurveTo(HX + s * 16.6, HY + 9.4, HX + s * 17.6, HY + 6); g.closePath(); } g.fill(); return; }
  if (b === 'goatee') { g.moveTo(HX - 3.4, HY + 13.6); g.quadraticCurveTo(HX - 4.4, HY + 19.4, HX, HY + 20.6); g.quadraticCurveTo(HX + 4.4, HY + 19.4, HX + 3.4, HY + 13.6); g.quadraticCurveTo(HX, HY + 15, HX - 3.4, HY + 13.6); g.fill(); return; }
  if (b === 'soul') { g.moveTo(HX - 1.6, HY + 14.4); g.quadraticCurveTo(HX, HY + 17.4, HX + 1.6, HY + 14.4); g.quadraticCurveTo(HX, HY + 14, HX - 1.6, HY + 14.4); g.fill(); return; }
  const deep = { short: 21.6, full: 24, long: 31.6, braided: 33.6, forked: 31, strap: 19.6, mutton: 14.6 }[b] || 22;
  g.moveTo(HX - 17.2, HY + 0.6);
  if (b === 'mutton') {
    g.quadraticCurveTo(HX - 17.4, HY + 12, HX - 11, HY + 14.6); g.quadraticCurveTo(HX - 6, HY + 13.4, HX - 4.6, HY + 10.6); g.quadraticCurveTo(HX - 9, HY + 9.4, HX - 13.4, HY + 5);
    g.closePath();
    g.moveTo(HX + 17.2, HY + 0.6); g.quadraticCurveTo(HX + 17.4, HY + 12, HX + 11, HY + 14.6); g.quadraticCurveTo(HX + 6, HY + 13.4, HX + 4.6, HY + 10.6); g.quadraticCurveTo(HX + 9, HY + 9.4, HX + 13.4, HY + 5); g.closePath();
    g.fill(); return;
  }
  const W = b === 'long' || b === 'braided' || b === 'forked' ? 8 : 7;
  g.quadraticCurveTo(HX - 17.4, HY + 15, HX - W, HY + deep - 2.4);
  if (b === 'forked') { g.lineTo(HX - 3.4, HY + deep + 1); g.lineTo(HX, HY + deep - 5.4); g.lineTo(HX + 3.4, HY + deep + 1); }
  else g.quadraticCurveTo(HX, HY + deep + 1.6, HX + W, HY + deep - 2.4);
  g.quadraticCurveTo(HX + 17.4, HY + 15, HX + 17.2, HY + 0.6);
  if (b === 'strap') { g.lineTo(HX + 14.6, HY + 4.4); g.quadraticCurveTo(HX + 13.6, HY + 14.4, HX, HY + 17); g.quadraticCurveTo(HX - 13.6, HY + 14.4, HX - 14.6, HY + 4.4); }
  else {
    g.lineTo(HX + 13.6, HY + 6); g.quadraticCurveTo(HX + 9, HY + 9.2, HX + 4.6, HY + 9.6); g.quadraticCurveTo(HX, HY + 8.2, HX - 4.6, HY + 9.6); g.quadraticCurveTo(HX - 9, HY + 9.2, HX - 13.6, HY + 6);
    g.closePath();
    // mouth opening
    g.moveTo(HX - 4, HY + 12.8); g.quadraticCurveTo(HX, HY + 14.8, HX + 4, HY + 12.8); g.quadraticCurveTo(HX, HY + 12.2, HX - 4, HY + 12.8);
  }
  g.closePath();
  g.fill('evenodd');
}
export function paintBeard(P, e, d) {
  const p = e.p;
  if (!p.st && !p.m && !p.b) return;
  const rand = rng(e.id.length * 77 + d.charCodeAt(0));
  if (p.st) P.layer((g) => {
    g.fillStyle = `rgba(120,120,120,${p.st * 0.5})`;
    g.beginPath(); if (d === 'e') { g.moveTo(HX - 1, HY + 2); g.quadraticCurveTo(HX + 2, HY + 14, HX + 9, HY + 17.6); g.quadraticCurveTo(HX + 15, HY + 17, HX + 15.6, HY + 9); g.quadraticCurveTo(HX + 9, HY + 8, HX + 3, HY + 1); }
    else { g.moveTo(HX - 17, HY + 2); g.quadraticCurveTo(HX - 16, HY + 17, HX, HY + 18.6); g.quadraticCurveTo(HX + 16, HY + 17, HX + 17, HY + 2); g.quadraticCurveTo(HX + 9, HY + 9, HX, HY + 9); g.quadraticCurveTo(HX - 9, HY + 9, HX - 17, HY + 2); }
    g.closePath(); g.fill();
    g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(70,70,70,${0.4 + p.st * 0.4})`;
    g.beginPath(); for (let i = 0; i < 120; i++) circle(g, (d === 'e' ? HX - 2 : HX - 18) + rand() * (d === 'e' ? 19 : 36), HY + 1 + rand() * 18, 0.3 + rand() * 0.25); g.fill();
    g.restore();
  }, 0);
  if (!p.m && !p.b) return;
  P.layer((g) => {
    g.fillStyle = '#d6d6d6';
    if (p.b) beardShape(g, d, p.b);
    if (p.m) mustache(g, d, p.m);
    g.save(); g.globalCompositeOperation = 'source-atop';
    g.fillStyle = lin(g, HX - 12, HY + 4, HX + 12, HY + 30, [[0, '#f6f6f6'], [1, '#9c9c9c']]); g.fillRect(-10, 0, 80, 90);
    g.strokeStyle = DARKH(0.45); g.lineWidth = 0.9;
    g.beginPath(); for (let i = 0; i < 26; i++) { const x = (d === 'e' ? HX + 1 : HX - 15) + rand() * (d === 'e' ? 17 : 30), y = HY + 6 + rand() * 26; g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 2, y + 3 + rand() * 3); } g.stroke();
    g.strokeStyle = LITEH(0.55); g.lineWidth = 0.8;
    g.beginPath(); for (let i = 0; i < 8; i++) { const x = (d === 'e' ? HX + 4 : HX - 11) + rand() * (d === 'e' ? 11 : 22), y = HY + 9 + rand() * 12; g.moveTo(x, y); g.lineTo(x + 0.5, y + 3); } g.stroke();
    if (p.b === 'braided') { const x = d === 'e' ? HX + 13 : HX; g.strokeStyle = DARKH(0.55); for (let y = HY + 20; y < HY + 33; y += 2.6) { g.beginPath(); g.moveTo(x - 2.2, y); g.quadraticCurveTo(x, y + 1.8, x + 2.2, y); g.stroke(); } }
    g.restore();
    if (p.b === 'braided') { const x = d === 'e' ? HX + 13.4 : HX; g.fillStyle = '#7c7c7c'; g.beginPath(); g.ellipse(x, HY + 30.6, 2.6, 1.1, 0, 0, TAU); g.fill(); }
  }, 2.2);
}
