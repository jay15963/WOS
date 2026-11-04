// Prefab buildings of the settlements (docs/REINOS.md "Implementação — geração"), "like Minecraft structures": each is a
// fixed layout drawn as ASCII rows (north at the top, the FRONT — where the door is — at the bottom), stamped by the
// layout (layout.js) at a spot and rotation, as real game structures (walls, doors, floors, roofs, furniture, lights).
// Pure data + the stamping helper; no game imports (it runs in the chunk workers too).
//
// rows: the building (story 0) · up: story 1 (same size; '-' = nothing there: the stairwell) · yard: rows in front of
// the building (after one empty row: the doorstep) — only furniture / props there.
// Legend: #  wall (the prefab's wall type + style)   D  door   .  floor (the prefab's floor type; none = bare earth)
//         ' ' nothing   lowercase / some uppercase letters: furniture anchors (FURN)   T B + continuation of a piece
// Furniture rot is given in the prefab's own frame (front = south); the stamp turns it with the building. Windows are put
// on the walls that face south in the world (the art draws a window on a wall's south face).
// Hooks for phase 2 (citizens): beds (homes), work spots (stations / workplaces), lights.
// Doors (docs/REINOS.md "Fase 2 — correções e desempenho"): the tile right inside a door is '.' (or a mark that does not
// block: a torch, a rug) and every bed / workplace / chest has a free tile beside it reached from the door — checked for
// every prefab × rotation by tools/mp-test/towncheck.js (scenario FX1) with the game's own pathfinding.

export const FURN = {
  b: { t: 'bed', rot: 0 },               // 1×2 (head north)
  e: { t: 'bed', rot: 1 },               // 2×1
  t: { t: 'table_wood', rot: 0 },        // 2×1
  c: { t: 'chair_wood', edge: 0 },
  n: { t: 'chair_wood', edge: 1 },
  h: { t: 'chest', edge: 1 },            // against the north wall
  j: { t: 'chest', edge: 4 },            // against the west wall
  f: { t: 'fireplace', rot: 0 },         // 2×1
  r: { t: 'barrel', edge: 0 },
  s: { t: 'sacks', edge: 0 },
  x: { t: 'crates', edge: 0 },
  a: { t: 'anvil', work: 1 },
  F: { t: 'furnace', work: 1 },
  k: { t: 'workbench', rot: 0, work: 1 }, // 2×1
  l: { t: 'loom', rot: 0, work: 1 },      // 2×1
  g: { t: 'cooking_pot', work: 1 },
  p: { t: 'woodpile', rot: 0 },           // 2×1
  w: { t: 'weapon_rack', rot: 0 },        // 2×1
  m: { t: 'armor_stand', edge: 0 },
  y: { t: 'training_dummy' },
  u: { t: 'bookshelf', rot: 0 },          // 2×1
  d: { t: 'dresser', rot: 0 },            // 2×1
  q: { t: 'wardrobe', edge: 1 },
  o: { t: 'table_round' },
  i: { t: 'chair_fine', edge: 1 },
  v: { t: 'candles', edge: 0 },
  z: { t: 'statue' },
  L: { t: 'torch', edge: 1, light: 1 },  // wall torch against the north wall
  R: { t: 'rug', rot: 1 },                // 2×1, rug layer
  U: { t: 'rug_round' },                  // 2×2, rug layer
  Z: { t: 'brazier', light: 1 },
  P: { t: 'lamp_post', edge: 0, light: 1 },
  K: { t: 'stairs_wood', rot: 0 },        // 1×2, up to the story above (it climbs north)
  V: { t: 'haystack' },
  A: { t: 'feeder', rot: 0 },             // 2×1
  C: { t: 'cart', rot: 1 },               // 2×1
  S: { t: 'stonecutter', rot: 0, work: 1 }, // 2×1
  O: { t: 'well' },
  Q: { t: 'drying_rack', rot: 0 },        // 2×1
  N: { t: 'banner', edge: 1 },
  E: { t: 'bench_wood', rot: 0 },         // 2×1
  G: { t: 'table_small' },
  I: { t: 'herbs_hang', edge: 1 },
  J: { t: 'jars', edge: 0 },
  Y: { t: 'scarecrow' },
  H: { t: 'beehive' },
};
const SKIP = new Set(['T', 'B', '+']); // continuation marks of multi-tile pieces

