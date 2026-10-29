// UI ability icons (64×64): painted symbol on a glowing vignette background inside a beveled dark frame.

import { spritePxFast as spritePx, TAU, lin, rad, circle, leaf, smoothClosed, mixc } from './paint.js';
import { GEAR } from './gear.js';

function rrect(g, x, y, w, h, r) {
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

function icon(bg, glow, symbol) {
  return spritePx(64, 64, (g, P) => {
    // background
    P.layer((g) => {
      g.beginPath(); rrect(g, 4, 4, 56, 56, 4);
      g.fillStyle = rad(g, 26, 24, 2, 46, [[0, mixc(bg, '#ffffff', 0.25)], [0.45, bg], [1, mixc(bg, '#000000', 0.75)]]); g.fill();
      g.fillStyle = rad(g, 32, 32, 0, 24, [[0, glow], [1, 'rgba(0,0,0,0)']]); g.fill();
      // subtle painted texture
      g.save(); g.beginPath(); rrect(g, 4, 4, 56, 56, 4); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 3;
      for (let i = -4; i < 10; i++) { g.beginPath(); g.moveTo(i * 8, 64); g.lineTo(i * 8 + 40, 0); g.stroke(); }
      g.restore();
    }, 0);
    // symbol
    P.layer((g) => { g.save(); g.beginPath(); rrect(g, 5, 5, 54, 54, 3); g.clip(); symbol(g); g.restore(); }, 2.2);
    // frame + gloss + inner vignette
    P.layer((g) => {
      g.save(); g.beginPath(); rrect(g, 5, 5, 54, 54, 3); g.clip();
      g.fillStyle = 'rgba(0,0,0,0)';
      const v = g.createRadialGradient(32, 30, 18, 32, 32, 42);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = v; g.fillRect(0, 0, 64, 64);
      g.fillStyle = lin(g, 0, 5, 0, 26, [[0, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
      g.beginPath(); g.ellipse(32, 8, 30, 16, 0, 0, TAU); g.fill();
      g.restore();
      // outer frame ring (even-odd)
      g.beginPath(); rrect(g, 0.5, 0.5, 63, 63, 7); rrect(g, 5, 5, 54, 54, 3);
      g.fillStyle = lin(g, 0, 0, 64, 64, [[0, '#9b8a6c'], [0.35, '#5e5242'], [0.7, '#2f271f'], [1, '#17120e']]); g.fill('evenodd');
      g.strokeStyle = '#0d0b09'; g.lineWidth = 1.2;
      g.beginPath(); rrect(g, 0.8, 0.8, 62.4, 62.4, 7); g.stroke();
      g.beginPath(); rrect(g, 5, 5, 54, 54, 3); g.stroke();
      g.strokeStyle = 'rgba(255,240,210,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(3, 50); g.lineTo(3, 8); g.quadraticCurveTo(3, 3, 8, 3); g.lineTo(50, 3); g.stroke();
    }, 0);
  }, { crop: false });
}

// ---- symbol helpers ----
function swordAt(g, x, y, a, len, w = 4.2) {
  g.save(); g.translate(x, y); g.rotate(a);
  // blade (points to -y)
  g.fillStyle = lin(g, -w, 0, w, 0, [[0, '#ffffff'], [0.5, '#c9d1da'], [1, '#76818e']]);
  g.beginPath(); g.moveTo(0, -len); g.lineTo(w, -len + w * 2.2); g.lineTo(w * 0.9, 0); g.lineTo(-w * 0.9, 0); g.lineTo(-w, -len + w * 2.2); g.closePath(); g.fill();
  g.fillStyle = 'rgba(80,90,105,0.6)'; g.fillRect(-0.6, -len + w * 2.5, 1.2, len - w * 3);
  g.fillStyle = lin(g, 0, -2, 0, 3, [[0, '#e6c46e'], [1, '#7a5a26']]); g.fillRect(-w * 2.4, -1, w * 4.8, 4);
  g.fillStyle = '#5a3a24'; g.fillRect(-w * 0.55, 3, w * 1.1, len * 0.24);
  g.fillStyle = '#d4ad55'; g.beginPath(); circle(g, 0, 4 + len * 0.26, w * 0.85); g.fill();
  g.restore();
}

const SYMBOLS = {
  icon_strike: ['#8e2e1e', 'rgba(255,190,120,0.55)', (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
    g.beginPath(); g.arc(30, 36, 22, -2.6, -0.5); g.stroke();
    g.strokeStyle = 'rgba(255,230,190,0.6)'; g.lineWidth = 9;
    g.beginPath(); g.arc(30, 36, 22, -2.4, -0.7); g.stroke();
    swordAt(g, 22, 44, 0.75, 34);
  }],
  icon_charge: ['#24487a', 'rgba(150,200,255,0.5)', (g) => {
    g.fillStyle = 'rgba(220,240,255,0.85)';
    for (const [y, l] of [[22, 18], [32, 24], [42, 16]]) { g.beginPath(); g.moveTo(8, y - 1.6); g.lineTo(8 + l, y - 2.4); g.lineTo(8 + l, y + 2.4); g.lineTo(8, y + 1.6); g.closePath(); g.fill(); }
    g.fillStyle = lin(g, 20, 14, 56, 50, [[0, '#ffe9a0'], [0.5, '#e8b23c'], [1, '#9a6416']]);
    g.beginPath(); g.moveTo(22, 24); g.lineTo(38, 24); g.lineTo(38, 14); g.lineTo(57, 32); g.lineTo(38, 50); g.lineTo(38, 40); g.lineTo(22, 40); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(24, 26); g.lineTo(40, 26); g.lineTo(40, 19); g.lineTo(52, 31); g.lineTo(48, 31); g.lineTo(38, 22); g.lineTo(38, 28); g.lineTo(24, 28); g.closePath(); g.fill();
  }],
  icon_whirlwind: ['#4c2a6e', 'rgba(220,170,255,0.5)', (g) => {
    g.strokeStyle = 'rgba(240,225,255,0.7)'; g.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(32, 32, 9 + i * 7, i * 2 + 0.3, i * 2 + 2.6); g.stroke(); }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU - 0.4;
      g.save(); g.translate(32, 32); g.rotate(a);
      g.fillStyle = lin(g, 0, -4, 0, 4, [[0, '#ffffff'], [1, '#8f9aa8']]);
      g.beginPath(); g.moveTo(4, -3); g.quadraticCurveTo(18, -9, 25, -1); g.quadraticCurveTo(17, -2, 6, 3); g.closePath(); g.fill();
      g.fillStyle = '#d4ad55'; g.fillRect(2, -3.5, 3, 7);
      g.restore();
    }
    g.fillStyle = '#5a3a24'; g.beginPath(); circle(g, 32, 32, 4.5); g.fill();
    g.fillStyle = '#d4ad55'; g.beginPath(); circle(g, 32, 32, 2.2); g.fill();
  }],
  icon_bandage: ['#2e5c2c', 'rgba(200,255,190,0.45)', (g) => {
    g.fillStyle = lin(g, 10, 30, 50, 52, [[0, '#ffffff'], [1, '#cfc7b4']]);
    g.beginPath(); g.moveTo(26, 40); g.bezierCurveTo(36, 46, 46, 44, 56, 52); g.lineTo(52, 58); g.bezierCurveTo(42, 52, 32, 54, 22, 48); g.closePath(); g.fill();
    g.fillStyle = lin(g, 10, 14, 40, 48, [[0, '#ffffff'], [0.6, '#e6dfcf'], [1, '#b0a790']]);
    g.beginPath(); g.ellipse(26, 30, 15, 17, 0, 0, TAU); g.fill();
    g.fillStyle = '#d8d0bd'; g.beginPath(); g.ellipse(26, 30, 7, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#b5ab94'; g.beginPath(); g.ellipse(26, 30, 3, 3.5, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(150,140,120,0.6)'; g.lineWidth = 1; g.beginPath(); g.ellipse(26, 30, 11, 12.5, 0, 0, TAU); g.stroke();
    g.fillStyle = '#d0302a'; g.fillRect(41, 10, 6, 18); g.fillRect(35, 16, 18, 6);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(41, 10, 2, 18);
  }],
  icon_sprint: ['#1f5c5c', 'rgba(170,255,240,0.45)', (g) => {
    g.strokeStyle = 'rgba(220,255,250,0.8)'; g.lineWidth = 2.6;
    for (const [y, x0] of [[20, 6], [30, 4], [40, 8]]) { g.beginPath(); g.moveTo(x0, y); g.quadraticCurveTo(x0 + 10, y - 3, x0 + 18, y); g.stroke(); }
    g.fillStyle = lin(g, 20, 10, 56, 54, [[0, '#c48a52'], [0.6, '#8a5a30'], [1, '#5a3618']]);
    g.beginPath(); g.moveTo(28, 10); g.lineTo(42, 10); g.lineTo(42, 34); g.quadraticCurveTo(56, 38, 58, 46); g.lineTo(58, 52); g.lineTo(24, 52); g.lineTo(24, 40); g.quadraticCurveTo(28, 30, 28, 10); g.closePath(); g.fill();
    g.fillStyle = '#3a2412'; g.fillRect(24, 50, 34, 5);
    g.fillStyle = '#d9b27a'; g.fillRect(27, 10, 16, 5);
    g.strokeStyle = 'rgba(40,24,10,0.7)'; g.lineWidth = 1.2;
    for (const y of [20, 26, 32]) { g.beginPath(); g.moveTo(31, y); g.lineTo(40, y + 1); g.stroke(); }
    g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(29, 16, 2.5, 22);
    // little wing
    g.fillStyle = '#f4f0e6';
    g.beginPath(); g.moveTo(26, 22); g.quadraticCurveTo(12, 14, 8, 20); g.quadraticCurveTo(14, 21, 13, 25); g.quadraticCurveTo(18, 25, 18, 29); g.quadraticCurveTo(22, 28, 26, 30); g.closePath(); g.fill();
  }],
  icon_attack: ['#6e2620', 'rgba(255,170,120,0.45)', (g) => {
    swordAt(g, 16, 48, 0.78, 38, 3.8);
    swordAt(g, 48, 48, -0.78, 38, 3.8);
  }],
  icon_eat: ['#7c4a1c', 'rgba(255,210,140,0.5)', (g) => {
    g.fillStyle = '#efe7d6'; g.save(); g.translate(42, 20); g.rotate(0.75);
    g.fillRect(-2.6, -2, 5.2, 14); g.beginPath(); circle(g, -2.6, -3, 3.6); circle(g, 2.6, -3, 3.6); g.fill(); g.restore();
    g.beginPath(); smoothClosed(g, [[14, 44], [12, 32], [20, 22], [32, 20], [40, 28], [38, 40], [26, 48]]);
    g.fillStyle = lin(g, 12, 20, 40, 48, [[0, '#e09a4c'], [0.5, '#aa5a22'], [1, '#6a3412']]); g.fill();
    g.fillStyle = 'rgba(255,235,180,0.6)'; g.beginPath(); g.ellipse(21, 28, 6, 3, -0.6, 0, TAU); g.fill();
    for (const [x, y] of [[44, 44], [50, 40], [50, 49]]) { g.fillStyle = '#6a0f1e'; g.beginPath(); circle(g, x, y, 5); g.fill(); g.fillStyle = '#c42a40'; g.beginPath(); circle(g, x - 0.5, y - 0.5, 4.1); g.fill(); g.fillStyle = '#ffd6dc'; g.beginPath(); circle(g, x - 1.8, y - 1.8, 1.1); g.fill(); }
    g.fillStyle = '#4d7a32'; g.beginPath(); leaf(g, 47, 37, 56, 30, 3.5, 1); g.fill();
  }],
  icon_build: ['#5c4a2a', 'rgba(255,220,150,0.45)', (g) => {
    g.fillStyle = lin(g, 8, 40, 56, 54, [[0, '#c9995f'], [1, '#7a5030']]);
    g.save(); g.translate(32, 47); g.rotate(-0.12); g.fillRect(-24, -5, 48, 10);
    g.strokeStyle = 'rgba(60,36,16,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-22, -1); g.lineTo(20, 0); g.stroke(); g.restore();
    g.save(); g.translate(30, 34); g.rotate(-0.75);
    g.fillStyle = lin(g, -3, 0, 3, 0, [[0, '#b0844f'], [1, '#5e3e22']]); g.fillRect(-2.8, -8, 5.6, 30);
    g.fillStyle = lin(g, 0, -18, 0, -6, [[0, '#e0e6ec'], [1, '#6c7782']]);
    g.beginPath(); g.moveTo(-13, -16); g.lineTo(9, -16); g.lineTo(12, -12); g.lineTo(9, -7); g.lineTo(-13, -7); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(-12, -15, 20, 2);
    g.restore();
  }],
  icon_bag: ['#3c4c2a', 'rgba(220,240,170,0.4)', (g) => {
    g.strokeStyle = '#4a2e18'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(22, 20); g.quadraticCurveTo(32, 4, 42, 20); g.stroke();
    g.fillStyle = lin(g, 14, 16, 50, 58, [[0, '#c48e58'], [0.55, '#8e5c32'], [1, '#5a3618']]);
    g.beginPath(); g.moveTo(16, 26); g.quadraticCurveTo(16, 18, 24, 17); g.lineTo(40, 17); g.quadraticCurveTo(48, 18, 48, 26); g.lineTo(50, 52); g.quadraticCurveTo(50, 57, 44, 57); g.lineTo(20, 57); g.quadraticCurveTo(14, 57, 14, 52); g.closePath(); g.fill();
    g.fillStyle = lin(g, 0, 17, 0, 38, [[0, '#d39e66'], [1, '#8a5a30']]);
    g.beginPath(); g.moveTo(16, 26); g.quadraticCurveTo(16, 17, 24, 17); g.lineTo(40, 17); g.quadraticCurveTo(48, 17, 48, 26); g.lineTo(46, 36); g.quadraticCurveTo(32, 40, 18, 36); g.closePath(); g.fill();
    g.fillStyle = '#d4ad55'; g.fillRect(29, 33, 6, 6); g.fillStyle = '#5a3618'; g.fillRect(31, 35, 2, 2);
    g.strokeStyle = 'rgba(60,34,14,0.6)'; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.beginPath(); g.moveTo(19, 44); g.lineTo(45, 44); g.lineTo(46, 53); g.lineTo(18, 53); g.closePath(); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,240,210,0.3)'; g.fillRect(19, 22, 3, 26);
  }],
  icon_gather: ['#3f5a24', 'rgba(230,255,170,0.45)', (g) => {
    // a sprig with leaves + a gloved hand reaching for it
    g.strokeStyle = '#5a4020'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(40, 54); g.quadraticCurveTo(42, 32, 34, 12); g.stroke();
    for (const [x, y, a, s] of [[36, 18, -0.9, 1], [40, 28, 0.6, 1], [37, 36, -0.8, 0.9], [41, 44, 0.7, 0.8]]) {
      g.fillStyle = s > 0.95 ? '#7fae46' : '#5f8a34';
      g.beginPath(); leaf(g, x, y, x + Math.cos(a) * 12 * s * (a < 0 ? -1 : 1), y - 6 * s, 4.2 * s, 0.8); g.fill();
    }
    for (const [x, y] of [[44, 22], [30, 30]]) { g.fillStyle = '#c42a40'; g.beginPath(); circle(g, x, y, 3.6); g.fill(); g.fillStyle = '#ffd6dc'; g.beginPath(); circle(g, x - 1.2, y - 1.2, 0.9); g.fill(); }
    g.fillStyle = lin(g, 6, 30, 30, 58, [[0, '#e2b27a'], [1, '#9a6a3a']]);
    g.beginPath(); g.moveTo(6, 58); g.lineTo(10, 44); g.quadraticCurveTo(12, 38, 18, 38); g.lineTo(28, 37); g.quadraticCurveTo(32, 37, 31, 40); g.quadraticCurveTo(30, 42, 24, 42); g.lineTo(30, 43); g.quadraticCurveTo(34, 44, 32, 47); g.lineTo(24, 48); g.quadraticCurveTo(22, 54, 20, 58); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(90,56,26,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(18, 42); g.lineTo(24, 42); g.moveTo(18, 47); g.lineTo(25, 47.5); g.stroke();
  }],
};

// ---- new ability / UI / status icons (Art B, expansion) ----
// draw a held item (gear.js painter) with its grip at (x, y), rotated a (0 = pointing up), scale k
function gearAt(g, id, x, y, a, k = 1) {
  const D = GEAR[id];
  if (!D) return;
  g.save(); g.translate(x, y); g.rotate(a); g.scale(k, k); g.translate(-D.gx, -D.gy);
  for (const fn of D.layers) fn(g);
  g.restore();
}
// motion streaks behind a moving thing (toward angle a)
function streaks(g, x, y, a, n = 3, len = 14, col = 'rgba(255,255,255,0.75)') {
  g.strokeStyle = col; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * 6;
    const px = x - Math.cos(a) * 4 + Math.cos(a + Math.PI / 2) * o, py = y - Math.sin(a) * 4 + Math.sin(a + Math.PI / 2) * o;
    g.lineWidth = 2.4 - Math.abs(i - (n - 1) / 2) * 0.6;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px - Math.cos(a) * len, py - Math.sin(a) * len); g.stroke();
  }
}
function arc(g, x, y, r, a0, a1, w, col) { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); }
function burst(g, x, y, r, n = 8, col = '#fff6c8') {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.38 : r; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.closePath(); g.fill();
}
function fist(g, x, y, s = 1, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.fillStyle = lin(g, -10, -10, 10, 10, [[0, '#f2c9a0'], [1, '#b87a50']]);
  g.beginPath(); g.moveTo(-9, -6); g.quadraticCurveTo(-9, -11, -3, -11); g.lineTo(8, -10); g.quadraticCurveTo(12, -9, 12, -4); g.lineTo(12, 5); g.quadraticCurveTo(12, 10, 6, 10); g.lineTo(-6, 10); g.quadraticCurveTo(-11, 9, -10, 3); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(110,60,30,0.7)'; g.lineWidth = 1.1;
  for (const yy of [-5.5, -0.5, 4.5]) { g.beginPath(); g.moveTo(5, yy); g.lineTo(11.5, yy); g.stroke(); }
  g.beginPath(); g.moveTo(-8, 2); g.quadraticCurveTo(-1, 0, 3, 5); g.stroke();
  g.fillStyle = 'rgba(255,240,220,0.6)'; g.beginPath(); g.ellipse(-3, -8, 4, 1.6, -0.1, 0, TAU); g.fill();
  // sleeve cuff
  g.fillStyle = '#6a4a8a'; g.fillRect(-18, -8, 9, 17);
  g.restore();
}
function drop(g, x, y, r, c0, c1) {
  g.fillStyle = lin(g, x - r, y - r * 2, x + r, y + r, [[0, c0], [1, c1]]);
  g.beginPath(); g.moveTo(x, y - r * 2.2); g.bezierCurveTo(x + r * 0.4, y - r, x + r, y - r * 0.4, x + r, y + r * 0.2); g.arc(x, y + r * 0.2, r, 0, Math.PI); g.bezierCurveTo(x - r, y - r * 0.4, x - r * 0.4, y - r, x, y - r * 2.2); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.2, r * 0.22, r * 0.4, 0.3, 0, TAU); g.fill();
}

