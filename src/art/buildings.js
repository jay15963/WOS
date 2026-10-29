// Buildings (campfire, torch, wooden wall, chest, bed) and item icons (ground drops / HUD).

import { spritePx, rng, OW, TAU, lin, rad, circle, mixc, smoothClosed, blobPts, leaf } from './paint.js';

export const TORCH_FLAME_LIFT = 0.93; // tiles above the torch base where the flame sits
export const CAMPFIRE_FLAME_LIFT = 0.12;
// wall torches: sprite lift onto the wall face, flame height above the lifted base, flame x offset (tiles)
// wall torch bracket on the face: about mid-height of a story (art/structures.js STORY_PX; 0.3 on the old 26-px walls)
const TORCH_UP = 0.3 + Math.max(0, 1 - 26 / 64) * 0.45;
export const TORCH_WALL = { s: { lift: TORCH_UP, flame: 37 / 64, fx: 0 }, e: { lift: TORCH_UP, flame: 37 / 64, fx: 7 / 64 } };

const WOOD = { deep: '#3b2616', dark: '#5a3b22', mid: '#7d5532', light: '#9c6e43', high: '#b98a58' };

function stone(g, x, y, rx, ry, rand, col = '#8a847b') {
  const pts = blobPts(x, y, rx, ry, rand, 7, 0.16);
  g.beginPath(); smoothClosed(g, pts); g.fillStyle = mixc(col, '#3e3a35', 0.35); g.fill();
  g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
  g.fillStyle = col; g.beginPath(); g.ellipse(x - rx * 0.15, y - ry * 0.2, rx * 0.85, ry * 0.75, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,252,240,0.45)'; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.45, rx * 0.4, ry * 0.28, -0.3, 0, TAU); g.fill();
  g.restore();
}

function log(g, x0, y0, x1, y1, r, charred) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  g.save(); g.translate(x0, y0); g.rotate(a);
  g.fillStyle = lin(g, 0, -r, 0, r, [[0, WOOD.high], [0.4, WOOD.mid], [1, WOOD.deep]]);
  g.beginPath(); g.moveTo(0, -r); g.lineTo(L, -r); g.ellipse(L, 0, r * 0.45, r, 0, -Math.PI / 2, Math.PI / 2); g.lineTo(0, r); g.ellipse(0, 0, r * 0.45, r, 0, Math.PI / 2, Math.PI * 1.5); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 0.9;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(L * (0.15 + i * 0.25), -r * 0.4 + i % 2); g.lineTo(L * (0.3 + i * 0.25), -r * 0.3 + i % 2); g.stroke(); }
  if (charred) { g.fillStyle = lin(g, L * 0.55, 0, L, 0, [[0, 'rgba(20,14,10,0)'], [1, 'rgba(20,14,10,0.9)']]); g.fillRect(0, -r - 1, L + r, r * 2 + 2); }
  // cut end (start)
  g.fillStyle = '#c79a62'; g.beginPath(); g.ellipse(0, 0, r * 0.45, r * 0.92, 0, 0, TAU); g.fill();
  g.strokeStyle = '#8f663a'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(0, 0, r * 0.25, r * 0.5, 0, 0, TAU); g.stroke();
  g.restore();
}

function campfire() {
  const rand = rng(31337);
  return spritePx(80, 60, (g, P) => {
    const cx = 40, cy = 37, rx = 27, ry = 13;
    const n = 10;
    const stones = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.15; stones.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, a]); }
    // ash bed
    P.layer((g) => {
      g.fillStyle = rad(g, cx, cy, 2, rx, [[0, '#2a221c'], [0.6, '#46403a'], [1, '#5d5650']]);
      g.beginPath(); g.ellipse(cx, cy, rx - 3, ry - 1.5, 0, 0, TAU); g.fill();
      for (let i = 0; i < 18; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(150,140,130,0.5)' : 'rgba(25,20,16,0.6)'; g.beginPath(); circle(g, cx + (rand() - 0.5) * rx * 1.4, cy + (rand() - 0.5) * ry * 1.2, 0.8 + rand()); g.fill(); }
      for (let i = 0; i < 7; i++) { g.fillStyle = rand() < 0.5 ? '#e0662a' : '#f2a03a'; g.beginPath(); circle(g, cx + (rand() - 0.5) * rx * 0.9, cy + (rand() - 0.3) * ry * 0.7, 0.9 + rand() * 0.9); g.fill(); }
    }, 1.5);
    // back stones
    P.layer((g) => { for (const [x, y, a] of stones) if (Math.sin(a) < 0) stone(g, x, y, 6.2, 4.6, rand); }, 2.4);
    // logs (crossed)
    P.layer((g) => {
      log(g, cx - 3, cy - 12, cx + 1, cy - 1, 3.8, true);
      log(g, cx - 21, cy + 1, cx + 5, cy - 6, 4.2, true);
      log(g, cx + 21, cy + 2, cx - 4, cy - 6, 4.2, true);
    }, 2.4);
    // front stones
    P.layer((g) => { for (const [x, y, a] of stones) if (Math.sin(a) >= 0) stone(g, x, y, 6.4, 4.6, rand); }, 2.6);
  });
}

