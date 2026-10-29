// Buildings: structures, stations, furniture, lights, farming  (pure data, no DOM). All user-facing strings in Brazilian Portuguese.
// See docs/CONTENT.md §5 for the canonical ids. type = sprite name (connectables: `<type>_<mask>`, doors `<type>_h|v`).
//
// Fields:
//  name, g ('m'|'f' grammatical gender for messages), emoji (UI fallback), cat: [category keys], cost, time (build s), xp
//  size: [w, h] (default 1×1)      layer: 'main' (default) | 'floor' (floors, farm plots) | 'rug'
//  block: 'tile' (world.solid = 1 over the footprint) | 'door' (closed = world.solid 1, open = 0) | radius (round prop) | 0
//  connect: autotile group (mask N=1 E=2 S=4 W=8)   flat: drawn on B.ground   drag: 'line' | 'area' placement
//  joins: autotile groups this connectable links to (default [connect]; 'rock' = natural rock tiles)
//  station: crafting station   slots: storage   light / fire: always on   workLight: light while o.working
//  warm: warmth radius (always, or only while working when warmWorking)
//  rotate: 4 orientations (o.rot 0..3 = front S, W, N, E; an odd rot swaps the footprint w×h)
//  edge: small prop with 5 placements (o.rot 0 = centred, 1..4 = against the N / E / S / W edge, facing away from it)
//  move: can be moved ("Mover" keeps its state: chest contents, variant…)   raze: removed at once ("Arrasar", small refund)
//  support: holds up roofs (walls, doors, columns; natural rock too) · roof: built roof tile (layer 'roof', drawn by
//  src/art/roofRaster.js from content/roofs.js; o.style / o.det)

import { DECOR, DECOR_CATS } from './decor.js'; // agent K: decoration, garden, extra construction pieces

const L = (r, g, b, radius, intensity, flicker, lift) => ({ r, g, b, radius, intensity, flicker, lift });

export const BUILD_CATS = [
  ['struct', 'Estruturas'], ['floor', 'Pisos'], ['roof', 'Teto'], ['prod', 'Produção'], ['furn', 'Móveis'], ['light', 'Luz'], ['farm', 'Agricultura'],
  ...DECOR_CATS,
];

