// The player in the army (docs/REINOS.md §15 "Fase 3c — o jogador no exército"): a member of a kingdom with enough
// reputation enlists at a mural (Exército tab) in the army of that place — the village militia, the castle's garrison, the
// city's army. Then the general's ORDERS come on the screen (ui/armyHud.js: a card like the job tracker, a waypoint on the
// ground, the map and the radar), derived on every peer from the replicated state of the war: 3a's army it follows
// (game.realms: gathering, marching, besieging, a battle, going home) and 3b's force when it is played near the players
// (game.warfare: the camp, the engines, the bombardment, the ram, the tower, the breach, the plaza; a battle's lines).
//
// game.army (every peer; the records are replicated — game/mut/army.js):
//   en (Map uid → record) · des (deserters) · rec(uid) · mine() · uidOf(pid) · kOf(entity) (the kingdom of an ENLISTED player)
//   joinReason(uid, sid, ent) · reqs(uid, sid) · inAction(rec) · order(uid) (the general's order now) · wage(rec)
//   npcWhy(src, dst)  null = the player may hurt this townsman (a GUARD of a place of a kingdom at war with its army's) —
//                     else why not (civilians: never)
//   pvpWhy(aPid, bPid) null = these two players may fight (members of kingdoms at war) — else why not
//   townFoe(S, pl) / soldierFoe(k, pl)   an enlisted enemy player: the guards / the soldiers fight it in their land
//   escorted(army)    an enlisted follower of that 3a army is with it (game/realms.js keeps its march running while live)
//   onKill(pid, m) / onOutcome(kind, F) (host: service, bonuses) · dbg (tests)
// Host (armySystem, sync 'host', every 0.5 s): who follows which army, membership (a member who leaves the kingdom is out
// of its army — a deserter if the army is in action), a home place taken (to the kingdom's nearest place), the daily pay
// at the economy's dawn, the service points (a day served, enemies felled), the bonuses of a battle won / a place taken /
// a siege repelled near the player.

import { ARMY, rankOfSvc, KIND_ARMY_PT } from './content/army.js';
import { RANKS, rankOf } from './content/eco.js';
import { armyState } from './mut/army.js';
import { meUid, recOf, memberOf, repOf, atMural, onlineUids, entOfPid, settlement, kingdomOf, fmt, dirPt } from './eco.js';
import { siegeIndex, ownerOf } from './mut/realms.js';
import { structsOfType } from './mut/structures.js';
import { WAR as WAR3A } from './content/war.js';

const realmOf = (game) => game.towns?.realm || null;
const atWar = (game, a, b) => a >= 0 && b >= 0 && a !== b && !!game.realms?.atWar?.(a, b);
const Kn = (game, k) => kingdomOf(game, k)?.name || '?';
const dayOf = (game) => (game.eco?.day >= 0 ? game.eco.day : game.env?.dayIndex | 0);
const hyp = (game, ax, ay, bx, by) => Math.hypot(game.world.dx ? game.world.dx(ax, bx) : ax - bx, ay - by);
const armyWord = (s) => (s?.kind === 'village' ? 'milícia' : s?.kind === 'castle' ? 'guarnição' : 'exército');
const armyOfPt = (s) => (s?.kind === 'village' ? 'a milícia' : s?.kind === 'castle' ? 'a guarnição' : 'o exército');

// ---------- who is who ----------
// the uid of a session pid on THIS peer: mine; the host's map (eco.hello); else the replicated pid → uid (eco.who: E.pu)
export function uidFor(game, pid) {
  if (pid == null) return null;
  if (pid === game.net.pid) return meUid(game);
  return game.eco?.who?.get(pid) || game.eco?.pu?.get(pid) || null;
}
const pidOfEnt = (game, e) => (!e ? null : e === game.player ? game.net.pid : e.pid || e.owner?.pid || (e.owner === game.player ? game.net.pid : null));
export const recFor = (game, uid) => (uid ? game.army?.en?.get(uid) || null : null);
// the kingdom of an ENLISTED player (an avatar, the local player, a remote copy, an arrow's owner) or −1
export function kOfEnt(game, e) {
  const r = recFor(game, uidFor(game, pidOfEnt(game, e)));
  return r ? r.k : -1;
}

