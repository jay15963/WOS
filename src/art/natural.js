// Natural pickups (worldgen, collected by hand): pebbles, fallen sticks, fibre grass, wild potato / cotton / corn.
// Small and readable: slightly brighter than the ground with a crisp outline, so they read as "pick me up".

import { sprite, rng, TAU, lin, rad, circle, mixc, leaf, taper, smoothClosed, blobPts } from './paint.js';
import { PLANTS } from './crops.js';
import { addCritters } from './critters.js';

const STONE = [['#9c958a', '#c2bbaf', '#6c665e'], ['#8f877b', '#b6ad9f', '#5f584f'], ['#a49a8a', '#cbc1b0', '#70675a'], ['#878a88', '#b0b3b0', '#5a5d5c']];

function pebble(g, x, y, rx, ry, rand, pal) {
  const pts = blobPts(x, y, rx, ry, rand, 8, 0.12);
  g.beginPath(); smoothClosed(g, pts); g.fillStyle = pal[2]; g.fill();
  g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
  g.fillStyle = pal[0]; g.beginPath(); g.ellipse(x - rx * 0.12, y - ry * 0.22, rx * 0.88, ry * 0.78, 0, 0, TAU); g.fill();
  g.fillStyle = pal[1]; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.42, ry * 0.3, -0.3, 0, TAU); g.fill();
  if (rand() < 0.5) { g.strokeStyle = 'rgba(255,255,245,0.35)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x - rx * 0.6, y + ry * 0.1); g.lineTo(x + rx * 0.5, y - ry * 0.2); g.stroke(); }
  g.restore();
}
function pebbles(v) {
  const rand = rng(8800 + v * 17);
  const sets = [
    [[-6, 1, 5.2, 3.8], [4, -1, 4, 3], [1, 4, 3, 2.3]],
    [[-3, 0, 6.4, 4.4], [6, 2, 3.4, 2.6]],
    [[-7, 2, 3.8, 2.8], [0, -1, 4.6, 3.4], [6, 2, 3.6, 2.7], [-2, 4.5, 2.6, 2], [4, -4, 2.4, 1.8]],
    [[-5, -1, 4.4, 3.2], [3, 1, 5, 3.6], [-1, 4, 2.6, 2], [8, -2, 2.2, 1.7]],
  ][v % 4];
  return sprite(0.6, 0.42, (g, P) => {
    const cx = P.W / 2, cy = P.H - 10;
    for (const [dx0, dy0, rx0, ry0] of sets) { const dx = dx0 * 1.22, dy = dy0 * 1.22, rx = rx0 * 1.22, ry = ry0 * 1.22; { g.fillStyle = 'rgba(30,22,14,0.35)'; g.beginPath(); g.ellipse(cx + dx + 1, cy + dy + ry * 0.7, rx * 1.05, ry * 0.5, 0, 0, TAU); g.fill(); } }
    P.layer((g) => {
      const order = sets.slice().sort((a, b) => a[1] - b[1]);
      order.forEach(([dx, dy, rx, ry], i) => pebble(g, cx + dx * 1.22, cy + dy * 1.22, rx * 1.22, ry * 1.22, rand, STONE[(v + i) % STONE.length]));
    }, 1.8);
  });
}

