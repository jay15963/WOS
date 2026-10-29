// Main menu (title screen). Shown before any world exists; resolves with the player's choice:
//   { mode: 'single', seed, fresh? } | { mode: 'host', seed, fresh? } | { mode: 'join', session, welcome }
// Background: a painted fallback while the graphics load, then the live engine showcase (showcase.js).
// Also: install popup "Aviso importante" in browser tabs (pwa.js), update check, menu music.

import { diagnosticsPanel, netTestPanel, settingsPanel, joinPanel } from './netpanels.js';
import { Session, playerName, setPlayerName } from '../net/session.js';
import { BUILD, BUILD_DATE } from '../net/netlog.js';
import { startShowcase } from './showcase.js';
import { isStandalone, openInstallGuide, checkUpdate, announceUpdate } from './pwa.js';
import * as AUD from '../fx/audio.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function lastSeed() { const s = parseInt(ls.get('wos.seed'), 10); return Number.isFinite(s) ? s : null; }
export function saveInfo(seed) {
  if (seed == null) return null;
  const raw = ls.get(`wos.save.v2.${seed}`) || ls.get(`wos.save.v1.${seed}`);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return { day: d.env?.day ?? d.day ?? 1, level: d.player?.level ?? d.level ?? 1 };
  } catch { return { day: 1, level: 1 }; }
}
export function randomSeed() { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 2147483000) + 1; }
export function wipeWorlds() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('wos.save.') || k === 'wos.snap').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

const I = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  new: '<path d="M12 21v-8"/><path d="M12 13c0-4.4 3.3-7.7 7.5-7.7 0 4.4-3.3 7.7-7.5 7.7z"/><path d="M12 15.2c0-3.3-2.7-6-6.5-6 0 3.3 2.7 6 6.5 6z"/>',
  mp: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.6 14.4c2.6-.3 4.8 1.4 5.4 4.6"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3"/><circle cx="12" cy="12" r="7"/>',
  install: '<path d="M12 3.5v11M7 10l5 5 5-5"/><path d="M4.5 16.5V20h15v-3.5"/>',
  update: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  arrow: '<path d="M9 6l6 6-6 6"/>',
};
const svg = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
const btn = (a, icon, label, sub, cls = '', i = 0) => `<button class="mbtn ${cls}" data-a="${a}" style="--i:${i}"><span class="mi">${svg(icon)}</span><span class="mt"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="ma">${svg('arrow')}</span></button>`;

