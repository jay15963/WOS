// Character look catalogue (agent H): every option the player can pick, with pt-BR names, rarity and an
// `unlocked` flag (all free for now; future cosmetics only add entries or flip flags — no code changes).
// Pure data shared by the art (part painters read the `p` params) and the game/UI (src/game/look.js,
// src/ui/charcreator.js). Ids are stable: they are saved, sent to other players and used in sprite names.

export const RARITY = {
  common: { name: 'Comum', color: '#b9b2a2' },
  uncommon: { name: 'Incomum', color: '#7cc36a' },
  rare: { name: 'Raro', color: '#5aa2e6' },
  epic: { name: 'Épico', color: '#b67cf0' },
  legendary: { name: 'Lendário', color: '#f0a83a' },
};

const E = (id, name, p = {}, rarity = 'common') => ({ id, name, rarity, unlocked: true, p });
const R = (id, name, p, rarity) => E(id, name, p, rarity);

// ---------------- body ----------------
// sx/sy scale the whole body stack (rig-independent build); hy scales the head lift
export const BUILD = [
  E('slim', 'Magro', { sx: 0.88, sy: 1.01 }),
  E('average', 'Médio', { sx: 1, sy: 1 }),
  E('athletic', 'Atlético', { sx: 1.07, sy: 1.02 }),
  E('broad', 'Forte', { sx: 1.14, sy: 1.03 }),
  E('heavy', 'Robusto', { sx: 1.21, sy: 0.99 }),
];
export const HEIGHT = [
  E('short', 'Baixo', { k: 0.93 }),
  E('normal', 'Médio', { k: 1 }),
  E('tall', 'Alto', { k: 1.065 }),
];

