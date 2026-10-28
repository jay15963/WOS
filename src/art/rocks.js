// Boulders: chunky low-poly stones — a top plane plus side facets shaded by their facing (light top-left).

import { sprite, rng, OW, TAU, lin, rgb, hex, mixc, atop, clamp, circle } from './paint.js';

const STONES = [
  { dark: '#4f4b46', mid: '#837d74', light: '#aaa398', high: '#c4beb2', moss: false },
  { dark: '#4b4843', mid: '#7a766f', light: '#a19d95', high: '#bdb9b0', moss: true },
  { dark: '#544b42', mid: '#8a7e70', light: '#ada194', high: '#c8bdae', moss: false },
  { dark: '#484a4a', mid: '#777b7a', light: '#9da19e', high: '#b9bdb9', moss: true },
];

function boulder(v) {
  const rand = rng(12000 + v * 61);
  const S = [[1.05, 0.85, 26, 21], [1.15, 0.8, 30, 18], [0.95, 0.9, 23, 24], [1.2, 0.95, 31, 23]][v % 4];
  const C = STONES[v % STONES.length];
  return sprite(S[0], S[1], (g, P) => {
    const cx = P.W / 2, baseY = P.H - 7;
    const rx = S[2], ry = S[3];
    const cy = baseY - ry * 0.95;
    // silhouette points (flattened bottom)
    const n = 9 + (v % 3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (rand() - 0.5) * 0.35 + Math.PI * 0.1;
      const k = 0.85 + rand() * 0.25;
      let x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k;
      if (y > baseY) y = baseY - rand() * 2;
      pts.push([x, y]);
    }
    // top plane: inner polygon shifted up-left
    const tcx = cx - rx * 0.12, tcy = cy - ry * 0.32;
    const top = pts.map(([x, y]) => [tcx + (x - cx) * (0.5 + rand() * 0.12), tcy + (y - cy) * (0.42 + rand() * 0.12)]);
    P.layer((g) => {
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath();
      g.fillStyle = C.mid; g.fill();
      // side facets
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [x0, y0] = pts[i], [x1, y1] = pts[j];
        let nx = y1 - y0, ny = -(x1 - x0);
        const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
        // make sure normal points outward
        const mx = (x0 + x1) / 2 - cx, my = (y0 + y1) / 2 - cy;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        const lit = clamp(0.5 + 0.55 * (nx * -0.6 + ny * -0.8), 0, 1);
        const col = lit > 0.5 ? mixc(C.mid, C.light, (lit - 0.5) * 2) : mixc(C.dark, C.mid, lit * 2);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(top[j][0], top[j][1]); g.lineTo(top[i][0], top[i][1]); g.closePath();
        g.fillStyle = col; g.fill();
        g.strokeStyle = col; g.lineWidth = 0.6; g.stroke(); // hide seams
      }
      // top plane
      g.beginPath(); g.moveTo(top[0][0], top[0][1]); for (const p of top) g.lineTo(p[0], p[1]); g.closePath();
      g.fillStyle = lin(g, tcx - rx * 0.5, tcy - ry * 0.4, tcx + rx * 0.5, tcy + ry * 0.4, [[0, C.high], [1, C.light]]); g.fill();
      // facet edges (subtle)
      g.strokeStyle = rgb(hex(C.dark), 0.45); g.lineWidth = 0.9;
      for (let i = 0; i < n; i += 1 + (i % 2)) { g.beginPath(); g.moveTo(top[i][0], top[i][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke(); }
      // lit ridge on the top plane edge (top-left)
      g.strokeStyle = 'rgba(255,252,240,0.55)'; g.lineWidth = 1.2;
      g.beginPath();
      let started = false;
      for (let i = 0; i <= n; i++) {
        const p = top[i % n];
        if (p[0] < tcx + rx * 0.2 && p[1] < tcy + ry * 0.15) { if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); }
        else started = false;
      }
      g.stroke();
      // cracks & speckles
      g.strokeStyle = rgb(hex(C.dark), 0.75); g.lineWidth = 1.1;
      for (let k = 0; k < 2; k++) {
        let x = cx + (rand() - 0.3) * rx * 0.8, y = cy + (rand() - 0.5) * ry * 0.6;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 3; s++) { x += (rand() - 0.3) * 6; y += 2 + rand() * 4; g.lineTo(x, y); }
        g.stroke();
      }
      for (let k = 0; k < 14; k++) {
        g.fillStyle = rand() < 0.5 ? rgb(hex(C.dark), 0.35) : 'rgba(255,255,245,0.25)';
        g.beginPath(); circle(g, cx + (rand() - 0.5) * rx * 1.5, cy + (rand() - 0.5) * ry * 1.2, 0.6 + rand() * 0.8); g.fill();
      }
      // moss patches on top
      if (C.moss) {
        for (let k = 0; k < 3; k++) {
          const x = tcx + (rand() - 0.5) * rx * 0.7, y = tcy + (rand() - 0.6) * ry * 0.4;
          for (let j = 0; j < 5; j++) {
            g.fillStyle = j % 2 ? '#5f7a35' : '#73903f';
            g.beginPath(); circle(g, x + (rand() - 0.5) * 7, y + (rand() - 0.5) * 3, 1.6 + rand() * 1.8); g.fill();
          }
        }
      }
      // ground contact darkening
      atop(g, () => {
        g.fillStyle = lin(g, 0, baseY - ry * 0.6, 0, baseY + 1, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(20,16,12,0.35)']]);
        g.fillRect(0, 0, P.W, P.H);
      });
    }, OW);
  });
}

export function addRocks(add) {
  for (let i = 0; i < 4; i++) { const c = boulder(i); add('boulder_' + i, c, 0.5, 1 - 7 / (c.origH || c.height)); }
}
