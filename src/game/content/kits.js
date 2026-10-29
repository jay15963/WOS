// Style / detail kits for construction pieces (agent K). Pure data + pure helpers (no DOM, no game state).
//
// RULE (docs/CONTENT.md §5.1): every construction piece (walls, doors, fences, gates, floors, farm plots, roofs,
// columns, stairs, railings…) gets a kit (square interior floors only: terrain paths are agent M's) — the catalogue of looks the player can pick in "Detalhes":
//   - explicit: BUILDINGS[type].kit = '<kit id>'   (kit: null opts out)
//   - inferred (so the next piece gets the system for free): wall group + tile block → 'wall', wall group door → 'door',
//     fence group → 'fence' / gate (block door) → 'gate', floor layer → 'floor', farm_plot → 'plot', layer 'roof' → 'roof',
//     ids starting with column_ / pillar_ → 'column'. Stations and furniture never get a kit.
// Shared structure fields (set only by ops, see mut/kit.js): o.style = style id ('' = the type's default look),
// o.det = canonical detail list: ids sorted and joined with '.' ('' = none). Styles and details are FREE (placing and
// restyling), they never change the build cost: decorating must stay relaxing.
//
// Kit entry: { name, tabs: [[cat, label]], styles: [style], details: [detail] }
//   style:  { id, name, desc?, types?: [buildingId] (default: every type of the kit), def?: true (the type's own art) }
//   detail: { id, name, cat, group? (exclusive with the others of the group), types? / mats? (filters),
//             front?: needs a visible south face (walls), tint?: [r,g,b] (tone), light?: {...}, glow? (night window) }

import { BUILDINGS } from './buildings.js';

const L = (r, g, b, radius, intensity, flicker, lift) => ({ r, g, b, radius, intensity, flicker, lift });

const TONE_WOOD = [
  { id: 't_light', name: 'Madeira clara', cat: 'tone', group: 'tone', mats: ['wood'], tint: [1.16, 1.12, 1.04] },
  { id: 't_dark', name: 'Madeira escura', cat: 'tone', group: 'tone', mats: ['wood'], tint: [0.7, 0.62, 0.58] },
  { id: 't_grey', name: 'Envelhecida', cat: 'tone', group: 'tone', mats: ['wood'], tint: [0.86, 0.86, 0.9] },
  { id: 't_red', name: 'Vermelho celeiro', cat: 'tone', group: 'tone', mats: ['wood'], tint: [1.12, 0.66, 0.56] },
  { id: 't_blue', name: 'Azul pintado', cat: 'tone', group: 'tone', mats: ['wood'], tint: [0.72, 0.86, 1.08] },
];
const TONE_STONE = [
  { id: 't_light', name: 'Pedra clara', cat: 'tone', group: 'tone', mats: ['stone'], tint: [1.12, 1.1, 1.06] },
  { id: 't_warm', name: 'Arenito', cat: 'tone', group: 'tone', mats: ['stone'], tint: [1.12, 0.98, 0.8] },
  { id: 't_dark', name: 'Basalto', cat: 'tone', group: 'tone', mats: ['stone'], tint: [0.7, 0.72, 0.76] },
  { id: 't_green', name: 'Pedra verde', cat: 'tone', group: 'tone', mats: ['stone'], tint: [0.88, 1.0, 0.86] },
];
const TONE_PLANT = [
  { id: 't_light', name: 'Verde claro', cat: 'tone', group: 'tone', mats: ['plant'], tint: [1.12, 1.12, 0.96] },
  { id: 't_dark', name: 'Verde escuro', cat: 'tone', group: 'tone', mats: ['plant'], tint: [0.74, 0.84, 0.76] },
  { id: 't_autumn', name: 'Outono', cat: 'tone', group: 'tone', mats: ['plant'], tint: [1.2, 0.92, 0.6] },
];
const TONES = [...TONE_WOOD, ...TONE_STONE, ...TONE_PLANT];

