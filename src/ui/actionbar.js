// Dynamic action bar (#ab): auto-attack button + the live ability list (ABILITY_ORDER, rebuilt from the
// equipment), WoW-like cooldown sweeps, GCD, energy dimming, out-of-range / no line of fire, ammo &
// herb badges, hold-to-block, a cast bar (Aimed Shot) and a pop-in animation on equipment change.
// Touch: two thumb arcs around the big attack button (inner 4, outer 3). Desktop: a compact row above the
// hotbar with the letter keys of controller.js (Q R T G Z · V heal · Shift sprint).

import { ABILITIES, ABILITY_ORDER, GENERIC_ABILITIES } from '../game/data.js';
import { abilityState, useAbility, holdAbility, releaseAbility } from '../game/abilities.js';
import { attackable } from '../game/combat.js';
import { combatIcon } from './combaticons.js';
import { uiIcon } from './icons.js';
import { abilityKeys, keyLabel } from '../game/controller.js';
import { uiScale } from './uiscale.js';

const CSS = `
.ab-wrap .ab-s .ammo { position: absolute; z-index: 3; top: 2px; right: 3px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; font-size: 9.5px; font-weight: 800; line-height: 15px; text-align: center; color: #fff4d8; background: rgba(60,44,20,.92); border: 1px solid rgba(217,180,90,.8); pointer-events: none; }
.ab-wrap .ab .ammo.out { color: #ffd0c8; background: rgba(110,30,24,.95); border-color: rgba(255,110,90,.9); }
.ab-wrap .ab-atk .ammo { top: 6px; right: 8px; }
.ab-wrap .ab.nostock .ic { filter: saturate(0) brightness(.55); }
.ab-wrap .ab.active { border-color: rgba(140,220,255,.95) !important; box-shadow: 0 0 0 1px #000, 0 0 12px rgba(120,200,255,.65); }
.ab-wrap .ab.pop { animation: abPop .32s cubic-bezier(.2,1.5,.4,1) both; }
@keyframes abPop { from { transform: scale(.2); opacity: 0; } }
.ab-wrap .ab.out { transition: transform .14s, opacity .14s; transform: scale(.4); opacity: 0; pointer-events: none; }
.desktop .ab-wrap .ab-s.grp { margin-left: 10px; }
.desktop .ab-wrap .ab-s.grp::before { content: ''; position: absolute; left: -7px; top: 8px; bottom: 8px; width: 1px; background: rgba(225,218,200,.25); }
.desktop .ab-wrap .ab-s { overflow: visible; }
.desktop .ab-wrap .ab-s .cd { border-radius: 6px; }
.touch .ab-wrap .ab-s .ammo { top: -3px; right: -3px; }
.touch .ab-wrap .ab-s { overflow: visible; }
.touch .ab-wrap .ab-s .cd { border-radius: 50%; }
.castbar { position: absolute; left: 50%; bottom: calc(118px + var(--safe-b)); transform: translateX(-50%); width: min(260px, 52vw); height: 16px; border-radius: 3px; background: rgba(10,11,12,.82); border: 1px solid rgba(225,218,200,.45); box-shadow: 0 0 0 1px #000, 0 3px 10px rgba(0,0,0,.5); overflow: hidden; pointer-events: none; }
.castbar > i { position: absolute; inset: 0; transform-origin: 0 50%; background: linear-gradient(180deg, #ffe08a, #d9a83a 55%, #9a6e1c); }
.castbar > span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 10.5px; font-weight: 800; color: #fff; text-shadow: 0 1px 2px #000; }
.castbar.done > i { background: linear-gradient(180deg, #b8f8a0, #5ab84a); }
.castbar.fail > i { background: linear-gradient(180deg, #ff8a7a, #b8322f); }
.castbar.fade { transition: opacity .35s; opacity: 0; }
.touch .castbar { bottom: calc(64px + var(--safe-b)); }
.desktop .castbar { bottom: calc(92px + var(--safe-b)); }
`;

