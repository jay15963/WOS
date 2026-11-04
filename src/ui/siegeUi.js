// The siege engines on the HUD (local, cosmetic; game/siege.js owns the controls and the rules):
//  - operating a trebuchet / catapult — touch: the attack button becomes its aim stick (like the ballista's): press
//    and drag = where (the direction) and how far (the drag's length, from the shortest to the longest throw), release =
//    throw as soon as the frame lines up, back to the centre or onto "Cancelar" = no shot, a quick tap = throw where it
//    points. Desktop: the mouse is the target, Space / a click throws.
//  - the attack button shows the stone, the stones left and the reload ring (the ram: its blow's cooldown).
//  - in the world: the range ring (the longest throw) and the dead zone (the shortest), the arc to the aim point, the
//    landing ellipse = where the stone may fall (the trebuchet's is wide; it narrows shot after shot at the same
//    target), the frame turning toward where it is going; the camera leans toward the target.
//  - pushing: a strip with the crew ("2 pessoas · velocidade normal" / "sozinho: bem devagar"), the way it is going,
//    the ram's target ("Portão à frente"), the tower's ramp; arrows on the ground where it goes.

import { ARTY, PUSH, pushSpeed } from '../game/content/siege.js';
import { siegeCtl, pivotOf, frontAng, frontTiles, isGate, crewOf, towerN, towerTouch, toWorld, ladderLocal, rangingK, DIR } from '../game/siege.js';
import { BUILDINGS } from '../game/data.js';
import { STORY_H } from '../game/levels.js';
import { itemIcon } from './icons.js';

const DEAD = 0.22;
const RX = 0.547, RY = 0.359;
const CSS = `
#hud.sg-on .ab-s { display: none !important; }
#hud.sg-on [data-ab="attack"] { touch-action: none !important; }
#hud.sg-on [data-ab="attack"] > .ic, #hud.sg-on [data-ab="attack"] > .ammo { display: none !important; }
[data-ab="attack"] .sg-ic { display: none; position: absolute; inset: 14%; pointer-events: none; }
#hud.sg-on [data-ab="attack"] .sg-ic { display: grid; place-items: center; }
[data-ab="attack"] .sg-ic img, [data-ab="attack"] .sg-ic svg { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 1px 1px #000); }
[data-ab="attack"] .sg-n { display: none; position: absolute; right: -2px; bottom: -2px; min-width: 18px; padding: 1px 4px; border-radius: 9px; background: #2a1d12; color: #ffe9b8;
  font: 800 11px/14px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 1.5px #000; pointer-events: none; }
#hud.sg-on [data-ab="attack"] .sg-n.show { display: block; }
[data-ab="attack"] .sg-n.out { background: #6a1a12; color: #ffd0c4; }
[data-ab="attack"] .sg-cd { display: none; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: conic-gradient(rgba(10,6,2,.62) var(--p, 0deg), transparent 0); }
#hud.sg-on [data-ab="attack"] .sg-cd { display: block; }
.sg-tip { position: fixed; left: 50%; top: calc(var(--safe-t, 0px) + 74px); transform: translateX(-50%); z-index: 25; pointer-events: none; display: none;
  padding: 5px 12px; border-radius: 12px; background: rgba(22,15,9,.78); color: #fbe9c6; font: 700 13px/1.25 system-ui, sans-serif; text-align: center;
  box-shadow: 0 0 0 1px rgba(255,220,160,.25), 0 2px 8px rgba(0,0,0,.4); max-width: min(92vw, 560px); }
.sg-tip.on { display: block; }
.sg-tip small { display: block; font-weight: 600; opacity: .8; font-size: 11.5px; }
.sg-tip .warn { color: #ffb48a; }
`;
const RAM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffe9b8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h11"/><path d="M14 8.5h4.5a2.5 2.5 0 0 1 0 5H14z"/><path d="M18 8.5c2-2.5 4-1 3.5 1"/><path d="M6 9v6M9.5 9v6"/></svg>';
const TOWER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffe9b8" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V7h12v14"/><path d="M5 7V4h3v2h2V4h4v2h2V4h3v3"/><path d="M18 11l4 3"/><circle cx="8" cy="21" r="1.4"/><circle cx="16" cy="21" r="1.4"/></svg>';

