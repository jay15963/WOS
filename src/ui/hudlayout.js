// Mobile HUD layout: the player moves the HUD blocks wherever they like (Configurações → HUD → "Organizar a HUD").
// Offsets (HUD css px, i.e. client px / ui scale) are kept per orientation in localStorage `wos.hudlayout`
// = { land: { block: [dx, dy] }, port: { … } } and applied as the CSS `translate` property, which composes with each
// block's own position / transform (the action bar keeps placing its buttons; the offset rides on top).
// Touch only: on a desktop layout the offsets are cleared (the desktop HUD has its own fixed layout).

import { uiScale } from './uiscale.js';

// [id, selector inside #hud, label]
export const BLOCKS = [
  ['card', '.tl-top', 'Vida e alvo'],
  ['quick', '#quick', 'Mochila · Criar · Construir'],
  ['status', '#status', 'Efeitos ativos'],
  ['sys', '.tr .sys', 'Tela cheia · Ajuda'],
  ['radar', '#radar', 'Radar e relógio'],
  ['combat', '#ab', 'Combate (tudo)'],
  ['interact', '#ab-int', 'Usar'],
  ['eat', '.qb[data-q=eat]', 'Comer'],
];
const KEY = 'wos.hudlayout';
const orient = () => (innerWidth > innerHeight ? 'land' : 'port');
const zf = () => uiScale() || 1;

function readAll() { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && typeof d === 'object' ? d : {}; } catch { return {}; } }
function writeAll(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } }
export const hasCustomLayout = () => Object.values(readAll()).some((o) => o && Object.keys(o).length);

const touchOn = (root) => !!root?.classList.contains('touch');
const elOf = (root, sel) => root.querySelector(sel);

// put the saved offsets on the blocks (or clear them: desktop / no layout)
export function applyHudLayout(root = document.getElementById('hud')) {
  if (!root) return;
  const L = touchOn(root) ? readAll()[orient()] || {} : {};
  for (const [id, sel] of BLOCKS) {
    const el = elOf(root, sel);
    if (!el) continue;
    const o = L[id];
    el.style.translate = o && (o[0] || o[1]) ? `${o[0]}px ${o[1]}px` : '';
  }
}

export function resetHudLayout(root = document.getElementById('hud')) {
  const d = readAll();
  delete d.land; delete d.port;
  writeAll(d);
  applyHudLayout(root);
}

// keep the offsets fresh: orientation changes, the touch / desktop switch
export function installHudLayout(root) {
  let last = '';
  const check = () => { const k = orient() + touchOn(root); if (k !== last) { last = k; applyHudLayout(root); } };
  addEventListener('resize', check);
  new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ['class'] });
  check();
}