// ---------- enlisting ----------
export function newRecord(game, u, sid) {
  const d = dayOf(game);
  return { sid, k: ownerOf(game, sid), rank: 0, svc: 0, since: d, paid: d, kills: 0, a: '', kd: -1, kn: 0 };
}
// why `uid` may not enlist in the army of place sid (null = it may); ent: the actor's body (at the mural)
export function joinReason(game, u, sid, ent = null) {
  const s = settlement(game, sid);
  if (!s || !game.realms?.armies) return 'Lugar desconhecido';
  if (ent && !atMural(game, sid, ent)) return `Vá até o mural de ${s.name}`;
  const k = ownerOf(game, sid), K = Kn(game, k), A = armyState(game), cur = A.en.get(u);
  if (cur) return cur.sid === sid ? `Você já serve ${armyOfPt(s) === 'o exército' ? 'no exército' : armyOfPt(s) === 'a milícia' ? 'na milícia' : 'na guarnição'} de ${s.name}` : `Você serve ${armyWord(settlement(game, cur.sid)) === 'milícia' ? 'na milícia' : 'no exército'} de ${settlement(game, cur.sid)?.name || ''}: dê baixa lá antes`;
  if (!game.realms.alive?.(k)) return `O Reino de ${K} não existe mais`;
  const ban = A.des.get(u);
  if (ban && ban[0] === k && dayOf(game) < ban[1]) return `Desertor: o Reino de ${K} não aceita você de volta até o dia ${ban[1]}`;
  if (memberOf(game, u) !== k) return `Entre no Reino de ${K} primeiro (aba Reino)`;
  const need = ARMY.join[s.kind] ?? 1, rep = repOf(game, u, k);
  if (rankOf(rep) < need) return `Reputação ${RANKS[need].name} no Reino de ${K}: faltam ${RANKS[need].min - rep}`;
  return null;
}
// the requirements, for the mural: [{ ok, text }]
export function joinReqs(game, u, sid) {
  const s = settlement(game, sid), k = ownerOf(game, sid), K = Kn(game, k), A = armyState(game), cur = A.en.get(u), ban = A.des.get(u);
  const need = ARMY.join[s.kind] ?? 1, rep = repOf(game, u, k);
  const out = [
    { ok: memberOf(game, u) === k, text: `Membro do Reino de ${K}`, hint: 'aba Reino · Entrar no reino' },
    { ok: rankOf(rep) >= need, text: `Reputação ${RANKS[need].name} no Reino de ${K}`, hint: rankOf(rep) >= need ? `você: ${rep}` : `você: ${rep} · faltam ${RANKS[need].min - rep}` },
    { ok: !cur || cur.sid === sid, text: 'Não servir em outro exército', hint: cur && cur.sid !== sid ? `você serve em ${settlement(game, cur.sid)?.name || ''}` : '' },
  ];
  if (ban && ban[0] === k && dayOf(game) < ban[1]) out.push({ ok: false, text: 'Não ser desertor', hint: `até o dia ${ban[1]}` });
  return out;
}
export const desertToast = (game, r, until) => `Você desertou ${armyWord(settlement(game, r.sid)) === 'milícia' ? 'da milícia' : 'do exército'} de ${settlement(game, r.sid)?.name || ''} em combate: ${ARMY.desert.rep} de reputação no Reino de ${Kn(game, r.k)}, e ele não aceita você de volta até o dia ${until}`;

// ---------- the war around a record ----------
// a live siege force (3b) on place sid by another kingdom than k (every peer: the public rows)
function liveSiegeOn(game, sid, k) {
  for (const F of game.warfare?.forces?.values() || []) if (F.kind === 'siege' && F.sid === sid && F.k !== k && F.phase && F.phase !== 'end') return F;
  return null;
}
function homeSiege(game, r) {
  const F = liveSiegeOn(game, r.sid, r.k);
  if (F) return { F, A: null };
  const A = siegeIndex(game).get(r.sid);
  return A && A.k !== r.k ? { F: null, A } : null;
}
// the army is fighting now (a battle, a siege of its own or of its home): leaving now is desertion
export function inAction(game, r) {
  if (!r || !game.realms?.armies) return false;
  const h = homeSiege(game, r);
  if (h && (!h.F || h.F.phase !== 'retreat')) return true;
  const a = r.a ? game.realms.armies.get(r.a) : null;
  return !!a && (a.state === 'battle' || a.state === 'siege');
}
export const wageOf = (game, r) => Math.round(ARMY.ranks[r.rank].pay * (warOf(game, r.k) ? ARMY.warPay : 1));
const warOf = (game, k) => { for (const [key, q] of game.realms?.rels || []) if (q.r === 'war' && key.split('.').map(Number).includes(k)) return true; return false; };

