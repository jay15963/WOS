// The kingdoms on the map and the radar (docs/REINOS.md): territories in their colours with borders (a raster of the
// realm's owner grid at 8 tiles a pixel, its edges made organic by a little noise), roads, settlements with icons and
// names, kingdom names — labels by importance so the planet stays readable zoomed out:
//   span > 5000 tiles: kingdom names + capitals (dots) · 1600–5000: + castles, capital names · < 1600: everything named
// The radar (small span) gets the borders, the roads and the settlements around the player.
import { drawShield, bannerURL } from './heraldry.js';

const TPP = 8, RW = 16384 / TPP, RH = 8192 / TPP; // 2048 × 1024
const INK = '#24160d', CREAM = '#f6ead0';
let CACHE = null;

function hashN(x, y) { let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; return ((h >>> 0) & 1023) / 1023; }
function vnoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hashN(x0, y0), b = hashN(x0 + 1, y0), c = hashN(x0, y0 + 1), d = hashN(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// the territory raster: fill (kingdom colour, translucent) + a border line where the owner changes
function territories(realm) {
  if (CACHE && CACHE.realm === realm) return CACHE;
  const own = new Uint8Array(RW * RH), MW = 512;
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    // jittered lookup (±0.7 cell): organic borders instead of 32-tile steps
    const u = (x + 0.5) / 4 + (vnoise(x / 9, y / 9) - 0.5) * 1.4, v = (y + 0.5) / 4 + (vnoise(x / 9 + 71, y / 9 + 13) - 0.5) * 1.4;
    const cx = ((Math.floor(u) % MW) + MW) % MW, cy = Math.max(0, Math.min(255, Math.floor(v)));
    own[y * RW + x] = realm.owner[cy * MW + cx];
  }
  const c = document.createElement('canvas');
  c.width = RW; c.height = RH;
  const g = c.getContext('2d'), im = g.createImageData(RW, RH), d = im.data;
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const i = y * RW + x, k = own[i];
    if (!k) continue;
    const K = realm.kingdoms[k - 1], col = K.color;
    const r = own[y * RW + ((x + 1) % RW)], l = own[y * RW + ((x + RW - 1) % RW)], up = y > 0 ? own[i - RW] : k, dn = y < RH - 1 ? own[i + RW] : k;
    const edge = r !== k || l !== k || up !== k || dn !== k;
    const o = i * 4;
    if (edge) { d[o] = col[0] * 0.55; d[o + 1] = col[1] * 0.55; d[o + 2] = col[2] * 0.55; d[o + 3] = 235; }
    else { d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 150; }
  }
  g.putImageData(im, 0, 0);
  // where to write each kingdom's name: the mean of its cells (the capital's continent)
  const sum = realm.kingdoms.map(() => [0, 0, 0]);
  for (let i = 0; i < realm.owner.length; i++) { const k = realm.owner[i]; if (!k) continue; const s = sum[k - 1]; s[0] += (i % MW) * 32 + 16; s[1] += Math.floor(i / MW) * 32 + 16; s[2]++; }
  const centres = sum.map((s, k) => (s[2] ? [s[0] / s[2], s[1] / s[2]] : [realm.settlements[realm.kingdoms[k].capital].x, realm.settlements[realm.kingdoms[k].capital].y]));
  CACHE = { realm, canvas: c, centres };
  return CACHE;
}

