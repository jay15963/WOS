// Cave spider: big, hairy, eight jointed legs with banding, bulbous abdomen with pale chevrons, cluster of
// glossy red eyes and dark fangs. Sprites: spider_{e,s,n} + gait frames like the quadrupeds
// (_e_walk, _e_w1.._e_w3, _s_w1/_s_w2, _n_w1/_n_w2) and spider_dead (on its back, legs curled).

import { rng, TAU, lin, rad, circle, mixc, rgb, hex } from './paint.js';
import { spline, limbPath, fur, tufts, part, stack, mirror } from './kit.js';

const C = {
  body: '#2f2622', mid: '#4b3b31', hair: '#8c7660', band: '#b49a78', mark: '#d9c9a6', mark2: '#c06a2a',
  eye: '#ff4636', fang: '#16100d', fangTip: '#c9b79a',
};
const A = (c, a) => rgb(hex(c), a);
const OWS = 2.8;

// eye glints for compose.js (tiles, relative to the sprite anchor, facing east / south)
export const SPIDER_EYES = { e: [[0.43, -0.62], [0.47, -0.6]], s: [[-0.06, -0.58], [0.06, -0.58]] };

// one jointed spider leg: attachment → knee (high) → ankle → foot; hairy, banded
function leg(g, pts, far, rand) {
  const col = far ? mixc(C.body, '#000', 0.25) : C.mid;
  g.beginPath(); limbPath(g, pts); g.fillStyle = col; g.fill();
  g.save(); g.beginPath(); limbPath(g, pts); g.clip();
  g.fillStyle = A(C.body, 0.7);
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i]; g.beginPath(); circle(g, p[0], p[1], p[2] * 0.9); g.fill(); }
  if (!far) {
    // pale bands just past each joint + glossy highlight along the top
    g.strokeStyle = A(C.band, 0.55); g.lineWidth = 1.4;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const t = 0.22, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
      const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy) || 1;
      g.beginPath(); g.moveTo(x - dy / d * p[2], y + dx / d * p[2]); g.lineTo(x + dy / d * p[2], y - dx / d * p[2]); g.stroke();
    }
    g.strokeStyle = 'rgba(255,240,220,0.22)'; g.lineWidth = 0.9;
    g.beginPath(); for (let i = 0; i < pts.length; i++) { const p = pts[i]; i ? g.lineTo(p[0] - 0.4, p[1] - p[2] * 0.3) : g.moveTo(p[0] - 0.4, p[1] - p[2] * 0.3); } g.stroke();
  }
  g.restore();
  // bristles
  g.strokeStyle = far ? A(C.body, 0.9) : A(C.hair, 0.75); g.lineWidth = 0.7;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    for (let k = 0; k < 3; k++) {
      const t = (k + 0.5) / 3, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
      const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy) || 1;
      const s = (rand() < 0.5 ? -1 : 1), w = (p[2] * 0.5 + 1.2);
      g.beginPath(); g.moveTo(x + dy / d * s * p[2] * 0.4, y - dx / d * s * p[2] * 0.4); g.lineTo(x + dy / d * s * w + dx / d * 1.2, y - dx / d * s * w + dy / d * 1.2); g.stroke();
    }
  }
}

// a leg from (ax, ay) to foot (fx, fy) with a high knee; lift raises the foot (walk cycle)
function legPts(ax, ay, fx, fy, kh, w, lift = 0) {
  const kx = ax + (fx - ax) * 0.42, ky = Math.min(ay, fy) - kh - lift * 0.5;
  const nx = ax + (fx - ax) * 0.86, ny = fy - lift - (fy - ky) * 0.28;
  return [[ax, ay, w * 1.2], [kx, ky, w], [nx, ny, w * 0.72], [fx, fy - lift, w * 0.5]];
}

