// Crafting recipes by station (pure data, no DOM). All user-facing strings in Brazilian Portuguese.
// See docs/CONTENT.md §1 (eras). Recipe ids are free-form; `out` is the produced item id.
//
// { out, qty?, in: { item: n }, station: 'hand' | <building type> | [types], time (s), cat, fuel? (furnace units) }
// Stations work when the player is within STATION_RANGE tiles. Furnace fuel: 1 wood = 1 unit, 1 coal = 3 units.

export const STATION_RANGE = 3;
export const FUEL_VALUE = { wood: 1, coal: 3 };

export const STATION_PT = {
  hand: 'À mão', workbench: 'Bancada de trabalho', stonecutter: 'Mesa de cantaria', furnace: 'Fornalha',
  anvil: 'Bigorna', loom: 'Tear', cooking_pot: 'Caldeirão', campfire: 'Fogueira',
};

export const CRAFT_CATS = [
  ['tools', 'Ferramentas'], ['weapons', 'Armas'], ['armor', 'Armaduras'], ['materials', 'Materiais'], ['food', 'Comida'],
];

const R = (out, inp, station, time, cat, extra = {}) => ({ out, in: inp, station, time, cat, qty: 1, ...extra });
const ROAST = ['campfire', 'cooking_pot'];

export const RECIPES = {
  // ---------- era 0: by hand ----------
  knife_primitive:   R('knife_primitive', { pebble: 2, fiber: 1 }, 'hand', 3, 'tools'),
  axe_primitive:     R('axe_primitive', { pebble: 2, fiber: 2, stick: 1 }, 'hand', 4, 'tools'),
  pickaxe_primitive: R('pickaxe_primitive', { pebble: 3, fiber: 2, stick: 1 }, 'hand', 4, 'tools'),
  rope:              R('rope', { fiber: 3 }, 'hand', 2, 'materials'),
  torch_hand:        R('torch_hand', { stick: 1, fiber: 1 }, 'hand', 2, 'weapons'),
  hat_straw:         R('hat_straw', { fiber: 6 }, 'hand', 5, 'armor'),

  // ---------- era 1: workbench ----------
  sticks:            R('stick', { wood: 1 }, 'workbench', 1.5, 'materials', { qty: 3 }),
  knife_stone:       R('knife_stone', { stone: 1, wood: 1, fiber: 2 }, 'workbench', 4, 'tools'),
  axe_stone:         R('axe_stone', { stone: 3, wood: 2, rope: 1 }, 'workbench', 6, 'tools'),
  pickaxe_stone:     R('pickaxe_stone', { stone: 4, wood: 2, rope: 1 }, 'workbench', 6, 'tools'),
  spear_stone:       R('spear_stone', { stone: 2, wood: 3, rope: 1 }, 'workbench', 6, 'weapons'),
  club_wood:         R('club_wood', { wood: 5, fiber: 2 }, 'workbench', 5, 'weapons'),
  bow_wood:          R('bow_wood', { wood: 4, rope: 2 }, 'workbench', 7, 'weapons'),
  arrows:            R('arrow', { stick: 2, pebble: 1, fiber: 1 }, 'workbench', 3, 'weapons', { qty: 4 }),
  shield_wood:       R('shield_wood', { wood: 6, rope: 2 }, 'workbench', 6, 'weapons'),
  armor_leather:     R('armor_leather', { leather: 6, rope: 2 }, 'workbench', 8, 'armor'),
  hood_leather:      R('hood_leather', { leather: 3, rope: 1 }, 'workbench', 5, 'armor'),

  // ---------- era 2: stonecutter / furnace / anvil ----------
  stone_blocks:      R('stone_block', { stone: 3 }, 'stonecutter', 3, 'materials', { qty: 2 }),
  charcoal:          R('coal', { wood: 3 }, 'furnace', 6, 'materials'),
  copper_bar:        R('copper_bar', { copper_ore: 2 }, 'furnace', 6, 'materials', { fuel: 1 }),
  iron_bar:          R('iron_bar', { iron_ore: 2 }, 'furnace', 8, 'materials', { fuel: 1 }),
  gold_bar:          R('gold_bar', { gold_ore: 2 }, 'furnace', 8, 'materials', { fuel: 1 }),
  steel_bar:         R('steel_bar', { iron_bar: 1, coal: 2 }, 'furnace', 10, 'materials', { fuel: 1 }),

  knife_copper:      R('knife_copper', { copper_bar: 1, wood: 1 }, 'anvil', 5, 'tools'),
  axe_copper:        R('axe_copper', { copper_bar: 2, wood: 2 }, 'anvil', 7, 'tools'),
  pickaxe_copper:    R('pickaxe_copper', { copper_bar: 3, wood: 2 }, 'anvil', 7, 'tools'),
  spear_copper:      R('spear_copper', { copper_bar: 2, wood: 3 }, 'anvil', 7, 'weapons'),
  sword_copper:      R('sword_copper', { copper_bar: 4, wood: 1, leather: 1 }, 'anvil', 9, 'weapons'),
  shield_copper:     R('shield_copper', { copper_bar: 4, wood: 2 }, 'anvil', 8, 'weapons'),
  helmet_copper:     R('helmet_copper', { copper_bar: 4, leather: 1 }, 'anvil', 8, 'armor'),
  armor_copper:      R('armor_copper', { copper_bar: 8, leather: 2 }, 'anvil', 12, 'armor'),

  // ---------- era 3: iron ----------
  knife_iron:        R('knife_iron', { iron_bar: 1, wood: 1 }, 'anvil', 6, 'tools'),
  axe_iron:          R('axe_iron', { iron_bar: 2, wood: 2 }, 'anvil', 8, 'tools'),
  pickaxe_iron:      R('pickaxe_iron', { iron_bar: 3, wood: 2 }, 'anvil', 8, 'tools'),
  spear_iron:        R('spear_iron', { iron_bar: 2, wood: 3 }, 'anvil', 8, 'weapons'),
  sword_iron:        R('sword_iron', { iron_bar: 4, wood: 1, leather: 1 }, 'anvil', 10, 'weapons'),
  club_iron:         R('club_iron', { iron_bar: 3, wood: 2 }, 'anvil', 9, 'weapons'),
  shield_iron:       R('shield_iron', { iron_bar: 5, wood: 2 }, 'anvil', 9, 'weapons'),
  helmet_iron:       R('helmet_iron', { iron_bar: 5, leather: 1 }, 'anvil', 9, 'armor'),
  armor_iron:        R('armor_iron', { iron_bar: 10, leather: 2 }, 'anvil', 14, 'armor'),

  // ---------- era 4: steel ----------
  knife_steel:       R('knife_steel', { steel_bar: 1, wood: 1 }, 'anvil', 7, 'tools'),
  axe_steel:         R('axe_steel', { steel_bar: 2, wood: 2 }, 'anvil', 9, 'tools'),
  pickaxe_steel:     R('pickaxe_steel', { steel_bar: 3, wood: 2 }, 'anvil', 9, 'tools'),
  spear_steel:       R('spear_steel', { steel_bar: 2, wood: 3 }, 'anvil', 9, 'weapons'),
  sword_steel:       R('sword_steel', { steel_bar: 4, wood: 1, leather: 1 }, 'anvil', 11, 'weapons'),
  bow_composite:     R('bow_composite', { steel_bar: 1, wood: 3, leather: 2, rope: 2 }, 'workbench', 10, 'weapons'),

  // ---------- loom ----------
  cloth:             R('cloth', { cotton: 3 }, 'loom', 4, 'materials'),
  rope_loom:         R('rope', { fiber: 4 }, 'loom', 2, 'materials', { qty: 2 }),
  tunic_cloth:       R('tunic_cloth', { cloth: 4, rope: 1 }, 'loom', 8, 'armor'),

  // ---------- cooking ----------
  cooked:            R('cooked', { meat: 1 }, ROAST, 4, 'food'),
  baked_potato:      R('baked_potato', { potato: 1 }, ROAST, 4, 'food'),
  roast_corn:        R('roast_corn', { corn: 1 }, ROAST, 4, 'food'),
  stew:              R('stew', { meat: 1, potato: 1, corn: 1 }, 'cooking_pot', 8, 'food', { qty: 2 }),
};

for (const id in RECIPES) RECIPES[id].id = id;
export const RECIPE_ORDER = Object.keys(RECIPES);
export const stationsOf = (r) => (Array.isArray(r.station) ? r.station : [r.station]);
