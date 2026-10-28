// Gameplay systems registry. Each system: { update(game, dt), render?(game, B, view, env) }.
// Simulation modules (controller, player, abilities, combat, mobs, gathering, building, survival,
// loot, save) never touch the DOM; presentation (HUD, overlay) listens to game.events and reads state.

import { Events } from './events.js';
import { Juice } from './juice.js';
import { initPlayer, playerSystem } from './player.js';
import { abilitiesSystem } from './abilities.js';
import { combatSystem } from './combat.js';
import { createSpawners, mobsSystem } from './mobs.js';
import { gatheringSystem } from './gathering.js';
import { initBuilding, buildingSystem } from './building.js';
import { survivalSystem } from './survival.js';
import { lootSystem } from './loot.js';
import { buildOcc } from './nav.js';
import { installController } from './controller.js';
import { loadGame, saveSystem } from './save.js';
import { installHUD } from '../ui/hud.js';
import { installOverlay } from '../ui/overlay.js';

export function installSystems(game) {
  game.events = new Events();
  game.juice = new Juice(game);
  game.loot = [];
  game.touched = new Map();   // world objects whose state changed (saved)
  game.regrow = new Set();    // objects waiting to regrow
  game.falling = [];          // trees mid-fall
  game.minedTiles = [];       // rock tile indices removed by the player
  game.rockHits = new Map();
  game.timers = [];
  game.later = (delay, fn) => { game.timers.push({ t: delay, fn }); };
  game.ui = { modal: false };

  initPlayer(game);
  initBuilding(game);
  buildOcc(game);
  const controller = installController(game);
  const isNew = !loadGame(game);
  createSpawners(game);

  const clock = {
    update(g, dt) {
      g.worldTime += dt;
      const T = g.timers;
      for (let i = T.length - 1; i >= 0; i--) {
        const tm = T[i];
        tm.t -= dt;
        if (tm.t <= 0) { T.splice(i, 1); tm.fn(); }
      }
    },
  };
  const juice = { update(g, dt) { g.juice.update(dt); } };

  game.systems.push(
    clock,
    controller,
    playerSystem(),
    abilitiesSystem(),
    combatSystem(),
    mobsSystem(),
    gatheringSystem(),
    buildingSystem(),
    survivalSystem(),
    lootSystem(),
    juice,
    saveSystem(game),
  );
  game.systems.push(installOverlay(game));
  game.systems.push(installHUD(game, { isNew }));
}
