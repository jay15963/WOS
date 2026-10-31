// Camera rotation — structures: walls / doors (boxes), fences / gates (panels), things hung on walls.
// (builders in art/archCompose.js: drawWallFaces, drawFenceFaces, drawMountFaces)
import { registerFaces } from './registry.js';
import { drawWallFaces, drawFenceFaces, drawMountFaces } from '../archCompose.js';
import { STORY_H } from '../../game/levels.js';

registerFaces({
  id: 'wall',
  test: (o, d) => !!d && !d.roof && d.connect === 'wall' && (d.block === 'tile' || d.block === 'door'),
  draw: (B, A, o, t) => drawWallFaces(B.faces, A, o, (o.lv | 0) * STORY_H, t, B.light),
});
registerFaces({
  id: 'fence',
  test: (o, d) => !!d && !d.roof && d.connect === 'fence' && (d.block === 'tile' || d.block === 'door'),
  draw: (B, A, o, t) => drawFenceFaces(B.faces, A, o, (o.lv | 0) * STORY_H, t),
});
registerFaces({
  id: 'mount',
  test: (o, d) => !!d && !!d.mount && !!o._mount && (o.rot | 0) > 0,
  draw: (B, A, o) => drawMountFaces(B.faces, A, o),
  // just in front of the face of the wall it hangs on
  depth: (o, rc, rs) => {
    const r = o.rot | 0, px = o.tx + 0.5 + (r === 2 ? 0.47 : r === 4 ? -0.47 : 0), py = o.ty + 0.5 + (r === 1 ? -0.47 : r === 3 ? 0.47 : 0);
    return -rs * px + rc * py + 0.02;
  },
});
