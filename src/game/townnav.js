// Town navigation for the settlements' people (game/people.js, docs/REINOS.md "Fase 2 — moradores e guardas"): a tile A*
// over a settlement's plan box with cached paths between the places they go to, and their movement (axis sliding on the
// tile grid only: cheap — no scan of the objects of a chunk per step). They pass the doors and gates of their own town,
// closed or not (each peer swings the door open a moment as they go through: game/people.js, a cosmetic), never anything
// else that blocks. Host only (the people are host creatures).

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

// may a town person stand on tile (tx, ty)? (rock, deep water, cliffs, solid pieces and round props block; the doors /
// gates of a settlement do not; stair steps only through their entrance — never for them)
export function npcPass(game, tx, ty) {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  if (w.rock.get(i) === 1 || w.isCliff(tx, ty)) return false;
  if (w.water.get(i) === 2 && !w.iceAt(i) && !(w.deck && w.deck.get(i))) return false;
  if (game.occ && game.occ.get(i)) return false;
  const S0 = game.levels?.st[0];
  if (S0 && S0.get(i)) return false;
  if (w.solid.get(i) === 1) { const o = game.build.grid.main.get(i); return !!(o && o.door && o.town != null && !o.lv && !o.blueprint); }
  return true;
}
// is a body of radius r at (x, y) blocked for a town person?
export function npcBlocked(game, x, y, r, pass = npcPass) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (pass(game, tx, ty)) continue;
    const cx = Math.max(tx, Math.min(tx + 1, x)), cy = Math.max(ty, Math.min(ty + 1, y));
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return true;
  }
  return false;
}
// move a town person by (dx, dy) with axis sliding; true when it moved
export function npcMove(game, m, dx, dy, pass = npcPass) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
  const sx = dx / steps, sy = dy / steps, r = m.r * 0.85;
  let moved = false;
  for (let k = 0; k < steps; k++) {
    if (!npcBlocked(game, m.x + sx, m.y, r, pass)) { m.x += sx; moved = true; }
    if (!npcBlocked(game, m.x, m.y + sy, r, pass)) { m.y += sy; moved = true; }
  }
  return moved;
}
// the nearest tile a person can stand on around (x, y) (rings up to R), as its centre; null = none
export function nearPass(game, x, y, R = 3, pass = npcPass) {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (pass(game, cx, cy)) return [cx + 0.5, cy + 0.5];
  for (let r = 1; r <= R; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !pass(game, cx + dx, cy + dy)) continue;
      const d = (cx + dx + 0.5 - x) ** 2 + (cy + dy + 0.5 - y) ** 2;
      if (d < bd) { bd = d; best = [cx + dx + 0.5, cy + dy + 0.5]; }
    }
    if (best) return best;
  }
  return null;
}
// a straight walk between two points over passable tiles (DDA over the centre line; r > 0: also both edges of a body that
// wide — a doorway taken at a slant catches its shoulder on the door frame)
export function lineClear(game, x0, y0, x1, y1, r = 0, pass = npcPass) {
  if (r > 0) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, nx = (-dy / d) * r, ny = (dx / d) * r;
    return lineClear(game, x0, y0, x1, y1, 0, pass) && lineClear(game, x0 + nx, y0 + ny, x1 + nx, y1 + ny, 0, pass) && lineClear(game, x0 - nx, y0 - ny, x1 - nx, y1 - ny, 0, pass);
  }
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1), dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : 1e9, ddy = dy !== 0 ? Math.abs(1 / dy) : 1e9;
  let mx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * ddx : 1e9, my = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * ddy : 1e9;
  for (let n = 0; n < 80; n++) {
    if (tx === ex && ty === ey) return true;
    if (mx < my) { mx += ddx; tx += sx; } else { my += ddy; ty += sy; }
    if (!pass(game, tx, ty)) return false;
  }
  return true;
}

