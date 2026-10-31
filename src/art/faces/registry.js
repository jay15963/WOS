// Camera rotation (docs/CAMERA-ROTATION.md): the pieces drawn as computed faces while the camera is turned.
// Each area registers its pieces in its own module (faces/*.js, imported by faces/index.js):
//   registerFaces({ id, test(o, def) → bool, draw(B, A, o, t) → bool, depth?(o, rc, rs) → number })
//   - test: is o (a world object; def = BUILDINGS[o.type] or undefined) drawn by this kind while the camera is turned
//   - draw: put its faces into B.faces (engine/faceBatch.js) — false = draw its sprite as always (art not ready…)
//   - depth: its view depth for the painter's sort (larger = nearer the camera); default boxDepth (the front-most point
//     of its footprint box, + a tiny bit per story). rc / rs = cos / sin of the camera yaw.
// The first kind whose test passes wins (registration order). game.js asks faceKindOf(o) only while turned.
import { BUILDINGS } from '../../game/content/buildings.js';

export const FACE_KINDS = [];
export function registerFaces(k) { FACE_KINDS.push(k); return k; }

export function faceKindOf(o) {
  if (!o || o.isEntity || o.draw) return null;
  const def = o.building ? BUILDINGS[o.type] : undefined;
  for (const k of FACE_KINDS) if (k.test(o, def)) return k;
  return null;
}

// the front-most point of a footprint box, as seen by the camera (view y = −sin·x + cos·y)
export function boxDepth(o, rc, rs) {
  const fw = o.fw || 1, fh = o.fh || 1;
  return -rs * (o.tx + fw / 2) + rc * (o.ty + fh / 2) + 0.5 * (Math.abs(rs) * fw + Math.abs(rc) * fh) + (o.lv | 0) * 0.001;
}
