// Leafy masses (tree canopies, bushes): clusters of scalloped lumps layered like scales (upper lumps
// overlap and cast a soft shadow onto the ones below), cel-shaded with light from the top-left,
// plus painted leaf dabs and a global volume gradient.

import { TAU, clamp, ramp, rgb, hex, lin, rad, atop, circle } from './paint.js';

const LX = -0.6, LY = -0.8; // direction toward the light
const NB = 14;
const BINS = new Array(NB).fill(null);

export function mkLump(x, y, r, rand, scallop = 1) {
  const sc = [];
  const rs0 = r * 0.19 * scallop;
  const n = Math.max(8, Math.round((TAU * r) / (rs0 * 1.75)));
  const a0 = rand() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + (rand() - 0.5) * 0.25;
    const rr = rs0 * (0.8 + rand() * 0.55);
    const d = r * (0.86 + rand() * 0.06);
    sc.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: rr });
  }
  return { x, y, r, sc, lf: 0.5 };
}

export function lumpPath(g, L, s = 1, ox = 0, oy = 0) {
  const cx = L.x + ox * L.r, cy = L.y + oy * L.r;
  circle(g, cx, cy, L.r * 0.9 * s);
  for (const c of L.sc) circle(g, cx + c.dx * s, cy + c.dy * s, c.r * s);
}

function leafDab(g, x, y, s, a) {
  const c = Math.cos(a), sn = Math.sin(a);
  g.moveTo(x - c * s, y - sn * s);
  g.quadraticCurveTo(x - sn * s * 0.55, y + c * s * 0.55, x + c * s, y + sn * s);
  g.quadraticCurveTo(x + sn * s * 0.55, y - c * s * 0.55, x - c * s, y - sn * s);
  g.closePath();
}

