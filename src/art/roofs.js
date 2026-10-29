// Roof & column art for the atlas (agent J): columns (wood / stone), build-menu icons of the three roof types and
// two solid helper sprites (roof sun-shadow casters). The roofs themselves are painted per region at runtime by
// src/art/roofRaster.js (not in the atlas).

import { spritePx, rng, lin, mixc, TAU, circle, canvas } from './paint.js';

const mk = (wt, E, fn, opts) => spritePx(Math.round(wt * 64), 64 + E, (g, P) => fn(g, P, (v, h) => E + v * 64 - h, Math.round(wt * 64)), { pad: 12, ...opts });
const WOOD = { deep: '#3b2616', dark: '#5a3b22', mid: '#7d5532', light: '#9c6e43', high: '#b98a58' };
const STONE = { dark: '#6c665d', mid: '#9c958a', light: '#bdb6aa', high: '#d6d0c4' };

// wooden post on a stone footing with a bracketed capital (a bit taller than the walls: it carries the roof)
function columnWood() {
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, base = Y(0.78, 0), top = Y(0.78, 52);
    g.fillStyle = 'rgba(40,28,16,0.3)'; g.beginPath(); g.ellipse(cx, base, 17, 5, 0, 0, TAU); g.fill();
    P.layer((g) => {
      // footing
      g.fillStyle = STONE.mid; g.fillRect(cx - 10, base - 7, 20, 8);
      g.fillStyle = STONE.high; g.fillRect(cx - 10, base - 7, 20, 1.5);
      g.fillStyle = STONE.dark; g.fillRect(cx - 10, base - 1.5, 20, 1.5);
      // post (round log, lit from the left)
      g.fillStyle = lin(g, cx - 6, 0, cx + 6, 0, [[0, WOOD.high], [0.35, WOOD.light], [0.75, WOOD.mid], [1, WOOD.dark]]);
      g.fillRect(cx - 6, top + 4, 12, base - 7 - top - 4);
      g.strokeStyle = 'rgba(60,36,18,0.45)'; g.lineWidth = 0.8;
      g.beginPath(); for (const x of [-3, 0.5, 3.5]) { g.moveTo(cx + x, top + 7); g.lineTo(cx + x + 0.4, base - 9); } g.stroke();
      // capital: a beam block with two brackets
      g.fillStyle = WOOD.dark; g.beginPath(); g.moveTo(cx - 6, top + 12); g.lineTo(cx - 13, top + 4); g.lineTo(cx - 6, top + 4); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx + 6, top + 12); g.lineTo(cx + 13, top + 4); g.lineTo(cx + 6, top + 4); g.closePath(); g.fill();
      g.fillStyle = lin(g, 0, top - 2, 0, top + 5, [[0, WOOD.high], [1, WOOD.mid]]);
      g.fillRect(cx - 15, top - 2, 30, 7);
      g.fillStyle = 'rgba(255,236,200,0.45)'; g.fillRect(cx - 15, top - 2, 30, 1.2);
    }, 2.6);
  });
}

// dressed stone pillar: base, fluted shaft, capital
function columnStone() {
  const rand = rng(771);
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, base = Y(0.78, 0), top = Y(0.78, 52);
    g.fillStyle = 'rgba(40,28,16,0.3)'; g.beginPath(); g.ellipse(cx, base, 18, 5.5, 0, 0, TAU); g.fill();
    P.layer((g) => {
      g.fillStyle = STONE.mid; g.fillRect(cx - 12, base - 8, 24, 9);
      g.fillStyle = STONE.high; g.fillRect(cx - 12, base - 8, 24, 1.6);
      g.fillStyle = STONE.dark; g.fillRect(cx - 12, base - 1.6, 24, 1.6);
      g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, STONE.high], [0.3, STONE.light], [0.7, STONE.mid], [1, STONE.dark]]);
      g.fillRect(cx - 8, top + 5, 16, base - 8 - top - 5);
      g.strokeStyle = 'rgba(70,64,56,0.5)'; g.lineWidth = 0.9;
      g.beginPath(); for (const x of [-4.5, -1.5, 1.5, 4.5]) { g.moveTo(cx + x, top + 7); g.lineTo(cx + x, base - 10); } g.stroke();
      // drum joints + chisel specks
      g.strokeStyle = 'rgba(60,54,46,0.6)'; g.lineWidth = 0.8;
      g.beginPath(); for (const y of [0.35, 0.68]) { const yy = top + 5 + (base - 13 - top) * y; g.moveTo(cx - 8, yy); g.lineTo(cx + 8, yy); } g.stroke();
      for (let i = 0; i < 10; i++) { g.fillStyle = i & 1 ? 'rgba(255,255,245,0.3)' : 'rgba(30,26,20,0.3)'; g.fillRect(cx - 7 + rand() * 14, top + 7 + rand() * (base - top - 16), 1.1, 1.1); }
      // capital
      g.fillStyle = STONE.light; g.fillRect(cx - 14, top - 2, 28, 7);
      g.fillStyle = STONE.high; g.fillRect(cx - 14, top - 2, 28, 1.6);
      g.fillStyle = STONE.mid; g.fillRect(cx - 11, top + 5, 22, 3);
    }, 2.6);
  });
}

