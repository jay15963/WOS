// Camera rotation — the solid pieces of the garden and the outdoors (art/faces/solid.js: format, units and rules at the
// top of that file): benches, planter, woodpile, cart, drying rack, fountain, well, statue, totem, beehive, haystack,
// scarecrow, notice board, signpost, garden arch, birdhouse, pergola, flower bed, training dummy, columns.
// Numbers are read off the painters (art/decor.js, art/roofs.js): x px from the art's centre column, v = ground row in
// tiles (anchor row V), h px above the ground. Every model has its true depth at every angle; old art that draws round
// things squashed (ellipses) maps its texture with k, and piv puts the true centre where it belongs (piv = (d_art −
// k·d_true) / (1 − k), d = v − V). A part moved in depth keeps its art by moving its heights with it (64 px per tile).
// Surfaces the art never shows (roof slopes, a stump's top) are filled with one texel of the art (px).
import { defineSolid as define } from './solid.js';
import { CAMV, ARCH_FACES as K, archSprite } from '../archCompose.js';
import { tintOf } from './props.js';
import { bq } from './kit.js';

// ---------- little helpers ----------
// (ramp: false — the true depth at every angle, 0° included: never squashed back to the old art)
const defineSolid = (type, spec) => define(type, { ramp: false, ...spec });
const box = (x0, x1, v0, v1, h0, h1, o) => ({ box: [x0, x1, v0, v1, h0, h1], ...o });
const card = (x0, x1, v, h0, h1, o) => ({ card: [x0, x1, v, h0, h1], ...o });
const lathe = (x, v, pr, o) => ({ lathe: [x, v, pr], ...o });
const quad = (q, o) => ({ quad: q, ...o });
const NS = { sh: false };
// no faces of its own, only the sun shadow of the whole art (its silhouette across the sun) standing at ground row v
const SHADOW = (v, h) => lathe(0, v, [[0, 0.01], [h, 0.01]], { n: 3, px: [1e4, 0, 0] }); // (a texel off the image: no faces)
const pivOf = (vArt, V, k, vTrue) => ((vArt - V) - k * (vTrue - V)) / (1 - k); // the piv that puts art row vArt at vTrue

// ---------- benches (decor.js benchWood / benchStone; 2×1, rotating) ----------
// wooden bench: one see-through box (legs and the stretcher come from the art); the _e view has its own numbers
defineSolid('bench_wood', {
  parts: [box(-58, 58, 0.32, 0.72, 0, 16, { open: true })],
  views: { e: { V: 2, parts: [box(-12, 12, 0.12, 1.88, 0, 16, { open: true })] } },
});
// stone bench: the slab on two blocks (the _e view draws the blocks at v 0.35 / 1.65: the left one is the far end)
defineSolid('bench_stone', {
  parts: [box(-58, 58, 0.32, 0.7, 10, 16), box(-48, -30, 0.38, 0.7, 0, 10), box(30, 48, 0.38, 0.7, 0, 10)],
  views: { e: { V: 2, parts: [box(-14, 14, 0.1, 1.9, 9, 15), box(-10, 10, 1.37, 1.65, 0, 9), box(-10, 10, 0.35, 0.63, 0, 9)] } },
});

// ---------- planter (decor.js planter): the box, and the flowers as a low mass of foliage on its soil ----------
defineSolid('planter', {
  parts: [box(-56, 56, 0.4, 0.8, 0, 16), box(-53, 53, 0.43, 0.77, 16, 22, NS)],
  views: { e: { V: 2, parts: [box(-14, 14, 0.15, 1.85, 0, 16), box(-11, 11, 0.2, 1.8, 16, 22, NS)] } },
});

