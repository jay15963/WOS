// UI icons. Three families:
//  - glyph(name): bold two-tone HUD glyphs (cream / accent fills inside an ink outline, one stroke weight) that read
//    on snow, at night, on grass and on the dark plates. uiIcon / svgIcon / econIcon / combatIcon prefer them.
//  - svgIcon(name) without a glyph: thin line icons (close, check, drop…) for buttons on solid plates.
//  - spriteURL / itemIcon / buildIcon: atlas sprites (items, buildings) as data URLs, item / building icons with a
//    baked ink outline so dark items keep their shape on the dark slots.
// Look of the glyphs on the HUD (halo, sizes, backplates): src/ui/hud-icons.css.

import { LAZY_DEFS } from '../art/lazyDefs.js';
import { KIT_ENV, archSprite } from '../art/archCompose.js';
import { ITEMS } from '../game/data.js';

const cache = new Map();

function spriteOf(A, name) {
  let s = A.has(name) ? A.get(name) : null;
  if (!s && LAZY_DEFS.has(name)) { KIT_ENV.sync = true; s = archSprite(A, name); KIT_ENV.sync = false; } // agent K: lazy art
  return s;
}

// Draw an atlas sprite region into a small canvas -> data URL (contain-fit, centered).
// outline > 0: ink outline of that width (px at `size`) baked around the sprite's silhouette.
export function spriteURL(A, name, size = 64, outline = 0) {
  if (!A || !A.canvas) return null;
  const k = name + '@' + size + (outline ? 'o' + outline : '');
  if (cache.has(k)) return cache.get(k);
  const s = spriteOf(A, name);
  if (!s) return null;
  const lazy = s.u0 < 0 && s.canvas;
  const S = A.size || A.canvas.width;
  const sx = lazy ? 0 : s.u0 * S, sy = lazy ? 0 : s.v0 * S, sw = lazy ? s.pw : (s.u1 - s.u0) * S, sh = lazy ? s.ph : (s.v1 - s.v0) * S;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const f = Math.min(size / sw, size / sh) * (outline ? 0.86 : 0.92);
  const w = sw * f, h = sh * f, x = (size - w) / 2, y = (size - h) / 2;
  g.imageSmoothingQuality = 'high';
  const src = lazy ? s.canvas : A.canvas;
  if (outline) {
    // silhouette in ink, stamped around the sprite (16 directions) = an even outline; then the sprite on top
    const m = document.createElement('canvas');
    m.width = m.height = size;
    const mg = m.getContext('2d');
    mg.imageSmoothingQuality = 'high';
    mg.drawImage(src, sx, sy, sw, sh, x, y, w, h);
    mg.globalCompositeOperation = 'source-in';
    mg.fillStyle = '#24160d';
    mg.fillRect(0, 0, size, size);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.drawImage(m, Math.cos(a) * outline, Math.sin(a) * outline);
    }
    g.drawImage(src, sx, sy, sw, sh, x, y, w, h);
  } else g.drawImage(src, sx, sy, sw, sh, x, y, w, h);
  const url = c.toDataURL();
  cache.set(k, url);
  return url;
}
// item / building icon: sprite with a baked ink outline (size / 40: ≈2.4 px at 96, crisp on 3× phones)
export const iconURL = (A, name, size = 64) => spriteURL(A, name, size, size / 40);