// glowing coal bed + ember cracks on the logs (emissive overlay while lit)
function campfireCoals() {
  const rand = rng(31338);
  return spritePx(80, 60, (g) => {
    const cx = 40, cy = 37;
    g.fillStyle = rad(g, cx, cy, 1, 20, [[0, 'rgba(255,170,70,0.85)'], [0.5, 'rgba(230,90,30,0.45)'], [1, 'rgba(160,40,10,0)']]);
    g.beginPath(); g.ellipse(cx, cy, 21, 10, 0, 0, TAU); g.fill();
    for (let i = 0; i < 14; i++) { g.fillStyle = i & 1 ? '#ffb040' : '#ffe08a'; g.beginPath(); circle(g, cx + (rand() - 0.5) * 30, cy + (rand() - 0.3) * 10, 0.7 + rand() * 1.1); g.fill(); }
    g.strokeStyle = 'rgba(255,150,60,0.9)'; g.lineWidth = 1;
    g.beginPath(); for (let i = 0; i < 6; i++) { const x = cx - 14 + rand() * 28, y = cy - 6 + rand() * 6; g.moveTo(x, y); g.lineTo(x + 3 + rand() * 3, y + (rand() - 0.5) * 2); } g.stroke();
  });
}

function torch() {
  return spritePx(26, 72, (g, P) => {
    const cx = 13;
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 3, 0, cx + 3, 0, [[0, WOOD.high], [0.5, WOOD.mid], [1, WOOD.deep]]);
      g.beginPath(); g.moveTo(cx - 2.6, 18); g.lineTo(cx + 2.6, 18); g.lineTo(cx + 3.2, 66); g.lineTo(cx - 3.2, 66); g.closePath(); g.fill();
      // little ground stake flare
      g.beginPath(); g.ellipse(cx, 66, 5, 2, 0, 0, TAU); g.fillStyle = WOOD.dark; g.fill();
      // iron band
      g.fillStyle = '#4b4b50'; g.fillRect(cx - 3.2, 22, 6.4, 3); g.fillRect(cx - 3, 40, 6, 2);
      // wrapped head
      g.fillStyle = lin(g, cx - 5, 0, cx + 5, 0, [[0, '#b29a70'], [1, '#6b5436']]);
      g.beginPath(); g.moveTo(cx - 5, 10); g.lineTo(cx + 5, 10); g.lineTo(cx + 4, 21); g.lineTo(cx - 4, 21); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,40,20,0.6)'; g.lineWidth = 1;
      for (let y = 12; y < 21; y += 3) { g.beginPath(); g.moveTo(cx - 4.6, y); g.lineTo(cx + 4.6, y + 1.5); g.stroke(); }
      g.fillStyle = '#231a14'; g.beginPath(); g.ellipse(cx, 10, 5, 2.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#e0702a'; g.beginPath(); g.ellipse(cx, 9.6, 2.6, 1.1, 0, 0, TAU); g.fill();
    }, 2.6);
  });
}

function chest() {
  return spritePx(58, 52, (g, P) => {
    P.layer((g) => {
      const x0 = 6, x1 = 52, lidTop = 8, lidBot = 22, bot = 47;
      // body front
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, WOOD.light], [0.6, WOOD.mid], [1, WOOD.dark]]);
      g.fillRect(x0, lidBot, x1 - x0, bot - lidBot);
      g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 1;
      for (const y of [30, 38]) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
      // lid (top, seen from above + front lip)
      g.fillStyle = lin(g, 0, lidTop, 0, lidBot, [[0, '#c39566'], [1, WOOD.mid]]);
      g.beginPath(); g.moveTo(x0 - 1, lidBot); g.lineTo(x0 + 1, lidTop + 2); g.quadraticCurveTo(29, lidTop - 3, x1 - 1, lidTop + 2); g.lineTo(x1 + 1, lidBot); g.closePath(); g.fill();
      g.fillStyle = 'rgba(25,14,6,0.5)'; g.fillRect(x0, lidBot, x1 - x0, 2);
      // iron bands
      g.fillStyle = '#56565c';
      for (const bx of [x0 + 7, x1 - 11]) { g.fillRect(bx, lidTop + 1, 4, bot - lidTop - 1); }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (const bx of [x0 + 7, x1 - 11]) g.fillRect(bx, lidTop + 1, 1.2, bot - lidTop - 1);
      // lock
      g.fillStyle = '#c9a24a'; g.fillRect(25.5, 20, 7, 8);
      g.fillStyle = '#2a2018'; g.beginPath(); circle(g, 29, 23.5, 1.2); g.fill(); g.fillRect(28.5, 23.5, 1, 2.5);
      g.fillStyle = 'rgba(20,12,6,0.4)'; g.fillRect(x0, bot - 5, x1 - x0, 5);
      // lid planks + grain, body board nails, corner brackets, side handles, lock shading
      g.strokeStyle = 'rgba(80,50,24,0.45)'; g.lineWidth = 0.8;
      for (const y of [12, 16.5]) { g.beginPath(); g.moveTo(x0 + 1, y); g.quadraticCurveTo(29, y - 2.2, x1 - 1, y); g.stroke(); }
      g.fillStyle = 'rgba(255,240,210,0.35)'; g.beginPath(); g.moveTo(x0 + 2, lidTop + 3); g.quadraticCurveTo(29, lidTop - 1.4, x1 - 2, lidTop + 3); g.lineTo(x1 - 2, lidTop + 4.2); g.quadraticCurveTo(29, lidTop, x0 + 2, lidTop + 4.2); g.closePath(); g.fill();
      g.fillStyle = '#2e2e32'; for (const y of [30, 38]) for (const x of [x0 + 3, x1 - 3, 20, 38]) { g.beginPath(); circle(g, x, y - 2.6, 0.7); g.fill(); }
      g.fillStyle = '#4a4a50';
      for (const [bx, by, sx, sy] of [[x0, lidBot, 1, 1], [x1, lidBot, -1, 1], [x0, bot, 1, -1], [x1, bot, -1, -1]]) {
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sx * 6, by); g.lineTo(bx, by + sy * 6); g.closePath(); g.fill();
      }
      g.strokeStyle = '#3a3a40'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x0 + 1, 33, 3, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
      g.beginPath(); g.arc(x1 - 1, 33, 3, -Math.PI * 0.5, Math.PI * 0.5); g.stroke();
      g.fillStyle = 'rgba(255,245,200,0.55)'; g.fillRect(25.5, 20, 7, 1.4);
      g.fillStyle = 'rgba(90,60,20,0.5)'; g.fillRect(25.5, 26.6, 7, 1.4);
    }, OW);
  });
}

