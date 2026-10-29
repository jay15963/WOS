// Gameplay systems registry. Each system: { sync, update(game, dt), render?(game, B, view, env), collect? }.
// Simulation modules (controller, player, abilities, combat, mobs, gathering, building, survival,
// loot, save) never touch the DOM; presentation (HUD, overlay) listens to game.events and reads state.
//
// Multiplayer contract (docs/SYNC.md §3.9): every system declares `sync`:
//   'host'     — authoritative world simulation (creatures, camps, crop growth…): skipped on guests
//   'owner'    — the local player's own state (input, inventory, work loop, crafting…)
//   'all'      — runs on every peer (clock, falling trees, loot arcs, projectiles…); host-only parts check net.auth
//   'cosmetic' — presentation only (juice, HUD, overlay, ambient, audio)
// addSystem() throws on a missing tag (tools/check-sync.mjs R10 checks it statically too).

import { Events } from './events.js';
import { Juice } from './juice.js';
import { initPlayer, playerSystem } from './player.js';
import { abilitiesSystem } from './abilities.js';
import { combatSystem } from './combat.js';
import { createSpawners, mobsSystem } from './mobs.js';
import { projectilesSystem } from './projectiles.js';
import { populateCamps, banditsSystem, campArtSystem, installCamps } from './bandits.js';
import { gatheringSystem } from './gathering.js';
import { initBuilding, buildingSystem } from './building.js';
import { survivalSystem } from './survival.js';
import { lootSystem } from './loot.js';
import { buildOcc } from './nav.js';
import { installController } from './controller.js';
import { loadGame, saveSystem } from './save.js';
import { initEconomy, postLoadEconomy, economySystems } from './economy.js';
import { installHUD } from '../ui/hud.js';
import { installOverlay } from '../ui/overlay.js';
import './mut/index.js';

const SYNC_TAGS = new Set(['host', 'owner', 'all', 'cosmetic']);

export function addSystem(game, sys) {
  if (!sys || !SYNC_TAGS.has(sys.sync)) throw new Error(`addSystem: sistema sem tag sync válida (${sys?.sync}) — declare sync: 'host'|'owner'|'all'|'cosmetic'`);
  if (sys.sync === 'host' && game.net.role === 'guest') return null; // the host simulates it for everyone
  game.systems.push(sys);
  return sys;
}

export function installSystems(game) {
  game.events = new Events();
  game.juice = new Juice(game);
  game.loot = [];
  game.touched = new Map();   // worldgen objects whose state changed (snapshot / save)
  game.falling = [];          // trees mid-fall
  game.minedTiles = [];       // rock tile indices mined out
  game.rockHits = new Map();
  game.timers = [];
  game.later = (delay, fn) => { game.timers.push({ t: delay, fn }); };
  game.ui = { modal: false };
  const auth = game.net.auth; // a guest's role is known before this runs (main.js)

  initPlayer(game);
  initBuilding(game);
  buildOcc(game);
  initEconomy(game);
  installCamps(game);               // deterministic camp layout: every client, before any save / snapshot
  const controller = installController(game);
  const isNew = !loadGame(game);    // guest: its player only (the world comes from the host's snapshot)
  postLoadEconomy(game, isNew);
  if (auth) { createSpawners(game); populateCamps(game); } // creatures: host only

  const clock = {
    sync: 'all', // worldTime advances everywhere (guests snap to the host's clock); timers of local code
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
  const juice = { sync: 'cosmetic', update(g, dt) { g.juice.update(dt); } };

  for (const s of [
    clock,
    controller,
    playerSystem(),
    abilitiesSystem(),
    combatSystem(),
    mobsSystem(),
    projectilesSystem(),
    banditsSystem(),
    campArtSystem(),
    gatheringSystem(),
    buildingSystem(),
    ...economySystems(),
    survivalSystem(),
    lootSystem(),
    juice,
    saveSystem(game),
  ]) addSystem(game, s);
  addSystem(game, installOverlay(game));
  addSystem(game, installHUD(game, { isNew }));
  return { isNew };
}
