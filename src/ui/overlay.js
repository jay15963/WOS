// 2D overlay canvas (#overlay): nameplates + HP bars (animals, raiders, targeted crates), enemy cast bars,
// status tags, WoW-style floating combat text (damage types: bleed / poison / fire, blocks, interrupts),
// interaction progress bar. Redrawn every frame from simulation state + combat events.

import { SPECIES, TEMPER_COLOR } from '../game/data.js';
import { liftOf } from '../game/levels.js';
import { DEV } from '../game/artcompat.js';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
// floating text colors per damage type (dealt by the player / taken by the player)
const DT_OUT = { phys: '#f2f2f2', bleed: '#e05ab4', poison: '#8fe04a', fire: '#ffa03a' };
const DT_IN = { phys: '#ff4a3a', bleed: '#e05ab4', poison: '#8fe04a', fire: '#ff8a3a' };
const PAWN_H = 1.62;

export function installOverlay(game) {
  const cv = document.getElementById('overlay');
  const ctx = cv.getContext('2d');
  const fct = []; // floating combat texts
  const headH = {};
  let W = 0, H = 0, dpr = 1;

  const spriteTop = (e) => {
    if (e.kind === 'pawn') return PAWN_H * (e.scale || 1);
    if (e.isProp) return 0.85;
    const key = e.species;
    let h = headH[key];
    if (h == null) {
      const A = game.A;
      const name = A.has(key + '_e') ? key + '_e' : A.has('wolf_e') ? 'wolf_e' : null;
      h = headH[key] = name ? A.get(name).h * A.get(name).ay : 0.8;
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
    const dt = d.dtype || 'phys';
    switch (d.kind) {
      case 'hit':
        if (d.blocked) add(e, self ? `Bloqueado! -${d.amount}` : `Bloqueado ${d.amount}`, '#8fd0ff', { size: self ? 14 : 13 });
        else if (self) add(e, `-${d.amount}`, DT_IN[dt] || DT_IN.phys, { size: d.dot ? 12 : d.crit ? 18 : 14, big: d.crit });
        else if (d.src === p || d.dot) {
          const col = d.crit ? '#ffe14a' : dt !== 'phys' ? DT_OUT[dt] : d.ability ? '#ffffff' : DT_OUT.phys;
          add(e, d.crit ? `${d.amount}!` : `${d.amount}`, col, { size: d.dot ? 13 : d.crit ? 24 : d.ability ? 18 : 15, big: d.crit });
        }
        break;
      case 'heal': add(e, `+${d.amount}`, '#6dff6d', { size: 14 }); break;
      case 'miss': add(e, 'Errou', '#bdbdbd', { size: 13 }); break;
      case 'dodge': add(e, self ? 'Esquiva' : 'Esquivou', '#e6e6e6', { size: 13 }); break;
      case 'immune': add(e, 'Evadiu', '#bdbdbd', { size: 13 }); break;
      case 'stun': add(e, 'Atordoado!', '#ffd84a', { size: 14, life: 1.2 }); break;
      case 'interrupt': add(e, 'Interrompido!', '#ffd84a', { size: 14, life: 1.2 }); break;
      case 'status': add(e, d.text || '', DT_OUT[dt] || '#ffd84a', { size: 13, life: 1.2 }); break;
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
  const plates = [], placed = [];

  return {
    sync: 'cosmetic', // floating text, nameplates
    update(g, dt) {
      for (let i = fct.length - 1; i >= 0; i--) {
        const f = fct[i];
        f.t += dt;
        if (!f.e.dead || f.e.kind !== 'animal') { f.x = f.e.x; f.y = f.e.y - liftOf(f.e); } // levels: up a story
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
      plates.length = 0;
      for (const e of g.entities) {
        if (!(e.isMob || e.kind === 'animal') || e.dead) continue;
        if (e.x < v.x0 - 1 || e.x > v.x1 + 1 || e.y < v.y0 - 1 || e.y > v.y1 + 2.5) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        const isT = e === p.target;
        const fighting = e.state === 'chase' && e.threat === p;
        if (!isT && !fighting && d > 12) continue;
        const a = isT || fighting ? 1 : Math.max(0, Math.min(1, (12 - d) / 4));
        if (a <= 0.02) continue;
        plates.push({ e, d: isT ? -1 : fighting ? d - 20 : d, a, isT, fighting });
      }
      const tp = p.target;
      if (tp && tp.isProp && !tp.broken) plates.push({ e: tp, d: -1, a: 1, isT: true, fighting: false });
      // declutter: closest / most relevant first, later plates nudge upward when overlapping
      plates.sort((a, b) => a.d - b.d);
      placed.length = 0;
      const bh = small ? 4 : 5;
      const bw = Math.max(36, Math.min(60, z * 1.2));
      for (const pl of plates) {
        const e = pl.e;
        const temper = e.temper || SPECIES[e.species]?.temper || 'neutral';
        const bandit = e.faction === 'bandit';
        const col = bandit ? '#ff5a48' : TEMPER_COLOR[temper];
        const showBar = pl.isT || pl.fighting || e.hp < e.maxHp;
        const label = (e.isProp ? e.name : `${e.elite ? '★ ' : ''}${e.name}  ${e.level}`) + (DEV && e._artFallback ? ' ⚠ ARTE' : ''); // dev: drawn with another sprite
        const tw = ctx.measureText(label).width;
        const [sx, sy0] = g.worldToScreen(e.x, e.y - spriteTop(e) - liftOf(e)); // levels: lifted plate
        let sy = sy0 - 6;
        const cast = e.cast && e.cast.dur ? e.cast : null;
        const hgt = fs + 3 + (showBar ? bh + 4 : 0) + (cast ? 13 : 0);
        const wdt = Math.max(tw, showBar ? bw : 0, cast ? bw + 10 : 0) + 4;
        for (let k = 0; k < 4; k++) {
          const hit = placed.find((r) => Math.abs(r.x - sx) < (r.w + wdt) / 2 && sy > r.y - r.h + 1 && sy - hgt < r.y - 1);
          if (!hit) break;
          sy = hit.y - hit.h - 1;
        }
        placed.push({ x: sx, y: sy, w: wdt, h: hgt });
        ctx.globalAlpha = pl.a;
        // enemy cast bar (below the HP bar): interruptible telegraphs
        if (cast) {
          const cw = bw + 10, ch = small ? 7 : 8;
          const k = Math.min(1, cast.t / cast.dur);
          bar(sx - cw / 2, sy - ch, cw, ch, k, '#e0b040', 'rgba(0,0,0,0.75)');
          ctx.font = `700 ${small ? 8.5 : 9}px ${FONT}`;
          ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
          ctx.strokeText(cast.name, sx, sy - 1);
          ctx.fillStyle = '#fff4d8';
          ctx.fillText(cast.name, sx, sy - 1);
          ctx.font = `600 ${fs}px ${FONT}`;
          sy -= ch + 5;
        }
        if (showBar) {
          const hb = e.isProp ? '#c8a060' : bandit || temper === 'hostile' ? '#d8402f' : temper === 'neutral' ? '#d8b02f' : '#5fb84a';
          bar(sx - bw / 2, sy - bh, bw, bh, e.hp / e.maxHp, hb);
          if (e.dots?.length) {
            // little debuff pips on the bar
            let px = sx + bw / 2 + 3;
            for (const dd of e.dots) {
              ctx.fillStyle = dd.id === 'poison' ? '#8fe04a' : dd.id === 'burn' ? '#ffa03a' : '#e05ab4';
              ctx.fillRect(px, sy - bh, 3, bh);
              px += 4;
            }
          }
          sy -= bh + 4;
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(label, sx, sy);
        ctx.fillStyle = pl.isT ? '#ffffff' : e.elite && bandit ? '#ffb070' : col;
        ctx.fillText(label, sx, sy);
        if (pl.isT) {
          ctx.fillStyle = col;
          ctx.fillRect(sx - tw / 2, sy + 2, tw, 1.5);
        }
        const tag = e.stunT > 0 ? ['atordoado', '#ffd84a'] : e.fearT > 0 ? ['assustado', '#ffa03a'] : e.blocking ? ['bloqueando', '#8fd0ff'] : e.enraged ? ['enfurecido', '#ff6a4a'] : null;
        if (tag) {
          ctx.font = `600 ${fs - 1}px ${FONT}`;
          ctx.strokeText(tag[0], sx, sy - fs - 1);
          ctx.fillStyle = tag[1];
          ctx.fillText(tag[0], sx, sy - fs - 1);
          ctx.font = `600 ${fs}px ${FONT}`;
        }
      }
      ctx.globalAlpha = 1;

      // progress bar (gathering / cooking)
      const wk = p.work;
      if (wk && !p.dead) {
        const [sx, sy] = g.worldToScreen(p.x, p.y - 1.55 - liftOf(p));
        const bw2 = small ? 64 : 78, bh2 = small ? 6 : 7;
        ctx.fillStyle = 'rgba(14,15,16,0.82)';
        ctx.fillRect(sx - bw2 / 2 - 3, sy - bh2 - 15, bw2 + 6, bh2 + 19);
        ctx.strokeStyle = 'rgba(200,195,180,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - bw2 / 2 - 2.5, sy - bh2 - 14.5, bw2 + 5, bh2 + 18);
        bar(sx - bw2 / 2, sy - bh2, bw2, bh2, wk.k, '#d9b45a', 'rgba(0,0,0,0.5)');
        ctx.font = `600 ${small ? 10 : 11}px ${FONT}`;
        ctx.fillStyle = '#e6e2d8';
        ctx.fillText(wk.label, sx, sy - bh2 - 4);
      }

      // floating combat text
      for (const f of fct) {
        const k = f.t / f.life;
        const top = f.e === p ? 1.25 : spriteTop(f.e);
        const [sx0, sy0] = g.worldToScreen(f.x, f.y - top);
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
