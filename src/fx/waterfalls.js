// Waterfalls and rapids (docs/TERRAIN-HEIGHT.md "Cachoeiras"), the cosmetic side. The falling sheet, the white water and
// the churning foam at the foot are drawn by the terrain shader (shaders.js waterfall(): a water tile whose own surface
// is steep); this system finds those tiles around the camera and adds what the shader cannot: mist and spray rising
// from the foot (particles), droplets flung off the lip, and the roar (fx/audio.js reads game.waterfalls.near()).
// A fall tile = a water tile whose surface slopes ≥ FALL_S stories per tile (a river stepping down between two water
// levels, a lake spilling over an edge: the planet's `features` waterfalls are exactly these). Everything here derives
// from the world on each peer: nothing is synced.

const FALL_S = 0.5;   // steepest water surface that is still a river (stories per tile); above: a fall
const SCAN_T = 0.45;  // s between scans of the view
const MAX = 240;      // fall tiles kept (the nearest the camera)

export function installWaterfalls(game) {
  const W = {
    list: [],           // [{ x, y, fx, fy, s, dx, dy }] fall tiles in / around the view: centre, foot, slope, downhill
    t: 0, v: -1, cx: 1e9, cy: 1e9, acc: 0,
    // loudness 0..1 of the falls around (x, y) and their pan (−1 left .. 1 right, view units)
    near(x, y, R = 14) {
      let k = 0, pan = 0;
      const rc = Math.cos(game.cam.rot || 0), rs = Math.sin(game.cam.rot || 0);
      for (const f of this.list) {
        const dx = game.world.dx(f.fx, x), dy = f.fy - y, d = Math.hypot(dx, dy);
        if (d > R) continue;
        const q = (1 - d / R) ** 2 * Math.min(1.5, f.s);
        k += q; pan += Math.max(-1, Math.min(1, (rc * dx + rs * dy) / 8)) * q;
      }
      return { k: Math.min(1, k / 3), pan: k > 0 ? pan / k : 0 };
    },
    // the fall tiles inside a world rect (tests / debug)
    find(x0, y0, x1, y1) { return scan(game, x0, y0, x1, y1, []); },
    // the planet's own waterfall features (src/world/planet chunk.js `features`) in the loaded chunks within R of (x, y)
    features(x, y, R = 64) {
      const w = game.world, out = [];
      for (const c of w.live) for (const f of w.crec[c]?.features || []) if (f.t === 'waterfall' && Math.hypot(w.dx(f.x, x), f.y - y) <= R) out.push(f);
      return out;
    },
  };
  game.waterfalls = W;
  return W;
}

// the fall tiles in a rect (pushes to out)
function scan(game, x0, y0, x1, y1, out) {
  const w = game.world, L = w.height;
  if (!L.any) return out;
  const g = [0, 0];
  for (let ty = Math.max(0, y0 | 0); ty <= Math.min(w.H - 1, y1 | 0); ty++) for (let tx = x0 | 0; tx <= (x1 | 0); tx++) {
    if (!w.inBounds(tx, ty)) continue;
    const i = w.idx(tx, ty);
    if (!w.water.get(i) || w.rock.get(i)) continue;
    if (!w.isLoaded(w.chunkIndex(tx, ty))) continue;
    const s = L.tileSlope(tx, ty);
    if (s < FALL_S) continue;
    // downhill from the tile centre to the foot (where the water lies flat again: the pool)
    let x = tx + 0.5, y = ty + 0.5, dx = 0, dy = 0;
    L.gradAt(x, y, g);
    let gl = Math.hypot(g[0], g[1]);
    if (gl < 1e-3) continue;
    dx = -g[0] / gl; dy = -g[1] / gl;
    for (let k = 0; k < 10; k++) {
      L.gradAt(x, y, g); gl = Math.hypot(g[0], g[1]);
      if (gl < 0.3 && k > 0) break;
      if (gl > 1e-3) { x -= (g[0] / gl) * 0.25; y -= (g[1] / gl) * 0.25; }
    }
    out.push({ x: tx + 0.5, y: ty + 0.5, fx: x, fy: y, s, dx, dy });
  }
  return out;
}