// ---------------------------------------------------------------------------------------------------------------
// Bold glyphs (24×24). Filled shapes carry an ink stroke painted under the fill (paint-order), so ~1.1 units of
// outline show outside every shape and overlapping parts stay separated. Strokes get an ink underlay.
const INK = '#24160d';
const OW = 2.2; // outline width (half of it shows)
const K = {
  cream: '#fbefd3', paper: '#f4e2b4', paper2: '#dcc086', white: '#fffaf0',
  steel: '#e1e8ed', steel2: '#9aabb7', iron: '#b9c3cb',
  wood: '#c4844a', wood2: '#8a5428', leather: '#cf8a4c', leather2: '#a3612f', leather3: '#ecb877',
  gold: '#f4c44f', coral: '#ef6450', red: '#d93b33', brick: '#d6774c',
  olive: '#9dc95a', olive2: '#5b8a28', teal: '#5ccabb', sky: '#a8dcf7',
  orange: '#f79a3e', yellow: '#ffe27a', skin: '#f2c495', meat: '#d26c3e', blue: '#5b9bd0',
  dark: '#4a2f1b',
};
const ATT = `stroke="${INK}" stroke-width="${OW}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`;
// filled shape with outline
const f = (d, c, x = '') => `<path d="${d}" fill="${c}" ${ATT}${x}/>`;
// stroke with an ink underlay (handles, arcs, speed lines)
const s = (d, c, w = 2.2, x = '') => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${(w + OW).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${x}/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${x}/>`;
// inner detail line (no outline)
const l = (d, w = 1.2, c = INK, x = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${x}/>`;
const o = (cx, cy, r, c) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" ${ATT}/>`;
const e = (cx, cy, rx, ry, a, c) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${a} ${cx} ${cy})" fill="${c}" ${ATT}/>`;
const dot = (cx, cy, r, c = INK) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
const at = (t, b) => `<g transform="${t}">${b}</g>`;
// n-point star / burst
function star(cx, cy, r, n = 4, k = 0.42, c = K.yellow) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * k : r;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(2) + ' ' + (cy + Math.sin(a) * rr).toFixed(2);
  }
  return f(d + 'Z', c);
}

// ---- parts (local coordinates: grip at 0,0, pointing up) ----
const sword = (L = 16) =>
  f(`M-1.9 -1V${-L + 2.8}L0 ${-L}L1.9 ${-L + 2.8}V-1Z`, K.steel) + l(`M0 -2.6V${-L + 3.4}`, 0.9, K.steel2) +
  f('M-1 0H1V4.2H-1Z', K.wood) + f('M-4.6 -1.8H4.6V0.6H-4.6Z', K.gold) + o(0, 5.1, 1.5, K.gold);
const knife = (L = 11) =>
  f(`M-1.7 -0.6V${-L + 4}Q-1.5 ${-L + 1} 1.9 ${-L}Q2 ${-L + 4} 1.8 -0.6Z`, K.steel) +
  f('M-1.3 0.4H1.5V6H-1.3Z', K.wood) + f('M-3 -1.2H3.2V0.8H-3Z', K.gold);
const axeHead = () =>
  s('M0 2.4V-15.6', K.wood, 2.4) +
  f('M-3.2 -17.2H1.4C5 -18.8 8.6 -17.6 9.6 -14.6C10.4 -12 10.2 -9.6 9 -7.8C7.2 -9.6 4.4 -10.6 1.4 -10.4H-3.2Z', K.steel) +
  l('M8.2 -15.4C9 -13.4 9 -11.2 8.3 -9.6', 1, K.white);
const pick = () =>
  s('M0 3V-13.6', K.wood, 2.4) +
  f('M-9.8 -10.6Q0 -20.6 9.8 -10.6Q0 -13.6 -9.8 -10.6Z', K.iron) + f('M-1.8 -16.6H1.8V-12.2H-1.8Z', K.steel2);
const hammer = (k = 1) =>
  s(`M0 ${2.6 * k}V${-12 * k}`, K.wood, 2.4) +
  f(`M${-6.2 * k} ${-17.2 * k}H${4.6 * k}Q${6.4 * k} ${-17.2 * k} ${6.4 * k} ${-15.4 * k}V${-13.4 * k}Q${6.4 * k} ${-11.6 * k} ${4.6 * k} ${-11.6 * k}H${-6.2 * k}Z`, K.iron) +
  f(`M${-6.2 * k} ${-17.2 * k}H${-3.4 * k}V${-11.6 * k}H${-6.2 * k}Z`, K.steel2);
const club = () =>
  f('M-1.3 4.6L-1.8 -5Q-4.6 -12.6 -0.2 -17.6Q4.8 -13.8 2.6 -5L1.5 4.6Z', K.wood) +
  dot(-0.6, -12.6, 0.9, K.wood2) + dot(1.4, -9, 0.8, K.wood2) + dot(-1, -7.4, 0.7, K.wood2);
const spear = (L = 20) =>
  s(`M0 3V${-L + 5}`, K.wood, 1.9) +
  f(`M0 ${-L}L2.4 ${-L + 4.4}L1.2 ${-L + 6.6}H-1.2L-2.4 ${-L + 4.4}Z`, K.steel) + f(`M-1.4 ${-L + 6.4}H1.4V${-L + 8.2}H-1.4Z`, K.gold);
