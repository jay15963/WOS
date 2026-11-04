// Kingdoms (docs/REINOS.md): procedural Portuguese-flavoured fantasy names, kingdom colours and banners (heraldry).
// Pure data + a seeded rng (the realm generator passes its own): every peer makes the same names from the seed.
// Real places are avoided: syllable combinations are unusual and a blacklist of real town / city names is skipped.

const PRE = ['Val', 'Mont', 'Ser', 'Cor', 'Brav', 'Tor', 'Aren', 'Mir', 'Fal', 'Gal', 'Ros', 'Tar', 'Ven', 'Sol', 'Lun', 'Pedr', 'Ferr',
  'Our', 'Prat', 'Ard', 'Esc', 'Cal', 'Rib', 'Font', 'Vid', 'Lor', 'Var', 'Dor', 'Quel', 'Zar', 'Avel', 'Orn', 'Brum', 'Cerv', 'Garç', 'Lanç',
  'Alv', 'Sarg', 'Brez', 'Carv', 'Fen', 'Jar', 'Lob', 'Murt', 'Nev', 'Pinh', 'Rocel', 'Silv', 'Tavr', 'Urz', 'Vagu', 'Zimbr', 'Crast', 'Morg',
  'Estr', 'Gued', 'Infan', 'Medr', 'Ocar', 'Rabel', 'Sobr', 'Teix', 'Arv', 'Beir', 'Cambr', 'Darv', 'Ervel', 'Fragu', 'Gral', 'Hort'];
const MID = ['a', 'e', 'o', 'i', 'an', 'en', 'or', 'ar', 'el', 'al', 'ou', 'ei', 'u', 'ad', 'ed', 'iv', 'ov'];
const K_SUF = ['ória', 'ânia', 'alis', 'enor', 'ásia', 'ulha', 'ena', 'ovar', 'aris', 'ândia', 'estra', 'ônia', 'arve', 'elha', 'unda', 'éria', 'ídia', 'ondra'];
const S_SUF = ['ela', 'inha', 'eira', 'ais', 'edo', 'al', 'ada', 'ura', 'im', 'oso', 'ança', 'ares', 'elo', 'udo', 'ouça', 'ena', 'osa', 'ide', 'ães', 'ilde',
  'ouro', 'unho', 'aval', 'erna', 'ival', 'olha'];
const C_SUF = ['amar', 'alva', 'ândor', 'ástra', 'ônia', 'ival', 'erra', 'ola', 'ana', 'ória', 'icor', 'ásia', 'elar'];
const FEAT = ['do Vale', 'da Serra', 'das Pedras', 'do Rio', 'da Ponte', 'dos Moinhos', 'das Fontes', 'do Campo', 'da Mata', 'do Monte', 'da Cruz',
  'das Flores', 'do Lago', 'da Encosta', 'dos Pinhais', 'do Vau', 'das Vinhas', 'do Outeiro', 'da Charneca', 'dos Freixos'];
const CASTLE = ['Castelo de', 'Fortaleza de', 'Torre de', 'Castelo de', 'Forte de', 'Bastião de'];

// real places (Portugal, Brazil and around) that a syllable combination could hit: never used
const REAL = new Set(['lisboa', 'porto', 'braga', 'coimbra', 'évora', 'faro', 'viseu', 'leiria', 'aveiro', 'guarda', 'beja', 'setúbal', 'sintra', 'valença',
  'montalegre', 'monsanto', 'belmonte', 'alvorada', 'altamira', 'valinhos', 'marília', 'ourinhos', 'pedreira', 'fontela', 'cascais', 'mirandela',
  'torres', 'ferreira', 'silva', 'serra', 'santos', 'belém', 'natal', 'vitória', 'palmas', 'salvador', 'campinas', 'sorocaba', 'valadares', 'varginha',
  'lavras', 'ribeirão', 'mariana', 'sabará', 'diamantina', 'petrópolis', 'teresópolis', 'friburgo', 'valongo', 'gondomar', 'feira', 'tavira', 'olhão',
  'lagos', 'silves', 'loulé', 'elvas', 'estremoz', 'mértola', 'moura', 'serpa', 'tomar', 'abrantes', 'ourém', 'fátima', 'nazaré', 'óbidos', 'peniche',
  'mafra', 'loures', 'amadora', 'oeiras', 'almada', 'seixal', 'barreiro', 'palmela', 'sesimbra', 'alcobaça', 'batalha', 'pombal', 'tondela', 'lamego',
  'chaves', 'bragança', 'mirandela', 'vinhais', 'melgaço', 'monção', 'arcos', 'barcelos', 'esposende', 'fafe', 'felgueiras', 'amarante', 'marco',
  'penafiel', 'paredes', 'valença', 'caminha', 'ponte', 'ovar', 'espinho', 'murtosa', 'ílhavo', 'vagos', 'mira', 'cantanhede', 'arganil', 'gouveia',
  'seia', 'covilhã', 'fundão', 'sertã', 'nisa', 'marvão', 'avis', 'mora', 'alter', 'crato', 'sousel', 'arronches', 'campo', 'maia', 'trofa', 'vizela',
  'brasília', 'goiânia', 'manaus', 'recife', 'fortaleza', 'curitiba', 'florianópolis', 'londrina', 'maringá', 'cascavel', 'toledo', 'franca', 'bauru',
  'jundiaí', 'americana', 'limeira', 'piracicaba', 'itu', 'tatuí', 'avaré', 'assis', 'garça', 'tupã', 'osasco', 'barueri', 'cotia', 'itapeva', 'iguape',
  'cananéia', 'ubatuba', 'paraty', 'angra', 'resende', 'volta', 'macaé', 'campos', 'itaperuna', 'muriaé', 'viçosa', 'ubá', 'barbacena', 'conselheiro',
  'mariana', 'congonhas', 'itabira', 'caratinga', 'governador', 'teófilo', 'januária', 'pirapora', 'paracatu', 'unaí', 'patos', 'araxá', 'uberaba',
  'uberlândia', 'ituiutaba', 'frutal', 'passos', 'alfenas', 'pouso', 'itajubá', 'cruzeiro', 'lorena', 'guaratinguetá', 'aparecida', 'taubaté',
  'jacareí', 'mogi', 'santana', 'cachoeira', 'feira', 'ilhéus', 'itabuna', 'jequié', 'barreiras', 'juazeiro', 'petrolina', 'caruaru', 'garanhuns',
  'mossoró', 'sobral', 'crato', 'iguatu', 'caxias', 'imperatriz', 'marabá', 'santarém', 'altamira', 'castanhal', 'parintins', 'tefé', 'macapá',
  'boavista', 'cuiabá', 'rondonópolis', 'sinop', 'dourados', 'corumbá', 'anápolis', 'catalão', 'pelotas', 'canoas', 'gramado', 'bento', 'erechim',
  'chapecó', 'joinville', 'blumenau', 'itajaí', 'lages', 'tubarão', 'criciúma', 'valência', 'sevilha', 'granada', 'toledo', 'córdoba', 'navarra',
  'aragão', 'castela', 'leão', 'galiza', 'astúrias', 'andorra', 'mônaco', 'veneza', 'florença', 'milão', 'turim', 'gênova', 'verona', 'pádua']);

