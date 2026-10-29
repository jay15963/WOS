// Production stations, furniture, lights and camp props (3/4 view, light from the top-left).
// Sprites are drawn in a nominal box `w` tiles wide with E px of headroom above the footprint; the anchor is the
// bottom-centre of the footprint (o.x = tx + w/2, o.y = ty + h). Inside a painter, Y(v, h) maps a ground row
// v (0 = north edge, 1 = south edge of the footprint) and a height h (px) to sprite y.

import { spritePx, rng, OW, TAU, lin, rad, circle, mixc, tone, rgb, hex, leaf, taper, smoothClosed, blobPts } from './paint.js';

const WOOD = { deep: '#3b2616', dark: '#5a3b22', mid: '#7d5532', light: '#9c6e43', high: '#b98a58' };
const IRON = { dark: '#2c2c31', mid: '#4a4a52', light: '#6e6e78', high: '#9a9aa6' };

// geometry shared with composeWorld (tiles above the anchor, unless noted)
// (values derived from the drawing constants below: lift = (nominal H - y_px) / 64)
export const PROP_GEOM = {
  furnaceMouth: 0.2, potFire: (104 - 79.7) / 64, potRim: (104 - 47.7) / 64, brazierFire: 1.12,
  lampLift: 1.5, lampX: 0.16, bannerX: 3 / 64, bannerLift: (118 - 3) / 64,
};

const mk = (wt, E, fn, opts) => spritePx(Math.round(wt * 64), 64 + E, (g, P) => fn(g, P, (v, h) => E + v * 64 - h, Math.round(wt * 64)), { pad: 12, ...opts });

// plank-top rectangle with grain; x0..x1, y0..y1
function plankTop(g, x0, y0, x1, y1, base = '#b08250', dir = 'x', n = 4) {
  g.fillStyle = lin(g, x0, y0, x1, y1, [[0, mixc(base, '#fff2d8', 0.12)], [1, mixc(base, '#2a1a0c', 0.18)]]);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.strokeStyle = 'rgba(70,42,20,0.5)'; g.lineWidth = 0.9;
  g.beginPath();
  if (dir === 'x') for (let i = 1; i < n; i++) { const y = y0 + ((y1 - y0) * i) / n; g.moveTo(x0, y); g.lineTo(x1, y); }
  else for (let i = 1; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n; g.moveTo(x, y0); g.lineTo(x, y1); }
  g.stroke();
  g.strokeStyle = 'rgba(90,58,30,0.25)'; g.lineWidth = 0.7;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * (i + 0.5)) / n;
    if (dir === 'x') { g.moveTo(x0 + 3, y); g.bezierCurveTo((x0 + x1) / 2, y - 1, (x0 + x1) / 2, y + 1, x1 - 3, y); }
  }
  g.stroke();
  g.fillStyle = 'rgba(255,240,210,0.4)'; g.fillRect(x0, y0, x1 - x0, 1.2);
}
function leg(g, x, yTop, yBot, w = 5, col = WOOD.mid) {
  g.fillStyle = lin(g, x - w / 2, 0, x + w / 2, 0, [[0, mixc(col, '#fff', 0.15)], [1, mixc(col, '#000', 0.35)]]);
  g.fillRect(x - w / 2, yTop, w, yBot - yTop);
}
function apron(g, x0, x1, y0, y1, col = WOOD.mid) {
  g.fillStyle = lin(g, 0, y0, 0, y1, [[0, mixc(col, '#fff', 0.08)], [1, mixc(col, '#000', 0.3)]]);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = 'rgba(255,235,200,0.3)'; g.fillRect(x0, y0, x1 - x0, 1);
}
function stoneBlob(g, x, y, rx, ry, rand, col = '#8a847b') {
  const pts = blobPts(x, y, rx, ry, rand, 7, 0.16);
  g.beginPath(); smoothClosed(g, pts); g.fillStyle = mixc(col, '#3e3a35', 0.38); g.fill();
  g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
  g.fillStyle = col; g.beginPath(); g.ellipse(x - rx * 0.15, y - ry * 0.2, rx * 0.85, ry * 0.75, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,252,240,0.42)'; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.38, ry * 0.26, -0.3, 0, TAU); g.fill();
  g.restore();
}
function ground(g, cx, y, rx, ry, a = 0.3) { // soft dirt patch under props (inside the sprite, no outline)
  g.fillStyle = rad(g, cx, y, 0, rx, [[0, `rgba(40,28,16,${a})`], [1, 'rgba(40,28,16,0)']]);
  g.save(); g.translate(cx, y); g.scale(1, ry / rx); g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.restore(); g.fill();
}
function brick(g, x, y, w, h, col) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,240,220,0.3)'; g.fillRect(x, y, w, 1);
  g.fillStyle = 'rgba(20,14,10,0.4)'; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
}

// ---------------- workbench (2×1) ----------------
function workbench() {
  const rand = rng(501);
  return mk(2, 50, (g, P, Y, W) => {
    const x0 = 6, x1 = W - 6;
    P.layer((g) => {
      // back pegboard with hanging tools
      const by0 = Y(0.16, 60), by1 = Y(0.16, 30);
      g.fillStyle = lin(g, 0, by0, 0, by1, [[0, '#8f6640'], [1, '#6f4c2c']]);
      g.fillRect(x0 + 8, by0, x1 - x0 - 16, by1 - by0);
      g.fillStyle = 'rgba(40,24,12,0.55)';
      for (let x = x0 + 14; x < x1 - 10; x += 8) for (let y = by0 + 5; y < by1 - 2; y += 7) { g.beginPath(); circle(g, x, y, 0.8); g.fill(); }
      leg(g, x0 + 10, by0 - 2, by1, 4); leg(g, x1 - 10, by0 - 2, by1, 4);
      g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(x0 + 8, by0, x1 - x0 - 16, 1);
      // saw
      g.fillStyle = '#b8bcc4'; g.beginPath(); g.moveTo(x0 + 22, by0 + 6); g.lineTo(x0 + 46, by0 + 8); g.lineTo(x0 + 46, by0 + 15); g.lineTo(x0 + 24, by0 + 11); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,60,70,0.8)'; g.lineWidth = 0.8; g.beginPath(); for (let x = x0 + 25; x < x0 + 46; x += 2.4) { g.moveTo(x, by0 + 11 + (x - x0 - 24) * 0.18); g.lineTo(x + 1.2, by0 + 13 + (x - x0 - 24) * 0.12); } g.stroke();
      g.fillStyle = '#8a5a30'; g.fillRect(x0 + 15, by0 + 4, 8, 8);
      // hammer & chisel
      g.fillStyle = '#8a5a30'; g.fillRect(x0 + 58, by0 + 6, 3, 16); g.fillStyle = IRON.mid; g.fillRect(x0 + 54, by0 + 4, 11, 5);
      g.fillStyle = IRON.light; g.fillRect(x0 + 72, by0 + 5, 2.2, 12); g.fillStyle = '#9a6a3a'; g.fillRect(x0 + 71.4, by0 + 15, 3.4, 7);
      g.strokeStyle = '#c8a46a'; g.lineWidth = 1.2; g.beginPath(); g.arc(x0 + 86, by0 + 12, 4, 0, TAU); g.stroke(); // coil of rope
      g.strokeStyle = '#a07a46'; g.beginPath(); g.arc(x0 + 86, by0 + 12, 2.3, 0, TAU); g.stroke();
      // legs + lower shelf
      const ty0 = Y(0.2, 30), ty1 = Y(0.86, 30), ay = Y(0.86, 22), fb = Y(0.86, 0);
      leg(g, x0 + 4, ty1, fb, 6); leg(g, x1 - 4, ty1, fb, 6);
      leg(g, x0 + 7, Y(0.3, 22), Y(0.3, 0), 5, WOOD.dark); leg(g, x1 - 7, Y(0.3, 22), Y(0.3, 0), 5, WOOD.dark);
      plankTop(g, x0 + 4, Y(0.4, 8), x1 - 4, Y(0.86, 8) , '#7e5532', 'x', 2);
      g.fillStyle = '#a77a48'; g.fillRect(x0 + 14, Y(0.62, 14), 30, 4); g.fillRect(x0 + 18, Y(0.62, 18), 28, 4); // planks on the shelf
      g.fillStyle = '#5e5e66'; g.beginPath(); g.ellipse(x1 - 26, Y(0.7, 10), 8, 3, 0, 0, TAU); g.fill(); // bucket
      g.fillStyle = '#7d5a3a'; g.fillRect(x1 - 34, Y(0.7, 22), 16, 12); g.fillStyle = '#5a3e26'; g.fillRect(x1 - 34, Y(0.7, 14), 16, 1.6);
      // top + apron
      plankTop(g, x0, ty0, x1, ty1, '#b6874f', 'x', 4);
      apron(g, x0, x1, ty1, ay, '#875c34');
      // vise at the right end
      g.fillStyle = IRON.mid; g.fillRect(x1 - 18, ty1 - 10, 14, 9); g.fillStyle = IRON.light; g.fillRect(x1 - 18, ty1 - 10, 14, 2);
      g.fillStyle = IRON.dark; g.fillRect(x1 - 12, ty1 - 1, 3, 9);
      g.strokeStyle = IRON.light; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x1 - 20, ty1 + 4); g.lineTo(x1 - 6, ty1 + 4); g.stroke();
      // plank being worked + shavings
      g.fillStyle = lin(g, 0, ty0 + 8, 0, ty0 + 16, [[0, '#d8b27a'], [1, '#b08654']]);
      g.save(); g.translate(x0 + 50, ty0 + 14); g.rotate(-0.08); g.fillRect(-26, -4, 52, 8); g.fillStyle = 'rgba(90,58,30,0.5)'; g.fillRect(-26, 3, 52, 1); g.restore();
      g.strokeStyle = '#e2c290'; g.lineWidth = 1;
      for (let i = 0; i < 9; i++) { const x = x0 + 20 + rand() * 70, y = ty0 + 18 + rand() * 12; g.beginPath(); g.arc(x, y, 1.4 + rand(), rand() * 3, rand() * 3 + 3.5); g.stroke(); }
      // hand plane
      g.fillStyle = '#9a6a3a'; g.fillRect(x0 + 84, ty0 + 6, 16, 7); g.fillStyle = IRON.mid; g.fillRect(x0 + 90, ty0 + 4, 3, 4);
      g.fillStyle = '#6a4424'; g.beginPath(); g.ellipse(x0 + 96, ty0 + 5, 3, 2.4, 0, 0, TAU); g.fill();
      // nails pot
      g.fillStyle = '#8a8a90'; g.fillRect(x0 + 10, ty0 + 6, 7, 7); g.fillStyle = '#3a3a40'; g.beginPath(); g.ellipse(x0 + 13.5, ty0 + 6, 3.5, 1.4, 0, 0, TAU); g.fill();
    }, OW);
  });
}