export const KITS = {
  wall: {
    name: 'Parede',
    tabs: [['style', 'Estilo'], ['corner', 'Cantos'], ['trim', 'Acabamentos'], ['wall', 'Na parede'], ['nature', 'Natureza'], ['tone', 'Cor']],
    styles: [
      { id: 'plank', name: 'Tábuas', types: ['wall_wood'], def: true, desc: 'Tábuas pregadas, o clássico.' },
      { id: 'log', name: 'Toras', types: ['wall_wood'], desc: 'Cabana de toras com as pontas cruzadas nos cantos.' },
      { id: 'timber', name: 'Enxaimel', types: ['wall_wood'], desc: 'Vigas escuras com mãos-francesas e reboco claro.' },
      { id: 'wattle', name: 'Pau a pique', types: ['wall_wood'], desc: 'Varas trançadas e barro, cantos macios.' },
      { id: 'cut', name: 'Blocos de pedra', types: ['wall_stone'], def: true, desc: 'Blocos lavrados em fiadas.' },
      { id: 'rough', name: 'Pedra bruta', types: ['wall_stone'], desc: 'Pedras irregulares assentadas à mão.' },
      { id: 'cobble', name: 'Seixos', types: ['wall_stone'], desc: 'Pedras de rio arredondadas na argamassa.' },
      { id: 'tbrick', name: 'Enxaimel de tijolos', types: ['wall_stone'], desc: 'Vigas de madeira com tijolos aparentes.' },
    ],
    details: [
      { id: 'soft', name: 'Cantos suaves', cat: 'corner', desc: 'Arredonda ou chanfra os cantos de fora.' },
      { id: 'post', name: 'Postes de canto', cat: 'corner', group: 'cp' },
      { id: 'quoin', name: 'Cunhais de pedra', cat: 'corner', group: 'cp' },
      { id: 'pillar', name: 'Pilares', cat: 'corner', group: 'cp' },
      { id: 'endcap', name: 'Arremates redondos', cat: 'corner', group: 'cp' },
      { id: 'buttress', name: 'Contrafortes', cat: 'corner', front: true },
      { id: 'plinth', name: 'Soco de pedra', cat: 'trim', front: true },
      { id: 'cap', name: 'Coroamento', cat: 'trim' },
      { id: 'beams', name: 'Vigas aparentes', cat: 'trim', front: true },
      { id: 'band', name: 'Cinta', cat: 'trim', front: true },
      { id: 'crenel', name: 'Ameias', cat: 'trim' },
      { id: 'window', name: 'Janela', cat: 'wall', group: 'win', front: true, glow: 1 },
      { id: 'shutters', name: 'Janela com venezianas', cat: 'wall', group: 'win', front: true, glow: 1 },
      { id: 'curtains', name: 'Janela com cortinas', cat: 'wall', group: 'win', front: true, glow: 1 },
      { id: 'oculus', name: 'Óculo', cat: 'wall', group: 'win', front: true, glow: 1 },
      { id: 'slit', name: 'Seteira', cat: 'wall', group: 'win', front: true },
      { id: 'winbox', name: 'Floreira', cat: 'wall', front: true },
      { id: 'shelf', name: 'Prateleira', cat: 'wall', group: 'mnt', front: true },
      { id: 'hooks', name: 'Ganchos', cat: 'wall', group: 'mnt', front: true },
      { id: 'antlers', name: 'Galhada', cat: 'wall', group: 'mnt', front: true },
      { id: 'pennant', name: 'Flâmula', cat: 'wall', group: 'mnt', front: true },
      { id: 'painting', name: 'Quadro', cat: 'wall', group: 'mnt', front: true },
      { id: 'shield', name: 'Escudo', cat: 'wall', group: 'mnt', front: true },
      { id: 'sconce', name: 'Arandela', cat: 'wall', group: 'mnt', front: true, light: L(1, 0.72, 0.4, 3.2, 0.85, 0.3, 0.55) },
      { id: 'ivy', name: 'Hera', cat: 'nature' },
      { id: 'moss', name: 'Musgo', cat: 'nature' },
      { id: 'cracks', name: 'Rachaduras', cat: 'nature' },
      { id: 'weather', name: 'Desgaste', cat: 'nature' },
      { id: 'flowers', name: 'Flores ao pé', cat: 'nature', front: true },
      ...TONE_WOOD, ...TONE_STONE,
    ],
  },
  door: {
    name: 'Porta',
    tabs: [['style', 'Estilo'], ['trim', 'Entrada'], ['tone', 'Cor']],
    styles: [
      { id: 'plank', name: 'Dupla de tábuas', def: true, desc: 'Duas folhas com cintas de ferro.' },
      { id: 'panel', name: 'Almofadada', desc: 'Folhas com almofadas entalhadas.' },
      { id: 'iron', name: 'Reforçada', desc: 'Tábuas grossas e muito ferro.' },
      { id: 'arched', name: 'Em arco', desc: 'Arco de pedra sobre a porta.' },
      { id: 'rustic', name: 'Rústica', desc: 'Tábuas cruas amarradas.' },
    ],
    details: [
      { id: 'awning', name: 'Toldo de madeira', cat: 'trim' },
      { id: 'lantern', name: 'Lanterna', cat: 'trim', light: L(1, 0.78, 0.46, 3.8, 0.95, 0.12, 0.62) },
      { id: 'knocker', name: 'Aldrava', cat: 'trim' },
      { id: 'wreath', name: 'Guirlanda', cat: 'trim' },
      { id: 'step', name: 'Degrau de pedra', cat: 'trim' },
      ...TONE_WOOD,
    ],
  },
  fence: {
    name: 'Cerca',
    tabs: [['style', 'Estilo'], ['trim', 'Postes'], ['nature', 'Natureza'], ['tone', 'Cor']],
    styles: [
      { id: 'rail', name: 'Varas', types: ['fence_wood'], def: true, desc: 'Postes redondos e duas varas.' },
      { id: 'picket', name: 'Estacas', types: ['fence_wood'], desc: 'Estacas pontudas pregadas em travessas.' },
      { id: 'board', name: 'Tábuas', types: ['fence_wood'], desc: 'Tábuas largas entre postes grossos.' },
      { id: 'wattle', name: 'Trançada', types: ['fence_wood'], desc: 'Galhos trançados entre estacas.' },
    ],
    details: [
      { id: 'cap_flat', name: 'Capas nos postes', cat: 'trim', group: 'pc', mats: ['wood'] },
      { id: 'cap_ball', name: 'Bolas nos postes', cat: 'trim', group: 'pc', mats: ['wood', 'stone'] },
      { id: 'cap_point', name: 'Pontas nos postes', cat: 'trim', group: 'pc', mats: ['wood'] },
      { id: 'lantern', name: 'Lanterna no poste', cat: 'trim', light: L(1, 0.8, 0.5, 3.4, 0.85, 0.1, 0.75) },
      { id: 'flowers', name: 'Flores ao pé', cat: 'nature' },
      { id: 'vines', name: 'Trepadeira', cat: 'nature' },
      { id: 'moss', name: 'Musgo', cat: 'nature', mats: ['stone'] },
      { id: 'bird', name: 'Passarinho', cat: 'nature' },
      ...TONES,
    ],
  },
  gate: {
    name: 'Portão',
    tabs: [['style', 'Estilo'], ['trim', 'Entrada'], ['tone', 'Cor']],
    styles: [
      { id: 'rail', name: 'Varas', def: true, desc: 'Folhas de ripas com mão-francesa.' },
      { id: 'picket', name: 'Estacas', desc: 'Combina com a cerca de estacas.' },
      { id: 'board', name: 'Tábuas', desc: 'Folhas fechadas de tábuas.' },
    ],
    details: [
      { id: 'arch', name: 'Arco com flores', cat: 'trim' },
      { id: 'lantern', name: 'Lanternas', cat: 'trim', light: L(1, 0.8, 0.5, 3.6, 0.9, 0.1, 0.8) },
      { id: 'cap_ball', name: 'Bolas nos postes', cat: 'trim', group: 'pc' },
      { id: 'sign', name: 'Plaquinha', cat: 'trim' },
      ...TONE_WOOD,
    ],
  },
  floor: {
    name: 'Piso',
    tabs: [['style', 'Padrão'], ['trim', 'Bordas'], ['wall', 'Tapetes'], ['nature', 'Natureza'], ['tone', 'Cor']],
    styles: [
      { id: 'plank', name: 'Tábuas', types: ['floor_wood'], def: true },
      { id: 'herring', name: 'Espinha de peixe', types: ['floor_wood'] },
      { id: 'parquet', name: 'Taco xadrez', types: ['floor_wood'] },
      { id: 'wide', name: 'Tábuas largas', types: ['floor_wood'] },
      { id: 'flag', name: 'Lajotas', types: ['floor_stone'], def: true },
      { id: 'cobble', name: 'Calçada', types: ['floor_stone'] },
      { id: 'tiles', name: 'Ladrilhos', types: ['floor_stone'] },
      { id: 'checker', name: 'Xadrez', types: ['floor_stone'] },
    ],
    details: [
      { id: 'b_board', name: 'Moldura de madeira', cat: 'trim', group: 'brd' },
      { id: 'b_curb', name: 'Meio-fio de pedra', cat: 'trim', group: 'brd' },
      { id: 'b_inlay', name: 'Faixa decorada', cat: 'trim', group: 'brd' },
      { id: 'inlay', name: 'Rosácea', cat: 'trim' },
      { id: 'carpet', name: 'Carpete', cat: 'wall', desc: 'Cobre os tiles pintados e se liga aos vizinhos.' },
      { id: 'c_red', name: 'Carpete vermelho', cat: 'wall', group: 'cc' },
      { id: 'c_blue', name: 'Carpete azul', cat: 'wall', group: 'cc' },
      { id: 'c_green', name: 'Carpete verde', cat: 'wall', group: 'cc' },
      { id: 'c_gold', name: 'Carpete dourado', cat: 'wall', group: 'cc' },
      { id: 'mossy', name: 'Musgo nas juntas', cat: 'nature', mats: ['stone'] },
      { id: 'straw', name: 'Palha espalhada', cat: 'nature' },
      { id: 'leaves', name: 'Folhas caídas', cat: 'nature' },
      ...TONE_WOOD, ...TONE_STONE,
    ],
  },
  plot: {
    name: 'Canteiro',
    tabs: [['trim', 'Bordas'], ['nature', 'Cobertura']],
    styles: [],
    details: [
      { id: 'e_wood', name: 'Borda de madeira', cat: 'trim', group: 'pe' },
      { id: 'e_stone', name: 'Borda de pedra', cat: 'trim', group: 'pe' },
      { id: 'straw', name: 'Palha', cat: 'nature' },
    ],
  },
  // agent J's columns (phase 2): J declares the type, K's art draws the looks
  column: {
    name: 'Coluna',
    tabs: [['style', 'Estilo'], ['trim', 'Detalhes'], ['tone', 'Cor']],
    styles: [
      { id: 'post', name: 'Poste de madeira', def: true },
      { id: 'stone', name: 'Coluna de pedra' },
      { id: 'round', name: 'Coluna redonda' },
      { id: 'carved', name: 'Entalhada' },
    ],
    details: [
      { id: 'capital', name: 'Capitel', cat: 'trim' },
      { id: 'base', name: 'Base de pedra', cat: 'trim' },
      { id: 'banner', name: 'Estandarte', cat: 'trim' },
      { id: 'sconce', name: 'Arandela', cat: 'trim', light: L(1, 0.72, 0.4, 3.2, 0.85, 0.3, 0.9) },
      { id: 'ivy', name: 'Hera', cat: 'trim' },
      ...TONE_WOOD, ...TONE_STONE,
    ],
  },
  // agent J's built roofs (types roof_thatch / roof_wood / roof_stone, layer 'roof'): J's renderer turns roofLook(o)
  // (below) into its per-tile look; J paints the chimney (det 'chimney' or a fire under the roof) and the vane itself
  roof: {
    name: 'Telhado',
    tabs: [['style', 'Material'], ['trim', 'Forma e acabamento'], ['wall', 'No telhado'], ['nature', 'Tempo'], ['tone', 'Cor']],
    styles: [
      { id: 'thatch', name: 'Palha', types: ['roof_thatch'], def: true, desc: 'Sapê grosso amarrado na cumeeira.' },
      { id: 'turf', name: 'Telhado verde', types: ['roof_thatch'], desc: 'Grama e flores sobre o telhado.' },
      { id: 'shake', name: 'Telhas de madeira', types: ['roof_wood'], def: true, desc: 'Tabuinhas sobrepostas.' },
      { id: 'wscale', name: 'Escamas de madeira', types: ['roof_wood'], desc: 'Tabuinhas recortadas em escama.' },
      { id: 'slate', name: 'Ardósia azul', types: ['roof_stone'], def: true, desc: 'Escamas de ardósia azulada.' },
      { id: 'stone', name: 'Lajes cinza', types: ['roof_stone'], desc: 'Escamas de pedra cinza.' },
      { id: 'terra', name: 'Terracota', types: ['roof_stone'], desc: 'Escamas de barro alaranjadas.' },
      { id: 'flag', name: 'Lajes grossas', types: ['roof_stone'], desc: 'Placas de pedra pesadas.' },
    ],
    details: [
      { id: 'end_gable', name: 'Duas águas (empena)', cat: 'trim', group: 'ends' },
      { id: 'end_hip', name: 'Quatro águas', cat: 'trim', group: 'ends' },
      { id: 'gab_plaster', name: 'Empena de reboco', cat: 'trim', group: 'gab' },
      { id: 'gab_planks', name: 'Empena de tábuas', cat: 'trim', group: 'gab' },
      { id: 'gab_stone', name: 'Empena de pedra', cat: 'trim', group: 'gab' },
      { id: 'r_board', name: 'Cumeeira de tábua', cat: 'trim', group: 'ridge' },
      { id: 'r_tile', name: 'Cumeeira de telha', cat: 'trim', group: 'ridge' },
      { id: 'r_bound', name: 'Cumeeira amarrada', cat: 'trim', group: 'ridge' },
      { id: 'barge', name: 'Bordas grossas escuras', cat: 'trim' },
      { id: 'trim', name: 'Acabamento de beiral', cat: 'trim' },
      { id: 'chimney', name: 'Chaminé de pedra', cat: 'wall' },
      { id: 'vane', name: 'Cata-vento', cat: 'wall' },
      { id: 'moss', name: 'Musgo', cat: 'nature' },
      { id: 'weather', name: 'Desgaste', cat: 'nature' },
      { id: 'icicles', name: 'Pingentes de gelo', cat: 'nature' },
      { id: 't_light', name: 'Mais claro', cat: 'tone', group: 'tone', tint: [1.14, 1.12, 1.08] },
      { id: 't_dark', name: 'Mais escuro', cat: 'tone', group: 'tone', tint: [0.74, 0.74, 0.78] },
      { id: 't_warm', name: 'Quente', cat: 'tone', group: 'tone', tint: [1.12, 0.96, 0.82] },
      { id: 't_cool', name: 'Frio', cat: 'tone', group: 'tone', tint: [0.86, 0.94, 1.1] },
    ],
  },
};

