// Decoration props (agent K): interior furniture & props, garden / exterior props, the training dummy.
// Same conventions as stations.js: nominal box `w` tiles wide with E px of headroom above a footprint `d` tiles deep;
// Y(v, h) maps a ground row v (tiles from the footprint's north edge) and a height h (px) to sprite y; anchor =
// bottom-centre of the footprint. Rotating 2×1 pieces also get `<type>_e` (footprint 1×2). Wall-mounted pieces are
// small flat boxes (64 × 44) drawn lifted onto the wall face by archCompose.js. Flame / glow spots: DECOR_GEOM.

import { spritePx, rng, OW, TAU, lin, rad, circle, mixc, tone, smoothClosed, blobPts } from './paint.js';

const WOOD = { deep: '#3b2616', dark: '#5a3b22', mid: '#7d5532', light: '#9c6e43', high: '#b98a58' };
const DARKW = { dark: '#3a2416', mid: '#55351f', light: '#74492b', high: '#8f5e38' };
const IRON = { dark: '#2c2c31', mid: '#4a4a52', light: '#6e6e78', high: '#9a9aa6' };
const STONE = { dark: '#6e685e', mid: '#9a9386', light: '#bcb4a6', high: '#d8d1c4' };
const GREENS = ['#3f6e2e', '#4a7d34', '#57903c', '#366028', '#62a046'];
const FLOWERS = ['#f4d35e', '#ee6c4d', '#f7f7f2', '#c58fe0', '#f29bc0', '#e0506a', '#7fb0f0'];

const mk = (wt, E, fn, opts) => spritePx(Math.round(wt * 64), 64 + E, (g, P) => fn(g, P, (v, h) => E + v * 64 - h, Math.round(wt * 64)), { pad: 12, ...opts });
const mkv = (wt, dt, E, fn, opts) => spritePx(Math.round(wt * 64), Math.round(dt * 64) + E, (g, P) => fn(g, P, (v, h) => E + v * 64 - h, Math.round(wt * 64)), { pad: 12, ...opts });
const wallBox = (fn, ow = 2.2) => spritePx(64, 44, (g, P) => P.layer((g) => fn(g, 32, 44), ow), { pad: 10 });

// ---------------- helpers ----------------
function plankTop(g, x0, y0, x1, y1, base = '#b08250', dir = 'x', n = 4) {
  g.fillStyle = lin(g, x0, y0, x1, y1, [[0, mixc(base, '#fff2d8', 0.12)], [1, mixc(base, '#2a1a0c', 0.18)]]);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.strokeStyle = 'rgba(70,42,20,0.5)'; g.lineWidth = 0.9;
  g.beginPath();
  if (dir === 'x') for (let i = 1; i < n; i++) { const y = y0 + ((y1 - y0) * i) / n; g.moveTo(x0, y); g.lineTo(x1, y); }
  else for (let i = 1; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n; g.moveTo(x, y0); g.lineTo(x, y1); }
  g.stroke();
  g.fillStyle = 'rgba(255,240,210,0.4)'; g.fillRect(x0, y0, x1 - x0, 1.2);
}
function leg(g, x, yTop, yBot, w = 5, col = WOOD.mid) {
  g.fillStyle = lin(g, x - w / 2, 0, x + w / 2, 0, [[0, mixc(col, '#fff', 0.15)], [1, mixc(col, '#000', 0.35)]]);
  g.fillRect(x - w / 2, yTop, w, yBot - yTop);
}
function face(g, x0, x1, y0, y1, col) {
  g.fillStyle = lin(g, 0, y0, 0, y1, [[0, mixc(col, '#fff', 0.08)], [1, mixc(col, '#000', 0.3)]]);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = 'rgba(255,235,200,0.3)'; g.fillRect(x0, y0, x1 - x0, 1);
}
// box in 3/4 view: top face ty0..ty1, front face ty1..fb
function box(g, x0, x1, ty0, ty1, fb, top, front, dir = 'x', n = 3) {
  plankTop(g, x0, ty0, x1, ty1, top, dir, n);
  face(g, x0, x1, ty1, fb, front);
}
function stoneTop(g, x0, y0, x1, y1, col = STONE.light) {
  g.fillStyle = lin(g, x0, y0, x1, y1, [[0, mixc(col, '#fff', 0.15)], [1, mixc(col, '#000', 0.15)]]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = 'rgba(255,255,245,0.45)'; g.fillRect(x0, y0, x1 - x0, 1.2);
}
function ground(g, cx, y, rx, ry, a = 0.3) {
  g.fillStyle = rad(g, cx, y, 0, rx, [[0, `rgba(40,28,16,${a})`], [1, 'rgba(40,28,16,0)']]);
  g.save(); g.translate(cx, y); g.scale(1, ry / rx); g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.restore(); g.fill();
}
function leaves(g, x, y, rx, ry, rand, n = 14, pal = GREENS) {
  g.fillStyle = mixc(pal[3], '#000', 0.2); g.beginPath(); smoothClosed(g, blobPts(x, y, rx, ry, rand, 9, 0.14)); g.fill();
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU, r = rand();
    g.fillStyle = pal[(rand() * pal.length) | 0];
    g.beginPath(); g.ellipse(x + Math.cos(a) * rx * r * 0.8, y + Math.sin(a) * ry * r * 0.8 - ry * 0.15, 3 + rand() * 2.5, 2.2 + rand() * 1.8, rand() * 3, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(220,255,180,0.22)'; g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.45, rx * 0.35, ry * 0.22, -0.3, 0, TAU); g.fill();
}
function flowerDots(g, x0, x1, y0, y1, rand, n, cols = FLOWERS) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    g.fillStyle = cols[(rand() * cols.length) | 0]; g.beginPath(); circle(g, x, y, 1.3 + rand() * 0.9); g.fill();
    g.fillStyle = 'rgba(255,240,180,0.9)'; g.beginPath(); circle(g, x, y, 0.5); g.fill();
  }
}
function cyl(g, cx, top, bot, rx, ry, cols) { // vertical cylinder body + top ellipse
  g.fillStyle = lin(g, cx - rx, 0, cx + rx, 0, [[0, cols[0]], [0.45, cols[1]], [1, cols[2]]]);
  g.fillRect(cx - rx, top, rx * 2, bot - top);
  g.beginPath(); g.ellipse(cx, bot, rx, ry, 0, 0, Math.PI); g.fill();
  g.fillStyle = cols[3] || mixc(cols[0], '#fff', 0.1); g.beginPath(); g.ellipse(cx, top, rx, ry, 0, 0, TAU); g.fill();
}
function book(g, x, y, w, h, col) {
  g.fillStyle = col; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,240,200,0.35)'; g.fillRect(x, y + 2, w, 0.9); g.fillRect(x, y + h - 3, w, 0.9);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w - 0.8, y, 0.8, h);
}
const BOOKS = ['#8a2e2a', '#2f4f7a', '#3f6a34', '#a07a2a', '#5a2f6a', '#7a4a2a', '#2a5a5a', '#b05a2a'];

