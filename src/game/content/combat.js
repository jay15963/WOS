// Combat: creatures, abilities, buffs  (pure data, no DOM). All user-facing strings in Brazilian Portuguese.
// See docs/CONTENT.md for the canonical ids. Weapon/armor numbers live in ./weapons.js.

// temper: hostile (red, aggroes), neutral (yellow, fights back), passive (green, flees)
// loot rows: [item, min, max, chance, flag?]  flag 'skin' = needs a knife (leather), skipped otherwise.
// minD = min distance (tiles) from the world spawn for its spawners (bare-hands start stays fair).
export const SPECIES = {
  rabbit: { name: 'Coelho', temper: 'passive', hp: 12, dmg: 0, swing: 2, speed: 5.0, r: 0.18, scale: 1, xp: 0.3, minD: 4,
            loot: [['meat', 1, 1, 1], ['fiber', 1, 1, 0.3]] },
  fox:    { name: 'Raposa', temper: 'passive', hp: 22, dmg: 0, swing: 1.4, speed: 5.9, r: 0.22, scale: 1, xp: 0.5, minD: 8,
            skittish: 6.5, // flees as soon as the player gets this close, even standing still
            loot: [['meat', 1, 1, 1], ['leather', 1, 1, 0.8, 'skin']] },
  deer:   { name: 'Cervo', temper: 'passive', hp: 34, dmg: 0, swing: 2, speed: 5.4, r: 0.3, scale: 1, xp: 0.7, minD: 7,
            loot: [['meat', 2, 3, 1], ['leather', 1, 2, 0.9, 'skin']] },
  boar:   { name: 'Javali', temper: 'neutral', hp: 58, dmg: 6, swing: 2.0, speed: 4.0, r: 0.32, scale: 1, xp: 1.1, minD: 14,
            loot: [['meat', 2, 3, 1], ['leather', 1, 1, 0.6, 'skin']] },
  wolf:   { name: 'Lobo', temper: 'hostile', hp: 42, dmg: 4.5, swing: 1.8, speed: 4.4, aggro: 7, r: 0.32, scale: 1, xp: 1.0, social: true, minD: 30,
            loot: [['meat', 1, 2, 1], ['leather', 1, 1, 0.7, 'skin']] },
  spider: { name: 'Aranha da caverna', temper: 'hostile', hp: 36, dmg: 3.6, swing: 1.25, speed: 5.0, aggro: 6, r: 0.26, scale: 1, xp: 1.1, social: true, minD: 32,
            poison: { chance: 0.4, dur: 6, tick: 1.5, k: 0.45 }, // k × dmg per tick
            loot: [['fiber', 1, 2, 0.7], ['rope', 1, 1, 0.15]] },
  bear:   { name: 'Urso', temper: 'hostile', elite: true, hp: 210, dmg: 13, swing: 2.3, speed: 4.1, aggro: 6, r: 0.45, scale: 1.45, xp: 3.5, lvl: 3, minD: 55,
            loot: [['meat', 3, 5, 1], ['leather', 2, 3, 1, 'skin']] },
  // humanoid raiders (kind 'pawn', faction 'bandit') — see src/game/bandits.js
  bandit: { name: 'Saqueador', temper: 'hostile', pawn: true, hp: 66, dmg: 5.5, swing: 1.9, speed: 4.1, aggro: 8.5, r: 0.24, scale: 1, xp: 1.8, social: true,
            loot: [] },
};