export function installSiegeUi(game) {
  const C = siegeCtl(game);
  const hud = document.getElementById('hud');
  if (typeof document !== 'undefined' && !document.getElementById('sg-style')) {
    const st = document.createElement('style'); st.id = 'sg-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const tip = document.createElement('div'); tip.className = 'sg-tip'; document.body.appendChild(tip);
  const atk = () => document.querySelector('[data-ab="attack"]');
  let parts = null;
  const ensureParts = () => {
    const b = atk();
    if (!b) return null;
    if (parts && parts.b === b) return parts;
    const ic = document.createElement('span'); ic.className = 'sg-ic';
    const n = document.createElement('span'); n.className = 'sg-n';
    const cd = document.createElement('span'); cd.className = 'sg-cd';
    b.append(cd, ic, n);
    parts = { b, ic, n, cd, last: {} };
    return parts;
  };

  // ---------- the touch stick: direction and distance ----------
  const S = { on: false, pid: null, cx: 0, cy: 0, R: 80, fx: 0, fy: 0, moved: false, hot: false, ui: null };
  function overlay() {
    if (S.ui) return S.ui;
    const joy = document.createElement('div');
    joy.className = 'aim-joy';
    joy.innerHTML = '<div class="ring"></div><div class="dead"></div><div class="knob"></div>';
    const cn = document.createElement('div');
    cn.className = 'aim-cancel';
    cn.innerHTML = '<b>✕</b><span>Cancelar</span>';
    document.body.append(joy, cn);
    S.ui = { joy, ring: joy.children[0], dead: joy.children[1], knob: joy.children[2], cn, cnx: 0, cny: 0 };
    return S.ui;
  }
  function show() {
    const U = overlay(), R = S.R, d = R * DEAD;
    U.joy.style.transform = `translate(${S.cx}px, ${S.cy}px)`;
    Object.assign(U.ring.style, { left: `${-R}px`, top: `${-R}px`, width: `${2 * R}px`, height: `${2 * R}px` });
    Object.assign(U.dead.style, { left: `${-d}px`, top: `${-d}px`, width: `${2 * d}px`, height: `${2 * d}px` });
    U.cnx = Math.min(innerWidth - 44, Math.max(44, S.cx + R * 0.4));
    U.cny = Math.max(52, S.cy - R * 2.5);
    if (S.cy - U.cny < R * 1.8) U.cnx = Math.max(44, S.cx - R * 2.6);
    U.cn.style.transform = `translate(${U.cnx}px, ${U.cny}px)`;
    U.joy.classList.add('on'); U.cn.classList.add('on');
    knob();
  }
  function knob() {
    const U = S.ui;
    if (!U) return;
    let dx = S.fx - S.cx, dy = S.fy - S.cy;
    const L = Math.hypot(dx, dy);
    if (L > S.R) { dx *= S.R / L; dy *= S.R / L; }
    U.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    U.joy.classList.toggle('cancel', S.hot); U.cn.classList.toggle('hot', S.hot);
  }
  function hide() { const U = S.ui; if (U) { U.joy.classList.remove('on', 'cancel'); U.cn.classList.remove('on', 'hot'); } }
  // [angle, distance] from the drag (null inside the dead zone)
  function stickAim() {
    const o = C.o;
    if (!o) return null;
    const L = Math.hypot(S.fx - S.cx, S.fy - S.cy);
    if (L < S.R * DEAD) return null;
    const [wx, wy] = game.toWorldDir(S.fx - S.cx, S.fy - S.cy), Sp = ARTY[o.type];
    const k = Math.min(1, (L - S.R * DEAD) / (S.R * (1 - DEAD)));
    return [Math.atan2(wy, wx), Sp.range[0] + (Sp.range[1] - Sp.range[0]) * k];
  }
  function end() { S.on = false; C.stickOn = false; C.stickAim = null; hide(); }
  C.beginTouch = (el, ev) => {
    if (C.push && C.push.type === 'battering_ram') { C.ram(); return true; }
    if (C.push || C.climb) return true;
    if (!C.o) return false;
    const r = el?.getBoundingClientRect?.();
    Object.assign(S, { on: true, pid: ev?.pointerId ?? null, moved: false, hot: false });
    S.cx = r ? r.left + r.width / 2 : ev?.clientX ?? innerWidth - 90; S.cy = r ? r.top + r.height / 2 : ev?.clientY ?? innerHeight - 90;
    S.fx = ev?.clientX ?? S.cx; S.fy = ev?.clientY ?? S.cy;
    S.R = Math.max(62, Math.min(96, Math.min(innerWidth, innerHeight) * 0.19));
    C.pending = null;
    show();
    return true;
  };
  addEventListener('pointermove', (e) => {
    if (!S.on || e.pointerId !== S.pid) return;
    S.fx = e.clientX; S.fy = e.clientY;
    if (Math.hypot(S.fx - S.cx, S.fy - S.cy) > S.R * DEAD * 1.1) S.moved = true;
    S.hot = !!S.ui && Math.hypot(S.fx - S.ui.cnx, S.fy - S.ui.cny) < 44;
    const a = S.hot ? null : stickAim();
    C.stickOn = a != null; C.stickAim = a;
    knob();
  });
  const up = (e) => {
    if (!S.on || e.pointerId !== S.pid) return;
    S.fx = e.clientX; S.fy = e.clientY;
    const L = Math.hypot(S.fx - S.cx, S.fy - S.cy), hot = S.hot, moved = S.moved;
    const a = stickAim();
    end();
    if (e.type === 'pointercancel' || hot) { game.audio?.play('ui', { volume: 0.25 }); return; }
    if (moved && L < S.R * DEAD) { game.audio?.play('ui', { volume: 0.25 }); return; }
    if (!moved) { C.fire(); return; }
    if (a) { C.want = a[0]; C.wantD = a[1]; }
    C.queueFire();
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  game.events.on('siege', (d) => { if (!d.on) end(); });

  const cam = { x: 0, y: 0, k: 0 };
  const last = {};
  const setTip = (html) => { if (last.tip !== html) { last.tip = html; tip.innerHTML = html; tip.classList.toggle('on', !!html); } };
  return {
    sync: 'owner', // local presentation of the local player's siege engine (after ui/aim.js: it may set the camera focus)
    update(g, dt) {
      const o = C.o, q = C.push, on = !!(o || q);
      hud?.classList.toggle('sg-on', on);
      const P = ensureParts();
      if (P) {
        const L = P.last;
        const kind = o ? o.type : q ? q.type : '';
        if (L.kind !== kind) {
          L.kind = kind; L.n = null; L.deg = null;
          P.ic.innerHTML = o ? itemIcon(g.A, ARTY[o.type].ammo) : q?.type === 'battering_ram' ? RAM_SVG : q ? TOWER_SVG : '';
          P.b.title = o ? `Atirar (${o.type === 'trebuchet' ? 'pedra de trabuco' : 'pedra de catapulta'}) — Espaço ou clique` : q?.type === 'battering_ram' ? 'Pancada do aríete (Espaço)' : '';
        }
        if (o) {
          const n = g.player.inv.count(ARTY[o.type].ammo);
          if (L.n !== n) { L.n = n; P.n.textContent = String(n); P.n.classList.add('show'); P.n.classList.toggle('out', n === 0); }
          const rel = Math.max(C.cd || 0, o._reload || 0), deg = Math.round((rel / ARTY[o.type].reload) * 180) * 2;
          if (L.deg !== deg) { L.deg = deg; P.cd.style.setProperty('--p', deg + 'deg'); }
        } else {
          if (L.n !== -1) { L.n = -1; P.n.classList.remove('show'); }
          const sw = q && q.type === 'battering_ram' && q._swT != null ? Math.max(0, 1 - (g.time - q._swT) / 2) : 0, deg = Math.round(sw * 180) * 2;
          if (L.deg !== deg) { L.deg = deg; P.cd.style.setProperty('--p', deg + 'deg'); }
        }
      }
      // the strip: what is going on
      if (o) {
        const Sx = ARTY[o.type], d = C.distL, [px, py] = pivotOf(o), tx = px + Math.cos(C.aimL) * d, ty = py + Math.sin(C.aimL) * d, k = rangingK(o, tx, ty);
        const name = BUILDINGS[o.type].name, sc = Sx.scatter[0] * d * k;
        const acc = o.type === 'trebuchet' ? ` · cai a até ${sc.toFixed(0)} tiles do alvo${k < 0.99 ? ' (ajustando a mira)' : ''}` : '';
        setTip(`${name} · alvo a ${d.toFixed(0)} tiles${acc}<small>${g.input?.isTouch ? 'Arraste o botão de ataque: direção e distância · solte para atirar' : 'Mouse: alvo · Espaço ou clique: atirar · E: sair'}</small>`);
      } else if (q) {
        const n = crewOf(q), def = BUILDINGS[q.type], v = pushSpeed(q.type, Math.max(1, n));
        const crew = n <= 1 ? '<span class="warn">sozinho: bem devagar — chame mais gente</span>' : `${n} pessoas · ${n >= 3 ? 'mais rápido' : 'velocidade normal'}`;
        let what = '';
        if (q.type === 'battering_ram') {
          const any = frontTiles(q).map(([x, y]) => g.world.inBounds(x, y) ? g.build.grid.main.get(g.world.idx(x, y)) : null).find((s) => s && !s.blueprint);
          what = any ? (isGate(g, any) ? ' · <b>portão à frente: Espaço dá a pancada</b>' : ' · isto não é um portão') : '';
        } else {
          const tt = towerTouch(g, q);
          what = q.ramp ? ' · <b>rampa baixada: suba pela escada de trás (E)</b>' : tt ? (tt.ok ? ' · encostada' : ` · <span class="warn">a muralha tem ${tt.n} ${tt.n > 1 ? 'andares' : 'andar'}, a torre ${towerN(q)}</span>`) : ` · ${towerN(q)} ${towerN(q) > 1 ? 'andares' : 'andar'}`;
        }
        setTip(`${def.name} · ${crew} (${v.toFixed(1)} tiles/s)${what}<small>${g.input?.isTouch ? 'Direcional: empurrar · botão de usar: soltar' : 'Setas / WASD: empurrar · E: soltar'}</small>`);
      } else if (C.climb) setTip('Subindo a escada da torre…');
      else setTip('');
      // the camera leans toward the target (artillery: far)
      let kT = 0;
      if (o) {
        const [px, py] = pivotOf(o), lean = o.type === 'trebuchet' ? 0.62 : 0.5;
        cam.x = px + Math.cos(C.aimL) * C.distL * lean; cam.y = py + Math.sin(C.aimL) * C.distL * lean; kT = o.type === 'trebuchet' ? 0.82 : 0.6;
        if (!g.input?.isTouch) g.R.canvas.style.cursor = 'crosshair';
      }
      cam.k += (kT - cam.k) * (1 - Math.exp(-dt * (kT > cam.k ? 2.5 : 4)));
      if (cam.k > 0.004) g.camFocus = cam; else if (g.camFocus === cam) g.camFocus = null;
    },
    render(g, B, v, env) {
      const A = g.A;
      if (!A.has('fx_spark') || !A.has('fx_ring')) return;
      const dot = A.get('fx_spark'), ring = A.get('fx_ring'), soft = A.has('fx_soft') ? A.get('fx_soft') : dot, px = 1 / g.cam.zoom, t = g.time, night = env?.night || 0;
      const o = C.o;
      if (o) {
        const Sx = ARTY[o.type], [cx, cy] = pivotOf(o), lv = (o.lv | 0) * STORY_H;
        const reloading = (C.cd || 0) > 0 || o._reload > 0, col = reloading ? [0.95, 0.82, 0.6] : [1, 0.82, 0.42];
        // the range ring (the longest throw) and the shortest
        for (const [Rr, al] of [[Sx.range[1], 0.6], [Sx.range[0], 0.32]]) {
          const n = Math.max(40, Math.min(160, Math.round((Rr * Math.PI * 2) / 0.9)));
          const dl = Math.max(0.5, 16 * px) / dot.w, dh = Math.max(0.1, 5 * px) / dot.h;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + t * 0.03, x = cx + Math.cos(a) * Rr, y = cy + Math.sin(a) * Rr;
            if (x < v.x0 - 1 || x > v.x1 + 1 || y < v.y0 - 1 || y > v.y1 + 1) continue;
            const near = Math.pow(Math.max(0, Math.cos(a - C.aimL)), 12);
            B.blob.add(dot, x, y, dl, dh, col[0], col[1], col[2], al * (0.6 + 0.4 * near), 0, a + Math.PI / 2 - (g.cam.rot || 0));
          }
        }
        // the arc from the frame to the aim point (dots flowing along the flight), the aim point and the landing ellipse
        const d = C.distL, tx = cx + Math.cos(C.aimL) * d, ty = cy + Math.sin(C.aimL) * d, apex = Sx.apex[0] + Sx.apex[1] * d;
        const N = 22, ph = (t * 0.9) % 1;
        for (let i = 0; i < N; i++) {
          const k = (i + ph) / N;
          if (k < 0.05 || k > 0.96) continue;
          const x = cx + (tx - cx) * k, y = cy + (ty - cy) * k, lift = (Sx.h0 + lv) * (1 - k) + 4 * apex * k * (1 - k);
          const s = Math.max(0.2, 11 * px) / dot.w, a = Math.min(1, k * 6) * Math.min(1, (1 - k) * 8) * (reloading ? 0.45 : 0.9);
          B.fx.add(dot, x, y, s * 1.45, s * 1.45, 0.1, 0.07, 0.03, a * 0.4, 0, 0, 0, 1, 0, lift);
          B.fx.add(dot, x, y, s, s, col[0], col[1], col[2], a, 0, 0, 0, 1, 0, lift);
          B.blob.add(dot, x, y, s * 0.75, s * 0.4, 0.06, 0.05, 0.04, a * 0.4);
        }
        // the landing ellipse: lies along the shot (dots on the ground, world space), a soft fill, the blast radius
        const k = rangingK(o, tx, ty), sL = Math.max(0.35, Sx.scatter[0] * d * k), sW = Math.max(0.3, Sx.scatter[1] * d * k), pulse = 1 + 0.04 * Math.sin(t * 6);
        const ca = Math.cos(C.aimL), sa = Math.sin(C.aimL), rm = Math.sqrt(sL * sW);
        B.blob.add(soft, tx, ty, (2.1 * rm) / soft.w, (2.1 * rm) / soft.h, col[0], col[1] * 0.8, col[2] * 0.6, 0.16);
        const ne = Math.max(24, Math.min(72, Math.round((sL + sW) * 7))), ds = Math.max(0.16, 7 * px) / dot.w;
        for (let i = 0; i < ne; i++) {
          const a = (i / ne) * Math.PI * 2, ex = tx + (Math.cos(a) * sL * ca - Math.sin(a) * sW * sa) * pulse, ey = ty + (Math.cos(a) * sL * sa + Math.sin(a) * sW * ca) * pulse;
          B.blob.add(dot, ex, ey, ds * 1.5, ds * 1.5, 0.1, 0.07, 0.03, 0.35);
          B.blob.add(dot, ex, ey, ds, ds, col[0], col[1], col[2], 0.95);
          if (night > 0.1) B.emissive.add(dot, ex, ey, ds, ds, col[0] * 0.6, col[1] * 0.5, col[2] * 0.3, 0.7 * night);
        }
        B.blob.add(ring, tx, ty, Sx.area / RX, Sx.area / RY, 1, 1, 1, 0.55);
        B.fx.add(ring, tx, ty, Sx.area / RX, Sx.area / RY, 1, 1, 1, 0.25);
        // where the frame is still turning to
        if (Math.abs(((C.want - C.aimL + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 0.02) {
          const wx = cx + Math.cos(C.want) * C.wantD, wy = cy + Math.sin(C.want) * C.wantD;
          B.blob.add(ring, wx, wy, 0.4 / RX, 0.4 / RY, 1, 1, 1, 0.45);
        }
        return;
      }
      const q = C.push;
      if (q) {
        // the way it is going: chevrons on the ground ahead of it (the front edge), brighter while it moves
        const d = C.dir;
        if (d >= 0) {
          const [dx, dy] = DIR[d], [bx, by] = toWorld(q, 0, 0), half = Math.max(q.fw, q.fh) / 2 + 0.6, mv = q._slT > 0.02;
          for (let i = 0; i < 3; i++) {
            const k = ((t * 1.6 + i / 3) % 1), x = bx + dx * (half + k * 1.4), y = by + dy * (half + k * 1.4);
            B.blob.add(dot, x, y, Math.max(0.5, 18 * px) / dot.w, Math.max(0.14, 6 * px) / dot.h, 1, 0.86, 0.5, (mv ? 0.85 : 0.4) * (1 - k), 0, Math.atan2(dy, dx) + Math.PI / 2 - (g.cam.rot || 0));
          }
        }
        // the ram: its target; the tower: the ladder once the ramp is down
        if (q.type === 'battering_ram') for (const [x, y] of frontTiles(q)) {
          const s = g.world.inBounds(x, y) ? g.build.grid.main.get(g.world.idx(x, y)) : null;
          if (s && !s.blueprint) B.blob.add(ring, x + 0.5, y + 0.5, 0.55 / RX, 0.55 / RY, isGate(g, s) ? 1 : 0.8, isGate(g, s) ? 0.45 : 0.8, isGate(g, s) ? 0.3 : 0.8, 0.8);
        }
        return;
      }
      // a tower with its ramp down near the player: the ladder's spot
      const p = g.player;
      for (const s of g.build.structures) {
        if (s.type !== 'siege_tower' || !s.ramp || Math.abs(s.tx - p.x) > 6 || Math.abs(s.ty - p.y) > 6 || (p.z || 0) > 0.5) continue;
        const [lx, ly] = toWorld(s, ...ladderLocal(s), false), pulse = 0.7 + 0.3 * Math.sin(t * 5);
        B.blob.add(ring, lx, ly, 0.5 / RX, 0.5 / RY, 0.55, 1, 0.6, 0.7 * pulse);
      }
      void frontAng; void PUSH;
    },
  };
}