// ---------------- interior ----------------
function shelfWood() {
  const rand = rng(2001);
  return mk(1, 66, (g, P, Y, W) => {
    const x0 = 13, x1 = W - 13, v0 = 0.56, v1 = 0.9, H = 74;
    P.layer((g) => {
      face(g, x0, x1, Y(v0, H), Y(v0, 0), DARKW.mid); // back panel
      leg(g, x0 + 2, Y(v1, H), Y(v1, 0), 4.5, WOOD.mid); leg(g, x1 - 2, Y(v1, H), Y(v1, 0), 4.5, WOOD.mid);
      for (const h of [4, 26, 50]) {
        plankTop(g, x0, Y(v0, h + 3), x1, Y(v1, h + 3), '#a87a48', 'x', 1);
        g.fillStyle = WOOD.dark; g.fillRect(x0, Y(v1, h + 3), x1 - x0, 3);
      }
      // items
      g.fillStyle = '#b8703e'; g.fillRect(x0 + 4, Y(0.75, 40), 7, 11); g.fillStyle = '#8a4a26'; g.fillRect(x0 + 4, Y(0.75, 40), 7, 2);
      g.fillStyle = '#7d8c9a'; g.beginPath(); g.ellipse(x0 + 18, Y(0.75, 34), 4.5, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#c9a86a'; g.fillRect(x1 - 15, Y(0.75, 37), 11, 7); g.fillStyle = '#a8864a'; for (let i = 0; i < 4; i++) g.fillRect(x1 - 14 + i * 2.8, Y(0.75, 37), 1, 7);
      for (let i = 0; i < 6; i++) book(g, x0 + 3 + i * 5.2, Y(0.75, 72 - (i % 2) * 2), 4.6, 15 - (i % 3) * 2, BOOKS[(rand() * 8) | 0]);
      g.fillStyle = '#e8d6a8'; g.beginPath(); g.ellipse(x1 - 8, Y(0.75, 62), 4, 2.4, 0, 0, TAU); g.fill(); // scroll
      g.fillStyle = '#6e8a4a'; g.beginPath(); g.ellipse(x0 + 12, Y(0.75, 13), 6, 4, 0, 0, TAU); g.fill(); g.fillStyle = '#c86a3a'; g.fillRect(x1 - 16, Y(0.75, 16), 10, 9);
      g.fillStyle = WOOD.high; g.fillRect(x0 - 1, Y(v0, H) - 3, x1 - x0 + 2, 4);
    }, OW);
  });
}
function bookshelf(east) {
  const rand = rng(east ? 2012 : 2011);
  if (east) return mkv(1, 2, 66, (g, P, Y, W) => {
    const x0 = 18, x1 = W - 18, H = 64;
    P.layer((g) => {
      box(g, x0, x1, Y(0.12, H), Y(1.88, H), Y(1.88, 0), '#9a6e44', DARKW.mid, 'y', 2);
      for (let i = 0; i < 18; i++) g.fillStyle = BOOKS[(rand() * 8) | 0], g.fillRect(x1 - 4, Y(0.16 + i * 0.095, H) , 4, 5);
      g.fillStyle = 'rgba(30,18,8,0.4)'; for (const h of [18, 40]) g.fillRect(x0, Y(1.88, h), x1 - x0, 2);
    }, OW);
  });
  return mk(2, 66, (g, P, Y, W) => {
    const x0 = 8, x1 = W - 8, v0 = 0.55, v1 = 0.9, H = 66;
    P.layer((g) => {
      face(g, x0, x1, Y(v0, H), Y(v0, 0), DARKW.dark);
      leg(g, x0 + 2.5, Y(v1, H), Y(v1, 0), 5, DARKW.light); leg(g, x1 - 2.5, Y(v1, H), Y(v1, 0), 5, DARKW.light); leg(g, W / 2, Y(v1, H), Y(v1, 0), 4, DARKW.light);
      for (const h of [3, 23, 44]) {
        let x = x0 + 5;
        while (x < x1 - 8) {
          if (Math.abs(x - W / 2) < 3) { x += 4; continue; }
          const w = 3.4 + rand() * 2.4, hh = 13 + rand() * 5;
          if (rand() < 0.12) { g.fillStyle = BOOKS[(rand() * 8) | 0]; g.save(); g.translate(x, Y(0.78, h + 3)); g.rotate(-0.3); g.fillRect(0, -hh, w, hh); g.restore(); x += w + 4; continue; }
          book(g, x, Y(0.78, h + 3 + hh), w, hh, BOOKS[(rand() * 8) | 0]);
          x += w + 0.4;
        }
        plankTop(g, x0, Y(v0, h + 3), x1, Y(v1, h + 3), DARKW.high, 'x', 1);
        g.fillStyle = DARKW.mid; g.fillRect(x0, Y(v1, h + 3), x1 - x0, 3);
      }
      plankTop(g, x0 - 2, Y(v0, H + 2), x1 + 2, Y(v1, H + 2), DARKW.high, 'x', 2);
      g.fillStyle = '#efe6cf'; g.fillRect(x1 - 20, Y(0.72, H + 14), 3, 10); g.fillStyle = '#b0904a'; g.fillRect(x1 - 23, Y(0.72, H + 4), 9, 2.4); // candle
      g.fillStyle = '#e8d6a8'; g.beginPath(); g.ellipse(x0 + 22, Y(0.72, H + 6), 7, 2.6, 0.1, 0, TAU); g.fill();
    }, OW);
  });
}
function wardrobe() {
  return mk(1, 70, (g, P, Y, W) => {
    const x0 = 11, x1 = W - 11, v0 = 0.5, v1 = 0.92, H = 68;
    P.layer((g) => {
      box(g, x0, x1, Y(v0, H), Y(v1, H), Y(v1, 0), '#8f6440', DARKW.light, 'x', 2);
      const fy0 = Y(v1, H) + 3, fb = Y(v1, 4);
      for (const [a, b] of [[x0 + 3, W / 2 - 1], [W / 2 + 1, x1 - 3]]) {
        g.fillStyle = tone(DARKW.light, 0.9); g.fillRect(a, fy0, b - a, fb - fy0);
        g.fillStyle = 'rgba(20,10,4,0.4)'; g.fillRect(a + 2.5, fy0 + 3, b - a - 5, 18); g.fillRect(a + 2.5, fy0 + 26, b - a - 5, 24);
        g.fillStyle = 'rgba(255,230,190,0.25)'; g.fillRect(a + 2.5, fy0 + 20, b - a - 5, 1); g.fillRect(a + 2.5, fy0 + 49, b - a - 5, 1);
      }
      g.fillStyle = '#c9a24a'; g.beginPath(); circle(g, W / 2 - 3, fy0 + 24, 1.4); g.fill(); g.beginPath(); circle(g, W / 2 + 3, fy0 + 24, 1.4); g.fill();
      g.fillStyle = DARKW.high; g.fillRect(x0 - 2, Y(v1, H) - 1, x1 - x0 + 4, 3.5); // crown
      g.fillStyle = DARKW.dark; g.fillRect(x0, fb, x1 - x0, 4);
    }, OW);
  });
}
function dresser(east) {
  const drawers = (g, x0, x1, y0, y1, n) => {
    const h = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const y = y0 + i * h;
      g.fillStyle = tone(WOOD.light, 0.95); g.fillRect(x0 + 2, y + 1, x1 - x0 - 4, h - 2);
      g.fillStyle = 'rgba(20,10,4,0.45)'; g.fillRect(x0 + 2, y + h - 1.5, x1 - x0 - 4, 1.2);
      g.fillStyle = '#c9a24a'; for (const k of [0.3, 0.7]) { g.beginPath(); circle(g, x0 + (x1 - x0) * k, y + h / 2, 1.2); g.fill(); }
    }
  };
  if (east) return mkv(1, 2, 44, (g, P, Y, W) => {
    const x0 = 14, x1 = W - 14, H = 30;
    P.layer((g) => {
      box(g, x0, x1, Y(0.15, H), Y(1.85, H), Y(1.85, 0), '#a87a48', WOOD.mid, 'y', 2);
      g.fillStyle = '#8a9aa8'; g.beginPath(); g.ellipse(W / 2, Y(1.0, H) , 9, 7, 0, 0, TAU); g.fill(); g.fillStyle = '#c8d8e4'; g.beginPath(); g.ellipse(W / 2, Y(1.0, H) - 1, 6, 4.5, 0, 0, TAU); g.fill();
      g.fillStyle = '#c9a24a'; g.fillRect(x1 - 2, Y(0.5, 24), 2, 2); g.fillRect(x1 - 2, Y(1.4, 24), 2, 2);
    }, OW);
  });
  return mk(2, 44, (g, P, Y, W) => {
    const x0 = 12, x1 = W - 12, v0 = 0.5, v1 = 0.88, H = 30;
    P.layer((g) => {
      box(g, x0, x1, Y(v0, H), Y(v1, H), Y(v1, 0), '#a87a48', WOOD.mid, 'x', 2);
      drawers(g, x0, x1, Y(v1, H) + 1, Y(v1, 3), 3);
      g.fillStyle = WOOD.dark; g.fillRect(x0, Y(v1, 3), 4, 3); g.fillRect(x1 - 4, Y(v1, 3), 4, 3);
      // basin, mirror, candle
      g.fillStyle = '#8a9aa8'; g.beginPath(); g.ellipse(W / 2 - 18, Y(0.7, H), 11, 5, 0, 0, TAU); g.fill(); g.fillStyle = '#c8d8e4'; g.beginPath(); g.ellipse(W / 2 - 18, Y(0.7, H) - 0.5, 8, 3.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#8a5a30'; g.fillRect(W / 2 + 6, Y(0.56, H + 30), 18, 26); g.fillStyle = lin(g, 0, Y(0.56, H + 28), 0, Y(0.56, H + 6), [[0, '#d8e8f0'], [1, '#7890a0']]); g.fillRect(W / 2 + 8.5, Y(0.56, H + 27.5), 13, 21);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(W / 2 + 10, Y(0.56, H + 26), 2, 14);
      g.fillStyle = '#efe6cf'; g.fillRect(x1 - 12, Y(0.7, H + 11), 3, 9); g.fillStyle = '#b0904a'; g.fillRect(x1 - 15, Y(0.7, H + 2), 9, 2.4);
    }, OW);
  });
}
function benchWood(east) {
  if (east) return mkv(1, 2, 24, (g, P, Y, W) => {
    const x0 = 20, x1 = W - 20;
    P.layer((g) => {
      for (const v of [0.3, 1.7]) { leg(g, x0 + 3, Y(v, 15), Y(v + 0.08, 0), 4, WOOD.dark); leg(g, x1 - 3, Y(v, 15), Y(v + 0.08, 0), 4, WOOD.dark); }
      box(g, x0, x1, Y(0.12, 16), Y(1.88, 16), Y(1.88, 11), '#b08250', WOOD.mid, 'y', 2);
    }, OW);
  });
  return mk(2, 24, (g, P, Y, W) => {
    const x0 = 6, x1 = W - 6;
    P.layer((g) => {
      for (const x of [x0 + 8, x1 - 8]) { leg(g, x, Y(0.4, 15), Y(0.4, 0), 4, WOOD.dark); leg(g, x, Y(0.72, 12), Y(0.72, 0), 4.6); }
      g.fillStyle = WOOD.dark; g.fillRect(x0 + 8, Y(0.58, 5), x1 - x0 - 16, 2.4); // stretcher
      box(g, x0, x1, Y(0.32, 16), Y(0.7, 16), Y(0.7, 11), '#b08250', WOOD.mid, 'x', 2);
    }, OW);
  });
}
function stool() {
  return mk(1, 22, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.62, 0), 12, 4);
    P.layer((g) => {
      for (const [dx, v] of [[-8, 0.66], [8, 0.66], [0, 0.48]]) leg(g, cx + dx, Y(0.56, 13), Y(v, 0), 3.4, WOOD.mid);
      g.fillStyle = lin(g, 0, Y(0.56, 18), 0, Y(0.56, 12), [[0, WOOD.high], [1, WOOD.mid]]); g.beginPath(); g.ellipse(cx, Y(0.56, 15), 11, 5, 0, 0, TAU); g.fill();
      g.fillStyle = WOOD.mid; g.beginPath(); g.ellipse(cx, Y(0.56, 13), 11, 5, 0, 0, Math.PI); g.fill();
      g.fillStyle = lin(g, 0, Y(0.56, 18), 0, Y(0.56, 12), [[0, '#c99a64'], [1, WOOD.light]]); g.beginPath(); g.ellipse(cx, Y(0.56, 15), 10, 4.2, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(80,50,24,0.45)'; g.lineWidth = 0.7; g.beginPath(); g.ellipse(cx, Y(0.56, 15), 5, 2, 0, 0, TAU); g.stroke();
    }, 2.6);
  });
}
function chairFine(view) {
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, D = DARKW;
    P.layer((g) => {
      const sy0 = Y(0.38, 17), sy1 = Y(0.8, 17), fb = Y(0.8, 0);
      const back = () => {
        const by = view === 'n' ? Y(0.82, 48) : Y(0.36, 48);
        leg(g, cx - 11, by, view === 'n' ? Y(0.82, 0) : Y(0.36, 0), 4, D.mid); leg(g, cx + 11, by, view === 'n' ? Y(0.82, 0) : Y(0.36, 0), 4, D.mid);
        g.fillStyle = lin(g, 0, by, 0, by + 26, [[0, D.high], [1, D.light]]); g.fillRect(cx - 12, by, 24, 24);
        g.fillStyle = '#a3302a'; g.fillRect(cx - 9, by + 3, 18, 18); g.fillStyle = 'rgba(255,200,180,0.25)'; g.fillRect(cx - 9, by + 3, 18, 1.4);
        g.fillStyle = '#c9a24a'; for (const [x, y] of [[-9, 3], [9, 3], [-9, 21], [9, 21]]) { g.beginPath(); circle(g, cx + x, by + y, 0.8); g.fill(); }
      };
      if (view === 'e') {
        leg(g, cx - 10, Y(0.3, 46), Y(0.3, 0), 4, D.mid); leg(g, cx - 10, Y(0.8, 17), fb, 4, D.mid); leg(g, cx + 10, Y(0.3, 17), Y(0.3, 0), 4, D.mid); leg(g, cx + 10, Y(0.8, 17), fb, 4, D.mid);
        g.fillStyle = lin(g, 0, 0, 0, 1, [[0, D.high], [1, D.light]]); g.fillStyle = D.light; g.fillRect(cx - 13, Y(0.3, 46), 6, 28);
        g.fillStyle = '#a3302a'; g.fillRect(cx - 12, Y(0.3, 43), 4, 22);
        plankTop(g, cx - 13, sy0, cx + 13, sy1, D.high, 'y', 2);
        g.fillStyle = '#a3302a'; g.fillRect(cx - 9, sy0 + 1, 18, sy1 - sy0 - 2);
        return;
      }
      if (view !== 'n') back();
      leg(g, cx - 11, sy1, fb, 4.4, D.mid); leg(g, cx + 11, sy1, fb, 4.4, D.mid);
      plankTop(g, cx - 14, sy0, cx + 14, sy1, D.high, 'x', 2);
      g.fillStyle = '#a3302a'; g.fillRect(cx - 11, sy0 + 1, 22, sy1 - sy0 - 2); g.fillStyle = 'rgba(255,200,180,0.25)'; g.fillRect(cx - 11, sy0 + 1, 22, 1.2);
      face(g, cx - 14, cx + 14, sy1, sy1 + 4, D.light);
      if (view === 'n') back();
    }, OW);
  });
}
function tableRound() {
  return mk(1, 36, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.62, 0), 20, 6);
    P.layer((g) => {
      g.fillStyle = WOOD.dark; g.fillRect(cx - 3, Y(0.56, 24), 6, 22); g.beginPath(); g.ellipse(cx, Y(0.6, 1), 10, 3.4, 0, 0, TAU); g.fill();
      g.fillStyle = '#e6dcc6'; g.beginPath(); g.ellipse(cx, Y(0.5, 26), 25, 12, 0, 0, TAU); g.fill();
      g.fillStyle = '#d8ccb2'; g.beginPath(); g.moveTo(cx - 25, Y(0.5, 26)); g.quadraticCurveTo(cx - 25, Y(0.5, 18), cx - 18, Y(0.5, 14)); g.lineTo(cx + 18, Y(0.5, 14)); g.quadraticCurveTo(cx + 25, Y(0.5, 18), cx + 25, Y(0.5, 26)); g.quadraticCurveTo(cx, Y(0.5, 10), cx - 25, Y(0.5, 26)); g.fill();
      g.fillStyle = '#a3473a'; g.beginPath(); g.ellipse(cx, Y(0.5, 26), 25, 12, 0, 0, TAU); g.lineWidth = 1.6; g.strokeStyle = '#a3473a'; g.stroke();
      g.fillStyle = '#efe6cf'; g.fillRect(cx - 1.6, Y(0.5, 36), 3.2, 9); g.fillStyle = '#b0904a'; g.beginPath(); g.ellipse(cx, Y(0.5, 27), 5, 2, 0, 0, TAU); g.fill();
      g.fillStyle = '#9a6a3a'; g.beginPath(); g.ellipse(cx - 13, Y(0.45, 27), 4.5, 2.2, 0, 0, TAU); g.fill(); g.fillStyle = '#c84a3a'; g.beginPath(); circle(g, cx - 13, Y(0.45, 28.5), 1.8); g.fill();
    }, OW);
  });
}
function tableSmall() {
  return mk(1, 34, (g, P, Y, W) => {
    const cx = W / 2;
    P.layer((g) => {
      leg(g, cx - 12, Y(0.4, 20), Y(0.4, 0), 3.4, WOOD.dark); leg(g, cx + 12, Y(0.4, 20), Y(0.4, 0), 3.4, WOOD.dark);
      leg(g, cx - 12, Y(0.78, 20), Y(0.78, 0), 4, WOOD.mid); leg(g, cx + 12, Y(0.78, 20), Y(0.78, 0), 4, WOOD.mid);
      box(g, cx - 15, cx + 15, Y(0.36, 22), Y(0.78, 22), Y(0.78, 18), '#b08250', WOOD.mid, 'x', 2);
      g.fillStyle = lin(g, cx - 5, 0, cx + 5, 0, [[0, '#d07a4a'], [1, '#8a4224']]); g.beginPath(); g.moveTo(cx - 4, Y(0.56, 23)); g.quadraticCurveTo(cx - 7, Y(0.56, 30), cx - 3, Y(0.56, 36)); g.lineTo(cx + 3, Y(0.56, 36)); g.quadraticCurveTo(cx + 7, Y(0.56, 30), cx + 4, Y(0.56, 23)); g.closePath(); g.fill();
      g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(cx - 2, Y(0.56, 40), 2, 4, -0.4, 0, TAU); g.fill(); g.fillStyle = '#f29bc0'; g.beginPath(); circle(g, cx + 1.5, Y(0.56, 42), 2); g.fill();
    }, OW);
  });
}
function barrel() {
  return mk(1, 38, (g, P, Y, W) => {
    const cx = W / 2, top = Y(0.6, 36), bot = Y(0.6, 0);
    ground(g, cx, Y(0.62, 0), 16, 5);
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 15, 0, cx + 15, 0, [[0, '#a87a48'], [0.4, '#8a6038'], [1, '#5a3b22']]);
      g.beginPath(); g.moveTo(cx - 13, top); g.quadraticCurveTo(cx - 17, (top + bot) / 2, cx - 13, bot); g.ellipse(cx, bot, 13, 4.5, 0, Math.PI, 0, true); g.quadraticCurveTo(cx + 17, (top + bot) / 2, cx + 13, top); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,24,10,0.5)'; g.lineWidth = 0.8; for (const dx of [-8, -3, 2, 7]) { g.beginPath(); g.moveTo(cx + dx, top + 2); g.quadraticCurveTo(cx + dx * 1.2, (top + bot) / 2, cx + dx, bot); g.stroke(); }
      for (const y of [top + 5, bot - 6]) { g.strokeStyle = IRON.mid; g.lineWidth = 2.4; g.beginPath(); g.ellipse(cx, y, 14.5, 4, 0, 0.05, Math.PI - 0.05); g.stroke(); }
      g.fillStyle = '#b48a58'; g.beginPath(); g.ellipse(cx, top, 13, 4.6, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(70,42,20,0.6)'; g.beginPath(); g.moveTo(cx - 12, top); g.lineTo(cx + 12, top); g.moveTo(cx - 10, top - 2.4); g.lineTo(cx + 10, top - 2.4); g.stroke();
      g.strokeStyle = IRON.mid; g.lineWidth = 1.6; g.beginPath(); g.ellipse(cx, top, 13, 4.6, 0, 0, TAU); g.stroke();
    }, OW);
  });
}
function crateBox(g, x0, w, ty0, ty1, fb) {
  plankTop(g, x0, ty0, x0 + w, ty1, '#b48a58', 'x', 3);
  g.fillStyle = lin(g, x0, 0, x0 + w, 0, [[0, '#9a7246'], [1, '#6e4c2c']]); g.fillRect(x0, ty1, w, fb - ty1);
  g.fillStyle = '#7c5632'; g.fillRect(x0, ty1, 3.4, fb - ty1); g.fillRect(x0 + w - 3.4, ty1, 3.4, fb - ty1); g.fillRect(x0, ty1, w, 2.6); g.fillRect(x0, fb - 2.6, w, 2.6);
  g.strokeStyle = '#7c5632'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0 + 3, fb - 3); g.lineTo(x0 + w - 3, ty1 + 3); g.stroke();
}
function crates() {
  return mk(1, 46, (g, P, Y, W) => {
    P.layer((g) => {
      crateBox(g, 8, 30, Y(0.5, 22), Y(0.9, 22), Y(0.9, 0));
      crateBox(g, 34, 24, Y(0.42, 18), Y(0.72, 18), Y(0.72, 0));
      crateBox(g, 12, 24, Y(0.55, 42), Y(0.85, 42), Y(0.85, 22));
      g.fillStyle = '#c8b27a'; g.beginPath(); g.ellipse(24, Y(0.66, 44), 7, 3, 0.2, 0, TAU); g.fill();
    }, OW);
  });
}
function sacks() {
  return mk(1, 30, (g, P, Y, W) => {
    P.layer((g) => {
      const sack = (x, v, h, w, rot) => {
        g.save(); g.translate(x, Y(v, 0)); g.rotate(rot);
        g.fillStyle = lin(g, -w, 0, w, 0, [[0, '#d8c08a'], [0.5, '#bba06a'], [1, '#8a7448']]);
        g.beginPath(); g.moveTo(-w, 0); g.quadraticCurveTo(-w - 2, -h * 0.6, -w * 0.5, -h); g.lineTo(w * 0.5, -h); g.quadraticCurveTo(w + 2, -h * 0.6, w, 0); g.quadraticCurveTo(0, 3, -w, 0); g.fill();
        g.fillStyle = '#9a8454'; g.beginPath(); g.ellipse(0, -h, w * 0.4, 2.4, 0, 0, TAU); g.fill();
        g.strokeStyle = '#7a6438'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-w * 0.5, -h + 3); g.lineTo(w * 0.5, -h + 3); g.stroke();
        g.fillStyle = '#e8d8a8'; g.beginPath(); g.ellipse(0, -h - 2, w * 0.3, 1.6, 0, 0, TAU); g.fill();
        g.restore();
      };
      sack(20, 0.8, 22, 10, -0.08); sack(43, 0.78, 20, 9.5, 0.08); sack(32, 0.92, 18, 10, 0);
    }, OW);
  });
}
function jars() {
  return mk(1, 30, (g, P, Y, W) => {
    P.layer((g) => {
      const jar = (x, v, h, w, col) => {
        const b = Y(v, 0);
        g.fillStyle = lin(g, x - w, 0, x + w, 0, [[0, mixc(col, '#fff', 0.2)], [0.45, col], [1, mixc(col, '#000', 0.35)]]);
        g.beginPath(); g.moveTo(x - w * 0.4, b - h); g.quadraticCurveTo(x - w * 1.2, b - h * 0.55, x - w * 0.6, b); g.lineTo(x + w * 0.6, b); g.quadraticCurveTo(x + w * 1.2, b - h * 0.55, x + w * 0.4, b - h); g.closePath(); g.fill();
        g.fillStyle = mixc(col, '#000', 0.4); g.beginPath(); g.ellipse(x, b - h, w * 0.42, 1.6, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,240,220,0.3)'; g.fillRect(x - w * 0.6, b - h * 0.6, w * 1.2, 1);
      };
      jar(18, 0.7, 20, 8, '#c0703e'); jar(34, 0.86, 26, 10, '#b5603a'); jar(47, 0.74, 14, 7, '#d08a52'); jar(26, 0.94, 12, 6, '#8a9a8a');
    }, OW);
  });
}
function candles() {
  return mk(1, 18, (g, P, Y, W) => {
    const cx = W / 2;
    P.layer((g) => {
      g.fillStyle = '#b0904a'; g.beginPath(); g.ellipse(cx, Y(0.55, 1), 12, 4.5, 0, 0, TAU); g.fill(); g.fillStyle = '#d8b86a'; g.beginPath(); g.ellipse(cx, Y(0.55, 2), 10, 3.6, 0, 0, TAU); g.fill();
      for (const [dx, h] of DECOR_GEOM.candles.map((f) => [f[0] * 64, f[1] * 64 - 2])) { g.fillStyle = '#efe6cf'; g.fillRect(cx + dx - 1.6, Y(0.55, h), 3.2, h - 2); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(cx + dx - 1.6, Y(0.55, h), 1, h - 2); }
    }, 2);
  });
}
function candelabra() {
  return mk(1, 62, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.55, 0), 12, 4);
    P.layer((g) => {
      g.strokeStyle = IRON.mid; g.lineWidth = 2.4;
      g.beginPath(); for (const d of [-1, 0, 1]) { g.moveTo(cx, Y(0.55, 6)); g.lineTo(cx + d * 9, Y(0.55, 0) + (d ? 0 : -2)); } g.stroke();
      leg(g, cx, Y(0.55, 50), Y(0.55, 4), 3, IRON.mid);
      g.beginPath(); g.moveTo(cx - 14, Y(0.55, 42)); g.quadraticCurveTo(cx - 14, Y(0.55, 34), cx, Y(0.55, 34)); g.quadraticCurveTo(cx + 14, Y(0.55, 34), cx + 14, Y(0.55, 42)); g.stroke();
      g.beginPath(); g.moveTo(cx - 7, Y(0.55, 46)); g.quadraticCurveTo(cx - 7, Y(0.55, 40), cx, Y(0.55, 40)); g.quadraticCurveTo(cx + 7, Y(0.55, 40), cx + 7, Y(0.55, 46)); g.stroke();
      for (const [dx, h] of DECOR_GEOM.candelabra.map((f) => [f[0] * 64, f[1] * 64 - 2])) {
        g.fillStyle = IRON.light; g.fillRect(cx + dx - 3, Y(0.55, h - 8), 6, 2);
        g.fillStyle = '#efe6cf'; g.fillRect(cx + dx - 1.5, Y(0.55, h), 3, 7);
      }
    }, 2.2);
  });
}
function herbsHang() {
  return wallBox((g, cx, B) => {
    g.fillStyle = WOOD.mid; g.fillRect(cx - 18, B - 34, 36, 3);
    const greens = ['#5f8a3a', '#7a9a48', '#4e7a34'];
    for (let i = 0; i < 4; i++) {
      const x = cx - 13 + i * 8.6;
      g.strokeStyle = '#c8b27a'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x, B - 31); g.lineTo(x, B - 27); g.stroke();
      g.fillStyle = greens[i % 3]; g.beginPath(); g.moveTo(x - 1.5, B - 27); g.lineTo(x - 5, B - 10); g.quadraticCurveTo(x, B - 5, x + 5, B - 10); g.lineTo(x + 1.5, B - 27); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,200,0.25)'; g.fillRect(x - 1, B - 25, 1.2, 12);
      if (i === 1) { g.fillStyle = '#b05ad0'; for (let k = 0; k < 4; k++) { g.beginPath(); circle(g, x - 2 + k * 1.4, B - 9 - k, 1.1); g.fill(); } }
    }
  });
}
function curtain() {
  return wallBox((g, cx, B) => {
    g.fillStyle = IRON.mid; g.fillRect(cx - 22, B - 38, 44, 2.2);
    g.fillStyle = '#c9a24a'; g.beginPath(); circle(g, cx - 22, B - 37, 2); g.fill(); g.beginPath(); circle(g, cx + 22, B - 37, 2); g.fill();
    for (const d of [-1, 1]) {
      const x0 = cx + d * 20, x1 = cx + d * 6;
      g.fillStyle = lin(g, Math.min(x0, x1), 0, Math.max(x0, x1), 0, [[0, '#a3302a'], [0.5, '#c4443a'], [1, '#7a2420']]);
      g.beginPath(); g.moveTo(x0, B - 36); g.lineTo(x1, B - 36); g.quadraticCurveTo(x1 + d * 6, B - 18, x1 + d * 2, B - 4); g.lineTo(x0, B - 4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 1; k < 4; k++) g.fillRect(x0 - d * k * 4, B - 36, 1.4, 32);
      g.fillStyle = '#e6c56a'; g.fillRect(Math.min(x0, x1 + d * 4) , B - 18, Math.abs(x0 - x1) - 1, 2);
    }
  });
}
function plantPot(v) {
  const rand = rng(2100 + v);
  return mk(1, v === 2 ? 64 : 40, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.6, 0);
    ground(g, cx, Y(0.62, 0), 13, 4);
    P.layer((g) => {
      if (v === 2) { g.fillStyle = '#6a4428'; g.fillRect(cx - 1.6, Y(0.6, 46), 3.2, 32); leaves(g, cx, Y(0.6, 48), 17, 13, rand, 20); }
      else if (v === 1) leaves(g, cx, Y(0.6, 22), 15, 11, rand, 16, ['#4a7d34', '#57903c', '#62a046', '#366028']);
      else {
        for (let i = 0; i < 9; i++) { const a = -Math.PI * (0.1 + 0.8 * (i / 8)); g.strokeStyle = GREENS[i % 4]; g.lineWidth = 3.2; g.beginPath(); g.moveTo(cx, Y(0.6, 13)); g.quadraticCurveTo(cx + Math.cos(a) * 10, Y(0.6, 13) + Math.sin(a) * 18, cx + Math.cos(a) * 18, Y(0.6, 13) + Math.sin(a) * 12); g.stroke(); }
      }
      if (v === 1) flowerDots(g, cx - 12, cx + 12, Y(0.6, 30), Y(0.6, 16), rand, 7, ['#f7f7f2', '#f29bc0']);
      g.fillStyle = lin(g, cx - 10, 0, cx + 10, 0, [[0, '#d08a52'], [0.5, '#b5603a'], [1, '#7a3a20']]);
      g.beginPath(); g.moveTo(cx - 10, Y(0.6, 15)); g.lineTo(cx + 10, Y(0.6, 15)); g.lineTo(cx + 7, b); g.lineTo(cx - 7, b); g.closePath(); g.fill();
      g.fillStyle = '#c0703e'; g.fillRect(cx - 11, Y(0.6, 17), 22, 4);
      g.fillStyle = 'rgba(255,230,200,0.35)'; g.fillRect(cx - 11, Y(0.6, 17), 22, 1);
    }, 2.4);
  });
}
function rugRound() {
  return spritePx(128, 128, (g, P) => P.layer((g) => {
    const rings = ['#7a3a2a', '#c9a24a', '#2f5a86', '#d8c8a0', '#8a2e2a', '#e6c56a', '#3f6a34'];
    for (let i = 0; i < rings.length; i++) { const r = 58 - i * 7.5; g.fillStyle = rings[i]; g.beginPath(); g.ellipse(64, 64, r, r, 0, 0, TAU); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1; for (let k = 0; k < 2; k++) { g.beginPath(); g.ellipse(64, 64, r - 2.5 - k * 2.5, r - 2.5 - k * 2.5, 0, 0, TAU); g.stroke(); } }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(52, 50, 30, 20, -0.5, 0, TAU); g.fill();
  }, 2, 'rgba(40,20,10,0.8)'), { crop: false });
}
function rugFur() {
  return spritePx(128, 64, (g, P) => P.layer((g) => {
    g.fillStyle = lin(g, 0, 8, 0, 56, [[0, '#9a7448'], [0.5, '#7a5432'], [1, '#5a3a20']]);
    g.beginPath();
    g.moveTo(22, 32); g.quadraticCurveTo(26, 12, 38, 14); g.lineTo(34, 4); g.lineTo(46, 12); g.quadraticCurveTo(64, 8, 84, 12); g.lineTo(96, 4); g.lineTo(92, 15);
    g.quadraticCurveTo(104, 20, 106, 32); g.quadraticCurveTo(104, 44, 92, 49); g.lineTo(96, 60); g.lineTo(84, 52); g.quadraticCurveTo(64, 56, 46, 52); g.lineTo(34, 60); g.lineTo(38, 50); g.quadraticCurveTo(26, 52, 22, 32); g.closePath(); g.fill();
    g.fillStyle = '#6a4a2c'; g.beginPath(); g.ellipse(112, 32, 11, 10, 0, 0, TAU); g.fill(); // head
    g.fillStyle = '#4a3220'; g.beginPath(); circle(g, 114, 23, 3.5); g.fill(); g.beginPath(); circle(g, 114, 41, 3.5); g.fill(); g.fillStyle = '#2a1a10'; g.beginPath(); g.ellipse(121, 32, 3, 2.4, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(40,24,10,0.35)'; g.lineWidth = 0.8; for (let i = 0; i < 30; i++) { const x = 30 + (i * 37) % 70, y = 16 + (i * 13) % 32; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 1.6); g.stroke(); }
    g.fillStyle = 'rgba(255,240,210,0.18)'; g.beginPath(); g.ellipse(60, 26, 30, 9, 0, 0, TAU); g.fill();
  }, 2, 'rgba(40,24,12,0.85)'), { crop: false });
}
function painting() {
  return wallBox((g, cx, B) => {
    g.fillStyle = lin(g, 0, B - 32, 0, B - 6, [[0, '#d0a24a'], [1, '#8a6224']]); g.fillRect(cx - 17, B - 32, 34, 25);
    g.fillStyle = lin(g, 0, B - 29, 0, B - 9, [[0, '#9cc8e8'], [0.55, '#f0d8a0'], [0.56, '#6a9a4c'], [1, '#3f6e34']]); g.fillRect(cx - 14, B - 29, 28, 19);
    g.fillStyle = '#4e7a3a'; g.beginPath(); g.moveTo(cx - 14, B - 15); g.lineTo(cx - 6, B - 22); g.lineTo(cx + 1, B - 17); g.lineTo(cx + 14, B - 24); g.lineTo(cx + 14, B - 10); g.lineTo(cx - 14, B - 10); g.closePath(); g.fill();
    g.fillStyle = '#fff0b0'; g.beginPath(); circle(g, cx + 8, B - 25, 2.2); g.fill();
    g.fillStyle = '#2f5a86'; g.fillRect(cx - 14, B - 12, 28, 2);
  });
}
function trophy() {
  return wallBox((g, cx, B) => {
    g.fillStyle = lin(g, cx - 9, B - 20, cx + 9, B - 4, [[0, '#9a6a40'], [1, '#5a3a20']]); g.beginPath(); g.moveTo(cx - 9, B - 19); g.lineTo(cx + 9, B - 19); g.lineTo(cx + 7, B - 6); g.lineTo(cx, B - 3); g.lineTo(cx - 7, B - 6); g.closePath(); g.fill();
    g.fillStyle = '#8a6a48'; g.beginPath(); g.ellipse(cx, B - 13, 5.4, 6.6, 0, 0, TAU); g.fill(); g.fillStyle = '#2a1a10'; g.beginPath(); circle(g, cx - 2, B - 14, 0.9); g.fill(); g.beginPath(); circle(g, cx + 2, B - 14, 0.9); g.fill();
    g.strokeStyle = '#efe2c4'; g.lineWidth = 2;
    for (const d of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + d * 3, B - 19); g.quadraticCurveTo(cx + d * 12, B - 24, cx + d * 16, B - 36);
      g.moveTo(cx + d * 8, B - 23); g.lineTo(cx + d * 8, B - 32); g.moveTo(cx + d * 13, B - 28); g.lineTo(cx + d * 19, B - 30); g.moveTo(cx + d * 15, B - 33); g.lineTo(cx + d * 12, B - 40); g.stroke();
    }
  });
}
function potHooks() {
  return wallBox((g, cx, B) => {
    g.fillStyle = WOOD.mid; g.fillRect(cx - 22, B - 36, 44, 3);
    g.strokeStyle = IRON.light; g.lineWidth = 1; for (const x of [-15, -2, 11, 19]) { g.beginPath(); g.moveTo(cx + x, B - 33); g.lineTo(cx + x, B - 30); g.stroke(); }
    g.fillStyle = '#b8703e'; g.beginPath(); circle(g, cx - 15, B - 21, 7.5); g.fill(); g.fillStyle = '#8a4a26'; g.beginPath(); circle(g, cx - 15, B - 21, 5); g.fill(); g.fillStyle = '#b8703e'; g.fillRect(cx - 16, B - 31, 2, 4); // pan
    g.fillStyle = IRON.mid; g.beginPath(); g.moveTo(cx - 7, B - 26); g.lineTo(cx + 3, B - 26); g.lineTo(cx + 2, B - 15); g.quadraticCurveTo(cx - 2, B - 12, cx - 6, B - 15); g.closePath(); g.fill(); g.strokeStyle = IRON.light; g.lineWidth = 1; g.beginPath(); g.arc(cx - 2, B - 28, 3, Math.PI, 0); g.stroke(); // pot
    g.fillStyle = '#8a5a30'; g.fillRect(cx + 10.4, B - 30, 1.6, 15); g.fillStyle = IRON.light; g.beginPath(); g.ellipse(cx + 11.2, B - 14, 3, 2.2, 0, 0, TAU); g.fill(); // ladle
    g.fillStyle = '#8a5a30'; g.fillRect(cx + 18.4, B - 30, 1.6, 11); g.fillStyle = '#c8c8d0'; g.fillRect(cx + 17.6, B - 20, 3.2, 8); // knife/spatula
  });
}
function weaponRack(east) {
  const draw = (g, Y, x0, x1, dEast) => {
    if (dEast) {
      leg(g, (x0 + x1) / 2, Y(0.2, 40), Y(0.2, 0), 4, WOOD.mid); leg(g, (x0 + x1) / 2, Y(1.8, 40), Y(1.8, 0), 4, WOOD.mid);
      g.fillStyle = WOOD.dark; g.fillRect((x0 + x1) / 2 - 3, Y(1.8, 38), 6, Y(0.2, 38) - Y(1.8, 38) + 4);
      for (let i = 0; i < 4; i++) { const v = 0.4 + i * 0.36; g.strokeStyle = '#8a5a30'; g.lineWidth = 2; g.beginPath(); g.moveTo((x0 + x1) / 2 + 3, Y(v, 0)); g.lineTo((x0 + x1) / 2 + 5, Y(v, 54)); g.stroke(); g.fillStyle = IRON.light; g.beginPath(); g.moveTo((x0 + x1) / 2 + 5, Y(v, 62)); g.lineTo((x0 + x1) / 2 + 3, Y(v, 54)); g.lineTo((x0 + x1) / 2 + 7, Y(v, 54)); g.closePath(); g.fill(); }
      return;
    }
    leg(g, x0 + 4, Y(0.55, 42), Y(0.55, 0), 4.5, WOOD.mid); leg(g, x1 - 4, Y(0.55, 42), Y(0.55, 0), 4.5, WOOD.mid);
    g.fillStyle = WOOD.dark; g.fillRect(x0, Y(0.55, 38), x1 - x0, 4); g.fillRect(x0, Y(0.55, 10), x1 - x0, 4);
    for (let i = 0; i < 4; i++) {
      const x = x0 + 14 + i * 11;
      g.strokeStyle = '#8a5a30'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, Y(0.7, 0)); g.lineTo(x + 2, Y(0.55, 54)); g.stroke();
      g.fillStyle = IRON.light; g.beginPath(); g.moveTo(x + 2, Y(0.55, 64)); g.lineTo(x - 1, Y(0.55, 54)); g.lineTo(x + 5, Y(0.55, 54)); g.closePath(); g.fill();
    }
    g.fillStyle = '#c8c8d0'; g.fillRect(x1 - 30, Y(0.6, 50), 2.4, 30); g.fillStyle = '#8a6a2a'; g.fillRect(x1 - 33, Y(0.6, 22), 8.4, 2.4); g.fillRect(x1 - 30, Y(0.6, 20), 2.4, 8);
    g.fillStyle = lin(g, x1 - 20, 0, x1 - 6, 0, [[0, '#b23a30'], [1, '#6e1e18']]); g.beginPath(); g.ellipse(x1 - 13, Y(0.72, 18), 9, 12, 0, 0, TAU); g.fill();
    g.fillStyle = '#e6c56a'; g.beginPath(); circle(g, x1 - 13, Y(0.72, 18), 3); g.fill(); g.strokeStyle = IRON.mid; g.lineWidth = 1.6; g.beginPath(); g.ellipse(x1 - 13, Y(0.72, 18), 9, 12, 0, 0, TAU); g.stroke();
  };
  if (east) return mkv(1, 2, 64, (g, P, Y, W) => P.layer((g) => draw(g, Y, 16, W - 16, true), OW));
  return mk(2, 64, (g, P, Y, W) => P.layer((g) => draw(g, Y, 12, W - 12, false), OW));
}
function armorStand() {
  return mk(1, 66, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.6, 0), 14, 4);
    P.layer((g) => {
      g.fillStyle = WOOD.dark; g.fillRect(cx - 12, Y(0.6, 3), 24, 4); leg(g, cx, Y(0.6, 54), Y(0.6, 3), 4, WOOD.mid);
      g.fillStyle = WOOD.mid; g.fillRect(cx - 14, Y(0.6, 46), 28, 3.4);
      // torso: leather / chain
      g.fillStyle = lin(g, cx - 13, 0, cx + 13, 0, [[0, '#9aa0aa'], [0.5, '#7a808a'], [1, '#4a4e56']]);
      g.beginPath(); g.moveTo(cx - 14, Y(0.6, 46)); g.lineTo(cx + 14, Y(0.6, 46)); g.lineTo(cx + 11, Y(0.6, 18)); g.lineTo(cx - 11, Y(0.6, 18)); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,30,36,0.5)'; g.lineWidth = 0.7; for (let y = 20; y < 46; y += 2.6) { g.beginPath(); g.moveTo(cx - 12, Y(0.6, y)); g.lineTo(cx + 12, Y(0.6, y)); g.stroke(); }
      g.fillStyle = '#7a4a2a'; g.fillRect(cx - 12, Y(0.6, 24), 24, 3); g.fillStyle = '#c9a24a'; g.fillRect(cx - 2, Y(0.6, 25), 4, 4);
      for (const d of [-1, 1]) { g.fillStyle = '#6e747e'; g.beginPath(); g.ellipse(cx + d * 13, Y(0.6, 45), 5, 3.6, 0, 0, TAU); g.fill(); }
      // helmet
      g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, '#b8bec8'], [1, '#5a5e68']]); g.beginPath(); g.ellipse(cx, Y(0.6, 56), 8, 8.4, 0, Math.PI, 0); g.lineTo(cx + 8, Y(0.6, 50)); g.lineTo(cx - 8, Y(0.6, 50)); g.closePath(); g.fill();
      g.fillStyle = '#2a2a30'; g.fillRect(cx - 5, Y(0.6, 55), 10, 1.6); g.fillStyle = IRON.mid; g.fillRect(cx - 0.8, Y(0.6, 55), 1.6, 5);
    }, OW);
  });
}
function fireplace(east) {
  if (east) return mkv(1, 2, 60, (g, P, Y, W) => {
    const x0 = 10, x1 = W - 10;
    P.layer((g) => {
      g.fillStyle = '#4a453e'; g.fillRect(x0, Y(1.85, 58), x1 - x0, Y(0.15, 58) - Y(1.85, 58));
      stoneTop(g, x0, Y(0.15, 58), x1, Y(1.85, 58));
      face(g, x0, x1, Y(1.85, 58), Y(1.85, 0), STONE.mid);
      g.fillStyle = 'rgba(40,36,30,0.45)'; for (let y = 8; y < 58; y += 9) g.fillRect(x0, Y(1.85, y), x1 - x0, 1);
      g.fillStyle = '#5a3b22'; g.fillRect(x1 - 4, Y(1.5, 30), 6, Y(0.5, 30) - Y(1.5, 30)); // mantel edge
    }, OW);
  });
  return mk(2, 60, (g, P, Y, W) => {
    const x0 = 6, x1 = W - 6, v0 = 0.3, v1 = 0.8;
    P.layer((g) => {
      // chimney breast
      stoneTop(g, x0 + 14, Y(v0, 60), x1 - 14, Y(0.55, 60));
      g.save(); g.beginPath(); g.rect(x0 + 14, Y(0.55, 60), x1 - x0 - 28, Y(0.55, 30) - Y(0.55, 60)); g.clip();
      g.fillStyle = '#5a554d'; g.fillRect(x0, Y(0.55, 60), x1 - x0, 40);
      for (let r = 0; r < 5; r++) for (let k = 0; k < 7; k++) { const X = x0 + 14 + k * 14 - (r & 1 ? 7 : 0), Yy = Y(0.55, 60) + r * 6; g.fillStyle = ['#a8a092', '#9a9386', '#b2aa9c'][(k + r) % 3]; g.fillRect(X + 0.6, Yy + 0.6, 12.8, 4.8); }
      g.restore();
      // hearth body
      g.fillStyle = '#4a453e'; g.fillRect(x0, Y(v1, 30), x1 - x0, Y(v1, 0) - Y(v1, 30));
      stoneTop(g, x0, Y(0.48, 30), x1, Y(v1, 30));
      g.save(); g.beginPath(); g.rect(x0, Y(v1, 30), x1 - x0, 30); g.clip();
      for (let r = 0; r < 5; r++) for (let k = 0; k < 9; k++) { const X = x0 + k * 14 - (r & 1 ? 7 : 0), Yy = Y(v1, 30) + r * 6; g.fillStyle = ['#a8a092', '#948d80', '#b2aa9c', '#8c857a'][(k * 3 + r) % 4]; g.fillRect(X + 0.6, Yy + 0.6, 12.8, 4.8); g.fillStyle = 'rgba(255,255,245,0.3)'; g.fillRect(X + 0.6, Yy + 0.6, 12.8, 0.9); }
      g.restore();
      // firebox opening (arched, dark)
      const cx = W / 2;
      g.fillStyle = '#16100c'; g.beginPath(); g.moveTo(cx - 26, Y(v1, 0)); g.lineTo(cx - 26, Y(v1, 16)); g.quadraticCurveTo(cx, Y(v1, 30), cx + 26, Y(v1, 16)); g.lineTo(cx + 26, Y(v1, 0)); g.closePath(); g.fill();
      g.fillStyle = '#3a2014'; g.fillRect(cx - 22, Y(v1, 4), 44, 4);
      g.fillStyle = '#6a4428'; g.fillRect(cx - 14, Y(v1, 6), 28, 3.4); g.fillRect(cx - 10, Y(v1, 9), 22, 3); // logs
      // mantel
      g.fillStyle = lin(g, 0, Y(v1, 33), 0, Y(v1, 28), [[0, '#9a6a40'], [1, '#5a3b22']]); g.fillRect(x0 - 2, Y(v1, 34), x1 - x0 + 4, 6);
      g.fillStyle = '#efe6cf'; g.fillRect(x0 + 10, Y(0.6, 44), 3, 9); g.fillRect(x1 - 13, Y(0.6, 44), 3, 9);
      g.fillStyle = '#b0904a'; g.fillRect(x0 + 8, Y(0.6, 35), 7, 2); g.fillRect(x1 - 15, Y(0.6, 35), 7, 2);
    }, OW);
  });
}
function washtub(east) {
  const tub = (g, cx, cy, rx, ry, h) => {
    g.fillStyle = lin(g, cx - rx, 0, cx + rx, 0, [[0, '#a87a48'], [0.45, '#8a6038'], [1, '#5a3b22']]);
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); g.lineTo(cx - rx, cy - h); g.ellipse(cx, cy - h, rx, ry, 0, Math.PI, 0, true); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,24,10,0.45)'; g.lineWidth = 0.8; for (let k = -4; k <= 4; k++) { g.beginPath(); g.moveTo(cx + k * rx / 5, cy - h + ry * 0.9); g.lineTo(cx + k * rx / 5, cy + ry * 0.9); g.stroke(); }
    g.strokeStyle = IRON.mid; g.lineWidth = 2; for (const y of [cy - h + 5, cy - 3]) { g.beginPath(); g.ellipse(cx, y, rx + 0.5, ry, 0, 0.1, Math.PI - 0.1); g.stroke(); }
    g.fillStyle = '#b48a58'; g.beginPath(); g.ellipse(cx, cy - h, rx, ry, 0, 0, TAU); g.fill();
    g.fillStyle = lin(g, 0, cy - h - ry, 0, cy - h + ry, [[0, '#9cc8dc'], [1, '#5a8aa0']]); g.beginPath(); g.ellipse(cx, cy - h + 1, rx - 3, ry - 2.6, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 9; i++) { g.beginPath(); circle(g, cx - rx * 0.5 + ((i * 37) % 100) / 100 * rx, cy - h + ((i * 23) % 10 - 5) * ry / 8, 1.4 + (i % 3) * 0.6); g.fill(); }
  };
  if (east) return mkv(1, 2, 30, (g, P, Y, W) => P.layer((g) => {
    tub(g, W / 2, Y(1.6, 0), 20, 44, 22);
  }, OW));
  return mk(2, 30, (g, P, Y, W) => P.layer((g) => {
    tub(g, W / 2, Y(0.78, 0), 50, 18, 22);
    g.fillStyle = '#efe6cf'; g.fillRect(W - 22, Y(0.85, 8), 12, 6); g.fillStyle = '#d8ccb2'; g.fillRect(W - 22, Y(0.85, 8), 12, 1.6); // towel
  }, OW));
}
// training dummy: base (stand) + body (pivots at the base for the wobble)
function dummy(part) {
  return mk(1, 66, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.62, 0);
    if (part !== 'body') {
      ground(g, cx, b, 16, 5, 0.35);
      P.layer((g) => {
        g.fillStyle = WOOD.dark; g.fillRect(cx - 14, b - 4, 28, 4.5); g.fillRect(cx - 2.5, b - 10, 5, 8);
        g.fillStyle = WOOD.mid; g.beginPath(); g.moveTo(cx - 12, b - 2); g.lineTo(cx - 3, b - 9); g.lineTo(cx - 1, b - 7); g.lineTo(cx - 9, b); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(cx + 12, b - 2); g.lineTo(cx + 3, b - 9); g.lineTo(cx + 1, b - 7); g.lineTo(cx + 9, b); g.closePath(); g.fill();
      }, 2.4);
    }
    if (part === 'base') return;
    P.layer((g) => {
      leg(g, cx, Y(0.62, 62), b - 8, 4, WOOD.mid); // pole
      // crossbar arms wrapped in straw
      g.fillStyle = WOOD.mid; g.fillRect(cx - 22, Y(0.62, 44), 44, 4);
      for (const d of [-1, 1]) { g.fillStyle = lin(g, 0, Y(0.62, 47), 0, Y(0.62, 39), [[0, '#e8cf8a'], [1, '#b8984e']]); g.beginPath(); g.ellipse(cx + d * 17, Y(0.62, 42.5), 6, 4.2, 0, 0, TAU); g.fill(); g.strokeStyle = '#9a7a3a'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(cx + d * 22, Y(0.62, 41)); g.lineTo(cx + d * 25, Y(0.62, 39)); g.moveTo(cx + d * 22, Y(0.62, 44)); g.lineTo(cx + d * 26, Y(0.62, 45)); g.stroke(); }
      // straw torso bound with rope, burlap sack over it, target painted on the chest
      g.fillStyle = lin(g, cx - 12, 0, cx + 12, 0, [[0, '#e8cf8a'], [0.5, '#d0b066'], [1, '#9a7a3a']]);
      g.beginPath(); g.moveTo(cx - 11, Y(0.62, 46)); g.quadraticCurveTo(cx - 14, Y(0.62, 30), cx - 10, Y(0.62, 14)); g.lineTo(cx + 10, Y(0.62, 14)); g.quadraticCurveTo(cx + 14, Y(0.62, 30), cx + 11, Y(0.62, 46)); g.closePath(); g.fill();
      g.strokeStyle = '#b8984e'; g.lineWidth = 0.8; for (let i = 0; i < 9; i++) { const x = cx - 9 + i * 2.2; g.beginPath(); g.moveTo(x, Y(0.62, 15)); g.lineTo(x + (i & 1 ? 1 : -1), Y(0.62, 10)); g.stroke(); }
      g.strokeStyle = '#7a5a30'; g.lineWidth = 1.6; for (const h of [20, 36]) { g.beginPath(); g.moveTo(cx - 12, Y(0.62, h)); g.quadraticCurveTo(cx, Y(0.62, h - 2), cx + 12, Y(0.62, h)); g.stroke(); }
      g.fillStyle = '#f2ead6'; g.beginPath(); g.ellipse(cx, Y(0.62, 28), 7, 7, 0, 0, TAU); g.fill();
      g.fillStyle = '#c0392b'; g.beginPath(); g.ellipse(cx, Y(0.62, 28), 5, 5, 0, 0, TAU); g.fill();
      g.fillStyle = '#f2ead6'; g.beginPath(); g.ellipse(cx, Y(0.62, 28), 2.8, 2.8, 0, 0, TAU); g.fill();
      g.fillStyle = '#c0392b'; g.beginPath(); circle(g, cx, Y(0.62, 28), 1.2); g.fill();
      // burlap head with stitched face
      g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, '#d8c08a'], [1, '#9a8454']]); g.beginPath(); g.ellipse(cx, Y(0.62, 54), 8, 8.6, 0, 0, TAU); g.fill();
      g.strokeStyle = '#5a4428'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 4.5, Y(0.62, 56.5)); g.lineTo(cx - 1.5, Y(0.62, 53.5)); g.moveTo(cx - 1.5, Y(0.62, 56.5)); g.lineTo(cx - 4.5, Y(0.62, 53.5)); g.moveTo(cx + 1.5, Y(0.62, 56.5)); g.lineTo(cx + 4.5, Y(0.62, 53.5)); g.moveTo(cx + 4.5, Y(0.62, 56.5)); g.lineTo(cx + 1.5, Y(0.62, 53.5)); g.stroke();
      g.beginPath(); g.moveTo(cx - 4, Y(0.62, 50)); for (let k = 0; k < 5; k++) g.lineTo(cx - 4 + k * 2, Y(0.62, 50 + (k & 1 ? 1 : -0.4))); g.stroke();
      g.strokeStyle = '#7a5a30'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - 6, Y(0.62, 47)); g.lineTo(cx + 6, Y(0.62, 47)); g.stroke();
      g.strokeStyle = '#e0c47c'; g.lineWidth = 0.9; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(cx - 3 + i * 1.6, Y(0.62, 62)); g.lineTo(cx - 4 + i * 2, Y(0.62, 66)); g.stroke(); }
    }, 2.6);
  });
}

