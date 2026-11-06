// The kingdoms' soldiers and their wars near the players (docs/REINOS.md §14 "Fase 3b — campo de batalha e cerco"): the
// numbers. Pure data (no game imports): game/soldier.js makes the soldiers, game/warfare.js the forces and the field
// battles, game/siegeAI.js the playable siege.

// ---------- how many are real creatures (performance: the owner complained about frame drops) ----------
// total: live soldier creatures in the world at once · side: per force · low: × on a weak device (quality low) · the
// rest of a force are numbers (reserves) that step in as the live ones fall
export const WAR = {
  cap: { total: 80, side: 44, siege: 56, low: 0.6 },
  spawnPerTick: 6,     // new soldier creatures per host tick (0.5 s)
  tick: 0.5,           // s: the host's force tick (phases, reserves, the reports)
  nearR: 30,           // tiles: a soldier farther than this from every player thinks every farK-th frame
  farK: 3,
  dropR: 150,          // tiles: a force with no player this close is dematerialized (numbers again)
  // movement (tiles/s)
  speed: { march: 1.55, walk: 1.7, run: 3.4, charge: 3.9, retreat: 3.0 },
  // melee / archers
  sight: 14,           // tiles: a soldier sees a foe this far (archers: their range)
  archer: { range: 19, min: 3, volleyK: 0.92, wallBonus: 1.25, lobK: 0.55 }, // (lobK: the long shot from this share of the plain range — soldier.js)
  spearMin: 4.5, // tiles: a spearman throws its spear (npcLob.js Lançar Lança, up to 8) only at a foe at least this far — closer it closes in for the blows
  leash: 26,           // tiles from its anchor a soldier chases a foe in a battle line
  pfoeT: 22,           // s: a player who hurt a soldier is its foe this long (refreshed by every hit)
  // the general's rally and the morale (0..100): losses (% of the side's men) and the general falling lower it; the
  // general shouts and raises it now and then; below rout the side breaks and runs
  morale: { start: 100, perLoss: 1.1, outnumbered: 18, general: 30, rally: 14, rallyEvery: 9, rout: 26, routSiege: 22 },
  // a field battle: how far apart the lines deploy, when the archers loose, when the infantry charges
  battle: { gap: 34, volley: 24, charge: 11, lineW: 1.15, rowD: 1.25, endT: 14, maxT: 600 },
  // the siege (game/siegeAI.js): the camp out of the defenders' reach (+ pad), build time (× the building's time), the
  // trebuchet's distance to its target, how long it may last, the losses that make it give up, the capture
  siege: {
    pad: 7,            // tiles past the farthest defender's reach (archers on the walls, ballistas) the camp stands
    campR: 6,          // tiles: the camp's radius (tents, banners, fires around its middle)
    buildK: 0.8,       // × BUILDINGS[type].time of the engines (the engineers hammer at it)
    trebD: [34, 43],   // tiles from the trebuchet's axis to its target (in its range 14–46, outside the archers')
    maxT: 1200,        // s: a siege longer than this is given up (retreat)
    lossRetreat: 0.62, // share of the force lost → retreat
    captureR: 7,       // tiles around the centre (the plaza / the keep) the attackers must hold
    captureT: 18,      // s with attackers there and no defender around → the place is taken
    defR: 13,          // tiles: a defender this close to the centre still holds it
    breachWait: 70,    // s of bombardment before the assault goes in anyway (ram / towers)
    holdT: 40,         // s the victors stay after the capture before the force reports and goes
  },
  // the reputation a player earns helping the side that defends (docs/REINOS.md §14 "Jogadores"): with the kingdom the
  // soldiers attack (+) and with the soldiers' own (−); at most every `every` s a toast; `cap` per force
  rep: { kill: 2, general: 10, engineer: 3, hits: 6, hit: 1, repelled: 10, cap: 60, every: 4 },
};

