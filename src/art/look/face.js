// Head & face part painters (agent H), drawn in the pawn head box (pawns.js HW × HH, skull centre HX, HY,
// anchor at NECK). White/grey art tinted by multiplication: skull, ears, nose, mouth, cheeks, age lines,
// marks and scars use the skin colour (so lips, freckles and scars look natural on every skin tone);
// eye whites / pupils are untinted, irises use the eye colour, brows the facial hair colour, paint its own.
// The cranium (top half) is the same for every head shape, so every hair style fits every head.

import { TAU, lin, rad, circle, taper } from '../paint.js';
import { spline } from '../kit.js';
import { HX, HY } from '../pawns.js';

const atop = (g, fn) => { g.save(); g.globalCompositeOperation = 'source-atop'; fn(); g.restore(); };
const SK = (a) => `rgba(112,80,70,${a})`;      // skin shading (multiplied by the skin)
const OUTC = '#1e1a16';

// ---------------- head shapes ----------------
export function headPath(g, d, p) {
  if (d === 's') {
    g.moveTo(HX - 17.5, HY);
    g.ellipse(HX, HY, 17.5, 18, 0, Math.PI, TAU);
    spline(g, [[HX + 17.5, HY], [HX + p.cw, HY + 5.5], [HX + p.jw, HY + 12], [HX + p.chw, HY + 16.4], [HX, HY + p.cy],
      [HX - p.chw, HY + 16.4], [HX - p.jw, HY + 12], [HX - p.cw, HY + 5.5], [HX - 17.5, HY]], false, 1, false);
    g.closePath();
  } else if (d === 'n') {
    const w = Math.max(17.5, p.cw * 0.98);
    g.moveTo(HX - 17.5, HY);
    g.ellipse(HX, HY, 17.5, 18, 0, Math.PI, TAU);
    spline(g, [[HX + 17.5, HY], [HX + w, HY + 6], [HX + p.jw * 0.92 + 1, HY + 12.4], [HX + p.chw + 2, HY + 16.6], [HX, HY + p.cy - 0.4],
      [HX - p.chw - 2, HY + 16.6], [HX - p.jw * 0.92 - 1, HY + 12.4], [HX - w, HY + 6], [HX - 17.5, HY]], false, 1, false);
    g.closePath();
  } else {
    const pe = p.pe, jx = p.jx;
    spline(g, [
      [HX - 1, HY - 18], [HX + 9.4, HY - 15.2], [HX + 14.6, HY - 7.8], [HX + 15.8, HY - 0.8], [HX + 15.6, HY + 4.4], [HX + 15.4, HY + 9.2],
      [HX + 14.6, HY + 12.4], [HX + 13.6 + pe, HY + 15.4], [HX + 9.4 + pe * 0.5, HY + p.cy - 0.6], [HX + 2.4 - jx, HY + 15.8 + jx * 0.6],
      [HX - 6.6, HY + 15.6], [HX - 14.2, HY + 10], [HX - 17.8, HY + 0.6], [HX - 14.8, HY - 11.2],
    ], true, 1);
  }
}
export function head(g, d, e) {
  const p = e.p;
  g.beginPath(); headPath(g, d, p); g.fillStyle = '#d0d0d0'; g.fill();
  atop(g, () => {
    g.fillStyle = lin(g, HX - 16, HY - 18, HX + 14, HY + 18, [[0, '#ffffff'], [0.55, '#f1f1f1'], [1, '#dadada']]);
    g.beginPath(); g.ellipse(HX - 2.2, HY - 2.5, 17, 18, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(HX - 7, HY - 9, 6, 4, -0.5, 0, TAU); g.fill();
    // jaw shade + soft cheek volume
    g.fillStyle = lin(g, 0, HY + 6, 0, HY + 20, [[0, 'rgba(0,0,0,0)'], [1, SK(0.26)]]); g.fillRect(0, 0, 80, 90);
    if (d === 's') {
      if (p.full) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(HX - 10.5, HY + 8.5, 4.6, 3.4, 0, 0, TAU); g.ellipse(HX + 10.5, HY + 8.5, 4.6, 3.4, 0, 0, TAU); g.fill(); }
      g.strokeStyle = SK(0.16); g.lineWidth = 1; g.beginPath(); g.moveTo(HX - p.jw + 2, HY + 12.6); g.quadraticCurveTo(HX, HY + p.cy + 0.4, HX + p.jw - 2, HY + 12.6); g.stroke();
    } else if (d === 'n') {
      g.fillStyle = SK(0.18); g.beginPath(); g.ellipse(HX, HY + 15, 12, 6, 0, 0, TAU); g.fill();
    } else {
      g.fillStyle = SK(0.14); g.beginPath(); g.ellipse(HX + 5, HY + 9, 6.6, 4.6, 0, 0, TAU); g.fill();
      g.strokeStyle = SK(0.2); g.lineWidth = 1; g.beginPath(); g.moveTo(HX + 2.6 - p.jx, HY + 15); g.quadraticCurveTo(HX + 7, HY + p.cy - 1.4, HX + 12.6, HY + 15); g.stroke();
    }
  });
}

