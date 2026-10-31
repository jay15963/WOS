// Camera rotation: every area's face kinds (registration order = priority). One import per area module.
export { faceKindOf, boxDepth, FACE_KINDS } from './registry.js';
import './structures.js'; // walls, doors, fences, gates, things hung on walls
import './levels.js';     // stairs, upper floors
import './props.js';      // furniture, stations, decoration, lights (billboards turned / folded art)
