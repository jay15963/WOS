// Body & clothing part painters (agent H). White/grey art tinted by multiplication at runtime, drawn in the
// pawn body box (pawns.js BW × BH, feet at FEET) so every part lines up with the rig in the 3 facings.
// Layers (bottom → top): skin base · bottoms · top (primary) · pattern (secondary) · neckline (skin) ·
// top trims (secondary) · over layer · shoes. Tucked tops draw the bottoms after the top.
// Painter signature (contract with agent D): fn(g, d, e, rand) in box coordinates; registered in index.js.

import { TAU, lin, rad, circle, rng } from '../paint.js';
import { BW, BH, BELT, bodyPath } from '../pawns.js';

const DARK = (a) => `rgba(46,40,36,${a})`;
const LITE = (a) => `rgba(255,255,255,${a})`;
const atop = (g, fn) => { g.save(); g.globalCompositeOperation = 'source-atop'; fn(); g.restore(); };
const erase = (g, fn) => { g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.beginPath(); fn(); g.fill(); g.restore(); };
const clipBody = (g, d) => { g.beginPath(); bodyPath(g, d); g.clip(); };
const mirrorX = (x) => BW - x;

// ---------------- shared geometry ----------------
// arm (sleeve) region on one side; side -1 = screen left, +1 = right (s / n), e: the near arm
export function armPath(g, d, side = -1) {
  if (d === 'e') {
    g.moveTo(21.5, 15.6); g.bezierCurveTo(27.6, 14.2, 32.4, 18.6, 33, 25.6); g.bezierCurveTo(33.6, 31, 33.2, 36, 32.2, 39.6);
    g.quadraticCurveTo(28.8, 41.2, 25.2, 39.9); g.bezierCurveTo(26.4, 33.2, 25.8, 25.2, 20.8, 18.6); g.closePath();
    return;
  }
  const X = side < 0 ? (x) => x : mirrorX;
  g.moveTo(X(14.2), 11); g.lineTo(X(13.6), 18.8); g.bezierCurveTo(X(15.4), 26, X(15.8), 33, X(14.6), 39.7);
  g.quadraticCurveTo(X(10.6), 41, X(4.6), 39.4); g.lineTo(X(0), 30); g.lineTo(X(0), 11); g.closePath();
}
const arms = (g, d) => { if (d === 'e') armPath(g, 'e'); else { armPath(g, d, -1); armPath(g, d, 1); } };
// the crease between arm and torso (and the sleeve's front edge on e)
function creases(g, d, y0 = 18.8, y1 = 39.6) {
  g.beginPath();
  if (d === 'e') { g.moveTo(25.4, 17.2); g.bezierCurveTo(31, 22, 32.6, 31, 31.2, Math.min(39, y1)); }
  else for (const s of [-1, 1]) {
    const X = s < 0 ? (x) => x : mirrorX;
    g.moveTo(X(13.6), y0); g.bezierCurveTo(X(15.4), 26, X(15.8), 33, X(14.6), y1);
  }
  g.stroke();
}
// the region above a curved hem line at y (k = sag in the middle)
export function above(g, d, y, k = 3.5) {
  if (d === 'e') { g.moveTo(4, -4); g.lineTo(52, -4); g.lineTo(52, y - k * 0.2); g.quadraticCurveTo(29, y + k * 0.7, 4, y); }
  else { g.moveTo(-4, -4); g.lineTo(60, -4); g.lineTo(60, y); g.quadraticCurveTo(28, y + k, -4, y); }
  g.closePath();
}
const hemLine = (g, d, y, k = 3.5) => { if (d === 'e') { g.moveTo(8, y); g.quadraticCurveTo(29, y + k * 0.7, 50, y - k * 0.2); } else { g.moveTo(2, y); g.quadraticCurveTo(28, y + k, 54, y); } };
const hemY = { short: 43.4, mid: 48.6, long: 53.4 };

// skirt / dress / robe shape from the hips (y0) to a rounded hem (bottom ≈ y1 + 3), f = flare
function flarePath(g, d, y0, y1, f) {
  if (d === 'e') {
    g.moveTo(15.2, y0); g.bezierCurveTo(13 - f, y0 + 4, 12.2 - f, y1 - 4, 13.4 - f, y1);
    g.bezierCurveTo(17, y1 + 3.2, 24, y1 + 3.8, 29, y1 + 3.8); g.bezierCurveTo(35, y1 + 3.8, 42, y1 + 3.2, 45.2 + f, y1 - 0.4);
    g.bezierCurveTo(46.4 + f, y1 - 4.4, 45.6 + f, y0 + 4, 43, y0);
  } else {
    g.moveTo(7.6, y0); g.bezierCurveTo(5.2 - f, y0 + 4, 4.4 - f, y1 - 5, 5.8 - f, y1);
    g.bezierCurveTo(10, y1 + 3, 20, y1 + 3.8, 28, y1 + 3.8); g.bezierCurveTo(36, y1 + 3.8, 46, y1 + 3, 50.2 + f, y1);
    g.bezierCurveTo(51.6 + f, y1 - 5, 50.8 + f, y0 + 4, 48.4, y0);
  }
  g.closePath();
}

// soft volume shading over whatever the layer holds (light from the upper left)
function volume(g, d, top = 8, bot = 54, k = 1) {
  atop(g, () => {
    g.fillStyle = lin(g, 0, top, 0, bot, [[0, LITE(0.5 * k)], [0.42, LITE(0)], [1, DARK(0.3 * k)]]);
    g.fillRect(-10, -10, BW + 20, BH + 20);
    g.fillStyle = lin(g, d === 'e' ? 10 : 2, 0, d === 'e' ? 46 : 54, 0, d === 'n'
      ? [[0, DARK(0.12 * k)], [0.5, LITE(0)], [1, DARK(0.12 * k)]]
      : [[0, DARK(0.16 * k)], [0.35, LITE(0.05 * k)], [0.7, LITE(0)], [1, DARK(0.2 * k)]]);
    g.fillRect(-10, -10, BW + 20, BH + 20);
  });
}