// ---------- who may hurt whom (every peer: the same rule on the guest that routes a hit and on the host that applies it) ----------
// a townsman: a GUARD of a place of a kingdom at war with the attacker's army — never a civilian, never one's own side
export function npcWhy(game, src, dst) {
  const P = dst?.npc, S = dst?.npcS;
  if (!P || !S) return 'protegido';
  if (!P.guard) return 'civil';
  const k = kOfEnt(game, src);
  if (k < 0) return 'não alistado';
  return atWar(game, k, ownerOf(game, S.sid)) ? null : 'não está em guerra';
}
// two players: members of kingdoms at war (host-authoritative: the host checks it again with its own uid map)
export function pvpWhy(game, aPid, bPid, name = 'Este jogador') {
  if (!aPid || !bPid || aPid === bPid) return 'Não';
  const ka = memberOf(game, uidFor(game, aPid)), kb = memberOf(game, uidFor(game, bPid));
  if (ka < 0) return `${name} não é seu inimigo: jogadores só lutam entre si quando são membros de reinos em guerra (você é viajante)`;
  if (kb < 0) return `${name} é viajante: jogadores só lutam entre si quando são membros de reinos em guerra`;
  if (ka === kb) return `${name} é do seu reino (${Kn(game, ka)})`;
  if (!atWar(game, ka, kb)) return `${name} é do Reino de ${Kn(game, kb)}, que não está em guerra com o seu`;
  return null;
}
// an enlisted player of a kingdom at war with place S's: the guards fight it in their land (and the gates shut)
export const townFoe = (game, S, pl) => !!pl && !pl.dead && atWar(game, kOfEnt(game, pl), ownerOf(game, S.sid));
// an enlisted player of a kingdom at war with k: k's soldiers fight it
export const soldierFoe = (game, k, pl) => !!pl && !pl.dead && atWar(game, kOfEnt(game, pl), k);

// ---------- the army a record follows (host) ----------
function follow(game, r, H) {
  const R = game.realms;
  if (homeSiege(game, r)) return null; // (its home besieged: the defense — no army in the field)
  let a = r.a ? R.armies.get(r.a) : null;
  if (!a && r.a) { let g = H.grp.get(r.a); for (let n = 0; n < 4 && g && !R.armies.get(g); n++) g = H.grp.get(g); a = g ? R.armies.get(g) : null; } // (a contingent merged into its campaign)
  if (a && (a.k !== r.k || a.state === 'home')) a = null;
  if (a) return a;
  // an army of its own place (a campaign that left from there, its contingent)
  let best = null, bs = 1e9;
  for (const q of R.armies.values()) {
    if (q.k !== r.k || q.state === 'home') continue;
    const s = q.home === r.sid ? (q.mission === 'return' ? 2 : 0) : 1e3;
    if (s < bs) { bs = s; best = q; }
  }
  if (best && bs < 1e3) return best;
  // the kingdom's campaign nearest its home (not one going home)
  const h = settlement(game, r.sid);
  best = null; bs = 1e9;
  for (const q of R.armies.values()) {
    if (q.k !== r.k || q.state === 'home' || q.mission === 'return' || q.mission === 'join') continue;
    R.posOf(q);
    const d = hyp(game, q.x, q.y, h.x, h.y);
    if (d < bs) { bs = d; best = q; }
  }
  return best;
}
// an online enlisted follower of army a is with it (game/realms.js: its march keeps running while it is live)
export function escorted(game, a) {
  const A = game.army;
  if (!A?.en?.size || !a) return false;
  let on = null;
  for (const [u, r] of A.en) {
    if (r.a !== a.id) continue;
    on = on || onlineUids(game);
    const pid = on.get(u), e = pid != null ? entOfPid(game, pid) : null;
    if (e && !e.dead && hyp(game, e.x, e.y, a.x, a.y) < WAR3A.live) return true;
  }
  return false;
}

