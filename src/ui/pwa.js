// PWA helpers: platform detection (iOS / iPadOS / Android / desktop, browser), install state
// (standalone?), the deferred `beforeinstallprompt`, the install guide ("Aviso importante" popup:
// one-tap install where the browser allows it, illustrated steps on iOS, QR code for the phone on
// desktop) and the update check of the main menu (installed PWAs have no reload button).
// Localhost-only test flags: ?fakeios=1|ipad|chrome|firefox, ?fakeua=android|firefox-android|samsung|desktop|desktop-firefox,
// ?fakeupdate=1 (the deployed build "differs"), ?standalone=1 (pretend installed).

import qrcode from '../../vendor/qrcode/qrcode.mjs';
import { BUILD_ID, BUILD_DATE } from '../version.js';
import { notify } from './notify.js';

const QS = new URLSearchParams(location.search);
const DEV = /^(localhost|127\.|\[::1\])/.test(location.hostname);

export const PWA = { deferred: null };
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  PWA.deferred = e;
  document.dispatchEvent(new Event('wos-installable'));
});
addEventListener('appinstalled', () => {
  PWA.deferred = null;
  PWA.installed = true;
  document.dispatchEvent(new Event('wos-installable'));
  notify('App instalado!', { sub: 'Abra o WOS pelo ícone na tela inicial.', kind: 'good' });
});

// ---------- platform ----------
let PLAT = null;
export function platform() {
  if (PLAT) return PLAT;
  let ua = navigator.userAgent, plat = navigator.platform || '', touch = navigator.maxTouchPoints || 0;
  if (DEV) {
    const ios = QS.get('fakeios'), f = QS.get('fakeua');
    if (ios) {
      plat = ios === 'ipad' ? 'MacIntel' : 'iPhone'; touch = 5;
      ua = ios === 'ipad' ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
        : ios === 'chrome' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1'
        : ios === 'firefox' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15'
        : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    } else if (f) {
      touch = f.startsWith('desktop') ? 0 : 5;
      ua = { android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
        'firefox-android': 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
        samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36',
        desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'desktop-firefox': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0' }[f] || ua;
    }
  }
  const ipad = /iPad/.test(ua) || (plat === 'MacIntel' && touch > 1);
  const ios = /iPhone|iPod/.test(ua) || /iPhone|iPod/.test(plat) || ipad;
  const android = /Android/.test(ua);
  const firefox = /Firefox|FxiOS/.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const edge = /Edg(e|A|iOS)?\//.test(ua);
  const iosApp = ios ? (/CriOS/.test(ua) ? 'chrome' : /FxiOS/.test(ua) ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : 'safari') : null;
  const mobile = ios || android || /Mobi/.test(ua);
  const browser = iosApp || (samsung ? 'samsung' : firefox ? 'firefox' : edge ? 'edge' : /Chrome|Chromium|CriOS/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other');
  PLAT = { ios, ipad, android, firefox, samsung, edge, iosApp, mobile, desktop: !mobile, browser };
  return PLAT;
}

export function isStandalone() {
  if (DEV && QS.has('standalone')) return true;
  try {
    return matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)').matches
      || navigator.standalone === true || document.referrer.startsWith('android-app://');
  } catch { return false; }
}

// element fullscreen exists? (iPhone Safari has none: an installed PWA already runs full screen)
export function canFullscreen() {
  if (DEV && QS.get('fakeios') && QS.get('fakeios') !== 'ipad') return false;
  const el = document.documentElement;
  return !!((document.fullscreenEnabled && el.requestFullscreen) || (document.webkitFullscreenEnabled && el.webkitRequestFullscreen));
}
export const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
// must run inside a click / pointerup handler (a touch pointerdown is not a user activation)
export async function toggleFullscreen() {
  if (fullscreenElement()) {
    await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
    return false;
  }
  const el = document.documentElement;
  if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  else await el.webkitRequestFullscreen();
  try { await screen.orientation?.lock?.('landscape'); } catch { /* not supported */ }
  return true;
}
export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}

