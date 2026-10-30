// Bow reach flash (owner): when the local player starts the auto attack with a bow, and on every auto shot, a soft
// low-opacity disc with a dashed rim around them blinks in and out — how far the auto attack reaches from where they
// stand (the bow's range, +20 % per story up high: levels.heightK). Local and cosmetic (event 'rangeflash' from
// combat.js / controller.js). Drawn into the ground-plant layer (B.decor): over the grass, under people and trees.
import { heightK } from '../game/levels.js';

const DUR = 0.95;               // s: in and out
const FILL = 0.22, RIM = 0.95;  // peak opacities (the area / its edge)
const COL = [1, 0.98, 0.9];     // soft daylight white (reads on grass, sand, snow and at night)
const SUM = 2.45;               // how much the soft dots of the fill pile up (fx_soft profile × hex density)

export function rangeFlashSystem(game) {
  let t = -1, wired = false;
  return {
    sync: 'cosmetic',
    update(g, dt) {
      if (!wired) { wired = true; g.events.on('rangeflash', () => { t = t >= 0 && t < DUR * 0.45 ? t : 0; }); }
      if (t >= 0) { t += dt; if (t > DUR) t = -1; }
    },
    render(g, B, v, env) {
      const p = g.player, pr = p?.wprof;
      if (t < 0 || !pr?.ranged || p.dead || !g.A.has('fx_soft')) return;
      const A = g.A, soft = A.get('fx_soft'), dot = A.has('fx_spark') ? A.get('fx_spark') : soft, L = B.decor;
      const a = Math.sin(Math.PI * Math.min(1, t / DUR)) ** 1.5; // soft blink: up, then away
      const R = (pr.range || 8) * heightK(p, null);
      // the area: a hex grid of soft dots — together a flat, faintly lit disc with a soft edge (~330 dots at most)
      const s = Math.max(0.95, R / 9.5), r = 1.55 * s, h = s * 0.866, ad = (FILL * a) / SUM;
      const sx = (2 * r) / soft.w, sy = (2 * r) / soft.h, lim = (R - 0.35 * r) ** 2, nj = Math.ceil(R / h), ni = Math.ceil(R / s) + 1;
      for (let j = -nj; j <= nj; j++) {
        const dy = j * h, y = p.y + dy;
        if (y < v.y0 - 2 || y > v.y1 + 2) continue;
        const off = j & 1 ? s / 2 : 0;
        for (let i = -ni; i <= ni; i++) {
          const dx = i * s + off;
          if (dx * dx + dy * dy > lim) continue;
          const x = p.x + dx;
          if (x < v.x0 - 2 || x > v.x1 + 2) continue;
          L.add(soft, x, y, sx, sy, COL[0], COL[1], COL[2], ad);
        }
      }
      // its edge: short dashes, slowly turning
      const night = env?.night || 0, px = 1 / g.cam.zoom, n = Math.max(36, Math.min(160, Math.round((R * Math.PI * 2) / 0.75)));
      const dl = Math.max(0.55, 20 * px) / dot.w, dh = Math.max(0.2, 9 * px) / dot.h;
      for (let k = 0; k < n; k++) {
        const an = (k / n) * Math.PI * 2 + g.time * 0.05;
        const x = p.x + Math.cos(an) * R, y = p.y + Math.sin(an) * R;
        if (x < v.x0 - 1 || x > v.x1 + 1 || y < v.y0 - 1 || y > v.y1 + 1) continue;
        L.add(dot, x, y, dl, dh, COL[0], COL[1], COL[2], RIM * a, 0, an + Math.PI / 2);
        if (night > 0.1) B.emissive.add(dot, x, y, dl, dh, COL[0] * 0.5, COL[1] * 0.5, COL[2] * 0.5, 0.6 * a * night, 0, an + Math.PI / 2); // (readable in the dark)
      }
    },
  };
}
