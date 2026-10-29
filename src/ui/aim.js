// Aimed ground abilities (aim: 'ground' — Tiro Longo, Lançar Lança). Local and cosmetic only: the shot itself is
// fireAimed() (src/game/abilities.js) → intent lob.fire → the host rolls the scatter and resolves the hit.
//  - Touch: hold the ability button and it becomes a joystick (MOBA skillshot): direction = drag direction, tilt =
//    distance (centre → 1 tile, rim → max range); release fires; drag back to the centre or onto "Cancelar" cancels;
//    a quick tap (or a hold without dragging) fires at the target.
//  - Mouse: hold the ability key → indicator at the mouse; a click or releasing the key fires there (a quick tap
//    fires at the mouse point); Esc / right click cancels. Clicking the button arms the aim until the next click.
//  - World indicator: max-range ring, arc preview (the real flight parabola), landing circle = scatter radius.
//  - Camera: game.camFocus = { x, y, k } eases toward the aim point, then follows the landing point while it flies.
//  - Thrown spear: the hand is empty while it flies (p._throwT) and the weapon fades back in (e._wFade).
// API (PLAN-V2 contract B ↔ G): game.aim = { beginTouch(id, buttonEl, ev), beginMouse(id, { key }?), release(),
//   cancel(), active, id }. release() is idempotent; a release with the mouse off the canvas arms click-to-fire.

import { ABILITIES } from '../game/data.js';
import { aimCheck, aimSpec, aimDefault, fireAimed } from '../game/abilities.js';
import { lobScatter, lobFlight } from '../game/content/weapons.js';
import { facingFrom } from '../game/physics.js';

const TAP_MS = 260;   // press shorter than this without dragging = quick tap
const DEAD = 0.22;    // joystick dead zone (fraction of its radius)
const H0 = 0.8;       // release height of the arc preview (projectiles.js)
const GOLD = [1, 0.86, 0.48], RED = [1, 0.34, 0.28];

const CSS = `
.aim-joy { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 50; opacity: 0; transition: opacity .12s; }
.aim-joy.on { opacity: 1; }
.aim-joy .ring { position: absolute; border-radius: 50%; border: 2px solid rgba(255,236,190,.6); box-sizing: border-box;
  background: radial-gradient(circle, rgba(255,226,160,.05) 0, rgba(255,226,160,.14) 68%, rgba(16,12,8,.32) 100%);
  box-shadow: 0 0 0 1px rgba(0,0,0,.45), inset 0 0 16px rgba(0,0,0,.4); }
.aim-joy .dead { position: absolute; border-radius: 50%; border: 1.5px dashed rgba(255,236,190,.45); box-sizing: border-box; }
.aim-joy .knob { position: absolute; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #fff6da, #e8bc62 58%, #8c6424); box-shadow: 0 3px 9px rgba(0,0,0,.6), 0 0 0 2px rgba(0,0,0,.55); }
.aim-joy.cancel .knob { background: radial-gradient(circle at 38% 32%, #ffd8d0, #d4584a 58%, #6a1a12); }
.aim-joy.cancel .ring { border-color: rgba(255,150,130,.7); }
.aim-cancel { position: fixed; left: 0; top: 0; width: 66px; height: 66px; margin: -33px 0 0 -33px; border-radius: 50%; display: grid; place-items: center;
  align-content: center; gap: 1px; background: rgba(34,14,10,.74); border: 2px solid rgba(255,140,120,.75); color: #ffd8ce; pointer-events: none; z-index: 50;
  font: 800 10.5px/1 system-ui, sans-serif; text-shadow: 0 1px 2px #000; box-shadow: 0 0 0 1px #000, 0 4px 12px rgba(0,0,0,.5);
  opacity: 0; transition: opacity .12s, transform .1s, background .1s; }
.aim-cancel b { font-size: 22px; line-height: 20px; }
.aim-cancel.on { opacity: 1; }
.aim-cancel.hot { transform: scale(1.16); background: rgba(176,40,30,.92); color: #fff; }
`;

