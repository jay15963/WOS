// Simulation mode (docs/SIMULACAO.md): a throwaway world to watch how it changes — owner: "crie um modo de simulação para
// testar como o mundo vai mudando, o modo simulação tem velocidade de 1x, 2x, 3x, 4x, 5x, 10x, 50x e 100x, mas apenas na visão
// do mapa mundi, na visão de gameplay vai até 5x … o jogador pode possuir qualquer npc dentro do mundo, permanecendo os itens que
// o npc tem … todo npc tem que ter pelo menos 5 pães no inventário na hora que o jogador possuir um npc e alguns itens aleatórios
// básicos, até mesmo ferramentas, tudo depende do nível do npc, e claro só dá de possuir npc humano … apenas o host pode mudar a
// velocidade da simulação e se a velocidade passar de 5x os jogadores que estiverem no zoom de gameplay voltam ao zoom de mapa
// mundi, e se tiver jogadores possuindo npc o host não pode aumentar a velocidade acima de 5x".
//
// game.sim = { on, speed, who: Map pid → { name, role, level } (who possesses a person now), view: 'map' | 'play' (local),
//   possess(e), leave(), setSpeed(s), setView(v), tick … }. Shared: the speed and who (op sim.state, from the host).
// Every player without a body is a SPECTATOR (p.ghost): unseen, flying, never hurt, never anyone's target (game/ai.js pickTarget,
// fauna, giants, walkers, the townsfolk, projectiles) — but it still counts as a player for what is near (chunks, the
// townsfolk out, the live armies), so the world around the camera is the real one. Possessing a person (intent sim.possess):
// the host takes it out of the world (game/people.js, game/warfare.js, bandit camps) and hands the player its body (owner
// message sim.body: where it stood, its look, level and gear, ≥ 5 breads and basic things by its level); from then on it is
// the normal game. Leaving it (or dying in it): a spectator again.
// The clock (Game.tick): ≤ 5x — every system runs that many steps a frame; above 5x (the world map only, nobody possessing)
// one step a frame and the world's clock jumps the rest (sim.ff: hour, day, weather, worldTime) — the kingdoms, markets,
// seasons, crops, raids catch up by the clock as they do after a time skip.

import { defineIntent, defineOp, defineOwn } from '../net/registry.js';
import { ITEMS, SPECIES } from './data.js';
import { applyLevel, removeBuff } from './player.js';
import { equipChanged } from './equipment.js';

export const SPEEDS = [1, 2, 3, 4, 5, 10, 50, 100];
export const PLAY_MAX = 5; // the gameplay view's fastest (above: the world map only)
const HUMANS = new Set(['citizen', 'guard', 'soldier', 'bandit']);
const BAD = ['poison', 'bleed', 'hypothermia', 'cold', 'wet', 'chilled', 'starving', 'hungry', 'weak', 'sick', 'stunned'];
const ROLE_PT = { citizen: 'Morador', guard: 'Guarda', soldier: 'Soldado', bandit: 'Saqueador' };

export const isHuman = (e) => !!e && e.kind === 'pawn' && !e.dead && !e.isProp && HUMANS.has(e.species) && !SPECIES[e.species]?.undead;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, n = 40) => (typeof v === 'string' ? v.slice(0, n) : '');

export function simOn(game) { return !!game.sim?.on; }

// ---------- install (every peer; tests may turn it on at runtime on both) ----------
export function installSim(game) {
  if (game.sim?.on) return game.sim;
  const S = game.sim = {
    on: true, speed: 1, who: new Map(), view: 'map', over: 0, stateT: 0,
    own: null, // the player's own look / level / name while it is in someone's body (restored when it leaves)
    deadT: -1,
    possess: (e) => requestPossess(game, e),
    leave: () => leaveBody(game, true),
    setSpeed: (s) => game.net.request('sim.speed', { s }, { onReject: (why) => why && game.events.emit('error', { text: why }) }),
    setView: (v) => setView(game, v),
    ff: (extra) => fastForward(game, extra),
    anyBody: () => S.who.size > 0,
    ghost: () => !!game.player.ghost,
    maxSpeed: () => (S.who.size ? PLAY_MAX : SPEEDS[SPEEDS.length - 1]),
    nearIt: () => nearIt(game),
    tap: (tap, pick) => ghostTap(game, tap, pick),
    zoomReq: (req, atMin) => zoomReq(game, req, atMin),
    debug: () => ({ on: S.on, speed: S.speed, view: S.view, ghost: !!game.player.ghost, who: [...S.who].map(([pid, w]) => ({ pid, ...w })), wt: game.worldTime, day: game.env.dayIndex, hour: +game.env.hour.toFixed(2) }),
  };
  game.noSave = true; // (a throwaway world: never saved)
  becomeGhost(game, false);
  revealPlanet(game);
  return S;
}

