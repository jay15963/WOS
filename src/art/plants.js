// Ground plants: bushes, berry bushes, grass tufts, tall grass, reeds, flowers, mushrooms.
// Grass is drawn by the thousand: soft thin dark-green outlines, muted greens, darker roots.

import { sprite, rng, TAU, lin, rgb, hex, mixc, leaf, circle } from './paint.js';
import { drawFoliage, bushLumps } from './foliage.js';

const BUSH_PALS = [
  { deep: '#22381a', dark: '#314d22', mid: '#45682c', light: '#5d8436', high: '#7a9f47' },
  { deep: '#273a17', dark: '#38521f', mid: '#4f6e29', light: '#698b33', high: '#87a646' },
  { deep: '#1f361d', dark: '#2c4a27', mid: '#3e6332', light: '#557f3d', high: '#729c50' },
  { deep: '#2c3b19', dark: '#3f5322', mid: '#566d2c', light: '#708937', high: '#8fa64a' },
];
const BERRY_PAL = { deep: '#1e3419', dark: '#2b4723', mid: '#3c602d', light: '#517b38', high: '#6c964a' };
const GRASS_OUT = 'rgba(28,34,14,0.58)';

// ---------------- bushes ----------------
function bush(v, berries, empty) {
  const rand = rng(berries ? 7700 + v * 13 : 7000 + v * 29);
  const dims = [[1.2, 0.95, 64, 44], [1.3, 0.95, 70, 42], [1.1, 1.0, 58, 48], [1.25, 0.9, 66, 40]][v % 4];
  const pal = berries ? BERRY_PAL : BUSH_PALS[v % BUSH_PALS.length];
  return sprite(dims[0], dims[1], (g, P) => {
    const cx = P.W / 2, baseY = P.H - 6;
    const w = dims[2], h = dims[3];
    const lumps = bushLumps(cx, baseY, w, h, rand);
    const brand = rng(99 + v); // berries independent of lumps → same bush with/without berries
    P.layer((g) => {
      drawFoliage(g, lumps, pal, rand, { cx, cy: baseY - h * 0.5, R: w * 0.5, RY: h * 0.5, marks: 1.2, drop: 0.5, sprigs: 0.9 });
      if (berries && !empty) {
        for (let k = 0; k < 7; k++) {
          const bx = cx + (brand() - 0.5) * w * 0.78, by = baseY - h * (0.2 + brand() * 0.6);
          const n = 2 + Math.floor(brand() * 3);
          for (let j = 0; j < n; j++) {
            const x = bx + (brand() - 0.5) * 7, y = by + (brand() - 0.5) * 5;
            g.beginPath(); circle(g, x, y, 3.2); g.fillStyle = '#3a0d12'; g.fill();
            g.beginPath(); circle(g, x - 0.3, y - 0.3, 2.5); g.fillStyle = '#b8233a'; g.fill();
            g.beginPath(); circle(g, x - 0.9, y - 1.0, 1.3); g.fillStyle = '#e2566a'; g.fill();
            g.beginPath(); circle(g, x - 1.1, y - 1.3, 0.6); g.fillStyle = '#ffd6dc'; g.fill();
          }
        }
      } else if (berries && empty) {
        // a few stalks/tiny unripe berries so the empty bush still reads as a berry bush
        for (let k = 0; k < 7; k++) {
          const bx = cx + (brand() - 0.5) * w * 0.78, by = baseY - h * (0.2 + brand() * 0.6);
          const n = 2 + Math.floor(brand() * 3);
          for (let j = 0; j < n; j++) {
            const x = bx + (brand() - 0.5) * 7, y = by + (brand() - 0.5) * 5;
            if (j === 0) { g.beginPath(); circle(g, x, y, 1.4); g.fillStyle = '#7c8a3a'; g.fill(); }
          }
        }
      }
    });
  });
}

// ---------------- grass ----------------
// blade: base (x, y), height h, lean dx, width w, color fn
function blade(g, x, y, h, dx, w, col, dark, tipCol) {
  const x1 = x + dx, y1 = y - h;
  g.fillStyle = lin(g, 0, y, 0, y1, [[0, dark], [0.35, col], [1, tipCol || col]]);
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.quadraticCurveTo(x - w * 0.4 + dx * 0.25, y - h * 0.55, x1, y1);
  g.quadraticCurveTo(x + w * 0.45 + dx * 0.35, y - h * 0.5, x + w / 2, y);
  g.closePath();
  g.fill();
}

