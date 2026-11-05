// The mural's war (docs/REINOS.md §13, phase 3a): in the Reino tab the kingdom's relations — at war (since when, how
// weary), allies, truces, at peace (and how tense the border is), the lands across the sea — and its news ("Notícias do
// reino"); the Exército tab — this place's army (soldiers / most, level, recruits, the watch, its state: at home, besieged,
// its contingents away), the kingdom's campaigns (where each army marches, how far, when it arrives, sieges with their
// engines and the walls), the enemy armies coming, and "Entrar no exército" (soon: phase 3c). Information only.
import { WAR, capOf, ENG_PT, wallKind } from '../game/content/war.js';
import { WAR_ICONS } from './warHud.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sw = (c) => `<i class="mu-sw" style="background:rgb(${c.join(',')})"></i>`;
const DIRS = ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'];
const dirPt = (dx, dy) => DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
const hoursPt = (h) => (h < 1 ? 'menos de 1 h' : h < 24 ? `${Math.round(h)} h` : `${Math.floor(h / 24)} ${Math.floor(h / 24) === 1 ? 'dia' : 'dias'}${Math.round(h % 24) ? ` e ${Math.round(h % 24)} h` : ''}`);
const engPt = (e) => [['treb', 0], ['cat', 1], ['ram', 2], ['tower', 3]].filter(([, i]) => e[i] > 0).map(([k, i]) => `${e[i]} ${ENG_PT[k][e[i] > 1 ? 1 : 0]}`).join(', ');

