// Build toolbar + structure context menu + touch build gestures (agent A).
// - Toolbar while placing: ⟳ girar · ✓ confirmar · ✕ cancelar, the orientation name and what is missing for the
//   whole plan ("Falta: …"); desktop shows the keys (R / Shift+R, Enter, Esc). It sits at the BOTTOM with the item
//   card (the HUD's work bar, re-parented here as a compact strip above the buttons), placed by a small solver
//   between the joystick zone, the ability cluster, the quick buttons and the hotbar, so it never covers the
//   spot being built on (owner: "deixe embaixo"); toasts move above it while building.
// - Touch in build mode: one finger drags rows / areas (walls, fences, floors) or carries the ghost (single props);
//   a second finger cancels the paint so the gesture stays a pinch zoom (read from game.input when it exposes
//   gesture state, else counted here). Taps still go through the controller (buildTap).
// - Context menu (Usar/Abrir · Mover · Desmontar / Arrasar / Cancelar): tap-and-hold a structure on touch, right
//   click on desktop (controller emits 'structmenu').
// - "Construir agora" on the toolbar after a placement: starts auto-work on that batch (work.js, opt-in).
// - Auto-work banner (top, under the HUD's top row, never over the player card / minimap): what the running job
//   sequence does ("Construindo · Parede de madeira · 3 restantes"), ✕ Cancelar (Esc on desktop) and, after the
//   player moved (sequence paused), ▶ Continuar.
// Purely local UI: every action goes through building.js / work.js (intents to the host).

import { BUILDINGS, SPECIES } from '../game/data.js';
import { corpseMenu } from '../game/corpses.js';
import { BIND } from '../game/keymap.js';
import {
  rotateBuild, commitPlacement, cancelBuild, exitBuildMode, rotLabel, rotCount, structureMenu, structureAtPoint,
  buildDragStart, buildDragMove, buildDragEnd, dimsOf,
} from '../game/building.js';
import { pick } from '../game/controller.js';
import { describeStructure } from '../game/building.js';
import { structureAt } from '../game/autotile.js';
import { installDetails, DETAILS_ICON } from './details.js'; // agent K: Detalhes panel
import { hasKit } from '../game/content/kits.js';
import { ROOF_STYLES, ROOF_TYPE_STYLES } from '../game/content/roofs.js';
import { uiScale } from './uiscale.js';

// HUD css px from a client rect / point (the HUD has a CSS zoom: uiscale.js)
const zf = () => uiScale() || 1;

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
  trash: '<path d="M4 7h16M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  style: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  farm: '<path d="M5 19c0-8.3 5.7-14 14-14 0 8.3-5.7 14-14 14z"/><path d="M5 19l8-8"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  path: '<path d="M7 21c1.5-4 6-5 6-9s-3-5-3-9"/><path d="M14 21c1-3 5-4.5 5-8.5S16.5 7 16 3" opacity=".6"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ICON.use}</svg>`;