// mat: 'wood' | 'stone'; style: wall kit style; roof: [roof type, roof style]; floor: floor type or null (earth)
export const PREFABS = {
  // ---- homes ----
  house_s: { name: 'Casa pequena', pop: 2, mat: 'wood', roof: ['roof_thatch', 'thatch'], floor: null, rows: [
    '#####',
    '#bLh#',
    '#B..#',
    '#..G#',
    '##D##',
  ] },
  house_s2: { name: 'Casa pequena', pop: 2, mat: 'wood', style: 'wattle', roof: ['roof_thatch', 'thatch_old'], floor: 'floor_wood', rows: [
    '######',
    '#b.Lr#',
    '#B...#',
    '#tT.c#',
    '###D##',
  ], yard: ['    r '] },
  house_m: { name: 'Casa', pop: 4, mat: 'wood', style: 'timber', roof: ['roof_wood', 'shingle'], floor: 'floor_wood', rows: [
    '#######',
    '#bb.fT#',
    '#BB...#',
    '#..o.x#',
    '#.L...#',
    '###D###',
  ] },
  house_l: { name: 'Casa grande', pop: 6, mat: 'wood', style: 'timber', roof: ['roof_wood', 'shingle_red'], floor: 'floor_wood', rows: [
    '#########',
    '#bb.#.bq#',
    '#BB.#.B.#',
    '#.......#',
    '#.tT.fT.#',
    '#.cc...x#',
    '#.L....r#',
    '####D####',
  ], yard: ['  E+     '] },
  house_stone: { name: 'Casa de pedra', pop: 4, mat: 'stone', style: 'cut', roof: ['roof_stone', 'terracotta'], floor: 'floor_stone', rows: [
    '########',
    '#bb.fT.#',
    '#BB....#',
    '#..tT.x#',
    '#.L...c#',
    '####D###',
  ] },
  cottage_stone: { name: 'Casa de pedra pequena', pop: 3, mat: 'stone', style: 'cobble', roof: ['roof_stone', 'terracotta'], floor: 'floor_stone', rows: [
    '######',
    '#b.Lh#',
    '#B...#',
    '#..tT#',
    '##D###',
  ] },
  townhouse: { name: 'Sobrado', pop: 5, mat: 'stone', style: 'tbrick', roof: ['roof_stone', 'slate'], floor: 'floor_wood', rows: [
    '########',
    '#bb.uT.#',
    '#BB....#',
    '#..o..x#',
    '#.L..dT#',
    '###D####',
  ] },
  farmhouse: { name: 'Casa de fazenda', pop: 5, mat: 'wood', style: 'log', roof: ['roof_thatch', 'thatch'], floor: 'floor_wood', rows: [
    '########',
    '#bb.fT.#',
    '#BB...s#',
    '#.tT..r#',
    '#.L..x.#',
    '####D###',
  ], yard: ['V  Q+  V'] },
  // ---- work ----
  smithy: { name: 'Ferraria', work: 'Ferreiro', pop: 0, mat: 'stone', style: 'rough', roof: ['roof_stone', 'stone'], floor: 'floor_stone', rows: [
    '########',
    '#F.a.wT#',
    '#......#',
    '#x..m..#',
    '#..L...#',
    '###D####',
  ], yard: ['  p+  r '] },
  sawmill: { name: 'Serraria', work: 'Lenhador', pop: 0, mat: 'wood', style: 'log', roof: ['roof_wood', 'shingle'], floor: null, rows: [
    '#######',
    '#kT.pT#',
    '#.....#',
    '#x.L..#',
    '##D####',
  ], yard: ['p+ p+  ', '   C+  '] },
  granary: { name: 'Celeiro', work: 'Armazém', pop: 0, mat: 'wood', style: 'timber', roof: ['roof_wood', 'shingle_red'], floor: 'floor_wood', rows: [
    '########',
    '#sxsrrx#',
    '#......#',
    '#s....s#',
    '#x.L..r#',
    '###D####',
  ], yard: ['V  C+  V'] },
  tavern: { name: 'Taverna', work: 'Taverneiro', pop: 2, mat: 'wood', style: 'timber', roof: ['roof_wood', 'shingle'], floor: 'floor_wood', rows: [
    '##########',
    '#rr.fT.gx#',
    '#........#',
    '#.oc..oc.#',
    '#........#',
    '#.tT..tT.#',
    '#.cc..cc.#',
    '#L......L#',
    '####D#####',
  ], yard: ['  E+  r   '] },
  weaver: { name: 'Tecelagem', work: 'Tecelão', pop: 2, mat: 'wood', style: 'wattle', roof: ['roof_thatch', 'thatch'], floor: 'floor_wood', rows: [
    '#######',
    '#lT.bq#',
    '#...B.#',
    '#Q+.L.#',
    '###D###',
  ] },
  chapel: { name: 'Capela', work: 'Sacerdote', pop: 1, mat: 'stone', style: 'cut', roof: ['roof_stone', 'slate'], floor: 'floor_stone', rows: [
    '#######',
    '#v.z.v#',
    '#.....#',
    '#E+.E+#',
    '#.....#',
    '#E+.E+#',
    '#L...L#',
    '###D###',
  ] },
  barracks: { name: 'Quartel', work: 'Guarda', guard: 1, pop: 8, mat: 'stone', style: 'rough', roof: ['roof_stone', 'stone'], floor: 'floor_wood', rows: [
    '###########',
    '#b.b.b.b.h#',
    '#B.B.B.B..#',
    '#.........#',
    '#wT.m.m.wT#',
    '#.L.....L.#',
    '#####D#####',
  ], yard: [' y   y   y '] },
  guardpost: { name: 'Posto da guarda', work: 'Guarda', guard: 1, pop: 2, mat: 'wood', style: 'log', roof: ['roof_wood', 'shingle'], floor: 'floor_wood', rows: [
    '#####',
    '#e+h#',
    '#m.L#',
    '##D##',
  ], yard: ['w+ Z '] },
  stable: { name: 'Estábulo', work: 'Cavalariço', pop: 0, mat: 'wood', style: 'plank', roof: ['roof_thatch', 'thatch_old'], floor: null, rows: [
    '#########',
    '#V.A+.V.#',
    '#.......#',
    '#.......#',
    '#L.....L#',
    '###D#####',
  ] },
  mine: { name: 'Entrada da mina', work: 'Mineiro', pop: 0, mat: 'stone', style: 'rough', roof: ['roof_wood', 'shingle'], floor: null, rows: [
    '######',
    '#xS+x#',
    '#..L.#',
    '##D###',
  ], yard: [' C+  r', ' x  x '] },
  storehouse: { name: 'Armazém', work: 'Armazém', pop: 0, mat: 'stone', style: 'cut', roof: ['roof_stone', 'terracotta'], floor: 'floor_stone', rows: [
    '#########',
    '#rrxsxrr#',
    '#.......#',
    '#x.s.r.x#',
    '#L.....L#',
    '####D####',
  ] },
  // ---- the castle keep: the hall below, the lord's rooms above (the stairs climb north to a landing on the slab) ----
  keep: { name: 'Torre de menagem', work: 'Senhor', pop: 4, mat: 'stone', style: 'cut', roof: ['roof_stone', 'slate'], floor: 'floor_stone', det: 'crenel', rows: [
    '##########',
    '#N.i.fT..#',
    '#.o....K.#',
    '#..U+..+.#',
    '#..++...x#',
    '#tT..tT..#',
    '#L.....L.#',
    '####D#####',
  ], up: [
    '##########',
    '#bb.dT..h#',
    '#BB....-.#',
    '#..q...-.#',
    '#.uT.....#',
    '#.R+..e+.#',
    '#L.......#',
    '##########',
  ] },
};
for (const k in PREFABS) {
  const P = PREFABS[k];
  const w = Math.max(...P.rows.map((r) => r.length));
  const fit = (r) => (r + ' '.repeat(w)).slice(0, w);
  P.rows = P.rows.map(fit);
  if (P.up) P.up = P.up.map(fit);
  P.hh = P.rows.length;                                   // the building's rows
  P.yard = P.yard ? P.yard.map(fit) : null;
  P.w = w; P.h = P.hh + (P.yard ? 1 + P.yard.length : 0); // the whole lot (building, doorstep row, yard)
}