// ---------------- stonecutter (2×1) ----------------
function stonecutter() {
  const rand = rng(502);
  return mk(2, 44, (g, P, Y, W) => {
    const x0 = 6, x1 = W - 6;
    ground(g, W / 2, Y(1, 0) - 4, 60, 10, 0.25);
    P.layer((g) => {
      const ty0 = Y(0.18, 26), ty1 = Y(0.86, 26), fy = Y(0.86, 16), fb = Y(0.86, 0);
      // heavy timber legs
      leg(g, x0 + 8, ty1, fb, 9, WOOD.dark); leg(g, x1 - 8, ty1, fb, 9, WOOD.dark);
      leg(g, x0 + 10, Y(0.3, 16), Y(0.3, 0), 8, WOOD.deep); leg(g, x1 - 10, Y(0.3, 16), Y(0.3, 0), 8, WOOD.deep);
      g.fillStyle = WOOD.dark; g.fillRect(x0 + 8, Y(0.86, 7), x1 - x0 - 16, 4); // stretcher
      // stone slab top
      g.fillStyle = lin(g, x0, ty0, x1, ty1, [[0, '#b9b2a6'], [1, '#8d867b']]);
      g.fillRect(x0, ty0, x1 - x0, ty1 - ty0);
      g.fillStyle = lin(g, 0, ty1, 0, fy, [[0, '#7d776d'], [1, '#5e5951']]); g.fillRect(x0, ty1, x1 - x0, fy - ty1);
      g.fillStyle = 'rgba(255,252,240,0.5)'; g.fillRect(x0, ty0, x1 - x0, 1.4);
      for (let i = 0; i < 18; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(255,255,245,0.3)' : 'rgba(40,36,30,0.3)'; g.fillRect(x0 + 3 + rand() * (x1 - x0 - 6), ty0 + 2 + rand() * (ty1 - ty0 - 4), 1.2, 1.2); }
      // block being dressed (half cut) + chisel & mallet
      const bx = x0 + 22, by = ty0 + 10;
      g.fillStyle = '#a49c8f'; g.fillRect(bx, by, 26, 14); g.fillStyle = '#c4bcae'; g.fillRect(bx, by - 8, 26, 8);
      g.fillStyle = 'rgba(255,255,245,0.45)'; g.fillRect(bx, by - 8, 26, 1.2);
      g.strokeStyle = 'rgba(60,56,50,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(bx + 13, by - 8); g.lineTo(bx + 13, by + 14); g.stroke();
      g.save(); g.translate(bx + 34, by - 2); g.rotate(-0.7);
      g.fillStyle = IRON.light; g.fillRect(-1.2, -10, 2.4, 12); g.fillStyle = '#9a6a3a'; g.fillRect(-1.8, 2, 3.6, 7); g.restore();
      g.save(); g.translate(bx + 48, by + 4); g.rotate(0.5);
      g.fillStyle = '#9a6a3a'; g.fillRect(-1.4, -2, 2.8, 14); g.fillStyle = '#7a5532'; g.fillRect(-6, -8, 12, 7); g.fillStyle = 'rgba(255,230,190,0.35)'; g.fillRect(-6, -8, 12, 1.2); g.restore();
      // dust & chips
      for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(220,214,200,0.7)'; g.beginPath(); circle(g, bx - 6 + rand() * 46, by + 14 + rand() * 6, 0.6 + rand() * 0.9); g.fill(); }
      // stacked dressed blocks at the right end
      const sx = x1 - 30, sy = ty0 + 4;
      for (const [dx, dy] of [[0, 14], [14, 14], [7, 4]]) {
        g.fillStyle = '#9a9286'; g.fillRect(sx + dx, sy + dy, 13, 9);
        g.fillStyle = '#bab2a4'; g.fillRect(sx + dx, sy + dy - 5, 13, 5);
        g.fillStyle = 'rgba(255,255,245,0.4)'; g.fillRect(sx + dx, sy + dy - 5, 13, 1);
        g.fillStyle = 'rgba(30,26,22,0.4)'; g.fillRect(sx + dx + 12, sy + dy - 5, 1, 14);
      }
      // rough stones on the ground
      stoneBlob(g, x0 + 10, Y(1, 2), 7, 4.5, rand, '#8f897e'); stoneBlob(g, x0 + 20, Y(1, 1), 5, 3.5, rand, '#7f796f');
    }, OW);
  });
}

// ---------------- furnace (1×1) ----------------
function furnaceBody(g, Y, W, rand, glowOnly) {
  const cx = W / 2;
  const base = Y(0.95, 0), top = Y(0.95, 46);
  const mouthY = Y(0.95, 8), mouthH = 15, mouthW = 18;
  if (glowOnly) {
    g.fillStyle = rad(g, cx, mouthY - 4, 1, 13, [[0, '#fff3c0'], [0.35, '#ffb347'], [0.8, '#e05a18'], [1, 'rgba(160,40,10,0)']]);
    g.beginPath(); g.moveTo(cx - mouthW / 2, mouthY); g.lineTo(cx - mouthW / 2, mouthY - mouthH + 6); g.quadraticCurveTo(cx, mouthY - mouthH - 3, cx + mouthW / 2, mouthY - mouthH + 6); g.lineTo(cx + mouthW / 2, mouthY); g.closePath(); g.fill();
    // glowing seams between the stones + chimney mouth
    g.strokeStyle = 'rgba(255,140,50,0.55)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx - 13, mouthY - 20); g.lineTo(cx - 6, mouthY - 22); g.moveTo(cx + 5, mouthY - 25); g.lineTo(cx + 12, mouthY - 21); g.stroke();
    g.fillStyle = rad(g, cx + 9, Y(0.55, 66), 0, 7, [[0, 'rgba(255,170,70,0.8)'], [1, 'rgba(255,100,30,0)']]);
    g.fillRect(cx, Y(0.55, 66) - 7, 18, 14);
    return;
  }
  // chimney (behind, back right)
  g.fillStyle = lin(g, cx + 3, 0, cx + 15, 0, [[0, '#8d857a'], [1, '#5f5951']]);
  g.fillRect(cx + 3, Y(0.55, 64), 12, Y(0.55, 12) - Y(0.55, 64));
  for (let y = Y(0.55, 64) + 4; y < Y(0.55, 12); y += 6) { g.fillStyle = 'rgba(30,26,22,0.4)'; g.fillRect(cx + 3, y, 12, 1); }
  g.fillStyle = '#2a2420'; g.beginPath(); g.ellipse(cx + 9, Y(0.55, 64), 6, 2.4, 0, 0, TAU); g.fill();
  g.fillStyle = '#9c948a'; g.fillRect(cx + 2, Y(0.55, 66) - 1, 14, 3);
  // domed body of fieldstones and clay
  g.beginPath();
  g.moveTo(cx - 25, base); g.lineTo(cx - 25, top + 18); g.bezierCurveTo(cx - 25, top - 4, cx + 25, top - 4, cx + 25, top + 18); g.lineTo(cx + 25, base); g.closePath();
  g.fillStyle = lin(g, cx - 25, top, cx + 25, base, [[0, '#b2a08a'], [0.5, '#8f7d6a'], [1, '#5e5246']]); g.fill();
  g.save(); g.clip();
  for (let r = 0; r < 7; r++) {
    const y = top + 2 + r * 7.2, off = r & 1 ? 5 : 0;
    for (let x = cx - 30 + off; x < cx + 28; x += 10) {
      const w = 8 + rand() * 3;
      g.fillStyle = mixc('#a8967f', '#7d6c5a', rand());
      g.beginPath(); g.ellipse(x + w / 2, y + 3, w / 2, 3.2, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,245,225,0.35)'; g.beginPath(); g.ellipse(x + w / 2 - 1, y + 1.8, w / 3, 1.1, 0, 0, TAU); g.fill();
    }
  }
  g.fillStyle = lin(g, cx - 25, 0, cx + 25, 0, [[0, 'rgba(255,240,210,0.15)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(20,14,10,0.4)']]); g.fillRect(cx - 26, top - 4, 52, base - top + 4);
  // soot above the mouth
  g.fillStyle = rad(g, cx, mouthY - mouthH - 2, 0, 14, [[0, 'rgba(20,16,12,0.6)'], [1, 'rgba(20,16,12,0)']]); g.fillRect(cx - 16, mouthY - mouthH - 16, 32, 22);
  g.restore();
  // arched mouth with a stone lintel
  g.fillStyle = '#7a6b5c';
  g.beginPath(); g.moveTo(cx - mouthW / 2 - 4, mouthY + 1); g.lineTo(cx - mouthW / 2 - 4, mouthY - mouthH + 5); g.quadraticCurveTo(cx, mouthY - mouthH - 8, cx + mouthW / 2 + 4, mouthY - mouthH + 5); g.lineTo(cx + mouthW / 2 + 4, mouthY + 1); g.closePath(); g.fill();
  g.fillStyle = '#1c1512';
  g.beginPath(); g.moveTo(cx - mouthW / 2, mouthY); g.lineTo(cx - mouthW / 2, mouthY - mouthH + 6); g.quadraticCurveTo(cx, mouthY - mouthH - 3, cx + mouthW / 2, mouthY - mouthH + 6); g.lineTo(cx + mouthW / 2, mouthY); g.closePath(); g.fill();
  g.fillStyle = '#3a2a20'; g.fillRect(cx - mouthW / 2, mouthY - 3, mouthW, 3); // ash ledge
  // tools: poker leaning + bellows
  g.strokeStyle = IRON.mid; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - 28, base - 1); g.lineTo(cx - 20, top + 10); g.stroke();
  g.fillStyle = '#7a5232'; g.beginPath(); g.moveTo(cx + 20, base + 2); g.lineTo(cx + 30, base - 6); g.lineTo(cx + 26, base - 12); g.lineTo(cx + 16, base - 4); g.closePath(); g.fill();
}
function furnace(glow) {
  const rand = rng(503);
  return mk(1, 60, (g, P, Y, W) => {
    if (glow) { furnaceBody(g, Y, W, rand, true); return; }
    ground(g, W / 2, Y(0.98, 0), 30, 7, 0.3);
    P.layer((g) => furnaceBody(g, Y, W, rand, false), OW);
  }, glow ? { pad: 12 } : undefined);
}