// ---------------- ears ----------------
function earShape(g, x, y, rx, ry, rot, tip) {
  if (!tip) { g.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); g.ellipse(x, y, rx, ry, rot, 0, TAU); return; }
  // pointed: tear-drop with the tip up and slightly out
  const s = Math.sign(rot || 1);
  g.moveTo(x, y + ry);
  g.bezierCurveTo(x - rx * 1.2, y + ry * 0.6, x - rx * 1.1 + s * 0.6, y - ry * 0.5, x + s * rx * 0.7, y - ry * 1.35);
  g.bezierCurveTo(x + s * rx * 1.4, y - ry * 0.4, x + rx * 1.15, y + ry * 0.6, x, y + ry);
}
export function ears(g, d, e) {
  const p = e.p;
  g.fillStyle = '#d8d8d8';
  if (d === 'e') {
    g.beginPath(); earShape(g, HX - 3.4, HY + 3.4, p.rx * 0.86, p.ry * 0.9, 0.15, p.tip); g.fill();
    atop(g, () => {
      g.fillStyle = lin(g, HX - 6, HY, HX, HY + 8, [[0, '#ffffff'], [1, '#c8c8c8']]); g.fillRect(HX - 10, HY - 6, 14, 18);
      g.strokeStyle = SK(0.5); g.lineWidth = 0.9; g.beginPath(); g.arc(HX - 3, HY + 3.8, Math.min(p.rx, p.ry) * 0.42, -1.2, 1.6); g.stroke();
      g.strokeStyle = SK(0.25); g.lineWidth = 0.7; g.beginPath(); g.arc(HX - 3.6, HY + 3, p.rx * 0.6, -2.2, 0.4); g.stroke();
    });
    return;
  }
  const out = p.out ? 1.2 : 0;
  for (const s of [-1, 1]) {
    const x = HX + s * (16.8 + out), y = HY + 2.2;
    g.beginPath(); earShape(g, x, y, p.rx, p.ry, s * (p.out ? 0.35 : 0.08), p.tip); g.fill();
  }
  atop(g, () => {
    g.fillStyle = lin(g, 0, HY - 4, 0, HY + 8, [[0, '#ffffff'], [1, '#c4c4c4']]); g.fillRect(0, HY - 10, 80, 22);
    if (d === 's') {
      g.strokeStyle = SK(0.55); g.lineWidth = 1; g.beginPath();
      for (const s of [-1, 1]) { const x = HX + s * (17.6 + out); g.arc(x, HY + 2.6, Math.min(p.rx, p.ry) * 0.55, s < 0 ? 0.9 : -1.9, s < 0 ? 4.2 : 1.2); }
      g.stroke();
    }
  });
}