function bed() {
  return spritePx(68, 124, (g, P) => {
    P.layer((g) => {
      const x0 = 5, x1 = 63;
      // frame
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, WOOD.light], [1, WOOD.dark]]);
      g.fillRect(x0, 10, x1 - x0, 108);
      // headboard
      g.fillStyle = lin(g, 0, 4, 0, 20, [[0, '#b98a58'], [1, WOOD.dark]]);
      g.beginPath(); g.moveTo(x0 - 1, 22); g.lineTo(x0 - 1, 8); g.quadraticCurveTo(34, 0, x1 + 1, 8); g.lineTo(x1 + 1, 22); g.closePath(); g.fill();
      g.fillStyle = WOOD.deep; g.fillRect(x0 - 1, 20, x1 - x0 + 2, 2);
      // mattress / sheet
      g.fillStyle = '#e8e0cf'; g.fillRect(x0 + 4, 22, x1 - x0 - 8, 90);
      // pillow
      g.fillStyle = lin(g, 0, 25, 0, 41, [[0, '#ffffff'], [1, '#d6cfc0']]);
      g.beginPath(); g.ellipse(34, 33, 21, 8.5, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(24, 33); g.quadraticCurveTo(34, 36, 44, 33); g.stroke();
      // blanket
      g.fillStyle = lin(g, x0, 48, x1, 112, [[0, '#6f8fb0'], [0.5, '#4f7092'], [1, '#3a5672']]);
      g.beginPath(); g.moveTo(x0 + 2, 50); g.quadraticCurveTo(34, 45, x1 - 2, 50); g.lineTo(x1 - 2, 112); g.lineTo(x0 + 2, 112); g.closePath(); g.fill();
      g.fillStyle = '#d9d2c2'; g.beginPath(); g.moveTo(x0 + 2, 50); g.quadraticCurveTo(34, 45, x1 - 2, 50); g.lineTo(x1 - 2, 56); g.quadraticCurveTo(34, 51, x0 + 2, 56); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,45,65,0.5)'; g.lineWidth = 1.2;
      for (const y of [72, 92]) { g.beginPath(); g.moveTo(x0 + 2, y); g.quadraticCurveTo(34, y + 3, x1 - 2, y); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0 + 4, 58, 10, 50);
      // quilt patchwork + stitching
      g.save(); g.beginPath(); g.moveTo(x0 + 2, 56); g.quadraticCurveTo(34, 51, x1 - 2, 56); g.lineTo(x1 - 2, 112); g.lineTo(x0 + 2, 112); g.closePath(); g.clip();
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) if ((r + c) & 1) { g.fillStyle = 'rgba(170,190,215,0.22)'; g.fillRect(x0 + 2 + c * 14.5, 56 + r * 12, 14.5, 12); }
      g.strokeStyle = 'rgba(230,236,245,0.35)'; g.lineWidth = 0.7; g.setLineDash([1.6, 1.6]);
      g.beginPath(); for (let c = 1; c < 4; c++) { g.moveTo(x0 + 2 + c * 14.5, 54); g.lineTo(x0 + 2 + c * 14.5, 112); } for (let r = 1; r < 5; r++) { g.moveTo(x0 + 2, 56 + r * 12); g.lineTo(x1 - 2, 56 + r * 12); } g.stroke();
      g.setLineDash([]); g.restore();
      // folded throw at the foot
      g.fillStyle = '#a3473a'; g.fillRect(x0 + 3, 98, x1 - x0 - 6, 9);
      g.fillStyle = 'rgba(255,220,200,0.3)'; g.fillRect(x0 + 3, 98, x1 - x0 - 6, 1.4);
      g.fillStyle = '#d9b45a'; g.fillRect(x0 + 3, 103, x1 - x0 - 6, 1.2);
      // headboard posts with knobs
      for (const x of [x0 - 1, x1 - 3]) { g.fillStyle = WOOD.dark; g.fillRect(x, 4, 4, 18); g.fillStyle = WOOD.high; g.beginPath(); circle(g, x + 2, 4, 2.6); g.fill(); }
      g.strokeStyle = 'rgba(60,36,18,0.5)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x0 + 6, 13); g.quadraticCurveTo(34, 6, x1 - 6, 13); g.stroke();
      // footboard
      g.fillStyle = lin(g, 0, 110, 0, 120, [[0, '#a77a4c'], [1, WOOD.deep]]);
      g.fillRect(x0 - 1, 111, x1 - x0 + 2, 9);
      g.fillStyle = 'rgba(255,235,200,0.35)'; g.fillRect(x0 - 1, 111, x1 - x0 + 2, 1.2);
    }, OW);
  });
}

