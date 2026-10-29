// "Mira assistida" for aimed ground abilities (src/ui/aim.js): a sticky lock ("glue") with hysteresis.
//  - snap radius of a target  = (snap + grow × its distance from the shooter) × k + its body radius
//  - the raw aim point (stick / mouse) locks onto the nearest target within its snap radius
//  - while locked: pushing the raw point toward another target hops onto it (inside that target's snap radius and
//    clearly closer to it than to the locked one); pushing beyond RELEASE × the locked target's snap radius breaks
//    the lock (then it re-locks onto whatever is under the raw point, or aims freely)
// Pure functions (no DOM, no game state) so the hysteresis can be checked in isolation (tools/mp-test.js G1).
// Setting: localStorage 'wos.aimAssist' = 'strong' | 'normal' | 'off' (default normal); mouse aim is a bit weaker and
// Alt held turns it off (src/ui/aim.js).

export const ASSIST = {
  strong: { snap: 1.5, grow: 0.035 },
  normal: { snap: 1.05, grow: 0.025 },
};
export const RELEASE = 2.5;   // break radius = RELEASE × snap radius of the locked target
export const HOP = 0.6;       // hop when the raw point is this much closer to another target than to the locked one
export const MOUSE_K = 0.7;   // desktop magnetism is slightly weaker
const KEY = 'wos.aimAssist';
export const ASSIST_OPTIONS = [['strong', 'Forte'], ['normal', 'Normal'], ['off', 'Desligada']];

let cur = null; // cached (read every frame while aiming)
export function aimAssistMode() {
  if (cur) return cur;
  try { const v = localStorage.getItem(KEY); cur = v === 'strong' || v === 'off' ? v : 'normal'; } catch { cur = 'normal'; }
  return cur;
}
export function setAimAssistMode(v) { cur = ASSIST[v] || v === 'off' ? v : 'normal'; try { localStorage.setItem(KEY, cur); } catch { /* ignore */ } }

// assist parameters for this frame (null = no assist)
export function assistParams(mode = aimAssistMode(), mouse = false) {
  const A = ASSIST[mode];
  return A ? { snap: A.snap, grow: A.grow, k: mouse ? MOUSE_K : 1 } : null;
}

export function snapRadius(e, P, ox, oy) {
  return (P.snap + P.grow * Math.hypot(e.x - ox, e.y - oy)) * P.k + (e.r || 0.3) * (e.scale || 1);
}

// one step of the lock: lock (or null), raw point (rx, ry), candidate targets [{x, y, r}], params, shooter (ox, oy)
export function stepLock(lock, rx, ry, cands, P, ox, oy) {
  if (!P) return null;
  if (lock && !cands.includes(lock)) lock = null;
  let best = null, bd = 1e9;
  for (const e of cands) {
    if (e === lock) continue;
    const d = Math.hypot(e.x - rx, e.y - ry);
    if (d <= snapRadius(e, P, ox, oy) && d < bd) { bd = d; best = e; }
  }
  if (!lock) return best;
  const dl = Math.hypot(lock.x - rx, lock.y - ry);
  if (best && bd < dl * HOP) return best;                          // pushed onto a neighbour: hop
  if (dl <= snapRadius(lock, P, ox, oy) * RELEASE) return lock;    // still inside the glue
  return best;                                                     // forced out: next target or free
}

// settings row "Mira assistida" (Forte / Normal / Desligada), appended to a settings panel
export function aimAssistSetting(el) {
  if (!el || typeof document === 'undefined') return;
  const cur = aimAssistMode();
  const row = document.createElement('label');
  row.className = 'mfield';
  row.innerHTML = `Mira assistida (tiro longo, lançar lança)
    <select data-k="aimassist">${ASSIST_OPTIONS.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.style.margin = '2px 0 8px';
  hint.textContent = 'A mira gruda no bicho perto do ponto mirado; puxe mais forte para soltar (ou pular para outro). No computador, segure Alt para mirar livre.';
  const anchor = el.querySelector('[data-k=qualityrow]');
  if (anchor) anchor.before(row, hint); else el.append(row, hint);
  row.querySelector('select').onchange = (e) => setAimAssistMode(e.target.value);
}
