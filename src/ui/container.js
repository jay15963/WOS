// Container adapters for the transfer window (Mochila ↔ container), so one window serves chests, bodies and
// any future container. Contract (also produced by src/game/corpses.js corpseContainer):
//   { key, kind, id, title, label, cols, items() → slots [{id, qty}|null], size(), valid() → keep open?,
//     put(bagSlot), take(containerSlot), sort(mode), sortBag(mode) }   mode: 'alpha' | 'type' | 'qty'
// put / take / sort go through the host (intents); sortBag sorts the local backpack.

import { sortInventory, SORT_MODES, SORT_PT } from '../game/itemsort.js';

export function chestContainer(game, o) {
  const p = game.player, net = game.net;
  const fail = (why) => game.events.emit('error', { text: why || 'Não deu' });
  return {
    key: 'chest:' + o.id, kind: 'chest', id: o.id, chest: o, title: 'Baú', label: 'Baú', cols: 5,
    items: () => (o.store ? o.store.slots : []),
    size: () => o.store?.size || 0,
    valid: () => !!o.store && game.build.structures.includes(o) && Math.hypot(o.x - p.x, o.y - p.y) <= 2.6,
    put(i) {
      const s = p.inv.slots[i];
      if (!s) return;
      if (o.store.room(s.id) <= 0) { fail('Baú cheio'); return; }
      // the whole stack leaves the backpack now; the host stores it (leftovers / refusal come back)
      const it = p.inv.takeSlot(i);
      net.request('chest.put', { id: o.id, item: it.id, qty: it.qty }, { refund: { [it.id]: it.qty }, onReject: (why) => fail(why || 'Baú cheio') });
      game.audio?.play('pickup', {});
      game.events.emit('inventory', {});
    },
    take(i) {
      const s = o.store.slots[i];
      if (!s) return;
      const room = p.inv.room(s.id);
      if (room <= 0) { fail('Mochila cheia'); return; }
      net.request('chest.take', { id: o.id, slot: i, qty: Math.min(room, s.qty) }, { onReject: fail });
      game.audio?.play('pickup', {});
    },
    sort(mode) { net.request('store.sort', { kind: 'chest', id: o.id, mode }, { onReject: fail }); },
    sortBag(mode) { sortInventory(p.inv, mode); game.events.emit('inventory', {}); },
  };
}

// sort buttons (side = 'bag' | 'box'); styles injected once
export function sortBar(side) {
  injectCss();
  return `<span class="sortbar">${SORT_MODES.map((m) => `<button class="sortb" data-sort="${side}:${m}" title="Ordenar: ${SORT_PT[m]}">${SHORT[m]}</button>`).join('')}</span>`;
}
const SHORT = { alpha: 'A–Z', type: 'Tipo', qty: 'Qtd.' };
let css = false;
function injectCss() {
  if (css || typeof document === 'undefined') return;
  css = true;
  const st = document.createElement('style');
  st.textContent = '.sortbar{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle}'
    + '.sortbar .sortb{height:22px!important;min-width:0!important;padding:0 7px!important;border-radius:4px!important;font-size:11px!important;font-weight:700!important;'
    + 'background:var(--panel-3,#3a3226)!important;border:1px solid var(--border,#5a4a36)!important;color:inherit;cursor:pointer}'
    + '.sortbar .sortb:hover{border-color:var(--border-hi,#c9a45a)!important}.sortbar .sortb:active{transform:translateY(1px)}';
  document.head.appendChild(st);
}
