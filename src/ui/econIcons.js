// Icons for the economy UI: atlas sprites (icon_*, item_*, structure sprites incl. autotile / door
// variants) rendered to data URLs, with emoji / inline-SVG fallbacks so missing art never breaks the UI.

import { ITEMS, BUILDINGS } from '../game/data.js';
import { spriteURL, svgIcon } from './icons.js';

const SVG = {
  craft: '<path d="M14.5 5.5l4 4"/><path d="M3.5 20.5l9.2-9.2"/><path d="M12.4 4.2a3.6 3.6 0 0 1 5.1 0l2.3 2.3a3.6 3.6 0 0 1 0 5.1l-1.3 1.3-7.4-7.4z"/><path d="M5 13l6 6" opacity=".5"/>',
  mine: '<path d="M5 20 15 10"/><path d="M6 6.5c4.5-3.5 10-3.2 13.5 0.5-3.5-1-7-1-10.3.8"/><path d="M17.5 4.5c3.5 4.5 3.2 9.5.5 13-1-3.3-1-6.8.8-10.3"/>',
  equip: '<path d="M12 3 5 6v5c0 4.6 3 8.2 7 10 4-1.8 7-5.4 7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  decon: '<path d="M4 20 14 10"/><path d="M13 4l7 7-3 3-7-7z"/><path d="M4 4l16 16" opacity=".6"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-2.6 0-4-1.3-5.4-3.4L3.4 13a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  seed: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/>',
};

export function econSvg(name) {
  const body = SVG[name];
  if (!body) return svgIcon(name);
  return `<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// UI icon: atlas icon_<name> when present, else our SVG
export function econIcon(A, name) {
  const url = short(spriteURL(A, 'icon_' + name, 96));
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return econSvg(name);
}

// data: URLs are long; panels re-render often, so hand out short blob: URLs instead (cached)
const SHORT = new Map();
function short(url) {
  if (!url || !url.startsWith('data:')) return url;
  let s = SHORT.get(url);
  if (!s) {
    try {
      const [head, b64] = url.split(',');
      const bin = atob(b64), n = bin.length, u8 = new Uint8Array(n);
      for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
      s = URL.createObjectURL(new Blob([u8], { type: head.slice(5).split(';')[0] || 'image/png' }));
    } catch { s = url; }
    SHORT.set(url, s);
  }
  return s;
}

export function itemIco(A, id) {
  const def = ITEMS[id];
  if (!def) return '';
  const url = short(spriteURL(A, def.sprite, 64) || (def.weapon || def.slot ? spriteURL(A, 'held_' + id, 64) : null));
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return `<span class="emo">${def.emoji || '•'}</span>`;
}

export function buildIco(A, type) {
  const def = BUILDINGS[type];
  for (const n of [type, type + '_10', type + '_h', type + '_0', type + '_15']) {
    const url = short(spriteURL(A, n, 96));
    if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  }
  return `<span class="emo">${def?.emoji || '🏗️'}</span>`;
}
