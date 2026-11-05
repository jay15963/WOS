// Siege engines (game/siege.js, docs/REINOS.md "Implementação — máquinas de guerra"): every shared change.
// Intents: siege.use (artillery operator on / off) · siege.aim · siege.fire · siege.push (grab / let go a pushed engine)
//          · siege.drive (where a pusher pushes) · siege.ram (the ram's blow)
// Ops: siege.set (operator, aim, distance, pushers, the tower's ramp) · siege.shot (a stone thrown: every peer swings
//      the arm and flies it; the host's copy resolves the impact) · siege.step (a pushed engine moves a tile) ·
//      siege.swing (the ram strikes) · siege.dmg (siege damage of a structure: persistent cracks)
// Owner message: siege.msg (the host tells a crew why it does not move: blocked, wrong wall height…)

import { defineIntent, defineOp, defineOwn } from '../../net/registry.js';
import { BUILDINGS } from '../data.js';
import { ARTY, PUSH, PUSH_REACH, PUSH_SLOTS, flightOf, ramCooldown } from '../content/siege.js';
import {
  engineOf, isArtyObj, isPushObj, pivotOf, releaseOf, shotLanding, launchStone, playerByPid, footDist, frontTiles, isGate,
  siegeCanDamage, damageStructure, crewOf,
} from '../siege.js';
import { relocateStructure, structById, TOWN } from './structures.js';
import { hostProjId } from '../projectiles.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ang = (v) => { const a = num(v, NaN); return Number.isFinite(a) ? Math.atan2(Math.sin(a), Math.cos(a)) : null; };
const pidList = (L) => (Array.isArray(L) ? L.slice(0, PUSH_SLOTS).map((q) => (typeof q === 'string' && q ? q.slice(0, 40) : 0)) : []);
const LAST = new Map();  // host: engine id → worldTime of its last shot / blow
const armyEngine = (game, o) => `${BUILDINGS[o.type].name} do exército do Reino de ${game.towns?.realm?.kingdoms[o.realm]?.name || '?'}: só os engenheiros dele a usam`;

// ---------- artillery ----------
defineIntent('siege.use', {
  doc: 'Get on (on: 1) or off (on: 0) a trebuchet / catapult; one operator at a time.',
  args: { id: 'structId', on: '0|1' },
  run(game, a, actor, net) {
    const o = engineOf(game, a.id);
    if (!o || !isArtyObj(o)) return 'Máquina não encontrada';
    if (o.realm != null && a.on) return armyEngine(game, o); // (a kingdom's army's: its engineers' — game/siegeAI.js)
    const me = actor.pid, src = actor.ent, name = BUILDINGS[o.type].name.toLowerCase(), S = ARTY[o.type];
    if (!a.on) { if (o.user === me) net.emit('siege.set', { id: o.id, user: 0 }); return; }
    if (o.blueprint) return `${BUILDINGS[o.type].name}: ainda em construção`;
    if (!src || src.dead) return 'Você está morto';
    const [px, py] = pivotOf(o);
    if (Math.hypot(src.x - px, src.y - py) > S.reach + 0.6) return o.type === 'trebuchet' ? 'Chegue mais perto do trabuco' : 'Chegue mais perto da catapulta';
    if (Math.abs((src.z || 0) - (o.lv | 0)) > 0.6) return (o.lv | 0) > (src.z || 0) ? `Suba até a ${name}` : `Desça até a ${name}`;
    if (o.user && o.user !== me) { const q = playerByPid(game, o.user); if (q && !q.dead) return 'Já tem alguém operando'; }
    for (const b of game.build.structures) {
      if (b === o) continue;
      if (ARTY[b.type] && b.user === me) net.emit('siege.set', { id: b.id, user: 0 }); // (one at a time per player)
      if (PUSH[b.type] && (b.push || []).includes(me)) net.emit('siege.set', { id: b.id, push: b.push.map((q) => (q === me ? 0 : q)) });
      if (b.type === 'ballista' && b.user === me) net.emit('ballista.set', { id: b.id, user: 0 });
    }
    net.emit('siege.set', { id: o.id, user: me });
  },
});

defineIntent('siege.aim', {
  doc: 'The operator reports where the frame points (a, world angle) and how far it throws (d tiles), a few times a second.',
  args: { id: 'structId', a: 'radians', d: 'tiles' },
  run(game, a, actor, net) {
    const o = engineOf(game, a.id), v = ang(a.a);
    if (!o || !isArtyObj(o) || v == null || o.user !== actor.pid) return false; // (silent: the operator changed meanwhile)
    const S = ARTY[o.type], d = Math.max(S.range[0], Math.min(S.range[1], num(a.d, S.range[1])));
    net.emit('siege.set', { id: o.id, aim: +v.toFixed(4), dist: +d.toFixed(2) });
  },
});