function abdomen(g, cx, cy, rx, ry, rand, view) {
  const pts = [];
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  g.beginPath(); spline(g, pts); g.fillStyle = C.body; g.fill();
  g.save(); g.beginPath(); spline(g, pts); g.clip();
  g.fillStyle = rad(g, cx - rx * 0.35, cy - ry * 0.4, 1, Math.max(rx, ry) * 1.2, [[0, A(C.mid, 1)], [0.55, A(C.body, 1)], [1, A('#120d0b', 1)]]);
  g.fillRect(cx - rx - 2, cy - ry - 2, rx * 2 + 4, ry * 2 + 4);
  // pale chevrons + orange heart mark
  if (view !== 's') {
    const dir = view === 'e' ? 1 : 0;
    if (dir) {
      g.fillStyle = A(C.mark2, 0.9); g.beginPath(); g.ellipse(cx + rx * 0.35, cy - ry * 0.45, rx * 0.22, ry * 0.16, -0.3, 0, TAU); g.fill();
      g.strokeStyle = A(C.mark, 0.8); g.lineWidth = 1.6;
      for (let i = 0; i < 4; i++) { const x = cx + rx * (0.05 - i * 0.24); g.beginPath(); g.moveTo(x + 3, cy - ry * 0.72 + i * 1.5); g.lineTo(x, cy - ry * 0.35 + i * 1.6); g.lineTo(x + 3.5, cy + i * 1.4); g.stroke(); }
    } else {
      g.fillStyle = A(C.mark2, 0.9); g.beginPath(); spline(g, [[cx, cy - ry * 0.7], [cx - rx * 0.22, cy - ry * 0.5], [cx, cy - ry * 0.15], [cx + rx * 0.22, cy - ry * 0.5]]); g.fill();
      g.strokeStyle = A(C.mark, 0.8); g.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) { const y = cy - ry * 0.05 + i * ry * 0.26, w = rx * (0.55 - i * 0.12); g.beginPath(); g.moveTo(cx - w, y - 2); g.lineTo(cx, y + 2.5); g.lineTo(cx + w, y - 2); g.stroke(); }
      g.fillStyle = A(C.mark, 0.6); for (const s of [-1, 1]) { g.beginPath(); circle(g, cx + s * rx * 0.55, cy - ry * 0.3, 1.4); g.fill(); }
    }
  }
  g.fillStyle = 'rgba(255,235,210,0.18)'; g.beginPath(); g.ellipse(cx - rx * 0.35, cy - ry * 0.5, rx * 0.4, ry * 0.25, -0.4, 0, TAU); g.fill();
  fur(g, rand, cx - rx, cy - ry, cx + rx, cy + ry, 38, [A('#0c0907', 0.6), A(C.hair, 0.45)], Math.PI * 0.55, 2.6, 0.4);
  g.restore();
  g.fillStyle = C.body; g.beginPath(); tufts(g, pts.slice(1, 8).map(([x, y]) => [x, y]), 1.8, 1, rand); g.fill();
}

