// Player look (appearance) schema — agent H. One flat, versioned object; colours are 6-hex strings.
//   look = { v: 1, build, height, skin, head, ears, eyes, eyeC, brows, nose, mouth, cheeks, age, marks, scar,
//            paint, paintC, hair, hairC, hairFx, hairC2, beard, beardC ('' = hair colour), top, topC, topC2,
//            pattern, over, overC, bottom, botC, shoes, shoeC }
// Ids come from the catalogue (src/art/look/catalog.js). cleanLook() accepts anything (objects from saves or
// peers, packed wire strings, the legacy { skin:[r,g,b], hair, hairColor, shirt, pants?, beard? }) and always
// returns a valid look: unknown ids → default, colours clamped / parsed.
// Wire: packLook(look) → "1|average|…" (~200 chars). Persisted per player profile in localStorage (wos.look).

import { CATALOG, PALETTES, entry } from '../art/look/catalog.js';

export const LOOK_V = 1;
const KEY = 'wos.look';

// [field, catalogue | 'c' (colour) | 'c?' (optional colour, '' = follow another), default]
export const FIELDS = [
  ['build', 'build', 'average'], ['height', 'height', 'normal'], ['skin', 'c', 'dcae84'],
  ['head', 'head', 'round'], ['ears', 'ears', 'medium'], ['eyes', 'eyes', 'almond'], ['eyeC', 'c', '6b4024'],
  ['brows', 'brows', 'soft'], ['nose', 'nose', 'button'], ['mouth', 'mouth', 'neutral'], ['cheeks', 'cheeks', 'none'],
  ['age', 'age', 'none'], ['marks', 'marks', 'none'], ['scar', 'scar', 'none'], ['paint', 'paint', 'none'], ['paintC', 'c', 'b0402c'],
  ['hair', 'hair', 'short'], ['hairC', 'c', '4e3424'], ['hairFx', 'hairFx', 'none'], ['hairC2', 'c', 'd2b47c'],
  ['beard', 'beard', 'none'], ['beardC', 'c?', ''],
  ['top', 'top', 'tee'], ['topC', 'c', '3e64a0'], ['topC2', 'c', 'e6dcc4'], ['pattern', 'pattern', 'plain'],
  ['over', 'over', 'none'], ['overC', 'c', '5e3e28'], ['bottom', 'bottom', 'trousers'], ['botC', 'c', '6e4c32'],
  ['shoes', 'shoes', 'boots'], ['shoeC', 'c', '3c2a1e'],
];
export const DEFAULT_LOOK = Object.freeze(Object.fromEntries([['v', LOOK_V], ...FIELDS.map(([k, , d]) => [k, d])]));