// ---------------- exterior / garden ----------------
function lampStone(glow) {
  return mk(1, 52, (g, P, Y, W) => {
    const cx = W / 2;
    if (glow) { g.fillStyle = rad(g, cx, Y(0.6, 38), 0, 9, [[0, '#fff6d0'], [0.5, '#ffc860'], [1, 'rgba(255,150,40,0)']]); g.fillRect(cx - 9, Y(0.6, 47), 18, 18); g.fillStyle = 'rgba(255,214,120,0.9)'; g.fillRect(cx - 5, Y(0.6, 43), 10, 9); return; }
    ground(g, cx, Y(0.6, 0), 14, 4);
    P.layer((g) => {
      g.fillStyle = STONE.dark; g.fillRect(cx - 11, Y(0.6, 6), 22, 6.5); stoneTop(g, cx - 11, Y(0.5, 6), cx + 11, Y(0.6, 6), STONE.mid);
      g.fillStyle = lin(g, cx - 6, 0, cx + 6, 0, [[0, STONE.light], [1, STONE.dark]]); g.fillRect(cx - 5, Y(0.6, 30), 10, 24);
      g.fillStyle = lin(g, cx - 11, 0, cx + 11, 0, [[0, STONE.light], [1, STONE.dark]]); g.fillRect(cx - 10, Y(0.6, 33), 20, 4);
      g.fillStyle = lin(g, cx - 9, 0, cx + 9, 0, [[0, STONE.high], [1, STONE.mid]]); g.fillRect(cx - 8.5, Y(0.6, 49), 17, 16);
      g.fillStyle = '#2a2420'; g.fillRect(cx - 5, Y(0.6, 47), 10, 11);
      g.fillStyle = STONE.mid; g.fillRect(cx - 0.8, Y(0.6, 47), 1.6, 11);
      g.fillStyle = lin(g, 0, Y(0.6, 58), 0, Y(0.6, 49), [[0, STONE.high], [1, STONE.dark]]); g.beginPath(); g.moveTo(cx - 13, Y(0.6, 49)); g.lineTo(cx, Y(0.6, 58)); g.lineTo(cx + 13, Y(0.6, 49)); g.closePath(); g.fill();
      g.fillStyle = STONE.light; g.beginPath(); circle(g, cx, Y(0.6, 59), 2.2); g.fill();
    }, OW);
  }, glow ? { pad: 12 } : undefined);
}
function lampWood(glow) {
  return mk(1, 86, (g, P, Y, W) => {
    const cx = W / 2 - 8, lx = cx + 15, ly = Y(0.6, 66);
    if (glow) { g.fillStyle = rad(g, lx, ly, 0, 8, [[0, '#fff6d0'], [0.5, '#ffc860'], [1, 'rgba(255,150,40,0)']]); g.fillRect(lx - 8, ly - 9, 16, 18); g.fillStyle = 'rgba(255,214,120,0.85)'; g.fillRect(lx - 3.6, ly - 4, 7.2, 8); return; }
    ground(g, cx, Y(0.6, 0), 10, 3);
    P.layer((g) => {
      g.fillStyle = '#8f897e'; g.fillRect(cx - 6, Y(0.6, 6), 12, 6);
      leg(g, cx, Y(0.6, 86), Y(0.6, 5), 6, WOOD.mid);
      g.fillStyle = WOOD.mid; g.fillRect(cx - 3, Y(0.6, 81), 22, 4); // arm
      g.strokeStyle = WOOD.dark; g.lineWidth = 2.4; g.beginPath(); g.moveTo(cx + 2, Y(0.6, 70)); g.lineTo(cx + 12, Y(0.6, 79)); g.stroke(); // brace
      g.strokeStyle = IRON.mid; g.lineWidth = 1; g.beginPath(); g.moveTo(lx, Y(0.6, 77)); g.lineTo(lx, ly - 8); g.stroke();
      g.fillStyle = IRON.dark; g.beginPath(); g.moveTo(lx - 6, ly - 5); g.lineTo(lx, ly - 10); g.lineTo(lx + 6, ly - 5); g.closePath(); g.fill();
      g.fillStyle = '#5a5a52'; g.fillRect(lx - 5, ly - 5, 10, 11); g.fillStyle = '#8a8270'; g.fillRect(lx - 3.6, ly - 4, 7.2, 8);
      g.fillStyle = IRON.dark; g.fillRect(lx - 0.5, ly - 4, 1, 8); g.fillRect(lx - 5.5, ly + 6, 11, 2.4);
      g.fillStyle = WOOD.high; g.fillRect(cx - 4, Y(0.6, 88), 8, 3);
    }, 2.6);
  }, glow ? { pad: 12 } : undefined);
}
function flowerBed(v) {
  const rand = rng(2200 + v);
  const pals = [['#e0506a', '#f29bc0', '#f7f7f2'], ['#f4d35e', '#ee6c4d', '#f08a3a'], ['#7fb0f0', '#c58fe0', '#f7f7f2']];
  return mk(1, 20, (g, P, Y, W) => {
    P.layer((g) => {
      g.fillStyle = '#4a3322'; g.beginPath(); if (g.roundRect) g.roundRect(4, Y(0.08, 0), W - 8, Y(0.94, 0) - Y(0.08, 0), 8); else g.rect(4, Y(0.08, 0), W - 8, Y(0.94, 0) - Y(0.08, 0)); g.fill();
      for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU, x = W / 2 + Math.cos(a) * 27, y = Y(0.51, 0) + Math.sin(a) * 25; g.fillStyle = ['#a8a092', '#bcb4a6', '#8f887b'][i % 3]; g.beginPath(); g.ellipse(x, y, 3.4, 2.4, a, 0, TAU); g.fill(); }
    }, 1.8);
    P.layer((g) => {
      for (let i = 0; i < 26; i++) {
        const x = 12 + rand() * (W - 24), v0 = 0.18 + rand() * 0.66, h = 5 + rand() * 9, y = Y(v0, 0);
        g.strokeStyle = '#4b7a32'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - h); g.stroke();
        g.fillStyle = GREENS[(rand() * 3) | 0]; g.beginPath(); g.ellipse(x + 2, y - h * 0.4, 2.6, 1.3, 0.6, 0, TAU); g.fill();
        const c = pals[v][(rand() * 3) | 0];
        g.fillStyle = c; for (let k = 0; k < 4; k++) { const a = k * 1.57 + rand(); g.beginPath(); g.ellipse(x + Math.cos(a) * 1.8, y - h + Math.sin(a) * 1.4, 1.6, 1.1, a, 0, TAU); g.fill(); }
        g.fillStyle = '#ffe680'; g.beginPath(); circle(g, x, y - h, 0.8); g.fill();
      }
    }, 1.2);
  });
}
function planter(east) {
  const rand = rng(east ? 2302 : 2301);
  const flowers = (g, x0, x1, y0, y1) => { for (let i = 0; i < 22; i++) { const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0); g.fillStyle = GREENS[i % 4]; g.beginPath(); g.ellipse(x, y, 3.2, 2.2, rand() * 3, 0, TAU); g.fill(); } flowerDots(g, x0, x1, y0 - 2, y1, rand, 16); };
  if (east) return mkv(1, 2, 30, (g, P, Y, W) => P.layer((g) => {
    box(g, 18, W - 18, Y(0.15, 16), Y(1.85, 16), Y(1.85, 0), '#8f6440', WOOD.mid, 'y', 2);
    g.fillStyle = '#4a3322'; g.fillRect(21, Y(0.2, 16), W - 42, Y(1.8, 16) - Y(0.2, 16));
    flowers(g, 20, W - 20, Y(0.25, 22), Y(1.8, 18));
  }, OW));
  return mk(2, 30, (g, P, Y, W) => P.layer((g) => {
    box(g, 8, W - 8, Y(0.4, 16), Y(0.8, 16), Y(0.8, 0), '#8f6440', WOOD.mid, 'x', 2);
    g.fillStyle = '#4a3322'; g.fillRect(11, Y(0.43, 16), W - 22, Y(0.77, 16) - Y(0.43, 16));
    flowers(g, 12, W - 12, Y(0.42, 24), Y(0.78, 18));
    g.fillStyle = WOOD.dark; g.fillRect(8, Y(0.8, 4), W - 16, 2.4);
  }, OW));
}
function stepping(v) {
  const rand = rng(2400 + v);
  return spritePx(64, 64, (g, P) => P.layer((g) => {
    const n = 2 + (v % 2);
    for (let i = 0; i < n; i++) {
      const x = 14 + rand() * 36, y = 14 + rand() * 36, rx = 9 + rand() * 6, ry = 7 + rand() * 4;
      g.fillStyle = ['#a8a092', '#9a9386', '#b2aa9c'][i % 3]; g.beginPath(); smoothClosed(g, blobPts(x, y, rx, ry, rand, 7, 0.14)); g.fill();
      g.fillStyle = 'rgba(255,255,245,0.35)'; g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.45, ry * 0.3, -0.3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(86,118,52,0.5)'; g.beginPath(); g.ellipse(x + rx * 0.6, y + ry * 0.6, 3, 1.6, 0, 0, TAU); g.fill();
    }
  }, 1.4, 'rgba(40,36,30,0.7)'), { crop: false });
}
function well() {
  return mk(1, 76, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.62, 0), 28, 8);
    P.layer((g) => {
      // posts and roof (behind the ring top is fine: drawn first)
      for (const d of [-1, 1]) leg(g, cx + d * 22, Y(0.5, 66), Y(0.5, 10), 4.4, WOOD.mid);
      // ring of stones
      g.fillStyle = lin(g, cx - 27, 0, cx + 27, 0, [[0, STONE.light], [0.5, STONE.mid], [1, STONE.dark]]);
      g.beginPath(); g.ellipse(cx, Y(0.62, 0), 27, 9, 0, 0, Math.PI); g.lineTo(cx - 27, Y(0.62, 20)); g.ellipse(cx, Y(0.62, 20), 27, 9, 0, Math.PI, 0, true); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,36,30,0.5)'; g.lineWidth = 0.9; for (const h of [7, 14]) { g.beginPath(); g.ellipse(cx, Y(0.62, h), 27, 9, 0, 0.1, Math.PI - 0.1); g.stroke(); }
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx + k * 11, Y(0.62, 20) + 8.4 - Math.abs(k) * 1.6); g.lineTo(cx + k * 11 + 2, Y(0.62, 0) + 8.4 - Math.abs(k) * 1.6); g.stroke(); }
      g.fillStyle = STONE.high; g.beginPath(); g.ellipse(cx, Y(0.62, 20), 27, 9, 0, 0, TAU); g.fill();
      g.fillStyle = '#20303a'; g.beginPath(); g.ellipse(cx, Y(0.62, 20), 20, 6, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(120,170,200,0.5)'; g.beginPath(); g.ellipse(cx - 5, Y(0.62, 20) - 1, 8, 2, 0, 0, TAU); g.fill();
      // crank, rope, bucket
      g.fillStyle = WOOD.dark; g.fillRect(cx - 22, Y(0.5, 50), 44, 4); g.strokeStyle = IRON.mid; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + 24, Y(0.5, 48)); g.lineTo(cx + 29, Y(0.5, 48)); g.lineTo(cx + 29, Y(0.5, 42)); g.stroke();
      g.strokeStyle = '#c8b27a'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + 2, Y(0.5, 48)); g.lineTo(cx + 2, Y(0.5, 34)); g.stroke();
      g.fillStyle = lin(g, cx - 5, 0, cx + 9, 0, [[0, '#a87a48'], [1, '#5a3b22']]); g.beginPath(); g.moveTo(cx - 4, Y(0.5, 34)); g.lineTo(cx + 8, Y(0.5, 34)); g.lineTo(cx + 7, Y(0.5, 24)); g.lineTo(cx - 3, Y(0.5, 24)); g.closePath(); g.fill();
      g.strokeStyle = IRON.mid; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx - 4, Y(0.5, 31)); g.lineTo(cx + 8, Y(0.5, 31)); g.stroke();
      // little roof
      g.fillStyle = lin(g, 0, Y(0.5, 80), 0, Y(0.5, 62), [[0, '#9a6a40'], [1, '#5e3c22']]);
      g.beginPath(); g.moveTo(cx - 32, Y(0.5, 62)); g.lineTo(cx, Y(0.5, 82)); g.lineTo(cx + 32, Y(0.5, 62)); g.lineTo(cx + 28, Y(0.5, 59)); g.lineTo(cx, Y(0.5, 76)); g.lineTo(cx - 28, Y(0.5, 59)); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,22,10,0.5)'; g.lineWidth = 0.8; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(cx - 32 + k * 6, Y(0.5, 62 + k * 3.6)); g.lineTo(cx - 28 + k * 6, Y(0.5, 59 + k * 3.4)); g.moveTo(cx + 32 - k * 6, Y(0.5, 62 + k * 3.6)); g.lineTo(cx + 28 - k * 6, Y(0.5, 59 + k * 3.4)); g.stroke(); }
    }, OW);
  });
}
function signpost() {
  return mk(1, 54, (g, P, Y, W) => {
    const cx = W / 2;
    ground(g, cx, Y(0.62, 0), 8, 3);
    P.layer((g) => {
      leg(g, cx, Y(0.62, 56), Y(0.62, 0), 4.6, WOOD.mid);
      const arrow = (y, d, len, col) => {
        g.fillStyle = lin(g, 0, y, 0, y + 9, [[0, mixc(col, '#fff', 0.15)], [1, mixc(col, '#000', 0.25)]]);
        g.beginPath(); g.moveTo(cx, y); g.lineTo(cx + d * len, y); g.lineTo(cx + d * (len + 6), y + 4.5); g.lineTo(cx + d * len, y + 9); g.lineTo(cx, y + 9); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(60,36,16,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx + d * 4, y + 3.5); g.lineTo(cx + d * (len - 4), y + 3.5); g.moveTo(cx + d * 4, y + 6); g.lineTo(cx + d * (len - 8), y + 6); g.stroke();
      };
      arrow(Y(0.62, 52), 1, 18, '#b88a56'); arrow(Y(0.62, 40), -1, 16, '#a87a48');
      g.fillStyle = WOOD.high; g.beginPath(); g.moveTo(cx - 3, Y(0.62, 56)); g.lineTo(cx, Y(0.62, 60)); g.lineTo(cx + 3, Y(0.62, 56)); g.closePath(); g.fill();
    }, 2.4);
  });
}
function benchStone(east) {
  if (east) return mkv(1, 2, 22, (g, P, Y, W) => P.layer((g) => {
    for (const v of [0.35, 1.65]) { g.fillStyle = STONE.dark; g.fillRect(22, Y(v, 13), W - 44, 13); }
    stoneTop(g, 18, Y(0.1, 15), W - 18, Y(1.9, 15)); face(g, 18, W - 18, Y(1.9, 15), Y(1.9, 9), STONE.mid);
  }, OW));
  return mk(2, 22, (g, P, Y, W) => P.layer((g) => {
    for (const x of [16, W - 34]) { g.fillStyle = lin(g, x, 0, x + 18, 0, [[0, STONE.light], [1, STONE.dark]]); g.fillRect(x, Y(0.7, 13), 18, 13); }
    stoneTop(g, 6, Y(0.32, 16), W - 6, Y(0.7, 16)); face(g, 6, W - 6, Y(0.7, 16), Y(0.7, 10), STONE.mid);
    g.fillStyle = 'rgba(86,118,52,0.55)'; g.beginPath(); g.ellipse(14, Y(0.7, 10), 5, 2, 0, 0, TAU); g.fill();
  }, OW));
}
function gardenArch() {
  const rand = rng(2501);
  return mk(1, 92, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.7, 0);
    P.layer((g) => {
      for (const x of [cx - 26, cx + 26]) { leg(g, x, b - 78, b, 4.4, WOOD.mid); g.fillStyle = 'rgba(40,24,12,0.4)'; for (let y = b - 70; y < b; y += 10) g.fillRect(x - 2.2, y, 4.4, 1); }
      g.strokeStyle = '#7a5434'; g.lineWidth = 4.4; g.beginPath(); g.moveTo(cx - 26, b - 76); g.quadraticCurveTo(cx, b - 104, cx + 26, b - 76); g.stroke();
      g.strokeStyle = '#a07448'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - 26, b - 78); g.quadraticCurveTo(cx, b - 106, cx + 26, b - 78); g.stroke();
      g.strokeStyle = WOOD.mid; g.lineWidth = 1.6; for (let k = 1; k < 4; k++) { const t = k / 4, x = cx - 26 + 52 * t, y = b - 76 - Math.sin(t * Math.PI) * 14; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 6); g.stroke(); }
    }, 2.4);
    P.layer((g) => {
      const roses = ['#e0506a', '#f2a0b4', '#fff2f0', '#c8304a'];
      for (let i = 0; i < 60; i++) {
        let x, y;
        if (i < 34) { const u = rand(); x = cx - 26 + 52 * u + (rand() - 0.5) * 7; y = b - 78 - Math.sin(u * Math.PI) * 14 + (rand() - 0.5) * 7; }
        else { const side = i & 1 ? cx - 26 : cx + 26; x = side + (rand() - 0.5) * 8; y = b - 6 - rand() * 68; }
        g.fillStyle = GREENS[(rand() * 4) | 0]; g.beginPath(); g.ellipse(x, y, 3, 2.1, rand() * 3, 0, TAU); g.fill();
        if (rand() < 0.32) { g.fillStyle = roses[(rand() * 4) | 0]; g.beginPath(); circle(g, x, y, 1.9); g.fill(); }
      }
    }, 1.2);
  });
}
function statue(v) {
  return mk(1, 84, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.66, 0);
    ground(g, cx, b, 22, 7);
    P.layer((g) => {
      // pedestal
      g.fillStyle = STONE.dark; g.fillRect(cx - 17, b - 8, 34, 8); stoneTop(g, cx - 17, b - 14, cx + 17, b - 8, STONE.mid);
      g.fillStyle = lin(g, cx - 12, 0, cx + 12, 0, [[0, STONE.light], [1, STONE.dark]]); g.fillRect(cx - 12, b - 34, 24, 22);
      g.fillStyle = 'rgba(40,36,30,0.4)'; g.fillRect(cx - 9, b - 28, 18, 1); g.fillRect(cx - 9, b - 18, 18, 1);
      stoneTop(g, cx - 14, b - 38, cx + 14, b - 33, STONE.high);
      const S = (c) => lin(g, cx - 12, 0, cx + 12, 0, [[0, '#d8d2c4'], [0.5, '#b4ad9f'], [1, '#7e786c']]);
      if (v === 0) { // warrior with spear and shield
        g.fillStyle = S(); g.beginPath(); g.moveTo(cx - 6, b - 38); g.lineTo(cx - 8, b - 58); g.quadraticCurveTo(cx, b - 64, cx + 8, b - 58); g.lineTo(cx + 6, b - 38); g.closePath(); g.fill();
        g.beginPath(); g.ellipse(cx, b - 68, 5.6, 6.4, 0, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(cx - 9, b - 50, 6, 8, 0, 0, TAU); g.fill();
        g.fillStyle = '#9a9386'; g.fillRect(cx + 8, b - 84, 2.4, 48); g.beginPath(); g.moveTo(cx + 9.2, b - 92); g.lineTo(cx + 6.4, b - 84); g.lineTo(cx + 12, b - 84); g.closePath(); g.fill();
        g.fillStyle = 'rgba(86,118,52,0.6)'; g.beginPath(); g.ellipse(cx - 4, b - 40, 5, 2, 0, 0, TAU); g.fill();
      } else { // owl
        g.fillStyle = S(); g.beginPath(); g.ellipse(cx, b - 54, 12, 16, 0, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(cx, b - 72, 10, 8, 0, 0, TAU); g.fill();
        g.beginPath(); g.moveTo(cx - 9, b - 76); g.lineTo(cx - 7, b - 84); g.lineTo(cx - 3, b - 78); g.closePath(); g.fill(); g.beginPath(); g.moveTo(cx + 9, b - 76); g.lineTo(cx + 7, b - 84); g.lineTo(cx + 3, b - 78); g.closePath(); g.fill();
        g.fillStyle = '#e8e2d4'; g.beginPath(); circle(g, cx - 4, b - 72, 3.4); g.fill(); g.beginPath(); circle(g, cx + 4, b - 72, 3.4); g.fill();
        g.fillStyle = '#5a554c'; g.beginPath(); circle(g, cx - 4, b - 72, 1.4); g.fill(); g.beginPath(); circle(g, cx + 4, b - 72, 1.4); g.fill();
        g.strokeStyle = 'rgba(60,56,48,0.5)'; g.lineWidth = 0.9; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx, b - 58 + k * 5, 6, 0.3, Math.PI - 0.3); g.stroke(); }
      }
    }, OW);
  });
}
function totem() {
  return mk(1, 90, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.62, 0);
    ground(g, cx, b, 12, 4);
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 10, 0, cx + 10, 0, [[0, '#a87a48'], [0.5, '#8a6038'], [1, '#5a3b22']]); g.fillRect(cx - 10, b - 84, 20, 84);
      const faceAt = (y, col) => {
        g.fillStyle = col; g.fillRect(cx - 10, y - 2, 20, 3);
        g.fillStyle = '#f2ead6'; g.beginPath(); g.ellipse(cx - 4.5, y + 6, 3, 2.4, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(cx + 4.5, y + 6, 3, 2.4, 0, 0, TAU); g.fill();
        g.fillStyle = '#1a120c'; g.beginPath(); circle(g, cx - 4.5, y + 6, 1.3); g.fill(); g.beginPath(); circle(g, cx + 4.5, y + 6, 1.3); g.fill();
        g.fillStyle = col; g.beginPath(); g.moveTo(cx - 2, y + 9); g.lineTo(cx + 2, y + 9); g.lineTo(cx, y + 14); g.closePath(); g.fill();
        g.fillStyle = '#3a2014'; g.fillRect(cx - 6, y + 16, 12, 3);
      };
      faceAt(b - 80, '#c0392b'); faceAt(b - 54, '#2f5a86'); faceAt(b - 28, '#3f6a34');
      for (const d of [-1, 1]) { g.fillStyle = lin(g, 0, b - 66, 0, b - 56, [[0, '#e6c56a'], [1, '#a07a2a']]); g.beginPath(); g.moveTo(cx + d * 10, b - 64); g.lineTo(cx + d * 24, b - 70); g.lineTo(cx + d * 22, b - 62); g.lineTo(cx + d * 10, b - 58); g.closePath(); g.fill(); }
      g.fillStyle = '#e6c56a'; g.beginPath(); g.moveTo(cx - 10, b - 84); g.lineTo(cx, b - 92); g.lineTo(cx + 10, b - 84); g.closePath(); g.fill();
    }, OW);
  });
}
function woodpile(east) {
  const ends = (g, x0, x1, top, bot) => {
    for (let y = bot - 5; y > top; y -= 8.4) for (let x = x0 + 4 + ((((bot - y) / 8.4) | 0) & 1 ? 4.5 : 0); x < x1 - 3; x += 9) {
      g.fillStyle = '#6a4428'; g.beginPath(); g.ellipse(x, y, 4.4, 4, 0, 0, TAU); g.fill();
      g.fillStyle = '#d6b07a'; g.beginPath(); g.ellipse(x, y, 3.2, 2.9, 0, 0, TAU); g.fill();
      g.strokeStyle = '#a57a48'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(x, y, 1.6, 1.4, 0, 0, TAU); g.stroke();
    }
  };
  if (east) return mkv(1, 2, 32, (g, P, Y, W) => P.layer((g) => {
    plankTop(g, 16, Y(0.15, 28), W - 16, Y(1.85, 28), '#8a6038', 'y', 3);
    g.fillStyle = '#5a3b22'; g.fillRect(16, Y(1.85, 28), W - 32, 28);
    ends(g, 16, W - 16, Y(1.85, 28), Y(1.85, 0));
  }, OW));
  return mk(2, 40, (g, P, Y, W) => P.layer((g) => {
    for (const x of [8, W - 8]) leg(g, x, Y(0.75, 34), Y(0.75, 0), 4.4, WOOD.dark);
    g.fillStyle = '#4a2f1a'; g.fillRect(10, Y(0.75, 30), W - 20, 30);
    ends(g, 10, W - 10, Y(0.75, 30), Y(0.75, 0));
    plankTop(g, 9, Y(0.45, 31), W - 9, Y(0.75, 31), '#8a6038', 'x', 3);
    // chopping stump with an axe
    g.fillStyle = '#6a4428'; g.fillRect(W - 30, Y(0.9, 10), 14, 10); g.fillStyle = '#d6b07a'; g.beginPath(); g.ellipse(W - 23, Y(0.9, 10), 7, 2.6, 0, 0, TAU); g.fill();
    g.fillStyle = '#8a5a30'; g.save(); g.translate(W - 22, Y(0.9, 11)); g.rotate(-0.5); g.fillRect(-1.2, -18, 2.4, 18); g.fillStyle = IRON.light; g.fillRect(-1.5, -3, 8, 5); g.restore();
  }, OW));
}
function haystack() {
  const rand = rng(2601);
  return mk(1, 46, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.66, 0);
    ground(g, cx, b, 28, 7);
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 26, 0, cx + 26, 0, [[0, '#ecd58e'], [0.45, '#d4b462'], [1, '#9a7a3a']]);
      g.beginPath(); g.moveTo(cx - 27, b); g.quadraticCurveTo(cx - 28, b - 30, cx, b - 42); g.quadraticCurveTo(cx + 28, b - 30, cx + 27, b); g.quadraticCurveTo(cx, b + 4, cx - 27, b); g.fill();
      g.strokeStyle = 'rgba(150,118,50,0.7)'; g.lineWidth = 0.8;
      for (let i = 0; i < 40; i++) { const x = cx - 22 + rand() * 44, y = b - 2 - rand() * 34; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 6, y - 3 - rand() * 3); g.stroke(); }
      g.strokeStyle = 'rgba(255,244,200,0.6)'; for (let i = 0; i < 14; i++) { const x = cx - 16 + rand() * 20, y = b - 18 - rand() * 18; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y - 2); g.stroke(); }
      g.strokeStyle = '#8a5a30'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 12, b - 46); g.lineTo(cx + 22, b - 4); g.stroke(); // pitchfork
      g.strokeStyle = IRON.light; g.lineWidth = 1.1; g.beginPath(); for (const dx of [-2.4, 0, 2.4]) { g.moveTo(cx + 12 + dx, b - 46); g.lineTo(cx + 11 + dx, b - 54); } g.moveTo(cx + 9.6, b - 46); g.lineTo(cx + 14.4, b - 46); g.stroke();
    }, OW);
  });
}
function cart(east) {
  const wheel = (g, x, y, r) => {
    g.fillStyle = '#4a2f1a'; g.beginPath(); g.ellipse(x, y, r, r, 0, 0, TAU); g.fill();
    g.fillStyle = '#8a6038'; g.beginPath(); g.ellipse(x, y, r - 2.5, r - 2.5, 0, 0, TAU); g.fill();
    g.strokeStyle = '#4a2f1a'; g.lineWidth = 1.6; for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI; g.beginPath(); g.moveTo(x - Math.cos(a) * (r - 2), y - Math.sin(a) * (r - 2)); g.lineTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)); g.stroke(); }
    g.fillStyle = IRON.mid; g.beginPath(); circle(g, x, y, 2.4); g.fill(); g.strokeStyle = IRON.mid; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y, r, r, 0, 0, TAU); g.stroke();
  };
  const loadSacks = (g, x0, x1, y) => { for (let i = 0; i < 3; i++) { const x = x0 + 8 + i * ((x1 - x0 - 16) / 2.4); g.fillStyle = lin(g, x - 8, 0, x + 8, 0, [[0, '#d8c08a'], [1, '#8a7448']]); g.beginPath(); g.ellipse(x, y - 6, 9, 7, 0, 0, TAU); g.fill(); g.fillStyle = '#9a8454'; g.beginPath(); g.ellipse(x, y - 12, 3, 1.6, 0, 0, TAU); g.fill(); } };
  if (east) return mkv(1, 2, 44, (g, P, Y, W) => P.layer((g) => {
    box(g, 14, W - 14, Y(0.25, 26), Y(1.6, 26), Y(1.6, 12), '#a87a48', WOOD.mid, 'y', 4);
    loadSacks(g, 16, W - 16, Y(1.1, 26));
    g.fillStyle = '#4a2f1a'; g.fillRect(W / 2 - 1.5, Y(1.6, 12), 3, Y(1.98, 4) - Y(1.6, 12)); // shafts
    g.fillStyle = '#4a2f1a'; g.fillRect(W - 15, Y(0.8, 22), 4, 22); g.fillRect(11, Y(0.8, 22), 4, 22);
  }, OW));
  return mk(2, 44, (g, P, Y, W) => P.layer((g) => {
    g.strokeStyle = '#5a3b22'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(W - 30, Y(0.6, 14)); g.lineTo(W - 2, Y(0.75, 4)); g.moveTo(W - 30, Y(0.4, 14)); g.lineTo(W - 2, Y(0.5, 6)); g.stroke();
    box(g, 10, W - 30, Y(0.3, 26), Y(0.7, 26), Y(0.7, 12), '#a87a48', WOOD.mid, 'x', 3);
    g.fillStyle = WOOD.dark; g.fillRect(10, Y(0.3, 34), 4, 9); g.fillRect(W - 34, Y(0.3, 34), 4, 9);
    loadSacks(g, 12, W - 32, Y(0.55, 26));
    wheel(g, 34, Y(0.72, 11), 12); wheel(g, W - 54, Y(0.72, 11), 12);
  }, OW));
}
function scarecrow() {
  return mk(1, 74, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.62, 0);
    ground(g, cx, b, 10, 3);
    P.layer((g) => {
      leg(g, cx, b - 66, b, 4, WOOD.mid);
      g.fillStyle = WOOD.mid; g.fillRect(cx - 24, b - 50, 48, 3.6);
      // shirt
      g.fillStyle = lin(g, cx - 20, 0, cx + 20, 0, [[0, '#6a8ac0'], [1, '#3a5a8a']]);
      g.beginPath(); g.moveTo(cx - 24, b - 52); g.lineTo(cx + 24, b - 52); g.lineTo(cx + 22, b - 42); g.lineTo(cx + 12, b - 44); g.lineTo(cx + 11, b - 22); g.lineTo(cx - 11, b - 22); g.lineTo(cx - 12, b - 44); g.lineTo(cx - 22, b - 42); g.closePath(); g.fill();
      g.fillStyle = '#c0392b'; g.fillRect(cx - 6, b - 40, 8, 7); // patch
      g.strokeStyle = 'rgba(30,40,70,0.5)'; g.setLineDash([1.4, 1.4]); g.lineWidth = 0.8; g.strokeRect(cx - 6, b - 40, 8, 7); g.setLineDash([]);
      g.strokeStyle = '#e0c47c'; g.lineWidth = 1; for (const d of [-1, 1]) for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(cx + d * 23, b - 46 + k * 2); g.lineTo(cx + d * 28, b - 44 + k * 3); g.stroke(); }
      for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(cx - 8 + k * 4, b - 22); g.lineTo(cx - 9 + k * 4.5, b - 15); g.stroke(); }
      // head + hat
      g.fillStyle = lin(g, cx - 7, 0, cx + 7, 0, [[0, '#e6d4a0'], [1, '#a8925a']]); g.beginPath(); g.ellipse(cx, b - 58, 7, 7.4, 0, 0, TAU); g.fill();
      g.strokeStyle = '#3a2a18'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(cx - 4, b - 59); g.lineTo(cx - 2, b - 57); g.moveTo(cx - 2, b - 59); g.lineTo(cx - 4, b - 57); g.moveTo(cx + 2, b - 59); g.lineTo(cx + 4, b - 57); g.moveTo(cx + 4, b - 59); g.lineTo(cx + 2, b - 57); g.moveTo(cx - 3, b - 54); g.quadraticCurveTo(cx, b - 52.6, cx + 3, b - 54); g.stroke();
      g.fillStyle = lin(g, 0, b - 72, 0, b - 62, [[0, '#e8cf8a'], [1, '#b0904a']]); g.beginPath(); g.ellipse(cx, b - 63, 14, 4, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(cx - 7, b - 63); g.quadraticCurveTo(cx - 6, b - 73, cx, b - 73); g.quadraticCurveTo(cx + 6, b - 73, cx + 7, b - 63); g.closePath(); g.fill();
      g.fillStyle = '#a3302a'; g.fillRect(cx - 7, b - 66, 14, 2.4);
    }, OW);
  });
}
function birdhouse() {
  return mk(1, 66, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.6, 0);
    ground(g, cx, b, 7, 2.6);
    P.layer((g) => {
      leg(g, cx, b - 52, b, 3.6, WOOD.mid);
      g.fillStyle = lin(g, cx - 9, 0, cx + 9, 0, [[0, '#d8b27a'], [1, '#9a6e44']]); g.fillRect(cx - 9, b - 66, 18, 16);
      g.fillStyle = '#1a120c'; g.beginPath(); circle(g, cx, b - 59, 3); g.fill();
      g.fillStyle = WOOD.dark; g.fillRect(cx - 0.8, b - 54, 1.6, 4);
      g.fillStyle = '#a3302a'; g.beginPath(); g.moveTo(cx - 13, b - 64); g.lineTo(cx, b - 75); g.lineTo(cx + 13, b - 64); g.lineTo(cx + 11, b - 62); g.lineTo(cx, b - 71); g.lineTo(cx - 11, b - 62); g.closePath(); g.fill();
    }, 2.4);
  });
}
function beehive() {
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.62, 0);
    ground(g, cx, b, 16, 5);
    P.layer((g) => {
      for (const d of [-1, 1]) leg(g, cx + d * 11, b - 12, b, 3.4, WOOD.mid);
      plankTop(g, cx - 15, b - 15, cx + 15, b - 10, '#a87a48', 'x', 1);
      g.fillStyle = lin(g, cx - 14, 0, cx + 14, 0, [[0, '#ecd58e'], [0.5, '#d4b462'], [1, '#9a7a3a']]);
      g.beginPath(); g.moveTo(cx - 14, b - 14); g.quadraticCurveTo(cx - 15, b - 38, cx, b - 40); g.quadraticCurveTo(cx + 15, b - 38, cx + 14, b - 14); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(140,108,46,0.85)'; g.lineWidth = 1.2; for (let k = 1; k < 6; k++) { const y = b - 14 - k * 4.4, w = 14 - Math.pow(k / 6, 2) * 12; g.beginPath(); g.moveTo(cx - w, y); g.quadraticCurveTo(cx, y + 1.6, cx + w, y); g.stroke(); }
      g.fillStyle = '#3a2814'; g.beginPath(); g.ellipse(cx, b - 16, 3.4, 2.4, 0, 0, TAU); g.fill();
    }, 2.4);
  });
}
function dryingRack(east) {
  const hide = (g, x, y, w, h, col) => { g.fillStyle = lin(g, x, 0, x + w, 0, [[0, mixc(col, '#fff', 0.15)], [1, mixc(col, '#000', 0.3)]]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w - 2, y + h * 0.6); g.quadraticCurveTo(x + w / 2, y + h, x + 2, y + h * 0.6); g.closePath(); g.fill(); };
  if (east) return mkv(1, 2, 54, (g, P, Y, W) => P.layer((g) => {
    const cx = W / 2;
    for (const v of [0.2, 1.8]) { g.strokeStyle = WOOD.mid; g.lineWidth = 3.4; g.beginPath(); g.moveTo(cx - 9, Y(v, 0)); g.lineTo(cx, Y(v, 46)); g.lineTo(cx + 9, Y(v, 0)); g.stroke(); }
    g.fillStyle = WOOD.dark; g.fillRect(cx - 2, Y(1.8, 46), 4, Y(0.2, 46) - Y(1.8, 46));
    hide(g, cx - 5, Y(0.6, 44), 10, 26, '#8a6a48'); hide(g, cx - 5, Y(1.3, 44), 10, 24, '#a07448');
  }, OW));
  return mk(2, 54, (g, P, Y, W) => P.layer((g) => {
    for (const x of [12, W - 12]) { g.strokeStyle = WOOD.mid; g.lineWidth = 3.4; g.beginPath(); g.moveTo(x - 6, Y(0.75, 0)); g.lineTo(x, Y(0.6, 48)); g.lineTo(x + 6, Y(0.45, 0)); g.stroke(); }
    g.fillStyle = WOOD.dark; g.fillRect(10, Y(0.6, 48), W - 20, 3.6);
    hide(g, 22, Y(0.6, 46), 26, 30, '#8a6a48'); hide(g, 54, Y(0.6, 46), 22, 26, '#b08460');
    const greens = ['#5f8a3a', '#7a9a48'];
    for (let i = 0; i < 3; i++) { const x = 86 + i * 9; g.fillStyle = greens[i % 2]; g.beginPath(); g.moveTo(x - 1.5, Y(0.6, 45)); g.lineTo(x - 4.5, Y(0.6, 28)); g.quadraticCurveTo(x, Y(0.6, 24), x + 4.5, Y(0.6, 28)); g.lineTo(x + 1.5, Y(0.6, 45)); g.closePath(); g.fill(); }
  }, OW));
}
function noticeBoard() {
  const rand = rng(2701);
  return mk(1, 62, (g, P, Y, W) => {
    const cx = W / 2, b = Y(0.62, 0);
    ground(g, cx, b, 18, 4);
    P.layer((g) => {
      for (const d of [-1, 1]) leg(g, cx + d * 20, b - 54, b, 4.4, WOOD.mid);
      g.fillStyle = lin(g, 0, b - 46, 0, b - 18, [[0, '#9a6a40'], [1, '#6a4428']]); g.fillRect(cx - 22, b - 46, 44, 28);
      g.fillStyle = 'rgba(30,18,8,0.45)'; g.fillRect(cx - 22, b - 46, 44, 1.4);
      for (let i = 0; i < 5; i++) { const x = cx - 18 + rand() * 30, y = b - 43 + rand() * 16, w = 7 + rand() * 4, h = 8 + rand() * 3; g.fillStyle = ['#efe6cf', '#e6d8b0', '#f4ecd8'][i % 3]; g.save(); g.translate(x + w / 2, y + h / 2); g.rotate((rand() - 0.5) * 0.3); g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = 'rgba(80,60,40,0.55)'; g.lineWidth = 0.6; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-w / 2 + 1.4, -h / 2 + 2.4 + k * 2.2); g.lineTo(w / 2 - 1.4, -h / 2 + 2.4 + k * 2.2); g.stroke(); } g.fillStyle = '#c0392b'; g.beginPath(); circle(g, 0, -h / 2 + 0.8, 0.9); g.fill(); g.restore(); }
      g.fillStyle = lin(g, 0, b - 60, 0, b - 48, [[0, '#a3302a'], [1, '#6e1e18']]); g.beginPath(); g.moveTo(cx - 28, b - 47); g.lineTo(cx, b - 60); g.lineTo(cx + 28, b - 47); g.lineTo(cx + 24, b - 45); g.lineTo(cx, b - 56); g.lineTo(cx - 24, b - 45); g.closePath(); g.fill();
    }, OW);
  });
}
function fountain() {
  return mkv(2, 2, 52, (g, P, Y, W) => {
    const cx = W / 2, cyb = Y(1.2, 0);
    ground(g, cx, Y(1.9, 0), 62, 12);
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 56, 0, cx + 56, 0, [[0, STONE.light], [0.5, STONE.mid], [1, STONE.dark]]);
      g.beginPath(); g.ellipse(cx, cyb + 16, 56, 36, 0, 0, Math.PI); g.lineTo(cx - 56, cyb + 2); g.ellipse(cx, cyb + 2, 56, 36, 0, Math.PI, 0, true); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,36,30,0.45)'; g.lineWidth = 0.9; for (let k = -4; k <= 4; k++) { const a = Math.PI / 2 + (k / 5) * (Math.PI / 2); g.beginPath(); g.moveTo(cx + Math.cos(a) * 56, cyb + 2 + Math.sin(a) * 36); g.lineTo(cx + Math.cos(a) * 56, cyb + 16 + Math.sin(a) * 36); g.stroke(); }
      g.fillStyle = STONE.high; g.beginPath(); g.ellipse(cx, cyb + 2, 56, 36, 0, 0, TAU); g.fill();
      g.fillStyle = lin(g, 0, cyb - 32, 0, cyb + 32, [[0, '#7ab4d4'], [1, '#3a6a8a']]); g.beginPath(); g.ellipse(cx, cyb + 3, 49, 30, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(cx - 18, cyb - 8, 18, 6, -0.2, 0, TAU); g.fill();
      // pedestal + bowl
      g.fillStyle = lin(g, cx - 7, 0, cx + 7, 0, [[0, STONE.light], [1, STONE.dark]]); g.fillRect(cx - 6, cyb - 30, 12, 34);
      g.fillStyle = lin(g, cx - 20, 0, cx + 20, 0, [[0, STONE.high], [1, STONE.mid]]); g.beginPath(); g.ellipse(cx, cyb - 30, 20, 7, 0, 0, Math.PI); g.lineTo(cx - 20, cyb - 34); g.ellipse(cx, cyb - 34, 20, 7, 0, Math.PI, 0, true); g.closePath(); g.fill();
      g.fillStyle = '#5a92b4'; g.beginPath(); g.ellipse(cx, cyb - 34, 16, 5, 0, 0, TAU); g.fill();
      g.fillStyle = STONE.light; g.fillRect(cx - 2.4, cyb - 46, 4.8, 12); g.beginPath(); circle(g, cx, cyb - 47, 3.4); g.fill();
    }, OW);
  });
}