function cephalo(g, cx, cy, rx, ry, rand) {
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fillStyle = C.body; g.fill();
  g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.clip();
  g.fillStyle = rad(g, cx - rx * 0.3, cy - ry * 0.5, 0, rx * 1.3, [[0, C.mid], [1, '#140f0c']]); g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  g.strokeStyle = A(C.mark, 0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(cx - rx * 0.6, cy - ry * 0.1); g.quadraticCurveTo(cx, cy - ry * 0.5, cx + rx * 0.6, cy - ry * 0.1); g.stroke();
  fur(g, rand, cx - rx, cy - ry, cx + rx, cy + ry, 14, [A('#0c0907', 0.6), A(C.hair, 0.4)], Math.PI * 0.5, 2, 0.4);
  g.restore();
}
function eyes(g, pts, r) {
  for (const [x, y, k] of pts) {
    g.fillStyle = '#3a0806'; g.beginPath(); circle(g, x, y, r * k + 0.5); g.fill();
    g.fillStyle = C.eye; g.beginPath(); circle(g, x, y, r * k); g.fill();
    g.fillStyle = 'rgba(255,240,220,0.95)'; g.beginPath(); circle(g, x - r * k * 0.35, y - r * k * 0.35, r * k * 0.38); g.fill();
  }
}
function fang(g, x, y, s, w = 1) {
  g.fillStyle = C.fang; g.beginPath(); g.moveTo(x - 2.4 * w, y - 2); g.quadraticCurveTo(x - 2.6 * w, y + 4, x + s * 1.5, y + 6.5); g.quadraticCurveTo(x + s * 0.2, y + 3, x + 2.2 * w, y - 2); g.closePath(); g.fill();
  g.fillStyle = C.fangTip; g.beginPath(); g.moveTo(x + s * 0.2, y + 4); g.quadraticCurveTo(x + s * 0.6, y + 6.5, x + s * 1.5, y + 6.5); g.quadraticCurveTo(x + s * 0.9, y + 4.6, x + s * 0.8, y + 3.4); g.closePath(); g.fill();
}

// ---------- side ----------
const SW = 124, SH = 84, FOOT = 70;
// near legs [attach x, foot x], far legs offset; sets for the alternating tetrapod gait
const SIDE_LEGS = [[80, 112, 0], [76, 96, 1], [70, 56, 0], [66, 30, 1]];
function sideFrames() {
  const rand = rng(9191);
  const body = part(SW, SH, (P) => {
    P.layer((g) => abdomen(g, 42, 36, 25, 18, rand, 'e'), OWS);
    P.layer((g) => cephalo(g, 76, 41, 15, 10.5, rand), OWS);
  });
  // face drawn over the near legs: palp, fang and the glossy eye cluster
  const face = part(SW, SH, (P) => P.layer((g) => {
    g.fillStyle = C.body; g.beginPath(); g.ellipse(88, 40, 6.5, 6, 0.2, 0, TAU); g.fill();
    g.fillStyle = C.mid;
    g.beginPath(); limbPath(g, [[90, 44, 3.2], [97, 41, 2.6], [100, 48, 2.2]]); g.fill();
    fang(g, 91, 47, 1, 1.1);
    eyes(g, [[89.5, 36.5, 1], [92.5, 38.2, 0.8], [86.6, 35.6, 0.75], [90.4, 40.2, 0.6]], 1.7);
  }, OWS * 0.8));
  const frames = { e: [0, 0], e_walk: [6, 0], e_w1: [0, 5], e_w2: [-6, 0], e_w3: [0, -5] };
  const out = {};
  for (const name of Object.keys(frames)) {
    const [sh, lift] = frames[name];
    const legsOf = (far) => {
      const L = [];
      SIDE_LEGS.forEach(([ax, fx, set], i) => {
        const s = (set ^ (far ? 1 : 0)) ? -1 : 1; // alternate sets (near 1&3 with far 2&4)
        const dx = sh * s, up = lift * s > 0 ? Math.abs(lift) : 0;
        const ox = far ? 3 : 0, oy = far ? -3 : 0;
        L.push(legPts(ax + ox, 43 + oy, fx + dx + ox * 0.5, FOOT + oy * 0.6, i < 2 ? 22 - i * 3 : 17 + (i - 2) * 3, far ? 3.2 : 3.6, up));
      });
      return L;
    };
    const far = part(SW, SH, (P) => P.layer((g) => { for (const p of legsOf(true)) leg(g, p, true, rand); }, OWS * 0.85));
    const near = part(SW, SH, (P) => P.layer((g) => { for (const p of legsOf(false)) leg(g, p, false, rand); }, OWS * 0.85));
    out[name] = stack([far, body, near, face]);
  }
  return out;
}

// ---------- front / back ----------
const FW = 120, FH = 88, FF = 76;
function frontFrames(view) {
  const rand = rng(view === 's' ? 717 : 818);
  const cx = FW / 2;
  // [attach dx, attach y, foot dx, foot y, knee height]
  const LEGS = view === 's'
    ? [[9, 54, 50, 76, 20], [10, 50, 44, 70, 22], [9, 47, 38, 64, 20], [8, 44, 30, 58, 18]]
    : [[8, 38, 30, 62, 18], [9, 41, 40, 68, 20], [10, 44, 46, 72, 22], [9, 47, 50, 76, 18]];
  const body = part(FW, FH, (P) => {
    if (view === 's') {
      P.layer((g) => abdomen(g, cx, 30, 21, 15, rand, 's'), OWS);
      P.layer((g) => {
        cephalo(g, cx, 49, 14, 10.5, rand);
        g.fillStyle = C.mid;
        for (const s of [-1, 1]) { g.beginPath(); limbPath(g, [[cx + s * 6, 55, 3], [cx + s * 10, 60, 2.6], [cx + s * 8, 66, 2.2]]); g.fill(); }
        fang(g, cx - 3.2, 57, 1.2, 0.9); fang(g, cx + 3.2, 57, -1.2, 0.9);
        eyes(g, [[cx - 3.4, 45.5, 1], [cx + 3.4, 45.5, 1], [cx - 7.5, 44, 0.75], [cx + 7.5, 44, 0.75], [cx - 2, 49.5, 0.6], [cx + 2, 49.5, 0.6], [cx - 6, 48.4, 0.5], [cx + 6, 48.4, 0.5]], 1.9);
      }, OWS);
    } else {
      P.layer((g) => cephalo(g, cx, 34, 13, 9.5, rand), OWS);
      P.layer((g) => abdomen(g, cx, 54, 22, 17, rand, 'n'), OWS);
    }
  });
  const frames = [];
  let mirrored = null;
  for (let f = 0; f < 3; f++) {
    if (f === 2) { frames.push(stack([mirrored[0], body, mirrored[1]])); break; } // gait frame 2 = mirror of 1
    const legs = (far) => {
      const L = [];
      for (const s of [-1, 1]) LEGS.forEach(([adx, ay, fdx, fy, kh], i) => {
        const set = (i + (s > 0 ? 1 : 0)) & 1;
        const lift = f === 0 ? 0 : (set === f - 1 ? 5 : 0);
        const isFar = view === 's' ? i >= 2 : i < 2;
        if (isFar !== far) return;
        L.push(legPts(cx + s * adx, ay, cx + s * fdx, fy, kh, isFar ? 3.1 : 3.6, lift));
      });
      return L;
    };
    const far = part(FW, FH, (P) => P.layer((g) => { for (const p of legs(true)) leg(g, p, true, rand); }, OWS * 0.85));
    const near = part(FW, FH, (P) => P.layer((g) => { for (const p of legs(false)) leg(g, p, false, rand); }, OWS * 0.85));
    frames.push(stack([far, body, near]));
    if (f === 1) mirrored = [mirror(far), mirror(near)];
  }
  return frames;
}

// ---------- dead: flipped on its back, legs curled ----------
function dead() {
  const rand = rng(4040);
  return part(SW, SH, (P) => {
    // far legs (darker) then body (belly up) then near legs curling over it
    const legsOf = (near) => {
      const out = [];
      for (let i = 0; i < 4; i++) {
        const s = near ? 1 : -1, k = i;
        const ax = 58 + k * 7, ay = 56;
        const kx = ax + (k - 1.5) * 5 + s * 2, ky = 30 + Math.abs(k - 1.5) * 3 - (near ? 0 : 2);
        const tx = ax + (k - 1.5) * 1.5 - (k < 2 ? -5 : 5), ty = ky + 9;
        out.push([[ax, ay, 3.4], [kx, ky, 2.9], [(kx + tx) / 2 + (k < 2 ? 2 : -2), ky - 3, 2.2], [tx, ty, 1.6]]);
      }
      return out;
    };
    P.layer((g) => { for (const p of legsOf(false)) leg(g, p, true, rand); }, OWS * 0.8);
    P.layer((g) => {
      g.beginPath(); g.ellipse(46, 60, 24, 12.5, 0.04, 0, TAU); g.fillStyle = C.mid; g.fill();
      g.save(); g.beginPath(); g.ellipse(46, 60, 24, 12.5, 0.04, 0, TAU); g.clip();
      g.fillStyle = A(C.band, 0.45); g.beginPath(); g.ellipse(46, 55, 17, 5.5, 0, 0, TAU); g.fill();
      g.fillStyle = A('#120d0b', 0.5); g.beginPath(); g.ellipse(48, 68, 24, 6, 0, 0, TAU); g.fill();
      fur(g, rand, 22, 48, 70, 72, 30, [A('#0c0907', 0.6), A(C.hair, 0.45)], Math.PI * 0.5, 2.4);
      g.restore();
      cephalo(g, 74, 59, 12, 8.5, rand);
      fang(g, 85, 54, 1, 0.9);
    }, OWS);
    P.layer((g) => { for (const p of legsOf(true)) leg(g, p, false, rand); }, OWS * 0.8);
  });
}

export function addCreatures(add) {
  const sf = sideFrames();
  for (const k of Object.keys(sf)) add('spider_' + k, sf[k], 0.5, FOOT / SH);
  const fs = frontFrames('s'), fn = frontFrames('n');
  add('spider_s', fs[0], 0.5, FF / FH); add('spider_n', fn[0], 0.5, FF / FH);
  for (const k of [1, 2]) { add('spider_s_w' + k, fs[k], 0.5, FF / FH); add('spider_n_w' + k, fn[k], 0.5, FF / FH); }
  add('spider_dead', dead(), 0.5, 72 / SH);
}
