// Cosmetic wildlife sprites (src/fx/wildlife.js): tiny, readable, same outline language as the rest.
// cr_butterfly_0..4 (top view, wings open; the system flaps them by scaling x) · cr_bee · cr_dragonfly_0..1
// cr_frog_0..1 (sitting) + cr_frog_jump · cr_duck_0..1 (drake / hen swimming, side) + cr_duck_fly + cr_duckling
// cr_fish (dark silhouette for shadows under the water) · cr_squirrel_sit / _run / _climb
// cr_bird_<0..2>_{sit,peck,fly} (sparrow, robin, blue tit; side view, facing east).

import { sprite, TAU, lin, circle, taper } from './paint.js';

const OWC = 1.3; // thin outline for tiny critters
const OC = 'rgba(24,20,16,0.85)';

// ---------------- butterflies ----------------
// [fore wing, hind wing, accent, body]
const BF = [
  ['#f4f1e6', '#ece6d4', '#3a3a3a', '#3a3428'],   // cabbage white
  ['#f2dc52', '#e8cc40', '#c89a20', '#4a3a1a'],   // brimstone yellow
  ['#e8842a', '#d86a1e', '#1e1612', '#24180e'],   // monarch-like orange
  ['#5a8ae0', '#4070c8', '#1a2a5a', '#1e2230'],   // blue
  ['#2a2220', '#2a2220', '#d8402a', '#1a1410'],   // red admiral-like
];
function butterfly(v) {
  const c = BF[v % BF.length];
  return sprite(0.32, 0.26, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2 + 1;
    P.layer((g) => {
      for (const s of [-1, 1]) {
        g.fillStyle = c[0]; g.beginPath(); g.ellipse(cx + s * 4.6, cy - 2.6, 4.6, 3.6, s * -0.5, 0, TAU); g.fill();
        g.fillStyle = c[1]; g.beginPath(); g.ellipse(cx + s * 3.6, cy + 2.8, 3.2, 2.8, s * 0.5, 0, TAU); g.fill();
        g.fillStyle = c[2];
        if (v === 2) { g.beginPath(); g.ellipse(cx + s * 7, cy - 3.6, 1.6, 2, 0, 0, TAU); g.fill(); g.fillRect(cx + s * 1.5 - 0.4, cy - 4, 0.8, 7); }
        else if (v === 4) { g.beginPath(); g.ellipse(cx + s * 5, cy - 2.6, 3.2, 1, s * -0.5, 0, TAU); g.fill(); }
        else { g.beginPath(); circle(g, cx + s * 6.4, cy - 4.4, 1.1); g.fill(); }
      }
      g.fillStyle = c[3]; g.beginPath(); g.ellipse(cx, cy, 0.9, 4.2, 0, 0, TAU); g.fill();
      g.strokeStyle = c[3]; g.lineWidth = 0.5; g.beginPath(); g.moveTo(cx, cy - 4); g.lineTo(cx - 2, cy - 7); g.moveTo(cx, cy - 4); g.lineTo(cx + 2, cy - 7); g.stroke();
    }, OWC * 0.8, OC);
  }, { pad: 4 });
}

function bee() {
  return sprite(0.16, 0.14, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2 + 0.5;
    P.layer((g) => {
      g.fillStyle = 'rgba(230,240,255,0.85)';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 2.2, cy - 2.4, 2, 1.4, s * -0.4, 0, TAU); g.fill(); }
      g.fillStyle = '#f0b82a'; g.beginPath(); g.ellipse(cx, cy, 2.2, 3, 0, 0, TAU); g.fill();
      g.fillStyle = '#2a2016'; g.fillRect(cx - 2.2, cy - 0.6, 4.4, 1); g.fillRect(cx - 2, cy + 1.2, 4, 0.9);
      g.beginPath(); circle(g, cx, cy - 3, 1.3); g.fill();
    }, 0.9, OC);
  }, { pad: 3 });
}

