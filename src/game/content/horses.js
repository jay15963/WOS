// Horse numbers (pure data, docs/HORSE.md; game/horses.js). Every user-facing string in Brazilian Portuguese.
// The wild horse (content/fauna.js wild_horse) is tamed with wheat given by hand; the tamed horse is the farm animal
// 'horse' (content/combat.js SPECIES.horse, content/livestock.js STOCK.horse): fed at a feeder, saddled, ridden.

export const HORSE = {
  tameGives: 3,      // wheat given by hand (1 per "Dar trigo") until a wild horse is tamed
  reach: 2.6,        // tiles: "Dar trigo" / "Selar" / "Montar" this close (host check: + 0.6)
  calmT: 8,          // s a wild horse stands still after eating from a hand (it waits for the next one)
  speedK: 1.65,      // mounted speed = the player's sprint (player.js: baseSpeed × 1.65), constant, no stamina
  r: 0.34,           // tiles: the rider's body for collisions while mounted (a horse is big: narrow gaps refuse it)
  seat: 0.86,        // tiles above the ground: the saddle (× the horse's scale; art/fauna.js: barrel top + the seat)
  hurtK: 0.5,        // a creature's blow at a mounted player lands on the horse this often (it is the bigger target)
  farRide: 6,        // tiles: the host lets the rider go when its avatar and the horse part farther (a teleport)
  coats: 4,          // coat variants (variant bits 2–3): 0 dun · 1 chestnut · 2 grey · 3 black (art/fauna.js HORSE_COATS)
};

// the lance charge (abilities.js 'lance_thrust'): the damage grows with the horse's speed k = speed / gallop (0..1):
// × (mult[0] + (mult[1] − mult[0]) k) + (flat[0] + (flat[1] − flat[0]) k); it hits the first creature in a line ahead
// (reach tiles, half width w) after `delay` s, while the horse keeps going
export const THRUST = { mult: [0.5, 3.0], flat: [1, 10], reach: 2.7, w: 0.65, delay: 0.16, dur: 0.55, knock: 0.9 };

// wild-horse coats when a herd is made (game/fauna.js setupFauna): chances of chestnut / grey / black (rest: dun)
export const WILD_COATS = [0, 0.18, 0.1, 0.07];
