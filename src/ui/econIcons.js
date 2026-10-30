// Icons for the economy UI: bold glyphs (icons.js) for actions, atlas sprites with a baked ink outline for items and
// structures (incl. autotile / door variants), with emoji / line-SVG fallbacks so missing art never breaks the UI.

import { ITEMS, BUILDINGS } from '../game/data.js';
import { spriteURL, iconURL, svgIcon, glyph, hasGlyph } from './icons.js';

export function econSvg(name) {
  return svgIcon(name);
}

// UI icon: the bold glyph when there is one, else atlas icon_<name>, else a line icon
export function econIcon(A, name) {
  if (hasGlyph(name)) return glyph(name);
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
  const url = short(iconURL(A, def.sprite, 96) || (def.weapon || def.slot ? iconURL(A, 'held_' + id, 96) : null));
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return `<span class="emo">${def.emoji || '•'}</span>`;
}

export function buildIco(A, type) {
  const def = BUILDINGS[type];
  for (const n of [type, type + '_10', type + '_h', type + '_0', type + '_15']) {
    const url = short(iconURL(A, n, 96));
    if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  }
  return `<span class="emo">${def?.emoji || '🏗️'}</span>`;
}