// Ability catalog. range: 'melee' (weapon reach) | [min, max] tiles | 0 (self / area around)
// act = p.action.type used by the art (attack, stab, cleave, smash, pierce, shoot, throw, block, bash, cast).
// auto: weapon auto-attack (not on the bar). ammo: item consumed per use. hold: can be held (block).
export const ABILITIES = {
  punch:       { name: 'Soco', icon: 'punch', auto: true, act: 'attack', desc: 'Ataque automático com as mãos.' },
  shoot:       { name: 'Atirar', icon: 'shoot', auto: true, act: 'shoot', ammo: 'arrow', desc: 'Ataque automático com o arco. Gasta 1 flecha.' },

  shove:       { name: 'Empurrão', icon: 'shove', cost: 15, cd: 8, range: 'melee', target: true, act: 'bash',
                 desc: 'Empurra o alvo para longe (60% do dano) e o deixa tonto por 1,5 s.' },
  stab:        { name: 'Estocada', icon: 'stab', cost: 20, cd: 4, range: 'melee', target: true, act: 'stab',
                 desc: 'Estocada rápida: 150% do dano +2, com +25% de chance de crítico.' },
  lacerate:    { name: 'Lacerar', icon: 'lacerate', cost: 25, cd: 10, range: 'melee', target: true, act: 'lacerate',
                 desc: 'Corte profundo: 60% do dano e sangramento de 160% ao longo de 8 s.' },
  cleave:      { name: 'Golpe Fendente', icon: 'cleave', cost: 30, cd: 7, range: 0, act: 'cleave', cone: true,
                 desc: 'Golpe largo à frente: 140% do dano em todos no cone (2,4 m).' },
  smash:       { name: 'Esmagar', icon: 'smash', cost: 30, cd: 12, range: 'melee', target: true, act: 'smash',
                 desc: 'Pancada brutal: 170% do dano e atordoa por 2 s (1 s em elites).' },
  pierce:      { name: 'Perfurar', icon: 'pierce', cost: 25, cd: 7, range: [0, 3.6], target: true, act: 'pierce',
                 desc: 'Estocada longa em linha (3,6 m): 150% do dano em todos no caminho.' },
  sweep:       { name: 'Varredura', icon: 'sweep', cost: 30, cd: 10, range: 0, act: 'sweep', cone: true,
                 desc: 'Gira a lança num arco amplo: 90% do dano e empurra os inimigos à frente.' },
  strike:      { name: 'Golpe', icon: 'strike', cost: 25, cd: 5, range: 'melee', target: true, act: 'attack',
                 desc: 'Golpe poderoso: 180% do dano da arma +4.' },
  whirlwind:   { name: 'Redemoinho', icon: 'whirlwind', cost: 35, cd: 9, range: 0, act: 'whirlwind',
                 desc: 'Gira a lâmina, atingindo todos ao redor (2,3 m): 110% do dano +2.' },
  charge:      { name: 'Investida', icon: 'charge', cost: 15, cd: 14, range: [2.2, 10], target: true, act: 'charge',
                 desc: 'Avança até o alvo e o atordoa por 1,5 s.' },
  aimed_shot:  { name: 'Tiro Mirado', icon: 'aimed_shot', cost: 30, cd: 10, range: [0, 11], target: true, act: 'shoot', ammo: 'arrow',
                 cast: 1.4, desc: 'Mira por 1,4 s (parado): 260% do dano +6. Mover-se cancela.' },
  multi_shot:  { name: 'Tiro Múltiplo', icon: 'multi_shot', cost: 35, cd: 12, range: [0, 9], target: true, act: 'shoot', ammo: 'arrow', ammoN: 3,
                 desc: 'Dispara 3 flechas em leque: 90% do dano cada.' },
  disengage:   { name: 'Recuar', icon: 'disengage', act: 'disengage', cost: 15, cd: 14, range: 0, offGcd: true,
                 desc: 'Salta 4 m para trás, para longe do alvo.' },
  block:       { name: 'Bloquear', icon: 'block', cost: 10, cd: 8, range: 0, offGcd: true, hold: true, act: 'block',
                 desc: 'Ergue o escudo por 2 s (segure para até 4 s): reduz muito o dano vindo da frente.' },
  shield_bash: { name: 'Golpe de Escudo', icon: 'shield_bash', cost: 20, cd: 12, range: 'melee', target: true, act: 'bash',
                 desc: 'Interrompe ataques preparados, atordoa por 1 s e empurra (70% do dano).' },
  torch_swing: { name: 'Brandir Tocha', icon: 'torch_swing', cost: 20, cd: 10, range: 0, act: 'torch_swing', cone: true,
                 desc: 'Agita a tocha à frente: dano de fogo, queimadura e espanta animais por 4 s.' },
  bandage:     { name: 'Bandagem', icon: 'bandage', cost: 10, cd: 25, range: 0, item: 'bandage', act: 'bandage',
                 desc: 'Gasta 1 bandagem: cura 40% da vida em 8 s. Interrompida ao sofrer dano.' },
  sprint:      { name: 'Disparada', icon: 'sprint', cost: 20, cd: 20, range: 0, offGcd: true,
                 desc: '+65% de velocidade por 5 s. Dá mais fome.' },
};
// Generic abilities always on the bar (after weapon / off-hand ones).
export const GENERIC_ABILITIES = ['bandage', 'sprint'];
// LIVE list: the current action bar in slot order (keys 1..7). Rebuilt in place by
// src/game/abilities.js when the equipment changes — keep the same array object.
export const ABILITY_ORDER = ['shove', 'bandage', 'sprint'];
export const GCD = 1.0;

export const BUFFS = {
  bandage:  { name: 'Bandagem', icon: 'bandage', good: true },
  sprint:   { name: 'Disparada', icon: 'sprint', good: true },
  block:    { name: 'Bloqueando', icon: 'block', good: true, desc: 'Escudo erguido: dano frontal muito reduzido.' },
  warm:     { name: 'Aquecido', icon: 'fire', good: true, desc: 'Perto do fogo: regeneração maior.' },
  weak:     { name: 'Fraqueza', icon: 'skull', good: false, desc: 'Renascido: -25% de dano.' },
  sick:     { name: 'Indigestão', icon: 'sick', good: false, desc: 'Carne crua: perde vida.' },
  cold:     { name: 'Frio', icon: 'cold', good: false, desc: 'Noite sem fogo: mais fome.' },
  starving: { name: 'Faminto', icon: 'hunger', good: false, desc: 'Sem comida: perde vida.' },
  poison:   { name: 'Veneno', icon: 'poison', good: false, desc: 'Picada de aranha: perde vida aos poucos.' },
  bleed:    { name: 'Sangramento', icon: 'bleed', good: false, desc: 'Ferida aberta: perde vida aos poucos.' },
  burn:     { name: 'Queimadura', icon: 'fire', good: false, desc: 'Em chamas: perde vida aos poucos.' },
  stunned:  { name: 'Atordoado', icon: 'stun', good: false, desc: 'Não consegue agir.' },
};

// Damage-over-time kinds (mobs and player). dtype drives the floating text color.
export const DOTS = {
  bleed:  { name: 'Sangramento', dtype: 'bleed' },
  poison: { name: 'Veneno', dtype: 'poison' },
  burn:   { name: 'Queimadura', dtype: 'fire' },
};
