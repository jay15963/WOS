// Shared panel builders for the main menu and the in-game menu: diagnostics, network test,
// settings, room (host) view, join-by-code flow and manual pairing. Each returns a cleanup fn.

import { netlog } from '../net/netlog.js';
import { probeNetwork, loadTurn, saveTurn } from '../net/rtc.js';
import { normalizeCode, playerName, setPlayerName, MAX_PLAYERS } from '../net/session.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

function flash(btn, text) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

const CLS = { error: 'e', warn: 'w', ok: 'o', info: '' };
function logLine(e) {
  return `<div class="${CLS[e.level] || ''}">+${e.t.toFixed(1)}s [${esc(e.cat)}] ${esc(e.msg)}${e.data ? ' <span class="muted">' + esc(e.data) + '</span>' : ''}</div>`;
}
export function liveLog(box, { limit = 80, filter = null } = {}) {
  const render = () => {
    const E = netlog.session.entries.filter((e) => !filter || filter(e)).slice(-limit);
    box.innerHTML = E.length ? E.map(logLine).join('') : '<span class="muted">Nenhum evento de rede ainda.</span>';
    box.scrollTop = box.scrollHeight;
  };
  render();
  let pending = false;
  const off = netlog.subscribe(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
    setTimeout(() => { if (pending) { pending = false; render(); } }, 250);
  });
  return off;
}

