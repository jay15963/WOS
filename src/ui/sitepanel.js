// Work-site materials (owner's request): next to the use button a "Obra" button shows while the local player stands
// at a site of blueprints (game/blueprints.js): it opens the list of materials still needed to finish the whole
// site against what the player carries ("12/45 madeira"), live — plans that are built or started drop out.
// Desktop: also the key of the 'site' action (O). The card closes on the button again, ✕, Esc, a tap / click
// outside it, or as soon as the player moves; its header (with ✕) stays in view when the list scrolls.

import { siteNear, siteMaterials } from '../game/blueprints.js';
import { BUILDINGS, ITEMS } from '../game/data.js';
import { itemIco, buildIco } from './econIcons.js';
import { uiIcon } from './icons.js';

export function installSitePanel(game, root, { press, keyLabel }) {
  const btn = document.createElement('button');
  btn.className = 'ab ab-bp hidden';
  btn.id = 'ab-bp';
  btn.title = 'Materiais da obra';
  btn.innerHTML = `<span class="ic">${uiIcon(game.A, 'clipboard')}</span><span class="lbl">Obra</span><span class="key"></span>`;
  root.querySelector('#ab')?.appendChild(btn);
  const card = document.createElement('div');
  card.className = 'sitecard hidden';
  card.id = 'sitecard';
  root.appendChild(card);
  let open = false, site = null, shown = false, t = 0, key = '', placed = '', at = null;

  const close = () => { open = false; card.classList.add('hidden'); };
  const toggleCard = () => {
    if (open) { close(); return; }
    if (!site) return;
    open = true; key = ''; at = [game.player.x, game.player.y];
    render(); card.classList.remove('hidden');
  };
  press(btn, toggleCard);
  game.events.on('sitemats', toggleCard);
  card.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) close(); });
  addEventListener('keydown', (e) => { if (open && e.code === 'Escape') close(); });
  // a tap / click anywhere else closes it (the button toggles it itself)
  addEventListener('pointerdown', (e) => { if (open && !card.contains(e.target) && !btn.contains(e.target)) close(); }, true);

  function render() {
    const A = game.A, p = game.player, s = site;
    if (!s) return;
    const mats = siteMaterials(s, p.inv);
    const k = s.plans.length + '|' + s.paid + '|' + mats.map((m) => m.id + m.need + ':' + m.have).join(',') + '|' + !!game.creative;
    if (k === key) return;
    key = k;
    const left = s.plans.length - s.paid, missing = mats.filter((m) => m.have < m.need);
    const types = Object.entries(s.types).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([ty, n]) => `<span class="st">${buildIco(A, ty)}${n}× ${BUILDINGS[ty]?.name || ty}</span>`).join('');
    const rows = game.creative ? '<p class="sc-free">Grátis no criativo</p>' : mats.length ? mats.map((m) => {
      const ok = m.have >= m.need;
      return `<div class="sr ${ok ? 'ok' : 'lack'}"><span class="si">${itemIco(A, m.id)}</span><span class="sn">${ITEMS[m.id]?.name || m.id}</span><span class="sv"><b>${m.have}</b>/${m.need}</span></div>`;
    }).join('') : '<p class="sc-free">Nada mais a juntar: o material já está na obra</p>';
    const sum = game.creative || !mats.length ? '' : missing.length
      ? `<p class="sc-miss">Falta: ${missing.map((m) => `${m.need - m.have} ${(ITEMS[m.id]?.name || m.id).toLowerCase()}`).join(', ')}</p>`
      : '<p class="sc-ok">Você tem tudo para terminar a obra</p>';
    card.innerHTML = `<div class="sc-h"><b>Materiais da obra</b><button class="sc-x" data-x aria-label="Fechar">✕</button></div>
      <p class="sc-sub">${left} ${left === 1 ? 'planta' : 'plantas'} a construir${s.paid ? ` · ${s.paid} já com material` : ''}</p>
      <div class="sc-types">${types}</div>
      <div class="sc-rows">${rows}</div>${sum}
      <p class="sc-hint">${game.input.isTouch ? 'Toque numa planta azul para construir' : 'Clique numa planta azul para construir'}: o material sai da mochila quando a obra começa.</p>`;
  }

  return {
    update(dt) {
      t -= dt;
      if (t > 0) return;
      t = 0.25;
      const p = game.player;
      const busy = p.dead || !!game.build.mode;
      site = busy ? null : siteNear(game, p.x, p.y);
      const on = !!site;
      if (on !== shown) { shown = on; btn.classList.toggle('hidden', !on); }
      if (!site && open) close();
      // moving closes it (the list is for a look while standing at the site)
      if (open && at && Math.hypot(p.x - at[0], p.y - at[1]) > 0.3) close();
      if (open) render();
      const kl = keyLabel?.() || '';
      if (kl !== placed) { placed = kl; btn.querySelector('.key').textContent = kl; }
    },
    btn,
  };
}