// ---------- the orders (every peer) ----------
// { key (what changes the order: phase + target), code, title, sub, wp { x, y, label } | null, tone, k (whose force) }
const near = (game, o, s, R) => hyp(game, o.tx + (o.fw || 1) / 2, o.ty + (o.fh || 1) / 2, s.x, s.y) < s.r + R;
function armyThings(game, k, s, type) {
  const out = [];
  for (const o of structsOfType(game, type)) if (!o.removed && o.realm === k && near(game, o, s, 110)) out.push(o);
  return out;
}
const mid = (o) => ({ x: o.tx + (o.fw || 1) / 2, y: o.ty + (o.fh || 1) / 2 });
function campOf(game, k, s, F) {
  const T = armyThings(game, k, s, 'war_tent');
  if (T.length) { let x = 0, y = 0; for (const o of T) { const m = mid(o); x += m.x; y += m.y; } return { x: x / T.length, y: y / T.length }; }
  return F ? { x: F.x, y: F.y } : null;
}
const nearestTo = (game, list, x, y) => { let b = null, bd = 1e9; for (const o of list) { const m = mid(o), d = hyp(game, m.x, m.y, x, y); if (d < bd) { bd = d; b = o; } } return b; };
const wp = (x, y, label) => (Number.isFinite(x) && Number.isFinite(y) ? { x, y, label } : null);
function etaPt(game, a) {
  const e = game.realms.etaOf?.(a);
  if (!e) return '';
  const h = e.s / ((game.env?.dayLength || 780) / 24);
  return ` · faltam ${Math.round(e.left)} passos, ≈ ${h < 1 ? 'menos de 1 h' : Math.round(h) + ' h'}`;
}
export function orderFor(game, r, me) {
  const R = game.realms, realm = realmOf(game);
  if (!r || !R?.armies || !realm) return null;
  const home = realm.settlements[r.sid], w = game.world, K = Kn(game, r.k);
  const dMe = (x, y) => (me ? hyp(game, me.x, me.y, x, y) : 0);
  // ---- the home besieged: the defense ----
  const h = homeSiege(game, r);
  if (h) {
    const ek = h.F ? h.F.k : h.A.k, EK = Kn(game, ek), per = game.townDefense?.perimeter?.(home.id), ops = game.townDefense?.openings?.(home.id) || [];
    const fx = h.F ? h.F.x : h.A.x, fy = h.F ? h.F.y : h.A.y, side = dirPt(w.dx(fx, home.x), fy - home.y);
    // the wall / gate on the threatened side
    let wall = null;
    if (per) { let bd = 1e9; for (const p of per.pieces.values()) { const d = hyp(game, p.cx, p.cy, fx, fy); if (d < bd) { bd = d; wall = p; } } }
    const wallWp = wall ? wp(wall.cx, wall.cy, 'Muralha') : wp(home.x, home.y, home.name);
    const base = { k: ek, tone: 'defend' };
    if (dMe(home.x, home.y) > home.r + ARMY.far) return { ...base, key: `def|${home.id}|far`, code: 'defend', title: `Volte para defender ${home.name}!`, sub: `O Reino de ${EK} cerca ${home.name} (${h.F ? h.F.n : h.A.n} soldados a ${side})`, wp: wp(home.x, home.y, home.name) };
    if (!h.F) return { ...base, key: `def|${home.id}|num`, code: 'defend', title: `Defenda ${home.name}!`, sub: `O Reino de ${EK} acampou a ${side} com ${h.A.n} soldados · às muralhas`, wp: wallWp };
    const ph = h.F.phase, op = ops.slice().sort((a, b) => hyp(game, a.x, a.y, fx, fy) - hyp(game, b.x, b.y, fx, fy))[0];
    if (ph === 'retreat') return { ...base, tone: 'good', key: `def|${home.id}|won`, code: 'repelled', title: `${home.name} resistiu!`, sub: `O exército do Reino de ${EK} recua · deixe-os ir`, wp: null };
    if (op) return { ...base, key: `def|${home.id}|gap|${op.id}`, code: 'gap', title: op.gate ? 'Segure o portão quebrado!' : 'Segure a brecha!', sub: `O inimigo vai entrar por ali · ${h.F.n} atacantes`, wp: wp(op.x, op.y, op.gate ? 'Portão' : 'Brecha') };
    if (ph === 'assault') {
      const tw = armyThings(game, ek, home, 'siege_tower').find((o) => o.ramp);
      if (tw) return { ...base, key: `def|${home.id}|tower`, code: 'tower', title: 'Defenda a muralha: a torre encostou!', sub: 'Os soldados descem pela rampa no adarve', wp: wp(mid(tw).x, mid(tw).y, 'Torre') };
      const ram = nearestTo(game, armyThings(game, ek, home, 'battering_ram'), fx, fy);
      if (ram) return { ...base, key: `def|${home.id}|ram`, code: 'ram', title: 'Defenda o portão: o aríete vem aí!', sub: 'Derrube a equipe que empurra', wp: wp(mid(ram).x, mid(ram).y, 'Aríete') };
      return { ...base, key: `def|${home.id}|assault`, code: 'assault', title: `Defenda ${home.name}: o assalto começou!`, sub: `${h.F.n} atacantes a ${side}`, wp: wallWp };
    }
    if (ph === 'bombard') return { ...base, key: `def|${home.id}|bombard`, code: 'bombard', title: 'Segure as muralhas!', sub: `Os trabucos do Reino de ${EK} atiram de ${side}`, wp: wallWp };
    return { ...base, key: `def|${home.id}|camp`, code: 'walls', title: `Às muralhas de ${home.name}!`, sub: `O Reino de ${EK} acampa a ${side} (${h.F.n} soldados) · prepare a defesa`, wp: wallWp };
  }
  // ---- the army it follows ----
  const a = r.a ? R.armies.get(r.a) : null;
  if (!a || a.k !== r.k || a.state === 'home') {
    const war = warOf(game, r.k);
    return war
      ? { key: `idle|war|${home.id}`, code: 'guard', tone: 'idle', title: `Guarde ${home.name}`, sub: `O Reino de ${K} está em guerra: aguarde a próxima campanha`, wp: null }
      : { key: `idle|peace|${home.id}`, code: 'idle', tone: 'idle', title: `Em paz: ${armyOfPt(home)} de ${home.name} treina`, sub: `Soldo de ${wageOf(game, r)} moedas por dia · as ordens chegam com a guerra`, wp: null };
  }
  R.posOf(a);
  const T = a.target >= 0 ? realm.settlements[a.target] : null, M = realm.settlements[a.home], dA = dMe(a.x, a.y), far = dA > ARMY.far, withIt = dA <= ARMY.withArmy;
  const armyWp = wp(a.x, a.y, 'Exército');
  const F = game.warfare?.forces?.get(a.id) || null, live = F && F.kind && F.kind !== 'pending' && F.phase !== 'end' ? F : null;
  if (a.state === 'camp' && a.phase === 'muster') {
    const left = [...R.armies.values()].filter((q) => q.grp === a.id && q.mission === 'join' && q.state === 'march').reduce((s2, q) => s2 + q.n, 0);
    return withIt ? { key: `muster|${a.id}`, code: 'muster', tone: 'march', title: `Aguarde a reunião em ${M.name}`, sub: `O exército parte para ${T?.name || ''}${left ? ` quando chegarem ${left} soldados` : ' em breve'}`, wp: armyWp }
      : { key: `muster|${a.id}`, code: 'muster', tone: 'march', title: `Junte-se ao exército em ${M.name}`, sub: `Reunião para marchar sobre ${T?.name || ''} · ${Math.round(dA)} passos`, wp: armyWp };
  }
  if (a.state === 'march' || a.state === 'retreat') {
    const far = !withIt; // (marching: not with the column — go to it first)
    if (a.state === 'retreat' || a.mission === 'return') return { key: `ret|${a.id}`, code: 'retreat', tone: 'retreat', title: far ? `Recuar! O exército volta para ${M.name}` : `Recuar! Volte com o exército para ${M.name}`, sub: far ? `${Math.round(dA)} passos até ele` : etaPt(game, a).slice(3), wp: far ? armyWp : wp(M.x, M.y, M.name) };
    if (a.mission === 'join') { const G0 = R.armies.get(a.grp), at = G0 ? realm.settlements[G0.home] : T; return { key: `join|${a.id}`, code: 'join', tone: 'march', title: far ? 'Alcance o contingente' : `Marche com o contingente até ${at?.name || ''}`, sub: far ? `${Math.round(dA)} passos · ele vai se juntar à campanha` : etaPt(game, a).slice(3), wp: far ? armyWp : at ? wp(at.x, at.y, at.name) : armyWp }; }
    return far ? { key: `march|${a.id}`, code: 'march', tone: 'march', title: 'Alcance o exército', sub: `${a.mission === 'relief' ? 'Ele vai socorrer' : 'Ele marcha sobre'} ${T?.name || ''} · ${Math.round(dA)} passos daqui`, wp: armyWp }
      : { key: `march|${a.id}`, code: 'march', tone: 'march', title: a.mission === 'relief' ? `Socorra ${T?.name || ''}: marche com o exército` : `Marche com o exército até ${T?.name || ''}`, sub: `${a.n} soldados do Reino de ${K}${etaPt(game, a)}`, wp: T ? wp(T.x, T.y, T.name) : armyWp };
  }
  if (a.state === 'battle') {
    const f = R.armies.get(a.foe), EK = Kn(game, f?.k ?? -1);
    if (live && live.kind === 'battle') {
      const O = live.foe ? game.warfare.forces.get(live.foe) : null, ph = live.phase;
      if (ph === 'rout') return { key: `bt|${a.id}|rout`, code: 'rout', tone: 'retreat', title: 'Recuar! A linha caiu', sub: 'Saia do campo de batalha', wp: M ? wp(M.x, M.y, M.name) : null };
      if (ph === 'won') return { key: `bt|${a.id}|won`, code: 'won', tone: 'good', title: 'Vitória! Persiga os que fogem', sub: `O exército do Reino de ${EK} debanda`, wp: O ? wp(O.x, O.y, 'Inimigo') : null };
      if (ph === 'clash') return { key: `bt|${a.id}|clash`, code: 'clash', tone: 'fight', title: 'Segure a linha! Ataque!', sub: `Contra o Reino de ${EK} · ${live.n} × ${O?.n ?? '?'}`, wp: O ? wp(O.x, O.y, 'Inimigo') : wp(live.x, live.y, 'Linha') };
      if (ph === 'advance') return { key: `bt|${a.id}|adv`, code: 'advance', tone: 'fight', title: 'Avance com a linha!', sub: `Os arqueiros atiram · contra o Reino de ${EK}`, wp: wp(live.x, live.y, 'Linha') };
      return { key: `bt|${a.id}|form`, code: 'form', tone: 'fight', title: 'Forme na linha!', sub: `Batalha contra o Reino de ${EK} (${live.n} × ${O?.n ?? '?'})`, wp: wp(live.x, live.y, 'Linha') };
    }
    return { key: `bt|${a.id}`, code: 'battle', tone: 'fight', title: far ? 'Junte-se à batalha!' : 'Lute ao lado do exército!', sub: `Contra o Reino de ${EK} · ${a.n} × ${f?.n ?? '?'}`, wp: armyWp };
  }
  if (a.state === 'siege' && T) {
    const per = game.townDefense?.perimeter?.(T.id);
    if (live && live.kind === 'siege') {
      const ph = live.phase, camp = campOf(game, a.k, T, live), campWp = camp ? wp(camp.x, camp.y, 'Acampamento') : wp(live.x, live.y, 'Exército');
      if (ph === 'march') return { key: `sg|${a.id}|march`, code: 'tocamp', tone: 'march', title: `Marche até o acampamento diante de ${T.name}`, sub: 'Fora do alcance dos arqueiros das muralhas', wp: wp(live.x, live.y, 'Exército') };
      if (ph === 'camp') return { key: `sg|${a.id}|camp`, code: 'camp', tone: 'march', title: `Monte o acampamento diante de ${T.name}`, sub: 'Os engenheiros erguem as tendas · fique fora do alcance das muralhas', wp: campWp };
      if (ph === 'build') { const ws = armyThings(game, a.k, T, 'siege_workshop')[0]; return { key: `sg|${a.id}|build`, code: 'build', tone: 'march', title: 'Proteja os engenheiros', sub: 'As máquinas de cerco estão sendo construídas', wp: ws ? wp(mid(ws).x, mid(ws).y, 'Oficina de cerco') : campWp }; }
      if (ph === 'held') { const L = game.towns.layout(T.id); return { key: `sg|${a.id}|held`, code: 'held', tone: 'good', title: `${T.name} é nossa! Segure a praça`, sub: 'A guarnição nova fica; o resto volta para casa', wp: L ? wp(L.plaza[0], L.plaza[1], 'Praça') : null }; }
      if (ph === 'retreat') return { key: `sg|${a.id}|ret`, code: 'retreat', tone: 'retreat', title: 'Recuar! Recuar!', sub: `${T.name} resistiu · para longe das muralhas`, wp: M ? wp(M.x, M.y, M.name) : null };
      if (ph === 'bombard') { const tr = nearestTo(game, armyThings(game, a.k, T, 'trebuchet'), me?.x ?? camp?.x, me?.y ?? camp?.y); return { key: `sg|${a.id}|bombard`, code: 'bombard', tone: 'fight', title: 'Proteja os trabucos!', sub: `O bombardeio de ${T.name} começou · opere um trabuco (E): a pedra é do exército`, wp: tr ? wp(mid(tr).x, mid(tr).y, 'Trabuco') : campWp }; }
      // the assault
      if (me && per?.inside?.(me.x, me.y, w)) { const L = game.towns.layout(T.id); return { key: `sg|${a.id}|plaza`, code: 'plaza', tone: 'fight', title: 'Tome a praça!', sub: `Segure o centro de ${T.name} sem defensores por perto`, wp: L ? wp(L.plaza[0], L.plaza[1], 'Praça') : null }; }
      const ops = (game.townDefense?.openings?.(T.id) || []).slice().sort((p, q) => hyp(game, p.x, p.y, camp?.x ?? T.x, camp?.y ?? T.y) - hyp(game, q.x, q.y, camp?.x ?? T.x, camp?.y ?? T.y));
      if (ops.length) { const op = ops[0]; return { key: `sg|${a.id}|in|${op.id}`, code: op.gate ? 'gatein' : 'breach', tone: 'fight', title: op.gate ? 'O portão caiu! Para dentro!' : 'Entre pela brecha!', sub: `Para a praça de ${T.name}`, wp: wp(op.x, op.y, op.gate ? 'Portão' : 'Brecha') }; }
      const tw = armyThings(game, a.k, T, 'siege_tower')[0];
      if (tw?.ramp) return { key: `sg|${a.id}|climb`, code: 'climb', tone: 'fight', title: 'Suba pela torre!', sub: 'A rampa desceu: a escada de trás leva ao adarve (E)', wp: wp(mid(tw).x, mid(tw).y, 'Torre') };
      const ram = armyThings(game, a.k, T, 'battering_ram')[0];
      if (ram) return { key: `sg|${a.id}|ram`, code: 'ram', tone: 'fight', title: 'Empurre o aríete até o portão!', sub: 'E pega · setas / WASD empurram · encostado no portão, ataque bate', wp: wp(mid(ram).x, mid(ram).y, 'Aríete') };
      if (tw) return { key: `sg|${a.id}|tower`, code: 'tower', tone: 'fight', title: 'Empurre a torre até a muralha!', sub: 'Encostada na muralha, a rampa desce sozinha', wp: wp(mid(tw).x, mid(tw).y, 'Torre') };
      return { key: `sg|${a.id}|assault`, code: 'assault', tone: 'fight', title: `Ao assalto de ${T.name}!`, sub: 'Procure uma entrada nas muralhas', wp: wp(T.x, T.y, T.name) };
    }
    return { key: `sg|${a.id}`, code: 'siege', tone: 'fight', title: far ? `Vá ao cerco de ${T.name}` : `O exército cerca ${T.name}`, sub: far ? `${Math.round(dA)} passos até o acampamento` : `Há ${Math.max(0, a.hrs | 0)} h de cerco · ${a.n} soldados`, wp: armyWp };
  }
  return { key: `camp|${a.id}`, code: 'camp', tone: 'march', title: far ? 'Alcance o exército' : 'Aguarde no acampamento', sub: `${a.n} soldados${far ? ` · ${Math.round(dA)} passos` : ''}`, wp: armyWp };
}

