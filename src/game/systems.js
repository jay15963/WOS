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
import { initRoofs, roofsSystem } from './roofs.js';
import { raysSystem } from '../fx/rays.js';
import { initRockFx, rockFxSystem } from '../fx/rockfx.js';
import { creativeSystem } from './creative.js';
import { roofSupportSystem } from './mut/roofs.js';
import { survivalSystem } from './survival.js';
import { lootSystem } from './loot.js';
import { buildOcc } from './nav.js';
import { installLevels, levelsSystem } from './levels.js';
import { installController } from './controller.js';
import { loadGame, saveSystem } from './save.js';
import { initEconomy, postLoadEconomy, economySystems } from './economy.js';
import { initPaths, pathsSystem } from './paths.js'; // painted terrain paths (agent M)
import { terrainSystem } from './terrain.js'; // terrain height: building pads, the terrain tool (docs/TERRAIN-HEIGHT.md)
import { installTunnels, tunnelsSystem } from './tunnels.js'; // tunnels dug into the relief (docs/TERRAIN-HEIGHT.md)
import { installHUD } from '../ui/hud.js';
import { installEcoHud } from '../ui/ecoHud.js'; // the purse, the job tracker, waypoints, plots, tax notices (game/eco.js)
import { installOverlay } from '../ui/overlay.js';
import { installAim } from '../ui/aim.js';
import { rangeFlashSystem } from '../fx/rangeflash.js'; // the bow's reach, blinking softly on an auto shot
import { decorSystem } from './decoration.js'; // agent K: dummy readouts, window glow, showcase (dev)
import { initCorpses, corpsesSystem } from './corpses.js';
import { seasonSystem } from './seasons.js'; // spring / summer / autumn / winter from the shared clock
import { installDecks, decksSystem } from './decks.js'; // piers / bridges over the water
import { deckSupportSystem } from './mut/decks.js';
import { itemSprite } from './loot.js';
import { installStock, stockSystem, stockFxSystem } from './livestock.js'; // farm animals (docs/LIVESTOCK.md)
import { installFishing, fishingSystem } from './fishing.js'; // fishing with a rod
import { ballistaSystem, ballistaOwnerSystem } from './ballista.js'; // the ballista: bolts, aim, its operator
import { installBallistaUi } from '../ui/ballistaUi.js';
import { siegeSystem, siegeOwnerSystem } from './siege.js'; // siege engines: shots, pushing, the tower's ramp (docs/REINOS.md)
import { installSiegeUi } from '../ui/siegeUi.js';
import { installBoats, boatsSystem, boatOwnerSystem } from './boats.js'; // boats: rowing, riders, animals aboard
import { installHorses, horseSystem, horseOwnerSystem } from './horses.js'; // horses: taming, saddle, riding (docs/HORSE.md)
import { waterfallSystem } from '../fx/waterfalls.js'; // waterfalls: mist, spray, the roar (cosmetic)
import { installTowns, townsSystem, placeSystem } from './towns.js'; // kingdoms and settlements (docs/REINOS.md)
import { installPeople, peopleSystem, peopleFxSystem } from './people.js'; // the settlements' citizens and guards (docs/REINOS.md "Fase 2")
import { installEco, ecoSystem, ecoOwnerSystem } from './eco.js'; // the economy of the kingdoms (docs/REINOS.md "Fase 2 — economia")
import { installRealms, realmsSystem, realmsPosSystem } from './realms.js'; // diplomacy, owners, armies, sieges by numbers (docs/REINOS.md §13)
import { installWarHud } from '../ui/warHud.js'; // the war's notices (docs/REINOS.md §13)
import { installWarfare, warfareSystem, warfareFxSystem } from './warfare.js'; // the kingdoms' soldiers near the players: battles, the siege (docs/REINOS.md §14)
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
  initRoofs(game);
  initRockFx(game);                 // cracks of rock being mined (cosmetic)
  installTunnels(game);             // tunnels: bodies in them, the floor shown (game/tunnels.js)
  installLevels(game);              // levels: stories / stairs (derived from the structures; before the save loads)
  installDecks(game, itemSprite);   // piers / bridges: the deck map (derived from the structures)
  buildOcc(game);
  initEconomy(game);
  initCorpses(game);                // bodies on the ground (before the save / snapshot loads them)
  initPaths(game);                  // path grids exist before a save / snapshot is applied
  installStock(game);               // farm animals: game.stock (interaction / feeder / labels)
  installFishing(game);             // fishing: game.fishing (bobbers, the rod's work)
  installBoats(game);               // boats: game.boats (before the save / snapshot loads them)
  installHorses(game);              // horses: game.horses (who rides what, the rider's movement)
  installTowns(game);               // settlements: pieces made per chunk from the seed (before the camps: they keep away)
  installPeople(game);              // their people: identities from the seed (game.people, game.towns.people(sid))
  installEco(game);                 // markets, reputation, jobs, properties (before the save / snapshot loads them)
  installRealms(game);              // the kingdoms' wars: relations, owners, armies (before the save / snapshot loads them)
  installWarfare(game);             // the armies near the players (game.warfare: before the save / snapshot loads the forces)
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
    seasonSystem(),                 // game.season + world.frozen before anything moves (seasons.js)
    townsSystem(),                  // settlements: pieces of the chunks that loaded (+ host: gates, repairs, the pens' animals)
    levelsSystem(),
    decksSystem(),                  // world.deck / world.rail before anything moves (decks.js)
    terrainSystem(),                // terrain height: the pads under buildings before anything moves (terrain.js)
    tunnelsSystem(),                // tunnels: e._tn of every body, the floor shown around the local player (tunnels.js)
    controller,
    playerSystem(),
    abilitiesSystem(),
    combatSystem(),
    mobsSystem(),
    peopleSystem(),                 // the settlements' people (host): who is out near the players, their routine, guards, repairs
    warfareSystem(),                // the kingdoms' soldiers (host): forces near the players, field battles, the siege AI (docs/REINOS.md §14)
    projectilesSystem(),
    ballistaSystem(),               // bolts in flight, drawn aim, reload (+ host: operators gone)
    ballistaOwnerSystem(),          // the local operator (after abilities: it roots the player)
    siegeSystem(),                  // siege engines: drawn aim, reload, ramp, slides (+ host: pushed engines move, crews gone)
    siegeOwnerSystem(),             // the local operator / pusher / climber (after abilities: it roots the player)
    boatsSystem(),                  // boats: drawn pose, riders / animals on their places, wake (+ host: launch, tidy)
    boatOwnerSystem(),              // the local rider: seated, rowing at the oars (after abilities: it roots the player)
    banditsSystem(),
    campArtSystem(),
    gatheringSystem(),
    buildingSystem(),
    roofsSystem(),
    raysSystem(),
    rockFxSystem(),
    roofSupportSystem(),
    deckSupportSystem(),            // host: bridge pieces that lost their footing fall (mut/decks.js)
    pathsSystem(),
    ...economySystems(),
    survivalSystem(),
    creativeSystem(),               // after survival: the bars end every frame full (creative.js)
    lootSystem(),
    corpsesSystem(),
    stockSystem(),                  // the farm clock: domestication, hunger, births, growth (host)
    stockFxSystem(),                // ropes, feeder range, fertile soil marks (cosmetic)
    horseSystem(),                  // riders and their horses paired for drawing (+ host: a dead horse throws its rider)
    horseOwnerSystem(),             // the local rider: mounted state, the sprint's speed, the measured gallop
    fishingSystem(),                // bobbers and bites (owner + every peer's cosmetics)
    waterfallSystem(),              // waterfalls / rapids around the camera: mist, spray, sound (fx/waterfalls.js)
    placeSystem(),                  // the kingdom / settlement the player is in (the HUD banner)
    peopleFxSystem(),               // their doors swinging as they go through, the bell, the news (every peer)
    warfareFxSystem(),              // the general's standard raised while it rallies (every peer)
    ecoSystem(),                    // host: the markets' day, bills, job progress (eco.js)
    ecoOwnerSystem(),               // the local player's economy identity known to the host
    realmsSystem(),                 // host: diplomacy, campaigns, marches, battles and sieges by numbers (realms.js)
    realmsPosSystem(),              // every peer: where the armies in the field are (derived from the clock)
    juice,
    saveSystem(game),
  ]) addSystem(game, s);
  addSystem(game, installOverlay(game));
  addSystem(game, installHUD(game, { isNew }));
  addSystem(game, installEcoHud(game)); // (after the overlay: it draws the plots / the waypoint on the overlay canvas)
  addSystem(game, installWarHud(game)); // the war's notices for the local player (ui/warHud.js)
  addSystem(game, installAim(game)); // after equipment visuals: it may empty the hand of a thrown spear
  addSystem(game, installBallistaUi(game)); // (after the aim: the ballista leans the camera along its aim)
  addSystem(game, installSiegeUi(game)); // (siege engines: aim ring, scatter, reload, crew — ui/siegeUi.js)
  addSystem(game, rangeFlashSystem(game));
  addSystem(game, decorSystem(game));
  return { isNew };
}