// ---------------- colours ----------------
const HEX = /^[0-9a-f]{6}$/;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function hexOf(c) {
  if (typeof c === 'string') { const s = c.replace(/^#/, '').toLowerCase(); return HEX.test(s) ? s : null; }
  if (Array.isArray(c) && c.length >= 3 && c.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return c.slice(0, 3).map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')).join('');
  }
  return null;
}
export function rgbOf(hex) {
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---------------- validation ----------------
function cleanObj(l) {
  const out = { v: LOOK_V };
  for (const [k, cat, d] of FIELDS) {
    const v = l[k];
    if (cat === 'c') out[k] = hexOf(v) || d;
    else if (cat === 'c?') out[k] = v === '' || v == null ? '' : hexOf(v) || '';
    else out[k] = typeof v === 'string' && entry(cat, v) ? v : d;
  }
  return out;
}
// old saves / bandits: { skin:[r,g,b], hair, hairColor, shirt, pants?, beard? }
export function migrateLook(l) {
  const o = { ...DEFAULT_LOOK };
  const skin = hexOf(l.skin); if (skin) o.skin = skin;
  if (typeof l.hair === 'string') o.hair = l.hair === 'bald' ? 'bald' : entry('hair', l.hair) ? l.hair : 'short';
  const hc = hexOf(l.hairColor); if (hc) o.hairC = hc;
  const sh = hexOf(l.shirt); if (sh) o.topC = sh;
  const pa = hexOf(l.pants); if (pa) o.botC = pa;
  if (l.beard) o.beard = 'full';
  if (l.face === 'scar') o.scar = 'eye';
  return o;
}
export function unpackLook(s) {
  const parts = String(s).slice(0, 600).split('|');
  if (parseInt(parts[0], 10) !== LOOK_V) return null;
  const o = {};
  FIELDS.forEach(([k], i) => { if (parts[i + 1] != null) o[k] = parts[i + 1]; });
  return o;
}
export function packLook(look) {
  const l = cleanLook(look);
  return [LOOK_V, ...FIELDS.map(([k]) => l[k])].join('|');
}
// any input → a valid look (never throws, never returns null)
export function cleanLook(l) {
  if (typeof l === 'string') l = unpackLook(l);
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { ...DEFAULT_LOOK };
  if (l.v == null && (Array.isArray(l.skin) || 'hairColor' in l || 'shirt' in l)) return cleanObj(migrateLook(l));
  return cleanObj(l);
}
export const sameLook = (a, b) => packLook(a) === packLook(b);

// ---------------- random ----------------
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickE = (r, list) => list[Math.floor(r() * list.length) % list.length];
const pickW = (r, list, w) => { let s = 0; for (const x of list) s += w(x); let u = r() * s; for (const x of list) { u -= w(x); if (u <= 0) return x; } return list[0]; };
// rarer things show up less often in random looks
const RW = { common: 6, uncommon: 3, rare: 1.6, epic: 0.8, legendary: 0.4 };
const wr = (e) => RW[e.rarity] || 1;
function jitter(hex, r, k = 0.05) {
  return hexOf(rgbOf(hex).map((v) => v * (1 + (r() - 0.5) * 2 * k)));
}
// field groups for "randomise one category" (UI)
export const GROUPS = {
  body: ['build', 'height', 'skin'],
  face: ['head', 'ears', 'eyes', 'eyeC', 'brows', 'nose', 'mouth'],
  marks: ['cheeks', 'age', 'marks', 'scar', 'paint', 'paintC'],
  hair: ['hair', 'hairC', 'hairFx', 'hairC2'],
  beard: ['beard', 'beardC'],
  clothes: ['top', 'topC', 'topC2', 'pattern', 'over', 'overC', 'bottom', 'botC', 'shoes', 'shoeC'],
};
// a coherent random look; `only` = list of fields to re-roll (others kept from `base`)
export function randomLook(seed = 1, base = null, only = null) {
  const r = mulberry((seed * 2654435761) >>> 0);
  const o = {};
  const nat = (x) => x.rarity === 'common';
  o.build = pickW(r, CATALOG.build, (e) => (e.id === 'average' ? 3 : 1.4)).id;
  o.height = pickW(r, CATALOG.height, (e) => (e.id === 'normal' ? 3 : 1.4)).id;
  o.skin = jitter(pickE(r, PALETTES.skin.filter(nat)).hex, r, 0.03);
  for (const k of ['head', 'ears', 'eyes', 'brows', 'nose', 'mouth']) o[k] = pickW(r, CATALOG[k].filter((e) => e.id !== 'none'), wr).id;
  o.eyeC = pickW(r, PALETTES.eyes, wr).hex;
  o.cheeks = r() < 0.55 ? 'none' : pickW(r, CATALOG.cheeks, wr).id;
  o.age = r() < 0.7 ? 'none' : pickW(r, CATALOG.age, wr).id;
  o.marks = r() < 0.65 ? 'none' : pickW(r, CATALOG.marks, wr).id;
  o.scar = r() < 0.8 ? 'none' : pickW(r, CATALOG.scar, wr).id;
  o.paint = r() < 0.85 ? 'none' : pickW(r, CATALOG.paint, wr).id;
  o.paintC = pickW(r, PALETTES.paint, wr).hex;
  o.hair = pickW(r, CATALOG.hair, (e) => wr(e) * (e.id === 'bald' ? 0.4 : 1)).id;
  const dyed = r() < 0.14;
  o.hairC = dyed ? pickW(r, PALETTES.dye, wr).hex : jitter(pickE(r, PALETTES.hair).hex, r, 0.04);
  o.hairFx = r() < 0.82 ? 'none' : pickW(r, CATALOG.hairFx.slice(1), wr).id;
  o.hairC2 = r() < 0.5 ? pickE(r, PALETTES.hair).hex : pickW(r, PALETTES.dye, wr).hex;
  o.beard = r() < 0.58 ? 'none' : pickW(r, CATALOG.beard.slice(1), wr).id;
  o.beardC = r() < 0.85 ? '' : pickE(r, PALETTES.hair).hex;
  o.top = pickW(r, CATALOG.top, wr).id;
  const cloth = PALETTES.cloth;
  o.topC = pickW(r, cloth, wr).hex;
  o.topC2 = r() < 0.5 ? pickE(r, cloth.slice(0, 4)).hex : pickW(r, cloth, wr).hex;
  o.pattern = r() < 0.7 ? 'plain' : pickW(r, CATALOG.pattern.slice(1), wr).id;
  o.over = r() < 0.65 ? 'none' : pickW(r, CATALOG.over.slice(1), wr).id;
  o.overC = r() < 0.6 ? pickE(r, PALETTES.leather).hex : pickW(r, cloth, wr).hex;
  o.bottom = pickW(r, CATALOG.bottom, wr).id;
  o.botC = pickE(r, [...cloth.slice(3, 14), ...PALETTES.leather.slice(0, 4)]).hex;
  o.shoes = pickW(r, CATALOG.shoes, (e) => wr(e) * (e.id === 'barefoot' ? 0.4 : 1)).id;
  o.shoeC = pickE(r, PALETTES.leather).hex;
  if (!base || !only) return cleanLook(o);
  const out = cleanLook(base);
  for (const k of only) if (k in o) out[k] = o[k];
  return cleanLook(out);
}

// ---------------- persistence (per player profile, not per world) ----------------
export function loadLook() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return cleanLook(JSON.parse(raw));
  } catch { /* corrupt or blocked storage */ }
  return { ...DEFAULT_LOOK };
}
export function saveLook(look) {
  const l = cleanLook(look);
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignore */ }
  return l;
}
export const hasSavedLook = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
// live change in a running game: local player + persistence + tell the others now
export function applyLook(game, look) {
  const l = game?.noSave ? cleanLook(look) : saveLook(look);
  if (game?.player) game.player.look = l;
  game?.session?.sendLook?.();
  return l;
}
