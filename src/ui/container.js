// Container window contract (chest today; corpses by agent I, any future container): the window shows the
// player's backpack beside the container, with click-to-transfer (desktop: drag-and-drop too, hotbar.js)
// and sort buttons on both sides. One adapter describes the container:
//
//   openContainer(game, {
//     id:      'chest:<structId>' | 'corpse:<id>' …  unique key (also remembers the last sort of this container)
//     title:   'Baú',            icon?: html (window title icon), label?: 'Baú' (heading over its slots), cols?: 5
//     items(): Array<{id, qty} | null>     current slots, read on every render
//     put(i, n):  move n items of backpack slot i into the container → shared containers send an intent
//                 (the whole stack leaves the backpack at once; refunds / leftovers come back via the op)
//     take(i, n): move up to n items of container slot i into the backpack (n = room in the backpack)
//     sort(mode): 'name' | 'type' | 'qty' — shared containers: host intent → op (chest.sort → chest.set)
//     canOpen():  still valid and in reach? (checked every frame; the window closes when false)
//     event?:  game event name that means "contents changed" (re-render), e.g. 'chest'; 'container' always works
//     chest?:  the chest structure (chests only: A's lid animation reads panels.data.chest)
//   })
//
// The window re-renders on 'inventory', on adapter.event and on game.events.emit('container', { id }).

import { buildIco } from './econIcons.js';

export function openContainer(game, adapter) {
  const P = game.ui?.panels;
  if (!P || !adapter) return false;
  P.show(adapter.chest ? 'chest' : 'container', { adapter, chest: adapter.chest || null });
  return true;
}

// the chest adapter (shared world state: every change is an intent to the host, docs/SYNC.md §3.3)
export function chestAdapter(game, o) {
  const err = (t) => (why) => game.events.emit('error', { text: why || t });
  return {
    id: 'chest:' + o.id, title: 'Baú', label: 'Baú', icon: buildIco(game.A, 'chest'), cols: 5, event: 'chest', chest: o,
    items: () => o.store?.slots || [],
    put(i, n) {
      const p = game.player, s = p.inv.slots[i];
      if (!s || !o.store) return false;
      if (o.store.room(s.id) <= 0) { game.events.emit('error', { text: 'Baú cheio' }); return false; }
      const it = n >= s.qty ? p.inv.takeSlot(i) : (p.inv.remove(s.id, n), { id: s.id, qty: n });
      game.net.request('chest.put', { id: o.id, item: it.id, qty: it.qty }, { refund: { [it.id]: it.qty }, onReject: err('Baú cheio') });
      return true;
    },
    take(i, n) {
      const s = o.store?.slots[i];
      if (!s) return false;
      const room = game.player.inv.room(s.id);
      if (room <= 0) { game.events.emit('error', { text: 'Mochila cheia' }); return false; }
      game.net.request('chest.take', { id: o.id, slot: i, qty: Math.min(room, n, s.qty) }, { onReject: err('Não deu') });
      return true;
    },
    sort(mode) { game.net.request('chest.sort', { id: o.id, mode }, { onReject: err('Não deu para ordenar') }); },
    canOpen() {
      const p = game.player;
      return !!o.store && !o.removed && game.build.structures.includes(o) && Math.hypot(o.x - p.x, o.y - p.y) <= 2.6;
    },
  };
}