// ---------------- anvil ----------------
function anvil() {
  return mk(1, 26, (g, P, Y, W) => {
    const cx = W / 2;
    P.layer((g) => {
      // stump base
      const sb = Y(0.9, 0), st = Y(0.9, 18);
      g.fillStyle = lin(g, cx - 12, 0, cx + 12, 0, [[0, '#9c6e43'], [0.5, '#7d5532'], [1, '#4a301a']]);
      g.beginPath(); g.moveTo(cx - 13, sb); g.lineTo(cx - 11, st); g.lineTo(cx + 11, st); g.lineTo(cx + 13, sb); g.ellipse(cx, sb, 13, 4, 0, 0, Math.PI); g.fill();
      g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 0.8; for (let i = 0; i < 4; i++) { const x = cx - 8 + i * 5.5; g.beginPath(); g.moveTo(x, st + 3); g.lineTo(x + 0.5, sb - 1); g.stroke(); }
      g.fillStyle = '#c49a64'; g.beginPath(); g.ellipse(cx, st, 11, 4, 0, 0, TAU); g.fill();
      // anvil: horn on the left, heel on the right
      const ay = st - 3;
      g.fillStyle = IRON.dark; g.beginPath(); g.moveTo(cx - 7, ay); g.lineTo(cx - 5, ay - 9); g.lineTo(cx + 5, ay - 9); g.lineTo(cx + 7, ay); g.closePath(); g.fill(); // waist
      g.fillStyle = lin(g, 0, ay - 16, 0, ay - 8, [[0, IRON.high], [0.3, IRON.light], [1, IRON.mid]]);
      g.beginPath(); g.moveTo(cx - 9, ay - 15); g.lineTo(cx + 12, ay - 15); g.lineTo(cx + 12, ay - 9); g.lineTo(cx - 9, ay - 9);
      g.quadraticCurveTo(cx - 18, ay - 10, cx - 23, ay - 14); g.quadraticCurveTo(cx - 17, ay - 15.5, cx - 9, ay - 15); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(cx - 8, ay - 15, 19, 1.2);
      g.fillStyle = '#26262b'; g.fillRect(cx + 6, ay - 14.5, 2.4, 2); // hardy hole
      g.fillStyle = IRON.mid; g.fillRect(cx - 9, ay - 3, 18, 3);
      // hammer resting on the face
      g.fillStyle = '#8a5a30'; g.save(); g.translate(cx + 2, ay - 17); g.rotate(-0.25); g.fillRect(-1.2, -1, 13, 2.4); g.fillStyle = IRON.mid; g.fillRect(-4, -3, 5, 6); g.restore();
    }, OW);
  });
}

// ---------------- loom (2×1) ----------------
function loom() {
  const rand = rng(504);
  return mk(2, 58, (g, P, Y, W) => {
    const x0 = 14, x1 = W - 14;
    P.layer((g) => {
      const fy = Y(0.6, 0), topY = Y(0.6, 70);
      // side frames (uprights + feet)
      for (const x of [x0, x1]) {
        leg(g, x, topY, fy, 6, WOOD.mid);
        g.fillStyle = WOOD.dark; g.fillRect(x - 6, fy - 4, 12, 4);
      }
      // top beam & cloth beam
      g.fillStyle = lin(g, 0, topY, 0, topY + 6, [[0, WOOD.high], [1, WOOD.dark]]); g.fillRect(x0 - 4, topY, x1 - x0 + 8, 6);
      const clothTop = Y(0.6, 46), clothBot = Y(0.6, 22);
      // warp threads
      g.strokeStyle = 'rgba(236,226,200,0.9)'; g.lineWidth = 0.8;
      g.beginPath(); for (let x = x0 + 6; x < x1 - 4; x += 2.6) { g.moveTo(x, topY + 6); g.lineTo(x, clothTop); } g.stroke();
      // heddle bar
      g.fillStyle = WOOD.light; g.fillRect(x0 + 2, Y(0.6, 56), x1 - x0 - 4, 3);
      // woven cloth (striped)
      const cols = ['#b5523a', '#d9c9a0', '#3f6a8a', '#d9c9a0', '#b5523a'];
      for (let i = 0; i < 5; i++) {
        const y = clothTop + (i * (clothBot - clothTop)) / 5;
        g.fillStyle = cols[i]; g.fillRect(x0 + 5, y, x1 - x0 - 10, (clothBot - clothTop) / 5 + 0.5);
      }
      g.strokeStyle = 'rgba(40,24,12,0.18)'; g.lineWidth = 0.6;
      g.beginPath(); for (let y = clothTop + 1.5; y < clothBot; y += 2) { g.moveTo(x0 + 5, y); g.lineTo(x1 - 5, y); } g.stroke();
      g.fillStyle = 'rgba(255,250,235,0.25)'; g.fillRect(x0 + 5, clothTop, x1 - x0 - 10, 2);
      // cloth roll beam
      g.fillStyle = lin(g, 0, clothBot, 0, clothBot + 7, [[0, '#c9b78e'], [1, '#8c7a58']]); g.fillRect(x0 - 2, clothBot, x1 - x0 + 4, 7);
      // shuttle
      g.fillStyle = '#c49a64'; g.beginPath(); g.ellipse(W / 2 + 10, clothTop - 2, 9, 2.4, 0, 0, TAU); g.fill();
      // bench in front
      const bt = Y(0.95, 14);
      g.fillStyle = lin(g, 0, bt - 6, 0, bt, [[0, '#a77a48'], [1, '#7a5232']]); g.fillRect(W / 2 - 22, bt - 6, 44, 6);
      leg(g, W / 2 - 18, bt, Y(0.95, 0), 4); leg(g, W / 2 + 18, bt, Y(0.95, 0), 4);
      // basket of cotton at the side
      const bx = x1 + 2, byy = Y(0.9, 0);
      g.fillStyle = '#a0804e'; g.beginPath(); g.moveTo(bx - 9, byy - 12); g.lineTo(bx + 9, byy - 12); g.lineTo(bx + 7, byy); g.lineTo(bx - 7, byy); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(70,50,24,0.6)'; g.lineWidth = 0.7; g.beginPath(); for (let y = byy - 9; y < byy; y += 3) { g.moveTo(bx - 8, y); g.lineTo(bx + 8, y); } g.stroke();
      for (let i = 0; i < 5; i++) { g.fillStyle = i & 1 ? '#f4f0e6' : '#e2dccd'; g.beginPath(); circle(g, bx - 6 + i * 3, byy - 13 - (i & 1) * 2, 3); g.fill(); }
    }, OW);
  });
}

// ---------------- cooking pot (1×1) ----------------
function cookingPot(coals) {
  const rand = rng(505);
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, cy = Y(0.62, 0);
    if (coals) {
      for (let i = 0; i < 9; i++) { g.fillStyle = i & 1 ? '#ff8a2a' : '#ffc860'; g.beginPath(); circle(g, cx + (rand() - 0.5) * 22, cy + (rand() - 0.5) * 6, 1 + rand() * 1.3); g.fill(); }
      g.fillStyle = rad(g, cx, cy, 0, 16, [[0, 'rgba(255,140,40,0.55)'], [1, 'rgba(255,80,20,0)']]); g.fillRect(cx - 16, cy - 8, 32, 16);
      return;
    }
    P.layer((g) => {
      // ash bed + stones ring (back half)
      g.fillStyle = rad(g, cx, cy, 2, 22, [[0, '#2a221c'], [0.7, '#46403a'], [1, '#5d5650']]); g.beginPath(); g.ellipse(cx, cy, 20, 8, 0, 0, TAU); g.fill();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; if (Math.sin(a) < 0) stoneBlob(g, cx + Math.cos(a) * 21, cy + Math.sin(a) * 8.5, 5, 3.6, rand); }
      // logs
      g.fillStyle = WOOD.mid; g.save(); g.translate(cx, cy); g.rotate(0.25); g.fillRect(-15, -2.5, 30, 5); g.rotate(-0.5); g.fillRect(-15, -2.5, 30, 5); g.restore();
      g.fillStyle = 'rgba(20,14,10,0.7)'; g.fillRect(cx - 6, cy - 3, 12, 6);
    }, 2.2);
    P.layer((g) => {
      // tripod legs
      g.strokeStyle = '#7d5532'; g.lineWidth = 3; g.lineCap = 'round';
      const apex = [cx, Y(0.55, 60)];
      g.beginPath(); g.moveTo(cx - 24, Y(0.85, 0)); g.lineTo(apex[0], apex[1]); g.moveTo(cx + 24, Y(0.85, 0)); g.lineTo(apex[0], apex[1]); g.moveTo(cx + 3, Y(0.25, 0)); g.lineTo(apex[0], apex[1]); g.stroke();
      g.strokeStyle = '#c9b48a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - 4, apex[1] + 1); g.lineTo(cx + 4, apex[1] + 3); g.stroke(); // lashing
      // chain
      g.strokeStyle = IRON.light; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, apex[1] + 2); g.lineTo(cx, Y(0.62, 36)); g.stroke();
      // cauldron
      const py = Y(0.62, 22);
      g.fillStyle = lin(g, cx - 15, 0, cx + 15, 0, [[0, '#55555e'], [0.35, '#3a3a42'], [1, '#18181c']]);
      g.beginPath(); g.moveTo(cx - 15, py - 10); g.bezierCurveTo(cx - 17, py + 10, cx + 17, py + 10, cx + 15, py - 10); g.closePath(); g.fill();
      g.strokeStyle = IRON.light; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, py - 14, 13, Math.PI * 0.15, Math.PI * 0.85, true); g.stroke(); // bail handle
      g.fillStyle = '#26262c'; g.beginPath(); g.ellipse(cx, py - 10, 15.5, 4.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#8a5a2a'; g.beginPath(); g.ellipse(cx, py - 9.6, 12.5, 3, 0, 0, TAU); g.fill(); // stew
      g.fillStyle = '#b07a3a'; for (let i = 0; i < 4; i++) { g.beginPath(); circle(g, cx - 7 + i * 4.5, py - 9.8 + (i & 1) * 0.8, 1.2); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(cx - 9, py - 4, 2, 4, 0.2, 0, TAU); g.fill();
      // ladle
      g.strokeStyle = '#9a6a3a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + 5, py - 10); g.lineTo(cx + 13, py - 22); g.stroke();
    }, 2.6);
    P.layer((g) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; if (Math.sin(a) >= 0) stoneBlob(g, cx + Math.cos(a) * 21, cy + Math.sin(a) * 8.5, 5.4, 3.8, rand); } }, 2.4);
  }, coals ? { pad: 12 } : undefined);
}