export const gameURL = () => location.origin + location.pathname;

// ---------- install guide ----------
const SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M7 10H5.5v10.5h13V10H17"/></svg>';
const ADDHOME_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
const DOTS_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const PHONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
const FULL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const INSTALL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7 10l5 5 5-5"/><path d="M4.5 16.5V20h15v-3.5"/></svg>';
const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';

function qrSVG(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), m = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges" role="img" aria-label="QR code do endereço do jogo"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

// steps for browsers without a one-tap install
function manualSteps(P) {
  const step = (n, icon, html, pic = '') => `<li class="ist"><span class="isn">${n}</span><span class="isi">${icon}</span><span class="ist-t">${html}${pic}</span></li>`;
  if (P.ios) {
    const where = P.iosApp === 'safari'
      ? (P.ipad ? 'no alto, à direita da barra de endereço' : 'na barra de baixo do Safari (no meio)')
      : P.iosApp === 'chrome' ? 'na barra de endereço, no alto (ou no menu ⋯)'
      : P.iosApp === 'firefox' ? 'no menu ≡ (embaixo, à direita) → Compartilhar'
      : 'no menu do navegador';
    const bar = P.iosApp === 'safari' && !P.ipad
      ? `<span class="pic pic-bar"><i></i><i></i><b>${SHARE_SVG}</b><i></i><i></i></span>` : '';
    const sheet = `<span class="pic pic-sheet"><em>Copiar</em><em class="hl">Adicionar à Tela de Início <b>${ADDHOME_SVG}</b></em><em>Adicionar aos Favoritos</em></span>`;
    const top = '<span class="pic pic-top"><em>Cancelar</em><b>Adicionar</b></span>';
    return `<ol class="isteps">
      ${step(1, SHARE_SVG, `Toque em <b>Compartilhar</b> ${where}.`, bar)}
      ${step(2, ADDHOME_SVG, 'Role a lista e toque em <b>“Adicionar à Tela de Início”</b>.', sheet)}
      ${step(3, '✓', 'Toque em <b>Adicionar</b>, no canto de cima. Pronto: abra o WOS pelo ícone novo, em tela cheia.', top)}
    </ol>${P.iosApp !== 'safari' ? '<p class="muted">Se não aparecer a opção, abra este endereço no <b>Safari</b> e siga os mesmos passos.</p>' : ''}`;
  }
  if (P.android && P.firefox) return `<ol class="isteps">${step(1, DOTS_SVG, 'Toque no menu <b>⋮</b> do Firefox.')}${step(2, ADDHOME_SVG, 'Toque em <b>Instalar</b> (ou “Adicionar à tela inicial”).')}${step(3, '✓', 'Confirme. Abra o WOS pelo ícone na tela inicial.')}</ol>`;
  if (P.samsung) return `<ol class="isteps">${step(1, MENU_SVG, 'Toque no menu <b>≡</b> do Samsung Internet.')}${step(2, ADDHOME_SVG, 'Toque em <b>Adicionar página a</b> → <b>Tela inicial</b>.')}${step(3, '✓', 'Confirme e abra o WOS pelo ícone.')}</ol>`;
  if (P.android) return `<ol class="isteps">${step(1, DOTS_SVG, 'Toque no menu <b>⋮</b> do navegador.')}${step(2, ADDHOME_SVG, 'Toque em <b>Instalar app</b> (ou “Adicionar à tela inicial”).')}${step(3, '✓', 'Confirme e abra o WOS pelo ícone.')}</ol>`;
  if (P.desktop && (P.browser === 'chrome' || P.browser === 'edge')) return `<ol class="isteps">${step(1, '⊕', 'Clique no ícone <b>Instalar</b> no fim da barra de endereço…')}${step(2, DOTS_SVG, '…ou no menu <b>⋮</b> → <b>Transmitir, salvar e compartilhar</b> → <b>Instalar WOS</b>.')}</ol>`;
  if (P.desktop && P.browser === 'safari') return `<ol class="isteps">${step(1, MENU_SVG, 'No menu <b>Arquivo</b>, escolha <b>Adicionar ao Dock</b>.')}</ol>`;
  if (P.desktop && P.firefox) return '<p class="muted">O Firefox para computador não instala sites como aplicativo. Use o Chrome ou o Edge para instalar aqui — ou instale no celular pelo QR code.</p>';
  return `<ol class="isteps">${step(1, DOTS_SVG, 'Abra o menu do navegador.')}${step(2, ADDHOME_SVG, 'Escolha <b>Instalar</b> ou <b>Adicionar à tela inicial</b>.')}</ol>`;
}