// ---------- woodpile (decor.js woodpile): the stack, a chopping stump with the axe handle ----------
defineSolid('woodpile', {
  parts: [
    box(-58, 58, 0.45, 0.75, 0, 31),
    lathe(41, 0.9, [[0, 7], [10, 7]], { n: 8, px: [41, 0.9, 5], sh: false }), // (the stump: its bark colour)
    lathe(41, 0.9, [[10, 6.2], [10.6, 6.2]], { n: 8, px: [41, 0.9, 10], sh: false }), // (its cut top)
    box(43, 45.4, 0.88, 0.92, 10, 28, { px: [37.7, 0.9, 18.9], sh: false }), // (the axe handle)
  ],
  // the _e view has no stump: the stump stands beside the stack (log end colours of that art)
  views: { e: { V: 2, parts: [
    box(-16, 16, 0.15, 1.85, 0, 28),
    lathe(23, 0.45, [[0, 7], [10, 7]], { n: 8, px: [-8.2, 1.85, 5], sh: false }),
    lathe(23, 0.45, [[10, 6.2], [10.6, 6.2]], { n: 8, px: [-12, 1.85, 5], sh: false }),
    box(21.8, 24.2, 0.43, 0.47, 10, 28, { px: [0, 1, 28], sh: false }),
  ] } },
});

// ---------- cart (decor.js cart): bed, load of sacks, stakes, wheels on both sides, the shafts ----------
// the back wheels take the front wheels' art seen from behind (views.n: the front art mirrored, listed there)
const CART = (wf, wb) => [
  box(-54, 34, 0.3, 0.7, 12, 26), box(-46, 26, 0.38, 0.62, 26, 38, NS), card(-54, 34, 0.3, 26, 35, { t: 2, sh: false }),
  card(-42, -18, wf, -1, 23, NS), card(-2, 22, wf, -1, 23, NS), card(-42, -18, wb, -1, 23, NS), card(-2, 22, wb, -1, 23, NS),
  quad([[30, 0.34, 15], [64, 0.44, 7], [64, 0.81, 4], [30, 0.66, 15]], NS),
];
defineSolid('cart', {
  parts: CART(0.72, 0.28),
  views: {
    n: { parts: CART(0.28, 0.72) },
    // _e: bed seen from its end, the wheels edge-on at both sides, the shafts coming toward the camera
    e: { V: 2, parts: [
      box(-18, 18, 0.25, 1.6, 12, 26), box(-14, 14, 0.4, 1.45, 26, 38, NS), box(-20, -16, 0.25, 1.6, 26, 35, NS),
      box(17, 21, 1.0, 1.4, -1, 23, NS), box(17, 21, 0.45, 0.85, -1, 23, NS), box(-21, -17, 1.0, 1.4, -1, 23, NS), box(-21, -17, 0.45, 0.85, -1, 23, NS),
      quad([[-6, 1.6, 13], [6, 1.6, 13], [6, 1.98, 4], [-6, 1.98, 4]], NS),
    ] },
  },
});

// ---------- drying rack (decor.js dryingRack): two A-frames, the pole, hides and herbs hanging from it ----------
defineSolid('drying_rack', {
  parts: [
    box(-60, -44, 0.45, 0.75, 0, 48, { open: true, sh: false }), box(44, 60, 0.45, 0.75, 0, 48, { open: true, sh: false }),
    box(-54, 54, 0.57, 0.63, 44.4, 48, NS),
    card(-42, -16, 0.6, 16, 46, { t: 2, sh: false }), card(-10, 12, 0.6, 20, 46, { t: 2, sh: false }), card(21, 41, 0.6, 21, 45, { t: 2, sh: false }),
    SHADOW(0.6, 48),
  ],
  // _e: the A-frames face-on at v 0.2 / 1.8, the pole end-on, the hides edge-on
  views: { e: { V: 2, parts: [
    box(-11, 11, 1.74, 1.86, 0, 46, { open: true, sh: false }), box(-11, 11, 0.14, 0.26, 0, 46, { open: true, sh: false }),
    box(-2, 2, 0.2, 1.8, 42, 46, NS),
    box(-5, 5, 0.9, 1.4, 18, 44, NS), box(-5, 5, 0.42, 0.8, 20, 44, NS), box(-4, 4, 0.22, 0.4, 21, 44, NS),
    SHADOW(1, 46),
  ] } },
});

