// Stairs (agent L, docs/LEVELS.md): a wooden stairway that climbs one story (the wall height, STORY_PX at 64 PPU) over its
// 2-tile footprint, with stringers and handrails, in the warm plank palette of the walls (art/structures.js).
// Sprites (anchor = bottom centre of the footprint, o.y = ty + fh):
//   stairs_wood    entrance south, ascends north (1×2): treads + risers seen from the front
//   stairs_wood_n  entrance north, ascends south (1×2): treads seen from behind, tall end face at the south
//   stairs_wood_e  entrance east, ascends west (2×1): side profile (the game mirrors it for "ascends east")
//   slab_edge      the beam under the south edge of an overhanging upper floor (anchor top centre; lazy, not baked)

import { spritePx, lin, circle, OW } from './paint.js';
import { STORY_PX } from './structures.js';
import { lazyDef } from './lazyDefs.js';

const RISE = STORY_PX;       // one story (px) = WALL_H
const N_STEPS = 5;
const POST = 16;             // handrail height (px)
const TR = { base: ['#c69a68', '#bb8e5c', '#c9a06f', '#b4885a', '#c29563'], hi: 'rgba(255,236,196,0.55)', seam: '#5e3c20', grain: 'rgba(98,62,32,0.3)' };
const RS = { base: '#7a5232', dark: '#5a3b22', gap: '#2f1d10' };
const SG = { top: '#a37548', mid: '#7d5532', dark: '#5a3b22', hi: 'rgba(255,230,190,0.4)' };
const RL = { a: '#b0844f', b: '#8c6238', c: '#5f3f22' };

// one tread: planks running along `along` ('h' east-west / 'v' north-south) inside a rect
function tread(g, x, y, w, h, along, seed) {
  const n = 2;
  for (let k = 0; k < n; k++) {
    g.fillStyle = TR.base[(seed * 3 + k) % TR.base.length];
    if (along === 'h') g.fillRect(x, y + (h * k) / n, w, h / n + 0.4);
    else g.fillRect(x + (w * k) / n, y, w / n + 0.4, h);
  }
  g.strokeStyle = TR.grain; g.lineWidth = 0.8;
  g.beginPath();
  for (let k = 0; k < n; k++) {
    if (along === 'h') { const gy = y + (h * (k + 0.45)) / n; g.moveTo(x + 2, gy); g.lineTo(x + w - 2, gy + 0.6); }
    else { const gx = x + (w * (k + 0.45)) / n; g.moveTo(gx, y + 2); g.lineTo(gx + 0.6, y + h - 2); }
  }
  g.stroke();
  g.fillStyle = TR.seam;
  if (along === 'h') g.fillRect(x, y + h / n - 0.5, w, 1);
  else g.fillRect(x + w / n - 0.5, y, 1, h);
  // nails
  g.fillStyle = 'rgba(40,36,34,0.8)';
  for (const [nx, ny] of along === 'h' ? [[x + 4, y + h * 0.25], [x + w - 4, y + h * 0.25], [x + 4, y + h * 0.75], [x + w - 4, y + h * 0.75]]
    : [[x + w * 0.25, y + 4], [x + w * 0.75, y + 4], [x + w * 0.25, y + h - 4], [x + w * 0.75, y + h - 4]]) { g.beginPath(); circle(g, nx, ny, 0.85); g.fill(); }
}

function post(g, x, yFoot, h = POST) {
  g.fillStyle = lin(g, x - 2.6, 0, x + 2.6, 0, [[0, RL.a], [1, RL.c]]);
  g.fillRect(x - 2.6, yFoot - h, 5.2, h);
  g.fillStyle = '#c89a62'; g.fillRect(x - 3, yFoot - h - 1.6, 6, 2.2); // cap
}
function rail(g, x0, y0, x1, y1) {
  g.strokeStyle = RL.c; g.lineWidth = 4.2; g.beginPath(); g.moveTo(x0, y0 + 0.6); g.lineTo(x1, y1 + 0.6); g.stroke();
  g.strokeStyle = RL.b; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = 'rgba(255,230,190,0.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0 - 1); g.lineTo(x1, y1 - 1); g.stroke();
}

