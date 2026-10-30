// Combat UI icons (action bar, buffs, target debuffs): the bold glyphs of icons.js (one look for every ability,
// readable on the translucent touch buttons), else the atlas `icon_<name>`, else a line icon.

import { spriteURL, svgIcon, glyph, hasGlyph } from './icons.js';

export function combatSvg(name, cls = '') {
  return svgIcon(name, cls);
}

const cache = new Map();
export function combatIcon(A, name, cls = '') {
  const k = name + '|' + cls;
  if (cache.has(k)) return cache.get(k);
  let html;
  if (hasGlyph(name)) html = glyph(name, cls);
  else {
    const url = spriteURL(A, 'icon_' + name, 96);
    html = url ? `<img class="spri ${cls}" src="${url}" alt="" draggable="false">` : combatSvg(name, cls);
  }
  cache.set(k, html);
  return html;
}