// ---------- fountain (decor.js fountain, 2×2): basin, water, pedestal, bowl, spout; the spray and ripples ----------
// the art draws the basin as an ellipse 56 × 36 about row 1.45: k = 36 / 56, the true centre in the middle of the 2×2
const FK = 36 / 56;
defineSolid('fountain', {
  V: 2, k: FK, piv: pivOf(1.45, 2, FK, 1),
  parts: [
    lathe(0, 1.45, [[0, 56], [14, 56]]),
    lathe(0, 1.45, [[14, 49], [14.6, 49]], { n: 10, px: [-30, 1.45, 14], sh: false }), // (the water)
    lathe(0, 1.45, [[13, 6], [46, 6]], { n: 8, sh: false, z: 0.01 }),
    lathe(0, 1.45, [[44, 13], [46, 20], [50, 20]], { n: 10, px: [-10, 1.45, 47], sh: false, z: 0.02 }), // (the bowl's stone)
    lathe(0, 1.45, [[50, 16], [50.6, 16]], { n: 10, px: [-10, 1.45, 50], sh: false, z: 0.03 }), // (its water)
    lathe(0, 1.45, [[50, 2.4], [60, 2.4], [61, 3.4], [66.4, 1.6]], { n: 6, sh: false, z: 0.04 }),
  ],
  blob: [1.9, 1.9, 1, 0.42],
  fx: [{ at: [0, 1.45, 0], draw: fountainFx }],
});
// drops thrown from the bowl falling back into the basin, a ripple ring on the water (world space; as archCompose)
const RUV = [0, 0, 0, 0];
function fountainFx(B, A, o, t, x, y, lift, a) {
  const T = K.tables(A);
  if (T.drop && B.fx) for (let i = 0; i < 6; i++) {
    const u = (t * 0.9 + i / 6) % 1, an = (i / 6) * Math.PI * 2 + 0.4, r = 0.12 + u * 0.32;
    B.fx.add(T.drop, x + Math.cos(an) * r, y + Math.sin(an) * r, 0.12, 0.16, 0.8, 0.92, 1, 0.75 * (1 - u * 0.6) * a, 0, 0, 0, 1, 0, lift + 0.8 + Math.sin(u * Math.PI) * 0.2 - u * 0.56);
  }
  const s = T.ring;
  if (s && K.ok(s) && B.faces) {
    const u = (t * 0.5) % 1, d = (0.35 + u * 1.15) / 2, h = lift + 14.8 / 64;
    RUV[0] = s.u0; RUV[1] = s.v0; RUV[2] = s.u1; RUV[3] = s.v1;
    B.faces.quad(x - d, y - d, h, x + d, y - d, h, x + d, y + d, h, x - d, y + d, h, RUV, 0.85, 0.95, 1, 0.35 * (1 - u) * a);
  }
}

// ---------- well (decor.js well): stone ring, posts, axle with crank, rope and bucket, a little gable roof ----------
// ring ellipse 27 × 9 (k = 1 / 3) centred in the tile; posts / axle / bucket / roof stand on the ring's centre line
// (art row 0.5 → 0.62: their heights + 7.7 px keep their art), the roof slopes in the roof's colour
const WK = 1 / 3, WV = 0.62, WU = 7.7, WD = 4 / 64;
const WROOF = (s) => [
  box(-33, 33, WV - WD, WV + WD, 59 + WU, 82 + WU, NS),
  quad([[-33, WV - WD, 59 + WU], [0, WV - WD, 82 + WU], [0, WV + WD, 82 + WU], [-33, WV + WD, 59 + WU]], { px: [-16 * s, 0.5, 69], sh: false }),
  quad([[0, WV - WD, 82 + WU], [33, WV - WD, 59 + WU], [33, WV + WD, 59 + WU], [0, WV + WD, 82 + WU]], { px: [16 * s, 0.5, 69], sh: false }),
];
defineSolid('well', {
  k: WK, piv: pivOf(WV, 1, WK, 0.5),
  parts: [
    lathe(0, WV, [[0, 27], [20, 27]]),
    lathe(0, WV, [[18.6, 20], [19.2, 20]], { px: [12, WV, 20], sh: false, z: 0.01 }), // (the dark water)
    box(-24.2, -19.8, WV - 0.012, WV + 0.012, 10 + WU, 66 + WU, NS), box(19.8, 24.2, WV - 0.012, WV + 0.012, 10 + WU, 66 + WU, NS),
    box(-22, 30, WV - 0.02, WV + 0.02, 42 + WU, 50 + WU, NS),
    card(-5, 9, WV, 24 + WU, 48 + WU, { t: 2, sh: false }),
    ...WROOF(1),
  ],
  blob: [1, 1, 0.5, 0.45],
});

