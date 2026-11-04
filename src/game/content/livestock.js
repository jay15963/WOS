// Livestock and fishing numbers (pure data, docs/LIVESTOCK.md). Every user-facing string in Brazilian Portuguese.
// Times in game days (one day = env.dayLength s, 13 min of play); food per day in items.
//
// STOCK[species]:
//   eats      items it takes from a feeder ('any' = every food item and wheat)
//   perDay    items an adult eats per day (one item = one portion = 1 / perDay of a full belly); a baby eats half
//   grow      days a baby takes to become an adult · breed: days between two births of the same parents
//   baby      name of the young · g grammatical gender of the adult (messages) · herd [min, max] wild group size
//   babyLoot  share of the adult products a slaughtered young gives (rounded, at least 1 of the first row)

export const FEEDER_RANGE = 6;   // tiles from a feeder's centre: farm animals inside are domesticated (BUILDINGS.feeder.feed)
export const MAX_TIED = 5;       // animals one player leads on ropes at once
export const FEEDER_CAP = 10;    // domesticated animals per feeder area: no births beyond it
export const BELLY_DAYS = 1;     // a full belly lasts this long (then the animal is starving)
export const STARVE_DAYS = 0.5;  // starving this long kills it (warnings first)
export const HUNGRY_AT = 0.3;    // belly below this: "com fome"
export const BREED_FED = 0.6;    // both parents at least this full
export const BABY_SCALE = 0.56;  // a newborn's size (grows to 1)

export const STOCK = {
  cow:     { eats: ['wheat'], perDay: 3, grow: 3, breed: 2, baby: 'Bezerro', g: 'f', herd: [2, 3], babyLoot: 0.4 },
  sheep:   { eats: ['wheat'], perDay: 1, grow: 2, breed: 1.5, baby: 'Cordeiro', g: 'f', herd: [3, 4], babyLoot: 0.4 },
  pig:     { eats: 'any', perDay: 2, grow: 2, breed: 1.5, baby: 'Leitão', g: 'm', herd: [2, 3], babyLoot: 0.5 },
  chicken: { eats: ['corn'], perDay: 1, grow: 1.5, breed: 1, baby: 'Pintinho', g: 'f', herd: [3, 5], babyLoot: 1 },
  // the tamed horse (docs/HORSE.md, game/horses.js): no wild herds (tamed from the wild horses with wheat), no foals;
  // `always`: hungry anywhere once tamed (it must come back to a feeder), `belly`: days a full belly lasts
  horse:   { eats: ['wheat'], perDay: 2, belly: 2, grow: 3, breed: 99, baby: 'Potro', g: 'm', herd: [0, 0], babyLoot: 0.5, always: true, noBreed: true },
};
export const STOCK_NAME_PT = { cow: 'vaca', sheep: 'ovelha', pig: 'porco', chicken: 'galinha', horse: 'cavalo' };

// predators hunting farm animals at night (src/game/ai.js lookForPrey / huntStep): fences and pens keep them out
export const PREY = {
  hunters: { wolf: 1, bear: 0.4 }, // species that hunt them · × the nightly chance
  chance: 0.45,   // a pack's chance, each night, to go after farm animals at all (rolled once a night)
  kills: 1,       // farm animals a pack kills in one night (then it lets them be)
  r: 11,          // tiles: a predator notices a farm animal this close (in sight)
  flee: 6,        // tiles: the hunted animal (and the ones next to it) run from a predator this close
  dmgK: 2,        // bite damage × against farm animals (a pack downs a sheep in a few bites, a cow in ~6)
  giveUp: 30,     // s chasing one animal before giving up (or as soon as no path reaches it: a fence)
  calm: 40,       // s a pack leaves farm animals alone after a kill / giving up
};

// fishing (src/game/fishing.js + mut/fish.js)
export const FISH = {
  castMin: 1.6, castMax: 6.5,     // tiles from the player to the bobber
  wait: [3, 9],                   // s until a bite when a fish swims near the bobber (more fish near: sooner)
  waitNone: [9, 16],              // s with no fish near (a stray one comes by)
  window: 1.25,                   // s the bobber stays under: pull now
  slack: 0.45,                    // s of network tolerance on the pull (host clock)
  rodCatch: [2, 3],               // raw fish a rod catch gives
  shotCatch: 1,                   // a long shot / spear gives less
  near: 3.5,                      // a fish within this many tiles of the bobber counts
};
