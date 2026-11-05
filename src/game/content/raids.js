// The numbers of the winter attacks on the settlements (docs/REINOS.md §1 "Ataques aos lugares no inverno" and §16).
// Owner: on the nights of each region's bad season the region's dead attack the villages, cities and castles — "um pouco
// menos monstros da quantidade de guardas", a real battle, the humans win almost always, the monsters rarely (~5 %); a
// lost night never empties the place and the next day the people rebuild (the player's rented house too, never the
// player's private property). Pure data (node can import it): game/raidsim.js (the fight by numbers), game/raids.js (the
// waves near the players, the attacks by numbers far from them), game/mut/raids.js (the shared state).

export const RAID = {
  // ---------- when ----------
  // a place is attacked on this share of its bad-season nights (the walkers' winter, the warm zone's mild winter, the
  // tropics' dry season — undead.js nightFamilyAt at the place); polar places (every night is a winter night) less often
  chance: 0.6, chancePolar: 0.35,
  hours: [21.3, 2.4],        // the wave comes at a random time in the dark (game hours; the fight has time before dawn)
  // ---------- the wave (docs/REINOS.md §16) ----------
  size: [0.7, 0.9],          // monsters per live guard of the place (archers included): "a bit fewer than the guards"
  giant: { city: 0.6, castle: 0.45, village: 0 }, // a giant of the family leads the wave (where the family has one)
  giantK: 4,                 // … and counts as this many monsters in the wave's size
  // strength per monster (a raid monster's hp and damage × fury): the guards are trained, armoured and iron-armed (×1.6
  // hp, ×1.5 damage — game/people.js) and far from the start the night's dead are the same level: a plain walker is a
  // fifth of a guard there. A wave's fury puts each monster at 1 / par of a melee guard of the place (power = hp × dps
  // against each other's armour, game/raidsim.js unitStats) — the same balance near the start and at the edge of the world.
  // By kind: the stone walls of castles and cities hold the dead longer under more archers (and a giant comes with them)
  par: { village: 1.5, castle: 1.6, city: 1.6 }, // a melee guard ≈ par × a monster of a normal wave
  furyMin: 0.75, furyMax: 3.2,
  // the rare horde (owner: "um pouco de chance … de os humanos perderem, mas raro, 5 %"): the night's oldest dead, much
  // harder — the same count (never more monsters than guards), each one stronger (hp and damage × k); a giant comes
  // more often. Calibrated with game/raidsim.js (tools/raid-calib.mjs; on the real realm game.raids.dbg.calibrate and
  // WA3): ~5 % of the attacks are lost — a horde breaks the defense ~3 times in 4, a normal wave about once in 200
  horde: { p: 0.058, k: { village: 1.27, castle: 1.7, city: 1.7 }, size: [0.82, 0.9] },
  // ---------- the fight (game/raidsim.js) ----------
  // the defense collapses (the attack is LOST) when this share of the melee guards is left (at most 1 in a village) and
  // at least `lostMin` monsters still stand
  lost: { melee: 0.25, lostMin: 2 },
  // ---------- near the players (game/raids.js) ----------
  liveCap: 24,               // wave creatures alive at once near the players (low quality: × 0.6) — the rest wait in the dark
  feedEvery: 1.4,            // s between two reserves walking in as the ones out fall
  spawnOut: 14,              // tiles past the town land where the wave appears (out of sight when it can)
  liveR: 70,                 // tiles: a player this near the place when the wave comes → it is played live
  liveOut: 150,              // tiles: nobody this near any more → the rest of the fight goes back to the numbers
  // ---------- what a lost night costs (both ways) ----------
  toll: {
    house: 0.5,              // each resident of a home the monsters broke into dies with this chance…
    maxShare: 0.22,          // …never more than this share of the civilians (the place never loses its people)
    homes: [2, 5],           // homes broken into by numbers (a lost night far from the players)
  },
  // pieces hit by numbers: the wall on the attacked side cracked (held: 1–3 pieces, one may fall; lost: the breach — 1–2
  // pieces destroyed —, the gate on that side with a chance, house doors / walls)
  wall: { held: [1, 3], heldBreak: 0.35, lost: [3, 6], lostGone: [1, 2], gate: 0.4, dmg: [0.25, 0.75] },
  // ---------- the next day ----------
  rebuild: { from: 7, to: 18.6, perHour: 6 }, // far from the players: destroyed pieces rebuilt by numbers from the next morning
  log: 80,                   // attacks kept in the log (the mural, the tests)
};

// the wave's size in monsters for g live guards (f: the share rolled), a giant counted as RAID.giantK
export const waveCount = (g, f) => Math.max(1, Math.round(g * f));