const arrow = (L = 18) =>
  s(`M0 0V${-L + 3}`, K.wood, 1.5) + f(`M0 ${-L}L2.5 ${-L + 4}H-2.5Z`, K.steel) +
  f('M0 -2.6L-2.4 -0.2V2.8L0 1L2.4 2.8V-0.2Z', K.coral);
const shieldP = (c = K.blue) =>
  f('M12 2.4L19.8 5V11.2C19.8 16.2 16.4 19.8 12 21.6C7.6 19.8 4.2 16.2 4.2 11.2V5Z', c) +
  f('M10.4 4.6H13.6V19.6Q12.8 20.2 12 20.5Q11.2 20.2 10.4 19.6Z', K.gold) + f('M5.2 9.4H18.8V12.6H5.2Z', K.gold) +
  l('M6 6.3L12 4.3L18 6.3', 1, K.white, ' opacity=".6"');
const flame = (cx, cy, k = 1, c1 = K.orange, c2 = K.yellow) => at(`translate(${cx} ${cy}) scale(${k})`,
  f('M0 -10C1 -6.4 6 -5 6 0.4A6 6 0 0 1 -6 0.4C-6 -2.6 -4.6 -4.2 -3.2 -5.4C-3.2 -3 -2.2 -1.8 -1 -1.6C-1.6 -4.6 -1.6 -7.4 0 -10Z', c1) +
  `<path d="M0 -3.2C0.5 -1.4 2.6 -0.6 2.6 1.6A2.6 2.6 0 0 1 -2.6 1.6C-2.6 0.2 -1.9 -0.6 -1.2 -1.1C-1.1 -0.2 -0.6 0.3 0 0.4C-0.3 -0.9 -0.4 -2 0 -3.2Z" fill="${c2}"/>`);
const dropP = (cx, cy, r, c, hi = '#ffffff') =>
  f(`M${cx} ${cy - r * 2.1}C${cx + r * 0.5} ${cy - r * 1.1} ${cx + r} ${cy - r * 0.5} ${cx + r} ${cy + 0.2 * r}A${r} ${r} 0 0 1 ${cx - r} ${cy + 0.2 * r}C${cx - r} ${cy - r * 0.5} ${cx - r * 0.5} ${cy - r * 1.1} ${cx} ${cy - r * 2.1}Z`, c) +
  `<ellipse cx="${cx - r * 0.4}" cy="${cy}" rx="${r * 0.22}" ry="${r * 0.42}" transform="rotate(20 ${cx - r * 0.4} ${cy})" fill="${hi}" opacity=".7"/>`;
const leafP = (c = K.olive) =>
  f('M4 20.4C3.8 11.4 9.4 4.4 20.2 3.8C20.4 14 14.4 20.4 4 20.4Z', c) +
  l('M4.8 19.6C9 15 12.6 11 17.4 6.6', 1.3, K.olive2) + l('M9 15.4L8.8 11.6M12.2 12.2L12.6 8.6M12.2 12.2L15.6 12.6M9 15.4L12.4 16', 1, K.olive2);
const plus = (cx, cy, r = 3.6, c = K.cream) => {
  const t = r * 0.38;
  return f(`M${cx - t} ${cy - r}H${cx + t}V${cy - t}H${cx + r}V${cy + t}H${cx + t}V${cy + r}H${cx - t}V${cy + t}H${cx - r}V${cy - t}H${cx - t}Z`, c);
};
const lines = (pts, c = K.cream, w = 1.6) => pts.map((p) => s(p, c, w)).join('');
// open hand: palm, then the fingers, then a fill-only patch that melts the finger roots into the palm
const handP = (c = K.skin) =>
  f('M7.4 10.6H19.2V15.4Q19.2 21.4 13.2 21.4H12.4Q9 21.4 7.3 18.6L4 13.6Q3.2 12.2 4.6 11.5Q5.8 11 6.7 12.2L7.4 13.2Z', c) +
  s('M9.4 11.6V5.2', c, 2.6) + s('M12.4 11.4V3.8', c, 2.6) + s('M15.4 11.6V4.8', c, 2.6) + s('M18.2 12.2V7.2', c, 2.4) +
  `<path d="M8.4 11.2H18.4V14.6H8.4Z" fill="${c}"/>` + l('M10.9 10.4V8.6M13.9 10.4V8.6M16.8 10.6V9.4', 1, '#c98f60');