// ---------- install (every peer) ----------
export function installArmy(game) {
  const A = armyState(game);
  A.H = { grp: new Map(), kills: new Map(), killT: 0, done: new Set() }; // (host-only bookkeeping)
  Object.assign(A, {
    rec: (u) => recFor(game, u ?? meUid(game)),
    mine: () => recFor(game, meUid(game)),
    uidOf: (pid) => uidFor(game, pid),
    kOf: (e) => kOfEnt(game, e),
    joinReason: (u, sid, ent) => joinReason(game, u, sid, ent),
    reqs: (u, sid) => joinReqs(game, u, sid),
    inAction: (r) => inAction(game, r),
    wage: (r) => wageOf(game, r),
    order: (u = meUid(game), me = null) => orderFor(game, recFor(game, u), me || (u === meUid(game) ? game.player : null)),
    npcWhy: (src, dst) => npcWhy(game, src, dst),
    pvpWhy: (a, b, name) => pvpWhy(game, a, b, name),
    townFoe: (S, pl) => townFoe(game, S, pl),
    soldierFoe: (k, pl) => soldierFoe(game, k, pl),
    escorted: (a) => escorted(game, a),
    onKill: (pid, m) => onKill(game, pid, m),
    onOutcome: (kind, F) => onOutcome(game, kind, F),
    dbg: {
      // tests (host): a record set as is (rank / service / the day paid), an outcome as if near
      set: (u, patch) => { const r = A.en.get(u); if (r) game.net.emit('army.rec', { u, r: { ...r, ...patch }, ev: 'debug' }); },
      tick: () => hostTick(game),
      follow: (u) => follow(game, A.en.get(u), A.H)?.id || null,
    },
  });
  return A;
}