// ---------- statue (decor.js statue_0 / _1): base slab, column, cap, the figure (warrior or owl) ----------
// the art draws the square pedestal's tops 5–6 px deep for 28–34 px: k ≈ 0.18, centred in the tile; the figure is a
// round body wrapped in its art (front half the front, back half the front mirrored)
const SK = 6 / 34;
defineSolid('statue', {
  k: SK, piv: pivOf(0.613, 1, SK, 0.5),
  parts: [box(-17, 17, 0.566, 0.66, 0, 8, NS), box(-12, 12, 0.579, 0.647, 8, 34, NS), box(-14, 14, 0.574, 0.652, 33, 38, NS), lathe(0, 0.613, [[38, 15], [93, 15]], { n: 10 })],
  blob: [0.75, 0.75, 0.5, 0.4],
});

// ---------- totem (decor.js totem): the carved log with its cone top, the two wings ----------
const TK = 0.44;
defineSolid('totem', {
  k: TK, piv: pivOf(0.62, 1, TK, 0.5),
  parts: [lathe(0, 0.62, [[0, 10], [84, 10], [92.5, 0.6]], { n: 10 }), card(-25, -9, 0.62, 56, 71, { t: 3, sh: false }), card(9, 25, 0.62, 56, 71, { t: 3, sh: false })],
  blob: [0.5, 0.5, 0.5, 0.4],
});

// ---------- beehive (decor.js beehive; an edge piece): the stand, the straw skep; bees around it ----------
const BK = 5 / 28;
defineSolid('beehive', {
  foot: true, k: BK, piv: pivOf(0.581, 1, BK, 0.47),
  parts: [box(-15, 15, 0.542, 0.62, 0, 15, { open: true }), lathe(0, 0.581, [[13, 14.5], [24, 13.6], [32, 10.6], [37, 6.5], [40, 1.5]], { n: 10 })],
  blob: [0.55, 0.45, 0.19, 0.45],
  fx: [{ at: [0, 0.581, 0], draw: bees }],
});
function bees(B, A, o, t, x, y, lift, a) {
  const T = K.tables(A);
  if (T.blob && B.fx) for (let i = 0; i < 3; i++) {
    const an = t * (1.6 + i * 0.4) + i * 2.1;
    B.fx.add(T.blob, x + Math.cos(an) * 0.32, y + Math.sin(an * 1.3) * 0.26, 0.05, 0.05, 0.15, 0.12, 0.05, 0.85 * a, 0, 0, 0, 1, 0, lift + 0.4 + Math.sin(an * 2) * 0.1);
  }
}

// ---------- haystack (decor.js haystack): a round mound, the pitchfork's tines sticking out of it ----------
const HK = 0.3;
defineSolid('haystack', {
  k: HK, piv: pivOf(0.66, 1, HK, 0.5),
  parts: [lathe(0, 0.66, [[0, 27], [14, 25.5], [26, 20.5], [35, 13], [42, 1]], { n: 10 }), card(8, 17, 0.66, 38, 56, { t: 2, sh: false })],
  blob: [1, 1, 0.5, 0.42],
});

