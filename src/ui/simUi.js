// The simulation's screens (docs/SIMULACAO.md): the bar on top (the speed — the host's buttons, the date, who you are) and the
// WORLD MAP view: the whole screen is the planet's map (ui/minimap.js, the kingdoms, roads, places, armies, sieges, battles),
// zoomed with the wheel, dragged to pan. Zooming in past the gameplay view's farthest field of view goes to the gameplay view
// there (a spectator flies to it; someone in a body goes back to it); zooming out past the gameplay's farthest zoom comes back
// here (game/game.js stepZoom → game/sim.js zoomReq). Above 5x only the map (the host's buttons: 10x, 50x, 100x there, and
// only with nobody in a body). Under the map nothing of the world is drawn (game.sim.noRender: main.js).

import { SPEEDS, PLAY_MAX } from '../game/sim.js';
import { ZOOM_MIN } from '../game/game.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `
#simmap { position: fixed; inset: 0; width: 100vw; height: 100vh; display: none; background: #1d120a; touch-action: none; cursor: grab; }
#simmap.drag { cursor: grabbing; }
body.sim-map #simmap { display: block; }
body.sim-map #hud > *:not(.errs):not(.feed):not(.banner) { visibility: hidden !important; }
body.sim-map #joystick { visibility: hidden !important; }
body.sim-ghost #hud #pf, body.sim-ghost #hud #quick, body.sim-ghost #hud #status, body.sim-ghost #hud .hotbar, body.sim-ghost #hud .tf,
body.sim-ghost #hud .ab-atk, body.sim-ghost #hud .ab-s, body.sim-ghost #hud .castbar { visibility: hidden !important; }
#simbar { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
  max-width: calc(100vw - 24px); padding: 6px 10px; border-radius: 10px; background: rgba(36, 22, 13, 0.88); color: #f6ead0; border: 2px solid #24160d;
  box-shadow: 0 3px 0 rgba(0,0,0,.35); font: 700 13px/1.15 "Barlow Condensed", "Segoe UI", system-ui, sans-serif; pointer-events: auto; user-select: none; }
#simbar .sb-t { letter-spacing: 1px; color: #f0c24a; font-weight: 800; }
#simbar .sb-d { color: #e9dcc0; font-weight: 600; white-space: nowrap; }
#simbar .sb-sp { display: flex; gap: 3px; }
#simbar .sb-sp button { min-width: 38px; padding: 4px 6px; border-radius: 6px; border: 1.5px solid #6a4a2c; background: #3a2616; color: #f6ead0; font: inherit; cursor: pointer; }
#simbar .sb-sp button.on { background: #f0c24a; color: #24160d; border-color: #f0c24a; }
#simbar .sb-sp button:disabled { opacity: .38; cursor: not-allowed; }
#simbar .sb-sp button.fast { border-style: dashed; }
#simbar .sb-who { color: #bfe3c0; white-space: nowrap; }
#simbar .sb-x { padding: 4px 8px; border-radius: 6px; border: 1.5px solid #ec5a4c; background: #5a1e16; color: #ffe7df; font: inherit; cursor: pointer; }
#simhint { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 30; padding: 5px 10px; border-radius: 8px; background: rgba(36,22,13,.78);
  color: #f6ead0; font: 600 13px/1.2 "Barlow Condensed", "Segoe UI", system-ui, sans-serif; pointer-events: none; text-align: center; max-width: calc(100vw - 24px); }