// ---------- A* over a settlement's box, with a path cache ----------
const MAX_NODES = 9000, CACHE_MAX = 500, CACHE_LIFE = 180; // (s of game time a cached path is trusted)
export class TownNav {
  constructor(game, L, pass = npcPass) {
    const G = L.grid;
    this.game = game; this.x0 = G.x0; this.y0 = G.y0; this.w = G.w; this.h = G.h;
    this.passFn = pass; // (who walks it: the town's people — npcPass — or the soldiers, game/soldier.js)
    const n = this.w * this.h;
    this.g = new Float32Array(n); this.par = new Int32Array(n); this.seen = new Int32Array(n); this.done = new Int32Array(n);
    this.pass = new Uint8Array(n); this.passV = -1; // (0 unknown, 1 open, 2 blocked: refilled lazily after build.v changes)
    this.stamp = 0; this.heapN = new Int32Array(1024); this.heapF = new Float32Array(1024); this.hn = 0;
    this.cache = new Map(); this.stats = { finds: 0, hits: 0, ms: 0, fails: 0, quick: 0, labels: 0, labelMs: 0 };
    this.comp = new Int32Array(n); this.compV = -1; this.compT = -9; this.job = null; this.failG = new Map(); // (goal tile → time it was found unreachable)
  }
  // connected regions of open tiles (labels: two tiles with different labels have no way between them — answered at
  // once instead of an A* that searches the whole box). Labelled in slices of a frame (tick, ~1.5 ms) after the structures
  // changed (at most every 5 s); until a new labelling is done the last one is used (double buffer)
  tick(budgetMs = 1.5) {
    const b = this.game.build.v, now = this.game.worldTime;
    let J = this.job;
    if (!J) {
      if (b === this.compV || (this.compV >= 0 && now - this.compT < 5)) return;
      J = this.job = { v: b, next: new Int32Array(this.w * this.h), s: 0, lab: 0, qh: 0, qt: 0, Q: new Int32Array(this.w * this.h) };
    }
    const t0 = performance.now(), W = this.w, H = this.h, n = W * H, C = J.next, Q = J.Q;
    let ops = 0;
    for (;;) {
      if (J.qh < J.qt) {
        const cur = Q[J.qh++], cx = cur % W, cy = (cur / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nn = ny * W + nx;
          if (C[nn] || !this._open(nn)) continue;
          C[nn] = J.lab; Q[J.qt++] = nn;
        }
      } else {
        while (J.s < n && (C[J.s] || !this._open(J.s))) J.s++;
        if (J.s >= n) break;
        J.lab++; C[J.s] = J.lab; J.qh = J.qt = 0; Q[J.qt++] = J.s;
      }
      if ((++ops & 255) === 0 && performance.now() - t0 > budgetMs) { this.stats.labelMs += performance.now() - t0; return; }
    }
    this.comp = C; this.compV = J.v; this.compT = now; this.job = null;
    this.failG.clear();
    this.stats.labels++; this.stats.labelMs += performance.now() - t0;
  }
  _label() { /* (labelled by tick: until the first one is done, every way is worth a search) */ }
  _open(n) {
    const b = this.game.build.v;
    if (b !== this.passV) { this.pass.fill(0); this.passV = b; }
    let v = this.pass[n];
    if (!v) { v = this.passFn(this.game, this.x0 + (n % this.w), this.y0 + ((n / this.w) | 0)) ? 1 : 2; this.pass[n] = v; }
    return v === 1;
  }
  _push(n, f) {
    if (this.hn >= this.heapN.length) { const a = new Int32Array(this.heapN.length * 2); a.set(this.heapN); this.heapN = a; const b = new Float32Array(this.heapF.length * 2); b.set(this.heapF); this.heapF = b; }
    const N = this.heapN, F = this.heapF;
    let i = this.hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; N[i] = N[p]; F[i] = F[p]; i = p; }
    N[i] = n; F[i] = f;
  }
  _pop() {
    const N = this.heapN, F = this.heapF, top = N[0], n = N[--this.hn], f = F[this.hn];
    let i = 0;
    for (;;) { let c = i * 2 + 1; if (c >= this.hn) break; if (c + 1 < this.hn && F[c + 1] < F[c]) c++; if (F[c] >= f) break; N[i] = N[c]; F[i] = F[c]; i = c; }
    N[i] = n; F[i] = f;
    return top;
  }
  inBox(tx, ty) { return tx >= this.x0 && ty >= this.y0 && tx < this.x0 + this.w && ty < this.y0 + this.h; }
  // is there a way between two points (same region of open tiles)?
  connected(ax, ay, bx, by) {
    const wl = this.game.world, mid = this.x0 + this.w / 2;
    const sx = Math.floor(wl.near(ax, mid)), sy = Math.floor(ay), gx = Math.floor(wl.near(bx, mid)), gy = Math.floor(by);
    if (!this.inBox(sx, sy) || !this.inBox(gx, gy)) return false;
    this._label();
    if (this.compV < 0) return true; // (not labelled yet: assume so)
    const a = this.comp[(sy - this.y0) * this.w + (sx - this.x0)], b = this.comp[(gy - this.y0) * this.w + (gx - this.x0)];
    if ((!a || !b) && this.compV !== this.game.build.v && this.passFn(this.game, sx, sy) && this.passFn(this.game, gx, gy)) return true; // (opened since the labelling: maybe)
    return !!a && a === b;
  }
  // a path of tile centres from (ax, ay) to (bx, by) (both ends snapped to open tiles), cached; null = no way
  path(ax, ay, bx, by) {
    const wl = this.game.world, mid = this.x0 + this.w / 2;
    ax = wl.near(ax, mid); bx = wl.near(bx, mid); // (a place by the planet's seam: one frame for both ends)
    let sx = Math.floor(ax), sy = Math.floor(ay), gx = Math.floor(bx), gy = Math.floor(by);
    if (!this.inBox(sx, sy) || !this.inBox(gx, gy)) return null;
    const key = (sy - this.y0) * this.w + (sx - this.x0) + ':' + ((gy - this.y0) * this.w + (gx - this.x0));
    const c = this.cache.get(key), now = this.game.worldTime;
    this.cost = 0; // (0: answered from the cache / the region labels; 1: an A* ran — the callers' frame budget)
    if (c && now - c.t < CACHE_LIFE && c.ok(this)) { this.stats.hits++; return c.p; }
    const t0 = performance.now();
    if (!this.passFn(this.game, sx, sy)) { const q = nearPass(this.game, ax, ay, 2, this.passFn); if (q) { sx = Math.floor(q[0]); sy = Math.floor(q[1]); } }
    if (!this.passFn(this.game, gx, gy)) { const q = nearPass(this.game, bx, by, 3, this.passFn); if (!q) return null; gx = Math.floor(q[0]); gy = Math.floor(q[1]); }
    // no way between the two regions (a house whose door is blocked inside, a pen without a gate…): at once
    this._label();
    const si = (sy - this.y0) * this.w + (sx - this.x0), gi = (gy - this.y0) * this.w + (gx - this.x0);
    const fresh = !this.comp[si] || !this.comp[gi] ? this.compV === this.game.build.v : true; // (an end opened since the labelling — a wall piece just destroyed —: search)
    if ((this.comp[si] !== this.comp[gi] && this.compV >= 0 && fresh) || (this.failG.get(gi) > now - 20)) { this.stats.quick++; this.stats.fails++; (this.lastFails || (this.lastFails = [])).push([sx, sy, gx, gy]); if (this.lastFails.length > 30) this.lastFails.shift(); return null; }
    this.cost = 1;
    const p = this._find(sx, sy, gx, gy);
    this.stats.finds++; this.stats.ms += performance.now() - t0;
    if (!p) { this.stats.fails++; this.failG.set(gi, now); return null; }
    if (this.cache.size > CACHE_MAX) this.cache.clear();
    const tiles = p.map(([x, y]) => [Math.floor(x), Math.floor(y)]);
    // (a cached path is trusted while its tiles stay open — checked on the cheap pass grid)
    this.cache.set(key, { t: now, p, ok: (nav) => tiles.every(([x, y]) => nav._open((y - nav.y0) * nav.w + (x - nav.x0))) });
    return p;
  }
  _find(sx, sy, gx, gy) {
    const W = this.w, s = (sy - this.y0) * W + (sx - this.x0), goal = (gy - this.y0) * W + (gx - this.x0);
    if (s === goal) return [[gx + 0.5, gy + 0.5]];
    const st = ++this.stamp, G = this.g, P = this.par, SE = this.seen, D = this.done;
    const h = (n) => { const dx = Math.abs((n % W) - (gx - this.x0)), dy = Math.abs(((n / W) | 0) - (gy - this.y0)); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
    this.hn = 0;
    G[s] = 0; P[s] = -1; SE[s] = st;
    this._push(s, h(s));
    let n = 0, found = false;
    while (this.hn > 0 && n < MAX_NODES) {
      const cur = this._pop();
      if (D[cur] === st) continue;
      D[cur] = st; n++;
      if (cur === goal) { found = true; break; }
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.h) continue;
        const nn = ny * W + nx;
        if (D[nn] === st || !this._open(nn)) continue;
        if (dx && dy && (!this._open(cy * W + nx) || !this._open(ny * W + cx))) continue; // (no corner cutting)
        const ng = G[cur] + cost;
        if (SE[nn] === st && ng >= G[nn]) continue;
        SE[nn] = st; G[nn] = ng; P[nn] = cur;
        this._push(nn, ng + h(nn) * 1.25); // (a little greedy: fewer tiles searched, a person's way need not be the shortest)
      }
    }
    if (!found) return null;
    const out = [];
    for (let k = goal; k !== s && k >= 0; k = P[k]) out.push([this.x0 + (k % W) + 0.5, this.y0 + ((k / W) | 0) + 0.5]);
    out.reverse();
    // keep the turning points (a straight run is one segment; the walker smooths further with lineClear)
    const simp = [];
    for (let i = 0; i < out.length; i++) {
      if (i > 0 && i < out.length - 1) {
        const a = out[i - 1], b = out[i], c = out[i + 1];
        if (b[0] - a[0] === c[0] - b[0] && b[1] - a[1] === c[1] - b[1]) continue;
      }
      simp.push(out[i]);
    }
    return simp;
  }
}