function dragonfly(v) {
  const body = v ? ['#3a8ad0', '#9ad0f0'] : ['#3aa86a', '#a8e0b0'];
  return sprite(0.36, 0.3, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    P.layer((g) => {
      g.fillStyle = 'rgba(220,235,255,0.55)';
      for (const s of [-1, 1]) {
        g.beginPath(); g.ellipse(cx + s * 5.5, cy - 3.2, 5.5, 1.5, s * -0.12, 0, TAU); g.fill();
        g.beginPath(); g.ellipse(cx + s * 5, cy - 0.6, 5, 1.4, s * 0.18, 0, TAU); g.fill();
      }
      g.fillStyle = lin(g, cx, cy - 6, cx, cy + 8, [[0, body[1]], [1, body[0]]]);
      g.beginPath(); g.ellipse(cx, cy + 2.5, 0.8, 6.5, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(cx, cy - 3.6, 1.4, 1.8, 0, 0, TAU); g.fill();
      g.fillStyle = '#1e2a2a'; g.beginPath(); circle(g, cx - 0.9, cy - 5, 0.9); g.fill(); g.beginPath(); circle(g, cx + 0.9, cy - 5, 0.9); g.fill();
    }, 0.7, OC);
  }, { pad: 3 });
}

// ---------------- frogs ----------------
function frog(v, jump) {
  const col = v ? ['#7a8a3a', '#a8b45a', '#4a5224'] : ['#4a8a3a', '#7ab84e', '#2a4e22'];
  return sprite(0.3, jump ? 0.34 : 0.26, (g, P) => {
    const cx = P.W / 2, by = P.H - 3;
    P.layer((g) => {
      if (jump) {
        g.fillStyle = col[0];
        for (const s of [-1, 1]) { g.beginPath(); taper(g, cx + s * 2.5, by - 8, cx + s * 4, by - 3, cx + s * 5, by + 1, 2.6, 1.2); g.fill(); }
        g.beginPath(); g.ellipse(cx, by - 11, 4.2, 6, 0, 0, TAU); g.fill();
        g.fillStyle = col[1]; g.beginPath(); g.ellipse(cx - 1, by - 13, 2.4, 3.4, 0, 0, TAU); g.fill();
        for (const s of [-1, 1]) { g.fillStyle = col[0]; g.beginPath(); taper(g, cx + s * 3, by - 14, cx + s * 5, by - 17, cx + s * 6, by - 19, 1.6, 0.8); g.fill(); }
      } else {
        g.fillStyle = col[2];
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 5, by - 2.2, 3, 1.8, s * 0.4, 0, TAU); g.fill(); }
        g.fillStyle = col[0]; g.beginPath(); g.ellipse(cx, by - 4.4, 5, 4, 0, 0, TAU); g.fill();
        g.fillStyle = col[1]; g.beginPath(); g.ellipse(cx - 1, by - 5.4, 3, 2.2, 0, 0, TAU); g.fill();
        g.fillStyle = '#e8e0a0'; g.beginPath(); g.ellipse(cx, by - 2.2, 3, 1.2, 0, 0, TAU); g.fill();
        for (const s of [-1, 1]) {
          g.fillStyle = col[0]; g.beginPath(); circle(g, cx + s * 2.6, by - 8, 1.7); g.fill();
          g.fillStyle = '#1a1a12'; g.beginPath(); circle(g, cx + s * 2.7, by - 8.2, 0.9); g.fill();
          g.fillStyle = '#ffffff'; g.beginPath(); circle(g, cx + s * 2.4, by - 8.6, 0.35); g.fill();
        }
        if (v) { g.fillStyle = col[2]; for (let k = 0; k < 4; k++) { g.beginPath(); circle(g, cx - 2 + k * 1.4, by - 4.4 + (k & 1), 0.6); g.fill(); } }
      }
    }, OWC, OC);
  }, { pad: 3 });
}

