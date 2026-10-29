// Auto-work, OPT-IN (owner's rule: nothing happens by itself). The player starts a job sequence by tapping /
// clicking a blue blueprint, a frame under construction, a structure marked for deconstruction or a blue path plan /
// red path-removal mark (or by using one with E / the context menu / the toolbars' "Construir" / "Assentar"), or
// by planting / harvesting a plot by hand. The sequence then works through the jobs of the same placement — the
// same batch (type + builtAt) plus connected blueprints of that type, the connected structures marked for
// deconstruction, the connected planned path tiles of that plan code (the painted stroke), the connected plots of
// a field — nearest first, and stops. Placing blueprints, painting paths or marking things never starts anything.
// Movement input (joystick / WASD) interrupts the current step and PAUSES the sequence (banner: Continuar /
// ✕ Cancelar); ✕ / Esc cancels it: plans stay plans and delivered materials stay delivered.
// Jobs without materials are skipped ("falta material"); when only those are left the sequence ends.
// Owner-side (the local player): every job still goes through the intents (build.hit / decon.hit / path.lay /
// path.dig / farm.*). Mining is a direct action only (mining.js): no designations, no mining jobs here.
// game.work.paused (tests / debugging) freezes automatic continuation.
// game.work.providers (agent M's job sources: { find(game, player, maxDist), count(game) }) are kept for counts /
// debugging only: providers never start work by themselves any more (paths are sequence kind 'path' below).

import { describeStructure, useStructure, structIt, canSupply, missingText } from './building.js';
import { startWork } from './gathering.js';
import { resetNav } from './nav.js';
import { recipeState } from './crafting.js';
import { RECIPES } from './content/recipes.js';
import { BUILDINGS, ITEMS } from './data.js';
import { structureAt } from './autotile.js';
import { PATH_TYPES, PATH_REMOVE } from './content/paths.js';

const FAIL_CD = 12;      // s an unreachable job stays skipped
const STEP_DELAY = 0.25; // s between two jobs of a sequence
const FAR = 40;          // a paused sequence whose jobs are all farther than this (tiles) is dropped
const PATH_GROUP_MAX = 2000;

const KIND = { blueprint: 'build', decon: 'decon', plant: 'farm', harvest: 'farm', path: 'path' };

export function initWork(game) {
  const W = game.work = {
    seq: null, paused: false, failed: new Map(), idleT: 0, told: new Set(),
    providers: [], // other job sources (painted paths): counts only, see the header
    begin: (it, opts) => beginSeq(game, it, opts),
    // stops the sequence and its current step (plans stay plans, delivered materials stay delivered)
    cancel(quiet = false) {
      const s = W.seq;
      if (!s) return;
      W.seq = null;
      const p = game.player, ctl = game.ctl;
      if (ctl?.goal?.auto) ctl.goal = null;
      if (p.work && inSeq(s, p.work.it)) { p.work = null; p.action = null; }
      if (!quiet) game.events.emit('toast', { text: 'Tarefa automática cancelada', kind: 'info' });
      game.events.emit('work', {});
    },
    pause() { if (W.seq && !W.seq.paused) { W.seq.paused = true; W.seq.cur = null; game.events.emit('work', {}); } },
    resume() { if (W.seq) { W.seq.paused = false; W.idleT = STEP_DELAY; game.events.emit('work', {}); } },
    active: () => !!W.seq,
    status: () => statusOf(game),
    fail(it) { const k = jobKey(game, it); if (k) W.failed.set(k, game.worldTime + FAIL_CD); },
    wake() { /* legacy no-op: placing / painting / marking never starts work any more */ },
    // farm follow-ups: after a plot was planted / harvested by hand, continue with the rest of that field
    queuePlantNear: (tx, ty) => fieldFollowUp(game, tx, ty),
    queueHarvestNear: (tx, ty) => fieldFollowUp(game, tx, ty),
    count: () => countJobs(game),
  };
}

function jobKey(game, it) {
  if (!it) return null;
  if (it.key) return it.key; // painted paths: 'p' + tile index
  if (it.o) return 'o' + it.o.id;
  return null;
}
const live = (game, id) => { const o = game.world.objById.get(id); return o && o.building && !o.removed ? o : null; };
// does a job descriptor belong to the sequence?
const inSeq = (s, it) => !!it && (s.kind === 'path' ? it.kind === 'path' && s.ids.has(it.i) : !!it.o && s.ids.has(it.o.id));

