// Skirmish ("Escaramuça", docs/SKIRMISH.md): the lobby, the countdown, the scoreboard and the results. Everything is drawn
// from the shared state game.skirmish.st (game/mut/skirmish.js) — the host's settings, the players' picks, the phase, the
// score — and every change a player makes goes to the host as an intent (sk.set / sk.pick / sk.start / sk.lobby).
// Desktop: a war table in the middle of the screen over the live arena; phone (915 × 412): the whole screen, two columns.

import { MODES, MODE_LIST, PLACES, PLACE_LIST, FAMS, FAM_LIST, CLASSES, CLASS_LIST, TOTAL, SHARE, MATCH, ROLE_PT, sidesOf, giantsFor } from '../game/content/skirmish.js';
import { startWhy } from '../game/skirmish.js';
import { Session, MAX_PLAYERS } from '../net/session.js';
import { copyText } from './netpanels.js';
import { exitToMenu } from './netui.js';
import { bannerURL } from './heraldry.js';
import { itemIcon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (c) => (Array.isArray(c) ? '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : '#888');
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- icons (inline SVG, currentColor) ----------
const SVG = {
  swords: '<path d="M4 4l10 10M14 14l2.6 2.6M4 4h3.2L18 14.8M4 4v3.2L14.8 18"/><path d="M20 4L10 14M10 14l-2.6 2.6M20 4h-3.2L6 14.8M20 4v3.2L9.2 18"/><path d="M15.6 18.4l2 2M18.4 15.6l2 2M8.4 18.4l-2 2M5.6 15.6l-2 2"/>',
  field: '<path d="M3 19h18"/><path d="M6 19v-6l-2-2M6 13l2-2"/><path d="M18 19v-6l2-2M18 13l-2-2"/><circle cx="6" cy="8" r="1.6"/><circle cx="18" cy="8" r="1.6"/><path d="M10 15l4-4M14 15l-4-4"/>',
  siege: '<path d="M4 20V9l2-1.5L8 9v3h2V7l2-1.5L14 7v5h2V9l2-1.5L20 9v11z"/><path d="M10 20v-3.5a2 2 0 0 1 4 0V20"/><path d="M2 20h20"/>',
  monsters: '<path d="M12 3a7 7 0 0 0-7 7v4l1.6 2v3h2.4v-2h2v2h2v-2h2v2h2.4v-3L19 14v-4a7 7 0 0 0-7-7z"/><circle cx="9.2" cy="11" r="1.6"/><circle cx="14.8" cy="11" r="1.6"/><path d="M11 14.5h2"/>',
  village: '<path d="M3 20h18"/><path d="M5 20v-7l4-3.5 4 3.5v7"/><path d="M13 20v-5l3.5-3 3.5 3v5"/><path d="M8 20v-3h2v3"/>',
  palisade: '<path d="M3 20h18"/><path d="M4 20V9l1-2 1 2v11M8 20V9l1-2 1 2v11M12 20V9l1-2 1 2v11M16 20V9l1-2 1 2v11"/><path d="M3 12h18"/>',
  castle: '<path d="M3 20h18"/><path d="M5 20V8h2v2h2V8h2v4h2V8h2v2h2V8h2v12"/><path d="M10 20v-4a2 2 0 0 1 4 0v4"/>',
  city: '<path d="M2 20h20"/><path d="M3 20v-8h3v-2h2v2h3V6l1.5-2L14 6v6h3v-2h2v2h2v8"/><path d="M11 20v-3h2v3"/>',
  ice: '<path d="M12 2v20M3.4 7l17.2 10M3.4 17L20.6 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>',
  bone: '<path d="M8.5 6.5a2.5 2.5 0 1 0-3.5 3.5l9 9a2.5 2.5 0 1 0 3.5-3.5 2.5 2.5 0 1 0-3.5-3.5z"/><circle cx="7" cy="7" r="0.6"/>',
  sand: '<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  door: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  crown: '<path d="M4 18h16l1-10-5 3.5L12 5l-4 6.5L3 8z"/>',
  skull: '<circle cx="12" cy="10" r="6"/><path d="M9 16v3h6v-3"/><circle cx="9.5" cy="10" r="1.2"/><circle cx="14.5" cy="10" r="1.2"/>',
};
const svg = (k, cls = '') => `<svg class="ski ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[k] || ''}</svg>`;

let cssDone = false;
function loadCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./skirmish.css', import.meta.url).href;
  document.head.appendChild(l);
}

export function installSkirmishUI(game) {
  loadCss();
  const root = document.createElement('div');
  root.id = 'sk';
  root.innerHTML = `
    <div class="sk-lobby hidden" role="dialog" aria-label="Escaramuça"></div>
    <div class="sk-board hidden"></div>
    <div class="sk-count hidden"><b></b><small></small></div>
    <div class="sk-wait hidden"><i></i><span></span></div>
    <div class="sk-res hidden" role="dialog" aria-label="Resultado"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const lobby = $('.sk-lobby'), board = $('.sk-board'), count = $('.sk-count'), wait = $('.sk-wait'), res = $('.sk-res');
  const ui = { key: '', boardKey: '', resKey: '', banner: 0, pend: null, setT: 0, local: null, lastCount: -1, deathEl: null };
  const isHost = () => game.net.role !== 'guest';
  const me = () => game.net.pid;
  const R = () => game.towns?.realm || null;
  const K = (k) => R()?.kingdoms[k] || null;
  const kName = (k) => K(k)?.name || '?';
  const shieldImg = (k, W = 34, H = 40) => { const B = K(k)?.banner; const u = B ? bannerURL(B, W, H, 'shield') : ''; return u ? `<img class="sk-crest" src="${u}" alt="">` : ''; };
  const A = game.A;
  const itemImg = (id) => { try { return itemIcon(A, id); } catch { return ''; } };
  const REJ = { onReject: (why) => why && game.events.emit('error', { text: why }) };

  // ---------- the lobby ----------
  // the local view of the sliders while dragging (the host's op comes back a moment later)
  const setOf = (st) => ({ ...st.set, ...(ui.local || {}) });
  function lobbyHtml(st) {
    const S = setOf(st), host = isHost(), mode = S.mode, my = st.picks.find((p) => p[0] === me()), ar = st.arena;
    const [nA, nB] = sidesOf(S.total, S.pa), mon = mode === 'monsters', roles = ROLE_PT[mode];
    const ka = ar?.ka ?? -1, kb = ar?.kb ?? -1;
    const sess = game.session && game.session.state !== 'closed' ? game.session : null;
    const room = !sess ? (host ? `<button class="sk-btn ghost" data-a="open">${svg('link')}<span><b>Abrir para amigos</b><small>Eles entram pelo código, direto aqui</small></span></button>` : '')
      : `<div class="sk-code"><small>Sala</small><b>${esc(sess.code === 'MANUAL' ? 'manual' : sess.code)}</b><span>${sess.count}/${MAX_PLAYERS}</span></div>${host ? `<button class="sk-btn ghost sm" data-a="copy">Copiar código</button><button class="sk-btn ghost sm" data-a="link">Copiar convite</button>` : ''}`;
    const card = (grp, id, icon, title, sub, on, dis) => `<button class="sk-card${on ? ' on' : ''}" data-g="${grp}" data-v="${id}" ${dis ? 'disabled' : ''} aria-pressed="${on}">${icon ? svg(icon) : ''}<span><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
    const where = ar ? (ar.sid >= 0 ? `${esc(ar.name)} · Reino de ${esc(kName(kb))}${ar.far > 30 ? ` · ${ar.far} passos do início` : ''}` : `${esc(ar.name)}`) : 'Nenhum lugar assim neste mundo';
    const giants = mon ? giantsFor(nA) : 0;
    const shareTxt = mon ? `<b>${nB}</b> defensores · <b>${nA}</b> monstros${giants ? ` <em>(${giants} ${giants === 1 ? 'gigante' : 'gigantes'})</em>` : ''}`
      : `<b>${nA}</b> ${esc(roles.a)} · <b>${nB}</b> ${esc(roles.b)}`;
    const sideCol = (side) => {
      const k = side === 'a' ? ka : kb, players = st.picks.filter((p) => p[2] === side), n = side === 'a' ? nA : nB;
      const head = mon && side === 'a' ? `<div class="sk-sidehead mon">${svg(S.fam)}<span><b>${esc(FAMS[S.fam].pt)}</b><small>${n} monstros${giants ? ` · ${giants} ${giants === 1 ? 'gigante' : 'gigantes'}` : ''}</small></span></div>`
        : `<div class="sk-sidehead" style="--kc:${hex(K(k)?.color)}">${shieldImg(k)}<span><b>${esc(roles[side])}</b><small>Reino de ${esc(kName(k))} · ${n} soldados</small></span></div>`;
      const rows = players.map((p) => `<li class="${p[0] === me() ? 'me' : ''}"><span class="sk-cls">${itemImg(CLASSES[p[3]]?.main)}</span><b>${esc(p[1])}</b><small>${esc(CLASSES[p[3]]?.pt || '')}</small>${p[4] || p[0] === st.host ? `<i class="ok">${svg('check')}</i>` : '<i class="no">…</i>'}</li>`).join('');
      const can = !(mon && side === 'a') && my && my[2] !== side;
      return `<div class="sk-side s-${side}${mon && side === 'a' ? ' mon' : ''}">${head}<ul>${rows || `<li class="empty">${mon && side === 'a' ? 'Os monstros vêm na noite' : 'Ninguém deste lado'}</li>`}</ul>${can ? `<button class="sk-btn sm" data-a="side" data-v="${side}">Jogar deste lado</button>` : ''}</div>`;
    };
    const why = host ? startWhy({ ...st, set: S }, me()) : null;
    return `
      <div class="sk-win">
        <header class="sk-head">
          <div class="sk-title">${svg('swords', 'big')}<span><b>Escaramuça</b><small>A guerra do jogo, sem perder nada: nada aqui vai para os seus mundos.</small></span></div>
          <div class="sk-room">${room}</div>
        </header>
        <div class="sk-body">
          <section class="sk-set${host ? '' : ' ro'}">
            ${host ? '' : '<p class="sk-note">O anfitrião escolhe a partida.</p>'}
            <h3>Modo</h3>
            <div class="sk-cards c3">${MODE_LIST.map((m) => card('mode', m, m, MODES[m].pt, MODES[m].sub, mode === m, !host)).join('')}</div>
            ${mode !== 'field' ? `<h3>Lugar</h3><div class="sk-cards c4">${PLACE_LIST.map((p) => card('place', p, p, PLACES[p].pt, PLACES[p].sub, S.place === p, !host)).join('')}</div>` : ''}
            <p class="sk-where">${svg(mode === 'field' ? 'field' : S.place)}<span>${where}</span></p>
            ${mon ? `<h3>Monstros do inverno</h3><div class="sk-cards c3">${FAM_LIST.map((f) => card('fam', f, f, FAMS[f].pt, `e ${FAMS[f].giantPt}`, S.fam === f, !host)).join('')}</div>` : ''}
            <h3>Soldados na batalha <output>${S.total}</output></h3>
            <input class="sk-range" type="range" data-k="total" min="${mode === 'field' ? TOTAL.min : TOTAL.minNpc}" max="${TOTAL.max}" step="${TOTAL.step}" value="${S.total}" ${host ? '' : 'disabled'} aria-label="Soldados na batalha">
            <h3>Proporção ${mon ? '<small>defensores · monstros</small>' : '<small>lado A · lado B</small>'}</h3>
            <input class="sk-range share" type="range" data-k="pa" min="${SHARE.min}" max="${SHARE.max}" step="${SHARE.step}" value="${mon ? 100 - S.pa : S.pa}" ${host ? '' : 'disabled'} aria-label="Proporção" style="--a:${mon ? '#8fd0ff' : hex(K(ka)?.color)};--b:${mon ? hex(K(kb)?.color) : hex(K(kb)?.color)}">
            <div class="sk-split"><i style="width:${S.total ? (mon ? (nB / S.total) * 100 : (nA / S.total) * 100) : 50}%"></i></div>
            <p class="sk-share">${S.total ? shareTxt : 'Só os jogadores: um duelo (PvP) até 10 abates'}</p>
            <p class="sk-rule">${mon ? 'Um gigante a cada 25 monstros (a partir de 20). ' : ''}Soldados: armadura e armas de cobre. Jogadores: armadura de ferro e armas de aço.</p>
          </section>
          <section class="sk-sides">
            <div class="sk-cols">${sideCol('a')}${sideCol('b')}</div>
            <h3>Sua classe</h3>
            <div class="sk-cards c3 cls">${CLASS_LIST.map((c) => `<button class="sk-card cl${my?.[3] === c ? ' on' : ''}" data-g="cls" data-v="${c}" aria-pressed="${my?.[3] === c}"><span class="sk-cls">${itemImg(CLASSES[c].main)}</span><span><b>${CLASSES[c].pt}</b><small>${esc(CLASSES[c].kitPt)}</small></span></button>`).join('')}</div>
            ${st.res ? `<p class="sk-last">Última partida: <b>${esc(winText(st.res))}</b> — ${esc(st.res.why)}</p>` : ''}
          </section>
        </div>
        <footer class="sk-foot">
          <button class="sk-btn ghost" data-a="exit">${svg('door')}<span>Sair</span></button>
          <span class="sk-why">${host ? esc(why || 'Tudo pronto') : my?.[4] ? 'Pronto · aguardando o anfitrião' : 'Marque “Estou pronto” quando escolher'}</span>
          ${host ? `<button class="sk-btn primary" data-a="start" ${why ? 'disabled' : ''}>${svg('swords')}<span>Iniciar partida</span></button>`
            : `<button class="sk-btn ${my?.[4] ? 'on' : 'primary'}" data-a="ready">${svg('check')}<span>${my?.[4] ? 'Pronto!' : 'Estou pronto'}</span></button>`}
        </footer>
      </div>`;
  }
  function wireLobby(st) {
    lobby.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.g, v = b.dataset.v;
      game.audio?.play('ui_click', {});
      if (g === 'cls') { game.net.request('sk.pick', { cls: v }, REJ); return; }
      if (!isHost()) return;
      game.net.request('sk.set', { [g]: v }, REJ);
    }));
    lobby.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      game.audio?.play('ui_click', {});
      if (a === 'side') game.net.request('sk.pick', { side: b.dataset.v }, REJ);
      else if (a === 'ready') { const my = game.skirmish.st.picks.find((p) => p[0] === me()); game.net.request('sk.pick', { ready: my?.[4] ? 0 : 1 }, REJ); }
      else if (a === 'start') game.net.request('sk.start', {}, REJ);
      else if (a === 'exit') exitToMenu(game);
      else if (a === 'open') { const s = new Session(); if (s.host(game)) { ui.key = ''; } }
      else if (a === 'copy') { const ok = await copyText(game.session?.code || ''); flash(b, ok ? 'Copiado!' : 'Falhou'); }
      else if (a === 'link') { const ok = await copyText(`${location.origin}${location.pathname}?sala=${game.session?.code || ''}`); flash(b, ok ? 'Link copiado!' : 'Falhou'); }
    }));
    lobby.querySelectorAll('.sk-range').forEach((r) => {
      const k = r.dataset.k, val = () => { const v = +r.value; return k === 'pa' && game.skirmish.st.set.mode === 'monsters' ? 100 - v : v; };
      r.addEventListener('input', () => {
        ui.local = { ...(ui.local || {}), [k]: val() };
        paintLive(game.skirmish.st);
        if (game.time - ui.setT > 0.12) { ui.setT = game.time; game.net.request('sk.set', { [k]: val() }, REJ); }
      });
      r.addEventListener('change', () => { game.net.request('sk.set', { [k]: val() }, REJ); ui.setT = game.time; setTimeout(() => { ui.local = null; ui.key = ''; }, 400); });
      ['keydown', 'keyup'].forEach((ev) => r.addEventListener(ev, (e) => e.stopPropagation()));
    });
    void st;
  }
  // the numbers under the sliders, live while dragging (no full repaint: the thumb stays under the finger)
  function paintLive(st) {
    const S = setOf(st), [nA, nB] = sidesOf(S.total, S.pa), mon = S.mode === 'monsters', g = mon ? giantsFor(nA) : 0, roles = ROLE_PT[S.mode];
    const o = lobby.querySelector('h3 output'); if (o) o.textContent = S.total;
    const bar = lobby.querySelector('.sk-split i'); if (bar) bar.style.width = `${S.total ? ((mon ? nB : nA) / S.total) * 100 : 50}%`;
    const sh = lobby.querySelector('.sk-share');
    if (sh) sh.innerHTML = S.total ? (mon ? `<b>${nB}</b> defensores · <b>${nA}</b> monstros${g ? ` <em>(${g} ${g === 1 ? 'gigante' : 'gigantes'})</em>` : ''}` : `<b>${nA}</b> ${esc(roles.a)} · <b>${nB}</b> ${esc(roles.b)}`) : 'Só os jogadores: um duelo (PvP) até 10 abates';
  }
  function flash(b, t) { const s = b.querySelector('span') || b; const o = s.textContent; s.textContent = t; setTimeout(() => { s.textContent = o; }, 1500); }

  // ---------- the scoreboard ----------
  function boardHtml(st) {
    const M = st.match, sc = st.score || { a: [M.nA, M.nA], b: [M.nB, M.nB] }, mon = M.mode === 'monsters', roles = ROLE_PT[M.mode];
    const side = (s) => {
      const k = s === 'a' ? M.ka : M.kb, v = sc[s] || [0, 0], k0 = Math.max(1, v[1]);
      const head = mon && s === 'a' ? `${svg(M.fam, 'crest')}` : shieldImg(k, 26, 30);
      return `<div class="sb-side s-${s}" style="--kc:${mon && s === 'a' ? '#8fd0ff' : hex(K(k)?.color)}">${head}<span class="sb-t"><small>${esc(mon && s === 'a' ? FAMS[M.fam].pt : roles[s])}</small><b>${v[0]}<em>/${v[1]}</em></b></span><i class="sb-bar"><u style="width:${(v[0] / k0) * 100}%"></u></i></div>`;
    };
    const mine = game.skirmish.sideOf(me());
    const k = sc.kills?.[me()] || 0;
    return `${side('a')}<div class="sb-mid"><b class="sb-clock">0:00</b><small>${esc(M.name)}</small>${mine ? `<small class="sb-me">${k} ${k === 1 ? 'abate' : 'abates'}</small>` : '<small class="sb-me">assistindo</small>'}</div>${side('b')}`;
  }

  // ---------- the results ----------
  const winText = (r) => (r.win === 'draw' ? 'Empate' : r.mode === 'monsters' ? (r.win === 'b' ? 'Os defensores venceram' : 'Os monstros venceram') : `Vitória do Reino de ${kName(r.win === 'a' ? r.ka : r.kb)}`);
  function resHtml(st) {
    const r = st.res, mine = r.players.find((p) => p[0] === me()), won = mine && r.win === mine[2], lost = mine && r.win !== 'draw' && r.win !== mine[2];
    const roles = ROLE_PT[r.mode];
    const row = (s) => `<div class="rs-side s-${s}" style="--kc:${r.mode === 'monsters' && s === 'a' ? '#8fd0ff' : hex(K(s === 'a' ? r.ka : r.kb)?.color)}">${r.mode === 'monsters' && s === 'a' ? svg(st.match?.fam || 'ice', 'crest') : shieldImg(s === 'a' ? r.ka : r.kb, 30, 36)}<span><b>${esc(r.mode === 'monsters' && s === 'a' ? 'Monstros' : roles[s])}</b><small>${r.mode === 'monsters' && s === 'a' ? '' : 'Reino de ' + esc(kName(s === 'a' ? r.ka : r.kb))}</small></span><span class="rs-n"><b>${r.lost[s === 'a' ? 0 : 1]}</b><small>de ${r.n0[s === 'a' ? 0 : 1]} ${r.mode === 'monsters' && s === 'a' ? 'caíram' : 'perdidos'}</small></span>${r.win === s ? `<i class="rs-crown">${svg('crown')}</i>` : ''}</div>`;
    const players = r.players.slice().sort((a, b) => b[4] - a[4] || a[5] - b[5]).map((p) => `<tr class="${p[0] === me() ? 'me' : ''} s-${p[2]}"><td><span class="sk-cls">${itemImg(CLASSES[p[3]]?.main)}</span><b>${esc(p[1])}</b></td><td>${esc(r.mode === 'monsters' ? 'Defensor' : roles[p[2]])}</td><td>${esc(CLASSES[p[3]]?.pt || '')}</td><td class="n">${p[4]}</td><td class="n">${p[5]}</td></tr>`).join('');
    const host = isHost();
    return `<div class="rs-win ${won ? 'good' : lost ? 'bad' : ''}">
      <div class="rs-banner">${svg(won ? 'crown' : lost ? 'skull' : 'swords', 'big')}<span><b>${won ? 'Vitória!' : lost ? 'Derrota' : esc(winText(r))}</b><small>${esc(won || lost ? winText(r) + ' · ' : '')}${esc(r.why)}</small></span><em>${mmss(r.t)}</em></div>
      <div class="rs-sides">${row('a')}${row('b')}</div>
      <table class="rs-table"><thead><tr><th>Jogador</th><th>Lado</th><th>Classe</th><th class="n">Abates</th><th class="n">Mortes</th></tr></thead><tbody>${players}</tbody></table>
      <footer class="sk-foot">
        <button class="sk-btn ghost" data-a="exit">${svg('door')}<span>Sair</span></button>
        <span class="sk-why">${host ? 'Mesmas escolhas, de volta ao lobby' : 'O anfitrião decide se joga de novo'}</span>
        ${host ? `<button class="sk-btn primary" data-a="again">${svg('swords')}<span>Jogar de novo</span></button>` : '<button class="sk-btn" disabled><span>Aguardando o anfitrião…</span></button>'}
      </footer></div>`;
  }

  // ---------- show / hide by the phase ----------
  const show = (el, on) => el.classList.toggle('hidden', !on);
  function render(force = false) {
    const st = game.skirmish?.st;
    if (!st) { [lobby, board, count, wait, res].forEach((e) => show(e, false)); return; }
    const side = game.skirmish.sideOf(me()), ph = st.phase;
    // the lobby (repainted when its state changes; not while a slider is held)
    if (ph === 'lobby') {
      const k = JSON.stringify([st.v, game.session?.state, game.session?.count, game.session?.code]);
      if (force || k !== ui.key) {
        if (!(ui.local && document.activeElement?.classList?.contains('sk-range'))) { ui.key = k; lobby.innerHTML = lobbyHtml(st); wireLobby(st); }
      }
      show(lobby, true);
      game.ui.modal = true;
    } else { if (!lobby.classList.contains('hidden')) game.ui.modal = false; show(lobby, false); ui.key = ''; }
    // the wait (the place being made, the forces raised)
    show(wait, ph === 'prep' || ((ph === 'count' || ph === 'fight') && !side));
    if (ph === 'prep') wait.querySelector('span').textContent = side ? `Preparando o campo de batalha: ${st.match?.name || ''}…` : 'Uma partida vai começar — você entra na próxima';
    else if (!side && (ph === 'count' || ph === 'fight')) wait.querySelector('span').textContent = 'Partida em andamento — você entra na próxima';
    // the scoreboard
    const onBoard = !!st.match && (ph === 'count' || ph === 'fight' || ph === 'end');
    if (onBoard) { const k = JSON.stringify([st.match.id, st.score, ph]); if (k !== ui.boardKey) { ui.boardKey = k; board.innerHTML = boardHtml(st); } }
    show(board, onBoard);
    // the results
    if (ph === 'end' && st.res) {
      if (ui.resKey !== st.res.id) { ui.resKey = st.res.id; ui.banner = game.time; res.innerHTML = resHtml(st); res.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { game.audio?.play('ui_click', {}); if (b.dataset.a === 'exit') exitToMenu(game); else game.net.request('sk.lobby', {}, REJ); })); res.classList.remove('in'); }
    } else { ui.resKey = ''; show(res, false); }
  }
  game.events.on('skirmish', ({ st, prev }) => {
    render();
    if (prev && prev.phase !== st.phase) phaseSound(st);
  });
  function phaseSound(st) {
    if (st.phase === 'fight') game.audio?.play('horn', {}); // (the big "Lutem!" says it: no toast)
    if (st.phase === 'end' && st.res) {
      const mine = st.res.players.find((p) => p[0] === me());
      game.audio?.play(mine && st.res.win === mine[2] ? 'levelup' : 'ui_click', {});
    }
  }

  let t = 0;
  return {
    sync: 'cosmetic',
    update(g, dt) {
      const st = g.skirmish?.st;
      t -= dt;
      if (t <= 0) { t = 0.25; render(); }
      if (!st) return;
      // the clock of the match and the countdown
      if (st.match && (st.phase === 'fight' || st.phase === 'end')) {
        const el = board.querySelector('.sb-clock');
        if (el) { const left = st.phase === 'end' ? st.res?.t ?? 0 : g.worldTime - st.match.t0; el.textContent = mmss(st.phase === 'end' ? left : left); el.classList.toggle('late', st.phase === 'fight' && st.match.limit - left < 60); }
      }
      const cd = st.phase === 'count' && st.match ? Math.ceil(st.match.countT - g.worldTime) : -1;
      const fightFlash = st.phase === 'fight' && st.match && g.worldTime - st.match.t0 < 1.4;
      show(count, (cd > 0 && !!g.skirmish.sideOf(me())) || fightFlash);
      if (cd > 0 && cd !== ui.lastCount) { ui.lastCount = cd; count.querySelector('b').textContent = cd; count.querySelector('small').textContent = st.match.mode === 'monsters' ? 'A onda chega' : st.match.mode === 'siege' ? 'O cerco começa' : 'As linhas se formam'; count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop'); g.audio?.play('ui_click', {}); }
      if (fightFlash && ui.lastCount !== 0) { ui.lastCount = 0; count.querySelector('b').textContent = st.match.mode === 'monsters' ? 'Defendam!' : 'Lutem!'; count.querySelector('small').textContent = ''; count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop'); }
      if (st.phase === 'lobby') ui.lastCount = -1;
      // the results come up after the last blows
      if (st.phase === 'end' && st.res && res.classList.contains('hidden') && g.time - ui.banner > MATCH.endShow - 0.5) { show(res, true); requestAnimationFrame(() => res.classList.add('in')); }
      // a fallen player: back by itself at its side's rear (no button: the count shows)
      const p = g.player, inM = !!g.skirmish.sideOf(me()) && st.phase !== 'lobby';
      const btn = document.getElementById('btn-respawn'), sub = document.getElementById('death-sub');
      if (inM && p.dead) {
        if (btn) btn.style.display = 'none';
        if (sub) sub.textContent = `Você renasce na retaguarda do seu lado em ${Math.ceil(g.skirmish.respawnLeft() || MATCH.respawn)} s, com todo o equipamento.`;
        ui.heldBtn = true;
      } else if (ui.heldBtn) { ui.heldBtn = false; if (btn) btn.style.display = ''; }
    },
  };
}
