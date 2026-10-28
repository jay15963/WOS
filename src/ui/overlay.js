// 2D overlay canvas (#overlay): creature nameplates + HP bars, WoW-style floating combat text,
// interaction progress bar. Redrawn every frame from simulation state + combat events.

import { SPECIES, TEMPER_COLOR } from '../game/data.js';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

export function installOverlay(game) {
  const cv = document.getElementById('overlay');
  const ctx = cv.getContext('2d');
  const fct = []; // floating combat texts
  const headH = {};
  let W = 0, H = 0, dpr = 1;

  const spriteTop = (e) => {
    let h = headH[e.species];
    if (h == null) {
      const A = game.A;
      const name = A.has(e.species + '_e') ? e.species + '_e' : A.has('wolf_e') ? 'wolf_e' : null;
      h = headH[e.species] = name ? A.get(name).h * A.get(name).ay : 0.8;
    }
    return h * (e.scale || 1);
  };

  const add = (e, text, color, opts = {}) => {
    const p = game.player;
    const self = e === p;
    // stagger texts spawned on the same target in quick succession
    let n = 0;
    for (const f of fct) if (f.e === e && f.t < 0.25) n++;
    fct.push({
      e, x: e.x, y: e.y, text, color, t: 0, life: opts.life || (opts.big ? 1.25 : 1.05),
      size: opts.size || 15, big: !!opts.big, ox: (self ? -1 : 1) * (8 + n * 12) + (Math.random() - 0.5) * 10,
      vy: opts.vy || 46, drift: (Math.random() - 0.5) * 18 + (self ? -10 : 10), head: opts.head ?? true,
    });
    if (fct.length > 60) fct.shift();
  };

  const ev = game.events;
  ev.on('damage', (d) => {
    const p = game.player, e = d.target;
    if (!e) return;
    const self = e === p;
    switch (d.kind) {
      case 'hit':
        if (self) add(e, `-${d.amount}`, '#ff4a3a', { size: d.crit ? 18 : 14, big: d.crit });
        else if (d.src === p) add(e, d.crit ? `${d.amount}!` : `${d.amount}`, d.crit ? '#ffe14a' : d.ability ? '#ffffff' : '#f2f2f2', { size: d.crit ? 24 : d.ability ? 18 : 15, big: d.crit });
        break;
      case 'heal': add(e, `+${d.amount}`, '#6dff6d', { size: 14 }); break;
      case 'miss': add(e, 'Errou', '#bdbdbd', { size: 13 }); break;
      case 'dodge': add(e, self ? 'Esquiva' : 'Esquivou', '#e6e6e6', { size: 13 }); break;
      case 'immune': add(e, 'Evadiu', '#bdbdbd', { size: 13 }); break;
      case 'stun': add(e, 'Atordoado!', '#ffd84a', { size: 14, life: 1.2 }); break;
    }
  });
  ev.on('xp', (d) => add(game.player, `+${d.amount} XP`, '#c79bff', { size: 13, life: 1.5, vy: 30 }));

  const resize = () => {
    dpr = game.R.dpr || 1;
    W = game.R.cssW || innerWidth; H = game.R.cssH || innerHeight;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  };

  const bar = (x, y, w, h, k, col, back = 'rgba(0,0,0,0.65)') => {
    ctx.fillStyle = back;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, Math.max(0, w * k), h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y, Math.max(0, w * k), Math.max(1, h * 0.4));
  };

  return {
    update(g, dt) {
      for (let i = fct.length - 1; i >= 0; i--) {
        const f = fct[i];
        f.t += dt;
        if (!f.e.dead || f.e.kind !== 'animal') { f.x = f.e.x; f.y = f.e.y; }
        if (f.t >= f.life) fct.splice(i, 1);
      }
    },
    render(g) {
      resize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const p = g.player, z = g.cam.zoom;
      const small = Math.min(W, H) < 500;
      const fs = small ? 11 : 12;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';

      // nameplates
      ctx.font = `600 ${fs}px ${FONT}`;
      const v = g.view();
      const plates = [];
      for (const e of g.entities) {
        if (e.kind !== 'animal' || e.dead) continue;
        if (e.x < v.x0 - 1 || e.x > v.x1 + 1 || e.y < v.y0 - 1 || e.y > v.y1 + 2.5) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        const isT = e === p.target;
        const fighting = e.state === 'chase' && e.threat === p;
        if (!isT && !fighting && d > 12) continue;
        const a = isT || fighting ? 1 : Math.max(0, Math.min(1, (12 - d) / 4));
        if (a <= 0.02) continue;
        plates.push({ e, d: isT ? -1 : fighting ? d - 20 : d, a, isT, fighting });
      }
      // declutter: closest / most relevant first, later plates nudge upward when overlapping
      plates.sort((a, b) => a.d - b.d);
      const placed = [];
      const bh = small ? 4 : 5;
      const bw = Math.max(36, Math.min(60, z * 1.2));
      for (const pl of plates) {
        const e = pl.e;
        const temper = SPECIES[e.species].temper;
        const col = TEMPER_COLOR[temper];
        const showBar = pl.isT || pl.fighting || e.hp < e.maxHp;
        const label = `${e.name}${e.elite ? ' ★' : ''}  ${e.level}`;
        const tw = ctx.measureText(label).width;
        const [sx, sy0] = g.worldToScreen(e.x, e.y - spriteTop(e));
        let sy = sy0 - 6;
        const hgt = fs + 3 + (showBar ? bh + 4 : 0);
        const wdt = Math.max(tw, showBar ? bw : 0) + 4;
        for (let k = 0; k < 4; k++) {
          const hit = placed.find((r) => Math.abs(r.x - sx) < (r.w + wdt) / 2 && sy > r.y - r.h + 1 && sy - hgt < r.y - 1);
          if (!hit) break;
          sy = hit.y - hit.h - 1;
        }
        placed.push({ x: sx, y: sy, w: wdt, h: hgt });
        ctx.globalAlpha = pl.a;
        if (showBar) {
          bar(sx - bw / 2, sy - bh, bw, bh, e.hp / e.maxHp, temper === 'hostile' ? '#d8402f' : temper === 'neutral' ? '#d8b02f' : '#5fb84a');
          sy -= bh + 4;
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(label, sx, sy);
        ctx.fillStyle = pl.isT ? '#ffffff' : col;
        ctx.fillText(label, sx, sy);
        if (pl.isT) {
          ctx.fillStyle = col;
          ctx.fillRect(sx - tw / 2, sy + 2, tw, 1.5);
        }
        if (e.stunT > 0) {
          ctx.font = `600 ${fs - 1}px ${FONT}`;
          ctx.strokeText('atordoado', sx, sy - fs - 1);
          ctx.fillStyle = '#ffd84a';
          ctx.fillText('atordoado', sx, sy - fs - 1);
          ctx.font = `600 ${fs}px ${FONT}`;
        }
      }
      ctx.globalAlpha = 1;

      // progress bar (gathering / cooking)
      const wk = p.work;
      if (wk && !p.dead) {
        const [sx, sy] = g.worldToScreen(p.x, p.y - 1.55);
        const bw = small ? 64 : 78, bh = small ? 6 : 7;
        ctx.fillStyle = 'rgba(14,15,16,0.82)';
        ctx.fillRect(sx - bw / 2 - 3, sy - bh - 15, bw + 6, bh + 19);
        ctx.strokeStyle = 'rgba(200,195,180,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - bw / 2 - 2.5, sy - bh - 14.5, bw + 5, bh + 18);
        bar(sx - bw / 2, sy - bh, bw, bh, wk.k, '#d9b45a', 'rgba(0,0,0,0.5)');
        ctx.font = `600 ${small ? 10 : 11}px ${FONT}`;
        ctx.fillStyle = '#e6e2d8';
        ctx.fillText(wk.label, sx, sy - bh - 4);
      }

      // floating combat text
      for (const f of fct) {
        const k = f.t / f.life;
        const [sx0, sy0] = g.worldToScreen(f.x, f.y - (f.e.kind === 'animal' ? spriteTop(f.e) : 1.25));
        const rise = f.vy * f.t + (f.big ? 10 * Math.min(1, f.t * 8) : 0);
        const sx = sx0 + f.ox + f.drift * k;
        const sy = sy0 - 14 - rise;
        let scale = 1;
        if (f.big) scale = f.t < 0.12 ? 1 + (f.t / 0.12) * 0.7 : 1.7 - Math.min(0.5, (f.t - 0.12) * 2.2);
        const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        ctx.globalAlpha = Math.max(0, a);
        ctx.font = `800 ${Math.round(f.size * scale)}px ${FONT}`;
        ctx.lineWidth = f.big ? 4 : 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(f.text, sx, sy);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, sx, sy);
      }
      ctx.globalAlpha = 1;
    },
  };
}
