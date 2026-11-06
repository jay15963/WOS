// The people of the settlements (docs/REINOS.md "Fase 2 — moradores e guardas"): numbers, trades, names, clothes and
// the lines they say. Pure data (no game imports): game/people.js makes the identities from it and the seed.

// ---------- numbers ----------
export const PEOPLE = {
  // creatures made near the players, per settlement (the rest stay indoors / away: counts only)
  cap: { village: 40, castle: 30, city: 60 },
  matR: 46,        // tiles: a person whose place is this near a player becomes a creature
  dropR: 58,       // tiles: farther than this from every player (and out of sight) it goes back to being a count
  indoorR: 11,     // tiles: people inside a building show when a player is this near it (in bed at night…)
  tick: 0.5,       // s: the host's population tick (who should be out, spawns, despawns)
  spawnPerTick: 6, // creatures made per tick (the first visit spreads over a few ticks)
  farK: 3,         // AI of a creature far from every player (> nearR) runs every farK-th frame
  nearR: 30,
  pathBudget: 2,   // town paths (A*) a frame
  // the day (game hours; jittered per person): wake, leave home, work until, home by, asleep
  wake: [5.6, 6.6], leave: [6.3, 7.4], workEnd: [16.6, 17.8], homeBy: [18.6, 19.35], bed: 20.2,
  regrowDays: 1.5, // a dead person is replaced after this many days
  // guards
  guardSight: 15, guardLeash: 12, archerRange: 13, alarmR: 6, // (alarmR: tiles past the town land a hostile still counts)
  // the bell keeps ringing while a hostile that came that close (or attacks the place) is alive within the town land + alarmHold
  // tiles and was close / attacking in the last alarmMemory seconds — the threat neutralized, not just out of sight (owner)
  alarmHold: 30, alarmMemory: 40,
  repairStep: { wood: 0.12, stone: 0.07, siege: 0.03 }, repairEvery: 2.2, rebuildS: 9,
  // the defense when the bell rings (game/defense.js): how far from its post a guard goes after a foe (tiles), how many
  // hold a gap in the walls, the reserve by the keep (share of the melee guards: cities / castles), the guards that hunt
  // each foe already inside the walls, the most ballista crews (share of the melee guards)
  // front: the alignment with the attack's side above which a gate / a stretch / a wall-walk spot is "the side under attack"
  spearMin: 4.5, // tiles: a spear guard throws its spear (npcLob.js, up to 8) only at a foe at least this far (game/npc.js)
  def: { front: 0.45, holdR: { gate: 7, stretch: 8, gap: 5, reserve: 0 }, gap: 2, gapWide: 3, gapCalm: 1, reserve: { city: 0.15, castle: 0.12 }, hunters: 2, crews: 0.34,
         towerK: 0.2, towerMin: 2, towerMax: 4 }, // (towerK: the share of the melee guards up on the walk where a siege tower comes, between towerMin and towerMax — defense.js)
};

