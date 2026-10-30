// Painted paths UI (agent M): the toolbar shown while painting (build mode kind 'path') and the "Caminhos" cards of
// the build window (src/ui/panels.js). Purely local UI: every action goes through src/game/paths.js (intents).
// Toolbar: material swatches + eraser · brush 1 / 2 / 3 · shape (pincel / linha / área) · what it costs · ✓ ✕.
// Desktop keys: [ ] brush, R shape, Enter done, Esc / right click cancel. Touch: one finger paints, two fingers zoom.

import { PATH_TYPES, PATH_BY_KEY, PATH_REMOVE } from '../game/content/paths.js';
import { setBrush, setShape, setPathCode, ensureLayers } from '../game/paths.js';
import { cancelBuild, exitBuildMode } from '../game/building.js';
import { ITEMS } from '../game/data.js';
import { PATH_TEX } from '../world/pathTex.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  free: svg('<path d="M3 17c3-6 5 2 8-3s4-8 7-6 2 7 3 7"/>'),
  line: svg('<path d="M4 19 20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>'),
  area: svg('<rect x="4" y="5" width="16" height="14" rx="2" stroke-dasharray="3 2.5"/>'),
  ok: svg('<path d="M4.5 12.5l5 5L19.5 7"/>'),
  no: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  erase: svg('<path d="M15 4l5 5-9 9H6l-3-3z"/><path d="M11 18h9"/>'),
};
const dot = (r) => `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="currentColor" opacity=".85"/></svg>`;

// ---------- material icons (from the generated texture layers: lit once, gaps show grass) ----------
const ICONS = new Map();
export function pathIcon(game, key, size = 64) {
  if (ICONS.has(key)) return ICONS.get(key);
  const L = game._paths?.layers;
  const t = PATH_BY_KEY[key];
  if (!L || !t || typeof document === 'undefined') return null;
  const n = PATH_TEX, layer = L[PATH_TYPES[t].layer], c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), D = img.data;
  const span = 200; // texels shown (≈1.5 tiles)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = Math.floor((x / size) * span) + 40, v = Math.floor((y / size) * span) + 40;
    const i = (v * n + u) * 4, h = layer[i + 3] / 255;
    const hx = layer[(v * n + Math.min(n - 1, u + 2)) * 4 + 3] / 255 - h, hy = layer[(Math.min(n - 1, v + 2) * n + u) * 4 + 3] / 255 - h;
    const lit = 1 + (-hx * 0.55 - hy * 0.7) * 2.2;
    const gap = h < 0.24 ? 1 - Math.max(0, (h - 0.14) / 0.1) : 0;
    const gr = [74, 98, 44];
    const dx = x - size / 2 + 0.5, dy = y - size / 2 + 0.5, rr = Math.hypot(dx, dy) / (size / 2);
    const o = (y * size + x) * 4;
    for (let k = 0; k < 3; k++) D[o + k] = Math.max(0, Math.min(255, (layer[i + k] * lit) * (1 - gap) + gr[k] * gap * (1 - 0.3 * h / 0.16)));
    D[o + 3] = rr < 0.92 ? 255 : rr < 1 ? Math.round(255 * (1 - (rr - 0.92) / 0.08)) : 0;
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL();
  ICONS.set(key, url);
  return url;
}

// cards of the "Caminhos" tab: [{ key, name, desc, cost, meta, icon, swatch }]
export function pathCatalog(game) {
  ensureLayers(game);
  const out = PATH_TYPES.filter(Boolean).map((T) => ({
    key: T.key, name: T.name, cost: T.cost, icon: pathIcon(game, T.key), swatch: T.swatch,
    desc: T.desc, meta: ['pincel 1–3 · linha · área', Object.keys(T.cost).length ? 'custo por tile' : 'grátis', `+${Math.round((T.speed - 1) * 100)}% velocidade`, T.needs].filter(Boolean).join(' · '),
  }));
  out.push({ key: 'remove', name: 'Remover caminho', cost: {}, icon: ERASE_ICON, swatch: '#7a3b33', remove: true,
    desc: 'Marque caminhos para tirar (devolve 75% do material). Plantas de caminho são canceladas na hora.', meta: 'também pelo Desmontar' });
  return out;
}
export const PATH_TAB = ['path', 'Caminhos'];
const ERASE_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#7a3029"/><g fill="none" stroke="#ffd9cf" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l4 4-7 7H8l-2.5-2.5z"/><path d="M11 17h7"/><path d="M9.5 11l4 4"/></g></svg>');

