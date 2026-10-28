// Combat UI icons: atlas `icon_<name>` when the art exists, else a crisp line SVG drawn here,
// else the generic set in icons.js. Used by the action bar, buffs and the target frame.

import { spriteURL, svgIcon } from './icons.js';

const P = {
  punch: '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V11M10 10V6.5a1.5 1.5 0 0 1 3 0V10M13 10V7a1.5 1.5 0 0 1 3 0v3.5"/><path d="M16 10.5a1.5 1.5 0 0 1 3 0V14c0 3.6-2.7 6.5-6.5 6.5S7 17.8 7 14.5V11"/><path d="M2 9h2.5M2 13h2.5M3 17h2" opacity=".6"/>',
  shove: '<path d="M3 12h8M8 8l4 4-4 4"/><path d="M14.5 5.5 20 12l-5.5 6.5"/><path d="M18 3.5 21 7M18 20.5 21 17" opacity=".55"/>',
  stab: '<path d="M20 4l-9 9"/><path d="M20 4l-1.5 4.5L13 14"/><path d="M9.5 12.5l2 2"/><path d="M10.5 13.5 5 19"/><path d="M2.5 14.5l2.2-.8M6 21.5l.9-2.1" opacity=".6"/>',
  lacerate: '<path d="M5 4c4 3 7 8 8 15M10 3c3 3 5 7 6 12M15 3c2 2 4 5 4 9"/><path d="M6.5 19.5a1.5 1.5 0 1 0 3 0c0-1-1.5-2.6-1.5-2.6s-1.5 1.6-1.5 2.6z"/>',
  cleave: '<path d="M4 20 14 10"/><path d="M11 5.5c3-2.5 7.5-1 8.5 3l-4 3-3-3z"/><path d="M2.8 10.5A10 10 0 0 1 9.5 3.2" opacity=".6"/>',
  smash: '<path d="M5 19 13 11"/><path d="M11.2 6.3l3.5-3.5 6.5 6.5-3.5 3.5z"/><path d="M2.5 21.5 4 20M2 16.5h2.5M8 22v-2.4" opacity=".7"/>',
  pierce: '<path d="M3 21 20 4"/><path d="M21 3l-6.2 1.2 5 5z"/><circle cx="8.5" cy="15.5" r="2.3" opacity=".6"/><circle cx="13.5" cy="10.5" r="1.7" opacity=".6"/>',
  sweep: '<path d="M3.5 17.5a10 10 0 0 1 17 0"/><path d="M16.5 13.5l4 4-5.2.9"/><path d="M12 9V3M9.5 5.5 12 3l2.5 2.5" opacity=".6"/>',
  shoot: '<path d="M6 3c6 3 6 15 0 18"/><path d="M6 3v18" opacity=".5"/><path d="M3.5 12h16.5"/><path d="M17 9l3 3-3 3"/>',
  aimed_shot: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/><circle cx="12" cy="12" r="1.6"/>',
  multi_shot: '<path d="M3 20 19 8M3 20h17M3 20 9 4"/><path d="M15.6 7.4l3.6.4-.4 3.6M17 17l3 3-3 3M6.4 5 9 4l1 3.1"/>',
  disengage: '<path d="M20.5 17.5c-2-6.2-7.4-9.3-14.5-8.4"/><path d="M9.5 5 5.4 9.1l4.2 4"/><path d="M14 21h7" opacity=".55"/>',
  block: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="M12 6.5v11M8 11h8" opacity=".55"/>',
  shield_bash: '<path d="M10 5 4 7.4v4.4c0 3.7 2.5 6.6 6 7.6 3.5-1 6-3.9 6-7.6V7.4z"/><path d="M19.5 4.5l-2 2M21.5 10h-2.8M16.5 2v2.6" opacity=".75"/>',
  torch_swing: '<path d="M7.5 21 12.5 11.5"/><path d="M11 11l3.6 1.6"/><path d="M15.4 2.8c.8 2 3 2.9 3 5.5a3 3 0 0 1-6 .4c0-1.3.6-2.2 1.3-2.8.1 1 .5 1.5 1 1.6-.2-1.6-.1-3 .7-4.7z"/><path d="M2.8 12.5A9 9 0 0 1 6.6 6" opacity=".6"/>',
  poison: '<path d="M12 3s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11z"/><circle cx="9.8" cy="14" r="1.1"/><circle cx="14.2" cy="14" r="1.1"/><path d="M10 17.5h4" opacity=".7"/>',
  bleed: '<path d="M9 3.5s4 4.6 4 7.4a4 4 0 0 1-8 0c0-2.8 4-7.4 4-7.4z"/><path d="M16.5 11s3 3.4 3 5.5a3 3 0 0 1-6 0c0-2.1 3-5.5 3-5.5z"/>',
  stun: '<path d="M12 3.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 11.7l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"/><ellipse cx="12" cy="18.5" rx="8" ry="2.5" opacity=".6"/>',
  arrow: '<path d="M4 20 18 6"/><path d="M13.5 5.5H18.5V10.5"/><path d="M4 20l.8-3.6M4 20l3.6-.8M6.4 17.6l.8-3M6.4 17.6l3-.8" opacity=".7"/>',
};

const cache = new Map();
export function combatSvg(name, cls = '') {
  const body = P[name];
  if (!body) return svgIcon(name, cls);
  return `<svg class="svgi ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function combatIcon(A, name, cls = '') {
  const k = name + '|' + cls;
  if (cache.has(k)) return cache.get(k);
  const url = spriteURL(A, 'icon_' + name, 96);
  const html = url ? `<img class="spri ${cls}" src="${url}" alt="" draggable="false">` : combatSvg(name, cls);
  cache.set(k, html);
  return html;
}
