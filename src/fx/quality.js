// Graphics quality (owned by the visuals pass; cosmetic, local to each client).
//   game.quality     -> effective tier 'low' | 'medium' | 'high' (read-only; other systems branch on it)
//   game.qualityMode -> the player's choice 'auto' | 'low' | 'medium' | 'high' (localStorage 'wos.quality')
// 'auto' starts from a device guess (GPU string, memory, cores, touch) and steps down when frames stay slow
// (after the adaptive resolution has had a go); the step-down is remembered for a week, and after 45 s of fast
// frames at full resolution it may climb back one tier per session (never above the device guess).
// A tier sets: device-pixel cap, shader level (#define QL 0/1/2 in the renderer), particle cap, ambient
// FX density (qualityPreset().fx), post grain / bloom.
// UI: qualitySettings(el, game) renders the settings rows (one call from the settings panel): the quality
// select plus the "Efeitos de tela de status" and "Reduzir movimento" toggles (src/fx/status.js).

import { statusFxOn, reduceMotion, setStatusFx, setReduceMotion } from './status.js';

export const TIERS = ['low', 'medium', 'high'];
export const PRESETS = {
  low: { level: 0, maxDpr: 1, particles: 900, fx: 0.5, grain: 0, bloom: 0 },
  medium: { level: 1, maxDpr: 1.5, particles: 2000, fx: 0.8, grain: 0.018, bloom: 0.8 },
  high: { level: 2, maxDpr: 2, particles: 3000, fx: 1, grain: 0.022, bloom: 1 },
};
const KEY = 'wos.quality', AUTO_KEY = 'wos.quality.auto', WEEK = 7 * 864e5;
const OPTIONS = [['auto', 'Automática'], ['high', 'Alta'], ['medium', 'Média'], ['low', 'Baixa (celulares fracos)']];
const TIER_PT = { high: 'alta', medium: 'média', low: 'baixa' };

const state = { mode: 'auto', tier: 'high', R: null, game: null, listeners: new Set() };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