const fistP = () =>
  f('M6.4 8.6Q6.4 6.2 8.9 6.2H17.1Q19.6 6.2 19.6 8.8V14.6Q19.6 20.4 14.2 20.4H11.6Q6.4 20.4 6.4 15.4Z', K.skin) +
  l('M10.2 6.6V10.6M13.4 6.4V10.6M16.5 6.6V10.6', 1.2) +
  f('M6.7 12.4Q10.6 10.8 14.8 11.8Q16.2 12.5 15.2 13.8Q11.2 14.6 7.1 15.8Z', K.skin);
const bootP = () =>
  f('M8.6 3.2H14.4V12.2Q14.4 13.4 15.8 13.9L19.6 15.2Q21.4 15.8 21.4 17.6V19.2H6.6V13.4Z', K.leather) +
  f('M6.4 19H21.6V21.4H6.4Z', K.dark) + f('M8.4 3H14.6V5.6H8.4Z', K.leather3) + l('M9.8 8.4H13M9.6 11.2H13', 1);
const brick = (x, y, w = 7.4, h = 4.6, c = K.brick) => f(`M${x} ${y}h${w}v${h}h${-w}Z`, c) + l(`M${x + 1.2} ${y + 1.1}h${w - 2.6}`, 0.9, '#f3a882');
const ring = (cx, cy, rx, ry, c = K.coral, w = 1.8) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="${w + OW}"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-width="${w}"/>`;

const G = {
  // ---- HUD buttons ----
  bag: s('M9.2 6.2Q9.2 2.4 12 2.4Q14.8 2.4 14.8 6.2', K.wood2, 1.7) +
    f('M5 9.6Q5 5.6 9 5.6H15Q19 5.6 19 9.6V19.4Q19 21.6 16.8 21.6H7.2Q5 21.6 5 19.4Z', K.leather) +
    f('M7.8 14.6H16.2V18.6Q16.2 19.8 15 19.8H9Q7.8 19.8 7.8 18.6Z', K.leather2) +
    f('M5 9.8Q5 6.2 9 6.2H15Q19 6.2 19 9.8V11.6Q12 14.2 5 11.6Z', K.leather3) +
    f('M10.9 11.4H13.1V14.2H10.9Z', K.gold) + l('M9.6 16.8H14.4', 1),
  craft: f('M1.8 10.4C4.4 10.1 6.2 9.8 7.8 9.8H21.6V13.4H19.2C17.4 13.8 16.4 15 16.2 16.8H18L19.4 21.6H6.4L7.8 16.8H9.6C9.4 15 8.4 13.8 6.6 13.4C4.4 13 2.4 12.2 1.8 10.4Z', K.iron) +
    l('M8.4 11.2H20.6', 1, K.white) + f('M6.4 19.6H19.4V21.6H6.4Z', K.steel2) +
    star(13.6, 4.8, 3.6, 4, 0.36) + star(7.6, 5.2, 1.9, 4, 0.4) + star(19.4, 6.2, 1.7, 4, 0.4),
  build: brick(10.6, 17, 6.4, 4.4) + brick(16.6, 17, 5.6, 4.4) + brick(13.4, 12.8, 6.6, 4.2) +
    at('translate(5.2 20.8) rotate(42)', hammer(0.98)),
  map: f('M2.6 6L8.4 3.8L15.6 6L21.4 3.8V18L15.6 20.2L8.4 18L2.6 20.2Z', K.paper) +
    f('M8.4 3.8L15.6 6V20.2L8.4 18Z', K.paper2) +
    l('M5 16.4Q7.4 12.4 10.4 13.4T15.6 10.4', 1.3, K.coral, ' stroke-dasharray="1.7 1.7"') +
    s('M15.9 6.6L19.3 10M19.3 6.6L15.9 10', K.coral, 1.5),
  eat: s('M11.2 12.8L5.8 18.2', K.cream, 2.6) + o(4.6, 17, 1.9, K.cream) + o(7, 19.4, 1.9, K.cream) +
    e(14.6, 9.4, 6.9, 5.4, -45, K.meat) + `<ellipse cx="12.6" cy="7.2" rx="2.6" ry="1.2" transform="rotate(-45 12.6 7.2)" fill="#fff" opacity=".45"/>` +
    l('M16.4 12.6Q18.4 11.6 19.2 9.4', 1, '#8e3a1c'),
  heal: leafP() + plus(6.6, 6.6, 4, K.cream),
  sprint: lines(['M1.6 8.2H5.2', 'M1.2 12.4H4.8', 'M2 16.6H5']) + bootP(),
  hand: handP(),
  use: handP(),
  attack: at('translate(17.4 17.4) rotate(-45)', sword(16.4)) + at('translate(6.6 17.4) rotate(45)', sword(16.4)),
  punch: lines(['M1.4 9.4H4.4', 'M1 13.4H4', 'M1.6 17.4H4.4']) + fistP(),
  shoot: s('M8.4 2.6L4.6 12L8.4 21.4', K.cream, 0.9) + s('M8.4 2.6Q19 12 8.4 21.4', K.wood, 2.6) +
    s('M4 12H18.6', K.wood2, 1.5) + f('M17.4 9.2L22.4 12L17.4 14.8Z', K.steel) + f('M1.6 9.6L5.4 12L1.6 14.4L2.8 12Z', K.coral),
  // ---- interact verbs ----
  axe: at('translate(7.6 20.6) rotate(20)', axeHead()),
  pickaxe: at('translate(8.4 19.6) rotate(38)', pick()),
  gather: f('M3.2 11.4H20.8L18.8 20.4Q18.6 21.4 17.6 21.4H6.4Q5.4 21.4 5.2 20.4Z', K.wood) +
    l('M4.6 14.4H19.4M5.3 17.6H18.7M8.8 11.6V21M12 11.6V21.2M15.2 11.6V21', 1, K.wood2) +
    f('M12.4 10.8C11.6 6 14.4 3 19 2.8C19.2 7.4 16.6 10.6 12.4 10.8Z', K.olive) + l('M12.6 10.6L17 5.2', 1, K.olive2) +
    o(7.2, 8.6, 2.6, K.red) + o(10.8, 7.2, 2.2, K.red) + dot(6.4, 7.8, 0.7, '#fff') + dot(10.2, 6.5, 0.6, '#fff'),
  skull: f('M12 2.6C7.2 2.6 3.8 6 3.8 10.6C3.8 13.4 5.2 15.3 6.9 16.3V19.6Q6.9 21.2 8.4 21.2H15.6Q17.1 21.2 17.1 19.6V16.3C18.8 15.3 20.2 13.4 20.2 10.6C20.2 6 16.8 2.6 12 2.6Z', K.cream) +
    e(8.8, 11.2, 2.3, 2.5, 0, INK) + e(15.2, 11.2, 2.3, 2.5, 0, INK) + f('M12 13.8L13.2 16H10.8Z', INK) + l('M10.4 21V18.6M13.6 21V18.6', 1.3),
  door: f('M4.6 21.4V4.4Q4.6 2.6 6.4 2.6H17.6Q19.4 2.6 19.4 4.4V21.4Z', K.dark) +
    f('M6.6 21.4V5.2Q6.6 4.4 7.4 4.4H16.6Q17.4 4.4 17.4 5.2V21.4Z', K.wood) + l('M10 4.8V21M13.8 4.8V21', 1, K.wood2) +
    o(15.4, 13, 1.1, K.gold) + s('M2.6 21.6H21.4', K.dark, 1.4),
  door_open: f('M4.6 21.4V4.4Q4.6 2.6 6.4 2.6H17.6Q19.4 2.6 19.4 4.4V21.4Z', K.dark) +
    f('M6.6 21.4V4.4H17.4V21.4Z', '#1c110a') + f('M6.6 21.4V4.4L12.2 2.2V23Z', K.wood) + l('M9.4 3.6V22', 1, K.wood2) +
    o(10.8, 13.2, 1, K.gold) + l('M14.4 10.2l2.4-1.4M14.4 13.4h2.8M14.4 16.6l2.4 1.4', 1.4, K.yellow),
  chest: f('M3 11H21V20Q21 21.4 19.6 21.4H4.4Q3 21.4 3 20Z', K.wood) +
    f('M3 11.2V8.4Q3 4.4 12 4.4Q21 4.4 21 8.4V11.2Z', K.leather3) +
    f('M6.4 4.9V21.4H8.6V4.6ZM15.4 4.6V21.4H17.6V4.9Z', K.gold) + f('M10 9.6H14V14.4H10Z', K.gold) + dot(12, 12.2, 0.9),
  bed: f('M2.4 7.6Q2.4 5.8 4.2 5.8Q6 5.8 6 7.6V20.6H2.4Z', K.wood) + f('M5.4 12.4H21.4V18.2H5.4Z', K.cream) +
    f('M10.6 11.4H21.6V18.4H10.6Z', K.blue) + l('M10.6 14.4H21.4', 1, '#cfe6f8') + f('M6 10.6Q6 9.2 7.4 9.2H10.4Q11.4 9.2 11.4 10.4V12.6H6Z', K.white) +
    f('M2.4 18H21.6V20.6H2.4Z', K.wood2) + s('M21 20.8V21.6', K.wood2, 1.6),
  fire: flame(12, 13.4, 1.3),
  campfire: flame(12, 11.2, 1.05) + s('M4 21L20 16.6', K.wood, 2.2) + s('M4 16.6L20 21', K.wood2, 2.2),
  torch: flame(14.6, 8.6, 0.72) + s('M5 21L12.6 11.6', K.wood, 2.4) + f('M11 10.2L14.4 12.6L13 14.2L9.8 11.8Z', K.leather2),
  cold: s('M12 2.6V21.4M3.9 7.3L20.1 16.7M3.9 16.7L20.1 7.3', K.sky, 2.2) +
    s('M9.4 3.8L12 6.2L14.6 3.8M9.4 20.2L12 17.8L14.6 20.2M3.4 11.2L6.6 12.4L5.4 15.4M20.6 12.8L17.4 11.6L18.6 8.6M5.4 8.6L6.6 11.6M18.6 15.4L17.4 12.4', K.sky, 1.6),
  sick: o(12, 12, 9, '#c3d870') + e(8.6, 10, 1.3, 1.6, 0, INK) + e(15.4, 10, 1.3, 1.6, 0, INK) +
    l('M7.4 15.6Q8.8 14.2 10.2 15.6T13 15.6T15.8 15.6T17 15', 1.4) + l('M6.6 6.8L9.6 7.6M17.4 6.8L14.4 7.6', 1.2),
  poison: dropP(12, 13.2, 7.4, '#8fd43a') + o(17.6, 5.2, 1.7, '#8fd43a') + o(5.4, 7.4, 1.2, '#8fd43a') +
    e(9.6, 14.2, 1.3, 1.7, 0, INK) + e(14.4, 14.2, 1.3, 1.7, 0, INK) + l('M10.4 18H13.6', 1.3),
  bleed: dropP(8.8, 11.8, 5.6, K.red) + dropP(16.8, 16.2, 4, K.red),
  stun: ring(12, 17.4, 9, 3.2, K.yellow, 1.5) + star(12, 9.2, 6.4, 5, 0.45) + star(4.6, 15.4, 2.6, 4, 0.4) + star(19.6, 14.6, 2.6, 4, 0.4),
  block: shieldP(),
  // ---- economy / panels ----
  seed: s('M12 21.4V12.6', K.olive2, 2) + f('M12 13.4C11.6 8.6 14.6 5.4 20 5.2C20.2 10.2 16.8 13.4 12 13.4Z', K.olive) +
    f('M12 14.8C11.8 11.4 9.4 9 4.6 9C4.6 12.6 7.4 14.8 12 14.8Z', K.olive) + e(12, 20.4, 4.4, 1.8, 0, K.wood),
  equip: f('M8.6 3.2L4.4 5.2L2.4 10.6L5.6 12.2L6.8 9.8V20.6Q12 22.2 17.2 20.6V9.8L18.4 12.2L21.6 10.6L19.6 5.2L15.4 3.2Q12 6.2 8.6 3.2Z', K.iron) +
    l('M12 6.2V20.8M8.6 13.6Q12 15 15.4 13.6', 1.1, K.steel2),
  decon: brick(2.6, 16.4, 8, 4.8) + brick(11.2, 16.4, 8, 4.8) + at('translate(5.4 11.6) rotate(-16)', brick(0, 0, 8, 4.6)) +
    s('M15.2 3.4L21.2 9.4M21.2 3.4L15.2 9.4', K.coral, 2.2),
  info: o(12, 12, 9.2, K.gold) + l('M12 10.8V17', 2.6) + dot(12, 7.4, 1.6),
  queue: s('M5 7H19M5 12H19M5 17H14', K.cream, 2),
  pause: s('M9 6V18M15 6V18', K.cream, 2.6),
  play: f('M8 5L19 12L8 19Z', K.cream),
  mine: f('M10.4 21.4L12.4 15.2L17.6 12.6L21.6 16.6V21.4Z', '#9b948a') + dot(15.4, 17.2, 1.1, K.orange) + dot(18.6, 18.8, 1, K.orange) +
    at('translate(5.6 18.4) rotate(40) scale(.82)', pick()),
  trash: f('M5.8 7.6H18.2L17 20.2Q16.8 21.4 15.6 21.4H8.4Q7.2 21.4 7 20.2Z', K.iron) + l('M10 10.6V18.4M14 10.6V18.4', 1.4, K.steel2) +
    f('M3.6 5H20.4V8H3.6Z', K.steel) + f('M9.4 5V2.8H14.6V5Z', K.steel2),
  clipboard: f('M4.6 4.4H19.4V21.6H4.6Z', K.wood) + f('M6.6 6.2H17.4V19.8H6.6Z', K.paper) + f('M8.8 2.4H15.2V6.4H8.8Z', K.iron) +
    s('M8.4 10.2L9.4 11.2L11 9.4', K.olive2, 1.3) + l('M12.6 10.4H15.6M12.6 14H15.6M12.6 17.4H15.6', 1.4) +
    s('M8.4 13.8L9.4 14.8L11 13', K.olive2, 1.3) + l('M8.4 17.4H10.6', 1.4),
  // ---- abilities ----
  strike: s('M3.4 13.4Q3.6 4 13.4 3.2', K.cream, 2.2) + at('translate(7 17.6) rotate(45)', sword(16.4)),
  charge: lines(['M1.6 8.4H6.4', 'M1.2 12H5.4', 'M1.6 15.6H6.4']) + f('M7.4 8.4H13V3.6L22.4 12L13 20.4V15.6H7.4Z', K.gold) + l('M8.6 9.6H14.2V6.4L20.4 12', 1, K.white, ' opacity=".7"'),
  whirlwind: s('M4.2 13.4A8 8 0 0 1 17.4 5.8', K.cream, 2) + f('M18.8 3.4L19.4 8.6L14.4 7.4Z', K.cream) +
    s('M19.8 10.6A8 8 0 0 1 6.6 18.2', K.cream, 2) + f('M5.2 20.6L4.6 15.4L9.6 16.6Z', K.cream) + at('translate(12 17.4) scale(.78)', sword(13)),
  shove: lines(['M1.4 7.4H4.2', 'M1 12H3.8', 'M1.4 16.6H4.2']) + at('translate(25.4 0.6) rotate(90) scale(.96)', handP(K.leather)) +
    star(20.6, 4.2, 3.4, 4, 0.38) + star(20.8, 20.4, 2.4, 4, 0.4),
  stab: lines(['M3 14.4L5.6 11.8', 'M5.8 17.4L8.4 14.8']) + at('translate(6.4 17.6) rotate(45) scale(1.15)', knife(11.6)) + star(19.4, 4.6, 3.8, 4, 0.36),
  lacerate: s('M6.2 3.2Q11.6 8.4 13.2 18.4', K.coral, 2) + s('M11.4 2.4Q16.4 7 17.6 14.6', K.coral, 2) + s('M16.6 2.2Q20.2 5.4 21.2 10', K.coral, 2) +
    dropP(6.4, 18.4, 2.8, K.red) + at('translate(4.4 13.4) rotate(30) scale(.8)', knife(10)),
  cleave: s('M3 15.6Q2.4 4 14.4 2.6', K.cream, 2.2) + at('translate(6.6 21) rotate(28) scale(.9)', axeHead()),
  smash: star(16.4, 18, 5.6, 7, 0.45) + lines(['M9.8 21.6L11.2 20.4', 'M21.8 14.6L20.4 15.4']) + at('translate(4.6 13.4) rotate(-62) scale(.9)', club()),
  pierce: lines(['M2.4 15L5 12.4', 'M5.6 18.4L8.2 15.8']) + at('translate(5.4 18.6) rotate(45) scale(.9)', spear(20)) + star(19.8, 4.2, 3.2, 4, 0.36),
  sweep: s('M2.6 15.4A9.6 9.6 0 0 1 19.8 9.6', K.cream, 2.2) + f('M22.4 8L19.8 13.8L16.4 9Z', K.cream) +
    at('translate(15.6 21.6) rotate(-62) scale(.74)', spear(19)),
  aimed_shot: ring(14, 10, 7.2, 7.2, K.coral, 1.8) + s('M14 1.6V5M14 15V18.4M5.6 10H9M19 10H22.4', K.coral, 1.4) + dot(14, 10, 1.4, K.coral) +
    at('translate(4 20) rotate(45)', arrow(13)),
  multi_shot: at('translate(3.4 20.6) rotate(18)', arrow(17)) + at('translate(3.4 20.6) rotate(45)', arrow(18)) + at('translate(3.4 20.6) rotate(72)', arrow(17)),
  long_shot: ring(17.6, 20, 4.6, 1.9, K.coral, 1.6) + s('M2.6 19.4Q5.6 1 14 8.4', K.cream, 1.5, ' stroke-dasharray="2.2 2.4"') +
    at('translate(14.2 8.2) rotate(150)', arrow(11)),
  throw_spear: ring(18.2, 19.8, 4.4, 1.8, K.coral, 1.6) + s('M3.4 20Q4 6 13 4.8', K.cream, 1.4, ' stroke-dasharray="2.2 2.4"') + at('translate(9 4) rotate(130) scale(.82)', spear(19)),
  disengage: s('M19.6 19.6C19.6 10.4 14.6 6.6 7.4 7.4', K.teal, 2.6) + f('M9.6 2.6L3.2 7.6L9.8 12.4Z', K.teal) + f('M13.6 21.6Q11.6 20.6 13 18.8Q14.6 17.4 15.4 19.2Q15.8 21.2 13.6 21.6Z', K.leather) + f('M8.2 21.4Q6.2 20.4 7.6 18.6Q9.2 17.2 10 19Q10.4 21 8.2 21.4Z', K.leather),
  shield_bash: lines(['M1.2 8H4', 'M0.8 12H3.6', 'M1.2 16H4']) + at('translate(1.4 0.4) scale(.9)', shieldP()) + star(20.4, 5.4, 3.6, 4, 0.38),
  torch_swing: s('M3.4 12.8Q4.6 3.6 14.4 2.6', K.orange, 2.4) + flame(15, 9, 0.78) + s('M6.2 21.8L12.8 12.6', K.wood, 2.4) +
    f('M11.2 11.2L14.6 13.6L13.2 15.2L10 12.8Z', K.leather2),
  arrow: at('translate(5 19) rotate(45)', arrow(19)),
};
G.door_close = G.door;
G.hunger = G.eat;

export const hasGlyph = (name) => !!G[name];
export function glyph(name, cls = '') {
  const body = G[name];
  if (!body) return '';
  return `<svg class="svgi hgi ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

