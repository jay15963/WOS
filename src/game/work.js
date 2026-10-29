// Work queue (RimWorld-like): when the player is idle, walk to the nearest pending job and do it —
// blueprints to build, structures marked for deconstruction, designated rock to mine, and follow-up
// farm jobs (plant the next empty plot / harvest the next ripe crop). Also routes interactions.
// Blueprints whose materials were not delivered yet are skipped while the bag lacks them ("falta material",
// one hint per blueprint). Any movement input stops the current job at once (controller) and resets the idle timer.

import { describeStructure, useStructure, structIt, canSupply, missingText } from './building.js';
import { startWork } from './gathering.js';
import { nearestMark, rockIt } from './mining.js';
import { seedToPlant, cropAt } from './farming.js';
import { resetNav } from './nav.js';
import { recipeState } from './crafting.js';
import { RECIPES } from './content/recipes.js';

const IDLE_DELAY = 0.7;   // s of idleness before auto work kicks in
const RANGE = 30;         // tiles
const FAIL_CD = 12;       // s an unreachable job is skipped

export function initWork(game) {
  const W = game.work = {
    idleT: 0, failed: new Map(), farmUntil: 0, told: new Set(),
    wake() { W.idleT = IDLE_DELAY; },
    queuePlantNear() { W.farmUntil = game.worldTime + 25; W.idleT = IDLE_DELAY; },
    queueHarvestNear() { W.farmUntil = game.worldTime + 25; W.idleT = IDLE_DELAY; },
    fail(it) { const k = jobKey(game, it); if (k) W.failed.set(k, game.worldTime + FAIL_CD); },
    count: () => countJobs(game),
  };
}

function jobKey(game, it) {
  if (it.kind === 'rock') return 'r' + game.world.idx(it.tx, it.ty);
  if (it.o) return 'o' + it.o.id + it.kind;
  return null;
}

export function countJobs(game) {
  let n = game.mining.marks.size + game.build.decon.size;
  for (const o of game.build.structures) if (o.blueprint) n++;
  return n;
}

// route a reached interaction to the right module
export function useInteract(game, it) {
  if (it.use) { useStructure(game, it); return true; }
  return startWork(game, it);
}

function nearestJob(game) {
  const p = game.player, W = game.work, now = game.worldTime;
  let best = null, bd = RANGE;
  const ok = (it) => { const k = jobKey(game, it); return !k || !(W.failed.get(k) > now); };
  const consider = (it, d) => { if (d < bd && ok(it)) { bd = d; best = it; } };
  for (const o of game.build.structures) {
    const blue = o.blueprint, dec = !blue && game.build.decon.has(o);
    if (!blue && !dec) continue;
    const d = Math.hypot(o.x - p.x, o.y - 0.5 - p.y);
    if (d >= bd) continue;
    if (blue && !canSupply(game, o)) {
      if (!W.told.has(o.id) && d < 14) { W.told.add(o.id); game.events.emit('toast', { text: `${o.moveOf ? '' : 'Planta parada · '}falta material: ${missingText(game, o)}`, kind: 'warn' }); }
      continue;
    }
    consider(structIt(o, { kind: blue ? 'blueprint' : 'decon', verb: blue ? 'Construir' : 'Desmontar', icon: 'build', auto: true }), d);
  }
  if (game.mining.marks.size) {
    const m = nearestMark(game, p.x, p.y, bd);
    if (m) {
      const it = rockIt(game, m[0], m[1]);
      consider(it, Math.hypot(m[0] + 0.5 - p.x, m[1] + 0.5 - p.y));
    }
  }
  if (now < W.farmUntil) {
    const seed = seedToPlant(p);
    for (const o of game.build.structures) {
      if (o.type !== 'farm_plot' || o.blueprint) continue;
      const d = Math.hypot(o.x - p.x, o.y - 0.5 - p.y);
      if (d >= Math.min(bd, 10)) continue;
      const c = cropAt(game, o.tx, o.ty);
      if ((!c && seed) || (c && c.stage >= 3)) {
        const it = describeStructure(game, o);
        if (it) consider(it, d);
      }
    }
  }
  return best;
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
  return {
    sync: 'owner', // the local player's job queue
    update(game, dt) {
      const p = game.player, ctl = game.ctl, W = game.work;
      const idle = !W.paused && !p.dead && !p.work && !ctl.goal && !ctl.manual && !p.moving && !p.autoAttack && !p.inCombat && !game.ui?.modal && !p.charge;
      if (!idle) { if (p.moving || ctl.manual) W.idleT = 0; return; }
      W.idleT += dt;
      if (W.idleT < IDLE_DELAY) return;
      if (craftingActive(game)) return;
      const it = nearestJob(game);
      if (!it) { W.idleT = 0; return; }
      W.idleT = 0;
      ctl.goal = { type: 'interact', it, auto: true };
      resetNav(p);
    },
  };
}
