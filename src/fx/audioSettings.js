// Audio section of the settings (main menu and pause menu): mute + Geral / Música / Efeitos / Ambiente
// sliders + pause between songs. Persisted and applied live (getAudio()).
// audioSettings(el): inside a settings panel it replaces the old "Som ligado" / "Volume" rows (or goes
// after the first field); on an empty container (or one marked data-audio-settings) it fills it.

import { getAudio } from './audio.js';
import { GAPS } from './music.js';

const ROWS = [['master', 'Geral'], ['music', 'Música'], ['sfx', 'Efeitos'], ['amb', 'Ambiente']];
const GAP_LABELS = [['cont', 'Contínua'], ['short', 'Curta'], ['normal', 'Normal'], ['long', 'Longa']];

const CSS = `
.aset { margin: 10px 0 6px; padding: 8px 12px 6px; border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 6px; background: rgba(0,0,0,0.22); }
.aset-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 34px;
  font: 600 12px var(--font, system-ui); letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted, #b9b2a4); }
.aset-mute { display: flex; align-items: center; gap: 8px; cursor: pointer; text-transform: none; letter-spacing: 0; font-size: 14px; color: var(--text, #ece6da); }
.aset-mute input { width: 20px; height: 20px; margin: 0; accent-color: #d9b45a; }
.aset-row { display: grid; grid-template-columns: 74px 1fr 34px; align-items: center; gap: 10px; min-height: 36px; font-size: 13.5px; color: var(--text, #ece6da); }
.aset-row input[type=range] { width: 100%; height: 28px; margin: 0; padding: 0; background: transparent; accent-color: #d9b45a; cursor: pointer; touch-action: none; }
.aset-row output { text-align: right; font-size: 12px; color: var(--muted, #b9b2a4); font-variant-numeric: tabular-nums; }
.aset-row select { grid-column: 2 / 4; min-height: 34px; padding: 5px 8px; font: 500 14px var(--font, system-ui); color: var(--text, #ece6da);
  background: rgba(0,0,0,0.35); border: 1px solid var(--border, rgba(255,255,255,0.14)); border-radius: 4px; }
.aset.off .aset-row { opacity: 0.45; }
`;

function css() {
  if (document.getElementById('wos-audio-css')) return;
  const s = document.createElement('style');
  s.id = 'wos-audio-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function audioSettings(el) {
  const a = getAudio();
  if (!a || !el) return () => {};
  css();
  const box = document.createElement('div');
  box.className = 'aset' + (a.enabled ? '' : ' off');
  box.innerHTML = `
    <div class="aset-h"><span>Som</span><label class="aset-mute"><input type="checkbox" data-as="on" ${a.enabled ? 'checked' : ''}> Som ligado</label></div>
    ${ROWS.map(([k, label]) => {
      const v = Math.round(a.getLevel(k) * 100);
      return `<label class="aset-row"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${v}" data-as="${k}" aria-label="Volume: ${label}"><output>${v}</output></label>`;
    }).join('')}
    <label class="aset-row"><span>Pausas</span><select data-as="gap" aria-label="Pausa entre músicas">
      ${GAP_LABELS.filter(([k]) => GAPS[k]).map(([k, l]) => `<option value="${k}" ${a.music.gapMode === k ? 'selected' : ''}>${l}${k === 'normal' ? ' (recomendada)' : ''}</option>`).join('')}
    </select></label>`;

  // placement
  const old = [el.querySelector('[data-k=audio]'), el.querySelector('[data-k=vol]')].map((n) => n?.closest('label')).filter(Boolean);
  if (old.length) { old[0].before(box); old.forEach((n) => n.remove()); }
  else if (el.hasAttribute?.('data-audio-settings') || !el.children.length) el.appendChild(box);
  else { const f = el.querySelector('.mfield'); if (f) f.after(box); else el.appendChild(box); }

  const on = box.querySelector('[data-as=on]');
  on.onchange = () => {
    a.enabled = on.checked;
    box.classList.toggle('off', !on.checked);
    if (on.checked) { a.unlock(); setTimeout(() => a.play('ui_click', { force: true }), 60); }
  };
  let tickT = 0;
  for (const [k] of ROWS) {
    const r = box.querySelector(`[data-as=${k}]`), out = r.nextElementSibling;
    r.oninput = () => {
      const v = +r.value / 100;
      out.textContent = r.value;
      a.setLevel(k, v);
      if ((k === 'sfx' || k === 'master') && performance.now() - tickT > 120) { tickT = performance.now(); a.play('ui_click', { force: true }); }
    };
  }
  const gap = box.querySelector('[data-as=gap]');
  gap.onchange = () => a.music.setGap(gap.value);
  return () => box.remove();
}
