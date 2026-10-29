// In-game menu (☰ / Esc), room chip (code · players · ping), chat bar, and the session system hook.

import { Session, MAX_PLAYERS } from '../net/session.js';
import { diagnosticsPanel, netTestPanel, settingsPanel, roomPanel } from './netpanels.js';
import { saveGame } from '../game/save.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function installNetUI(game) {
  const hud = document.getElementById('hud');

  // ---------- ☰ button ----------
  const btn = document.createElement('button');
  btn.id = 'btn-menu';
  btn.className = 'sb';
  btn.title = 'Menu (Esc)';
  btn.innerHTML = '<span style="font-size:18px;line-height:1">☰</span>';
  const tr = hud.querySelector('.tr');
  const holder = tr?.querySelector('.sb')?.parentElement || tr;
  if (holder) holder.insertBefore(btn, holder.firstChild); else hud.appendChild(btn);

  // ---------- room chip ----------
  const chip = document.createElement('div');
  chip.className = 'room-chip hidden';
  chip.innerHTML = '<i></i><span data-k="t"></span><span class="chat-b" title="Chat (Enter)">💬</span>';
  hud.appendChild(chip);

  // ---------- chat bar ----------
  const chat = document.createElement('div');
  chat.className = 'chatbar hidden';
  chat.innerHTML = '<input class="minput" maxlength="140" placeholder="Mensagem para a sala… (Enter envia, Esc fecha)"><button class="mbtn primary">Enviar</button>';
  hud.appendChild(chat);
  const chatInput = chat.querySelector('input');
  const openChat = () => { if (!game.session) return; chat.classList.remove('hidden'); setTimeout(() => chatInput.focus(), 20); };
  const closeChat = () => { chat.classList.add('hidden'); chatInput.blur(); };
  const sendChat = () => { const t = chatInput.value.trim(); if (t) game.session?.say(t); chatInput.value = ''; closeChat(); };
  chat.querySelector('button').onclick = sendChat;
  chatInput.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') sendChat();
    else if (e.key === 'Escape') closeChat();
  };
  chip.querySelector('.chat-b').onclick = (e) => { e.stopPropagation(); openChat(); };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !game.session || pause.isOpen()) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (game.build?.mode) return; // Enter confirms building there
    e.preventDefault();
    openChat();
  });

  // ---------- pause menu ----------
  const pause = makePause(game);
  btn.onclick = () => pause.toggle();
  chip.onclick = () => pause.open('room');
  game.events.on('pausemenu', () => pause.toggle());
  game.events.on('closepanels', () => pause.close());

  // ---------- session wiring ----------
  let wired = null;
  const wire = (s) => {
    if (!s || wired === s) return;
    wired = s;
    s.on('toast', (d) => game.events.emit('toast', { text: esc(d.text), kind: d.kind === 'error' ? 'warn' : d.kind }));
    s.on('chat', (d) => game.events.emit('toast', { text: `<b>${esc(d.name)}:</b> ${esc(d.text)}`, kind: 'info' }));
    s.on('players', () => updateChip(true));
    s.on('rtt', () => updateChip(true));
    s.on('state', () => updateChip(true));
  };
  let chipT = 0, chipTxt = '';
  const updateChip = (force) => {
    const s = game.session;
    if (!s || s.state === 'closed') { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    chip.classList.toggle('lost', s.state === 'lost');
    chip.classList.toggle('wait', s.role === 'host' && s.players.size === 0);
    let t;
    if (s.role === 'host') t = `Sala ${s.code} · ${s.count}/${MAX_PLAYERS}`;
    else t = s.state === 'lost' ? 'Reconectando…' : `Sala ${s.code === 'MANUAL' ? 'manual' : s.code} · ${s.count}/${MAX_PLAYERS}${s.rtt != null ? ' · ' + Math.round(s.rtt) + ' ms' : ''}`;
    if (force || t !== chipTxt) { chipTxt = t; chip.querySelector('[data-k=t]').textContent = t; }
  };

  return {
    update(g, dt) {
      if (g.session) { wire(g.session); g.session.update(g, dt); }
      chipT -= dt;
      if (chipT <= 0) { chipT = 0.5; updateChip(false); }
    },
    render(g) { g.session?.render(g); },
    pause,
  };
}

