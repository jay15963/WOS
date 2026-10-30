// Radar (agent N, top-right): the minimap as an elliptical disc inside a compass ring, with
//  - an arc gauge over the ring = the sun's (or the moon's) path: it fills from dawn to dusk (night: from dusk to dawn),
//    the glowing tip is the sun / moon, the tab on top shows the clock;
//  - teardrop markers on the ring pointing at things outside the disc: hostile creatures / raiders (coral), neutral
//    creatures (mustard), other players (teal), your home = respawn point (orange), your corpse while it still holds
//    your items (cream) and your current target (white);
//  - a day banner under the disc (day number + weather).
// Reads game.player, game.entities, game.env, game.build.structures, game.corpses (all local, cosmetic).
// DOM writes only on change; markers move by transform; the disc canvas redraws at 10 Hz (as the old minimap).
// Keeps the old hooks: #mm (tap → map), #mm canvas, #clock, #weather.

import { SPECIES, WEATHER_PT } from '../game/data.js';
import { respawnPoint } from '../game/player.js';
import { nIcon } from './hudtheme.js';

const NS = 'http://www.w3.org/2000/svg';
const RING = 5;      // ring distance outside the disc (px)
const ARC = 13;      // arc gauge distance outside the disc
const A0 = 200, A1 = 340; // arc angles (screen degrees, 270 = top)
const PX_TILE = 2.7; // disc scale: css px per tile
const MAXM = 10;
const DAWN = 5.5, DUSK = 19.5;
const WX_ICON = { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm', fog: 'fog' };

export function radarMarkup() {
  return `<div class="radar" id="radar">
    <div class="rd-disc">
      <svg class="rd-svg" aria-hidden="true"></svg>
      <div class="mm" id="mm" data-tip="<b>Radar</b><p>Gotas na borda apontam o que está fora do mapa: <b style='color:#c9473b'>hostil</b>, <b style='color:#a77e1c'>neutro</b>, <b style='color:#23766d'>jogadores</b>, <b style='color:#b5591e'>sua casa</b>.</p><p>O arco em cima é o caminho do sol: cheio = vai anoitecer.</p><span class='key'>M</span>"><canvas></canvas></div>
      <div class="rd-marks"></div>
      <div class="rd-clock" data-tip="<b>Hora do dia</b><p>O arco mostra o sol (ou a lua) no céu. A noite é fria: prepare fogo e abrigo antes da barra encher.</p>"><b id="clock"></b></div>
    </div>
    <div class="mm-info rd-info"><span class="rd-day">Dia <b id="rd-dayn"></b></span><span class="rd-wx"><i id="rd-wxi"></i><span id="weather"></span></span><span class="rd-mode hidden" id="rd-mode">Criativo</span></div>
  </div>`;
}

export function installRadar(game, root, mini) {
  const disc = root.querySelector('.rd-disc');
  const mm = root.querySelector('#mm'), cv = mm.querySelector('canvas'), ctx = cv.getContext('2d');
  const svg = root.querySelector('.rd-svg'), marks = root.querySelector('.rd-marks');
  const R = { clock: root.querySelector('#clock'), day: root.querySelector('#rd-dayn'), wx: root.querySelector('#weather'), wxi: root.querySelector('#rd-wxi'), mode: root.querySelector('#rd-mode') };
  let W = 0, H = 0, fill = null, tip = null, tipG = null, len = 0;
  const C = {};

  // ---------- ring + arc (rebuilt when the disc size changes) ----------
  const build = () => {
    W = mm.clientWidth; H = mm.clientHeight;
    if (!W || !H) return;
    const P = ARC + 10, SW = W + P * 2, SH = H + P * 2, cx = SW / 2, cy = SH / 2;
    Object.assign(svg.style, { left: `${-P}px`, top: `${-P}px`, width: `${SW}px`, height: `${SH}px` });
    svg.setAttribute('viewBox', `0 0 ${SW} ${SH}`);
    const rx = W / 2 + RING, ry = H / 2 + RING, ax = W / 2 + ARC, ay = H / 2 + ARC;
    const pt = (a, x, y) => [cx + x * Math.cos(a * Math.PI / 180), cy + y * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = pt(A0, ax, ay), [x1, y1] = pt(A1, ax, ay);
    const arc = `M${x0.toFixed(1)} ${y0.toFixed(1)}A${ax} ${ay} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    // cardinal ticks + small ones between them
    let ticks = '';
    for (let k = 0; k < 16; k++) {
      const a = k * 22.5, big = k % 4 === 0;
      if (a > A0 - 6 && a < A1 + 6) continue; // under the arc
      const [ix, iy] = pt(a, rx - (big ? 3.5 : 2), ry - (big ? 3.5 : 2)), [ox, oy] = pt(a, rx + (big ? 3.5 : 2), ry + (big ? 3.5 : 2));
      ticks += `<path d="M${ix.toFixed(1)} ${iy.toFixed(1)}L${ox.toFixed(1)} ${oy.toFixed(1)}" class="${big ? 'tk tkb' : 'tk'}"/>`;
    }
    svg.innerHTML = `<defs>
        <linearGradient id="rdDay" x1="0" x2="1"><stop offset="0" stop-color="#e5574a"/><stop offset=".28" stop-color="#ec8b3b"/><stop offset=".5" stop-color="#f6dc8a"/><stop offset=".74" stop-color="#ec8b3b"/><stop offset="1" stop-color="#d94a52"/></linearGradient>
        <linearGradient id="rdNight" x1="0" x2="1"><stop offset="0" stop-color="#3a6f8e"/><stop offset=".5" stop-color="#7fc4d6"/><stop offset="1" stop-color="#3fa89c"/></linearGradient>
        <radialGradient id="rdGlow"><stop offset="0" stop-color="#fff6e6"/><stop offset=".35" stop-color="#ffd9c0" stop-opacity=".9"/><stop offset="1" stop-color="#ff9a80" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse class="rg0" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>
      <ellipse class="rg1" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>
      ${ticks}
      <path class="ar0" d="${arc}"/><path class="ar1" d="${arc}"/>
      <path class="ar2" d="${arc}" stroke="url(#rdDay)"/>
      <path class="ar3" d="${arc}"/>
      <g class="rd-tip"><circle r="9" fill="url(#rdGlow)"/><circle class="tipc" r="2.6"/></g>`;
    fill = svg.querySelector('.ar2'); tipG = svg.querySelector('.rd-tip'); tip = null;
    len = fill.getTotalLength();
    fill.style.strokeDasharray = `${len} ${len}`;
    C.f = C.night = C.fk = null;
  };
  try { new ResizeObserver(() => build()).observe(mm); } catch { addEventListener('resize', build); }
  build();

  // ---------- markers (pool) ----------
  const pool = [];
  for (let i = 0; i < MAXM; i++) {
    const el = document.createElement('i');
    el.className = 'rd-m off';
    marks.appendChild(el);
    pool.push({ el, cls: 'off', tf: '' });
  }
  const cand = [];
  let homeT = 0, home = null;

  const markers = (g) => {
    const p = g.player;
    if (!W) return;
    const span = W / PX_TILE, spanY = span * (H / W);
    const hx = span / 2, hy = spanY / 2;
    const inside = (x, y) => { const u = (x - p.x) / hx, v = (y - p.y) / hy; return u * u + v * v < 0.86; };
    cand.length = 0;
    const add = (x, y, cls, pri) => {
      if (inside(x, y)) return;
      const d = Math.hypot(x - p.x, y - p.y);
      cand.push({ x, y, cls, d, k: pri * 1000 + d });
    };
    for (const e of g.entities) {
      if (e.dead || e === p) continue;
      if (e.remote) { add(e.x, e.y, 'pl', 0); continue; }
      const dd = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (dd > 90) continue;
      if (e === p.target) { add(e.x, e.y, 'tgt', 1); continue; }
      if (e.faction === 'bandit') { if (dd < 80) add(e.x, e.y, 'h', 2); continue; }
      if (e.kind !== 'animal' || e.isProp) continue;
      const t = e.temper || SPECIES[e.species]?.temper;
      if (t === 'hostile' && dd < 66) add(e.x, e.y, 'h', 2);
      else if (t === 'neutral' && dd < 40) add(e.x, e.y, 'n', 4);
    }
    homeT -= 0.1;
    if (homeT <= 0) { homeT = 0.5; try { home = respawnPoint(g); } catch { home = null; } }
    if (home) add(home.x, home.y, 'home', 1);
    const cid = p._corpse, c = cid && g.corpses?.map?.get(cid);
    if (c && c.store?.used?.()) add(c.x, c.y, 'corpse', 1);
    cand.sort((a, b) => a.k - b.k);
    // at most 3 neutral drops
    let nn = 0, n = 0;
    for (const m of cand) {
      if (n >= MAXM) break;
      if (m.cls === 'n' && ++nn > 3) continue;
      const a = Math.atan2(m.y - p.y, m.x - p.x);
      const rx = W / 2 + RING, ry = H / 2 + RING;
      const x = W / 2 + Math.cos(a) * rx, y = H / 2 + Math.sin(a) * ry;
      const s = Math.max(0.72, Math.min(1.08, 1.16 - m.d / 110));
      const tf = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(a * 180 / Math.PI - 135).toFixed(0)}deg) scale(${s.toFixed(2)})`;
      const P = pool[n++];
      const cls = 'rd-m ' + m.cls;
      if (P.cls !== cls) { P.cls = cls; P.el.className = cls; }
      if (P.tf !== tf) { P.tf = tf; P.el.style.transform = tf; }
    }
    for (; n < MAXM; n++) { const P = pool[n]; if (P.cls !== 'rd-m off') { P.cls = 'rd-m off'; P.el.className = P.cls; } }
  };

  // ---------- clock, day arc, weather (4 Hz) ----------
  const sky = (g) => {
    if (C.creative !== !!g.creative) { C.creative = !!g.creative; R.mode?.classList.toggle('hidden', !C.creative); } // creative.js
    const E = g.env, h = E.hour;
    const night = h >= DUSK || h < DAWN;
    const f = night ? (((h - DUSK + 24) % 24) / (24 - DUSK + DAWN)) : (h - DAWN) / (DUSK - DAWN);
    if (C.night !== night) {
      C.night = night;
      root.classList.toggle('night', night);
      fill?.setAttribute('stroke', night ? 'url(#rdNight)' : 'url(#rdDay)');
    }
    const fk = Math.round(f * 400);
    if (fill && C.fk !== fk) {
      C.fk = fk;
      fill.style.strokeDashoffset = String(len * (1 - fk / 400));
      const q = fill.getPointAtLength(len * fk / 400);
      tipG.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`);
    }
    const hh = Math.floor(h), mi = Math.floor((h - hh) * 60);
    const clk = `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    if (C.clk !== clk) { C.clk = clk; R.clock.textContent = clk; }
    const day = String(E.dayIndex ?? 1);
    if (C.day !== day) { C.day = day; R.day.textContent = day; }
    const w = E.weather, clearNight = night && w === 'clear';
    const wn = clearNight ? 'Noite' : (WEATHER_PT[w] || [''])[0];
    if (C.wn !== wn) { C.wn = wn; R.wx.textContent = wn; R.wxi.innerHTML = nIcon(clearNight ? 'moon' : WX_ICON[w] || 'sun'); }
  };

  let t = 0, st = 0;
  return {
    update(g, dt) {
      t -= dt; st -= dt;
      if (st <= 0) { st = 0.25; sky(g); }
      if (t > 0) return;
      t = 0.1;
      if (!W) build();
      if (!W) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mini.draw(ctx, W, H, W / PX_TILE);
      markers(g);
    },
  };
}
