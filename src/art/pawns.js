// Pawn parts (RimWorld-like): rounded torso without limbs, big round head, hair styles, beards.
// Drawn WHITE/GREY and tinted by multiplication at runtime: body × shirt, head × skin, hair/beard × hair color.
// Weapons/tools are colored, pointing UP, anchored at the grip (grip centered horizontally so flips mirror).

import { spritePx, rng, TAU, lin, rad, atop, circle } from './paint.js';

// Geometry contract shared with compose.js (tiles)
export const PAWN = {
  headLift: 0.56,      // head anchor (bottom of skull) height above the feet
  handS: [-0.23, 0.25], // weapon grip offset (x, lift) when facing south (pawn's right hand = screen left)
  handN: [0.22, 0.3],
  handE: [0.1, 0.26],
};

const BW = 56, BH = 56, FEET = 53;   // body canvas (px)
const HW = 58, HH = 66, NECK = 52;   // head/hair canvas (px); skull center (29,34) r≈18
const HX = 29, HY = 34;

// ---------------- body ----------------
function bodyPath(g, d) {
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
      // hem / belt
      g.strokeStyle = 'rgba(70,70,70,0.42)'; g.lineWidth = 1.6;
      g.beginPath();
      if (d === 'e') { g.moveTo(14, 41.5); g.quadraticCurveTo(29, 44.5, 45, 41); }
      else { g.moveTo(6, 41); g.quadraticCurveTo(28, 45.5, 50, 41); }
      g.stroke();
      g.fillStyle = 'rgba(60,60,60,0.16)';
      g.beginPath();
      if (d === 'e') { g.moveTo(10, 42.5); g.quadraticCurveTo(29, 45.5, 48, 42); g.lineTo(48, 56); g.lineTo(10, 56); }
      else { g.moveTo(4, 42); g.quadraticCurveTo(28, 46.5, 52, 42); g.lineTo(52, 56); g.lineTo(4, 56); }
      g.closePath(); g.fill();
      // arm hints
      g.strokeStyle = 'rgba(80,80,80,0.32)'; g.lineWidth = 1.3;
      if (d === 'e') {
        g.beginPath(); g.moveTo(26, 17); g.bezierCurveTo(31, 22, 32, 31, 30, 38); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(24.5, 19); g.bezierCurveTo(28.5, 24, 29.5, 31, 28.2, 37); g.stroke();
      } else {
        g.beginPath(); g.moveTo(13, 19); g.bezierCurveTo(15, 26, 15.5, 33, 14.5, 39); g.stroke();
        g.beginPath(); g.moveTo(43, 19); g.bezierCurveTo(41, 26, 40.5, 33, 41.5, 39); g.stroke();
      }
      if (d === 's') {
        // collar just under the head
        g.strokeStyle = 'rgba(60,60,60,0.55)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(19, 15.5); g.quadraticCurveTo(28, 22.5, 37, 15.5); g.stroke();
        g.fillStyle = 'rgba(70,70,70,0.25)';
        g.beginPath(); g.moveTo(20, 15.5); g.quadraticCurveTo(28, 21.5, 36, 15.5); g.lineTo(36, 12); g.lineTo(20, 12); g.closePath(); g.fill();
      } else if (d === 'n') {
        g.strokeStyle = 'rgba(80,80,80,0.28)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(28, 18); g.lineTo(28, 40); g.stroke();
        g.beginPath(); g.moveTo(17, 22); g.quadraticCurveTo(21, 27, 25, 24); g.stroke();
        g.beginPath(); g.moveTo(39, 22); g.quadraticCurveTo(35, 27, 31, 24); g.stroke();
      } else {
        g.strokeStyle = 'rgba(60,60,60,0.45)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(31, 13); g.quadraticCurveTo(36, 17, 40, 14.5); g.stroke();
      }
      g.restore();
    });
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
      g.restore();
      if (d === 's') {
        // eyes + a hint of nose
        g.fillStyle = '#211a16';
        g.beginPath(); g.ellipse(HX - 6.3, HY + 3.2, 1.75, 2.3, 0, 0, TAU); g.ellipse(HX + 6.3, HY + 3.2, 1.75, 2.3, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath(); circle(g, HX - 6.8, HY + 2.4, 0.55); circle(g, HX + 5.8, HY + 2.4, 0.55); g.fill();
        g.strokeStyle = 'rgba(120,120,120,0.55)'; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(HX - 1.2, HY + 8.2); g.quadraticCurveTo(HX + 0.6, HY + 9.2, HX + 1.6, HY + 8); g.stroke();
      } else if (d === 'e') {
        g.fillStyle = '#211a16';
        g.beginPath(); g.ellipse(HX + 9.5, HY + 2.6, 1.6, 2.3, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); circle(g, HX + 9.1, HY + 1.8, 0.5); g.fill();
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
      // strands radiating from the crown
      g.strokeStyle = 'rgba(80,80,80,0.42)'; g.lineWidth = 0.95;
      const n = H.curls ? 0 : 16;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, r0 = 3 + rand() * 6, r1 = 16 + rand() * 22;
        const bend = (rand() - 0.5) * 0.5;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.quadraticCurveTo(cx + Math.cos(a + bend) * (r0 + r1) * 0.55, cy + Math.sin(a + bend) * (r0 + r1) * 0.55, cx + Math.cos(a + bend * 1.5) * r1, cy + Math.sin(a + bend * 1.5) * r1);
        g.stroke();
      }
      if (H.curls) {
        for (let i = 0; i < 26; i++) {
          const x = HX + (rand() - 0.5) * 42, y = HY - 22 + rand() * (d === 'n' ? 36 : 22);
          g.strokeStyle = 'rgba(80,80,80,0.45)'; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, 2 + rand() * 2, 0.2, 2.6); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.6)';
          g.beginPath(); g.arc(x - 0.6, y - 0.6, 1.5 + rand(), 3.5, 5.2); g.stroke();
        }
      }
      // glossy sheen
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx + 1, cy + 8, 11, Math.PI * 1.12, Math.PI * 1.42); g.stroke();
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
      for (let i = 0; i < 14; i++) {
        const x = HX + (rand() - 0.5) * 28, y = HY + 8 + rand() * 14;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 2, y + 3 + rand() * 3); g.stroke();
      }
      g.restore();
    }, 2.6);
  });
}

