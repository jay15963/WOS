// UI icons: atlas sprites rendered to data URLs (icon_* / item_* when the art exists),
// with crisp inline-SVG line icons as fallback.

import { ITEMS } from '../game/data.js';

const cache = new Map();

// Draw an atlas sprite region into a small canvas -> data URL (contain-fit, centered)
export function spriteURL(A, name, size = 64) {
  if (!A || !A.has(name) || !A.canvas) return null;
  const k = name + '@' + size;
  if (cache.has(k)) return cache.get(k);
  const s = A.get(name);
  const S = A.size || A.canvas.width;
  const sx = s.u0 * S, sy = s.v0 * S, sw = (s.u1 - s.u0) * S, sh = (s.v1 - s.v0) * S;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const f = Math.min(size / sw, size / sh) * 0.92;
  const w = sw * f, h = sh * f;
  g.imageSmoothingQuality = 'high';
  g.drawImage(A.canvas, sx, sy, sw, sh, (size - w) / 2, (size - h) / 2, w, h);
  const url = c.toDataURL();
  cache.set(k, url);
  return url;
}

const P = {
  strike: '<path d="M19.5 4.5 9 15"/><path d="M19.5 4.5v3.2L10.6 16.6"/><path d="M6.4 12.4l5.2 5.2"/><path d="M8 16l-3.6 3.6"/><path d="M3 9.5l2-1.2M4.6 5.2l1.8 1.6M9 3.2l.3 2.3"/>',
  attack: '<path d="M4 4l10.5 10.5M4 4v3l9 9M4 4h3l9 9"/><path d="M20 4 9.5 14.5M20 4v3l-9 9M20 4h-3l-9 9" opacity=".55"/><path d="M13 17l4 4M17 17l-4 4M11 17l-4 4M7 17l4 4"/>',
  charge: '<path d="M3 8h6M2 12h8M3 16h6"/><path d="M12 5l7 7-7 7"/><path d="M15.5 8.5 19 12l-3.5 3.5" opacity=".5"/>',
  whirlwind: '<path d="M12 12a1.6 1.6 0 0 1 3.2 0a3.2 3.2 0 0 1-6.4 0a4.8 4.8 0 0 1 9.6 0a6.4 6.4 0 0 1-12.8 0a8 8 0 0 1 16 0"/>',
  heal: '<path d="M5 20c0-7.8 5.2-13 13-13 0 7.8-5.2 13-13 13z"/><path d="M5 20l7.5-7.5"/><circle cx="17.5" cy="17.5" r="1.6"/><path d="M18 2.5v5M15.5 5h5" stroke-width="1.6"/>',
  sprint: '<path d="M4 6l6 6-6 6"/><path d="M11 6l6 6-6 6"/><path d="M18 6v12" opacity=".5"/>',
  eat: '<path d="M14.5 3.5a6 6 0 0 1 6 6c0 3.6-3.7 6.3-7.3 6.1l-3.3 3.3"/><path d="M14.5 3.5c-3.6 0-6.3 3.7-6.1 7.3l-3.3 3.3"/><circle cx="7.6" cy="20.2" r="1.7"/><circle cx="3.8" cy="16.4" r="1.7"/>',
  hunger: '<path d="M14.5 3.5a6 6 0 0 1 6 6c0 3.6-3.7 6.3-7.3 6.1l-3.3 3.3"/><path d="M14.5 3.5c-3.6 0-6.3 3.7-6.1 7.3l-3.3 3.3"/><circle cx="7.6" cy="20.2" r="1.7"/><circle cx="3.8" cy="16.4" r="1.7"/>',
  build: '<path d="M13.5 3.5l7 7-2.6 2.6-7-7z"/><path d="M12.2 7.8 3.5 16.5a2 2 0 0 0 2.8 2.8l8.7-8.7"/>',
  bag: '<rect x="4.5" y="7" width="15" height="14" rx="3"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7"/><path d="M4.5 13h15"/><path d="M10 13v2.5h4V13"/>',
  gather: '<path d="M5 19c0-8.3 5.7-14 14-14 0 8.3-5.7 14-14 14z"/><path d="M5 19l8-8"/><path d="M9.5 14.5h3.8M12 12V8.2" opacity=".6"/>',
  axe: '<path d="M6 21 15.5 7"/><path d="M12.5 4.2c3.3-.6 7.4 2.3 7.8 6.2l-4.7.7-3.8-2.6z"/>',
  pickaxe: '<path d="M5 20 15 10"/><path d="M6 6.5c4.5-3.5 10-3.2 13.5 0.5-3.5-1-7-1-10.3.8"/><path d="M17.5 4.5c3.5 4.5 3.2 9.5.5 13-1-3.3-1-6.8.8-10.3"/>',
  fire: '<path d="M12 3c.8 3.3 5 4.8 5 10a5 5 0 0 1-10 0c0-2.4 1.1-3.9 2.3-5 0 2 .9 3.2 2 3.4C11 8.5 10.5 6 12 3z"/>',
  campfire: '<path d="M12 2.5c.7 2.8 4.2 4 4.2 8.3a4.2 4.2 0 0 1-8.4 0c0-2 .9-3.2 1.9-4.1 0 1.7.8 2.6 1.7 2.8-.4-2.7-.8-4.7.6-7z"/><path d="M4 21l16-4M4 17l16 4"/>',
  torch: '<path d="M12 21V12"/><path d="M9 12h6l-1 2h-4z"/><path d="M12 2.8c.9 1.9 2.9 2.9 2.9 5.3a2.9 2.9 0 0 1-5.8 0c0-1.3.7-2.1 1.3-2.7.1 1 .5 1.5 1 1.6-.2-1.5-.2-2.8.6-4.2z"/>',
  wall_wood: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  chest: '<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M3 13h18"/><path d="M3 9.5C3 6.5 7 4.5 12 4.5s9 2 9 5"/><path d="M10.5 12v3h3v-3"/>',
  bed: '<path d="M3 19V6"/><path d="M3 15h18v4"/><path d="M21 15v-3a2 2 0 0 0-2-2h-8v5"/><circle cx="7" cy="12" r="1.8"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.9 1.4 4.6 3 5.6V20h10v-3.4c1.6-1 3-2.7 3-5.6a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10 20v-2M14 20v-2"/>',
  sick: '<path d="M12 3s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11z"/><path d="M9.5 14.5c.8 1 1.6 1.5 2.5 1.5s1.7-.5 2.5-1.5" opacity=".7"/>',
  cold: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M10 4.5l2 2 2-2M10 19.5l2-2 2 2" opacity=".7"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  unfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  install: '<path d="M12 3.5v11M7 10l5 5 5-5"/><path d="M4.5 16.5V20h15v-3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  drop: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 20h14"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-2.6 0-4-1.3-5.4-3.4L3.4 13a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
  bandage2: '',
};

export function svgIcon(name, cls = '') {
  const body = P[name] || P.hand;
  return `<svg class="svgi ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Ability / UI icon: prefers atlas icon_<name>, falls back to SVG line icon
export function uiIcon(A, name, cls = '') {
  const url = spriteURL(A, 'icon_' + name, 96);
  if (url) return `<img class="spri ${cls}" src="${url}" alt="" draggable="false">`;
  return svgIcon(name, cls);
}

// Building icon: atlas sprite of the building itself, else SVG
export function buildIcon(A, type) {
  const url = spriteURL(A, type, 96);
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return svgIcon(type);
}

export function itemIcon(A, id) {
  const def = ITEMS[id];
  if (!def) return '';
  const url = spriteURL(A, def.sprite, 64);
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return `<span class="emo">${def.emoji}</span>`;
}
