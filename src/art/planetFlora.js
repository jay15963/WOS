// The planet's own flora (docs/PLANET.md §6): 14 trees, 10 plants and the ground details of the new biomes, in the
// game's style (outlined layers, cel shading, light from the top-left). Everything here is LAZY (art/lazyDefs.js →
// the lazy look texture): it is painted only when a planet biome shows it, so the baked atlas, its cache and its
// digest are those of the classic world.
//
// Gameplay keeps the classic kinds (collision, harvest, regrowth, network): the art is a species inside them.
//   trees      tree_oak / tree_pine / tree_birch with o.v = species * 16 + variant (TREE_SPECIES, art/trees.js)
//   plants     bush (fibre + sticks), fibergrass (fibre) and boulder (pickaxe) with o.v = species * 1000 + variant
//   decor      d.t = the group name (drawn like the classic decor, art/composeWorld.js drawDecor)
// PLANET_SPECIES below is the table both the planet adapter (world/planet/ingame.js) and composeWorld read.

import { sprite, rng, OW, TAU, lin, rad, atop, taper, leaf, ramp, rgb, hex, mixc, circle, smoothClosed, blobPts } from './paint.js';
import { mkLump, drawFoliage, bushLumps } from './foliage.js';
import { lazyDef, LAZY_DEFS } from './lazyDefs.js';
import { drawTrunk, trunkPath, bareCrown, footLitter, conifer, TREE_SPECIES } from './trees.js';
import { SC, TREE_SC } from './season.js';
import { FLORA_KIND } from '../world/planet/flora.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const FOOT = 9; // px between the trunk base and the sprite bottom (like art/trees.js)

// ---------------------------------------------------------------- species table
// art group → { n: variants, sc: season class, sway, twin: has a bare twin (<group>_bare_<i>) } + kind / sp (the classic
// gameplay kind and the species index in it: world/planet/flora.js FLORA_KIND)
export const PLANET_SPECIES = {
  // trees: the index continues TREE_SPECIES of the kind (classic species keep 0..2)
  tree_palm: { n: 3, sc: SC.CONIFER, sway: 0.045 },
  tree_acacia: { n: 3, sc: SC.CONIFER, sway: 0.025 },
  tree_baobab: { n: 2, sc: SC.BIRCH, sway: 0.012, twin: true },
  tree_jungle: { n: 4, sc: SC.CONIFER, sway: 0.02 },
  tree_kapok: { n: 2, sc: SC.CONIFER, sway: 0.015 },
  tree_olive: { n: 3, sc: SC.CONIFER, sway: 0.025 },
  tree_fern: { n: 2, sc: SC.CONIFER, sway: 0.05 },
  tree_mangrove: { n: 3, sc: SC.CONIFER, sway: 0.02 },
  tree_spruce: { n: 3, sc: SC.CONIFER, sway: 0.02 },
  tree_larch: { n: 2, sc: SC.BIRCH, sway: 0.025, twin: true },
  tree_redwood: { n: 2, sc: SC.CONIFER, sway: 0.01 },
  tree_cypress: { n: 2, sc: SC.CONIFER, sway: 0.03 },
  tree_dwarf: { n: 3, sc: SC.OAK, sway: 0.04 }, // (no bare twin: its leaves drop off the stems)
  bamboo: { n: 2, sc: SC.CONIFER, sway: 0.06 },
  // plants (classic bush species 0..2: bush, wild rose, juniper)
  cactus: { n: 3, sc: SC.SNOW, sway: 0 },
  cactus_tall: { n: 2, sc: SC.SNOW, sway: 0 },
  agave: { n: 2, sc: SC.SNOW, sway: 0.01 },
  shrub_desert: { n: 3, sc: SC.SHRUB, sway: 0.04 },
  dead_bush: { n: 2, sc: SC.SNOW, sway: 0.03 },
  tundra_shrub: { n: 3, sc: SC.SHRUB, sway: 0.03 },
  banana: { n: 3, sc: SC.CONIFER, sway: 0.05 },
  tussock: { n: 3, sc: SC.GRASS, sway: 0.1 },
  dune_grass: { n: 2, sc: SC.GRASS, sway: 0.12 },
  papyrus: { n: 2, sc: SC.GRASS, sway: 0.09 },
  lichen_rock: { n: 3, sc: SC.SNOW, sway: 0 },
  termite_mound: { n: 2, sc: SC.SNOW, sway: 0 },
  desert_rock: { n: 3, sc: SC.SNOW, sway: 0 },
};
// kind → species index → art group (composeWorld): built from the table
export const SPECIES_OF = {};
for (const g in PLANET_SPECIES) {
  const e = PLANET_SPECIES[g];
  [e.kind, e.sp] = FLORA_KIND[g];
  (SPECIES_OF[e.kind] ||= {})[e.sp] = g;
  if (TREE_SPECIES[e.kind]) TREE_SPECIES[e.kind][e.sp] = g; // (the tree species list of the kind: o.v >> 4)
  if (e.kind.startsWith('tree_')) TREE_SC[g] = e.sc;
}
// decor kinds painted here: flat ones lie on the ground (no sway); `w`: also in shallow water
export const PLANET_DECOR = {
  snowtuft: { n: 3, sway: 0.06, sc: SC.SNOW }, cottongrass: { n: 3, sway: 0.14 }, savgrass: { n: 4, sway: 0.15 },
  jungleplant: { n: 4, sway: 0.05, sc: SC.CONIFER }, pneumato: { n: 2, sway: 0, sc: SC.SNOW },
  lichen: { n: 3, flat: true }, saltcrust: { n: 3, flat: true }, seaweed: { n: 3, flat: true }, coral: { n: 4, flat: true },
  ash: { n: 3, flat: true }, sandripple: { n: 3, flat: true }, crackedmud: { n: 3, flat: true },
};

// ---------------------------------------------------------------- shared bits
// a bin of Path2D per tone (few fills for many small shapes)
function bins(n) { const a = []; for (let i = 0; i < n; i++) a.push(null); return a; }
function binAt(B, t) { const i = Math.max(0, Math.min(B.length - 1, Math.round(clamp01(t) * (B.length - 1)))); return B[i] || (B[i] = new Path2D()); }
function fillBins(g, B, stops, a = 1) { for (let i = 0; i < B.length; i++) if (B[i]) { g.fillStyle = ramp(stops, i / (B.length - 1), a); g.fill(B[i]); } }
const qpt = (x0, y0, cx, cy, x1, y1, t) => { const u = 1 - t; return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1, 2 * u * (cx - x0) + 2 * t * (x1 - cx), 2 * u * (cy - y0) + 2 * t * (y1 - cy)]; };
function blade(g, x, y, h, dx, w) {
  g.moveTo(x - w / 2, y);
  g.quadraticCurveTo(x - w * 0.4 + dx * 0.25, y - h * 0.55, x + dx, y - h);
  g.quadraticCurveTo(x + w * 0.45 + dx * 0.35, y - h * 0.5, x + w / 2, y);
  g.closePath();
}
function groundShadow(g, cx, y, rx, ry, a = 0.35) { g.fillStyle = `rgba(30,22,14,${a})`; g.beginPath(); g.ellipse(cx, y, rx, ry, 0, 0, TAU); g.fill(); }

// a pinnate frond (palm / tree fern): rachis along a quadratic curve, leaflets hanging from both sides, toned by
// the side (lit top-left) and along the frond; leaflets go into bins B (stops ramp)
function frond(B, rach, x0, y0, cx, cy, x1, y1, Lf, tone, rand, droop = 0.7, step = 2.4) {
  rach.moveTo(x0, y0); rach.quadraticCurveTo(cx, cy, x1, y1);
  const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
  const n = Math.max(6, Math.round(len / step));
  for (let k = 2; k <= n; k++) {
    const t = k / n, [px, py, tx, ty] = qpt(x0, y0, cx, cy, x1, y1, t), tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl, uy = ty / tl;
    const L = Lf * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.92) * (0.75 + rand() * 0.3);
    for (const sd of [-1, 1]) {
      // normal to the rachis, pulled down by gravity, swept toward the tip
      let ex = -uy * sd * 0.8 + ux * 0.45, ey = ux * sd * 0.8 + uy * 0.45 + droop;
      const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
      const lit = clamp01(tone + (sd * (ux < 0 ? -1 : 1) < 0 ? 0.12 : -0.1) - t * 0.15 + (ey > 0.6 ? -0.08 : 0.06) + (rand() - 0.5) * 0.1);
      leaf(binAt(B, lit), px, py, px + ex * L, py + ey * L, Math.max(0.8, L * 0.16), sd * L * 0.12);
    }
  }
}

// ---------------------------------------------------------------- PALM (coconut)
const PALM_PALS = [
  ['#1f3514', '#335020', '#4e722b', '#71973a', '#9cbc55'],
  ['#22381a', '#375625', '#527a30', '#76a03f', '#a2c45d'],
  ['#2a3a14', '#425620', '#5f772a', '#839a38', '#adbf55'],
];
function palm(v) {
  const rand = rng(21000 + v * 59);
  const stops = PALM_PALS[v % 3];
  const S = [{ W: 2.9, H: 4.3, lean: 26, curve: 18 }, { W: 2.9, H: 3.9, lean: -22, curve: -10 }, { W: 2.7, H: 4.6, lean: 10, curve: 22 }][v % 3];
  return sprite(S.W, S.H, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const tx = cx + S.lean, ty = 46 + rand() * 6; // crown point
    const mx = cx + S.curve, my = (baseY + ty) / 2 + 10;
    P.layer((g) => groundShadow(g, cx, baseY, 13, 4, 0.3), 0);
    // trunk: slender, curving, ringed with old leaf scars, a little wider at the foot
    P.layer((g) => {
      const path = (gg) => taper(gg, cx, baseY + 1, mx, my, tx, ty + 6, 13, 7, 18);
      g.fillStyle = lin(g, cx - 10, 0, cx + 10, 0, [[0, '#b39a72'], [0.4, '#93785a'], [0.8, '#6b543f'], [1, '#4c3b2c']]);
      g.beginPath(); path(g); g.fill();
      g.save(); g.beginPath(); path(g); g.clip();
      for (let k = 0; k < 22; k++) {
        const t = k / 22, [px, py, ddx, ddy] = qpt(cx, baseY + 1, mx, my, tx, ty + 6, t), dl = Math.hypot(ddx, ddy) || 1;
        const nx = -ddy / dl, ny = ddx / dl, w = 7 - t * 3;
        g.strokeStyle = 'rgba(52,38,26,0.55)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(px - nx * w, py - ny * w); g.quadraticCurveTo(px, py + 2, px + nx * w, py + ny * w); g.stroke();
        g.strokeStyle = 'rgba(220,200,160,0.35)'; g.beginPath(); g.moveTo(px - nx * w * 0.8, py - ny * w * 0.8 - 1.4); g.lineTo(px - nx * w * 0.1, py - 1); g.stroke();
      }
      g.restore();
      g.fillStyle = '#6b543f'; g.beginPath(); g.ellipse(cx, baseY, 9, 3, 0, 0, TAU); g.fill();
    });
    // fronds: back (darker, behind the crown) then front, arching out and drooping
    const fr = [];
    const nF = 11 + (v % 2);
    for (let i = 0; i < nF; i++) {
      const a = (i / nF) * TAU + rand() * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      fr.push({ a, back: sa < -0.1, L: 66 + rand() * 20 - Math.abs(sa) * 12, ca, sa });
    }
    const drawFr = (list, dark) => P.layer((g) => {
      const B = bins(10), rach = new Path2D();
      for (const f of list) {
        const L = f.L, ox = f.ca * L, oy = f.sa * L * 0.42;
        const x1 = tx + ox * 1.05, y1 = ty + oy + 26 + Math.abs(f.ca) * 10, c1x = tx + ox * 0.55, c1y = ty + oy * 0.6 - 18 - (1 - Math.abs(f.ca)) * 4;
        frond(B, rach, tx, ty, c1x, c1y, x1, y1, 18, dark ? 0.32 : 0.55 - f.ca * 0.15, rand, 0.95, 2.2);
      }
      fillBins(g, B, stops);
      g.strokeStyle = dark ? '#3d4a1e' : '#6f7a33'; g.lineWidth = 1.3; g.stroke(rach);
    }, 1.2, 'rgba(22,30,10,0.75)');
    drawFr(fr.filter((f) => f.back), true);
    // coconuts and the crown shaft
    P.layer((g) => {
      for (let k = 0; k < 5; k++) {
        const x = tx + (k - 2) * 4 + (rand() - 0.5) * 2, y = ty + 6 + (k & 1) * 4;
        g.fillStyle = k % 3 ? '#5e6a26' : '#7a5a2a'; g.beginPath(); circle(g, x, y, 3.6); g.fill();
        g.fillStyle = 'rgba(255,240,200,0.35)'; g.beginPath(); circle(g, x - 1.2, y - 1.2, 1.3); g.fill();
      }
    }, 1.1);
    drawFr(fr.filter((f) => !f.back), false);
  });
}

