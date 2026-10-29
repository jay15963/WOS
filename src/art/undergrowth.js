// Undergrowth & ground details (decor, never interactive). Upright plants go to B.decor (wind sway), flat
// details lie on the ground (B.ground, no sway): see composeWorld.drawDecor FLAT_DECOR.
// Upright: fern_0..3, bloom_0..5 (flower clusters, one palette per biome), heather_0..1, drygrass_0..2,
//          thistle_0..1, mushroom_3..4 (extra kinds), bushes bush_rose_0..1 / bush_juniper_0..1, mossy boulders
//          boulder_moss_0..2.
// Flat:    litter_0..4 (fallen leaves: oak, oak, maple, maple, birch), needles_0..1, twigs_0..1, petals_0..1,
//          moss_0..2, lily_0..3 (lily pads, some flowering), riverstone_0..2, scree_0..1, shell_0..1, driftwood_0.

import { sprite, rng, TAU, lin, rad, rgb, mixc, leaf, circle, taper, smoothClosed, blobPts } from './paint.js';
import { drawFoliage, bushLumps, mkLump } from './foliage.js';

const OUTL = 'rgba(28,34,14,0.58)';

// grass-like blade (base x,y; height h; lean dx; width w)
function blade(g, x, y, h, dx, w, col, dark, tip) {
  const x1 = x + dx, y1 = y - h;
  g.fillStyle = lin(g, 0, y, 0, y1, [[0, dark], [0.35, col], [1, tip || col]]);
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.quadraticCurveTo(x - w * 0.4 + dx * 0.25, y - h * 0.55, x1, y1);
  g.quadraticCurveTo(x + w * 0.45 + dx * 0.35, y - h * 0.5, x + w / 2, y);
  g.closePath(); g.fill();
}

// ---------------- ferns ----------------
const FERN_PALS = [['#3f6a2a', '#6a9a3e', '#2a4a1c'], ['#466e2c', '#79a447', '#2e4c1e'], ['#3a6230', '#5f9048', '#24401e'], ['#5a6a2a', '#8a9a44', '#3a4620']];
function frond(g, x0, y0, x1, y1, w, pal, rand, curl = 0.18) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const mx = (x0 + x1) / 2 + nx * L * curl, my = (y0 + y1) / 2 + ny * L * curl;
  const P = (t) => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1];
  g.strokeStyle = pal[2]; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
  const n = Math.max(5, Math.round(L / 2.6));
  for (let k = 1; k < n; k++) {
    const t = k / n, [px, py] = P(t), [qx, qy] = P(Math.min(1, t + 0.02));
    const tx = qx - px, ty = qy - py, tl = Math.hypot(tx, ty) || 1;
    const ln = w * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (0.75 + rand() * 0.25);
    for (const s of [-1, 1]) {
      const ex = px + (-ty / tl * s * 0.85 + tx / tl * 0.5) * ln, ey = py + (tx / tl * s * 0.85 + ty / tl * 0.5) * ln;
      g.fillStyle = mixc(pal[0], pal[1], s < 0 ? 0.75 - t * 0.2 : 0.3 + t * 0.2);
      g.beginPath(); leaf(g, px, py, ex, ey, Math.max(0.8, ln * 0.28), 0); g.fill();
    }
  }
}
function fern(v) {
  const rand = rng(14100 + v * 31);
  const pal = FERN_PALS[v % FERN_PALS.length];
  return sprite(1.0, 0.85, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      const n = 6 + (v % 2) * 2;
      const fr = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (1.08 + (i / (n - 1)) * 0.84) + (rand() - 0.5) * 0.15;
        const L = (v === 3 ? 18 : 22) + rand() * 10 - Math.abs(Math.cos(a)) * 4;
        fr.push({ a, L, back: Math.abs(Math.cos(a)) < 0.45 });
      }
      fr.sort((p, q) => (q.back ? 1 : 0) - (p.back ? 1 : 0));
      for (const f of fr) frond(g, cx, y - 2, cx + Math.cos(f.a) * f.L * 1.2, y - 2 + Math.sin(f.a) * f.L * 0.95, 5 + rand() * 1.5, pal, rand, Math.cos(f.a) > 0 ? 0.2 : -0.2);
      if (v === 2) { // fiddleheads
        g.strokeStyle = pal[1]; g.lineWidth = 1.6;
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 2, y - 2); g.quadraticCurveTo(cx + s * 3, y - 14, cx + s * 6, y - 15); g.stroke(); g.beginPath(); g.arc(cx + s * 6.5, y - 13.5, 1.8, 0, TAU); g.stroke(); }
      }
    }, 1.2, OUTL);
  });
}

