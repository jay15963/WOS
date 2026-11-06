// The winter attacks' notices for the local player (docs/REINOS.md §16). Every peer applies the same ops
// (game/mut/raids.js) and gets the event 'raid'; here each peer decides what ITS player is told:
//   - near the place (its land + 90 tiles): the wave coming ("Esqueletos atacam Estrosa pelo norte! · 7 contra 8 guardas"),
//     a horde (warned as such: the guard will need help), the defense broken, the night's end (held: how many fell;
//     lost: the dead and the damage — the people rebuild from the next day);
//   - wherever he is: his own property hit — a bought house / what he built on his plot ("Os monstros danificaram sua
//     casa em X: conserte-a você mesmo"), a rented one (the people mend it).
// No message for each death (owner's rule): the bell, the fight and the end tell the story. Cosmetic, local (ui/notify.js).
import { notify } from './notify.js';
import { WAR_ICONS } from './warHud.js';
import { meUid } from '../game/eco.js';
import { SIDE_PT, FAM_PT } from '../game/raids.js';

const KIND_A = { village: 'a vila', castle: 'o castelo', city: 'a cidade' };
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

export function installRaidHud(game) {
  const near = (s, pad) => { const p = game.player; return !!s && !p.dead && Math.hypot(game.world.dx(p.x, s.x), p.y - s.y) < s.r + pad; };
  game.events.on('raid', (e) => {
    const s = game.towns?.realm?.settlements[e.sid];
    if (!s) return;
    const F = FAM_PT[e.r?.fam || e.fam] || FAM_PT.ice;
    if (e.type === 'start' && e.r.live && near(s, 90)) {
      const r = e.r, side = SIDE_PT[r.side & 7], giant = r.giant ? ` e ${/skeleton/.test(r.giant) ? 'o Gigante Esqueleto' : /mummy/.test(r.giant) ? 'a Múmia Gigante' : 'o Gigante de Gelo'}` : '';
      notify(r.horde ? `Uma horda de ${F[0]}${giant} ataca ${s.name} pelo ${side}!` : `${F[0]}${giant} atacam ${s.name} pelo ${side}!`, {
        sub: `${r.n} contra ${plural(r.g, 'guarda', 'guardas')} — o sino toca: o povo corre para casa, os arqueiros sobem nas muralhas e a guarda vai para o ${side}.${r.horde ? ' Os mortos mais antigos: a guarda vai precisar de ajuda.' : ''}`,
        kind: 'warn', icon: WAR_ICONS.swords, ms: 8000, key: 'raid' + e.sid,
      });
      game.audio?.play('town_bell', { x: s.x, y: s.y, volume: 0.5 });
    } else if (e.type === 'fall' && near(s, 90)) {
      notify(`A defesa de ${s.name} caiu!`, { sub: `Os ${F[1]} invadem as ruas — o povo se tranca em casa. Quem ainda luta, lute até o amanhecer.`, kind: 'warn', icon: WAR_ICONS.fall, ms: 8000, key: 'raidfall' + e.sid });
    } else if (e.type === 'end') {
      if (near(s, 120) && (e.live || e.out === 2)) {
        if (e.out === 2) notify(`${s.name} sobreviveu à noite, com perdas`, { sub: `${plural(e.cd, 'morador morto', 'moradores mortos')}, ${plural(e.gd, 'guarda caiu', 'guardas caíram')}, casas arrombadas e a muralha aberta. A partir de amanhã o povo reconstrói ${KIND_A[s.kind] || 'o lugar'}.`, kind: 'warn', icon: WAR_ICONS.castle, ms: 9000, key: 'raidend' + e.sid });
        else notify(`${s.name} resistiu ao ataque`, { sub: `${e.n} ${F[1]} derrotados${e.gd ? ` · ${plural(e.gd, 'guarda caiu', 'guardas caíram')}` : ' · nenhum guarda caiu'}. O povo conserta a muralha de dia.`, kind: 'good', icon: WAR_ICONS.castle, ms: 6500, key: 'raidend' + e.sid });
      }
      // his property hit (anywhere): the owned house / the plot are his to mend; a rented one the people mend
      const me = meUid(game), mine = (e.own || []).filter((q) => q[0] === me);
      for (const [, kind] of mine.slice(0, 3)) {
        if (kind === 'house') notify(`Os monstros danificaram sua casa em ${s.name}: conserte-a você mesmo`, { sub: 'O povo não conserta propriedade privada. Perto de uma parede rachada: Consertar (E); uma peça destruída: Reconstruir (com o material dela). Mural · Propriedades mostra o estrago.', kind: 'warn', icon: WAR_ICONS.castle, sticky: true, key: 'raidown' + e.sid + kind });
        else if (kind === 'plot') notify(`Os monstros danificaram o que você construiu no seu terreno em ${s.name}`, { sub: 'Conserte você mesmo: perto de uma peça rachada, Consertar (E). As rachaduras não somem ao amanhecer.', kind: 'warn', icon: WAR_ICONS.castle, sticky: true, key: 'raidown' + e.sid + kind });
        else notify(`Os monstros danificaram a casa que você aluga em ${s.name}`, { sub: 'O povo conserta as casas alugadas a partir de amanhã.', kind: 'info', icon: WAR_ICONS.castle, ms: 7000, key: 'raidown' + e.sid + kind });
      }
    }
  });
  return { sync: 'cosmetic', update() {} };
}