const CSS = `
.abw{position:absolute;left:50%;bottom:calc(var(--safe-b,0px) + 10px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;
  gap:4px;z-index:30;pointer-events:none;max-width:calc(100% - 16px)}
.abw.placed{transform:none}
.abw.hidden{display:none}
.abw .workbar{position:static!important;transform:none!important;top:auto!important;left:auto!important;margin:0;max-width:100%;pointer-events:auto;
  padding:3px 8px 3px 5px!important;gap:6px!important}
.abw .workbar .wb-ic{width:26px;height:26px}
.abw .workbar .wb-tx{min-width:0;max-width:none;flex-direction:row;flex-wrap:wrap;align-items:baseline;column-gap:8px}
.abw .workbar .wb-tx b{font-size:12.5px}
.abw .workbar:not(.hidden) ~ .abb .lbl b{display:none}
.abb{position:relative;display:flex;align-items:center;gap:6px;
  padding:6px;border-radius:10px;background:rgba(20,26,34,.86);border:1px solid rgba(120,170,230,.45);box-shadow:0 6px 18px rgba(0,0,0,.35);
  pointer-events:auto;color:#e8f0ff;font:600 12px/1.2 system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none}
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
.touch .abb .lbl{display:none}
@media (max-width:520px){.abb .lbl{display:none}.abb button{width:54px;height:52px}}
@media (max-height:440px){.abb button{height:48px;width:56px}.abb{padding:5px}}
.abb-on .workbar .wb-ok,.abb-on .workbar .wb-no{display:none!important}
.abb-on .feed{bottom:var(--abw-feed-b,22px)!important}
.abb-on.abw-feedtop .feed{top:var(--abw-feed-t)!important;bottom:auto!important;left:var(--abw-feed-x)!important;width:min(var(--abw-feed-w),360px)!important}
.asm{position:absolute;z-index:40;min-width:168px;padding:5px;border-radius:10px;background:rgba(22,24,28,.94);border:1px solid rgba(217,180,90,.5);
  box-shadow:0 8px 22px rgba(0,0,0,.45);pointer-events:auto;color:#f1ead8;font:600 13px/1.2 system-ui,sans-serif;animation:asm-in .12s ease-out}
@keyframes asm-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.asm h4{margin:2px 6px 5px;font-size:12px;color:#d9b45a;font-weight:700}
.asm button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border-radius:7px;cursor:pointer}
.asm button svg{width:18px;height:18px;flex:none}
.asm button:hover,.asm button:active{background:rgba(217,180,90,.18)}
.asm button.dis{opacity:.6;cursor:default;font-weight:500;font-size:12px}
.touch .asm button{padding:12px 12px}
.abb .go{background:rgba(160,110,40,.85);border-color:rgba(240,200,120,.5)}
.abb .go.off{display:none}
.awb{position:absolute;left:50%;top:calc(var(--gap,8px) + var(--safe-t,0px) + 70px);transform:translateX(-50%);display:flex;align-items:center;gap:8px;
  padding:5px 6px 5px 9px;border-radius:6px;background:var(--panel,rgba(22,24,26,.86));border:1px solid rgba(217,180,90,.6);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 10px rgba(0,0,0,.45);pointer-events:auto;z-index:3;color:var(--text,#efe6d2);
  font-size:12px;font-weight:600;line-height:1.2;user-select:none;-webkit-user-select:none;touch-action:none;max-width:calc(100% - 16px);box-sizing:border-box;animation:awb-in .18s ease-out}
@keyframes awb-in{from{opacity:0}to{opacity:1}}
.awb.placed{transform:none}
.awb.hidden{display:none}
.awb .ic{width:26px;height:26px;flex:none;color:var(--accent,#d9b45a);display:grid;place-items:center}
.awb .ic svg{width:22px;height:22px}
.awb.busy .ic svg{animation:awb-hit 1s ease-in-out infinite;transform-origin:70% 70%}
@keyframes awb-hit{0%,100%{transform:rotate(0)}45%{transform:rotate(-24deg)}60%{transform:rotate(6deg)}}
.awb .tx{display:flex;flex-direction:column;min-width:0;flex:1}
.awb .tx b{font-size:12.5px;display:flex;min-width:0;white-space:nowrap}
.awb .tx b .v{overflow:hidden;text-overflow:ellipsis;min-width:0}
.awb .tx b .n{flex:none;color:var(--accent,#d9b45a);margin-left:5px}
.awb .tx small{font-size:10.5px;font-weight:500;color:var(--muted,#a29d92);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.awb .tx small.warn{color:#ffb39a}
.awb button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:4px;height:32px;padding:0 10px;border-radius:5px;cursor:pointer;flex:none;
  font-size:12px;font-weight:700;border:1px solid var(--border,rgba(150,150,140,.35));background:rgba(52,55,58,.95);color:var(--text,#efe6d2)}
.awb button svg{width:14px;height:14px}
.awb button:active,.awb button.down{transform:scale(.94)}
.awb .x{border-color:rgba(240,150,130,.5);background:rgba(110,40,34,.9);color:#ffe2da}
.awb .c{border-color:rgba(170,230,160,.5);background:rgba(54,104,58,.92);color:#e8ffe0}
.awb .c.off{display:none}
.awb kbd{font:600 9.5px system-ui;opacity:.75;margin-left:2px}
.touch .awb kbd{display:none}
.touch .awb button{height:36px;padding:0 11px}
@media (max-width:420px){.awb button span{display:none}.awb button{padding:0 9px}}
`;