// ---------------- table, chair, rug, flower pot ----------------
function table() {
  const rand = rng(506);
  return mk(2, 30, (g, P, Y, W) => {
    const x0 = 8, x1 = W - 8;
    P.layer((g) => {
      const ty0 = Y(0.15, 27), ty1 = Y(0.85, 27), ay = Y(0.85, 21), fb = Y(0.85, 0);
      leg(g, x0 + 6, Y(0.25, 21), Y(0.25, 0), 4, WOOD.dark); leg(g, x1 - 6, Y(0.25, 21), Y(0.25, 0), 4, WOOD.dark);
      leg(g, x0 + 5, ay, fb, 5.5); leg(g, x1 - 5, ay, fb, 5.5);
      plankTop(g, x0, ty0, x1, ty1, '#a87a48', 'x', 3);
      apron(g, x0, x1, ty1, ay, '#7d5532');
      // runner cloth
      g.fillStyle = '#d9cfb6'; g.fillRect(W / 2 - 14, ty0, 28, ty1 - ty0);
      g.fillStyle = '#a3473a'; g.fillRect(W / 2 - 14, ty0, 2, ty1 - ty0); g.fillRect(W / 2 + 12, ty0, 2, ty1 - ty0);
      g.fillStyle = '#d9cfb6'; g.fillRect(W / 2 - 14, ty1, 28, 6);
      // plate + bread, mug, candle
      g.fillStyle = '#e8e2d4'; g.beginPath(); g.ellipse(W / 2 - 30, ty0 + 20, 8, 4, 0, 0, TAU); g.fill();
      g.fillStyle = '#c08a48'; g.beginPath(); g.ellipse(W / 2 - 31, ty0 + 18.5, 5, 2.6, 0, 0, TAU); g.fill();
      g.fillStyle = '#8a5a30'; g.fillRect(W / 2 + 22, ty0 + 12, 7, 9); g.fillStyle = '#5a3a1e'; g.beginPath(); g.ellipse(W / 2 + 25.5, ty0 + 12, 3.5, 1.4, 0, 0, TAU); g.fill();
      g.strokeStyle = '#8a5a30'; g.lineWidth = 1.2; g.beginPath(); g.arc(W / 2 + 30, ty0 + 16, 2.4, -1.3, 1.3); g.stroke();
      g.fillStyle = '#f2ead6'; g.fillRect(W / 2 - 2, ty0 + 6, 4, 9); g.fillStyle = '#c9a24a'; g.beginPath(); g.ellipse(W / 2, ty0 + 15, 5, 1.8, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffd27a'; g.beginPath(); g.ellipse(W / 2, ty0 + 3.5, 1.4, 2.6, 0, 0, TAU); g.fill();
    }, OW);
  });
}
function chair() {
  return mk(1, 34, (g, P, Y, W) => {
    const cx = W / 2;
    P.layer((g) => {
      const sy0 = Y(0.35, 17), sy1 = Y(0.8, 17), fb = Y(0.8, 0);
      // back legs + backrest
      leg(g, cx - 11, Y(0.35, 46), Y(0.35, 0), 4, WOOD.dark); leg(g, cx + 11, Y(0.35, 46), Y(0.35, 0), 4, WOOD.dark);
      g.fillStyle = lin(g, 0, Y(0.35, 46), 0, Y(0.35, 36), [[0, WOOD.high], [1, WOOD.mid]]); g.fillRect(cx - 13, Y(0.35, 46), 26, 7);
      g.fillStyle = WOOD.mid; g.fillRect(cx - 4, Y(0.35, 39), 3, 18); g.fillRect(cx + 2, Y(0.35, 39), 3, 18);
      // front legs, seat
      leg(g, cx - 11, sy1, fb, 4.4); leg(g, cx + 11, sy1, fb, 4.4);
      plankTop(g, cx - 14, sy0, cx + 14, sy1, '#b08250', 'x', 2);
      apron(g, cx - 14, cx + 14, sy1, sy1 + 4, '#7d5532');
    }, OW);
  });
}
function rug(v) {
  const rand = rng(507 + v);
  const pal = [['#8e3b2e', '#c9a05a', '#e6d7b0', '#3b4f6a'], ['#3f5e78', '#d8c79a', '#efe6cc', '#8e3b2e']][v % 2];
  return spritePx(128, 64, (g) => {
    const x0 = 6, y0 = 8, x1 = 122, y1 = 56;
    // fringe
    g.strokeStyle = pal[2]; g.lineWidth = 1;
    g.beginPath(); for (let y = y0 + 2; y < y1 - 1; y += 2.6) { g.moveTo(x0, y); g.lineTo(x0 - 4, y + 0.5); g.moveTo(x1, y); g.lineTo(x1 + 4, y + 0.5); } g.stroke();
    g.fillStyle = 'rgba(20,12,8,0.35)'; g.fillRect(x0 + 1, y0 + 2, x1 - x0, y1 - y0); // ground contact
    g.fillStyle = pal[0]; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = pal[1]; g.lineWidth = 2.4; g.strokeRect(x0 + 4, y0 + 4, x1 - x0 - 8, y1 - y0 - 8);
    g.strokeStyle = pal[3]; g.lineWidth = 1.2; g.strokeRect(x0 + 8, y0 + 8, x1 - x0 - 16, y1 - y0 - 16);
    // central medallion + diamonds
    const cx = 64, cy = 32;
    g.fillStyle = pal[1]; g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 22, cy); g.lineTo(cx, cy + 13); g.lineTo(cx - 22, cy); g.closePath(); g.fill();
    g.fillStyle = pal[3]; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 13, cy); g.lineTo(cx, cy + 8); g.lineTo(cx - 13, cy); g.closePath(); g.fill();
    g.fillStyle = pal[2]; g.beginPath(); circle(g, cx, cy, 3); g.fill();
    for (const dx of [-40, 40]) { g.fillStyle = pal[1]; g.beginPath(); g.moveTo(cx + dx, cy - 7); g.lineTo(cx + dx + 8, cy); g.lineTo(cx + dx, cy + 7); g.lineTo(cx + dx - 8, cy); g.closePath(); g.fill(); }
    // weave texture
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 0.6;
    g.beginPath(); for (let x = x0 + 1; x < x1; x += 2) { g.moveTo(x, y0); g.lineTo(x, y1); } g.stroke();
    g.fillStyle = 'rgba(255,245,220,0.08)'; g.fillRect(x0, y0, x1 - x0, 3);
    g.strokeStyle = 'rgba(30,18,12,0.6)'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }, { crop: false });
}
function flowerPot(v) {
  const rand = rng(508 + v);
  const pet = [['#c8323a', '#f06a5a'], ['#e8b020', '#ffe07a'], ['#5a6ad0', '#9aa8f0']][v % 3];
  return mk(0.6, 18, (g, P, Y, W) => {
    const cx = W / 2, base = Y(0.85, 0);
    P.layer((g) => {
      // leaves
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.2;
        g.fillStyle = i & 1 ? '#557a32' : '#6a9040';
        g.beginPath(); leaf(g, cx, base - 15, cx + Math.cos(a) * 13, base - 15 + Math.sin(a) * 12, 3.4, (rand() - 0.5) * 3); g.fill();
      }
      // blooms
      for (let i = 0; i < 4; i++) {
        const x = cx + (i - 1.5) * 5.5 + (rand() - 0.5) * 2, y = base - 24 - rand() * 7;
        for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; g.fillStyle = pet[0]; g.beginPath(); g.ellipse(x + Math.cos(a) * 2.2, y + Math.sin(a) * 1.9, 2, 1.4, a, 0, TAU); g.fill(); }
        g.fillStyle = pet[1]; g.beginPath(); circle(g, x - 0.6, y - 0.6, 1.4); g.fill();
        g.fillStyle = '#f6e27a'; g.beginPath(); circle(g, x, y, 0.8); g.fill();
      }
      // terracotta pot
      g.fillStyle = lin(g, cx - 9, 0, cx + 9, 0, [[0, '#d98a5a'], [0.5, '#b8653a'], [1, '#7e3f22']]);
      g.beginPath(); g.moveTo(cx - 9, base - 15); g.lineTo(cx + 9, base - 15); g.lineTo(cx + 6.5, base); g.lineTo(cx - 6.5, base); g.closePath(); g.fill();
      g.fillStyle = '#c87448'; g.fillRect(cx - 10, base - 17, 20, 4);
      g.fillStyle = 'rgba(255,230,200,0.4)'; g.fillRect(cx - 10, base - 17, 20, 1);
      g.fillStyle = '#4a3020'; g.beginPath(); g.ellipse(cx, base - 16.6, 8, 1.4, 0, 0, TAU); g.fill();
    }, 2.4);
  });
}

// ---------------- facing variants (rotation): <type>_n (front north), <type>_e (front east, footprint 1×2) ----------------
// N-S footprints use a box `ht` tiles deep: Y(v, h) with v in 0..ht (0 = north edge of the footprint)
const mkv = (wt, ht, E, fn) => spritePx(Math.round(wt * 64), Math.round(ht * 64) + E, (g, P) => fn(g, P, (v, h) => E + v * 64 - h, Math.round(wt * 64)), { pad: 12 });