// roof props: roof-layer structures K draws as sprites on the slope (phase 2, via J's roofPropAt). Chimney and vane are
// roof details painted by J (det 'chimney' / 'vane'), not props.
export const ROOF_PROPS = [
  { id: 'roof_dormer', name: 'Água-furtada', sprites: ['roof_dormer_wood', 'roof_dormer_plaster'], glow: 'roof_dormer_glow', desc: 'Janelinha saindo do telhado; brilha à noite.' },
  { id: 'roof_skylight', name: 'Claraboia', sprites: ['roof_skylight_glass'], desc: 'Deixa a luz entrar.' },
];

// ---------- lookup ----------
const INFER_CACHE = new Map();
export function kitIdOf(type) {
  if (INFER_CACHE.has(type)) return INFER_CACHE.get(type);
  const d = BUILDINGS[type];
  let k = null;
  if (d) {
    if (d.kit !== undefined) k = d.kit || null;
    else if (d.station || d.slots || d.decor) k = null;
    else if (d.layer === 'roof') k = 'roof';
    else if (/^(column|pillar)_/.test(type)) k = 'column';
    else if (type === 'farm_plot') k = 'plot';
    else if (d.layer === 'floor') k = 'floor';
    else if (d.connect === 'wall') k = d.block === 'door' ? 'door' : d.block === 'tile' ? 'wall' : null;
    else if (d.connect === 'fence') k = d.block === 'door' ? 'gate' : 'fence';
  }
  if (k && !KITS[k]) k = null;
  INFER_CACHE.set(type, k);
  return k;
}
export const kitOf = (type) => { const k = kitIdOf(type); return k ? KITS[k] : null; };
export const hasKit = (type) => !!kitIdOf(type);

