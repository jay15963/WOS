// Main menu (title screen). Shown before any world exists; resolves with the player's choice:
//   { mode: 'single', seed, fresh? } | { mode: 'host', seed, fresh? } | { mode: 'join', session, welcome }

import { diagnosticsPanel, netTestPanel, settingsPanel, joinPanel } from './netpanels.js';
import { Session, playerName, setPlayerName } from '../net/session.js';
import { BUILD } from '../net/netlog.js';

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

export function showMainMenu({ presetCode = '', progress = null } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'menu';
    root.className = 'menu';
    const snap = ls.get('wos.snap');
    const seed = lastSeed();
    const info = saveInfo(seed);
    root.innerHTML = `
      <div class="menu-bg ${snap ? '' : 'fallback'}"></div>
      <div class="menu-side">
        <div class="menu-logo">WOS</div>
        <div class="menu-sub">World of Survival</div>
        <nav class="menu-nav">
          ${info ? `<button class="mbtn primary" data-a="continue">Continuar<small>Dia ${info.day} · nível ${info.level} · mundo ${seed}</small></button>` : ''}
          <button class="mbtn ${info ? '' : 'primary'}" data-a="new">Novo mundo<small>${info ? 'Apaga o progresso e começa do zero' : 'Comece sua sobrevivência'}</small></button>
          <button class="mbtn" data-a="mp">Multijogador<small>Criar sala ou entrar com código</small></button>
          <button class="mbtn" data-a="settings">Configurações<small>Nome, som, qualidade</small></button>
        </nav>
        <div class="menu-foot"><span>Versão ${BUILD}</span><span data-k="ld">Carregando gráficos…</span></div>
        <div class="menu-load"><i></i></div>
      </div>
      <div class="mpanel hidden"><button class="x" title="Fechar">✕</button><div class="mbody"></div></div>`;
    document.body.appendChild(root);
    if (snap) root.querySelector('.menu-bg').style.backgroundImage = `url("${snap}")`;

    const panel = root.querySelector('.mpanel'), body = root.querySelector('.mbody');
    let cleanup = null;
    const open = (fn) => {
      cleanup?.(); cleanup = null;
      panel.classList.remove('hidden');
      body.innerHTML = '';
      cleanup = fn(body) || null;
      body.scrollTop = 0;
    };
    const closePanel = () => { cleanup?.(); cleanup = null; panel.classList.add('hidden'); };
    root.querySelector('.x').onclick = closePanel;
    addEventListener('keydown', function onKey(e) {
      if (!root.isConnected) { removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape' && !panel.classList.contains('hidden')) closePanel();
    });

    const finish = (choice) => {
      cleanup?.();
      root.classList.add('hidden');
      setTimeout(() => root.remove(), 50);
      resolve(choice);
    };

    // progress of the background asset loading
    if (progress) progress((p, label) => {
      const bar = root.querySelector('.menu-load > i'), ld = root.querySelector('[data-k=ld]');
      if (bar) bar.style.width = Math.round(p * 100) + '%';
      if (ld) ld.textContent = p >= 1 ? 'Pronto' : label;
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
        <p class="muted">Fase 1: vocês se veem no mesmo mundo, com chat, horário e clima sincronizados. Coleta, construção e criaturas compartilhadas vêm na próxima etapa.</p>`);
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

    // invite link (?sala=CODE) goes straight to the join screen
    if (presetCode) open((b) => joinPanel(b, {
      presetCode,
      makeSession: () => new Session(),
      onJoined: (session, welcome) => setTimeout(() => finish({ mode: 'join', session, welcome }), 400),
    }));
  });
}
