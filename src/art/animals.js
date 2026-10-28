// Animals: charming RimWorld-like quadrupeds. Views: _e (side, facing right), _s (front), _n (back),
// plus a stride frame for the side view (_e_walk) used by the trot cycle in compose.js.
// Each body part is its own outlined layer so overlaps read clearly (far legs → tail → body → near legs → head).

import { spritePx, rng, OW, TAU, lin, rad, atop, circle, taper, mixc, rgb, hex, smoothClosed, blobPts } from './paint.js';

const SPECIES = {
  wolf: {
    W: 96, H: 70, foot: 64,
    coat: '#8c857a', dark: '#5a544c', light: '#d8d0c0', nose: '#1d1915', paw: '#4a443d', eye: '#e0b040',
    body: { x: 45, y: 36, rx: 24, ry: 12.5, chest: 6 },
    head: { x: 74, y: 24, r: 10, snout: 13, sh: 6, ear: 'point', earH: 9 },
    legs: { fx: 61, rx: 30, top: 42, w: 6.6, hoof: false }, tail: 'bushy',
    front: { W: 62, H: 70, foot: 64, by: 40, brx: 17, bry: 15, hy: 28, hr: 13, muz: 7, ear: 'point' },
  },
  boar: {
    W: 88, H: 62, foot: 57,
    coat: '#6b5242', dark: '#3f3028', light: '#9b7e66', nose: '#c99a8a', paw: '#2e241e', eye: '#1a1410',
    body: { x: 42, y: 34, rx: 26, ry: 14, chest: 3 },
    head: { x: 69, y: 34, r: 10, snout: 12, sh: 7.5, ear: 'small', earH: 6, snoutDown: 4 },
    legs: { fx: 58, rx: 28, top: 42, w: 7, hoof: true }, tail: 'thin', mane: true, tusks: true,
    front: { W: 62, H: 62, foot: 57, by: 34, brx: 20, bry: 16, hy: 33, hr: 13, muz: 8, ear: 'small' },
  },
  deer: {
    W: 96, H: 100, foot: 94,
    coat: '#a87c52', dark: '#76532f', light: '#ead8bd', nose: '#1d1915', paw: '#2e241e', eye: '#1a1410',
    body: { x: 44, y: 54, rx: 25, ry: 11, chest: 3 },
    head: { x: 76, y: 28, r: 7.5, snout: 11, sh: 4.6, ear: 'long', earH: 9, neck: 1 },
    legs: { fx: 62, rx: 28, top: 58, w: 5, hoof: true }, tail: 'flag', antlers: true,
    front: { W: 64, H: 100, foot: 94, by: 58, brx: 15, bry: 13, hy: 38, hr: 10.5, muz: 6, ear: 'long', neck: true },
  },
  rabbit: {
    W: 44, H: 40, foot: 36,
    coat: '#9d8b75', dark: '#6e6050', light: '#e7dfd2', nose: '#c98a8a', paw: '#7c6d5c', eye: '#1a1410',
    body: { x: 20, y: 25, rx: 11, ry: 8.5, chest: 0 },
    head: { x: 31, y: 18, r: 6, snout: 3.5, sh: 3.8, ear: 'rabbit', earH: 13 },
    legs: { fx: 27, rx: 15, top: 28, w: 3.5, hoof: false, hop: true }, tail: 'puff',
    front: { W: 34, H: 44, foot: 40, by: 31, brx: 10, bry: 8.5, hy: 22, hr: 7.5, muz: 3.5, ear: 'rabbit' },
  },
  bear: {
    W: 128, H: 96, foot: 89,
    coat: '#5e4432', dark: '#3c2a1e', light: '#8a6a50', nose: '#1d1915', paw: '#2a1f17', eye: '#120d0a',
    body: { x: 60, y: 50, rx: 38, ry: 21, chest: 4, hump: 7 },
    head: { x: 102, y: 44, r: 14, snout: 12, sh: 9, ear: 'round', earH: 6, snoutDown: 2 },
    legs: { fx: 86, rx: 38, top: 60, w: 13, hoof: false }, tail: 'short',
    front: { W: 86, H: 96, foot: 89, by: 54, brx: 30, bry: 24, hy: 44, hr: 18, muz: 9, ear: 'round' },
  },
};