// pending plans in the world (for UI / debugging)
export function countJobs(game) {
  let n = game.build.decon.size;
  for (const o of game.build.structures) if (o.blueprint) n++;
  for (const pr of game.work?.providers || []) n += pr.count(game) || 0;
  return n;
}

// route a reached interaction to the right module. Using a blueprint / marked structure / path plan by hand (E,
// menu) also starts its sequence, with this job as the current one.
export function useInteract(game, it) {
  if (it.use) { useStructure(game, it); return true; }
  const W = game.work;
  if (!it.auto && !W.paused && (it.kind === 'blueprint' || it.kind === 'decon' || it.kind === 'path')) beginSeq(game, it, { now: true });
  return startWork(game, it);
}

// structures that belong to the same job sequence as `o`
function groupOf(game, o, kind) {
  const ids = new Set([o.id]);
  if (kind === 'build' && o.moveOf) return ids;
  const D = game.build.decon;
  const member = kind === 'build' ? (q) => q.blueprint && !q.moveOf && q.type === o.type
    : kind === 'decon' ? (q) => !q.blueprint && D.has(q)
      : (q) => q.type === 'farm_plot' && !q.blueprint;
  const pool = game.build.structures.filter((q) => q !== o && member(q));
  const queue = [o];
  if (kind === 'build') for (const q of pool) if (q.builtAt === o.builtAt) { ids.add(q.id); queue.push(q); } // same placement batch
  // footprints touching (sides or corners) chain the rest
  const touch = (a, b) => a.tx <= b.tx + (b.fw || 1) && b.tx <= a.tx + (a.fw || 1) && a.ty <= b.ty + (b.fh || 1) && b.ty <= a.ty + (a.fh || 1);
  for (let k = 0; k < queue.length; k++) {
    const a = queue[k];
    for (const q of pool) if (!ids.has(q.id) && touch(a, q)) { ids.add(q.id); queue.push(q); }
  }
  return ids;
}

// planned path tiles of the same plan code connected (8 neighbours) to tile i: the painted stroke
function pathGroup(game, i, c) {
  const w = game.world, Q = w.pathPlan, W = w.W, ids = new Set([i]), queue = [i];
  for (let k = 0; k < queue.length && ids.size < PATH_GROUP_MAX; k++) {
    const j = queue[k], x = j % W, y = (j / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((!dx && !dy) || !w.inBounds(xx, yy)) continue;
      const n = yy * W + xx;
      if (Q[n] === c && !ids.has(n)) { ids.add(n); queue.push(n); }
    }
  }
  return ids;
}

const affordable = (p, cost) => { for (const k in cost) if (p.inv.count(k) < cost[k]) return false; return true; };
function pathMissing(game, c) {
  const cost = PATH_TYPES[c]?.cost || {}, p = game.player, miss = [];
  for (const k in cost) { const have = p.inv.count(k); if (have < cost[k]) miss.push(`${cost[k] - have} ${(ITEMS[k]?.name || k).toLowerCase()}`); }
  return miss.join(', ');
}

function beginSeq(game, it, { now = false } = {}) {
  const p = game.player, W = game.work;
  const kind = KIND[it?.kind];
  if (!kind || p.dead) return false;
  if (kind === 'path') {
    const c = it.c, i = it.i;
    if (!c || game.world.pathPlan[i] !== c) return false;
    if (c !== PATH_REMOVE && !affordable(p, PATH_TYPES[c]?.cost || {})) { game.events.emit('error', { text: `Falta material: ${pathMissing(game, c)}` }); return false; }
    const ids = pathGroup(game, i, c);
    W.seq = { kind, ids, first: now ? null : i, cur: now ? i : null, c, type: 'path', total: ids.size, paused: false, skipped: 0 };
  } else {
    const o = it?.o;
    if (!o) return false;
    if (kind === 'build' && !canSupply(game, o)) { game.events.emit('error', { text: `Falta ${missingText(game, o)}` }); return false; }
    const ids = groupOf(game, o, kind);
    W.seq = { kind, ids, first: now ? null : o.id, cur: now ? o.id : null, type: o.type, move: !!o.moveOf, total: ids.size, paused: false, skipped: 0 };
  }
  W.failed.clear();
  W.idleT = STEP_DELAY;
  game.events.emit('work', {});
  if (!now) game.audio?.play('ui_click', {});
  return true;
}

