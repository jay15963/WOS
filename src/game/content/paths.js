// Painted terrain paths (agent M): pure data. Index = path type id stored in world.path (0 = none).
// Paths are terrain, not structures: they blend softly into the ground in the terrain shader (src/engine/shaders.js,
// "[paths]" block), have no sprite and live in a per-tile grid (src/game/mut/paths.js). Floors stay square (indoors).
//
// Fields: key, name (pt-BR), g ('m'|'f'), cost per tile (paid when the patch is laid), time (s of work per tile),
//   speed (walking speed multiplier on it), surface (footstep sound), xp per tile, layer (material texture layer in
//   src/world/pathTex.js), swatch (UI fallback colour), desc, needs (hint when the material comes from a station).

export const PATH_TYPES = [
  null,
  { key: 'dirt', name: 'Caminho de terra', g: 'm', cost: {}, time: 0.22, speed: 1.04, surface: 'dirt', xp: 0.1, layer: 0, swatch: '#8a6d4c',
    desc: 'Terra batida, de graça e rápida de fazer. Marcas de rodas e pegadas. Um pouco mais rápido de andar.' },
  { key: 'gravel', name: 'Caminho de cascalho', g: 'm', cost: { pebble: 1 }, time: 0.42, speed: 1.08, surface: 'gravel', xp: 0.2, layer: 1, swatch: '#8f8a80',
    desc: 'Cascalho solto de pedrinhas. Barato, seco na chuva e mais rápido de andar.' },
  { key: 'flag', name: 'Lajota', g: 'f', cost: { stone: 1 }, time: 0.75, speed: 1.1, surface: 'stone', xp: 0.3, layer: 2, swatch: '#9a948a',
    desc: 'Lajes irregulares de pedra com grama crescendo nas frestas.' },
  { key: 'cobble', name: 'Paralelepípedo', g: 'm', cost: { stone_block: 1 }, time: 1.0, speed: 1.12, surface: 'stone', xp: 0.4, layer: 3, swatch: '#7d7c7e',
    desc: 'Pedra cortada em fileiras, a estrada mais rápida.', needs: 'Blocos de pedra: Mesa de cantaria' },
  { key: 'steps', name: 'Pedras de passagem', g: 'f', cost: { stone: 1 }, time: 0.55, speed: 1.06, surface: 'stone', xp: 0.2, layer: 4, swatch: '#a39d92',
    desc: 'Pedras chatas no meio da grama, para um jardim tranquilo.' },
];
export const PATH_BY_KEY = Object.fromEntries(PATH_TYPES.filter(Boolean).map((t, k) => [t.key, k + 1]));
export const PATH_COUNT = PATH_TYPES.length - 1;
export const PATH_REMOVE = 15;           // plan code: remove the built path here
export const PATH_SURFACE = PATH_TYPES.map((t) => (t ? t.surface : ''));
export const PATH_REFUND = 0.75;         // share of the materials given back when a path is removed / replaced
export const PATH_MAX_PAINT = 2000;      // tiles per paint request
export const PATH_PAINT_DIST = 30;       // tiles from the painter
export const PATH_PATCH = 6;             // tiles laid per work cycle (around the worked tile)
export const PATH_REACH = 3.2;           // host check: worker within this of every tile it lays
