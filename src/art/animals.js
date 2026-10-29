// Animals: RimWorld-like quadrupeds with real leg anatomy (jointed chains), cel shading, markings and fur.
// Views: _e (side, facing right), _s (front, facing the camera), _n (back). Gait frames:
//   side:  _e (stand), _e_walk (A: near-front & far-hind reaching forward), _e_w1 (passing), _e_w2 (B), _e_w3 (passing)
//   front/back: _s_w1/_s_w2, _n_w1/_n_w2 (diagonal leg pairs lifted)
// Deer has two looks: `deer_*` (stag, antlers) and `deer_doe_*` (spotted doe, no antlers).
// Layer order per sprite: far legs → near legs → tail → body (+neck) → far ear → head → antlers.

import { spritePxFast as spritePx, rng, OW, TAU, lin, rad, circle, mixc, rgb, hex, atop, canvas } from './paint.js';
import { spline, chain, plant, limbPath, fur, tufts, eyeAt, part, stack, strip, mirror } from './kit.js';

const A = (c, a) => rgb(hex(c), a);

// ---------- shared leg poses (cumulative angle deltas per segment: upper, knee, cannon, pastern) ----------
const POSE = {
  front: { stand: [0, 0, 0, 0], fwd: [0.36, -0.06, 0, -0.2], back: [-0.32, 0.02, 0.06, 0.38], lift: [0.3, -1.25, 0, -0.35] },
  hind: { stand: [0, 0, 0, 0], fwd: [0.3, 0.02, 0, -0.18], back: [-0.34, 0.12, 0.05, 0.3], lift: [0.42, -0.5, 1.0, 0.25] },
};
// frames: [nearFront, nearHind, farFront, farHind]
const FRAMES = {
  e: ['stand', 'stand', 'stand', 'stand'],
  e_walk: ['fwd', 'back', 'back', 'fwd'],
  e_w1: ['stand', 'lift', 'lift', 'stand'],
  e_w2: ['back', 'fwd', 'fwd', 'back'],
  e_w3: ['lift', 'stand', 'stand', 'lift'],
};

// ---------- species ----------
// Coordinates are in the side sprite's design box (facing right); `oy` shifts everything down (room for antlers/ears).
const SPECIES = {
  wolf: {
    W: 104, H: 90, oy: 10, foot: 74, hoofH: 0, ow: 3,
    coat: '#8e877b', dark: '#575047', light: '#e2dacb', nose: '#1b1714', paw: '#4c453d', eye: '#e2a83a',
    legs: {
      front: { x: 66, y: 50, w0: 10, segs: [[10, -0.05, 6.2], [2, 0, 5.5], [10, 0.02, 4.4], [4, 0.5, 4.2]] },
      hind: { x: 29, y: 43, w0: 15, segs: [[11.5, 0.55, 8], [11, -0.72, 5], [9, 0.12, 4.3], [3, 0.6, 4.1]] },
      far: [5, -1.5], paw: 'paw',
    },
    body: [[19, 42], [24, 36.5], [36, 36], [50, 35.5], [60, 33], [67, 27], [74, 19], [84, 28], [80, 38], [77, 46], [75, 53], [68, 57], [58, 54], [48, 50], [38, 48], [33, 50], [25, 49], [19, 46]],
  },
  fox: {
    W: 90, H: 64, oy: 8, foot: 53, hoofH: 0, ow: 2.6,
    coat: '#cf6f2c', dark: '#91431a', light: '#f6efe4', nose: '#1b1714', paw: '#2a1f1a', eye: '#e0a030', sock: '#30241d',
    legs: {
      front: { x: 55, y: 37, w0: 7, segs: [[6.5, -0.05, 4.4], [1.5, 0, 3.8], [6.5, 0.02, 3.1], [3, 0.5, 3.1]] },
      hind: { x: 28, y: 33, w0: 10, segs: [[8.5, 0.55, 5.8], [8, -0.7, 3.6], [5.5, 0.12, 3.1], [2, 0.6, 3]] },
      far: [4, -1.2], paw: 'paw',
    },
    body: [[19, 34], [25, 30], [38, 29], [50, 27], [56, 23], [61, 16], [68, 22], [65, 30], [61, 37], [58, 41], [50, 40], [40, 40], [33, 39], [29, 41], [23, 39], [19, 37]],
  },
  deer: {
    W: 106, H: 128, oy: 24, foot: 100, hoofH: 3, ow: 3, hd: [2, 6],
    coat: '#a26d3d', dark: '#704628', light: '#f1e6cf', belly: '#e9d7b4', nose: '#1b1613', paw: '#2b221c', eye: null,
    antler: '#dcc7a0', antlerDark: '#a78f68',
    legs: {
      front: { x: 67, y: 64, w0: 10, segs: [[12.5, -0.04, 4.8], [3, 0, 4.5], [12.5, 0.0, 3.0], [4, 0.55, 2.9]] },
      hind: { x: 31, y: 61, w0: 16, segs: [[11.5, 0.5, 8.6], [12.5, -0.62, 4.7], [13, 0.08, 3.1], [4, 0.5, 2.9]] },
      far: [5, -1.5], paw: 'hoof',
    },
    body: [[20, 60], [26, 54.5], [36, 55], [48, 56.5], [57, 53], [63, 47], [70, 40], [77, 34.5], [85.5, 40], [84, 48], [81, 56], [77, 64], [71, 70], [62, 70.5], [50, 71], [40, 69], [34, 71], [26, 69], [21, 65]],
  },
  boar: {
    W: 98, H: 70, oy: 6, foot: 59, hoofH: 2.4, ow: 3,
    coat: '#6c5546', dark: '#3d2f28', light: '#a08572', nose: '#c4998a', paw: '#2a211b', eye: null, tusk: '#f2ead6',
    legs: {
      front: { x: 62, y: 46, w0: 10, segs: [[5, -0.05, 5.4], [1.5, 0, 5], [4.5, 0.02, 4.2], [2, 0.35, 4]] },
      hind: { x: 27, y: 42, w0: 13, segs: [[6.5, 0.5, 7], [6, -0.6, 4.6], [3.5, 0.15, 4.1], [1.5, 0.35, 3.9]] },
      far: [5, -1.5], paw: 'hoof',
    },
    body: [[18, 40], [22, 33], [34, 28], [48, 24], [58, 21], [66, 24], [72, 30], [72, 40], [67, 49], [56, 50], [44, 50], [34, 48], [27, 48], [20, 46]],
  },
  bear: {
    W: 136, H: 104, oy: 6, foot: 92, hoofH: 0, ow: 3.3,
    coat: '#5f4433', dark: '#3a291e', light: '#8f6c50', muzzle: '#a8876a', nose: '#16110e', paw: '#2c2018', eye: null,
    legs: {
      front: { x: 88, y: 62, w0: 22, segs: [[11, -0.04, 14], [3, 0, 13], [9, 0.02, 12], [3, 0.4, 12]] },
      hind: { x: 37, y: 58, w0: 25, segs: [[11, 0.38, 15.5], [11, -0.42, 12.5], [7, 0.04, 12], [2.5, 0.5, 11.5]] },
      far: [7, -2.5], paw: 'bear',
    },
    body: [[22, 56], [28, 46], [44, 43], [62, 40], [78, 33], [92, 38], [100, 48], [100, 60], [96, 70], [88, 74], [74, 73], [60, 74], [48, 73], [40, 75], [28, 72], [21, 65]],
  },
  rabbit: {
    W: 52, H: 50, oy: 8, foot: 38, hoofH: 0, ow: 2.4,
    coat: '#a28c74', dark: '#6f5e4c', light: '#f0e8dc', nose: '#d3898a', paw: '#7f6e5c', eye: null, earIn: '#e2aaa3',
  },
};

// ---------- generic painters ----------
// each layer is shifted by the species' oy
function L(P, S, fn, ow = S.ow, col) { P.layer((g) => { g.translate(0, S.oy); fn(g); }, ow, col); }

function legPts(S, which, poseName, far) {
  const D = S.legs[which];
  const [fx, fy] = far ? S.legs.far : [0, 0];
  const d = POSE[which][poseName];
  const k = far ? 0.94 : 1;
  const segs = D.segs.map(([l, a, w]) => [l * k, a, w * (far ? 0.92 : 1)]);
  const pts = chain(D.x + fx, D.y + fy, D.w0 * (far ? 0.9 : 1), segs, d);
  if (poseName !== 'lift') plant(pts, S.foot + fy * 0.6 - S.hoofH);
  return pts;
}

function drawFoot(g, S, pts, far, col) {
  const n = pts.length, p = pts[n - 1], q = pts[n - 2];
  const a = Math.atan2(p[1] - q[1], p[0] - q[0]); // direction of the last segment
  const w = p[2];
  const kind = S.legs.paw;
  g.save(); g.translate(p[0], p[1]);
  if (kind === 'hoof') {
    // small dark hoof pointing forward, sole parallel to the ground when planted
    const tilt = (a - Math.PI / 2) * 0.6;
    g.rotate(tilt);
    const hw = w * 0.62, h = S.hoofH + 0.6;
    g.fillStyle = far ? mixc(S.paw, '#000', 0.25) : S.paw;
    g.beginPath(); g.moveTo(-hw, -0.6); g.lineTo(hw * 0.9, -0.6); g.quadraticCurveTo(hw * 1.9, h * 0.6, hw * 1.6, h); g.lineTo(-hw * 1.05, h); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,240,220,0.22)'; g.fillRect(-hw * 0.8, -0.2, hw * 1.2, 0.8);
    if (S === SPECIES.boar) { g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(hw * 0.5, 0); g.lineTo(hw * 0.7, h); g.stroke(); }
  } else if (kind === 'bear') {
    g.rotate((a - Math.PI / 2) * 0.5);
    g.fillStyle = col;
    g.beginPath(); g.ellipse(w * 0.22, -w * 0.12, w * 0.68, w * 0.34, 0, 0, TAU); g.fill();
    g.fillStyle = '#e8dccb';
    for (let i = 0; i < 4; i++) { const x = w * 0.5 + i * 1.6; g.beginPath(); g.moveTo(x, -1.5); g.quadraticCurveTo(x + 2.6, -0.4, x + 2.2, 1.6); g.lineTo(x + 0.6, 0); g.closePath(); g.fill(); }
  } else {
    g.rotate((a - Math.PI / 2) * 0.5);
    g.fillStyle = col;
    g.beginPath(); g.ellipse(w * 0.3, -w * 0.2, w * 0.72, w * 0.4, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(20,14,10,0.45)'; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(w * 0.55, -w * 0.45); g.lineTo(w * 0.7, 0); g.moveTo(w * 0.15, -w * 0.5); g.lineTo(w * 0.25, 0); g.stroke();
  }
  g.restore();
}