// entrance south, ascending north: the near (low) step at the bottom of the sprite, the landing at the top
function stairsS() {
  const W = 64, D = 128, H = D + RISE + POST + 6, B = H;
  const Y = (d, h) => B - d - h;
  const sd = D / N_STEPS, rise = RISE / N_STEPS;
  const x0 = 10, x1 = 54;
  return spritePx(W, H, (g, P) => {
    P.layer((g) => {
      // stringers (side beams) climbing with the treads
      for (const [a, b] of [[3, x0], [x1, 61]]) {
        g.fillStyle = lin(g, a, 0, b, 0, [[0, SG.top], [1, SG.mid]]);
        g.beginPath(); g.moveTo(a, Y(0, 0)); g.lineTo(b, Y(0, 0)); g.lineTo(b, Y(D, RISE + 3)); g.lineTo(a, Y(D, RISE + 3)); g.closePath(); g.fill();
        g.fillStyle = SG.hi; g.fillRect(a, Y(D, RISE + 3), 1.2, Y(0, 0) - Y(D, RISE + 3));
      }
      for (let i = 0; i < N_STEPS; i++) {
        const hT = rise * (i + 1), hB = rise * i;
        const ty0 = Y((i + 1) * sd, hT), ty1 = Y(i * sd, hT);
        // riser (front face of the step)
        g.fillStyle = lin(g, 0, ty1, 0, Y(i * sd, hB), [[0, RS.base], [1, RS.dark]]);
        g.fillRect(x0, ty1, x1 - x0, Y(i * sd, hB) - ty1);
        tread(g, x0, ty0, x1 - x0, ty1 - ty0, 'h', i);
        // nosing: lit edge, shadow on the riser below it
        g.fillStyle = TR.hi; g.fillRect(x0, ty1 - 1.6, x1 - x0, 1.4);
        g.fillStyle = 'rgba(25,14,6,0.45)'; g.fillRect(x0, ty1, x1 - x0, 1.2);
        // contact shade along the stringers
        g.fillStyle = 'rgba(30,18,8,0.22)'; g.fillRect(x0, ty0, 2.2, ty1 - ty0); g.fillRect(x1 - 2.2, ty0, 2.2, ty1 - ty0);
      }
      // handrails on both sides
      for (const x of [6.5, 57.5]) {
        const yb = Y(6, 3), yt = Y(D - 6, RISE + 3);
        post(g, x, yb); post(g, x, Y(D / 2, RISE / 2 + 3)); post(g, x, yt);
        rail(g, x, yb - POST, x, yt - POST);
      }
    }, OW);
  }, { pad: 10 });
}

// entrance north, ascending south: the high end (with its end face) at the bottom of the sprite
function stairsN() {
  const W = 64, D = 128, H = Math.ceil(D + Math.max(RISE / N_STEPS, RISE - 64) + POST + 12), B = H;
  const Y = (d, h) => B - d - h;
  const sd = D / N_STEPS, rise = RISE / N_STEPS;
  const x0 = 10, x1 = 54;
  return spritePx(W, H, (g, P) => {
    P.layer((g) => {
      for (const [a, b] of [[3, x0], [x1, 61]]) {
        g.fillStyle = lin(g, a, 0, b, 0, [[0, SG.top], [1, SG.mid]]);
        g.beginPath(); g.moveTo(a, Y(0, RISE + 3)); g.lineTo(b, Y(0, RISE + 3)); g.lineTo(b, Y(D, rise + 3)); g.lineTo(a, Y(D, rise + 3)); g.closePath(); g.fill();
        g.fillStyle = SG.hi; g.fillRect(a, Y(D, rise + 3), 1.2, Y(0, RISE + 3) - Y(D, rise + 3));
      }
      // from the far (low, north) step to the near (high, south) one: the nearer step hides the lip of the next
      for (let j = N_STEPS - 1; j >= 0; j--) {
        const h = RISE - rise * j;
        const ty0 = Y((j + 1) * sd, h), ty1 = Y(j * sd, h);
        tread(g, x0, ty0, x1 - x0, ty1 - ty0, 'h', j + 2);
        g.fillStyle = 'rgba(25,14,6,0.4)'; g.fillRect(x0, ty0, x1 - x0, 1.4); // back lip of this step
        g.fillStyle = 'rgba(30,18,8,0.22)'; g.fillRect(x0, ty0, 2.2, ty1 - ty0); g.fillRect(x1 - 2.2, ty0, 2.2, ty1 - ty0);
      }
      // end face at the high (south) end
      const fy = Y(0, RISE);
      g.fillStyle = lin(g, 0, fy, 0, B, [[0, RS.base], [1, RS.dark]]);
      g.fillRect(3, fy, 58, B - fy);
      g.fillStyle = RS.gap; for (const k of [1, 2, 3]) g.fillRect(3, fy + (RISE * k) / 4, 58, 1);
      g.fillStyle = TR.hi; g.fillRect(3, fy - 0.6, 58, 1.4);
      g.fillStyle = 'rgba(15,10,6,0.35)'; g.fillRect(3, B - 6, 58, 6);
      for (const x of [6.5, 57.5]) {
        const yb = Y(6, RISE + 3), yt = Y(D - 6, rise + 3);
        post(g, x, yt); post(g, x, Y(D / 2, RISE / 2 + 3)); post(g, x, yb);
        rail(g, x, yb - POST, x, yt - POST);
      }
    }, OW);
  }, { pad: 10 });
}