// ---------------------------------------------------------------- ACACIA (umbrella thorn)
const ACACIA_PALS = [
  { deep: '#2a3815', dark: '#3d501d', mid: '#566c27', light: '#748a33', high: '#97aa4c' },
  { deep: '#2e3916', dark: '#43521f', mid: '#5f6f2a', light: '#7f8d38', high: '#a5ad55' },
  { deep: '#263617', dark: '#384d20', mid: '#506a2b', light: '#6c8838', high: '#8fa752' },
];
const ACACIA_BARK = { deep: '#2a2018', dark: '#43342a', mid: '#5f4c3d', light: '#7d6852', high: '#977f66' };
function acacia(v) {
  const rand = rng(22000 + v * 61);
  const pal = ACACIA_PALS[v % 3];
  const Wt = [3.4, 3.0, 3.6][v % 3], Ht = [2.9, 2.7, 3.1][v % 3];
  return sprite(Wt, Ht, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const crownY = 34 + rand() * 6, R = W * 0.43, RY = 15;
    const lean = (rand() - 0.5) * 14;
    P.layer((g) => footLitter(g, cx, baseY, ['rgba(150,120,70,0.7)', 'rgba(110,90,50,0.7)'], 14, rand, 18), 0);
    // trunk forking low into 3–4 spreading limbs that reach the flat crown
    P.layer((g) => {
      const fy = baseY - 30 - rand() * 12, fx = cx + lean * 0.4;
      g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, ACACIA_BARK.high], [0.5, ACACIA_BARK.mid], [1, ACACIA_BARK.deep]]);
      g.beginPath(); taper(g, cx, baseY + 1, (cx + fx) / 2 - 2, (baseY + fy) / 2, fx, fy, 11, 7); g.fill();
      const limbs = 3 + (v % 2);
      for (let i = 0; i < limbs; i++) {
        const u = limbs === 1 ? 0 : (i / (limbs - 1)) * 2 - 1;
        const ex = cx + lean + u * R * 0.7, ey = crownY + 8 + Math.abs(u) * 4;
        g.beginPath(); taper(g, fx, fy + 2, fx + u * R * 0.25, (fy + ey) / 2 - 4, ex, ey, 7 - Math.abs(u), 2.4); g.fill();
        // twiggy forks under the crown
        for (const s of [-1, 1]) { g.beginPath(); taper(g, ex, ey + 2, ex + s * 6, ey - 3, ex + s * 12, ey - 4, 2, 0.8); g.fill(); }
      }
      g.strokeStyle = 'rgba(30,22,16,0.5)'; g.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const x = cx - 3 + i * 2; g.beginPath(); g.moveTo(x, baseY - 2); g.lineTo(x + lean * 0.1, fy + 6); g.stroke(); }
    });
    // the flat crown: a wide thin layer of small lumps, light top, deep underside
    P.layer((g) => {
      const lumps = [];
      const n = 11 + (v % 3);
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1)) * 2 - 1, x = cx + lean + u * R * (0.92 + rand() * 0.08);
        lumps.push(mkLump(x, crownY + Math.abs(u) * 3 + (rand() - 0.5) * 4, 11 + rand() * 4 - Math.abs(u) * 3, rand, 0.8));
        if (rand() < 0.6) lumps.push(mkLump(x + (rand() - 0.5) * 10, crownY - 7 + rand() * 3, 9 + rand() * 3, rand, 0.8));
      }
      drawFoliage(g, lumps, pal, rand, { cx: cx + lean, cy: crownY, R, RY, marks: 0.9, sprigs: 1.6, drop: 0.45 });
      // the flat dark underside of the canopy
      atop(g, () => { g.fillStyle = lin(g, 0, crownY - 2, 0, crownY + 16, [[0, 'rgba(0,0,0,0)'], [1, rgb(hex(pal.deep), 0.6)]]); g.fillRect(0, crownY - 2, W, 20); });
    });
  });
}

// ---------------------------------------------------------------- BAOBAB
const BAOBAB_BARK = { deep: '#4a3a32', dark: '#6b574b', mid: '#8c7566', light: '#ab9483', high: '#c6b19f' };
const BAOBAB_PAL = { deep: '#2f3d17', dark: '#45571f', mid: '#617529', light: '#819637', high: '#a5b752' };
function baobab(v, bare = false) {
  const rand = rng(23000 + v * 67);
  return sprite(v ? 2.7 : 3.0, v ? 3.2 : 3.5, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const topY = baseY - (v ? 110 : 128), bw = v ? 46 : 54;
    P.layer((g) => groundShadow(g, cx, baseY, bw * 0.6, 6, 0.3), 0);
    const tips = [];
    P.layer((g) => {
      // the bottle trunk: swollen, smooth, slightly tapering, a few folds
      const path = (gg) => {
        gg.moveTo(cx - bw / 2 - 4, baseY + 1);
        gg.bezierCurveTo(cx - bw / 2 - 6, baseY - 50, cx - bw * 0.42, topY + 30, cx - bw * 0.3, topY + 6);
        gg.lineTo(cx + bw * 0.3, topY + 6);
        gg.bezierCurveTo(cx + bw * 0.42, topY + 30, cx + bw / 2 + 6, baseY - 50, cx + bw / 2 + 4, baseY + 1);
        gg.quadraticCurveTo(cx, baseY + 6, cx - bw / 2 - 4, baseY + 1); gg.closePath();
      };
      g.fillStyle = lin(g, cx - bw / 2, 0, cx + bw / 2, 0, [[0, BAOBAB_BARK.high], [0.3, BAOBAB_BARK.light], [0.6, BAOBAB_BARK.mid], [1, BAOBAB_BARK.deep]]);
      g.beginPath(); path(g); g.fill();
      g.save(); g.beginPath(); path(g); g.clip();
      g.strokeStyle = 'rgba(60,44,36,0.45)'; g.lineWidth = 1.4;
      for (let i = 0; i < 7; i++) { const u = (i / 6 - 0.5) * bw * 0.85; g.beginPath(); g.moveTo(cx + u * 1.1, baseY); g.bezierCurveTo(cx + u * 1.15, baseY - 40, cx + u * 0.8, topY + 40, cx + u * 0.55, topY + 8); g.stroke(); }
      g.fillStyle = 'rgba(255,240,225,0.18)';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(cx - bw * 0.25 + rand() * 8, baseY - 20 - rand() * 70, 2, 6 + rand() * 6, 0, 0, TAU); g.fill(); }
      g.restore();
      // short thick branches spreading from the top like roots in the sky
      g.fillStyle = BAOBAB_BARK.mid;
      const nb = 6;
      for (let i = 0; i < nb; i++) {
        const u = (i / (nb - 1)) * 2 - 1, x0 = cx + u * bw * 0.22, y0 = topY + 10;
        const x1 = cx + u * (bw * 0.9 + rand() * 10), y1 = topY - 16 - (1 - Math.abs(u)) * 18 - rand() * 8;
        g.beginPath(); taper(g, x0, y0, x0 + u * 8, y1 + 10, x1, y1, 9, 3); g.fill();
        tips.push([x1, y1]);
        for (const s of [-1, 1]) { const x2 = x1 + s * (5 + rand() * 6), y2 = y1 - 8 - rand() * 6; g.beginPath(); taper(g, x1, y1 + 1, (x1 + x2) / 2, y1 - 3, x2, y2, 3, 1); g.fill(); tips.push([x2, y2]); }
      }
    });
    if (bare) return;
    // sparse leaf clusters on the branch ends
    P.layer((g) => {
      const lumps = [];
      for (const [x, y] of tips) if (rand() < 0.8) lumps.push(mkLump(x + (rand() - 0.5) * 4, y - 2, 7 + rand() * 4, rand, 0.8));
      drawFoliage(g, lumps, BAOBAB_PAL, rand, { cx, cy: topY - 18, R: bw, RY: 22, marks: 1, sprigs: 1.4, drop: 0.3 });
    });
  });
}

// ---------------------------------------------------------------- JUNGLE tree (rainforest canopy)
const JUNGLE_PALS = [
  { deep: '#0f2914', dark: '#18401c', mid: '#235a25', light: '#33772f', high: '#509640' },
  { deep: '#122b12', dark: '#1d431a', mid: '#2a5e22', light: '#3d7b2c', high: '#5c9a3e' },
  { deep: '#0d2618', dark: '#163d23', mid: '#20562e', light: '#2f723a', high: '#4b914c' },
];
const JUNGLE_BARK = { deep: '#2c261c', dark: '#463d2e', mid: '#655842', light: '#857558', high: '#a19070' };
function jungle(v) {
  const rand = rng(24000 + v * 71);
  const pal = JUNGLE_PALS[v % 3];
  // 0, 1: canopy trees (wide crowns that close over the forest), 2, 3: understory broadleaves
  const under = v >= 2;
  const S = [{ W: 4.6, H: 4.5, rx: 128, ry: 76 }, { W: 4.3, H: 4.2, rx: 118, ry: 74 }, { W: 2.9, H: 2.9, rx: 76, ry: 50 }, { W: 2.6, H: 2.6, rx: 66, ry: 46 }][v % 4];
  return sprite(S.W, S.H, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const ccy = 12 + S.ry * (under ? 1 : 1.12), ccx = cx + (rand() - 0.5) * 14;
    P.layer((g) => footLitter(g, cx, baseY, ['rgba(90,70,40,0.8)', 'rgba(70,90,40,0.7)', 'rgba(120,90,50,0.7)'], 22, rand, 26), 0);
    P.layer((g) => {
      // a straight trunk with plank buttress roots and big limbs spreading into the crown
      const ty = ccy + S.ry * 0.3, tw = under ? 13 : 24;
      drawTrunk(g, cx, baseY, ty, tw, under ? 8 : 15, ccx - cx, rand, JUNGLE_BARK, ccy + S.ry * 0.9);
      g.fillStyle = JUNGLE_BARK.mid;
      for (const s2 of [-1, 1]) { g.beginPath(); taper(g, ccx, ty + 14, ccx + s2 * S.rx * 0.2, ty - 2, ccx + s2 * S.rx * 0.55, ty - 16, tw * 0.45, 4); g.fill(); }
      if (!under) for (const [s2, k] of [[-1, 1], [1, 0.9], [-1, 0.5], [1, 0.45]]) {
        g.beginPath(); g.moveTo(cx + s2 * 5, baseY - 40 * k); g.quadraticCurveTo(cx + s2 * 11, baseY - 10, cx + s2 * (26 + 8 * k), baseY + 2); g.lineTo(cx + s2 * 3, baseY + 2); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,240,210,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + s2 * 5, baseY - 36 * k); g.quadraticCurveTo(cx + s2 * 10, baseY - 10, cx + s2 * (22 + 8 * k), baseY + 1); g.stroke();
      }
      // a strangler fig's roots and epiphytes on the trunk
      g.strokeStyle = 'rgba(70,60,40,0.8)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx - 6, ty + 20); g.bezierCurveTo(cx - 2, ty + 50, cx + 7, baseY - 40, cx + 3, baseY - 4); g.stroke();
      for (let i = 0; i < 5; i++) { const y = baseY - 20 - rand() * Math.max(10, baseY - ty - 30), s2 = i & 1 ? 1 : -1; g.fillStyle = i & 1 ? '#3d6a2a' : '#5a8a34'; g.beginPath(); leaf(g, cx + s2 * 4, y, cx + s2 * (14 + rand() * 4), y - 6, 3, s2); g.fill(); }
    });
    // the crown: broad uneven lobes at several heights, deep shade inside, big leaves sticking out
    P.layer((g) => {
      const lumps = [];
      const lobes = under ? [[0, 0, 1], [-0.6, 0.25, 0.8], [0.6, 0.2, 0.8], [0, -0.45, 0.75]]
        : [[0, 0.05, 1.1], [-0.7, 0.22, 0.85], [0.68, 0.16, 0.88], [-0.34, -0.42, 0.8], [0.36, -0.36, 0.82], [0, -0.66, 0.62], [(v & 1 ? 1 : -1) * 0.95, 0.5, 0.6], [(v & 1 ? -1 : 1) * 0.45, 0.62, 0.62], [-0.15, 0.6, 0.7]];
      for (const [lx, ly, lk] of lobes) {
        const bx = ccx + lx * S.rx * 0.8, by = ccy + ly * S.ry * 0.85, r = S.ry * (under ? 0.5 : 0.56) * lk;
        for (let i = 0; i < 4; i++) { const a = rand() * TAU; lumps.push(mkLump(bx + Math.cos(a) * r * 0.5, by + Math.sin(a) * r * 0.32, r * (0.6 + rand() * 0.16), rand, 1.15)); }
      }
      drawFoliage(g, lumps, pal, rand, { cx: ccx, cy: ccy, R: S.rx, RY: S.ry, marks: 0.9, sprigs: 2.4, drop: 0.7 });
    });
    // lianas and aerial roots hanging from the crown, leafy
    P.layer((g) => {
      const nl = under ? 1 : 3;
      for (let k0 = 0; k0 < nl; k0++) {
        const side = k0 % 2 ? -1 : 1, x0 = ccx + side * S.rx * (0.3 + rand() * 0.4), y0 = ccy + S.ry * (0.45 + rand() * 0.2);
        const y1 = Math.min(baseY - 8, y0 + 50 + rand() * 60), x1 = x0 + (rand() - 0.5) * 10;
        g.strokeStyle = k0 ? '#5a4a2c' : '#4a5a24'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + side * 8, (y0 + y1) / 2, x1, y1); g.stroke();
        if (!k0) for (let k = 0; k < 8; k++) { const t = k / 8, x = x0 + (x1 - x0) * t + side * 8 * t * (1 - t) * 2, y = y0 + (y1 - y0) * t; g.fillStyle = k & 1 ? '#3d6a2a' : '#5a8a34'; g.beginPath(); leaf(g, x, y, x + (k & 1 ? 5 : -5), y + 3, 2, 0); g.fill(); }
      }
    }, 1.1);
  });
}