const MORE = {
  icon_punch: ['#7a4a28', 'rgba(255,210,150,0.5)', (g) => { streaks(g, 40, 30, 0, 3, 16); fist(g, 34, 32, 1.05); burst(g, 52, 26, 8, 6, 'rgba(255,246,200,0.9)'); }],
  icon_shove: ['#6a4a2a', 'rgba(255,220,160,0.45)', (g) => { fist(g, 30, 22, 0.85); fist(g, 30, 42, 0.85); streaks(g, 50, 32, 0, 3, 10, 'rgba(255,255,255,0.6)'); g.fillStyle = 'rgba(255,240,210,0.9)'; g.beginPath(); g.moveTo(50, 22); g.lineTo(60, 32); g.lineTo(50, 42); g.lineTo(52, 32); g.closePath(); g.fill(); }],
  icon_stab: ['#7a1e22', 'rgba(255,170,150,0.5)', (g) => { streaks(g, 14, 50, -0.78, 3, 10); gearAt(g, 'knife_iron', 24, 42, 0.78, 1.2); burst(g, 50, 15, 7, 6); }],
  icon_lacerate: ['#6e1418', 'rgba(255,120,110,0.5)', (g) => {
    for (let i = 0; i < 3; i++) { arc(g, 18 + i * 9, 34, 22, -1.2, -0.35, 2.6, 'rgba(255,255,255,0.85)'); }
    gearAt(g, 'knife_steel', 16, 50, 0.55, 1.05);
    for (const [x, y, r] of [[44, 44, 3.2], [52, 38, 2.4], [38, 52, 2.2]]) drop(g, x, y, r, '#ff5a50', '#8a0e12');
  }],
  icon_cleave: ['#8e2e1e', 'rgba(255,190,120,0.55)', (g) => { arc(g, 30, 40, 24, -2.9, -0.2, 6, 'rgba(255,230,190,0.5)'); arc(g, 30, 40, 24, -2.7, -0.3, 2.6, 'rgba(255,255,255,0.95)'); gearAt(g, 'axe_iron', 22, 52, 0.65, 0.8); }],
  icon_smash: ['#5a3a22', 'rgba(255,210,140,0.5)', (g) => {
    g.fillStyle = 'rgba(40,24,12,0.5)'; g.beginPath(); g.ellipse(36, 52, 22, 5, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(30,18,8,0.8)'; g.lineWidth = 1.6; for (const a of [-2.6, -2.1, -1.0, -0.5]) { g.beginPath(); g.moveTo(36, 50); g.lineTo(36 + Math.cos(a) * 16, 50 + Math.sin(a) * 4 + 4); g.stroke(); }
    burst(g, 36, 44, 13, 8, 'rgba(255,240,180,0.95)');
    gearAt(g, 'club_iron', 18, 30, 1.9, 1.05);
  }],
  icon_pierce: ['#2e4a6e', 'rgba(170,210,255,0.5)', (g) => { streaks(g, 16, 48, -0.78, 3, 12); gearAt(g, 'spear_steel', 20, 46, 0.78, 0.82); burst(g, 52, 12, 6, 6); }],
  icon_sweep: ['#2a4060', 'rgba(170,210,255,0.45)', (g) => { arc(g, 32, 34, 23, Math.PI * 0.85, Math.PI * 2.15, 3, 'rgba(255,255,255,0.8)'); g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.moveTo(56, 34); g.lineTo(52, 26); g.lineTo(60, 28); g.closePath(); g.fill(); gearAt(g, 'spear_stone', 32, 40, -1.35, 0.62); }],
  icon_shoot: ['#2e5a2a', 'rgba(200,255,170,0.45)', (g) => { gearAt(g, 'bow_wood_draw', 30, 34, -0.78, 1.02); }],
  icon_aimed_shot: ['#24502a', 'rgba(255,240,170,0.45)', (g) => {
    g.strokeStyle = 'rgba(255,90,70,0.95)'; g.lineWidth = 2.4; g.beginPath(); g.arc(40, 24, 11, 0, TAU); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(40, 8); g.lineTo(40, 15); g.moveTo(40, 33); g.lineTo(40, 40); g.moveTo(24, 24); g.lineTo(31, 24); g.moveTo(49, 24); g.lineTo(56, 24); g.stroke();
    g.fillStyle = '#ff5a46'; g.beginPath(); circle(g, 40, 24, 2.2); g.fill();
    gearAt(g, 'bow_composite_draw', 24, 40, -0.78, 0.66);
  }],
  icon_multi_shot: ['#2e5a2a', 'rgba(220,255,180,0.45)', (g) => {
    for (const a of [-1.1, -0.78, -0.45]) {
      g.save(); g.translate(14, 50); g.rotate(a);
      g.fillStyle = '#c49a62'; g.fillRect(0, -1, 40, 2);
      g.fillStyle = '#c9ccd0'; g.beginPath(); g.moveTo(40, -3.6); g.lineTo(47, 0); g.lineTo(40, 3.6); g.closePath(); g.fill();
      g.fillStyle = '#e8e2d6'; g.beginPath(); g.moveTo(0, 0); g.lineTo(6, -4); g.lineTo(9, -1); g.lineTo(9, 1); g.lineTo(6, 4); g.closePath(); g.fill();
      g.restore();
    }
  }],
  // G: aimed ground abilities — a lobbed arc onto a target ring on the ground
  icon_long_shot: ['#2a5226', 'rgba(255,236,170,0.45)', (g) => {
    g.fillStyle = 'rgba(20,30,12,0.5)'; g.beginPath(); g.ellipse(49, 52, 11, 4, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,92,70,0.95)'; g.lineWidth = 2.2; g.beginPath(); g.ellipse(49, 51, 9, 3.4, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,250,225,0.9)'; g.lineWidth = 2.4; g.lineCap = 'round'; g.setLineDash([3.4, 3.4]);
    g.beginPath(); g.moveTo(17, 40); g.quadraticCurveTo(30, -2, 46, 40); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(48.5, 46); g.rotate(1.2);
    g.fillStyle = '#c49a62'; g.fillRect(-17, -1.1, 15, 2.2);
    g.fillStyle = '#dfe3e8'; g.beginPath(); g.moveTo(-3, -3.6); g.lineTo(4, 0); g.lineTo(-3, 3.6); g.closePath(); g.fill();
    g.fillStyle = '#e8e2d6'; g.beginPath(); g.moveTo(-19, 0); g.lineTo(-15, -3.6); g.lineTo(-13, -1); g.lineTo(-13, 1); g.lineTo(-15, 3.6); g.closePath(); g.fill();
    g.restore();
    gearAt(g, 'bow_wood_draw', 12, 52, -0.5, 0.55);
  }],
  icon_throw_spear: ['#2a4466', 'rgba(190,220,255,0.5)', (g) => {
    g.fillStyle = 'rgba(10,20,36,0.5)'; g.beginPath(); g.ellipse(49, 53, 11, 3.6, 0, 0, TAU); g.fill();
    burst(g, 49, 50, 7, 6, 'rgba(255,246,200,0.95)');
    g.strokeStyle = 'rgba(230,240,255,0.8)'; g.lineWidth = 2.2; g.lineCap = 'round'; g.setLineDash([3.4, 3.4]);
    g.beginPath(); g.moveTo(6, 52); g.quadraticCurveTo(6, 16, 18, 12); g.stroke(); g.setLineDash([]);
    streaks(g, 20, 13, 0.9, 3, 8, 'rgba(255,255,255,0.65)');
    gearAt(g, 'spear_iron', 18, 11, 2.5, 0.55);
  }],
  icon_disengage: ['#1f5a4a', 'rgba(170,255,230,0.45)', (g) => {
    g.strokeStyle = 'rgba(230,255,245,0.9)'; g.lineWidth = 3.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(52, 46); g.quadraticCurveTo(40, 8, 16, 24); g.stroke();
    g.fillStyle = 'rgba(230,255,245,0.95)'; g.beginPath(); g.moveTo(8, 27); g.lineTo(20, 16); g.lineTo(21, 30); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(48, 54, 10, 3, 0, 0, TAU); g.fill();
    for (const [x, y] of [[44, 50], [54, 51]]) { g.fillStyle = '#5a3a22'; g.beginPath(); g.ellipse(x, y, 4, 2.4, 0, 0, TAU); g.fill(); }
  }],
  icon_block: ['#26466e', 'rgba(190,220,255,0.5)', (g) => { gearAt(g, 'shield_iron', 32, 31, 0, 1.4); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2.4; g.beginPath(); g.arc(32, 31, 26, -2.4, -0.8); g.stroke(); }],
  icon_shield_bash: ['#2a3e66', 'rgba(255,230,170,0.5)', (g) => { streaks(g, 26, 34, 0, 3, 14); gearAt(g, 'shield_copper', 30, 34, 0, 1.15); burst(g, 52, 26, 10, 7); }],
  icon_torch_swing: ['#8a3a10', 'rgba(255,200,90,0.6)', (g) => {
    arc(g, 28, 44, 26, -2.6, -0.5, 7, 'rgba(255,150,40,0.45)'); arc(g, 28, 44, 26, -2.5, -0.6, 3, 'rgba(255,230,140,0.9)');
    gearAt(g, 'torch_hand', 26, 52, 0.55, 1.15);
    const x = 26 + Math.sin(0.55) * 32, y = 52 - Math.cos(0.55) * 32;
    g.fillStyle = 'rgba(255,120,30,0.95)'; g.beginPath(); g.moveTo(x - 7, y + 4); g.quadraticCurveTo(x - 9, y - 8, x + 1, y - 17); g.quadraticCurveTo(x + 9, y - 6, x + 7, y + 4); g.closePath(); g.fill();
    g.fillStyle = '#ffe27a'; g.beginPath(); g.moveTo(x - 3.5, y + 3); g.quadraticCurveTo(x - 4, y - 4, x + 0.5, y - 9); g.quadraticCurveTo(x + 4.5, y - 3, x + 3.5, y + 3); g.closePath(); g.fill();
  }],
  icon_craft: ['#5a4630', 'rgba(255,220,160,0.45)', (g) => {
    // anvil + hammer + sparks
    g.fillStyle = lin(g, 0, 34, 0, 56, [[0, '#9aa0a8'], [1, '#3c4046']]);
    g.beginPath(); g.moveTo(10, 36); g.lineTo(48, 36); g.quadraticCurveTo(58, 37, 60, 32); g.quadraticCurveTo(56, 44, 44, 44); g.lineTo(40, 44); g.lineTo(42, 50); g.lineTo(48, 54); g.lineTo(18, 54); g.lineTo(24, 50); g.lineTo(26, 44); g.lineTo(18, 44); g.quadraticCurveTo(10, 42, 10, 36); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(12, 36.5, 36, 1.6);
    gearAt(g, 'hammer', 40, 24, -0.9, 0.95);
    for (const [x, y, r] of [[28, 30, 1.6], [22, 26, 1.2], [34, 27, 1.1], [26, 22, 0.9]]) { g.fillStyle = '#ffd27a'; g.beginPath(); circle(g, x, y, r); g.fill(); }
  }],
  icon_mine: ['#4a4040', 'rgba(255,220,170,0.45)', (g) => {
    g.fillStyle = lin(g, 20, 34, 60, 60, [[0, '#9a948b'], [1, '#4e4a45']]);
    g.beginPath(); smoothClosed(g, [[22, 58], [24, 44], [34, 36], [48, 38], [58, 46], [60, 58]]); g.fill();
    g.fillStyle = '#e88e4e'; for (const [x, y] of [[40, 46], [50, 50], [34, 52]]) { g.beginPath(); circle(g, x, y, 2.4); g.fill(); }
    g.strokeStyle = 'rgba(40,36,32,0.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(34, 38); g.lineTo(38, 46); g.lineTo(36, 52); g.stroke();
    gearAt(g, 'pickaxe_iron', 20, 42, -0.6, 0.85);
    burst(g, 34, 36, 7, 6, 'rgba(255,246,200,0.95)');
  }],
  icon_equip: ['#3e3a5a', 'rgba(220,210,255,0.45)', (g) => {
    g.save(); g.translate(30, 34); g.scale(0.72, 0.72); g.translate(-28, -30);
    g.fillStyle = lin(g, 8, 10, 46, 48, [[0, '#c08a58'], [0.5, '#8c5a32'], [1, '#57351b']]);
    g.beginPath(); g.moveTo(8, 22); g.quadraticCurveTo(14, 10, 22, 11); g.quadraticCurveTo(28, 16, 34, 11); g.quadraticCurveTo(42, 10, 48, 22); g.lineTo(44, 26); g.lineTo(42, 48); g.lineTo(14, 48); g.lineTo(12, 26); g.closePath(); g.fill();
    g.strokeStyle = '#4a2c16'; g.lineWidth = 3; g.beginPath(); g.moveTo(14, 18); g.lineTo(42, 44); g.stroke();
    g.fillStyle = '#c9a24e'; g.fillRect(26, 28, 5, 4);
    g.restore();
    gearAt(g, 'sword_steel', 46, 50, 0.35, 0.72);
  }],
  icon_poison: ['#2e5a24', 'rgba(170,255,120,0.5)', (g) => {
    drop(g, 32, 34, 13, '#b6f06a', '#2e7a1e');
    g.fillStyle = '#1e3a14';
    g.beginPath(); g.ellipse(27, 34, 3, 3.4, 0, 0, TAU); g.ellipse(37, 34, 3, 3.4, 0, 0, TAU); g.fill();
    g.fillRect(28, 41, 8, 2.2); g.fillStyle = '#b6f06a'; g.fillRect(30, 41, 1.4, 2.2); g.fillRect(33, 41, 1.4, 2.2);
    for (const [x, y, r] of [[16, 20, 2.4], [50, 16, 2], [52, 44, 1.6]]) { g.fillStyle = 'rgba(190,255,120,0.8)'; g.beginPath(); circle(g, x, y, r); g.fill(); }
  }],
  icon_bleed: ['#5a1014', 'rgba(255,110,100,0.5)', (g) => { drop(g, 24, 34, 9, '#ff6a5a', '#7a0a10'); drop(g, 42, 26, 7, '#ff6a5a', '#7a0a10'); drop(g, 40, 48, 5, '#ff6a5a', '#7a0a10'); }],
  icon_stun: ['#4a3a6e', 'rgba(255,240,150,0.55)', (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.beginPath(); g.ellipse(32, 40, 22, 7, 0, 0, TAU); g.stroke();
    for (const [x, y, r] of [[14, 38, 6], [32, 30, 8], [50, 38, 6]]) burst(g, x, y, r, 5, '#ffe060');
  }],
  icon_arrow: ['#3a4a2a', 'rgba(230,240,180,0.45)', (g) => {
    g.save(); g.translate(32, 32); g.rotate(-0.78);
    g.fillStyle = '#c49a62'; g.fillRect(-22, -1.4, 40, 2.8);
    g.fillStyle = lin(g, 16, -5, 26, 5, [[0, '#e6e9ec'], [1, '#6c7782']]); g.beginPath(); g.moveTo(16, -5); g.lineTo(27, 0); g.lineTo(16, 5); g.lineTo(18, 0); g.closePath(); g.fill();
    g.fillStyle = '#b8402e'; g.beginPath(); g.moveTo(-24, 0); g.lineTo(-16, -6); g.lineTo(-11, -1.4); g.lineTo(-11, 1.4); g.lineTo(-16, 6); g.closePath(); g.fill();
    g.restore();
  }],
};

export function addIcons(add) {
  for (const [name, [bg, glow, fn]] of Object.entries(SYMBOLS)) add(name, icon(bg, glow, fn), 0.5, 0.5);
  for (const [name, def] of Object.entries(MORE)) { if (def) add(name, icon(def[0], def[1], def[2]), 0.5, 0.5); }
}