// ---------------- head & face ----------------
// head: lower-face shape (the cranium stays constant so every hair style fits every head)
//   cw cheek half-width (y+5), jw jaw half-width (y+12), chw chin half-width (y+16.5), cy chin y, pe profile chin (e), jx jaw corner (e)
export const HEAD = [
  E('round', 'Redonda', { cw: 17.3, jw: 14.6, chw: 7.4, cy: 18, pe: 0, jx: 0 }),
  E('oval', 'Oval', { cw: 16.6, jw: 13.4, chw: 6.2, cy: 18.6, pe: 0.4, jx: 0.5 }),
  E('square', 'Quadrada', { cw: 17.4, jw: 16.2, chw: 9.6, cy: 17.6, pe: 0.6, jx: 2 }),
  E('heart', 'Coração', { cw: 17.6, jw: 12.4, chw: 4.6, cy: 18.4, pe: 0.2, jx: -0.5 }),
  E('long', 'Alongada', { cw: 16.2, jw: 13.8, chw: 6.8, cy: 19.6, pe: 0.8, jx: 1 }),
  E('wide', 'Larga', { cw: 18.6, jw: 16.4, chw: 8.6, cy: 17.2, pe: 0, jx: 1 }),
  E('diamond', 'Diamante', { cw: 18.2, jw: 13, chw: 5.2, cy: 18.6, pe: 0.5, jx: 0 }),
  E('soft', 'Bochechuda', { cw: 18.4, jw: 16, chw: 8.2, cy: 17.6, pe: -0.3, jx: 0, full: 1 }, 'uncommon'),
];
export const EARS = [
  E('small', 'Pequenas', { rx: 2.6, ry: 3.8 }),
  E('medium', 'Médias', { rx: 3.3, ry: 4.6 }),
  E('large', 'Grandes', { rx: 3.9, ry: 5.4 }),
  E('round', 'Redondinhas', { rx: 3.6, ry: 4.1 }),
  E('pointed', 'Pontudas', { rx: 3.2, ry: 4.9, tip: 1 }, 'rare'),
  E('protruding', 'De abano', { rx: 4.1, ry: 5.1, out: 1 }, 'uncommon'),
];
// eyes: rx/ry opening, tilt (+ = outer corner up), lid = upper lid cover 0..0.5, low = lower lid lift,
// dx spacing, iris radius factor, lash, white = visible sclera
export const EYES = [
  E('almond', 'Amendoados', { rx: 2.3, ry: 2.2, tilt: 0.12, lid: 0.15, iris: 0.66 }),
  E('round', 'Redondos', { rx: 2.15, ry: 2.6, tilt: 0, lid: 0.05, iris: 0.68 }),
  E('big', 'Grandes', { rx: 2.7, ry: 3.1, tilt: 0.02, lid: 0.04, iris: 0.64, white: 1 }),
  E('small', 'Pequenos', { rx: 1.6, ry: 1.8, tilt: 0, lid: 0.08, iris: 0.72 }),
  E('narrow', 'Estreitos', { rx: 2.5, ry: 1.5, tilt: 0.06, lid: 0.2, iris: 0.7 }),
  E('hooded', 'Sonolentos', { rx: 2.4, ry: 2.3, tilt: -0.04, lid: 0.42, iris: 0.68 }),
  E('upturned', 'Felinos', { rx: 2.5, ry: 2.0, tilt: 0.34, lid: 0.18, iris: 0.66, lash: 1 }, 'uncommon'),
  E('downturned', 'Caídos', { rx: 2.4, ry: 2.2, tilt: -0.3, lid: 0.2, iris: 0.66 }),
  E('lashes', 'Cílios longos', { rx: 2.35, ry: 2.4, tilt: 0.08, lid: 0.1, iris: 0.66, lash: 2 }, 'uncommon'),
  E('wide', 'Arregalados', { rx: 2.5, ry: 2.9, tilt: 0, lid: 0, iris: 0.52, white: 1 }),
  E('sharp', 'Penetrantes', { rx: 2.5, ry: 1.8, tilt: 0.18, lid: 0.3, iris: 0.72, low: 0.25 }, 'rare'),
  E('gentle', 'Gentis', { rx: 2.2, ry: 2.4, tilt: -0.1, lid: 0.12, iris: 0.7, low: 0.3 }),
];
// brows: in/mid/out heights (px above the eye line, + = up), w thickness, len, joined (unibrow), bushy
export const BROWS = [
  E('soft', 'Suaves', { a: [0.2, 1.4, 0.4], w: 1.8 }),
  E('straight', 'Retas', { a: [0.6, 0.9, 0.7], w: 1.9 }),
  E('arched', 'Arqueadas', { a: [0, 2.2, 0.2], w: 1.7 }),
  E('thick', 'Grossas', { a: [0.3, 1.2, 0.3], w: 2.9 }),
  E('thin', 'Finas', { a: [0.2, 1.5, 0.5], w: 1.0 }),
  E('angry', 'Franzidas', { a: [-1.0, 0.8, 1.4], w: 2.2 }),
  E('worried', 'Preocupadas', { a: [1.5, 1.1, -0.4], w: 1.9 }),
  E('bushy', 'Cerradas', { a: [0.3, 1.4, 0.6], w: 2.6, bushy: 1 }, 'uncommon'),
  E('unibrow', 'Monocelha', { a: [0.4, 1.0, 0.4], w: 2.3, joined: 1 }, 'rare'),
  E('none', 'Sem', { none: 1 }),
];
// nose: front strokes (w width, l length, br bridge, tip) and profile bump (pr reach, ph droop, hk hook)
export const NOSE = [
  E('button', 'Arrebitado', { w: 2.2, l: 3, tip: 1.2, pr: 2.6, ph: -0.4, up: 1 }),
  E('small', 'Pequeno', { w: 1.8, l: 2.4, tip: 1, pr: 2.2, ph: 0 }),
  E('straight', 'Reto', { w: 2.4, l: 4.2, br: 1, tip: 1.1, pr: 3.4, ph: 0.2 }),
  E('wide', 'Largo', { w: 3.4, l: 3.4, tip: 1.6, pr: 3, ph: 0.4, wide: 1 }),
  E('long', 'Comprido', { w: 2.3, l: 5.2, br: 1, tip: 1.2, pr: 4.6, ph: 1 }),
  E('hooked', 'Aquilino', { w: 2.5, l: 4.8, br: 1, tip: 1.3, pr: 4.2, ph: 1.4, hk: 1 }, 'uncommon'),
  E('round', 'Batata', { w: 2.9, l: 3.2, tip: 2.1, pr: 3.4, ph: 0.6, bulb: 1 }),
  E('pointed', 'Fino', { w: 1.9, l: 4.4, br: 1, tip: 0.8, pr: 4, ph: 0.3, sharp: 1 }),
  E('flat', 'Achatado', { w: 3.1, l: 2.6, tip: 1.4, pr: 1.6, ph: 0.2, wide: 1 }),
];
// mouth: w half-width, c curve (+ smile), up/low lip fullness, open, tilt (smirk), teeth
export const MOUTH = [
  E('neutral', 'Neutra', { w: 2.6, c: 0.5, up: 0.4, low: 0.8 }),
  E('smile', 'Sorriso', { w: 3.1, c: 1.6, up: 0.4, low: 0.9 }),
  E('grin', 'Sorrisão', { w: 3.8, c: 2.2, up: 0.3, low: 1.2, open: 1.8, teeth: 1 }, 'uncommon'),
  E('smirk', 'De lado', { w: 2.9, c: 0.8, tilt: 1.1, up: 0.4, low: 0.8 }),
  E('full', 'Lábios cheios', { w: 3.0, c: 0.4, up: 1.1, low: 1.6 }),
  E('thin', 'Lábios finos', { w: 2.8, c: 0.2, up: 0.1, low: 0.3 }),
  E('pout', 'Biquinho', { w: 1.9, c: 0.1, up: 0.9, low: 1.3 }),
  E('serious', 'Séria', { w: 3.0, c: -0.3, up: 0.3, low: 0.6 }),
  E('open', 'Surpresa', { w: 1.8, c: 0, up: 0.4, low: 0.6, open: 2.2, round: 1 }, 'uncommon'),
  E('frown', 'Tristonha', { w: 2.8, c: -1.3, up: 0.3, low: 0.7 }),
];
export const CHEEKS = [
  E('none', 'Nenhuma'),
  E('blush', 'Rosadas', { blush: 0.32 }),
  E('rosy', 'Coradas', { blush: 0.55 }, 'uncommon'),
  E('dimples', 'Covinhas', { dimple: 1, blush: 0.12 }),
  E('cheekbones', 'Maçãs marcadas', { bones: 1 }),
  E('chubby', 'Fofas', { blush: 0.2, round: 1 }),
];
export const AGE = [
  E('none', 'Jovem'),
  E('light', 'Marcas leves', { lv: 1 }),
  E('tired', 'Olheiras', { bags: 1 }),
  E('mature', 'Maduro', { lv: 2 }),
  E('old', 'Idoso', { lv: 3 }, 'uncommon'),
];
export const MARKS = [
  E('none', 'Nenhuma'),
  E('freckles', 'Sardas', { fr: 14 }),
  E('freckles_heavy', 'Muitas sardas', { fr: 34 }, 'uncommon'),
  E('mole_cheek', 'Pinta na bochecha', { mole: [8.6, 9.4] }),
  E('mole_lip', 'Pinta no lábio', { mole: [4.2, 12.4] }),
  E('moles', 'Pintinhas', { mole: [7.5, 7.6], mole2: [-9.4, 10.6], mole3: [5.6, -4.6] }),
  E('birthmark', 'Mancha de nascença', { birth: 1 }, 'rare'),
  E('sun_spots', 'Manchas de sol', { spots: 1 }, 'uncommon'),
];
export const SCAR = [
  E('none', 'Nenhuma'),
  E('brow', 'Na sobrancelha', { lines: [[[-8.6, -4.6], [-5.4, 1.2]]] }),
  E('cheek', 'Na bochecha', { lines: [[[7.4, 4.6], [12.6, 11.2]]], stitch: 1 }),
  E('eye', 'Sobre o olho', { lines: [[[5.2, -5.4], [8.2, 9.8]]], stitch: 1 }, 'uncommon'),
  E('lip', 'No lábio', { lines: [[[1.6, 10], [3.2, 15.2]]] }),
  E('nose', 'No nariz', { lines: [[[-3.2, 5.2], [3.4, 7.6]]] }),
  E('cross', 'Em X', { lines: [[[-11.8, 5.4], [-6.6, 11.6]], [[-6.4, 5.2], [-12, 11.2]]] }, 'uncommon'),
  E('claw', 'Garras', { lines: [[[5, -2], [12.4, 9.2]], [[7.4, -3.4], [14.6, 7]], [[3.2, 0.6], [9.8, 12]]] }, 'rare'),
  E('burn', 'Queimadura', { burn: 1 }, 'rare'),
];
export const PAINT = [
  E('none', 'Nenhuma'),
  E('stripes', 'Listras de guerra', { kind: 'stripes' }, 'uncommon'),
  E('band', 'Faixa nos olhos', { kind: 'band' }, 'rare'),
  E('hunter', 'Caçador', { kind: 'hunter' }, 'uncommon'),
  E('dots', 'Pontos', { kind: 'dots' }),
  E('tears', 'Lágrimas', { kind: 'tears' }, 'uncommon'),
  E('chin', 'Queixo pintado', { kind: 'chin' }, 'uncommon'),
  E('half', 'Meia face', { kind: 'half' }, 'epic'),
  E('tribal', 'Tribal', { kind: 'tribal' }, 'epic'),
  E('forehead', 'Símbolo na testa', { kind: 'forehead' }, 'rare'),
  E('fox', 'Bigodes de raposa', { kind: 'whiskers' }, 'rare'),
  E('spirit', 'Espírito da floresta', { kind: 'spirit' }, 'legendary'),
];