// build-menu icon of a roof type: a little house with that roof (front gable)
function roofIcon(kind) {
  const rand = rng(kind.length * 31 + 7);
  const C = kind === 'thatch' ? { base: '#c79e52', dark: '#6e5226', light: '#efd38a' }
    : kind === 'wood' ? { base: '#8f6138', dark: '#43291a', light: '#bb8a5a' }
      : { base: '#5c7090', dark: '#26324a', light: '#98aac4' };
  return mk(1, 20, (g, P, Y, W) => {
    const cx = W / 2, eave = Y(0.62, 14), peak = Y(0.62, 58), x0 = cx - 30, x1 = cx + 30;
    P.layer((g) => {
      // wall + door
      g.fillStyle = '#d9cdb0'; g.fillRect(cx - 24, eave, 48, Y(0.62, 0) - eave);
      g.fillStyle = WOOD.dark; g.fillRect(cx - 24, eave, 48, 2); g.fillRect(cx - 5, Y(0.62, 14), 10, 14);
      // roof triangle with courses
      g.save();
      g.beginPath(); g.moveTo(x0, eave); g.lineTo(cx, peak); g.lineTo(x1, eave); g.closePath(); g.clip();
      g.fillStyle = C.base; g.fillRect(x0, peak, x1 - x0, eave - peak);
      for (let y = eave - 5; y > peak; y -= 5) {
        if (kind === 'stone') for (let x = x0 + ((y / 5) & 1 ? 0 : 3); x < x1; x += 6) { g.fillStyle = C.dark; g.beginPath(); g.arc(x + 3, y, 3, 0, Math.PI); g.fill(); g.fillStyle = C.light; g.fillRect(x + 1, y - 0.6, 4, 0.8); }
        else if (kind === 'wood') { g.fillStyle = C.dark; g.fillRect(x0, y, x1 - x0, 1); for (let x = x0 + rand() * 6; x < x1; x += 5 + rand() * 4) g.fillRect(x, y - 4, 0.8, 4); }
        else { g.fillStyle = C.dark; for (let x = x0; x < x1; x += 1.4) g.fillRect(x, y - rand() * 3, 0.6, 2.5 + rand() * 2); }
      }
      g.restore();
      // bargeboards
      g.strokeStyle = WOOD.deep; g.lineWidth = 3.2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0 - 1, eave + 1); g.lineTo(cx, peak - 1); g.lineTo(x1 + 1, eave + 1); g.stroke();
    }, 2.4);
  });
}

function solid(ay) { const c = canvas(8, 8); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8); return c; }

// a sun shaft (src/fx/rays.js drawShaft): soft across, bright at the top fading toward the floor, anchored at its top
function shaft() {
  const W = 16, H = 64, c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W - 0.5, v = (y + 0.5) / H;
    const across = Math.cos(Math.min(1, Math.abs(u) * 2) * Math.PI / 2) ** 1.6;
    const along = Math.min(1, v * 6) * (0.45 + 0.55 * (1 - v)) * Math.min(1, (1 - v) * 5 + 0.35);
    const a = Math.round(across * along * 255), o = (y * W + x) * 4;
    img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function addRoofArt(add) {
  add('column_wood', columnWood(), 0.5, 1);
  add('column_stone', columnStone(), 0.5, 1);
  add('roof_thatch', roofIcon('thatch'), 0.5, 1);
  add('roof_wood', roofIcon('wood'), 0.5, 1);
  add('roof_stone', roofIcon('stone'), 0.5, 1);
  add('fx_solid', solid(0), 0.5, 0);    // anchored at its top (lifted roof lids in the shadow pass)
  add('fx_solid_b', solid(1), 0.5, 1);  // anchored at its foot (vertical cards)
  add('fx_shaft', shaft(), 0.5, 0);      // sun shaft, anchored at its top
}