function press(el, down, up) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    el.classList.add('down');
    try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    down(e);
  });
  const end = () => { el.classList.remove('down'); up?.(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// thumb-arc slot centers (px from the wrap's bottom-right corner) — angle 0 = left, 90 = up
const INNER = { 1: [45], 2: [15, 75], 3: [0, 45, 90], 4: [0, 30, 60, 90] };
const OUTER = { 1: [45], 2: [24, 66], 3: [12, 45, 78] };

export function installActionBar(game, root, wrap) {
  if (!document.getElementById('ab-style')) {
    const st = document.createElement('style');
    st.id = 'ab-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const A = game.A, p = game.player;
  const intBtn = wrap.querySelector('#ab-int');
  const atk = document.createElement('button');
  atk.className = 'ab ab-atk';
  atk.dataset.ab = 'attack';
  atk.innerHTML = `<span class="ic"></span><span class="key">Esp</span><span class="ammo hidden"></span>`;
  wrap.appendChild(atk);
  press(atk, () => game.ctl.toggleAttack());
  const atkIc = atk.querySelector('.ic'), atkAmmo = atk.querySelector('.ammo');

  const cast = document.createElement('div');
  cast.className = 'castbar hidden';
  cast.innerHTML = '<i></i><span></span>';
  root.appendChild(cast);
  const castI = cast.firstElementChild, castS = cast.lastElementChild;

  let btns = [], touch = null, barKey = '', first = true, atkKey = '';
  const L = { castOn: false };

  const layout = () => {
    if (touch) {
      const s = uiScale(), W = innerWidth / s, H = innerHeight / s; // HUD css px (zoomed)
      const k = Math.max(0.8, Math.min(1, Math.min(W, H) / 400));
      const n = btns.length, nIn = Math.min(4, n), nOut = n - nIn;
      const c = 38 * k + 1;
      btns.forEach((b, i) => {
        const inner = i < nIn;
        const angs = inner ? INNER[nIn] : OUTER[nOut];
        const a = (angs[inner ? i : i - nIn] * Math.PI) / 180;
        const R = (inner ? 112 : 176) * k, s = (inner ? 56 : 50) * k;
        const cx = c + Math.cos(a) * R, cy = c + Math.sin(a) * R;
        Object.assign(b.el.style, { right: `${(cx - s / 2).toFixed(1)}px`, bottom: `${(cy - s / 2).toFixed(1)}px`, width: `${s.toFixed(1)}px`, height: `${s.toFixed(1)}px` });
      });
      if (intBtn) {
        // keep the interact button clear of the outer arc (left of it in landscape, above it in portrait)
        if (nOut > 0 && W > H) Object.assign(intBtn.style, { right: `${Math.round(232 * k)}px`, bottom: `${Math.round(6 * k)}px` });
        else if (nOut > 0) Object.assign(intBtn.style, { right: `${Math.round(117 * k)}px`, bottom: `${Math.round(232 * k)}px` });
        else intBtn.style.right = intBtn.style.bottom = '';
      }
    } else {
      for (const b of btns) b.el.style.right = b.el.style.bottom = b.el.style.width = b.el.style.height = '';
      if (intBtn) intBtn.style.right = intBtn.style.bottom = '';
    }
  };

  const groupOf = (id) => (GENERIC_ABILITIES.includes(id) ? 2 : p.offprof?.abilities.includes(id) ? 1 : 0);

  const rebuild = () => {
    const ids = ABILITY_ORDER.slice();
    const key = ids.join(',');
    if (key === barKey && btns.length) return;
    barKey = key;
    for (const b of btns) b.el.remove();
    const keys = abilityKeys(ids);
    btns = ids.map((id, i) => {
      const ab = ABILITIES[id];
      const el = document.createElement('button');
      el.className = 'ab ab-s' + (first ? '' : ' pop');
      if (i > 0 && groupOf(id) !== groupOf(ids[i - 1])) el.classList.add('grp');
      el.dataset.ab = id;
      el.style.animationDelay = first ? '' : `${i * 40}ms`;
      const cost = ab.cost ? `${ab.cost} energia` : 'sem custo';
      const kl = keyLabel(keys[i]);
      el.title = `${ab.name}${kl ? ` (${kl})` : ''} — ${ab.desc} ${cost}${ab.cd ? `, recarga ${ab.cd}s` : ''}${ab.cast ? `, conjuração ${String(ab.cast).replace('.', ',')}s` : ''}`;
      el.innerHTML = `<span class="ic">${combatIcon(A, ab.icon)}</span><span class="cd"></span><span class="cdt"></span>
        <span class="key">${kl}</span><span class="cost">${ab.cost || ''}</span><span class="ammo hidden"></span><span class="abn">${ab.name}</span>`;
      wrap.appendChild(el);
      const b = { id, el, cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), ammo: el.querySelector('.ammo'), last: {} };
      press(el, (e) => {
        // ground-aimed abilities (aim: 'ground'): hand the press to the aim module (game.aim, agent G).
        // Touch: the button becomes an aim stick (the pointer is captured on `el`); mouse: aim follows the cursor.
        if (ab.aim && e.pointerType !== 'mouse' && game.aim?.beginTouch) { game.aim.beginTouch(id, el, e); return; }
        if (ab.aim && e.pointerType === 'mouse' && game.aim?.beginMouse) { game.aim.beginMouse(id, { sticky: true }); return; }
        useAbility(game, id);
        if (ab.hold) holdAbility(game, id);
      }, () => { if (ab.hold) releaseAbility(game, id); });
      return b;
    });
    if (!first) {
      const wn = p.wprof?.name || 'Mãos';
      const on = p.offprof && !p.wprof?.twoHanded ? ` + ${p.offprof.name}` : '';
      game.events.emit('toast', { text: `Em mãos: ${wn}${on}`, kind: 'info' });
    }
    first = false;
    layout();
  };

  game.events.on('bar', rebuild);
  addEventListener('resize', () => layout());
  rebuild();

  let castFadeT = 0;
  game.events.on('cast', (d) => {
    if (d.cast) { cast.classList.remove('hidden', 'done', 'fail', 'fade'); castS.textContent = d.cast.name; L.castOn = true; }
  });

  return {
    setMode(t) { if (t !== touch) { touch = t; layout(); } },
    update(g, dt) {
      const pl = g.player;
      // attack button: icon follows the weapon's auto attack; bow shows the arrow count
      const prof = pl.wprof;
      const ak = prof ? prof.auto || prof.type : 'punch';
      if (ak !== atkKey) {
        atkKey = ak;
        atkIc.innerHTML = ak === 'punch' ? combatIcon(A, 'punch') : ak === 'shoot' ? combatIcon(A, 'shoot') : uiIcon(A, 'attack');
        atk.title = `${ak === 'punch' ? 'Socar' : ak === 'shoot' ? 'Atirar' : 'Atacar'} (Espaço) — ataca o alvo ou o inimigo mais perto`;
      }
      const ammo = prof?.ammo ? pl.inv.count(prof.ammo) : -1;
      if (L.atkAmmo !== ammo) {
        L.atkAmmo = ammo;
        atkAmmo.classList.toggle('hidden', ammo < 0);
        atkAmmo.classList.toggle('out', ammo === 0);
        atkAmmo.textContent = ammo < 0 ? '' : String(ammo);
      }
      const on = !!(pl.autoAttack && attackable(pl.target));
      if (L.atkOn !== on) { L.atkOn = on; atk.classList.toggle('on', on); }

      for (const b of btns) {
        const s = abilityState(g, b.id);
        const Lb = b.last;
        let frac = 0, gcd = false;
        if (s.cd > 0) frac = s.cd / s.cdDur;
        else if (s.gcd > 0) { frac = s.gcd / s.gcdDur; gcd = true; }
        const deg = Math.round(frac * 180) * 2;
        if (Lb.deg !== deg) { Lb.deg = deg; b.cd.style.setProperty('--p', deg + 'deg'); }
        if (Lb.gcd !== gcd) { Lb.gcd = gcd; b.el.classList.toggle('gcd', gcd); }
        const txt = s.cd > 1.5 ? String(Math.ceil(s.cd)) : s.cd > 0 ? s.cd.toFixed(1) : '';
        if (Lb.txt !== txt) { Lb.txt = txt; b.cdt.textContent = txt; }
        const noen = !s.energyOk, far = !s.inRange;
        if (Lb.noen !== noen) { Lb.noen = noen; b.el.classList.toggle('noen', noen); }
        if (Lb.far !== far) { Lb.far = far; b.el.classList.toggle('far', far); }
        const nostock = !s.stocked;
        if (Lb.ns !== nostock) { Lb.ns = nostock; b.el.classList.toggle('nostock', nostock); }
        const cnt = s.ammo >= 0 ? s.ammo : s.items;
        if (Lb.cnt !== cnt) {
          Lb.cnt = cnt;
          b.ammo.classList.toggle('hidden', cnt < 0);
          b.ammo.classList.toggle('out', cnt === 0);
          b.ammo.textContent = cnt < 0 ? '' : String(cnt);
        }
        if (Lb.act !== s.active) { Lb.act = s.active; b.el.classList.toggle('active', !!s.active); }
        const qd = pl.queued === b.id;
        if (Lb.qd !== qd) { Lb.qd = qd; b.el.classList.toggle('queued', qd); }
        const cool = s.cd > 0;
        if (Lb.cool && !cool) { b.el.classList.remove('ready', 'pop'); void b.el.offsetWidth; b.el.classList.add('ready'); }
        Lb.cool = cool;
      }

      // cast bar
      const c = pl.cast;
      if (c) {
        const k = Math.min(1, c.t / c.dur);
        castI.style.transform = `scaleX(${k.toFixed(3)})`;
        const rem = Math.max(0, c.dur - c.t).toFixed(1).replace('.', ',');
        const t = `${c.name}  ${rem}s`;
        if (L.castTxt !== t) { L.castTxt = t; castS.textContent = t; }
        castFadeT = 0;
      } else if (L.castOn) {
        L.castOn = false;
        const ok = !!pl.action && pl.action.type === 'shoot' && !pl.dead;
        castI.style.transform = 'scaleX(1)';
        cast.classList.add(ok ? 'done' : 'fail');
        castS.textContent = ok ? 'Disparado!' : 'Interrompido';
        castFadeT = 0.45;
        cast.classList.add('fade');
      } else if (castFadeT > 0) {
        castFadeT -= dt;
        if (castFadeT <= 0) cast.classList.add('hidden');
      }
    },
  };
}
