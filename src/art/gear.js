// Held gear (Art B): tools & weapons in material tiers, shields (front/side/back), hand torch, bows (+ draw frames),
// a building hammer and projectiles. Every shape is generated once per type and re-skinned per material.
// Held sprites point UP with the anchor at the grip (grip centered horizontally so flips mirror in place).
// Names: held_<itemId> (CONTENT §2), held_<shield>_e / _n, held_bow_*_draw1/_draw, held_hammer, proj_arrow, proj_spear,
// proj_ice_spear (the winter walkers' thrown ice spear; sword_ice / spear_ice: translucent crystal blades with inner light).
// Legacy contract names (weapon_sword, weapon_axe, weapon_spear, weapon_club, tool_pickaxe) are aliases of iron tiers.
// GEAR is exported so items.js can paint the same objects as inventory icons.

import { spritePxFast as spritePx, rng, TAU, lin, rad, circle, mixc, rgb, hex } from './paint.js';
import { spline, rrect } from './kit.js';

const A = (c, a) => rgb(hex(c), a);

// ---------- materials ----------
export const MAT = {
  primitive: { kind: 'flake', base: '#8f8676', light: '#c9bfab', dark: '#5b5448', edge: '#e2d8c4' },
  stone: { kind: 'stone', base: '#8d8a84', light: '#c6c2b9', dark: '#55524d', edge: '#ddd8cd' },
  copper: { kind: 'metal', base: '#c47646', light: '#f6b984', dark: '#7a3b1c', edge: '#ffd9b0', patina: '#4ea58c' },
  iron: { kind: 'metal', base: '#73767b', light: '#b7bbc0', dark: '#3b3d41', edge: '#d9dcdf', rust: '#8b5634' },
  steel: { kind: 'metal', base: '#b6c1cc', light: '#f6f9fc', dark: '#677585', edge: '#ffffff', shine: true },
};
const HANDLE = {
  primitive: { wood: '#9b7f5a', woodD: '#5e4a32', wrap: '#a9a05e', wrapD: '#6d6838' }, // raw stick + plant fiber
  stone: { wood: '#8f6338', woodD: '#553820', wrap: '#c9a96c', wrapD: '#8a6c3a' },     // wood + cord
  copper: { wood: '#8a5e36', woodD: '#4f341d', wrap: '#7a4c2a', wrapD: '#4a2c16' },    // leather wrap
  iron: { wood: '#6f4a2b', woodD: '#3e2817', wrap: '#4c3322', wrapD: '#2a1a10' },
  steel: { wood: '#5e3e25', woodD: '#341f10', wrap: '#3b2a20', wrapD: '#1c120c' },
};

// ---------- shading helpers ----------
function metalFill(g, M, x0, y0, x1, y1) {
  return lin(g, x0, y0, x1, y1, [[0, M.light], [0.42, M.base], [1, M.dark]]);
}
// surface details for a material inside the current clip (bbox x0,y0,x1,y1)
function matDetail(g, M, x0, y0, x1, y1, seed) {
  const rand = rng(seed);
  const w = x1 - x0, h = y1 - y0;
  if (M.kind === 'flake' || M.kind === 'stone') {
    // knapped facets: angular light/dark planes
    for (let i = 0; i < (M.kind === 'flake' ? 7 : 5); i++) {
      const cx = x0 + rand() * w, cy = y0 + rand() * h, r = 2 + rand() * Math.min(w, h) * 0.35;
      g.fillStyle = rand() < 0.5 ? A(M.light, 0.45) : A(M.dark, 0.35);
      g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.9, cy - r * 0.1); g.lineTo(cx + r * 0.2, cy + r * 0.8); g.lineTo(cx - r * 0.8, cy + r * 0.2); g.closePath(); g.fill();
    }
    g.fillStyle = A(M.dark, 0.5);
    for (let i = 0; i < 6; i++) { g.beginPath(); circle(g, x0 + rand() * w, y0 + rand() * h, 0.4 + rand() * 0.4); g.fill(); }
  } else {
    if (M.patina) { g.fillStyle = A(M.patina, 0.55); for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(x0 + rand() * w, y0 + rand() * h, 0.8 + rand() * 1.4, 0.6 + rand(), rand() * 3, 0, TAU); g.fill(); } }
    if (M.rust) { g.fillStyle = A(M.rust, 0.5); for (let i = 0; i < 6; i++) { g.beginPath(); circle(g, x0 + rand() * w, y0 + rand() * h, 0.4 + rand() * 0.6); g.fill(); } }
    if (M.shine) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.save(); g.translate(x0 + w * 0.45, y0 + h * 0.4); g.rotate(-0.6); g.fillRect(-w, -0.7, w * 2, 1.4); g.restore(); }
  }
}
// wooden haft from y0 to y1 centered on cx; bands of wrap near the grip
function haft(g, H, cx, y0, y1, w, wrap, seed, crooked = 0) {
  const rand = rng(seed);
  g.fillStyle = lin(g, cx - w / 2, 0, cx + w / 2, 0, [[0, mixc(H.wood, '#fff', 0.22)], [0.45, H.wood], [1, H.woodD]]);
  g.beginPath();
  if (crooked) { spline(g, [[cx - w / 2, y0], [cx + w / 2, y0], [cx + w / 2 + crooked, (y0 + y1) / 2], [cx + w / 2 + 0.2, y1], [cx - w / 2 - 0.2, y1], [cx - w / 2 + crooked, (y0 + y1) / 2]], true, 0.5); }
  else { g.moveTo(cx - w / 2, y0); g.lineTo(cx + w / 2, y0); g.lineTo(cx + w / 2 + 0.3, y1); g.lineTo(cx - w / 2 - 0.3, y1); g.closePath(); }
  g.fill();
  // grain
  g.strokeStyle = A(H.woodD, 0.5); g.lineWidth = 0.6;
  for (let i = 0; i < 3; i++) { const x = cx - w * 0.3 + rand() * w * 0.6, ya = y0 + rand() * (y1 - y0) * 0.6; g.beginPath(); g.moveTo(x, ya); g.lineTo(x + (rand() - 0.5), ya + 6 + rand() * 8); g.stroke(); }
  if (crooked) { g.fillStyle = A(H.woodD, 0.7); for (let i = 0; i < 2; i++) { g.beginPath(); g.ellipse(cx + (rand() - 0.5) * w * 0.6, y0 + 8 + rand() * (y1 - y0 - 16), 0.9, 1.4, 0, 0, TAU); g.fill(); } }
  if (wrap) {
    const [wy0, wy1] = wrap;
    g.fillStyle = H.wrap; g.fillRect(cx - w / 2 - 0.4, wy0, w + 0.8, wy1 - wy0);
    g.strokeStyle = H.wrapD; g.lineWidth = 0.8;
    for (let y = wy0 + 1; y < wy1; y += 1.8) { g.beginPath(); g.moveTo(cx - w / 2 - 0.4, y); g.lineTo(cx + w / 2 + 0.4, y + 1); g.stroke(); }
  }
}
// cord / fiber lashing crossing at (x, y)
function lashing(g, H, x, y, w, h, n = 4) {
  g.strokeStyle = H.wrap; g.lineWidth = 1.5;
  for (let i = 0; i < n; i++) { const yy = y - h / 2 + (i + 0.5) * (h / n); g.beginPath(); g.moveTo(x - w / 2, yy + 0.8); g.lineTo(x + w / 2, yy - 0.8); g.stroke(); }
  g.strokeStyle = H.wrapD; g.lineWidth = 0.6;
  for (let i = 0; i < n; i++) { const yy = y - h / 2 + (i + 0.5) * (h / n) + 0.9; g.beginPath(); g.moveTo(x - w / 2, yy + 0.8); g.lineTo(x + w / 2, yy - 0.8); g.stroke(); }
  g.strokeStyle = H.wrap; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(x - w / 2, y - h / 2); g.lineTo(x + w / 2, y + h / 2); g.stroke();
}
function fillMat(g, M, path, box, seed) {
  g.beginPath(); path(g);
  g.fillStyle = M.kind === 'metal' ? metalFill(g, M, box[0], box[1], box[2], box[3]) : lin(g, box[0], box[1], box[2], box[3], [[0, M.light], [0.5, M.base], [1, M.dark]]);
  g.fill();
  g.save(); g.beginPath(); path(g); g.clip(); matDetail(g, M, box[0], box[1], box[2], box[3], seed); g.restore();
}