defineIntent('siege.fire', {
  doc: 'The operator throws one stone (already taken from its backpack; refunded on a reject) at angle a, distance d. The host rolls the landing point (scatter).',
  args: { id: 'structId', a: 'radians', d: 'tiles' },
  run(game, a, actor) {
    const o = engineOf(game, a.id), v = ang(a.a);
    if (!o || !isArtyObj(o) || v == null) return 'Máquina não encontrada';
    if (o.user !== actor.pid) return 'Você não está operando esta máquina';
    if (!actor.ent || actor.ent.dead) return 'Você está morto';
    return fireShot(game, o, v, a.d, actor.pid);
  },
});
// host: the shot of an operator (a player through siege.fire; a kingdom's engineer — '~<nid>', game/siegeAI.js — directly):
// the same reload check, the scatter rolled here, op siege.shot. undefined = thrown, else why not
export function fireShot(game, o, v, dist, by) {
  const net = game.net, S = ARTY[o.type], last = LAST.get(o.id);
  if (last != null && game.worldTime - last < S.reload * 0.85) return o.type === 'trebuchet' ? 'O trabuco ainda está sendo armado no guincho…' : 'Recarregando a catapulta…';
  LAST.set(o.id, game.worldTime);
  const d = Math.max(S.range[0], Math.min(S.range[1], num(dist, S.range[1])));
  const L = shotLanding(game, o, v, d), [x, y] = releaseOf(o, v);
  const [dur, apex] = flightOf(S, Math.hypot(L.lx - x, L.ly - y));
  net.emit('siege.shot', { id: o.id, type: o.type, sid: hostProjId(), x: +x.toFixed(3), y: +y.toFixed(3), lx: +L.lx.toFixed(3), ly: +L.ly.toFixed(3), tx: +L.tx.toFixed(2), ty: +L.ty.toFixed(2),
    k: +L.k.toFixed(3), a: +v.toFixed(4), d: +d.toFixed(2), dur: +dur.toFixed(3), apex: +apex.toFixed(2), by });
}

// ---------- pushed engines ----------
defineIntent('siege.push', {
  doc: 'Grab (on: 1) or let go (on: 0) a battering ram / siege tower to push it (up to 4 people around it).',
  args: { id: 'structId', on: '0|1' },
  run(game, a, actor, net) {
    const o = engineOf(game, a.id);
    if (!o || !isPushObj(o)) return 'Máquina não encontrada';
    if (o.realm != null && a.on) return armyEngine(game, o);
    const me = actor.pid, src = actor.ent, L = pidList(o.push);
    while (L.length < PUSH_SLOTS) L.push(0);
    if (!a.on) {
      const k = L.indexOf(me);
      if (k >= 0) { L[k] = 0; o._drive?.delete(me); net.emit('siege.set', { id: o.id, push: L }); }
      return;
    }
    const def = BUILDINGS[o.type];
    if (o.blueprint) return `${def.name}: ainda em construção`;
    if (!src || src.dead) return 'Você está morto';
    if ((src.z || 0) > 0.5) return 'Desça para o chão para empurrar';
    if (footDist(o, src.x, src.y) > PUSH_REACH + 0.6) return 'Chegue mais perto';
    if (L.includes(me)) return;
    const k = L.indexOf(0);
    if (k < 0) return 'Já tem 4 pessoas empurrando';
    for (const b of game.build.structures) {
      if (b === o) continue;
      if (ARTY[b.type] && b.user === me) net.emit('siege.set', { id: b.id, user: 0 });
      if (PUSH[b.type] && (b.push || []).includes(me)) net.emit('siege.set', { id: b.id, push: b.push.map((q) => (q === me ? 0 : q)) });
      if (b.type === 'ballista' && b.user === me) net.emit('ballista.set', { id: b.id, user: 0 });
    }
    // (the free slot nearest to where the player stands)
    let best = k, bd = 1e9;
    for (let j = 0; j < PUSH_SLOTS; j++) {
      if (L[j]) continue;
      const lo = slotPos(o, j), dd = Math.hypot(lo[0] - src.x, lo[1] - src.y);
      if (dd < bd) { bd = dd; best = j; }
    }
    L[best] = me;
    net.emit('siege.set', { id: o.id, push: L });
  },
});
function slotPos(o, k) {
  const [W, D] = BUILDINGS[o.type].size, lx = k === 0 ? -0.48 : k === 1 ? 0.48 : k === 2 ? -(W / 2 + 0.42) : W / 2 + 0.42, ly = k < 2 ? -(D / 2 + 0.42) : -D / 2 + 0.45;
  const cx = o.tx + o.fw / 2, cy = o.ty + o.fh / 2, r = (o.rot & 3) * Math.PI / 2, c = Math.cos(r), s = Math.sin(r);
  return [cx + c * lx - s * ly, cy + s * lx + c * ly];
}

