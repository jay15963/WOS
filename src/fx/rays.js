// Interior sun rays ("god rays", agent J): soft angled shafts of sunlight through openings into dark interiors,
// with a bright patch where they land and dust motes floating in them. Cosmetic only, derived from shared state
// (roof grids, doors, walls, natural roofs) and the time of day, so every peer sees the same rays.
//   - built interiors: open doors / gaps on the sun side of a roofed region, windows (walls whose o.det has a
//     'window' id — agent K's details), holes in the roof (unroofed tiles surrounded by roof: tiles removed for a
//     stair, a skylight…); drawn only where the roof over them is faded (the local player is inside);
//   - caves: open-sky tiles (the ceiling collapsed / was mined open, cave mouths) next to cave floor.
// Shaft primitive (compatible with agent C's outdoor one: a world point, a direction, a width):
//   drawShaft(B, A, x, y, h, dx, dy, width, r, g, b, a) — from (x, y) at height h down along the sun to
//   (x + dx·h, y + dy·h) on the ground; (dx, dy) = env.shadowDir (ground offset per unit height).
// Golden and long in the morning, shorter at noon, warm late in the afternoon, none at night / under heavy cloud.
// Quality: high 22 shafts + motes, medium 14 + motes, low 7 without motes.

const MAXN = { high: 22, medium: 14, low: 7 };

export function drawShaft(B, A, x, y, h, dx, dy, width, r, g, b, a) {
  const s = A.has('fx_shaft') ? A.get('fx_shaft') : null;
  if (!s || a <= 0.003) return;
  const sx = dx * h, sy = dy * h + h;                  // screen vector from the top of the shaft to the landing point
  const len = Math.hypot(sx, sy);
  if (len < 0.05) return;
  B.emissive.add(s, x, y, width / s.w, len / s.h, r, g, b, a, 0, Math.atan2(-sx, sy), 0, 1, 0, h);
}