// ---------- tool & weapon shapes ----------
// Each type: { W, H, gy (grip y, px), layers(g, tier) → [fnHaft, fnHead] } in the sprite px box, pointing up.
const T = {};

T.knife = {
  W: 18, H: 46, gy: 37,
  paint(tier) {
    const M = MAT[tier], H = HANDLE[tier], cx = 9;
    if (tier === 'primitive' || tier === 'stone') {
      const blade = tier === 'primitive'
        ? (g) => spline(g, [[cx + 0.5, 4], [cx + 4.2, 12], [cx + 3.6, 22], [cx + 2.6, 30], [cx - 2.6, 30], [cx - 3.8, 20], [cx - 2.6, 11]], true, 0.7)
        : (g) => { g.moveTo(cx, 3); g.lineTo(cx + 3.6, 10); g.lineTo(cx + 3.2, 20); g.lineTo(cx + 2.6, 30); g.lineTo(cx - 2.6, 30); g.lineTo(cx - 3.2, 20); g.lineTo(cx - 3.6, 10); g.closePath(); };
      return [
        (g) => haft(g, H, cx, 26, 44, 4.2, null, 11, tier === 'primitive' ? 0.6 : 0),
        (g) => {
          fillMat(g, M, blade, [cx - 4, 3, cx + 4, 30], 21 + tier.length);
          if (tier === 'stone') { g.strokeStyle = A(M.dark, 0.6); g.lineWidth = 0.6; for (let y = 8; y < 28; y += 3) { g.beginPath(); g.moveTo(cx + 3.4, y); g.lineTo(cx + 1.8, y + 1.4); g.moveTo(cx - 3.4, y + 1.5); g.lineTo(cx - 1.8, y + 2.9); g.stroke(); } }
          lashing(g, H, cx, 30, 5.6, 6, 3);
        },
      ];
    }
    return [
      (g) => {
        haft(g, H, cx, 31, 43.5, 4.6, [33, 41], 12);
        g.fillStyle = metalFill(g, M, cx - 3, 42, cx + 3, 45); g.beginPath(); g.ellipse(cx, 43.8, 2.8, 1.8, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); circle(g, cx - 0.8, 43.3, 0.6); g.fill();
      },
      (g) => {
        // single-edged blade: straight spine (left), curved edge (right)
        const path = (g) => { g.moveTo(cx - 2.2, 30); g.lineTo(cx - 2.4, 9); g.quadraticCurveTo(cx - 1.6, 4, cx + 0.6, 3); g.quadraticCurveTo(cx + 4.2, 12, cx + 3.4, 30); g.closePath(); };
        fillMat(g, M, path, [cx - 3, 3, cx + 4, 30], 33 + tier.length);
        g.strokeStyle = A(M.edge, 0.9); g.lineWidth = 0.9; g.beginPath(); g.moveTo(cx + 1, 5); g.quadraticCurveTo(cx + 3.6, 13, cx + 2.9, 28); g.stroke();
        g.fillStyle = metalFill(g, M, cx - 4, 29, cx + 4, 32); g.beginPath(); rrect(g, cx - 4, 29.4, 8, 2.6, 1); g.fill();
      },
    ];
  },
};

