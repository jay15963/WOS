// "Reino de X — Vila Y" (docs/REINOS.md): a title across the top of the screen when the local player enters a kingdom's
// territory, a settlement's town land or the free lands (event 'place' from game/towns.js placeSystem). The kingdom's
// banner beside it; fades in, holds, fades out. Cosmetic, local.
import { bannerURL } from './heraldry.js';

const KIND = { city: 'Cidade', castle: 'Castelo', village: 'Vila' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function installPlaceBanner(game, root) {
  if (typeof document === 'undefined' || !root) return null;
  const st = document.createElement('style');
  st.textContent = `
#placeban { position: absolute; left: 50%; top: 13%; transform: translate(-50%, -8px); display: flex; align-items: center; gap: 14px;
  pointer-events: none; opacity: 0; transition: opacity 0.7s ease, transform 0.7s ease; z-index: 6; text-align: center; }
#placeban.on { opacity: 1; transform: translate(-50%, 0); }
#placeban.on.under { opacity: 0; } /* (a panel open: the banner waits under it — phone screens) */
#placeban img { width: 42px; filter: drop-shadow(0 3px 3px rgba(0,0,0,0.5)); }
#placeban .pb-t { font: 700 34px/1 var(--n-fd, serif); color: #fbf1dc; letter-spacing: 1px; text-shadow: 0 2px 0 #24160d, 0 0 14px rgba(0,0,0,0.65); white-space: nowrap; }
#placeban .pb-s { font: 600 16px/1.2 var(--n-fd, serif); color: #f0d48a; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 6px; text-shadow: 0 1px 0 #24160d, 0 0 10px rgba(0,0,0,0.7); white-space: nowrap; }
#placeban .pb-rule { height: 2px; margin: 6px auto 0; width: 70%; background: linear-gradient(90deg, transparent, #f0d48a, transparent); }
`;
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'placeban';
  root.appendChild(el);
  let hideT = null;
  setInterval(() => { const m = !!game.ui?.modal; if (el.classList.contains('under') !== m) el.classList.toggle('under', m); }, 200); // (cheap: one flag)
  const show = (title, sub, B) => {
    el.innerHTML = `${B ? `<img src="${bannerURL(B, 40, 60)}" alt="">` : ''}<div><div class="pb-t">${esc(title)}</div><div class="pb-rule"></div><div class="pb-s">${esc(sub)}</div></div>${B ? `<img src="${bannerURL(B, 40, 60)}" alt="">` : ''}`;
    el.classList.remove('on');
    clearTimeout(hideT);
    // (no forced layout: the fade starts on the next frame; the hold, then the fade out)
    hideT = setTimeout(() => { el.classList.add('on'); hideT = setTimeout(() => el.classList.remove('on'), 4200); }, 40);
    game.lastPlace = { title, sub };
  };
  let lastK = null, lastTown = null;
  game.events.on('place', (d) => {
    // the first one (the arrival in a new / loaded world) waits for the loading screen to fade
    if (d.first) { setTimeout(() => game.events.emit('place', { ...d, first: false }), 1600); return; }
    const K = d.kingdom, town = d.town, k = K ? K.id : -1;
    if (town && (town.id !== lastTown || k !== lastK)) show(town.name, `${KIND[town.kind]} · Reino de ${K ? K.name : '—'}${game.realms?.besieged?.(town.id) ? ' · sob cerco' : ''}`, K?.banner); // (its kingdom now: a captured place's conqueror — game/towns.js placeAt)
    else if (!town && k !== lastK) {
      if (K) show(`Reino de ${K.name}`, d.district ? `${KIND[d.district.kind]} ${d.district.name}` : 'Terras do reino', K.banner);
      else if (lastK != null && lastK >= 0) show('Terras livres', 'Fora de qualquer reino', null);
    }
    lastK = k; lastTown = town ? town.id : null;
  });
  return el;
}
