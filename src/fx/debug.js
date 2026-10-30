// Localhost-only visual debug helpers (never installed on a deployed build): game.debug.*
//   setTime(h)            jump the clock (single player only)
//   skipTo(day, h)        jump to a day / hour through op env.skip (host; calendar: year of 7 days — 1 spring, 2-3 summer, 4 autumn, 5-7 winter)
//   setWeather(w, inst)   'clear'|'cloudy'|'rain'|'storm'|'fog'; inst (default true) skips the 14 s blend (single player)
//   snow(v)               snow cover 0..1 (cosmetic)
//   strike(dist)          lightning now (0 = overhead … 1 = far; cosmetic)
//   quality(mode)         'auto'|'low'|'medium'|'high' (persisted like the settings row)
//   feel(f)               force the status screen effects { hp, cold, hunger, wet, sick, warm } (null = real)
//   scene()               campfire, torches and a short wall next to the player (single player, through ops)
//   cave()                dig a tunnel + room into the nearest mountain, torch inside, stand there (single player)
//   bench(n)              render n frames synchronously: { gpuMs, renderCpuMs, updateCpuMs, … } (timer queries)
// Multiplayer: the clock and the weather belong to the host and are replicated, so the mutating helpers refuse
// to run unless the game is single player.

import { WEATHERS } from './environment.js';
import { setQualityMode, qualityState } from './quality.js';

const DEV = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);

