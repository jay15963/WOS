// Build toolbar + structure context menu + touch build gestures (agent A).
// - Toolbar (bottom centre) while placing: ⟳ girar · ✓ confirmar · ✕ cancelar, the orientation name and what is
//   missing for the whole plan ("Falta: …"). Desktop shows the keys (R / Shift+R, Enter, Esc).
// - Touch in build mode: one finger drags rows / areas (walls, fences, floors) or carries the ghost (single props);
//   a second finger cancels the paint so the gesture stays a pinch zoom (read from game.input when it exposes
//   gesture state, else counted here). Taps still go through the controller (buildTap).
// - Context menu (Usar/Abrir · Mover · Desmontar / Arrasar / Cancelar): tap-and-hold a structure on touch, right
//   click on desktop (controller emits 'structmenu').
// Purely local UI: every action goes through building.js (intents to the host).

import { BUILDINGS } from '../game/data.js';
import {
  rotateBuild, commitPlacement, cancelBuild, exitBuildMode, rotLabel, rotCount, structureMenu, structureAtPoint,
  buildDragStart, buildDragMove, buildDragEnd, dimsOf,
} from '../game/building.js';
import { pick } from '../game/controller.js';
import { installDetails, DETAILS_ICON } from './details.js'; // agent K: Detalhes panel
import { hasKit } from '../game/content/kits.js';
import { ROOF_STYLES, ROOF_TYPE_STYLES } from '../game/content/roofs.js';

