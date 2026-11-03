// "Gigante de Gelo" (ice giant, species 'giant'): the humanoid pawn rig drawn twice as big (art/compose.js PAWN_OV,
// scale 2) with a fixed look of agent H's options (heavy, tall, glacier-blue skin, bald, a frosted long beard, white fur
// over a sleeveless top, barefoot) and lazily painted overlays in the rig's boxes, like the winter walker's:
//   wk_armor_gi_{s,n,e}  body box (BW×BH, anchor at FEET): a carapace of glacier ice plates over the chest / back with
//                        icicles hanging from their edges, rawhide straps, a shaggy frozen fur loincloth
//   wk_ice_gi_{s,n,e}    body box: great ice crags growing out of the shoulders (and the spine from behind)
//   wk_face_gi_{s,e}     head box (HW×HH, anchor at NECK): a heavy brow ridge of ice, deep sockets, frost cracks, tusks
//   hat_gicrown_{s,n,e}  head box: a jagged crown of ice crystals on the skull
// The names follow art/look/turn.js kindOf (wk_armor_ / wk_ice_ → body, hat_ → hair, the others face decals), so the
// camera rotation repaints them in 3/4 like the walker's (paintDef). compose.js adds the glowing eyes (GIANT_EYES).
// Also here: the thrown ice rock (proj_ice_rock, lazy) — the giant's club (held_club_ice) and the rock in its hand
// (held_rock_ice) are baked with the gear (art/gear.js).

import { spritePxFast as spritePx, spritePx as spriteFull, rng, TAU, lin, circle, rgb, hex } from './paint.js';
import { BW, BH, FEET, HW, HH, NECK, HX, HY, bodyPath } from './pawns.js';
import { lazyDef, paintDef } from './lazyDefs.js';

const A = (c, a) => rgb(hex(c), a);
const DIRS = ['s', 'n', 'e'];

const BASE = {
  v: 1, build: 'heavy', height: 'tall', skin: '8fb1c7', head: 'square', ears: 'small', eyes: 'narrow', eyeC: 'c8fbff',
  brows: 'thick', nose: 'flat', mouth: 'frown', cheeks: 'cheekbones', age: 'old', marks: 'none', scar: 'none',
  paint: 'none', paintC: 'ece6da', hair: 'bald', hairC: 'dfeaf2', hairFx: 'none', hairC2: 'f2f8fb', beard: 'full', beardC: 'e3eff6',
  top: 'tank', topC: '4a4038', topC2: '5e5246', pattern: 'plain', over: 'none', overC: 'd9e2e8',
  bottom: 'shorts', botC: '6a5644', shoes: 'barefoot', shoeC: '2c3036',
};
export const GIANT_LOOKS = [
  Object.freeze({ ...BASE }),
  Object.freeze({ ...BASE, head: 'wide', skin: '9bbcd2', beard: 'mutton', brows: 'bushy', mouth: 'serious' }),
];
export function giantLook(p) {
  const s = String(p.id ?? p.nid ?? 0);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return GIANT_LOOKS[(h >>> 0) % GIANT_LOOKS.length];
}
// eye glow on the head canvas (tiles from the head anchor: [dx, lift]); deep under the brow
export const GIANT_EYES = { s: [[-6.1 / 64, (NECK - HY - 3.6) / 64], [6.1 / 64, (NECK - HY - 3.6) / 64]], e: [[9.6 / 64, (NECK - HY - 3.2) / 64]] };

const C = { ice: '#d6f3fd', iceM: '#99d6ee', iceD: '#4a93b6', iceDD: '#2b6688', rime: '#f2fbff', crack: 'rgba(36,84,118,0.7)',
  fur: '#dfe6ea', furM: '#b9c4cc', furD: '#7d8b96', strap: '#2a2019', strapL: '#5a4634', bone: '#d8d0bb' };

