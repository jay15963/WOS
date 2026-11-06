// Skirmish ("Escaramuça", docs/SKIRMISH.md): the numbers and the texts. Pure data (no game imports): game/skirmish.js
// plays it, ui/skirmish.js shows it.

// the arena world: a planet of this seed (its start village Estrosa has a palisade; castles, open villages and the capital
// near it) — a fresh copy every time, never saved
export const SEED = 4242;

// ---------- the settings of a match (the lobby; the host sets them) ----------
export const MODES = {
  field:    { pt: 'Batalha em campo', sub: 'Dois exércitos em campo aberto: linhas, flechas, o choque.' },
  siege:    { pt: 'Cerco', sub: 'Atacantes com acampamento e máquinas contra um lugar com muralhas e guarda.' },
  monsters: { pt: 'Defesa contra monstros', sub: 'Uma noite de inverno: a onda de monstros contra os defensores.' },
};
export const MODE_LIST = ['field', 'siege', 'monsters'];
// the place of a siege / a monster defense: a real settlement of the realm (the nearest of that kind to the start)
export const PLACES = {
  village:  { pt: 'Vila sem paliçada', sub: 'Aberta: os guardas formam na borda.', kind: 'village', walls: null },
  palisade: { pt: 'Vila com paliçada', sub: 'Paliçada de toras com portões.', kind: 'village', walls: 'palisade' },
  castle:   { pt: 'Castelo', sub: 'Muralhas de pedra, torres e uma guarnição.', kind: 'castle', walls: 'stone' },
  city:     { pt: 'Cidade', sub: 'A capital: muralha alta, balistas, muita guarda.', kind: 'city', walls: 'stone' },
};
export const PLACE_LIST = ['village', 'palisade', 'castle', 'city'];
// the monster families of the defense (game/undead.js FAMILY: the creature and its giant)
export const FAMS = {
  ice:  { pt: 'Andarilhos do Gelo', giantPt: 'Gigante de Gelo', mob: 'walker', giant: 'giant' },
  bone: { pt: 'Esqueletos', giantPt: 'Gigante Esqueleto', mob: 'skeleton', giant: 'skeleton_giant' },
  sand: { pt: 'Múmias', giantPt: 'Múmia Gigante', mob: 'mummy', giant: 'mummy_giant' },
};
export const FAM_LIST = ['ice', 'bone', 'sand'];
export const DEFAULTS = { mode: 'field', place: 'palisade', fam: 'ice', total: 120, pa: 50 };
// the sliders: soldiers in the battle (both sides together; 0 = only the players: PvP in the field) and the share of
// side A in % (in the monster defense side A is the monsters: the share of the defenders is 100 − pa)
export const TOTAL = { min: 0, max: 300, step: 10, minNpc: 10 }; // (a siege / a monster defense needs ≥ 10)
export const SHARE = { min: 5, max: 95, step: 5 };
// "quanto mais monstros mais gigantes": one giant for every 25 monsters (at least one from 20), at most 12 — the giants
// are part of the monsters' number
export const GIANT = { from: 20, every: 25, max: 12 };
export const giantsFor = (n) => (n < GIANT.from ? 0 : Math.min(GIANT.max, Math.max(1, Math.floor(n / GIANT.every))));
// the soldiers of each side from the sliders: both ≥ 1 when there are soldiers at all
export function sidesOf(total, pa) {
  const t = Math.max(0, Math.round(total) | 0);
  if (!t) return [0, 0];
  let a = Math.round((t * pa) / 100);
  if (t >= 2) a = Math.min(t - 1, Math.max(1, a));
  return [a, t - a];
}

// ---------- the players: a side and a class ----------
// players wear IRON armour and STEEL weapons; the archer the composite bow (the bow made with a steel bar) — owner's
// rule (5/11/2026): no new items, the existing ones
export const CLASSES = {
  archer: { pt: 'Arqueiro', kitPt: 'Arco composto · armadura e elmo de ferro', main: 'bow_composite', off: null, body: 'armor_iron', head: 'helmet_iron' },
  spear:  { pt: 'Lanceiro', kitPt: 'Lança de aço · armadura e elmo de ferro', main: 'spear_steel', off: null, body: 'armor_iron', head: 'helmet_iron' },
  sword:  { pt: 'Espadachim', kitPt: 'Espada de aço · escudo, armadura e elmo de ferro', main: 'sword_steel', off: 'shield_iron', body: 'armor_iron', head: 'helmet_iron' },
};
export const CLASS_LIST = ['archer', 'spear', 'sword'];
export const BAG = { arrow: 99, arrowLow: 40, herb: 4 }; // (arrows topped up while it lasts: the archer never runs dry)
// the NPC soldiers of both sides: COPPER armour and weapons (owner), the archers the simple bow; the armour is worn under
// the kingdom's tabard (only the helmet shows — the sides read by their colours), the sword ones carry the kingdom's
// shield with a copper shield's protection
export const NPC_KIT = {
  weapon: { spear: 'spear_copper', sword: 'sword_copper', archer: 'bow_wood', eng: 'axe_copper', general: 'sword_copper' },
  body: 'armor_copper', head: 'helmet_copper', shield: { sword: 'shield_copper' }, shieldLook: 'shield_guard',
};
// levels during a match (the arena is a throwaway world: the players' own levels never change)
export const LEVEL = { player: 12, soldier: 10, monster: 10, giant: 12, guards: 10 };

// ---------- the match ----------
export const MATCH = {
  count: 5,          // s: the countdown before the fight
  respawn: 8,        // s: a fallen player waits, then comes back at its side's rear with its whole kit
  prepMax: 45,       // s: the place still not made here — start anyway
  limit: { field: 720, siege: 900, monsters: 720 }, // s: the time limit of a match
  pvpKills: 10,      // a field battle with no soldiers (players only): the first side to this many kills
  overrunT: 15,      // s: monsters holding the plaza with no defender around → the place falls
  plazaR: 7, defR: 13,
  endShow: 3,        // s after the end before the results come up (the last blows, the shout)
  hour: { day: 10, night: 22 },
  scoreEvery: 1,     // s: the scoreboard on every peer at most this often
};
// live creatures at once (performance, docs/SKIRMISH.md): 3b's caps raised in a skirmish by the device's quality;
// the rest of each side are reserves that step in as the live ones fall
export const CAPS = {
  high:   { total: 120, side: 64, siege: 72, monsters: 60 },
  medium: { total: 96, side: 52, siege: 60, monsters: 48 },
  low:    { total: 56, side: 30, siege: 34, monsters: 30 },
};

// ---------- texts ----------
export const SIDE_PT = { a: 'Lado A', b: 'Lado B' };
export const ROLE_PT = {
  field: { a: 'Exército A', b: 'Exército B' },
  siege: { a: 'Atacantes', b: 'Defensores' },
  monsters: { a: 'Monstros', b: 'Defensores' },
};
export const END_PT = {
  rout: (loser) => `O exército do Reino de ${loser} debandou`,
  wiped: (loser) => `O exército do Reino de ${loser} caiu inteiro`,
  taken: (place, k) => `${place} foi tomada pelo Reino de ${k}`,
  repelled: (place) => `${place} resistiu ao cerco`,
  wave: (fam) => `A onda de ${fam} foi destruída`,
  overrun: (place) => `${place} caiu diante dos monstros`,
  fallen: (place) => `Os defensores de ${place} caíram`,
  time: 'O tempo acabou',
  pvp: (n) => `Primeiro lado a ${n} abates`,
  leftAlone: 'Todos os jogadores de um lado saíram',
};