const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// join syllables: no doubled vowels across the joint, no 'aa' / 'oo'
function join(a, b) {
  const V = /[aeiouáéíóúâêôãõ]/;
  if (V.test(a.slice(-1)) && V.test(b.charAt(0))) return a + b.slice(1);
  return a + b;
}
function word(r, suf, mid = 0.45) {
  let w = pick(r, PRE);
  if (r() < mid) w = join(w, pick(r, MID));
  return cap(join(w, pick(r, suf)).toLowerCase().replace(/([aeiou])/g, '$1'));
}

// a name generator that never repeats itself (one per realm)
export function makeNamer(r) {
  const used = new Set();
  const fresh = (fn) => {
    for (let k = 0; k < 40; k++) {
      const s = fn();
      const key = s.toLowerCase();
      if (used.has(key) || REAL.has(key) || REAL.has(key.split(' ')[0]) || s.length < 4 || s.length > 18) continue;
      used.add(key);
      return s;
    }
    const s = fn() + ' ' + (used.size + 1);
    used.add(s.toLowerCase());
    return s;
  };
  return {
    kingdom: () => fresh(() => word(r, K_SUF, 0.3)),
    city: () => fresh(() => word(r, C_SUF, 0.35)),
    village: () => fresh(() => (r() < 0.22 ? `${word(r, S_SUF, 0.25)} ${pick(r, FEAT)}` : word(r, S_SUF, 0.4))),
    castle: () => fresh(() => `${pick(r, CASTLE)} ${word(r, S_SUF, 0.3)}`),
  };
}

// ---------- colours and banners ----------
// 30 distinct kingdom colours (sRGB 0..255): the territory on the map, the banner field, banners in the world
export const KINGDOM_COLORS = [
  [178, 42, 46], [36, 82, 168], [40, 130, 64], [196, 150, 30], [116, 54, 140], [210, 104, 32], [24, 128, 140], [140, 28, 74],
  [86, 108, 40], [58, 58, 70], [170, 70, 120], [44, 104, 104], [150, 90, 40], [96, 64, 168], [196, 66, 66], [64, 150, 200],
  [120, 150, 40], [200, 120, 150], [90, 40, 30], [30, 70, 110], [170, 170, 60], [130, 40, 40], [50, 160, 120], [160, 110, 200],
  [220, 170, 90], [70, 90, 60], [180, 90, 90], [100, 130, 170], [140, 60, 20], [80, 120, 90],
];
export const METALS = { or: [232, 196, 82], argent: [236, 236, 228] };
export const DIVISIONS = ['plain', 'per_pale', 'per_fess', 'per_bend', 'quarterly', 'chevron', 'cross', 'saltire', 'bend', 'fess', 'pale', 'chief', 'bordure'];
export const CHARGES = ['star', 'tower', 'crown', 'roundel', 'crescent', 'lozenge', 'key', 'tree', 'wheat', 'sword', 'none'];
export const DIVISIONS_PT = { plain: 'liso', per_pale: 'partido', per_fess: 'cortado', per_bend: 'fendido', quarterly: 'esquartelado', chevron: 'asna', cross: 'cruz',
  saltire: 'aspa', bend: 'banda', fess: 'faixa', pale: 'pala', chief: 'chefe', bordure: 'bordadura' };
export const CHARGES_PT = { star: 'estrela', tower: 'torre', crown: 'coroa', roundel: 'besante', crescent: 'crescente', lozenge: 'losango', key: 'chave',
  tree: 'árvore', wheat: 'feixe de trigo', sword: 'espada', none: '' };

// a banner: { f: field colour [r,g,b], m: metal 'or'|'argent', d: division, c: charge, c2: second colour (divisions) }
export function makeBanner(r, color, others) {
  const m = r() < 0.55 ? 'or' : 'argent';
  const d = pick(r, DIVISIONS), c = pick(r, CHARGES);
  const c2 = others[Math.floor(r() * others.length) % others.length];
  return { f: color, m, d, c, c2 };
}