// glyphs: a village (house), a castle (tower), a city (walls with towers); size s px
function glyph(ctx, kind, X, Y, s, col) {
  ctx.lineWidth = Math.max(1, s * 0.16); ctx.strokeStyle = INK; ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === 'village') { ctx.moveTo(X - s * 0.5, Y + s * 0.4); ctx.lineTo(X - s * 0.5, Y - s * 0.05); ctx.lineTo(X, Y - s * 0.5); ctx.lineTo(X + s * 0.5, Y - s * 0.05); ctx.lineTo(X + s * 0.5, Y + s * 0.4); ctx.closePath(); }
  else if (kind === 'castle') {
    ctx.moveTo(X - s * 0.4, Y + s * 0.5); ctx.lineTo(X - s * 0.4, Y - s * 0.4); ctx.lineTo(X - s * 0.2, Y - s * 0.4); ctx.lineTo(X - s * 0.2, Y - s * 0.25); ctx.lineTo(X + s * 0.2, Y - s * 0.25);
    ctx.lineTo(X + s * 0.2, Y - s * 0.4); ctx.lineTo(X + s * 0.4, Y - s * 0.4); ctx.lineTo(X + s * 0.4, Y + s * 0.5); ctx.closePath();
  } else {
    ctx.moveTo(X - s * 0.6, Y + s * 0.45); ctx.lineTo(X - s * 0.6, Y - s * 0.3); ctx.lineTo(X - s * 0.35, Y - s * 0.3); ctx.lineTo(X - s * 0.35, Y - s * 0.05); ctx.lineTo(X - s * 0.12, Y - s * 0.05);
    ctx.lineTo(X - s * 0.12, Y - s * 0.6); ctx.lineTo(X + s * 0.12, Y - s * 0.6); ctx.lineTo(X + s * 0.12, Y - s * 0.05); ctx.lineTo(X + s * 0.35, Y - s * 0.05); ctx.lineTo(X + s * 0.35, Y - s * 0.3);
    ctx.lineTo(X + s * 0.6, Y - s * 0.3); ctx.lineTo(X + s * 0.6, Y + s * 0.45); ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
}
const shieldCache = new Map();
function shieldImg(K) {
  let im = shieldCache.get(K.id);
  if (!im) { im = new Image(); im.src = bannerURL(K.banner, 24, 28, 'shield'); shieldCache.set(K.id, im); }
  return im.complete ? im : null;
}