// material of a piece (tone filters): explicit def.mat, else from the cost
export function matOf(type) {
  const d = BUILDINGS[type];
  if (!d) return 'wood';
  if (d.mat) return d.mat;
  const c = d.cost || {};
  if (c.stone_block || c.stone) return 'stone';
  if (c.fiber && !c.wood) return 'plant';
  return 'wood';
}

const okFor = (e, type) => (!e.types || e.types.includes(type)) && (!e.mats || e.mats.includes(matOf(type)));
export function stylesFor(type) {
  const k = kitOf(type);
  return k ? k.styles.filter((s) => okFor(s, type)) : [];
}
export function detailsFor(type) {
  const k = kitOf(type);
  return k ? k.details.filter((d) => okFor(d, type)) : [];
}
export const defaultStyle = (type) => stylesFor(type).find((s) => s.def)?.id || stylesFor(type)[0]?.id || '';

// '' when s is the type's default look or unknown
export function normStyle(type, s) {
  if (typeof s !== 'string' || !s) return '';
  const st = stylesFor(type).find((x) => x.id === s);
  return !st || st.def ? '' : st.id;
}
export const styleOf = (o) => o.style || defaultStyle(o.type);

export const MAX_DET = 16;
// canonical detail string: known ids for this type, one per exclusive group (first in sorted order), sorted, '.'-joined
export function cleanDet(type, det) {
  if (!det) return '';
  const ids = Array.isArray(det) ? det : typeof det === 'string' ? det.split('.') : [];
  const avail = detailsFor(type);
  const out = [], groups = new Set();
  for (const id of [...new Set(ids)].filter((x) => typeof x === 'string').sort()) {
    const d = avail.find((x) => x.id === id);
    if (!d) continue;
    if (d.group) { if (groups.has(d.group)) continue; groups.add(d.group); }
    out.push(id);
    if (out.length >= MAX_DET) break;
  }
  return out.join('.');
}
export const detList = (det) => (det ? det.split('.') : []);
export const hasDet = (det, id) => !!det && ('.' + det + '.').includes('.' + id + '.');

