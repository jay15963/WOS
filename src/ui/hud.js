// DOM HUD (#hud): unit frames, action bar (thumb arc on touch / WoW row on desktop), interact
// button, quick buttons, minimap + clock/weather, XP bar, buffs, error/feed/banner, build bar,
// death screen, fullscreen / install. Updates the DOM only when values change.

import { ABILITIES, ABILITY_ORDER, BUILDINGS, ITEMS, SPECIES, WEATHER_PT } from '../game/data.js';
import { xpToNext, levelColor, MAX_LEVEL } from '../game/stats.js';
import { abilityState, useAbility } from '../game/abilities.js';
import { eatBest } from '../game/survival.js';
import { confirmPlace, exitBuildMode } from '../game/building.js';
import { respawnPlayer, respawnPoint } from '../game/player.js';
import { attackable } from '../game/combat.js';
import { uiIcon, svgIcon, itemIcon, buildIcon, spriteURL } from './icons.js';
import { Minimap } from './minimap.js';
import { Panels } from './panels.js';

let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.dispatchEvent(new Event('wos-installable'));
});

const TEMPER_PT = { hostile: 'Hostil', neutral: 'Neutro', passive: 'Passivo' };
const STATE_PT = { flee: 'em fuga', evade: 'evadindo', chase: 'em combate' };

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

