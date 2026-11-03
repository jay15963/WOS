// Camera rotation — the solid pieces of the garden and the outdoors (art/faces/solid.js: format, units and rules at the
// top of that file): benches, planter, woodpile, cart, drying rack, fountain, well, statue, totem, beehive, haystack,
// scarecrow, notice board, signpost, garden arch, birdhouse, pergola, flower bed, training dummy, columns.
// Numbers are read off the painters (art/decor.js, art/roofs.js): x px from the art's centre column, v = ground row in
// tiles (anchor row V), h px above the ground. Every model has its true depth at every angle; old art that draws round
// things squashed (ellipses) maps its texture with k, and piv puts the true centre where it belongs (piv = (d_art −
// k·d_true) / (1 − k), d = v − V). A part moved in depth keeps its art by moving its heights with it (64 px per tile).
// Surfaces the art never shows (roof slopes, a stump's top) are filled with one texel of the art (px).
import { defineSolid } from './solid.js';
import { CAMV, ARCH_FACES as K, archSprite } from '../archCompose.js';
import { tintOf } from './props.js';
import { bq, vq, shade } from './kit.js';
import { capArt } from '../caps.js';
import { COL_TURNED } from '../roofs.js';

// ---------- little helpers ----------
const box = (x0, x1, v0, v1, h0, h1, o) => ({ box: [x0, x1, v0, v1, h0, h1], ...o });
const card = (x0, x1, v, h0, h1, o) => ({ card: [x0, x1, v, h0, h1], ...o });
const lathe = (x, v, pr, o) => ({ lathe: [x, v, pr], ...o });
const quad = (q, o) => ({ quad: q, ...o });
const NS = { sh: false };
// top art (art/caps.js) of the tops the front art cannot show: dressed stone, the end of a post, a beam block
const CAP_SLAB = capArt('slab', '#9a9386', false), CAP_SLAB_HI = capArt('slab', '#bcb4a6', false), CAP_SLAB_R = capArt('slab', '#a9a194');
const CAP_END = capArt('wood', '#b98a58', false), CAP_END_R = capArt('wood', '#b98a58'), CAP_BEAM = capArt('plank', '#9c6e43', false);
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

// ---------- planter (decor.js planter): the box with its soil (planter_base, the art without the flowers), and the
// flowers as vegetation: four slices of planter_plants standing on the soil along the box, each on its own stretch,
// on the long side nearer the camera (seen end-on they line up like a row of bushes) ----------
defineSolid('planter', {
  s: 'planter_base', e: 'planter_base_e', model: 'front',
  parts: [box(-56, 56, 0.4, 0.8, 0, 16)],
  views: { e: { V: 2, parts: [box(-14, 14, 0.15, 1.85, 0, 16)] } },
  fx: [{ at: [0, 0.6, 15], always: true, draw: planterPlants }],
});
const PFACE = { s: 0, w: 1, n: 2, e: 3 };
function planterPlants(B, A, o, t, x, y, lift, a, fs) {
  const F = B.faces, s = F ? archSprite(A, 'planter_plants') : null;
  if (!s) return;
  const an = (PFACE[o.face || 's'] ?? 0) * Math.PI / 2, ax = Math.cos(an), ay = Math.sin(an), lx = -ay, ly = ax; // (its length, its depth)
  const sd = -CAMV.s * lx + CAMV.c * ly >= 0 ? 0.08 : -0.08; // (the long side nearer the camera)
  const sw = Math.sin(t * 1.3 + o.x * 0.7) * 0.004;
  for (let i = 0; i < 4; i++) {
    const u = -0.75 + i * 0.5, cc = 64 + 64 * u, px = x + ax * u + lx * sd, py = y + ay * u + ly * sd;
    // frame of mk(2, 30): 128 × 94, anchor (64, 94); the plants' baseline is row Y(0.6, 0) = 68.4
    bq(F, s, false, 64, 94, cc - 17, 40, cc + 17, 70.4, cc + sw * 64, px, py, lift - 2 / 64, fs.tr, fs.tg, fs.tb, a);
  }
}

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