// ---------------- hair ----------------
// cap: hair on the cranium · fr: fringe / hairline · len: length of the sides/back (0 above ears … 5 waist)
// tex: texture · x: add-ons · vol: volume · tall: hidden by tall hats · long: sways (animation)
export const HAIR = [
  E('bald', 'Careca', { none: 1 }),
  E('shaved', 'Raspado', { cap: 'buzz', fr: 'line', len: 0, tex: 'buzz' }),
  E('buzz', 'Militar', { cap: 'full', fr: 'line', len: 0, tex: 'buzz', vol: 1.0 }),
  E('short', 'Curto', { cap: 'full', fr: 'short', len: 0, tex: 'straight' }),
  E('crew', 'Social', { cap: 'full', fr: 'part', len: 0, tex: 'straight' }),
  E('slick', 'Penteado para trás', { cap: 'full', fr: 'back', len: 0, tex: 'straight', vol: 1.02 }),
  E('spiky', 'Espetado', { cap: 'full', fr: 'spiky', len: 0, tex: 'straight', vol: 1.08 }, 'uncommon'),
  E('messy', 'Bagunçado', { cap: 'full', fr: 'messy', len: 1, tex: 'straight', vol: 1.06 }),
  E('shaggy', 'Desgrenhado', { cap: 'full', fr: 'shaggy', len: 1, tex: 'straight', vol: 1.04 }),
  E('receding', 'Entradas', { cap: 'receding', fr: 'line', len: 0, tex: 'straight' }),
  E('balding', 'Calvície', { cap: 'balding', fr: 'none', len: 0, tex: 'straight' }),
  E('undercut', 'Undercut', { cap: 'top', fr: 'swept', len: 0, tex: 'straight', vol: 1.04, shave: 1 }, 'uncommon'),
  E('side_shave', 'Raspado de lado', { cap: 'full', fr: 'swept', len: 2, tex: 'straight', side: 1, shave: 1 }, 'rare'),
  E('mohawk', 'Moicano', { cap: 'crest', fr: 'none', len: 0, tex: 'straight', x: ['crest'], shave: 1, tall: 1 }, 'uncommon'),
  E('pixie', 'Pixie', { cap: 'full', fr: 'pixie', len: 1, tex: 'straight', vol: 1.03 }),
  E('fringe', 'Franjinha', { cap: 'full', fr: 'bangs', len: 1, tex: 'straight', vol: 1.03 }),
  E('bob', 'Chanel', { cap: 'full', fr: 'bangs', len: 2, tex: 'straight', vol: 1.05, round: 1 }),
  E('curtains', 'Repartido ao meio', { cap: 'full', fr: 'curtain', len: 2, tex: 'straight', vol: 1.03 }),
  E('wavy', 'Ondulado', { cap: 'full', fr: 'part', len: 2, tex: 'wavy', vol: 1.06 }),
  E('medium', 'Médio', { cap: 'full', fr: 'short', len: 3, tex: 'straight', vol: 1.03, long: 1 }),
  E('long', 'Longo', { cap: 'full', fr: 'curtain', len: 4, tex: 'straight', vol: 1.02, long: 1 }),
  E('long_wavy', 'Longo ondulado', { cap: 'full', fr: 'part', len: 4, tex: 'wavy', vol: 1.07, long: 1 }, 'uncommon'),
  E('wild', 'Juba selvagem', { cap: 'full', fr: 'shaggy', len: 4, tex: 'wavy', vol: 1.16, long: 1, wild: 1 }, 'rare'),
  E('curly', 'Cacheado', { cap: 'full', fr: 'curls', len: 1, tex: 'curly', vol: 1.12 }),
  E('long_curly', 'Cachos longos', { cap: 'full', fr: 'curls', len: 3, tex: 'curly', vol: 1.16, long: 1 }, 'uncommon'),
  E('afro', 'Black power', { cap: 'afro', fr: 'none', len: 1, tex: 'coily', vol: 1.42, tall: 1 }, 'uncommon'),
  E('puff', 'Puff alto', { cap: 'full', fr: 'back', len: 0, tex: 'coily', x: ['puff'], tall: 1 }, 'uncommon'),
  E('twists', 'Twists', { cap: 'full', fr: 'twists', len: 1, tex: 'twists', vol: 1.1 }, 'uncommon'),
  E('dreads', 'Dreads', { cap: 'full', fr: 'locs', len: 3, tex: 'locs', vol: 1.08, long: 1 }, 'uncommon'),
  E('long_dreads', 'Dreads longos', { cap: 'full', fr: 'back', len: 5, tex: 'locs', vol: 1.06, long: 1, x: ['tie_back'] }, 'rare'),
  E('cornrows', 'Tranças nagô', { cap: 'full', fr: 'back', len: 0, tex: 'rows', vol: 0.99 }, 'uncommon'),
  E('ponytail', 'Rabo de cavalo', { cap: 'full', fr: 'back', len: 0, tex: 'straight', x: ['ponytail'], long: 1 }),
  E('high_ponytail', 'Rabo alto', { cap: 'full', fr: 'back', len: 0, tex: 'straight', x: ['high_tail'], long: 1, tall: 1 }, 'uncommon'),
  E('pigtails', 'Maria-chiquinha', { cap: 'full', fr: 'bangs', len: 0, tex: 'straight', x: ['pigtails'], long: 1 }, 'uncommon'),
  E('bun', 'Coque', { cap: 'full', fr: 'back', len: 0, tex: 'straight', x: ['bun'], tall: 1 }),
  E('low_bun', 'Coque baixo', { cap: 'full', fr: 'part', len: 0, tex: 'straight', x: ['low_bun'] }),
  E('top_knot', 'Coque samurai', { cap: 'top', fr: 'back', len: 0, tex: 'straight', x: ['knot'], shave: 1, tall: 1 }, 'rare'),
  E('space_buns', 'Coque duplo', { cap: 'full', fr: 'bangs', len: 0, tex: 'straight', x: ['buns2'], tall: 1 }, 'rare'),
  E('braid', 'Duas tranças', { cap: 'full', fr: 'part', len: 0, tex: 'straight', x: ['braids2'], long: 1 }),
  E('single_braid', 'Trança única', { cap: 'full', fr: 'back', len: 0, tex: 'straight', x: ['braid_back'], long: 1 }, 'uncommon'),
  E('crown_braid', 'Trança coroa', { cap: 'full', fr: 'back', len: 0, tex: 'straight', x: ['crown'] }, 'epic'),
  E('viking', 'Viking', { cap: 'top', fr: 'back', len: 3, tex: 'straight', x: ['braid_back'], shave: 1, long: 1 }, 'epic'),
];
export const HAIR_FX = [
  E('none', 'Cor única'),
  E('streaks', 'Mechas', {}, 'uncommon'),
  E('tips', 'Pontas', {}, 'uncommon'),
  E('roots', 'Raiz', {}, 'rare'),
];
// facial hair (s and e only): m mustache, b beard, st stubble (alpha)
export const BEARD = [
  E('none', 'Nenhuma'),
  E('stubble', 'Por fazer', { st: 0.5 }),
  E('stubble_heavy', 'Por fazer cerrada', { st: 0.85 }),
  E('mustache', 'Bigode', { m: 'full' }),
  E('pencil', 'Bigode fino', { m: 'pencil' }),
  E('handlebar', 'Bigode retorcido', { m: 'handlebar' }, 'rare'),
  E('walrus', 'Bigodão', { m: 'walrus' }, 'uncommon'),
  E('goatee', 'Cavanhaque', { b: 'goatee', m: 'full' }),
  E('soul', 'Mosca', { b: 'soul' }),
  E('chin_strap', 'Barba de contorno', { b: 'strap' }, 'uncommon'),
  E('sideburns', 'Costeletas', { b: 'sideburns' }),
  E('mutton', 'Suíças', { b: 'mutton', m: 'full' }, 'uncommon'),
  E('short', 'Barba curta', { b: 'short', m: 'full', st: 0.25 }),
  E('full', 'Barba cheia', { b: 'full', m: 'full' }),
  E('long', 'Barba longa', { b: 'long', m: 'full' }, 'uncommon'),
  E('braided', 'Barba trançada', { b: 'braided', m: 'full' }, 'epic'),
  E('forked', 'Barba bifurcada', { b: 'forked', m: 'handlebar' }, 'rare'),
];

