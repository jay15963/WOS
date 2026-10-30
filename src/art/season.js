// Seasons for the art modules (cosmetic, per client). src/fx/seasonfx.js copies the smooth weights of
// game.season (src/game/seasons.js) here every frame; art code only reads them (summer = all zero = today's look).
//   SEASON = { snow, ice, autumn, bloom, bare, winter, wane }   wane: 1 on the way to winter, 0 in the spring half
// SC: the sprite "season class" (16th argument of batch.add) — how the sprite shader treats a sprite:
//   OAK / BIRCH / WILLOW  broadleaf crowns: autumn colours (oak-like mix, golden, yellow-green), leaves dropping
//                         into winter (a bare twin is drawn under them), spring green + blossoms (some oaks)
//   BARE     the bare twin (snow on the branches)      CONIFER  stays green, darker in the cold, snow-laden
//   SHRUB    red / orange autumn, dry + snowy in winter, blossoms in spring
//   GRASS    golden in autumn, dry and frosted in winter, fresh in spring      FLOWER  a little snow
//   SNOW     snow on the top edges only (rocks, stumps, dead trees, crops)
//   + NOTWIN on a broadleaf crown whose bare twin is not painted yet (keeps its trunk while the leaves drop)

import { lookAtlasOf, LOOK_CLOCK } from './look/lazy.js';

export const SEASON = { snow: 0, ice: 0, autumn: 0, bloom: 0, bare: 0, winter: 0, wane: 0 };
export const SC = { OAK: 1, BIRCH: 2, WILLOW: 3, BARE: 4, CONIFER: 5, SHRUB: 6, GRASS: 7, FLOWER: 8, SNOW: 9, NOTWIN: 16 };

// tree art group → class (groups with a lazily painted bare twin: art/trees.js `<group>_bare_<n>`)
export const TREE_SC = {
  tree_oak: SC.OAK, tree_maple: SC.OAK, tree_willow: SC.WILLOW, tree_birch: SC.BIRCH, tree_aspen: SC.BIRCH,
  tree_pine: SC.CONIFER, tree_scots: SC.CONIFER, tree_juniper: SC.CONIFER, tree_dead: SC.SNOW, tree_snag: SC.SNOW,
};

// the bare twin of a tree sprite (lazy record once painted, else null; asking for it queues the painting)
const BARE = new WeakMap(); // atlas → Map(sprite name → record | false)
export function bareTwin(A, s, grp) {
  let M = BARE.get(A);
  if (!M) BARE.set(A, (M = new Map()));
  let r = M.get(s.name);
  if (r === undefined) {
    const LA = lookAtlasOf(A);
    const name = grp + '_bare_' + s.name.slice(grp.length + 1);
    r = LA.has(name) ? LA.get(name) : false;
    M.set(s.name, r);
  }
  if (!r || r.failed) return null;
  if (r.ready) { r.lu = LOOK_CLOCK.f; return r; }
  lookAtlasOf(A).want(r);
  return null;
}

// the plant's own hash, added to its class (sc + h): the sprite shader and the petals agree on who blossoms
export const seasonHash = (o) => o._sh ?? (o._sh = 0.001 + 0.997 * hash01(o.x, o.y));

// stable 0..1 hash of a decor / object position (per-plant choices: which tufts hide under the snow…)
export const hash01 = (x, y) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };
