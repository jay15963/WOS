// Chunk streamer (docs/STREAMING.md "Regiões ativas"): decides which chunks of a wrapping world are loaded, generated
// (Web Workers, off the main thread) and evicted, and which are ACTIVE (simulated by the host).
//
// Anchors (each tick, from streamerSystem): every player the host simulates (local + remote avatars; a guest: itself)
// and the local camera. Around each anchor:
//   R_ACT   chunks (Chebyshev) are active: creatures, spawners, regrowth, farms run there (activeAt / isActive)
//   R_LOAD  chunks are loaded (+ the terrain window asks for the chunks around the camera: want)
//   R_KEEP  chunks stay loaded; farther ones are evicted (never a changed chunk: world.markDirty), the oldest first,
//           and decor (cosmetic ground plants) is dropped beyond R_DECOR of the camera
// The chunks a player stands in and the 8 around it are made synchronously if the workers are late (never walk into
// an unloaded chunk: an unloaded tile reads as rock). A bounded world (classic) needs no streamer: it is all loaded.

import { CW, CH, CS, NCH, chunkKey } from './store.js';
import { markExplored } from '../game/explore.js';

export const R_ACT = 2, R_LOAD = 3, R_KEEP = 5, R_DECOR = 3;
const MAX_INFLIGHT = 6;

export class Streamer {
  constructor(world, { workers = defaultWorkers() } = {}) {
    this.w = world;
    world.streamer = this;
    this.queue = new Map();      // chunk → priority (lower first)
    this.decorQ = new Set();     // loaded chunks near the camera that need their decor (made in a worker)
    this.inflight = new Map();   // job id → { c, t }
    this.jobOf = new Map();      // chunk → job id
    this.active = new Uint8Array(NCH);
    this.activeList = [];
    this.anchors = [];
    this.stats = { gen: 0, genMs: 0, genWall: 0, evicted: 0, rate: 0, sync: 0, decorDrop: 0 };
    this._rateT = 0; this._rateN = 0;
    this.pool = [];
    this.nextId = 1;
    const src = world.source;
    if (src.worker && typeof Worker !== 'undefined' && workers > 0) {
      for (let k = 0; k < workers; k++) {
        try {
          const wk = new Worker(src.worker.url, { type: 'module' });
          wk.postMessage({ init: src.worker.init });
          wk.onmessage = (e) => this._done(wk, e.data);
          wk.onerror = (e) => { console.warn('[streamer] worker', e.message); wk.dead = true; };
          wk.busy = 0;
          this.pool.push(wk);
        } catch (e) { console.warn('[streamer] no worker', e); }
      }
    }
    world.onLoad.push((c) => { this.queue.delete(c); });
  }

  // chunk distance (Chebyshev, x across the seam) from an anchor to chunk c
  static dist(ax, ay, c) {
    const cx = c & (CW - 1), cy = c >>> 8, acx = Math.floor(ax / CS), acy = Math.floor(ay / CS);
    let dx = Math.abs(cx - (((acx % CW) + CW) % CW));
    if (dx > CW / 2) dx = CW - dx;
    return Math.max(dx, Math.abs(cy - acy));
  }

