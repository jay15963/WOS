// Top art for solid pieces whose painters draw only a front (art/faces/solid.js `cap`): a furnace dome, a stone
// lantern's roof, the tops of posts, footings and capitals. Seen from straight above, light from the top-left, painted
// for a unit top — a disc for round parts (lathes), a square for boxes — and laid by the kit on the part's top (and the
// upper rings of a dome) without stretching. One lazy sprite per kind, colour and shape, painted only when a turned
// camera asks for it (never baked).
//   kinds: stone (fieldstones in mortar) · slab (dressed stone, bevelled rim) · wood (end grain: rings and checks) ·
//          plank (boards) · iron (dark metal, a soft ring highlight)
import { spritePx, rng, TAU, mixc, rad, lin, blobPts, smoothClosed, circle } from './paint.js';
import { lazyDef, LAZY_DEFS } from './lazyDefs.js';

const S = 64, M = 1; // canvas size and the transparent margin kept by the lazy crop (the kit maps into [M, S − M])

// name of the cap art for (kind, '#rrggbb', round), registered on first use; the tables call it at import time
export function capArt(kind, col, round = true) {
  const name = `cap_${col.replace('#', '')}_${kind}_${round ? 'r' : 'q'}`; // (ends in a letter: not a lazy group)
  if (!LAZY_DEFS.has(name)) lazyDef(name, () => paintCap(kind, col, round), 0.5, 0.5);
  return name;
}

function paintCap(kind, col, round) {
  const rand = rng(911 + kind.length * 31 + parseInt(col.slice(1), 16) % 997);
  return spritePx(S, S, (g) => {
    const c = S / 2, R = c - M;
    g.save();
    g.beginPath();
    if (round) circle(g, c, c, R); else g.rect(M, M, S - 2 * M, S - 2 * M);
    g.clip();
    PAINT[kind](g, col, rand, round, c, R);
    // the rim: a soft bevel (light top-left, dark bottom-right) and a thin dark edge
    g.lineWidth = 3;
    if (round) {
      g.strokeStyle = lin(g, M, M, S - M, S - M, [[0, 'rgba(255,248,230,0.32)'], [0.5, 'rgba(0,0,0,0.05)'], [1, 'rgba(20,14,8,0.42)']]);
      g.beginPath(); circle(g, c, c, R - 1.5); g.stroke();
      g.strokeStyle = 'rgba(24,18,12,0.55)'; g.lineWidth = 1.2; g.beginPath(); circle(g, c, c, R - 0.5); g.stroke();
    } else {
      g.strokeStyle = 'rgba(255,248,230,0.3)'; g.beginPath(); g.moveTo(M + 1.5, S - M); g.lineTo(M + 1.5, M + 1.5); g.lineTo(S - M, M + 1.5); g.stroke();
      g.strokeStyle = 'rgba(20,14,8,0.38)'; g.beginPath(); g.moveTo(S - M - 1.5, M); g.lineTo(S - M - 1.5, S - M - 1.5); g.lineTo(M, S - M - 1.5); g.stroke();
      g.strokeStyle = 'rgba(24,18,12,0.5)'; g.lineWidth = 1.2; g.strokeRect(M + 0.6, M + 0.6, S - 2 * M - 1.2, S - 2 * M - 1.2);
    }
    g.restore();
  }, { crop: false });
}