// thin line icons (buttons on solid plates); a glyph wins when one exists for the name
const P = {
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  unfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  install: '<path d="M12 3.5v11M7 10l5 5 5-5"/><path d="M4.5 16.5V20h15v-3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  drop: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 20h14"/>',
  wall_wood: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
};

export function svgIcon(name, cls = '') {
  if (G[name]) return glyph(name, cls);
  const body = P[name];
  if (!body) return glyph('hand', cls);
  return `<svg class="svgi ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Ability / UI icon: the bold glyph, else the atlas icon_<name>, else a line icon
export function uiIcon(A, name, cls = '') {
  if (G[name]) return glyph(name, cls);
  const url = spriteURL(A, 'icon_' + name, 96);
  if (url) return `<img class="spri ${cls}" src="${url}" alt="" draggable="false">`;
  return svgIcon(name, cls);
}

// Building icon: atlas sprite of the building itself (outlined), else a glyph / line icon
export function buildIcon(A, type) {
  const url = iconURL(A, type, 96);
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return svgIcon(type);
}

export function itemIcon(A, id) {
  const def = ITEMS[id];
  if (!def) return '';
  const url = iconURL(A, def.sprite, 96);
  if (url) return `<img class="spri" src="${url}" alt="" draggable="false">`;
  return `<span class="emo">${def.emoji}</span>`;
}
