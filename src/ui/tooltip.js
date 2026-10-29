// Rich hover tooltips (desktop): items in the hotbar / backpack / container / equipment, buildings, recipes,
// abilities and HUD buttons. One floating element, delegated listeners, native `title`s suppressed.

import { ITEMS, BUILDINGS, ABILITIES, ABILITY_ORDER, ITEM_CAT_PT } from '../game/data.js';
import { RECIPES, STATION_PT, stationsOf } from '../game/content/recipes.js';
import { abilityKeys, keyLabel } from '../game/controller.js';
import { itemStats } from './panels.js';
import { itemIco } from './econIcons.js';
import { uiScale } from './uiscale.js';

const ERA_PT = ['Primitiva', 'Pedra', 'Cobre', 'Ferro', 'Aço'];
const ERA_COL = ['#cfc6b0', '#c9c2b4', '#e0a070', '#b8c8d8', '#d8e4f0'];
const SEL = '[data-hb],[data-slot],[data-cslot],[data-eq],[data-build],[data-craft],[data-ab],[data-tip]';

export function installTooltips(game) {
  const tip = document.createElement('div');
  tip.className = 'rtip hidden';
  document.body.appendChild(tip);
  let cur = null, mx = 0, my = 0;
  const p = game.player, A = game.A;
  const desktop = () => document.getElementById('hud')?.classList.contains('desktop');

  const itemHTML = (id, extra = '') => {
    const d = ITEMS[id];
    if (!d) return '';
    const stats = itemStats(id).map((s) => `<li>${s}</li>`).join('');
    const era = d.tier != null ? `<span style="color:${ERA_COL[d.tier] || '#ccc'}">era ${ERA_PT[d.tier] || d.tier}</span>` : '';
    const have = p.inv.count(id);
    return `<div class="rt-h">${itemIco(A, id)}<div><b>${d.name}</b><small>${ITEM_CAT_PT[d.cat] || ''}${era ? ' · ' + era : ''}</small></div></div>
      ${d.desc ? `<p>${d.desc}</p>` : ''}${stats ? `<ul>${stats}</ul>` : ''}
      <div class="rt-f">${have ? `Na mochila: <b>${have}</b>` : ''}${extra}</div>`;
  };
  const hints = (id, where) => {
    const d = ITEMS[id];
    if (!d) return '';
    const h = [];
    if (where === 'hb') h.push(d.slot ? 'Tecla/clique: equipar ou guardar' : d.food ? 'Tecla/clique: comer' : d.seed ? 'Tecla/clique: escolher semente' : '');
    if (where === 'inv') { if (d.slot) h.push('Clique: detalhes · arraste para a barra ou para o equipamento'); else h.push('Arraste para a barra (1–0) ou para um baú'); }
    if (where === 'hb') h.push('Botão direito: tirar da barra');
    return h.filter(Boolean).map((x) => `<div class="rt-k">${x}</div>`).join('');
  };

  const html = (el) => {
    if (el.dataset.hb != null) {
      const s = game.ui.hotbar?.slots[+el.dataset.hb];
      if (!s) return `<b>Slot ${(+el.dataset.hb + 1) % 10}</b><p class="m">Vazio. Arraste um item da mochila (I) ou uma construção (B).</p>`;
      if (s.k === 'build') return buildHTML(s.id) + '<div class="rt-k">Tecla/clique: construir · botão direito: tirar da barra</div>';
      return itemHTML(s.id, hints(s.id, 'hb'));
    }
    if (el.dataset.slot != null) { const s = p.inv.slots[+el.dataset.slot]; return s ? itemHTML(s.id, (s.qty > 1 ? ` · pilha ${s.qty}` : '') + hints(s.id, 'inv')) : ''; }
    if (el.dataset.cslot != null) { const s = game.ui.panels?.container?.items()[+el.dataset.cslot]; return s ? itemHTML(s.id, `<div class="rt-k">Clique ou arraste: pegar ${s.qty > 1 ? s.qty : ''}</div>`) : ''; }
    if (el.dataset.eq != null) { const id = p.equip[el.dataset.eq]; return id ? itemHTML(id, '<div class="rt-k">Equipado · arraste para a mochila para tirar</div>') : ''; }
    if (el.dataset.build != null) return buildHTML(el.dataset.build) + '<div class="rt-k">Clique: construir · arraste para a barra (1–0)</div>';
    if (el.dataset.craft != null) {
      const r = RECIPES[el.dataset.craft];
      if (!r) return '';
      const ing = Object.entries(r.in).map(([k, n]) => `<li class="${p.inv.count(k) >= n ? '' : 'no'}">${ITEMS[k]?.name}: ${p.inv.count(k)}/${n}</li>`).join('');
      return itemHTML(r.out, `<div class="rt-k">Precisa: ${stationsOf(r).map((x) => STATION_PT[x]).join(' / ')} · ${String(r.time).replace('.', ',')} s</div>`) + (ing ? `<ul class="ing">${ing}</ul>` : '');
    }
    if (el.dataset.ab != null) {
      const id = el.dataset.ab;
      if (id === 'attack') return '<b>Atacar</b><span class="key">Espaço</span><p>Ataca o alvo, ou o inimigo mais perto. Golpeia quando ele estiver ao alcance — chegue perto andando. Esc para.</p>';
      const ab = ABILITIES[id];
      if (!ab) return '';
      const k = abilityKeys(ABILITY_ORDER)[ABILITY_ORDER.indexOf(id)];
      const meta = [ab.cost ? `${ab.cost} energia` : 'sem custo', ab.cd ? `recarga ${ab.cd} s` : '', ab.cast ? `conjuração ${String(ab.cast).replace('.', ',')} s` : ''].filter(Boolean).join(' · ');
      return `<b>${ab.name}</b>${k ? `<span class="key">${keyLabel(k)}</span>` : ''}<p>${ab.desc || ''}</p><div class="rt-f">${meta}</div>`;
    }
    if (el.dataset.tip) return el.dataset.tip;
    return '';
  };

  function buildHTML(id) {
    const b = BUILDINGS[id];
    if (!b) return '';
    const cost = Object.entries(b.cost).map(([k, n]) => `<li class="${p.inv.count(k) >= n ? '' : 'no'}">${ITEMS[k]?.name}: ${p.inv.count(k)}/${n}</li>`).join('') || '<li>grátis</li>';
    const size = b.size && b.size[0] * b.size[1] > 1 ? ` · ${b.size[0]}×${b.size[1]}` : '';
    return `<b>${b.name}</b><small class="m">Construção${size}${b.drag ? ' · custo por tile' : ''}</small><p>${b.desc || ''}</p><ul class="ing">${cost}</ul>`;
  }

  const place = () => {
    const r = tip.getBoundingClientRect();
    let x = mx + 16, y = my + 18;
    if (x + r.width > innerWidth - 8) x = mx - r.width - 12;
    if (y + r.height > innerHeight - 8) y = my - r.height - 12;
    const s = uiScale(); // the tooltip is zoomed with the HUD: its own px are viewport px / s
    tip.style.transform = `translate(${Math.max(8, x) / s}px, ${Math.max(8, y) / s}px)`;
  };
  const show = (el) => {
    const h = html(el);
    if (!h) { hide(); return; }
    cur = el;
    if (el.title) { el.dataset.title = el.title; el.removeAttribute('title'); }
    tip.innerHTML = h;
    tip.classList.remove('hidden');
    place();
  };
  const hide = () => { cur = null; tip.classList.add('hidden'); };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !desktop() || document.body.classList.contains('dnd-on')) return;
    const el = e.target.closest?.(SEL);
    if (!el || !el.closest('#hud')) { if (cur) hide(); return; }
    if (el !== cur) show(el);
  });
  document.addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; if (cur) { if (!cur.isConnected) hide(); else place(); } });
  document.addEventListener('pointerdown', () => hide(), true);
  // panels re-render under the cursor: refresh the content when the hovered node is replaced
  setInterval(() => { if (cur && !cur.isConnected) hide(); }, 300);
}
