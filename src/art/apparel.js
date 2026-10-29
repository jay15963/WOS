// Apparel overlays (Art B), drawn in the exact pawn body/head boxes so they line up in every facing:
//   wear_<id>_{s,n,e}: body tunic_cloth, armor_leather, armor_copper, armor_iron (fixed material colors, NOT tinted)
//                      head hat_straw, hood_leather, helmet_copper, helmet_iron
//   hat_bandana_{s,n,e} (bandit headscarf, white → tinted with look.hatColor)
//   face_mask_{s,e} (tinted with look.hatColor), face_scar_{s,e}, face_eyepatch_{s,e} (fixed colors)
// WEAR exports the painters so items.js can draw the same pieces as inventory icons.

import { spritePxFast as spritePx, rng, TAU, lin, rad, circle, mixc, rgb, hex } from './paint.js';
import { BW, BH, FEET, HW, HH, NECK, HX, HY, bodyPath } from './pawns.js';
import { spline, rrect } from './kit.js';

const A = (c, a) => rgb(hex(c), a);
const DIRS = ['s', 'n', 'e'];

// body region above a hem line y (curved), clipped by callers to the body silhouette
function above(g, d, y, k = 4) {
  if (d === 'e') { g.moveTo(8, 0); g.lineTo(50, 0); g.lineTo(50, y - k * 0.2); g.quadraticCurveTo(29, y + k * 0.7, 8, y); }
  else { g.moveTo(2, 0); g.lineTo(54, 0); g.lineTo(54, y); g.quadraticCurveTo(28, y + k, 2, y); }
  g.closePath();
}
const hemCurve = (g, d, y, k = 4) => { if (d === 'e') { g.moveTo(8, y); g.quadraticCurveTo(29, y + k * 0.7, 50, y - k * 0.2); } else { g.moveTo(2, y); g.quadraticCurveTo(28, y + k, 54, y); } };
// shoulder pad centers per facing
const SHOULDERS = { s: [[12.5, 19], [43.5, 19]], n: [[12.5, 19], [43.5, 19]], e: [[26, 18]] };

function shade(g, d, top, bot) {
  g.fillStyle = lin(g, 8, top, 46, bot, [[0, 'rgba(255,250,235,0.28)'], [0.45, 'rgba(0,0,0,0)'], [1, 'rgba(20,12,6,0.32)']]);
  g.fillRect(0, 0, BW, BH + 4);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.beginPath(); g.ellipse(d === 'e' ? 24 : 18, 17, d === 'e' ? 6 : 8, 4, -0.35, 0, TAU); g.fill();
}