function drawLeg(g, S, pts, far, which, rand) {
  const base = far ? mixc(S.coat, S.dark, 0.5) : S.coat;
  g.beginPath(); limbPath(g, pts); g.fillStyle = base; g.fill();
  const n = pts.length, top = pts[0], end = pts[n - 1];
  g.save(); g.beginPath(); limbPath(g, pts); g.clip();
  // lower-leg tone (socks / darker shins), light front edge, shadow back edge
  const yk = pts[2][1];
  if (S.sock) {
    g.fillStyle = far ? mixc(S.sock, '#000', 0.2) : S.sock;
    g.fillRect(0, yk - 1, 200, 200);
  } else {
    g.fillStyle = lin(g, 0, yk - 4, 0, end[1] + 2, [[0, 'rgba(0,0,0,0)'], [1, A(S.dark, far ? 0.5 : 0.42)]]);
    g.fillRect(0, yk - 4, 200, 200);
  }
  if (!far) {
    // rim light on the leading (front-left) edge + cel shade on the trailing edge
    g.strokeStyle = 'rgba(255,246,226,0.32)'; g.lineWidth = 1.2;
    g.beginPath(); for (let i = 0; i < n; i++) { const p = pts[i]; const x = p[0] + p[2] * 0.33, y = p[1]; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.strokeStyle = A(S.dark, 0.35); g.lineWidth = 1.6;
    g.beginPath(); for (let i = 0; i < n; i++) { const p = pts[i]; const x = p[0] - p[2] * 0.42, y = p[1]; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    if (S.light && which === 'hind' && S !== SPECIES.boar && S !== SPECIES.deer) {
      g.fillStyle = A(S.light, 0.28); g.beginPath(); g.ellipse(top[0] + 2, top[1] + 4, top[2] * 0.3, top[2] * 0.45, 0.3, 0, TAU); g.fill();
    }
    fur(g, rand, top[0] - top[2], top[1], top[0] + top[2], pts[2][1], 5, [A(S.dark, 0.4), A(S.light, 0.3)], Math.PI * 0.5, 2.6);
  }
  g.restore();
  // hock / knee knob highlight
  drawFoot(g, S, pts, far, far ? mixc(S.paw, S.dark, 0.4) : mixc(S.coat, S.paw, S.sock ? 0.9 : 0.55));
}

// body silhouette + coat shading; `marks(g)` paints species markings inside the clip
function coatBody(g, S, pts, box, marks, rand, furN = 40) {
  const [x0, y0, x1, y1] = box;
  g.beginPath(); spline(g, pts); g.fillStyle = S.coat; g.fill();
  g.save(); g.beginPath(); spline(g, pts); g.clip();
  // back darker → belly lighter
  g.fillStyle = lin(g, 0, y0, 0, y1, [[0, A(S.dark, 0.55)], [0.3, A(S.dark, 0)], [0.75, 'rgba(0,0,0,0)'], [1, A(S.belly || S.light, 0.35)]]);
  g.fillRect(x0 - 20, y0 - 20, x1 - x0 + 40, y1 - y0 + 40);
  if (marks) marks(g);
  // cel shade toward bottom-right, soft light top-left
  g.fillStyle = 'rgba(30,20,12,0.16)';
  g.beginPath(); g.ellipse(x0 + (x1 - x0) * 0.6, y1 + (y1 - y0) * 0.25, (x1 - x0) * 0.62, (y1 - y0) * 0.5, -0.08, 0, TAU); g.fill();
  g.fillStyle = rad(g, x0 + (x1 - x0) * 0.4, y0 + (y1 - y0) * 0.15, 0, (x1 - x0) * 0.55, [[0, 'rgba(255,248,230,0.2)'], [1, 'rgba(255,248,230,0)']]);
  g.fillRect(x0 - 20, y0 - 20, x1 - x0 + 40, y1 - y0 + 40);
  fur(g, rand, x0, y0, x1, y1, furN, [A(S.dark, 0.45), A(S.light, 0.35)], Math.PI * 0.62, 3.4, 0.38);
  g.restore();
}

// ---------- species heads & bodies (side view) ----------
const SIDE = {
  wolf: {
    tail(g, S, rand) {
      const pts = [[22, 39], [12, 42], [6, 52], [6, 64], [10, 66], [14, 58], [19, 48], [25, 43]];
      g.beginPath(); spline(g, pts); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, pts); g.clip();
      g.fillStyle = S.dark; g.beginPath(); g.ellipse(8, 63, 5, 6, 0.3, 0, TAU); g.fill();
      g.fillStyle = A(S.light, 0.6); g.beginPath(); g.ellipse(14, 52, 2.5, 8, 0.5, 0, TAU); g.fill();
      g.fillStyle = A(S.dark, 0.6); g.beginPath(); g.ellipse(15, 41, 7, 3, 0.2, 0, TAU); g.fill();
      fur(g, rand, 4, 40, 26, 66, 16, [A(S.dark, 0.5), A(S.light, 0.4)], Math.PI * 0.6, 3);
      g.restore();
    },
    body(g, S, rand) {
      coatBody(g, S, S.body, [18, 18, 84, 57], (g) => {
        // dark saddle
        g.fillStyle = A(S.dark, 0.75);
        g.beginPath(); spline(g, [[22, 36], [40, 33], [60, 31], [70, 25], [72, 34], [60, 40], [40, 41], [26, 42]]); g.fill();
        // pale throat/ruff and belly
        g.fillStyle = S.light;
        g.beginPath(); spline(g, [[78, 30], [84, 32], [80, 42], [76, 51], [69, 57], [70, 46]]); g.fill();
        g.fillStyle = A(S.light, 0.7);
        g.beginPath(); spline(g, [[40, 49], [52, 50], [64, 53], [66, 58], [42, 53]]); g.fill();
        g.fillStyle = A(S.light, 0.5); g.beginPath(); g.ellipse(25, 46, 4, 5, 0.2, 0, TAU); g.fill();
      }, rand, 46);
      // ruff tufts on the throat and chest
      g.fillStyle = S.light;
      g.beginPath(); tufts(g, [[82, 34], [80, 40], [77, 46], [75, 52]], 2.8, 1, rand); g.fill();
      g.fillStyle = S.coat;
      g.beginPath(); tufts(g, [[68, 57], [61, 55.5], [54, 52.5]], 2.2, 1, rand); g.fill();
    },
    farEar(g, S) { g.fillStyle = mixc(S.coat, S.dark, 0.55); g.beginPath(); g.moveTo(80.5, 18); g.lineTo(80, 6.5); g.lineTo(86, 15.5); g.closePath(); g.fill(); },
    head(g, S, rand) {
      const H = [[72, 22], [75, 15.5], [82, 14], [88, 18], [94, 22.5], [98.5, 25.5], [98, 28.5], [93, 30], [86, 31.5], [80, 32], [74, 29]];
      g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, H); g.clip();
      g.fillStyle = lin(g, 0, 13, 0, 32, [[0, A(S.dark, 0.6)], [0.45, 'rgba(0,0,0,0)']]); g.fillRect(60, 10, 50, 30);
      // pale cheek & jaw mask
      g.fillStyle = S.light; g.beginPath(); spline(g, [[78, 25], [86, 24], [96, 27], [94, 31], [84, 33], [77, 31]]); g.fill();
      g.fillStyle = 'rgba(255,248,230,0.25)'; g.beginPath(); g.ellipse(80, 17, 5, 2.4, -0.2, 0, TAU); g.fill();
      fur(g, rand, 72, 14, 90, 24, 8, [A(S.dark, 0.5), A(S.light, 0.4)], Math.PI * 0.05, 2.4);
      g.restore();
      // nose, mouth, eye, near ear
      g.fillStyle = S.nose; g.beginPath(); g.ellipse(97.4, 25.6, 2.4, 1.9, 0.2, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); circle(g, 96.8, 24.8, 0.6); g.fill();
      g.strokeStyle = A(S.dark, 0.85); g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(96.5, 28.6); g.quadraticCurveTo(91, 29.4, 87, 28.4); g.stroke();
      g.strokeStyle = A(S.dark, 0.6); g.lineWidth = 0.8; g.beginPath(); g.moveTo(84, 22); g.quadraticCurveTo(88, 20.5, 92, 22.5); g.stroke();
      eyeAt(g, 84.2, 20.8, 1.55, S.eye, 0.85);
      g.strokeStyle = '#1a1410'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(82, 19.5); g.lineTo(86.2, 19.6); g.stroke();
      g.fillStyle = S.coat; g.beginPath(); g.moveTo(74, 17.5); g.lineTo(75.5, 4.5); g.lineTo(81.5, 15); g.closePath(); g.fill();
      g.fillStyle = mixc(S.dark, '#2a201a', 0.4); g.beginPath(); g.moveTo(75.6, 15.5); g.lineTo(76, 8); g.lineTo(79.6, 14.6); g.closePath(); g.fill();
      g.fillStyle = A(S.light, 0.7); g.beginPath(); g.moveTo(76.6, 15.2); g.lineTo(76.6, 10.5); g.lineTo(78.8, 14.6); g.closePath(); g.fill();
    },
  },
  fox: {
    tail(g, S, rand) {
      const pts = [[22, 32], [14, 33], [5, 38], [-1, 45], [1, 50], [7, 49], [13, 44], [20, 38], [25, 35]];
      g.beginPath(); spline(g, pts); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, pts); g.clip();
      g.fillStyle = S.light; g.beginPath(); g.ellipse(1.5, 47, 5, 5.5, 0.4, 0, TAU); g.fill();
      g.fillStyle = A(S.dark, 0.5); g.beginPath(); g.ellipse(15, 34, 8, 2.6, 0.3, 0, TAU); g.fill();
      g.fillStyle = A(S.light, 0.35); g.beginPath(); g.ellipse(12, 43, 7, 2, -0.6, 0, TAU); g.fill();
      fur(g, rand, -2, 32, 26, 50, 18, [A(S.dark, 0.5), A('#ffe2b8', 0.45)], Math.PI * 0.85, 3.2);
      g.restore();
    },
    body(g, S, rand) {
      coatBody(g, S, S.body, [18, 15, 68, 41], (g) => {
        g.fillStyle = S.light;
        g.beginPath(); spline(g, [[62, 22], [68, 24], [64, 32], [60, 39], [55, 41], [57, 33]]); g.fill();
        g.fillStyle = A(S.light, 0.6);
        g.beginPath(); spline(g, [[36, 40], [46, 38], [56, 40], [52, 44], [38, 44]]); g.fill();
        g.fillStyle = A(S.dark, 0.5);
        g.beginPath(); spline(g, [[22, 30], [38, 28], [52, 26], [52, 30], [36, 32], [24, 33]]); g.fill();
      }, rand, 34);
      g.fillStyle = S.light; g.beginPath(); tufts(g, [[66, 26], [64, 31], [61, 36], [58, 40]], 2.2, 1, rand); g.fill();
    },
    farEar(g, S) { g.fillStyle = '#2a201a'; g.beginPath(); g.moveTo(65, 13); g.lineTo(66, 1); g.lineTo(71, 12); g.closePath(); g.fill(); },
    head(g, S, rand) {
      const H = [[57, 18], [60, 12], [66, 11], [72, 15], [78, 19], [82, 21.5], [81.5, 23.8], [76, 24.6], [69, 25.6], [62, 25], [58, 22]];
      g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, H); g.clip();
      g.fillStyle = S.light; g.beginPath(); spline(g, [[63, 21], [70, 20], [80, 22], [79, 25], [68, 27], [62, 25]]); g.fill();
      g.fillStyle = 'rgba(255,248,230,0.25)'; g.beginPath(); g.ellipse(64, 14, 4, 2, -0.2, 0, TAU); g.fill();
      fur(g, rand, 57, 11, 74, 20, 6, [A(S.dark, 0.5), A('#ffe2b8', 0.4)], 0.1, 2.2);
      g.restore();
      g.fillStyle = S.nose; g.beginPath(); g.ellipse(81.4, 21.9, 1.9, 1.5, 0.2, 0, TAU); g.fill();
      g.strokeStyle = '#3a2418'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(80.6, 23.8); g.quadraticCurveTo(76, 24.6, 72, 23.6); g.stroke();
      // sly almond eye with dark tear line
      eyeAt(g, 68.2, 16.8, 1.35, S.eye, 0.75);
      g.strokeStyle = '#2a1a12'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(69.4, 17.6); g.quadraticCurveTo(72, 19.4, 74.5, 19.2); g.stroke();
      // big near ear, black back with pale inside
      g.fillStyle = S.coat; g.beginPath(); g.moveTo(58.5, 14); g.lineTo(59.5, -0.5); g.lineTo(66.5, 11); g.closePath(); g.fill();
      g.fillStyle = '#2a201a'; g.beginPath(); g.moveTo(59, 6); g.lineTo(59.5, -0.5); g.lineTo(63.5, 6.2); g.closePath(); g.fill();
      g.fillStyle = A(S.light, 0.8); g.beginPath(); g.moveTo(60.6, 12.4); g.lineTo(60.8, 4.6); g.lineTo(64.6, 11.2); g.closePath(); g.fill();
    },
  },
  deer: {
    tail(g, S) {
      // short flag tail: dark top, white edge
      g.fillStyle = S.coat; g.beginPath(); spline(g, [[23, 55], [18, 57], [16, 63], [18, 66], [21, 62], [24, 58]]); g.fill();
      g.fillStyle = S.light; g.beginPath(); spline(g, [[19, 58], [17, 63], [18.5, 65.5], [20.5, 62]]); g.fill();
      g.fillStyle = S.dark; g.beginPath(); g.ellipse(20, 56.5, 3, 1.6, -0.5, 0, TAU); g.fill();
    },
    body(g, S, rand, doe) {
      coatBody(g, S, S.body, [18, 28, 84, 72], (g) => {
        // dark dorsal line
        g.strokeStyle = A(S.dark, 0.75); g.lineWidth = 3;
        g.beginPath(); spline(g, [[24, 56], [36, 56.4], [48, 58], [60, 54], [66, 48], [74, 40]], false); g.stroke();
        // white rump patch
        g.fillStyle = S.light; g.beginPath(); g.ellipse(21, 62, 5.5, 7.5, 0.15, 0, TAU); g.fill();
        // pale belly, inner thigh, throat
        g.fillStyle = S.belly; g.beginPath(); spline(g, [[40, 67], [52, 66.5], [66, 67], [72, 70], [60, 74], [42, 73]]); g.fill();
        g.fillStyle = A(S.light, 0.9); g.beginPath(); spline(g, [[80, 39], [85, 42], [83, 49], [79, 52], [78.5, 45]]); g.fill();
        g.fillStyle = A(S.belly, 0.5); g.beginPath(); g.ellipse(76, 62, 3, 6, 0.2, 0, TAU); g.fill();
        // haunch crease & shoulder blade (soft lines)
        g.strokeStyle = A(S.dark, 0.35); g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(30, 58); g.quadraticCurveTo(36, 63, 34, 70); g.stroke();
        g.beginPath(); g.moveTo(64, 56); g.quadraticCurveTo(68, 62, 66, 69); g.stroke();
        if (doe) {
          g.fillStyle = 'rgba(255,250,236,0.78)';
          const sp = [[30, 59], [35, 58.5], [40, 59.5], [45, 60], [50, 60], [55, 58.6], [60, 57], [33, 62.5], [38, 63], [43, 63.5], [48, 63.6], [53, 62.6], [58, 61]];
          for (const [x, y] of sp) { g.beginPath(); g.ellipse(x + (rand() - 0.5), y + (rand() - 0.5), 1.05, 0.85, 0, 0, TAU); g.fill(); }
        }
      }, rand, 40);
    },
    farEar(g, S) {
      g.fillStyle = mixc(S.coat, S.dark, 0.5);
      g.beginPath(); g.ellipse(79, 13.5, 3, 7.6, -0.45, 0, TAU); g.fill();
    },
    head(g, S, rand) {
      const H = [[75, 25], [77, 19.5], [83, 18.5], [88.5, 21], [94, 26], [98.2, 31], [97.6, 34.2], [93, 36.6], [87, 35], [81, 32], [76, 29.5]];
      g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, H); g.clip();
      g.fillStyle = lin(g, 0, 18, 0, 36, [[0, A(S.dark, 0.5)], [0.5, 'rgba(0,0,0,0)'], [1, A(S.light, 0.4)]]); g.fillRect(70, 10, 40, 30);
      // pale muzzle band & chin
      g.fillStyle = A(S.light, 0.85); g.beginPath(); spline(g, [[90, 32], [95, 34.5], [94, 37.5], [88, 37]]); g.fill();
      g.fillStyle = A(S.dark, 0.55); g.beginPath(); spline(g, [[86, 21.5], [92, 24.5], [96, 29], [93.5, 29], [88, 25.5]]); g.fill();
      g.fillStyle = 'rgba(255,248,230,0.28)'; g.beginPath(); g.ellipse(81, 21.5, 4.6, 2, -0.1, 0, TAU); g.fill();
      g.restore();
      g.fillStyle = S.nose; g.beginPath(); spline(g, [[95.6, 30.4], [98.6, 31.2], [98.2, 34], [95.6, 33.4]]); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); circle(g, 96.8, 31.4, 0.55); g.fill();
      g.strokeStyle = '#2a1c12'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(97, 35.2); g.quadraticCurveTo(94, 36, 91.5, 35.4); g.stroke();
      // big gentle eye with pale ring and lashes
      g.fillStyle = A(S.light, 0.85); g.beginPath(); g.ellipse(85.6, 24.6, 2.9, 2.4, 0.25, 0, TAU); g.fill();
      eyeAt(g, 85.8, 24.6, 1.9, null, 0.95);
      g.strokeStyle = '#1a1210'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(84, 23); g.lineTo(83, 22.2); g.moveTo(84.8, 22.6); g.lineTo(84.4, 21.6); g.stroke();
      g.fillStyle = '#1a1210'; g.beginPath(); g.ellipse(88.6, 27, 0.8, 0.5, 0.6, 0, TAU); g.fill(); // preorbital gland
      // near ear: big, lifted back, pale inside with dark rim
      g.save(); g.translate(78.5, 20); g.rotate(-0.95);
      g.fillStyle = S.coat; g.beginPath(); g.ellipse(0, -7.5, 3.7, 8.2, 0, 0, TAU); g.fill();
      g.fillStyle = A(S.light, 0.9); g.beginPath(); g.ellipse(0.4, -7.6, 2, 6.2, 0, 0, TAU); g.fill();
      g.strokeStyle = A(S.dark, 0.8); g.lineWidth = 0.9; g.beginPath(); g.ellipse(0, -7.5, 3.4, 7.9, 0, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
      g.restore();
    },
    antlers(g, S) {
      // graceful many-tined antlers: far one (darker, shifted) then near one
      const beam = (ox, oy, col, w) => {
        g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
        g.lineWidth = w;
        g.beginPath(); g.moveTo(81 + ox, 19 + oy); g.bezierCurveTo(79 + ox, 10 + oy, 72 + ox, 4 + oy, 72 + ox, -6 + oy); g.quadraticCurveTo(72 + ox, -14 + oy, 77 + ox, -20 + oy); g.stroke();
        g.lineWidth = w * 0.8;
        g.beginPath(); g.moveTo(80.2 + ox, 14.5 + oy); g.quadraticCurveTo(84 + ox, 11 + oy, 87 + ox, 6 + oy); g.stroke(); // brow tine
        g.beginPath(); g.moveTo(74.5 + ox, 4 + oy); g.quadraticCurveTo(79 + ox, 1 + oy, 81.5 + ox, -4.5 + oy); g.stroke();
        g.beginPath(); g.moveTo(72.2 + ox, -7 + oy); g.quadraticCurveTo(67 + ox, -10 + oy, 66 + ox, -15.5 + oy); g.stroke();
        g.lineWidth = w * 0.7;
        g.beginPath(); g.moveTo(73.5 + ox, -13 + oy); g.quadraticCurveTo(76 + ox, -16 + oy, 75.5 + ox, -21 + oy); g.stroke();
        // burr at the base
        g.fillStyle = col; g.beginPath(); g.ellipse(81 + ox, 18.6 + oy, w * 0.95, w * 0.7, 0.3, 0, TAU); g.fill();
      };
      beam(4, -1, S.antlerDark, 2.5);
      beam(0, 0, S.antler, 2.8);
      // highlight on the near beam
      g.strokeStyle = 'rgba(255,250,235,0.7)'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(79.6, 16); g.bezierCurveTo(78, 9, 72, 4, 71.4, -5); g.stroke();
    },
  },
  boar: {
    tail(g, S) {
      g.strokeStyle = S.dark; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(19, 36); g.bezierCurveTo(14, 36, 16, 41, 13, 44); g.stroke();
      g.fillStyle = S.dark; g.beginPath(); g.moveTo(13, 43); g.lineTo(10, 49); g.lineTo(13.5, 47); g.lineTo(15, 50); g.lineTo(15, 44); g.closePath(); g.fill();
    },
    body(g, S, rand) {
      coatBody(g, S, S.body, [16, 20, 74, 50], (g) => {
        g.fillStyle = A(S.dark, 0.8);
        g.beginPath(); spline(g, [[30, 30], [46, 25], [60, 21], [68, 26], [62, 32], [46, 33], [32, 36]]); g.fill();
        g.fillStyle = A(S.light, 0.45);
        g.beginPath(); spline(g, [[36, 46], [52, 45], [66, 46], [60, 52], [40, 52]]); g.fill();
        g.strokeStyle = A(S.dark, 0.4); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(26, 36); g.quadraticCurveTo(32, 41, 29, 48); g.stroke();
      }, rand, 60);
      // bristly mane standing up along the spine
      g.fillStyle = S.dark;
      g.beginPath(); tufts(g, [[30, 30], [36, 27.5], [42, 25.5], [48, 23.5], [53, 22], [58, 20.5], [63, 21.5], [67, 24]], 4, -1, rand); g.fill();
    },
    farEar(g, S) { g.fillStyle = mixc(S.coat, S.dark, 0.6); g.beginPath(); g.moveTo(68, 26); g.quadraticCurveTo(67, 17, 73, 18); g.lineTo(73, 26); g.closePath(); g.fill(); },
    head(g, S, rand) {
      const H = [[62, 28], [68, 23], [76, 26], [84, 32], [91, 38.5], [94.5, 41], [94, 46.5], [88, 47.5], [80, 48.5], [72, 47], [65, 42], [62, 35]];
      g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, H); g.clip();
      g.fillStyle = lin(g, 0, 23, 0, 48, [[0, A(S.dark, 0.7)], [0.5, 'rgba(0,0,0,0)'], [1, A(S.light, 0.35)]]); g.fillRect(55, 20, 45, 32);
      g.fillStyle = A(S.light, 0.35); g.beginPath(); g.ellipse(74, 42, 7, 4, 0.2, 0, TAU); g.fill();
      fur(g, rand, 62, 26, 92, 48, 26, [A(S.dark, 0.55), A(S.light, 0.35)], 0.55, 2.8);
      g.restore();
      // snout disc
      g.fillStyle = S.nose; g.beginPath(); g.ellipse(94.2, 43.6, 2.6, 3.8, 0.1, 0, TAU); g.fill();
      g.fillStyle = '#5a3a32'; g.beginPath(); g.ellipse(95, 42.4, 0.7, 1, 0, 0, TAU); g.ellipse(95, 45.2, 0.7, 1, 0, 0, TAU); g.fill();
      // tusk
      g.fillStyle = S.tusk; g.beginPath(); g.moveTo(85, 47); g.quadraticCurveTo(90, 46, 90, 39.5); g.quadraticCurveTo(88.5, 44, 84, 45.2); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120,100,70,0.6)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(85.5, 46.2); g.quadraticCurveTo(88.5, 45, 89.2, 41); g.stroke();
      g.strokeStyle = '#2a1e18'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(92, 47); g.quadraticCurveTo(86, 48.4, 80, 46.5); g.stroke();
      // small fierce eye under a heavy brow
      eyeAt(g, 76.6, 32.4, 1.25, null);
      g.strokeStyle = '#1e1612'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(74, 30.4); g.lineTo(79.4, 31.2); g.stroke();
      g.fillStyle = S.coat; g.beginPath(); g.moveTo(66, 26.5); g.quadraticCurveTo(63, 16, 70.5, 17); g.lineTo(71.5, 25.5); g.closePath(); g.fill();
      g.fillStyle = A(S.nose, 0.7); g.beginPath(); g.moveTo(67, 25); g.quadraticCurveTo(66, 19.5, 69.6, 19.4); g.lineTo(70, 24.6); g.closePath(); g.fill();
    },
  },
  bear: {
    tail(g, S) { g.fillStyle = mixc(S.coat, S.dark, 0.3); g.beginPath(); g.ellipse(21, 52, 4.4, 3.4, 0.3, 0, TAU); g.fill(); },
    body(g, S, rand) {
      coatBody(g, S, S.body, [20, 33, 102, 75], (g) => {
        g.fillStyle = A(S.dark, 0.55);
        g.beginPath(); spline(g, [[30, 46], [50, 43], [70, 39], [82, 34], [88, 42], [70, 48], [48, 52], [30, 54]]); g.fill();
        g.fillStyle = A(S.light, 0.32);
        g.beginPath(); g.ellipse(88, 56, 9, 12, 0.1, 0, TAU); g.fill();
        g.strokeStyle = A(S.dark, 0.45); g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(36, 54); g.quadraticCurveTo(46, 60, 42, 72); g.stroke();
        g.beginPath(); g.moveTo(84, 54); g.quadraticCurveTo(90, 62, 88, 72); g.stroke();
      }, rand, 80);
      g.fillStyle = S.coat;
      g.beginPath(); tufts(g, [[94, 72], [86, 74.5], [76, 73.5], [66, 74.5], [56, 74], [46, 74]], 3, 1, rand); g.fill();
      g.fillStyle = mixc(S.coat, S.dark, 0.3);
      g.beginPath(); tufts(g, [[64, 40], [72, 37], [80, 33.5], [88, 35.5]], 2.6, -1, rand); g.fill();
    },
    farEar(g, S) { g.fillStyle = mixc(S.coat, S.dark, 0.5); g.beginPath(); circle(g, 103, 31, 5); g.fill(); },
    head(g, S, rand) {
      const H = [[90, 42], [94, 34], [102, 31.5], [110, 34], [116, 40], [123, 44], [126.5, 48], [125.5, 53], [118, 56], [108, 57], [99, 55], [92, 50]];
      g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, H); g.clip();
      g.fillStyle = lin(g, 0, 31, 0, 57, [[0, A(S.dark, 0.5)], [0.5, 'rgba(0,0,0,0)']]); g.fillRect(85, 28, 45, 32);
      g.fillStyle = S.muzzle; g.beginPath(); spline(g, [[110, 44], [118, 42.5], [126, 46], [126, 53], [116, 56], [108, 53]]); g.fill();
      g.fillStyle = 'rgba(255,248,230,0.2)'; g.beginPath(); g.ellipse(100, 37, 6, 3, -0.2, 0, TAU); g.fill();
      fur(g, rand, 90, 32, 112, 56, 20, [A(S.dark, 0.5), A(S.light, 0.4)], 0.4, 3);
      g.restore();
      g.fillStyle = S.nose; g.beginPath(); spline(g, [[122.5, 44.5], [126.6, 45.2], [127, 48.8], [123.4, 48.6]]); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); circle(g, 124.4, 45.6, 0.7); g.fill();
      g.strokeStyle = '#2a1c12'; g.lineWidth = 1; g.beginPath(); g.moveTo(125, 52.5); g.quadraticCurveTo(119, 54.5, 113.5, 52.8); g.stroke();
      eyeAt(g, 108.6, 40.6, 1.5, null);
      g.strokeStyle = A(S.dark, 0.7); g.lineWidth = 1; g.beginPath(); g.moveTo(106, 38.6); g.lineTo(111, 39); g.stroke();
      g.fillStyle = S.coat; g.beginPath(); circle(g, 97.5, 33, 5.6); g.fill();
      g.fillStyle = S.dark; g.beginPath(); circle(g, 97.8, 33.4, 2.8); g.fill();
    },
  },
};