// bed turned around (head to the south): footboard far, pillow and headboard near the viewer (1×2 box)
function bedSouth() {
  return spritePx(68, 124, (g, P) => {
    P.layer((g) => {
      const x0 = 5, x1 = 63;
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, WOOD.light], [1, WOOD.dark]]);
      g.fillRect(x0, 6, x1 - x0, 112);
      // footboard (far end, low)
      g.fillStyle = lin(g, 0, 2, 0, 12, [[0, '#a77a4c'], [1, WOOD.deep]]);
      g.fillRect(x0 - 1, 3, x1 - x0 + 2, 9);
      g.fillStyle = 'rgba(255,235,200,0.35)'; g.fillRect(x0 - 1, 3, x1 - x0 + 2, 1.2);
      // sheet + blanket from the foot
      g.fillStyle = '#e8e0cf'; g.fillRect(x0 + 4, 12, x1 - x0 - 8, 92);
      g.fillStyle = lin(g, x0, 12, x1, 80, [[0, '#6f8fb0'], [0.5, '#4f7092'], [1, '#3a5672']]);
      g.beginPath(); g.moveTo(x0 + 2, 12); g.lineTo(x1 - 2, 12); g.lineTo(x1 - 2, 74); g.quadraticCurveTo(34, 79, x0 + 2, 74); g.closePath(); g.fill();
      g.fillStyle = '#d9d2c2'; g.beginPath(); g.moveTo(x0 + 2, 68); g.quadraticCurveTo(34, 73, x1 - 2, 68); g.lineTo(x1 - 2, 74); g.quadraticCurveTo(34, 79, x0 + 2, 74); g.closePath(); g.fill();
      g.save(); g.beginPath(); g.rect(x0 + 2, 12, x1 - x0 - 4, 56); g.clip();
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) if ((r + c) & 1) { g.fillStyle = 'rgba(170,190,215,0.22)'; g.fillRect(x0 + 2 + c * 14.5, 12 + r * 12, 14.5, 12); }
      g.strokeStyle = 'rgba(230,236,245,0.35)'; g.lineWidth = 0.7; g.setLineDash([1.6, 1.6]);
      g.beginPath(); for (let c = 1; c < 4; c++) { g.moveTo(x0 + 2 + c * 14.5, 12); g.lineTo(x0 + 2 + c * 14.5, 68); } for (let r = 1; r < 5; r++) { g.moveTo(x0 + 2, 12 + r * 12); g.lineTo(x1 - 2, 12 + r * 12); } g.stroke();
      g.setLineDash([]); g.restore();
      // folded throw at the foot
      g.fillStyle = '#a3473a'; g.fillRect(x0 + 3, 16, x1 - x0 - 6, 9);
      g.fillStyle = '#d9b45a'; g.fillRect(x0 + 3, 21, x1 - x0 - 6, 1.2);
      // pillow near the viewer
      g.fillStyle = lin(g, 0, 82, 0, 100, [[0, '#ffffff'], [1, '#d6cfc0']]);
      g.beginPath(); g.ellipse(34, 90, 21, 8.5, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(24, 90); g.quadraticCurveTo(34, 93, 44, 90); g.stroke();
      // headboard: front panel with posts
      g.fillStyle = lin(g, 0, 100, 0, 121, [[0, '#b98a58'], [1, WOOD.deep]]);
      g.beginPath(); g.moveTo(x0 - 1, 121); g.lineTo(x0 - 1, 104); g.quadraticCurveTo(34, 97, x1 + 1, 104); g.lineTo(x1 + 1, 121); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,36,18,0.5)'; g.lineWidth = 0.9;
      for (const y of [109, 115]) { g.beginPath(); g.moveTo(x0 + 3, y); g.lineTo(x1 - 3, y); g.stroke(); }
      g.fillStyle = 'rgba(255,235,200,0.35)'; g.beginPath(); g.moveTo(x0 + 2, 104.5); g.quadraticCurveTo(34, 98, x1 - 2, 104.5); g.lineTo(x1 - 2, 106); g.quadraticCurveTo(34, 99.5, x0 + 2, 106); g.closePath(); g.fill();
      for (const x of [x0 - 1, x1 - 3]) { g.fillStyle = WOOD.dark; g.fillRect(x, 100, 4, 21); g.fillStyle = WOOD.high; g.beginPath(); circle(g, x + 2, 100, 2.6); g.fill(); }
    }, OW);
  });
}