// ---------------- eyes ----------------
// opening of one eye; side -1 = screen-left eye (outer corner on the left)
function eyeOpen(g, cx, cy, p, side, k = 1) {
  const rx = p.rx * k, ry = p.ry;
  const ox = cx + side * rx, ix = cx - side * rx;
  const oy = cy - p.tilt * ry * 1.1, iy = cy + p.tilt * ry * 0.35;
  const top = cy - ry * 1.3 * (1 - (p.lid || 0)), bot = cy + ry * 1.15 * (1 - (p.low || 0));
  g.moveTo(ix, iy);
  g.bezierCurveTo(cx - side * rx * 0.55, top, cx + side * rx * 0.45, top - p.tilt * 0.6, ox, oy);
  g.bezierCurveTo(cx + side * rx * 0.5, bot, cx - side * rx * 0.5, bot, ix, iy);
  g.closePath();
  return { top, bot };
}
const EYE_S = (p) => [[HX - 6.3 - (p.dx || 0), HY + 3.2, -1], [HX + 6.3 + (p.dx || 0), HY + 3.2, 1]];
const EYE_E = [HX + 9.8, HY + 2.8];
function eachEye(d, p, fn) {
  if (d === 'e') fn(EYE_E[0], EYE_E[1], 1, 0.72);
  else for (const [x, y, s] of EYE_S(p)) fn(x, y, s, 1);
}
// sclera + dark rim (untinted)
export function eyeBase(g, d, e) {
  const p = e.p;
  eachEye(d, p, (x, y, s, k) => {
    g.beginPath(); eyeOpen(g, x, y, p, s, k); g.fillStyle = '#efe8e0'; g.fill();
    g.save(); g.beginPath(); eyeOpen(g, x, y, p, s, k); g.clip();
    g.fillStyle = 'rgba(120,90,80,0.35)'; g.beginPath(); g.ellipse(x, y - p.ry * 1.1, p.rx * 1.6, p.ry * 0.7, 0, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(40,28,24,0.85)'; g.lineWidth = 0.7; g.beginPath(); eyeOpen(g, x, y, p, s, k); g.stroke();
  });
}
// iris (tinted with the eye colour)
export function eyeIris(g, d, e) {
  const p = e.p;
  eachEye(d, p, (x, y, s, k) => {
    g.save(); g.beginPath(); eyeOpen(g, x, y, p, s, k); g.clip();
    const r = Math.min(p.rx, p.ry) * (p.iris || 0.66) * 1.32, ix = d === 'e' ? x + p.rx * k * 0.32 : x + s * 0.15, iy = y + p.ry * 0.08;
    g.fillStyle = rad(g, ix - r * 0.25, iy - r * 0.25, 0, r * 1.1, [[0, '#e8e8e8'], [0.55, '#b4b4b4'], [1, '#6e6e6e']]);
    g.beginPath(); circle(g, ix, iy, r); g.fill();
    g.restore();
  });
}
// pupil, catchlight, upper lid line, lashes, lid crease (untinted)
export function eyeTop(g, d, e) {
  const p = e.p;
  eachEye(d, p, (x, y, s, k) => {
    const r = Math.min(p.rx, p.ry) * (p.iris || 0.66) * 1.32, ix = d === 'e' ? x + p.rx * k * 0.32 : x + s * 0.15, iy = y + p.ry * 0.08;
    g.save(); g.beginPath(); eyeOpen(g, x, y, p, s, k); g.clip();
    g.fillStyle = '#16100d'; g.beginPath(); circle(g, ix, iy, r * 0.46); g.fill();
    g.strokeStyle = 'rgba(22,16,13,0.55)'; g.lineWidth = 0.5; g.beginPath(); circle(g, ix, iy, r); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); circle(g, ix - r * 0.38, iy - r * 0.4, Math.max(0.45, r * 0.3)); g.fill();
    g.restore();
    // upper lid: thick dark line + lashes
    const rx = p.rx * k, ry = p.ry, ox = x + s * rx, ixx = x - s * rx;
    const oy = y - p.tilt * ry * 1.1, iyy = y + p.tilt * ry * 0.35, top = y - ry * 1.3 * (1 - (p.lid || 0));
    g.strokeStyle = '#1c1411'; g.lineCap = 'round'; g.lineWidth = 1.1 + (p.lash ? 0.25 : 0);
    g.beginPath(); g.moveTo(ixx, iyy); g.bezierCurveTo(x - s * rx * 0.55, top, x + s * rx * 0.45, top - p.tilt * 0.6, ox, oy); g.stroke();
    if (p.lash) {
      g.lineWidth = 0.75; g.beginPath();
      const n = p.lash > 1 ? 3 : 2;
      for (let i = 0; i < n; i++) { const t = 0.55 + i * 0.18; const lx = ixx + (ox - ixx) * t, ly = iyy + (oy - iyy) * t - ry * 0.95 * (1 - (p.lid || 0)) * Math.sin(t * Math.PI) - 0.2; g.moveTo(lx, ly); g.lineTo(lx + s * 1.1, ly - 1.1 - i * 0.2); }
      g.moveTo(ox, oy); g.lineTo(ox + s * 1.2, oy - 0.6);
      g.stroke();
    }
    if ((p.lid || 0) > 0.25) { g.strokeStyle = 'rgba(90,64,56,0.55)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(ixx, iyy - 1.2); g.quadraticCurveTo(x, y - ry * 1.55, ox, oy - 1); g.stroke(); }
    if (p.low) { g.strokeStyle = 'rgba(90,64,56,0.45)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(ixx, iyy + 0.4); g.quadraticCurveTo(x, y + ry * 1.2, ox, oy + 0.6); g.stroke(); }
  });
}
// closed lids (tinted with the skin) for blinks and sleep (agent D's rig)
export function eyeLids(g, d, e) {
  const p = e.p;
  eachEye(d, p, (x, y, s, k) => {
    g.fillStyle = '#e6e6e6'; g.beginPath(); eyeOpen(g, x, y, { ...p, ry: p.ry * 1.15, rx: p.rx * 1.08, lid: 0, low: 0 }, s, k); g.fill();
    g.strokeStyle = 'rgba(40,30,26,0.9)'; g.lineWidth = 0.9; g.lineCap = 'round';
    const rx = p.rx * k;
    g.beginPath(); g.moveTo(x - rx, y + 0.5); g.quadraticCurveTo(x, y + 1.9, x + rx, y + 0.5 - s * p.tilt * 0.8); g.stroke();
    if (p.lash) { g.lineWidth = 0.6; g.beginPath(); g.moveTo(x + s * rx, y + 0.6); g.lineTo(x + s * (rx + 1), y + 1.6); g.stroke(); }
  });
}

// ---------------- brows (facial hair colour) ----------------
export function brows(g, d, e) {
  const p = e.p;
  if (p.none) return;
  const one = (pts, w) => {
    // tapered: thick at the inner end, thin at the outer end
    const [a, b, c] = pts;
    g.beginPath(); taper(g, a[0], a[1], b[0] * 2 - (a[0] + c[0]) / 2, b[1] * 2 - (a[1] + c[1]) / 2, c[0], c[1], w * 1.15, w * 0.55, 12); g.fill();
  };
  g.fillStyle = '#d8d8d8';
  const y0 = HY - 1.4;
  if (d === 'e') {
    const a = p.a;
    one([[HX + 7.2, y0 - a[0] * 0.8], [HX + 9.6, y0 - a[1] - 0.6], [HX + 12.2, y0 - a[2] * 0.8 + 0.2]].reverse(), p.w);
  } else {
    for (const s of [-1, 1]) {
      const a = p.a, x0 = HX + s * 3.6, x1 = HX + s * 6.6, x2 = HX + s * 9.6;
      one([[x0, y0 - a[0]], [x1, y0 - a[1] - 0.4], [x2, y0 - a[2] + 0.4]], p.w);
    }
    if (p.joined) { g.beginPath(); g.ellipse(HX, y0 - p.a[0] + 0.2, 3.2, p.w * 0.42, 0, 0, TAU); g.fill(); }
  }
  if (p.bushy) atop(g, () => {
    g.strokeStyle = 'rgba(120,120,120,0.6)'; g.lineWidth = 0.6; g.beginPath();
    for (let i = 0; i < 18; i++) { const x = HX - 10 + (i * 20) / 18, y = y0 - 1.4; g.moveTo(x, y + 1.6); g.lineTo(x + 0.8, y - 0.6); }
    g.stroke();
  });
}

// ---------------- nose (skin) ----------------
export function nose(g, d, e) {
  const p = e.p;
  if (d === 'n') return;
  if (d === 'e') {
    const x0 = HX + 15.2, tipX = HX + 17.6 + p.pr * 0.92, tipY = HY + 5.8 + p.ph;
    const path = (closed) => {
      g.moveTo(closed ? x0 - 0.6 : x0 + 0.8, closed ? HY + 0.2 : HY - 0.6);
      g.quadraticCurveTo(x0 + p.pr * (p.hk ? 0.9 : 0.45) + (p.up ? -0.4 : 0), HY + 1.6 + p.ph * (p.hk ? 0.1 : 0.4), tipX, tipY);
      if (p.bulb) g.quadraticCurveTo(tipX + 1.4, tipY + 1.8, tipX - 1.2, tipY + 2.4);
      g.quadraticCurveTo(x0 + p.pr * 0.55, HY + 8.8, closed ? x0 - 0.2 : x0 + 0.5, closed ? HY + 8.6 : HY + 9.3);
      if (closed) { g.lineTo(x0 - 3, HY + 8.4); g.lineTo(x0 - 3, HY + 0.4); g.closePath(); }
    };
    g.strokeStyle = OUTC; g.lineWidth = 4.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); path(false); g.stroke();
    g.fillStyle = '#e6e6e6'; g.beginPath(); path(true); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(tipX - 1.4, tipY - 1, 1.2, 0.8, 0.4, 0, TAU); g.fill();
    g.strokeStyle = SK(0.55); g.lineWidth = 0.8; g.beginPath(); g.arc(x0 + p.pr * 0.4, HY + 7.6, 1, -2.6, 0.2); g.stroke();
    return;
  }
  const y = HY + 8.2, w = p.w;
  // shadow side, bridge, tip highlight, nostrils
  g.fillStyle = SK(0.16); g.beginPath(); g.ellipse(HX + w * 0.55, y - p.l * 0.4, w * 0.55, p.l * 0.55, 0.15, 0, TAU); g.fill();
  if (p.br) { g.strokeStyle = SK(0.28); g.lineWidth = 0.8; g.beginPath(); g.moveTo(HX + 1, y - p.l - 1.2); g.quadraticCurveTo(HX + 1.6, y - p.l * 0.5, HX + 1.4, y - 1); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(HX + 0.1, y - 1.4 - (p.up ? 0.4 : 0), 0.9 + p.tip * 0.25, 1.1 + p.tip * 0.2, 0, 0, TAU); g.fill();
  g.strokeStyle = SK(0.62); g.lineWidth = 1.05; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(HX - w, y - 0.4 + (p.wide ? 0.4 : 0)); g.quadraticCurveTo(HX - w * 0.4, y + 1.2 + p.tip * 0.3, HX, y + 0.6 + p.tip * 0.35);
  g.quadraticCurveTo(HX + w * 0.4, y + 1.2 + p.tip * 0.3, HX + w, y - 0.4 + (p.wide ? 0.4 : 0));
  g.stroke();
  g.fillStyle = SK(0.5);
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(HX + s * w * 0.5, y + 0.4, 0.55 + (p.wide ? 0.2 : 0), 0.35, s * 0.4, 0, TAU); g.fill(); }
  if (p.sharp) { g.strokeStyle = SK(0.3); g.lineWidth = 0.7; g.beginPath(); g.moveTo(HX - 0.8, y - p.l); g.lineTo(HX - 0.6, y - 1.8); g.stroke(); }
}

// ---------------- mouth (skin: lips are a darker, warmer shade of the skin) ----------------
export function mouth(g, d, e) {
  const p = e.p;
  if (d === 'n') return;
  if (d === 'e') {
    const x = HX + 15, y = HY + 12;
    g.fillStyle = 'rgba(190,110,104,0.5)'; g.beginPath(); g.ellipse(x - 1.8, y + 0.3, 2.2, 0.9 + p.low * 0.3, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(80,40,36,0.8)'; g.lineWidth = 0.9; g.lineCap = 'round'; g.beginPath(); g.moveTo(x + 0.4, y - 0.1); g.quadraticCurveTo(x - 1.6, y + 0.2 - p.c * 0.2, x - 3.6 - p.w * 0.1, y - p.c * 0.55); g.stroke();
    if (p.open) { g.fillStyle = 'rgba(60,24,22,0.85)'; g.beginPath(); g.ellipse(x - 1.4, y + 0.5, 1.4, p.open * 0.45, 0, 0, TAU); g.fill(); }
    return;
  }
  const y = HY + 12.2, w = p.w, c = p.c, t = p.tilt || 0;
  const L = [HX - w, y - c * 0.45 + t * 0.5], Rr = [HX + w, y - c * 0.45 - t * 0.5], M = [HX + t * 0.2, y + c * 0.5];
  // lips
  g.fillStyle = 'rgba(206,124,116,0.42)';
  g.beginPath(); g.moveTo(L[0], L[1]); g.quadraticCurveTo(HX - w * 0.4, y - 0.6 - p.up, HX, y - 0.3 - p.up * 0.7); g.quadraticCurveTo(HX + w * 0.4, y - 0.6 - p.up, Rr[0], Rr[1]); g.quadraticCurveTo(M[0], M[1] + 0.2, L[0], L[1]); g.fill();
  g.fillStyle = 'rgba(218,140,130,0.4)';
  g.beginPath(); g.moveTo(L[0] + 0.4, L[1] + 0.2); g.quadraticCurveTo(M[0], M[1] + 0.6 + p.low * 2, Rr[0] - 0.4, Rr[1] + 0.2); g.quadraticCurveTo(M[0], M[1] + 0.2, L[0] + 0.4, L[1] + 0.2); g.fill();
  if (p.low > 0.7) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(HX - w * 0.15, M[1] + p.low * 1.1, w * 0.35, 0.45, 0, 0, TAU); g.fill(); }
  if (p.open) {
    g.fillStyle = 'rgba(56,22,20,0.92)';
    g.beginPath();
    if (p.round) g.ellipse(HX, y + 0.6, w * 0.7, p.open * 0.6, 0, 0, TAU);
    else { g.moveTo(L[0] + 0.6, L[1] + 0.2); g.quadraticCurveTo(M[0], M[1] + p.open * 1.4, Rr[0] - 0.6, Rr[1] + 0.2); g.quadraticCurveTo(M[0], M[1] - 0.2, L[0] + 0.6, L[1] + 0.2); }
    g.fill();
    if (p.teeth) { g.fillStyle = '#f6f4ee'; g.beginPath(); g.moveTo(L[0] + 1, L[1] + 0.3); g.quadraticCurveTo(M[0], M[1] + 0.9, Rr[0] - 1, Rr[1] + 0.3); g.quadraticCurveTo(M[0], M[1] - 0.1, L[0] + 1, L[1] + 0.3); g.fill(); }
  }
  g.strokeStyle = 'rgba(86,42,38,0.85)'; g.lineWidth = 0.95; g.lineCap = 'round';
  g.beginPath(); g.moveTo(L[0], L[1]); g.quadraticCurveTo(M[0], M[1], Rr[0], Rr[1]); g.stroke();
  if (c > 1.2) { g.lineWidth = 0.7; g.beginPath(); g.moveTo(L[0] - 0.4, L[1] - 0.8); g.quadraticCurveTo(L[0] - 0.9, L[1], L[0] - 0.2, L[1] + 0.6); g.moveTo(Rr[0] + 0.4, Rr[1] - 0.8); g.quadraticCurveTo(Rr[0] + 0.9, Rr[1], Rr[0] + 0.2, Rr[1] + 0.6); g.stroke(); }
  // chin dimple shadow
  g.strokeStyle = SK(0.22); g.lineWidth = 0.8; g.beginPath(); g.moveTo(HX - 1.6, y + 3.6 + p.low); g.quadraticCurveTo(HX, y + 4.3 + p.low, HX + 1.6, y + 3.6 + p.low); g.stroke();
}

// ---------------- cheeks, age lines, marks, scars (skin) ----------------
export function cheeks(g, d, e, rand) {
  const p = e.p;
  if (d === 'n') return;
  const pts = d === 'e' ? [[HX + 7, HY + 8]] : [[HX - 10.6, HY + 8], [HX + 10.6, HY + 8]];
  for (const [x, y] of pts) {
    if (p.blush) { g.fillStyle = rad(g, x, y, 0, 4.6, [[0, `rgba(255,120,110,${p.blush})`], [1, 'rgba(255,120,110,0)']]); g.beginPath(); g.ellipse(x, y, 5, 3.6, 0, 0, TAU); g.fill(); }
    if (p.round) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(x - 1, y - 1.2, 2.4, 1.4, -0.3, 0, TAU); g.fill(); }
    if (p.bones) {
      g.strokeStyle = SK(0.35); g.lineWidth = 0.9; g.beginPath(); const s = x < HX ? -1 : 1;
      g.moveTo(x - s * 3.6, y + 1.6); g.quadraticCurveTo(x, y + 3.6, x + s * 3.6, y - 1.6); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(x + s * 0.6, y - 1.4, 2.6, 1.1, s * -0.4, 0, TAU); g.fill();
    }
  }
  if (p.dimple) {
    g.strokeStyle = SK(0.5); g.lineWidth = 0.8; g.beginPath();
    if (d === 'e') g.arc(HX + 11, HY + 12.4, 1.1, -1.4, 1.4);
    else for (const s of [-1, 1]) { g.moveTo(HX + s * 4.6, HY + 11); g.quadraticCurveTo(HX + s * 5.6, HY + 12.4, HX + s * 4.8, HY + 13.6); }
    g.stroke();
  }
}
export function age(g, d, e) {
  const p = e.p, lv = p.lv || 0;
  if (d === 'n') {
    if (lv >= 2) { g.strokeStyle = SK(0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(HX - 7, HY + 13); g.quadraticCurveTo(HX, HY + 14.4, HX + 7, HY + 13); g.stroke(); }
    return;
  }
  g.lineCap = 'round';
  const L = (a, w, fn) => { g.strokeStyle = SK(a); g.lineWidth = w; g.beginPath(); fn(); g.stroke(); };
  if (d === 'e') {
    if (lv >= 1) L(0.3 + lv * 0.1, 0.8, () => { g.moveTo(HX + 12.6, HY + 7.6); g.quadraticCurveTo(HX + 11, HY + 10, HX + 11.6, HY + 12.6); });
    if (lv >= 2) L(0.35, 0.7, () => { for (let i = 0; i < 3; i++) { g.moveTo(HX + 6, HY + 1 + i * 1.6); g.lineTo(HX + 3.8, HY + 0.4 + i * 2.2); } });
    if (lv >= 2) L(0.3, 0.7, () => { g.moveTo(HX + 6, HY - 8); g.quadraticCurveTo(HX + 10, HY - 9, HX + 13.6, HY - 8); if (lv >= 3) { g.moveTo(HX + 5, HY - 10.6); g.quadraticCurveTo(HX + 9.6, HY - 11.6, HX + 13, HY - 10.6); } });
    if (lv >= 3) L(0.32, 0.8, () => { g.moveTo(HX + 10, HY + 14.6); g.quadraticCurveTo(HX + 8, HY + 16.4, HX + 5, HY + 16.2); });
    if (p.bags || lv >= 3) L(0.4, 0.8, () => { g.moveTo(HX + 7.6, HY + 5.6); g.quadraticCurveTo(HX + 9.6, HY + 6.8, HX + 11.8, HY + 5.4); });
    return;
  }
  if (lv >= 1) L(0.28 + lv * 0.1, 0.85, () => { for (const s of [-1, 1]) { g.moveTo(HX + s * 3.4, HY + 8.8); g.quadraticCurveTo(HX + s * 5.4, HY + 11, HX + s * 4.8, HY + 13.4); } });
  if (lv >= 1) L(0.22 + lv * 0.08, 0.7, () => { g.moveTo(HX - 6, HY - 8.2); g.quadraticCurveTo(HX, HY - 9.2, HX + 6, HY - 8.2); });
  if (lv >= 2) L(0.34, 0.7, () => { for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { g.moveTo(HX + s * 9.6, HY + 1.4 + i * 1.5); g.lineTo(HX + s * 11.8, HY + 0.6 + i * 2.1); } });
  if (lv >= 3) L(0.3, 0.7, () => { g.moveTo(HX - 7.6, HY - 10.8); g.quadraticCurveTo(HX, HY - 12, HX + 7.6, HY - 10.8); g.moveTo(HX - 1.4, HY - 3.6); g.lineTo(HX - 1, HY - 1.6); g.moveTo(HX + 1.4, HY - 3.6); g.lineTo(HX + 1, HY - 1.6); });
  if (lv >= 3) L(0.3, 0.8, () => { for (const s of [-1, 1]) { g.moveTo(HX + s * 6, HY + 14.4); g.quadraticCurveTo(HX + s * 7.6, HY + 16, HX + s * 9.6, HY + 15); } });
  if (p.bags || lv >= 3) L(0.42, 0.85, () => { for (const s of [-1, 1]) { g.moveTo(HX + s * 4.2, HY + 6); g.quadraticCurveTo(HX + s * 6.4, HY + 7.4, HX + s * 8.6, HY + 5.8); } });
  if (p.bags) { g.fillStyle = 'rgba(120,80,110,0.16)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(HX + s * 6.4, HY + 6.2, 2.8, 1.2, 0, 0, TAU); g.fill(); } }
}
export function marks(g, d, e, rand) {
  const p = e.p;
  if (d === 'n') return;
  const X = (x) => (d === 'e' ? HX + 7 + x * 0.5 : HX + x);
  if (p.fr) {
    g.fillStyle = 'rgba(150,84,52,0.55)';
    for (let i = 0; i < p.fr; i++) {
      const side = d === 'e' ? 1 : rand() < 0.5 ? -1 : 1;
      const x = d === 'e' ? HX + 4 + rand() * 10 : HX + side * (1 + rand() * 11), y = HY + 4 + rand() * 6 - (Math.abs(x - HX) < 3 ? 1 : 0);
      g.beginPath(); circle(g, x, y, 0.32 + rand() * 0.38); g.fill();
    }
  }
  for (const m of [p.mole, p.mole2, p.mole3]) {
    if (!m) continue;
    g.fillStyle = 'rgba(70,40,30,0.85)'; g.beginPath(); circle(g, X(d === 'e' ? Math.abs(m[0]) : m[0]), HY + m[1], 0.62); g.fill();
  }
  if (p.birth) {
    g.fillStyle = 'rgba(150,64,60,0.3)'; g.beginPath();
    const cx = d === 'e' ? HX + 6 : HX - 9, cy = HY - 4;
    for (let i = 0; i < 7; i++) { g.moveTo(cx + 3, cy); g.ellipse(cx + (rand() - 0.5) * 4, cy + (rand() - 0.5) * 3.6, 1.6 + rand() * 1.6, 1.2 + rand() * 1.2, rand() * 3, 0, TAU); }
    g.fill();
  }
  if (p.spots) {
    g.fillStyle = 'rgba(150,96,62,0.26)';
    for (let i = 0; i < 5; i++) { const x = d === 'e' ? HX + 2 + rand() * 10 : HX + (rand() - 0.5) * 24, y = HY - 8 + rand() * 18; g.beginPath(); g.ellipse(x, y, 1 + rand() * 1.4, 0.8 + rand(), rand() * 3, 0, TAU); g.fill(); }
  }
}
export function scar(g, d, e) {
  const p = e.p;
  if (d === 'n') return;
  const T = (pt) => (d === 'e' ? [HX + 6 + Math.abs(pt[0]) * 0.55, HY + pt[1]] : [HX + pt[0], HY + pt[1]]);
  g.lineCap = 'round';
  if (p.burn) {
    const cx = d === 'e' ? HX + 7 : HX + 8.6, cy = HY + 5;
    g.fillStyle = 'rgba(210,120,110,0.42)'; g.beginPath(); g.ellipse(cx, cy, d === 'e' ? 4.4 : 5.6, 5, 0.3, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; for (const [x, y, r] of [[-1.6, -1.4, 1.4], [1.8, 1, 1.1], [-0.4, 2.2, 0.9]]) { g.beginPath(); circle(g, cx + x, cy + y, r); g.fill(); }
    g.strokeStyle = 'rgba(130,60,52,0.45)'; g.lineWidth = 0.7; g.beginPath(); g.ellipse(cx, cy, d === 'e' ? 4.4 : 5.6, 5, 0.3, 0, TAU); g.stroke();
    return;
  }
  for (const [a0, b0] of p.lines || []) {
    const a = T(a0), b = T(b0);
    g.strokeStyle = 'rgba(128,56,48,0.7)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    g.strokeStyle = 'rgba(255,214,206,0.75)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(a[0] - 0.4, a[1]); g.lineTo(b[0] - 0.4, b[1]); g.stroke();
    if (p.stitch) {
      g.strokeStyle = 'rgba(110,48,40,0.6)'; g.lineWidth = 0.6; g.beginPath();
      for (let k = 0.2; k < 1; k += 0.22) { const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k; g.moveTo(x - 1.3, y + 0.6); g.lineTo(x + 1.3, y - 0.6); }
      g.stroke();
    }
  }
}

// ---------------- face paint (own colour) ----------------
export function facePaint(g, d, e, rand) {
  const k = e.p.kind;
  if (!k) return;
  g.save();
  g.beginPath(); if (d === 'e') g.ellipse(HX + 1, HY + 1, 15.6, 17, 0, 0, TAU); else g.ellipse(HX, HY + 1.4, 16.6, 17.2, 0, 0, TAU); g.clip();
  g.fillStyle = '#f2f2f2'; g.strokeStyle = '#f2f2f2'; g.lineCap = 'round'; g.lineJoin = 'round';
  const brush = (fn, w) => { g.lineWidth = w; g.beginPath(); fn(); g.stroke(); };
  const sides = d === 'e' ? [1] : [-1, 1];
  const X = (s, x) => (d === 'e' ? HX + 6 + x * 0.6 : HX + s * x);
  if (d === 'n') {
    if (k === 'tribal' || k === 'stripes') { brush(() => { g.moveTo(HX - 8, HY + 12); g.quadraticCurveTo(HX, HY + 9, HX + 8, HY + 12); }, 1.6); }
    g.restore(); return;
  }
  if (k === 'stripes') for (const s of sides) brush(() => { for (let i = 0; i < 3; i++) { g.moveTo(X(s, 7.6), HY + 5.4 + i * 2.2); g.lineTo(X(s, 13.6), HY + 4.2 + i * 2.6); } }, 1.25);
  else if (k === 'band') { g.globalAlpha = 0.95; g.beginPath(); if (d === 'e') { g.moveTo(HX + 2, HY - 0.6); g.lineTo(HX + 17, HY - 1.4); g.lineTo(HX + 17, HY + 6); g.lineTo(HX + 2, HY + 6.6); } else { g.moveTo(HX - 17, HY - 0.4); g.quadraticCurveTo(HX, HY - 2.6, HX + 17, HY - 0.4); g.lineTo(HX + 16, HY + 6.4); g.quadraticCurveTo(HX + 6, HY + 7.6, HX, HY + 5.4); g.quadraticCurveTo(HX - 6, HY + 7.6, HX - 16, HY + 6.4); } g.closePath(); g.fill(); }
  else if (k === 'hunter') { for (const s of sides) brush(() => { g.moveTo(X(s, 5.4), HY + 6.2); g.lineTo(X(s, 5.8), HY + 10.4); g.moveTo(X(s, 7.8), HY + 6); g.lineTo(X(s, 8.4), HY + 10); }, 1.2); if (d === 's') { g.beginPath(); circle(g, HX, HY - 5.6, 1.2); g.fill(); } }
  else if (k === 'dots') { for (const s of sides) for (let i = 0; i < 3; i++) { g.beginPath(); circle(g, X(s, 8.6 + i * 1.8), HY + 6.6 + (i % 2) * 1.6, 0.85); g.fill(); } if (d === 's') for (let i = -1; i <= 1; i++) { g.beginPath(); circle(g, HX + i * 2.4, HY - 6.6 + Math.abs(i) * 0.6, 0.8); g.fill(); } }
  else if (k === 'tears') for (const s of sides) brush(() => { g.moveTo(X(s, 6.2), HY + 6); g.quadraticCurveTo(X(s, 6.8), HY + 10, X(s, 6), HY + 14.6); }, 1.1);
  else if (k === 'chin') { g.beginPath(); if (d === 'e') { g.moveTo(HX + 4, HY + 13.4); g.quadraticCurveTo(HX + 11, HY + 12.6, HX + 17, HY + 13.4); g.lineTo(HX + 16, HY + 20); g.lineTo(HX + 4, HY + 20); } else { g.moveTo(HX - 13, HY + 12.6); g.quadraticCurveTo(HX, HY + 15.6, HX + 13, HY + 12.6); g.lineTo(HX + 13, HY + 20); g.lineTo(HX - 13, HY + 20); } g.closePath(); g.fill(); }
  else if (k === 'half') { g.globalAlpha = 0.95; g.beginPath(); if (d === 'e') g.rect(HX + 8, HY - 20, 14, 40); else { g.moveTo(HX + 0.4, HY - 20); g.quadraticCurveTo(HX - 1, HY, HX + 0.4, HY + 20); g.lineTo(HX + 20, HY + 20); g.lineTo(HX + 20, HY - 20); g.closePath(); } g.fill(); }
  else if (k === 'tribal') {
    for (const s of sides) brush(() => { g.moveTo(X(s, 12.6), HY + 3.4); g.quadraticCurveTo(X(s, 8.4), HY + 6, X(s, 10.2), HY + 9.4); g.quadraticCurveTo(X(s, 12.4), HY + 11.6, X(s, 9.4), HY + 13.2); }, 1.2);
    if (d === 's') brush(() => { g.moveTo(HX - 6, HY - 7.4); g.quadraticCurveTo(HX, HY - 3.6, HX + 6, HY - 7.4); g.moveTo(HX, HY - 4.8); g.lineTo(HX, HY - 9.6); }, 1.2);
  } else if (k === 'forehead') {
    const cx = d === 'e' ? HX + 11 : HX, cy = HY - 7.6;
    g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy, d === 'e' ? 1.4 : 2.2, 2.2, 0, 0, TAU); g.stroke();
    g.beginPath(); circle(g, cx, cy, 0.8); g.fill();
    brush(() => { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3); g.lineTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4); } }, 0.7);
  } else if (k === 'spirit') {
    // forest spirit: a vine curling from the forehead down one cheek, with small leaves
    const S = 1;
    brush(() => { g.moveTo(X(S, 1), HY - 12); g.bezierCurveTo(X(S, 7), HY - 10.6, X(S, 12.4), HY - 4.6, X(S, 10.6), HY + 1.6); g.bezierCurveTo(X(S, 9.4), HY + 6, X(S, 13), HY + 9, X(S, 11.2), HY + 13.4); }, 1);
    const leafAt = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(d === 'e' ? a * 0.6 : a); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(1.7, -1.5, 3.4, 0); g.quadraticCurveTo(1.7, 1.5, 0, 0); g.fill(); g.restore(); };
    for (const [x, y, a] of [[4.6, -11.2, -0.4], [9.4, -7.6, 0.5], [11.8, -1.8, 1.2], [10, 4.4, 2.6], [12.2, 9, 0.9]]) leafAt(X(S, x), HY + y, a);
    if (d === 's') { g.beginPath(); for (const [x, y] of [[-6, 6.6], [-8.4, 8.4], [-6.6, 10.2]]) circle(g, HX + x, HY + y, 0.6); g.fill(); }
  } else if (k === 'whiskers') {
    if (d === 's') { g.beginPath(); g.ellipse(HX, HY + 7.4, 1.6, 1.2, 0, 0, TAU); g.fill(); }
    for (const s of sides) brush(() => { for (let i = 0; i < 3; i++) { g.moveTo(X(s, 4.6), HY + 9 + i * 1.2); g.lineTo(X(s, 12.4), HY + 7.6 + i * 2.2); } }, 0.75);
  }
  g.restore();
  // worn paint: a few gaps
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 9; i++) { g.beginPath(); circle(g, HX - 16 + rand() * 32, HY - 10 + rand() * 28, 0.35 + rand() * 0.5); g.fill(); }
  g.restore();
}