let styled = false;
function style() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
.p-mural .wr-rels { display: flex; flex-direction: column; gap: 5px; }
.p-mural .wr-rel { display: grid; grid-template-columns: 30px 1fr auto; gap: 8px; align-items: center; padding: 6px 9px; border-radius: 9px; background: rgba(255,248,232,0.08); border: 1px solid rgba(246,234,208,0.16); }
.p-mural .wr-rel .ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; }
.p-mural .wr-rel .ic svg { width: 18px; height: 18px; }
.p-mural .wr-rel.war { background: rgba(232,70,58,0.16); border-color: rgba(232,70,58,0.55); }
.p-mural .wr-rel.war .ic { background: #b8322a; color: #fff1e8; }
.p-mural .wr-rel.ally .ic { background: #3f8a4a; color: #eaffe6; }
.p-mural .wr-rel.ally { border-color: rgba(127,220,106,0.45); }
.p-mural .wr-rel.truce .ic { background: #4e7aa8; color: #eaf4ff; }
.p-mural .wr-rel.neutral .ic { background: rgba(246,234,208,0.18); color: #f6ead0; }
.p-mural .wr-rel.far { opacity: 0.6; }
.p-mural .wr-rel .nm { font-weight: 700; }
.p-mural .wr-rel .st { font-size: 12.5px; color: rgba(246,234,208,0.78); }
.p-mural .wr-rel .tag { font: 700 11px/1 system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.5px; padding: 5px 8px; border-radius: 999px; background: rgba(246,234,208,0.15); white-space: nowrap; }
.p-mural .wr-rel.war .tag { background: #e8463a; color: #fff; }
.p-mural .wr-rel.ally .tag { background: #5fae5a; color: #10240c; }
.p-mural .wr-rel.truce .tag { background: #7fa8d6; color: #0e1c2c; }
.p-mural .wr-bar { height: 6px; border-radius: 4px; background: rgba(0,0,0,0.35); overflow: hidden; margin-top: 3px; width: 120px; display: inline-block; vertical-align: middle; }
.p-mural .wr-bar i { display: block; height: 100%; background: linear-gradient(90deg, #f0c24a, #e8463a); }
.p-mural .wr-news { display: flex; flex-direction: column; gap: 3px; font-size: 13.5px; }
.p-mural .wr-news div { padding: 3px 0; border-bottom: 1px solid rgba(246,234,208,0.12); }
.p-mural .wr-news small { color: rgba(246,234,208,0.6); margin-right: 6px; }
.p-mural .wr-army { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
.p-mural .wr-alert { margin: 8px 0; padding: 9px 11px; border-radius: 10px; background: rgba(232,70,58,0.18); border: 1px solid rgba(232,70,58,0.6); }
.p-mural .wr-alert b { color: #ffd0c4; }
.p-mural .wr-camp { display: grid; grid-template-columns: 26px 1fr; gap: 8px; align-items: start; padding: 7px 9px; border-radius: 9px; background: rgba(255,248,232,0.07); margin-bottom: 5px; border: 1px solid rgba(246,234,208,0.14); }
.p-mural .wr-camp .ic { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; color: #fff6e0; }
.p-mural .wr-camp .ic svg { width: 16px; height: 16px; }
.p-mural .wr-camp .t { font-weight: 700; }
.p-mural .wr-camp .d { font-size: 12.5px; color: rgba(246,234,208,0.8); }
.p-mural .wr-camp.enemy { border-color: rgba(232,70,58,0.5); background: rgba(232,70,58,0.1); }
@media (max-width: 700px) { .p-mural .wr-army { grid-template-columns: repeat(2, 1fr); } .p-mural .wr-bar { width: 80px; } }
`;
  document.head.appendChild(s);
}

const relIcon = { war: WAR_ICONS.swords, ally: WAR_ICONS.hands, truce: WAR_ICONS.dove, neutral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/></svg>' };
const tensPt = (t) => (t == null ? '' : t >= WAR.declareAt ? 'fronteira tensa' : t >= 30 ? 'alguma tensão' : 'fronteira calma');

// ---------- Reino: the relations and the news of the kingdom K ----------
export function realmRelations(panels, I) {
  style();
  const g = panels.g, R = g.realms, realm = g.towns?.realm, K = I.kingdom;
  if (!R?.relInfo || !realm) return '';
  const day = g.env.dayIndex | 0;
  const others = realm.kingdoms.filter((Q) => Q.id !== K.id && !R.fallen.has(Q.id));
  const rows = [];
  for (const Q of others) {
    const ri = R.relInfo(K.id, Q.id), nb = K.neighbours.includes(Q.id);
    if (!ri.reach) continue;
    if (ri.r === 'neutral' && !nb && !ri.past && ri.tension == null) continue; // (far away and never met: not listed)
    let cls = ri.r, tag, st;
    if (ri.r === 'war') { tag = 'Em guerra'; st = `${ri.by === K.id ? 'Declarada por nós' : 'Declarou guerra a nós'} no dia ${ri.since} · cansaço da guerra <span class="wr-bar"><i style="width:${Math.min(100, ri.wa)}%"></i></span> ${ri.wa}%`; }
    else if (ri.r === 'ally') { tag = 'Aliado'; st = `Aliança desde o dia ${ri.since}: se um for atacado, o outro entra na guerra`; }
    else if (ri.r === 'truce') { tag = 'Trégua'; st = `Paz assinada no dia ${ri.since} · trégua até o dia ${ri.until} (${Math.max(0, ri.until - day)} ${ri.until - day === 1 ? 'dia' : 'dias'})`; }
    else { cls = 'neutral'; tag = 'Em paz'; st = `${nb ? 'Vizinho' : 'Rival distante (sem fronteira)'}${ri.tension != null ? ` · ${tensPt(ri.tension)}` : ''}${ri.past ? ` · ${ri.past} ${ri.past === 1 ? 'guerra' : 'guerras'} no passado` : ''}`; }
    rows.push([{ war: 0, ally: 1, truce: 2, neutral: 3 }[cls], `<div class="wr-rel ${cls}"><span class="ic">${relIcon[cls]}</span><span><span class="nm">${sw(Q.color)}Reino de ${esc(Q.name)}</span><br><span class="st">${st}</span></span><span class="tag">${tag}</span></div>`]);
  }
  const far = realm.kingdoms.filter((Q) => Q.id !== K.id && !R.fallen.has(Q.id) && !R.relInfo(K.id, Q.id).reach).length;
  rows.sort((a, b) => a[0] - b[0]);
  const grace = R.inGrace?.(K.id) && K.id === R.k0 ? `<p class="mu-note">O reino do início do mundo fica fora das guerras nos primeiros ${WAR.graceDays} dias (até o dia ${R.day0 + WAR.graceDays}).</p>` : '';
  const news = R.newsFor(K.id, 8).map((r) => `<div><small>Dia ${r[1]}, ${Math.floor(r[2] / 10)}h</small>${esc(R.newsText(r))}</div>`).join('');
  return `<h4>Relações do Reino de ${esc(K.name)}</h4>${grace}<div class="wr-rels">${rows.map((r) => r[1]).join('') || '<span class="muted">Nenhum reino vizinho por terra.</span>'}</div>
    ${far ? `<p class="mu-note">${far} ${far === 1 ? 'reino' : 'reinos'} em outras terras: sem navios, nenhuma relação (nem guerra, nem comércio).</p>` : ''}
    <h4>Notícias do reino</h4><div class="wr-news">${news || '<div class="muted">Nada de novo: o reino está em paz.</div>'}</div>`;
}

// ---------- Exército ----------
export function armyTab(panels, I) {
  style();
  const g = panels.g, R = g.realms, realm = g.towns?.realm, K = I.kingdom, s = realm?.settlements[I.id];
  if (!R?.armies || !s) return '<p class="muted">Sem notícias do exército.</p>';
  const home = R.armies.get('g' + I.id), cap = capOf(s), w = g.world, hr = (g.env?.dayLength || 780) / 24;
  const war = [...R.rels].some(([key, r]) => r.r === 'war' && key.split('.').map(Number).includes(K.id));
  const recruit = Math.ceil(cap * WAR.recruit * (war ? WAR.recruitWar : 1));
  const ppl = g.towns.people?.(I.id), watch = ppl ? ppl.guards + ppl.archers : null;
  const siege = R.siegeOf(I.id);
  const stat = (n, label) => `<div class="mu-st"><b>${n}</b><span>${label}</span></div>`;
  let state = 'Em casa';
  if (siege) state = 'Sitiada';
  else if ([...R.armies.values()].some((a) => a.home === I.id && a.state !== 'home')) state = 'Em campanha';
  let body = `<p class="mu-lead">O exército de <b>${esc(I.name)}</b> (${s.kind === 'castle' ? 'a guarnição do castelo' : s.kind === 'city' ? 'a guarnição da capital' : 'a milícia da vila'}), do Reino de ${esc(K.name)}${sw(K.color)}.</p>
    <div class="wr-army">${stat(home?.n ?? 0, `Soldados · máx. ${cap}`)}${stat(home?.lv ?? 1, 'Nível')}${stat(watch ?? '—', 'Guarda da cidade')}${stat(`+${recruit}`, 'Recrutas por dia')}${stat(state, 'Estado')}${stat(I.walls === 'stone' ? 'Pedra' : I.walls === 'palisade' ? 'Paliçada' : 'Nenhuma', 'Muralha')}${stat(war ? 'Sim' : 'Não', 'Reino em guerra')}${stat(R.strength(K.id) ? Math.round(R.strength(K.id)) : 0, 'Força do reino')}</div>`;
  if (siege) {
    const D = R.defense(I.id);
    const broken = [...(g.towns.state || [])].filter(([id, r]) => id.startsWith(`t${I.id}.`) && (r.gone || r.dmg > 0)).length;
    body += `<div class="wr-alert"><b>Cerco!</b> O Reino de ${esc(realm.kingdoms[siege.k].name)} acampou a ${dirPt(w.dx(siege.x, s.x), siege.y - s.y)} com <b>${siege.n} soldados</b>${engPt(siege.eng) ? ` e ${engPt(siege.eng)}` : ''}. Defensores: <b>${D.n}</b>. Há ${hoursPt(siege.hrs)} de cerco${broken ? ` · ${broken} ${broken === 1 ? 'peça da muralha danificada' : 'peças da muralha danificadas'}` : ''}. ${siege.phase === 'assault' ? 'O inimigo está atacando as muralhas!' : siege.phase === 'camp' ? 'Ainda montam o acampamento.' : siege.phase === 'build' ? 'Constroem máquinas de cerco.' : 'Bombardeiam as muralhas.'} Os portões ficam fechados e o povo em casa.</div>`;
  }
  // the kingdom's campaigns and the enemies coming
  const mine = [], foes = [];
  for (const a of R.armies.values()) {
    if (a.state === 'home') continue;
    if (a.k === K.id) mine.push(a);
    else if (a.target >= 0 && R.owner(a.target) === K.id) foes.push(a);
  }
  const camp = (a, enemy) => {
    const from = realm.settlements[a.home], T = a.target >= 0 ? realm.settlements[a.target] : null, AK = realm.kingdoms[a.k];
    let what;
    if (a.state === 'march' || a.state === 'retreat') {
      const eta = R.etaOf(a);
      what = a.state === 'retreat' || a.mission === 'return' ? `voltando para ${esc(from.name)}${eta ? ` · ${Math.round(eta.left)} passos, ≈ ${hoursPt(eta.s / hr)}` : ''}` : `${a.mission === 'relief' ? 'socorrendo' : 'marchando sobre'} ${esc(T?.name || '')}${eta ? ` · faltam ${Math.round(eta.left)} passos, chega em ≈ ${hoursPt(eta.s / hr)}` : ''}`;
    } else if (a.state === 'siege') what = `cercando ${esc(T?.name || '')} há ${hoursPt(a.hrs)}${engPt(a.eng) ? ` · ${engPt(a.eng)}` : ' · montando o acampamento'}`;
    else if (a.state === 'battle') { const f = R.armies.get(a.foe); what = `em batalha${f ? ` com o Reino de ${esc(realm.kingdoms[f.k]?.name || '')} (${f.n} soldados)` : ''}`; }
    else if (a.phase === 'muster') { const n = [...R.armies.values()].filter((q) => q.grp === a.id && q.mission === 'join' && q.state === 'march').reduce((s, q) => s + q.n, 0); what = `reunindo os soldados em ${esc(from.name)} para marchar sobre ${esc(T?.name || '')}${n ? ` · faltam chegar ${n}` : ''}`; }
    else what = 'acampado';
    const icon = a.state === 'battle' ? WAR_ICONS.swords : a.state === 'siege' ? WAR_ICONS.castle : WAR_ICONS.flag;
    return `<div class="wr-camp${enemy ? ' enemy' : ''}"><span class="ic" style="background:rgb(${AK.color.join(',')})">${icon}</span><span><span class="t">${enemy ? `Reino de ${esc(AK.name)}` : `Exército de ${esc(from.name)}`} · ${a.n} soldados · nível ${a.lv}</span><br><span class="d">${what}</span></span></div>`;
  };
  body += `<h4>Campanhas do Reino de ${esc(K.name)}</h4>${mine.length ? mine.map((a) => camp(a, false)).join('') : `<p class="mu-note">${war ? 'Nenhum exército em campanha agora: os soldados guardam as muralhas e se juntam para a próxima.' : 'O reino está em paz: os soldados ficam em casa.'}</p>`}`;
  if (foes.length) body += `<h4>Inimigos a caminho</h4>${foes.map((a) => camp(a, true)).join('')}`;
  body += `<p class="mu-note">Cada vila, castelo e cidade tem o seu exército: recruta com o tempo (mais nos castelos), sobe de nível com o mundo e se junta aos outros do reino nas campanhas. ${wallKind(s) === 'none' ? 'Sem muralha, a vila se defende na borda.' : 'Atrás da muralha, cada defensor vale por vários atacantes.'}</p>`;
  body += `<div class="mu-soon"><div class="tag">Em breve</div><h4>Entrar no exército</h4><p>Com reputação no reino você poderá se alistar aqui, receber as ordens do general na tela, seguir os pontos de encontro no mapa e defender — ou tomar — castelos e cidades.</p></div>`;
  return body;
}
