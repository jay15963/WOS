// The mural of a settlement (docs/REINOS.md): the panel opened from the notice board on the plaza (E / a tap). Header with
// the kingdom's banner, the place's name, kind, kingdom and population; tabs Lugar · Reino · Trabalhos · Comércio ·
// Exército · Propriedades — Trabalhos / Comércio / Propriedades and the card "Você e o reino" (tab Reino) are the
// economy of phase 2 (ui/muralEco.js, game/eco.js); Exército is phase 3 ("Em breve"). Opening one counts as "seen"
// (the gold "!" over the murals goes: game/towns.js).
import { bannerURL } from './heraldry.js';
import { svgIcon } from './icons.js';
import { DIVISIONS_PT, CHARGES_PT } from '../world/realm/names.js';
import { ecoTabs, ecoBind, realmCard } from './muralEco.js';
import { realmRelations, armyTab } from './muralWar.js'; // phase 3a: the kingdom's relations / news, the army (docs/REINOS.md §13)

export const MURAL_TABS = [['place', 'Lugar'], ['realm', 'Reino'], ['jobs', 'Trabalhos'], ['trade', 'Comércio'], ['army', 'Exército'], ['land', 'Propriedades']];
const SOON = {};
const ECO_TABS = new Set(['jobs', 'trade', 'land']);
// the economy changes under an open mural (a trade, a job's progress, the coins in the backpack): re-render, coalesced
const HOOKED = new WeakSet();
function hook(panels) {
  const g = panels.g;
  if (HOOKED.has(g)) return;
  HOOKED.add(g);
  let t = 0;
  const again = () => {
    if (panels.open !== 'mural' || t) return;
    t = setTimeout(() => { t = 0; if (panels.open === 'mural') panels.render(); }, 60);
  };
  g.events.on('eco', again);
  g.events.on('realms', () => { if (panels.muralTab === 'realm' || panels.muralTab === 'army' || panels.muralTab === 'place') again(); }); // (a war, a siege, a capture: phase 3a)
  g.events.on('inventory', () => { if (ECO_TABS.has(panels.muralTab) || panels.muralTab === 'realm') again(); });
}
const KIND_ART = { city: 'à cidade', castle: 'ao castelo', village: 'à vila' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dirPt = (dx, dy) => {
  const a = Math.atan2(dy, dx), k = (Math.round(a / (Math.PI / 4)) + 8) % 8;
  return ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'][k];
};

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
.p-mural { width: min(620px, 94vw); }
.p-mural .mu-head { display: flex; gap: 14px; align-items: center; padding: 6px 10px 12px; margin-bottom: 8px; border-radius: 10px; background: linear-gradient(180deg, rgba(251,241,220,0.95), rgba(232,214,176,0.92)); box-shadow: inset 0 0 0 2px rgba(60,36,18,0.25); }
.p-mural .mu-ban { width: 64px; height: auto; filter: drop-shadow(0 3px 2px rgba(0,0,0,0.35)); flex: none; }
.p-mural .mu-name { font: 700 26px/1.05 var(--n-fd); color: var(--n-ink); letter-spacing: 0.4px; }
.p-mural .mu-sub { font: 600 14px/1.3 system-ui, sans-serif; color: var(--n-ink-2); margin-top: 4px; }
.p-mural .mu-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
.p-mural .mu-pill { font: 700 12px/1 system-ui, sans-serif; padding: 5px 9px; border-radius: 999px; background: rgba(255,248,232,0.75); color: var(--n-ink); border: 1px solid rgba(60,36,18,0.25); }
.p-mural .mu-pill b { color: var(--n-coral-lo); }
.p-mural .mu-body { font: 500 14px/1.45 system-ui, sans-serif; color: var(--n-cream, #f6ead0); padding: 2px 6px 4px; }
.p-mural .mu-body b { color: #ffe39a; }
.p-mural .mu-body h4 { font: 700 15px/1.2 var(--n-fd); margin: 12px 0 5px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--n-mustard-hi, #f0c24a); }
.p-mural .mu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 5px 10px; }
.p-mural .mu-lead { margin: 2px 0 10px; font-size: 15px; }
.p-mural .mu-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.p-mural .mu-st { background: linear-gradient(180deg, rgba(251,241,220,0.96), rgba(232,214,176,0.94)); border-radius: 9px; padding: 7px 6px 6px; text-align: center; box-shadow: inset 0 0 0 1.5px rgba(60,36,18,0.25); }
.p-mural .mu-st b { display: block; font: 700 22px/1 var(--n-fd); color: #8a3a1c; }
.p-mural .mu-st span { display: block; font: 700 11px/1.15 system-ui, sans-serif; color: #4a3020; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 4px; }
.p-mural .mu-note { color: rgba(246,234,208,0.85); }
.p-mural .mu-row { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid rgba(246,234,208,0.14); }
.p-mural .mu-row .k { color: rgba(246,234,208,0.72); }
.p-mural .mu-list { display: flex; flex-wrap: wrap; gap: 5px; }
.p-mural .mu-chip { padding: 4px 8px; border-radius: 8px; background: rgba(255,248,232,0.88); color: var(--n-ink, #24160d); border: 1px solid rgba(60,36,18,0.25); font-size: 13px; }
.p-mural .mu-chip.here { background: var(--n-mustard-hi); font-weight: 700; }
.p-mural .mu-soon { text-align: center; padding: 22px 16px 26px; }
.p-mural .mu-soon .tag { display: inline-block; font: 700 13px/1 var(--n-fd); text-transform: uppercase; letter-spacing: 1px; padding: 6px 12px; border-radius: 999px; background: var(--n-mustard); color: var(--n-ink); margin-bottom: 10px; }
.p-mural .mu-soon p { max-width: 420px; margin: 0 auto; color: rgba(246,234,208,0.85); }
.p-mural .mu-sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; border: 1px solid rgba(0,0,0,0.35); }
`;
  document.head.appendChild(s);
}

export function muralBody(panels) {
  style();
  hook(panels);
  const g = panels.g, d = panels.data || {}, T = g.towns, I = T?.info?.(d.sid);
  if (!I) return { title: 'Mural', body: '<p class="muted">Este mural está apagado pela chuva.</p>' };
  const tab = panels.muralTab || 'place';
  const K = I.kingdom, B = K.banner, realm = T.realm;
  const L = T.layout(I.id);
  const tabs = MURAL_TABS.map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-mtab="${k}">${n}${SOON[k] ? ' <small>·</small>' : ''}</button>`).join('');
  const eco = ECO_TABS.has(tab) ? ecoTabs(panels, I, tab) : null;
  const head = `<div class="mu-head${eco ? ' small' : ''}"><img class="mu-ban" src="${bannerURL(B, 56, 84)}" alt="">
    <div><div class="mu-name">${esc(I.name)}</div>
    <div class="mu-sub">${I.kindPt}${I.kind === 'city' && I.capital?.id === I.id ? ' · capital' : ''} do Reino de ${esc(K.name)}${I.seedK != null && I.seedK !== K.id ? ` · tomada do Reino de ${esc(realm.kingdoms[I.seedK].name)}` : ''}${g.realms?.besieged?.(I.id) ? ' · <b style="color:#b8322a">sob cerco</b>' : ''}</div>
    <div class="mu-pills"><span class="mu-pill">População <b>${I.pop}</b></span><span class="mu-pill">${L ? L.buildings.length : 0} construções</span>${I.walls ? `<span class="mu-pill">${I.walls === 'stone' ? 'Muralha de pedra' : 'Paliçada'}</span>` : '<span class="mu-pill">Sem muralha</span>'}</div></div></div>`;
  let body = '';
  if (tab === 'place') {
    const cap = I.capital, p = g.player;
    const counts = {};
    for (const b of L?.buildings || []) counts[b.name] = (counts[b.name] || 0) + 1;
    const builds = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<span class="mu-chip">${c > 1 ? c + '× ' : ''}${esc(n)}</span>`).join('');
    const capLine = cap.id === I.id ? 'Aqui é a capital do reino.' : `A capital, ${esc(cap.name)}, fica a ${Math.round(Math.hypot(g.world.dx(cap.x, I.x), cap.y - I.y))} passos a ${dirPt(g.world.dx(cap.x, I.x), cap.y - I.y)}.`;
    const fields = L?.fields.length || 0, pens = L?.pens.length || 0, gates = L?.gates.length || 0;
    const guards = L?.hooks.guards.length || 0;
    const homes = L?.hooks.homes.length || 0, beds = (L?.hooks.homes || []).reduce((n, h) => n + h.beds.length, 0);
    const stat = (n, label) => `<div class="mu-st"><b>${n}</b><span>${label}</span></div>`;
    body = `<p class="mu-lead">Bem-vindo ${KIND_ART[I.kind]} de <b>${esc(I.name)}</b>. ${capLine}</p>
      <div class="mu-stats">${stat(I.pop, 'Moradores')}${stat(homes, homes === 1 ? 'Casa' : 'Casas')}${stat(beds, 'Camas')}${stat(gates, gates === 1 ? 'Portão' : 'Portões')}${stat(guards, 'Postos da guarda')}${stat(fields, 'Campos')}${stat(pens, 'Cercados')}${stat(L?.buildings.length || 0, 'Construções')}</div>
      <h4>Construções</h4><div class="mu-list">${builds || '<span class="muted">—</span>'}</div>
      <h4>Regras do lugar</h4><p class="mu-note">${I.kind === 'castle' ? 'Dentro do castelo não se constrói.' : `Dentro da terra de ${esc(I.name)} só se constrói num terreno comprado (aba Propriedades); fora dela, à vontade.`} Os portões abrem de dia e fecham à noite e quando há inimigos dentro.</p>`;
  } else if (tab === 'realm') {
    const ss = g.realms?.placesOf ? g.realms.placesOf(K.id) : K.settlements.map((sid) => realm.settlements[sid]); // (its places now: the captured ones too)
    const chip = (s) => `<span class="mu-chip${s.id === I.id ? ' here' : ''}">${esc(s.name)}${s.k !== K.id ? ' <small>(tomada)</small>' : ''}${g.realms?.besieged?.(s.id) ? ' ⚔' : ''}</span>`;
    const by = (k) => ss.filter((s) => s.kind === k);
    const nbs = K.neighbours.map((k) => realm.kingdoms[k]);
    const sw = (c) => `<i class="mu-sw" style="background:rgb(${c.join(',')})"></i>`;
    body = `${realmRelations(panels, I)}${realmCard(panels, I)}<p>O <b>Reino de ${esc(K.name)}</b> ${sw(K.color)} tem ${ss.length} lugares: ${by('city').length === 1 ? 'a capital' : `${by('city').length} cidades`}, ${by('castle').length} castelos e ${by('village').length} vilas.</p>
      <h4>Brasão</h4><p>${sw(B.f)}campo ${DIVISIONS_PT[B.d] || ''}${B.c !== 'none' ? `, ${CHARGES_PT[B.c]} de ${B.m === 'or' ? 'ouro' : 'prata'}` : ''}.</p>
      <h4>Capital</h4><div class="mu-list">${by('city').map(chip).join('')}</div>
      <h4>Castelos</h4><div class="mu-list">${by('castle').map(chip).join('')}</div>
      <h4>Vilas</h4><div class="mu-list">${by('village').map(chip).join('')}</div>
      <h4>Vizinhos</h4><div class="mu-list">${nbs.length ? nbs.map((n) => `<span class="mu-chip">${sw(n.color)}${esc(n.name)}${T.canReach(K.id, n.id) ? '' : ' (outro continente)'}</span>`).join('') : '<span class="muted">Nenhum reino vizinho por terra.</span>'}</div>`;
  } else if (eco) {
    body = eco.body;
  } else if (tab === 'army') {
    body = armyTab(panels, I);
  } else {
    const [h, txt] = SOON[tab] || ['', ''];
    body = `<div class="mu-soon"><div class="tag">Em breve</div><h4>${h}</h4><p>${txt}</p></div>`;
  }
  return { title: `Mural · ${esc(I.name)}`, cls: eco?.cls || '', body: `<div class="tabs" data-scrollx="mtabs">${tabs}</div>${head}<div class="mu-body" data-scroll="mu-${tab}">${body}</div>` };
}

export function muralBind(panels, el) {
  el.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => { if (panels.muralTab !== b.dataset.mtab) { const pb = el.querySelector('.pb'); if (pb) pb.scrollTop = 0; } panels.muralTab = b.dataset.mtab; panels.render(); }));
  ecoBind(panels, el); // (the economy tabs and the kingdom card: ui/muralEco.js)
  const H = panels.g.ctl?.hinted;
  if (H && !H.mural) H.mural = true; // sync-ok: a local hint flag (the gold "!" over the murals goes)
}
export const muralIcon = () => svgIcon('map');
