// The general's orders on the screen (docs/REINOS.md §15, game/army.js): for an enlisted player, a card at the top left
// (like the job tracker: phone-friendly, a tap minimizes it, ✕ hides it until the next order) with the order now — from
// the army's real state (3a: gathering, marching, besieging, a battle, going home; 3b near the players: the camp, the
// engines, the bombardment, the ram, the tower, the breach, the plaza, the lines) —, the distance and an arrow, the
// general's last shout; the order's WAYPOINT (game.army.wp, local) on the ground (a red banner bobbing over the spot, an
// arrow at the screen's edge when it is off screen), the radar ring and the map (ui/radar.js, ui/minimap.js). A new
// order comes with a short notice; the pay, a promotion, a bonus, dying in war are told too. Also: which remote players
// this player may fight (e.pvp — a member of a kingdom at war with its own: the hit is the host's to allow).
// Cosmetic and local (sync 'cosmetic'): reads the replicated records (game.army.en) and the war's state.

import { notify } from './notify.js';
import { WAR_ICONS } from './warHud.js';
import { ARMY } from '../game/content/army.js';
import { meUid, kingdomOf, settlement, fmt } from '../game/eco.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CSS = `
#ordcard { pointer-events: auto; width: 252px; max-width: 252px; border-radius: 11px; overflow: hidden; color: var(--n-text, #f4e9d2);
  background: linear-gradient(180deg, rgba(58,26,20,0.93), rgba(30,15,11,0.93)); border: 1.5px solid rgba(36,22,13,0.95);
  box-shadow: inset 0 0 0 1px rgba(255,180,150,0.18), 0 2px 0 rgba(20,12,6,0.4); }