const PAINT = {
  // fieldstones set in mortar (a dome, a rough footing)
  stone(g, col, rand, round, c, R) {
    g.fillStyle = mixc(col, '#2e2822', 0.45); g.fillRect(0, 0, S, S);
    const rings = round ? [[0, 1], [9, 6], [18, 11], [26, 15]] : null;
    const put = (x, y, r) => {
      const pts = blobPts(x, y, r, r * (0.75 + rand() * 0.25), rand, 8, 0.18, rand() * TAU);
      const base = mixc(col, rand() < 0.5 ? '#fff6e6' : '#3a3229', rand() * 0.28);
      g.beginPath(); smoothClosed(g, pts); g.fillStyle = base; g.fill();
      g.fillStyle = 'rgba(255,250,236,0.3)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.32, r * 0.42, r * 0.28, -0.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(24,18,12,0.22)'; g.beginPath(); g.ellipse(x + r * 0.28, y + r * 0.3, r * 0.55, r * 0.32, -0.6, 0, TAU); g.fill();
    };
    if (rings) {
      for (const [rr, n] of rings) for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rr * 0.37 + (rand() - 0.5) * 0.3;
        put(c + Math.cos(a) * rr, c + Math.sin(a) * rr, rr ? 4.6 + rand() * 1.2 : 5.5);
      }
    } else {
      for (let y = 4; y < S; y += 9) for (let x = 3 + ((y / 9) & 1) * 4.5; x < S; x += 9) put(x + (rand() - 0.5) * 2, y + (rand() - 0.5) * 2, 4.4 + rand() * 1.2);
    }
    shadeTop(g, c, R);
  },
  // dressed stone: an even face with chisel specks and a few veins
  slab(g, col, rand, round, c, R) {
    g.fillStyle = col; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 140; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(255,252,240,0.2)' : 'rgba(30,26,20,0.18)'; g.fillRect(rand() * S, rand() * S, 1.4, 1.4); }
    g.strokeStyle = 'rgba(40,34,28,0.22)'; g.lineWidth = 0.9;
    for (let i = 0; i < 3; i++) { const x = rand() * S, y = rand() * S; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y + (rand() - 0.5) * 10, x + 16 + rand() * 10, y + (rand() - 0.5) * 12); g.stroke(); }
    // a raised margin a few px in from the edge (a tooled border)
    g.strokeStyle = 'rgba(255,250,235,0.18)'; g.lineWidth = 1;
    if (round) { g.beginPath(); circle(g, c, c, R - 7); g.stroke(); } else g.strokeRect(M + 7, M + 7, S - 2 * M - 14, S - 2 * M - 14);
    shadeTop(g, c, R);
  },
  // the end of a log / post: growth rings round the pith, radial checks, the bark rim
  wood(g, col, rand, round, c, R) {
    g.fillStyle = mixc(col, '#f0d6a8', 0.25); g.fillRect(0, 0, S, S);
    const ox = c + (rand() - 0.5) * 3, oy = c + (rand() - 0.5) * 3;
    for (let r = 3; r < R * 1.5; r += 3 + rand() * 1.6) {
      g.strokeStyle = `rgba(90,54,26,${0.22 + rand() * 0.18})`; g.lineWidth = 0.8 + rand() * 0.7;
      g.beginPath(); g.ellipse(ox, oy, r, r * (0.94 + rand() * 0.08), rand() * TAU, 0, TAU); g.stroke();
    }
    g.fillStyle = mixc(col, '#3a2414', 0.4); g.beginPath(); circle(g, ox, oy, 1.6); g.fill();
    g.strokeStyle = 'rgba(40,24,12,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 3; i++) { const a = rand() * TAU, r0 = 4 + rand() * 6, r1 = r0 + 8 + rand() * 12; g.beginPath(); g.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0); g.lineTo(ox + Math.cos(a + 0.05) * r1, oy + Math.sin(a + 0.05) * r1); g.stroke(); }
    if (round) { g.strokeStyle = mixc(col, '#2a1a0c', 0.55); g.lineWidth = 4; g.beginPath(); circle(g, c, c, R - 2); g.stroke(); }
    shadeTop(g, c, R, 0.18);
  },
  // boards side by side with their grain
  plank(g, col, rand, round, c, R) {
    const n = 4, w = S / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = mixc(col, rand() < 0.5 ? '#fff0d0' : '#2a1a0c', rand() * 0.18); g.fillRect(i * w, 0, w, S);
      g.strokeStyle = 'rgba(70,42,20,0.28)'; g.lineWidth = 0.7;
      g.beginPath(); for (let k = 0; k < 3; k++) { const x = i * w + 3 + rand() * (w - 6); g.moveTo(x, 0); g.bezierCurveTo(x + 1.5, S * 0.3, x - 1.5, S * 0.7, x + 0.5, S); } g.stroke();
      g.fillStyle = 'rgba(40,24,12,0.55)'; g.fillRect(i * w, 0, 1, S);
    }
    shadeTop(g, c, R, 0.14);
  },
  // forged iron: dark, a soft ring of light round the middle
  iron(g, col, rand, round, c, R) {
    g.fillStyle = rad(g, c - 6, c - 6, 1, R * 1.2, [[0, mixc(col, '#c8c8d2', 0.45)], [0.45, col], [1, mixc(col, '#08080a', 0.45)]]);
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(rand() * S, rand() * S, 1.2, 1.2); }
  },
};
// light from the top-left over the whole top
function shadeTop(g, c, R, k = 0.24) {
  g.fillStyle = lin(g, c - R, c - R, c + R, c + R, [[0, `rgba(255,248,232,${k})`], [0.5, 'rgba(0,0,0,0)'], [1, `rgba(20,14,8,${k * 1.2})`]]);
  g.fillRect(0, 0, S, S);
}