// ---------- side sprite ----------
const LEG_CACHE = new Map(); // leg parts shared between variants (cleared after addAnimals)
// all side frames of a species: static parts (body, head, tail, antlers) are painted once and stacked with
// per-frame leg parts (keeps the atlas build fast)
function sideFrames(sp, variant) {
  const S = SPECIES[sp], D = SIDE[sp];
  const W = S.W, H = S.H;
  const rand = rng(sp.length * 1000 + (variant ? 3 : 0));
  const canid = sp === 'wolf' || sp === 'fox';
  const HL = (P, fn, ow) => L(P, S, (g) => { if (S.hd) g.translate(S.hd[0], S.hd[1]); fn(g); }, ow);
  // far legs (frame) → tail (canids, behind) + body → near legs (frame, in front: haunch & shoulder) → tail/ears/head
  const body = part(W, H, (P) => {
    if (canid) L(P, S, (g) => D.tail(g, S, rand), S.ow * 0.9);
    // boar/bear tails sit behind the rump: same layer as the body
    L(P, S, (g) => { if (sp === 'boar' || sp === 'bear') D.tail(g, S, rand); D.body(g, S, rand, variant === 'doe'); });
  });
  const top = part(W, H, (P) => {
    if (sp === 'deer') L(P, S, (g) => D.tail(g, S, rand), S.ow * 0.7);
    HL(P, (g) => { D.farEar(g, S); D.head(g, S, rand); });
    if (sp === 'deer' && variant !== 'doe') HL(P, (g) => D.antlers(g, S), 2.1);
  });
  const names = Object.keys(FRAMES);
  const legs = names.map((name) => {
    const fr = FRAMES[name];
    return [legPts(S, 'front', fr[0], false), legPts(S, 'hind', fr[1], false), legPts(S, 'front', fr[2], true), legPts(S, 'hind', fr[3], true)];
  });
  // every frame's legs painted in one strip per depth (one outline pass)
  const each = (fn) => (g, dx) => legs.forEach((l, i) => { g.save(); g.translate(i * dx, 0); fn(g, l); g.restore(); });
  const farFn = each((g, [, , ff, fh]) => { drawLeg(g, S, ff, true, 'front', rand); drawLeg(g, S, fh, true, 'hind', rand); });
  const nearFn = each((g, [nf, nh]) => { drawLeg(g, S, nh, false, 'hind', rand); drawLeg(g, S, nf, false, 'front', rand); });
  let far = LEG_CACHE.get(sp + 'far'), near = LEG_CACHE.get(sp + 'near');
  if (!far) {
    // legs only live in a band near the ground: paint them in smaller canvases
    const ly0 = S.oy + Math.min(S.legs.front.y - S.legs.front.w0 * 0.6, S.legs.hind.y - S.legs.hind.w0 * 0.6) - 6, ly1 = S.oy + S.foot + 5;
    far = strip(W, H, names.length, (P, dx) => L(P, S, (g) => farFn(g, dx), S.ow * 0.85), ly0, ly1);
    near = strip(W, H, names.length, (P, dx) => L(P, S, (g) => nearFn(g, dx), S.ow * 0.72), ly0, ly1);
    LEG_CACHE.set(sp + 'far', far); LEG_CACHE.set(sp + 'near', near);
  }
  const out = {};
  names.forEach((name, i) => { out[name] = stack([far[i], body, near[i], top]); });
  return out;
}