// draw the realm over the map: (sx, sy, sw, sh) the world rect, kx / ky px per tile, toX / toY world → canvas px
export function drawRealm(ctx, game, sx, sy, sw, sh, kx, ky, full, toX, toY, W, H) {
  const realm = game.towns?.realm;
  if (!realm) return;
  const T = territories(realm);
  // territories (repeated across the seam like the planet picture)
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = !full ? 0.6 : sw > 4000 ? 1 : sw > 1500 ? 0.8 : 0.6; // (zoomed out: the kingdoms' colours read; zoomed in: the land shows through)
  const mx = sx / TPP, my = sy / TPP, mw = sw / TPP, mh = sh / TPP;
  for (let k = Math.floor(mx / RW); k * RW < mx + mw; k++) {
    const ox = k * RW, a0 = Math.max(mx, ox), a1 = Math.min(mx + mw, ox + RW), b0 = Math.max(0, my), b1 = Math.min(RH, my + mh);
    if (a1 <= a0 || b1 <= b0) continue;
    ctx.drawImage(T.canvas, a0 - ox, b0, a1 - a0, b1 - b0, (a0 - mx) * TPP * kx, (b0 - my) * TPP * ky, (a1 - a0) * TPP * kx, (b1 - b0) * TPP * ky);
  }
  ctx.globalAlpha = 1;
  // roads (zoomed in enough)
  if (sw < 6000) {
    const pad = 40, x0 = sx - pad, x1 = sx + sw + pad, y0 = sy - pad, y1 = sy + sh + pad, w = game.world;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pass of [0, 1]) for (const R of realm.roads) {
      const P = R.pts;
      let inside = false;
      for (let n = 0; n < P.length; n += 8) { const x = w.near(P[n], sx + sw / 2); if (x > x0 && x < x1 && P[n + 1] > y0 && P[n + 1] < y1) { inside = true; break; } }
      if (!inside) continue;
      ctx.beginPath();
      for (let n = 0; n < P.length; n += 2) { const X = toX(P[n]), Y = toY(P[n + 1]); if (n) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      const wpx = Math.max(R.main ? 1.6 : 1.1, R.w * kx);
      if (!pass) { ctx.strokeStyle = 'rgba(36,22,13,0.55)'; ctx.lineWidth = wpx + 1.6; } else { ctx.strokeStyle = R.main ? '#e8d3a2' : '#cdb789'; ctx.lineWidth = wpx; }
      ctx.stroke();
    }
  }
  // settlements and names (labels placed greedily, the most important first; never overlapping)
  const boxes = [], fits = (x, y, w, h) => { if (boxes.some((b) => x < b[2] && x + w > b[0] && y < b[3] && y + h > b[1])) return false; boxes.push([x, y, x + w, y + h]); return true; };
  const level = !full ? 2 : sw > 5000 ? 0 : sw > 1600 ? 1 : 2;
  const RANK = { city: 0, castle: 1, village: 2 };
  const list = realm.settlements.filter((s) => RANK[s.kind] <= level + (level === 0 ? 0 : 0) && (level > 0 || s.kind === 'city')).map((s) => [s, toX(s.x), toY(s.y)])
    .filter(([, X, Y]) => X > -40 && Y > -40 && X < W + 40 && Y < H + 40).sort((a, b) => RANK[a[0].kind] - RANK[b[0].kind] || b[0].pop - a[0].pop);
  ctx.textAlign = 'center';
  for (const [s, X, Y] of list) {
    const K = realm.kingdoms[s.k], col = `rgb(${K.color.join(',')})`;
    const gs = s.kind === 'city' ? (full ? 13 : 10) : s.kind === 'castle' ? (full ? 10 : 8) : full ? 8 : 6;
    // the town land as a ring when zoomed in
    if (full && sw < 1200) { ctx.strokeStyle = 'rgba(246,234,208,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(X, Y, s.r * kx, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    glyph(ctx, s.kind, X, Y, gs, s.kind === 'village' ? '#f3e6c4' : col);
    if (!full) continue;
    const name = s.name, fs = s.kind === 'city' ? 13 : s.kind === 'castle' ? 11 : 10;
    if (level < 1 && s.kind !== 'city') continue;
    if (level < 2 && s.kind === 'village') continue;
    ctx.font = `${s.kind === 'city' ? 700 : 600} ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(name).width;
    if (!fits(X - tw / 2 - 2, Y + gs * 0.6, tw + 4, fs + 3)) continue;
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeText(name, X, Y + gs * 0.6 + fs);
    ctx.fillStyle = s.kind === 'city' ? '#ffe9a8' : CREAM; ctx.fillText(name, X, Y + gs * 0.6 + fs);
  }
  // kingdom names (with their shield) over their lands: always when zoomed out, faint when zoomed in
  if (full) {
    const w = game.world;
    for (const K of realm.kingdoms) {
      const [cx, cy] = T.centres[K.id], X = toX(w.near(cx, sx + sw / 2)), Y = toY(cy);
      if (X < -80 || Y < -40 || X > W + 80 || Y > H + 40) continue;
      const fs = sw > 5000 ? 12 : sw > 1600 ? 15 : 18;
      if (sw < 900) continue;
      const name = ('Reino de ' + K.name).toUpperCase();
      ctx.font = `800 ${fs}px Georgia, serif`;
      const tw = ctx.measureText(name).width;
      if (!fits(X - tw / 2 - 16, Y - fs, tw + 32, fs + 6)) continue;
      ctx.globalAlpha = sw > 1600 ? 0.95 : 0.75;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,12,6,0.9)'; ctx.strokeText(name, X + 8, Y);
      ctx.fillStyle = `rgb(${K.color.map((v) => Math.min(255, v * 0.5 + 128)).join(',')})`; ctx.fillText(name, X + 8, Y);
      const im = shieldImg(K);
      if (im) ctx.drawImage(im, X - tw / 2 - 14, Y - fs - 1, fs * 0.9, fs * 1.05);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
export { drawShield };