// bed lying east-west (2×1 box, headboard on the west, foot on the east); Y(v, h) = ground row v, height h
function bedEast() {
  const E = 26, W = 132;
  const Y = (v, h) => E + v * 64 - h;
  return spritePx(W, 64 + E, (g, P) => {
    P.layer((g) => {
      const x0 = 8, x1 = W - 6, v0 = 0.1, v1 = 0.9, top = 13;
      // frame side (south face) + top
      g.fillStyle = lin(g, 0, Y(v1, top), 0, Y(v1, 0), [[0, WOOD.mid], [1, WOOD.deep]]);
      g.fillRect(x0, Y(v1, top), x1 - x0, top);
      g.fillStyle = lin(g, 0, Y(v0, top), 0, Y(v1, top), [[0, WOOD.light], [1, WOOD.dark]]);
      g.fillRect(x0, Y(v0, top + 2), x1 - x0, Y(v1, top) - Y(v0, top + 2));
      // sheet
      g.fillStyle = '#e8e0cf'; g.fillRect(x0 + 3, Y(v0 + 0.05, top + 3), x1 - x0 - 8, Y(v1 - 0.04, top + 3) - Y(v0 + 0.05, top + 3));
      // pillow (west)
      g.fillStyle = lin(g, x0 + 6, 0, x0 + 26, 0, [[0, '#ffffff'], [1, '#d6cfc0']]);
      g.beginPath(); g.ellipse(x0 + 17, Y(0.5, top + 5), 9, 18, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(120,110,95,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + 17, Y(0.3, top + 5)); g.quadraticCurveTo(x0 + 20, Y(0.5, top + 5), x0 + 17, Y(0.7, top + 5)); g.stroke();
      // blanket over the body, draping on the south side
      const bx = x0 + 34;
      g.fillStyle = lin(g, bx, Y(v0, top), x1, Y(v1, 0), [[0, '#6f8fb0'], [0.5, '#4f7092'], [1, '#3a5672']]);
      g.beginPath(); g.moveTo(bx, Y(v0 + 0.03, top + 4)); g.lineTo(x1 - 3, Y(v0 + 0.03, top + 4)); g.lineTo(x1 - 3, Y(v1, 2)); g.lineTo(bx + 2, Y(v1, 2)); g.quadraticCurveTo(bx - 4, Y(0.5, top + 4), bx, Y(v0 + 0.03, top + 4)); g.closePath(); g.fill();
      g.fillStyle = '#d9d2c2'; g.beginPath(); g.moveTo(bx, Y(v0 + 0.03, top + 4)); g.quadraticCurveTo(bx - 4, Y(0.5, top + 4), bx + 2, Y(v1, 2)); g.lineTo(bx + 8, Y(v1, 2)); g.quadraticCurveTo(bx + 2, Y(0.5, top + 4), bx + 6, Y(v0 + 0.03, top + 4)); g.closePath(); g.fill();
      g.save(); g.beginPath(); g.rect(bx + 7, Y(v0, top + 6), x1 - bx - 10, Y(v1, 0) - Y(v0, top + 6)); g.clip();
      for (let c = 0; c < 6; c++) for (let r = 0; r < 4; r++) if ((r + c) & 1) { g.fillStyle = 'rgba(170,190,215,0.22)'; g.fillRect(bx + 7 + c * 13.5, Y(v0, top + 4) + r * 13, 13.5, 13); }
      g.restore();
      g.strokeStyle = 'rgba(30,45,65,0.5)'; g.lineWidth = 1.1;
      for (const x of [bx + 34, bx + 62]) { g.beginPath(); g.moveTo(x, Y(v0 + 0.03, top + 4)); g.quadraticCurveTo(x + 3, Y(0.5, top + 4), x, Y(v1, 3)); g.stroke(); }
      // folded throw at the foot (east)
      g.fillStyle = '#a3473a'; g.fillRect(x1 - 18, Y(v0 + 0.03, top + 4), 9, Y(v1, 2) - Y(v0 + 0.03, top + 4));
      g.fillStyle = '#d9b45a'; g.fillRect(x1 - 13, Y(v0 + 0.03, top + 4), 1.2, Y(v1, 2) - Y(v0 + 0.03, top + 4));
      // headboard (west, tall) and footboard (east, low): boards across the bed, seen from the south
      const board = (xa, xb, hTop) => {
        g.fillStyle = lin(g, 0, Y(v0, hTop), 0, Y(v1, 0), [[0, '#b98a58'], [1, WOOD.deep]]);
        g.beginPath(); g.moveTo(xa, Y(v1, 0)); g.lineTo(xa, Y(v0, hTop)); g.lineTo(xb, Y(v0, hTop)); g.lineTo(xb, Y(v1, 0)); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,235,200,0.35)'; g.fillRect(xa, Y(v0, hTop), xb - xa, 1.3);
        g.fillStyle = WOOD.high; g.beginPath(); circle(g, (xa + xb) / 2, Y(v0, hTop + 1), 2.6); g.fill();
        g.beginPath(); circle(g, (xa + xb) / 2, Y(v1, hTop - 9) , 2.2); g.fill();
      };
      board(x0 - 4, x0 + 4, 32);
      board(x1 - 4, x1 + 3, 21);
    }, OW);
  });
}

// chest with the lid swung open (while the local player has it open): lid inside, contents peeking out
function chestOpen() {
  const rand = rng(4242);
  return spritePx(58, 60, (g, P) => {
    P.layer((g) => {
      const x0 = 6, x1 = 52, rim = 30, bot = 55;
      // lid standing open behind the body (its inside faces us)
      g.fillStyle = lin(g, 0, 2, 0, rim, [[0, '#8a5f38'], [1, '#5a3b22']]);
      g.beginPath(); g.moveTo(x0, rim); g.lineTo(x0 + 2, 6); g.quadraticCurveTo(29, 1, x1 - 2, 6); g.lineTo(x1, rim); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 0.8;
      for (const y of [12, 19, 25]) { g.beginPath(); g.moveTo(x0 + 2, y); g.lineTo(x1 - 2, y); g.stroke(); }
      g.fillStyle = '#56565c'; for (const bx of [x0 + 7, x1 - 11]) g.fillRect(bx, 6, 4, rim - 6);
      // opening: dark inside with a few things
      g.fillStyle = '#2a1a0e'; g.fillRect(x0 + 2, rim - 2, x1 - x0 - 4, 8);
      for (const [x, c] of [[16, '#9c6e43'], [24, '#8a857e'], [33, '#c9a24a'], [41, '#b8233a']]) { g.fillStyle = c; g.beginPath(); g.ellipse(x + (rand() - 0.5) * 2, rim + 1, 3.6, 2.4, 0, 0, TAU); g.fill(); }
      // body front (as the closed chest)
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, WOOD.light], [0.6, WOOD.mid], [1, WOOD.dark]]);
      g.fillRect(x0, rim + 4, x1 - x0, bot - rim - 4);
      g.fillStyle = '#b48a5a'; g.fillRect(x0 - 1, rim + 3, x1 - x0 + 2, 3);
      g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 1;
      for (const y of [rim + 12, rim + 19]) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
      g.fillStyle = '#56565c'; for (const bx of [x0 + 7, x1 - 11]) g.fillRect(bx, rim + 4, 4, bot - rim - 4);
      g.fillStyle = '#c9a24a'; g.fillRect(25.5, rim + 4, 7, 6);
      g.fillStyle = 'rgba(20,12,6,0.4)'; g.fillRect(x0, bot - 5, x1 - x0, 5);
    }, OW);
  });
}

