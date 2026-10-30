// Creative mode (a world setting, chosen when the world is created): for testing / enjoying construction.
//   - building: blueprints are finished the moment they are placed, with no materials (build.place); moving is
//     instant (build.move); "Desmontar" removes at once (build.decon); paths are laid at once (path.plan);
//   - crafting: every recipe, anywhere, without ingredients or fuel, done at once (crafting.js);
//   - the player: no damage (combat.js dealDamage), never hungry / cold / wet / tired (creativeSystem keeps the
//     local player's bars full: endless running and abilities), creatures never pick a fight with a player (ai.js).
// Multiplayer: game.creative is part of the world (net/snapshot.js `mode`), so the host's world decides it for
// everyone; the save keeps it with the world (same serializer). Each owner keeps its own player's bars full.

import { removeBuff } from './player.js';

export const isCreative = (game) => !!game?.creative;

const BAD = ['poison', 'bleed', 'hypothermia', 'cold', 'wet', 'chilled', 'starving', 'hungry', 'weak', 'sick', 'stunned'];

export function creativeSystem() {
  return {
    sync: 'owner', // the local player's own bars
    update(game) {
      if (!game.creative) return;
      const p = game.player;
      if (p.dead) return;
      p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = p.maxHunger;
      p.bodyHeat = 100; p.wetT = 0;
      if (p.buffs?.length) for (const id of BAD) if (p.buffs.some((b) => b.id === id)) removeBuff(p, id);
    },
  };
}
