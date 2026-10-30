// "Andarilho do Gelo" (winter walker, species 'walker'): an original frost-undead look on the humanoid pawn rig.
// The look itself is a fixed set of agent H's look options (gaunt build, pale ice-blue skin, long frost-white
// hair, cold-cyan eyes), plus two lazily painted overlays in the rig's canvases (art/lazyDefs.js → lazy texture):
//   wk_armor_{s,n,e}  body box (BW×BH, anchor at FEET): dark weathered hide and scale armour, a tattered hide skirt,
//                     rime on the upper edges, rawhide straps · wk_ice_{s,n,e} (same box): ice crystals growing out of the
//                     shoulders (drawn over the long hair)
//   wk_face_{s,e}     head box (HW×HH, anchor at NECK): hollow cheeks, shadowed sockets and frost cracks
// compose.js draws them at the torso / head transforms and adds the eye glow (WALKER_EYES, emissive).

import { spritePxFast as spritePx, rng, TAU, lin, circle, rgb, hex } from './paint.js';
import { BW, BH, FEET, HW, HH, NECK, HX, HY, bodyPath } from './pawns.js';
import { lazyDef } from './lazyDefs.js';

const A = (c, a) => rgb(hex(c), a);
const DIRS = ['s', 'n', 'e'];

// three faces of the same horde (picked from the entity id; frozen objects so the look-rig cache holds)
const BASE = {
  v: 1, build: 'slim', height: 'tall', skin: 'a7c2d6', head: 'long', ears: 'small', eyes: 'sharp', eyeC: '8ff6ff',
  brows: 'angry', nose: 'long', mouth: 'serious', cheeks: 'cheekbones', age: 'mature', marks: 'none', scar: 'none',
  paint: 'none', paintC: 'ece6da', hair: 'long', hairC: 'c3d0da', hairFx: 'tips', hairC2: 'f2f8fb', beard: 'none', beardC: 'dfe9f0',
  top: 'jerkin', topC: '22262c', topC2: '3e4752', pattern: 'plain', over: 'none', overC: 'c8d4dc',
  bottom: 'wraps', botC: '1c1f24', shoes: 'wraps', shoeC: '2c3036',
};
export const WALKER_LOOKS = [
  Object.freeze({ ...BASE }),
  Object.freeze({ ...BASE, hair: 'wild', head: 'diamond', skin: '9fbbd0', brows: 'thin', mouth: 'frown', hairC: 'b9c8d3' }),
  Object.freeze({ ...BASE, hair: 'long_wavy', head: 'square', skin: 'b0c9da', beard: 'long', age: 'old', hairC: 'ccd8e0', nose: 'hooked' }),
];
export function walkerLook(p) {
  const id = p.id ?? p.nid ?? 0;
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return WALKER_LOOKS[(h >>> 0) % WALKER_LOOKS.length];
}

// eye positions on the head canvas (art/look/face.js EYE_S / EYE_E), in tiles from the head anchor: [dx, lift]
export const WALKER_EYES = { s: [[-6.3 / 64, (NECK - HY - 3.2) / 64], [6.3 / 64, (NECK - HY - 3.2) / 64]], e: [[9.8 / 64, (NECK - HY - 2.8) / 64]] };

// ---------------- armour ----------------
const C = { hide: '#29282d', hideD: '#141317', hideL: '#3f3e46', scale: '#333b45', scaleD: '#171b21', scaleL: '#5d6a77', rime: '#e6f3fa',
  ice: '#c8eefb', iceM: '#8fd2ec', iceD: '#3f8fb2', strap: '#1b1511', strapL: '#4a3a2c', bone: '#cfc8b4' };
function above(g, d, y, k = 4) {
  if (d === 'e') { g.moveTo(8, 0); g.lineTo(50, 0); g.lineTo(50, y - k * 0.2); g.quadraticCurveTo(29, y + k * 0.7, 8, y); }
  else { g.moveTo(2, 0); g.lineTo(54, 0); g.lineTo(54, y); g.quadraticCurveTo(28, y + k, 2, y); }
  g.closePath();
}
const SHOULDERS = { s: [[12.5, 19, -1], [43.5, 19, 1]], n: [[12.5, 19, -1], [43.5, 19, 1]], e: [[26, 18, -1]] };