const GREENS = [
  ['#5d7833', '#77923f', '#33441c'],
  ['#66803a', '#809a46', '#384a1f'],
  ['#58742f', '#6f8c3c', '#2f401a'],
  ['#6c8238', '#879c48', '#3d4a1f'],
  ['#62792f', '#7c8f3e', '#36421b'],
  ['#5a7a37', '#729247', '#31451e'],
];
const TIP = '#a8b466';

function grassTuft(v) {
  const rand = rng(9000 + v * 17);
  const kinds = ['fan', 'patch', 'wide', 'broad', 'clover', 'dry', 'seed', 'mixed'];
  const kind = kinds[v % kinds.length];
  return sprite(0.95, 0.7, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    const [c0, c1, cd] = GREENS[(v * 5 + 1) % GREENS.length];
    P.layer((g) => {
      if (kind === 'broad') {
        // plantain-like rosette of broad leaves among a few blades
        for (let i = 0; i < 7; i++) {
          const u = (i / 6 - 0.5) * 2;
          blade(g, cx + u * 9, y, 9 + rand() * 7, u * 9, 2.6, mixc(c0, c1, rand()), cd, mixc(c1, TIP, 0.3));
        }
        const n = 6;
        for (let i = 0; i < n; i++) {
          const a = Math.PI * (1.05 + (i / (n - 1)) * 0.9) + (rand() - 0.5) * 0.2;
          const L = 10 + rand() * 5;
          const x1 = cx + Math.cos(a) * L * 1.15, y1 = y - 3 + Math.sin(a) * L * 0.72;
          g.fillStyle = mixc(c0, c1, 0.2 + rand() * 0.7);
          g.beginPath(); leaf(g, cx + Math.cos(a) * 2, y - 2, x1, y1, 4.4, (rand() - 0.5) * 2); g.fill();
          g.strokeStyle = rgb(hex(cd), 0.6); g.lineWidth = 0.8;
          g.beginPath(); g.moveTo(cx, y - 2); g.lineTo(x1 * 0.85 + cx * 0.15, y1 * 0.85 + (y - 2) * 0.15); g.stroke();
        }
        g.fillStyle = cd; g.beginPath(); g.ellipse(cx, y - 1.5, 4, 1.8, 0, 0, TAU); g.fill();
      } else if (kind === 'clover') {
        for (let i = 0; i < 5; i++) {
          const u = (i / 4 - 0.5) * 2;
          blade(g, cx + u * 10, y, 7 + rand() * 6, u * 8, 2.4, mixc(c0, c1, rand()), cd, mixc(c1, TIP, 0.25));
        }
        for (let i = 0; i < 9; i++) {
          const x = cx + (rand() - 0.5) * 24, yy = y - 2 - rand() * 9;
          g.strokeStyle = cd; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 2, yy); g.stroke();
          const col = mixc(c0, c1, 0.3 + rand() * 0.7);
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * TAU - Math.PI / 2 + rand() * 0.3;
            g.fillStyle = col;
            g.beginPath(); g.ellipse(x + Math.cos(a) * 2.3, yy + Math.sin(a) * 1.7, 2.3, 1.8, a, 0, TAU); g.fill();
          }
          g.fillStyle = rgb(hex(cd), 0.55); g.beginPath(); g.arc(x, yy, 0.8, 0, TAU); g.fill();
        }
      } else {
        const groups = kind === 'mixed' ? [[-9, 0.75], [8, 0.88]] : kind === 'patch' ? [[-12, 0.7], [1, 0.92], [12, 0.72]] : kind === 'dry' ? [[-7, 0.85], [8, 0.78]] : [[0, 1]];
        const P2 = {
          fan: { n: 17, h: [16, 30], w: [2.5, 3.4], spread: 18, lean: 1.0 },
          patch: { n: 12, h: [12, 23], w: [2.4, 3.2], spread: 12, lean: 0.9 },
          wide: { n: 17, h: [9, 18], w: [2.5, 3.3], spread: 23, lean: 1.5 },
          dry: { n: 12, h: [14, 25], w: [2.2, 3.0], spread: 14, lean: 1.1 },
          seed: { n: 15, h: [15, 26], w: [2.4, 3.2], spread: 16, lean: 0.95 },
          mixed: { n: 12, h: [12, 22], w: [2.4, 3.2], spread: 12, lean: 1.0 },
        }[kind];
        const pal = kind === 'dry' ? ['#8c8a48', '#a6a05c', '#4d4a26'] : [c0, c1, cd];
        const blades = [];
        for (const [gx, gk] of groups) {
          for (let i = 0; i < P2.n; i++) {
            const u = (i / (P2.n - 1) - 0.5) * 2 + (rand() - 0.5) * 0.3;
            const h = (P2.h[0] + rand() * (P2.h[1] - P2.h[0])) * gk;
            blades.push({ x: cx + gx + u * P2.spread * 0.42 * gk, h: h * (1 - Math.abs(u) * 0.32), dx: u * P2.spread * 0.55 * P2.lean * gk + (rand() - 0.5) * 4, w: P2.w[0] + rand() * (P2.w[1] - P2.w[0]), t: rand() });
          }
        }
        blades.sort((a, b) => b.h - a.h);
        for (const B of blades) {
          const col = mixc(pal[0], pal[1], B.t);
          const tip = mixc(pal[1], kind === 'dry' ? '#c4b878' : TIP, kind === 'dry' ? 0.5 : 0.25 * B.t);
          blade(g, B.x, y, B.h, B.dx, B.w, col, pal[2], tip);
        }
        if (kind === 'seed') {
          for (let i = 0; i < 3; i++) {
            const x = cx + (i - 1) * 6 + (rand() - 0.5) * 2, h = 27 + rand() * 6;
            g.strokeStyle = '#6f7339'; g.lineWidth = 1;
            g.beginPath(); g.moveTo(x, y - 4); g.quadraticCurveTo(x + (i - 1) * 2, y - h * 0.6, x + (i - 1) * 4, y - h); g.stroke();
            g.fillStyle = '#a59e64';
            for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + (i - 1) * 4 - k * 0.3 * (i - 1), y - h + k * 2.2, 1.2, 1.8, (i - 1) * 0.3, 0, TAU); g.fill(); }
          }
        }
      }
    }, 1.2, GRASS_OUT);
  });
}