// ---------------- ice helpers ----------------
// a crystal shard from (bx, by) toward angle a: tapered, a dark facet, a bright edge
function shard(g, bx, by, a, len, w, rand, glow = 0) {
  const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
  const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
  g.fillStyle = lin(g, bx + nx, by + ny, bx - nx, by - ny, [[0, C.ice], [0.5, C.iceM], [1, C.iceD]]);
  g.beginPath(); g.moveTo(bx + nx, by + ny); g.lineTo(bx + nx * 0.6 + Math.cos(a) * len * 0.7, by + ny * 0.6 + Math.sin(a) * len * 0.7); g.lineTo(tx, ty);
  g.lineTo(bx - nx * 0.55 + Math.cos(a) * len * 0.64, by - ny * 0.55 + Math.sin(a) * len * 0.64); g.lineTo(bx - nx, by - ny); g.closePath(); g.fill();
  g.fillStyle = 'rgba(30,80,112,0.35)';
  g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.lineTo(bx - nx * 0.55 + Math.cos(a) * len * 0.64, by - ny * 0.55 + Math.sin(a) * len * 0.64); g.lineTo(bx - nx, by - ny); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(bx + nx * 0.35, by + ny * 0.35); g.lineTo(tx, ty); g.stroke();
  if (glow) { g.fillStyle = `rgba(190,250,255,${glow})`; g.beginPath(); circle(g, bx + Math.cos(a) * len * 0.4, by + Math.sin(a) * len * 0.4, w * 0.5); g.fill(); }
  void rand;
}
// a slab of glacier ice (polygon) with inner cracks, a rime rim and frost speckles
function slab(g, pts, rand, light = 0) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };
  path(); g.fillStyle = lin(g, x0, y0, x1 * 0.4 + x0 * 0.6, y1, [[0, light ? C.ice : C.iceM], [0.55, C.iceM], [1, C.iceD]]); g.fill();
  g.save(); path(); g.clip();
  g.fillStyle = 'rgba(24,70,104,0.28)'; g.fillRect(x0 + (x1 - x0) * 0.55, y0, x1 - x0, y1 - y0); // shaded facet
  g.strokeStyle = C.crack; g.lineWidth = 0.7;
  for (let i = 0; i < 3; i++) {
    let x = x0 + (x1 - x0) * (0.2 + rand() * 0.6), y = y0 + rand() * 3;
    g.beginPath(); g.moveTo(x, y);
    while (y < y1) { x += (rand() - 0.5) * 4; y += 2.5 + rand() * 3; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.6)'; for (let i = 0; i < 6; i++) { g.beginPath(); circle(g, x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 0.35 + rand() * 0.45); g.fill(); }
  g.restore();
  // rime on the upper rim
  g.strokeStyle = A(C.rime, 0.9); g.lineWidth = 1;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.stroke();
}
function icicles(g, x0, x1, y, n, len, rand) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * ((i + 0.5) / n) + (rand() - 0.5) * 1.2, L = len * (0.55 + rand() * 0.6), w = 1 + rand() * 0.6;
    g.fillStyle = lin(g, x - w, y, x + w, y, [[0, C.ice], [1, C.iceD]]);
    g.beginPath(); g.moveTo(x - w, y - 0.5); g.lineTo(x + w, y - 0.5); g.lineTo(x + 0.2, y + L); g.closePath(); g.fill();
  }
}
// shaggy frozen fur: a flap narrowing down from (x0..x1, y0) to its ragged hem near y1, tufts over it
function fur(g, x0, x1, y0, y1, rand) {
  const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2;
  g.fillStyle = C.furD;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0);
  for (let k = 0; k <= 8; k++) { const u = 1 - k / 8, x = cx + (u * 2 - 1) * hw * 0.62, y = y1 - 3 + (k & 1 ? -2.5 : 0) - Math.abs(u * 2 - 1) * 3; g.lineTo(x, y); }
  g.closePath(); g.fill();
  for (let x = x0 + 1; x < x1 - 1; x += 2.2) {
    const u = (x - cx) / hw, yb = y0 + (y1 - y0) * (1 - Math.abs(u) * 0.45) - 3;
    const L = (yb - y0) * (0.8 + rand() * 0.3), c = rand();
    g.fillStyle = c < 0.33 ? C.fur : c < 0.7 ? C.furM : C.furD;
    g.beginPath(); g.moveTo(x - 0.6, y0 + rand() * 2); g.quadraticCurveTo(x + 1.4, y0 + L * 0.6, x + 0.6 + (rand() - 0.5), y0 + L); g.lineTo(x + 2.4, y0 + rand() * 2); g.closePath(); g.fill();
    if (rand() < 0.4) { g.fillStyle = A(C.rime, 0.8); g.beginPath(); circle(g, x + 0.8, y0 + L - 0.6, 0.6); g.fill(); }
  }
}
function strap(g, pts, w) {
  g.strokeStyle = C.strap; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0], pts[1]); g.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]); g.stroke();
  g.strokeStyle = A(C.strapL, 0.8); g.lineWidth = 0.6; g.beginPath(); g.moveTo(pts[0], pts[1] - w * 0.35); g.quadraticCurveTo(pts[2], pts[3] - w * 0.35, pts[4], pts[5] - w * 0.35); g.stroke();
}