function fieldFollowUp(game, tx, ty) {
  const W = game.work;
  if (W.paused) return;
  const plot = structureAt(game, tx, ty, 'floor');
  if (!plot || plot.type !== 'farm_plot') return;
  if (W.seq?.kind === 'farm' && W.seq.ids.has(plot.id)) return; // already going through this field
  const ids = groupOf(game, plot, 'farm');
  if (ids.size < 2) return;
  W.seq = { kind: 'farm', ids, first: null, cur: null, type: 'farm_plot', total: ids.size, paused: false, skipped: 0 };
  W.idleT = STEP_DELAY;
  game.events.emit('work', {});
}

// the job a sequence member offers right now (null = finished / nothing to do; 'blocked' = waits for material)
function jobFor(game, seq, id) {
  if (seq.kind === 'path') {
    const w = game.world;
    if (w.pathPlan[id] !== seq.c) return null;
    if (seq.c !== PATH_REMOVE && !affordable(game.player, PATH_TYPES[seq.c]?.cost || {})) return 'blocked';
    const it = game.paths?.jobAt?.(id % w.W, (id / w.W) | 0);
    return it ? { ...it, auto: true } : null;
  }
  const o = live(game, id);
  if (!o) return null;
  if (seq.kind === 'build') {
    if (!o.blueprint) return null;
    if (!canSupply(game, o)) return 'blocked';
    return structIt(o, { kind: 'blueprint', verb: o.moveOf ? 'Mover' : 'Construir', icon: 'build', auto: true });
  }
  if (seq.kind === 'decon') return game.build.decon.has(o) ? structIt(o, { kind: 'decon', verb: 'Desmontar', icon: 'build', auto: true }) : null;
  const d = describeStructure(game, o);
  if (!d || (d.kind !== 'plant' && d.kind !== 'harvest') || (d.prio ?? 0) < 0) return null;
  return { ...d, auto: true };
}
const posOf = (game, seq, id) => {
  if (seq.kind === 'path') { const W = game.world.W; return [(id % W) + 0.5, ((id / W) | 0) + 0.5]; }
  const o = live(game, id);
  return o ? [o.x, o.cy ?? o.y] : null;
};

function nextJob(game, seq) {
  const p = game.player, W = game.work, now = game.worldTime;
  let best = null, bd = 1e9, blocked = null, stuck = 0;
  for (const id of [...seq.ids]) {
    const it = jobFor(game, seq, id);
    if (!it) { seq.ids.delete(id); continue; }
    if (it === 'blocked') { blocked ??= id; continue; }
    if ((W.failed.get(jobKey(game, it)) || 0) > now) { stuck++; continue; }
    const pos = posOf(game, seq, id);
    const d = id === seq.first ? -1 : Math.hypot(pos[0] - p.x, pos[1] - p.y);
    if (d < bd) { bd = d; best = it; }
  }
  return { best, blocked, stuck };
}

function finish(game, blocked, stuck) {
  const W = game.work, seq = W.seq;
  W.seq = null;
  if (blocked != null) {
    const bo = seq.kind === 'path' ? null : live(game, blocked);
    const why = seq.kind === 'path' ? pathMissing(game, seq.c) : bo ? missingText(game, bo) : 'material';
    game.events.emit('toast', { text: `${seq.kind === 'path' ? 'Caminho parado' : 'Obra parada'} · falta ${why}`, kind: 'warn' });
  } else if (stuck) game.events.emit('toast', { text: 'Tarefa parada: não dá para chegar ao resto', kind: 'warn' });
  else if (seq && seq.total > 1) {
    const done = { build: 'Plantas concluídas', decon: 'Desmontagem concluída', farm: 'Canteiros prontos', path: seq.c === PATH_REMOVE ? 'Caminho removido' : 'Caminho pronto' };
    game.events.emit('toast', { text: done[seq.kind] || 'Pronto', kind: 'good' });
  }
  game.events.emit('work', {});
}

