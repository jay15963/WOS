// Graceful fallbacks while some contract sprites are not in the atlas yet (bear_*, chest, bed, new
// structures / stations / natural objects / crops...). Returns a cached prototype-proxy of the object
// with a substitute sprite/species; live state is read through the prototype so nothing has to be synced.
// A fallback is only used when the atlas has no art at all for the type (type, type_0, type_<mask>, type_h).
// Every fallback is LOUD (artWarn: netlog error once per name + a dev tag over the entity): in a validated
// atlas (game/artcheck.js) none of them can trigger — a creature drawn as another species is a bug.

import { netlog } from '../net/netlog.js';
import { artHooks } from '../art/compose.js';

export const DEV = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
const warned = new Set();
export const artWarnings = () => [...warned];
export function artWarn(name, what = 'substituto') {
  if (warned.has(name)) return;
  warned.add(name);
  netlog.error('art', `Sprite ausente no atlas: ${name} — desenhado com ${what}`);
}
artHooks.warn = (name) => artWarn(name, 'outro sprite');

const STATIC_FB = {
  chest: ['item_wood', 2.2], bed: ['item_leather', 2.8],
  // structures / stations / furniture / lights
  wall_stone: ['boulder', 1.3], door_wood: ['wall_wood', 0.8], fence_wood: ['item_wood', 1.5], gate_wood: ['item_wood', 1.9],
  workbench: ['chest', 2.0], stonecutter: ['boulder', 1.1], furnace: ['boulder', 1.25], anvil: ['boulder', 0.7], loom: ['bed', 1.6],
  cooking_pot: ['campfire', 0.85], table_wood: ['chest', 1.8], chair_wood: ['item_wood', 1.3], flower_pot: ['flower_1', 1.6],
  banner: ['torch', 1.3], brazier: ['campfire', 1.1], lamp_post: ['torch', 1.5],
  // natural objects
  pebble: ['boulder', 0.26], stick: ['item_wood', 0.75], fibergrass: ['tallgrass_0', 1.25],
  wild_potato: ['bush', 0.55], wild_cotton: ['bush', 0.55], wild_corn: ['tallgrass_2', 1.6],
  tent_0: ['bed', 2.2], tent_1: ['bed', 2.2], crate_0: ['chest', 1.6],
};
const SPECIES_FB = { bear: 'boar', fox: 'wolf', spider: 'wolf' };
const SCALE_FB = { fox: 0.72, spider: 0.6 }; // stand-ins read smaller than the real wolf
const CROP_FB = [['grass_1', 0.7], ['grass_3', 1.0], ['tallgrass_1', 1.2], ['bush', 0.6]];

const hasArt = (A, o) => A.has(o.type) || A.has(o.type + '_0') || A.has(o.type + '_h') || (o.mask != null && A.has(o.type + '_' + o.mask)) || !!A.groups?.[o.type];

export function drawProxy(A, o) {
  if (o.isEntity) {
    if (o.kind === 'animal' && !A.has(o.species + '_s')) {
      let px = o._px;
      if (!px) {
        px = o._px = Object.create(o); px.species = SPECIES_FB[o.species] || 'wolf';
        if (SCALE_FB[o.species]) px.scale = (o.scale || 1) * SCALE_FB[o.species];
        o._artFallback = o.species + '_s';
        artWarn(o.species + '_s', 'a arte de ' + px.species);
      }
      return px;
    }
    return o;
  }
  if (o.type === 'crop') {
    if (A.has(`crop_${o.kind}_${o.stage}`) || A.has(`crop_${o.kind}_0`)) return o;
    artWarn(`crop_${o.kind}_0`);
    const [t, s] = CROP_FB[o.stage | 0] || CROP_FB[0];
    let px = o._px;
    if (!px || px._st !== o.stage) { px = o._px = Object.create(o); px._st = o.stage; px.type = A.has(t) || A.groups?.[t] ? t : 'bush'; px.s = s; }
    return px;
  }
  const fb = STATIC_FB[o.type];
  if (fb && !hasArt(A, o)) {
    let px = o._px;
    if (!px) {
      px = o._px = Object.create(o);
      const t = A.has(fb[0]) || A.groups?.[fb[0]] ? fb[0] : 'item_wood';
      px.type = t; px.s = fb[1] * (o.s || 1); px.f = o.f || 1;
      if (t === 'campfire' || t === 'torch') px.lit = false; // sync-ok: art proxy object (cosmetic copy, never the shared object)
      artWarn(o.type);
    }
    if (o.type === 'furnace' || o.type === 'cooking_pot' || o.type === 'brazier' || o.type === 'lamp_post') px.lit = o.type === 'brazier' || o.type === 'lamp_post' ? !o.blueprint : !!o.working; // sync-ok: art proxy object
    return px;
  }
  return o;
}

// sprite + scale to preview a building type (ghost)
export function buildSprite(A, type) {
  if (A.has(type)) return [A.get(type), 1];
  for (const n of [type + '_0', type + '_h', type + '_10']) if (A.has(n)) return [A.get(n), 1];
  const fb = STATIC_FB[type];
  if (fb && A.has(fb[0])) return [A.get(fb[0]), fb[1]];
  if (fb && A.groups?.[fb[0]]) return [A.pick(fb[0], 0), fb[1]];
  return [null, 1];
}
