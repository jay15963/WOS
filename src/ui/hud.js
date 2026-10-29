// DOM HUD (#hud): unit frames (XP, hunger, body heat, °C inside the player card), action bar (thumb arc
// on touch / compact row on desktop), desktop hotbar (hotbar.js), interact button, quick buttons, minimap
// + clock/weather, buffs + job chip, error/feed/banner, build bar, death screen, fullscreen / install /
// help buttons. Updates the DOM only when values change.

import { BUILDINGS, ITEMS, SPECIES, WEATHER_PT, DOTS } from '../game/data.js';
import { xpToNext, levelColor, MAX_LEVEL } from '../game/stats.js';
import { eatBest } from '../game/survival.js';
import { confirmPlace, exitBuildMode } from '../game/building.js';
import { respawnPlayer, respawnPoint } from '../game/player.js';
import { attackable } from '../game/combat.js';
import { uiIcon, svgIcon, itemIcon, buildIcon, spriteURL } from './icons.js';
import { combatIcon } from './combaticons.js';
import { installActionBar } from './actionbar.js';
import { Minimap } from './minimap.js';
import { Panels } from './panels.js';
import { econIcon } from './econIcons.js';
import { foodCount, heatState } from '../game/survival.js';
import { KEYS, keyLabel } from '../game/controller.js';
import { installHotbar } from './hotbar.js';
import { installTooltips } from './tooltip.js';
import { installHelp } from './help.js';
import { openContainer } from './container.js';
import { isStandalone, canFullscreen, toggleFullscreen, fullscreenElement, onFullscreenChange, openInstallGuide } from './pwa.js';

const TEMPER_PT = { hostile: 'Hostil', neutral: 'Neutro', passive: 'Passivo' };
const STATE_PT = { flee: 'em fuga', evade: 'evadindo', chase: 'em combate' };
// target frame extras (portraits for raiders / crates, debuffs, enemy cast bar)
const TF_CSS = `
.tf .tcast { position: relative; height: 9px; margin-top: 1px; background: rgba(0,0,0,.6); border: 1px solid rgba(0,0,0,.8); border-radius: 2px; overflow: hidden; }
.tf .tcast > i { position: absolute; inset: 0; transform-origin: 0 50%; background: linear-gradient(180deg, #ffe08a, #d9a83a 55%, #9a6e1c); }
.tf .tcast > span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 8px; font-weight: 800; text-shadow: 0 1px 1px #000; }
.tf .tdb { display: flex; gap: 3px; min-height: 0; }
.tf .tdb:empty { display: none; }
.tf .tdb > b { width: 16px; height: 16px; padding: 2px; border-radius: 3px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,90,72,.65); color: #ffb0a0; position: relative; }
.tf .tdb > b.poison { border-color: rgba(120,220,90,.75); color: #b8f0a0; }
.tf .tdb > b.burn { border-color: rgba(255,160,60,.8); color: #ffd090; }
.tf.bandit .port { background: radial-gradient(circle at 35% 30%, #6a3a30, #2a1612 70%); }
.tf .port .ini.pawn { color: #ffb4a0; }
.tf.prop .port { background: radial-gradient(circle at 35% 30%, #6a5a40, #2a2418 70%); }
`;