// workbench turned north: we see the back of the tool board standing on the near (south) edge
function workbenchN() {
  const rand = rng(511);
  return mk(2, 50, (g, P, Y, W) => {
    const x0 = 6, x1 = W - 6;
    P.layer((g) => {
      const ty0 = Y(0.14, 30), ty1 = Y(0.8, 30), fb = Y(0.8, 0);
      leg(g, x0 + 7, Y(0.2, 22), Y(0.2, 0), 5, WOOD.dark); leg(g, x1 - 7, Y(0.2, 22), Y(0.2, 0), 5, WOOD.dark);
      leg(g, x0 + 4, ty1, fb, 6); leg(g, x1 - 4, ty1, fb, 6);
      plankTop(g, x0, ty0, x1, ty1, '#b6874f', 'x', 4);
      // planks and shavings on the top (far half visible)
      g.fillStyle = lin(g, 0, ty0 + 4, 0, ty0 + 12, [[0, '#d8b27a'], [1, '#b08654']]);
      g.save(); g.translate(x0 + 46, ty0 + 9); g.rotate(0.06); g.fillRect(-24, -4, 48, 8); g.restore();
      g.strokeStyle = '#e2c290'; g.lineWidth = 1;
      for (let i = 0; i < 7; i++) { const x = x0 + 18 + rand() * 80, y = ty0 + 4 + rand() * 10; g.beginPath(); g.arc(x, y, 1.3 + rand(), rand() * 3, rand() * 3 + 3.5); g.stroke(); }
      g.fillStyle = IRON.mid; g.fillRect(x0 + 6, ty0 + 3, 12, 8); g.fillStyle = IRON.light; g.fillRect(x0 + 6, ty0 + 3, 12, 2); // vise
      // back of the tool board on the near edge: boards, battens and the tool hooks poking through
      const by0 = Y(0.86, 46), by1 = Y(0.86, 14);
      g.fillStyle = lin(g, 0, by0, 0, by1, [[0, '#7a5434'], [1, '#5c3d22']]);
      g.fillRect(x0 + 8, by0, x1 - x0 - 16, by1 - by0);
      g.strokeStyle = 'rgba(30,18,8,0.55)'; g.lineWidth = 1;
      for (let x = x0 + 20; x < x1 - 10; x += 13) { g.beginPath(); g.moveTo(x, by0 + 1); g.lineTo(x, by1 - 1); g.stroke(); }
      g.fillStyle = WOOD.mid; g.fillRect(x0 + 8, by0 + 6, x1 - x0 - 16, 4); g.fillRect(x0 + 8, by1 - 9, x1 - x0 - 16, 4);
      g.strokeStyle = WOOD.light; g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 12, by1 - 9); g.lineTo(x1 - 12, by0 + 10); g.stroke();
      g.fillStyle = '#2e2e32'; for (let x = x0 + 16; x < x1 - 12; x += 9) { g.beginPath(); circle(g, x, by0 + 14, 0.9); g.fill(); }
      g.fillStyle = 'rgba(255,230,190,0.3)'; g.fillRect(x0 + 8, by0, x1 - x0 - 16, 1.2);
      leg(g, x0 + 10, by0 - 2, Y(0.86, 0), 4); leg(g, x1 - 10, by0 - 2, Y(0.86, 0), 4);
    }, OW);
  });
}

// workbench turned east (1×2): long bench running north-south, vise on the near end, tools on the top
function workbenchE() {
  const rand = rng(512);
  return mkv(1, 2, 36, (g, P, Y, W) => {
    const x0 = 9, x1 = W - 9;
    P.layer((g) => {
      const ty0 = Y(0.1, 30), ty1 = Y(1.86, 30), ay = Y(1.86, 22), fb = Y(1.86, 0);
      leg(g, x0 + 3, Y(0.18, 22), Y(0.18, 0), 5, WOOD.dark); leg(g, x1 - 3, Y(0.18, 22), Y(0.18, 0), 5, WOOD.dark);
      // lower shelf with planks
      plankTop(g, x0 + 3, Y(0.5, 8), x1 - 3, Y(1.8, 8), '#7e5532', 'y', 2);
      g.fillStyle = '#a77a48'; g.fillRect(x0 + 8, Y(1.0, 14), 6, 40); g.fillRect(x0 + 16, Y(1.1, 18), 6, 38);
      leg(g, x0 + 3, ty1, fb, 6); leg(g, x1 - 3, ty1, fb, 6);
      plankTop(g, x0, ty0, x1, ty1, '#b6874f', 'y', 3);
      apron(g, x0, x1, ty1, ay, '#875c34');
      // tools: saw, hammer, plane, a plank being worked + shavings
      g.fillStyle = '#b8bcc4'; g.beginPath(); g.moveTo(x0 + 8, ty0 + 10); g.lineTo(x0 + 14, ty0 + 34); g.lineTo(x0 + 20, ty0 + 33); g.lineTo(x0 + 13, ty0 + 9); g.closePath(); g.fill();
      g.fillStyle = '#8a5a30'; g.fillRect(x0 + 10, ty0 + 3, 7, 8);
      g.fillStyle = lin(g, x0 + 22, 0, x0 + 32, 0, [[0, '#d8b27a'], [1, '#b08654']]); g.fillRect(x0 + 24, ty0 + 30, 9, 50);
      g.fillStyle = 'rgba(90,58,30,0.5)'; g.fillRect(x0 + 32, ty0 + 30, 1, 50);
      g.fillStyle = '#9a6a3a'; g.fillRect(x0 + 8, ty0 + 52, 7, 15); g.fillStyle = IRON.mid; g.fillRect(x0 + 6, ty0 + 57, 4, 3);
      g.fillStyle = '#8a5a30'; g.fillRect(x0 + 10, ty0 + 80, 3, 16); g.fillStyle = IRON.mid; g.fillRect(x0 + 7, ty0 + 77, 9, 5);
      g.strokeStyle = '#e2c290'; g.lineWidth = 1;
      for (let i = 0; i < 8; i++) { const x = x0 + 6 + rand() * 30, y = ty0 + 40 + rand() * 50; g.beginPath(); g.arc(x, y, 1.3 + rand(), rand() * 3, rand() * 3 + 3.5); g.stroke(); }
      // vise on the near (south) end
      g.fillStyle = IRON.mid; g.fillRect(x1 - 16, ty1 - 10, 13, 9); g.fillStyle = IRON.light; g.fillRect(x1 - 16, ty1 - 10, 13, 2);
      g.fillStyle = IRON.dark; g.fillRect(x1 - 11, ty1 - 1, 3, 8);
      // nails pot at the far end
      g.fillStyle = '#8a8a90'; g.fillRect(x1 - 14, ty0 + 6, 7, 7); g.fillStyle = '#3a3a40'; g.beginPath(); g.ellipse(x1 - 10.5, ty0 + 6, 3.5, 1.4, 0, 0, TAU); g.fill();
    }, OW);
  });
}