export const BUILDINGS = {
  // ---------- structures ----------
  wall_wood:  { name: 'Parede de madeira', g: 'f', emoji: '🧱', cat: ['struct'], cost: { wood: 2 }, time: 2, xp: 3, block: 'tile', connect: 'wall', joins: ['wall', 'rock'], drag: 'line', support: true,
                desc: 'Bloqueia a passagem. Conecta com outras paredes e com a rocha.' },
  wall_stone: { name: 'Parede de pedra', g: 'f', emoji: '🧱', cat: ['struct'], cost: { stone_block: 2 }, time: 3, xp: 4, block: 'tile', connect: 'wall', joins: ['wall', 'rock'], drag: 'line', support: true,
                desc: 'Parede resistente de blocos de pedra.' },
  door_wood:  { name: 'Porta de madeira', g: 'f', emoji: '🚪', cat: ['struct'], cost: { wood: 4, rope: 1 }, time: 3, xp: 5, block: 'door', connect: 'wall', joins: ['wall', 'rock'], support: true,
                desc: 'Abra e feche com E ou um toque. Fechada, ninguém passa (nem as criaturas). Conta como parede.' },
  fence_wood: { name: 'Cerca', g: 'f', emoji: '🪵', cat: ['struct'], cost: { wood: 1 }, time: 1, xp: 1, block: 'tile', connect: 'fence', joins: ['fence', 'wall', 'rock'], drag: 'line',
                desc: 'Cerca baixa de madeira. Segura animais e se liga às paredes.' },
  gate_wood:  { name: 'Portão', g: 'm', emoji: '🚧', cat: ['struct'], cost: { wood: 3, rope: 1 }, time: 2.5, xp: 3, block: 'door', connect: 'fence', joins: ['fence', 'wall', 'rock'],
                desc: 'Portão de cerca: abra e feche com E ou um toque. Fechado, ninguém passa.' },

  // ---------- floors ----------
  floor_wood:  { name: 'Piso de madeira', g: 'm', emoji: '🟫', cat: ['floor'], cost: { wood: 1 }, time: 0.8, xp: 1, layer: 'floor', flat: true, connect: 'floor_wood', drag: 'area',
                 desc: 'Piso de tábuas. Andar sobre pisos é 10% mais rápido.' },
  floor_stone: { name: 'Piso de pedra', g: 'm', emoji: '⬜', cat: ['floor'], cost: { stone_block: 1 }, time: 1.2, xp: 1, layer: 'floor', flat: true, connect: 'floor_stone', drag: 'area',
                 desc: 'Piso de lajotas de pedra. 10% mais rápido.' },

  // ---------- roofs (layer 'roof', area drag; need a support within 6 tiles) ----------
  roof_thatch: { name: 'Telhado de palha', g: 'm', emoji: '🛖', cat: ['roof'], cost: { stick: 1, fiber: 2 }, time: 0.7, xp: 1, layer: 'roof', roof: true, drag: 'area',
                 desc: 'Palha amarrada em varas. Esconde o interior e protege da chuva. Precisa de parede, coluna ou rocha a até 6 tiles.' },
  roof_wood:   { name: 'Telhado de madeira', g: 'm', emoji: '🏠', cat: ['roof'], cost: { wood: 1 }, time: 0.8, xp: 1, layer: 'roof', roof: true, drag: 'area',
                 desc: 'Telhas de madeira sobrepostas. Precisa de parede, coluna ou rocha a até 6 tiles.' },
  roof_stone:  { name: 'Telhado de pedra', g: 'm', emoji: '🏰', cat: ['roof'], cost: { stone_block: 1 }, time: 1, xp: 1, layer: 'roof', roof: true, drag: 'area',
                 desc: 'Ardósia, telha de barro ou lajes (troque o estilo com ⟳). Precisa de parede, coluna ou rocha a até 6 tiles.' },
  column_wood: { name: 'Coluna de madeira', g: 'f', emoji: '🪵', cat: ['roof', 'struct'], cost: { wood: 3 }, time: 2, xp: 3, block: 'tile', support: true,
                 desc: 'Segura o teto no meio de salões grandes (o teto precisa de apoio a até 6 tiles).' },
  column_stone: { name: 'Coluna de pedra', g: 'f', emoji: '🏛️', cat: ['roof', 'struct'], cost: { stone_block: 2 }, time: 3, xp: 4, block: 'tile', support: true,
                 desc: 'Coluna de blocos de pedra. Segura o teto de salões grandes.' },

  // ---------- production ----------
  workbench:   { name: 'Bancada de trabalho', g: 'f', emoji: '🛠️', cat: ['prod'], cost: { wood: 10, stone: 4 }, size: [2, 1], time: 6, xp: 20, block: 'tile', station: true, rotate: true, move: true,
                 desc: 'Ferramentas de pedra, lanças, arcos, flechas, escudo e couro.' },
  stonecutter: { name: 'Mesa de cantaria', g: 'f', emoji: '🪚', cat: ['prod'], cost: { wood: 6, stone: 12 }, size: [2, 1], time: 6, xp: 15, block: 'tile', station: true, rotate: true, move: true,
                 desc: 'Corta pedra em blocos para paredes e pisos de pedra.' },
  furnace:     { name: 'Fornalha', g: 'f', emoji: '🔥', cat: ['prod'], cost: { stone: 18, wood: 3 }, time: 8, xp: 20, block: 'tile', station: true, move: true,
                 workLight: L(1, 0.55, 0.25, 4.5, 1.2, 0.2, 0.3), warm: 3, warmWorking: true,
                 desc: 'Funde minério em barras e faz carvão. Usa madeira ou carvão como combustível.' },
  anvil:       { name: 'Bigorna', g: 'f', emoji: '⚒️', cat: ['prod'], cost: { copper_bar: 3, stone: 6, wood: 2 }, time: 6, xp: 20, block: 'tile', station: true, move: true,
                 desc: 'Forja ferramentas, armas e armaduras de metal.' },
  loom:        { name: 'Tear', g: 'm', emoji: '🧶', cat: ['prod'], cost: { wood: 12, rope: 3 }, size: [2, 1], time: 6, xp: 15, block: 'tile', station: true, rotate: true, move: true,
                 desc: 'Tece algodão em tecido, corda e roupas.' },
  cooking_pot: { name: 'Caldeirão', g: 'm', emoji: '🍲', cat: ['prod'], cost: { copper_bar: 2, stone: 6 }, time: 4, xp: 12, block: 'tile', station: true, move: true,
                 workLight: L(1, 0.6, 0.3, 3.2, 0.9, 0.25, 0.3), warm: 2.5, warmWorking: true,
                 desc: 'Prepara ensopados e assa alimentos.' },
  campfire:    { name: 'Fogueira', g: 'f', emoji: '🔥', cat: ['light', 'prod'], cost: { wood: 3, pebble: 4 }, time: 3, xp: 15, block: 0.3, station: true, fire: true, warm: 4.5, raze: true,
                 light: L(1, 0.62, 0.3, 6, 1.3, 0.25, 0.3),
                 desc: 'Luz, calor e cozinha. Renasça perto dela.' },

  // ---------- furniture ----------
  chest:       { name: 'Baú', g: 'm', emoji: '🧰', cat: ['furn'], cost: { wood: 8 }, time: 4, xp: 10, block: 0.28, slots: 20, edge: true, move: true,
                 desc: 'Guarda até 20 pilhas de itens. Gire para encostar numa parede.' },
  bed:         { name: 'Cama', g: 'f', emoji: '🛏️', cat: ['furn'], cost: { wood: 8, fiber: 6, leather: 2 }, size: [1, 2], time: 6, xp: 15, block: 'tile', rotate: true, move: true,
                 desc: 'Define o ponto de renascimento. Durma à noite. Ocupa 1×2.' },
  table_wood:  { name: 'Mesa', g: 'f', emoji: '🪑', cat: ['furn'], cost: { wood: 6 }, size: [2, 1], time: 4, xp: 6, block: 'tile', rotate: true, move: true,
                 desc: 'Mesa de madeira.' },
  chair_wood:  { name: 'Cadeira', g: 'f', emoji: '🪑', cat: ['furn'], cost: { wood: 3 }, time: 2.5, xp: 3, block: 0.2, edge: true, move: true,
                 desc: 'Cadeira simples. Gire para virá-la para a mesa.' },
  rug:         { name: 'Tapete', g: 'm', emoji: '🟥', cat: ['furn'], cost: { cloth: 4 }, size: [2, 1], time: 2, xp: 4, layer: 'rug', flat: true, rotate: true, move: true,
                 desc: 'Tapete de tecido. Deixa a casa aconchegante.' },
  flower_pot:  { name: 'Vaso de flores', g: 'm', emoji: '🪴', cat: ['furn'], cost: { stone: 3, fiber: 1 }, time: 1.5, xp: 2, block: 0.2, edge: true, move: true,
                 desc: 'Decoração com flores.' },
  banner:      { name: 'Estandarte', g: 'm', emoji: '🚩', cat: ['furn'], cost: { wood: 3, cloth: 2 }, time: 2.5, xp: 4, block: 0.15, edge: true, move: true,
                 desc: 'Marca o seu território.' },

  // ---------- lights ----------
  torch:       { name: 'Tocha', g: 'f', emoji: '🕯️', cat: ['light'], cost: { wood: 2, fiber: 1 }, time: 1.5, xp: 4, block: 0.1, fire: true, warm: 2, edge: true, move: true,
                 light: L(1, 0.7, 0.38, 3.6, 1.0, 0.3, 0.75),
                 desc: 'Ilumina os arredores (essencial nas minas). Encostada numa parede, vira tocha de parede.' },
  brazier:     { name: 'Braseiro', g: 'm', emoji: '🔥', cat: ['light'], cost: { iron_bar: 2, stone: 6, coal: 2 }, time: 4, xp: 10, block: 0.3, fire: true, warm: 4, move: true,
                 light: L(1, 0.6, 0.28, 6.5, 1.35, 0.25, 1.1),
                 desc: 'Fogo alto em bacia de ferro. Muita luz e calor.' },
  lamp_post:   { name: 'Poste com lanterna', g: 'm', emoji: '🏮', cat: ['light'], cost: { iron_bar: 2, wood: 4 }, time: 4, xp: 10, block: 0.15, edge: true, move: true,
                 light: L(1, 0.85, 0.55, 7, 1.2, 0.06, 1.5),
                 desc: 'Luz alta e firme para caminhos e praças.' },

  // ---------- farming ----------
  farm_plot:   { name: 'Canteiro', g: 'm', emoji: '🟫', cat: ['farm'], cost: {}, time: 1.5, xp: 2, layer: 'floor', flat: true, connect: 'farm_plot', drag: 'area',
                 desc: 'Terra arada. Plante sementes de batata, milho ou algodão.' },
  ...DECOR,
};

for (const id in BUILDINGS) {
  const b = BUILDINGS[id];
  b.size ||= [1, 1];
  b.layer ||= 'main';
  b.block ??= 0;
  if (b.connect) b.joins = new Set(b.joins || [b.connect]);
}
export const BUILD_ORDER = Object.keys(BUILDINGS);