// ---------------- ducks ----------------
function duck(kind) {
  // kind: 0 drake, 1 hen, 2 flying, 3 duckling
  const small = kind === 3;
  return sprite(small ? 0.26 : 0.5, small ? 0.22 : kind === 2 ? 0.42 : 0.36, (g, P) => {
    const W = P.W, cx = W / 2, by = P.H - 4;
    const k = small ? 0.5 : 1;
    const body = kind === 0 ? '#a89a86' : kind === 3 ? '#c8a84a' : '#8a6a44';
    const head = kind === 0 ? '#1e6a3a' : kind === 3 ? '#a88a3a' : '#7a5a38';
    P.layer((g) => {
      if (kind === 2) {
        g.fillStyle = '#7a5a3a';
        g.beginPath(); g.moveTo(cx - 2, by - 10); g.quadraticCurveTo(cx - 12, by - 26, cx - 16, by - 22); g.quadraticCurveTo(cx - 10, by - 14, cx - 2, by - 6); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(cx + 2, by - 10); g.quadraticCurveTo(cx + 10, by - 24, cx + 14, by - 22); g.quadraticCurveTo(cx + 8, by - 12, cx + 2, by - 6); g.closePath(); g.fill();
        g.fillStyle = body; g.beginPath(); g.ellipse(cx, by - 8, 9, 4, 0, 0, TAU); g.fill();
        g.fillStyle = '#1e6a3a'; g.beginPath(); circle(g, cx + 9, by - 10, 3); g.fill();
        g.fillStyle = '#e0b030'; g.beginPath(); g.ellipse(cx + 12.5, by - 9.6, 2, 1, 0, 0, TAU); g.fill();
        return;
      }
      // body sitting on the water
      g.fillStyle = body; g.beginPath(); g.ellipse(cx - 1 * k, by - 5 * k, 11 * k, 5.5 * k, 0, 0, TAU); g.fill();
      g.fillStyle = kind === 0 ? '#6a4a30' : body; g.beginPath(); g.ellipse(cx + 5 * k, by - 6 * k, 5 * k, 4.4 * k, 0, 0, TAU); g.fill(); // breast
      g.fillStyle = kind === 0 ? '#3a3a3a' : '#6a5034'; g.beginPath(); g.moveTo(cx - 11 * k, by - 6 * k); g.lineTo(cx - 15 * k, by - 9 * k); g.lineTo(cx - 9 * k, by - 9 * k); g.closePath(); g.fill(); // tail
      g.fillStyle = kind === 0 ? '#c8c0b0' : '#a8845a'; g.beginPath(); g.ellipse(cx - 3 * k, by - 7 * k, 6 * k, 2.4 * k, -0.1, 0, TAU); g.fill(); // wing
      if (kind === 0) { g.fillStyle = '#3a5aa8'; g.fillRect(cx - 5 * k, by - 7.6 * k, 3 * k, 1.4 * k); }
      g.fillStyle = head; g.beginPath(); circle(g, cx + 8 * k, by - 12 * k, 3.6 * k); g.fill();
      g.fillStyle = head; g.fillRect(cx + 6.4 * k, by - 11 * k, 3 * k, 4 * k);
      if (kind === 0) { g.fillStyle = '#f2f0e8'; g.fillRect(cx + 6.2 * k, by - 8.4 * k, 3.4 * k, 1 * k); }
      g.fillStyle = small ? '#c89a3a' : '#e0b030'; g.beginPath(); g.ellipse(cx + 12 * k, by - 11.4 * k, 2.4 * k, 1.1 * k, 0.1, 0, TAU); g.fill();
      g.fillStyle = '#1a1612'; g.beginPath(); circle(g, cx + 9 * k, by - 13 * k, 0.8 * k + 0.2); g.fill();
    }, OWC, OC);
    // waterline glint
    g.fillStyle = 'rgba(220,240,255,0.5)'; g.fillRect(cx - 10 * k, by - 0.8, 20 * k, 1);
  }, { pad: 3 });
}

