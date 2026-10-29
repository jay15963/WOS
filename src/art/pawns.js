// Pawn parts (RimWorld-like): rounded torso without limbs, big round head, hair styles, beards.
// Drawn WHITE/GREY and tinted by multiplication at runtime:
//   pawn_body × shirt, pawn_legs (trousers + belt + boots) × look.pants, pawn_head / pawn_hand × skin,
//   hair / beard / brows × hair color.
// Held weapons/tools live in gear.js; apparel overlays (wear_*) and bandit extras in apparel.js.

import { spritePxFast as spritePx, rng, TAU, lin, rad, atop, circle } from './paint.js';

// Geometry contract shared with compose.js (tiles)
export const PAWN = {
  headLift: 0.56,       // head anchor (bottom of skull) height above the feet
  handS: [-0.23, 0.25], // main-hand grip offset (x, lift) when facing south (pawn's right hand = screen left)
  handN: [0.22, 0.3],
  handE: [0.1, 0.26],
  offS: [0.24, 0.27],   // off hand (shield / torch) when facing south (screen right)
  offN: [-0.22, 0.3],
  offE: [0.2, 0.29],    // off hand facing east: held forward, on the far side
};

// body/head canvas geometry (px) — shared with apparel.js so overlays match exactly
export const BW = 56, BH = 56, FEET = 53;
export const HW = 58, HH = 66, NECK = 52;
export const HX = 29, HY = 34;
export const BELT = { s: 41.5, n: 41.5, e: 41 };

// ---------------- body ----------------
export function bodyPath(g, d) {
  if (d === 'e') {
    g.moveTo(28, 9);
    g.bezierCurveTo(36, 9, 41.5, 13, 42.5, 21);
    g.bezierCurveTo(44.5, 30, 44.5, 41, 41.5, 47);
    g.bezierCurveTo(38.5, 52, 33, 53.2, 28, 53.2);
    g.bezierCurveTo(23, 53.2, 17.5, 52, 15.5, 46.5);
    g.bezierCurveTo(13.5, 39, 13.2, 28, 15.2, 20);
    g.bezierCurveTo(17, 12, 21, 9, 28, 9);
  } else {
    g.moveTo(28, 9.5);
    g.bezierCurveTo(38, 9.5, 46, 12, 48, 21);
    g.bezierCurveTo(50, 30, 50, 40, 47.5, 46);
    g.bezierCurveTo(43.5, 52, 34, 53.2, 28, 53.2);
    g.bezierCurveTo(22, 53.2, 12.5, 52, 8.5, 46);
    g.bezierCurveTo(6, 40, 6, 30, 8, 21);
    g.bezierCurveTo(10, 12, 18, 9.5, 28, 9.5);
  }
  g.closePath();
}
// region below the belt (trousers), clipped to the body silhouette by callers
export function lowerPath(g, d, y = BELT[d]) {
  if (d === 'e') { g.moveTo(8, y + 1); g.quadraticCurveTo(29, y + 3.5, 50, y); g.lineTo(50, 60); g.lineTo(8, 60); }
  else { g.moveTo(2, y); g.quadraticCurveTo(28, y + 4.5, 54, y); g.lineTo(54, 60); g.lineTo(2, 60); }
  g.closePath();
}

function body(d) {
  return spritePx(BW, BH, (g, P) => {
    P.layer((g) => {
      g.beginPath(); bodyPath(g, d);
      g.fillStyle = '#bdbdbd'; g.fill();
      g.save(); g.beginPath(); bodyPath(g, d); g.clip();
      // lit mass (cel) + soft gradient
      g.fillStyle = lin(g, 8, 10, 46, 52, [[0, '#ffffff'], [0.5, '#f0f0f0'], [1, '#d6d6d6']]);
      g.beginPath();
      if (d === 'e') g.ellipse(26.5, 27, 15, 24, 0, 0, TAU); else g.ellipse(25, 27, 21, 24.5, 0, 0, TAU);
      g.fill();
      // shoulder highlight
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath(); g.ellipse(d === 'e' ? 24 : 18, 17, d === 'e' ? 6 : 8, 4.2, -0.35, 0, TAU); g.fill();
      // sleeves: arms hanging along the sides, a crease between arm and torso, cuffs at the wrists
      g.strokeStyle = 'rgba(70,70,70,0.38)'; g.lineWidth = 1.3;
      if (d === 'e') {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.moveTo(24, 17); g.bezierCurveTo(31, 21, 33, 30, 31.5, 39); g.lineTo(26, 39.5); g.bezierCurveTo(27.5, 31, 26.5, 23, 22.5, 19); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(25.5, 17); g.bezierCurveTo(31, 22, 32.5, 31, 31, 39); g.stroke();
        g.strokeStyle = 'rgba(70,70,70,0.3)'; g.beginPath(); g.moveTo(25, 38.6); g.quadraticCurveTo(28.5, 40, 31.6, 38.4); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(24.5, 19); g.bezierCurveTo(28.5, 24, 29.5, 31, 28.2, 37); g.stroke();
        // back seam + a fold at the waist
        g.strokeStyle = 'rgba(80,80,80,0.22)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(17, 24); g.quadraticCurveTo(18.5, 31, 17.5, 38); g.stroke();
      } else {
        for (const s of [-1, 1]) {
          const x0 = 28 + s * 15;
          g.beginPath(); g.moveTo(28 + s * 14.5, 19); g.bezierCurveTo(28 + s * 12.6, 26, 28 + s * 12.2, 33, 28 + s * 13.4, 39.5); g.stroke();
          g.strokeStyle = 'rgba(70,70,70,0.3)'; g.beginPath(); g.moveTo(x0 - s * 2.4, 39.6); g.quadraticCurveTo(x0 + s * 1.2, 41, x0 + s * 4.6, 39.2); g.stroke();
          g.strokeStyle = 'rgba(70,70,70,0.38)';
        }
      }
      if (d === 's') {
        // collar with a laced V opening just under the head
        g.fillStyle = 'rgba(70,70,70,0.25)';
        g.beginPath(); g.moveTo(20, 15.5); g.quadraticCurveTo(28, 21.5, 36, 15.5); g.lineTo(36, 12); g.lineTo(20, 12); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(60,60,60,0.55)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(19, 15.5); g.quadraticCurveTo(28, 22.5, 37, 15.5); g.stroke();
        g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(28, 20.5); g.lineTo(28, 27); g.stroke();
        g.beginPath(); g.moveTo(26.6, 22); g.lineTo(29.4, 23.5); g.moveTo(29.4, 22); g.lineTo(26.6, 23.5); g.moveTo(26.8, 25); g.lineTo(29.2, 26.2); g.stroke();
        // chest folds
        g.strokeStyle = 'rgba(90,90,90,0.22)'; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(17, 30); g.quadraticCurveTo(20, 34, 19, 38); g.moveTo(39, 30); g.quadraticCurveTo(36, 34, 37, 38); g.stroke();
      } else if (d === 'n') {
        g.strokeStyle = 'rgba(80,80,80,0.28)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(28, 18); g.lineTo(28, 40); g.stroke();
        g.beginPath(); g.moveTo(17, 22); g.quadraticCurveTo(21, 27, 25, 24); g.stroke();
        g.beginPath(); g.moveTo(39, 22); g.quadraticCurveTo(35, 27, 31, 24); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(19, 14); g.quadraticCurveTo(28, 11.5, 37, 14); g.stroke();
      } else {
        g.strokeStyle = 'rgba(60,60,60,0.45)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(31, 13); g.quadraticCurveTo(36, 17, 40, 14.5); g.stroke();
        g.strokeStyle = 'rgba(90,90,90,0.25)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(37, 24); g.quadraticCurveTo(40, 30, 39, 37); g.stroke();
      }
      g.restore();
    });
  });
}