// ---------- rabbit (own side painter: sits / hops) ----------
function rabbitSide(frame) {
  const S = SPECIES.rabbit;
  const rand = rng(4242 + frame.length);
  // frame: 'e' sit, 'e_walk' stretched hop, 'e_w1' gathered
  const st = frame === 'e_walk' ? 1 : frame === 'e_w1' ? 2 : 0;
  return spritePx(S.W, S.H, (g, P) => {
    const tilt = st === 1 ? -0.16 : st === 2 ? 0.12 : 0;
    const bx = st === 1 ? 2 : 0;
    const rot = (g) => { g.translate(26, 28); g.rotate(tilt); g.translate(-26 + bx, -28); };
    // far legs
    L(P, S, (g) => {
      g.fillStyle = mixc(S.coat, S.dark, 0.5);
      if (st === 1) { g.beginPath(); g.ellipse(11, 35, 7, 2.2, 0.35, 0, TAU); g.fill(); g.beginPath(); g.ellipse(39, 35, 3.6, 1.8, -0.4, 0, TAU); g.fill(); }
      else { g.beginPath(); g.ellipse(21, 36.6, 6.6, 2, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(33.5, 36, 2, 2.6, 0, 0, TAU); g.fill(); }
    }, 1.8);
    // body + haunch
    L(P, S, (g) => {
      rot(g);
      const B = [[10, 30], [12, 23], [18, 18.5], [27, 17.5], [33, 21], [35, 28], [32, 34], [24, 37], [15, 37], [10, 34]];
      g.beginPath(); spline(g, B); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, B); g.clip();
      g.fillStyle = lin(g, 0, 17, 0, 37, [[0, A(S.dark, 0.5)], [0.4, 'rgba(0,0,0,0)'], [1, A(S.light, 0.5)]]); g.fillRect(0, 10, 50, 40);
      g.fillStyle = A(S.light, 0.8); g.beginPath(); g.ellipse(31, 31, 4, 5.5, 0.2, 0, TAU); g.fill();
      fur(g, rand, 10, 17, 35, 37, 22, [A(S.dark, 0.45), A(S.light, 0.4)], Math.PI * 0.6, 2.4);
      g.restore();
    }, S.ow);
    // tail puff
    L(P, S, (g) => { rot(g); g.fillStyle = S.light; g.beginPath(); circle(g, 9.6, 27, 3.6); circle(g, 8, 25, 2.4); g.fill(); g.fillStyle = 'rgba(160,150,140,0.4)'; g.beginPath(); circle(g, 10.4, 28.6, 1.8); g.fill(); }, 1.6);
    // near hind leg (big haunch + long foot) and front paw
    L(P, S, (g) => {
      g.fillStyle = S.coat;
      if (st === 1) {
        g.save(); g.translate(16, 30); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, 7.5, 6, 0, 0, TAU); g.fill(); g.restore();
        g.beginPath(); g.ellipse(7, 33.8, 7, 2.3, 0.4, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(39.5, 33.5, 4.2, 2, -0.5, 0, TAU); g.fill();
      } else {
        const hx = st === 2 ? 20 : 18;
        g.beginPath(); g.ellipse(hx, 30, 7.4, 6.6, -0.2, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(hx + 2.5, 36.6, 7.6, 2.1, 0, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(31.5, 34.5, 2.2, 3.4, 0.05, 0, TAU); g.fill();
        g.fillStyle = A(S.light, 0.5); g.beginPath(); g.ellipse(hx - 1.4, 27.5, 3.4, 2.4, -0.5, 0, TAU); g.fill();
      }
    }, 2);
    // head + ears
    L(P, S, (g) => {
      rot(g);
      const hx = 36, hy = 18;
      g.fillStyle = mixc(S.coat, S.dark, 0.35); g.beginPath(); g.ellipse(hx - 6, hy - 9, 2.4, 7.6, -0.42, 0, TAU); g.fill();
      const H = [[29, 18], [31, 12.5], [37, 11.5], [42, 15], [44.5, 19.5], [43, 22.5], [37, 24], [31, 23]];
      g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
      g.save(); g.beginPath(); spline(g, H); g.clip();
      g.fillStyle = lin(g, 0, 11, 0, 24, [[0, A(S.dark, 0.4)], [0.5, 'rgba(0,0,0,0)'], [1, A(S.light, 0.6)]]); g.fillRect(25, 8, 25, 20);
      g.fillStyle = A(S.light, 0.8); g.beginPath(); g.ellipse(41, 21, 3.6, 2.4, 0.2, 0, TAU); g.fill();
      g.restore();
      eyeAt(g, 37.4, 16.2, 1.45, null, 1.05);
      g.fillStyle = S.nose; g.beginPath(); g.ellipse(44.2, 19, 1.1, 0.9, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.4;
      g.beginPath(); g.moveTo(42.5, 20.5); g.lineTo(47.5, 19.5); g.moveTo(42.5, 21); g.lineTo(47.5, 22); g.stroke();
      // near ear
      g.save(); g.translate(32.5, 13); g.rotate(-0.28 + (st === 1 ? -0.35 : 0));
      g.fillStyle = S.coat; g.beginPath(); g.ellipse(0, -8, 2.8, 8.5, 0, 0, TAU); g.fill();
      g.fillStyle = S.earIn; g.beginPath(); g.ellipse(0.3, -8, 1.3, 6.4, 0, 0, TAU); g.fill();
      g.fillStyle = A(S.dark, 0.7); g.beginPath(); g.ellipse(0, -15.4, 1.8, 1.4, 0, 0, TAU); g.fill();
      g.restore();
    }, S.ow);
  });
}

// ---------- front / back views (generic quadruped builder) ----------
// F: { W, H, oy, foot, depth, front:{x, top, w0, w1, knee}, hind:{x, top, w0, w1}, barrel:{y, rx, ry}, chest:{y, rx, ry}, neck?:{...} }
const FRONT = {
  wolf: { W: 64, H: 90, oy: 10, foot: 74, depth: 5, front: { x: 7, top: 50, w0: 7, w1: 4.6 }, hind: { x: 11.5, top: 48, w0: 7, w1: 4.2 }, barrel: { y: 42, rx: 15, ry: 11 }, chest: { y: 48, rx: 12, ry: 10 }, head: { y: 29, r: 11.5 }, rump: { y: 50, rx: 11, ry: 9.5 }, backHead: 25 },
  fox: { W: 54, H: 64, oy: 8, foot: 53, depth: 4, front: { x: 5.2, top: 38, w0: 5, w1: 3.2 }, hind: { x: 9, top: 36, w0: 5.4, w1: 3 }, barrel: { y: 33, rx: 11, ry: 8.5 }, chest: { y: 37, rx: 9, ry: 7.5 }, head: { y: 22, r: 9 }, rump: { y: 39, rx: 8.5, ry: 7.5 }, backHead: 18 },
  deer: { W: 72, H: 128, oy: 24, foot: 100, depth: 5, front: { x: 6.4, top: 70, w0: 5.4, w1: 3.1 }, hind: { x: 10.5, top: 66, w0: 5, w1: 3 }, barrel: { y: 62, rx: 14.5, ry: 12 }, chest: { y: 68, rx: 10.5, ry: 9.5 }, neck: { y0: 66, y1: 41, w0: 13, w1: 9 }, head: { y: 33, r: 8.5 }, rump: { y: 67, rx: 11, ry: 10 }, backHead: 31 },
  boar: { W: 66, H: 70, oy: 6, foot: 59, depth: 4, front: { x: 8.5, top: 48, w0: 7, w1: 4.6 }, hind: { x: 13, top: 44, w0: 7, w1: 4.4 }, barrel: { y: 37, rx: 19, ry: 14 }, chest: { y: 44, rx: 15, ry: 11 }, head: { y: 38, r: 13 }, rump: { y: 45, rx: 15.5, ry: 11.5 }, backHead: 26 },
  bear: { W: 92, H: 104, oy: 6, foot: 92, depth: 7, front: { x: 15, top: 66, w0: 15, w1: 13 }, hind: { x: 22, top: 62, w0: 15, w1: 12.5 }, barrel: { y: 54, rx: 30, ry: 22 }, chest: { y: 62, rx: 24, ry: 17 }, head: { y: 44, r: 18 }, rump: { y: 64, rx: 23, ry: 17 }, backHead: 30 },
  rabbit: { W: 40, H: 50, oy: 8, foot: 38, depth: 3, front: { x: 4, top: 31, w0: 4, w1: 3.4 }, hind: { x: 9, top: 30, w0: 7, w1: 6 }, barrel: { y: 27, rx: 11, ry: 9 }, chest: { y: 30, rx: 9, ry: 7.5 }, head: { y: 19, r: 7.6 }, rump: { y: 30, rx: 10, ry: 8.5 }, backHead: 17 },
};

function frontLeg(g, S, x, top, foot, w0, w1, lift, far, out, hoof) {
  const kneeY = top + (foot - top) * 0.55;
  const fy = foot - lift;
  const kx = x + out * (lift ? 1.6 : 0.4);
  const pts = [[x, top, w0], [kx, kneeY - lift * 0.5, w0 * 0.82], [x + out * 0.2, fy, w1]];
  g.beginPath(); limbPath(g, pts);
  g.fillStyle = far ? mixc(S.coat, S.dark, 0.5) : S.coat; g.fill();
  g.save(); g.beginPath(); limbPath(g, pts); g.clip();
  if (S.sock) { g.fillStyle = far ? mixc(S.sock, '#000', 0.2) : S.sock; g.fillRect(x - 10, kneeY - 2, 20, 60); }
  else { g.fillStyle = lin(g, 0, kneeY - 4, 0, fy, [[0, 'rgba(0,0,0,0)'], [1, A(S.dark, 0.45)]]); g.fillRect(x - 12, kneeY - 4, 24, 60); }
  if (!far) { g.fillStyle = 'rgba(255,246,226,0.22)'; g.fillRect(x - w0 / 2, top, w0 * 0.3, foot - top); }
  g.restore();
  const pw = w1 * 1.1;
  if (hoof) {
    g.fillStyle = far ? mixc(S.paw, '#000', 0.25) : S.paw;
    g.beginPath(); g.moveTo(x - pw * 0.55, fy - 0.5); g.lineTo(x + pw * 0.55, fy - 0.5); g.lineTo(x + pw * 0.62, fy + S.hoofH); g.lineTo(x - pw * 0.62, fy + S.hoofH); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, fy); g.lineTo(x, fy + S.hoofH); g.stroke();
  } else {
    g.fillStyle = far ? mixc(S.paw, S.dark, 0.4) : mixc(S.coat, S.paw, S.sock ? 0.9 : 0.55);
    g.beginPath(); g.ellipse(x + out * 0.2, fy - pw * 0.25, pw * 0.62, pw * 0.42, 0, 0, TAU); g.fill();
    if (S === SPECIES.bear) { g.fillStyle = '#e8dccb'; for (let i = -1; i <= 1; i++) { g.beginPath(); g.ellipse(x + i * pw * 0.32, fy + 0.6, 0.9, 1.6, 0, 0, TAU); g.fill(); } }
    else { g.strokeStyle = 'rgba(20,14,10,0.45)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x - pw * 0.15, fy - pw * 0.5); g.lineTo(x - pw * 0.15, fy); g.moveTo(x + pw * 0.2, fy - pw * 0.5); g.lineTo(x + pw * 0.2, fy); g.stroke(); }
  }
}

function frontHead(g, sp, S, cx, hy, r, rand) {
  if (sp === 'wolf' || sp === 'fox') {
    const fox = sp === 'fox';
    const eh = fox ? 11 : 9.5;
    // ears
    for (const s of [-1, 1]) {
      g.fillStyle = fox ? '#2a201a' : S.coat;
      g.beginPath(); g.moveTo(cx + s * r * 0.2, hy - r * 0.6); g.lineTo(cx + s * r * 0.85, hy - r - eh); g.lineTo(cx + s * r * 1.02, hy - r * 0.2); g.closePath(); g.fill();
      g.fillStyle = fox ? A(S.light, 0.85) : mixc(S.dark, '#2a201a', 0.4);
      g.beginPath(); g.moveTo(cx + s * r * 0.38, hy - r * 0.6); g.lineTo(cx + s * r * 0.82, hy - r - eh + 4); g.lineTo(cx + s * r * 0.88, hy - r * 0.4); g.closePath(); g.fill();
    }
    const H = [[cx - r, hy - r * 0.35], [cx - r * 0.55, hy - r * 0.92], [cx, hy - r * 1.02], [cx + r * 0.55, hy - r * 0.92], [cx + r, hy - r * 0.35], [cx + r * 1.02, hy + r * 0.25], [cx + r * 0.5, hy + r * 0.82], [cx, hy + r * 1.0], [cx - r * 0.5, hy + r * 0.82], [cx - r * 1.02, hy + r * 0.25]];
    g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
    g.save(); g.beginPath(); spline(g, H); g.clip();
    g.fillStyle = lin(g, 0, hy - r, 0, hy + r, [[0, A(S.dark, 0.55)], [0.4, 'rgba(0,0,0,0)']]); g.fillRect(cx - r * 2, hy - r * 2, r * 4, r * 4);
    // pale cheeks mask
    g.fillStyle = S.light;
    g.beginPath(); spline(g, [[cx - r * 1.05, hy + r * 0.05], [cx - r * 0.45, hy - r * 0.05], [cx, hy + r * 0.25], [cx + r * 0.45, hy - r * 0.05], [cx + r * 1.05, hy + r * 0.05], [cx + r * 0.6, hy + r * 0.9], [cx, hy + r * 1.1], [cx - r * 0.6, hy + r * 0.9]]); g.fill();
    g.fillStyle = A(S.dark, 0.5); g.beginPath(); g.moveTo(cx - r * 0.18, hy - r); g.lineTo(cx, hy + r * 0.15); g.lineTo(cx + r * 0.18, hy - r); g.closePath(); g.fill();
    fur(g, rand, cx - r, hy - r, cx + r, hy, 8, [A(S.dark, 0.5), A(S.light, 0.4)], Math.PI * 0.5, 2.2);
    g.restore();
    // muzzle toward the camera
    g.fillStyle = mixc(S.light, S.coat, 0.25); g.beginPath(); g.ellipse(cx, hy + r * 0.5, r * 0.36, r * 0.3, 0, 0, TAU); g.fill();
    g.fillStyle = S.nose; g.beginPath(); g.ellipse(cx, hy + r * 0.36, r * 0.2, r * 0.14, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); circle(g, cx - r * 0.07, hy + r * 0.31, r * 0.05); g.fill();
    g.strokeStyle = A(S.dark, 0.8); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(cx, hy + r * 0.48); g.lineTo(cx, hy + r * 0.62); g.moveTo(cx - r * 0.2, hy + r * 0.7); g.quadraticCurveTo(cx, hy + r * 0.8, cx + r * 0.2, hy + r * 0.7); g.stroke();
    for (const s of [-1, 1]) { eyeAt(g, cx + s * r * 0.42, hy - r * 0.08, r * 0.14, S.eye, fox ? 0.8 : 0.9); }
    return;
  }
  if (sp === 'deer') {
    // big ears out to the sides
    for (const s of [-1, 1]) {
      g.save(); g.translate(cx + s * r * 1.45, hy - r * 0.55); g.rotate(s * -0.35);
      g.fillStyle = S.coat; g.beginPath(); g.ellipse(0, 0, 8.4, 3.9, 0, 0, TAU); g.fill();
      g.fillStyle = A(S.light, 0.9); g.beginPath(); g.ellipse(s * 0.4, 0.3, 6.4, 2.2, 0, 0, TAU); g.fill();
      g.restore();
    }
    const H = [[cx - r * 0.9, hy - r * 0.6], [cx, hy - r * 1.05], [cx + r * 0.9, hy - r * 0.6], [cx + r * 0.8, hy + r * 0.3], [cx + r * 0.48, hy + r * 1.05], [cx, hy + r * 1.3], [cx - r * 0.48, hy + r * 1.05], [cx - r * 0.8, hy + r * 0.3]];
    g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
    g.save(); g.beginPath(); spline(g, H); g.clip();
    g.fillStyle = A(S.dark, 0.55); g.beginPath(); g.ellipse(cx, hy - r * 0.2, r * 0.32, r * 0.9, 0, 0, TAU); g.fill();
    g.fillStyle = A(S.light, 0.85); g.beginPath(); g.ellipse(cx, hy + r * 1.05, r * 0.55, r * 0.32, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,248,230,0.22)'; g.beginPath(); g.ellipse(cx - r * 0.4, hy - r * 0.5, r * 0.35, r * 0.25, -0.4, 0, TAU); g.fill();
    g.restore();
    g.fillStyle = S.nose; g.beginPath(); g.ellipse(cx, hy + r * 0.98, r * 0.3, r * 0.2, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); circle(g, cx - r * 0.1, hy + r * 0.92, 0.5); g.fill();
    for (const s of [-1, 1]) { g.fillStyle = A(S.light, 0.85); g.beginPath(); g.ellipse(cx + s * r * 0.55, hy - r * 0.1, 2.4, 2.6, 0, 0, TAU); g.fill(); eyeAt(g, cx + s * r * 0.56, hy - r * 0.1, 1.6, null, 1); }
    return;
  }
  if (sp === 'boar') {
    for (const s of [-1, 1]) {
      g.fillStyle = S.coat; g.beginPath(); g.ellipse(cx + s * r * 0.85, hy - r * 0.78, 4.4, 5.6, s * 0.7, 0, TAU); g.fill();
      g.fillStyle = A(S.nose, 0.7); g.beginPath(); g.ellipse(cx + s * r * 0.85, hy - r * 0.72, 2.2, 3.4, s * 0.7, 0, TAU); g.fill();
    }
    const H = [[cx - r, hy - r * 0.4], [cx - r * 0.5, hy - r * 0.95], [cx + r * 0.5, hy - r * 0.95], [cx + r, hy - r * 0.4], [cx + r * 0.85, hy + r * 0.5], [cx + r * 0.4, hy + r * 0.95], [cx - r * 0.4, hy + r * 0.95], [cx - r * 0.85, hy + r * 0.5]];
    g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
    g.save(); g.beginPath(); spline(g, H); g.clip();
    g.fillStyle = lin(g, 0, hy - r, 0, hy + r, [[0, A(S.dark, 0.75)], [0.5, 'rgba(0,0,0,0)']]); g.fillRect(cx - r * 2, hy - r * 2, r * 4, r * 4);
    fur(g, rand, cx - r, hy - r, cx + r, hy + r, 20, [A(S.dark, 0.55), A(S.light, 0.35)], Math.PI * 0.5, 2.6);
    g.restore();
    g.fillStyle = S.nose; g.beginPath(); g.ellipse(cx, hy + r * 0.48, r * 0.46, r * 0.34, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(cx - r * 0.12, hy + r * 0.36, r * 0.2, r * 0.08, 0, 0, TAU); g.fill();
    g.fillStyle = '#5a3a32'; g.beginPath(); g.ellipse(cx - r * 0.17, hy + r * 0.5, 1, 1.4, 0, 0, TAU); g.ellipse(cx + r * 0.17, hy + r * 0.5, 1, 1.4, 0, 0, TAU); g.fill();
    g.fillStyle = S.tusk;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * r * 0.42, hy + r * 0.78); g.quadraticCurveTo(cx + s * r * 0.95, hy + r * 0.7, cx + s * r * 0.85, hy + r * 0.1); g.quadraticCurveTo(cx + s * r * 0.75, hy + r * 0.55, cx + s * r * 0.35, hy + r * 0.62); g.closePath(); g.fill(); }
    for (const s of [-1, 1]) { eyeAt(g, cx + s * r * 0.45, hy - r * 0.12, 1.3, null); g.strokeStyle = '#1e1612'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(cx + s * r * 0.2, hy - r * 0.32); g.lineTo(cx + s * r * 0.7, hy - r * 0.22); g.stroke(); }
    return;
  }
  if (sp === 'bear') {
    for (const s of [-1, 1]) { g.fillStyle = S.coat; g.beginPath(); circle(g, cx + s * r * 0.78, hy - r * 0.72, 6); g.fill(); g.fillStyle = S.dark; g.beginPath(); circle(g, cx + s * r * 0.78, hy - r * 0.7, 3); g.fill(); }
    const H = [[cx - r, hy - r * 0.2], [cx - r * 0.6, hy - r * 0.9], [cx, hy - r * 1.0], [cx + r * 0.6, hy - r * 0.9], [cx + r, hy - r * 0.2], [cx + r * 0.85, hy + r * 0.55], [cx + r * 0.4, hy + r * 0.92], [cx - r * 0.4, hy + r * 0.92], [cx - r * 0.85, hy + r * 0.55]];
    g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
    g.save(); g.beginPath(); spline(g, H); g.clip();
    g.fillStyle = lin(g, 0, hy - r, 0, hy + r, [[0, A(S.dark, 0.5)], [0.5, 'rgba(0,0,0,0)']]); g.fillRect(cx - r * 2, hy - r * 2, r * 4, r * 4);
    fur(g, rand, cx - r, hy - r, cx + r, hy + r, 22, [A(S.dark, 0.5), A(S.light, 0.35)], Math.PI * 0.5, 3);
    g.restore();
    g.fillStyle = S.muzzle; g.beginPath(); g.ellipse(cx, hy + r * 0.4, r * 0.45, r * 0.38, 0, 0, TAU); g.fill();
    g.fillStyle = S.nose; g.beginPath(); spline(g, [[cx - r * 0.2, hy + r * 0.2], [cx + r * 0.2, hy + r * 0.2], [cx + r * 0.1, hy + r * 0.38], [cx - r * 0.1, hy + r * 0.38]]); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); circle(g, cx - r * 0.07, hy + r * 0.24, 0.8); g.fill();
    g.strokeStyle = '#2a1c12'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, hy + r * 0.38); g.lineTo(cx, hy + r * 0.56); g.moveTo(cx - r * 0.22, hy + r * 0.62); g.quadraticCurveTo(cx, hy + r * 0.72, cx + r * 0.22, hy + r * 0.62); g.stroke();
    for (const s of [-1, 1]) eyeAt(g, cx + s * r * 0.38, hy - r * 0.12, 1.6, null);
    return;
  }
  if (sp === 'rabbit') {
    for (const s of [-1, 1]) {
      g.save(); g.translate(cx + s * r * 0.4, hy - r * 0.6); g.rotate(s * 0.14);
      g.fillStyle = S.coat; g.beginPath(); g.ellipse(0, -8.5, 2.9, 9, 0, 0, TAU); g.fill();
      g.fillStyle = S.earIn; g.beginPath(); g.ellipse(0, -8.5, 1.4, 6.8, 0, 0, TAU); g.fill();
      g.restore();
    }
    const H = [[cx - r, hy], [cx - r * 0.7, hy - r * 0.75], [cx, hy - r * 0.92], [cx + r * 0.7, hy - r * 0.75], [cx + r, hy], [cx + r * 0.7, hy + r * 0.75], [cx, hy + r * 0.92], [cx - r * 0.7, hy + r * 0.75]];
    g.beginPath(); spline(g, H); g.fillStyle = S.coat; g.fill();
    g.save(); g.beginPath(); spline(g, H); g.clip();
    g.fillStyle = A(S.light, 0.85); g.beginPath(); g.ellipse(cx, hy + r * 0.55, r * 0.6, r * 0.45, 0, 0, TAU); g.fill();
    g.fillStyle = lin(g, 0, hy - r, 0, hy, [[0, A(S.dark, 0.4)], [1, 'rgba(0,0,0,0)']]); g.fillRect(cx - r, hy - r, r * 2, r);
    g.restore();
    for (const s of [-1, 1]) eyeAt(g, cx + s * r * 0.5, hy - r * 0.1, 1.5, null, 1.1);
    g.fillStyle = S.nose; g.beginPath(); g.ellipse(cx, hy + r * 0.32, 1.2, 0.9, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.4;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 2, hy + r * 0.45); g.lineTo(cx + s * 8, hy + r * 0.3); g.moveTo(cx + s * 2, hy + r * 0.55); g.lineTo(cx + s * 8, hy + r * 0.65); g.stroke(); }
  }
}