// ---------------- the carapace (body box) ----------------
function giantArmor(g, d, rand) {
  // a fur loincloth hanging from the belt (front / back flap; from the side a narrower one), over the leg wraps
  g.save(); g.beginPath(); bodyPath(g, d); g.clip();
  if (d === 'e') fur(g, 27, 41, 37, 50, rand); else fur(g, 19, 37, 37, 50, rand);
  g.restore();
  if (d === 's') {
    slab(g, [[9, 13], [27, 12], [27.5, 26], [22, 32], [10.5, 29], [7.5, 21]], rand, 1);
    slab(g, [[29, 12], [47, 13], [48.5, 21], [45.5, 29], [34, 32], [28.5, 26]], rand, 0);
    shard(g, 28, 30, -Math.PI / 2, 9, 2.2, rand, 0.5); // the sternum crystal
    icicles(g, 11, 26, 30.5, 4, 4.5, rand); icicles(g, 30, 45, 30.5, 4, 4.5, rand);
    strap(g, [4, 36.5, 28, 40, 52, 36.5], 3.6);
    g.fillStyle = C.bone; g.beginPath(); g.ellipse(28, 38.6, 3, 2, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(40,30,20,0.6)'; g.beginPath(); circle(g, 27, 38.4, 0.6); circle(g, 29, 38.4, 0.6); g.fill();
  } else if (d === 'n') {
    slab(g, [[8, 13], [48, 13], [49, 26], [42, 33], [14, 33], [7, 26]], rand, 0);
    for (let i = 0; i < 4; i++) shard(g, 28 + (rand() - 0.5) * 2, 16 + i * 4.2, -Math.PI / 2 - 0.15 + rand() * 0.3, 5 + rand() * 2, 1.6, rand); // spine ridge
    icicles(g, 15, 41, 32.5, 7, 5, rand);
    strap(g, [4, 36.5, 28, 39.5, 52, 36.5], 3.6);
  } else {
    slab(g, [[18, 12], [40, 13], [43.5, 22], [41, 31], [26, 33], [16, 26]], rand, 1);
    icicles(g, 22, 40, 31.5, 5, 4.5, rand);
    strap(g, [12, 37, 29, 39.5, 46, 36.5], 3.4);
    g.fillStyle = C.bone; g.beginPath(); g.ellipse(39, 37.5, 2.6, 1.8, 0, 0, TAU); g.fill();
  }
  // frost speckles over everything
  for (let i = 0; i < 16; i++) { g.fillStyle = A(C.rime, 0.3 + rand() * 0.4); g.beginPath(); circle(g, 8 + rand() * 40, 12 + Math.pow(rand(), 1.8) * 26, 0.4 + rand() * 0.5); g.fill(); }
}

// ---------------- the shoulder crags (body box, drawn over the head's back) ----------------
const SHOULDERS = { s: [[10, 18, -1], [46, 18, 1]], n: [[10, 18, -1], [46, 18, 1]], e: [[26, 17, 0]] };
function giantIce(g, d, rand) {
  for (const [x, y, side] of SHOULDERS[d]) {
    // a heavy pauldron of ice under the crags
    g.fillStyle = lin(g, x - 9, y - 6, x + 9, y + 6, [[0, C.ice], [0.5, C.iceM], [1, C.iceD]]);
    g.beginPath(); g.ellipse(x, y + 1, d === 'e' ? 8.5 : 7.6, 5.2, d === 'e' ? 0.1 : side * 0.3, 0, TAU); g.fill();
    g.strokeStyle = A(C.rime, 0.85); g.lineWidth = 0.9; g.beginPath(); g.ellipse(x - 1, y - 2, 5, 1.4, d === 'e' ? 0.1 : side * 0.3, Math.PI, TAU); g.stroke();
    // crystals leaning outward (the head stays clear between them)
    const n = d === 'e' ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1);
      const a = d === 'e' ? -Math.PI / 2 - 0.9 + u * 1.1 + (rand() - 0.5) * 0.12 : -Math.PI / 2 + side * (0.55 + u * 0.75) + (rand() - 0.5) * 0.12;
      const len = (d === 'e' ? 10 : 10.5) * (1.15 - u * 0.4) + rand() * 2.5, w = 2.1 + rand() * 0.8;
      const bx = x + (d === 'e' ? (u - 0.5) * 9 : side * (1 + u * 3)), by = y - 1.5 + u * 1.5;
      shard(g, bx, by, a, len, w, rand, i === 0 ? 0.45 : 0);
    }
  }
  if (d === 'n') for (let i = 0; i < 3; i++) shard(g, 28 + (i - 1) * 5, 20 + Math.abs(i - 1) * 2, -Math.PI / 2 + (i - 1) * 0.45, 7 - Math.abs(i - 1) * 1.5, 2, rand); // (low on the back: the head stays clear)
  if (d === 'e') for (let i = 0; i < 3; i++) shard(g, 16 - i * 0.5, 18 + i * 5, Math.PI + 0.55 - i * 0.12, 7 - i, 2, rand); // spikes down the back
}