export function raysSystem() {
  let scanT = 0, moteAcc = 0;
  const list = [];   // { kind 'door'|'hole'|'cave'|'window', x, y (opening, ground), h (height), w, tx, ty (landing tile) }
  return {
    sync: 'cosmetic',
    update(game, dt) {
      game.rays = list; // (debug)
      scanT -= dt;
      if (scanT <= 0) { scanT = 0.45; scan(game, list); }
    },
    render(game, B, v, env) {
      if (!list.length || !(env.day > 0.04)) return;
      const A = game.A, R = game.roofs, w = game.world;
      const sd = env.shadowDir, sdl = Math.hypot(sd[0], sd[1]);
      if (sdl < 0.01) return;
      const h = env.hour;
      // time of day: golden and strong in the morning, white-warm at noon, amber late in the afternoon
      const morning = h > 5.5 && h < 10.5 ? Math.sin(((h - 5.5) / 5) * Math.PI) : 0;
      const evening = h > 14.5 && h < 19 ? Math.sin(((h - 14.5) / 4.5) * Math.PI) : 0;
      const k = env.day * (1 - env.cloud * 0.88) * (1 - env.rain * 0.9) * (0.62 + 0.7 * morning + 0.35 * evening);
      if (k < 0.02) return;
      const cr = 1, cg = 0.95 - 0.17 * morning - 0.2 * evening, cb = 0.86 - 0.4 * morning - 0.42 * evening;
      const q = game.quality || 'high', glow = A.has('fx_soft') ? A.get('fx_soft') : null;
      const motes = q !== 'low' && A.has('fx_spark');
      const t = game.time;
      moteAcc += (game._dt || 0.016) * (q === 'high' ? 7 : 4);
      let emitN = 0;
      while (moteAcc > 1) { moteAcc -= 1; emitN++; }
      for (const s of list) {
        if (s.x < v.x0 - 4 || s.x > v.x1 + 4 || s.y < v.y0 - 3 || s.y > v.y1 + 5) continue;
        // inside a building: only where its roof is faded (the local player is in there)
        let vis = 1;
        if (s.kind !== 'cave') {
          const i = w.idx(s.tx, s.ty), g = R?.regions.get(R.regionOf[i]);
          vis = g ? 1 - g.alpha : 0;
          if (vis < 0.02) continue;
        } else if (R?.data) {
          // a cave skylight lands on a floor hidden by the cave ceiling while the local player is outside it
          vis = 1 - R.data[w.idx(s.tx, s.ty) * 4 + 3] / 255;
          if (vis < 0.02) continue;
        }
        const breathe = 0.88 + 0.12 * Math.sin(t * 0.37 + s.x * 1.3 + s.y * 0.7);
        const a = k * vis * breathe;
        const lx = s.x + sd[0] * s.h, ly = s.y + sd[1] * s.h;
        // the beam (additive, after the lighting: it glows in the dark air) and a softer wide halo around it
        drawShaft(B, A, s.x, s.y, s.h, sd[0], sd[1], s.w, cr, cg, cb, 0.28 * a);
        drawShaft(B, A, s.x, s.y, s.h, sd[0], sd[1], s.w * 2.2, cr, cg, cb, 0.09 * a);
        // the bright patch on the floor (light map: it lights the dark floor) + a faint glow on top
        const pl = Math.min(2.6, s.h * sdl), px = s.x + sd[0] * s.h * 0.5, py = s.y + sd[1] * s.h * 0.5 + 0.35;
        B.light.addRaw(lx, ly + 0.3, s.w * 1.7 + 0.4, s.w * 1.2 + 0.3, cr, cg, cb, a);
        if (pl > 0.8) B.light.addRaw(px, py, s.w * 1.3 + pl * 0.4, s.w * 0.9 + pl * 0.3, cr, cg, cb, 0.45 * a);
        if (glow) B.emissive.add(glow, lx, ly + 0.3, (s.w * 1.4) / glow.w, (s.w * 0.8) / glow.h, cr, cg, cb, 0.05 * a, 0, 0, 0, 1, 0, 0.01);
        // dust motes drifting in the beam
        if (motes && emitN > 0 && Math.random() < 0.5 * vis) {
          emitN--;
          const u = Math.random();
          game.particles.emit({ spr: 'fx_spark', x: s.x + sd[0] * s.h * u + (Math.random() - 0.5) * s.w * 0.7, y: s.y + sd[1] * s.h * u + 0.15, lift: s.h * (1 - u) + 0.05,
            vx: (Math.random() - 0.5) * 0.05, vy: (Math.random() - 0.5) * 0.04, vlift: (Math.random() - 0.5) * 0.04, drag: 0.1, life: 3 + Math.random() * 3,
            size: (0.05 + Math.random() * 0.05) / A.get('fx_spark').w, size1: 0.03 / A.get('fx_spark').w, r: 1, g: 0.92, b: 0.7, a: 0.5 * a, a1: 0, fadeIn: 1, layer: 'emissive', ground: false });
        }
      }
    },
  };
}