export function installHUD(game, { isNew } = {}) {
  const A = game.A;
  const root = document.getElementById('hud');
  const p = game.player;
  root.innerHTML = `
    <div class="tl">
      <div class="uf pf" id="pf">
        <div class="port"><span class="ini">S</span><span class="lv" id="pf-lv">1</span></div>
        <div class="ufb">
          <div class="ufn"><span class="nm" id="pf-nm"></span><span class="cmb" id="pf-cmb">${svgIcon('attack')}</span></div>
          <div class="bar hp" id="pf-hp"><i></i><b></b></div>
          <div class="bar en" id="pf-en"><i></i><b></b></div>
          <div class="bar hu" id="pf-hu"><i></i><b></b></div>
        </div>
      </div>
      <div class="uf tf hidden" id="tf">
        <div class="port"><span class="ini" id="tf-ini"></span><img id="tf-img" alt="" draggable="false"><span class="lv" id="tf-lv"></span></div>
        <div class="ufb">
          <div class="ufn"><span class="nm" id="tf-nm"></span></div>
          <div class="bar hp" id="tf-hp"><i></i><b></b></div>
          <div class="tsub" id="tf-sub"></div>
        </div>
        <button class="tf-x" id="tf-x" aria-label="Limpar alvo">${svgIcon('close')}</button>
      </div>
    </div>
    <div class="buffs" id="buffs"></div>
    <div class="quick" id="quick">
      <button class="qb" data-q="inv" title="Mochila (I)">${uiIcon(A, 'bag')}<span class="qk">I</span></button>
      <button class="qb" data-q="build" title="Construir (B)">${uiIcon(A, 'build')}<span class="qk">B</span></button>
      <button class="qb" data-q="eat" title="Comer (Q)">${uiIcon(A, 'eat')}<span class="qk">Q</span><span class="badge" id="eat-n"></span></button>
    </div>
    <div class="tr">
      <div class="sys">
        <button class="sb" id="btn-full" title="Tela cheia">${svgIcon('full')}</button>
        <button class="sb hidden" id="btn-install" title="Instalar app">${svgIcon('install')}</button>
      </div>
      <div class="mmwrap">
        <div class="mm" id="mm" title="Mapa (M)"><canvas></canvas></div>
        <div class="mm-info"><span id="clock"></span><span id="weather"></span></div>
      </div>
    </div>
    <div class="errs" id="errs"></div>
    <div class="banner" id="banner"></div>
    <div class="feed" id="feed"></div>
    <div class="ab-wrap" id="ab">
      <button class="ab ab-int hidden" id="ab-int"><span class="ic"></span><span class="lbl"></span><span class="key">E</span></button>
      <button class="ab ab-atk" data-ab="attack" title="Atacar (F)"><span class="ic">${uiIcon(A, 'attack')}</span><span class="key">F</span></button>
      ${ABILITY_ORDER.map((id, i) => {
        const ab = ABILITIES[id];
        return `<button class="ab ab-s ab-${i + 1}" data-ab="${id}" title="${ab.name} (${ab.key}) — ${ab.desc} Custo: ${ab.cost} energia, recarga ${ab.cd}s">
          <span class="ic">${uiIcon(A, ab.icon)}</span><span class="cd"></span><span class="cdt"></span>
          <span class="key">${ab.key}</span><span class="cost">${ab.cost}</span><span class="abn">${ab.name}</span></button>`;
      }).join('')}
    </div>
    <div class="buildbar hidden" id="buildbar">
      <span class="bb-ic" id="bb-ic"></span>
      <span class="bb-tx"><b id="bb-nm"></b><small id="bb-hint"></small></span>
      <button class="bb-b ok" id="bb-ok" title="Construir">${svgIcon('check')}</button>
      <button class="bb-b no" id="bb-no" title="Cancelar (Esc)">${svgIcon('close')}</button>
    </div>
    <div class="xp" id="xp"><i></i><span></span></div>
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
  const panels = new Panels(game, $('#panels'));
  game.ui.panels = panels;

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
  };
  setMode();

  // ---------- refs ----------
  const R = {
    pfNm: $('#pf-nm'), pfLv: $('#pf-lv'), pfCmb: $('#pf-cmb'), pf: $('#pf'),
    hp: $('#pf-hp'), en: $('#pf-en'), hu: $('#pf-hu'),
    tf: $('#tf'), tfNm: $('#tf-nm'), tfLv: $('#tf-lv'), tfHp: $('#tf-hp'), tfSub: $('#tf-sub'), tfIni: $('#tf-ini'), tfImg: $('#tf-img'),
    buffs: $('#buffs'), eatN: $('#eat-n'), clock: $('#clock'), weather: $('#weather'),
    xp: $('#xp'), xpI: $('#xp i'), xpS: $('#xp span'),
    errs: $('#errs'), feed: $('#feed'), banner: $('#banner'),
    int: $('#ab-int'), intIc: $('#ab-int .ic'), intLbl: $('#ab-int .lbl'),
    atk: root.querySelector('[data-ab="attack"]'),
    bb: $('#buildbar'), bbNm: $('#bb-nm'), bbHint: $('#bb-hint'), bbIc: $('#bb-ic'), bbOk: $('#bb-ok'),
    death: $('#death'), deathSub: $('#death-sub'), respawn: $('#btn-respawn'), fade: $('#fade'),
    mm: $('#mm'), mmC: $('#mm canvas'),
  };
  const abBtns = ABILITY_ORDER.map((id) => {
    const el = root.querySelector(`[data-ab="${id}"]`);
    return { id, el, cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), last: {} };
  });

  // ---------- input bindings ----------
  for (const b of abBtns) press(b.el, () => useAbility(game, b.id));
  press(R.atk, () => game.ctl.toggleAttack());
  press(R.int, () => game.ctl.interact());
  press($('#tf-x'), () => { game.ctl.setTarget(null); game.ctl.goal = null; });
  root.querySelectorAll('.qb').forEach((el) => press(el, () => {
    const q = el.dataset.q;
    game.audio?.play('ui', {});
    if (q === 'eat') eatBest(game);
    else panels.toggle(q);
  }));
  press(R.mm, () => panels.toggle('map'));
  press(R.bbOk, () => confirmPlace(game));
  press($('#bb-no'), () => exitBuildMode(game));
  R.respawn.addEventListener('click', () => {
    if (R.respawn.disabled || !game.player.dead) return;
    R.respawn.blur();
    respawnPlayer(game);
  });

  // fullscreen
  const fullBtn = $('#btn-full');
  if (!document.fullscreenEnabled && !document.documentElement.webkitRequestFullscreen) fullBtn.classList.add('hidden');
  press(fullBtn, async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const el = document.documentElement;
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
        try { await screen.orientation?.lock?.('landscape'); } catch { /* not supported */ }
      }
    } catch { game.events.emit('error', { text: 'Tela cheia indisponível' }); }
  });
  document.addEventListener('fullscreenchange', () => { fullBtn.innerHTML = svgIcon(document.fullscreenElement ? 'unfull' : 'full'); });

  // install (PWA)
  const instBtn = $('#btn-install');
  const showInstall = () => instBtn.classList.toggle('hidden', !deferredInstall || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
  document.addEventListener('wos-installable', showInstall);
  addEventListener('appinstalled', () => { deferredInstall = null; showInstall(); game.events.emit('toast', { text: 'App instalado!', kind: 'good' }); });
  press(instBtn, async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch { /* ignore */ }
    deferredInstall = null; showInstall();
  });
  showInstall();

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
      [4, game.input.isTouch ? 'Arraste à esquerda para andar · toque no mundo para interagir' : 'WASD para andar · clique para interagir · 1–5 habilidades', 'info'],
      [9, 'Corte árvores e quebre pedras para conseguir materiais', 'info'],
      [14, 'Construa uma fogueira antes do anoitecer', 'info'],
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
      toggle(R.pf, 'pfc', 'combat', !!pl.inCombat);
      toggle(R.hp, 'hplow', 'low', pl.hp / pl.maxHp < 0.3 && !pl.dead);
      toggle(R.hu, 'hulow', 'low', pl.hunger < 20);

      // target frame
      const t = pl.target;
      if (dirty.target) {
        dirty.target = false;
        R.tf.classList.toggle('hidden', !t);
        if (t) {
          const sp = SPECIES[t.species];
          R.tfNm.textContent = t.name + (t.elite ? ' (Elite)' : '');
          R.tf.className = `uf tf ${sp.temper}${t.elite ? ' elite' : ''}`;
          const url = spriteURL(A, t.species + '_e', 64) || spriteURL(A, 'wolf_e', 64);
          if (url) { R.tfImg.src = url; R.tfImg.style.display = ''; R.tfIni.textContent = ''; }
          else { R.tfImg.style.display = 'none'; R.tfIni.textContent = t.name[0]; }
          C.tfhp = C.tfhpt = C.tfsub = C.tflv = null;
        }
      }
      if (t) {
        setBar(R.tfHp, 'tfhp', t.dead ? 0 : t.hp / t.maxHp, t.dead ? 'Morto' : `${Math.ceil(t.hp)} / ${t.maxHp}`);
        const lvTxt = String(t.level);
        if (C.tflv !== lvTxt + pl.level) { C.tflv = lvTxt + pl.level; R.tfLv.textContent = lvTxt; R.tfLv.style.color = levelColor(t.level, pl.level); }
        const st = t.dead ? 'morto' : t.stunT > 0 ? 'atordoado' : STATE_PT[t.state] || '';
        setText(R.tfSub, 'tfsub', TEMPER_PT[SPECIES[t.species].temper] + (st ? ' · ' + st : ''));
      }

      // action bar
      const dead = pl.dead;
      toggle(root, 'dead', 'is-dead', !!dead);
      for (const b of abBtns) {
        const s = abilityState(g, b.id);
        const L = b.last;
        let frac = 0, gcd = false;
        if (s.cd > 0) frac = s.cd / s.cdDur;
        else if (s.gcd > 0) { frac = s.gcd / s.gcdDur; gcd = true; }
        const deg = Math.round(frac * 180) * 2;
        if (L.deg !== deg) { L.deg = deg; b.cd.style.setProperty('--p', deg + 'deg'); }
        if (L.gcd !== gcd) { L.gcd = gcd; b.el.classList.toggle('gcd', gcd); }
        const txt = s.cd > 1.5 ? String(Math.ceil(s.cd)) : s.cd > 0 ? s.cd.toFixed(1) : '';
        if (L.txt !== txt) { L.txt = txt; b.cdt.textContent = txt; }
        const noen = !s.energyOk, far = !s.inRange;
        if (L.noen !== noen) { L.noen = noen; b.el.classList.toggle('noen', noen); }
        if (L.far !== far) { L.far = far; b.el.classList.toggle('far', far); }
        const qd = pl.queued === b.id;
        if (L.qd !== qd) { L.qd = qd; b.el.classList.toggle('queued', qd); }
        const cool = s.cd > 0;
        if (L.cool && !cool) { b.el.classList.remove('ready'); void b.el.offsetWidth; b.el.classList.add('ready'); }
        L.cool = cool;
      }
      toggle(R.atk, 'atkon', 'on', !!(pl.autoAttack && attackable(pl.target)));

      // interact button
      const near = g.ctl.near;
      const showInt = !!near && !pl.work && !dead && !g.build.mode && !(pl.autoAttack && attackable(pl.target));
      toggle(R.int, 'intv', 'hidden', !showInt);
      if (showInt) {
        const key = near.verb + near.icon;
        if (C.intk !== key) { C.intk = key; R.intLbl.textContent = near.verb; R.intIc.innerHTML = uiIcon(A, near.icon); }
      }

      // build bar validity
      if (g.build.mode) toggle(R.bbOk, 'bbok', 'bad', !g.build.mode.valid);

      // buffs (structure on change, timers at 4 Hz)
      buffT -= dt;
      if (buffV !== pl.buffsV) {
        buffV = pl.buffsV;
        R.buffs.innerHTML = pl.buffs.map((b) => `<div class="bf ${b.good ? 'good' : 'bad'}" title="${b.name}${b.desc ? ' — ' + b.desc : ''}">${uiIcon(A, b.icon)}<span class="bt"></span></div>`).join('');
        buffT = 0;
      }
      if (buffT <= 0) {
        buffT = 0.25;
        const els = R.buffs.children;
        pl.buffs.forEach((b, i) => { const el = els[i]?.lastElementChild; if (el) { const v = b.perm ? '' : b.t >= 60 ? Math.ceil(b.t / 60) + 'm' : Math.ceil(b.t) + ''; if (el.textContent !== v) el.textContent = v; } });
      }

      // xp
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
        const food = (['berries', 'cooked', 'meat']).reduce((n, id) => n + pl.inv.count(id), 0);
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
          R.deathSub.textContent = `Você renascerá ${wh === 'acampamento' ? 'no' : 'na'} ${wh}.`;
          panels.close();
          exitBuildMode(g);
        }
        if (deathT > 2.6 && R.respawn.disabled) R.respawn.disabled = false;
      }
    },
  };
}