// ---------------- helpers ----------------
function furBody(g, S, B, pathFn) {
  g.beginPath(); pathFn(g); g.fillStyle = S.coat; g.fill();
  g.save(); g.beginPath(); pathFn(g); g.clip();
  // back (dark) and belly (light) bands
  g.fillStyle = lin(g, 0, B.y - B.ry, 0, B.y + B.ry, [[0, S.dark], [0.38, S.coat], [0.7, S.coat], [1, mixc(S.coat, S.light, 0.7)]]);
  g.fillRect(0, 0, 400, 400);
  // top-left sheen
  g.fillStyle = rad(g, B.x - B.rx * 0.3, B.y - B.ry * 0.6, 0, B.rx, [[0, 'rgba(255,245,225,0.22)'], [1, 'rgba(255,245,225,0)']]);
  g.fillRect(0, 0, 400, 400);
  g.restore();
}
function furStrokes(g, S, x0, y0, x1, y1, n, rand, dir = 1) {
  g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    const light = rand() < 0.4;
    g.strokeStyle = light ? rgb(hex(S.light), 0.35) : rgb(hex(S.dark), 0.45);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3 * dir, y + 1.5 + rand()); g.stroke();
  }
}
function eye(g, x, y, r, S) {
  g.fillStyle = '#16110e'; g.beginPath(); g.ellipse(x, y, r, r * 1.1, 0, 0, TAU); g.fill();
  if (S.eye !== '#1a1410' && S.eye !== '#120d0a') { g.fillStyle = S.eye; g.beginPath(); circle(g, x, y, r * 0.55); g.fill(); g.fillStyle = '#16110e'; g.beginPath(); circle(g, x, y, r * 0.3); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); circle(g, x - r * 0.35, y - r * 0.4, r * 0.32); g.fill();
}
function limb(g, x0, y0, x1, y1, w0, w1, bend, col) {
  g.fillStyle = col;
  g.beginPath(); taper(g, x0, y0, (x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1, w0, w1, 8); g.fill();
}

// ---------------- side view ----------------
function side(sp, stride) {
  const S = SPECIES[sp];
  const rand = rng(sp.length * 1000 + (stride ? 7 : 3));
  const B = S.body, Hd = S.head, L = S.legs;
  return spritePx(S.W, S.H, (g, P) => {
    const foot = S.foot;
    // leg poses: [near front, near rear, far front, far rear] angle offsets (feet x shift)
    const sw = stride ? (L.hop ? 0 : 1) : 0;
    const legLen = foot - L.top;
    const shift = legLen * 0.32;
    const legs = {
      nf: L.fx + sw * shift, nr: L.rx - sw * shift,
      ff: L.fx + 4 - sw * shift * 0.8, fr: L.rx + 4 + sw * shift * 0.8,
    };
    if (L.hop && stride) { legs.nf = L.fx + 5; legs.ff = L.fx + 8; legs.nr = L.rx - 6; legs.fr = L.rx - 3; }
    const legCol = (far) => (far ? mixc(S.coat, S.dark, 0.55) : S.coat);
    const footShape = (g, x, y, w, far) => {
      if (L.hoof) { g.fillStyle = S.paw; g.beginPath(); g.moveTo(x - w * 0.45, y - 3.5); g.lineTo(x + w * 0.5, y - 3.5); g.lineTo(x + w * 0.6, y); g.lineTo(x - w * 0.5, y); g.closePath(); g.fill(); }
      else { g.fillStyle = far ? mixc(S.paw, S.dark, 0.3) : mixc(S.coat, S.paw, 0.5); g.beginPath(); g.ellipse(x + w * 0.2, y - w * 0.3, w * 0.62, w * 0.36, 0, 0, TAU); g.fill(); }
    };
    const drawLeg = (g, hipX, footX, far, rear) => {
      const w = L.w * (far ? 0.92 : 1);
      if (L.hop && rear) {
        g.fillStyle = legCol(far);
        g.beginPath(); g.ellipse(footX + 3, foot - 1.8, 6, 2.2, 0, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(hipX + 1, L.top - 3, 7, 6.5, -0.3, 0, TAU); g.fill();
        if (!far) { g.fillStyle = rgb(hex(S.light), 0.35); g.beginPath(); g.ellipse(hipX - 1, L.top - 6, 3, 2, -0.5, 0, TAU); g.fill(); }
        return;
      }
      if (rear && !L.hoof && sp !== 'bear') {
        // haunch + backward knee
        limb(g, hipX, L.top - 6, footX, foot - 1, w * 1.6, w * 0.65, -w * 0.6, legCol(far));
      } else {
        limb(g, hipX, L.top - 4, footX, foot - 1, w * 1.15, w * 0.72, rear ? -w * 0.4 : w * 0.25, legCol(far));
      }
      footShape(g, footX, foot, w, far);
    };
    // far legs
    P.layer((g) => { drawLeg(g, L.fx + 3, legs.ff, true, false); drawLeg(g, L.rx + 3, legs.fr, true, true); }, OW * 0.9);
    // tail (behind body)
    const tx = B.x - B.rx + 2, ty = B.y - B.ry * 0.5;
    P.layer((g) => {
      if (S.tail === 'bushy') {
        g.fillStyle = S.coat;
        g.beginPath(); g.moveTo(tx + 4, ty - 3); g.bezierCurveTo(tx - 10, ty - 2, tx - 16, ty + 10, tx - 14, ty + 22); g.bezierCurveTo(tx - 10, ty + 20, tx - 4, ty + 12, tx + 4, ty + 5); g.closePath(); g.fill();
        g.fillStyle = S.light; g.beginPath(); g.ellipse(tx - 13, ty + 19, 3, 3.5, 0.4, 0, TAU); g.fill();
        g.fillStyle = S.dark; g.beginPath(); g.moveTo(tx + 2, ty - 3); g.bezierCurveTo(tx - 8, ty - 2, tx - 13, ty + 6, tx - 14, ty + 14); g.lineTo(tx - 11, ty + 8); g.closePath(); g.fill();
      } else if (S.tail === 'thin') {
        g.strokeStyle = S.dark; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(tx + 3, ty); g.quadraticCurveTo(tx - 5, ty + 2, tx - 4, ty + 10); g.stroke();
        g.fillStyle = S.dark; g.beginPath(); g.ellipse(tx - 4, ty + 11, 1.8, 2.6, 0, 0, TAU); g.fill();
      } else if (S.tail === 'flag') {
        g.fillStyle = S.coat; g.beginPath(); g.ellipse(tx - 1, ty + 1, 4, 6, 0.5, 0, TAU); g.fill();
        g.fillStyle = S.light; g.beginPath(); g.ellipse(tx, ty + 3, 2.5, 4, 0.5, 0, TAU); g.fill();
      } else if (S.tail === 'puff') {
        g.fillStyle = S.light; g.beginPath(); circle(g, tx - 1, ty + 1, 4.5); g.fill();
      } else {
        g.fillStyle = S.coat; g.beginPath(); g.ellipse(tx - 2, ty + 2, 5, 4, 0.3, 0, TAU); g.fill();
      }
    }, S.tail === 'puff' ? 1.8 : OW * 0.9);
    // body (+ neck)
    const bodyPath = (gg) => {
      const x0 = B.x - B.rx, x1 = B.x + B.rx, y0 = B.y - B.ry, y1 = B.y + B.ry;
      const hump = B.hump || 0;
      gg.moveTo(x0 + 3, B.y);
      gg.bezierCurveTo(x0 - 1, y0 + 2, x0 + B.rx * 0.5, y0 - 1, B.x + B.rx * 0.2, y0 - hump);
      gg.bezierCurveTo(x1 - 6, y0 - hump * 0.6, x1 + 2, y0 + 2, x1, B.y + B.chest * 0.3);
      gg.bezierCurveTo(x1 - 1, y1 + B.chest, x1 - B.rx * 0.5, y1 + 1, B.x, y1);
      gg.bezierCurveTo(B.x - B.rx * 0.5, y1, x0 + 1, y1 - 2, x0 + 3, B.y);
      gg.closePath();
      // neck to head
      const nx = Hd.x - Hd.r * 0.6, ny = Hd.y + Hd.r * 0.3;
      const nw = Hd.neck ? 5.5 : Hd.r * 0.95;
      gg.moveTo(x1 - B.rx * 0.45, y0 + 2);
      gg.quadraticCurveTo(nx - 2, ny - nw - 2, nx + 2, ny - nw * 0.6);
      gg.lineTo(nx + 3, ny + nw * 0.8);
      gg.quadraticCurveTo(x1 - 2, B.y + 2, x1 - B.rx * 0.3, y1 - 2);
      gg.closePath();
    };
    P.layer((g) => {
      furBody(g, S, B, bodyPath);
      g.save(); g.beginPath(); bodyPath(g); g.clip();
      furStrokes(g, S, B.x - B.rx, B.y - B.ry, B.x + B.rx, B.y + B.ry * 0.6, Math.round(B.rx * 0.9), rand, -1);
      if (S.mane) {
        g.fillStyle = S.dark;
        g.beginPath(); g.moveTo(B.x - B.rx * 0.6, B.y - B.ry + 1);
        for (let i = 0; i <= 10; i++) { const t = i / 10; const x = B.x - B.rx * 0.6 + t * B.rx * 1.5; g.lineTo(x, B.y - B.ry - 2 + (i % 2 ? -3 : 2) + Math.sin(t * 3) * 1); }
        g.lineTo(B.x + B.rx, B.y - B.ry * 0.2); g.lineTo(B.x - B.rx * 0.6, B.y - B.ry * 0.5); g.closePath(); g.fill();
      }
      if (sp === 'deer') { g.fillStyle = 'rgba(255,250,235,0.5)'; for (let i = 0; i < 6; i++) { g.beginPath(); circle(g, B.x - 12 + i * 5 + rand() * 2, B.y - 4 + rand() * 4, 1.1); g.fill(); } }
      g.restore();
      if (S.mane) {
        // bristles sticking above the back
        g.strokeStyle = S.dark; g.lineWidth = 1.6;
        for (let i = 0; i < 9; i++) { const x = B.x - B.rx * 0.5 + i * B.rx * 0.17; const y = B.y - B.ry - 1 - Math.sin(i / 8 * 3) * 1; g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x + 1.5, y - 3 - (i % 2) * 2); g.stroke(); }
      }
    });
    // near legs
    P.layer((g) => { drawLeg(g, L.fx, legs.nf, false, false); drawLeg(g, L.rx, legs.nr, false, true); });
    // head
    P.layer((g) => {
      const { x, y, r } = Hd;
      const sd = Hd.snoutDown || 0;
      // ears behind skull
      const earFar = (dx) => {
        g.fillStyle = mixc(S.coat, S.dark, 0.5);
        if (Hd.ear === 'point') { g.beginPath(); g.moveTo(x - 4 + dx, y - r * 0.5); g.lineTo(x - 1 + dx, y - r - Hd.earH); g.lineTo(x + 4 + dx, y - r * 0.6); g.closePath(); g.fill(); }
        else if (Hd.ear === 'long') { g.beginPath(); g.ellipse(x - 5 + dx, y - r - 2, 3.4, 7.5, -0.9, 0, TAU); g.fill(); }
        else if (Hd.ear === 'rabbit') { g.beginPath(); g.ellipse(x - 4 + dx, y - r - Hd.earH * 0.45, 2.6, Hd.earH * 0.6, -0.45, 0, TAU); g.fill(); }
      };
      earFar(4);
      // snout
      const sx = x + r * 0.5, sy = y + r * 0.15 + sd;
      g.fillStyle = S.coat;
      g.beginPath();
      g.moveTo(x, y - r * 0.55);
      g.quadraticCurveTo(sx + Hd.snout * 0.6, sy - Hd.sh * 0.9, sx + Hd.snout, sy - Hd.sh * 0.25);
      g.quadraticCurveTo(sx + Hd.snout + 2, sy + Hd.sh * 0.55, sx + Hd.snout - 2, sy + Hd.sh * 0.75);
      g.quadraticCurveTo(sx + 2, sy + Hd.sh * 1.1, x, y + r * 0.8);
      g.closePath(); g.fill();
      // skull
      g.beginPath(); circle(g, x, y, r); g.fill();
      g.save();
      g.beginPath(); circle(g, x, y, r); g.moveTo(x, y - r * 0.55); g.quadraticCurveTo(sx + Hd.snout * 0.6, sy - Hd.sh * 0.9, sx + Hd.snout, sy - Hd.sh * 0.25); g.quadraticCurveTo(sx + Hd.snout + 2, sy + Hd.sh * 0.55, sx + Hd.snout - 2, sy + Hd.sh * 0.75); g.quadraticCurveTo(sx + 2, sy + Hd.sh * 1.1, x, y + r * 0.8); g.closePath();
      g.clip();
      g.fillStyle = lin(g, 0, y - r, 0, y + r, [[0, S.dark], [0.4, S.coat], [1, S.coat]]); g.fillRect(x - r * 2, y - r * 2, r * 5 + Hd.snout, r * 4);
      // light muzzle / jaw
      g.fillStyle = mixc(S.coat, S.light, sp === 'boar' || sp === 'bear' ? 0.35 : 0.8);
      g.beginPath(); g.ellipse(sx + Hd.snout * 0.45, sy + Hd.sh * 0.6, Hd.snout * 0.75, Hd.sh * 0.55, 0.1, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,245,225,0.25)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.45, r * 0.55, r * 0.35, -0.4, 0, TAU); g.fill();
      g.restore();
      // nose
      if (sp === 'boar') {
        g.fillStyle = S.nose; g.beginPath(); g.ellipse(sx + Hd.snout + 0.5, sy + Hd.sh * 0.2, 2.6, Hd.sh * 0.6, 0, 0, TAU); g.fill();
        g.fillStyle = '#5a3a32'; g.beginPath(); circle(g, sx + Hd.snout + 1, sy + Hd.sh * 0.05, 0.8); circle(g, sx + Hd.snout + 1, sy + Hd.sh * 0.45, 0.8); g.fill();
      } else {
        g.fillStyle = S.nose; g.beginPath(); g.ellipse(sx + Hd.snout - 0.5, sy - Hd.sh * 0.15, sp === 'rabbit' ? 1.3 : 2.6, sp === 'rabbit' ? 1.1 : 2.1, 0, 0, TAU); g.fill();
      }
      if (S.tusks) {
        g.fillStyle = '#f2ead6'; g.beginPath(); g.moveTo(sx + Hd.snout - 4, sy + Hd.sh * 0.5); g.quadraticCurveTo(sx + Hd.snout - 1, sy - 1, sx + Hd.snout - 3.5, sy - 3.5); g.quadraticCurveTo(sx + Hd.snout - 2.5, sy, sx + Hd.snout - 6, sy + Hd.sh * 0.5); g.closePath(); g.fill();
      }
      // mouth line
      g.strokeStyle = rgb(hex(S.dark), 0.7); g.lineWidth = 1;
      g.beginPath(); g.moveTo(sx + Hd.snout - 3, sy + Hd.sh * 0.55); g.quadraticCurveTo(sx + Hd.snout * 0.4, sy + Hd.sh * 0.75, sx, sy + Hd.sh * 0.35); g.stroke();
      // eye
      eye(g, x + r * 0.42, y - r * 0.18, Math.max(1.3, r * 0.17), S);
      // near ear
      g.fillStyle = S.coat;
      if (Hd.ear === 'point') {
        g.beginPath(); g.moveTo(x - 6, y - r * 0.45); g.lineTo(x - 3, y - r - Hd.earH); g.lineTo(x + 2.5, y - r * 0.55); g.closePath(); g.fill();
        g.fillStyle = mixc(S.dark, '#2a1f1a', 0.4); g.beginPath(); g.moveTo(x - 4.5, y - r * 0.6); g.lineTo(x - 3, y - r - Hd.earH + 3.5); g.lineTo(x + 0.5, y - r * 0.65); g.closePath(); g.fill();
      } else if (Hd.ear === 'small') {
        g.beginPath(); g.moveTo(x - 7, y - r * 0.5); g.quadraticCurveTo(x - 9, y - r - Hd.earH, x - 3, y - r - Hd.earH * 0.6); g.lineTo(x, y - r * 0.7); g.closePath(); g.fill();
      } else if (Hd.ear === 'long') {
        g.beginPath(); g.ellipse(x - 7, y - r * 0.9, 3.6, 7.5, -1.05, 0, TAU); g.fill();
        g.fillStyle = mixc(S.light, '#c99a8a', 0.4); g.beginPath(); g.ellipse(x - 7.3, y - r * 0.95, 1.8, 5, -1.05, 0, TAU); g.fill();
      } else if (Hd.ear === 'rabbit') {
        g.beginPath(); g.ellipse(x - 2.5, y - r - Hd.earH * 0.45, 2.8, Hd.earH * 0.62, -0.3, 0, TAU); g.fill();
        g.fillStyle = '#d9a7a0'; g.beginPath(); g.ellipse(x - 2.4, y - r - Hd.earH * 0.42, 1.3, Hd.earH * 0.45, -0.3, 0, TAU); g.fill();
      } else if (Hd.ear === 'round') {
        g.beginPath(); circle(g, x - r * 0.45, y - r * 0.85, Hd.earH); g.fill();
        g.fillStyle = S.dark; g.beginPath(); circle(g, x - r * 0.42, y - r * 0.82, Hd.earH * 0.5); g.fill();
      }
    });
    if (S.antlers) {
      P.layer((g) => {
        const x = Hd.x - 1, y = Hd.y - Hd.r + 1;
        g.strokeStyle = '#cdb58e'; g.lineCap = 'round';
        const tine = (x0, y0, x1, y1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
        // far antler (darker)
        g.strokeStyle = '#a08a68';
        tine(x + 3, y, x + 1, y - 12, 2.4); tine(x + 1, y - 12, x - 4, y - 21, 2); tine(x + 1.5, y - 9, x + 7, y - 16, 1.8); tine(x - 2, y - 17, x + 2, y - 24, 1.6);
        g.strokeStyle = '#d7c19a';
        tine(x, y + 1, x - 4, y - 11, 2.8); tine(x - 4, y - 11, x - 11, y - 18, 2.3); tine(x - 3.5, y - 8, x + 3, y - 15, 2); tine(x - 8, y - 15, x - 6, y - 23, 1.8); tine(x - 11, y - 18, x - 16, y - 20, 1.6);
      }, 2.2);
    }
  });
}

// ---------------- front view (facing the camera / south) ----------------
function front(sp) {
  const S = SPECIES[sp], F = S.front;
  const rand = rng(sp.length * 333 + 1);
  return spritePx(F.W, F.H, (g, P) => {
    const cx = F.W / 2, foot = F.foot;
    const legW = S.legs.w * 1.05;
    const hy = F.hy;
    // back body (shoulders) and legs
    P.layer((g) => {
      for (const s of [-1, 1]) {
        limb(g, cx + s * F.brx * 0.45, F.by, cx + s * F.brx * 0.42, foot - 1, legW * 1.3, legW * 0.85, 0, s < 0 ? S.coat : mixc(S.coat, S.dark, 0.25));
        if (S.legs.hoof) { g.fillStyle = S.paw; g.fillRect(cx + s * F.brx * 0.42 - legW * 0.45, foot - 4, legW * 0.9, 4); }
        else { g.fillStyle = mixc(S.coat, S.paw, 0.5); g.beginPath(); g.ellipse(cx + s * F.brx * 0.42, foot - 1.5, legW * 0.55, legW * 0.35, 0, 0, TAU); g.fill(); }
      }
    }, OW * 0.95);
    P.layer((g) => {
      const bp = (gg) => gg.ellipse(cx, F.by, F.brx, F.bry, 0, 0, TAU);
      furBody(g, S, { x: cx, y: F.by, rx: F.brx, ry: F.bry }, bp);
      g.save(); g.beginPath(); bp(g); g.clip();
      g.fillStyle = mixc(S.coat, S.light, 0.6); g.beginPath(); g.ellipse(cx, F.by + F.bry * 0.55, F.brx * 0.45, F.bry * 0.6, 0, 0, TAU); g.fill();
      furStrokes(g, S, cx - F.brx, F.by - F.bry, cx + F.brx, F.by + F.bry, 14, rand);
      g.restore();
      if (F.neck) {
        g.fillStyle = S.coat; g.beginPath(); g.moveTo(cx - 6, F.by - F.bry + 4); g.lineTo(cx - 5, hy + 4); g.lineTo(cx + 5, hy + 4); g.lineTo(cx + 6, F.by - F.bry + 4); g.closePath(); g.fill();
        g.fillStyle = S.light; g.beginPath(); g.ellipse(cx, F.by - F.bry + 2, 4, 5, 0, 0, TAU); g.fill();
      }
    });
    // head
    P.layer((g) => {
      const r = F.hr;
      const ears = (near) => {
        for (const s of [-1, 1]) {
          g.fillStyle = near ? mixc(S.dark, '#2a1f1a', 0.3) : S.coat;
          const k = near ? 0.55 : 1;
          if (F.ear === 'point') { g.beginPath(); g.moveTo(cx + s * r * 0.25, hy - r * 0.7); g.lineTo(cx + s * r * 0.75, hy - r - S.head.earH * k); g.lineTo(cx + s * r * (near ? 0.85 : 1.0), hy - r * 0.3); g.closePath(); g.fill(); }
          else if (F.ear === 'small') { g.beginPath(); g.ellipse(cx + s * r * 0.8, hy - r * 0.75, 4 * k + 1, 5 * k + 1, s * 0.6, 0, TAU); g.fill(); }
          else if (F.ear === 'long') { g.beginPath(); g.ellipse(cx + s * (r + 4), hy - r * 0.5, 7.5 * k + 1, 3.6 * k + 0.5, s * -0.35, 0, TAU); g.fill(); }
          else if (F.ear === 'rabbit') { g.beginPath(); g.ellipse(cx + s * r * 0.38, hy - r - S.head.earH * 0.5, 2.8 * k + 0.4, S.head.earH * 0.62 * (near ? 0.85 : 1), s * 0.12, 0, TAU); g.fill(); if (near) { g.fillStyle = '#d9a7a0'; g.fill(); } }
          else if (F.ear === 'round') { g.beginPath(); circle(g, cx + s * r * 0.72, hy - r * 0.72, S.head.earH * (near ? 0.5 : 1.05)); g.fill(); }
        }
      };
      ears(false);
      if (S.antlers) {
        g.lineCap = 'round';
        for (const s of [-1, 1]) {
          g.strokeStyle = '#d2bb94';
          const t = (x0, y0, x1, y1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(cx + s * x0, y0); g.lineTo(cx + s * x1, y1); g.stroke(); };
          t(3, hy - r + 2, 7, hy - r - 10, 2.6); t(7, hy - r - 10, 15, hy - r - 18, 2.2); t(8, hy - r - 7, 4, hy - r - 18, 1.9); t(12, hy - r - 15, 13, hy - r - 25, 1.7); t(15, hy - r - 18, 21, hy - r - 19, 1.5);
        }
      }
      const headPath = (gg) => { gg.ellipse(cx, hy, r, r * 0.95, 0, 0, TAU); };
      g.beginPath(); headPath(g); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); headPath(g); g.clip();
      g.fillStyle = lin(g, 0, hy - r, 0, hy + r, [[0, S.dark], [0.45, S.coat], [1, S.coat]]); g.fillRect(0, 0, F.W, F.H);
      g.fillStyle = 'rgba(255,245,225,0.22)'; g.beginPath(); g.ellipse(cx - r * 0.35, hy - r * 0.45, r * 0.45, r * 0.3, -0.4, 0, TAU); g.fill();
      g.restore();
      ears(true);
      // muzzle toward camera
      const my = hy + r * 0.38;
      g.fillStyle = mixc(S.coat, S.light, sp === 'boar' || sp === 'bear' ? 0.35 : 0.8);
      g.beginPath(); g.ellipse(cx, my, F.muz, F.muz * 0.78, 0, 0, TAU); g.fill();
      if (sp === 'boar') {
        g.fillStyle = S.nose; g.beginPath(); g.ellipse(cx, my + 1, F.muz * 0.62, F.muz * 0.45, 0, 0, TAU); g.fill();
        g.fillStyle = '#5a3a32'; g.beginPath(); circle(g, cx - 2, my + 1, 1); circle(g, cx + 2, my + 1, 1); g.fill();
        g.fillStyle = '#f2ead6';
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * F.muz * 0.7, my + 3); g.quadraticCurveTo(cx + s * (F.muz + 2), my, cx + s * (F.muz + 1), my - 4); g.quadraticCurveTo(cx + s * (F.muz - 0.5), my + 1, cx + s * F.muz * 0.45, my + 3.5); g.closePath(); g.fill(); }
      } else {
        g.fillStyle = S.nose; g.beginPath(); g.ellipse(cx, my - F.muz * 0.2, sp === 'rabbit' ? 1.5 : F.muz * 0.42, sp === 'rabbit' ? 1.2 : F.muz * 0.3, 0, 0, TAU); g.fill();
        g.strokeStyle = rgb(hex(S.dark), 0.7); g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx, my - F.muz * 0.05); g.lineTo(cx, my + F.muz * 0.35); g.moveTo(cx - F.muz * 0.4, my + F.muz * 0.45); g.quadraticCurveTo(cx, my + F.muz * 0.6, cx + F.muz * 0.4, my + F.muz * 0.45); g.stroke();
      }
      const er = Math.max(1.3, r * 0.13);
      eye(g, cx - r * 0.42, hy - r * 0.08, er, S); eye(g, cx + r * 0.42, hy - r * 0.08, er, S);
    });
  });
}