// ---------- trades ----------
// pt: [male, female] name of the trade · act: the work animation · carry: what it carries between spots ·
// where: 'field' | 'pen' | 'station' (a station of its workplace) | 'plaza' | 'woods' | 'home' · tools: held while working
export const JOBS = {
  farmer:     { pt: ['Lavrador', 'Lavradora'], act: 'dig', acts: ['dig', 'plant', 'harvest'], carry: 'wheat', where: 'field' },
  herder:     { pt: ['Pastor', 'Pastora'], act: 'gather', carry: 'wheat', where: 'pen' },
  smith:      { pt: ['Ferreiro', 'Ferreira'], act: 'build', carry: 'iron_bar', where: 'station', work: 'Ferreiro' },
  woodcutter: { pt: ['Lenhador', 'Lenhadora'], act: 'chop', carry: 'wood', where: 'station', work: 'Lenhador' },
  miner:      { pt: ['Mineiro', 'Mineira'], act: 'mine', carry: 'stone', where: 'station', work: 'Mineiro' },
  weaver:     { pt: ['Tecelão', 'Tecelã'], act: 'craft', carry: 'cloth', where: 'station', work: 'Tecelão' },
  innkeeper:  { pt: ['Taverneiro', 'Taverneira'], act: 'cook', carry: 'bread', where: 'station', work: 'Taverneiro' },
  priest:     { pt: ['Padre', 'Madre'], act: 'cast', where: 'station', work: 'Sacerdote' },
  groom:      { pt: ['Cavalariço', 'Cavalariça'], act: 'gather', carry: 'wheat', where: 'station', work: 'Cavalariço' },
  porter:     { pt: ['Carregador', 'Carregadora'], act: 'carry', carry: 'wheat', where: 'station', work: 'Armazém' },
  lord:       { pt: ['Senhor do castelo', 'Senhora do castelo'], act: null, where: 'station', work: 'Senhor' },
  merchant:   { pt: ['Mercador', 'Mercadora'], act: 'talk', carry: 'cloth', where: 'plaza' },
  homemaker:  { pt: ['Morador', 'Moradora'], act: 'carry', carry: 'bread', where: 'home' },
  child:      { pt: ['Menino', 'Menina'], act: null, where: 'plaza' },
  elder:      { pt: ['Ancião', 'Anciã'], act: null, where: 'plaza' },
  guard:      { pt: ['Guarda', 'Guarda'], act: null, where: 'post', guard: true },
  archer:     { pt: ['Arqueiro', 'Arqueira'], act: null, where: 'post', guard: true },
};
// the workplace hooks of a layout (hooks.work name) → the trade that works there
export const WORK_JOB = { Ferreiro: 'smith', Lenhador: 'woodcutter', Mineiro: 'miner', Tecelão: 'weaver', Taverneiro: 'innkeeper', Sacerdote: 'priest', Cavalariço: 'groom', Armazém: 'porter', Senhor: 'lord', Guarda: 'guard' };
// people per workplace (a station spot each, at most)
export const WORK_N = { Ferreiro: 2, Lenhador: 2, Mineiro: 3, Tecelão: 2, Taverneiro: 2, Sacerdote: 1, Cavalariço: 1, Armazém: 2, Senhor: 1, Guarda: 0 };
// guards per settlement kind (+ per 100 people for cities), archers among them
export const GUARDS = { village: 6, castle: 0.72, city: 0.15 }; // (village: a number; castle / city: a share of the population)
export const ARCHER_SHARE = { village: 0.34, castle: 0.42, city: 0.4 };

// ---------- names (Portuguese-flavoured, medieval; invented bynames) ----------
export const NAMES_M = ['Afonso', 'Álvaro', 'Bento', 'Brás', 'Diogo', 'Duarte', 'Estêvão', 'Fernão', 'Gil', 'Gonçalo', 'Henrique', 'Jácome', 'Joaquim',
  'Lopo', 'Lourenço', 'Martim', 'Mem', 'Nuno', 'Paio', 'Pedro', 'Rodrigo', 'Rui', 'Sancho', 'Simão', 'Tomé', 'Tristão', 'Vasco', 'Vicente', 'Zacarias',
  'Aires', 'Baltasar', 'Crispim', 'Damião', 'Egas', 'Fradique', 'Garcia', 'Inácio', 'Leonel', 'Matias', 'Olavo', 'Quirino', 'Silvestre', 'Teodoro', 'Urbano'];
export const NAMES_F = ['Beatriz', 'Brites', 'Catarina', 'Constança', 'Filipa', 'Guiomar', 'Inês', 'Isabel', 'Joana', 'Leonor', 'Margarida', 'Mécia',
  'Teresa', 'Urraca', 'Violante', 'Aldonça', 'Branca', 'Clara', 'Elvira', 'Graça', 'Helena', 'Luzia', 'Madalena', 'Maria', 'Marta', 'Rosa', 'Sancha',
  'Úrsula', 'Vitória', 'Amélia', 'Benedita', 'Cecília', 'Dulce', 'Esperança', 'Florência', 'Genoveva', 'Irene', 'Josefa', 'Lucinda', 'Natália'];
