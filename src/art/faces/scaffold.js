// Camera rotation — the construction scaffold (art/structures.js scaffold_0: two posts, two ledgers, a diagonal brace,
// a plank on top) as a 3D frame fixed in the world while the camera is turned, around ANY piece being built.
//
// Four braced panels stand on a rectangle around the footprint (its posts 6 px in from the sides, as the sprite draws
// them), each with the scaffold art (in world order: a panel seen from behind reads mirrored, like a real frame).
// Adjacent panels meet on the posts' axes, so each corner post is drawn by two crossed panels and reads as a post from
// every side. Drawn in two halves around the piece (game.js drawFacesTurned): the panels seen from inside go before the
// piece, the rest after it; the progress bar stays screen-facing (game/building.js).
import { CAMV, ARCH_FACES as K } from '../archCompose.js';
import { BUILDINGS } from '../../game/content/buildings.js';
import { STORY_H } from '../../game/levels.js';
import { artQuad, shade } from './kit.js';
import { solidEntry } from './solid.js';

// the art's frame: anchor (32, 138) = the middle of the south edge on the ground; posts on columns 6 and 58; the
// whole image (12 px of padding around the 64 × 138 frame) is laid, artQuad clips it to the sprite's own image
const OX = 32, OY = 138, PA = 6, PB = 58, C0 = -14, C1 = 78, R0 = -14, R1 = 152;
const HT = (OY - R0) / 64, HB = (OY - R1) / 64;

// does o show a scaffold (as the painters draw one at 0°: work started on a blueprint; not torches, floors, rugs,
// roofs, stairs)
export function scaffolded(o) {
  if (o._ghost || !(o.progress > 0.02 && o.progress < 1)) return false;
  const d = BUILDINGS[o.type];
  return !!d && !d.roof && !d.flat && d.layer !== 'floor' && d.layer !== 'rug' && d.layer !== 'deck' && d.block !== 'stairs' && o.type !== 'torch'; // (piers / bridges show their own stages: faces/deck.js)
}

// panel order scratch (no allocation per frame)
const PD = new Float32Array(4), PO = [0, 1, 2, 3], byDepth = (i, j) => PD[i] - PD[j];
let SPR = null, SPA = null;
function sprite(A) {
  if (SPA !== A) { SPA = A; SPR = null; }
  if (!SPR) { const s = K.tables(A).opt('scaffold_0'); if (s && K.ok(s)) SPR = s; }
  return SPR;
}
// one panel: art column PA on (ax, ay), PB on (bx, by); n = its outward normal; k = its height scale
function panel(F, s, ax, ay, bx, by, nx, ny, h0, a, k) {
  const vx = (bx - ax) / (PB - PA), vy = (by - ay) / (PB - PA);
  const lx = ax + vx * (C0 - PA), ly = ay + vy * (C0 - PA), rx = ax + vx * (C1 - PA), ry = ay + vy * (C1 - PA);
  const out = -CAMV.s * nx + CAMV.c * ny > 0;
  const z = out ? shade(nx, ny) : shade(-nx, -ny) * 0.72; // (the side lit like the walls; seen from inside: darker)
  artQuad(F, s, false, OX, OY, C0, R0, C1, R1, lx, ly, h0 + HT * k, rx, ry, h0 + HT * k, lx, ly, h0 + HB * k, z, z, z, a);
}
// the scaffold's height follows the piece (the art is two tiles tall: its top plank a little over the piece's top; a
// chest or a bench gets a low frame): the model's top for a solid piece, a story for walls / doors, a fence's height
function heightK(o) {
  let h = 1;
  const e = solidEntry(o), d = BUILDINGS[o.type];
  if (e && e.ok) { h = 0; for (const p of e.P) if (p.h1 > h) h = p.h1; }
  else if (d?.connect === 'fence') h = 0.6;
  const k = (h + 0.28) / 2;
  return k < 0.4 ? 0.4 : k > 1 ? 1 : k;
}
// half 0: the panels whose outside faces away from the camera (behind the piece); 1: the others
export function drawScaffold(B, A, o, half) {
  const F = B.faces, s = F ? sprite(A) : null;
  if (!s) return;
  const def = BUILDINGS[o.type], sz = def?.size || [1, 1], fw = o.fw || sz[0], fh = o.fh || sz[1];
  const x0 = o.tx ?? o.x - fw / 2, y0 = o.ty ?? o.y - fh, y1 = y0 + fh;
  const xa = x0 + (PA * fw) / 64, xb = x0 + (PB * fw) / 64, yb = y0 + (PA * fh) / 64, y2 = y1 - (PA * fh) / 64;
  const h0 = (o.lv | 0) * STORY_H, C = CAMV.c, S = CAMV.s, a = 0.9 * (o.alpha ?? 1), k = heightK(o);
  // panels: 0 south, 1 north, 2 east, 3 west; centre depths for their order
  PD[0] = -S * (xa + xb) / 2 + C * y2; PD[1] = -S * (xa + xb) / 2 + C * yb;
  PD[2] = -S * xb + C * (yb + y2) / 2; PD[3] = -S * xa + C * (yb + y2) / 2;
  PO.sort(byDepth);
  for (let q = 0; q < 4; q++) {
    const i = PO[q], nx = i === 2 ? 1 : i === 3 ? -1 : 0, ny = i === 0 ? 1 : i === 1 ? -1 : 0;
    if ((-S * nx + C * ny > 0.02 ? 1 : 0) !== half) continue;
    if (i === 0) panel(F, s, xa, y2, xb, y2, 0, 1, h0, a, k);
    else if (i === 1) panel(F, s, xa, yb, xb, yb, 0, -1, h0, a, k);
    else if (i === 2) panel(F, s, xb, y2, xb, yb, 1, 0, h0, a, k);
    else panel(F, s, xa, y2, xa, yb, -1, 0, h0, a, k);
  }
}

// game.js: draw o with its face kind while the camera is turned (false = draw its sprite), its scaffold around it
export function drawFacesTurned(B, A, o, t, R) {
  const k = o._fk;
  if (k.id === 'upperSprite' || !scaffolded(o)) return k.draw(B, A, o, t);
  drawScaffold(B, A, o, 0);
  R?.setFaceTex?.(null); // (closes the face segment: the panels behind are drawn before the piece's own sprites)
  if (!k.draw(B, A, o, t)) return false;
  drawScaffold(B, A, o, 1);
  return true;
}