export function installDebug(game) {
  if (!DEV || game.debug) return;
  const solo = () => {
    const ok = game.net?.role === 'solo' && !(game.session && game.session.state !== 'closed');
    if (!ok) console.warn('[debug] só em um jogador (o anfitrião é dono do relógio e do clima)');
    return ok;
  };
  const E = game.env;
  game.debug = {
    setTime(h) { if (!solo()) return false; E.hour = ((+h % 24) + 24) % 24; return E.clockString(); },
    // jump to a day / hour through the shared clock op (host: every peer follows); calendar: day 1 spring, 2-3 summer,
    // 4 autumn, 5-7 winter, then a new year (calendar.js / seasons.js)
    skipTo(day, h = 8) {
      if (!game.net?.auth) { console.warn('[debug] só o anfitrião'); return false; }
      const dl = E.dayLength || 720, dd = Math.max(1, day | 0) - E.dayIndex + (((+h % 24) + 24) % 24 - E.hour) / 24;
      game.net.emit('env.skip', { hour: ((+h % 24) + 24) % 24, day: Math.max(1, day | 0), wt: Math.round((game.worldTime + Math.max(0, dd) * dl) * 100) / 100, by: game.net.pid });
      return E.clockString();
    },
    setWeather(w, inst = true) {
      if (!solo() || !WEATHERS[w]) return false;
      E.setWeather(w);
      E.weatherT = 1e9;
      if (inst) { Object.assign(E.cur, WEATHERS[w]); E.wet = WEATHERS[w].rain > 0.2 ? 1 : 0; }
      return E.weather;
    },
    snow(v = 1) { E.snowCover = Math.max(0, Math.min(1, +v)); return E.snowCover; },
    strike(dist = 0.3) {
      E.strikes.push({ t: E.t, dist, a: 1.15 - dist * 0.7 });
      if (E.strikes.length > 6) E.strikes.shift();
      E.strikeId++;
      return E.strikeId;
    },
    quality(mode) { if (mode) setQualityMode(mode); return qualityState(); },
    // force the status screen effects: feel({ hp, cold, hunger, wet, sick, warm }) (0..1 each); feel() = real values
    feel(f = null) { if (game.statusFx) game.statusFx.force = f ? { hp: 0, cold: 0, hunger: 0, wet: 0, sick: 0, warm: 0, ...f } : null; return game.statusFx?.s; },
    scene() {
      if (!solo()) return false;
      const net = game.net, p = game.player, w = game.world;
      const spots = [['campfire', 2, 0], ['torch', -2, -1], ['torch', 3, 2], ['wall_wood', -3, 2], ['wall_wood', -2, 2], ['wall_wood', -1, 2]];
      const ids = [];
      for (const [type, dx, dy] of spots) {
        const tx = Math.floor(p.x) + dx, ty = Math.floor(p.y) + dy;
        if (w.blocked(tx, ty)) continue;
        const id = net.newId('s');
        net.emit('struct.add', { list: [[id, type, tx, ty, 0, 0, Math.round(game.worldTime)]], by: net.pid });
        net.emit('struct.complete', { id, by: net.pid, xp: 0, toast: '' });
        ids.push(id);
      }
      return ids;
    },
    // dig a tunnel + small room into the nearest roofed mountain rock, light it with a torch, stand inside
    cave() {
      if (!solo()) return false;
      const w = game.world, p = game.player, net = game.net, px = Math.floor(p.x), py = Math.floor(p.y);
      let tgt = null;
      for (let r = 2; r < 60 && !tgt; r++) {
        for (let dy = -r; dy <= r && !tgt; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = px + dx, ty = py + dy;
          if (!w.inBounds(tx, ty)) continue;
          const i = w.idx(tx, ty);
          let deep = w.rock[i] && w.roof[i];
          for (let k = -2; k <= 2 && deep; k++) for (let j = -2; j <= 2; j++) if (!w.isRock(tx + j, ty + k)) { deep = false; break; }
          if (deep) { tgt = [tx, ty]; break; }
        }
      }
      if (!tgt) return 'nenhuma montanha por perto';
      const mine = (tx, ty) => { if (w.inBounds(tx, ty) && w.rock[w.idx(tx, ty)]) net.emit('tile.mine', { tx, ty, drops: [], by: net.pid, xp: 0 }); };
      // tunnel from the target back towards the player until open ground
      let [cx, cy] = tgt;
      const L = Math.hypot(px - cx, py - cy), sx = (px - cx) / L, sy = (py - cy) / L;
      for (let s = 0; s < 60; s++) {
        const tx = Math.round(tgt[0] + sx * s), ty = Math.round(tgt[1] + sy * s);
        if (!w.isRock(tx, ty) && s > 2) break;
        mine(tx, ty); mine(tx + (Math.abs(sy) > Math.abs(sx) ? 1 : 0), ty + (Math.abs(sx) >= Math.abs(sy) ? 1 : 0));
      }
      for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) mine(cx + j, cy + k);
      const id = net.newId('s');
      net.emit('struct.add', { list: [[id, 'torch', cx - 1, cy - 1, 0, 0, Math.round(game.worldTime)]], by: net.pid });
      net.emit('struct.complete', { id, by: net.pid, xp: 0, toast: '' });
      p.x = cx + 0.5; p.y = cy + 0.9; game.cam.x = p.x; game.cam.y = p.y - 0.4;
      return [cx, cy];
    },
    // a finished room with a door and a roof next to the player (roofs, agent J): w × h outer size, roof type / style
    // opts: { dx, dy (offset from the player), fire: true (campfire inside), columns: [[x, y]...] (relative), noWalls }
    roofRoom(w = 6, h = 5, type = 'roof_stone', style = null, opts = {}) {
      if (!solo()) return false;
      const net = game.net, p = game.player;
      const x0 = Math.floor(p.x) + (opts.dx ?? 2), y0 = Math.floor(p.y) + (opts.dy ?? -Math.floor(h / 2));
      const put = (t, x, y, extra = []) => {
        const id = net.newId('s');
        net.emit('struct.add', { list: [[id, t, x, y, 0, 1, Math.round(game.worldTime), 0, 1, 0, ...extra]], by: net.pid });
        return id;
      };
      const wall = opts.wall || 'wall_wood';
      if (!opts.noWalls) {
        for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) {
          const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
          if (!edge) continue;
          const door = y === y0 + h - 1 && x === x0 + (w >> 1);
          if (game.world.blocked(x, y)) continue;
          put(door ? 'door_wood' : wall, x, y);
        }
      }
      for (const [cx, cy] of opts.columns || []) put(opts.column || 'column_wood', x0 + cx, y0 + cy);
      if (opts.fire) put('campfire', x0 + (w >> 1), y0 + 1);
      if (opts.torch !== false) put('torch', x0 + 1, y0 + 1);
      for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) put(type, x, y, [style || '', opts.det || '']);
      return [x0, y0, w, h];
    },
    // a big hall on columns: walls around, a column every `step` tiles inside
    hall(w = 15, h = 11, step = 5, type = 'roof_wood', style = null) {
      const cols = [];
      for (let x = step; x < w - 1; x += step) for (let y = step; y < h - 1; y += step) cols.push([x, y]);
      return this.roofRoom(w, h, type, style, { columns: cols, column: 'column_stone', wall: 'wall_stone', fire: true });
    },
    // mine a box of w × h tiles out of the nearest big mountain (stand inside it): watch the ceiling go
    openCave(w = 14, h = 14) {
      if (!solo()) return false;
      const t = this.cave();
      if (!Array.isArray(t)) return t;
      const [cx, cy] = t, wld = game.world;
      for (let y = cy - (h >> 1); y < cy + (h >> 1); y++) for (let x = cx - (w >> 1); x < cx + (w >> 1); x++) {
        if (wld.inBounds(x, y) && wld.rock[wld.idx(x, y)]) game.net.emit('tile.mine', { tx: x, ty: y, drops: [], by: game.net.pid, xp: 0 });
      }
      return [cx, cy, w, h];
    },
    async bench(n = 120) {
      const R = game.R, gl = R.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const qs = [], rend = [], upd = [];
      for (let i = 0; i < n; i++) {
        let t0 = performance.now(); game.update(1 / 60); upd.push(performance.now() - t0);
        let q = null;
        if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
        t0 = performance.now(); game.render(); rend.push(performance.now() - t0);
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      gl.finish();
      await new Promise((r) => setTimeout(r, 200));
      const gpu = [];
      for (const q of qs) { if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
      const med = (a) => { const s = a.slice(10).sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(3) : null; };
      return { gpuMs: med(gpu), renderCpuMs: med(rend), updateCpuMs: med(upd), px: `${R.w}x${R.h}`, dpr: +R.dpr.toFixed(2), level: R.level, sprites: R.stats.sprites, particles: game.particles.list.length, ...qualityState() };
    },
  };
}