function fishShadow() {
  return sprite(0.46, 0.2, (g, P) => {
    const cx = P.W / 2, cy = P.H / 2;
    g.fillStyle = 'rgba(12,24,30,0.9)';
    g.beginPath(); g.ellipse(cx + 1, cy, 10, 3.6, 0, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(cx - 8, cy); g.lineTo(cx - 14, cy - 4); g.lineTo(cx - 13, cy); g.lineTo(cx - 14, cy + 4); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(cx + 1, cy - 3.2, 3, 1.4, -0.3, 0, TAU); g.fill();
  }, { pad: 3 });
}

// ---------------- squirrel ----------------
function squirrel(pose) {
  return sprite(0.34, 0.34, (g, P) => {
    const cx = P.W / 2, by = P.H - 3;
    const fur = '#b8582a', furL = '#d8844a', belly = '#f0d8b8';
    P.layer((g) => {
      if (pose === 'climb') { // back view, head up, tail hanging
        g.fillStyle = fur; g.beginPath(); g.ellipse(cx, by - 6, 3.4, 6, 0, 0, TAU); g.fill();
        g.fillStyle = furL; g.beginPath(); g.ellipse(cx, by + 2, 3.4, 5, 0, 0, TAU); g.fill();
        g.fillStyle = fur; g.beginPath(); circle(g, cx, by - 13, 3); g.fill();
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 1.4, by - 15); g.lineTo(cx + s * 2.6, by - 18); g.lineTo(cx + s * 2.8, by - 14.5); g.closePath(); g.fill(); g.fillRect(cx + s * 3 - 0.8, by - 9, 1.6, 2.6); }
        return;
      }
      const run = pose === 'run';
      // big bushy tail curling up behind
      g.fillStyle = furL;
      g.beginPath();
      if (run) { g.moveTo(cx - 5, by - 6); g.quadraticCurveTo(cx - 16, by - 10, cx - 15, by - 3); g.quadraticCurveTo(cx - 10, by - 2, cx - 5, by - 4); }
      else { g.moveTo(cx - 3, by - 3); g.quadraticCurveTo(cx - 13, by - 4, cx - 10, by - 16); g.quadraticCurveTo(cx - 6, by - 20, cx - 4, by - 14); g.quadraticCurveTo(cx - 6, by - 8, cx - 1, by - 5); }
      g.closePath(); g.fill();
      g.fillStyle = fur;
      if (run) { g.beginPath(); g.ellipse(cx, by - 5, 6, 3.4, -0.1, 0, TAU); g.fill(); g.beginPath(); circle(g, cx + 6, by - 7, 2.8); g.fill(); }
      else { g.beginPath(); g.ellipse(cx, by - 6, 3.8, 5, 0.15, 0, TAU); g.fill(); g.beginPath(); circle(g, cx + 2, by - 12, 3); g.fill(); }
      g.fillStyle = belly; g.beginPath(); g.ellipse(run ? cx + 2 : cx + 2, run ? by - 3.6 : by - 5, run ? 3 : 1.8, run ? 1.2 : 3.2, 0, 0, TAU); g.fill();
      const hx = run ? cx + 6 : cx + 2, hy = run ? by - 7 : by - 12;
      g.fillStyle = fur; g.beginPath(); g.moveTo(hx - 1, hy - 2); g.lineTo(hx - 0.5, hy - 5.5); g.lineTo(hx + 1, hy - 2.4); g.closePath(); g.fill();
      g.fillStyle = '#1a1210'; g.beginPath(); circle(g, hx + 1.2, hy - 0.4, 0.7); g.fill();
      if (!run) { g.fillStyle = '#8a5a2a'; g.beginPath(); circle(g, cx + 4, by - 8, 1.3); g.fill(); } // a nut in its paws
    }, OWC, OC);
  }, { pad: 3 });
}

