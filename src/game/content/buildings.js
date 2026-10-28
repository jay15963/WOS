// Buildings: structures, stations, furniture, lights, farming  (pure data, no DOM). All user-facing strings in Brazilian Portuguese.
// See docs/CONTENT.md for the canonical ids.

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
