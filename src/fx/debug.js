// Localhost-only visual debug helpers (never installed on a deployed build): game.debug.*
//   setTime(h)            jump the clock (single player only)
//   setWeather(w, inst)   'clear'|'cloudy'|'rain'|'storm'|'fog'; inst (default true) skips the 14 s blend (single player)
//   snow(v)               snow cover 0..1 (cosmetic)
//   strike(dist)          lightning now (0 = overhead … 1 = far; cosmetic)
//   quality(mode)         'auto'|'low'|'medium'|'high' (persisted like the settings row)
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
