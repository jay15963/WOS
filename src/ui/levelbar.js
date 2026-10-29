// Story selector of build mode (agent L, docs/LEVELS.md): "Andar: Térreo ▲ ▼" while placing, PageUp / PageDown on
// desktop. The chosen story is game.build.mode.lv (building.js passes it to placeReason / build.place); it starts at the
// story the player stands on. Shown only when there is something to build on above the ground (a wall, a stair, an
// upper floor) or the player is up there.

const NAMES = ['Térreo', '1º andar', '2º andar', '3º andar'];
const MAX = 3;

export function installLevelbar(game) {
  const el = document.createElement('div');
  el.id = 'levelbar';
  el.style.cssText = 'position:fixed;right:calc(12px + var(--safe-r, 0px));top:38%;z-index:40;display:none;flex-direction:column;align-items:center;gap:4px;'
    + 'padding:6px 6px 7px;border-radius:12px;background:rgba(22,19,15,.82);border:1px solid rgba(255,220,160,.22);box-shadow:0 4px 14px rgba(0,0,0,.45);'
    + 'font:600 12px/1.15 "Segoe UI",system-ui,sans-serif;color:#f2e6cf;user-select:none;-webkit-user-select:none;pointer-events:auto;touch-action:manipulation';
  const btn = (txt, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = txt; b.title = title;
    b.style.cssText = 'width:40px;height:34px;border-radius:9px;border:1px solid rgba(255,220,160,.3);background:rgba(255,236,200,.08);color:#ffe2a8;font:700 16px/1 system-ui;cursor:pointer';
    return b;
  };
  const up = btn('▲', 'Subir um andar (PageUp)'), down = btn('▼', 'Descer um andar (PageDown)');
  const cap = document.createElement('div');
  cap.style.cssText = 'font-size:10px;opacity:.7;letter-spacing:.04em;text-transform:uppercase';
  cap.textContent = 'Andar';
  const lab = document.createElement('div');
  lab.style.cssText = 'min-width:58px;text-align:center;padding:2px 0;color:#ffe9bf';
  el.append(cap, up, lab, down);
  document.body.appendChild(el);

  let lastMode = null, shown = false;
  const mode = () => { const m = game.build.mode; return m && m.kind === 'place' && !BUILD_ROOF(game, m.type) ? m : null; };
  const set = (m, lv) => {
    const v = Math.max(0, Math.min(MAX, lv | 0));
    if (m.lv === v) return;
    m.lv = v; // sync-ok: local build-mode choice (the intent carries it)
    game.audio?.play('ui_click', {});
    game.events.emit('buildui', {});
  };
  const step = (d) => { const m = mode(); if (m) set(m, (m.lv | 0) + d); };
  for (const [b, d] of [[up, 1], [down, -1]]) b.addEventListener('click', (e) => { e.stopPropagation(); step(d); });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());

  return {
    update() {
      const m = mode(), p = game.player, L = game.levels;
      if (m && m !== lastMode) { lastMode = m; if (m.lv == null) m.lv = m.move ? m.move.lv | 0 : Math.max(0, Math.min(MAX, Math.round(p.z || 0))); } // sync-ok: local build-mode choice
      if (!m) lastMode = null;
      const want = !!m && !m.move && (L?.hasTops || L?.hasUpper || (p.z || 0) > 0 || (m.lv | 0) > 0);
      if (want !== shown) { shown = want; el.style.display = want ? 'flex' : 'none'; }
      if (!want) return;
      const K = game.input?.pressed;
      if (K?.has('PageUp')) step(1);
      if (K?.has('PageDown')) step(-1);
      lab.textContent = NAMES[m.lv | 0] || NAMES[0];
      up.disabled = (m.lv | 0) >= MAX; down.disabled = (m.lv | 0) <= 0;
      up.style.opacity = up.disabled ? 0.35 : 1; down.style.opacity = down.disabled ? 0.35 : 1;
    },
  };
}

// roofs always sit on top of the building (their height comes from the stories under them)
const BUILD_ROOF = (game, type) => !!game.build && !!(typeof type === 'string' && type.startsWith('roof_'));