let guideEl = null;
// Opens the install guide. Closes only with its own ✕ (no backdrop, no Esc).
export function openInstallGuide({ title = 'Aviso importante' } = {}) {
  if (guideEl?.isConnected) return guideEl;
  const P = platform();
  const can = !!PWA.deferred;
  const root = guideEl = document.createElement('div');
  root.className = 'pwa-modal';
  const url = gameURL();
  const phone = P.desktop ? `
    <div class="ibox phone">
      <div class="ih">${PHONE_SVG}<b>Instale também no celular</b></div>
      <p>Assim você recebe <b>notificações</b> do jogo quando estiver longe do PC. Aponte a câmera do celular para o código:</p>
      <div class="qrrow">${qrSVG(url)}<div class="qrside"><code>${url.replace(/^https?:\/\//, '')}</code><button class="pbtn" data-a="copy">Copiar link</button></div></div>
    </div>` : '';
  root.innerHTML = `
    <div class="pwa-card" role="dialog" aria-modal="true" aria-labelledby="pwa-t">
      <button class="pwa-x" data-a="close" aria-label="Fechar">✕</button>
      <div class="pwa-head"><span class="pwa-ico"><img src="icons/icon-192.png" alt=""></span>
        <div><b id="pwa-t">${title}</b><small>Instale o WOS como aplicativo</small></div></div>
      <p class="pwa-lead">O jogo funciona <b>muito melhor instalado</b>: abre em <b>tela cheia</b>, sem barras do navegador, carrega mais rápido e guarda seu progresso com segurança.${P.mobile ? '' : ' No computador ele abre numa janela própria.'}</p>
      <ul class="pwa-why"><li>${FULL_SVG.replace('<svg', '<svg class="w"')}Tela cheia de verdade</li><li>${BELL_SVG.replace('<svg', '<svg class="w"')}Notificações</li><li>${PHONE_SVG.replace('<svg', '<svg class="w"')}Ícone na tela inicial</li></ul>
      <div class="ibox here">
        <div class="ih">${ADDHOME_SVG}<b>${P.desktop ? 'Instalar neste computador' : 'Como instalar'}</b></div>
        ${can ? '<p>Um toque e pronto:</p>' : manualSteps(P)}
        <div class="pwa-act"><button class="pbtn primary" data-a="install">${INSTALL_SVG.replace('<svg', '<svg class="w"')}<span>Instalar</span></button></div>
      </div>
      ${phone}
    </div>
    ${P.ios && P.iosApp === 'safari' && !P.ipad ? '<div class="pwa-arrow" aria-hidden="true">↓</div>' : ''}`;
  document.body.appendChild(root);
  const btn = root.querySelector('[data-a=install]');
  const refresh = () => {
    const ok = !!PWA.deferred;
    btn.querySelector('span').textContent = ok ? 'Instalar agora' : P.ios ? 'Mostrar os passos' : 'Instalar';
  };
  refresh();
  document.addEventListener('wos-installable', refresh);
  btn.addEventListener('click', async () => {
    if (PWA.deferred) {
      const ev = PWA.deferred;
      ev.prompt();
      let res = null;
      try { res = await ev.userChoice; } catch { /* ignore */ }
      PWA.deferred = null;
      refresh();
      if (res?.outcome === 'accepted') close();
      return;
    }
    // no one-tap install here: bring the steps into view and make them pulse
    const steps = root.querySelector('.isteps') || root.querySelector('.ibox.here');
    steps?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    steps?.classList.remove('pulse'); void steps?.offsetWidth; steps?.classList.add('pulse');
    root.querySelector('.pwa-arrow')?.classList.add('on');
  });
  root.querySelector('[data-a=copy]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* ignore */ }
    b.textContent = ok ? 'Link copiado!' : url;
    setTimeout(() => { b.textContent = 'Copiar link'; }, 1800);
  });
  const close = () => {
    document.removeEventListener('wos-installable', refresh);
    root.classList.add('out');
    setTimeout(() => root.remove(), 220);
    guideEl = null;
  };
  root.querySelector('[data-a=close]').addEventListener('click', close);
  // the popup never closes by backdrop or Esc (owner's request)
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  return root;
}