// a cluster of ice crystals growing out of a shoulder (side -1 = screen left)
function crystals(g, x, y, side, rand, e) {
  // scale pauldron
  g.fillStyle = lin(g, x - 7, y - 5, x + 7, y + 5, [[0, C.scaleL], [0.5, C.scale], [1, C.scaleD]]);
  g.beginPath(); g.ellipse(x, y, e ? 8.8 : 7.8, 5.6, e ? 0.15 : side * 0.32, 0, TAU); g.fill();
  g.strokeStyle = A(C.scaleD, 0.9); g.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(x, y - 2 + k * 2.6, (e ? 7 : 6) - k, 2.2, e ? 0.15 : side * 0.32, 0.25, Math.PI - 0.25); g.stroke(); }
  g.fillStyle = A(C.rime, 0.85); g.beginPath(); g.ellipse(x - 1.5, y - 3.8, 4.6, 1.3, e ? 0.1 : side * 0.3, 0, TAU); g.fill();
  // shards: tall in the middle, splaying outward
  const n = e ? 5 : 4;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1) - 0.5;
    const a = -Math.PI / 2 + (e ? u * 1.5 : side * (0.25 + (u + 0.5) * 0.85)) + (rand() - 0.5) * 0.15;
    const len = (e ? 9 : 8) * (1.15 - Math.abs(u) * 0.7) + rand() * 3, w = 2.2 + rand() * 1.1;
    const bx = x + (e ? u * 9 : side * (u + 0.5) * 5 - side * 1.5), by = y - 3 + Math.abs(u) * 1.5;
    const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
    const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    g.fillStyle = lin(g, bx + nx, by + ny, bx - nx, by - ny, [[0, C.ice], [0.55, C.iceM], [1, C.iceD]]);
    g.beginPath(); g.moveTo(bx + nx, by + ny); g.lineTo(bx + nx * 0.55 + Math.cos(a) * len * 0.72, by + ny * 0.55 + Math.sin(a) * len * 0.72); g.lineTo(tx, ty);
    g.lineTo(bx - nx * 0.6 + Math.cos(a) * len * 0.66, by - ny * 0.6 + Math.sin(a) * len * 0.66); g.lineTo(bx - nx, by - ny); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(bx + nx * 0.3, by + ny * 0.3); g.lineTo(tx, ty); g.stroke();
  }
}

function walkerArmor(g, d, rand) {
  const hem = 47;
  g.save(); g.beginPath(); bodyPath(g, d); g.clip();
  // weathered hide under-layer down to a tattered skirt
  g.beginPath(); above(g, d, hem + 6, 3); g.fillStyle = C.hide; g.fill();
  g.save(); g.beginPath(); above(g, d, hem + 6, 3); g.clip();
  g.fillStyle = lin(g, 8, 10, 46, 52, [[0, 'rgba(255,255,255,0.14)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,10,0.35)']]); g.fillRect(0, 0, BW, BH);
  for (let i = 0; i < 12; i++) { g.fillStyle = rand() < 0.5 ? A(C.hideL, 0.35) : A(C.hideD, 0.4); g.beginPath(); g.ellipse(6 + rand() * 44, 22 + rand() * 28, 1.4 + rand() * 2.2, 0.7 + rand(), rand() * 3, 0, TAU); g.fill(); }
  // scale rows over the chest, rime on their upper rims
  const x0 = d === 'e' ? 14 : 6, x1 = d === 'e' ? 44 : 50;
  for (let row = 0, y = 12; y < 38; y += 3.6, row++) {
    for (let x = x0 + (row % 2) * 2.4; x < x1; x += 4.8) {
      g.fillStyle = lin(g, x - 2.4, y - 1.5, x + 2.4, y + 3, [[0, C.scaleL], [0.45, C.scale], [1, C.scaleD]]);
      g.beginPath(); g.moveTo(x - 2.4, y - 0.8); g.lineTo(x + 2.4, y - 0.8); g.lineTo(x + 2.4, y + 1.4); g.quadraticCurveTo(x, y + 4.2, x - 2.4, y + 1.4); g.closePath(); g.fill();
      if (rand() < 0.45 - row * 0.05) { g.strokeStyle = A(C.rime, 0.85); g.lineWidth = 0.9; g.beginPath(); g.moveTo(x - 2.2, y - 0.6); g.lineTo(x + 2.2, y - 0.6); g.stroke(); }
    }
  }
  // tattered skirt: frayed strips with frost on the tips
  g.fillStyle = C.hideD;
  for (let x = d === 'e' ? 12 : 4; x < (d === 'e' ? 46 : 52); x += 3.4) {
    const y0 = 38 + rand() * 2, y1 = hem + 2 + rand() * 5;
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + 3.2, y0); g.lineTo(x + 2.2 + rand(), y1); g.lineTo(x + 0.6, y1 - 1.5 - rand() * 2); g.closePath(); g.fill();
    if (rand() < 0.5) { g.fillStyle = A(C.rime, 0.7); g.beginPath(); circle(g, x + 1.6, y1 - 1, 0.8); g.fill(); g.fillStyle = C.hideD; }
  }
  // frost crust: speckles on the shoulders and the top of the chest
  for (let i = 0; i < 22; i++) {
    const x = 6 + rand() * 44, y = 10 + Math.pow(rand(), 2.4) * 22;
    g.fillStyle = A(C.rime, 0.3 + rand() * 0.4); g.beginPath(); circle(g, x, y, 0.4 + rand() * 0.6); g.fill();
  }
  g.restore();
  // belt of rawhide with a bone clasp; cross straps (dark leather with a worn edge)
  const strap = (pts, w) => {
    g.strokeStyle = C.strap; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0], pts[1]); g.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]); g.stroke();
    g.strokeStyle = A(C.strapL, 0.8); g.lineWidth = 0.6; g.beginPath(); g.moveTo(pts[0], pts[1] - w * 0.35); g.quadraticCurveTo(pts[2], pts[3] - w * 0.35, pts[4], pts[5] - w * 0.35); g.stroke();
  };
  if (d === 'e') { strap([8, 38.5, 29, 41, 50, 38], 3.4); strap([24, 13, 30, 26, 36, 38], 2.6); }
  else {
    strap([2, 38.5, 28, 42, 54, 38.5], 3.4);
    strap([13, 15, 26, 26, 41, 38], 2.8);
    if (d === 'n') strap([43, 15, 30, 26, 15, 38], 2.8);
  }
  if (d !== 'n') { g.fillStyle = C.bone; g.beginPath(); g.ellipse(d === 'e' ? 36 : 28, d === 'e' ? 39.6 : 40.3, 2.4, 1.6, 0, 0, TAU); g.fill(); }
  g.restore();
}
// the ice growing out of the shoulders: drawn over the long hair (compose.js, after the head)
function walkerIce(g, d, rand) { for (const [x, y, side] of SHOULDERS[d]) crystals(g, x, y, side, rand, d === 'e'); }