export function waterfallSystem() {
  return {
    sync: 'cosmetic', // particles and sound around the local camera
    update(game, dt) {
      const W = game.waterfalls || installWaterfalls(game), w = game.world;
      if (!w.hasHeight) { W.list.length = 0; return; }
      const cam = game.cam;
      W.t -= dt;
      if (W.t <= 0 || W.v !== w.height.v && W.t < SCAN_T * 0.5) {
        W.t = SCAN_T; W.v = w.height.v;
        const v = game.view ? game.view() : { x0: cam.x - 16, x1: cam.x + 16, y0: cam.y - 10, y1: cam.y + 12 };
        const list = scan(game, v.x0 - 6, v.y0 - 6, v.x1 + 6, v.y1 + 10, []);
        if (list.length > MAX) { list.sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y)); list.length = MAX; }
        W.list = list;
      }
      emit(game, W, dt);
    },
  };
}

// mist rising from the foot, spray off the lip (only in view; frozen falls are still)
function emit(game, W, dt) {
  const P = game.particles, A = game.A;
  if (!P || !A || !W.list.length || game.world.frozen) return;
  const mist = A.has('fx_smoke') ? 'fx_smoke' : null, drop = A.has('fx_spark') ? 'fx_spark' : mist;
  if (!mist) return;
  const v = game.view?.(), K = 1 / Math.max(0.01, A.get(mist).w), Kd = 1 / Math.max(0.01, A.get(drop).w);
  const wind = game.env?.wind || { x: 0, y: 0 }, q = game.quality?.particles ?? 1;
  for (const f of W.list) {
    if (v && (f.fx < v.x0 - 1 || f.fx > v.x1 + 1 || f.fy < v.y0 - 2 || f.fy > v.y1 + 3)) continue;
    const s = Math.min(2.5, f.s);
    // a soft cloud of mist at the foot (a few per second per tile, more under a big drop)
    if (Math.random() < dt * (1.6 + s * 1.4) * q) {
      const a = Math.random() * 6.283, r = Math.random() * 0.5;
      P.emit({ spr: mist, x: f.fx + Math.cos(a) * r, y: f.fy + Math.sin(a) * r * 0.6, lift: 0.1 + Math.random() * 0.3, vlift: 0.25 + Math.random() * 0.35,
        vx: wind.x * 0.4 + (Math.random() - 0.5) * 0.25 + f.dx * 0.3, vy: wind.y * 0.25 + (Math.random() - 0.5) * 0.15 + f.dy * 0.3, drag: 0.6,
        life: 1.6 + Math.random() * 1.4, size: 0.5 * K, size1: (1.3 + Math.random() * 0.9 + s * 0.3) * K,
        r: 0.9, g: 0.95, b: 0.98, a: 0.2 + 0.08 * s, a1: 0, fadeIn: 0.25, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, ground: false });
    }
    // spray: droplets thrown up and out of the plunge, falling back
    if (Math.random() < dt * (2 + s * 2.5) * q) {
      P.emit({ spr: drop, x: f.fx + (Math.random() - 0.5) * 0.6, y: f.fy + (Math.random() - 0.5) * 0.4, lift: 0.15, vlift: 1.2 + Math.random() * 1.6, grav: 7,
        vx: f.dx * (0.5 + Math.random()) + (Math.random() - 0.5) * 0.8, vy: f.dy * (0.4 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.4,
        life: 0.5 + Math.random() * 0.35, size: (0.07 + Math.random() * 0.06) * Kd, size1: 0.04 * Kd, r: 0.86, g: 0.93, b: 1, a: 0.85, a1: 0.2 });
    }
  }
}