// ---------- scarecrow (decor.js scarecrow): pole, shirt on its crossbar, head, straw hat; it sways in the wind ----------
const CK = 4 / 14;
defineSolid('scarecrow', {
  k: CK, piv: pivOf(0.62, 1, CK, 0.5),
  parts: [
    lathe(0, 0.62, [[0, 2.2], [66, 2.2]], { n: 6, tilt: true }), // (casts the art's silhouette)
    card(-29, 29, 0.62, 14, 53, { t: 4, sh: false, tilt: true }),
    lathe(0, 0.62, [[50.4, 5.5], [54, 7.2], [61, 7.2], [64, 5]], { n: 8, sh: false, tilt: true }),
    lathe(0, 0.62, [[61.8, 14], [64.2, 14]], { n: 10, sh: false, tilt: true, z: 0.01 }),
    lathe(0, 0.62, [[64.2, 7], [70, 6.5], [73, 4]], { n: 8, sh: false, tilt: true, z: 0.02 }),
  ],
  tilt: (o, t) => Math.sin(t * 1.9 + (o.tx | 0) * 0.7) * 0.022, tiltAt: [0, 0.62, 0],
  blob: [0.4, 0.4, 0.5, 0.4],
});

// ---------- birdhouse (decor.js birdhouse; edge piece): pole under the house, the house, a gable roof ----------
// the gable boards: the front one shows the art's roof band, the back one the same band seen from behind (views.n)
const BIRD = (gf, gb) => [
  lathe(0, 0.46, [[0, 1.8], [50, 1.8]], { n: 6, sh: false }),
  box(-9, 9, 0.32, 0.6, 50, 66),
  card(-14, 14, gf, 61, 77, { t: 2, sh: false }), card(-14, 14, gb, 61, 77, { t: 2, sh: false }),
  quad([[-14, 0.3, 63], [0, 0.3, 75.5], [0, 0.62, 75.5], [-14, 0.62, 63]], { px: [-6, 0.6, 68], sh: false }),
  quad([[0, 0.3, 75.5], [14, 0.3, 63], [14, 0.62, 63], [0, 0.62, 75.5]], { px: [6, 0.6, 68], sh: false }),
];
defineSolid('birdhouse', { foot: true, parts: BIRD(0.6, 0.32), views: { n: { parts: BIRD(0.32, 0.6) } }, blob: [0.3, 0.3, 0.1, 0.4] });

// ---------- notice board (decor.js noticeBoard + _side / _back; edge piece): posts, board, a gable roof ----------
// the roof as the side view draws it: ridge along the board at 60 px, eaves 9 px in front / behind at 45 px; its
// slopes in the roof's colour, the gables at the ends with the side view's roof
defineSolid('notice_board', {
  foot: true,
  parts: [
    box(-22.2, -17.8, 0.53, 0.61, 0, 54), box(17.8, 22.2, 0.53, 0.61, 0, 54), box(-22, 22, 0.542, 0.62, 18, 46),
    quad([[-29, 0.58, 61], [29, 0.58, 61], [29, 0.72, 45], [-29, 0.72, 45]], { px: [-14, 0.62, 51.5] }),
    quad([[29, 0.58, 61], [-29, 0.58, 61], [-29, 0.44, 45], [29, 0.44, 45]], { px: [-14, 0.62, 51.5], sh: false }),
    box(-30, -28, 0.44, 0.72, 44, 61, NS), box(28, 30, 0.44, 0.72, 44, 61, NS),
  ],
  views: { e: { parts: [
    box(-2.2, 2.2, 0.56, 0.62, 0, 54), box(-2.2, 2.2, 0.56, 0.62, 0, 54), box(-2.5, 2.5, -0.07, 0.62, 18, 46),
    quad([[0, -0.07, 61], [0, 0.62, 61], [9, 0.62, 45], [9, -0.07, 45]], { px: [-3, 0.62, 52] }),
    quad([[0, 0.62, 61], [0, -0.07, 61], [-9, -0.07, 45], [-9, 0.62, 45]], { px: [-3, 0.62, 52], sh: false }),
    box(-10, 10, 0.6, 0.64, 44, 61, NS), box(-10, 10, -0.09, -0.05, 44, 61, NS),
  ] } },
  blob: [0.7, 0.35, 0.12, 0.4],
});