export const BYNAMES = ['da Fonte', 'do Moinho', 'da Ponte', 'do Outeiro', 'da Eira', 'do Vale', 'da Serra', 'do Poço', 'das Oliveiras', 'do Souto',
  'da Lameira', 'do Ribeiro', 'da Azenha', 'do Carvalhal', 'da Granja', 'do Penedo', 'da Várzea', 'do Cabeço', 'das Hortas', 'do Freixo'];
export const TRADE_BYNAME = { smith: 'Ferreira', woodcutter: 'Lenheiro', miner: 'Mineiro', weaver: 'Tecelão', innkeeper: 'Estalajadeiro', herder: 'Pastor', farmer: 'Lavrador' };

// ---------- clothes by trade ----------
// look overrides for randomLook(seed): lists are picked from (hex colours or catalogue ids); hat: a wear item on the head
const EARTH = ['e6dcc4', 'efe4cc', 'b08a5e', '6e4c32', '6f7444', '8a9a5a', 'a8562c', 'c8a03c', '3e6238', '8e8e8a'];
const DYED = ['b03a30', '7a2a32', '2c3e62', '3e64a0', '2f6a6e', '6a3a5c', 'd8823a', 'e6c85a', '1e8a5a', '6a4a9a', 'c8a03c'];
const LEATHER = ['3c2a1e', '5e3e28', '9a6e44', '242022', '5e2424', 'c0a07a'];
export const DRESS = {
  farmer:     { top: ['tunic', 'peasant', 'shirt', 'laced', 'tee'], topC: EARTH, over: ['overalls', 'none', 'apron', 'none'], overC: ['8a9a5a', '6e4c32', 'b08a5e', '2c3e62'], bottom: ['breeches', 'trousers', 'baggy', 'skirt'], botC: EARTH, shoes: ['boots', 'clogs', 'wraps'], hat: ['hat_straw', 'hat_straw', null] },
  herder:     { top: ['tunic', 'laced', 'sweater'], topC: EARTH, over: ['vest', 'none', 'fur_vest'], overC: LEATHER, bottom: ['trousers', 'breeches', 'wraps'], botC: EARTH, shoes: ['boots', 'moccasins'], hat: ['hat_straw', null, 'hood_leather'] },
  smith:      { top: ['tank', 'shirt', 'henley'], topC: ['8e8e8a', 'e6dcc4', '3e3e40', '6e4c32'], over: ['apron'], overC: ['3c2a1e', '5e3e28', '242022'], bottom: ['trousers', 'baggy'], botC: ['3e3e40', '6e4c32', '262526'], shoes: ['boots', 'tall_boots'], build: ['broad', 'heavy', 'athletic'], hat: [null] },
  woodcutter: { top: ['shirt', 'henley', 'sweater'], topC: ['b03a30', '3e6238', '7a2a32', '2c3e62'], pattern: ['plaid', 'plaid', 'tartan', 'plain'], topC2: ['262526', '3e3e40', 'e6dcc4'], over: ['suspenders', 'vest', 'none'], overC: LEATHER, bottom: ['trousers', 'wraps'], botC: ['6e4c32', '3e3e40', '2c3e62'], shoes: ['tall_boots', 'boots'], build: ['athletic', 'broad'], hat: [null, 'hat_fur'] },
  miner:      { top: ['henley', 'tunic', 'tee'], topC: ['8e8e8a', '6e4c32', '3e3e40', 'b08a5e'], over: ['overalls', 'vest'], overC: ['6e4c32', '3e3e40', '5e3e28'], bottom: ['trousers', 'baggy'], botC: ['3e3e40', '6e4c32'], shoes: ['boots'], build: ['broad', 'athletic', 'average'], hat: ['hood_leather', null] },
  weaver:     { top: ['dress', 'gown', 'wrap', 'peasant', 'shirt'], topC: DYED, pattern: ['embroidered', 'stripes', 'plain', 'flowers', 'diamonds'], topC2: ['e6dcc4', 'e6c85a', 'efe4cc'], over: ['shawl', 'sash', 'none'], overC: DYED, bottom: ['long_skirt', 'skirt', 'trousers'], botC: DYED, shoes: ['shoes', 'sandals'] },
  innkeeper:  { top: ['shirt', 'laced', 'gown'], topC: ['e6dcc4', 'efe4cc', 'f2f0ea', 'b08a5e'], over: ['apron'], overC: ['f2f0ea', 'e6dcc4', 'efe4cc'], bottom: ['trousers', 'skirt'], botC: ['6e4c32', '7a2a32', '2c3e62'], shoes: ['shoes', 'boots'], build: ['heavy', 'broad', 'average'], hat: [null] },
  priest:     { top: ['robe'], topC: ['efe4cc', '6e4c32', '3e3e40', 'f2f0ea'], topC2: ['d8b040', 'e6dcc4'], over: ['sash', 'none'], overC: ['b03a30', 'd8b040', '6a4a9a'], bottom: ['trousers'], botC: ['3e3e40'], shoes: ['sandals', 'shoes'], hat: [null] },
  groom:      { top: ['shirt', 'laced'], topC: EARTH, over: ['vest', 'suspenders'], overC: LEATHER, bottom: ['breeches'], botC: ['b08a5e', '6e4c32'], shoes: ['tall_boots'], hat: [null, 'hat_straw'] },
  porter:     { top: ['tee', 'tunic', 'sleeveless'], topC: EARTH, over: ['vest', 'none'], overC: LEATHER, bottom: ['baggy', 'trousers'], botC: EARTH, shoes: ['boots', 'wraps'], build: ['broad', 'athletic'], hat: [null, 'hat_straw'] },
  lord:       { top: ['jerkin', 'gown'], topC: null, topC2: null, pattern: ['embroidered'], over: ['sash'], overC: null, bottom: ['slim', 'long_skirt'], botC: ['262526', '2c3e62'], shoes: ['tall_boots', 'shoes'], hat: [null] }, // (null: the kingdom's colours)
  merchant:   { top: ['jerkin', 'gown', 'wrap', 'shirt'], topC: ['7a2a32', '2a48b8', '1e8a5a', 'e09a2a', '6a3a5c', 'c01830'], pattern: ['embroidered', 'diamonds', 'plain', 'vstripes'], topC2: ['d8b040', 'e6dcc4', 'e6c85a'], over: ['sash', 'vest', 'none'], overC: ['d8b040', 'e6c85a', '6a3a5c'], bottom: ['slim', 'long_skirt', 'trousers'], botC: ['262526', '2c3e62', '6e4c32'], shoes: ['tall_boots', 'shoes'], hat: [null] },
  homemaker:  { top: ['dress', 'peasant', 'gown', 'shirt', 'laced'], topC: [...EARTH, ...DYED], pattern: ['plain', 'flowers', 'dots', 'patches', 'plaid'], topC2: ['e6dcc4', 'efe4cc'], over: ['apron', 'shawl', 'none'], overC: ['efe4cc', 'e6dcc4', 'b08a5e', ...DYED], bottom: ['long_skirt', 'skirt', 'trousers'], botC: EARTH, shoes: ['shoes', 'clogs', 'sandals'] },
  child:      { top: ['tee', 'peasant', 'dress', 'tunic'], topC: [...DYED, ...EARTH], pattern: ['plain', 'stripes', 'dots', 'patches'], topC2: ['e6dcc4', 'f2f0ea'], over: ['none', 'none', 'overalls', 'suspenders'], overC: ['3e64a0', '6e4c32'], bottom: ['shorts', 'breeches', 'skirt'], botC: EARTH, shoes: ['barefoot', 'sandals', 'shoes'], hat: [null] },
  elder:      { top: ['robe', 'tunic', 'gown', 'sweater'], topC: ['8e8e8a', '6e4c32', '3e3e40', '2c3e62', '6a3a5c'], over: ['shawl', 'vest', 'none'], overC: ['b08a5e', '8e8e8a', '6e4c32'], bottom: ['trousers', 'long_skirt'], botC: ['3e3e40', '6e4c32'], shoes: ['shoes', 'moccasins'], hat: [null] },
  // guards: a tabard in the kingdom's colours over a padded coat, a helmet; archers: a hood
  guard:      { top: ['jerkin', 'sweater'], topC: ['8e8e8a', '3e3e40', '73767b'], topC2: null, pattern: ['plain'], over: ['tabard'], overC: null, bottom: ['trousers', 'slim'], botC: ['3e3e40', '262526', '5e3e28'], shoes: ['tall_boots', 'boots'], build: ['athletic', 'broad', 'average'], hat: ['helmet_iron'] },
  archer:     { top: ['jerkin'], topC: null, topC2: null, pattern: ['plain'], over: ['vest', 'sash'], overC: ['5e3e28', '3c2a1e'], bottom: ['trousers', 'slim'], botC: ['3e6238', '6e4c32', '3e3e40'], shoes: ['tall_boots', 'boots'], build: ['slim', 'average', 'athletic'], hat: ['hood_leather'] },
};