function tallGrass(v) {
  const rand = rng(9500 + v * 23);
  return sprite(1.0, 1.0, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    const pal = [GREENS[(v + 1) % 6], GREENS[(v + 3) % 6]];
    P.layer((g) => {
      const blades = [];
      const n = 24 + v * 2;
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1) - 0.5) * 2 + (rand() - 0.5) * 0.25;
        blades.push({ x: cx + u * 15, h: (24 + rand() * 28) * (1 - Math.abs(u) * 0.38), dx: u * 17 + (rand() - 0.5) * 9, w: 2.6 + rand() * 1.4, t: rand(), p: rand() < 0.5 ? 0 : 1 });
      }
      blades.sort((a, b) => b.h - a.h);
      for (const B of blades) {
        const P0 = pal[B.p];
        blade(g, B.x, y, B.h, B.dx, B.w, mixc(P0[0], P0[1], B.t), P0[2], mixc(P0[1], TIP, 0.3));
      }
      // a few seed heads
      const heads = v === 1 ? 0 : v === 3 ? 4 : 2;
      for (let i = 0; i < heads; i++) {
        const x = cx + (rand() - 0.5) * 20, h = 40 + rand() * 14, lean = (rand() - 0.5) * 12;
        g.strokeStyle = '#7d7a44'; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(x, y - 6); g.quadraticCurveTo(x + lean * 0.3, y - h * 0.6, x + lean, y - h); g.stroke();
        g.fillStyle = v === 3 ? '#9a8a68' : '#aca46c';
        for (let k = 0; k < 5; k++) {
          const t = k / 5;
          g.beginPath(); g.ellipse(x + lean * (1 - t * 0.12) + (k % 2 ? 1.3 : -1.3), y - h + k * 2.4, 1.2, 2.1, (k % 2 ? 0.5 : -0.5), 0, TAU); g.fill();
        }
      }
    }, 1.3, GRASS_OUT);
  });
}