// the whole planet on the map (no fog of war: it is a test world)
function revealPlanet(game) {
  game.explored = new Uint8Array(256 * 128).fill(1);
  game._exploredV = (game._exploredV || 0) + 1;
}

// ---------- the spectator (the local player without a body) ----------
function becomeGhost(game, announce = true) {
  const p = game.player, S = game.sim;
  if (S.own) { // (back from someone's body: the player's own self again)
    p.look = S.own.look; p.level = S.own.level; p.xp = S.own.xp;
    S.own = null;
  }
  p.ghost = true;
  p.dead = false; p.deadT = 0; p.rooted = false; p.flash = 0;
  p.lv = 0; p.z = 0; p._fallV = 0; p._hop = null;
  p.target = null; p.autoAttack = false; p.work = null; p.action = null; p.charge = null; p.leap = null; p.cast = null; p.block = null; p.blocking = false;
  if (p.mount) { try { game.horses?.dismount?.(p); } catch { /* ignore */ } }
  for (let i = 0; i < p.inv.size; i++) p.inv.slots[i] = null;
  p.inv.version++;
  p.equip.main = p.equip.off = p.equip.body = p.equip.head = null;
  applyLevel(p);
  equipChanged(game);
  p.hp = p.maxHp;
  S.deadT = -1;
  game.events.emit('target', { target: null });
  if (game.ctl) game.ctl.goal = null;
  game.events.emit('sim', { type: 'ghost' });
  if (announce) game.events.emit('toast', { text: 'Você saiu do corpo: espectador de novo', kind: 'info' });
}
// a spectator is never hungry, cold, hurt or slowed — and never acts
function ghostKeep(game) {
  const p = game.player;
  p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = p.maxHunger || 100; p.bodyHeat = 100; p.wetT = 0;
  p.dead = false; p.stunT = 0; p.rooted = false; p.swimming = false;
  if (p.buffs?.length) for (const id of BAD) if (p.buffs.some((b) => b.id === id)) removeBuff(p, id);
  if (p.target) { p.target = null; game.events.emit('target', { target: null }); }
  p.autoAttack = false; p.work = null;
}

// ---------- the clock above 5x: the world's clock jumps (every peer, the same way) ----------
function fastForward(game, extra) {
  if (!(extra > 0)) return;
  game.env.update(extra);
  game.worldTime += extra;
}

// ---------- views ----------
function setView(game, v) {
  const S = game.sim;
  if (v === S.view) return;
  if (v === 'play' && S.speed > PLAY_MAX) { game.events.emit('error', { text: `A ${S.speed}x só no mapa: diminua para 5x ou menos` }); return; }
  S.view = v;
  S.over = 0;
  game.events.emit('sim', { type: 'view', view: v });
}
// the wheel in the gameplay view: zooming out past its limit goes to the world map
function zoomReq(game, req, atMin) {
  const S = game.sim;
  if (req < 0 && atMin) { S.over += -req; if (S.over > 0.5) setView(game, 'map'); }
  else if (req) S.over = 0;
}