// ---------------- flower clusters (biome palettes) ----------------
// 0 meadow warm (buttercup / daisy / orange hawkweed) · 1 meadow cool (cornflower / harebell / white)
// 2 forest & birch (bluebells + wood anemones) · 3 marsh (yellow iris + marsh marigold)
// 4 shore (sea thrift pink) · 5 rocky (stonecrop yellow + mountain pinks)
const BLOOM = [
  [['#f2c531', '#c98f1a'], ['#f4f1e6', '#d9a21c'], ['#ef8a2a', '#b85a14']],
  [['#4a6ad0', '#26388a'], ['#9a7ad8', '#5a3a9a'], ['#f4f1e6', '#c9b04a']],
  [['#5a6ad8', '#2e3a8e'], ['#f6f4ee', '#d8c060'], ['#8a6ad0', '#4a3488']],
  [['#f0c42a', '#a8760e'], ['#f6d84a', '#b88a1a'], ['#e8e2d0', '#a89a5a']],
  [['#e88ab0', '#a84a72'], ['#f0a8c4', '#b86a8a'], ['#f4eef0', '#c8a8b8']],
  [['#e8cc3a', '#a88a14'], ['#d870a0', '#8a3a66'], ['#f2ece0', '#b8a890']],
];
function bloomHead(g, x, y, col, kind, r, rand) {
  if (kind === 2 || kind === 4) { // dense round head (thrift / clover-like) or bell spikes
    if (kind === 4) {
      g.fillStyle = col[1]; g.beginPath(); circle(g, x, y, r * 1.1); g.fill();
      g.fillStyle = col[0]; for (let k = 0; k < 6; k++) { const a = rand() * TAU, d = rand() * r * 0.6; g.beginPath(); circle(g, x + Math.cos(a) * d - 0.3, y + Math.sin(a) * d - 0.3, r * 0.45); g.fill(); }
      return;
    }
    for (let k = 0; k < 3; k++) { g.fillStyle = k ? col[0] : col[1]; g.beginPath(); g.ellipse(x + (k - 1) * r * 0.9, y + Math.abs(k - 1) * r * 0.9, r * 0.6, r * 0.85, (k - 1) * 0.5, 0, TAU); g.fill(); }
    return;
  }
  const n = kind === 1 ? 5 : 7;
  g.fillStyle = col[0];
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU + rand() * 0.3; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.55, r * 0.55, r * 0.32, a, 0, TAU); g.fill(); }
  g.fillStyle = col[1]; g.beginPath(); circle(g, x, y, r * 0.36); g.fill();
  g.fillStyle = 'rgba(255,255,235,0.55)'; g.beginPath(); circle(g, x - r * 0.25, y - r * 0.25, r * 0.16); g.fill();
}
function bloom(v) {
  const rand = rng(14400 + v * 47);
  const cols = BLOOM[v % BLOOM.length];
  return sprite(0.8, 0.62, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      for (let i = 0; i < 9; i++) { const u = (i / 8 - 0.5) * 2; blade(g, cx + u * 12, y, 6 + rand() * 7, u * 8, 2.6, mixc('#5f7d37', '#7b9746', rand()), '#36481f', '#86a050'); }
      const heads = [];
      const n = 7 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const x = cx + (rand() - 0.5) * 30, h = 8 + rand() * 12, lean = (x - cx) * 0.2 + (rand() - 0.5) * 3;
        g.strokeStyle = '#4f6a2c'; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(x, y - 1); g.quadraticCurveTo(x, y - h * 0.5, x + lean, y - h); g.stroke();
        heads.push([x + lean, y - h, cols[Math.floor(rand() * cols.length)]]);
      }
      heads.sort((a, b) => a[1] - b[1]);
      const kind = v === 2 ? 2 : v === 4 ? 4 : v === 1 ? 1 : 0;
      for (const [x, yy, c] of heads) bloomHead(g, x, yy, c, kind, 2.8 + rand() * 0.8, rand);
    }, 1.1, 'rgba(30,26,18,0.7)');
  });
}