T.axe = {
  W: 40, H: 64, gy: 53,
  paint(tier) {
    const M = MAT[tier], H = HANDLE[tier], cx = 20;
    const haftFn = (g) => haft(g, H, cx, 6, 60, tier === 'primitive' ? 4.2 : 4.6, tier === 'primitive' ? null : [48, 58], 41, tier === 'primitive' ? 1 : 0);
    if (tier === 'primitive') {
      return [haftFn, (g) => {
        // triangular chipped flake lashed to the side of a stick
        // sharp knapped flake (angular facets), cutting edge to the right
        fillMat(g, M, (g) => { g.moveTo(cx + 1, 9); g.lineTo(cx + 8, 5.5); g.lineTo(cx + 15.5, 4.5); g.lineTo(cx + 17.5, 11); g.lineTo(cx + 16, 18); g.lineTo(cx + 12, 23); g.lineTo(cx + 6, 20.5); g.lineTo(cx + 1, 19); g.closePath(); }, [cx, 4, cx + 18, 23], 51);
        g.strokeStyle = A(M.dark, 0.6); g.lineWidth = 0.6; g.beginPath(); g.moveTo(cx + 8, 5.8); g.lineTo(cx + 10, 13); g.lineTo(cx + 6, 20.2); g.moveTo(cx + 10, 13); g.lineTo(cx + 17, 11.2); g.stroke();
        g.strokeStyle = A(M.edge, 0.9); g.lineWidth = 1; g.beginPath(); g.moveTo(cx + 15.6, 5); g.lineTo(cx + 17.3, 11); g.lineTo(cx + 15.8, 17.8); g.lineTo(cx + 12, 22.5); g.stroke();
        lashing(g, H, cx + 0.5, 14, 7, 13, 5);
      }];
    }
    if (tier === 'stone') {
      return [haftFn, (g) => {
        // ground stone axe head wedged through the haft, bound with cord
        // polished stone wedge: narrow butt, flared cutting edge
        fillMat(g, M, (g) => spline(g, [[cx - 6, 12.5], [cx + 2, 10.5], [cx + 11, 6.5], [cx + 16.5, 7], [cx + 18.5, 14], [cx + 16.5, 21], [cx + 11, 21.5], [cx + 2, 17.5], [cx - 6, 15.5]], true, 0.55), [cx - 6, 6, cx + 19, 22], 52);
        g.strokeStyle = A(M.edge, 0.95); g.lineWidth = 1.1; g.beginPath(); g.moveTo(cx + 16.4, 7.6); g.quadraticCurveTo(cx + 19, 14, cx + 16.4, 20.4); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(cx + 9, 10.5, 4, 1.2, -0.35, 0, TAU); g.fill();
        lashing(g, H, cx, 14, 6.4, 12, 4);
      }];
    }
    // metal: copper = simple flat blade, iron = bearded, steel = broad crescent
    const shapes = {
      copper: [[cx - 4, 10], [cx + 6, 10.5], [cx + 14, 6.5], [cx + 17, 13.5], [cx + 14, 21], [cx + 6, 17.5], [cx - 4, 18.5]],
      iron: [[cx - 5, 10.5], [cx + 5, 10], [cx + 12, 4.5], [cx + 17.5, 12], [cx + 16, 25], [cx + 11, 21], [cx + 5, 18.5], [cx - 5, 18]],
      steel: [[cx - 6, 10], [cx + 5, 9.5], [cx + 12, 2.5], [cx + 19, 13], [cx + 17, 26.5], [cx + 11, 21.5], [cx + 5, 19], [cx - 6, 18.5], [cx - 9, 14]],
    };
    return [haftFn, (g) => {
      fillMat(g, M, (g) => spline(g, shapes[tier], true, 0.55), [cx - 8, 3, cx + 19, 26], 53 + tier.length);
      g.strokeStyle = A(M.edge, 0.95); g.lineWidth = 1.4;
      g.beginPath(); if (tier === 'copper') { g.moveTo(cx + 14.5, 8); g.quadraticCurveTo(cx + 17, 13.5, cx + 14.2, 19.5); } else if (tier === 'iron') { g.moveTo(cx + 13, 6); g.quadraticCurveTo(cx + 18, 14, cx + 15.6, 23); } else { g.moveTo(cx + 13, 4.5); g.quadraticCurveTo(cx + 19.5, 14, cx + 16.6, 25); } g.stroke();
      // eye around the haft
      g.fillStyle = A(M.dark, 0.6); g.beginPath(); g.ellipse(cx, 14.3, 2.6, 3.6, 0, 0, TAU); g.fill();
      g.fillStyle = metalFill(g, M, cx - 4, 8, cx + 4, 21); g.beginPath(); rrect(g, cx - 3.6, 8.5, 7.2, 3, 1); rrect(g, cx - 3.6, 17, 7.2, 3, 1); g.fill();
    }];
  },
};

T.pickaxe = {
  W: 56, H: 64, gy: 53,
  paint(tier) {
    const M = MAT[tier], H = HANDLE[tier], cx = 28;
    const haftFn = (g) => haft(g, H, cx, 8, 60, tier === 'primitive' ? 4.2 : 4.6, tier === 'primitive' ? null : [48, 58], 61, tier === 'primitive' ? 1 : 0);
    if (tier === 'primitive') {
      return [haftFn, (g) => {
        fillMat(g, M, (g) => spline(g, [[cx - 2, 8], [cx + 6, 6.5], [cx + 15, 9], [cx + 22, 15], [cx + 13, 13.5], [cx + 4, 14], [cx - 2, 13]], true, 0.6), [cx - 2, 6, cx + 22, 15], 71);
        lashing(g, H, cx, 11, 7, 10, 4);
      }];
    }
    const pts = tier === 'stone'
      ? [[cx - 20, 15], [cx - 13, 8], [cx - 4, 6], [cx + 4, 6], [cx + 13, 8], [cx + 20, 15], [cx + 12, 12.5], [cx + 4, 13], [cx - 4, 13], [cx - 12, 12.5]]
      : tier === 'copper'
        ? [[cx - 21, 16], [cx - 14, 8], [cx - 4, 5.5], [cx + 4, 5.5], [cx + 14, 8], [cx + 21, 16], [cx + 13, 11.5], [cx + 4, 12], [cx - 4, 12], [cx - 13, 11.5]]
        : [[cx - 25, 18], [cx - 16, 8], [cx - 4, 5], [cx + 4, 5], [cx + 16, 8], [cx + 25, 18], [cx + 14, 11], [cx + 4, 11.5], [cx - 4, 11.5], [cx - 14, 11]];
    return [haftFn, (g) => {
      fillMat(g, M, (g) => spline(g, pts, true, 0.5), [cx - 25, 4, cx + 25, 16], 72 + tier.length);
      g.strokeStyle = A(M.edge, 0.85); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(cx - 20, 14); g.quadraticCurveTo(cx - 12, 7.6, cx - 3, 7); g.stroke();
      if (tier === 'stone') lashing(g, H, cx, 10, 7, 9, 4);
      else { g.fillStyle = metalFill(g, M, cx - 4, 4, cx + 4, 14); g.beginPath(); rrect(g, cx - 4, 4, 8, 10, 1.5); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(cx - 3, 5, 1.6, 8); }
    }];
  },
};

T.spear = {
  W: 22, H: 100, gy: 78,
  paint(tier) {
    const M = MAT[tier], H = HANDLE[tier], cx = 11;
    const shaft = (g) => haft(g, H, cx, 18, 97, 3.6, [72, 84], 81, 0);
    const heads = {
      stone: [[cx, 2], [cx + 4.6, 10], [cx + 3.6, 19], [cx + 2, 23], [cx - 2, 23], [cx - 3.6, 19], [cx - 4.6, 10]],
      copper: [[cx, 1], [cx + 5, 10], [cx + 4.4, 18], [cx + 1.6, 23], [cx - 1.6, 23], [cx - 4.4, 18], [cx - 5, 10]],
      iron: [[cx, 0], [cx + 3.6, 9], [cx + 3.4, 19], [cx + 1.6, 24], [cx - 1.6, 24], [cx - 3.4, 19], [cx - 3.6, 9]],
      steel: [[cx, -2], [cx + 4.2, 8], [cx + 4.4, 18], [cx + 1.8, 24], [cx - 1.8, 24], [cx - 4.4, 18], [cx - 4.2, 8]],
    };
    return [shaft, (g) => {
      fillMat(g, M, (g) => spline(g, heads[tier], true, tier === 'stone' ? 0.6 : 0.45), [cx - 5, 0, cx + 5, 24], 91 + tier.length);
      g.strokeStyle = A(M.dark, 0.6); g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx, 4); g.lineTo(cx, 21); g.stroke();
      g.strokeStyle = A(M.edge, 0.8); g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx - 0.9, 4); g.quadraticCurveTo(cx - 3.6, 11, cx - 2.6, 20); g.stroke();
      if (tier === 'stone') lashing(g, H, cx, 23, 5.2, 6, 3);
      else {
        g.fillStyle = metalFill(g, M, cx - 3, 22, cx + 3, 29); g.beginPath(); g.moveTo(cx - 2, 22); g.lineTo(cx + 2, 22); g.lineTo(cx + 2.6, 29); g.lineTo(cx - 2.6, 29); g.closePath(); g.fill();
        g.fillStyle = A(M.dark, 0.8); g.beginPath(); circle(g, cx, 26, 0.7); g.fill();
        if (tier === 'steel') { g.fillStyle = metalFill(g, M, cx - 6, 24, cx + 6, 27); g.fillRect(cx - 5.5, 24, 11, 2.2); }
      }
    }];
  },
};

