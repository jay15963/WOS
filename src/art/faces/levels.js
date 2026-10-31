// Camera rotation — levels: stairs (steps), upper floors (slabs at their story's height).
// (builders in art/archCompose.js: drawStairFaces, drawFloorFaces)
import { registerFaces, boxDepth } from './registry.js';
import { drawStairFaces, drawFloorFaces } from '../archCompose.js';
import { STORY_H } from '../../game/levels.js';

registerFaces({
  id: 'stairs',
  test: (o, d) => !!d && d.block === 'stairs',
  draw: (B, A, o) => drawStairFaces(B.faces, A, o, (o.lv | 0) * STORY_H),
});
registerFaces({
  id: 'floorUp',
  test: (o, d) => !!d && d.layer === 'floor' && o.lv > 0,
  draw: (B, A, o, t) => drawFloorFaces(B.faces, A, o, (o.lv | 0) * STORY_H, t),
  depth: (o, rc, rs) => boxDepth(o, rc, rs) + (o.lv | 0) * 0.5, // (over the walls it rests on)
});