// ---------------- heather, dry grass, thistles ----------------
function heather(v) {
  const rand = rng(14700 + v * 13);
  const col = v ? ['#a8589a', '#d688c4'] : ['#8a4a8e', '#c07ad0'];
  return sprite(0.85, 0.6, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      const lumps = [];
      for (let i = 0; i < 5; i++) lumps.push(mkLump(cx + (i - 2) * 6 + (rand() - 0.5) * 3, y - 7 - rand() * 4, 6 + rand() * 2, rand, 1.4));
      drawFoliage(g, lumps, { deep: '#26341c', dark: '#344a24', mid: '#4a6430', light: '#5e7a3a', high: '#7a944c' }, rand, { cx, cy: y - 8, R: 16, RY: 8, marks: 2, drop: 0.3 });
      for (let i = 0; i < 26; i++) {
        const x = cx + (rand() - 0.5) * 28, yy = y - 6 - rand() * 12;
        g.fillStyle = rand() < 0.5 ? col[0] : col[1];
        g.beginPath(); g.ellipse(x, yy, 1.2, 2, (rand() - 0.5) * 0.6, 0, TAU); g.fill();
      }
    }, 1.1, OUTL);
  });
}
function dryGrass(v) {
  const rand = rng(14900 + v * 17);
  return sprite(0.9, 0.75, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      const bl = [];
      for (let i = 0; i < 16; i++) { const u = (i / 15 - 0.5) * 2 + (rand() - 0.5) * 0.3; bl.push({ x: cx + u * 9, h: (14 + rand() * 18) * (1 - Math.abs(u) * 0.3), dx: u * 14 + (rand() - 0.5) * 5, w: 2 + rand(), t: rand() }); }
      bl.sort((a, b) => b.h - a.h);
      for (const B of bl) blade(g, B.x, y, B.h, B.dx, B.w, mixc('#a89c5a', '#c8b874', B.t), '#5a5228', mixc('#d8c88a', '#efe2b0', B.t));
      if (v !== 1) for (let i = 0; i < 3; i++) {
        const x = cx + (i - 1) * 7, h = 26 + rand() * 6;
        g.strokeStyle = '#8a7a48'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y - 4); g.quadraticCurveTo(x + (i - 1) * 2, y - h * 0.6, x + (i - 1) * 4, y - h); g.stroke();
        g.fillStyle = '#e0d098'; g.beginPath(); g.ellipse(x + (i - 1) * 4, y - h + 3, 1.6, 4, (i - 1) * 0.3, 0, TAU); g.fill();
      }
    }, 1.2, 'rgba(50,40,16,0.6)');
  });
}
function thistle(v) {
  const rand = rng(15100 + v * 19);
  return sprite(0.6, 0.85, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      // spiky silver-green rosette
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.05 + (i / 6) * 0.9), L = 9 + rand() * 4;
        const x1 = cx + Math.cos(a) * L * 1.2, y1 = y - 2 + Math.sin(a) * L * 0.6;
        g.fillStyle = i & 1 ? '#6a8a5a' : '#88a874';
        g.beginPath(); leaf(g, cx, y - 2, x1, y1, 3, 0); g.fill();
        g.strokeStyle = '#c8d8b8'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(a) * 2, y1 + Math.sin(a) * 1.5); g.stroke();
      }
      const n = v ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * 7, h = 26 + rand() * 12, tx = x + (rand() - 0.5) * 4;
        g.strokeStyle = '#5a7a44'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y - 2); g.lineTo(tx, y - h); g.stroke();
        g.fillStyle = '#6e8a52'; g.beginPath(); g.ellipse(tx, y - h + 2.5, 3.2, 3.6, 0, 0, TAU); g.fill();
        g.fillStyle = '#b05ac0'; g.beginPath(); g.ellipse(tx, y - h - 1.2, 3.2, 2.6, 0, Math.PI, TAU); g.fill();
        g.fillStyle = '#d88ae0'; for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(tx - 2.4 + k * 1.2, y - h - 2.4 - Math.sin(k / 4 * Math.PI) * 1.4, 0.6, 1.6, (k - 2) * 0.3, 0, TAU); g.fill(); }
      }
    }, 1.2, OUTL);
  });
}