// toggle one detail (adding drops the others of its exclusive group)
export function withDetail(type, det, id, on = null) {
  const d = detailsFor(type).find((x) => x.id === id);
  if (!d) return cleanDet(type, det);
  let ids = detList(det);
  const has = ids.includes(id);
  const want = on == null ? !has : !!on;
  if (want === has) return cleanDet(type, det);
  if (want) {
    if (d.group) ids = ids.filter((x) => detailsFor(type).find((y) => y.id === x)?.group !== d.group);
    ids.push(id);
  } else ids = ids.filter((x) => x !== id);
  return cleanDet(type, ids);
}

// ---------- decoded look (read-only, cached; art + UI) ----------
const DECODE = new Map();
export function decodeKit(type, style, det) {
  const key = type + '|' + (style || '') + '|' + (det || '');
  let k = DECODE.get(key);
  if (k) return k;
  const kid = kitIdOf(type);
  const ids = detList(det);
  const avail = detailsFor(type);
  const on = {};
  let tint = null, light = null, glow = 0;
  for (const id of ids) {
    const d = avail.find((x) => x.id === id);
    if (!d) continue;
    on[id] = d;
    if (d.tint) tint = d.tint;
    if (d.light && !light) light = d.light;
    if (d.glow) glow = 1;
  }
  k = { key, kit: kid, type, style: normStyle(type, style) || defaultStyle(type), custom: !!normStyle(type, style), on, ids, tint, light, glow, n: ids.length };
  DECODE.set(key, k);
  return k;
}

