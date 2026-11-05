// The numbers of the kingdoms' wars (docs/REINOS.md §13 "Fase 3a — diplomacia e exércitos"): diplomacy, armies on the
// map, marches, field battles and sieges resolved by numbers far from the players, conquest. Pure data (node can import
// it); game/realms.js runs them on the host, game/mut/realms.js replicates the results.

export const WAR = {
  // ---------- diplomacy (the daily tick, host) ----------
  graceDays: 2,          // the start kingdom (the spawn village's) stays out of wars for its first 2 days (owner's rule)
  quietDays: 1,          // nowhere a war on the world's first day (the start of a world is calm)
  tension: {
    init: [10, 60],      // a pair's tension when the world starts: 10..60 (a hash of the pair: some neighbours are old rivals)
    base: [0.3, 2.4],    // tension added a day, by pair (border friction)
    rival: 1.4,          // + a day when one side is ≥ 1.4× stronger (the strong covet the weak)
    grudge: 0.9,         // + a day per past war between them (at most 3)
    lostLand: 2.5,       // + a day when one holds a place that was the other's (revanche)
    ally: -3,            // allies cool down
    truce: -2.5,         // a truce cools down
    busy: -1,            // either side already at war elsewhere
    noise: 3,            // ± a day / 2
    keep: 0.97,          // the rest decays a little each day
  },
  declareAt: 52,         // tension above which a war may be declared
  declareP: 0.025,       // chance a day per point above it (at most 0.6)
  maxWarsK: 6,           // the world holds at most ⌈kingdoms / 6⌉ wars at once (16 kingdoms → 3)
  maxWarsPer: 2,         // per kingdom (a defensive alliance may drag it into a second one)
  allyBelow: 14,         // tension below which two neighbours may ally
  allyP: 0.07,           // a day (more with a common enemy)
  maxAllies: 2,
  breakAbove: 42,        // allies fall out above this tension
  breakP: 0.12,
  weary: { day: 5, perSoldier: 1 / 14, placeLost: 18, placeWon: -8 }, // war weariness (0..100) of each side
  peaceAt: 55,           // weariness above which peace may be signed
  peaceP: 0.03,          // chance a day per point above it (+0.15 after 10 days of war)
  truceDays: 5,          // no war between them for 5 days after a peace
  // ---------- armies ----------
  cap: { village: [8, 0.12], castle: [50, 1], city: [60, 0.35] }, // soldiers at most: base + pop × k (village ~14, castle ~80, city ~130)
  init: 0.8,             // share of the cap at the start of a world
  recruit: 0.12,         // share of the cap recruited a day (losses come back slowly)
  recruitWar: 1.5,       // × while the kingdom is at war
  keep: { village: 0.5, castle: 0.35, city: 0.4 }, // share of a garrison that stays home on a campaign
  march: 1.1,            // tiles / s (game time = real seconds: ~860 tiles a day; worldTime)
  marchEng: 0.85,        // with siege engines in the train
  maxRoute: 1700,        // tiles: the farthest a campaign goes by road
  overland: 2800,        // tiles: kingdoms of one land mass with no road between them march across country this far
  overlandK: 1.35,       // (a cross-country march counts as this much longer when choosing)
  rivalRange: 2800,      // tiles between capitals: kingdoms of one land mass this near have relations even without a border
  rivalBase: 0.5,        // (their border friction is this much of a neighbour's)
  muster: 1100,          // tiles: places this near the target send contingents
  contingents: 4,        // at most this many armies per campaign
  force: 1.5,            // a campaign starts only with ≥ 1.5 × the defence's strength
  reliefK: 0.7,          // a relief force goes with ≥ 0.7 × the besiegers
  planEvery: 2,          // game hours between campaign plans of a kingdom
  meet: 10,              // tiles: field armies of kingdoms at war this close fight
  stopOut: 14,           // tiles outside the town land where a besieging army camps (on its road)
  live: 120,             // tiles: a player this near → 3b plays the army (game.warfare.materialize)
  liveOut: 150,          // tiles: nobody this near → back to numbers (dematerialize)
  maxSkip: 3,            // days: a longer time jump is simulated only for its last 3 days
  step: 4,               // s: the simulation step (marches, meetings)
  // power of a soldier: 1 + 0.05 × (level − 1)  (§7b: realmNpcLevel — level 18 ≈ 1.85 × level 1)
  musterWait: 12,        // game hours at most an army waits at its muster place for the other contingents
  joinRange: 420,        // tiles by road: places this near the muster send their contingents there
  minArmy: 12,           // soldiers: no campaign with fewer
  lvK: 0.05,
  // ---------- field battles (rounds every 8 s of game time) ----------
  battle: { round: 8, kill: 0.06, morale: 0.45, wipe: 3, newsMin: 16 }, // (newsMin: a smaller skirmish makes no news)
  // ---------- sieges (an hour = dayLength / 24) ----------
  siege: {
    campHours: 2,        // setting up the camp
    buildPer: 1 / 30,    // engine points an hour per soldier
    cost: { ram: 6, tower: 12, treb: 10, cat: 5 },
    want: { stone: { ram: 1, tower: 1, treb: 2 }, city: { ram: 1, tower: 2, treb: 3 }, palisade: { ram: 1, cat: 1 }, none: {} },
    treb: { hit: 0.55, dmg: 0.45 },  // a trebuchet: chance an hour to hit the wall, damage to one piece (stone 1500 hp: ~650 a stone)
    cat: { hit: 0.6, dmg: 0.5 },     // a catapult on a palisade
    ram: { stone: 0.5, wood: 1 },    // a ram's damage an hour on a stone / wooden gate (1 = broken)
    ramLoss: 2,          // soldiers lost an hour at the ram
    wallK: { city: 2.6, castle: 2.2, palisade: 1.4, none: 1 }, // the defence's strength behind its walls
    breachK: 0.6, gateK: 0.75, towerK: 0.8, // × when breached / the gate broken / towers at the wall
    shoot: 0.035,        // attackers lost an hour: defenders × this × wall
    bomb: 0.01,          // defenders lost an hour: attackers × this (engines and arrows)
    assault: { need: 1.3, att: 0.32, def: 0.24 },
    starveAfter: 48, starve: 0.03, // hours; defenders lost an hour after that
    giveUp: { share: 0.4, ratio: 0.9, hours: 96 },
    hold: 0.5,           // share of the winners that stays as the new garrison
    repairHold: 2,       // days after a siege before the walls are mended by numbers / rebuilt
  },
  news: 60,              // news kept (the mural's lists)
};