T.sword = {
  W: 28, H: 68, gy: 54,
  paint(tier) {
    const M = MAT[tier], H = HANDLE[tier], cx = 14;
    const guardM = tier === 'steel' ? { ...MAT.copper, base: '#c9a24e', light: '#f3dc96', dark: '#7a5a22', patina: null } : M;
    const bladeTop = tier === 'copper' ? 6 : tier === 'iron' ? 4 : 1;
    const blade = tier === 'copper'
      ? [[cx, bladeTop], [cx + 3.6, 14], [cx + 4.4, 26], [cx + 2.8, 38], [cx + 2.6, 44], [cx - 2.6, 44], [cx - 2.8, 38], [cx - 4.4, 26], [cx - 3.6, 14]]
      : [[cx, bladeTop], [cx + 3.6, bladeTop + 7], [cx + 3.4, 44], [cx - 3.4, 44], [cx - 3.6, bladeTop + 7]];
    return [
      (g) => {
        haft(g, H, cx, 46, 58, 4.6, tier === 'copper' ? null : [47, 57], 101);
        if (tier === 'copper') { g.fillStyle = A(M.dark, 0.9); for (const y of [49, 53]) { g.beginPath(); circle(g, cx, y, 0.9); g.fill(); } }
        // pommel
        const PM = tier === 'steel' ? guardM : M;
        g.fillStyle = metalFill(g, PM, cx - 3.5, 57, cx + 3.5, 63); g.beginPath(); circle(g, cx, 60, tier === 'steel' ? 3.4 : 3); g.fill();
        g.fillStyle = A(PM.edge || '#fff', 0.8); g.beginPath(); circle(g, cx - 1, 59, 0.9); g.fill();
        if (tier === 'steel') { g.fillStyle = '#b02a2a'; g.beginPath(); circle(g, cx, 60, 1.3); g.fill(); g.fillStyle = 'rgba(255,220,220,0.8)'; g.beginPath(); circle(g, cx - 0.4, 59.6, 0.4); g.fill(); }
      },
      (g) => {
        fillMat(g, M, (g) => (tier === 'copper' ? spline(g, blade, true, 0.5) : (g.moveTo(blade[0][0], blade[0][1]), blade.slice(1).forEach((p) => g.lineTo(p[0], p[1])), g.closePath())), [cx - 4.5, bladeTop, cx + 4.5, 44], 111 + tier.length);
        // fuller + edge light
        if (tier !== 'copper') { g.fillStyle = A(M.dark, 0.55); g.fillRect(cx - 0.6, bladeTop + 8, 1.2, 33); }
        else { g.strokeStyle = A(M.dark, 0.55); g.lineWidth = 0.9; g.beginPath(); g.moveTo(cx, bladeTop + 4); g.lineTo(cx, 42); g.stroke(); }
        g.fillStyle = A(M.edge, 0.9); g.beginPath(); g.moveTo(cx - 0.4, bladeTop + 2); g.lineTo(cx - 2.8, bladeTop + 8); g.lineTo(cx - 2.6, 41); g.lineTo(cx - 1.6, 41); g.lineTo(cx - 1.4, bladeTop + 8); g.closePath(); g.fill();
        // guard
        const gw = tier === 'copper' ? 6.5 : tier === 'iron' ? 9 : 10.5;
        g.fillStyle = metalFill(g, guardM, cx - gw, 43, cx + gw, 47.5);
        g.beginPath();
        if (tier === 'steel') { g.moveTo(cx - gw, 42); g.quadraticCurveTo(cx - gw * 0.5, 45, cx, 43.6); g.quadraticCurveTo(cx + gw * 0.5, 45, cx + gw, 42); g.lineTo(cx + gw - 1, 45); g.quadraticCurveTo(cx, 48.5, cx - gw + 1, 45); g.closePath(); }
        else rrect(g, cx - gw, 43.5, gw * 2, 3.4, 1.4);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(cx - gw + 1.2, 44, gw * 2 - 2.4, 0.8);
      },
    ];
  },
};

T.club = {
  W: 30, H: 62, gy: 51,
  paint(tier) {
    const cx = 15;
    if (tier === 'wood') {
      const H = HANDLE.stone;
      return [(g) => {
        g.beginPath(); g.moveTo(cx - 2.4, 57); g.lineTo(cx - 3, 42); g.bezierCurveTo(cx - 9, 28, cx - 8, 8, cx, 5); g.bezierCurveTo(cx + 8, 8, cx + 9, 28, cx + 3, 42); g.lineTo(cx + 2.4, 57); g.closePath();
        g.fillStyle = lin(g, cx - 8, 0, cx + 8, 0, [[0, '#b58a55'], [0.5, '#8c623b'], [1, '#553820']]); g.fill();
        g.fillStyle = '#5a3c22';
        for (const [x, y] of [[cx - 4, 15], [cx + 3, 23], [cx - 2, 31], [cx + 4, 11]]) { g.beginPath(); g.ellipse(x, y, 1.8, 1.3, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,230,190,0.35)'; g.beginPath(); g.ellipse(x - 0.4, y - 0.5, 0.8, 0.5, 0, 0, TAU); g.fill(); g.fillStyle = '#5a3c22'; }
        g.strokeStyle = 'rgba(255,230,190,0.5)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx - 4, 11); g.quadraticCurveTo(cx - 6, 23, cx - 2.5, 37); g.stroke();
        g.strokeStyle = 'rgba(60,36,16,0.5)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(cx + 2, 9); g.quadraticCurveTo(cx + 5, 22, cx + 1, 40); g.stroke();
        g.fillStyle = H.wrap; g.fillRect(cx - 3, 46, 6, 8);
        g.strokeStyle = H.wrapD; g.lineWidth = 0.8; for (let y = 47; y < 54; y += 1.8) { g.beginPath(); g.moveTo(cx - 3, y); g.lineTo(cx + 3, y + 1); g.stroke(); }
      }];
    }
    // iron mace: flanged head on a wooden shaft with iron collar
    const M = MAT.iron, H = HANDLE.iron;
    return [(g) => haft(g, H, cx, 16, 58, 4.2, [46, 56], 121), (g) => {
      const head = (g) => spline(g, [[cx, 2], [cx + 7, 6], [cx + 9, 12], [cx + 7, 19], [cx, 22], [cx - 7, 19], [cx - 9, 12], [cx - 7, 6]], true, 0.7);
      fillMat(g, M, head, [cx - 9, 2, cx + 9, 22], 131);
      // flanges
      g.fillStyle = metalFill(g, M, cx - 12, 4, cx + 12, 20);
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 7, 6); g.lineTo(cx + s * 12.5, 10); g.lineTo(cx + s * 12.5, 15); g.lineTo(cx + s * 7, 18); g.closePath(); g.fill(); }
      g.fillStyle = A(M.dark, 0.7); g.beginPath(); g.moveTo(cx, 1); g.lineTo(cx + 2.4, 7); g.lineTo(cx, 22); g.lineTo(cx - 2.4, 7); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(cx - 4, 8, 1.6, 3, 0.4, 0, TAU); g.fill();
      g.fillStyle = metalFill(g, M, cx - 4, 21, cx + 4, 25); g.beginPath(); rrect(g, cx - 3.6, 21, 7.2, 3.4, 1); g.fill();
      g.fillStyle = A(M.rust, 0.6); g.beginPath(); circle(g, cx + 3, 15, 0.8); circle(g, cx - 5, 13, 0.6); g.fill();
    }];
  },
};