// ---------------- skin base (whole body, tinted with the skin) ----------------
export function skinBody(g, d) {
  g.beginPath(); bodyPath(g, d); g.fillStyle = '#d4d4d4'; g.fill();
  atop(g, () => {
    g.fillStyle = lin(g, 8, 10, 46, 52, [[0, '#ffffff'], [0.55, '#ededed'], [1, '#cdcdcd']]);
    g.beginPath(); if (d === 'e') g.ellipse(27, 27, 15, 24, 0, 0, TAU); else g.ellipse(26, 27, 21, 24.5, 0, 0, TAU); g.fill();
    // arms: rounder, a touch lighter, with elbows and a crease
    g.fillStyle = LITE(0.4); g.beginPath(); arms(g, d); g.fill();
    g.strokeStyle = 'rgba(120,96,86,0.45)'; g.lineWidth = 1.2; creases(g, d);
    g.strokeStyle = 'rgba(120,96,86,0.25)'; g.lineWidth = 0.9; g.beginPath();
    if (d === 'e') { g.moveTo(26.8, 30.4); g.quadraticCurveTo(29.6, 31.2, 32.6, 30); }
    else for (const s of [-1, 1]) { const X = s < 0 ? (x) => x : mirrorX; g.moveTo(X(8), 29.6); g.quadraticCurveTo(X(11), 30.8, X(14.6), 29.8); }
    g.stroke();
    if (d === 's') {
      // collarbones + soft chest shading (visible under deep necklines)
      g.strokeStyle = 'rgba(120,96,86,0.3)'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(17, 15.5); g.quadraticCurveTo(22, 17.4, 26.6, 16.6); g.moveTo(39, 15.5); g.quadraticCurveTo(34, 17.4, 29.4, 16.6); g.stroke();
      g.fillStyle = 'rgba(120,96,86,0.14)'; g.beginPath(); g.ellipse(28, 12.6, 7, 3.4, 0, 0, TAU); g.fill();
    }
    // knees / calves for shorts and skirts
    g.strokeStyle = 'rgba(120,96,86,0.32)'; g.lineWidth = 1;
    g.beginPath(); if (d === 'e') { g.moveTo(28.6, 46); g.quadraticCurveTo(29.6, 50, 28.8, 54); } else { g.moveTo(28, 45); g.lineTo(28, 54); } g.stroke();
  });
}

// ---------------- tops (primary colour) ----------------
function sleeveEnd(sl) { return sl === 1 ? 28.6 : 39.7; }
function topShape(g, d, e) {
  const p = e.p, hy = hemY[p.hem] || 43.4;
  g.save(); clipBody(g, d); g.beginPath(); above(g, d, hy, p.hem === 'long' ? 2 : 3.5); g.fillStyle = '#dadada'; g.fill(); g.restore();
  // flared skirts of dresses / robes reach past the blob silhouette
  if (p.hem === 'long' || p.flare) {
    const f = p.flare ? 3.2 : p.wide ? 2.2 : 1.2;
    g.beginPath(); flarePath(g, d, 40, hy - 1.2, f); g.fillStyle = '#d6d6d6'; g.fill();
  }
  // bare arms
  if (p.sl < 2) {
    g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.rect(-10, p.sl === 1 ? sleeveEnd(1) : 13.5, BW + 20, BH); g.clip();
    g.beginPath(); arms(g, d); g.fill(); g.restore();
    if (p.sl === 0) { // armhole: keep a little shoulder strap of fabric
      g.save(); g.globalCompositeOperation = 'destination-out'; clipBody(g, d); g.beginPath(); arms(g, d); g.fill(); g.restore();
    }
  }
  if (p.puff && p.sl === 1) {
    g.fillStyle = '#e2e2e2';
    if (d === 'e') { g.beginPath(); g.ellipse(27.4, 21, 7.2, 8.2, -0.2, 0, TAU); g.fill(); }
    else for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s < 0 ? 10.4 : 45.6, 20.4, 6.4, 8.6, s * 0.18, 0, TAU); g.fill(); }
  }
  if (p.wide) { // bell sleeves
    g.fillStyle = '#d8d8d8';
    if (d === 'e') { g.beginPath(); g.moveTo(25, 30); g.lineTo(34.6, 30); g.quadraticCurveTo(37, 37, 36, 42.4); g.quadraticCurveTo(29, 44.6, 23.4, 42); g.quadraticCurveTo(23.6, 36, 25, 30); g.fill(); }
    else for (const s of [-1, 1]) { const X = s < 0 ? (x) => x : mirrorX; g.beginPath(); g.moveTo(X(15.6), 28); g.quadraticCurveTo(X(16.6), 36, X(16.4), 42.6); g.quadraticCurveTo(X(9), 44.4, X(2.6), 42); g.quadraticCurveTo(X(3.6), 34, X(7), 27); g.closePath(); g.fill(); }
  }
}
export function topBase(g, d, e, rand) {
  const p = e.p, hy = hemY[p.hem] || 43.4;
  topShape(g, d, e);
  volume(g, d, 9, hy + 2);
  atop(g, () => {
    // shoulder light
    g.fillStyle = LITE(0.5); g.beginPath(); g.ellipse(d === 'e' ? 24 : 18, 16.5, d === 'e' ? 6.5 : 8.5, 4.2, -0.35, 0, TAU); g.fill();
    // sleeve creases and cuffs
    if (p.sl > 0) {
      g.strokeStyle = DARK(0.4); g.lineWidth = 1.2; creases(g, d, 18.8, p.sl === 1 ? 28.4 : 39.6);
      g.strokeStyle = LITE(0.5); g.lineWidth = 0.9; g.beginPath();
      if (d === 'e') { g.moveTo(24.6, 19.4); g.bezierCurveTo(28.6, 24, 29.6, 30, 28.4, p.sl === 1 ? 28 : 37); }
      else for (const s of [-1, 1]) { const X = s < 0 ? (x) => x : mirrorX; g.moveTo(X(9.6), 19); g.quadraticCurveTo(X(8.6), 24, X(9.2), p.sl === 1 ? 27.6 : 37); }
      g.stroke();
    }
    // folds: chest / waist / skirt
    g.strokeStyle = DARK(0.24); g.lineWidth = 1.1; g.beginPath();
    if (d === 's') { g.moveTo(18, 30); g.quadraticCurveTo(20.6, 34, 19.6, 38.4); g.moveTo(38, 30); g.quadraticCurveTo(35.4, 34, 36.4, 38.4); }
    else if (d === 'n') { g.moveTo(28, 18); g.lineTo(28, 38); g.moveTo(18, 22); g.quadraticCurveTo(22, 27, 25.6, 24.2); g.moveTo(38, 22); g.quadraticCurveTo(34, 27, 30.4, 24.2); }
    else { g.moveTo(37.6, 24); g.quadraticCurveTo(40.4, 30, 39.4, 37); g.moveTo(17.4, 24); g.quadraticCurveTo(18.6, 31, 17.6, 38); }
    g.stroke();
    if (p.hem !== 'short') {
      g.strokeStyle = DARK(0.3); g.lineWidth = 1; g.beginPath();
      const xs = d === 'e' ? [21, 30, 38] : [13, 21, 28, 35, 43];
      for (const x of xs) { g.moveTo(x, 42); g.quadraticCurveTo(x + (rand() - 0.5) * 2.4, (42 + hy) / 2, x + (rand() - 0.5) * 2, hy + 1); }
      g.stroke();
      g.strokeStyle = LITE(0.35); g.lineWidth = 0.8; g.beginPath();
      for (const x of xs) { g.moveTo(x + 2, 43); g.quadraticCurveTo(x + 2.4, (43 + hy) / 2, x + 2.2, hy); }
      g.stroke();
    }
    if (p.waist) { g.strokeStyle = DARK(0.42); g.lineWidth = 1.1; g.beginPath(); hemLine(g, d, 31.5, 3); g.stroke(); }
    if (p.rib) { // ribbed collar / cuffs / hem
      g.strokeStyle = DARK(0.3); g.lineWidth = 0.6; g.beginPath();
      for (let x = 4; x < 54; x += 1.6) { g.moveTo(x, hy - 3.2); g.lineTo(x, hy + 1); }
      if (d !== 'e') for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { const x = s < 0 ? 7.6 + k * 1.8 : 41.2 + k * 1.8; g.moveTo(x, 37); g.lineTo(x, 40.6); }
      g.stroke();
      g.strokeStyle = DARK(0.4); g.lineWidth = 1; g.beginPath(); hemLine(g, d, hy - 3.2, 3.5); g.stroke();
    }
    if (p.quilt) { // padded diamond quilting
      g.strokeStyle = DARK(0.28); g.lineWidth = 0.8; g.beginPath();
      for (let k = -60; k < 80; k += 5.2) { g.moveTo(k, 8); g.lineTo(k + 46, 54); g.moveTo(k + 46, 8); g.lineTo(k, 54); }
      g.stroke();
      g.fillStyle = LITE(0.12); for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(6 + rand() * 44, 14 + rand() * 32, 1.8, 1.2, 0, 0, TAU); g.fill(); }
    }
    // hem shadow
    g.strokeStyle = DARK(0.35); g.lineWidth = 1.4; g.beginPath(); hemLine(g, d, hy - 0.9, p.hem === 'long' ? 2 : 3.5); g.stroke();
  });
}