// ---------------- small birds (side view, facing east) ----------------
const BIRD = [
  { back: '#8a6a44', wing: '#6e5234', belly: '#d8c8a8', head: '#7a5a3a', cap: '#5a4028' },   // sparrow
  { back: '#7a6a5a', wing: '#5e5044', belly: '#e0782e', head: '#7a6a5a', cap: '#6a5a4a' },   // robin
  { back: '#7a9a5a', wing: '#4a78b8', belly: '#f0d040', head: '#f2f0e8', cap: '#3a6ab8' },   // blue tit
];
function bird(v, pose) {
  const C = BIRD[v % BIRD.length];
  return sprite(0.26, 0.24, (g, P) => {
    const cx = P.W / 2, by = P.H - 3;
    P.layer((g) => {
      if (pose === 'fly') {
        g.fillStyle = C.wing;
        g.beginPath(); g.moveTo(cx - 1, by - 6); g.quadraticCurveTo(cx - 4, by - 15, cx - 8, by - 13); g.quadraticCurveTo(cx - 4, by - 9, cx - 2, by - 4); g.closePath(); g.fill();
        g.fillStyle = C.back; g.beginPath(); g.ellipse(cx, by - 5, 5, 2.6, 0, 0, TAU); g.fill();
        g.fillStyle = C.belly; g.beginPath(); g.ellipse(cx + 1, by - 4, 3.4, 1.6, 0, 0, TAU); g.fill();
        g.fillStyle = C.head; g.beginPath(); circle(g, cx + 5, by - 6, 2.2); g.fill();
        g.fillStyle = C.wing; g.beginPath(); g.moveTo(cx + 1, by - 6); g.quadraticCurveTo(cx + 2, by - 14, cx - 2, by - 15); g.quadraticCurveTo(cx - 1, by - 9, cx - 1, by - 5); g.closePath(); g.fill();
        g.fillStyle = '#d0a040'; g.beginPath(); g.moveTo(cx + 7, by - 6.4); g.lineTo(cx + 9, by - 6); g.lineTo(cx + 7, by - 5.4); g.closePath(); g.fill();
        return;
      }
      const peck = pose === 'peck';
      g.strokeStyle = '#5a4a3a'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx, by - 2); g.lineTo(cx - 0.5, by); g.moveTo(cx + 1.5, by - 2); g.lineTo(cx + 1.5, by); g.stroke();
      g.fillStyle = C.wing; g.beginPath(); g.moveTo(cx - 3, by - 5); g.lineTo(cx - 8, by - (peck ? 8 : 4)); g.lineTo(cx - 3, by - 3); g.closePath(); g.fill(); // tail
      g.fillStyle = C.back; g.beginPath(); g.ellipse(cx, by - 4.5, 4.4, 3.2, peck ? 0.35 : -0.15, 0, TAU); g.fill();
      g.fillStyle = C.belly; g.beginPath(); g.ellipse(cx + 1.2, by - 3.6, 2.8, 2.2, 0, 0, TAU); g.fill();
      g.fillStyle = C.wing; g.beginPath(); g.ellipse(cx - 1, by - 5, 3, 1.6, peck ? 0.35 : -0.2, 0, TAU); g.fill();
      const hx = peck ? cx + 4.4 : cx + 3.6, hy = peck ? by - 2.6 : by - 7.6;
      g.fillStyle = C.head; g.beginPath(); circle(g, hx, hy, 2.3); g.fill();
      g.fillStyle = C.cap; g.beginPath(); g.ellipse(hx, hy - 1, 2, 1.2, 0, Math.PI, TAU); g.fill();
      g.fillStyle = '#d0a040'; g.beginPath(); g.moveTo(hx + 2, hy - 0.4); g.lineTo(hx + 4, hy + (peck ? 1.4 : 0)); g.lineTo(hx + 2, hy + 0.6); g.closePath(); g.fill();
      g.fillStyle = '#121010'; g.beginPath(); circle(g, hx + 0.8, hy - 0.4, 0.55); g.fill();
    }, OWC * 0.9, OC);
  }, { pad: 3 });
}

export function addCritters(add) {
  const foot = (name, c, f) => add(name, c, 0.5, 1 - f / (c.origH || c.height));
  const mid = (name, c) => add(name, c, 0.5, 0.5);
  for (let i = 0; i < BF.length; i++) mid('cr_butterfly_' + i, butterfly(i));
  mid('cr_bee', bee());
  for (let i = 0; i < 2; i++) mid('cr_dragonfly_' + i, dragonfly(i));
  for (let i = 0; i < 2; i++) foot('cr_frog_' + i, frog(i, false), 3);
  foot('cr_frog_jump', frog(0, true), 3);
  foot('cr_duck_0', duck(0), 4); foot('cr_duck_1', duck(1), 4); foot('cr_duck_fly', duck(2), 4); foot('cr_duckling', duck(3), 4);
  mid('cr_fish', fishShadow());
  for (const p of ['sit', 'run', 'climb']) foot('cr_squirrel_' + p, squirrel(p), 3);
  for (let i = 0; i < BIRD.length; i++) for (const p of ['sit', 'peck', 'fly']) foot(`cr_bird_${i}_${p}`, bird(i, p), 3);
}

