// The ballista on the HUD (local, cosmetic; game/ballista.js owns the controls and the rules):
//  - touch: while on a ballista the attack button becomes its aim stick, like the long shot (ui/aim.js): press and drag
//    = where it should point (it turns slowly), release = fire as soon as it lines up, back to the centre or onto
//    "Cancelar" = no shot, a quick tap = fire straight ahead. The ability buttons hide; the use button says "Sair".
//  - the attack button shows the bolt, the bolts left in the backpack and the reload ring.
//  - in the world: the aim line from the muzzle to where the bolt would stop (wall / rock, else its range) and, while
//    it is still turning, a faint line where it is going; the camera leans along the aim; desktop: crosshair cursor.

import { BALLISTA, ballistaCtl, pivotOf, muzzleOf, boltZ, boltStops } from '../game/ballista.js';
import { STORY_H } from '../game/levels.js';
import { itemIcon } from './icons.js';

const DEAD = 0.22;
const CSS = `
#hud.bal-on .ab-s { display: none !important; }
#hud.bal-on [data-ab="attack"] { touch-action: none !important; }
#hud.bal-on [data-ab="attack"] > .ic, #hud.bal-on [data-ab="attack"] > .ammo { display: none !important; }
[data-ab="attack"] .bal-ic { display: none; position: absolute; inset: 14%; pointer-events: none; }
#hud.bal-on [data-ab="attack"] .bal-ic { display: grid; place-items: center; }
[data-ab="attack"] .bal-ic img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 1px 1px #000); }
[data-ab="attack"] .bal-n { display: none; position: absolute; right: -2px; bottom: -2px; min-width: 18px; padding: 1px 4px; border-radius: 9px; background: #2a1d12; color: #ffe9b8;
  font: 800 11px/14px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 1.5px #000; pointer-events: none; }
#hud.bal-on [data-ab="attack"] .bal-n { display: block; }
[data-ab="attack"] .bal-n.out { background: #6a1a12; color: #ffd0c4; }
[data-ab="attack"] .bal-cd { display: none; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background: conic-gradient(rgba(10,6,2,.62) var(--p, 0deg), transparent 0); }
#hud.bal-on [data-ab="attack"] .bal-cd { display: block; }
`;