// ---------- what they say (E "Conversar") ----------
// {nome} {vila} {tipo} {reino} {capital} {estacao} {guarda}: filled in. Lines by trade (+ season), the danger, the night,
// the mural (pointing new players to it), and some for everyone.
export const TALK = {
  hello: ['Bom dia!', 'Olá, viajante.', 'Salve!', 'Que bons ventos o trazem?', 'Seja bem-vindo a {vila}.', 'Ora, um rosto novo!'],
  helloNight: ['Ainda acordado? Lá fora não é lugar para ninguém.', 'Psiu… a vila dorme.'],
  bye: ['Até mais!', 'Vá com cuidado.', 'Boa jornada.', 'Volte quando quiser.'],
  mural: [
    'Novo por aqui? O mural na praça conta tudo sobre {vila} e o Reino de {reino}.',
    'Se procura trabalho ou notícias, o mural da praça é o lugar. Toque nele (ou E) para ler.',
    'O mural da praça tem o que há para saber: o lugar, o reino e, logo mais, trabalho pago em ouro.',
  ],
  danger: ['Monstros! Para dentro, depressa!', 'Socorro! Fujam para casa!', 'Ouviu o sino? Corra!', 'Os mortos estão aqui! Feche a porta!'],
  dangerGuard: ['Para trás! Deixe com a guarda!', 'Fique atrás de mim!', 'Às armas! Protejam as casas!', 'Eles não passam do portão!'],
  any: [
    'Dizem que a capital, {capital}, tem muralhas que nem os gigantes derrubam.',
    'De noite, fique perto da luz… mas saiba que a luz também chama os mortos.',
    'Os guardas de {vila} são poucos, mas são bravos.',
    'Quem anda pela estrada de noite não chega ao outro dia. Dizem.',
    'Já viu as bandeiras do Reino de {reino}? Bonitas, não são?',
    'Na praça sempre tem conversa boa — e fofoca melhor ainda.',
  ],
  season: {
    spring: ['Primavera! Tudo brota, até as ervas daninhas.', 'Chuva de primavera é ouro no campo.'],
    summer: ['Calor de rachar! Beba água do poço, é fresquinha.', 'Verão é tempo de fartura. Aproveite.'],
    autumn: ['O outono chegou. Guarde comida, o inverno não perdoa.', 'Folhas no chão, lenha no galpão.'],
    winter: ['Inverno… à noite os Andarilhos do Gelo rondam. Não saia sem tocha.', 'Frio de doer os ossos. Uma fogueira vale ouro agora.'],
  },
  job: {
    farmer: { any: ['A terra dá, mas cobra suor.', 'Quer plantar? Semente boa, terra fofa e água.'], spring: ['Tempo de semear! Cada cova, uma semente.'], summer: ['O trigo está pegando cor.'], autumn: ['Colheita! Sempre falta braço no campo.'], winter: ['No inverno a terra dorme. A gente conserta cerca e reza.'] },
    herder: { any: ['As galinhas fogem se você correr. Chegue devagar.', 'À noite os lobos rondam o curral. Cerca boa é cerca alta.', 'Uma vaca bem alimentada dá leite e alegria.'] },
    smith: { any: ['Ferro bom se bate quente.', 'Uma bigorna e uma fornalha fazem milagres. Já construiu as suas?', 'Lâmina cega não corta nem pão. Cuide das suas ferramentas.'] },
    woodcutter: { any: ['Corte a árvore pela base e saia da frente quando ela cair!', 'Madeira seca queima melhor. Madeira verde só faz fumaça.', 'Um bom machado vale mais que dez fracos.'] },
    miner: { any: ['Lá embaixo é escuro e frio. Leve tocha.', 'Cuidado com as aranhas das cavernas. Grandes. Peludas.', 'Cobre perto da superfície, ferro mais fundo. Ouro… só sonhando.'] },
    weaver: { any: ['Algodão vira linha, linha vira pano, pano vira roupa quente.', 'Um bom tear não tem pressa.', 'Que cor ficaria bem em você? Vermelho, com certeza.'] },
    innkeeper: { any: ['Sopa quente e cama limpa! Bom… a sopa, pelo menos.', 'Aqui se ouvem todas as histórias do reino.', 'Sente-se! O pão saiu agora do forno.'] },
    priest: { any: ['Que a luz te guarde nas noites longas.', 'Os mortos que andam não têm paz. Tenha piedade… e uma espada afiada.'] },
    groom: { any: ['Cavalo selvagem? Chegue devagar, com trigo na mão.', 'Um cavalo bem tratado leva você longe.'] },
    porter: { any: ['Saco de trigo pesa. Saco de batata pesa mais.', 'Do celeiro para a praça, da praça para o celeiro. Assim é a vida.'] },
    lord: { any: ['Este castelo serve ao Reino de {reino}. Comporte-se e seremos amigos.', 'A guarnição está pronta. O inverno que venha.'] },
    merchant: { any: ['Mercadorias do Reino de {reino} inteiro! Bem… em breve.', 'Comprar barato, vender caro. É simples. Quase.', 'Dizem que em {capital} se paga o dobro por pano bom.'] },
    homemaker: { any: ['A casa não se arruma sozinha.', 'O poço da praça tem a melhor água da região.', 'Feche bem a porta à noite. Bem fechada.'] },
    child: { any: ['Você é um aventureiro? Já viu um gigante de gelo?', 'Pega-pega! Você está com ela!', 'Minha mãe disse para não falar com estranhos… mas você parece legal.', 'Quando eu crescer vou ser guarda!'] },
    elder: { any: ['No meu tempo o inverno era pior. Ou eu era mais novo.', 'Já vi muitos reis passarem. O povo fica.', 'Escute os mais velhos: nunca durma fora de casa no inverno.'] },
    guard: { any: ['Ande na linha em {vila}.', 'Viu algo estranho na estrada? Avise a guarda.', 'Os portões fecham ao anoitecer. Não fique do lado de fora.', 'Treinamos todo dia para a noite.'], winter: ['Inverno: dobramos a vigia. Se ouvir o sino, corra para dentro.'] },
    archer: { any: ['Lá de cima da muralha se vê tudo.', 'Flecha boa tem pena boa.', 'De noite, os mortos vêm atrás da luz. Nós esperamos por eles.'] },
  },
};
export const SEASON_PT = { spring: 'primavera', summer: 'verão', autumn: 'outono', winter: 'inverno' };
