// Work bar (top centre): build placement (name, cost × tiles, hint, ✓ / ✕) and deconstruct mode.
// (The old pending-jobs chip is gone: auto-work is opt-in and shows its own banner, src/ui/buildbar.js.)

import { BUILDINGS, ITEMS } from '../game/data.js';
import { commitPlacement, exitBuildMode } from '../game/building.js';
import { svgIcon } from './icons.js';
import { econIcon, buildIco, itemIco } from './econIcons.js';

function press(el, fn) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(e); });
  const up = () => el.classList.remove('down');
  el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up);
}

export function installWorkbar(game, root) {
  const A = game.A;
  const bar = document.createElement('div');
  bar.className = 'workbar hidden';
  bar.innerHTML = `<span class="wb-ic"></span><span class="wb-tx"><b></b><small class="wb-cost"></small><small class="wb-hint"></small></span>
    <button class="bb-b ok wb-ok" title="Construir (Enter)">${svgIcon('check')}</button><button class="bb-b no wb-no" title="Cancelar (Esc)">${svgIcon('close')}</button>`;
  root.appendChild(bar);
  const $ = (s) => bar.querySelector(s);
  const R = { ic: $('.wb-ic'), nm: $('.wb-tx b'), cost: $('.wb-cost'), hint: $('.wb-hint'), ok: $('.wb-ok'), no: $('.wb-no') };
  press(R.ok, () => {
    const m = game.build.mode;
    if (m?.kind === 'place') commitPlacement(game);
    else if (m?.kind === 'decon') exitBuildMode(game);
  });
  press(R.no, () => {
    const m = game.build.mode;
    if (m?.kind === 'place' && m.anchor) { m.anchor = m.end = null; m.locked = false; return; }
    if (m) exitBuildMode(game);
  });

  const last = {};
  const set = (k, el, v, html = false) => { if (last[k] !== v) { last[k] = v; if (html) el.innerHTML = v; else el.textContent = v; } };
  let t = 0;
  return {
    update(dt) {
      t -= dt;
      if (t > 0) return;
      t = 0.1;
      const m = game.build.mode, touch = document.getElementById('hud')?.classList.contains('touch');
      const mode = m ? m.kind + (m.type || '') : '';
      if (last.mode !== mode) { last.mode = mode; bar.classList.toggle('hidden', !mode); }
      if (m?.kind === 'place') {
        const def = BUILDINGS[m.type];
        set('ic', R.ic, buildIco(A, m.type), true);
        set('nm', R.nm, def.name);
        const per = Object.entries(def.cost).map(([k, n]) => `${n} ${ITEMS[k].name.toLowerCase()}`).join(' + ') || 'grátis';
        const n = m.n || 0;
        set('cost', R.cost, n > 1 ? `${n} tiles · ${per} cada` : per);
        let hint;
        if (!m.valid && m.reason) hint = m.reason;
        else if (def.drag) hint = touch ? (m.anchor ? (m.end ? 'Toque ✓ (ou no fim de novo) para construir' : 'Toque no fim da linha / canto · ✓ = só este') : 'Toque onde começa') : 'Clique ou arraste · botão direito cancela';
        else hint = touch ? (m.locked ? 'Toque de novo ou ✓ para construir' : 'Toque no local') : 'Clique para construir · Esc cancela';
        set('hint', R.hint, hint);
        R.ok.classList.toggle('bad', !m.valid);
        R.ok.classList.remove('hidden');
        R.hint.classList.toggle('bad', !m.valid && !!m.reason);
      } else if (m?.kind === 'decon') {
        set('ic', R.ic, econIcon(A, 'decon'), true);
        set('nm', R.nm, 'Desmontar');
        set('cost', R.cost, `${game.build.decon.size} marcada(s) · devolve 75%`);
        set('hint', R.hint, touch ? 'Toque nas construções (planta: cancela)' : 'Clique ou arraste sobre construções');
        R.ok.classList.add('hidden');
        R.hint.classList.remove('bad');
      }
    },
  };
}

export { itemIco };
