// Static gameplay definitions (pure data, no DOM). Shared by simulation and UI.
// All user-facing strings in Brazilian Portuguese.

export const ITEMS = {
  wood:    { name: 'Madeira', sprite: 'item_wood', emoji: '🪵', stack: 99, desc: 'Toras cortadas. Base de quase toda construção.' },
  stone:   { name: 'Pedra', sprite: 'item_stone', emoji: '🪨', stack: 99, desc: 'Pedra bruta, ótima para fogueiras.' },
  fiber:   { name: 'Fibra vegetal', sprite: 'item_fiber', emoji: '🌿', stack: 99, desc: 'Fibras de arbusto. Usada em tochas e camas.' },
  berries: { name: 'Frutas silvestres', sprite: 'item_berries', emoji: '🫐', stack: 40, desc: 'Mata um pouco a fome.', food: { hunger: 10, heal: 4 } },
  meat:    { name: 'Carne crua', sprite: 'item_meat', emoji: '🥩', stack: 40, desc: 'Melhor assar na fogueira. Comer crua pode fazer mal.', food: { hunger: 14, heal: 0, sick: 0.35 } },
  cooked:  { name: 'Carne assada', sprite: 'item_cooked', emoji: '🍖', stack: 40, desc: 'Refeição completa. Restaura fome e vida.', food: { hunger: 40, heal: 28 } },
  leather: { name: 'Couro', sprite: 'item_leather', emoji: '🟫', stack: 99, desc: 'Couro de animal. Usado na cama.' },
  ore:     { name: 'Minério', sprite: 'item_ore', emoji: '🔶', stack: 99, desc: 'Veio metálico das montanhas. Útil no futuro.' },
};

// temper: hostile (red, aggroes), neutral (yellow, fights back), passive (green, flees)
export const SPECIES = {
  wolf:   { name: 'Lobo', temper: 'hostile', hp: 40, dmg: 4, swing: 1.8, speed: 4.3, aggro: 7.5, r: 0.32, scale: 1, xp: 1.0, social: true,
            loot: [['meat', 1, 2, 1], ['leather', 1, 1, 0.6]] },
  boar:   { name: 'Javali', temper: 'neutral', hp: 60, dmg: 7, swing: 2.0, speed: 4.0, r: 0.32, scale: 1, xp: 1.1,
            loot: [['meat', 2, 3, 1], ['leather', 1, 1, 0.5]] },
  deer:   { name: 'Cervo', temper: 'passive', hp: 34, dmg: 0, swing: 2, speed: 5.4, r: 0.3, scale: 1, xp: 0.7,
            loot: [['meat', 2, 3, 1], ['leather', 1, 2, 0.9]] },
  rabbit: { name: 'Coelho', temper: 'passive', hp: 12, dmg: 0, swing: 2, speed: 5.0, r: 0.18, scale: 1, xp: 0.3,
            loot: [['meat', 1, 1, 1], ['fiber', 1, 1, 0.3]] },
  bear:   { name: 'Urso', temper: 'hostile', elite: true, hp: 210, dmg: 13, swing: 2.3, speed: 4.1, aggro: 6, r: 0.45, scale: 1.45, xp: 3.5, lvl: 3,
            loot: [['meat', 3, 5, 1], ['leather', 2, 3, 1]] },
};

// Action bar. range: 'melee' | [min, max] | 0 (self)
export const ABILITIES = {
  golpe:      { name: 'Golpe', key: '1', icon: 'strike', cost: 25, cd: 5, range: 'melee', target: true,
                desc: 'Golpe poderoso: 180% do dano da arma +4.' },
  investida:  { name: 'Investida', key: '2', icon: 'charge', cost: 15, cd: 14, range: [2.2, 10], target: true,
                desc: 'Avança até o alvo e o atordoa por 1,5 s.' },
  redemoinho: { name: 'Redemoinho', key: '3', icon: 'whirlwind', cost: 35, cd: 9, range: 0,
                desc: 'Gira a lâmina, atingindo todos ao redor (2,3 m).' },
  bandagem:   { name: 'Bandagem', key: '4', icon: 'bandage', cost: 10, cd: 25, range: 0,
                desc: 'Cura 40% da vida em 8 s. Interrompida ao sofrer dano.' },
  disparada:  { name: 'Disparada', key: '5', icon: 'sprint', cost: 20, cd: 20, range: 0, offGcd: true,
                desc: '+65% de velocidade por 5 s. Dá mais fome.' },
};
export const ABILITY_ORDER = ['golpe', 'investida', 'redemoinho', 'bandagem', 'disparada'];
export const GCD = 1.0;

export const BUFFS = {
  bandage:  { name: 'Bandagem', icon: 'bandage', good: true },
  sprint:   { name: 'Disparada', icon: 'sprint', good: true },
  warm:     { name: 'Aquecido', icon: 'fire', good: true, desc: 'Perto do fogo: regeneração maior.' },
  weak:     { name: 'Fraqueza', icon: 'skull', good: false, desc: 'Renascido: -25% de dano.' },
  sick:     { name: 'Indigestão', icon: 'sick', good: false, desc: 'Carne crua: perde vida.' },
  cold:     { name: 'Frio', icon: 'cold', good: false, desc: 'Noite sem fogo: mais fome.' },
  starving: { name: 'Faminto', icon: 'hunger', good: false, desc: 'Sem comida: perde vida.' },
};

// Buildings. tile: occupies a full tile (blocks it); solid: collision radius for round props.
export const BUILDINGS = {
  campfire:  { name: 'Fogueira', g: 'f', icon: 'campfire', cost: { wood: 5, stone: 3 }, solid: 0.3, xp: 15, fire: true,
               light: { r: 1, g: 0.62, b: 0.3, radius: 6, intensity: 1.3, flicker: 0.25, lift: 0.3 },
               desc: 'Luz, calor e cozinha. Renasça perto dela.' },
  torch:     { name: 'Tocha', g: 'f', icon: 'torch', cost: { wood: 2, fiber: 1 }, solid: 0.1, xp: 4, fire: true,
               light: { r: 1, g: 0.7, b: 0.38, radius: 3.6, intensity: 1.0, flicker: 0.3, lift: 0.75 },
               desc: 'Ilumina os arredores.' },
  wall_wood: { name: 'Parede de madeira', g: 'f', icon: 'wall_wood', cost: { wood: 3 }, tile: true, xp: 3, repeat: true,
               desc: 'Bloqueia a passagem de criaturas.' },
  chest:     { name: 'Baú', g: 'm', icon: 'chest', cost: { wood: 8 }, solid: 0.3, xp: 10, slots: 16,
               desc: 'Guarda até 16 pilhas de itens.' },
  bed:       { name: 'Cama', g: 'f', icon: 'bed', cost: { wood: 6, fiber: 4, leather: 2 }, solid: 0.32, xp: 15,
               desc: 'Define o ponto de renascimento. Durma à noite.' },
};
export const BUILD_ORDER = ['campfire', 'torch', 'wall_wood', 'chest', 'bed'];

export const WEATHER_PT = {
  clear: ['Céu limpo', '☀'], cloudy: ['Nublado', '☁'], rain: ['Chuva', '🌧'], fog: ['Neblina', '🌫'],
};

// Reaction colors (nameplates, target frame, minimap)
export const TEMPER_COLOR = { hostile: '#ff5a48', neutral: '#ffd84a', passive: '#7fdc6a' };