@media (max-width: 700px) { #simbar { top: 4px; gap: 6px; padding: 4px 6px; font-size: 12px; } #simbar .sb-sp button { min-width: 30px; padding: 3px 4px; } }
`;

export function installSimUI(game) {
  const S = game.sim;
  if (!S) return { sync: 'cosmetic', update() {} };
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  document.body.classList.add('sim-on');
  // the map canvas (under the HUD: its notices stay on top)
  const cv = document.createElement('canvas');
  cv.id = 'simmap';
  const hud = document.getElementById('hud');
  document.body.insertBefore(cv, hud || null);
  const bar = document.createElement('div');
  bar.id = 'simbar';
  document.body.appendChild(bar);
  const hint = document.createElement('div');
  hint.id = 'simhint';
  document.body.appendChild(hint);

  const mini = () => game.ui?.minimap || null;
  const playSpan = () => (game.R?.cssW || innerWidth) / ZOOM_MIN; // (the tiles across the gameplay view at its farthest zoom)
  let drawT = 0, barKey = '', hintKey = '';

  // ---------- the map view ----------
  const center = (x, y, span) => {
    const m = mini();
    if (!m) return;
    const H = game.world.H, half = (span * ((cv.clientHeight || innerHeight) / (cv.clientWidth || innerWidth))) / 2; // (never past the poles)
    m.view = { cx: game.world.wrap ? game.world.wrapPos(x) : x, cy: half * 2 >= H ? H / 2 : Math.max(half, Math.min(H - half, y)), span };
  };
  const at = (e) => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const rect = () => { const m = mini(), W = cv.clientWidth || innerWidth, H = cv.clientHeight || innerHeight, r = m?.mapRect(true) || { cx: game.player.x, cy: game.player.y, span: 512 }; return { W, H, r, sw: r.span, sh: r.span * (H / W) }; };
  const toWorld = (px, py) => { const { W, H, r, sw, sh } = rect(); return [r.cx - sw / 2 + (px / W) * sw, r.cy - sh / 2 + (py / H) * sh]; };
  function enterMap(span = playSpan() * 1.3) {
    center(game.cam.x, game.cam.y, span);
    S.noRender = true;
    document.body.classList.add('sim-map');
    drawT = 0;
  }
  // into the gameplay view at (x, y): a spectator flies there; someone in a body goes back to it
  function toPlay(x, y) {
    if (S.speed > PLAY_MAX) { game.events.emit('error', { text: `A ${S.speed}x só no mapa: diminua para ${PLAY_MAX}x ou menos` }); return false; }
    const p = game.player;
    if (p.ghost && Number.isFinite(x)) { p.x = game.world.wrap ? game.world.wrapPos(x) : x; p.y = Math.max(1, Math.min(game.world.H - 2, y)); game.cam.x = p.x; game.cam.y = p.y; }
    const c = game.cam; c.zoomK = ZOOM_MIN / game.defaultZoom(); c.zoom = ZOOM_MIN; // (the farthest gameplay zoom: the map zoomed in carries on)
    S.setView('play');
    return true;
  }
  function leaveMap() { S.noRender = false; document.body.classList.remove('sim-map'); }
  game.events.on('sim', (d) => {
    if (d.type === 'view') {
      if (d.view === 'map') { enterMap(); if (d.forced) game.events.emit('toast', { text: `Velocidade acima de ${PLAY_MAX}x: visão do mapa`, kind: 'info' }); }
      else leaveMap();
    }
    if (d.type === 'speed') game.events.emit('toast', { text: `Simulação a ${d.speed}x`, kind: 'info' });
    barKey = '';
  });
  // wheel: zoom around the cursor; past the gameplay's field of view → the gameplay view there
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = mini();
    if (!m) return;
    const k = e.deltaY > 0 ? 1.22 : 1 / 1.22, [wx, wy] = toWorld(...at(e)), r = m.mapRect(true);
    const span = Math.max(playSpan() * 0.9, Math.min(game.world.W, r.span * k));
    if (k < 1 && span < playSpan() * 1.12) { const cx = r.cx + (wx - r.cx) * (1 - k), cy = r.cy + (wy - r.cy) * (1 - k); if (toPlay(cx, cy)) return; center(r.cx, r.cy, playSpan() * 1.12); drawT = 0; return; }
    center(r.cx + (wx - r.cx) * (1 - span / r.span), r.cy + (wy - r.cy) * (1 - span / r.span), span);
    drawT = 0;
  }, { passive: false });
  // drag: pan; double click: the gameplay view there
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; cv.classList.add('drag'); try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const { W, r } = rect(), k = r.span / W;
    center(r.cx - (e.clientX - drag.x) * k, r.cy - (e.clientY - drag.y) * k, r.span);
    drag.x = e.clientX; drag.y = e.clientY;
    drawT = 0;
  });
  const end = () => { drag = null; cv.classList.remove('drag'); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', (e) => { const [x, y] = toWorld(...at(e)); toPlay(x, y); });

  function drawMap() {
    const m = mini();
    if (!m) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth || innerWidth, H = cv.clientHeight || innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game.ui.warLayer) game.ui.warLayer = true; // (the wars on the map: armies, sieges, battles — ui/warMap.js)
    m.draw(ctx, W, H, 0, true);
  }

  // ---------- the bar ----------
  function renderBar() {
    const host = game.net.role !== 'guest', p = game.player, map = S.view === 'map', any = S.who.size;
    const list = map ? SPEEDS : SPEEDS.filter((s) => s <= PLAY_MAX);
    const key = [S.speed, S.view, any, p.ghost ? 1 : 0, S.body?.name || '', host ? 1 : 0, game.env.dayIndex, Math.floor(game.env.hour * 6)].join('|');
    if (key === barKey) return;
    barKey = key;
    const why = (s) => (!host ? 'Só o anfitrião muda a velocidade' : s > PLAY_MAX && any ? `${any} jogador(es) num corpo: no máximo ${PLAY_MAX}x` : '');
    const btns = list.map((s) => `<button data-sp="${s}" class="${s === S.speed ? 'on' : ''}${s > PLAY_MAX ? ' fast' : ''}" ${why(s) ? `disabled title="${esc(why(s))}"` : ''}>${s}x</button>`).join('');
    const who = p.ghost ? `<span class="sb-who">Espectador</span>` : `<span class="sb-who">Você é ${esc(S.body?.full || S.body?.name || '')} · ${esc(S.body?.role || '')} nv ${S.body?.level || p.level}</span><button class="sb-x" data-a="leave">Sair do corpo</button>`;
    const others = any ? `<span class="sb-d">${any} num corpo</span>` : '';
    bar.innerHTML = `<span class="sb-t">SIMULAÇÃO</span><span class="sb-d">${esc(game.env.clockString?.() || '')}</span><span class="sb-sp">${btns}</span>${who}${others}`;
    bar.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => S.setSpeed(+b.dataset.sp)));
    bar.querySelector('[data-a=leave]')?.addEventListener('click', () => S.leave());
  }
  function renderHint() {
    const p = game.player, map = S.view === 'map';
    const t = map ? (S.speed > PLAY_MAX ? `A ${S.speed}x só no mapa · role / arraste para olhar` : 'Role para aproximar até a visão do jogo · arraste para mover · duplo clique: ir para lá')
      : p.ghost ? 'Espectador · WASD voa · clique numa pessoa (morador, guarda, soldado, saqueador) para possuí-la · role para longe: mapa' : '';
    if (t === hintKey) return;
    hintKey = t;
    hint.textContent = t;
    hint.style.display = t ? '' : 'none';
  }

  // the first view: the world map over the start, the kingdoms around it
  enterMap(4200);
  return {
    sync: 'cosmetic',
    update(g, dt) {
      document.body.classList.toggle('sim-ghost', !!g.player.ghost);
      renderBar();
      renderHint();
      if (S.view === 'map') {
        drawT -= dt;
        if (drawT <= 0) { drawT = S.speed > 10 ? 0.1 : 0.08; drawMap(); }
      }
    },
  };
}