// ---------------- body wear ----------------
const BODY = {
  tunic_cloth(g, d, rand) {
    const C = { base: '#d8c7a0', light: '#efe3c6', dark: '#9c875e', seam: '#7a6646', rope: '#8f6c3e' };
    const hem = 48.5;
    g.save(); g.beginPath(); bodyPath(g, d); g.clip();
    g.beginPath(); above(g, d, hem, 3); g.fillStyle = C.base; g.fill();
    g.save(); g.beginPath(); above(g, d, hem, 3); g.clip();
    shade(g, d, 10, hem);
    // coarse weave
    g.strokeStyle = A(C.dark, 0.18); g.lineWidth = 0.6;
    for (let y = 12; y < hem; y += 2.2) { g.beginPath(); g.moveTo(0, y + rand() * 0.6); g.lineTo(BW, y + rand() * 0.6); g.stroke(); }
    // folds
    g.strokeStyle = A(C.dark, 0.5); g.lineWidth = 1;
    if (d === 'e') { g.beginPath(); g.moveTo(36, 39); g.quadraticCurveTo(38, 44, 37, 48); g.moveTo(22, 40); g.quadraticCurveTo(21, 44, 22, 48.5); g.stroke(); }
    else { for (const x of [17, 28, 39]) { g.beginPath(); g.moveTo(x, 39); g.quadraticCurveTo(x + 1, 44, x - 0.5, 49); g.stroke(); } }
    // short sleeves
    g.strokeStyle = A(C.seam, 0.7); g.lineWidth = 1.1;
    if (d === 'e') { g.beginPath(); g.moveTo(25, 28.5); g.quadraticCurveTo(29, 30.5, 32.5, 28); g.stroke(); }
    else { g.beginPath(); g.moveTo(8, 29); g.quadraticCurveTo(11.5, 31, 14.5, 29); g.moveTo(41.5, 29); g.quadraticCurveTo(44.5, 31, 48, 29); g.stroke(); }
    g.restore();
    // hem stitches
    g.strokeStyle = A(C.seam, 0.8); g.lineWidth = 0.9; g.setLineDash([1.6, 1.4]);
    g.beginPath(); hemCurve(g, d, hem - 1.6, 3); g.stroke(); g.setLineDash([]);
    g.strokeStyle = A(C.seam, 0.9); g.lineWidth = 1.2; g.beginPath(); hemCurve(g, d, hem, 3); g.stroke();
    // rope belt with knot
    const by = 37;
    g.strokeStyle = C.rope; g.lineWidth = 2.4; g.beginPath(); hemCurve(g, d, by, 3.5); g.stroke();
    g.strokeStyle = '#5e4424'; g.lineWidth = 0.6; g.setLineDash([1.2, 1.2]); g.beginPath(); hemCurve(g, d, by, 3.5); g.stroke(); g.setLineDash([]);
    if (d === 's') {
      g.fillStyle = C.rope; g.beginPath(); circle(g, 33, by + 2.6, 1.8); g.fill();
      g.strokeStyle = C.rope; g.lineWidth = 1.6; g.beginPath(); g.moveTo(33, by + 3); g.lineTo(32, by + 9); g.moveTo(33.5, by + 3); g.lineTo(35.5, by + 8.5); g.stroke();
      // V neckline with lacing
      g.fillStyle = A(C.dark, 0.55); g.beginPath(); g.moveTo(23, 15); g.lineTo(28, 25); g.lineTo(33, 15); g.closePath(); g.fill();
      g.strokeStyle = C.seam; g.lineWidth = 1.1; g.beginPath(); g.moveTo(22, 14.5); g.lineTo(28, 25.5); g.lineTo(34, 14.5); g.stroke();
      g.strokeStyle = '#6a5030'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(25.6, 19); g.lineTo(30.4, 20.5); g.moveTo(30.4, 19); g.lineTo(25.6, 20.5); g.stroke();
    } else if (d === 'e') {
      g.fillStyle = C.rope; g.beginPath(); circle(g, 38, by + 0.6, 1.7); g.fill();
      g.strokeStyle = C.rope; g.lineWidth = 1.5; g.beginPath(); g.moveTo(38, by + 1); g.lineTo(39, by + 7); g.stroke();
    }
    g.restore();
  },
  armor_leather(g, d, rand) {
    const C = { base: '#8c5a32', light: '#c08a58', dark: '#57351b', stitch: '#e0bf86', strap: '#4a2c16', buckle: '#c9a24e', stud: '#d8c49a' };
    const hem = 45;
    g.save(); g.beginPath(); bodyPath(g, d); g.clip();
    g.beginPath(); above(g, d, hem, 3.5); g.fillStyle = C.base; g.fill();
    g.save(); g.beginPath(); above(g, d, hem, 3.5); g.clip();
    shade(g, d, 10, hem);
    // panels (center seam + side seams), worn scuffs
    g.strokeStyle = A(C.dark, 0.7); g.lineWidth = 1.1;
    if (d === 'e') { g.beginPath(); g.moveTo(21, 16); g.quadraticCurveTo(19, 30, 21, 46); g.stroke(); }
    else { g.beginPath(); g.moveTo(28, 16); g.lineTo(28, 46); g.moveTo(16, 18); g.quadraticCurveTo(14, 30, 16, 46); g.moveTo(40, 18); g.quadraticCurveTo(42, 30, 40, 46); g.stroke(); }
    g.strokeStyle = A(C.stitch, 0.75); g.lineWidth = 0.7; g.setLineDash([1.3, 1.3]);
    if (d === 'e') { g.beginPath(); g.moveTo(22.4, 16); g.quadraticCurveTo(20.4, 30, 22.4, 46); g.stroke(); }
    else { g.beginPath(); g.moveTo(29.3, 16); g.lineTo(29.3, 46); g.moveTo(17.4, 18); g.quadraticCurveTo(15.4, 30, 17.4, 46); g.moveTo(38.6, 18); g.quadraticCurveTo(40.6, 30, 38.6, 46); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = A(C.light, 0.25); for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(10 + rand() * 36, 22 + rand() * 18, 2 + rand() * 2, 0.8, rand(), 0, TAU); g.fill(); }
    g.restore();
    // chest strap with buckle (front) / cross straps (back)
    g.strokeStyle = C.strap; g.lineWidth = 3;
    if (d === 's') { g.beginPath(); g.moveTo(13, 17); g.lineTo(42, 40); g.stroke(); g.fillStyle = C.buckle; g.beginPath(); rrect(g, 25, 26, 5, 4, 1); g.fill(); g.fillStyle = C.strap; g.fillRect(26.6, 27.4, 1.8, 1.2); }
    else if (d === 'n') { g.beginPath(); g.moveTo(13, 17); g.lineTo(42, 40); g.moveTo(43, 17); g.lineTo(14, 40); g.stroke(); }
    else { g.beginPath(); g.moveTo(26, 14); g.lineTo(34, 42); g.stroke(); }
    // studs along the hem
    g.fillStyle = C.stud;
    for (let x = d === 'e' ? 14 : 8; x < (d === 'e' ? 44 : 50); x += 4) { const y = hem - 2.4 + Math.sin(((x - 8) / 42) * Math.PI) * (d === 'e' ? 2.2 : 3.2); g.beginPath(); circle(g, x, y, 0.8); g.fill(); }
    g.strokeStyle = C.dark; g.lineWidth = 1.4; g.beginPath(); hemCurve(g, d, hem, 3.5); g.stroke();
    g.restore();
    // shoulder pads (stick out a little past the silhouette)
    for (const [x, y] of SHOULDERS[d]) {
      g.fillStyle = lin(g, x - 6, y - 5, x + 6, y + 5, [[0, C.light], [0.5, C.base], [1, C.dark]]);
      g.beginPath(); g.ellipse(x, y, d === 'e' ? 8.5 : 7.5, 5.2, d === 'e' ? 0.2 : (x < 28 ? -0.35 : 0.35), 0, TAU); g.fill();
      g.strokeStyle = A(C.stitch, 0.8); g.lineWidth = 0.7; g.setLineDash([1.2, 1.2]);
      g.beginPath(); g.ellipse(x, y, d === 'e' ? 6.6 : 5.8, 3.6, d === 'e' ? 0.2 : (x < 28 ? -0.35 : 0.35), 0, TAU); g.stroke(); g.setLineDash([]);
    }
  },
  armor_copper(g, d, rand) {
    const C = { base: '#c47646', light: '#f6b984', dark: '#7a3b1c', patina: '#4ea58c', strap: '#5a3a22' };
    const hem = 47;
    g.save(); g.beginPath(); bodyPath(g, d); g.clip();
    g.beginPath(); above(g, d, hem, 3.5); g.fillStyle = C.dark; g.fill();
    g.save(); g.beginPath(); above(g, d, hem, 3.5); g.clip();
    // overlapping scale rows
    const x0 = d === 'e' ? 12 : 4, x1 = d === 'e' ? 46 : 52;
    for (let row = 0, y = 12; y < hem + 4; y += 4.2, row++) {
      for (let x = x0 + (row % 2) * 2.6; x < x1; x += 5.2) {
        g.fillStyle = lin(g, x - 2.6, y - 2, x + 2.6, y + 3, [[0, C.light], [0.5, C.base], [1, C.dark]]);
        g.beginPath(); g.moveTo(x - 2.6, y - 1); g.lineTo(x + 2.6, y - 1); g.lineTo(x + 2.6, y + 1.6); g.quadraticCurveTo(x, y + 4.6, x - 2.6, y + 1.6); g.closePath(); g.fill();
        g.strokeStyle = A('#4a2210', 0.6); g.lineWidth = 0.5; g.stroke();
        if (rand() < 0.18) { g.fillStyle = A(C.patina, 0.6); g.beginPath(); circle(g, x + (rand() - 0.5) * 2, y + 1.6, 0.9); g.fill(); }
      }
    }
    shade(g, d, 10, hem);
    g.restore();
    // collar band + belt
    g.strokeStyle = C.strap; g.lineWidth = 2.6; g.beginPath(); hemCurve(g, d, 38, 3.5); g.stroke();
    g.fillStyle = C.light; if (d !== 'n') { g.beginPath(); circle(g, d === 'e' ? 38 : 28, d === 'e' ? 38.8 : 40, 1.6); g.fill(); }
    g.strokeStyle = C.dark; g.lineWidth = 1.4; g.beginPath(); hemCurve(g, d, hem, 3.5); g.stroke();
    g.restore();
    // pauldrons: layered copper lames
    for (const [x, y] of SHOULDERS[d]) {
      for (let k = 0; k < 2; k++) {
        const yy = y - 1 + k * 3.6;
        g.fillStyle = lin(g, x - 6, yy - 4, x + 6, yy + 4, [[0, C.light], [0.5, C.base], [1, C.dark]]);
        g.beginPath(); g.ellipse(x, yy, (d === 'e' ? 8.6 : 7.6) - k, 4.6 - k * 0.6, d === 'e' ? 0.15 : (x < 28 ? -0.3 : 0.3), Math.PI, TAU); g.lineTo(x - 7, yy + 1); g.closePath(); g.fill();
      }
      g.fillStyle = A(C.patina, 0.55); g.beginPath(); circle(g, x - 2, y + 2, 1); g.fill();
      g.fillStyle = 'rgba(255,240,220,0.7)'; g.beginPath(); g.ellipse(x - 2.5, y - 3, 2.4, 0.9, -0.2, 0, TAU); g.fill();
    }
  },
  armor_iron(g, d, rand) {
    const C = { mail: '#7c8086', mailD: '#45484d', plate: '#6d7076', light: '#c4c8cd', dark: '#34363a', rivet: '#d8dbde', strap: '#3e2a1c' };
    const hem = 49.5;
    g.save(); g.beginPath(); bodyPath(g, d); g.clip();
    // mail hauberk
    g.beginPath(); above(g, d, hem, 3); g.fillStyle = C.mail; g.fill();
    g.save(); g.beginPath(); above(g, d, hem, 3); g.clip();
    g.strokeStyle = A(C.mailD, 0.8); g.lineWidth = 0.7;
    for (let row = 0, y = 10; y < hem + 3; y += 2, row++) for (let x = (row % 2) * 1.5; x < BW; x += 3) { g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, BW, BH);
    shade(g, d, 10, hem);
    g.restore();
    g.strokeStyle = C.mailD; g.lineWidth = 1.3; g.beginPath(); hemCurve(g, d, hem, 3); g.stroke();
    // breastplate
    const plate = (gg) => {
      if (d === 's') { gg.moveTo(14, 15); gg.quadraticCurveTo(28, 11, 42, 15); gg.lineTo(41, 33); gg.quadraticCurveTo(28, 40, 15, 33); gg.closePath(); }
      else if (d === 'n') { gg.moveTo(13, 15); gg.quadraticCurveTo(28, 12, 43, 15); gg.lineTo(42, 35); gg.quadraticCurveTo(28, 39, 14, 35); gg.closePath(); }
      else { gg.moveTo(24, 12); gg.quadraticCurveTo(40, 13, 43.5, 22); gg.quadraticCurveTo(44, 31, 40, 36); gg.lineTo(25, 37); gg.closePath(); }
    };
    g.beginPath(); plate(g); g.fillStyle = lin(g, 12, 12, 44, 38, [[0, C.light], [0.45, C.plate], [1, C.dark]]); g.fill();
    g.save(); g.beginPath(); plate(g); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(d === 'e' ? 34 : 21, 18, 6, 2.2, -0.3, 0, TAU); g.fill();
    if (d === 's') { g.strokeStyle = A(C.dark, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(28, 13); g.lineTo(28, 37); g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.moveTo(27, 13); g.lineTo(27, 36); g.stroke(); }
    g.fillStyle = A('#8a5634', 0.45); for (let i = 0; i < 4; i++) { g.beginPath(); circle(g, 15 + rand() * 26, 20 + rand() * 14, 0.6 + rand() * 0.5); g.fill(); }
    g.restore();
    g.strokeStyle = C.dark; g.lineWidth = 1.2; g.beginPath(); plate(g); g.stroke();
    g.fillStyle = C.rivet;
    const rv = d === 'e' ? [[27, 15], [40, 17], [42, 30], [27, 34]] : [[16, 17], [40, 17], [16.5, 31], [39.5, 31], [28, 36.5]];
    for (const [x, y] of rv) { g.beginPath(); circle(g, x, y, 0.9); g.fill(); }
    // belt
    g.strokeStyle = C.strap; g.lineWidth = 2.6; g.beginPath(); hemCurve(g, d, 40.5, 3.5); g.stroke();
    if (d !== 'n') { g.fillStyle = '#c9ccd0'; g.beginPath(); rrect(g, d === 'e' ? 36 : 25.5, d === 'e' ? 39.5 : 41.2, 5, 3.6, 0.8); g.fill(); }
    g.restore();
    // pauldrons
    for (const [x, y] of SHOULDERS[d]) {
      g.fillStyle = lin(g, x - 7, y - 6, x + 7, y + 5, [[0, C.light], [0.5, C.plate], [1, C.dark]]);
      g.beginPath(); g.ellipse(x, y, d === 'e' ? 9 : 8, 5.8, d === 'e' ? 0.15 : (x < 28 ? -0.3 : 0.3), 0, TAU); g.fill();
      g.strokeStyle = A(C.dark, 0.8); g.lineWidth = 0.9; g.beginPath(); g.ellipse(x, y + 1.6, d === 'e' ? 7.6 : 6.6, 3.2, d === 'e' ? 0.15 : (x < 28 ? -0.3 : 0.3), 0.2, Math.PI - 0.2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.ellipse(x - 2.4, y - 2.6, 2.8, 1, -0.2, 0, TAU); g.fill();
      g.fillStyle = C.rivet; g.beginPath(); circle(g, x, y - 0.5, 0.9); g.fill();
    }
  },
};

// ---------------- head wear ----------------
// flags: hides hair? (compose.js reads WEAR_HIDES_HAIR)
export const WEAR_HIDES_HAIR = { hat_straw: 'tall', hood_leather: true, helmet_copper: true, helmet_iron: true, bandana: 'tall' };

const HEAD = {
  hat_straw(g, d, rand) {
    const C = { base: '#d9b96a', light: '#f2dc98', dark: '#9a7a3a', band: '#7a3a26' };
    const straw = (x0, y0, x1, y1) => { g.strokeStyle = A(C.dark, 0.45); g.lineWidth = 0.6; for (let i = 0; i < 26; i++) { const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2 + rand() * 2, y + (rand() - 0.5)); g.stroke(); } };
    const by = HY - 8;
    if (d === 'e') {
      // brim tilted, crown
      g.fillStyle = lin(g, 0, by - 4, 0, by + 4, [[0, C.light], [1, C.dark]]);
      g.beginPath(); g.ellipse(HX + 1, by, 26, 5.4, -0.06, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.ellipse(HX + 1, by, 26, 5.4, -0.06, 0, TAU); g.clip(); straw(HX - 25, by - 5, HX + 27, by + 5); g.restore();
      g.fillStyle = lin(g, HX - 12, by - 16, HX + 12, by, [[0, C.light], [0.6, C.base], [1, C.dark]]);
      g.beginPath(); g.moveTo(HX - 12, by - 1); g.quadraticCurveTo(HX - 13, by - 15, HX - 1, by - 15.5); g.quadraticCurveTo(HX + 12, by - 15, HX + 11.5, by - 1); g.closePath(); g.fill();
      g.save(); g.beginPath(); g.moveTo(HX - 12, by - 1); g.quadraticCurveTo(HX - 13, by - 15, HX - 1, by - 15.5); g.quadraticCurveTo(HX + 12, by - 15, HX + 11.5, by - 1); g.closePath(); g.clip(); straw(HX - 12, by - 16, HX + 12, by); g.restore();
      g.fillStyle = C.band; g.fillRect(HX - 12.2, by - 4.6, 23.8, 3.4);
      return;
    }
    g.fillStyle = lin(g, 0, by - 7, 0, by + 7, [[0, C.light], [1, C.dark]]);
    g.beginPath(); g.ellipse(HX, by, 27, 7.4, 0, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.ellipse(HX, by, 27, 7.4, 0, 0, TAU); g.clip(); straw(HX - 27, by - 7, HX + 27, by + 7);
    g.strokeStyle = A(C.dark, 0.5); g.lineWidth = 0.8; g.beginPath(); g.ellipse(HX, by, 23, 5.8, 0, 0, TAU); g.stroke(); g.restore();
    const crown = (gg) => { gg.moveTo(HX - 13, by); gg.quadraticCurveTo(HX - 14, by - 16, HX, by - 16.5); gg.quadraticCurveTo(HX + 14, by - 16, HX + 13, by); gg.quadraticCurveTo(HX, by + 3, HX - 13, by); gg.closePath(); };
    g.beginPath(); crown(g); g.fillStyle = lin(g, HX - 13, by - 16, HX + 13, by, [[0, C.light], [0.55, C.base], [1, C.dark]]); g.fill();
    g.save(); g.beginPath(); crown(g); g.clip(); straw(HX - 13, by - 17, HX + 13, by + 2);
    g.fillStyle = C.band; g.beginPath(); g.moveTo(HX - 14, by - 4.5); g.quadraticCurveTo(HX, by - 2, HX + 14, by - 4.5); g.lineTo(HX + 14, by - 0.5); g.quadraticCurveTo(HX, by + 2.4, HX - 14, by - 0.5); g.closePath(); g.fill();
    g.restore();
    if (d === 's') { g.fillStyle = 'rgba(255,245,210,0.55)'; g.beginPath(); g.ellipse(HX - 5, by - 11, 4, 2, -0.3, 0, TAU); g.fill(); }
  },
  hood_leather(g, d, rand, icon) {
    const C = { base: '#86573a', light: '#c08a5a', dark: '#4a2c16', stitch: '#e0c08a', inner: '#2e1c10' };
    // short scalloped mantle over the shoulders (drawn first, under the hood)
    const mantle = (w, y) => {
      g.fillStyle = lin(g, HX - w, y - 6, HX + w, y + 8, [[0, C.light], [0.5, C.base], [1, C.dark]]);
      g.beginPath(); g.moveTo(HX - w + 2, y - 6);
      g.quadraticCurveTo(HX - w - 1, y + 2, HX - w + 1, y + 6);
      const n = 6;
      for (let i = 0; i < n; i++) { const x0 = HX - w + 1 + (i * (2 * w - 2)) / n, x1 = HX - w + 1 + ((i + 1) * (2 * w - 2)) / n; g.quadraticCurveTo((x0 + x1) / 2, y + 10, x1, y + 6); }
      g.quadraticCurveTo(HX + w + 1, y + 2, HX + w - 2, y - 6); g.closePath(); g.fill();
      g.strokeStyle = A(C.stitch, 0.7); g.lineWidth = 0.7; g.setLineDash([1.2, 1.2]);
      g.beginPath(); g.moveTo(HX - w + 3, y + 4); g.quadraticCurveTo(HX, y + 7, HX + w - 3, y + 4); g.stroke(); g.setLineDash([]);
    };
    if (d === 's' || d === 'n') mantle(20, HY + 17);
    else { g.save(); g.translate(-3, 0); mantle(17, HY + 17); g.restore(); }
    if (d === 's') {
      const outer = (gg) => { gg.moveTo(HX - 20, HY + 18); gg.bezierCurveTo(HX - 22, HY + 2, HX - 21.5, HY - 17, HX, HY - 21); gg.bezierCurveTo(HX + 21.5, HY - 17, HX + 22, HY + 2, HX + 20, HY + 18); gg.quadraticCurveTo(HX, HY + 23, HX - 20, HY + 18); gg.closePath(); };
      const face = (gg) => gg.ellipse(HX, HY + 4.5, 13.5, 14.5, 0, 0, TAU);
      g.beginPath(); outer(g); if (!icon) face(g);
      g.fillStyle = lin(g, HX - 20, HY - 20, HX + 20, HY + 22, [[0, C.light], [0.5, C.base], [1, C.dark]]); g.fill('evenodd');
      if (icon) { g.fillStyle = C.inner; g.beginPath(); face(g); g.fill(); }
      g.strokeStyle = C.dark; g.lineWidth = 1.6; g.beginPath(); g.ellipse(HX, HY + 4.5, 14.2, 15.2, 0, 0, TAU); g.stroke();
      g.strokeStyle = A(C.stitch, 0.8); g.lineWidth = 0.7; g.setLineDash([1.3, 1.3]); g.beginPath(); g.ellipse(HX, HY + 4.5, 16, 17, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.beginPath(); g.moveTo(HX, HY - 20.5); g.lineTo(HX, HY - 11); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(255,240,215,0.3)'; g.beginPath(); g.ellipse(HX - 10, HY - 12, 6, 3.5, -0.6, 0, TAU); g.fill();
      // inner rim shadow framing the face
      g.strokeStyle = 'rgba(30,16,6,0.45)'; g.lineWidth = 1.6; g.beginPath(); g.ellipse(HX, HY + 4.5, 12.6, 13.6, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else if (d === 'n') {
      const outer = (gg) => { gg.moveTo(HX - 20, HY + 18); gg.bezierCurveTo(HX - 22, HY + 2, HX - 21.5, HY - 17, HX, HY - 21); gg.bezierCurveTo(HX + 21.5, HY - 17, HX + 22, HY + 2, HX + 20, HY + 18); gg.quadraticCurveTo(HX, HY + 23, HX - 20, HY + 18); gg.closePath(); };
      g.beginPath(); outer(g); g.fillStyle = lin(g, HX - 20, HY - 20, HX + 20, HY + 22, [[0, C.light], [0.5, C.base], [1, C.dark]]); g.fill();
      g.strokeStyle = C.dark; g.lineWidth = 1.1; g.beginPath(); g.moveTo(HX, HY - 21); g.quadraticCurveTo(HX + 1.5, HY, HX, HY + 23); g.stroke();
      g.strokeStyle = A(C.stitch, 0.8); g.lineWidth = 0.7; g.setLineDash([1.3, 1.3]); g.beginPath(); g.moveTo(HX + 1.6, HY - 20); g.quadraticCurveTo(HX + 3, HY, HX + 1.6, HY + 22); g.stroke(); g.setLineDash([]);
      g.strokeStyle = A(C.dark, 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(HX - 14, HY + 14); g.quadraticCurveTo(HX - 6, HY + 18, HX - 3, HY + 22); g.moveTo(HX + 14, HY + 14); g.quadraticCurveTo(HX + 7, HY + 18, HX + 4, HY + 22); g.stroke();
      g.fillStyle = 'rgba(255,240,215,0.25)'; g.beginPath(); g.ellipse(HX - 9, HY - 11, 6, 3.6, -0.6, 0, TAU); g.fill();
      // little pointed tip at the back of the hood
      g.fillStyle = C.base; g.beginPath(); g.moveTo(HX - 4, HY - 19); g.quadraticCurveTo(HX + 1, HY - 27, HX + 7, HY - 26); g.quadraticCurveTo(HX + 4, HY - 21, HX + 5, HY - 17); g.closePath(); g.fill();
    } else {
      const outer = (gg) => { gg.moveTo(HX - 18, HY + 21); gg.bezierCurveTo(HX - 24, HY + 4, HX - 22, HY - 19, HX - 1, HY - 21.5); gg.bezierCurveTo(HX + 12, HY - 21.5, HX + 18, HY - 12, HX + 17, HY - 3); gg.quadraticCurveTo(HX + 9, HY - 2, HX + 6, HY + 6); gg.quadraticCurveTo(HX + 6, HY + 16, HX + 10, HY + 22); gg.quadraticCurveTo(HX - 4, HY + 25, HX - 18, HY + 21); gg.closePath(); };
      g.beginPath(); outer(g); g.fillStyle = lin(g, HX - 20, HY - 20, HX + 18, HY + 22, [[0, C.light], [0.5, C.base], [1, C.dark]]); g.fill();
      g.strokeStyle = C.dark; g.lineWidth = 1.6; g.beginPath(); g.moveTo(HX + 17, HY - 3); g.quadraticCurveTo(HX + 9, HY - 2, HX + 6, HY + 6); g.quadraticCurveTo(HX + 6, HY + 16, HX + 10, HY + 22); g.stroke();
      g.strokeStyle = A(C.stitch, 0.8); g.lineWidth = 0.7; g.setLineDash([1.3, 1.3]); g.beginPath(); g.moveTo(HX + 14, HY - 6); g.quadraticCurveTo(HX + 6.5, HY - 4, HX + 3.6, HY + 6); g.quadraticCurveTo(HX + 3.6, HY + 15, HX + 7, HY + 22); g.stroke(); g.setLineDash([]);
      g.strokeStyle = A(C.dark, 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(HX - 12, HY - 14); g.quadraticCurveTo(HX - 18, HY, HX - 12, HY + 18); g.stroke();
      g.fillStyle = 'rgba(255,240,215,0.25)'; g.beginPath(); g.ellipse(HX - 6, HY - 13, 6, 3.4, -0.4, 0, TAU); g.fill();
    }
  },
  helmet_copper(g, d, rand) {
    const M = { base: '#c47646', light: '#f6b984', dark: '#7a3b1c', patina: '#4ea58c', edge: '#ffd9b0' };
    const dome = (gg) => {
      if (d === 'e') { gg.moveTo(HX - 19, HY + 1); gg.bezierCurveTo(HX - 21, HY - 17, HX - 6, HY - 22.5, HX + 3, HY - 21.5); gg.bezierCurveTo(HX + 14, HY - 20, HX + 19, HY - 10, HX + 18.5, HY - 2); gg.quadraticCurveTo(HX, HY - 4, HX - 19, HY + 1); gg.closePath(); }
      else { gg.moveTo(HX - 19.5, HY); gg.bezierCurveTo(HX - 20.5, HY - 17, HX - 11, HY - 22.5, HX, HY - 22.5); gg.bezierCurveTo(HX + 11, HY - 22.5, HX + 20.5, HY - 17, HX + 19.5, HY); gg.quadraticCurveTo(HX, HY - 4.5, HX - 19.5, HY); gg.closePath(); }
    };
    // cheek guards / neck guard
    g.fillStyle = lin(g, HX - 20, HY, HX + 20, HY + 14, [[0, M.light], [0.5, M.base], [1, M.dark]]);
    if (d === 's') for (const s of [-1, 1]) { g.beginPath(); g.moveTo(HX + s * 19.5, HY - 1); g.quadraticCurveTo(HX + s * 20.5, HY + 8, HX + s * 16, HY + 14); g.lineTo(HX + s * 12.5, HY + 11); g.quadraticCurveTo(HX + s * 14.5, HY + 5, HX + s * 13.5, HY - 1); g.closePath(); g.fill(); }
    else if (d === 'n') { g.beginPath(); g.moveTo(HX - 19.5, HY - 1); g.quadraticCurveTo(HX - 20, HY + 12, HX, HY + 15); g.quadraticCurveTo(HX + 20, HY + 12, HX + 19.5, HY - 1); g.closePath(); g.fill(); }
    else { g.beginPath(); g.moveTo(HX - 19, HY); g.quadraticCurveTo(HX - 20, HY + 12, HX - 9, HY + 15); g.lineTo(HX - 4, HY + 3); g.closePath(); g.fill(); g.beginPath(); g.moveTo(HX + 10, HY - 3); g.quadraticCurveTo(HX + 14, HY + 6, HX + 10, HY + 13); g.lineTo(HX + 5, HY + 10); g.quadraticCurveTo(HX + 7, HY + 4, HX + 5, HY - 3); g.closePath(); g.fill(); }
    g.beginPath(); dome(g); g.fillStyle = lin(g, HX - 18, HY - 22, HX + 16, HY, [[0, M.light], [0.45, M.base], [1, M.dark]]); g.fill();
    g.save(); g.beginPath(); dome(g); g.clip();
    g.fillStyle = A(M.patina, 0.5); for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(HX - 16 + rand() * 32, HY - 18 + rand() * 16, 1 + rand() * 1.6, 0.8 + rand(), rand() * 3, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(255,240,220,0.6)'; g.beginPath(); g.ellipse(HX - 8, HY - 15, 6, 2.6, -0.5, 0, TAU); g.fill();
    g.restore();
    // brow band with rivets + crest ridge
    g.strokeStyle = M.dark; g.lineWidth = 2.6; g.beginPath();
    if (d === 'e') { g.moveTo(HX - 19, HY - 1); g.quadraticCurveTo(HX, HY - 5.2, HX + 18.5, HY - 3); } else { g.moveTo(HX - 19.5, HY - 1); g.quadraticCurveTo(HX, HY - 6, HX + 19.5, HY - 1); }
    g.stroke();
    g.fillStyle = M.edge; for (const x of d === 'e' ? [-12, -2, 9] : [-13, -5, 5, 13]) { g.beginPath(); circle(g, HX + x, HY - 3.2 - (d === 'e' ? 0 : Math.cos(x / 14) * 1.4), 0.9); g.fill(); }
    g.strokeStyle = M.dark; g.lineWidth = 1.6; g.beginPath();
    if (d === 'e') { g.moveTo(HX - 18, HY - 10); g.quadraticCurveTo(HX - 8, HY - 23, HX + 8, HY - 20); } else { g.moveTo(HX, HY - 22.5); g.lineTo(HX, HY - 5); }
    g.stroke();
  },
  helmet_iron(g, d, rand) {
    const M = { base: '#73767b', light: '#c6cacf', dark: '#3b3d41', mail: '#7c8086', mailD: '#45484d' };
    // mail coif around the face / neck
    const coif = (gg) => {
      if (d === 's') { gg.moveTo(HX - 20, HY - 4); gg.quadraticCurveTo(HX - 22, HY + 14, HX - 14, HY + 22); gg.quadraticCurveTo(HX, HY + 26, HX + 14, HY + 22); gg.quadraticCurveTo(HX + 22, HY + 14, HX + 20, HY - 4); gg.closePath(); gg.ellipse(HX, HY + 6, 12, 13.5, 0, 0, TAU); }
      else if (d === 'n') { gg.moveTo(HX - 20, HY - 4); gg.quadraticCurveTo(HX - 22, HY + 14, HX - 14, HY + 22); gg.quadraticCurveTo(HX, HY + 26, HX + 14, HY + 22); gg.quadraticCurveTo(HX + 22, HY + 14, HX + 20, HY - 4); gg.closePath(); }
      else { gg.moveTo(HX - 20, HY - 4); gg.quadraticCurveTo(HX - 22, HY + 14, HX - 12, HY + 22); gg.quadraticCurveTo(HX + 2, HY + 24, HX + 6, HY + 18); gg.quadraticCurveTo(HX + 3, HY + 8, HX + 8, HY - 4); gg.closePath(); }
    };
    g.beginPath(); coif(g); g.fillStyle = M.mail; g.fill('evenodd');
    g.save(); g.beginPath(); coif(g); g.clip('evenodd');
    g.strokeStyle = A(M.mailD, 0.85); g.lineWidth = 0.7;
    for (let row = 0, y = HY - 6; y < HY + 26; y += 2, row++) for (let x = HX - 23 + (row % 2) * 1.5; x < HX + 23; x += 3) { g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI); g.stroke(); }
    g.fillStyle = lin(g, 0, HY - 4, 0, HY + 24, [[0, 'rgba(255,255,255,0.15)'], [1, 'rgba(0,0,0,0.3)']]); g.fillRect(0, 0, HW, HH);
    g.restore();
    // conical helm
    const helm = (gg) => {
      if (d === 'e') { gg.moveTo(HX - 19.5, HY - 1); gg.bezierCurveTo(HX - 20, HY - 14, HX - 8, HY - 25, HX + 1, HY - 25.5); gg.bezierCurveTo(HX + 12, HY - 20, HX + 18.5, HY - 10, HX + 18.5, HY - 2.5); gg.quadraticCurveTo(HX, HY - 4.5, HX - 19.5, HY - 1); gg.closePath(); }
      else { gg.moveTo(HX - 20, HY - 1); gg.bezierCurveTo(HX - 20, HY - 14, HX - 8, HY - 25, HX, HY - 26); gg.bezierCurveTo(HX + 8, HY - 25, HX + 20, HY - 14, HX + 20, HY - 1); gg.quadraticCurveTo(HX, HY - 5, HX - 20, HY - 1); gg.closePath(); }
    };
    g.beginPath(); helm(g); g.fillStyle = lin(g, HX - 18, HY - 26, HX + 16, HY, [[0, M.light], [0.45, M.base], [1, M.dark]]); g.fill();
    g.save(); g.beginPath(); helm(g); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(HX - 7, HY - 15, 5, 2.4, -0.7, 0, TAU); g.fill();
    g.strokeStyle = A(M.dark, 0.7); g.lineWidth = 1; g.beginPath();
    if (d === 'e') { g.moveTo(HX - 16, HY - 10); g.quadraticCurveTo(HX - 6, HY - 24, HX + 1, HY - 25.5); } else { g.moveTo(HX, HY - 26); g.lineTo(HX, HY - 3); }
    g.stroke();
    g.fillStyle = A('#8a5634', 0.45); for (let i = 0; i < 4; i++) { g.beginPath(); circle(g, HX - 14 + rand() * 28, HY - 18 + rand() * 14, 0.5 + rand() * 0.5); g.fill(); }
    g.restore();
    // rim band + nasal guard
    g.strokeStyle = M.dark; g.lineWidth = 2.8; g.beginPath();
    if (d === 'e') { g.moveTo(HX - 19.5, HY - 1); g.quadraticCurveTo(HX, HY - 5.4, HX + 18.5, HY - 3); } else { g.moveTo(HX - 20, HY - 1); g.quadraticCurveTo(HX, HY - 6, HX + 20, HY - 1); }
    g.stroke();
    g.fillStyle = '#d8dbde'; for (const x of d === 'e' ? [-13, -3, 8] : [-14, -6, 6, 14]) { g.beginPath(); circle(g, HX + x, HY - 3.3 - (d === 'e' ? 0 : Math.cos(x / 14) * 1.4), 0.9); g.fill(); }
    if (d === 's') { g.fillStyle = lin(g, HX - 2, 0, HX + 2, 0, [[0, M.light], [1, M.dark]]); g.beginPath(); rrect(g, HX - 1.8, HY - 5, 3.6, 13, 1.2); g.fill(); }
    if (d === 'e') { g.fillStyle = lin(g, HX + 16, 0, HX + 20, 0, [[0, M.light], [1, M.dark]]); g.beginPath(); g.moveTo(HX + 16.5, HY - 4); g.lineTo(HX + 19.5, HY - 4); g.lineTo(HX + 19, HY + 8); g.lineTo(HX + 16.5, HY + 7); g.closePath(); g.fill(); }
  },
};

// bandit headscarf (white → tinted), knot + tails at the back
function bandana(g, d) {
  const cap = (gg) => {
    if (d === 'e') { gg.moveTo(HX - 18.5, HY + 2); gg.bezierCurveTo(HX - 21, HY - 16, HX - 6, HY - 20.5, HX + 3, HY - 20); gg.bezierCurveTo(HX + 13, HY - 18.5, HX + 18, HY - 11, HX + 17.5, HY - 5); gg.quadraticCurveTo(HX, HY - 7.5, HX - 18.5, HY + 2); gg.closePath(); }
    else { gg.moveTo(HX - 19, HY - 1); gg.bezierCurveTo(HX - 20, HY - 17, HX - 10, HY - 21, HX, HY - 21); gg.bezierCurveTo(HX + 10, HY - 21, HX + 20, HY - 17, HX + 19, HY - 1); gg.quadraticCurveTo(HX, HY - (d === 's' ? 9 : 2), HX - 19, HY - 1); gg.closePath(); }
  };
  g.beginPath(); cap(g); g.fillStyle = '#e2e2e2'; g.fill();
  g.save(); g.beginPath(); cap(g); g.clip();
  g.fillStyle = lin(g, HX - 18, HY - 20, HX + 16, HY, [[0, '#ffffff'], [1, '#b8b8b8']]); g.fillRect(0, 0, HW, HH);
  g.strokeStyle = 'rgba(90,90,90,0.4)'; g.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(HX - 16 + i * 9, HY - 18); g.quadraticCurveTo(HX - 12 + i * 9, HY - 10, HX - 14 + i * 9, HY - 3); g.stroke(); }
  // white polka dots (read on any tint)
  g.fillStyle = 'rgba(255,255,255,0.9)'; for (const [x, y] of [[-10, -12], [-2, -16], [6, -11], [13, -14], [-14, -5], [2, -6]]) { g.beginPath(); circle(g, HX + x, HY + y, 1.1); g.fill(); }
  g.restore();
  // knot & tails
  g.fillStyle = '#d0d0d0';
  if (d === 'e') { g.beginPath(); circle(g, HX - 18, HY - 4, 3.2); g.fill(); g.beginPath(); g.moveTo(HX - 19, HY - 3); g.quadraticCurveTo(HX - 26, HY + 2, HX - 27, HY + 9); g.lineTo(HX - 23, HY + 7); g.quadraticCurveTo(HX - 22, HY + 2, HX - 17, HY - 1); g.closePath(); g.fill(); g.beginPath(); g.moveTo(HX - 19, HY - 5); g.quadraticCurveTo(HX - 27, HY - 6, HX - 30, HY - 1); g.lineTo(HX - 26, HY + 1); g.quadraticCurveTo(HX - 24, HY - 3, HX - 18, HY - 3); g.closePath(); g.fill(); }
  else if (d === 'n') { g.beginPath(); circle(g, HX, HY - 2, 3.4); g.fill(); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(HX, HY - 1); g.quadraticCurveTo(HX + s * 4, HY + 6, HX + s * 7, HY + 13); g.lineTo(HX + s * 3, HY + 13); g.quadraticCurveTo(HX + s * 1.5, HY + 6, HX - s * 1, HY); g.closePath(); g.fill(); } }
  else { g.beginPath(); circle(g, HX + 17, HY - 5, 2.6); g.fill(); }
}
function faceMask(g, d) {
  const p = (gg) => {
    if (d === 's') { gg.moveTo(HX - 17.5, HY + 3); gg.quadraticCurveTo(HX, HY + 7, HX + 17.5, HY + 3); gg.quadraticCurveTo(HX + 16, HY + 16, HX, HY + 21); gg.quadraticCurveTo(HX - 16, HY + 16, HX - 17.5, HY + 3); gg.closePath(); }
    else { gg.moveTo(HX - 1, HY + 3); gg.quadraticCurveTo(HX + 9, HY + 5, HX + 17.6, HY + 4); gg.quadraticCurveTo(HX + 18, HY + 14, HX + 8, HY + 20); gg.quadraticCurveTo(HX + 1, HY + 18, HX - 1, HY + 12); gg.closePath(); }
  };
  g.beginPath(); p(g); g.fillStyle = '#dcdcdc'; g.fill();
  g.save(); g.beginPath(); p(g); g.clip();
  g.fillStyle = lin(g, 0, HY + 3, 0, HY + 21, [[0, '#ffffff'], [1, '#a8a8a8']]); g.fillRect(0, 0, HW, HH);
  g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 0.9;
  for (const k of [0.35, 0.65]) { g.beginPath(); if (d === 's') { g.moveTo(HX - 16, HY + 3 + 14 * k); g.quadraticCurveTo(HX, HY + 7 + 13 * k, HX + 16, HY + 3 + 14 * k); } else { g.moveTo(HX, HY + 4 + 13 * k); g.quadraticCurveTo(HX + 9, HY + 6 + 12 * k, HX + 17, HY + 4 + 11 * k); } g.stroke(); }
  g.restore();
}
function scar(g, d) {
  g.lineCap = 'round';
  const pts = d === 's' ? [[HX + 3.5, HY - 4], [HX + 9.5, HY + 9]] : [[HX + 6, HY - 4], [HX + 12, HY + 8]];
  g.strokeStyle = 'rgba(120,48,40,0.75)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.stroke();
  g.strokeStyle = 'rgba(255,210,200,0.5)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(pts[0][0] - 0.5, pts[0][1]); g.lineTo(pts[1][0] - 0.5, pts[1][1]); g.stroke();
  g.strokeStyle = 'rgba(120,48,40,0.6)'; g.lineWidth = 0.8;
  for (let k = 0.2; k < 1; k += 0.25) { const x = pts[0][0] + (pts[1][0] - pts[0][0]) * k, y = pts[0][1] + (pts[1][1] - pts[0][1]) * k; g.beginPath(); g.moveTo(x - 1.6, y + 0.6); g.lineTo(x + 1.6, y - 0.6); g.stroke(); }
}
function eyepatch(g, d) {
  g.strokeStyle = '#1c1612'; g.lineWidth = 1.3;
  if (d === 's') {
    g.beginPath(); g.moveTo(HX - 17.5, HY - 6); g.lineTo(HX + 17.5, HY + 7); g.stroke();
    g.fillStyle = '#211a15'; g.beginPath(); g.ellipse(HX + 6.3, HY + 3.4, 4, 3.6, 0.2, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(HX + 5.2, HY + 2.2, 1.6, 0.8, 0.2, 0, TAU); g.fill();
  } else {
    g.beginPath(); g.moveTo(HX - 6, HY - 4); g.quadraticCurveTo(HX + 2, HY - 3, HX + 9.5, HY + 2.6); g.stroke();
    g.fillStyle = '#211a15'; g.beginPath(); g.ellipse(HX + 10, HY + 2.8, 3.2, 3.6, 0.1, 0, TAU); g.fill();
  }
}

export const WEAR = { body: BODY, head: HEAD };

export function addApparel(add) {
  for (const id in BODY) for (const d of DIRS) {
    const rand = rng(id.length * 31 + d.charCodeAt(0));
    add(`wear_${id}_${d}`, spritePx(BW, BH, (g, P) => P.layer((g) => BODY[id](g, d, rand), 2.2)), 0.5, FEET / BH);
  }
  for (const id in HEAD) for (const d of DIRS) {
    const rand = rng(id.length * 37 + d.charCodeAt(0));
    add(`wear_${id}_${d}`, spritePx(HW, HH, (g, P) => P.layer((g) => HEAD[id](g, d, rand), 2.6)), 0.5, NECK / HH);
  }
  for (const d of DIRS) add('hat_bandana_' + d, spritePx(HW, HH, (g, P) => P.layer((g) => bandana(g, d), 2.4)), 0.5, NECK / HH);
  for (const d of ['s', 'e']) {
    add('face_mask_' + d, spritePx(HW, HH, (g, P) => P.layer((g) => faceMask(g, d), 2)), 0.5, NECK / HH);
    add('face_scar_' + d, spritePx(HW, HH, (g, P) => P.layer((g) => scar(g, d), 0)), 0.5, NECK / HH);
    add('face_eyepatch_' + d, spritePx(HW, HH, (g, P) => P.layer((g) => eyepatch(g, d), 0.8)), 0.5, NECK / HH);
  }
}
