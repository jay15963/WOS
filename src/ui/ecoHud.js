// The economy in the HUD (docs/REINOS.md "Fase 2 — economia", game/eco.js): the purse (gold coins in the backpack, a
// floating +/− on every change), the job tracker (your jobs: progress, where to go — distance and an arrow; a tap follows
// one: the waypoint), the waypoint on the radar ring / the map / the world (a gold marker over the spot), the outlines of
// a town's plots (after "Ver" in Propriedades, in build mode on a town land, near your own plot) and the notices:
// reputation rank up / down, a job done / expired, the day's tax paid / owed (3 days of warning), a property taken.
// Cosmetic and local (sync 'cosmetic'): reads game.eco (replicated) and the local player.

import { itemIco } from './econIcons.js';
import { notify } from './notify.js';
import { COIN, PARCEL, meUid, myRec, jobState, jobTarget, jobWaypoint, settlement, kingdomOf, propById, propsOf, fmt, RANK_LIST, REP } from '../game/eco.js';
import { JOB_KINDS, PROP } from '../game/content/eco.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `
#purse { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px 0 5px; border-radius: 15px; pointer-events: auto; position: relative;
  background: linear-gradient(180deg, rgba(62,41,24,0.92), rgba(36,22,13,0.92)); border: 2px solid var(--n-ink, #24160d);
  box-shadow: inset 0 0 0 1px rgba(247,217,122,0.35), 0 2px 0 rgba(20,12,6,0.4); cursor: pointer; }
#purse .pc { width: 24px; height: 24px; }
#purse .pc .spri, #purse .pc .emo { width: 100%; height: 100%; display: block; font-size: 18px; }
#purse b { font: 800 18px/1 var(--n-fd); color: #ffe39a; letter-spacing: 0.4px; text-shadow: 0 1px 0 #24160d; min-width: 14px; }
#purse .pd { position: absolute; left: 100%; top: 2px; margin-left: 6px; font: italic 800 17px/1 var(--n-fd); white-space: nowrap; pointer-events: none; text-shadow: 0 1px 0 #24160d, 0 0 6px rgba(0,0,0,0.6);
  animation: pd-up 1.6s ease-out forwards; }