export function installAim(game) {
  const canvas = game.R.canvas;
  const S = {
    active: false, id: null, mode: null, pid: null, el: null, t0: 0, cx: 0, cy: 0, R: 80, fx: 0, fy: 0, moved: false,
    key: null, sticky: false, hot: false, has: false, x: 0, y: 0, pending: null,
  };
  const focus = { x: 0, y: 0, k: 0, hold: 0, kHold: 0 };
  const cam = { x: 0, y: 0, k: 0 };
  let mouse = null, overCanvas = false, ui = null;
  const hinted = () => game.ctl?.hinted || {};

  const api = {
    get active() { return S.active; },
    get id() { return S.active ? S.id : null; },
    beginTouch, beginMouse, release, cancel,
  };
  game.aim = api;

  // ---------- DOM overlay (touch joystick + cancel bubble) ----------
  function overlay() {
    if (ui || typeof document === 'undefined') return ui;
    if (!document.getElementById('aim-style')) {
      const st = document.createElement('style');
      st.id = 'aim-style'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const joy = document.createElement('div');
    joy.className = 'aim-joy';
    joy.innerHTML = '<div class="ring"></div><div class="dead"></div><div class="knob"></div>';
    const cn = document.createElement('div');
    cn.className = 'aim-cancel';
    cn.innerHTML = '<b>✕</b><span>Cancelar</span>';
    document.body.append(joy, cn);
    ui = { joy, ring: joy.children[0], dead: joy.children[1], knob: joy.children[2], cn, cnx: 0, cny: 0 };
    return ui;
  }
  function showJoy() {
    const U = overlay();
    if (!U) return;
    const R = S.R, d = R * DEAD;
    Object.assign(U.joy.style, { transform: `translate(${S.cx}px, ${S.cy}px)` });
    Object.assign(U.ring.style, { left: `${-R}px`, top: `${-R}px`, width: `${2 * R}px`, height: `${2 * R}px` });
    Object.assign(U.dead.style, { left: `${-d}px`, top: `${-d}px`, width: `${2 * d}px`, height: `${2 * d}px` });
    // cancel bubble: well away from the stick (top-right, above the button cluster)
    const W = innerWidth;
    U.cnx = Math.min(W - 44, Math.max(44, S.cx + R * 0.4));
    U.cny = Math.max(52, S.cy - R * 2.5);
    if (S.cy - U.cny < R * 1.8) U.cnx = Math.max(44, S.cx - R * 2.6); // short screens: put it to the left instead
    U.cn.style.transform = `translate(${U.cnx}px, ${U.cny}px)`;
    U.joy.classList.add('on'); U.cn.classList.add('on');
    moveKnob();
  }
  function moveKnob() {
    if (!ui) return;
    let dx = S.fx - S.cx, dy = S.fy - S.cy;
    const L = Math.hypot(dx, dy);
    if (L > S.R) { dx *= S.R / L; dy *= S.R / L; }
    ui.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    ui.joy.classList.toggle('cancel', S.hot);
    ui.cn.classList.toggle('hot', S.hot);
  }
  function hideJoy() {
    if (!ui) return;
    ui.joy.classList.remove('on', 'cancel'); ui.cn.classList.remove('on', 'hot');
  }

  // ---------- begin / end ----------
  function start(id) {
    const why = aimCheck(game, id);
    if (why != null) { if (why) game.events.emit('error', { text: why }); return false; }
    const p = game.player;
    if (p.work) { p.work = null; p.action = null; }
    if (S.active && S.id !== id) end();
    Object.assign(S, { active: true, id, t0: performance.now(), moved: false, hot: false, sticky: false, key: null, has: false, pending: null });
    game.audio?.play(aimSpec(game, id)?.proj === 'spear' ? 'swing' : 'bow_draw', { x: p.x, y: p.y, volume: 0.5 });
    return true;
  }
  function beginTouch(id, el, ev) {
    if (!start(id)) return false;
    const r = el?.getBoundingClientRect?.();
    S.mode = 'touch'; S.el = el || null; S.pid = ev?.pointerId ?? null;
    S.cx = r ? r.left + r.width / 2 : ev?.clientX ?? innerWidth - 90;
    S.cy = r ? r.top + r.height / 2 : ev?.clientY ?? innerHeight - 90;
    S.fx = ev?.clientX ?? S.cx; S.fy = ev?.clientY ?? S.cy;
    S.R = Math.max(62, Math.min(96, Math.min(innerWidth, innerHeight) * 0.19));
    showJoy();
    return true;
  }
  function beginMouse(id, opts = {}) {
    if (S.active && S.mode === 'mouse' && S.id === id && S.sticky) { fireNow(); return true; } // second press fires
    if (!start(id)) return false;
    S.mode = 'mouse'; S.key = opts.key || null;
    const h = hinted();
    if (!h.aimMouse) { h.aimMouse = true; game.events.emit('toast', { text: 'Mire com o mouse: clique (ou solte a tecla) para atirar · Esc cancela', kind: 'info' }); }
    return true;
  }
  function end() {
    if (!S.active) return;
    S.active = false; S.sticky = false; S.key = null;
    hideJoy();
    const p = game.player;
    if (p.action?.aim) p.action = null;
    canvas.style.cursor = '';
  }
  function cancel(quiet = false) {
    if (!S.active) return;
    end();
    if (!quiet) game.audio?.play('ui', { volume: 0.25 });
  }
  function fireAt(x, y) {
    const id = S.id;
    end();
    const r = fireAimed(game, id, x, y);
    if (r === 'wait') S.pending = { id, x, y, t: 0 }; // global cooldown: fire as soon as it ends
  }
  function fireNow() {
    if (!S.active) return;
    if (!S.has) { noTarget(); return; }
    fireAt(S.x, S.y);
  }
  function noTarget() {
    end();
    game.events.emit('error', { text: game.input.isTouch ? 'Sem alvo: segure o botão e arraste para mirar' : 'Sem alvo: aponte o mouse para mirar' });
  }
  function release() {
    if (!S.active) return;
    if (S.mode === 'touch') {
      const L = Math.hypot(S.fx - S.cx, S.fy - S.cy);
      if (S.hot) { cancel(); return; }
      if (!S.moved) { const pt = aimDefault(game, S.id); if (pt) fireAt(pt.x, pt.y); else noTarget(); return; }
      if (L < S.R * DEAD) { cancel(); return; } // dragged back to the centre
      fireNow();
      return;
    }
    // mouse: fire where it points, unless the release happened over the HUD (button click) → click to fire
    if (overCanvas && mouse) { aimUpdate(); fireNow(); return; }
    S.key = null; S.sticky = true;
    const h = hinted();
    if (!h.aimClick) { h.aimClick = true; game.events.emit('toast', { text: 'Clique no chão para atirar · botão direito ou Esc cancela', kind: 'info' }); }
  }

  // ---------- DOM listeners ----------
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY }; overCanvas = e.target === canvas; }
    if (!S.active || S.mode !== 'touch' || e.pointerId !== S.pid) return;
    S.fx = e.clientX; S.fy = e.clientY;
    const L = Math.hypot(S.fx - S.cx, S.fy - S.cy);
    if (L > S.R * DEAD * 1.1) S.moved = true;
    S.hot = !!ui && Math.hypot(S.fx - ui.cnx, S.fy - ui.cny) < 44;
    moveKnob();
  });
  const up = (e) => {
    if (!S.active || S.mode !== 'touch' || e.pointerId !== S.pid) return;
    if (e.type === 'pointercancel') { cancel(true); return; }
    S.fx = e.clientX; S.fy = e.clientY;
    release();
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  // mouse click on the world while aiming: left fires, right cancels (the click never becomes a tap / walk)
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.active || S.mode !== 'mouse' || e.pointerType !== 'mouse') return;
    e.preventDefault(); e.stopImmediatePropagation();
    mouse = { x: e.clientX, y: e.clientY }; overCanvas = true;
    if (e.button === 2) cancel();
    else if (e.button === 0) { aimUpdate(); fireNow(); }
  }, true);
  addEventListener('keydown', (e) => {
    if (!S.active || e.code !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation(); // not the pause menu / target clear
    cancel();
  }, true);
  addEventListener('blur', () => { if (S.active && S.mode === 'mouse' && S.key) release(); });

  // ---------- aim point ----------
  function aimUpdate() {
    const g = game, p = g.player, Sx = aimSpec(g, S.id);
    if (!Sx) return;
    S.has = false;
    if (S.mode === 'touch') {
      if (!S.moved) {
        const pt = aimDefault(g, S.id);
        if (pt) { S.x = pt.x; S.y = pt.y; S.has = true; }
      } else {
        let dx = S.fx - S.cx, dy = S.fy - S.cy;
        const L = Math.hypot(dx, dy) || 1;
        const tilt = Math.max(0, Math.min(1, (L / S.R - DEAD) / (1 - DEAD)));
        const D = 1 + (Sx.range - 1) * tilt;
        dx /= L; dy /= L;
        S.x = p.x + dx * D; S.y = p.y + dy * D; S.has = L >= S.R * DEAD;
      }
    } else if (mouse) {
      const [wx, wy] = g.screenToWorld(mouse.x, mouse.y);
      let dx = wx - p.x, dy = wy - p.y;
      const L = Math.hypot(dx, dy) || 1, D = Math.min(Sx.range, Math.max(1, L));
      S.x = p.x + (dx / L) * D; S.y = p.y + (dy / L) * D; S.has = true;
    } else {
      const pt = aimDefault(g, S.id);
      if (pt) { S.x = pt.x; S.y = pt.y; S.has = true; }
    }
  }

  // ---------- per frame ----------
  const fadeIn = (e, dt) => { if (e._wFade < 1 && e.weapon) e._wFade = Math.min(1, e._wFade + dt / 0.35); };
  game.events.on('spearback', (d) => {
    // a remote player's spear landed: its hand weapon fades back in when its presence shows it again
    const e = game.session?.players?.get?.(d.pid)?.ent;
    if (e) e._wFade = 0;
  });
  game.events.on('aimfire', (d) => {
    focus.x = d.x; focus.y = d.y; focus.hold = d.dur + 0.35; focus.kHold = Math.max(cam.k, 0.25);
  });

  return {
    sync: 'owner', // local input + presentation (indicator, camera focus, hand visual); runs after equipment visuals
    update(g, dt) {
      const p = g.player;
      // thrown spear in the air: empty hand (presence sends it too), then the weapon fades back in
      if (p._throwT > 0) {
        p._throwT -= dt;
        p.weapon = null;
        if (p._throwT <= 0) { p._throwT = 0; p._wFade = 0; p.weapon = p.equip?.main ?? null; }
      }
      if (p._wFade < 1) fadeIn(p, dt);
      for (const e of g.entities) if (e.remote && e._wFade < 1) fadeIn(e, dt);

      // a shot waiting for the global cooldown
      const P = S.pending;
      if (P) {
        P.t += dt;
        if (p.dead || P.t > 1.2) S.pending = null;
        else if (p.gcdT <= 0) { S.pending = null; fireAimed(g, P.id, P.x, P.y); }
      }

      if (S.active) {
        const why = aimCheck(g, S.id);
        if (why != null && why !== 'Ainda não está pronto') { cancel(true); if (why) g.events.emit('error', { text: why }); }
        else if (S.mode === 'mouse' && S.key && !g.input.keys.has(S.key)) release();
      }
      if (S.active) {
        aimUpdate();
        const ab = ABILITIES[S.id];
        if (S.has) { p.facing = facingFrom(S.x - p.x, S.y - p.y, p.facing); p._faceLockT = Math.max(p._faceLockT || 0, 0.12); }
        // held draw / wind-up pose (compose.js 'shoot' / 'throw'); no auto-shot while aiming
        p.weapon = p.equip?.main ?? p.weapon;
        if (!p.action || p.action.aim) p.action = { type: ab.act === 'throw' ? 'throw' : 'shoot', t: ab.act === 'throw' ? 0.42 : 0.5, hold: true, aim: true };
        p.swingT = Math.max(p.swingT || 0, 0.3);
        if (S.mode === 'mouse') canvas.style.cursor = 'crosshair';
      }

      // camera focus: ease toward the aim point (keeps the landing point on screen for long bows), then the landing
      let kT = 0;
      if (S.active && S.has) {
        const v = g.view(), Sx = aimSpec(g, S.id);
        const hw = (v.x1 - v.x0) / 2 - 1.6, hh = (v.y1 - v.y0) / 2 - 1.6;
        const dx = Math.abs(S.x - p.x), dy = Math.abs(S.y - p.y), d = Math.hypot(dx, dy);
        const need = Math.max(dx > hw ? 1 - hw / dx : 0, dy > hh ? 1 - hh / dy : 0);
        kT = Math.min(0.92, Math.max(0.12 + 0.3 * (d / (Sx?.range || 18)), need));
        cam.x = S.x; cam.y = S.y;
      } else if (focus.hold > 0) {
        focus.hold -= dt; kT = focus.kHold; cam.x = focus.x; cam.y = focus.y;
      }
      cam.k += (kT - cam.k) * (1 - Math.exp(-dt * (kT > cam.k ? 5 : 2.2)));
      g.camFocus = cam.k > 0.004 ? cam : null;
    },

    render(g, B, v, env) {
      const A = g.A;
      const P = S.active ? (S.has ? S : null) : S.pending;
      const id = S.active ? S.id : P?.id;
      if (!id || !A.has('fx_soft') || !A.has('fx_ring')) return;
      const Sx = aimSpec(g, id);
      if (!Sx) return;
      const p = g.player, soft = A.get('fx_soft'), ring = A.get('fx_ring'), t = g.time;
      const dot = A.has('fx_spark') ? A.get('fx_spark') : soft;
      const px = 1 / g.cam.zoom; // tiles per CSS pixel: marks keep a readable size at any zoom
      const col = S.active && S.hot ? RED : GOLD;
      const night = env?.night || 0;
      const dim = S.active ? 1 : 0.55;
      // max-range ring (dashes, brighter toward the aim direction)
      const Rr = Sx.range, n = Math.max(32, Math.min(120, Math.round((Rr * Math.PI * 2) / 0.85)));
      const aimA = P ? Math.atan2(P.y - p.y, P.x - p.x) : 0;
      const dl = Math.max(0.5, 16 * px) / dot.w, dh = Math.max(0.1, 5 * px) / dot.h;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.04;
        const x = p.x + Math.cos(a) * Rr, y = p.y + Math.sin(a) * Rr;
        if (x < v.x0 - 1 || x > v.x1 + 1 || y < v.y0 - 1 || y > v.y1 + 1) continue;
        const near = P ? Math.pow(Math.max(0, Math.cos(a - aimA)), 10) : 0;
        B.blob.add(dot, x, y, dl, dh, col[0], col[1], col[2], (0.55 + 0.45 * near) * dim, 0, a + Math.PI / 2);
      }
      if (!P) return;
      const dx = P.x - p.x, dy = P.y - p.y, d = Math.hypot(dx, dy);
      const { apex } = lobFlight(Sx, Math.min(d, Sx.range));
      // arc preview: dots flowing along the real flight parabola, with their ground shadows
      const N = 18, ph = (t * 1.1) % 1;
      for (let i = 0; i < N; i++) {
        const k = (i + ph) / N;
        if (k < 0.04 || k > 0.97) continue;
        const x = p.x + dx * k, y = p.y + dy * k, lift = H0 * (1 - k) + 4 * apex * k * (1 - k);
        const s = Math.max(0.2, (9 + 3 * Math.sin(k * Math.PI)) * px) / dot.w;
        const a = (0.9 * Math.min(1, k * 6) * Math.min(1, (1 - k) * 8)) * dim;
        B.fx.add(dot, x, y, s, s, col[0], col[1], col[2], a, 0, 0, 0, 1, 0, lift);
        B.blob.add(dot, x, y, s * 0.75, s * 0.4, 0.06, 0.05, 0.04, a * 0.45);
      }
      // landing circle = scatter radius at this distance; inner mark = hit radius
      const R = lobScatter(Sx, Math.min(Math.max(d, 1), Sx.range)), pulse = 1 + 0.04 * Math.sin(t * 6);
      const rx = (R * pulse) / 0.547, ry = (R * pulse) / 0.359; // fx_ring ellipse radii (tiles) at scale 1
      B.blob.add(soft, P.x, P.y, (2.2 * R) / soft.w, (2.2 * R) / soft.h, col[0], col[1], col[2], 0.2 * dim);
      B.blob.add(ring, P.x, P.y, rx, ry, col[0], col[1], col[2], 0.95 * dim);
      B.fx.add(ring, P.x, P.y, rx, ry, col[0], col[1], col[2], 0.3 * dim); // visible through canopies
      const hr = Sx.hitR * 0.8;
      B.blob.add(ring, P.x, P.y, hr / 0.547, hr / 0.359, 1, 1, 1, 0.55 * dim);
      if (night > 0.1) {
        B.emissive.add(ring, P.x, P.y, rx, ry, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 0.7 * night * dim);
        B.emissive.add(soft, P.x, P.y, (2.2 * R) / soft.w, (2.2 * R) / soft.h, col[0] * 0.3, col[1] * 0.3, col[2] * 0.3, 0.5 * night * dim);
      }
    },
  };
}