function backHead(g, sp, S, cx, hy, r) {
  g.fillStyle = mixc(S.coat, S.dark, 0.3);
  if (sp === 'wolf' || sp === 'fox') {
    const eh = sp === 'fox' ? 11 : 9.5;
    for (const s of [-1, 1]) {
      g.fillStyle = sp === 'fox' ? '#2a201a' : mixc(S.coat, S.dark, 0.3);
      g.beginPath(); g.moveTo(cx + s * r * 0.2, hy - r * 0.6); g.lineTo(cx + s * r * 0.85, hy - r - eh); g.lineTo(cx + s * r * 1.02, hy - r * 0.2); g.closePath(); g.fill();
    }
  } else if (sp === 'deer') {
    for (const s of [-1, 1]) { g.save(); g.translate(cx + s * r * 1.45, hy - r * 0.55); g.rotate(s * -0.35); g.fillStyle = mixc(S.coat, S.dark, 0.25); g.beginPath(); g.ellipse(0, 0, 8.4, 3.9, 0, 0, TAU); g.fill(); g.restore(); }
  } else if (sp === 'boar') {
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * r * 0.85, hy - r * 0.78, 4.4, 5.6, s * 0.7, 0, TAU); g.fill(); }
  } else if (sp === 'bear') {
    for (const s of [-1, 1]) { g.beginPath(); circle(g, cx + s * r * 0.78, hy - r * 0.72, 6); g.fill(); }
  } else if (sp === 'rabbit') {
    for (const s of [-1, 1]) { g.save(); g.translate(cx + s * r * 0.4, hy - r * 0.6); g.rotate(s * 0.14); g.beginPath(); g.ellipse(0, -8.5, 2.9, 9, 0, 0, TAU); g.fill(); g.restore(); }
  }
  g.fillStyle = mixc(S.coat, S.dark, 0.25);
  g.beginPath(); g.ellipse(cx, hy, r, r * 0.92, 0, 0, TAU); g.fill();
  g.fillStyle = A(S.dark, 0.45); g.beginPath(); g.ellipse(cx, hy - r * 0.15, r * 0.35, r * 0.7, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,245,225,0.16)'; g.beginPath(); g.ellipse(cx - r * 0.35, hy - r * 0.4, r * 0.4, r * 0.28, -0.4, 0, TAU); g.fill();
}