// pattern overlay (secondary colour), clipped to the torso of a hem group; sleeves stay plain
export function pattern(g, d, id, hem, rand) {
  const hy = hemY[hem];
  g.save();
  g.beginPath(); bodyPath(g, d);
  if (hem === 'long') { g.moveTo(8, 40); g.quadraticCurveTo(3, 48, 2.6, hy); g.lineTo(53.4, hy); g.quadraticCurveTo(53, 48, 48, 40); g.closePath(); }
  g.clip();
  g.beginPath(); above(g, d, hy - 0.5, hem === 'long' ? 2 : 3.5); g.clip();
  const W = BW;
  g.fillStyle = '#f2f2f2'; g.strokeStyle = '#f2f2f2';
  if (id === 'stripes') { for (let y = 12; y < hy + 4; y += 5.2) { g.fillRect(-4, y, W + 8, 2.2); } }
  else if (id === 'vstripes') { for (let x = 1; x < W; x += 5) g.fillRect(x, 0, 2, BH + 4); }
  else if (id === 'plaid' || id === 'tartan') {
    const st = id === 'tartan' ? 9 : 7;
    g.globalAlpha = 0.55; for (let x = 0; x < W; x += st) g.fillRect(x, 0, id === 'tartan' ? 3.4 : 2.6, BH + 4);
    for (let y = 9; y < BH + 4; y += st) g.fillRect(0, y, W, id === 'tartan' ? 3.4 : 2.6);
    g.globalAlpha = 0.9; g.lineWidth = 0.6;
    if (id === 'tartan') { g.beginPath(); for (let x = 4.6; x < W; x += st) { g.moveTo(x, 0); g.lineTo(x, BH); } for (let y = 13.6; y < BH; y += st) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke(); }
    g.globalAlpha = 1;
  } else if (id === 'dots') {
    for (let y = 11, r = 0; y < hy + 3; y += 4.6, r++) for (let x = (r % 2) * 2.4; x < W; x += 4.8) { g.beginPath(); circle(g, x, y, 1.05); g.fill(); }
  } else if (id === 'diamonds') {
    g.lineWidth = 1; g.beginPath();
    for (let y = 10, r = 0; y < hy + 6; y += 6, r++) for (let x = (r % 2) * 4; x < W + 4; x += 8) { g.moveTo(x, y - 3); g.lineTo(x + 2.6, y); g.lineTo(x, y + 3); g.lineTo(x - 2.6, y); g.closePath(); }
    g.fill();
  } else if (id === 'flowers') {
    for (let y = 12, r = 0; y < hy + 3; y += 6.2, r++) for (let x = 2 + (r % 2) * 3.4; x < W; x += 6.8) {
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + r; g.beginPath(); circle(g, x + Math.cos(a) * 1.25, y + Math.sin(a) * 1.25, 0.85); g.fill(); }
    }
    g.fillStyle = 'rgba(120,120,120,0.9)';
    for (let y = 12, r = 0; y < hy + 3; y += 6.2, r++) for (let x = 2 + (r % 2) * 3.4; x < W; x += 6.8) { g.beginPath(); circle(g, x, y, 0.55); g.fill(); }
  } else if (id === 'chevron') {
    g.lineWidth = 1.4; g.beginPath();
    for (let y = 12; y < hy + 4; y += 5.4) { g.moveTo(-2, y); for (let x = -2; x < W + 4; x += 4) g.lineTo(x + 2, y + ((x / 4) % 2 ? -1.6 : 1.6)); }
    g.stroke();
  } else if (id === 'embroidered') {
    // ornate band along the hem + a yoke band, little crosses and diamonds
    const band = (y, w) => {
      g.fillRect(-4, y, W + 8, w);
      g.fillStyle = 'rgba(110,110,110,0.95)';
      for (let x = 1; x < W; x += 3.4) { g.beginPath(); g.moveTo(x, y + w / 2 - 1.2); g.lineTo(x + 1.2, y + w / 2); g.lineTo(x, y + w / 2 + 1.2); g.lineTo(x - 1.2, y + w / 2); g.closePath(); g.fill(); }
      g.fillStyle = '#f2f2f2';
    };
    g.save(); g.translate(0, 0); band(hy - 4.4, 3.4); g.restore();
    if (d === 's') { g.beginPath(); g.moveTo(17, 13); g.quadraticCurveTo(28, 23, 39, 13); g.lineWidth = 2.8; g.stroke(); }
    if (d === 'n') { g.beginPath(); g.moveTo(16, 14); g.quadraticCurveTo(28, 18, 40, 14); g.lineWidth = 2.6; g.stroke(); }
  } else if (id === 'patches') {
    for (const [x, y, w, h] of [[16, 30, 6, 5], [33, 20, 5, 6], [24, 37, 7, 4.4]]) {
      g.fillStyle = '#f0f0f0'; g.beginPath(); g.rect(x, y, w, h); g.fill();
      g.strokeStyle = 'rgba(90,90,90,0.9)'; g.lineWidth = 0.6; g.setLineDash([0.9, 0.9]); g.beginPath(); g.rect(x + 0.7, y + 0.7, w - 1.4, h - 1.4); g.stroke(); g.setLineDash([]);
    }
  }
  g.restore();
  // never over the arms; shaded like the fabric underneath
  g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); arms(g, d); g.fill(); g.restore();
  volume(g, d, 9, hy + 2, 1.1);
  atop(g, () => { g.fillStyle = LITE(0.4); g.beginPath(); g.ellipse(d === 'e' ? 24 : 18, 16.5, d === 'e' ? 6.5 : 8.5, 4.2, -0.35, 0, TAU); g.fill(); });
}