defineIntent('siege.drive', {
  doc: 'A pusher reports where it pushes: d = world direction 0 S, 1 W, 2 N, 3 E, -1 none (the host adds the crew up and moves the engine).',
  args: { id: 'structId', d: '-1..3' },
  run(game, a, actor) {
    const o = engineOf(game, a.id);
    if (!o || !isPushObj(o) || !(o.push || []).includes(actor.pid)) return false;
    const d = num(a.d, -1) | 0;
    (o._drive || (o._drive = new Map())).set(actor.pid, d >= 0 && d < 4 ? d : -1); // (host only: the steps are shared)
  },
});

defineIntent('siege.ram', {
  doc: 'A pusher of a battering ram swings it: only a GATE in front of it takes damage (and only an enemy\'s).',
  args: { id: 'structId' },
  run(game, a, actor) {
    const o = engineOf(game, a.id);
    if (!o || o.type !== 'battering_ram') return 'Aríete não encontrado';
    if (!(o.push || []).includes(actor.pid)) return 'Pegue o aríete antes (E)';
    return ramBlow(game, o);
  },
});
// host: a blow of the ram (a player's siege.ram; a kingdom's crew — game/siegeAI.js — directly): undefined = it struck a
// gate, false = still swinging, else why nothing broke
export function ramBlow(game, o) {
  const net = game.net;
  {
    const n = crewOf(o), last = LAST.get(o.id);
    if (last != null && game.worldTime - last < ramCooldown(n) * 0.9) return false; // (still swinging: silent)
    LAST.set(o.id, game.worldTime);
    // what is right in front of its head
    const seen = new Set(), hits = [];
    let any = null;
    for (const [x, y] of frontTiles(o)) {
      if (!game.world.inBounds(x, y)) continue;
      const q = game.build.grid.main.get(game.world.idx(x, y));
      if (!q || q.blueprint || seen.has(q)) continue;
      seen.add(q); any = any || q;
      if (isGate(game, q) && siegeCanDamage(game, o, q)) hits.push(q);
    }
    const [hx, hy] = any ? [any.tx + (any.fw || 1) / 2, any.ty + (any.fh || 1) / 2] : frontTiles(o)[0].map((v) => v + 0.5);
    net.emit('siege.swing', { id: o.id, hit: hits.length ? 1 : any ? 2 : 0, x: +hx.toFixed(2), y: +hy.toFixed(2) });
    for (const q of hits) damageStructure(game, q, PUSH.battering_ram.ram, o.tx + o.fw / 2, o.ty + o.fh / 2);
    if (!any) return 'Encoste o aríete num portão';
    if (!hits.length) return isGate(game, any) ? 'Este portão não é de um inimigo' : 'O aríete só quebra portões';
  }
}

// ---------- ops ----------
defineOp('siege.set', {
  doc: 'A siege engine\'s operator (user: pid | 0), aim (radians) and distance (tiles), pushers (push: [pid|0 × 4]) and the siege tower\'s ramp (0 up / 1 down).',
  args: { id: 'structId', user: 'pid|0?', aim: 'radians?', dist: 'tiles?', push: '[pid|0]?', ramp: '0|1?' },
  apply(game, a) {
    const o = game.world.objById.get(a.id);
    if (!o || !o.building || (!ARTY[o.type] && !PUSH[o.type])) return;
    if ('user' in a) { if (a.user) o.user = String(a.user).slice(0, 40); else delete o.user; }
    const v = ang(a.aim);
    if (v != null) o.aim = v;
    if (Number.isFinite(a.dist)) o.dist = a.dist;
    if ('push' in a) { const L = pidList(a.push); if (L.some(Boolean)) o.push = L; else delete o.push; }
    if ('ramp' in a) {
      const r = a.ramp ? 1 : 0;
      if (!!o.ramp !== !!r) {
        if (r) o.ramp = 1; else delete o.ramp;
        game.build.v++; // (the tower's deck is a surface of the levels map while its ramp is down: levels.js rebuilds)
        game.events?.emit('siegeramp', { o, down: !!r });
      }
    }
  },
});

