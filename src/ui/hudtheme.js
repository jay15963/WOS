// HUD theme runtime (agent N): the procedural textures and the SVG symbol sprite used by hud-theme.css / hud.css.
// - `--n-hatch`: hand-drawn hatching (short brush strokes, two directions) on a transparent tile, dark brown.
//   Painted once on a canvas → data URL → CSS variable on <html>. Elements put it behind themselves with a soft mask.
// - `--n-grain`: faint paper grain for windows / parchment.
// - SVG sprite (<svg id="n-sprite">): solid glyphs used by the HUD (`nIcon('heart')` → <svg><use href="#n-heart"/></svg>).
// installHudTheme() is idempotent and cheap (≈2 ms); called by the HUD, the pause menu and the main menu.
// Everything here is cosmetic and local.

const INK = [36, 22, 13];

// tiny deterministic PRNG: the texture is the same on every boot (no flicker between sessions)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function hatchTile(size = 192) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const R = rng(7331);
  g.lineCap = 'round';
  // two hatch families (≈ 58° and ≈ 150°) + a few scribbles; drawn with wrap-around so the tile repeats seamlessly
  const strokes = [];
  // dense short brush strokes, mostly one direction (like an ink-pen shading), a third crossing them
  for (let i = 0; i < 520; i++) {
    const fam = R() < 0.7 ? 0 : 1;
    const a = (fam ? 148 : 62) * Math.PI / 180 + (R() - 0.5) * 0.42;
    const len = 6 + R() * 12;
    strokes.push([R() * size, R() * size, a, len, 1.5 + R() * 1.6, 0.42 + R() * 0.5]);
  }
  for (const [x, y, a, len, w, al] of strokes) {
    const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
    g.strokeStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${al.toFixed(2)})`;
    g.lineWidth = w;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const X = x + ox, Y = y + oy;
      if (X < -20 || Y < -20 || X > size + 20 || Y > size + 20) continue;
      g.beginPath();
      // slight bow: a hand stroke is never perfectly straight
      g.moveTo(X - dx, Y - dy);
      g.quadraticCurveTo(X + dy * 0.12, Y - dx * 0.12, X + dx, Y + dy);
      g.stroke();
    }
  }
  return c.toDataURL('image/png');
}

function grainTile(size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data, R = rng(99);
  for (let i = 0; i < d.length; i += 4) {
    const v = R();
    const light = v > 0.5;
    d[i] = light ? 255 : 30; d[i + 1] = light ? 240 : 18; d[i + 2] = light ? 210 : 8;
    d[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 22);
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

// solid glyphs (24×24): ink on cream badges, cream on dark plates (fill = currentColor)
const SYM = {
  heart: '<path d="M12 21.2s-7.6-4.7-9.7-9.5C.8 8.1 3 4.3 6.7 4.3c2.2 0 3.9 1.2 5.3 3.1 1.4-1.9 3.1-3.1 5.3-3.1 3.7 0 5.9 3.8 4.4 7.4-2.1 4.8-9.7 9.5-9.7 9.5z"/>',
  bolt: '<path d="M13.8 1.8 4.2 13.6h6.3L9.1 22.2l10.3-12.6h-6.5z"/>',
  food: '<path d="M15.2 2.4c3.6 0 6.5 2.9 6.5 6.5 0 4-3.6 7-7.6 6.5l-2.4 2.4c.2.3.3.7.3 1.1a2.3 2.3 0 1 1-4.4 1.1 2.3 2.3 0 1 1 1.1-4.4c.4 0 .8.1 1.1.3l2.4-2.4c-.5-4 2.5-7.6 6.5-7.6z"/><path d="M16.2 6.2c1.3.3 2.3 1.3 2.6 2.6" fill="none" stroke="#fff3df" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>',
  flame: '<path d="M12 1.6c1.1 4 6.4 5.6 6.4 11.6a6.4 6.4 0 0 1-12.8 0c0-3 1.4-4.8 2.9-6.2 0 2.4 1.1 3.9 2.5 4.1C10.4 7.9 10 4.8 12 1.6z"/><path d="M12 13.2c.4 1.6 2.4 2.2 2.4 4.3a2.4 2.4 0 0 1-4.8 0c0-1.2.6-1.8 1.2-2.3 0 .8.4 1.2.8 1.3-.2-1.3-.2-2.2.4-3.3z" fill="#fff3df" fill-opacity=".6"/>',
  snow: '<g fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.4 3.9 12 6.3l2.6-2.4M9.4 20.1 12 17.7l2.6 2.4"/></g>',
  star: '<path d="M12 2.2l3 6.2 6.8.9-5 4.8 1.3 6.7L12 17.6l-6.1 3.2 1.3-6.7-5-4.8 6.8-.9z"/>',
  sun: '<circle cx="12" cy="12" r="4.6"/><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/></g>',
  moon: '<path d="M20.4 14.6A8.8 8.8 0 0 1 9.4 3.6a8.8 8.8 0 1 0 11 11z"/>',
  cloud: '<path d="M6.8 19.2a4.6 4.6 0 0 1-.5-9.2 6.1 6.1 0 0 1 11.6 1.7 3.8 3.8 0 0 1-.3 7.5z"/>',
  rain: '<path d="M6.8 15.4a4.3 4.3 0 0 1-.5-8.6 5.7 5.7 0 0 1 10.9 1.6 3.5 3.5 0 0 1-.3 7z"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 18.2l-1 2.6M12 18.2l-1 2.6M16 18.2l-1 2.6"/></g>',
  storm: '<path d="M6.8 14.6a4.3 4.3 0 0 1-.5-8.6 5.7 5.7 0 0 1 10.9 1.6 3.5 3.5 0 0 1-.3 7z"/><path d="M12.6 13.4 9.2 18.2h2.6l-1.2 4 4.2-5.6h-2.6l1.3-3.2z"/>',
  fog: '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3.5 8h13M6.5 12h14M3.5 16h11M8.5 20h9"/></g>',
  skull: '<path fill-rule="evenodd" d="M12 2.5a8.3 8.3 0 0 0-8.3 8.3c0 3 1.4 4.8 3.1 5.8v3.4c0 .6.4 1 1 1h8.4c.6 0 1-.4 1-1v-3.4c1.7-1 3.1-2.8 3.1-5.8A8.3 8.3 0 0 0 12 2.5zM8.9 9.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zm6.2 0a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM12 14.2l-1.3 2.2h2.6z"/>',
  home: '<path d="M2.6 11.6 12 3.6l9.4 8v8.5c0 .6-.4 1-1 1h-5.2v-6h-6.4v6H3.6c-.6 0-1-.4-1-1z"/>',
  swords: '<g fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l10.5 10.5M4 4v3l9 9M4 4h3l9 9"/><path d="M20 4 13.8 10.2M20 4v3l-4 4M20 4h-3l-4 4" /><path d="M13 17l4 4M17 17l-4 4M11 17l-4 4M7 17l4 4"/></g>',
  pin: '<path d="M12 22s-6.8-6.6-6.8-12a6.8 6.8 0 0 1 13.6 0c0 5.4-6.8 12-6.8 12z"/>',
};

export function nIcon(name, cls = '') {
  return `<svg class="ni ${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#n-${name}"/></svg>`;
}

let done = false;
export function installHudTheme() {
  if (done || typeof document === 'undefined') return;
  done = true;
  // horizontal tab strips: fade the edge(s) that hide more tabs, and bring the selected tab into view (centred)
  // whenever a strip is (re)rendered — selecting a tab near the end reveals the hidden ones
  const STRIPS = '.tabs, .ktabs, .cc-tabs';
  const edges = (t) => {
    const more = t.scrollWidth > t.clientWidth + 1;
    t.classList.toggle('more-l', more && t.scrollLeft > 2);
    t.classList.toggle('more-r', more && t.scrollLeft < t.scrollWidth - t.clientWidth - 2);
  };
  const seen = new WeakSet();
  const prep = (t) => {
    if (!seen.has(t)) {
      seen.add(t);
      const on = t.querySelector('.on, [aria-selected="true"]');
      if (on && t.scrollWidth > t.clientWidth + 1) {
        requestAnimationFrame(() => { // after the panel restored its scroll position
          const want = on.offsetLeft - (t.clientWidth - on.offsetWidth) / 2;
          t.scrollTo({ left: Math.max(0, want), behavior: 'smooth' });
        });
      }
    }
    edges(t);
  };
  addEventListener('scroll', (e) => { const t = e.target; if (t?.matches?.(STRIPS)) edges(t); }, { capture: true, passive: true });
  addEventListener('click', (e) => { const b = e.target?.closest?.('.cc-tab'); const t = b?.closest(STRIPS); if (t) { seen.delete(t); requestAnimationFrame(() => prep(t)); } }, true);
  addEventListener('resize', () => document.querySelectorAll(STRIPS).forEach(edges));
  try {
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(STRIPS)) prep(n);
        else if (n.querySelector) n.querySelectorAll(STRIPS).forEach(prep);
      }
    }).observe(document.body, { childList: true, subtree: true });
  } catch { /* no observer: strips still scroll */ }

  // mouse wheel over a horizontal tab strip scrolls it sideways (build menu, crafting, Detalhes, editor tabs)
  addEventListener('wheel', (e) => {
    const t = e.target?.closest?.('.tabs, .ktabs, .cc-tabs');
    if (!t || t.scrollWidth <= t.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    t.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false, capture: true });
  try {
    const st = document.documentElement.style;
    st.setProperty('--n-hatch', `url(${hatchTile()})`);
    st.setProperty('--n-grain', `url(${grainTile()})`);
  } catch (e) { console.warn('[hud] theme textures', e); }
  if (!document.getElementById('n-sprite')) {
    const box = document.createElement('div');
    box.innerHTML = `<svg id="n-sprite" xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${
      Object.entries(SYM).map(([k, v]) => `<symbol id="n-${k}" viewBox="0 0 24 24" fill="currentColor">${v}</symbol>`).join('')}</svg>`;
    document.body.prepend(box.firstElementChild);
  }
}
