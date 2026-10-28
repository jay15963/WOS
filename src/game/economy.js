// Economy / crafting / building install: initialisation order, systems list and the progression
// guide (one-off pt-BR hints at each milestone, plus a "next step" line for the crafting panel).

import { initEquipment, equipmentSystem, hasTool, bestTool, equipItem, unequip, equipFromSlot } from './equipment.js';
import { initFlora, floraSystem, ensureStarter } from './flora.js';
import { initMining, miningSystem, designate } from './mining.js';
import { initFarming, farmingSystem } from './farming.js';
import { initCrafting, craftingSystem, enqueue, recipeState } from './crafting.js';
import { initWork, workSystem } from './work.js';
import { updateAllMasks } from './autotile.js';
import { rollKillLoot } from './loot.js';
import { enterBuildMode } from './building.js';

// before loadGame (flora targets must be read from the pristine world)
export function initEconomy(game) {
  game.stumps = new Set();
  initEquipment(game);
  initFlora(game);
  initMining(game);
  initFarming(game);
  initCrafting(game);
  initWork(game);
  game.hasTool = (p, kind) => hasTool(p || game.player, kind); // combat: skinning needs a knife
  // small API for other modules (combat, UI, debugging)
  game.econ = { hasTool: (k) => hasTool(game.player, k), bestTool: (k) => bestTool(game.player, k), equipItem: (id) => equipItem(game, id),
    unequip: (s) => unequip(game, s), equipFromSlot: (i) => equipFromSlot(game, i), rollKillLoot: (x, y, t) => rollKillLoot(game, x, y, t),
    craft: (id, n) => enqueue(game, id, n), recipeState: (id) => recipeState(game, id), build: (type) => enterBuildMode(game, type),
    designate: (tx, ty, on) => designate(game, tx, ty, on), nextStep: () => nextStep(game) };
}

// after loadGame
export function postLoadEconomy(game, isNew) {
  updateAllMasks(game);
  if (isNew) ensureStarter(game, false);
}

export function economySystems() {
  return [workSystem(), craftingSystem(), miningSystem(), farmingSystem(), floraSystem(), equipmentSystem(), guideSystem()];
}

// ---------- progression guide ----------
const has = (p, id, n = 1) => p.inv.count(id) + (Object.values(p.equip).includes(id) ? 1 : 0) >= n;
const built = (g, type) => g.build.structures.some((o) => o.type === type && !o.blueprint);
const tierOf = (p, kind) => bestTool(p, kind)?.tier ?? -1;

export function nextStep(game) {
  const p = game.player;
  const axe = tierOf(p, 'chop'), pick = tierOf(p, 'mine'), knife = tierOf(p, 'skin');
  if (axe < 0 || pick < 0 || knife < 0) {
    if (p.inv.count('pebble') < 2 || p.inv.count('fiber') < 1) return 'Pegue pedrinhas, gravetos e fibras no chão (toque neles).';
    return 'Crie faca, machado e picareta primitivos (pedrinhas + fibras + gravetos).';
  }
  if (!built(game, 'campfire')) return 'Corte árvores e construa uma fogueira (3 madeira + 4 pedrinhas).';
  if (!built(game, 'workbench')) return 'Bancada de trabalho: 10 madeira + 4 pedra (quebre pedregulhos).';
  if (axe < 1 || pick < 1) return 'Na bancada: machado e picareta de pedra (corda = 3 fibras).';
  if (!built(game, 'furnace')) return 'Minere cobre nas montanhas (Minerar) e construa uma fornalha.';
  if (!has(p, 'copper_bar') && !built(game, 'anvil')) return 'Funda minério de cobre na fornalha (use madeira ou carvão).';
  if (!built(game, 'anvil')) return 'Bigorna: 3 barras de cobre + 6 pedra + 2 madeira.';
  if (pick < 2) return 'Na bigorna: picareta de cobre (minera ferro).';
  if (!built(game, 'bed')) return 'Construa uma casa: paredes, porta, piso, cama e baú.';
  if (!built(game, 'farm_plot')) return 'Faça canteiros e plante sementes de plantas silvestres.';
  if (pick < 3) return 'Ferro: funda minério de ferro e forje ferramentas de ferro.';
  if (pick < 4) return 'Aço: barra de ferro + 2 carvão na fornalha.';
  return 'Você domina o aço. Explore, construa e prospere!';
}

function guideSystem() {
  let t = 6;
  const once = (game, key, text, kind = 'info') => {
    const h = game.ctl.hinted;
    if (h['g_' + key]) return false;
    h['g_' + key] = true;
    game.events.emit('toast', { text, kind });
    return true;
  };
  return {
    update(game, dt) {
      t -= dt;
      if (t > 0) return;
      t = 2.5;
      const p = game.player;
      if (p.dead) return;
      const axe = tierOf(p, 'chop'), pick = tierOf(p, 'mine');
      if (once(game, 'start', 'Você começa sem nada: pegue pedrinhas, gravetos e fibras no chão')) return;
      if (axe < 0 && p.inv.count('pebble') >= 2 && p.inv.count('fiber') >= 2 && p.inv.count('stick') >= 1 && once(game, 'craft', 'Abra Criar (C) e faça um machado primitivo', 'good')) return;
      if (axe >= 0 && pick < 0 && once(game, 'pick', 'Agora uma picareta primitiva: 3 pedrinhas + 2 fibras + 1 graveto')) return;
      if (axe >= 0 && pick >= 0 && once(game, 'gather', 'Corte árvores e quebre pedregulhos. Construir (B): fogueira e bancada', 'good')) return;
      if (game.env.hour >= 17.2 && game.env.hour < 19 && !built(game, 'campfire') && once(game, 'night' + game.env.dayIndex, 'Vai anoitecer: construa uma fogueira (3 madeira + 4 pedrinhas)', 'warn')) return;
      if (built(game, 'workbench') && once(game, 'bench', 'Bancada pronta: ferramentas de pedra, arco, flechas e lança', 'good')) return;
      if (pick >= 1 && once(game, 'mine', 'Com picareta de pedra você minera cobre e carvão nas montanhas (Minerar: X)')) return;
      if ((p.inv.count('copper_ore') || p.inv.count('iron_ore')) && !built(game, 'furnace') && once(game, 'ore', 'Construa uma fornalha para fundir minério (18 pedra + 3 madeira)')) return;
      if (p.inv.count('copper_bar') >= 2 && !built(game, 'anvil') && once(game, 'anvil', 'Bigorna: forje ferramentas e armas de cobre')) return;
      if ((p.inv.count('seed_potato') || p.inv.count('seed_corn') || p.inv.count('seed_cotton')) && !built(game, 'farm_plot') && once(game, 'seeds', 'Sementes! Faça canteiros (Construir › Agricultura) para plantar')) return;
      if (game.world.roofAt && game.world.roofAt(Math.floor(p.x), Math.floor(p.y)) && once(game, 'dark', 'Dentro da montanha é escuro: leve uma tocha de mão ou construa tochas')) return;
    },
  };
}