// neckline opening (skin): drawn over the top + pattern, under the trims
const NECKS = {
  round: { s: (g) => { g.moveTo(20.6, 11); g.quadraticCurveTo(28, 19.4, 35.4, 11); g.closePath(); } },
  v: { s: (g) => { g.moveTo(19.6, 11); g.lineTo(28, 25.4); g.lineTo(36.4, 11); g.closePath(); }, e: (g) => { g.moveTo(34, 11); g.quadraticCurveTo(36, 17, 40.6, 19.6); g.lineTo(42, 13); g.closePath(); } },
  scoop: { s: (g) => { g.moveTo(16, 11); g.quadraticCurveTo(17, 27.4, 28, 27.4); g.quadraticCurveTo(39, 27.4, 40, 11); g.closePath(); }, e: (g) => { g.moveTo(32, 11); g.quadraticCurveTo(34, 19, 41, 20.6); g.lineTo(42.6, 12); g.closePath(); } },
  boat: { s: (g) => { g.moveTo(11.6, 11.6); g.quadraticCurveTo(28, 21.6, 44.4, 11.6); g.closePath(); }, e: (g) => { g.moveTo(26, 10); g.quadraticCurveTo(33, 16.6, 41.4, 15); g.lineTo(41, 10); g.closePath(); }, n: (g) => { g.moveTo(13, 11); g.quadraticCurveTo(28, 16, 43, 11); g.closePath(); } },
  laced: { s: (g) => { g.moveTo(21, 11); g.lineTo(28, 25.6); g.lineTo(35, 11); g.closePath(); } },
  henley: { s: (g) => { g.moveTo(21.4, 11); g.quadraticCurveTo(28, 19.2, 34.6, 11); g.closePath(); g.moveTo(26.8, 16); g.lineTo(28, 22.4); g.lineTo(29.2, 16); g.closePath(); } },
  collar: { s: (g) => { g.moveTo(22, 11); g.lineTo(28, 21.6); g.lineTo(34, 11); g.closePath(); } },
  wrap: { s: (g) => { g.moveTo(19, 11); g.lineTo(31, 26.6); g.lineTo(37, 11); g.closePath(); }, e: (g) => { g.moveTo(34, 11); g.quadraticCurveTo(36, 17, 41.6, 21); g.lineTo(42, 13); g.closePath(); } },
  scoop_n: null,
};
export function necklineDirs(neck) { const n = NECKS[neck]; return n ? Object.keys(n) : []; }
export function neckline(g, d, neck) {
  const N = NECKS[neck]; if (!N || !N[d]) return;
  g.save(); clipBody(g, d);
  g.beginPath(); N[d](g); g.fillStyle = '#e8e8e8'; g.fill();
  atop(g, () => {
    // shadow under the chin / inside the collar
    g.fillStyle = lin(g, 0, 10, 0, 26, [[0, 'rgba(110,86,76,0.5)'], [0.45, 'rgba(110,86,76,0.12)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(0, 0, BW, BH);
    if (d === 's') { g.strokeStyle = 'rgba(120,96,86,0.32)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(17, 15.6); g.quadraticCurveTo(22, 17.4, 26.6, 16.8); g.moveTo(39, 15.6); g.quadraticCurveTo(34, 17.4, 29.4, 16.8); g.stroke(); }
  });
  g.restore();
}

// trims (secondary colour): collar edge, cuffs, buttons, laces, belts, hem band
export function topTrim(g, d, e) {
  const p = e.p, hy = hemY[p.hem] || 43.4, neck = p.neck;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // neckline edge band
  g.strokeStyle = '#ececec'; g.lineWidth = 1.7;
  const N = NECKS[neck];
  g.save(); clipBody(g, d);
  if (neck === 'high') {
    if (d !== 'e') { g.fillStyle = '#e6e6e6'; g.beginPath(); g.moveTo(17, 9.6); g.quadraticCurveTo(28, 6, 39, 9.6); g.lineTo(38.6, 15.6); g.quadraticCurveTo(28, 19.4, 17.4, 15.6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(90,90,90,0.55)'; g.lineWidth = 0.6; g.beginPath(); for (let x = 18.6; x < 38; x += 1.7) { g.moveTo(x, 10); g.lineTo(x, 15.6 + Math.sin((x - 17) / 21 * Math.PI) * 2.6); } g.stroke(); }
    else { g.fillStyle = '#e6e6e6'; g.beginPath(); g.moveTo(25, 8.6); g.quadraticCurveTo(34, 7, 40, 10); g.lineTo(40.6, 16); g.quadraticCurveTo(33, 18, 26, 15.4); g.closePath(); g.fill(); }
  } else if (N && N[d]) {
    g.beginPath(); N[d](g); g.stroke();
  } else if (d === 'n') {
    g.beginPath(); g.moveTo(18, 12.6); g.quadraticCurveTo(28, 15.4, 38, 12.6); g.stroke();
  }
  if (neck === 'collar' && d === 's') { // shirt collar flaps
    g.fillStyle = '#f0f0f0';
    g.beginPath(); g.moveTo(19.6, 10.4); g.lineTo(27.4, 21); g.lineTo(21.4, 19.8); g.lineTo(17.6, 13); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(36.4, 10.4); g.lineTo(28.6, 21); g.lineTo(34.6, 19.8); g.lineTo(38.4, 13); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(80,80,80,0.6)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(27.4, 21); g.lineTo(21.4, 19.8); g.lineTo(17.6, 13); g.moveTo(28.6, 21); g.lineTo(34.6, 19.8); g.lineTo(38.4, 13); g.stroke();
  }
  if (neck === 'collar' && d === 'e') { g.fillStyle = '#f0f0f0'; g.beginPath(); g.moveTo(31, 9.4); g.lineTo(39.6, 17.4); g.lineTo(34.4, 17.6); g.lineTo(29.4, 12); g.closePath(); g.fill(); }
  if (neck === 'laced' && d === 's') { // laces across the V
    g.strokeStyle = '#f4f4f4'; g.lineWidth = 0.9; g.beginPath();
    for (const y of [14.4, 18, 21.6]) { const w = (25.6 - y) * 0.42; g.moveTo(28 - w, y); g.lineTo(28 + w, y + 2); g.moveTo(28 + w, y); g.lineTo(28 - w, y + 2); }
    g.stroke(); g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(28.2, 25.6); g.quadraticCurveTo(30, 29, 29, 31.4); g.lineTo(28.4, 31.2); g.quadraticCurveTo(29, 29, 27.6, 25.8); g.fill();
  }
  if (neck === 'wrap' && d === 's') { g.strokeStyle = '#ececec'; g.lineWidth = 2; g.beginPath(); g.moveTo(31, 26.6); g.lineTo(22, 40); g.stroke(); }
  // buttons / placket
  if (p.buttons && d === 's') {
    const y0 = neck === 'henley' ? 16.4 : neck === 'collar' ? 21.6 : 18;
    g.strokeStyle = 'rgba(90,90,90,0.45)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(28, y0); g.lineTo(28, Math.min(hy, neck === 'henley' ? 24 : hy)); g.stroke();
    g.fillStyle = '#f6f6f6';
    for (let y = y0 + 1.6; y < (neck === 'henley' ? 24 : hy - 1); y += 4.2) { g.beginPath(); circle(g, 28, y, 0.95); g.fill(); g.strokeStyle = 'rgba(70,70,70,0.6)'; g.lineWidth = 0.4; g.stroke(); }
  }
  g.restore();
  // cuffs
  if (p.sl > 0) {
    const y = p.sl === 1 ? 28.6 : 39.7;
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 1.7; g.beginPath();
    if (p.wide) { if (d === 'e') { g.moveTo(23.4, 42); g.quadraticCurveTo(29, 44.6, 36, 42.4); } else for (const s of [-1, 1]) { const X = s < 0 ? (x) => x : mirrorX; g.moveTo(X(16.4), 42.6); g.quadraticCurveTo(X(9), 44.4, X(2.6), 42); } }
    else if (d === 'e') { const yy = p.sl === 1 ? 28.2 : 39.4; g.moveTo(p.sl === 1 ? 25.8 : 25.6, yy); g.quadraticCurveTo(29.2, yy + 1.4, p.sl === 1 ? 33.2 : 32.2, yy - 0.2); }
    else for (const s of [-1, 1]) { const X = s < 0 ? (x) => x : mirrorX; const x0 = p.sl === 1 ? 6.6 : 5.2, x1 = p.sl === 1 ? 15.6 : 14.8; g.moveTo(X(x0), y - 0.6); g.quadraticCurveTo(X((x0 + x1) / 2), y + 1.2, X(x1), y); }
    g.stroke();
  }
  // belts
  if (p.belt) {
    const y = p.hem === 'long' ? 33 : 37.6;
    g.save(); clipBody(g, d);
    if (p.belt === 'rope') {
      g.strokeStyle = '#e6e6e6'; g.lineWidth = 2.4; g.beginPath(); hemLine(g, d, y, 3.4); g.stroke();
      g.strokeStyle = 'rgba(90,90,90,0.55)'; g.lineWidth = 0.6; g.setLineDash([1.1, 1.1]); g.beginPath(); hemLine(g, d, y, 3.4); g.stroke(); g.setLineDash([]);
    } else if (p.belt === 'sash') {
      g.fillStyle = '#e8e8e8'; g.beginPath(); hemLine(g, d, y - 2.2, 3.4); g.lineTo(d === 'e' ? 50 : 54, y + 2.6); g.quadraticCurveTo(28, y + 6.2, d === 'e' ? 8 : 2, y + 2.6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(90,90,90,0.4)'; g.lineWidth = 0.7; g.beginPath(); hemLine(g, d, y + 0.4, 3.4); g.stroke();
    } else {
      g.strokeStyle = '#d0d0d0'; g.lineWidth = 2.8; g.beginPath(); hemLine(g, d, y, 3.4); g.stroke();
      if (d === 's') { g.fillStyle = '#fafafa'; g.fillRect(25.6, y + 0.4, 4.8, 3.6); g.strokeStyle = 'rgba(60,60,60,0.7)'; g.lineWidth = 0.6; g.strokeRect(25.6, y + 0.4, 4.8, 3.6); }
    }
    g.restore();
    if (d === 's' && p.belt !== 'leather') { // knot + tails
      g.fillStyle = '#e8e8e8'; g.beginPath(); circle(g, 33.4, y + 2.8, 1.8); g.fill();
      g.strokeStyle = '#e8e8e8'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(33.4, y + 3.2); g.lineTo(32.4, y + 9.6); g.moveTo(34, y + 3.2); g.lineTo(36, y + 9); g.stroke();
    }
  }
  if (p.waist && d !== 'n') { g.save(); clipBody(g, d); g.strokeStyle = '#e8e8e8'; g.lineWidth = 1.5; g.beginPath(); hemLine(g, d, 31.6, 3); g.stroke(); g.restore(); }
}

// ---------------- over layer (own colour) ----------------
export function overLayer(g, d, e, rand) {
  const k = e.p.kind;
  g.save(); clipBody(g, d);
  g.fillStyle = '#dcdcdc';
  if (k === 'vest') {
    g.beginPath(); above(g, d, 44.2, 3.6); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); arms(g, d); g.fill();
    if (d === 's') { g.beginPath(); g.moveTo(24.4, 6); g.lineTo(26.6, 26); g.lineTo(27.4, 46); g.lineTo(28.6, 46); g.lineTo(29.4, 26); g.lineTo(31.6, 6); g.closePath(); g.fill(); g.beginPath(); g.moveTo(20, 9); g.lineTo(28, 25); g.lineTo(36, 9); g.closePath(); g.fill(); }
    if (d === 'e') { g.beginPath(); g.moveTo(36.4, 8); g.quadraticCurveTo(38, 22, 43.6, 30); g.lineTo(50, 30); g.lineTo(50, 0); g.closePath(); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  } else if (k === 'apron') {
    if (d === 's') { g.beginPath(); g.moveTo(20.6, 22); g.lineTo(35.4, 22); g.lineTo(36.6, 37); g.quadraticCurveTo(40, 38, 40.4, 50.6); g.quadraticCurveTo(28, 52.4, 15.6, 50.6); g.quadraticCurveTo(16, 38, 19.4, 37); g.closePath(); g.fill(); }
    else if (d === 'e') { g.beginPath(); g.moveTo(37, 22); g.quadraticCurveTo(42.6, 26, 43.6, 36); g.quadraticCurveTo(45.6, 44, 45.2, 51); g.lineTo(38.6, 51.4); g.quadraticCurveTo(39.6, 40, 36.4, 36); g.closePath(); g.fill(); }
    g.strokeStyle = '#d4d4d4'; g.lineWidth = 1.6; g.beginPath(); hemLine(g, d, 37.4, 3.2); g.stroke();
    if (d === 's') { g.beginPath(); g.moveTo(21, 22.4); g.lineTo(17, 12); g.moveTo(35, 22.4); g.lineTo(39, 12); g.stroke(); }
    if (d === 'n') { g.lineWidth = 1.3; g.beginPath(); g.moveTo(17, 12); g.lineTo(24, 37); g.moveTo(39, 12); g.lineTo(32, 37); g.stroke(); g.fillStyle = '#dcdcdc'; g.beginPath(); g.ellipse(25.6, 39.6, 2.6, 1.8, 0.4, 0, TAU); g.ellipse(30.4, 39.6, 2.6, 1.8, -0.4, 0, TAU); g.fill(); g.beginPath(); g.moveTo(27, 40); g.lineTo(25.4, 46.6); g.lineTo(27.4, 46); g.lineTo(28.6, 40.4); g.lineTo(30.6, 46.4); g.lineTo(31.4, 45.4); g.closePath(); g.fill(); }
    if (d === 's') { g.strokeStyle = 'rgba(90,90,90,0.45)'; g.lineWidth = 0.8; g.beginPath(); g.rect(23.6, 40.6, 8.8, 5.4); g.stroke(); }
  } else if (k === 'braces') {
    g.strokeStyle = '#dcdcdc'; g.lineWidth = 2.4; g.beginPath();
    if (d === 's') { g.moveTo(19.2, 9); g.quadraticCurveTo(19.6, 26, 20.6, 42); g.moveTo(36.8, 9); g.quadraticCurveTo(36.4, 26, 35.4, 42); }
    else if (d === 'n') { g.moveTo(19, 9); g.lineTo(28, 30); g.lineTo(37, 9); g.moveTo(28, 30); g.lineTo(28, 42); }
    else { g.moveTo(31.6, 8.6); g.quadraticCurveTo(35, 24, 34.4, 42); }
    g.stroke();
    if (d === 's') { g.fillStyle = '#f4f4f4'; for (const x of [20.6, 35.4]) { g.fillRect(x - 1.6, 38.6, 3.2, 2.6); } }
  } else if (k === 'sash') {
    g.beginPath();
    if (d === 'e') { g.moveTo(22, 12); g.lineTo(28, 10.6); g.lineTo(42, 40); g.lineTo(36, 41.4); g.closePath(); }
    else { g.moveTo(14.6, 11.6); g.lineTo(21.6, 9.6); g.lineTo(44.4, 40.6); g.lineTo(38.4, 43); g.closePath(); }
    g.fill();
    g.strokeStyle = 'rgba(90,90,90,0.4)'; g.lineWidth = 0.7; g.beginPath(); if (d === 'e') { g.moveTo(25, 11.4); g.lineTo(39, 40.6); } else { g.moveTo(18, 10.6); g.lineTo(41.4, 41.8); } g.stroke();
  } else if (k === 'corset') {
    g.beginPath(); g.moveTo(-4, 24); g.quadraticCurveTo(28, 20, 60, 24); g.lineTo(60, 41.6); g.quadraticCurveTo(28, 46.6, -4, 41.6); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); arms(g, d); g.fill(); g.globalCompositeOperation = 'source-over';
    if (d !== 'e') { g.strokeStyle = 'rgba(80,80,80,0.55)'; g.lineWidth = 0.7; g.beginPath(); for (const x of [17, 22.6, 33.4, 39]) { g.moveTo(x, 23.4); g.lineTo(x, 42.6); } g.stroke();
      g.strokeStyle = '#fafafa'; g.lineWidth = 0.8; g.beginPath(); for (let y = 25; y < 41; y += 3) { g.moveTo(26, y); g.lineTo(30, y + 1.6); g.moveTo(30, y); g.lineTo(26, y + 1.6); } g.stroke(); }
  } else if (k === 'overalls') {
    g.beginPath(); g.moveTo(-4, 40.6); g.quadraticCurveTo(28, 45, 60, 40.6); g.lineTo(60, 60); g.lineTo(-4, 60); g.closePath(); g.fill();
    if (d === 's') { g.beginPath(); g.rect(20.4, 22.4, 15.2, 21); g.fill(); }
    if (d === 'e') { g.beginPath(); g.moveTo(36, 22.4); g.quadraticCurveTo(42, 24, 43.6, 30); g.lineTo(44, 42); g.lineTo(35.4, 42); g.closePath(); g.fill(); }
    g.strokeStyle = '#dcdcdc'; g.lineWidth = 2.2; g.beginPath();
    if (d === 's') { g.moveTo(21.6, 23); g.lineTo(18.6, 9); g.moveTo(34.4, 23); g.lineTo(37.4, 9); }
    else if (d === 'n') { g.moveTo(19, 9); g.lineTo(28, 30); g.lineTo(37, 9); g.moveTo(28, 30); g.lineTo(28, 42); }
    else { g.moveTo(38.6, 23); g.lineTo(33, 9); }
    g.stroke();
    g.strokeStyle = 'rgba(70,70,70,0.5)'; g.lineWidth = 1; g.beginPath(); if (d === 'e') { g.moveTo(28.6, 46); g.quadraticCurveTo(29.6, 50, 28.8, 54); } else { g.moveTo(28, 47); g.lineTo(28, 55); } g.stroke();
    if (d === 's') { g.fillStyle = '#f4f4f4'; for (const x of [22, 34]) { g.beginPath(); circle(g, x, 24.4, 1.1); g.fill(); } g.strokeStyle = 'rgba(80,80,80,0.5)'; g.lineWidth = 0.7; g.beginPath(); g.rect(24.4, 28.6, 7.2, 5.4); g.stroke(); }
  }
  g.restore();
  // pieces that hang past the silhouette
  if (k === 'poncho' || k === 'shawl') {
    const yb = k === 'poncho' ? 36.6 : 27;
    g.fillStyle = '#dedede'; g.beginPath();
    if (d === 'e') { g.moveTo(16.6, 13); g.quadraticCurveTo(28, 5.6, 40.6, 12); g.quadraticCurveTo(45, 22, 44.4, yb); g.lineTo(34, yb + 4); g.lineTo(13.4, yb - 1); g.quadraticCurveTo(12, 22, 16.6, 13); }
    else { g.moveTo(9, 13.4); g.quadraticCurveTo(28, 5.6, 47, 13.4); g.quadraticCurveTo(52.6, 24, 51.6, yb); g.lineTo(28, yb + (k === 'poncho' ? 7.6 : 9)); g.lineTo(4.4, yb); g.quadraticCurveTo(3.4, 24, 9, 13.4); }
    g.closePath(); g.fill();
    atop(g, () => {
      g.strokeStyle = 'rgba(90,90,90,0.4)'; g.lineWidth = 0.8; g.beginPath();
      if (d !== 'e') { g.moveTo(16, 20); g.quadraticCurveTo(20, 30, 22, yb + 3); g.moveTo(40, 20); g.quadraticCurveTo(36, 30, 34, yb + 3); }
      else { g.moveTo(24, 16); g.quadraticCurveTo(28, 28, 30, yb + 2); }
      g.stroke();
      if (k === 'poncho') { g.strokeStyle = 'rgba(120,120,120,0.55)'; g.lineWidth = 1.6; g.beginPath(); if (d !== 'e') { g.moveTo(4, yb - 3); g.lineTo(28, yb + 4.6); g.lineTo(52, yb - 3); } else { g.moveTo(13, yb - 4); g.lineTo(34, yb + 1); g.lineTo(45, yb - 3.4); } g.stroke(); }
    });
    // fringe
    g.strokeStyle = '#d8d8d8'; g.lineWidth = 0.9; g.beginPath();
    const pts = d === 'e' ? [[13.4, yb - 1], [34, yb + 4], [44.4, yb]] : [[4.4, yb], [28, yb + (k === 'poncho' ? 7.6 : 9)], [51.6, yb]];
    for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; for (let t = 0.06; t < 1; t += 0.11) { const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 0.6, y + 2.2 + rand()); } }
    g.stroke();
    if (d === 's' && k === 'shawl') { g.fillStyle = '#e6e6e6'; g.beginPath(); circle(g, 28, 22.6, 2.2); g.fill(); }
  }
  volume(g, d, 9, 52, 0.85);
  if (e.p.fur) { // fluffy trim along the opening and the hem
    g.fillStyle = '#f4f4f4';
    const fluff = (x, y) => { g.beginPath(); g.ellipse(x, y, 1.9 + rand() * 0.8, 1.5 + rand() * 0.6, rand() * 3, 0, TAU); g.fill(); };
    if (d === 's') { for (let t = 0; t <= 1.001; t += 0.08) { fluff(24.4 + t * 3, 7 + t * 37); fluff(31.6 - t * 3, 7 + t * 37); } }
    else if (d === 'e') { for (let t = 0; t <= 1.001; t += 0.09) fluff(36.4 + t * 6, 8 + t * 22); }
    for (let x = d === 'e' ? 14 : 4; x < (d === 'e' ? 44 : 52); x += 2.6) fluff(x, 44 + Math.sin(((x - 2) / 50) * Math.PI) * 3);
  }
}

// ---------------- bottoms ----------------
export function bottomBase(g, d, e, rand) {
  const p = e.p, y = BELT[d];
  const end = { full: 54, knee: 48.6, thigh: 46.2, skirt: 50.6, long_skirt: 54.2 }[p.leg] || 54;
  const skirt = p.leg === 'skirt' || p.leg === 'long_skirt';
  g.save(); clipBody(g, d);
  g.beginPath();
  if (d === 'e') { g.moveTo(8, y + 1); g.quadraticCurveTo(29, y + 3.5, 50, y); } else { g.moveTo(2, y); g.quadraticCurveTo(28, y + 4.5, 54, y); }
  g.lineTo(60, end); g.lineTo(-4, end); g.closePath(); g.fillStyle = '#d2d2d2'; g.fill();
  g.restore();
  if (skirt || p.fit === 'baggy') { // flare past the blob, hem rounded like the body
    const f = p.leg === 'long_skirt' ? 2 : skirt ? 1.6 : 0.8;
    g.fillStyle = '#cecece'; g.beginPath(); flarePath(g, d, y + 0.6, end - 2.4, f); g.fill();
  }
  atop(g, () => {
    g.fillStyle = lin(g, 0, y, 0, end + 1, [[0, LITE(0.45)], [0.55, LITE(0)], [1, DARK(0.32)]]); g.fillRect(-10, 0, BW + 20, BH + 10);
    g.strokeStyle = DARK(0.5); g.lineWidth = 1.2; g.beginPath();
    if (!skirt) { if (d === 'e') { g.moveTo(28.4, y + 4.6); g.quadraticCurveTo(29.8, 50, 28.6, end); } else { g.moveTo(28, y + 5.4); g.lineTo(28, end); } }
    g.stroke();
    g.strokeStyle = DARK(0.26); g.lineWidth = 1; g.beginPath();
    if (skirt || p.pleats) { const xs = d === 'e' ? [18, 24, 30, 36, 42] : [9, 15, 21.6, 28, 34.4, 41, 47]; for (const x of xs) { g.moveTo(x, y + 3); g.quadraticCurveTo(x + (x - 28) * 0.08, (y + end) / 2, x + (x - 28) * 0.14, end + 1); } }
    else if (d !== 'e') { g.moveTo(16, y + 4.6); g.quadraticCurveTo(18, y + 8, 17, end - 1); g.moveTo(40, y + 4.6); g.quadraticCurveTo(38, y + 8, 39, end - 1); }
    else { g.moveTo(35, y + 4); g.quadraticCurveTo(37.6, 48, 37.4, 52); }
    g.stroke();
    if (p.fit === 'baggy') { g.strokeStyle = DARK(0.3); g.lineWidth = 0.9; g.beginPath(); for (let i = 0; i < 6; i++) { const x = 8 + rand() * 40, yy = y + 6 + rand() * 6; g.moveTo(x - 2, yy); g.quadraticCurveTo(x, yy + 1.4, x + 2.4, yy - 0.2); } g.stroke(); }
    if (p.tartan) {
      g.fillStyle = DARK(0.22); for (let x = 2; x < BW; x += 7) g.fillRect(x, y, 2.6, end - y + 4);
      g.fillStyle = DARK(0.16); for (let yy = y + 3; yy < end + 3; yy += 6) g.fillRect(-4, yy, BW + 8, 2.2);
      g.strokeStyle = LITE(0.5); g.lineWidth = 0.5; g.beginPath(); for (let x = 5.6; x < BW; x += 7) { g.moveTo(x, y); g.lineTo(x, end + 3); } g.stroke();
    }
    if (p.wraps) { g.strokeStyle = DARK(0.4); g.lineWidth = 0.9; g.beginPath(); for (let yy = 46.4; yy < 54; yy += 1.9) { g.moveTo(4, yy); g.lineTo(52, yy + 1.4); } g.stroke(); g.strokeStyle = LITE(0.4); g.lineWidth = 0.6; g.beginPath(); for (let yy = 47.2; yy < 54; yy += 1.9) { g.moveTo(4, yy); g.lineTo(52, yy + 1.4); } g.stroke(); }
    // hem line of short legs
    if (end < 54) { g.strokeStyle = DARK(0.45); g.lineWidth = 1.2; g.beginPath(); if (d === 'e') { g.moveTo(8, end - 1); g.quadraticCurveTo(29, end + 0.8, 50, end - 1.2); } else { g.moveTo(2, end - 1.2); g.quadraticCurveTo(28, end + 1, 54, end - 1.2); } g.stroke(); }
    if (p.cuff) { g.fillStyle = LITE(0.4); g.beginPath(); if (d === 'e') g.rect(8, end - 3, 44, 1.6); else g.rect(0, end - 3.2, 56, 1.8); g.fill(); }
  });
  // waistband / belt (darker shade of the same colour), buckle at the front
  g.save(); clipBody(g, d);
  g.strokeStyle = '#7a7a7a'; g.lineWidth = 3; g.beginPath();
  if (d === 'e') { g.moveTo(8, y + 1.2); g.quadraticCurveTo(29, y + 3.7, 50, y + 0.2); } else { g.moveTo(2, y + 0.3); g.quadraticCurveTo(28, y + 4.8, 54, y + 0.3); }
  g.stroke();
  g.strokeStyle = LITE(0.35); g.lineWidth = 0.8; g.beginPath();
  if (d === 'e') { g.moveTo(8, y + 0.3); g.quadraticCurveTo(29, y + 2.8, 50, y - 0.7); } else { g.moveTo(2, y - 0.6); g.quadraticCurveTo(28, y + 3.9, 54, y - 0.6); }
  g.stroke();
  if (!skirt || p.pleats) {
    if (d === 's') { g.fillStyle = '#f4f4f4'; g.fillRect(25, y + 0.6, 6, 4.2); g.fillStyle = '#7a7a7a'; g.fillRect(26.6, y + 1.8, 2.8, 1.8); g.strokeStyle = '#3a3a3a'; g.lineWidth = 0.7; g.strokeRect(25, y + 0.6, 6, 4.2); }
    else if (d === 'e') { g.fillStyle = '#e8e8e8'; g.fillRect(37, y + 0.2, 3.6, 3.6); }
  }
  g.restore();
}

// shoes on the body box (lower legs): shaft band, straps, wraps
export function shoeBand(g, d, e) {
  const p = e.p;
  if (p.bare) return;
  const top = 54.4 - p.h - 1.4;
  g.save(); clipBody(g, d);
  if (p.straps) {
    g.strokeStyle = '#d8d8d8'; g.lineWidth = 1.4; g.beginPath();
    if (d === 'e') { g.moveTo(14, 50.6); g.lineTo(46, 50.2); g.moveTo(22, 48.6); g.lineTo(26, 54); g.moveTo(34, 48.6); g.lineTo(31, 54); }
    else { g.moveTo(2, 50.8); g.quadraticCurveTo(28, 53, 54, 50.8); g.moveTo(14, 48.6); g.lineTo(18, 54); g.moveTo(42, 48.6); g.lineTo(38, 54); }
    g.stroke(); g.restore(); return;
  }
  g.beginPath();
  if (d === 'e') { g.moveTo(4, top); g.quadraticCurveTo(29, top + 2, 52, top - 0.4); } else { g.moveTo(-4, top + 0.2); g.quadraticCurveTo(28, top + 2.8, 60, top + 0.2); }
  g.lineTo(60, 60); g.lineTo(-4, 60); g.closePath(); g.fillStyle = '#cfcfcf'; g.fill();
  atop(g, () => {
    g.fillStyle = lin(g, 0, top, 0, 54, [[0, LITE(0.5)], [0.5, LITE(0)], [1, DARK(0.35)]]); g.fillRect(-10, 0, BW + 20, BH + 10);
    g.strokeStyle = DARK(0.55); g.lineWidth = 1.1; g.beginPath(); if (d === 'e') { g.moveTo(28.6, top + 1); g.lineTo(28.8, 55); } else { g.moveTo(28, top + 1.4); g.lineTo(28, 55); } g.stroke();
    if (p.cuff) { g.fillStyle = LITE(0.45); g.beginPath(); if (d === 'e') { g.moveTo(4, top); g.quadraticCurveTo(29, top + 2, 52, top - 0.4); g.lineTo(52, top + 1.6); g.quadraticCurveTo(29, top + 4, 4, top + 2); } else { g.moveTo(-4, top + 0.2); g.quadraticCurveTo(28, top + 2.8, 60, top + 0.2); g.lineTo(60, top + 2.2); g.quadraticCurveTo(28, top + 4.8, -4, top + 2.2); } g.closePath(); g.fill(); }
    if (p.wrap) { g.strokeStyle = DARK(0.42); g.lineWidth = 0.8; g.beginPath(); for (let yy = top + 1.2; yy < 55; yy += 1.6) { g.moveTo(-2, yy + 1); g.lineTo(58, yy - 0.6); } g.stroke(); }
    if (p.stitch) { g.strokeStyle = LITE(0.6); g.lineWidth = 0.5; g.setLineDash([0.8, 0.8]); g.beginPath(); if (d === 'e') { g.moveTo(8, top + 1.6); g.quadraticCurveTo(29, top + 3.4, 50, top + 1.2); } else { g.moveTo(0, top + 1.8); g.quadraticCurveTo(28, top + 4.2, 56, top + 1.8); } g.stroke(); g.setLineDash([]); }
    if (p.clog) { g.fillStyle = DARK(0.3); g.fillRect(-4, 52.4, BW + 8, 3); }
  });
  g.restore();
}

// foot sprites for the animated rig (pawn_foot geometry: 18×12 box, 's' = toe toward the camera, 'e' = profile)
export function foot(g, d, e) {
  const p = e.p;
  const shoe = !p.bare;
  g.fillStyle = shoe ? '#cfcfcf' : '#dadada';
  g.beginPath();
  if (d === 'e') {
    if (p.clog) { g.moveTo(2.6, 9.8); g.lineTo(2.8, 3.6); g.quadraticCurveTo(4, 1.6, 8, 2); g.quadraticCurveTo(16.4, 3.2, 16, 9.8); g.closePath(); }
    else { g.moveTo(3, 9.5); g.lineTo(3, 3.5); g.quadraticCurveTo(4, 1.6, 7.5, 1.8); g.lineTo(10, 3.6); g.quadraticCurveTo(15.6, 4.6, 15.4, 8); g.lineTo(15.2, 9.6); g.closePath(); }
  } else g.ellipse(9, 6.2, p.clog ? 5.6 : 5.2, 4.4, 0, 0, TAU);
  g.fill();
  atop(g, () => {
    g.fillStyle = lin(g, 0, 2, 0, 10, [[0, '#ffffff'], [1, '#a8a8a8']]);
    g.beginPath(); if (d === 'e') g.ellipse(9, 5.4, 5.4, 2.6, 0.1, 0, TAU); else g.ellipse(8.4, 5.4, 4, 3.2, 0, 0, TAU); g.fill();
    if (shoe) { g.fillStyle = 'rgba(40,40,40,0.75)'; if (d === 'e') g.fillRect(2, 8.6, 14.4, 1.4); else { g.beginPath(); g.ellipse(9, 9.6, 4.8, 1.2, 0, 0, TAU); g.fill(); } }
    else { g.fillStyle = 'rgba(120,96,86,0.45)'; if (d === 'e') { for (const x of [12.6, 14.2]) { g.beginPath(); circle(g, x, 7.2, 0.6); g.fill(); } } else for (const x of [6.4, 8.2, 10, 11.6]) { g.beginPath(); circle(g, x, 8.2, 0.65); g.fill(); } }
    if (p.straps) { g.strokeStyle = DARK(0.55); g.lineWidth = 0.9; g.beginPath(); if (d === 'e') { g.moveTo(6, 2.4); g.lineTo(9, 8.6); g.moveTo(11, 3.8); g.lineTo(12.4, 8.8); } else { g.moveTo(4.4, 5); g.lineTo(13.6, 5); g.moveTo(9, 2.4); g.lineTo(9, 8); } g.stroke(); }
    if (p.stitch) { g.strokeStyle = LITE(0.7); g.lineWidth = 0.5; g.setLineDash([0.7, 0.7]); g.beginPath(); if (d === 'e') { g.moveTo(9, 3.6); g.quadraticCurveTo(13, 4.4, 14.4, 7.6); } else g.ellipse(9, 5.2, 2.8, 2, 0, 0, TAU); g.stroke(); g.setLineDash([]); }
    if (p.wrap) { g.strokeStyle = DARK(0.4); g.lineWidth = 0.7; g.beginPath(); for (let x = 3; x < 16; x += 2) { g.moveTo(x, 1); g.lineTo(x + 2, 10); } g.stroke(); }
  });
}

export const seed = (s) => rng(s);
export { hemY };