const CSS = `
.pbb{position:absolute;left:50%;top:calc(var(--safe-t,0px) + 126px);transform:translateX(-50%);display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:center;
  max-width:min(96vw,860px);padding:6px;border-radius:10px;background:rgba(20,26,34,.86);border:1px solid rgba(120,170,230,.45);box-shadow:0 6px 18px rgba(0,0,0,.35);
  pointer-events:auto;z-index:30;color:#e8f0ff;font:600 12px/1.2 system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none}
.pbb.hidden{display:none}
.pbb .grp{display:flex;gap:4px;align-items:center;padding:0 3px}
.pbb .grp+.grp{border-left:1px solid rgba(150,190,240,.22);padding-left:7px}
.pbb button{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:44px;height:46px;padding:0 4px;
  border-radius:8px;cursor:pointer;background:rgba(60,90,130,.45);border:1px solid rgba(150,190,240,.3);color:#eaf3ff;font-size:10px;transition:transform .08s,background .15s}
.pbb button svg{width:20px;height:20px}
.pbb button:active,.pbb button.down{transform:scale(.92)}
.pbb button.on{background:rgba(90,150,220,.75);border-color:#bfe0ff;box-shadow:0 0 0 1px rgba(190,225,255,.5) inset}
.pbb .sw{width:50px;min-width:50px;padding:0}
.pbb .sw span{max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbb .sw i{display:block;width:30px;height:30px;border-radius:50%;background-size:cover;box-shadow:0 1px 3px rgba(0,0,0,.5) inset}
.pbb .sw.er i{display:flex;align-items:center;justify-content:center;background:#6a3029;color:#ffd6cc}
.pbb .sw.er i svg{width:18px;height:18px}
.pbb .ok{background:rgba(64,128,70,.85);border-color:rgba(170,230,160,.45)}
.pbb .no{background:rgba(128,48,40,.85);border-color:rgba(240,170,150,.4)}
.pbb .lbl{display:flex;flex-direction:column;min-width:110px;max-width:220px;padding:0 4px}
.pbb .lbl b{font-size:12.5px;color:#fff}.pbb .lbl small{font-weight:500;font-size:10.5px;color:#b8c8e0}
.pbb .lbl small.bad{color:#ffb39a}
.touch .pbb .lbl{display:none}
.touch .pbb button span{display:none}
/* touch: compact — only the active type / brush / shape show; tapping it cycles (types open a list) */
.touch .pbb .brush button:not(.on),.touch .pbb .shape button:not(.on),.touch .pbb:not(.open) .types button:not(.on){display:none}
.touch .pbb .grp+.grp{padding-left:5px}
@media (max-width:760px),(max-height:520px){.pbb{top:calc(var(--safe-t,0px) + 106px)}}
@media (orientation:portrait){.touch .pbb{left:auto;right:calc(var(--safe-r,0px) + 6px);top:22%;transform:none;flex-direction:column;flex-wrap:nowrap;max-height:70vh;overflow-y:auto}
  .touch .pbb .grp{flex-direction:column}.touch .pbb .grp+.grp{border-left:0;border-top:1px solid rgba(150,190,240,.22);padding:6px 0 0}}
.pbb-on .workbar{display:none!important} /* this bar has its own name / cost line */
.pbb .lay{background:rgba(160,110,40,.85);border-color:rgba(240,200,120,.5)}
.pbb .lay.hidden{display:none}
`;