function antlersFront(g, S, cx, hy, r, col, k = 1) {
  g.lineCap = 'round'; g.strokeStyle = col;
  for (const s of [-1, 1]) {
    const t = (x0, y0, x1, y1, cx1, cy1, w) => { g.lineWidth = w * k; g.beginPath(); g.moveTo(cx + s * x0, y0); g.quadraticCurveTo(cx + s * cx1, cy1, cx + s * x1, y1); g.stroke(); };
    const y = hy - r * 0.85;
    t(3, y, 13, y - 20, 4, y - 12, 2.8);
    t(13, y - 20, 11, y - 33, 15, y - 27, 2.4);
    t(5, y - 6, 1, y - 14, 3, y - 10, 1.9);
    t(9, y - 14, 18, y - 21, 14, y - 15, 1.9);
    t(13.5, y - 24, 21, y - 30, 18, y - 25, 1.7);
    t(11.6, y - 30, 7, y - 37, 9, y - 33, 1.6);
  }
}


// view: 's' (front) or 'n' (back). Returns [stand, w1, w2] (w1/w2 = diagonal leg pairs lifted).
// Static parts (barrel, chest, head...) are painted once and stacked with per-frame leg parts.
function frontBackFrames(sp, view, variant) {
  const S = SPECIES[sp], F = FRONT[sp];
  const W = F.W, H = F.H;
  const rand = rng(sp.length * 333 + (view === 's' ? 1 : 2));
  const hoof = S.legs ? S.legs.paw === 'hoof' : false;
  const scale = sp === 'rabbit' ? 0.75 : 1;
  const lk = (v) => v * (F.foot - F.front.top) / 20 * scale;
  const cx = W / 2, foot = F.foot;
  const so = { ...S, oy: F.oy };
  const farFoot = foot - F.depth;
  const LP = (fn, ow) => part(W, H, (P) => L(P, so, fn, ow));
  // 3 leg frames (stand, left-front+right-hind lifted, mirrored) in one strip
  // (frame 2 = mirror of frame 1; leg parts are shared by deer stag & doe)
  let legN = 0;
  const LS = (fn, ow) => {
    const key = sp + view + legN++;
    let fr = LEG_CACHE.get(key);
    if (fr) return fr;
    const ly0 = F.oy + Math.min(F.front.top, F.hind.top) - 2 - Math.max(F.front.w0, F.hind.w0 * 1.25) * 0.6 - 4, ly1 = F.oy + F.foot + 5;
    fr = strip(W, H, 2, (P, dx) => L(P, so, (g) => {
      for (let f = 0; f < 2; f++) { g.save(); g.translate(f * dx, 0); fn(g, f === 1 ? 3.2 : 0, 0); g.restore(); }
    }, ow), ly0, ly1);
    fr.push(mirror(fr[1]));
    LEG_CACHE.set(key, fr);
    return fr;
  };
  const antlers = sp === 'deer' && variant !== 'doe';
  const frames = [];
  if (view === 's') {
    const back = part(W, H, (P) => {
      // tail flicking out behind (canids) + barrel in one layer
      L(P, so, (g) => {
        if (sp !== 'fox' && sp !== 'wolf') return;
        const fox = sp === 'fox', y = F.barrel.y;
        const pts = fox ? [[cx + 8, y - 4], [cx + 18, y - 10], [cx + 25, y - 4], [cx + 23, y + 4], [cx + 14, y + 2]]
          : [[cx + 8, y - 5], [cx + 15, y - 6], [cx + 20, y + 2], [cx + 18, y + 9], [cx + 12, y + 2]];
        g.beginPath(); spline(g, pts); g.fillStyle = S.coat; g.fill();
        g.save(); g.beginPath(); spline(g, pts); g.clip();
        g.fillStyle = fox ? S.light : S.dark; g.beginPath(); g.ellipse(fox ? cx + 24 : cx + 19, fox ? y : y + 7, 4, 4.5, 0, 0, TAU); g.fill();
        g.restore();
        g.strokeStyle = 'rgba(30,26,22,0.7)'; g.lineWidth = 1.2; g.beginPath(); spline(g, pts); g.stroke();
      }, S.ow * 0.85);
      // barrel (back of the body, foreshortened)
      L(P, so, (g) => {
        const B = F.barrel;
        const pts = [[cx - B.rx, B.y + 2], [cx - B.rx * 0.8, B.y - B.ry * 0.7], [cx, B.y - B.ry], [cx + B.rx * 0.8, B.y - B.ry * 0.7], [cx + B.rx, B.y + 2], [cx + B.rx * 0.7, B.y + B.ry * 0.8], [cx - B.rx * 0.7, B.y + B.ry * 0.8]];
        coatBody(g, S, pts, [cx - B.rx, B.y - B.ry, cx + B.rx, B.y + B.ry], (g) => {
          g.fillStyle = A(S.dark, 0.6); g.beginPath(); g.ellipse(cx, B.y - B.ry * 0.5, B.rx * 0.32, B.ry * 0.55, 0, 0, TAU); g.fill();
          if (variant === 'doe') { g.fillStyle = 'rgba(255,250,236,0.75)'; for (const [x, y] of [[-7, -4], [-4, -7], [4, -7], [7, -4], [-9, 0], [9, 0], [-5, -1], [5, -1]]) { g.beginPath(); g.ellipse(cx + x, B.y + y, 0.9, 0.8, 0, 0, TAU); g.fill(); } }
        }, rand, 18);
        if (sp === 'boar') { g.fillStyle = S.dark; g.beginPath(); tufts(g, [[cx - 6, B.y - B.ry + 1], [cx - 2, B.y - B.ry - 0.5], [cx + 2, B.y - B.ry - 0.5], [cx + 6, B.y - B.ry + 1]], 3.5, -1, rand); g.fill(); }
      });
    });
    const front = part(W, H, (P) => {
      L(P, so, (g) => {
        const C = F.chest;
        const pts = [[cx - C.rx, C.y - 1], [cx - C.rx * 0.7, C.y - C.ry * 0.85], [cx, C.y - C.ry], [cx + C.rx * 0.7, C.y - C.ry * 0.85], [cx + C.rx, C.y - 1], [cx + C.rx * 0.65, C.y + C.ry * 0.85], [cx, C.y + C.ry], [cx - C.rx * 0.65, C.y + C.ry * 0.85]];
        coatBody(g, S, pts, [cx - C.rx, C.y - C.ry, cx + C.rx, C.y + C.ry], (g) => {
          if (sp !== 'boar' && sp !== 'bear') { g.fillStyle = A(S.light, sp === 'deer' ? 0.6 : 0.9); g.beginPath(); g.ellipse(cx, C.y + C.ry * 0.1, C.rx * 0.5, C.ry * 0.85, 0, 0, TAU); g.fill(); }
          else { g.fillStyle = A(S.light, 0.3); g.beginPath(); g.ellipse(cx, C.y + C.ry * 0.2, C.rx * 0.5, C.ry * 0.7, 0, 0, TAU); g.fill(); }
        }, rand, 14);
        if (sp === 'wolf' || sp === 'fox') { g.fillStyle = S.light; g.beginPath(); tufts(g, [[cx - C.rx * 0.5, C.y + C.ry * 0.7], [cx - C.rx * 0.2, C.y + C.ry * 0.95], [cx + C.rx * 0.2, C.y + C.ry * 0.95], [cx + C.rx * 0.5, C.y + C.ry * 0.7]], 2.4, 1, rand); g.fill(); }
        if (F.neck) {
          const N = F.neck;
          const np = [[cx - N.w0 / 2, N.y0], [cx - N.w1 / 2, N.y1], [cx + N.w1 / 2, N.y1], [cx + N.w0 / 2, N.y0]];
          g.beginPath(); spline(g, np, true, 0.6); g.fillStyle = S.coat; g.fill();
          g.save(); g.beginPath(); spline(g, np, true, 0.6); g.clip();
          g.fillStyle = A(S.light, 0.9); g.beginPath(); g.ellipse(cx, N.y1 + 8, N.w1 * 0.35, 4.5, 0, 0, TAU); g.fill();
          g.fillStyle = A(S.dark, 0.25); g.fillRect(cx + N.w1 * 0.25, N.y1, N.w0, N.y0 - N.y1);
          g.restore();
        }
      });
      if (antlers) L(P, so, (g) => { antlersFront(g, S, cx, F.head.y, F.head.r, S.antlerDark, 1.05); antlersFront(g, S, cx, F.head.y, F.head.r, S.antler, 0.75); }, 2.1);
      L(P, so, (g) => frontHead(g, sp, S, cx, F.head.y, F.head.r, rand));
    });
    const far = LS((g, lf, rf) => {
      frontLeg(g, S, cx - F.hind.x, F.hind.top, farFoot, F.hind.w0, F.hind.w1, lk(rf), true, -1, hoof);
      frontLeg(g, S, cx + F.hind.x, F.hind.top, farFoot, F.hind.w0, F.hind.w1, lk(lf), true, 1, hoof);
    }, S.ow * 0.85);
    const near = LS((g, lf, rf) => {
      frontLeg(g, S, cx - F.front.x, F.front.top, foot, F.front.w0, F.front.w1, lk(lf), false, -1, hoof);
      frontLeg(g, S, cx + F.front.x, F.front.top, foot, F.front.w0, F.front.w1, lk(rf), false, 1, hoof);
    }, S.ow * 0.9);
    for (let f = 0; f < 3; f++) frames.push(stack([far[f], back, near[f], front]));
    return frames;
  }
  // back view: head (far, top), far front legs, barrel, near hind legs, rump + tail
  const head = part(W, H, (P) => {
    if (antlers) L(P, so, (g) => antlersFront(g, S, cx, F.backHead, F.head.r, mixc(S.antler, S.antlerDark, 0.5), 1), 2.1);
    L(P, so, (g) => {
      backHead(g, sp, S, cx, F.backHead, F.head.r * 0.92);
      if (F.neck) { g.fillStyle = mixc(S.coat, S.dark, 0.3); g.beginPath(); spline(g, [[cx - F.neck.w0 / 2, F.neck.y0], [cx - F.neck.w1 / 2, F.neck.y1], [cx + F.neck.w1 / 2, F.neck.y1], [cx + F.neck.w0 / 2, F.neck.y0]], true, 0.6); g.fill(); }
    }, S.ow * 0.9);
  });
  const barrel = LP((g) => {
    const B = F.barrel;
    const pts = [[cx - B.rx, B.y], [cx - B.rx * 0.75, B.y - B.ry * 0.8], [cx, B.y - B.ry], [cx + B.rx * 0.75, B.y - B.ry * 0.8], [cx + B.rx, B.y], [cx + B.rx * 0.8, B.y + B.ry * 0.7], [cx - B.rx * 0.8, B.y + B.ry * 0.7]];
    coatBody(g, S, pts, [cx - B.rx, B.y - B.ry, cx + B.rx, B.y + B.ry], (g) => {
      g.fillStyle = A(S.dark, 0.65); g.beginPath(); g.ellipse(cx, B.y - B.ry * 0.1, B.rx * 0.28, B.ry * 0.95, 0, 0, TAU); g.fill();
      if (variant === 'doe') { g.fillStyle = 'rgba(255,250,236,0.75)'; for (const [x, y] of [[-7, -2], [-5, -6], [5, -6], [7, -2], [-9, 2], [9, 2]]) { g.beginPath(); g.ellipse(cx + x, B.y + y, 0.9, 0.8, 0, 0, TAU); g.fill(); } }
    }, rand, 20);
    if (sp === 'boar') { g.fillStyle = S.dark; g.beginPath(); tufts(g, [[cx - 5, B.y - B.ry + 1], [cx - 1.5, B.y - B.ry - 0.5], [cx + 2, B.y - B.ry - 0.5], [cx + 5.5, B.y - B.ry + 1]], 3.5, -1, rand); g.fill(); }
  });
  const rump = part(W, H, (P) => {
    L(P, so, (g) => {
      const C = F.rump, ry = C.ry, rx = C.rx, y = C.y;
      const pts = [[cx - rx, y], [cx - rx * 0.75, y - ry * 0.85], [cx, y - ry * 0.95], [cx + rx * 0.75, y - ry * 0.85], [cx + rx, y], [cx + rx * 0.7, y + ry * 0.9], [cx, y + ry], [cx - rx * 0.7, y + ry * 0.9]];
      coatBody(g, S, pts, [cx - rx, y - ry, cx + rx, y + ry], (g) => {
        g.strokeStyle = A(S.dark, 0.5); g.lineWidth = 1.1; g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, y + ry); g.stroke();
        if (sp === 'deer') { g.fillStyle = S.light; g.beginPath(); spline(g, [[cx, y - ry * 0.45], [cx - rx * 0.5, y - ry * 0.7], [cx - rx * 0.72, y - ry * 0.05], [cx - rx * 0.4, y + ry * 0.6], [cx, y + ry * 0.85], [cx + rx * 0.4, y + ry * 0.6], [cx + rx * 0.72, y - ry * 0.05], [cx + rx * 0.5, y - ry * 0.7]]); g.fill(); }
        if (sp === 'rabbit') { g.fillStyle = A(S.light, 0.6); g.beginPath(); g.ellipse(cx, y + ry * 0.3, rx * 0.5, ry * 0.5, 0, 0, TAU); g.fill(); }
      }, rand, 16);
    });
    // tail on top of the rump
    L(P, so, (g) => {
      const ty = F.rump.y - F.rump.ry * 0.7;
      if (sp === 'wolf') { const pts = [[cx - 3.5, ty - 1], [cx - 6, ty + 9], [cx - 3, ty + 20], [cx + 2.5, ty + 21], [cx + 5, ty + 10], [cx + 3.5, ty - 1]]; g.beginPath(); spline(g, pts); g.fillStyle = S.coat; g.fill(); g.save(); g.beginPath(); spline(g, pts); g.clip(); g.fillStyle = S.dark; g.beginPath(); g.ellipse(cx, ty + 20, 5, 4.5, 0, 0, TAU); g.fill(); g.fillStyle = A(S.light, 0.4); g.beginPath(); g.ellipse(cx - 2, ty + 8, 1.6, 5, 0.1, 0, TAU); g.fill(); g.restore(); }
      else if (sp === 'fox') { const pts = [[cx - 3, ty - 2], [cx - 9, ty + 6], [cx - 10, ty + 16], [cx - 3, ty + 20], [cx + 4, ty + 12], [cx + 3, ty]]; g.beginPath(); spline(g, pts); g.fillStyle = S.coat; g.fill(); g.save(); g.beginPath(); spline(g, pts); g.clip(); g.fillStyle = S.light; g.beginPath(); g.ellipse(cx - 5, ty + 18, 5, 4.5, 0, 0, TAU); g.fill(); g.restore(); }
      else if (sp === 'deer') { g.fillStyle = S.coat; g.beginPath(); spline(g, [[cx - 2.4, ty], [cx - 3.4, ty + 6], [cx, ty + 10], [cx + 3.4, ty + 6], [cx + 2.4, ty]]); g.fill(); g.fillStyle = S.dark; g.beginPath(); g.ellipse(cx, ty + 2.5, 1.6, 3.2, 0, 0, TAU); g.fill(); }
      else if (sp === 'boar') { g.strokeStyle = S.dark; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, ty); g.quadraticCurveTo(cx + 3, ty + 5, cx + 1, ty + 10); g.stroke(); g.fillStyle = S.dark; g.beginPath(); g.ellipse(cx + 1, ty + 11, 1.6, 2.4, 0, 0, TAU); g.fill(); }
      else if (sp === 'rabbit') { g.fillStyle = S.light; for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; g.beginPath(); circle(g, cx + Math.cos(a) * 2.2, ty + 4 + Math.sin(a) * 2, 2.4); g.fill(); } }
      else { g.fillStyle = mixc(S.coat, S.dark, 0.3); g.beginPath(); g.ellipse(cx, ty + 3, 4, 3.2, 0, 0, TAU); g.fill(); }
    }, sp === 'wolf' || sp === 'fox' ? S.ow * 0.85 : 1.6);
  });
  const far = LS((g, lf, rf) => {
    frontLeg(g, S, cx - F.front.x, F.front.top - 2, farFoot, F.front.w0, F.front.w1, lk(lf), true, -1, hoof);
    frontLeg(g, S, cx + F.front.x, F.front.top - 2, farFoot, F.front.w0, F.front.w1, lk(rf), true, 1, hoof);
  }, S.ow * 0.85);
  const near = LS((g, lf, rf) => {
    for (const s of [-1, 1]) frontLeg(g, S, cx + s * F.hind.x * 0.85, F.hind.top + 2, foot, F.hind.w0 * 1.25, F.hind.w1, lk(s < 0 ? rf : lf), false, s, hoof);
  }, S.ow * 0.9);
  for (let f = 0; f < 3; f++) frames.push(stack([head, far[f], barrel, near[f], rump]));
  return frames;
}

