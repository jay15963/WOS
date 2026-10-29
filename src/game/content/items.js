// Items: materials, food, tools, weapons, armor  (pure data, no DOM). All user-facing strings in Brazilian Portuguese.
// See docs/CONTENT.md §1–§3 for the canonical ids.
//
// Fields: { name, sprite ('item_<id>'), emoji (UI fallback), stack, desc, cat, tier?, mat?, slot?,
//           tool?: { chop?, mine?, skin?, fiber? } (work speed multiplier), weapon?: { type, twoHanded? },
//           armor?: { value, warmth? }, shield?: { block }, light?: {...}, food?: { hunger, heal, sick? },
//           seed?: crop kind, value? (trade value hint) }
// cat: 'material' | 'food' | 'tool' | 'weapon' | 'offhand' | 'armor' | 'seed' | 'ammo'

// Tier 0..4 = primitive, stone, copper, iron, steel (work speed multiplier per tier)
export const TIERS = ['primitive', 'stone', 'copper', 'iron', 'steel'];
export const TIER_SPEED = [1.0, 1.45, 1.9, 2.5, 3.2];
export const TIER_PT = ['primitivo', 'de pedra', 'de cobre', 'de ferro', 'de aço'];
export const TIER_PT_F = ['primitiva', 'de pedra', 'de cobre', 'de ferro', 'de aço'];

// world.ore codes (CONTENT §7) -> item id + minimum pickaxe tier
export const ORE_ITEM = [null, 'copper_ore', 'iron_ore', 'coal', 'gold_ore', 'jade'];
export const ORE_MIN_TIER = [0, 1, 2, 1, 3, 3];
export const ORE_NAME_PT = ['', 'cobre', 'ferro', 'carvão', 'ouro', 'jade'];

const mat = (name, emoji, desc, extra = {}) => ({ name, emoji, desc, stack: 99, cat: 'material', ...extra });
const food = (name, emoji, desc, f, extra = {}) => ({ name, emoji, desc, stack: 40, cat: 'food', food: f, ...extra });