// ---------------- back view (facing away / north) ----------------
function back(sp) {
  const S = SPECIES[sp], F = S.front;
  const rand = rng(sp.length * 555 + 2);
  return spritePx(F.W, F.H, (g, P) => {
    const cx = F.W / 2, foot = F.foot;
    const legW = S.legs.w * 1.1;
    const hy = F.hy - F.hr * 0.25;
    // head (behind the rump)
    P.layer((g) => {
      const r = F.hr * 0.9;
      g.fillStyle = mixc(S.coat, S.dark, 0.25);
      for (const s of [-1, 1]) {
        if (F.ear === 'point') { g.beginPath(); g.moveTo(cx + s * r * 0.2, hy - r * 0.7); g.lineTo(cx + s * r * 0.75, hy - r - S.head.earH); g.lineTo(cx + s * r, hy - r * 0.3); g.closePath(); g.fill(); }
        else if (F.ear === 'small') { g.beginPath(); g.ellipse(cx + s * r * 0.8, hy - r * 0.75, 5, 6, s * 0.6, 0, TAU); g.fill(); }
        else if (F.ear === 'long') { g.beginPath(); g.ellipse(cx + s * (r + 4), hy - r * 0.5, 8.5, 4, s * -0.35, 0, TAU); g.fill(); }
        else if (F.ear === 'rabbit') { g.beginPath(); g.ellipse(cx + s * r * 0.38, hy - r - S.head.earH * 0.5, 3.2, S.head.earH * 0.62, s * 0.12, 0, TAU); g.fill(); }
        else if (F.ear === 'round') { g.beginPath(); circle(g, cx + s * r * 0.72, hy - r * 0.72, S.head.earH * 1.05); g.fill(); }
      }
      if (S.antlers) {
        g.lineCap = 'round'; g.strokeStyle = '#b9a27c';
        for (const s of [-1, 1]) {
          const t = (x0, y0, x1, y1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(cx + s * x0, y0); g.lineTo(cx + s * x1, y1); g.stroke(); };
          t(3, hy - r + 2, 7, hy - r - 10, 2.6); t(7, hy - r - 10, 15, hy - r - 18, 2.2); t(8, hy - r - 7, 4, hy - r - 18, 1.9); t(12, hy - r - 15, 13, hy - r - 25, 1.7);
        }
      }
      g.fillStyle = mixc(S.coat, S.dark, 0.3); g.beginPath(); g.ellipse(cx, hy, r, r * 0.92, 0, 0, TAU); g.fill();
      if (F.neck) { g.fillRect(cx - 5, hy, 10, F.by - hy); }
      g.fillStyle = 'rgba(255,245,225,0.15)'; g.beginPath(); g.ellipse(cx - r * 0.3, hy - r * 0.4, r * 0.45, r * 0.3, -0.4, 0, TAU); g.fill();
    }, OW * 0.95);
    // hind legs
    P.layer((g) => {
      for (const s of [-1, 1]) {
        limb(g, cx + s * F.brx * 0.5, F.by + F.bry * 0.2, cx + s * F.brx * 0.42, foot - 1, legW * 1.6, legW * 0.85, 0, s < 0 ? S.coat : mixc(S.coat, S.dark, 0.25));
        if (S.legs.hoof) { g.fillStyle = S.paw; g.fillRect(cx + s * F.brx * 0.42 - legW * 0.45, foot - 4, legW * 0.9, 4); }
        else { g.fillStyle = mixc(S.coat, S.paw, 0.5); g.beginPath(); g.ellipse(cx + s * F.brx * 0.42, foot - 1.5, legW * 0.55, legW * 0.35, 0, 0, TAU); g.fill(); }
      }
    }, OW * 0.95);
    // rump
    P.layer((g) => {
      const ry = F.bry * 1.05, rx = F.brx * 1.02;
      const bp = (gg) => gg.ellipse(cx, F.by + 2, rx, ry, 0, 0, TAU);
      furBody(g, S, { x: cx, y: F.by + 2, rx, ry }, bp);
      g.save(); g.beginPath(); bp(g); g.clip();
      g.strokeStyle = rgb(hex(S.dark), 0.5); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx, F.by + 2 - ry * 0.2); g.lineTo(cx, F.by + 2 + ry); g.stroke();
      furStrokes(g, S, cx - rx, F.by - ry, cx + rx, F.by + ry, 14, rand);
      if (S.mane) { g.fillStyle = S.dark; g.beginPath(); g.ellipse(cx, F.by - ry * 0.75, rx * 0.22, ry * 0.5, 0, 0, TAU); g.fill(); }
      g.restore();
    });
    // tail
    P.layer((g) => {
      const ty = F.by - F.bry * 0.35;
      if (S.tail === 'bushy') { g.fillStyle = S.coat; g.beginPath(); g.moveTo(cx - 4, ty - 2); g.bezierCurveTo(cx - 8, ty + 10, cx - 3, ty + 22, cx + 1, ty + 26); g.bezierCurveTo(cx + 6, ty + 18, cx + 6, ty + 6, cx + 4, ty - 2); g.closePath(); g.fill(); g.fillStyle = S.light; g.beginPath(); g.ellipse(cx + 1, ty + 22, 3, 3.5, 0, 0, TAU); g.fill(); }
      else if (S.tail === 'thin') { g.strokeStyle = S.dark; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx, ty); g.quadraticCurveTo(cx + 3, ty + 6, cx + 1, ty + 12); g.stroke(); }
      else if (S.tail === 'flag') { g.fillStyle = S.light; g.beginPath(); g.ellipse(cx, ty + 6, 6, 9, 0, 0, TAU); g.fill(); g.fillStyle = S.coat; g.beginPath(); g.ellipse(cx, ty + 1, 3.2, 5, 0, 0, TAU); g.fill(); }
      else if (S.tail === 'puff') { g.fillStyle = S.light; for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; g.beginPath(); circle(g, cx + Math.cos(a) * 2.2, ty + 6 + Math.sin(a) * 2, 2.4); g.fill(); } }
      else { g.fillStyle = mixc(S.coat, S.dark, 0.4); g.beginPath(); g.ellipse(cx, ty + 3, 3.4, 2.8, 0, 0, TAU); g.fill(); }
    }, S.tail === 'thin' || S.tail === 'puff' || S.tail === 'short' ? 1.5 : OW * 0.85);
  });
}

export function addAnimals(add) {
  for (const sp of Object.keys(SPECIES)) {
    const S = SPECIES[sp];
    const fx = (S.legs.fx + S.legs.rx) / 2 / S.W;
    add(`${sp}_e`, side(sp, false), 0.5, S.foot / S.H);
    add(`${sp}_e_walk`, side(sp, true), 0.5, S.foot / S.H);
    add(`${sp}_s`, front(sp), 0.5, S.front.foot / S.front.H);
    add(`${sp}_n`, back(sp), 0.5, S.front.foot / S.front.H);
    void fx;
  }
}
export const ANIMAL_SPECIES = Object.keys(SPECIES);
void smoothClosed; void blobPts; void atop;
