// Camera rotation — structures: walls (boxes), doors (jambs + leaves), fences / hedges / stone fence-walls (posts,
// boards, blocks), gates (posts + leaves), columns (cards), things hung on walls; siege cracks over them (fx/rockfx.js).
// (builders: faces/walls.js, faces/doors.js, faces/fences.js; shared helpers: faces/kit.js)
import { registerFaces } from './registry.js';
import { drawWallFaces, drawMountFaces, mountDepth, drawColumnFaces } from './walls.js';
import { drawDoorFaces } from './doors.js';
import { drawFenceFaces, drawGateFaces } from './fences.js';
import { STORY_H } from '../../game/levels.js';

const isWall = (d) => !!d && !d.roof && d.connect === 'wall';
const isFence = (d) => !!d && !d.roof && d.connect === 'fence';
registerFaces({
  id: 'wall',
  test: (o, d) => isWall(d) && d.block === 'tile',
  draw: (B, A, o, t) => drawWallFaces(B, A, o, (o.lv | 0) * STORY_H, t),
});
registerFaces({
  id: 'door',
  test: (o, d) => isWall(d) && d.block === 'door',
  draw: (B, A, o, t) => drawDoorFaces(B, A, o, (o.lv | 0) * STORY_H, t),
});
registerFaces({
  id: 'fence',
  test: (o, d) => isFence(d) && d.block === 'tile',
  draw: (B, A, o, t) => drawFenceFaces(B, A, o, (o.lv | 0) * STORY_H, t),
});
registerFaces({
  id: 'gate',
  test: (o, d) => isFence(d) && d.block === 'door',
  draw: (B, A, o, t) => drawGateFaces(B, A, o, (o.lv | 0) * STORY_H, t),
});
registerFaces({
  id: 'column',
  test: (o) => o.type === 'column_wood' || o.type === 'column_stone',
  draw: (B, A, o) => drawColumnFaces(B, A, o, (o.lv | 0) * STORY_H),
});
registerFaces({
  id: 'mount',
  test: (o, d) => !!d && !!d.mount && !!o._mount && (o.rot | 0) > 0,
  draw: (B, A, o) => drawMountFaces(B, A, o),
  depth: mountDepth, // (just in front of the face of the wall it hangs on)
});