export function reportButtons(row) {
  row.insertAdjacentHTML('beforeend', `
    <button class="mbtn primary" data-a="copyrep">Copiar relatório</button>
    <button class="mbtn" data-a="dlrep">Baixar .txt</button>`);
  row.querySelector('[data-a=copyrep]').onclick = async (e) => {
    const ok = await copyText(netlog.report());
    flash(e.currentTarget, ok ? 'Copiado! Cole na conversa' : 'Não deu para copiar — use Baixar');
  };
  row.querySelector('[data-a=dlrep]').onclick = () => {
    const blob = new Blob([netlog.report()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wos-rede-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}

// ---------- diagnostics ----------
export function diagnosticsPanel(el) {
  el.innerHTML = `
    <h2>Diagnóstico de rede</h2>
    <p>Cada passo das tentativas de conexão fica registrado aqui, inclusive das últimas sessões (mesmo depois de recarregar).
       Se algo falhar, <b>os dois jogadores</b> tocam em <b>Copiar relatório</b> e colam na conversa. IPs públicos saem mascarados.</p>
    <div class="row"></div>
    <div class="logbox"></div>
    <div class="row"><button class="mbtn" data-a="clear">Limpar histórico</button></div>`;
  reportButtons(el.querySelector('.row'));
  const off = liveLog(el.querySelector('.logbox'), { limit: 150 });
  el.querySelector('[data-a=clear]').onclick = () => { netlog.clearAll(); el.querySelector('.logbox').innerHTML = '<span class="muted">Histórico apagado.</span>'; };
  return off;
}

// ---------- network test ----------
export function netTestPanel(el) {
  el.innerHTML = `
    <h2>Testar minha rede</h2>
    <p>Descobre se sua internet permite conexão direta com outro jogador (o tipo de NAT). Leva poucos segundos.</p>
    <div class="row"><button class="mbtn primary" data-a="run">Testar agora</button></div>
    <div class="res"></div>
    <div class="logbox" style="max-height:140px"></div>
    <div class="row"></div>`;
  const off = liveLog(el.querySelector('.logbox'), { limit: 30, filter: (e) => e.cat === 'nat' });
  reportButtons(el.querySelectorAll('.row')[1]);
  const res = el.querySelector('.res');
  el.querySelector('[data-a=run]').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.textContent = 'Testando…';
    res.innerHTML = '';
    const r = await probeNetwork();
    b.disabled = false; b.textContent = 'Testar de novo';
    const cls = r.verdict === 'compativel' || r.verdict === 'aberto' ? 'good' : r.verdict === 'simetrico' ? 'warn' : 'bad';
    res.innerHTML = `<div class="verdict ${cls}"><b>${esc(r.label)}</b>${esc(r.detail || '')}</div>`;
  };
  return off;
}

// ---------- settings ----------
export function settingsPanel(el, { game = null, onName = null } = {}) {
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const turn = loadTurn() || {};
  const audioOn = get('wos.audio.enabled', '1') !== '0';
  el.innerHTML = `
    <h2>Configurações</h2>
    <label class="mfield">Seu nome (aparece para outros jogadores)<input data-k="name" maxlength="18" value="${esc(playerName())}"></label>
    <label class="toggle"><input type="checkbox" data-k="audio" ${audioOn ? 'checked' : ''}> Som ligado</label>
    <label class="mfield">Volume<input type="range" data-k="vol" min="0" max="100" value="${Math.round(+get('wos.audio.volume', '0.8') * 100)}"></label>
    <label class="mfield">Qualidade gráfica
      <select data-k="quality">
        ${[['auto', 'Automática'], ['high', 'Alta'], ['medium', 'Média'], ['low', 'Baixa (celulares fracos)']].map(([v, l]) => `<option value="${v}" ${get('wos.quality', 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
    <h3>Avançado: servidor TURN (opcional)</h3>
    <p class="muted">Necessário quando o diagnóstico mostra <b>NAT incompatível</b>: o TURN repassa o tráfego quando a conexão direta é impossível.
      Basta o anfitrião configurar. Crie uma conta gratuita num provedor de TURN (ex.: Metered / Open Relay), copie as URLs
      (<code>turn:…</code> e <code>turns:…</code>), o usuário e a senha que ele mostrar e cole abaixo.</p>
    <label class="mfield">URLs (separe por vírgula)<input data-k="turnUrls" placeholder="turn:exemplo.com:3478" value="${esc([].concat(turn.urls || []).join(', '))}"></label>
    <div class="row">
      <label class="mfield" style="flex:1">Usuário<input data-k="turnUser" value="${esc(turn.username || '')}"></label>
      <label class="mfield" style="flex:1">Senha<input data-k="turnPass" type="password" value="${esc(turn.credential || '')}"></label>
    </div>
    <h3>Dados</h3>
    <div class="row"><button class="mbtn danger" data-a="wipe">Apagar todos os dados deste navegador</button></div>`;
  const q = (k) => el.querySelector(`[data-k=${k}]`);
  q('name').onchange = () => { setPlayerName(q('name').value); onName?.(playerName()); if (game) game.player.name = playerName(); };
  q('audio').onchange = () => { set('wos.audio.enabled', q('audio').checked ? '1' : '0'); if (game?.audio) game.audio.enabled = q('audio').checked; };
  q('vol').oninput = () => { const v = +q('vol').value / 100; set('wos.audio.volume', String(v)); if (game?.audio) game.audio.volume = v; };
  q('quality').onchange = () => { set('wos.quality', q('quality').value); if (game) applyQuality(game.R, q('quality').value); };
  const saveT = () => {
    const urls = q('turnUrls').value.split(',').map((s) => s.trim()).filter(Boolean);
    saveTurn(urls.length ? { urls, username: q('turnUser').value.trim() || undefined, credential: q('turnPass').value || undefined } : null);
    netlog.info('config', urls.length ? `Servidor TURN configurado (${urls.length} URL)` : 'Servidor TURN removido');
  };
  q('turnUrls').onchange = saveT; q('turnUser').onchange = saveT; q('turnPass').onchange = saveT;
  el.querySelector('[data-a=wipe]').onclick = () => {
    if (!confirm('Apagar mundos salvos, nome, configurações e histórico de rede deste navegador?')) return;
    try { Object.keys(localStorage).filter((k) => k.startsWith('wos.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    try { indexedDB.deleteDatabase('wos-atlas'); indexedDB.deleteDatabase('wos-cache'); } catch { /* ignore */ }
    location.href = location.pathname;
  };
  return () => {};
}

export function applyQuality(R, q) {
  if (!R) return;
  R.maxDpr = q === 'high' ? 2 : q === 'medium' ? 1.5 : q === 'low' ? 1 : 2;
  R.autoScale = q === 'auto';
  if (q !== 'auto') R.renderScale = 1;
  R.w = 0; // force resize
}

// ---------- host: room view (in-game) ----------
export function roomPanel(el, session) {
  const url = `${location.origin}${location.pathname}?sala=${session.code}`;
  el.innerHTML = `
    <h2>Sala aberta</h2>
    <p>Passe o código (ou o link) para seus amigos. Eles abrem o jogo → <b>Multijogador</b> → <b>Entrar com código</b>.</p>
    <div class="code-big">${esc(session.code)}</div>
    <div class="row"><button class="mbtn primary" data-a="copycode">Copiar código</button><button class="mbtn" data-a="copylink">Copiar link de convite</button></div>
    <h3>Jogadores (<span data-k="n"></span>/${MAX_PLAYERS})</h3>
    <ul class="plist" data-k="list"></ul>
    <h3>Se o amigo não conseguir entrar</h3>
    <p class="muted">Peça para os dois copiarem o relatório de diagnóstico. Se o erro for <b>NAT incompatível</b>, a conexão direta entre
      as duas redes é impossível: configure um <b>servidor TURN</b> gratuito em Configurações (basta o anfitrião).
      A <b>conexão manual</b> só ajuda quando as redes de encontro estão bloqueadas.</p>
    <div class="row"><button class="mbtn" data-a="manual">Conexão manual</button></div>
    <div data-k="manual"></div>
    <div class="row"></div>`;
  reportButtons(el.querySelectorAll('.row')[2]);
  el.querySelector('[data-a=copycode]').onclick = async (e) => flash(e.currentTarget, (await copyText(session.code)) ? 'Copiado!' : 'Falhou');
  el.querySelector('[data-a=copylink]').onclick = async (e) => flash(e.currentTarget, (await copyText(url)) ? 'Link copiado!' : 'Falhou');
  const list = el.querySelector('[data-k=list]'), n = el.querySelector('[data-k=n]');
  const renderList = () => {
    n.textContent = session.count;
    const rows = [`<li><span>${esc(session.name)} <span class="muted">(você, anfitrião)</span></span><span></span></li>`];
    for (const p of session.players.values()) rows.push(`<li><span>${esc(p.name)}</span><span class="muted">${p.rtt != null ? Math.round(p.rtt) + ' ms' : '…'}</span></li>`);
    list.innerHTML = rows.join('');
  };
  renderList();
  const offs = [session.on('players', renderList), session.on('rtt', renderList)];
  el.querySelector('[data-a=manual]').onclick = async () => {
    const box = el.querySelector('[data-k=manual]');
    box.innerHTML = '<p class="muted">Gerando convite…</p>';
    try {
      const invite = await session.manualInvite();
      box.innerHTML = `
        <p><b>1.</b> Envie este convite para o amigo (WhatsApp etc.). Ele cola em <i>Multijogador → Conexão manual</i>:</p>
        <label class="mfield"><textarea readonly>${esc(invite)}</textarea></label>
        <div class="row"><button class="mbtn" data-a="cpinv">Copiar convite</button></div>
        <p><b>2.</b> Cole aqui a resposta que ele mandar de volta:</p>
        <label class="mfield"><textarea data-k="ans" placeholder="WOS1-…"></textarea></label>
        <div class="row"><button class="mbtn primary" data-a="apply">Conectar</button></div>
        <p class="muted" data-k="mst"></p>`;
      box.querySelector('[data-a=cpinv]').onclick = async (e) => flash(e.currentTarget, (await copyText(invite)) ? 'Copiado!' : 'Falhou');
      box.querySelector('[data-a=apply]').onclick = async () => {
        const st = box.querySelector('[data-k=mst]');
        try { await session.manualAccept(box.querySelector('[data-k=ans]').value); st.textContent = 'Resposta aplicada. Conectando… (veja o diagnóstico se demorar)'; } catch (e) { st.textContent = 'Erro: ' + e.message; }
      };
    } catch (e) { box.innerHTML = `<p class="muted">Erro: ${esc(e.message)}</p>`; }
  };
  return () => offs.forEach((f) => f());
}

// ---------- guest: join flow (main menu, before the world exists) ----------
// onJoined(session, welcome) is called on success.
export function joinPanel(el, { makeSession, onJoined, presetCode = '' }) {
  el.innerHTML = `
    <h2>Entrar com código</h2>
    <p>Digite o código de 6 letras que o anfitrião passou.</p>
    <input class="minput code-input" maxlength="6" placeholder="K7M4QX" value="${esc(normalizeCode(presetCode))}" autocomplete="off" autocapitalize="characters" spellcheck="false">
    <div class="row"><button class="mbtn primary" data-a="go">Entrar</button><button class="mbtn" data-a="manual">Conexão manual</button></div>
    <ul class="steps hidden">
      <li data-s="net">Conectando às redes de encontro</li>
      <li data-s="find">Procurando a sala</li>
      <li data-s="rtc">Conexão direta com o anfitrião (WebRTC)</li>
      <li data-s="hello">Recebendo o mundo</li>
    </ul>
    <div class="res"></div>
    <div class="logbox hidden" style="max-height:160px"></div>
    <div class="row hidden" data-k="rep"></div>
    <div data-k="manualbox"></div>`;
  const input = el.querySelector('.code-input');
  input.oninput = () => { input.value = normalizeCode(input.value); };
  setTimeout(() => input.focus(), 50);
  const steps = el.querySelector('.steps'), res = el.querySelector('.res'), box = el.querySelector('.logbox'), rep = el.querySelector('[data-k=rep]');
  reportButtons(rep);
  const setStep = (s, cls) => { const li = steps.querySelector(`[data-s=${s}]`); if (li) li.className = cls; };
  let offLog = null, session = null;
  const go = async () => {
    const code = normalizeCode(input.value);
    if (code.length !== 6) { res.innerHTML = '<div class="verdict warn"><b>Código incompleto</b>São 6 letras/números.</div>'; return; }
    el.querySelector('[data-a=go]').disabled = true;
    steps.classList.remove('hidden'); box.classList.remove('hidden'); rep.classList.remove('hidden');
    res.innerHTML = '';
    ['net', 'find', 'rtc', 'hello'].forEach((s) => setStep(s, ''));
    setStep('net', 'doing');
    offLog?.();
    offLog = liveLog(box, { limit: 40 });
    const offStep = netlog.subscribe((e) => {
      if (e.cat === 'signal' && /na sala/.test(e.msg)) { setStep('net', 'done'); setStep('find', 'doing'); }
      if (e.cat === 'ice' && /conexão WebRTC criada/.test(e.msg)) { setStep('find', 'done'); setStep('rtc', 'doing'); }
      if (e.cat === 'signal' && /conectado a um jogador/.test(e.msg)) { setStep('find', 'done'); setStep('rtc', 'done'); setStep('hello', 'doing'); }
      if (e.cat === 'ice' && /conexão falhou/.test(e.msg)) setStep('rtc', 'fail');
    });
    session = makeSession();
    try {
      const welcome = await session.join(code);
      offStep();
      setStep('hello', 'done');
      res.innerHTML = `<div class="verdict good"><b>Conectado!</b>Entrando no mundo de ${esc(welcome.hostName)}…</div>`;
      offLog?.();
      onJoined(session, welcome);
    } catch (e) {
      offStep();
      ['net', 'find', 'rtc', 'hello'].forEach((s) => { const li = steps.querySelector(`[data-s=${s}]`); if (li.className === 'doing') li.className = 'fail'; });
      res.innerHTML = `<div class="verdict bad"><b>Não foi possível entrar</b>${esc(e.message)}<br><br>
        Se a mensagem fala em <b>NAT incompatível</b>, o anfitrião precisa configurar um <b>servidor TURN</b> gratuito em Configurações.
        Senão, confira o código e se a sala está aberta. Em todo caso: <b>Copiar relatório</b> nos dois e cole na conversa.</div>`;
      el.querySelector('[data-a=go]').disabled = false;
      el.querySelector('[data-a=go]').textContent = 'Tentar de novo';
    }
  };
  el.querySelector('[data-a=go]').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  el.querySelector('[data-a=manual]').onclick = () => manualGuestFlow(el.querySelector('[data-k=manualbox]'), { makeSession, onJoined });
  return () => { offLog?.(); };
}

function manualGuestFlow(box, { makeSession, onJoined }) {
  box.innerHTML = `
    <h3>Conexão manual</h3>
    <p class="muted">Sem redes de encontro: o anfitrião gera um <b>convite</b> (em Multijogador → Conexão manual, dentro do jogo dele),
      você cola aqui, copia a <b>resposta</b> e manda de volta para ele.</p>
    <label class="mfield">Convite do anfitrião<textarea data-k="inv" placeholder="WOS1-…"></textarea></label>
    <div class="row"><button class="mbtn primary" data-a="mk">Gerar resposta</button></div>
    <div data-k="out"></div>`;
  box.querySelector('[data-a=mk]').onclick = async () => {
    const out = box.querySelector('[data-k=out]');
    out.innerHTML = '<p class="muted">Preparando…</p>';
    const session = makeSession();
    try {
      const answer = await session.manualJoin(box.querySelector('[data-k=inv]').value);
      out.innerHTML = `
        <p>Envie esta resposta para o anfitrião colar no jogo dele:</p>
        <label class="mfield"><textarea readonly>${esc(answer)}</textarea></label>
        <div class="row"><button class="mbtn" data-a="cp">Copiar resposta</button></div>
        <p class="muted">Aguardando o anfitrião aplicar a resposta…</p>`;
      out.querySelector('[data-a=cp]').onclick = async (e) => flash(e.currentTarget, (await copyText(answer)) ? 'Copiado!' : 'Falhou');
      const welcome = await session.welcome;
      onJoined(session, welcome);
    } catch (e) { out.innerHTML = `<div class="verdict bad"><b>Erro</b>${esc(e.message)}</div>`; }
  };
}