// ---------- the editor ----------
let editing = null;
export function startHudEditor(game, root = document.getElementById('hud')) {
  if (editing || !root) return;
  const ori = orient(), all = readAll(), L = { ...(all[ori] || {}) };
  root.classList.add('hud-editing');
  if (game?.ui) game.ui.modal = true;
  const ov = document.createElement('div');
  ov.className = 'hud-edit';
  ov.innerHTML = `<div class="he-bar"><span>Arraste os blocos para onde preferir</span>
    <button class="he-b" data-a="reset">Restaurar padrão</button><button class="he-b ok" data-a="done">Concluir</button></div>`;
  document.body.appendChild(ov);
  const handles = [];
  for (const [id, sel, label] of BLOCKS) {
    const el = elOf(root, sel);
    if (!el) continue;
    const h = document.createElement('div');
    h.className = 'he-h';
    h.dataset.id = id;
    h.innerHTML = `<span>${label}</span>`;
    ov.appendChild(h);
    handles.push({ id, el, h });
  }
  // the box of a block: the combat bar is a size-less box holding absolutely placed buttons (their union, without
  // the use / eat buttons that have handles of their own); an empty block (no effects yet) gets a spot to place it
  const rectOf = (q) => {
    const r = q.el.getBoundingClientRect();
    if (q.id === 'combat') {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const c of q.el.children) {
        if (c.classList.contains('hidden') || c.id === 'ab-int' || c.id === 'ab-rm' || c.id === 'ab-bp' || c.dataset.q === 'eat') continue;
        const b = c.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
      }
      if (x1 > x0) return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    }
    if (q.id === 'status' && (r.width < 2 || r.height < 2)) return { left: r.left, top: r.top, width: 120, height: 30 };
    return r;
  };
  // the handle boxes follow the blocks (combat sits under the use / eat handles)
  const place = () => {
    for (const q of handles) {
      const r = rectOf(q);
      const ok = r.width > 2 && r.height > 2;
      q.h.style.display = ok ? '' : 'none';
      if (!ok) continue;
      Object.assign(q.h.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: q.id === 'combat' ? 1 : 2 });
    }
  };
  const set = (q, dx, dy) => { L[q.id] = [Math.round(dx), Math.round(dy)]; q.el.style.translate = `${L[q.id][0]}px ${L[q.id][1]}px`; };
  // never off screen: at least 28 px of the block stays visible
  const clamp = (q) => {
    const r = rectOf(q), z = zf(), m = 28;
    r.right ??= r.left + r.width; r.bottom ??= r.top + r.height;
    let [dx, dy] = L[q.id] || [0, 0];
    if (r.right < m) dx += (m - r.right) / z;
    if (r.left > innerWidth - m) dx -= (r.left - (innerWidth - m)) / z;
    if (r.bottom < m) dy += (m - r.bottom) / z;
    if (r.top > innerHeight - m) dy -= (r.top - (innerHeight - m)) / z;
    set(q, dx, dy);
  };
  let drag = null;
  ov.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.he-h');
    if (!h) return;
    const q = handles.find((x) => x.h === h);
    const [dx, dy] = L[q.id] || [0, 0];
    drag = { q, x: e.clientX, y: e.clientY, dx, dy, id: e.pointerId };
    h.setPointerCapture?.(e.pointerId);
    h.classList.add('on');
    e.preventDefault();
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const z = zf();
    set(drag.q, drag.dx + (e.clientX - drag.x) / z, drag.dy + (e.clientY - drag.y) / z);
    place();
  });
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.q.h.classList.remove('on');
    clamp(drag.q);
    drag = null;
    place();
    all[ori] = L; writeAll(all);
  };
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
  const finish = () => {
    all[ori] = L; writeAll(all);
    ov.remove();
    root.classList.remove('hud-editing');
    removeEventListener('resize', onResize);
    if (game?.ui) game.ui.modal = false;
    editing = null;
  };
  ov.querySelector('[data-a=done]').onclick = finish;
  ov.querySelector('[data-a=reset]').onclick = () => {
    for (const k of Object.keys(L)) delete L[k];
    for (const q of handles) q.el.style.translate = '';
    all[ori] = L; writeAll(all);
    requestAnimationFrame(place);
  };
  // turning the phone ends the session (each orientation has its own layout)
  const onResize = () => { if (orient() !== ori) finish(); else place(); };
  addEventListener('resize', onResize);
  editing = { finish };
  requestAnimationFrame(place);
  setTimeout(place, 250);
}

// Configurações → HUD (touch)
export function hudLayoutPane(el, { game = null } = {}) {
  const inGame = !!(game && document.getElementById('hud'));
  el.innerHTML = `
    <h3>Posição dos botões</h3>
    <p class="muted">Arraste a vida, o radar, os botões de combate, de usar e de comer para onde ficar melhor para os seus dedos.
      Cada orientação da tela (deitada ou em pé) guarda a sua própria arrumação, e ela fica salva para as próximas vezes.</p>
    ${inGame ? '<div class="row"><button class="mbtn primary" data-a="edit">Organizar a HUD</button></div>'
      : '<p class="muted">Entre num mundo e abra <b>Configurações</b> pelo menu do jogo para organizar.</p>'}
    <div class="row"><button class="mbtn" data-a="reset" ${hasCustomLayout() ? '' : 'disabled'}>Restaurar a posição padrão</button></div>
    <p class="muted" data-k="msg"></p>`;
  el.querySelector('[data-a=edit]')?.addEventListener('click', () => {
    game.events.emit('closepanels', {});
    setTimeout(() => startHudEditor(game), 60);
  });
  el.querySelector('[data-a=reset]').onclick = (e) => {
    resetHudLayout();
    e.currentTarget.disabled = true;
    el.querySelector('[data-k=msg]').textContent = 'Posições padrão restauradas.';
  };
}