function reed(v) {
  const rand = rng(9800 + v * 41);
  return sprite(0.7, 1.15, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      const n = 11 + v * 2;
      const bl = [];
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1) - 0.5) * 2 + (rand() - 0.5) * 0.3;
        bl.push({ x: cx + u * 10, h: 34 + rand() * 30, dx: u * 7 + (rand() - 0.5) * 6, w: 2.4 + rand() * 1.2, t: rand() });
      }
      bl.sort((a, b) => b.h - a.h);
      for (const B of bl) blade(g, B.x, y, B.h, B.dx, B.w, mixc('#6e7e3c', '#8f9a4c', B.t), '#3c4422', mixc('#93984e', '#b8b070', B.t * 0.5));
      // cattails
      const cats = 1 + (v % 3);
      for (let i = 0; i < cats; i++) {
        const x = cx + (i - (cats - 1) / 2) * 8 + (rand() - 0.5) * 3;
        const h = 50 + rand() * 12, lean = (rand() - 0.5) * 6;
        const tx = x + lean, ty = y - h;
        g.strokeStyle = '#5f6a34'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x, y - 6); g.quadraticCurveTo(x + lean * 0.4, y - h * 0.5, tx, ty - 6); g.stroke();
        g.fillStyle = lin(g, tx - 3, 0, tx + 3, 0, [[0, '#8a6038'], [0.5, '#6a4426'], [1, '#4a2e1a']]);
        g.beginPath(); g.ellipse(tx, ty + 4, 3.2, 7, lean * 0.02, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,220,170,0.35)'; g.beginPath(); g.ellipse(tx - 1.2, ty + 2, 0.9, 3.5, 0, 0, TAU); g.fill();
      }
    }, 1.3, GRASS_OUT);
  });
}

// ---------------- flowers ----------------
function flower(v) {
  const rand = rng(10100 + v * 53);
  return sprite(0.55, 0.6, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      // leaves
      for (let i = 0; i < 5; i++) {
        const u = (i / 4 - 0.5) * 2;
        blade(g, cx + u * 4, y, 7 + rand() * 6, u * 7, 3, mixc('#5f7d37', '#7b9746', rand()), '#36481f', '#86a050');
      }
      const heads = [];
      const n = v === 1 ? 3 : v === 2 ? 3 : v === 5 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * 7 + (rand() - 0.5) * 3, h = 13 + rand() * 9;
        const lean = (x - cx) * 0.4;
        g.strokeStyle = '#4f6a2c'; g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(x, y - 2); g.quadraticCurveTo(x, y - h * 0.5, x + lean, y - h); g.stroke();
        heads.push([x + lean, y - h]);
      }
      for (const [x, yy] of heads) {
        if (v === 0) { // dandelion
          g.fillStyle = '#c98f1a'; g.beginPath(); circle(g, x, yy, 4.6); g.fill();
          g.fillStyle = '#f2c531';
          for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; g.beginPath(); g.ellipse(x + Math.cos(a) * 2.6, yy + Math.sin(a) * 2.2, 2, 1.1, a, 0, TAU); g.fill(); }
          g.fillStyle = '#ffe27a'; g.beginPath(); circle(g, x - 0.8, yy - 0.8, 1.8); g.fill();
        } else if (v === 1) { // daisy
          g.fillStyle = '#f4f1e6';
          for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; g.beginPath(); g.ellipse(x + Math.cos(a) * 3, yy + Math.sin(a) * 2.4, 2.4, 1.1, a, 0, TAU); g.fill(); }
          g.fillStyle = '#d9a21c'; g.beginPath(); circle(g, x, yy, 1.8); g.fill();
        } else if (v === 2) { // purple spikes (lupine-like)
          for (let k = 0; k < 6; k++) {
            const t = k / 6;
            g.fillStyle = mixc('#6d3f8c', '#b07ad0', 1 - t * 0.6);
            g.beginPath(); g.ellipse(x + (k % 2 ? 1.4 : -1.4), yy + 6 - k * 2.6, 2.4 - t * 0.9, 1.7, 0, 0, TAU); g.fill();
          }
        } else if (v === 3) { // red poppy
          g.fillStyle = '#9a1e1c'; g.beginPath(); circle(g, x, yy, 4.8); g.fill();
          g.fillStyle = '#d6372c'; g.beginPath(); circle(g, x - 0.6, yy - 0.7, 3.8); g.fill();
          g.fillStyle = '#ef6a4a'; g.beginPath(); g.ellipse(x - 1.6, yy - 1.8, 1.8, 1.1, -0.5, 0, TAU); g.fill();
          g.fillStyle = '#2a1712'; g.beginPath(); circle(g, x + 0.3, yy + 0.3, 1.4); g.fill();
        } else if (v === 4) { // blue cornflower
          g.fillStyle = '#2f4f9a';
          for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.ellipse(x + Math.cos(a) * 2.7, yy + Math.sin(a) * 2.2, 2.2, 1.2, a, 0, TAU); g.fill(); }
          g.fillStyle = '#5f86d6'; for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + 0.3; g.beginPath(); g.ellipse(x + Math.cos(a) * 1.6 - 0.5, yy + Math.sin(a) * 1.3 - 0.5, 1.4, 0.8, a, 0, TAU); g.fill(); }
          g.fillStyle = '#1e2c5a'; g.beginPath(); circle(g, x, yy, 1); g.fill();
        } else { // pink clover heads
          g.fillStyle = '#a24a78'; g.beginPath(); circle(g, x, yy, 3.3); g.fill();
          g.fillStyle = '#d97fae';
          for (let k = 0; k < 7; k++) { const a = rand() * TAU, r = rand() * 2; g.beginPath(); circle(g, x - 0.6 + Math.cos(a) * r, yy - 0.6 + Math.sin(a) * r, 1.2); g.fill(); }
        }
      }
    }, 1.2, 'rgba(30,26,18,0.7)');
  });
}

