// Interface size: CSS `zoom` on the HUD (and the help overlay / tooltips) = base × the player's choice.
// Desktop base grows with the screen (≈1.3× at 1080p, never below 1×); phones start at 1×. The setting
// "Tamanho da interface" (80–160 %) is persisted in localStorage `wos.uiScale`. Read the live value with
// uiScale() (JS that positions things in HUD css px divides window sizes by it).

const KEY = 'wos.uiScale';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let desktop = !matchMedia('(pointer: coarse)').matches;
let current = 1;

export function uiUserScale() {
  try { const v = parseFloat(localStorage.getItem(KEY)); return Number.isFinite(v) ? clamp(v, 0.8, 1.6) : 1; } catch { return 1; }
}
export const uiScale = () => current;

export function applyUiScale(isDesktop = desktop) {
  desktop = isDesktop;
  const base = desktop ? clamp((innerHeight / 1080) * 1.3, 1, 1.55) : 1;
  const s = Math.round(base * uiUserScale() * 1000) / 1000;
  // never so big that the HUD cannot fit a small window
  current = clamp(s, 0.6, Math.max(0.8, Math.min(innerWidth / 700, innerHeight / 420)));
  document.documentElement.style.setProperty('--ui', String(current));
  return current;
}

export function setUiUserScale(v) {
  try { localStorage.setItem(KEY, String(clamp(v, 0.8, 1.6))); } catch { /* ignore */ }
  applyUiScale();
  dispatchEvent(new Event('resize')); // layouts that depend on the HUD size (thumb arc…) recompute
}

addEventListener('resize', () => applyUiScale());

// settings row (main menu and pause menu): inserted under the name field of settingsPanel
export function uiScaleSetting(el) {
  const pct = Math.round(uiUserScale() * 100);
  const row = document.createElement('label');
  row.className = 'mfield';
  row.innerHTML = `<span>Tamanho da interface <b data-k="uisv">${pct}%</b></span><input type="range" data-k="uis" min="80" max="160" step="5" value="${pct}">`;
  const anchor = el.querySelector('[data-k=name]')?.closest('label');
  if (anchor) anchor.after(row); else el.prepend(row);
  const inp = row.querySelector('input'), out = row.querySelector('[data-k=uisv]');
  inp.addEventListener('input', () => { out.textContent = inp.value + '%'; setUiUserScale(+inp.value / 100); });
}