// ---------------- clothing (base clothes only: headgear / armour are equipment) ----------------
// top: hem 'short'|'mid'|'long' · sl sleeves 0 none / 1 short / 2 long · neck · tuck (tucked into the trousers)
export const TOP = [
  E('tee', 'Camiseta', { hem: 'short', sl: 1, neck: 'round' }),
  E('shirt', 'Camisa', { hem: 'short', sl: 2, neck: 'collar', buttons: 1, tuck: 1 }),
  E('henley', 'Camisa de botões', { hem: 'short', sl: 2, neck: 'henley', buttons: 1 }),
  E('laced', 'Bata com cordão', { hem: 'short', sl: 2, neck: 'laced' }),
  E('tank', 'Regata', { hem: 'short', sl: 0, neck: 'scoop' }),
  E('sweater', 'Suéter', { hem: 'short', sl: 2, neck: 'high', rib: 1 }),
  E('peasant', 'Blusa camponesa', { hem: 'short', sl: 1, neck: 'boat', puff: 1 }, 'uncommon'),
  E('tunic', 'Túnica', { hem: 'mid', sl: 2, neck: 'v', belt: 'rope' }),
  E('wrap', 'Túnica transpassada', { hem: 'mid', sl: 2, neck: 'wrap', belt: 'sash' }, 'uncommon'),
  E('jerkin', 'Gibão', { hem: 'mid', sl: 2, neck: 'high', quilt: 1, buttons: 1 }, 'rare'),
  E('sleeveless', 'Túnica sem mangas', { hem: 'mid', sl: 0, neck: 'round', belt: 'leather' }),
  E('dress', 'Vestido', { hem: 'long', sl: 1, neck: 'scoop', waist: 1 }),
  E('gown', 'Vestido de mangas', { hem: 'long', sl: 2, neck: 'boat', waist: 1, flare: 1 }, 'uncommon'),
  E('robe', 'Manto', { hem: 'long', sl: 2, neck: 'v', wide: 1, belt: 'rope' }, 'rare'),
];
export const PATTERN = [
  E('plain', 'Liso'),
  E('stripes', 'Listras'),
  E('vstripes', 'Listras verticais'),
  E('plaid', 'Xadrez', {}, 'uncommon'),
  E('tartan', 'Xadrez escocês', {}, 'rare'),
  E('dots', 'Bolinhas', {}, 'uncommon'),
  E('diamonds', 'Losangos', {}, 'rare'),
  E('flowers', 'Florido', {}, 'rare'),
  E('chevron', 'Zigue-zague', {}, 'uncommon'),
  E('embroidered', 'Barra bordada', {}, 'epic'),
  E('patches', 'Remendos', {}, 'uncommon'),
  E('stars', 'Céu estrelado', {}, 'legendary'),
];
// outer layer worn over the top
export const OVER = [
  E('none', 'Nada'),
  E('vest', 'Colete', { kind: 'vest' }),
  E('fur_vest', 'Colete de pele', { kind: 'vest', fur: 1 }, 'rare'),
  E('apron', 'Avental', { kind: 'apron' }),
  E('suspenders', 'Suspensórios', { kind: 'braces' }),
  E('sash', 'Faixa', { kind: 'sash' }, 'uncommon'),
  E('poncho', 'Poncho', { kind: 'poncho' }, 'rare'),
  E('shawl', 'Xale', { kind: 'shawl' }, 'uncommon'),
  E('corset', 'Corpete', { kind: 'corset' }, 'rare'),
  E('overalls', 'Jardineira', { kind: 'overalls' }, 'uncommon'),
];
// bottoms: leg 'full'|'knee'|'thigh'|'skirt'|'long_skirt' · fit
export const BOTTOM = [
  E('trousers', 'Calça', { leg: 'full' }),
  E('slim', 'Calça justa', { leg: 'full', fit: 'slim' }),
  E('baggy', 'Calça larga', { leg: 'full', fit: 'baggy' }),
  E('breeches', 'Calça curta', { leg: 'knee', cuff: 1 }),
  E('shorts', 'Bermuda', { leg: 'thigh' }),
  E('skirt', 'Saia', { leg: 'skirt' }),
  E('long_skirt', 'Saia longa', { leg: 'long_skirt' }, 'uncommon'),
  E('kilt', 'Kilt', { leg: 'skirt', pleats: 1, tartan: 1 }, 'rare'),
  E('wraps', 'Calça com faixas', { leg: 'full', wraps: 1 }, 'uncommon'),
];
export const SHOES = [
  E('barefoot', 'Descalço', { bare: 1 }),
  E('boots', 'Botas', { h: 3.2 }),
  E('tall_boots', 'Botas altas', { h: 7.6, cuff: 1 }, 'uncommon'),
  E('shoes', 'Sapatos', { h: 1.6 }),
  E('sandals', 'Sandálias', { h: 1.2, straps: 1 }),
  E('moccasins', 'Mocassins', { h: 1.8, stitch: 1 }),
  E('wraps', 'Faixas de pano', { h: 4.6, wrap: 1 }, 'uncommon'),
  E('clogs', 'Tamancos', { h: 2, clog: 1 }, 'rare'),
];

