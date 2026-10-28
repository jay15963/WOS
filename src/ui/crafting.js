// Crafting panel ("Criar"): category tabs, recipe cards with have/need ingredients, required station
// (✓ near / ✗ reason), queue strip with live progress and cancel, next-step hint. Mobile-first: big
// tap targets, single scrolling column on phones; two columns on desktop.

import { RECIPES, RECIPE_ORDER, CRAFT_CATS, STATION_PT, stationsOf } from '../game/content/recipes.js';
import { ITEMS } from '../game/data.js';
import { recipeState, enqueue, cancelCraft, MAX_QUEUE } from '../game/crafting.js';
import { nextStep } from '../game/economy.js';
import { itemIco, econIcon, buildIco } from './econIcons.js';
import { svgIcon } from './icons.js';

const fmtT = (s) => (s < 10 ? s.toFixed(s % 1 ? 1 : 0) : Math.round(s)) + ' s';

export function craftBody(P) {
  const g = P.g, A = g.A, p = g.player;
  const station = P.craftStation; // filter by station (opened from a station) or null
  const cat = P.craftTab || 'tools';
  const tabs = [...CRAFT_CATS.map(([k, n]) => `<button class="tab ${!station && cat === k ? 'on' : ''}" data-ctab="${k}">${n}</button>`),
    `<button class="tab tab-go" data-goto="build">Construções ›</button>`].join('');
  const ids = RECIPE_ORDER.filter((id) => {
    const r = RECIPES[id];
    return station ? stationsOf(r).includes(station) : r.cat === cat;
  });
  const cards = ids.map((id) => {
    const r = RECIPES[id], out = ITEMS[r.out], s = recipeState(g, id);
    const ing = Object.entries(r.in).map(([k, n]) => {
      const have = p.inv.count(k);
      return `<span class="cost ${have >= n ? '' : 'lack'}" title="${ITEMS[k].name}">${itemIco(A, k)}${have}/${n}</span>`;
    }).join('');
    const st = r.station === 'hand' ? `<span class="st ok">${STATION_PT.hand}</span>`
      : `<span class="st ${s.stationOk ? 'ok' : 'no'}">${s.stationOk ? '✓ ' : ''}${stationsOf(r).map((x) => STATION_PT[x]).join(' / ')}</span>`;
    const fuel = r.fuel ? '<span class="st fuel">🔥 combustível</span>' : '';
    const many = (r.qty || 1) > 1 || ['material', 'ammo', 'food'].includes(out.cat);
    return `<div class="rcard ${s.ok ? '' : 'cant'}">
      <button class="rmain" data-craft="${id}" ${s.ok ? '' : 'aria-disabled="true"'}>
        <span class="ri">${itemIco(A, r.out)}${(r.qty || 1) > 1 ? `<span class="rq">×${r.qty}</span>` : ''}</span>
        <span class="rt"><b>${out.name}</b><span class="costs">${ing}</span><span class="rmeta">${st}${fuel}<span class="tm">${fmtT(r.time)}</span></span>
        ${s.ok ? '' : `<small class="why">${s.reason}</small>`}</span>
      </button>
      ${many ? `<button class="rx5" data-craft5="${id}" ${s.ok ? '' : 'disabled'} title="Criar 5">×5</button>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Nada aqui ainda.</p>';
  const chip = station ? `<div class="schip">${buildIco(A, station)}<span>${STATION_PT[station]}</span><button data-allrec title="Ver todas">${svgIcon('close')}</button></div>` : '';
  return `
    <div class="craft">
      <div class="tip">${econIcon(A, 'info')}<span>${nextStep(g)}</span></div>
      ${queueHTML(P)}
      ${chip}
      ${station ? '' : `<div class="tabs" data-scrollx="ctabs">${tabs}</div>`}
      <div class="rlist" data-scroll="rlist">${cards}</div>
    </div>`;
}

function queueHTML(P) {
  const g = P.g, A = g.A, Q = g.craft.queue;
  if (!Q.length) return `<div class="cq empty"><small>Fila vazia · toque numa receita para criar (máx. ${MAX_QUEUE})</small></div>`;
  const e = Q[0], r = RECIPES[e.id];
  const rest = Q.slice(1).map((q, i) => `<button class="cqi" data-cancel="${i + 1}" title="Cancelar">${itemIco(A, RECIPES[q.id].out)}<i>×</i></button>`).join('');
  return `<div class="cq">
    <button class="cqi cur" data-cancel="0" title="Cancelar">${itemIco(A, r.out)}<i>×</i></button>
    <div class="cqb"><div class="cqn"><b>${ITEMS[r.out].name}</b><small class="cqs">${g.craft.status || 'Criando…'}</small></div>
      <div class="bar cqbar"><i style="transform:scaleX(${Math.min(1, e.t / r.time).toFixed(3)})"></i><b></b></div></div>
    <div class="cqr">${rest}</div>
  </div>`;
}

export function craftBind(P, el) {
  const g = P.g;
  el.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => { P.craftTab = b.dataset.ctab; P.resetScroll('rlist'); P.render(); }));
  el.querySelectorAll('[data-craft]').forEach((b) => b.addEventListener('click', () => {
    if (enqueue(g, b.dataset.craft, 1)) P.render();
  }));
  el.querySelectorAll('[data-craft5]').forEach((b) => b.addEventListener('click', () => {
    if (enqueue(g, b.dataset.craft5, 5)) P.render();
  }));
  el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { cancelCraft(g, +b.dataset.cancel); P.render(); }));
  el.querySelector('[data-allrec]')?.addEventListener('click', () => {
    const st = P.craftStation;
    P.craftStation = null;
    const first = RECIPE_ORDER.find((id) => stationsOf(RECIPES[id]).includes(st));
    if (first) P.craftTab = RECIPES[first].cat;
    P.render();
  });
  el.querySelector('[data-goto]')?.addEventListener('click', () => P.show('build'));
}

// live progress without re-rendering (called every frame while open)
export function craftUpdate(P) {
  const g = P.g, Q = g.craft.queue, el = P.el;
  if (P.craftV !== g.craft.v) { P.craftV = g.craft.v; P.render(); return; }
  if (!Q.length) return;
  const e = Q[0], r = RECIPES[e.id];
  const bar = el.querySelector('.cqbar > i');
  if (bar) bar.style.transform = `scaleX(${Math.min(1, e.t / r.time).toFixed(3)})`;
  const s = el.querySelector('.cqs');
  const txt = g.craft.status || 'Criando…';
  if (s && s.textContent !== txt) s.textContent = txt;
}
