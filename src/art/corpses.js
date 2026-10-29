// Corpse art (I · corpos e decomposição): skeletons (small / medium / large animals, humanoid), butchered
// carcasses, rot blotches, a fly and the "Ossos" item icon. Original procedural art in the same language as the
// creatures (soft painterly fills, ~2 px dark outline). Fresh and rotten bodies reuse the creature / pawn sprites
// (tinted at draw time, src/art/corpseDraw.js), so the atlas only grows by a few small sprites.
//
// Animal skeletons / carcasses are side views (head to the east, feet at the anchor) like <species>_e, so they are
// drawn with the same lying transform; the humanoid skeleton stands upright (feet at the anchor) like the pawn.

import { spritePxFast as spritePx, rng, TAU, lin, circle, rgb, hex } from './paint.js';

const BONE = '#e9dfc7', BONE_SH = '#bcae90', BONE_D = '#8f8168', HOLE = '#2f261d';
const MEAT = '#a3443a', MEAT_D = '#64221e', MEAT_L = '#d9786a', FAT = '#e8c9a8';
const A = (c, a) => rgb(hex(c), a);
const OWB = 1.9; // bones: thinner outline than living creatures

// ---------- bone primitives ----------
// long bone from (x0,y0) to (x1,y1) with knobby ends
function longBone(g, x0, y0, x1, y1, w) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  g.fillStyle = lin(g, x0 + nx * w, y0 + ny * w, x0 - nx * w, y0 - ny * w, [[0, BONE], [1, BONE_SH]]);
  g.beginPath();
  g.moveTo(x0 + nx * w * 0.5, y0 + ny * w * 0.5);
  g.lineTo(x1 + nx * w * 0.45, y1 + ny * w * 0.45);
  g.lineTo(x1 - nx * w * 0.45, y1 - ny * w * 0.45);
  g.lineTo(x0 - nx * w * 0.5, y0 - ny * w * 0.5);
  g.closePath(); g.fill();
  g.fillStyle = BONE;
  g.beginPath();
  circle(g, x0 + nx * w * 0.42, y0 + ny * w * 0.42, w * 0.62); circle(g, x0 - nx * w * 0.42, y0 - ny * w * 0.42, w * 0.62);
  circle(g, x1 + nx * w * 0.38, y1 + ny * w * 0.38, w * 0.55); circle(g, x1 - nx * w * 0.38, y1 - ny * w * 0.38, w * 0.55);
  g.fill();
}
// curved rib from the spine (x0,y0) bowing toward (x1,y1)
function rib(g, x0, y0, cx, cy, x1, y1, w, col = BONE) {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
  g.strokeStyle = A(BONE_D, 0.45); g.lineWidth = w * 0.35;
  g.beginPath(); g.moveTo(x0 + w * 0.2, y0 + w * 0.3); g.quadraticCurveTo(cx + w * 0.3, cy + w * 0.2, x1 + w * 0.2, y1); g.stroke();
}
// vertebra chain along a quadratic curve
function spine(g, x0, y0, cx, cy, x1, y1, n, r0, r1) {
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const r = r0 + (r1 - r0) * t;
    g.fillStyle = i % 2 ? BONE_SH : BONE;
    g.beginPath(); g.ellipse(x, y, r * 1.05, r * 0.85, 0, 0, TAU); g.fill();
    g.fillStyle = BONE; g.beginPath(); g.ellipse(x, y - r * 0.95, r * 0.35, r * 0.55, 0, 0, TAU); g.fill(); // spinous process
  }
}
// side-view animal skull facing east: cranium at (x, y), r = size, snout = muzzle length factor
function skullSide(g, x, y, r, snout, rand) {
  const sx = x + r * (0.9 + snout);
  g.fillStyle = lin(g, x - r, y - r, x + r, y + r, [[0, BONE], [1, BONE_SH]]);
  g.beginPath();
  g.ellipse(x, y, r, r * 0.82, 0, 0, TAU);
  g.moveTo(x + r * 0.2, y - r * 0.55);
  g.quadraticCurveTo(sx - r * 0.2, y - r * 0.35, sx, y + r * 0.05);
  g.quadraticCurveTo(sx + r * 0.08, y + r * 0.35, sx - r * 0.25, y + r * 0.42);
  g.lineTo(x + r * 0.2, y + r * 0.55);
  g.closePath(); g.fill();
  // lower jaw, slightly open
  g.fillStyle = BONE_SH;
  g.beginPath();
  g.moveTo(x - r * 0.25, y + r * 0.5);
  g.quadraticCurveTo(x + r * 0.6, y + r * 1.05, sx - r * 0.3, y + r * 0.72);
  g.lineTo(sx - r * 0.35, y + r * 0.56);
  g.quadraticCurveTo(x + r * 0.5, y + r * 0.72, x - r * 0.05, y + r * 0.38);
  g.closePath(); g.fill();
  // teeth
  g.fillStyle = '#f6f0e0';
  for (let i = 0; i < 4; i++) { const tx = x + r * (0.55 + i * (snout * 0.32 + 0.12)); g.fillRect(tx, y + r * 0.42, Math.max(0.8, r * 0.1), r * 0.16); }
  // eye socket, nostril, cheek crack
  g.fillStyle = HOLE;
  g.beginPath(); g.ellipse(x + r * 0.25, y - r * 0.12, r * 0.3, r * 0.24, -0.2, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(sx - r * 0.12, y + r * 0.02, r * 0.1, r * 0.08, 0, 0, TAU); g.fill();
  g.strokeStyle = A(BONE_D, 0.6); g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(x - r * 0.5, y + r * 0.1); g.quadraticCurveTo(x - r * 0.2, y + r * (0.2 + rand() * 0.15), x, y + r * 0.35); g.stroke();
  g.fillStyle = 'rgba(255,252,240,0.45)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.45, r * 0.4, r * 0.18, -0.3, 0, TAU); g.fill();
}

// ---------- animal skeleton / carcass (side view, head east) ----------
// k = scale vs the medium layout (104 × 64, feet at y 58), bulk = bone thickness, snout = muzzle length
const LAYOUT = { W: 104, H: 64, foot: 58 };
function animalBones(P, k, bulk, snout, ribs, seed) {
  const rand = rng(seed);
  const X = (v) => v * k, w = (v) => v * k * bulk;
  const spineY = 28;
  // far legs (darker, behind)
  P.layer((g) => {
    g.globalAlpha = 0.75;
    longBone(g, X(70), X(40), X(76), X(50), w(2.6)); longBone(g, X(76), X(50), X(74), X(57), w(2.1));
    longBone(g, X(31), X(37), X(36), X(48), w(3)); longBone(g, X(36), X(48), X(31), X(57), w(2.2));
    g.globalAlpha = 1;
  }, OWB * 0.8);
  // spine, pelvis, ribs, shoulder blade
  P.layer((g) => {
    spine(g, X(6), X(32), X(18), X(25), X(78), X(26), Math.round(14 * Math.min(1.2, k + 0.1)), w(2.6), w(3.1));
    g.fillStyle = lin(g, X(20), X(26), X(34), X(40), [[0, BONE], [1, BONE_SH]]);
    g.beginPath(); g.ellipse(X(28), X(31), X(7.5) * bulk, X(5) * bulk, 0.5, 0, TAU); g.fill();
    g.fillStyle = HOLE; g.beginPath(); g.ellipse(X(28.5), X(32), X(2.4), X(1.6), 0.5, 0, TAU); g.fill();
    for (let i = 0; i < ribs; i++) {
      const x0 = X(38 + i * (30 / ribs)), drop = X(15 + Math.sin((i / (ribs - 1 || 1)) * Math.PI) * 6);
      rib(g, x0, X(spineY), x0 + X(6), X(spineY) + drop * 0.6, x0 - X(1.5), X(spineY) + drop, w(1.9));
    }
    g.fillStyle = BONE_SH;
    g.beginPath(); g.moveTo(X(62), X(27)); g.lineTo(X(73), X(26)); g.lineTo(X(68), X(41)); g.closePath(); g.fill();
  }, OWB);
  // near legs
  P.layer((g) => {
    longBone(g, X(66), X(38), X(69), X(49), w(2.9)); longBone(g, X(69), X(49), X(66), X(57.5), w(2.3));
    longBone(g, X(27), X(36), X(33), X(48), w(3.4)); longBone(g, X(33), X(48), X(27), X(57.5), w(2.4));
    g.fillStyle = BONE_SH;
    for (const [x, y] of [[66, 58], [27, 58]]) { g.beginPath(); g.ellipse(X(x), X(y), w(3.2), w(1.4), 0, 0, TAU); g.fill(); }
  }, OWB);
  // skull
  P.layer((g) => { skullSide(g, X(86), X(26), X(8.5) * Math.sqrt(bulk), snout, rand); }, OWB);
}

// butchered flank: an opened torso (raw flesh, exposed ribs) laid over the skinned body of the species
function carcassFlank(P, k, ribs, seed) {
  const rand = rng(seed);
  const X = (v) => v * k;
  P.layer((g) => {
    const rim = () => { g.beginPath(); g.moveTo(X(28), X(27)); g.quadraticCurveTo(X(34), X(17), X(52), X(19)); g.quadraticCurveTo(X(70), X(17), X(74), X(27));
      g.quadraticCurveTo(X(73), X(41), X(60), X(44)); g.quadraticCurveTo(X(44), X(47), X(32), X(41)); g.quadraticCurveTo(X(26), X(35), X(28), X(27)); g.closePath(); };
    rim(); g.fillStyle = lin(g, 0, X(17), 0, X(46), [[0, MEAT_L], [0.5, MEAT], [1, MEAT_D]]); g.fill();
    g.save(); rim(); g.clip();
    // cavity, ribs crossing it, fat and sinew
    g.fillStyle = A('#3a0f0d', 0.75); g.beginPath(); g.ellipse(X(51), X(33), X(17), X(8.5), 0.03, 0, TAU); g.fill();
    for (let i = 0; i < ribs; i++) {
      const x0 = X(36 + i * (32 / ribs));
      g.strokeStyle = '#f1e6d0'; g.lineWidth = X(2.1); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, X(18)); g.quadraticCurveTo(x0 + X(5), X(30), x0 - X(1), X(44)); g.stroke();
      g.strokeStyle = A('#b98e7a', 0.7); g.lineWidth = X(0.7);
      g.beginPath(); g.moveTo(x0 + X(0.6), X(19)); g.quadraticCurveTo(x0 + X(5.6), X(30), x0 - X(0.4), X(44)); g.stroke();
    }
    g.fillStyle = A(FAT, 0.7);
    for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(X(32 + rand() * 40), X(19 + rand() * 3), X(2 + rand() * 3), X(1 + rand() * 0.8), rand() - 0.5, 0, TAU); g.fill(); }
    g.fillStyle = A(MEAT_L, 0.55); g.beginPath(); g.ellipse(X(46), X(21), X(14), X(2.2), -0.05, 0, TAU); g.fill();
    g.restore();
  }, OWB * 0.8, '#3a1410');
}