function stick(v) {
  const rand = rng(8900 + v * 23);
  return sprite(0.75, 0.42, (g, P) => {
    const cx = P.W / 2, cy = P.H - 10;
    const a = [-0.18, 0.22, -0.32][v % 3], L = [38, 34, 30][v % 3];
    const x0 = cx - Math.cos(a) * L / 2, y0 = cy - Math.sin(a) * L / 2, x1 = cx + Math.cos(a) * L / 2, y1 = cy + Math.sin(a) * L / 2;
    g.fillStyle = 'rgba(30,22,14,0.32)'; g.beginPath(); g.moveTo(x0, y0 + 3); g.lineTo(x1, y1 + 3); g.lineWidth = 4; g.strokeStyle = 'rgba(30,22,14,0.3)'; g.stroke();
    P.layer((g) => {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + (rand() - 0.5) * 3;
      g.fillStyle = lin(g, 0, my - 3, 0, my + 3, [[0, '#a07a4e'], [0.5, '#7a5634'], [1, '#4e341e']]);
      g.beginPath(); taper(g, x0, y0, mx, my, x1, y1, 4.4, 2.6); g.fill();
      // twigs
      const twigs = 2 + (v % 2);
      for (let i = 0; i < twigs; i++) {
        const t = 0.3 + i * 0.25, tx = x0 + (x1 - x0) * t, ty = y0 + (y1 - y0) * t;
        const s = i & 1 ? 1 : -1, ta = a + s * (0.7 + rand() * 0.4);
        const ex = tx + Math.cos(ta) * (8 + rand() * 5), ey = ty + Math.sin(ta) * (8 + rand() * 5) * 0.7 - 2;
        g.fillStyle = '#7a5634'; g.beginPath(); taper(g, tx, ty, (tx + ex) / 2, (ty + ey) / 2 - 1, ex, ey, 2, 1); g.fill();
        if (v === 1 && i === 0) { g.fillStyle = '#7d8a3a'; g.beginPath(); leaf(g, ex, ey, ex + 5, ey - 3, 2.2, 0.5); g.fill(); }
      }
      // bark marks + lit edge, pale cut ends
      g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 0.7;
      for (let i = 0; i < 4; i++) { const t = 0.15 + i * 0.22, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; g.beginPath(); g.moveTo(x - 1, y - 0.6); g.lineTo(x + 1.5, y + 0.6); g.stroke(); }
      g.strokeStyle = 'rgba(255,230,190,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x0 + 2, y0 - 1.2); g.quadraticCurveTo(mx, my - 2, x1 - 2, y1 - 1); g.stroke();
      g.fillStyle = '#d2ad78'; g.beginPath(); g.ellipse(x1, y1, 1.3, 1.6, a, 0, TAU); g.fill();
      g.fillStyle = '#c9a26c'; g.beginPath(); g.ellipse(x0, y0, 1.8, 2.2, a, 0, TAU); g.fill();
    }, 1.9);
  });
}

// fibre grass: tall, pale straw-green fibrous clump with drooping feathery seed heads (reads apart from decor grass)
function fibergrass(v) {
  const rand = rng(9100 + v * 29);
  return sprite(0.9, 1.25, (g, P) => {
    const cx = P.W / 2, y = P.H - 5;
    g.fillStyle = 'rgba(40,30,16,0.35)'; g.beginPath(); g.ellipse(cx, y, 13, 3.4, 0, 0, TAU); g.fill();
    P.layer((g) => {
      const n = 22 + v * 3;
      const bl = [];
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1) - 0.5) * 2 + (rand() - 0.5) * 0.2;
        bl.push({ x: cx + u * 9, h: (40 + rand() * 26) * (1 - Math.abs(u) * 0.3), dx: u * 20 + (rand() - 0.5) * 6, w: 2.2 + rand() * 1, t: rand() });
      }
      bl.sort((a, b) => b.h - a.h);
      for (const B of bl) {
        const tip = mixc('#d8d08e', '#efe6b0', B.t);
        g.fillStyle = lin(g, 0, y, 0, y - B.h, [[0, '#5d6a2e'], [0.3, mixc('#9aa45a', '#b5b46c', B.t)], [1, tip]]);
        const x1 = B.x + B.dx, y1 = y - B.h;
        g.beginPath(); g.moveTo(B.x - B.w / 2, y); g.quadraticCurveTo(B.x + B.dx * 0.2, y - B.h * 0.6, x1, y1); g.quadraticCurveTo(B.x + B.dx * 0.3 + B.w, y - B.h * 0.55, B.x + B.w / 2, y); g.closePath(); g.fill();
      }
      // fibre strands (light lines along the clump)
      g.strokeStyle = 'rgba(250,244,210,0.45)'; g.lineWidth = 0.6;
      g.beginPath(); for (let i = 0; i < 8; i++) { const u = (rand() - 0.5) * 2, h = 30 + rand() * 20; g.moveTo(cx + u * 6, y - 3); g.quadraticCurveTo(cx + u * 9, y - h * 0.6, cx + u * 16, y - h); } g.stroke();
      // drooping plumes
      for (let i = 0; i < 4 + v; i++) {
        const x = cx + (rand() - 0.5) * 18, h = 52 + rand() * 18, s = x < cx ? -1 : 1;
        const tx = x + s * (6 + rand() * 6), ty = y - h;
        g.strokeStyle = '#8f8a4a'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx + (x - cx) * 0.3, y - 6); g.quadraticCurveTo(x, y - h * 0.7, tx, ty); g.stroke();
        for (let k = 0; k < 6; k++) {
          const px = tx + s * k * 1.3, py = ty + k * 2.2;
          g.fillStyle = k & 1 ? '#e8dca0' : '#d4c482';
          g.beginPath(); g.ellipse(px, py, 1.3, 2.6, s * 0.6, 0, TAU); g.fill();
        }
      }
    }, 1.4, 'rgba(46,40,14,0.7)');
  });
}

