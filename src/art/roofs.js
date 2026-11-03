// Roof & column art for the atlas (agent J): columns (wood / stone), build-menu icons of the three roof types and
// two solid helper sprites (roof sun-shadow casters). The roofs themselves are painted per region at runtime by
// src/art/roofRaster.js (not in the atlas).

import { spritePx, rng, lin, mixc, TAU, circle, canvas } from './paint.js';
import { lazyDef } from './lazyDefs.js';

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

// the column kit's turned looks (content/kits.js column: 'round' / 'carved', in wood or stone): their own front art,
// drawn from the same profiles as their solid (art/faces/solidGarden.js COL_TURNED: [h, r] px, rows at v 0.733) — a
// round shaft lit from the left, the base and capital mouldings, rings / beads on the carved one, flutes on stone and
// grain on wood. Painted only when a turned camera asks for it (lazy)
export const COL_TURNED = {
  round: [[[0, 12.5], [4.5, 12.5], [7, 10]], [[7, 7.5], [57, 7.5]], [[57, 9], [59.5, 12.5], [64, 12.5]]],
  carved: [[[0, 13], [3, 13], [3, 11.5], [6, 11.5], [8, 9]], [[8, 7], [11, 7], [12, 8.6], [14.5, 8.6], [15.5, 7], [48.5, 7], [49.5, 8.6], [52, 8.6], [53, 7], [56, 7]], [[56, 7.5], [58, 10], [60.5, 13.5], [64, 14.5]]],
};
function columnTurned(look, mat) {
  const rand = rng(781 + (look === 'carved' ? 7 : 0) + (mat === 's' ? 3 : 0));
  const P0 = mat === 's' ? STONE : { high: WOOD.high, light: WOOD.light, mid: WOOD.mid, dark: WOOD.dark };
  return mk(1, 40, (g, P, Y, W) => {
    const cx = W / 2, base = Y(0.733, 0);
    g.fillStyle = 'rgba(40,28,16,0.3)'; g.beginPath(); g.ellipse(cx, base, 17, 5, 0, 0, TAU); g.fill();
    P.layer((g) => {
      const body = (h0, h1, r0, r1) => {
        if (h1 - h0 < 0.01) return;
        const R = Math.max(r0, r1);
        g.fillStyle = lin(g, cx - R, 0, cx + R, 0, [[0, P0.high], [0.3, P0.light], [0.72, P0.mid], [1, P0.dark]]);
        g.beginPath(); g.moveTo(cx - r0, Y(0.733, h0) + 0.4); g.lineTo(cx - r1, Y(0.733, h1)); g.lineTo(cx + r1, Y(0.733, h1)); g.lineTo(cx + r0, Y(0.733, h0) + 0.4); g.closePath(); g.fill();
      };
      const prof = COL_TURNED[look];
      for (const pr of prof) for (let i = 0; i + 1 < pr.length; i++) body(pr[i][0], pr[i + 1][0], pr[i][1], pr[i + 1][1]);
      // the shaft's surface: flutes on stone, grain on wood
      const [sh0, sh1] = [prof[1][0][0], prof[1][prof[1].length - 1][0]], sr = prof[1][0][1];
      g.strokeStyle = mat === 's' ? 'rgba(70,64,56,0.45)' : 'rgba(60,36,18,0.4)'; g.lineWidth = 0.8;
      g.beginPath();
      for (const x of mat === 's' ? [-4.5, -1.5, 1.5, 4.5] : [-4, -0.5, 3]) { g.moveTo(cx + x * sr / 7.5, Y(0.733, sh0 + 1)); g.lineTo(cx + x * sr / 7.5 + (mat === 's' ? 0 : 0.5), Y(0.733, sh1 - 1)); }
      g.stroke();
      if (mat === 's') for (let i = 0; i < 12; i++) { g.fillStyle = i & 1 ? 'rgba(255,255,245,0.3)' : 'rgba(30,26,20,0.3)'; g.fillRect(cx - sr + 1 + rand() * (2 * sr - 2), Y(0.733, sh0 + 2 + rand() * (sh1 - sh0 - 4)), 1.1, 1.1); }
      // every change of the profile: a crisp edge (light over the step, dark under it)
      for (const pr of prof) for (let i = 1; i < pr.length - 1; i++) {
        const [h, r] = pr[i], y = Y(0.733, h);
        g.fillStyle = 'rgba(20,14,10,0.35)'; g.fillRect(cx - r, y, 2 * r, 0.9);
        g.fillStyle = 'rgba(255,248,232,0.3)'; g.fillRect(cx - r, y - 0.9, 2 * r, 0.8);
      }
      // the capital's top edge and the base's foot line
      const top = prof[2][prof[2].length - 1];
      g.fillStyle = 'rgba(255,248,232,0.45)'; g.fillRect(cx - top[1], Y(0.733, top[0]), 2 * top[1], 1.4);
      g.fillStyle = 'rgba(20,14,10,0.4)'; g.fillRect(cx - prof[0][0][1], base - 1.4, 2 * prof[0][0][1], 1.4);
    }, 2.6);
  });
}
for (const look of ['round', 'carved']) for (const mat of ['w', 's']) lazyDef(`column_${look}_${mat}`, () => columnTurned(look, mat), 0.5, 1);

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
