// The economy of the kingdoms (docs/REINOS.md §6 / "Fase 2 — economia"): pure data, no game imports.
// Goods traded in the settlements' markets, reputation ranks, job kinds, property prices and the numbers of the
// supply-and-demand model. Every player-facing string in pt-BR.

// ---------- money ----------
export const COIN = 'coin';        // the gold coin (content/items.js): an inventory item
export const PARCEL = 'parcel';    // a delivery job's parcel (content/items.js)

// ---------- goods ----------
// [item id, base price (coins), category, reference stock of a village of ~50 people]
// The reference stock (demand) scales with the settlement's population; prices come from stock vs that reference.
// base prices (coins) by how RARE what goes into a good is, not by how long it takes to make (owner, 5/11/2026: "coletar
// arbusto dá muita fibra, por isso [a corda] deve valer pouco … uma árvore dá até 4 madeiras … não é questão de tempo de
// fabricação e sim a raridade dos recursos"): a made good ≈ 1.15 × the market value of its recipe. Categories: what kind of
// place trades it (TRADE below). New goods go at the END (the markets' saved stocks are kept by index).
export const GOODS = [
  ['wheat', 8, 'food', 60], ['potato', 6, 'food', 50], ['corn', 6, 'food', 50], ['meat', 12, 'food', 40], ['fish_raw', 10, 'food', 30],
  ['bread', 24, 'food', 30], ['stew', 14, 'food', 12],
  ['wood', 6, 'raw', 80], ['stone', 5, 'raw', 80], ['cotton', 9, 'raw', 30], ['wool', 12, 'raw', 30], ['leather', 24, 'raw', 20],
  ['herb', 14, 'raw', 16], ['coal', 12, 'raw', 30],
  ['copper_ore', 14, 'ore', 30], ['iron_ore', 22, 'ore', 30], ['gold_ore', 60, 'ore', 8], ['jade', 140, 'ore', 4],
  ['rope', 2, 'craft', 24], ['cloth', 31, 'craft', 18], ['stone_block', 9, 'craft', 30], ['copper_bar', 40, 'craft', 14],
  ['iron_bar', 55, 'craft', 14], ['steel_bar', 95, 'craft', 6], ['gold_bar', 145, 'craft', 4],
  ['arrow', 1, 'arms', 120], ['axe_iron', 140, 'tools', 3], ['pickaxe_iron', 205, 'tools', 3], ['sword_iron', 290, 'arms', 3],
  ['spear_iron', 145, 'arms', 3], ['bow_wood', 30, 'arms', 4], ['shield_iron', 330, 'arms', 2], ['armor_leather', 170, 'arms', 3],
  ['armor_iron', 690, 'arms', 2], ['helmet_iron', 345, 'arms', 2], ['saddle', 155, 'arms', 2],
  ['coat_fur', 145, 'cloth', 3], ['hat_fur', 55, 'cloth', 4], ['tunic_cloth', 145, 'cloth', 4],
  // copper (owner: "falta também a armadura de cobre e ferramentas de cobre")
  ['knife_copper', 55, 'tools', 3], ['axe_copper', 105, 'tools', 3], ['pickaxe_copper', 150, 'tools', 3], ['shovel_copper', 105, 'tools', 3],
  ['spear_copper', 115, 'arms', 3], ['sword_copper', 220, 'arms', 3], ['shield_copper', 200, 'arms', 2], ['helmet_copper', 210, 'arms', 2],
  ['armor_copper', 420, 'arms', 2],
];
export const NG = GOODS.length;
export const GI = Object.fromEntries(GOODS.map((g, i) => [g[0], i])); // item id → good index
export const GOOD_CATS = [['food', 'Comida'], ['raw', 'Matérias-primas'], ['ore', 'Minérios e gemas'], ['craft', 'Ofícios'], ['tools', 'Ferramentas'], ['arms', 'Armas e armaduras'], ['cloth', 'Roupas']];
// what each kind of place trades (owner, 5/11/2026 — Mount & Blade's logic: "vilas não têm coisas avançadas"): a VILLAGE the
// simple civil goods (and the ores of its own mine); a CITY everything civil — finer food, clothes, building, tools, bars,
// gems, besides the simple goods; a CASTLE the military goods, the materials of arms and the soldiers' rations. So the
// advanced goods are sold in the cities (a reason to travel there, even to live there) and arms in the castles.
export const TRADE = {
  village: new Set(['wheat', 'potato', 'corn', 'meat', 'fish_raw', 'bread', 'wood', 'stone', 'cotton', 'wool', 'leather', 'herb', 'coal', 'rope']),
  villageMine: new Set(['copper_ore', 'iron_ore', 'gold_ore', 'jade']), // (a village with a mine: its ores too)
  castleRations: new Set(['meat', 'bread', 'wood', 'stone', 'leather', 'copper_bar', 'iron_bar', 'steel_bar']), // (+ every 'arms' good)
};
export const CROP_GOOD = { wild_wheat: 'wheat', wild_potato: 'potato', wild_corn: 'corn', wild_cotton: 'cotton' };
export const CROP_PT = { wheat: 'trigo', potato: 'batata', corn: 'milho', cotton: 'algodão' };
export const SPECIES_GOODS = { sheep: [['wool', 1.5], ['meat', 0.5]], cow: [['meat', 1], ['leather', 1]], pig: [['meat', 1.2]], chicken: [['meat', 0.4]] };