// chest seen from the back (turned north): plain boards, hinges, no lock
function chestBack() {
  return spritePx(58, 52, (g, P) => {
    P.layer((g) => {
      const x0 = 6, x1 = 52, lidTop = 8, lidBot = 22, bot = 47;
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, WOOD.mid], [1, WOOD.deep]]);
      g.fillRect(x0, lidBot, x1 - x0, bot - lidBot);
      g.strokeStyle = 'rgba(40,24,12,0.55)'; g.lineWidth = 1;
      for (const y of [29, 35, 41]) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
      g.fillStyle = lin(g, 0, lidTop, 0, lidBot, [[0, '#b88b5d'], [1, WOOD.dark]]);
      g.beginPath(); g.moveTo(x0 - 1, lidBot); g.lineTo(x0 + 1, lidTop + 2); g.quadraticCurveTo(29, lidTop - 3, x1 - 1, lidTop + 2); g.lineTo(x1 + 1, lidBot); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(80,50,24,0.45)'; g.lineWidth = 0.8;
      for (const y of [12, 16.5]) { g.beginPath(); g.moveTo(x0 + 1, y); g.quadraticCurveTo(29, y - 2.2, x1 - 1, y); g.stroke(); }
      g.fillStyle = '#56565c';
      for (const bx of [x0 + 7, x1 - 11]) g.fillRect(bx, lidTop + 1, 4, bot - lidTop - 1);
      // hinges at the lid edge
      g.fillStyle = '#3e3e44';
      for (const hx of [x0 + 14, x1 - 18]) { g.fillRect(hx, lidBot - 2, 7, 5); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(hx, lidBot - 2, 7, 1); g.fillStyle = '#3e3e44'; }
      g.fillStyle = 'rgba(20,12,6,0.45)'; g.fillRect(x0, bot - 5, x1 - x0, 5);
    }, OW);
  });
}

// chest turned sideways (front = lock facing east): lid seen from above, end panel toward the viewer
function chestSide() {
  return spritePx(46, 82, (g, P) => {
    P.layer((g) => {
      const x0 = 5, x1 = 41, top0 = 22, top1 = 52, bot = 78; // lid rows top0..top1 (foreshortened like the front view), end panel top1..bot
      // lid (barrel top along N-S)
      g.fillStyle = lin(g, x0, 0, x1, 0, [[0, '#9a6e43'], [0.45, '#c39566'], [1, WOOD.mid]]);
      g.beginPath(); g.moveTo(x0, top1); g.lineTo(x0, top0 + 3); g.quadraticCurveTo(x0, top0, x0 + 4, top0); g.lineTo(x1 - 4, top0); g.quadraticCurveTo(x1, top0, x1, top0 + 3); g.lineTo(x1, top1); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(80,50,24,0.45)'; g.lineWidth = 0.8;
      for (const x of [x0 + 11, x0 + 24]) { g.beginPath(); g.moveTo(x, top0 + 1); g.lineTo(x, top1); g.stroke(); }
      g.fillStyle = 'rgba(255,240,210,0.3)'; g.fillRect(x0 + 13, top0 + 1, 3, top1 - top0 - 1);
      // iron bands across the lid
      g.fillStyle = '#56565c'; for (const y of [top0 + 5, top1 - 9]) g.fillRect(x0, y, x1 - x0, 4);
      g.fillStyle = 'rgba(255,255,255,0.3)'; for (const y of [top0 + 5, top1 - 9]) g.fillRect(x0, y, x1 - x0, 1.1);
      // lock on the east side
      g.fillStyle = '#c9a24a'; g.fillRect(x1 - 4, (top0 + top1) / 2 - 4, 5, 8);
      g.fillStyle = '#2a2018'; g.fillRect(x1 - 2, (top0 + top1) / 2 - 1, 1.2, 3);
      // end panel (south) with the lid arch and a rope handle
      g.fillStyle = lin(g, 0, top1, 0, bot, [[0, WOOD.mid], [1, WOOD.dark]]);
      g.fillRect(x0, top1, x1 - x0, bot - top1);
      g.fillStyle = lin(g, 0, top1 - 4, 0, top1 + 8, [[0, '#b48a5a'], [1, WOOD.mid]]);
      g.beginPath(); g.moveTo(x0, top1 + 8); g.quadraticCurveTo((x0 + x1) / 2, top1 - 5, x1, top1 + 8); g.closePath(); g.fill();
      g.fillStyle = 'rgba(25,14,6,0.5)'; g.fillRect(x0, top1 + 8, x1 - x0, 1.6);
      g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 1;
      for (const y of [top1 + 15, top1 + 21]) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
      g.fillStyle = '#4a4a50';
      for (const [bx, by, sx, sy] of [[x0, top1 + 9, 1, 1], [x1, top1 + 9, -1, 1], [x0, bot, 1, -1], [x1, bot, -1, -1]]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sx * 5, by); g.lineTo(bx, by + sy * 5); g.closePath(); g.fill(); }
      g.strokeStyle = '#c8b27a'; g.lineWidth = 1.6; g.beginPath(); g.arc((x0 + x1) / 2, top1 + 15, 4, 0.1, Math.PI - 0.1); g.stroke();
      g.fillStyle = 'rgba(20,12,6,0.4)'; g.fillRect(x0, bot - 4, x1 - x0, 4);
    }, OW);
  });
}