// ---------------- the face (head box) ----------------
function crack(g, pts) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(40,86,124,0.7)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke();
  g.strokeStyle = 'rgba(226,248,255,0.95)'; g.lineWidth = 0.55;
  g.beginPath(); g.moveTo(pts[0][0] - 0.3, pts[0][1] - 0.3); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] - 0.3, pts[i][1] - 0.3); g.stroke();
}
function tusk(g, x, y, tx, ty, w) {
  g.fillStyle = lin(g, x - w, y, x + w, ty, [[0, '#f4f8fa'], [1, '#a9c6d4']]);
  g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo((x + tx) / 2 - w, (y + ty) / 2, tx, ty); g.quadraticCurveTo((x + tx) / 2 + w * 0.6, (y + ty) / 2 + 0.6, x + w, y); g.closePath(); g.fill();
}
function giantFace(g, d) {
  const rand = rng(733 + d.charCodeAt(0));
  if (d === 's') {
    // deep sockets
    for (const s of [-1, 1]) { g.fillStyle = 'rgba(18,40,66,0.42)'; g.beginPath(); g.ellipse(HX + s * 6.1, HY + 3.4, 4.4, 2.8, 0, 0, TAU); g.fill(); }
    // the brow ridge: a band of ice crystals across the forehead
    g.fillStyle = lin(g, HX - 14, HY - 3, HX + 14, HY + 2, [[0, C.ice], [0.5, C.iceM], [1, C.iceD]]);
    g.beginPath(); g.moveTo(HX - 13, HY + 1.6); g.lineTo(HX - 9, HY - 2.4); g.lineTo(HX - 3, HY - 0.6); g.lineTo(HX, HY - 3.2); g.lineTo(HX + 3, HY - 0.6); g.lineTo(HX + 9, HY - 2.4); g.lineTo(HX + 13, HY + 1.6);
    g.lineTo(HX + 8, HY + 1.2); g.lineTo(HX + 2.5, HY + 2.2); g.lineTo(HX, HY + 1); g.lineTo(HX - 2.5, HY + 2.2); g.lineTo(HX - 8, HY + 1.2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(HX - 12, HY + 1); g.lineTo(HX - 9, HY - 2); g.lineTo(HX - 3, HY - 0.3); g.stroke();
    crack(g, [[HX - 15, HY + 5], [HX - 12.5, HY + 8.5], [HX - 13.2, HY + 12]]);
    crack(g, [[HX + 11, HY + 9], [HX + 13.2, HY + 12.5]]);
    tusk(g, HX - 6.6, HY + 15.5, HX - 8.8, HY + 9.6, 1.5); tusk(g, HX + 6.6, HY + 15.5, HX + 8.8, HY + 9.6, 1.5);
  } else {
    g.fillStyle = 'rgba(18,40,66,0.42)'; g.beginPath(); g.ellipse(HX + 9.8, HY + 3.2, 3.6, 2.6, 0.2, 0, TAU); g.fill();
    g.fillStyle = lin(g, HX + 2, HY - 3, HX + 17, HY + 2, [[0, C.iceM], [1, C.iceD]]);
    g.beginPath(); g.moveTo(HX + 3, HY - 1.6); g.lineTo(HX + 9, HY - 3.4); g.lineTo(HX + 17.5, HY + 0.4); g.lineTo(HX + 15.5, HY + 2); g.lineTo(HX + 8, HY + 1.4); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(HX + 4, HY - 1.4); g.lineTo(HX + 9, HY - 3); g.lineTo(HX + 16.5, HY + 0.4); g.stroke();
    crack(g, [[HX + 2, HY + 5], [HX + 4.5, HY + 9], [HX + 3.6, HY + 12]]);
    tusk(g, HX + 11.5, HY + 15.6, HX + 14.6, HY + 9.4, 1.6);
  }
  void rand;
}

// ---------------- the crown of ice (head box) ----------------
function giantCrown(g, d) {
  const rand = rng(577 + d.charCodeAt(0));
  const cx = d === 'e' ? HX - 1 : HX, top = HY - 15.5;
  const n = d === 'e' ? 6 : 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    const x = cx + u * (d === 'e' ? 22 : 26), y = top + Math.abs(u) * 9 + 2;
    const a = -Math.PI / 2 + u * (d === 'e' ? 1.1 : 1.3) + (rand() - 0.5) * 0.15 + (d === 'e' ? -0.25 : 0);
    const len = (d === 'n' ? 8.5 : 9.5) * (1.2 - Math.abs(u) * 0.9) + rand() * 3;
    shard(g, x, y, a, len, 2.2 + rand() * 0.8, rand, i === Math.floor(n / 2) ? 0.5 : 0);
  }
  // the band of rime the crystals grow from
  g.strokeStyle = A(C.iceM, 0.9); g.lineWidth = 2.4;
  g.beginPath(); g.ellipse(cx, top + 6, d === 'e' ? 12 : 14, 3.6, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  g.strokeStyle = A(C.rime, 0.9); g.lineWidth = 0.8;
  g.beginPath(); g.ellipse(cx, top + 5.2, d === 'e' ? 11.5 : 13.5, 3.2, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
}

// ---------------- the thrown ice rock (lazy; a rough frozen boulder with ice crusted on it) ----------------
function iceRock() {
  return spriteFull(40, 36, (g, P) => P.layer((g) => {
    const rand = rng(4411);
    const pts = []; for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU, r = 14 + rand() * 4; pts.push([20 + Math.cos(a) * r, 19 + Math.sin(a) * r * 0.85]); }
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) g.lineTo(x, y); g.closePath();
    g.fillStyle = lin(g, 6, 4, 34, 34, [[0, '#c9e2ee'], [0.45, '#7fa9bf'], [1, '#3c6a86']]); g.fill();
    g.save(); g.clip();
    g.fillStyle = 'rgba(70,80,90,0.45)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(8 + rand() * 24, 10 + rand() * 18, 3 + rand() * 4, 2 + rand() * 3, rand() * 3, 0, TAU); g.fill(); } // stone under the ice
    g.strokeStyle = C.crack; g.lineWidth = 0.8; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(8 + rand() * 24, 6 + rand() * 8); g.lineTo(10 + rand() * 20, 18 + rand() * 12); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(14, 11, 5, 2.4, -0.5, 0, TAU); g.fill();
    g.restore();
    for (let i = 0; i < 4; i++) shard(g, 20 + (rand() - 0.5) * 18, 9 + rand() * 8, -Math.PI / 2 + (rand() - 0.5) * 1.6, 5 + rand() * 4, 1.6, rand);
  }, 2.4));
}