// ---------------- mushrooms ----------------
function mushroom(v) {
  const rand = rng(10600 + v * 7);
  return sprite(0.5, 0.45, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    const caps = v === 0 ? [[-5, 0, 6.5, 9], [5, 1, 5, 6.5], [0, 2, 3.5, 4]] : v === 1 ? [[-3, 0, 7.5, 11], [6, 1, 4.5, 6]] : [[-6, 1, 4, 5], [0, 0, 5, 7], [6, 2, 3.5, 4.5], [3, 3, 2.5, 3]];
    const capCol = [['#7a5434', '#a57a4d', '#c9a173'], ['#8f1f1a', '#c93a2c', '#e8664f'], ['#a8987a', '#cdbf9f', '#e9dfc5']][v];
    P.layer((g) => {
      caps.sort((a, b) => a[1] - b[1]);
      for (const [dx, dy, r, h] of caps) {
        const x = cx + dx, base = y - dy * 0.5;
        // stem
        g.fillStyle = lin(g, x - r * 0.3, 0, x + r * 0.3, 0, [[0, '#f2ead8'], [1, '#c2b59a']]);
        g.beginPath(); g.moveTo(x - r * 0.28, base); g.lineTo(x - r * 0.22, base - h); g.lineTo(x + r * 0.22, base - h); g.lineTo(x + r * 0.3, base); g.closePath(); g.fill();
        // cap
        const top = base - h - r * 0.55;
        g.beginPath();
        g.moveTo(x - r, base - h + 1);
        g.quadraticCurveTo(x - r * 0.95, top - r * 0.2, x, top - r * 0.1);
        g.quadraticCurveTo(x + r * 0.95, top - r * 0.2, x + r, base - h + 1);
        g.quadraticCurveTo(x, base - h + 2.8, x - r, base - h + 1);
        g.closePath();
        g.fillStyle = lin(g, x - r, top, x + r, base - h, [[0, capCol[2]], [0.45, capCol[1]], [1, capCol[0]]]); g.fill();
        if (v === 1) {
          g.fillStyle = '#f6efe0';
          for (let k = 0; k < 5; k++) { g.beginPath(); circle(g, x + (rand() - 0.5) * r * 1.3, top + r * 0.2 + rand() * r * 0.5, 0.8 + rand() * 0.8); g.fill(); }
        }
        g.fillStyle = 'rgba(255,255,240,0.45)'; g.beginPath(); g.ellipse(x - r * 0.4, top + r * 0.12, r * 0.3, r * 0.14, -0.4, 0, TAU); g.fill();
      }
    }, 1.6);
  });
}

export function addPlants(add) {
  const put = (name, c, foot) => add(name, c, 0.5, 1 - foot / (c.origH || c.height));
  for (let i = 0; i < 4; i++) put('bush_' + i, bush(i, false, false), 6);
  for (let i = 0; i < 2; i++) {
    put('berrybush_' + i, bush(i, true, false), 6);
    put('berrybush_empty_' + i, bush(i, true, true), 6);
  }
  for (let i = 0; i < 8; i++) put('grass_' + i, grassTuft(i), 4);
  for (let i = 0; i < 4; i++) put('tallgrass_' + i, tallGrass(i), 4);
  for (let i = 0; i < 3; i++) put('reed_' + i, reed(i), 4);
  for (let i = 0; i < 6; i++) put('flower_' + i, flower(i), 4);
  for (let i = 0; i < 3; i++) put('mushroom_' + i, mushroom(i), 4);
}

