// Graceful fallbacks while some contract sprites are not in the atlas yet (bear_*, chest, bed...).
// Returns a cached prototype-proxy of the object with a substitute sprite/species; live state is
// read through the prototype so nothing has to be synced.

const STATIC_FB = { chest: ['item_wood', 2.2], bed: ['item_leather', 2.8] };
const SPECIES_FB = { bear: 'boar' };

export function drawProxy(A, o) {
  if (o.isEntity) {
    if (o.kind === 'animal' && !A.has(o.species + '_s')) {
      let px = o._px;
      if (!px) { px = o._px = Object.create(o); px.species = SPECIES_FB[o.species] || 'wolf'; }
      return px;
    }
    return o;
  }
  if (STATIC_FB[o.type] && !A.has(o.type)) {
    let px = o._px;
    if (!px) { px = o._px = Object.create(o); px.type = STATIC_FB[o.type][0]; px.s = STATIC_FB[o.type][1]; px.f = 1; }
    return px;
  }
  return o;
}

// sprite + scale to preview a building type (ghost)
export function buildSprite(A, type) {
  if (A.has(type)) return [A.get(type), 1];
  const fb = STATIC_FB[type];
  if (fb && A.has(fb[0])) return [A.get(fb[0]), fb[1]];
  return [null, 1];
}