// ---------------- extra mushrooms ----------------
function mushroomX(v) {
  const rand = rng(15300 + v * 7);
  return sprite(0.5, 0.42, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      if (v === 0) { // puffballs
        for (const [dx, r] of [[-5, 4.5], [3, 5.5], [8, 3]]) {
          g.fillStyle = lin(g, cx + dx - r, y - r * 2, cx + dx + r, y, [[0, '#fbf6ea'], [1, '#c8bca0']]);
          g.beginPath(); g.ellipse(cx + dx, y - r * 0.9, r, r * 0.9, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(140,120,90,0.5)'; for (let k = 0; k < 4; k++) { g.beginPath(); circle(g, cx + dx + (rand() - 0.5) * r, y - r + (rand() - 0.3) * r * 0.8, 0.5); g.fill(); }
        }
      } else { // tiny brown cluster on long stems
        for (let i = 0; i < 6; i++) {
          const x = cx + (i - 2.5) * 3 + (rand() - 0.5) * 2, h = 6 + rand() * 7, r = 2 + rand() * 1.2;
          g.strokeStyle = '#e8dcc4'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 2, y - h); g.stroke();
          g.fillStyle = mixc('#8a5a30', '#c08a4e', rand()); g.beginPath(); g.ellipse(x, y - h, r, r * 0.7, 0, Math.PI, TAU); g.fill();
        }
      }
    }, 1.4);
  });
}

// ---------------- biome bushes / mossy boulders ----------------
function roseBush(v) {
  const rand = rng(15500 + v * 23);
  const pal = { deep: '#22381a', dark: '#30482a', mid: '#44642f', light: '#5a7f3a', high: '#789c4c' };
  const petal = v ? ['#f0a0b8', '#c85a7e'] : ['#f6f2ea', '#d8b0b8'];
  return sprite(1.2, 0.95, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 6;
    const lumps = bushLumps(cx, baseY, 62, 42, rand);
    P.layer((g) => {
      drawFoliage(g, lumps, pal, rand, { cx, cy: baseY - 21, R: 31, RY: 21, marks: 1.2, drop: 0.5, sprigs: 1.2 });
      for (let k = 0; k < 9; k++) {
        const x = cx + (rand() - 0.5) * 50, y = baseY - 8 - rand() * 30;
        g.fillStyle = petal[1]; for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU; g.beginPath(); circle(g, x + Math.cos(a) * 2.2, y + Math.sin(a) * 1.8, 1.8); g.fill(); }
        g.fillStyle = petal[0]; for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU + 0.3; g.beginPath(); circle(g, x + Math.cos(a) * 1.6 - 0.3, y + Math.sin(a) * 1.3 - 0.3, 1.4); g.fill(); }
        g.fillStyle = '#e8c040'; g.beginPath(); circle(g, x - 0.2, y - 0.2, 0.9); g.fill();
      }
      for (let k = 0; k < 4; k++) { const x = cx + (rand() - 0.5) * 44, y = baseY - 6 - rand() * 26; g.fillStyle = '#b8402e'; g.beginPath(); g.ellipse(x, y, 1.4, 1.9, 0, 0, TAU); g.fill(); }
    });
  });
}
function juniperBush(v) {
  const rand = rng(15700 + v * 29);
  const pal = { deep: '#13241e', dark: '#1f382e', mid: '#2e4f3e', light: '#426a50', high: '#5e8a66' };
  return sprite(1.25, 0.8, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 6;
    P.layer((g) => {
      const lumps = [];
      for (let i = 0; i < 7; i++) lumps.push(mkLump(cx + (i - 3) * 9 + (rand() - 0.5) * 4, baseY - 10 - rand() * 9 - (3 - Math.abs(i - 3)) * 3, 9 + rand() * 3, rand, 0.7));
      drawFoliage(g, lumps, pal, rand, { cx, cy: baseY - 14, R: 34, RY: 14, marks: 0.8, drop: 0.5, sprigs: 1.8 });
      for (let i = 0; i < 10; i++) { const x = cx + (rand() - 0.5) * 56, y = baseY - 6 - rand() * 20; g.fillStyle = '#2c3d5a'; g.beginPath(); circle(g, x, y, 1.5); g.fill(); g.fillStyle = '#8aa0c2'; g.beginPath(); circle(g, x - 0.4, y - 0.5, 0.8); g.fill(); }
    });
  });
}
const MOSSY = [
  { dark: '#45453f', mid: '#76736a', light: '#9c988c', high: '#b9b4a6' },
  { dark: '#424741', mid: '#6f7670', light: '#959c94', high: '#b2b8af' },
  { dark: '#4a463e', mid: '#7c7466', light: '#a29888', high: '#bdb3a2' },
];
function mossyBoulder(v) {
  const rand = rng(15900 + v * 37);
  const C = MOSSY[v % MOSSY.length];
  const S = [[1.1, 0.85, 27, 19], [0.95, 0.85, 23, 21], [1.2, 0.9, 30, 20]][v % 3];
  return sprite(S[0], S[1], (g, P) => {
    const cx = P.W / 2, baseY = P.H - 7, rx = S[2], ry = S[3], cy = baseY - ry * 0.9;
    P.layer((g) => {
      const pts = blobPts(cx, cy, rx, ry, rand, 10, 0.1);
      for (const p of pts) if (p[1] > baseY) p[1] = baseY - rand() * 2;
      g.beginPath(); smoothClosed(g, pts);
      g.fillStyle = rad(g, cx - rx * 0.35, cy - ry * 0.45, 2, rx * 1.4, [[0, C.high], [0.45, C.light], [0.8, C.mid], [1, C.dark]]); g.fill();
      g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
      g.strokeStyle = 'rgba(40,36,30,0.55)'; g.lineWidth = 1;
      for (let k = 0; k < 2; k++) { let x = cx + (rand() - 0.3) * rx * 0.8, y = cy + (rand() - 0.5) * ry * 0.5; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 3; s++) { x += (rand() - 0.3) * 6; y += 2 + rand() * 4; g.lineTo(x, y); } g.stroke(); }
      // thick moss blanket over the top, dripping down the north side
      for (let j = 0; j < 26; j++) {
        const a = Math.PI * (1.05 + rand() * 0.9), d = rand() * 0.75;
        const x = cx + Math.cos(a) * rx * d, y = cy - ry * 0.25 + Math.sin(a) * ry * d * 0.8;
        g.fillStyle = j % 3 === 0 ? '#4e6a2c' : j % 3 === 1 ? '#5f7f34' : '#73943e';
        g.beginPath(); circle(g, x, y, 2.6 + rand() * 2.6); g.fill();
      }
      g.fillStyle = 'rgba(170,205,100,0.75)';
      for (let j = 0; j < 12; j++) { const a = Math.PI * (1.15 + rand() * 0.6), d = rand() * 0.7; g.beginPath(); circle(g, cx + Math.cos(a) * rx * d - 2, cy - ry * 0.4 + Math.sin(a) * ry * d * 0.7, 0.8 + rand()); g.fill(); }
      g.fillStyle = lin(g, 0, baseY - ry * 0.7, 0, baseY + 1, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(20,16,12,0.4)']]); g.fillRect(0, 0, P.W, P.H);
      g.restore();
    });
    // a fern frond and grass at the foot
    P.layer((g) => {
      frond(g, cx + rx * 0.7, baseY + 1, cx + rx * 1.15, baseY - 12, 4, FERN_PALS[0], rand, 0.25);
      for (let i = 0; i < 5; i++) blade(g, cx - rx * 0.75 + i * 2, baseY + 2, 5 + rand() * 5, -2 - rand() * 2, 2.2, '#5f7d37', '#36481f', '#7b9746');
    }, 1.1, OUTL);
  });
}