// ---------------------------------------------------------------- KAPOK (emergent giant)
const KAPOK_BARK = { deep: '#4a4a40', dark: '#66665a', mid: '#848272', light: '#a2a08e', high: '#bcb9a6' };
const KAPOK_PAL = { deep: '#132d16', dark: '#1e4520', mid: '#2c6029', light: '#3f7d33', high: '#5f9c48' };
function kapok(v) {
  const rand = rng(25000 + v * 73);
  return sprite(v ? 4.2 : 4.6, v ? 4.5 : 4.9, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const ccy = 52, R = W * 0.46, RY = 34;
    P.layer((g) => groundShadow(g, cx, baseY, 30, 7, 0.3), 0);
    P.layer((g) => {
      drawTrunk(g, cx, baseY, ccy + 18, 24, 13, 0, rand, KAPOK_BARK, ccy + 60);
      g.save(); g.beginPath(); trunkPath(g, cx, baseY, ccy + 18, 24, 13, 0, rand); g.clip();
      for (let i = 0; i < 14; i++) { g.fillStyle = i & 1 ? 'rgba(90,110,70,0.35)' : 'rgba(60,58,48,0.3)'; g.beginPath(); g.ellipse(cx - 8 + rand() * 16, ccy + 40 + rand() * (baseY - ccy - 50), 3 + rand() * 3, 5 + rand() * 6, 0, 0, TAU); g.fill(); }
      g.restore();
      // huge plank buttresses
      g.fillStyle = KAPOK_BARK.mid;
      for (const [s, k] of [[-1, 1], [1, 1.1], [-1, 0.55], [1, 0.5]]) {
        g.beginPath(); g.moveTo(cx + s * 5, baseY - 60 * k); g.bezierCurveTo(cx + s * 10, baseY - 20, cx + s * 22, baseY - 6, cx + s * (34 + 8 * k), baseY + 2); g.lineTo(cx + s * 4, baseY + 2); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(40,36,30,0.35)'; g.lineWidth = 1; g.stroke();
      }
      // limbs fanning out horizontally under the crown
      g.fillStyle = KAPOK_BARK.dark;
      for (const s of [-1, 1]) for (const k of [0.55, 0.9]) { g.beginPath(); taper(g, cx, ccy + 40 - k * 10, cx + s * R * 0.4 * k, ccy + 16, cx + s * R * 0.85 * k, ccy + 8, 10, 3); g.fill(); }
    });
    P.layer((g) => {
      const lumps = [];
      const n = 12;
      for (let i = 0; i < n; i++) { const u = (i / (n - 1)) * 2 - 1; lumps.push(mkLump(cx + u * R * 0.95, ccy + 4 + Math.abs(u) * 8 + (rand() - 0.5) * 6, 21 + rand() * 6 - Math.abs(u) * 5, rand, 0.9)); }
      for (let i = 0; i < 6; i++) lumps.push(mkLump(cx + (i - 2.5) * R * 0.3, ccy - 14 + rand() * 6, 19 + rand() * 5, rand, 0.9));
      for (let i = 0; i < 3; i++) lumps.push(mkLump(cx + (i - 1) * R * 0.4, ccy - 30 + rand() * 6, 15 + rand() * 4, rand, 0.9));
      drawFoliage(g, lumps, KAPOK_PAL, rand, { cx, cy: ccy, R, RY, marks: 1.1, sprigs: 1.4, drop: 0.55 });
    });
  });
}

// ---------------------------------------------------------------- OLIVE (gnarled, silvery)
const OLIVE_PALS = [
  { deep: '#253220', dark: '#3a4b30', mid: '#566a47', light: '#788c64', high: '#a1af88' },
  { deep: '#283321', dark: '#3e4d33', mid: '#5b6c4b', light: '#7e8f69', high: '#a7b48f' },
  { deep: '#233121', dark: '#374a33', mid: '#52684b', light: '#738a68', high: '#9bad8c' },
];
const OLIVE_BARK = { deep: '#3a342c', dark: '#5a5145', mid: '#7a705f', light: '#9c917d', high: '#bab09b' };
function olive(v) {
  const rand = rng(26000 + v * 79);
  const pal = OLIVE_PALS[v % 3];
  return sprite(2.6, 2.5, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const ccy = baseY - 80, s = v & 1 ? -1 : 1;
    P.layer((g) => groundShadow(g, cx, baseY, 16, 4, 0.3), 0);
    P.layer((g) => {
      // a short twisted trunk, split and hollowed, two or three crooked limbs
      g.fillStyle = lin(g, cx - 14, 0, cx + 14, 0, [[0, OLIVE_BARK.high], [0.45, OLIVE_BARK.mid], [1, OLIVE_BARK.deep]]);
      g.beginPath(); taper(g, cx - 3, baseY + 2, cx + s * 14, baseY - 22, cx - s * 6, baseY - 50, 22, 10, 14); g.fill();
      g.beginPath(); taper(g, cx + 5, baseY + 1, cx - s * 6, baseY - 26, cx + s * 16, baseY - 56, 12, 6, 12); g.fill();
      g.beginPath(); taper(g, cx - s * 4, baseY - 44, cx - s * 18, baseY - 56, cx - s * 30, baseY - 62, 7, 3); g.fill();
      g.fillStyle = '#2a241d'; g.beginPath(); g.ellipse(cx + s * 2, baseY - 18, 3, 7, s * 0.2, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(40,34,26,0.5)'; g.lineWidth = 1.1;
      for (let i = 0; i < 6; i++) { const y = baseY - 4 - i * 7; g.beginPath(); g.moveTo(cx - 8 + s * i, y); g.quadraticCurveTo(cx + s * (i * 2), y - 5, cx + 6 - s * i * 0.5, y - 10); g.stroke(); }
    });
    // a broad, loose, silvery crown of small clumps (light shows through)
    P.layer((g) => {
      const lumps = [];
      for (let i = 0; i < 12; i++) {
        const a = Math.PI * (0.95 + rand() * 1.1), d = 0.35 + rand() * 0.6;
        lumps.push(mkLump(cx + Math.cos(a) * 62 * d, ccy + Math.sin(a) * 26 * d + 10, 12 + rand() * 5, rand, 0.7));
      }
      drawFoliage(g, lumps, pal, rand, { cx, cy: ccy, R: 62, RY: 34, marks: 1.6, sprigs: 2.2, drop: 0.4 });
      if (v === 2) for (let i = 0; i < 10; i++) { const x = cx + (rand() - 0.5) * 90, y = ccy + (rand() - 0.3) * 40; g.fillStyle = i & 1 ? '#2c2a30' : '#4a4a2a'; g.beginPath(); g.ellipse(x, y, 1.6, 2.2, 0.3, 0, TAU); g.fill(); }
    });
  });
}

// ---------------------------------------------------------------- TREE FERN
const FERN_PAL = [['#1c3a17', '#2c5520', '#43752b', '#62983a', '#8cba55'], ['#1d3a1c', '#2e5627', '#467634', '#669944', '#8fbb5d']];
function treeFern(v) {
  const rand = rng(27000 + v * 83);
  const stops = FERN_PAL[v % 2];
  return sprite(2.6, v ? 2.7 : 3.1, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const tx = cx + (v ? -6 : 5), ty = v ? 62 : 54;
    P.layer((g) => groundShadow(g, cx, baseY, 12, 3.5, 0.3), 0);
    P.layer((g) => {
      // a shaggy fibrous trunk covered in old frond bases
      g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, '#6a5038'], [0.5, '#4a3626'], [1, '#2c2018']]);
      g.beginPath(); taper(g, cx, baseY + 1, (cx + tx) / 2, (baseY + ty) / 2, tx, ty + 4, 12, 9); g.fill();
      for (let k = 0; k < 16; k++) { const t = k / 16, x = cx + (tx - cx) * t, y = baseY - (baseY - ty) * t; g.fillStyle = k & 1 ? '#5c4430' : '#3a2a1e'; g.beginPath(); leaf(g, x + (k & 1 ? 3 : -3), y, x + (k & 1 ? 6 : -6), y + 6, 2, 0); g.fill(); }
    });
    const mk = (back) => P.layer((g) => {
      const B = bins(10), rach = new Path2D();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + 0.2;
        const sa = Math.sin(a), ca = Math.cos(a);
        if ((sa < 0) !== back) continue;
        const L = 50 + rand() * 12;
        frond(B, rach, tx, ty, tx + ca * L * 0.5, ty + sa * L * 0.2 - 22, tx + ca * L, ty + sa * L * 0.35 + 8, 9, back ? 0.35 : 0.6 - ca * 0.15, rand, 0.35, 2.1);
      }
      fillBins(g, B, stops);
      g.strokeStyle = '#3f5a22'; g.lineWidth = 1.2; g.stroke(rach);
    }, 1.1, 'rgba(18,30,10,0.75)');
    mk(true);
    // a fiddlehead coil in the middle
    P.layer((g) => { g.strokeStyle = '#7a9a3a'; g.lineWidth = 2; g.beginPath(); g.arc(tx + 2, ty - 6, 3, 0, Math.PI * 1.6); g.stroke(); }, 1);
    mk(false);
  });
}