// ---------- possessing ----------
function nearIt(game) {
  const p = game.player;
  let best = null, bd = 3.2;
  for (const e of game.entities) {
    if (!isHuman(e)) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best ? { kind: 'possess', o: best, x: best.x, y: best.y, reach: 3.2, verb: `Possuir ${nameOf(best)}`, icon: 'hand', prio: 5, use: true } : null;
}
function nameOf(e) { return (e.npc?.first || e.soldier?.first || String(e.name || '').split(' ')[0] || ROLE_PT[e.species] || 'pessoa'); }
// a spectator's click: a person is possessed (anywhere on the screen); nothing else is done
function ghostTap(game, tap, pick) {
  const h = pick(game, tap.x, tap.y);
  if (h?.type === 'creature' && isHuman(h.e)) { requestPossess(game, h.e); return true; }
  if (h?.type === 'creature') game.events.emit('error', { text: 'Só dá para possuir uma pessoa (morador, guarda, soldado, saqueador)' });
  return true;
}
function requestPossess(game, e) {
  const S = game.sim;
  if (!game.player.ghost) { game.events.emit('error', { text: 'Saia do corpo antes (botão "Sair do corpo")' }); return; }
  if (S.speed > PLAY_MAX) { game.events.emit('error', { text: 'Acima de 5x não dá para possuir: diminua a velocidade' }); return; }
  if (!isHuman(e)) return;
  game.net.request('sim.possess', { nid: e.nid }, { onReject: (why) => why && game.events.emit('error', { text: why }) });
}
// the owner leaves the body (a button, its death): a spectator where it stood
function leaveBody(game, ask) {
  const p = game.player;
  if (p.ghost) return;
  becomeGhost(game);
  if (ask) game.net.request('sim.leave', {});
}

// the gear of a person and the rest of its backpack (host): what it wears and holds, ≥ 5 breads, basic things by its level
const tierMat = (lv) => (lv >= 13 ? 'steel' : lv >= 8 ? 'iron' : lv >= 4 ? 'copper' : 'stone');
const has = (id) => !!(id && ITEMS[id]);
export function kitOf(e, rnd = Math.random) {
  const lv = Math.max(1, e.level | 0), mat = tierMat(lv), R = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const equip = { main: null, off: null, body: null, head: null };
  if (has(e.weapon)) equip.main = e.weapon;
  if (e.shield && !ITEMS[equip.main]?.weapon?.twoHanded) equip.off = has(e.offhand) && ITEMS[e.offhand].slot === 'off' ? e.offhand : lv >= 8 ? 'shield_iron' : 'shield_copper';
  if (has(e.armor?.head)) equip.head = e.armor.head;
  if (has(e.armor?.body)) equip.body = e.armor.body;
  // a soldier's body armour is under its tabard (not in e.armor): by its rank (game/soldier.js)
  if (e.soldier && !equip.body) equip.body = e.role === 'archer' || e.soldier.role === 'eng' ? 'armor_leather' : lv >= 8 ? 'armor_iron' : lv >= 4 ? 'armor_copper' : 'armor_leather';
  if (e.species === 'guard' && !equip.body) equip.body = lv >= 8 ? 'armor_iron' : 'armor_copper';
  for (const k in equip) if (equip[k] && !has(equip[k])) equip[k] = null;
  const items = new Map(), add = (id, n) => { if (has(id) && n > 0) items.set(id, (items.get(id) || 0) + n); };
  add('bread', 5 + Math.floor(lv / 4));
  add('coin', R(4, 10) + lv * R(2, 5));
  if (ITEMS[equip.main]?.weapon?.type === 'bow') add('arrow', 20 + lv * 2);
  // tools by the level (stone → copper → iron → steel), each by chance; at least one
  const tools = [['knife', 0.75], ['axe', 0.6], ['pickaxe', 0.5], ['shovel', 0.25]];
  let nt = 0;
  for (const [t, ch] of tools) if (rnd() < ch && has(`${t}_${mat}`) && equip.main !== `${t}_${mat}`) { add(`${t}_${mat}`, 1); nt++; }
  if (!nt) add(`knife_${mat}`, 1);
  // a few basic things
  const basics = [['torch_hand', 1, 2], ['rope', 2, 5], ['herb', 1, 4], ['wood', 4, 12], ['stone', 3, 8], ['fiber', 3, 10], ['berries', 2, 6], ['baked_potato', 1, 4], ['cooked', 1, 3], ['stick', 2, 6]];
  const n = 3 + Math.min(4, Math.floor(lv / 5));
  for (let k = 0; k < n; k++) { const [id, a, b] = basics[Math.floor(rnd() * basics.length)]; add(id, R(a, b)); }
  return { equip, items: [...items] };
}

// host: out of the world, silently (no death, no news): the townsfolk keep it out while someone is it; an army counts it lost
function takeOut(game, e) {
  if (e.npc) {
    const rec = game.people?.live?.get(e.npcS?.sid);
    (game.people.taken ||= new Set()).add(`${e.npcS?.sid}.${e.npc.i}`); // sync-ok: host-only (people.js spawns nobody taken)
    if (rec) game.people._drop(rec, e);
    else { const i = game.entities.indexOf(e); if (i >= 0) game.entities.splice(i, 1); } // sync-ok: host-only creature list
    return;
  }
  if (e.soldier && game.warfare?.desert?.(e)) return;
  for (const c of game.camps || []) { const i = c.members?.indexOf(e) ?? -1; if (i >= 0) c.members.splice(i, 1); }
  const i = game.entities.indexOf(e);
  if (i >= 0) game.entities.splice(i, 1); // sync-ok: host-only creature list
  if (game.player.target === e) { game.player.target = null; game.events.emit('target', { target: null }); }
}

const stateRow = (S) => ({ s: S.speed, who: [...S.who].map(([pid, w]) => [pid, w.name, w.role, w.level]) });
function emitState(game) { game.net.emit('sim.state', stateRow(game.sim)); }

defineOp('sim.state', {
  doc: 'The simulation (host): its speed and who is in someone\'s body now. Above 5x every player in the gameplay view goes to the world map.',
  args: { s: 'speed (1 2 3 4 5 10 50 100)', who: '[[pid, name, role, level]]' },
  apply(game, a) {
    const S = game.sim;
    if (!S) return;
    const s = SPEEDS.includes(a.s) ? a.s : 1, was = S.speed;
    S.speed = s;
    S.who = new Map((Array.isArray(a.who) ? a.who : []).slice(0, 16).map((r) => [str(r[0], 24), { name: str(r[1], 40), role: str(r[2], 20), level: num(r[3], 1) | 0 }]));
    if (s > PLAY_MAX && S.view === 'play') { S.view = 'map'; S.over = 0; game.events.emit('sim', { type: 'view', view: 'map', forced: true }); }
    if (s !== was) game.events.emit('sim', { type: 'speed', speed: s, was });
    game.events.emit('sim', { type: 'state' });
  },
});

defineIntent('sim.speed', {
  doc: 'The host sets the simulation speed (1–5x anywhere; 10x, 50x, 100x only with nobody in a body — the world map).',
  args: { s: 'speed' },
  run(game, a, actor, net) {
    const S = game.sim;
    if (!S?.on) return 'Não é uma simulação';
    if (actor.pid !== net.pid) return 'Só o anfitrião muda a velocidade';
    const s = SPEEDS.includes(a.s) ? a.s : null;
    if (!s) return 'Velocidade inválida';
    if (s > PLAY_MAX && S.who.size) return `Alguém está possuindo um NPC: no máximo ${PLAY_MAX}x`;
    if (s === S.speed) return;
    net.emit('sim.state', { ...stateRow(S), s });
  },
});

defineIntent('sim.possess', {
  doc: 'A spectator takes the body of a person (a townsperson, a guard, a soldier, a raider): the host takes it out of the world and hands its body to the actor (owner message sim.body).',
  args: { nid: 'creature nid' },
  run(game, a, actor, net) {
    const S = game.sim;
    if (!S?.on) return 'Não é uma simulação';
    if (S.speed > PLAY_MAX) return 'Acima de 5x não dá para possuir: diminua a velocidade';
    if (S.who.has(actor.pid)) return 'Você já está num corpo: saia dele antes';
    if (actor.ent && !actor.ent.ghost) return 'Você já está num corpo: saia dele antes';
    const e = game.entities.find((q) => q.nid === a.nid && !q.proxy);
    if (!e || !isHuman(e)) return 'Essa pessoa não está mais aí';
    const kit = kitOf(e);
    const body = {
      x: +e.x.toFixed(3), y: +e.y.toFixed(3), z: e.z > 0 ? +e.z.toFixed(2) : 0, lv: e.lv | 0, name: nameOf(e), full: String(e.name || '').slice(0, 40),
      role: e.soldier ? (e.soldier.roleName || ROLE_PT.soldier) : e.npc ? (e.npc.jobPt || (e.npc.guard ? ROLE_PT.guard : ROLE_PT.citizen)) : (e.name && e.name !== nameOf(e) ? e.name : ROLE_PT[e.species] || 'Pessoa'),
      level: Math.max(1, Math.min(60, e.level | 0)), hpK: e.maxHp ? Math.max(0.2, Math.min(1, (e.hp || 0) / e.maxHp)) : 1,
      look: e.look || null, equip: kit.equip, items: kit.items, facing: e.facing || 's',
    };
    takeOut(game, e);
    S.who.set(actor.pid, { name: body.name, role: String(body.role).slice(0, 20), level: body.level });
    emitState(game);
    net.toOwner(actor.pid, 'sim.body', body);
  },
});

defineIntent('sim.leave', {
  doc: 'The actor left the body it had (a spectator again: it did so already on its side).',
  args: {},
  run(game, a, actor) {
    const S = game.sim;
    if (!S?.on || !S.who.has(actor.pid)) return;
    S.who.delete(actor.pid);
    emitState(game);
  },
});

defineOwn('sim.body', {
  doc: 'The owner becomes the person it possessed: where it stood, its look, level, gear and backpack (the normal game from now on).',
  args: { x: 'number', y: 'number', z: 'number', lv: 'int', name: 'string', full: 'string', role: 'string', level: 'int', hpK: '0..1', look: 'look', equip: '{main, off, body, head}', items: '[[id, n]]', facing: 'n|s|e|w' },
  apply(game, a) {
    const p = game.player, S = game.sim;
    if (!S) return;
    S.own = { look: p.look, level: p.level || 1, xp: p.xp || 0 };
    p.ghost = false;
    p.x = num(a.x, p.x); p.y = num(a.y, p.y); p.lv = num(a.lv, 0) | 0; p.z = num(a.z, 0); p._fallV = 0; p._hop = null;
    if (a.look && typeof a.look === 'object') p.look = a.look;
    p.level = Math.max(1, Math.min(60, num(a.level, 1) | 0)); p.xp = 0;
    for (let i = 0; i < p.inv.size; i++) p.inv.slots[i] = null;
    p.inv.version++;
    const eq = a.equip || {};
    for (const k of ['main', 'off', 'body', 'head']) p.equip[k] = has(eq[k]) ? eq[k] : null;
    for (const r of Array.isArray(a.items) ? a.items.slice(0, 40) : []) if (Array.isArray(r) && has(r[0])) p.inv.add(r[0], Math.max(1, Math.min(999, num(r[1], 1) | 0)));
    applyLevel(p);
    equipChanged(game);
    p.hp = Math.max(1, Math.round(p.maxHp * num(a.hpK, 1))); p.energy = p.maxEnergy; p.hunger = p.maxHunger || 100; p.bodyHeat = 100;
    p.facing = ['n', 's', 'e', 'w'].includes(a.facing) ? a.facing : p.facing;
    p.dead = false; S.deadT = -1;
    S.body = { name: str(a.name), full: str(a.full), role: str(a.role, 30), level: p.level };
    game.cam.x = p.x; game.cam.y = p.y;
    if (S.view !== 'play') { S.view = 'play'; S.over = 0; game.events.emit('sim', { type: 'view', view: 'play' }); }
    game.events.emit('inventory', {});
    game.events.emit('sim', { type: 'body' });
    game.events.emit('toast', { text: `Você é ${a.full || a.name} (${a.role}, nível ${p.level})`, kind: 'good' });
  },
});

// ---------- systems ----------
// every peer: the spectator kept a spectator, a body's death → a spectator again (after a moment), above 5x the gameplay view
// closed; the host: the state now and then (late joiners), who left the room
export function simSystem() {
  return {
    sync: 'all',
    update(game, dt) {
      const S = game.sim;
      if (!S?.on) return;
      const p = game.player;
      if (p.ghost) ghostKeep(game);
      else if (p.dead) {
        if (S.deadT < 0) S.deadT = game.time;
        if (game.time - S.deadT > 2.5) leaveBody(game, true);
      }
      if (S.speed > PLAY_MAX && S.view === 'play') setView(game, 'map');
      if (game.net.auth) {
        S.stateT -= dt;
        if (S.stateT <= 0) {
          S.stateT = 3;
          // (a guest that left the room while in a body: free again)
          const here = new Set([game.net.pid, ...(game.session?.players?.keys?.() || [])]);
          for (const pid of [...S.who.keys()]) if (!here.has(pid)) S.who.delete(pid);
          emitState(game);
        }
      }
    },
  };
}