// stonecutter turned east (1×2): stone slab table north-south
function stonecutterE() {
  const rand = rng(513);
  return mkv(1, 2, 30, (g, P, Y, W) => {
    const x0 = 8, x1 = W - 8;
    ground(g, W / 2, Y(2, 0) - 4, 34, 12, 0.25);
    P.layer((g) => {
      const ty0 = Y(0.12, 26), ty1 = Y(1.86, 26), fy = Y(1.86, 16), fb = Y(1.86, 0);
      leg(g, x0 + 5, Y(0.25, 16), Y(0.25, 0), 8, WOOD.deep); leg(g, x1 - 5, Y(0.25, 16), Y(0.25, 0), 8, WOOD.deep);
      leg(g, x0 + 5, ty1, fb, 9, WOOD.dark); leg(g, x1 - 5, ty1, fb, 9, WOOD.dark);
      g.fillStyle = lin(g, x0, ty0, x1, ty1, [[0, '#b9b2a6'], [1, '#8d867b']]); g.fillRect(x0, ty0, x1 - x0, ty1 - ty0);
      g.fillStyle = lin(g, 0, ty1, 0, fy, [[0, '#7d776d'], [1, '#5e5951']]); g.fillRect(x0, ty1, x1 - x0, fy - ty1);
      g.fillStyle = 'rgba(255,252,240,0.5)'; g.fillRect(x0, ty0, x1 - x0, 1.4);
      for (let i = 0; i < 16; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(255,255,245,0.3)' : 'rgba(40,36,30,0.3)'; g.fillRect(x0 + 3 + rand() * (x1 - x0 - 6), ty0 + 2 + rand() * (ty1 - ty0 - 4), 1.2, 1.2); }
      // block being dressed + chisel
      const bx = x0 + 10, by = ty0 + 48;
      g.fillStyle = '#a49c8f'; g.fillRect(bx, by, 26, 14); g.fillStyle = '#c4bcae'; g.fillRect(bx, by - 8, 26, 8);
      g.fillStyle = 'rgba(255,255,245,0.45)'; g.fillRect(bx, by - 8, 26, 1.2);
      g.save(); g.translate(bx + 30, by + 2); g.rotate(-0.4); g.fillStyle = IRON.light; g.fillRect(-1.2, -10, 2.4, 12); g.fillStyle = '#9a6a3a'; g.fillRect(-1.8, 2, 3.6, 7); g.restore();
      // stacked dressed blocks at the far end
      for (const [dx, dy] of [[2, 16], [16, 16], [9, 6]]) {
        g.fillStyle = '#9a9286'; g.fillRect(x0 + dx, ty0 + dy, 13, 9);
        g.fillStyle = '#bab2a4'; g.fillRect(x0 + dx, ty0 + dy - 5, 13, 5);
        g.fillStyle = 'rgba(255,255,245,0.4)'; g.fillRect(x0 + dx, ty0 + dy - 5, 13, 1);
      }
      for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(220,214,200,0.7)'; g.beginPath(); circle(g, bx - 4 + rand() * 36, by + 16 + rand() * 20, 0.6 + rand() * 0.9); g.fill(); }
      stoneBlob(g, x1 - 2, Y(1.98, 2), 6, 4, rand, '#8f897e');
    }, OW);
  });
}

// loom turned north: the weaver's bench behind the frame
function loomN() {
  return mk(2, 58, (g, P, Y, W) => {
    const x0 = 14, x1 = W - 14;
    P.layer((g) => {
      const bt = Y(0.22, 14);
      g.fillStyle = lin(g, 0, bt - 6, 0, bt, [[0, '#a77a48'], [1, '#7a5232']]); g.fillRect(W / 2 - 22, bt - 6, 44, 6);
      leg(g, W / 2 - 18, bt, Y(0.22, 0), 4); leg(g, W / 2 + 18, bt, Y(0.22, 0), 4);
      const fy = Y(0.6, 0), topY = Y(0.6, 70);
      for (const x of [x0, x1]) { leg(g, x, topY, fy, 6, WOOD.mid); g.fillStyle = WOOD.dark; g.fillRect(x - 6, fy - 4, 12, 4); }
      g.fillStyle = lin(g, 0, topY, 0, topY + 6, [[0, WOOD.high], [1, WOOD.dark]]); g.fillRect(x0 - 4, topY, x1 - x0 + 8, 6);
      const clothTop = Y(0.6, 46), clothBot = Y(0.6, 22);
      g.strokeStyle = 'rgba(236,226,200,0.9)'; g.lineWidth = 0.8;
      g.beginPath(); for (let x = x0 + 6; x < x1 - 4; x += 2.6) { g.moveTo(x, topY + 6); g.lineTo(x, clothTop); } g.stroke();
      g.fillStyle = WOOD.light; g.fillRect(x0 + 2, Y(0.6, 56), x1 - x0 - 4, 3);
      // back of the cloth: same stripes, a little duller
      const cols = ['#9c4733', '#c9b993', '#38607e', '#c9b993', '#9c4733'];
      for (let i = 0; i < 5; i++) { const y = clothTop + (i * (clothBot - clothTop)) / 5; g.fillStyle = cols[i]; g.fillRect(x0 + 5, y, x1 - x0 - 10, (clothBot - clothTop) / 5 + 0.5); }
      g.strokeStyle = 'rgba(40,24,12,0.22)'; g.lineWidth = 0.6;
      g.beginPath(); for (let x = x0 + 6; x < x1 - 4; x += 2.6) { g.moveTo(x, clothTop); g.lineTo(x, clothBot); } g.stroke();
      g.fillStyle = lin(g, 0, clothBot, 0, clothBot + 7, [[0, '#c9b78e'], [1, '#8c7a58']]); g.fillRect(x0 - 2, clothBot, x1 - x0 + 4, 7);
      // basket of cotton on the left
      const bx = x0 - 2, byy = Y(0.95, 0);
      g.fillStyle = '#a0804e'; g.beginPath(); g.moveTo(bx - 9, byy - 12); g.lineTo(bx + 9, byy - 12); g.lineTo(bx + 7, byy); g.lineTo(bx - 7, byy); g.closePath(); g.fill();
      for (let i = 0; i < 5; i++) { g.fillStyle = i & 1 ? '#f4f0e6' : '#e2dccd'; g.beginPath(); circle(g, bx - 6 + i * 3, byy - 13 - (i & 1) * 2, 3); g.fill(); }
    }, OW);
  });
}

// loom turned east (1×2): the frame seen slightly from its side, bench on the east
function loomE() {
  return mkv(1, 2, 60, (g, P, Y, W) => {
    const xf = 22;
    P.layer((g) => {
      const vb = 0.25, vf = 1.7, h = 70;
      // posts (far and near) + top beam + feet
      leg(g, xf - 12, Y(vb, h), Y(vb, 0), 5, WOOD.dark);
      g.fillStyle = WOOD.dark; g.fillRect(xf - 20, Y(vb, 0) - 3, 16, 4);
      // cloth panel (a narrow parallelogram between the posts)
      const ct = 46, cb = 22;
      const quad = (va, vb2, ha, hb, fill) => { g.fillStyle = fill; g.beginPath(); g.moveTo(xf - 10, Y(va, ha)); g.lineTo(xf + 10, Y(vb2, ha)); g.lineTo(xf + 10, Y(vb2, hb)); g.lineTo(xf - 10, Y(va, hb)); g.closePath(); g.fill(); };
      g.strokeStyle = 'rgba(236,226,200,0.85)'; g.lineWidth = 0.8;
      g.beginPath(); for (let k = 0; k <= 10; k++) { const v = vb + ((vf - vb) * k) / 10, x = xf - 10 + 20 * (k / 10); g.moveTo(x, Y(v, h - 6)); g.lineTo(x, Y(v, ct)); } g.stroke();
      const cols = ['#b5523a', '#d9c9a0', '#3f6a8a', '#d9c9a0', '#b5523a'];
      for (let i = 0; i < 5; i++) quad(vb, vf, ct - (i * (ct - cb)) / 5, ct - ((i + 1) * (ct - cb)) / 5, cols[i]);
      g.fillStyle = lin(g, 0, Y(vf, cb), 0, Y(vf, cb - 6), [[0, '#c9b78e'], [1, '#8c7a58']]); quad(vb, vf, cb, cb - 6, '#b4a27c');
      g.strokeStyle = WOOD.high; g.lineWidth = 5; g.beginPath(); g.moveTo(xf - 12, Y(vb, h)); g.lineTo(xf + 12, Y(vf, h)); g.stroke();
      leg(g, xf + 12, Y(vf, h), Y(vf, 0), 6, WOOD.mid);
      g.fillStyle = WOOD.dark; g.fillRect(xf + 4, Y(vf, 0) - 4, 16, 4);
      // bench on the east, running north-south
      const bx0 = 40, bx1 = 56;
      g.fillStyle = lin(g, bx0, 0, bx1, 0, [[0, '#a77a48'], [1, '#7a5232']]); g.fillRect(bx0, Y(0.6, 14), bx1 - bx0, Y(1.5, 14) - Y(0.6, 14));
      g.fillStyle = '#7a5232'; g.fillRect(bx0, Y(1.5, 14), bx1 - bx0, 5);
      leg(g, bx0 + 3, Y(1.5, 9), Y(1.5, 0), 4); leg(g, bx1 - 3, Y(1.5, 9), Y(1.5, 0), 4);
      // basket at the far end
      const byy = Y(0.3, 0), bx = 46;
      g.fillStyle = '#a0804e'; g.beginPath(); g.moveTo(bx - 8, byy - 11); g.lineTo(bx + 8, byy - 11); g.lineTo(bx + 6, byy); g.lineTo(bx - 6, byy); g.closePath(); g.fill();
      for (let i = 0; i < 4; i++) { g.fillStyle = i & 1 ? '#f4f0e6' : '#e2dccd'; g.beginPath(); circle(g, bx - 5 + i * 3.4, byy - 12 - (i & 1) * 2, 2.8); g.fill(); }
    }, OW);
  });
}

// table turned (1×2)
function tableE() {
  return mkv(1, 2, 30, (g, P, Y, W) => {
    const x0 = 10, x1 = W - 10;
    P.layer((g) => {
      const ty0 = Y(0.12, 27), ty1 = Y(1.86, 27), ay = Y(1.86, 21), fb = Y(1.86, 0);
      leg(g, x0 + 4, Y(0.25, 21), Y(0.25, 0), 4, WOOD.dark); leg(g, x1 - 4, Y(0.25, 21), Y(0.25, 0), 4, WOOD.dark);
      leg(g, x0 + 4, ay, fb, 5.5); leg(g, x1 - 4, ay, fb, 5.5);
      plankTop(g, x0, ty0, x1, ty1, '#a87a48', 'y', 3);
      apron(g, x0, x1, ty1, ay, '#7d5532');
      // runner cloth along the table
      const cx = W / 2;
      g.fillStyle = '#d9cfb6'; g.fillRect(cx - 9, ty0, 18, ty1 - ty0); g.fillRect(cx - 9, ty1, 18, 6);
      g.fillStyle = '#a3473a'; g.fillRect(cx - 9, ty0, 2, ty1 - ty0); g.fillRect(cx + 7, ty0, 2, ty1 - ty0);
      // plate + bread, mug, candle
      g.fillStyle = '#e8e2d4'; g.beginPath(); g.ellipse(cx, ty0 + 24, 9, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#c08a48'; g.beginPath(); g.ellipse(cx - 1, ty0 + 22.5, 5.5, 2.8, 0, 0, TAU); g.fill();
      g.fillStyle = '#8a5a30'; g.fillRect(cx + 9, ty0 + 76, 7, 9); g.fillStyle = '#5a3a1e'; g.beginPath(); g.ellipse(cx + 12.5, ty0 + 76, 3.5, 1.4, 0, 0, TAU); g.fill();
      g.fillStyle = '#f2ead6'; g.fillRect(cx - 2, ty0 + 48, 4, 9); g.fillStyle = '#c9a24a'; g.beginPath(); g.ellipse(cx, ty0 + 57, 5, 1.8, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffd27a'; g.beginPath(); g.ellipse(cx, ty0 + 45.5, 1.4, 2.6, 0, 0, TAU); g.fill();
    }, OW);
  });
}

// chair turned north (backrest toward the viewer) and east (side view, backrest on the west)
function chairN() {
  return mk(1, 34, (g, P, Y, W) => {
    const cx = W / 2;
    P.layer((g) => {
      const sy0 = Y(0.25, 17), sy1 = Y(0.7, 17);
      leg(g, cx - 11, Y(0.25, 17), Y(0.25, 0), 4, WOOD.dark); leg(g, cx + 11, Y(0.25, 17), Y(0.25, 0), 4, WOOD.dark);
      plankTop(g, cx - 14, sy0, cx + 14, sy1, '#b08250', 'x', 2);
      // backrest on the near side
      leg(g, cx - 11, Y(0.75, 46), Y(0.75, 0), 4.4); leg(g, cx + 11, Y(0.75, 46), Y(0.75, 0), 4.4);
      g.fillStyle = lin(g, 0, Y(0.75, 46), 0, Y(0.75, 36), [[0, WOOD.high], [1, WOOD.mid]]); g.fillRect(cx - 13, Y(0.75, 46), 26, 7);
      g.fillStyle = WOOD.mid; g.fillRect(cx - 4, Y(0.75, 39), 3, 20); g.fillRect(cx + 2, Y(0.75, 39), 3, 20);
      g.fillStyle = WOOD.dark; g.fillRect(cx - 13, Y(0.75, 21), 26, 3);
    }, OW);
  });
}
function chairE() {
  return mk(1, 34, (g, P, Y, W) => {
    const cx = W / 2;
    P.layer((g) => {
      const x0 = cx - 10, x1 = cx + 12, sy0 = Y(0.3, 17), sy1 = Y(0.72, 17);
      leg(g, x0 + 2, Y(0.3, 17), Y(0.3, 0), 3.6, WOOD.dark); leg(g, x1 - 2, Y(0.3, 17), Y(0.3, 0), 3.6, WOOD.dark);
      plankTop(g, x0, sy0, x1, sy1, '#b08250', 'y', 2);
      apron(g, x0, x1, sy1, sy1 + 4, '#7d5532');
      leg(g, x1 - 2, sy1, Y(0.72, 0), 4.2); leg(g, x0 + 2, sy1, Y(0.72, 0), 4.2);
      // backrest on the west edge, seen from the side: two posts and the top rail
      g.fillStyle = lin(g, x0 - 3, 0, x0 + 3, 0, [[0, WOOD.high], [1, WOOD.dark]]);
      g.fillRect(x0 - 3, Y(0.3, 46), 5, Y(0.3, 17) - Y(0.3, 46));
      g.fillRect(x0 - 3, Y(0.72, 46), 5, Y(0.72, 17) - Y(0.72, 46));
      g.fillStyle = lin(g, 0, Y(0.3, 46), 0, Y(0.72, 40), [[0, WOOD.high], [1, WOOD.mid]]);
      g.beginPath(); g.moveTo(x0 - 3, Y(0.3, 46)); g.lineTo(x0 + 2, Y(0.3, 46)); g.lineTo(x0 + 2, Y(0.72, 40)); g.lineTo(x0 - 3, Y(0.72, 40)); g.closePath(); g.fill();
      g.fillStyle = WOOD.mid; g.fillRect(x0 - 2, Y(0.5, 39), 3, 18);
    }, OW);
  });
}

// ---------------- banner (pole + swinging cloth) ----------------
const BANNER_COLS = [['#a3302a', '#e6c56a'], ['#2f5a86', '#e8e0c8'], ['#3f6a34', '#e6c56a']];
function bannerPole() {
  return mk(1, 54, (g, P, Y, W) => {
    const cx = W / 2 - 10;
    ground(g, cx, Y(0.85, 0), 10, 3, 0.35);
    P.layer((g) => {
      leg(g, cx, Y(0.85, 108), Y(0.85, 0), 5, WOOD.mid);
      g.fillStyle = lin(g, 0, Y(0.85, 108), 0, Y(0.85, 104), [[0, WOOD.high], [1, WOOD.dark]]);
      g.fillRect(cx - 2, Y(0.85, 108), 30, 4); // crossbar
      g.fillStyle = '#c9a24a'; g.beginPath(); g.moveTo(cx, Y(0.85, 117)); g.lineTo(cx + 3, Y(0.85, 109)); g.lineTo(cx - 3, Y(0.85, 109)); g.closePath(); g.fill(); // finial
      g.fillStyle = 'rgba(60,40,20,0.7)'; for (const [dx, dy] of [[-6, 3], [5, 2], [-2, 5]]) { g.beginPath(); g.ellipse(cx + dx, Y(0.85, 0) + dy - 2, 3, 1.5, 0, 0, TAU); g.fill(); } // stake stones
    }, 2.6);
  });
}
// cloth: anchored at its top-centre attachment (composeWorld swings it around that point)
function bannerCloth(v) {
  const [c0, c1] = BANNER_COLS[v % 3];
  return spritePx(30, 52, (g, P) => {
    P.layer((g) => {
      const x0 = 2, x1 = 28, y0 = 1, y1 = 44;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1, y1); g.lineTo((x0 + x1) / 2, y1 - 7); g.lineTo(x0, y1); g.closePath();
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, mixc(c0, '#fff', 0.15)], [0.5, c0], [1, mixc(c0, '#000', 0.35)]]); g.fill();
      // folds
      g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x0 + 8, y0, 3, y1 - 10); g.fillRect(x0 + 18, y0, 2.4, y1 - 8);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x0 + 4, y0, 2, y1 - 6);
      // trim + emblem
      g.fillStyle = c1; g.fillRect(x0, y0 + 3, x1 - x0, 2);
      const ex = 15, ey = 20;
      if (v % 3 === 0) { // crossed blades
        g.strokeStyle = c1; g.lineWidth = 2; g.beginPath(); g.moveTo(ex - 6, ey - 7); g.lineTo(ex + 6, ey + 7); g.moveTo(ex + 6, ey - 7); g.lineTo(ex - 6, ey + 7); g.stroke();
        g.fillStyle = c1; g.beginPath(); circle(g, ex, ey, 2.6); g.fill();
      } else if (v % 3 === 1) { // sun
        g.fillStyle = c1; g.beginPath(); circle(g, ex, ey, 4.5); g.fill();
        g.strokeStyle = c1; g.lineWidth = 1.4; g.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.moveTo(ex + Math.cos(a) * 6.5, ey + Math.sin(a) * 6.5); g.lineTo(ex + Math.cos(a) * 9, ey + Math.sin(a) * 9); } g.stroke();
      } else { // tree
        g.fillStyle = c1; g.beginPath(); g.moveTo(ex, ey - 9); g.lineTo(ex + 7, ey + 4); g.lineTo(ex - 7, ey + 4); g.closePath(); g.fill(); g.fillRect(ex - 1.2, ey + 4, 2.4, 4);
      }
      // ties to the crossbar
      g.fillStyle = '#d8c7a0'; for (const x of [x0 + 3, x1 - 3]) g.fillRect(x - 1, 0, 2, 3);
    }, 2.2);
  });
}
function bannerFull(v) {
  return mk(1, 54, (g, P, Y, W) => {
    const pole = bannerPole(), cloth = bannerCloth(v);
    // composite for icons / ghosts: draw the parts at their nominal spots
    g.drawImage(pole, -(pole.origin.x), -(pole.origin.y), pole.width, pole.height);
    const cx = W / 2 + PROP_GEOM.bannerX * 64, cy = 64 + 54 - PROP_GEOM.bannerLift * 64;
    g.drawImage(cloth, cx - cloth.origW / 2 - cloth.origin.x, cy - cloth.origin.y, cloth.width, cloth.height);
  });
}