// ---------- bows (drawn pointing EAST: arc bulges right, string on the left) ----------
const BOW = {
  wood: { wood: '#a5743f', woodD: '#5e3d1e', grip: '#6b4426', gripD: '#3e2412', recurve: 0, string: '#efe6cf' },
  composite: { wood: '#5a3a26', woodD: '#2a1a10', back: '#d8c49a', grip: '#8a2a22', gripD: '#4a120e', recurve: 1, string: '#f4eedd' },
};
function bowPaint(kind, draw) {
  const B = BOW[kind];
  const W = 46, H = 78, cx = 23, cy = 39;
  // draw: 0 rest, 1 half, 2 full
  const pull = draw === 2 ? 13 : draw === 1 ? 7 : 0;
  const tipX = cx - 6 + pull * 0.25, tipY = 5 + pull * 0.35, bulge = 7 + pull * 0.15;
  const limb = (g, s) => {
    const ty = cy + s * (cy - tipY);
    const pts = B.recurve
      ? [[cx + 1, cy + s * 3], [cx + bulge, cy + s * 14], [cx + 1, cy + s * 30 - s * pull * 0.2], [tipX - 1, ty - s * 3], [tipX + 3.5, ty]]
      : [[cx + 1, cy + s * 3], [cx + bulge, cy + s * 16], [cx + 2, cy + s * 29 - s * pull * 0.2], [tipX, ty]];
    return pts;
  };
  const layers = [
    // string (behind) + nocked arrow
    (g) => {
      g.strokeStyle = B.string; g.lineWidth = 0.9;
      const top = limb(g, -1), bot = limb(g, 1), t = top[top.length - 1], b = bot[bot.length - 1];
      g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(pull ? cx - pull : t[0], cy); g.lineTo(b[0], b[1]); g.stroke();
      if (draw) {
        const nx = cx - pull;
        g.fillStyle = '#c49a62'; g.fillRect(nx, cy - 0.8, 41 - pull * 0.2, 1.6);
        g.fillStyle = '#7a7d82'; g.beginPath(); g.moveTo(nx + 40, cy - 2.6); g.lineTo(nx + 45, cy); g.lineTo(nx + 40, cy + 2.6); g.closePath(); g.fill();
        g.fillStyle = '#e8e2d6'; g.beginPath(); g.moveTo(nx + 1, cy); g.lineTo(nx + 7, cy - 3.2); g.lineTo(nx + 9, cy - 0.6); g.closePath(); g.moveTo(nx + 1, cy); g.lineTo(nx + 7, cy + 3.2); g.lineTo(nx + 9, cy + 0.6); g.closePath(); g.fill();
        g.fillStyle = '#b8402e'; g.fillRect(nx + 3, cy - 0.6, 1.2, 1.2);
      }
    },
    (g) => {
      for (const s of [-1, 1]) {
        const pts = limb(g, s);
        g.strokeStyle = B.woodD; g.lineWidth = 4.2; g.lineCap = 'round';
        g.beginPath(); spline(g, pts, false, 0.8); g.stroke();
        g.strokeStyle = B.wood; g.lineWidth = 3;
        g.beginPath(); spline(g, pts, false, 0.8); g.stroke();
        if (B.back) { g.strokeStyle = B.back; g.lineWidth = 1.1; g.beginPath(); spline(g, pts.map(([x, y]) => [x + 1, y]), false, 0.8); g.stroke(); }
        g.strokeStyle = 'rgba(255,240,210,0.45)'; g.lineWidth = 0.8; g.beginPath(); spline(g, pts.map(([x, y]) => [x - 0.7, y]), false, 0.8); g.stroke();
        if (B.recurve) { const t = pts[pts.length - 1]; g.fillStyle = B.back; g.beginPath(); circle(g, t[0], t[1], 1.6); g.fill(); g.fillStyle = B.grip; g.fillRect(cx + bulge - 2.4, cy + s * 14 - 1, 4, 2); }
      }
      // grip
      g.fillStyle = B.grip; g.beginPath(); rrect(g, cx - 1.5, cy - 5, 5, 10, 1.6); g.fill();
      g.strokeStyle = B.gripD; g.lineWidth = 0.7; for (let y = cy - 4; y < cy + 5; y += 1.8) { g.beginPath(); g.moveTo(cx - 1.5, y); g.lineTo(cx + 3.5, y + 0.8); g.stroke(); }
    },
  ];
  return { W, H, gx: cx, gy: cy, layers, ow: [1.2, 2.2] };
}