// painted fallback: dusk sky, mountains, a forest edge, river and a campfire glow (Canvas2D, once)
function paintFallback(cv) {
  const w = cv.width = Math.min(1600, Math.round(innerWidth * Math.min(2, devicePixelRatio || 1)));
  const h = cv.height = Math.round(w * (innerHeight / Math.max(1, innerWidth)));
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1d1a2a'); sky.addColorStop(0.45, '#6a3f3a'); sky.addColorStop(0.62, '#d98a4a'); sky.addColorStop(0.7, '#f2c072');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const sun = g.createRadialGradient(w * 0.7, h * 0.6, 0, w * 0.7, h * 0.6, h * 0.35);
  sun.addColorStop(0, 'rgba(255,236,170,.95)'); sun.addColorStop(0.12, 'rgba(255,210,120,.55)'); sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun; g.fillRect(0, 0, w, h);
  const ridge = (y0, amp, f, col, seed) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 - amp * (0.55 * Math.abs(Math.sin(x * f + seed)) + 0.3 * Math.sin(x * f * 2.7 + seed * 2) + 0.15 * Math.sin(x * f * 7.1)));
    g.lineTo(w, h); g.fill();
  };
  ridge(h * 0.64, h * 0.12, 0.004, '#5a3a3e', 1.2);
  ridge(h * 0.7, h * 0.08, 0.007, '#3c2a2e', 3.1);
  // river ribbon
  g.fillStyle = '#2a2f3a';
  g.fillRect(0, h * 0.74, w, h);
  const riv = g.createLinearGradient(0, h * 0.78, 0, h * 0.86);
  riv.addColorStop(0, 'rgba(240,180,110,.55)'); riv.addColorStop(1, 'rgba(90,110,140,.25)');
  g.fillStyle = riv;
  g.beginPath(); g.moveTo(0, h * 0.8);
  for (let x = 0; x <= w; x += 10) g.lineTo(x, h * 0.8 + Math.sin(x * 0.006) * h * 0.02);
  for (let x = w; x >= 0; x -= 10) g.lineTo(x, h * 0.86 + Math.sin(x * 0.005 + 1) * h * 0.02);
  g.fill();
  // pines
  const pine = (x, by, s) => {
    g.fillStyle = '#141a14';
    for (let k = 0; k < 4; k++) { const yb = by - k * s * 0.32, half = s * (0.42 - k * 0.08); g.beginPath(); g.moveTo(x - half, yb); g.lineTo(x, yb - s * 0.48); g.lineTo(x + half, yb); g.fill(); }
    g.fillRect(x - s * 0.03, by, s * 0.06, s * 0.12);
  };
  for (let i = 0; i < 26; i++) { const x = (i / 26) * w * 0.55 + Math.sin(i * 7.3) * 20; pine(x, h * (0.76 + 0.03 * Math.sin(i * 2.1)), h * (0.2 + 0.08 * Math.abs(Math.sin(i * 3.7)))); }
  for (let i = 0; i < 8; i++) pine(w * (0.86 + i * 0.03), h * 0.78, h * (0.18 + 0.05 * Math.sin(i)));
  // campfire glow
  const fx = w * 0.64, fy = h * 0.9;
  const glow = g.createRadialGradient(fx, fy, 0, fx, fy, h * 0.3);
  glow.addColorStop(0, 'rgba(255,200,110,.9)'); glow.addColorStop(0.1, 'rgba(255,150,60,.5)'); glow.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = glow; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe9b0'; g.beginPath(); g.ellipse(fx, fy - h * 0.012, h * 0.008, h * 0.018, 0, 0, Math.PI * 2); g.fill();
}

const music = (mood) => { try { AUD.getAudio?.()?.music?.setMood?.(mood); } catch { /* audio not ready */ } };