// ---------------- face: hollows, sockets, frost cracks ----------------
function crack(g, pts) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(52,96,132,0.65)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke();
  g.strokeStyle = 'rgba(226,248,255,0.95)'; g.lineWidth = 0.55;
  g.beginPath(); g.moveTo(pts[0][0] - 0.3, pts[0][1] - 0.3); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] - 0.3, pts[i][1] - 0.3); g.stroke();
}
function walkerFace(g, d) {
  const hol = 'rgba(40,70,104,0.3)';
  if (d === 's') {
    for (const s of [-1, 1]) {
      g.fillStyle = hol; g.beginPath(); g.ellipse(HX + s * 10.5, HY + 10.5, 3.6, 2.6, s * 0.4, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(24,46,78,0.5)'; g.lineWidth = 1.3; g.beginPath(); g.arc(HX + s * 6.3, HY + 3.4, 3.4, 0.25, Math.PI - 0.25); g.stroke();
    }
    crack(g, [[HX - 15.5, HY + 2], [HX - 12.5, HY + 5.5], [HX - 13.4, HY + 9], [HX - 10.6, HY + 13.5]]);
    crack(g, [[HX - 12.5, HY + 5.5], [HX - 9.2, HY + 6.8]]);
    crack(g, [[HX + 9, HY + 11.5], [HX + 12.2, HY + 13], [HX + 13.5, HY + 16.5]]);
    crack(g, [[HX + 2.2, HY - 6.5], [HX + 3.6, HY - 3.6], [HX + 2.4, HY - 1.2]]);
  } else {
    g.fillStyle = hol; g.beginPath(); g.ellipse(HX + 8, HY + 10, 3.4, 2.6, 0.3, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(24,46,78,0.5)'; g.lineWidth = 1.2; g.beginPath(); g.arc(HX + 9.8, HY + 3, 3, 0.3, Math.PI - 0.4); g.stroke();
    crack(g, [[HX + 1, HY + 4], [HX + 4, HY + 7.5], [HX + 3.4, HY + 11], [HX + 6.4, HY + 14.5]]);
    crack(g, [[HX + 4, HY + 7.5], [HX + 7.2, HY + 8.2]]);
    crack(g, [[HX + 12.5, HY - 6], [HX + 13.4, HY - 2.8]]);
  }
}

// lazy registration (painted only when a walker is on screen)
for (const d of DIRS) {
  const rand = () => rng(911 + d.charCodeAt(0));
  lazyDef('wk_armor_' + d, () => { const r = rand(); return spritePx(BW, BH, (g, P) => P.layer((g) => walkerArmor(g, d, r), 2.8, '#0b0d11')); }, 0.5, FEET / BH);
  lazyDef('wk_ice_' + d, () => { const r = rand(); return spritePx(BW, BH, (g, P) => P.layer((g) => walkerIce(g, d, r), 2.2, '#0b0d11')); }, 0.5, FEET / BH);
}
for (const d of ['s', 'e']) lazyDef('wk_face_' + d, () => spritePx(HW, HH, (g, P) => P.layer((g) => walkerFace(g, d), 0)), 0.5, NECK / HH);
