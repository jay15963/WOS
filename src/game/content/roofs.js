// Roof catalogue (pure data, no DOM). Agent J draws roofs from these tables; agent K adds styles / details
// without touching the renderer (src/art/roofRaster.js reads everything below).
//
// Interface for K (roof style / details):
//   - Every built roof tile is a structure on layer 'roof' (types roof_thatch / roof_wood / roof_stone) with two
//     shared fields set in op appliers (struct.add rows [.., style, det]) and kept in snapshot / save / digest:
//       o.style  string id of ROOF_STYLES (material + colours + pattern + gable/ridge/board looks)
//       o.det    canonical detail string: ROOF_DETAILS ids sorted and joined with '.' ('' = none), e.g. 'chimney.moss'
//     Both are fixed once built (owner's rule): only blueprints may change them (re-place the plan).
//   - A ROOF_STYLES entry: { name, type (the roof structure type it belongs to), pattern ('scale' | 'shake' |
//     'thatch' | 'slab'), base / dark / light [r,g,b] 0..1, jitter (colour variation), pitch (rise per tile of
//     half span), ends ('gable' | 'hip'), gable ('plaster' | 'planks' | 'stone') + gableCol / timber, board
//     [r,g,b] (bargeboards / fascia), ridge ('tile' | 'bound' | 'board'), rowH / cellW (pattern size, tiles on screen) }.
//   - A ROOF_DETAILS entry: { bit, name, desc } — the renderer knows how to draw each id; unknown ids are ignored
//     (the bit is internal to the painter: detBits(o.det)).
//   - Region geometry (rectangles, gables, hips, valleys) comes from the shape; per rectangle the majority style
//     of its tiles decides pitch / ends; each pixel is painted with the style of the tile under it.

export const ROOF_GEOM = {
  support: 6,            // a built roof tile needs a wall / door / column / rock within this distance (tiles)
  natSupport: 6,         // a mined tile keeps its mountain roof while rock is within this distance
  eaveH: 1,              // eave height per storey (tiles) = wall height (art/structures.js WALL_H, one story = one tile)
  overhang: 0.3,         // eaves past the walls (tiles), sides and back
  overhangS: 0.12,       // south eaves / rake: short, so the wall face under them stays visible in the 3/4 view
  rake: 0.2,             // gable-end overhang (bargeboards)
  maxRise: 2.8,          // ridge height cap above the eaves (wide halls get a flatter pitch)
  frontGable: 1.3,       // a rectangle at most this much wider than deep gets a front gable (ridge N-S)
  thick: 0.09,           // roof slab / fascia thickness
  chimneyH: 0.95,        // chimney height above the roof surface
};

// eave height of a roof whose highest storey is `storeys` (agent L: multiple floors)
export const roofEaveH = (storeys = 1) => ROOF_GEOM.eaveH * Math.max(1, storeys | 0);