function makePause(game) {
  const root = document.createElement('div');
  root.className = 'pause hidden';
  root.innerHTML = '<div class="mpanel"><button class="x" title="Fechar">✕</button><div class="mbody"></div></div>';
  document.body.appendChild(root);
  const body = root.querySelector('.mbody');
  let cleanup = null, isOpen = false;
  root.querySelector('.x').onclick = () => api.close();
  root.addEventListener('pointerdown', (e) => { if (e.target === root) api.close(); });
  addEventListener('keydown', (e) => {
    if (!isOpen || e.key !== 'Escape') return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) { e.target.blur(); return; }
    e.stopPropagation();
    api.close();
  }, true);

  const sub = (fn) => {
    cleanup?.(); cleanup = null;
    body.innerHTML = '';
    const back = document.createElement('div');
    const inner = document.createElement('div');
    body.appendChild(inner);
    back.className = 'row';
    back.innerHTML = '<button class="mbtn">← Voltar</button>';
    back.firstChild.onclick = () => main();
    body.appendChild(back);
    cleanup = fn(inner) || null;
  };

  const main = () => {
    cleanup?.(); cleanup = null;
    const s = game.session;
    const solo = !s || s.state === 'closed';
    let mp;
    if (solo) mp = '<button class="mbtn primary wide" data-a="host">Abrir sala para amigos<small>Eles entram no seu mundo pelo código</small></button>';
    else if (s.role === 'host') mp = `<button class="mbtn primary wide" data-a="room">Sala ${esc(s.code)} · ${s.count} jogador(es)<small>Código, convites e jogadores</small></button>`;
    else mp = `<button class="mbtn wide" data-a="leave">Sair da sala<small>Volta ao menu principal</small></button>`;
    body.innerHTML = `
      <h2>${solo ? 'Jogo pausado' : 'Menu'}</h2>
      <p class="muted">${solo ? 'O tempo para enquanto este menu está aberto.' : 'Em multijogador o jogo continua rodando.'}</p>
      <div class="pause-nav">
        <button class="mbtn primary wide" data-a="resume">Voltar ao jogo</button>
        ${mp}
        <button class="mbtn" data-a="test">Testar minha rede</button>
        <button class="mbtn" data-a="diag">Diagnóstico de rede</button>
        <button class="mbtn" data-a="settings">Configurações</button>
        <button class="mbtn" data-a="exit">Salvar e sair<small>para o menu principal</small></button>
      </div>`;
    const on = (a, fn) => { const b = body.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on('resume', () => api.close());
    on('host', () => {
      const ses = new Session();
      ses.host(game);
      sub((el) => roomPanel(el, ses));
    });
    on('room', () => sub((el) => roomPanel(el, game.session)));
    on('leave', () => exitToMenu(game));
    on('test', () => sub(netTestPanel));
    on('diag', () => sub(diagnosticsPanel));
    on('settings', () => sub((el) => settingsPanel(el, { game, onName: (n) => { if (game.session) game.session.name = n; } })));
    on('exit', () => exitToMenu(game));
  };

  const api = {
    isOpen: () => isOpen,
    open(what) {
      isOpen = true;
      root.classList.remove('hidden');
      game.ui.modal = true;
      game.ui.pause = true;
      if (what === 'room' && game.session?.role === 'host') sub((el) => roomPanel(el, game.session));
      else main();
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      cleanup?.(); cleanup = null;
      root.classList.add('hidden');
      game.ui.pause = false;
      game.ui.modal = false;
    },
    toggle() { if (isOpen) api.close(); else api.open(); },
  };
  return api;
}

export function exitToMenu(game) {
  try { saveGame(game); } catch (e) { console.error(e); }
  try { game.session?.close('saiu para o menu'); } catch { /* ignore */ }
  location.href = location.pathname; // boot shows the main menu
}
