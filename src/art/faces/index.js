// Camera rotation: every area's face kinds (registration order = priority). One import per area module.
export { faceKindOf, boxDepth, FACE_KINDS } from './registry.js';
import './structures.js'; // walls, doors, fences, gates, things hung on walls
import './levels.js';     // stairs, upper floors
import './props.js';      // furniture, stations, decoration, lights (billboards turned / folded art)
import './solidTypes.js'; // pieces converted to real 3D (art/faces/solid.js kit, prio over props.js)
import './solidFurniture.js'; // interior furniture and decoration (solid pieces)
import './solidLights.js'; // lights, fire and production stations (the same kit)
import './solidGarden.js'; // (the garden / outdoor pieces, the raiders' camps and the columns)
import './deck.js';       // piers and bridges: procedural pieces from their neighbours (game/decks.js)
import './solidFarm.js'; // the farm: the feeder (docs/LIVESTOCK.md)
import './solidDefense.js'; // defense pieces: the ballista (turning top)
import './solidSiege.js'; // siege engines: trebuchet, catapult, battering ram, siege tower, the workshop (docs/REINOS.md)
import './solidBoat.js'; // the rowboat (game/boats.js): the whole model turns and moves
import './gates.js'; // the kingdoms: the big gates (wood / stone with a portcullis) and the town mural (docs/REINOS.md)
import './camp.js'; // the kingdoms' war camps: tents and banners in the kingdom's colours, the general's standard (docs/REINOS.md §14)
export { drawFacesTurned } from './scaffold.js'; // (a piece being built: its scaffold as a 3D frame around it)