// entrance east, ascending west: side view of the stringer profile, treads from above
function stairsE() {
  const W = 128, DEP = 64, H = DEP + RISE + POST + 8, B = H;
  const sw = W / N_STEPS, rise = RISE / N_STEPS;
  return spritePx(W, H, (g, P) => {
    P.layer((g) => {
      // far (north) handrail first: it stands on the back edge of the treads
      const pts = (yOff) => [[W - 6, B - DEP - rise - 3 + yOff], [6, B - DEP - RISE - 3 + yOff]];
      {
        const [[ax, ay], [bx, by]] = pts(0);
        post(g, ax, ay); post(g, bx, by); post(g, W / 2, (ay + by) / 2);
        rail(g, ax, ay - POST, bx, by - POST);
      }
      for (let i = 0; i < N_STEPS; i++) {
        const h = rise * (i + 1), xa = W - (i + 1) * sw, xb = W - i * sw;
        tread(g, xa, B - DEP - h, sw, DEP, 'v', i);
        g.fillStyle = TR.hi; g.fillRect(xb - 1.4, B - DEP - h, 1.4, DEP); // lit nosing (east edge)
        if (i > 0) { g.fillStyle = 'rgba(25,14,6,0.35)'; g.fillRect(xb, B - DEP - h + rise, 2, DEP); } // shadow on the lower step
      }
      // south stringer: the stepped profile from the ground to each tread
      g.fillStyle = lin(g, 0, B - RISE, 0, B, [[0, SG.mid], [1, SG.dark]]);
      g.beginPath(); g.moveTo(W, B);
      for (let i = 0; i < N_STEPS; i++) { const h = rise * (i + 1); g.lineTo(W - i * sw, B - h); g.lineTo(W - (i + 1) * sw, B - h); }
      g.lineTo(0, B); g.closePath(); g.fill();
      g.strokeStyle = SG.hi; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i < N_STEPS; i++) { const h = rise * (i + 1); g.moveTo(W - i * sw, B - h + 0.8); g.lineTo(W - (i + 1) * sw, B - h + 0.8); }
      g.stroke();
      g.fillStyle = 'rgba(15,10,6,0.35)'; g.fillRect(0, B - 5, W, 5);
      // near (south) handrail
      {
        const [[ax, ay], [bx, by]] = [[W - 6, B - rise - 2], [6, B - RISE - 2]];
        post(g, ax, ay); post(g, W / 2, (ay + by) / 2); post(g, bx, by);
        rail(g, ax, ay - POST, bx, by - POST);
      }
    }, OW);
  }, { pad: 10 });
}

// the front beam under the south edge of an upper floor that overhangs (nothing below it): a dark rim joist with
// the ends of the floor joists (anchor = top centre: it hangs below the slab's south edge)
function slabEdge() {
  const W = 64, H = 11;
  return spritePx(W, H, (g) => {
    g.fillStyle = lin(g, 0, 0, 0, H, [[0, SG.top], [0.45, SG.mid], [1, SG.dark]]);
    g.fillRect(0, 0, W, H);
    g.fillStyle = SG.hi; g.fillRect(0, 0, W, 1.4);
    g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(0, H - 2, W, 2);
    for (const x of [8, 32, 56]) { // joist ends
      g.fillStyle = RS.dark; g.fillRect(x - 4, 2.5, 8, 6);
      g.strokeStyle = 'rgba(255,224,180,0.25)'; g.lineWidth = 0.8; g.beginPath(); circle(g, x, 5.5, 1.8); g.stroke();
    }
    g.fillStyle = 'rgba(40,36,34,0.85)';
    for (const x of [20, 44]) { g.beginPath(); circle(g, x, 5.5, 0.9); g.fill(); }
  }, { pad: 2 });
}

export function addStairs(add) {
  add('stairs_wood', stairsS(), 0.5, 1);
  add('stairs_wood_n', stairsN(), 0.5, 1);
  add('stairs_wood_e', stairsE(), 0.5, 1);
}
// the slab edge is painted on demand into the shared lazy texture (agent K's registry, art/lazyDefs.js): registered at
// import, since the baked atlas may come from the cache
lazyDef('slab_edge', slabEdge, 0.5, 0);