  // anchors: [{ x, y, player: bool }] — players get R_LOAD + active R_ACT; the camera R_LOAD (rendering)
  update(anchors, dt = 0.016) {
    this.anchors = anchors;
    const w = this.w;
    // active set
    const act = this.active;
    for (const c of this.activeList) act[c] = 0;
    this.activeList.length = 0;
    for (const a of anchors) {
      if (!a.player) continue;
      const acx = Math.floor(a.x / CS), acy = Math.floor(a.y / CS);
      for (let dy = -R_ACT; dy <= R_ACT; dy++) for (let dx = -R_ACT; dx <= R_ACT; dx++) {
        const cy = acy + dy;
        if (cy < 0 || cy >= CH) continue;
        const c = chunkKey(acx + dx, cy);
        if (!act[c]) { act[c] = 1; this.activeList.push(c); }
      }
    }
    // wanted chunks: around every anchor; the 3 × 3 under each player synchronously
    for (const a of anchors) {
      const acx = Math.floor(a.x / CS), acy = Math.floor(a.y / CS), R = R_LOAD;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const cy = acy + dy;
        if (cy < 0 || cy >= CH) continue;
        const c = chunkKey(acx + dx, cy);
        if (w.isLoaded(c)) continue;
        this.want(c, Math.max(Math.abs(dx), Math.abs(dy)));
      }
      // late workers: the player's own chunk, and a neighbour it comes within 10 tiles of, must exist now
      if (a.player) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cy = acy + dy;
        if (cy < 0 || cy >= CH) continue;
        const c = chunkKey(acx + dx, cy);
        if (w.isLoaded(c)) continue;
        // (distance from the player to that chunk's tiles)
        const ex = dx < 0 ? a.x - acx * CS : dx > 0 ? (acx + 1) * CS - a.x : 0, ey = dy < 0 ? a.y - acy * CS : dy > 0 ? (acy + 1) * CS - a.y : 0;
        if (Math.max(ex, ey) < 10) this._sync(c);
      }
    }
    this._dispatch();
    this._evict();
    // generation rate (chunks / s) for the HUD
    this._rateT += dt;
    if (this._rateT >= 1) { this.stats.rate = this._rateN / this._rateT; this._rateT = 0; this._rateN = 0; }
  }

  // ask for a chunk (priority: chunk distance)
  want(c, d = 9) {
    if (this.w.isLoaded(c) || c < 0 || c >= NCH) return;
    const p = this.queue.get(c);
    if (p == null || d < p) this.queue.set(c, d);
  }

  isActive(c) { return !!this.active[c]; }
  activeAt(x, y) { const ty = Math.floor(y); if (ty < 0 || ty >= CH * CS) return false; return !!this.active[chunkKey(Math.floor(x / CS), Math.floor(ty / CS))]; }

  _sync(c) {
    if (this.w.isLoaded(c)) return;
    this.w.ensure(c);
    this.stats.sync++;
    this.queue.delete(c);
  }

  _dispatch() {
    if (!this.queue.size) return;
    const idle = this.pool.filter((k) => !k.dead && k.busy < 2);
    if (!idle.length) {
      // no workers (or all dead): a few on the main thread, nearest first, within ~4 ms
      if (this.pool.length && !this.pool.every((k) => k.dead)) return;
      const t0 = performance.now();
      for (const [c] of [...this.queue].sort((a, b) => a[1] - b[1])) { if (performance.now() - t0 > 4) break; this._sync(c); }
      return;
    }
    const list = [...this.queue].filter(([c]) => !this.jobOf.has(c)).sort((a, b) => a[1] - b[1]);
    for (const c of this.decorQ) if (!this.jobOf.has(c)) list.push([c, R_DECOR, true]);
    for (const [c, d, dec] of list) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      const wk = idle.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (wk.busy >= 2) break;
      const id = this.nextId++;
      wk.busy++;
      this.inflight.set(id, { c, t: performance.now(), wk });
      this.jobOf.set(c, id);
      wk.postMessage({ id, cx: c & (CW - 1), cy: c >>> 8, decor: dec || d <= R_DECOR });
      if (dec) this.decorQ.delete(c);
    }
  }

  _done(wk, msg) {
    wk.busy = Math.max(0, wk.busy - 1);
    const job = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    if (!job) return;
    this.jobOf.delete(job.c);
    if (msg.error) { console.warn('[streamer] chunk', job.c, msg.error); wk.dead = true; return; }
    this.stats.gen++; this._rateN++;
    this.stats.genMs += msg.ms || 0; this.stats.genWall += performance.now() - job.t;
    this.w.stats.genAsync++;
    const t0 = performance.now();
    if (!this.w.isLoaded(job.c)) this.w.install(job.c, msg.d);
    else if (msg.d.decor) this.w.addDecor(job.c, msg.d.decor); // (a decor request for a loaded chunk)
    const ms = performance.now() - t0; // (main-thread cost of a worker result: install + the hooks)
    this.stats.doneMax = Math.max(this.stats.doneMax || 0, ms); this.stats.doneMs = (this.stats.doneMs || 0) + ms;
    this.queue.delete(job.c);
  }

  // drop chunks far from every anchor (unchanged ones only), decor far from the camera
  _evict() {
    const w = this.w, A = this.anchors;
    if (!A.length) return;
    let n = 0;
    for (const c of w.live) {
      if (n >= 16) break;
      const r = w.crec[c];
      if (!r || !r.ready) continue;
      let d = 1e9;
      for (const a of A) d = Math.min(d, Streamer.dist(a.x, a.y, c));
      if (d > R_KEEP && !r.dirty && !r.pin) { if (w.evict(c)) { n++; this.stats.evicted++; } continue; }
      // decor: only near the camera (the first anchor without `player` is the camera, else the first)
      if (r.decor) {
        const cam = A.find((a) => a.cam) || A[0];
        if (Streamer.dist(cam.x, cam.y, c) > R_DECOR + 1) { w.dropDecor(c); this.stats.decorDrop++; }
      } else {
        const cam = A.find((a) => a.cam) || A[0];
        if (Streamer.dist(cam.x, cam.y, c) <= R_DECOR) {
          if (this.pool.some((k) => !k.dead)) this.decorQ.add(c);
          else if (w.source.decor) w.addDecor(c, w.source.decor(c & (CW - 1), c >>> 8));
        }
      }
    }
  }

  dispose() { for (const wk of this.pool) wk.terminate(); this.pool.length = 0; }
}