// ---------- grazing frame (animation pass): the stand frame with neck + head bent down ----------
// Region R (design coords, before oy) rotates by `ang` around the withers `pv`; the rest of the frame
// (body, legs) stays. Cheap canvas surgery on the finished frame: no new painting, same look.
const GRAZE = {
  wolf: { pv: [63, 34], ang: 0.5, R: [[60, -30], [140, -30], [140, 62], [80, 62], [73, 47], [61, 45]] },
  fox: { pv: [52, 28], ang: 0.5, R: [[49, -30], [120, -30], [120, 52], [66, 52], [61, 39], [51, 37]] },
  boar: { pv: [60, 26], ang: 0.34, R: [[57, -30], [130, -30], [130, 62], [73, 62], [69, 45], [59, 41]] },
  deer: { pv: [63, 55], ang: 1.15, R: [[59, -60], [150, -60], [150, 86], [82, 86], [75, 61], [61, 59]], E: [[52, 10], [60, 10], [60, 50.5], [56, 50.5], [52, 51.8]] },
  bear: { pv: [84, 40], ang: 0.3, R: [[80, -30], [170, -30], [170, 72], [104, 72], [98, 55], [82, 51]] },
};
function bendFrame(c, S, G) {
  const out = canvas(c.width + 44, c.height + 34); // room for the lowered head (cropped later)
  const g = out.getContext('2d');
  const ox = c.origin.x, oy = c.origin.y + S.oy; // design → canvas px
  const path = (gg) => { gg.beginPath(); G.R.forEach(([x, y], i) => (i ? gg.lineTo(x + ox, y + oy) : gg.moveTo(x + ox, y + oy))); gg.closePath(); };
  // everything outside R stays put
  g.save(); g.beginPath(); g.rect(0, 0, c.width, c.height); G.R.slice().reverse().forEach(([x, y], i) => (i ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy))); g.closePath(); g.clip('evenodd'); g.drawImage(c, 0, 0); g.restore();
  // R rotated about the withers (clip in the rotated frame so the region moves with the head)
  const px = G.pv[0] + ox, py = G.pv[1] + oy;
  g.save(); g.translate(px, py); g.rotate(G.ang); g.translate(-px, -py); path(g); g.clip(); g.drawImage(c, 0, 0); g.restore();
  // E: leftover of the upright neck above the back line (erased)
  if (G.E) { g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); G.E.forEach(([x, y], i) => (i ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy))); g.closePath(); g.fill(); g.restore(); }
  out.origW = c.origW; out.origH = c.origH; out.origin = c.origin; out.needsCrop = true;
  return out;
}

