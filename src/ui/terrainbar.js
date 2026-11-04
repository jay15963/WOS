// The shovel's bar (docs/TERRAIN-HEIGHT.md "A pá"): shown while the terrain tool is on (build mode kind 'terrain',
// game/terrain.js) on desktop and touch — the four modes (Cavar, Aterrar, Aplanar, Suavizar), a line telling what the
// brush under the cursor would do (or why not: the preview is red), and ✕. Desktop: R cycles the modes, Esc / right click
// leaves. Purely local UI: every action goes through game/terrain.js (intent terrain.edit).

import { TERRAIN_MODES, TERRAIN_ORDER, setTerrainMode, brushPreview, PREVIEW_WHY, shovelOf } from '../game/terrain.js';
import { exitBuildMode } from '../game/building.js';
import { ITEMS } from '../game/data.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  dig: svg('<path d="M12 3v10"/><path d="M8 13h8l-1.5 6a2.5 2.5 0 0 1-5 0z"/><path d="M4 21h16"/>'),
  fill: svg('<path d="M4 19h16"/><path d="M6 19c1-5 4-8 6-8s5 3 6 8"/><path d="M12 3v5M9.5 5.5 12 8l2.5-2.5"/>'),
  flat: svg('<path d="M3 15h18"/><path d="M5 11l3 4M19 11l-3 4"/><path d="M9 7h6"/>'),
  smooth: svg('<path d="M3 16c3-6 6-6 9-2s6 4 9-2"/><path d="M3 20h18" stroke-dasharray="2 3"/>'),
  no: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};
const SHORT = { dig: 'Cavar', fill: 'Aterrar', flat: 'Aplanar', smooth: 'Suavizar' };

const CSS = `
.tbb{position:absolute;left:50%;top:calc(var(--safe-t,0px) + 126px);transform:translateX(-50%);display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:center;
  max-width:min(96vw,760px);padding:6px;border-radius:10px;background:rgba(28,24,18,.86);border:1px solid rgba(220,180,120,.45);box-shadow:0 6px 18px rgba(0,0,0,.35);
  pointer-events:auto;z-index:30;color:#fff4e2;font:600 12px/1.2 system-ui,sans-serif;user-select:none;-webkit-user-select:none;touch-action:none}
.tbb.hidden{display:none}
.tbb .grp{display:flex;gap:4px;align-items:center;padding:0 3px}
.tbb .grp+.grp{border-left:1px solid rgba(230,200,150,.22);padding-left:7px}
.tbb button{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:54px;height:48px;padding:0 5px;
  border-radius:8px;cursor:pointer;background:rgba(110,84,50,.5);border:1px solid rgba(230,200,150,.3);color:#fff2dd;font-size:10.5px;transition:transform .08s,background .15s}
.tbb button svg{width:21px;height:21px}
.tbb button:active,.tbb button.down{transform:scale(.92)}
.tbb button.on{background:rgba(196,140,60,.82);border-color:#ffe2b0;box-shadow:0 0 0 1px rgba(255,226,176,.5) inset}
.tbb .no{background:rgba(128,48,40,.85);border-color:rgba(240,170,150,.4);min-width:46px}
.tbb .lbl{display:flex;flex-direction:column;min-width:130px;max-width:240px;padding:0 4px}
.tbb .lbl b{font-size:12.5px;color:#fff}.tbb .lbl small{font-weight:500;font-size:10.5px;color:#e6d6bc}
.tbb .lbl small.bad{color:#ffb39a}.tbb .lbl small.ok{color:#bff0a8}
.touch .tbb .lbl{min-width:0;max-width:150px}
@media (max-width:760px),(max-height:520px){.tbb{top:calc(var(--safe-t,0px) + 106px)}}
@media (orientation:portrait){.touch .tbb{left:auto;right:calc(var(--safe-r,0px) + 6px);top:22%;transform:none;flex-direction:column;flex-wrap:nowrap;max-height:70vh;overflow-y:auto}
  .touch .tbb .grp{flex-direction:column}.touch .tbb .grp+.grp{border-left:0;border-top:1px solid rgba(230,200,150,.22);padding:6px 0 0}}
.tbb-on .workbar{display:none!important}
`;

const num = (v) => (Math.round(v * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function installTerrainbar(game) {
  const root = document.getElementById('hud') || document.body;
  if (!document.getElementById('tbb-style')) { const st = document.createElement('style'); st.id = 'tbb-style'; st.textContent = CSS; document.head.appendChild(st); }
  const bar = document.createElement('div');
  bar.className = 'tbb hidden';
  bar.innerHTML = `<div class="grp modes">${TERRAIN_ORDER.map((k) => `<button data-m="${k}" title="${TERRAIN_MODES[k].name} — ${TERRAIN_MODES[k].desc} (R troca)">${IC[k]}<span>${SHORT[k]}</span></button>`).join('')}</div>
    <span class="lbl"><b></b><small></small></span>
    <div class="grp"><button class="no" title="Sair (Esc · botão direito)">${IC.no}<span>Sair</span></button></div>`;
  root.appendChild(bar);
  const $ = (s) => bar.querySelector(s), $$ = (s) => [...bar.querySelectorAll(s)];
  const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(e); game.audio?.play('ui_click', {}); setTimeout(() => el.classList.remove('down'), 120); });
  for (const b of $$('[data-m]')) press(b, () => setTerrainMode(game, b.dataset.m));
  press($('.no'), () => exitBuildMode(game));
  const lbl = $('.lbl b'), sub = $('.lbl small');
  const last = {};
  let t = 0;
  return {
    update(dt) {
      const m = game.build.mode, on = m?.kind === 'terrain';
      if (last.on !== on) { last.on = on; bar.classList.toggle('hidden', !on); root.classList.toggle('tbb-on', on); }
      if (!on) return;
      if (last.m !== m.m) { last.m = m.m; for (const b of $$('[data-m]')) b.classList.toggle('on', b.dataset.m === m.m); }
      t -= dt;
      if (t > 0) return;
      t = 0.12;
      const p = game.player, tool = shovelOf(p);
      lbl.textContent = `${TERRAIN_MODES[m.m].name}${tool ? ' · ' + (ITEMS[tool.id]?.name || 'Pá') : game.creative ? ' · criativo' : ''}`;
      const hv = game.ctl?.hover, at = hv ? [hv.wx, hv.wy] : m.at;
      const pv = at ? brushPreview(game, at[0], at[1]) : null;
      let s, cls = '';
      if (pv?.why) { s = PREVIEW_WHY[pv.why] || 'Não dá aqui'; cls = 'bad'; }
      else if (m.m === 'flat') { s = m.h == null ? `Clique para fixar a altura${pv ? ` (${num(pv.h)} andares)` : ''}` : `Altura alvo: ${num(m.h)} andares${pv ? ` · ${pv.list.length} cantos` : ''}`; cls = pv ? 'ok' : ''; }
      else if (pv) { s = `${pv.list.length} cantos ${m.m === 'dig' ? 'abaixam' : m.m === 'fill' ? 'sobem' : 'se acertam'}${m.m === 'fill' && !game.creative ? ` · terra: ${p.inv.count('dirt')}` : ''}`; cls = 'ok'; }
      else s = game.input.isTouch ? 'Toque no chão perto de você' : 'Aponte para o chão perto de você';
      if (sub.textContent !== s) sub.textContent = s;
      sub.className = cls;
    },
  };
}