export const WOOD_STYLES = ['plank', 'timber', 'log', 'wattle'];
export const WINDOWS = ['window_shutters', 'window', 'window_curtains'];

// ---------- rotation ----------
// R = quarter turns clockwise (screen, y down): the front (south) goes to west (R1), north (R2), east (R3) — the same
// order as the rot of rotating pieces (front S, W, N, E)
export const rotDims = (w, h, R) => (R & 1 ? [h, w] : [w, h]);
export function rotXY(i, j, w, h, R) {
  switch (R & 3) {
    case 1: return [h - 1 - j, i];
    case 2: return [w - 1 - i, h - 1 - j];
    case 3: return [j, w - 1 - i];
    default: return [i, j];
  }
}
// an edge piece's rot (0 centre, 1 N, 2 E, 3 S, 4 W) after R clockwise quarter turns
export const rotEdge = (e, R) => (e ? 1 + ((e - 1 + R) & 3) : 0);
// sizes of the multi-tile furniture (content/buildings.js `size`, copied: no game import here)
export const SIZE = { bed: [1, 2], table_wood: [2, 1], fireplace: [2, 1], workbench: [2, 1], loom: [2, 1], woodpile: [2, 1], weapon_rack: [2, 1],
  bookshelf: [2, 1], dresser: [2, 1], rug: [2, 1], rug_round: [2, 2], stairs_wood: [1, 2], feeder: [2, 1], cart: [2, 1], stonecutter: [2, 1],
  drying_rack: [2, 1], bench_wood: [2, 1], pergola: [2, 2], fountain: [2, 2], bench_stone: [2, 1], planter: [2, 1], washtub: [2, 1] };