defineOp('siege.shot', {
  doc: 'A trebuchet / catapult throws: the arm swings and, at the release (after its swing time), a stone flies from (x, y) to the landing point (lx, ly) on every peer; the host\'s copy resolves the impact. tx, ty, k: the aim point and the ranging factor (HUD).',
  args: { id: 'structId', type: "'trebuchet'|'catapult'", sid: 'shot id', x: 'number', y: 'number', lx: 'number', ly: 'number', tx: 'number', ty: 'number', k: 'number', a: 'radians', d: 'tiles', dur: 's', apex: 'tiles', by: 'pid' },
  apply(game, a) {
    const S = ARTY[a.type];
    if (!S) return;
    const o = game.world.objById.get(a.id), v = ang(a.a) ?? 0;
    const shot = { type: a.type, sid: String(a.sid || ''), x: num(a.x), y: num(a.y), lx: num(a.lx), ly: num(a.ly), dur: Math.max(0.2, Math.min(8, num(a.dur, 2))), apex: Math.max(0, Math.min(30, num(a.apex, 4))), by: typeof a.by === 'string' ? a.by : null };
    if (o && o.building && ARTY[o.type]) {
      o.aim = v; if (Number.isFinite(a.d)) o.dist = a.d;
      o._reload = S.reload; o._shotT = game.time; o.shake = 0.5;
      o._rng = { x: num(a.tx), y: num(a.ty), k: num(a.k, 1) }; // (cosmetic: the HUD's next scatter)
    }
    game.events?.emit('siegeshot', { o, type: a.type, x: shot.x, y: shot.y, a: v }); // (fx/siegefx.js: creak, thump, dust)
    game.later(S.swing, () => launchStone(game, o, shot)); // (the stone leaves at the release of the swing)
  },
});

defineOp('siege.step', {
  doc: 'A pushed siege engine moves to (tx, ty) (a tile; dur = s the model takes to glide there).',
  args: { id: 'structId', tx: 'int', ty: 'int', dur: 's' },
  apply(game, a, ctx) {
    const o = structById(game, a.id);
    if (!o || !PUSH[o.type] || o.blueprint) return;
    const tx = num(a.tx) | 0, ty = num(a.ty) | 0, ox = o.tx, oy = o.ty;
    if (Math.abs(tx - ox) + Math.abs(ty - oy) !== 1) { relocateStructure(game, o, tx, ty, o.rot | 0, ctx.auth); return; } // (a correction: no glide)
    // (cosmetic: the model glides from where it was — the rest of a glide still running included)
    const rx = o._slT > 0 && o._slD > 0 ? o._slx * (o._slT / o._slD) : 0, ry = o._slT > 0 && o._slD > 0 ? o._sly * (o._slT / o._slD) : 0;
    relocateStructure(game, o, tx, ty, o.rot | 0, ctx.auth);
    o._slx = ox - tx + rx; o._sly = oy - ty + ry; o._slD = o._slT = Math.max(0.1, Math.min(4, num(a.dur, 1)));
    game.events?.emit('siegestep', { o });
  },
});

defineOp('siege.swing', {
  doc: 'A battering ram strikes (hit: 1 a gate took damage, 2 it hit something else, 0 nothing in front); (x, y) where its head lands.',
  args: { id: 'structId', hit: '0|1|2', x: 'number', y: 'number' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o || o.type !== 'battering_ram') return;
    o._swT = game.time;
    game.events?.emit('siegeram', { o, hit: a.hit | 0, x: num(a.x), y: num(a.y) }); // (fx/siegefx.js: the boom, splinters, the delayed impact)
  },
});

defineOp('siege.dmg', {
  doc: 'Siege damage of a structure (0..1, hit from (x, y)) by a siege engine: cracks on every peer; it does not settle at dawn (o.sdmg).',
  args: { id: 'structId', d: '0..1', x: 'number', y: 'number' },
  apply(game, a) {
    const o = structById(game, a.id);
    if (!o) return;
    const d = Math.max(0, Math.min(1, num(a.d)));
    if (d > 0) { o.dmg = d; o.sdmg = 1; } else { delete o.dmg; delete o.sdmg; }
    if (o.town != null) TOWN.note?.(game, o, 'dmg'); // (a settlement's piece: its damage kept in the town state — game/people.js repairs it)
    game.rockFx?.structHit?.(game, o, d > 0 ? num(a.x, o.x) : null, num(a.y, o.y));
  },
});

defineOwn('siege.msg', {
  doc: 'The host tells a siege crew something (blocked, the wall is of another height, people on the deck).',
  args: { text: 'string', kind: 'string?' },
  apply(game, a) { if (typeof a.text === 'string') game.events.emit('toast', { text: a.text.slice(0, 160), kind: a.kind === 'info' ? 'info' : 'warn' }); },
});