// ---------------- registration (painted only when a giant is on screen) ----------------
const R = (d, k) => rng(k + d.charCodeAt(0));
for (const d of DIRS) {
  lazyDef('wk_armor_gi_' + d, () => spritePx(BW, BH, (g, P) => P.layer((g) => giantArmor(g, d, R(d, 1201)), 2.8, '#0b0d11')), 0.5, FEET / BH);
  lazyDef('wk_ice_gi_' + d, () => spritePx(BW, BH, (g, P) => P.layer((g) => giantIce(g, d, R(d, 1301)), 2.2, '#0b0d11')), 0.5, FEET / BH);
  lazyDef('hat_gicrown_' + d, () => spritePx(HW, HH, (g, P) => P.layer((g) => giantCrown(g, d), 2, '#0b0d11')), 0.5, NECK / HH);
  paintDef('wk_armor_gi_' + d, { W: BW, H: BH, ax: 0.5, ay: FEET / BH, pad: 12, paint: (P) => P.layer((g) => giantArmor(g, d, R(d, 1201)), 2.8, '#0b0d11') });
  paintDef('wk_ice_gi_' + d, { W: BW, H: BH, ax: 0.5, ay: FEET / BH, pad: 12, paint: (P) => P.layer((g) => giantIce(g, d, R(d, 1301)), 2.2, '#0b0d11') });
  paintDef('hat_gicrown_' + d, { W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad: 12, paint: (P) => P.layer((g) => giantCrown(g, d), 2, '#0b0d11') });
}
for (const d of ['s', 'e']) {
  lazyDef('wk_face_gi_' + d, () => spritePx(HW, HH, (g, P) => P.layer((g) => giantFace(g, d), 1.2, '#0b0d11')), 0.5, NECK / HH);
  paintDef('wk_face_gi_' + d, { W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad: 10, paint: (P) => P.layer((g) => giantFace(g, d), 1.2, '#0b0d11') });
}
lazyDef('proj_ice_rock', iceRock, 0.5, 0.5);