export const ITEMS = {
  // ---------- materials ----------
  pebble:      mat('Pedrinha', '🪨', 'Pedra pequena achada no chão. Dá para lascar ferramentas primitivas.'),
  stick:       mat('Graveto', '🥢', 'Galho seco. Cabo de ferramentas, flechas e tochas.'),
  fiber:       mat('Fibra vegetal', '🌿', 'Fibras de capim e arbustos. Amarra ferramentas; vira corda e bandagem.'),
  wood:        mat('Madeira', '🪵', 'Toras cortadas com machado. Base de quase toda construção.'),
  stone:       mat('Pedra', '🪨', 'Pedra bruta quebrada com picareta.'),
  stone_block: mat('Bloco de pedra', '🧱', 'Pedra cortada na mesa de cantaria. Paredes e pisos de pedra.'),
  rope:        mat('Corda', '🪢', 'Fibras trançadas. Amarra ferramentas melhores.'),
  leather:     mat('Couro', '🟫', 'Couro de animal (precisa de faca para tirar). Armaduras, camas.'),
  cotton:      mat('Algodão', '☁️', 'Fibra macia. Vira tecido no tear.'),
  cloth:       mat('Tecido', '🧵', 'Tecido feito no tear. Roupas, bandagens, tapetes.'),
  copper_ore:  mat('Minério de cobre', '🟠', 'Veio de cobre (picareta de pedra ou melhor). Funda na fornalha.'),
  iron_ore:    mat('Minério de ferro', '🟤', 'Veio de ferro (picareta de cobre ou melhor). Funda na fornalha.'),
  coal:        mat('Carvão', '⚫', 'Combustível forte. Necessário para fazer aço.'),
  gold_ore:    mat('Minério de ouro', '🟡', 'Veio raro de ouro (picareta de ferro ou melhor).'),
  jade:        mat('Jade', '🟢', 'Pedra preciosa rara (picareta de ferro ou melhor). Muito valiosa.', { value: 40 }),
  copper_bar:  mat('Barra de cobre', '🟧', 'Cobre fundido. Ferramentas e armas na bigorna.'),
  iron_bar:    mat('Barra de ferro', '⬛', 'Ferro fundido. Ferramentas e armaduras resistentes.'),
  steel_bar:   mat('Barra de aço', '⬜', 'Ferro com carvão. O melhor metal.'),
  gold_bar:    mat('Barra de ouro', '🟨', 'Ouro fundido. Valioso.', { value: 30 }),
  arrow:       { name: 'Flecha', emoji: '➶', stack: 99, cat: 'ammo', desc: 'Munição para arcos.' },
  bandage:     { name: 'Bandagem', emoji: '🩹', stack: 20, cat: 'material', desc: 'Usada pela habilidade Bandagem para curar ferimentos.' },

  // ---------- seeds ----------
  seed_potato: { name: 'Semente de batata', emoji: '🌰', stack: 40, cat: 'seed', seed: 'potato', desc: 'Plante num canteiro. Vem de batatas silvestres.' },
  seed_cotton: { name: 'Semente de algodão', emoji: '🌱', stack: 40, cat: 'seed', seed: 'cotton', desc: 'Plante num canteiro. Vem de algodão silvestre.' },
  seed_corn:   { name: 'Semente de milho', emoji: '🌾', stack: 40, cat: 'seed', seed: 'corn', desc: 'Plante num canteiro. Vem de milho silvestre.' },

  // ---------- food ----------
  berries:      food('Frutas silvestres', '🫐', 'Mata um pouco a fome.', { hunger: 10, heal: 4 }),
  meat:         food('Carne crua', '🥩', 'Melhor assar na fogueira. Comer crua pode fazer mal.', { hunger: 14, heal: 0, sick: 0.35 }),
  cooked:       food('Carne assada', '🍖', 'Refeição completa. Restaura fome e vida.', { hunger: 40, heal: 28 }),
  potato:       food('Batata', '🥔', 'Crua mata pouco a fome. Asse na fogueira.', { hunger: 12, heal: 0 }),
  baked_potato: food('Batata assada', '🥔', 'Quentinha e nutritiva.', { hunger: 30, heal: 14 }),
  corn:         food('Milho', '🌽', 'Cru é duro. Asse na fogueira.', { hunger: 10, heal: 0 }),
  roast_corn:   food('Milho assado', '🌽', 'Doce e crocante.', { hunger: 26, heal: 10 }),
  stew:         food('Ensopado', '🍲', 'Carne, batata e milho no caldeirão. A melhor refeição: aquece o corpo.', { hunger: 60, heal: 45, warm: 120 }, { stack: 20 }),

  // ---------- off hand ----------
  shield_wood:   { name: 'Escudo de madeira', emoji: '🛡️', stack: 1, cat: 'offhand', slot: 'off', tier: 1, mat: 'wood', shield: { block: 0.25 }, armor: { value: 2 }, desc: 'Bloqueia parte do dano. Habilidades de escudo.' },
  shield_copper: { name: 'Escudo de cobre', emoji: '🛡️', stack: 1, cat: 'offhand', slot: 'off', tier: 2, mat: 'copper', shield: { block: 0.35 }, armor: { value: 4 }, desc: 'Escudo reforçado com cobre.' },
  shield_iron:   { name: 'Escudo de ferro', emoji: '🛡️', stack: 1, cat: 'offhand', slot: 'off', tier: 3, mat: 'iron', shield: { block: 0.45 }, armor: { value: 6 }, desc: 'Escudo pesado de ferro.' },
  torch_hand:    { name: 'Tocha de mão', emoji: '🔥', stack: 5, cat: 'offhand', slot: 'off', tier: 0,
                   light: { r: 1, g: 0.68, b: 0.36, radius: 5.2, intensity: 1.15, flicker: 0.3, lift: 1.0 },
                   desc: 'Ilumina em volta de você (mão secundária). Assusta animais.' },

  // ---------- body / head ----------
  tunic_cloth:   { name: 'Túnica de tecido', emoji: '👕', stack: 1, cat: 'armor', slot: 'body', tier: 1, armor: { value: 2, warmth: 2 }, desc: 'Roupa simples e quente.' },
  armor_leather: { name: 'Armadura de couro', emoji: '🦺', stack: 1, cat: 'armor', slot: 'body', tier: 1, armor: { value: 5, warmth: 1 }, desc: 'Couro curtido. Proteção leve.' },
  armor_copper:  { name: 'Armadura de cobre', emoji: '🦺', stack: 1, cat: 'armor', slot: 'body', tier: 2, armor: { value: 9 }, desc: 'Placas de cobre sobre couro.' },
  armor_iron:    { name: 'Armadura de ferro', emoji: '🦺', stack: 1, cat: 'armor', slot: 'body', tier: 3, armor: { value: 14 }, desc: 'Cota pesada de ferro.' },
  hat_straw:     { name: 'Chapéu de palha', emoji: '👒', stack: 1, cat: 'armor', slot: 'head', tier: 0, armor: { value: 1 }, desc: 'Trançado de fibras. Protege do sol.' },
  hood_leather:  { name: 'Capuz de couro', emoji: '🪖', stack: 1, cat: 'armor', slot: 'head', tier: 1, armor: { value: 3, warmth: 1 }, desc: 'Capuz quente de couro.' },
  helmet_copper: { name: 'Elmo de cobre', emoji: '🪖', stack: 1, cat: 'armor', slot: 'head', tier: 2, armor: { value: 5 }, desc: 'Elmo de cobre martelado.' },
  helmet_iron:   { name: 'Elmo de ferro', emoji: '🪖', stack: 1, cat: 'armor', slot: 'head', tier: 3, armor: { value: 8 }, desc: 'Elmo fechado de ferro.' },
};