// ---------- shields ----------
// views: 'f' front (face), 'e' side (edge-on, face toward east), 'n' back (inside with straps)
const SHIELD = {
  shield_wood: { shape: 'round', r: 13.5, face: '#9a6c40', faceD: '#5e3d20', rim: '#6b6b6e', rimD: '#3a3a3c', boss: MAT.iron, planks: true },
  shield_copper: { shape: 'round', r: 14.5, face: '#c47646', faceD: '#7a3b1c', rim: '#8a4a26', rimD: '#4c2410', boss: MAT.copper, metal: MAT.copper },
  shield_iron: { shape: 'heater', r: 15, face: '#73767b', faceD: '#3b3d41', rim: '#a9adb2', rimD: '#4a4c50', boss: MAT.steel, metal: MAT.iron, emblem: '#8a2a22' },
};
function shieldPath(g, S, cx, cy, sx = 1) {
  if (S.shape === 'round') { g.ellipse(cx, cy, S.r * sx, S.r, 0, 0, TAU); return; }
  const r = S.r;
  g.moveTo(cx - r * sx, cy - r * 0.85);
  g.quadraticCurveTo(cx, cy - r * 1.05, cx + r * sx, cy - r * 0.85);
  g.bezierCurveTo(cx + r * sx, cy + r * 0.2, cx + r * 0.6 * sx, cy + r * 0.75, cx, cy + r * 1.15);
  g.bezierCurveTo(cx - r * 0.6 * sx, cy + r * 0.75, cx - r * sx, cy + r * 0.2, cx - r * sx, cy - r * 0.85);
  g.closePath();
}
function shieldPaint(id, view) {
  const S = SHIELD[id];
  const W = 36, H = 38, cx = 18, cy = 19;
  const rand = rng(id.length * 7 + view.charCodeAt(0));
  if (view === 'e') {
    // edge-on: a narrow lens with the convex face toward +x and a boss sticking out
    return { W: 16, H, gx: 8, gy: cy, layers: [(g) => {
      const ex = 8, sx = 0.32;
      g.beginPath(); shieldPath(g, S, ex, cy, sx); g.fillStyle = S.rimD; g.fill();
      g.beginPath(); shieldPath(g, S, ex + 1.4, cy, sx * 0.75);
      g.fillStyle = S.metal ? metalFill(g, S.metal, ex - 3, cy - 15, ex + 5, cy + 15) : lin(g, ex - 3, 0, ex + 5, 0, [[0, S.face], [1, S.faceD]]); g.fill();
      g.fillStyle = metalFill(g, S.boss, ex + 2, cy - 4, ex + 8, cy + 4); g.beginPath(); g.ellipse(ex + 4.6, cy, 2.6, 4, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(ex - 1, cy - S.r * 0.8, 1, S.r * 1.5);
    }] };
  }
  if (view === 'n') {
    return { W, H, gx: cx, gy: cy, layers: [(g) => {
      g.beginPath(); shieldPath(g, S, cx, cy); g.fillStyle = S.rimD; g.fill();
      g.beginPath(); shieldPath(g, S, cx, cy, 0.9); g.fillStyle = lin(g, cx - 14, cy - 14, cx + 14, cy + 14, [[0, '#9a7448'], [1, '#5a3c20']]); g.fill();
      g.save(); g.beginPath(); shieldPath(g, S, cx, cy, 0.9); g.clip();
      g.strokeStyle = 'rgba(50,30,14,0.55)'; g.lineWidth = 0.8;
      for (let x = cx - 12; x < cx + 13; x += 5) { g.beginPath(); g.moveTo(x, cy - 16); g.lineTo(x, cy + 16); g.stroke(); }
      g.restore();
      // straps & grip
      g.fillStyle = '#5a3a22'; g.fillRect(cx - 9, cy - 4, 18, 3.2); g.fillRect(cx - 9, cy + 3, 18, 3.2);
      g.fillStyle = '#c9a24e'; for (const [x, y] of [[cx - 8, cy - 2.4], [cx + 8, cy - 2.4], [cx - 8, cy + 4.6], [cx + 8, cy + 4.6]]) { g.beginPath(); circle(g, x, y, 1); g.fill(); }
    }] };
  }
  return { W, H, gx: cx, gy: cy, layers: [(g) => {
    // rim
    g.beginPath(); shieldPath(g, S, cx, cy); g.fillStyle = lin(g, cx - S.r, cy - S.r, cx + S.r, cy + S.r, [[0, mixc(S.rim, '#fff', 0.3)], [0.5, S.rim], [1, S.rimD]]); g.fill();
    // face
    g.save(); g.beginPath(); shieldPath(g, S, cx, cy, 0.86); g.clip();
    if (S.metal) {
      g.fillStyle = metalFill(g, S.metal, cx - S.r, cy - S.r, cx + S.r, cy + S.r); g.fillRect(0, 0, W, H);
      matDetail(g, S.metal, cx - S.r, cy - S.r, cx + S.r, cy + S.r, 141 + id.length);
      if (S.shape === 'round') {
        g.strokeStyle = A(S.metal.dark, 0.55); g.lineWidth = 1; for (const r of [6.5, 10.5]) { g.beginPath(); g.ellipse(cx, cy, r, r, 0, 0, TAU); g.stroke(); }
        g.strokeStyle = A(S.metal.light, 0.6); g.lineWidth = 0.8; for (const r of [7.3, 11.3]) { g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.6); g.stroke(); }
      } else {
        // heraldic red band + cross reinforcement
        g.fillStyle = S.emblem; g.beginPath(); g.moveTo(cx - 3.5, cy - 16); g.lineTo(cx + 3.5, cy - 16); g.lineTo(cx + 3.5, cy + 18); g.lineTo(cx - 3.5, cy + 18); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,180,160,0.25)'; g.fillRect(cx - 3.5, cy - 16, 1.4, 34);
        g.fillStyle = A(S.metal.dark, 0.5); g.fillRect(cx - 16, cy - 3, 32, 2);
      }
    } else {
      g.fillStyle = lin(g, cx - S.r, cy - S.r, cx + S.r, cy + S.r, [[0, mixc(S.face, '#fff', 0.2)], [0.5, S.face], [1, S.faceD]]); g.fillRect(0, 0, W, H);
      // vertical planks with grain
      for (let x = cx - 12, i = 0; x < cx + 13; x += 5, i++) {
        g.fillStyle = i % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,240,210,0.08)'; g.fillRect(x, cy - 16, 5, 32);
        g.strokeStyle = 'rgba(50,30,14,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, cy - 16); g.lineTo(x, cy + 16); g.stroke();
        g.strokeStyle = 'rgba(70,44,20,0.35)'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(x + 2 + rand(), cy - 12); g.lineTo(x + 2.5 + rand(), cy + 10); g.stroke();
      }
      g.fillStyle = 'rgba(40,26,12,0.55)'; for (const y of [cy - 8, cy + 8]) for (let x = cx - 10; x < cx + 12; x += 5) { g.beginPath(); circle(g, x + 2.5, y, 0.7); g.fill(); }
    }
    // soft top-left sheen + bottom-right shade
    g.fillStyle = rad(g, cx - S.r * 0.4, cy - S.r * 0.5, 0, S.r * 1.4, [[0, 'rgba(255,250,235,0.25)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']]); g.fillRect(0, 0, W, H);
    g.restore();
    // rim rivets
    g.fillStyle = mixc(S.rim, '#fff', 0.5);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.3; const r = S.r * 0.93; if (S.shape !== 'round' && Math.sin(a) > 0.6) continue; g.beginPath(); circle(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r * (S.shape === 'round' ? 1 : 0.9), 0.75); g.fill(); }
    // boss
    const br = S.shape === 'round' ? 4.4 : 3.6, by = S.shape === 'round' ? cy : cy - 1;
    g.fillStyle = A('#000', 0.35); g.beginPath(); g.ellipse(cx + 0.8, by + 1, br, br, 0, 0, TAU); g.fill();
    g.fillStyle = rad(g, cx - br * 0.4, by - br * 0.4, 0.5, br * 1.2, [[0, S.boss.light], [0.5, S.boss.base], [1, S.boss.dark]]);
    g.beginPath(); g.ellipse(cx, by, br, br, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); circle(g, cx - br * 0.35, by - br * 0.4, br * 0.25); g.fill();
  }] };
}