// ---------- interface for agent J (roof renderer) ----------
// roofLook(o) → J's per-tile look fields: { mat, pattern: 'thatch'|'shake'|'scale'|'slab'|'turf', base, dark, light ([r,g,b] 0..1,
// tone already multiplied), ends: 'gable'|'hip'|null, gable: 'plaster'|'planks'|'stone'|null, ridge: 'board'|'tile'|'bound'|null,
// barge, trim, chimney, vane, moss, weather, icicles (booleans) }. null = J's default for the type.
export const ROOF_MATS = {
  thatch: { pattern: 'thatch', base: [196, 164, 98], dark: [122, 94, 52], light: [228, 204, 140] },
  turf: { pattern: 'turf', base: [104, 140, 66], dark: [64, 92, 40], light: [146, 182, 92] },
  shake: { pattern: 'shake', base: [150, 104, 64], dark: [92, 60, 34], light: [190, 142, 94] },
  wscale: { pattern: 'scale', base: [158, 112, 70], dark: [96, 62, 36], light: [196, 150, 100] },
  slate: { pattern: 'scale', base: [92, 112, 140], dark: [52, 64, 86], light: [140, 160, 186] },
  stone: { pattern: 'scale', base: [136, 134, 128], dark: [86, 84, 80], light: [180, 178, 170] },
  terra: { pattern: 'scale', base: [204, 112, 62], dark: [138, 66, 34], light: [234, 156, 100] },
  flag: { pattern: 'slab', base: [146, 140, 128], dark: [92, 88, 80], light: [186, 180, 168] },
};
export function roofLook(o) {
  const k = decodeKit(o.type, o.style, o.det);
  const mat = ROOF_MATS[k.style] ? k.style : 'thatch';
  const M = ROOF_MATS[mat], t = k.tint || [1, 1, 1], on = k.on;
  const c = (v) => [Math.min(1, (v[0] / 255) * t[0]), Math.min(1, (v[1] / 255) * t[1]), Math.min(1, (v[2] / 255) * t[2])];
  return {
    mat, pattern: M.pattern, base: c(M.base), dark: c(M.dark), light: c(M.light),
    ends: on.end_gable ? 'gable' : on.end_hip ? 'hip' : null,
    gable: on.gab_plaster ? 'plaster' : on.gab_planks ? 'planks' : on.gab_stone ? 'stone' : null,
    ridge: on.r_board ? 'board' : on.r_tile ? 'tile' : on.r_bound ? 'bound' : null,
    barge: !!on.barge, trim: !!on.trim, chimney: !!on.chimney, vane: !!on.vane,
    moss: !!on.moss, weather: !!on.weather, icicles: !!on.icicles,
  };
}