export function showMainMenu({ presetCode = '', progress = null, assets = null } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'menu';
    root.className = 'menu enter';
    const seed = lastSeed();
    const info = saveInfo(seed);
    const installable = !isStandalone();
    let n = 0;
    root.innerHTML = `
      <canvas class="menu-paint" aria-hidden="true"></canvas>
      <div class="menu-shade" aria-hidden="true"></div>
      <div class="menu-side">
        <header class="menu-brand">
          <div class="menu-emblem" aria-hidden="true"><svg viewBox="0 0 64 64"><defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a8"/><stop offset="1" stop-color="#d9902e"/></linearGradient></defs>
            <path d="M32 6c3 10 14 14 14 28a14 14 0 0 1-28 0c0-7 3.5-11 7-14 0 6 2.5 9 5.5 9.5C29 21 28 14 32 6z" fill="url(#mg)"/><path d="M14 56l36-9M14 47l36 9" stroke="#8a5a2a" stroke-width="5" stroke-linecap="round"/></svg></div>
          <h1 class="menu-logo"><span>W</span><span>O</span><span>S</span></h1>
          <div class="menu-sub">World of Survival</div>
          <p class="menu-tag">Sobreviva, construa e descanse junto ao fogo.</p>
        </header>
        <nav class="menu-nav">
          ${info ? btn('continue', 'play', 'Continuar', `Dia ${info.day} · nível ${info.level} · mundo ${seed}`, 'primary', n++) : ''}
          ${btn('new', 'new', 'Novo mundo', info ? 'Apaga o progresso e começa do zero' : 'Comece sua sobrevivência', info ? '' : 'primary', n++)}
          ${btn('mp', 'mp', 'Multijogador', 'Criar sala ou entrar com código', '', n++)}
          ${btn('settings', 'gear', 'Configurações', 'Nome, som, qualidade', '', n++)}
        </nav>
        <div class="menu-row2" style="--i:${n++}">
          ${installable ? `<button class="mpill" data-a="install">${svg('install')}<span>Instalar o jogo</span></button>` : ''}
          <button class="mpill" data-a="update">${svg('update')}<span>Procurar atualização</span><i class="dot hidden"></i></button>
        </div>
        <div class="menu-foot"><span>Versão ${BUILD_DATE} · ${BUILD}</span><span data-k="ld">Carregando gráficos…</span></div>
        <div class="menu-load"><i></i></div>
      </div>
      <div class="mpanel hidden"><button class="x" title="Fechar" aria-label="Fechar">✕</button><div class="mbody"></div></div>`;
    document.body.appendChild(root);
    const paint = root.querySelector('.menu-paint');
    try { paintFallback(paint); } catch { /* ignore */ }
    setTimeout(() => root.classList.remove('enter'), 2400);

    // live background as soon as the graphics are ready
    let show = null;
    assets?.then(({ renderer, atlas }) => {
      if (!root.isConnected) return;
      try {
        show = startShowcase({ renderer, atlas, onReady: () => root.classList.add('live') });
      } catch (e) { console.warn('[menu] showcase unavailable', e); }
    }).catch(() => {});

    music('menu');
    const kick = () => music('menu');
    addEventListener('pointerdown', kick, { once: true });
    addEventListener('keydown', kick, { once: true });

    const panel = root.querySelector('.mpanel'), body = root.querySelector('.mbody');
    let cleanup = null;
    const open = (fn) => {
      cleanup?.(); cleanup = null;
      panel.classList.remove('hidden');
      root.classList.add('panel-open');
      body.innerHTML = '';
      cleanup = fn(body) || null;
      panel.scrollTop = 0; body.scrollTop = 0;
    };
    const closePanel = () => { cleanup?.(); cleanup = null; panel.classList.add('hidden'); root.classList.remove('panel-open'); };
    root.querySelector('.x').onclick = closePanel;
    addEventListener('keydown', function onKey(e) {
      if (!root.isConnected) { removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape' && !panel.classList.contains('hidden') && !document.querySelector('.pwa-modal')) closePanel();
    });

    const finish = (choice) => {
      cleanup?.();
      show?.stop();
      root.classList.add('hidden');
      document.querySelector('.pwa-modal')?.remove();
      setTimeout(() => root.remove(), 50);
      resolve(choice);
    };

    // progress of the background asset loading
    if (progress) progress((p, label) => {
      const bar = root.querySelector('.menu-load > i'), ld = root.querySelector('[data-k=ld]');
      if (bar) bar.style.width = Math.round(p * 100) + '%';
      if (ld) ld.textContent = p >= 1 ? 'Pronto' : label;
      if (p >= 1) root.querySelector('.menu-load')?.classList.add('done');
    });

    const nameField = (el) => {
      el.insertAdjacentHTML('beforeend', `<label class="mfield">Seu nome<input data-k="pname" maxlength="18" value="${esc(playerName())}"></label>`);
      const inp = el.querySelector('[data-k=pname]');
      inp.onchange = () => setPlayerName(inp.value);
    };

    const newWorld = (mode) => (el) => {
      el.innerHTML = `
        <h2>${mode === 'host' ? 'Sala com mundo novo' : 'Novo mundo'}</h2>
        <p>${info ? '<b>Atenção:</b> isto apaga todos os mundos salvos neste navegador e começa do zero.' : 'Um mundo novo será gerado.'}</p>
        <label class="mfield">Semente do mundo (deixe vazio para aleatória)<input data-k="seed" inputmode="numeric" placeholder="aleatória"></label>
        <div class="row"><button class="mbtn primary" data-a="go">${info ? 'Apagar e criar' : 'Criar mundo'}</button><button class="mbtn" data-a="back">Cancelar</button></div>`;
      el.querySelector('[data-a=back]').onclick = closePanel;
      el.querySelector('[data-a=go]').onclick = () => {
        const v = parseInt(el.querySelector('[data-k=seed]').value, 10);
        finish({ mode, seed: Number.isFinite(v) ? v : randomSeed(), fresh: true });
      };
    };

    const mpPanel = (el) => {
      el.innerHTML = `
        <h2>Multijogador</h2>
        <p>Co-op de até 4 jogadores pela internet, sem servidor: os navegadores se conectam direto (WebRTC).
           O anfitrião cria a sala e passa o código de 6 letras.</p>`;
      nameField(el);
      el.insertAdjacentHTML('beforeend', `
        <div class="row"><button class="mbtn primary" data-a="host">Criar sala</button><button class="mbtn primary" data-a="join">Entrar com código</button></div>
        <div class="row"><button class="mbtn" data-a="test">Testar minha rede</button><button class="mbtn" data-a="diag">Diagnóstico</button></div>
        <p class="muted">Mundo compartilhado: árvores, construções, minas, plantações, itens no chão e criaturas são os mesmos para todos
           (o anfitrião é o dono do mundo). Todos precisam da mesma versão do jogo — use “Procurar atualização” se a sala recusar.</p>`);
      el.querySelector('[data-a=host]').onclick = () => open((b) => {
        b.innerHTML = `<h2>Criar sala</h2><p>Qual mundo seus amigos vão visitar?</p>
          <div class="row">
            ${info ? `<button class="mbtn primary" data-a="cur">Meu mundo atual<small>Dia ${info.day} · mundo ${seed}</small></button>` : ''}
            <button class="mbtn ${info ? '' : 'primary'}" data-a="new">Mundo novo</button>
            <button class="mbtn" data-a="back">Voltar</button></div>`;
        b.querySelector('[data-a=back]').onclick = () => open(mpPanel);
        if (info) b.querySelector('[data-a=cur]').onclick = () => finish({ mode: 'host', seed });
        b.querySelector('[data-a=new]').onclick = () => open(newWorld('host'));
      });
      el.querySelector('[data-a=join]').onclick = () => open((b) => joinPanel(b, {
        presetCode,
        makeSession: () => new Session(),
        onJoined: (session, welcome) => setTimeout(() => finish({ mode: 'join', session, welcome }), 400),
      }));
      el.querySelector('[data-a=test]').onclick = () => open(netTestPanel);
      el.querySelector('[data-a=diag]').onclick = () => open(diagnosticsPanel);
    };

    root.querySelector('[data-a=continue]')?.addEventListener('click', () => finish({ mode: 'single', seed }));
    root.querySelector('[data-a=new]').onclick = () => open(newWorld('single'));
    root.querySelector('[data-a=mp]').onclick = () => open(mpPanel);
    root.querySelector('[data-a=settings]').onclick = () => open((el) => settingsPanel(el));
    root.querySelector('[data-a=install]')?.addEventListener('click', () => openInstallGuide({ title: 'Instalar o jogo' }));

    // update check: silently once on open (badge + top notification), on demand with the button
    const upBtn = root.querySelector('[data-a=update]');
    const flag = () => { upBtn.classList.add('has'); upBtn.querySelector('.dot').classList.remove('hidden'); upBtn.querySelector('span').textContent = 'Atualizar agora'; };
    upBtn.addEventListener('click', async () => {
      if (upBtn.disabled) return;
      upBtn.disabled = true;
      upBtn.classList.add('busy');
      try { await checkUpdate({ silent: false }); } finally { upBtn.disabled = false; upBtn.classList.remove('busy'); }
    });
    announceUpdate();
    setTimeout(() => { if (root.isConnected && navigator.onLine !== false) checkUpdate({ silent: true, onAvailable: flag }); }, 1500);

    // invite link (?sala=CODE) goes straight to the join screen
    if (presetCode) open((b) => joinPanel(b, {
      presetCode,
      makeSession: () => new Session(),
      onJoined: (session, welcome) => setTimeout(() => finish({ mode: 'join', session, welcome }), 400),
    }));

    // browser tab (not the installed app): the install popup, every time (closes only with its ✕)
    if (installable) setTimeout(() => { if (root.isConnected) openInstallGuide({ title: 'Aviso importante' }); }, presetCode ? 1800 : 900);
  });
}