// ---------- update check (main menu) ----------
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// fetches the deployed version.js without any cache → { id, date } | throws
export async function deployedBuild() {
  const r = await fetch('src/version.js?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text();
  const id = /BUILD_ID\s*=\s*['"]([^'"]+)['"]/.exec(txt)?.[1];
  const date = /BUILD_DATE\s*=\s*['"]([^'"]+)['"]/.exec(txt)?.[1] || '';
  if (!id) throw new Error('versão ilegível');
  if (DEV && QS.get('fakeupdate') === '1') return { id: 'fake' + id.slice(4), date, fake: true };
  return { id, date };
}

// silent: only flags an update (badge + its own notification); otherwise updates right away
export async function checkUpdate({ silent = false, onAvailable = null } = {}) {
  let remote;
  try { remote = await deployedBuild(); } catch {
    if (!silent) notify('Sem conexão para procurar atualização', { kind: 'warn', sub: 'Tente de novo quando estiver online.' });
    return { error: true };
  }
  if (remote.id === BUILD_ID) {
    if (!silent) notify('Você já está na versão mais recente', { kind: 'good', sub: `Versão ${BUILD_DATE}` });
    return { latest: true };
  }
  if (silent) {
    onAvailable?.(remote);
    notify('Nova versão disponível — toque para atualizar', { kind: 'update', sticky: true, key: 'update', sub: remote.date ? `Versão ${remote.date}` : '', onClick: () => applyUpdate(remote) });
    return { available: remote };
  }
  await applyUpdate(remote);
  return { updating: true };
}

export async function applyUpdate(remote) {
  notify('Atualizando o jogo…', { kind: 'update', key: 'update', sticky: true });
  ls.set('wos.updatedFrom', JSON.stringify({ from: BUILD_ID, to: remote.id, date: remote.date, fake: !!remote.fake, at: Date.now() }));
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      try { await reg.update(); } catch { /* offline / same worker */ }
      const w = reg.waiting || reg.installing;
      if (w) {
        await new Promise((res) => {
          const t = setTimeout(res, 3000);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
          w.postMessage({ type: 'skipWaiting' });
        });
      }
    }
  } catch { /* no service worker (localhost) */ }
  try { for (const k of await caches.keys()) if (k.startsWith('wos-')) await caches.delete(k); } catch { /* ignore */ }
  // a fresh URL so no layer (SW offline copy, HTTP cache of the page) can hand back the old index.html
  const u = new URL(location.href); u.searchParams.set('v', remote.id || String(Date.now()));
  location.replace(u.toString());
}

// after a reload started by applyUpdate: tell the player what happened
export function announceUpdate() {
  const raw = ls.get('wos.updatedFrom');
  if (!raw) return;
  ls.del('wos.updatedFrom');
  let d = null;
  try { d = JSON.parse(raw); } catch { return; }
  if (!d || Date.now() - (d.at || 0) > 10 * 60 * 1000) return;
  if (d.from !== BUILD_ID || d.fake) notify('Jogo atualizado!', { kind: 'good', sub: `Versão ${BUILD_DATE} · ${BUILD_ID}`, ms: 6000 });
  else notify('A nova versão ainda não chegou', { kind: 'warn', sub: 'O servidor pode levar alguns minutos. Tente de novo daqui a pouco.', ms: 6000 });
}