function wild(kind) {
  const rand = rng(9300 + kind.length * 13);
  const H = kind === 'corn' ? 1.45 : kind === 'cotton' ? 0.95 : 0.8;
  return sprite(kind === 'corn' ? 0.95 : kind === 'potato' ? 1.0 : 0.85, H, (g, P) => {
    const cx = P.W / 2, y = P.H - 6;
    g.fillStyle = 'rgba(36,24,14,0.4)'; g.beginPath(); g.ellipse(cx, y, 14, 3.6, 0, 0, TAU); g.fill();
    // a couple of stems for a scraggly wild look (back one first, separate outlines)
    if (kind === 'corn') {
      P.layer((g) => PLANTS.corn(g, cx + 7, y - 2, 3, rand, 0.82), 1.8, 'rgba(26,30,12,0.72)');
      P.layer((g) => { PLANTS.corn(g, cx - 5, y, 2, rand, 0.9); grassBase(g, cx, y, rand); }, 1.8, 'rgba(26,30,12,0.72)');
    } else if (kind === 'cotton') {
      P.layer((g) => PLANTS.cotton(g, cx + 6, y - 2, 3, rand, 0.95), 1.8, 'rgba(26,30,12,0.72)');
      P.layer((g) => { PLANTS.cotton(g, cx - 5, y, 3, rand, 1.05); grassBase(g, cx, y, rand); }, 1.8, 'rgba(26,30,12,0.72)');
    } else {
      P.layer((g) => { PLANTS.potato(g, cx - 4, y - 1, 2, rand, 1.3); PLANTS.potato(g, cx + 5, y, 3, rand, 1.5); grassBase(g, cx, y, rand); }, 1.8, 'rgba(26,30,12,0.72)');
    }
  });
}
function grassBase(g, cx, y, rand) {
  for (let i = 0; i < 7; i++) {
    const u = (i / 6 - 0.5) * 2, h = 7 + rand() * 7;
    g.fillStyle = mixc('#5d7833', '#7a9442', rand());
    g.beginPath(); g.moveTo(cx + u * 9 - 1.2, y + 1); g.quadraticCurveTo(cx + u * 10, y - h * 0.6, cx + u * 14, y - h); g.quadraticCurveTo(cx + u * 10 + 1.5, y - h * 0.5, cx + u * 9 + 1.2, y + 1); g.closePath(); g.fill();
  }
}

export function addNatural(add) {
  const put = (name, c, foot) => add(name, c, 0.5, 1 - foot / (c.origH || c.height));
  for (let v = 0; v < 4; v++) put('pebble_' + v, pebbles(v), 6);
  for (let v = 0; v < 3; v++) put('stick_' + v, stick(v), 8);
  for (let v = 0; v < 3; v++) put('fibergrass_' + v, fibergrass(v), 5);
  put('wild_potato_0', wild('potato'), 6);
  put('wild_cotton_0', wild('cotton'), 6);
  put('wild_corn_0', wild('corn'), 6);
  addCritters(add); // cosmetic wildlife (src/fx/wildlife.js)
}