const ICON = {
  rot: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v4h-4"/>',
  ok: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  no: '<path d="M6 6l12 12M18 6 6 18"/>',
  use: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-2.6 0-4-1.3-5.4-3.4L3.4 13a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  decon: '<path d="M14.5 4.5l5 5M4 20l7.5-7.5"/><path d="M13 3l8 8-3 3-8-8z"/><path d="M4 14l6 6"/>',
  raze: '<path d="M12 3c.8 3.3 5 4.8 5 10a5 5 0 0 1-10 0c0-2.4 1.1-3.9 2.3-5 0 2 .9 3.2 2 3.4C11 8.5 10.5 6 12 3z"/><path d="M4 4l16 16"/>',
  build: '<path d="M13.5 3.5l7 7-2.6 2.6-7-7z"/><path d="M12.2 7.8 3.5 16.5a2 2 0 0 0 2.8 2.8l8.7-8.7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  style: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ICON.use}</svg>`;

const CSS = `
.abb{position:absolute;left:50%;top:calc(var(--safe-t,0px) + 132px);transform:translateX(-50%);display:flex;align-items:center;gap:6px;
  padding:6px;border-radius:10px;background:rgba(20,26,34,.86);border:1px solid rgba(120,170,230,.45);box-shadow:0 6px 18px rgba(0,0,0,.35);
  pointer-events:auto;z-index:30;color:#e8f0ff;font:600 12px/1.2 system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none}
.abb.hidden{display:none}
.abb button{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:58px;height:54px;
  border-radius:8px;cursor:pointer;background:rgba(60,90,130,.55);border:1px solid rgba(150,190,240,.35);color:#eaf3ff;font-size:10.5px;transition:transform .08s,background .15s}
.abb button svg{width:22px;height:22px}
.abb button:active,.abb button.down{transform:scale(.92)}
.abb .ok{background:rgba(64,128,70,.85);border-color:rgba(170,230,160,.45)}
.abb .ok.bad{background:rgba(80,80,80,.55);color:#aaa}
.abb .no{background:rgba(128,48,40,.85);border-color:rgba(240,170,150,.4)}
.abb .rot.off{display:none}
.abb .lbl{display:flex;flex-direction:column;min-width:96px;max-width:190px;padding:0 4px}
.abb .lbl b{font-size:12.5px;color:#fff}.abb .lbl small{font-weight:500;font-size:10.5px;color:#b8c8e0}
.abb .lbl small.bad{color:#ffb39a}
.abb kbd{font:600 9px system-ui;opacity:.7}
@media (max-width:760px),(max-height:520px){.abb{top:calc(var(--safe-t,0px) + 112px)}}
.touch .abb .lbl{display:none}
@media (orientation:portrait){.touch .abb{left:auto;right:calc(var(--safe-r,0px) + 8px);top:34%;transform:none;flex-direction:column}}
@media (max-width:520px){.abb .lbl{display:none}.abb button{width:56px;height:54px}}
.abb-on .workbar .wb-ok,.abb-on .workbar .wb-no{display:none!important}
.asm{position:absolute;z-index:40;min-width:168px;padding:5px;border-radius:10px;background:rgba(22,24,28,.94);border:1px solid rgba(217,180,90,.5);
  box-shadow:0 8px 22px rgba(0,0,0,.45);pointer-events:auto;color:#f1ead8;font:600 13px/1.2 system-ui,sans-serif;animation:asm-in .12s ease-out}
@keyframes asm-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.asm h4{margin:2px 6px 5px;font-size:12px;color:#d9b45a;font-weight:700}
.asm button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border-radius:7px;cursor:pointer}
.asm button svg{width:18px;height:18px;flex:none}
.asm button:hover,.asm button:active{background:rgba(217,180,90,.18)}
.asm button.dis{opacity:.6;cursor:default;font-weight:500;font-size:12px}
.touch .asm button{padding:12px 12px}
`;

export function installBuildbar(game) {
  const root = document.getElementById('hud') || document.body;
  if (!document.getElementById('abb-style')) {
    const st = document.createElement('style'); st.id = 'abb-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const bar = document.createElement('div');
  bar.className = 'abb hidden';
  bar.innerHTML = `<button class="rot" title="Girar (R · Shift+R volta)">${svg('rot')}<span>Girar</span></button>
    <button class="det off" title="Estilos e detalhes (T)">${DETAILS_ICON}<span>Detalhes</span></button>
    <span class="lbl"><b></b><small></small></span>
    <button class="ok" title="Confirmar (Enter)">${svg('ok')}<span>Confirmar</span></button>
    <button class="no" title="Cancelar (Esc · botão direito)">${svg('no')}<span>Cancelar</span></button>`;
  root.appendChild(bar);
  const $ = (s) => bar.querySelector(s);
  const R = { rot: $('.rot'), det: $('.det'), ok: $('.ok'), no: $('.no'), nm: $('.lbl b'), sub: $('.lbl small'), rotL: $('.rot span') };
  const details = installDetails(game);
  game.ui.details = details;
  const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(e); setTimeout(() => el.classList.remove('down'), 120); });
  press(R.rot, (e) => rotateBuild(game, e.shiftKey ? -1 : 1));
  press(R.ok, () => { const m = game.build.mode; if (m?.kind === 'place') commitPlacement(game); else exitBuildMode(game); });
  press(R.no, () => cancelBuild(game));
  press(R.det, () => { const m = game.build.mode; if (m?.type) details.toggle(m.type); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyT' && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { const m = game.build.mode; if (m?.type && hasKit(m.type) && !m.move) details.toggle(m.type); } });

  // ---------- context menu ----------
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  const openMenu = (o, sx, sy) => {
    closeMenu();
    const items = structureMenu(game, o);
    if (!items.length) return false;
    const def = BUILDINGS[o.type];
    menu = document.createElement('div');
    menu.className = 'asm';
    menu.innerHTML = `<h4>${o.blueprint ? (o.moveOf ? 'Mudança: ' : 'Planta: ') : ''}${def.name}</h4>` + items.map((it, i) =>
      `<button data-i="${i}" class="${it.disabled ? 'dis' : ''}">${svg(it.icon)}<span>${it.label}</span></button>`).join('');
    root.appendChild(menu);
    const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(W - mw - 8, sx - mw / 2)) + 'px';
    menu.style.top = Math.max(8, Math.min(H - mh - 8, sy - mh - 18)) + 'px';
    menu.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      e.preventDefault();
      const it = items[+b.dataset.i];
      if (it?.disabled) return;
      closeMenu();
      game.audio?.play('ui_click', {});
      it?.run?.();
    });
    game.audio?.play('ui_open', {});
    return true;
  };
  addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
  addEventListener('keydown', (e) => { if (menu && e.code === 'Escape') closeMenu(); });
  const structureUnder = (sx, sy) => {
    let o = null;
    try { const h = pick(game, sx, sy); if (h.type === 'interact' && h.it?.o?.building) o = h.it.o; else if (h.type === 'creature') return null; } catch { /* ignore */ }
    if (!o) { const [wx, wy] = game.screenToWorld(sx, sy); o = structureAtPoint(game, wx, wy, { roof: true }) || structureAtPoint(game, wx, wy + 0.5); }
    return o;
  };
  game.events.on('structmenu', (d) => {
    if (game.build.mode || game.player.dead) return;
    const o = structureUnder(d.x, d.y);
    if (o) openMenu(o, d.x, d.y);
  });
  game.events.on('built', (d) => {
    const h = game.ctl?.hinted;
    if (!h || h.menuhint || d?.o?.blueprint) return;
    h.menuhint = true;
    game.later?.(1.2, () => game.events.emit('toast', { text: game.input.isTouch ? 'Segure o dedo numa construção para Mover ou Desmontar' : 'Botão direito numa construção: Mover · Desmontar', kind: 'info' }));
  });

  // ---------- touch: one-finger build drags, long press = context menu ----------
  const canvas = game.R.canvas;
  const touches = new Map(); // pointerId -> {sx, sy, x, y, t}
  let paint = null;   // { id, sx, sy, on }
  let hold = null;    // { id, x, y, timer }
  const isJoy = (id) => { const I = game.input; return !!(I.joy && I.joy.id === id) || !!I.isJoyPointer?.(id); };
  const pinching = () => {
    const g = game.input.gesture;
    if (g && (g.pinch || g.pinching || g.multi || (g.touches | 0) >= 2)) return true;
    return touches.size >= 2;
  };
  const stopPaint = () => {
    if (!paint) return;
    const m = game.build.mode;
    if (paint.on && m) { if (m.kind === 'place') { m.anchor = m.end = null; m.dragging = false; } else m.anchor = m.end = null; }
    paint = null;
  };
  const stopHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || isJoy(e.pointerId)) return;
    touches.set(e.pointerId, { sx: e.clientX, sy: e.clientY });
    if (touches.size >= 2 || pinching()) { stopPaint(); stopHold(); return; }
    if (game.player.dead || game.ui?.modal) return;
    const m = game.build.mode;
    if (m) { paint = { id: e.pointerId, sx: e.clientX, sy: e.clientY, on: false }; return; }
    if (game.mining?.mode) return;
    hold = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      const h = hold; hold = null;
      if (!h || touches.size !== 1 || pinching() || game.build.mode) return;
      const o = structureUnder(h.x, h.y);
      if (o && openMenu(o, h.x, h.y)) navigator.vibrate?.(12);
    }, 520) };
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (hold && hold.id === e.pointerId && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) stopHold();
    if (!paint || paint.id !== e.pointerId) return;
    if (pinching() || !game.build.mode) { stopPaint(); return; }
    const [wx, wy] = game.screenToWorld(e.clientX, e.clientY);
    if (!paint.on) {
      if (Math.hypot(e.clientX - paint.sx, e.clientY - paint.sy) < 14) return;
      paint.on = true;
      const [ax, ay] = game.screenToWorld(paint.sx, paint.sy);
      buildDragStart(game, ax, ay);
    }
    buildDragMove(game, wx, wy);
  });
  const up = (e, cancel) => {
    if (e.pointerType !== 'touch') return;
    touches.delete(e.pointerId);
    if (hold && hold.id === e.pointerId) stopHold();
    if (!paint || paint.id !== e.pointerId) return;
    const p = paint; paint = null;
    if (!p.on || cancel || !game.build.mode) return;
    const m = game.build.mode;
    const [wx, wy] = game.screenToWorld(e.clientX, e.clientY);
    // rows / areas are placed on release; single props only move the ghost (✓ confirms)
    const commit = m.kind === 'decon' || m.kind === 'brush' || (!!BUILDINGS[m.type]?.drag && !m.move);
    buildDragEnd(game, wx, wy, { commit });
  };
  addEventListener('pointerup', (e) => up(e, false));
  addEventListener('pointercancel', (e) => up(e, true));

  // ---------- per-frame UI ----------
  const last = {};
  const set = (k, el, v) => { if (last[k] !== v) { last[k] = v; el.textContent = v; } };
  let t = 0;
  return {
    update(dt) {
      const m = game.build.mode;
      const on = !!m && (m.kind === 'place' || m.kind === 'decon' || m.kind === 'brush');
      if (last.on !== on) { last.on = on; bar.classList.toggle('hidden', !on); root.classList.toggle('abb-on', on); if (on) closeMenu(); }
      if (!on) return;
      t -= dt;
      if (t > 0) return;
      t = 0.1;
      R.det.classList.toggle('off', !(m.type && hasKit(m.type) && !m.move));
      if (m.kind === 'brush') {
        R.rot.classList.add('off');
        set('nm', R.nm, 'Pincel · ' + (BUILDINGS[m.type]?.name || ''));
        set('sub', R.sub, 'Toque ou arraste sobre plantas azuis');
        R.sub.classList.remove('bad');
        R.ok.classList.remove('bad');
        return;
      }
      if (m.kind === 'decon') {
        R.rot.classList.add('off');
        set('nm', R.nm, 'Desmontar');
        set('sub', R.sub, 'Toque ou arraste sobre construções');
        R.sub.classList.remove('bad');
        R.ok.classList.remove('bad');
        return;
      }
      const def = BUILDINGS[m.type];
      const n = def.roof ? (ROOF_TYPE_STYLES[m.type] || []).length : rotCount(m.type);
      R.rot.classList.toggle('off', n < 2);
      set('rl', R.rotL, def.roof ? 'Estilo' : 'Girar');
      const [fw, fh] = dimsOf(m.type, m.rot);
      set('nm', R.nm, (m.move ? 'Mover: ' : '') + def.name + (fw * fh > 1 ? ` · ${fw}×${fh}` : ''));
      const roofSub = def.roof ? `${ROOF_STYLES[m.style || ROOF_TYPE_STYLES[m.type]?.[0]]?.name || ''}${m.room ? ' · sala inteira' : ''}${m.n > 1 ? ` · ${m.n} tiles` : ''}` : '';
      const sub = !m.valid && m.reason ? m.reason : m.short || roofSub || rotLabel(m.type, m.rot) || (m.n > 1 ? `${m.n} plantas` : 'Planta grátis: o material sai na obra');
      set('sub', R.sub, sub);
      R.sub.classList.toggle('bad', (!m.valid && !!m.reason) || !!m.short);
      R.ok.classList.toggle('bad', !m.valid);
    },
  };
}