// wall torches: an iron bracket on the wall face holding a torch leaning out (s: front wall, e: west wall)
function torchWall(side) {
  return spritePx(side ? 30 : 26, 48, (g, P) => {
    P.layer((g) => {
      if (!side) {
        const cx = 13;
        g.fillStyle = lin(g, cx - 6, 0, cx + 6, 0, [[0, '#6e6e78'], [1, '#2c2c31']]);
        g.beginPath(); g.roundRect ? g.roundRect(cx - 6, 30, 12, 15, 2) : g.rect(cx - 6, 30, 12, 15); g.fill();
        g.fillStyle = '#1e1e22'; for (const y of [33, 41]) { g.beginPath(); circle(g, cx, y, 1.1); g.fill(); }
        g.strokeStyle = '#4a4a52'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx, 36); g.lineTo(cx, 28); g.stroke();
        g.fillStyle = lin(g, cx - 3, 0, cx + 3, 0, [[0, WOOD.high], [0.5, WOOD.mid], [1, WOOD.deep]]);
        g.beginPath(); g.moveTo(cx - 2.4, 13); g.lineTo(cx + 2.4, 13); g.lineTo(cx + 2.8, 34); g.lineTo(cx - 2.8, 34); g.closePath(); g.fill();
        g.fillStyle = '#4b4b50'; g.fillRect(cx - 3.6, 26, 7.2, 3.2);
        g.fillStyle = lin(g, cx - 5, 0, cx + 5, 0, [[0, '#b29a70'], [1, '#6b5436']]);
        g.beginPath(); g.moveTo(cx - 4.6, 6); g.lineTo(cx + 4.6, 6); g.lineTo(cx + 3.8, 15); g.lineTo(cx - 3.8, 15); g.closePath(); g.fill();
        g.fillStyle = '#231a14'; g.beginPath(); g.ellipse(cx, 6, 4.6, 2, 0, 0, TAU); g.fill();
        g.fillStyle = '#e0702a'; g.beginPath(); g.ellipse(cx, 5.7, 2.4, 1, 0, 0, TAU); g.fill();
      } else {
        // plate on the left (west wall), arm and torch leaning east
        g.fillStyle = lin(g, 1, 0, 7, 0, [[0, '#6e6e78'], [1, '#2c2c31']]);
        g.fillRect(2, 24, 5, 20);
        g.fillStyle = '#1e1e22'; for (const y of [28, 40]) { g.beginPath(); circle(g, 4.5, y, 1); g.fill(); }
        g.strokeStyle = '#4a4a52'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(6, 36); g.lineTo(13, 30); g.stroke();
        g.save(); g.translate(15, 31); g.rotate(0.38);
        g.fillStyle = lin(g, -3, 0, 3, 0, [[0, WOOD.high], [0.5, WOOD.mid], [1, WOOD.deep]]);
        g.beginPath(); g.moveTo(-2.4, -20); g.lineTo(2.4, -20); g.lineTo(2.8, 4); g.lineTo(-2.8, 4); g.closePath(); g.fill();
        g.fillStyle = '#4b4b50'; g.fillRect(-3.6, -3, 7.2, 3.2);
        g.fillStyle = lin(g, -5, 0, 5, 0, [[0, '#b29a70'], [1, '#6b5436']]);
        g.beginPath(); g.moveTo(-4.6, -28); g.lineTo(4.6, -28); g.lineTo(3.8, -19); g.lineTo(-3.8, -19); g.closePath(); g.fill();
        g.fillStyle = '#231a14'; g.beginPath(); g.ellipse(0, -28, 4.6, 2, 0, 0, TAU); g.fill();
        g.fillStyle = '#e0702a'; g.beginPath(); g.ellipse(0, -28.3, 2.4, 1, 0, 0, TAU); g.fill();
        g.restore();
      }
    }, 2.4);
  });
}

// ---------------- items ----------------
// items keep a fixed 36×36 box (uniform HUD icons); content is scaled a touch so outlines never clip
function item(fn) {
  return spritePx(36, 36, (g, P) => P.layer((g) => { g.translate(18, 18); g.scale(0.9, 0.9); g.translate(-18, -18); fn(g, rng(fn.length * 99 + 1)); }, 2.3), { crop: false });
}