// trousers + belt + boots, overlaid on the body (tinted with look.pants)
function legs(d) {
  return spritePx(BW, BH, (g, P) => {
    P.layer((g) => {
      g.save(); g.beginPath(); bodyPath(g, d); g.clip();
      g.beginPath(); lowerPath(g, d); g.fillStyle = '#cfcfcf'; g.fill();
      g.save(); g.beginPath(); lowerPath(g, d); g.clip();
      g.fillStyle = lin(g, 0, BELT[d], 0, 54, [[0, '#ececec'], [0.6, '#cdcdcd'], [1, '#a9a9a9']]); g.fillRect(0, 0, BW, BH + 4);
      // leg split, seams and knee folds
      g.strokeStyle = 'rgba(60,60,60,0.5)'; g.lineWidth = 1.2;
      if (d === 'e') {
        g.beginPath(); g.moveTo(28, 46); g.quadraticCurveTo(29.5, 50, 28.5, 54); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(34, 46); g.quadraticCurveTo(37, 49, 37.5, 52); g.stroke();
      } else {
        g.beginPath(); g.moveTo(28, 47.5); g.lineTo(28, 54); g.stroke();
        g.strokeStyle = 'rgba(80,80,80,0.3)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(16, 46); g.quadraticCurveTo(18, 49, 17, 52); g.moveTo(40, 46); g.quadraticCurveTo(38, 49, 39, 52); g.stroke();
      }
      // boots (darker band at the bottom)
      g.fillStyle = 'rgba(40,40,40,0.55)';
      if (d === 'e') { g.beginPath(); g.moveTo(10, 50.5); g.quadraticCurveTo(29, 52.4, 48, 50.2); g.lineTo(48, 60); g.lineTo(10, 60); g.closePath(); g.fill(); }
      else { g.beginPath(); g.moveTo(4, 50.6); g.quadraticCurveTo(28, 53.2, 52, 50.6); g.lineTo(52, 60); g.lineTo(4, 60); g.closePath(); g.fill(); }
      g.restore();
      // belt band with buckle (front) / loops (back)
      const y = BELT[d];
      g.strokeStyle = '#5a5a5a'; g.lineWidth = 3;
      g.beginPath();
      if (d === 'e') { g.moveTo(8, y + 1.2); g.quadraticCurveTo(29, y + 3.7, 50, y + 0.2); }
      else { g.moveTo(2, y + 0.3); g.quadraticCurveTo(28, y + 4.8, 54, y + 0.3); }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8;
      g.beginPath();
      if (d === 'e') { g.moveTo(8, y + 0.3); g.quadraticCurveTo(29, y + 2.8, 50, y - 0.7); }
      else { g.moveTo(2, y - 0.6); g.quadraticCurveTo(28, y + 3.9, 54, y - 0.6); }
      g.stroke();
      if (d === 's') {
        g.fillStyle = '#efefef'; g.fillRect(25, y + 0.6, 6, 4.2);
        g.fillStyle = '#5a5a5a'; g.fillRect(26.6, y + 1.8, 2.8, 1.8);
        g.strokeStyle = '#333'; g.lineWidth = 0.7; g.strokeRect(25, y + 0.6, 6, 4.2);
      } else if (d === 'e') {
        g.fillStyle = '#e6e6e6'; g.fillRect(37, y + 0.2, 3.6, 3.6);
        g.fillStyle = '#7a7a7a'; g.beginPath(); g.ellipse(23, y + 4.6, 2.2, 3.2, 0.1, 0, TAU); g.fill(); // pouch
      }
      g.restore();
    }, 0);
    // crisp contour only along the visible trouser edge (outline the clipped shape)
  });
}

