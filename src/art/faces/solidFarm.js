// Camera rotation — the farm's solid pieces (art/faces/solid.js kit; docs/LIVESTOCK.md): the feeder (alimentador), a
// 2×1 wooden trough on four short legs, empty or with feed (its state follows the shared store: chest.set).
// Numbers come from the painter (art/livestock.js FEED_GEOM): front art `feeder` / `feeder_full` 128 px wide, the
// trough x ±56 px, ground rows v 0.36..0.84, walls 8..26 px high (its top face = the opening seen from above); side art
// `feeder_e` / `feeder_full_e` (V 2: the trough's 2-tile length along v 0.125..1.875, its depth ±15 px across).
// The legs take one texel of the front leg's wood (px): the art never shows the back pair.
import { defineSolid } from './solid.js';
import { FEED_GEOM as G } from '../livestock.js';

const hx = (64 * (G.FV1 - G.FV0)) / 2; // the trough's half depth (side art px)
const legF = (x, v) => ({ box: [x - G.FLW / 2, x + G.FLW / 2, v - 0.04, v + 0.04, 0, G.FH0 + 1], px: [-G.FLX, G.FV1, G.FH0 / 2], sh: false });
const sideLeg = (x, v) => ({ box: [x - G.FLW / 2, x + G.FLW / 2, v - 0.04, v + 0.04, 0, G.FH0 + 1], px: [-hx + 2 + G.FLW / 2, G.SV1 - (G.FX - G.FLX) / 64, G.FH0 / 2], sh: false });
const vb = G.FV0 + 0.06, vf = G.FV1 - 0.06; // (legs just inside the trough's corners)
const sv0 = G.SV0 + (G.FX - G.FLX) / 64, sv1 = G.SV1 - (G.FX - G.FLX) / 64;

defineSolid('feeder', {
  parts: [
    { box: [-G.FX, G.FX, G.FV0, G.FV1, G.FH0, G.FH1] },
    legF(-G.FLX, vf), legF(G.FLX, vf), legF(-G.FLX, vb), legF(G.FLX, vb),
  ],
  views: {
    e: { V: 2, parts: [
      { box: [-hx, hx, G.SV0, G.SV1, G.FH0, G.FH1] },
      sideLeg(-hx + 4, sv1), sideLeg(hx - 4, sv1), sideLeg(-hx + 4, sv0), sideLeg(hx - 4, sv0),
    ] },
  },
  borrow: { n: 'mirror' },
  // with something in it: the art with the feed heap (every peer: the store is shared)
  state: (o) => (o.store?.slots?.some((s) => s && s.qty > 0) ? 'full' : ''),
  variants: { full: { s: 'feeder_full', e: 'feeder_full_e' } },
  blob: [2.1, 0.9, 0.55, 0.4],
});