// ---------- hand torch & building hammer ----------
export const TORCH_TIP = 0.5; // tiles from the grip to the flame base (along the torch)
function torchPaint() {
  const H = HANDLE.primitive, cx = 8;
  return { W: 16, H: 46, gx: cx, gy: 37, layers: [
    (g) => haft(g, H, cx, 14, 44, 4, null, 151, 0.5),
    (g) => {
      g.fillStyle = lin(g, cx - 5, 0, cx + 5, 0, [[0, '#b29a70'], [1, '#5e4a30']]);
      g.beginPath(); g.moveTo(cx - 4.6, 6); g.lineTo(cx + 4.6, 6); g.lineTo(cx + 3.6, 17); g.lineTo(cx - 3.6, 17); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,40,20,0.65)'; g.lineWidth = 0.9;
      for (let y = 8; y < 17; y += 2.6) { g.beginPath(); g.moveTo(cx - 4.4, y); g.lineTo(cx + 4.4, y + 1.4); g.stroke(); }
      g.fillStyle = '#231a14'; g.beginPath(); g.ellipse(cx, 6, 4.6, 2, 0, 0, TAU); g.fill();
      g.fillStyle = '#e8762c'; g.beginPath(); g.ellipse(cx, 5.6, 2.6, 1, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffd27a'; g.beginPath(); g.ellipse(cx - 0.5, 5.4, 1, 0.45, 0, 0, TAU); g.fill();
    },
  ] };
}
function hammerPaint() {
  const H = HANDLE.stone, cx = 14;
  return { W: 28, H: 48, gx: cx, gy: 40, layers: [
    (g) => haft(g, H, cx, 10, 46, 3.8, [36, 44], 161),
    (g) => {
      g.fillStyle = metalFill(g, MAT.iron, cx - 10, 4, cx + 10, 13); g.beginPath(); rrect(g, cx - 10, 4, 20, 8.5, 2); g.fill();
      g.fillStyle = A(MAT.iron.dark, 0.6); g.fillRect(cx + 6.5, 4.5, 3, 7.6);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(cx - 9, 5, 15, 1.2);
      g.fillStyle = H.wrap; g.fillRect(cx - 2.4, 11.5, 4.8, 3);
    },
  ] };
}

// ---------- ice (winter walkers): translucent crystal with light running through it ----------
const ICE = { hi: '#f4fdff', light: '#c9f0fb', mid: '#8fd4ec', dark: '#3f8db0', deep: '#24607e', glow: 'rgba(170,250,255,0.95)' };
// crystal body: a pale gradient, darker facet on one side, inner light veins and a bright edge
function iceFill(g, path, x0, y0, x1, y1, seed, veins = 3) {
  const rand = rng(seed);
  g.beginPath(); path(g);
  g.fillStyle = lin(g, x0, y0, x1, y1, [[0, ICE.light], [0.45, ICE.mid], [1, ICE.dark]]); g.fill();
  g.save(); g.beginPath(); path(g); g.clip();
  g.fillStyle = 'rgba(36,96,126,0.35)'; g.fillRect((x0 + x1) / 2, y0, x1 - x0, y1 - y0);   // shaded facet
  g.strokeStyle = ICE.glow; g.lineWidth = 0.7;
  for (let i = 0; i < veins; i++) {
    const x = x0 + (x1 - x0) * (0.3 + rand() * 0.4), ya = y0 + (y1 - y0) * rand() * 0.3;
    g.beginPath(); g.moveTo(x, ya);
    for (let y = ya; y < y1; y += 4 + rand() * 4) g.lineTo(x + (rand() - 0.5) * (x1 - x0) * 0.35, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.55)'; for (let i = 0; i < 4; i++) { g.beginPath(); circle(g, x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 0.5 + rand() * 0.5); g.fill(); }
  g.restore();
}
const ICE_HAFT = { wood: '#5a6670', woodD: '#2c343c', wrap: '#3a4048', wrapD: '#1c2026' }; // frozen dark wood, hide wrap

T.sword.paintIce = () => {
  const cx = 14;
  const blade = [[cx, 0], [cx + 3.2, 6], [cx + 4.4, 18], [cx + 3.4, 32], [cx + 3.6, 43.5], [cx - 3.6, 43.5], [cx - 3.4, 32], [cx - 4.4, 18], [cx - 3.2, 6]];
  const bladeP = (g) => { g.moveTo(blade[0][0], blade[0][1]); blade.slice(1).forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); };
  return [
    (g) => {
      haft(g, ICE_HAFT, cx, 46, 58, 4.6, [47, 57], 131);
      // a pommel of clear ice
      g.fillStyle = lin(g, cx - 3.5, 57, cx + 3.5, 63, [[0, ICE.hi], [0.5, ICE.mid], [1, ICE.dark]]);
      g.beginPath(); g.moveTo(cx, 56.5); g.lineTo(cx + 3.4, 60); g.lineTo(cx, 64); g.lineTo(cx - 3.4, 60); g.closePath(); g.fill();
    },
    (g) => {
      iceFill(g, bladeP, cx - 4.4, 0, cx + 4.4, 44, 141, 3);
      // central ridge + edge light
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx - 0.3, 2); g.lineTo(cx - 0.6, 42); g.stroke();
      g.strokeStyle = ICE.hi; g.lineWidth = 0.7; g.beginPath(); g.moveTo(cx - 0.4, 1); g.lineTo(cx - 3.3, 7); g.lineTo(cx - 4.2, 18); g.lineTo(cx - 3.3, 32); g.stroke();
      // guard: jagged ice crystals growing sideways
      g.fillStyle = lin(g, cx - 10, 42, cx + 10, 48, [[0, ICE.light], [0.5, ICE.mid], [1, ICE.dark]]);
      g.beginPath(); g.moveTo(cx - 11, 43); g.lineTo(cx - 5, 43.6); g.lineTo(cx - 3, 42); g.lineTo(cx + 3, 42); g.lineTo(cx + 5, 43.6); g.lineTo(cx + 11, 43);
      g.lineTo(cx + 6, 46.6); g.lineTo(cx + 2, 47.4); g.lineTo(cx - 2, 47.4); g.lineTo(cx - 6, 46.6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(cx - 10, 43.3); g.lineTo(cx + 10, 43.3); g.stroke();
    },
  ];
};
T.spear.paintIce = () => {
  const cx = 11;
  const head = [[cx, -3], [cx + 3.4, 5], [cx + 4.6, 15], [cx + 2.2, 24], [cx - 2.2, 24], [cx - 4.6, 15], [cx - 3.4, 5]];
  const headP = (g) => { g.moveTo(head[0][0], head[0][1]); head.slice(1).forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); };
  return [
    (g) => haft(g, ICE_HAFT, cx, 18, 97, 3.6, [72, 84], 151, 0),
    (g) => {
      iceFill(g, headP, cx - 4.6, -3, cx + 4.6, 24, 161, 2);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx - 0.3, -1); g.lineTo(cx - 0.4, 22); g.stroke();
      // frost-bound socket: shards wrapped around the haft
      g.fillStyle = lin(g, cx - 4, 22, cx + 4, 31, [[0, ICE.light], [1, ICE.dark]]);
      g.beginPath(); g.moveTo(cx - 3.2, 22); g.lineTo(cx + 3.2, 22); g.lineTo(cx + 4.2, 26); g.lineTo(cx + 2.4, 31); g.lineTo(cx - 2.4, 31); g.lineTo(cx - 4.2, 26); g.closePath(); g.fill();
      g.strokeStyle = ICE.glow; g.lineWidth = 0.6; g.beginPath(); g.moveTo(cx - 2.6, 26); g.lineTo(cx + 2.6, 26); g.stroke();
    },
  ];
};

