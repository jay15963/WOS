// Items: materials, food, tools, weapons, armor  (pure data, no DOM). All user-facing strings in Brazilian Portuguese.
// See docs/CONTENT.md for the canonical ids.

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