// Best guess for this device (no measurement yet).
export function detectTier(gl) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const touch = (nav.maxTouchPoints || 0) > 0 || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (touch && /Macintosh/.test(ua));
  const mem = nav.deviceMemory || 8, cores = nav.hardwareConcurrency || 8;
  let gpu = '';
  try { const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; } catch { /* ignore */ }
  const weakGpu = /Mali-4|Mali-T[678]|Mali-G(31|51|52)\b|Adreno \(TM\) [345]\d\d|Adreno \(TM\) 6[01]\d|PowerVR (SGX|Rogue G)|Intel.*HD Graphics [2-5]\d{2,3}\b|SwiftShader|llvmpipe/i.test(gpu);
  if (weakGpu || mem <= 2 || cores <= 2) return 'low';
  if (mobile || mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

function autoTier(gl) {
  const guess = detectTier(gl);
  try {
    const m = JSON.parse(lsGet(AUTO_KEY) || 'null');
    if (m && TIERS.includes(m.tier) && Date.now() - m.t < WEEK && TIERS.indexOf(m.tier) < TIERS.indexOf(guess)) return m.tier;
  } catch { /* ignore */ }
  return guess;
}

function push() {
  const P = PRESETS[state.tier], R = state.R, g = state.game;
  if (R) {
    R.maxDpr = P.maxDpr;
    R.autoScale = state.mode === 'auto';
    if (state.mode !== 'auto') R.renderScale = 1;
    R.setQuality?.(P.level);
    if (R.fx) { R.fx.grain = P.grain; R.fx.bloom = P.bloom; }
    R.w = 0; // force a resize with the new pixel ratio
  }
  if (g?.particles) g.particles.max = P.particles;
  for (const fn of state.listeners) fn(state);
}

// Apply a mode ('auto' | tier) to a renderer (game may not exist yet). Returns the effective tier.
export function applyQuality(R, mode) {
  if (mode == null) mode = lsGet(KEY) || 'auto';
  if (mode !== 'auto' && !TIERS.includes(mode)) mode = 'auto';
  if (R) state.R = R;
  state.mode = mode;
  state.tier = mode === 'auto' ? autoTier(state.R?.gl) : mode;
  push();
  return state.tier;
}

export function setQualityMode(mode) { lsSet(KEY, mode); return applyQuality(state.R, mode); }
export const qualityPreset = () => PRESETS[state.tier];
export const qualityState = () => ({ mode: state.mode, tier: state.tier, level: PRESETS[state.tier].level });

// Auto mode only: one tier down (frames stayed slow). Remembered for a week. Returns true if it stepped.
export function qualityStepDown() {
  if (state.mode !== 'auto') return false;
  const i = TIERS.indexOf(state.tier);
  if (i <= 0) return false;
  state.tier = TIERS[i - 1];
  lsSet(AUTO_KEY, JSON.stringify({ tier: state.tier, t: Date.now() }));
  if (state.R) state.R.renderScale = 1;
  push();
  return true;
}

// Auto mode only: one tier back up (frames stayed fast for a long time at full resolution), never above the
// device guess. The ambient system calls it at most once per session. Returns true if it stepped.
export function qualityStepUp() {
  if (state.mode !== 'auto') return false;
  const i = TIERS.indexOf(state.tier), cap = TIERS.indexOf(detectTier(state.R?.gl));
  if (i >= cap) return false;
  state.tier = TIERS[i + 1];
  if (i + 1 >= cap) lsSet(AUTO_KEY, null);
  else lsSet(AUTO_KEY, JSON.stringify({ tier: state.tier, t: Date.now() }));
  push();
  return true;
}

// Attach to a game: game.quality / game.qualityMode getters, particle cap.
export function installQuality(game) {
  state.game = game;
  if (game.R && game.R !== state.R) { state.R = game.R; applyQuality(game.R, state.mode); }
  Object.defineProperty(game, 'quality', { get: () => state.tier, configurable: true });
  Object.defineProperty(game, 'qualityMode', { get: () => state.mode, configurable: true });
  push();
}

// Settings row: "Qualidade gráfica" select + a short note in auto mode. Returns a cleanup function.
export function qualitySettings(el, game = null) {
  if (!el) return () => {};
  if (game?.R && !state.R) state.R = game.R;
  const cur = lsGet(KEY) || 'auto';
  el.innerHTML = `<label class="mfield">Qualidade gráfica
      <select data-k="quality">${OPTIONS.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="muted" data-k="qnote" style="margin:2px 0 8px"></p>
    <label class="toggle"><input type="checkbox" data-k="statusfx" ${statusFxOn() ? 'checked' : ''}> Efeitos de tela de status (ferido, frio, fome…)</label>
    <label class="toggle"><input type="checkbox" data-k="reducemotion" ${reduceMotion() ? 'checked' : ''}> Reduzir movimento (sem tremor nem balanço da tela)</label>`;
  const sel = el.querySelector('select'), note = el.querySelector('[data-k=qnote]');
  const fx = el.querySelector('[data-k=statusfx]'), rm = el.querySelector('[data-k=reducemotion]');
  const st = () => game?.statusFx || state.game?.statusFx;
  fx.onchange = () => { setStatusFx(fx.checked); const s = st(); if (s) s.on = fx.checked; };
  rm.onchange = () => { setReduceMotion(rm.checked); const s = st(); if (s) s.rm = rm.checked; };
  let seen = false;
  const upd = () => {
    if (el.isConnected) seen = true;
    else if (seen) { state.listeners.delete(upd); return; } // panel closed
    note.textContent = state.mode === 'auto' ? `Ajusta sozinha pelo desempenho (agora: ${TIER_PT[state.tier]}).` : 'Baixa economiza bateria; Alta liga todos os efeitos.';
  };
  sel.onchange = () => { setQualityMode(sel.value); upd(); };
  state.listeners.add(upd);
  upd();
  return () => state.listeners.delete(upd);
}