function pergola() {
  const rand = rng(2801);
  return mkv(2, 2, 70, (g, P, Y, W) => {
    const posts = [[10, 0.18], [W - 10, 0.18], [10, 1.86], [W - 10, 1.86]];
    P.layer((g) => {
      for (const [x, v] of posts) leg(g, x, Y(v, 72), Y(v, 0), 5.5, WOOD.mid);
      // beams (E-W) and rafters (N-S) seen from above at the top
      for (const v of [0.18, 1.86]) { g.fillStyle = lin(g, 0, Y(v, 76), 0, Y(v, 70), [[0, WOOD.high], [1, WOOD.dark]]); g.fillRect(2, Y(v, 76), W - 4, 6); }
      for (let k = 0; k < 6; k++) { const x = 8 + k * ((W - 16) / 5); g.fillStyle = lin(g, x - 2.5, 0, x + 2.5, 0, [[0, '#b48a58'], [1, '#6e4a2c']]); g.fillRect(x - 2.5, Y(0.08, 80), 5, Y(1.96, 80) - Y(0.08, 80)); }
    }, 2.4);
    P.layer((g) => {
      const roses = ['#e0506a', '#f2a0b4', '#fff2f0', '#c58fe0'];
      for (let i = 0; i < 70; i++) {
        const x = 8 + rand() * (W - 16), v = 0.1 + rand() * 1.8;
        g.fillStyle = GREENS[(rand() * 4) | 0]; g.beginPath(); g.ellipse(x, Y(v, 80) + (rand() - 0.5) * 4, 3.4, 2.4, rand() * 3, 0, TAU); g.fill();
        if (rand() < 0.22) { g.fillStyle = roses[(rand() * 4) | 0]; g.beginPath(); circle(g, x, Y(v, 81), 1.8); g.fill(); }
      }
      for (const [x, v] of posts) for (let k = 0; k < 9; k++) { g.fillStyle = GREENS[k % 4]; g.beginPath(); g.ellipse(x + (rand() - 0.5) * 7, Y(v, 4 + rand() * 66), 2.8, 2, rand() * 3, 0, TAU); g.fill(); }
    }, 1.2);
  });
}