// ---------------------------------------------------------------- MANGROVE (stilt roots in the water)
const MANG_PALS = [
  { deep: '#16301e', dark: '#22472a', mid: '#316236', light: '#447f43', high: '#64a057' },
  { deep: '#183220', dark: '#254a2d', mid: '#34663a', light: '#4a8448', high: '#6aa65c' },
  { deep: '#142e1c', dark: '#204428', mid: '#2e5e33', light: '#417a40', high: '#5f9a53' },
];
function mangrove(v) {
  const rand = rng(28000 + v * 89);
  const pal = MANG_PALS[v % 3];
  return sprite(3.0, 2.3, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const rootY = baseY - 24, ccy = baseY - 62;
    // arching prop roots from several stems down into the mud / water
    P.layer((g) => {
      g.lineCap = 'round';
      const nr = 13;
      for (let i = 0; i < nr; i++) {
        const u = (i / (nr - 1)) * 2 - 1, x1 = cx + u * (44 + rand() * 8), y1 = baseY + (rand() - 0.5) * 4;
        const x0 = cx + u * 14 + (rand() - 0.5) * 6, y0 = rootY - rand() * 14;
        g.strokeStyle = rand() < 0.5 ? '#6a5a46' : '#7c6a52'; g.lineWidth = 3.2 - Math.abs(u) * 1.2;
        g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x0 + u * 14, y0 - 8, x1 - u * 4, y1 - 20, x1, y1); g.stroke();
      }
      g.strokeStyle = 'rgba(230,210,170,0.3)'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const u = (i / 5) * 2 - 1, x0 = cx + u * 14; g.beginPath(); g.moveTo(x0 - 1, rootY - 6); g.quadraticCurveTo(x0 + u * 12, rootY - 14, cx + u * 36, baseY - 10); g.stroke(); }
      // stems up into the crown
      for (const u of [-0.6, -0.15, 0.3, 0.7]) {
        g.fillStyle = lin(g, cx + u * 20 - 5, 0, cx + u * 20 + 5, 0, [[0, '#8a7a62'], [0.5, '#66574a'], [1, '#3e3428']]);
        g.beginPath(); taper(g, cx + u * 14, rootY + 2, cx + u * 18, rootY - 18, cx + u * 26, ccy + 6, 6, 3.5); g.fill();
      }
    }, 2.2);
    // a dense, glossy, low crown wider than tall
    P.layer((g) => {
      const lumps = [];
      for (let i = 0; i < 9; i++) { const u = (i / 8) * 2 - 1; lumps.push(mkLump(cx + u * 64, ccy + 10 + u * u * 4 + (rand() - 0.5) * 8, 20 + rand() * 6 - Math.abs(u) * 6, rand, 0.9)); }
      for (let i = 0; i < 5; i++) { const u = (i - 2) / 2; lumps.push(mkLump(cx + u * 52 + (rand() - 0.5) * 8, ccy - 16 + u * u * 16 + rand() * 6, 19 + rand() * 4, rand, 0.9)); }
      lumps.push(mkLump(cx + (rand() - 0.5) * 20, ccy - 30, 17, rand, 0.9));
      drawFoliage(g, lumps, pal, rand, { cx, cy: ccy, R: 72, RY: 34, marks: 1.3, sprigs: 1.2, drop: 0.5 });
    });
  });
}

// ---------------------------------------------------------------- SPRUCE (dark, narrow, drooping) / REDWOOD
const SPRUCE_PALS = [
  { deep: '#0a1916', dark: '#122a25', mid: '#1b3e35', light: '#285646', high: '#3f735e', tip: '#6c9a84' },
  { deep: '#0b1a18', dark: '#132c28', mid: '#1d4139', light: '#2b5a4c', high: '#447866', tip: '#78a28e' },
  { deep: '#0c1b15', dark: '#152d22', mid: '#204331', light: '#2f5d42', high: '#4a7b5a', tip: '#82a67e' },
];
const SPRUCE_SHAPES = [
  { W: 2.0, H: 4.3, n: 8, w0: 46, top: 4, trunk: 16, ov: 1.75, lean: 0 },
  { W: 1.7, H: 4.6, n: 9, w0: 38, top: 3, trunk: 14, ov: 1.7, lean: 2 },
  { W: 1.5, H: 3.2, n: 6, w0: 34, top: 4, trunk: 12, ov: 1.75, lean: -1 },
];
const spruce = (v) => conifer(rng(29000 + v * 97), SPRUCE_SHAPES[v % 3], SPRUCE_PALS[v % 3]);
const REDWOOD_BARK = { deep: '#3a160c', dark: '#5e2414', mid: '#86381e', light: '#a9532c', high: '#c8774a' };
const REDWOOD_PALS = [
  { deep: '#0d1f12', dark: '#16331c', mid: '#214a27', light: '#306236', high: '#4b7f4c', tip: '#7aa268' },
  { deep: '#0e2015', dark: '#18361f', mid: '#234d2b', light: '#33663b', high: '#4f8350', tip: '#80a66e' },
];
function redwoodTrunk(g, cx, baseY, lowest, rand) {
  const tw = 30, top = lowest - 40;
  drawTrunk(g, cx, baseY, top, tw, 14, 0, rand, REDWOOD_BARK, lowest + 6);
  g.save(); g.beginPath(); trunkPath(g, cx, baseY, top, tw, 14, 0, rand); g.clip();
  // long fibrous furrows
  g.strokeStyle = 'rgba(40,14,6,0.55)'; g.lineWidth = 1.3;
  for (let i = 0; i < 9; i++) { const u = (i / 8 - 0.5) * tw * 0.9; g.beginPath(); g.moveTo(cx + u, baseY); g.bezierCurveTo(cx + u * 0.9 + (rand() - 0.5) * 3, baseY - 60, cx + u * 0.6, top + 60, cx + u * 0.45, top); g.stroke(); }
  g.restore();
  // a burned scar at the foot of some, flared roots
  g.fillStyle = '#26140c'; g.beginPath(); g.ellipse(cx - 6, baseY - 14, 5, 12, 0.1, 0, TAU); g.fill();
}
const redwood = (v) => conifer(rng(30000 + v * 101), [{ W: 2.4, H: 5.8, n: 7, w0: 50, top: 4, trunk: 150, ov: 1.8, lean: 0 }, { W: 2.2, H: 5.3, n: 6, w0: 44, top: 4, trunk: 130, ov: 1.8, lean: 2 }][v % 2],
  REDWOOD_PALS[v % 2], { tw: 30, bark: REDWOOD_BARK, trunk: redwoodTrunk });

// ---------------------------------------------------------------- LARCH (light, airy; golden in autumn, bare in winter)
const LARCH_PALS = [
  { deep: '#24371a', dark: '#355122', mid: '#4d6f2c', light: '#6b9038', high: '#92b152', tip: '#bcd47a' },
  { deep: '#27391b', dark: '#395424', mid: '#52732f', light: '#71953c', high: '#99b757', tip: '#c3d982' },
];
const LARCH_BARK = { deep: '#2e1d16', dark: '#4a2f22', mid: '#6a4532', light: '#8a5e44', high: '#a67858' };
function larch(v, bare = false) {
  const rand = rng(31000 + v * 103);
  const S = [{ W: 2.1, H: 3.9, n: 8, w0: 52, top: 6, trunk: 24 }, { W: 1.9, H: 3.5, n: 7, w0: 46, top: 6, trunk: 20 }][v % 2];
  const pal = LARCH_PALS[v % 2];
  return sprite(S.W, S.H, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT, lowest = baseY - S.trunk;
    P.layer((g) => footLitter(g, cx, baseY, ['rgba(170,130,60,0.8)', 'rgba(130,100,50,0.8)'], 20, rand, 16, true), 0);
    // trunk + drooping, upturned branches all the way up (they carry the needle tufts)
    const br = [];
    P.layer((g) => {
      drawTrunk(g, cx, baseY, S.top + 10, 12, 3, 0, rand, LARCH_BARK, 0);
      g.fillStyle = LARCH_BARK.mid;
      const nb = S.n * 2 + 2;
      for (let i = 0; i < nb; i++) {
        const t = i / (nb - 1), y = lowest - t * (lowest - S.top - 14), s = i & 1 ? 1 : -1;
        const w = S.w0 * (1 - t * 0.85) * (0.8 + rand() * 0.35);
        const x1 = cx + s * w, y1 = y + 6 + w * 0.08;
        g.beginPath(); taper(g, cx, y, cx + s * w * 0.5, y + 8, x1, y1 - 3, 3.2 - t * 1.4, 0.8); g.fill();
        br.push([cx, y, x1, y1, s, t]);
      }
    }, bare ? 1.4 : OW);
    if (bare) return;
    // soft tufts of fresh needles along the branches: stroke bunches, lit on the upper side
    P.layer((g) => {
      const B = bins(9), stops = [pal.deep, pal.dark, pal.mid, pal.light, pal.high];
      for (const [x0, y0, x1, y1, s, t] of br) {
        const n = Math.round(Math.abs(x1 - x0) / 2.4) + 3;
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n, px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u * u + 2;
          const lit = clamp01(0.62 - s * 0.12 - u * 0.1 + (rand() - 0.5) * 0.2 - t * 0.05);
          const q = binAt(B, lit - 0.22), r0 = 4.5 + rand() * 2.5 - t * 1.5;
          q.moveTo(px + r0, py + 2); q.ellipse(px, py + 2, r0, r0 * 0.62, 0, 0, TAU);
          const p = binAt(B, lit);
          for (let j = 0; j < 6; j++) { const a = -Math.PI / 2 + (rand() - 0.5) * 2.6, l = 5 + rand() * 4; p.moveTo(px, py); p.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l * 0.8 + 2); p.lineTo(px + Math.cos(a) * l + 1.4, py + Math.sin(a) * l * 0.8 + 2.6); p.closePath(); }
        }
      }
      fillBins(g, B, stops);
      g.fillStyle = pal.tip; g.beginPath(); taper(g, cx, S.top + 16, cx, S.top + 8, cx + 1, S.top, 3, 0.8); g.fill();
    }, 1.6, 'rgba(26,38,14,0.7)');
  });
}

// ---------------------------------------------------------------- CYPRESS (Mediterranean column)
const CYP_PALS = [['#0d1f12', '#15301b', '#1f4424', '#2c5a30', '#437645'], ['#0f2114', '#18331d', '#234828', '#315f35', '#4a7c4a']];
function cypress(v) {
  const rand = rng(32000 + v * 107);
  const stops = CYP_PALS[v % 2];
  const Ht = v ? 3.4 : 3.9, Wt = v ? 1.15 : 1.25;
  return sprite(Wt, Ht, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT, top = 6, bot = baseY - 10, R = W * 0.38;
    P.layer((g) => { g.fillStyle = '#4a3a2a'; g.beginPath(); taper(g, cx, baseY + 1, cx, baseY - 8, cx, bot - 4, 7, 5); g.fill(); });
    P.layer((g) => {
      // flame-shaped column: widest a third up, pointed top, rounded bottom
      const pts = [];
      const N = 26;
      for (let i = 0; i <= N; i++) {
        const t = i / N, y = top + (bot - top) * t;
        const w = R * Math.pow(Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.62), 1.1) * (t > 0.85 ? 1 - (t - 0.85) * 2.2 : 1);
        pts.push([cx + w + (rand() - 0.5) * 2.4, y]);
      }
      const left = [];
      for (let i = N; i >= 0; i--) { const t = i / N, y = top + (bot - top) * t; const w = R * Math.pow(Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.62), 1.1) * (t > 0.85 ? 1 - (t - 0.85) * 2.2 : 1); left.push([cx - w + (rand() - 0.5) * 2.4, y]); }
      const all = pts.concat(left);
      g.beginPath(); smoothClosed(g, all);
      g.fillStyle = lin(g, cx - R, 0, cx + R, 0, [[0, stops[3]], [0.45, stops[2]], [1, stops[0]]]); g.fill();
      g.save(); g.beginPath(); smoothClosed(g, all); g.clip();
      // scale-leaf sprays: little downward-curving tufts in tone bins
      const B = bins(8);
      for (let i = 0; i < 260; i++) {
        const y = top + rand() * (bot - top), x = cx + (rand() - 0.5) * R * 2;
        const lit = clamp01(0.55 - (x - cx) / R * 0.35 + (rand() - 0.5) * 0.3);
        const p = binAt(B, lit); const s = 2 + rand() * 2.5; p.moveTo(x - s, y); p.quadraticCurveTo(x, y - s * 1.2, x + s, y); p.quadraticCurveTo(x, y - s * 0.3, x - s, y); p.closePath();
      }
      fillBins(g, B, stops);
      g.restore();
    });
  });
}