// openings in view (rescanned twice a second): sun-side openings of roofed interiors, roof holes, cave skylights
function scan(game, out) {
  out.length = 0;
  const env = game.env?.env;
  if (!env || !(env.day > 0.04)) return;
  const w = game.world, W = w.W, Bf = w.broof, NR = w.roof, K = w.rock, S = w.solid, v = game.view();
  const sd = env.shadowDir, sl = Math.hypot(sd[0], sd[1]) || 1;
  const nx = sd[0] / sl, ny = sd[1] / sl; // light travels along (nx, ny)
  const sky = (i) => !K[i] && !Bf[i] && !NR[i];
  const x0 = Math.max(1, Math.floor(v.x0) - 3), x1 = Math.min(W - 2, Math.ceil(v.x1) + 3), y0 = Math.max(1, Math.floor(v.y0) - 3), y1 = Math.min(w.H - 2, Math.ceil(v.y1) + 4);
  const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
  const R = game.roofs, grid = game.build?.grid?.main;
  const hasBuilt = R && R.regions.size > 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (K[i] || w.water[i]) continue;
    if (hasBuilt && Bf[i]) {
      // an opening in the wall line: open door / gap (not solid) or a window, with open sky outside, roofed floor
      // inside and the sun on the outside (the light travels into the room)
      let win = false;
      if (S[i] === 1) { const o = grid?.get(i); win = !!(o && typeof o.det === 'string' && /(^|\.)window/.test(o.det)); if (!win) continue; }
      for (let k = 0; k < 4; k++) {
        const ox = k === 0 ? 1 : k === 1 ? -1 : 0, oy = k === 2 ? 1 : k === 3 ? -1 : 0; // outward normal
        const out_ = i + oy * W + ox, in_ = i - oy * W - ox;
        if (!sky(out_) || !Bf[in_] || S[in_] === 1 || ox * nx + oy * ny > -0.2) continue;
        const hh = win ? 0.55 : 0.95;
        out.push({ kind: win ? 'window' : 'door', x: x + 0.5 + ox * 0.45, y: y + 0.5 + oy * 0.45, h: hh, w: win ? 0.55 : 0.9,
          tx: Math.floor(x + 0.5 + sd[0] * hh), ty: Math.floor(y + 0.5 + sd[1] * hh), d: 0 });
        break;
      }
      continue;
    }
    if (S[i] === 1 || !sky(i)) continue;
    // a hole in a built roof (tiles removed for a stair, a skylight…): open sky surrounded by roof
    let nb = 0, nc = 0;
    if (Bf[i - 1]) nb++; if (Bf[i + 1]) nb++; if (Bf[i - W]) nb++; if (Bf[i + W]) nb++;
    if (NR[i - 1] && !K[i - 1]) nc++; if (NR[i + 1] && !K[i + 1]) nc++; if (NR[i - W] && !K[i - W]) nc++; if (NR[i + W] && !K[i + W]) nc++;
    if (nb >= 3) {
      const H = roofTop(game, x, y);
      const lx = Math.floor(x + 0.5 + sd[0] * H), ly = Math.floor(y + 0.5 + sd[1] * H);
      out.push({ kind: 'hole', x: x + 0.5, y: y + 0.5, h: H, w: 1, tx: Math.max(0, Math.min(W - 1, lx)), ty: Math.max(0, Math.min(w.H - 1, ly)), d: 0 });
    } else if (nc >= 1) {
      // a cave skylight / mouth: the shaft lands on the cave floor
      const H = 1.3, lx = Math.floor(x + 0.5 + sd[0] * H), ly = Math.floor(y + 0.5 + sd[1] * H);
      if (!w.inBounds(lx, ly)) continue;
      const j = ly * W + lx;
      if (!NR[j] || K[j]) continue;
      out.push({ kind: 'cave', x: x + 0.5, y: y + 0.5, h: H, w: 1, tx: lx, ty: ly, d: 0 });
    }
  }
  for (const s of out) s.d = Math.hypot(s.x - cx, s.y - cy);
  out.sort((a, b) => a.d - b.d);
  const cap = MAXN[game.quality] || 14;
  if (out.length > cap) out.length = cap;
}

// height of the roof around a hole (the shaft starts there)
function roofTop(game, x, y) {
  const R = game.roofs, w = game.world;
  let h = 0, n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const i = w.idx(x + dx, y + dy), g = R.regions.get(R.regionOf[i]);
    if (!g?.art) continue;
    const a = g.art.tiles;
    let lo = 0, hi = a.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === i) { h += g.art.tileH[m]; n++; break; } if (a[m] < i) lo = m + 1; else hi = m - 1; }
  }
  return n ? Math.min(3, h / n) : 1.2;
}