// ---------------- flat ground details ----------------
// fallen leaves (palette per tree species)
const LITTER = [
  ['#8a6234', '#a47a3c', '#6e4a28', '#b8934e'],       // oak (brown)
  ['#7a5a2e', '#96703a', '#5a4024', '#a88848'],
  ['#c2501e', '#e07a2a', '#a83420', '#f0a040'],       // maple
  ['#b23a1e', '#d0562a', '#e8883a', '#8a2a18'],
  ['#d8b23a', '#c8962a', '#e8cc5a', '#a8822a'],       // birch / aspen (yellow)
];
function litter(v) {
  const rand = rng(16100 + v * 11);
  const cols = LITTER[v % LITTER.length];
  return sprite(1.1, 0.6, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand());
      const x = cx + Math.cos(a) * r * 28, y = cy + Math.sin(a) * r * 11;
      const L = 2.4 + rand() * 1.8, ang = rand() * TAU;
      g.fillStyle = 'rgba(30,20,10,0.25)'; g.beginPath(); g.ellipse(x + 0.6, y + 0.8, L, L * 0.5, ang, 0, TAU); g.fill();
      g.fillStyle = cols[Math.floor(rand() * cols.length)];
      g.beginPath(); leaf(g, x - Math.cos(ang) * L, y - Math.sin(ang) * L * 0.5, x + Math.cos(ang) * L, y + Math.sin(ang) * L * 0.5, L * 0.55, 0); g.fill();
      if (v >= 2 && v <= 3 && rand() < 0.4) { g.beginPath(); circle(g, x + 1, y, L * 0.45); g.fill(); } // lobed maple leaves
      g.strokeStyle = 'rgba(60,30,10,0.35)'; g.lineWidth = 0.4; g.beginPath(); g.moveTo(x - Math.cos(ang) * L * 0.8, y - Math.sin(ang) * L * 0.4); g.lineTo(x + Math.cos(ang) * L * 0.8, y + Math.sin(ang) * L * 0.4); g.stroke();
    }
  }, { pad: 4 });
}
function needles(v) {
  const rand = rng(16300 + v * 13);
  return sprite(1.0, 0.55, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    g.fillStyle = 'rgba(110,76,42,0.35)'; g.beginPath(); g.ellipse(cx, cy, 26, 10, 0, 0, TAU); g.fill();
    g.lineWidth = 0.8;
    for (let i = 0; i < 90; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand());
      const x = cx + Math.cos(a) * r * 28, y = cy + Math.sin(a) * r * 11, b = rand() * TAU;
      g.strokeStyle = rand() < 0.5 ? 'rgba(130,88,48,0.85)' : rand() < 0.5 ? 'rgba(160,118,66,0.8)' : 'rgba(96,66,36,0.8)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * 3.2, y + Math.sin(b) * 1.4); g.stroke();
    }
    // a few pine cones
    for (let k = 0; k < 1 + v; k++) {
      const x = cx + (rand() - 0.5) * 30, y = cy + (rand() - 0.5) * 8, ang = rand() * TAU;
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = '#5a3a1e'; g.beginPath(); g.ellipse(0, 0, 4.2, 2.4, 0, 0, TAU); g.fill();
      g.fillStyle = '#8a5a2e'; for (let j = -2; j <= 2; j++) { g.beginPath(); g.ellipse(j * 1.6, 0, 1, 1.9, 0, 0, TAU); g.fill(); }
      g.restore();
    }
  }, { pad: 4 });
}
function twigs(v) {
  const rand = rng(16500 + v * 17);
  return sprite(0.8, 0.45, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    for (let i = 0; i < 4 + v; i++) {
      const x = cx + (rand() - 0.5) * 30, y = cy + (rand() - 0.5) * 10, a = rand() * TAU, L = 6 + rand() * 8;
      const x1 = x + Math.cos(a) * L, y1 = y + Math.sin(a) * L * 0.45;
      g.strokeStyle = 'rgba(30,20,10,0.3)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 0.6, y + 1); g.lineTo(x1 + 0.6, y1 + 1); g.stroke();
      g.strokeStyle = rand() < 0.5 ? '#6e4c2c' : '#8a6438'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
      if (rand() < 0.6) { const t = 0.5, bx = x + (x1 - x) * t, by = y + (y1 - y) * t, b = a + (rand() < 0.5 ? 0.6 : -0.6); g.lineWidth = 0.9; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * L * 0.4, by + Math.sin(b) * L * 0.2); g.stroke(); }
    }
  }, { pad: 4 });
}
function petals(v) {
  const rand = rng(16700 + v * 19);
  const cols = v ? ['#f0a8c4', '#f4f0f2', '#e88ab0'] : ['#f6f2ea', '#f2c531', '#f4f0e0'];
  return sprite(0.8, 0.45, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    for (let i = 0; i < 22; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand());
      g.fillStyle = cols[Math.floor(rand() * cols.length)];
      g.beginPath(); g.ellipse(cx + Math.cos(a) * r * 22, cy + Math.sin(a) * r * 9, 1.3, 0.8, rand() * TAU, 0, TAU); g.fill();
    }
  }, { pad: 4 });
}
function moss(v) {
  const rand = rng(16900 + v * 23);
  return sprite(0.9, 0.55, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    const n = 5 + v * 2;
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 34, y = cy + (rand() - 0.5) * 10, r = 4 + rand() * 4;
      g.fillStyle = 'rgba(30,40,14,0.35)'; g.beginPath(); g.ellipse(x + 0.8, y + 1, r, r * 0.55, 0, 0, TAU); g.fill();
      g.fillStyle = rand() < 0.5 ? '#4e6a2a' : '#5a7a30'; g.beginPath(); smoothClosed(g, blobPts(x, y, r, r * 0.5, rand, 9, 0.2)); g.fill();
      g.fillStyle = 'rgba(150,190,80,0.8)';
      for (let k = 0; k < 6; k++) { g.beginPath(); circle(g, x - r * 0.3 + (rand() - 0.5) * r, y - r * 0.15 + (rand() - 0.5) * r * 0.4, 0.7 + rand() * 0.6); g.fill(); }
    }
  }, { pad: 4 });
}
function lily(v) {
  const rand = rng(17100 + v * 29);
  return sprite(0.9, 0.55, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    const pads = v === 3 ? 4 : 2 + (v % 2);
    for (let i = 0; i < pads; i++) {
      const x = cx + (i - (pads - 1) / 2) * 11 + (rand() - 0.5) * 4, y = cy + (rand() - 0.5) * 8, r = 6 + rand() * 3, a0 = rand() * TAU;
      g.fillStyle = 'rgba(10,30,30,0.3)'; g.beginPath(); g.ellipse(x + 1, y + 1.4, r, r * 0.55, 0, 0, TAU); g.fill();
      g.fillStyle = lin(g, x - r, y - r, x + r, y + r, [[0, '#78a848'], [1, '#3e6a2c']]);
      g.beginPath(); g.moveTo(x, y); g.ellipse(x, y, r, r * 0.55, 0, a0 + 0.35, a0 + TAU - 0.05); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,60,20,0.6)'; g.lineWidth = 0.7; g.beginPath();
      for (let k = 0; k < 5; k++) { const a = a0 + 0.6 + k * 1.1; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.44); }
      g.stroke();
      g.strokeStyle = 'rgba(200,230,150,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(x, y, r * 0.9, r * 0.5, 0, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
    }
    if (v >= 1) { // water lily flower
      const x = cx + (rand() - 0.5) * 6, y = cy - 1, pink = v === 2;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.fillStyle = pink ? (k & 1 ? '#f0a0c0' : '#e07aa0') : (k & 1 ? '#fbf8f0' : '#e6e0d0'); g.beginPath(); g.ellipse(x + Math.cos(a) * 2.6, y + Math.sin(a) * 1.6 - 1, 2.4, 1.1, a, 0, TAU); g.fill(); }
      g.fillStyle = '#f2c531'; g.beginPath(); circle(g, x, y - 1.2, 1.3); g.fill();
    }
  }, { pad: 4 });
}
function riverstone(v) {
  const rand = rng(17300 + v * 31);
  const cols = [['#8a8a84', '#b4b2a8', '#5e5e5a'], ['#7e7a70', '#a8a294', '#56524a'], ['#8c8478', '#b8ae9e', '#605848']];
  return sprite(0.8, 0.45, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    const n = 3 + v;
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 28, y = cy + (rand() - 0.5) * 8, rx = 3 + rand() * 3.5, ry = rx * (0.55 + rand() * 0.15);
      const c = cols[(i + v) % cols.length];
      g.fillStyle = 'rgba(10,20,20,0.3)'; g.beginPath(); g.ellipse(x + 0.8, y + 1, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = c[2]; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = c[0]; g.beginPath(); g.ellipse(x - rx * 0.1, y - ry * 0.2, rx * 0.85, ry * 0.72, 0, 0, TAU); g.fill();
      g.fillStyle = c[1]; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.4, rx * 0.4, ry * 0.25, -0.2, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(x - rx * 0.45, y - ry * 0.45, rx * 0.16, ry * 0.1, -0.2, 0, TAU); g.fill(); // wet glint
    }
  }, { pad: 4 });
}
function scree(v) {
  const rand = rng(17500 + v * 37);
  return sprite(1.0, 0.5, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    for (let i = 0; i < 14 + v * 4; i++) {
      const x = cx + (rand() - 0.5) * 34, y = cy + (rand() - 0.5) * 11, r = 1.4 + Math.pow(rand(), 1.8) * 4.5;
      const k = 0.85 + rand() * 0.3;
      g.fillStyle = 'rgba(20,16,12,0.35)'; g.beginPath(); g.ellipse(x + 0.7, y + 0.9, r, r * 0.6, 0, 0, TAU); g.fill();
      g.fillStyle = rgb([106 * k, 100 * k, 92 * k]);
      g.beginPath(); smoothClosed(g, blobPts(x, y, r, r * 0.7, rand, 6, 0.25)); g.fill();
      g.fillStyle = rgb([160 * k, 154 * k, 144 * k]); g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.28, 0, 0, TAU); g.fill();
    }
  }, { pad: 4 });
}
function shell(v) {
  const rand = rng(17700 + v * 41);
  return sprite(0.6, 0.35, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    for (let i = 0; i < 3 + v; i++) {
      const x = cx + (rand() - 0.5) * 22, y = cy + (rand() - 0.5) * 6, r = 1.8 + rand() * 1.6, a = rand() * TAU;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = rand() < 0.5 ? '#f2e6d6' : '#e8c8b0';
      g.beginPath(); g.moveTo(0, r * 0.6); g.lineTo(-r, -r * 0.3); g.quadraticCurveTo(0, -r * 1.3, r, -r * 0.3); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(150,110,80,0.6)'; g.lineWidth = 0.5; g.beginPath(); for (let k = -1; k <= 1; k++) { g.moveTo(0, r * 0.5); g.lineTo(k * r * 0.6, -r * 0.6); } g.stroke();
      g.restore();
    }
  }, { pad: 4 });
}
function driftwood() {
  const rand = rng(17900);
  return sprite(1.2, 0.45, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    g.fillStyle = 'rgba(30,24,16,0.3)'; g.beginPath(); g.ellipse(cx + 1, cy + 3, 32, 4, -0.08, 0, TAU); g.fill();
    g.fillStyle = lin(g, 0, cy - 4, 0, cy + 4, [[0, '#d8ccb4'], [0.5, '#a89a82'], [1, '#6e6250']]);
    g.beginPath(); taper(g, cx - 32, cy + 2, cx, cy - 2, cx + 30, cy + 1, 7, 4); g.fill();
    g.beginPath(); taper(g, cx + 8, cy - 1, cx + 14, cy - 6, cx + 22, cy - 9, 3, 1.4); g.fill();
    g.strokeStyle = 'rgba(80,66,50,0.55)'; g.lineWidth = 0.7;
    for (let i = 0; i < 5; i++) { const x = cx - 26 + i * 11 + rand() * 3; g.beginPath(); g.moveTo(x, cy - 1); g.lineTo(x + 7, cy + 0.5); g.stroke(); }
    g.fillStyle = '#efe6d2'; g.beginPath(); g.ellipse(cx - 32, cy + 2, 1.6, 3.2, 0, 0, TAU); g.fill();
  }, { pad: 4 });
}