// ---------------- head ----------------
function head(d) {
  return spritePx(HW, HH, (g, P) => {
    P.layer((g) => {
      const skull = (gg) => {
        if (d === 'e') { gg.ellipse(HX - 1, HY, 16.8, 18, 0, 0, TAU); circle(gg, HX + 15, HY + 3.5, 3.4); gg.ellipse(HX + 9, HY + 11, 7, 5, 0.3, 0, TAU); }
        else gg.ellipse(HX, HY, 17.5, 18, 0, 0, TAU);
      };
      // ears (behind the skull)
      g.fillStyle = '#d2d2d2';
      if (d === 's' || d === 'n') { g.beginPath(); g.ellipse(HX - 17, HY + 2, 3.3, 4.6, 0, 0, TAU); g.ellipse(HX + 17, HY + 2, 3.3, 4.6, 0, 0, TAU); g.fill(); }
      g.beginPath(); skull(g); g.fillStyle = '#cfcfcf'; g.fill();
      g.save(); g.beginPath(); skull(g); g.clip();
      g.fillStyle = lin(g, HX - 16, HY - 18, HX + 14, HY + 18, [[0, '#ffffff'], [0.55, '#f1f1f1'], [1, '#dcdcdc']]);
      g.beginPath(); g.ellipse(HX - 2.2, HY - 2.5, 16.5, 17, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath(); g.ellipse(HX - 7, HY - 9, 6, 4, -0.5, 0, TAU); g.fill();
      if (d === 'n') {
        // nape shading under the hairline
        g.fillStyle = 'rgba(90,90,90,0.18)'; g.beginPath(); g.ellipse(HX, HY + 15, 12, 6, 0, 0, TAU); g.fill();
      }
      g.restore();
      if (d === 's') {
        // cheeks, eyes with lids & catchlights, nose, small mouth
        g.fillStyle = 'rgba(150,150,150,0.16)';
        g.beginPath(); g.ellipse(HX - 10.5, HY + 7.5, 3.6, 2.4, 0, 0, TAU); g.ellipse(HX + 10.5, HY + 7.5, 3.6, 2.4, 0, 0, TAU); g.fill();
        g.fillStyle = '#211a16';
        g.beginPath(); g.ellipse(HX - 6.3, HY + 3.2, 1.8, 2.35, 0, 0, TAU); g.ellipse(HX + 6.3, HY + 3.2, 1.8, 2.35, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); circle(g, HX - 6.85, HY + 2.35, 0.6); circle(g, HX + 5.75, HY + 2.35, 0.6); g.fill();
        g.strokeStyle = 'rgba(70,70,70,0.45)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(HX - 8.4, HY + 1.1); g.quadraticCurveTo(HX - 6.3, HY + 0.2, HX - 4.3, HY + 1.1); g.moveTo(HX + 4.3, HY + 1.1); g.quadraticCurveTo(HX + 6.3, HY + 0.2, HX + 8.4, HY + 1.1); g.stroke();
        g.strokeStyle = 'rgba(120,120,120,0.55)'; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(HX - 1.2, HY + 8.2); g.quadraticCurveTo(HX + 0.6, HY + 9.2, HX + 1.6, HY + 8); g.stroke();
        g.strokeStyle = 'rgba(110,110,110,0.55)'; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(HX - 2.4, HY + 11.6); g.quadraticCurveTo(HX, HY + 12.6, HX + 2.4, HY + 11.6); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(HX + 0.2, HY + 6.2, 1, 1.4, 0, 0, TAU); g.fill();
      } else if (d === 'e') {
        g.fillStyle = 'rgba(150,150,150,0.16)'; g.beginPath(); g.ellipse(HX + 6.5, HY + 8, 3.4, 2.4, 0, 0, TAU); g.fill();
        g.fillStyle = '#211a16';
        g.beginPath(); g.ellipse(HX + 9.5, HY + 2.6, 1.65, 2.35, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); circle(g, HX + 9.05, HY + 1.75, 0.55); g.fill();
        g.strokeStyle = 'rgba(70,70,70,0.45)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(HX + 7.6, HY + 0.6); g.quadraticCurveTo(HX + 9.6, HY - 0.2, HX + 11.4, HY + 0.8); g.stroke();
        g.strokeStyle = 'rgba(110,110,110,0.5)'; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(HX + 12.6, HY + 12.2); g.quadraticCurveTo(HX + 14.2, HY + 12.8, HX + 15.2, HY + 12); g.stroke();
        // ear
        g.fillStyle = '#d6d6d6'; g.beginPath(); g.ellipse(HX - 3, HY + 3, 3.4, 4.6, 0.15, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(110,110,110,0.6)'; g.lineWidth = 1.1;
        g.beginPath(); g.ellipse(HX - 3, HY + 3, 3.4, 4.6, 0.15, 0, TAU); g.stroke();
        g.beginPath(); g.arc(HX - 2.6, HY + 3.4, 1.6, -1.2, 1.6); g.stroke();
      }
      // jaw shade
      atop(g, () => {
        g.fillStyle = lin(g, 0, HY + 6, 0, HY + 19, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(60,60,60,0.22)']]);
        g.fillRect(0, 0, HW, HH);
      });
    });
  });
}

// brows (tinted with the hair color, drawn even when bald)
function brows(d) {
  return spritePx(HW, HH, (g, P) => {
    P.layer((g) => {
      g.strokeStyle = '#d0d0d0'; g.lineCap = 'round'; g.lineWidth = 1.9;
      g.beginPath();
      if (d === 's') { g.moveTo(HX - 9, HY - 1.2); g.quadraticCurveTo(HX - 6.5, HY - 2.6, HX - 4, HY - 1.6); g.moveTo(HX + 4, HY - 1.6); g.quadraticCurveTo(HX + 6.5, HY - 2.6, HX + 9, HY - 1.2); }
      else { g.moveTo(HX + 7.4, HY - 1.6); g.quadraticCurveTo(HX + 9.8, HY - 2.8, HX + 12, HY - 1.6); }
      g.stroke();
    }, 0.9, 'rgba(30,26,22,0.85)');
  });
}

// ---------------- hair ----------------
const ang = (a) => [HX + Math.cos(a) * 19.2, HY + Math.sin(a) * 19.6];
// outer skull-hugging arc from angle a0 to a1 (radians, canvas convention) with extra puff k
function capArc(g, a0, a1, k = 1, move = true) {
  g[move ? 'moveTo' : 'lineTo'](HX + Math.cos(a0) * 19.2 * k, HY + Math.sin(a0) * 19.6 * k);
  g.ellipse(HX, HY - (k - 1) * 4, 19.2 * k, 19.6 * k, 0, a0, a1);
}

const HAIR = {
  short: {
    s(g) { capArc(g, Math.PI * 0.95, Math.PI * 2.05); g.lineTo(HX + 17.5, HY + 0.5); g.lineTo(HX + 15, HY - 7); g.lineTo(HX + 9, HY - 9.5); g.lineTo(HX + 5, HY - 7); g.lineTo(HX - 1, HY - 10); g.lineTo(HX - 6, HY - 7.5); g.lineTo(HX - 11, HY - 9); g.lineTo(HX - 15.5, HY - 5); g.lineTo(HX - 17.6, HY + 0.5); g.closePath(); },
    n(g) { capArc(g, Math.PI * 0.78, Math.PI * 2.22); g.quadraticCurveTo(HX + 6, HY + 18, HX, HY + 16.5); g.quadraticCurveTo(HX - 6, HY + 18, HX - 15, HY + 12.5); g.closePath(); },
    e(g) { capArc(g, Math.PI * 0.72, Math.PI * 1.86); g.lineTo(HX + 12.5, HY - 9); g.lineTo(HX + 6, HY - 6.5); g.lineTo(HX + 2, HY - 7.5); g.quadraticCurveTo(HX - 1, HY - 2, HX - 1, HY + 4); g.quadraticCurveTo(HX - 6, HY + 8, HX - 7, HY + 14); g.closePath(); },
    crown: { s: [HX - 2, HY - 16], n: [HX, HY - 8], e: [HX - 4, HY - 14] },
  },
  long: {
    s(g) { g.moveTo(HX - 21, HY + 27); g.bezierCurveTo(HX - 23, HY + 10, HX - 23, HY - 4, HX - 19, HY - 10); capArc(g, Math.PI * 1.14, Math.PI * 1.86, 1.02, false); g.bezierCurveTo(HX + 23, HY - 4, HX + 23, HY + 10, HX + 21, HY + 27); g.lineTo(HX + 17, HY + 29); g.lineTo(HX + 14, HY + 25); g.quadraticCurveTo(HX + 16, HY + 10, HX + 15.5, HY - 2); g.quadraticCurveTo(HX + 10, HY - 10, HX + 3, HY - 10.5); g.quadraticCurveTo(HX, HY - 6, HX - 4, HY - 9.5); g.quadraticCurveTo(HX - 12, HY - 8, HX - 15.5, HY - 2); g.quadraticCurveTo(HX - 16, HY + 10, HX - 14, HY + 25); g.lineTo(HX - 17, HY + 29); g.closePath(); },
    n(g) { g.moveTo(HX - 21, HY + 26); g.bezierCurveTo(HX - 23, HY + 10, HX - 23, HY - 4, HX - 19, HY - 10); capArc(g, Math.PI * 1.14, Math.PI * 1.86, 1.02, false); g.bezierCurveTo(HX + 23, HY - 4, HX + 23, HY + 10, HX + 21, HY + 26); g.lineTo(HX + 15, HY + 30); g.lineTo(HX + 8, HY + 28); g.lineTo(HX, HY + 31); g.lineTo(HX - 8, HY + 28); g.lineTo(HX - 15, HY + 30); g.closePath(); },
    e(g) { capArc(g, Math.PI * 0.9, Math.PI * 1.86, 1.02); g.lineTo(HX + 12.5, HY - 9); g.lineTo(HX + 6, HY - 6.5); g.lineTo(HX + 2, HY - 7.5); g.quadraticCurveTo(HX - 1, HY - 2, HX - 2, HY + 6); g.quadraticCurveTo(HX - 3, HY + 18, HX - 6, HY + 27); g.lineTo(HX - 11, HY + 30); g.lineTo(HX - 15, HY + 27); g.lineTo(HX - 19, HY + 28); g.bezierCurveTo(HX - 22, HY + 16, HX - 22, HY + 6, HX - 20, HY - 1); g.closePath(); },
    crown: { s: [HX - 2, HY - 16], n: [HX, HY - 6], e: [HX - 4, HY - 14] },
  },
  bun: {
    s(g) { capArc(g, Math.PI * 0.97, Math.PI * 2.03); g.quadraticCurveTo(HX + 14, HY - 9, HX, HY - 11); g.quadraticCurveTo(HX - 14, HY - 9, HX - 18.6, HY + 1); g.closePath(); circle(g, HX + 1, HY - 21, 7.5); },
    n(g) { capArc(g, Math.PI * 0.8, Math.PI * 2.2); g.quadraticCurveTo(HX + 6, HY + 17, HX, HY + 15.5); g.quadraticCurveTo(HX - 6, HY + 17, HX - 14.5, HY + 11.5); g.closePath(); circle(g, HX, HY - 13, 8.5); },
    e(g) { capArc(g, Math.PI * 0.72, Math.PI * 1.86); g.lineTo(HX + 12.5, HY - 9); g.quadraticCurveTo(HX + 4, HY - 9, HX + 1, HY - 6); g.quadraticCurveTo(HX - 1, HY, HX - 1, HY + 4); g.quadraticCurveTo(HX - 6, HY + 8, HX - 7, HY + 14); g.closePath(); circle(g, HX - 13, HY - 15, 7.8); },
    crown: { s: [HX, HY - 14], n: [HX, HY - 12], e: [HX - 8, HY - 12] },
    extra(g, d) { // bun ring
      g.strokeStyle = 'rgba(90,90,90,0.5)'; g.lineWidth = 1.1;
      const [x, y, r] = d === 's' ? [HX + 1, HY - 21, 7.5] : d === 'n' ? [HX, HY - 13, 8.5] : [HX - 13, HY - 15, 7.8];
      g.beginPath(); g.arc(x, y, r * 0.55, 0.3, 4.5); g.stroke();
      g.beginPath(); g.arc(x, y + r * 0.85, r * 0.6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    },
  },
  mohawk: {
    s(g) { g.moveTo(HX - 6, HY - 9); g.lineTo(HX - 8, HY - 18); g.lineTo(HX - 6, HY - 27); g.lineTo(HX - 2.5, HY - 31); g.lineTo(HX + 1, HY - 33); g.lineTo(HX + 4, HY - 30); g.lineTo(HX + 7.5, HY - 26); g.lineTo(HX + 8.5, HY - 18); g.lineTo(HX + 6, HY - 9); g.quadraticCurveTo(HX, HY - 11, HX - 6, HY - 9); g.closePath(); },
    n(g) { g.moveTo(HX - 6, HY + 14); g.lineTo(HX - 7, HY - 12); g.lineTo(HX - 6, HY - 25); g.lineTo(HX - 2, HY - 30); g.lineTo(HX + 2, HY - 32); g.lineTo(HX + 6, HY - 27); g.lineTo(HX + 7.5, HY - 12); g.lineTo(HX + 6, HY + 14); g.quadraticCurveTo(HX, HY + 16, HX - 6, HY + 14); g.closePath(); },
    e(g) { g.moveTo(HX + 12, HY - 12); g.lineTo(HX + 14, HY - 21); g.lineTo(HX + 7, HY - 18); g.lineTo(HX + 6, HY - 29); g.lineTo(HX - 1, HY - 22); g.lineTo(HX - 5, HY - 31); g.lineTo(HX - 9, HY - 22); g.lineTo(HX - 16, HY - 27); g.lineTo(HX - 16, HY - 16); g.lineTo(HX - 23, HY - 16); g.lineTo(HX - 19, HY - 6); g.quadraticCurveTo(HX - 2, HY - 20, HX + 12, HY - 12); g.closePath(); },
    crown: { s: [HX, HY - 30], n: [HX, HY - 20], e: [HX - 4, HY - 24] },
    stubble: true,
  },
  ponytail: {
    s(g) { capArc(g, Math.PI * 0.96, Math.PI * 2.04); g.lineTo(HX + 17.8, HY + 0.5); g.quadraticCurveTo(HX + 14, HY - 9, HX + 4, HY - 11); g.quadraticCurveTo(HX - 6, HY - 12, HX - 12, HY - 5); g.quadraticCurveTo(HX - 16, HY - 2, HX - 17.8, HY + 0.5); g.closePath(); g.moveTo(HX + 15, HY + 10); g.quadraticCurveTo(HX + 23, HY + 16, HX + 20, HY + 28); g.quadraticCurveTo(HX + 17, HY + 22, HX + 14, HY + 18); g.closePath(); },
    n(g) { capArc(g, Math.PI * 0.8, Math.PI * 2.2); g.quadraticCurveTo(HX + 6, HY + 17, HX, HY + 15.5); g.quadraticCurveTo(HX - 6, HY + 17, HX - 14.5, HY + 11.5); g.closePath(); g.moveTo(HX - 4, HY + 2); g.quadraticCurveTo(HX - 7, HY + 16, HX - 3, HY + 30); g.quadraticCurveTo(HX + 1, HY + 33, HX + 4, HY + 29); g.quadraticCurveTo(HX + 7, HY + 16, HX + 4, HY + 2); g.closePath(); },
    e(g) { capArc(g, Math.PI * 0.72, Math.PI * 1.86); g.lineTo(HX + 12.5, HY - 9); g.quadraticCurveTo(HX + 4, HY - 9, HX + 1, HY - 6); g.quadraticCurveTo(HX - 1, HY, HX - 1, HY + 4); g.quadraticCurveTo(HX - 6, HY + 8, HX - 7, HY + 14); g.closePath(); g.moveTo(HX - 15, HY - 6); g.bezierCurveTo(HX - 27, HY - 2, HX - 26, HY + 14, HX - 21, HY + 26); g.quadraticCurveTo(HX - 18, HY + 22, HX - 18, HY + 14); g.quadraticCurveTo(HX - 17, HY + 4, HX - 12, HY + 1); g.closePath(); },
    crown: { s: [HX + 2, HY - 16], n: [HX, HY - 6], e: [HX - 6, HY - 12] },
    extra(g, d) { // hair tie
      g.fillStyle = 'rgba(70,70,70,0.7)';
      if (d === 'n') { g.fillStyle = 'rgba(60,60,60,0.5)'; g.beginPath(); g.ellipse(HX, HY + 5, 4.2, 1.2, 0, 0, TAU); g.fill(); }
      if (d === 'e') { g.beginPath(); g.ellipse(HX - 17, HY - 1, 2.2, 4, 0.6, 0, TAU); g.fill(); }
    },
  },
  curly: {
    s(g) { for (const [a, r] of [[0.95, 6], [1.1, 7], [1.25, 7.5], [1.4, 8], [1.55, 8], [1.7, 7.5], [1.85, 7], [2.02, 6]]) { const [x, y] = ang(Math.PI * a); circle(g, x, y - 1.5, r); } g.moveTo(HX - 17, HY - 2); g.quadraticCurveTo(HX, HY - 14, HX + 17, HY - 2); g.lineTo(HX + 17, HY - 14); g.lineTo(HX - 17, HY - 14); g.closePath(); },
    n(g) { for (const [a, r] of [[0.75, 6.5], [0.92, 7], [1.1, 7.5], [1.3, 8], [1.5, 8.5], [1.7, 8], [1.9, 7.5], [2.08, 7], [2.25, 6.5]]) { const [x, y] = ang(Math.PI * a); circle(g, x, y - 1, r); } g.ellipse(HX, HY - 2, 18.5, 17, 0, 0, TAU); },
    e(g) { for (const [a, r] of [[0.7, 6.5], [0.88, 7], [1.05, 7.5], [1.25, 8], [1.45, 8], [1.65, 7.5], [1.82, 6]]) { const [x, y] = ang(Math.PI * a); circle(g, x, y - 1, r); } g.moveTo(HX + 13, HY - 12); g.quadraticCurveTo(HX + 2, HY - 6, HX - 2, HY + 3); g.quadraticCurveTo(HX - 7, HY + 9, HX - 9, HY + 16); g.lineTo(HX - 20, HY + 10); g.lineTo(HX - 14, HY - 16); g.closePath(); },
    crown: { s: [HX, HY - 18], n: [HX, HY - 8], e: [HX - 4, HY - 14] },
    curls: true,
  },
  // shaggy, swept fringe — scruffy wanderer / bandit look
  shaggy: {
    s(g) { capArc(g, Math.PI * 0.92, Math.PI * 2.08, 1.04); g.lineTo(HX + 19, HY + 6); g.lineTo(HX + 16, HY + 2); g.lineTo(HX + 15, HY - 5); g.lineTo(HX + 9, HY - 4); g.lineTo(HX + 6, HY - 9); g.lineTo(HX + 1, HY - 5); g.lineTo(HX - 3, HY - 10); g.lineTo(HX - 8, HY - 4.5); g.lineTo(HX - 12, HY - 8); g.lineTo(HX - 15, HY - 2); g.lineTo(HX - 16.5, HY + 3); g.lineTo(HX - 19.5, HY + 7); g.closePath(); },
    n(g) { capArc(g, Math.PI * 0.75, Math.PI * 2.25, 1.04); g.lineTo(HX + 15, HY + 17); g.lineTo(HX + 9, HY + 15); g.lineTo(HX + 5, HY + 19); g.lineTo(HX, HY + 16); g.lineTo(HX - 5, HY + 19); g.lineTo(HX - 9, HY + 15); g.lineTo(HX - 15, HY + 17); g.closePath(); },
    e(g) { capArc(g, Math.PI * 0.7, Math.PI * 1.9, 1.04); g.lineTo(HX + 14, HY - 6); g.lineTo(HX + 9, HY - 6); g.lineTo(HX + 7, HY - 2); g.lineTo(HX + 3, HY - 6); g.quadraticCurveTo(HX - 1, HY - 1, HX - 1, HY + 4); g.quadraticCurveTo(HX - 5, HY + 9, HX - 6, HY + 17); g.lineTo(HX - 10, HY + 14); g.lineTo(HX - 13, HY + 19); g.lineTo(HX - 15, HY + 13); g.closePath(); },
    crown: { s: [HX - 4, HY - 16], n: [HX, HY - 8], e: [HX - 6, HY - 14] },
  },
  // tight braids hanging at the back
  braid: {
    s(g) { HAIR.short.s(g); for (const s of [-1, 1]) { g.moveTo(HX + s * 16, HY + 2); g.quadraticCurveTo(HX + s * 21, HY + 12, HX + s * 18, HY + 26); g.lineTo(HX + s * 15.5, HY + 25); g.quadraticCurveTo(HX + s * 17, HY + 12, HX + s * 13.5, HY + 5); g.closePath(); } },
    n(g) { HAIR.short.n(g); g.moveTo(HX - 3.5, HY + 10); g.quadraticCurveTo(HX - 5, HY + 22, HX - 2, HY + 33); g.lineTo(HX + 2, HY + 33); g.quadraticCurveTo(HX + 5, HY + 22, HX + 3.5, HY + 10); g.closePath(); },
    e(g) { HAIR.short.e(g); g.moveTo(HX - 14, HY + 6); g.quadraticCurveTo(HX - 20, HY + 16, HX - 17, HY + 30); g.lineTo(HX - 13.5, HY + 29); g.quadraticCurveTo(HX - 15, HY + 17, HX - 10, HY + 9); g.closePath(); },
    crown: { s: [HX - 2, HY - 16], n: [HX, HY - 8], e: [HX - 4, HY - 14] },
    extra(g, d) { // braid segments
      g.strokeStyle = 'rgba(70,70,70,0.55)'; g.lineWidth = 0.9;
      const seg = (x, y0, y1, w) => { for (let y = y0; y < y1; y += 3) { g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y + 2, x + w, y); g.stroke(); } };
      if (d === 's') { seg(HX - 17.5, HY + 10, HY + 25, 2); seg(HX + 17.5, HY + 10, HY + 25, 2); }
      else if (d === 'n') seg(HX, HY + 14, HY + 32, 2.6);
      else seg(HX - 16, HY + 12, HY + 29, 2.2);
    },
  },
};

function hair(style, d) {
  const H = HAIR[style];
  return spritePx(HW, HH, (g, P) => {
    const rand = rng(style.length * 100 + d.charCodeAt(0));
    if (H.stubble && d !== 'n') {
      // shaved sides: faint layer, no outline
      P.layer((g) => {
        g.globalAlpha = 0.3;
        g.beginPath(); HAIR.short[d](g); g.fillStyle = '#8a8a8a'; g.fill();
      }, 0);
    }
    P.layer((g) => {
      const path = (gg) => H[d](gg);
      g.beginPath(); path(g); g.fillStyle = '#d9d9d9'; g.fill();
      g.save(); g.beginPath(); path(g); g.clip();
      const [cx, cy] = H.crown[d];
      g.fillStyle = rad(g, cx - 4, cy - 2, 2, 34, [[0, '#ffffff'], [0.45, '#e9e9e9'], [1, '#a9a9a9']]);
      g.fillRect(0, 0, HW, HH);
      // darker underside where hair meets the head (depth)
      g.fillStyle = lin(g, 0, HY - 4, 0, HY + 30, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(60,60,60,0.32)']]);
      g.fillRect(0, HY - 4, HW, 40);
      // strand clumps radiating from the crown (dark grooves + light tips)
      const n = H.curls ? 0 : 20;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, r0 = 3 + rand() * 6, r1 = 16 + rand() * 22;
        const bend = (rand() - 0.5) * 0.5;
        g.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(80,80,80,0.42)';
        g.lineWidth = i % 3 === 0 ? 0.8 : 0.95;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.quadraticCurveTo(cx + Math.cos(a + bend) * (r0 + r1) * 0.55, cy + Math.sin(a + bend) * (r0 + r1) * 0.55, cx + Math.cos(a + bend * 1.5) * r1, cy + Math.sin(a + bend * 1.5) * r1);
        g.stroke();
      }
      if (H.curls) {
        for (let i = 0; i < 30; i++) {
          const x = HX + (rand() - 0.5) * 42, y = HY - 22 + rand() * (d === 'n' ? 36 : 22);
          g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, 2 + rand() * 2, 0.2, 2.6); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.6)';
          g.beginPath(); g.arc(x - 0.6, y - 0.6, 1.5 + rand(), 3.5, 5.2); g.stroke();
        }
      }
      // glossy sheen band
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx + 1, cy + 8, 11, Math.PI * 1.12, Math.PI * 1.42); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(cx + 1, cy + 8, 14, Math.PI * 1.15, Math.PI * 1.35); g.stroke();
      if (H.extra) H.extra(g, d);
      g.restore();
    });
  });
}