// banner data: { kind, verb, name, n (jobs left incl. the current one), paused, blocked }
function statusOf(game) {
  const seq = game.work.seq;
  if (!seq) return null;
  let n = 0, blocked = 0, harvest = 0;
  for (const id of seq.ids) {
    const it = jobFor(game, seq, id);
    if (!it) continue;
    if (it === 'blocked') blocked++;
    else { n++; if (it.kind === 'harvest') harvest++; }
  }
  if (seq.kind === 'path') {
    const rem = seq.c === PATH_REMOVE;
    const nm = (PATH_TYPES[seq.c]?.name || '').replace(/^caminho de\s+/i, ''); // "Caminho de cascalho" → "Cascalho"
    return { kind: 'path', verb: rem ? 'Removendo caminho' : 'Assentando caminho', name: rem ? '' : nm.charAt(0).toUpperCase() + nm.slice(1), n, blocked, paused: !!seq.paused, remove: rem };
  }
  const verb = seq.kind === 'build' ? (seq.move ? 'Movendo' : 'Construindo') : seq.kind === 'decon' ? 'Desmontando' : harvest ? 'Colhendo' : 'Plantando';
  const name = seq.kind === 'build' ? BUILDINGS[seq.type]?.name || '' : seq.kind === 'farm' ? 'Canteiros' : '';
  return { kind: seq.kind, verb, name, n, blocked, paused: !!seq.paused };
}

// is there a crafting job the player can progress right now? (it has priority)
function craftingActive(game) {
  const Q = game.craft.queue;
  if (!Q.length) return false;
  const r = RECIPES[Q[0].id];
  if (r.station === 'hand') return true;
  return recipeState(game, Q[0].id).stationOk;
}

// a creature is actually after the player (p.inCombat also stays on from cold / hunger damage, which must not
// freeze auto-work)
function chased(game) {
  const p = game.player;
  for (const e of game.entities) if (e !== p && !e.dead && e.state === 'chase' && e.threat === p) return true;
  return false;
}

export function workSystem() {
  let farT = 0, chaseT = 0, chase = false;
  return {
    sync: 'owner', // the local player's job sequence
    update(game, dt) {
      const p = game.player, ctl = game.ctl, W = game.work, seq = W.seq;
      if (!seq) return;
      if (p.dead) { W.cancel(true); return; }
      if (ctl.manual) { W.pause(); return; } // walking: the step stopped (controller), the sequence waits
      if (seq.paused) {
        // walked far away from every job: drop it quietly
        if ((farT -= dt) <= 0) {
          farT = 2;
          let near = false;
          for (const id of seq.ids) { const pos = posOf(game, seq, id); if (pos && Math.hypot(pos[0] - p.x, pos[1] - p.y) < FAR) { near = true; break; } }
          if (!near) W.cancel(true);
        }
        return;
      }
      if (W.paused) return;
      if ((chaseT -= dt) <= 0) { chaseT = 0.5; chase = p.inCombat && chased(game); }
      if (p.work || ctl.goal || p.moving || p.autoAttack || chase || game.ui?.modal || p.charge) {
        if (p.work && inSeq(seq, p.work.it)) seq.cur = seq.kind === 'path' ? p.work.it.i : p.work.it.o.id;
        W.idleT = 0;
        // walking to a job without getting closer for 3 s (stuck against something): skip that job for a while
        const g0 = ctl.goal;
        if (g0?.auto && g0.type === 'interact' && !p.work) {
          const d = Math.hypot((g0.it.x ?? p.x) - p.x, (g0.it.y ?? p.y) - p.y);
          if (seq.walkD == null || d < seq.walkD - 0.2) { seq.walkD = d; seq.walkT = 0; }
          else if ((seq.walkT = (seq.walkT || 0) + dt) > 3) { W.fail(g0.it); ctl.goal = null; seq.walkD = null; }
        } else seq.walkD = null;
        return;
      }
      W.idleT += dt;
      if (W.idleT < STEP_DELAY) return;
      if (craftingActive(game)) return;
      W.idleT = 0;
      const { best, blocked, stuck } = nextJob(game, seq);
      if (!best) { finish(game, blocked, stuck); return; }
      seq.first = null; seq.cur = seq.kind === 'path' ? best.i : best.o.id;
      ctl.goal = { type: 'interact', it: best, auto: true };
      resetNav(p);
    },
  };
}