// ---------- signpost (decor.js signpost; edge piece): the post with its tip, two arrow boards through it ----------
defineSolid('signpost', {
  foot: true,
  parts: [box(-2.3, 2.3, 0.584, 0.656, 0, 56), box(-3.5, 3.5, 0.584, 0.656, 56, 61, NS), card(0, 25, 0.62, 42, 53, NS), card(-23, 0, 0.62, 30, 41, NS)],
  blob: [0.35, 0.3, 0.1, 0.4],
});

// ---------- garden arch (decor.js gardenArch): two posts with roses, the arch over them (a thin trellis) ----------
defineSolid('garden_arch', {
  parts: [lathe(-26, 0.7, [[0, 4], [78, 4]], { n: 6, sh: false }), lathe(26, 0.7, [[0, 4], [78, 4]], { n: 6, sh: false }), card(-34, 34, 0.7, 66, 98, { t: 4, sh: false }), SHADOW(0.7, 96)],
  blob: [1, 0.3, 0.3, 0.35],
});

// ---------- pergola (decor.js pergola, 2×2): four posts, two beams, the rafters and leaves lying on top ----------
defineSolid('pergola', {
  V: 2,
  parts: [
    lathe(-54, 0.18, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }), lathe(54, 0.18, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }),
    lathe(-54, 1.86, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }), lathe(54, 1.86, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }),
    box(-62, 62, 0.13, 0.23, 70, 76), box(-62, 62, 1.81, 1.91, 70, 76),
    quad([[-64, 0, 80], [64, 0, 80], [64, 2.04, 80], [-64, 2.04, 80]], { z: 2, sh: false }),
    SHADOW(1, 80),
  ],
  blob: false,
});

// ---------- flower bed (decor.js flowerBed): the bed (its own art without the flowers) and the flowers on it as a
// vegetation sprite standing on the bed's edge nearest the camera (they rise over the bed at every angle) ----------
defineSolid('flower_bed', {
  s: 'flower_bed_base',
  parts: [box(-28, 28, 0.08, 0.94, 0, 2, NS)],
  blob: false,
  fx: [{ at: [0, 0.51, 0], bp: true, draw: bedFlowers }],
});
function bedFlowers(B, A, o, t, x, y, lift, a) {
  const F = B.faces, vi = (((o.v | 0) % 3) + 3) % 3, s = F ? archSprite(A, 'flower_bed_plants_' + vi) : null;
  if (!s) return;
  const tn = tintOf(o), e = 0.36, px = x - CAMV.s * e, py = y + CAMV.c * e;
  // the art's frame (64 × 84, anchor (32, 84)): its row of the bed's front edge (Y(0.87, 0) = 75.7) on the ground there
  bq(F, s, false, 32, 84, -14, -14, 78, 98, 32, px, py, lift + (75.7 - 98) / 64, tn[0], tn[1], tn[2], tn[3]);
}

// ---------- training dummy (decor.js dummy): cross foot, pole, straw torso, arms, head; it wobbles when hit ----------
const DK = 0.25;
defineSolid('training_dummy', {
  k: DK, piv: pivOf(0.62, 1, DK, 0.5),
  parts: [
    box(-14, 14, 0.597, 0.643, 0, 4.5, NS), box(-2.5, 2.5, 0.565, 0.675, 0, 4.5, NS), box(-2.5, 2.5, 0.61, 0.63, 4, 10, NS),
    lathe(0, 0.62, [[8, 2.2], [62, 2]], { n: 6, sh: false, tilt: true }),
    lathe(0, 0.62, [[12, 10.5], [18, 12.5], [32, 13.5], [46, 10]], { n: 8, tilt: true }),
    card(-26.5, 26.5, 0.62, 37, 48, { t: 8, sh: false, tilt: true }),
    lathe(0, 0.62, [[45, 6], [50, 8.2], [60, 8], [66.5, 2.5]], { n: 6, sh: false, tilt: true, z: 0.01 }),
  ],
  // the hit wobble of archCompose (o._wobT / _wobA / _wobD), about the top of the foot
  tilt: (o, t) => { const dt = t - (o._wobT ?? -99); return dt >= 0 && dt < 2.5 ? (o._wobA || 0.6) * Math.exp(-dt * 3.2) * Math.sin(dt * 17) * (o._wobD || 1) * 0.3 : 0; },
  tiltAt: [0, 0.62, 8],
  blob: [0.6, 0.6, 0.5, 0.42],
});

