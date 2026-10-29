// Auto-work, OPT-IN (owner's rule: nothing happens by itself). The player starts a job sequence by tapping /
// clicking a blue blueprint, a frame under construction or a structure marked for deconstruction (or by using
// one with E / the context menu), or by planting / harvesting a plot by hand. The sequence then works through
// the jobs of the same placement — the same batch (type + builtAt) plus connected blueprints of that type, the
// connected structures marked for deconstruction, the connected plots of a field — nearest first, and stops.
// Placing blueprints or marking things never starts anything.
// Movement input (joystick / WASD) interrupts the current step and PAUSES the sequence (banner: Continuar /
// ✕ Cancelar); ✕ / Esc cancels it: blueprints stay as plans and delivered materials stay delivered.
// Blueprints without materials are skipped ("falta material"); when only those are left the sequence ends.
// Owner-side (the local player): every job still goes through the intents (build.hit / decon.hit / farm.*).
// Mining is a direct action only (mining.js): no designations, no mining jobs here.
// game.work.paused (tests / debugging) freezes automatic continuation.

import { describeStructure, useStructure, structIt, canSupply, missingText } from './building.js';
import { startWork } from './gathering.js';
import { resetNav } from './nav.js';
import { recipeState } from './crafting.js';
import { RECIPES } from './content/recipes.js';
import { BUILDINGS } from './data.js';
import { structureAt } from './autotile.js';

const FAIL_CD = 12;      // s an unreachable job stays skipped
const STEP_DELAY = 0.25; // s between two jobs of a sequence
const FAR = 40;          // a paused sequence whose jobs are all farther than this (tiles) is dropped

const KIND = { blueprint: 'build', decon: 'decon', plant: 'farm', harvest: 'farm' };

export function initWork(game) {
  const W = game.work = {
    seq: null, paused: false, failed: new Map(), idleT: 0,
    begin: (it, opts) => beginSeq(game, it, opts),
    // stops the sequence and its current step (plans stay plans, delivered materials stay delivered)
    cancel(quiet = false) {
      const s = W.seq;
      if (!s) return;
      W.seq = null;
      const p = game.player, ctl = game.ctl;
      if (ctl?.goal?.auto) ctl.goal = null;
      if (p.work?.it?.o && s.ids.has(p.work.it.o.id)) { p.work = null; p.action = null; }
      if (!quiet) game.events.emit('toast', { text: 'Tarefa automática cancelada', kind: 'info' });
      game.events.emit('work', {});
    },
    pause() { if (W.seq && !W.seq.paused) { W.seq.paused = true; W.seq.cur = null; game.events.emit('work', {}); } },
    resume() { if (W.seq) { W.seq.paused = false; W.idleT = STEP_DELAY; game.events.emit('work', {}); } },
    active: () => !!W.seq,
    status: () => statusOf(game),
    fail(it) { const k = jobKey(it); if (k) W.failed.set(k, game.worldTime + FAIL_CD); },
    wake() { /* legacy no-op: placing / marking never starts work any more */ },
    // farm follow-ups: after a plot was planted / harvested by hand, continue with the rest of that field
    queuePlantNear: (tx, ty) => fieldFollowUp(game, tx, ty),
    queueHarvestNear: (tx, ty) => fieldFollowUp(game, tx, ty),
    count: () => countJobs(game),
  };
}

const jobKey = (it) => (it?.o ? 'o' + it.o.id : null);
const live = (game, id) => { const o = game.world.objById.get(id); return o && o.building && !o.removed ? o : null; };

// pending plans in the world (for UI / debugging)
export function countJobs(game) {
  let n = game.build.decon.size;
  for (const o of game.build.structures) if (o.blueprint) n++;
  return n;
}

// route a reached interaction to the right module. Using a blueprint / marked structure by hand (E, menu)
// also starts its sequence, with this job as the current one.
export function useInteract(game, it) {
  if (it.use) { useStructure(game, it); return true; }
  const W = game.work;
  if (!it.auto && !W.paused && (it.kind === 'blueprint' || it.kind === 'decon')) beginSeq(game, it, { now: true });
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

function beginSeq(game, it, { now = false } = {}) {
  const p = game.player, W = game.work;
  const kind = KIND[it?.kind];
  const o = it?.o;
  if (!kind || !o || p.dead) return false;
  if (kind === 'build' && !canSupply(game, o)) { game.events.emit('error', { text: `Falta ${missingText(game, o)}` }); return false; }
  const ids = groupOf(game, o, kind);
  W.seq = { kind, ids, first: now ? null : o.id, cur: now ? o.id : null, type: o.type, move: !!o.moveOf, total: ids.size, paused: false, skipped: 0 };
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
function jobFor(game, seq, o) {
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

function nextJob(game, seq) {
  const p = game.player, W = game.work, now = game.worldTime;
  let best = null, bd = 1e9, blocked = null, stuck = 0;
  for (const id of [...seq.ids]) {
    const o = live(game, id);
    const it = o ? jobFor(game, seq, o) : null;
    if (!it) { seq.ids.delete(id); continue; }
    if (it === 'blocked') { blocked ||= o; continue; }
    if ((W.failed.get('o' + id) || 0) > now) { stuck++; continue; }
    const d = id === seq.first ? -1 : Math.hypot(o.x - p.x, (o.cy ?? o.y) - p.y);
    if (d < bd) { bd = d; best = it; }
  }
  return { best, blocked, stuck };
}

function finish(game, blocked, stuck) {
  const W = game.work, seq = W.seq;
  W.seq = null;
  if (blocked) game.events.emit('toast', { text: `Obra parada · falta ${missingText(game, blocked)}`, kind: 'warn' });
  else if (stuck) game.events.emit('toast', { text: 'Tarefa parada: não dá para chegar ao resto', kind: 'warn' });
  else if (seq && seq.total > 1) game.events.emit('toast', { text: seq.kind === 'build' ? 'Plantas concluídas' : seq.kind === 'decon' ? 'Desmontagem concluída' : 'Canteiros prontos', kind: 'good' });
  game.events.emit('work', {});
}

// banner data: { kind, verb, name, n (jobs left incl. the current one), paused, blocked }
function statusOf(game) {
  const seq = game.work.seq;
  if (!seq) return null;
  let n = 0, blocked = 0, harvest = 0;
  for (const id of seq.ids) {
    const o = live(game, id);
    const it = o ? jobFor(game, seq, o) : null;
    if (!it) continue;
    if (it === 'blocked') blocked++;
    else { n++; if (it.kind === 'harvest') harvest++; }
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

export function workSystem() {
  let farT = 0;
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
          for (const id of seq.ids) { const o = live(game, id); if (o && Math.hypot(o.x - p.x, o.y - p.y) < FAR) { near = true; break; } }
          if (!near) W.cancel(true);
        }
        return;
      }
      if (W.paused) return;
      if (p.work || ctl.goal || p.moving || p.autoAttack || p.inCombat || game.ui?.modal || p.charge) {
        if (p.work?.it?.o && seq.ids.has(p.work.it.o.id)) seq.cur = p.work.it.o.id;
        W.idleT = 0;
        return;
      }
      W.idleT += dt;
      if (W.idleT < STEP_DELAY) return;
      if (craftingActive(game)) return;
      W.idleT = 0;
      const { best, blocked, stuck } = nextJob(game, seq);
      if (!best) { finish(game, blocked, stuck); return; }
      seq.first = null; seq.cur = best.o.id;
      ctl.goal = { type: 'interact', it: best, auto: true };
      resetNav(p);
    },
  };
}
