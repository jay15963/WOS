// The war's notices for the local player (docs/REINOS.md §13). Every peer applies the same ops (game/mut/realms.js),
// each news row comes as the event 'realmnews'; here each peer decides what ITS player is told:
//   - a member of a kingdom (economy: realm.join) hears EVERY change of that kingdom's relations and wars — war declared
//     by or against it, peace, alliances made / broken, truces ending, its places besieged / taken / retaken, its armies
//     marching, battles won or lost, the fall of a kingdom — one notice at a time (owner's rule);
//   - anyone else only what is near / relevant (the kingdom it stands in and its neighbours, places within reach of it),
//     without spam (at most one every 20 s; the mural keeps the full list: Reino · Notícias do reino);
//   - whoever holds a house / plot in a place just besieged is warned: if it falls, the properties are lost.
// Cosmetic, local (the notices are UI: ui/notify.js).
import { notify } from './notify.js';
import { newsText } from '../game/realms.js';
import { myRec, meUid, propsOfUid } from '../game/eco.js';

const SVG = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
export const WAR_ICONS = {
  swords: SVG('<path d="M4 4l10 10M14 14l2.2 2.2M16.2 16.2l-1.6 1.6M16.2 16.2l1.6-1.6M17 17l3 3"/><path d="M20 4L10 14M10 14l-2.2 2.2M7.8 16.2l1.6 1.6M7.8 16.2l-1.6-1.6M7 17l-3 3"/>'),
  dove: SVG('<path d="M3 13c3 0 5-2 6-5 1 3 4 4 7 3l5-3-2 5c-1 3-4 5-8 5H8l-4 3 1-4c-1-1-2-2-2-4z"/><path d="M14 8c0-2 1-4 3-4"/>'),
  hands: SVG('<path d="M2 12l4-4 4 2 3-2 3 1 4 3"/><path d="M6 8l-3 6 4 4 3-2 2 2 3-1 4-4-3-4"/><path d="M10 16l2-2M13 17l2-2"/>'),
  flag: SVG('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  castle: SVG('<path d="M4 21V9h3V6h2v3h2V6h2v3h2V6h2v3h3v12z"/><path d="M10 21v-5h4v5"/>'),
  fall: SVG('<path d="M4 21h16"/><path d="M6 21V11l3-2 2 3 3-4 2 2 2-1v12"/><path d="M8 5l8 6M16 5l-8 6"/>'),
};
const ICON_OF = { war: 'swords', battle: 'swords', won: 'swords', siege: 'castle', capture: 'castle', retake: 'castle', lift: 'castle', peace: 'dove', truce: 'dove', ally: 'hands', break: 'hands', march: 'flag', relief: 'flag', fall: 'fall' };
const BIG = new Set(['war', 'peace', 'ally', 'break', 'capture', 'retake', 'fall', 'siege']);

export function installWarHud(game) {
  const q = [];
  let gap = 0, otherT = -1e9;
  game.events.on('realmnews', ({ row }) => { if (row) q.push(row); if (q.length > 12) q.splice(0, q.length - 12); });
  // a sentence about the local player's side
  const sub = (row, mk) => {
    const [, , , type, a, b, sid] = row, R = game.realms, realm = game.towns?.realm, S = realm?.settlements[sid];
    if (mk < 0) return '';
    const mine = (k) => k === mk;
    if (type === 'war') return mine(a) ? 'Seu reino está em guerra: os exércitos marcham e o comércio com o inimigo para.' : mine(b) ? 'Seu reino foi atacado: defenda suas terras.' : '';
    if (type === 'peace') return mine(a) || mine(b) ? 'A guerra acabou para o seu reino. O comércio volta.' : '';
    if (type === 'ally') return mine(a) || mine(b) ? 'Se um de vocês for atacado, o outro entra na guerra.' : '';
    if (type === 'capture' || type === 'retake') return mine(a) ? `${S?.name || 'O lugar'} agora é do seu reino.` : mine(b) ? `Seu reino perdeu ${S?.name || 'um lugar'}.` : '';
    if (type === 'siege' && S && R?.owner?.(sid) === mk) return 'Um lugar do seu reino está cercado.';
    if (type === 'fall') return mine(a) ? 'Seu reino caiu: você volta a ser viajante.' : '';
    return '';
  };
  const relevant = (row) => {
    const [, , , type, a, b, sid] = row, R = game.realms, realm = game.towns?.realm, p = game.player;
    if (!R || !realm || p.dead) return 0;
    const mk = myRec(game)?.k ?? -1;
    const tk = sid >= 0 ? R.owner(sid) : -1;
    if (mk >= 0 && (a === mk || b === mk || tk === mk)) return 2; // (the player's own kingdom: always)
    const hk = R.ownerAt(p.x, p.y), K = hk >= 0 ? realm.kingdoms[hk] : null;
    const near = new Set(K ? [hk, ...K.neighbours] : []);
    if (mk >= 0) { near.add(mk); for (const n of realm.kingdoms[mk].neighbours) near.add(n); }
    const S = realm.settlements[sid], dist = S ? Math.hypot(game.world.dx(S.x, p.x), S.y - p.y) : Infinity;
    if (type === 'fall') return K && realm.kingdoms[a]?.comp === K.comp ? 1 : 0;
    if (['war', 'peace', 'ally', 'break', 'truce'].includes(type)) return a === hk || b === hk || (near.has(a) && near.has(b)) ? 1 : 0;
    if (['march', 'siege', 'capture', 'retake', 'lift', 'relief'].includes(type)) return dist < 1500 || a === hk || b === hk || tk === hk ? 1 : 0;
    if (type === 'battle' || type === 'won') return dist < 900 || a === hk || b === hk ? 1 : 0;
    return 0;
  };
  return {
    sync: 'cosmetic',
    update(g, dt) {
      gap -= dt;
      if (gap > 0 || !q.length || !g.realms) return;
      const row = q.shift();
      const lv = relevant(row);
      // a house / plot of mine in a place just besieged: warned, whoever I am
      if (row[3] === 'siege') {
        const mine = propsOfUid(g, meUid(g)).filter((x) => x.pr.sid === row[6]);
        if (mine.length) {
          const S = g.towns.realm.settlements[row[6]];
          notify(`${S.name} está sob cerco`, { sub: `Se cair, suas propriedades lá serão perdidas (${mine.map((x) => (x.pr.bi != null ? x.pr.name.toLowerCase() : 'terreno')).join(', ')}): o que estiver construído no terreno será destruído.`, kind: 'warn', icon: WAR_ICONS.castle, sticky: true, key: 'siegeprop' + row[6] });
          gap = 3.5;
        }
      }
      if (!lv) return;
      if (lv === 1) { if (g.worldTime - otherT < 20) return; otherT = g.worldTime; }
      const text = newsText(g, row);
      if (!text) return;
      const type = row[3], mk = myRec(g)?.k ?? -1;
      const good = (type === 'peace' || type === 'ally') || ((type === 'capture' || type === 'retake' || type === 'won') && row[4] === mk);
      const kind = good ? 'good' : (type === 'war' || type === 'siege' || type === 'capture' || type === 'fall' || (type === 'won' && row[5] === mk)) ? 'warn' : 'info';
      notify(text, { sub: sub(row, mk) || (lv === 2 ? 'Notícia do seu reino · mural: Reino' : 'Mural: Reino · Notícias do reino'), kind, icon: WAR_ICONS[ICON_OF[type]] || null, ms: lv === 2 && BIG.has(type) ? 9000 : 6500, key: 'war' + row[0] });
      if (lv === 2 && (type === 'war' || type === 'capture' || type === 'fall')) g.audio?.play('town_bell', { volume: 0.35 });
      gap = 3.5;
    },
  };
}