// ---------------------------------------------------------------- DWARF tree (krummholz birch / willow)
const DWARF_PALS = [
  { deep: '#2e3d1a', dark: '#435822', mid: '#5c752c', light: '#789238', high: '#9ab053' },
  { deep: '#323c1b', dark: '#4a5624', mid: '#66722f', light: '#848f3c', high: '#a6ad58' },
  { deep: '#2b3b1d', dark: '#3f5527', mid: '#577031', light: '#738c3d', high: '#95aa57' },
];
function dwarf(v) {
  const rand = rng(33000 + v * 109);
  const pal = DWARF_PALS[v % 3];
  return sprite(1.7, 1.5, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT, s = v & 1 ? -1 : 1;
    P.layer((g) => {
      g.fillStyle = '#5a4a3c';
      // several crooked low stems leaning with the wind
      for (let i = 0; i < 4; i++) { const u = (i - 1.5) * 6; g.beginPath(); taper(g, cx + u, baseY + 1, cx + u + s * 10, baseY - 18, cx + u + s * (18 + rand() * 8), baseY - 30 - rand() * 12, 5, 1.6); g.fill(); }
      g.fillStyle = '#d6cfc0'; g.beginPath(); taper(g, cx - 4, baseY, cx + s * 4, baseY - 14, cx + s * 10, baseY - 24, 3, 1.4); g.fill();
    });
    P.layer((g) => {
      const lumps = [];
      for (let i = 0; i < 7; i++) lumps.push(mkLump(cx + s * 8 + (rand() - 0.5) * 60, baseY - 30 - rand() * 22, 10 + rand() * 4, rand, 0.6));
      drawFoliage(g, lumps, pal, rand, { cx: cx + s * 8, cy: baseY - 34, R: 34, RY: 20, marks: 1.6, sprigs: 2, drop: 0.35 });
    });
  });
}

// ---------------------------------------------------------------- BAMBOO clump
function bamboo(v) {
  const rand = rng(34000 + v * 113);
  return sprite(1.9, v ? 3.8 : 4.3, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - FOOT;
    const culms = [];
    const n = 9 + v * 2;
    for (let i = 0; i < n; i++) { const u = (i / (n - 1)) * 2 - 1; culms.push({ x: cx + u * 14 + (rand() - 0.5) * 4, h: (H - 30) * (0.7 + rand() * 0.3) * (1 - Math.abs(u) * 0.15), lean: u * 22 + (rand() - 0.5) * 10, w: 3.2 + rand() * 1.4, t: rand() }); }
    culms.sort((a, b) => a.t - b.t);
    P.layer((g) => groundShadow(g, cx, baseY, 18, 4, 0.3), 0);
    P.layer((g) => {
      for (const c of culms) {
        const x1 = c.x + c.lean, y1 = baseY - c.h;
        const col = mixc('#5f7a28', '#9aaa4c', c.t);
        g.fillStyle = col; g.beginPath(); taper(g, c.x, baseY + 1, c.x + c.lean * 0.3, baseY - c.h * 0.5, x1, y1, c.w, c.w * 0.6); g.fill();
        // nodes
        g.strokeStyle = 'rgba(40,50,16,0.7)'; g.lineWidth = 1;
        for (let k = 1; k < 9; k++) { const t = k / 9, u = 1 - t, x = u * u * c.x + 2 * u * t * (c.x + c.lean * 0.3) + t * t * x1, y = u * u * baseY + 2 * u * t * (baseY - c.h * 0.5) + t * t * y1; g.beginPath(); g.moveTo(x - c.w / 2, y); g.lineTo(x + c.w / 2, y + 0.4); g.stroke(); }
        g.strokeStyle = 'rgba(255,255,220,0.35)'; g.beginPath(); g.moveTo(c.x - c.w * 0.25, baseY); g.quadraticCurveTo(c.x + c.lean * 0.3 - c.w * 0.25, baseY - c.h * 0.5, x1 - c.w * 0.15, y1); g.stroke();
      }
    }, 1.5);
    // leaf sprays: thin drooping blades in fans along the upper culms
    P.layer((g) => {
      const B = bins(8), stops = ['#22401a', '#335a22', '#4a782c', '#679638', '#8db552'];
      for (const c of culms) {
        const x1 = c.x + c.lean, y1 = baseY - c.h;
        for (let k = 0; k < 7; k++) {
          const t = 0.45 + k * 0.08, u = 1 - t, x = u * u * c.x + 2 * u * t * (c.x + c.lean * 0.3) + t * t * x1, y = u * u * baseY + 2 * u * t * (baseY - c.h * 0.5) + t * t * y1;
          for (let j = 0; j < 4; j++) {
            const s = j & 1 ? 1 : -1, a = (s > 0 ? 0.15 : Math.PI - 0.15) + (rand() - 0.5) * 0.7, L = 9 + rand() * 6;
            leaf(binAt(B, clamp01(0.55 - s * 0.15 + (rand() - 0.5) * 0.3 - (1 - t) * 0.3)), x, y, x + Math.cos(a) * L, y + Math.sin(a) * L + 5, 1.8, s * 1.2);
          }
        }
      }
      fillBins(g, B, stops);
    }, 1, 'rgba(20,34,10,0.7)');
  });
}

