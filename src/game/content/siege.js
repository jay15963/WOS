// Siege engines (máquinas de guerra, docs/REINOS.md §5 and "Implementação — máquinas de guerra"): the numbers. Pure
// data (no DOM, no game state). The buildings are in content/buildings.js (cat 'siege'), the rules in game/siege.js,
// the ops in game/mut/siege.js, the 3D models in art/faces/solidSiege.js.
//
// Kinds: 'arty' (one operator, aims at a ground point and lobs a stone: trebuchet, catapult) · 'push' (pushed by players:
// the battering ram, the siege tower). Distances in tiles, times in seconds, damage in hit points.

export const SIEGE_TYPES = ['trebuchet', 'catapult', 'battering_ram', 'siege_tower'];
export const WORKSHOP = 'siege_workshop';
export const WORKSHOP_R = 16; // an engine is built with a finished Oficina de cerco this close (tiles, body centre to body centre)

// ---------- artillery (one operator) ----------
// range: [min, max] of the aim point from the turning axis · reload: s between two shots (a winch: the arm comes back
// down while it runs) · turn: rad/s of the frame · ammo: item per shot · mob / giantK: damage to a creature (giantK × an
// ice giant's max life; mobMin: at least the creature's whole life — the catapult = the ballista) · area: radius of the
// blast on creatures · sdmg / sarea: damage to structures (full at the impact, half at the edge of sarea) ·
// scatter: [along the shot, across] × distance = the radius of the landing ellipse (very poor for the trebuchet) ·
// settle / settleMin: each shot at the same target (aim point within `same` tiles of the last one) multiplies the
// scatter by settle, down to settleMin (the crew ranges in) · fly: [s, s per tile] · apex: [tiles, tiles per tile] ·
// swing: s from the release command to the stone leaving the sling / cup · seat: tiles behind the axis where the
// operator stands · reach: how close to get on
export const ARTY = {
  trebuchet: {
    kind: 'arty', name: 'Trabuco', range: [14, 46], reload: 14, turn: 0.3, ammo: 'treb_stone',
    mob: 70, giantK: 0.1, mobMin: false, area: 2.0, sdmg: 650, sarea: 2.0,
    scatter: [0.16, 0.09], settle: 0.8, settleMin: 0.45, same: 3,
    fly: [2.0, 0.035], apex: [4, 0.2], swing: 0.62, seat: 2.15, reach: 3.4, h0: 2.6,
  },
  catapult: {
    kind: 'arty', name: 'Catapulta', range: [5, 26], reload: 5, turn: 0.85, ammo: 'cat_stone',
    mob: 600, giantK: 0.55, mobMin: true, area: 1.4, sdmg: 160, sarea: 1.0, // (creatures: the same as the ballista — game/ballista.js BALLISTA.dmg / giantK)
    scatter: [0.035, 0.025], settle: 1, settleMin: 1, same: 3,
    fly: [0.9, 0.035], apex: [1.5, 0.2], swing: 0.16, seat: 1.15, reach: 2.6, h0: 1.05,
  },
};

// ---------- pushed engines (2+ people; one alone, very slowly) ----------
// speed: tiles/s by the number of people pushing the same way (index = people, the last one for more) · side: × when
// pushed across its length · ram: damage to a GATE per blow (only gates: game/siege.js isGate), cd: s between blows
// by the crew (1, 2, 3+) · ramp: s for the siege tower's ramp to drop · climb: s per story up / down its ladder
export const PUSH = {
  battering_ram: { kind: 'push', name: 'Aríete', speed: [0, 0.3, 0.95, 1.1, 1.25], side: 0.6, ram: 220, cd: [0, 4, 2.2, 1.9, 1.7], swing: 0.55 },
  siege_tower: { kind: 'push', name: 'Torre de cerco', speed: [0, 0.2, 0.75, 0.9, 1.0], side: 0.6, ramp: 1.2, climb: 0.55, maxN: 3 },
};
export const PUSH_REACH = 2.2;   // tiles from the footprint to grab it
export const PUSH_SLOTS = 4;     // people around one engine

// ---------- hit points (siege damage: o.dmg 0..1 = damage / hp; game/siege.js structHp) ----------
export const SIEGE_HP = { trebuchet: 1800, catapult: 800, battering_ram: 1500, siege_tower: 2000, siege_workshop: 1200 };
export const HP_WOOD = 600, HP_STONE = 1500, HP_GATE_WOOD = 900, HP_GATE_STONE = 2400;

export const isArty = (type) => !!ARTY[type];
export const isPushed = (type) => !!PUSH[type];
export const isEngine = (type) => !!ARTY[type] || !!PUSH[type];
// the scatter radius [along, across] of a shot of `spec` at distance d with the ranging factor k
export const scatterOf = (spec, d, k = 1) => [spec.scatter[0] * d * k, spec.scatter[1] * d * k];
// the flight of a stone thrown d tiles: [duration s, apex tiles]
export const flightOf = (spec, d) => [spec.fly[0] + spec.fly[1] * d, spec.apex[0] + spec.apex[1] * d];
// tiles/s of a pushed engine with n people pushing the same way (across its length: × side)
export function pushSpeed(type, n, across = false) {
  const P = PUSH[type];
  if (!P || n <= 0) return 0;
  const v = P.speed[Math.min(n, P.speed.length - 1)];
  return across ? v * P.side : v;
}
export const ramCooldown = (n) => PUSH.battering_ram.cd[Math.max(1, Math.min(n, PUSH.battering_ram.cd.length - 1))];