function beard(d) {
  return spritePx(HW, HH, (g, P) => {
    P.layer((g) => {
      const path = (gg) => {
        if (d === 's') {
          gg.moveTo(HX - 17, HY + 1);
          gg.quadraticCurveTo(HX - 17, HY + 17, HX - 7, HY + 22);
          gg.quadraticCurveTo(HX, HY + 25.5, HX + 7, HY + 22);
          gg.quadraticCurveTo(HX + 17, HY + 17, HX + 17, HY + 1);
          gg.lineTo(HX + 13.5, HY + 6);
          gg.quadraticCurveTo(HX + 9, HY + 9, HX + 4.5, HY + 9.5);
          gg.quadraticCurveTo(HX, HY + 8, HX - 4.5, HY + 9.5);
          gg.quadraticCurveTo(HX - 9, HY + 9, HX - 13.5, HY + 6);
          gg.closePath();
          // mouth opening
          gg.moveTo(HX - 4, HY + 12.6); gg.quadraticCurveTo(HX, HY + 14.6, HX + 4, HY + 12.6); gg.quadraticCurveTo(HX, HY + 12, HX - 4, HY + 12.6); gg.closePath();
        } else {
          gg.moveTo(HX - 2, HY + 4);
          gg.quadraticCurveTo(HX - 1, HY + 16, HX + 4, HY + 21);
          gg.quadraticCurveTo(HX + 12, HY + 24, HX + 16.5, HY + 15);
          gg.lineTo(HX + 17, HY + 9.5);
          gg.quadraticCurveTo(HX + 13, HY + 9, HX + 10, HY + 10);
          gg.quadraticCurveTo(HX + 6, HY + 8, HX + 3, HY + 4);
          gg.closePath();
        }
      };
      g.beginPath(); path(g); g.fillStyle = '#d6d6d6'; g.fill('evenodd');
      g.save(); g.beginPath(); path(g); g.clip('evenodd');
      g.fillStyle = lin(g, HX - 12, HY + 4, HX + 12, HY + 24, [[0, '#f6f6f6'], [1, '#a4a4a4']]);
      g.fillRect(0, 0, HW, HH);
      g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 0.9;
      const rand = rng(77 + d.charCodeAt(0));
      for (let i = 0; i < 18; i++) {
        const x = HX + (rand() - 0.5) * 28, y = HY + 8 + rand() * 14;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 2, y + 3 + rand() * 3); g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.8;
      for (let i = 0; i < 6; i++) { const x = HX + (rand() - 0.5) * 22, y = HY + 10 + rand() * 9; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.5, y + 3); g.stroke(); }
      g.restore();
    }, 2.6);
  });
}