// ---------------- weapons & tools ----------------
const STEEL = [[0, '#f4f6f8'], [0.45, '#c9d0d8'], [1, '#7f8a96']];
function sword() {
  return spritePx(24, 62, (g, P) => {
    const cx = 12;
    P.layer((g) => {
      // blade
      g.beginPath(); g.moveTo(cx, 3); g.lineTo(cx + 3.6, 10); g.lineTo(cx + 3.4, 41); g.lineTo(cx - 3.4, 41); g.lineTo(cx - 3.6, 10); g.closePath();
      g.fillStyle = lin(g, cx - 4, 0, cx + 4, 0, STEEL); g.fill();
      g.fillStyle = 'rgba(70,80,92,0.55)'; g.fillRect(cx - 0.6, 11, 1.2, 28);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.moveTo(cx - 0.4, 5); g.lineTo(cx - 2.8, 11); g.lineTo(cx - 2.6, 38); g.lineTo(cx - 1.6, 38); g.lineTo(cx - 1.4, 11); g.closePath(); g.fill();
      // guard
      g.fillStyle = lin(g, 0, 40, 0, 45, [[0, '#c9a45c'], [1, '#6e5228']]);
      g.beginPath(); g.moveTo(cx - 9, 41); g.quadraticCurveTo(cx, 39, cx + 9, 41); g.lineTo(cx + 8, 44.5); g.quadraticCurveTo(cx, 43, cx - 8, 44.5); g.closePath(); g.fill();
      // grip
      g.fillStyle = '#5a3a24'; g.fillRect(cx - 2.3, 44.5, 4.6, 10);
      g.strokeStyle = '#8a6040'; g.lineWidth = 1;
      for (let y = 46; y < 54; y += 2.4) { g.beginPath(); g.moveTo(cx - 2.3, y); g.lineTo(cx + 2.3, y + 1.2); g.stroke(); }
      // pommel
      g.fillStyle = '#b8913f'; g.beginPath(); circle(g, cx, 56.5, 3.2); g.fill();
      g.fillStyle = '#f0d890'; g.beginPath(); circle(g, cx - 1, 55.5, 1.1); g.fill();
    }, 2.4);
  });
}
function axe() {
  return spritePx(36, 62, (g, P) => {
    const cx = 18;
    P.layer((g) => {
      // haft
      g.fillStyle = lin(g, cx - 2.5, 0, cx + 2.5, 0, [[0, '#a5784a'], [1, '#5e3e22']]);
      g.beginPath(); g.moveTo(cx - 2.3, 5); g.lineTo(cx + 2.3, 5); g.lineTo(cx + 2.6, 58); g.lineTo(cx - 2.6, 58); g.closePath(); g.fill();
      g.fillStyle = '#3e2a1a'; g.fillRect(cx - 2.8, 50, 5.6, 1.4); g.fillRect(cx - 2.8, 53.5, 5.6, 1.4);
      // head
      g.beginPath();
      g.moveTo(cx + 1, 9); g.lineTo(cx + 8, 10); g.quadraticCurveTo(cx + 12, 5, cx + 16, 3.5);
      g.quadraticCurveTo(cx + 19.5, 14, cx + 16, 25.5); g.quadraticCurveTo(cx + 12, 22, cx + 8, 19.5); g.lineTo(cx + 1, 20);
      g.lineTo(cx - 4, 19); g.lineTo(cx - 5.5, 10.5); g.closePath();
      g.fillStyle = lin(g, cx - 5, 4, cx + 18, 24, STEEL); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(cx + 15.5, 5.5); g.quadraticCurveTo(cx + 18.2, 14, cx + 15.4, 23.5); g.stroke();
      g.fillStyle = 'rgba(60,66,76,0.5)'; g.beginPath(); g.ellipse(cx - 1, 14.5, 2.4, 3.5, 0, 0, TAU); g.fill();
    }, 2.4);
  });
}
function pickaxe() {
  return spritePx(52, 62, (g, P) => {
    const cx = 26;
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 2.5, 0, cx + 2.5, 0, [[0, '#a5784a'], [1, '#5e3e22']]);
      g.beginPath(); g.moveTo(cx - 2.3, 8); g.lineTo(cx + 2.3, 8); g.lineTo(cx + 2.6, 58); g.lineTo(cx - 2.6, 58); g.closePath(); g.fill();
      g.fillStyle = '#3e2a1a'; g.fillRect(cx - 2.8, 50, 5.6, 1.4); g.fillRect(cx - 2.8, 53.5, 5.6, 1.4);
      g.beginPath();
      g.moveTo(cx - 23, 17); g.quadraticCurveTo(cx - 14, 6, cx - 4, 5.5); g.lineTo(cx + 4, 5.5); g.quadraticCurveTo(cx + 14, 6, cx + 23, 17);
      g.quadraticCurveTo(cx + 13, 10.5, cx + 4, 12); g.lineTo(cx - 4, 12); g.quadraticCurveTo(cx - 13, 10.5, cx - 23, 17); g.closePath();
      g.fillStyle = lin(g, 0, 4, 0, 14, [[0, '#d5dbe2'], [0.5, '#9aa4ae'], [1, '#5f6973']]); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(cx - 20, 14); g.quadraticCurveTo(cx - 12, 7.5, cx - 3, 7.2); g.stroke();
      g.fillStyle = '#6b5434'; g.fillRect(cx - 4, 4.5, 8, 9);
      g.fillStyle = 'rgba(255,230,180,0.5)'; g.fillRect(cx - 3, 5.5, 2, 7);
    }, 2.4);
  });
}
function spear() {
  return spritePx(20, 88, (g, P) => {
    const cx = 10;
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 2, 0, cx + 2, 0, [[0, '#a5784a'], [1, '#5e3e22']]);
      g.fillRect(cx - 1.8, 18, 3.6, 66);
      g.beginPath(); g.moveTo(cx, 2); g.quadraticCurveTo(cx + 6, 12, cx + 2, 21); g.lineTo(cx - 2, 21); g.quadraticCurveTo(cx - 6, 12, cx, 2); g.closePath();
      g.fillStyle = lin(g, cx - 5, 0, cx + 5, 0, STEEL); g.fill();
      g.fillStyle = 'rgba(70,80,92,0.6)'; g.fillRect(cx - 0.5, 7, 1, 13);
      g.fillStyle = '#7a5a30'; g.fillRect(cx - 2.6, 20, 5.2, 4);
      g.fillStyle = '#3e2a1a'; g.fillRect(cx - 2.2, 66, 4.4, 1.4); g.fillRect(cx - 2.2, 70, 4.4, 1.4);
    }, 2.2);
  });
}
function club() {
  return spritePx(26, 58, (g, P) => {
    const cx = 13;
    P.layer((g) => {
      g.beginPath(); g.moveTo(cx - 2.4, 54); g.lineTo(cx - 3, 40); g.bezierCurveTo(cx - 9, 26, cx - 8, 6, cx, 4); g.bezierCurveTo(cx + 8, 6, cx + 9, 26, cx + 3, 40); g.lineTo(cx + 2.4, 54); g.closePath();
      g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, '#b0844f'], [0.5, '#8a603a'], [1, '#553820']]); g.fill();
      g.fillStyle = '#5a3c22';
      for (const [x, y] of [[cx - 4, 14], [cx + 3, 22], [cx - 2, 30]]) { g.beginPath(); g.ellipse(x, y, 1.8, 1.3, 0, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(255,230,190,0.5)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - 4, 10); g.quadraticCurveTo(cx - 6, 22, cx - 2.5, 36); g.stroke();
      g.fillStyle = '#3e2a1a'; g.fillRect(cx - 3, 46, 6, 1.5); g.fillRect(cx - 3, 50, 6, 1.5);
    }, 2.4);
  });
}

export function addPawns(add) {
  for (const d of ['s', 'n', 'e']) {
    add('pawn_body_' + d, body(d), 0.5, FEET / BH);
    add('pawn_head_' + d, head(d), 0.5, NECK / HH);
    for (const st of Object.keys(HAIR)) add(`hair_${st}_${d}`, hair(st, d), 0.5, NECK / HH);
  }
  add('beard_s', beard('s'), 0.5, NECK / HH);
  add('beard_e', beard('e'), 0.5, NECK / HH);
  add('weapon_sword', sword(), 0.5, 50 / 62);
  add('weapon_axe', axe(), 0.5, 51 / 62);
  add('tool_pickaxe', pickaxe(), 0.5, 51 / 62);
  add('weapon_spear', spear(), 0.5, 70 / 88);
  add('weapon_club', club(), 0.5, 49 / 58);
}
export const HAIR_STYLES = Object.keys(HAIR);