export function installPathbar(game) {
  const root = document.getElementById('hud') || document.body;
  if (!document.getElementById('pbb-style')) { const st = document.createElement('style'); st.id = 'pbb-style'; st.textContent = CSS; document.head.appendChild(st); }
  const bar = document.createElement('div');
  bar.className = 'pbb hidden';
  const SHORT = { dirt: 'Terra', gravel: 'Cascalho', flag: 'Lajota', cobble: 'Paralelep.', steps: 'Passagem' };
  const sw = PATH_TYPES.filter(Boolean).map((T) => `<button class="sw" data-k="${T.key}" title="${T.name}"><i style="background:${T.swatch}"></i><span>${SHORT[T.key] || T.name}</span></button>`).join('');
  bar.innerHTML = `<div class="grp types">${sw}<button class="sw er" data-k="remove" title="Remover caminho"><i>${IC.erase}</i><span>Remover</span></button></div>
    <div class="grp brush"><button data-b="1" title="Pincel pequeno ( [ )">${dot(3.2)}<span>1</span></button><button data-b="2" title="Pincel médio">${dot(5.6)}<span>2</span></button><button data-b="3" title="Pincel grande ( ] )">${dot(8)}<span>3</span></button></div>
    <div class="grp shape"><button data-s="free" title="Pincel livre (R muda)">${IC.free}<span>Pincel</span></button><button data-s="line" title="Linha reta">${IC.line}<span>Linha</span></button><button data-s="area" title="Área">${IC.area}<span>Área</span></button></div>
    <span class="lbl"><b></b><small></small></span>
    <div class="grp"><button class="ok" title="Pronto (Enter)">${IC.ok}<span>Pronto</span></button><button class="lay hidden" title="Assentar agora o caminho que você pintou">${IC.ok}<span>Assentar</span></button><button class="no" title="Cancelar (Esc · botão direito)">${IC.no}<span>Cancelar</span></button></div>`;
  root.appendChild(bar);
  const $ = (s) => bar.querySelector(s), $$ = (s) => [...bar.querySelectorAll(s)];
  const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(e); game.audio?.play('ui_click', {}); setTimeout(() => el.classList.remove('down'), 120); });
  const touch = () => document.documentElement.classList.contains('touch') || document.body.classList.contains('touch') || game.input.isTouch;
  const SHAPES = ['free', 'line', 'area'];
  for (const b of $$('[data-k]')) press(b, () => {
    const m = game.build.mode;
    if (touch() && m?.key === b.dataset.k) { bar.classList.toggle('open'); return; } // the active type opens / closes the list
    bar.classList.remove('open');
    setPathCode(game, b.dataset.k);
  });
  for (const b of $$('[data-b]')) press(b, () => { const m = game.build.mode; setBrush(game, touch() && m?.brush === +b.dataset.b ? (m.brush % 3) + 1 : +b.dataset.b); });
  for (const b of $$('[data-s]')) press(b, () => { const m = game.build.mode; setShape(game, touch() && m?.shape === b.dataset.s ? SHAPES[(SHAPES.indexOf(m.shape) + 1) % 3] : b.dataset.s); });
  press($('.ok'), () => exitBuildMode(game));
  // "Assentar agora": opt-in auto-work over the last painted stroke (work.js sequence kind 'path', agent A)
  const lastPlan = () => {
    const lp = game.build.lastPath, w = game.world;
    if (!lp) return null;
    for (const i of lp.tiles) if (w.pathPlan[i] === lp.code) return game.paths.jobAt(i % w.W, (i / w.W) | 0);
    return null;
  };
  press($('.lay'), () => { const it = lastPlan(); if (!it) return; exitBuildMode(game); game.work?.begin?.(it); });
  press($('.no'), () => cancelBuild(game));
  const lbl = $('.lbl b'), sub = $('.lbl small');
  const last = {};
  let iconsDone = false, t = 0;
  const swatches = () => {
    if (iconsDone || !game._paths?.layers) return;
    iconsDone = true;
    for (const b of $$('.sw[data-k]')) { const u = pathIcon(game, b.dataset.k); if (u) b.querySelector('i').style.background = `url(${u}) center/cover`; }
  };
  const costText = (T, n) => {
    const p = game.player, parts = [];
    if (game.creative) return 'grátis no criativo';
    for (const k in T.cost) { const need = T.cost[k] * Math.max(1, n), have = p.inv.count(k); parts.push(`${need} ${(ITEMS[k]?.name || k).toLowerCase()}${have < need ? ` (tem ${have})` : ''}`); }
    return parts.length ? parts.join(', ') : 'grátis';
  };
  return {
    update(dt) {
      const m = game.build.mode, on = m?.kind === 'path';
      if (last.on !== on) { last.on = on; bar.classList.toggle('hidden', !on); root.classList.toggle('pbb-on', on); }
      if (!on) return;
      swatches();
      const lay = $('.lay'), lp = lastPlan();
      lay.classList.toggle('hidden', !lp);
      if (lp) lay.querySelector('span').textContent = lp.c === PATH_REMOVE ? 'Remover' : 'Assentar';
      t -= dt;
      if (t > 0 && last.k === m.key && last.b === m.brush && last.s === m.shape && last.n === m.n) return;
      t = 0.15;
      if (last.k !== m.key) { last.k = m.key; for (const b of $$('[data-k]')) b.classList.toggle('on', b.dataset.k === m.key); }
      if (last.b !== m.brush) { last.b = m.brush; for (const b of $$('[data-b]')) b.classList.toggle('on', +b.dataset.b === m.brush); }
      if (last.s !== m.shape) { last.s = m.shape; for (const b of $$('[data-s]')) b.classList.toggle('on', b.dataset.s === m.shape); }
      last.n = m.n;
      const rem = m.code === PATH_REMOVE, T = PATH_TYPES[m.code];
      lbl.textContent = rem ? 'Remover caminho' : T.name;
      let s, bad = false;
      if (rem) s = m.n ? `${m.n} tile(s) para remover` : 'Pinte sobre caminhos ou plantas';
      else if (m.n) { const c = costText(T, m.n); s = `${m.n} tile(s) · ${c}`; bad = /\(tem/.test(c); }
      else s = `Planta grátis · ${costText(T, 1)} por tile`;
      sub.textContent = s;
      sub.classList.toggle('bad', bad);
    },
  };
}