#purse .pd.up { color: #c3f08a; } #purse .pd.dn { color: #ff9a8a; }
#purse.bump { animation: pd-bump .35s; }
@keyframes pd-up { 0% { opacity: 0; transform: translateY(6px); } 15% { opacity: 1; transform: none; } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(-12px); } }
@keyframes pd-bump { 40% { transform: scale(1.12); } }
#jtrack { display: flex; flex-direction: column; gap: 5px; pointer-events: auto; max-width: 240px; }
#jtrack:empty { display: none; }
.jt-i > span:nth-child(2) { min-width: 0; overflow: hidden; }
.jt-i { display: grid; grid-template-columns: 26px minmax(0, 1fr) 22px; width: 100%; align-items: center; gap: 6px; text-align: left; padding: 5px 8px 5px 5px; border-radius: 9px; color: var(--n-text, #f4e9d2);
  background: linear-gradient(180deg, rgba(52,34,20,0.88), rgba(30,19,11,0.88)); border: 1.5px solid rgba(36,22,13,0.95); box-shadow: inset 0 0 0 1px rgba(242,228,196,0.16); }
.jt-i.on { box-shadow: inset 0 0 0 1.5px #f7d97a, 0 0 10px rgba(247,217,122,0.35); }
.jt-i.ready { box-shadow: inset 0 0 0 1.5px #a8d870, 0 0 10px rgba(147,176,76,0.45); }
.jt-i .ic { font-size: 18px; text-align: center; }
.jt-i b { display: block; font: 700 14px/1.1 var(--n-fd); letter-spacing: 0.3px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jt-i small { display: block; font: 600 12px/1.2 system-ui, sans-serif; color: #e6d3ad; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jt-i small .g { color: #c3f08a; font-weight: 800; }
.jt-i .ar { width: 22px; height: 22px; display: grid; place-items: center; font: 800 17px/1 system-ui; color: #f7d97a; }
.jt-i .x { font-size: 14px; color: #e6d3ad; }
.rd-m.wp { background: #f7d97a; box-shadow: 0 0 0 1.5px #24160d, 0 0 8px 2px rgba(247,217,122,0.6); }
.rd-m.wp::after { background: #24160d; }
#hud.touch #jtrack { max-width: 200px; }
#hud.touch .jt-i b { font-size: 13px; }
`;

export function installEcoHud(game) {
  const status = document.getElementById('status');
  if (!status || typeof document === 'undefined') return { sync: 'cosmetic', update() {} };
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const purse = document.createElement('div');
  purse.id = 'purse';
  purse.dataset.tip = '<b>Moedas de ouro</b><p>O dinheiro dos reinos, na sua mochila: compre e venda nos murais (Comércio), receba por trabalhos, pague casas, terrenos e o imposto. Cai ao morrer, como qualquer item.</p>';
  purse.innerHTML = `<span class="pc">${itemIco(game.A, COIN)}</span><b>0</b>`;
  const track = document.createElement('div');
  track.id = 'jtrack';
  status.prepend(track);
  status.prepend(purse);
  const pb = purse.querySelector('b');
  purse.addEventListener('pointerdown', (e) => { e.stopPropagation(); game.ui?.panels?.toggle('inv'); });
  let coins = -1, invV = -1;
  const showDelta = (d) => {
    const el = document.createElement('span');
    el.className = 'pd ' + (d > 0 ? 'up' : 'dn');
    el.textContent = (d > 0 ? '+' : '−') + fmt(Math.abs(d));
    purse.appendChild(el);
    setTimeout(() => el.remove(), 1700);
    purse.classList.remove('bump'); void purse.offsetWidth; purse.classList.add('bump');
  };
  // ---------- the tracker ----------
  let trackKey = '', tT = 0;
  const arrowOf = (x, y) => {
    const p = game.player, dx = game.world.dx(x, p.x), dy = y - p.y, d = Math.hypot(dx, dy);
    const [vx, vy] = game.toViewDir ? game.toViewDir(dx, dy) : [dx, dy];
    return { d, a: Math.atan2(vy, vx) };
  };
  const drawTracker = () => {
    const r = myRec(game), E = game.eco, p = game.player;
    const rows = [];
    for (const j of r?.jobs || []) {
      const K = JOB_KINDS[j.t] || { icon: '•' }, st = jobState(game, j), t = jobTarget(game, j);
      let got = j.got | 0;
      if (j.t === 'bring') got = p.inv.count(j.good);
      if (j.t === 'deliver') got = p.inv.count(PARCEL);
      const carry = j.t === 'deliver';
      const ar0 = t ? arrowOf(t.x, t.y) : null;
      const ready = st === 'ready' || (j.t === 'bring' && got >= j.n) || (carry && got >= j.n && ar0 && ar0.d < 8); // (a delivery: ready at its destination)
      const ar = t && !(t.anywhere && !ready) ? ar0 : null;
      const inArea = t?.area && !ready && ar && ar.d < (j.r || 40);
      const where = ready ? `entregue: ${t?.label || ''}` : carry ? (got >= j.n ? `levar a ${t?.label || ''}` : `faltam ${j.n - got} encomendas`) : `${Math.min(got, j.n)}/${j.n}${inArea ? ' · você está no lugar' : ''}`;
      rows.push({ id: j.id, ic: K.icon, title: j.title, sub: `${ready ? '<span class="g">Pronto!</span> ' : ''}${esc(where)}${ar && ar.d > 6 && !inArea ? ` · ${Math.round(ar.d)} passos` : ''}`, ar: inArea ? null : ar, on: E.track === j.id, ready, here: ready && ar && ar.d <= 3 });
    }
    if (E.wp && E.wp.kind !== 'job') { const ar = arrowOf(E.wp.x, E.wp.y); rows.push({ id: 'wp', ic: '📍', title: E.wp.label, sub: `${Math.round(ar.d)} passos`, ar, on: true, wp: true }); }
    const key = rows.map((q) => `${q.id}|${q.sub}|${q.on}|${q.ready}|${q.ar ? Math.round(q.ar.a * 8) : ''}`).join('#');
    if (key === trackKey) return;
    trackKey = key;
    const tail = (q) => (q.wp ? '<span class="ar x">✕</span>' : q.here ? '<span class="ar">✓</span>' : q.ar && q.ar.d > 3 ? `<span class="ar" style="transform:rotate(${(q.ar.a * 180 / Math.PI).toFixed(0)}deg)">➜</span>` : '<span class="ar"></span>');
    track.innerHTML = rows.map((q) => `<button class="jt-i${q.on ? ' on' : ''}${q.ready ? ' ready' : ''}" data-j="${esc(q.id)}"><span class="ic">${q.ic}</span><span><b>${esc(q.title)}</b><small>${q.sub}</small></span>${tail(q)}</button>`).join('');
    track.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const id = b.dataset.j;
      if (id === 'wp') { E.wp = null; trackKey = ''; return; }
      const j = myRec(game)?.jobs.find((q) => q.id === id);
      if (!j) return;
      if (E.track === id) { E.track = null; E.wp = null; } else { E.track = id; E.wp = jobWaypoint(game, j); }
      trackKey = '';
    }));
  };
  // ---------- notices ----------
  const me = () => meUid(game);
  const K = (k) => kingdomOf(game, k);
  game.events.on('eco', (d) => {
    if (!d || d.type === 'trade' || d.type === 'day' || d.type === 'sync') { trackKey = ''; return; }
    trackKey = '';
    if (d.u != null && d.u !== me()) return;
    if (d.type === 'rankup') {
      const R = RANK_LIST[d.rank];
      notify(`Reputação: ${R.name}`, { sub: `no Reino de ${K(d.k)?.name || ''}${R.disc ? ` · trocas ${Math.round(R.disc * 100)}% melhores` : ''}${d.rank === REP.buyRank ? ' · já pode comprar casas e terrenos' : ''}`, kind: 'good', ms: 6000, key: 'rank' });
      game.audio?.play('levelup', {});
    } else if (d.type === 'rankdown') {
      game.events.emit('toast', { text: `Sua reputação no Reino de ${K(d.k)?.name || ''} caiu: ${RANK_LIST[d.rank].name}`, kind: 'warn' });
    } else if (d.type === 'prog' && d.done) {
      const t = jobTarget(game, d.job);
      game.events.emit('toast', { text: `Pronto: ${d.job.title}. Entregue no ${t?.label || 'mural'}`, kind: 'good' });
      game.audio?.play('levelup', { volume: 0.4 });
      if (game.eco.track === d.job.id) game.eco.wp = jobWaypoint(game, d.job);
    } else if (d.type === 'prog') {
      game.events.emit('toast', { text: `${d.job.title}: ${d.job.got}/${d.job.n}`, kind: 'info' });
    } else if (d.type === 'jobfail') {
      game.events.emit('toast', { text: `Trabalho expirou: ${d.job.title} (${REP.fail} de reputação)`, kind: 'warn' });
      if (game.eco.track === d.job.id) { game.eco.track = null; game.eco.wp = null; }
    } else if (d.type === 'jobdone' || d.type === 'jobdrop') {
      if (game.eco.track === d.job.id) { game.eco.track = null; game.eco.wp = null; }
      const next = myRec(game)?.jobs[0];
      if (next && !game.eco.track) { game.eco.track = next.id; game.eco.wp = jobWaypoint(game, next); }
    } else if (d.type === 'paid') {
      notify(`Imposto e aluguel pagos: −${fmt(d.coins)} moedas`, { sub: `${(d.ids || []).length} ${(d.ids || []).length === 1 ? 'propriedade' : 'propriedades'} em dia · cobrado da sua mochila`, kind: 'info', ms: 4500, key: 'tax' });
    } else if (d.type === 'owed') {
      const worst = d.list.slice().sort((a, b) => b[2] - a[2])[0], pr = propById(game, worst[0]), s = pr && settlement(game, pr.sid);
      const left = PROP.warnDays - worst[2], total = d.list.reduce((a, b) => a + b[1], 0);
      notify(`Imposto atrasado: ${fmt(total)} moedas`, { sub: `${left <= 1 ? 'Último dia!' : `${left} dias para pagar`} (mural · Propriedades), ou o Reino de ${K(s?.k)?.name || ''} toma ${pr?.bi != null ? `a ${pr.name.toLowerCase()}` : 'o terreno'} em ${s?.name || ''}. Só as moedas da mochila contam.`, kind: 'warn', ms: 12000, key: 'tax' });
      game.audio?.play('ui', { volume: 0.4 });
    } else if (d.type === 'proplost' && d.why !== 'left') {
      const pr = propById(game, d.id), s = pr && settlement(game, pr.sid);
      notify(`${pr?.bi != null ? 'Sua casa foi tomada' : 'Seu terreno foi tomado'}`, { sub: `O Reino de ${K(s?.k)?.name || ''} tomou ${pr?.bi != null ? `a ${pr.name.toLowerCase()}` : 'o terreno'} em ${s?.name || ''}: imposto não pago por 3 dias (${REP.seized} de reputação). O que estava nos baús ficou para o reino.`, kind: 'warn', sticky: true, key: 'seized' });
      dropRespawn(d.id);
    } else if (d.type === 'proplost') dropRespawn(d.id);
  });
  // a lost house: its bed is no longer a respawn point (owner state)
  const dropRespawn = (id) => {
    const pr = propById(game, id), p = game.player;
    if (pr?.beds && pr.beds.some((k) => `t${pr.sid}.${k}` === p.respawn)) p.respawn = null;
  };
  // ---------- the world overlay: plots and the waypoint ----------
  const cv = document.getElementById('overlay'), ctx = cv?.getContext('2d');
  const plotsHere = () => {
    const E = game.eco, here = game.towns?.here?.town ?? -1;
    if (E.showPlotsT > 0 && E.showPlots != null) return E.showPlots;
    if (here < 0) return -1;
    if (game.build?.mode) return here;
    const s = settlement(game, here);
    return s && propsOf(game, here).plots.some((pl) => E.pr.get(pl.id)?.u === me()) ? here : -1;
  };
  const corner = (x, y) => game.worldToScreen(x, y, 0.02);
  return {
    sync: 'cosmetic',
    update(g, dt) {
      const E = g.eco;
      if (!E) return;
      if (E.showPlotsT > 0) E.showPlotsT -= dt;
      const p = g.player;
      if (p.inv.version !== invV) {
        invV = p.inv.version;
        const c = p.inv.count(COIN);
        if (c !== coins) { if (coins >= 0 && Math.abs(c - coins) > 0) showDelta(c - coins); coins = c; pb.textContent = fmt(c); }
      }
      // arriving at a house / plot waypoint: it goes
      if (E.wp && E.wp.kind !== 'job' && Math.hypot(g.world.dx(E.wp.x, p.x), E.wp.y - p.y) < 2.2) { E.wp = null; trackKey = ''; }
      tT -= dt;
      if (tT <= 0) { tT = 0.25; drawTracker(); }
    },
    render(g) {
      if (!ctx || !g.eco?.pr) return;
      const W = cv.clientWidth, H = cv.clientHeight;
      // plots of the town the player is in (or the one shown from the mural)
      const sid = plotsHere();
      if (sid >= 0) {
        const P = propsOf(g, sid), myU = me();
        ctx.save();
        for (const pl of P.plots) {
          const row = g.eco.pr.get(pl.id), mine = row && row.u === myU;
          const pts = [corner(pl.x0, pl.y0), corner(pl.x1 + 1, pl.y0), corner(pl.x1 + 1, pl.y1 + 1), corner(pl.x0, pl.y1 + 1)];
          if (pts.every(([x, y]) => x < -40 || y < -40 || x > W + 40 || y > H + 40)) continue;
          const col = mine ? '134,220,205' : row ? '210,200,180' : '247,217,122';
          // a soft fill, a dark under-line and the dashed (yours: solid) border, corner posts
          ctx.fillStyle = `rgba(${col},${mine ? 0.14 : row ? 0.05 : 0.1})`;
          ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
          ctx.setLineDash([]); ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(36,22,13,0.45)'; ctx.stroke();
          ctx.setLineDash(mine ? [] : [10, 7]); ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(${col},0.95)`; ctx.stroke();
          ctx.setLineDash([]);
          for (const [x, y] of pts) { ctx.fillStyle = '#24160d'; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.fillStyle = `rgb(${col})`; ctx.fillRect(x - 2.5, y - 2.5, 5, 5); }
          // the label: a dark pill at the middle of the plot
          const [cx, cy] = corner((pl.x0 + pl.x1 + 1) / 2, (pl.y0 + pl.y1 + 1) / 2);
          const txt = mine ? 'Seu terreno' : row ? `Terreno de ${row.name}` : `Terreno à venda · ${fmt(pl.price)} moedas`;
          ctx.font = '700 15px "Barlow Condensed", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const tw = ctx.measureText(txt).width + 18;
          ctx.fillStyle = 'rgba(36,22,13,0.82)';
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - tw / 2, cy - 12, tw, 24, 12) : ctx.rect(cx - tw / 2, cy - 12, tw, 24); ctx.fill();
          ctx.fillStyle = mine ? '#bff3ea' : row ? '#e6dccb' : '#ffe39a'; ctx.fillText(txt, cx, cy + 1);
          ctx.textBaseline = 'alphabetic';
        }
        ctx.restore();
      }
      // the waypoint: a gold marker bobbing over the spot
      const wp = g.eco.wp;
      if (wp) {
        const [x, y] = g.worldToScreen(wp.x, wp.y, 1.6 + Math.sin(g.time * 3) * 0.12);
        if (x > -20 && y > -20 && x < W + 20 && y < H + 20) {
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = '#f7d97a'; ctx.strokeStyle = '#24160d'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, 0); ctx.lineTo(0, 11); ctx.lineTo(-9, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#24160d'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
          ctx.font = '700 14px "Barlow Condensed", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(36,22,13,0.92)';
          ctx.strokeText(wp.label, 0, -17); ctx.fillStyle = '#ffe39a'; ctx.fillText(wp.label, 0, -17);
          ctx.restore();
        }
      }
    },
  };
}