// ---------------- brazier & lamp post ----------------
function brazier(coals) {
  const rand = rng(509);
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, rim = Y(0.62, 50);
    if (coals) {
      for (let i = 0; i < 10; i++) { g.fillStyle = i & 1 ? '#ff8a2a' : '#ffd070'; g.beginPath(); circle(g, cx + (rand() - 0.5) * 22, rim - 1 + (rand() - 0.5) * 4, 1.2 + rand() * 1.4); g.fill(); }
      return;
    }
    ground(g, cx, Y(0.62, 0), 18, 5, 0.35);
    P.layer((g) => {
      // three splayed iron legs
      g.strokeStyle = IRON.mid; g.lineWidth = 2.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx - 16, Y(0.75, 0)); g.quadraticCurveTo(cx - 10, Y(0.62, 20), cx - 9, rim + 10); g.moveTo(cx + 16, Y(0.75, 0)); g.quadraticCurveTo(cx + 10, Y(0.62, 20), cx + 9, rim + 10); g.moveTo(cx + 1, Y(0.45, 0)); g.lineTo(cx, rim + 10); g.stroke();
      g.strokeStyle = IRON.high; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx - 15, Y(0.75, 1)); g.quadraticCurveTo(cx - 10.5, Y(0.62, 20), cx - 9.5, rim + 10); g.stroke();
      // basket bowl with bars
      g.fillStyle = lin(g, cx - 15, 0, cx + 15, 0, [[0, IRON.light], [0.4, IRON.mid], [1, IRON.dark]]);
      g.beginPath(); g.moveTo(cx - 15, rim); g.quadraticCurveTo(cx - 14, rim + 13, cx, rim + 14); g.quadraticCurveTo(cx + 14, rim + 13, cx + 15, rim); g.closePath(); g.fill();
      g.strokeStyle = IRON.dark; g.lineWidth = 1; g.beginPath(); for (let x = cx - 10; x <= cx + 10; x += 5) { g.moveTo(x, rim + 1); g.lineTo(x * 0.85 + cx * 0.15, rim + 12); } g.stroke();
      g.fillStyle = '#231a16'; g.beginPath(); g.ellipse(cx, rim, 15, 4.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#4a2a1a'; for (let i = 0; i < 8; i++) { g.beginPath(); circle(g, cx + (rand() - 0.5) * 22, rim - 0.6 + (rand() - 0.5) * 3, 1.6 + rand()); g.fill(); }
      g.strokeStyle = IRON.light; g.lineWidth = 1.4; g.beginPath(); g.ellipse(cx, rim, 15, 4.2, 0, Math.PI * 0.95, Math.PI * 2.05); g.stroke();
    }, 2.6);
  }, coals ? { pad: 12 } : undefined);
}
function lampPost(glow) {
  return mk(1, 72, (g, P, Y, W) => {
    const cx = W / 2 - 6;
    const lx = cx + PROP_GEOM.lampX * 64 + 6, ly = Y(1, PROP_GEOM.lampLift * 64);
    if (glow) {
      g.fillStyle = rad(g, lx, ly, 0, 8, [[0, '#fff6d0'], [0.5, '#ffc860'], [1, 'rgba(255,150,40,0)']]);
      g.fillRect(lx - 8, ly - 9, 16, 18);
      g.fillStyle = 'rgba(255,214,120,0.85)'; g.fillRect(lx - 4.2, ly - 5, 8.4, 9);
      return;
    }
    ground(g, cx, Y(0.85, 0), 10, 3, 0.4);
    P.layer((g) => {
      // stone footing, post, iron arm
      g.fillStyle = '#8f897e'; g.fillRect(cx - 7, Y(0.85, 8), 14, 8); g.fillStyle = 'rgba(255,250,235,0.35)'; g.fillRect(cx - 7, Y(0.85, 8), 14, 1.2);
      leg(g, cx, Y(0.85, 116), Y(0.85, 7), 5.5, WOOD.mid);
      g.fillStyle = WOOD.high; g.fillRect(cx - 4, Y(0.85, 118), 8, 3);
      g.strokeStyle = IRON.mid; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, Y(0.85, 112)); g.lineTo(lx, Y(0.85, 112)); g.lineTo(lx, ly - 11); g.stroke();
      g.strokeStyle = IRON.mid; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx + 2, Y(0.85, 104)); g.quadraticCurveTo(cx + 4, Y(0.85, 111), lx - 3, Y(0.85, 112)); g.stroke();
      // lantern: cap, glass panes (dark when unlit), base
      g.fillStyle = IRON.dark; g.beginPath(); g.moveTo(lx - 7, ly - 7); g.lineTo(lx, ly - 12); g.lineTo(lx + 7, ly - 7); g.closePath(); g.fill();
      g.fillStyle = '#5a5a52'; g.fillRect(lx - 5.5, ly - 7, 11, 13);
      g.fillStyle = '#8a8270'; g.fillRect(lx - 4.2, ly - 5, 8.4, 9);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(lx - 4.2, ly - 5, 2, 9);
      g.fillStyle = IRON.dark; g.fillRect(lx - 0.6, ly - 5, 1.2, 9); g.fillRect(lx - 6.5, ly + 5, 13, 3);
    }, 2.6);
  }, glow ? { pad: 12 } : undefined);
}

