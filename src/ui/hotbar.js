// Desktop hotbar (Minecraft / Terraria feel): 10 slots on keys 1–9, 0 at the bottom centre. A slot holds a
// shortcut — an item id or a building — never the item itself: tools / weapons / shields equip (press again
// to put away), food is eaten, seeds become the planting choice, buildings enter build mode.
// Usable items picked up are added to free slots automatically (unless the player removed them before).
// Also: mouse drag-and-drop between hotbar, backpack, equipment, chest and the build menu (desktop only).
// The layout is kept per world in this browser (localStorage `wos.hotbar.<seed>`), for hosts and guests alike.

import { ITEMS, BUILDINGS } from '../game/data.js';
import { eat } from '../game/survival.js';
import { enterBuildMode, exitBuildMode } from '../game/building.js';
import { equipItem, equipFromSlot, unequip } from '../game/equipment.js';
import { CROPS } from '../game/farming.js';
import { itemIco, buildIco } from './econIcons.js';

const N = 10;
const KEY = 'wos.hotbar'; // + '.<seed>' (+ '.guest'): one layout per world
const autoKind = (d) => !!d && (d.weapon || d.tool || d.slot === 'off' || d.food || d.seed);

export function installHotbar(game, root) {
  const A = game.A, p = game.player;
  const key = `${KEY}.${game.world.seed}${game.net.role === 'guest' ? '.guest' : ''}`;
  const S = load();
  const bar = document.createElement('div');
  bar.className = 'hotbar';
  bar.innerHTML = Array.from({ length: N }, (_, i) => `<button class="hb" data-hb="${i}"><span class="hi"></span><span class="hn"></span><span class="hk">${(i + 1) % 10}</span></button>`).join('');
  root.appendChild(bar);
  const els = [...bar.children];
  const last = new Array(N).fill(null);

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(key) || 'null');
      if (d && Array.isArray(d.slots)) return { slots: Array.from({ length: N }, (_, i) => d.slots[i] || null), skip: new Set(d.skip || []) };
    } catch { /* ignore */ }
    return { slots: new Array(N).fill(null), skip: new Set() };
  }
  const save = () => { if (game.noSave) return; try { localStorage.setItem(key, JSON.stringify({ slots: S.slots, skip: [...S.skip].slice(-60) })); } catch { /* ignore */ } };

  const has = (k, id) => S.slots.findIndex((s) => s && s.k === k && s.id === id);
  const owned = (id) => p.inv.count(id) + Object.values(p.equip || {}).filter((x) => x === id).length;

  // put usable items the player owns into free slots
  const autofill = () => {
    let changed = false;
    const ids = new Set();
    for (const s of p.inv.slots) if (s) ids.add(s.id);
    for (const k of ['main', 'off']) if (p.equip?.[k]) ids.add(p.equip[k]);
    for (const id of ids) {
      if (!autoKind(ITEMS[id]) || S.skip.has(id) || has('item', id) >= 0) continue;
      const free = S.slots.indexOf(null);
      if (free < 0) break;
      S.slots[free] = { k: 'item', id };
      changed = true;
    }
    if (changed) save();
    return changed;
  };

  const set = (i, v) => {
    if (v) { const j = has(v.k, v.id); if (j >= 0 && j !== i) S.slots[j] = null; S.skip.delete(v.id); }
    else if (S.slots[i]) S.skip.add(S.slots[i].id);
    S.slots[i] = v;
    save();
    draw(true);
  };

  const use = (i) => {
    if (p.dead) return;
    const s = S.slots[i];
    flash(i);
    game.audio?.play('hotbar', {});
    if (!s) { game.events.emit('toast', { text: 'Slot vazio: arraste um item da mochila (I) ou uma construção (B) para cá', kind: 'info' }); return; }
    if (s.k === 'build') {
      if (game.build.mode?.type === s.id) exitBuildMode(game);
      else { game.ui.panels?.close(); enterBuildMode(game, s.id); }
      return;
    }
    const d = ITEMS[s.id];
    if (!d) return;
    if (d.slot && p.equip[d.slot] === s.id) { unequip(game, d.slot); return; }
    if (!p.inv.count(s.id)) { game.events.emit('error', { text: `Você não tem ${d.name.toLowerCase()}` }); return; }
    if (d.slot) equipItem(game, s.id);
    else if (d.food) eat(game, s.id);
    else if (d.seed) { p.seedPref = s.id; game.events.emit('toast', { text: `Vai plantar: ${CROPS[d.seed]?.name || d.name}`, kind: 'info' }); }
    else game.events.emit('toast', { text: `${d.name}: material para receitas e construções`, kind: 'info' });
    draw(true);
  };

  const flash = (i) => { const el = els[i]; el.classList.remove('use'); void el.offsetWidth; el.classList.add('use'); };

  const draw = (force = false) => {
    for (let i = 0; i < N; i++) {
      const s = S.slots[i], el = els[i];
      let key = 'e';
      let n = '', on = false, dim = false;
      if (s?.k === 'item') {
        const d = ITEMS[s.id];
        const c = owned(s.id);
        on = !!d?.slot && p.equip[d.slot] === s.id;
        dim = c === 0;
        n = c > 1 || (c === 1 && !d?.slot) ? String(c) : '';
        key = `i${s.id}|${n}|${on}|${dim}`;
      } else if (s?.k === 'build') {
        dim = !p.inv.has(BUILDINGS[s.id]?.cost || {});
        on = game.build.mode?.type === s.id;
        key = `b${s.id}|${on}|${dim}`;
      }
      if (!force && last[i] === key) continue;
      last[i] = key;
      el.classList.toggle('full', !!s);
      el.classList.toggle('on', on);
      el.classList.toggle('dim', dim);
      el.querySelector('.hi').innerHTML = !s ? '' : s.k === 'build' ? buildIco(A, s.id) : itemIco(A, s.id);
      el.querySelector('.hn').textContent = n;
    }
  };

  els.forEach((el, i) => {
    el.addEventListener('click', () => { if (!dnd.justDropped) use(i); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (S.slots[i]) set(i, null); });
  });
  game.events.on('hotbar', (d) => use(d.i));
  game.events.on('inventory', () => { autofill(); draw(); });
  game.events.on('gear', () => draw());
  game.events.on('buildui', () => draw());
  autofill();
  draw(true);

  const api = { slots: S.slots, set, use, draw, el: bar, owned };
  game.ui.hotbar = api;
  const dnd = installDnD(game, api);
  let t = 0;
  return {
    update(dt) { t -= dt; if (t <= 0) { t = 0.25; draw(); } },
  };
}