// ---------- tools / weapons (generated: <type>_<material>) ----------
const MAT_TIER = { primitive: 0, stone: 1, copper: 2, iron: 3, steel: 4 };
const TOOL_TYPES = {
  knife:   { name: ['Faca', 'f'], emoji: '🔪', mats: ['primitive', 'stone', 'copper', 'iron', 'steel'], cat: 'tool', tool: (s) => ({ skin: s, fiber: s }),
             desc: 'Tira couro dos animais abatidos e colhe fibra mais rápido. Arma rápida.' },
  axe:     { name: ['Machado', 'm'], emoji: '🪓', mats: ['primitive', 'stone', 'copper', 'iron', 'steel'], cat: 'tool', tool: (s) => ({ chop: s }),
             desc: 'Corta árvores e tocos. Arma pesada.' },
  pickaxe: { name: ['Picareta', 'f'], emoji: '⛏️', mats: ['primitive', 'stone', 'copper', 'iron', 'steel'], cat: 'tool', tool: (s) => ({ mine: s }),
             desc: 'Quebra pedregulhos e minera rocha. Arma fraca.' },
  spear:   { name: ['Lança', 'f'], emoji: '🔱', mats: ['stone', 'copper', 'iron', 'steel'], cat: 'weapon', desc: 'Arma de alcance longo (1,8 m).' },
  sword:   { name: ['Espada', 'f'], emoji: '🗡️', mats: ['copper', 'iron', 'steel'], cat: 'weapon', desc: 'Arma equilibrada. Golpe, Redemoinho e Investida.' },
};
for (const type in TOOL_TYPES) {
  const T = TOOL_TYPES[type];
  for (const m of T.mats) {
    const tier = MAT_TIER[m];
    const fem = T.name[1] === 'f';
    const id = `${type}_${m}`;
    ITEMS[id] = {
      name: `${T.name[0]} ${(fem ? TIER_PT_F : TIER_PT)[tier]}`, emoji: T.emoji, stack: 1, cat: T.cat, slot: 'main', tier, mat: m,
      weapon: { type }, desc: T.desc,
    };
    if (T.tool) ITEMS[id].tool = T.tool(TIER_SPEED[tier]);
  }
}
Object.assign(ITEMS, {
  club_wood:     { name: 'Clava', emoji: '🏏', stack: 1, cat: 'weapon', slot: 'main', tier: 1, mat: 'wood', weapon: { type: 'club' }, desc: 'Porrete de madeira. Atordoa.' },
  club_iron:     { name: 'Maça de ferro', emoji: '🔨', stack: 1, cat: 'weapon', slot: 'main', tier: 3, mat: 'iron', weapon: { type: 'club' }, desc: 'Maça pesada de ferro. Atordoa.' },
  bow_wood:      { name: 'Arco simples', emoji: '🏹', stack: 1, cat: 'weapon', slot: 'main', tier: 1, mat: 'wood', weapon: { type: 'bow', twoHanded: true }, desc: 'Ataque à distância. Gasta flechas. Ocupa as duas mãos.' },
  bow_composite: { name: 'Arco composto', emoji: '🏹', stack: 1, cat: 'weapon', slot: 'main', tier: 4, mat: 'composite', weapon: { type: 'bow', twoHanded: true }, desc: 'Arco potente de madeira, aço e couro. Ocupa as duas mãos.' },
});

for (const id in ITEMS) ITEMS[id].sprite ||= 'item_' + id;

export const FOOD_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].food);
export const SEED_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].seed);
// legacy ids from older saves
export const ITEM_ALIASES = { ore: 'copper_ore' };

export const ITEM_CAT_PT = {
  material: 'Material', food: 'Comida', tool: 'Ferramenta', weapon: 'Arma', offhand: 'Mão secundária',
  armor: 'Vestimenta', seed: 'Semente', ammo: 'Munição',
};
export const SLOT_PT = { main: 'Mão principal', off: 'Mão secundária', body: 'Corpo', head: 'Cabeça' };