// pal: { deep, dark, mid, light, high } hex
// opts: { cx, cy, R, RY (canopy center & radii for global light), marks (leaf dab density), drop (shadow strength),
//         lfBias }
// Lumps are drawn bottom-first (sorted by y descending) so upper lumps overlap lower ones.
export function drawFoliage(g, lumps, pal, rand, opts) {
  const stops = [pal.deep, pal.dark, pal.mid, pal.light, pal.high];
  const { cx, cy, R } = opts;
  const RY = opts.RY || R;
  const marks = opts.marks ?? 1;
  const drop = opts.drop ?? 0.55;
  const deep = hex(pal.deep);
  for (const L of lumps) {
    const d = ((L.x - cx) / R) * LX + ((L.y - cy) / RY) * LY;
    L.lf = clamp(0.5 + 0.6 * d + (opts.lfBias || 0), 0, 1);
  }
  // leaf sprigs poking out of the outer lumps (break up the round silhouette; drawn first so lumps cover their stems)
  const sprigs = opts.sprigs ?? 0;
  if (sprigs > 0) {
    const pl = new Path2D(), pd = new Path2D();
    for (const L of lumps) {
      const dx = (L.x - cx) / R, dy = (L.y - cy) / RY;
      if (dx * dx + dy * dy < 0.12) continue;
      const base = Math.atan2(dy * RY, dx * R);
      const n = Math.round(sprigs * (0.6 + rand() * 1.6));
      for (let i = 0; i < n; i++) {
        const a = base + (rand() - 0.5) * 1.7;
        if (Math.sin(a) > 0.72) continue; // no sprigs hanging straight down
        const r0 = L.r * (0.78 + rand() * 0.1), len = 3.5 + rand() * 3.5 + L.r * 0.12;
        const x0 = L.x + Math.cos(a) * r0, y0 = L.y + Math.sin(a) * r0;
        const lit = Math.cos(a) * LX + Math.sin(a) * LY > -0.1;
        const P2 = lit ? pl : pd;
        for (const da of [-0.38, 0.05, 0.42]) {
          const aa = a + da + (rand() - 0.5) * 0.2, l = len * (da === 0.05 ? 1 : 0.75);
          const x1 = x0 + Math.cos(aa) * l, y1 = y0 + Math.sin(aa) * l + l * 0.2;
          const nx = -Math.sin(aa) * l * 0.32, ny = Math.cos(aa) * l * 0.32;
          P2.moveTo(x0, y0);
          P2.quadraticCurveTo((x0 + x1) / 2 + nx, (y0 + y1) / 2 + ny, x1, y1);
          P2.quadraticCurveTo((x0 + x1) / 2 - nx, (y0 + y1) / 2 - ny, x0, y0);
          P2.closePath();
        }
      }
    }
    g.fillStyle = ramp(stops, 0.18); g.fill(pd);
    g.fillStyle = ramp(stops, 0.5); g.fill(pl);
  }
  const order = lumps.slice().sort((a, b) => b.y - a.y);
  let first = true;
  for (const L of order) {
    const lf = L.lf;
    // soft shadow cast onto the lumps below
    if (!first && drop > 0) {
      atop(g, () => {
        g.beginPath(); lumpPath(g, L, 1.0, 0.05, 0.2);
        g.fillStyle = rgb(deep, drop); g.fill();
      });
    }
    first = false;
    // shadow side
    g.beginPath(); lumpPath(g, L); g.fillStyle = ramp(stops, 0.12 + 0.24 * lf); g.fill();
    // body (lit)
    g.beginPath(); lumpPath(g, L, 0.86, -0.07, -0.13); g.fillStyle = ramp(stops, 0.4 + 0.24 * lf); g.fill();
    // light cap
    if (lf > 0.22) {
      g.beginPath(); lumpPath(g, L, 0.56, -0.2, -0.3); g.fillStyle = ramp(stops, 0.6 + 0.26 * lf); g.fill();
    }
    // painted leaf dabs (batched per tone bin: far fewer fill calls)
    if (marks > 0) {
      // (no clip: dabs stay inside 0.8 r, which is always inside the lump; clipping is costly)
      const n = Math.round(L.r * L.r * 0.04 * marks);
      const bins = BINS;
      for (let i = 0; i < NB; i++) bins[i] = null;
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, rr = Math.sqrt(rand()) * L.r * 0.8;
        const x = L.x + Math.cos(a) * rr, y = L.y + Math.sin(a) * rr;
        const loc = (Math.cos(a) * LX + Math.sin(a) * LY) * (rr / (L.r * 0.8)); // -1..1 (lit side +)
        const base = 0.4 + 0.24 * lf + loc * 0.22;
        const light = rand() < 0.5 + loc * 0.35;
        const t = light ? base + 0.16 + rand() * 0.1 : base - 0.18 - rand() * 0.08;
        const b = Math.max(0, Math.min(NB - 1, Math.round(t * (NB - 1))));
        leafDab(bins[b] || (bins[b] = new Path2D()), x, y, 1.5 + rand() * 1.5, 0.5 + (rand() - 0.5) * 1.6);
      }
      for (let i = 0; i < NB; i++) if (bins[i]) { g.fillStyle = ramp(stops, i / (NB - 1), 0.9); g.fill(bins[i]); }
    }
    // specular highlight flecks on the most lit lumps
    if (lf > 0.6) {
      const n = 2 + Math.floor(rand() * 3);
      g.fillStyle = ramp(stops, 0.95);
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (1.08 + rand() * 0.5), rr = L.r * (0.4 + rand() * 0.25);
        g.beginPath(); leafDab(g, L.x + Math.cos(a) * rr, L.y + Math.sin(a) * rr, 1.6 + rand(), 0.4); g.fill();
      }
    }
  }
  // global volume: warm light top-left, deep shade bottom-right & underside
  atop(g, () => {
    g.fillStyle = rad(g, cx - R * 0.45, cy - RY * 0.55, 0, R * 1.9, [
      [0, 'rgba(255,246,190,0.12)'], [0.42, 'rgba(0,0,0,0)'], [1, rgb(deep, 0.5)]]);
    g.fillRect(cx - R * 2, cy - RY * 2, R * 4, RY * 4);
    g.fillStyle = lin(g, 0, cy + RY * 0.3, 0, cy + RY * 1.05, [[0, 'rgba(0,0,0,0)'], [1, rgb(deep, 0.45)]]);
    g.fillRect(cx - R * 2, cy, R * 4, RY * 2);
  });
}

// generic dome bush lump set
export function bushLumps(cx, baseY, w, h, rand) {
  const L = [];
  const cy = baseY - h * 0.5;
  const m = Math.min(w, h);
  // back/top arc
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = Math.PI * (1.1 + t * 0.8) + (rand() - 0.5) * 0.2;
    L.push(mkLump(cx + Math.cos(a) * w * 0.3, cy + 0.05 * h + Math.sin(a) * h * 0.26, m * (0.25 + rand() * 0.06), rand));
  }
  // front/bottom row
  for (let i = 0; i < 3; i++) {
    L.push(mkLump(cx + (i - 1) * w * 0.25 + (rand() - 0.5) * 3, baseY - h * 0.28 + (rand() - 0.5) * 2, m * (0.25 + rand() * 0.05), rand));
  }
  L.push(mkLump(cx + (rand() - 0.5) * 5, cy - h * 0.06, m * 0.29, rand));
  return L;
}