export function installBallistaUi(game) {
  const C = ballistaCtl(game);
  const hud = document.getElementById('hud');
  if (typeof document !== 'undefined' && !document.getElementById('bal-style')) {
    const st = document.createElement('style'); st.id = 'bal-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const atk = () => document.querySelector('[data-ab="attack"]');
  let parts = null;
  const ensureParts = () => {
    const b = atk();
    if (!b) return null;
    if (parts && parts.b === b) return parts;
    const ic = document.createElement('span'); ic.className = 'bal-ic'; ic.innerHTML = itemIcon(game.A, 'ballista_bolt');
    const n = document.createElement('span'); n.className = 'bal-n';
    const cd = document.createElement('span'); cd.className = 'bal-cd';
    b.append(cd, ic, n);
    parts = { b, ic, n, cd, last: {} };
    return parts;
  };

  // ---------- the touch stick (the same look as the long shot's: ui/aim.js .aim-joy / .aim-cancel) ----------
  const S = { on: false, pid: null, cx: 0, cy: 0, R: 80, fx: 0, fy: 0, moved: false, hot: false, t0: 0, ui: null };
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
  function stickAngle() {
    const L = Math.hypot(S.fx - S.cx, S.fy - S.cy);
    if (L < S.R * DEAD) return null;
    const [wx, wy] = game.toWorldDir(S.fx - S.cx, S.fy - S.cy); // (the drag is on the screen; camera yaw: turned to the world)
    return Math.atan2(wy, wx);
  }
  function end() { S.on = false; C.stickOn = false; C.stickAng = null; hide(); }
  C.beginTouch = (el, ev) => {
    if (!C.o) return false;
    const r = el?.getBoundingClientRect?.();
    Object.assign(S, { on: true, pid: ev?.pointerId ?? null, moved: false, hot: false, t0: performance.now() });
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
    const a = S.hot ? null : stickAngle();
    C.stickOn = a != null; C.stickAng = a;
    knob();
  });
  const up = (e) => {
    if (!S.on || e.pointerId !== S.pid) return;
    S.fx = e.clientX; S.fy = e.clientY;
    const L = Math.hypot(S.fx - S.cx, S.fy - S.cy), hot = S.hot, moved = S.moved;
    const a = stickAngle();
    end();
    if (e.type === 'pointercancel' || hot) { game.audio?.play('ui', { volume: 0.25 }); return; }
    if (moved && L < S.R * DEAD) { game.audio?.play('ui', { volume: 0.25 }); return; } // (dragged out, then back into the centre: cancel)
    if (!moved) { C.fire(); return; } // (a quick tap / a hold without dragging: straight ahead)
    if (a != null) C.want = a;
    C.queueFire(); // (fires as soon as the top lines up with where the stick pointed)
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  game.events.on('ballista', (d) => { if (!d.on) end(); });

  const cam = { x: 0, y: 0, k: 0 };
  return {
    sync: 'owner', // local presentation of the local player's ballista (after ui/aim.js: it may set the camera focus)
    update(g, dt) {
      const o = C.o, on = !!o;
      hud?.classList.toggle('bal-on', on);
      const P = ensureParts();
      if (on && P) {
        const n = g.player.inv.count('ballista_bolt'), L = P.last;
        if (L.n !== n) { L.n = n; P.n.textContent = String(n); P.n.classList.toggle('out', n === 0); }
        const rel = Math.max(C.cd || 0, o._reload || 0), deg = Math.round((rel / BALLISTA.reload) * 180) * 2;
        if (L.deg !== deg) { L.deg = deg; P.cd.style.setProperty('--p', deg + 'deg'); }
        if (L.title !== 1) { L.title = 1; P.b.title = 'Disparar a balista (Espaço ou clique) — gasta 1 flecha de balista'; }
      } else if (P && P.last.title) { P.last.title = 0; P.b.title = ''; }
      // the camera leans along the aim (long range); desktop: a crosshair
      let kT = 0;
      if (on) {
        const [px, py] = pivotOf(o), a = C.aimL;
        cam.x = px + Math.cos(a) * 7; cam.y = py + Math.sin(a) * 7; kT = 0.38;
        if (!g.input?.isTouch) g.R.canvas.style.cursor = 'crosshair';
      }
      cam.k += (kT - cam.k) * (1 - Math.exp(-dt * (kT > cam.k ? 3 : 4)));
      if (cam.k > 0.004) g.camFocus = cam; else if (g.camFocus === cam) g.camFocus = null;
    },
    render(g, B) {
      const o = C.o, A = g.A;
      if (!o || !A.has('fx_spark')) return;
      const dot = A.get('fx_spark'), ring = A.has('fx_ring') ? A.get('fx_ring') : null, px = 1 / g.cam.zoom;
      const line = (a, alpha, col) => {
        const [mx, my] = muzzleOf(o, a), ux = Math.cos(a), uy = Math.sin(a), lv = o.lv | 0;
        // march until a wall / rock (where the bolt would stop: game/ballista.js boltStops, at the height it flies) or the range
        let d = 0, end = BALLISTA.range;
        for (; d < BALLISTA.range; d += 0.25) if (boltStops(g, mx + ux * d, my + uy * d, boltZ(lv, d))) { end = d; break; }
        const sx = Math.max(0.34, 17 * px) / dot.w, sy = Math.max(0.13, 6 * px) / dot.h, rot = Math.atan2(...g.toViewDir(ux, uy).reverse());
        const ph = (g.time * 2.2) % 1;
        for (let k = ph * 0.75; k < end; k += 0.75) {
          const f = Math.min(1, 0.35 + k / 3) * (1 - Math.max(0, (k - end + 2) / 2) * 0.6);
          const h = BALLISTA.h0 + boltZ(lv, k) * STORY_H; // (up a story: the line plunges like the bolt)
          B.fx.add(dot, mx + ux * k, my + uy * k, sx * 1.35, sy * 1.6, 0.1, 0.07, 0.03, alpha * f * 0.45, 0, rot, 0, 1, 0, h); // (dark halo: reads on snow)
          B.fx.add(dot, mx + ux * k, my + uy * k, sx, sy, col[0], col[1], col[2], alpha * f, 0, rot, 0, 1, 0, h);
        }
        return [mx + ux * end, my + uy * end, end < BALLISTA.range, boltZ(lv, end)];
      };
      const reloading = (C.cd || 0) > 0 || o._reload > 0;
      const [ex, ey, hit] = line(C.aimL, reloading ? 0.35 : 0.85, reloading ? [0.9, 0.8, 0.6] : [1, 0.86, 0.48]);
      if (ring) {
        const R = hit ? 0.45 : 0.6;
        B.blob.add(ring, ex, ey, R / 0.547, R / 0.359, hit ? 1 : 1, hit ? 0.5 : 0.86, hit ? 0.35 : 0.48, 0.8);
      }
      if (Math.abs(((C.want - C.aimL + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 0.02) line(C.want, 0.22, [1, 1, 1]); // (where it is going)
    },
  };
}