const ITEMS = {
  item_wood: (g) => {
    log(g, 7, 25, 29, 21, 4, false); log(g, 6, 18, 28, 15, 4, false); log(g, 12, 11.5, 30, 9, 3.6, false);
  },
  item_stone: (g, rand) => {
    stone(g, 13, 22, 8.5, 6.5, rand, '#8a857e'); stone(g, 23, 20, 7, 6, rand, '#7c776f'); stone(g, 18, 13.5, 6, 4.8, rand, '#96918a');
  },
  item_berries: (g) => {
    g.fillStyle = '#4d7a32'; g.beginPath(); leaf(g, 18, 12, 29, 6, 4, 1); g.fill();
    g.fillStyle = '#3a5f26'; g.beginPath(); leaf(g, 17, 12, 8, 6.5, 3.4, -1); g.fill();
    for (const [x, y] of [[12, 18], [19, 17], [25, 19], [15, 24], [22, 25], [18.5, 30]]) {
      g.fillStyle = '#5a0f1c'; g.beginPath(); circle(g, x, y, 4.4); g.fill();
      g.fillStyle = '#b8233a'; g.beginPath(); circle(g, x - 0.4, y - 0.4, 3.6); g.fill();
      g.fillStyle = '#ffd6dc'; g.beginPath(); circle(g, x - 1.5, y - 1.6, 0.9); g.fill();
    }
  },
  item_meat: (g) => {
    g.fillStyle = '#e9e2d0'; g.beginPath(); g.ellipse(29, 12, 3.2, 3.2, 0, 0, TAU); g.ellipse(31, 15, 3, 3, 0, 0, TAU); g.fill();
    g.fillStyle = '#e9e2d0'; g.fillRect(24, 12, 6, 4);
    g.beginPath(); smoothClosed(g, [[6, 20], [9, 11], [18, 8], [26, 12], [27, 20], [21, 28], [11, 29]]);
    g.fillStyle = lin(g, 6, 8, 27, 29, [[0, '#e0605e'], [0.5, '#b8343a'], [1, '#7e1e26']]); g.fill();
    g.strokeStyle = 'rgba(255,225,215,0.85)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(10, 16); g.quadraticCurveTo(15, 13, 20, 16); g.quadraticCurveTo(23, 19, 21, 23); g.stroke();
    g.fillStyle = '#f2d6c8'; g.beginPath(); g.ellipse(12, 23, 3, 1.8, 0.4, 0, TAU); g.fill();
  },
  item_cooked: (g) => {
    g.fillStyle = '#efe7d6'; g.fillRect(22, 9, 4, 9);
    g.beginPath(); circle(g, 23, 8, 2.8); circle(g, 26.5, 8.5, 2.6); g.fill();
    g.beginPath(); smoothClosed(g, [[8, 28], [6, 19], [11, 13], [19, 12], [25, 17], [24, 25], [16, 30]]);
    g.fillStyle = lin(g, 6, 12, 25, 30, [[0, '#d38a3e'], [0.5, '#a0561f'], [1, '#6a3412']]); g.fill();
    g.fillStyle = 'rgba(255,230,170,0.6)'; g.beginPath(); g.ellipse(12, 17, 4, 2.2, -0.6, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60,24,6,0.6)'; g.lineWidth = 1.2;
    for (const [x, y] of [[11, 23], [16, 22], [19, 26]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y - 2); g.stroke(); }
  },
  item_leather: (g) => {
    g.beginPath(); smoothClosed(g, [[6, 12], [11, 7], [18, 9], [25, 6], [30, 11], [28, 18], [31, 25], [25, 30], [18, 27], [10, 30], [5, 25], [8, 18]]);
    g.fillStyle = lin(g, 5, 6, 31, 30, [[0, '#c39364'], [0.6, '#9a6c42'], [1, '#6e4a2a']]); g.fill();
    g.strokeStyle = 'rgba(70,44,22,0.7)'; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.beginPath(); smoothClosed(g, [[10, 13], [13, 10.5], [18, 12], [24, 10], [27, 13], [25.5, 18], [27, 23.5], [24, 26.5], [18, 24], [12, 26.5], [9, 23.5], [11, 18]]); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,235,200,0.3)'; g.beginPath(); g.ellipse(14, 14, 4.5, 2.5, -0.4, 0, TAU); g.fill();
  },
  item_fiber: (g, rand) => {
    for (let i = 0; i < 11; i++) {
      const a = -0.5 + (i / 10) * 1.0;
      g.strokeStyle = mixc('#8f9a4c', '#c2b67a', rand()); g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(18 + Math.sin(a) * 2, 29); g.quadraticCurveTo(18 + a * 6, 18, 18 + a * 16, 5 + Math.abs(a) * 6); g.stroke();
    }
    g.fillStyle = '#7a5a34'; g.beginPath(); g.ellipse(18, 21, 5.5, 2.6, 0, 0, TAU); g.fill();
    g.fillStyle = '#a58052'; g.fillRect(12.5, 19.6, 11, 1.2);
  },
  item_ore: (g, rand) => {
    stone(g, 18, 20, 12, 9.5, rand, '#5d5a57');
    for (const [x, y, r] of [[13, 18, 2.6], [21, 16, 2.2], [19, 24, 2.4], [25, 21, 1.6], [12, 24, 1.4]]) {
      g.fillStyle = '#7a4a26'; g.beginPath(); circle(g, x, y, r + 0.6); g.fill();
      g.fillStyle = '#d48a4a'; g.beginPath(); circle(g, x - 0.3, y - 0.3, r); g.fill();
      g.fillStyle = '#ffd7a0'; g.beginPath(); circle(g, x - r * 0.4, y - r * 0.4, r * 0.35); g.fill();
    }
  },
};

export function addBuildings(add) {
  { const c = campfire(); add('campfire', c, 0.5, 40 / (c.origH || c.height)); }
  { const c = campfireCoals(); add('campfire_coals', c, 0.5, 40 / (c.origH || c.height)); }
  { const c = torch(); add('torch', c, 0.5, 67 / (c.origH || c.height)); }
  { const c = chest(); add('chest', c, 0.5, 49 / (c.origH || c.height)); }
  { const c = bed(); add('bed', c, 0.5, 121 / (c.origH || c.height)); }
  // facing variants (rotation / edge placement): <type>_n, <type>_e (west = east mirrored)
  { const c = bedSouth(); add('bed_n', c, 0.5, 121 / (c.origH || c.height)); }
  add('bed_e', bedEast(), 0.5, 1);
  { const c = chestBack(); add('chest_n', c, 0.5, 49 / (c.origH || c.height)); }
  add('chest_e', chestSide(), 0.5, 79 / 82);
  { const c = chestOpen(); add('chest_open', c, 0.5, 57 / (c.origH || c.height)); }
  add('torch_wall_s', torchWall(false), 0.5, 1);
  add('torch_wall_e', torchWall(true), 0.5, 1);
}

// Legacy item icons (item_wood ... item_ore). Items now belong to Art B: these only fill names that no other
// module registered (called by sprites.js after every step).
export function addLegacyItems(add, has) {
  for (const k of Object.keys(ITEMS)) if (!has(k)) add(k, item(ITEMS[k]), 0.5, 0.82);
}