// ---------- host ----------
function onKill(game, pid, m) {
  const A = game.army, u = uidFor(game, pid), r = recFor(game, u);
  if (!r || !m) return;
  const foe = (m.soldier && atWar(game, r.k, m.soldier.k)) || (m.npc?.guard && m.npcS && atWar(game, r.k, ownerOf(game, m.npcS.sid)));
  if (!foe) return;
  const q = A.H.kills.get(u) || { n: 0, g: 0 };
  q.n++; if (m.soldier?.role === 'general') q.g++;
  A.H.kills.set(u, q);
}
const OUT_PT = {
  won: (game, F) => `Vitória sobre o Reino de ${Kn(game, game.warfare?.forces?.get(F.foe)?.k ?? -1)}!`,
  taken: (game, F) => `${settlement(game, F.sid)?.name || 'O lugar'} é nossa!`,
  repelled: (game, F) => `${settlement(game, F.sid)?.name || 'O lugar'} resistiu ao cerco!`,
};
// an outcome played near the players (game/warfare.js, game/siegeAI.js): the enlisted players of the winning side near it
// get the bonus (coins, reputation, service) once per force
function onOutcome(game, kind, F) {
  const A = game.army;
  if (!game.net.auth || !A?.en?.size || !F || !ARMY.bonus[kind]) return 0;
  const k = kind === 'repelled' ? ownerOf(game, F.sid) : F.k, s = F.sid != null ? settlement(game, F.sid) : null;
  const at = kind === 'won' || !s ? { x: F.x, y: F.y } : { x: s.x, y: s.y }, R = kind === 'won' ? ARMY.near : (s?.r || 20) + ARMY.near;
  const on = onlineUids(game), [coins, rep] = ARMY.bonus[kind];
  let n = 0;
  for (const [u, r] of A.en) {
    if (r.k !== k) continue;
    const key = `${F.id}|${kind}|${u}`;
    if (A.H.done.has(key)) continue;
    const pid = on.get(u), e = pid != null ? entOfPid(game, pid) : null;
    if (!e || hyp(game, e.x, e.y, at.x, at.y) > R) continue;
    A.H.done.add(key);
    const svc = r.svc + ARMY.svc[kind];
    game.net.emit('army.rec', { u, r: { ...r, svc, rank: Math.max(r.rank, rankOfSvc(svc)) }, ev: 'bonus', by: pid, give: { coin: coins }, toastKind: 'good',
      toast: `${OUT_PT[kind](game, F)} Bônus: +${coins} moedas e +${rep} de reputação no Reino de ${Kn(game, k)}` });
    game.realms?.reward?.(pid, k, rep, '');
    n++;
  }
  return n;
}
function nearestPlace(game, k, s0) {
  let best = null, bd = 1e9;
  for (const s of realmOf(game).settlements) { if (ownerOf(game, s.id) !== k) continue; const d = hyp(game, s.x, s.y, s0.x, s0.y); if (d < bd) { bd = d; best = s; } }
  return best;
}
function hostTick(game) {
  const A = game.army, H = A.H, R = game.realms, net = game.net;
  if (!A?.en || !R?.armies || !realmOf(game)) return;
  for (const a of R.armies.values()) if (a.state !== 'home' && a.grp && a.grp !== a.id) H.grp.set(a.id, a.grp);
  if (H.grp.size > 400) H.grp.clear();
  if (!A.en.size) return;
  const on = onlineUids(game), day = dayOf(game), now = game.worldTime;
  for (const [u, r0] of [...A.en]) {
    let r = r0;
    const pid = on.get(u), s = settlement(game, r.sid);
    // the kingdom gone / the player out of it
    if (!R.alive?.(r.k)) { net.emit('army.rec', { u, r: 0, ev: 'fall', by: pid, toastKind: 'warn', toast: `O Reino de ${Kn(game, r.k)} caiu: o exército dele se desfez` }); continue; }
    if (memberOf(game, u) !== r.k) {
      if (inAction(game, r)) { const until = day + ARMY.desert.banDays; net.emit('army.rec', { u, r: 0, ban: [r.k, until], ev: 'desert', by: pid, toastKind: 'warn', toast: desertToast(game, r, until) }); net.emit('eco.rep', { u, k: r.k, d: ARMY.desert.rep }); }
      else net.emit('army.rec', { u, r: 0, ev: 'member', by: pid, toastKind: 'info', toast: `Fora do Reino de ${Kn(game, r.k)}, você deu baixa ${armyWord(s) === 'milícia' ? 'da milícia' : 'do exército'} de ${s?.name || ''}` });
      continue;
    }
    // its home taken: to the kingdom's nearest place
    if (ownerOf(game, r.sid) !== r.k) {
      const q = nearestPlace(game, r.k, s);
      if (!q) { net.emit('army.rec', { u, r: 0, ev: 'fall', by: pid, toastKind: 'warn', toast: `O Reino de ${Kn(game, r.k)} perdeu ${s?.name || ''}: o seu exército se desfez` }); continue; }
      r = { ...r, sid: q.id, a: '' };
      net.emit('army.rec', { u, r, ev: 'move', by: pid, toastKind: 'warn', toast: `${s?.name || ''} foi tomada: você passa ${q.kind === 'village' ? 'à milícia' : q.kind === 'castle' ? 'à guarnição' : 'ao exército'} de ${q.name}` });
    }
    // the army it follows
    const a = follow(game, r, H), aid = a ? a.id : '';
    if (aid !== r.a) { r = { ...r, a: aid }; net.emit('army.rec', { u, r, ev: 'assign' }); }
    // enemies felled (service; at most ARMY.svc.killMax a day)
    const q = H.kills.get(u);
    if (q && now - H.killT > 2) {
      H.kills.delete(u);
      const kn = r.kd === day ? r.kn : 0, add = Math.min(q.n, Math.max(0, ARMY.svc.killMax - kn)) * ARMY.svc.kill + q.g * ARMY.svc.general, svc = r.svc + add;
      r = { ...r, kills: r.kills + q.n, kd: day, kn: kn + q.n, svc, rank: Math.max(r.rank, rankOfSvc(svc)) };
      net.emit('army.rec', { u, r, ev: 'svc', by: pid });
    }
    // the daily pay (at the economy's dawn; a player away that day is not paid)
    if (pid != null && game.eco?.day >= 0 && r.paid < day) {
      const war = warOf(game, r.k), rep = war ? ARMY.serveRep : 1, svc = r.svc + ARMY.svc.day;
      const rank = Math.max(r.rank, rankOfSvc(svc)), wage = Math.round(ARMY.ranks[rank].pay * (war ? ARMY.warPay : 1)); // (a day served: promoted at the dawn, paid as such)
      r = { ...r, paid: day, svc, rank };
      net.emit('army.rec', { u, r, ev: 'pay', by: pid, give: { coin: wage }, toastKind: 'good',
        toast: `${war ? 'Soldo de campanha' : 'Soldo do dia'}: +${fmt(wage)} moedas · +${rep} de reputação` });
      game.realms?.reward?.(pid, r.k, rep, '');
    }
  }
  if (now - H.killT > 2) H.killT = now;
}
export function armySystem() {
  let t = 0;
  return {
    sync: 'host', // who follows which army, membership, the pay, service, bonuses — replicated by op army.rec (mut/army.js)
    update(game, dt) {
      t -= dt;
      if (t > 0) return;
      t = 0.5;
      hostTick(game);
    },
  };
}
export { KIND_ARMY_PT, armyWord };