// ---------- mouse drag-and-drop (desktop) ----------
const SRC = '[data-slot],[data-cslot],[data-eq],[data-hb],[data-build]';

function installDnD(game, hb) {
  const p = game.player, A = game.A;
  const st = { drag: null, justDropped: false };
  let ghost = null, over = null;

  const describe = (el) => {
    if (el.dataset.hb != null) { const s = hb.slots[+el.dataset.hb]; return s ? { from: 'hb', i: +el.dataset.hb, ref: s } : null; }
    if (el.dataset.slot != null) { const s = p.inv.slots[+el.dataset.slot]; return s ? { from: 'inv', i: +el.dataset.slot, ref: { k: 'item', id: s.id } } : null; }
    if (el.dataset.cslot != null) { const c = game.ui.panels?.data?.chest; const s = c?.store?.slots[+el.dataset.cslot]; return s ? { from: 'chest', i: +el.dataset.cslot, ref: { k: 'item', id: s.id } } : null; }
    if (el.dataset.eq != null) { const id = p.equip[el.dataset.eq]; return id ? { from: 'eq', slot: el.dataset.eq, ref: { k: 'item', id } } : null; }
    if (el.dataset.build != null) return { from: 'build', ref: { k: 'build', id: el.dataset.build } };
    return null;
  };
  const icon = (ref) => (ref.k === 'build' ? buildIco(A, ref.id) : itemIco(A, ref.id));

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !document.getElementById('hud')?.classList.contains('desktop')) return;
    const el = e.target.closest?.(SRC);
    if (!el || !el.closest('#hud')) return;
    const info = describe(el);
    if (!info) return;
    st.drag = { el, info, x0: e.clientX, y0: e.clientY, on: false };
  }, true);

  addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      d.on = true;
      ghost = document.createElement('div');
      ghost.className = 'dnd-ghost';
      ghost.innerHTML = icon(d.info.ref);
      document.body.appendChild(ghost);
      document.body.classList.add('dnd-on');
      d.el.classList.add('dnd-src');
      game.audio?.play('ui_click', {});
    }
    ghost.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-hb],[data-slot],[data-cslot],[data-eq],.p-chest,.p-inv');
    if (t !== over) { over?.classList.remove('dnd-over'); over = t; over?.classList.add('dnd-over'); }
  });

  addEventListener('pointerup', (e) => {
    const d = st.drag;
    st.drag = null;
    if (!d || !d.on) return;
    ghost?.remove(); ghost = null;
    over?.classList.remove('dnd-over'); over = null;
    document.body.classList.remove('dnd-on');
    d.el.classList.remove('dnd-src');
    st.justDropped = true;
    setTimeout(() => { st.justDropped = false; }, 0);
    // swallow the click that follows the drop
    const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    addEventListener('click', kill, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', kill, { capture: true }), 50);
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-hb],[data-slot],[data-cslot],[data-eq],.p-chest,.p-inv,.panel');
    drop(d.info, t);
  });

  const P = () => game.ui.panels;
  const rerender = () => { game.events.emit('inventory', {}); P()?.render?.(); hb.draw(true); };

  function drop(src, t) {
    const chest = P()?.open === 'chest' ? P().data?.chest : null;
    // onto a hotbar slot
    if (t?.dataset?.hb != null) {
      const j = +t.dataset.hb;
      if (src.from === 'hb') { const a = hb.slots[src.i], b = hb.slots[j]; hb.slots[src.i] = b; hb.slots[j] = a; hb.set(j, a); }
      else hb.set(j, src.ref);
      game.audio?.play('hotbar', {});
      return;
    }
    if (src.from === 'hb') { hb.set(src.i, null); return; } // dragged off the bar: clear the shortcut
    if (src.from === 'build') return;
    // backpack → backpack: move / swap / merge
    if (src.from === 'inv' && t?.dataset?.slot != null) {
      const j = +t.dataset.slot;
      if (j === src.i) return;
      const S = p.inv.slots, a = S[src.i], b = S[j];
      const max = ITEMS[a.id]?.stack || 99;
      if (b && b.id === a.id && b.qty < max) { const k = Math.min(max - b.qty, a.qty); b.qty += k; a.qty -= k; if (!a.qty) S[src.i] = null; }
      else { S[src.i] = b; S[j] = a; }
      p.inv.version++;
      rerender();
      return;
    }
    // backpack → equipment slot
    if (src.from === 'inv' && t?.dataset?.eq != null) {
      if (ITEMS[src.ref.id]?.slot !== t.dataset.eq) { game.events.emit('error', { text: 'Não serve aqui' }); return; }
      equipFromSlot(game, src.i);
      rerender();
      return;
    }
    // equipment → backpack
    if (src.from === 'eq' && (t?.dataset?.slot != null || t?.classList?.contains('p-inv'))) { unequip(game, src.slot); rerender(); return; }
    // backpack → chest
    if (src.from === 'inv' && chest && (t?.dataset?.cslot != null || t?.closest?.('.chest-side'))) {
      const s = p.inv.slots[src.i];
      if (!s) return;
      if (chest.store.room(s.id) <= 0) { game.events.emit('error', { text: 'Baú cheio' }); return; }
      const it = p.inv.takeSlot(src.i);
      game.net.request('chest.put', { id: chest.id, item: it.id, qty: it.qty }, { refund: { [it.id]: it.qty }, onReject: (why) => game.events.emit('error', { text: why || 'Baú cheio' }) });
      game.audio?.play('pickup', {});
      rerender();
      return;
    }
    // chest → backpack
    if (src.from === 'chest' && chest && (t?.dataset?.slot != null || t?.closest?.('.inv-side'))) {
      const s = chest.store.slots[src.i];
      if (!s) return;
      const room = p.inv.room(s.id);
      if (room <= 0) { game.events.emit('error', { text: 'Mochila cheia' }); return; }
      game.net.request('chest.take', { id: chest.id, slot: src.i, qty: Math.min(room, s.qty) }, { onReject: (why) => game.events.emit('error', { text: why || 'Não deu' }) });
      game.audio?.play('pickup', {});
    }
  }
  return st;
}
