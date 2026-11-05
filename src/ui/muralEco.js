// The economy tabs of the mural (docs/REINOS.md "Fase 2 — economia", game/eco.js): Comércio (the market: buy / sell
// with a quantity, the price impact, your purse and backpack beside it, "barato aqui / vende bem aqui", where it sells
// better), Trabalhos (the day's board, your jobs with progress, turn in / abandon), Propriedades (yours, houses for sale /
// for rent, plots; tax and debts) and the card "Você e o reino" of the Reino tab (reputation, join / leave).
// Every action is an intent to the host (mut/eco.js); the panel re-renders on the 'eco' / 'inventory' events.

import { ITEMS } from '../game/data.js';
import { itemIco } from './econIcons.js';
import {
  GOODS, NG, GI, RANKS, profileOf, quoteBuy, quoteSell, maxAfford, landAverage, bestMarkets, meUid, myRec, rankInfo, taxRate, boardOf,
  jobState, jobTarget, jobWaypoint, ecoDay, propsOf, propById, chargeOf, propsOfUid, payBills, dealReason, atMural, fmt, dirPt, kingdomOf, settlement, priceFactor, goodBase, demandOf,
  JOB_MAX, PROP, REP, COIN, PARCEL, inheritFor, rentOf,
} from '../game/eco.js';
import { GOOD_CATS, JOB_KINDS } from '../game/content/eco.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => (Math.round(v * 1000) / 10).toString().replace('.', ',') + '%';
import { INHERIT as INHERIT_PT } from '../game/content/eco.js'; // (phase 3a: the reputation a member inherits)
const KIND_PT = { city: 'cidade', castle: 'castelo', village: 'vila' };
const coinIco = (A) => `<span class="ec-co">${itemIco(A, COIN)}</span>`;
const money = (A, n, cls = '') => `<span class="ec-m ${cls}">${coinIco(A)}${fmt(n)}</span>`;

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
.p-mural.wide { width: min(940px, 96vw); }
.p-mural.mid { width: min(720px, 96vw); }
.p-mural .mu-head.small { padding: 4px 10px 6px; gap: 10px; margin-bottom: 6px; }
.p-mural .mu-head.small .mu-ban { width: 34px; }
.p-mural .mu-head.small .mu-name { font-size: 21px; }
.p-mural .mu-head.small .mu-pills { display: none; }
.ec { font: 500 14px/1.35 system-ui, sans-serif; color: var(--n-text); }
.p-mural .mu-body .ec-realm b, .p-mural .mu-body .ec-card b, .p-mural .mu-body .ec-deal b, .p-mural .mu-body .ec-act b, .p-mural .mu-body .ec-where b { color: inherit; }
.p-mural .mu-body .ec-realm .rk b { color: #8a3a1c; }
.ec h4 { font: 700 15px/1.2 var(--n-fd); margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--n-mustard-hi); display: flex; align-items: baseline; gap: 8px; }
.ec h4 small { font: 600 12.5px system-ui, sans-serif; color: var(--n-text-2); text-transform: none; letter-spacing: 0; }
.ec .muted { color: var(--n-text-2); }
.ec-co { display: inline-block; width: 18px; height: 18px; vertical-align: -4px; margin-right: 2px; }
.ec-co .spri, .ec-co .emo { width: 100%; height: 100%; display: block; font-size: 14px; }
.ec-m { font: 700 16px/1 var(--n-fd); color: #ffe39a; white-space: nowrap; letter-spacing: 0.3px; }
.ec-m.big { font-size: 22px; }
.ec-m.bad { color: #ff9a8a; }
.ec-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 7px 10px; border-radius: 8px; background: rgba(20,12,6,0.35); box-shadow: inset 0 0 0 1px rgba(242,228,196,0.12); margin-bottom: 8px; }
.ec-top .lbl { font: 600 12px system-ui, sans-serif; color: var(--n-text-2); text-transform: uppercase; letter-spacing: 0.6px; }
.ec-top .sep { flex: 1; }
.ec-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px; font: 700 12.5px/1.1 system-ui, sans-serif; background: rgba(255,248,232,0.12); color: var(--n-text); border: 1px solid rgba(242,228,196,0.2); }
.ec-pill.gold { background: rgba(226,180,67,0.2); color: #ffe39a; border-color: rgba(226,180,67,0.45); }
.ec-pill.good { background: rgba(147,176,76,0.22); color: #d6efa0; border-color: rgba(147,176,76,0.45); }
.ec-pill.bad { background: rgba(229,87,74,0.22); color: #ffb7aa; border-color: rgba(229,87,74,0.5); }
.ec-pill.teal { background: rgba(63,168,156,0.22); color: #a8eadf; border-color: rgba(63,168,156,0.5); }
.ec-hint { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 13px; margin: 0 2px 8px; color: var(--n-text-2); }
.ec-hint b { color: var(--n-text); font-weight: 700; }
.ec-hint .c { color: #c3dc7c; } .ec-hint .s { color: #ffd27a; }
.ec-news { margin: 0 0 8px; padding: 6px 10px; border-radius: 8px; background: rgba(226,180,67,0.12); border: 1px dashed rgba(226,180,67,0.45); font-size: 13px; color: #f3e2b4; }
/* the market */
.ec-cols { display: grid; grid-template-columns: 1fr 230px; gap: 12px; align-items: start; }
.ec-list { min-width: 0; }
.ec-lh, .ec-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 56px 62px 62px 50px; align-items: center; gap: 6px; }
.ec-lh { font: 700 11px system-ui, sans-serif; color: var(--n-text-3, #b9a88a); text-transform: uppercase; letter-spacing: 0.5px; padding: 0 8px 3px; position: sticky; top: -10px; background: #2f1e10; z-index: 1; }
.ec-lh span:nth-child(n+3) { text-align: right; }
.ec-cat { font: 700 12.5px var(--n-fd); color: var(--n-mustard-hi); text-transform: uppercase; letter-spacing: 1px; margin: 8px 4px 3px; }
.ec-row { width: 100%; min-height: 42px; padding: 3px 8px; border-radius: 7px; text-align: left; color: var(--n-text); background: rgba(255,248,232,0.04); margin-bottom: 3px; border: 1px solid transparent; cursor: pointer; }
.ec-row:hover { background: rgba(255,248,232,0.09); }
.ec-row.sel { background: rgba(226,180,67,0.16); border-color: rgba(226,180,67,0.6); }
.ec-row .ic { width: 34px; height: 34px; }
.ec-row .ic .spri, .ec-row .ic .emo { width: 100%; height: 100%; display: block; font-size: 24px; }
.ec-row .nm { font: 700 15px/1.1 var(--n-fd); letter-spacing: 0.3px; overflow: hidden; }
.ec-row .nm small { display: block; font: 600 11.5px system-ui, sans-serif; letter-spacing: 0; margin-top: 2px; }
.ec-row .nm small.c { color: #c3dc7c; } .ec-row .nm small.s { color: #ffd27a; } .ec-row .nm small.x { color: #ffb7aa; }
.ec-row .num { text-align: right; font: 700 15px/1 var(--n-fd); }
.ec-row .num.b { color: #ffe39a; } .ec-row .num.v { color: #c3dc7c; } .ec-row .num.h { color: var(--n-cream-hi); }
.ec-row .num.out { color: #ff9a8a; font-size: 12px; }
.ec-row .num.zero { color: var(--n-text-3, #8d7c62); }
.ec-deal { margin: -1px 0 8px; padding: 10px; border-radius: 0 0 9px 9px; background: linear-gradient(180deg, rgba(251,241,220,0.97), rgba(232,214,176,0.96)); color: var(--n-ink); box-shadow: inset 0 0 0 2px rgba(60,36,18,0.3); }
.ec-deal .dhead { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ec-deal .dhead .spri, .ec-deal .dhead .emo { width: 40px; height: 40px; }
.ec-deal .dhead b { font: 700 18px/1.1 var(--n-fd); text-transform: uppercase; color: var(--n-ink); }
.ec-deal .dhead small { display: block; font-size: 12.5px; color: #5c4026; }
.ec-q { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 9px; }
.ec-q .lbl { font: 700 12px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; color: #5c4026; margin-right: 2px; }
.ec-q .st { width: 40px; height: 40px; border-radius: 9px; font: 800 22px/1 var(--n-fd); color: var(--n-ink); background: #fff8e8; box-shadow: inset 0 0 0 2px rgba(60,36,18,0.45), 0 2px 0 rgba(60,36,18,0.25); }
.ec-q .st:active { transform: translateY(1px); }
.ec-q .qv { min-width: 54px; text-align: center; font: 800 26px/1 var(--n-fd); color: var(--n-ink); }
.ec-q .chip { height: 34px; padding: 0 11px; border-radius: 8px; font: 700 14px/1 var(--n-fd); color: var(--n-ink); background: rgba(255,255,255,0.55); box-shadow: inset 0 0 0 1.5px rgba(60,36,18,0.35); }
.ec-q .chip.on { background: var(--n-mustard-hi); }
.ec-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ec-act { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 9px 11px; border-radius: 10px; text-align: left; color: var(--n-ink); min-height: 74px; box-shadow: inset 0 0 0 2px rgba(36,22,13,0.6), 0 3px 0 rgba(36,22,13,0.35); }
.ec-act.buy { background: linear-gradient(180deg, #f9dc84, #e2b443); }
.ec-act.sell { background: linear-gradient(180deg, #c7e08a, #93b04c); }
.ec-act:disabled { filter: grayscale(0.7); opacity: 0.6; }
.ec-act:not(:disabled):active { transform: translateY(2px); box-shadow: inset 0 0 0 2px rgba(36,22,13,0.6), 0 1px 0 rgba(36,22,13,0.35); }
.ec-act b { font: 800 17px/1 var(--n-fd); text-transform: uppercase; letter-spacing: 0.4px; }
.ec-act .tot { font: 800 22px/1 var(--n-fd); display: flex; align-items: center; gap: 3px; }
.ec-act .tot .ec-co { width: 22px; height: 22px; }
.ec-act small { font: 600 12px/1.25 system-ui, sans-serif; color: #3e2a16; }
.ec-act small i { font-style: normal; font-weight: 800; }
.ec-act small .up { color: #9c2f27; } .ec-act small .dn { color: #2c5a12; }
.ec-maxs { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; font-size: 12.5px; }
.ec-maxs button { color: #6a3b12; text-decoration: underline; font-weight: 700; font-size: 12.5px; }
.ec-where { margin-top: 8px; font-size: 12.5px; color: #3e2a16; line-height: 1.4; }
.ec-where b { color: #24160d; }
.ec-bag { position: sticky; top: 0; padding: 8px; border-radius: 10px; background: rgba(20,12,6,0.32); box-shadow: inset 0 0 0 1px rgba(242,228,196,0.14); }
.ec-bag .bh { font: 700 13px var(--n-fd); text-transform: uppercase; letter-spacing: 0.8px; color: var(--n-mustard-hi); margin-bottom: 6px; display: flex; justify-content: space-between; }
.ec-bitems { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 5px; }
.ec-bi { position: relative; height: 66px; padding: 4px 3px 2px; border-radius: 8px; background: rgba(255,248,232,0.07); display: flex; flex-direction: column; align-items: center; gap: 1px; border: 1px solid transparent; }
.ec-bi:hover { background: rgba(255,248,232,0.14); }
.ec-bi.sel { border-color: rgba(226,180,67,0.7); background: rgba(226,180,67,0.16); }
.ec-bi .spri, .ec-bi .emo { width: 30px; height: 30px; }
.ec-bi .q { position: absolute; top: 2px; right: 4px; font: italic 800 13px/1 var(--n-fd); color: var(--n-cream-hi); text-shadow: 0 1px 0 #000; }
.ec-bi .p { font: 700 12.5px/1 var(--n-fd); color: #c3dc7c; white-space: nowrap; }
.ec-bi .p .ec-co { width: 13px; height: 13px; vertical-align: -2px; }
.ec-bi.no { opacity: 0.45; }
.ec-bi.no .p { color: var(--n-text-3, #8d7c62); }
.ec-bag .bnote { font-size: 12px; color: var(--n-text-2); margin-top: 6px; line-height: 1.35; }
/* jobs / properties: cards */
.ec-card { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: start; padding: 10px; border-radius: 10px; margin-bottom: 7px;
  background: linear-gradient(180deg, rgba(251,241,220,0.96), rgba(232,214,176,0.94)); color: var(--n-ink); box-shadow: inset 0 0 0 1.5px rgba(60,36,18,0.3); }
.ec-card.taken { box-shadow: inset 0 0 0 2px #3fa89c; }
.ec-card.ready { box-shadow: inset 0 0 0 2.5px #7fae46, 0 0 12px rgba(147,176,76,0.45); }
.ec-card.warn { box-shadow: inset 0 0 0 2.5px #e5574a; }
.ec-card.off { opacity: 0.6; }
.ec-card .ck { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; background: radial-gradient(circle, #fff8e8, #e3cea2); box-shadow: 0 0 0 2px var(--n-ink); }
.ec-card .ck .spri { width: 32px; height: 32px; }
.ec-card .ct { font: 700 17px/1.15 var(--n-fd); text-transform: uppercase; letter-spacing: 0.3px; }
.ec-card .cg { font: 600 12.5px system-ui, sans-serif; color: #6a4a2a; margin-top: 1px; }
.ec-card p { margin: 5px 0 6px; font-size: 13.5px; line-height: 1.35; color: #3a2614; }
.ec-card .chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ec-card .chip { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 999px; font: 700 12.5px/1.2 system-ui, sans-serif; background: rgba(60,36,18,0.1); color: #3a2614; }
.ec-card .chip.gold { background: #f7d97a; color: #4a3008; box-shadow: inset 0 0 0 1px rgba(122,74,10,0.4); }
.ec-card .chip.gold .ec-co { width: 15px; height: 15px; vertical-align: -3px; }
.ec-card .chip.rep { background: #cfe3a2; color: #2c4410; }
.ec-card .chip.bad { background: #ffd0c6; color: #8a2016; }
.ec-card .chip.teal { background: #bfe9e2; color: #134a43; }
.ec-card .ca { display: flex; flex-direction: column; gap: 6px; align-items: stretch; min-width: 108px; }
.ec-card .ca .btn { justify-content: center; }
.ec-card .ca .btn.ghost { color: var(--n-text); }
.ec-bar { position: relative; height: 18px; border-radius: 9px; background: rgba(60,36,18,0.18); overflow: hidden; margin: 6px 0 2px; box-shadow: inset 0 0 0 1px rgba(60,36,18,0.3); }
.ec-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(180deg, #a8d870, #6f9a3c); border-radius: 9px; }
.ec-bar span { position: relative; display: block; text-align: center; font: 800 13px/18px var(--n-fd); color: #1e2c0c; }
.ec-empty { text-align: center; padding: 16px 10px; color: var(--n-text-2); }
.ec-empty b { display: block; font: 700 16px var(--n-fd); color: var(--n-text); text-transform: uppercase; margin-bottom: 4px; }
.ec-realm { padding: 10px 12px; border-radius: 10px; margin-bottom: 4px; background: linear-gradient(180deg, rgba(251,241,220,0.97), rgba(232,214,176,0.95)); color: var(--n-ink); box-shadow: inset 0 0 0 2px rgba(60,36,18,0.3); }
.ec-realm .rt { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ec-realm .rt b { font: 700 20px/1.1 var(--n-fd); text-transform: uppercase; }
.ec-realm .rs { font: 700 12px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.6px; padding: 4px 9px; border-radius: 999px; background: #3fa89c; color: #fff; }
.ec-realm .rs.trav { background: #8a6a40; }
.ec-realm .rk { margin: 8px 0 2px; font-size: 13.5px; }
.ec-realm .rk b { font: 700 16px var(--n-fd); text-transform: uppercase; }
.ec-realm .ec-bar i { background: linear-gradient(180deg, #f7d97a, #c99a2c); }
.ec-realm .ec-bar.neg i { background: linear-gradient(180deg, #f08a6e, #b8322a); }
.ec-realm .ec-bar span { color: #3a2608; }
.ec-realm ul { margin: 6px 0 2px 18px; padding: 0; font-size: 13px; color: #3a2614; }
.ec-realm .ra { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
.ec-realm .ra small { color: #5c4026; font-size: 12.5px; }
.ec-reps { display: flex; flex-wrap: wrap; gap: 5px; }
@media (max-width: 700px) {
  .ec-cols { grid-template-columns: 1fr; }
  .ec-bag { position: static; order: -1; padding: 6px; }
  .ec-bitems { display: flex; overflow-x: auto; gap: 5px; padding-bottom: 3px; }
  .ec-bi { flex: none; width: 62px; }
  .ec-bag .bnote { display: none; }
  .ec-lh, .ec-row { grid-template-columns: 32px minmax(0, 1fr) 46px 52px 52px 40px; gap: 4px; }
  .ec-lh { font-size: 9.5px; letter-spacing: 0; padding: 0 5px 3px; }
  .ec-row { padding: 3px 5px; }
  .ec-row .nm { font-size: 14px; }
  .ec-row .num { font-size: 14px; }
  .ec-card { grid-template-columns: 38px 1fr; }
  .ec-card .ck { width: 38px; height: 38px; font-size: 19px; }
  .ec-card .ca { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; }
  .ec-card .ca .btn { flex: 1; }
  .ec-acts { gap: 6px; }
  .ec-act { min-height: 70px; padding: 8px; }
}
`;
  document.head.appendChild(s);
}

// ---------- shared state of the panel (not the game's): the selected good, the quantity ----------
const UI = (panels) => (panels.eco ||= { good: null, n: 1, confirm: null, confirmT: 0 });

export function ecoTabs(panels, I, tab) {
  style();
  const g = panels.g;
  if (!g.eco?.mk || g.eco.day < 0) return { body: '<div class="ec-empty"><b>O mercado está abrindo…</b>Um instante.</div>', cls: 'mid' };
  if (tab === 'trade') return { body: tradeBody(panels, I), cls: 'wide' };
  if (tab === 'jobs') return { body: jobsBody(panels, I), cls: 'mid' };
  if (tab === 'land') return { body: landBody(panels, I), cls: 'mid' };
  return null;
}

// ---------- Comércio ----------
function tradeBody(panels, I) {
  const g = panels.g, A = g.A, p = g.player, sid = I.id, me = meUid(g), ui = UI(panels);
  const P = profileOf(g, sid), mk = g.eco.mk.get(sid), K = I.kingdom, ri = rankInfo(g, me, K.id), coins = p.inv.count(COIN);
  const why = dealReason(g, me, K.id);
  if (why) return `<div class="ec"><div class="ec-empty"><b>Sem comércio</b>${esc(why)}</div></div>`;
  const goods = [];
  for (let i = 0; i < NG; i++) if (P.deals[i]) goods.push(i);
  if (ui.good && (GI[ui.good] == null || !P.deals[GI[ui.good]])) ui.good = null;
  // hints: the cheapest here / what sells best here, against the markets of this land
  const rel = goods.map((i) => [i, goodBase(i) * priceFactor(mk[i], demandOf(g, sid, i)) / landAverage(g, sid, i)]);
  const cheap = rel.filter(([i, r]) => r <= 0.82 && mk[i] > 0).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const dear = rel.filter(([, r]) => r >= 1.22).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const nm = (i) => esc(ITEMS[GOODS[i][0]].name.toLowerCase());
  const tags = new Map([...cheap.map(([i]) => [i, ['c', 'barato aqui']]), ...dear.map(([i]) => [i, ['s', 'vende bem aqui']])]);
  const news = (g.eco.ev || []).filter((e) => { const s = settlement(g, e[0]); return s && kingdomOf(g, s.k)?.comp === K.comp; }).slice(0, 3)
    .map((e) => { const s = settlement(g, e[0]); return `${e[2] < 100 ? 'Sobra' : 'Falta'} de <b>${nm(e[1])}</b> em ${esc(s.name)}${e[0] === sid ? ' (aqui!)' : ''}`; });
  const head = `<div class="ec-top"><span class="lbl">Sua bolsa</span>${money(A, coins, 'big')}<span class="sep"></span>
    <span class="ec-pill ${ri.bad >= 0 ? 'bad' : ri.i ? 'good' : ''}" title="Reputação no Reino de ${esc(K.name)}">${esc(ri.name)}${ri.disc ? ` · trocas ${pct(ri.disc)} melhores` : ''}</span>
    <span class="ec-pill">${KIND_PT[I.kind] === 'cidade' ? 'Mercado da cidade' : I.kind === 'castle' ? 'Intendência do castelo' : 'Feira da vila'}</span></div>
    ${cheap.length || dear.length ? `<div class="ec-hint">${cheap.length ? `<span><span class="c">Barato aqui:</span> <b>${cheap.map(([i]) => nm(i)).join(', ')}</b></span>` : ''}${dear.length ? `<span><span class="s">Vende bem aqui:</span> <b>${dear.map(([i]) => nm(i)).join(', ')}</b></span>` : ''}</div>` : ''}
    ${news.length ? `<div class="ec-news">📜 Notícias: ${news.join(' · ')}</div>` : ''}
    ${ri.bad >= 0 ? `<div class="ec-news" style="color:#ffb08a">⚠ Reputação negativa com o Reino de ${esc(K.name)} (${esc(ri.name)}, ${ri.rep}): compra ${pct(ri.buy)} mais cara e venda ${pct(ri.sell)} mais barata. Melhore-a com trabalhos do mural e comércio aqui.</div>` : ''}`;
  let list = `<div class="ec-lh"><span></span><span>Mercadoria</span><span>Estoque</span><span>Compra</span><span>Venda</span><span>Você</span></div>`;
  for (const [cat, cname] of GOOD_CATS) {
    const items = goods.filter((i) => GOODS[i][2] === cat);
    if (!items.length) continue;
    list += `<div class="ec-cat">${cname}</div>`;
    for (const i of items) {
      const id = GOODS[i][0], have = p.inv.count(id), qb = quoteBuy(g, sid, i, 1, me), qs = quoteSell(g, sid, i, 1, me);
      const t = tags.get(i), sel = ui.good === id;
      list += `<button class="ec-row${sel ? ' sel' : ''}" data-good="${id}"><span class="ic">${itemIco(A, id)}</span>
        <span class="nm">${esc(ITEMS[id].name)}${t ? `<small class="${t[0]}">${t[1]}</small>` : mk[i] <= 0 ? '<small class="x">esgotado</small>' : ''}</span>
        <span class="num h">${mk[i]}</span><span class="num b">${mk[i] > 0 ? Math.ceil(qb.unit) : '—'}</span><span class="num v">${qs.gain > 0 ? qs.gain : '—'}</span><span class="num ${have ? 'h' : 'zero'}">${have || '·'}</span></button>`;
      if (sel) list += dealBox(panels, I, i);
    }
  }
  // the backpack beside it: what you carry that sells here
  const bag = [];
  const seen = new Set();
  for (const s of p.inv.slots) if (s && !seen.has(s.id) && s.id !== COIN) { seen.add(s.id); bag.push(s.id); }
  const bagHtml = bag.map((id) => {
    const i = GI[id], ok = i != null && P.deals[i], q = ok ? quoteSell(g, sid, i, 1, me) : null;
    return `<button class="ec-bi${ok ? '' : ' no'}${ui.good === id ? ' sel' : ''}" ${ok ? `data-good="${id}"` : 'disabled'} title="${esc(ITEMS[id].name)}">${itemIco(A, id)}<span class="q">${p.inv.count(id)}</span><span class="p">${ok && q.gain > 0 ? `${coinIco(A)}${q.gain}` : 'não compra'}</span></button>`;
  }).join('');
  return `<div class="ec">${head}<div class="ec-cols"><div class="ec-list">${list}</div>
    <div class="ec-bag"><div class="bh"><span>Sua mochila</span><span>${p.inv.used()}/${p.inv.size}</span></div>
    <div class="ec-bitems">${bagHtml || '<span class="muted">Mochila vazia</span>'}</div>
    <div class="bnote">Toque numa mercadoria para comprar ou vender. Os preços mudam com o que você compra e vende: cada unidade a mais custa (ou paga) um pouco diferente.</div></div></div></div>`;
}
function dealBox(panels, I, i) {
  const g = panels.g, A = g.A, p = g.player, sid = I.id, me = meUid(g), ui = UI(panels), id = GOODS[i][0];
  const coins = p.inv.count(COIN), have = p.inv.count(id), stock = g.eco.mk.get(sid)[i];
  const P = profileOf(g, sid), cap = Math.max(0, Math.round(P.ref[i] * 4) - stock);
  const maxBuy = Math.min(maxAfford(g, sid, i, coins, me), p.inv.room(id)), maxSell = Math.min(have, cap);
  const n = Math.max(1, ui.n | 0);
  const qb = quoteBuy(g, sid, i, n, me), qs = quoteSell(g, sid, i, n, me);
  const chg = (a, b) => { const d = (b - a) / Math.max(0.01, a); return `<i class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${Math.round(d * 100)}%</i>`; };
  const buyNo = stock <= 0 ? 'Esgotado aqui' : qb.n < n ? `O mercado só tem ${stock}` : qb.cost > coins ? `Faltam ${fmt(qb.cost - coins)} moedas` : p.inv.room(id) < n ? 'Mochila cheia' : '';
  const sellNo = have < n ? (have ? `Você tem só ${have}` : 'Você não tem') : n > cap ? `O mercado aceita só mais ${cap}` : qs.gain <= 0 ? 'Não paga nada' : '';
  const best = bestMarkets(g, sid, i, true, 3), cheapest = bestMarkets(g, sid, i, false, 2);
  const w = g.world, wtxt = (q) => `<b>${esc(q.s.name)}</b> ${Math.round(q.price)} (${Math.round(q.d)} passos a ${dirPt(w.dx(q.s.x, I.x), q.s.y - I.y)})`;
  return `<div class="ec-deal">
    <div class="dhead">${itemIco(A, id)}<div><b>${esc(ITEMS[id].name)}</b><small>No mercado: ${stock} · Na sua mochila: ${have}${cap < 9999 && cap < 50 ? ` · aceita mais ${cap}` : ''}</small></div></div>
    <div class="ec-q"><span class="lbl">Quantidade</span><button class="st" data-qd="-1">−</button><span class="qv">${n}</span><button class="st" data-qd="1">+</button>
      ${[1, 5, 10, 25].map((k) => `<button class="chip${n === k ? ' on' : ''}" data-qs="${k}">${k}</button>`).join('')}</div>
    <div class="ec-acts">
      <button class="ec-act buy" data-buy="${id}" ${buyNo ? 'disabled' : ''}><b>Comprar ${n}</b><span class="tot">${coinIco(A)}${fmt(qb.cost)}</span>
        <small>${buyNo ? esc(buyNo) : `≈ ${Math.round(qb.cost / Math.max(1, qb.n))} cada · depois: ${Math.ceil(qb.next)} ${chg(qb.unit, qb.next)}`}</small></button>
      <button class="ec-act sell" data-sell="${id}" ${sellNo ? 'disabled' : ''}><b>Vender ${n}</b><span class="tot">${coinIco(A)}${fmt(qs.gain)}</span>
        <small>${sellNo ? esc(sellNo) : `≈ ${Math.round(qs.gain / n)} cada · depois: ${Math.floor(qs.next)} ${chg(qs.unit, qs.next)}`}</small></button>
    </div>
    <div class="ec-maxs">${maxBuy > 0 ? `<button data-qs="${maxBuy}">pode comprar até ${maxBuy}</button>` : ''}${maxSell > 0 ? `<button data-qs="${maxSell}">vender tudo (${maxSell})</button>` : ''}</div>
    ${best.length ? `<div class="ec-where">Vende melhor em: ${best.map(wtxt).join(' · ')}</div>` : ''}
    ${cheapest.length ? `<div class="ec-where">Mais barato em: ${cheapest.map(wtxt).join(' · ')}</div>` : ''}
  </div>`;
}

// ---------- Trabalhos ----------
function jobCard(panels, j, mine, here) {
  const g = panels.g, A = g.A, p = g.player, K = JOB_KINDS[j.t] || { icon: '•' };
  const s = settlement(g, j.sid), day = ecoDay(g);
  const chips = [`<span class="chip gold">${coinIco(A)}${fmt(j.pay)}</span>`, `<span class="chip rep">+${j.rep} reputação</span>`];
  const left = j.exp - day;
  chips.push(`<span class="chip ${left <= 0 ? 'bad' : ''}">${left <= 0 ? 'último dia' : left === 1 ? 'até amanhã' : `${left} dias`}</span>`);
  let prog = '', cls = '', acts = '';
  if (mine) {
    const st = jobState(g, j);
    let got = j.got | 0, need = j.n, unit = '';
    if (j.t === 'bring') { got = p.inv.count(j.good); unit = ` ${esc(ITEMS[j.good]?.name.toLowerCase() || '')} na mochila`; }
    if (j.t === 'deliver') { got = p.inv.count(PARCEL); unit = ' encomendas na mochila'; }
    const ready = st === 'ready' || ((j.t === 'bring' || j.t === 'deliver') && got >= need);
    const at = j.t === 'deliver' ? j.dest : j.sid, there = settlement(g, at), atHere = atMural(g, at, p);
    cls = ready ? ' ready' : ' taken';
    prog = `<div class="ec-bar"><i style="width:${Math.min(100, (100 * got) / need)}%"></i><span>${Math.min(got, need)} / ${need}${unit}</span></div>
      <div class="cg">${ready ? (atHere ? 'Pronto: entregue aqui!' : `Pronto: entregue no mural de ${esc(there.name)}`) : j.t === 'deliver' ? `Destino: mural de ${esc(there.name)}` : `Em ${esc(s.name)}`}</div>`;
    acts = `${ready ? `<button class="btn primary" data-jdone="${j.id}" ${atHere ? '' : 'disabled'}>Entregar</button>` : ''}
      <button class="btn" data-jtrack="${j.id}">${g.eco.track === j.id ? 'Seguindo' : 'Seguir'}</button>
      <button class="btn ghost" data-jdrop="${j.id}">${UI(panels).confirm === 'drop:' + j.id ? `Abandonar? ${REP.abandon}` : 'Abandonar'}</button>`;
  } else {
    const r = myRec(g), taken = r?.jobs.some((q) => q.id === j.id), done = r?.done.includes(j.id);
    if (done) { cls = ' off'; acts = '<span class="chip rep">Feito ✓</span>'; }
    else if (taken) { cls = ' taken'; acts = '<span class="chip teal">Aceito</span>'; }
    else acts = `<button class="btn primary" data-jtake="${j.id}" ${(r?.jobs.length || 0) >= JOB_MAX || !here ? 'disabled' : ''}>Aceitar</button>`;
  }
  return `<div class="ec-card${cls}"><div class="ck">${K.icon}</div><div><div class="ct">${esc(j.title)}</div>
    <div class="cg">${j.giver ? `${esc(j.giver.name)}, ${esc(String(j.giver.role || '').toLowerCase())}` : ''}${mine && j.sid !== panels.data?.sid ? ` · ${esc(s.name)}` : ''}</div>
    ${mine ? prog : `<p>${esc(j.text)}</p>`}<div class="chips">${chips.join('')}</div></div><div class="ca">${acts}</div></div>`;
}
function jobsBody(panels, I) {
  const g = panels.g, A = g.A, me = meUid(g), r = myRec(g), board = boardOf(g, I.id), K = I.kingdom;
  const why = dealReason(g, me, K.id), here = atMural(g, I.id, g.player);
  const mine = r?.jobs || [];
  const head = `<div class="ec-top"><span class="lbl">Seus trabalhos</span><b>${mine.length}/${JOB_MAX}</b><span class="sep"></span>${money(A, g.player.inv.count(COIN))}
    <span class="ec-pill ${rankInfo(g, me, K.id).i ? 'good' : ''}">${esc(rankInfo(g, me, K.id).name)} em ${esc(K.name)}</span></div>`;
  let body = head;
  if (mine.length) body += `<h4>Em andamento</h4>${mine.map((j) => jobCard(panels, j, true, here)).join('')}`;
  body += `<h4>Quadro de ${esc(I.name)} <small>dia ${ecoDay(g)} · novos pedidos a cada amanhecer</small></h4>`;
  if (why) body += `<div class="ec-empty"><b>Sem trabalho para você</b>${esc(why)}</div>`;
  else if (!board.length) body += '<div class="ec-empty"><b>Ninguém pediu ajuda hoje</b>Volte amanhã: novos pedidos a cada amanhecer.</div>';
  else body += board.map((j) => jobCard(panels, j, false, here)).join('');
  return `<div class="ec">${body}</div>`;
}

// ---------- Propriedades ----------
function landBody(panels, I) {
  const g = panels.g, A = g.A, me = meUid(g), K = I.kingdom, ri = rankInfo(g, me, K.id), coins = g.player.inv.count(COIN), ui = UI(panels);
  const tax = taxRate(g, K.id), mine = propsOfUid(g, me), P = propsOf(g, I.id), owned = g.eco.pr;
  let body = `<div class="ec-top"><span class="lbl">Sua bolsa</span>${money(A, coins, 'big')}<span class="sep"></span>
    <span class="ec-pill">Imposto de ${esc(K.name)}: ${pct(tax)} do valor por dia</span><span class="ec-pill ${ri.i >= REP.buyRank ? 'good' : 'bad'}">${esc(ri.name)}</span></div>`;
  const owe = mine.reduce((a, q) => a + q.row.due, 0);
  body += `<h4>Suas propriedades <small>${mine.length ? `${mine.length} · ${fmt(mine.reduce((a, q) => a + chargeOf(g, q.id, q.row), 0))} moedas por dia (cobradas ao amanhecer, da mochila)` : 'nenhuma ainda'}</small></h4>`;
  if (owe > 0) body += `<div class="ec-card warn"><div class="ck">⚠️</div><div><div class="ct">Dívida: ${fmt(owe)} moedas</div><p>Imposto ou aluguel atrasado. Pague antes que o reino tome a propriedade (3 dias de aviso). Só as moedas da mochila contam.</p></div><div class="ca"><button class="btn primary" data-paydebt ${coins > 0 ? '' : 'disabled'}>Pagar</button></div></div>`;
  for (const q of mine) {
    const pr = q.pr, row = q.row, isH = pr.bi != null, ch = chargeOf(g, q.id, row), left = PROP.warnDays - row.warn;
    const chips = [`<span class="chip">${row.mode === 'rent' ? 'Alugada' : 'Própria'}</span>`, `<span class="chip gold">${coinIco(A)}${fmt(ch)} / dia</span>`];
    if (row.due > 0) chips.push(`<span class="chip bad">deve ${fmt(row.due)} · ${left <= 1 ? 'último dia!' : `${left} dias`}</span>`);
    const leave = ui.confirm === 'leave:' + q.id;
    const back = row.mode === 'own' ? Math.max(0, Math.round(pr.price * PROP.sellBack) - row.due) : 0;
    body += `<div class="ec-card${row.due > 0 ? ' warn' : ' taken'}"><div class="ck">${isH ? '🏠' : '📐'}</div><div><div class="ct">${esc(isH ? pr.name : `Terreno ${pr.w}×${pr.w}`)}</div>
      <div class="cg">${esc(q.s.name)} · Reino de ${esc(kingdomOf(g, g.realms?.owner?.(q.s.id) ?? q.s.k)?.name || '')}${g.realms?.besieged?.(q.s.id) ? ' · <b style="color:#ffb08a">sob cerco: se cair, você a perde</b>' : ''}</div>
      <p>${isH ? `${pr.beds.length} ${pr.beds.length === 1 ? 'cama' : 'camas'}, ${pr.chests.length} ${pr.chests.length === 1 ? 'baú' : 'baús'}: só você abre as portas e os baús; durma para renascer aqui.` : 'Construa à vontade dentro da divisa (Construir · B).'}</p>
      <div class="chips">${chips.join('')}</div></div>
      <div class="ca"><button class="btn" data-pview="${q.id}">Ver</button><button class="btn ghost" data-pleave="${q.id}">${leave ? (row.mode === 'own' ? `Vender por ${fmt(back)}?` : 'Devolver?') : row.mode === 'own' ? 'Vender' : 'Devolver'}</button></div></div>`;
  }
  if (I.kind === 'castle') return `<div class="ec">${body}<div class="ec-empty"><b>O castelo não vende nada</b>É uma fortaleza: nem casas nem terrenos. Procure as vilas e a cidade do reino.</div></div>`;
  const need = ri.i < REP.buyRank ? `<div class="ec-news">Para comprar casa ou terreno em ${esc(K.name)} é preciso ser <b>${RANKS[REP.buyRank].name}</b> (você: ${esc(ri.name)}, ${ri.rep}/${RANKS[REP.buyRank].min} de reputação — faça trabalhos e negocie aqui). Alugar não pede nada.</div>` : '';
  const houseCard = (h) => {
    const row = owned.get(h.id), isRent = h.mode === 'rent', rent = isRent ? rentOf(g, h) : 0, price = isRent ? rent : h.price;
    const tday = Math.max(1, Math.round(h.price * tax));
    const chips = [`<span class="chip gold">${coinIco(A)}${fmt(price)}${isRent ? ' / dia' : ''}</span>`, isRent ? '<span class="chip">sem imposto</span>' : `<span class="chip">imposto ${fmt(tday)}/dia</span>`,
      `<span class="chip">${h.beds.length} ${h.beds.length === 1 ? 'cama' : 'camas'} · ${h.chests.length} ${h.chests.length === 1 ? 'baú' : 'baús'}</span>`];
    let act;
    if (row) act = `<span class="chip ${row.u === me ? 'teal' : ''}">${row.u === me ? 'Sua' : `De ${esc(row.name)}`}</span>`;
    else if (isRent) act = `<button class="btn primary" data-prent="${h.id}" ${coins >= rent ? '' : 'disabled'}>Alugar</button>`;
    else act = `<button class="btn primary" data-pbuy="${h.id}" ${coins >= h.price && ri.i >= REP.buyRank ? '' : 'disabled'}>Comprar</button>`;
    return `<div class="ec-card${row ? ' off' : ''}"><div class="ck">🏠</div><div><div class="ct">${esc(h.name)}</div><div class="cg">${isRent ? 'Para alugar' : 'À venda'}${coins < price && !row ? ` · faltam ${fmt(price - coins)} moedas` : ''}</div><div class="chips">${chips.join('')}</div></div>
      <div class="ca"><button class="btn" data-pview="${h.id}">Ver</button>${act}</div></div>`;
  };
  const sale = P.houses.filter((h) => h.mode === 'sale'), rent = P.houses.filter((h) => h.mode === 'rent');
  body += `<h4>Casas à venda <small>${sale.length ? 'portas, baús e camas passam a ser seus' : ''}</small></h4>${need}${sale.length ? sale.map(houseCard).join('') : '<div class="ec-empty">Nenhuma casa à venda aqui.</div>'}`;
  body += `<h4>Casas para alugar <small>${rent.length ? 'o aluguel é cobrado a cada amanhecer' : ''}</small></h4>${rent.length ? rent.map(houseCard).join('') : '<div class="ec-empty">Nenhuma casa para alugar aqui.</div>'}`;
  body += `<h4>Terrenos <small>dentro da terra de ${esc(I.name)} só se constrói num terreno seu</small></h4>`;
  body += P.plots.length ? P.plots.map((pl) => {
    const row = owned.get(pl.id), tday = Math.max(1, Math.round(pl.price * tax));
    const act = row ? `<span class="chip ${row.u === me ? 'teal' : ''}">${row.u === me ? 'Seu' : `De ${esc(row.name)}`}</span>` : `<button class="btn primary" data-pbuy="${pl.id}" ${coins >= pl.price && ri.i >= REP.buyRank ? '' : 'disabled'}>Comprar</button>`;
    return `<div class="ec-card${row ? ' off' : ''}"><div class="ck">📐</div><div><div class="ct">Terreno ${pl.pi + 1}</div><div class="cg">${pl.w} × ${pl.w} tiles${coins < pl.price && !row ? ` · faltam ${fmt(pl.price - coins)} moedas` : ''}</div>
      <div class="chips"><span class="chip gold">${coinIco(A)}${fmt(pl.price)}</span><span class="chip">imposto ${fmt(tday)}/dia</span></div></div>
      <div class="ca"><button class="btn" data-pview="${pl.id}">Ver</button>${act}</div></div>`;
  }).join('') : '<div class="ec-empty">Nenhum terreno livre dentro da vila.</div>';
  return `<div class="ec">${body}</div>`;
}

// ---------- Reino: you and the kingdom ----------
export function realmCard(panels, I) {
  style();
  const g = panels.g;
  if (!g.eco?.pl) return '';
  const me = meUid(g), r = myRec(g), K = I.kingdom, ri = rankInfo(g, me, K.id), mk = r && r.k >= 0 ? r.k : -1, MK = kingdomOf(g, mk);
  const member = mk === K.id;
  const span = ri.need != null ? ri.need - ri.from : 1, into = ri.need != null ? ri.rep - ri.from : 1;
  const reps = Object.entries(r?.rep || {}).filter(([, v]) => v !== 0).map(([k, v]) => [kingdomOf(g, +k), v]).filter(([q]) => q && !g.realms?.fallen?.has(q.id)).sort((a, b) => b[1] - a[1]);
  const status = member ? `<span class="rs">Membro</span>` : mk >= 0 ? `<span class="rs">Membro de ${esc(MK.name)}</span>` : '<span class="rs trav">Viajante</span>';
  const why = dealReason(g, me, K.id);
  // (phase 3a, owner's rule) negative reputation: worse prices, no joining; joining inherits the kingdom's relations
  const neg = ri.bad >= 0, inh = !member ? inheritFor(g, K.id) : [], hurt = inh.filter(([k, v]) => v < 0 || (r?.rep[k] | 0) > v).length;
  return `<div class="ec ec-realm-wrap"><div class="ec-realm"><div class="rt"><b>Você e ${esc(K.name)}</b>${status}</div>
    <div class="rk">Reputação: <b${neg ? ' style="color:#8a2016"' : ''}>${esc(ri.name)}</b> · ${ri.rep}${ri.need != null ? ` / ${ri.need} para ${esc(ri.next)}` : ' (o mais alto)'}${ri.disc ? ` · trocas ${pct(ri.disc)} melhores` : ''}${neg ? ` · compra ${pct(ri.buy)} mais cara, venda ${pct(ri.sell)} mais barata` : ''}</div>
    <div class="ec-bar${neg ? ' neg' : ''}"><i style="width:${Math.max(0, Math.min(100, (100 * into) / span))}%"></i><span>${ri.need != null ? `${into} / ${span}` : 'Herói'}</span></div>
    ${neg ? `<div class="rk" style="color:#8a2016">Reputação negativa não é inimizade: aqui você ainda negocia e trabalha, só com preços piores. Para entrar no reino, deixe-a em 0 ou mais (trabalhos do mural, comércio).</div>` : ''}
    ${!member && inh.length ? `<div class="rk muted" style="color:#5c4026">Ao entrar você <b>herda as relações</b> do reino: a sua reputação com os outros reinos passa a ser a dele${inh.some((q) => q[1] > 0) ? ` (aliados: +${INHERIT_PT.ally})` : ''}${inh.some((q) => q[1] < 0) ? ` (em guerra com ele: ${INHERIT_PT.war}; trégua: ${INHERIT_PT.truce})` : ''}, os outros 0 — substitui o que você tinha${hurt ? ` em ${hurt} ${hurt === 1 ? 'reino' : 'reinos'}` : ''}. Se sair, ela fica com você.</div>` : ''}
    <div class="rk muted" style="color:#5c4026">Sobe com trabalhos do mural e com comércio aqui (1 ponto a cada ${REP.tradeCoins} moedas negociadas, até ${REP.tradeDayCap} por dia). Imposto do reino: ${pct(taxRate(g, K.id))} do valor das propriedades por dia.</div>
    ${why ? `<div class="rk" style="color:#8a2016">${esc(why)}</div>` : ''}
    <ul>${member ? '<li>Você é súdito deste reino: os inimigos dele serão seus inimigos. Toda mudança nas relações do reino (guerra, paz, aliança, cercos e conquistas) chega para você como aviso.</li><li>Comercia com os reinos da mesma terra que não estão em guerra com este.</li><li>Se um lugar onde você tem casa ou terreno for tomado numa guerra, você perde a propriedade.</li><li>Pode entrar no exército (aba Exército: milícia da vila com Conhecido, castelo e cidade com Respeitado) e seguir as ordens do general, com soldo diário.</li>'
      : '<li><b>Viajante</b>: comercia e trabalha com todos os reinos, mesmo os que estão em guerra entre si.</li><li><b>Membro</b>: jura lealdade ao reino — os inimigos dele serão seus, e as notícias do reino chegam a você; com reputação, pode entrar no exército dele (aba Exército). Dá para sair a qualquer momento, em qualquer mural.</li>'}</ul>
    <div class="ra">${member ? '<button class="btn" data-rleave>Sair do reino</button><small>Você volta a ser viajante.</small>'
      : `<button class="btn primary" data-rjoin ${atMural(g, I.id, g.player) && !neg ? '' : 'disabled'}>${mk >= 0 ? `Trocar para ${esc(K.name)}` : `Entrar no Reino de ${esc(K.name)}`}</button>${neg ? '<small style="color:#8a2016">Reputação negativa: não pode entrar.</small>' : ''}${mk >= 0 ? `<small>Você deixa o Reino de ${esc(MK.name)}.</small>` : ''}${mk >= 0 ? '<button class="btn" data-rleave>Ficar viajante</button>' : ''}`}</div>
    ${reps.length ? `<div class="rk">Sua reputação nos reinos:</div><div class="ec-reps">${reps.map(([q, v]) => `<span class="ec-pill${v < 0 ? ' bad' : ''}">${esc(q.name)}: ${esc(rankInfo(g, me, q.id).name)} (${v})</span>`).join('')}</div>` : ''}
  </div></div>`;
}

// ---------- actions ----------
const err = (g) => (why) => why && g.events.emit('error', { text: why });
function buyGood(g, sid, id, n) {
  const p = g.player, i = GI[id], q = quoteBuy(g, sid, i, n, meUid(g));
  if (q.n < n) return err(g)('O mercado não tem tanto');
  if (p.inv.count(COIN) < q.cost) return err(g)('Moedas insuficientes');
  if (p.inv.room(id) < n) return err(g)('Mochila cheia');
  p.inv.remove(COIN, q.cost);
  g.events.emit('inventory', {});
  g.audio?.play('pickup', {});
  g.net.request('trade.buy', { sid, g: id, n, max: q.cost }, { refund: { [COIN]: q.cost }, onReject: err(g) });
}
function sellGood(g, sid, id, n) {
  const p = g.player, i = GI[id], q = quoteSell(g, sid, i, n, meUid(g));
  if (p.inv.count(id) < n) return err(g)('Você não tem tanto');
  if (q.gain <= 0) return err(g)('Não paga nada');
  p.inv.remove(id, n);
  g.events.emit('inventory', {});
  g.audio?.play('pickup', {});
  g.net.request('trade.sell', { sid, g: id, n, min: q.gain }, { refund: { [id]: n }, onReject: err(g) });
}
function turnIn(g, j) {
  const p = g.player;
  if (j.t === 'bring' || j.t === 'deliver') {
    const item = j.t === 'bring' ? j.good : PARCEL;
    if (p.inv.count(item) < j.n) return err(g)(`Faltam ${j.n - p.inv.count(item)}`);
    p.inv.remove(item, j.n);
    g.events.emit('inventory', {});
    g.net.request('job.done', { id: j.id, paid: j.n }, { refund: { [item]: j.n }, onReject: err(g) });
    return;
  }
  g.net.request('job.done', { id: j.id }, { onReject: err(g) });
}
export function viewPlace(g, x, y, label, kind = 'prop') {
  g.eco.wp = { x, y, label, kind }; // (cosmetic, local: the waypoint of the HUD / radar / map — ui/ecoHud.js)
  g.eco.track = null;
  g.events.emit('eco', { type: 'wp' });
}
export function trackJob(g, j) {
  const t = jobTarget(g, j);
  if (!t) return;
  g.eco.track = j.id;
  g.eco.wp = jobWaypoint(g, j);
  g.events.emit('eco', { type: 'wp' });
}

export function ecoBind(panels, el) {
  const g = panels.g, sid = panels.data?.sid, ui = UI(panels);
  const rerender = () => panels.render();
  const confirm = (key, fn) => {
    if (ui.confirm === key && performance.now() - ui.confirmT < 4000) { ui.confirm = null; fn(); }
    else { ui.confirm = key; ui.confirmT = performance.now(); }
    rerender();
  };
  // a good just picked (in the list or the backpack): its deal box comes into view
  if (ui.scroll) { ui.scroll = false; const d = el.querySelector('.ec-deal'); if (d) { d.scrollIntoView({ block: 'nearest' }); el.querySelector('.ec-row.sel')?.scrollIntoView({ block: 'nearest' }); } }
  el.querySelectorAll('[data-good]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.good;
    ui.good = ui.good === id && b.classList.contains('ec-row') ? null : id;
    ui.n = 1;
    ui.scroll = !!ui.good;
    g.audio?.play('ui_click', {});
    rerender();
  }));
  el.querySelectorAll('[data-qd]').forEach((b) => b.addEventListener('click', () => { ui.n = Math.max(1, (ui.n | 0) + +b.dataset.qd); rerender(); }));
  el.querySelectorAll('[data-qs]').forEach((b) => b.addEventListener('click', () => { ui.n = Math.max(1, +b.dataset.qs | 0); rerender(); }));
  el.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => { buyGood(g, sid, b.dataset.buy, Math.max(1, ui.n | 0)); }));
  el.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => { sellGood(g, sid, b.dataset.sell, Math.max(1, ui.n | 0)); }));
  // jobs
  el.querySelectorAll('[data-jtake]').forEach((b) => b.addEventListener('click', () => {
    g.net.request('job.take', { sid, id: b.dataset.jtake }, { onReject: err(g), onOk: () => { const j = myRec(g)?.jobs.find((q) => q.id === b.dataset.jtake); if (j && !g.eco.track) trackJob(g, j); } });
  }));
  el.querySelectorAll('[data-jdone]').forEach((b) => b.addEventListener('click', () => { const j = myRec(g)?.jobs.find((q) => q.id === b.dataset.jdone); if (j) turnIn(g, j); }));
  el.querySelectorAll('[data-jtrack]').forEach((b) => b.addEventListener('click', () => {
    const j = myRec(g)?.jobs.find((q) => q.id === b.dataset.jtrack);
    if (!j) return;
    if (g.eco.track === j.id) { g.eco.track = null; g.eco.wp = null; } else trackJob(g, j);
    rerender();
  }));
  el.querySelectorAll('[data-jdrop]').forEach((b) => b.addEventListener('click', () => confirm('drop:' + b.dataset.jdrop, () => {
    const id = b.dataset.jdrop, j = myRec(g)?.jobs.find((q) => q.id === id);
    g.net.request('job.drop', { id }, { onReject: err(g), onOk: () => {
      if (j?.t === 'deliver') { const n = Math.min(j.n, g.player.inv.count(PARCEL)); if (n) { g.player.inv.remove(PARCEL, n); g.events.emit('inventory', {}); } } // (the parcels go back to the giver)
      if (g.eco.track === id) { g.eco.track = null; g.eco.wp = null; }
    } });
  })));
  // properties
  el.querySelectorAll('[data-pbuy]').forEach((b) => b.addEventListener('click', () => {
    const pr = propById(g, b.dataset.pbuy), p = g.player;
    if (!pr) return;
    if (p.inv.count(COIN) < pr.price) return err(g)('Moedas insuficientes');
    p.inv.remove(COIN, pr.price);
    g.events.emit('inventory', {});
    g.net.request('prop.buy', { id: pr.id, paid: pr.price }, { refund: { [COIN]: pr.price }, onReject: err(g) });
  }));
  el.querySelectorAll('[data-prent]').forEach((b) => b.addEventListener('click', () => {
    const pr = propById(g, b.dataset.prent), p = g.player;
    if (!pr) return;
    const rent = rentOf(g, pr);
    if (p.inv.count(COIN) < rent) return err(g)('Moedas insuficientes');
    p.inv.remove(COIN, rent);
    g.events.emit('inventory', {});
    g.net.request('prop.rent', { id: pr.id, paid: rent }, { refund: { [COIN]: rent }, onReject: err(g) });
  }));
  el.querySelectorAll('[data-pleave]').forEach((b) => b.addEventListener('click', () => confirm('leave:' + b.dataset.pleave, () => {
    g.net.request('prop.leave', { id: b.dataset.pleave }, { onReject: err(g) });
  })));
  el.querySelectorAll('[data-pview]').forEach((b) => b.addEventListener('click', () => {
    const pr = propById(g, b.dataset.pview);
    if (!pr) return;
    if (pr.bi != null) { const [x0, y0, x1, y1] = pr.box; viewPlace(g, pr.door ? pr.door[0] + 0.5 : (x0 + x1 + 1) / 2, pr.door ? pr.door[1] + 0.5 : (y0 + y1 + 1) / 2, pr.name, 'house'); }
    else viewPlace(g, (pr.x0 + pr.x1 + 1) / 2, (pr.y0 + pr.y1 + 1) / 2, `Terreno ${pr.pi + 1}`, 'plot');
    g.eco.showPlots = pr.sid; // (the plots' outlines on the ground for a while)
    g.eco.showPlotsT = 40;
    panels.close();
  }));
  el.querySelector('[data-paydebt]')?.addEventListener('click', () => {
    const bills = propsOfUid(g, meUid(g)).filter((q) => q.row.due > 0).map((q) => [q.id, q.row.due, q.row.warn]);
    const r = payBills(g, bills, false);
    if (!r.paid) err(g)('Moedas insuficientes na mochila');
  });
  // the kingdom
  el.querySelector('[data-rjoin]')?.addEventListener('click', () => g.net.request('realm.join', { sid }, { onReject: err(g) }));
  el.querySelectorAll('[data-rleave]').forEach((b) => b.addEventListener('click', () => g.net.request('realm.leave', {}, { onReject: err(g) })));
}
export { GOODS };