// ---------- the price model ----------
// price factor of a good at stock S with reference R: 0.3 + 0.7·(R + K)/(S + K), K = max(2, R/4), kept in [0.3, 3.2]
// (only + − × ÷: the same on every engine). Buying pays ×(1 + BUY_FEE − discount), selling gets ×(1 − SELL_FEE + discount).
export const PRICE = { lo: 0.3, hi: 3.2, k: 0.25, buyFee: 0.05, sellFee: 0.15 };
// the daily market: the stock drifts toward its balance point E (RELAX of the gap a day), a little noise, slow spreading
// to the neighbouring markets of the same land (DIFFUSE of the ratio gap a day, NEIGH nearest within NEIGH_D tiles)
export const MARKET = { relax: 0.14, noise: 0.04, diffuse: 0.05, neigh: 4, neighD: 1400, eLo: 0.32, eHi: 2.6, w: 0.8 };
// food by season (the balance point of crops: winter scarcity, the autumn harvest); warm clothes in winter
export const SEASON_FOOD = { spring: 0.85, summer: 1.0, autumn: 1.35, winter: 0.5 };
export const SEASON_MEAT = { spring: 0.95, summer: 1.0, autumn: 1.1, winter: 0.8 };
export const CROP_FOODS = new Set(['wheat', 'potato', 'corn', 'bread']);
export const WARM_CLOTHES = new Set(['coat_fur', 'hat_fur']);
// market news: a glut or a shortage of one good in one place for a few days (host rolls 2 a day)
export const EVENTS = { perDay: 2, days: [3, 5], glut: 0.45, short: 2.1 };

// ---------- reputation ----------
export const RANKS = [
  { min: 0, name: 'Desconhecido', disc: 0 },
  { min: 25, name: 'Conhecido', disc: 0.01 },
  { min: 100, name: 'Respeitado', disc: 0.02 },
  { min: 300, name: 'Honrado', disc: 0.03 },
  { min: 700, name: 'Herói do Reino', disc: 0.05 },
];
export const rankOf = (rep) => { let k = 0; for (let i = 0; i < RANKS.length; i++) if ((rep | 0) >= RANKS[i].min) k = i; return k; };
// negative reputation (phase 3a, owner's rule — docs/REINOS.md §10 "Reputação herdada"): trade is still allowed, at worse
// prices (buy × (1 + buy), sell × (1 − sell)); no joining the kingdom, no houses / plots there. Negative is not enemy.
export const BAD_RANKS = [
  { max: -1, floor: -24, name: 'Desconfiado', buy: 0.2, sell: 0.2 },
  { max: -25, floor: -99, name: 'Malvisto', buy: 0.5, sell: 0.4 },
  { max: -100, floor: -200, name: 'Odiado', buy: 1, sell: 0.6 },
];
export const badRankOf = (rep) => ((rep | 0) >= 0 ? -1 : (rep | 0) <= -100 ? 2 : (rep | 0) <= -25 ? 1 : 0);
export const rankName = (rep) => { const b = badRankOf(rep); return b >= 0 ? BAD_RANKS[b].name : RANKS[rankOf(rep)].name; };
// a band index that orders every band (negative ones below 0) — for "up / down a band" notices
export const bandOf = (rep) => { const b = badRankOf(rep); return b >= 0 ? -1 - b : rankOf(rep); };
// joining a kingdom: its relations become the player's reputation with every other kingdom (replacing the old values)
export const INHERIT = { ally: 40, truce: -15, war: -60, neutral: 0 };
export const REP = { tradeCoins: 60, tradeDayCap: 10, abandon: -3, fail: -2, seized: -15, buyRank: 1 };

// ---------- jobs ----------
export const JOB_MAX = 3; // active jobs per player
export const JOB_KINDS = {
  harvest: { name: 'Colheita', icon: '🌾' },
  mine: { name: 'Mina', icon: '⛏️' },
  chop: { name: 'Lenha', icon: '🪓' },
  bring: { name: 'Encomenda', icon: '📦' },
  deliver: { name: 'Entrega', icon: '🐎' },
  hunt: { name: 'Caça', icon: '🏹' },
  defend: { name: 'Defesa', icon: '🛡️' },
};
// first names of the job givers (when the townsfolk agent has no game.towns.people yet)
export const GIVER_NAMES = ['Ana', 'Bento', 'Clara', 'Duarte', 'Elvira', 'Fausto', 'Graça', 'Horácio', 'Inês', 'Joaquim', 'Leonor', 'Matias',
  'Nuno', 'Olga', 'Paulo', 'Quitéria', 'Rui', 'Sancha', 'Tomé', 'Úrsula', 'Vasco', 'Zulmira', 'Afonso', 'Brites', 'Caetano', 'Dulce',
  'Estêvão', 'Filipa', 'Gaspar', 'Helena', 'Isaura', 'Jacinto', 'Lourenço', 'Mafalda', 'Noémia', 'Odete', 'Pedro', 'Rosa', 'Simão', 'Teresa'];

// ---------- properties ----------
export const HOME_KEYS = { house_s: 700, house_s2: 750, cottage_stone: 900, house_m: 1100, house_stone: 1300, house_l: 1500, farmhouse: 1400, townhouse: 1900 };
export const PROP = {
  cityK: 1.6,            // a city's prices × this
  rentDay: 0.07,         // daily rent: at least price × this …
  rentVsTax: 4,          // … and at least this × the daily tax an owner pays (owner: renting must cost far more than owning)
  sellBack: 0.6,         // selling back to the kingdom
  plotSizes: [8, 6],     // plot sides (tiles): the big ones first, then smaller ones in what is left
  plotPrice: { village: 400, city: 900 }, // (an 8 × 8 plot; a smaller one in proportion)
  sale: { village: 2, city: 4 }, rent: { village: 1, city: 3 }, plots: { village: 6, city: 10 },
  taxLo: 0.01, taxHi: 0.024, // the kingdoms' daily tax: a share of the property's value
  warnDays: 3,           // days of warning before the kingdom takes a property back
};