// ---------- drying rack (decor.js dryingRack): two A-frames, the pole, hides and herbs hanging from it; the hides
// sway in the wind about the pole (wind: a shear below it) ----------
const DR_WIND = (a) => ({ t: 2, sh: false, wind: [a, 46] });
defineSolid('drying_rack', {
  parts: [
    box(-60, -44, 0.45, 0.75, 0, 48, { open: true, sh: false }), box(44, 60, 0.45, 0.75, 0, 48, { open: true, sh: false }),
    box(-54, 54, 0.57, 0.63, 44.4, 48, NS),
    card(-42, -16, 0.6, 16, 46, DR_WIND(0.07)), card(-10, 12, 0.6, 20, 46, DR_WIND(-0.06)), card(21, 41, 0.6, 21, 45, DR_WIND(0.08)),
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
// the art draws the square pedestal's tops 5–6 px deep for 28–34 px: k ≈ 0.18, centred in the tile. The figure is two
// crossed boards with its art (a round body wrapped in a flat drawing broke into shards turning): the front board
// shows it from the front and, from behind, its own back (statue_<v>_back: the owl's wings, the shield's grip — no
// face on the back), the board across it shows its profile (statue_<v>_side)
const SK = 6 / 34, SP = pivOf(0.613, 1, SK, 0.5), sdp = (px) => (px * SK) / 64;
const ST_PED = [box(-17, 17, 0.566, 0.66, 0, 8, { sh: false, cap: CAP_SLAB }), box(-12, 12, 0.579, 0.647, 8, 34, NS), box(-14, 14, 0.574, 0.652, 33, 38, { sh: false, cap: CAP_SLAB_HI })];
const ST_EDGE = box(-1.5, 1.5, 0.613 - sdp(15), 0.613 + sdp(15), 38, 95, NS), ST_FACE = card(-15, 15, 0.613, 38, 95, { t: 3 });
defineSolid('statue', {
  k: SK, piv: SP,
  parts: [...ST_PED, ST_FACE, ST_EDGE],
  views: { e: { k: SK, piv: SP, parts: [...ST_PED, ST_EDGE, ST_FACE] } },
  state: (o) => ((o.v | 0) & 1 ? 'b' : 'a'), variants: { a: { e: 'statue_0_side', n: 'statue_0_back' }, b: { e: 'statue_1_side', n: 'statue_1_back' } },
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
const CK = 4 / 14, SC_H = [-5, 0.62, 55.5]; // (the head's burlap: its back and sides have no face)
defineSolid('scarecrow', {
  k: CK, piv: pivOf(0.62, 1, CK, 0.5),
  parts: [
    lathe(0, 0.62, [[0, 2.2], [66, 2.2]], { n: 6, tilt: true }), // (casts the art's silhouette)
    card(-29, 29, 0.62, 14, 53, { t: 4, sh: false, tilt: true }),
    lathe(0, 0.62, [[50.4, 5.5], [54, 7.2], [61, 7.2], [64, 5]], { n: 8, sh: false, tilt: true, px: { n: SC_H, e: SC_H, w: SC_H } }),
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
  parts: [box(-2.3, 2.3, 0.584, 0.656, 0, 56), box(-3.5, 3.5, 0.584, 0.656, 56, 61, { sh: false, cap: CAP_END }), card(0, 25, 0.62, 42, 53, NS), card(-23, 0, 0.62, 30, 41, NS)],
  blob: [0.35, 0.3, 0.1, 0.4],
});

// ---------- garden arch (decor.js gardenArch): a real walk-through arbour, not a board: two posts on each side (front
// and back, geo: the art's posts on both planes) joined by a trellis panel (its sides the posts' edge stretched: the
// vines), the arch with its roses on both planes (the garland sways a little in the wind), slats over the top following
// the curve ----------
const GA_D = 0.13, GA_POST = [[0, 2.6], [78, 2.6]];
const GA_SLATS = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88].map((u) => { const x = -26 + 52 * u, h = 76 + 56 * u * (1 - u); return box(x - 1.6, x + 1.6, 0.7 - GA_D, 0.7 + GA_D, h - 2.5, h + 0.4, { sh: false, ow: 0.8, px: [-25.5, 0.7, 40] }); });
defineSolid('garden_arch', {
  borrow: { e: 'edge' },
  parts: [
    ...[-26, 26].flatMap((x) => [GA_D, -GA_D].map((d) => lathe(x, 0.7, GA_POST, { n: 6, sh: false, geo: [x, 0.7 + d, GA_POST] }))),
    box(-27.4, -24.6, 0.7 - GA_D, 0.7 + GA_D, 6, 74, { sh: false, ow: 1 }), box(24.6, 27.4, 0.7 - GA_D, 0.7 + GA_D, 6, 74, { sh: false, ow: 1 }),
    card(-34, 34, 0.7, 66, 98, { t: 3, sh: false, geo: [-34, 34, 0.7 + GA_D, 66, 98], wind: [0.035, 66] }),
    card(-34, 34, 0.7, 66, 98, { t: 3, sh: false, geo: [-34, 34, 0.7 - GA_D, 66, 98], wind: [0.035, 66] }),
    ...GA_SLATS,
    SHADOW(0.7, 96),
  ],
  blob: [1, 0.45, 0.5, 0.35],
});

// ---------- pergola (decor.js pergola, 2×2): four posts, two beams, the rafters and leaves lying on top (the leaves
// stir in the wind: the mat sways a hair over the beams) ----------
defineSolid('pergola', {
  V: 2,
  parts: [
    lathe(-54, 0.18, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }), lathe(54, 0.18, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }),
    lathe(-54, 1.86, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }), lathe(54, 1.86, [[0, 3.5], [72, 3.5]], { n: 4, sh: false }),
    box(-62, 62, 0.13, 0.23, 70, 76), box(-62, 62, 1.81, 1.91, 70, 76),
    quad([[-64, 0, 80], [64, 0, 80], [64, 2.04, 80], [-64, 2.04, 80]], { z: 2, sh: false, wind: [0.018, 0] }),
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
  fx: [{ at: [0, 0.51, 0], always: true, draw: bedFlowers }],
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
// drawn at row 0.78 with flat fronts: k 0.3 puts them in the middle of the tile as square / round blocks. They hold
// the roof up: the capital reaches the wall top (one story, 64 px) where the eaves sit (geo: the art drawn 10 px lower)
const QK = 0.3, QP = pivOf(0.733, 1, QK, 0.5), QV = 0.733, qd = (px) => (px * QK) / 64; // (qd: a true half depth, px → art rows)
const COL_POST = [box(-10, 10, 0.686, 0.78, 0, 7, { cap: CAP_SLAB, sh: false }),
  lathe(0, QV, [[7, 6], [48, 6]], { n: 10, geo: [0, QV, [[7, 6], [58, 6]]] }),
  card(-13, 13, QV, 40, 48.5, { t: 3, sh: false, geo: [-13, 13, QV, 50, 58.5] }),
  box(-15, 15, 0.716, 0.75, 47, 54, { cap: CAP_BEAM, sh: false, geo: [-16, 16, 0.712, 0.754, 57, 64] })];
const COL_STONE = [box(-12, 12, 0.677, 0.79, 0, 8, { cap: CAP_SLAB, sh: false }),
  lathe(0, QV, [[8, 8], [46, 8]], { n: 10, geo: [0, QV, [[8, 8], [56, 8]]] }),
  box(-14, 14, 0.682, 0.784, 44, 54, { cap: CAP_SLAB_HI, sh: false, geo: [-15, 15, 0.679, 0.787, 54, 64] })];
defineSolid('column_wood', { k: QK, piv: QP, align: QV, parts: COL_POST, blob: [0.6, 0.6, 0.5, 0.36], state: colState, variant: colVariant });
defineSolid('column_stone', { k: QK, piv: QP, align: QV, parts: COL_STONE, blob: [0.62, 0.62, 0.5, 0.36], state: colState, variant: colVariant });

// ---- the column kit (content/kits.js column): four looks — wooden post, stone column, round, carved — each in the
// type's material (round / carved: the wood or stone art), and the details: capital (a wide abacus and a collar),
// stone base, banner hanging on the shaft, sconce (a torch on an iron arm, lit: its light is the kit light), ivy ----
// state: '' for the type's own look without details (the table above), else 'look|details|material' (kept on the
// shared decoded kit object o._k: no string per frame); the variant for it is built once
function colState(o) {
  const k = o._k;
  if (!k) return '';
  if (k._col === undefined) {
    const mat = o.type === 'column_stone' ? 's' : 'w', look = k.custom ? k.style : mat === 's' ? 'stone' : 'post';
    const ds = ['capital', 'base', 'banner', 'sconce', 'ivy'].filter((d) => k.on[d]).join('.');
    k._col = look === (mat === 's' ? 'stone' : 'post') && !ds ? '' : look + '|' + ds + '|' + mat;
  }
  return k._col;
}
const COLV = new Map();
const COL_CAP = [0, 0.78, 50], COL_STC = [0, 0.78, 3]; // (the capital's colour, the footing's stone: both arts)
const IRON_PX = [2, 0.9, 31, 'anvil'], TORCH_PX = [1, 1, 20, 'torch'], TORCH_HEAD = [-1, 1, 50, 'torch'];
function colVariant(st) {
  let v = COLV.get(st);
  if (v) return v;
  const [look, ds, mat] = st.split('|'), on = new Set(ds ? ds.split('.') : []), wood = look === 'post' || ((look === 'round' || look === 'carved') && mat === 'w');
  let s = wood ? 'column_wood' : 'column_stone';
  let parts, R;
  if (look === 'post') { parts = [...COL_POST]; R = 6; }
  else if (look === 'stone') { parts = [...COL_STONE]; R = 8; }
  else {
    // round / carved: their own art (art/roofs.js columnTurned, the same profiles), base and capital tops from above
    s = `column_${look}_${mat}`; R = look === 'round' ? 7.5 : 7;
    const [pb, ps, pc] = COL_TURNED[look], top = wood ? CAP_END_R : CAP_SLAB_R;
    parts = [lathe(0, QV, pb, { n: 12, sh: false, cap: top }), lathe(0, QV, ps, { n: 12 }), lathe(0, QV, pc, { n: 12, sh: false, cap: top })];
  }
  const fx = [];
  let light = null;
  const B = R + 6; // (the base's and the abacus' half width)
  if (on.has('base')) parts.push(box(-B, B, QV - qd(B), QV + qd(B), 0, 4, { sh: false, px: COL_STC, ow: 1, z: -0.01, cap: CAP_SLAB }));
  if (on.has('capital')) {
    parts.push(lathe(0, QV, [[53, R + 1.6], [55.5, R + 1.6]], { n: 12, sh: false, px: COL_CAP, ow: 0.6 })); // (a collar under the capital)
    // the wooden post: a second bolster across the first (a cross); the others: a square abacus over the capital
    if (look === 'post') parts.push(box(-6, 6, QV - qd(16), QV + qd(16), 57.5, 64, { sh: false, px: COL_CAP, ow: 1, cap: CAP_BEAM }));
    else parts.push(box(-B, B, QV - qd(B), QV + qd(B), 61.5, 64.6, { sh: false, px: COL_CAP, ow: 1, z: 0.01, cap: wood ? CAP_BEAM : CAP_SLAB_HI }));
  }
  if (on.has('sconce')) {
    const vf = QV + qd(R), v0 = QV + qd(R + 6) - (0.075 * 38) / 64;
    parts.push(box(-3.5, 3.5, vf, vf + qd(1.2) * 2, 33, 44, { sh: false, px: IRON_PX, ow: 0.6 }), box(-1, 1, vf, QV + qd(R + 6), 38, 40.5, { sh: false, px: IRON_PX, ow: 0.6 }),
      lathe(0, v0, [[38, 1.7], [47.5, 1.9]], { n: 6, lean: [0, 0.075], sh: false, px: TORCH_PX, ow: 0.6 }),
      lathe(0, v0, [[47.5, 2.6], [53.5, 2.9]], { n: 6, lean: [0, 0.075], sh: false, px: TORCH_HEAD, ow: 0.6 }));
    fx.push({ at: [0, v0 + (0.075 * 55) / 64, 55], draw: colFlame });
    light = [0, QV + qd(R + 9), 0];
  }
  if (on.has('banner')) fx.push({ at: [0, QV, 0], r: R, draw: colBanner });
  if (on.has('ivy')) fx.push({ at: [0, QV, 0], r: R, draw: colIvy });
  v = { s, parts, fx, light };
  COLV.set(st, v);
  return v;
}
const colFlame = (B, A, o, t, x, y, lift, a) => { if (a > 0.05) K.smallFlame(B, K.tables(A), x, y, lift, 1, t, 0.9); };
// a sprite's whole image laid on a vertical face from (xa, ya) to (xb, yb), heights hb..ht (colour: the piece's tint)
function wholeFace(F, s, xa, ya, xb, yb, hb, ht, fs, a, c0f = 0, c1f = 1) {
  const W = s.w * 64, H = s.h * 64;
  let nx = yb - ya, ny = xa - xb;
  const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
  if (-CAMV.s * nx + CAMV.c * ny < 0) { nx = -nx; ny = -ny; } // (two-sided: lit as the side the camera sees)
  const z = shade(nx, ny);
  vq(F, s, false, s.ax * W, s.ay * H, W * c0f, 0, W * c1f, H, xa, ya, xb, yb, hb, ht, fs.tr * z, fs.tg * z, fs.tb * z, a);
}
// the banner: the stand's cloth (banner_cloth_<v>) hanging on the shaft's front, from under the capital
const COL_CLOTH = ['banner_cloth_0', 'banner_cloth_1', 'banner_cloth_2'];
function colBanner(B, A, o, t, x, y, lift, a, fs) {
  const F = B.faces, s = F ? archSprite(A, COL_CLOTH[(((o.v | 0) % 3) + 3) % 3]) : null;
  if (!s) return;
  const fy = y + (this.r + 0.8) / 64, w = 0.13, sw = Math.sin(t * 1.6 + o.x) * 0.006;
  wholeFace(F, s, x - w + sw, fy, x + w + sw, fy, lift + 0.36, lift + 0.86, fs, a);
}
// ivy climbing the shaft: four slices of the walls' ivy art (kd_ivy_<v>) round it
const COL_IVY = ['kd_ivy_0', 'kd_ivy_1', 'kd_ivy_2'];
function colIvy(B, A, o, t, x, y, lift, a, fs) {
  const F = B.faces, s = F ? archSprite(A, COL_IVY[(((o.tx | 0) + (o.ty | 0)) % 3 + 3) % 3]) : null;
  if (!s) return;
  const r = (this.r + 1.5) / 64, ht = lift + 0.88;
  const C = [[x - r, y + r], [x + r, y + r], [x + r, y - r], [x - r, y - r]];
  for (let i = 0; i < 4; i++) { const p = C[i], q = C[(i + 1) % 4]; wholeFace(F, s, p[0], p[1], q[0], q[1], lift + 0.02, ht, fs, a, 0.12 + i * 0.19, 0.31 + i * 0.19); }
}

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
// conical hide tent (tent_1): the cone (its round base drawn very flat: k 0.15) with the poles fanning out of the top;
// the back and the sides show tent_1_back (stations.js: a laced seam, no second doorway)
const PK = 0.15;
defineSolid('tent_1', {
  world: [1.5, 1.5], k: PK, piv: pivOf(0.85, 1, PK, 0.25), e: 'tent_1_back',
  parts: [lathe(0, 0.85, [[0, 48], [6, 44], [40, 26], [90, 4], [98, 1]]), lathe(0, 0.85, [[96, 1.5], [112, 9]], { n: 6, sh: false })],
  blob: [1.6, 1.6, 0.75, 0.4],
});
// supply crate (crate_0: 42 × 27 px, 0.34 deep)
defineSolid('crate_0', {
  world: [0.7, 0.7],
  parts: [box(-21, 21, 0.54, 0.88, 0, 27)],
  blob: [0.75, 0.55, 0.3, 0.4],
});