// ---------------------------------------------------------------- PLANTS
// prickly pear / barrel cactus (v 0, 1) and a cluster (2)
const CACT = ['#2d4a2a', '#3f6534', '#57843f', '#79a552', '#a2c46e'];
function spines(g, x, y, r, rand, n) { g.strokeStyle = 'rgba(250,240,200,0.8)'; g.lineWidth = 0.6; g.beginPath(); for (let i = 0; i < n; i++) { const a = rand() * TAU, d = rand() * r; const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.9; g.moveTo(px, py); g.lineTo(px + Math.cos(a) * 1.8, py + Math.sin(a) * 1.8 - 0.6); } g.stroke(); }
function cactus(v) {
  const rand = rng(40000 + v * 17);
  return sprite(1.2, 1.3, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 6;
    P.layer((g) => groundShadow(g, cx, baseY, 15, 4, 0.35), 0);
    if (v === 0) {
      // prickly pear: flat oval pads stacked on each other, a few red fruits
      const pads = [[0, -12, 11, 14, 0], [-12, -26, 9, 12, -0.4], [11, -28, 9, 12, 0.35], [-3, -42, 8, 11, -0.1], [16, -44, 7, 9, 0.5]];
      P.layer((g) => {
        for (const [dx, dy, rx, ry, a] of pads) {
          g.fillStyle = lin(g, cx + dx - rx, 0, cx + dx + rx, 0, [[0, CACT[3]], [0.5, CACT[2]], [1, CACT[1]]]);
          g.beginPath(); g.ellipse(cx + dx, baseY + dy, rx, ry, a, 0, TAU); g.fill();
          g.fillStyle = 'rgba(220,240,180,0.25)'; g.beginPath(); g.ellipse(cx + dx - rx * 0.35, baseY + dy - ry * 0.3, rx * 0.35, ry * 0.5, a, 0, TAU); g.fill();
          spines(g, cx + dx, baseY + dy, rx * 0.8, rand, 10);
        }
        for (const [dx, dy] of [[-3, -54], [3, -53], [20, -54]]) { g.fillStyle = '#b8323a'; g.beginPath(); g.ellipse(cx + dx, baseY + dy, 2.6, 3.2, 0, 0, TAU); g.fill(); }
      }, 2);
    } else {
      // barrel cactus(es): ribbed globes with a crown of yellow flowers
      const globes = v === 1 ? [[0, 18, 16]] : [[-8, 14, 12], [10, 11, 9], [1, 8, 7]];
      P.layer((g) => {
        for (const [dx, r, rr] of globes) {
          const x = cx + dx, y = baseY - r;
          g.fillStyle = lin(g, x - rr, 0, x + rr, 0, [[0, CACT[3]], [0.45, CACT[2]], [1, CACT[0]]]);
          g.beginPath(); g.ellipse(x, y, rr, r, 0, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(20,40,16,0.55)'; g.lineWidth = 1;
          for (let k = -3; k <= 3; k++) { g.beginPath(); g.ellipse(x, y, Math.abs(k) / 3.6 * rr + 0.1, r * 0.98, 0, -Math.PI / 2, Math.PI / 2, k < 0); g.stroke(); }
          spines(g, x, y, rr * 0.9, rand, 18);
          for (let k = 0; k < 5; k++) { g.fillStyle = k & 1 ? '#f0c040' : '#e89a30'; g.beginPath(); leaf(g, x, y - r + 2, x + (k - 2) * 2.5, y - r - 4, 1.8, 0); g.fill(); }
        }
      }, 2);
    }
  });
}
// saguaro / columnar cactus with arms
function cactusTall(v) {
  const rand = rng(41000 + v * 19);
  return sprite(1.4, v ? 2.6 : 3.1, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 6, top = 10 + v * 6;
    P.layer((g) => groundShadow(g, cx, baseY, 13, 3.5, 0.35), 0);
    P.layer((g) => {
      const col = (x0, y0, x1, y1, w) => {
        g.fillStyle = lin(g, Math.min(x0, x1) - w, 0, Math.max(x0, x1) + w, 0, [[0, CACT[3]], [0.4, CACT[2]], [1, CACT[0]]]);
        g.beginPath(); g.moveTo(x0 - w, y0); g.lineTo(x1 - w, y1 + w); g.arc(x1, y1 + w, w, Math.PI, 0); g.lineTo(x0 + w, y0); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(20,40,16,0.5)'; g.lineWidth = 1;
        for (const k of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x0 + k * w * 1.4, y0); g.lineTo(x1 + k * w * 1.4, y1 + w * 0.6); g.stroke(); }
      };
      const arms = v === 0 ? [[-1, 0.52, 0.22], [1, 0.4, 0.3]] : [[1, 0.5, 0.25]];
      for (const [s, at, up] of arms) {
        const y0 = baseY - (baseY - top) * at, x0 = cx + s * 8, ex = cx + s * 22;
        g.fillStyle = CACT[2]; g.beginPath(); taper(g, cx, y0 + 6, x0 + s * 6, y0 + 4, ex, y0 - 4, 11, 10); g.fill();
        col(ex, y0, ex, y0 - (baseY - top) * up - 6, 6);
      }
      col(cx, baseY + 1, cx, top, 8.5);
      spines(g, cx, (baseY + top) / 2, 8, rand, 30);
      if (v === 0) for (let k = 0; k < 4; k++) { g.fillStyle = '#f2eedc'; g.beginPath(); circle(g, cx - 4 + k * 2.6, top + 2, 2); g.fill(); }
    }, 2.2);
  });
}
// agave: a rosette of thick, pointed, blue-grey leaves (v 1: a flower spike)
function agave(v) {
  const rand = rng(42000 + v * 23);
  const stops = ['#2f4a44', '#466a60', '#628a7c', '#86ab98', '#b2cdbb'];
  return sprite(1.4, v ? 2.4 : 1.1, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 6;
    P.layer((g) => groundShadow(g, cx, baseY, 22, 5, 0.35), 0);
    if (v) P.layer((g) => {
      g.fillStyle = '#7a7a3a'; g.beginPath(); taper(g, cx, baseY - 14, cx + 3, (baseY + 14) / 2, cx + 5, 14, 5, 2.5); g.fill();
      for (let k = 0; k < 6; k++) { const y = 18 + k * 10, s = k & 1 ? 1 : -1; g.beginPath(); taper(g, cx + 4, y, cx + 4 + s * 6, y - 2, cx + 4 + s * 12, y - 5, 2, 1); g.fill(); g.fillStyle = '#d8c040'; g.beginPath(); circle(g, cx + 4 + s * 12, y - 6, 3.4); g.fill(); g.fillStyle = '#7a7a3a'; }
    }, 1.6);
    P.layer((g) => {
      const n = 13, L = [];
      for (let i = 0; i < n; i++) { const a = Math.PI * (1.02 + (i / (n - 1)) * 0.96) + (rand() - 0.5) * 0.1; L.push({ a, l: 26 + rand() * 8 - Math.abs(Math.cos(a)) * 4, back: Math.abs(Math.cos(a)) < 0.5 }); }
      L.sort((p, q) => (q.back ? 1 : 0) - (p.back ? 1 : 0) || Math.abs(Math.cos(q.a)) - Math.abs(Math.cos(p.a)));
      for (const f of L) {
        const x1 = cx + Math.cos(f.a) * f.l * 1.1, y1 = baseY - 4 + Math.sin(f.a) * f.l * 0.9;
        const t = clamp01(0.55 - Math.cos(f.a) * 0.3 + (f.back ? -0.15 : 0.05));
        g.fillStyle = ramp(stops, t); g.beginPath(); leaf(g, cx, baseY - 3, x1, y1, 5, Math.cos(f.a) * 2); g.fill();
        g.strokeStyle = ramp(stops, t - 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx, baseY - 3); g.lineTo(x1, y1); g.stroke();
        g.fillStyle = '#4a2a1c'; g.beginPath(); circle(g, x1, y1, 0.9); g.fill();
      }
    }, 1.8);
  });
}
// banana / wild plantain: pseudostems with huge paddle leaves (torn edges, pale midrib), v 2: heliconia flowers
function banana(v) {
  const rand = rng(43500 + v * 29);
  const stops = ['#1d3a14', '#2c561c', '#417a26', '#5d9a32', '#86bb4c'];
  return sprite(1.9, 2.2, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 6;
    P.layer((g) => groundShadow(g, cx, baseY, 26, 6, 0.35), 0);
    const stems = v === 1 ? [[-10, 0.7], [8, 0.85], [0, 1]] : [[-6, 0.8], [7, 1]];
    const tops = [];
    P.layer((g) => {
      for (const [dx, k] of stems) {
        const h = (H - 40) * 0.5 * k, x1 = cx + dx * 1.4, y1 = baseY - h;
        g.fillStyle = lin(g, cx + dx - 5, 0, cx + dx + 5, 0, [[0, '#9aa45a'], [0.5, '#6f7c38'], [1, '#4a5424']]);
        g.beginPath(); taper(g, cx + dx, baseY + 1, cx + dx * 1.2, baseY - h * 0.5, x1, y1, 9, 6); g.fill();
        g.strokeStyle = 'rgba(60,50,20,0.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + dx - 2, baseY - 4); g.lineTo(x1 - 1, y1 + 6); g.stroke();
        tops.push([x1, y1]);
      }
    }, 2);
    P.layer((g) => {
      // leaves: long ovals arching out and drooping, back ones darker
      const L = [];
      for (const [x, y] of tops) for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.66 + (rand() - 0.5) * 0.25; L.push({ x, y, a, l: 46 + rand() * 16 }); }
      L.sort((p, q) => Math.abs(Math.cos(q.a)) - Math.abs(Math.cos(p.a)));
      for (const f of L) {
        const ex = f.x + Math.cos(f.a) * f.l * 1.15, ey = f.y + Math.sin(f.a) * f.l * 0.6 + Math.abs(Math.cos(f.a)) * f.l * 0.35;
        const t = clamp01(0.5 - Math.cos(f.a) * 0.25 + (rand() - 0.5) * 0.2);
        g.fillStyle = ramp(stops, t); g.beginPath(); leaf(g, f.x, f.y, ex, ey, 9 + rand() * 3, Math.cos(f.a) * 5); g.fill();
        // torn edges: a few notches across the blade
        g.strokeStyle = ramp(stops, t - 0.3); g.lineWidth = 1;
        for (let k = 0; k < 3; k++) { const q = 0.35 + k * 0.2, px = f.x + (ex - f.x) * q, py = f.y + (ey - f.y) * q; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(f.a) * 7, py - Math.cos(f.a) * 4 + 2); g.stroke(); }
        g.strokeStyle = 'rgba(230,240,180,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(f.x, f.y); g.quadraticCurveTo((f.x + ex) / 2 + Math.cos(f.a) * 3, (f.y + ey) / 2 - 3, ex, ey); g.stroke();
      }
      if (v === 2) for (const [x, y] of tops) for (let k = 0; k < 4; k++) { const yy = y + 8 + k * 7, s = k & 1 ? 1 : -1; g.fillStyle = k & 1 ? '#f0b020' : '#d83a24'; g.beginPath(); leaf(g, x, yy, x + s * 9, yy - 4, 2.8, s); g.fill(); }
      if (v === 0) { const [x, y] = tops[0]; g.fillStyle = '#5e7a28'; for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(x - 6 + (k % 3) * 4, y + 12 + (k >> 1) * 4, 2.2, 4, -0.4, 0, TAU); g.fill(); } g.fillStyle = '#6a2a3a'; g.beginPath(); g.ellipse(x - 2, y + 28, 3, 5, 0, 0, TAU); g.fill(); }
    }, 1.6, 'rgba(14,30,10,0.75)');
  });
}
// sagebrush / creosote: a round, twiggy, grey-green desert shrub (v 2: in yellow bloom)
function shrubDesert(v) {
  const rand = rng(43000 + v * 29);
  const pal = [{ deep: '#3a4234', dark: '#535d4a', mid: '#6f7a62', light: '#8f9a7e', high: '#b2bba0' },
    { deep: '#363f26', dark: '#4c5932', mid: '#66743f', light: '#84934e', high: '#a6b26a' },
    { deep: '#3d4429', dark: '#565f35', mid: '#727c43', light: '#919a52', high: '#b4b86b' }][v % 3];
  return sprite(1.2, 1.0, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 6;
    P.layer((g) => groundShadow(g, cx, baseY, 18, 4, 0.35), 0);
    P.layer((g) => {
      g.strokeStyle = '#5a4a38'; g.lineWidth = 1.4;
      for (let i = 0; i < 7; i++) { const u = (i / 6 - 0.5) * 2; g.beginPath(); g.moveTo(cx + u * 3, baseY); g.quadraticCurveTo(cx + u * 10, baseY - 14, cx + u * 20, baseY - 24 - rand() * 8); g.stroke(); }
    }, 1.2);
    P.layer((g) => {
      const lumps = [];
      for (let i = 0; i < 9; i++) { const a = Math.PI * (1 + rand()), d = 0.3 + rand() * 0.7; lumps.push(mkLump(cx + Math.cos(a) * 20 * d, baseY - 16 + Math.sin(a) * 14 * d, 7 + rand() * 3, rand, 0.5)); }
      drawFoliage(g, lumps, pal, rand, { cx, cy: baseY - 18, R: 24, RY: 16, marks: 2.2, sprigs: 2.6, drop: 0.3 });
      if (v === 2) for (let i = 0; i < 18; i++) { g.fillStyle = i & 1 ? '#e8c838' : '#f4dc60'; g.beginPath(); circle(g, cx + (rand() - 0.5) * 40, baseY - 10 - rand() * 22, 1.3); g.fill(); }
    }, 1.6);
  });
}
// dead bush / tumbleweed: a tangle of dry grey twigs
function deadBush(v) {
  const rand = rng(44000 + v * 31);
  return sprite(1.1, 0.95, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 6;
    P.layer((g) => groundShadow(g, cx, baseY, 15, 3.5, 0.3), 0);
    P.layer((g) => {
      g.lineCap = 'round';
      const grow = (x, y, a, l, w, d) => {
        const x1 = x + Math.cos(a) * l, y1 = y + Math.sin(a) * l;
        g.strokeStyle = d > 2 ? '#7a6a58' : '#9c8c78'; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x1) / 2 + (rand() - 0.5) * 4, (y + y1) / 2, x1, y1); g.stroke();
        if (d <= 0) return;
        grow(x1, y1, a - 0.4 - rand() * 0.3, l * 0.72, w * 0.7, d - 1);
        grow(x1, y1, a + 0.4 + rand() * 0.3, l * 0.72, w * 0.7, d - 1);
      };
      for (let i = 0; i < 5; i++) grow(cx + (i - 2) * 2, baseY, -Math.PI / 2 + (i - 2) * 0.42 + (rand() - 0.5) * 0.2, 12 + rand() * 4, 2.2, v ? 3 : 4);
    }, 1);
  });
}
// tundra shrub: low dwarf willow / bilberry mat with small leaves (v 1: with berries)
function tundraShrub(v) {
  const rand = rng(45000 + v * 37);
  const pal = [{ deep: '#2d3a1c', dark: '#425426', mid: '#5b7031', light: '#778c3e', high: '#98aa57' },
    { deep: '#2c381e', dark: '#40502a', mid: '#586b35', light: '#728642', high: '#94a45d' },
    { deep: '#3a3a1c', dark: '#545424', mid: '#70702e', light: '#8f8a3a', high: '#b0a854' }][v % 3];
  return sprite(1.2, 0.75, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 5;
    P.layer((g) => groundShadow(g, cx, baseY, 20, 4, 0.3), 0);
    P.layer((g) => {
      g.strokeStyle = '#5a4434'; g.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) { const u = (i / 5 - 0.5) * 2; g.beginPath(); g.moveTo(cx + u * 4, baseY); g.quadraticCurveTo(cx + u * 14, baseY - 6, cx + u * 24, baseY - 8 - rand() * 4); g.stroke(); }
      const lumps = [];
      for (let i = 0; i < 9; i++) lumps.push(mkLump(cx + (rand() - 0.5) * 44, baseY - 8 - rand() * 10, 6 + rand() * 3, rand, 0.5));
      drawFoliage(g, lumps, pal, rand, { cx, cy: baseY - 12, R: 26, RY: 10, marks: 2.4, sprigs: 2.2, drop: 0.3 });
      if (v === 1) for (let i = 0; i < 9; i++) { const x = cx + (rand() - 0.5) * 40, y = baseY - 6 - rand() * 12; g.fillStyle = '#2a3460'; g.beginPath(); circle(g, x, y, 1.6); g.fill(); g.fillStyle = '#8a9ac8'; g.beginPath(); circle(g, x - 0.5, y - 0.5, 0.6); g.fill(); }
    }, 1.6);
  });
}
// tussock / bunchgrass: a dense fountain of fine blades with seed heads
function grassClump(rand, cx, y, n, h, w, stops, heads, spread = 1) {
  return (g) => {
    const bl = [];
    for (let i = 0; i < n; i++) { const u = (i / (n - 1) - 0.5) * 2 + (rand() - 0.5) * 0.15; bl.push({ x: cx + u * w * 0.4, h: h * (0.65 + rand() * 0.45) * (1 - Math.abs(u) * 0.25), dx: u * w * spread + (rand() - 0.5) * 6, t: rand() }); }
    bl.sort((a, b) => b.h - a.h);
    for (const b of bl) {
      g.fillStyle = lin(g, 0, y, 0, y - b.h, [[0, stops[0]], [0.35, ramp(stops, 0.35 + b.t * 0.3)], [1, ramp(stops, 0.7 + b.t * 0.3)]]);
      g.beginPath(); blade(g, b.x, y, b.h, b.dx, 2 + b.t); g.fill();
    }
    if (heads) for (let i = 0; i < heads; i++) {
      const u = (rand() - 0.5) * 2, x0 = cx + u * w * 0.2, hh = h * (1 + rand() * 0.3), x1 = x0 + u * w * 0.7;
      g.strokeStyle = ramp(stops, 0.55); g.lineWidth = 0.9; g.beginPath(); g.moveTo(x0, y - 4); g.quadraticCurveTo(x0 + u * 4, y - hh * 0.7, x1, y - hh); g.stroke();
      for (let k = 0; k < 5; k++) { g.fillStyle = ramp(stops, 0.8 + (k & 1) * 0.15); g.beginPath(); g.ellipse(x1 + u * k * 0.8, y - hh + k * 2.2, 1.1, 2.4, u * 0.5, 0, TAU); g.fill(); }
    }
  };
}
function tussock(v) {
  const rand = rng(46000 + v * 41);
  const stops = [['#4a5222', '#6f7a32', '#99a04a', '#c4be6e', '#e2d896'], ['#55542a', '#7f7838', '#a99a4e', '#cdb870', '#e9d798'], ['#43502a', '#62743a', '#879a4e', '#adbc6c', '#d0d890']][v % 3];
  return sprite(1.1, 1.0, (g, P) => {
    const cx = P.W / 2, y = P.H - 5;
    P.layer((g) => groundShadow(g, cx, y, 15, 3.6, 0.32), 0);
    P.layer(grassClump(rand, cx, y, 30, 44, 34, stops, 5), 1.2, 'rgba(46,40,14,0.7)');
  });
}
function duneGrass(v) {
  const rand = rng(47000 + v * 43);
  const stops = ['#4f6236', '#6f8848', '#90a860', '#b4c27e', '#d8dca2'];
  return sprite(1.1, 1.05, (g, P) => {
    const cx = P.W / 2, y = P.H - 5;
    P.layer((g) => { groundShadow(g, cx, y, 14, 3.5, 0.28); g.strokeStyle = 'rgba(160,140,100,0.5)'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(cx + 6, y + 1, 10 + i * 4, 2 + i, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); } }, 0);
    P.layer(grassClump(rand, cx, y, 18, 52, 30, stops, v ? 3 : 0, 1.4), 1.1, 'rgba(40,46,20,0.7)');
  });
}
function papyrus(v) {
  const rand = rng(48000 + v * 47);
  return sprite(1.3, v ? 2.0 : 2.4, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, y = H - 5;
    P.layer((g) => {
      const n = 8 + v * 2;
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1) - 0.5) * 2, h = (H - 30) * (0.7 + rand() * 0.3), x1 = cx + u * 22 + (rand() - 0.5) * 6, y1 = y - h;
        g.strokeStyle = mixc('#5a7a2a', '#86a43e', rand()); g.lineWidth = 2; g.beginPath(); g.moveTo(cx + u * 5, y); g.quadraticCurveTo(cx + u * 10, y - h * 0.5, x1, y1); g.stroke();
        // the umbrella head: a burst of thin threads
        for (let k = 0; k < 16; k++) { const a = Math.PI * (1.05 + k / 15 * 0.9) + (rand() - 0.5) * 0.1, l = 9 + rand() * 4; g.strokeStyle = k & 1 ? '#8fb048' : '#6f9036'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(x1 + Math.cos(a) * l * 0.6, y1 + Math.sin(a) * l * 0.6 - 2, x1 + Math.cos(a) * l, y1 + Math.sin(a) * l * 0.5 + 3); g.stroke(); }
      }
      for (let i = 0; i < 6; i++) { g.fillStyle = '#4a6a26'; g.beginPath(); blade(g, cx + (i - 2.5) * 4, y, 12 + rand() * 6, (i - 2.5) * 3, 3); g.fill(); }
    }, 1, 'rgba(26,36,12,0.75)');
  });
}
// lichen-covered boulder (grey, orange and pale green crusts) and a termite cathedral
function lichenRock(v) {
  const rand = rng(49000 + v * 53);
  const sz = [[26, 18], [20, 15], [30, 16]][v % 3];
  return sprite(1.2, 0.95, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 7, [rx, ry] = sz;
    P.layer((g) => groundShadow(g, cx + 2, baseY, rx * 1.05, 4, 0.4), 0);
    P.layer((g) => {
      const pts = blobPts(cx, baseY - ry, rx, ry, rand, 9, 0.14);
      g.beginPath(); smoothClosed(g, pts); g.fillStyle = lin(g, cx - rx, baseY - ry * 2, cx + rx, baseY, [[0, '#a9a69c'], [0.5, '#858278'], [1, '#55534c']]); g.fill();
      g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
      g.fillStyle = 'rgba(255,255,245,0.2)'; g.beginPath(); g.ellipse(cx - rx * 0.3, baseY - ry * 1.5, rx * 0.5, ry * 0.4, -0.3, 0, TAU); g.fill();
      const cols = ['#d9862c', '#e8b23a', '#b8c08a', '#d4d2a8', '#c06a2a'];
      for (let i = 0; i < 26; i++) { g.fillStyle = cols[(i + v) % cols.length]; g.globalAlpha = 0.75; g.beginPath(); smoothClosed(g, blobPts(cx + (rand() - 0.5) * rx * 1.7, baseY - ry * 2 + rand() * ry * 1.8, 2 + rand() * 4, 1.5 + rand() * 3, rand, 7, 0.3)); g.fill(); }
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(40,36,30,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - rx * 0.2, baseY - ry * 1.9); g.lineTo(cx + rx * 0.1, baseY - ry * 0.8); g.lineTo(cx + rx * 0.4, baseY - ry * 0.5); g.stroke();
      g.restore();
    });
  });
}
// a sandstone boulder of the deserts: rounded by the wind, red-orange beds, dark varnish, a pale sand skirt
function desertRock(v) {
  const rand = rng(49500 + v * 57);
  const sz = [[24, 17], [18, 14], [30, 15]][v % 3];
  return sprite(1.2, 0.95, (g, P) => {
    const cx = P.W / 2, baseY = P.H - 7, [rx, ry] = sz;
    P.layer((g) => { groundShadow(g, cx + 2, baseY, rx * 1.05, 4, 0.4); g.fillStyle = 'rgba(214,170,120,0.5)'; g.beginPath(); g.ellipse(cx - 3, baseY + 1, rx * 1.1, 3.4, 0, 0, TAU); g.fill(); }, 0);
    P.layer((g) => {
      const pts = blobPts(cx, baseY - ry, rx, ry, rand, 9, 0.12);
      g.beginPath(); smoothClosed(g, pts); g.fillStyle = lin(g, cx - rx, baseY - ry * 2, cx + rx, baseY, [[0, '#e0a070'], [0.5, '#b86a40'], [1, '#6e3a24']]); g.fill();
      g.save(); g.beginPath(); smoothClosed(g, pts); g.clip();
      for (let k = 0; k < 5; k++) { const y = baseY - ry * 2 + (k + 0.5) * ry * 0.42; g.strokeStyle = k & 1 ? 'rgba(255,220,180,0.35)' : 'rgba(90,40,24,0.35)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - rx, y + (rand() - 0.5) * 2); g.quadraticCurveTo(cx, y - 2 + (rand() - 0.5) * 3, cx + rx, y + (rand() - 0.5) * 2); g.stroke(); }
      for (let k = 0; k < 4; k++) { const x = cx - rx * 0.6 + rand() * rx * 1.2; g.fillStyle = 'rgba(60,32,22,0.35)'; g.beginPath(); g.ellipse(x, baseY - ry * 0.9, 1.6, ry * 0.7, 0, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(255,240,220,0.22)'; g.beginPath(); g.ellipse(cx - rx * 0.3, baseY - ry * 1.5, rx * 0.5, ry * 0.35, -0.3, 0, TAU); g.fill();
      g.restore();
    });
  });
}
function termiteMound(v) {
  const rand = rng(50000 + v * 59);
  return sprite(1.3, v ? 1.7 : 2.2, (g, P) => {
    const W = P.W, H = P.H, cx = W / 2, baseY = H - 6, top = 10 + v * 12;
    P.layer((g) => groundShadow(g, cx, baseY, 22, 5, 0.35), 0);
    P.layer((g) => {
      const spires = [[0, top, 13], [-12, top + 22, 9], [11, top + 30, 8], [-4, top + 10, 8]];
      g.fillStyle = lin(g, cx - 24, 0, cx + 24, 0, [[0, '#c88a5a'], [0.5, '#a86a42'], [1, '#6e4228']]);
      g.beginPath(); g.moveTo(cx - 26, baseY + 1); g.quadraticCurveTo(cx - 20, baseY - 20, cx - 14, baseY - 30); g.lineTo(cx + 14, baseY - 30); g.quadraticCurveTo(cx + 22, baseY - 18, cx + 26, baseY + 1); g.closePath(); g.fill();
      for (const [dx, ty, w] of spires) { g.beginPath(); g.moveTo(cx + dx - w, baseY - 20); g.bezierCurveTo(cx + dx - w * 0.9, baseY - 50, cx + dx - w * 0.3, ty + 14, cx + dx + (rand() - 0.5) * 3, ty); g.bezierCurveTo(cx + dx + w * 0.4, ty + 16, cx + dx + w, baseY - 50, cx + dx + w, baseY - 20); g.closePath(); g.fill(); }
      g.strokeStyle = 'rgba(70,40,22,0.45)'; g.lineWidth = 1;
      for (let i = 0; i < 14; i++) { const x = cx + (rand() - 0.5) * 36, y = baseY - 6 - rand() * (baseY - top - 10); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - 5, x + (rand() - 0.5) * 3, y - 10); g.stroke(); }
      g.fillStyle = 'rgba(255,230,190,0.22)'; for (let i = 0; i < 8; i++) { g.beginPath(); g.ellipse(cx - 10 + rand() * 10, baseY - 10 - rand() * 40, 1.6, 4, 0, 0, TAU); g.fill(); }
    });
  });
}

// ---------------------------------------------------------------- DECOR (ground details of the new biomes)
function snowtuft(v) {
  const rand = rng(51000 + v * 61);
  return sprite(0.7, 0.55, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      g.fillStyle = '#e8eef6'; g.beginPath(); g.ellipse(cx, y - 2, 16, 5, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(150,170,200,0.4)'; g.beginPath(); g.ellipse(cx + 2, y, 15, 3, 0, 0, Math.PI); g.fill();
      for (let i = 0; i < 9; i++) { const u = (i / 8 - 0.5) * 2; g.fillStyle = mixc('#8a8a5a', '#c8bc84', rand()); g.beginPath(); blade(g, cx + u * 8, y - 3, 10 + rand() * 9, u * 8, 1.8); g.fill(); }
      g.fillStyle = '#f4f7fb'; for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(cx + (rand() - 0.5) * 14, y - 4 - rand() * 2, 3 + rand() * 2, 1.6, 0, 0, TAU); g.fill(); }
    }, 1, 'rgba(60,70,90,0.5)');
  });
}
function cottongrass(v) {
  const rand = rng(52000 + v * 67);
  return sprite(0.7, 0.85, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      for (let i = 0; i < 8; i++) { const u = (i / 7 - 0.5) * 2; g.fillStyle = mixc('#5a7030', '#8a9a48', rand()); g.beginPath(); blade(g, cx + u * 5, y, 10 + rand() * 8, u * 6, 1.8); g.fill(); }
      for (let i = 0; i < 4 + v; i++) {
        const u = (rand() - 0.5) * 2, h = 26 + rand() * 14, x1 = cx + u * 10;
        g.strokeStyle = '#6a7038'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(cx + u * 3, y - 2); g.quadraticCurveTo(cx + u * 6, y - h * 0.6, x1, y - h); g.stroke();
        g.fillStyle = '#fbfaf2'; g.beginPath(); smoothClosed(g, blobPts(x1, y - h - 2, 4, 3.6, rand, 8, 0.25)); g.fill();
        g.fillStyle = 'rgba(200,200,190,0.6)'; g.beginPath(); g.ellipse(x1 + 1, y - h - 0.5, 2.6, 1.6, 0, 0, Math.PI); g.fill();
      }
    }, 0.9, 'rgba(40,46,24,0.6)');
  });
}
// savanna grass: tall golden tufts with feathery heads (dry most of the year)
function savgrass(v) {
  const rand = rng(53000 + v * 71);
  const stops = [['#6a5a26', '#957a36', '#bf9c4a', '#dcbc68', '#efda96'], ['#5e5a26', '#857e38', '#ad9f4c', '#cebd6a', '#e8da94'], ['#5a5e2c', '#7c8a3c', '#a2ac52', '#c4c66e', '#e0de98'], ['#6a5a2c', '#94783c', '#ba9850', '#d6b86e', '#ecd69a']][v % 4];
  return sprite(0.8, 0.95, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer(grassClump(rand, cx, y, 16, 40, 24, stops, 3, 1.1), 0.9, 'rgba(60,46,16,0.6)');
  });
}
// big tropical leaves (monstera / elephant ear / heliconia) for the jungle floor
function jungleplant(v) {
  const rand = rng(54000 + v * 73);
  const stops = ['#0f2a12', '#1a421c', '#285e28', '#3a7c34', '#58a048'];
  return sprite(1.0, 0.9, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      const n = 5 + (v & 1);
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (1.1 + (i / (n - 1)) * 0.8) + (rand() - 0.5) * 0.2, L = 22 + rand() * 8;
        const x1 = cx + Math.cos(a) * L * 1.2, y1 = y - 8 + Math.sin(a) * L * 0.9;
        g.strokeStyle = '#3a6a28'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo((cx + x1) / 2, y1 - 4, x1, y1); g.stroke();
        const t = clamp01(0.55 - Math.cos(a) * 0.25 + (rand() - 0.5) * 0.2);
        g.fillStyle = ramp(stops, t); g.beginPath(); leaf(g, x1, y1, x1 + Math.cos(a) * 14, y1 + Math.sin(a) * 10 + 6, 8, Math.cos(a) * 2); g.fill();
        g.strokeStyle = ramp(stops, t + 0.25); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(a) * 13, y1 + Math.sin(a) * 9 + 5); g.stroke();
        if (v >= 2) { g.fillStyle = ramp(stops, 0.08); for (let k = 0; k < 3; k++) { const q = 0.3 + k * 0.2; g.beginPath(); g.ellipse(x1 + Math.cos(a) * 14 * q + 3, y1 + (Math.sin(a) * 10 + 6) * q, 1.2, 2.4, a, 0, TAU); g.fill(); } }
      }
      if (v === 3) for (let k = 0; k < 3; k++) { const x = cx - 4 + k * 5, yy = y - 26 - k * 5; g.fillStyle = k & 1 ? '#e8a020' : '#d43a2a'; g.beginPath(); leaf(g, x, yy + 8, x + 6, yy, 2.6, 1); g.fill(); }
    }, 1.2, 'rgba(10,26,10,0.7)');
  });
}
// mangrove breathing roots poking out of the shallow water
function pneumato(v) {
  const rand = rng(55000 + v * 79);
  return sprite(0.7, 0.4, (g, P) => {
    const cx = P.W / 2, y = P.H - 4;
    P.layer((g) => {
      for (let i = 0; i < 9; i++) { const x = cx + (rand() - 0.5) * 34, yy = y - rand() * 6, h = 6 + rand() * 7; g.fillStyle = mixc('#5a4a3a', '#8a7a62', rand()); g.beginPath(); taper(g, x, yy, x + (rand() - 0.5) * 2, yy - h * 0.5, x + (rand() - 0.5) * 3, yy - h, 2.6, 1); g.fill(); }
    }, 0.8, 'rgba(30,24,16,0.6)');
  });
}
// flat details (drawn on the ground, no outline wobble): crusts, wrack, coral, cinders, ripples, cracks
function flatSprite(w, h, fn) { return sprite(w, h, (g, P) => { fn(g, P.W / 2, P.H / 2, P); }); }
function lichenPatch(v) {
  const rand = rng(56000 + v * 83);
  const cols = [['#a87a44', '#b8a070', '#8a7a5a'], ['#a8ae86', '#c4c2a0', '#8e9470'], ['#8c9668', '#b4b892', '#b08a50']][v % 3];
  return flatSprite(0.9, 0.5, (g, cx, cy) => {
    for (let i = 0; i < 12; i++) { g.fillStyle = cols[i % 3]; g.globalAlpha = 0.35 + rand() * 0.25; g.beginPath(); smoothClosed(g, blobPts(cx + (rand() - 0.5) * 40, cy + (rand() - 0.5) * 18, 2 + rand() * 4, 1.5 + rand() * 2.5, rand, 8, 0.35)); g.fill(); }
    g.globalAlpha = 1;
  });
}
function saltcrust(v) {
  const rand = rng(57000 + v * 89);
  return flatSprite(0.9, 0.55, (g, cx, cy) => {
    // raised salt crystals: white blocky clusters with a grey shadow side
    for (let i = 0; i < 16 + v * 4; i++) {
      const x = cx + (rand() - 0.5) * 44, y = cy + (rand() - 0.5) * 22, s = 1.6 + rand() * 3;
      g.fillStyle = 'rgba(150,145,135,0.55)'; g.beginPath(); g.ellipse(x + 1, y + 1.2, s, s * 0.6, 0, 0, TAU); g.fill();
      g.fillStyle = rand() < 0.5 ? '#ffffff' : '#f0eee8'; g.beginPath(); g.moveTo(x - s, y); g.lineTo(x - s * 0.3, y - s * 0.8); g.lineTo(x + s * 0.8, y - s * 0.4); g.lineTo(x + s * 0.6, y + s * 0.4); g.lineTo(x - s * 0.4, y + s * 0.5); g.closePath(); g.fill();
    }
  });
}
function seaweed(v) {
  const rand = rng(58000 + v * 97);
  return flatSprite(1.0, 0.5, (g, cx, cy) => {
    const cols = ['#3a4a1c', '#55602a', '#6a5a24', '#2e3a18'];
    for (let i = 0; i < 7 + v * 2; i++) {
      const x = cx + (rand() - 0.5) * 50, y = cy + (rand() - 0.5) * 16, a = (rand() - 0.5) * 0.8, L = 10 + rand() * 12;
      g.strokeStyle = cols[i % 4]; g.lineWidth = 2.2 + rand() * 1.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + L * 0.3, y - 4, x + L * 0.6, y + 4, x + Math.cos(a) * L, y + Math.sin(a) * L * 0.4); g.stroke();
      g.fillStyle = '#7a6a2c'; for (let k = 0; k < 3; k++) { g.beginPath(); circle(g, x + L * (0.2 + k * 0.25), y + (k & 1 ? 1 : -1), 1.3); g.fill(); }
    }
  });
}
function coral(v) {
  const rand = rng(59000 + v * 101);
  const col = [['#e07a6a', '#f4a08a'], ['#d8b04a', '#f0d070'], ['#a86ac0', '#c890d8'], ['#e88a4a', '#f8b070']][v % 4];
  return flatSprite(0.8, 0.6, (g, cx, cy) => {
    if (v % 2) for (let i = 0; i < 5; i++) { const x = cx + (rand() - 0.5) * 30, y = cy + (rand() - 0.5) * 14; g.fillStyle = col[0]; g.beginPath(); smoothClosed(g, blobPts(x, y, 6 + rand() * 4, 4 + rand() * 3, rand, 9, 0.2)); g.fill(); g.strokeStyle = col[1]; g.lineWidth = 0.8; for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(x, y, 4 - k, 2.6 - k * 0.6, 0, 0, TAU); g.stroke(); } }
    else { g.lineCap = 'round'; for (let i = 0; i < 6; i++) { const x = cx + (rand() - 0.5) * 24, y = cy + 6; const grow = (x0, y0, a, l, d) => { const x1 = x0 + Math.cos(a) * l, y1 = y0 + Math.sin(a) * l * 0.6; g.strokeStyle = d > 1 ? col[0] : col[1]; g.lineWidth = 1 + d; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); if (d > 0) { grow(x1, y1, a - 0.5, l * 0.7, d - 1); grow(x1, y1, a + 0.5, l * 0.7, d - 1); } }; grow(x, y, -Math.PI / 2 + (rand() - 0.5), 8, 2); } }
  });
}
function ashDecor(v) {
  const rand = rng(60000 + v * 103);
  return flatSprite(0.8, 0.45, (g, cx, cy) => {
    for (let i = 0; i < 10 + v * 3; i++) {
      const x = cx + (rand() - 0.5) * 40, y = cy + (rand() - 0.5) * 16, r = 1.2 + rand() * 2.6, t = rand();
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x + 0.8, y + 1, r, r * 0.6, 0, 0, TAU); g.fill();
      g.fillStyle = t < 0.5 ? '#2a2422' : t < 0.8 ? '#5a3424' : '#a8a49a'; g.beginPath(); smoothClosed(g, blobPts(x, y, r, r * 0.75, rand, 7, 0.2)); g.fill();
      if (t < 0.8) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); circle(g, x + r * 0.2, y, r * 0.25); g.fill(); }
    }
  });
}
function sandripple(v) {
  const rand = rng(61000 + v * 107);
  return flatSprite(1.4, 0.6, (g, cx, cy) => {
    for (let i = 0; i < 4; i++) {
      const y = cy - 10 + i * 6 + (rand() - 0.5) * 2, w = 36 - Math.abs(i - 1.5) * 6;
      g.strokeStyle = 'rgba(120,96,56,0.35)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx - w, y + 1); g.bezierCurveTo(cx - w * 0.4, y - 3, cx + w * 0.3, y + 4, cx + w, y); g.stroke();
      g.strokeStyle = 'rgba(255,244,214,0.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - w, y - 0.6); g.bezierCurveTo(cx - w * 0.4, y - 4.4, cx + w * 0.3, y + 2.6, cx + w, y - 1.4); g.stroke();
    }
  });
}
function crackedmud(v) {
  const rand = rng(62000 + v * 109);
  return flatSprite(1.1, 0.6, (g, cx, cy) => {
    // a cracked polygon crust: curled plates with dark gaps
    const pts = [];
    for (let i = 0; i < 9; i++) pts.push([cx + (rand() - 0.5) * 56, cy + (rand() - 0.5) * 26]);
    g.strokeStyle = 'rgba(50,34,22,0.55)'; g.lineWidth = 1.3; g.lineCap = 'round';
    for (const [x, y] of pts) {
      const n = 3 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU + rand() * 0.6, l = 6 + rand() * 7; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 2, y + Math.sin(a) * l * 0.25, x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5); g.stroke(); }
      g.fillStyle = 'rgba(255,236,200,0.18)'; g.beginPath(); g.ellipse(x - 2, y - 1, 3, 1.3, 0, 0, TAU); g.fill();
    }
  });
}