// instant buttons (game actions): fire on pointerdown for responsiveness
function press(el, fn) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    el.classList.add('down');
    fn(e);
  });
  const up = () => el.classList.remove('down');
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
// buttons that need a user activation (fullscreen, install prompt): a touch pointerdown is NOT one,
// so they run on click; pointerdown only shows the pressed state and keeps the tap off the world
function tap(el, fn) {
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.classList.add('down'); });
  const up = () => el.classList.remove('down');
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); up(); fn(e); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function installHUD(game, { isNew } = {}) {
  const A = game.A;
  const root = document.getElementById('hud');
  const p = game.player;
  root.innerHTML = `
    <div class="tl">
      <div class="tl-top">
        <div class="uf pf" id="pf">
          <div class="port"><span class="ini">S</span><span class="lv" id="pf-lv">1</span></div>
          <div class="ufb">
            <div class="ufn"><span class="nm" id="pf-nm"></span><span class="cmb" id="pf-cmb">${svgIcon('attack')}</span><span class="tmp" id="pf-tmp"></span></div>
            <div class="bar hp" id="pf-hp"><i></i><b></b></div>
            <div class="bar en" id="pf-en"><i></i><b></b></div>
            <div class="bars2">
              <div class="bar hu" id="pf-hu" data-tip="<b>Fome</b><p>Coma antes de esvaziar: abaixo de 25% você fica fraco e sem comida perde vida.</p>"><i></i><b></b></div>
              <div class="bar wm" id="pf-wm" data-tip="<b>Calor do corpo</b><p>Cai no frio (noite, chuva, vento, montanha). Fogueira, abrigo fechado, roupas e comida quente aquecem.</p>"><i></i><b></b></div>
            </div>
            <div class="bar xpb" id="pf-xp" data-tip="<b>Experiência</b><p>Ganhe XP coletando, construindo, criando e lutando.</p>"><i></i><b></b></div>
          </div>
        </div>
        <div class="uf tf hidden" id="tf">
          <div class="port"><span class="ini" id="tf-ini"></span><img id="tf-img" alt="" draggable="false"><span class="lv" id="tf-lv"></span></div>
          <div class="ufb">
            <div class="ufn"><span class="nm" id="tf-nm"></span></div>
            <div class="bar hp" id="tf-hp"><i></i><b></b></div>
            <div class="tsub" id="tf-sub"></div>
            <div class="tcast hidden" id="tf-cast"><i></i><span></span></div>
            <div class="tdb" id="tf-db"></div>
          </div>
          <button class="tf-x" id="tf-x" aria-label="Limpar alvo">${svgIcon('close')}</button>
        </div>
      </div>
      <div class="tl-bot">
        <div class="quick" id="quick">
          <button class="qb" data-q="inv" data-tip="<b>Mochila e equipamento</b><span class='key'>I</span>">${uiIcon(A, 'bag')}<span class="qk">I</span></button>
          <button class="qb" data-q="craft" data-tip="<b>Criar itens</b><span class='key'>C</span>">${econIcon(A, 'craft')}<span class="qk">C</span></button>
          <button class="qb" data-q="build" data-tip="<b>Construir</b><span class='key'>B</span>">${uiIcon(A, 'build')}<span class="qk">B</span></button>
          <button class="qb" data-q="mine" data-tip="<b>Marcar rochas para minerar</b><span class='key'>X</span>">${econIcon(A, 'mine')}<span class="qk">X</span></button>
          <button class="qb qb-map" data-q="map" data-tip="<b>Mapa</b><span class='key'>M</span>">${svgIcon('map')}<span class="qk">M</span></button>
          <button class="qb" data-q="eat" data-tip="<b>Comer a melhor comida</b><span class='key'>${keyLabel(KEYS.eat[0])}</span>">${uiIcon(A, 'eat')}<span class="qk">${keyLabel(KEYS.eat[0])}</span><span class="badge" id="eat-n"></span></button>
        </div>
        <div class="status" id="status"><div class="buffs" id="buffs"></div></div>
      </div>
    </div>
    <div class="tr">
      <div class="sys">
        <button class="sb" id="btn-full" data-tip="<b>Tela cheia</b>">${svgIcon('full')}</button>
        <button class="sb hidden" id="btn-install" data-tip="<b>Instalar o jogo</b><p>Tela cheia de verdade e ícone na tela inicial.</p>">${svgIcon('install')}</button>
        <button class="sb" id="btn-help" data-tip="<b>Atalhos e controles</b><span class='key'>H</span>"><span class="qm">?</span></button>
      </div>
      <div class="mmwrap">
        <div class="mm" id="mm" data-tip="<b>Mapa</b><span class='key'>M</span>"><canvas></canvas></div>
        <div class="mm-info"><span id="clock"></span><span id="weather"></span></div>
      </div>
    </div>
    <div class="errs" id="errs"></div>
    <div class="banner" id="banner"></div>
    <div class="feed" id="feed"></div>
    <div class="ab-wrap" id="ab">
      <button class="ab ab-int hidden" id="ab-int"><span class="ic"></span><span class="lbl"></span><span class="key">E</span></button>
    </div>
    <div class="buildbar hidden" id="buildbar">
      <span class="bb-ic" id="bb-ic"></span>
      <span class="bb-tx"><b id="bb-nm"></b><small id="bb-hint"></small></span>
      <button class="bb-b ok" id="bb-ok" title="Construir">${svgIcon('check')}</button>
      <button class="bb-b no" id="bb-no" title="Cancelar (Esc)">${svgIcon('close')}</button>
    </div>
    <div class="panels" id="panels"></div>
    <div class="death hidden" id="death">
      <div class="dbox">
        <div class="dt">Você morreu</div>
        <div class="ds" id="death-sub"></div>
        <button class="btn primary" id="btn-respawn">Renascer</button>
      </div>
    </div>
    <div class="fade" id="fade"></div>
  `;
  const $ = (s) => root.querySelector(s);
  if (!document.getElementById('tf-style')) { const st = document.createElement('style'); st.id = 'tf-style'; st.textContent = TF_CSS; document.head.appendChild(st); }
  const panels = new Panels(game, $('#panels'));
  game.ui.panels = panels;
  game.ui.openContainer = (adapter) => openContainer(game, adapter); // container window (container.js contract)
  // the job chip (pending blueprints / mining) lives in the status row under the card, never over buttons
  const chip = root.querySelector('.jobchip');
  if (chip) $('#status').appendChild(chip);

  // ---------- layout mode ----------
  let touchMode = null;
  const force = new URLSearchParams(location.search).get('touch'); // dev: ?touch=1 / ?touch=0
  const coarse = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
  const setMode = () => {
    const t = force != null ? force === '1' : !!(game.input.isTouch || coarse);
    if (t === touchMode) return;
    touchMode = t;
    root.classList.toggle('touch', t);
    root.classList.toggle('desktop', !t);
    bar?.setMode(t);
  };
  let bar = null;
  setMode();
  bar = installActionBar(game, root, $('#ab'));
  bar.setMode(touchMode);

  // ---------- refs ----------
  const R = {
    pfNm: $('#pf-nm'), pfLv: $('#pf-lv'), pfCmb: $('#pf-cmb'), pf: $('#pf'),
    hp: $('#pf-hp'), en: $('#pf-en'), hu: $('#pf-hu'),
    tf: $('#tf'), tfNm: $('#tf-nm'), tfLv: $('#tf-lv'), tfHp: $('#tf-hp'), tfSub: $('#tf-sub'), tfIni: $('#tf-ini'), tfImg: $('#tf-img'),
    tfCast: $('#tf-cast'), tfCastI: $('#tf-cast i'), tfCastS: $('#tf-cast span'), tfDb: $('#tf-db'),
    buffs: $('#buffs'), eatN: $('#eat-n'), clock: $('#clock'), weather: $('#weather'),
    xp: $('#pf-xp'), wm: $('#pf-wm'), tmp: $('#pf-tmp'),
    errs: $('#errs'), feed: $('#feed'), banner: $('#banner'),
    int: $('#ab-int'), intIc: $('#ab-int .ic'), intLbl: $('#ab-int .lbl'),
    bb: $('#buildbar'), bbNm: $('#bb-nm'), bbHint: $('#bb-hint'), bbIc: $('#bb-ic'), bbOk: $('#bb-ok'),
    death: $('#death'), deathSub: $('#death-sub'), respawn: $('#btn-respawn'), fade: $('#fade'),
    mm: $('#mm'), mmC: $('#mm canvas'),
  };
  // ---------- input bindings ----------
  press(R.int, () => game.ctl.interact());
  press($('#tf-x'), () => { game.ctl.setTarget(null); game.ctl.goal = null; });
  root.querySelectorAll('.qb').forEach((el) => press(el, () => {
    const q = el.dataset.q;
    game.audio?.play('ui_click', {});
    if (q === 'eat') eatBest(game);
    else panels.toggle(q);
  }));
  tap($('#btn-help'), () => game.events.emit('help', {}));
  press(R.mm, () => panels.toggle('map'));
  press(R.bbOk, () => confirmPlace(game));
  press($('#bb-no'), () => exitBuildMode(game));
  R.respawn.addEventListener('click', () => {
    if (R.respawn.disabled || !game.player.dead) return;
    R.respawn.blur();
    respawnPlayer(game);
  });

  // fullscreen (click = user activation; iPhone has no element fullscreen → the install guide instead:
  // an installed PWA already runs full screen)
  const fullBtn = $('#btn-full');
  const fsIcon = () => { fullBtn.innerHTML = svgIcon(fullscreenElement() ? 'unfull' : 'full'); };
  if (isStandalone() && !canFullscreen()) fullBtn.classList.add('hidden');
  tap(fullBtn, async () => {
    game.audio?.play('ui_click', {});
    if (!canFullscreen()) { openInstallGuide({ title: 'Tela cheia' }); return; }
    try { await toggleFullscreen(); } catch { game.events.emit('error', { text: 'Tela cheia indisponível' }); }
    fsIcon();
  });
  onFullscreenChange(fsIcon);

  // install (PWA): any context that is not the installed app — iOS never fires beforeinstallprompt
  const instBtn = $('#btn-install');
  const showInstall = () => instBtn.classList.toggle('hidden', isStandalone());
  document.addEventListener('wos-installable', showInstall);
  tap(instBtn, () => { game.audio?.play('ui_click', {}); openInstallGuide({ title: 'Instalar o jogo' }); });
  showInstall();

  // desktop: hotbar (1–0), rich tooltips, shortcuts overlay (H / F1)
  const hotbar = installHotbar(game, root);
  installTooltips(game);
  installHelp(game);

  // ---------- minimap ----------
  const mini = new Minimap(game);
  game.ui.minimap = mini;
  const mctx = R.mmC.getContext('2d');
  let mmT = 0;
  game.events.on('tile', (d) => mini.updateTiles(d.tx, d.ty));

  // ---------- messages ----------
  const errs = [];
  const showError = (text) => {
    const now = performance.now();
    const same = errs.find((e) => e.text === text);
    if (same) { same.t = now; same.el.classList.remove('out'); same.el.style.animation = 'none'; void same.el.offsetWidth; same.el.style.animation = ''; return; }
    const el = document.createElement('div');
    el.className = 'err';
    el.textContent = text;
    R.errs.appendChild(el);
    errs.push({ text, el, t: now });
    while (errs.length > 2) errs.shift().el.remove();
  };
  const feed = [];
  const pushFeed = (key, html, kind = 'info', qty = 0) => {
    const now = performance.now();
    const ex = key && feed.find((f) => f.key === key && now - f.t < 2500);
    if (ex) {
      ex.qty += qty; ex.t = now; ex.n = (ex.n || 1) + 1;
      const qel = ex.el.querySelector('.q');
      if (qel) qel.textContent = `+${ex.qty}`;
      else { let m = ex.el.querySelector('.x'); if (!m) { m = document.createElement('span'); m.className = 'x'; ex.el.appendChild(m); } m.textContent = `×${ex.n}`; }
      ex.el.classList.remove('bump'); void ex.el.offsetWidth; ex.el.classList.add('bump');
      return;
    }
    const el = document.createElement('div');
    el.className = 'fi ' + kind;
    el.innerHTML = html;
    R.feed.appendChild(el);
    feed.push({ key, el, t: now, qty });
    while (feed.length > (touchMode ? 4 : 5)) feed.shift().el.remove();
  };
  const banner = (big, small) => {
    R.banner.innerHTML = `<div class="b1">${big}</div><div class="b2">${small}</div>`;
    R.banner.classList.remove('show'); void R.banner.offsetWidth; R.banner.classList.add('show');
  };

  const ev = game.events;
  ev.on('error', (d) => { showError(d.text); game.audio?.play('ui', { volume: 0.2 }); });
  ev.on('toast', (d) => pushFeed('t:' + d.text, `<span class="t">${d.text}</span>`, d.kind || 'info'));
  ev.on('loot', (d) => {
    const def = ITEMS[d.item];
    pushFeed('loot:' + d.item, `<span class="li">${itemIcon(A, d.item)}</span><span class="q">+${d.qty}</span><span class="t">${def?.name || d.item}</span>`, 'loot', d.qty);
  });
  ev.on('levelup', (d) => {
    banner(`Nível ${d.level}`, 'Vida e dano aumentaram');
    pushFeed(null, `<span class="t">Você alcançou o nível ${d.level}!</span>`, 'good');
  });
  ev.on('kill', (d) => { if (d.target === game.player.target) dirty.target = true; });
  ev.on('target', () => { dirty.target = true; });
  ev.on('inventory', () => { dirty.inv = true; });
  ev.on('buildmode', (d) => {
    R.bb.classList.toggle('hidden', !d.type);
    if (d.type) {
      const def = BUILDINGS[d.type];
      R.bbNm.textContent = def.name;
      R.bbIc.innerHTML = buildIcon(A, d.type);
      R.bbHint.textContent = touchMode ? 'Toque no local e confirme' : 'Clique para construir · Esc cancela';
    }
  });
  let deathT = -1;
  ev.on('death', () => { deathT = 0; R.respawn.disabled = true; });
  ev.on('respawn', (d) => {
    deathT = -1;
    R.death.classList.add('hidden');
    R.fade.classList.remove('on');
    pushFeed(null, `<span class="t">Você renasceu (${d.where}). Fraqueza por 60 s.</span>`, 'warn');
  });
  ev.on('sleep', () => {
    R.fade.classList.add('on');
    setTimeout(() => R.fade.classList.remove('on'), 1500);
  });

  // ---------- intro tips ----------
  if (isNew) {
    const tips = [
      [1.2, 'Bem-vindo, Sobrevivente!', 'good'],
      [4, game.input.isTouch ? 'Arraste à esquerda para andar · toque nas coisas perto de você para usar · pinça = zoom' : 'WASD para andar · E interage · 1–0 barra de itens · H mostra os atalhos', 'info'],
      [7, 'Você está de mãos vazias: soque com cuidado e fuja de lobos', 'warn'],
      [9, game.input.isTouch ? 'Toque em Criar para fazer faca, machado e picareta' : 'Criar (C): faça faca, machado e picareta primitivos', 'info'],
      [14, 'A noite é fria: faça uma fogueira, um abrigo fechado ou roupas antes de escurecer', 'warn'],
    ];
    for (const [t, text, kind] of tips) game.later(t, () => ev.emit('toast', { text, kind }));
  } else {
    game.later(0.8, () => ev.emit('toast', { text: 'Progresso carregado', kind: 'info' }));
  }

  // ---------- per-frame diffed updates ----------
  const dirty = { target: true, inv: true };
  const C = {}; // cached last-written values
  const setText = (el, k, v) => { if (C[k] !== v) { C[k] = v; el.textContent = v; } };
  const setBar = (bar, k, frac, text) => {
    const f = Math.max(0, Math.min(1, frac));
    const q = Math.round(f * 500) / 500;
    if (C[k] !== q) { C[k] = q; bar.firstElementChild.style.transform = `scaleX(${q})`; }
    if (text != null && C[k + 't'] !== text) { C[k + 't'] = text; bar.lastElementChild.textContent = text; }
  };
  const toggle = (el, k, cls, on) => { if (C[k] !== on) { C[k] = on; el.classList.toggle(cls, on); } };

  let slowT = 0, buffV = -1, buffT = 0, modeT = 0;

  return {
    sync: 'cosmetic', // HUD
    update(g, dt) {
      modeT -= dt;
      if (modeT <= 0) { modeT = 1; setMode(); }
      const pl = g.player;

      // player frame
      setText(R.pfNm, 'pfnm', pl.name);
      setText(R.pfLv, 'pflv', String(pl.level));
      setBar(R.hp, 'hp', pl.hp / pl.maxHp, `${Math.ceil(pl.hp)} / ${pl.maxHp}`);
      setBar(R.en, 'en', pl.energy / pl.maxEnergy, `${Math.floor(pl.energy)}`);
      setBar(R.hu, 'hu', pl.hunger / pl.maxHunger, `Fome ${Math.ceil(pl.hunger)}%`);
      const heat = pl.bodyHeat ?? 100;
      setBar(R.wm, 'wm', heat / 100, `Calor ${Math.ceil(heat)}%`);
      toggle(R.wm, 'wmlow', 'low', heat < 30);
      toggle(R.pf, 'pfc', 'combat', !!pl.inCombat);
      toggle(R.hp, 'hplow', 'low', pl.hp / pl.maxHp < 0.3 && !pl.dead);
      toggle(R.hu, 'hulow', 'low', pl.hunger < 25);

      // target frame
      const t = pl.target;
      if (dirty.target) {
        dirty.target = false;
        R.tf.classList.toggle('hidden', !t);
        if (t) {
          const temper = t.temper || SPECIES[t.species]?.temper || 'neutral';
          R.tfNm.textContent = t.name + (t.elite ? ' (Elite)' : '');
          R.tf.className = `uf tf ${temper}${t.elite ? ' elite' : ''}${t.faction === 'bandit' ? ' bandit' : ''}${t.isProp ? ' prop' : ''}`;
          const url = t.isProp ? spriteURL(A, t.type, 64) || spriteURL(A, 'chest', 64)
            : t.kind === 'pawn' ? null
            : spriteURL(A, t.species + '_e', 64) || spriteURL(A, 'wolf_e', 64);
          R.tfIni.classList.toggle('pawn', t.kind === 'pawn');
          if (url) { R.tfImg.src = url; R.tfImg.style.display = ''; R.tfIni.textContent = ''; }
          else { R.tfImg.style.display = 'none'; R.tfIni.textContent = t.name[0]; }
          C.tfhp = C.tfhpt = C.tfsub = C.tflv = C.tfdb = C.tfcast = null;
        }
      }
      if (t) {
        const gone = t.dead || t.broken;
        setBar(R.tfHp, 'tfhp', gone ? 0 : t.hp / t.maxHp, t.isProp ? (gone ? 'Quebrado' : `${Math.ceil(t.hp)} / ${t.maxHp}`) : t.dead ? 'Morto' : `${Math.ceil(t.hp)} / ${t.maxHp}`);
        const lvTxt = t.isProp ? '–' : String(t.level);
        if (C.tflv !== lvTxt + pl.level) { C.tflv = lvTxt + pl.level; R.tfLv.textContent = lvTxt; R.tfLv.style.color = t.isProp ? '' : levelColor(t.level, pl.level); }
        const st = t.dead ? 'morto' : t.stunT > 0 ? 'atordoado' : t.fearT > 0 ? 'assustado' : t.blocking ? 'bloqueando' : STATE_PT[t.state] || '';
        const kind = t.isProp ? 'Objeto · quebre para saquear' : t.faction === 'bandit' ? 'Saqueadores' : TEMPER_PT[t.temper || SPECIES[t.species]?.temper] || '';
        setText(R.tfSub, 'tfsub', kind + (st ? ' · ' + st : ''));
        // enemy cast bar (raider telegraphs: interrupt with Shield Bash / Shove / stuns)
        const ct = t.cast && !gone ? t.cast : null;
        toggle(R.tfCast, 'tfcast', 'hidden', !ct);
        if (ct) {
          R.tfCastI.style.transform = `scaleX(${Math.min(1, ct.t / ct.dur).toFixed(3)})`;
          setText(R.tfCastS, 'tfcasts', ct.name);
        }
        // debuffs (bleed / poison / burn)
        const db = gone || !t.dots?.length ? '' : t.dots.map((d) => d.id).join(',');
        if (C.tfdb !== db) {
          C.tfdb = db;
          R.tfDb.innerHTML = db ? t.dots.map((d) => `<b class="${d.id}" title="${DOTS[d.id]?.name || d.id}">${combatIcon(A, d.id === 'burn' ? 'fire' : d.id)}</b>`).join('') : '';
        }
      }

      // action bar (dynamic, see actionbar.js)
      const dead = pl.dead;
      toggle(root, 'dead', 'is-dead', !!dead);
      bar.update(g, dt);

      // interact button
      const near = g.ctl.near;
      const showInt = !!near && !pl.work && !dead && !g.build.mode && !(pl.autoAttack && attackable(pl.target));
      toggle(R.int, 'intv', 'hidden', !showInt);
      if (showInt) {
        const key = near.verb + near.icon;
        // doors / gates: the icon shows what the action does (open → ajar door, close → shut door)
        const ic = near.kind === 'door' ? (near.verb === 'Fechar' ? 'door_close' : 'door_open') : near.icon;
        if (C.intk !== key) { C.intk = key; R.intLbl.textContent = near.verb; R.intIc.innerHTML = uiIcon(A, ic); }
      }

      // build bar validity
      if (g.build.mode) toggle(R.bbOk, 'bbok', 'bad', !g.build.mode.valid);

      // buffs (structure on change, timers at 4 Hz)
      buffT -= dt;
      if (buffV !== pl.buffsV) {
        buffV = pl.buffsV;
        R.buffs.innerHTML = pl.buffs.map((b) => `<div class="bf ${b.good ? 'good' : 'bad'}" title="${b.name}${b.desc ? ' — ' + b.desc : ''}">${combatIcon(A, b.icon)}<span class="bt"></span></div>`).join('');
        buffT = 0;
      }
      if (buffT <= 0) {
        buffT = 0.25;
        const els = R.buffs.children;
        pl.buffs.forEach((b, i) => { const el = els[i]?.lastElementChild; if (el) { const v = b.perm ? '' : b.t >= 60 ? Math.ceil(b.t / 60) + 'm' : Math.ceil(b.t) + ''; if (el.textContent !== v) el.textContent = v; } });
      }

      // xp (inside the player card)
      hotbar.update(dt);
      const need = xpToNext(pl.level);
      const max = pl.level >= MAX_LEVEL;
      setBar(R.xp, 'xp', max ? 1 : pl.xp / need, max ? `Nível ${pl.level} · máximo` : `Nível ${pl.level} · ${Math.floor(pl.xp)} / ${need} XP`);

      // slow stuff (4 Hz): clock, weather, food badge, messages expiry
      slowT -= dt;
      if (slowT <= 0) {
        slowT = 0.25;
        setText(R.clock, 'clock', g.env.clockString());
        const [wn, wi] = WEATHER_PT[g.env.weather] || ['', ''];
        const h = g.env.hour, night = h >= 19.5 || h < 5.5;
        setText(R.weather, 'wx', `${night && g.env.weather === 'clear' ? '☾' : wi} ${night && g.env.weather === 'clear' ? 'Noite' : wn}`);
        const hs = heatState(pl);
        if (C.tmp !== hs.key) {
          C.tmp = hs.key;
          R.tmp.textContent = hs.text;
          R.tmp.className = 'tmp ' + hs.cls;
          R.tmp.dataset.tip = `<b>Sensação térmica: ${hs.text}</b><p>${hs.why}</p>`;
        }
        const food = foodCount(pl);
        setText(R.eatN, 'eatn', food ? String(food) : '');
        toggle(R.eatN, 'eatnh', 'hidden', !food);
        const now = performance.now();
        for (let i = errs.length - 1; i >= 0; i--) if (now - errs[i].t > 1800) { const e = errs.splice(i, 1)[0]; e.el.classList.add('out'); setTimeout(() => e.el.remove(), 300); }
        for (let i = feed.length - 1; i >= 0; i--) if (now - feed[i].t > 3800) { const f = feed.splice(i, 1)[0]; f.el.classList.add('out'); setTimeout(() => f.el.remove(), 400); }
        if (dirty.inv) { dirty.inv = false; panels.refresh(); }
      }

      // minimap (10 Hz)
      mmT -= dt;
      if (mmT <= 0) {
        mmT = 0.1;
        const dpr = Math.min(2, devicePixelRatio || 1);
        const cw = R.mm.clientWidth, ch = R.mm.clientHeight;
        if (R.mmC.width !== Math.round(cw * dpr)) { R.mmC.width = Math.round(cw * dpr); R.mmC.height = Math.round(ch * dpr); }
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mini.draw(mctx, cw, ch, 56);
      }
      panels.update(dt);

      // death
      if (deathT >= 0) {
        deathT += dt;
        if (deathT > 0.8 && R.death.classList.contains('hidden')) {
          R.death.classList.remove('hidden');
          R.fade.classList.add('on', 'death');
          const wh = respawnPoint(g).where;
          R.deathSub.textContent = `Você renascerá ${wh === 'ponto de partida' ? 'no' : 'na'} ${wh}.`;
          panels.close();
          exitBuildMode(g);
        }
        if (deathT > 2.6 && R.respawn.disabled) R.respawn.disabled = false;
      }
    },
  };
}