export function installBuildbar(game) {
  const root = document.getElementById('hud') || document.body;
  if (!document.getElementById('abb-style')) {
    const st = document.createElement('style'); st.id = 'abb-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  // bottom wrapper: [item card strip] over [buttons]
  const wrap = document.createElement('div');
  wrap.className = 'abw hidden';
  root.appendChild(wrap);
  const bar = document.createElement('div');
  bar.className = 'abb';
  bar.innerHTML = `<button class="rot" title="Girar (R · Shift+R volta)">${svg('rot')}<span>Girar</span></button>
    <button class="det off" title="Estilos e detalhes (T)">${DETAILS_ICON}<span>Detalhes</span></button>
    <span class="lbl"><b></b><small></small></span>
    <button class="ok" title="Confirmar (Enter)">${svg('ok')}<span>Confirmar</span></button>
    <button class="go off" title="Construir agora as plantas que você colocou">${svg('build')}<span>Construir</span></button>
    <button class="no" title="Cancelar (Esc · botão direito)">${svg('no')}<span>Cancelar</span></button>`;
  wrap.appendChild(bar);
  // the HUD's item card (work bar: name · cost · hint) joins the wrapper as the strip above the buttons
  const adoptCard = () => { const wbar = root.querySelector('.workbar'); if (wbar && wbar.parentElement !== wrap) wrap.insertBefore(wbar, bar); };
  adoptCard();
  const $ = (s) => bar.querySelector(s);
  const R = { rot: $('.rot'), det: $('.det'), ok: $('.ok'), no: $('.no'), go: $('.go'), nm: $('.lbl b'), sub: $('.lbl small'), rotL: $('.rot span') };
  // the last placed batch still standing as blueprints (for "Construir agora")
  const batchBlueprint = () => {
    const lb = game.build.lastBatch;
    if (!lb) return null;
    for (const [x, y] of lb.tiles) for (const L of ['main', 'floor', 'rug', 'roof']) {
      const o = game.build.grid[L] ? structureAt(game, x, y, L) : null;
      if (o && o.blueprint && o.type === lb.type) return o;
    }
    return null;
  };
  const details = installDetails(game);
  game.ui.details = details;
  const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(e); setTimeout(() => el.classList.remove('down'), 120); });
  press(R.rot, (e) => rotateBuild(game, e.shiftKey ? -1 : 1));
  press(R.ok, () => { const m = game.build.mode; if (m?.kind === 'place') commitPlacement(game); else exitBuildMode(game); });
  press(R.no, () => cancelBuild(game));
  press(R.go, () => {
    const o = batchBlueprint();
    if (!o) { game.events.emit('error', { text: 'As plantas ainda não apareceram' }); return; }
    exitBuildMode(game);
    game.work?.begin?.(describeStructure(game, o));
  });

  // ---------- auto-work banner ----------
  const wb = document.createElement('div');
  wb.className = 'awb hidden';
  wb.innerHTML = `<span class="ic"></span><span class="tx"><b><span class="v"></span><span class="n"></span></b><small></small></span>
    <button class="c off" title="Continuar a tarefa">${svg('play')}<span>Continuar</span></button>
    <button class="x" title="Cancelar a tarefa automática (Esc)">${svg('no')}<span>Cancelar</span><kbd>Esc</kbd></button>`;
  root.appendChild(wb);
  const W$ = { ic: wb.querySelector('.ic'), v: wb.querySelector('.tx .v'), n: wb.querySelector('.tx .n'), sm: wb.querySelector('.tx small'), c: wb.querySelector('.c'), x: wb.querySelector('.x') };
  press(W$.x, () => game.work?.cancel?.());
  press(W$.c, () => game.work?.resume?.());
  game.ui.workBanner = wb;
  // place it under the top row without covering the player card, quick buttons or the minimap
  const OBST = ['.tl-top', '.tl-bot', '.tr'];
  // highest free slot under the top row (HUD css px): { x, y, w } or null
  const topSlot = (h, minW, maxW) => {
    const z = zf(), rr = root.getBoundingClientRect(), W = rr.width / z;
    const gap = 6;
    minW = Math.min(minW, W - 16); maxW = Math.min(maxW, W - 16);
    const obs = [];
    for (const sel of OBST) for (const el of root.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top - rr.top < rr.height * 0.6) obs.push({ l: (r.left - rr.left) / z, r: (r.right - rr.left) / z, t: (r.top - rr.top) / z, b: (r.bottom - rr.top) / z });
    }
    const tops = [8, ...obs.map((o) => o.b + gap)].sort((a, b) => a - b);
    for (const y of tops) {
      let L = 8, Rr = W - 8;
      for (const o of obs) if (o.t < y + h && o.b > y) { if ((o.l + o.r) / 2 < W / 2) L = Math.max(L, o.r + gap); else Rr = Math.min(Rr, o.l - gap); }
      if (Rr - L < minW) continue;
      const w = Math.min(maxW, Rr - L);
      return { x: Math.max(L, Math.min(Rr - w, W / 2 - w / 2)), y, w };
    }
    return null;
  };
  const placeBanner = () => {
    const sl = topSlot(wb.offsetHeight || 44, 250, 500);
    if (!sl) return;
    wb.style.left = sl.x + 'px'; wb.style.top = sl.y + 'px'; wb.style.width = sl.w + 'px';
    wb.classList.add('placed');
  };
  // bottom wrapper placement: lowest spot (centred when possible) that avoids the joystick zone (touch), the
  // ability cluster / interact button, the hotbar and the left quick column
  const BOT_OBST = ['.ab', '.ab-int', '.hotbar', '.tl-bot', '.tr', '.awb'];
  const placeBottom = () => {
    const z = zf(), rr = root.getBoundingClientRect(), W = rr.width / z, H = rr.height / z;
    // the buttons must fit; the card strip wraps its text to the room left (natural width measured unconstrained)
    wrap.style.maxWidth = 'none';
    const w = Math.min(Math.max(bar.offsetWidth, Math.min(wrap.offsetWidth, 260)) || 300, W - 16), h = wrap.offsetHeight || 110, gap = 8;
    const obs = [];
    for (const sel of BOT_OBST) for (const el of root.querySelectorAll(sel)) {
      if (wrap.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') obs.push({ l: (r.left - rr.left) / z, r: (r.right - rr.left) / z, t: (r.top - rr.top) / z, b: (r.bottom - rr.top) / z });
    }
    if (game.input.isTouch || root.classList.contains('touch')) obs.push({ l: 0, r: W * (game.input.joyZone ?? 0.2), t: H * 0.25, b: H }); // where a finger starts the joystick
    const safeB = parseFloat(getComputedStyle(root).getPropertyValue('--safe-b')) || 0;
    const bottoms = [H - safeB - 10, ...obs.map((o) => o.t - gap)].filter((b) => b - h > H * 0.3).sort((a, b) => b - a);
    for (const bt of bottoms) {
      const y = bt - h;
      let L = 8, R = W - 8;
      for (const o of obs) if (o.t < bt && o.b > y) { if ((o.l + o.r) / 2 < W / 2) L = Math.max(L, o.r + gap); else R = Math.min(R, o.l - gap); }
      if (R - L < w) continue;
      const x = Math.max(L, Math.min(R - w, W / 2 - w / 2));
      wrap.style.left = x + 'px'; wrap.style.bottom = (H - bt) + 'px'; wrap.style.maxWidth = (R - L) + 'px';
      wrap.classList.add('placed');
      root.style.setProperty('--abw-feed-b', (H - y + 6) + 'px');
      const fs = topSlot(70, 220, 360);
      root.classList.toggle('abw-feedtop', !!fs);
      if (fs) { root.style.setProperty('--abw-feed-t', fs.y + 'px'); root.style.setProperty('--abw-feed-x', (fs.x + fs.w / 2) + 'px'); root.style.setProperty('--abw-feed-w', fs.w + 'px'); }
      return;
    }
    wrap.classList.remove('placed'); wrap.style.left = ''; wrap.style.bottom = ''; wrap.style.maxWidth = '';
    root.style.setProperty('--abw-feed-b', (h + 20) + 'px');
  };
  let wbT = 0, wbPlaceT = 0, abwT = 0;
  const updBanner = (dt) => {
    const s = game.work?.status?.();
    const show = !!s && !game.build.mode;
    if (last.wb !== show) { last.wb = show; wb.classList.toggle('hidden', !show); if (show) { wb.classList.remove('placed'); wbPlaceT = 0; } }
    if (!show) return;
    if ((wbT -= dt) <= 0) {
      wbT = 0.15;
      const ic = s.kind === 'decon' || s.remove ? 'decon' : s.kind === 'farm' ? 'farm' : s.kind === 'path' ? 'path' : 'build';
      if (last.wbic !== ic) { last.wbic = ic; W$.ic.innerHTML = svg(ic); }
      const n = s.n + (s.blocked || 0);
      const narrow = wb.offsetWidth < 330; // phones: the name goes to the second line, the count stays visible
      const named = (s.kind === 'build' || s.kind === 'path') && !!s.name, counted = s.kind === 'build' || s.kind === 'path';
      set('wbv', W$.v, named && !narrow ? `${s.verb} · ${s.name}` : s.verb);
      set('wbn', W$.n, counted ? `· ${n} ${n === 1 ? 'restante' : 'restantes'}` : `· ${n}`);
      const touch = game.input.isTouch;
      const pre = named && narrow ? s.name + ' · ' : '';
      const sub = pre + (s.paused ? (touch ? 'Pausado: você andou · toque em Continuar' : 'Pausado: você andou · Continuar retoma')
        : s.blocked ? `${s.blocked} ${s.blocked === 1 ? 'espera' : 'esperam'} material` : (touch ? 'Automático · andar pausa' : 'Automático · andar pausa · Esc cancela'));
      set('wbs', W$.sm, sub);
      W$.sm.classList.toggle('warn', !!s.paused || !!s.blocked);
      W$.c.classList.toggle('off', !s.paused);
      wb.classList.toggle('busy', !s.paused && !!game.player.work);
    }
    if ((wbPlaceT -= dt) <= 0) { wbPlaceT = 0.5; placeBanner(); }
  };
  press(R.det, () => { const m = game.build.mode; if (m?.type) details.toggle(m.type); });
  addEventListener('keydown', (e) => { if (BIND.details.includes(e.code) && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { const m = game.build.mode; if (m?.type && hasKit(m.type) && !m.move) details.toggle(m.type); } });

  // ---------- context menu ----------
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  // a structure's menu, or a body's (o.corpse-like: an entry of game.corpses — "Remover corpo")
  const openMenu = (o, sx, sy) => {
    closeMenu();
    const body = game.corpses?.map?.get?.(o.id) === o;
    const items = body ? corpseMenu(game, o) : structureMenu(game, o);
    if (!items.length) return false;
    const title = body ? (o.name || `Corpo de ${(SPECIES[o.of]?.name || 'animal').toLowerCase()}`) : `${o.blueprint ? (o.moveOf ? 'Mudança: ' : 'Planta: ') : ''}${BUILDINGS[o.type].name}`;
    menu = document.createElement('div');
    menu.className = 'asm';
    menu.innerHTML = `<h4>${title}</h4>` + items.map((it, i) =>
      `<button data-i="${i}" class="${it.disabled ? 'dis' : ''}">${svg(it.icon)}<span>${it.label}</span></button>`).join('');
    root.appendChild(menu);
    const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const z = zf(), px = sx / z, py = sy / z; // client px -> HUD css px
    menu.style.left = Math.max(8, Math.min(W - mw - 8, px - mw / 2)) + 'px';
    menu.style.top = Math.max(8, Math.min(H - mh - 8, py - mh - 18)) + 'px';
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
    try { const h = pick(game, sx, sy); if (h.type === 'interact' && (h.it?.o?.building || h.it?.corpse)) o = h.it.o; else if (h.type === 'creature') return null; } catch { /* ignore */ }
    if (!o) o = corpseNear(...game.screenToWorld(sx, sy));
    if (!o) { const [wx, wy] = game.screenToWorld(sx, sy); o = structureAtPoint(game, wx, wy, { roof: true }) || structureAtPoint(game, wx, wy + 0.5); }
    return o;
  };
  // a body lying under the point (also skeletons and butchered carcasses, which have no tap action)
  const corpseNear = (wx, wy) => {
    let best = null, bd = 0.75;
    for (const c of game.corpses?.map?.values?.() || []) {
      if (c.removed || game.roofs?.hidden?.(c.x, c.y)) continue;
      const d = Math.hypot(c.x - wx, (c.y - 0.15 - wy) * 1.3);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
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
      updBanner(dt);
      const m = game.build.mode;
      const on = !!m && (m.kind === 'place' || m.kind === 'decon' || m.kind === 'brush');
      if (last.on !== on) { last.on = on; adoptCard(); wrap.classList.toggle('hidden', !on); root.classList.toggle('abb-on', on); if (on) { closeMenu(); abwT = 0; } }
      if (!on) return;
      if ((abwT -= dt) <= 0) { abwT = 0.4; placeBottom(); }
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
      R.go.classList.toggle('off', !!m.move || !batchBlueprint());
    },
  };
}