#ordcard.hidden { display: none; }
#ordcard .oc-h { display: grid; grid-template-columns: 30px minmax(0, 1fr) 24px 20px; align-items: center; gap: 7px; width: 100%; padding: 6px 6px 6px 6px; text-align: left; color: inherit; background: none; border: 0; cursor: pointer; }
#ordcard .oc-ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; color: #fff6e0; box-shadow: inset 0 0 0 1.5px rgba(0,0,0,0.35); }
#ordcard .oc-ic svg { width: 18px; height: 18px; }
#ordcard small.oc-who { display: block; font: 700 10.5px/1.1 system-ui, sans-serif; letter-spacing: 0.7px; text-transform: uppercase; color: #f0b9a2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ordcard b.oc-t { display: block; font: 700 15px/1.12 var(--n-fd); letter-spacing: 0.3px; color: #fff1dc; margin-top: 1px; }
#ordcard .oc-ar { width: 24px; height: 24px; display: grid; place-items: center; font: 800 18px/1 system-ui; color: #ff8a70; }
#ordcard .oc-x { width: 20px; height: 20px; border: 0; border-radius: 6px; background: rgba(255,255,255,0.07); color: #e6d3ad; font-size: 12px; cursor: pointer; padding: 0; }
#ordcard .oc-b { padding: 0 9px 7px 43px; font: 600 12px/1.3 system-ui, sans-serif; color: #e9d6b8; }
#ordcard .oc-b .d { color: #ffb59e; font-weight: 800; }
#ordcard .oc-b i { display: block; margin-top: 3px; color: #ffe39a; font-style: italic; }
#ordcard.min .oc-b { display: none; }
#ordcard.tone-fight { border-color: #8e1f16; box-shadow: inset 0 0 0 1px rgba(255,120,90,0.35), 0 0 12px rgba(232,70,58,0.3); }
#ordcard.tone-defend { border-color: #8e1f16; }
#ordcard.tone-good { background: linear-gradient(180deg, rgba(34,52,24,0.93), rgba(18,28,12,0.93)); }
#ordcard.tone-good small.oc-who { color: #c3f08a; }
#ordcard.tone-idle { opacity: 0.92; }
#ordcard.flash { animation: oc-flash 1.2s ease-out; }
@keyframes oc-flash { 0% { box-shadow: 0 0 0 3px #ffd27a, 0 0 18px rgba(255,210,122,0.8); } 100% { box-shadow: inset 0 0 0 1px rgba(255,180,150,0.18); } }
.rd-m.ord { background: #e8463a; box-shadow: 0 0 0 1.5px #24160d, 0 0 8px 2px rgba(232,70,58,0.6); }
.rd-m.ord::after { background: #fff1dc; }
#hud.touch #ordcard { width: 214px; max-width: 214px; }
#hud.touch #ordcard b.oc-t { font-size: 14px; }
`;
const FLAG = WAR_ICONS.flag, SW = WAR_ICONS.swords, CASTLE = WAR_ICONS.castle;
const ICON_OF = { march: FLAG, idle: FLAG, retreat: FLAG, fight: SW, defend: CASTLE, good: FLAG };

export function installArmyHud(game) {
  const status = typeof document !== 'undefined' ? document.getElementById('status') : null;
  if (!status) return { sync: 'cosmetic', update() {} };
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const card = document.createElement('div');
  card.id = 'ordcard';
  card.className = 'hidden';
  const track = document.getElementById('jtrack');
  if (track) status.insertBefore(card, track); else status.prepend(card);
  const ui = { min: false, hideKey: null, key: null, cry: null, cryT: -9, last: '' };
  card.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.target.closest('.oc-x')) { ui.hideKey = ui.key; card.classList.add('hidden'); game.army.wp = null; return; }
    ui.min = !ui.min; card.classList.toggle('min', ui.min); ui.last = '';
  });
  const me = () => meUid(game);
  // the general's shouts of the player's own force (op war.cry): a line in the card
  game.events.on('warcry', ({ id, text }) => {
    const r = game.army?.mine?.();
    if (!r || !id || (id !== r.a && !(game.warfare?.forces?.get(id)?.k === r.k))) return;
    ui.cry = text; ui.cryT = game.time;
  });
  // the records: promotions, a death in war
  game.events.on('army', (d) => {
    if (!d || d.u !== me()) return;
    ui.last = '';
    if (d.r && d.old && d.r.rank > d.old.rank) {
      const R = ARMY.ranks[d.r.rank];
      notify(`Promovido a ${R.name}!`, { sub: `${d.r.svc} de serviço · soldo de ${fmt(R.pay)} moedas por dia (×1,5 em guerra)`, kind: 'good', icon: FLAG, ms: 7000, key: 'rank-army' });
      game.audio?.play('levelup', {});
    }
    if (d.type === 'join') { ui.key = null; ui.hideKey = null; }
    if (!d.r) { game.army.wp = null; card.classList.add('hidden'); ui.key = null; }
  });
  game.events.on('death', () => {
    const r = game.army?.mine?.();
    if (!r) return;
    const s = settlement(game, r.sid);
    notify('Você caiu em combate', { sub: `Renasce como sempre — sem perder a reputação nem o posto no exército de ${s?.name || ''}. Volte às ordens do general.`, kind: 'info', icon: FLAG, ms: 7000, key: 'army-death' });
  });
  const arrowOf = (x, y) => {
    const p = game.player, dx = game.world.dx(x, p.x), dy = y - p.y, d = Math.hypot(dx, dy);
    const [vx, vy] = game.toViewDir ? game.toViewDir(dx, dy) : [dx, dy];
    return { d, a: Math.atan2(vy, vx) };
  };
  let t = 0, pvT = 0;
  const draw = (g) => {
    const A = g.army, r = A?.mine?.();
    if (!r) { if (!card.classList.contains('hidden')) card.classList.add('hidden'); A && (A.wp = null); ui.key = null; return; }
    const o = A.order(meUid(g), g.player);
    if (!o) { card.classList.add('hidden'); A.wp = null; return; }
    // a new order: a short notice (not the very first one after a load: the card shows it)
    if (o.key !== ui.key) {
      const first = ui.key == null;
      ui.key = o.key; ui.hideKey = null;
      if (!first || o.tone !== 'idle') {
        game.events.emit('armyorder', { key: o.key, code: o.code, title: o.title }); // (tests / other UI: a new order told)
        notify(o.title, { sub: `Ordem do general · ${o.sub}`, kind: o.tone === 'good' ? 'good' : o.tone === 'idle' ? 'info' : 'warn', icon: ICON_OF[o.tone] || FLAG, ms: 5200, key: 'army-order' });
        if (!first) game.audio?.play('ui', { volume: 0.35 });
        card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      }
    }
    const hidden = ui.hideKey === o.key;
    A.wp = hidden ? null : o.wp;
    card.classList.toggle('hidden', hidden);
    if (hidden) return;
    const K = kingdomOf(g, r.k), s = settlement(g, r.sid), col = K ? K.color.join(',') : '140,40,30';
    const ar = o.wp ? arrowOf(o.wp.x, o.wp.y) : null;
    const cry = ui.cry && g.time - ui.cryT < 7 ? ui.cry : '';
    const dist = ar && ar.d > 4 ? ` <span class="d">${Math.round(ar.d)} passos</span>` : '';
    const key = `${o.key}|${o.title}|${o.sub}|${ar ? Math.round(ar.a * 8) + ':' + Math.round(ar.d / 4) : ''}|${cry}|${ui.min}|${r.rank}`;
    if (key === ui.last) return;
    ui.last = key;
    card.className = `tone-${o.tone}${ui.min ? ' min' : ''}`;
    card.innerHTML = `<div class="oc-h"><span class="oc-ic" style="background:rgb(${col})">${ICON_OF[o.tone] || FLAG}</span>
      <span><small class="oc-who">Ordens do general · ${esc(ARMY.ranks[r.rank].name)} · ${esc(s?.name || '')}</small><b class="oc-t">${esc(o.title)}</b></span>
      <span class="oc-ar">${ar && ar.d > 3 ? `<span style="display:inline-block;transform:rotate(${(ar.a * 180 / Math.PI).toFixed(0)}deg)">➜</span>` : ar ? '✓' : ''}</span><button class="oc-x" aria-label="Esconder">✕</button></div>
      <div class="oc-b">${esc(o.sub)}${dist}${cry ? `<i>«${esc(cry)}»</i>` : ''}</div>`;
  };
  // which remote players this one may fight (e.pvp: the target / tap / arrow rules; the host decides the hit)
  const pvpFlags = (g) => {
    const A = g.army;
    if (!A?.pvpWhy) return;
    for (const e of g.entities) {
      if (!e.remote || !e.pid || e.avatar) continue;
      const ok = !e.dead && !A.pvpWhy(g.net.pid, e.pid);
      if (!!e.pvp !== ok) { e.pvp = ok; if (!ok && g.player.target === e) { g.player.target = null; g.player.autoAttack = false; g.events.emit('target', { target: null }); } }
    }
  };
  const cv = document.getElementById('overlay'), ctx = cv?.getContext('2d');
  return {
    sync: 'cosmetic',
    update(g, dt) {
      t -= dt;
      if (t <= 0) { t = 0.25; try { draw(g); } catch (e) { console.error(e); } }
      pvT -= dt;
      if (pvT <= 0) { pvT = 0.5; pvpFlags(g); }
    },
    render(g) {
      const wp = g.army?.wp;
      if (!ctx || !wp) return;
      const W = cv.clientWidth, H = cv.clientHeight;
      const [x, y] = g.worldToScreen(wp.x, wp.y, 1.9 + Math.sin(g.time * 3.2) * 0.14);
      ctx.save();
      if (x > 14 && y > 14 && x < W - 14 && y < H - 14) {
        // a red banner on a pole over the spot, with its label
        ctx.translate(x, y);
        ctx.strokeStyle = '#24160d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, -16); ctx.lineTo(-7, 14); ctx.stroke();
        ctx.fillStyle = '#e8463a'; ctx.beginPath(); ctx.moveTo(-6, -16); ctx.lineTo(10, -11); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff1dc'; ctx.beginPath(); ctx.arc(-7, 15, 3, 0, Math.PI * 2); ctx.fill();
        ctx.font = '700 14px "Barlow Condensed", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(36,22,13,0.92)';
        ctx.strokeText(wp.label, 0, -22); ctx.fillStyle = '#ffd0c4'; ctx.fillText(wp.label, 0, -22);
      } else {
        // off screen: an arrow at the edge toward it, with the distance
        const cx = W / 2, cy = H / 2, a = Math.atan2(y - cy, x - cx), m = 30;
        const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(Math.cos(a))), (H / 2 - m) / Math.max(1e-3, Math.abs(Math.sin(a))));
        const ex = cx + Math.cos(a) * k, ey = cy + Math.sin(a) * k;
        ctx.translate(ex, ey); ctx.rotate(a);
        ctx.fillStyle = '#e8463a'; ctx.strokeStyle = '#24160d'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-3, 0); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.rotate(-a);
        const p = g.player, d = Math.round(Math.hypot(g.world.dx(wp.x, p.x), wp.y - p.y));
        ctx.font = '700 13px "Barlow Condensed", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(36,22,13,0.92)';
        const ty = Math.sin(a) > 0.5 ? -18 : 26;
        ctx.strokeText(`${wp.label} · ${d}`, 0, ty); ctx.fillStyle = '#ffd0c4'; ctx.fillText(`${wp.label} · ${d}`, 0, ty);
      }
      ctx.restore();
    },
  };
}