// ---------------- registration ----------------
// flame / glow spots (tiles relative to the anchor: [dx, lift])
export const DECOR_GEOM = {
  candles: [[-0.12, 0.2], [0.02, 0.26], [0.13, 0.18]],
  candelabra: [[-14 / 64, 50 / 64], [-7 / 64, 54 / 64], [0, 58 / 64], [7 / 64, 54 / 64], [14 / 64, 50 / 64]],
  lamp_stone: [[0, 40 / 64]],
  lamp_wood: [[7 / 64, 66 / 64]],
  fireplace: { lift: 10 / 64, w: 0.62 },
  mount: { painting: 0.06, trophy: 0.02, herbs_hang: 0.06, curtain: 0.02, pot_hooks: 0.04 },
};
export const DECOR_ROT2 = ['bookshelf', 'dresser', 'bench_wood', 'bench_stone', 'washtub', 'weapon_rack', 'woodpile', 'cart', 'drying_rack', 'planter', 'fireplace'];
export function addDecor(add) {
  const A = (n, c) => add(n, c, 0.5, 1);
  A('shelf_wood', shelfWood()); A('bookshelf', bookshelf(false)); A('bookshelf_e', bookshelf(true));
  A('wardrobe', wardrobe()); A('dresser', dresser(false)); A('dresser_e', dresser(true));
  A('bench_wood', benchWood(false)); A('bench_wood_e', benchWood(true));
  A('stool', stool());
  A('chair_fine', chairFine('s')); A('chair_fine_n', chairFine('n')); A('chair_fine_e', chairFine('e'));
  A('table_round', tableRound()); A('table_small', tableSmall()); A('barrel', barrel()); A('crates', crates()); A('sacks', sacks()); A('jars', jars());
  A('candles', candles()); A('candelabra', candelabra());
  A('herbs_hang', herbsHang()); A('curtain', curtain()); A('painting', painting()); A('trophy', trophy()); A('pot_hooks', potHooks());
  for (let v = 0; v < 3; v++) A('plant_pot_' + v, plantPot(v));
  add('rug_round', rugRound(), 0.5, 0.5); add('rug_fur', rugFur(), 0.5, 0.5);
  A('weapon_rack', weaponRack(false)); A('weapon_rack_e', weaponRack(true));
  A('armor_stand', armorStand());
  A('fireplace', fireplace(false)); A('fireplace_e', fireplace(true));
  A('washtub', washtub(false)); A('washtub_e', washtub(true));
  A('training_dummy', dummy('full')); A('training_dummy_base', dummy('base')); A('training_dummy_body', dummy('body'));
  A('lamp_stone', lampStone(false)); A('lamp_stone_glow', lampStone(true));
  A('lamp_wood', lampWood(false)); A('lamp_wood_glow', lampWood(true));
  for (let v = 0; v < 3; v++) A('flower_bed_' + v, flowerBed(v));
  A('planter', planter(false)); A('planter_e', planter(true));
  for (let v = 0; v < 3; v++) A('stepping_' + v, stepping(v));
  A('well', well()); A('signpost', signpost());
  A('bench_stone', benchStone(false)); A('bench_stone_e', benchStone(true));
  A('garden_arch', gardenArch());
  for (let v = 0; v < 2; v++) A('statue_' + v, statue(v));
  A('totem', totem());
  A('woodpile', woodpile(false)); A('woodpile_e', woodpile(true));
  A('haystack', haystack());
  A('cart', cart(false)); A('cart_e', cart(true));
  A('scarecrow', scarecrow()); A('birdhouse', birdhouse()); A('beehive', beehive());
  A('drying_rack', dryingRack(false)); A('drying_rack_e', dryingRack(true));
  A('notice_board', noticeBoard()); A('fountain', fountain()); A('pergola', pergola());
}
