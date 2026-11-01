// The bright cartoon look (post shader uPop, engine/renderer.js `pop`): two player settings, saved in this browser
// (localStorage `wos.look` = { c, b } in %): "Cores" (vibrance) and "Brilho" (midtone gamma). 100 % = the house
// look, 0 % = the plain grade (no boost), 200 % = twice the boost.

const KEY = 'wos.look';
const VIB = 0.45, GAMMA = 0.17; // at 100 %
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function lookPrefs() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    return { c: clamp(Number.isFinite(d?.c) ? d.c : 100, 0, 200), b: clamp(Number.isFinite(d?.b) ? d.b : 100, 0, 200) };
  } catch { return { c: 100, b: 100 }; }
}

// renderer.pop from the saved choice
export function applyLook(R, P = lookPrefs()) {
  if (!R) return;
  R.pop = { vib: VIB * P.c / 100, gamma: 1 + GAMMA * P.b / 100 };
}

function saveLook(P) { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* ignore */ } }

// settings rows (main menu and pause menu: ui/netpanels.js settingsPanel), right after the graphics quality row
export function lookSettings(anchor, game) {
  const P = lookPrefs();
  const row = (label, k) => {
    const el = document.createElement('label');
    el.className = 'mfield';
    el.innerHTML = `<span>${label} <b data-k="${k}v">${P[k]}%</b></span><input type="range" data-k="${k}look" min="0" max="200" step="5" value="${P[k]}">`;
    const inp = el.querySelector('input'), out = el.querySelector(`[data-k=${k}v]`);
    inp.addEventListener('input', () => {
      P[k] = +inp.value; out.textContent = P[k] + '%';
      saveLook(P);
      applyLook(game?.R, P);
    });
    return el;
  };
  anchor.after(row('Cores', 'c'), row('Brilho', 'b'));
}