export const capOf = (s) => { const c = WAR.cap[s.kind] || WAR.cap.village; return Math.round(c[0] + (s.pop || 0) * c[1]); };
export const powerOf = (n, lv) => n * (1 + WAR.lvK * Math.max(0, (lv || 1) - 1));
// the town watch (people.js buildPeople: village 6 + 2 with walls, castle 72 % of the people, city 15 %)
export const watchOf = (s) => Math.max(2, s.kind === 'village' ? 6 + (s.walls ? 2 : 0) : Math.round((s.pop || 0) * (s.kind === 'castle' ? 0.72 : 0.15)));
export const wallKind = (s) => (s.kind === 'city' ? 'city' : s.walls === 'stone' ? 'castle' : s.walls === 'palisade' ? 'palisade' : 'none');

export const REL_PT = { war: 'Em guerra', ally: 'Aliado', neutral: 'Em paz', truce: 'Trégua', self: 'Este reino' };
export const STATE_PT = { home: 'Em casa', march: 'Marchando', camp: 'Acampado', siege: 'Cercando', battle: 'Em batalha', retreat: 'Recuando' };
export const ENG_PT = { treb: ['trabuco', 'trabucos'], cat: ['catapulta', 'catapultas'], ram: ['aríete', 'aríetes'], tower: ['torre de cerco', 'torres de cerco'] };