function animalSprite(kind, carcass) {
  const K = { s: [0.68, 0.85, 0.55, 4], m: [1, 1, 0.75, 6], l: [1.28, 1.45, 0.5, 7] }[kind];
  const [k, bulk, snout, ribs] = K;
  const W = Math.ceil(LAYOUT.W * k), H = Math.ceil(LAYOUT.H * k);
  const seed = kind.charCodeAt(0) * 7 + (carcass ? 3 : 0);
  // uncropped: the flank must keep the nominal box so it scales / anchors exactly like the skeleton
  if (carcass) return spritePx(W, H, (g, P) => carcassFlank(P, k, ribs, seed), { crop: false });
  return spritePx(W, H, (g, P) => animalBones(P, k, bulk, snout, ribs, seed), { crop: false });
}

// ---------- humanoid skeleton (front view, standing: feet at the bottom like the pawn rig) ----------
function pawnSkeleton() {
  const W = 44, H = 84;
  const rand = rng(9091);
  return spritePx(W, H, (g, P) => {
    // limbs behind the ribcage
    P.layer((g) => {
      for (const s of [-1, 1]) {
        longBone(g, 22 + s * 9.5, 45, 22 + s * 12, 56, 2.4);        // humerus
        longBone(g, 22 + s * 12, 56, 22 + s * 12.5, 65.5, 2);       // forearm
        g.fillStyle = BONE_SH; g.beginPath(); circle(g, 22 + s * 12.6, 67.5, 1.6); circle(g, 22 + s * 13.8, 69, 0.9); circle(g, 22 + s * 11.6, 69.4, 0.9); g.fill();
        longBone(g, 22 + s * 5, 63, 22 + s * 6, 72.5, 2.9);         // femur
        longBone(g, 22 + s * 6, 72.5, 22 + s * 6.4, 80.5, 2.3);     // tibia
        g.fillStyle = BONE_SH; g.beginPath(); g.ellipse(22 + s * 7, 81.4, 2.6, 1.3, 0, 0, TAU); g.fill();
      }
    }, OWB);
    // spine, pelvis, ribcage, collarbones
    P.layer((g) => {
      spine(g, 22, 41, 22.5, 50, 22, 60, 7, 1.6, 1.9);
      g.fillStyle = lin(g, 14, 58, 30, 66, [[0, BONE], [1, BONE_SH]]);
      g.beginPath(); g.moveTo(14, 59); g.quadraticCurveTo(22, 56, 30, 59); g.quadraticCurveTo(29, 65, 25, 66); g.lineTo(19, 66); g.quadraticCurveTo(15, 65, 14, 59); g.closePath(); g.fill();
      g.fillStyle = HOLE; g.beginPath(); g.ellipse(18.4, 61.6, 1.5, 1.8, 0.3, 0, TAU); g.ellipse(25.6, 61.6, 1.5, 1.8, -0.3, 0, TAU); g.fill();
      for (let i = 0; i < 5; i++) {
        const y = 44 + i * 2.6, wv = 9.5 - Math.abs(i - 1.5) * 0.9;
        for (const s of [-1, 1]) rib(g, 22 + s * 1.2, y, 22 + s * (wv + 2), y + 0.8, 22 + s * (wv - 1.5), y + 3.2, 1.45);
      }
      g.strokeStyle = BONE; g.lineWidth = 1.7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(14, 43.2); g.quadraticCurveTo(22, 41, 30, 43.2); g.stroke();
    }, OWB);
    // skull, front view
    P.layer((g) => {
      g.fillStyle = lin(g, 12, 14, 32, 38, [[0, BONE], [1, BONE_SH]]);
      g.beginPath(); g.ellipse(22, 26, 11.2, 11.8, 0, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(15.5, 31); g.quadraticCurveTo(22, 41.5, 28.5, 31); g.closePath(); g.fill();
      g.fillStyle = HOLE;
      g.beginPath(); g.ellipse(17.6, 27, 3, 3.3, 0.15, 0, TAU); g.ellipse(26.4, 27, 3, 3.3, -0.15, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(22, 30); g.lineTo(20.6, 33.2); g.lineTo(23.4, 33.2); g.closePath(); g.fill();
      g.fillStyle = '#f6f0e0'; for (let i = 0; i < 5; i++) g.fillRect(18.2 + i * 1.6, 35.2, 1.1, 1.8);
      g.strokeStyle = A(BONE_D, 0.55); g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(14, 21); g.quadraticCurveTo(16 + rand() * 2, 19, 18, 17.5); g.stroke();
      g.fillStyle = 'rgba(255,252,240,0.5)'; g.beginPath(); g.ellipse(18, 19.5, 4.5, 2.4, -0.4, 0, TAU); g.fill();
    }, OWB);
  });
}

// ---------- rot blotches (overlay on rotten bodies), fly, bone icon ----------
function rotBlotch(seed) {
  const rand = rng(seed);
  return spritePx(46, 28, (g) => {
    for (let i = 0; i < 9; i++) {
      const x = 8 + rand() * 30, y = 6 + rand() * 16, rx = 3 + rand() * 6, ry = 2 + rand() * 4;
      g.fillStyle = A(i % 3 ? '#262414' : '#3a4220', 0.42 + rand() * 0.2);
      g.beginPath(); g.ellipse(x, y, rx, ry, rand() * 3, 0, TAU); g.fill();
    }
    for (let i = 0; i < 7; i++) { g.fillStyle = A('#9aa35a', 0.35 + rand() * 0.25); g.beginPath(); circle(g, 8 + rand() * 30, 6 + rand() * 16, 0.8 + rand() * 1.4); g.fill(); }
    for (let i = 0; i < 5; i++) { g.fillStyle = A('#e8e2c8', 0.5); g.beginPath(); g.ellipse(10 + rand() * 26, 8 + rand() * 12, 0.9, 0.45, rand() * 3, 0, TAU); g.fill(); }
  }, { crop: true });
}
function fly() {
  return spritePx(9, 7, (g) => {
    g.fillStyle = 'rgba(214,226,236,0.75)';
    g.beginPath(); g.ellipse(3, 2.4, 2.2, 1.3, -0.5, 0, TAU); g.ellipse(6, 2.4, 2.2, 1.3, 0.5, 0, TAU); g.fill();
    g.fillStyle = '#17140f'; g.beginPath(); g.ellipse(4.5, 4.2, 1.7, 1.25, 0, 0, TAU); g.fill();
    g.fillStyle = '#3b5a3a'; g.beginPath(); circle(g, 4.5, 3.6, 0.6); g.fill();
  }, { crop: false });
}
// item icon in the item framing (36 × 36, uncropped, anchor 0.5 / 0.82): two crossed bones
function boneIcon() {
  return spritePx(36, 36, (g, P) => {
    P.layer((g) => {
      g.translate(18, 18); g.scale(0.9, 0.9); g.translate(-18, -18);
      longBone(g, 9, 26, 26, 10, 4.2);
    }, 2.3);
    P.layer((g) => {
      g.translate(18, 18); g.scale(0.9, 0.9); g.translate(-18, -18);
      longBone(g, 10, 11, 27, 26, 4.6);
      g.fillStyle = 'rgba(255,253,244,0.55)'; g.beginPath(); g.ellipse(16, 15.5, 4, 1.2, 0.72, 0, TAU); g.fill();
    }, 2.3);
  }, { crop: false });
}

export function addCorpses(add) {
  const ay = LAYOUT.foot / LAYOUT.H;
  for (const k of ['s', 'm', 'l']) {
    add('corpse_skel_' + k, animalSprite(k, false), 0.5, ay);
    add('corpse_carcass_' + k, animalSprite(k, true), 0.5, ay);
  }
  add('corpse_skel_pawn', pawnSkeleton(), 0.5, 82 / 84);
  add('corpse_rot_0', rotBlotch(31), 0.5, 0.5);
  add('corpse_rot_1', rotBlotch(77), 0.5, 0.5);
  add('fx_fly', fly(), 0.5, 0.5);
  add('item_bone', boneIcon(), 0.5, 0.82);
}

export const CORPSE_SPRITES = ['corpse_skel_s', 'corpse_skel_m', 'corpse_skel_l', 'corpse_carcass_s', 'corpse_carcass_m', 'corpse_carcass_l',
  'corpse_skel_pawn', 'corpse_rot_0', 'fx_fly', 'item_bone'];