// ---------- registry ----------
// GEAR[itemId] = { W, H, gx, gy, layers: [fn...] }  (px, pointing up, grip at gx, gy)
export const GEAR = {};
const TIERS = {
  knife: ['primitive', 'stone', 'copper', 'iron', 'steel'],
  axe: ['primitive', 'stone', 'copper', 'iron', 'steel'],
  pickaxe: ['primitive', 'stone', 'copper', 'iron', 'steel'],
  spear: ['stone', 'copper', 'iron', 'steel'],
  sword: ['copper', 'iron', 'steel'],
  club: ['wood', 'iron'],
};
for (const type in TIERS) for (const tier of TIERS[type]) {
  const D = T[type];
  GEAR[`${type}_${tier}`] = { W: D.W, H: D.H, gx: D.W / 2, gy: D.gy, layers: D.paint(tier), type };
}
for (const k of ['wood', 'composite']) {
  GEAR['bow_' + k] = { ...bowPaint(k, 0), type: 'bow' };
  GEAR['bow_' + k + '_draw1'] = { ...bowPaint(k, 1), type: 'bow' };
  GEAR['bow_' + k + '_draw'] = { ...bowPaint(k, 2), type: 'bow' };
}
for (const id in SHIELD) {
  GEAR[id] = { ...shieldPaint(id, 'f'), type: 'shield' };
  GEAR[id + '_e'] = { ...shieldPaint(id, 'e'), type: 'shield' };
  GEAR[id + '_n'] = { ...shieldPaint(id, 'n'), type: 'shield' };
}
for (const type of ['sword', 'spear']) { const D = T[type]; GEAR[type + '_ice'] = { W: D.W, H: D.H, gx: D.W / 2, gy: D.gy, layers: D.paintIce(), type }; }
GEAR.torch_hand = { ...torchPaint(), type: 'torch' };
GEAR.hammer = { ...hammerPaint(), type: 'hammer' };

function heldSprite(D) {
  return spritePx(D.W, D.H, (g, P) => { D.layers.forEach((fn, i) => P.layer(fn, D.ow ? D.ow[i] : 2.3)); });
}

// ---------- projectiles (pointing EAST, anchor = center) ----------
function arrowProj() {
  return spritePx(44, 12, (g, P) => P.layer((g) => {
    const cy = 6;
    g.fillStyle = lin(g, 0, cy - 1, 0, cy + 1, [[0, '#d9b27a'], [1, '#8a6038']]); g.fillRect(6, cy - 0.9, 30, 1.8);
    g.fillStyle = metalFill(g, MAT.iron, 34, cy - 3, 42, cy + 3); g.beginPath(); g.moveTo(35, cy - 3); g.lineTo(42, cy); g.lineTo(35, cy + 3); g.lineTo(36.4, cy); g.closePath(); g.fill();
    g.fillStyle = '#efe8da'; g.beginPath(); g.moveTo(2, cy - 4); g.lineTo(11, cy - 0.6); g.lineTo(4, cy - 0.6); g.closePath(); g.moveTo(2, cy + 4); g.lineTo(11, cy + 0.6); g.lineTo(4, cy + 0.6); g.closePath(); g.fill();
    g.fillStyle = '#b8402e'; g.fillRect(8, cy - 0.9, 1.6, 1.8);
  }, 1.6));
}
function spearProj() {
  return spritePx(84, 14, (g, P) => {
    const cy = 7, H = HANDLE.iron, M = MAT.iron;
    P.layer((g) => {
      g.fillStyle = lin(g, 0, cy - 1.6, 0, cy + 1.6, [[0, mixc(H.wood, '#fff', 0.25)], [1, H.woodD]]); g.fillRect(2, cy - 1.6, 64, 3.2);
      g.fillStyle = H.wrap; g.fillRect(40, cy - 1.9, 10, 3.8);
      fillMat(g, M, (g) => spline(g, [[82, cy], [72, cy - 3.6], [62, cy - 3.4], [58, cy - 1.6], [58, cy + 1.6], [62, cy + 3.4], [72, cy + 3.6]], true, 0.5), [58, cy - 4, 82, cy + 4], 171);
      g.strokeStyle = A(M.edge, 0.8); g.lineWidth = 0.8; g.beginPath(); g.moveTo(62, cy - 2.6); g.quadraticCurveTo(70, cy - 3.4, 79, cy - 0.6); g.stroke();
    }, 1.8);
  });
}

// the walkers' thrown ice spear (pointing east like proj_spear)
function iceSpearProj() {
  return spritePx(86, 16, (g, P) => {
    const cy = 8;
    P.layer((g) => {
      g.fillStyle = lin(g, 0, cy - 1.6, 0, cy + 1.6, [[0, '#7c8a96'], [1, ICE_HAFT.woodD]]); g.fillRect(2, cy - 1.6, 62, 3.2);
      g.fillStyle = ICE_HAFT.wrap; g.fillRect(38, cy - 1.9, 10, 3.8);
      const head = (g) => { g.moveTo(85, cy); g.lineTo(76, cy - 3.6); g.lineTo(66, cy - 4.4); g.lineTo(58, cy - 2.4); g.lineTo(58, cy + 2.4); g.lineTo(66, cy + 4.4); g.lineTo(76, cy + 3.6); g.closePath(); };
      iceFill(g, head, 58, cy - 4.4, 85, cy + 4.4, 171, 2);
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(60, cy - 0.4); g.lineTo(83, cy - 0.3); g.stroke();
    }, 1.8);
  });
}

export function addGear(add) {
  for (const id in GEAR) {
    const D = GEAR[id];
    const c = heldSprite(D);
    add('held_' + id, c, D.gx / D.W, D.gy / D.H);
    // legacy contract names (iron tier look)
    const legacy = { sword_iron: 'weapon_sword', axe_iron: 'weapon_axe', pickaxe_iron: 'tool_pickaxe', spear_iron: 'weapon_spear', club_wood: 'weapon_club' }[id];
    if (legacy) add(legacy, c, D.gx / D.W, D.gy / D.H);
  }
  add('proj_arrow', arrowProj(), 0.5, 0.5);
  add('proj_spear', spearProj(), 0.5, 0.5);
  add('proj_ice_spear', iceSpearProj(), 0.5, 0.5);
}