// ---------- the roles ----------
// pt: [male, female] name of the role · share: of a force (the rest is infantry) · hp / dmg: × the soldier's base
// (content/combat.js SPECIES.soldier at its level) · weapon: by armour tier (0 leather · 1 copper · 2 iron)
export const ROLES = {
  spear:  { pt: ['Lanceiro', 'Lanceira'], hp: 1.45, dmg: 1.2, weapon: ['spear_copper', 'spear_iron', 'spear_steel'], shield: true },
  sword:  { pt: ['Espadachim', 'Espadachim'], hp: 1.4, dmg: 1.3, weapon: ['sword_copper', 'sword_iron', 'sword_steel'], shield: true },
  archer: { pt: ['Arqueiro', 'Arqueira'], hp: 1.05, dmg: 1.1, weapon: ['bow_wood', 'bow_composite', 'bow_composite'], shield: false },
  eng:    { pt: ['Engenheiro', 'Engenheira'], hp: 1.2, dmg: 0.9, weapon: ['axe_copper', 'axe_iron', 'axe_steel'], shield: false },
  general:{ pt: ['General', 'General'], hp: 4.2, dmg: 1.8, weapon: ['sword_iron', 'sword_steel', 'sword_steel'], shield: false },
};
export const SHARE = { archer: 0.3, eng: 0.1, sword: 0.35 }; // (of the non-archers, swords; the rest spears)
// armour tier by level (§7b: realmNpcLevel): body / head / tier of the weapons
export const ARMOUR = [
  { lv: 0, body: 'armor_leather', head: null, t: 0 }, // (no helmet at first: the faces and the tabards read; copper helmets are the village watch's)
  { lv: 9, body: 'armor_copper', head: 'helmet_iron', t: 1 },
  { lv: 18, body: 'armor_iron', head: 'helmet_iron', t: 2 },
];
export const armourOf = (lv) => { let a = ARMOUR[0]; for (const q of ARMOUR) if (lv >= q.lv) a = q; return a; };

// ---------- the soldier's look (overrides of randomLook; null = the kingdom's colours) ----------
export const KIT = {
  spear:  { top: ['jerkin'], topC: ['8e8e8a', '73767b', '5e5f63'], over: 'tabard', bottom: ['trousers', 'slim'], botC: ['3e3e40', '262526', '5e3e28'], shoes: ['tall_boots', 'boots'], build: ['athletic', 'broad', 'average'] },
  sword:  { top: ['jerkin'], topC: ['8e8e8a', '73767b', '5e5f63'], over: 'tabard', bottom: ['trousers', 'slim'], botC: ['3e3e40', '262526', '5e3e28'], shoes: ['tall_boots', 'boots'], build: ['athletic', 'broad'] },
  archer: { top: ['jerkin'], topC: null, over: 'vest', overC: ['5e3e28', '3c2a1e'], bottom: ['trousers', 'slim'], botC: ['3e6238', '6e4c32', '3e3e40'], shoes: ['tall_boots', 'boots'], build: ['slim', 'average', 'athletic'], hat: 'hood_leather' },
  eng:    { top: ['shirt', 'henley'], topC: null, over: 'apron', overC: ['3c2a1e', '5e3e28'], bottom: ['trousers', 'baggy'], botC: ['3e3e40', '6e4c32'], shoes: ['boots'], build: ['broad', 'heavy', 'athletic'] },
  general:{ top: ['jerkin'], topC: null, pattern: 'embroidered', over: 'tabard', bottom: ['slim'], botC: ['262526'], shoes: ['tall_boots'], build: ['athletic', 'broad'] },
};

// ---------- what they shout (cosmetic toasts near the players) ----------
export const CRIES = {
  rally: ['Firmes! Pelo Reino de {reino}!', 'Segurem a linha!', 'Avante, homens de {reino}!', 'Ninguém recua!', 'Por {reino} e pela glória!'],
  charge: ['Ataquem!', 'À carga!', 'Por {reino}!'],
  rout: ['Recuar! Recuar!', 'Fujam! A linha caiu!', 'Salve-se quem puder!'],
  breach: ['Uma brecha na muralha! Avante!', 'A muralha cedeu! Para dentro!'],
  gate: ['O portão caiu! Para dentro!', 'O portão cedeu!'],
  tower: ['A rampa desceu! Para a muralha!', 'Subam! Tomem o adarve!'],
};

// ---------- the war camp pieces (content/buildings.js war_tent / war_banner; never built by players) ----------
export const CAMP = { tents: 4, banners: 3, fires: 2 };
