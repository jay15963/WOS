// Configurações → Controles (desktop): every action with two bindings; click one, then press the new key or mouse
// button (middle and side buttons too). Esc cancels, Backspace / Delete clears. A key taken from another action is
// said out loud. Saved at once (game/keymap.js → localStorage `wos.keys`) and live in the game (event 'keymap').

import { ACTIONS, GROUPS, BIND, bindKey, resetKeys, codeLabel, isDefault } from '../game/keymap.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function keybindsPane(el, { game = null } = {}) {
  let cap = null;     // { id, slot, btn } while waiting for a key
  let note = '';
  const render = () => {
    const groups = {};
    for (const [id, label, g] of ACTIONS) (groups[g] ||= []).push([id, label]);
    el.innerHTML = `
      <p class="muted">Clique num atalho e aperte a nova tecla ou botão do mouse (o do meio e os laterais também).
        <b>Esc</b> cancela · <b>Backspace</b> deixa sem tecla. Cada ação aceita até duas teclas. Fica salvo neste navegador.</p>
      <p class="kb-note ${note ? '' : 'hidden'}" data-k="note">${esc(note)}</p>
      ${Object.entries(groups).map(([g, list]) => `<h3>${GROUPS[g]}</h3><div class="kb-list">${list.map(([id, label]) => `
        <div class="kb-row"><span class="kb-l">${esc(label)}</span>${[0, 1].map((s) => {
          const c = BIND[id][s];
          return `<button class="kb-k ${c ? '' : 'none'}" data-id="${id}" data-s="${s}">${c ? esc(codeLabel(c)) : '—'}</button>`;
        }).join('')}</div>`).join('')}</div>`).join('')}
      <div class="row"><button class="mbtn" data-a="reset" ${isDefault() ? 'disabled' : ''}>Restaurar os atalhos padrão</button></div>
      <input class="kb-trap" aria-hidden="true" tabindex="-1">`;
    el.querySelector('[data-a=reset]').onclick = () => { stop(); resetKeys(); note = 'Atalhos padrão restaurados.'; render(); };
  };
  const trap = () => el.querySelector('.kb-trap');
  const stop = () => {
    if (!cap) return;
    cap = null;
    if (game?.input) game.input.captureMouse = false;
    trap()?.blur();
  };
  const finish = (code, clear = false) => {
    const { id, slot } = cap;
    stop();
    const took = clear ? null : bindKey(id, slot, code);
    if (clear) bindKey(id, slot, null);
    note = clear ? '' : took ? `${codeLabel(code)} saiu de “${took}”, que ficou sem essa tecla.` : '';
    render();
  };
  el.addEventListener('click', (e) => {
    let b = e.target.closest('.kb-k');
    if (!b) return;
    const was = !!cap || el.querySelector('.kb-k.wait');
    stop();
    if (was) { render(); b = el.querySelector(`.kb-k[data-id="${b.dataset.id}"][data-s="${b.dataset.s}"]`); } // another slot while waiting
    cap = { id: b.dataset.id, slot: +b.dataset.s, btn: b };
    for (const q of el.querySelectorAll('.kb-k.wait')) q.classList.remove('wait');
    b.classList.add('wait');
    b.textContent = 'Aperte…';
    if (game?.input) game.input.captureMouse = true;
    // a hidden field holds the focus: the game ignores the keys, Esc only blurs it in the pause menu
    trap()?.focus({ preventScroll: true });
  });
  const onKey = (e) => {
    if (!cap) return;
    e.preventDefault(); e.stopPropagation();
    if (e.code === 'Escape') { stop(); render(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { finish(null, true); return; }
    if (!e.code || /^(Meta|OS)/.test(e.code)) return;
    finish(e.code);
  };
  const onMouse = (e) => {
    if (!cap || (e.pointerType && e.pointerType !== 'mouse')) return;
    if (e.button === 1 || e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation(); finish('Mouse' + e.button); return; }
    if (e.target !== cap.btn && !e.target.closest?.('.kb-k')) { stop(); render(); } // a left / right click elsewhere cancels
  };
  const noNav = (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); }; // side buttons: never back / forward
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onMouse, true);
  addEventListener('pointerup', noNav, true);
  addEventListener('mouseup', noNav, true);
  render();
  return () => { stop(); removeEventListener('keydown', onKey, true); removeEventListener('pointerdown', onMouse, true); removeEventListener('pointerup', noNav, true); removeEventListener('mouseup', noNav, true); };
}