// mitten hand (tinted with skin) for punches, pushes, picking and bow draws
function hand() {
  return spritePx(14, 14, (g, P) => {
    P.layer((g) => {
      g.fillStyle = '#d6d6d6'; g.beginPath(); g.ellipse(7, 7, 4.3, 3.9, 0, 0, TAU); g.fill();
      g.fillStyle = lin(g, 3, 3, 11, 11, [[0, '#ffffff'], [1, '#c8c8c8']]); g.beginPath(); g.ellipse(6.6, 6.6, 3.6, 3.2, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(90,90,90,0.5)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(5, 4.4); g.lineTo(5.4, 7); g.moveTo(7.4, 4.1); g.lineTo(7.6, 6.8); g.stroke();
    }, 2.2);
  });
}

// ---------------- animation parts (compose.js rig) ----------------
// boot (tinted dark leather at runtime): 's' = toe seen from the front, 'e' = profile, toe to the right
function foot(d) {
  return spritePx(18, 12, (g, P) => {
    P.layer((g) => {
      g.fillStyle = '#cfcfcf';
      g.beginPath();
      if (d === 'e') { g.moveTo(3, 9.5); g.lineTo(3, 3.5); g.quadraticCurveTo(4, 1.6, 7.5, 1.8); g.lineTo(10, 3.6); g.quadraticCurveTo(15.6, 4.6, 15.4, 8); g.lineTo(15.2, 9.6); g.closePath(); }
      else g.ellipse(9, 6.2, 5.2, 4.4, 0, 0, TAU);
      g.fill();
      g.fillStyle = lin(g, 0, 2, 0, 10, [[0, '#ffffff'], [1, '#a8a8a8']]);
      g.beginPath();
      if (d === 'e') g.ellipse(9, 5.4, 5.4, 2.6, 0.1, 0, TAU); else g.ellipse(8.4, 5.4, 4, 3.2, 0, 0, TAU);
      g.fill();
      // sole
      g.fillStyle = 'rgba(40,40,40,0.75)';
      if (d === 'e') g.fillRect(3, 8.6, 12.4, 1.2); else { g.beginPath(); g.ellipse(9, 9.6, 4.6, 1.1, 0, 0, TAU); g.fill(); }
    }, 1.4);
  });
}
// closed eyelids (tinted with skin) over the head's eyes: blinks and sleep
function lids(d) {
  return spritePx(HW, HH, (g, P) => {
    P.layer((g) => {
      const lid = (x, y) => {
        g.fillStyle = '#e4e4e4'; g.beginPath(); g.ellipse(x, y, 2.35, 2.8, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(40,30,26,0.9)'; g.lineWidth = 0.9; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - 2, y + 0.6); g.quadraticCurveTo(x, y + 1.9, x + 2, y + 0.6); g.stroke();
      };
      if (d === 's') { lid(HX - 6.3, HY + 3.2); lid(HX + 6.3, HY + 3.2); } else lid(HX + 9.4, HY + 2.6);
    }, 0);
  });
}
// blanket lump over a sleeping pawn (tinted like the bed quilt)
function cover() {
  return spritePx(56, 60, (g, P) => {
    P.layer((g) => {
      g.fillStyle = '#c4c4c4';
      g.beginPath(); g.moveTo(5, 10); g.quadraticCurveTo(28, 2, 51, 10); g.quadraticCurveTo(55, 34, 52, 56); g.lineTo(4, 56); g.quadraticCurveTo(1, 34, 5, 10); g.closePath(); g.fill();
      g.fillStyle = lin(g, 8, 6, 48, 58, [[0, '#ffffff'], [0.5, '#e2e2e2'], [1, '#a9a9a9']]);
      g.beginPath(); g.ellipse(27, 28, 21, 24, 0, 0, TAU); g.fill();
      // folded hem near the chin and two soft folds
      g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(5, 10); g.quadraticCurveTo(28, 2, 51, 10); g.lineTo(51, 16); g.quadraticCurveTo(28, 8, 5, 16); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(70,70,70,0.35)'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(12, 30); g.quadraticCurveTo(20, 36, 17, 50); g.moveTo(42, 28); g.quadraticCurveTo(35, 38, 39, 52); g.stroke();
    }, 2.2);
  });
}
// "Z" glyph for sleep particles
function zz() {
  return spritePx(14, 14, (g, P) => {
    P.layer((g) => {
      g.strokeStyle = '#ffffff'; g.lineWidth = 2.4; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath(); g.moveTo(3, 3); g.lineTo(11, 3); g.lineTo(3, 11); g.lineTo(11, 11); g.stroke();
    }, 1.1, 'rgba(30,40,60,0.7)');
  });
}
// a pinch of crushed medicinal herbs (held while healing)
function herb() {
  return spritePx(14, 12, (g, P) => {
    P.layer((g) => {
      for (const [x, y, r, c] of [[5, 7, 3.4, '#4f8a3a'], [9, 6, 3.2, '#6aa64a'], [7, 4, 2.8, '#83bd5c'], [10, 8.5, 2.2, '#3e7430']]) {
        g.fillStyle = c; g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0.6, 0, TAU); g.fill();
      }
      g.fillStyle = '#b8e08a'; g.beginPath(); circle(g, 6.5, 3.6, 0.9); circle(g, 9.5, 5.2, 0.7); g.fill();
    }, 1.2);
  });
}

// thigh seen from the side (sitting): trouser capsule, tinted with look.pants; anchor at the hip end
function thigh() {
  return spritePx(26, 13, (g, P) => {
    P.layer((g) => {
      g.fillStyle = '#c8c8c8'; g.beginPath(); g.moveTo(5, 2.5); g.lineTo(20, 2.5); g.quadraticCurveTo(25, 6.5, 20, 10.5); g.lineTo(5, 10.5); g.quadraticCurveTo(1, 6.5, 5, 2.5); g.closePath(); g.fill();
      g.fillStyle = lin(g, 0, 2, 0, 11, [[0, '#f2f2f2'], [1, '#b2b2b2']]); g.beginPath(); g.ellipse(13, 5.8, 10, 3, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(70,70,70,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(17, 4); g.quadraticCurveTo(19, 6.5, 17.5, 9.5); g.stroke();
    }, 1.6);
  });
}

export function addPawns(add) {
  for (const d of ['s', 'n', 'e']) {
    add('pawn_body_' + d, body(d), 0.5, FEET / BH);
    add('pawn_legs_' + d, legs(d), 0.5, FEET / BH);
    add('pawn_head_' + d, head(d), 0.5, NECK / HH);
    if (d !== 'n') add('brows_' + d, brows(d), 0.5, NECK / HH);
    for (const st of Object.keys(HAIR)) add(`hair_${st}_${d}`, hair(st, d), 0.5, NECK / HH);
  }
  add('beard_s', beard('s'), 0.5, NECK / HH);
  add('beard_e', beard('e'), 0.5, NECK / HH);
  add('pawn_hand', hand(), 0.5, 0.5);
  add('pawn_foot_s', foot('s'), 0.5, 10.4 / 12);
  add('pawn_foot_e', foot('e'), 0.5, 10.4 / 12);
  add('pawn_lids_s', lids('s'), 0.5, NECK / HH);
  add('pawn_lids_e', lids('e'), 0.5, NECK / HH);
  add('pawn_cover', cover(), 0.5, 8 / 60); // anchor at the hem (chin)
  add('pawn_zz', zz(), 0.5, 0.5);
  add('pawn_herb', herb(), 0.5, 0.5);
  add('pawn_thigh_e', thigh(), 3 / 26, 0.5);
}
export const HAIR_STYLES = Object.keys(HAIR);