// ---------------- camp: tents & crates ----------------
function tent(v) {
  const rand = rng(510 + v);
  if (v % 2 === 0) {
    // A-frame canvas tent (2 tiles wide), open flap at the front
    return mk(2, 40, (g, P, Y, W) => {
      const cx = W / 2;
      ground(g, cx, Y(0.95, 0), 62, 10, 0.3);
      P.layer((g) => {
        const ridgeY = Y(0.2, 62), front = Y(0.95, 0), back = Y(0.2, 0);
        // back panel (visible slope, left side lit)
        g.beginPath(); g.moveTo(cx - 52, front - 2); g.lineTo(cx - 40, back + 4); g.lineTo(cx - 2, ridgeY); g.lineTo(cx + 2, ridgeY); g.lineTo(cx + 40, back + 4); g.lineTo(cx + 52, front - 2); g.closePath();
        g.fillStyle = lin(g, cx - 52, 0, cx + 52, 0, [[0, '#d8c8a0'], [0.48, '#bfae86'], [0.52, '#a8976f'], [1, '#7f704f']]); g.fill();
        // seams
        g.strokeStyle = 'rgba(90,74,46,0.5)'; g.lineWidth = 1;
        g.beginPath(); for (let k = 1; k < 4; k++) { g.moveTo(cx - 52 + k * 12, front - 2); g.lineTo(cx - 2 + k * 0.5, ridgeY + k * 3); g.moveTo(cx + 52 - k * 12, front - 2); g.lineTo(cx + 2, ridgeY + k * 3); } g.stroke();
        // patches
        g.fillStyle = '#a08a62'; g.fillRect(cx - 34, front - 26, 9, 7); g.fillStyle = '#8f7a54'; g.fillRect(cx + 22, front - 34, 8, 8);
        g.strokeStyle = 'rgba(60,46,28,0.6)'; g.setLineDash([1.5, 1.5]); g.strokeRect(cx - 34, front - 26, 9, 7); g.setLineDash([]);
        // front triangle with an open dark entrance
        g.beginPath(); g.moveTo(cx - 24, front); g.lineTo(cx, ridgeY + 18); g.lineTo(cx + 24, front); g.closePath();
        g.fillStyle = '#2a2018'; g.fill();
        g.fillStyle = lin(g, cx - 24, 0, cx, 0, [[0, '#cbb990'], [1, '#a59470']]);
        g.beginPath(); g.moveTo(cx - 26, front); g.lineTo(cx, ridgeY + 16); g.lineTo(cx - 9, front); g.closePath(); g.fill(); // flap tied back
        g.fillStyle = lin(g, cx, 0, cx + 26, 0, [[0, '#9a8a66'], [1, '#76684a']]);
        g.beginPath(); g.moveTo(cx + 26, front); g.lineTo(cx, ridgeY + 16); g.lineTo(cx + 12, front); g.closePath(); g.fill();
        // ridge pole + front pole, ropes & pegs
        g.strokeStyle = WOOD.dark; g.lineWidth = 2.4; g.beginPath(); g.moveTo(cx, ridgeY - 4); g.lineTo(cx, ridgeY + 20); g.stroke();
        g.strokeStyle = '#d8c7a0'; g.lineWidth = 0.9;
        g.beginPath(); g.moveTo(cx - 40, back + 6); g.lineTo(cx - 60, front - 10); g.moveTo(cx + 40, back + 6); g.lineTo(cx + 60, front - 10); g.moveTo(cx, ridgeY - 2); g.lineTo(cx - 8, Y(0, 0)); g.stroke();
        g.fillStyle = WOOD.mid; for (const x of [cx - 61, cx + 59]) g.fillRect(x, front - 12, 2.4, 6);
        // bedroll peeking out
        g.fillStyle = '#6a4e8a'; g.beginPath(); g.ellipse(cx + 2, front - 3, 8, 3, 0, 0, TAU); g.fill();
      }, OW);
    });
  }
  // conical hide tent (teepee)
  return mk(1.8, 64, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.92, 0), 52, 9, 0.3);
    P.layer((g) => {
      const top = Y(0.5, 98), base = Y(0.92, 0);
      // poles sticking out the top
      g.strokeStyle = WOOD.mid; g.lineWidth = 2.2;
      g.beginPath(); for (const dx of [-9, -3, 4, 10]) { g.moveTo(cx + dx * 0.25, top + 8); g.lineTo(cx + dx, top - 12); } g.stroke();
      // hide cone
      g.beginPath(); g.moveTo(cx - 48, base); g.quadraticCurveTo(cx - 20, top + 30, cx - 4, top + 6); g.lineTo(cx + 4, top + 6); g.quadraticCurveTo(cx + 20, top + 30, cx + 48, base); g.quadraticCurveTo(cx, base + 7, cx - 48, base); g.closePath();
      g.fillStyle = lin(g, cx - 48, 0, cx + 48, 0, [[0, '#c9a47a'], [0.45, '#a8845c'], [1, '#6e5236']]); g.fill();
      g.save(); g.clip();
      // painted bands & stitching
      g.fillStyle = '#8a3a2a'; g.fillRect(cx - 60, base - 22, 120, 5);
      g.fillStyle = '#2f4f6a'; for (let x = cx - 44; x < cx + 44; x += 11) { g.beginPath(); g.moveTo(x, base - 17); g.lineTo(x + 5.5, base - 11); g.lineTo(x + 11, base - 17); g.closePath(); g.fill(); }
      g.strokeStyle = 'rgba(60,40,22,0.55)'; g.lineWidth = 0.9; g.setLineDash([2, 2]);
      g.beginPath(); for (const dx of [-24, 0, 24]) { g.moveTo(cx + dx * 0.1, top + 8); g.lineTo(cx + dx, base); } g.stroke(); g.setLineDash([]);
      g.restore();
      // doorway flap
      g.fillStyle = '#2a2018'; g.beginPath(); g.moveTo(cx - 10, base + 1); g.quadraticCurveTo(cx - 6, base - 26, cx + 2, base - 30); g.quadraticCurveTo(cx + 8, base - 18, cx + 10, base + 2); g.closePath(); g.fill();
      g.fillStyle = '#b8936a'; g.beginPath(); g.moveTo(cx + 2, base - 30); g.quadraticCurveTo(cx + 14, base - 14, cx + 15, base + 2); g.lineTo(cx + 9, base + 2); g.quadraticCurveTo(cx + 8, base - 16, cx + 2, base - 30); g.closePath(); g.fill();
      // smoke hole
      g.fillStyle = '#3a2a1e'; g.beginPath(); g.ellipse(cx, top + 9, 4, 1.6, 0, 0, TAU); g.fill();
    }, OW);
  });
}
function crate(v) {
  const rand = rng(520 + v);
  return mk(1, 26, (g, P, Y, W) => {
    const cx = W / 2;
    const s = [1, 0.78, 0.88][v % 3];
    P.layer((g) => {
      const w = 42 * s, d = 0.34 * s, h = 27 * s;
      const x0 = cx - w / 2, x1 = cx + w / 2;
      const ty0 = Y(0.88 - d, h), ty1 = Y(0.88, h), fb = Y(0.88, 0);
      plankTop(g, x0, ty0, x1, ty1, '#b48a58', 'x', 3);
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, '#9a7246'], [1, '#6e4c2c']]); g.fillRect(x0, ty1, w, fb - ty1);
      g.strokeStyle = 'rgba(40,24,12,0.55)'; g.lineWidth = 0.9; g.beginPath(); for (let k = 1; k < 3; k++) { const y = ty1 + ((fb - ty1) * k) / 3; g.moveTo(x0, y); g.lineTo(x1, y); } g.stroke();
      // frame boards + diagonal brace
      g.fillStyle = '#7c5632'; g.fillRect(x0, ty1, 4, fb - ty1); g.fillRect(x1 - 4, ty1, 4, fb - ty1); g.fillRect(x0, ty1, w, 3); g.fillRect(x0, fb - 3, w, 3);
      g.strokeStyle = '#7c5632'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(x0 + 3, fb - 3); g.lineTo(x1 - 3, ty1 + 3); g.stroke();
      g.fillStyle = 'rgba(255,235,200,0.35)'; g.fillRect(x0, ty1, w, 1);
      g.fillStyle = '#3a3a3e'; for (const [x, y] of [[x0 + 2, ty1 + 1.5], [x1 - 2, ty1 + 1.5], [x0 + 2, fb - 1.5], [x1 - 2, fb - 1.5]]) { g.beginPath(); circle(g, x, y, 0.9); g.fill(); }
      // stencil mark
      if (v % 3 === 0) { g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 1.2; g.beginPath(); circle(g, cx + w * 0.22, ty1 + (fb - ty1) * 0.35, 3); g.stroke(); }
      if (v % 3 === 1) { g.fillStyle = '#c8b27a'; g.beginPath(); g.ellipse(cx - 4, ty0 + 3, 7, 3, 0.2, 0, TAU); g.fill(); } // sack on top
    }, OW);
  });
}

export function addStations(add) {
  const A = (name, c) => add(name, c, 0.5, 1);
  A('workbench', workbench());
  A('stonecutter', stonecutter());
  A('furnace', furnace(false)); A('furnace_glow', furnace(true));
  A('anvil', anvil());
  A('loom', loom());
  A('cooking_pot', cookingPot(false)); A('cooking_pot_coals', cookingPot(true));
  A('table_wood', table());
  A('chair_wood', chair());
  for (let v = 0; v < 2; v++) add('rug_' + v, rug(v), 0.5, 0.5); // centred: drawn rotated about the footprint centre
  for (let v = 0; v < 3; v++) A('flower_pot_' + v, flowerPot(v));
  A('banner_pole', bannerPole());
  for (let v = 0; v < 3; v++) add('banner_cloth_' + v, bannerCloth(v), 0.5, 0);
  for (let v = 0; v < 3; v++) A('banner_' + v, bannerFull(v));
  A('brazier', brazier(false)); A('brazier_coals', brazier(true));
  A('lamp_post', lampPost(false)); A('lamp_post_glow', lampPost(true));
  for (let v = 0; v < 2; v++) A('tent_' + v, tent(v));
  for (let v = 0; v < 3; v++) A('crate_' + v, crate(v));
  // facing variants for rotation (front N / front E; W = E mirrored, missing N = base mirrored)
  A('workbench_n', workbenchN()); A('workbench_e', workbenchE());
  A('stonecutter_e', stonecutterE());
  A('loom_n', loomN()); A('loom_e', loomE());
  A('table_wood_e', tableE());
  A('chair_wood_n', chairN()); A('chair_wood_e', chairE());
}