// ---------- columns (roofs.js columnWood / columnStone, roof supports): footing, round shaft, capital ----------
// drawn at row 0.78 with flat fronts: k 0.3 puts them in the middle of the tile as square / round blocks
const QK = 0.3, QP = pivOf(0.733, 1, QK, 0.5);
defineSolid('column_wood', {
  k: QK, piv: QP,
  parts: [box(-10, 10, 0.686, 0.78, 0, 7, { top: 'strip', sh: false }), lathe(0, 0.733, [[7, 6], [48, 6]], { n: 8 }), card(-13, 13, 0.733, 40, 48.5, { t: 2, sh: false }), box(-15, 15, 0.716, 0.75, 47, 54, { top: 'strip', sh: false })],
  blob: [0.6, 0.6, 0.5, 0.36],
});
defineSolid('column_stone', {
  k: QK, piv: QP,
  parts: [box(-12, 12, 0.677, 0.79, 0, 8, { top: 'strip', sh: false }), lathe(0, 0.733, [[8, 8], [46, 8]], { n: 8 }), box(-14, 14, 0.682, 0.784, 44, 54, { top: 'strip', sh: false })],
  blob: [0.62, 0.62, 0.5, 0.36],
});

// ---------- raider camps (art/stations.js tent / crate; world objects, not buildings: world = their size) ----------
// canvas A-frame tent (tent_0, 2 tiles wide): the ridge along its depth at 68 px, the two slopes down to ±50 px, the
// front gable with the open entrance, the back gable in the canvas colour
defineSolid('tent_0', {
  world: [2, 1],
  parts: [
    quad([[0, 0.2, 68], [0, 0.95, 68], [-50, 0.95, 0], [-50, 0.2, 0]]),
    quad([[0, 0.95, 68], [0, 0.2, 68], [50, 0.2, 0], [50, 0.95, 0]]),
    quad([[-1, 0.95, 68], [1, 0.95, 68], [50, 0.98, 0], [-50, 0.98, 0]], NS), // (gables lean out a hair: their outward side is the upper one)
    quad([[1, 0.2, 68], [-1, 0.2, 68], [-50, 0.17, 0], [50, 0.17, 0]], { px: [-30, 0.5, 30], sh: false }),
    SHADOW(0.58, 68),
  ],
  blob: [2.1, 1.1, 0.42, 0.4],
});
// conical hide tent (tent_1): the cone (its round base drawn very flat: k 0.15) with the poles fanning out of the top
const PK = 0.15;
defineSolid('tent_1', {
  world: [1.5, 1.5], k: PK, piv: pivOf(0.85, 1, PK, 0.25),
  parts: [lathe(0, 0.85, [[0, 48], [6, 44], [40, 26], [90, 4], [98, 1]]), lathe(0, 0.85, [[96, 1.5], [112, 9]], { n: 6, sh: false })],
  blob: [1.6, 1.6, 0.75, 0.4],
});
// supply crate (crate_0: 42 × 27 px, 0.34 deep)
defineSolid('crate_0', {
  world: [0.7, 0.7],
  parts: [box(-21, 21, 0.54, 0.88, 0, 27)],
  blob: [0.75, 0.55, 0.3, 0.4],
});