export const ROOF_STYLES = {
  // ---- thatch (roof_thatch) ----
  thatch:      { name: 'Palha dourada', type: 'roof_thatch', pattern: 'thatch', base: [0.78, 0.62, 0.32], dark: [0.42, 0.3, 0.14], light: [0.96, 0.84, 0.52], jitter: 0.06,
                 pitch: 1.15, ends: 'hip', gable: 'plaster', gableCol: [0.86, 0.78, 0.6], timber: [0.33, 0.21, 0.12], board: [0.36, 0.24, 0.13], ridge: 'bound', rowH: 0.34, cellW: 0.05 },
  thatch_old:  { name: 'Palha velha', type: 'roof_thatch', pattern: 'thatch', base: [0.6, 0.52, 0.34], dark: [0.3, 0.25, 0.15], light: [0.78, 0.7, 0.5], jitter: 0.08,
                 pitch: 1.1, ends: 'hip', gable: 'plaster', gableCol: [0.78, 0.72, 0.6], timber: [0.28, 0.2, 0.13], board: [0.3, 0.22, 0.14], ridge: 'bound', rowH: 0.34, cellW: 0.05 },
  // ---- wood shakes (roof_wood) ----
  shingle:     { name: 'Telhas de madeira', type: 'roof_wood', pattern: 'shake', base: [0.56, 0.38, 0.22], dark: [0.26, 0.16, 0.09], light: [0.74, 0.54, 0.34], jitter: 0.08,
                 pitch: 1.0, ends: 'gable', gable: 'planks', gableCol: [0.6, 0.42, 0.25], timber: [0.3, 0.19, 0.1], board: [0.27, 0.17, 0.09], ridge: 'board', rowH: 0.22, cellW: 0.22 },
  shingle_red: { name: 'Madeira vermelha', type: 'roof_wood', pattern: 'shake', base: [0.6, 0.27, 0.2], dark: [0.3, 0.12, 0.09], light: [0.78, 0.42, 0.3], jitter: 0.07,
                 pitch: 1.0, ends: 'gable', gable: 'planks', gableCol: [0.66, 0.5, 0.32], timber: [0.3, 0.19, 0.1], board: [0.25, 0.15, 0.09], ridge: 'board', rowH: 0.22, cellW: 0.22 },
  // ---- stone / tiles (roof_stone) ----
  slate:       { name: 'Ardósia azul', type: 'roof_stone', pattern: 'scale', base: [0.36, 0.44, 0.56], dark: [0.15, 0.19, 0.27], light: [0.6, 0.7, 0.82], jitter: 0.06,
                 pitch: 1.0, ends: 'gable', gable: 'plaster', gableCol: [0.88, 0.82, 0.7], timber: [0.3, 0.19, 0.11], board: [0.24, 0.15, 0.09], ridge: 'tile', rowH: 0.23, cellW: 0.3 },
  terracotta:  { name: 'Telha de barro', type: 'roof_stone', pattern: 'scale', base: [0.78, 0.42, 0.24], dark: [0.42, 0.18, 0.1], light: [0.95, 0.64, 0.42], jitter: 0.07,
                 pitch: 0.95, ends: 'gable', gable: 'plaster', gableCol: [0.9, 0.84, 0.72], timber: [0.32, 0.2, 0.11], board: [0.26, 0.16, 0.09], ridge: 'tile', rowH: 0.23, cellW: 0.3 },
  stone:       { name: 'Lajes de pedra', type: 'roof_stone', pattern: 'slab', base: [0.56, 0.55, 0.52], dark: [0.26, 0.26, 0.25], light: [0.74, 0.73, 0.69], jitter: 0.07,
                 pitch: 0.9, ends: 'gable', gable: 'stone', gableCol: [0.62, 0.6, 0.56], timber: [0.3, 0.2, 0.12], board: [0.28, 0.2, 0.13], ridge: 'tile', rowH: 0.27, cellW: 0.38 },
};

// default + selectable styles per roof structure type (order = the "Estilo" cycle in build mode)
export const ROOF_TYPE_STYLES = {
  roof_thatch: ['thatch', 'thatch_old'],
  roof_wood: ['shingle', 'shingle_red'],
  roof_stone: ['slate', 'terracotta', 'stone'],
};
export const roofStyleOf = (o) => ROOF_STYLES[o?.style] || ROOF_STYLES[ROOF_TYPE_STYLES[o?.type]?.[0]] || ROOF_STYLES.thatch;
export const defaultRoofStyle = (type) => ROOF_TYPE_STYLES[type]?.[0] || 'thatch';

// detail bits (o.det); K extends this list. The renderer ignores ids it does not know.
export const ROOF_DETAILS = {
  moss:     { bit: 1, name: 'Musgo', desc: 'Manchas de musgo e desgaste nas águas viradas para o norte.' },
  chimney:  { bit: 2, name: 'Chaminé', desc: 'Chaminé de pedra (solta fumaça quando há fogo embaixo).' },
  vane:     { bit: 4, name: 'Cata-vento', desc: 'Cata-vento de ferro na cumeeira.' },
  trim:     { bit: 8, name: 'Acabamento', desc: 'Beirais e testeiras pintados de claro.' },
};
export const DET = Object.fromEntries(Object.entries(ROOF_DETAILS).map(([k, v]) => [k, v.bit]));
// canonical detail string (sorted unique ids, '.'-joined) and its painter bits
export function cleanDet(det) {
  if (!det || typeof det !== 'string') return '';
  const ids = [...new Set(det.split('.').filter((k) => /^[a-z0-9_]{1,24}$/.test(k)))].sort().slice(0, 12);
  return ids.join('.');
}
export function detBits(det) {
  let b = 0;
  if (det && typeof det === 'string') for (const k of det.split('.')) b |= ROOF_DETAILS[k]?.bit || 0;
  return b;
}