// ---------------------------------------------------------------- registration (lazy)
const TREE_FN = { tree_palm: palm, tree_acacia: acacia, tree_baobab: baobab, tree_jungle: jungle, tree_kapok: kapok, tree_olive: olive, tree_fern: treeFern,
  tree_mangrove: mangrove, tree_spruce: spruce, tree_larch: larch, tree_redwood: redwood, tree_cypress: cypress, tree_dwarf: dwarf, bamboo };
const PLANT_FN = { cactus, cactus_tall: cactusTall, agave, banana, shrub_desert: shrubDesert, dead_bush: deadBush, tundra_shrub: tundraShrub, tussock, dune_grass: duneGrass,
  papyrus, lichen_rock: lichenRock, termite_mound: termiteMound, desert_rock: desertRock };
const DECOR_FN = { snowtuft, cottongrass, savgrass, jungleplant, pneumato, lichen: lichenPatch, saltcrust, seaweed, coral, ash: ashDecor, sandripple, crackedmud };
// foot (px under the anchor) per plant group: the bushes / boulders anchor like their classic kinds
const PLANT_FOOT = { desert_rock: 7, banana: 6, cactus: 6, cactus_tall: 6, agave: 6, shrub_desert: 6, dead_bush: 6, tundra_shrub: 5, tussock: 5, dune_grass: 5, papyrus: 5, lichen_rock: 7, termite_mound: 6 };
const reg = (name, fn, foot, flat = false) => lazyDef(name, () => { const c = fn(); if (!flat) LAZY_DEFS.get(name).ay = 1 - foot / (c.origH || c.height); return c; }, 0.5, flat ? 0.5 : 1);
for (const grp in TREE_FN) {
  const e = PLANET_SPECIES[grp];
  for (let i = 0; i < e.n; i++) {
    reg(`${grp}_${i}`, () => TREE_FN[grp](i), FOOT);
    if (e.twin) reg(`${grp}_bare_${i}`, () => TREE_FN[grp](i, true), FOOT);
  }
}
for (const grp in PLANT_FN) for (let i = 0; i < PLANET_SPECIES[grp].n; i++) reg(`${grp}_${i}`, () => PLANT_FN[grp](i), PLANT_FOOT[grp]);
for (const t in DECOR_FN) for (let i = 0; i < PLANET_DECOR[t].n; i++) reg(`${t}_${i}`, () => DECOR_FN[t](i), 4, !!PLANET_DECOR[t].flat);

// painters for tools (the flora sheet): group → (variant, bare) => canvas
export const FLORA_PAINTERS = { ...TREE_FN, ...PLANT_FN, ...DECOR_FN };