export function addUndergrowth(add) {
  const put = (name, c, foot) => add(name, c, 0.5, 1 - foot / (c.origH || c.height));
  const flat = (name, c) => add(name, c, 0.5, 0.5);
  for (let i = 0; i < 4; i++) put('fern_' + i, fern(i), 4);
  for (let i = 0; i < BLOOM.length; i++) put('bloom_' + i, bloom(i), 4);
  for (let i = 0; i < 2; i++) put('heather_' + i, heather(i), 4);
  for (let i = 0; i < 2; i++) put('drygrass_' + i, dryGrass(i), 4);
  for (let i = 0; i < 2; i++) put('thistle_' + i, thistle(i), 4);
  for (let i = 0; i < 2; i++) put('mushroom_' + (3 + i), mushroomX(i), 4);
  for (let i = 0; i < 2; i++) put('bush_rose_' + i, roseBush(i), 6);
  for (let i = 0; i < 2; i++) put('bush_juniper_' + i, juniperBush(i), 6);
  for (let i = 0; i < 3; i++) put('boulder_moss_' + i, mossyBoulder(i), 7);
  for (let i = 0; i < LITTER.length; i++) flat('litter_' + i, litter(i));
  for (let i = 0; i < 2; i++) flat('needles_' + i, needles(i));
  for (let i = 0; i < 2; i++) flat('twigs_' + i, twigs(i));
  for (let i = 0; i < 2; i++) flat('petals_' + i, petals(i));
  for (let i = 0; i < 3; i++) flat('moss_' + i, moss(i));
  for (let i = 0; i < 4; i++) flat('lily_' + i, lily(i));
  for (let i = 0; i < 3; i++) flat('riverstone_' + i, riverstone(i));
  for (let i = 0; i < 2; i++) flat('scree_' + i, scree(i));
  for (let i = 0; i < 2; i++) flat('shell_' + i, shell(i));
  flat('driftwood_0', driftwood());
}