// lot size of a prefab turned R
export const lotOf = (key, R) => rotDims(PREFABS[key].w, PREFABS[key].h, R);

// Stamp prefab `key` with the top-left of its turned lot at (x0, y0). put(type, tx, ty, rot, lv, style, det) adds a
// structure and returns its index (< 0 = skipped). Returns { beds, work, doors, lights, tiles (building tiles), box }.
export function stampPrefab(key, x0, y0, R, put, opt = {}) {
  const P = PREFABS[key];
  const out = { key, R, beds: [], work: [], doors: [], lights: [], tiles: [], door: null };
  const style = opt.style || P.style || (P.mat === 'stone' ? 'cut' : 'plank');
  const win = opt.win || WINDOWS[0];
  const wallT = P.mat === 'stone' ? 'wall_stone' : 'wall_wood';
  const doorStyle = opt.door || (P.mat === 'stone' ? 'arched' : 'plank');
  const at = (i, j) => { const [rx, ry] = rotXY(i, j, P.w, P.h, R); return [x0 + rx, y0 + ry]; };
  // the building's world box and its south row (windows go on the walls of that row)
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  for (const [i, j] of [[0, 0], [P.w - 1, 0], [0, P.hh - 1], [P.w - 1, P.hh - 1]]) { const [x, y] = at(i, j); bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  out.box = [bx0, by0, bx1, by1];
  const layers = [[P.rows, 0]];
  if (P.up) layers.push([P.up, 1]);
  for (const [rows, lv] of layers) {
    const furn = [];
    for (let j = 0; j < P.hh; j++) for (let i = 0; i < P.w; i++) {
      const ch = rows[j][i];
      if (ch === ' ') continue;
      const [tx, ty] = at(i, j);
      if (!lv) out.tiles.push([tx, ty]);
      if (ch === '#') {
        const south = ty === by1 && tx > bx0 && tx < bx1;
        const dets = [P.det, opt.det, south && ((tx - bx0) & 1) && !doorNear(rows, P, R, i, j) ? win : ''].filter(Boolean).join('.');
        put(wallT, tx, ty, 0, lv, style, dets);
        continue;
      }
      if (ch === 'D') { const k = put('door_wood', tx, ty, 0, lv, doorStyle, opt.doorDet || ''); if (!lv) { out.doors.push(k); out.door = [tx, ty]; } continue; }
      if (ch === '-') continue;
      // inside: a floor under everything (story 1: the slab, never over the stairwell)
      if (lv) put('floor_wood', tx, ty, 0, 1, 'plank', '');
      else if (P.floor) put(P.floor, tx, ty, 0, 0, '', '');
      if (ch === '.' || SKIP.has(ch)) continue;
      const F = FURN[ch];
      if (F) furn.push([F, i, j]);
    }
    for (const [F, i, j] of furn) furniture(F, i, j, lv, P, R, x0, y0, put, out);
  }
  if (P.yard) for (let j = 0; j < P.yard.length; j++) for (let i = 0; i < P.w; i++) {
    const F = FURN[P.yard[j][i]];
    if (F) furniture(F, i, P.hh + 1 + j, 0, P, R, x0, y0, put, out);
  }
  return out;
}
// a wall right next to the door (no window there: the door canopy / lantern)
function doorNear(rows, P, R, i, j) { return rows[j][i - 1] === 'D' || rows[j][i + 1] === 'D'; }
function furniture(F, i, j, lv, P, R, x0, y0, put, out) {
  // multi-tile pieces: the anchor is the top-left of the footprint in the prefab's frame; turned, the footprint's top-left
  // is the min of its corners
  const size = SIZE[F.t] || [1, 1], fr = F.rot ?? 0, [fw, fh] = fr & 1 ? [size[1], size[0]] : size;
  let mx = 1e9, my = 1e9;
  for (const [a, b] of [[i, j], [i + fw - 1, j], [i, j + fh - 1], [i + fw - 1, j + fh - 1]]) { const [rx, ry] = rotXY(a, b, P.w, P.h, R); if (rx < mx) mx = rx; if (ry < my) my = ry; }
  const rot = F.edge != null ? rotEdge(F.edge, R) : F.rot != null ? (fr + R) & 3 : 0;
  const k = put(F.t, x0 + mx, y0 + my, rot, lv, '', '');
  if (k < 0) return;
  if (F.t === 'bed') out.beds.push(k);
  if (F.work) out.work.push(k);
  if (F.light) out.lights.push(k);
}