function defaultWorkers() {
  const n = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(3, n - 2));
}

// ---------- the system that feeds the streamer (every peer: each loads what it needs) + the dev HUD ----------
// anchors: the host simulates around every player (its own + the remote avatars), a guest around itself; both around
// their camera (rendering). The HUD (localhost on a planet, or ?stream=1): chunks loaded / active / generated per second,
// the queue, memory (tile layers, objects, GPU window, JS heap), the terrain window's work.
export function streamerSystem(allPlayers) {
  let hudT = 0, el = null, expT = 0;
  const A = [];
  return {
    sync: 'all', // local loading decisions (what is loaded never changes shared state: chunks are pure functions)
    update(game, dt) {
      const w = game.world, S = w.streamer;
      // the map's fog of war: chunks the local player has seen (game/explore.js, saved with the player)
      if ((expT -= dt) <= 0) { expT = 1; markExplored(game); }
      game.streamStats ||= () => streamStats(game); // (dev / benchmarks: tools/headless, game.debug)
      if (S) {
        A.length = 0;
        const L = game.net.role === 'guest' ? [game.player] : allPlayers(game);
        for (const p of L) A.push({ x: p.x, y: p.y, player: true });
        if (game._extraAnchors) for (const p of game._extraAnchors) A.push({ x: p.x, y: p.y, player: true }); // (benchmarks: players far apart)
        A.push({ x: game.cam.x, y: game.cam.y, cam: true });
        S.update(A, dt);
      }
      if (typeof document === 'undefined' || game.headless) return;
      hudT -= dt;
      if (hudT > 0) return;
      hudT = 0.5;
      const want = /[?&]stream=1/.test(location.search) || (w.wrap && /^(localhost|127\.)/.test(location.hostname));
      if (!want) { if (el) { el.remove(); el = null; } return; }
      if (!el) {
        el = document.createElement('div');
        el.id = 'stream-hud';
        el.style.cssText = 'position:fixed;left:6px;bottom:22px;z-index:50;font:11px/1.35 monospace;color:#f6ead0;background:rgba(20,12,6,0.72);padding:4px 7px;border-radius:4px;pointer-events:none;white-space:pre';
        document.body.appendChild(el);
      }
      el.textContent = streamStats(game).text;
    },
  };
}

// numbers for the HUD / benchmarks (game.debug.stream)
export function streamStats(game) {
  const w = game.world, S = w.streamer, win = game.R?.win;
  let objs = 0, decor = 0;
  for (const b of w.buckets()) { objs += b.objects.length; decor += b.decor.length; }
  const tiles = w.memBytes(), heap = typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : 0;
  const st = S?.stats || {}, ws = win?.stats || {};
  const o = {
    loaded: w.loaded, active: S ? S.activeList.length : w.loaded, queue: S ? S.queue.size : 0, inflight: S ? S.inflight.size : 0,
    genPerS: +(st.rate || 0).toFixed(1), gen: st.gen || 0, sync: (st.sync || 0), evicted: w.stats.evicted,
    genMsAvg: st.gen ? +(st.genMs / st.gen).toFixed(1) : +(w.stats.genSync ? w.stats.genMs / w.stats.genSync : 0).toFixed(1),
    tilesMB: +(tiles / 1048576).toFixed(1), objects: objs, decor, gpuMB: win ? +(win.bytes() / 1048576).toFixed(1) : 0,
    heapMB: heap ? +(heap / 1048576).toFixed(1) : null, winPend: ws.pend || 0, winAsync: ws.async || 0, winSync: ws.sync || 0,
    x: +game.player.x.toFixed(1), y: +game.player.y.toFixed(1),
  };
  o.text = `chunks ${o.loaded} · ativos ${o.active} · fila ${o.queue}+${o.inflight} · gerados ${o.gen} (${o.genPerS}/s, ${o.genMsAvg} ms) · síncronos ${o.sync} · descartados ${o.evicted}\n`
    + `memória: tiles ${o.tilesMB} MB · objetos ${o.objects} · decor ${o.decor} · GPU janela ${o.gpuMB} MB${o.heapMB != null ? ' · heap JS ' + o.heapMB + ' MB' : ''}\n`
    + `janela: pendentes ${o.winPend} · worker ${o.winAsync} · direto ${o.winSync} · jogador ${o.x}, ${o.y}`;
  return o;
}