export function addAnimals(add) {
  for (const sp of ['wolf', 'boar', 'deer', 'rabbit', 'bear', 'fox']) {
    const S = SPECIES[sp], F = FRONT[sp];
    const variants = sp === 'deer' ? [['deer', null], ['deer_doe', 'doe']] : [[sp, null]];
    for (const [name, variant] of variants) {
      const ay = (S.foot + S.oy) / S.H;
      if (sp === 'rabbit') {
        for (const fr of ['e', 'e_walk', 'e_w1']) add(`${name}_${fr}`, rabbitSide(fr), 0.5, ay);
      } else {
        const fr = sideFrames(sp, variant);
        for (const k of Object.keys(fr)) add(`${name}_${k}`, fr[k], 0.5, ay);
        if (GRAZE[sp]) add(`${name}_e_graze`, bendFrame(fr.e, S, GRAZE[sp]), 0.5, ay);
      }
      const fay = (F.foot + F.oy) / F.H;
      const fs = frontBackFrames(sp, 's', variant), fn = frontBackFrames(sp, 'n', variant);
      add(`${name}_s`, fs[0], 0.5, fay);
      add(`${name}_n`, fn[0], 0.5, fay);
      if (sp !== 'rabbit') for (const k of [1, 2]) {
        add(`${name}_s_w${k}`, fs[k], 0.5, fay);
        add(`${name}_n_w${k}`, fn[k], 0.5, fay);
      }
    }
  }
  LEG_CACHE.clear();
}
export const ANIMAL_SPECIES = ['wolf', 'boar', 'deer', 'rabbit', 'bear', 'fox', 'spider'];