// ---------------- palettes (swatches; any colour is allowed through the pickers) ----------------
const C = (id, name, hex, rarity = 'common') => ({ id, name, hex, rarity, unlocked: true });
export const SKIN = [
  C('porcelain', 'Porcelana', 'f7e1d0'), C('ivory', 'Marfim', 'f3d8bd'), C('rose', 'Rosado', 'efc8b4'), C('peach', 'Pêssego', 'eec29c'),
  C('sand', 'Areia', 'e5b88f'), C('beige', 'Bege', 'dcae84'), C('honey', 'Mel', 'd9a271'), C('olive', 'Oliva', 'c9a57c'),
  C('golden', 'Dourado', 'cc9564'), C('tan', 'Bronzeado', 'c08a5d'), C('caramel', 'Caramelo', 'b07a4d'), C('amber', 'Âmbar', 'a86e43'),
  C('cinnamon', 'Canela', '9c6640'), C('chestnut', 'Castanho', '8c5a38'), C('cocoa', 'Cacau', '7b4c2f'), C('mahogany', 'Mogno', '6c3f28'),
  C('espresso', 'Café', '5d3522'), C('ebony', 'Ébano', '4b2b1c'), C('deep', 'Profundo', '3d2318'),
  C('ash', 'Cinzento pálido', 'd9cfc6', 'uncommon'), C('sickly', 'Esverdeado', 'c8c9a2', 'rare'), C('frost', 'Gélido', 'c9d6e2', 'epic'),
];
export const EYE_COLORS = [
  C('dark', 'Castanho escuro', '3b2416'), C('brown', 'Castanho', '6b4024'), C('hazel', 'Avelã', '8a6a34'), C('amber', 'Âmbar', 'b5822c'),
  C('green', 'Verde', '4f7f3c'), C('olive', 'Verde-oliva', '6b7440'), C('blue', 'Azul', '3f6fa8'), C('sky', 'Azul-claro', '78a8d4'),
  C('grey', 'Cinza', '7d8a92'), C('black', 'Preto', '1c1512'),
  C('violet', 'Violeta', '7a52b0', 'rare'), C('gold', 'Dourado', 'd8b040', 'epic'), C('red', 'Rubi', 'a8302c', 'epic'),
];
export const HAIR_COLORS = [
  C('black', 'Preto', '2a2220'), C('soft_black', 'Preto suave', '3b2e28'), C('dark_brown', 'Castanho escuro', '4e3424'),
  C('brown', 'Castanho', '6b4630'), C('chestnut', 'Castanho-avermelhado', '7e4a2c'), C('light_brown', 'Castanho-claro', '93684a'),
  C('ash_brown', 'Castanho acinzentado', '857565'), C('dark_blond', 'Loiro escuro', 'a88a5e'), C('blond', 'Loiro', 'd2b47c'),
  C('golden', 'Loiro dourado', 'e0c07a'), C('platinum', 'Platinado', 'ece0c4'), C('strawberry', 'Loiro morango', 'd09a6a'),
  C('ginger', 'Ruivo', 'c06a32'), C('auburn', 'Acobreado', '9a4a2a'), C('grey', 'Grisalho', 'a8a39c'), C('white', 'Branco', 'e8e4dc'),
];
export const HAIR_DYES = [
  C('red', 'Vermelho', 'c0302c', 'uncommon'), C('pink', 'Rosa', 'e87aa8', 'uncommon'), C('purple', 'Roxo', '7a4ab0', 'uncommon'),
  C('blue', 'Azul', '3a6ad0', 'uncommon'), C('teal', 'Turquesa', '2fa0a0', 'rare'), C('green', 'Verde', '4ea040', 'rare'),
  C('lilac', 'Lilás', 'b8a0e0', 'rare'), C('orange', 'Laranja', 'e88a30', 'uncommon'), C('mint', 'Menta', '8ee0c0', 'epic'),
  C('silver', 'Prata', 'c8ccd4', 'rare'), C('midnight', 'Azul-noite', '263a6a', 'epic'), C('gold', 'Ouro', 'e8b830', 'legendary'),
];
export const CLOTH_COLORS = [
  C('linen', 'Linho', 'e6dcc4'), C('cream', 'Creme', 'efe4cc'), C('white', 'Branco', 'f2f0ea'), C('grey', 'Cinza', '8e8e8a'),
  C('charcoal', 'Carvão', '3e3e40'), C('black', 'Preto', '262526'), C('brown', 'Marrom', '6e4c32'), C('tan', 'Caramelo', 'b08a5e'),
  C('olive', 'Oliva', '6f7444'), C('forest', 'Verde-mata', '3e6238'), C('moss', 'Musgo', '8a9a5a'), C('teal', 'Petróleo', '2f6a6e'),
  C('navy', 'Marinho', '2c3e62'), C('blue', 'Azul', '3e64a0'), C('sky', 'Celeste', '86acd2'), C('plum', 'Ameixa', '6a3a5c'),
  C('purple', 'Roxo', '6a4a9a'), C('wine', 'Vinho', '7a2a32'), C('red', 'Vermelho', 'b03a30'), C('rust', 'Ferrugem', 'a8562c'),
  C('orange', 'Laranja', 'd8823a'), C('mustard', 'Mostarda', 'c8a03c'), C('yellow', 'Amarelo', 'e6c85a'), C('pink', 'Rosa', 'd88aa0'),
  C('saffron', 'Açafrão', 'e09a2a', 'uncommon'), C('royal', 'Azul-real', '2a48b8', 'rare'), C('crimson', 'Carmesim', 'c01830', 'rare'),
  C('emerald', 'Esmeralda', '1e8a5a', 'rare'), C('gold', 'Dourado', 'd8b040', 'epic'),
];
export const LEATHER_COLORS = [
  C('dark', 'Couro escuro', '3c2a1e'), C('brown', 'Couro', '5e3e28'), C('tan', 'Couro claro', '9a6e44'), C('black', 'Preto', '242022'),
  C('grey', 'Cinza', '6a6560'), C('oxblood', 'Bordô', '5e2424'), C('natural', 'Cru', 'c0a07a'), C('white', 'Branco', 'e8e2d6', 'uncommon'),
];
export const PAINT_COLORS = [
  C('ochre', 'Ocre vermelho', 'b0402c'), C('clay', 'Argila branca', 'ece6da'), C('charcoal', 'Carvão', '2c2624'), C('woad', 'Anil', '3a5ab0'),
  C('yellow', 'Ocre amarelo', 'd8a838'), C('green', 'Verde-folha', '4e8a3a'), C('crimson', 'Carmim', 'c0203c', 'uncommon'),
  C('teal', 'Turquesa', '2aa0a0', 'rare'), C('gold', 'Pó de ouro', 'e0b848', 'epic'),
];

export const CATALOG = {
  build: BUILD, height: HEIGHT, head: HEAD, ears: EARS, eyes: EYES, brows: BROWS, nose: NOSE, mouth: MOUTH, cheeks: CHEEKS,
  age: AGE, marks: MARKS, scar: SCAR, paint: PAINT, hair: HAIR, hairFx: HAIR_FX, beard: BEARD, top: TOP, pattern: PATTERN,
  over: OVER, bottom: BOTTOM, shoes: SHOES,
};
export const PALETTES = { skin: SKIN, eyes: EYE_COLORS, hair: HAIR_COLORS, dye: HAIR_DYES, cloth: CLOTH_COLORS, leather: LEATHER_COLORS, paint: PAINT_COLORS };

const BY = {};
for (const k in CATALOG) BY[k] = Object.fromEntries(CATALOG[k].map((e) => [e.id, e]));
// catalogue entry (or null)
export const entry = (cat, id) => (BY[cat] && BY[cat][id]) || null;
